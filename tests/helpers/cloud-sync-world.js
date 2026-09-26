// Shared test world for the Cloud Sync service: real SQL from the migration on
// an in-memory SQLite database behind a D1-shaped shim, with Google, GitHub and
// Stripe replaced by a fake fetch.

const fs = require('fs');
const path = require('path');
const nodeCrypto = require('crypto');
const { handleRequest } = require('../../cloud-sync-service/src/index.js');

const { DatabaseSync } = process.getBuiltinModule('node:sqlite');
const MIGRATION = fs.readFileSync(
  path.join(__dirname, '../../cloud-sync-service/migrations/0001_init.sql'),
  'utf8'
);
const BASE = 'https://sync.test';
const DAY = 24 * 60 * 60 * 1000;

function createD1() {
  const db = new DatabaseSync(':memory:');
  db.exec('PRAGMA foreign_keys = ON;');
  db.exec(MIGRATION);
  const statement = (sql, params = []) => ({
    bind: (...args) => statement(sql, args),
    first: async () => db.prepare(sql).get(...params) ?? null,
    all: async () => ({ results: db.prepare(sql).all(...params) }),
    run: async () => {
      const result = db.prepare(sql).run(...params);
      return { meta: { changes: Number(result.changes) } };
    },
  });
  return {
    raw: db,
    prepare: (sql) => statement(sql),
    batch: async (statements) => {
      db.exec('BEGIN');
      try {
        const results = [];
        for (const item of statements) results.push(await item.run());
        db.exec('COMMIT');
        return results;
      } catch (error) {
        db.exec('ROLLBACK');
        throw error;
      }
    },
  };
}

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function createWorld(envOverrides = {}) {
  let now = Date.UTC(2026, 8, 1);
  const calls = [];
  const googleUsers = new Map();
  const githubUsers = new Map();
  const stripe = { failCancel: false };
  const fakeFetch = async (url, init = {}) => {
    const target = String(url);
    const body = init.body ? String(init.body) : '';
    calls.push({ url: target, method: init.method || 'GET', body, headers: init.headers || {} });
    if (target === 'https://oauth2.googleapis.com/token') {
      const code = new URLSearchParams(body).get('code');
      return googleUsers.has(code)
        ? jsonResponse({ access_token: `google-access-${code}` })
        : jsonResponse({ error: 'invalid_grant' }, 400);
    }
    if (target === 'https://openidconnect.googleapis.com/v1/userinfo') {
      const code = String(init.headers.Authorization).replace('Bearer google-access-', '');
      return jsonResponse(googleUsers.get(code));
    }
    if (target === 'https://github.com/login/oauth/access_token') {
      const code = new URLSearchParams(body).get('code');
      return jsonResponse({ access_token: `github-access-${code}` });
    }
    if (target.startsWith('https://api.github.com/')) {
      const code = String(init.headers.Authorization).replace('Bearer github-access-', '');
      const user = githubUsers.get(code);
      return jsonResponse(target.endsWith('/emails') ? user.emails : user.profile);
    }
    if (target === 'https://api.stripe.com/v1/checkout/sessions') {
      return jsonResponse({ url: 'https://checkout.stripe.test/session' });
    }
    if (target === 'https://api.stripe.com/v1/billing_portal/sessions') {
      return jsonResponse({ url: 'https://billing.stripe.test/portal' });
    }
    if (target.startsWith('https://api.stripe.com/v1/subscriptions/')) {
      return stripe.failCancel
        ? jsonResponse({ error: { message: 'down' } }, 500)
        : jsonResponse({ id: 'sub_1', status: 'canceled' });
    }
    throw new Error(`Unexpected fetch ${target}`);
  };
  const env = {
    DB: createD1(),
    PUBLIC_URL: BASE,
    GOOGLE_CLIENT_ID: 'google-id',
    GOOGLE_CLIENT_SECRET: 'google-secret',
    GITHUB_CLIENT_ID: 'github-id',
    GITHUB_CLIENT_SECRET: 'github-secret',
    STRIPE_SECRET_KEY: 'sk_test',
    STRIPE_PRICE_ID: 'price_yearly',
    STRIPE_WEBHOOK_SECRET: 'whsec_test',
    TRIAL_DAYS: '14',
    ...envOverrides,
  };
  const deps = { fetch: fakeFetch, crypto: nodeCrypto.webcrypto, now: () => now };
  const request = (pathname, init = {}) =>
    handleRequest(new Request(`${BASE}${pathname}`, init), env, deps);

  const pkce = () => {
    const verifier = nodeCrypto.randomBytes(32).toString('base64url');
    const challenge = nodeCrypto.createHash('sha256').update(verifier).digest('base64url');
    return { verifier, challenge };
  };
  const appRedirect = 'http://127.0.0.1:53123/oauth/callback';

  async function signIn(provider, code, { redirectUri = appRedirect } = {}) {
    const { verifier, challenge } = pkce();
    const appState = nodeCrypto.randomBytes(24).toString('base64url');
    const start = await request(
      `/v1/auth/start?${new URLSearchParams({
        provider,
        redirect_uri: redirectUri,
        state: appState,
        code_challenge: challenge,
        code_challenge_method: 'S256',
      })}`
    );
    expect(start.status).toBe(302);
    const providerState = new URL(start.headers.get('Location')).searchParams.get('state');
    const callback = await request(
      `/v1/auth/callback/${provider}?${new URLSearchParams({ code, state: providerState })}`
    );
    expect(callback.status).toBe(302);
    const back = new URL(callback.headers.get('Location'));
    expect(`${back.origin}${back.pathname}`).toBe(redirectUri);
    expect(back.searchParams.get('state')).toBe(appState);
    const handoff = back.searchParams.get('code');
    const token = await request('/v1/auth/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        code: handoff,
        code_verifier: verifier,
        redirect_uri: redirectUri,
        device_name: 'Test PC',
      }),
    });
    return { response: token, body: await token.json(), handoff, verifier, start };
  }

  const authed = (token, pathname, init = {}) =>
    request(pathname, {
      ...init,
      headers: { Authorization: `Bearer ${token}`, ...(init.headers || {}) },
    });

  async function sendWebhook(event, { secret = env.STRIPE_WEBHOOK_SECRET, at = now } = {}) {
    const payload = JSON.stringify(event);
    const timestamp = Math.floor(at / 1000);
    const signature = nodeCrypto
      .createHmac('sha256', secret)
      .update(`${timestamp}.${payload}`)
      .digest('hex');
    return request('/v1/billing/webhook', {
      method: 'POST',
      headers: { 'Stripe-Signature': `t=${timestamp},v1=${signature}` },
      body: payload,
    });
  }

  return {
    env,
    calls,
    stripe,
    googleUsers,
    githubUsers,
    request,
    authed,
    signIn,
    sendWebhook,
    pkce,
    appRedirect,
    advance: (ms) => {
      now += ms;
    },
    now: () => now,
  };
}

const testSafeStorage = {
  encryptString: (value) => Buffer.from(`sealed:${value}`),
  decryptString: (buffer) => Buffer.from(buffer).toString().slice('sealed:'.length),
};

/**
 * A desktop CloudSyncClient signed in to `world` through a scripted browser, as
 * the Google user registered under `code`.
 */
async function createSignedInClient(world, { userDataPath, code = 'g-code' }) {
  const { CloudSyncClient } = require('../../src/cloud-sync-client.cjs');
  const client = new CloudSyncClient({
    serviceUrl: BASE,
    safeStorage: testSafeStorage,
    platform: 'linux',
    userDataPath,
    fetchImpl: (url, init) => world.request(String(url).replace(BASE, ''), init),
    openExternal: async (url) => {
      if (!url.startsWith(`${BASE}/v1/auth/start`)) return;
      const start = await world.request(url.replace(BASE, ''));
      const state = new URL(start.headers.get('Location')).searchParams.get('state');
      const callback = await world.request(`/v1/auth/callback/google?code=${code}&state=${state}`);
      await fetch(callback.headers.get('Location'));
    },
    isSecureStorageAvailable: () => true,
  });
  await client.signIn('google');
  return client;
}

module.exports = { BASE, DAY, createD1, createSignedInClient, createWorld, testSafeStorage };

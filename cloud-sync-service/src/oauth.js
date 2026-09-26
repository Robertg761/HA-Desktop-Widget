// Browser sign-in for the desktop app.
//
// 1. The app opens /v1/auth/start in the browser with its loopback redirect URI,
//    its own state and a PKCE code challenge.
// 2. The service sends the browser to Google or GitHub, with its own state.
// 3. The provider returns to /v1/auth/callback/<provider>; the service finds or
//    creates the user and sends the browser back to the app's loopback URI with a
//    one-time handoff code.
// 4. The app redeems that code at /v1/auth/token with its PKCE verifier for a
//    session token. A code intercepted on its way to the loopback URI is useless
//    without the verifier.

import { createSession, findOrCreateUser } from './accounts.js';
import {
  errorResponse,
  htmlPage,
  json,
  publicBaseUrl,
  randomToken,
  readJsonBody,
  redirect,
  sha256Base64Url,
  sha256Hex,
  timingSafeEqual,
} from './util.js';

const OAUTH_STATE_TTL_MS = 10 * 60 * 1000;
const HANDOFF_CODE_TTL_MS = 2 * 60 * 1000;
const USER_AGENT = 'HA-Desktop-Widget-Cloud-Sync';

export const PROVIDERS = {
  google: {
    isConfigured: (env) => !!(env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET),
    authorizeUrl(env, redirectUri, state) {
      const url = new URL('https://accounts.google.com/o/oauth2/v2/auth');
      url.searchParams.set('client_id', env.GOOGLE_CLIENT_ID);
      url.searchParams.set('redirect_uri', redirectUri);
      url.searchParams.set('response_type', 'code');
      url.searchParams.set('scope', 'openid email');
      url.searchParams.set('state', state);
      url.searchParams.set('prompt', 'select_account');
      return url.toString();
    },
    async fetchIdentity(env, deps, code, redirectUri) {
      const tokenResponse = await deps.fetch('https://oauth2.googleapis.com/token', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          Accept: 'application/json',
        },
        body: new URLSearchParams({
          code,
          client_id: env.GOOGLE_CLIENT_ID,
          client_secret: env.GOOGLE_CLIENT_SECRET,
          redirect_uri: redirectUri,
          grant_type: 'authorization_code',
        }),
      });
      const tokens = await tokenResponse.json();
      if (!tokenResponse.ok || !tokens.access_token) throw new Error('google_token');
      const userResponse = await deps.fetch('https://openidconnect.googleapis.com/v1/userinfo', {
        headers: { Authorization: `Bearer ${tokens.access_token}` },
      });
      const user = await userResponse.json();
      if (!userResponse.ok || !user.sub) throw new Error('google_user');
      return {
        providerUserId: String(user.sub),
        email: user.email_verified === true && user.email ? normalizeEmail(user.email) : null,
      };
    },
  },
  github: {
    isConfigured: (env) => !!(env.GITHUB_CLIENT_ID && env.GITHUB_CLIENT_SECRET),
    authorizeUrl(env, redirectUri, state) {
      const url = new URL('https://github.com/login/oauth/authorize');
      url.searchParams.set('client_id', env.GITHUB_CLIENT_ID);
      url.searchParams.set('redirect_uri', redirectUri);
      url.searchParams.set('scope', 'read:user user:email');
      url.searchParams.set('state', state);
      return url.toString();
    },
    async fetchIdentity(env, deps, code, redirectUri) {
      const tokenResponse = await deps.fetch('https://github.com/login/oauth/access_token', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          Accept: 'application/json',
        },
        body: new URLSearchParams({
          code,
          client_id: env.GITHUB_CLIENT_ID,
          client_secret: env.GITHUB_CLIENT_SECRET,
          redirect_uri: redirectUri,
        }),
      });
      const tokens = await tokenResponse.json();
      if (!tokenResponse.ok || !tokens.access_token) throw new Error('github_token');
      const headers = {
        Authorization: `Bearer ${tokens.access_token}`,
        Accept: 'application/vnd.github+json',
        'User-Agent': USER_AGENT,
      };
      const userResponse = await deps.fetch('https://api.github.com/user', { headers });
      const user = await userResponse.json();
      if (!userResponse.ok || user.id === undefined || user.id === null) {
        throw new Error('github_user');
      }
      // GitHub's profile email may be hidden or unverified; the emails endpoint
      // says which address is primary and verified.
      let email = null;
      const emailsResponse = await deps.fetch('https://api.github.com/user/emails', { headers });
      if (emailsResponse.ok) {
        const emails = await emailsResponse.json();
        const primary = Array.isArray(emails)
          ? emails.find((entry) => entry && entry.primary && entry.verified && entry.email)
          : null;
        email = primary ? normalizeEmail(primary.email) : null;
      }
      return { providerUserId: String(user.id), email };
    },
  },
};

function normalizeEmail(email) {
  return String(email).trim().toLowerCase().slice(0, 320) || null;
}

/** Only the app's own loopback callback may receive a handoff code. */
export function isAllowedAppRedirect(value) {
  let url;
  try {
    url = new URL(value);
  } catch {
    return false;
  }
  const port = Number(url.port);
  return (
    url.protocol === 'http:' &&
    url.hostname === '127.0.0.1' &&
    Number.isInteger(port) &&
    port >= 1024 &&
    port <= 65535 &&
    url.pathname === '/oauth/callback' &&
    !url.search &&
    !url.hash &&
    !url.username &&
    !url.password
  );
}

function appRedirect(redirectUri, params) {
  const url = new URL(redirectUri);
  Object.entries(params).forEach(([key, value]) => url.searchParams.set(key, value));
  return redirect(url.toString());
}

function providerCallbackUrl(request, env, provider) {
  return `${publicBaseUrl(request, env)}/v1/auth/callback/${provider}`;
}

export async function handleAuthStart(request, env, deps) {
  const url = new URL(request.url);
  const provider = url.searchParams.get('provider') || '';
  const redirectUri = url.searchParams.get('redirect_uri') || '';
  const appState = url.searchParams.get('state') || '';
  const codeChallenge = url.searchParams.get('code_challenge') || '';
  const method = url.searchParams.get('code_challenge_method') || '';
  const definition = Object.prototype.hasOwnProperty.call(PROVIDERS, provider)
    ? PROVIDERS[provider]
    : null;
  if (!definition || !definition.isConfigured(env)) {
    return htmlPage('Sign-in unavailable', 'That sign-in method is not available.', 400);
  }
  if (
    !isAllowedAppRedirect(redirectUri) ||
    !/^[A-Za-z0-9_-]{16,256}$/.test(appState) ||
    !/^[A-Za-z0-9_-]{43}$/.test(codeChallenge) ||
    method !== 'S256'
  ) {
    return htmlPage(
      'Sign-in link not valid',
      'Start signing in again from HA Desktop Widget.',
      400
    );
  }

  const now = deps.now();
  await env.DB.batch([
    env.DB.prepare('DELETE FROM oauth_states WHERE expires_at < ?').bind(now),
    env.DB.prepare('DELETE FROM handoff_codes WHERE expires_at < ?').bind(now),
  ]);
  const state = randomToken(deps.crypto);
  await env.DB.prepare(
    'INSERT INTO oauth_states (id, provider, redirect_uri, app_state, code_challenge, expires_at) VALUES (?, ?, ?, ?, ?, ?)'
  )
    .bind(state, provider, redirectUri, appState, codeChallenge, now + OAUTH_STATE_TTL_MS)
    .run();
  return redirect(definition.authorizeUrl(env, providerCallbackUrl(request, env, provider), state));
}

export async function handleAuthCallback(request, env, deps, provider) {
  const definition = Object.prototype.hasOwnProperty.call(PROVIDERS, provider)
    ? PROVIDERS[provider]
    : null;
  if (!definition) return htmlPage('Not found', 'This page does not exist.', 404);
  const url = new URL(request.url);
  const state = url.searchParams.get('state') || '';
  // The state is single use: it is removed before anything else happens.
  const pending = state
    ? await env.DB.prepare('SELECT * FROM oauth_states WHERE id = ? AND provider = ?')
        .bind(state, provider)
        .first()
    : null;
  if (pending) {
    await env.DB.prepare('DELETE FROM oauth_states WHERE id = ?').bind(state).run();
  }
  if (!pending || pending.expires_at < deps.now()) {
    return htmlPage(
      'Sign-in expired',
      'This sign-in link has expired or was already used. Start again from HA Desktop Widget.',
      400
    );
  }

  const providerError = url.searchParams.get('error');
  const code = url.searchParams.get('code') || '';
  if (providerError || !code) {
    return appRedirect(pending.redirect_uri, {
      error: providerError === 'access_denied' ? 'access_denied' : 'sign_in_failed',
      state: pending.app_state,
    });
  }

  let identity;
  try {
    identity = await definition.fetchIdentity(
      env,
      deps,
      code,
      providerCallbackUrl(request, env, provider)
    );
  } catch {
    return appRedirect(pending.redirect_uri, {
      error: 'sign_in_failed',
      state: pending.app_state,
    });
  }
  const userId = await findOrCreateUser(env, deps, { provider, ...identity });
  const handoffCode = randomToken(deps.crypto);
  await env.DB.prepare(
    'INSERT INTO handoff_codes (code_hash, user_id, code_challenge, redirect_uri, expires_at) VALUES (?, ?, ?, ?, ?)'
  )
    .bind(
      await sha256Hex(deps.crypto, handoffCode),
      userId,
      pending.code_challenge,
      pending.redirect_uri,
      deps.now() + HANDOFF_CODE_TTL_MS
    )
    .run();
  return appRedirect(pending.redirect_uri, { code: handoffCode, state: pending.app_state });
}

export async function handleAuthToken(request, env, deps) {
  const body = await readJsonBody(request);
  const code = typeof body?.code === 'string' ? body.code : '';
  const verifier = typeof body?.code_verifier === 'string' ? body.code_verifier : '';
  const redirectUri = typeof body?.redirect_uri === 'string' ? body.redirect_uri : '';
  const deviceName =
    typeof body?.device_name === 'string' ? body.device_name.trim().slice(0, 64) : '';
  if (!code || code.length > 128 || !/^[A-Za-z0-9._~-]{43,128}$/.test(verifier)) {
    return errorResponse(400, 'invalid_request', 'The sign-in request was not valid.');
  }
  const codeHash = await sha256Hex(deps.crypto, code);
  const handoff = await env.DB.prepare('SELECT * FROM handoff_codes WHERE code_hash = ?')
    .bind(codeHash)
    .first();
  if (handoff) {
    await env.DB.prepare('DELETE FROM handoff_codes WHERE code_hash = ?').bind(codeHash).run();
  }
  const challenge = await sha256Base64Url(deps.crypto, verifier);
  if (
    !handoff ||
    handoff.expires_at < deps.now() ||
    handoff.redirect_uri !== redirectUri ||
    !timingSafeEqual(handoff.code_challenge, challenge)
  ) {
    return errorResponse(400, 'invalid_grant', 'The sign-in has expired. Try again.');
  }
  const token = await createSession(env, deps, handoff.user_id, deviceName);
  const user = await env.DB.prepare('SELECT id, email FROM users WHERE id = ?')
    .bind(handoff.user_id)
    .first();
  return json({ token, user: { id: user.id, email: user.email } });
}

export function listConfiguredProviders(env) {
  return Object.keys(PROVIDERS).filter((name) => PROVIDERS[name].isConfigured(env));
}

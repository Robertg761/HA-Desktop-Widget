/**
 * @jest-environment node
 */

// Drives the desktop Cloud Sync client against the real service (see
// tests/helpers/cloud-sync-world.js). The "browser" follows the service's
// redirects and finally calls the client's real loopback server.

const fs = require('fs');
const os = require('os');
const path = require('path');
const {
  CLOUD_SYNC_CREDENTIALS_FILE,
  CLOUD_SYNC_LAST_ACCOUNT_FILE,
  CloudSyncClient,
  isStripeBillingUrl,
  normalizeCloudSyncServiceUrl,
  parseEtagRevision,
  resolveCloudSyncServiceUrl,
} = require('../../src/cloud-sync-client.cjs');
const { BASE, DAY, createWorld } = require('../helpers/cloud-sync-world.js');

const safeStorage = {
  encryptString: (value) => Buffer.from(`sealed:${value}`),
  decryptString: (buffer) => {
    const text = Buffer.from(buffer).toString();
    if (!text.startsWith('sealed:')) throw new Error('bad');
    return text.slice('sealed:'.length);
  },
};

function setup({ worldOptions, secure = true, browser } = {}) {
  const world = createWorld(worldOptions);
  world.googleUsers.set('g-code', { sub: 'google-1', email: 'me@x.io', email_verified: true });
  const userDataPath = fs.mkdtempSync(path.join(os.tmpdir(), 'cloud-sync-client-'));
  const opened = [];
  // A browser that signs in with Google and follows the redirect back to the app.
  const defaultBrowser = async (url) => {
    const start = await world.request(url.replace(BASE, ''));
    const state = new URL(start.headers.get('Location')).searchParams.get('state');
    const callback = await world.request(`/v1/auth/callback/google?code=g-code&state=${state}`);
    await fetch(callback.headers.get('Location'));
  };
  const client = new CloudSyncClient({
    serviceUrl: BASE,
    safeStorage,
    platform: 'linux',
    userDataPath,
    fetchImpl: (url, init) => world.request(String(url).replace(BASE, ''), init),
    openExternal: async (url) => {
      opened.push(url);
      if (url.startsWith(`${BASE}/v1/auth/start`)) await (browser || defaultBrowser)(url, world);
    },
    isSecureStorageAvailable: () => secure,
    deviceName: 'Office PC',
  });
  return { world, client, userDataPath, opened };
}

describe('cloud sync client', () => {
  test('signs in through the browser and keeps only a sealed token', async () => {
    const { world, client, userDataPath, opened } = setup();
    expect(client.getStoredAccount()).toBeNull();

    const signedIn = await client.signIn('google');
    const userId = world.env.DB.raw.prepare('SELECT id FROM users').get().id;
    expect(signedIn).toEqual({ id: userId, email: 'me@x.io', provider: 'google' });

    const startUrl = new URL(opened[0]);
    expect(startUrl.searchParams.get('code_challenge_method')).toBe('S256');
    expect(startUrl.searchParams.get('redirect_uri')).toMatch(
      /^http:\/\/127\.0\.0\.1:\d+\/oauth\/callback$/
    );
    expect(client.getStoredAccount()).toEqual({ id: userId, email: 'me@x.io', provider: 'google' });
    const stored = JSON.parse(
      fs.readFileSync(path.join(userDataPath, CLOUD_SYNC_CREDENTIALS_FILE), 'utf8')
    );
    expect(stored.tokenEncrypted).not.toMatch(/hdws_/);
    const session = world.env.DB.raw.prepare('SELECT device_name FROM sessions').get();
    expect(session.device_name).toBe('Office PC');

    await expect(client.getAccount()).resolves.toMatchObject({
      id: userId,
      email: 'me@x.io',
      providers: ['google'],
      entitled: true,
      entitlementReason: 'trial',
      billingAvailable: true,
    });
  });

  test('keeps the account id, and reads a sign-in saved before ids were kept', async () => {
    const browserFor = (code) => async (url, world) => {
      const start = await world.request(url.replace(BASE, ''));
      const state = new URL(start.headers.get('Location')).searchParams.get('state');
      const callback = await world.request(`/v1/auth/callback/github?code=${code}&state=${state}`);
      await fetch(callback.headers.get('Location'));
    };
    // Two GitHub accounts without a verified email.
    const first = setup({ browser: browserFor('gh-1') });
    first.world.githubUsers.set('gh-1', { profile: { id: 1, login: 'one' }, emails: [] });
    first.world.githubUsers.set('gh-2', { profile: { id: 2, login: 'two' }, emails: [] });
    const one = await first.client.signIn('github');
    first.client.openExternal = (url) => browserFor('gh-2')(url, first.world);
    const two = await first.client.signIn('github');
    expect(one.email).toBe('');
    expect(two.email).toBe('');
    expect(one.id).toEqual(expect.any(String));
    expect(two.id).not.toBe(one.id);
    expect(first.client.getStoredAccount()).toEqual({ id: two.id, email: '', provider: 'github' });

    const legacy = setup();
    await legacy.client.signIn('google');
    const file = path.join(legacy.userDataPath, CLOUD_SYNC_CREDENTIALS_FILE);
    const { userId, ...older } = JSON.parse(fs.readFileSync(file, 'utf8'));
    expect(userId).toEqual(expect.any(String));
    fs.writeFileSync(file, JSON.stringify(older));
    expect(legacy.client.getStoredAccount()).toEqual({
      id: '',
      email: 'me@x.io',
      provider: 'google',
    });
    await expect(legacy.client.readProfile()).resolves.toMatchObject({ exists: false });
  });

  test('reads and writes the profile with compare-and-swap', async () => {
    const { client } = setup();
    await client.signIn('google');
    const file = (by) =>
      JSON.stringify({ schemaVersion: 3, updatedByDeviceId: by, payload: { sections: {} } });

    await expect(client.readProfile()).resolves.toEqual({
      exists: false,
      text: null,
      revision: null,
    });
    await expect(client.writeProfile(file('a'), null)).resolves.toEqual({ revision: 1 });
    await expect(client.writeProfile(file('b'), 1)).resolves.toEqual({ revision: 2 });
    await expect(client.writeProfile(file('c'), 1)).rejects.toMatchObject({
      code: 'CLOUD_SYNC_CONFLICT',
    });
    await expect(client.writeProfile(file('c'), null)).rejects.toMatchObject({
      code: 'CLOUD_SYNC_CONFLICT',
    });
    const read = await client.readProfile();
    expect(read.revision).toBe(2);
    expect(JSON.parse(read.text).updatedByDeviceId).toBe('b');
  });

  test('reports when saving needs a subscription, and opens checkout', async () => {
    const { world, client, opened } = setup();
    await client.signIn('google');
    world.advance(15 * DAY);
    await expect(
      client.writeProfile(JSON.stringify({ schemaVersion: 3, payload: {} }), null)
    ).rejects.toMatchObject({ code: 'CLOUD_SYNC_SUBSCRIPTION_REQUIRED', status: 402 });

    await expect(client.openBilling()).resolves.toEqual({ opened: 'checkout' });
    expect(opened.at(-1)).toBe('https://checkout.stripe.com/c/pay/cs_test');
  });

  test('opens only Stripe pages for billing', async () => {
    const { world, client, opened } = setup();
    await client.signIn('google');
    await client.openBilling();
    opened.length = 0;
    world.stripe.checkouts.get('cs_1').url = 'https://checkout.stripe.com.example.net/pay';
    await expect(client.openBilling()).rejects.toMatchObject({ code: 'CLOUD_SYNC_ERROR' });
    expect(opened).toEqual([]);

    expect(isStripeBillingUrl('https://checkout.stripe.com/c/pay/cs_1')).toBe(true);
    expect(isStripeBillingUrl('https://billing.stripe.com/p/session/1')).toBe(true);
    expect(isStripeBillingUrl('https://pay.stripe.com/x')).toBe(true);
    expect(isStripeBillingUrl('http://checkout.stripe.com/c/pay/cs_1')).toBe(false);
    expect(isStripeBillingUrl('https://evilstripe.com/')).toBe(false);
    expect(isStripeBillingUrl('https://stripe.com.example.net/')).toBe(false);
    expect(isStripeBillingUrl('https://user@checkout.stripe.com/')).toBe(false);
    expect(isStripeBillingUrl('not a url')).toBe(false);
  });

  test('a session the service no longer accepts signs the app out', async () => {
    const { world, client } = setup();
    await client.signIn('google');
    world.advance(181 * DAY);
    await expect(client.readProfile()).rejects.toMatchObject({ code: 'CLOUD_SYNC_SIGNED_OUT' });
    expect(client.getStoredAccount()).toBeNull();
    await expect(client.readProfile()).rejects.toMatchObject({ code: 'CLOUD_SYNC_SIGNED_OUT' });
  });

  test('a refusal of a session already replaced by signing in again keeps the new one', async () => {
    const { world, client } = setup();
    await client.signIn('google');
    const realFetch = client.fetchImpl;
    client.fetchImpl = async (url, init) => {
      if (!String(url).endsWith('/v1/profile')) return realFetch(url, init);
      client.fetchImpl = realFetch;
      // The request is on its way with the old token when the user signs in again
      // and the old session ends, so the service refuses it.
      await client.signIn('google');
      await world.authed(init.headers.Authorization.replace('Bearer ', ''), '/v1/auth/signout', {
        method: 'POST',
      });
      return realFetch(url, init);
    };
    await expect(client.readProfile()).rejects.toMatchObject({ code: 'CLOUD_SYNC_SIGNED_OUT' });
    expect(client.getStoredAccount()).toMatchObject({ email: 'me@x.io' });
    await expect(client.readProfile()).resolves.toMatchObject({ exists: false });
  });

  test('a canceled subscriber can start checkout again using the existing customer', async () => {
    const { world, client, opened } = setup();
    await client.signIn('google');
    await client.openBilling();
    Object.assign(world.stripe.checkouts.get('cs_1'), {
      status: 'complete',
      subscription: 'sub_old',
    });
    const userId = world.env.DB.raw.prepare('SELECT id FROM users').get().id;
    await world.sendWebhook({
      type: 'customer.subscription.deleted',
      created: 1,
      data: {
        object: {
          id: 'sub_old',
          customer: 'cus_returning',
          metadata: { user_id: userId },
          status: 'canceled',
        },
      },
    });
    await expect(client.openBilling()).resolves.toEqual({ opened: 'checkout' });
    expect(opened.at(-1)).toBe('https://checkout.stripe.com/c/pay/cs_test');
    const call = world.calls.filter((call) => call.url.endsWith('/checkout/sessions')).at(-1);
    expect(new URLSearchParams(call.body).get('customer')).toBe('cus_returning');
    expect(world.stripe.checkouts.size).toBe(2);
  });

  test('signing out ends the session, even when the service cannot be reached', async () => {
    const { world, client } = setup();
    await client.signIn('google');
    await client.signOut();
    expect(client.getStoredAccount()).toBeNull();
    expect(world.env.DB.raw.prepare('SELECT * FROM sessions').all()).toHaveLength(0);

    await client.signIn('google');
    client.fetchImpl = async () => {
      throw new TypeError('offline');
    };
    await client.signOut();
    expect(client.getStoredAccount()).toBeNull();
  });

  test('signing out cancels a sign-in that has not finished', async () => {
    const { world, client } = setup();
    const realFetch = client.fetchImpl;
    let signingOut;
    client.fetchImpl = async (url, init) => {
      // The browser is done and the code is being redeemed when the user signs out.
      if (String(url).endsWith('/v1/auth/token')) signingOut = client.signOut();
      return realFetch(url, init);
    };
    await expect(client.signIn('google')).rejects.toMatchObject({
      code: 'CLOUD_SYNC_SIGN_IN_CANCELED',
    });
    await signingOut;
    expect(client.getStoredAccount()).toBeNull();
    expect(world.env.DB.raw.prepare('SELECT * FROM sessions').all()).toHaveLength(0);

    // Still waiting for the browser.
    client.fetchImpl = realFetch;
    client.openExternal = async () => {};
    const waiting = client.signIn('google');
    await new Promise((resolve) => setTimeout(resolve, 20));
    await client.signOut();
    await expect(waiting).rejects.toMatchObject({ code: 'CLOUD_SYNC_SIGN_IN_CANCELED' });
    expect(client.getStoredAccount()).toBeNull();
  });

  test('remembers which account was signed in, but not its token, after signing out', async () => {
    const { world, client, userDataPath } = setup();
    expect(client.getLastAccount()).toBeNull();
    const { id } = await client.signIn('google');
    await client.signOut();
    expect(client.getLastAccount()).toEqual({ id, email: '', provider: 'google' });
    const remembered = fs.readFileSync(
      path.join(userDataPath, CLOUD_SYNC_LAST_ACCOUNT_FILE),
      'utf8'
    );
    expect(remembered).not.toMatch(/token|sealed/i);

    // And after the service refuses an expired session.
    await client.signIn('google');
    fs.rmSync(path.join(userDataPath, CLOUD_SYNC_LAST_ACCOUNT_FILE));
    world.advance(181 * DAY);
    await expect(client.readProfile()).rejects.toMatchObject({ code: 'CLOUD_SYNC_SIGNED_OUT' });
    expect(client.getLastAccount()).toEqual({ id, email: '', provider: 'google' });
  });

  test('deleting the account removes it on the service and here', async () => {
    const { world, client } = setup();
    await client.signIn('google');
    await client.signOut();
    await client.signIn('google');
    await client.deleteAccount();
    expect(client.getStoredAccount()).toBeNull();
    expect(client.getLastAccount()).toBeNull();
    expect(world.env.DB.raw.prepare('SELECT * FROM users').all()).toHaveLength(0);
  });

  test('a stray request to the loopback address does not end the sign-in', async () => {
    const statuses = [];
    const { client } = setup({
      browser: async (url, world) => {
        const redirect = new URL(new URL(url).searchParams.get('redirect_uri'));
        // Another program on this machine guesses at the callback, then at another path.
        statuses.push((await fetch(`${redirect}?code=stolen&state=not-the-app-state`)).status);
        statuses.push((await fetch(`${redirect.origin}/favicon.ico`)).status);
        const start = await world.request(url.replace(BASE, ''));
        const state = new URL(start.headers.get('Location')).searchParams.get('state');
        const callback = await world.request(`/v1/auth/callback/google?code=g-code&state=${state}`);
        statuses.push((await fetch(callback.headers.get('Location'))).status);
      },
    });
    await expect(client.signIn('google')).resolves.toMatchObject({ email: 'me@x.io' });
    expect(statuses).toEqual([400, 404, 200]);
    expect(client.getStoredAccount()).toMatchObject({ email: 'me@x.io' });
  });

  test('a declined, forged or cancelled sign-in stores nothing', async () => {
    const declined = setup({
      browser: async (url, world) => {
        const start = await world.request(url.replace(BASE, ''));
        const state = new URL(start.headers.get('Location')).searchParams.get('state');
        const back = await world.request(
          `/v1/auth/callback/google?error=access_denied&state=${state}`
        );
        await fetch(back.headers.get('Location'));
      },
    });
    await expect(declined.client.signIn('google')).rejects.toMatchObject({
      code: 'CLOUD_SYNC_SIGN_IN_DECLINED',
    });
    expect(declined.client.getStoredAccount()).toBeNull();

    const forged = setup({
      browser: async (url) => {
        const redirect = new URL(url).searchParams.get('redirect_uri');
        const response = await fetch(`${redirect}?code=stolen&state=not-the-app-state`);
        expect(response.status).toBe(400);
      },
    });
    forged.client.signInTimeoutMs = 200;
    await expect(forged.client.signIn('google')).rejects.toMatchObject({
      code: 'CLOUD_SYNC_SIGN_IN_TIMEOUT',
    });
    expect(forged.client.getStoredAccount()).toBeNull();

    const cancelled = setup({ browser: async () => {} });
    const pending = cancelled.client.signIn('google');
    await new Promise((resolve) => setTimeout(resolve, 20));
    cancelled.client.cancelSignIn();
    await expect(pending).rejects.toMatchObject({ code: 'CLOUD_SYNC_SIGN_IN_CANCELED' });
  });

  test('refuses to sign in without secure storage or a service', async () => {
    const insecure = setup({ secure: false });
    await expect(insecure.client.signIn('google')).rejects.toMatchObject({
      code: 'CLOUD_SYNC_SECURE_STORAGE_UNAVAILABLE',
    });
    await expect(insecure.client.signIn('facebook')).rejects.toMatchObject({
      code: 'CLOUD_SYNC_PROVIDER',
    });
    const unavailable = new CloudSyncClient({ serviceUrl: '', userDataPath: os.tmpdir() });
    expect(unavailable.isAvailable()).toBe(false);
    expect(unavailable.getStoredAccount()).toBeNull();
    await expect(unavailable.readProfile()).rejects.toMatchObject({
      code: 'CLOUD_SYNC_UNAVAILABLE',
    });
  });

  test('lists the sign-in methods the service offers', async () => {
    const { client } = setup({ worldOptions: { GITHUB_CLIENT_ID: '' } });
    await expect(client.getServiceConfig()).resolves.toEqual({
      providers: ['google'],
      billingAvailable: true,
    });
  });

  test('reports an unreachable service plainly', async () => {
    const { client } = setup();
    client.fetchImpl = async () => {
      throw new TypeError('fetch failed');
    };
    await expect(client.getServiceConfig()).rejects.toMatchObject({ code: 'CLOUD_SYNC_NETWORK' });
  });

  test('accepts only https service addresses, or http on this machine', () => {
    expect(normalizeCloudSyncServiceUrl('https://sync.example.com/some/path')).toBe(
      'https://sync.example.com'
    );
    expect(normalizeCloudSyncServiceUrl('http://127.0.0.1:8787')).toBe('http://127.0.0.1:8787');
    expect(normalizeCloudSyncServiceUrl('http://sync.example.com')).toBe('');
    expect(normalizeCloudSyncServiceUrl('https://user:pw@sync.example.com')).toBe('');
    expect(normalizeCloudSyncServiceUrl('not a url')).toBe('');
    expect(normalizeCloudSyncServiceUrl(undefined)).toBe('');
    expect(resolveCloudSyncServiceUrl({ HA_WIDGET_CLOUD_SYNC_URL: 'https://a.example' })).toBe(
      'https://a.example'
    );
    expect(resolveCloudSyncServiceUrl({})).toBe('https://sync.hadesktopwidget.com');
    expect(parseEtagRevision('"12"')).toBe(12);
    expect(parseEtagRevision('W/"3"')).toBe(3);
    expect(parseEtagRevision('abc')).toBeNull();
  });
});

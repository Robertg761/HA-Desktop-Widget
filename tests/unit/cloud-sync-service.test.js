/**
 * @jest-environment node
 */

// Runs the Cloud Sync Worker end to end (see tests/helpers/cloud-sync-world.js).

const { findOrCreateUser } = require('../../cloud-sync-service/src/accounts.js');
const { encodeStripeParams } = require('../../cloud-sync-service/src/billing.js');
const { readTextBody } = require('../../cloud-sync-service/src/util.js');
const { BASE, DAY, createWorld } = require('../helpers/cloud-sync-world.js');

const envelope = (extra = {}) =>
  JSON.stringify({
    schemaVersion: 3,
    minReaderVersion: 3,
    updatedAt: '2026-09-01T00:00:00.000Z',
    updatedByDeviceId: 'device-a',
    payload: { sections: {} },
    ...extra,
  });

describe('cloud sync service', () => {
  test('prelaunch mode exposes health but blocks sign-in, account data, and billing', async () => {
    const world = createWorld({ LAUNCH_MODE: 'prelaunch' });
    expect(await (await world.request('/v1/health')).json()).toEqual({ ok: true });
    for (const [path, init] of [
      ['/'],
      ['/v1/config'],
      ['/v1/auth/start'],
      ['/v1/auth/callback/google'],
      ['/v1/auth/token', { method: 'POST' }],
      ['/v1/account'],
      ['/v1/profile'],
      ['/v1/billing/checkout', { method: 'POST' }],
      ['/v1/billing/portal', { method: 'POST' }],
      ['/v1/billing/webhook', { method: 'POST' }],
    ]) {
      const response = await world.request(path, init);
      expect(response.status).toBe(503);
      expect((await response.json()).error).toBe('not_launched');
    }
    expect(world.env.DB.raw.prepare('SELECT * FROM users').all()).toHaveLength(0);
    expect(world.calls).toHaveLength(0);
  });

  test('private mode admits only verified allowlisted email and blocks old sessions', async () => {
    const world = createWorld({
      LAUNCH_MODE: 'private',
      PRIVATE_TEST_EMAILS: 'robert@example.com',
    });
    world.googleUsers.set('allowed', {
      sub: 'google-allowed',
      email: 'Robert@Example.com',
      email_verified: true,
    });
    const { body } = await world.signIn('google', 'allowed');
    expect(body.user.email).toBe('robert@example.com');
    expect((await world.authed(body.token, '/v1/account')).status).toBe(200);

    world.googleUsers.set('denied', {
      sub: 'google-denied',
      email: 'other@example.com',
      email_verified: true,
    });
    const { challenge } = world.pkce();
    const start = await world.request(
      `/v1/auth/start?${new URLSearchParams({
        provider: 'google',
        redirect_uri: world.appRedirect,
        state: 'app-state-0123456789',
        code_challenge: challenge,
        code_challenge_method: 'S256',
      })}`
    );
    const state = new URL(start.headers.get('Location')).searchParams.get('state');
    const denied = await world.request(`/v1/auth/callback/google?code=denied&state=${state}`);
    expect(new URL(denied.headers.get('Location')).searchParams.get('error')).toBe('access_denied');
    expect(world.env.DB.raw.prepare('SELECT * FROM users').all()).toHaveLength(1);

    world.env.PRIVATE_TEST_EMAILS = 'someone-else@example.com';
    expect((await world.authed(body.token, '/v1/account')).status).toBe(401);
  });

  describe('sign-in', () => {
    test('concurrent callbacks and code redemptions are each single use', async () => {
      const world = createWorld();
      world.googleUsers.set('race', {
        sub: 'google-race',
        email: 'race@b.c',
        email_verified: true,
      });
      const { verifier, challenge } = world.pkce();
      const start = await world.request(
        `/v1/auth/start?${new URLSearchParams({
          provider: 'google',
          redirect_uri: world.appRedirect,
          state: 'app-state-0123456789',
          code_challenge: challenge,
          code_challenge_method: 'S256',
        })}`
      );
      const state = new URL(start.headers.get('Location')).searchParams.get('state');
      const callbacks = await Promise.all(
        [0, 1].map(() => world.request(`/v1/auth/callback/google?code=race&state=${state}`))
      );
      expect(callbacks.map((r) => r.status).sort()).toEqual([302, 400]);
      const code = new URL(
        callbacks.find((r) => r.status === 302).headers.get('Location')
      ).searchParams.get('code');
      const redeem = (proof) =>
        world.request('/v1/auth/token', {
          method: 'POST',
          body: JSON.stringify({ code, code_verifier: proof, redirect_uri: world.appRedirect }),
        });
      expect((await redeem(world.pkce().verifier)).status).toBe(400);
      const tokens = await Promise.all([redeem(verifier), redeem(verifier)]);
      expect(tokens.map((r) => r.status).sort()).toEqual([200, 400]);
      expect(world.env.DB.raw.prepare('SELECT * FROM sessions').all()).toHaveLength(1);
    });
    test('Google sign-in hands the app a session only for the matching verifier', async () => {
      const world = createWorld();
      world.googleUsers.set('g-code', {
        sub: 'google-1',
        email: 'Robert@Example.com',
        email_verified: true,
      });
      const { body, start, handoff, verifier } = await world.signIn('google', 'g-code');

      const google = new URL(start.headers.get('Location'));
      expect(google.origin).toBe('https://accounts.google.com');
      expect(google.searchParams.get('redirect_uri')).toBe(`${BASE}/v1/auth/callback/google`);
      expect(body.token).toMatch(/^hdws_/);
      expect(body.user.email).toBe('robert@example.com');
      // Only the token's hash is stored.
      const stored = world.env.DB.raw.prepare('SELECT token_hash FROM sessions').all();
      expect(stored).toHaveLength(1);
      expect(stored[0].token_hash).not.toContain(body.token);

      // The handoff code is single use.
      const replay = await world.request('/v1/auth/token', {
        method: 'POST',
        body: JSON.stringify({
          code: handoff,
          code_verifier: verifier,
          redirect_uri: world.appRedirect,
        }),
      });
      expect(replay.status).toBe(400);

      const account = await (await world.authed(body.token, '/v1/account')).json();
      expect(account).toMatchObject({
        user: { email: 'robert@example.com' },
        providers: ['google'],
        entitlement: { entitled: true, reason: 'trial' },
        billingAvailable: true,
      });
    });

    test('a stolen handoff code is useless without the verifier', async () => {
      const world = createWorld();
      world.googleUsers.set('g-code', { sub: 'google-1', email: 'a@b.c', email_verified: true });
      const { challenge } = world.pkce();
      const start = await world.request(
        `/v1/auth/start?${new URLSearchParams({
          provider: 'google',
          redirect_uri: world.appRedirect,
          state: 'app-state-0123456789',
          code_challenge: challenge,
          code_challenge_method: 'S256',
        })}`
      );
      const state = new URL(start.headers.get('Location')).searchParams.get('state');
      const callback = await world.request(`/v1/auth/callback/google?code=g-code&state=${state}`);
      const handoff = new URL(callback.headers.get('Location')).searchParams.get('code');
      const attempt = await world.request('/v1/auth/token', {
        method: 'POST',
        body: JSON.stringify({
          code: handoff,
          code_verifier: world.pkce().verifier,
          redirect_uri: world.appRedirect,
        }),
      });
      expect(attempt.status).toBe(400);
      expect(world.env.DB.raw.prepare('SELECT * FROM sessions').all()).toHaveLength(0);
    });

    test('only the app loopback callback and a proper PKCE challenge are accepted', async () => {
      const world = createWorld();
      const { challenge } = world.pkce();
      const start = (params) =>
        world.request(
          `/v1/auth/start?${new URLSearchParams({
            provider: 'google',
            redirect_uri: world.appRedirect,
            state: 'app-state-0123456789',
            code_challenge: challenge,
            code_challenge_method: 'S256',
            ...params,
          })}`
        );
      expect((await start({})).status).toBe(302);
      for (const redirectUri of [
        'https://evil.example/oauth/callback',
        'http://localhost:53123/oauth/callback',
        'http://127.0.0.1:80/oauth/callback',
        'http://127.0.0.1:53123/other',
        'http://127.0.0.1:53123/oauth/callback?x=1',
      ]) {
        expect((await start({ redirect_uri: redirectUri })).status).toBe(400);
      }
      expect((await start({ code_challenge_method: 'plain' })).status).toBe(400);
      expect((await start({ code_challenge: 'short' })).status).toBe(400);
      expect((await start({ provider: 'facebook' })).status).toBe(400);
      // An unconfigured provider is not offered.
      const noGithub = createWorld({ GITHUB_CLIENT_ID: '' });
      const config = await (await noGithub.request('/v1/config')).json();
      expect(config.providers).toEqual(['google']);
    });

    test('an expired or reused provider state is refused', async () => {
      const world = createWorld();
      world.googleUsers.set('g-code', { sub: 'google-1', email: 'a@b.c', email_verified: true });
      const { challenge } = world.pkce();
      const start = await world.request(
        `/v1/auth/start?${new URLSearchParams({
          provider: 'google',
          redirect_uri: world.appRedirect,
          state: 'app-state-0123456789',
          code_challenge: challenge,
          code_challenge_method: 'S256',
        })}`
      );
      const state = new URL(start.headers.get('Location')).searchParams.get('state');
      world.advance(11 * 60 * 1000);
      expect(
        (await world.request(`/v1/auth/callback/google?code=g-code&state=${state}`)).status
      ).toBe(400);
      expect(
        (await world.request(`/v1/auth/callback/google?code=g-code&state=${state}`)).status
      ).toBe(400);
    });

    test('a declined sign-in goes back to the app as an error', async () => {
      const world = createWorld();
      const { challenge } = world.pkce();
      const start = await world.request(
        `/v1/auth/start?${new URLSearchParams({
          provider: 'github',
          redirect_uri: world.appRedirect,
          state: 'app-state-0123456789',
          code_challenge: challenge,
          code_challenge_method: 'S256',
        })}`
      );
      const state = new URL(start.headers.get('Location')).searchParams.get('state');
      const back = await world.request(
        `/v1/auth/callback/github?error=access_denied&state=${state}`
      );
      const location = new URL(back.headers.get('Location'));
      expect(location.searchParams.get('error')).toBe('access_denied');
      expect(location.searchParams.get('state')).toBe('app-state-0123456789');
    });

    test('GitHub and Google with the same verified email share one account', async () => {
      const world = createWorld();
      world.googleUsers.set('g-code', { sub: 'google-1', email: 'me@x.io', email_verified: true });
      world.githubUsers.set('gh-code', {
        profile: { id: 42, login: 'me' },
        emails: [
          { email: 'old@x.io', primary: false, verified: true },
          { email: 'Me@X.io', primary: true, verified: true },
        ],
      });
      const google = await world.signIn('google', 'g-code');
      const github = await world.signIn('github', 'gh-code');
      expect(github.body.user.id).toBe(google.body.user.id);
      const account = await (await world.authed(github.body.token, '/v1/account')).json();
      expect(account.providers).toEqual(['google', 'github']);
    });

    test('an unverified email never joins an existing account', async () => {
      const world = createWorld();
      world.googleUsers.set('g-code', { sub: 'google-1', email: 'me@x.io', email_verified: true });
      world.githubUsers.set('gh-code', {
        profile: { id: 7, login: 'someone' },
        emails: [{ email: 'me@x.io', primary: true, verified: false }],
      });
      const google = await world.signIn('google', 'g-code');
      const github = await world.signIn('github', 'gh-code');
      expect(github.body.user.id).not.toBe(google.body.user.id);
    });

    test('two first sign-ins with one email at the same time make one account', async () => {
      const world = createWorld();
      const deps = { crypto, now: world.now };
      const users = () => world.env.DB.raw.prepare('SELECT id FROM users').all();
      // The GitHub sign-in looked for a user with this email just before the Google
      // sign-in created one.
      const prepare = world.env.DB.prepare;
      let staleLookups = 1;
      const env = {
        ...world.env,
        DB: {
          ...world.env.DB,
          prepare: (sql) => {
            const statement = prepare(sql);
            if (!sql.startsWith('SELECT id FROM users WHERE email') || staleLookups === 0) {
              return statement;
            }
            staleLookups -= 1;
            return { bind: () => ({ first: async () => null }) };
          },
        },
      };
      const google = await findOrCreateUser(world.env, deps, {
        provider: 'google',
        providerUserId: 'google-1',
        email: 'me@x.io',
      });
      const github = await findOrCreateUser(env, deps, {
        provider: 'github',
        providerUserId: '42',
        email: 'me@x.io',
      });
      expect(github).toBe(google);
      expect(users()).toHaveLength(1);
      expect(world.env.DB.raw.prepare('SELECT provider FROM identities').all()).toHaveLength(2);
    });

    test("a changed provider email becomes the account's email unless another account has it", async () => {
      const world = createWorld();
      world.googleUsers.set('g1', { sub: 'google-1', email: 'old@x.io', email_verified: true });
      world.googleUsers.set('g2', { sub: 'google-1', email: 'new@x.io', email_verified: true });
      world.googleUsers.set('o1', { sub: 'google-2', email: 'taken@x.io', email_verified: true });
      world.googleUsers.set('g3', { sub: 'google-1', email: 'taken@x.io', email_verified: true });
      const first = await world.signIn('google', 'g1');
      const renamed = await world.signIn('google', 'g2');
      expect(renamed.body.user).toEqual({ id: first.body.user.id, email: 'new@x.io' });

      const other = await world.signIn('google', 'o1');
      const clash = await world.signIn('google', 'g3');
      expect(clash.body.user).toEqual({ id: first.body.user.id, email: 'new@x.io' });
      expect(other.body.user.email).toBe('taken@x.io');
    });

    test('sessions end on sign-out and after long disuse', async () => {
      const world = createWorld();
      world.googleUsers.set('g1', { sub: 'google-1', email: 'a@b.c', email_verified: true });
      world.googleUsers.set('g2', { sub: 'google-1', email: 'a@b.c', email_verified: true });
      const first = await world.signIn('google', 'g1');
      const second = await world.signIn('google', 'g2');
      expect(
        (await world.authed(first.body.token, '/v1/auth/signout', { method: 'POST' })).status
      ).toBe(200);
      expect((await world.authed(first.body.token, '/v1/account')).status).toBe(401);
      expect((await world.authed(second.body.token, '/v1/account')).status).toBe(200);
      world.advance(181 * DAY);
      expect((await world.authed(second.body.token, '/v1/account')).status).toBe(401);
      expect((await world.request('/v1/account')).status).toBe(401);
    });
  });

  describe('profile storage', () => {
    async function signedIn(envOverrides) {
      const world = createWorld(envOverrides);
      world.googleUsers.set('g-code', { sub: 'google-1', email: 'a@b.c', email_verified: true });
      const { body } = await world.signIn('google', 'g-code');
      return { world, token: body.token };
    }

    test('writes are compare-and-swap on the revision', async () => {
      const { world, token } = await signedIn();
      expect((await world.authed(token, '/v1/profile')).status).toBe(404);

      const put = (headers, body = envelope()) =>
        world.authed(token, '/v1/profile', { method: 'PUT', headers, body });
      expect((await put({})).status).toBe(428);

      const created = await put({ 'If-None-Match': '*' });
      expect(created.status).toBe(200);
      expect(created.headers.get('ETag')).toBe('"1"');
      expect((await put({ 'If-None-Match': '*' })).status).toBe(412);

      const updated = await put({ 'If-Match': '"1"' }, envelope({ updatedByDeviceId: 'b' }));
      expect(updated.headers.get('ETag')).toBe('"2"');
      const stale = await put({ 'If-Match': '"1"' });
      expect(stale.status).toBe(412);
      expect(stale.headers.get('ETag')).toBe('"2"');

      const read = await world.authed(token, '/v1/profile');
      expect(read.headers.get('ETag')).toBe('"2"');
      expect(JSON.parse(await read.text()).updatedByDeviceId).toBe('b');
      const notModified = await world.authed(token, '/v1/profile', {
        headers: { 'If-None-Match': '"2"' },
      });
      expect(notModified.status).toBe(304);
    });

    test('stores an encrypted file exactly as sent and refuses what is not a sync file', async () => {
      const { world, token } = await signedIn();
      const encrypted = envelope({
        payload: { encrypted: true, algorithm: 'aes-256-gcm', ciphertext: 'abc' },
      });
      await world.authed(token, '/v1/profile', {
        method: 'PUT',
        headers: { 'If-None-Match': '*' },
        body: encrypted,
      });
      expect(await (await world.authed(token, '/v1/profile')).text()).toBe(encrypted);

      const put = (body) =>
        world.authed(token, '/v1/profile', {
          method: 'PUT',
          headers: { 'If-Match': '"1"' },
          body,
        });
      expect((await put('not json')).status).toBe(400);
      expect((await put('[]')).status).toBe(400);
      expect((await put('{"payload":{}}')).status).toBe(400);
      expect((await put(envelope({ padding: 'x'.repeat(513 * 1024) }))).status).toBe(413);
    });

    test('after the trial a subscription is needed to save, but reading still works', async () => {
      const { world, token } = await signedIn();
      await world.authed(token, '/v1/profile', {
        method: 'PUT',
        headers: { 'If-None-Match': '*' },
        body: envelope(),
      });
      world.advance(15 * DAY);
      const blocked = await world.authed(token, '/v1/profile', {
        method: 'PUT',
        headers: { 'If-Match': '"1"' },
        body: envelope(),
      });
      expect(blocked.status).toBe(402);
      expect((await world.authed(token, '/v1/profile')).status).toBe(200);
      const account = await (await world.authed(token, '/v1/account')).json();
      expect(account.entitlement).toMatchObject({ entitled: false, reason: 'none' });
    });

    test('open mode lets every signed-in account save', async () => {
      const { world, token } = await signedIn({ ENTITLEMENT_MODE: 'open', TRIAL_DAYS: '0' });
      const put = await world.authed(token, '/v1/profile', {
        method: 'PUT',
        headers: { 'If-None-Match': '*' },
        body: envelope(),
      });
      expect(put.status).toBe(200);
    });
  });

  describe('billing', () => {
    async function signedIn() {
      const world = createWorld({ TRIAL_DAYS: '0' });
      world.googleUsers.set('g-code', { sub: 'google-1', email: 'a@b.c', email_verified: true });
      const { body } = await world.signIn('google', 'g-code');
      return { world, token: body.token, userId: body.user.id };
    }

    const subscriptionEvent = (type, userId, status, created, extra = {}) => ({
      type,
      created,
      data: {
        object: {
          id: 'sub_1',
          customer: 'cus_1',
          status,
          metadata: { user_id: userId },
          items: { data: [{ current_period_end: 1893456000 }] },
          ...extra,
        },
      },
    });

    // What Stripe reports for the subscription now, which the service reads on every event.
    const setLiveSubscription = (world, userId, status, extra = {}) => {
      const subscription = subscriptionEvent('', userId, status, 0, extra).data.object;
      world.stripe.subscriptions.set(subscription.id, subscription);
    };

    test('checkout starts a yearly subscription for this user', async () => {
      const { world, token, userId } = await signedIn();
      const response = await world.authed(token, '/v1/billing/checkout', { method: 'POST' });
      expect(await response.json()).toEqual({ url: 'https://checkout.stripe.test/session' });
      const call = world.calls.find((entry) => entry.url.endsWith('/checkout/sessions'));
      const params = new URLSearchParams(call.body);
      expect(params.get('mode')).toBe('subscription');
      expect(params.get('line_items[0][price]')).toBe('price_yearly');
      expect(params.get('client_reference_id')).toBe(userId);
      expect(params.get('subscription_data[metadata][user_id]')).toBe(userId);
      expect(params.get('customer_email')).toBe('a@b.c');
      expect(params.has('automatic_tax[enabled]')).toBe(false);
      expect(call.headers.Authorization).toBe('Bearer sk_test');
    });

    test('checkout retries reuse one payment page and simultaneous requests cannot create two', async () => {
      const { world, token } = await signedIn();
      const start = () => world.authed(token, '/v1/billing/checkout', { method: 'POST' });
      const concurrent = await Promise.all([start(), start()]);
      expect(concurrent.some((r) => r.status === 200)).toBe(true);
      expect(concurrent.every((r) => r.status === 200 || r.status === 409)).toBe(true);
      expect((await start()).status).toBe(200);
      expect(world.calls.filter((call) => call.url.endsWith('/checkout/sessions'))).toHaveLength(1);
      expect(world.stripe.checkouts.size).toBe(1);
    });

    test('a lost Stripe response is retried with the same idempotency key', async () => {
      const { world, token } = await signedIn();
      const fetch = world.deps.fetch;
      let drop = true;
      world.deps.fetch = async (...args) => {
        const response = await fetch(...args);
        if (args[0].endsWith('/checkout/sessions') && drop) {
          drop = false;
          throw new Error('Connection lost after creation');
        }
        return response;
      };
      const start = () => world.authed(token, '/v1/billing/checkout', { method: 'POST' });
      expect((await start()).status).toBe(502);
      expect((await start()).status).toBe(200);
      const calls = world.calls.filter((call) => call.url.endsWith('/checkout/sessions'));
      expect(calls).toHaveLength(2);
      expect(calls[0].headers['Idempotency-Key']).toBe(calls[1].headers['Idempotency-Key']);
      expect(calls[0].body).toBe(calls[1].body);
      expect(world.stripe.checkouts.size).toBe(1);
    });

    test('account deletion expires unpaid checkout and keeps the account if expiry fails', async () => {
      const { world, token } = await signedIn();
      await world.authed(token, '/v1/billing/checkout', { method: 'POST' });
      world.stripe.failExpire = true;
      expect((await world.authed(token, '/v1/account', { method: 'DELETE' })).status).toBe(502);
      expect(world.env.DB.raw.prepare('SELECT * FROM users').all()).toHaveLength(1);
      world.stripe.failExpire = false;
      expect((await world.authed(token, '/v1/account', { method: 'DELETE' })).status).toBe(200);
      expect(world.stripe.checkouts.get('cs_1').status).toBe('expired');
      expect(world.env.DB.raw.prepare('SELECT * FROM billing_checkouts').all()).toHaveLength(0);
    });

    test('account deletion cancels a completed checkout before its webhook arrives', async () => {
      const { world, token } = await signedIn();
      await world.authed(token, '/v1/billing/checkout', { method: 'POST' });
      Object.assign(world.stripe.checkouts.get('cs_1'), {
        status: 'complete',
        subscription: 'sub_awaiting_webhook',
      });
      expect((await world.authed(token, '/v1/billing/checkout', { method: 'POST' })).status).toBe(
        409
      );
      expect((await world.authed(token, '/v1/account', { method: 'DELETE' })).status).toBe(200);
      expect(
        world.calls.some(
          (call) =>
            call.method === 'DELETE' && call.url.endsWith('/subscriptions/sub_awaiting_webhook')
        )
      ).toBe(true);
    });

    test('account deletion cannot race a checkout being created', async () => {
      const { world, token } = await signedIn();
      let ready;
      let release;
      const paused = new Promise((resolve) => {
        ready = resolve;
      });
      const resumed = new Promise((resolve) => {
        release = resolve;
      });
      const fetch = world.deps.fetch;
      world.deps.fetch = async (...args) => {
        if (args[0].endsWith('/checkout/sessions')) {
          ready();
          await resumed;
        }
        return fetch(...args);
      };
      const checkout = world.authed(token, '/v1/billing/checkout', { method: 'POST' });
      await paused;
      expect((await world.authed(token, '/v1/account', { method: 'DELETE' })).status).toBe(409);
      release();
      expect((await checkout).status).toBe(200);
      expect((await world.authed(token, '/v1/account', { method: 'DELETE' })).status).toBe(200);
      expect(world.stripe.checkouts.get('cs_1').status).toBe('expired');
    });

    test('account deletion confirms cancellation after a lost Stripe reply', async () => {
      const { world, token, userId } = await signedIn();
      await world.sendWebhook(
        subscriptionEvent('customer.subscription.created', userId, 'active', 1)
      );
      const fetch = world.deps.fetch;
      world.deps.fetch = async (...args) => {
        const response = await fetch(...args);
        if (args[1]?.method === 'DELETE') throw new Error('Cancellation reply lost');
        return response;
      };
      expect((await world.authed(token, '/v1/account', { method: 'DELETE' })).status).toBe(200);
      expect(
        world.calls.some(
          (call) => call.method === 'GET' && call.url.endsWith('/subscriptions/sub_1')
        )
      ).toBe(true);
      expect(world.env.DB.raw.prepare('SELECT * FROM users').all()).toHaveLength(0);
    });

    test('Stripe Tax requires an address when enabled for a new subscriber', async () => {
      const world = createWorld({ STRIPE_AUTOMATIC_TAX: 'true' });
      world.googleUsers.set('tax-code', {
        sub: 'google-tax',
        email: 'tax@b.c',
        email_verified: true,
      });
      const { body } = await world.signIn('google', 'tax-code');
      await world.authed(body.token, '/v1/billing/checkout', { method: 'POST' });
      const call = world.calls.find((entry) => entry.url.endsWith('/checkout/sessions'));
      const params = new URLSearchParams(call.body);
      expect(params.get('automatic_tax[enabled]')).toBe('true');
      expect(params.get('billing_address_collection')).toBe('required');
      expect(params.has('customer_update[address]')).toBe(false);
    });

    test('Stripe Tax updates an existing customer address during checkout', async () => {
      const world = createWorld({ STRIPE_AUTOMATIC_TAX: 'true' });
      world.googleUsers.set('return-code', {
        sub: 'google-return',
        email: 'return@b.c',
        email_verified: true,
      });
      const { body } = await world.signIn('google', 'return-code');
      await world.env.DB.prepare(
        'INSERT INTO subscriptions (user_id, stripe_customer_id, updated_at) VALUES (?, ?, ?)'
      )
        .bind(body.user.id, 'cus_existing', world.now())
        .run();
      await world.authed(body.token, '/v1/billing/checkout', { method: 'POST' });
      const call = world.calls.find((entry) => entry.url.endsWith('/checkout/sessions'));
      const params = new URLSearchParams(call.body);
      expect(params.get('customer')).toBe('cus_existing');
      expect(params.get('customer_update[address]')).toBe('auto');
    });

    test('a signed subscription event unlocks saving, and a late older event cannot undo it', async () => {
      const { world, token, userId } = await signedIn();
      const save = () =>
        world.authed(token, '/v1/profile', {
          method: 'PUT',
          headers: { 'If-None-Match': '*' },
          body: envelope(),
        });
      expect((await save()).status).toBe(402);

      const t = Math.floor(world.now() / 1000);
      setLiveSubscription(world, userId, 'active');
      expect(
        (
          await world.sendWebhook({
            type: 'checkout.session.completed',
            created: t + 1,
            data: {
              object: {
                mode: 'subscription',
                client_reference_id: userId,
                customer: 'cus_1',
                subscription: 'sub_1',
              },
            },
          })
        ).status
      ).toBe(200);
      await world.sendWebhook(
        subscriptionEvent('customer.subscription.updated', userId, 'active', t + 2)
      );
      // Delivered late: created before the update.
      await world.sendWebhook(
        subscriptionEvent('customer.subscription.created', userId, 'incomplete', t)
      );
      expect((await save()).status).toBe(200);
      const account = await (await world.authed(token, '/v1/account')).json();
      expect(account.entitlement).toMatchObject({
        entitled: true,
        reason: 'subscription',
        subscriptionStatus: 'active',
        currentPeriodEnd: 1893456000 * 1000,
        hasBillingAccount: true,
      });
      const portal = await world.authed(token, '/v1/billing/portal', { method: 'POST' });
      expect(await portal.json()).toEqual({ url: 'https://billing.stripe.test/portal' });

      setLiveSubscription(world, userId, 'canceled');
      await world.sendWebhook(
        subscriptionEvent('customer.subscription.deleted', userId, 'canceled', t + 3)
      );
      const after = await (await world.authed(token, '/v1/account')).json();
      expect(after.entitlement).toMatchObject({ entitled: false, subscriptionStatus: 'canceled' });
    });

    test('webhooks with a wrong or stale signature are rejected', async () => {
      const { world, userId } = await signedIn();
      const event = subscriptionEvent('customer.subscription.updated', userId, 'active', 1);
      expect((await world.sendWebhook(event, { secret: 'whsec_other' })).status).toBe(400);
      expect((await world.sendWebhook(event, { at: world.now() - 10 * 60 * 1000 })).status).toBe(
        400
      );
      expect(world.env.DB.raw.prepare('SELECT * FROM subscriptions').all()).toHaveLength(0);
    });

    test('an older webhook write cannot overwrite a newer concurrent update', async () => {
      const { world, userId } = await signedIn();
      const t = Math.floor(world.now() / 1000);
      let releaseOld;
      let oldReady;
      const paused = new Promise((resolve) => {
        oldReady = resolve;
      });
      const release = new Promise((resolve) => {
        releaseOld = resolve;
      });
      const prepare = world.env.DB.prepare;
      world.env.DB.prepare = (sql) => {
        const stmt = prepare(sql);
        if (!sql.includes('INSERT INTO subscriptions')) return stmt;
        return {
          bind: (...args) => {
            const bound = stmt.bind(...args);
            return {
              ...bound,
              run: async () => {
                if (args[5] === t) {
                  oldReady();
                  await release;
                }
                return bound.run();
              },
            };
          },
        };
      };
      const older = world.sendWebhook(
        subscriptionEvent('customer.subscription.created', userId, 'incomplete', t)
      );
      await paused;
      await world.sendWebhook(
        subscriptionEvent('customer.subscription.updated', userId, 'active', t + 1)
      );
      releaseOld();
      await older;
      expect(world.env.DB.raw.prepare('SELECT status FROM subscriptions').get().status).toBe(
        'active'
      );
    });

    test('a same-second update cannot revive a canceled subscription', async () => {
      const { world, userId } = await signedIn();
      const t = Math.floor(world.now() / 1000);
      setLiveSubscription(world, userId, 'canceled');
      await world.sendWebhook(
        subscriptionEvent('customer.subscription.deleted', userId, 'canceled', t)
      );
      await world.sendWebhook(
        subscriptionEvent('customer.subscription.updated', userId, 'active', t)
      );
      expect(world.env.DB.raw.prepare('SELECT status FROM subscriptions').get().status).toBe(
        'canceled'
      );
    });

    test('a late cancellation for an old subscription cannot cancel its replacement', async () => {
      const { world, userId } = await signedIn();
      const t = Math.floor(world.now() / 1000);
      setLiveSubscription(world, userId, 'active', { id: 'sub_new' });
      setLiveSubscription(world, userId, 'canceled', { id: 'sub_old' });
      await world.sendWebhook(
        subscriptionEvent('customer.subscription.updated', userId, 'active', t, { id: 'sub_new' })
      );
      await world.sendWebhook(
        subscriptionEvent('customer.subscription.deleted', userId, 'canceled', t + 1, {
          id: 'sub_old',
        })
      );
      expect(
        world.env.DB.raw.prepare('SELECT status, stripe_subscription_id FROM subscriptions').get()
      ).toMatchObject({ status: 'active', stripe_subscription_id: 'sub_new' });
    });

    test('same-second events in either order leave the status Stripe reports now', async () => {
      const { world, token, userId } = await signedIn();
      const t = Math.floor(world.now() / 1000);
      setLiveSubscription(world, userId, 'active');
      // Stripe created the subscription incomplete and activated it within the same second,
      // and delivered the activation first.
      await world.sendWebhook(
        subscriptionEvent('customer.subscription.updated', userId, 'active', t)
      );
      await world.sendWebhook(
        subscriptionEvent('customer.subscription.created', userId, 'incomplete', t)
      );
      const account = await (await world.authed(token, '/v1/account')).json();
      expect(account.entitlement).toMatchObject({
        entitled: true,
        reason: 'subscription',
        subscriptionStatus: 'active',
        currentPeriodEnd: 1893456000 * 1000,
      });
    });

    test('a webhook that cannot read the subscription asks Stripe to send it again', async () => {
      const { world, userId } = await signedIn();
      setLiveSubscription(world, userId, 'active');
      world.stripe.failRead = true;
      const event = subscriptionEvent('customer.subscription.updated', userId, 'active', 1);
      expect((await world.sendWebhook(event)).status).toBe(500);
      expect(world.env.DB.raw.prepare('SELECT * FROM subscriptions').all()).toHaveLength(0);
      world.stripe.failRead = false;
      expect((await world.sendWebhook(event)).status).toBe(200);
      expect(world.env.DB.raw.prepare('SELECT status FROM subscriptions').get().status).toBe(
        'active'
      );
    });

    test('a paid Checkout whose webhooks were lost is recorded when the app asks', async () => {
      const { world, token, userId } = await signedIn();
      await world.authed(token, '/v1/billing/checkout', { method: 'POST' });
      // Paid, but no webhook ever arrives.
      Object.assign(world.stripe.checkouts.get('cs_1'), {
        status: 'complete',
        subscription: 'sub_1',
      });
      setLiveSubscription(world, userId, 'active');

      const account = await (await world.authed(token, '/v1/account')).json();
      expect(account.entitlement).toMatchObject({
        entitled: true,
        reason: 'subscription',
        subscriptionStatus: 'active',
        hasBillingAccount: true,
      });
      // Settled once: the next request does not ask Stripe about the Checkout again.
      expect(world.env.DB.raw.prepare('SELECT * FROM billing_checkouts').all()).toHaveLength(0);
      const checkoutReads = () =>
        world.calls.filter((call) => call.url.includes('/checkout/sessions/cs_1')).length;
      const before = checkoutReads();
      await world.authed(token, '/v1/account');
      expect(checkoutReads()).toBe(before);
    });

    test('an unpaid Checkout leaves the account as it was', async () => {
      const { world, token } = await signedIn();
      await world.authed(token, '/v1/billing/checkout', { method: 'POST' });
      const account = await (await world.authed(token, '/v1/account')).json();
      expect(account.entitlement).toMatchObject({ entitled: false, reason: 'none' });
      expect(world.env.DB.raw.prepare('SELECT * FROM billing_checkouts').all()).toHaveLength(1);
    });

    test('checkout settles a paid page whose webhook was lost instead of waiting forever', async () => {
      const { world, token, userId } = await signedIn();
      await world.authed(token, '/v1/billing/checkout', { method: 'POST' });
      Object.assign(world.stripe.checkouts.get('cs_1'), {
        status: 'complete',
        subscription: 'sub_1',
      });
      setLiveSubscription(world, userId, 'active');
      const again = await world.authed(token, '/v1/billing/checkout', { method: 'POST' });
      expect(again.status).toBe(409);
      expect((await again.json()).error).toBe('subscription_exists');
      expect(world.env.DB.raw.prepare('SELECT status FROM subscriptions').get().status).toBe(
        'active'
      );
    });

    test('an existing subscription cannot start another checkout', async () => {
      const { world, token, userId } = await signedIn();
      await world.sendWebhook(
        subscriptionEvent('customer.subscription.created', userId, 'active', 1)
      );
      expect((await world.authed(token, '/v1/billing/checkout', { method: 'POST' })).status).toBe(
        409
      );
      expect(world.calls.some((call) => call.url.endsWith('/checkout/sessions'))).toBe(false);
    });

    test('account deletion cancels even while the subscription status webhook is pending', async () => {
      const { world, token, userId } = await signedIn();
      await world.sendWebhook({
        type: 'checkout.session.completed',
        created: 1,
        data: {
          object: {
            mode: 'subscription',
            client_reference_id: userId,
            customer: 'cus_pending',
            subscription: 'sub_pending',
          },
        },
      });
      world.stripe.failCancel = true;
      expect((await world.authed(token, '/v1/account', { method: 'DELETE' })).status).toBe(502);
      expect(world.env.DB.raw.prepare('SELECT * FROM users').all()).toHaveLength(1);
      world.stripe.failCancel = false;
      expect((await world.authed(token, '/v1/account', { method: 'DELETE' })).status).toBe(200);
      expect(world.calls.some((call) => call.url.endsWith('/subscriptions/sub_pending'))).toBe(
        true
      );
    });

    test('billing reports itself unavailable until it is configured', async () => {
      const world = createWorld({ STRIPE_SECRET_KEY: '', STRIPE_WEBHOOK_SECRET: '' });
      world.googleUsers.set('g-code', { sub: 'google-1', email: 'a@b.c', email_verified: true });
      const { body } = await world.signIn('google', 'g-code');
      expect(
        (await world.authed(body.token, '/v1/billing/checkout', { method: 'POST' })).status
      ).toBe(501);
      expect((await world.request('/v1/billing/webhook', { method: 'POST' })).status).toBe(501);
      expect((await (await world.request('/v1/config')).json()).billingAvailable).toBe(false);
    });

    test('checkout remains disabled without webhook verification configured', async () => {
      const world = createWorld({ STRIPE_WEBHOOK_SECRET: '' });
      world.googleUsers.set('g-code', { sub: 'google-1', email: 'a@b.c', email_verified: true });
      const { body } = await world.signIn('google', 'g-code');
      expect(
        (await world.authed(body.token, '/v1/billing/checkout', { method: 'POST' })).status
      ).toBe(501);
      expect((await (await world.request('/v1/config')).json()).billingAvailable).toBe(false);
      expect((await (await world.authed(body.token, '/v1/account')).json()).billingAvailable).toBe(
        false
      );
      expect(world.calls.some((call) => call.url.endsWith('/checkout/sessions'))).toBe(false);
    });

    test('deleting the account cancels the subscription first and removes everything', async () => {
      const { world, token, userId } = await signedIn();
      const t = Math.floor(world.now() / 1000);
      await world.sendWebhook(
        subscriptionEvent('customer.subscription.created', userId, 'active', t)
      );
      await world.authed(token, '/v1/profile', {
        method: 'PUT',
        headers: { 'If-None-Match': '*' },
        body: envelope(),
      });

      world.stripe.failCancel = true;
      expect((await world.authed(token, '/v1/account', { method: 'DELETE' })).status).toBe(502);
      expect(world.env.DB.raw.prepare('SELECT * FROM profiles').all()).toHaveLength(1);

      world.stripe.failCancel = false;
      expect((await world.authed(token, '/v1/account', { method: 'DELETE' })).status).toBe(200);
      expect(
        world.calls.some(
          (entry) => entry.method === 'DELETE' && entry.url.endsWith('/subscriptions/sub_1')
        )
      ).toBe(true);
      for (const table of ['users', 'identities', 'sessions', 'profiles', 'subscriptions']) {
        expect(world.env.DB.raw.prepare(`SELECT * FROM ${table}`).all()).toHaveLength(0);
      }
      expect((await world.authed(token, '/v1/account')).status).toBe(401);
    });
  });

  test('encodes nested Stripe parameters', () => {
    expect(
      encodeStripeParams({ a: 1, b: [{ c: 'd' }], e: { f: { g: true } }, h: null }).toString()
    ).toBe('a=1&b%5B0%5D%5Bc%5D=d&e%5Bf%5D%5Bg%5D=true');
  });

  test('body limits stop an oversized undeclared stream before reading it all', async () => {
    let cancelled = false;
    let chunks = 0;
    const body = new ReadableStream({
      pull(controller) {
        chunks += 1;
        controller.enqueue(new Uint8Array(8));
      },
      cancel() {
        cancelled = true;
      },
    });
    expect(
      await readTextBody(new Request(BASE, { method: 'POST', body, duplex: 'half' }), 10)
    ).toBeNull();
    expect(cancelled).toBe(true);
    expect(chunks).toBeLessThan(5);
    const bytes = new TextEncoder().encode('a€b');
    const split = new ReadableStream({
      start(controller) {
        controller.enqueue(bytes.slice(0, 2));
        controller.enqueue(bytes.slice(2));
        controller.close();
      },
    });
    expect(
      await readTextBody(new Request(BASE, { method: 'POST', body: split, duplex: 'half' }), 5)
    ).toBe('a€b');
  });

  test('unknown routes are not found and pages carry safe headers', async () => {
    const world = createWorld();
    expect((await world.request('/nope')).status).toBe(404);
    const home = await world.request('/');
    expect(home.headers.get('Content-Security-Policy')).toContain("default-src 'none'");
    expect((await world.request('/billing/done?result=success')).status).toBe(200);
    expect(await (await world.request('/v1/health')).json()).toEqual({ ok: true });
  });
});

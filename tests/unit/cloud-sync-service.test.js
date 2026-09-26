/**
 * @jest-environment node
 */

// Runs the Cloud Sync Worker end to end (see tests/helpers/cloud-sync-world.js).

const { encodeStripeParams } = require('../../cloud-sync-service/src/billing.js');
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
  describe('sign-in', () => {
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
      expect(call.headers.Authorization).toBe('Bearer sk_test');
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

  test('unknown routes are not found and pages carry safe headers', async () => {
    const world = createWorld();
    expect((await world.request('/nope')).status).toBe(404);
    const home = await world.request('/');
    expect(home.headers.get('Content-Security-Policy')).toContain("default-src 'none'");
    expect((await world.request('/billing/done?result=success')).status).toBe(200);
    expect(await (await world.request('/v1/health')).json()).toEqual({ ok: true });
  });
});

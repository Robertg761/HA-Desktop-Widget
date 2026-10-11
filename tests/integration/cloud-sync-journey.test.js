/**
 * @jest-environment node
 */

// Cloud Sync from a user's side, start to finish: two computers signed in to one account,
// through the trial, a subscription, sign-out and account deletion. Everything real runs:
// the Worker over its migrations, the desktop client, the sync engine and the Settings
// handlers from main.js. Only Google sign-in and Stripe are faked
// (tests/helpers/cloud-sync-world.js).

const fs = require('fs');
const path = require('path');
const { createProfileSyncHarness } = require('../helpers/profile-sync-devices.js');
const { DAY, createSignedInClient, createWorld } = require('../helpers/cloud-sync-world.js');

const harness = createProfileSyncHarness();
beforeEach(() => harness.setup());
afterEach(() => harness.teardown());

test('two computers go from a free trial through a subscription to a deleted account', async () => {
  const world = createWorld();
  world.googleUsers.set('g-code', { sub: 'google-1', email: 'me@x.io', email_verified: true });
  const opened = [];
  const clientFor = async (name) => {
    const userDataPath = path.join(harness.tempRoot(), `${name}-cloud`);
    fs.mkdirSync(userDataPath);
    const client = await createSignedInClient(world, { userDataPath });
    // Keeps the scripted browser for sign-in and records every page the app opens.
    const browser = client.openExternal;
    client.openExternal = async (url) => {
      opened.push(url);
      return browser(url);
    };
    return client;
  };
  const device = (name, cloudClient) =>
    harness.createDevice(name, { cloudClient, profileSync: { provider: 'hostedAccount' } });
  const stored = () => {
    const row = world.env.DB.raw.prepare('SELECT revision, body FROM profiles').get();
    return row ? { revision: row.revision, envelope: JSON.parse(row.body) } : null;
  };
  const storedSection = (key) => stored().envelope.payload.sections[key].data;
  const count = (table) => world.env.DB.raw.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get().n;
  const account = async (dev) => (await dev.invoke('get-cloud-sync-account')).account;

  // Both computers sign in with the same Google account and turn on Cloud Sync.
  const desktop = device('desktop', await clientFor('desktop'));
  const laptop = device('laptop', await clientFor('laptop'));
  await desktop.sync();
  await laptop.sync();
  expect(count('users')).toBe(1);
  expect(stored().revision).toBeGreaterThanOrEqual(1);
  const userId = world.env.DB.raw.prepare('SELECT id FROM users').get().id;
  expect(await account(desktop)).toMatchObject({ entitled: true, entitlementReason: 'trial' });

  // Edits travel both ways.
  laptop.edit((config) => {
    config.opacity = 0.7;
  });
  await laptop.sync();
  await desktop.sync();
  expect(desktop.config.opacity).toBe(0.7);
  desktop.edit((config) => {
    config.favoriteEntities = ['light.kitchen', 'light.porch'];
  });
  await desktop.sync();
  await laptop.sync();
  expect(laptop.config.favoriteEntities).toEqual(['light.kitchen', 'light.porch']);

  // Edits made on both computers before either syncs are merged.
  laptop.edit((config) => {
    config.opacity = 0.6;
  });
  desktop.edit((config) => {
    config.favoriteEntities = ['light.kitchen', 'light.porch', 'switch.coffee'];
  });
  await laptop.sync();
  await desktop.sync();
  await laptop.sync();
  expect(storedSection('visualPersonalization').opacity).toBe(0.6);
  expect(storedSection('quickAccessLayout').favoriteEntities).toContain('switch.coffee');
  expect(desktop.config.opacity).toBe(0.6);
  expect(laptop.config.favoriteEntities).toContain('switch.coffee');

  // The trial ends: the computer keeps its edit but the service is not changed.
  const beforeExpiry = stored().revision;
  world.advance(15 * DAY);
  desktop.edit((config) => {
    config.opacity = 0.45;
  });
  expect((await desktop.sync()).reason).toBe('subscription_required');
  expect(stored().revision).toBe(beforeExpiry);
  expect(desktop.config.opacity).toBe(0.45);
  expect(desktop.status().lastSyncError).toBe(
    'Cloud Sync needs a subscription to save changes. Changes from your other computers still download.'
  );
  expect((await account(desktop)).entitlementReason).toBe('none');

  // Subscribe opens Stripe Checkout. Stripe takes the payment but no webhook ever arrives:
  // the account still shows as subscribed when the app asks again, and the held edit syncs.
  expect(await desktop.invoke('cloud-sync-open-billing')).toMatchObject({
    success: true,
    opened: 'checkout',
  });
  expect(new URL(opened.at(-1)).hostname).toBe('checkout.stripe.com');
  Object.assign(world.stripe.checkouts.get('cs_1'), { status: 'complete', subscription: 'sub_1' });
  world.stripe.subscriptions.set('sub_1', {
    id: 'sub_1',
    customer: 'cus_1',
    status: 'active',
    metadata: { user_id: userId },
    items: { data: [{ current_period_end: Math.floor(world.now() / 1000) + 365 * 86400 }] },
  });
  expect(await account(desktop)).toMatchObject({
    entitled: true,
    entitlementReason: 'subscription',
    subscriptionStatus: 'active',
  });
  await desktop.sync();
  expect(storedSection('visualPersonalization').opacity).toBe(0.45);
  await laptop.sync();
  expect(laptop.config.opacity).toBe(0.45);

  // Stripe's webhooks then arrive late and in the wrong order: the subscription stays active.
  const created = Math.floor(world.now() / 1000);
  const subscriptionEvent = (type, status) => ({
    type,
    created,
    data: { object: { id: 'sub_1', customer: 'cus_1', status, metadata: { user_id: userId } } },
  });
  expect(
    (await world.sendWebhook(subscriptionEvent('customer.subscription.updated', 'active'))).status
  ).toBe(200);
  expect(
    (await world.sendWebhook(subscriptionEvent('customer.subscription.created', 'incomplete')))
      .status
  ).toBe(200);
  expect((await account(laptop)).subscriptionStatus).toBe('active');

  // Manage subscription opens Stripe's customer portal.
  expect(await desktop.invoke('cloud-sync-open-billing')).toMatchObject({
    success: true,
    opened: 'portal',
  });
  expect(new URL(opened.at(-1)).hostname).toBe('billing.stripe.com');

  // Signing out stops sync and says why; signing back in carries on without starting over.
  await laptop.invoke('cloud-sync-sign-out');
  await expect(laptop.sync()).rejects.toThrow('Sign in to Cloud Sync to keep syncing');
  expect((await laptop.invoke('cloud-sync-sign-in', 'google')).success).toBe(true);
  expect(laptop.config.profileSync.firstEnableResolutionPending).not.toBe(true);
  desktop.edit((config) => {
    config.opacity = 0.55;
  });
  await desktop.sync();
  await laptop.sync();
  expect(laptop.config.opacity).toBe(0.55);

  // Deleting the account cancels the subscription first, removes everything stored for it,
  // keeps this computer's settings, and signs the other computer out.
  expect((await desktop.invoke('cloud-sync-delete-account')).success).toBe(true);
  expect(world.stripe.subscriptions.get('sub_1').status).toBe('canceled');
  expect(count('users')).toBe(0);
  expect(count('profiles')).toBe(0);
  expect(desktop.config.opacity).toBe(0.55);
  await expect(laptop.sync()).rejects.toThrow(/Sign in to Cloud Sync/);

  // Signing up again with the same Google account does not start a second free trial.
  const again = await clientFor('desktop-again');
  expect((await again.getAccount()).entitled).toBe(false);
});

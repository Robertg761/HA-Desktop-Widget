import {
  errorResponse,
  hmacSha256Hex,
  isAllowedEmail,
  json,
  randomToken,
  sha256Hex,
} from './util.js';

const DAY_MS = 24 * 60 * 60 * 1000;
// A session unused for this long stops working; signing in again replaces it.
export const SESSION_IDLE_LIMIT_MS = 180 * DAY_MS;
// last_used_at is refreshed at most this often, so reads do not all become writes.
const SESSION_TOUCH_INTERVAL_MS = DAY_MS;
const SESSION_TOKEN_PREFIX = 'hdws_';
const ENTITLED_STATUSES = new Set(['active', 'trialing', 'past_due']);

export async function createSession(env, deps, userId, deviceName) {
  const token = `${SESSION_TOKEN_PREFIX}${randomToken(deps.crypto)}`;
  const now = deps.now();
  await env.DB.prepare(
    'INSERT INTO sessions (token_hash, user_id, device_name, created_at, last_used_at) VALUES (?, ?, ?, ?, ?)'
  )
    .bind(await sha256Hex(deps.crypto, token), userId, deviceName || null, now, now)
    .run();
  return token;
}

/**
 * Resolves the bearer token on a request to its session, or returns null. The
 * token itself is never stored, only its hash.
 */
export async function authenticate(request, env, deps) {
  const header = request.headers.get('Authorization') || '';
  const match = /^Bearer\s+(\S+)$/i.exec(header);
  if (!match || !match[1].startsWith(SESSION_TOKEN_PREFIX) || match[1].length > 128) return null;
  const tokenHash = await sha256Hex(deps.crypto, match[1]);
  const session = await env.DB.prepare(
    'SELECT s.token_hash, s.user_id, s.last_used_at, u.email, u.created_at AS user_created_at FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token_hash = ?'
  )
    .bind(tokenHash)
    .first();
  if (!session) return null;
  if (!isAllowedEmail(env, session.email)) return null;
  const now = deps.now();
  if (now - session.last_used_at > SESSION_IDLE_LIMIT_MS) {
    await env.DB.prepare('DELETE FROM sessions WHERE token_hash = ?').bind(tokenHash).run();
    return null;
  }
  if (now - session.last_used_at > SESSION_TOUCH_INTERVAL_MS) {
    await env.DB.prepare('UPDATE sessions SET last_used_at = ? WHERE token_hash = ?')
      .bind(now, tokenHash)
      .run();
  }
  return {
    tokenHash,
    userId: session.user_id,
    email: session.email,
    userCreatedAt: session.user_created_at,
  };
}

export function unauthorized() {
  return errorResponse(401, 'unauthorized', 'Sign in again to keep syncing.', {
    'WWW-Authenticate': 'Bearer',
  });
}

function trialDays(env) {
  const days = Number(env.TRIAL_DAYS);
  return Number.isFinite(days) && days >= 0 ? days : 14;
}

/**
 * Whether the user may write their profile. Reading is always allowed, so a
 * lapsed subscriber can still pull their settings down.
 */
export async function getEntitlement(env, deps, session) {
  const subscription = await env.DB.prepare(
    'SELECT stripe_customer_id, status, current_period_end FROM subscriptions WHERE user_id = ?'
  )
    .bind(session.userId)
    .first();
  // created_at is when the trial began; a re-created account keeps its deleted one's start.
  const trialEndsAt = session.userCreatedAt + trialDays(env) * DAY_MS;
  const status = subscription?.status || null;
  const currentPeriodEnd = subscription?.current_period_end
    ? subscription.current_period_end * 1000
    : null;
  let reason = 'none';
  if (env.ENTITLEMENT_MODE === 'open') reason = 'open';
  else if (status && ENTITLED_STATUSES.has(status)) reason = 'subscription';
  else if (deps.now() < trialEndsAt) reason = 'trial';
  return {
    entitled: reason !== 'none',
    reason,
    subscriptionStatus: status,
    currentPeriodEnd,
    trialEndsAt,
    hasBillingAccount: !!subscription?.stripe_customer_id,
  };
}

/**
 * Finds the user behind a provider identity, or creates one. A new identity
 * whose email matches an existing user joins that user, so Google and GitHub
 * sign-ins with the same address share one account. Callers pass only an email
 * the provider has verified, since whoever controls it controls the account.
 */
export async function findOrCreateUser(env, deps, { provider, providerUserId, email }) {
  const existingIdentity = await findIdentity(env, provider, providerUserId);
  if (existingIdentity) {
    await refreshIdentityEmail(env, existingIdentity, { provider, providerUserId, email });
    return existingIdentity.user_id;
  }
  try {
    return await createIdentity(env, deps, { provider, providerUserId, email });
  } catch (error) {
    // Another sign-in created the same identity or a user with this email in the
    // meantime (users.email is unique). Its rows are committed, so join them.
    const raced = await findIdentity(env, provider, providerUserId);
    if (raced) return raced.user_id;
    if (email) return createIdentity(env, deps, { provider, providerUserId, email });
    throw error;
  }
}

function findIdentity(env, provider, providerUserId) {
  return env.DB.prepare(
    'SELECT user_id, email FROM identities WHERE provider = ? AND provider_user_id = ?'
  )
    .bind(provider, providerUserId)
    .first();
}

/**
 * A keyed hash of a provider identity, which is all that is kept about it after the account
 * is deleted. Provider user IDs are short and guessable, so the hash is keyed with that
 * provider's OAuth client secret rather than left as a plain digest. Rotating the secret only
 * means identities deleted before then can start a new trial.
 */
function identityHash(env, deps, provider, providerUserId) {
  const key = env[`${String(provider).toUpperCase()}_CLIENT_SECRET`];
  const message = `${provider}:${providerUserId}`;
  return key ? hmacSha256Hex(deps.crypto, key, message) : sha256Hex(deps.crypto, message);
}

async function createIdentity(env, deps, { provider, providerUserId, email }) {
  const now = deps.now();
  let userId = null;
  if (email) {
    const existing = await env.DB.prepare('SELECT id FROM users WHERE email = ?')
      .bind(email)
      .first();
    userId = existing?.id || null;
  }
  const statements = [];
  if (!userId) {
    userId = deps.crypto.randomUUID();
    // The trial runs from created_at. A sign-in that already had its trial under a deleted
    // account takes that account's start, so deleting and signing up again gains nothing.
    const consumed = await env.DB.prepare(
      'SELECT trial_started_at FROM consumed_trials WHERE identity_hash = ?'
    )
      .bind(await identityHash(env, deps, provider, providerUserId))
      .first();
    const createdAt = consumed ? Math.min(now, consumed.trial_started_at) : now;
    statements.push(
      env.DB.prepare('INSERT INTO users (id, email, created_at) VALUES (?, ?, ?)').bind(
        userId,
        email || null,
        createdAt
      )
    );
  }
  statements.push(
    env.DB.prepare(
      'INSERT INTO identities (provider, provider_user_id, user_id, email, created_at) VALUES (?, ?, ?, ?, ?)'
    ).bind(provider, providerUserId, userId, email || null, now)
  );
  await env.DB.batch(statements);
  return userId;
}

/**
 * Keeps an identity's email current. The account's own email follows when this
 * identity supplied it (or it had none), unless another account already uses the
 * new address; that account keeps it, since email decides which account a new
 * sign-in joins. Both are written in one batch, and the account's email is checked
 * as well as the identity's, so an account that missed the change (the address was
 * taken then, or an earlier write was cut short) catches up on a later sign-in.
 */
async function refreshIdentityEmail(env, identity, { provider, providerUserId, email }) {
  if (!email) return;
  const user = await env.DB.prepare('SELECT email FROM users WHERE id = ?')
    .bind(identity.user_id)
    .first();
  if (email === identity.email && email === user?.email) return;
  // The account's email is this identity's to change when it is the identity's old one,
  // missing, or no longer backed by any identity (one the change already moved past).
  await env.DB.batch([
    env.DB.prepare(
      `UPDATE users SET email = ?
       WHERE id = ?
         AND (email IS NULL OR email = ?
           OR NOT EXISTS (
             SELECT 1 FROM identities i WHERE i.user_id = users.id AND i.email = users.email
           ))
         AND NOT EXISTS (SELECT 1 FROM users other WHERE other.email = ? AND other.id != ?)`
    ).bind(email, identity.user_id, identity.email, email, identity.user_id),
    env.DB.prepare(
      'UPDATE identities SET email = ? WHERE provider = ? AND provider_user_id = ?'
    ).bind(email, provider, providerUserId),
  ]);
}

export async function handleGetAccount(request, env, deps, { reconcileCheckout } = {}) {
  const session = await authenticate(request, env, deps);
  if (!session) return unauthorized();
  const identities = await env.DB.prepare(
    'SELECT provider FROM identities WHERE user_id = ? ORDER BY created_at'
  )
    .bind(session.userId)
    .all();
  const billingAvailable = !!(
    env.STRIPE_SECRET_KEY &&
    env.STRIPE_PRICE_ID &&
    env.STRIPE_WEBHOOK_SECRET
  );
  let entitlement = await getEntitlement(env, deps, session);
  // The app asks again when it returns from Checkout. If the payment went through but its
  // webhook is late or lost, settle the Checkout here so the subscriber is not refused.
  if (billingAvailable && reconcileCheckout && entitlement.reason !== 'subscription') {
    try {
      if (await reconcileCheckout(env, deps, session.userId)) {
        entitlement = await getEntitlement(env, deps, session);
      }
    } catch (error) {
      console.error('Checkout could not be reconciled', error);
    }
  }
  return json({
    user: { id: session.userId, email: session.email },
    providers: (identities.results || []).map((row) => row.provider),
    entitlement,
    billingAvailable,
  });
}

export async function handleSignOut(request, env, deps) {
  const session = await authenticate(request, env, deps);
  if (!session) return unauthorized();
  await env.DB.prepare('DELETE FROM sessions WHERE token_hash = ?').bind(session.tokenHash).run();
  return json({ ok: true });
}

/**
 * Deletes the account and everything stored for it. An active subscription is
 * cancelled first, and nothing is deleted if that fails, so nobody keeps paying
 * for an account that no longer exists.
 */
export async function handleDeleteAccount(
  request,
  env,
  deps,
  { cancelSubscription, acquireBillingLock, releaseBillingLock, expirePendingCheckout }
) {
  const session = await authenticate(request, env, deps);
  if (!session) return unauthorized();
  const lock = await acquireBillingLock(env, deps, session.userId);
  if (!lock)
    return errorResponse(
      409,
      'billing_busy',
      'A billing change is in progress. Try again shortly.'
    );
  try {
    const subscription = await env.DB.prepare(
      'SELECT stripe_subscription_id, status FROM subscriptions WHERE user_id = ?'
    )
      .bind(session.userId)
      .first();
    try {
      const pendingSubscription = await expirePendingCheckout(env, deps, session.userId);
      const toCancel = new Set();
      const ended =
        subscription?.status === 'canceled' || subscription?.status === 'incomplete_expired';
      if (subscription?.stripe_subscription_id && !ended)
        toCancel.add(subscription.stripe_subscription_id);
      if (
        pendingSubscription &&
        !(ended && pendingSubscription === subscription?.stripe_subscription_id)
      )
        toCancel.add(pendingSubscription);
      for (const id of toCancel) await cancelSubscription(env, deps, id);
    } catch {
      return errorResponse(
        502,
        'billing_unavailable',
        'Billing could not be closed, so the account was kept. Try again later.'
      );
    }
    const userId = session.userId;
    // Remember that these sign-ins have had their trial, as hashes only, so signing in again
    // does not start another. Written in the same batch, so it exists only if the deletion does.
    const identities = await env.DB.prepare(
      'SELECT provider, provider_user_id FROM identities WHERE user_id = ?'
    )
      .bind(userId)
      .all();
    const trialMarkers = await Promise.all(
      (identities.results || []).map(async (identity) =>
        env.DB.prepare(
          `INSERT INTO consumed_trials (identity_hash, trial_started_at) VALUES (?, ?)
           ON CONFLICT(identity_hash) DO UPDATE SET
             trial_started_at = MIN(consumed_trials.trial_started_at, excluded.trial_started_at)`
        ).bind(
          await identityHash(env, deps, identity.provider, identity.provider_user_id),
          session.userCreatedAt
        )
      )
    );
    const deletions = [
      'DELETE FROM profiles WHERE user_id = ?',
      'DELETE FROM sessions WHERE user_id = ?',
      'DELETE FROM handoff_codes WHERE user_id = ?',
      'DELETE FROM subscriptions WHERE user_id = ?',
      'DELETE FROM billing_checkouts WHERE user_id = ?',
      'DELETE FROM billing_operations WHERE user_id = ?',
      'DELETE FROM identities WHERE user_id = ?',
      'DELETE FROM users WHERE id = ?',
    ].map((sql) => env.DB.prepare(sql).bind(userId));
    await env.DB.batch([...trialMarkers, ...deletions]);
    return json({ ok: true });
  } finally {
    await releaseBillingLock(env, session.userId, lock);
  }
}

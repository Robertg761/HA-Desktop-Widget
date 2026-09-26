import { errorResponse, json, randomToken, sha256Hex } from './util.js';

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
  const identity = await env.DB.prepare(
    'SELECT user_id FROM identities WHERE provider = ? AND provider_user_id = ?'
  )
    .bind(provider, providerUserId)
    .first();
  const now = deps.now();
  if (identity) {
    if (email) {
      await env.DB.prepare(
        'UPDATE identities SET email = ? WHERE provider = ? AND provider_user_id = ?'
      )
        .bind(email, provider, providerUserId)
        .run();
    }
    return identity.user_id;
  }
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
    statements.push(
      env.DB.prepare('INSERT INTO users (id, email, created_at) VALUES (?, ?, ?)').bind(
        userId,
        email || null,
        now
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

export async function handleGetAccount(request, env, deps) {
  const session = await authenticate(request, env, deps);
  if (!session) return unauthorized();
  const identities = await env.DB.prepare(
    'SELECT provider FROM identities WHERE user_id = ? ORDER BY created_at'
  )
    .bind(session.userId)
    .all();
  return json({
    user: { id: session.userId, email: session.email },
    providers: (identities.results || []).map((row) => row.provider),
    entitlement: await getEntitlement(env, deps, session),
    billingAvailable: !!(env.STRIPE_SECRET_KEY && env.STRIPE_PRICE_ID),
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
export async function handleDeleteAccount(request, env, deps, { cancelSubscription }) {
  const session = await authenticate(request, env, deps);
  if (!session) return unauthorized();
  const subscription = await env.DB.prepare(
    'SELECT stripe_subscription_id, status FROM subscriptions WHERE user_id = ?'
  )
    .bind(session.userId)
    .first();
  if (
    subscription?.stripe_subscription_id &&
    subscription.status &&
    subscription.status !== 'canceled'
  ) {
    try {
      await cancelSubscription(env, deps, subscription.stripe_subscription_id);
    } catch {
      return errorResponse(
        502,
        'billing_unavailable',
        'Your subscription could not be cancelled, so the account was kept. Try again later.'
      );
    }
  }
  const userId = session.userId;
  await env.DB.batch(
    [
      'DELETE FROM profiles WHERE user_id = ?',
      'DELETE FROM sessions WHERE user_id = ?',
      'DELETE FROM handoff_codes WHERE user_id = ?',
      'DELETE FROM subscriptions WHERE user_id = ?',
      'DELETE FROM identities WHERE user_id = ?',
      'DELETE FROM users WHERE id = ?',
    ].map((sql) => env.DB.prepare(sql).bind(userId))
  );
  return json({ ok: true });
}

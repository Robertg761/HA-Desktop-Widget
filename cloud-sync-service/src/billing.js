// Subscriptions through Stripe Checkout and the Stripe customer portal. Only
// this module talks to the payment provider: the rest of the service reads the
// `subscriptions` table, so moving to another provider (for example Paddle)
// means replacing this file and its webhook.

import { authenticate, unauthorized } from './accounts.js';
import {
  errorResponse,
  hmacSha256Hex,
  htmlPage,
  json,
  publicBaseUrl,
  randomToken,
  readTextBody,
  timingSafeEqual,
} from './util.js';

const STRIPE_API = 'https://api.stripe.com/v1';
// Stripe rejects webhook deliveries whose signed time is older than this.
const WEBHOOK_TOLERANCE_SECONDS = 5 * 60;

export function isBillingConfigured(env) {
  return !!(env.STRIPE_SECRET_KEY && env.STRIPE_PRICE_ID && env.STRIPE_WEBHOOK_SECRET);
}

/** Flattens nested parameters into Stripe's form encoding (a[b][0]=c). */
export function encodeStripeParams(params, prefix = '', search = new URLSearchParams()) {
  Object.entries(params).forEach(([key, value]) => {
    const name = prefix ? `${prefix}[${key}]` : key;
    if (value === undefined || value === null) return;
    if (typeof value === 'object') encodeStripeParams(value, name, search);
    else search.append(name, String(value));
  });
  return search;
}

async function stripeRequest(env, deps, method, path, params, idempotencyKey) {
  const response = await deps.fetch(`${STRIPE_API}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${env.STRIPE_SECRET_KEY}`,
      'Content-Type': 'application/x-www-form-urlencoded',
      ...(idempotencyKey ? { 'Idempotency-Key': idempotencyKey } : {}),
    },
    signal: AbortSignal.timeout(20 * 1000),
    body: params ? encodeStripeParams(params) : undefined,
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(body?.error?.message || `Stripe request failed (${response.status})`);
  }
  return body;
}

export async function cancelSubscription(env, deps, subscriptionId) {
  if (!env.STRIPE_SECRET_KEY) throw new Error('Billing is not configured');
  const path = `/subscriptions/${encodeURIComponent(subscriptionId)}`;
  try {
    await stripeRequest(env, deps, 'DELETE', path);
  } catch (error) {
    // A response can be lost after Stripe cancels successfully. Confirm the
    // current state before deciding that account deletion must stay blocked.
    const current = await stripeRequest(env, deps, 'GET', path);
    if (current.status !== 'canceled' && current.status !== 'incomplete_expired') throw error;
  }
}

export async function acquireBillingLock(env, deps, userId) {
  const token = randomToken(deps.crypto);
  const result = await env.DB.prepare(
    `INSERT INTO billing_operations (user_id, token, expires_at)
     SELECT id, ?, ? FROM users WHERE id = ?
     ON CONFLICT(user_id) DO UPDATE SET token = excluded.token, expires_at = excluded.expires_at
     WHERE billing_operations.expires_at < ?`
  )
    .bind(token, deps.now() + 5 * 60 * 1000, userId, deps.now())
    .run();
  return result.meta?.changes === 1 ? token : null;
}

export async function releaseBillingLock(env, userId, token) {
  await env.DB.prepare('DELETE FROM billing_operations WHERE user_id = ? AND token = ?')
    .bind(userId, token)
    .run();
}

/** Returns a completed Checkout's subscription, or expires its unpaid page. */
export async function expirePendingCheckout(env, deps, userId) {
  const pending = await env.DB.prepare('SELECT * FROM billing_checkouts WHERE user_id = ?')
    .bind(userId)
    .first();
  if (!pending) return null;
  if (!pending.stripe_session_id) {
    if (pending.expires_at > deps.now()) throw new Error('Checkout is still being prepared');
    return null;
  }
  const checkout = await stripeRequest(
    env,
    deps,
    'GET',
    `/checkout/sessions/${encodeURIComponent(pending.stripe_session_id)}`
  );
  if (checkout.status === 'open') {
    await stripeRequest(
      env,
      deps,
      'POST',
      `/checkout/sessions/${encodeURIComponent(pending.stripe_session_id)}/expire`
    );
  } else if (checkout.status === 'complete') {
    if (typeof checkout.subscription !== 'string')
      throw new Error('Completed Checkout has no subscription');
    return checkout.subscription;
  } else if (checkout.status !== 'expired') {
    throw new Error('Unknown Checkout status');
  }
  return null;
}

export async function handleCheckout(request, env, deps) {
  const session = await authenticate(request, env, deps);
  if (!session) return unauthorized();
  if (!isBillingConfigured(env)) {
    return errorResponse(501, 'billing_unavailable', 'Subscriptions are not available yet.');
  }
  const lock = await acquireBillingLock(env, deps, session.userId);
  if (!lock)
    return errorResponse(
      409,
      'billing_busy',
      'A billing change is in progress. Try again shortly.'
    );
  try {
    const existing = await env.DB.prepare(
      'SELECT stripe_customer_id, stripe_subscription_id, status FROM subscriptions WHERE user_id = ?'
    )
      .bind(session.userId)
      .first();
    if (existing?.stripe_subscription_id && !ENDED_STATUSES.has(existing.status)) {
      return errorResponse(
        409,
        'subscription_exists',
        'Manage your existing subscription from the billing portal.'
      );
    }
    let pending = await env.DB.prepare('SELECT * FROM billing_checkouts WHERE user_id = ?')
      .bind(session.userId)
      .first();
    if (pending?.stripe_session_id) {
      const checkout = await stripeRequest(
        env,
        deps,
        'GET',
        `/checkout/sessions/${encodeURIComponent(pending.stripe_session_id)}`
      );
      if (checkout.status === 'open') return json({ url: checkout.url });
      if (checkout.status === 'complete') {
        if (typeof checkout.subscription !== 'string') {
          return errorResponse(
            409,
            'billing_pending',
            'Your payment is being processed. Try again shortly.'
          );
        }
        if (checkout.subscription !== existing?.stripe_subscription_id) {
          // Paid, but its webhook has not arrived: record it now rather than wait.
          const status = await recordSubscriptionFromStripe(
            env,
            deps,
            session.userId,
            checkout.subscription,
            Math.floor(deps.now() / 1000)
          );
          if (!ENDED_STATUSES.has(status)) {
            return errorResponse(
              409,
              'subscription_exists',
              'Manage your existing subscription from the billing portal.'
            );
          }
        }
        // The completed page belonged to a subscription that has already ended.
      } else if (checkout.status !== 'expired') throw new Error('Unknown Checkout status');
      pending = null;
    } else if (pending && pending.expires_at <= deps.now()) {
      // Any session created for this persisted request has already expired.
      pending = null;
    }
    const base = publicBaseUrl(request, env);
    const params = {
      mode: 'subscription',
      line_items: [{ price: env.STRIPE_PRICE_ID, quantity: 1 }],
      client_reference_id: session.userId,
      success_url: `${base}/billing/done?result=success`,
      cancel_url: `${base}/billing/done?result=cancel`,
      allow_promotion_codes: 'true',
      metadata: { user_id: session.userId },
      subscription_data: { metadata: { user_id: session.userId } },
      // Leave a minute above Stripe's 30-minute minimum for network transit.
      expires_at: Math.floor(deps.now() / 1000) + 31 * 60,
    };
    if (existing?.stripe_customer_id) params.customer = existing.stripe_customer_id;
    else if (session.email) params.customer_email = session.email;
    if (env.STRIPE_AUTOMATIC_TAX === 'true') {
      params.automatic_tax = { enabled: true };
      params.billing_address_collection = 'required';
      if (existing?.stripe_customer_id) params.customer_update = { address: 'auto' };
    }
    if (!pending) {
      pending = {
        request_key: randomToken(deps.crypto),
        stripe_params: JSON.stringify(params),
        expires_at: params.expires_at * 1000,
      };
      await env.DB.prepare(
        `INSERT INTO billing_checkouts (user_id, request_key, stripe_params, expires_at)
         VALUES (?, ?, ?, ?) ON CONFLICT(user_id) DO UPDATE SET
         request_key = excluded.request_key, stripe_params = excluded.stripe_params,
         stripe_session_id = NULL, url = NULL, expires_at = excluded.expires_at`
      )
        .bind(session.userId, pending.request_key, pending.stripe_params, pending.expires_at)
        .run();
    }
    const checkout = await stripeRequest(
      env,
      deps,
      'POST',
      '/checkout/sessions',
      JSON.parse(pending.stripe_params),
      pending.request_key
    );
    if (!checkout.id || !checkout.url) throw new Error('Checkout response is incomplete');
    await env.DB.prepare(
      'UPDATE billing_checkouts SET stripe_session_id = ?, url = ? WHERE user_id = ?'
    )
      .bind(checkout.id, checkout.url, session.userId)
      .run();
    return json({ url: checkout.url });
  } catch {
    return errorResponse(502, 'billing_unavailable', 'Checkout could not be started.');
  } finally {
    await releaseBillingLock(env, session.userId, lock);
  }
}

export async function handlePortal(request, env, deps) {
  const session = await authenticate(request, env, deps);
  if (!session) return unauthorized();
  if (!isBillingConfigured(env)) {
    return errorResponse(501, 'billing_unavailable', 'Subscriptions are not available yet.');
  }
  const existing = await env.DB.prepare(
    'SELECT stripe_customer_id FROM subscriptions WHERE user_id = ?'
  )
    .bind(session.userId)
    .first();
  if (!existing?.stripe_customer_id) {
    return errorResponse(404, 'no_billing_account', 'There is no subscription to manage yet.');
  }
  try {
    const portal = await stripeRequest(env, deps, 'POST', '/billing_portal/sessions', {
      customer: existing.stripe_customer_id,
      return_url: `${publicBaseUrl(request, env)}/billing/done?result=portal`,
    });
    return json({ url: portal.url });
  } catch {
    return errorResponse(502, 'billing_unavailable', 'The billing page could not be opened.');
  }
}

export function handleBillingDone(request) {
  const result = new URL(request.url).searchParams.get('result');
  if (result === 'success') {
    return htmlPage(
      'Thanks for subscribing',
      'Cloud sync is ready. Return to HA Desktop Widget; it may take a few seconds to notice.'
    );
  }
  if (result === 'cancel') {
    return htmlPage('Checkout cancelled', 'Nothing was charged. You can close this tab.');
  }
  return htmlPage('All set', 'You can close this tab and return to HA Desktop Widget.');
}

/**
 * Verifies a Stripe-Signature header (t=<seconds>,v1=<hex>) against the raw
 * body, rejecting stale timestamps so a captured delivery cannot be replayed.
 */
export async function verifyStripeSignature(deps, secret, header, payload) {
  const parts = String(header || '')
    .split(',')
    .map((part) => part.trim().split('='));
  const timestamp = Number(parts.find(([key]) => key === 't')?.[1]);
  const signatures = parts.filter(([key]) => key === 'v1').map(([, value]) => value);
  if (!Number.isFinite(timestamp) || signatures.length === 0) return false;
  if (Math.abs(deps.now() / 1000 - timestamp) > WEBHOOK_TOLERANCE_SECONDS) return false;
  const expected = await hmacSha256Hex(deps.crypto, secret, `${timestamp}.${payload}`);
  return signatures.some((signature) => timingSafeEqual(signature, expected));
}

// The subscription period end moved from the subscription onto its items in
// newer Stripe API versions; read whichever this account's version sends.
function periodEnd(subscription) {
  const direct = Number(subscription.current_period_end);
  if (Number.isFinite(direct) && direct > 0) return direct;
  const items = subscription.items?.data || [];
  const ends = items.map((item) => Number(item.current_period_end)).filter(Number.isFinite);
  return ends.length ? Math.max(...ends) : null;
}

const ENDED_STATUSES = new Set(['canceled', 'incomplete_expired']);

/**
 * Reads a subscription from Stripe and stores its current state. Webhook payloads are a
 * snapshot from when the event was created, and Stripe can deliver two events created in
 * the same second in either order, so the stored status always comes from Stripe itself.
 * `eventCreated` (seconds) still orders the write, so an event older than the last one
 * applied changes nothing.
 */
export async function recordSubscriptionFromStripe(
  env,
  deps,
  userId,
  subscriptionId,
  eventCreated
) {
  const subscription = await stripeRequest(
    env,
    deps,
    'GET',
    `/subscriptions/${encodeURIComponent(subscriptionId)}`
  );
  if (!subscription?.status) throw new Error('Subscription response is incomplete');
  const status = String(subscription.status);
  await upsertSubscription(
    env,
    deps,
    userId,
    {
      customerId: typeof subscription.customer === 'string' ? subscription.customer : null,
      subscriptionId,
      status,
      currentPeriodEnd: periodEnd(subscription),
    },
    eventCreated
  );
  return status;
}

/**
 * Settles this user's Checkout without waiting for its webhook: a completed one records its
 * subscription, and a finished one is forgotten. A paid subscriber whose webhook was lost or
 * delayed is then entitled the next time the app asks. Returns the recorded status, if any.
 *
 * Holds the same per-user lock as Checkout creation and account deletion. Without it, a
 * request from another device could record the subscription and forget the Checkout in the
 * middle of a deletion, after the deletion saw no subscription but before it looked for a
 * Checkout, so nothing would be cancelled. When the lock is busy this does nothing; the app
 * asks again shortly, and whatever holds the lock deals with the Checkout itself.
 */
export async function reconcileCheckout(env, deps, userId) {
  const lock = await acquireBillingLock(env, deps, userId);
  if (!lock) return null;
  try {
    return await settleCheckout(env, deps, userId);
  } finally {
    await releaseBillingLock(env, userId, lock);
  }
}

async function settleCheckout(env, deps, userId) {
  const pending = await env.DB.prepare(
    'SELECT stripe_session_id FROM billing_checkouts WHERE user_id = ? AND stripe_session_id IS NOT NULL'
  )
    .bind(userId)
    .first();
  if (!pending) return null;
  const checkout = await stripeRequest(
    env,
    deps,
    'GET',
    `/checkout/sessions/${encodeURIComponent(pending.stripe_session_id)}`
  );
  if (checkout.status === 'open') return null;
  let status = null;
  if (checkout.status === 'complete') {
    if (typeof checkout.subscription !== 'string') return null;
    status = await recordSubscriptionFromStripe(
      env,
      deps,
      userId,
      checkout.subscription,
      Math.floor(deps.now() / 1000)
    );
  }
  await env.DB.prepare('DELETE FROM billing_checkouts WHERE user_id = ? AND stripe_session_id = ?')
    .bind(userId, pending.stripe_session_id)
    .run();
  return status;
}

async function userIdForStripeObject(env, metadataUserId, customerId) {
  if (typeof metadataUserId === 'string' && metadataUserId) {
    const user = await env.DB.prepare('SELECT id FROM users WHERE id = ?')
      .bind(metadataUserId)
      .first();
    if (user) return user.id;
  }
  if (customerId) {
    const row = await env.DB.prepare(
      'SELECT user_id FROM subscriptions WHERE stripe_customer_id = ?'
    )
      .bind(customerId)
      .first();
    if (row) return row.user_id;
  }
  return null;
}

async function upsertSubscription(env, deps, userId, fields, eventCreated) {
  // Stripe does not guarantee delivery order, so an older status never replaces a
  // newer one. Events without a status (checkout completing) only link the
  // customer and take no part in that ordering.
  const carriesStatus = !!fields.status;
  await env.DB.prepare(
    `INSERT INTO subscriptions (user_id, stripe_customer_id, stripe_subscription_id, status, current_period_end, event_created, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(user_id) DO UPDATE SET
       stripe_customer_id = CASE WHEN excluded.event_created IS NULL
         THEN COALESCE(subscriptions.stripe_customer_id, excluded.stripe_customer_id)
         ELSE COALESCE(excluded.stripe_customer_id, subscriptions.stripe_customer_id) END,
       stripe_subscription_id = CASE WHEN excluded.event_created IS NULL
         THEN COALESCE(subscriptions.stripe_subscription_id, excluded.stripe_subscription_id)
         ELSE COALESCE(excluded.stripe_subscription_id, subscriptions.stripe_subscription_id) END,
       status = COALESCE(excluded.status, subscriptions.status),
       current_period_end = COALESCE(excluded.current_period_end, subscriptions.current_period_end),
       event_created = COALESCE(excluded.event_created, subscriptions.event_created),
       updated_at = excluded.updated_at
     WHERE excluded.event_created IS NULL OR (
       excluded.event_created >= COALESCE(subscriptions.event_created, 0)
       AND NOT (COALESCE(subscriptions.status, '') = 'canceled'
         AND subscriptions.stripe_subscription_id = excluded.stripe_subscription_id
         AND excluded.status != 'canceled')
       AND NOT (excluded.status = 'canceled'
         AND subscriptions.stripe_subscription_id IS NOT NULL
         AND subscriptions.stripe_subscription_id != excluded.stripe_subscription_id
         AND COALESCE(subscriptions.status, '') NOT IN ('canceled', 'incomplete_expired'))
     )`
  )
    .bind(
      userId,
      fields.customerId || null,
      fields.subscriptionId || null,
      fields.status || null,
      fields.currentPeriodEnd || null,
      carriesStatus ? eventCreated : null,
      deps.now()
    )
    .run();
}

export async function handleWebhook(request, env, deps) {
  if (!env.STRIPE_WEBHOOK_SECRET) {
    return errorResponse(501, 'billing_unavailable', 'Webhooks are not configured.');
  }
  const payload = await readTextBody(request, 256 * 1024);
  if (
    payload === null ||
    !(await verifyStripeSignature(
      deps,
      env.STRIPE_WEBHOOK_SECRET,
      request.headers.get('Stripe-Signature'),
      payload
    ))
  ) {
    return errorResponse(400, 'invalid_signature', 'Signature verification failed.');
  }
  let event;
  try {
    event = JSON.parse(payload);
  } catch {
    return errorResponse(400, 'invalid_payload', 'The event was not valid JSON.');
  }
  const object = event?.data?.object || {};
  const created = Number(event.created) || 0;

  try {
    if (event.type === 'checkout.session.completed' && object.mode === 'subscription') {
      const userId = await userIdForStripeObject(
        env,
        object.client_reference_id || object.metadata?.user_id,
        object.customer
      );
      if (userId) {
        // Links the customer first, so a failed read below still leaves the portal usable.
        await upsertSubscription(
          env,
          deps,
          userId,
          { customerId: object.customer, subscriptionId: object.subscription },
          created
        );
        if (typeof object.subscription === 'string') {
          await recordSubscriptionFromStripe(env, deps, userId, object.subscription, created);
        }
      }
    } else if (
      event.type === 'customer.subscription.created' ||
      event.type === 'customer.subscription.updated' ||
      event.type === 'customer.subscription.deleted'
    ) {
      const userId = await userIdForStripeObject(env, object.metadata?.user_id, object.customer);
      if (userId && event.type === 'customer.subscription.deleted') {
        // Deletion is final, so this snapshot cannot be stale; no need to ask Stripe.
        await upsertSubscription(
          env,
          deps,
          userId,
          {
            customerId: object.customer,
            subscriptionId: object.id,
            status: 'canceled',
            currentPeriodEnd: periodEnd(object),
          },
          created
        );
      } else if (userId && typeof object.id === 'string') {
        await recordSubscriptionFromStripe(env, deps, userId, object.id, created);
      }
    }
  } catch (error) {
    console.error('Stripe webhook could not be applied', event.type, error);
    return errorResponse(500, 'webhook_failed', 'The event could not be applied yet.');
  }
  // Every other event type is acknowledged so Stripe stops retrying it.
  return json({ received: true });
}

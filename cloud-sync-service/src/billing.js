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
  readTextBody,
  timingSafeEqual,
} from './util.js';

const STRIPE_API = 'https://api.stripe.com/v1';
// Stripe rejects webhook deliveries whose signed time is older than this.
const WEBHOOK_TOLERANCE_SECONDS = 5 * 60;

export function isBillingConfigured(env) {
  return !!(env.STRIPE_SECRET_KEY && env.STRIPE_PRICE_ID);
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

async function stripeRequest(env, deps, method, path, params) {
  const response = await deps.fetch(`${STRIPE_API}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${env.STRIPE_SECRET_KEY}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
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
  await stripeRequest(env, deps, 'DELETE', `/subscriptions/${encodeURIComponent(subscriptionId)}`);
}

export async function handleCheckout(request, env, deps) {
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
  };
  if (existing?.stripe_customer_id) params.customer = existing.stripe_customer_id;
  else if (session.email) params.customer_email = session.email;
  try {
    const checkout = await stripeRequest(env, deps, 'POST', '/checkout/sessions', params);
    return json({ url: checkout.url });
  } catch {
    return errorResponse(502, 'billing_unavailable', 'Checkout could not be started.');
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
  if (carriesStatus) {
    const existing = await env.DB.prepare(
      'SELECT event_created FROM subscriptions WHERE user_id = ?'
    )
      .bind(userId)
      .first();
    if (existing && existing.event_created && eventCreated < existing.event_created) return;
  }
  await env.DB.prepare(
    `INSERT INTO subscriptions (user_id, stripe_customer_id, stripe_subscription_id, status, current_period_end, event_created, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(user_id) DO UPDATE SET
       stripe_customer_id = COALESCE(excluded.stripe_customer_id, subscriptions.stripe_customer_id),
       stripe_subscription_id = COALESCE(excluded.stripe_subscription_id, subscriptions.stripe_subscription_id),
       status = COALESCE(excluded.status, subscriptions.status),
       current_period_end = COALESCE(excluded.current_period_end, subscriptions.current_period_end),
       event_created = COALESCE(excluded.event_created, subscriptions.event_created),
       updated_at = excluded.updated_at`
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

  if (event.type === 'checkout.session.completed' && object.mode === 'subscription') {
    const userId = await userIdForStripeObject(
      env,
      object.client_reference_id || object.metadata?.user_id,
      object.customer
    );
    if (userId) {
      await upsertSubscription(
        env,
        deps,
        userId,
        { customerId: object.customer, subscriptionId: object.subscription },
        created
      );
    }
  } else if (
    event.type === 'customer.subscription.created' ||
    event.type === 'customer.subscription.updated' ||
    event.type === 'customer.subscription.deleted'
  ) {
    const userId = await userIdForStripeObject(env, object.metadata?.user_id, object.customer);
    if (userId) {
      await upsertSubscription(
        env,
        deps,
        userId,
        {
          customerId: object.customer,
          subscriptionId: object.id,
          status: event.type === 'customer.subscription.deleted' ? 'canceled' : object.status,
          currentPeriodEnd: periodEnd(object),
        },
        created
      );
    }
  }
  // Every other event type is acknowledged so Stripe stops retrying it.
  return json({ received: true });
}

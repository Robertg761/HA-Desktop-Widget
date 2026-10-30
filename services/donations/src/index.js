/**
 * Starts card donations for HA Desktop Widget, for people without a GitHub account. The app's
 * donate dialog (src/card-donation.cjs in the app) asks this Worker for a Stripe Checkout
 * session and shows Stripe's hosted checkout page in a window of its own. The Stripe secret key
 * stays here; card details only ever go to Stripe.
 *
 *   POST /v1/checkout  {"amount": 5, "locale": "de"}  -> 200 {"url": "https://checkout.stripe.com/..."}
 *   GET  /v1/return?result=complete|cancelled          -> a short page; the app closes its window
 *                                                         before it loads, so it is only a fallback
 */

const STRIPE_CHECKOUT_SESSIONS_URL = 'https://api.stripe.com/v1/checkout/sessions';
// Whole US dollars, the same bounds the app's donate dialog accepts (GitHub Sponsors' cap).
export const MIN_AMOUNT = 1;
export const MAX_AMOUNT = 12000;
const MAX_BODY_BYTES = 1024;
const PRODUCT_NAME = 'Donation to HA Desktop Widget';
// Checkout's own language list. Anything else, Arabic and Hindi included, gets 'auto', which
// follows the browser language and falls back to English.
const CHECKOUT_LOCALES = new Set([
  'bg', 'cs', 'da', 'de', 'el', 'en', 'en-GB', 'es', 'es-419', 'et', 'fi', 'fil', 'fr', 'fr-CA',
  'hr', 'hu', 'id', 'it', 'ja', 'ko', 'lt', 'lv', 'ms', 'mt', 'nb', 'nl', 'pl', 'pt', 'pt-BR',
  'ro', 'ru', 'sk', 'sl', 'sv', 'th', 'tr', 'vi', 'zh', 'zh-HK', 'zh-TW',
]); // prettier-ignore

/** Returns the checkout request, or null when the body is not a well-formed one. */
export function parseCheckoutRequest(body) {
  if (!body || typeof body !== 'object') return null;
  const { amount, locale } = body;
  if (!Number.isInteger(amount) || amount < MIN_AMOUNT || amount > MAX_AMOUNT) return null;
  if (locale !== undefined && typeof locale !== 'string') return null;
  return { amount, locale: checkoutLocale(locale) };
}

export function checkoutLocale(locale) {
  if (typeof locale !== 'string') return 'auto';
  if (CHECKOUT_LOCALES.has(locale)) return locale;
  const language = locale.split('-')[0];
  return CHECKOUT_LOCALES.has(language) ? language : 'auto';
}

/** The form fields for Stripe's "create a Checkout Session" call. */
export function checkoutSessionParams({ amount, locale }, origin) {
  return new URLSearchParams({
    mode: 'payment',
    submit_type: 'donate',
    // Cards only: other payment methods can hand off to a bank's or provider's own site, which
    // the app's checkout window does not open.
    'payment_method_types[0]': 'card',
    'line_items[0][quantity]': '1',
    'line_items[0][price_data][currency]': 'usd',
    'line_items[0][price_data][unit_amount]': String(amount * 100),
    'line_items[0][price_data][product_data][name]': PRODUCT_NAME,
    'payment_intent_data[description]': PRODUCT_NAME,
    // GitHub sponsors are listed in SPONSORS.md by username; this is the card donor's way in.
    'custom_fields[0][key]': 'sponsor_name',
    'custom_fields[0][type]': 'text',
    'custom_fields[0][optional]': 'true',
    'custom_fields[0][label][type]': 'custom',
    'custom_fields[0][label][custom]': 'Name for the sponsors list',
    'custom_fields[0][text][maximum_length]': '40',
    locale,
    'metadata[source]': 'desktop-app',
    success_url: `${origin}/v1/return?result=complete`,
    cancel_url: `${origin}/v1/return?result=cancelled`,
  });
}

export async function createCheckoutSession(request, { secretKey, origin, fetchImpl = fetch }) {
  const response = await fetchImpl(STRIPE_CHECKOUT_SESSIONS_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${secretKey}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: checkoutSessionParams(request, origin).toString(),
  });
  const session = await response.json().catch(() => null);
  if (!response.ok || typeof session?.url !== 'string') {
    const reason = session?.error?.message || `status ${response.status}`;
    throw new Error(`Stripe did not create a checkout session: ${reason}`);
  }
  return session.url;
}

/**
 * Reads the body as text, giving up (null) as soon as it passes `limit` bytes,
 * so an oversized request is never buffered whole.
 */
export async function readBodyWithLimit(request, limit) {
  if (!request.body) return '';
  const reader = request.body.getReader();
  const chunks = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > limit) {
      await reader.cancel().catch(() => {});
      return null;
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(bytes);
}

const json = (status, body) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });

const RETURN_PAGES = {
  complete: {
    title: 'Thank you!',
    message: 'Thank you for supporting HA Desktop Widget. You can close this window.',
  },
  cancelled: {
    title: 'Donation cancelled',
    message: 'Nothing was charged. You can close this window.',
  },
};

export function returnPage(result) {
  const page = RETURN_PAGES[result] || RETURN_PAGES.cancelled;
  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${page.title}</title>
<style>
  body { font: 16px/1.5 system-ui, sans-serif; margin: 0; min-height: 100vh; display: grid;
    place-items: center; text-align: center; color: #1f2933; background: #f5f7fa; }
  @media (prefers-color-scheme: dark) { body { color: #e4e7eb; background: #1f2933; } }
  main { max-width: 28rem; padding: 2rem; }
</style>
</head>
<body><main><h1>${page.title}</h1><p>${page.message}</p></main></body>
</html>
`;
  return new Response(html, {
    status: 200,
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'no-store',
      'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'",
    },
  });
}

export async function handleRequest(request, env, { fetchImpl = fetch } = {}) {
  const url = new URL(request.url);

  if (url.pathname === '/v1/checkout') {
    if (request.method !== 'POST') return new Response(null, { status: 405 });
    // Creating a session costs nothing and charges nothing, but an open endpoint still gets a
    // per-address limit. The address is only handed to the limiter, never stored.
    if (env.CHECKOUT_LIMITER) {
      const key = request.headers.get('CF-Connecting-IP') || 'unknown';
      const { success } = await env.CHECKOUT_LIMITER.limit({ key });
      if (!success) return new Response(null, { status: 429 });
    }
    const declaredLength = Number(request.headers.get('Content-Length'));
    if (declaredLength > MAX_BODY_BYTES) return new Response(null, { status: 413 });
    const text = await readBodyWithLimit(request, MAX_BODY_BYTES);
    if (text === null) return new Response(null, { status: 413 });
    let body;
    try {
      body = JSON.parse(text);
    } catch {
      return new Response(null, { status: 400 });
    }
    const checkout = parseCheckoutRequest(body);
    if (!checkout) return new Response(null, { status: 400 });
    if (typeof env.STRIPE_SECRET_KEY !== 'string' || !env.STRIPE_SECRET_KEY) {
      return json(503, { error: 'not_configured' });
    }
    try {
      const checkoutUrl = await createCheckoutSession(checkout, {
        secretKey: env.STRIPE_SECRET_KEY,
        origin: url.origin,
        fetchImpl,
      });
      return json(200, { url: checkoutUrl });
    } catch (error) {
      console.error(error.message);
      return json(502, { error: 'checkout_unavailable' });
    }
  }

  if (url.pathname === '/v1/return') {
    if (request.method !== 'GET') return new Response(null, { status: 405 });
    return returnPage(url.searchParams.get('result'));
  }

  return new Response(null, { status: 404 });
}

export default {
  fetch: (request, env) => handleRequest(request, env),
};

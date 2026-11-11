// Per-address request limits, using Cloudflare's Rate Limiting bindings
// ([[ratelimits]] in wrangler.toml). The caller's address is only handed to the
// limiter as its key; it is never stored or logged.
//
// Sign-in gets a tight limit because /v1/auth/start writes a row for every
// request and needs no account. Everything else signed in gets a looser one.
// Stripe webhooks and the health check are never limited. A Worker deployed
// without the bindings (a self-hosted copy, or tests) is not limited at all.

const UNLIMITED_PATHS = new Set(['/v1/health', '/v1/billing/webhook']);

/** Which limiter binding applies to this path, or null for none. */
export function limiterFor(env, pathname) {
  if (UNLIMITED_PATHS.has(pathname)) return null;
  if (pathname.startsWith('/v1/auth/')) return env.AUTH_LIMITER || null;
  if (pathname.startsWith('/v1/')) return env.API_LIMITER || null;
  return null;
}

/**
 * True when the request is within its limit. A limiter that fails lets the
 * request through: an outage of the limiter should not take sign-in down.
 */
export async function isWithinRateLimit(request, env, pathname) {
  const limiter = limiterFor(env, pathname);
  if (!limiter) return true;
  const key = request.headers.get('CF-Connecting-IP') || 'unknown';
  try {
    const { success } = await limiter.limit({ key });
    return success !== false;
  } catch (error) {
    console.error('Rate limiter failed', error);
    return true;
  }
}

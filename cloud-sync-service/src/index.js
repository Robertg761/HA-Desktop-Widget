// HA Desktop Widget Cloud Sync: a Cloudflare Worker that stores each user's
// sync file behind a Google or GitHub sign-in, with a subscription.

import { handleDeleteAccount, handleGetAccount, handleSignOut } from './accounts.js';
import {
  cancelSubscription,
  handleBillingDone,
  handleCheckout,
  handlePortal,
  handleWebhook,
  isBillingConfigured,
} from './billing.js';
import {
  handleAuthCallback,
  handleAuthStart,
  handleAuthToken,
  listConfiguredProviders,
} from './oauth.js';
import { handleGetProfile, handlePutProfile } from './profile.js';
import { errorResponse, htmlPage, json } from './util.js';

function defaultDeps() {
  return { fetch: (...args) => fetch(...args), crypto, now: () => Date.now() };
}

/**
 * Routes a request. `deps` supplies fetch, Web Crypto and the clock, so tests
 * can run the whole service without a network or real time.
 */
export async function handleRequest(request, env, deps = defaultDeps()) {
  const url = new URL(request.url);
  const { pathname } = url;
  const method = request.method;
  try {
    if (pathname === '/' && method === 'GET') {
      return htmlPage(
        'HA Desktop Widget Cloud Sync',
        'Keeps your HA Desktop Widget settings in sync across your computers. Sign in from the app under Settings, then Profile Syncing.'
      );
    }
    if (pathname === '/v1/health' && method === 'GET') return json({ ok: true });
    if (pathname === '/v1/config' && method === 'GET') {
      return json({
        providers: listConfiguredProviders(env),
        billingAvailable: isBillingConfigured(env),
        entitlementMode: env.ENTITLEMENT_MODE === 'open' ? 'open' : 'subscription',
      });
    }
    if (pathname === '/v1/auth/start' && method === 'GET') {
      return await handleAuthStart(request, env, deps);
    }
    const callback = /^\/v1\/auth\/callback\/([a-z]+)$/.exec(pathname);
    if (callback && method === 'GET') {
      return await handleAuthCallback(request, env, deps, callback[1]);
    }
    if (pathname === '/v1/auth/token' && method === 'POST') {
      return await handleAuthToken(request, env, deps);
    }
    if (pathname === '/v1/auth/signout' && method === 'POST') {
      return await handleSignOut(request, env, deps);
    }
    if (pathname === '/v1/account' && method === 'GET') {
      return await handleGetAccount(request, env, deps);
    }
    if (pathname === '/v1/account' && method === 'DELETE') {
      return await handleDeleteAccount(request, env, deps, { cancelSubscription });
    }
    if (pathname === '/v1/profile' && method === 'GET') {
      return await handleGetProfile(request, env, deps);
    }
    if (pathname === '/v1/profile' && method === 'PUT') {
      return await handlePutProfile(request, env, deps);
    }
    if (pathname === '/v1/billing/checkout' && method === 'POST') {
      return await handleCheckout(request, env, deps);
    }
    if (pathname === '/v1/billing/portal' && method === 'POST') {
      return await handlePortal(request, env, deps);
    }
    if (pathname === '/v1/billing/webhook' && method === 'POST') {
      return await handleWebhook(request, env, deps);
    }
    if (pathname === '/billing/done' && method === 'GET') return handleBillingDone(request);
    return errorResponse(404, 'not_found', 'Not found.');
  } catch (error) {
    console.error('Request failed', method, pathname, error);
    return errorResponse(500, 'server_error', 'Something went wrong. Try again shortly.');
  }
}

export default {
  fetch(request, env) {
    return handleRequest(request, env);
  },
};

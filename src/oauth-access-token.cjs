'use strict';

// Home Assistant counts every request or WebSocket login made with an expired access token as a
// failed login: it raises a "Login attempt failed" notification naming this computer's address and
// counts towards an IP ban. A browser-authorized (OAuth) access token lives about half an hour, and
// the timer that replaces it does not run while the computer sleeps, so on waking the token in
// memory has usually expired. Nothing may send it then; the refresh replaces it first.

// A token this close to its expiry could run out during the handshake it is sent with.
const OAUTH_ACCESS_TOKEN_EXPIRY_MARGIN_MS = 30 * 1000;

/**
 * Whether the configured OAuth access token is known to have expired (or to be about to).
 * A legacy long-lived token, or an OAuth token without a recorded expiry, never counts as expired.
 */
function isOAuthAccessTokenExpired(config, now = Date.now()) {
  const homeAssistant = config?.homeAssistant;
  if (homeAssistant?.authMethod !== 'oauth') return false;
  const expiresAt = Number(homeAssistant.oauthExpiresAt);
  if (!Number.isFinite(expiresAt) || expiresAt <= 0) return false;
  return expiresAt - now <= OAUTH_ACCESS_TOKEN_EXPIRY_MARGIN_MS;
}

module.exports = { OAUTH_ACCESS_TOKEN_EXPIRY_MARGIN_MS, isOAuthAccessTokenExpired };

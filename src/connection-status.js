import { t } from './i18n.js';

/**
 * Shared rendering for the Home Assistant connection status lines (settings
 * panel and first-run wizard).
 *
 * The waiting indicator lives inside the status line rather than beside the
 * action buttons. The settings modal is only about 385px wide in the default
 * window, so a free-floating spinner in the button row overflows as soon as a
 * third button appears or a translated label runs long. Anchoring it to the
 * status text gives it the full modal width and keeps the animation next to the
 * message that explains what is being waited on.
 */

/** The sweeping bar that says something is waiting on the network or on the user. */
function createProgressTrack() {
  const track = document.createElement('span');
  track.className = 'connection-progress';
  track.setAttribute('aria-hidden', 'true');
  const bar = document.createElement('span');
  bar.className = 'connection-progress-bar';
  track.appendChild(bar);
  return track;
}

function syncProgressIndicator(status) {
  const shouldShow =
    status.dataset.busy === 'true' && !status.classList.contains('connection-status-empty');
  const existing = status.querySelector('.connection-progress');
  if (!shouldShow) {
    existing?.remove();
    return;
  }
  if (existing) return;
  status.appendChild(createProgressTrack());
}

// What may stand between a repeated summary and the rest of the sentence: a full stop, colon,
// comma or semicolon (also the Arabic, Chinese and Hindi forms) and spaces.
const SUMMARY_SEPARATORS = /^[\s.:,;\u061b\u3002\uff0c\uff1a\uff1b\u0964]+/;

/**
 * `detail` without a leading repeat of `summary`. "Disconnected from Home Assistant. Retrying
 * automatically." under the title "Disconnected from Home Assistant" is only "Retrying
 * automatically." The messages are translated whole, so the check is on the text itself and
 * needs nothing from the language: if the detail does not begin with the summary it is returned
 * as it is.
 */
function stripSummaryPrefix(summary, detail) {
  const heading = typeof summary === 'string' ? summary.trim() : '';
  const text = typeof detail === 'string' ? detail.trim() : '';
  if (!heading || !text.startsWith(heading)) return text;
  const rest = text.slice(heading.length);
  // "Authentication failedness" is not a repeat of "Authentication failed".
  if (rest && !SUMMARY_SEPARATORS.test(rest)) return text;
  return rest.replace(SUMMARY_SEPARATORS, '').trim();
}

/**
 * Writes a status message, preserving any active progress indicator.
 *
 * The message goes in its own child node so the indicator survives repeated
 * updates; `status.textContent` still returns exactly the message.
 */
function renderConnectionStatus(status, message = '', type = '') {
  if (!status) return;
  let text = status.querySelector('.connection-status-text');
  if (!text) {
    status.textContent = '';
    text = document.createElement('span');
    text.className = 'connection-status-text';
    status.appendChild(text);
  }
  // An error interrupts; progress and results wait their turn. The role and the politeness are set
  // as a pair, before the text: an explicit aria-live outranks the one a role implies, so a
  // role="alert" left on aria-live="polite" would still be announced politely. The markup gives
  // these lines only role="status", so nothing pins the politeness before the first message.
  const interrupting = type === 'error';
  status.setAttribute('role', interrupting ? 'alert' : 'status');
  status.setAttribute('aria-live', interrupting ? 'assertive' : 'polite');
  status.dataset.status = type || '';
  // Empty is visually hidden but not display:none. A live region that is taken out of the page and put
  // back in the same breath as its text gets no announcement from some screen readers, so it stays
  // rendered, and the words are written into a region that is already there.
  status.classList.remove('hidden');
  status.classList.toggle('connection-status-empty', !message);
  text.textContent = message;
  syncProgressIndicator(status);
}

/** Shows or hides the indeterminate waiting indicator on a status line. */
function setConnectionStatusBusy(status, isBusy) {
  if (!status) return;
  if (isBusy) status.dataset.busy = 'true';
  else delete status.dataset.busy;
  syncProgressIndicator(status);
}

/**
 * A translated message for a Home Assistant authorization failure code from the
 * main process (src/ha-oauth.cjs), or '' for a code without one. The main
 * process's own error text is English, so it is only shown as a fallback.
 */
function describeHomeAssistantOAuthError(code) {
  switch (code) {
    case 'OAUTH_INVALID_URL':
      return t('Enter a valid Home Assistant URL before connecting.');
    case 'OAUTH_AUTHORIZATION_CANCELED':
      return t('Home Assistant authorization canceled');
    case 'OAUTH_AUTHORIZATION_DECLINED':
      return t('Authorization was declined in Home Assistant.');
    case 'OAUTH_AUTHORIZATION_TIMEOUT':
      return t('Home Assistant authorization timed out. Try again.');
    case 'OAUTH_STATE_MISMATCH':
      return t(
        'Home Assistant sent back an authorization that does not match this request. Try again.'
      );
    case 'OAUTH_CODE_MISSING':
      return t('Home Assistant did not return an authorization code. Try again.');
    case 'OAUTH_CALLBACK_FAILED':
      return t('Could not start the local listener that receives the authorization. Try again.');
    case 'OAUTH_SERVER_UNREACHABLE':
      return t('Could not reach Home Assistant at that URL.');
    case 'OAUTH_TOKEN_NETWORK':
      return t('Lost the connection to Home Assistant while finishing authorization. Try again.');
    case 'OAUTH_TOKEN_TIMEOUT':
      return t('Home Assistant took too long to finish authorization. Try again.');
    case 'OAUTH_INVALID_GRANT':
      return t('Home Assistant rejected the authorization. Try again.');
    case 'OAUTH_TOKEN_EXCHANGE_FAILED':
    case 'OAUTH_TOKEN_RESPONSE':
      return t('Home Assistant could not complete the authorization. Try again.');
    case 'OAUTH_SECURE_STORAGE_UNAVAILABLE':
      return t(
        'Secure credential storage is unavailable on this system, so the authorization cannot be saved.'
      );
    case 'OAUTH_STORE_READ':
    case 'OAUTH_STORE_INVALID':
    case 'OAUTH_STORE_DECRYPT':
      return t(
        'The saved Home Assistant authorization could not be read. Reconnect with Home Assistant.'
      );
    case 'OAUTH_KEYRING_UNAVAILABLE':
      return t(
        'Your system keyring is locked or not running, so the saved Home Assistant authorization cannot be read. Unlock the keyring, then restart the widget.'
      );
    case 'OAUTH_KEYRING_CANNOT_SAVE':
      return t(
        'Your system keyring is locked or not running, so the authorization cannot be saved. Unlock the keyring, then restart the widget.'
      );
    case 'OAUTH_STORE_WRITE':
      return t('Could not save the Home Assistant authorization.');
    case 'OAUTH_STORE_CLEAR':
      return t('Could not remove the saved Home Assistant authorization.');
    default:
      return '';
  }
}

/** Message for a failed pairing (error.result carries main's code; see startHomeAssistantPairing). */
function describeHomeAssistantOAuthFailure(error) {
  return (
    describeHomeAssistantOAuthError(error?.result?.code) ||
    t('Could not connect to Home Assistant. {{error}}', {
      error: error?.message || t('Unknown error'),
    })
  );
}

// Failures that only mean Home Assistant is unavailable for now; main keeps retrying the refresh.
const OFFLINE_OAUTH_REFRESH_CODES = new Set([
  'OAUTH_TOKEN_NETWORK',
  'OAUTH_TOKEN_TIMEOUT',
  'OAUTH_TOKEN_EXCHANGE_FAILED',
]);

/** Status line for an authorization main could not refresh (oauthStatus 'offline'). */
function describeHomeAssistantOAuthRefreshError(homeAssistant = {}) {
  const code = homeAssistant.oauthLastErrorCode || '';
  if (!homeAssistant.oauthLastError || OFFLINE_OAUTH_REFRESH_CODES.has(code)) {
    return t('Home Assistant is offline. Authorization will retry automatically.');
  }
  return (
    describeHomeAssistantOAuthError(code) ||
    t('Could not connect to Home Assistant. {{error}}', { error: homeAssistant.oauthLastError })
  );
}

/**
 * Why an authorization needs reconnecting (oauthStatus 'reauth_required') when it is not the usual
 * expired or revoked grant: for example a saved authorization this system cannot read. '' otherwise.
 */
function describeHomeAssistantOAuthReauthReason(homeAssistant = {}) {
  const code = homeAssistant.oauthLastErrorCode || '';
  return code === 'OAUTH_INVALID_GRANT' ? '' : describeHomeAssistantOAuthError(code);
}

export {
  createProgressTrack,
  stripSummaryPrefix,
  describeHomeAssistantOAuthError,
  describeHomeAssistantOAuthReauthReason,
  describeHomeAssistantOAuthFailure,
  describeHomeAssistantOAuthRefreshError,
  renderConnectionStatus,
  setConnectionStatusBusy,
};

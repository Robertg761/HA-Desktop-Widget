import { applyDesktopAppearance } from './src/desktop-appearance.js';
import { installClippedTextTooltips } from './src/clipped-text-tooltips.js';
import { installLayerDrag } from './src/layer-drag.js';
import { installRangeProgress } from './src/range-progress.js';
import desktopPinResize from './src/desktop-pin-resize.cjs';
import accelerators from './src/accelerators.cjs';
// Load all required modules (ES Modules)
import log from './src/logger.js';
import {
  initializeDashboardTools,
  recordConnectionIssue,
  refreshDashboardUndoState,
} from './src/dashboard-tools.js';
import state from './src/state.js';
import websocket from './src/websocket.js';
import * as hotkeys from './src/hotkeys.js';
import * as alerts from './src/alerts.js';
import * as notifications from './src/notifications.js';
import * as ui from './src/ui.js';
import * as commandPalette from './src/command-palette.js';
import * as settings from './src/settings.js';
import * as uiUtils from './src/ui-utils.js';
import * as utils from './src/utils.js';
import {
  formatNumber,
  formatTime,
  getLocaleState,
  setLocaleBootstrap,
  t,
  translateDocument,
} from './src/i18n.js';
import { applyCloseButtonIcons, setIconContent } from './src/icons.js';
import { lineIconMarkup, setLineIconContent } from './src/entity-icons.js';
import { animateEnter, syncSlidingIndicator } from './src/motion.js';
import {
  bindTabListKeyboard,
  bindTabListOrientation,
  bindTabTooltips,
  syncRovingTabIndex,
} from './src/tab-navigation.js';
import {
  BASE_RECONNECT_DELAY_MS,
  MAX_RECONNECT_DELAY_MS,
  WS_INITIAL_STATES_TIMEOUT_MS,
} from './src/constants.js';
import { startUpdateStatus } from './src/update-status.js';
import { WeatherEffectsManager } from './src/weather-effects.js';
import { bindWeatherCardPicker } from './src/weather-card.js';
import { SeasonalEffectsManager } from './src/seasonal-effects.js';
import { normalizeQuickAccessConfig } from './src/quick-access-tabs.js';
import { normalizeComparisonGraphsConfig } from './src/comparison-graphs.js';
import { rememberDashboard } from './src/dashboard-history.js';
import {
  handleTrayEntityStateChange,
  initTrayEntityIcons,
  setTrayEntityConnectionState,
  tickTrayEntityIcon,
  refreshTrayEntityIcons,
  syncTrayEntityIconsWithConfig,
} from './src/tray-entity-icons.js';
import { DesktopCompanionClient } from './src/desktop-companion-client.js';
import {
  buildConfigPatchFromApplyPayload,
  buildProfileDocumentFromConfig,
} from './src/profile-schema.js';
import { createElectronHost } from '@hadw/renderer/electron-host.js';
import { setRendererHost, getRendererHost, hasRendererHost } from '@hadw/renderer/host.js';
import {
  installClimateDemo,
  isClimateDemoConfig,
  isClimateDemoOverlayConfig,
} from '@dev-climate-demo';
import {
  getConnectionIdentity,
  isConfigured,
  isExpectedPairingFailure,
  normalizeBaseUrl,
  startHomeAssistantPairing,
} from './src/connection.js';
import {
  createProgressTrack,
  describeHomeAssistantOAuthFailure,
  describeHomeAssistantOAuthReauthReason,
  describeHomeAssistantOAuthRefreshError,
  renderConnectionStatus,
  setConnectionStatusBusy,
  stripSummaryPrefix,
} from './src/connection-status.js';

// Shared renderer modules reach the desktop surface only through this host. The panel preview
// injects its own before it boots this file; it must not be replaced by one that says Electron.
if (window.electronAPI && !hasRendererHost()) {
  setRendererHost(createElectronHost(window.electronAPI));
}

const OFFLINE_CONNECTION_ERROR_KEY = 'offline-network';
const FAVORITE_STALE_ENTITY_PRESERVE_MS = 15 * 60 * 1000;
// How long a favorite that a reconnect left out of get_states keeps showing its last state as if
// it were live. After this it shows as unavailable until Home Assistant reports it again.
const FAVORITE_STALE_LIVE_MS = 60 * 1000;
const STATE_CHANGED_HIDDEN_FLUSH_DELAY_MS = 50;
const WIZARD_WAIT_NOTICE_DELAY_MS = 4000;
// A frame callback is skipped while the window is hidden, minimised or covered, and the window can
// go hidden after the callback was requested; this timer is what flushes then.
const STATE_CHANGED_FRAME_FALLBACK_MS = 250;
const WINDOW_QUERY = new URLSearchParams(window.location.search);
const WINDOW_MODE = WINDOW_QUERY.get('mode') || '';
const IS_DESKTOP_PIN_MODE = WINDOW_MODE === 'desktop-pin';
const { getDesktopPinResizeKeyDelta, getDesktopPinResizeRequest, getPointerScreenFactor } =
  desktopPinResize;
const IS_SPECIAL_PIN_MODE = IS_DESKTOP_PIN_MODE;
const DESKTOP_PIN_ENTITY_ID = WINDOW_QUERY.get('entityId') || '';
// Only the main window renders tray entity icons; pin windows share this script but not the job.
if (window.electronAPI && !IS_DESKTOP_PIN_MODE && getRendererHost().capabilities.supportsTray) {
  initTrayEntityIcons({ electronAPI: window.electronAPI, platform: window.electronAPI.platform });
}
let desktopPinEditMode = false;
let desktopPinBounds = null;
let desktopPinHasSnapshot = false;
let desktopPinSupportsWindowPositioning = true;
let desktopPinConnectionIssue = '';
const favoriteStalePreservation = new Map();
let staleFavoriteTimerId = null;
let entityRenameMigrationQueue = Promise.resolve();

async function persistEntityRegistryRename(eventData = {}) {
  const oldEntityId =
    typeof eventData.old_entity_id === 'string' ? eventData.old_entity_id.trim() : '';
  const newEntityId = typeof eventData.entity_id === 'string' ? eventData.entity_id.trim() : '';
  if (
    eventData.action !== 'update' ||
    !oldEntityId ||
    !newEntityId ||
    oldEntityId === newEntityId
  ) {
    return;
  }

  try {
    const replacement = await window.electronAPI.replaceConfigEntityId(oldEntityId, newEntityId);
    const authoritativeConfig = replacement?.config;
    favoriteStalePreservation.delete(oldEntityId);
    if (authoritativeConfig?.homeAssistant) {
      applyRendererConfig(authoritativeConfig);
    }
    if (!replacement?.changed) {
      emitRendererDebug('config.entity_registry_rename.no_references', {
        oldEntityId,
        newEntityId,
      });
      return;
    }
    if (configuredRuntimeStarted) alerts.initializeEntityAlerts();
    renderCurrentMode();
    uiUtils.showToast(
      t('Updated saved references from {{oldEntityId}} to {{newEntityId}}', {
        oldEntityId,
        newEntityId,
      }),
      'success',
      5000
    );
    emitRendererDebug('config.entity_registry_rename.persisted', {
      oldEntityId,
      newEntityId,
    });
  } catch (error) {
    log.error(
      `Failed to persist Home Assistant entity rename ${oldEntityId} -> ${newEntityId}:`,
      error
    );
    uiUtils.showToast(
      t(
        'Could not update saved references for {{oldEntityId}}. Click its unavailable tile to repair it.',
        {
          oldEntityId,
        }
      ),
      'warning',
      10000
    );
    emitRendererDebug('config.entity_registry_rename.persist_error', {
      oldEntityId,
      newEntityId,
      error: error?.message || String(error),
    });
  }
}

function queueEntityRegistryRename(eventData) {
  entityRenameMigrationQueue = entityRenameMigrationQueue
    .catch(() => {})
    .then(() => persistEntityRegistryRename(eventData));
}

function emitRendererDebug(event, details = {}) {
  try {
    if (!state.CONFIG?.ui?.enableInteractionDebugLogs) return;
    if (!window?.electronAPI?.debugLog) return;
    window.electronAPI
      .debugLog({
        scope: 'renderer',
        event,
        details: {
          timestamp: new Date().toISOString(),
          ...details,
        },
      })
      .catch(() => {});
  } catch {
    // no-op: debug logging must never break renderer flow
  }
}

// --- Renderer Log Configuration ---
log.errorHandler.startCatching();
if (log?.transports?.console) {
  log.transports.console.level = 'warn';
}

// Log renderer process startup
log.info('Renderer process started.');

// --- WebSocket Event Handlers ---
websocket.on('open', () => {
  try {
    log.debug('WebSocket connection opened');
    if (websocket.ws && websocket.ws.readyState === WebSocket.OPEN) {
      const authMessage = {
        type: 'auth',
        access_token: state.CONFIG.homeAssistant.token,
      };
      websocket.ws.send(JSON.stringify(authMessage));
    }
  } catch (error) {
    log.error('Error handling WebSocket open:', error);
  }
});

// Track request IDs for proper result handling
let getStatesId, getServicesId, getAreasId, getConfigId;

// WebSocket reconnection state
let reconnectAttempts = 0;
// First snapshots in a row that ran out of time. Each one gives the next twice as long (up to
// four times the first wait): a server that answers the login but needs longer than that to send
// every entity would otherwise be asked again, from the start, forever.
let snapshotTimeoutsInARow = 0;
const MAX_SNAPSHOT_TIMEOUT_GROWTH = 4;
let reconnectTimerId = null;
let uiTickTimerId = null;
let uiTickSchedulerStarted = false;
let uiTickNudgeTimerId = null;
let offlineConnectionToastShown = false;
// Kinds of connection failure already reported in this outage, and the toasts showing them.
const shownConnectionToastKeys = new Set();
let connectionErrorLoggedThisOutage = false;
let browserReportedOffline = false;
let lastDisconnectReason = '';
let mainConnectionState = 'idle';
// Retry on the connection panel. A refused port fails again within milliseconds, which would
// rebuild the panel exactly as it was and look like a click that did nothing. So the panel says
// "Retrying..." for a moment, and then says that the retry did not get through, and when.
const RETRY_FEEDBACK_MS = 700;
let retryFeedbackUntil = 0;
let retryFeedbackTimerId = null;
let lastManualRetryAt = 0;
// One refresh per rejected token: if Home Assistant also rejects the refreshed token, asking
// again would only loop, so the user is asked to reconnect instead.
let oauthAuthRecoveryAttempted = false;
let oauthAuthRefreshInFlight = false;
// The main window's own reconnect prompt for an expired or revoked authorization.
let oauthReauthorization = { pending: false, error: '' };
function updateMainConnectionState(nextState) {
  mainConnectionState = nextState;
  if (nextState === 'connected') {
    lastManualRetryAt = 0;
    retryFeedbackUntil = 0;
  }
  if (!IS_DESKTOP_PIN_MODE) {
    window.electronAPI
      .publishHaConnectionState?.(nextState === 'demo' ? 'connected' : nextState)
      ?.catch((error) => {
        log.warn('Failed to publish Home Assistant connection state:', error);
      });
  }
  if (!IS_DESKTOP_PIN_MODE && nextState !== 'connected') setTrayEntityConnectionState(false);
}
let firstRunWizard = null;
let firstRunSettingsObserver = null;
let configuredRuntimeStarted = false;
let climateDemoController = null;
let desktopCompanionClient = null;
const pendingStateChangedEntities = new Map();
let pendingStateChangedFrameId = null;
let pendingStateChangedTimerId = null;
let desktopPinStatePublishingActive = false;
// The pinned entities whose state main was sent, so a pin added later is sent too.
let desktopPinPublishedIds = new Set();
let haStatesSnapshotReceived = false;
// The Omarchy bar tiles last sent to main, serialized, so unchanged sets are not sent again.
let publishedOmarchyBarTiles = '';
const UI_TICK_ACTIVE_INTERVAL_MS = 1000;
const UI_TICK_IDLE_POLL_INTERVAL_MS = 15000;
const UI_TICK_MINUTE_BUFFER_MS = 50;

function clearReconnectTimer() {
  if (!reconnectTimerId) return;
  clearTimeout(reconnectTimerId);
  reconnectTimerId = null;
}

// websocket.close() is an intentional close, which never emits "close", so the pending duration
// alerts are only suspended when it is told here. Left running they would fire on an outage the
// widget already knows about, after the condition may have ended ("front door open for 10 minutes"
// notifying about a door closed while the Wi-Fi was down).
function closeWebSocket() {
  alerts.suspendEntityAlerts?.();
  websocket.close();
}

function connectWebSocket() {
  if (IS_DESKTOP_PIN_MODE) return;
  clearReconnectTimer();
  // An OAuth setup without a usable access token (restore pending, offline, or expired) has
  // nothing to connect with; trying would only report the placeholder token. Main reconnects
  // through the config broadcast once it has a token.
  if (usesOAuth() && !isConfigured(state.CONFIG)) {
    setOAuthRestoreStatus();
    renderMainWidgetState();
    return;
  }
  updateMainConnectionState('connecting');
  setConnectingStatus();
  renderMainWidgetState();
  websocket.connect();
}

// The indicator's words while a connection is being made. A new attempt forgets why the last one
// failed, so the panel does not say it under "Connecting" while this one is under way.
function setConnectingStatus() {
  lastDisconnectReason = '';
  uiUtils.setStatus(false, t('Waiting for live Home Assistant data...'));
}

function setDisconnectedStatus(detailMessage = '') {
  const normalizedDetail = typeof detailMessage === 'string' ? detailMessage.trim() : '';
  if (normalizedDetail) {
    lastDisconnectReason = normalizedDetail;
    settings.refreshHomeAssistantAuthStatus?.();
  }
  uiUtils.setStatus(
    false,
    lastDisconnectReason || t('Disconnected from Home Assistant. Retrying automatically.')
  );
}

function setConnectedStatus(detailMessage = t('Real-time updates active.')) {
  lastDisconnectReason = '';
  uiUtils.setStatus(true, detailMessage);
}

function setDesktopPinConnectionIssue(detailMessage = '') {
  desktopPinConnectionIssue = typeof detailMessage === 'string' ? detailMessage.trim() : '';
}

function applyDesktopPinConnectionState(connection = {}) {
  const oauth = connection.authMethod === 'oauth';
  if (connection.secureStoragePending === true) {
    setDesktopPinConnectionIssue(t('Unlocking saved Home Assistant credentials...'));
  } else if (connection.hasUrl !== true) {
    // A pin has no Settings button of its own; the widget is where the connection is set up.
    setDesktopPinConnectionIssue(
      t('Not set up yet. Open the widget to connect to Home Assistant.')
    );
  } else if (oauth && connection.oauthStatus === 'reauth_required') {
    setDesktopPinConnectionIssue(getOAuthReauthRequiredStatus());
  } else if (oauth && connection.hasToken !== true) {
    // Configured, but the saved authorization has not been restored yet (Home Assistant down).
    setDesktopPinConnectionIssue(t('Disconnected from Home Assistant. Retrying automatically.'));
  } else if (connection.hasToken !== true) {
    setDesktopPinConnectionIssue(t('No access token is saved. Open the widget to enter one.'));
  } else if (connection.runtimeState === 'auth-failed') {
    setDesktopPinConnectionIssue(getAuthFailureMessage(oauth));
  } else if (connection.runtimeState && connection.runtimeState !== 'connected') {
    setDesktopPinConnectionIssue(t('Disconnected from Home Assistant. Retrying automatically.'));
  } else {
    setDesktopPinConnectionIssue('');
  }
}

function isSecureStoragePending(targetConfig = state.CONFIG) {
  return targetConfig?.secureStoragePending === true;
}

// Why the saved token could not be used: this computer could not decrypt it ('decryption_failed'),
// there was no keyring to decrypt it with ('encryption_unavailable'), or there was none to save it
// to when it was entered ('not_persisted'). Main forgets a keyring reason once told it was seen and
// keeps 'not_persisted' until a token is saved; this keeps either until a token is entered, because
// it is what tells a setup that lost its token from a first run.
let tokenRecoveryReason = '';

// A setup whose server was cleared too is set up again from the start, whatever the reason says.
function needsTokenReentry() {
  return (
    !!tokenRecoveryReason &&
    !!state.CONFIG?.homeAssistant?.url &&
    !usesOAuth() &&
    !isConfigured(state.CONFIG) &&
    !isSecureStoragePending() &&
    !IS_DESKTOP_PIN_MODE
  );
}

// Takes the reason main sent with a config, tells main it was seen, and forgets it once a token
// works or the setup moved to browser authorization.
function noteTokenRecoveryReason() {
  const reason = state.CONFIG?.tokenResetReason;
  if (reason) delete state.CONFIG.tokenResetReason;
  // Main sends 'not_persisted' with every config until a token is saved; it is news only once.
  if (reason && reason !== tokenRecoveryReason) {
    log.warn('Saved Home Assistant token cannot be used:', reason);
    void window.electronAPI.clearTokenResetReason?.().catch((error) => {
      log.error('Failed to acknowledge token recovery notice:', error);
      uiUtils.showToast(
        t('Could not save the token recovery acknowledgement. {{error}}', {
          error: error?.message || t('Unknown error'),
        }),
        'error',
        10000
      );
    });
  }
  if (isConfigured(state.CONFIG) || usesOAuth()) tokenRecoveryReason = '';
  else if (reason) tokenRecoveryReason = reason;
}

// What the panel says about a token that has to be entered again. Every message ends with what to
// do, and none names a place: the panel's button goes there, and Settings shows the same words.
function getTokenRecoveryPanel() {
  if (!needsTokenReentry()) return null;
  const linux = window.electronAPI?.platform === 'linux';
  const enterToken = {
    label: t('Enter token'),
    className: 'btn btn-primary',
    onClick: openTokenSettings,
  };
  if (tokenRecoveryReason === 'encryption_unavailable' && linux) {
    // The encrypted token is still on disk: unlocking the keyring and restarting brings it back.
    // The title names the locked keyring, so the message starts with what that means for the token.
    return {
      tone: 'error',
      title: t('System keyring is locked'),
      message: t(
        'The saved Home Assistant token cannot be read until the system keyring is unlocked. Unlock it, then restart the widget.'
      ),
      actions: [
        { label: t('Restart Widget'), className: 'btn btn-primary', onClick: restartWidget },
        { ...enterToken, className: 'btn btn-secondary' },
      ],
    };
  }
  if (tokenRecoveryReason === 'not_persisted') {
    return {
      tone: 'error',
      title: t('Access token was not saved'),
      message: linux
        ? t(
            'No unlocked system keyring (Secret Service) was found when the access token was entered, so it was not saved. Enter it again, and start gnome-keyring or KWallet so it is remembered.'
          )
        : t(
            'Token encryption is not available on this system, so the access token was not saved. Enter it again to reconnect.'
          ),
      actions: [enterToken],
    };
  }
  return {
    tone: 'error',
    title: t('Saved token cannot be read'),
    message:
      tokenRecoveryReason === 'encryption_unavailable'
        ? t(
            'Token encryption is not available on this system, so the saved Home Assistant token cannot be read. Enter the token again to reconnect.'
          )
        : t(
            'This computer cannot decrypt the saved Home Assistant token. That happens after moving to another computer or user account. Enter the token again to reconnect.'
          ),
    actions: [enterToken],
  };
}

// The connection state of a setup whose token has to be entered again: the header and Settings say
// what the panel says.
function showTokenRecovery() {
  const panel = getTokenRecoveryPanel();
  if (!panel) return false;
  if (mainConnectionState !== 'disconnected') updateMainConnectionState('disconnected');
  setDisconnectedStatus(panel.message);
  uiUtils.showLoading(false);
  renderMainWidgetState();
  return true;
}

// The indicator's words for a setup with no server yet. The wizard is where it is set up, and the
// header's Settings button is hidden while the wizard is up, so the words do not point at it.
function getNotSetUpStatus() {
  return t('Not set up yet. Finish setup to connect to Home Assistant.');
}

function usesOAuth(targetConfig = state.CONFIG) {
  return targetConfig?.homeAssistant?.authMethod === 'oauth';
}

function getOAuthStatus(targetConfig = state.CONFIG) {
  return usesOAuth(targetConfig) ? targetConfig.homeAssistant.oauthStatus || '' : '';
}

function getAuthFailureMessage(oauth = usesOAuth()) {
  return oauth
    ? t(
        'Home Assistant rejected the authorization for this app. Reconnect with Home Assistant to continue.'
      )
    : t('Authentication failed. Check your long-lived access token in Settings.');
}

function getOAuthReauthRequiredStatus() {
  return t('Home Assistant authorization expired. Reconnect with Home Assistant in Settings.');
}

// Status for an OAuth setup whose saved authorization is not usable yet.
function setOAuthRestoreStatus() {
  const homeAssistant = state.CONFIG?.homeAssistant || {};
  if (homeAssistant.oauthStatus === 'reauth_required') {
    recordConnectionIssue('authorization_failed');
    if (mainConnectionState !== 'auth-failed') updateMainConnectionState('auth-failed');
    setDisconnectedStatus(
      describeHomeAssistantOAuthReauthReason(homeAssistant) || getOAuthReauthRequiredStatus()
    );
    return;
  }
  // Without an access token there is no socket to report the outage, so record it here.
  if (homeAssistant.oauthStatus !== 'restoring') recordConnectionIssue('authorization_unavailable');
  setDisconnectedStatus(
    homeAssistant.oauthStatus === 'restoring'
      ? t('Restoring Home Assistant authorization...')
      : describeHomeAssistantOAuthRefreshError(homeAssistant)
  );
}

function hasDesktopPinsConfigured() {
  const desktopPins = state.CONFIG?.desktopPins;
  return !!desktopPins && Object.keys(desktopPins).length > 0;
}

function isDesktopPinEntity(entityId) {
  const desktopPins = state.CONFIG?.desktopPins;
  return !!desktopPins && Object.prototype.hasOwnProperty.call(desktopPins, entityId);
}

// A pin window shows its own entity and main reads nothing else from what is published, so the
// rest of the state map would only cost a structured clone per event (and a full copy in main).
function getDesktopPinStates() {
  const states = state.STATES || {};
  const pinned = {};
  Object.keys(state.CONFIG?.desktopPins || {}).forEach((entityId) => {
    if (states[entityId]) pinned[entityId] = states[entityId];
  });
  return pinned;
}

let inflightDesktopPinSnapshotPublish = null;
function publishDesktopPinSnapshotNow() {
  desktopPinPublishedIds = new Set(Object.keys(state.CONFIG?.desktopPins || {}));
  const publish = window.electronAPI
    .publishHaSnapshot(getDesktopPinStates())
    .catch((error) => {
      log.warn('Failed to publish HA snapshot to main process:', error);
      return null;
    })
    .finally(() => {
      if (inflightDesktopPinSnapshotPublish === publish) {
        inflightDesktopPinSnapshotPublish = null;
      }
    });
  inflightDesktopPinSnapshotPublish = publish;
  return publish;
}

// Serializing the full state map over IPC is the most expensive renderer-to-main call,
// and duplicate triggers (a pin-add transition plus main's snapshot request for the same
// moment, or several pin windows bootstrapping in one burst) would each pay it. Callers
// that merely need *a* snapshot delivered coalesce onto the in-flight publish; callers
// with a fresh state map (reconnect, entity deletion) must not, since the in-flight
// clone predates it. Joining is only proof of delivery if main accepted the publish:
// main discards publishes that race an unpin (`discarded`), and a rejected invoke
// resolves null here — in both cases the joiner still owes main a snapshot, so it
// re-publishes once.
function publishDesktopPinSnapshot({ coalesce = false } = {}) {
  if (coalesce && inflightDesktopPinSnapshotPublish) {
    return inflightDesktopPinSnapshotPublish.then((result) => {
      if (result && !result.discarded) return result;
      if (!hasDesktopPinsConfigured() || !haStatesSnapshotReceived) return result;
      // One fresh attempt; sibling joiners of the failed publish share it instead of
      // stacking further retries.
      return inflightDesktopPinSnapshotPublish || publishDesktopPinSnapshotNow();
    });
  }
  return publishDesktopPinSnapshotNow();
}

// Desktop pin windows are the only consumer of the renderer-to-main state publishes, so
// publishing pauses entirely while no pins are configured and main drops its cached copy.
// The first pin after such a pause needs a full snapshot before per-entity updates mean
// anything again, whether it was added here or arrived through a synced profile. This is
// the only writer of desktopPinStatePublishingActive; callers that need a publish even
// without an inactive→active transition pass force.
function refreshDesktopPinStatePublishing({ force = false, coalesce = true } = {}) {
  if (IS_DESKTOP_PIN_MODE) return;
  const active = hasDesktopPinsConfigured();
  const becameActive = active !== desktopPinStatePublishingActive;
  desktopPinStatePublishingActive = active;
  // Only the pinned entities are published, so a pin added next to others needs its own state sent.
  desktopPinPublishedIds.forEach((entityId) => {
    if (!isDesktopPinEntity(entityId)) desktopPinPublishedIds.delete(entityId);
  });
  const gainedPin = Object.keys(state.CONFIG?.desktopPins || {}).some(
    (entityId) => !desktopPinPublishedIds.has(entityId)
  );
  if (!becameActive && !force && !gainedPin) return;
  if (!active || !haStatesSnapshotReceived) return;
  // A publish already in flight was built before this pin existed, so it cannot stand in.
  publishDesktopPinSnapshot({ coalesce: coalesce && !gainedPin });
}

/**
 * The Omarchy bar plugin mirrors the Quick Access tiles main names in config.omarchyBarEntities
 * (empty everywhere else). Describe those tiles for it, with the line icons they use, and send the
 * set whenever it differs from the last one sent: the list changed, a fresh snapshot arrived
 * (force), or one of the entities, its name or its icon changed.
 */
function publishOmarchyBarTiles({ force = false } = {}) {
  if (IS_DESKTOP_PIN_MODE) return;
  const ids = Array.isArray(state.CONFIG?.omarchyBarEntities)
    ? state.CONFIG.omarchyBarEntities
    : [];
  if (!ids.length && !publishedOmarchyBarTiles) return;
  if (ids.length && !haStatesSnapshotReceived) return;
  const tiles = {};
  const icons = {};
  ids.forEach((entityId) => {
    const tile = ui.describeQuickAccessTile(entityId);
    if (!tile) return;
    tiles[entityId] = tile;
    // A glyph's line icon goes too, for main to draw where the bar's font lacks the glyph.
    const lineIcon = tile.icon?.kind === 'line' ? tile.icon.name : tile.icon?.fallback;
    if (lineIcon && !icons[lineIcon]) {
      // Sized in pixels: the shell draws it as an image, where 1em means nothing.
      icons[lineIcon] = lineIconMarkup(lineIcon).replace(
        'width="1em" height="1em"',
        'width="24" height="24"'
      );
    }
  });
  const payload = { tiles, icons };
  const serialized = JSON.stringify(payload);
  if (!force && serialized === publishedOmarchyBarTiles) return;
  publishedOmarchyBarTiles = serialized;
  window.electronAPI.publishOmarchyBarTiles?.(payload)?.catch((error) => {
    log.warn('Failed to publish Omarchy bar tiles:', error);
  });
}

function flushPendingStateChangedEntities() {
  cancelPendingStateChangedFlush();
  // Whether anything visible counts down is decided inside ui.updateEntityInUI, from the entity it
  // is given, so it is read on both sides of the updates below.
  const hadVisibleTimers = hasVisibleTimersToTick();
  const changedEntityIds = Array.from(pendingStateChangedEntities.keys());
  const changes = Array.from(pendingStateChangedEntities.values());
  pendingStateChangedEntities.clear();
  const hasDeletion = changes.some(({ entity }) => !entity);
  const publishForDesktopPins = hasDesktopPinsConfigured();
  // Only a removed pin changes what main holds; the rest of the home is not published.
  const hasPinDeletion =
    publishForDesktopPins &&
    changes.some(({ entity }, index) => !entity && isDesktopPinEntity(changedEntityIds[index]));
  const omarchyBarEntities = state.CONFIG?.omarchyBarEntities;
  if (
    Array.isArray(omarchyBarEntities) &&
    changedEntityIds.some((entityId) => omarchyBarEntities.includes(entityId))
  ) {
    publishOmarchyBarTiles();
  }

  if (hasPinDeletion) {
    // A full snapshot is the only renderer-to-main IPC operation that can remove
    // an entity from the desktop-pin cache. It also carries every coalesced update
    // in this flush, avoiding an update/snapshot ordering race. No coalescing: the
    // map just lost an entity that an in-flight publish still carries.
    void publishDesktopPinSnapshot();
  }

  changes.forEach(({ entity, local }) => {
    if (!entity) return;
    if (!hasPinDeletion && publishForDesktopPins && isDesktopPinEntity(entity.entity_id)) {
      window.electronAPI.publishHaEntityUpdate(entity).catch((error) => {
        log.warn('Failed to publish HA entity update to main process:', error);
      });
    }
    if (IS_SPECIAL_PIN_MODE && entity.entity_id === DESKTOP_PIN_ENTITY_ID) {
      renderCurrentMode();
    } else if (ui.isEntityVisible(entity.entity_id)) {
      ui.updateEntityInUI(entity);
    }
    // A state the widget put there itself is not news from Home Assistant, so no alert rule hears it.
    if (!local) alerts.checkEntityAlerts(entity.entity_id, entity.state);
  });

  if (!IS_DESKTOP_PIN_MODE) {
    changedEntityIds.forEach((entityId) => handleTrayEntityStateChange(entityId));
  }

  // A removal only changes what is drawn when the entity is drawn: a burst of removals while Home
  // Assistant reloads an integration would otherwise rebuild the whole page every frame.
  let redrawn = false;
  if (hasDeletion) {
    const removedFromView = changes.some(
      ({ entity }, index) => !entity && ui.isEntityVisible(changedEntityIds[index])
    );
    if (removedFromView) {
      redrawn = true;
      if (IS_SPECIAL_PIN_MODE) {
        renderCurrentMode();
      } else {
        ui.renderActiveTab();
        renderMainWidgetState();
      }
    }
  }

  // The tick only needs a look when what it runs for may have changed: a redraw, the player whose
  // seek bar it moves, or whether a visible entity now counts down (a sensor that gains a finish
  // time, or loses it). A running countdown and the clock keep their own cadence, but with nothing
  // counting down before, the tick would not look for this one until its idle poll.
  const primaryMediaPlayer = state.CONFIG?.primaryMediaPlayer;
  if (
    redrawn ||
    (primaryMediaPlayer && changedEntityIds.includes(primaryMediaPlayer)) ||
    hasVisibleTimersToTick() !== hadVisibleTimers
  ) {
    nudgeUiTickScheduler();
  }
}

function hasVisibleTimersToTick() {
  return Boolean(ui.getTickTargets?.()?.hasVisibleTimers);
}

function cancelPendingStateChangedFlush() {
  if (pendingStateChangedFrameId != null) {
    window.cancelAnimationFrame?.(pendingStateChangedFrameId);
    pendingStateChangedFrameId = null;
  }
  if (pendingStateChangedTimerId != null) {
    window.clearTimeout(pendingStateChangedTimerId);
    pendingStateChangedTimerId = null;
  }
}

// Chromium does not run animation frames for a window that is hidden or covered. A frame requested
// just before the window went to the tray never fires, and with only that frame to wait for, the
// flush stayed "pending" and every later event returned here: alerts, pins and the Omarchy bar
// stopped until the window was shown. A timer is armed beside the frame, and whichever runs first
// cancels the other.
function scheduleStateChangedFlush() {
  if (pendingStateChangedFrameId != null || pendingStateChangedTimerId != null) return;
  const canUseRaf = typeof window.requestAnimationFrame === 'function' && !document.hidden;
  if (canUseRaf) {
    pendingStateChangedFrameId = window.requestAnimationFrame(flushPendingStateChangedEntities);
  }
  pendingStateChangedTimerId = window.setTimeout(
    flushPendingStateChangedEntities,
    canUseRaf ? STATE_CHANGED_FRAME_FALLBACK_MS : STATE_CHANGED_HIDDEN_FLUSH_DELAY_MS
  );
}

// `local` marks a state the widget derived rather than received (see markStaleFavoritesUnavailable).
function queueStateChangedEntity(entity, { local = false } = {}) {
  if (!entity?.entity_id) return;
  state.setEntityState(entity);
  // Home Assistant has spoken for it, so a reconnect that leaves it out again starts a new omission
  // with a fresh grace. The check below only looks a minute after a reconnect, which a connection
  // that keeps dropping never reaches, and the 15 minutes would run on from the first omission.
  if (!local) favoriteStalePreservation.delete(entity.entity_id);
  // Hidden dashboard flushes are throttled; tray updates must follow the live event itself.
  if (!IS_DESKTOP_PIN_MODE && document.hidden) handleTrayEntityStateChange(entity.entity_id);
  pendingStateChangedEntities.set(entity.entity_id, {
    entity,
    local,
  });
  scheduleStateChangedFlush();
}

function queueDeletedEntity(entityId) {
  const normalizedEntityId = typeof entityId === 'string' ? entityId.trim() : '';
  if (!normalizedEntityId) return;
  state.deleteEntityState(normalizedEntityId);
  if (!IS_DESKTOP_PIN_MODE && document.hidden) handleTrayEntityStateChange(normalizedEntityId);
  favoriteStalePreservation.delete(normalizedEntityId);
  pendingStateChangedEntities.set(normalizedEntityId, {
    entity: null,
  });
  scheduleStateChangedFlush();
}

// A favorite that is kept through a reconnect shows its last state, so that a Home Assistant
// restart does not flash every tile to Unavailable while its integration loads. One that Home
// Assistant has still not reported a minute later was probably removed or renamed while this
// computer was offline, and a tile that says "On, 50%" for it is wrong. It becomes unavailable,
// through the same path as any state change, so tiles, pins and the tray agree. Alerts do not hear
// it: Home Assistant never reported an outage, and a State Change alert that tells about devices
// going unavailable would otherwise announce every entity that was deleted while the app was away.
function scheduleStaleFavoriteCheck() {
  window.clearTimeout(staleFavoriteTimerId);
  staleFavoriteTimerId = null;
  if (IS_DESKTOP_PIN_MODE || !favoriteStalePreservation.size) return;
  staleFavoriteTimerId = window.setTimeout(markStaleFavoritesUnavailable, FAVORITE_STALE_LIVE_MS);
}

function markStaleFavoritesUnavailable() {
  staleFavoriteTimerId = null;
  favoriteStalePreservation.forEach((record, entityId) => {
    const entity = state.STATES?.[entityId];
    // Any event since the reconnect replaced the object: Home Assistant has spoken for it, so there
    // is nothing left to track.
    if (!entity || entity !== record.entity) {
      favoriteStalePreservation.delete(entityId);
      return;
    }
    if (entity.state === 'unavailable') return;
    record.entity = { ...entity, state: 'unavailable' };
    queueStateChangedEntity(record.entity, { local: true });
  });
}

function reconcileFavoriteStalePreservation(newStates) {
  const oldStates = state.STATES || {};
  const favoriteEntityIds = [
    ...new Set(
      Array.isArray(state.CONFIG?.favoriteEntities)
        ? state.CONFIG.favoriteEntities.filter(
            (entityId) => typeof entityId === 'string' && entityId
          )
        : []
    ),
  ];
  const favoriteEntityIdSet = new Set(favoriteEntityIds);

  Array.from(favoriteStalePreservation.keys()).forEach((entityId) => {
    if (!favoriteEntityIdSet.has(entityId) || newStates[entityId] || !oldStates[entityId]) {
      favoriteStalePreservation.delete(entityId);
    }
  });

  const preservedFavorites = {};
  const droppedStaleFavorites = [];
  const now = Date.now();

  favoriteEntityIds.forEach((entityId) => {
    if (newStates[entityId] || !oldStates[entityId]) {
      favoriteStalePreservation.delete(entityId);
      return;
    }

    const previousRecord = favoriteStalePreservation.get(entityId);
    const missingSince = previousRecord?.missingSince || now;
    const staleAgeMs = Math.max(0, now - missingSince);

    if (staleAgeMs <= FAVORITE_STALE_ENTITY_PRESERVE_MS) {
      preservedFavorites[entityId] = oldStates[entityId];
      favoriteStalePreservation.set(entityId, {
        missingSince,
        lastPreservedAt: now,
        entity: oldStates[entityId],
      });
      return;
    }

    droppedStaleFavorites.push(entityId);
    favoriteStalePreservation.delete(entityId);
  });

  scheduleStaleFavoriteCheck();

  return {
    favoriteCount: favoriteEntityIds.length,
    preservedFavorites,
    droppedStaleFavorites,
  };
}

function getSettingsUiHooks() {
  return {
    initUpdateUI: ui.initUpdateUI,
    relocalizeUpdateStatus: ui.relocalizeUpdateStatus,
    renderActiveTab: ui.renderActiveTab,
    updateMediaTile: ui.updateMediaTile,
    renderPrimaryCards: ui.renderPrimaryCards,
    updateWeatherEffects: ui.updateWeatherEffects,
    // What the red connection panel is saying, so Settings does not look healthy beside it.
    getConnectionState: () => ({
      status: mainConnectionState,
      reason: lastDisconnectReason,
      needsToken: needsTokenReentry(),
      tokenReason: needsTokenReentry() ? tokenRecoveryReason : '',
    }),
    refreshLocale: async () => {
      await refreshLocaleBootstrap();
      renderCurrentMode();
    },
    exitReorganizeMode: () => {
      const container = document.getElementById('quick-controls');
      if (container && container.classList.contains('reorganize-mode')) {
        ui.toggleReorganizeMode();
      }
    },
  };
}

function openSettingsModal() {
  dismissConnectionToasts({ includeStartupWarnings: true });
  settings.openSettings(getSettingsUiHooks());
}

// Settings on General with the access token field open and the cursor in it.
async function openTokenSettings() {
  dismissConnectionToasts({ includeStartupWarnings: true });
  await settings.openSettings(getSettingsUiHooks());
  settings.revealHomeAssistantToken?.();
}

function openQuickAccessModal() {
  ui.populateQuickControlsList();
  const modal = document.getElementById('quick-controls-modal');
  if (!modal) return;
  // The search is where a visit here starts; without it focus would land on the Close button.
  uiUtils.openDialog(modal, { initialFocus: '#quick-controls-search' });
}

function createTextElement(tagName, className, text) {
  const element = document.createElement(tagName);
  if (className) element.className = className;
  element.textContent = text;
  return element;
}

function createActionButton(label, className, onClick) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = className;
  button.textContent = label;
  button.addEventListener('click', onClick);
  return button;
}

function hasDashboardEntities() {
  return normalizeQuickAccessConfig(state.CONFIG || {}).customTabs.some(
    (tab) => Array.isArray(tab.entityIds) && tab.entityIds.length > 0
  );
}

function getActiveQuickAccessPage() {
  const normalized = normalizeQuickAccessConfig(state.CONFIG || {});
  return {
    page:
      normalized.customTabs.find((tab) => tab.id === normalized.activeTabId) ||
      normalized.customTabs[0],
    pageCount: normalized.customTabs.length,
  };
}

function getActiveQuickAccessCount() {
  const { page } = getActiveQuickAccessPage();
  return Array.isArray(page?.entityIds) ? page.entityIds.length : 0;
}

// The title of the last problem the panel announced, so a retry that lands on the same problem again
// stays quiet. Cleared when the panel goes away, which is when the problem has.
let announcedWidgetStateTitle = '';
let announcedWidgetStateNote = '';

function removeWidgetStatePanel() {
  const existingPanel = document.getElementById('widget-state-panel');
  if (existingPanel) {
    // The button that had focus (Retry) goes with the panel; keep the keyboard in the widget.
    const hadFocus = existingPanel.contains(document.activeElement);
    existingPanel.remove();
    if (hadFocus) document.getElementById('settings-btn')?.focus();
  }
  document.body.classList.remove('widget-state-active');
  announcedWidgetStateTitle = '';
  announcedWidgetStateNote = '';
}

// Said through one persistent live region instead of by rebuilding a role="alert" panel: a panel
// that is replaced on every retry is announced again on every retry, for as long as an outage lasts.
function announceWidgetState(text) {
  const live = document.getElementById('widget-state-live');
  if (!live) return;
  live.textContent = '';
  // A tick later, so assistive technology sees a change rather than a region that never emptied.
  setTimeout(() => {
    live.textContent = text;
  }, 50);
}

function createWidgetStateActions(actions) {
  const actionRow = document.createElement('div');
  actionRow.className = 'widget-state-actions';
  actions.forEach((action) => {
    const button = createActionButton(action.label, action.className, action.onClick);
    // The labels name them for the next render, so focus stays on the button it was on. A button
    // whose label changes (Retry, Retrying...) names itself instead.
    button.dataset.focusKey = `widget-state:${action.key || action.label}`;
    // Not `disabled`: a disabled button drops the keyboard's place, and this one is back in a moment.
    if (action.disabled) button.setAttribute('aria-disabled', 'true');
    actionRow.appendChild(button);
  });
  return actionRow;
}

// Under the copy: the server being reached, a note on how the last Retry went, and the waiting bar.
function createWidgetStateDetails({ host, note, busy }) {
  const details = document.createElement('div');
  details.className = 'widget-state-details';
  if (host) {
    const hostElement = createTextElement('p', 'widget-state-host', host);
    // A host name reads left to right whatever the language around it.
    hostElement.dir = 'ltr';
    details.appendChild(hostElement);
  }
  if (note) details.appendChild(createTextElement('p', 'widget-state-note', note));
  if (busy) details.appendChild(createProgressTrack());
  return details;
}

// One connect attempt renders the panel several times (connecting, error, close), and Retry is
// pressed while it does. The panel is therefore kept and updated in place, and a render that would
// change nothing changes nothing: replacing the node moved keyboard focus from Retry to Open Settings.
function renderWidgetStatePanel({
  tone,
  title,
  message,
  host = '',
  note = '',
  busy = false,
  actions = [],
}) {
  const widgetContent = document.querySelector('.widget-content');
  if (!widgetContent) return;
  const labels = actions.map((action) => action.label);
  const signature = JSON.stringify([tone || '', title, message, host, note, busy, labels]);
  let panel = document.getElementById('widget-state-panel');
  if (panel?.dataset.signature === signature) {
    document.body.classList.add('widget-state-active');
    return;
  }

  // A connection problem sits above Quick Access, where it is seen without scrolling and the
  // tiles stay in place; at the end of the page it was below the fold on a full page, and
  // scrolling it into view threw the dashboard to the bottom at every restart of Home Assistant. An
  // empty page has no tiles to push down, so its panel stays where the tiles would be. Neither
  // scrolls the page: the user's place in it is not the panel's to take.
  const tiles = tone === 'empty' ? null : widgetContent.querySelector('.controls-section');

  const isNew = !panel;
  if (isNew) {
    panel = document.createElement('div');
    panel.id = 'widget-state-panel';
    panel.appendChild(createTextElement('h3', 'widget-state-title', title));
    panel.appendChild(createTextElement('p', 'widget-state-copy', message));
    panel.appendChild(createWidgetStateDetails({ host, note, busy }));
    if (tiles) widgetContent.insertBefore(panel, tiles);
    else widgetContent.appendChild(panel);
  } else {
    panel.querySelector('.widget-state-title').textContent = title;
    panel.querySelector('.widget-state-copy').textContent = message;
    panel
      .querySelector('.widget-state-details')
      .replaceWith(createWidgetStateDetails({ host, note, busy }));
    // The empty page's panel becoming a problem (or back) changes where it belongs. Moving it takes
    // focus with it, so a button that had focus gets it back.
    const focused = panel.contains(document.activeElement) ? document.activeElement : null;
    if (tiles && panel.nextElementSibling !== tiles) widgetContent.insertBefore(panel, tiles);
    else if (!tiles && panel.nextElementSibling) widgetContent.appendChild(panel);
    if (focused?.isConnected && document.activeElement !== focused) focused.focus();
  }
  panel.className = `widget-state-panel ${tone ? `widget-state-${tone}` : ''}`.trim();
  if (busy) panel.setAttribute('aria-busy', 'true');
  else panel.removeAttribute('aria-busy');

  if (isNew || JSON.stringify(labels) !== panel.dataset.actionLabels) {
    uiUtils.renderKeepingFocus(panel, () => {
      panel.querySelector('.widget-state-actions')?.remove();
      if (labels.length) panel.appendChild(createWidgetStateActions(actions));
    });
  }
  panel.dataset.signature = signature;
  panel.dataset.actionLabels = JSON.stringify(labels);
  document.body.classList.add('widget-state-active');

  if (tone === 'error' && title !== announcedWidgetStateTitle) {
    announcedWidgetStateTitle = title;
    announceWidgetState(`${title}. ${message}`);
  } else if (tone === 'error' && note && note !== announcedWidgetStateNote) {
    // The same problem after a Retry: the title is not said again, but how the retry went is news.
    announceWidgetState(note);
  }
  announcedWidgetStateNote = note;
}

async function retryOAuthRestore() {
  if (oauthAuthRefreshInFlight) return;
  oauthAuthRefreshInFlight = true;
  try {
    await window.electronAPI.refreshHomeAssistantOAuth?.();
  } catch (error) {
    log.warn('Home Assistant authorization refresh failed:', error);
  } finally {
    oauthAuthRefreshInFlight = false;
  }
}

async function reauthorizeHomeAssistant() {
  if (oauthReauthorization.pending) return;
  const url = normalizeBaseUrl(state.CONFIG?.homeAssistant?.url);
  if (!url) {
    openSettingsModal();
    return;
  }
  oauthReauthorization = { pending: true, error: '' };
  renderMainWidgetState();
  try {
    const result = await startHomeAssistantPairing(window.electronAPI, url);
    if (!result?.config) throw new Error(t('Home Assistant did not return a saved connection.'));
    oauthAuthRecoveryAttempted = false;
    // A running widget reconnects from main's config broadcast for the new authorization.
    // Applying this reply as well would race that broadcast into a second connection.
    if (!configuredRuntimeStarted) {
      applyRendererConfig(result.config);
      startConfiguredRuntime();
    }
  } catch (error) {
    if (error?.result?.code !== 'OAUTH_AUTHORIZATION_CANCELED') {
      log[isExpectedPairingFailure(error) ? 'warn' : 'error'](
        'Failed to reconnect Home Assistant authorization:',
        error
      );
      oauthReauthorization.error = describeHomeAssistantOAuthFailure(error);
    }
  } finally {
    oauthReauthorization.pending = false;
    renderCurrentMode();
  }
}

async function cancelOAuthReauthorization() {
  try {
    await window.electronAPI.cancelHomeAssistantOAuth?.();
  } catch (error) {
    log.warn('Failed to cancel Home Assistant authorization:', error);
  }
}

// The keyring holding the saved authorization was locked or not running when the widget started.
function isKeyringUnavailable() {
  return state.CONFIG?.homeAssistant?.oauthLastErrorCode === 'OAUTH_KEYRING_UNAVAILABLE';
}

function restartWidget() {
  window.electronAPI.restartApp().catch((error) => {
    log.error('Failed to restart widget:', error);
  });
}

// OAuth setups whose saved authorization is not usable right now. They are configured (never
// onboarding), so they get a connection state rather than setup instructions.
function getOAuthStatePanel() {
  if (
    !usesOAuth() ||
    isConfigured(state.CONFIG) ||
    !normalizeBaseUrl(state.CONFIG.homeAssistant.url)
  )
    return null;
  const oauthStatus = getOAuthStatus();
  if (oauthStatus === 'reauth_required') {
    const { pending, error } = oauthReauthorization;
    if (!pending && !error && isKeyringUnavailable()) {
      return {
        tone: 'error',
        title: t('System keyring is locked'),
        message: describeHomeAssistantOAuthReauthReason(state.CONFIG.homeAssistant),
        actions: [
          { label: t('Restart Widget'), className: 'btn btn-primary', onClick: restartWidget },
          {
            label: t('Reconnect with Home Assistant'),
            className: 'btn btn-secondary',
            onClick: reauthorizeHomeAssistant,
          },
        ],
      };
    }
    return {
      tone: 'error',
      title: t('Home Assistant authorization expired'),
      // Pending, the browser has been opened and the widget waits for the answer; the bar says so.
      busy: pending,
      message: pending
        ? t('Waiting for you to approve in your browser...')
        : error ||
          describeHomeAssistantOAuthReauthReason(state.CONFIG.homeAssistant) ||
          t(
            'Home Assistant no longer accepts the authorization for this app. It may have expired or been revoked. Reconnect with Home Assistant to continue.'
          ),
      actions: pending
        ? [
            {
              label: t('Cancel'),
              className: 'btn btn-secondary btn-neutral',
              onClick: cancelOAuthReauthorization,
            },
          ]
        : [
            {
              label: t('Reconnect with Home Assistant'),
              className: 'btn btn-primary',
              onClick: reauthorizeHomeAssistant,
            },
            {
              label: t('Open Settings'),
              className: 'btn btn-secondary',
              onClick: openSettingsModal,
            },
          ],
    };
  }
  if (oauthStatus === 'restoring') {
    return {
      tone: '',
      title: t('Waiting for live Home Assistant data...'),
      message: t('Restoring Home Assistant authorization...'),
      actions: [
        { label: t('Open Settings'), className: 'btn btn-primary', onClick: openSettingsModal },
      ],
    };
  }
  return {
    tone: 'error',
    title: t('Home Assistant is disconnected'),
    message: describeHomeAssistantOAuthRefreshError(state.CONFIG.homeAssistant),
    actions: [
      { label: t('Open Settings'), className: 'btn btn-primary', onClick: openSettingsModal },
      { label: t('Retry'), className: 'btn btn-secondary', onClick: retryOAuthRestore },
    ],
  };
}

function retryConnection() {
  // A second click while "Retrying..." is showing would only restart the attempt it started.
  if (Date.now() < retryFeedbackUntil) return;
  // Retrying is a fresh start: a rejected OAuth token gets its refresh attempt again.
  oauthAuthRecoveryAttempted = false;
  lastManualRetryAt = Date.now();
  retryFeedbackUntil = lastManualRetryAt + RETRY_FEEDBACK_MS;
  clearTimeout(retryFeedbackTimerId);
  // Draws the result of the attempt once "Retrying..." has had its moment on screen.
  retryFeedbackTimerId = setTimeout(() => {
    retryFeedbackTimerId = null;
    renderMainWidgetState();
  }, RETRY_FEEDBACK_MS);
  connectWebSocket();
}

// The server the widget is trying to reach, as host and port; the panel names it so a mistyped
// address is seen for what it is.
function getConfiguredHostLabel() {
  const baseUrl = normalizeBaseUrl(state.CONFIG?.homeAssistant?.url);
  if (!baseUrl) return '';
  try {
    return new URL(baseUrl).host;
  } catch {
    return '';
  }
}

// What the offline panel says under its title. The indicator's "Disconnected from Home Assistant.
// Retrying automatically." is the title said again, so the panel says only what is new.
function describeDisconnectUnderTitle(title) {
  const reason = stripSummaryPrefix(title, lastDisconnectReason);
  return !reason || reason === t('Disconnected from Home Assistant. Retrying automatically.')
    ? t('The connection was lost. Retrying automatically.')
    : reason;
}

function renderMainWidgetState() {
  // An open Settings page shows the same connection problem as the panel, so it follows it.
  settings.refreshHomeAssistantAuthStatus?.();
  // Tiles keep showing what Home Assistant last said while it cannot be reached; the page dims
  // them so a lamp that has since been switched off, or a timer that stopped, does not look live.
  // Connecting counts: every retry and the wait for the first state snapshot after login still
  // show the old values, and the tiles would otherwise flash back to full brightness at each try.
  document.body.classList.toggle(
    'ha-offline',
    !IS_DESKTOP_PIN_MODE &&
      ['disconnected', 'auth-failed', 'connecting'].includes(mainConnectionState)
  );
  if (IS_DESKTOP_PIN_MODE || firstRunWizard?.visible) {
    removeWidgetStatePanel();
    return;
  }
  // A configured setup that cannot connect for want of a credential gets a connection state, not
  // setup instructions.
  const credentialPanel = getOAuthStatePanel() || getTokenRecoveryPanel();
  if (credentialPanel) {
    renderWidgetStatePanel(credentialPanel);
    return;
  }
  if (!isConfigured(state.CONFIG)) {
    removeWidgetStatePanel();
    return;
  }

  const host = getConfiguredHostLabel();
  if (mainConnectionState === 'auth-failed' && usesOAuth()) {
    const title = t('Authentication failed');
    renderWidgetStatePanel({
      tone: 'error',
      title,
      message: stripSummaryPrefix(title, lastDisconnectReason) || getAuthFailureMessage(true),
      host,
      actions: [
        {
          label: t('Reconnect with Home Assistant'),
          className: 'btn btn-primary',
          onClick: reauthorizeHomeAssistant,
        },
        { label: t('Retry'), className: 'btn btn-secondary', onClick: retryConnection },
      ],
    });
    return;
  }

  if (['auth-failed', 'disconnected', 'connecting'].includes(mainConnectionState)) {
    // A Retry that failed at once still shows "connecting" until its feedback time is up.
    const retrying = Date.now() < retryFeedbackUntil && mainConnectionState !== 'auth-failed';
    const connecting = mainConnectionState === 'connecting' || retrying;
    const title = connecting
      ? t('Connecting to Home Assistant...')
      : mainConnectionState === 'auth-failed'
        ? t('Authentication failed')
        : t('Home Assistant is disconnected');
    renderWidgetStatePanel({
      tone: connecting ? '' : 'error',
      title,
      // A reason that opens with the title ("Authentication failed. Check ...") is cut to what it
      // adds. While connecting, the panel only has a reason when something said one on purpose
      // ("Refreshing Home Assistant authorization..."); the last failure's is not shown there.
      message: connecting
        ? (mainConnectionState === 'connecting' &&
            stripSummaryPrefix(title, lastDisconnectReason)) ||
          t('Waiting for live Home Assistant data...')
        : describeDisconnectUnderTitle(title),
      host,
      note:
        !connecting && mainConnectionState === 'disconnected' && lastManualRetryAt
          ? t("Still can't reach Home Assistant (tried {{time}}).", {
              time: formatTime(new Date(lastManualRetryAt), { hour: 'numeric', minute: '2-digit' }),
            })
          : '',
      busy: connecting,
      actions: [
        {
          label: t('Open Settings'),
          className: 'btn btn-primary',
          onClick: openSettingsModal,
        },
        {
          key: 'retry',
          label: retrying ? t('Retrying...') : t('Retry'),
          className: 'btn btn-secondary',
          onClick: retryConnection,
          disabled: retrying,
        },
      ],
    });
    return;
  }

  if (mainConnectionState === 'connected' && getActiveQuickAccessCount() === 0) {
    // Beside other pages it is this page that is empty, not Quick Access as a whole.
    const { page, pageCount } = getActiveQuickAccessPage();
    const onePageOfMany = pageCount > 1;
    renderWidgetStatePanel({
      tone: 'empty',
      title: onePageOfMany ? t('This page is empty') : t('No Quick Access entities yet'),
      message: onePageOfMany
        ? t('Add entities to {{page}} for one-click control.', { page: page.name })
        : t('Add your favorite Home Assistant entities for one-click control.'),
      actions: [
        {
          label: t('Choose rooms and entities'),
          className: 'btn btn-primary',
          onClick: () => ui.showAddPageModal({ starter: true }),
        },
        {
          label: t('Add entities'),
          className: 'btn btn-secondary',
          onClick: openQuickAccessModal,
        },
      ],
    });
    return;
  }

  removeWidgetStatePanel();
}

function setFirstRunWizardVisible(visible) {
  if (!firstRunWizard?.overlay) return;
  const wasVisible = firstRunWizard.visible;
  firstRunWizard.visible = !!visible;
  document.body.classList.toggle('first-run-active', !!visible);
  // The wizard is modal: keep Tab inside it instead of on the header buttons behind it. It starts
  // below the header, which keeps the window's own buttons and drag area working, so the overlay
  // is told where that ends. It asks for an answer, so Escape and the backdrop do nothing.
  if (visible && !wasVisible) {
    const header = document.querySelector('.widget-header');
    if (header) {
      document.documentElement.style.setProperty(
        '--header-height',
        `${Math.ceil(header.getBoundingClientRect().bottom)}px`
      );
    }
    uiUtils.openDialog(firstRunWizard.overlay, {
      display: null,
      labelledBy: 'first-run-title',
      describedBy: 'first-run-copy',
      initialFocus: false,
      dismiss: null,
    });
  } else if (!visible && wasVisible) {
    void uiUtils.closeDialog(firstRunWizard.overlay, { animate: false });
  } else {
    firstRunWizard.overlay.classList.toggle('hidden', !visible);
  }
  if (visible) focusWizardStep();
  renderMainWidgetState();
}

// Each step starts with focus on its URL field or heading, so keyboard and screen reader users
// land on the new content rather than on whichever button changed the step.
function focusWizardStep() {
  if (!firstRunWizard?.visible) return;
  const target =
    firstRunWizard.step === 1
      ? firstRunWizard.urlInput
      : firstRunWizard.content?.querySelector('.first-run-title');
  if (!target?.isConnected) return;
  if (target.tagName === 'H2') target.tabIndex = -1;
  target.focus();
}

function setWizardStatus(message = '', type = '') {
  if (!firstRunWizard?.status) return;
  // Remembered so re-rendering a step can put it back. Authorization runs for minutes, and
  // the message is the only sign it is running at all.
  firstRunWizard.statusMessage = message;
  firstRunWizard.statusType = type;
  // 'pending' here always means waiting on Home Assistant authorization in the
  // browser, so it carries the same sweep indicator the settings panel uses.
  setConnectionStatusBusy(firstRunWizard.status, type === 'pending');
  renderConnectionStatus(firstRunWizard.status, message, type);
}

// Authorization keeps running while the user steps around the wizard, so leaving it has to
// stop it. Otherwise the loopback listener stays open and the next attempt is refused as one
// already in progress.
async function cancelFirstRunAuthorization() {
  if (!firstRunWizard?.finishInProgress) return;
  firstRunWizard.cancelRequested = true;
  try {
    await window.electronAPI?.cancelHomeAssistantOAuth?.();
  } catch (error) {
    log.warn('Failed to cancel Home Assistant authorization:', error);
  }
}

// What is wrong with an address the wizard cannot use: nothing typed, a scheme that is not web, or
// something else (spaces, a missing host).
function describeWizardUrlProblem(rawUrl) {
  const typed = typeof rawUrl === 'string' ? rawUrl.trim() : '';
  if (!typed) return t('Home Assistant URL cannot be empty');
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(typed) && !/^https?:\/\//i.test(typed)) {
    return t('URL must start with http:// or https://');
  }
  return t('Enter a valid Home Assistant URL before connecting.');
}

function getWizardUrl() {
  return firstRunWizard?.urlInput?.value || state.CONFIG?.homeAssistant?.url || '';
}

async function renderFirstRunDesktopHelp(content) {
  try {
    const info = await window.electronAPI.getDesktopIntegration?.();
    if (!info?.hyprland || !info.layerMode || firstRunWizard?.step !== 0 || !content.isConnected)
      return;
    const help = document.createElement('div');
    help.id = 'first-run-desktop-help';
    help.appendChild(
      createTextElement(
        'p',
        'first-run-copy',
        t(
          'On Hyprland, the widget sits underneath normal windows. Use the popup hotkey to bring it forward, or open it from the tray.'
        )
      )
    );
    help.appendChild(
      createTextElement(
        'p',
        'first-run-copy',
        t(
          'Set a popup hotkey in Settings, then copy its binding into your Hyprland configuration. Press it and check here before finishing setup. You can also set it up later.'
        )
      )
    );
    const status = createTextElement('p', 'first-run-copy', '');
    status.setAttribute('role', 'status');
    const baseline = info.lastActivation?.at;
    help.appendChild(
      createActionButton(t('Check popup hotkey'), 'btn btn-secondary', async () => {
        try {
          const current = await window.electronAPI.getDesktopIntegration();
          const received =
            current?.lastActivation?.id === 'popup-toggle' &&
            current.lastActivation.at !== baseline;
          status.textContent = received
            ? t('Popup hotkey received. You can use it to bring the widget forward.')
            : t('No popup hotkey received yet. Press your configured hotkey, then check again.');
        } catch {
          status.textContent = t('Could not check the hotkey. Try again.');
        }
      })
    );
    help.appendChild(
      createActionButton(t('Set up hotkeys'), 'btn btn-secondary', async () => {
        await skipWizardToSettings();
        document.querySelector('[data-tab="hotkeys"]')?.click();
      })
    );
    help.appendChild(status);
    // A repeated render may finish its asynchronous lookup after a newer render.
    content.querySelector('#first-run-desktop-help')?.remove();
    content.appendChild(help);
  } catch (error) {
    log.warn('Could not load first-run desktop guidance:', error);
  }
}

// A system language the app has as a downloadable pack, not yet downloaded: Auto shows English
// meanwhile, and the welcome step is the first thing anyone sees, so it offers the pack there.
// Downloading it switches the wizard to that language at once.
async function renderFirstRunLanguageOffer(offer) {
  try {
    const { languageSetting, usingEnglishFallback, detectedLocale } = getLocaleState();
    if (languageSetting !== 'auto' || !usingEnglishFallback) return;
    const packs = await window.electronAPI.getLocalePacks?.();
    if (!Array.isArray(packs) || !offer.isConnected) return;
    const language = String(detectedLocale || '')
      .split('-')[0]
      .toLowerCase();
    const pack = packs.find(
      (entry) => !entry.installed && String(entry.locale || '').toLowerCase() === language
    );
    if (!pack) return;
    // The language's name in its own words: that is how someone who reads it will recognise it.
    // It is set apart in its own language and direction, so a right-to-left name does not pull the
    // sentence's full stop to its side and a screen reader says it in that language's voice.
    const name = pack.displayName || pack.englishName || pack.locale;
    const line = createTextElement('p', 'first-run-copy', '');
    const [before, after = ''] = t('HA Desktop Widget is available in {{language}}.', {
      language: '\u0000',
    }).split('\u0000');
    const languageName = createTextElement('bdi', '', name);
    languageName.lang = pack.locale;
    line.append(before, languageName, after);
    offer.appendChild(line);
    const download = createActionButton(t('Download'), 'btn btn-secondary btn-sm', async () => {
      download.disabled = true;
      download.setAttribute('aria-busy', 'true');
      try {
        await window.electronAPI.downloadLocalePack(pack.locale);
        await refreshLocaleBootstrap();
        renderCurrentMode();
        renderWizardStep();
      } catch (error) {
        log.warn('Could not download the system language pack:', error);
        if (!download.isConnected) return;
        download.disabled = false;
        download.setAttribute('aria-busy', 'false');
        setWizardStatus(t('Failed to download language pack'), 'error');
      }
    });
    download.setAttribute('aria-label', t('Download {{language}}', { language: name }));
    offer.appendChild(download);
    offer.hidden = false;
  } catch (error) {
    log.warn('Could not offer the system language at first run:', error);
  }
}

// The wizard's heading and lead paragraph name and describe its dialog. They are rebuilt for every
// step, so only one carries each id at a time.
function createWizardText(tagName, className, id, text) {
  const element = createTextElement(tagName, className, text);
  element.id = id;
  return element;
}

// Back moves between steps, so the first step and the last have none to offer. While authorization
// waits in the browser the same button is the way out of it, and looks like every other Cancel.
function syncWizardBackButton() {
  const backButton = firstRunWizard?.backButton;
  if (!backButton) return;
  const cancels = !!firstRunWizard.finishInProgress;
  backButton.hidden = firstRunWizard.step === 0 || firstRunWizard.step === 3;
  backButton.textContent = cancels ? t('Cancel') : t('Back');
  backButton.classList.toggle('btn-neutral', cancels);
}

function renderWizardStep() {
  if (!firstRunWizard?.content) return;
  const stepIndex = firstRunWizard.step;
  const content = firstRunWizard.content;
  content.textContent = '';
  // Changing step must not wipe a pairing that is still running: pressing Back mid-authorization
  // used to clear the only explanation for the disabled button, leaving it looking broken.
  if (firstRunWizard.finishInProgress) {
    setWizardStatus(firstRunWizard.statusMessage, firstRunWizard.statusType);
  } else {
    setWizardStatus('', '');
  }

  const stepLabel = createTextElement(
    'div',
    'first-run-step-label',
    t('Step {{current}} of {{total}}', {
      current: formatNumber(stepIndex + 1),
      total: formatNumber(4),
    })
  );
  content.appendChild(stepLabel);

  if (stepIndex === 0) {
    content.appendChild(
      createWizardText(
        'h2',
        'first-run-title',
        'first-run-title',
        t('Welcome to HA Desktop Widget')
      )
    );
    content.appendChild(
      createWizardText(
        'p',
        'first-run-copy',
        'first-run-copy',
        t(
          'Connect your Home Assistant server to start building a compact control panel for your desktop.'
        )
      )
    );
    // Filled in once the pack list is in; placed now so it always sits under the welcome text.
    const languageOffer = document.createElement('div');
    languageOffer.id = 'first-run-language-offer';
    languageOffer.hidden = true;
    content.appendChild(languageOffer);
    void renderFirstRunLanguageOffer(languageOffer);
    void renderFirstRunDesktopHelp(content);
  } else if (stepIndex === 1) {
    content.appendChild(
      createWizardText(
        'h2',
        'first-run-title',
        'first-run-title',
        t('Enter your Home Assistant URL')
      )
    );
    content.appendChild(
      createWizardText(
        'p',
        'first-run-copy',
        'first-run-copy',
        t('Use the address you normally open in your browser.')
      )
    );
    const label = createTextElement('label', 'first-run-label', t('Home Assistant URL'));
    label.setAttribute('for', 'first-run-ha-url');
    const input = document.createElement('input');
    input.id = 'first-run-ha-url';
    input.type = 'text';
    input.placeholder = t('http://homeassistant.local');
    input.setAttribute('spellcheck', 'false');
    input.setAttribute('autocapitalize', 'off');
    input.setAttribute('autocomplete', 'off');
    input.setAttribute('inputmode', 'url');
    input.value =
      firstRunWizard.urlInput?.value || normalizeBaseUrl(state.CONFIG?.homeAssistant?.url) || '';
    input.addEventListener('input', () => {
      firstRunWizard.urlInput = input;
    });
    input.addEventListener('keydown', (event) => {
      if (event.key !== 'Enter' || event.isComposing) return;
      event.preventDefault();
      firstRunWizard.nextButton?.click();
    });
    firstRunWizard.urlInput = input;
    content.appendChild(label);
    content.appendChild(input);
  } else if (stepIndex === 3) {
    content.appendChild(
      createWizardText('h2', 'first-run-title', 'first-run-title', t('Choose rooms and entities'))
    );
    content.appendChild(
      createWizardText(
        'p',
        'first-run-copy',
        'first-run-copy',
        t(
          'Your connection is saved. Preview a room or choose entities to create your first page. You can also do this later from the empty dashboard.'
        )
      )
    );
  } else {
    content.appendChild(
      createWizardText('h2', 'first-run-title', 'first-run-title', t('Authorize in Home Assistant'))
    );
    content.appendChild(
      createWizardText(
        'p',
        'first-run-copy',
        'first-run-copy',
        t(
          'Continue to open Home Assistant in your browser. Sign in and approve HA Desktop Widget, then return here.'
        )
      )
    );
    const authorizeUrl = firstRunWizard.resolvedUrl;
    if (authorizeUrl) {
      const urlLine = createTextElement('p', 'first-run-url', '');
      const urlText = createTextElement('bdi', '', authorizeUrl);
      urlText.dir = 'ltr';
      urlLine.appendChild(urlText);
      content.appendChild(urlLine);
    }
    content.appendChild(
      createTextElement(
        'p',
        'first-run-security-note',
        t('Your password never enters this app. Authorization can be revoked from Home Assistant.')
      )
    );
  }

  syncWizardBackButton();
  firstRunWizard.skipButton.textContent = stepIndex === 3 ? t('Skip for now') : t('Full settings');
  if (firstRunWizard.nextButton) {
    firstRunWizard.nextButton.textContent =
      stepIndex === 3 ? t('Choose rooms and entities') : stepIndex === 2 ? t('Connect') : t('Next');
    // Derived from the pairing rather than left wherever the last run put it, so a step change
    // can always recover the button instead of stranding it disabled.
    firstRunWizard.nextButton.disabled = !!firstRunWizard.finishInProgress;
    firstRunWizard.nextButton.setAttribute(
      'aria-busy',
      firstRunWizard.finishInProgress ? 'true' : 'false'
    );
  }
  focusWizardStep();
}

async function finishFirstRunWizard() {
  if (!firstRunWizard || firstRunWizard.finishInProgress) return;
  firstRunWizard.finishInProgress = true;
  syncWizardBackButton();
  if (firstRunWizard.nextButton) {
    firstRunWizard.nextButton.disabled = true;
    firstRunWizard.nextButton.setAttribute('aria-busy', 'true');
  }
  let waitNoticeTimer = null;

  try {
    // Inside the try: a throw here used to skip the finally, stranding the button disabled and
    // finishInProgress set, which the guard above then turned into a wizard that ignored every
    // click until the app was restarted.
    const normalizedUrl = normalizeBaseUrl(getWizardUrl());
    if (!normalizedUrl) {
      setWizardStatus(describeWizardUrlProblem(getWizardUrl()), 'error');
      return;
    }
    setWizardStatus(t('Waiting for you to approve in your browser...'), 'pending');
    // Approval can take the five minutes the pairing is allowed. Once the browser has had time to
    // open, add what to do if no browser appeared.
    waitNoticeTimer = window.setTimeout(() => {
      if (!firstRunWizard?.finishInProgress || firstRunWizard.cancelRequested) return;
      setWizardStatus(
        t(
          'Waiting for you to approve HA Desktop Widget in your browser. If it did not open, choose Cancel, then Connect again.'
        ),
        'pending'
      );
    }, WIZARD_WAIT_NOTICE_DELAY_MS);
    const result = await startHomeAssistantPairing(window.electronAPI, normalizedUrl);
    if (!result?.config) throw new Error(t('Home Assistant did not return a saved connection.'));
    applyRendererConfig(result.config);
    if (hasDashboardEntities()) {
      // Reconnecting an existing setup: its pages are already there, so there is nothing to choose.
      setWizardStatus('', '');
      setFirstRunWizardVisible(false);
      startConfiguredRuntime();
      return;
    }
    firstRunWizard.step = 3;
    setWizardStatus('', '');
    renderWizardStep();
    setFirstRunWizardVisible(true);
    startConfiguredRuntime();
  } catch (error) {
    // The user asked for this one by leaving the step, so reporting it back as a failure would
    // be reporting their own action to them.
    if (firstRunWizard?.cancelRequested) {
      setWizardStatus('', '');
    } else {
      const message = describeHomeAssistantOAuthFailure(error);
      log[isExpectedPairingFailure(error) ? 'warn' : 'error'](
        'Failed to finish first-run setup:',
        error
      );
      setWizardStatus(message, 'error');
      // The wizard is up and says the same thing in its status line; a toast would say it twice.
      if (!firstRunWizard?.visible) uiUtils.showToast(message, 'error', 6000);
    }
  } finally {
    window.clearTimeout(waitNoticeTimer);
    if (firstRunWizard) {
      firstRunWizard.finishInProgress = false;
      firstRunWizard.cancelRequested = false;
      syncWizardBackButton();
      if (firstRunWizard.nextButton) {
        firstRunWizard.nextButton.disabled = false;
        firstRunWizard.nextButton.setAttribute('aria-busy', 'false');
        // Disabling the button while connecting dropped focus to <body>; give it back.
        if (firstRunWizard.visible && document.activeElement === document.body) {
          firstRunWizard.nextButton.focus();
        }
      }
    }
  }
}

function maybeShowWizardAfterSettingsClose() {
  if (!firstRunSettingsObserver) return;
  const modal = document.getElementById('settings-modal');
  if (!modal || !modal.classList.contains('hidden')) return;
  firstRunSettingsObserver.disconnect();
  firstRunSettingsObserver = null;
  if (!isConfigured(state.CONFIG)) {
    setFirstRunWizardVisible(true);
  }
}

function skipWizardToSettings() {
  const finishedConnection = firstRunWizard?.step === 3;
  // A pairing left waiting in the browser would otherwise capture the next Connect in Settings.
  void cancelFirstRunAuthorization();
  const wizardUrl = normalizeBaseUrl(getWizardUrl());
  setFirstRunWizardVisible(false);
  if (finishedConnection) return;
  openSettingsModal();
  const settingsUrl = document.getElementById('ha-url');
  if (settingsUrl && !settingsUrl.value && wizardUrl) settingsUrl.value = wizardUrl;
  const modal = document.getElementById('settings-modal');
  if (!modal || firstRunSettingsObserver) return;
  firstRunSettingsObserver = new MutationObserver(maybeShowWizardAfterSettingsClose);
  firstRunSettingsObserver.observe(modal, {
    attributes: true,
    attributeFilter: ['class', 'style'],
  });
}

function ensureFirstRunWizard() {
  if (firstRunWizard?.overlay) return firstRunWizard;

  const overlay = document.createElement('div');
  overlay.id = 'first-run-onboarding';
  overlay.className = 'first-run-onboarding hidden';
  overlay.setAttribute('role', 'dialog');
  overlay.setAttribute('aria-modal', 'true');

  const panel = document.createElement('div');
  panel.className = 'first-run-panel';

  const content = document.createElement('div');
  content.className = 'first-run-content';

  const status = document.createElement('div');
  status.className = 'first-run-status connection-status-empty';
  status.setAttribute('role', 'status');

  const actions = document.createElement('div');
  actions.className = 'first-run-actions';

  const skipButton = createActionButton(
    t('Full settings'),
    'btn btn-secondary',
    skipWizardToSettings
  );
  const backButton = createActionButton(t('Back'), 'btn btn-secondary', async () => {
    // While authorization waits this is Cancel: it stops the wait and stays on the step, ready to
    // connect again. Otherwise it goes back one step.
    const cancelling = firstRunWizard.finishInProgress;
    await cancelFirstRunAuthorization();
    if (!cancelling) firstRunWizard.step = Math.max(0, firstRunWizard.step - 1);
    renderWizardStep();
  });
  const nextButton = createActionButton(t('Next'), 'btn btn-primary', async () => {
    if (firstRunWizard.step === 3) {
      setFirstRunWizardVisible(false);
      ui.showAddPageModal({ starter: true });
      return;
    }
    if (firstRunWizard.step === 2) {
      await finishFirstRunWizard();
      return;
    }
    if (firstRunWizard.step === 1) {
      const resolvedUrl = normalizeBaseUrl(getWizardUrl());
      if (!resolvedUrl) {
        setWizardStatus(describeWizardUrlProblem(getWizardUrl()), 'error');
        firstRunWizard.urlInput?.focus();
        return;
      }
      // What the next step says it will open: a bare "ha.local" has gained its scheme by now.
      firstRunWizard.resolvedUrl = resolvedUrl;
    }
    firstRunWizard.step = Math.min(2, firstRunWizard.step + 1);
    renderWizardStep();
  });

  actions.appendChild(skipButton);
  actions.appendChild(backButton);
  actions.appendChild(nextButton);
  panel.appendChild(content);
  panel.appendChild(status);
  panel.appendChild(actions);
  overlay.appendChild(panel);
  document.body.appendChild(overlay);

  firstRunWizard = {
    overlay,
    content,
    status,
    actions,
    skipButton,
    backButton,
    nextButton,
    step: 0,
    visible: false,
    finishInProgress: false,
    cancelRequested: false,
    statusMessage: '',
    statusType: '',
    urlInput: null,
    resolvedUrl: '',
  };
  renderWizardStep();
  return firstRunWizard;
}

function maybeShowFirstRunWizard() {
  if (firstRunWizard?.visible && firstRunWizard.step === 3 && isConfigured(state.CONFIG))
    return true;
  const oauthStatus = state.CONFIG?.homeAssistant?.oauthStatus;
  // An expired authorization belongs to an existing setup: the main window explains it and
  // offers to reconnect instead of starting onboarding over.
  const oauthRestorePending =
    state.CONFIG?.homeAssistant?.authMethod === 'oauth' &&
    ['restoring', 'offline', 'reauth_required'].includes(oauthStatus);
  if (
    IS_DESKTOP_PIN_MODE ||
    isConfigured(state.CONFIG) ||
    isSecureStoragePending() ||
    oauthRestorePending ||
    needsTokenReentry()
  ) {
    setFirstRunWizardVisible(false);
    return false;
  }
  // Settings can persist preferences before the connection is configured. Keep that
  // detour open and preserve the wizard draft until Settings actually closes.
  if (firstRunSettingsObserver) return false;
  ensureFirstRunWizard();
  // Every config broadcast re-checks onboarding; only a fresh showing starts at the first step.
  if (!firstRunWizard.visible) firstRunWizard.step = 0;
  renderWizardStep();
  setFirstRunWizardVisible(true);
  return true;
}

async function executeDesktopCompanionCommand({ action, payload }) {
  if (action === 'apply_profile') {
    const patch = buildConfigPatchFromApplyPayload(payload, state.CONFIG);
    const previousConfig = JSON.parse(JSON.stringify(state.CONFIG || {}));
    const result = await window.electronAPI.updateConfig(patch);
    if (result?.success === false) {
      throw new Error(result?.error || 'Profile could not be saved on this desktop');
    }
    // A profile can replace every page, span, name and icon. Keep the layout it replaced, as a
    // save from Settings does, so Undo and Restore dashboard can bring it back. It is not part of
    // a burst of edits: Restore dashboard keeps that layout however soon after an edit it comes.
    rememberDashboard(
      previousConfig,
      result?.homeAssistant ? result : { ...previousConfig, ...patch },
      { wholeLayout: true }
    );
    const mainState = await window.electronAPI.getDesktopCompanionState();
    return {
      ...mainState,
      active_profile_id: patch.haProfile.activeProfileId,
      profile_revision: patch.haProfile.revision,
    };
  }

  if (action !== 'switch_page') {
    return window.electronAPI.applyDesktopCompanionCommand(action);
  }

  const pageId = typeof payload?.page_id === 'string' ? payload.page_id.trim().slice(0, 128) : '';
  const quickAccessConfig = normalizeQuickAccessConfig(state.CONFIG || {});
  if (!pageId || !quickAccessConfig.customTabs.some((tab) => tab.id === pageId)) {
    throw new Error(`Unknown Quick Access page: ${pageId || '(empty)'}`);
  }
  const pageResult = await ui.switchQuickAccessPage(pageId);
  if (pageResult?.success === false) {
    throw pageResult.error || new Error('Quick Access page change was not saved');
  }
  const mainState = await window.electronAPI.getDesktopCompanionState();
  return { ...mainState, current_page: pageId };
}

function ensureDesktopCompanionClient() {
  if (desktopCompanionClient) return desktopCompanionClient;
  if (
    typeof window.electronAPI?.getDesktopCompanionRegistration !== 'function' ||
    typeof window.electronAPI?.getDesktopCompanionState !== 'function' ||
    typeof window.electronAPI?.applyDesktopCompanionCommand !== 'function'
  ) {
    return null;
  }
  desktopCompanionClient = new DesktopCompanionClient({
    websocket,
    getRegistration: () => window.electronAPI.getDesktopCompanionRegistration(),
    getState: () => window.electronAPI.getDesktopCompanionState(),
    getConfigDocument: () => buildProfileDocumentFromConfig(state.CONFIG),
    executeCommand: executeDesktopCompanionCommand,
  });
  return desktopCompanionClient;
}

function startConfiguredRuntime() {
  if (IS_DESKTOP_PIN_MODE || !isConfigured(state.CONFIG)) return false;

  const shouldInitializeRuntime = !configuredRuntimeStarted;
  configuredRuntimeStarted = true;

  startUiTickScheduler();

  if (shouldInitializeRuntime) {
    ensureDesktopCompanionClient()?.start();
    hotkeys.initializeHotkeys();
    hotkeys.setupHotkeyEventListeners();
    alerts.initializeEntityAlerts();
    notifications.initializePersistentNotifications();
  }

  uiUtils.showLoading(false);
  renderCurrentMode();

  if (shouldInitializeRuntime) {
    log.info('Connecting to Home Assistant WebSocket');
    connectWebSocket();

    setTimeout(() => {
      uiUtils.showLoading(false);
    }, 5000);
  }

  return true;
}

function startClimateDemoRuntime({ overlay = false } = {}) {
  if (IS_DESKTOP_PIN_MODE || !isClimateDemoConfig(state.CONFIG)) return false;

  document.body.dataset.developmentDemo = 'climate';
  if (!overlay) {
    updateMainConnectionState('demo');
    setConnectedStatus(t('Development climate demo — no Home Assistant connection'));
  }
  if (!climateDemoController) {
    climateDemoController = installClimateDemo({
      state,
      websocket,
      overlay,
      // The connected overlay stays wholly inside the renderer. In particular,
      // it never publishes its fake entity to the main process or Home Assistant.
      onEntityUpdated: overlay ? renderCurrentMode : queueStateChangedEntity,
    });
  }
  climateDemoController.ensureEntity();
  startUiTickScheduler();
  uiUtils.showLoading(false);
  renderCurrentMode();
  return true;
}

// Every save reports the same unchanged condition, so the token warning is said once per
// session. Throttled instead, it came back every few seconds for as long as the person kept
// saving, next to the keyring toast that names the same cause. It is not said while there is no
// token to keep: the main window is then asking for one, and its panel names the missing keyring
// and what to do. Once a token is entered, its save brings the warning; marking it said at start-up
// instead kept quiet that the token just typed in was not saved either.
let tokenPersistenceWarningShown = false;
let latestRendererConfigRevision = -1;

function showConfigPersistenceWarnings(persistenceWarnings = []) {
  if (
    !Array.isArray(persistenceWarnings) ||
    !persistenceWarnings.some((warning) => warning?.code === 'home_assistant_token_not_persisted')
  ) {
    return;
  }

  if (tokenPersistenceWarningShown || !isConfigured(state.CONFIG)) return;
  tokenPersistenceWarningShown = true;
  uiUtils.showToast(
    window.electronAPI?.platform === 'linux'
      ? t(
          'No unlocked system keyring (Secret Service) was found, so this token will not be remembered after you quit. Start gnome-keyring or KWallet, then restart the widget.'
        )
      : t(
          'Your Home Assistant token needs to be re-entered. Token encryption is not available on this system.'
        ),
    'warning',
    10000,
    { source: STARTUP_WARNING_TOAST_SOURCE }
  );
}

// The keys the Quick Access persistence path writes. A config echo that differs from what the
// renderer already holds only in these keys needs a tile render, not a theme or locale refresh.
const QUICK_ACCESS_CONFIG_KEYS = [
  'customTabs',
  'activeTabId',
  'favoriteEntities',
  'comparisonGraphs',
];
// Main replaces the OAuth access token about every half hour. The token, its expiry and the
// authorization id are connection state that the config-updated handler reconnects on by itself;
// on their own they need no theme, locale or tile refresh.
const OAUTH_RUNTIME_CONNECTION_KEYS = ['token', 'oauthExpiresAt', 'oauthAuthorizationId'];
// The config as of the previous applyRendererConfig call. Persistence paths in ui.js and
// settings.js store their result in state before the echo arrives, so state alone cannot tell
// whether the appearance pass has already run for it.
let lastAppliedRendererConfig = null;

function withoutOAuthRuntimeConnection(config) {
  if (config?.homeAssistant?.authMethod !== 'oauth') return config;
  const homeAssistant = { ...config.homeAssistant };
  OAUTH_RUNTIME_CONNECTION_KEYS.forEach((key) => delete homeAssistant[key]);
  return { ...config, homeAssistant };
}

function describeRendererConfigChange(renderedConfig, appliedConfig, nextConfig) {
  const serialize = (config, quickAccess) =>
    JSON.stringify(
      Object.entries(withoutOAuthRuntimeConnection(config) || {})
        .filter(([key]) => QUICK_ACCESS_CONFIG_KEYS.includes(key) === quickAccess)
        .sort(([a], [b]) => a.localeCompare(b))
    );
  const differs = (previousConfig, quickAccess) =>
    !previousConfig?.homeAssistant ||
    serialize(previousConfig, quickAccess) !== serialize(nextConfig, quickAccess);
  return {
    quickAccess: differs(renderedConfig, true) || differs(appliedConfig, true),
    other: differs(appliedConfig, false),
  };
}

function applyRendererConfig(nextConfig) {
  if (!nextConfig || !nextConfig.homeAssistant) return;
  const nextRevision = Number(nextConfig.configRevision);
  if (Number.isFinite(nextRevision) && nextRevision < latestRendererConfigRevision) {
    return false;
  }
  if (Number.isFinite(nextRevision)) {
    latestRendererConfigRevision = Math.max(latestRendererConfigRevision, nextRevision);
  }
  const persistenceWarnings = nextConfig.persistenceWarnings;
  const runtimeWarnings = Array.isArray(nextConfig.runtimeWarnings)
    ? nextConfig.runtimeWarnings
    : [];
  const persistentConfig = { ...nextConfig };
  delete persistentConfig.configRecovery;
  delete persistentConfig.configRevision;
  delete persistentConfig.persistenceWarnings;
  delete persistentConfig.runtimeWarnings;
  const normalizedQuickAccess = normalizeQuickAccessConfig(persistentConfig, {
    withChanged: true,
  });
  // Runs after the Quick Access pass because it reconciles graph tiles against the normalized tabs.
  const normalizedGraphs = normalizeComparisonGraphsConfig(normalizedQuickAccess.config, {
    withChanged: true,
  });
  const renderedConfig = state.CONFIG;
  state.setConfig(normalizedGraphs.config);
  ui.ensureEntityCacheScope();
  publishOmarchyBarTiles();
  // Kept local: the migration write below can echo back synchronously and re-enter this function
  // before the appearance pass runs, and that inner call must not decide the outer pass.
  const change = describeRendererConfigChange(
    renderedConfig,
    lastAppliedRendererConfig,
    state.CONFIG
  );
  // Snapshot rather than alias: alerts and hotkeys mutate state.CONFIG in place, and an
  // aliased reference would hide those changes from the next comparison.
  lastAppliedRendererConfig = JSON.parse(JSON.stringify(state.CONFIG));
  refreshDashboardUndoState();
  refreshDesktopPinStatePublishing();
  if ((normalizedQuickAccess.changed || normalizedGraphs.changed) && !IS_DESKTOP_PIN_MODE) {
    window.electronAPI.updateConfig(normalizedGraphs.config).catch((error) => {
      log.error('Failed to persist Quick Access view migration:', error);
    });
  }
  // Re-applying window effects repaints the whole blurred window, so skip the appearance pass
  // when the echo only carries a Quick Access change the renderer already drew.
  if (change.other) {
    document.body.classList.toggle(
      'layer-drag-enabled',
      state.CONFIG.desktopCapabilities?.canDrag === true
    );
    uiUtils.applyTheme(state.CONFIG.ui?.theme || 'auto');
    uiUtils.setCustomThemes(state.CONFIG.ui?.customColors || []);
    uiUtils.applyAccentTheme(state.CONFIG.ui?.accent || 'original');
    uiUtils.applyBackgroundTheme(state.CONFIG.ui?.background || 'original');
    uiUtils.applyUiPreferences(state.CONFIG.ui || {});
    // The palette can change the theme, which the window effects' alphas follow, so it goes first.
    applyDesktopAppearance(state.CONFIG);
    uiUtils.applyWindowEffects(state.CONFIG || {});

    if (ui.updateWeatherEffects) {
      ui.updateWeatherEffects();
    }
    // Keep unsaved Settings previews on screen; the echo carries the saved appearance.
    settings.reapplySettingsPreviews?.();
  }

  // Keep Home Assistant's stored layout snapshot current (deduplicated in the client).
  void desktopCompanionClient?.reportConfigSnapshot();

  showConfigPersistenceWarnings(persistenceWarnings);
  runtimeWarnings.forEach((warning) => {
    uiUtils.showToast(
      t('Error: {{error}}', {
        error: warning?.error || t('Unknown error'),
      }),
      'warning',
      5000
    );
  });
  return change;
}

function showConfigRecoveryNotice(recovery) {
  if (!recovery || typeof recovery !== 'object') return;

  if (recovery.recovered) {
    const message = t(
      'The previous configuration was invalid, so the app recovered with safe defaults. Backup: {{path}}',
      { path: String(recovery.backupPath || '-') }
    );
    uiUtils.showToast(message, 'warning', 20000);
    return;
  }

  const message = t(
    'Configuration recovery could not be completed. Backup: {{path}} Error: {{error}}',
    {
      path: String(recovery.backupPath || '-'),
      error: String(recovery.error || t('Unknown error')),
    }
  );
  uiUtils.showToast(message, 'error', 20000);
}

// Text in index.html that names keys names them as this platform's keyboard prints them, as the
// hotkey recorders and fields do. The palette opens with the platform's own modifier, Cmd+K on macOS
// and Ctrl+K elsewhere (it takes either, but the tip names the one a person there would reach for).
// The entity hotkeys help names the keys a hotkey can start from: Shift alone is refused, and the
// Meta key is Super, Win or Cmd.
function applyPlatformKeyNames() {
  const platform = window.electronAPI?.platform;
  const keys = (accelerator) => accelerators.formatAccelerator(accelerator, platform);
  const setVars = (id, vars) =>
    document.getElementById(id)?.setAttribute('data-i18n-vars', JSON.stringify(vars));
  setVars('command-palette-hint', { shortcut: keys('CommandOrControl+K') });
  setVars('entity-hotkeys-help', {
    ctrl: keys('Ctrl'),
    alt: keys('Alt'),
    meta: keys('Super'),
    shift: keys('Shift'),
    example: keys('CommandOrControl+Shift+A'),
  });
}

// The language the window was last drawn in; null until the first locale is applied.
let appliedLocale = null;
async function refreshLocaleBootstrap() {
  if (!window?.electronAPI?.getLocaleBootstrap) return null;
  const bootstrap = await window.electronAPI.getLocaleBootstrap();
  setLocaleBootstrap(bootstrap || {});
  if (!IS_DESKTOP_PIN_MODE) refreshTrayEntityIcons({ force: true });
  applyPlatformKeyNames();
  translateDocument(document);
  const locale = bootstrap?.activeLocale || '';
  if (appliedLocale !== null && locale !== appliedLocale) {
    refreshConnectionStatusLanguage();
    // An open device dialog was written in the old language and has no markers to translate it by.
    // (A newer pack for the same language leaves it open: its words are nearly the same.)
    ui.closeAllEntityDetailDialogs?.();
  }
  appliedLocale = locale;
  return bootstrap;
}

// The connection indicator's label and tooltip are written when the connection changes. After a
// language change, write them again in the new language. A failure's own explanation was
// translated when it happened and stays until the next connection change.
function refreshConnectionStatusLanguage() {
  if (IS_DESKTOP_PIN_MODE) return;
  if (mainConnectionState === 'demo') {
    setConnectedStatus(t('Development climate demo — no Home Assistant connection'));
  } else if (mainConnectionState === 'connected') {
    setConnectedStatus();
  } else if (usesOAuth() && !isConfigured(state.CONFIG)) {
    setOAuthRestoreStatus();
  } else if (mainConnectionState === 'connecting') {
    setConnectingStatus();
  } else {
    setDisconnectedStatus();
  }
}

function renderCurrentMode() {
  if (IS_DESKTOP_PIN_MODE) {
    const entity = state.STATES?.[DESKTOP_PIN_ENTITY_ID] || null;
    document.body.classList.toggle('desktop-pin-edit-mode', desktopPinEditMode);
    // pointer-events: none keeps the mouse off a tile that is being arranged, but not Tab, Enter
    // or Space, so the tile is also taken out of the focus order while it is edited.
    for (const id of ['desktop-pin-content', 'desktop-pin-empty']) {
      document.getElementById(id)?.toggleAttribute('inert', desktopPinEditMode);
    }
    // The edit-mode hint is drawn by CSS from these attributes so it follows the language. Where
    // the desktop decides where the tile sits, a drag is not kept, so the stylesheet shows the
    // resize hint instead of inviting one.
    const pinContent = document.getElementById('desktop-pin-content');
    pinContent?.setAttribute('data-edit-hint', t('Drag or resize'));
    pinContent?.setAttribute('data-resize-hint', t('Resize only'));
    // The notice that the desktop decides where the tile sits is for sessions where nothing in the
    // app can move it. A layer surface on Hyprland is dragged by the app itself.
    document.body.classList.toggle(
      'desktop-pin-compositor-placement',
      !desktopPinSupportsWindowPositioning && state.CONFIG?.desktopCapabilities?.canDrag !== true
    );
    ui.renderDesktopPinnedTile(DESKTOP_PIN_ENTITY_ID, entity, {
      hasSnapshot: desktopPinHasSnapshot,
      connectionIssue: desktopPinConnectionIssue,
    });
    return;
  }
  ui.renderActiveTab();
  renderMainWidgetState();
}

async function handleDesktopPinUpdate(message = {}) {
  try {
    if (!IS_DESKTOP_PIN_MODE) return;
    if (message.config?.homeAssistant) {
      const previousLanguage = state.CONFIG?.ui?.language || 'auto';
      applyRendererConfig(message.config);
      // Pins get config through this message, not config-updated, so follow a language change here.
      if ((state.CONFIG?.ui?.language || 'auto') !== previousLanguage) {
        await refreshLocaleBootstrap();
      }
    }
    if (message.connection && typeof message.connection === 'object') {
      applyDesktopPinConnectionState(message.connection);
    }

    if (message.entityId && message.entityId !== DESKTOP_PIN_ENTITY_ID) {
      return;
    }

    if (Object.prototype.hasOwnProperty.call(message, 'editMode')) {
      desktopPinEditMode = !!message.editMode;
    }

    if (Object.prototype.hasOwnProperty.call(message, 'pinBounds')) {
      desktopPinBounds = message.pinBounds || null;
    }

    if (Object.prototype.hasOwnProperty.call(message, 'hasSnapshot')) {
      desktopPinHasSnapshot = !!message.hasSnapshot;
    }

    if (Object.prototype.hasOwnProperty.call(message, 'supportsWindowPositioning')) {
      desktopPinSupportsWindowPositioning = message.supportsWindowPositioning !== false;
    }

    if (Object.prototype.hasOwnProperty.call(message, 'unitSystem')) {
      applyDesktopPinUnitSystem(message.unitSystem);
    }

    if (Object.prototype.hasOwnProperty.call(message, 'entity')) {
      if (message.entity) {
        state.setEntityState(message.entity);
      } else {
        const nextStates = { ...(state.STATES || {}) };
        delete nextStates[DESKTOP_PIN_ENTITY_ID];
        state.setStates(nextStates);
      }
    }

    renderCurrentMode();
    // Re-evaluates the tick cadence: a timer that just started needs a per-second tick.
    startUiTickScheduler();
  } catch (error) {
    log.error('Failed to handle desktop pin update:', error);
  }
}

function classifyConnectionError(error) {
  const errorMessage = error?.message || 'WebSocket connection failed';
  const normalizedMessage = String(errorMessage).trim() || 'WebSocket connection failed';
  const lowerMessage = normalizedMessage.toLowerCase();
  const browserOffline = typeof navigator !== 'undefined' && navigator.onLine === false;

  if (browserOffline) {
    return {
      key: OFFLINE_CONNECTION_ERROR_KEY,
      message: t(
        'No network connection detected. Check your network connection and the widget will retry automatically.'
      ),
      persistUntilOnline: true,
    };
  }

  if (
    lowerMessage.includes('unknown websocket error') ||
    lowerMessage.includes('websocket connection failed') ||
    lowerMessage.includes('could not establish websocket connection')
  ) {
    return {
      key: 'ha-connection-unreachable',
      message: t('Unable to reach Home Assistant. Check your network or Home Assistant URL.'),
      persistUntilOnline: false,
    };
  }

  return {
    key: normalizedMessage,
    message: t('Connection error: {{message}}', { message: normalizedMessage }),
    persistUntilOnline: false,
  };
}

// Each kind of failure is toasted once per outage. The status indicator and the connection panel
// already show that the widget keeps retrying, so repeating the toast every retry is only noise.
function shouldShowConnectionToast(toastInfo) {
  if (!toastInfo) return false;

  if (toastInfo.persistUntilOnline && offlineConnectionToastShown) {
    return false;
  }

  if (shownConnectionToastKeys.has(toastInfo.key)) return false;
  shownConnectionToastKeys.add(toastInfo.key);

  if (toastInfo.persistUntilOnline) {
    offlineConnectionToastShown = true;
  }

  return true;
}

function resetConnectionToastTracking() {
  offlineConnectionToastShown = false;
  shownConnectionToastKeys.clear();
  connectionErrorLoggedThisOutage = false;
}

// Toasts that say why the connection failed are tagged, so the renderer can take them down again
// without keeping hold of the elements: when Settings opens, and when the connection is back.
const CONNECTION_TOAST_SOURCE = 'connection';
// Notices about the saved token (a missing keyring); they outlast a reconnect but point at Settings too.
const STARTUP_WARNING_TOAST_SOURCE = 'startup-warning';

function showConnectionToast(message, timeout) {
  // While the connection panel is up it already says the widget is offline and keeps retrying,
  // with Retry and Open Settings right under it. A toast on the same spot would cover those
  // buttons, and the first click on them would dismiss the toast instead.
  if (document.body.classList.contains('widget-state-active')) return;
  uiUtils.showToast(message, 'error', timeout, { source: CONNECTION_TOAST_SOURCE });
}

// Connection toasts point the user at Settings. Once Settings is open they have done their job,
// and left up they cover its footer, Save button included.
function dismissConnectionToasts({ includeStartupWarnings = false } = {}) {
  uiUtils.dismissToasts?.(CONNECTION_TOAST_SOURCE);
  if (includeStartupWarnings) uiUtils.dismissToasts?.(STARTUP_WARNING_TOAST_SOURCE);
}

function showClassifiedConnectionToast(error) {
  const toastInfo = classifyConnectionError(error);
  if (shouldShowConnectionToast(toastInfo)) {
    showConnectionToast(toastInfo.message, 15000);
  }
  return toastInfo;
}

async function recoverOAuthAuthorization() {
  const tokenBefore = state.CONFIG?.homeAssistant?.token;
  oauthAuthRefreshInFlight = true;
  let result = null;
  try {
    result = await window.electronAPI.refreshHomeAssistantOAuth?.();
  } catch (error) {
    log.warn('Home Assistant authorization refresh failed:', error);
  } finally {
    oauthAuthRefreshInFlight = false;
  }
  if (!usesOAuth()) return;
  const oauthStatus = result?.oauthStatus || getOAuthStatus();
  if (oauthStatus === 'reauth_required') {
    // The config broadcast renders the reconnect prompt; the status line and pins follow here.
    updateMainConnectionState('auth-failed');
    setDisconnectedStatus(getOAuthReauthRequiredStatus());
    setDesktopPinConnectionIssue(getOAuthReauthRequiredStatus());
    renderCurrentMode();
    return;
  }
  if (oauthStatus === 'connected') {
    // The new token arrives in a config broadcast, which reconnects. Connect here only when it
    // was applied before this reply and nothing has connected yet.
    if (
      state.CONFIG?.homeAssistant?.token !== tokenBefore &&
      !websocket.ws &&
      isConfigured(state.CONFIG)
    ) {
      connectWebSocket();
    }
    return;
  }
  // Could not refresh (Home Assistant or the network is down). Main keeps retrying, and its new
  // token reconnects through the config broadcast.
  updateMainConnectionState('disconnected');
  const offlineMessage = t('Home Assistant is offline. Authorization will retry automatically.');
  setDisconnectedStatus(offlineMessage);
  setDesktopPinConnectionIssue(offlineMessage);
  renderCurrentMode();
}

function scheduleReconnect() {
  if (reconnectTimerId || browserReportedOffline || mainConnectionState === 'auth-failed') return;
  const delay = Math.min(
    BASE_RECONNECT_DELAY_MS * Math.pow(2, reconnectAttempts),
    MAX_RECONNECT_DELAY_MS
  );
  const jitter = Math.random() * 1000;
  reconnectAttempts++;

  log.debug(
    `WebSocket closed. Reconnecting in ${Math.round((delay + jitter) / 1000)}s (attempt ${reconnectAttempts})`
  );
  reconnectTimerId = setTimeout(() => {
    reconnectTimerId = null;
    connectWebSocket();
  }, delay + jitter);
}

function shouldPauseUiTick() {
  return typeof document?.hidden === 'boolean' ? document.hidden : false;
}

function getNextMinuteTickDelay(nowMs = Date.now()) {
  const elapsedMinuteMs = nowMs % 60000;
  return Math.max(UI_TICK_ACTIVE_INTERVAL_MS, 60000 - elapsedMinuteMs + UI_TICK_MINUTE_BUFFER_MS);
}

function getNextUiTickDelay(tickTargets) {
  if (tickTargets?.hasVisibleTimers || tickTargets?.mediaEntity) {
    return UI_TICK_ACTIVE_INTERVAL_MS;
  }
  if (tickTargets?.timeVisible) {
    return getNextMinuteTickDelay();
  }
  return UI_TICK_IDLE_POLL_INTERVAL_MS;
}

function clearUiTickTimer() {
  if (!uiTickTimerId) return;
  clearTimeout(uiTickTimerId);
  uiTickTimerId = null;
}

function scheduleNextUiTick(tickTargets) {
  clearUiTickTimer();
  if (!uiTickSchedulerStarted || shouldPauseUiTick()) return;
  uiTickTimerId = setTimeout(runUiTick, getNextUiTickDelay(tickTargets));
}

function runUiTick() {
  if (shouldPauseUiTick()) {
    clearUiTickTimer();
    return;
  }

  if (IS_DESKTOP_PIN_MODE) {
    // Pins only hear from the main process when the entity itself changes, so their
    // clock-derived tiles (timer countdowns, media progress) have to tick locally.
    const pinTickTargets = ui.getDesktopPinTickTargets?.(DESKTOP_PIN_ENTITY_ID) || null;
    if (pinTickTargets?.hasLiveDisplays) {
      ui.updateDesktopPinLiveDisplays();
    }
    scheduleNextUiTick(pinTickTargets);
    return;
  }

  const tickTargets = ui.getTickTargets?.();
  if (!tickTargets) {
    scheduleNextUiTick(null);
    return;
  }

  if (tickTargets.timeVisible) {
    ui.updateTimeDisplay();
  }

  if (tickTargets.hasVisibleTimers) {
    ui.updateTimerDisplays();
  }

  if (tickTargets.mediaEntity) {
    ui.updateMediaSeekBar(tickTargets.mediaEntity);
  }

  scheduleNextUiTick(tickTargets);
}

function nudgeUiTickScheduler() {
  if (!uiTickSchedulerStarted || shouldPauseUiTick() || uiTickNudgeTimerId) return;
  uiTickNudgeTimerId = setTimeout(() => {
    uiTickNudgeTimerId = null;
    runUiTick();
  }, 0);
}

function startUiTickScheduler() {
  if (uiTickSchedulerStarted) {
    nudgeUiTickScheduler();
    return;
  }

  uiTickSchedulerStarted = true;
  runUiTick();

  document.addEventListener('visibilitychange', runUiTick);
  document.addEventListener('click', nudgeUiTickScheduler, true);
  window.addEventListener('focus', runUiTick);
}

window.addEventListener('online', () => {
  resetConnectionToastTracking();
  const shouldForceReconnect = browserReportedOffline;
  browserReportedOffline = false;
  if (shouldForceReconnect || !websocket.ws || websocket.ws.readyState !== WebSocket.OPEN) {
    // connectWebSocket() says it is connecting; a "network restored" message set first would be
    // replaced in the same tick, before it could be painted.
    connectWebSocket();
  }
});

window.addEventListener('offline', () => {
  browserReportedOffline = true;
  clearReconnectTimer();
  updateMainConnectionState('disconnected');
  const disconnectedMessage = t(
    'No network connection detected. Check your network connection and the widget will retry automatically.'
  );
  setDisconnectedStatus(disconnectedMessage);
  setDesktopPinConnectionIssue(disconnectedMessage);
  uiUtils.showLoading(false);
  if (IS_SPECIAL_PIN_MODE) {
    renderCurrentMode();
  } else {
    ui.renderActiveTab();
    renderMainWidgetState();
  }
  showClassifiedConnectionToast(new Error('Browser reported offline'));

  // Use the manager lifecycle so authentication and message subscription state are
  // cleared before the browser delivers the socket's asynchronous close event.
  try {
    closeWebSocket();
  } catch (error) {
    log.warn('Error closing WebSocket after offline event:', error);
  }
});

websocket.on('message', (msg) => {
  try {
    if (msg.type === 'auth_ok') {
      log.debug('WebSocket authentication successful');
      // reconnectAttempts is not reset here but once the states arrive: a server that accepts the
      // login and then cannot send them would otherwise be retried at the shortest delay each time.
      oauthAuthRecoveryAttempted = false;
      if (!IS_DESKTOP_PIN_MODE) setTrayEntityConnectionState(false);
      updateMainConnectionState('connecting');
      browserReportedOffline = false;
      setDesktopPinConnectionIssue('');
      resetConnectionToastTracking();
      clearReconnectTimer();
      setDisconnectedStatus(t('Waiting for live Home Assistant data...'));
      // The first snapshot is the one request that can legitimately take a long time. Giving up
      // at the usual 15 s tore the socket down and asked Home Assistant to serialise every entity
      // again, so a large instance never finished loading.
      const statesReq = websocket.request(
        { type: 'get_states' },
        {
          timeoutMs:
            WS_INITIAL_STATES_TIMEOUT_MS *
            Math.min(2 ** snapshotTimeoutsInARow, MAX_SNAPSHOT_TIMEOUT_GROWTH),
        }
      );
      const servicesReq = websocket.request({ type: 'get_services' });
      const areasReq = websocket.request({ type: 'config/area_registry/list' });
      const configReq = websocket.request({ type: 'get_config' });

      // Store IDs for matching results
      getStatesId = statesReq.id;
      getServicesId = servicesReq.id;
      getAreasId = areasReq.id;
      getConfigId = configReq.id;

      log.debug(`Sent get_config request with ID: ${getConfigId}`);
      emitRendererDebug('ws.auth_ok', {
        getStatesId,
        getServicesId,
        getAreasId,
        getConfigId,
      });

      // Prevent unhandled rejections from surfacing as global errors
      const snapshotSocket = websocket.ws;
      statesReq
        .then((response) => {
          if (!response.success || !Array.isArray(response.result)) {
            websocket.failConnection(snapshotSocket);
          }
        })
        .catch((error) => {
          // Home Assistant answered the login, so it is running and the address is right; it is
          // the states that are slow. That is said in its own words, not as a server that is down.
          if (error?.code !== 'timeout') {
            websocket.failConnection(snapshotSocket);
            return;
          }
          snapshotTimeoutsInARow += 1;
          websocket.failConnection(snapshotSocket, 'snapshot-timeout');
        });
      servicesReq.catch(() => {});
      areasReq.catch(() => {});
      configReq.catch((err) => {
        log.error('get_config request failed:', err);
      });
      websocket
        .request({ type: 'subscribe_events', event_type: 'state_changed' })
        .catch((error) => {
          log.warn('State change subscription request failed:', error);
        });
      if (!IS_SPECIAL_PIN_MODE) {
        websocket
          .request({ type: 'subscribe_events', event_type: 'entity_registry_updated' })
          .then((response) => {
            // Home Assistant answers an unauthorized subscription with a `success: false` result
            // rather than dropping the connection, so the failure arrives here and not in catch().
            // Home Assistant limits this event to administrators. Non-admin users can repair
            // an unavailable Quick Access tile through the explicit replacement picker.
            if (response?.success === false) {
              log.info(
                'Automatic entity rename tracking is unavailable for this account:',
                response.error || response
              );
            }
          })
          .catch((error) => {
            log.info('Automatic entity rename tracking is unavailable for this account:', error);
          });
      }
    } else if (msg.type === 'auth_invalid') {
      clearReconnectTimer();
      if (usesOAuth() && !oauthAuthRecoveryAttempted) {
        // Home Assistant rejects an OAuth access token when the authorization was revoked or the
        // token expired while the machine slept. Refreshing tells the two apart.
        log.warn('[WS] Home Assistant rejected the access token; refreshing authorization');
        oauthAuthRecoveryAttempted = true;
        updateMainConnectionState('connecting');
        closeWebSocket();
        setDisconnectedStatus(t('Refreshing Home Assistant authorization...'));
        uiUtils.showLoading(false);
        renderCurrentMode();
        void recoverOAuthAuthorization();
        return;
      }
      log.error('[WS] Invalid authentication token');
      updateMainConnectionState('auth-failed');
      closeWebSocket();
      const authFailureMessage = getAuthFailureMessage();
      setDisconnectedStatus(authFailureMessage);
      setDesktopPinConnectionIssue(authFailureMessage);
      uiUtils.showLoading(false);
      // Said once per outage: startup churn and every Retry would otherwise stack the same toast.
      if (
        shouldShowConnectionToast({
          key: 'auth-invalid',
          message: authFailureMessage,
          persistUntilOnline: false,
        })
      ) {
        showConnectionToast(authFailureMessage, 15000);
      }
      // Render the UI so user can access settings
      renderCurrentMode();
    } else if (msg.type === 'event' && msg.event?.event_type === 'entity_registry_updated') {
      queueEntityRegistryRename(msg.event.data);
    } else if (msg.type === 'event' && msg.event?.event_type === 'state_changed') {
      const entity = msg.event.data?.new_state;
      if (entity) {
        queueStateChangedEntity(entity);
      } else {
        queueDeletedEntity(msg.event.data?.entity_id || msg.event.data?.old_state?.entity_id);
      }
    } else if (msg.type === 'result') {
      log.debug(`Received result for message ID: ${msg.id}`);
      if (msg.result) {
        if (msg.id === getStatesId) {
          // get_states response
          const newStates = {};
          if (Array.isArray(msg.result)) {
            log.debug(`Successfully fetched ${msg.result.length} entities from Home Assistant`);
            msg.result.forEach((entity) => {
              newStates[entity.entity_id] = entity;
            });

            const { favoriteCount, preservedFavorites, droppedStaleFavorites } =
              reconcileFavoriteStalePreservation(newStates);

            const mergedStates = { ...newStates, ...preservedFavorites };
            log.debug(
              `State update: ${Object.keys(newStates).length} from HA + ${Object.keys(preservedFavorites).length} preserved favorites - ${droppedStaleFavorites.length} stale favorites = ${Object.keys(mergedStates).length} total`
            );
            emitRendererDebug('ws.get_states.received', {
              fetchedEntities: Object.keys(newStates).length,
              preservedFavorites: Object.keys(preservedFavorites),
              droppedStaleFavorites,
              mergedTotal: Object.keys(mergedStates).length,
              favoriteCount,
            });
            state.setStates(mergedStates);
            // Home Assistant replaces the full state map after authentication. Restore
            // the renderer-local overlay immediately; setEntityState writes into the
            // same map that the snapshot publish below serializes, which is intended —
            // a pinned demo entity stays in main's pin cache across reconnects.
            if (isClimateDemoOverlayConfig(state.CONFIG)) {
              climateDemoController?.ensureEntity();
            }
            if (IS_DESKTOP_PIN_MODE) {
              desktopPinHasSnapshot = true;
            }
            setDesktopPinConnectionIssue('');
            haStatesSnapshotReceived = true;
            reconnectAttempts = 0;
            snapshotTimeoutsInARow = 0;
            // No coalescing: this map is fresh from get_states and may drop deleted
            // entities that an in-flight publish still carries.
            refreshDesktopPinStatePublishing({ force: true, coalesce: false });
            publishOmarchyBarTiles({ force: true });
            updateMainConnectionState('connected');
            setConnectedStatus();
            // Whatever the failure toasts said is over: a red "unable to reach Home Assistant"
            // must not outlive the recovery.
            dismissConnectionToasts();
            if (!IS_DESKTOP_PIN_MODE) {
              setTrayEntityConnectionState(true, Object.keys(newStates));
              refreshTrayEntityIcons({ force: true });
            }

            const reconciliation = utils.reconcileConfigEntityIds(state.CONFIG, mergedStates);
            if (reconciliation.changed) {
              emitRendererDebug('config.entity_id_reconciliation.changed', {
                previousFavoriteEntities: state.CONFIG?.favoriteEntities || [],
                nextFavoriteEntities: reconciliation.config?.favoriteEntities || [],
                previousPrimaryMediaPlayer: state.CONFIG?.primaryMediaPlayer || null,
                nextPrimaryMediaPlayer: reconciliation.config?.primaryMediaPlayer || null,
                previousSelectedWeatherEntity: state.CONFIG?.selectedWeatherEntity || null,
                nextSelectedWeatherEntity: reconciliation.config?.selectedWeatherEntity || null,
              });
              state.setConfig(reconciliation.config);
              if (IS_DESKTOP_PIN_MODE) {
                log.debug(
                  'Skipping entity ID reconciliation config write in desktop pin mode; main window will persist it.'
                );
                emitRendererDebug('config.entity_id_reconciliation.skip_pin_persist', {
                  reason: 'desktop-pin-mode',
                });
              } else {
                window.electronAPI.updateConfig(reconciliation.config).catch((error) => {
                  log.error('Failed to persist reconciled entity IDs:', error);
                  emitRendererDebug('config.entity_id_reconciliation.persist_error', {
                    error: error?.message || String(error),
                  });
                });
              }
            } else {
              emitRendererDebug('config.entity_id_reconciliation.no_change', {
                favoriteEntities: state.CONFIG?.favoriteEntities || [],
                primaryMediaPlayer: state.CONFIG?.primaryMediaPlayer || null,
                selectedWeatherEntity: state.CONFIG?.selectedWeatherEntity || null,
              });
            }

            // This is the correct place to render and hide loading
            if (IS_SPECIAL_PIN_MODE) {
              renderCurrentMode();
            } else {
              ui.renderActiveTab();
              renderMainWidgetState();
            }
            uiUtils.showLoading(false);

            if (!IS_SPECIAL_PIN_MODE) {
              alerts.initializeEntityAlerts();
            }
          }
        } else if (msg.id === getServicesId) {
          // get_services response
          state.setServices(msg.result);
        } else if (msg.id === getAreasId) {
          // get_areas response
          const newAreas = {};
          if (Array.isArray(msg.result)) {
            msg.result.forEach((area) => {
              newAreas[area.area_id] = area;
            });
            state.setAreas(newAreas);
          }
        } else if (msg.id === getConfigId) {
          // get_config response
          log.debug('Received config from Home Assistant:', JSON.stringify(msg.result, null, 2));
          const previousTimeZone = state.TIME_ZONE;
          state.setTimeZone(msg.result?.time_zone);
          // Calendar tiles read Home Assistant's offset-less times in its zone.
          if (state.TIME_ZONE !== previousTimeZone && !IS_SPECIAL_PIN_MODE) ui.renderActiveTab();
          if (msg.result && msg.result.unit_system) {
            log.debug('Unit system found:', JSON.stringify(msg.result.unit_system, null, 2));
            state.setUnitSystem(msg.result.unit_system);
            // Desktop pin windows have no websocket of their own, so main relays this to them.
            window.electronAPI.publishHaUnitSystem?.(msg.result.unit_system)?.catch((error) => {
              log.warn('Failed to publish the Home Assistant unit system to main process:', error);
            });
            // Re-render weather card with correct units
            if (ui.updateWeatherFromHA) {
              ui.updateWeatherFromHA();
            }
          } else {
            log.warn('No unit_system found in config response');
          }
        } else {
          log.debug(`Unhandled result message ID: ${msg.id}`);
        }
      } else {
        log.debug(`Result message with no result data: ${msg.id}`);
      }
    }
  } catch (error) {
    log.error('[WS] Error handling message:', error);
  }
});

websocket.on('close', (closeInfo = {}) => {
  try {
    alerts.suspendEntityAlerts?.();
    if (!IS_DESKTOP_PIN_MODE) setTrayEntityConnectionState(false);
    if (
      closeInfo?.intentional ||
      mainConnectionState === 'auth-failed' ||
      oauthAuthRefreshInFlight
    ) {
      log.debug('WebSocket closed intentionally; skipping reconnect schedule');
      return;
    }

    updateMainConnectionState('disconnected');
    // A host that never answers fails with a close alone, no error, so the reason is in the close.
    // One that answered the login but not with its states in time is running and at the right
    // address, so it is not told to check either.
    const unanswered = closeInfo?.reason === 'timeout';
    const slowSnapshot = closeInfo?.reason === 'snapshot-timeout';
    const closeMessage = slowSnapshot
      ? t('Home Assistant is slow to send its states. Retrying automatically.')
      : unanswered
        ? t('Home Assistant did not answer. Check that it is running and that the URL is correct.')
        : t('Disconnected from Home Assistant. Retrying automatically.');
    // A failed attempt is followed by a close. The reason the error gave ("Check your network or
    // Home Assistant URL") says more than "disconnected", and is what the connection panel shows
    // in place of a toast, so the close must not overwrite it.
    if (unanswered || slowSnapshot || !connectionErrorLoggedThisOutage) {
      setDisconnectedStatus(closeMessage);
    }
    setDesktopPinConnectionIssue(closeMessage);
    uiUtils.showLoading(false);
    if (IS_SPECIAL_PIN_MODE) {
      renderCurrentMode();
    } else {
      renderMainWidgetState();
    }

    scheduleReconnect();
  } catch (error) {
    log.error('Error handling WebSocket close:', error);
  }
});

websocket.on('error', (error) => {
  try {
    // The first failure of an outage is logged in full; the retries after it would only repeat it.
    if (connectionErrorLoggedThisOutage) {
      log.debug('WebSocket error (still retrying):', error?.message || error);
    } else {
      connectionErrorLoggedThisOutage = true;
      log.error('WebSocket error:', error);
    }
    updateMainConnectionState('disconnected');
    const classifiedIssue = classifyConnectionError(error);
    let desktopPinIssueMessage = classifiedIssue.message;
    setDisconnectedStatus(classifiedIssue.message);
    uiUtils.showLoading(false); // Hide loading on failure

    // Show user-friendly error message
    const errorMessage = String(error?.message || '');
    if (errorMessage.includes('default token') || errorMessage.includes('Invalid configuration')) {
      // An attempt with nothing to connect with (the network came back during setup, say). The
      // wizard or the token panel already says what to do; the header says the same.
      desktopPinIssueMessage = getTokenRecoveryPanel()?.message || getNotSetUpStatus();
      setDisconnectedStatus(desktopPinIssueMessage);
    } else if (!errorMessage.includes('auth_invalid')) {
      // Don't show toast for auth_invalid as it's already handled elsewhere
      const toastInfo = showClassifiedConnectionToast(error);
      desktopPinIssueMessage = toastInfo?.message || classifiedIssue.message;
      setDisconnectedStatus(desktopPinIssueMessage);
    }

    setDesktopPinConnectionIssue(desktopPinIssueMessage);

    // Show the UI with the current connection state instead of stale live controls.
    if (IS_SPECIAL_PIN_MODE) {
      renderCurrentMode();
    } else {
      ui.renderActiveTab();
      renderMainWidgetState();
    }
  } catch (err) {
    log.error('Error handling WebSocket error:', err);
  }
});

websocket.on('showLoading', (show) => {
  try {
    uiUtils.showLoading(show);
  } catch (err) {
    log.error('Error handling showLoading event:', err);
  }
});

websocket.on('connect-attempt', () => {
  clearReconnectTimer();
  updateMainConnectionState('connecting');
  setConnectingStatus();
  renderMainWidgetState();
});

// --- IPC Event Handlers ---
window.electronAPI.onHotkeyTriggered(({ entityId, action }) => {
  const resolvedEntityId = utils.resolveEntityId(entityId, state.STATES) || entityId;
  emitRendererDebug('hotkey.triggered', {
    entityId,
    resolvedEntityId,
    action: action || 'toggle',
    entityFound: !!state.STATES[resolvedEntityId],
  });
  const entity = state.STATES[resolvedEntityId];
  if (entity) {
    // Use the action sent from main.js, fallback to toggle if not provided
    const finalAction = action || 'toggle';
    ui.executeHotkeyAction(entity, finalAction);
  }
});

// A click on a tile in the Omarchy bar's panel, its adjust button, or a change in the panel's
// controls popup: the same as that on the widget's own Quick Access tile. Main has already
// checked the tile can do it.
window.electronAPI.onOmarchyBarEntityAction?.(({ entityId, kind, command, value } = {}) => {
  const resolvedEntityId = utils.resolveEntityId(entityId, state.STATES) || entityId;
  const entity = state.STATES[resolvedEntityId];
  if (!entity) {
    // A tile for an entity Home Assistant no longer has: the widget came forward for it, so offer
    // the same repair dialog its own tile for a removed entity opens.
    if (kind === 'primary') ui.openUnavailableEntityRepair(entityId);
    return;
  }
  if (kind === 'set') ui.executeQuickAccessControl(entity, command, value);
  else if (kind === 'controls') ui.openEntityControls(entity);
  else ui.executeEntityPrimaryAction(entity, { source: 'omarchy-bar' });
});

// Listen for open-settings event from tray menu
window.electronAPI.onOpenSettings(() => {
  if (IS_SPECIAL_PIN_MODE) return;
  openSettingsModal();
});

// Update events are heard from the start, not from the first time Settings opens: the check 30 s
// after launch, one run from the tray with Settings closed and a download finishing would
// otherwise be missed. Settings draws what has been heard when it opens.
if (!IS_SPECIAL_PIN_MODE) {
  startUpdateStatus(window.electronAPI, (event) => {
    // A check asked for from the tray: its answer belongs on the Updates row.
    if (event.reveal !== true) return;
    const settingsOpen = !document.getElementById('settings-modal')?.classList.contains('hidden');
    void (async () => {
      if (!settingsOpen) {
        dismissConnectionToasts({ includeStartupWarnings: true });
        await settings.openSettings(getSettingsUiHooks());
      }
      settings.revealUpdateStatus?.();
    })();
  });
}

// Settings shows the sync state, but only to someone who has it open: a sync that starts
// waiting for a choice or failing is also said once, wherever the person is.
let profileSyncNeededAttention = false;
window.electronAPI.onProfileSyncStatus((status) => {
  if (settings.handleProfileSyncStatusUpdate) {
    settings.handleProfileSyncStatusUpdate(status);
  }
  const needsAttention = settings.profileSyncNeedsAttention?.(status) === true;
  const settingsOpen = !document.getElementById('settings-modal')?.classList.contains('hidden');
  if (needsAttention && !profileSyncNeededAttention && !settingsOpen) {
    uiUtils.showToast(
      t('Profile sync needs attention. Open Settings > Advanced.'),
      'warning',
      8000
    );
  }
  profileSyncNeededAttention = needsAttention;
});

window.electronAPI.onConfigUpdated(async (nextConfig) => {
  try {
    if (!nextConfig || !nextConfig.homeAssistant) return;
    const wasConfigured = isConfigured(state.CONFIG);
    // The push that ends the secure-storage wait usually repeats a sign-in that is already
    // connected (a plaintext legacy token connects before it arrives). Closing that socket dropped
    // its first requests and flickered the status, so only a wait that left nothing connected
    // counts here.
    const wasSecureStoragePending = isSecureStoragePending() && !websocket.ws;
    const previousConnection = getConnectionIdentity(state.CONFIG);
    const previousToken = state.CONFIG?.homeAssistant?.token || '';
    const applied = applyRendererConfig(nextConfig);
    if (applied === false) return;
    // A page switch or tile edit echoes back a config the renderer already holds and drew.
    // Only the parts that changed get refreshed, so those echoes cost nothing visible.
    const change =
      applied && typeof applied === 'object' ? applied : { quickAccess: true, other: true };
    if (!IS_DESKTOP_PIN_MODE && change.other) syncTrayEntityIconsWithConfig();
    const nextConnection = getConnectionIdentity(state.CONFIG);
    // Apply the versioned config synchronously before yielding. The preload
    // buffers config echoes while writes are pending, and this avoids an older
    // event resuming after a newer optimistic mutation.
    if (change.other) await refreshLocaleBootstrap();
    if (!IS_SPECIAL_PIN_MODE && configuredRuntimeStarted && change.other) {
      alerts.initializeEntityAlerts();
    }
    if (change.other || change.quickAccess) renderCurrentMode();
    noteTokenRecoveryReason();
    const wizardShown = maybeShowFirstRunWizard();
    const nowConfigured = isConfigured(state.CONFIG);
    if (!wizardShown && nowConfigured) {
      if (!configuredRuntimeStarted) {
        startConfiguredRuntime();
      } else if (
        !wasConfigured ||
        wasSecureStoragePending ||
        previousConnection !== nextConnection
      ) {
        closeWebSocket();
        connectWebSocket();
      } else if (previousToken !== (state.CONFIG?.homeAssistant?.token || '') && !websocket.ws) {
        // A refreshed OAuth access token is only needed for the next handshake: an open socket
        // stays authenticated, and one mid-handshake is left to finish. With no socket at all,
        // retry with the new token now rather than after a backoff, or never after an auth
        // failure.
        connectWebSocket();
      }
    } else if (!nowConfigured) {
      if (configuredRuntimeStarted && wasConfigured) closeWebSocket();
      // A close made on purpose leaves the socket's own close handler silent, so without this the
      // header went on saying "Connected" over the wizard, as did the tray and the bar. (OAuth
      // says its own state below.)
      if (
        !usesOAuth() &&
        !isSecureStoragePending() &&
        !showTokenRecovery() &&
        (wasConfigured || wasSecureStoragePending)
      ) {
        if (!['idle', 'disconnected'].includes(mainConnectionState)) {
          updateMainConnectionState('disconnected');
        }
        setDisconnectedStatus(getNotSetUpStatus());
        renderMainWidgetState();
      }
    }
    if (!nowConfigured && usesOAuth() && !IS_DESKTOP_PIN_MODE) {
      setOAuthRestoreStatus();
      renderMainWidgetState();
    }
    if (!IS_SPECIAL_PIN_MODE) settings.refreshHomeAssistantAuthStatus?.();
    // The Hyprland bindings shown in Settings follow the hotkeys, whichever control changed them.
    if (!IS_SPECIAL_PIN_MODE) {
      void settings.refreshDesktopIntegrationIfHotkeysChanged?.().catch((error) => {
        log.warn('Failed to refresh the shortcut bindings:', error);
      });
    }
  } catch (error) {
    log.error('Failed to apply config-updated event:', error);
  }
});

window.electronAPI.onConfigPersistenceWarning((warnings) => {
  showConfigPersistenceWarnings(warnings);
});

window.electronAPI.onDesktopPinActionRequested((payload) => {
  if (IS_DESKTOP_PIN_MODE) return;
  ui.handleDesktopPinActionRequest(payload);
});

// Main ended the pins' edit mode because it hid this window; Reorganize mode goes with it.
window.electronAPI.onDesktopPinEditModeEnded?.(() => {
  if (IS_DESKTOP_PIN_MODE) return;
  ui.exitReorganizeMode();
});

window.electronAPI.onEntityTileHotkeyRequested(({ entityId, remove } = {}) => {
  if (IS_DESKTOP_PIN_MODE || !entityId) return;
  if (remove) void hotkeys.removeEntityHotkey(entityId);
  else hotkeys.assignHotkeyToEntity(entityId);
});

window.electronAPI.onDesktopCompanionStateChanged?.((nextState) => {
  void desktopCompanionClient?.reportState(null, nextState);
});

window.addEventListener('desktop-companion-page-changed', () => {
  void desktopCompanionClient?.reportState();
});

window.electronAPI.onDesktopPinUpdate((payload) => {
  void handleDesktopPinUpdate(payload);
});

// Main asks for a snapshot when a pin window boots against an empty cache. The
// empty→non-empty pin transition can hide inside a coalesced config broadcast, so the
// transition detector in refreshDesktopPinStatePublishing alone cannot be trusted to
// have seen it.
window.electronAPI.onDesktopPinSnapshotNeeded?.(() => {
  refreshDesktopPinStatePublishing({ force: true });
});

// Main creates a Tray per configured entity but cannot draw the value; it asks the renderer
// for a full re-render whenever a new tray icon appears.
window.electronAPI.onTrayEntitiesRefreshNeeded?.(({ reconnect = false, entityId = null } = {}) => {
  if (IS_DESKTOP_PIN_MODE) return;
  if (reconnect) {
    // A reconnect request is how main reports waking from suspend. Timers do not count the time
    // the machine slept, so the tick armed before it could fire up to a minute late and leave the
    // clock behind.
    runUiTick();
    setTrayEntityConnectionState(false);
    closeWebSocket();
    connectWebSocket();
    return;
  }
  if (entityId) {
    void tickTrayEntityIcon(entityId);
    return;
  }
  refreshTrayEntityIcons({ force: true });
});

// Main downloads newer versions of the installed language packs in the background (an upgrade's
// new strings only live in the packs). Draw the window again with the new words.
window.electronAPI.onLocalePacksUpdated?.(async () => {
  try {
    await refreshLocaleBootstrap();
    renderCurrentMode();
  } catch (error) {
    log.warn('Failed to apply the updated language packs:', error);
  }
});

/**
 * Give the statically authored controls their SVG icons.
 *
 * The header controls carry their SVG in index.html so the first paint never flashes an emoji.
 * Modal close buttons still ship a literal `×` and are swapped at runtime — statically authored
 * ones by the `applyCloseButtonIcons(document)` pass below, dynamically built ones by the module
 * that creates them. What remains here are the elements whose icon depends on runtime state or
 * that only exist once a view is rendered.
 */
function replaceEmojiIcons() {
  try {
    log.info('Applying SVG icons to runtime controls');

    // Quick Access Controls
    const reorganizeBtn = document.getElementById('reorganize-quick-controls-btn');
    if (reorganizeBtn) setLineIconContent(reorganizeBtn, 'grip-vertical');

    const manageBtn = document.getElementById('manage-quick-controls-btn');
    if (manageBtn) setLineIconContent(manageBtn, 'plus');

    const undoBtn = document.getElementById('undo-dashboard-btn');
    if (undoBtn) setLineIconContent(undoBtn, 'undo-2');

    // Media Player Controls
    const mediaPrevBtn = document.getElementById('media-tile-prev');
    if (mediaPrevBtn) setIconContent(mediaPrevBtn, 'skipPrevious', { size: 20 });

    const mediaPlayBtn = document.getElementById('media-tile-play');
    if (mediaPlayBtn) setIconContent(mediaPlayBtn, 'play', { size: 30 });

    const mediaNextBtn = document.getElementById('media-tile-next');
    if (mediaNextBtn) setIconContent(mediaNextBtn, 'skipNext', { size: 20 });

    // Close buttons in the statically authored modals. Dialogs built at runtime call
    // applyCloseButtonIcons themselves so they never paint the literal ×.
    applyCloseButtonIcons(document);

    log.info('Successfully applied SVG icons');
  } catch (error) {
    log.error('Error applying SVG icons:', error);
  }
}

// Pin windows never open a websocket, so Home Assistant's unit system only reaches them from main.
// Until it arrives they must not claim the metric defaults: an imperial install would read
// "72°C" for a house at 72°F, so unit-less degrees are the honest fallback.
function applyDesktopPinUnitSystem(unitSystem) {
  state.setUnitSystem(unitSystem && typeof unitSystem === 'object' ? unitSystem : {});
}

/**
 * Initialize the renderer: load configuration, apply UI preferences, wire UI, start periodic updates, initialize hotkeys and alerts, and connect to Home Assistant.
 *
 * Loads persisted config (or applies a safe default if missing), wires UI event handlers, replaces emoji icons, and handles token-reset notifications that require the user to re-enter their Home Assistant token. Applies theme, accent, background, and UI preferences, starts recurring UI updates (time, timers, media seek bars), initializes hotkeys and entity alerts, hides the loading state, renders the active tab, and initiates the WebSocket connection. Ensures the loading indicator is cleared even if the connection stalls.
 */
async function initializeDesktopPinMode() {
  try {
    log.info('Initializing desktop pin renderer');
    await refreshLocaleBootstrap();
    const bootstrap = await window.electronAPI.getDesktopPinBootstrap(DESKTOP_PIN_ENTITY_ID);
    const nextConfig = bootstrap?.config || { homeAssistant: {}, ui: {} };
    desktopPinEditMode = !!bootstrap?.editMode;
    desktopPinBounds = bootstrap?.pinBounds || null;
    desktopPinHasSnapshot = !!bootstrap?.hasSnapshot;
    desktopPinSupportsWindowPositioning = bootstrap?.supportsWindowPositioning !== false;
    applyDesktopPinUnitSystem(bootstrap?.unitSystem);

    if (nextConfig?.homeAssistant) {
      applyRendererConfig(nextConfig);
    } else {
      state.setConfig({
        homeAssistant: { url: '', token: 'YOUR_LONG_LIVED_ACCESS_TOKEN' },
        ui: {},
      });
    }

    if (bootstrap?.entity) {
      state.setStates({ [DESKTOP_PIN_ENTITY_ID]: bootstrap.entity });
    } else {
      state.setStates({});
    }

    wireDesktopPinUI();
    replaceEmojiIcons();
    uiUtils.showLoading(false);
    applyDesktopPinConnectionState(bootstrap?.connection || {});
    renderCurrentMode();
    startUiTickScheduler();
  } catch (error) {
    log.error('Desktop pin initialization error:', error);
    uiUtils.showLoading(false);
    wireDesktopPinUI();
    setDesktopPinConnectionIssue(
      t('Unable to initialize the desktop tile. Focus the main widget to review your settings.')
    );
    renderCurrentMode();
  }
}

async function init() {
  try {
    log.info('Initializing application');
    document.body.classList.toggle('desktop-pin-mode', IS_DESKTOP_PIN_MODE);

    await refreshLocaleBootstrap();
    uiUtils.showLoading(true);
    if (IS_DESKTOP_PIN_MODE) {
      await initializeDesktopPinMode();
      return;
    }

    // Initialize weather background effects. Pin windows skip this above: they render a
    // single tile with no weather surface, and the manager's constructor allocates a
    // window-sized canvas backing store. Every window.weatherEffects consumer already
    // tolerates it being absent.
    try {
      window.weatherEffects = new WeatherEffectsManager('weather-effects-canvas');
    } catch (e) {
      log.error('Failed to initialize weather background effects:', e);
    }

    // Seasonal themes follow every applyUiPreferences call, which covers the first config,
    // Settings previews and saves. Pin windows skip them with the weather canvas above.
    try {
      window.seasonalEffects = new SeasonalEffectsManager('seasonal-effects-canvas');
      uiUtils.setUiPreferencesObserver((ui) => window.seasonalEffects.apply(ui));
    } catch (e) {
      log.error('Failed to initialize seasonal themes:', e);
    }

    uiUtils.initializeConnectionStatusTooltip();
    setDisconnectedStatus(t('Disconnected from Home Assistant. Retrying automatically.'));

    const config = await window.electronAPI.getConfig();
    if (!config || !config.homeAssistant) {
      log.error('Configuration is missing or invalid');
      setDisconnectedStatus(getNotSetUpStatus());
      state.setConfig({
        homeAssistant: {
          url: '',
          token: 'YOUR_LONG_LIVED_ACCESS_TOKEN',
        },
        globalHotkeys: {
          enabled: false,
          hotkeys: {},
        },
        entityAlerts: {
          enabled: false,
          alerts: {},
        },
      });
      wireUI();
      replaceEmojiIcons();
      uiUtils.showLoading(false);
      renderCurrentMode();
      maybeShowFirstRunWizard();
      return;
    }

    const configRecovery =
      config.configRecovery && typeof config.configRecovery === 'object'
        ? { ...config.configRecovery }
        : null;
    // Runtime recovery metadata is intentionally not part of renderer state so
    // later update-config calls cannot echo it back into persisted settings.
    delete config.configRecovery;
    applyRendererConfig(config);
    wireUI();
    replaceEmojiIcons();
    showConfigRecoveryNotice(configRecovery);

    if (isClimateDemoConfig(state.CONFIG)) {
      const overlay = isClimateDemoOverlayConfig(state.CONFIG);
      if (overlay) {
        startConfiguredRuntime();
      }
      startClimateDemoRuntime({ overlay });
      return;
    }

    noteTokenRecoveryReason();

    if (!isConfigured(state.CONFIG)) {
      if (isSecureStoragePending()) {
        log.info('[Init] Secure config is pending; showing shell while saved credentials unlock.');
        setDisconnectedStatus(t('Unlocking saved Home Assistant credentials...'));
        uiUtils.showLoading(false);
        renderCurrentMode();
        maybeShowFirstRunWizard();
        return;
      }

      if (state.CONFIG?.homeAssistant?.authMethod === 'oauth') {
        setOAuthRestoreStatus();
        uiUtils.showLoading(false);
        renderCurrentMode();
        maybeShowFirstRunWizard();
        return;
      }

      // A saved token this computer cannot use belongs to an existing setup: the main window says
      // why and offers to enter it again, instead of starting onboarding over.
      if (showTokenRecovery()) {
        renderCurrentMode();
        return;
      }

      log.warn('[Init] Home Assistant is not configured. Showing first-run onboarding.');
      setDisconnectedStatus(getNotSetUpStatus());
      uiUtils.showLoading(false);
      renderCurrentMode();
      maybeShowFirstRunWizard();
      return;
    }

    startConfiguredRuntime();
  } catch (error) {
    log.error('Initialization error:', error);
    uiUtils.showLoading(false);
    throw error;
  }
}

// Disabling a toggle while main applies it drops keyboard focus to the page. Put it back unless
// the user has moved on meanwhile.
function reenableSettingsToggle(toggle, hadFocus) {
  toggle.disabled = false;
  if (hadFocus && (!document.activeElement || document.activeElement === document.body)) {
    toggle.focus();
  }
}

/**
 * Attach event listeners and wire up interactive UI controls, modals, and settings handlers.
 *
 * Sets up button clicks, input/change handlers, modal open/close behavior, quick-controls and weather interactions,
 * media controls, hotkeys registration and management, alert toggles, preview hooks for window effects, and focus/trap utilities.
 */
function wireUI() {
  try {
    commandPalette.initializeCommandPalette();
    initializeDashboardTools();

    const settingsBtn = document.getElementById('settings-btn');
    if (settingsBtn) {
      settingsBtn.onclick = openSettingsModal;
    }

    const closeSettingsBtn = document.getElementById('close-settings');
    if (closeSettingsBtn) closeSettingsBtn.onclick = settings.closeSettings;

    const cancelSettingsBtn = document.getElementById('cancel-settings');
    if (cancelSettingsBtn) cancelSettingsBtn.onclick = settings.closeSettings;

    const saveSettingsBtn = document.getElementById('save-settings');
    if (saveSettingsBtn) saveSettingsBtn.onclick = settings.saveSettings;

    const viewLogsBtn = document.getElementById('view-logs-btn');
    if (viewLogsBtn) {
      viewLogsBtn.onclick = async () => {
        try {
          const result = await window.electronAPI.openLogs();
          if (result.success) {
            log.info('Log file opened successfully');
            // The file manager opens somewhere else on the screen, or behind the widget; this says
            // that something happened, and where the file is.
            uiUtils.showToast(
              t('Showing the log file: {{path}}', { path: result.path }),
              'info',
              5000
            );
          } else {
            log.error('Failed to open log file:', result.error);
            // No file manager answered (a bare window manager), so hand over the path instead.
            const copied = result.path ? await uiUtils.copyTextToClipboard(result.path) : false;
            uiUtils.showToast(
              copied
                ? t('No file manager opened. The path of the log file was copied: {{path}}', {
                    path: result.path,
                  })
                : t('Failed to open log file: {{error}}', { error: result.error }),
              'error',
              8000
            );
          }
        } catch (error) {
          log.error('Error opening log file:', error);
          uiUtils.showToast(
            t('Error opening log file: {{error}}', { error: error.message }),
            'error'
          );
        }
      };
    }

    // Opacity slider handler with real-time preview
    // Scale: 1-100 where 1 = 50% opacity, 100 = 100% opacity
    const opacitySlider = document.getElementById('opacity-slider');
    if (opacitySlider && document.getElementById('opacity-value')) {
      opacitySlider.addEventListener('input', () => {
        // The readout shows the opacity the position stands for (0.5-1.0), as a percentage.
        settings.updateOpacityReadout?.();
        // Apply preview without persisting
        if (settings.previewWindowEffects) {
          settings.previewWindowEffects();
        }
      });
    }

    const frostedGlassToggle = document.getElementById('frosted-glass');
    if (frostedGlassToggle) {
      frostedGlassToggle.addEventListener('change', () => {
        if (settings.syncWeatherEffectsAvailability) {
          settings.syncWeatherEffectsAvailability({ showWarning: true });
        }
        if (settings.previewWindowEffects) {
          settings.previewWindowEffects();
        }
        void settings.refreshDesktopBlur?.();
      });
    }

    const weatherEffectsToggle = document.getElementById('weather-effects-enabled');
    const weatherOverrideSelect = document.getElementById('weather-override-select');
    const weatherOverrideGroup = document.getElementById('weather-override-group');
    if (weatherEffectsToggle) {
      weatherEffectsToggle.addEventListener('change', () => {
        const canEnableWeatherEffects = settings.syncWeatherEffectsAvailability
          ? settings.syncWeatherEffectsAvailability({ showWarning: true })
          : true;
        if (weatherOverrideGroup) {
          weatherOverrideGroup.style.display =
            canEnableWeatherEffects && weatherEffectsToggle.checked ? '' : 'none';
        }
        if (settings.previewWindowEffects) {
          settings.previewWindowEffects();
        }
      });
    }

    if (weatherOverrideSelect) {
      weatherOverrideSelect.addEventListener('change', () => {
        if (settings.previewWindowEffects) {
          settings.previewWindowEffects();
        }
      });
    }

    // Wire up essential UI buttons
    const closeBtn = document.getElementById('close-btn');
    if (closeBtn) {
      closeBtn.onclick = () => {
        window.electronAPI.closeWindow();
      };
    }

    const minimizeBtn = document.getElementById('minimize-btn');
    if (minimizeBtn) {
      minimizeBtn.onclick = () => {
        window.electronAPI.minimizeWindow();
      };
    }

    // Wire up Quick Access buttons
    const manageQuickControlsBtn = document.getElementById('manage-quick-controls-btn');
    if (manageQuickControlsBtn) {
      manageQuickControlsBtn.onclick = openQuickAccessModal;
    }

    const closeQuickControlsBtn = document.getElementById('close-quick-controls');
    const closeQuickControlsModal = () => {
      const modal = document.getElementById('quick-controls-modal');
      if (!modal) return Promise.resolve();
      // Releases the focus trap and restores previous focus once the exit animation finishes.
      return uiUtils.closeDialog(modal);
    };
    if (closeQuickControlsBtn) {
      closeQuickControlsBtn.onclick = closeQuickControlsModal;
    }

    const addComparisonGraphBtn = document.getElementById('add-comparison-graph-btn');
    if (addComparisonGraphBtn) {
      addComparisonGraphBtn.onclick = async () => {
        // Close the picker first so the new graph's editor isn't stacked behind it. The close is
        // animated, so it has to be awaited: the editor's own open resolves sooner than that.
        await closeQuickControlsModal();
        ui.addComparisonGraphTile();
      };
    }

    const reorganizeQuickControlsBtn = document.getElementById('reorganize-quick-controls-btn');
    if (reorganizeQuickControlsBtn) {
      reorganizeQuickControlsBtn.onclick = ui.toggleReorganizeMode;
    }

    // Wire up weather card long press
    const statusCards = [
      document.getElementById('weather-card'),
      document.getElementById('time-card'),
    ];
    // The picker's focus trap returns focus to the card when it closes.
    const openWeatherPicker = () => {
      const modal = document.getElementById('weather-config-modal');
      if (!modal) return;
      ui.populateWeatherEntitiesList();
      uiUtils.openDialog(modal);
    };
    statusCards.forEach((card) => {
      if (!card) return;
      bindWeatherCardPicker(card, {
        isWeatherCard: () =>
          card.dataset.primaryType === 'weather' || card.classList.contains('weather-card'),
        openPicker: openWeatherPicker,
      });
    });

    // Wire up alerts management
    const closeAlertEntityPickerBtn = document.getElementById('close-alert-entity-picker');
    if (closeAlertEntityPickerBtn) {
      closeAlertEntityPickerBtn.onclick = settings.closeAlertEntityPicker;
    }

    const closeAlertConfigBtn = document.getElementById('close-alert-config');
    if (closeAlertConfigBtn) {
      closeAlertConfigBtn.onclick = settings.closeAlertConfigModal;
    }

    const saveAlertBtn = document.getElementById('save-alert');
    if (saveAlertBtn) {
      saveAlertBtn.onclick = settings.saveAlert;
    }

    const cancelAlertBtn = document.getElementById('cancel-alert');
    if (cancelAlertBtn) {
      cancelAlertBtn.onclick = settings.closeAlertConfigModal;
    }

    // Wire up media tile controls
    const mediaTilePlay = document.getElementById('media-tile-play');
    if (mediaTilePlay) {
      mediaTilePlay.onclick = () => {
        const primaryPlayer = state.CONFIG.primaryMediaPlayer;
        if (!primaryPlayer) return;
        const entity = state.STATES[primaryPlayer];
        if (!entity) return;
        const isPlaying = entity.state === 'playing';
        ui.callMediaTileService(isPlaying ? 'pause' : 'play');
      };
    }

    // The track opens the player's volume, mute and seek, which the card has no controls for.
    const mediaTileInfo = document.getElementById('media-tile-info');
    if (mediaTileInfo) {
      mediaTileInfo.onclick = () => {
        const entity = state.STATES?.[state.CONFIG.primaryMediaPlayer];
        if (entity) ui.openEntityControls(entity);
      };
    }

    const mediaTilePrev = document.getElementById('media-tile-prev');
    if (mediaTilePrev) {
      mediaTilePrev.onclick = () => ui.callMediaTileService('previous');
    }

    const mediaTileNext = document.getElementById('media-tile-next');
    if (mediaTileNext) {
      mediaTileNext.onclick = () => ui.callMediaTileService('next');
    }

    const closeWeatherConfig = () => {
      const modal = document.getElementById('weather-config-modal');
      if (modal) {
        void uiUtils.closeDialog(modal);
      }
    };
    const closeWeatherConfigBtn = document.getElementById('close-weather-config');
    if (closeWeatherConfigBtn) {
      closeWeatherConfigBtn.onclick = closeWeatherConfig;
    }

    const clearWeatherBtn = document.getElementById('clear-weather');
    if (clearWeatherBtn) {
      clearWeatherBtn.onclick = async () => {
        // Nothing is picked while the card follows the first available entity; there is nothing to
        // clear, and no write or "cleared" toast to give for it.
        if (!state.CONFIG.selectedWeatherEntity) return;
        try {
          // Clear the selected weather entity (revert to default). null, as Settings saves it:
          // an undefined survives the IPC and sits in main's config until the next restart.
          const persistedConfig = await window.electronAPI.updateConfig({
            selectedWeatherEntity: null,
          });
          applyRendererConfig(persistedConfig);

          // Refresh weather display
          ui.updateWeatherFromHA();

          // Refresh the list
          ui.populateWeatherEntitiesList();

          uiUtils.showToast(t('Weather entity cleared (using first available)'), 'success', 2000);
        } catch (error) {
          console.error('Error clearing weather entity:', error);
          uiUtils.showToast(t('Failed to clear weather entity'), 'error', 3000);
        }
      };
    }

    const globalHotkeysEnabled = document.getElementById('global-hotkeys-enabled');
    if (globalHotkeysEnabled) {
      globalHotkeysEnabled.onchange = async (e) => {
        const requestedEnabled = !!e.target.checked;
        const previousEnabled = !!state.CONFIG.globalHotkeys?.enabled;
        const hotkeysSection = document.getElementById('hotkeys-section');
        const hadFocus = document.activeElement === e.target;
        e.target.disabled = true;
        try {
          const success = await hotkeys.toggleHotkeys(requestedEnabled);
          const appliedEnabled = success ? requestedEnabled : previousEnabled;
          e.target.checked = appliedEnabled;
          if (hotkeysSection) {
            hotkeysSection.style.display = appliedEnabled ? 'block' : 'none';
          }
        } finally {
          reenableSettingsToggle(e.target, hadFocus);
        }
      };
    }

    const entityAlertsEnabled = document.getElementById('entity-alerts-enabled');
    if (entityAlertsEnabled) {
      entityAlertsEnabled.onchange = async (e) => {
        const requestedEnabled = !!e.target.checked;
        const previousEnabled = !!state.CONFIG.entityAlerts?.enabled;
        const alertsSection = document.getElementById('alerts-section');
        const hadFocus = document.activeElement === e.target;
        e.target.disabled = true;
        try {
          const success = await alerts.toggleAlerts(requestedEnabled);
          const appliedEnabled = success ? requestedEnabled : previousEnabled;
          e.target.checked = appliedEnabled;
          if (alertsSection) {
            alertsSection.style.display = appliedEnabled ? 'block' : 'none';
          }
          if (appliedEnabled) {
            settings.renderAlertsListInline();
          }
        } finally {
          reenableSettingsToggle(e.target, hadFocus);
        }
      };
    }

    // Home Assistant's own notifications on the desktop; its own switch, which entity alerts being
    // off does not turn off. Applies at once, like the entity alerts switch beside it.
    const persistentNotificationToasts = document.getElementById('persistent-notification-toasts');
    if (persistentNotificationToasts) {
      persistentNotificationToasts.onchange = async (e) => {
        const requested = !!e.target.checked;
        const previous = state.CONFIG.entityAlerts?.persistentNotifications !== false;
        const hadFocus = document.activeElement === e.target;
        e.target.disabled = true;
        try {
          const result = await window.electronAPI.setPersistentNotificationToasts(requested);
          if (result?.success) {
            state.CONFIG.entityAlerts = {
              ...(state.CONFIG.entityAlerts || { enabled: false, alerts: {} }),
              persistentNotifications: requested,
            };
          } else {
            e.target.checked = previous;
            uiUtils.showToast(result?.error || t('Error toggling alerts'), 'error', 3000);
          }
        } catch (error) {
          log.error('Failed to save the Home Assistant notifications setting:', error);
          e.target.checked = previous;
          uiUtils.showToast(t('Error toggling alerts'), 'error', 2000);
        } finally {
          reenableSettingsToggle(e.target, hadFocus);
        }
      };
    }

    document.querySelectorAll('.modal-tabs .tab-link').forEach((button) => {
      button.addEventListener('click', () => {
        const tab = button.dataset.tab;
        document.querySelectorAll('.modal-tabs .tab-link').forEach((btn) => {
          btn.classList.remove('active');
          btn.setAttribute('aria-selected', 'false');
        });
        button.classList.add('active');
        button.setAttribute('aria-selected', 'true');
        syncRovingTabIndex(button.closest('.modal-tabs').querySelectorAll('.tab-link'), button);
        document
          .querySelectorAll('.modal-body .tab-content')
          .forEach((content) => content.classList.remove('active'));
        const activeContent = document.getElementById(`${tab}-tab`);
        activeContent.classList.add('active');
        // Each page opens at its top rather than at the previous page's scroll position.
        const settingsBody = button.closest('.modal-content')?.querySelector('.modal-body');
        if (settingsBody) settingsBody.scrollTop = 0;
        syncSlidingIndicator(button.closest('.modal-tabs'), button);
        animateEnter(activeContent.children, { direction: 0, maxStagger: 5 });
        settings.syncSegmentedIndicators(activeContent);
        if (tab === 'personalization' || tab === 'dashboard') {
          requestAnimationFrame(() => {
            settings.refreshPersonalizationSectionHeights();
          });
        }
        if (tab === 'hotkeys') {
          hotkeys.renderHotkeysTab();
        }
      });
    });

    // The rail is a column, and a row in a narrow window: either pair of arrows moves along it,
    // and it says which it is.
    document.querySelectorAll('.modal-tabs').forEach((tabList) => {
      bindTabListKeyboard(tabList, '.tab-link', { orientation: 'both' });
      bindTabListOrientation(tabList);
      bindTabTooltips(tabList, '.tab-link');
    });

    const hotkeySearch = document.getElementById('hotkey-entity-search');
    if (hotkeySearch) {
      hotkeySearch.addEventListener('input', hotkeys.scheduleHotkeysTabRender);
    }

    // Add click handler to widget content to bring window to focus
    const widgetContent = document.querySelector('.widget-content');
    if (widgetContent) {
      widgetContent.addEventListener('mousedown', () => {
        if (document.hasFocus()) return;
        // Request window focus when clicking on content
        window.electronAPI.focusWindow().catch((err) => {
          log.error('Failed to focus window:', err);
        });
      });
    }

    const hotkeysList = document.getElementById('hotkeys-list');
    if (hotkeysList) {
      hotkeysList.addEventListener('keydown', (event) => {
        if (event.target.classList.contains('hotkey-input') && ['Enter', ' '].includes(event.key)) {
          event.preventDefault();
          event.stopPropagation();
          event.target.click();
        }
      });
      hotkeysList.addEventListener('click', async (e) => {
        const target = e.target;
        if (target.classList.contains('hotkey-input')) {
          // The same recorder as the tile menu's Add Hotkey, so both say the same things about a
          // clash, a hotkey saved while the switch is off, and the action picked in this row.
          const actionSelect = target.parentElement.querySelector('.hotkey-action-select');
          await hotkeys.assignHotkeyToEntity(target.dataset.entityId, {
            action: actionSelect?.value,
          });
        } else if (target.closest('.btn-clear-hotkey')) {
          // The click lands on the icon inside the button as often as on the button.
          const controls = target.closest('.hotkey-input-container');
          const entityId = controls?.querySelector('.hotkey-input')?.dataset.entityId;
          if (!entityId) return;
          if (await hotkeys.clearEntityHotkey(entityId)) {
            // The list was rebuilt under the Clear button, which is hidden now there is nothing to
            // clear; the row's own field is where the keyboard goes on.
            hotkeysList
              .querySelector(`.hotkey-input[data-focus-key="hotkey-input:${entityId}"]`)
              ?.focus();
          }
        }
      });
    }
  } catch (error) {
    log.error('Error wiring UI:', error);
  }
}

function wireDesktopPinUI() {
  try {
    const focusBtn = document.getElementById('desktop-pin-focus-btn');
    if (focusBtn) {
      focusBtn.onclick = () => {
        if (focusBtn.disabled) return;
        window.electronAPI
          .requestDesktopPinAction(DESKTOP_PIN_ENTITY_ID, 'focus-main')
          .catch((error) => {
            log.error('Failed to focus main widget from desktop pin:', error);
          });
      };
    }

    // Main works out the position from the corner and the size asked for: the edge opposite the
    // handle stays put whatever the interface scale, and the work area the drag began on limits it.
    const sendResize = async (corner, size, final) => {
      const result = await window.electronAPI.updateDesktopPinBounds(DESKTOP_PIN_ENTITY_ID, {
        width: size.width,
        height: size.height,
        resize: { corner, final },
      });
      if (result?.success && result.pinBounds) {
        desktopPinBounds = result.pinBounds;
      }
      return result;
    };
    const getInterfaceScale = () => {
      const scale = Number(state.CONFIG?.ui?.scale);
      return scale > 1 ? scale : 1;
    };
    // The arrow keys' resizes in progress, shared by the handles: the size the latest press asked
    // for, the request waiting to be sent, and the loop sending them.
    const keyboardResize = { asked: null, queued: null, running: null };
    const sendQueuedKeyboardResizes = async () => {
      try {
        while (keyboardResize.queued) {
          const { corner, size } = keyboardResize.queued;
          keyboardResize.queued = null;
          try {
            await sendResize(corner, size, true);
          } catch (error) {
            log.error('Failed to resize desktop tile from the keyboard:', error);
          }
        }
      } finally {
        keyboardResize.asked = null;
        keyboardResize.running = null;
      }
    };

    document.querySelectorAll('.desktop-pin-resize-handle').forEach((resizeHandle) => {
      if (resizeHandle.dataset.bound) return;
      resizeHandle.dataset.bound = 'true';

      resizeHandle.addEventListener(
        'pointerdown',
        (event) => {
          if (!desktopPinEditMode) return;

          event.preventDefault();
          event.stopPropagation();

          const startX = event.screenX;
          const startY = event.screenY;
          const startBounds = desktopPinBounds || {
            x: window.screenX || 0,
            y: window.screenY || 0,
            width: window.outerWidth || window.innerWidth,
            height: window.outerHeight || window.innerHeight,
          };
          const corner = resizeHandle.dataset.corner || 'bottom-right';
          const scale = getInterfaceScale();
          const pointerFactor = getPointerScreenFactor({
            scale,
            windowWidth: Math.ceil(startBounds.width * scale),
            outerWidth: window.outerWidth,
          });

          let pendingSize = null;
          let lastSize = null;
          let resizeInFlight = null;
          let frameScheduled = false;
          const pointerId = event.pointerId;

          try {
            resizeHandle.setPointerCapture(pointerId);
          } catch {
            // Ignore pointer capture failures and continue with window listeners.
          }

          const flushResize = async () => {
            frameScheduled = false;
            if (resizeInFlight || !pendingSize) return;
            const nextSize = pendingSize;
            pendingSize = null;
            resizeInFlight = sendResize(corner, nextSize, false)
              .catch((error) => {
                log.error('Failed to resize desktop tile:', error);
              })
              .finally(() => {
                resizeInFlight = null;
                if (pendingSize && !frameScheduled) {
                  requestAnimationFrame(flushResize);
                  frameScheduled = true;
                }
              });
            await resizeInFlight;
          };

          const scheduleResize = (nextSize) => {
            pendingSize = nextSize;
            lastSize = nextSize;
            if (!frameScheduled) {
              requestAnimationFrame(flushResize);
              frameScheduled = true;
            }
          };

          const handlePointerMove = (moveEvent) => {
            scheduleResize(
              getDesktopPinResizeRequest(
                startBounds,
                corner,
                { x: moveEvent.screenX - startX, y: moveEvent.screenY - startY },
                { scale, pointerFactor }
              )
            );
          };

          const finishResize = async () => {
            window.removeEventListener('pointermove', handlePointerMove, true);
            window.removeEventListener('pointerup', finishResize, true);
            window.removeEventListener('pointercancel', finishResize, true);
            try {
              resizeHandle.releasePointerCapture(pointerId);
            } catch {
              // no-op
            }
            // The drag only changed the window; saving the size is what ends it.
            if (!lastSize) return;
            try {
              await resizeInFlight;
              await sendResize(corner, lastSize, true);
            } catch (error) {
              log.error('Failed to finish resizing desktop tile:', error);
            }
          };

          window.addEventListener('pointermove', handlePointerMove, true);
          window.addEventListener('pointerup', finishResize, true);
          window.addEventListener('pointercancel', finishResize, true);
        },
        true
      );

      // The handles are focusable buttons, so the arrow keys resize too: a step per press, a larger
      // one with Shift. A held key repeats faster than a resize round trip (every step is saved),
      // and the bounds only update when a reply arrives, so each step builds on the size the
      // previous one asked for, and the steps that arrive while a request is out go in the next one
      // together. Once nothing is waiting the bounds Main confirmed (which it may have limited) are
      // the starting point again.
      resizeHandle.addEventListener('keydown', (event) => {
        if (!desktopPinEditMode || !desktopPinBounds) return;
        const delta = getDesktopPinResizeKeyDelta(event.key, { shiftKey: event.shiftKey });
        if (!delta) return;
        event.preventDefault();
        event.stopPropagation();
        const corner = resizeHandle.dataset.corner || 'bottom-right';
        const size = getDesktopPinResizeRequest(
          keyboardResize.asked || desktopPinBounds,
          corner,
          delta,
          {
            scale: getInterfaceScale(),
          }
        );
        keyboardResize.asked = size;
        keyboardResize.queued = { corner, size };
        keyboardResize.running ||= sendQueuedKeyboardResizes();
      });
    });
  } catch (error) {
    log.error('Error wiring desktop pin UI:', error);
  }
}

window.addEventListener(
  'DOMContentLoaded',
  () => {
    void init()
      .then(async () => {
        if (IS_DESKTOP_PIN_MODE) return;
        if (typeof window.electronAPI?.signalRendererReady !== 'function') {
          throw new Error('The preload renderer-ready bridge is unavailable');
        }
        const result = await window.electronAPI.signalRendererReady();
        if (result?.success !== true) {
          throw new Error(result?.error || 'The main process rejected renderer readiness');
        }
      })
      .catch((error) => {
        log.error('Error in DOMContentLoaded handler:', error);
      });
  },
  { once: true }
);

installLayerDrag();
installRangeProgress();
installClippedTextTooltips();

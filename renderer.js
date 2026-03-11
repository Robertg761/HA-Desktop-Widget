// Load all required modules (ES Modules)
import log from './src/logger.js';
import state from './src/state.js';
import websocket from './src/websocket.js';
import * as hotkeys from './src/hotkeys.js';
import * as alerts from './src/alerts.js';
import * as ui from './src/ui.js';
import * as settings from './src/settings.js';
import * as uiUtils from './src/ui-utils.js';
import * as utils from './src/utils.js';
import { setIconContent } from './src/icons.js';
import { BASE_RECONNECT_DELAY_MS, MAX_RECONNECT_DELAY_MS } from './src/constants.js';

const CONNECTION_ERROR_TOAST_COOLDOWN_MS = 60000;
const OFFLINE_CONNECTION_ERROR_KEY = 'offline-network';
const DEFAULT_CONNECTED_STATUS_DETAIL = 'Real-time updates active.';
const DEFAULT_DISCONNECTED_STATUS_DETAIL = 'Disconnected from Home Assistant. Retrying automatically.';
const WINDOW_QUERY = new URLSearchParams(window.location.search);
const WINDOW_MODE = WINDOW_QUERY.get('mode') || '';
const IS_DESKTOP_PIN_MODE = WINDOW_MODE === 'desktop-pin';
const IS_SPECIAL_PIN_MODE = IS_DESKTOP_PIN_MODE;
const DESKTOP_PIN_ENTITY_ID = WINDOW_QUERY.get('entityId') || '';
let desktopPinEditMode = false;

function emitRendererDebug(event, details = {}) {
  try {
    if (!state.CONFIG?.ui?.enableInteractionDebugLogs) return;
    if (!window?.electronAPI?.debugLog) return;
    window.electronAPI.debugLog({
      scope: 'renderer',
      event,
      details: {
        timestamp: new Date().toISOString(),
        ...details,
      },
    }).catch(() => { });
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
        access_token: state.CONFIG.homeAssistant.token
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
let reconnectTimerId = null;
let uiTickIntervalId = null;
let offlineConnectionToastShown = false;
let lastConnectionToast = { key: null, shownAt: 0 };
let browserReportedOffline = false;
let lastDisconnectReason = DEFAULT_DISCONNECTED_STATUS_DETAIL;

function clearReconnectTimer() {
  if (!reconnectTimerId) return;
  clearTimeout(reconnectTimerId);
  reconnectTimerId = null;
}

function connectWebSocket() {
  clearReconnectTimer();
  websocket.connect();
}

function setDisconnectedStatus(detailMessage = '') {
  const normalizedDetail = typeof detailMessage === 'string' ? detailMessage.trim() : '';
  if (normalizedDetail) {
    lastDisconnectReason = normalizedDetail;
  }
  uiUtils.setStatus(false, lastDisconnectReason || DEFAULT_DISCONNECTED_STATUS_DETAIL);
}

function setConnectedStatus(detailMessage = DEFAULT_CONNECTED_STATUS_DETAIL) {
  lastDisconnectReason = '';
  uiUtils.setStatus(true, detailMessage);
}

function getSettingsUiHooks() {
  return {
    initUpdateUI: ui.initUpdateUI,
    renderActiveTab: ui.renderActiveTab,
    updateMediaTile: ui.updateMediaTile,
    renderPrimaryCards: ui.renderPrimaryCards,
    exitReorganizeMode: () => {
      const container = document.getElementById('quick-controls');
      if (container && container.classList.contains('reorganize-mode')) {
        ui.toggleReorganizeMode();
      }
    },
  };
}

function openSettingsModal() {
  settings.openSettings(getSettingsUiHooks());
}

function applyRendererConfig(nextConfig) {
  if (!nextConfig || !nextConfig.homeAssistant) return;
  state.setConfig(nextConfig);
  uiUtils.applyTheme(state.CONFIG.ui?.theme || 'auto');
  uiUtils.setCustomThemes(state.CONFIG.ui?.customColors || []);
  uiUtils.applyAccentTheme(state.CONFIG.ui?.accent || 'original');
  uiUtils.applyBackgroundTheme(state.CONFIG.ui?.background || 'original');
  uiUtils.applyUiPreferences(state.CONFIG.ui || {});
  uiUtils.applyWindowEffects(state.CONFIG || {});
}

function renderCurrentMode() {
  if (IS_DESKTOP_PIN_MODE) {
    const entity = state.STATES?.[DESKTOP_PIN_ENTITY_ID] || null;
    document.body.classList.toggle('desktop-pin-edit-mode', desktopPinEditMode);
    ui.renderDesktopPinnedTile(DESKTOP_PIN_ENTITY_ID, entity);
    return;
  }
  ui.renderActiveTab();
}

async function handleDesktopPinUpdate(message = {}) {
  try {
    if (!IS_DESKTOP_PIN_MODE) return;
    if (message.config?.homeAssistant) {
      applyRendererConfig(message.config);
    }

    if (message.entityId && message.entityId !== DESKTOP_PIN_ENTITY_ID) {
      return;
    }

    if (Object.prototype.hasOwnProperty.call(message, 'editMode')) {
      desktopPinEditMode = !!message.editMode;
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
      message: 'No network connection detected. Reconnect to Wi-Fi and the widget will retry automatically.',
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
      message: 'Unable to reach Home Assistant. Check your network or Home Assistant URL.',
      persistUntilOnline: false,
    };
  }

  return {
    key: normalizedMessage,
    message: `Connection error: ${normalizedMessage}`,
    persistUntilOnline: false,
  };
}

function shouldShowConnectionToast(toastInfo) {
  if (!toastInfo) return false;

  if (toastInfo.persistUntilOnline && offlineConnectionToastShown) {
    return false;
  }

  const now = Date.now();
  const recentlyShown =
    lastConnectionToast.key === toastInfo.key &&
    now - lastConnectionToast.shownAt < CONNECTION_ERROR_TOAST_COOLDOWN_MS;

  if (recentlyShown) return false;

  lastConnectionToast = {
    key: toastInfo.key,
    shownAt: now,
  };

  if (toastInfo.persistUntilOnline) {
    offlineConnectionToastShown = true;
  }

  return true;
}

function resetConnectionToastTracking() {
  offlineConnectionToastShown = false;
  lastConnectionToast = { key: null, shownAt: 0 };
}

function showClassifiedConnectionToast(error) {
  const toastInfo = classifyConnectionError(error);
  if (shouldShowConnectionToast(toastInfo)) {
    uiUtils.showToast(toastInfo.message, 'error', 15000);
  }
  return toastInfo;
}

function scheduleReconnect() {
  if (reconnectTimerId) return;
  const delay = Math.min(
    BASE_RECONNECT_DELAY_MS * Math.pow(2, reconnectAttempts),
    MAX_RECONNECT_DELAY_MS
  );
  const jitter = Math.random() * 1000;
  reconnectAttempts++;

  log.debug(`WebSocket closed. Reconnecting in ${Math.round((delay + jitter) / 1000)}s (attempt ${reconnectAttempts})`);
  reconnectTimerId = setTimeout(() => {
    reconnectTimerId = null;
    connectWebSocket();
  }, delay + jitter);
}

function shouldPauseUiTick() {
  const hidden = typeof document?.hidden === 'boolean' ? document.hidden : false;
  const unfocused = typeof document?.hasFocus === 'function' ? !document.hasFocus() : false;
  return hidden || unfocused;
}

function runUiTick() {
  if (shouldPauseUiTick()) return;

  const tickTargets = ui.getTickTargets?.();
  if (!tickTargets) return;

  if (tickTargets.timeVisible) {
    ui.updateTimeDisplay();
  }

  if (tickTargets.hasVisibleTimers) {
    ui.updateTimerDisplays();
  }

  if (tickTargets.mediaEntity) {
    ui.updateMediaSeekBar(tickTargets.mediaEntity);
  }
}

function startUiTickScheduler() {
  if (uiTickIntervalId) return;

  uiTickIntervalId = setInterval(runUiTick, 1000);
  runUiTick();

  document.addEventListener('visibilitychange', runUiTick);
  window.addEventListener('focus', runUiTick);
}

window.addEventListener('online', () => {
  resetConnectionToastTracking();
  const shouldForceReconnect = browserReportedOffline;
  browserReportedOffline = false;
  setDisconnectedStatus('Network restored. Reconnecting to Home Assistant...');
  if (shouldForceReconnect || !websocket.ws || websocket.ws.readyState !== WebSocket.OPEN) {
    connectWebSocket();
  }
});

window.addEventListener('offline', () => {
  browserReportedOffline = true;
  clearReconnectTimer();
  setDisconnectedStatus('No network connection detected. Reconnect to Wi-Fi and the widget will retry automatically.');
  uiUtils.showLoading(false);
  ui.renderActiveTab();
  showClassifiedConnectionToast(new Error('Browser reported offline'));

  // Proactively close stale sockets so reconnect can start fresh once online.
  if (websocket.ws) {
    try {
      websocket.ws.__intentionalClose = true;
      websocket.ws.close();
      websocket.ws = null;
    } catch (error) {
      log.warn('Error closing WebSocket after offline event:', error);
    }
  }
});

websocket.on('message', (msg) => {
  try {
    if (msg.type === 'auth_ok') {
      log.debug('WebSocket authentication successful');
      reconnectAttempts = 0; // Reset on successful connection
      browserReportedOffline = false;
      resetConnectionToastTracking();
      clearReconnectTimer();
      setConnectedStatus();
      const statesReq = websocket.request({ type: 'get_states' });
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
      statesReq.catch(() => { });
      servicesReq.catch(() => { });
      areasReq.catch(() => { });
      configReq.catch((err) => {
        log.error('get_config request failed:', err);
      });
      websocket.request({ type: 'subscribe_events', event_type: 'state_changed' });
    } else if (msg.type === 'auth_invalid') {
      log.error('[WS] Invalid authentication token');
      setDisconnectedStatus('Authentication failed. Please check your Home Assistant token in Settings.');
      uiUtils.showLoading(false);
      // Show clear error message to user
      uiUtils.showToast('Authentication failed. Please check your Home Assistant token in Settings.', 'error', 15000);
      // Render the UI so user can access settings
      renderCurrentMode();
    } else if (msg.type === 'event' && msg.event?.event_type === 'state_changed') {
      const entity = msg.event.data.new_state;
      if (entity) {
        state.setEntityState(entity);
        window.electronAPI.publishHaEntityUpdate(entity).catch((error) => {
          log.warn('Failed to publish HA entity update to main process:', error);
        });
        if (IS_SPECIAL_PIN_MODE && entity.entity_id === DESKTOP_PIN_ENTITY_ID) {
          renderCurrentMode();
        } else if (ui.isEntityVisible(entity.entity_id)) {
          ui.updateEntityInUI(entity);
        }
        alerts.checkEntityAlerts(entity.entity_id, entity.state);
      }
    } else if (msg.type === 'result') {
      log.debug(`Received result for message ID: ${msg.id}`);
      if (msg.result) {
        if (msg.id === getStatesId) { // get_states response
          const newStates = {};
          if (Array.isArray(msg.result)) {
            log.debug(`Successfully fetched ${msg.result.length} entities from Home Assistant`);
            msg.result.forEach(entity => { newStates[entity.entity_id] = entity; });

            // Preserve only favorited entities from old states (in case they're temporarily unavailable during HA restart)
            // This prevents deleted entities from persisting indefinitely while still protecting favorites
            const favoriteEntityIds = state.CONFIG.favoriteEntities || [];
            const preservedFavorites = {};
            favoriteEntityIds.forEach(entityId => {
              if (state.STATES[entityId] && !newStates[entityId]) {
                preservedFavorites[entityId] = state.STATES[entityId];
              }
            });

            const mergedStates = { ...newStates, ...preservedFavorites };
            log.debug(`State update: ${Object.keys(newStates).length} from HA + ${Object.keys(preservedFavorites).length} preserved favorites = ${Object.keys(mergedStates).length} total`);
            emitRendererDebug('ws.get_states.received', {
              fetchedEntities: Object.keys(newStates).length,
              preservedFavorites: Object.keys(preservedFavorites),
              mergedTotal: Object.keys(mergedStates).length,
              favoriteCount: Array.isArray(state.CONFIG?.favoriteEntities) ? state.CONFIG.favoriteEntities.length : 0,
            });
            state.setStates(mergedStates);
            window.electronAPI.publishHaSnapshot(mergedStates).catch((error) => {
              log.warn('Failed to publish HA snapshot to main process:', error);
            });

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
              window.electronAPI.updateConfig(reconciliation.config).catch((error) => {
                log.error('Failed to persist reconciled entity IDs:', error);
                emitRendererDebug('config.entity_id_reconciliation.persist_error', {
                  error: error?.message || String(error),
                });
              });
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
            }
            uiUtils.showLoading(false);

            if (!IS_SPECIAL_PIN_MODE) {
              alerts.initializeEntityAlerts();
            }
          }
        } else if (msg.id === getServicesId) { // get_services response
          state.setServices(msg.result);
        } else if (msg.id === getAreasId) { // get_areas response
          const newAreas = {};
          if (Array.isArray(msg.result)) {
            msg.result.forEach(area => { newAreas[area.area_id] = area; });
            state.setAreas(newAreas);
          }
        } else if (msg.id === getConfigId) { // get_config response
          log.debug('Received config from Home Assistant:', JSON.stringify(msg.result, null, 2));
          if (msg.result && msg.result.unit_system) {
            log.debug('Unit system found:', JSON.stringify(msg.result.unit_system, null, 2));
            state.setUnitSystem(msg.result.unit_system);
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
    if (closeInfo?.intentional) {
      log.debug('WebSocket closed intentionally; skipping reconnect schedule');
      return;
    }

    setDisconnectedStatus(DEFAULT_DISCONNECTED_STATUS_DETAIL);
    uiUtils.showLoading(false);

    scheduleReconnect();
  } catch (error) {
    log.error('Error handling WebSocket close:', error);
  }
});

websocket.on('error', (error) => {
  try {
    log.error('WebSocket error:', error);
    const classifiedIssue = classifyConnectionError(error);
    setDisconnectedStatus(classifiedIssue.message);
    uiUtils.showLoading(false); // Hide loading on failure

    // Show the UI with setup message
    ui.renderActiveTab();

    // Show user-friendly error message
    const errorMessage = String(error?.message || '');
    if (errorMessage.includes('default token')) {
      setDisconnectedStatus('Please configure your Home Assistant token in Settings (gear icon).');
      uiUtils.showToast('Please configure your Home Assistant token in Settings (gear icon).', 'error', 20000);
    } else if (errorMessage.includes('Invalid configuration')) {
      setDisconnectedStatus('Please configure connection settings (gear icon).');
      uiUtils.showToast('Please configure connection settings (gear icon).', 'error', 20000);
    } else if (!errorMessage.includes('auth_invalid')) {
      // Don't show toast for auth_invalid as it's already handled elsewhere
      const toastInfo = showClassifiedConnectionToast(error);
      setDisconnectedStatus(toastInfo?.message || classifiedIssue.message);
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

// Listen for open-settings event from tray menu
window.electronAPI.onOpenSettings(() => {
  if (IS_SPECIAL_PIN_MODE) return;
  openSettingsModal();
});

window.electronAPI.onProfileSyncStatus((status) => {
  if (settings.handleProfileSyncStatusUpdate) {
    settings.handleProfileSyncStatusUpdate(status);
  }
});

window.electronAPI.onConfigUpdated((nextConfig) => {
  try {
    if (!nextConfig || !nextConfig.homeAssistant) return;
    applyRendererConfig(nextConfig);
    renderCurrentMode();
  } catch (error) {
    log.error('Failed to apply config-updated event:', error);
  }
});

window.electronAPI.onDesktopPinActionRequested((payload) => {
  if (IS_DESKTOP_PIN_MODE) return;
  ui.handleDesktopPinActionRequest(payload);
});

window.electronAPI.onDesktopPinUpdate((payload) => {
  void handleDesktopPinUpdate(payload);
});

/**
 * Replace all emoji icons with SVG icons
 * This runs once on initialization to modernize the UI
 */
function replaceEmojiIcons() {
  try {
    log.info('Replacing emoji icons with SVG icons');

    // Header Controls
    const settingsBtn = document.getElementById('settings-btn');
    if (settingsBtn) setIconContent(settingsBtn, 'settings', { size: 18 });

    const minimizeBtn = document.getElementById('minimize-btn');
    if (minimizeBtn) setIconContent(minimizeBtn, 'minimize', { size: 18 });

    const closeBtn = document.getElementById('close-btn');
    if (closeBtn) setIconContent(closeBtn, 'close', { size: 18 });

    // Quick Access Controls
    const reorganizeBtn = document.getElementById('reorganize-quick-controls-btn');
    if (reorganizeBtn) setIconContent(reorganizeBtn, 'dragHandle', { size: 18 });

    const manageBtn = document.getElementById('manage-quick-controls-btn');
    if (manageBtn) setIconContent(manageBtn, 'add', { size: 18 });

    // Media Player Controls
    const mediaPrevBtn = document.getElementById('media-tile-prev');
    if (mediaPrevBtn) setIconContent(mediaPrevBtn, 'skipPrevious', { size: 20 });

    const mediaPlayBtn = document.getElementById('media-tile-play');
    if (mediaPlayBtn) setIconContent(mediaPlayBtn, 'play', { size: 30 });

    const mediaNextBtn = document.getElementById('media-tile-next');
    if (mediaNextBtn) setIconContent(mediaNextBtn, 'skipNext', { size: 20 });

    // Modal Close Buttons (with × emoji)
    const closeButtons = document.querySelectorAll('.close-btn');
    closeButtons.forEach(btn => {
      if (btn.textContent.includes('×')) {
        setIconContent(btn, 'close', { size: 20 });
      }
    });

    log.info('Successfully replaced emoji icons with SVG icons');
  } catch (error) {
    log.error('Error replacing emoji icons:', error);
  }
}

/**
 * Initialize the renderer: load configuration, apply UI preferences, wire UI, start periodic updates, initialize hotkeys and alerts, and connect to Home Assistant.
 *
 * Loads persisted config (or applies a safe default if missing), wires UI event handlers, replaces emoji icons, and handles token-reset notifications that require the user to re-enter their Home Assistant token. Applies theme, accent, background, and UI preferences, starts recurring UI updates (time, timers, media seek bars), initializes hotkeys and entity alerts, hides the loading state, renders the active tab, and initiates the WebSocket connection. Ensures the loading indicator is cleared even if the connection stalls.
 */
async function initializeDesktopPinMode() {
  try {
    log.info('Initializing desktop pin renderer');
    const bootstrap = await window.electronAPI.getDesktopPinBootstrap(DESKTOP_PIN_ENTITY_ID);
    const nextConfig = bootstrap?.config || await window.electronAPI.getConfig();
    desktopPinEditMode = !!bootstrap?.editMode;

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
    renderCurrentMode();
    if (nextConfig?.homeAssistant?.token && nextConfig.homeAssistant.token !== 'YOUR_LONG_LIVED_ACCESS_TOKEN') {
      connectWebSocket();
    }
  } catch (error) {
    log.error('Desktop pin initialization error:', error);
    uiUtils.showLoading(false);
    ui.renderDesktopPinnedTile(DESKTOP_PIN_ENTITY_ID, null);
  }
}

async function init() {
  try {
    log.info('Initializing application');
    document.body.classList.toggle('desktop-pin-mode', IS_DESKTOP_PIN_MODE);
    uiUtils.showLoading(true);
    if (IS_DESKTOP_PIN_MODE) {
      await initializeDesktopPinMode();
      return;
    }

    uiUtils.initializeConnectionStatusTooltip();
    setDisconnectedStatus(DEFAULT_DISCONNECTED_STATUS_DETAIL);

    const config = await window.electronAPI.getConfig();
    if (!config || !config.homeAssistant) {
      log.error('Configuration is missing or invalid');
      setDisconnectedStatus('Please configure connection settings (gear icon).');
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
      ui.renderActiveTab();
      return;
    }

    applyRendererConfig(config);
    wireUI();
    replaceEmojiIcons();

    // Check if token was reset due to encryption issues
    if (state.CONFIG.tokenResetReason) {
      const reason = state.CONFIG.tokenResetReason;
      delete state.CONFIG.tokenResetReason; // Clear flag
      await window.electronAPI.updateConfig(state.CONFIG); // Save cleared flag

      let message = 'Your Home Assistant token needs to be re-entered. ';
      let detailMessage = '';
      if (reason === 'encryption_unavailable') {
        message += 'Token encryption is not available on this system.';
        detailMessage = 'Your encrypted token from a previous installation cannot be decrypted on this system. The encrypted token has been preserved in case you move back to a system with encryption support. Please re-enter your token in Settings to continue.';
      } else if (reason === 'decryption_failed') {
        message += 'The stored token could not be decrypted.';
        detailMessage = 'The encrypted token appears to be corrupted and cannot be decrypted. The encrypted token has been preserved for recovery attempts. Please re-enter your token in Settings to continue.';
      }

      log.warn('[Init] Token reset:', message);
      log.info('[Init]', detailMessage);

      // Show prominent warning message with extended duration
      uiUtils.showToast(message + ' Click the gear icon to open Settings.', 'warning', 20000);
    }

    if (state.CONFIG.homeAssistant.token === 'YOUR_LONG_LIVED_ACCESS_TOKEN') {
      log.warn('[Init] Using default token. Please configure your Home Assistant token in settings.');
      setDisconnectedStatus('Please configure your Home Assistant token in Settings (gear icon).');
      uiUtils.showLoading(false);
      ui.renderActiveTab();
      return;
    }

    // Start consolidated UI tick scheduler for time/timer/media updates.
    startUiTickScheduler();

    hotkeys.initializeHotkeys();
    hotkeys.setupHotkeyEventListeners();
    alerts.initializeEntityAlerts();

    // Always hide loading and show UI
    uiUtils.showLoading(false);
    renderCurrentMode();

    // Connect to WebSocket in background
    log.info('Connecting to Home Assistant WebSocket');
    connectWebSocket();

    // Backup timeout to ensure loading is hidden
    setTimeout(() => {
      uiUtils.showLoading(false);
    }, 5000);

  } catch (error) {
    log.error('Initialization error:', error);
    uiUtils.showLoading(false);
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
          } else {
            log.error('Failed to open log file:', result.error);
            uiUtils.showToast('Failed to open log file: ' + result.error, 'error');
          }
        } catch (error) {
          log.error('Error opening log file:', error);
          uiUtils.showToast('Error opening log file: ' + error.message, 'error');
        }
      };
    }

    // Opacity slider handler with real-time preview
    // Scale: 1-100 where 1 = 50% opacity, 100 = 100% opacity
    const opacitySlider = document.getElementById('opacity-slider');
    const opacityValue = document.getElementById('opacity-value');
    if (opacitySlider && opacityValue) {
      opacitySlider.addEventListener('input', (e) => {
        const sliderValue = parseInt(e.target.value) || 90;
        // Convert slider value (1-100) to opacity (0.5-1.0)
        // Formula: opacity = 0.5 + (sliderValue - 1) * 0.5 / 99
        opacityValue.textContent = `${sliderValue}`;
        // Apply preview without persisting
        if (settings.previewWindowEffects) {
          settings.previewWindowEffects();
        }
      });
    }

    const frostedGlassToggle = document.getElementById('frosted-glass');
    if (frostedGlassToggle) {
      frostedGlassToggle.addEventListener('change', () => {
        if (settings.previewWindowEffects) {
          settings.previewWindowEffects();
        }
      });
    }

    // Wire up essential UI buttons
    const closeBtn = document.getElementById('close-btn');
    if (closeBtn) {
      closeBtn.onclick = () => {
        window.electronAPI.quitApp();
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
      manageQuickControlsBtn.onclick = () => {
        ui.populateQuickControlsList();
        const modal = document.getElementById('quick-controls-modal');
        if (modal) {
          modal.classList.remove('hidden');
          modal.style.display = 'flex';
          uiUtils.trapFocus(modal); // Trap focus to manage keyboard navigation and focus
        }
      };
    }

    const closeQuickControlsBtn = document.getElementById('close-quick-controls');
    if (closeQuickControlsBtn) {
      closeQuickControlsBtn.onclick = () => {
        const modal = document.getElementById('quick-controls-modal');
        if (modal) {
          modal.classList.add('hidden');
          modal.style.display = 'none';
          uiUtils.releaseFocusTrap(); // Release focus trap and restore previous focus
        }
      };
    }

    const reorganizeQuickControlsBtn = document.getElementById('reorganize-quick-controls-btn');
    if (reorganizeQuickControlsBtn) {
      reorganizeQuickControlsBtn.onclick = ui.toggleReorganizeMode;
    }

    // Wire up weather card long press
    const statusCards = [
      document.getElementById('weather-card'),
      document.getElementById('time-card')
    ];
    statusCards.forEach((card) => {
      if (!card) return;
      let pressTimer = null;
      const startPress = () => {
        if (card.dataset.primaryType !== 'weather' && !card.classList.contains('weather-card')) return;
        pressTimer = setTimeout(() => {
          const modal = document.getElementById('weather-config-modal');
          if (modal) {
            ui.populateWeatherEntitiesList();
            modal.classList.remove('hidden');
            modal.style.display = 'flex';
          }
        }, 500);
      };
      const cancelPress = () => {
        clearTimeout(pressTimer);
      };
      card.addEventListener('mousedown', startPress);
      card.addEventListener('mouseup', cancelPress);
      card.addEventListener('mouseleave', cancelPress);
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

    const mediaTilePrev = document.getElementById('media-tile-prev');
    if (mediaTilePrev) {
      mediaTilePrev.onclick = () => ui.callMediaTileService('previous');
    }

    const mediaTileNext = document.getElementById('media-tile-next');
    if (mediaTileNext) {
      mediaTileNext.onclick = () => ui.callMediaTileService('next');
    }

    const closeWeatherConfigBtn = document.getElementById('close-weather-config');
    if (closeWeatherConfigBtn) {
      closeWeatherConfigBtn.onclick = () => {
        const modal = document.getElementById('weather-config-modal');
        if (modal) {
          modal.classList.add('hidden');
          modal.style.display = 'none';
        }
      };
    }

    const clearWeatherBtn = document.getElementById('clear-weather');
    if (clearWeatherBtn) {
      clearWeatherBtn.onclick = async () => {
        try {
          // Clear the selected weather entity (revert to default)
          const updatedConfig = {
            ...state.CONFIG,
            selectedWeatherEntity: undefined
          };

          await window.electronAPI.updateConfig(updatedConfig);
          state.setConfig(updatedConfig);

          // Refresh weather display
          ui.updateWeatherFromHA();

          // Refresh the list
          ui.populateWeatherEntitiesList();

          uiUtils.showToast('Weather entity cleared (using first available)', 'success', 2000);
        } catch (error) {
          console.error('Error clearing weather entity:', error);
          uiUtils.showToast('Failed to clear weather entity', 'error', 3000);
        }
      };
    }

    const globalHotkeysEnabled = document.getElementById('global-hotkeys-enabled');
    if (globalHotkeysEnabled) {
      globalHotkeysEnabled.onchange = (e) => {
        const hotkeysSection = document.getElementById('hotkeys-section');
        if (hotkeysSection) {
          hotkeysSection.style.display = e.target.checked ? 'block' : 'none';
        }
        hotkeys.toggleHotkeys(e.target.checked);
      };
    }

    const entityAlertsEnabled = document.getElementById('entity-alerts-enabled');
    if (entityAlertsEnabled) {
      entityAlertsEnabled.onchange = (e) => {
        const alertsSection = document.getElementById('alerts-section');
        if (alertsSection) {
          alertsSection.style.display = e.target.checked ? 'block' : 'none';
        }
        // Render inline alerts list when enabled
        if (e.target.checked) {
          settings.renderAlertsListInline();
        }
        alerts.toggleAlerts(e.target.checked);
      };
    }

    document.querySelectorAll('.modal-tabs .tab-link').forEach(button => {
      button.addEventListener('click', () => {
        const tab = button.dataset.tab;
        document.querySelectorAll('.modal-tabs .tab-link').forEach(btn => btn.classList.remove('active'));
        button.classList.add('active');
        document.querySelectorAll('.modal-body .tab-content').forEach(content => content.classList.remove('active'));
        document.getElementById(`${tab}-tab`).classList.add('active');
        if (tab === 'personalization') {
          requestAnimationFrame(() => {
            settings.refreshPersonalizationSectionHeights();
          });
        }
        if (tab === 'hotkeys') {
          hotkeys.renderHotkeysTab();
        }
      });
    });

    const hotkeySearch = document.getElementById('hotkey-entity-search');
    if (hotkeySearch) {
      hotkeySearch.addEventListener('input', hotkeys.renderHotkeysTab);
    }

    // Add click handler to widget content to bring window to focus
    const widgetContent = document.querySelector('.widget-content');
    if (widgetContent) {
      widgetContent.addEventListener('mousedown', () => {
        if (document.hasFocus()) return;
        // Request window focus when clicking on content
        window.electronAPI.focusWindow().catch(err => {
          log.error('Failed to focus window:', err);
        });
      });
    }

    const hotkeysList = document.getElementById('hotkeys-list');
    if (hotkeysList) {
      hotkeysList.addEventListener('click', async (e) => {
        const target = e.target;
        if (target.classList.contains('hotkey-input')) {
          const entityId = target.dataset.entityId;
          target.value = 'Recording...';
          const hotkey = await hotkeys.captureHotkey();
          if (hotkey) {
            // Get selected action from custom dropdown
            const dropdown = target.parentElement.querySelector('.hotkey-action-dropdown');
            const selectedOption = dropdown?.querySelector('.custom-dropdown-option.selected');
            const action = selectedOption?.dataset?.value || 'toggle';
            const result = await window.electronAPI.registerHotkey(entityId, hotkey, action);
            if (result.success) {
              target.value = hotkey;
              state.CONFIG.globalHotkeys.hotkeys[entityId] = { hotkey, action };
            } else {
              uiUtils.showToast(result.error, 'error');
              const currentConfig = state.CONFIG.globalHotkeys?.hotkeys?.[entityId];
              target.value = (typeof currentConfig === 'string') ? currentConfig : (currentConfig?.hotkey || '');
            }
          } else {
            const currentConfig = state.CONFIG.globalHotkeys?.hotkeys?.[entityId];
            target.value = (typeof currentConfig === 'string') ? currentConfig : (currentConfig?.hotkey || '');
          }
        } else if (target.classList.contains('btn-clear-hotkey')) {
          const container = target.parentElement;
          const input = container.querySelector('.hotkey-input');
          const entityId = input.dataset.entityId;
          await window.electronAPI.unregisterHotkey(entityId);
          input.value = '';
          delete state.CONFIG.globalHotkeys.hotkeys[entityId];
          hotkeys.renderHotkeysTab();
        }
      });
    }
  } catch (error) {
    log.error('Error wiring UI:', error);
  }
}

function wireDesktopPinUI() {
  try {
    const openBtn = document.getElementById('desktop-pin-open-btn');
    if (openBtn) {
      openBtn.onclick = () => {
        window.electronAPI.requestDesktopPinAction(DESKTOP_PIN_ENTITY_ID, 'open-details').catch((error) => {
          log.error('Failed to open desktop pin details:', error);
        });
      };
    }

    const unpinBtn = document.getElementById('desktop-pin-unpin-btn');
    if (unpinBtn) {
      unpinBtn.onclick = async () => {
        try {
          await window.electronAPI.unpinEntityFromDesktop(DESKTOP_PIN_ENTITY_ID);
        } catch (error) {
          log.error('Failed to unpin desktop tile:', error);
        }
      };
    }
  } catch (error) {
    log.error('Error wiring desktop pin UI:', error);
  }
}

window.addEventListener('DOMContentLoaded', () => {
  try {
    init();
  } catch (error) {
    log.error('Error in DOMContentLoaded handler:', error);
  }
});

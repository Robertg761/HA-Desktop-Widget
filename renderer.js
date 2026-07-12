// Load all required modules (ES Modules)
import log from './src/logger.js';
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
import { setLocaleBootstrap, t, translateDocument } from './src/i18n.js';
import { setIconContent } from './src/icons.js';
import { BASE_RECONNECT_DELAY_MS, MAX_RECONNECT_DELAY_MS } from './src/constants.js';
import { WeatherEffectsManager } from './src/weather-effects.js';
import { normalizeQuickAccessConfig } from './src/quick-access-tabs.js';
import {
  buildHomeAssistantPathUrl,
  classifyConnectionError as classifyConnectionTestError,
  isConfigured,
  isPlaceholderOrEmptyToken,
  normalizeBaseUrl,
} from './src/connection.js';

const CONNECTION_ERROR_TOAST_COOLDOWN_MS = 60000;
const OFFLINE_CONNECTION_ERROR_KEY = 'offline-network';
const FAVORITE_STALE_ENTITY_PRESERVE_MS = 15 * 60 * 1000;
const STATE_CHANGED_HIDDEN_FLUSH_DELAY_MS = 50;
const WINDOW_QUERY = new URLSearchParams(window.location.search);
const WINDOW_MODE = WINDOW_QUERY.get('mode') || '';
const IS_DESKTOP_PIN_MODE = WINDOW_MODE === 'desktop-pin';
const IS_SPECIAL_PIN_MODE = IS_DESKTOP_PIN_MODE;
const DESKTOP_PIN_ENTITY_ID = WINDOW_QUERY.get('entityId') || '';
let desktopPinEditMode = false;
let desktopPinBounds = null;
let desktopPinHasSnapshot = false;
let desktopPinConnectionIssue = '';
const favoriteStalePreservation = new Map();

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
let uiTickTimerId = null;
let uiTickSchedulerStarted = false;
let uiTickNudgeTimerId = null;
let offlineConnectionToastShown = false;
let lastConnectionToast = { key: null, shownAt: 0 };
let browserReportedOffline = false;
let lastDisconnectReason = '';
let mainConnectionState = 'idle';
let firstRunWizard = null;
let firstRunSettingsObserver = null;
let configuredRuntimeStarted = false;
const pendingStateChangedEntities = new Map();
let pendingStateChangedFlushId = null;
const UI_TICK_ACTIVE_INTERVAL_MS = 1000;
const UI_TICK_IDLE_POLL_INTERVAL_MS = 15000;
const UI_TICK_MINUTE_BUFFER_MS = 50;

function clearReconnectTimer() {
  if (!reconnectTimerId) return;
  clearTimeout(reconnectTimerId);
  reconnectTimerId = null;
}

function connectWebSocket() {
  if (IS_DESKTOP_PIN_MODE) return;
  clearReconnectTimer();
  mainConnectionState = 'connecting';
  renderMainWidgetState();
  websocket.connect();
}

function setDisconnectedStatus(detailMessage = '') {
  const normalizedDetail = typeof detailMessage === 'string' ? detailMessage.trim() : '';
  if (normalizedDetail) {
    lastDisconnectReason = normalizedDetail;
  }
  uiUtils.setStatus(false, lastDisconnectReason || t('Disconnected from Home Assistant. Retrying automatically.'));
}

function setConnectedStatus(detailMessage = t('Real-time updates active.')) {
  lastDisconnectReason = '';
  uiUtils.setStatus(true, detailMessage);
}

function setDesktopPinConnectionIssue(detailMessage = '') {
  desktopPinConnectionIssue = typeof detailMessage === 'string'
    ? detailMessage.trim()
    : '';
}

function applyDesktopPinConnectionState(connection = {}) {
  if (connection.secureStoragePending === true) {
    setDesktopPinConnectionIssue(t('Unlocking saved Home Assistant credentials...'));
  } else if (connection.hasUrl !== true) {
    setDesktopPinConnectionIssue(t('Please configure connection settings (gear icon).'));
  } else if (connection.hasToken !== true) {
    setDesktopPinConnectionIssue(t('Please configure your Home Assistant token in Settings (gear icon).'));
  } else {
    setDesktopPinConnectionIssue('');
  }
}

function isSecureStoragePending(targetConfig = state.CONFIG) {
  return targetConfig?.secureStoragePending === true;
}

function flushPendingStateChangedEntities() {
  pendingStateChangedFlushId = null;
  const entities = Array.from(pendingStateChangedEntities.values());
  pendingStateChangedEntities.clear();

  entities.forEach((entity) => {
    window.electronAPI.publishHaEntityUpdate(entity).catch((error) => {
      log.warn('Failed to publish HA entity update to main process:', error);
    });
    if (IS_SPECIAL_PIN_MODE && entity.entity_id === DESKTOP_PIN_ENTITY_ID) {
      renderCurrentMode();
    } else if (ui.isEntityVisible(entity.entity_id)) {
      ui.updateEntityInUI(entity);
    }
    alerts.checkEntityAlerts(entity.entity_id, entity.state);
  });

  nudgeUiTickScheduler();
}

function scheduleStateChangedFlush() {
  if (pendingStateChangedFlushId != null) return;
  const canUseRaf = typeof window.requestAnimationFrame === 'function' && !document.hidden;
  pendingStateChangedFlushId = canUseRaf
    ? window.requestAnimationFrame(flushPendingStateChangedEntities)
    : window.setTimeout(flushPendingStateChangedEntities, STATE_CHANGED_HIDDEN_FLUSH_DELAY_MS);
}

function queueStateChangedEntity(entity) {
  if (!entity?.entity_id) return;
  state.setEntityState(entity);
  pendingStateChangedEntities.set(entity.entity_id, entity);
  scheduleStateChangedFlush();
}

function reconcileFavoriteStalePreservation(newStates) {
  const oldStates = state.STATES || {};
  const favoriteEntityIds = [...new Set(
    Array.isArray(state.CONFIG?.favoriteEntities)
      ? state.CONFIG.favoriteEntities.filter(entityId => typeof entityId === 'string' && entityId)
      : []
  )];
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
      });
      return;
    }

    droppedStaleFavorites.push(entityId);
    favoriteStalePreservation.delete(entityId);
  });

  return {
    favoriteCount: favoriteEntityIds.length,
    preservedFavorites,
    droppedStaleFavorites,
  };
}

function getSettingsUiHooks() {
  return {
    initUpdateUI: ui.initUpdateUI,
    renderActiveTab: ui.renderActiveTab,
    updateMediaTile: ui.updateMediaTile,
    renderPrimaryCards: ui.renderPrimaryCards,
    updateWeatherEffects: ui.updateWeatherEffects,
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

function openQuickAccessModal() {
  ui.populateQuickControlsList();
  const modal = document.getElementById('quick-controls-modal');
  if (!modal) return;
  modal.classList.remove('hidden');
  modal.style.display = 'flex';
  uiUtils.trapFocus(modal);
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

function getActiveQuickAccessCount() {
  const normalized = normalizeQuickAccessConfig(state.CONFIG || {});
  const activeTab = normalized.customTabs.find(tab => tab.id === normalized.activeTabId)
    || normalized.customTabs[0];
  return Array.isArray(activeTab?.entityIds) ? activeTab.entityIds.length : 0;
}

function removeWidgetStatePanel() {
  const existingPanel = document.getElementById('widget-state-panel');
  if (existingPanel) existingPanel.remove();
  document.body.classList.remove('widget-state-active');
}

function renderWidgetStatePanel({ tone, title, message, actions }) {
  const widgetContent = document.querySelector('.widget-content');
  if (!widgetContent) return;
  removeWidgetStatePanel();

  const panel = document.createElement('div');
  panel.id = 'widget-state-panel';
  panel.className = `widget-state-panel ${tone ? `widget-state-${tone}` : ''}`.trim();
  panel.setAttribute('role', tone === 'error' ? 'alert' : 'status');

  panel.appendChild(createTextElement('h3', 'widget-state-title', title));
  panel.appendChild(createTextElement('p', 'widget-state-copy', message));

  if (actions?.length) {
    const actionRow = document.createElement('div');
    actionRow.className = 'widget-state-actions';
    actions.forEach((action) => {
      actionRow.appendChild(createActionButton(action.label, action.className, action.onClick));
    });
    panel.appendChild(actionRow);
  }

  widgetContent.appendChild(panel);
  document.body.classList.add('widget-state-active');
}

function renderMainWidgetState() {
  if (IS_DESKTOP_PIN_MODE || !isConfigured(state.CONFIG) || firstRunWizard?.visible) {
    removeWidgetStatePanel();
    return;
  }

  if (mainConnectionState === 'auth-failed' || mainConnectionState === 'disconnected') {
    renderWidgetStatePanel({
      tone: 'error',
      title: mainConnectionState === 'auth-failed'
        ? t('Authentication failed')
        : t('Home Assistant is disconnected'),
      message: lastDisconnectReason || t('Disconnected from Home Assistant. Retrying automatically.'),
      actions: [
        {
          label: t('Open Settings'),
          className: 'btn btn-primary',
          onClick: openSettingsModal,
        },
        {
          label: t('Retry'),
          className: 'btn btn-secondary',
          onClick: connectWebSocket,
        },
      ],
    });
    return;
  }

  if (mainConnectionState === 'connected' && getActiveQuickAccessCount() === 0) {
    renderWidgetStatePanel({
      tone: 'empty',
      title: t('No Quick Access entities yet'),
      message: t('Add your favorite Home Assistant entities for one-click control.'),
      actions: [
        {
          label: t('Add entities'),
          className: 'btn btn-primary',
          onClick: openQuickAccessModal,
        },
      ],
    });
    return;
  }

  removeWidgetStatePanel();
}

function getConnectionTestMessage(resultOrError) {
  if (resultOrError?.success) {
    return {
      type: 'success',
      text: t('Connection test succeeded. Home Assistant is reachable.'),
    };
  }

  const code = classifyConnectionTestError(resultOrError);
  if (code === 'invalid-url') {
    return {
      type: 'error',
      text: t('Enter a valid Home Assistant URL and token before testing.'),
    };
  }
  if (code === 'auth-failed') {
    return {
      type: 'error',
      text: t('Authentication failed. Check your Long-Lived Access Token.'),
    };
  }
  return {
    type: 'error',
    text: t('Could not reach Home Assistant at that URL.'),
  };
}

function setFirstRunWizardVisible(visible) {
  if (!firstRunWizard?.overlay) return;
  firstRunWizard.visible = !!visible;
  firstRunWizard.overlay.classList.toggle('hidden', !visible);
  document.body.classList.toggle('first-run-active', !!visible);
  renderMainWidgetState();
}

function setWizardStatus(message = '', type = '') {
  if (!firstRunWizard?.status) return;
  firstRunWizard.status.textContent = message;
  firstRunWizard.status.dataset.status = type || '';
  firstRunWizard.status.classList.toggle('hidden', !message);
}

function getWizardUrl() {
  return firstRunWizard?.urlInput?.value || state.CONFIG?.homeAssistant?.url || '';
}

function getWizardToken() {
  return (firstRunWizard?.tokenInput?.value || '').trim();
}

function updateWizardTokenButtonState() {
  if (!firstRunWizard?.openTokenButton) return;
  firstRunWizard.openTokenButton.disabled = !normalizeBaseUrl(getWizardUrl());
}

function renderWizardStep() {
  if (!firstRunWizard?.content) return;
  const stepIndex = firstRunWizard.step;
  const content = firstRunWizard.content;
  content.textContent = '';
  setWizardStatus('', '');

  const stepLabel = createTextElement(
    'div',
    'first-run-step-label',
    t('Step {{current}} of {{total}}', { current: stepIndex + 1, total: 6 })
  );
  content.appendChild(stepLabel);

  if (stepIndex === 0) {
    content.appendChild(createTextElement('h2', 'first-run-title', t('Welcome to Home Assistant Widget')));
    content.appendChild(createTextElement('p', 'first-run-copy', t('Connect your Home Assistant server to start building a compact control panel for your desktop.')));
  } else if (stepIndex === 1) {
    content.appendChild(createTextElement('h2', 'first-run-title', t('Enter your Home Assistant URL')));
    content.appendChild(createTextElement('p', 'first-run-copy', t('Use the address you normally open in your browser.')));
    const label = createTextElement('label', 'first-run-label', t('Home Assistant URL'));
    label.setAttribute('for', 'first-run-ha-url');
    const input = document.createElement('input');
    input.id = 'first-run-ha-url';
    input.type = 'text';
    input.placeholder = t('http://homeassistant.local:8123');
    input.value = firstRunWizard.urlInput?.value || normalizeBaseUrl(state.CONFIG?.homeAssistant?.url) || '';
    input.addEventListener('input', () => {
      firstRunWizard.urlInput = input;
      updateWizardTokenButtonState();
    });
    firstRunWizard.urlInput = input;
    content.appendChild(label);
    content.appendChild(input);
  } else if (stepIndex === 2) {
    content.appendChild(createTextElement('h2', 'first-run-title', t('Create a Long-Lived Access Token')));
    content.appendChild(createTextElement('p', 'first-run-copy', t('In Home Assistant, open your profile security page, create a Long-Lived Access Token, then return here.')));
    const button = createActionButton(t('Open token page'), 'btn btn-secondary', async () => {
      const securityUrl = buildHomeAssistantPathUrl(getWizardUrl(), '/profile/security');
      const profileUrl = buildHomeAssistantPathUrl(getWizardUrl(), '/profile');
      if (!securityUrl || !profileUrl) return;
      const result = await window.electronAPI.openExternal(securityUrl);
      if (!result?.success) {
        await window.electronAPI.openExternal(profileUrl);
      }
    });
    firstRunWizard.openTokenButton = button;
    content.appendChild(button);
    updateWizardTokenButtonState();
  } else if (stepIndex === 3) {
    content.appendChild(createTextElement('h2', 'first-run-title', t('Paste your access token')));
    content.appendChild(createTextElement('p', 'first-run-copy', t('The token is stored by the app and used only to connect to your Home Assistant server.')));
    const label = createTextElement('label', 'first-run-label', t('Long-Lived Access Token'));
    label.setAttribute('for', 'first-run-ha-token');
    const input = document.createElement('input');
    input.id = 'first-run-ha-token';
    input.type = 'password';
    input.placeholder = t('Your long-lived access token');
    input.value = getWizardToken();
    input.addEventListener('input', () => {
      firstRunWizard.tokenInput = input;
    });
    firstRunWizard.tokenInput = input;
    content.appendChild(label);
    content.appendChild(input);
  } else if (stepIndex === 4) {
    content.appendChild(createTextElement('h2', 'first-run-title', t('Test your connection')));
    content.appendChild(createTextElement('p', 'first-run-copy', t('Make sure the URL and token work before finishing setup.')));
    const testRow = document.createElement('div');
    testRow.className = 'first-run-test-row';
    const testButton = createActionButton(t('Test connection'), 'btn btn-primary', () => {
      void runWizardConnectionTest();
    });
    const spinner = document.createElement('span');
    spinner.className = 'connection-test-spinner hidden';
    spinner.setAttribute('aria-hidden', 'true');
    firstRunWizard.testButton = testButton;
    firstRunWizard.testSpinner = spinner;
    testRow.appendChild(testButton);
    testRow.appendChild(spinner);
    content.appendChild(testRow);
  } else {
    content.appendChild(createTextElement('h2', 'first-run-title', t('Ready to connect')));
    content.appendChild(createTextElement('p', 'first-run-copy', t('Finish setup to save these settings and start live updates.')));
  }

  if (firstRunWizard.backButton) {
    firstRunWizard.backButton.disabled = stepIndex === 0;
  }
  if (firstRunWizard.nextButton) {
    firstRunWizard.nextButton.textContent = stepIndex === 5 ? t('Finish') : t('Next');
  }
}

async function runWizardConnectionTest() {
  const normalizedUrl = normalizeBaseUrl(getWizardUrl());
  const token = getWizardToken();
  if (!normalizedUrl || isPlaceholderOrEmptyToken(token)) {
    const message = getConnectionTestMessage({ code: 'invalid-url' });
    setWizardStatus(message.text, message.type);
    firstRunWizard.lastTestSuccessful = false;
    return false;
  }

  if (firstRunWizard.testButton) {
    firstRunWizard.testButton.disabled = true;
    firstRunWizard.testButton.setAttribute('aria-busy', 'true');
  }
  if (firstRunWizard.testSpinner) {
    firstRunWizard.testSpinner.classList.remove('hidden');
  }
  setWizardStatus(t('Testing Home Assistant connection...'), 'pending');
  try {
    const result = await window.electronAPI.testHaConnection(normalizedUrl, token);
    const message = getConnectionTestMessage(result);
    setWizardStatus(message.text, message.type);
    firstRunWizard.lastTestSuccessful = !!result?.success;
    return !!result?.success;
  } catch (error) {
    const message = getConnectionTestMessage(error);
    setWizardStatus(message.text, message.type);
    firstRunWizard.lastTestSuccessful = false;
    return false;
  } finally {
    if (firstRunWizard.testButton) {
      firstRunWizard.testButton.disabled = false;
      firstRunWizard.testButton.setAttribute('aria-busy', 'false');
    }
    if (firstRunWizard.testSpinner) {
      firstRunWizard.testSpinner.classList.add('hidden');
    }
  }
}

async function finishFirstRunWizard() {
  const normalizedUrl = normalizeBaseUrl(getWizardUrl());
  const token = getWizardToken();
  if (!normalizedUrl || isPlaceholderOrEmptyToken(token)) {
    const message = getConnectionTestMessage({ code: 'invalid-url' });
    setWizardStatus(message.text, message.type);
    return;
  }

  if (!firstRunWizard.lastTestSuccessful) {
    const passed = await runWizardConnectionTest();
    if (!passed) return;
  }

  const nextConfig = {
    ...(state.CONFIG || {}),
    homeAssistant: {
      ...(state.CONFIG?.homeAssistant || {}),
      url: normalizedUrl,
      token,
    },
  };
  const updatedConfig = await window.electronAPI.updateConfig(nextConfig);
  applyRendererConfig(updatedConfig || nextConfig);
  setFirstRunWizardVisible(false);
  startUiTickScheduler();
  hotkeys.initializeHotkeys();
  hotkeys.setupHotkeyEventListeners();
  alerts.initializeEntityAlerts();
  notifications.initializePersistentNotifications();
  renderCurrentMode();
  connectWebSocket();
}

function maybeShowWizardAfterSettingsClose() {
  if (!firstRunSettingsObserver) return;
  const modal = document.getElementById('settings-modal');
  if (!modal || !modal.classList.contains('hidden')) return;
  if (!isConfigured(state.CONFIG)) {
    setFirstRunWizardVisible(true);
  }
}

function skipWizardToSettings() {
  setFirstRunWizardVisible(false);
  openSettingsModal();
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
  overlay.setAttribute('aria-labelledby', 'first-run-title');

  const panel = document.createElement('div');
  panel.className = 'first-run-panel';

  const content = document.createElement('div');
  content.className = 'first-run-content';
  content.id = 'first-run-title';

  const status = document.createElement('div');
  status.className = 'first-run-status hidden';
  status.setAttribute('role', 'status');
  status.setAttribute('aria-live', 'polite');

  const actions = document.createElement('div');
  actions.className = 'first-run-actions';

  const skipButton = createActionButton(t('Full Settings'), 'btn btn-secondary', skipWizardToSettings);
  const backButton = createActionButton(t('Back'), 'btn btn-secondary', () => {
    firstRunWizard.step = Math.max(0, firstRunWizard.step - 1);
    renderWizardStep();
  });
  const nextButton = createActionButton(t('Next'), 'btn btn-primary', async () => {
    if (firstRunWizard.step === 5) {
      await finishFirstRunWizard();
      return;
    }
    firstRunWizard.step = Math.min(5, firstRunWizard.step + 1);
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
    lastTestSuccessful: false,
    urlInput: null,
    tokenInput: null,
    testButton: null,
    testSpinner: null,
    openTokenButton: null,
  };
  renderWizardStep();
  return firstRunWizard;
}

function maybeShowFirstRunWizard() {
  if (IS_DESKTOP_PIN_MODE || isConfigured(state.CONFIG) || isSecureStoragePending()) {
    setFirstRunWizardVisible(false);
    return false;
  }
  ensureFirstRunWizard();
  firstRunWizard.step = 0;
  firstRunWizard.lastTestSuccessful = false;
  renderWizardStep();
  setFirstRunWizardVisible(true);
  return true;
}

function startConfiguredRuntime() {
  if (IS_DESKTOP_PIN_MODE || !isConfigured(state.CONFIG)) return false;

  const shouldInitializeRuntime = !configuredRuntimeStarted;
  configuredRuntimeStarted = true;

  startUiTickScheduler();

  if (shouldInitializeRuntime) {
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

function applyRendererConfig(nextConfig) {
  if (!nextConfig || !nextConfig.homeAssistant) return;
  const normalizedQuickAccess = normalizeQuickAccessConfig(nextConfig, { withChanged: true });
  state.setConfig(normalizedQuickAccess.config);
  if (normalizedQuickAccess.changed && !IS_DESKTOP_PIN_MODE) {
    window.electronAPI.updateConfig(normalizedQuickAccess.config).catch((error) => {
      log.error('Failed to persist Quick Access view migration:', error);
    });
  }
  uiUtils.applyTheme(state.CONFIG.ui?.theme || 'auto');
  uiUtils.setCustomThemes(state.CONFIG.ui?.customColors || []);
  uiUtils.applyAccentTheme(state.CONFIG.ui?.accent || 'original');
  uiUtils.applyBackgroundTheme(state.CONFIG.ui?.background || 'original');
  uiUtils.applyUiPreferences(state.CONFIG.ui || {});
  uiUtils.applyWindowEffects(state.CONFIG || {});

  if (ui.updateWeatherEffects) {
    ui.updateWeatherEffects();
  }
}

async function refreshLocaleBootstrap() {
  if (!window?.electronAPI?.getLocaleBootstrap) return null;
  const bootstrap = await window.electronAPI.getLocaleBootstrap();
  setLocaleBootstrap(bootstrap || {});
  translateDocument(document);
  return bootstrap;
}

function renderCurrentMode() {
  if (IS_DESKTOP_PIN_MODE) {
    const entity = state.STATES?.[DESKTOP_PIN_ENTITY_ID] || null;
    document.body.classList.toggle('desktop-pin-edit-mode', desktopPinEditMode);
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
      applyRendererConfig(message.config);
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
      message: t('No network connection detected. Reconnect to Wi-Fi and the widget will retry automatically.'),
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
  mainConnectionState = 'connecting';
  setDisconnectedStatus(t('Network restored. Reconnecting to Home Assistant...'));
  if (shouldForceReconnect || !websocket.ws || websocket.ws.readyState !== WebSocket.OPEN) {
    connectWebSocket();
  }
});

window.addEventListener('offline', () => {
  browserReportedOffline = true;
  clearReconnectTimer();
  mainConnectionState = 'disconnected';
  const disconnectedMessage = t('No network connection detected. Reconnect to Wi-Fi and the widget will retry automatically.');
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
      mainConnectionState = 'connected';
      browserReportedOffline = false;
      setDesktopPinConnectionIssue('');
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
      mainConnectionState = 'auth-failed';
      const authFailureMessage = t('Authentication failed. Please check your Home Assistant token in Settings.');
      setDisconnectedStatus(authFailureMessage);
      setDesktopPinConnectionIssue(authFailureMessage);
      uiUtils.showLoading(false);
      // Show clear error message to user
      uiUtils.showToast(authFailureMessage, 'error', 15000);
      // Render the UI so user can access settings
      renderCurrentMode();
    } else if (msg.type === 'event' && msg.event?.event_type === 'state_changed') {
      const entity = msg.event.data.new_state;
      if (entity) {
        queueStateChangedEntity(entity);
      }
    } else if (msg.type === 'result') {
      log.debug(`Received result for message ID: ${msg.id}`);
      if (msg.result) {
        if (msg.id === getStatesId) { // get_states response
          const newStates = {};
          if (Array.isArray(msg.result)) {
            log.debug(`Successfully fetched ${msg.result.length} entities from Home Assistant`);
            msg.result.forEach(entity => { newStates[entity.entity_id] = entity; });

            const {
              favoriteCount,
              preservedFavorites,
              droppedStaleFavorites,
            } = reconcileFavoriteStalePreservation(newStates);

            const mergedStates = { ...newStates, ...preservedFavorites };
            log.debug(`State update: ${Object.keys(newStates).length} from HA + ${Object.keys(preservedFavorites).length} preserved favorites - ${droppedStaleFavorites.length} stale favorites = ${Object.keys(mergedStates).length} total`);
            emitRendererDebug('ws.get_states.received', {
              fetchedEntities: Object.keys(newStates).length,
              preservedFavorites: Object.keys(preservedFavorites),
              droppedStaleFavorites,
              mergedTotal: Object.keys(mergedStates).length,
              favoriteCount,
            });
            state.setStates(mergedStates);
            if (IS_DESKTOP_PIN_MODE) {
              desktopPinHasSnapshot = true;
            }
            setDesktopPinConnectionIssue('');
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
              if (IS_DESKTOP_PIN_MODE) {
                log.debug('Skipping entity ID reconciliation config write in desktop pin mode; main window will persist it.');
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

    mainConnectionState = 'disconnected';
    setDisconnectedStatus(t('Disconnected from Home Assistant. Retrying automatically.'));
    setDesktopPinConnectionIssue(t('Disconnected from Home Assistant. Retrying automatically.'));
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
    log.error('WebSocket error:', error);
    mainConnectionState = 'disconnected';
    const classifiedIssue = classifyConnectionError(error);
    let desktopPinIssueMessage = classifiedIssue.message;
    setDisconnectedStatus(classifiedIssue.message);
    uiUtils.showLoading(false); // Hide loading on failure

    // Show user-friendly error message
    const errorMessage = String(error?.message || '');
    if (errorMessage.includes('default token')) {
      desktopPinIssueMessage = t('Please configure your Home Assistant token in Settings (gear icon).');
      setDisconnectedStatus(desktopPinIssueMessage);
      uiUtils.showToast(desktopPinIssueMessage, 'error', 20000);
    } else if (errorMessage.includes('Invalid configuration')) {
      desktopPinIssueMessage = t('Please configure connection settings (gear icon).');
      setDisconnectedStatus(desktopPinIssueMessage);
      uiUtils.showToast(desktopPinIssueMessage, 'error', 20000);
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
  mainConnectionState = 'connecting';
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

window.electronAPI.onConfigUpdated(async (nextConfig) => {
  try {
    if (!nextConfig || !nextConfig.homeAssistant) return;
    await refreshLocaleBootstrap();
    const wasConfigured = isConfigured(state.CONFIG);
    const wasSecureStoragePending = isSecureStoragePending();
    applyRendererConfig(nextConfig);
    renderCurrentMode();
    const wizardShown = maybeShowFirstRunWizard();
    if (!wizardShown && isConfigured(state.CONFIG) && (!wasConfigured || wasSecureStoragePending || !configuredRuntimeStarted)) {
      startConfiguredRuntime();
    }
  } catch (error) {
    log.error('Failed to apply config-updated event:', error);
  }
});

window.electronAPI.onDesktopPinActionRequested((payload) => {
  if (IS_DESKTOP_PIN_MODE) return;
  ui.handleDesktopPinActionRequest(payload);
});

window.electronAPI.onEntityTileHotkeyRequested(({ entityId } = {}) => {
  if (IS_DESKTOP_PIN_MODE || !entityId) return;
  hotkeys.assignHotkeyToEntity(entityId);
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

    const persistentNotificationsIcon = document.getElementById('persistent-notifications-icon');
    if (persistentNotificationsIcon) setIconContent(persistentNotificationsIcon, 'notifications', { size: 16 });

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
    await refreshLocaleBootstrap();
    const bootstrap = await window.electronAPI.getDesktopPinBootstrap(DESKTOP_PIN_ENTITY_ID);
    const nextConfig = bootstrap?.config || { homeAssistant: {}, ui: {} };
    desktopPinEditMode = !!bootstrap?.editMode;
    desktopPinBounds = bootstrap?.pinBounds || null;
    desktopPinHasSnapshot = !!bootstrap?.hasSnapshot;

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
  } catch (error) {
    log.error('Desktop pin initialization error:', error);
    uiUtils.showLoading(false);
    wireDesktopPinUI();
    setDesktopPinConnectionIssue(t('Unable to initialize the desktop tile. Focus the main widget to review your settings.'));
    renderCurrentMode();
  }
}

async function init() {
  try {
    log.info('Initializing application');
    document.body.classList.toggle('desktop-pin-mode', IS_DESKTOP_PIN_MODE);

    // Initialize weather background effects
    try {
      window.weatherEffects = new WeatherEffectsManager('weather-effects-canvas');
    } catch (e) {
      log.error('Failed to initialize weather background effects:', e);
    }

    await refreshLocaleBootstrap();
    uiUtils.showLoading(true);
    if (IS_DESKTOP_PIN_MODE) {
      await initializeDesktopPinMode();
      return;
    }

    uiUtils.initializeConnectionStatusTooltip();
    setDisconnectedStatus(t('Disconnected from Home Assistant. Retrying automatically.'));

    const config = await window.electronAPI.getConfig();
    if (!config || !config.homeAssistant) {
      log.error('Configuration is missing or invalid');
      setDisconnectedStatus(t('Please configure connection settings (gear icon).'));
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

    applyRendererConfig(config);
    wireUI();
    replaceEmojiIcons();

    // Check if token was reset due to encryption issues
    if (state.CONFIG.tokenResetReason) {
      const reason = state.CONFIG.tokenResetReason;
      if (window.electronAPI.clearTokenResetReason) {
        await window.electronAPI.clearTokenResetReason();
      }
      delete state.CONFIG.tokenResetReason;

      let message = t('Your Home Assistant token needs to be re-entered. ');
      let detailMessage = '';
      if (reason === 'encryption_unavailable') {
        message += t('Token encryption is not available on this system.');
        detailMessage = t('Your encrypted token from a previous installation cannot be decrypted on this system. The encrypted token has been preserved in case you move back to a system with encryption support. Please re-enter your token in Settings to continue.');
      } else if (reason === 'decryption_failed') {
        message += t('The stored token could not be decrypted.');
        detailMessage = t('The encrypted token appears to be corrupted and cannot be decrypted. The encrypted token has been preserved for recovery attempts. Please re-enter your token in Settings to continue.');
      }

      log.warn('[Init] Token reset:', message);
      log.info('[Init]', detailMessage);

      // Show prominent warning message with extended duration
      uiUtils.showToast(message + t(' Click the gear icon to open Settings.'), 'warning', 20000);
    }

    if (!isConfigured(state.CONFIG)) {
      if (isSecureStoragePending()) {
        log.info('[Init] Secure config is pending; showing shell while saved credentials unlock.');
        setDisconnectedStatus(t('Unlocking saved Home Assistant credentials...'));
        uiUtils.showLoading(false);
        renderCurrentMode();
        maybeShowFirstRunWizard();
        return;
      }

      log.warn('[Init] Home Assistant is not configured. Showing first-run onboarding.');
      setDisconnectedStatus(t('Please configure connection settings (gear icon).'));
      uiUtils.showLoading(false);
      renderCurrentMode();
      maybeShowFirstRunWizard();
      return;
    }

    startConfiguredRuntime();

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
    commandPalette.initializeCommandPalette();

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
            uiUtils.showToast(t('Failed to open log file: {{error}}', { error: result.error }), 'error');
          }
        } catch (error) {
          log.error('Error opening log file:', error);
          uiUtils.showToast(t('Error opening log file: {{error}}', { error: error.message }), 'error');
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
        if (settings.syncWeatherEffectsAvailability) {
          settings.syncWeatherEffectsAvailability({ showWarning: true });
        }
        if (settings.previewWindowEffects) {
          settings.previewWindowEffects();
        }
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
          weatherOverrideGroup.style.display = canEnableWeatherEffects && weatherEffectsToggle.checked ? 'block' : 'none';
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
      manageQuickControlsBtn.onclick = openQuickAccessModal;
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

          uiUtils.showToast(t('Weather entity cleared (using first available)'), 'success', 2000);
        } catch (error) {
          console.error('Error clearing weather entity:', error);
          uiUtils.showToast(t('Failed to clear weather entity'), 'error', 3000);
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
        document.querySelectorAll('.modal-tabs .tab-link').forEach(btn => {
          btn.classList.remove('active');
          btn.setAttribute('aria-selected', 'false');
        });
        button.classList.add('active');
        button.setAttribute('aria-selected', 'true');
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
    const focusBtn = document.getElementById('desktop-pin-focus-btn');
    if (focusBtn) {
      focusBtn.onclick = () => {
        if (focusBtn.disabled) return;
        window.electronAPI.requestDesktopPinAction(DESKTOP_PIN_ENTITY_ID, 'focus-main').catch((error) => {
          log.error('Failed to focus main widget from desktop pin:', error);
        });
      };
    }

    document.querySelectorAll('.desktop-pin-resize-handle').forEach((resizeHandle) => {
      if (resizeHandle.dataset.bound) return;
      resizeHandle.dataset.bound = 'true';
      resizeHandle.addEventListener('pointerdown', (event) => {
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

        let pendingBounds = null;
        let resizeInFlight = false;
        let frameScheduled = false;
        const pointerId = event.pointerId;

        try {
          resizeHandle.setPointerCapture(pointerId);
        } catch {
          // Ignore pointer capture failures and continue with window listeners.
        }

        const flushResize = async () => {
          frameScheduled = false;
          if (resizeInFlight || !pendingBounds) return;
          resizeInFlight = true;
          const nextBounds = pendingBounds;
          pendingBounds = null;

          try {
            const result = await window.electronAPI.updateDesktopPinBounds(DESKTOP_PIN_ENTITY_ID, nextBounds);
            if (result?.success && result.pinBounds) {
              desktopPinBounds = result.pinBounds;
            }
          } catch (error) {
            log.error('Failed to resize desktop tile:', error);
          } finally {
            resizeInFlight = false;
            if (pendingBounds) {
              requestAnimationFrame(flushResize);
              frameScheduled = true;
            }
          }
        };

        const scheduleResize = (nextBounds) => {
          pendingBounds = nextBounds;
          if (!frameScheduled) {
            requestAnimationFrame(flushResize);
            frameScheduled = true;
          }
        };

        const handlePointerMove = (moveEvent) => {
          const deltaX = moveEvent.screenX - startX;
          const deltaY = moveEvent.screenY - startY;
          const nextBounds = {
            x: startBounds.x,
            y: startBounds.y,
            width: startBounds.width,
            height: startBounds.height,
          };

          switch (corner) {
            case 'top-left':
              nextBounds.x = Math.round(startBounds.x + deltaX);
              nextBounds.y = Math.round(startBounds.y + deltaY);
              nextBounds.width = Math.round(startBounds.width - deltaX);
              nextBounds.height = Math.round(startBounds.height - deltaY);
              break;
            case 'top-right':
              nextBounds.y = Math.round(startBounds.y + deltaY);
              nextBounds.width = Math.round(startBounds.width + deltaX);
              nextBounds.height = Math.round(startBounds.height - deltaY);
              break;
            case 'bottom-left':
              nextBounds.x = Math.round(startBounds.x + deltaX);
              nextBounds.width = Math.round(startBounds.width - deltaX);
              nextBounds.height = Math.round(startBounds.height + deltaY);
              break;
            case 'bottom-right':
            default:
              nextBounds.width = Math.round(startBounds.width + deltaX);
              nextBounds.height = Math.round(startBounds.height + deltaY);
              break;
          }

          scheduleResize(nextBounds);
        };

        const finishResize = () => {
          window.removeEventListener('pointermove', handlePointerMove, true);
          window.removeEventListener('pointerup', finishResize, true);
          window.removeEventListener('pointercancel', finishResize, true);
          try {
            resizeHandle.releasePointerCapture(pointerId);
          } catch {
            // no-op
          }
        };

        window.addEventListener('pointermove', handlePointerMove, true);
        window.addEventListener('pointerup', finishResize, true);
        window.addEventListener('pointercancel', finishResize, true);
      }, true);
    });
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

import state from './state.js';
import { getHelperActions, getHelperServiceData } from './helper-controls.js';
import {
  isEntityAvailable,
  canPerformMediaAction,
  getTodoCapabilities,
  getClimateTileTemperature,
} from './entity-control-policy.js';
import { mountSensorHistoryDetail, summarizeHistory } from './sensor-history-detail.js';
import { rememberDashboard, dashboardSnapshot } from './dashboard-history.js';
import {
  entitiesForArea,
  loadRoomRegistry,
  selectableEntityIds,
  waitForRoomConnection,
} from './room-dashboard.js';
import * as utils from './utils.js';
import websocket from './websocket.js';
import * as camera from './camera.js';
import * as uiUtils from './ui-utils.js';
import {
  formatDate,
  formatNumber,
  getLocaleState,
  isolateLtr,
  t,
  translateDocument,
} from './i18n.js';
import {
  compareNames,
  formatClockDateTime,
  formatClockTime,
  formatDayAndTime,
  formatDayLabel,
  formatMeasurement,
  formatNumberEntityValue,
  formatPercent,
  formatReadingNumber,
  formatStateName,
  formatTemperature,
  getClockDateOptions,
  getClockFaceTimeOptions,
  getSensorReading,
  joinUnit,
  normalizeSearchText,
  parseNumericState,
  titleCase,
} from './format.js';
import { applyCloseButtonIcons, setIconContent } from './icons.js';
import {
  getWeatherConditionLabel,
  normalizeWeatherCondition,
  renderWeatherIcon,
} from './weather-icons.js';
import {
  createLineIcon,
  entityIconMarkup,
  getEntityIconDescriptor,
  lineIconMarkup,
  renderEntityIcon,
  setLineIconContent,
} from './entity-icons.js';
import { animateEnter, prefersReducedMotion, pulse, syncSlidingIndicator } from './motion.js';
import { normalizePrimaryCards, PRIMARY_CARD_NONE } from './primary-cards.js';
import { buildSparklinePoints } from './sparklines.js';
import {
  SENSOR_TILE_CHART_OPTIONS,
  buildGaugeArc,
  clampGaugeFraction,
  formatGaugeBoundLabel,
  normalizeGaugeBound,
  normalizeSensorTileChartType,
  resolveGaugeRange,
} from './sensor-gauge.js';
import trayEntitySupport from './tray-entities.cjs';
import desktopPinSupport from './desktop-pin-support.cjs';
import climateControls from './climate-controls.cjs';
import { DEV_CLIMATE_DEMO_ENTITY_ID, isClimateDemoOverlayConfig } from '@dev-climate-demo';
import {
  addEntityToQuickAccessView,
  addQuickAccessView,
  deleteQuickAccessView,
  getActiveQuickAccessTab,
  normalizeQuickAccessConfig,
  removeEntityFromQuickAccessView,
  renameQuickAccessView,
  reorderQuickAccessView,
  setActiveQuickAccessView,
} from './quick-access-tabs.js';
import {
  getFittedSensorValueFontSize,
  getNextQuickAccessFocusIndex,
  getNextQuickAccessFocusIndexByLayout,
  getQuickAccessTabOverflow,
  getQuickAccessTabRevealDelta,
  getQuickAccessTabWheelDelta,
} from './quick-access-ui-helpers.js';
import {
  bindTabListKeyboard,
  getNextTabIndex,
  getTextDirection,
  syncRovingTabIndex,
} from './tab-navigation.js';
import { duplicateQuickAccessView } from './page-duplication.js';
import { getRendererHost } from '@hadw/renderer/host.js';
import {
  COMPARISON_GRAPH_SPAN_OPTIONS,
  MAX_COMPARISON_GRAPH_SERIES,
  addComparisonGraph,
  normalizeComparisonGraphSpan,
  buildTimeSeriesPoints,
  computeTimeDomain,
  computeValueDomainsByUnit,
  findSampleAtOrBefore,
  splitSeriesAtWindow,
  toFiniteNumber,
  getComparisonGraph,
  getComparisonGraphEntityIds,
  getGraphSeriesAttribute,
  getSeriesColorSlot,
  groupSeriesByUnit,
  isComparisonGraphId,
  isGraphableEntity,
  normalizeComparisonGraphsConfig,
  readGraphSeriesUnit,
  readGraphSeriesValue,
  removeComparisonGraph,
  updateComparisonGraph,
} from './comparison-graphs.js';
import Sortable from 'sortablejs';

const { getDefaultTemperatureStep } = climateControls;

// The capabilities of a climate entity, with the default step for the unit Home Assistant uses.
function getClimateControlCapabilities(entity) {
  return climateControls.getClimateControlCapabilities(entity, {
    unit: state.UNIT_SYSTEM?.temperature,
  });
}

const climateDialogRefreshers = new Map();
let isReorganizeMode = false;
// Set when a drag in the current reorganize session actually changed a page's order.
let quickAccessOrderChanged = false;
// Track all active long-press timers to cancel them when mode changes
const activePressTimers = new Set();
const ON_OFF_TOGGLE_DOMAINS = new Set(['light', 'switch', 'fan', 'input_boolean']);
const desiredStateByEntity = new Map();
const inFlightByEntity = new Map();
const lastRequestedStateByEntity = new Map();
const optimisticStateByEntity = new Map();
const onOffToggleConfirmationTimers = new Map();
const lastKnownLightBrightnessByEntity = new Map();
const failedMediaArtworkRetryAtByUrl = new Map();
const desktopPinLightBrightnessTimers = new Map();
const desktopPinLightInteractionState = new Map();
const desktopPinControlTimers = new Map();
const desktopPinControlInteractionState = new Map();
const desktopPinSceneMinSyncState = new Map();
const MEDIA_ARTWORK_RETRY_DELAY_MS = 30000;
const ON_OFF_TOGGLE_CONFIRMATION_TIMEOUT_MS = 8000;
const MEDIA_PLAYER_SUPPORT_SEEK = 2;
const MEDIA_PLAYER_SUPPORT_VOLUME_SET = 4;
const MEDIA_PLAYER_SUPPORT_VOLUME_MUTE = 8;
const LIGHT_COLOR_MODES = new Set(['rgb', 'rgbw', 'rgbww', 'hs', 'xy']);
const LIGHT_COLOR_PRESETS = ['#FFB347', '#FFD966', '#FFFFFF', '#9FD8FF', '#7C83FF', '#FF6B9D'];
const DESKTOP_PIN_SCENE_BASE_MIN_BOUNDS = { width: 97, height: 83 };
const DESKTOP_PIN_SCENE_DEFAULT_BOUNDS = { width: 168, height: 148 };
const QUICK_ACCESS_TILE_VALUE_SIZE_OPTIONS = new Set([
  'auto',
  'small',
  'normal',
  'large',
  'extra-large',
]);
const QUICK_ACCESS_TILE_VALUE_SIZE_LABELS = [
  { value: 'auto', label: 'Auto (Default)' },
  { value: 'small', label: 'Small' },
  { value: 'normal', label: 'Normal' },
  { value: 'large', label: 'Large' },
  { value: 'extra-large', label: 'Extra Large' },
];
const TODO_ITEMS_CACHE_TTL_MS = 2 * 60 * 1000;
const TODO_ITEMS_REFRESH_THROTTLE_MS = 30 * 1000;
const SENSOR_HISTORY_WINDOW_MS = 24 * 60 * 60 * 1000;
const SENSOR_HISTORY_REFRESH_THROTTLE_MS = 5 * 60 * 1000;
const SENSOR_SPARKLINE_SVG_NS = 'http://www.w3.org/2000/svg';
const SENSOR_TILE_SPARKLINE_WIDTH = 96;
const SENSOR_TILE_SPARKLINE_HEIGHT = 24;
// A near-square box so the arc, not the tile width, sets the dial size and the reading fits inside it.
const SENSOR_TILE_GAUGE_WIDTH = 80;
const SENSOR_TILE_GAUGE_HEIGHT = 32;
const SENSOR_TILE_GAUGE_STROKE_WIDTH = 6;
const SENSOR_DETAIL_SPARKLINE_WIDTH = 420;
const SENSOR_DETAIL_SPARKLINE_HEIGHT = 120;
const COMPARISON_GRAPH_WIDTH = 260;
const COMPARISON_GRAPH_HEIGHT = 90;
// The plot is inset so 2px strokes and the end-dot rings aren't clipped by the viewBox edge.
const COMPARISON_GRAPH_INSET = 4;
const COMPARISON_GRAPH_REDRAW_DEBOUNCE_MS = 250;
const DESKTOP_PIN_CLIMATE_MODE_PRIORITY = [
  'off',
  'heat',
  'cool',
  'auto',
  'heat_cool',
  'fan_only',
  'dry',
  'eco',
];
const DESKTOP_PIN_CLIMATE_MODE_LABELS = {
  off: 'Off',
  heat: 'Heat',
  cool: 'Cool',
  auto: 'Auto',
  heat_cool: 'Auto',
  fan_only: 'Fan',
  dry: 'Dry',
  eco: 'Eco',
};
// Labels for Home Assistant's standard HVAC, fan and preset modes in the climate dialog, translated
// where they are shown. Modes outside this list are integration-specific and shown as reported.
const CLIMATE_OPTION_LABELS = {
  off: 'Off',
  on: 'On',
  heat: 'Heat',
  cool: 'Cool',
  heat_cool: 'Heat Cool',
  auto: 'Auto',
  dry: 'Dry',
  fan_only: 'Fan Only',
  low: 'Low',
  medium: 'Medium',
  middle: 'Middle',
  high: 'High',
  focus: 'Focus',
  diffuse: 'Diffuse',
  none: 'None',
  eco: 'Eco',
  away: 'Away',
  boost: 'Boost',
  comfort: 'Comfort',
  home: 'Home',
  sleep: 'Sleep',
  activity: 'Activity',
};
const DESKTOP_PIN_LIGHT_PRESETS = [25, 50, 75, 100];
const DESKTOP_PIN_FAN_PRESETS_FULL = [
  { value: 0, label: 'Off' },
  { value: 33, label: 'Low' },
  { value: 66, label: 'Mid' },
  { value: 100, label: 'High' },
];
const DESKTOP_PIN_FAN_PRESETS_TIGHT = [
  { value: 0, label: 'Off' },
  { value: 66, label: 'Mid' },
  { value: 100, label: 'High' },
];
const { getDesktopPinCapabilities, getDesktopPinVacuumServices, resolveDesktopPinProfile } =
  desktopPinSupport;
const PRESS_ACTION_DOMAINS = new Set(['button', 'input_button']);
const sensorHistoryCache = new Map();
let unsubscribeAutoUpdate = null;

function pruneExpiredArtworkRetryEntries(now = Date.now()) {
  failedMediaArtworkRetryAtByUrl.forEach((retryAt, key) => {
    if (!retryAt || retryAt <= now) {
      failedMediaArtworkRetryAtByUrl.delete(key);
    }
  });
}

function isInteractionDebugEnabled() {
  return !!state.CONFIG?.ui?.enableInteractionDebugLogs;
}

function emitUiDebug(event, details = {}) {
  if (!isInteractionDebugEnabled()) return;

  try {
    const payload = {
      scope: 'ui',
      event,
      details: {
        timestamp: new Date().toISOString(),
        ...details,
      },
    };

    console.info('[UI DEBUG]', event, payload.details);
    Promise.resolve(getRendererHost().debugLog(payload)).catch(() => {
      /* no-op */
    });
  } catch {
    // no-op: debug logging must never break UI execution
  }
}

function isOnOffToggleDomain(domain) {
  return ON_OFF_TOGGLE_DOMAINS.has(domain);
}

function isPressActionDomain(domain) {
  return PRESS_ACTION_DOMAINS.has(domain);
}

function getEntityDomain(entityId) {
  if (typeof entityId !== 'string' || !entityId.includes('.')) return '';
  return entityId.split('.')[0];
}

function isOnOffStateValue(value) {
  return value === 'on' || value === 'off';
}

function getEffectiveOnOffState(entityId, fallbackState = 'off') {
  const optimisticState = optimisticStateByEntity.get(entityId);
  if (isOnOffStateValue(optimisticState)) return optimisticState;

  const liveState = state.STATES?.[entityId]?.state;
  if (isOnOffStateValue(liveState)) return liveState;

  return isOnOffStateValue(fallbackState) ? fallbackState : 'off';
}

function clearOnOffToggleConfirmationTimer(entityId) {
  const timer = onOffToggleConfirmationTimers.get(entityId);
  if (timer != null) {
    clearTimeout(timer);
    onOffToggleConfirmationTimers.delete(entityId);
  }
}

function clearPendingOnOffToggle(entityId) {
  clearOnOffToggleConfirmationTimer(entityId);
  desiredStateByEntity.delete(entityId);
  optimisticStateByEntity.delete(entityId);
  lastRequestedStateByEntity.delete(entityId);
}

function rememberLightBrightness(entity) {
  if (getEntityDomain(entity?.entity_id) !== 'light') return;
  const brightness = Number(entity?.attributes?.brightness);
  if (Number.isFinite(brightness) && brightness > 0) {
    lastKnownLightBrightnessByEntity.set(entity.entity_id, brightness);
  }
}

function getEntityForDisplay(entity) {
  if (!entity || typeof entity !== 'object' || !entity.entity_id) return entity;
  const domain = getEntityDomain(entity.entity_id);
  if (domain === 'light') rememberLightBrightness(entity);
  if (!isOnOffToggleDomain(domain)) return entity;

  const optimisticState = optimisticStateByEntity.get(entity.entity_id);
  if (!isOnOffStateValue(optimisticState)) return entity;

  const cachedBrightness = lastKnownLightBrightnessByEntity.get(entity.entity_id);
  const needsCachedBrightness =
    domain === 'light' &&
    optimisticState === 'on' &&
    Number.isFinite(cachedBrightness) &&
    !(Number(entity.attributes?.brightness) > 0);

  if (entity.state === optimisticState && !needsCachedBrightness) return entity;
  return {
    ...entity,
    state: optimisticState,
    ...(needsCachedBrightness
      ? { attributes: { ...(entity.attributes || {}), brightness: cachedBrightness } }
      : {}),
  };
}

function scheduleOnOffToggleConfirmationTimeout(entityId, domain, desiredState) {
  clearOnOffToggleConfirmationTimer(entityId);
  const timer = setTimeout(() => {
    if (onOffToggleConfirmationTimers.get(entityId) !== timer) return;
    onOffToggleConfirmationTimers.delete(entityId);
    if (desiredStateByEntity.get(entityId) !== desiredState) return;

    desiredStateByEntity.delete(entityId);
    optimisticStateByEntity.delete(entityId);
    lastRequestedStateByEntity.delete(entityId);

    const serverEntity = state.STATES?.[entityId];
    if (serverEntity) {
      updateEntityInUI(serverEntity, { skipQueueReconcile: true });
    }
    emitUiDebug('entity.toggle_confirmation_timeout', {
      entityId,
      domain,
      desiredState,
      receivedState: serverEntity?.state || null,
    });
  }, ON_OFF_TOGGLE_CONFIRMATION_TIMEOUT_MS);
  timer?.unref?.();
  onOffToggleConfirmationTimers.set(entityId, timer);
}

// Socket-level failures reach here as transport jargon ("WebSocket not connected"); say what they
// mean for the user instead. Home Assistant's own service errors are already readable.
const CONNECTION_SERVICE_ERRORS = new Set([
  'WebSocket not connected',
  'WebSocket not authenticated',
  'WebSocket connection closed',
  'WebSocket connection replaced',
  'Home Assistant connection lost',
]);

// A failure of the connection itself, as opposed to Home Assistant refusing the call.
function isConnectionServiceError(error) {
  return (
    CONNECTION_SERVICE_ERRORS.has(error?.message) || error?.message === 'WebSocket request timeout'
  );
}

function describeServiceErrorMessage(error) {
  const message = error?.message || '';
  if (message === 'WebSocket request timeout') return t('Home Assistant did not respond');
  if (CONNECTION_SERVICE_ERRORS.has(message)) return t('Not connected to Home Assistant');
  return message || t('Unknown error');
}

/**
 * Handle WebSocket service call errors with user feedback
 * @param {Error} error - The error that occurred
 * @param {string} entityName - Optional entity name for better error messages
 */
function handleServiceError(error, entityName = null) {
  const errorMessage = describeServiceErrorMessage(error);
  const displayMessage = entityName
    ? t('Failed to control {{entityName}}: {{errorMessage}}', { entityName, errorMessage })
    : t('Service call failed: {{errorMessage}}', { errorMessage });

  // A control used during an outage is an expected outcome, not a fault in the widget.
  console[isConnectionServiceError(error) ? 'warn' : 'error'](
    'WebSocket service call failed:',
    error
  );
  emitUiDebug('service.error', {
    entityName: entityName || null,
    message: error?.message || 'Unknown error',
    code: error?.code || null,
    details: error?.details || null,
  });
  uiUtils.showToast(displayMessage, 'error', 4000);
}

function callServiceWithUiRollback(entity, domain, service, serviceData, rollback = null) {
  return websocket
    .callService(domain, service, serviceData)
    .then((result) => ({ ok: true, result }))
    .catch((error) => {
      if (typeof rollback === 'function') {
        try {
          rollback();
        } catch (rollbackError) {
          console.error('Failed to roll back optimistic control state:', rollbackError);
        }
      }
      handleServiceError(error, utils.getEntityDisplayName(entity));
      return { ok: false, error };
    });
}

function serializeDesktopPinActionError(error, fallbackMessage = t('Desktop pin action failed')) {
  const message =
    typeof error?.message === 'string' && error.message.trim() ? error.message : fallbackMessage;
  const serialized = { message };

  if (error?.code) serialized.code = error.code;
  if (error?.details) serialized.details = error.details;

  return serialized;
}

function normalizeDesktopPinActionResult(result) {
  if (result && typeof result === 'object' && !Array.isArray(result)) {
    return { success: result.success !== false, ...result };
  }
  return { success: true, result };
}

function respondToDesktopPinActionRequest(requestId, response) {
  if (!requestId || !window?.electronAPI?.respondDesktopPinActionRequest) return;
  window.electronAPI.respondDesktopPinActionRequest(requestId, response).catch((error) => {
    console.error('Error sending desktop pin action response:', error);
  });
}

/**
 * Clear all active long-press timers
 * Called when reorganize mode changes to prevent inconsistent state
 */
function clearAllPressTimers() {
  activePressTimers.forEach((timer) => clearTimeout(timer));
  activePressTimers.clear();
}

function isPrimaryControlElement(el) {
  return Boolean(el && el.dataset && el.dataset.primaryCard === 'true');
}

function shouldBlockInteraction(el) {
  return isReorganizeMode && !isPrimaryControlElement(el);
}

let sortableInstance = null; // SortableJS instance for reorganize mode
let quickAccessViewIdCounter = 0;
let quickAccessRovingIndex = 0;
let dialogModalIdCounter = 0;
let quickAccessPersistenceRevision = 0;
let quickAccessPendingWriteCount = 0;
let quickAccessAuthoritativeFallback = null;
let quickAccessAuthoritativeFallbackRevision = 0;

const visibleEntityIds = new Set();
let isTimeCardVisible = false;
let hasVisibleTimerEntities = false;
let isMediaTileVisible = false;
let lastMediaTileRenderSignature = '';
let lastMediaTileArtworkSrc = '';

let weatherCardTemplate = null;
let timeCardTemplate = null;
const todoItemsCacheByEntity = new Map();
const todoItemsPendingByEntity = new Map();
let entityCacheIdentity = null;
let entityCacheGeneration = 0;
const entityDetailClosers = new Set();
// One entity can render as a primary card, a Quick Access tile and a pin at once, so readout IDs
// belong to the tile element rather than the entity.
const tileStateReadoutIds = new WeakMap();
let tileStateReadoutCount = 0;
// Lets a dialog that closes itself programmatically unregister from entityDetailClosers too.
const entityDetailModalClosers = new WeakMap();

function ensureEntityCacheScope({ force = false } = {}) {
  const connection = state.CONFIG?.homeAssistant || {};
  const account =
    connection.authMethod === 'oauth'
      ? connection.oauthAuthorizationId || connection.token
      : connection.token;
  const identity = JSON.stringify([connection.url, connection.authMethod, account]);
  if (!force && identity === entityCacheIdentity) return entityCacheGeneration;
  entityCacheIdentity = identity;
  entityCacheGeneration += 1;
  sensorHistoryCache.clear();
  todoItemsCacheByEntity.clear();
  todoItemsPendingByEntity.clear();
  lastKnownLightBrightnessByEntity.clear();
  desiredStateByEntity.clear();
  optimisticStateByEntity.clear();
  inFlightByEntity.clear();
  lastRequestedStateByEntity.clear();
  onOffToggleConfirmationTimers.forEach(clearTimeout);
  onOffToggleConfirmationTimers.clear();
  desktopPinControlTimers.forEach(clearTimeout);
  desktopPinControlTimers.clear();
  desktopPinLightBrightnessTimers.forEach(clearTimeout);
  desktopPinLightBrightnessTimers.clear();
  [...desktopPinControlInteractionState.keys()].forEach(clearDesktopPinControlInteraction);
  [...desktopPinLightInteractionState.keys()].forEach(clearDesktopPinLightInteraction);
  [...entityDetailClosers].forEach((close) => close());
  return entityCacheGeneration;
}
const WEATHER_UNAVAILABLE_STATES = new Set(['unknown', 'unavailable']);

function generateQuickAccessViewId() {
  quickAccessViewIdCounter += 1;
  const randomPart = Math.random().toString(36).slice(2, 8);
  return `view-${Date.now().toString(36)}-${quickAccessViewIdCounter}-${randomPart}`;
}

function cloneConfigSnapshot(config = state.CONFIG) {
  return JSON.parse(JSON.stringify(config || {}));
}

function requireAuthoritativeConfig(response) {
  if (!response || response.success === false || !response.homeAssistant) {
    const error = new Error(response?.error || t('The main process rejected the settings update'));
    if (response && typeof response === 'object') {
      error.result = response;
    }
    throw error;
  }
  return response;
}

async function persistAuthoritativeConfig(nextConfig) {
  const host = getRendererHost();
  if (!host.canPersistConfig) {
    throw new Error(t('Configuration updates are unavailable on this build.'));
  }
  try {
    const previousConfig = cloneConfigSnapshot(state.CONFIG);
    const authoritativeConfig = requireAuthoritativeConfig(await host.updateConfig(nextConfig));
    rememberDashboard(previousConfig, authoritativeConfig);
    state.setConfig(authoritativeConfig);
    return state.CONFIG;
  } catch (error) {
    const recoveredConfig = error?.result?.config;
    if (recoveredConfig?.homeAssistant) {
      state.setConfig(recoveredConfig);
    }
    throw error;
  }
}

async function persistAuthoritativeEntityIdReplacement(oldEntityId, newEntityId) {
  const host = getRendererHost();
  if (!host.canPersistConfig || typeof host.replaceConfigEntityId !== 'function') {
    throw new Error(t('Configuration updates are unavailable on this build.'));
  }
  try {
    const result = await host.replaceConfigEntityId(oldEntityId, newEntityId);
    const authoritativeConfig = requireAuthoritativeConfig(result?.config);
    state.setConfig(authoritativeConfig);
    return { changed: result?.changed === true, config: state.CONFIG };
  } catch (error) {
    const recoveredConfig = error?.result?.config;
    if (recoveredConfig?.homeAssistant) {
      state.setConfig(recoveredConfig);
    }
    throw error;
  }
}

function showConfigPersistenceError(error) {
  const message = t('Error: {{error}}', {
    error: error?.message || t('Unknown error'),
  });
  uiUtils.showToast(message, 'error', 4000);
}

function isQuickAccessManageModalOpen() {
  const modal = document.getElementById('quick-controls-modal');
  return !!modal && !modal.classList.contains('hidden') && modal.style.display !== 'none';
}

function renderQuickAccessConfigState() {
  renderQuickControls();
  // The manage list holds a row for every entity in the install, so rebuilding it on each page
  // switch is the most expensive part of the render. It is rebuilt again when the dialog opens.
  if (isQuickAccessManageModalOpen()) populateQuickControlsList({ resetSearch: false });
}

function buildQuickAccessConfigPatch(config) {
  return {
    customTabs: cloneConfigSnapshot(config?.customTabs || []),
    activeTabId: config?.activeTabId,
    favoriteEntities: [...(config?.favoriteEntities || [])],
    comparisonGraphs: cloneConfigSnapshot(config?.comparisonGraphs || []),
  };
}

async function persistQuickAccessConfigSnapshot(
  nextConfig,
  previousConfig,
  { rollbackOnFailure = true } = {}
) {
  const revision = ++quickAccessPersistenceRevision;
  const host = getRendererHost();
  if (!host.canPersistConfig) {
    return { success: true, config: nextConfig, revision, isCurrent: true };
  }

  if (quickAccessPendingWriteCount === 0) {
    quickAccessAuthoritativeFallback = cloneConfigSnapshot(previousConfig);
    quickAccessAuthoritativeFallbackRevision = revision - 1;
  }
  quickAccessPendingWriteCount += 1;

  try {
    const authoritativeConfig = requireAuthoritativeConfig(
      await host.updateConfig(buildQuickAccessConfigPatch(nextConfig))
    );
    rememberDashboard(previousConfig, authoritativeConfig);
    const isCurrent = revision === quickAccessPersistenceRevision;
    if (revision >= quickAccessAuthoritativeFallbackRevision) {
      quickAccessAuthoritativeFallback = cloneConfigSnapshot(authoritativeConfig);
      quickAccessAuthoritativeFallbackRevision = revision;
    }
    if (isCurrent) {
      // The optimistic render already drew this layout; only redraw when the host changed it.
      const rendered = JSON.stringify(buildQuickAccessConfigPatch(state.CONFIG));
      state.setConfig(authoritativeConfig);
      if (JSON.stringify(buildQuickAccessConfigPatch(state.CONFIG)) !== rendered) {
        renderQuickAccessConfigState();
      }
    }
    return { success: true, config: authoritativeConfig, revision, isCurrent };
  } catch (error) {
    console.error('Failed to persist Quick Access configuration:', error);
    const isCurrent = revision === quickAccessPersistenceRevision;
    if (isCurrent) {
      if (rollbackOnFailure) {
        const recoveredConfig = error?.result?.config;
        state.setConfig(
          recoveredConfig?.homeAssistant
            ? recoveredConfig
            : cloneConfigSnapshot(quickAccessAuthoritativeFallback || previousConfig)
        );
        renderQuickAccessConfigState();
      }
      showConfigPersistenceError(error);
    }
    return { success: false, error, revision, isCurrent };
  } finally {
    quickAccessPendingWriteCount = Math.max(0, quickAccessPendingWriteCount - 1);
    if (quickAccessPendingWriteCount === 0) {
      quickAccessAuthoritativeFallback = null;
      quickAccessAuthoritativeFallbackRevision = 0;
    }
  }
}

function ensureQuickAccessConfig() {
  const normalized = normalizeQuickAccessConfig(state.CONFIG || {}, { withChanged: true });
  if (!state.CONFIG || normalized.changed) {
    const previousConfig = cloneConfigSnapshot(state.CONFIG);
    state.setConfig(normalized.config);
    void persistQuickAccessConfigSnapshot(normalized.config, previousConfig, {
      // Keep the valid in-memory normalization if an automatic migration cannot
      // be written; the app can retry it later without restoring malformed state.
      rollbackOnFailure: false,
    });
  }
  return normalized.config;
}

function setQuickAccessConfig(nextConfig, options = {}) {
  const previousConfig = cloneConfigSnapshot(state.CONFIG);
  const normalized = normalizeQuickAccessConfig(nextConfig || {});
  state.setConfig(normalized);
  const persistence = persistQuickAccessConfigSnapshot(normalized, previousConfig);
  if (options.render !== false) {
    renderQuickAccessConfigState();
  }
  return persistence;
}

function getActiveQuickAccessEntityIds() {
  const config = ensureQuickAccessConfig();
  const entityIds = getActiveQuickAccessTab(config)?.entityIds || [];
  if (isClimateDemoOverlayConfig(config) && !entityIds.includes(DEV_CLIMATE_DEMO_ENTITY_ID)) {
    return [DEV_CLIMATE_DEMO_ENTITY_ID, ...entityIds];
  }
  return entityIds;
}

function isDevelopmentClimateOverlayEntity(entityId) {
  return entityId === DEV_CLIMATE_DEMO_ENTITY_ID && isClimateDemoOverlayConfig(state.CONFIG);
}

// Preset page names offered when adding a Quick Access page in reorganize mode.
const QUICK_ACCESS_PAGE_PRESETS = [
  'Living Room',
  'Bedroom',
  'Kitchen',
  'Office',
  'Bathroom',
  'Garage',
];

async function switchQuickAccessPage(tabId) {
  // Choosing the page already shown changes nothing to save and nobody to tell.
  if (tabId === state.CONFIG?.activeTabId) return { success: true, unchanged: true };
  const nextConfig = setActiveQuickAccessView(state.CONFIG, tabId);
  const result = await setQuickAccessConfig(nextConfig);
  if (result?.success !== false) {
    window.dispatchEvent(new CustomEvent('desktop-companion-page-changed'));
  }
  return result;
}

// --- Quick Access page tabs ---
// The pages sit in a strip inside the bar (#quick-access-tabs). The bar is the pill, or the
// editing row; the strip is what scrolls, so the bar keeps its shape and the Add page button
// beside it can never be scrolled out of reach.

function getQuickAccessTabScroller(tabBar) {
  let scroller = tabBar.querySelector(':scope > .quick-access-tab-scroll');
  if (scroller) return scroller;

  scroller = document.createElement('div');
  scroller.className = 'quick-access-tab-scroll';
  tabBar.appendChild(scroller);
  bindQuickAccessTabScroller(scroller);
  return scroller;
}

// Tells the stylesheet which edges have more pages beyond them, so it can fade them.
function updateQuickAccessTabOverflow(scroller) {
  const { left, right } = getQuickAccessTabOverflow({
    scrollLeft: scroller.scrollLeft,
    scrollWidth: scroller.scrollWidth,
    clientWidth: scroller.clientWidth,
    direction: getTextDirection(scroller),
  });
  const overflow = left && right ? 'both' : left ? 'left' : right ? 'right' : '';
  if (overflow) scroller.dataset.overflow = overflow;
  else delete scroller.dataset.overflow;
}

// Scrolls the strip so the active page is fully in view. The strip is scrolled itself, never with
// scrollIntoView, which would also move the panel around it. While the strip has no layout (the
// window is hidden) there is nothing to measure; its resize observer calls this again once it has.
function revealActiveQuickAccessTab(scroller) {
  const active = scroller.querySelector('.quick-access-tab.active');
  if (!active || !scroller.clientWidth) return;

  const view = scroller.getBoundingClientRect();
  const box = active.getBoundingClientRect();
  const delta = getQuickAccessTabRevealDelta({
    itemLeft: box.left - view.left,
    itemRight: box.right - view.left,
    viewWidth: scroller.clientWidth,
    direction: getTextDirection(scroller),
  });
  if (delta) {
    // The first reveal (the window just opened) jumps; later ones glide, like the pill does.
    const behavior =
      scroller.dataset.revealed === 'true' && !prefersReducedMotion() ? 'smooth' : 'auto';
    const left = scroller.scrollLeft + delta;
    if (typeof scroller.scrollTo === 'function') scroller.scrollTo({ left, behavior });
    else scroller.scrollLeft = left;
  }
  scroller.dataset.revealed = 'true';
}

function bindQuickAccessTabScroller(scroller) {
  // The arrows move focus along the pages and choose the one reached (not while reorganizing,
  // when the pages are buttons in a group). The switch rebuilds the bar, which puts focus back on
  // the button for the same page.
  bindTabListKeyboard(scroller, '.quick-access-tab-link');
  scroller.addEventListener('scroll', () => updateQuickAccessTabOverflow(scroller), {
    passive: true,
  });
  // A plain wheel only turns vertically, so it scrolls the row sideways. At either end it lets
  // go, and the panel behind scrolls as usual.
  scroller.addEventListener(
    'wheel',
    (event) => {
      const direction = getTextDirection(scroller);
      const delta = getQuickAccessTabWheelDelta(event, scroller.clientWidth, direction);
      if (!delta) return;
      const { left, right } = getQuickAccessTabOverflow({
        scrollLeft: scroller.scrollLeft,
        scrollWidth: scroller.scrollWidth,
        clientWidth: scroller.clientWidth,
        direction,
      });
      if (delta > 0 ? !right : !left) return;
      event.preventDefault();
      scroller.scrollLeft += delta;
    },
    { passive: false }
  );
  if (typeof ResizeObserver === 'function') {
    // A resized window or a wider label can push the active page out of view, and a strip drawn
    // while the window was hidden gets its first layout here.
    new ResizeObserver(() => {
      revealActiveQuickAccessTab(scroller);
      updateQuickAccessTabOverflow(scroller);
    }).observe(scroller);
  }
}

// The buttons the bar rebuilds. Which one has focus is remembered so the rebuild can give it back
// to its twin; the rename field is not among them, as it ends by handing focus back itself.
const QUICK_ACCESS_TAB_CONTROLS = [
  'quick-access-tab-link',
  'qa-tab-rename',
  'qa-tab-duplicate',
  'qa-tab-delete',
];

function getFocusedQuickAccessTabControl(scroller) {
  const focused = document.activeElement;
  const tab = focused && scroller.contains(focused) ? focused.closest('.quick-access-tab') : null;
  if (!tab) return null;
  return {
    tabId: tab.dataset.tab,
    className: QUICK_ACCESS_TAB_CONTROLS.find((name) => focused.classList.contains(name)),
  };
}

function restoreQuickAccessTabFocus(scroller, control) {
  if (!control?.className) return;
  const tab = [...scroller.querySelectorAll('.quick-access-tab')].find(
    (element) => element.dataset.tab === control.tabId
  );
  const target =
    tab?.querySelector(`.${control.className}`) || tab?.querySelector('.quick-access-tab-link');
  target?.focus({ preventScroll: true });
}

// Add page lives beside the strip rather than in it, so it stays in reach however many pages
// scroll. One element is kept between renders, so it keeps focus too.
function syncQuickAccessAddPageButton(tabBar, show) {
  let addBtn = tabBar.nextElementSibling?.classList.contains('qa-tab-add')
    ? tabBar.nextElementSibling
    : null;
  if (!show) {
    addBtn?.remove();
    return;
  }

  if (!addBtn) {
    addBtn = document.createElement('button');
    addBtn.type = 'button';
    addBtn.className = 'qa-tab-add';
    setIconContent(addBtn, 'add', { size: 14 });
    addBtn.appendChild(document.createElement('span'));
    addBtn.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      showAddPageModal();
    });
    tabBar.after(addBtn);
  }
  addBtn.title = t('Add page');
  addBtn.setAttribute('aria-label', t('Add page'));
  addBtn.querySelector('span').textContent = t('Add page');
}

function renderQuickAccessTabs(config = ensureQuickAccessConfig()) {
  const tabBar = document.getElementById('quick-access-tabs');
  if (!tabBar) return;
  const scroller = getQuickAccessTabScroller(tabBar);

  const tabs = config.customTabs || [];
  const reorganizing = isReorganizeMode;
  const focusedControl = getFocusedQuickAccessTabControl(scroller);
  const scrollLeft = scroller.scrollLeft;

  // Clear everything but the sliding pill: the bar is rebuilt on every switch (often twice, once
  // for the optimistic update and once for the saved config), and replacing the pill would cut
  // its slide short.
  [...scroller.children].forEach((child) => {
    if (!child.classList.contains('sliding-indicator')) child.remove();
  });
  tabBar.classList.toggle('reorganize', reorganizing);

  // In normal mode, only surface tabs once there is more than one page.
  // In reorganize mode, always show the bar so pages can be created/renamed.
  const shouldShow = reorganizing || tabs.length > 1;
  tabBar.classList.toggle('hidden', !shouldShow);
  syncQuickAccessAddPageButton(tabBar, reorganizing);

  // The pages are tabs for the grid below only outside reorganize mode. While reorganizing the
  // bar also holds the rename, duplicate and delete buttons, which a tab list may not contain.
  const asTabs = shouldShow && !reorganizing;
  scroller.setAttribute('role', asTabs ? 'tablist' : 'group');
  scroller.setAttribute('aria-label', t('Quick Access views'));
  const panel = document.getElementById('quick-controls');
  if (asTabs) {
    // Named for the active tab, below.
    panel?.setAttribute('role', 'tabpanel');
  } else {
    panel?.removeAttribute('role');
    panel?.removeAttribute('aria-labelledby');
  }

  if (!shouldShow) {
    syncSlidingIndicator(scroller, null);
    updateQuickAccessTabOverflow(scroller);
    return;
  }

  // A tab list has one tab stop and the arrow keys reach the rest: the active page, or the first.
  // While reorganizing the pages are plain buttons beside their own edit buttons, and every one
  // of them can be tabbed to.
  const stopId = tabs.some((tab) => tab.id === config.activeTabId)
    ? config.activeTabId
    : tabs[0]?.id;

  tabs.forEach((tab, index) => {
    const isActive = tab.id === config.activeTabId;

    const tabEl = document.createElement('div');
    tabEl.className = 'quick-access-tab';
    tabEl.classList.toggle('active', isActive);
    tabEl.dataset.tab = tab.id;

    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'tab-link quick-access-tab-link';
    button.classList.toggle('active', isActive);
    button.id = `quick-access-tab-${index}`;
    button.dataset.tab = tab.id;
    button.tabIndex = !asTabs || tab.id === stopId ? 0 : -1;
    const label = document.createElement('span');
    label.className = 'quick-access-tab-label';
    // A name is in whatever script the person typed, which need not be the interface's: it is
    // aligned and cut short from its own start.
    label.dir = 'auto';
    label.textContent = tab.name;
    button.appendChild(label);
    if (asTabs) {
      button.setAttribute('role', 'tab');
      button.setAttribute('aria-selected', isActive ? 'true' : 'false');
      button.setAttribute('aria-controls', 'quick-controls');
      if (isActive) panel?.setAttribute('aria-labelledby', button.id);
    } else if (isActive) {
      button.setAttribute('aria-current', 'page');
    }
    // A long name is cut short with an ellipsis; the tooltip has all of it.
    button.title = reorganizing ? `${tab.name}\n${t('Double-click to rename')}` : tab.name;
    button.addEventListener('click', () => switchQuickAccessPage(tab.id));

    if (reorganizing) {
      button.addEventListener('dblclick', (event) => {
        event.preventDefault();
        event.stopPropagation();
        beginInlineTabRename(tab.id, button);
      });
    }

    tabEl.appendChild(button);

    if (reorganizing && isActive) {
      const renameBtn = document.createElement('button');
      renameBtn.type = 'button';
      renameBtn.className = 'qa-tab-btn qa-tab-rename';
      renameBtn.title = t('Rename page');
      renameBtn.setAttribute('aria-label', t('Rename page'));
      setChipIcon(renameBtn, 'pencil', 12);
      renameBtn.addEventListener('click', (event) => {
        event.preventDefault();
        event.stopPropagation();
        beginInlineTabRename(tab.id, button);
      });
      tabEl.appendChild(renameBtn);

      const duplicateBtn = document.createElement('button');
      duplicateBtn.type = 'button';
      duplicateBtn.className = 'qa-tab-btn qa-tab-duplicate';
      duplicateBtn.title = t('Duplicate page');
      duplicateBtn.setAttribute('aria-label', t('Duplicate page'));
      setChipIcon(duplicateBtn, 'copy', 12);
      duplicateBtn.addEventListener('click', (event) => {
        event.preventDefault();
        event.stopPropagation();
        void duplicateQuickAccessPage(tab.id);
      });
      tabEl.appendChild(duplicateBtn);

      if (tabs.length > 1) {
        const deleteBtn = document.createElement('button');
        deleteBtn.type = 'button';
        deleteBtn.className = 'qa-tab-btn qa-tab-delete';
        deleteBtn.title = t('Delete page');
        deleteBtn.setAttribute('aria-label', t('Delete page'));
        setChipIcon(deleteBtn, 'x', 12);
        deleteBtn.addEventListener('click', (event) => {
          event.preventDefault();
          event.stopPropagation();
          deleteQuickAccessPage(tab.id);
        });
        tabEl.appendChild(deleteBtn);
      }
    }

    scroller.appendChild(tabEl);
  });

  // A rebuild must not move a strip the person has scrolled; only the active page's visibility
  // may (below).
  scroller.scrollLeft = scrollLeft;

  // A pill slides between pages; reorganize mode keeps its own editing highlight.
  syncSlidingIndicator(
    scroller,
    reorganizing ? null : scroller.querySelector('.quick-access-tab-link.active')
  );
  restoreQuickAccessTabFocus(scroller, focusedControl);
  revealActiveQuickAccessTab(scroller);
  updateQuickAccessTabOverflow(scroller);
}

function beginInlineTabRename(tabId, buttonEl) {
  if (!buttonEl || buttonEl.dataset.renaming === 'true') return;
  const currentName = buttonEl.textContent || '';
  buttonEl.dataset.renaming = 'true';

  const input = document.createElement('input');
  input.type = 'text';
  input.className = 'qa-tab-rename-input';
  input.dir = 'auto';
  input.value = currentName;
  input.maxLength = 40;
  input.setAttribute('aria-label', t('Rename page'));

  buttonEl.replaceWith(input);
  input.focus();
  input.select();

  let done = false;
  // Enter and Escape hand focus back to the page's tab; leaving the field by clicking or tabbing
  // away keeps focus wherever the person went.
  const finish = (save, restoreFocus = false) => {
    if (done) return;
    done = true;
    const value = input.value.trim();
    if (save && value && value !== currentName) {
      const nextConfig = renameQuickAccessView(state.CONFIG, tabId, value);
      void setQuickAccessConfig(nextConfig).then((result) => {
        if (result.success) {
          uiUtils.showToast(t('Page renamed'), 'success', 1600);
        }
      });
    } else {
      // Re-render to restore the tab label (revert or no-op change).
      renderQuickAccessTabs();
    }
    if (restoreFocus) {
      [...document.querySelectorAll('#quick-access-tabs .quick-access-tab-link')]
        .find((tab) => tab.dataset.tab === tabId)
        ?.focus({ preventScroll: true });
    }
  };

  input.addEventListener('keydown', (event) => {
    // The Enter that commits an input method's candidate is not the end of the rename.
    if (event.isComposing || event.keyCode === 229) return;
    if (event.key === 'Enter') {
      event.preventDefault();
      event.stopPropagation();
      finish(true, true);
    } else if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation(); // do not exit reorganize mode mid-edit
      finish(false, true);
    }
  });
  input.addEventListener('blur', () => finish(true));
  input.addEventListener('click', (event) => event.stopPropagation());
  input.addEventListener('dblclick', (event) => event.stopPropagation());
}

async function duplicateQuickAccessPage(tabId) {
  if (quickAccessPendingWriteCount) {
    uiUtils.showToast(t('Wait for the current dashboard save to finish.'), 'info', 1600);
    return;
  }
  const config = ensureQuickAccessConfig();
  if (!config.customTabs.some((tab) => tab.id === tabId)) return;
  const pending = setQuickAccessConfig(duplicateQuickAccessView(config, tabId));
  focusActiveQuickAccessPage();
  const result = await pending;
  if (result.success) {
    uiUtils.showToast(t('Page duplicated'), 'success', 1600);
    window.dispatchEvent(new CustomEvent('desktop-companion-page-changed'));
  }
  // Keep focus on the authoritative page after saving or rolling back a failed save.
  renderQuickAccessTabs();
  focusActiveQuickAccessPage();
}

async function deleteQuickAccessPage(tabId) {
  const config = ensureQuickAccessConfig();
  if ((config.customTabs || []).length <= 1) return;
  const tab = config.customTabs.find((view) => view.id === tabId);
  if (!tab) return;

  const confirmed = await uiUtils.showConfirm(
    t('Delete Page'),
    t('Delete "{{name}}"? Its entities will be removed from this page.', { name: tab.name }),
    { confirmText: t('Delete'), confirmClass: 'btn-danger' }
  );
  if (!confirmed) return;

  const previousActiveTabId = state.CONFIG?.activeTabId;
  // A graph only the deleted page showed (a duplicated page's copy) goes with it; Undo restores
  // both from the saved layout.
  const nextConfig = normalizeComparisonGraphsConfig(deleteQuickAccessView(state.CONFIG, tabId));
  const pending = setQuickAccessConfig(nextConfig);
  // The deleted page's tab took the focused button with it.
  focusActiveQuickAccessPage();
  const result = await pending;
  if (result.success) {
    uiUtils.showToast(t('Page deleted'), 'info', 1600);
    if (state.CONFIG?.activeTabId !== previousActiveTabId) {
      window.dispatchEvent(new CustomEvent('desktop-companion-page-changed'));
    }
  }
}

// After the control that changed the pages is gone (a deleted tab, a closed starter), keep
// keyboard focus on the page now on screen: its tab when the tab bar shows, else its first tile.
function focusActiveQuickAccessPage() {
  setTimeout(() => {
    const active = document.activeElement;
    // Focus still in a dialog that is animating out (the delete confirmation) is about to drop.
    if (active && active !== document.body && !active.closest('.modal-closing')) return;
    const target =
      document.querySelector('#quick-access-tabs:not(.hidden) .quick-access-tab-link.active') ||
      document.querySelector(
        '#quick-controls button:not([disabled]), #quick-controls [tabindex]:not([tabindex="-1"])'
      );
    target?.focus();
  }, 0);
}

function createQuickAccessPage(name, entityIds = [], { fillEmptyPage = false } = {}) {
  // First-run setup starts from the empty default page; fill that page rather than leaving it
  // empty beside the new one, still inviting the user to set up a page.
  const activePage = fillEmptyPage ? getActiveQuickAccessTab(state.CONFIG) : null;
  const fillsActivePage = !!activePage && !activePage.entityIds.length;
  const nextConfig = fillsActivePage
    ? renameQuickAccessView(state.CONFIG, activePage.id, name)
    : addQuickAccessView(state.CONFIG, name, { idFactory: generateQuickAccessViewId });
  nextConfig.customTabs.find((tab) => tab.id === nextConfig.activeTabId).entityIds = entityIds;
  return setQuickAccessConfig(nextConfig).then((result) => {
    if (result.success) {
      uiUtils.showToast(fillsActivePage ? t('Page updated') : t('Page added'), 'success', 1600);
      // Adding a page switches to it; filling the empty active page keeps the same page.
      if (!fillsActivePage) {
        window.dispatchEvent(new CustomEvent('desktop-companion-page-changed'));
      }
    }
    return result;
  });
}

// Teardown rather than a user-facing dismissal: this runs before re-opening the dialog and when
// reorganize mode exits, so it detaches immediately instead of animating out over a replacement.
function closeAddPageModal() {
  const modal = document.getElementById('add-page-modal');
  if (modal) void uiUtils.closeDialog(modal, { remove: true, animate: false });
}

function showAddPageModal({ starter = false } = {}) {
  closeAddPageModal();

  // The starter dialog fills the empty page on screen rather than adding one. Beside other pages
  // that page already has a name, which stays, and the dialog says it fills the page; as the only
  // page it is the first-run page, named after the room chosen.
  const activePage = starter ? getActiveQuickAccessTab(state.CONFIG) : null;
  const fillsNamedPage =
    !!activePage && !activePage.entityIds.length && (state.CONFIG.customTabs?.length ?? 0) > 1;
  const dialogTitle = fillsNamedPage ? t('Fill this page') : t('Add Page');

  const chipsMarkup = QUICK_ACCESS_PAGE_PRESETS.map(
    (preset) => `
              <button type="button" class="qa-add-chip" data-name="${escapeHtmlAttribute(t(preset))}" data-preset="${escapeHtmlAttribute(preset)}">${utils.escapeHtml(t(preset))}</button>`
  ).join('');

  const modal = document.createElement('div');
  modal.id = 'add-page-modal';
  modal.className = 'modal add-page-modal';
  modal.setAttribute('aria-labelledby', 'add-page-title');
  modal.innerHTML = `
    <div class="modal-content">
      <div class="modal-header">
        <h2 id="add-page-title">${utils.escapeHtml(dialogTitle)}</h2>
        <button class="close-btn" aria-label="${escapeHtmlAttribute(t('Close'))}">×</button>
      </div>
      <div class="modal-body">
        <div class="form-group">
          <label for="add-page-name">${utils.escapeHtml(t('Page name:'))}</label>
          <input type="text" id="add-page-name" class="form-control" maxlength="40" value="${escapeHtmlAttribute(fillsNamedPage ? activePage.name : '')}" placeholder="${escapeHtmlAttribute(t('Enter page name'))}">
          <p id="add-page-name-error" class="form-help add-page-name-error" role="alert" hidden>${utils.escapeHtml(t('Enter page name'))}</p>
        </div>
        <div class="form-group">
          <span id="add-page-chips-label" class="form-label">${utils.escapeHtml(t('Quick picks:'))}</span>
          <div class="qa-add-chips" role="group" aria-labelledby="add-page-chips-label">${chipsMarkup}</div>
        </div>
      </div>
      <div class="modal-footer">
        <button id="add-page-cancel-btn" class="btn btn-secondary">${utils.escapeHtml(t('Cancel'))}</button>
        <button id="add-page-save-btn" class="btn btn-primary">${utils.escapeHtml(dialogTitle)}</button>
      </div>
    </div>
  `;
  document.body.appendChild(modal);
  applyCloseButtonIcons(modal);

  const roomGroup = document.createElement('div');
  roomGroup.className = 'form-group room-dashboard';
  const roomLabel = document.createElement('label');
  roomLabel.htmlFor = 'add-page-room';
  roomLabel.textContent = t('Start with a room');
  const roomSelect = document.createElement('select');
  roomSelect.id = 'add-page-room';
  roomSelect.className = 'form-control';
  roomSelect.add(new Option(t('Empty page'), ''));
  const roomStatus = document.createElement('p');
  roomStatus.setAttribute('role', 'status');
  const roomEntities = document.createElement('div');
  roomEntities.className = 'room-entity-list';
  const loadRooms = document.createElement('button');
  loadRooms.type = 'button';
  loadRooms.className = 'btn btn-secondary';
  loadRooms.textContent = t('Load rooms');
  roomGroup.append(roomLabel, roomSelect, loadRooms, roomStatus, roomEntities);
  const deviceSearch = document.createElement('input');
  deviceSearch.type = 'search';
  deviceSearch.className = 'form-control room-device-search';
  deviceSearch.placeholder = t('Search devices');
  deviceSearch.setAttribute('aria-label', t('Search devices'));
  const filterDevices = () => {
    const query = normalizeSearchText(deviceSearch.value);
    const labels = [...roomEntities.querySelectorAll('label')];
    labels.forEach((label) => {
      label.hidden = !normalizeSearchText(
        `${label.textContent} ${label.querySelector('input').value}`
      ).includes(query);
    });
    // Say so when the search hides every device, and bring the previous hint back after.
    if (labels.length && labels.every((label) => label.hidden)) {
      statusBeforeNoMatches ??= roomStatus.textContent;
      roomStatus.textContent = t('No matching entities found.');
    } else if (statusBeforeNoMatches !== null) {
      roomStatus.textContent = statusBeforeNoMatches;
      statusBeforeNoMatches = null;
    }
  };
  let statusBeforeNoMatches = null;
  deviceSearch.addEventListener('input', filterDevices);
  deviceSearch.hidden = true;
  roomGroup.insertBefore(deviceSearch, roomEntities);
  modal.querySelector('.modal-body').appendChild(roomGroup);
  let registry = null;
  let availableStates = state.STATES;
  const preview = document.createElement('div');
  preview.className = 'room-dashboard-preview';
  preview.setAttribute('aria-live', 'polite');
  roomGroup.appendChild(preview);
  const updatePreview = () => {
    const selected = [...roomEntities.querySelectorAll('input:checked')];
    preview.replaceChildren();
    const title = document.createElement('p');
    title.textContent =
      selected.length === 1
        ? t('Page preview: 1 entity')
        : t('Page preview: {{count}} entities', { count: selected.length });
    preview.appendChild(title);
    selected.slice(0, 8).forEach(({ value }) => {
      const tile = document.createElement('div');
      tile.className = 'room-preview-tile';
      const entity = availableStates[value];
      tile.textContent = `${utils.getEntityDisplayName(entity)} — ${utils.getEntityDisplayState(entity)}`;
      preview.appendChild(tile);
    });
    const remaining = selected.length - 8;
    if (remaining > 0) {
      const more = document.createElement('p');
      more.textContent =
        remaining === 1
          ? t('And 1 more entity')
          : t('And {{count}} more entities', { count: remaining });
      preview.appendChild(more);
    }
  };
  roomEntities.addEventListener('change', updatePreview);
  // Remember the name we filled in from a room so a name the user typed is never overwritten.
  let autoFilledName = '';
  loadRooms.onclick = async () => {
    loadRooms.disabled = true;
    if (starter) saveBtn.disabled = true;
    roomStatus.textContent = t('Loading rooms…');
    try {
      if (starter) {
        if (!websocket.isConnected()) roomStatus.textContent = t('Connecting to Home Assistant…');
        if (!(await waitForRoomConnection(websocket, () => modal.isConnected))) return;
        roomStatus.textContent = t('Loading rooms…');
        const response = await websocket.request({ type: 'get_states' });
        if (response?.success === false || !Array.isArray(response?.result))
          throw new Error('states unavailable');
        availableStates = Object.fromEntries(
          response.result.map((entity) => [entity.entity_id, entity])
        );
      }
      let registryUnavailable = false;
      try {
        registry = await loadRoomRegistry(websocket);
      } catch (error) {
        if (!starter) throw error;
        // State access does not require administrator registry permissions.
        registry = { areas: [], entities: [], devices: [] };
        registryUnavailable = true;
      }
      if (!modal.isConnected) return;
      if (!starter) availableStates = state.STATES;
      roomSelect.replaceChildren(new Option(starter ? t('All devices') : t('Empty page'), ''));
      roomEntities.replaceChildren();
      registry.areas
        .sort((a, b) => compareNames(a.name, b.name))
        .forEach((area) => {
          roomSelect.add(new Option(area.name, area.area_id));
        });
      roomStatus.textContent = registry.areas.length ? '' : t('No rooms found in Home Assistant.');
      loadRooms.hidden = true;
      if (starter) {
        roomSelect.value =
          registry.areas.find(
            (area) =>
              entitiesForArea(area.area_id, registry.entities, registry.devices, availableStates)
                .length
          )?.area_id || '';
        roomSelect.onchange();
        if (registryUnavailable) {
          roomStatus.textContent = t('Rooms are unavailable. Choose from your devices instead.');
        } else if (!registry.areas.length) {
          roomStatus.textContent = t(
            'No rooms are set up in Home Assistant yet. Choose from your devices instead.'
          );
        }
        saveBtn.disabled = false;
      }
    } catch (error) {
      if (!modal.isConnected) return;
      if (error?.code === 'registry_unavailable') {
        // Home Assistant refused the request; retrying cannot succeed without new permissions.
        roomStatus.textContent = error.message;
        loadRooms.hidden = true;
        return;
      }
      roomStatus.textContent = t(
        'Could not load rooms. Check your connection and permissions, then retry.'
      );
      loadRooms.textContent = t('Retry');
    } finally {
      if (!submissionInFlight) loadRooms.disabled = false;
      // A failed load must not leave the dialog unable to save: an empty page is still a page.
      if (starter && !submissionInFlight) saveBtn.disabled = false;
    }
  };
  roomSelect.onchange = () => {
    // Reconnect replaces the state map while an existing dialog can stay open.
    // Starter mode owns its explicit get_states snapshot instead.
    if (!starter) availableStates = state.STATES;
    roomEntities.replaceChildren();
    preview.replaceChildren();
    statusBeforeNoMatches = null;
    if ((!roomSelect.value && !starter) || !registry) {
      roomStatus.textContent = '';
      deviceSearch.hidden = true;
      return;
    }
    const area = registry.areas.find((entry) => entry.area_id === roomSelect.value);
    if (!input.value.trim() || input.value === autoFilledName) {
      setPageName(area?.name || (starter ? t('My devices') : ''));
      autoFilledName = input.value;
    }
    const ids =
      !roomSelect.value && starter
        ? selectableEntityIds(availableStates, registry.entities)
        : entitiesForArea(roomSelect.value, registry.entities, registry.devices, availableStates);
    roomStatus.textContent = ids.length
      ? t('Choose the entities to include.')
      : t('No available entities in this room.');
    ids.sort((a, b) =>
      compareNames(
        utils.getEntityDisplayName(availableStates[a]),
        utils.getEntityDisplayName(availableStates[b])
      )
    );
    // Suggest up to eight available devices you can control; sensors and buttons stay optional.
    const defaults = new Set(
      ids
        .filter(
          (id) =>
            /^(light|switch|climate|fan|cover|media_player)\./.test(id) &&
            !['unknown', 'unavailable'].includes(availableStates[id].state)
        )
        .slice(0, 8)
    );
    deviceSearch.hidden = !ids.length;
    ids.forEach((id) => {
      const label = document.createElement('label');
      const checkbox = document.createElement('input');
      checkbox.type = 'checkbox';
      checkbox.value = id;
      checkbox.checked = defaults.has(id);
      label.append(
        checkbox,
        document.createTextNode(utils.getEntityDisplayName(availableStates[id]))
      );
      roomEntities.appendChild(label);
    });
    filterDevices();
    updatePreview();
  };
  const input = modal.querySelector('#add-page-name');
  const nameError = modal.querySelector('#add-page-name-error');
  const clearNameError = () => {
    nameError.hidden = true;
    input.removeAttribute('aria-invalid');
    input.removeAttribute('aria-describedby');
  };
  // A name filled in for the person (a room, a quick pick) answers a missing-name error the way
  // typing one would, since setting .value fires no input event. An empty fill is still missing.
  const setPageName = (name) => {
    input.value = name;
    if (name.trim()) clearNameError();
  };
  const saveBtn = modal.querySelector('#add-page-save-btn');
  const cancelBtn = modal.querySelector('#add-page-cancel-btn');
  const closeBtn = modal.querySelector('.close-btn');

  let submissionInFlight = false;
  const setSubmissionInFlight = (inFlight) => {
    submissionInFlight = inFlight;
    [...modal.querySelectorAll('input, select, button')].forEach((control) => {
      if (control) control.disabled = inFlight;
    });
  };
  // The tab bar can re-render while this dialog is open, detaching the launcher the focus trap
  // remembered. Fall back to the current Add page control so keyboard focus is not dropped.
  const restoreLauncherFocus = () => {
    setTimeout(() => {
      if (document.activeElement && document.activeElement !== document.body) return;
      const addPage = document.querySelector('.qa-tab-add');
      // Outside reorganize mode (the first-run starter) there is no Add page control.
      if (addPage) addPage.focus();
      else focusActiveQuickAccessPage();
    }, 0);
  };
  const closeOptions = { remove: true, onClosed: restoreLauncherFocus };
  const close = () => {
    if (!submissionInFlight) void uiUtils.closeDialog(modal, closeOptions);
  };
  const submit = async () => {
    if (submissionInFlight || saveBtn.disabled) return;
    const name = (input?.value || '').trim();
    if (!name) {
      // Say what is missing, in words and in the field's own state, and put the caret there.
      nameError.hidden = false;
      input?.setAttribute('aria-invalid', 'true');
      input?.setAttribute('aria-describedby', nameError.id);
      input?.focus();
      return;
    }
    setSubmissionInFlight(true);
    const selectedIds = Array.from(
      roomEntities.querySelectorAll('input:checked'),
      (checkbox) => checkbox.value
    );
    const result = await createQuickAccessPage(name, selectedIds, { fillEmptyPage: starter });
    if (result.success) {
      void uiUtils.closeDialog(modal, closeOptions);
      return;
    }
    if (modal.isConnected) {
      setSubmissionInFlight(false);
      input?.focus();
    }
  };

  modal.querySelectorAll('.qa-add-chip').forEach((chip) => {
    chip.addEventListener('click', () => {
      if (!input) return;
      setPageName(chip.dataset.name || chip.textContent || '');
      // A "Kitchen" page should hold the Kitchen room's devices when Home Assistant has that room,
      // whether the room is named in English or in the interface language ("Küche", "kuche").
      const names = [input.value, chip.dataset.preset].filter(Boolean).map((name) => name.trim());
      const area = registry?.areas.find((entry) =>
        names.some((name) => compareNames(entry.name.trim(), name) === 0)
      );
      if (area && roomSelect.value !== area.area_id) {
        const chipName = input.value;
        autoFilledName = chipName;
        roomSelect.value = area.area_id;
        roomSelect.onchange();
        // The page keeps the chip's name ("Küche") when the room is named "Kitchen".
        setPageName(chipName);
        autoFilledName = chipName;
      }
      input.focus();
    });
  });

  if (saveBtn) saveBtn.onclick = submit;
  if (cancelBtn) cancelBtn.onclick = close;
  if (closeBtn) closeBtn.onclick = close;

  if (input) input.addEventListener('input', clearNameError);

  // The page name is where typing starts; Enter in it (or in the device search) adds the page.
  uiUtils.openDialog(modal, {
    display: null,
    initialFocus: input,
    dismiss: close,
    onEnter: (event) => {
      if (event.target === input) void submit();
    },
  });
  if (starter || websocket.isConnected?.()) void loadRooms.onclick();
}

async function restoreDashboard(layout, { activeTabId } = {}) {
  if (quickAccessPendingWriteCount)
    throw new Error(t('Wait for the current dashboard save to finish.'));
  const current = normalizeQuickAccessConfig(state.CONFIG);
  const next = normalizeQuickAccessConfig({ ...state.CONFIG, ...dashboardSnapshot(layout) });
  // Return to the page the layout was saved on, else stay put, else land on the page now in the
  // current page's position rather than jumping to the first one.
  const tabIds = next.customTabs.map((tab) => tab.id);
  const currentIndex = current.customTabs.findIndex((tab) => tab.id === current.activeTabId);
  next.activeTabId =
    [activeTabId, current.activeTabId].find((id) => tabIds.includes(id)) ??
    tabIds[Math.min(Math.max(currentIndex, 0), tabIds.length - 1)];
  await persistAuthoritativeConfig(next);
  renderQuickAccessConfigState();
  if (state.CONFIG?.activeTabId !== current.activeTabId) {
    window.dispatchEvent(new CustomEvent('desktop-companion-page-changed'));
  }
}

function getQuickAccessTiles() {
  const container = document.getElementById('quick-controls');
  if (!container) return [];
  return Array.from(container.querySelectorAll('.control-item[data-entity-id]'));
}

function getQuickAccessGridColumnCount(container) {
  if (!container || typeof window?.getComputedStyle !== 'function') return 1;
  const columns = window.getComputedStyle(container).gridTemplateColumns || '';
  const count = columns.split(' ').filter(Boolean).length;
  return count > 0 ? count : 1;
}

function syncQuickAccessRovingTabIndex(preferredTile = null) {
  const visibleTiles = getQuickAccessTiles();
  if (!visibleTiles.length) {
    quickAccessRovingIndex = 0;
    return;
  }

  const preferredIndex = preferredTile ? visibleTiles.indexOf(preferredTile) : -1;
  if (preferredIndex >= 0) {
    quickAccessRovingIndex = preferredIndex;
  } else {
    quickAccessRovingIndex = Math.min(Math.max(quickAccessRovingIndex, 0), visibleTiles.length - 1);
  }

  visibleTiles.forEach((tile, index) => {
    const target = tile.querySelector('.tile-primary-button') || tile;
    if (target !== tile) tile.removeAttribute('tabindex');
    target.setAttribute('tabindex', index === quickAccessRovingIndex ? '0' : '-1');
  });
}

// Says something to screen readers without showing anything.
function announceQuickAccessChange(message) {
  let region = document.getElementById('quick-access-announcer');
  if (!region) {
    region = document.createElement('div');
    region.id = 'quick-access-announcer';
    region.className = 'sr-only';
    region.setAttribute('role', 'status');
    document.body.appendChild(region);
  }
  region.textContent = message;
}

// Puts a tile where another is, the other making way, and saves the order like a drag does.
function moveQuickAccessTile(tile, target) {
  const tiles = getQuickAccessTiles();
  const index = tiles.indexOf(tile);
  const targetIndex = tiles.indexOf(target);
  if (index < 0 || targetIndex < 0 || index === targetIndex) return false;

  tile.parentElement.insertBefore(tile, targetIndex > index ? target.nextSibling : target);
  saveQuickAccessOrder(tile);
  announceQuickAccessChange(
    t('Moved to position {{position}} of {{total}}', {
      position: getQuickAccessTiles().indexOf(tile) + 1,
      total: tiles.length,
    })
  );
  return true;
}

// Reorganize mode without a mouse: Alt and an arrow key move the tile that has focus (or one of its
// buttons) to where its neighbour in that direction is.
function handleQuickAccessReorderKeydown(event) {
  if (!event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
  if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) return;
  const tile = event.target?.closest?.('#quick-controls .control-item[data-entity-id]');
  if (!tile) return;

  event.preventDefault();
  const tiles = getQuickAccessTiles();
  const index = tiles.indexOf(tile);
  let targetIndex = getNextQuickAccessFocusIndexByLayout(
    tiles.map((item) => item.getBoundingClientRect()),
    index,
    event.key
  );
  if (targetIndex < 0) {
    // Nothing is laid out to go by: a step is a place in the order.
    targetIndex = getNextQuickAccessFocusIndex(
      index,
      tiles.length,
      event.key,
      1,
      window.getComputedStyle(tile.parentElement).direction || document.documentElement.dir
    );
  }
  if (moveQuickAccessTile(tile, tiles[targetIndex])) {
    // Moving a node drops its focus.
    event.target.focus();
  }
}

// Reorganize mode without dragging: select a tile, then the tile that should take its place. The
// selection ends with the move, with Escape, or with leaving reorganize mode.
let pickedUpTile = null;
let lastQuickAccessDragEnd = 0;

function clearPickedUpTile() {
  pickedUpTile?.classList.remove('reorder-picked');
  pickedUpTile = null;
}

function handleQuickAccessReorderClick(event) {
  if (!isReorganizeMode) return;
  // A drag that ends over a tile can still be followed by a click.
  if (Date.now() - lastQuickAccessDragEnd < 400) return;
  const tile = event.target?.closest?.('#quick-controls .control-item[data-entity-id]');
  // The buttons on a tile do their own work.
  if (!tile || event.target.closest('button')) return;

  if (!pickedUpTile?.isConnected) {
    clearPickedUpTile();
    pickedUpTile = tile;
    tile.classList.add('reorder-picked');
    // Said, not shown: the highlight on the tile is the cue, and a toast would cover the tiles
    // that come next.
    announceQuickAccessChange(
      t(
        'Picked up {{name}}. Select the tile whose place it should take, or press Escape to cancel.',
        { name: getQuickAccessTileLabel(tile) }
      )
    );
    return;
  }
  const moving = pickedUpTile;
  clearPickedUpTile();
  if (moving !== tile) moveQuickAccessTile(moving, tile);
}

function handleQuickAccessGridKeydown(event) {
  if (isReorganizeMode) {
    handleQuickAccessReorderKeydown(event);
    return;
  }
  if (event.ctrlKey || event.metaKey || event.altKey) return;
  const tile = event.target?.closest?.('#quick-controls .control-item');
  if (!tile) return;

  if (event.key === 'Enter' || event.key === ' ') {
    event.preventDefault();
    if (event.shiftKey) {
      const entity = state.STATES?.[tile.dataset.entityId];
      if (entity && !shouldBlockInteraction(tile)) openEntityControls(entity);
    } else {
      tile.click();
    }
    return;
  }

  const navigationKeys = ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End'];
  if (!navigationKeys.includes(event.key)) return;

  const container = document.getElementById('quick-controls');
  const visibleTiles = getQuickAccessTiles();
  const currentIndex = visibleTiles.indexOf(tile);
  if (!container || currentIndex < 0) return;

  event.preventDefault();
  // Wide tiles (media players, graphs, spans) make the tile one step on in the DOM a different tile
  // from the one next to it on screen, so the arrows follow where the tiles are drawn.
  let nextIndex = getNextQuickAccessFocusIndexByLayout(
    visibleTiles.map((item) => item.getBoundingClientRect()),
    currentIndex,
    event.key
  );
  if (nextIndex < 0) {
    // Nothing is laid out to go by; count in DOM order.
    nextIndex = getNextQuickAccessFocusIndex(
      currentIndex,
      visibleTiles.length,
      event.key,
      getQuickAccessGridColumnCount(container),
      window.getComputedStyle(container).direction || document.documentElement.dir
    );
    // Left and right stay within the row, and never jump to the far edge of the next one.
    if (
      (event.key === 'ArrowLeft' || event.key === 'ArrowRight') &&
      Math.abs(
        (visibleTiles[nextIndex] || tile).getBoundingClientRect().top -
          tile.getBoundingClientRect().top
      ) > 1
    ) {
      return;
    }
  }
  const nextTile = visibleTiles[nextIndex];
  if (!nextTile) return;

  syncQuickAccessRovingTabIndex(nextTile);
  (nextTile.querySelector('.tile-primary-button') || nextTile).focus();
}

function setupQuickAccessGridKeyboardNavigation() {
  const container = document.getElementById('quick-controls');
  if (!container || container.dataset.keyboardNavigationBound === 'true') return;
  container.addEventListener('keydown', handleQuickAccessGridKeydown);
  // Capturing, as the tiles stop their own clicks while reorganizing.
  container.addEventListener('click', handleQuickAccessReorderClick, true);
  container.dataset.keyboardNavigationBound = 'true';
}

function cachePrimaryCardTemplates() {
  if (!weatherCardTemplate) {
    const weatherCard = document.getElementById('weather-card');
    if (weatherCard) weatherCardTemplate = weatherCard.innerHTML;
  }
  if (!timeCardTemplate) {
    const timeCard = document.getElementById('time-card');
    if (timeCard) timeCardTemplate = timeCard.innerHTML;
  }
}

function getPrimaryCardSelections() {
  return normalizePrimaryCards(state.CONFIG?.primaryCards);
}

function addVisibleEntityCandidate(target, entityId) {
  if (!entityId || typeof entityId !== 'string') return;
  target.add(entityId);
  const resolvedEntityId = utils.resolveEntityId(entityId, state.STATES) || entityId;
  target.add(resolvedEntityId);
}

function isTimerEntityForLiveUpdates(entity) {
  return (
    !!entity?.entity_id &&
    (entity.entity_id.startsWith('timer.') || isTimerLikeSensorEntity(entity))
  );
}

function getDefaultWeatherEntity() {
  const weatherEntities = Object.values(state.STATES || {}).filter(
    (entity) => typeof entity?.entity_id === 'string' && entity.entity_id.startsWith('weather.')
  );
  if (!weatherEntities.length) return null;
  const availableWeatherEntities = weatherEntities.filter(
    (entity) => !WEATHER_UNAVAILABLE_STATES.has(String(entity.state || '').toLowerCase())
  );
  const candidates = availableWeatherEntities.length ? availableWeatherEntities : weatherEntities;
  candidates.sort((a, b) =>
    compareNames(utils.getEntityDisplayName(a), utils.getEntityDisplayName(b))
  );
  return candidates[0];
}

function getDefaultWeatherEntityId() {
  return getDefaultWeatherEntity()?.entity_id || null;
}

function resolveSelectedWeatherEntityId() {
  const selectedWeatherEntity = state.CONFIG?.selectedWeatherEntity;
  const selectedEntity = selectedWeatherEntity ? state.STATES?.[selectedWeatherEntity] : null;
  if (
    typeof selectedEntity?.entity_id === 'string' &&
    selectedEntity.entity_id.startsWith('weather.') &&
    !WEATHER_UNAVAILABLE_STATES.has(String(selectedEntity.state || '').toLowerCase())
  ) {
    return selectedWeatherEntity;
  }
  return getDefaultWeatherEntityId();
}

function refreshVisibleTimerEntityFlag() {
  hasVisibleTimerEntities = Array.from(visibleEntityIds).some((entityId) =>
    isTimerEntityForLiveUpdates(state.STATES?.[entityId])
  );
}

function refreshVisibleEntityCache() {
  try {
    const nextVisibleIds = new Set();
    const favorites = getActiveQuickAccessEntityIds();
    favorites.forEach((entityId) => {
      addVisibleEntityCandidate(nextVisibleIds, entityId);
    });

    const [slotOne, slotTwo] = getPrimaryCardSelections();
    [slotOne, slotTwo].forEach((selection) => {
      if (
        selection &&
        selection !== PRIMARY_CARD_NONE &&
        selection !== 'weather' &&
        selection !== 'time'
      ) {
        addVisibleEntityCandidate(nextVisibleIds, selection);
      }
    });
    isTimeCardVisible = slotOne === 'time' || slotTwo === 'time';

    const selectedWeatherEntity = resolveSelectedWeatherEntityId();
    addVisibleEntityCandidate(nextVisibleIds, selectedWeatherEntity);

    addVisibleEntityCandidate(nextVisibleIds, state.CONFIG?.primaryMediaPlayer);

    // Sensors plotted inside a graph are visible even though they have no tile of their own.
    getComparisonGraphEntityIds(state.CONFIG || {}).forEach((entityId) => {
      addVisibleEntityCandidate(nextVisibleIds, entityId);
    });

    visibleEntityIds.clear();
    nextVisibleIds.forEach((entityId) => {
      visibleEntityIds.add(entityId);
    });

    refreshVisibleTimerEntityFlag();
  } catch (error) {
    console.error('Error refreshing visible entity cache:', error);
  }
}

function isEntityVisible(entityId) {
  if (!entityId || typeof entityId !== 'string') return false;
  if (climateDialogRefreshers.has(entityId)) return true;
  if (visibleEntityIds.size === 0) return true;
  if (visibleEntityIds.has(entityId)) return true;

  const resolvedEntityId = utils.resolveEntityId(entityId, state.STATES) || entityId;
  return visibleEntityIds.has(resolvedEntityId);
}

function getTickTargets() {
  const primaryPlayer = state.CONFIG?.primaryMediaPlayer;
  const mediaEntity = primaryPlayer ? state.STATES?.[primaryPlayer] : null;
  return {
    timeVisible: isTimeCardVisible,
    hasVisibleTimers: hasVisibleTimerEntities,
    mediaEntity: isMediaTileVisible && mediaEntity?.state === 'playing' ? mediaEntity : null,
  };
}

// The primary light card's warm icon and glow key on the card's own data-state, and the card
// outlives the control inside it, so every repaint of that control has to refresh it too.
function syncPrimaryCardState(cardEl, entity) {
  const displayState = getEntityForDisplay(entity)?.state;
  if (displayState) {
    cardEl.dataset.state = displayState;
  } else {
    cardEl.removeAttribute('data-state');
  }
}

function renderPrimaryEntityCard(cardEl, entityId) {
  if (!cardEl) return;

  const resolvedEntityId = utils.resolveEntityId(entityId, state.STATES) || entityId;
  const entity = state.STATES[resolvedEntityId];
  emitUiDebug('primary.render_entity_card', {
    requestedEntityId: entityId,
    resolvedEntityId,
    entityFound: !!entity,
  });
  const control = entity ? createControlElement(entity) : createUnavailableElement(entityId);

  control.dataset.primaryCard = 'true';
  if (!entity && control.classList.contains('repairable')) {
    control.setAttribute('tabindex', '0');
    control.addEventListener('keydown', (event) => {
      if (event.key !== 'Enter' && event.key !== ' ') return;
      event.preventDefault();
      control.click();
    });
  }

  cardEl.classList.add('primary-entity-card');
  cardEl.classList.toggle('primary-light-card', resolvedEntityId.startsWith('light.'));
  cardEl.dataset.primaryType = 'entity';
  cardEl.dataset.entityId = resolvedEntityId;
  syncPrimaryCardState(cardEl, entity);

  cardEl.innerHTML = '';
  cardEl.appendChild(control);
}

function renderPrimaryCard(cardEl, selection, slotIndex) {
  if (!cardEl) return;

  cardEl.dataset.primarySlot = String(slotIndex);
  cardEl.classList.remove(
    'weather-card',
    'time-card',
    'entity-card',
    'primary-entity-card',
    'primary-light-card',
    'unavailable-entity',
    'primary-card-hidden'
  );
  cardEl.removeAttribute('data-entity-id');
  cardEl.removeAttribute('data-state');
  ['tabindex', 'role', 'aria-haspopup', 'aria-keyshortcuts'].forEach((name) =>
    cardEl.removeAttribute(name)
  );
  cardEl.title = '';

  if (selection === PRIMARY_CARD_NONE) {
    cardEl.dataset.primaryType = 'none';
    cardEl.classList.add('primary-card-hidden');
    cardEl.innerHTML = '';
    return;
  }

  if (selection === 'weather') {
    cardEl.dataset.primaryType = 'weather';
    cardEl.classList.add('weather-card');
    cardEl.title = t('Long-press to configure weather');
    cardEl.innerHTML = weatherCardTemplate || '';
    // Keyboard users open the weather picker with Enter, Space, Shift+Enter or the menu key.
    cardEl.tabIndex = 0;
    cardEl.setAttribute('role', 'button');
    cardEl.setAttribute('aria-haspopup', 'dialog');
    cardEl.setAttribute('aria-keyshortcuts', 'Enter Space Shift+Enter');
    // The markup was saved in the startup language; relabel its icons for the current one.
    translateDocument(cardEl);
    return;
  }

  if (selection === 'time') {
    cardEl.dataset.primaryType = 'time';
    cardEl.classList.add('time-card');
    cardEl.title = t('Current time');
    cardEl.innerHTML = timeCardTemplate || '';
    translateDocument(cardEl);
    return;
  }

  renderPrimaryEntityCard(cardEl, selection);
}

function renderPrimaryCards() {
  try {
    const weatherCard = document.getElementById('weather-card');
    const timeCard = document.getElementById('time-card');
    if (!weatherCard || !timeCard) return;
    const grid = document.querySelector('.status-grid');

    cachePrimaryCardTemplates();

    const [slotOne, slotTwo] = getPrimaryCardSelections();
    renderPrimaryCard(weatherCard, slotOne, 1);
    renderPrimaryCard(timeCard, slotTwo, 2);

    if (grid) {
      const visibleCount = [slotOne, slotTwo].filter(
        (selection) => selection !== PRIMARY_CARD_NONE
      ).length;
      grid.classList.toggle('single-card', visibleCount === 1);
      grid.classList.toggle('primary-cards-hidden', visibleCount === 0);
      grid.classList.remove('primary-cards-weather-only');
    }

    if (slotOne === 'weather' || slotTwo === 'weather') {
      updateWeatherFromHA();
    }
    isTimeCardVisible = slotOne === 'time' || slotTwo === 'time';
    if (isTimeCardVisible) {
      // Keep time current without relying on a dedicated long-lived interval.
      stopTimeTicker();
      updateTimeDisplay();
    } else {
      stopTimeTicker();
    }
    refreshVisibleEntityCache();
  } catch (error) {
    console.error('[UI] Error rendering primary cards:', error);
  }
}

function toggleReorganizeMode() {
  try {
    // Clear any active long-press timers to prevent state inconsistency
    clearAllPressTimers();

    isReorganizeMode = !isReorganizeMode;
    const container = document.getElementById('quick-controls');
    const btn = document.getElementById('reorganize-quick-controls-btn');

    if (isReorganizeMode) {
      quickAccessOrderChanged = false;
      container.classList.add('reorganize-mode');
      if (btn) {
        setLineIconContent(btn, 'check');
        btn.classList.add('reorganize-active');
        btn.title = t('Save & Exit Reorganize Mode (ESC)');
      }

      // Initialize SortableJS for drag-and-drop
      sortableInstance = Sortable.create(container, {
        animation: 150,
        ghostClass: 'sortable-ghost',
        chosenClass: 'sortable-chosen',
        dragClass: 'sortable-drag',
        handle: '.control-item', // Allow dragging by any part of the item
        filter: '.remove-btn, .rename-btn, .desktop-pin-quick-toggle', // Ignore edit controls
        preventOnFilter: false, // Allow clicks on filtered elements
        onEnd: (evt) => {
          lastQuickAccessDragEnd = Date.now();
          clearPickedUpTile();
          // SortableJS has already reordered the DOM
          // Just save the new order (pass moved item for duplicate cleanup)
          saveQuickAccessOrder(evt?.item || null);
        },
      });

      addRemoveButtons();
      addEscapeKeyListener();
      window.electronAPI.setDesktopPinEditMode(true).catch((error) => {
        console.error('Failed to enable desktop pin edit mode:', error);
      });
      // A notice, not a question: passive, so it cannot swallow the first drag it sits over.
      uiUtils.showToast(
        t('Reorganize mode on. Drag or press Alt+arrow keys to reorder. Esc to finish.'),
        'info',
        4500,
        { passive: true }
      );
    } else {
      // Destroy Sortable instance
      if (sortableInstance) {
        sortableInstance.destroy();
        sortableInstance = null;
      }

      closeAddPageModal();
      clearPickedUpTile();
      container.classList.remove('reorganize-mode');
      if (btn) {
        setLineIconContent(btn, 'grip-vertical');
        btn.classList.remove('reorganize-active');
        btn.title = t('Reorganize Quick Access');
      }
      saveQuickAccessOrder();
      removeRemoveButtons();
      removeEscapeKeyListener();
      window.electronAPI.setDesktopPinEditMode(false).catch((error) => {
        console.error('Failed to disable desktop pin edit mode:', error);
      });
      if (quickAccessOrderChanged) {
        uiUtils.showToast(t('Quick Access order saved'), 'success', 2000);
      }
      quickAccessOrderChanged = false;
    }

    // Refresh the tab bar so page-management affordances (or the plain tabs)
    // reflect the new reorganize state.
    renderQuickAccessTabs();
  } catch (error) {
    console.error('Error toggling reorganize mode:', error);
  }
}

/**
 * Leaves Reorganize mode if it is on. Main calls for this when it ended the pins' edit mode itself
 * (it hid the window, taking the exit controls with it), so the dashboard does not come back
 * reorganizing while the pins are no longer editable.
 */
function exitReorganizeMode() {
  if (isReorganizeMode) toggleReorganizeMode();
}

function addRemoveButtons() {
  try {
    const controls = document.querySelectorAll('#quick-controls .control-item');
    controls.forEach((item) => {
      addButtonsToElement(item);
    });
  } catch (error) {
    console.error('Error adding remove buttons:', error);
  }
}

function removeRemoveButtons() {
  try {
    document.querySelectorAll('#quick-controls .remove-btn').forEach((btn) => btn.remove());
    document.querySelectorAll('#quick-controls .rename-btn').forEach((btn) => btn.remove());
    document
      .querySelectorAll('#quick-controls .desktop-pin-quick-toggle')
      .forEach((btn) => btn.remove());
  } catch (error) {
    console.error('Error removing remove buttons:', error);
  }
}

// What a tile is called, for the labels of its edit buttons.
function getQuickAccessTileLabel(item) {
  const name = item.querySelector('.control-name, .comparison-graph-title')?.textContent.trim();
  return name || item.dataset.entityId || '';
}

// The Reorganize chips (edit, duplicate, remove) draw with the same line icons as the pin beside
// them, so a tile's three round buttons share one weight and style.
function setChipIcon(button, name, size) {
  const icon = setLineIconContent(button, name);
  icon.setAttribute('width', String(size));
  icon.setAttribute('height', String(size));
}

function addButtonsToElement(item) {
  try {
    if (!item || item.dataset.primaryCard === 'true') return;
    if (isDevelopmentClimateOverlayEntity(item.dataset.entityId)) return;

    // A placeholder stands in for something Home Assistant has not reported: there is nothing
    // to edit or pin, only to remove.
    const isPlaceholder = item.classList.contains('unavailable-entity');

    // Add rename button
    if (!isPlaceholder && !item.querySelector('.rename-btn')) {
      const renameBtn = document.createElement('button');
      renameBtn.className = 'rename-btn';
      setChipIcon(renameBtn, 'pencil', 14);
      renameBtn.title = t('Edit Tile Settings');
      renameBtn.setAttribute('draggable', 'false');
      renameBtn.addEventListener(
        'mousedown',
        (e) => {
          e.stopPropagation();
        },
        true
      );
      renameBtn.addEventListener(
        'dragstart',
        (e) => {
          e.preventDefault();
          e.stopPropagation();
          return false;
        },
        true
      );
      renameBtn.addEventListener(
        'click',
        (e) => {
          e.stopPropagation();
          e.preventDefault();
          showRenameModal(item.dataset.entityId);
        },
        true
      );
      item.appendChild(renameBtn);
    }

    // Add remove button
    if (!item.querySelector('.remove-btn')) {
      const removeBtn = document.createElement('button');
      removeBtn.className = 'remove-btn';
      setChipIcon(removeBtn, 'x', 16);
      removeBtn.title = t('Remove from Quick Access');
      removeBtn.setAttribute('draggable', 'false');
      removeBtn.addEventListener(
        'mousedown',
        (e) => {
          e.stopPropagation();
        },
        true
      );
      removeBtn.addEventListener(
        'dragstart',
        (e) => {
          e.preventDefault();
          e.stopPropagation();
          return false;
        },
        true
      );
      removeBtn.addEventListener(
        'click',
        async (e) => {
          e.stopPropagation();
          e.preventDefault();

          const entityId = item.dataset.entityId;
          const entity = state.STATES[entityId];
          const entityName = entity ? utils.getEntityDisplayName(entity) : entityId;

          const confirmed = await uiUtils.showConfirm(
            t('Remove from Quick Access'),
            t('Remove "{{name}}" from Quick Access?', { name: entityName }),
            { confirmText: t('Remove'), confirmClass: 'btn-danger' }
          );

          if (confirmed) {
            await removeFromQuickAccess(entityId);
          }
        },
        true
      );
      item.appendChild(removeBtn);
    }

    // The buttons are named for their tile, as the icons inside them only say "Edit" and "Close".
    // Tiles are reused when renamed, so this runs every time.
    const tileName = getQuickAccessTileLabel(item);
    item
      .querySelector('.rename-btn')
      ?.setAttribute('aria-label', t('Edit settings for {{name}}', { name: tileName }));
    item
      .querySelector('.remove-btn')
      ?.setAttribute('aria-label', t('Remove {{name}} from Quick Access', { name: tileName }));

    if (!isPlaceholder) syncQuickAccessControlButton(item, item.dataset.entityId);
  } catch (error) {
    console.error('Error adding buttons to element:', error);
  }
}

function showRenameModal(entityId) {
  try {
    // Graph tiles are not entities; their Edit button opens the graph editor instead.
    if (isComparisonGraphId(entityId)) {
      showComparisonGraphModal(entityId);
      return;
    }

    const entity = state.STATES[entityId];
    if (!entity) return;

    let currentName =
      state.CONFIG.customEntityNames?.[entityId] || entity.attributes?.friendly_name || entityId;
    const hasValueSizeControl = isQuickAccessTileValueSizeApplicable(entity);
    const hasCameraPreviewControl = getEntityDomain(entity.entity_id) === 'camera';
    const hasChartControl = isQuickAccessSensorChartApplicable(entity);
    const hasTrayControl = !!getRendererHost().capabilities?.supportsTray;
    let currentValueSize = getQuickAccessTileValueSize(entityId);
    let currentCameraPreviewRefresh = getQuickAccessCameraPreviewRefresh(entityId);
    let currentChartType = getQuickAccessTileChartType(entityId);
    let currentGaugeRange = getQuickAccessTileGaugeRange(entityId);
    let currentTrayEnabled = isEntityInTray(entityId);
    let currentTrayOptions = trayEntitySupport.normalizeTrayEntityOptions(
      state.CONFIG.trayEntities?.[entityId]
    );
    const supportsTrayColor = window.electronAPI?.platform !== 'darwin';
    const valueSizeOptionsMarkup = QUICK_ACCESS_TILE_VALUE_SIZE_LABELS.map(
      (option) => `
                <option value="${escapeHtmlAttribute(option.value)}"${option.value === currentValueSize ? ' selected' : ''}>${utils.escapeHtml(t(option.label))}</option>`
    ).join('');
    const valueSizeControlMarkup = hasValueSizeControl
      ? `
          <div class="form-group">
            <label for="tile-value-size-select">${utils.escapeHtml(t('Value Font Size:'))}</label>
            <select id="tile-value-size-select" class="form-control">
              ${valueSizeOptionsMarkup}
            </select>
            <div class="form-help">${utils.escapeHtml(t('Adjusts the state or readout text size for this Quick Access tile.'))}</div>
          </div>`
      : '';
    const chartOptionsMarkup = SENSOR_TILE_CHART_OPTIONS.map(
      (option) => `
                <option value="${escapeHtmlAttribute(option.value)}"${option.value === currentChartType ? ' selected' : ''}>${utils.escapeHtml(t(option.label))}</option>`
    ).join('');
    const formatGaugeBoundInput = (value) =>
      value === null ? '' : escapeHtmlAttribute(String(value));
    const chartControlMarkup = hasChartControl
      ? `
          <div class="form-group">
            <label for="tile-chart-type-select">${utils.escapeHtml(t('Chart:'))}</label>
            <select id="tile-chart-type-select" class="form-control">
              ${chartOptionsMarkup}
            </select>
            <div class="form-help">${utils.escapeHtml(t('Choose how this sensor tile visualizes its value.'))}</div>
          </div>
          <div class="form-group tile-gauge-range-setting" id="tile-gauge-range-group"${currentChartType === 'gauge' ? '' : ' hidden'}>
            <label for="tile-gauge-min-input">${utils.escapeHtml(t('Gauge range:'))}</label>
            <div class="tile-gauge-range-inputs">
              <input type="number" step="any" id="tile-gauge-min-input" class="form-control" value="${formatGaugeBoundInput(currentGaugeRange.min)}" placeholder="${escapeHtmlAttribute(t('Auto'))}" aria-label="${escapeHtmlAttribute(t('Min'))}">
              <span class="tile-gauge-range-separator" aria-hidden="true">–</span>
              <input type="number" step="any" id="tile-gauge-max-input" class="form-control" value="${formatGaugeBoundInput(currentGaugeRange.max)}" placeholder="${escapeHtmlAttribute(t('Auto'))}" aria-label="${escapeHtmlAttribute(t('Max'))}">
            </div>
            <div class="form-help">${utils.escapeHtml(t('Leave a field blank to size that side of the gauge automatically from the sensor unit, attributes, or recent history.'))}</div>
          </div>`
      : '';
    const trayControlMarkup = hasTrayControl
      ? `
          <div class="form-group tile-tray-setting">
            <label>
              <input type="checkbox" id="tile-tray-checkbox"${currentTrayEnabled ? ' checked' : ''} />
              <span>${utils.escapeHtml(t('Show in system tray'))} (${utils.escapeHtml(t('Beta'))})</span>
            </label>
            <div class="form-help">${utils.escapeHtml(t('Shows this entity’s current value as its own icon in the system tray.'))}</div>
          </div>
          <div id="tile-tray-options"${currentTrayEnabled ? '' : ' hidden'}>
            <div class="form-group">
              <label for="tile-tray-label">${utils.escapeHtml(t('Tray short name'))}</label>
              <input id="tile-tray-label" class="form-control" maxlength="12" value="${escapeHtmlAttribute(currentTrayOptions.label || '')}" placeholder="${escapeHtmlAttribute(t('Optional'))}">
              <div class="form-help">${utils.escapeHtml(t('Prefixes menu-bar values on macOS; identifies icons in tooltips and menus on Windows and Linux.'))}</div>
            </div>
            ${
              supportsTrayColor
                ? `<div class="form-group">
              <label for="tile-tray-color">${utils.escapeHtml(t('Tray icon color'))}</label>
              <select id="tile-tray-color" class="form-control">
                ${[
                  ['auto', 'Automatic'],
                  ['blue', 'Blue'],
                  ['cyan', 'Cyan'],
                  ['purple', 'Purple'],
                  ['pink', 'Pink'],
                  ['orange', 'Orange'],
                ]
                  .map(
                    ([value, label]) =>
                      `<option value="${value}"${value === (currentTrayOptions.color || 'auto') ? ' selected' : ''}>${utils.escapeHtml(t(label))}</option>`
                  )
                  .join('')}
              </select>
              <div class="form-help">${utils.escapeHtml(t('Choose a color to tell values apart. Offline and unavailable values always use the warning color.'))}</div>
            </div>`
                : ''
            }
          </div>`
      : '';
    const cameraPreviewOptionsMarkup = camera.CAMERA_PREVIEW_REFRESH_OPTIONS.map(
      (option) => `
                <option value="${escapeHtmlAttribute(option.value)}"${option.value === currentCameraPreviewRefresh ? ' selected' : ''}>${utils.escapeHtml(t(option.label))}</option>`
    ).join('');
    const cameraPreviewControlMarkup = hasCameraPreviewControl
      ? `
          <div class="form-group camera-preview-setting">
            <label for="camera-preview-refresh-select">${utils.escapeHtml(t('Camera Preview:'))}</label>
            <select id="camera-preview-refresh-select" class="form-control">
              ${cameraPreviewOptionsMarkup}
            </select>
            <div class="form-help">${utils.escapeHtml(t('Live mode uses the authenticated camera stream only while the tile and app are visible. Snapshot modes show the camera integration’s latest image, which may be cached.'))}</div>
          </div>`
      : '';

    const modal = document.createElement('div');
    modal.className = 'modal rename-modal';
    modal.setAttribute('aria-labelledby', 'tile-settings-title');
    modal.innerHTML = `
      <div class="modal-content">
        <div class="modal-header">
          <h2 id="tile-settings-title">${utils.escapeHtml(t('Tile Settings'))}</h2>
          <button class="close-btn" aria-label="${escapeHtmlAttribute(t('Close'))}">×</button>
        </div>
        <div class="modal-body">
          <div class="form-group">
            <label for="rename-input">${utils.escapeHtml(t('Display Name:'))}</label>
            <input type="text" id="rename-input" class="form-control" maxlength="64" value="${escapeHtmlAttribute(currentName)}" placeholder="${escapeHtmlAttribute(t('Enter custom name'))}">
          </div>
          ${valueSizeControlMarkup}
          ${chartControlMarkup}
          ${cameraPreviewControlMarkup}
          ${trayControlMarkup}
        </div>
        <div class="modal-footer">
          <button id="cancel-rename-btn" class="btn btn-secondary">${utils.escapeHtml(t('Cancel'))}</button>
          <button id="reset-rename-btn" class="btn btn-secondary btn-reset">${utils.escapeHtml(t('Reset to Default'))}</button>
          <button id="save-rename-btn" class="btn btn-primary">${utils.escapeHtml(t('Save'))}</button>
        </div>
      </div>
    `;
    document.body.appendChild(modal);
    applyCloseButtonIcons(modal);

    const input = modal.querySelector('#rename-input');
    const valueSizeSelect = modal.querySelector('#tile-value-size-select');
    const cameraPreviewRefreshSelect = modal.querySelector('#camera-preview-refresh-select');
    const chartTypeSelect = modal.querySelector('#tile-chart-type-select');
    const gaugeRangeGroup = modal.querySelector('#tile-gauge-range-group');
    const gaugeMinInput = modal.querySelector('#tile-gauge-min-input');
    const gaugeMaxInput = modal.querySelector('#tile-gauge-max-input');
    const trayCheckbox = modal.querySelector('#tile-tray-checkbox');
    const trayOptionsGroup = modal.querySelector('#tile-tray-options');
    const trayLabelInput = modal.querySelector('#tile-tray-label');
    const trayColorSelect = modal.querySelector('#tile-tray-color');
    const syncTrayOptionsVisibility = () => {
      if (trayOptionsGroup) trayOptionsGroup.hidden = !trayCheckbox?.checked;
    };
    trayCheckbox?.addEventListener('change', syncTrayOptionsVisibility);
    const saveBtn = modal.querySelector('#save-rename-btn');
    const resetBtn = modal.querySelector('#reset-rename-btn');
    const cancelBtn = modal.querySelector('#cancel-rename-btn');
    const closeBtn = modal.querySelector('.close-btn');

    const syncGaugeRangeVisibility = () => {
      if (!gaugeRangeGroup) return;
      gaugeRangeGroup.hidden =
        normalizeSensorTileChartType(chartTypeSelect?.value || 'line') !== 'gauge';
    };
    if (chartTypeSelect) {
      chartTypeSelect.addEventListener('change', syncGaugeRangeVisibility);
    }

    const readGaugeRangeInputs = () => ({
      min: normalizeGaugeBound(gaugeMinInput?.value ?? ''),
      max: normalizeGaugeBound(gaugeMaxInput?.value ?? ''),
    });
    const gaugeRangesEqual = (a, b) => a.min === b.min && a.max === b.max;

    const refreshQuickAccessAfterTileSettingsChange = () => {
      renderActiveTab();
      if (isReorganizeMode) {
        const container = document.getElementById('quick-controls');
        if (container) container.classList.add('reorganize-mode');
        addRemoveButtons();
      }
    };

    let tileSettingsMutationInFlight = false;
    let tileSettingsModalClosing = false;
    const closeTileSettingsModal = () => {
      if (tileSettingsModalClosing) return;
      tileSettingsModalClosing = true;
      void uiUtils.closeDialog(modal, { remove: true });
    };
    let reenableTileSettings = null;
    const setTileSettingsMutationInFlight = (inFlight) => {
      tileSettingsMutationInFlight = inFlight;
      if (!inFlight) {
        reenableTileSettings?.();
        reenableTileSettings = null;
        return;
      }
      // A save that fails puts the form back for another try, with the keyboard where it was.
      reenableTileSettings = uiUtils.disableControlsKeepingFocus([
        input,
        valueSizeSelect,
        cameraPreviewRefreshSelect,
        chartTypeSelect,
        gaugeMinInput,
        gaugeMaxInput,
        trayCheckbox,
        trayLabelInput,
        trayColorSelect,
        saveBtn,
        resetBtn,
        cancelBtn,
        closeBtn,
      ]);
    };
    const reconcileRecoveredTileSettings = (error) => {
      if (!error?.result?.config?.homeAssistant) return;

      refreshQuickAccessAfterTileSettingsChange();
      const authoritativeName =
        state.CONFIG.customEntityNames?.[entityId] || entity.attributes?.friendly_name || entityId;
      const authoritativeValueSize = getQuickAccessTileValueSize(entityId);
      const authoritativeCameraRefresh = getQuickAccessCameraPreviewRefresh(entityId);
      const authoritativeChartType = getQuickAccessTileChartType(entityId);
      const authoritativeGaugeRange = getQuickAccessTileGaugeRange(entityId);
      const authoritativeTrayEnabled = isEntityInTray(entityId);
      const authoritativeTrayOptions = trayEntitySupport.normalizeTrayEntityOptions(
        state.CONFIG.trayEntities?.[entityId]
      );
      const relevantConfigChanged =
        authoritativeName !== currentName ||
        authoritativeValueSize !== currentValueSize ||
        authoritativeCameraRefresh !== currentCameraPreviewRefresh ||
        authoritativeChartType !== currentChartType ||
        !gaugeRangesEqual(authoritativeGaugeRange, currentGaugeRange) ||
        authoritativeTrayEnabled !== currentTrayEnabled ||
        JSON.stringify(authoritativeTrayOptions) !== JSON.stringify(currentTrayOptions);

      // Preserve the user's retryable form values for an ordinary save failure. If
      // main reports that this tile changed concurrently, show that authoritative
      // state instead of leaving the editor detached from the rendered tile.
      if (relevantConfigChanged) {
        if (input) input.value = authoritativeName;
        if (valueSizeSelect) valueSizeSelect.value = authoritativeValueSize;
        if (cameraPreviewRefreshSelect) {
          cameraPreviewRefreshSelect.value = authoritativeCameraRefresh;
        }
        if (chartTypeSelect) chartTypeSelect.value = authoritativeChartType;
        if (gaugeMinInput) {
          gaugeMinInput.value =
            authoritativeGaugeRange.min === null ? '' : String(authoritativeGaugeRange.min);
        }
        if (gaugeMaxInput) {
          gaugeMaxInput.value =
            authoritativeGaugeRange.max === null ? '' : String(authoritativeGaugeRange.max);
        }
        if (trayCheckbox) trayCheckbox.checked = authoritativeTrayEnabled;
        if (trayLabelInput) trayLabelInput.value = authoritativeTrayOptions.label || '';
        if (trayColorSelect) trayColorSelect.value = authoritativeTrayOptions.color || 'auto';
        syncTrayOptionsVisibility();
        syncGaugeRangeVisibility();
        currentName = authoritativeName;
        currentValueSize = authoritativeValueSize;
        currentCameraPreviewRefresh = authoritativeCameraRefresh;
        currentChartType = authoritativeChartType;
        currentGaugeRange = authoritativeGaugeRange;
        currentTrayEnabled = authoritativeTrayEnabled;
        currentTrayOptions = authoritativeTrayOptions;
      }
    };

    if (saveBtn) {
      saveBtn.onclick = async () => {
        if (tileSettingsMutationInFlight) return;
        const newName = input ? input.value.trim() : '';
        const nextConfig = cloneConfigSnapshot(state.CONFIG);
        let changed = false;
        let renamed = false;

        const friendlyName = state.STATES[entityId]?.attributes?.friendly_name || entityId;
        if (nextConfig.customEntityNames?.[entityId] && (!newName || newName === friendlyName)) {
          // Clearing the field, or typing the Home Assistant name back, hands the tile its own name
          // again instead of quietly keeping the custom one.
          delete nextConfig.customEntityNames[entityId];
          changed = true;
        } else if (newName && newName !== currentName) {
          if (!nextConfig.customEntityNames) {
            nextConfig.customEntityNames = {};
          }
          nextConfig.customEntityNames[entityId] = newName;
          changed = true;
          renamed = true;
        }

        const nextValueSize = hasValueSizeControl
          ? normalizeQuickAccessTileValueSize(valueSizeSelect?.value || 'auto')
          : currentValueSize;
        if (hasValueSizeControl && nextValueSize !== currentValueSize) {
          setQuickAccessTileValueSize(entityId, nextValueSize, nextConfig);
          changed = true;
        }

        const nextCameraPreviewRefresh = hasCameraPreviewControl
          ? camera.normalizeCameraPreviewRefresh(cameraPreviewRefreshSelect?.value || 'off')
          : currentCameraPreviewRefresh;
        if (hasCameraPreviewControl && nextCameraPreviewRefresh !== currentCameraPreviewRefresh) {
          setQuickAccessCameraPreviewRefresh(entityId, nextCameraPreviewRefresh, nextConfig);
          changed = true;
        }

        const nextChartType = hasChartControl
          ? normalizeSensorTileChartType(chartTypeSelect?.value || 'line')
          : currentChartType;
        if (hasChartControl && nextChartType !== currentChartType) {
          setQuickAccessTileChartType(entityId, nextChartType, nextConfig);
          changed = true;
        }

        const nextGaugeRange = hasChartControl ? readGaugeRangeInputs() : currentGaugeRange;
        if (
          hasChartControl &&
          nextGaugeRange.min !== null &&
          nextGaugeRange.max !== null &&
          nextGaugeRange.min >= nextGaugeRange.max
        ) {
          uiUtils.showToast(t('Gauge minimum must be less than the maximum.'), 'error', 3000);
          return;
        }
        if (hasChartControl && !gaugeRangesEqual(nextGaugeRange, currentGaugeRange)) {
          setQuickAccessTileGaugeRange(entityId, nextGaugeRange, nextConfig);
          changed = true;
        }

        const nextTrayEnabled = hasTrayControl ? !!trayCheckbox?.checked : currentTrayEnabled;
        const nextTrayOptions = trayEntitySupport.normalizeTrayEntityOptions({
          label: trayLabelInput?.value,
          color: trayColorSelect?.value || currentTrayOptions.color,
        });
        const trayChanged =
          hasTrayControl &&
          (nextTrayEnabled !== currentTrayEnabled ||
            (nextTrayEnabled &&
              JSON.stringify(nextTrayOptions) !== JSON.stringify(currentTrayOptions)));
        if (trayChanged) {
          setTrayEntityEnabled(entityId, nextTrayEnabled, nextConfig);
          if (nextTrayEnabled) nextConfig.trayEntities[entityId] = nextTrayOptions;
          changed = true;
        }

        if (!changed) {
          closeTileSettingsModal();
          return;
        }

        setTileSettingsMutationInFlight(true);
        try {
          await persistAuthoritativeConfig({
            customEntityNames: nextConfig.customEntityNames || {},
            quickAccessTileOptions: nextConfig.quickAccessTileOptions || {},
            ...(trayChanged ? { trayEntities: nextConfig.trayEntities || {} } : {}),
          });
          refreshQuickAccessAfterTileSettingsChange();
          const toastMessage = renamed
            ? t('Renamed to "{{name}}"', { name: newName })
            : t('Tile settings saved');
          uiUtils.showToast(toastMessage, 'success', 2000);
          closeTileSettingsModal();
        } catch (error) {
          console.error('Failed to save Quick Access tile settings:', error);
          reconcileRecoveredTileSettings(error);
          showConfigPersistenceError(error);
        } finally {
          if (!tileSettingsModalClosing && modal.isConnected) {
            setTileSettingsMutationInFlight(false);
          }
        }
      };
    }

    if (resetBtn) {
      resetBtn.onclick = async () => {
        if (tileSettingsMutationInFlight) return;
        const nextConfig = cloneConfigSnapshot(state.CONFIG);
        let changed = false;

        if (nextConfig.customEntityNames && nextConfig.customEntityNames[entityId]) {
          delete nextConfig.customEntityNames[entityId];
          changed = true;
        }

        const hadValueSizeOverride =
          nextConfig.quickAccessTileOptions?.[entityId]?.valueSize !== undefined;
        if (hadValueSizeOverride) {
          setQuickAccessTileValueSize(entityId, 'auto', nextConfig);
          changed = true;
        }

        const hadCameraPreviewOverride =
          nextConfig.quickAccessTileOptions?.[entityId]?.cameraPreviewRefresh !== undefined;
        if (hadCameraPreviewOverride) {
          setQuickAccessCameraPreviewRefresh(entityId, 'off', nextConfig);
          changed = true;
        }

        const tileOptionsForReset = nextConfig.quickAccessTileOptions?.[entityId];
        if (tileOptionsForReset?.chartType !== undefined) {
          setQuickAccessTileChartType(entityId, 'line', nextConfig);
          changed = true;
        }
        if (
          tileOptionsForReset?.gaugeMin !== undefined ||
          tileOptionsForReset?.gaugeMax !== undefined
        ) {
          setQuickAccessTileGaugeRange(entityId, { min: null, max: null }, nextConfig);
          changed = true;
        }

        const resetTrayOptions =
          hasTrayControl && currentTrayEnabled && Object.keys(currentTrayOptions).length > 0;
        if (resetTrayOptions) {
          nextConfig.trayEntities[entityId] = {};
          changed = true;
        }

        if (!changed) {
          closeTileSettingsModal();
          return;
        }

        setTileSettingsMutationInFlight(true);
        try {
          await persistAuthoritativeConfig({
            customEntityNames: nextConfig.customEntityNames || {},
            quickAccessTileOptions: nextConfig.quickAccessTileOptions || {},
            ...(resetTrayOptions ? { trayEntities: nextConfig.trayEntities } : {}),
          });
          refreshQuickAccessAfterTileSettingsChange();
          uiUtils.showToast(t('Reset tile settings to defaults'), 'info', 2000);
          closeTileSettingsModal();
        } catch (error) {
          console.error('Failed to reset Quick Access tile settings:', error);
          reconcileRecoveredTileSettings(error);
          showConfigPersistenceError(error);
        } finally {
          if (!tileSettingsModalClosing && modal.isConnected) {
            setTileSettingsMutationInFlight(false);
          }
        }
      };
    }

    if (cancelBtn) {
      cancelBtn.onclick = () => {
        if (!tileSettingsMutationInFlight) closeTileSettingsModal();
      };
    }

    if (closeBtn) {
      closeBtn.onclick = () => {
        if (!tileSettingsMutationInFlight) closeTileSettingsModal();
      };
    }

    // The name is what people come here to change, so typing starts there with it selected.
    uiUtils.openDialog(modal, {
      display: null,
      initialFocus: input,
      dismiss: () => {
        if (!tileSettingsMutationInFlight) closeTileSettingsModal();
      },
      // Enter in a field saves, as Enter does in the other forms.
      onEnter: (event) => {
        if (event.target.matches?.('input')) saveBtn?.click();
      },
    });
  } catch (error) {
    console.error('Error showing rename modal:', error);
  }
}

async function removeFromQuickAccess(entityId) {
  try {
    // Removing a graph tile deletes the graph itself — leaving it behind would strand config that
    // has no way back into the UI.
    const nextConfig = isComparisonGraphId(entityId)
      ? removeComparisonGraph(state.CONFIG, entityId)
      : removeEntityFromQuickAccessView(
          state.CONFIG,
          entityId,
          getActiveQuickAccessTab(state.CONFIG)?.id
        );
    const result = await setQuickAccessConfig(nextConfig, { render: false });
    if (!result.success) return result;

    // Re-render
    renderQuickControls();
    if (isReorganizeMode) {
      const container = document.getElementById('quick-controls');
      container.classList.add('reorganize-mode');
      addRemoveButtons();
    }

    uiUtils.showToast(t('Entity removed from Quick Access'), 'success', 2000);
    return result;
  } catch (error) {
    console.error('Error removing from quick access:', error);
    showConfigPersistenceError(error);
    return { success: false, error };
  }
}

function saveQuickAccessOrder(movedItem = null) {
  try {
    const container = document.getElementById('quick-controls');
    if (!container) return;

    const items = Array.from(container.querySelectorAll('.control-item'));
    const movedId = movedItem?.dataset?.entityId || null;

    // Remove any leftover sortable ghost/duplicate elements before saving order
    items.forEach((item) => {
      const entityId = item.dataset.entityId;
      if (item.classList.contains('sortable-ghost')) {
        item.remove();
        return;
      }
      if (movedId && entityId === movedId && item !== movedItem) {
        item.remove();
      }
    });

    const seen = new Set();
    const newOrder = [];

    items.forEach((item) => {
      if (!item.isConnected) return;
      const entityId = item.dataset.entityId;
      if (isDevelopmentClimateOverlayEntity(entityId)) return;
      if (!entityId || seen.has(entityId)) {
        if (item.isConnected) item.remove();
        return;
      }
      seen.add(entityId);
      newOrder.push(entityId);
    });

    const activeTab = getActiveQuickAccessTab(ensureQuickAccessConfig());
    const nextConfig = reorderQuickAccessView(state.CONFIG, activeTab?.id, newOrder);
    const nextTab = getActiveQuickAccessTab(nextConfig);
    if (JSON.stringify(nextTab?.entityIds) === JSON.stringify(activeTab?.entityIds)) return;
    quickAccessOrderChanged = true;

    // Save to config
    setQuickAccessConfig(nextConfig, { render: false });
  } catch (error) {
    console.error('Error saving quick access order:', error);
  }
}

// --- Core UI Rendering ---
function renderActiveTab() {
  try {
    renderPrimaryCards();
    renderQuickControls();
    updateWeatherFromHA();
    updateMediaTile();
    refreshVisibleEntityCache();
    if (Object.keys(state.STATES).length === 0) {
      showNoConnectionMessage();
    }
  } catch (error) {
    console.error('[UI] Error rendering active tab:', error);
  }
}

function updateEntityInUI(entity, options = {}) {
  try {
    ensureEntityCacheScope();
    if (!entity) return;
    const entityId = entity.entity_id;
    climateDialogRefreshers.get(entityId)?.(entity);
    const domain = getEntityDomain(entityId);
    const skipQueueReconcile = options.skipQueueReconcile === true;
    let renderEntity = entity;

    if (!skipQueueReconcile && isOnOffToggleDomain(domain)) {
      if (!isEntityAvailable(entity)) clearPendingOnOffToggle(entityId);
      const desiredState = desiredStateByEntity.get(entityId);
      if (isOnOffStateValue(desiredState)) {
        if (entity.state === desiredState) {
          clearPendingOnOffToggle(entityId);
          emitUiDebug('entity.toggle_finalized', {
            entityId,
            domain,
            state: entity.state,
          });
        } else {
          optimisticStateByEntity.set(entityId, desiredState);
          renderEntity = getEntityForDisplay(entity);
          emitUiDebug('entity.toggle_reconcile_pending', {
            entityId,
            domain,
            receivedState: entity.state,
            desiredState,
          });
        }
      } else if (optimisticStateByEntity.has(entityId)) {
        optimisticStateByEntity.delete(entityId);
      }
    }

    // Keep timer tick eligibility current as visible entity attributes change live.
    refreshVisibleTimerEntityFlag();

    // Update weather card if this is a weather entity
    if (renderEntity.entity_id.startsWith('weather.')) {
      updateWeatherFromHA();
    }

    // Update media tile if this is the primary media player
    if (renderEntity.entity_id === state.CONFIG.primaryMediaPlayer) {
      updateMediaTile();
    }

    // A sensor plotted in a graph usually has no tile of its own, so repaint the graph directly.
    refreshComparisonGraphTiles(renderEntity);

    const items = document.querySelectorAll(
      `.control-item[data-entity-id="${renderEntity.entity_id}"]`
    );
    items.forEach((item) => {
      const isDesktopPin = item.dataset.desktopPin === 'true';
      if (item.dataset.primaryCard === 'true') {
        const card = item.closest('.primary-entity-card');
        if (card) syncPrimaryCardState(card, renderEntity);
      }
      if (isDesktopPin && updateExistingDesktopPinPanelControl(item, renderEntity)) {
        return;
      }
      if (updateExistingMediaPlayerControl(item, renderEntity)) {
        return;
      }
      const isPrimary = item.dataset.primaryCard === 'true';
      const isQuickAccessTile = !isDesktopPin && !isPrimary && !!item.closest('#quick-controls');
      const nextSignature = getControlRenderSignature(renderEntity);
      if (
        item.dataset.renderSignature === nextSignature &&
        updateExistingQuickAccessControl(item, renderEntity, {
          context: isQuickAccessTile ? 'quick-access' : 'default',
        })
      ) {
        return;
      }
      const newControl = isDesktopPin
        ? createDesktopPinControlElement(renderEntity)
        : createControlElement(renderEntity, {
            context: isQuickAccessTile ? 'quick-access' : 'default',
          });
      if (!isDesktopPin) {
        newControl.dataset.renderSignature = nextSignature;
      }
      if (isPrimary) {
        newControl.dataset.primaryCard = 'true';
      }
      // Preserve reorganize-mode classes if active
      if (item.classList.contains('reorganize-mode')) {
        newControl.classList.add('reorganize-mode');
      }
      if (item.classList.contains('camera-preview-tile')) {
        camera.disposeCameraPreview(item);
      }
      const focused = document.activeElement;
      const hadFocus = item.contains(focused);
      const focusedControl = hadFocus
        ? [
            '.rename-btn',
            '.remove-btn',
            '.desktop-pin-quick-toggle',
            '.tile-details-button',
            '.tile-primary-button',
          ].find((selector) => focused.matches(selector))
        : null;
      const wasActive = item.dataset.active === 'true';
      item.replaceWith(newControl);
      if (isQuickAccessTile && !wasActive && newControl.dataset.active === 'true') {
        pulse(newControl.querySelector('.control-icon'));
      }

      // If in reorganize mode, add buttons to the newly created element
      // Note: SortableJS automatically handles drag behavior for all children
      if (isReorganizeMode) {
        addButtonsToElement(newControl);
      }
      if (hadFocus) {
        // Editing buttons must exist before restoring their focus. If an action
        // disappeared, focus the tile rather than a different device action.
        const target = (focusedControl && newControl.querySelector(focusedControl)) || newControl;
        target.tabIndex = 0;
        target.focus();
      }
    });
    syncQuickAccessRovingTabIndex(
      document.activeElement?.closest?.('#quick-controls .control-item')
    );
  } catch (error) {
    console.error('Error updating entity in UI:', error);
  }
}

/**
 * Whether a Quick Access tile is currently doing something — a light that is on, a fan
 * that is running, a player that is playing. Read-only entities (sensors, cameras,
 * calendars) never qualify: there is nothing to be "on".
 * @param {object} entity - The entity behind the tile.
 * @returns {boolean} - True when the tile should read as active.
 */
function isQuickAccessTileActive(entity) {
  const domain = getEntityDomain(entity?.entity_id);
  const entityState = typeof entity?.state === 'string' ? entity.state.trim().toLowerCase() : '';
  if (!domain || !entityState || entityState === 'unavailable' || entityState === 'unknown') {
    return false;
  }

  switch (domain) {
    case 'light':
    case 'switch':
    case 'fan':
    case 'input_boolean':
    case 'siren':
    case 'humidifier':
    case 'script': // "on" only while the script is actually running
      return entityState === 'on';
    case 'media_player':
      return entityState === 'playing';
    case 'climate':
    case 'water_heater':
      return entityState !== 'off';
    case 'cover':
      return entityState === 'open' || entityState === 'opening';
    case 'vacuum':
      return entityState === 'cleaning' || entityState === 'returning';
    default:
      return false;
  }
}

/**
 * The dim status line under a Quick Access tile's name, for the tiles whose layout does not
 * already render one (sensors, timers, lights, climate, media, todo and calendar do). Action
 * tiles (scenes, buttons, idle scripts) have no lasting state worth a line, so they get ''.
 * The words come from the shared state formatter, so a tile reads like the palette and the pins.
 * @param {Object} entity - Home Assistant entity state object.
 * @returns {string}
 */
function getQuickAccessTileStateText(entity) {
  const entityState = typeof entity?.state === 'string' ? entity.state.toLowerCase() : '';
  const domain = getEntityDomain(entity?.entity_id);
  if (!domain) return '';
  if (entityState === 'unavailable') return t('Unavailable');
  // Home Assistant reports a scene or button as `unknown` until its first use; that is not a fault.
  if (entityState === 'unknown')
    return QUICK_ACCESS_ACTIVATE_DOMAINS.has(domain) ? '' : t('Unknown');

  switch (domain) {
    case 'scene':
    case 'button':
    case 'input_button':
      return '';
    case 'script':
      return entityState === 'on' ? t('Active') : '';
    default:
      return utils.getEntityDisplayState(entity);
  }
}

// What a Quick Access tile's click does, for surfaces outside the widget (the Omarchy bar):
// change the entity, run it, or open one of the widget's dialogs. Mirrors
// executeEntityPrimaryAction and toggleEntity; domains missing here do nothing on click.
const QUICK_ACCESS_TOGGLE_DOMAINS = new Set([
  'cover',
  'fan',
  'input_boolean',
  'light',
  'lock',
  'media_player',
  'switch',
  'timer',
]);
const QUICK_ACCESS_ACTIVATE_DOMAINS = new Set(['button', 'input_button', 'scene', 'script']);
const QUICK_ACCESS_HELPER_DOMAINS = new Set([
  'number',
  'input_number',
  'select',
  'input_select',
  'vacuum',
]);
const QUICK_ACCESS_DIALOG_DOMAINS = new Set([
  'calendar',
  'camera',
  'climate',
  'sensor',
  'todo',
  ...QUICK_ACCESS_HELPER_DOMAINS,
]);
// Tiles that carry the adjust button (openEntityControls).
const QUICK_ACCESS_CONTROLS_DOMAINS = new Set(['climate', 'cover', 'fan', 'light', 'media_player']);

function getQuickAccessMediaText(entity) {
  const attributes = entity?.attributes || {};
  if (attributes.media_title) {
    return [attributes.media_title, attributes.media_artist || attributes.media_album_name]
      .filter(Boolean)
      .join(' · ');
  }
  return entity?.state === 'off' || entity?.state === 'idle' ? t('No media') : t('Ready');
}

/**
 * The line under a Quick Access tile's name, as the tile itself shows it, in plain text.
 * @param {Object} entity - Home Assistant entity state object.
 * @returns {string}
 */
function getQuickAccessTileSummaryText(entity) {
  const domain = getEntityDomain(entity?.entity_id);
  if (entity?.state === 'unavailable') return t('Unavailable');
  if (domain === 'timer' || isTimerLikeSensorEntity(entity)) {
    return utils.getTimerDisplay
      ? utils.getTimerDisplay(entity)
      : utils.getEntityDisplayState(entity);
  }
  switch (domain) {
    case 'sensor':
      return getQuickAccessSensorDisplayParts(entity)?.text || utils.getEntityDisplayState(entity);
    case 'light':
    case 'cover':
    case 'fan':
    case 'lock':
      return getDeviceTileStateText(entity);
    case 'climate':
      return utils.getEntityDisplayState(entity);
    case 'media_player':
      return getQuickAccessMediaText(entity);
    case 'todo':
      return getTodoTileCountLabel(entity);
    case 'calendar':
      return getCalendarNextEventSummary(entity);
    default:
      return getQuickAccessTileStateText(entity);
  }
}

// The shell counts down without renderer ticks or Home Assistant state changes.
function getQuickAccessTileCountdown(entity) {
  const domain = getEntityDomain(entity?.entity_id);
  if (domain !== 'timer' && !isTimerLikeSensorEntity(entity)) return null;
  if (utils.getTimerRunState(entity) !== 'running') return null;
  const remaining = utils.getTimerRemainingSeconds(entity);
  if (remaining === null) return null;
  let endsAt = Date.now() + remaining * 1000;
  if (domain === 'timer' && !entity.attributes?.finishes_at) {
    // Remaining describes the duration at the state update, not at publication.
    const updatedAt = Date.parse(entity.last_updated);
    if (Number.isFinite(updatedAt)) endsAt = updatedAt + remaining * 1000;
  }
  return { endsAt, finishedValue: domain === 'sensor' ? t('Finished') : '0:00' };
}

/**
 * Describe a Quick Access tile for another surface (the Omarchy bar plugin), so it can draw the
 * same tile: name, icon, status line, active and unavailable states, and what a click does.
 * @param {string} entityId - A Quick Access entity id.
 * @returns {Object|null} - Null for ids that are not entities (comparison graphs).
 */
function describeQuickAccessTile(entityId) {
  if (typeof entityId !== 'string' || isComparisonGraphId(entityId)) return null;
  const resolvedId = utils.resolveEntityId(entityId, state.STATES) || entityId;
  const entity = getEntityForDisplay(state.STATES?.[resolvedId]);
  if (!entity) {
    return {
      id: entityId,
      name:
        state.CONFIG?.customEntityNames?.[entityId] || entityId.split('.').pop().replace(/_/g, ' '),
      state: '',
      value: t('Unavailable'),
      icon: { kind: 'line', name: 'triangle-alert' },
      available: false,
      missing: true,
      active: false,
      action: 'dialog',
      controls: false,
    };
  }
  const domain = getEntityDomain(entity.entity_id);
  const unavailable = entity.state === 'unavailable';
  const countdown = getQuickAccessTileCountdown(entity);
  let action = 'none';
  if (!unavailable) {
    if (QUICK_ACCESS_DIALOG_DOMAINS.has(domain)) action = 'dialog';
    else if (QUICK_ACCESS_TOGGLE_DOMAINS.has(domain)) action = 'toggle';
    else if (QUICK_ACCESS_ACTIVATE_DOMAINS.has(domain)) action = 'activate';
  }
  return {
    id: entityId,
    name: utils.getEntityDisplayName(entity),
    state: typeof entity.state === 'string' ? entity.state : '',
    value: getQuickAccessTileSummaryText(entity),
    ...(countdown ? { countdown } : {}),
    icon: getEntityIconDescriptor(entity),
    // A scene or button nobody has pressed yet is `unknown` and works fine.
    available:
      !unavailable && (entity.state !== 'unknown' || QUICK_ACCESS_ACTIVATE_DOMAINS.has(domain)),
    missing: false,
    active: isQuickAccessTileActive(entity),
    action,
    controls: !unavailable && QUICK_ACCESS_CONTROLS_DOMAINS.has(domain),
    controlState: unavailable ? null : getQuickAccessTileControls(entity),
  };
}

function finiteOrNull(value) {
  const number = Number(value);
  return value !== null && value !== '' && Number.isFinite(number) ? number : null;
}

/**
 * What a tile's controls can adjust, and where each control stands, for a compact controls popup
 * outside the widget (the Omarchy bar). Covers what the widget's own controls dialog offers.
 * @param {Object} entity - Home Assistant entity state object.
 * @returns {Object|null} - Null for domains without controls.
 */
function getQuickAccessTileControls(entity) {
  const domain = getEntityDomain(entity?.entity_id);
  const attributes = entity?.attributes || {};
  const capabilities = getDesktopPinCapabilities(entity);
  const on = entity?.state === 'on';
  switch (domain) {
    case 'light': {
      const brightness = finiteOrNull(attributes.brightness);
      let colorTemp = null;
      if (supportsLightColorTemp(attributes)) {
        const range = getLightColorTempRange(attributes);
        colorTemp = {
          kelvin: getInitialLightColorTempKelvin(attributes, range),
          min: range.min,
          max: range.max,
        };
      }
      return {
        kind: 'light',
        on,
        brightness: on && brightness > 0 ? Math.max(1, Math.round((brightness / 255) * 100)) : 0,
        canSetBrightness: !!capabilities.canSetBrightness,
        colorTemp,
        colors: supportsLightColor(attributes) ? [...LIGHT_COLOR_PRESETS] : [],
      };
    }
    case 'fan':
      return {
        kind: 'fan',
        on,
        percentage: on ? finiteOrNull(attributes.percentage) || 0 : 0,
        canSetPercentage: !!capabilities.canSetPercentage,
      };
    case 'cover':
      return {
        kind: 'cover',
        state: entity.state,
        position: finiteOrNull(attributes.current_position),
        canSetPosition: !!capabilities.canSetPosition,
        canOpen: !!capabilities.canOpen,
        canClose: !!capabilities.canClose,
        canStop: !!capabilities.canStop,
      };
    case 'climate': {
      const climate = getClimateControlCapabilities(entity);
      return {
        kind: 'climate',
        mode: entity.state,
        current: climate.currentTemp,
        target: climate.targetTemp,
        min: climate.minTemp,
        max: climate.maxTemp,
        step: climate.temperatureStep,
        canSetTemperature: !!climate.canSetTemperature,
        modes: Array.isArray(climate.hvacModes) ? climate.hvacModes.slice(0, 8) : [],
      };
    }
    case 'media_player': {
      const volume = finiteOrNull(attributes.volume_level);
      const features = attributes.supported_features;
      return {
        kind: 'media',
        playing: entity.state === 'playing',
        title: attributes.media_title || '',
        artist: attributes.media_artist || attributes.media_album_name || '',
        canPlay: !!capabilities.canPlay,
        canPause: !!capabilities.canPause,
        canPrevious: !!capabilities.canPreviousTrack,
        canNext: !!capabilities.canNextTrack,
        volume: volume === null ? null : Math.round(clampRange(volume, 0, 1) * 100),
        canSetVolume: uiUtils.hasSupportedFeature(features, MEDIA_PLAYER_SUPPORT_VOLUME_SET),
        muted: attributes.is_volume_muted === true,
        canMute: uiUtils.hasSupportedFeature(features, MEDIA_PLAYER_SUPPORT_VOLUME_MUTE),
      };
    }
    default:
      return null;
  }
}

/**
 * Apply one control from a tile's controls popup outside the widget: the same service calls,
 * capability checks and debouncing the widget's own controls use. Slider values arrive as they
 * are dragged; the debounce sends the last one.
 * @param {Object} entity - Home Assistant entity state object.
 * @param {string} command - e.g. 'brightness', 'color_temp', 'position', 'volume'.
 * @param {*} value - The command's value; main has already checked its type and range.
 * @returns {boolean} - Whether the command applied to this entity.
 */
function executeQuickAccessControl(entity, command, value) {
  const liveEntity = state.STATES?.[entity?.entity_id] || entity;
  const entityId = liveEntity?.entity_id;
  const controls = entityId ? getQuickAccessTileControls(liveEntity) : null;
  if (!controls || liveEntity.state === 'unavailable') return false;
  const number = Number(value);
  switch (`${controls.kind}:${command}`) {
    case 'light:power':
    case 'fan:power':
      if (!!value !== (liveEntity.state === 'on')) toggleEntity(liveEntity);
      return true;
    case 'light:brightness':
      if (!controls.canSetBrightness || !Number.isFinite(number)) return false;
      queueDesktopPinLightBrightness(liveEntity, number);
      return true;
    case 'light:color_temp': {
      if (!controls.colorTemp || !Number.isFinite(number)) return false;
      const kelvin = clampRange(Math.round(number), controls.colorTemp.min, controls.colorTemp.max);
      queueDesktopPinServiceCall(
        `light:${entityId}:color_temp`,
        () => callEntityDomainService(liveEntity, 'turn_on', { color_temp_kelvin: kelvin }),
        150
      );
      return true;
    }
    case 'light:color': {
      const rgb = controls.colors.length ? uiUtils.hexToRgb(String(value)) : null;
      if (!rgb) return false;
      callEntityDomainService(liveEntity, 'turn_on', { rgb_color: [rgb.r, rgb.g, rgb.b] });
      return true;
    }
    case 'fan:percentage':
      if (!controls.canSetPercentage || !Number.isFinite(number)) return false;
      queueDesktopPinFanPercentage(liveEntity, clampRange(Math.round(number), 0, 100));
      return true;
    case 'cover:position':
      if (!controls.canSetPosition || !Number.isFinite(number)) return false;
      queueDesktopPinCoverPosition(liveEntity, clampRange(Math.round(number), 0, 100));
      return true;
    case 'cover:open':
    case 'cover:close':
    case 'cover:stop': {
      const allowed = { open: controls.canOpen, close: controls.canClose, stop: controls.canStop };
      if (!allowed[command]) return false;
      cancelDesktopPinServiceCall(`cover:${entityId}:position`);
      callEntityDomainService(liveEntity, `${command}_cover`);
      return true;
    }
    case 'climate:temperature': {
      if (!controls.canSetTemperature || !Number.isFinite(number)) return false;
      const temperature = clampRange(number, controls.min, controls.max);
      queueDesktopPinServiceCall(
        `climate:${entityId}:temperature`,
        () => callEntityDomainService(liveEntity, 'set_temperature', { temperature }),
        300
      );
      return true;
    }
    case 'climate:mode':
      if (!controls.modes.includes(value)) return false;
      callEntityDomainService(liveEntity, 'set_hvac_mode', { hvac_mode: value });
      return true;
    case 'media:play_pause':
      executeEntityPrimaryAction(liveEntity, { source: 'quick-access-controls' });
      return true;
    case 'media:next':
    case 'media:previous':
      if (!(command === 'next' ? controls.canNext : controls.canPrevious)) return false;
      callMediaPlayerService(entityId, command === 'next' ? 'next_track' : 'previous_track');
      return true;
    case 'media:volume':
      if (!controls.canSetVolume || !Number.isFinite(number)) return false;
      queueDesktopPinServiceCall(
        `media:${entityId}:volume`,
        () =>
          callMediaPlayerService(entityId, 'volume_set', {
            volumeLevel: clampRange(number, 0, 100) / 100,
          }),
        150
      );
      return true;
    case 'media:mute':
      if (!controls.canMute) return false;
      callMediaPlayerService(entityId, 'volume_mute', { isVolumeMuted: !!value });
      return true;
    default:
      return false;
  }
}

/**
 * Set, replace or drop a tile's plain status line in place.
 * @param {HTMLElement} div - The tile.
 * @param {string} text - Status text; '' removes the line.
 */
function setQuickAccessTileStateLine(div, text) {
  const info = div?.querySelector(':scope > .control-info');
  if (!info) return;
  let stateEl = info.querySelector(':scope > .control-state');
  if (!text) {
    stateEl?.remove();
  } else if (!stateEl) {
    stateEl = document.createElement('div');
    stateEl.className = 'control-state';
    info.appendChild(stateEl);
  }
  if (stateEl && text && stateEl.textContent !== text) stateEl.textContent = text;
  // Keep aria-describedby pointing at the readout when the line is added or dropped, including
  // on a tile that first rendered without one.
  linkTileStateReadout(div);
}

function applyQuickAccessTileActiveState(element, entity) {
  if (!element) return;
  const wasActive = element.dataset.active === 'true';
  // An entity Home Assistant reports as unavailable keeps its tile, drawn dimmed.
  if (entity?.state === 'unavailable') element.dataset.unavailable = 'true';
  else delete element.dataset.unavailable;
  if (isQuickAccessTileActive(entity)) {
    element.dataset.active = 'true';
    // Only a tile already on screen that just turned on; new tiles arrive as they are.
    if (!wasActive && element.isConnected) pulse(element.querySelector('.control-icon'));
    return;
  }
  delete element.dataset.active;
}

function getControlRenderSignature(entity) {
  entity = getEntityForDisplay(entity);
  if (!entity || !entity.entity_id) return '';
  const attrs = entity.attributes || {};
  const domain = getEntityDomain(entity.entity_id);
  const isTimerSensor = isTimerLikeSensorEntity(entity);
  const isTimer = entity.entity_id.startsWith('timer.') || isTimerSensor;
  const sensorDisplay =
    entity.entity_id.startsWith('sensor.') && !isTimerSensor
      ? getQuickAccessSensorDisplayParts(entity)
      : null;
  let contentKind = 'default';
  if (isTimer) {
    contentKind = 'timer';
  } else if (domain === 'sensor') {
    contentKind = sensorDisplay ? 'sensor-numeric' : 'sensor';
  } else if (domain === 'media_player') {
    contentKind = 'media';
  } else if (domain === 'light') {
    contentKind =
      entity.state === 'on' && attrs.brightness
        ? 'light-brightness'
        : entity.state !== 'on'
          ? 'light-off'
          : 'light-empty';
  } else if (domain === 'climate') {
    contentKind = getClimateTileTemperature(entity) !== null ? 'climate-temp' : 'climate-empty';
  } else if (domain === 'camera') {
    contentKind = `camera-${getQuickAccessCameraPreviewRefresh(entity.entity_id)}`;
  }
  const hasQuickAccessValueSize = isQuickAccessTileValueSizeApplicable(entity);
  return JSON.stringify({
    entityId: entity.entity_id,
    domain,
    contentKind,
    sensorHasUnit: !!sensorDisplay?.unit,
    span: getTileSpan(entity),
    desktopPinned: !!state.CONFIG?.desktopPins?.[entity.entity_id],
    quickAccessValueSize: hasQuickAccessValueSize
      ? getQuickAccessTileValueSize(entity.entity_id)
      : null,
    // Tiles are reused while this is unchanged; a language switch must redraw their labels.
    locale: getLocaleState().activeLocale || '',
  });
}

function getUnavailableControlSignature(entityId) {
  return JSON.stringify({
    entityId: entityId || '',
    desktopPinned: !!state.CONFIG?.desktopPins?.[entityId],
    unavailable: true,
  });
}

function escapeHtmlAttribute(value) {
  return utils.escapeHtmlAttribute(value);
}

function getTodoActiveCount(items = []) {
  if (!Array.isArray(items)) return 0;
  return items.filter((item) => item?.status === 'needs_action').length;
}

function getServiceEntityPayload(response, entityId) {
  if (!response || typeof response !== 'object') return null;
  if (entityId && response[entityId]) return response[entityId];
  const firstValue = Object.values(response)[0];
  return firstValue && typeof firstValue === 'object' ? firstValue : response;
}

function normalizeTodoItems(response, entityId) {
  const entityPayload = getServiceEntityPayload(response, entityId);
  const items = Array.isArray(entityPayload?.items)
    ? entityPayload.items
    : Array.isArray(response?.items)
      ? response.items
      : [];
  return items.filter((item) => item && typeof item === 'object');
}

function normalizeCalendarEvents(response, entityId) {
  const entityPayload = getServiceEntityPayload(response, entityId);
  const events = Array.isArray(entityPayload?.events)
    ? entityPayload.events
    : Array.isArray(response?.events)
      ? response.events
      : [];
  return events.filter((event) => event && typeof event === 'object');
}

function getEventDateValue(value) {
  if (!value) return null;
  if (typeof value === 'string') return value;
  if (typeof value === 'object') return value.dateTime || value.date_time || value.date || null;
  return null;
}

const timeZoneFormatters = new Map();
// How far a time zone's wall clock is ahead of UTC at an instant, in milliseconds.
function getTimeZoneOffset(instant, timeZone) {
  let formatter = timeZoneFormatters.get(timeZone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat('en-US', {
      timeZone,
      hourCycle: 'h23',
      year: 'numeric',
      month: 'numeric',
      day: 'numeric',
      hour: 'numeric',
      minute: 'numeric',
      second: 'numeric',
    });
    timeZoneFormatters.set(timeZone, formatter);
  }
  const parts = Object.fromEntries(
    formatter.formatToParts(instant).map(({ type, value }) => [type, Number(value)])
  );
  const wallClock = Date.UTC(
    parts.year,
    parts.month - 1,
    parts.day,
    parts.hour,
    parts.minute,
    parts.second
  );
  return wallClock - (instant - (((instant % 1000) + 1000) % 1000));
}

// Calendar entities report start_time as Home Assistant's wall-clock time without an offset. Read
// it in Home Assistant's time zone, so a computer set to another zone still shows the right time.
// Times with an offset, and everything before get_config arrives, parse as usual.
function parseHomeAssistantDateTime(value) {
  const match = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2}))?$/.exec(value);
  const timeZone = state.TIME_ZONE;
  if (!match || !timeZone) return new Date(value);
  // Seconds are optional ("2026-10-01 09:30"); a missing group must read as 0, not NaN.
  const [year, month, day, hour, minute, second] = match.slice(1).map((part) => Number(part ?? 0));
  const wallClock = Date.UTC(year, month - 1, day, hour, minute, second);
  try {
    // Twice, so a time next to a daylight-saving change uses the offset in force at that time.
    let instant = wallClock - getTimeZoneOffset(wallClock, timeZone);
    instant = wallClock - getTimeZoneOffset(instant, timeZone);
    return new Date(instant);
  } catch {
    return new Date(value);
  }
}

function parseCalendarDate(value) {
  const dateValue = getEventDateValue(value);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateValue || '')) return null;
  const [year, month, day] = dateValue.split('-').map(Number);
  return new Date(year, month - 1, day);
}

// Event times read in hours and minutes, following the clock's 12/24-hour setting.
function formatEventTime(date) {
  return formatClockTime(date);
}

// An event's date for a list, with its weekday ("Thu, 10/1/2026").
function formatEventDate(date) {
  return formatDate(date, { weekday: 'short', year: 'numeric', month: 'numeric', day: 'numeric' });
}

function formatDateTimeValue(value, { timeOnly = false } = {}) {
  const dateValue = getEventDateValue(value);
  if (!dateValue) return '--';
  const date = parseHomeAssistantDateTime(dateValue);
  if (Number.isNaN(date.getTime())) return String(dateValue);
  return timeOnly ? formatEventTime(date) : `${formatEventDate(date)} ${formatEventTime(date)}`;
}

// Where a tile's next event falls. Home Assistant's calendar entity reports the next event even
// when it is days away, so a time alone ("10:00 PM") would read as today: any other day gets its
// weekday or date in front ("Tomorrow 10:00 PM", "Thu 10:00 PM", "Oct 12, 10:00 PM").
function formatCalendarTileStart(startTime, { allDay = false, ongoing = false } = {}) {
  const dateValue = getEventDateValue(startTime);
  if (!dateValue) return '';
  const allDayDate = parseCalendarDate(dateValue);
  // Calendar entities report all-day events as a midnight start_time plus all_day: true.
  if (allDay || allDayDate) {
    const day = allDayDate || parseHomeAssistantDateTime(dateValue);
    // An all-day event that is on now says so; on another day its date is what matters.
    if (
      ongoing ||
      Number.isNaN(day.getTime()) ||
      day.toDateString() === new Date().toDateString()
    ) {
      return t('All day');
    }
    return formatDayLabel(day);
  }
  const date = parseHomeAssistantDateTime(dateValue);
  if (Number.isNaN(date.getTime())) return String(dateValue);
  return date.toDateString() === new Date().toDateString()
    ? formatEventTime(date)
    : formatDayAndTime(date);
}

function formatCalendarEventRange(event) {
  const startDate = parseCalendarDate(event?.start || event?.start_time);
  if (startDate) {
    const endDate = parseCalendarDate(event?.end || event?.end_time);
    if (endDate) endDate.setDate(endDate.getDate() - 1);
    const dates =
      endDate && endDate > startDate
        ? `${formatEventDate(startDate)} – ${formatEventDate(endDate)}`
        : formatEventDate(startDate);
    return `${dates} · ${t('All day')}`;
  }
  const startValue = event?.start || event?.start_time;
  const endValue = event?.end || event?.end_time;
  const startAt = parseHomeAssistantDateTime(getEventDateValue(startValue) || NaN);
  const endAt = parseHomeAssistantDateTime(getEventDateValue(endValue) || NaN);
  // An event that ends the same day shows its date once.
  const sameDay =
    !Number.isNaN(startAt.getTime()) &&
    !Number.isNaN(endAt.getTime()) &&
    startAt.toDateString() === endAt.toDateString();
  const start = formatDateTimeValue(startValue);
  const end = formatDateTimeValue(endValue, { timeOnly: sameDay });
  if (!end || end === '--') return start;
  return `${start} – ${end}`;
}

// Sensors that count down (a kitchen timer), not readings; see isTimerLikeSensor.
function isTimerLikeSensorEntity(entity) {
  return utils.isTimerLikeSensor(entity);
}

function isQuickAccessTileValueSizeApplicable(entity) {
  const displayEntity = getEntityForDisplay(entity);
  if (!displayEntity?.entity_id) return false;

  if (displayEntity.entity_id.startsWith('sensor.')) return true;
  if (displayEntity.entity_id.startsWith('timer.')) return true;

  if (displayEntity.entity_id.startsWith('light.')) {
    if (displayEntity.state !== 'on') return true;
    const brightnessValue = Number(displayEntity.attributes?.brightness);
    return Number.isFinite(brightnessValue) && brightnessValue >= 0;
  }

  if (displayEntity.entity_id.startsWith('climate.')) {
    return getClimateTileTemperature(displayEntity) !== null;
  }

  return false;
}

function isQuickAccessSensorChartApplicable(entity) {
  const displayEntity = getEntityForDisplay(entity) || entity;
  return !!getQuickAccessSensorDisplayParts(displayEntity);
}

// A sensor whose state is a plain number, so it can have a chart and a gauge. Codes with leading
// zeros ("02134") and forms like "1e3" are text.
function isFiniteNumericSensorState(entity) {
  return parseNumericState(entity?.state) !== null;
}

// The value, unit and text of a numeric sensor, rounded as the user's locale and the sensor's
// precision say; see getSensorReading.
function getQuickAccessSensorDisplayParts(entity) {
  return getSensorReading(entity);
}

function getSensorHistoryCacheEntry(entityId) {
  ensureEntityCacheScope();
  if (!sensorHistoryCache.has(entityId)) {
    sensorHistoryCache.set(entityId, {
      series: [],
      lastFetchAt: 0,
      promise: null,
    });
  }
  return sensorHistoryCache.get(entityId);
}

/**
 * When a reading was taken.
 *
 * `last_changed` moves only when the STATE changes; `last_updated` moves whenever anything about
 * the entity does, attributes included. For a series read out of an attribute — a weather entity's
 * temperature, a climate entity's current_temperature — the temperature can climb all morning while
 * the state ("partlycloudy", "heat") never moves, so `last_changed` is stale and would file every
 * new reading under the hour the sky last changed. Attribute-backed series therefore date their
 * readings by `last_updated`.
 *
 * State-backed series keep preferring `last_changed`: it is when the plotted value itself changed,
 * so an unrelated attribute edit doesn't restamp a reading that never moved.
 *
 * @param {Object} entry - A Home Assistant state object, or a history row.
 * @param {{preferLastUpdated?: boolean}} [options] - True for attribute-backed series.
 * @returns {number} Epoch milliseconds.
 */
function parseSensorHistoryTimestamp(entry, { preferLastUpdated = false } = {}) {
  // Compressed history rows carry `lu` (last_updated) and no `last_changed` at all.
  if (typeof entry?.lu === 'number' && Number.isFinite(entry.lu)) {
    return entry.lu * 1000;
  }

  const rawTimestamp = preferLastUpdated
    ? entry?.last_updated || entry?.last_changed
    : entry?.last_changed || entry?.last_updated;
  if (typeof rawTimestamp === 'number' && Number.isFinite(rawTimestamp)) {
    return rawTimestamp > 100000000000 ? rawTimestamp : rawTimestamp * 1000;
  }

  if (typeof rawTimestamp === 'string') {
    const parsed = Date.parse(rawTimestamp);
    if (Number.isFinite(parsed)) return parsed;
  }

  return Date.now();
}

function normalizeSensorHistoryResponse(response, entityId, { allowBareArray = true } = {}) {
  const result = response?.result ?? response;
  // Home Assistant keys the result by entity id. The bare-array shape is a fallback, and is only
  // safe for a single-entity request — in a batch it would hand every sensor the same series.
  const entries =
    allowBareArray && Array.isArray(result)
      ? result
      : Array.isArray(result?.[entityId])
        ? result[entityId]
        : [];

  // Attribute-backed series (a weather entity's temperature) read the number out of the
  // attributes rather than the state.
  const attribute = getGraphSeriesAttribute(entityId);
  let lastAttributes = null;

  return entries
    .map((entry) => {
      let rawValue;
      if (attribute) {
        // History omits unchanged attributes, so carry the last known set forward.
        const attributes = entry?.a ?? entry?.attributes;
        if (attributes) lastAttributes = attributes;
        rawValue = lastAttributes?.[attribute];
      } else {
        rawValue = entry?.s ?? entry?.state;
      }

      // Not Number(): a missing or unavailable reading must stay missing rather than becoming a 0
      // that reads as a real measurement and drags the shared scale with it.
      const value = toFiniteNumber(rawValue);
      if (value === null) return null;
      return {
        value,
        timestamp: parseSensorHistoryTimestamp(entry, { preferLastUpdated: !!attribute }),
      };
    })
    .filter(Boolean)
    .sort((a, b) => a.timestamp - b.timestamp);
}

function assertSuccessfulWebSocketResponse(response, fallbackMessage) {
  if (response?.success !== false) return response;
  const message =
    response?.error?.message ||
    response?.error ||
    response?.message ||
    fallbackMessage ||
    'Home Assistant request failed';
  throw new Error(String(message));
}

/**
 * Drops samples older than the 24h window, but KEEPS the newest sample at or before the cutoff.
 *
 * That boundary sample is the entity's state at the start of the window (Home Assistant sends it
 * as the first row). Discarding it meant each line began at its own first *change* instead of at
 * the window edge, so lines started at different x positions and couldn't be compared. A Home
 * Assistant state persists until it changes, so this sample is what the entity read at the start
 * of the window.
 *
 * @param {Array<{value: number, timestamp: number}>} series
 * @param {number} [now]
 * @returns {Array<{value: number, timestamp: number}>} Chronological samples.
 */
function pruneSensorHistorySeries(series, now = Date.now()) {
  const cutoff = now - SENSOR_HISTORY_WINDOW_MS;
  const valid = (Array.isArray(series) ? series : [])
    .filter((point) => point && Number.isFinite(point.value) && Number.isFinite(point.timestamp))
    .sort((a, b) => a.timestamp - b.timestamp);

  const inWindow = valid.filter((point) => point.timestamp >= cutoff);
  const boundary = valid.filter((point) => point.timestamp < cutoff).pop();

  return boundary ? [boundary, ...inWindow] : inWindow;
}

/**
 * Fetches 24h history for several entities in a SINGLE Home Assistant request, and writes each
 * series into the shared per-entity cache. Entities that were fetched recently, or that already
 * have a request in flight, are served from cache rather than re-requested.
 *
 * @param {string[]} entityIds
 * @returns {Promise<Map<string, Array<{value:number, timestamp:number}>>>}
 */
async function fetchSensorHistoryBatch(entityIds) {
  const generation = ensureEntityCacheScope();
  const ids = [
    ...new Set(
      (Array.isArray(entityIds) ? entityIds : []).filter(
        (entityId) => typeof entityId === 'string' && entityId
      )
    ),
  ];
  if (!ids.length) return new Map();

  const now = Date.now();
  const inFlight = [];
  const stale = [];

  ids.forEach((entityId) => {
    const entry = getSensorHistoryCacheEntry(entityId);
    if (entry.promise) {
      inFlight.push(entry.promise);
      return;
    }
    if (entry.lastFetchAt && now - entry.lastFetchAt < SENSOR_HISTORY_REFRESH_THROTTLE_MS) return;
    stale.push(entityId);
  });

  const collect = () => {
    const seriesByEntity = new Map();
    if (generation !== ensureEntityCacheScope()) return seriesByEntity;
    ids.forEach((entityId) => {
      seriesByEntity.set(entityId, getSensorHistoryCacheEntry(entityId).series);
    });
    return seriesByEntity;
  };

  if (stale.length && typeof websocket.request !== 'function') {
    stale.forEach((entityId) => {
      getSensorHistoryCacheEntry(entityId).lastFetchAt = now;
    });
    stale.length = 0;
  }

  // Tiles render before the socket is open. Firing a request now would only be rejected, so skip it
  // — and deliberately don't stamp the throttle, so the next render retries once connected.
  if (stale.length && typeof websocket.isConnected === 'function' && !websocket.isConnected()) {
    stale.length = 0;
  }

  if (!stale.length) {
    await Promise.all(inFlight);
    return collect();
  }

  const end = new Date(now);
  const start = new Date(now - SENSOR_HISTORY_WINDOW_MS);

  // Attribute-backed series (weather/climate temperatures) need the attributes in the response, so
  // they can't share a request with plain state series, which fetch far less data.
  const stateIds = stale.filter((entityId) => !getGraphSeriesAttribute(entityId));
  const attributeIds = stale.filter((entityId) => getGraphSeriesAttribute(entityId));

  /**
   * Issues one history request for a batch of entities and writes the results into the cache.
   * The returned promise is stored on each entry so concurrent callers share it instead of
   * re-requesting.
   *
   * @param {string[]} batchIds - Entity IDs to fetch in this request.
   * @param {boolean} withAttributes - Whether the response must include attributes.
   * @returns {Promise<void>} Resolves once the cache has been updated.
   */
  const runRequest = (batchIds, withAttributes) => {
    let request;

    const run = async () => {
      try {
        const response = assertSuccessfulWebSocketResponse(
          await websocket.request({
            type: 'history/history_during_period',
            start_time: start.toISOString(),
            end_time: end.toISOString(),
            entity_ids: batchIds,
            minimal_response: !withAttributes,
            no_attributes: !withAttributes,
            // The entity's state at the start of the window, so every line can be drawn from the
            // left edge rather than from its own first change.
            include_start_time_state: true,
            // Home Assistant defaults this to true, which drops rows its per-domain "significant
            // change" rules consider uninteresting. For a weather entity only a CONDITION change is
            // significant, so a temperature drifting 22°->31° under an unchanged sky records nothing
            // — the outside series came back with 4 points a day. Ask for every recorded row.
            significant_changes_only: false,
          }),
          'Home Assistant history request failed'
        );

        if (generation !== ensureEntityCacheScope()) return;
        const completedAt = Date.now();
        batchIds.forEach((entityId) => {
          const entry = getSensorHistoryCacheEntry(entityId);
          entry.series = pruneSensorHistorySeries(
            normalizeSensorHistoryResponse(response, entityId, {
              allowBareArray: batchIds.length === 1,
            }),
            completedAt
          );
          // Only a SUCCESSFUL fetch starts the refresh throttle. Tiles render before the WebSocket
          // is open, so the first attempt is rejected with "not connected"; stamping that failure
          // would leave the chart empty for the full five minutes.
          entry.lastFetchAt = completedAt;
        });
      } catch (error) {
        // Keep whatever is cached and leave the throttle untouched so the next render retries.
        // The tile shows its "waiting for history" state, so the user still gets feedback.
        console.warn('Sensor history request failed:', error);
      } finally {
        if (generation === ensureEntityCacheScope())
          batchIds.forEach((entityId) => {
            const entry = getSensorHistoryCacheEntry(entityId);
            if (entry.promise === request) entry.promise = null;
          });
      }
    };

    request = run();
    batchIds.forEach((entityId) => {
      getSensorHistoryCacheEntry(entityId).promise = request;
    });

    return request;
  };

  const requests = [];
  if (stateIds.length) requests.push(runRequest(stateIds, false));
  if (attributeIds.length) requests.push(runRequest(attributeIds, true));

  await Promise.all([...requests, ...inFlight]);
  return collect();
}

/**
 * Fetches 24h history for a single entity.
 *
 * @param {string} entityId
 * @returns {Promise<Array<{value: number, timestamp: number}>>} Chronological samples.
 */
async function fetchSensorHistory(entityId) {
  if (!entityId) return [];
  const seriesByEntity = await fetchSensorHistoryBatch([entityId]);
  return seriesByEntity.get(entityId) || [];
}

function appendLiveSensorHistoryValue(entity) {
  if (!entity?.entity_id || !isFiniteNumericSensorState(entity)) return;
  const entry = sensorHistoryCache.get(entity.entity_id);
  if (!entry) return;

  const value = Number(entity.state);
  const timestamp = parseSensorHistoryTimestamp(entity);
  const previous = entry.series[entry.series.length - 1];
  if (previous && previous.timestamp === timestamp && previous.value === value) return;

  entry.series = pruneSensorHistorySeries([...entry.series, { value, timestamp }]);
}

function createSensorSparklineSvg(series, { width, height, className }) {
  const values = Array.isArray(series) ? series.map((point) => point.value) : [];
  const points = buildSparklinePoints(values, width, height);
  if (!points) return null;

  const svg = document.createElementNS(SENSOR_SPARKLINE_SVG_NS, 'svg');
  svg.setAttribute('class', className);
  svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
  svg.setAttribute('preserveAspectRatio', 'none');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('focusable', 'false');

  const polyline = document.createElementNS(SENSOR_SPARKLINE_SVG_NS, 'polyline');
  polyline.setAttribute('points', points);
  polyline.setAttribute('fill', 'none');
  polyline.setAttribute('stroke', 'currentColor');
  polyline.setAttribute('stroke-width', values.length === 1 ? '0' : '2');
  polyline.setAttribute('stroke-linecap', 'round');
  polyline.setAttribute('stroke-linejoin', 'round');
  svg.appendChild(polyline);

  if (values.length === 1) {
    const [x, y] = points.split(',').map(Number);
    const dot = document.createElementNS(SENSOR_SPARKLINE_SVG_NS, 'circle');
    dot.setAttribute('cx', String(x));
    dot.setAttribute('cy', String(y));
    dot.setAttribute('r', '2');
    dot.setAttribute('fill', 'currentColor');
    svg.appendChild(dot);
  }

  return svg;
}

function createSensorGaugeSvg(entity, series, customRange) {
  const range = resolveGaugeRange(entity, {
    series,
    min: customRange?.min ?? null,
    max: customRange?.max ?? null,
  });
  const fraction = clampGaugeFraction(entity.state, range.min, range.max);
  const arc = buildGaugeArc({
    width: SENSOR_TILE_GAUGE_WIDTH,
    height: SENSOR_TILE_GAUGE_HEIGHT,
    fraction,
    strokeWidth: SENSOR_TILE_GAUGE_STROKE_WIDTH,
  });

  const svg = document.createElementNS(SENSOR_SPARKLINE_SVG_NS, 'svg');
  svg.setAttribute('class', 'control-sensor-gauge-svg');
  svg.setAttribute('viewBox', `0 0 ${SENSOR_TILE_GAUGE_WIDTH} ${SENSOR_TILE_GAUGE_HEIGHT}`);
  svg.setAttribute('preserveAspectRatio', 'xMidYMax meet');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('focusable', 'false');
  svg.setAttribute('data-gauge-source', range.source);
  svg.setAttribute('data-gauge-min', String(range.min));
  svg.setAttribute('data-gauge-max', String(range.max));
  svg.setAttribute('data-gauge-fraction', fraction.toFixed(3));
  // The arc runs left to right whatever the language, and text-anchor follows the writing
  // direction: in a right-to-left page the bound labels would grow into the arc.
  svg.style.direction = 'ltr';

  const track = document.createElementNS(SENSOR_SPARKLINE_SVG_NS, 'path');
  track.setAttribute('class', 'control-sensor-gauge-track');
  track.setAttribute('d', arc.trackPath);
  svg.appendChild(track);

  if (arc.valuePath) {
    const value = document.createElementNS(SENSOR_SPARKLINE_SVG_NS, 'path');
    value.setAttribute('class', 'control-sensor-gauge-value');
    value.setAttribute('d', arc.valuePath);
    svg.appendChild(value);
  }

  const marker = document.createElementNS(SENSOR_SPARKLINE_SVG_NS, 'circle');
  marker.setAttribute('class', 'control-sensor-gauge-marker');
  marker.setAttribute('cx', String(arc.endX));
  marker.setAttribute('cy', String(arc.endY));
  marker.setAttribute('r', '3');
  svg.appendChild(marker);

  const minLabel = document.createElementNS(SENSOR_SPARKLINE_SVG_NS, 'text');
  minLabel.setAttribute('class', 'control-sensor-gauge-bound');
  minLabel.setAttribute('x', String(arc.cx - arc.radius - 4));
  minLabel.setAttribute('y', String(arc.cy + 3));
  minLabel.setAttribute('text-anchor', 'end');
  minLabel.textContent = formatGaugeBoundLabel(range.min);
  svg.appendChild(minLabel);

  const maxLabel = document.createElementNS(SENSOR_SPARKLINE_SVG_NS, 'text');
  maxLabel.setAttribute('class', 'control-sensor-gauge-bound');
  maxLabel.setAttribute('x', String(arc.cx + arc.radius + 4));
  maxLabel.setAttribute('y', String(arc.cy + 3));
  maxLabel.setAttribute('text-anchor', 'start');
  maxLabel.textContent = formatGaugeBoundLabel(range.max);
  svg.appendChild(maxLabel);

  return svg;
}

/**
 * Render (or clear) the chart band of a numeric sensor tile according to its chart type.
 * `series` may be empty: the gauge only needs the live value, the line chart then draws nothing.
 */
function renderSensorTileChart(tile, entity, series = []) {
  const entityId = entity?.entity_id;
  if (!tile || !entityId || tile.dataset.entityId !== entityId) return;
  const info = tile.querySelector('.control-info');
  if (!info) return;

  const chartType = getQuickAccessTileChartType(entityId);
  tile.dataset.chartType = chartType;
  info.querySelector('.control-sensor-sparkline')?.remove();
  info.querySelector('.control-sensor-gauge')?.remove();
  if (chartType === 'none') return;

  if (chartType === 'gauge') {
    const gauge = document.createElement('div');
    gauge.className = 'control-sensor-gauge';
    gauge.appendChild(createSensorGaugeSvg(entity, series, getQuickAccessTileGaugeRange(entityId)));
    info.appendChild(gauge);
    return;
  }

  const svg = createSensorSparklineSvg(series, {
    width: SENSOR_TILE_SPARKLINE_WIDTH,
    height: SENSOR_TILE_SPARKLINE_HEIGHT,
    className: 'control-sensor-sparkline-svg',
  });
  if (!svg) return;

  const sparkline = document.createElement('div');
  sparkline.className = 'control-sensor-sparkline';
  sparkline.appendChild(svg);
  info.appendChild(sparkline);
}

/**
 * Draws a number that is wider than its tile smaller, down to a floor, so it keeps all its digits
 * ('123,456.79' cut to '123,456…' reads as a smaller number than it is). The ellipsis stays as the
 * last resort.
 *
 * @param {HTMLElement} readout - The tile's `.control-sensor-readout`.
 */
function fitSensorTileValue(readout) {
  const value = readout?.querySelector('.control-sensor-value');
  if (!value?.isConnected) return;
  value.style.removeProperty('font-size');
  const fitted = getFittedSensorValueFontSize({
    fontSize: parseFloat(getComputedStyle(value).fontSize),
    naturalWidth: value.scrollWidth,
    availableWidth: value.clientWidth,
  });
  if (fitted !== null) value.style.fontSize = `${fitted}px`;
  readout.dataset.fitWidth = String(readout.clientWidth);
  readout.dataset.fitSize = readout.closest('.control-item')?.dataset.valueSize || '';
}

// Refits a reading when its tile's width changes (a resize, a different number of columns). The
// height changes with the font size, so only a change of width counts, or fitting would loop.
const sensorValueFitObserver =
  typeof ResizeObserver === 'function'
    ? new ResizeObserver((entries) => {
        // Fitting changes layout, which an observer must not do while it is being delivered.
        requestAnimationFrame(() => {
          for (const { target } of entries) {
            if (target.dataset.fitWidth !== String(target.clientWidth)) fitSensorTileValue(target);
          }
        });
      })
    : null;

function observeSensorTileValueFit(tile) {
  const readout = tile?.querySelector('.control-sensor-readout');
  if (readout) sensorValueFitObserver?.observe(readout);
}

function mountSensorTileChart(tile, entity) {
  const generation = ensureEntityCacheScope();
  if (!tile || !entity?.entity_id || !isFiniteNumericSensorState(entity)) return;
  const chartType = getQuickAccessTileChartType(entity.entity_id);
  tile.dataset.chartType = chartType;
  if (chartType === 'none') return;

  const entry = sensorHistoryCache.get(entity.entity_id);
  if (entry?.series?.length || chartType === 'gauge') {
    renderSensorTileChart(tile, entity, entry?.series || []);
  }

  fetchSensorHistory(entity.entity_id).then((series) => {
    if (generation !== ensureEntityCacheScope() || !tile.isConnected) return;
    const latest = state.STATES?.[entity.entity_id] || entity;
    renderSensorTileChart(tile, isFiniteNumericSensorState(latest) ? latest : entity, series);
  });
}

function renderSensorDetailSparkline(container, series, timeDomain) {
  container.replaceChildren();
  const stats = summarizeHistory(series);
  container.hidden = !stats;
  if (!stats) return;
  const padding = Math.max((stats.max - stats.min) * 0.05, Math.abs(stats.max) * 0.01, 0.01);
  // A reading holds until the next one, so carry the last value on to "now". A period with a
  // single sample then draws a flat line instead of one dot at the far end.
  const last = series.findLast((point) => Number.isFinite(point.value));
  const drawn =
    Number.isFinite(timeDomain?.end) && last.timestamp < timeDomain.end
      ? [...series, { value: last.value, timestamp: timeDomain.end }]
      : series;
  const points = buildTimeSeriesPoints(drawn, {
    timeDomain,
    valueDomain: { min: stats.min - padding, max: stats.max + padding },
    width: SENSOR_DETAIL_SPARKLINE_WIDTH,
    height: SENSOR_DETAIL_SPARKLINE_HEIGHT,
  });
  const svg = createSvgElement('svg', {
    class: 'sensor-detail-sparkline-svg',
    viewBox: `0 0 ${SENSOR_DETAIL_SPARKLINE_WIDTH} ${SENSOR_DETAIL_SPARKLINE_HEIGHT}`,
    preserveAspectRatio: 'none',
    'aria-hidden': 'true',
  });
  svg.append(
    createSvgElement('polyline', {
      points,
      fill: 'none',
      stroke: 'currentColor',
      'stroke-width': '2',
    })
  );
  if (series.length === 1) {
    const [cx, cy] = points.split(' ')[0].split(',');
    svg.append(createSvgElement('circle', { cx, cy, r: '3', fill: 'currentColor' }));
  }
  container.append(svg);
}

// ---------------------------------------------------------------------------
// Comparison graph tiles
// ---------------------------------------------------------------------------

/**
 * Looks up a comparison graph in the current config.
 *
 * @param {string} graphId - The graph's synthetic entity ID (`graph:…`).
 * @returns {?{id: string, name: string, span: number, entityIds: string[]}} Null if it no longer exists.
 */
function getComparisonGraphById(graphId) {
  return getComparisonGraph(state.CONFIG || {}, graphId);
}

/**
 * Resolves a graph's configured entities into drawable series. The colour slot comes from the
 * entity's index in the persisted list, so hiding or failing to resolve one series never
 * repaints the others.
 */
function getComparisonGraphSeries(graph) {
  const entityIds = Array.isArray(graph?.entityIds) ? graph.entityIds : [];
  const fallbackTemperatureUnit = state.UNIT_SYSTEM?.temperature || '';

  return entityIds.map((entityId, index) => {
    const entity = state.STATES?.[entityId] || null;
    return {
      entityId,
      entity,
      colorSlot: getSeriesColorSlot(index),
      name: entity ? utils.getEntityDisplayName(entity) : entityId,
      unit: readGraphSeriesUnit(entity, { fallbackTemperatureUnit }),
      value: readGraphSeriesValue(entity),
      series: sensorHistoryCache.get(entityId)?.series || [],
    };
  });
}

/**
 * Creates an SVG element with the given attributes.
 *
 * @param {string} name - SVG tag name (e.g. `polyline`).
 * @param {Object<string, (string|number)>} [attributes]
 * @returns {SVGElement}
 */
function createSvgElement(name, attributes = {}) {
  const node = document.createElementNS(SENSOR_SPARKLINE_SVG_NS, name);
  Object.entries(attributes).forEach(([key, value]) => {
    node.setAttribute(key, String(value));
  });
  return node;
}

/**
 * Builds the multi-series SVG plot: one polyline per series, all projected onto a shared time axis
 * and a shared value domain.
 *
 * @param {Array<Object>} entries - Resolved series from getComparisonGraphSeries().
 * @returns {?{svg: SVGElement, crosshair: SVGElement, timeDomain: Object, plotWidth: number}}
 *   Null when there is nothing plottable yet.
 */
function buildComparisonGraphPlot(entries) {
  const plotWidth = COMPARISON_GRAPH_WIDTH - COMPARISON_GRAPH_INSET * 2;
  const plotHeight = COMPARISON_GRAPH_HEIGHT - COMPARISON_GRAPH_INSET * 2;
  const timeDomain = computeTimeDomain({ now: Date.now(), windowMs: SENSOR_HISTORY_WINDOW_MS });
  if (!timeDomain) return null;

  // Sensors report at different times, so a line's samples rarely reach either edge. Split each
  // series into what was measured and what is merely held, so both edges can be drawn (making the
  // series comparable at the start and at "now") while staying visibly distinct from real data.
  const plotted = entries.map((entry) => ({
    ...entry,
    spans: splitSeriesAtWindow(entry.series, timeDomain),
  }));

  // One value domain per unit. Series in the same unit share a domain, so their real offset shows;
  // a series in a different unit (a humidity beside temperatures) is scaled against its own kind
  // instead of being crushed into a sliver by a domain it has no business sharing. This is what the
  // editor's mixed-unit warning promises the user.
  const domainByEntityId = computeValueDomainsByUnit(
    plotted.map((entry) => ({
      entityId: entry.entityId,
      unit: entry.unit,
      points: [...entry.spans.lead, ...entry.spans.measured, ...entry.spans.trail],
    }))
  );
  if (!domainByEntityId.size) return null;

  const svg = createSvgElement('svg', {
    class: 'comparison-graph-svg',
    viewBox: `0 0 ${COMPARISON_GRAPH_WIDTH} ${COMPARISON_GRAPH_HEIGHT}`,
    preserveAspectRatio: 'none',
    'aria-hidden': 'true',
    focusable: 'false',
  });

  const plot = createSvgElement('g', {
    transform: `translate(${COMPARISON_GRAPH_INSET}, ${COMPARISON_GRAPH_INSET})`,
  });

  const crosshair = createSvgElement('line', {
    class: 'comparison-graph-crosshair',
    y1: 0,
    y2: plotHeight,
    x1: 0,
    x2: 0,
    visibility: 'hidden',
  });
  plot.appendChild(crosshair);

  let drew = false;
  plotted.forEach((entry) => {
    // Absent when the series has no plottable points — there is no scale to draw it against.
    const valueDomain = domainByEntityId.get(entry.entityId);
    if (!valueDomain) return;

    const stroke = `var(--chart-series-${entry.colorSlot})`;
    const project = (span) =>
      buildTimeSeriesPoints(span, {
        timeDomain,
        valueDomain,
        width: plotWidth,
        height: plotHeight,
      });

    const drawSpan = (span, { held }) => {
      const points = project(span);
      if (!points) return null;

      const coords = points.split(' ');
      const firstX = Number(coords[0].split(',')[0]);
      const lastX = Number(coords[coords.length - 1].split(',')[0]);
      // A span narrower than a pixel (a sensor that reported seconds ago) would only add a stray
      // dash at the edge. Keep it in the data — for the end dot — but don't draw it.
      const visible = coords.length >= 2 && Math.abs(lastX - firstX) >= 0.5;

      if (visible || !held) drew = true;
      if (!visible) return points;

      plot.appendChild(
        createSvgElement('polyline', {
          class: held
            ? 'comparison-graph-line comparison-graph-line-held'
            : 'comparison-graph-line',
          points,
          fill: 'none',
          stroke,
          'stroke-width': 2,
          'stroke-linecap': 'round',
          'stroke-linejoin': 'round',
        })
      );
      return points;
    };

    // Held spans are dashed: the value is known (a state persists until it changes) but nothing was
    // recorded there, and drawing it like real data would overstate what we know.
    drawSpan(entry.spans.lead, { held: true });
    drawSpan(entry.spans.measured, { held: false });
    const trail = drawSpan(entry.spans.trail, { held: true });

    // End dot at "now", ringed in the surface colour so overlapping sensors stay legible.
    const endPoints = trail || project(entry.spans.measured);
    if (!endPoints) return;
    const [endX, endY] = endPoints.split(' ').at(-1).split(',').map(Number);
    plot.appendChild(
      createSvgElement('circle', {
        class: 'comparison-graph-end-dot',
        cx: endX,
        cy: endY,
        r: 3,
        fill: stroke,
      })
    );
  });

  if (!drew) return null;

  svg.appendChild(plot);
  return { svg, crosshair, timeDomain, plotWidth };
}

// One decimal everywhere a graph shows a reading, so the legend and the hover tooltip agree and a
// value just below zero is not "-0".
function formatGraphReading(value, unit) {
  return joinUnit(formatReadingNumber(value, { maximum: 1 }), unit);
}

/**
 * Formats a series' current value for the legend.
 *
 * @param {Object} entry - A resolved series.
 * @returns {string} e.g. `21.4 °C`, or a placeholder when the entity has no numeric value.
 */
function formatComparisonGraphValue(entry) {
  if (entry.value === null || entry.value === undefined) return t('No data');
  return formatGraphReading(entry.value, entry.unit);
}

/**
 * Builds the legend: a colour swatch, name and live value per series.
 *
 * The legend is required, not decorative — several series colours fall below 3:1 contrast on the
 * light surface, so the visible name is what carries identity. Text stays in text tokens; the
 * colour lives in the swatch beside it, never in the text.
 *
 * @param {Array<Object>} entries - Resolved series.
 * @returns {HTMLElement}
 */
function buildComparisonGraphLegend(entries) {
  const legend = document.createElement('div');
  legend.className = 'comparison-graph-legend';

  entries.forEach((entry) => {
    const row = document.createElement('div');
    row.className = 'comparison-graph-legend-item';

    const swatch = document.createElement('span');
    swatch.className = 'comparison-graph-swatch';
    swatch.style.background = `var(--chart-series-${entry.colorSlot})`;

    const name = document.createElement('span');
    name.className = 'comparison-graph-legend-name';
    name.textContent = entry.name;

    const value = document.createElement('span');
    value.className = 'comparison-graph-legend-value';
    value.textContent = formatComparisonGraphValue(entry);

    row.appendChild(swatch);
    row.appendChild(name);
    row.appendChild(value);
    legend.appendChild(row);
  });

  return legend;
}

/**
 * Wires the crosshair and tooltip. The crosshair finds the time; the tooltip then lists EVERY
 * series at that time, so the pointer never has to land on a 2px line to read a value.
 *
 * @param {HTMLElement} frame - The positioned container the tooltip is placed in.
 * @param {{svg: SVGElement, crosshair: SVGElement, timeDomain: Object, plotWidth: number}} plot
 * @param {Array<Object>} entries - Resolved series.
 * @returns {void}
 */
function attachComparisonGraphHover(frame, plot, entries) {
  const { svg, crosshair, timeDomain, plotWidth } = plot;
  const spansDays = timeDomain.end - timeDomain.start >= 24 * 60 * 60 * 1000;

  const tooltip = document.createElement('div');
  tooltip.className = 'comparison-graph-tooltip';
  tooltip.hidden = true;
  frame.appendChild(tooltip);

  const hide = () => {
    tooltip.hidden = true;
    crosshair.setAttribute('visibility', 'hidden');
  };

  const move = (event) => {
    const bounds = svg.getBoundingClientRect();
    if (!bounds.width) return;

    const ratio = Math.min(1, Math.max(0, (event.clientX - bounds.left) / bounds.width));
    const timestamp = timeDomain.start + (timeDomain.end - timeDomain.start) * ratio;

    crosshair.setAttribute('visibility', 'visible');
    crosshair.setAttribute('x1', String(ratio * plotWidth));
    crosshair.setAttribute('x2', String(ratio * plotWidth));

    // One tooltip lists every series at this time, so the pointer never has to land on a line.
    tooltip.textContent = '';

    const heading = document.createElement('div');
    heading.className = 'comparison-graph-tooltip-time';
    // Hour and minute, with the weekday once the graph reaches back a day or more, so a reading
    // from yesterday does not look like one from today.
    heading.textContent = formatClockDateTime(new Date(timestamp), {
      ...(spansDays ? { weekday: 'short' } : {}),
      ...getClockFaceTimeOptions(),
    });
    tooltip.appendChild(heading);

    entries.forEach((entry) => {
      // Every series is read at the SAME hovered time — the value it held then, which is its latest
      // sample at or before it. Snapping each series to its own nearest sample would list readings
      // taken at different moments under one heading, and could even answer with a reading the
      // entity had not reported yet.
      const sample = findSampleAtOrBefore(entry.series, timestamp);
      if (!sample) return;

      const row = document.createElement('div');
      row.className = 'comparison-graph-tooltip-row';

      const key = document.createElement('span');
      key.className = 'comparison-graph-tooltip-key';
      key.style.background = `var(--chart-series-${entry.colorSlot})`;

      const value = document.createElement('span');
      value.className = 'comparison-graph-tooltip-value';
      // Rounded as the legend rounds, so the same number is not 21.4567 here and 21.5 there.
      value.textContent = formatGraphReading(sample.value, entry.unit);

      const name = document.createElement('span');
      name.className = 'comparison-graph-tooltip-name';
      name.textContent = entry.name;

      row.appendChild(key);
      row.appendChild(value);
      row.appendChild(name);
      tooltip.appendChild(row);
    });

    tooltip.hidden = false;
    tooltip.classList.toggle('align-right', ratio > 0.5);
  };

  frame.addEventListener('pointermove', move);
  frame.addEventListener('pointerleave', hide);
}

/**
 * Renders (or re-renders) a graph tile's chart and legend.
 *
 * @param {HTMLElement} tile - The `.comparison-graph-tile` element.
 * @param {{id: string, name: string, span: number, entityIds: string[]}} graph
 * @returns {void}
 */
function renderComparisonGraphBody(tile, graph) {
  const body = tile.querySelector('.comparison-graph-body');
  if (!body) return;

  const entries = getComparisonGraphSeries(graph);
  const plot = buildComparisonGraphPlot(entries);

  if (!plot) {
    // Hold whatever is already drawn rather than blanking the chart on a refresh that returned
    // nothing — a skeleton flash on every poll is worse than a slightly stale curve.
    if (body.querySelector('.comparison-graph-frame')) return;
    body.textContent = '';
    const empty = document.createElement('div');
    empty.className = 'comparison-graph-empty';
    empty.textContent = entries.length ? t('Waiting for history…') : t('No sensors selected');
    body.appendChild(empty);
    return;
  }

  body.textContent = '';

  const frame = document.createElement('div');
  frame.className = 'comparison-graph-frame';
  frame.appendChild(plot.svg);
  attachComparisonGraphHover(frame, plot, entries);

  body.appendChild(frame);
  body.appendChild(buildComparisonGraphLegend(entries));
}

/**
 * The tile's reconciliation key. Structural only: live value changes are repainted in place by
 * refreshComparisonGraphTiles(), so a state update doesn't tear down the node (and the hover
 * state) on every tick.
 *
 * @param {{id: string, name: string, span: number, entityIds: string[]}} graph
 * @returns {string}
 */
function getComparisonGraphSignature(graph) {
  return `graph|${graph.id}|${graph.name}|${graph.span}|${(graph.entityIds || []).join(',')}`;
}

/**
 * Creates a comparison graph tile for the Quick Access grid.
 *
 * @param {string} graphId - The graph's synthetic entity ID (`graph:…`).
 * @returns {HTMLElement} A `.control-item` carrying `data-entity-id`, as the grid contract requires.
 */
function createComparisonGraphTile(graphId) {
  const graph = getComparisonGraphById(graphId);

  const tile = document.createElement('div');
  tile.className = 'control-item comparison-graph-tile';
  tile.dataset.entityId = graphId;

  const span = normalizeComparisonGraphSpan(graph?.span);
  tile.dataset.span = String(span);
  tile.style.gridColumn = `span ${span}`;

  if (!graph) {
    tile.classList.add('unavailable-entity');
    tile.textContent = t('Graph unavailable');
    return tile;
  }

  tile.dataset.renderSignature = getComparisonGraphSignature(graph);
  // Without a name the tile reads as loose text and a chart; the title names the whole group.
  tile.setAttribute('role', 'group');
  tile.setAttribute('aria-label', graph.name);

  const header = document.createElement('div');
  header.className = 'comparison-graph-header';

  const title = document.createElement('span');
  title.className = 'comparison-graph-title';
  title.textContent = graph.name;

  const range = document.createElement('span');
  range.className = 'comparison-graph-range';
  range.textContent = t('24h');

  header.appendChild(title);
  header.appendChild(range);
  tile.appendChild(header);

  const body = document.createElement('div');
  body.className = 'comparison-graph-body';
  tile.appendChild(body);

  hydrateComparisonGraphTile(tile, graphId);

  return tile;
}

/**
 * Paints a graph tile from cache, then fetches its history and repaints.
 *
 * Also called when an existing tile is re-used on a re-render: the first fetch happens before the
 * WebSocket is open (so it is rejected), and without a retry here the chart would stay empty until
 * the next structural change.
 *
 * @param {HTMLElement} tile - The `.comparison-graph-tile` element.
 * @param {string} graphId - The graph's synthetic entity ID (`graph:…`).
 * @param {Object} [options]
 * @param {boolean} [options.renderNow=true] - Paint from cache before fetching. Pass false when the
 *   tile is already showing a chart, so a refresh doesn't rebuild the DOM needlessly.
 * @returns {Promise<void>}
 */
async function hydrateComparisonGraphTile(tile, graphId, { renderNow = true } = {}) {
  const graph = getComparisonGraphById(graphId);
  if (!graph) return;

  if (renderNow) renderComparisonGraphBody(tile, graph);

  try {
    await fetchSensorHistoryBatch(graph.entityIds);
  } catch (error) {
    console.error('Error loading comparison graph history:', error);
    return;
  }

  if (!tile.isConnected) return;
  const current = getComparisonGraphById(graphId);
  if (current) renderComparisonGraphBody(tile, current);
}

/**
 * Applies each graph's configured width, clamped to the columns the grid actually has. The grid is
 * `repeat(auto-fit, minmax(120px, 1fr))`, so a narrow window may have fewer columns than the graph
 * asks for — and a span wider than the grid would add an implicit column and overflow horizontally.
 */
function applyComparisonGraphSpans(container) {
  const grid = container || document.getElementById('quick-controls');
  if (!grid) return;

  const tiles = grid.querySelectorAll('.comparison-graph-tile');
  if (!tiles.length) return;

  const templateColumns = window.getComputedStyle(grid).gridTemplateColumns || '';
  const columnCount = templateColumns.split(' ').filter(Boolean).length;

  tiles.forEach((tile) => {
    const desired = normalizeComparisonGraphSpan(Number(tile.dataset.span));
    const span = columnCount > 0 ? Math.min(desired, columnCount) : desired;
    tile.style.gridColumn = `span ${span}`;
  });
}

// Resizing the window changes how many columns fit, so the clamp has to be re-applied.
let comparisonGraphResizeTimer = null;
if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
  window.addEventListener('resize', () => {
    if (comparisonGraphResizeTimer) clearTimeout(comparisonGraphResizeTimer);
    comparisonGraphResizeTimer = setTimeout(() => {
      comparisonGraphResizeTimer = null;
      applyComparisonGraphSpans();
    }, 150);
  });
}

let comparisonGraphRedrawTimer = null;

/**
 * Repaints graph tiles in place after a live state change, debounced so bursts coalesce.
 *
 * @param {Object} entity - The Home Assistant entity that just changed.
 * @returns {void}
 */
function refreshComparisonGraphTiles(entity) {
  const entityId = entity?.entity_id;
  if (!entityId) return;

  const graphs = (state.CONFIG?.comparisonGraphs || []).filter(
    (graph) => Array.isArray(graph.entityIds) && graph.entityIds.includes(entityId)
  );
  if (!graphs.length) return;

  // A graphed entity usually has no tile of its own, so the tile update path never appends its
  // live reading to the history cache. Do it here or the curve stops at the last fetch. Reads the
  // value through the series resolver, since a weather entity's state is not its temperature.
  const entry = sensorHistoryCache.get(entityId);
  const value = readGraphSeriesValue(entity);
  if (entry && value !== null) {
    // A weather entity's temperature moves without its state moving, and `last_changed` only
    // tracks the state — so an attribute-backed reading dates itself by `last_updated`, or it
    // would be plotted back at whenever the sky last changed.
    const timestamp = parseSensorHistoryTimestamp(entity, {
      preferLastUpdated: !!getGraphSeriesAttribute(entityId),
    });
    const previous = entry.series[entry.series.length - 1];
    if (!previous || previous.timestamp !== timestamp || previous.value !== value) {
      entry.series = pruneSensorHistorySeries([...entry.series, { value, timestamp }]);
    }
  }

  if (comparisonGraphRedrawTimer) clearTimeout(comparisonGraphRedrawTimer);
  comparisonGraphRedrawTimer = setTimeout(() => {
    comparisonGraphRedrawTimer = null;
    // Matched on the dataset rather than through a selector: a graph id contains a colon, and
    // building a selector out of it drags in CSS.escape — which this timer callback runs outside
    // of any try/catch, so a host without it takes the whole repaint down with a ReferenceError.
    const tiles = [...document.querySelectorAll('.comparison-graph-tile')];
    graphs.forEach((graph) => {
      const tile = tiles.find((node) => node.dataset.entityId === graph.id);
      const current = getComparisonGraphById(graph.id);
      if (tile && current) renderComparisonGraphBody(tile, current);
    });
  }, COMPARISON_GRAPH_REDRAW_DEBOUNCE_MS);
}

/**
 * The unit a series is measured in, falling back to the Home Assistant temperature unit for
 * attribute-backed entities that don't declare one.
 *
 * @param {?Object} entity
 * @returns {string} e.g. `°C`, or an empty string when unknown.
 */
function getGraphSeriesUnitFor(entity) {
  return readGraphSeriesUnit(entity, {
    fallbackTemperatureUnit: state.UNIT_SYSTEM?.temperature || '',
  });
}

// A weather integration is usually named something like "Forecast Home", which says nothing about
// the outside temperature it provides — the one series a comparison graph most often wants. These
// aliases make it findable by the words people actually type.
const GRAPH_SEARCH_ALIASES = {
  weather: 'outside outdoor weather forecast temperature',
  climate: 'thermostat climate temperature',
};

/**
 * Extra search terms for an entity, so it can be found by what it measures rather than only by its
 * name.
 *
 * @param {Object} entity
 * @returns {string} Space-separated aliases, or an empty string.
 */
function getGraphSearchAlias(entity) {
  const domain = typeof entity?.entity_id === 'string' ? entity.entity_id.split('.')[0] : '';
  return GRAPH_SEARCH_ALIASES[domain] || '';
}

/**
 * Persists a config that contains comparison graph changes, then re-renders the grid.
 *
 * @param {Object} nextConfig
 * @returns {Promise<Object>}
 */
function persistComparisonGraphConfig(nextConfig) {
  const persistence = setQuickAccessConfig(nextConfig, { render: false });
  renderQuickControls();
  return persistence;
}

/**
 * Creates an empty comparison graph in the active view and opens its editor.
 *
 * @returns {Promise<void>}
 */
async function addComparisonGraphTile() {
  const config = ensureQuickAccessConfig();
  const activeTab = getActiveQuickAccessTab(config);
  const nextConfig = addComparisonGraph(config, {
    name: t('Comparison Graph'),
    entityIds: [],
    tabId: activeTab?.id,
  });
  const result = await persistComparisonGraphConfig(nextConfig);
  if (!result.success) return;

  const added = (result.config?.comparisonGraphs || nextConfig.comparisonGraphs || []).at(-1);
  if (added) showComparisonGraphModal(added.id);
}

/**
 * Opens the comparison graph editor: rename, set width, add/remove entities, delete.
 *
 * The picker lists numeric sensors plus attribute-backed entities (weather, climate), shows each
 * one's unit so a mismatched scale is visible before it is added, and enforces the series cap.
 *
 * @param {string} graphId - The graph's synthetic entity ID (`graph:…`).
 * @returns {void}
 */
function showComparisonGraphModal(graphId) {
  const initial = getComparisonGraphById(graphId);
  if (!initial) return;

  // Closing waits for a save that is still going, so a rename that began when the name field lost
  // focus (the click on Done) is finished, not dropped, and the dialog then closes on that click.
  let pendingSave = Promise.resolve();
  const modal = createEntityDetailModal({
    className: 'comparison-graph-modal',
    title: t('Edit Comparison Graph'),
    beforeClose: () => pendingSave,
  });
  const body = modal.querySelector('.modal-body');
  if (!body) return;
  const removeGraphModal = () => entityDetailModalClosers.get(modal)?.();

  const nameGroup = document.createElement('div');
  nameGroup.className = 'form-group';
  const nameLabel = document.createElement('label');
  nameLabel.textContent = t('Graph name');
  nameLabel.htmlFor = `comparison-graph-name-${graphId}`;
  const nameInput = document.createElement('input');
  nameInput.id = nameLabel.htmlFor;
  nameInput.type = 'text';
  nameInput.className = 'form-control';
  nameInput.maxLength = 40;
  nameInput.value = initial.name;
  nameGroup.appendChild(nameLabel);
  nameGroup.appendChild(nameInput);
  body.appendChild(nameGroup);

  const widthGroup = document.createElement('div');
  widthGroup.className = 'form-group';
  const widthLabel = document.createElement('label');
  widthLabel.textContent = t('Width');
  widthLabel.htmlFor = `comparison-graph-width-${graphId}`;
  const widthSelect = document.createElement('select');
  widthSelect.id = widthLabel.htmlFor;
  widthSelect.className = 'form-control';
  COMPARISON_GRAPH_SPAN_OPTIONS.forEach((option) => {
    const optionEl = document.createElement('option');
    optionEl.value = String(option);
    optionEl.textContent = t('{{count}} tiles wide', { count: option });
    widthSelect.appendChild(optionEl);
  });
  widthSelect.value = String(normalizeComparisonGraphSpan(initial.span));
  widthGroup.appendChild(widthLabel);
  widthGroup.appendChild(widthSelect);
  body.appendChild(widthGroup);

  const warning = document.createElement('div');
  warning.className = 'comparison-graph-warning';
  warning.hidden = true;
  body.appendChild(warning);

  const hint = document.createElement('div');
  hint.className = 'form-help';
  body.appendChild(hint);

  // The group spaces the field like the others above it.
  const searchGroup = document.createElement('div');
  searchGroup.className = 'form-group';
  const search = document.createElement('input');
  search.type = 'text';
  search.className = 'form-control';
  search.spellcheck = false;
  search.placeholder = t('Search sensors…');
  search.setAttribute('aria-label', t('Search sensors…'));
  searchGroup.appendChild(search);
  body.appendChild(searchGroup);

  const listGroup = document.createElement('div');
  listGroup.className = 'form-group';
  const list = document.createElement('div');
  list.className = 'entity-selector-list';
  listGroup.appendChild(list);
  body.appendChild(listGroup);

  // The footer sits outside the scrolling body so Done and Delete stay in view.
  const footer = document.createElement('div');
  footer.className = 'modal-footer comparison-graph-modal-footer';
  const deleteBtn = document.createElement('button');
  deleteBtn.type = 'button';
  deleteBtn.className = 'btn btn-danger';
  deleteBtn.textContent = t('Delete graph');
  footer.appendChild(deleteBtn);
  // Changes save as they are made; Done just says so and closes.
  const doneBtn = document.createElement('button');
  doneBtn.type = 'button';
  doneBtn.className = 'btn btn-primary';
  doneBtn.textContent = t('Done');
  footer.appendChild(doneBtn);
  modal.querySelector('.modal-content')?.appendChild(footer);

  const modalCloseBtn = modal.querySelector('.close-btn');
  doneBtn.addEventListener('click', () => modalCloseBtn?.click());
  // Saves run one at a time, and a click on a row while one is running is ignored. Nothing is
  // disabled meanwhile: disabling the focused control drops the keyboard to <body>, and Done and
  // Close would swallow the click that arrives after the field's own change event.
  let graphMutationInFlight = false;
  const setGraphMutationInFlight = (inFlight) => {
    graphMutationInFlight = inFlight;
    list.setAttribute('aria-busy', String(inFlight));
  };

  const reconcileEditor = () => {
    const current = getComparisonGraphById(graphId);
    if (!current) {
      removeGraphModal();
      return;
    }
    nameInput.value = current.name;
    widthSelect.value = String(normalizeComparisonGraphSpan(current.span));
  };

  const persistEditorConfig = async (nextConfig, { reconcileOnFailure = true } = {}) => {
    if (graphMutationInFlight) {
      return { success: false, ignored: true, isCurrent: false };
    }

    setGraphMutationInFlight(true);
    const run = (async () => {
      try {
        const result = await persistComparisonGraphConfig(nextConfig);
        if (!result.success && result.isCurrent !== false && reconcileOnFailure) {
          reconcileEditor();
        }
        return result;
      } finally {
        if (modal.isConnected) {
          setGraphMutationInFlight(false);
          renderList();
        }
      }
    })();
    pendingSave = run.catch(() => {});
    return run;
  };
  const save = (changes) =>
    persistEditorConfig(updateComparisonGraph(state.CONFIG, graphId, changes));

  const renderUnitState = (graph) => {
    const { groups, hasMismatch } = groupSeriesByUnit(
      graph.entityIds.map((entityId) => ({
        entityId,
        unit: getGraphSeriesUnitFor(state.STATES?.[entityId]),
      }))
    );

    warning.hidden = !hasMismatch;
    if (hasMismatch) {
      const units = groups.map((group) => group.unit || t('no unit')).join(', ');
      warning.textContent = t(
        'Mixed units ({{units}}). Each unit is scaled separately, so compare curves within a unit only.',
        { units }
      );
    }

    hint.textContent = t('{{count}} of {{max}} sensors.', {
      count: graph.entityIds.length,
      max: MAX_COMPARISON_GRAPH_SERIES,
    });
  };

  const renderList = () => {
    const graph = getComparisonGraphById(graphId);
    if (!graph) {
      removeGraphModal();
      return;
    }

    renderUnitState(graph);

    const filter = search.value.trim().toLowerCase();
    const selected = new Set(graph.entityIds);
    const atCapacity = graph.entityIds.length >= MAX_COMPARISON_GRAPH_SERIES;

    // Numeric sensors plus attribute-backed entities (weather / climate), so the outside
    // temperature from a weather integration can be graphed alongside room sensors.
    const candidates = Object.values(state.STATES || {})
      .filter(isGraphableEntity)
      .map((entity) => {
        if (!filter) return { entity, score: 1 };
        const score =
          utils.getSearchScore(utils.getEntityDisplayName(entity), filter) +
          utils.getSearchScore(entity.entity_id, filter) +
          utils.getSearchScore(getGraphSearchAlias(entity), filter);
        return { entity, score };
      })
      .filter((item) => item.score > 0)
      .sort((a, b) => {
        const aSelected = selected.has(a.entity.entity_id);
        const bSelected = selected.has(b.entity.entity_id);
        if (aSelected !== bSelected) return aSelected ? -1 : 1;

        // Surface the weather entity near the top: it is the outside temperature, which is the
        // series a comparison graph most often wants, and its name ("Forecast Home") gives no clue.
        if (!filter) {
          const aWeather = a.entity.entity_id.startsWith('weather.');
          const bWeather = b.entity.entity_id.startsWith('weather.');
          if (aWeather !== bWeather) return aWeather ? -1 : 1;
        }

        if (b.score !== a.score) return b.score - a.score;
        return compareNames(
          utils.getEntityDisplayName(a.entity),
          utils.getEntityDisplayName(b.entity)
        );
      });

    // The list is rebuilt after every add and remove, and the sensor just toggled moves. The
    // keyboard follows it, or goes to the search field when that sensor is no longer listed, and
    // the list stays scrolled where it was.
    const scrollTop = list.scrollTop;
    uiUtils.renderKeepingFocus(
      list,
      () => {
        list.textContent = '';
        renderCandidates(candidates);
      },
      { fallback: search }
    );
    list.scrollTop = scrollTop;

    function renderCandidates(rows) {
      if (!rows.length) {
        const empty = document.createElement('div');
        empty.className = 'no-entities-message';
        empty.textContent = t('No numeric sensors found');
        list.appendChild(empty);
        return;
      }
      rows.forEach(({ entity }) => appendCandidate(entity));
    }

    function appendCandidate(entity) {
      const entityId = entity.entity_id;
      const isSelected = selected.has(entityId);
      const unit = getGraphSeriesUnitFor(entity);

      const item = document.createElement('div');
      item.className = 'entity-item';

      const main = document.createElement('div');
      main.className = 'entity-item-main';

      const icon = document.createElement('span');
      icon.className = 'entity-icon';
      renderEntityIcon(icon, entity);

      const info = document.createElement('div');
      info.className = 'entity-item-info';

      const name = document.createElement('span');
      name.className = 'entity-name';
      name.id = `comparison-graph-sensor-${entityId}`;
      name.textContent = utils.getEntityDisplayName(entity);

      // For attribute-backed entities the entity id alone doesn't say what gets plotted, so name
      // the attribute: a weather entity contributes the outside temperature.
      const meta = document.createElement('span');
      meta.className = 'entity-id';
      const attribute = getGraphSeriesAttribute(entityId);
      meta.textContent = attribute ? t('Outside temperature · {{id}}', { id: entityId }) : entityId;
      if (attribute && !entityId.startsWith('weather.')) {
        meta.textContent = t('Current temperature · {{id}}', { id: entityId });
      }

      info.appendChild(name);
      info.appendChild(meta);
      main.appendChild(icon);
      main.appendChild(info);

      // The unit gets its own element rather than being appended to the entity id — ids are long
      // enough that the ellipsis would swallow it, and the unit is the thing you need to see
      // *before* adding a sensor to a shared scale.
      const unitBadge = document.createElement('span');
      unitBadge.className = 'comparison-graph-unit';
      unitBadge.textContent = unit || t('no unit');

      const button = document.createElement('button');
      button.type = 'button';
      button.className = `entity-selector-btn ${isSelected ? 'remove' : 'add'}`;
      button.textContent = isSelected ? t('Remove') : t('Add');
      // A column of identical Add or Remove buttons says nothing; the sensor's name does.
      button.setAttribute('aria-describedby', name.id);
      button.dataset.focusKey = `graph-sensor:${entityId}`;
      button.disabled = !isSelected && atCapacity;
      button.addEventListener('click', async () => {
        if (graphMutationInFlight) return;
        const current = getComparisonGraphById(graphId);
        if (!current) return;

        if (isSelected) {
          await save({ entityIds: current.entityIds.filter((id) => id !== entityId) });
        } else {
          const units = new Set(
            current.entityIds.map((id) => getGraphSeriesUnitFor(state.STATES?.[id])).filter(Boolean)
          );
          if (unit && units.size && !units.has(unit)) {
            uiUtils.showToast(
              t('{{unit}} does not match the other sensors — it will be scaled on its own.', {
                unit,
              }),
              'warning',
              3500
            );
          }
          await save({ entityIds: [...current.entityIds, entityId] });
        }
      });

      item.appendChild(main);
      item.appendChild(unitBadge);
      item.appendChild(button);
      list.appendChild(item);
    }
  };

  nameInput.addEventListener('change', async () => {
    await save({ name: nameInput.value });
    // A blank name keeps the old one, so show it again instead of leaving the field empty.
    if (modal.isConnected) reconcileEditor();
  });
  widthSelect.addEventListener('change', async () => {
    await save({ span: Number(widthSelect.value) });
  });
  search.addEventListener('input', renderList);

  deleteBtn.addEventListener('click', async () => {
    if (graphMutationInFlight) return;
    const confirmed = await uiUtils.showConfirm(
      t('Delete graph'),
      t('This removes the graph and its tile.'),
      { confirmText: t('Delete'), confirmClass: 'btn-danger' }
    );
    if (!confirmed || graphMutationInFlight) return;
    const result = await persistEditorConfig(removeComparisonGraph(state.CONFIG, graphId), {
      reconcileOnFailure: false,
    });
    if (result.success && modal.isConnected) removeGraphModal();
  });

  renderList();
}

function normalizeQuickAccessTileValueSize(value) {
  if (typeof value !== 'string') return 'auto';
  const normalized = value.trim().toLowerCase();
  return QUICK_ACCESS_TILE_VALUE_SIZE_OPTIONS.has(normalized) ? normalized : 'auto';
}

function getQuickAccessTileOptions(entityId) {
  const options = state.CONFIG?.quickAccessTileOptions?.[entityId];
  return options && typeof options === 'object' && !Array.isArray(options) ? options : {};
}

function getQuickAccessTileValueSize(entityId) {
  return normalizeQuickAccessTileValueSize(getQuickAccessTileOptions(entityId).valueSize);
}

function getQuickAccessCameraPreviewRefresh(entityId) {
  return camera.normalizeCameraPreviewRefresh(
    getQuickAccessTileOptions(entityId).cameraPreviewRefresh
  );
}

function ensureQuickAccessTileOptionsConfig(targetConfig = state.CONFIG) {
  if (
    !targetConfig.quickAccessTileOptions ||
    typeof targetConfig.quickAccessTileOptions !== 'object' ||
    Array.isArray(targetConfig.quickAccessTileOptions)
  ) {
    targetConfig.quickAccessTileOptions = {};
  }
  return targetConfig.quickAccessTileOptions;
}

function setQuickAccessTileValueSize(entityId, valueSize, targetConfig = state.CONFIG) {
  const normalized = normalizeQuickAccessTileValueSize(valueSize);
  const tileOptions = ensureQuickAccessTileOptionsConfig(targetConfig);

  if (normalized === 'auto') {
    if (tileOptions[entityId]) {
      delete tileOptions[entityId].valueSize;
      if (Object.keys(tileOptions[entityId]).length === 0) {
        delete tileOptions[entityId];
      }
    }
    return normalized;
  }

  tileOptions[entityId] = {
    ...(tileOptions[entityId] || {}),
    valueSize: normalized,
  };
  return normalized;
}

function setQuickAccessCameraPreviewRefresh(entityId, refreshValue, targetConfig = state.CONFIG) {
  const normalized = camera.normalizeCameraPreviewRefresh(refreshValue);
  const tileOptions = ensureQuickAccessTileOptionsConfig(targetConfig);

  if (normalized === 'off') {
    if (tileOptions[entityId]) {
      delete tileOptions[entityId].cameraPreviewRefresh;
      if (Object.keys(tileOptions[entityId]).length === 0) {
        delete tileOptions[entityId];
      }
    }
    return normalized;
  }

  tileOptions[entityId] = {
    ...(tileOptions[entityId] || {}),
    cameraPreviewRefresh: normalized,
  };
  return normalized;
}

function pruneQuickAccessTileOptionEntry(tileOptions, entityId) {
  if (tileOptions[entityId] && Object.keys(tileOptions[entityId]).length === 0) {
    delete tileOptions[entityId];
  }
}

function getQuickAccessTileChartType(entityId) {
  return normalizeSensorTileChartType(getQuickAccessTileOptions(entityId).chartType);
}

function getQuickAccessTileGaugeRange(entityId) {
  const options = getQuickAccessTileOptions(entityId);
  return {
    min: normalizeGaugeBound(options.gaugeMin),
    max: normalizeGaugeBound(options.gaugeMax),
  };
}

function setQuickAccessTileChartType(entityId, chartType, targetConfig = state.CONFIG) {
  const normalized = normalizeSensorTileChartType(chartType);
  const tileOptions = ensureQuickAccessTileOptionsConfig(targetConfig);

  if (normalized === 'line') {
    if (tileOptions[entityId]) {
      delete tileOptions[entityId].chartType;
      pruneQuickAccessTileOptionEntry(tileOptions, entityId);
    }
    return normalized;
  }

  tileOptions[entityId] = {
    ...(tileOptions[entityId] || {}),
    chartType: normalized,
  };
  return normalized;
}

function setQuickAccessTileGaugeRange(
  entityId,
  { min = null, max = null } = {},
  targetConfig = state.CONFIG
) {
  const normalizedMin = normalizeGaugeBound(min);
  const normalizedMax = normalizeGaugeBound(max);
  const tileOptions = ensureQuickAccessTileOptionsConfig(targetConfig);
  const next = { ...(tileOptions[entityId] || {}) };

  if (normalizedMin === null) delete next.gaugeMin;
  else next.gaugeMin = normalizedMin;
  if (normalizedMax === null) delete next.gaugeMax;
  else next.gaugeMax = normalizedMax;

  if (Object.keys(next).length) {
    tileOptions[entityId] = next;
  } else {
    delete tileOptions[entityId];
  }
  return { min: normalizedMin, max: normalizedMax };
}

function isEntityInTray(entityId) {
  return trayEntitySupport.isTrayEntity(state.CONFIG, entityId);
}

function setTrayEntityEnabled(entityId, enabled, targetConfig = state.CONFIG) {
  const next = trayEntitySupport.normalizeTrayEntitiesConfig(targetConfig.trayEntities);
  if (enabled) {
    next[entityId] = next[entityId] || {};
  } else {
    delete next[entityId];
  }
  targetConfig.trayEntities = next;
  return !!enabled;
}

function isEntityDesktopPinned(entityId) {
  return !!state.CONFIG?.desktopPins?.[entityId];
}

function getDesktopPinSupportProfile(entityOrEntityId = null) {
  return resolveDesktopPinProfile(entityOrEntityId);
}

function getDesktopPinCapabilitySignature(entity) {
  return JSON.stringify(getDesktopPinCapabilities(entity));
}

function getDesktopPinSupportInfo(entityOrEntityId = null) {
  const profile = getDesktopPinSupportProfile(entityOrEntityId);
  return {
    entityId:
      profile.entityId ||
      (typeof entityOrEntityId === 'string' ? entityOrEntityId : entityOrEntityId?.entity_id || ''),
    supported: !!profile.supported,
    interactive: !!profile.interactive,
    family: profile.family || 'unsupported',
    label: profile.label || '',
    reason: profile.reason || '',
    primaryAction: profile.primaryAction || '',
    secondaryAction: profile.secondaryAction || '',
  };
}

function requestDesktopPinFocusMain(entityId) {
  if (!entityId || !window?.electronAPI?.requestDesktopPinAction) return;
  window.electronAPI.requestDesktopPinAction(entityId, 'focus-main').catch((error) => {
    console.error('Error focusing main widget from desktop pin:', error);
  });
}

// The viewer is a dialog far larger than a pin window, so the main window opens it.
function requestDesktopPinOpenDetails(entityId) {
  if (!entityId || !window?.electronAPI?.requestDesktopPinAction) return;
  window.electronAPI.requestDesktopPinAction(entityId, 'open-details').catch((error) => {
    console.error('Error opening details from desktop pin:', error);
  });
}

function hasEntityService(entity, serviceName) {
  const domain = getEntityDomain(entity?.entity_id);
  if (!domain || !serviceName) return false;
  // Only the main window asks Home Assistant for its services. A pin window has none, so a
  // vacuum's Start, Pause and Return come from the features it advertises instead.
  if (domain === 'vacuum' && !state.SERVICES?.vacuum) {
    return !!getDesktopPinVacuumServices(entity)[serviceName];
  }
  return !!state.SERVICES?.[domain]?.[serviceName];
}

function callEntityDomainService(entity, serviceName, serviceData = {}) {
  const entityId = entity?.entity_id;
  const domain = getEntityDomain(entityId);
  if (!entityId || !domain || !serviceName) return Promise.resolve();
  const currentEntity = state.STATES?.[entityId] || entity;
  if (!isEntityAvailable(currentEntity)) return Promise.resolve();
  return websocket
    .callService(domain, serviceName, {
      entity_id: entityId,
      ...(serviceData || {}),
    })
    .catch((error) =>
      handleDesktopPinServiceError(
        error,
        entityId,
        utils.getEntityDisplayName(currentEntity || entity)
      )
    );
}

// A pin applies the value it is about to send straight to the DOM. The interaction that holds it
// only expires, without re-rendering, so after a rejected command the pin would keep showing the
// value that never took effect until some unrelated update arrived. Drop the optimistic state and
// draw what Home Assistant last reported. Without a pin on the page this does nothing.
// If a second command on the same pin is still in flight, this also drops its optimistic value; the
// state update that command causes, or its own failure, draws the right value a moment later.
function resyncDesktopPinFromState(entityId) {
  if (!entityId) return;
  clearDesktopPinControlInteraction(entityId);
  clearDesktopPinLightInteraction(entityId);
  const entity = state.STATES?.[entityId];
  if (!entity) return;
  try {
    document.querySelectorAll('.desktop-pin-control').forEach((root) => {
      if (root.dataset.entityId === entityId) updateExistingDesktopPinPanelControl(root, entity);
    });
  } catch (error) {
    console.error('Failed to restore desktop pin state after a failed command:', error);
  }
}

function handleDesktopPinServiceError(error, entityId, entityName) {
  handleServiceError(error, entityName);
  resyncDesktopPinFromState(entityId);
}

function callServiceWithResponse(domain, service, serviceData = {}) {
  if (typeof websocket.callServiceWithResponse === 'function') {
    return websocket.callServiceWithResponse(domain, service, serviceData);
  }
  return websocket.callService(domain, service, serviceData, { returnResponse: true });
}

function clampDesktopPinMetric(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function getDesktopPinLayoutProfile(domain = '', size = {}) {
  const width = Number.isFinite(Number(size?.width))
    ? Math.round(Number(size.width))
    : typeof window !== 'undefined'
      ? window.innerWidth || 168
      : 168;
  const height = Number.isFinite(Number(size?.height))
    ? Math.round(Number(size.height))
    : typeof window !== 'undefined'
      ? window.innerHeight || 148
      : 148;
  const normalizedDomain = typeof domain === 'string' ? domain.trim() : '';
  const area = width * height;
  const isMedia = normalizedDomain === 'media_player';

  let layout = 'compact';
  if (width <= 155 || height <= 122) {
    layout = 'micro';
  } else if (
    (width >= 260 && height >= 190 && area >= 260 * 190) ||
    (isMedia && width >= 320 && height >= 156 && area >= 320 * 156)
  ) {
    layout = 'roomy';
  } else if (
    (width >= 195 && height >= 160 && area >= 195 * 160) ||
    (isMedia && width >= 260 && height >= 148 && area >= 260 * 148)
  ) {
    layout = 'balanced';
  }

  return {
    width,
    height,
    area,
    domain: normalizedDomain,
    layout,
    isMicro: layout === 'micro',
    isCompact: layout === 'compact' || layout === 'micro',
    isBalanced: layout === 'balanced',
    isRoomy: layout === 'roomy',
  };
}

function getDesktopPinSceneLayoutProfile(domain = 'scene', size = {}) {
  const layoutProfile = getDesktopPinLayoutProfile(domain, size);
  return {
    ...layoutProfile,
    isNano: false,
  };
}

// Arabic, Indic, Thai and CJK scripts stack marks above and below the line and wrap per character,
// so a name in one needs more line height than the 1.1 that suits Latin letters.
const DESKTOP_PIN_TALL_SCRIPT_PATTERN =
  /[\u0590-\u08ff\u0900-\u0dff\u0e00-\u0eff\u3000-\u9fff\uac00-\ud7af]/;

function getDesktopPinSceneSizingMetrics(width, height, domain = 'scene', nameText = '') {
  const layoutProfile =
    domain === 'scene'
      ? getDesktopPinSceneLayoutProfile(domain, { width, height })
      : getDesktopPinLayoutProfile(domain, { width, height });
  const safeWidth = Math.max(1, Number(width) || DESKTOP_PIN_SCENE_DEFAULT_BOUNDS.width);
  const safeHeight = Math.max(1, Number(height) || DESKTOP_PIN_SCENE_DEFAULT_BOUNDS.height);
  const vmin = Math.min(safeWidth, safeHeight);
  const metrics = {
    ...layoutProfile,
    bodyGap: clampDesktopPinMetric(safeHeight * 0.014, 2, 6),
    bodyPad: clampDesktopPinMetric(safeWidth * 0.014, 2, 6),
    heroPad: clampDesktopPinMetric(safeWidth * 0.02, 4, 10),
    heroRadius: clampDesktopPinMetric(safeWidth * 0.09, 18, 28),
    emojiSize: clampDesktopPinMetric(vmin * 0.28, 16, 72),
    nameFontSize: clampDesktopPinMetric(Math.min(vmin * 0.075, 14), 10, 24),
    nameLineHeight: 1.15,
    namePadY: clampDesktopPinMetric(safeWidth * 0.01, 1, 4),
    namePadX: clampDesktopPinMetric(safeWidth * 0.04, 2, 14),
  };

  if (layoutProfile.layout === 'micro') {
    metrics.bodyPad = 2;
    metrics.heroPad = 2;
    metrics.emojiSize = clampDesktopPinMetric(vmin * 0.22, 14, 42);
    metrics.nameFontSize = clampDesktopPinMetric(Math.min(vmin * 0.044, 12), 8, 13);
    metrics.nameLineHeight = 1.1;
  } else if (layoutProfile.layout === 'roomy') {
    metrics.nameFontSize = clampDesktopPinMetric(safeWidth * 0.032, 18, 30);
  }
  if (DESKTOP_PIN_TALL_SCRIPT_PATTERN.test(nameText)) {
    metrics.nameLineHeight = 1.35;
  }

  return metrics;
}

function applyDesktopPinSceneSizing(root, width, height, domain = 'scene') {
  if (!root) return null;
  const nameText = root.querySelector('.desktop-pin-scene-name')?.textContent || '';
  const metrics = getDesktopPinSceneSizingMetrics(width, height, domain, nameText);
  root.style.setProperty('--desktop-pin-scene-body-gap', `${metrics.bodyGap}px`);
  root.style.setProperty('--desktop-pin-scene-body-pad', `${metrics.bodyPad}px`);
  root.style.setProperty('--desktop-pin-scene-hero-pad', `${metrics.heroPad}px`);
  root.style.setProperty('--desktop-pin-scene-hero-radius', `${metrics.heroRadius}px`);
  root.style.setProperty('--desktop-pin-scene-emoji-size', `${metrics.emojiSize}px`);
  root.style.setProperty('--desktop-pin-scene-name-font-size', `${metrics.nameFontSize}px`);
  root.style.setProperty('--desktop-pin-scene-name-line-height', String(metrics.nameLineHeight));
  root.style.setProperty('--desktop-pin-scene-name-pad-y', `${metrics.namePadY}px`);
  root.style.setProperty('--desktop-pin-scene-name-pad-x', `${metrics.namePadX}px`);
  return metrics;
}

function getDesktopPinDenseRenderProfile(domain = '') {
  const layoutProfile = getDesktopPinLayoutProfile(domain);
  let denseVariant = 'standard';

  if (layoutProfile.isMicro) {
    denseVariant = 'micro';
  } else if (domain === 'climate' || domain === 'fan' || domain === 'cover') {
    if (!layoutProfile.isBalanced && (layoutProfile.height <= 150 || layoutProfile.width <= 176)) {
      denseVariant = 'tight';
    }
  } else if (domain === 'media_player') {
    if (layoutProfile.height <= 152 || layoutProfile.width <= 284) {
      denseVariant = 'tight';
    }
  }

  return {
    ...layoutProfile,
    denseVariant,
    isDenseTight: denseVariant === 'tight',
    isDenseMicro: denseVariant === 'micro',
  };
}

function formatDesktopPinClimateModeLabel(mode) {
  const normalizedMode = typeof mode === 'string' ? mode.trim() : '';
  if (!normalizedMode) return t('Mode');
  const label = DESKTOP_PIN_CLIMATE_MODE_LABELS[normalizedMode];
  return label ? t(label) : normalizedMode.replace(/_/g, ' ');
}

// Some short words need a different translation per context ("Cool" as a colour temperature is not
// the HVAC mode). The context lives in the key; English, where the key is missing, shows the word.
function translateInContext(key, fallback) {
  const label = t(key);
  return label === key ? fallback : label;
}

// Capitalized, translated device state ("open" -> "Open"), from the shared state names.
function getLocalizedEntityStateLabel(value) {
  return formatStateName(value);
}

function getDeviceTileStateText(entity) {
  const domain = getEntityDomain(entity?.entity_id);
  const attributes = entity?.attributes || {};
  if (domain === 'light') {
    const brightness = Number(attributes.brightness);
    if (entity.state === 'on' && attributes.brightness != null && brightness >= 0) {
      return formatPercent(Math.round((brightness / 255) * 100));
    }
    return getLocalizedEntityStateLabel(entity.state);
  }
  const label = getLocalizedEntityStateLabel(entity?.state);
  const percent =
    domain === 'cover' && entity.state !== 'closed'
      ? attributes.current_position
      : domain === 'fan' && entity.state === 'on'
        ? attributes.percentage
        : null;
  return percent != null && Number.isFinite(Number(percent))
    ? `${label} ${formatPercent(Math.round(Number(percent)))}`
    : label;
}

function getDesktopPinClimateModesToShow(modes, activeMode, maxCount) {
  const availableModes = Array.isArray(modes) ? modes.filter(Boolean) : [];
  if (!availableModes.length) {
    return [];
  }

  const orderedModes = [];
  const seenModes = new Set();
  const pushMode = (mode) => {
    if (!mode || seenModes.has(mode) || !availableModes.includes(mode)) return;
    seenModes.add(mode);
    orderedModes.push(mode);
  };

  pushMode(activeMode);
  DESKTOP_PIN_CLIMATE_MODE_PRIORITY.forEach(pushMode);
  availableModes.forEach(pushMode);

  return orderedModes.slice(0, Math.max(1, maxCount));
}

function getDesktopPinClimateRenderProfile(entity) {
  const layoutProfile = getDesktopPinDenseRenderProfile('climate');
  const climateValue = getDesktopPinClimateValue(entity);
  const maxModes = layoutProfile.isDenseMicro ? 2 : layoutProfile.isDenseTight ? 3 : 4;
  return {
    ...layoutProfile,
    climateValue,
    maxModes,
    showCurrentStat: !layoutProfile.isDenseTight && !layoutProfile.isDenseMicro,
    showCompactCurrent: layoutProfile.isDenseTight || layoutProfile.isDenseMicro,
    showSliderLabels: !layoutProfile.isDenseTight && !layoutProfile.isDenseMicro,
    modesToShow: getDesktopPinClimateModesToShow(climateValue.modes, climateValue.mode, maxModes),
  };
}

function getDesktopPinFanRenderProfile() {
  const layoutProfile = getDesktopPinDenseRenderProfile('fan');
  return {
    ...layoutProfile,
    showHeaderKpi: !layoutProfile.isDenseTight && !layoutProfile.isDenseMicro,
    showSliderLabels: !layoutProfile.isDenseTight && !layoutProfile.isDenseMicro,
    presets:
      layoutProfile.isDenseTight || layoutProfile.isDenseMicro
        ? DESKTOP_PIN_FAN_PRESETS_TIGHT
        : DESKTOP_PIN_FAN_PRESETS_FULL,
  };
}

function getDesktopPinCoverRenderProfile() {
  const layoutProfile = getDesktopPinDenseRenderProfile('cover');
  return {
    ...layoutProfile,
    showVisual: !layoutProfile.isDenseTight && !layoutProfile.isDenseMicro,
    // The tight variant has no room for the blind, so a meter with the position takes the spare
    // height, as the fan's does, and the header does not repeat the number.
    showMeter: layoutProfile.isDenseTight,
    showSliderLabels: !layoutProfile.isDenseTight && !layoutProfile.isDenseMicro,
  };
}

function getDesktopPinMediaRenderProfile() {
  const layoutProfile = getDesktopPinDenseRenderProfile('media_player');
  return {
    ...layoutProfile,
    showArtist: !layoutProfile.isDenseTight && !layoutProfile.isDenseMicro,
    statusText: layoutProfile.isDenseTight
      ? { playing: t('Playing'), paused: t('Paused') }
      : { playing: t('Playing now'), paused: t('Paused') },
  };
}

function getDesktopPinControlInteraction(entityId) {
  if (!entityId) return null;
  return desktopPinControlInteractionState.get(entityId) || null;
}

function setDesktopPinControlInteraction(entityId, nextState = {}) {
  if (!entityId) return null;
  const current = desktopPinControlInteractionState.get(entityId) || {};
  const merged = { ...current, ...nextState };
  desktopPinControlInteractionState.set(entityId, merged);
  return merged;
}

function clearDesktopPinControlInteraction(entityId) {
  const interaction = desktopPinControlInteractionState.get(entityId);
  if (!interaction) return;
  if (interaction.releaseTimer) {
    clearTimeout(interaction.releaseTimer);
  }
  desktopPinControlInteractionState.delete(entityId);
}

function scheduleDesktopPinControlInteractionRelease(entityId, delayMs = 300) {
  if (!entityId) return;
  const current = desktopPinControlInteractionState.get(entityId);
  if (!current) return;
  if (current.releaseTimer) {
    clearTimeout(current.releaseTimer);
  }
  const releaseTimer = setTimeout(() => {
    clearDesktopPinControlInteraction(entityId);
  }, delayMs);
  desktopPinControlInteractionState.set(entityId, {
    ...current,
    active: false,
    releaseTimer,
  });
}

function cancelDesktopPinServiceCall(key) {
  clearTimeout(desktopPinControlTimers.get(key));
  desktopPinControlTimers.delete(key);
}

function queueDesktopPinServiceCall(key, callback, delayMs = 160) {
  if (!key || typeof callback !== 'function') return;
  const existingTimer = desktopPinControlTimers.get(key);
  if (existingTimer) {
    clearTimeout(existingTimer);
  }

  const timer = setTimeout(() => {
    desktopPinControlTimers.delete(key);
    callback();
  }, delayMs);

  desktopPinControlTimers.set(key, timer);
}

function stopDesktopPinEvent(event, preventDefault = true) {
  if (!event) return;
  if (preventDefault && typeof event.preventDefault === 'function') {
    event.preventDefault();
  }
  if (typeof event.stopPropagation === 'function') {
    event.stopPropagation();
  }
}

function bindDesktopPinButton(button, handler, options = {}) {
  if (!button || typeof handler !== 'function') return;
  const pointerEvents = options.pointerEvents || ['pointerdown', 'mousedown'];

  pointerEvents.forEach((eventName) => {
    button.addEventListener(
      eventName,
      (event) => {
        stopDesktopPinEvent(event, true);
      },
      true
    );
  });

  button.addEventListener(
    'click',
    (event) => {
      stopDesktopPinEvent(event, true);
      handler(event);
    },
    true
  );
}

function bindDesktopPinSlider(
  slider,
  { entityId, getImmediateValue, applyVisualValue, queueValue, releaseDelayMs = 320 }
) {
  if (
    !slider ||
    !entityId ||
    typeof getImmediateValue !== 'function' ||
    typeof queueValue !== 'function'
  ) {
    return;
  }

  slider.addEventListener(
    'pointerdown',
    (event) => {
      stopDesktopPinEvent(event, false);
      setDesktopPinControlInteraction(entityId, {
        active: true,
        value: getImmediateValue(slider),
      });
    },
    true
  );

  ['pointerdown', 'mousedown', 'click'].forEach((eventName) => {
    slider.addEventListener(
      eventName,
      (event) => {
        stopDesktopPinEvent(event, false);
      },
      true
    );
  });

  slider.addEventListener('input', (event) => {
    stopDesktopPinEvent(event, false);
    const nextValue = getImmediateValue(event.target);
    setDesktopPinControlInteraction(entityId, {
      active: true,
      value: nextValue,
    });
    if (typeof applyVisualValue === 'function') {
      applyVisualValue(nextValue);
    }
    queueValue(nextValue);
  });

  ['change', 'pointerup', 'pointercancel'].forEach((eventName) => {
    slider.addEventListener(
      eventName,
      () => {
        scheduleDesktopPinControlInteractionRelease(entityId, releaseDelayMs);
      },
      true
    );
  });
}

function getLightBrightnessPercent(entity) {
  if (entity?.state !== 'on') {
    return 0;
  }
  const rawBrightness = Number(entity?.attributes?.brightness);
  if (!Number.isFinite(rawBrightness) || rawBrightness <= 0) {
    return 100;
  }
  return Math.max(0, Math.min(100, Math.round((rawBrightness / 255) * 100)));
}

function getDesktopPinLightLayout() {
  return getDesktopPinLayoutProfile('light').layout;
}

function clearDesktopPinLightInteraction(entityId) {
  const interaction = desktopPinLightInteractionState.get(entityId);
  if (!interaction) return;
  if (interaction.releaseTimer) {
    clearTimeout(interaction.releaseTimer);
  }
  desktopPinLightInteractionState.delete(entityId);
}

function getDesktopPinLightInteraction(entityId) {
  if (!entityId) return null;
  return desktopPinLightInteractionState.get(entityId) || null;
}

function setDesktopPinLightInteraction(entityId, nextState = {}) {
  if (!entityId) return null;
  const current = desktopPinLightInteractionState.get(entityId) || {};
  const merged = { ...current, ...nextState };
  desktopPinLightInteractionState.set(entityId, merged);
  return merged;
}

function scheduleDesktopPinLightInteractionRelease(entityId, delayMs = 260) {
  if (!entityId) return;
  const current = desktopPinLightInteractionState.get(entityId);
  if (!current) return;
  if (current.releaseTimer) {
    clearTimeout(current.releaseTimer);
  }
  const releaseTimer = setTimeout(() => {
    clearDesktopPinLightInteraction(entityId);
  }, delayMs);
  desktopPinLightInteractionState.set(entityId, {
    ...current,
    active: false,
    releaseTimer,
  });
}

// The power button is an icon, so the state it shows is its label and tooltip. It names the state
// rather than the action, which keeps it out of aria-pressed (an "On" button that is pressed would
// be read twice).
function setDesktopPinPowerButtonState(button, isOn) {
  const label = isOn ? t('On') : t('Off');
  button.dataset.active = isOn ? 'true' : 'false';
  button.setAttribute('aria-label', label);
  button.title = label;
}

function applyDesktopPinLightVisualState(root, { isOn, brightnessPct }) {
  if (!root) return;

  const safePct = Math.max(0, Math.min(100, Math.round(Number(brightnessPct) || 0)));
  const canSetBrightness = root.dataset.canSetBrightness === 'true';
  root.dataset.state = isOn ? 'on' : 'off';
  root.style.setProperty('--desktop-pin-light-level', String(safePct / 100));
  root.style.setProperty(
    '--desktop-pin-light-glow-opacity',
    isOn ? String((0.14 + (safePct / 100) * 0.28).toFixed(3)) : '0.06'
  );

  const meterValue = root.querySelector('.desktop-pin-light-meter-value');
  if (meterValue) {
    meterValue.textContent = formatPercent(safePct);
  }

  const brightnessFill = root.querySelector('.desktop-pin-light-brightness-fill');
  if (brightnessFill) {
    brightnessFill.style.width = `${safePct}%`;
  }

  const status = root.querySelector('.desktop-pin-light-status');
  if (status) {
    status.textContent = canSetBrightness
      ? isOn
        ? t('{{percent}}% brightness', { percent: safePct })
        : t('Use slider or a preset')
      : isOn
        ? t('On')
        : t('Off');
  }

  const powerButton = root.querySelector('.desktop-pin-light-power');
  if (powerButton) setDesktopPinPowerButtonState(powerButton, isOn);

  const slider = root.querySelector('.desktop-pin-light-slider');
  if (slider && slider.value !== String(safePct)) {
    slider.value = String(safePct);
  }
}

function updateExistingDesktopPinLightControl(root, entity) {
  if (!root || !entity?.entity_id || !root.classList.contains('desktop-pin-light-control')) {
    return false;
  }

  const interaction = getDesktopPinLightInteraction(entity.entity_id);
  const capabilitySignature = getDesktopPinCapabilitySignature(entity);
  if (root.dataset.capabilitySignature !== capabilitySignature) {
    root.replaceWith(createDesktopPinLightControlElement(entity));
    return true;
  }
  const layout = getDesktopPinLightLayout();
  const interactionBrightness = Number(interaction?.brightnessPct);
  const brightnessPct = Number.isFinite(interactionBrightness)
    ? Math.max(0, Math.min(100, Math.round(interactionBrightness)))
    : getLightBrightnessPercent(entity);
  const isOn = interaction?.active ? brightnessPct > 0 : entity.state === 'on' || brightnessPct > 0;

  root.dataset.layout = layout;
  root.dataset.entityId = entity.entity_id;

  const displayName = utils.getEntityDisplayName(entity);
  const name = root.querySelector('.desktop-pin-light-name');
  if (name) {
    name.textContent = displayName;
  }
  root.title = displayName;

  applyDesktopPinLightVisualState(root, { isOn, brightnessPct });
  return true;
}

function queueDesktopPinLightBrightness(entity, brightnessPct) {
  const entityId = entity?.entity_id;
  if (!entityId) return;

  const safePct = Math.max(0, Math.min(100, Math.round(Number(brightnessPct) || 0)));
  const existingTimer = desktopPinLightBrightnessTimers.get(entityId);
  if (existingTimer) {
    clearTimeout(existingTimer);
  }

  const timer = setTimeout(() => {
    desktopPinLightBrightnessTimers.delete(entityId);

    const currentEntity = state.STATES?.[entityId] || entity;
    const entityName = utils.getEntityDisplayName(currentEntity || entity);
    const serviceData =
      safePct <= 0 ? { entity_id: entityId } : { entity_id: entityId, brightness_pct: safePct };
    const serviceName = safePct <= 0 ? 'turn_off' : 'turn_on';

    websocket
      .callService('light', serviceName, serviceData)
      .catch((error) => handleDesktopPinServiceError(error, entityId, entityName));
  }, 110);

  desktopPinLightBrightnessTimers.set(entityId, timer);
}

function createDesktopPinLightControlElement(entity) {
  const div = document.createElement('div');
  const capabilities = getDesktopPinCapabilities(entity);
  const layout = getDesktopPinLightLayout();
  const interaction = getDesktopPinLightInteraction(entity?.entity_id);
  const interactionBrightness = Number(interaction?.brightnessPct);
  const brightnessPct = Number.isFinite(interactionBrightness)
    ? Math.max(0, Math.min(100, Math.round(interactionBrightness)))
    : getLightBrightnessPercent(entity);
  const isOn = interaction?.active
    ? brightnessPct > 0
    : entity?.state === 'on' || brightnessPct > 0;
  const entityName = utils.getEntityDisplayName(entity);
  const displayName = utils.escapeHtml(entityName);

  div.className = 'control-item desktop-pin-control desktop-pin-light-control';
  div.dataset.desktopPin = 'true';
  div.dataset.entityId = entity.entity_id;
  div.dataset.layout = layout;
  div.dataset.canSetBrightness = capabilities.canSetBrightness ? 'true' : 'false';
  div.dataset.capabilitySignature = getDesktopPinCapabilitySignature(entity);
  // The name wraps to two lines and is then cut, so the tooltip carries the whole of it.
  div.title = entityName;
  div.innerHTML = `
    <div class="desktop-pin-light-shell">
      <div class="desktop-pin-light-topline">
        <div class="desktop-pin-light-glyph">${entityIconMarkup(entity)}</div>
        <div class="desktop-pin-light-meta">
          <div class="desktop-pin-light-name">${displayName}</div>
          <div class="desktop-pin-light-status">${utils.escapeHtml(
            capabilities.canSetBrightness
              ? isOn
                ? t('{{percent}}% brightness', { percent: brightnessPct })
                : t('Use slider or a preset')
              : isOn
                ? t('On')
                : t('Off')
          )}</div>
        </div>
        <button class="desktop-pin-power desktop-pin-light-power" type="button">${lineIconMarkup('power')}</button>
      </div>
      ${
        capabilities.canSetBrightness
          ? `<div class="desktop-pin-light-brightness">
        <div class="desktop-pin-light-brightness-head">
          <div class="desktop-pin-light-brightness-copy">
            <div class="desktop-pin-light-brightness-label">${utils.escapeHtml(t('Brightness'))}</div>
            <div class="desktop-pin-light-meter-value">${formatPercent(brightnessPct)}</div>
          </div>
        </div>
        <div class="desktop-pin-panel-progress desktop-pin-light-brightness-track">
          <div class="desktop-pin-panel-progress-fill desktop-pin-light-brightness-fill"></div>
          <input class="desktop-pin-light-slider" type="range" min="0" max="100" step="1" value="${brightnessPct}" aria-label="${escapeHtmlAttribute(t('Light brightness'))}" />
        </div>
      </div>
      <div class="desktop-pin-light-presets">
        ${DESKTOP_PIN_LIGHT_PRESETS.map(
          (percent) =>
            `<button class="desktop-pin-light-preset" type="button" data-brightness="${percent}" aria-label="${escapeHtmlAttribute(t('{{percent}}% brightness', { percent }))}">${formatPercent(percent)}</button>`
        ).join('')}
      </div>`
          : ''
      }
    </div>
  `;

  applyDesktopPinLightVisualState(div, { isOn, brightnessPct });

  const stopEvent = (event) => {
    event.preventDefault();
    event.stopPropagation();
  };

  const slider = div.querySelector('.desktop-pin-light-slider');
  if (slider) {
    slider.addEventListener(
      'pointerdown',
      (event) => {
        event.stopPropagation();
        setDesktopPinLightInteraction(entity.entity_id, {
          active: true,
          brightnessPct: Number(slider.value),
        });
      },
      true
    );

    ['pointerdown', 'mousedown', 'click'].forEach((eventName) => {
      slider.addEventListener(
        eventName,
        (event) => {
          event.stopPropagation();
        },
        true
      );
    });

    slider.addEventListener('input', (event) => {
      event.stopPropagation();
      const nextPct = Math.max(0, Math.min(100, Math.round(Number(event.target.value) || 0)));
      setDesktopPinLightInteraction(entity.entity_id, {
        active: true,
        brightnessPct: nextPct,
      });
      applyDesktopPinLightVisualState(div, { isOn: nextPct > 0, brightnessPct: nextPct });
      queueDesktopPinLightBrightness(state.STATES?.[entity.entity_id] || entity, nextPct);
    });

    ['change', 'pointerup', 'pointercancel'].forEach((eventName) => {
      slider.addEventListener(
        eventName,
        () => {
          scheduleDesktopPinLightInteractionRelease(entity.entity_id);
        },
        true
      );
    });
  }

  div.querySelectorAll('.desktop-pin-light-preset').forEach((button) => {
    ['pointerdown', 'mousedown'].forEach((eventName) => {
      button.addEventListener(eventName, stopEvent, true);
    });
    button.addEventListener(
      'click',
      (event) => {
        stopEvent(event);
        const nextPct = Number(button.dataset.brightness || 0);
        setDesktopPinLightInteraction(entity.entity_id, {
          active: false,
          brightnessPct: nextPct,
        });
        scheduleDesktopPinLightInteractionRelease(entity.entity_id);
        applyDesktopPinLightVisualState(div, { isOn: nextPct > 0, brightnessPct: nextPct });
        queueDesktopPinLightBrightness(state.STATES?.[entity.entity_id] || entity, nextPct);
      },
      true
    );
  });

  bindDesktopPinButton(div.querySelector('.desktop-pin-light-power'), () => {
    toggleEntity(state.STATES?.[entity.entity_id] || entity);
  });

  div.addEventListener(
    'click',
    (event) => {
      if (typeof event.button === 'number' && event.button !== 0) return;
      if (shouldBlockInteraction(div)) {
        stopDesktopPinEvent(event, true);
        return;
      }

      const target = event.target;
      // A dimming click that lands a few pixels off the track must not switch the light off.
      if (
        target instanceof Element &&
        target.closest('.desktop-pin-light-brightness, .desktop-pin-light-presets')
      ) {
        return;
      }

      stopDesktopPinEvent(event, true);
      toggleEntity(state.STATES?.[entity.entity_id] || entity);
    },
    true
  );

  return div;
}

function createDesktopPinPanelRoot(entity, extraClassNames = [], options = {}) {
  const resolvedEntity = getEntityForDisplay(entity);
  const domain = options.domain || getEntityDomain(resolvedEntity.entity_id);
  const layout = getDesktopPinLayoutProfile(domain).layout;
  const classNames = [
    'control-item',
    'desktop-pin-control',
    'desktop-pin-panel-control',
    ...extraClassNames,
  ]
    .filter(Boolean)
    .join(' ');
  const div = document.createElement('div');
  div.className = classNames;
  div.dataset.desktopPin = 'true';
  div.dataset.entityId = resolvedEntity.entity_id;
  div.dataset.layout = layout;
  div.dataset.domain = domain;
  if (options.state) {
    div.dataset.state = options.state;
  }
  // A small pin cuts a long name with an ellipsis, so the tile's tooltip carries the whole name.
  div.title = options.title || utils.getEntityDisplayName(resolvedEntity);
  return div;
}

// Draws the name in a pin's header and refreshes the tooltip, so a renamed entity is not stale.
function syncDesktopPinPanelName(root, entity) {
  const displayName = utils.getEntityDisplayName(entity);
  const name = root.querySelector('.desktop-pin-panel-name');
  if (name) name.textContent = displayName;
  root.title = displayName;
}

function getDesktopPinPanelHeaderMarkup(entity, { statusText = '', asideMarkup = '' } = {}) {
  const displayName = utils.escapeHtml(utils.getEntityDisplayName(entity));
  const safeStatus = utils.escapeHtml(statusText);
  return `
    <div class="desktop-pin-panel-topline">
      <div class="desktop-pin-panel-meta">
        <div class="desktop-pin-panel-name">${displayName}</div>
        ${safeStatus ? `<div class="desktop-pin-panel-status">${safeStatus}</div>` : ''}
      </div>
      ${asideMarkup || ''}
    </div>
  `;
}

// A button's label sits in its own span, so a long translation is cut with an ellipsis instead of
// running out of the button.
function desktopPinButtonLabelMarkup(text) {
  return `<span class="desktop-pin-panel-button-label">${utils.escapeHtml(text || '')}</span>`;
}

// Sets the label of a button built with desktopPinButtonLabelMarkup.
function setDesktopPinButtonLabel(button, text) {
  const label = button?.querySelector('.desktop-pin-panel-button-label');
  if (label) label.textContent = text;
  else if (button) button.textContent = text;
}

// `pressed` is for buttons that are a switch whose label stays put (a climate mode). A momentary
// command, or a button whose label names its state, is not "pressed" and carries no aria-pressed.
function createDesktopPinButtonMarkup({
  className,
  label,
  ariaLabel = '',
  icon = '',
  active = false,
  action = '',
  title = '',
  pressed,
}) {
  const safeLabel = utils.escapeHtml(label || '');
  const safeAriaLabel = escapeHtmlAttribute(ariaLabel || label || '');
  const safeIcon = utils.escapeHtml(icon || '');
  const safeTitle = escapeHtmlAttribute(title || ariaLabel || label || '');
  const safeAction = escapeHtmlAttribute(action || '');
  return `
    <button
      class="${className}"
      type="button"
      aria-label="${safeAriaLabel}"
      ${title ? `title="${safeTitle}"` : ''}
      ${action ? `data-action="${safeAction}"` : ''}
      data-active="${active ? 'true' : 'false'}"
      ${typeof pressed === 'boolean' ? `aria-pressed="${pressed ? 'true' : 'false'}"` : ''}
    >
      ${safeIcon ? `<span class="desktop-pin-panel-button-icon">${safeIcon}</span>` : ''}
      ${safeLabel ? `<span class="desktop-pin-panel-button-label">${safeLabel}</span>` : ''}
    </button>
  `;
}

function getOptionalFiniteControlNumber(rawValue) {
  if (
    rawValue === null ||
    rawValue === undefined ||
    (typeof rawValue === 'string' && rawValue.trim() === '')
  ) {
    return null;
  }
  const value = Number(rawValue);
  return Number.isFinite(value) ? value : null;
}

function getDesktopPinClimateValue(entity) {
  const capabilities = getDesktopPinCapabilities(entity);
  const currentTemp = getOptionalFiniteControlNumber(entity?.attributes?.current_temperature);
  const targetTemp = getOptionalFiniteControlNumber(entity?.attributes?.temperature);
  const interaction = getDesktopPinControlInteraction(entity?.entity_id);
  const targetValue = getOptionalFiniteControlNumber(interaction?.value);
  const minTemp = getOptionalFiniteControlNumber(entity?.attributes?.min_temp);
  const maxTemp = getOptionalFiniteControlNumber(entity?.attributes?.max_temp);
  return {
    currentTemp,
    targetTemp: targetValue !== null ? targetValue : targetTemp !== null ? targetTemp : null,
    mode: interaction?.mode || entity?.state || 'off',
    unit:
      entity?.attributes?.temperature_unit ||
      entity?.attributes?.unit_of_measurement ||
      state.UNIT_SYSTEM?.temperature ||
      '°',
    canSetRange: capabilities.canSetRange,
    targetLow: getOptionalFiniteControlNumber(entity?.attributes?.target_temp_low),
    targetHigh: getOptionalFiniteControlNumber(entity?.attributes?.target_temp_high),
    minTemp,
    maxTemp,
    targetTempStep:
      Number.isFinite(Number(entity?.attributes?.target_temp_step)) &&
      Number(entity.attributes.target_temp_step) > 0
        ? Number(entity.attributes.target_temp_step)
        : getDefaultTemperatureStep(state.UNIT_SYSTEM?.temperature),
    canSetTemperature: !!capabilities.canSetTemperature,
    modes: capabilities.hvacModes || [],
  };
}

function applyDesktopPinClimateVisualState(root, climateValue) {
  if (!root || !climateValue) return;
  const { currentTemp, targetTemp, mode, unit } = climateValue;
  const denseVariant = root.dataset.denseVariant || 'standard';
  const compactStatus = denseVariant === 'tight' || denseVariant === 'micro';
  root.dataset.state = mode || 'off';
  const hasTargetRange =
    Number.isFinite(targetTemp) &&
    Number.isFinite(climateValue.minTemp) &&
    Number.isFinite(climateValue.maxTemp);
  root.style.setProperty(
    '--desktop-pin-progress',
    hasTargetRange
      ? String(
          Math.max(
            0,
            Math.min(
              1,
              (targetTemp - climateValue.minTemp) /
                Math.max(1, climateValue.maxTemp - climateValue.minTemp)
            )
          )
        )
      : '0'
  );

  const target = root.querySelector('.desktop-pin-climate-target-value');
  if (target) target.textContent = formatTemperature(targetTemp, unit);

  const current = root.querySelector('.desktop-pin-climate-current-value');
  if (current) current.textContent = formatTemperature(currentTemp, unit);

  const compactCurrent = root.querySelector('.desktop-pin-climate-inline-copy');
  if (compactCurrent) {
    compactCurrent.textContent =
      currentTemp == null
        ? t('No live room temperature')
        : t('Now {{temperature}}', {
            temperature: isolateLtr(formatTemperature(currentTemp, unit)),
          });
  }

  const headerKpi = root.querySelector('.desktop-pin-climate-kpi');
  if (headerKpi) {
    headerKpi.textContent = formatTemperature(targetTemp ?? currentTemp, unit);
  }

  const status = root.querySelector('.desktop-pin-panel-status');
  if (status) {
    const modeLabel = formatDesktopPinClimateModeLabel(mode || 'off');
    status.textContent = compactStatus ? modeLabel : t('{{mode}} mode', { mode: modeLabel });
  }

  const slider = root.querySelector('.desktop-pin-climate-slider');
  if (slider && slider.value !== String(targetTemp)) {
    slider.value = String(targetTemp);
  }

  root.querySelectorAll('.desktop-pin-climate-mode').forEach((button) => {
    // Mode buttons carry their mode in data-action (see createDesktopPinButtonMarkup).
    const isActive = button.dataset.action === mode;
    button.dataset.active = isActive ? 'true' : 'false';
    button.setAttribute('aria-pressed', isActive ? 'true' : 'false');
  });
  if (climateValue.canSetRange) {
    climateRangeControllers
      .get(root)
      ?.sync({ low: climateValue.targetLow, high: climateValue.targetHigh });
  }
}

function createDesktopPinClimateControlElement(entity) {
  const renderProfile = getDesktopPinClimateRenderProfile(entity);
  const { climateValue } = renderProfile;
  const root = createDesktopPinPanelRoot(entity, ['desktop-pin-climate-control'], {
    domain: 'climate',
    state: climateValue.mode,
  });
  const climateStatus = renderProfile.showCompactCurrent
    ? formatDesktopPinClimateModeLabel(climateValue.mode || 'off')
    : t('{{mode}} mode', { mode: formatDesktopPinClimateModeLabel(climateValue.mode || 'off') });
  const currentSummary = utils.escapeHtml(
    climateValue.currentTemp == null
      ? t('No live room temperature')
      : t('Now {{temperature}}', {
          temperature: isolateLtr(formatTemperature(climateValue.currentTemp, climateValue.unit)),
        })
  );
  const currentTempText = utils.escapeHtml(
    formatTemperature(climateValue.currentTemp, climateValue.unit)
  );
  const targetTempText = utils.escapeHtml(
    formatTemperature(climateValue.targetTemp, climateValue.unit)
  );
  root.dataset.layout = renderProfile.layout;
  root.dataset.denseVariant = renderProfile.denseVariant;
  root.dataset.capabilitySignature = getDesktopPinCapabilitySignature(entity);

  root.innerHTML = `
    <div class="desktop-pin-panel-shell">
      ${getDesktopPinPanelHeaderMarkup(entity, {
        statusText: climateStatus,
        asideMarkup: `<div class="desktop-pin-panel-kpi desktop-pin-climate-kpi">${utils.escapeHtml(
          formatTemperature(climateValue.targetTemp ?? climateValue.currentTemp, climateValue.unit)
        )}</div>`,
      })}
      <div class="desktop-pin-panel-body">
        ${
          climateValue.canSetRange && (renderProfile.isDenseTight || renderProfile.isDenseMicro)
            ? ''
            : renderProfile.showCurrentStat
              ? `
          <div class="desktop-pin-climate-summary">
            <div class="desktop-pin-panel-stat">
              <span class="desktop-pin-panel-stat-label">${utils.escapeHtml(t('Current'))}</span>
              <span class="desktop-pin-climate-current-value">${currentTempText}</span>
            </div>
            <div class="desktop-pin-panel-stat desktop-pin-panel-stat-emphasis">
              <span class="desktop-pin-panel-stat-label">${utils.escapeHtml(t('Target'))}</span>
              <span class="desktop-pin-climate-target-value">${targetTempText}</span>
            </div>
          </div>
        `
              : `
          <div class="desktop-pin-panel-stat desktop-pin-panel-stat-emphasis desktop-pin-climate-target-stat">
            <span class="desktop-pin-panel-stat-label">${utils.escapeHtml(t('Target'))}</span>
            <span class="desktop-pin-climate-target-value">${targetTempText}</span>
          </div>
        `
        }
        ${renderProfile.showCompactCurrent ? `<div class="desktop-pin-panel-caption desktop-pin-climate-inline-copy">${currentSummary}</div>` : ''}
        ${
          climateValue.canSetTemperature
            ? `<div class="desktop-pin-panel-slider-row ${renderProfile.showSliderLabels ? '' : 'desktop-pin-panel-slider-row-solo'}">
          ${renderProfile.showSliderLabels ? `<span class="desktop-pin-panel-slider-label">${utils.escapeHtml(translateInContext('Color temperature: Cool', 'Cool'))}</span>` : ''}
          <input class="desktop-pin-panel-slider desktop-pin-climate-slider" type="range" min="${climateValue.minTemp}" max="${climateValue.maxTemp}" step="${climateValue.targetTempStep}" value="${climateValue.targetTemp}" aria-label="${escapeHtmlAttribute(t('Target temperature'))}" />
          ${renderProfile.showSliderLabels ? `<span class="desktop-pin-panel-slider-label">${utils.escapeHtml(t('Warm'))}</span>` : ''}
        </div>`
            : ''
        }
        ${climateRangeMarkup(getClimateControlCapabilities(entity), { pin: true })}
        ${
          renderProfile.modesToShow.length
            ? `<div class="desktop-pin-panel-actions desktop-pin-climate-modes">
          ${renderProfile.modesToShow
            .map((mode) =>
              createDesktopPinButtonMarkup({
                className: 'desktop-pin-panel-button desktop-pin-climate-mode',
                label: formatDesktopPinClimateModeLabel(mode),
                ariaLabel: t('Set mode to {{mode}}', {
                  mode: formatDesktopPinClimateModeLabel(mode),
                }),
                action: mode,
                active: mode === climateValue.mode,
                pressed: mode === climateValue.mode,
                title: formatDesktopPinClimateModeLabel(mode),
              })
            )
            .join('')}
        </div>`
            : ''
        }
      </div>
    </div>
  `;

  bindClimateRangeControls(root, entity, getClimateControlCapabilities(entity), (range) => {
    const text = `${formatNumber(range.low)}–${formatMeasurement(range.high, climateValue.unit)}`;
    root
      .querySelectorAll('.desktop-pin-climate-target-value, .desktop-pin-climate-kpi')
      .forEach((element) => {
        element.textContent = text;
      });
  });
  applyDesktopPinClimateVisualState(root, climateValue);

  const liveEntity = () => state.STATES?.[entity.entity_id] || entity;
  const slider = root.querySelector('.desktop-pin-climate-slider');
  bindDesktopPinSlider(slider, {
    entityId: entity.entity_id,
    getImmediateValue: (input) =>
      Math.round((Number(input?.value) || climateValue.targetTemp) * 10) / 10,
    applyVisualValue: (nextValue) => {
      applyDesktopPinClimateVisualState(root, {
        ...getDesktopPinClimateValue(liveEntity()),
        targetTemp: nextValue,
      });
    },
    queueValue: (nextValue) => {
      queueDesktopPinServiceCall(
        `climate:${entity.entity_id}:temperature`,
        () => {
          const currentEntity = liveEntity();
          websocket
            .callService('climate', 'set_temperature', {
              entity_id: entity.entity_id,
              temperature: nextValue,
            })
            .catch((error) =>
              handleDesktopPinServiceError(
                error,
                entity.entity_id,
                utils.getEntityDisplayName(currentEntity)
              )
            );
        },
        180
      );
    },
  });

  root.querySelectorAll('.desktop-pin-climate-mode').forEach((button) => {
    button.dataset.mode = button.dataset.action;
    bindDesktopPinButton(button, () => {
      const mode = button.dataset.mode || button.textContent.trim();
      climateRangeControllers.get(root)?.cancel();
      setDesktopPinControlInteraction(entity.entity_id, { mode, active: false });
      applyDesktopPinClimateVisualState(root, { ...getDesktopPinClimateValue(liveEntity()), mode });
      scheduleDesktopPinControlInteractionRelease(entity.entity_id, 700);
      websocket
        .callService('climate', 'set_hvac_mode', {
          entity_id: entity.entity_id,
          hvac_mode: mode,
        })
        .catch((error) =>
          handleDesktopPinServiceError(
            error,
            entity.entity_id,
            utils.getEntityDisplayName(liveEntity())
          )
        );
    });
  });

  return root;
}

function updateExistingDesktopPinClimateControl(root, entity) {
  if (!root || !root.classList.contains('desktop-pin-climate-control') || !entity?.entity_id) {
    return false;
  }
  const renderProfile = getDesktopPinClimateRenderProfile(entity);
  if (
    (root.dataset.denseVariant || 'standard') !== renderProfile.denseVariant ||
    root.dataset.capabilitySignature !== getDesktopPinCapabilitySignature(entity)
  ) {
    climateRangeControllers.get(root)?.cancel();
    root.replaceWith(createDesktopPinClimateControlElement(entity));
    return true;
  }
  root.dataset.layout = renderProfile.layout;
  root.dataset.denseVariant = renderProfile.denseVariant;
  syncDesktopPinPanelName(root, entity);
  applyDesktopPinClimateVisualState(root, renderProfile.climateValue);
  return true;
}

function getDesktopPinFanValue(entity) {
  const capabilities = getDesktopPinCapabilities(entity);
  const interaction = getDesktopPinControlInteraction(entity?.entity_id);
  const interactionValue = Number(interaction?.value);
  const rawPercent = Number(entity?.attributes?.percentage);
  const percentage = Number.isFinite(interactionValue)
    ? Math.max(0, Math.min(100, Math.round(interactionValue)))
    : Number.isFinite(rawPercent)
      ? Math.max(0, Math.min(100, Math.round(rawPercent)))
      : 0;
  const isOn = interaction?.active ? percentage > 0 : entity?.state === 'on' || percentage > 0;
  return { percentage, isOn, canSetPercentage: !!capabilities.canSetPercentage };
}

function applyDesktopPinFanVisualState(root, fanValue) {
  if (!root || !fanValue) return;
  const { percentage, isOn } = fanValue;
  const canSetPercentage = root.dataset.canSetPercentage === 'true';
  const denseVariant = root.dataset.denseVariant || 'standard';
  const compactStatus = denseVariant === 'tight' || denseVariant === 'micro';
  root.dataset.state = isOn ? 'on' : 'off';
  root.style.setProperty(
    '--desktop-pin-progress',
    String(Math.max(0, Math.min(1, percentage / 100)))
  );

  const kpiText = isOn ? (canSetPercentage ? formatPercent(percentage) : t('On')) : t('Off');
  const headerKpi = root.querySelector('.desktop-pin-fan-kpi');
  if (headerKpi) headerKpi.textContent = kpiText;

  const meterKpi = root.querySelector('.desktop-pin-fan-value');
  if (meterKpi) meterKpi.textContent = kpiText;

  const spinner = root.querySelector('.desktop-pin-fan-glyph');
  if (spinner) spinner.dataset.active = isOn ? 'true' : 'false';

  const status = root.querySelector('.desktop-pin-panel-status');
  if (status)
    status.textContent = isOn
      ? canSetPercentage
        ? t('{{percent}}% airflow', { percent: percentage })
        : t('On')
      : compactStatus
        ? t('Ready')
        : t('Ready to start');

  const slider = root.querySelector('.desktop-pin-fan-slider');
  if (slider && slider.value !== String(percentage)) {
    slider.value = String(percentage);
  }

  const power = root.querySelector('.desktop-pin-fan-power');
  if (power) setDesktopPinPowerButtonState(power, isOn);
}

function queueDesktopPinFanPercentage(entity, percentage) {
  if (!getDesktopPinCapabilities(entity).canSetPercentage) return;
  queueDesktopPinServiceCall(
    `fan:${entity.entity_id}:percentage`,
    () => {
      const currentEntity = state.STATES?.[entity.entity_id] || entity;
      const entityName = utils.getEntityDisplayName(currentEntity);
      const safePercent = Math.max(0, Math.min(100, Math.round(Number(percentage) || 0)));
      if (safePercent <= 0) {
        websocket
          .callService('fan', 'turn_off', {
            entity_id: entity.entity_id,
          })
          .catch((error) => handleDesktopPinServiceError(error, entity.entity_id, entityName));
        return;
      }
      websocket
        .callService('fan', 'set_percentage', {
          entity_id: entity.entity_id,
          percentage: safePercent,
        })
        .catch((error) => handleDesktopPinServiceError(error, entity.entity_id, entityName));
    },
    140
  );
}

function createDesktopPinFanControlElement(entity) {
  const fanValue = getDesktopPinFanValue(entity);
  const capabilities = getDesktopPinCapabilities(entity);
  const renderProfile = getDesktopPinFanRenderProfile();
  const root = createDesktopPinPanelRoot(entity, ['desktop-pin-fan-control'], {
    domain: 'fan',
    state: fanValue.isOn ? 'on' : 'off',
  });
  const fanKpiText = fanValue.isOn
    ? capabilities.canSetPercentage
      ? formatPercent(fanValue.percentage)
      : t('On')
    : t('Off');
  root.dataset.layout = renderProfile.layout;
  root.dataset.denseVariant = renderProfile.denseVariant;
  root.dataset.canSetPercentage = capabilities.canSetPercentage ? 'true' : 'false';
  root.dataset.capabilitySignature = getDesktopPinCapabilitySignature(entity);

  root.innerHTML = `
    <div class="desktop-pin-panel-shell">
      ${getDesktopPinPanelHeaderMarkup(entity, {
        statusText: fanValue.isOn
          ? capabilities.canSetPercentage
            ? t('{{percent}}% airflow', { percent: fanValue.percentage })
            : t('On')
          : renderProfile.isDenseTight || renderProfile.isDenseMicro
            ? t('Ready')
            : t('Ready to start'),
        asideMarkup: `
          <div class="desktop-pin-panel-aside">
            <button class="desktop-pin-power desktop-pin-fan-power" type="button">${lineIconMarkup('power')}</button>
            ${renderProfile.showHeaderKpi ? `<div class="desktop-pin-panel-kpi desktop-pin-fan-kpi">${utils.escapeHtml(fanKpiText)}</div>` : ''}
          </div>
        `,
      })}
      <div class="desktop-pin-panel-body">
        <div class="desktop-pin-panel-meter">
          <div class="desktop-pin-fan-glyph" data-active="${fanValue.isOn ? 'true' : 'false'}">${entityIconMarkup(entity)}</div>
          <div class="desktop-pin-panel-kpi desktop-pin-fan-value">${utils.escapeHtml(fanKpiText)}</div>
        </div>
        ${
          capabilities.canSetPercentage
            ? `<div class="desktop-pin-panel-slider-row ${renderProfile.showSliderLabels ? '' : 'desktop-pin-panel-slider-row-solo'}">
          ${renderProfile.showSliderLabels ? `<span class="desktop-pin-panel-slider-label">${utils.escapeHtml(t('Still'))}</span>` : ''}
          <input class="desktop-pin-panel-slider desktop-pin-fan-slider" type="range" min="0" max="100" step="1" value="${fanValue.percentage}" aria-label="${escapeHtmlAttribute(t('Fan speed'))}" />
          ${renderProfile.showSliderLabels ? `<span class="desktop-pin-panel-slider-label">${utils.escapeHtml(t('Fast'))}</span>` : ''}
        </div>
        <div class="desktop-pin-panel-actions">
          ${renderProfile.presets
            .map(
              ({ value, label }) => `
            <button class="desktop-pin-panel-button desktop-pin-panel-chip desktop-pin-fan-preset" type="button" data-speed="${value}">${desktopPinButtonLabelMarkup(t(label))}</button>
          `
            )
            .join('')}
        </div>`
            : ''
        }
      </div>
    </div>
  `;

  applyDesktopPinFanVisualState(root, fanValue);

  bindDesktopPinButton(root.querySelector('.desktop-pin-fan-power'), () => {
    queueOnOffToggle(state.STATES?.[entity.entity_id] || entity);
  });

  bindDesktopPinSlider(root.querySelector('.desktop-pin-fan-slider'), {
    entityId: entity.entity_id,
    getImmediateValue: (input) => Math.max(0, Math.min(100, Math.round(Number(input?.value) || 0))),
    applyVisualValue: (nextValue) => {
      applyDesktopPinFanVisualState(root, { percentage: nextValue, isOn: nextValue > 0 });
    },
    queueValue: (nextValue) => {
      queueDesktopPinFanPercentage(state.STATES?.[entity.entity_id] || entity, nextValue);
    },
  });

  root.querySelectorAll('.desktop-pin-fan-preset').forEach((button) => {
    bindDesktopPinButton(button, () => {
      const nextValue = Number(button.dataset.speed || 0);
      setDesktopPinControlInteraction(entity.entity_id, { value: nextValue, active: false });
      applyDesktopPinFanVisualState(root, { percentage: nextValue, isOn: nextValue > 0 });
      scheduleDesktopPinControlInteractionRelease(entity.entity_id, 280);
      queueDesktopPinFanPercentage(state.STATES?.[entity.entity_id] || entity, nextValue);
    });
  });

  return root;
}

function updateExistingDesktopPinFanControl(root, entity) {
  if (!root || !root.classList.contains('desktop-pin-fan-control') || !entity?.entity_id) {
    return false;
  }
  const renderProfile = getDesktopPinFanRenderProfile();
  if (
    (root.dataset.denseVariant || 'standard') !== renderProfile.denseVariant ||
    root.dataset.capabilitySignature !== getDesktopPinCapabilitySignature(entity)
  ) {
    root.replaceWith(createDesktopPinFanControlElement(entity));
    return true;
  }
  root.dataset.layout = renderProfile.layout;
  root.dataset.denseVariant = renderProfile.denseVariant;
  syncDesktopPinPanelName(root, entity);
  applyDesktopPinFanVisualState(root, getDesktopPinFanValue(entity));
  return true;
}

function getDesktopPinCoverValue(entity) {
  const interaction = getDesktopPinControlInteraction(entity?.entity_id);
  const interactionValue = Number(interaction?.value);
  const rawPosition = Number(entity?.attributes?.current_position);
  const position = Number.isFinite(interactionValue)
    ? Math.max(0, Math.min(100, Math.round(interactionValue)))
    : Number.isFinite(rawPosition)
      ? Math.max(0, Math.min(100, Math.round(rawPosition)))
      : entity?.state === 'open'
        ? 100
        : 0;
  return {
    position,
    state: interaction?.mode || entity?.state || (position > 0 ? 'open' : 'closed'),
  };
}

function applyDesktopPinCoverVisualState(root, coverValue) {
  if (!root || !coverValue) return;
  root.dataset.state = coverValue.state || 'closed';
  root.style.setProperty(
    '--desktop-pin-progress',
    String(Math.max(0, Math.min(1, coverValue.position / 100)))
  );

  const value = root.querySelector('.desktop-pin-cover-position');
  if (value) value.textContent = formatPercent(coverValue.position);

  const status = root.querySelector('.desktop-pin-panel-status');
  if (status) status.textContent = getDesktopPinCoverStatusText(coverValue);

  const slider = root.querySelector('.desktop-pin-cover-slider');
  if (slider && slider.value !== String(coverValue.position)) {
    slider.value = String(coverValue.position);
  }

  const sheet = root.querySelector('.desktop-pin-cover-shade');
  if (sheet) {
    sheet.style.height = `${100 - coverValue.position}%`;
  }
}

// The state word. The position is the number in the header, so the status does not print it again.
function getDesktopPinCoverStatusText(coverValue) {
  return getLocalizedEntityStateLabel(coverValue.state || 'closed');
}

function queueDesktopPinCoverPosition(entity, position) {
  if (!getDesktopPinCapabilities(entity).canSetPosition) return;
  queueDesktopPinServiceCall(
    `cover:${entity.entity_id}:position`,
    () => {
      const currentEntity = state.STATES?.[entity.entity_id] || entity;
      websocket
        .callService('cover', 'set_cover_position', {
          entity_id: entity.entity_id,
          position: Math.max(0, Math.min(100, Math.round(Number(position) || 0))),
        })
        .catch((error) =>
          handleDesktopPinServiceError(
            error,
            entity.entity_id,
            utils.getEntityDisplayName(currentEntity)
          )
        );
    },
    180
  );
}

function createDesktopPinCoverControlElement(entity) {
  const coverValue = getDesktopPinCoverValue(entity);
  const capabilities = getDesktopPinCapabilities(entity);
  const availableActions = [
    capabilities.canClose ? { action: 'close_cover', label: t('Close') } : null,
    capabilities.canStop ? { action: 'stop_cover', label: t('Stop') } : null,
    capabilities.canOpen
      ? { action: 'open_cover', label: translateInContext('Action: Open', 'Open') }
      : null,
  ].filter(Boolean);
  const renderProfile = getDesktopPinCoverRenderProfile();
  const root = createDesktopPinPanelRoot(entity, ['desktop-pin-cover-control'], {
    domain: 'cover',
    state: coverValue.state,
  });
  root.dataset.layout = renderProfile.layout;
  root.dataset.denseVariant = renderProfile.denseVariant;
  root.dataset.canSetPosition = capabilities.canSetPosition ? 'true' : 'false';
  root.dataset.capabilitySignature = getDesktopPinCapabilitySignature(entity);

  root.innerHTML = `
    <div class="desktop-pin-panel-shell">
      ${getDesktopPinPanelHeaderMarkup(entity, {
        statusText: getDesktopPinCoverStatusText(coverValue),
        // Without a settable position the status already says all there is to say.
        asideMarkup:
          capabilities.canSetPosition && !renderProfile.showMeter
            ? `<div class="desktop-pin-panel-kpi desktop-pin-cover-position">${formatPercent(coverValue.position)}</div>`
            : '',
      })}
      <div class="desktop-pin-panel-body">
        ${
          renderProfile.showMeter && capabilities.canSetPosition
            ? `
          <div class="desktop-pin-panel-meter">
            <div class="desktop-pin-panel-glyph">${entityIconMarkup(entity)}</div>
            <div class="desktop-pin-panel-kpi desktop-pin-cover-position">${formatPercent(coverValue.position)}</div>
          </div>
        `
            : ''
        }
        ${
          renderProfile.showVisual && capabilities.canSetPosition
            ? `
          <div class="desktop-pin-cover-visual">
            <div class="desktop-pin-cover-frame">
              <div class="desktop-pin-cover-shade" style="height: ${100 - coverValue.position}%"></div>
            </div>
          </div>
        `
            : ''
        }
        ${
          capabilities.canSetPosition
            ? `<div class="desktop-pin-panel-slider-row ${renderProfile.showSliderLabels ? '' : 'desktop-pin-panel-slider-row-solo'}">
          ${renderProfile.showSliderLabels ? `<span class="desktop-pin-panel-slider-label">${utils.escapeHtml(t('Closed'))}</span>` : ''}
          <input class="desktop-pin-panel-slider desktop-pin-cover-slider" type="range" min="0" max="100" step="1" value="${coverValue.position}" aria-label="${escapeHtmlAttribute(t('Cover position'))}" />
          ${renderProfile.showSliderLabels ? `<span class="desktop-pin-panel-slider-label">${utils.escapeHtml(t('Open'))}</span>` : ''}
        </div>`
            : ''
        }
        ${
          availableActions.length
            ? `<div class="desktop-pin-panel-actions">
          ${availableActions
            .map(
              ({ action, label }) =>
                `<button class="desktop-pin-panel-button desktop-pin-panel-chip desktop-pin-cover-action" type="button" data-action="${action}" title="${escapeHtmlAttribute(label)}">${desktopPinButtonLabelMarkup(label)}</button>`
            )
            .join('')}
        </div>`
            : `<div class="desktop-pin-panel-caption">${utils.escapeHtml(t("This cover can't be moved from here."))}</div>`
        }
      </div>
    </div>
  `;

  applyDesktopPinCoverVisualState(root, coverValue);

  bindDesktopPinSlider(root.querySelector('.desktop-pin-cover-slider'), {
    entityId: entity.entity_id,
    getImmediateValue: (input) => Math.max(0, Math.min(100, Math.round(Number(input?.value) || 0))),
    applyVisualValue: (nextValue) => {
      applyDesktopPinCoverVisualState(root, {
        position: nextValue,
        state: nextValue > 0 ? 'open' : 'closed',
      });
    },
    queueValue: (nextValue) => {
      queueDesktopPinCoverPosition(state.STATES?.[entity.entity_id] || entity, nextValue);
    },
  });

  root.querySelectorAll('.desktop-pin-cover-action').forEach((button) => {
    bindDesktopPinButton(button, () => {
      const action = button.dataset.action;
      cancelDesktopPinServiceCall(`cover:${entity.entity_id}:position`);
      const optimisticPosition =
        action === 'open_cover'
          ? 100
          : action === 'close_cover'
            ? 0
            : getDesktopPinCoverValue(state.STATES?.[entity.entity_id] || entity).position;
      setDesktopPinControlInteraction(entity.entity_id, {
        value: optimisticPosition,
        mode: action === 'stop_cover' ? 'stopped' : optimisticPosition > 0 ? 'open' : 'closed',
        active: false,
      });
      applyDesktopPinCoverVisualState(root, {
        position: optimisticPosition,
        state: action === 'stop_cover' ? 'stopped' : optimisticPosition > 0 ? 'open' : 'closed',
      });
      scheduleDesktopPinControlInteractionRelease(entity.entity_id, 700);
      websocket
        .callService('cover', action, {
          entity_id: entity.entity_id,
        })
        .catch((error) =>
          handleDesktopPinServiceError(
            error,
            entity.entity_id,
            utils.getEntityDisplayName(state.STATES?.[entity.entity_id] || entity)
          )
        );
    });
  });

  return root;
}

function updateExistingDesktopPinCoverControl(root, entity) {
  if (!root || !root.classList.contains('desktop-pin-cover-control') || !entity?.entity_id) {
    return false;
  }
  const renderProfile = getDesktopPinCoverRenderProfile();
  if (
    (root.dataset.denseVariant || 'standard') !== renderProfile.denseVariant ||
    root.dataset.capabilitySignature !== getDesktopPinCapabilitySignature(entity)
  ) {
    root.replaceWith(createDesktopPinCoverControlElement(entity));
    return true;
  }
  root.dataset.layout = renderProfile.layout;
  root.dataset.denseVariant = renderProfile.denseVariant;
  syncDesktopPinPanelName(root, entity);
  const glyph = root.querySelector('.desktop-pin-panel-glyph');
  if (glyph) renderEntityIcon(glyph, entity);
  applyDesktopPinCoverVisualState(root, getDesktopPinCoverValue(entity));
  return true;
}

// States in which a player has something loaded; an idle, off or standby player has not.
const DESKTOP_PIN_MEDIA_ACTIVE_STATES = new Set(['playing', 'paused', 'buffering']);

function getDesktopPinMediaValue(entity) {
  const timeline = getMediaTimeline(entity);
  const state = typeof entity?.state === 'string' ? entity.state : '';
  return {
    title: entity?.attributes?.media_title || '',
    artist: entity?.attributes?.media_artist || entity?.attributes?.media_album_name || '',
    playing: state === 'playing',
    paused: state === 'paused',
    active: DESKTOP_PIN_MEDIA_ACTIVE_STATES.has(state),
    stateLabel: getLocalizedEntityStateLabel(state),
    progress:
      timeline.duration > 0
        ? Math.max(0, Math.min(100, (timeline.currentPosition / timeline.duration) * 100))
        : 0,
  };
}

// What the pin's header says: Playing or Paused, and for any other state (idle, off, standby,
// buffering) that state, since a switched-off player is not paused.
function getDesktopPinMediaStatusText(mediaValue, renderProfile) {
  if (mediaValue.playing) return renderProfile.statusText.playing;
  if (mediaValue.paused) return renderProfile.statusText.paused;
  return mediaValue.stateLabel;
}

// A player with nothing loaded says so; one that is playing without a title or artist leaves the
// line to the status instead of repeating its state.
function getDesktopPinMediaTitleText(mediaValue) {
  if (mediaValue.title) return mediaValue.title;
  return mediaValue.active ? mediaValue.stateLabel : t('Nothing playing');
}

function getDesktopPinMediaArtistText(mediaValue) {
  if (mediaValue.artist) return mediaValue.artist;
  return mediaValue.active ? '' : t('Ready');
}

function applyDesktopPinMediaVisualState(root, mediaValue) {
  if (!root || !mediaValue) return;
  const renderProfile = getDesktopPinMediaRenderProfile();
  root.dataset.state = mediaValue.playing ? 'playing' : 'paused';
  root.style.setProperty(
    '--desktop-pin-progress',
    String(Math.max(0, Math.min(1, mediaValue.progress / 100)))
  );

  const title = root.querySelector('.desktop-pin-media-title');
  if (title) title.textContent = getDesktopPinMediaTitleText(mediaValue);

  const artist = root.querySelector('.desktop-pin-media-artist');
  if (artist) artist.textContent = getDesktopPinMediaArtistText(mediaValue);

  const play = root.querySelector('.desktop-pin-media-play');
  if (play) {
    setDesktopPinButtonLabel(play, mediaValue.playing ? t('Pause') : t('Play'));
    play.dataset.active = mediaValue.playing ? 'true' : 'false';
    play.dataset.action = mediaValue.playing ? 'pause' : 'play';
  }

  const status = root.querySelector('.desktop-pin-panel-status');
  if (status) status.textContent = getDesktopPinMediaStatusText(mediaValue, renderProfile);

  const bar = root.querySelector('.desktop-pin-panel-progress-fill');
  if (bar) bar.style.width = `${mediaValue.progress}%`;
}

function createDesktopPinMediaControlElement(entity) {
  const mediaValue = getDesktopPinMediaValue(entity);
  const capabilities = getDesktopPinCapabilities(entity);
  const canTogglePlayback = mediaValue.playing ? capabilities.canPause : capabilities.canPlay;
  const mediaActions = [
    capabilities.canPreviousTrack
      ? { action: 'previous_track', label: t('Prev'), className: '' }
      : null,
    canTogglePlayback
      ? {
          action: mediaValue.playing ? 'pause' : 'play',
          label: mediaValue.playing ? t('Pause') : t('Play'),
          className: 'desktop-pin-media-play',
        }
      : null,
    capabilities.canNextTrack ? { action: 'next_track', label: t('Next'), className: '' } : null,
  ].filter(Boolean);
  const renderProfile = getDesktopPinMediaRenderProfile();
  const root = createDesktopPinPanelRoot(entity, ['desktop-pin-media-control'], {
    domain: 'media_player',
    state: mediaValue.playing ? 'playing' : 'paused',
  });
  root.dataset.layout = renderProfile.layout;
  root.dataset.denseVariant = renderProfile.denseVariant;
  root.dataset.capabilitySignature = getDesktopPinCapabilitySignature(entity);
  root.dataset.playbackActionAvailable = canTogglePlayback ? 'true' : 'false';

  root.innerHTML = `
    <div class="desktop-pin-panel-shell">
      ${getDesktopPinPanelHeaderMarkup(entity, {
        statusText: getDesktopPinMediaStatusText(mediaValue, renderProfile),
        // The status line already says Playing or Paused; a second "Live"/"On" note repeated it.
        asideMarkup: '',
      })}
      <div class="desktop-pin-panel-body">
        <div class="desktop-pin-media-copy">
          <div class="desktop-pin-media-title">${utils.escapeHtml(getDesktopPinMediaTitleText(mediaValue))}</div>
          ${renderProfile.showArtist ? `<div class="desktop-pin-media-artist">${utils.escapeHtml(getDesktopPinMediaArtistText(mediaValue))}</div>` : ''}
        </div>
        <div class="desktop-pin-panel-progress">
          <div class="desktop-pin-panel-progress-fill" style="width: ${mediaValue.progress}%"></div>
        </div>
        ${
          mediaActions.length
            ? `<div class="desktop-pin-panel-actions">
          ${mediaActions
            .map(
              ({ action, label, className }) =>
                `<button class="desktop-pin-panel-button desktop-pin-panel-chip desktop-pin-media-action ${className}" type="button" data-action="${action}" data-active="${action === 'pause' ? 'true' : 'false'}">${desktopPinButtonLabelMarkup(label)}</button>`
            )
            .join('')}
        </div>`
            : `<div class="desktop-pin-panel-caption">${utils.escapeHtml(t('No playback controls advertised'))}</div>`
        }
      </div>
    </div>
  `;

  root.querySelectorAll('.desktop-pin-media-action').forEach((button) => {
    bindDesktopPinButton(button, () => {
      const action = button.dataset.action;
      callMediaPlayerService(entity.entity_id, action);
    });
  });

  return root;
}

function updateExistingDesktopPinMediaControl(root, entity) {
  if (!root || !root.classList.contains('desktop-pin-media-control') || !entity?.entity_id) {
    return false;
  }
  const renderProfile = getDesktopPinMediaRenderProfile();
  const capabilities = getDesktopPinCapabilities(entity);
  const canTogglePlayback =
    entity.state === 'playing' ? capabilities.canPause : capabilities.canPlay;
  if (
    (root.dataset.denseVariant || 'standard') !== renderProfile.denseVariant ||
    root.dataset.capabilitySignature !== getDesktopPinCapabilitySignature(entity) ||
    root.dataset.playbackActionAvailable !== (canTogglePlayback ? 'true' : 'false')
  ) {
    root.replaceWith(createDesktopPinMediaControlElement(entity));
    return true;
  }
  root.dataset.layout = renderProfile.layout;
  root.dataset.denseVariant = renderProfile.denseVariant;
  syncDesktopPinPanelName(root, entity);
  applyDesktopPinMediaVisualState(root, getDesktopPinMediaValue(entity));
  return true;
}

function estimateDesktopPinSceneTokenWidth(token, fontSize) {
  if (!token) return fontSize * 0.35;
  let width = 0;
  for (const char of token) {
    if (char === ' ') {
      width += fontSize * 0.34;
    } else if ('ilI1|'.includes(char)) {
      width += fontSize * 0.34;
    } else if ('mwMW@#%&'.includes(char)) {
      width += fontSize * 0.92;
    } else if ('-_.,:;/\\'.includes(char)) {
      width += fontSize * 0.42;
    } else {
      width += fontSize * 0.62;
    }
  }
  return width;
}

function estimateDesktopPinSceneLineCount(text, availableWidth, fontSize) {
  const safeWidth = Math.max(1, Number(availableWidth) || 1);
  const normalizedText = typeof text === 'string' ? text.trim() : '';
  if (!normalizedText) return 1;

  const words = normalizedText.split(/\s+/).filter(Boolean);
  if (!words.length) return 1;

  let lines = 1;
  let currentLineWidth = 0;
  const spaceWidth = estimateDesktopPinSceneTokenWidth(' ', fontSize);

  words.forEach((word) => {
    const wordWidth = estimateDesktopPinSceneTokenWidth(word, fontSize);
    if (wordWidth > safeWidth) {
      const estimatedChunks = Math.max(1, Math.ceil(wordWidth / safeWidth));
      lines += estimatedChunks - 1;
      currentLineWidth = wordWidth / estimatedChunks;
      return;
    }

    const nextWidth = currentLineWidth <= 0 ? wordWidth : currentLineWidth + spaceWidth + wordWidth;
    if (nextWidth > safeWidth) {
      lines += 1;
      currentLineWidth = wordWidth;
    } else {
      currentLineWidth = nextWidth;
    }
  });

  return Math.max(1, lines);
}

function estimateDesktopPinSceneRequiredHeight(width, height, text, domain = 'scene') {
  const metrics = getDesktopPinSceneSizingMetrics(width, height, domain, text);
  const labelWidth = Math.max(1, width - metrics.bodyPad * 2 - metrics.namePadX * 2);
  const lineCount = estimateDesktopPinSceneLineCount(text, labelWidth, metrics.nameFontSize);
  const nameHeight =
    lineCount * metrics.nameFontSize * metrics.nameLineHeight + metrics.namePadY * 2;
  const heroHeight = metrics.heroPad * 2 + metrics.emojiSize;
  return Math.ceil(metrics.bodyPad * 2 + metrics.bodyGap + nameHeight + heroHeight);
}

function doesDesktopPinSceneCandidateFit(root, width, height, domain = 'scene') {
  const nameText = root?.querySelector('.desktop-pin-scene-name')?.textContent || '';
  if (!root?.isConnected || !document?.body) {
    return height >= estimateDesktopPinSceneRequiredHeight(width, height, nameText, domain);
  }

  const measurementRoot = root.cloneNode(true);
  measurementRoot.style.position = 'fixed';
  measurementRoot.style.left = '-10000px';
  measurementRoot.style.top = '0';
  measurementRoot.style.visibility = 'hidden';
  measurementRoot.style.pointerEvents = 'none';
  measurementRoot.style.width = `${width}px`;
  measurementRoot.style.height = `${height}px`;
  measurementRoot.style.minWidth = `${width}px`;
  measurementRoot.style.minHeight = `${height}px`;
  measurementRoot.style.maxWidth = `${width}px`;
  measurementRoot.style.maxHeight = `${height}px`;
  measurementRoot.dataset.layout = (
    domain === 'scene'
      ? getDesktopPinSceneLayoutProfile(domain, { width, height })
      : getDesktopPinLayoutProfile(domain, { width, height })
  ).layout;
  applyDesktopPinSceneSizing(measurementRoot, width, height, domain);
  document.body.appendChild(measurementRoot);

  const measurementBody = measurementRoot.querySelector('.desktop-pin-scene-body');
  const name = measurementRoot.querySelector('.desktop-pin-scene-name');
  const canUseDomMetrics = measurementRoot.clientHeight > 0 && measurementRoot.clientWidth > 0;
  const fitsDom = canUseDomMetrics
    ? measurementRoot.scrollHeight <= measurementRoot.clientHeight + 1 &&
      measurementRoot.scrollWidth <= measurementRoot.clientWidth + 1 &&
      (!measurementBody || measurementBody.scrollHeight <= measurementBody.clientHeight + 1) &&
      (!name || name.scrollWidth <= name.clientWidth + 1)
    : false;
  measurementRoot.remove();

  if (canUseDomMetrics) {
    return fitsDom;
  }

  return height >= estimateDesktopPinSceneRequiredHeight(width, height, nameText, domain);
}

function measureDesktopPinSceneMinBounds(root, entity) {
  const entityId = entity?.entity_id || '';
  if (!root || !entityId || getEntityDomain(entityId) !== 'scene') {
    return null;
  }

  const baseWidth = DESKTOP_PIN_SCENE_BASE_MIN_BOUNDS.width;
  const baseHeight = DESKTOP_PIN_SCENE_BASE_MIN_BOUNDS.height;
  const maxWidth = DESKTOP_PIN_SCENE_DEFAULT_BOUNDS.width;
  const maxHeight = 480;

  if (doesDesktopPinSceneCandidateFit(root, baseWidth, baseHeight, 'scene')) {
    return { width: baseWidth, height: baseHeight };
  }

  if (doesDesktopPinSceneCandidateFit(root, maxWidth, baseHeight, 'scene')) {
    let low = baseWidth;
    let high = maxWidth;
    let best = maxWidth;
    while (low <= high) {
      const mid = Math.floor((low + high) / 2);
      if (doesDesktopPinSceneCandidateFit(root, mid, baseHeight, 'scene')) {
        best = mid;
        high = mid - 1;
      } else {
        low = mid + 1;
      }
    }
    return { width: best, height: baseHeight };
  }

  let low = baseHeight;
  let high = Math.max(baseHeight, DESKTOP_PIN_SCENE_DEFAULT_BOUNDS.height);
  while (high < maxHeight && !doesDesktopPinSceneCandidateFit(root, maxWidth, high, 'scene')) {
    high = Math.min(maxHeight, high + 24);
  }

  let bestHeight = high;
  while (low <= high) {
    const mid = Math.floor((low + high) / 2);
    if (doesDesktopPinSceneCandidateFit(root, maxWidth, mid, 'scene')) {
      bestHeight = mid;
      high = mid - 1;
    } else {
      low = mid + 1;
    }
  }

  return {
    width: maxWidth,
    height: Math.max(baseHeight, bestHeight),
  };
}

function scheduleDesktopPinSceneMinBoundsSync(root, entity) {
  const entityId = entity?.entity_id || '';
  if (!root || !entityId || getEntityDomain(entityId) !== 'scene') return;
  if (root.dataset.desktopPin !== 'true') return;
  if (!window?.electronAPI?.syncDesktopPinContentMinBounds) return;

  const nextSignature = JSON.stringify({
    name: utils.getEntityDisplayName(entity),
    width: window.innerWidth || DESKTOP_PIN_SCENE_DEFAULT_BOUNDS.width,
    height: window.innerHeight || DESKTOP_PIN_SCENE_DEFAULT_BOUNDS.height,
    theme: state.CONFIG?.ui?.theme || 'auto',
    accent: state.CONFIG?.ui?.accent || 'original',
    background: state.CONFIG?.ui?.background || 'original',
    scale: state.CONFIG?.ui?.scale || 1,
  });
  const current = desktopPinSceneMinSyncState.get(entityId) || {};
  if (current.signature === nextSignature && current.pending) {
    return;
  }
  if (current.signature === nextSignature && current.lastSyncedBounds) {
    return;
  }
  if (current.rafId && typeof cancelAnimationFrame === 'function') {
    cancelAnimationFrame(current.rafId);
  }
  if (current.timeoutId) {
    clearTimeout(current.timeoutId);
  }

  const runSync = async () => {
    const latest = desktopPinSceneMinSyncState.get(entityId) || {};
    if (!root.isConnected || !root.closest('#desktop-pin-content')) {
      desktopPinSceneMinSyncState.set(entityId, {
        ...latest,
        pending: false,
        rafId: null,
        timeoutId: null,
      });
      return;
    }

    const minBounds = measureDesktopPinSceneMinBounds(root, entity);
    if (!minBounds) {
      desktopPinSceneMinSyncState.set(entityId, {
        ...latest,
        pending: false,
        rafId: null,
        timeoutId: null,
      });
      return;
    }

    try {
      // DOM measurements are CSS pixels, which is the 100% size main scales pin windows from.
      const result = await window.electronAPI.syncDesktopPinContentMinBounds(entityId, {
        width: Math.ceil(minBounds.width),
        height: Math.ceil(minBounds.height),
      });
      desktopPinSceneMinSyncState.set(entityId, {
        ...latest,
        pending: false,
        signature: nextSignature,
        rafId: null,
        timeoutId: null,
        lastSyncedBounds: result?.success ? minBounds : latest.lastSyncedBounds,
      });
    } catch (error) {
      console.error('Error syncing scene desktop pin minimum bounds:', error);
      desktopPinSceneMinSyncState.set(entityId, {
        ...latest,
        pending: false,
        signature: nextSignature,
        rafId: null,
        timeoutId: null,
      });
    }
  };

  let rafId = null;
  let timeoutId = null;
  const scheduleFrame = () => {
    if (typeof requestAnimationFrame === 'function') {
      rafId = requestAnimationFrame(() => {
        const secondRafId = requestAnimationFrame(() => {
          runSync();
        });
        const latest = desktopPinSceneMinSyncState.get(entityId) || {};
        desktopPinSceneMinSyncState.set(entityId, {
          ...latest,
          rafId: secondRafId,
          timeoutId: null,
        });
      });
      return;
    }
    timeoutId = setTimeout(() => {
      runSync();
    }, 0);
  };

  desktopPinSceneMinSyncState.set(entityId, {
    ...current,
    pending: true,
    signature: nextSignature,
    rafId,
    timeoutId,
  });
  scheduleFrame();
  const latest = desktopPinSceneMinSyncState.get(entityId) || {};
  desktopPinSceneMinSyncState.set(entityId, {
    ...latest,
    pending: true,
    signature: nextSignature,
    rafId,
    timeoutId,
  });
}

function createDesktopPinSceneControlElement(entity) {
  const domain = getEntityDomain(entity.entity_id);
  const layoutProfile =
    domain === 'scene'
      ? getDesktopPinSceneLayoutProfile(domain)
      : getDesktopPinLayoutProfile(domain);
  const root = createDesktopPinPanelRoot(entity, ['desktop-pin-scene-control'], {
    domain,
    state: entity.state,
  });
  root.dataset.layout = layoutProfile.layout;
  // The whole tile is the button, so it is reachable and runnable from the keyboard too.
  root.setAttribute('role', 'button');
  root.tabIndex = 0;
  root.setAttribute('aria-label', utils.getEntityDisplayName(entity));

  root.innerHTML = `
    <div class="desktop-pin-scene-shell">
      <div class="desktop-pin-scene-body">
        <div class="desktop-pin-scene-hero">
          <div class="desktop-pin-scene-emoji">${entityIconMarkup(entity)}</div>
        </div>
        <div class="desktop-pin-scene-name">${utils.escapeHtml(utils.getEntityDisplayName(entity))}</div>
      </div>
    </div>
  `;
  applyDesktopPinSceneSizing(root, layoutProfile.width, layoutProfile.height, domain);

  root.addEventListener(
    'click',
    (event) => {
      stopDesktopPinEvent(event, true);
      toggleEntity(state.STATES?.[entity.entity_id] || entity);
    },
    true
  );
  root.addEventListener('keydown', (event) => {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    // A tile being arranged only moves; pointer-events: none does not stop the keyboard.
    if (document.body.classList.contains('desktop-pin-edit-mode')) return;
    stopDesktopPinEvent(event, true);
    toggleEntity(state.STATES?.[entity.entity_id] || entity);
  });

  scheduleDesktopPinSceneMinBoundsSync(root, entity);

  return root;
}

function syncDesktopPinPanelRootState(root, entity, { domain, title = '' } = {}) {
  if (!root || !entity?.entity_id) return;

  const resolvedDomain = domain || getEntityDomain(entity.entity_id);
  const layout =
    resolvedDomain === 'scene'
      ? getDesktopPinSceneLayoutProfile(resolvedDomain).layout
      : getDesktopPinLayoutProfile(resolvedDomain).layout;

  root.dataset.entityId = entity.entity_id;
  root.dataset.domain = resolvedDomain;
  root.dataset.layout = layout;

  if (typeof entity.state === 'string' && entity.state.trim()) {
    root.dataset.state = entity.state;
  } else {
    delete root.dataset.state;
  }

  root.title = title || utils.getEntityDisplayName(entity);
}

function updateExistingDesktopPinSceneControl(root, entity) {
  if (!root || !root.classList.contains('desktop-pin-scene-control') || !entity?.entity_id) {
    return false;
  }

  const domain = getEntityDomain(entity.entity_id);
  const layoutProfile =
    domain === 'scene'
      ? getDesktopPinSceneLayoutProfile(domain)
      : getDesktopPinLayoutProfile(domain);
  syncDesktopPinPanelRootState(root, entity, {
    domain,
  });

  const emoji = root.querySelector('.desktop-pin-scene-emoji');
  if (emoji) renderEntityIcon(emoji, entity);

  // The sizing reads the name, so it follows the name's update.
  const name = root.querySelector('.desktop-pin-scene-name');
  if (name) name.textContent = utils.getEntityDisplayName(entity);
  root.setAttribute('aria-label', utils.getEntityDisplayName(entity));
  applyDesktopPinSceneSizing(root, layoutProfile.width, layoutProfile.height, domain);

  scheduleDesktopPinSceneMinBoundsSync(root, entity);

  return true;
}

// A lock's button names the action it takes ("Unlock"), so its label says which lock. Other toggles
// show their state as the label, which is the whole of their name.
function getDesktopPinToggleActionAriaLabel(entity) {
  if (getEntityDomain(entity?.entity_id) !== 'lock') return '';
  const name = utils.getEntityDisplayName(entity);
  return entity.state === 'locked' ? t('Unlock {{name}}', { name }) : t('Lock {{name}}', { name });
}

function createDesktopPinToggleEntityControlElement(entity) {
  const domain = getEntityDomain(entity.entity_id);
  const isSceneLike = domain === 'scene' || domain === 'script';
  const isLock = domain === 'lock';
  const isOn = isLock ? entity.state === 'locked' : entity.state === 'on';
  const root = createDesktopPinPanelRoot(entity, ['desktop-pin-toggle-control'], {
    domain,
    state: entity.state,
  });
  const icon = entityIconMarkup(entity);
  const actionLabel = isSceneLike
    ? t('Run')
    : isLock
      ? isOn
        ? t('Unlock')
        : t('Lock')
      : isOn
        ? t('On')
        : t('Off');
  const statusText = isSceneLike ? t('Tap to trigger') : utils.getEntityDisplayState(entity);
  const toggleActionAriaLabel = getDesktopPinToggleActionAriaLabel(entity);

  root.innerHTML = `
    <div class="desktop-pin-panel-shell">
      ${getDesktopPinPanelHeaderMarkup(entity, {
        statusText,
        // The button below already names the action, so only scenes get a header note.
        asideMarkup: isSceneLike
          ? `<div class="desktop-pin-panel-kpi">${utils.escapeHtml(t('Ready'))}</div>`
          : '',
      })}
      <div class="desktop-pin-panel-body desktop-pin-toggle-body">
        <div class="desktop-pin-panel-meter">
          <div class="desktop-pin-panel-glyph">${icon}</div>
          <div class="desktop-pin-panel-kpi">${utils.escapeHtml(isSceneLike ? t('Run') : utils.getEntityDisplayState(entity))}</div>
        </div>
        <div class="desktop-pin-panel-actions">
          <button class="desktop-pin-panel-button desktop-pin-toggle-action" type="button" data-active="${isOn ? 'true' : 'false'}"${toggleActionAriaLabel ? ` aria-label="${escapeHtmlAttribute(toggleActionAriaLabel)}"` : ''}>${desktopPinButtonLabelMarkup(actionLabel)}</button>
        </div>
      </div>
    </div>
  `;

  bindDesktopPinButton(root.querySelector('.desktop-pin-toggle-action'), () => {
    toggleEntity(state.STATES?.[entity.entity_id] || entity);
  });

  return root;
}

function updateExistingDesktopPinToggleEntityControl(root, entity) {
  if (!root || !root.classList.contains('desktop-pin-toggle-control') || !entity?.entity_id) {
    return false;
  }

  const domain = getEntityDomain(entity.entity_id);
  const isSceneLike = domain === 'scene' || domain === 'script';
  const isLock = domain === 'lock';
  const isOn = isLock ? entity.state === 'locked' : entity.state === 'on';
  const actionLabel = isSceneLike
    ? t('Run')
    : isLock
      ? isOn
        ? t('Unlock')
        : t('Lock')
      : isOn
        ? t('On')
        : t('Off');
  const displayState = utils.getEntityDisplayState(entity);

  syncDesktopPinPanelRootState(root, entity, {
    domain,
  });

  syncDesktopPinPanelName(root, entity);

  const status = root.querySelector('.desktop-pin-panel-status');
  if (status) status.textContent = isSceneLike ? t('Tap to trigger') : displayState;

  const headerKpi = root.querySelector('.desktop-pin-panel-topline .desktop-pin-panel-kpi');
  const meterKpi = root.querySelector('.desktop-pin-panel-meter .desktop-pin-panel-kpi');
  if (headerKpi) headerKpi.textContent = t('Ready');
  if (meterKpi) meterKpi.textContent = isSceneLike ? t('Run') : displayState;

  const glyph = root.querySelector('.desktop-pin-panel-glyph');
  if (glyph) renderEntityIcon(glyph, entity);

  const action = root.querySelector('.desktop-pin-toggle-action');
  if (action) {
    setDesktopPinButtonLabel(action, actionLabel);
    action.dataset.active = isOn ? 'true' : 'false';
    const ariaLabel = getDesktopPinToggleActionAriaLabel(entity);
    if (ariaLabel) action.setAttribute('aria-label', ariaLabel);
  }

  return true;
}

function createDesktopPinCameraControlElement(entity) {
  const root = createDesktopPinPanelRoot(entity, ['desktop-pin-camera-control'], {
    domain: 'camera',
    state: entity.state,
  });

  root.innerHTML = `
    <div class="desktop-pin-panel-shell">
      ${getDesktopPinPanelHeaderMarkup(entity, {
        statusText: utils.getEntityDisplayState(entity),
        asideMarkup: '',
      })}
      <div class="desktop-pin-panel-body">
        <div class="desktop-pin-panel-meter desktop-pin-camera-preview">
          <div class="desktop-pin-panel-glyph">${entityIconMarkup(entity)}</div>
          <div class="desktop-pin-panel-caption" title="${escapeHtmlAttribute(t('Open camera feed'))}">${utils.escapeHtml(t('Open camera feed'))}</div>
        </div>
        <div class="desktop-pin-panel-actions">
          <button class="desktop-pin-panel-button desktop-pin-panel-chip desktop-pin-camera-open" type="button">${desktopPinButtonLabelMarkup(translateInContext('Action: Open', 'Open'))}</button>
        </div>
      </div>
    </div>
  `;

  bindDesktopPinButton(root.querySelector('.desktop-pin-camera-open'), () => {
    requestDesktopPinOpenDetails(entity.entity_id);
  });

  return root;
}

function updateExistingDesktopPinCameraControl(root, entity) {
  if (!root || !root.classList.contains('desktop-pin-camera-control') || !entity?.entity_id) {
    return false;
  }

  syncDesktopPinPanelRootState(root, entity, {
    domain: 'camera',
  });

  syncDesktopPinPanelName(root, entity);

  const status = root.querySelector('.desktop-pin-panel-status');
  if (status) status.textContent = utils.getEntityDisplayState(entity);

  const glyph = root.querySelector('.desktop-pin-panel-glyph');
  if (glyph) renderEntityIcon(glyph, entity);

  return true;
}

// What a sensor measures, by Home Assistant's device class. The caption "Sensor" under a sensor
// pin's name says nothing, so the common classes say what the reading is; any other keeps the
// domain name. "Humidity" is the same word everywhere it is used; the others have their own keys
// because "Power", "Current" and "Motion" mean something else in some languages ("On/Off",
// "present", "movement detected").
const DESKTOP_PIN_DEVICE_CLASS_LABELS = Object.freeze({
  temperature: 'Device class: Temperature',
  humidity: 'Humidity',
  power: 'Device class: Power',
  energy: 'Device class: Energy',
  battery: 'Device class: Battery',
  pressure: 'Device class: Pressure',
  illuminance: 'Device class: Illuminance',
  voltage: 'Device class: Voltage',
  current: 'Device class: Current',
  door: 'Device class: Door',
  window: 'Device class: Window',
  motion: 'Device class: Motion',
  occupancy: 'Device class: Occupancy',
});

function getDesktopPinSensorKicker(entity) {
  const key = DESKTOP_PIN_DEVICE_CLASS_LABELS[entity?.attributes?.device_class];
  if (!key) return utils.getEntityTypeDescription(entity);
  return translateInContext(key, key.replace('Device class: ', ''));
}

// The reading a sensor pin shows. Quick Access tiles round a numeric sensor to its precision, so
// the pin does too: unrounded template and Riemann sensors send a dozen decimals.
function getDesktopPinSensorValueText(entity) {
  return getQuickAccessSensorDisplayParts(entity)?.text ?? utils.getEntityDisplayState(entity);
}

function createDesktopPinSensorControlElement(entity) {
  const isBinary = entity.entity_id.startsWith('binary_sensor.');
  const value = getDesktopPinSensorValueText(entity);
  const root = createDesktopPinPanelRoot(entity, ['desktop-pin-sensor-control'], {
    domain: isBinary ? 'binary_sensor' : 'sensor',
    state: entity.state,
  });

  root.innerHTML = `
    <div class="desktop-pin-panel-shell">
      ${getDesktopPinPanelHeaderMarkup(entity, {
        statusText: getDesktopPinSensorKicker(entity),
        asideMarkup: '',
      })}
      <div class="desktop-pin-panel-body">
        <div class="desktop-pin-panel-meter">
          <div class="desktop-pin-panel-glyph">${entityIconMarkup(entity)}</div>
          <div class="desktop-pin-panel-value" title="${escapeHtmlAttribute(value)}">${utils.escapeHtml(value)}</div>
        </div>
      </div>
    </div>
  `;

  return root;
}

function updateExistingDesktopPinSensorControl(root, entity) {
  if (!root || !root.classList.contains('desktop-pin-sensor-control') || !entity?.entity_id) {
    return false;
  }

  const isBinary = entity.entity_id.startsWith('binary_sensor.');
  syncDesktopPinPanelRootState(root, entity, {
    domain: isBinary ? 'binary_sensor' : 'sensor',
  });

  syncDesktopPinPanelName(root, entity);

  const status = root.querySelector('.desktop-pin-panel-status');
  if (status) status.textContent = getDesktopPinSensorKicker(entity);

  const glyph = root.querySelector('.desktop-pin-panel-glyph');
  if (glyph) renderEntityIcon(glyph, entity);

  const value = root.querySelector('.desktop-pin-panel-value');
  if (value) {
    const valueText = getDesktopPinSensorValueText(entity);
    value.textContent = valueText;
    value.title = valueText;
  }

  return true;
}

function getDesktopPinTimerStatusLabel(entity) {
  if (utils.getTimerStatusLabel) return t(utils.getTimerStatusLabel(entity));
  const rawState = typeof entity?.state === 'string' ? entity.state.trim() : '';
  return rawState ? rawState.charAt(0).toUpperCase() + rawState.slice(1) : t('Idle');
}

// Compares against the English status and its translation, so the check holds whether or not the
// shared timer helper already translates its label.
function isDesktopPinTimerStatus(entity, status) {
  const label = getDesktopPinTimerStatusLabel(entity);
  return label === status || label === t(status);
}

function getDesktopPinTimerTileTitle(entity) {
  return t('{{name}} · Timer', { name: utils.getEntityDisplayName(entity) });
}

// The badge carries the run state, so the readout is always a plain countdown — no
// pause glyph or status word competing with the digits.
function getDesktopPinTimerDisplay(entity) {
  const remainingSeconds = getDesktopPinTimerRemainingSeconds(entity);
  if (remainingSeconds == null) {
    return isDesktopPinTimerStatus(entity, 'Finished') ? '0:00' : '—';
  }
  return utils.formatDuration(remainingSeconds * 1000);
}

function getDesktopPinTimerRemainingFraction(entity) {
  return utils.getTimerRemainingFraction ? utils.getTimerRemainingFraction(entity) : null;
}

function getDesktopPinTimerRemainingSeconds(entity) {
  return utils.getTimerRemainingSeconds ? utils.getTimerRemainingSeconds(entity) : null;
}

const DESKTOP_PIN_TIMER_URGENT_SECONDS = 60;

// The countdown is sized to fill the tile, so a longer readout has to step down a size
// to keep fitting: "0:22" gets the full treatment, "1:02:45" does not.
function getDesktopPinTimerReadoutScale(display) {
  const length = String(display || '').length;
  if (length <= 4) return 1;
  if (length === 5) return 0.86;
  if (length === 6) return 0.72;
  return 0.6;
}

function getDesktopPinTimerEndsAtLabel(entity) {
  const remainingSeconds = getDesktopPinTimerRemainingSeconds(entity);
  if (remainingSeconds == null || remainingSeconds <= 0) return '';

  const endsAt = new Date(Date.now() + remainingSeconds * 1000);
  return t('Ends {{time}}', { time: formatClockTime(endsAt) });
}

function applyDesktopPinTimerVisualState(root, entity) {
  if (!root) return;

  const display = getDesktopPinTimerDisplay(entity);
  const remainingSeconds = getDesktopPinTimerRemainingSeconds(entity);
  const isRunning = isDesktopPinTimerStatus(entity, 'Running');

  const readout = root.querySelector('.desktop-pin-timer-readout');
  if (readout) {
    readout.textContent = display;
    readout.style.setProperty(
      '--desktop-pin-timer-readout-scale',
      String(getDesktopPinTimerReadoutScale(display))
    );
  }

  // Running timers are self-evident from the moving digits, so the badge is kept for the
  // states that are not — paused, finished, idle.
  const badge = root.querySelector('.desktop-pin-timer-badge');
  if (badge) {
    badge.textContent = t(getDesktopPinTimerStatusLabel(entity));
    badge.classList.toggle('hidden', isRunning);
  }

  const pulse = root.querySelector('.desktop-pin-timer-pulse');
  if (pulse) pulse.classList.toggle('hidden', !isRunning);

  const endsAt = root.querySelector('.desktop-pin-timer-endsat');
  if (endsAt) {
    const endsAtLabel = isRunning ? getDesktopPinTimerEndsAtLabel(entity) : '';
    endsAt.textContent = endsAtLabel;
    endsAt.classList.toggle('hidden', !endsAtLabel);
  }

  root.dataset.urgent =
    isRunning && remainingSeconds != null && remainingSeconds <= DESKTOP_PIN_TIMER_URGENT_SECONDS
      ? 'true'
      : 'false';

  // Only timers that report a total duration can show how far along they are.
  const remainingFraction = getDesktopPinTimerRemainingFraction(entity);
  const progressFill = root.querySelector('.desktop-pin-timer-progress-fill');
  if (progressFill) {
    progressFill.style.width = `${((remainingFraction ?? 0) * 100).toFixed(1)}%`;
  }
  const progress = root.querySelector('.desktop-pin-timer-progress');
  if (progress) progress.classList.toggle('hidden', remainingFraction == null);
}

function createDesktopPinTimerControlElement(entity) {
  const root = createDesktopPinPanelRoot(entity, ['desktop-pin-timer-control'], {
    domain: 'timer',
    state: entity.state,
    title: getDesktopPinTimerTileTitle(entity),
  });

  root.innerHTML = `
    <div class="desktop-pin-timer-shell">
      <div class="desktop-pin-timer-header">
        <span class="desktop-pin-timer-pulse hidden" aria-hidden="true"></span>
        <div class="desktop-pin-panel-name desktop-pin-timer-name">${utils.escapeHtml(utils.getEntityDisplayName(entity))}</div>
      </div>
      <div class="desktop-pin-timer-hero">
        <div class="desktop-pin-panel-value desktop-pin-timer-readout" role="timer" aria-live="off"></div>
        <div class="desktop-pin-timer-endsat hidden"></div>
        <div class="desktop-pin-timer-badge hidden"></div>
      </div>
    </div>
    <div class="desktop-pin-timer-progress hidden">
      <div class="desktop-pin-timer-progress-fill" style="width: 0%"></div>
    </div>
  `;

  applyDesktopPinTimerVisualState(root, entity);

  return root;
}

function updateExistingDesktopPinTimerControl(root, entity) {
  if (!root || !root.classList.contains('desktop-pin-timer-control') || !entity?.entity_id) {
    return false;
  }

  syncDesktopPinPanelRootState(root, entity, {
    domain: 'timer',
    title: getDesktopPinTimerTileTitle(entity),
  });

  const name = root.querySelector('.desktop-pin-timer-name');
  if (name) name.textContent = utils.getEntityDisplayName(entity);

  applyDesktopPinTimerVisualState(root, entity);

  return true;
}

function getDesktopPinActionCtaLabel(entity) {
  const domain = getEntityDomain(entity?.entity_id);
  if (domain === 'automation') return t('Trigger');
  if (isPressActionDomain(domain)) return t('Press');
  return t('Run');
}

function getDesktopPinActionAriaLabel(entity) {
  const domain = getEntityDomain(entity?.entity_id);
  const name = utils.getEntityDisplayName(entity);
  if (domain === 'automation') return t('Trigger {{name}}', { name });
  if (isPressActionDomain(domain)) return t('Press {{name}}', { name });
  return t('Run {{name}}', { name });
}

function createDesktopPinActionControlElement(entity) {
  const ctaLabel = getDesktopPinActionCtaLabel(entity);
  const root = createDesktopPinPanelRoot(entity, ['desktop-pin-action-control'], {
    domain: getEntityDomain(entity.entity_id),
    state: entity.state,
  });

  root.innerHTML = `
    <div class="desktop-pin-panel-shell">
      ${getDesktopPinPanelHeaderMarkup(entity, {
        statusText: utils.getEntityTypeDescription(entity),
        asideMarkup: `<div class="desktop-pin-panel-kpi">${utils.escapeHtml(t('Ready'))}</div>`,
      })}
      <div class="desktop-pin-panel-body">
        <div class="desktop-pin-panel-meter">
          <div class="desktop-pin-panel-glyph">${entityIconMarkup(entity)}</div>
          <div class="desktop-pin-panel-value">${utils.escapeHtml(ctaLabel)}</div>
        </div>
        <div class="desktop-pin-panel-actions desktop-pin-action-actions">
          ${createDesktopPinButtonMarkup({
            className: 'desktop-pin-panel-button desktop-pin-action-primary',
            label: ctaLabel,
            ariaLabel: getDesktopPinActionAriaLabel(entity),
            active: false,
          })}
        </div>
      </div>
    </div>
  `;

  bindDesktopPinButton(root.querySelector('.desktop-pin-action-primary'), () => {
    triggerActivationFeedback(entity.entity_id);
    const serviceName = isPressActionDomain(getEntityDomain(entity.entity_id))
      ? 'press'
      : 'trigger';
    callEntityDomainService(state.STATES?.[entity.entity_id] || entity, serviceName);
  });

  return root;
}

function updateExistingDesktopPinActionControl(root, entity) {
  if (!root || !root.classList.contains('desktop-pin-action-control') || !entity?.entity_id) {
    return false;
  }

  const ctaLabel = getDesktopPinActionCtaLabel(entity);
  syncDesktopPinPanelRootState(root, entity, {
    domain: getEntityDomain(entity.entity_id),
  });

  syncDesktopPinPanelName(root, entity);

  const status = root.querySelector('.desktop-pin-panel-status');
  if (status) status.textContent = utils.getEntityTypeDescription(entity);

  const kpi = root.querySelector('.desktop-pin-panel-kpi');
  if (kpi) kpi.textContent = t('Ready');

  const glyph = root.querySelector('.desktop-pin-panel-glyph');
  if (glyph) renderEntityIcon(glyph, entity);

  const value = root.querySelector('.desktop-pin-panel-value');
  if (value) value.textContent = ctaLabel;

  const button = root.querySelector('.desktop-pin-action-primary');
  const buttonLabel = button?.querySelector('.desktop-pin-panel-button-label');
  if (buttonLabel) buttonLabel.textContent = ctaLabel;

  return true;
}

function getDesktopPinNumericSpec(entity) {
  const attrs = entity?.attributes || {};
  const interaction = getDesktopPinControlInteraction(entity?.entity_id);
  const rawMin = Number(attrs.min);
  const rawMax = Number(attrs.max);
  const rawStep = Number(attrs.step);
  const hasBounds = Number.isFinite(rawMin) && Number.isFinite(rawMax) && rawMax > rawMin;
  const fallbackStep = hasBounds ? Math.max((rawMax - rawMin) / 20, 1) : 1;
  const step = Number.isFinite(rawStep) && rawStep > 0 ? rawStep : fallbackStep;
  const liveValue = Number(entity?.state);
  const interactionValue = Number(interaction?.value);
  let value = Number.isFinite(interactionValue) ? interactionValue : liveValue;

  if (!Number.isFinite(value)) {
    value = hasBounds ? rawMin : 0;
  }
  if (hasBounds) {
    value = Math.max(rawMin, Math.min(rawMax, value));
  }

  return {
    min: rawMin,
    max: rawMax,
    step,
    value,
    hasBounds,
    unit: attrs.unit_of_measurement || '',
  };
}

function formatDesktopPinNumericValue(value, entity, options = {}) {
  const spec = options.spec || getDesktopPinNumericSpec(entity);
  const safeValue = Number(value);
  if (!Number.isFinite(safeValue)) {
    return utils.getEntityDisplayState(entity);
  }

  return formatNumberEntityValue(safeValue, entity, { step: spec.step });
}

function queueDesktopPinNumericValue(entity, nextValue) {
  const entityId = entity?.entity_id;
  if (!entityId) return;
  const spec = getDesktopPinNumericSpec(entity);
  const safeValue = spec.hasBounds
    ? Math.max(spec.min, Math.min(spec.max, Number(nextValue)))
    : Number(nextValue);
  queueDesktopPinServiceCall(
    `${entityId}:numeric`,
    () => {
      callEntityDomainService(state.STATES?.[entityId] || entity, 'set_value', {
        value: safeValue,
      });
    },
    120
  );
}

function createDesktopPinNumericControlElement(entity) {
  const spec = getDesktopPinNumericSpec(entity);
  const root = createDesktopPinPanelRoot(entity, ['desktop-pin-numeric-control'], {
    domain: getEntityDomain(entity.entity_id),
    state: entity.state,
  });

  const meterMarkup = `
    <div class="desktop-pin-panel-meter">
      <div class="desktop-pin-panel-glyph">${entityIconMarkup(entity)}</div>
      <div class="desktop-pin-panel-value">${utils.escapeHtml(formatDesktopPinNumericValue(spec.value, entity, { spec }))}</div>
    </div>
  `;
  const controlsMarkup = spec.hasBounds
    ? `
      <div class="desktop-pin-panel-slider-row">
        <span class="desktop-pin-panel-slider-label">${utils.escapeHtml(formatDesktopPinNumericValue(spec.min, entity, { spec }))}</span>
      <input class="desktop-pin-panel-slider desktop-pin-numeric-slider" type="range" min="${spec.min}" max="${spec.max}" step="${spec.step}" value="${spec.value}" aria-label="${escapeHtmlAttribute(t('{{name}} value', { name: utils.getEntityDisplayName(entity) }))}" />
        <span class="desktop-pin-panel-slider-label">${utils.escapeHtml(formatDesktopPinNumericValue(spec.max, entity, { spec }))}</span>
      </div>
    `
    : `
      <div class="desktop-pin-panel-actions desktop-pin-numeric-actions">
        ${createDesktopPinButtonMarkup({
          className: 'desktop-pin-panel-button desktop-pin-numeric-step',
          label: '\u2212',
          ariaLabel: t('Decrease {{name}}', { name: utils.getEntityDisplayName(entity) }),
          action: 'decrease',
        })}
        ${createDesktopPinButtonMarkup({
          className: 'desktop-pin-panel-button desktop-pin-numeric-step',
          label: '+',
          ariaLabel: t('Increase {{name}}', { name: utils.getEntityDisplayName(entity) }),
          action: 'increase',
        })}
      </div>
    `;

  root.innerHTML = `
    <div class="desktop-pin-panel-shell">
      ${getDesktopPinPanelHeaderMarkup(entity, {
        statusText: utils.getEntityTypeDescription(entity),
        asideMarkup: `<div class="desktop-pin-panel-kpi">${utils.escapeHtml(formatDesktopPinNumericValue(spec.value, entity, { spec }))}</div>`,
      })}
      <div class="desktop-pin-panel-body">
        ${meterMarkup}
        ${controlsMarkup}
      </div>
    </div>
  `;

  const slider = root.querySelector('.desktop-pin-numeric-slider');
  if (slider) {
    bindDesktopPinSlider(slider, {
      entityId: entity.entity_id,
      getImmediateValue: (target) => Number(target?.value),
      applyVisualValue: (nextValue) => {
        const formatted = formatDesktopPinNumericValue(nextValue, entity, { spec });
        const kpi = root.querySelector('.desktop-pin-panel-kpi');
        const value = root.querySelector('.desktop-pin-panel-value');
        if (kpi) kpi.textContent = formatted;
        if (value) value.textContent = formatted;
      },
      queueValue: (nextValue) => queueDesktopPinNumericValue(entity, nextValue),
      releaseDelayMs: 360,
    });
  }

  root.querySelectorAll('.desktop-pin-numeric-step').forEach((button) => {
    bindDesktopPinButton(button, () => {
      // The control outlives the entity it was built from, so step from the value it shows now
      // (a step still settling counts) rather than the one it had when it was created.
      const liveEntity = state.STATES?.[entity.entity_id] || entity;
      const liveSpec = getDesktopPinNumericSpec(liveEntity);
      const delta = button.dataset.action === 'decrease' ? -liveSpec.step : liveSpec.step;
      const nextValue = liveSpec.value + delta;
      setDesktopPinControlInteraction(entity.entity_id, { value: nextValue, active: false });
      scheduleDesktopPinControlInteractionRelease(entity.entity_id, 360);
      queueDesktopPinNumericValue(liveEntity, nextValue);
      updateExistingDesktopPinNumericControl(root, {
        ...liveEntity,
        state: String(nextValue),
      });
    });
  });

  return root;
}

function updateExistingDesktopPinNumericControl(root, entity) {
  if (!root || !root.classList.contains('desktop-pin-numeric-control') || !entity?.entity_id) {
    return false;
  }

  const spec = getDesktopPinNumericSpec(entity);
  const hasSlider = !!root.querySelector('.desktop-pin-numeric-slider');
  if (hasSlider !== spec.hasBounds) {
    root.replaceWith(createDesktopPinNumericControlElement(entity));
    return true;
  }
  const formattedValue = formatDesktopPinNumericValue(spec.value, entity, { spec });
  syncDesktopPinPanelRootState(root, entity, {
    domain: getEntityDomain(entity.entity_id),
  });

  syncDesktopPinPanelName(root, entity);

  const status = root.querySelector('.desktop-pin-panel-status');
  if (status) status.textContent = utils.getEntityTypeDescription(entity);

  const kpi = root.querySelector('.desktop-pin-panel-kpi');
  if (kpi) kpi.textContent = formattedValue;

  const glyph = root.querySelector('.desktop-pin-panel-glyph');
  if (glyph) renderEntityIcon(glyph, entity);

  const value = root.querySelector('.desktop-pin-panel-value');
  if (value) value.textContent = formattedValue;

  const slider = root.querySelector('.desktop-pin-numeric-slider');
  if (slider) {
    slider.min = String(spec.min);
    slider.max = String(spec.max);
    slider.step = String(spec.step);
    slider.value = String(spec.value);
  }

  return true;
}

function getDesktopPinEnumOptions(entity) {
  return Array.isArray(entity?.attributes?.options)
    ? entity.attributes.options.filter((option) => typeof option === 'string' && option.trim())
    : [];
}

function getDesktopPinEnumState(entity) {
  const interaction = getDesktopPinControlInteraction(entity?.entity_id);
  const selectedOption =
    typeof interaction?.option === 'string' ? interaction.option : entity?.state;
  const options = getDesktopPinEnumOptions(entity);
  const currentIndex = Math.max(0, options.indexOf(selectedOption));
  return {
    options,
    currentOption: options[currentIndex] || selectedOption || '',
    currentIndex,
  };
}

function queueDesktopPinEnumSelection(entity, direction) {
  const entityId = entity?.entity_id;
  if (!entityId) return;
  // The control is reused across updates, so the entity it was built from goes stale.
  const enumState = getDesktopPinEnumState(state.STATES?.[entityId] || entity);
  if (!enumState.options.length) return;

  const directionOffset = direction === 'previous' ? -1 : 1;
  const nextIndex = Math.max(
    0,
    Math.min(enumState.options.length - 1, enumState.currentIndex + directionOffset)
  );
  const nextOption = enumState.options[nextIndex];
  if (!nextOption || nextOption === enumState.currentOption) return;

  setDesktopPinControlInteraction(entityId, { option: nextOption, active: false });
  scheduleDesktopPinControlInteractionRelease(entityId, 520);

  queueDesktopPinServiceCall(
    `${entityId}:enum`,
    () => {
      const liveEntity = state.STATES?.[entityId] || entity;
      if (direction === 'previous' && hasEntityService(liveEntity, 'select_previous')) {
        callEntityDomainService(liveEntity, 'select_previous');
        return;
      }
      if (direction === 'next' && hasEntityService(liveEntity, 'select_next')) {
        callEntityDomainService(liveEntity, 'select_next');
        return;
      }
      callEntityDomainService(liveEntity, 'select_option', { option: nextOption });
    },
    100
  );
}

function createDesktopPinEnumControlElement(entity) {
  const enumState = getDesktopPinEnumState(entity);
  const root = createDesktopPinPanelRoot(entity, ['desktop-pin-enum-control'], {
    domain: getEntityDomain(entity.entity_id),
    state: entity.state,
  });

  root.innerHTML = `
    <div class="desktop-pin-panel-shell">
      ${getDesktopPinPanelHeaderMarkup(entity, {
        statusText: utils.getEntityTypeDescription(entity),
        asideMarkup: `<div class="desktop-pin-panel-kpi">${utils.escapeHtml(enumState.currentOption || t('Unknown'))}</div>`,
      })}
      <div class="desktop-pin-panel-body">
        <div class="desktop-pin-panel-meter">
          <div class="desktop-pin-panel-glyph">${entityIconMarkup(entity)}</div>
          <div class="desktop-pin-panel-value">${utils.escapeHtml(enumState.currentOption || t('Unknown'))}</div>
        </div>
        <div class="desktop-pin-panel-actions desktop-pin-enum-actions">
          ${createDesktopPinButtonMarkup({
            className: 'desktop-pin-panel-button desktop-pin-enum-step',
            label: t('Prev'),
            ariaLabel: t('Previous option for {{name}}', {
              name: utils.getEntityDisplayName(entity),
            }),
            action: 'previous',
          })}
          ${createDesktopPinButtonMarkup({
            className: 'desktop-pin-panel-button desktop-pin-enum-step',
            label: t('Next'),
            ariaLabel: t('Next option for {{name}}', { name: utils.getEntityDisplayName(entity) }),
            action: 'next',
          })}
        </div>
      </div>
    </div>
  `;

  root.querySelectorAll('.desktop-pin-enum-step').forEach((button) => {
    bindDesktopPinButton(button, () => {
      queueDesktopPinEnumSelection(entity, button.dataset.action);
      const liveEntity = state.STATES?.[entity.entity_id] || entity;
      updateExistingDesktopPinEnumControl(root, {
        ...liveEntity,
        state: getDesktopPinControlInteraction(entity.entity_id)?.option || liveEntity.state,
      });
    });
  });

  return root;
}

function updateExistingDesktopPinEnumControl(root, entity) {
  if (!root || !root.classList.contains('desktop-pin-enum-control') || !entity?.entity_id) {
    return false;
  }

  const enumState = getDesktopPinEnumState(entity);
  syncDesktopPinPanelRootState(root, entity, {
    domain: getEntityDomain(entity.entity_id),
  });

  syncDesktopPinPanelName(root, entity);

  const status = root.querySelector('.desktop-pin-panel-status');
  if (status) status.textContent = utils.getEntityTypeDescription(entity);

  const kpi = root.querySelector('.desktop-pin-panel-kpi');
  if (kpi) kpi.textContent = enumState.currentOption || t('Unknown');

  const glyph = root.querySelector('.desktop-pin-panel-glyph');
  if (glyph) renderEntityIcon(glyph, entity);

  const value = root.querySelector('.desktop-pin-panel-value');
  if (value) value.textContent = enumState.currentOption || t('Unknown');

  return true;
}

function createDesktopPinPresenceControlElement(entity) {
  const root = createDesktopPinPanelRoot(entity, ['desktop-pin-presence-control'], {
    domain: getEntityDomain(entity.entity_id),
    state: entity.state,
  });

  root.innerHTML = `
    <div class="desktop-pin-panel-shell">
      ${getDesktopPinPanelHeaderMarkup(entity, {
        statusText: utils.getEntityTypeDescription(entity),
        asideMarkup: `<div class="desktop-pin-panel-kpi">${utils.escapeHtml(utils.getEntityDisplayState(entity))}</div>`,
      })}
      <div class="desktop-pin-panel-body">
        <div class="desktop-pin-panel-meter">
          <div class="desktop-pin-panel-glyph">${entityIconMarkup(entity)}</div>
          <div class="desktop-pin-panel-value">${utils.escapeHtml(utils.getEntityDisplayState(entity))}</div>
        </div>
        <div class="desktop-pin-panel-actions desktop-pin-presence-actions">
          ${createDesktopPinButtonMarkup({
            className: 'desktop-pin-panel-button desktop-pin-presence-focus',
            label: t('Open widget'),
            ariaLabel: t('Focus main widget for {{name}}', {
              name: utils.getEntityDisplayName(entity),
            }),
          })}
        </div>
      </div>
    </div>
  `;

  bindDesktopPinButton(root.querySelector('.desktop-pin-presence-focus'), () => {
    requestDesktopPinFocusMain(entity.entity_id);
  });

  return root;
}

function updateExistingDesktopPinPresenceControl(root, entity) {
  if (!root || !root.classList.contains('desktop-pin-presence-control') || !entity?.entity_id) {
    return false;
  }

  syncDesktopPinPanelRootState(root, entity, {
    domain: getEntityDomain(entity.entity_id),
  });

  const displayState = utils.getEntityDisplayState(entity);
  syncDesktopPinPanelName(root, entity);

  const status = root.querySelector('.desktop-pin-panel-status');
  if (status) status.textContent = utils.getEntityTypeDescription(entity);

  const kpi = root.querySelector('.desktop-pin-panel-kpi');
  if (kpi) kpi.textContent = displayState;

  const glyph = root.querySelector('.desktop-pin-panel-glyph');
  if (glyph) renderEntityIcon(glyph, entity);

  const value = root.querySelector('.desktop-pin-panel-value');
  if (value) value.textContent = displayState;

  return true;
}

function getDesktopPinWeatherStats(entity) {
  const attrs = entity?.attributes || {};
  const stats = [];
  if (attrs.humidity != null) {
    stats.push(t('{{percent}}% humidity', { percent: formatNumber(attrs.humidity) }));
  }
  if (attrs.wind_speed != null) {
    const unit = attrs.wind_speed_unit || state.UNIT_SYSTEM?.wind_speed || '';
    stats.push(formatMeasurement(attrs.wind_speed, unit));
  }
  if (attrs.pressure != null && stats.length < 2) {
    const unit = attrs.pressure_unit || state.UNIT_SYSTEM?.pressure || '';
    stats.push(formatMeasurement(attrs.pressure, unit));
  }
  return stats.slice(0, 2);
}

// A stat is cut with an ellipsis when its translation is long ("81 % Luftfeuchtigkeit"), so its
// title carries all of it.
function getDesktopPinWeatherStatMarkup(stat) {
  const text = utils.escapeHtml(stat);
  return `<div class="desktop-pin-panel-stat" title="${escapeHtmlAttribute(stat)}"><div class="desktop-pin-panel-stat-label">${text}</div></div>`;
}

function createDesktopPinWeatherControlElement(entity) {
  const stats = getDesktopPinWeatherStats(entity);
  const temperature = entity?.attributes?.temperature;
  const temperatureUnit =
    entity?.attributes?.temperature_unit || state.UNIT_SYSTEM?.temperature || '';
  const temperatureValue =
    temperature != null
      ? formatTemperature(temperature, temperatureUnit)
      : utils.getEntityDisplayState(entity);
  const root = createDesktopPinPanelRoot(entity, ['desktop-pin-weather-control'], {
    domain: 'weather',
    state: entity.state,
  });

  root.innerHTML = `
    <div class="desktop-pin-panel-shell">
      ${getDesktopPinPanelHeaderMarkup(entity, {
        statusText: getWeatherConditionLabel(entity.state),
        asideMarkup: `<div class="desktop-pin-panel-kpi">${utils.escapeHtml(temperatureValue)}</div>`,
      })}
      <div class="desktop-pin-panel-body">
        <div class="desktop-pin-panel-meter">
          <div class="desktop-pin-panel-glyph">${entityIconMarkup(entity)}</div>
          <div class="desktop-pin-panel-value">${utils.escapeHtml(temperatureValue)}</div>
        </div>
        <div class="desktop-pin-weather-stats">
          ${stats.map(getDesktopPinWeatherStatMarkup).join('')}
        </div>
        <div class="desktop-pin-panel-actions desktop-pin-weather-actions">
          ${createDesktopPinButtonMarkup({
            className: 'desktop-pin-panel-button desktop-pin-weather-focus',
            label: t('Open widget'),
            ariaLabel: t('Focus main widget for {{name}}', {
              name: utils.getEntityDisplayName(entity),
            }),
          })}
        </div>
      </div>
    </div>
  `;

  bindDesktopPinButton(root.querySelector('.desktop-pin-weather-focus'), () => {
    requestDesktopPinFocusMain(entity.entity_id);
  });

  return root;
}

function updateExistingDesktopPinWeatherControl(root, entity) {
  if (!root || !root.classList.contains('desktop-pin-weather-control') || !entity?.entity_id) {
    return false;
  }

  const stats = getDesktopPinWeatherStats(entity);
  const temperature = entity?.attributes?.temperature;
  const temperatureUnit =
    entity?.attributes?.temperature_unit || state.UNIT_SYSTEM?.temperature || '';
  const temperatureValue =
    temperature != null
      ? formatTemperature(temperature, temperatureUnit)
      : utils.getEntityDisplayState(entity);

  syncDesktopPinPanelRootState(root, entity, {
    domain: 'weather',
  });

  syncDesktopPinPanelName(root, entity);

  const status = root.querySelector('.desktop-pin-panel-status');
  if (status) status.textContent = getWeatherConditionLabel(entity.state);

  const kpi = root.querySelector('.desktop-pin-panel-kpi');
  if (kpi) kpi.textContent = temperatureValue;

  const glyph = root.querySelector('.desktop-pin-panel-glyph');
  if (glyph) renderEntityIcon(glyph, entity);

  const value = root.querySelector('.desktop-pin-panel-value');
  if (value) value.textContent = temperatureValue;

  const statsContainer = root.querySelector('.desktop-pin-weather-stats');
  if (statsContainer) {
    statsContainer.innerHTML = stats.map(getDesktopPinWeatherStatMarkup).join('');
  }

  return true;
}

function getDesktopPinVacuumActionConfig(entity) {
  const stateValue = typeof entity?.state === 'string' ? entity.state.trim().toLowerCase() : '';
  const hasPause = hasEntityService(entity, 'pause');
  const hasReturn = hasEntityService(entity, 'return_to_base');
  // A vacuum written before START and STOP existed is switched on and off instead.
  const startService = ['start', 'turn_on'].find((service) => hasEntityService(entity, service));
  const stopService = ['stop', 'turn_off'].find((service) => hasEntityService(entity, service));

  const name = utils.getEntityDisplayName(entity);
  const makeServiceAction = (label, ariaLabel, serviceName) => ({
    label,
    ariaLabel,
    type: 'service',
    serviceName,
  });
  const focusAction = {
    label: t('Open widget'),
    ariaLabel: t('Focus main widget for {{name}}', { name }),
    type: 'focus-main',
  };
  const returnAction = hasReturn
    ? makeServiceAction(t('Return'), t('Return {{name}}', { name }), 'return_to_base')
    : focusAction;
  const stopAction = stopService
    ? makeServiceAction(t('Stop'), t('Stop {{name}}', { name }), stopService)
    : focusAction;

  // A vacuum that can only be switched on and off reports "on" while it works.
  if (stateValue === 'cleaning' || stateValue === 'on') {
    return {
      primary: hasPause
        ? makeServiceAction(t('Pause'), t('Pause {{name}}', { name }), 'pause')
        : stopAction,
      secondary: returnAction,
    };
  }

  if (stateValue === 'paused') {
    return {
      primary: startService
        ? makeServiceAction(t('Resume'), t('Resume {{name}}', { name }), startService)
        : focusAction,
      secondary: returnAction,
    };
  }

  if (stateValue === 'returning') {
    return { primary: stopAction, secondary: returnAction };
  }

  return {
    primary: startService
      ? makeServiceAction(t('Start'), t('Start {{name}}', { name }), startService)
      : focusAction,
    secondary: null,
  };
}

// The action config carries translated labels and aria-labels (see getDesktopPinVacuumActionConfig).
function getDesktopPinVacuumActionButtonsMarkup(actionConfig) {
  return `
    ${createDesktopPinButtonMarkup({
      className: 'desktop-pin-panel-button desktop-pin-vacuum-action',
      label: actionConfig.primary.label,
      ariaLabel: actionConfig.primary.ariaLabel,
      action: 'primary',
    })}
    ${
      actionConfig.secondary
        ? createDesktopPinButtonMarkup({
            className: 'desktop-pin-panel-button desktop-pin-vacuum-action',
            label: actionConfig.secondary.label,
            ariaLabel: actionConfig.secondary.ariaLabel,
            action: 'secondary',
          })
        : ''
    }
  `;
}

function runDesktopPinVacuumAction(entity, actionConfig) {
  if (!entity?.entity_id || !actionConfig) return;
  if (actionConfig.type === 'focus-main') {
    requestDesktopPinFocusMain(entity.entity_id);
    return;
  }
  callEntityDomainService(state.STATES?.[entity.entity_id] || entity, actionConfig.serviceName);
}

function createDesktopPinVacuumControlElement(entity) {
  const actionConfig = getDesktopPinVacuumActionConfig(entity);
  const root = createDesktopPinPanelRoot(entity, ['desktop-pin-vacuum-control'], {
    domain: 'vacuum',
    state: entity.state,
  });

  root.innerHTML = `
    <div class="desktop-pin-panel-shell">
      ${getDesktopPinPanelHeaderMarkup(entity, {
        statusText: utils.getEntityTypeDescription(entity),
        asideMarkup: `<div class="desktop-pin-panel-kpi">${utils.escapeHtml(utils.getEntityDisplayState(entity))}</div>`,
      })}
      <div class="desktop-pin-panel-body">
        <div class="desktop-pin-panel-meter">
          <div class="desktop-pin-panel-glyph">${entityIconMarkup(entity)}</div>
          <div class="desktop-pin-panel-value">${utils.escapeHtml(utils.getEntityDisplayState(entity))}</div>
        </div>
        <div class="desktop-pin-panel-actions desktop-pin-vacuum-actions">
          ${getDesktopPinVacuumActionButtonsMarkup(actionConfig)}
        </div>
      </div>
    </div>
  `;

  root.querySelectorAll('.desktop-pin-vacuum-action').forEach((button) => {
    bindDesktopPinButton(button, () => {
      const config =
        button.dataset.action === 'secondary' ? actionConfig.secondary : actionConfig.primary;
      runDesktopPinVacuumAction(entity, config);
    });
  });

  return root;
}

function updateExistingDesktopPinVacuumControl(root, entity) {
  if (!root || !root.classList.contains('desktop-pin-vacuum-control') || !entity?.entity_id) {
    return false;
  }

  const actionConfig = getDesktopPinVacuumActionConfig(entity);
  syncDesktopPinPanelRootState(root, entity, {
    domain: 'vacuum',
  });

  const displayState = utils.getEntityDisplayState(entity);
  syncDesktopPinPanelName(root, entity);

  const status = root.querySelector('.desktop-pin-panel-status');
  if (status) status.textContent = utils.getEntityTypeDescription(entity);

  const kpi = root.querySelector('.desktop-pin-panel-kpi');
  if (kpi) kpi.textContent = displayState;

  const glyph = root.querySelector('.desktop-pin-panel-glyph');
  if (glyph) renderEntityIcon(glyph, entity);

  const value = root.querySelector('.desktop-pin-panel-value');
  if (value) value.textContent = displayState;

  const actions = root.querySelector('.desktop-pin-vacuum-actions');
  if (actions) {
    actions.innerHTML = getDesktopPinVacuumActionButtonsMarkup(actionConfig);
    actions.querySelectorAll('.desktop-pin-vacuum-action').forEach((button) => {
      bindDesktopPinButton(button, () => {
        const config =
          button.dataset.action === 'secondary' ? actionConfig.secondary : actionConfig.primary;
        runDesktopPinVacuumAction(entity, config);
      });
    });
  }

  return true;
}

function updateExistingDesktopPinFallbackControl(root, entity) {
  if (!root || !root.classList.contains('desktop-pin-fallback-control') || !entity?.entity_id) {
    return false;
  }

  syncDesktopPinPanelRootState(root, entity, {
    domain: getEntityDomain(entity.entity_id),
  });

  const displayState = utils.getEntityDisplayState(entity);

  syncDesktopPinPanelName(root, entity);

  const status = root.querySelector('.desktop-pin-panel-status');
  if (status) status.textContent = utils.getEntityTypeDescription(entity);

  const kpi = root.querySelector('.desktop-pin-panel-kpi');
  if (kpi) kpi.textContent = displayState;

  const glyph = root.querySelector('.desktop-pin-panel-glyph');
  if (glyph) renderEntityIcon(glyph, entity);

  const value = root.querySelector('.desktop-pin-panel-value');
  if (value) value.textContent = displayState;

  return true;
}

function updateExistingDesktopPinPanelControl(root, entity) {
  if (!root || !entity?.entity_id) return false;
  if (root.classList.contains('desktop-pin-light-control'))
    return updateExistingDesktopPinLightControl(root, entity);
  if (root.classList.contains('desktop-pin-climate-control'))
    return updateExistingDesktopPinClimateControl(root, entity);
  if (root.classList.contains('desktop-pin-fan-control'))
    return updateExistingDesktopPinFanControl(root, entity);
  if (root.classList.contains('desktop-pin-cover-control'))
    return updateExistingDesktopPinCoverControl(root, entity);
  if (root.classList.contains('desktop-pin-media-control'))
    return updateExistingDesktopPinMediaControl(root, entity);
  if (root.classList.contains('desktop-pin-scene-control'))
    return updateExistingDesktopPinSceneControl(root, entity);
  if (root.classList.contains('desktop-pin-toggle-control'))
    return updateExistingDesktopPinToggleEntityControl(root, entity);
  if (root.classList.contains('desktop-pin-action-control'))
    return updateExistingDesktopPinActionControl(root, entity);
  if (root.classList.contains('desktop-pin-numeric-control'))
    return updateExistingDesktopPinNumericControl(root, entity);
  if (root.classList.contains('desktop-pin-enum-control'))
    return updateExistingDesktopPinEnumControl(root, entity);
  if (root.classList.contains('desktop-pin-presence-control'))
    return updateExistingDesktopPinPresenceControl(root, entity);
  if (root.classList.contains('desktop-pin-weather-control'))
    return updateExistingDesktopPinWeatherControl(root, entity);
  if (root.classList.contains('desktop-pin-vacuum-control'))
    return updateExistingDesktopPinVacuumControl(root, entity);
  if (root.classList.contains('desktop-pin-camera-control'))
    return updateExistingDesktopPinCameraControl(root, entity);
  if (root.classList.contains('desktop-pin-sensor-control'))
    return updateExistingDesktopPinSensorControl(root, entity);
  if (root.classList.contains('desktop-pin-timer-control'))
    return updateExistingDesktopPinTimerControl(root, entity);
  if (root.classList.contains('desktop-pin-fallback-control'))
    return updateExistingDesktopPinFallbackControl(root, entity);
  return false;
}

// The support module's reasons are English sentences built around the domain name, so the
// message is phrased here where it can be translated.
function getDesktopPinUnsupportedMessage(entityId) {
  const domain = getEntityDomain(entityId);
  return domain
    ? t('The "{{domain}}" domain does not have a desktop-pin profile yet.', { domain })
    : t('Desktop pin not supported yet');
}

function syncQuickAccessControlButton(control, entityId) {
  if (!control || !entityId) return;
  // A graph is not an entity, so it can't be pinned to the desktop as one.
  if (isComparisonGraphId(entityId)) return;

  let button = control.querySelector('.desktop-pin-quick-toggle');
  if (!button) {
    button = document.createElement('button');
    button.type = 'button';
    button.className = 'desktop-pin-quick-toggle';
    button.dataset.desktopPinQuickToggle = entityId;
    button.setAttribute('draggable', 'false');

    ['pointerdown', 'mousedown', 'dblclick', 'contextmenu'].forEach((eventName) => {
      button.addEventListener(
        eventName,
        (event) => {
          event.preventDefault();
          event.stopPropagation();
        },
        true
      );
    });

    button.addEventListener('click', async (event) => {
      event.preventDefault();
      event.stopPropagation();
      await toggleDesktopPinFromQuickAccess(entityId);
    });

    // First in tab order, as it is on screen (the pin sits at the tile's start).
    control.insertBefore(button, control.querySelector('.rename-btn'));
  }

  const isPinned = isEntityDesktopPinned(entityId);
  const resolvedEntityId = utils.resolveEntityId(entityId, state.STATES) || entityId;
  const supportProfile = getDesktopPinSupportProfile(state.STATES?.[resolvedEntityId] || entityId);
  control.dataset.desktopPinned = isPinned ? 'true' : 'false';
  control.dataset.desktopPinSupported = supportProfile.supported ? 'true' : 'false';
  button.dataset.active = isPinned ? 'true' : 'false';
  button.setAttribute('aria-pressed', isPinned ? 'true' : 'false');
  button.disabled = !isPinned && !supportProfile.supported;
  button.setAttribute('aria-disabled', !isPinned && !supportProfile.supported ? 'true' : 'false');
  button.title = isPinned
    ? t('Unpin from desktop')
    : supportProfile.supported
      ? t('Pin to desktop')
      : getDesktopPinUnsupportedMessage(resolvedEntityId);
  // An icon rather than a word: "Pinned" in German or French ran under the edit buttons. The
  // name stays the same whatever the state; aria-pressed says whether it is pinned.
  button.setAttribute(
    'aria-label',
    t('Pin {{name}} to desktop', { name: getQuickAccessTileLabel(control) })
  );
  const iconName = isPinned || supportProfile.supported ? 'pin' : 'pin-off';
  if (button.dataset.icon !== iconName) {
    button.innerHTML = lineIconMarkup(iconName);
    button.dataset.icon = iconName;
  }
}

function focusQuickAccessPinToggle(entityId) {
  const button = Array.from(
    document.querySelectorAll('#quick-controls .desktop-pin-quick-toggle')
  ).find((candidate) => candidate.dataset.desktopPinQuickToggle === entityId);
  const tile = button?.closest('.control-item');
  if (tile) syncQuickAccessRovingTabIndex(tile);
  (button && !button.disabled ? button : tile)?.focus();
}

async function toggleDesktopPinFromQuickAccess(entityId) {
  if (!entityId) return { success: false, error: 'Missing entity ID' };

  const isPinned = isEntityDesktopPinned(entityId);
  const resolvedEntityId = utils.resolveEntityId(entityId, state.STATES) || entityId;
  const supportInfo = getDesktopPinSupportInfo(state.STATES?.[resolvedEntityId] || entityId);
  // Rebuilding the tiles detaches the focused Pin button; a keyboard user keeps their place.
  const hadFocus =
    document.activeElement?.dataset?.desktopPinQuickToggle === entityId &&
    !!document.activeElement.closest('#quick-controls');
  if (!isPinned && !supportInfo.supported) {
    uiUtils.showToast(getDesktopPinUnsupportedMessage(resolvedEntityId), 'error', 2600);
    return { success: false, error: supportInfo.reason || 'Desktop pin not supported yet' };
  }
  try {
    const nextDesktopPins = { ...(state.CONFIG?.desktopPins || {}) };

    if (isPinned) {
      const result = await window.electronAPI.unpinEntityFromDesktop(entityId);
      if (!result?.success) {
        throw new Error(result?.error || 'Could not remove desktop pin');
      }
      delete nextDesktopPins[entityId];
      state.setConfig({
        ...state.CONFIG,
        desktopPins: nextDesktopPins,
      });
      renderQuickControls();
      if (isReorganizeMode) {
        const container = document.getElementById('quick-controls');
        if (container) container.classList.add('reorganize-mode');
        addRemoveButtons();
      }
      if (hadFocus) focusQuickAccessPinToggle(entityId);
      uiUtils.showToast(t('Removed desktop pin'), 'info', 1800);
      return { success: true, pinned: false, result };
    }

    const result = await window.electronAPI.pinEntityToDesktop(entityId, supportInfo);
    if (!result?.success) {
      throw new Error(result?.error || 'Could not pin tile to desktop');
    }

    nextDesktopPins[entityId] = result?.pinBounds || nextDesktopPins[entityId] || {};
    state.setConfig({
      ...state.CONFIG,
      desktopPins: nextDesktopPins,
    });

    renderQuickControls();
    if (isReorganizeMode) {
      const container = document.getElementById('quick-controls');
      if (container) container.classList.add('reorganize-mode');
      addRemoveButtons();
    }
    if (hadFocus) focusQuickAccessPinToggle(entityId);

    uiUtils.showToast(t('Pinned to desktop'), 'success', 1800);
    return { success: true, pinned: true, result };
  } catch (error) {
    console.error('Error toggling desktop pin from quick access:', error);
    uiUtils.showToast(
      isPinned ? t('Could not remove desktop pin') : t('Could not pin tile to desktop'),
      'error',
      2600
    );
    return { success: false, error };
  }
}

function updateExistingMediaPlayerControl(item, entity) {
  if (!item || !entity || !entity.entity_id || !entity.entity_id.startsWith('media_player.'))
    return false;
  if (item.dataset.desktopPin === 'true') return false;
  if (!item.classList.contains('media-player-entity')) return false;
  if (!item.querySelector('.control-icon') || !item.querySelector('.control-info')) return false;

  item.dataset.entityId = entity.entity_id;
  applyQuickAccessTileActiveState(item, entity);
  item.title = t('Click to play/pause, hold for controls');
  setupMediaPlayerControls(item, entity);
  return true;
}

function getCachedTodoItems(entityId) {
  ensureEntityCacheScope();
  const cached = todoItemsCacheByEntity.get(entityId);
  return Array.isArray(cached?.items) ? cached.items : null;
}

function getTodoTileCountLabel(entity) {
  const stateCount = toFiniteNumber(entity?.state);
  if (stateCount !== null && stateCount >= 0) return formatTodoActiveCount(stateCount);
  if (!isEntityAvailable(entity)) return t('Unavailable');
  const cachedItems = getCachedTodoItems(entity?.entity_id);
  if (cachedItems) return formatTodoActiveCount(getTodoActiveCount(cachedItems));

  return t('-- active');
}

function formatTodoActiveCount(count) {
  return count === 1 ? t('1 active') : t('{{count}} active', { count: formatNumber(count) });
}

function updateTodoTileCount(entityId) {
  const items = document.querySelectorAll(
    `.control-item.todo-entity[data-entity-id="${entityId}"]`
  );
  items.forEach((item) => {
    const entity = state.STATES?.[entityId];
    const countEl = item.querySelector('.todo-active-count');
    if (countEl && entity) countEl.textContent = getTodoTileCountLabel(entity);
    item.title = entity
      ? t('Click to view {{name}}', { name: utils.getEntityDisplayName(entity) })
      : item.title;
  });
}

function fetchTodoItems(entityId, { force = false } = {}) {
  const generation = ensureEntityCacheScope();
  if (!entityId || typeof callServiceWithResponse !== 'function') return Promise.resolve([]);
  const now = Date.now();
  const cached = todoItemsCacheByEntity.get(entityId);
  if (!force && cached?.items && now - cached.fetchedAt < TODO_ITEMS_CACHE_TTL_MS) {
    return Promise.resolve(cached.items);
  }
  if (
    !force &&
    cached &&
    now - (cached.lastRequestedAt || cached.fetchedAt || 0) < TODO_ITEMS_REFRESH_THROTTLE_MS
  ) {
    return Promise.resolve(cached.items || []);
  }
  if (todoItemsPendingByEntity.has(entityId)) {
    const pendingRequest = todoItemsPendingByEntity.get(entityId);
    if (!force) return pendingRequest;
    // A mutation can complete while an older get_items request is still in flight. Let that
    // request settle, then issue a genuinely fresh read instead of caching its pre-mutation data.
    return pendingRequest
      .catch(() => {})
      .then(() =>
        generation === ensureEntityCacheScope() ? fetchTodoItems(entityId, { force: true }) : []
      );
  }

  todoItemsCacheByEntity.set(entityId, {
    ...(cached || {}),
    lastRequestedAt: now,
  });

  const request = callServiceWithResponse('todo', 'get_items', { entity_id: entityId })
    .then((response) => {
      if (generation !== ensureEntityCacheScope()) return [];
      const items = normalizeTodoItems(response, entityId);
      todoItemsCacheByEntity.set(entityId, {
        items,
        fetchedAt: Date.now(),
        lastRequestedAt: Date.now(),
      });
      updateTodoTileCount(entityId);
      return items;
    })
    .catch((error) => {
      console.warn('Unable to fetch todo items:', error);
      throw error;
    })
    .finally(() => {
      if (
        generation === ensureEntityCacheScope() &&
        todoItemsPendingByEntity.get(entityId) === request
      ) {
        todoItemsPendingByEntity.delete(entityId);
      }
    });

  todoItemsPendingByEntity.set(entityId, request);
  return request;
}

function renderTodoTileStateMarkup(entity) {
  return `<div class="control-state todo-active-count">${utils.escapeHtml(getTodoTileCountLabel(entity))}</div>`;
}

// The event's title and where it falls, apart, so the tile can cut a long title short and keep
// the day and time whole.
function getCalendarNextEventParts(entity) {
  const title = entity?.attributes?.message || t('No upcoming event');
  const start = formatCalendarTileStart(
    entity?.attributes?.start_time || entity?.attributes?.start,
    { allDay: entity?.attributes?.all_day === true, ongoing: entity?.state === 'on' }
  );
  return { title, start };
}

function getCalendarNextEventSummary(entity) {
  const { title, start } = getCalendarNextEventParts(entity);
  return start ? `${title} · ${start}` : title;
}

// "Dentist · Tomorrow 8:22 AM" in pieces. A narrow tile cuts a long title short with an ellipsis and
// moves the day and time to a second line before it would cut them, so the AM/PM never goes missing.
function getCalendarNextEventMarkup(entity) {
  const { title, start } = getCalendarNextEventParts(entity);
  const name = `<span class="calendar-next-event-title">${utils.escapeHtml(title)}</span>`;
  if (!start) return name;
  return (
    `<span class="calendar-next-event-lead">${name}<span class="calendar-next-event-sep"> · </span></span>` +
    `<span class="calendar-next-event-when">${utils.escapeHtml(start)}</span>`
  );
}

function renderCalendarTileStateMarkup(entity) {
  return `<div class="control-state calendar-next-event">${getCalendarNextEventMarkup(entity)}</div>`;
}

// --- Quick Controls ---
function prefetchQuickAccessSensorHistory(entityIds) {
  const chartIds = entityIds.filter((entityId) => {
    if (isComparisonGraphId(entityId)) return false;
    const entity = state.STATES[utils.resolveEntityId(entityId, state.STATES) || entityId];
    return (
      !!entity &&
      isFiniteNumericSensorState(entity) &&
      getQuickAccessTileChartType(entity.entity_id) !== 'none'
    );
  });
  if (chartIds.length) {
    fetchSensorHistoryBatch(chartIds).catch(() => {
      /* Each tile reports its own failure when it reads the cache. */
    });
  }
}

// The page the grid last showed, so a page switch can slide the tiles in from the side of the
// tab that was picked, and whether the one-time entrance has played.
let lastRenderedQuickAccessPage = null;
let quickAccessEntrancePlayed = false;

function playQuickAccessPageMotion(container, config) {
  const tabs = config.customTabs || [];
  const index = tabs.findIndex((tab) => tab.id === config.activeTabId);
  const previous = lastRenderedQuickAccessPage;
  lastRenderedQuickAccessPage = { id: config.activeTabId, index };
  if (isReorganizeMode || !container.children.length) return;

  if (previous && previous.id !== config.activeTabId) {
    animateEnter(container.children, { direction: index >= previous.index ? 1 : -1 });
    return;
  }
  // The first time real tiles appear, let them rise in once.
  if (!quickAccessEntrancePlayed && Object.keys(state.STATES || {}).length > 0) {
    quickAccessEntrancePlayed = true;
    animateEnter(container.children, { direction: 0 });
  }
}

function renderQuickControls() {
  try {
    ensureEntityCacheScope();
    const container = document.getElementById('quick-controls');
    if (!container) {
      console.error('[UI] Quick controls container not found');
      return;
    }

    const config = ensureQuickAccessConfig();
    renderQuickAccessTabs(config);

    const favorites = getActiveQuickAccessEntityIds();
    // One recorder request for every chart on the page. The per-tile fetches issued while the
    // tiles mount then join this in-flight request instead of each sending their own.
    prefetchQuickAccessSensorHistory(favorites);
    const desiredNodes = [];
    const existingNodesById = new Map();
    container.querySelectorAll('.control-item[data-entity-id]').forEach((node) => {
      if (!node || !node.dataset?.entityId) return;
      if (!existingNodesById.has(node.dataset.entityId)) {
        existingNodesById.set(node.dataset.entityId, node);
      }
    });

    // Iterate through ALL favorited entity IDs (not just those in STATES)
    // This ensures unavailable entities are still shown with an error state
    favorites.forEach((entityId) => {
      // Comparison graphs are tiles backed by config, not by an entity, so they must be handled
      // before the STATES lookup — otherwise they resolve to nothing and render as unavailable.
      if (isComparisonGraphId(entityId)) {
        const graph = getComparisonGraphById(entityId);
        const existingGraphNode = existingNodesById.get(entityId);
        const graphSignature = graph ? getComparisonGraphSignature(graph) : 'graph|missing';

        if (existingGraphNode && existingGraphNode.dataset.renderSignature === graphSignature) {
          // Re-attempt the history fetch (throttled) — the first one may have run before the
          // WebSocket was connected.
          hydrateComparisonGraphTile(existingGraphNode, entityId, { renderNow: false });
          desiredNodes.push(existingGraphNode);
          existingNodesById.delete(entityId);
          return;
        }

        desiredNodes.push(createComparisonGraphTile(entityId));
        return;
      }

      const resolvedEntityId = utils.resolveEntityId(entityId, state.STATES) || entityId;
      const entity = state.STATES[resolvedEntityId];
      emitUiDebug('quick_access.render_tile', {
        requestedEntityId: entityId,
        resolvedEntityId,
        entityFound: !!entity,
        state: entity?.state || null,
        domain: resolvedEntityId.includes('.') ? resolvedEntityId.split('.')[0] : null,
      });

      const renderedEntityId = entity ? resolvedEntityId : entityId;
      const existingNode = existingNodesById.get(renderedEntityId);
      const nextSignature = entity
        ? getControlRenderSignature(entity)
        : getUnavailableControlSignature(entityId);

      if (
        existingNode &&
        existingNode.dataset.renderSignature === nextSignature &&
        (entity
          ? updateExistingQuickAccessControl(existingNode, entity, { context: 'quick-access' })
          : updateExistingUnavailableControl(existingNode, entityId))
      ) {
        desiredNodes.push(existingNode);
        existingNodesById.delete(renderedEntityId);
        return;
      }

      if (entity) {
        // Entity exists in STATES - render normally
        const control = createControlElement(entity, { context: 'quick-access' });
        control.dataset.renderSignature = nextSignature;
        desiredNodes.push(control);
      } else {
        // Entity does not exist in STATES - render unavailable state
        const control = createUnavailableElement(entityId);
        control.dataset.renderSignature = nextSignature;
        desiredNodes.push(control);
      }
    });

    desiredNodes.forEach((node, index) => {
      const currentAtIndex = container.children[index];
      if (currentAtIndex !== node) {
        container.insertBefore(node, currentAtIndex || null);
      }
    });

    while (container.children.length > desiredNodes.length) {
      container.removeChild(container.lastElementChild);
    }
    camera.pruneCameraPreviews();

    if (isReorganizeMode) {
      container.classList.add('reorganize-mode');
      addRemoveButtons();
    }
    // After insertion, so the grid's real column count is known.
    applyComparisonGraphSpans(container);
    playQuickAccessPageMotion(container, config);
    setupQuickAccessGridKeyboardNavigation();
    syncQuickAccessRovingTabIndex();
    refreshVisibleEntityCache();
  } catch (error) {
    console.error('[UI] Error rendering quick controls:', error, error.stack);
  }
}

function createDesktopPinControlElement(entity) {
  try {
    const resolvedEntity = getEntityForDisplay(entity);
    if (!resolvedEntity?.entity_id) {
      return document.createElement('div');
    }
    const supportProfile = getDesktopPinSupportProfile(resolvedEntity);

    switch (supportProfile.family) {
      case 'light':
        return createDesktopPinLightControlElement(resolvedEntity);
      case 'climate':
        return createDesktopPinClimateControlElement(resolvedEntity);
      case 'fan':
        return createDesktopPinFanControlElement(resolvedEntity);
      case 'cover':
        return createDesktopPinCoverControlElement(resolvedEntity);
      case 'media':
        return createDesktopPinMediaControlElement(resolvedEntity);
      case 'camera':
        return createDesktopPinCameraControlElement(resolvedEntity);
      case 'timer':
        return createDesktopPinTimerControlElement(resolvedEntity);
      case 'sensor':
        return createDesktopPinSensorControlElement(resolvedEntity);
      case 'scene':
        return createDesktopPinSceneControlElement(resolvedEntity);
      case 'toggle':
        return createDesktopPinToggleEntityControlElement(resolvedEntity);
      case 'action':
        return createDesktopPinActionControlElement(resolvedEntity);
      case 'numeric':
        return createDesktopPinNumericControlElement(resolvedEntity);
      case 'enum':
        return createDesktopPinEnumControlElement(resolvedEntity);
      case 'presence':
        return createDesktopPinPresenceControlElement(resolvedEntity);
      case 'weather':
        return createDesktopPinWeatherControlElement(resolvedEntity);
      case 'vacuum':
        return createDesktopPinVacuumControlElement(resolvedEntity);
      default:
        return document.createElement('div');
    }
  } catch (error) {
    console.error('Error creating desktop pin control element:', error);
    return document.createElement('div');
  }
}

function isDesktopPinUnavailableState(entity) {
  const normalizedState =
    typeof entity?.state === 'string' ? entity.state.trim().toLowerCase() : '';
  if (normalizedState === 'unavailable') {
    return true;
  }

  if (normalizedState !== 'unknown') {
    return false;
  }

  const domain = getEntityDomain(entity?.entity_id);
  const supportProfile = getDesktopPinSupportProfile(entity || '');
  return (
    domain !== 'scene' &&
    domain !== 'script' &&
    supportProfile.family !== 'action' &&
    supportProfile.family !== 'presence'
  );
}

function getDesktopPinFallbackDescriptor(
  entityId,
  entity,
  {
    hasSnapshot = false,
    waitingMessage = t('Waiting for live Home Assistant data...'),
    connectionIssue = '',
  } = {}
) {
  const customName = entityId ? state.CONFIG?.customEntityNames?.[entityId] : '';
  const fallbackName =
    customName ||
    (entityId && entityId.includes('.') ? entityId.split('.')[1].replace(/_/g, ' ') : '') ||
    t('Pinned Tile');
  const label = entity ? utils.getEntityDisplayName(entity) : fallbackName;
  const normalizedConnectionIssue =
    typeof connectionIssue === 'string' ? connectionIssue.trim() : '';
  const supportProfile = getDesktopPinSupportProfile(entity || entityId);

  if (!entityId) {
    return {
      state: 'no-entity',
      label: t('Pinned Tile'),
      kicker: t('Pin setup'),
      title: t('No entity selected'),
      detail: t('Choose an entity in the main widget and pin it again.'),
      showFocusMain: true,
      canOpen: false,
    };
  }

  if (normalizedConnectionIssue) {
    return {
      state: 'disconnected',
      label,
      kicker: t('Connection issue'),
      title: t('Home Assistant unavailable'),
      detail: normalizedConnectionIssue,
      showFocusMain: true,
      canOpen: false,
    };
  }

  if (!supportProfile.supported) {
    return {
      state: 'unsupported',
      label,
      kicker: t('Unsupported'),
      title: t('Desktop pin not supported yet'),
      // The shared support profile's reason is English-only; with an entity ID the only one it
      // gives is the missing domain profile, so the fallback words that one itself.
      detail: t('The "{{domain}}" domain does not have a desktop-pin profile yet.', {
        domain: supportProfile.domain || 'unknown',
      }),
      showFocusMain: true,
      canOpen: false,
    };
  }

  if (!entity) {
    if (hasSnapshot) {
      return {
        state: 'missing',
        label,
        kicker: t('Missing entity'),
        title: t('Pinned entity not found'),
        detail: t(
          'This tile could not find its entity in the latest Home Assistant data. It may have been renamed, removed, or is no longer exposed.'
        ),
        showFocusMain: true,
        canOpen: false,
      };
    }

    return {
      state: 'waiting',
      label,
      kicker: t('Connecting'),
      title: t('Waiting for first live update'),
      detail: waitingMessage,
      showFocusMain: true,
      canOpen: false,
    };
  }

  if (isDesktopPinUnavailableState(entity)) {
    return {
      state: 'unavailable',
      label,
      kicker: t('Unavailable'),
      // The kicker already says "Unavailable"; the name and one plain sentence fit a small pin.
      title: label,
      detail: t("Home Assistant can't reach it right now."),
      showFocusMain: true,
      canOpen: false,
    };
  }

  return null;
}

function syncDesktopPinFallbackActions({ showFocusMain = false } = {}) {
  const focusBtn = document.getElementById('desktop-pin-focus-btn');
  if (focusBtn) {
    focusBtn.disabled = !showFocusMain;
    focusBtn.setAttribute('aria-disabled', showFocusMain ? 'false' : 'true');
  }

  const focusActions = document.getElementById('desktop-pin-empty-actions');
  if (focusActions) {
    focusActions.classList.toggle('hidden', !showFocusMain);
  }
}

function renderDesktopPinFallbackSurface(emptyState, fallback) {
  if (!emptyState || !fallback) return;
  emptyState.dataset.state = fallback.state;

  const kicker = emptyState.querySelector('#desktop-pin-empty-kicker');
  const title = emptyState.querySelector('#desktop-pin-empty-title');
  const copy = emptyState.querySelector('#desktop-pin-empty-copy');

  if (kicker) kicker.textContent = fallback.kicker;
  if (title) title.textContent = fallback.title;
  if (copy) {
    copy.textContent = fallback.detail;
    // Small pins clamp the detail to a few lines; hovering still shows all of it.
    copy.title = fallback.detail;
  }

  emptyState.classList.remove('hidden');
}

function renderDesktopPinTileInto({
  containerId,
  emptyStateId,
  labelId,
  entityId,
  entity,
  interactive = true,
  emptyMessage = t('Waiting for live Home Assistant data...'),
  hasSnapshot = false,
  connectionIssue = '',
}) {
  const container = document.getElementById(containerId);
  const emptyState = document.getElementById(emptyStateId);
  const label = labelId ? document.getElementById(labelId) : null;
  if (!container || !emptyState) return;

  const setContentVisibility = (isHidden) => {
    container.classList.toggle('hidden', isHidden);
    if (isHidden) {
      container.setAttribute('aria-hidden', 'true');
      return;
    }
    container.removeAttribute('aria-hidden');
  };

  const fallback = getDesktopPinFallbackDescriptor(entityId, entity, {
    hasSnapshot,
    waitingMessage: emptyMessage,
    connectionIssue,
  });

  const existingControl = entity?.entity_id
    ? container.querySelector(`.control-item[data-entity-id="${entity.entity_id}"]`)
    : null;

  if (label) {
    if (fallback?.label) {
      label.textContent = fallback.label;
    } else {
      const liveEntity = entity || state.STATES?.[entityId];
      label.textContent = liveEntity
        ? utils.getEntityDisplayName(liveEntity)
        : entityId || t('Pinned Tile');
    }
  }

  if (fallback) {
    container.innerHTML = '';
    setContentVisibility(true);
    renderDesktopPinFallbackSurface(emptyState, fallback);
    syncDesktopPinFallbackActions({
      showFocusMain: fallback.showFocusMain && interactive,
    });
    return;
  }

  setContentVisibility(false);
  emptyState.classList.add('hidden');
  delete emptyState.dataset.state;
  syncDesktopPinFallbackActions({
    showFocusMain: false,
  });
  const localeKey = getDesktopPinLocaleKey();
  if (
    existingControl &&
    existingControl.dataset.localeKey === localeKey &&
    updateExistingDesktopPinPanelControl(existingControl, entity)
  ) {
    return;
  }
  container.innerHTML = '';
  const control = createDesktopPinControlElement(entity);
  control.dataset.localeKey = localeKey;
  if (!interactive) control.style.pointerEvents = 'none';
  container.appendChild(control);
}

let desktopPinLocaleMessages = null;
let desktopPinLocaleKey = '';

// Pins update in place, which keeps static labels; a different catalog must rebuild the tile.
function getDesktopPinLocaleKey() {
  const { activeLocale, messages } = getLocaleState();
  if (messages !== desktopPinLocaleMessages) {
    desktopPinLocaleMessages = messages;
    desktopPinLocaleKey = `${activeLocale}|${Object.keys(messages || {}).length}`;
  }
  return desktopPinLocaleKey;
}

function renderDesktopPinnedTile(entityId, entity = null, options = {}) {
  renderDesktopPinTileInto({
    containerId: 'desktop-pin-content',
    emptyStateId: 'desktop-pin-empty',
    labelId: null,
    entityId,
    entity,
    interactive: true,
    hasSnapshot: !!options?.hasSnapshot,
    connectionIssue: options?.connectionIssue || '',
  });
}

function getRenderedDesktopPinTile() {
  const container = document.getElementById('desktop-pin-content');
  if (!container || container.classList.contains('hidden')) return null;
  return container.querySelector('.control-item[data-entity-id]');
}

/**
 * Tick cadence for a desktop pin window. Timers and playing media are drawn from the
 * clock rather than from entity updates, so they need a local tick to stay live.
 */
function getDesktopPinTickTargets(entityId = '') {
  const tile = getRenderedDesktopPinTile();
  const resolvedEntityId = tile?.dataset?.entityId || entityId;
  const entity = resolvedEntityId ? state.STATES?.[resolvedEntityId] : null;

  const hasTimer = !!entity && !!tile?.classList.contains('desktop-pin-timer-control');
  const mediaEntity =
    entity && tile?.classList.contains('desktop-pin-media-control') && entity.state === 'playing'
      ? entity
      : null;

  return {
    timeVisible: false,
    hasVisibleTimers: hasTimer,
    mediaEntity,
    hasLiveDisplays: hasTimer || !!mediaEntity,
  };
}

/**
 * Repaints the clock-derived parts of a pinned tile without rebuilding it, so
 * countdowns and media progress keep moving between entity updates.
 */
function updateDesktopPinLiveDisplays() {
  try {
    const tile = getRenderedDesktopPinTile();
    if (!tile) return;

    const entity = state.STATES?.[tile.dataset.entityId];
    if (!entity) return;

    if (tile.classList.contains('desktop-pin-timer-control')) {
      updateExistingDesktopPinTimerControl(tile, entity);
      return;
    }

    if (tile.classList.contains('desktop-pin-media-control')) {
      applyDesktopPinMediaVisualState(tile, getDesktopPinMediaValue(entity));
    }
  } catch (error) {
    console.error('Error updating desktop pin live displays:', error);
  }
}

function handleDesktopPinActionRequest({ entityId, action, payload = {}, requestId = null } = {}) {
  const sendResponse = (response) => respondToDesktopPinActionRequest(requestId, response);

  try {
    const resolvedEntityId = utils.resolveEntityId(entityId, state.STATES) || entityId;
    const entity = state.STATES?.[resolvedEntityId];
    if (!entity) {
      sendResponse({
        success: false,
        error: { message: t('Entity is not available') },
      });
      return;
    }
    const supportProfile = getDesktopPinSupportProfile(entity);

    switch (action) {
      case 'service-call': {
        const domain =
          typeof payload?.domain === 'string' && payload.domain.trim()
            ? payload.domain.trim()
            : getEntityDomain(entity.entity_id);
        const serviceName = typeof payload?.service === 'string' ? payload.service.trim() : '';
        const serviceData =
          payload?.serviceData && typeof payload.serviceData === 'object'
            ? payload.serviceData
            : {};

        if (!domain || !serviceName) {
          sendResponse({
            success: false,
            error: { message: t('Invalid service call request') },
          });
          return;
        }

        websocket
          .callService(domain, serviceName, {
            ...serviceData,
            entity_id: resolvedEntityId,
          })
          .then((result) => {
            sendResponse(normalizeDesktopPinActionResult(result));
          })
          .catch((error) => {
            handleServiceError(error, utils.getEntityDisplayName(entity));
            sendResponse({
              success: false,
              error: serializeDesktopPinActionError(error, `${domain}.${serviceName} failed`),
            });
          });
        return;
      }
      case 'toggle':
        toggleEntity(entity);
        break;
      case 'trigger':
        if (supportProfile.family === 'action') {
          const serviceName = isPressActionDomain(getEntityDomain(entity.entity_id))
            ? 'press'
            : 'trigger';
          callEntityDomainService(entity, serviceName);
        }
        break;
      case 'set-value':
        if (supportProfile.family === 'numeric') {
          const nextValue = Number(payload?.value);
          if (Number.isFinite(nextValue)) {
            callEntityDomainService(entity, 'set_value', { value: nextValue });
          }
        }
        break;
      case 'previous-option':
        if (supportProfile.family === 'enum') {
          queueDesktopPinEnumSelection(entity, 'previous');
        }
        break;
      case 'next-option':
        if (supportProfile.family === 'enum') {
          queueDesktopPinEnumSelection(entity, 'next');
        }
        break;
      case 'vacuum-primary':
        if (supportProfile.family === 'vacuum') {
          runDesktopPinVacuumAction(entity, getDesktopPinVacuumActionConfig(entity).primary);
        }
        break;
      case 'vacuum-secondary':
        if (supportProfile.family === 'vacuum') {
          runDesktopPinVacuumAction(entity, getDesktopPinVacuumActionConfig(entity).secondary);
        }
        break;
      case 'open-details':
        if (supportProfile.family === 'camera') {
          camera.openCamera(resolvedEntityId);
        } else if (supportProfile.family === 'sensor') {
          showSensorDetails(entity);
        } else if (supportProfile.family === 'light') {
          showBrightnessSlider(entity);
        } else if (supportProfile.family === 'climate') {
          showClimateControls(entity);
        } else if (supportProfile.family === 'fan') {
          showFanControls(entity);
        } else if (supportProfile.family === 'cover') {
          showCoverControls(entity);
        } else if (supportProfile.family === 'media') {
          showMediaDetail(entity);
        }
        break;
      case 'focus-main':
        // Focusing is handled by the main process before this event reaches the renderer.
        break;
      default:
        break;
    }
    sendResponse({ success: true });
  } catch (error) {
    console.error('Error handling desktop pin action request:', error);
    sendResponse({
      success: false,
      error: serializeDesktopPinActionError(error),
    });
  }
}

function createControlElement(entity, options = {}) {
  try {
    const renderContext = options.context || 'default';
    const isQuickAccessContext = renderContext === 'quick-access';

    entity = getEntityForDisplay(entity);
    if (!entity) {
      return document.createElement('div');
    }

    const div = document.createElement('div');
    div.className = 'control-item';
    div.dataset.entityId = entity.entity_id;
    applyQuickAccessTileActiveState(div, entity);
    applyQuickAccessTileAccessibility(div, entity);
    if (!isQuickAccessContext) {
      div.tabIndex = 0;
      div.addEventListener('keydown', (event) => {
        if (
          (event.target !== div && !event.target.classList.contains('tile-primary-button')) ||
          event.ctrlKey ||
          event.metaKey ||
          event.altKey
        )
          return;
        if (event.key !== 'Enter' && event.key !== ' ') return;
        event.preventDefault();
        if (shouldBlockInteraction(div)) return;
        const liveEntity = state.STATES?.[entity.entity_id] || entity;
        if (event.shiftKey) openEntityControls(liveEntity);
        else executeEntityPrimaryAction(liveEntity, { source: 'primary-card-keyboard' });
      });
    }
    if (isQuickAccessContext && isQuickAccessTileValueSizeApplicable(entity)) {
      div.dataset.valueSize = getQuickAccessTileValueSize(entity.entity_id);
    }
    div.addEventListener('contextmenu', (event) => {
      if (div.dataset.desktopPin === 'true') return;
      event.preventDefault();
      event.stopPropagation();
      Promise.resolve(
        getRendererHost().showEntityContextMenu?.(
          entity.entity_id,
          getDesktopPinSupportInfo(entity)
        )
      ).catch((error) => {
        console.error('Error opening entity tile menu:', error);
      });
    });
    emitUiDebug('quick_access.create_control', {
      entityId: entity.entity_id,
      state: entity.state,
      domain: entity.entity_id.split('.')[0],
      attributes: {
        brightness: entity?.attributes?.brightness ?? null,
        percentage: entity?.attributes?.percentage ?? null,
      },
    });

    // Per-entity column span (default 2 for media, 1 otherwise)
    const span = getTileSpan(entity);
    div.dataset.span = String(span);
    try {
      div.style.gridColumn = `span ${span}`;
    } catch {
      /* no-op */
    }

    // Check if sensor is a timer (has finishes_at, end_time, finish_time, or duration attribute)
    // Google Kitchen Timer and other timer sensors might use different attribute names or have timestamp as state
    const isTimerSensor = isTimerLikeSensorEntity(entity);
    const isTimer = entity.entity_id.startsWith('timer.') || isTimerSensor;
    const domain = getEntityDomain(entity.entity_id);
    const cameraPreviewRefresh =
      isQuickAccessContext && domain === 'camera'
        ? getQuickAccessCameraPreviewRefresh(entity.entity_id)
        : 'off';
    const hasCameraPreview = cameraPreviewRefresh !== 'off';
    const hasLiveCameraPreview = cameraPreviewRefresh === 'live';

    // Handle different entity types (matching main branch)
    if (domain === 'camera') {
      div.onclick = () => {
        if (!shouldBlockInteraction(div))
          executeEntityPrimaryAction(entity, {
            source: 'quick-access-click',
            sourceElement: div,
          });
      };
      div.title = t('Click to view {{name}}', { name: utils.getEntityDisplayName(entity) });
    } else if (domain === 'sensor' && !isTimerSensor) {
      div.onclick = () => {
        if (!shouldBlockInteraction(div))
          executeEntityPrimaryAction(entity, { source: 'quick-access-click' });
      };
      div.title = t('{{name}}: {{state}}', {
        name: utils.getEntityDisplayName(entity),
        state: utils.getEntityDisplayState(entity),
      });
    } else if (isTimer) {
      div.onclick = () => {
        if (!shouldBlockInteraction(div))
          executeEntityPrimaryAction(entity, { source: 'quick-access-click' });
      };
      div.title = t('Click to toggle {{name}}', { name: utils.getEntityDisplayName(entity) });
    } else if (entity.entity_id.startsWith('light.')) {
      setupLightControls(div, entity);
      div.title = getControlTileTitle(entity, t('Click to toggle, hold for brightness control'));
    } else if (entity.entity_id.startsWith('climate.')) {
      setupClimateControls(div, entity);
      div.title = getControlTileTitle(entity, t('Click to toggle, hold for temperature control'));
    } else if (entity.entity_id.startsWith('fan.')) {
      setupFanControls(div, entity);
      div.title = getControlTileTitle(entity, t('Click to toggle, hold for speed control'));
    } else if (entity.entity_id.startsWith('cover.')) {
      setupCoverControls(div, entity);
      div.title = getControlTileTitle(entity, t('Click to toggle, hold for position control'));
    } else if (entity.entity_id.startsWith('media_player.')) {
      div.title = t('Click to play/pause, hold for controls');
    } else if (domain === 'todo') {
      div.onclick = () => {
        if (!shouldBlockInteraction(div))
          executeEntityPrimaryAction(state.STATES?.[entity.entity_id] || entity, {
            source: 'quick-access-click',
          });
      };
      div.title = t('Click to view {{name}}', { name: utils.getEntityDisplayName(entity) });
      void fetchTodoItems(entity.entity_id).catch(() => {});
    } else if (domain === 'calendar') {
      div.onclick = () => {
        if (!shouldBlockInteraction(div))
          executeEntityPrimaryAction(state.STATES?.[entity.entity_id] || entity, {
            source: 'quick-access-click',
          });
      };
      div.title = t('Click to view {{name}}', { name: utils.getEntityDisplayName(entity) });
    } else if (
      entity.entity_id.startsWith('button.') ||
      entity.entity_id.startsWith('input_button.')
    ) {
      div.onclick = () => {
        if (!shouldBlockInteraction(div))
          executeEntityPrimaryAction(entity, { source: 'quick-access-click' });
      };
      div.title = t('Click to press {{name}}', { name: utils.getEntityDisplayName(entity) });
    } else if (QUICK_ACCESS_HELPER_DOMAINS.has(domain)) {
      div.onclick = () => {
        if (!shouldBlockInteraction(div)) openEntityControls(entity);
      };
      div.title = t('Click to view {{name}}', { name: utils.getEntityDisplayName(entity) });
    } else if (
      QUICK_ACCESS_TOGGLE_DOMAINS.has(domain) ||
      QUICK_ACCESS_ACTIVATE_DOMAINS.has(domain) ||
      domain === 'automation'
    ) {
      div.onclick = () => {
        if (!shouldBlockInteraction(div))
          executeEntityPrimaryAction(entity, { source: 'quick-access-click' });
      };
      div.title = t('Click to toggle {{name}}', { name: utils.getEntityDisplayName(entity) });
    } else {
      div.title = t('{{name}}: {{state}}', {
        name: utils.getEntityDisplayName(entity),
        state: utils.getEntityDisplayState(entity),
      });
    }

    const name = utils.escapeHtml(utils.getEntityDisplayName(entity));
    const state = utils.escapeHtml(utils.getEntityDisplayState(entity));

    let stateDisplay = '';
    if (domain === 'sensor' && !isTimerSensor) {
      const sensorDisplay = isQuickAccessContext ? getQuickAccessSensorDisplayParts(entity) : null;

      if (sensorDisplay) {
        div.classList.add('sensor-entity', 'sensor-numeric-entity');
        div.title = t('{{name}}: {{state}}', {
          name: utils.getEntityDisplayName(entity),
          state: sensorDisplay.text,
        });
        const sensorLabel = escapeHtmlAttribute(sensorDisplay.text);
        stateDisplay = `
        <div class="control-state control-sensor-readout" aria-label="${sensorLabel}">
          <span class="control-sensor-value" dir="auto">${utils.escapeHtml(sensorDisplay.value)}</span>
          ${sensorDisplay.unit ? `<span class="control-sensor-unit">${utils.escapeHtml(sensorDisplay.unit)}</span>` : ''}
        </div>
      `;
      } else {
        div.classList.add('sensor-entity');
        stateDisplay = `<div class="control-state">${state}</div>`;
      }
    } else if (isTimer) {
      const timerDisplay = utils.escapeHtml(
        utils.getTimerDisplay ? utils.getTimerDisplay(entity) : state
      );
      stateDisplay = `<div class="control-state timer-countdown">${timerDisplay}</div>`;
    } else if (['light', 'cover', 'fan', 'lock'].includes(domain)) {
      stateDisplay = `<div class="control-state">${utils.escapeHtml(getDeviceTileStateText(entity))}</div>`;
    } else if (entity.entity_id.startsWith('climate.')) {
      stateDisplay = `<div class="control-state">${utils.escapeHtml(utils.getEntityDisplayState(entity))}</div>`;
    } else if (entity.entity_id.startsWith('media_player.')) {
      // Media player state will be handled in setupMediaPlayerControls
      stateDisplay = '';
    } else if (domain === 'todo') {
      div.classList.add('todo-entity');
      stateDisplay = renderTodoTileStateMarkup(entity);
    } else if (domain === 'calendar') {
      div.classList.add('calendar-entity');
      stateDisplay = renderCalendarTileStateMarkup(entity);
    } else if (!hasCameraPreview) {
      const stateText = getQuickAccessTileStateText(entity);
      if (stateText) {
        stateDisplay = `<div class="control-state">${utils.escapeHtml(stateText)}</div>`;
      }
    }

    // Special layout for timer entities
    if (isTimer) {
      div.innerHTML = `
        <div class="control-icon timer-icon"></div>
        <div class="control-info timer-layout">
          <div class="control-name">${name}</div>
          ${stateDisplay}
        </div>
      `;
      div.classList.add('timer-entity');
      div.setAttribute('data-state', entity.state);
    } else if (entity.entity_id.startsWith('media_player.')) {
      // Media player layout will be handled in setupMediaPlayerControls
      div.innerHTML = `
        <div class="control-icon"></div>
        <div class="control-info">
          <div class="control-name">${name}</div>
          ${stateDisplay}
        </div>
      `;
      div.classList.add('media-player-entity');
    } else if (hasCameraPreview) {
      div.innerHTML = `
        <div class="camera-tile-visual" aria-hidden="true">
          <video class="camera-tile-preview-video" muted autoplay playsinline></video>
          <img class="camera-tile-preview-image" data-camera-buffer-active="true" data-camera-buffer-loaded="false" alt="" decoding="async">
          <img class="camera-tile-preview-image" data-camera-buffer-active="false" data-camera-buffer-loaded="false" alt="" decoding="async">
          <div class="camera-tile-fallback">
            <div class="control-icon"></div>
          </div>
          <div class="camera-tile-scrim"></div>
        </div>
        <div class="camera-tile-preview-badge" aria-hidden="true">
          <span class="camera-tile-preview-dot"></span>
          <span class="camera-tile-preview-badge-label">${utils.escapeHtml(hasLiveCameraPreview ? t('Live') : t('Snapshot'))}</span>
        </div>
        <div class="camera-tile-copy">
          <div class="control-name">${name}</div>
          <div class="control-state camera-tile-preview-status">${utils.escapeHtml(t(hasLiveCameraPreview ? 'Starting live stream…' : 'Loading snapshot…'))}</div>
        </div>
      `;
      div.classList.add('camera-entity', 'camera-preview-tile');
      div.dataset.cameraPreviewRefresh = cameraPreviewRefresh;
    } else {
      div.innerHTML = `
        <div class="control-icon"></div>
        <div class="control-info">
          <div class="control-name">${name}</div>
          ${stateDisplay}
        </div>
      `;
    }

    div.querySelectorAll('.control-icon').forEach((iconEl) => renderEntityIcon(iconEl, entity));

    if (['light', 'climate', 'fan', 'cover', 'media_player'].includes(domain)) {
      // Sibling native buttons expose both actions without nesting a button inside role=button.
      const primary = document.createElement('button');
      primary.type = 'button';
      primary.className = 'tile-primary-button';
      primary.tabIndex = isQuickAccessContext ? -1 : 0;
      div.appendChild(primary);
      const details = document.createElement('button');
      details.type = 'button';
      details.className = 'tile-details-button';
      details.title = t('Controls');
      details.appendChild(createLineIcon('sliders-horizontal'));
      details.setAttribute(
        'aria-label',
        t('Controls for {{name}}', { name: utils.getEntityDisplayName(entity) })
      );
      // A details click must never start the tile's hold timer or primary action.
      [
        'pointerdown',
        'pointerup',
        'mousedown',
        'mouseup',
        'touchstart',
        'touchend',
        'keydown',
        'keyup',
      ].forEach((type) => {
        details.addEventListener(type, (event) => event.stopPropagation());
      });
      details.addEventListener('click', (event) => {
        event.stopPropagation();
        if (!shouldBlockInteraction(div)) openEntityControls(entity);
      });
      div.appendChild(details);
      applyQuickAccessTileAccessibility(div, entity);
    }

    // Setup special controls after HTML is set
    if (entity.entity_id.startsWith('media_player.')) {
      setupMediaPlayerControls(div, entity);
      // Auto-fit removed - long lines end in a CSS ellipsis and carry the full text as a tooltip
    }
    if (isQuickAccessContext && div.classList.contains('sensor-numeric-entity')) {
      mountSensorTileChart(div, entity);
      observeSensorTileValueFit(div);
    }
    if (hasCameraPreview) {
      camera.mountCameraPreview(div, entity.entity_id, cameraPreviewRefresh);
    }

    applyQuickAccessTileAccessibility(div, entity);

    if (!isQuickAccessContext && !div.querySelector('.tile-primary-button')) div.tabIndex = 0;

    return div;
  } catch (error) {
    console.error('Error creating control element:', error);
    return document.createElement('div');
  }
}

/**
 * Create an unavailable entity element for favorited entities that no longer exist
 * @param {string} entityId - The entity ID that is unavailable
 * @returns {HTMLElement} - The unavailable entity element
 */
function createUnavailableElement(entityId) {
  try {
    const div = document.createElement('div');
    div.className = 'control-item unavailable-entity';
    div.dataset.entityId = entityId;
    div.dataset.span = '1';
    div.style.gridColumn = 'span 1';

    // Get custom name if available, otherwise use entity ID
    const customName = state.CONFIG.customEntityNames?.[entityId];
    const objectId = entityId.includes('.') ? entityId.split('.')[1] : entityId;
    const displayName = customName || objectId.replace(/_/g, ' ');
    applyQuickAccessTileAccessibility(div, {
      entity_id: entityId,
      attributes: { friendly_name: displayName },
    });

    div.innerHTML = `
      <div class="control-icon unavailable-icon" data-icon-kind="line">${lineIconMarkup('triangle-alert')}</div>
      <div class="control-info">
        <div class="control-name">${utils.escapeHtml(displayName)}</div>
        <div class="control-state unavailable-state"></div>
      </div>
    `;

    applyUnavailableRepairAffordance(div, entityId, displayName);
    div.addEventListener('click', () => {
      if (isReorganizeMode || !canRepairUnavailableEntities()) return;
      openEntityRepairModal(entityId);
    });
    emitUiDebug('quick_access.create_unavailable', { entityId });

    return div;
  } catch (error) {
    console.error('Error creating unavailable element:', error);
    return document.createElement('div');
  }
}

// A tile that opens controls has an instruction for its tooltip. The name leads it, so a name the
// tile cuts short (it stops at two lines) can still be read in full. The instruction goes through
// the existing '{{name}}: {{state}}' string as its `state`, on purpose: it is already translated in
// every language pack, so a new string would leave each pack to catch up. Keep the placeholder
// names, which the packs spell out.
function getControlTileTitle(entity, hint) {
  return t('{{name}}: {{state}}', { name: utils.getEntityDisplayName(entity), state: hint });
}

function applyQuickAccessTileAccessibility(div, entity) {
  if (!div || !entity?.entity_id) return;
  const primary = div.querySelector('.tile-primary-button');
  const domain = getEntityDomain(entity.entity_id);
  const readOnly =
    !QUICK_ACCESS_DIALOG_DOMAINS.has(domain) &&
    !QUICK_ACCESS_TOGGLE_DOMAINS.has(domain) &&
    !QUICK_ACCESS_ACTIVATE_DOMAINS.has(domain) &&
    domain !== 'automation' &&
    !div.classList.contains('unavailable-entity');
  div.setAttribute('role', primary || readOnly ? 'group' : 'button');
  div.setAttribute('aria-label', utils.getEntityDisplayName(entity));
  if (primary) {
    div.removeAttribute('tabindex');
    div.removeAttribute('aria-keyshortcuts');
    primary.setAttribute('aria-label', utils.getEntityDisplayName(entity));
    primary.setAttribute('aria-keyshortcuts', 'Enter Space Shift+Enter');
    div
      .querySelector('.tile-details-button')
      ?.setAttribute(
        'aria-label',
        t('Controls for {{name}}', { name: utils.getEntityDisplayName(entity) })
      );
  } else {
    div.setAttribute('tabindex', '-1');
    // Only tiles with a Controls button advertise Shift+Enter.
    if (readOnly) div.removeAttribute('aria-keyshortcuts');
    else div.setAttribute('aria-keyshortcuts', 'Enter Space');
  }
  linkTileStateReadout(div);
}

function linkTileStateReadout(div) {
  const readout = div.querySelector('.control-state');
  const described = div.querySelector('.tile-primary-button') || div;
  if (!readout) {
    described.removeAttribute('aria-describedby');
    return;
  }
  if (!tileStateReadoutIds.has(div)) {
    tileStateReadoutCount += 1;
    tileStateReadoutIds.set(div, `tile-state-${tileStateReadoutCount}`);
  }
  readout.id = tileStateReadoutIds.get(div);
  described.setAttribute('aria-describedby', readout.id);
}

function updateExistingUnavailableControl(div, entityId) {
  if (!div || !div.classList.contains('unavailable-entity')) return false;
  const customName = state.CONFIG.customEntityNames?.[entityId];
  const objectId = entityId.includes('.') ? entityId.split('.')[1] : entityId;
  const displayName = customName || objectId.replace(/_/g, ' ');
  div.dataset.entityId = entityId;
  const name = div.querySelector('.control-name');
  if (name) name.textContent = displayName;
  applyUnavailableRepairAffordance(div, entityId, displayName);
  return true;
}

/**
 * Whether an unavailable tile can offer the repair picker.
 *
 * The picker lists replacements out of `state.STATES`, so it is only useful once Home Assistant
 * has actually delivered its entities. While the connection is down (or has not completed its
 * first `get_states` yet) every favorite renders as unavailable, and advertising "Click to repair"
 * on all of them would only open a dialog saying there is nothing to pick.
 *
 * @returns {boolean}
 */
function canRepairUnavailableEntities() {
  return Object.keys(state.STATES || {}).length > 0;
}

/**
 * Apply the unavailable tile's label, tooltip, and accessible name, gated on whether repair is
 * currently possible. Shared by the create and reuse paths so a tile rendered while disconnected
 * picks up the repair affordance as soon as entities arrive.
 *
 * @param {HTMLElement} div - The unavailable tile element.
 * @param {string} entityId - The unavailable entity ID.
 * @param {string} displayName - The name shown on the tile.
 */
function applyUnavailableRepairAffordance(div, entityId, displayName) {
  const repairable = canRepairUnavailableEntities();
  div.classList.toggle('repairable', repairable);
  const unavailableState = div.querySelector('.unavailable-state');
  if (unavailableState) {
    unavailableState.textContent = repairable ? t('Click to repair') : t('Unavailable');
  }
  div.setAttribute(
    'aria-label',
    repairable
      ? t('{{name}} is unavailable. Click to choose its replacement.', { name: displayName })
      : t('{{name}} is unavailable.', { name: displayName })
  );
  div.title = repairable
    ? t('Entity {{entityId}} is unavailable. Click to repair it.', { entityId })
    : t(
        'Entity {{entityId}} is unavailable. It may have been deleted or renamed in Home Assistant.',
        {
          entityId,
        }
      );
}

function openEntityRepairModal(staleEntityId) {
  if (typeof staleEntityId !== 'string' || !staleEntityId.trim()) return;

  // Teardown rather than a user-facing dismissal: the dialog is rebuilt from scratch on every
  // open, so a leftover instance detaches immediately instead of animating out alongside (and
  // under the same id as) its replacement.
  document.getElementById('entity-repair-modal')?.remove();

  const modal = document.createElement('div');
  modal.id = 'entity-repair-modal';
  modal.className = 'modal';
  modal.setAttribute('aria-labelledby', 'entity-repair-title');

  const content = document.createElement('div');
  content.className = 'modal-content';
  const header = document.createElement('div');
  header.className = 'modal-header';
  const title = document.createElement('h2');
  title.id = 'entity-repair-title';
  title.textContent = t('Repair unavailable entity');
  const closeButton = document.createElement('button');
  closeButton.type = 'button';
  closeButton.className = 'close-btn';
  closeButton.setAttribute('aria-label', t('Close'));
  closeButton.textContent = '×';
  header.append(title, closeButton);

  const body = document.createElement('div');
  body.className = 'modal-body';
  const explanation = document.createElement('p');
  explanation.className = 'modal-lead';
  explanation.textContent = t(
    'Choose the entity that replaces {{entityId}}. Favorites, pages, pins, hotkeys, alerts, graphs, and saved display settings will all be updated.',
    { entityId: staleEntityId }
  );
  const searchGroup = document.createElement('div');
  searchGroup.className = 'form-group';
  const search = document.createElement('input');
  search.type = 'search';
  search.className = 'form-control';
  search.spellcheck = false;
  search.placeholder = t('Search replacement entities...');
  search.setAttribute('aria-label', t('Search replacement entities'));
  searchGroup.appendChild(search);
  const list = document.createElement('div');
  list.className = 'entity-selector-list';
  body.append(explanation, searchGroup, list);
  content.append(header, body);
  modal.appendChild(content);
  document.body.appendChild(modal);
  applyCloseButtonIcons(modal);

  let repairInFlight = false;
  const close = () => {
    if (repairInFlight) return;
    void uiUtils.closeDialog(modal, { remove: true });
  };

  const persistReplacement = async (replacementEntityId) => {
    repairInFlight = true;
    const reenable = uiUtils.disableControlsKeepingFocus(modal.querySelectorAll('button, input'));
    try {
      await persistAuthoritativeEntityIdReplacement(staleEntityId, replacementEntityId);
      renderActiveTab();
      renderPrimaryCards();
      updateWeatherFromHA();
      updateMediaTile();
      uiUtils.showToast(
        t('Replaced {{oldEntityId}} with {{newEntityId}}', {
          oldEntityId: staleEntityId,
          newEntityId: replacementEntityId,
        }),
        'success',
        4000
      );
      repairInFlight = false;
      close();
    } catch (error) {
      repairInFlight = false;
      reenable();
      showConfigPersistenceError(error);
    }
  };

  const renderCandidates = () => {
    const query = normalizeSearchText(search.value);
    const staleDomain = staleEntityId.split('.')[0];
    const candidates = Object.values(state.STATES || {})
      .filter(
        (entity) =>
          entity?.entity_id &&
          entity.entity_id !== staleEntityId &&
          (!query ||
            normalizeSearchText(entity.entity_id).includes(query) ||
            normalizeSearchText(utils.getEntityDisplayName(entity)).includes(query))
      )
      .sort((left, right) => {
        const leftSameDomain = left.entity_id.startsWith(`${staleDomain}.`) ? 1 : 0;
        const rightSameDomain = right.entity_id.startsWith(`${staleDomain}.`) ? 1 : 0;
        if (leftSameDomain !== rightSameDomain) return rightSameDomain - leftSameDomain;
        return compareNames(utils.getEntityDisplayName(left), utils.getEntityDisplayName(right));
      });

    list.replaceChildren();
    if (!candidates.length) {
      const empty = document.createElement('p');
      empty.className = 'entity-selector-empty';
      empty.textContent = t('No matching replacement entities found.');
      list.appendChild(empty);
      return;
    }

    candidates.forEach((entity) => {
      const item = document.createElement('div');
      item.className = 'entity-item';
      const main = document.createElement('div');
      main.className = 'entity-item-main';
      const info = document.createElement('div');
      info.className = 'entity-item-info';
      const name = document.createElement('span');
      name.className = 'entity-name';
      name.textContent = utils.getEntityDisplayName(entity);
      const id = document.createElement('span');
      id.className = 'entity-id';
      id.textContent = entity.entity_id;
      info.append(name, id);
      main.appendChild(info);
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'entity-selector-btn add';
      button.dataset.entityId = entity.entity_id;
      button.textContent = t('Use');
      button.addEventListener('click', () => {
        void persistReplacement(entity.entity_id);
      });
      item.append(main, button);
      list.appendChild(item);
    });
  };

  closeButton.addEventListener('click', close);
  search.addEventListener('input', renderCandidates);
  renderCandidates();
  // The search is the first thing to do here; without it focus would start on the close button.
  uiUtils.openDialog(modal, {
    display: null,
    initialFocus: search,
    describedBy: explanation,
    dismiss: close,
  });
}

function updateExistingQuickAccessControl(div, entity, options = {}) {
  const renderContext = options.context || 'default';
  const isQuickAccessContext = renderContext === 'quick-access';
  const displayEntity = getEntityForDisplay(entity);
  if (!div || !displayEntity?.entity_id || div.dataset.desktopPin === 'true') return false;

  applyQuickAccessTileActiveState(div, displayEntity);

  if (displayEntity.entity_id.startsWith('media_player.')) {
    return updateExistingMediaPlayerControl(div, displayEntity);
  }

  const span = getTileSpan(displayEntity);
  div.dataset.entityId = displayEntity.entity_id;
  div.dataset.span = String(span);
  div.style.gridColumn = `span ${span}`;
  if (isQuickAccessContext && isQuickAccessTileValueSizeApplicable(displayEntity)) {
    div.dataset.valueSize = getQuickAccessTileValueSize(displayEntity.entity_id);
  } else {
    delete div.dataset.valueSize;
  }
  if (isQuickAccessContext) {
    applyQuickAccessTileAccessibility(div, displayEntity);
  }

  const isTimerSensor = isTimerLikeSensorEntity(displayEntity);
  const isTimer = displayEntity.entity_id.startsWith('timer.') || isTimerSensor;
  const domain = getEntityDomain(displayEntity.entity_id);
  const icon = div.querySelector('.control-icon');
  if (icon) renderEntityIcon(icon, displayEntity);

  const name = div.querySelector('.control-name');
  if (name) name.textContent = utils.getEntityDisplayName(displayEntity);

  const stateEl = div.querySelector('.control-state');
  if (domain === 'sensor' && !isTimerSensor) {
    const sensorDisplay = isQuickAccessContext
      ? getQuickAccessSensorDisplayParts(displayEntity)
      : null;
    div.classList.add('sensor-entity');
    div.onclick = () => {
      if (!shouldBlockInteraction(div))
        showSensorDetails(state.STATES?.[displayEntity.entity_id] || displayEntity);
    };
    div.title = sensorDisplay
      ? t('{{name}}: {{state}}', {
          name: utils.getEntityDisplayName(displayEntity),
          state: sensorDisplay.text,
        })
      : t('{{name}}: {{state}}', {
          name: utils.getEntityDisplayName(displayEntity),
          state: utils.getEntityDisplayState(displayEntity),
        });
    if (sensorDisplay) {
      div.classList.add('sensor-numeric-entity');
      if (stateEl) stateEl.setAttribute('aria-label', sensorDisplay.text);
      const value = div.querySelector('.control-sensor-value');
      const unit = div.querySelector('.control-sensor-unit');
      const readout = div.querySelector('.control-sensor-readout');
      // A reading that did not change keeps its fit: measuring it again costs a layout.
      const needsFit =
        value?.textContent !== sensorDisplay.value ||
        (unit && unit.textContent !== sensorDisplay.unit) ||
        readout?.dataset.fitSize !== (div.dataset.valueSize || '');
      if (value) value.textContent = sensorDisplay.value;
      if (unit) unit.textContent = sensorDisplay.unit;
      if (needsFit) fitSensorTileValue(readout);
      appendLiveSensorHistoryValue(displayEntity);
      const cachedHistory = sensorHistoryCache.get(displayEntity.entity_id);
      renderSensorTileChart(div, displayEntity, cachedHistory?.series || []);
    } else if (stateEl) {
      div.classList.remove('sensor-numeric-entity');
      delete div.dataset.chartType;
      div.querySelector('.control-sensor-sparkline')?.remove();
      div.querySelector('.control-sensor-gauge')?.remove();
      stateEl.textContent = utils.getEntityDisplayState(displayEntity);
    }
    return true;
  }

  if (isTimer) {
    div.classList.add('timer-entity');
    div.dataset.state = displayEntity.state;
    div.title = t('Click to toggle {{name}}', { name: utils.getEntityDisplayName(displayEntity) });
    if (stateEl)
      stateEl.textContent = utils.getTimerDisplay
        ? utils.getTimerDisplay(displayEntity)
        : utils.getEntityDisplayState(displayEntity);
    return true;
  }

  if (['light', 'cover', 'fan', 'lock'].includes(domain)) {
    // A tile without a state line is redrawn with one.
    if (!stateEl) return false;
    stateEl.textContent = getDeviceTileStateText(displayEntity);
  }

  if (displayEntity.entity_id.startsWith('light.')) {
    div.title = getControlTileTitle(
      displayEntity,
      t('Click to toggle, hold for brightness control')
    );
    return true;
  }

  if (displayEntity.entity_id.startsWith('climate.')) {
    div.title = getControlTileTitle(
      displayEntity,
      t('Click to toggle, hold for temperature control')
    );
    if (stateEl) stateEl.textContent = utils.getEntityDisplayState(displayEntity);
    return true;
  }

  if (displayEntity.entity_id.startsWith('fan.')) {
    div.title = getControlTileTitle(displayEntity, t('Click to toggle, hold for speed control'));
    return true;
  }

  if (displayEntity.entity_id.startsWith('cover.')) {
    div.title = getControlTileTitle(displayEntity, t('Click to toggle, hold for position control'));
    return true;
  }

  if (displayEntity.entity_id.startsWith('camera.')) {
    const cameraPreviewRefresh = isQuickAccessContext
      ? getQuickAccessCameraPreviewRefresh(displayEntity.entity_id)
      : 'off';
    const expectsPreview = cameraPreviewRefresh !== 'off';
    if (expectsPreview !== div.classList.contains('camera-preview-tile')) return false;
    div.onclick = () => {
      if (!shouldBlockInteraction(div))
        executeEntityPrimaryAction(displayEntity, {
          source: 'quick-access-click',
          sourceElement: div,
        });
    };
    div.title = t('Click to view {{name}}', { name: utils.getEntityDisplayName(displayEntity) });
    if (expectsPreview) {
      camera.mountCameraPreview(div, displayEntity.entity_id, cameraPreviewRefresh);
    } else {
      setQuickAccessTileStateLine(div, getQuickAccessTileStateText(displayEntity));
    }
    return true;
  }

  if (domain === 'todo') {
    div.classList.add('todo-entity');
    div.onclick = () => {
      if (!shouldBlockInteraction(div))
        executeEntityPrimaryAction(state.STATES?.[displayEntity.entity_id] || displayEntity, {
          source: 'quick-access-click',
        });
    };
    div.title = t('Click to view {{name}}', { name: utils.getEntityDisplayName(displayEntity) });
    if (stateEl) stateEl.textContent = getTodoTileCountLabel(displayEntity);
    void fetchTodoItems(displayEntity.entity_id).catch(() => {});
    return true;
  }

  if (domain === 'calendar') {
    div.classList.add('calendar-entity');
    div.onclick = () => {
      if (!shouldBlockInteraction(div))
        executeEntityPrimaryAction(state.STATES?.[displayEntity.entity_id] || displayEntity, {
          source: 'quick-access-click',
        });
    };
    div.title = t('Click to view {{name}}', { name: utils.getEntityDisplayName(displayEntity) });
    if (stateEl) stateEl.innerHTML = getCalendarNextEventMarkup(displayEntity);
    return true;
  }

  setQuickAccessTileStateLine(div, getQuickAccessTileStateText(displayEntity));
  const liveEntity = () => state.STATES?.[displayEntity.entity_id] || displayEntity;
  if (QUICK_ACCESS_HELPER_DOMAINS.has(domain)) {
    div.onclick = () => {
      if (!shouldBlockInteraction(div)) openEntityControls(liveEntity());
    };
    div.title = t('Click to view {{name}}', { name: utils.getEntityDisplayName(displayEntity) });
    return true;
  }
  if (
    !QUICK_ACCESS_TOGGLE_DOMAINS.has(domain) &&
    !QUICK_ACCESS_ACTIVATE_DOMAINS.has(domain) &&
    domain !== 'automation'
  ) {
    div.onclick = null;
    div.title = t('{{name}}: {{state}}', {
      name: utils.getEntityDisplayName(displayEntity),
      state: utils.getEntityDisplayState(displayEntity),
    });
    return true;
  }
  div.onclick = () => {
    if (!shouldBlockInteraction(div))
      executeEntityPrimaryAction(liveEntity(), { source: 'quick-access-click' });
  };
  div.title =
    displayEntity.entity_id.startsWith('button.') ||
    displayEntity.entity_id.startsWith('input_button.')
      ? t('Click to press {{name}}', { name: utils.getEntityDisplayName(displayEntity) })
      : t('Click to toggle {{name}}', { name: utils.getEntityDisplayName(displayEntity) });
  return true;
}

function showSensorDetails(entity) {
  try {
    if (entity?.entity_id && isFiniteNumericSensorState(entity)) {
      const display = getQuickAccessSensorDisplayParts(entity);
      let unsubscribe = () => {};
      const modal = createEntityDetailModal({
        className: 'sensor-detail-modal',
        title: utils.getEntityDisplayName(entity),
        onClose: () => unsubscribe(),
      });
      const body = modal.querySelector('.modal-body');
      if (!body) return;

      const summary = document.createElement('div');
      summary.className = 'sensor-detail-summary';

      const icon = document.createElement('div');
      icon.className = 'sensor-detail-icon';
      renderEntityIcon(icon, entity);

      const readout = document.createElement('div');
      readout.className = 'sensor-detail-readout';
      readout.setAttribute('aria-label', display?.text || utils.getEntityDisplayState(entity));

      const value = document.createElement('span');
      value.className = 'sensor-detail-value';
      value.textContent = display?.value || utils.getEntityDisplayState(entity);
      readout.appendChild(value);

      if (display?.unit) {
        const unit = document.createElement('span');
        unit.className = 'sensor-detail-unit';
        unit.textContent = display.unit;
        readout.appendChild(unit);
      }

      summary.appendChild(icon);
      summary.appendChild(readout);
      body.appendChild(summary);

      // Once Home Assistant removes the entity, show it as unavailable, not the opening reading.
      let removed = false;
      const refreshSummary = () => {
        const current = removed
          ? { ...entity, state: 'unavailable' }
          : state.STATES?.[entity.entity_id] || entity;
        const parts = isEntityAvailable(current) ? getQuickAccessSensorDisplayParts(current) : null;
        const text = parts?.text || utils.getEntityDisplayState(current);
        readout.setAttribute('aria-label', text);
        value.textContent = parts?.value ?? text;
        let unit = readout.querySelector('.sensor-detail-unit');
        if (parts?.unit) {
          if (!unit) {
            unit = document.createElement('span');
            unit.className = 'sensor-detail-unit';
            readout.appendChild(unit);
          }
          unit.textContent = parts.unit;
        } else unit?.remove();
        renderEntityIcon(icon, current);
        modal.querySelector('h2').textContent = utils.getEntityDisplayName(current);
      };
      readout.setAttribute('aria-live', 'polite');
      unsubscribe = state.subscribeEntity(entity.entity_id, (next) => {
        removed = !next;
        refreshSummary();
      });
      refreshSummary();

      mountSensorHistoryDetail({
        body,
        modal,
        entity,
        websocket,
        normalize: normalizeSensorHistoryResponse,
        render: renderSensorDetailSparkline,
      });
      return;
    }

    uiUtils.showToast(
      t('{{name}}: {{state}}', {
        name: utils.getEntityDisplayName(entity),
        state: utils.getEntityDisplayState(entity),
      }),
      'info',
      3000
    );
  } catch (error) {
    console.error('Error showing sensor details:', error);
  }
}

// Pop-ups whose controls act on a device with one keypress (a cover, a light, a fan) or whose
// sliders hold off live updates while focused start on their heading, so a stray key cannot move a
// garage door and the first update from Home Assistant still lands. Tab reaches the first control.
function startOnHeading(modal, focusSelector = null) {
  return () => {
    const requested = focusSelector && modal.querySelector(focusSelector);
    if (requested) return requested;
    const heading = modal.querySelector('.modal-header h1, .modal-header h2, .modal-header h3');
    if (heading) heading.tabIndex = -1;
    return heading;
  };
}

// Opens one of the entity pop-ups through the shared dialog helper. The pop-up's heading names it,
// and focus starts on its first control rather than on the header's Close button; content added
// after this call can name a better first stop with `data-initial-focus`.
function activateAccessibleDialogModal(
  modal,
  { titleIdPrefix = 'dialog-title', dismiss, initialFocus, replaces = null } = {}
) {
  if (!modal) return;
  dialogModalIdCounter += 1;
  const titleElement = modal.querySelector('h1, h2, h3');
  if (titleElement && !titleElement.id) {
    titleElement.id = `${titleIdPrefix}-${dialogModalIdCounter}`;
  }
  uiUtils.openDialog(modal, {
    display: null,
    labelledBy: titleElement || undefined,
    initialFocus,
    dismiss,
    replaces,
  });
}

/**
 * An entity Home Assistant reports as unavailable keeps its pop-up (so its name and last values
 * stay readable) but says so up front and disables the controls, instead of showing "Off" and
 * sliders that would only fail. Dialogs that follow live state call this again after each update,
 * so the note and disabled controls also clear when the entity comes back.
 */
function showUnavailableDialogState(modal, entity) {
  if (!modal) return;
  if (entity?.state !== 'unavailable') {
    if (!modal.classList.contains('entity-unavailable')) return;
    modal.classList.remove('entity-unavailable');
    modal.querySelector('.dialog-unavailable-note')?.remove();
    // Only re-enable what this disabled; controls a device can't use stay disabled.
    modal.querySelectorAll('[data-unavailable-disabled]').forEach((control) => {
      control.disabled = false;
      delete control.dataset.unavailableDisabled;
    });
    return;
  }
  const body = modal.querySelector('.modal-body');
  if (!body) return;
  if (!modal.classList.contains('entity-unavailable')) {
    modal.classList.add('entity-unavailable');
    const note = document.createElement('div');
    note.className = 'dialog-unavailable-note';
    note.setAttribute('role', 'status');
    note.innerHTML = `
    <span class="dialog-unavailable-note-icon" aria-hidden="true">${lineIconMarkup('wifi-off')}</span>
    <span class="dialog-unavailable-note-text">
      <strong>${utils.escapeHtml(t('{{name}} is unavailable.', { name: utils.getEntityDisplayName(entity) }))}</strong>
      <span>${utils.escapeHtml(t("Home Assistant can't reach it right now. Close this and try again once it's back."))}</span>
    </span>`;
    body.prepend(note);
  }
  modal
    .querySelectorAll(
      '.modal-body input, .modal-body button, .modal-body select, .modal-footer .btn-primary'
    )
    .forEach((control) => {
      if (control.disabled) return;
      control.disabled = true;
      control.dataset.unavailableDisabled = 'true';
    });
  modal
    .querySelectorAll('#brightness-value-large, #fan-speed-value, #cover-position-value')
    .forEach((value) => {
      value.textContent = t('Unavailable');
    });
}

// `beforeClose` lets a dialog with work in flight finish it before the user's close takes effect
// (the comparison graph editor saves as it goes). Closing programmatically skips the wait.
function createEntityDetailModal({ className, title, onClose = null, beforeClose = null }) {
  ensureEntityCacheScope();
  const modal = document.createElement('div');
  modal.className = `modal ${className}`;
  modal.innerHTML = `
    <div class="modal-content entity-detail-modal-content">
      <div class="modal-header">
        <h2></h2>
        <button class="close-btn" type="button" aria-label="${escapeHtmlAttribute(t('Close'))}">×</button>
      </div>
      <div class="modal-body"></div>
    </div>
  `;
  const titleEl = modal.querySelector('h2');
  if (titleEl) titleEl.textContent = title;

  let closing = false;
  const closeModal = () => {
    if (closing) return;
    closing = true;
    entityDetailClosers.delete(closeModal);
    onClose?.();
    void uiUtils.closeDialog(modal, { remove: true });
  };
  entityDetailClosers.add(closeModal);
  entityDetailModalClosers.set(modal, closeModal);
  const requestClose = async () => {
    if (closing) return;
    if (beforeClose) await beforeClose();
    closeModal();
  };
  const closeBtn = modal.querySelector('.close-btn');
  if (closeBtn) closeBtn.onclick = requestClose;
  document.body.appendChild(modal);
  applyCloseButtonIcons(modal);
  activateAccessibleDialogModal(modal, {
    titleIdPrefix: 'entity-detail-title',
    dismiss: requestClose,
  });
  return modal;
}

function showHelperControls(entity) {
  let unsubscribe = null;
  let closed = false;
  let busy = false;
  const modal = createEntityDetailModal({
    className: 'helper-controls-modal',
    title: utils.getEntityDisplayName(entity),
    onClose: () => {
      closed = true;
      unsubscribe?.();
    },
  });
  const body = modal.querySelector('.modal-body');
  const domain = getEntityDomain(entity.entity_id);
  const live = () => state.STATES?.[entity.entity_id];
  const form = document.createElement('form');
  const readout = document.createElement('p');
  readout.className = 'modal-lead';
  readout.setAttribute('role', 'status');
  body.append(readout, form);
  let input = null;
  if (domain !== 'vacuum') {
    const group = document.createElement('div');
    group.className = 'form-group';
    const label = document.createElement('label');
    label.textContent = utils.getEntityDisplayName(entity);
    label.htmlFor = `helper-controls-${entity.entity_id}`;
    input = document.createElement(
      ['select', 'input_select'].includes(domain) ? 'select' : 'input'
    );
    input.id = label.htmlFor;
    input.className = 'form-control';
    if (input.tagName === 'INPUT') input.type = 'number';
    group.append(label, input);
    form.append(group);
  }
  const actions = document.createElement('div');
  actions.className = 'entity-detail-actions';
  form.append(actions);
  const refresh = () => {
    const current = live();
    const available = isEntityAvailable(current);
    readout.textContent = available
      ? utils.getEntityDisplayState(current)
      : t('Entity is unavailable');
    if (input) {
      input.disabled = !available || busy;
      if (input.tagName === 'SELECT') {
        const options = current?.attributes?.options || [];
        const selected = document.activeElement === input ? input.value : current?.state;
        input.replaceChildren(...options.map((value) => new Option(value, value)));
        input.value = options.includes(selected) ? selected : current?.state || '';
      } else {
        for (const attr of ['min', 'max', 'step']) {
          const value = current?.attributes?.[attr];
          if (value != null) input.setAttribute(attr, String(value));
          else input.removeAttribute(attr);
        }
        if (!input.hasAttribute('step')) input.step = 'any';
        if (document.activeElement !== input)
          input.value = Number.isFinite(Number(current?.state)) ? current.state : '';
      }
    }
    const supported = getHelperActions(current || entity, state.SERVICES);
    if (input && !supported.length) input.disabled = true;
    const focusedService = actions.contains(document.activeElement)
      ? document.activeElement.dataset.service
      : null;
    actions.replaceChildren();
    supported.forEach((action, index) => {
      const button = document.createElement('button');
      button.type = 'button';
      // The first action is the dialog's main one; a vacuum's others sit beside it, quieter.
      button.className = index === 0 ? 'btn btn-primary' : 'btn btn-secondary';
      button.dataset.service = action.service;
      button.textContent = t(action.label);
      button.disabled = !available || busy;
      button.onclick = () => void run(action.service);
      actions.append(button);
    });
    if (focusedService && !busy)
      actions.querySelector(`[data-service="${focusedService}"]`)?.focus();
    if (!supported.length && available) readout.textContent = t('No controls available');
  };
  const run = async (service) => {
    const current = live();
    if (
      closed ||
      busy ||
      !isEntityAvailable(current) ||
      !getHelperActions(current, state.SERVICES).some((action) => action.service === service)
    )
      return;
    const data = getHelperServiceData(current, input?.value);
    if (!data || (input && !input.checkValidity())) {
      uiUtils.showToast(t('Invalid value'), 'error');
      input?.focus();
      return;
    }
    busy = true;
    const focusedInput = document.activeElement === input;
    const focusedAction = actions.contains(document.activeElement)
      ? document.activeElement.dataset.service
      : null;
    refresh();
    try {
      await websocket.callService(domain, service, data);
      if (!closed) uiUtils.showToast(t('Command sent'), 'success');
    } catch {
      if (!closed)
        uiUtils.showToast(t('Could not run command. Check your connection and retry.'), 'error');
    } finally {
      busy = false;
      if (!closed) {
        refresh();
        if (focusedInput && !input.disabled) input.focus();
        else if (focusedAction)
          actions.querySelector(`[data-service="${focusedAction}"]:not(:disabled)`)?.focus();
      }
    }
  };
  form.onsubmit = (event) => {
    event.preventDefault();
    const action = getHelperActions(live() || entity, state.SERVICES)[0];
    if (action) void run(action.service);
  };
  unsubscribe = state.subscribeEntity(entity.entity_id, () => {
    if (!closed) refresh();
  });
  refresh();
}

function requestAlarmCode(entity) {
  return new Promise((resolve) => {
    let code = null;
    let input = null;
    const modal = createEntityDetailModal({
      className: 'alarm-code-modal',
      title: utils.getEntityDisplayName(entity),
      onClose: () => {
        if (input) input.value = '';
        resolve(code);
      },
    });
    const form = document.createElement('form');
    const group = document.createElement('div');
    group.className = 'form-group';
    const label = document.createElement('label');
    label.textContent = t('Alarm code');
    label.htmlFor = 'alarm-code-input';
    input = document.createElement('input');
    input.id = label.htmlFor;
    input.className = 'form-control';
    input.type = 'password';
    input.required = true;
    input.maxLength = 128;
    input.autocomplete = 'off';
    if (entity.attributes?.code_format === 'number') {
      input.inputMode = 'numeric';
      input.pattern = '[0-9]+';
    }
    group.append(label, input);
    const submit = document.createElement('button');
    submit.type = 'submit';
    submit.className = 'btn btn-primary';
    submit.textContent = t('Apply');
    const actions = document.createElement('div');
    actions.className = 'entity-detail-actions';
    actions.append(submit);
    form.append(group, actions);
    modal.querySelector('.modal-body').append(form);
    form.onsubmit = (event) => {
      event.preventDefault();
      if (!input.checkValidity()) {
        input.reportValidity();
        return;
      }
      code = input.value;
      modal.querySelector('.close-btn').click();
    };
    // The focus trap installs after this and would otherwise start on the close button.
    input.dataset.initialFocus = '';
  });
}

// Callers that can tell the entity was deleted pass `getEntity`, so a late response or a click
// never falls back to the opening snapshot.
const liveTodoEntity = (entity) => state.STATES?.[entity.entity_id] || entity;

function renderTodoItemsInto(container, entity, items, getEntity = () => liveTodoEntity(entity)) {
  if (!container) return;
  container.innerHTML = '';

  const list = document.createElement('div');
  list.className = 'todo-items-list';

  if (!items.length) {
    const empty = document.createElement('div');
    empty.className = 'entity-detail-empty';
    empty.textContent = t('No active items');
    list.appendChild(empty);
  } else {
    items.forEach((item) => {
      const row = document.createElement('label');
      row.className = 'todo-item-row';
      row.dataset.status = item.status || 'needs_action';

      const checkbox = document.createElement('input');
      checkbox.type = 'checkbox';
      checkbox.checked = item.status === 'completed';
      checkbox.disabled = !item.uid || !getTodoCapabilities(entity).canUpdate;
      if (item.uid) checkbox.dataset.uid = item.uid;

      const summary = document.createElement('span');
      summary.className = 'todo-item-summary';
      summary.textContent = item.summary || t('Untitled item');

      checkbox.addEventListener('change', async () => {
        const current = getEntity();
        if (!getTodoCapabilities(current).canUpdate) {
          checkbox.checked = item.status === 'completed';
          return;
        }
        checkbox.disabled = true;
        checkbox.dataset.pending = 'true';
        try {
          await websocket.callService('todo', 'update_item', {
            entity_id: entity.entity_id,
            item: item.uid,
            status: checkbox.checked ? 'completed' : 'needs_action',
          });
          await loadTodoItemsInto(container, entity, { focusUid: item.uid, getEntity });
        } catch (error) {
          checkbox.checked = !checkbox.checked;
          delete checkbox.dataset.pending;
          checkbox.disabled = !getTodoCapabilities(getEntity()).canUpdate;
          checkbox.focus();
          handleServiceError(error, utils.getEntityDisplayName(entity));
        }
      });

      row.appendChild(checkbox);
      row.appendChild(summary);
      list.appendChild(row);
    });
  }

  container.appendChild(list);
}

// A status line in a detail dialog's list area (Loading..., Unavailable), set like the empty list.
function showDetailMessage(container, text) {
  const message = document.createElement('div');
  message.className = 'entity-detail-empty';
  message.textContent = text;
  container.replaceChildren(message);
}

// Reloading replaces the list, so the checkbox or Retry button that started it is gone and focus
// falls to <body>. `focusUid` (an item uid, or true for the first control) puts it back.
async function loadTodoItemsInto(
  container,
  entity,
  { focusUid = null, getEntity = () => liveTodoEntity(entity) } = {}
) {
  showDetailMessage(container, t('Loading...'));
  try {
    const items = await fetchTodoItems(entity.entity_id, { force: true });
    if (!container.isConnected || container.closest('.modal-closing')) return;
    renderTodoItemsInto(container, getEntity(), items, getEntity);
  } catch {
    if (!container.isConnected || container.closest('.modal-closing')) return;
    const message = document.createElement('p');
    message.setAttribute('role', 'alert');
    message.textContent = t('Unable to load items');
    const retry = document.createElement('button');
    retry.type = 'button';
    retry.className = 'btn btn-secondary';
    retry.textContent = t('Retry');
    retry.onclick = () => {
      void loadTodoItemsInto(container, entity, { focusUid: true, getEntity });
    };
    container.replaceChildren(message, retry);
  }
  if (!focusUid || !container.isConnected) return;
  const active = document.activeElement;
  if (active && active !== document.body && !container.contains(active)) return;
  const controls = Array.from(container.querySelectorAll('input, button')).filter(
    (control) => !control.disabled
  );
  const target =
    controls.find((control) => control.dataset.uid === focusUid) ||
    controls[0] ||
    container.closest('.modal')?.querySelector('.todo-add-form input');
  target?.focus();
}

function showTodoDetails(entity) {
  try {
    if (!entity?.entity_id) return;
    let unsubscribe = () => {};
    const modal = createEntityDetailModal({
      className: 'todo-modal',
      title: utils.getEntityDisplayName(entity),
      onClose: () => unsubscribe(),
    });
    const body = modal.querySelector('.modal-body');
    if (!body) return;

    const addForm = document.createElement('form');
    addForm.className = 'todo-add-form';
    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'form-control';
    input.placeholder = t('Add item');
    input.setAttribute('aria-label', t('Add item'));
    const addButton = document.createElement('button');
    addButton.type = 'submit';
    addButton.className = 'btn btn-primary';
    addButton.textContent = t('Add');
    addForm.appendChild(input);
    addForm.appendChild(addButton);

    const listContainer = document.createElement('div');
    listContainer.className = 'todo-detail-list-container';
    showDetailMessage(listContainer, t('Loading...'));

    let busy = false;
    const readOnly = document.createElement('p');
    readOnly.className = 'control-capability-note';
    readOnly.textContent = t('This list is read-only.');
    let lastState = entity.state;
    // Once Home Assistant removes the entity, the opening snapshot must not keep writes enabled.
    let removed = false;
    const liveTodo = () =>
      removed ? { ...entity, state: 'unavailable' } : state.STATES?.[entity.entity_id] || entity;
    const refreshTodo = () => {
      const current = liveTodo();
      showUnavailableDialogState(modal, current);
      const capabilities = getTodoCapabilities(current);
      input.disabled = busy || !capabilities.canAdd;
      addButton.disabled = busy || !capabilities.canAdd;
      readOnly.hidden =
        !isEntityAvailable(current) || capabilities.canAdd || capabilities.canUpdate;
      listContainer.querySelectorAll('input[type="checkbox"]').forEach((checkbox) => {
        checkbox.disabled =
          !!checkbox.dataset.pending || !checkbox.dataset.uid || !capabilities.canUpdate;
      });
      if (current.state !== lastState) {
        lastState = current.state;
        if (isEntityAvailable(current)) {
          void loadTodoItemsInto(listContainer, current, { getEntity: liveTodo });
        }
      }
    };

    addForm.addEventListener('submit', async (event) => {
      event.preventDefault();
      if (busy || !getTodoCapabilities(liveTodo()).canAdd) return;
      const summary = input.value.trim();
      if (!summary) return;
      busy = true;
      refreshTodo();
      try {
        await websocket.callService('todo', 'add_item', {
          entity_id: entity.entity_id,
          item: summary,
        });
        input.value = '';
        await loadTodoItemsInto(listContainer, entity, { getEntity: liveTodo });
      } catch (error) {
        handleServiceError(error, utils.getEntityDisplayName(entity));
      } finally {
        busy = false;
        refreshTodo();
        if (input.isConnected && !input.disabled) input.focus();
      }
    });

    body.appendChild(addForm);
    body.appendChild(readOnly);
    body.appendChild(listContainer);
    unsubscribe = state.subscribeEntity(entity.entity_id, (next) => {
      removed = !next;
      refreshTodo();
    });
    refreshTodo();
    if (isEntityAvailable(entity)) {
      void loadTodoItemsInto(listContainer, entity, { getEntity: liveTodo });
    } else showDetailMessage(listContainer, t('Unavailable'));
  } catch (error) {
    console.error('Error showing todo details:', error);
  }
}

// Line breaks that HTML event descriptions (Google Calendar's among them) mark with tags.
const CALENDAR_DESCRIPTION_BREAK_TAGS = /<br\s*\/?>|<\/(?:p|div|li|h[1-6]|tr)>/gi;

/**
 * An event description as plain text. Some calendars send HTML, which the dialog would otherwise
 * show tag by tag. Tags become the line breaks they stood for and entities are decoded; the text
 * is parsed into an inert document, so nothing in it runs or loads.
 * @param {string} description - The event's description as Home Assistant reports it.
 * @returns {string}
 */
function getCalendarDescriptionText(description) {
  if (typeof description !== 'string') return '';
  if (!/<[a-z!/][^>]*>|&[#a-z0-9]+;/i.test(description)) return description.trim();
  const marked = description.replace(CALENDAR_DESCRIPTION_BREAK_TAGS, (tag) => `${tag}\n`);
  const { body } = new DOMParser().parseFromString(marked, 'text/html');
  // Code, not words, even though textContent would include it.
  body.querySelectorAll('script, style, template').forEach((element) => element.remove());
  const text = body.textContent || '';
  return text
    .replace(/\u00a0/g, ' ')
    .split('\n')
    .map((line) => line.replace(/[ \t]+/g, ' ').trim())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function renderCalendarEventsInto(container, events) {
  if (!container) return;
  container.innerHTML = '';

  if (!events.length) {
    const empty = document.createElement('div');
    empty.className = 'entity-detail-empty';
    empty.textContent = t('No upcoming events');
    container.appendChild(empty);
    return;
  }

  events.forEach((event) => {
    const item = document.createElement('div');
    item.className = 'calendar-event-row';

    const summary = document.createElement('div');
    summary.className = 'calendar-event-summary';
    summary.textContent = event.summary || event.message || t('Untitled event');

    const time = document.createElement('div');
    time.className = 'calendar-event-time';
    time.textContent = formatCalendarEventRange(event);

    item.appendChild(summary);
    item.appendChild(time);

    const descriptionText = getCalendarDescriptionText(event.description);
    if (descriptionText) {
      const description = document.createElement('div');
      description.className = 'calendar-event-description';
      description.textContent = descriptionText;
      item.appendChild(description);
    }

    container.appendChild(item);
  });
}

function showCalendarDetails(entity) {
  try {
    if (!entity?.entity_id) return;
    const modal = createEntityDetailModal({
      className: 'calendar-modal',
      title: utils.getEntityDisplayName(entity),
    });
    const body = modal.querySelector('.modal-body');
    if (!body) return;

    const listContainer = document.createElement('div');
    listContainer.className = 'calendar-events-list';
    listContainer.setAttribute('role', 'status');
    const toolbar = document.createElement('div');
    toolbar.className = 'calendar-toolbar';
    const range = document.createElement('p');
    range.className = 'modal-lead';
    range.textContent = t('Upcoming events for the next 7 days');
    const refresh = document.createElement('button');
    refresh.type = 'button';
    refresh.className = 'btn btn-secondary btn-sm';
    refresh.textContent = t('Refresh');
    toolbar.append(range, refresh);
    body.append(toolbar, listContainer);
    let loading = false;
    refresh.onclick = async () => {
      if (loading) return;
      loading = true;
      refresh.setAttribute('aria-busy', 'true');
      showDetailMessage(listContainer, t('Loading...'));
      const start = new Date();
      const end = new Date(start.getTime() + 7 * 24 * 60 * 60 * 1000);
      try {
        const response = await callServiceWithResponse('calendar', 'get_events', {
          entity_id: entity.entity_id,
          start_date_time: start.toISOString(),
          end_date_time: end.toISOString(),
        });
        if (!modal.isConnected || modal.classList.contains('modal-closing')) return;
        renderCalendarEventsInto(
          listContainer,
          normalizeCalendarEvents(response, entity.entity_id)
        );
        refresh.textContent = t('Refresh');
      } catch {
        if (!modal.isConnected || modal.classList.contains('modal-closing')) return;
        showDetailMessage(listContainer, t('Unable to load events'));
        refresh.textContent = t('Retry');
      } finally {
        loading = false;
        refresh.removeAttribute('aria-busy');
      }
    };
    void refresh.onclick();
  } catch (error) {
    console.error('Error showing calendar details:', error);
  }
}

function setupPressAndHoldToggle(div, entity, onLongPress) {
  try {
    const liveEntity = () => state.STATES?.[entity.entity_id] || entity;
    let pressTimer = null;
    let longPressTriggered = false;
    let shortPressHandled = false;

    const startPress = (e) => {
      if (e && typeof e.button === 'number' && e.button !== 0) return;
      const blocked = shouldBlockInteraction(div);
      emitUiDebug('quick_access.pointer_down', {
        entityId: entity.entity_id,
        pointerType: e?.pointerType || 'unknown',
        button: typeof e?.button === 'number' ? e.button : null,
        blocked,
        reorganizeMode: isReorganizeMode,
      });
      if (blocked) {
        return;
      }
      longPressTriggered = false;
      shortPressHandled = false;
      if (pressTimer) {
        clearTimeout(pressTimer);
        activePressTimers.delete(pressTimer);
      }
      pressTimer = setTimeout(() => {
        longPressTriggered = true;
        activePressTimers.delete(pressTimer);
        pressTimer = null;
        emitUiDebug('quick_access.long_press', {
          entityId: entity.entity_id,
          domain: entity.entity_id.split('.')[0],
          state: liveEntity().state,
        });
        onLongPress(liveEntity());
      }, 500);
      activePressTimers.add(pressTimer);
    };

    const cancelPress = () => {
      emitUiDebug('quick_access.pointer_cancel', {
        entityId: entity.entity_id,
        hadActiveTimer: !!pressTimer,
      });
      if (pressTimer) {
        clearTimeout(pressTimer);
        activePressTimers.delete(pressTimer);
        pressTimer = null;
      }
    };

    const endPress = (e) => {
      if (e && typeof e.button === 'number' && e.button !== 0) return;
      const wasLongPress = longPressTriggered;
      cancelPress();
      const blocked = shouldBlockInteraction(div);
      emitUiDebug('quick_access.pointer_up', {
        entityId: entity.entity_id,
        pointerType: e?.pointerType || 'unknown',
        blocked,
        wasLongPress,
        reorganizeMode: isReorganizeMode,
      });

      if (blocked || wasLongPress) {
        return;
      }

      shortPressHandled = true;
      emitUiDebug('quick_access.short_press_toggle', {
        entityId: entity.entity_id,
        domain: entity.entity_id.split('.')[0],
        state: liveEntity().state,
      });
      executeEntityPrimaryAction(liveEntity(), { source: 'quick-access-short-press' });
      setTimeout(() => {
        shortPressHandled = false;
      }, 0);
    };

    div.addEventListener('pointerdown', startPress);
    div.addEventListener('pointerup', endPress);
    div.addEventListener('pointercancel', cancelPress);
    div.addEventListener('pointerleave', cancelPress);
    div.addEventListener('click', (e) => {
      const blocked = shouldBlockInteraction(div);
      emitUiDebug('quick_access.click', {
        entityId: entity.entity_id,
        blocked,
        shortPressHandled,
        longPressTriggered,
        reorganizeMode: isReorganizeMode,
      });
      if (shortPressHandled || blocked || longPressTriggered) {
        e.preventDefault();
        e.stopPropagation();
        return;
      }
      emitUiDebug('quick_access.click_toggle', {
        entityId: entity.entity_id,
        domain: entity.entity_id.split('.')[0],
        state: liveEntity().state,
      });
      executeEntityPrimaryAction(liveEntity(), { source: 'quick-access-click' });
    });
  } catch (error) {
    console.error('Error setting up press/hold controls:', error);
    emitUiDebug('quick_access.setup_press_hold_error', {
      entityId: entity?.entity_id || null,
      error: error?.message || String(error),
    });
  }
}

function setupLightControls(div, entity) {
  try {
    setupPressAndHoldToggle(div, entity, (liveEntity) => showBrightnessSlider(liveEntity));
  } catch (error) {
    console.error('Error setting up light controls:', error);
  }
}

function setupClimateControls(div, entity) {
  try {
    setupPressAndHoldToggle(div, entity, (liveEntity) => showClimateControls(liveEntity));
  } catch (error) {
    console.error('Error setting up climate controls:', error);
  }
}

function setupFanControls(div, entity) {
  try {
    setupPressAndHoldToggle(div, entity, (liveEntity) => showFanControls(liveEntity));
  } catch (error) {
    console.error('Error setting up fan controls:', error);
  }
}

function setupCoverControls(div, entity) {
  try {
    setupPressAndHoldToggle(div, entity, (liveEntity) => showCoverControls(liveEntity));
  } catch (error) {
    console.error('Error setting up cover controls:', error);
  }
}

function setupMediaPlayerControls(div, entity) {
  try {
    if (!div || !entity) return;

    // Get media info
    const mediaTitle = entity.attributes?.media_title || '';
    const mediaArtist = entity.attributes?.media_artist || '';
    const mediaAlbum = entity.attributes?.media_album_name || '';
    const isPlaying = entity.state === 'playing';
    const isOff = entity.state === 'off' || entity.state === 'idle';
    // A line that does not fit is cut with an ellipsis, so the full text is its tooltip.
    const mediaLine = (className, text) =>
      `<div class="${className}" title="${escapeHtmlAttribute(text)}">${utils.escapeHtml(text)}</div>`;

    // Create media info display
    let mediaInfo = '';
    if (mediaTitle) {
      // Show title and artist on separate lines, album only if there's space
      mediaInfo = `<div class="media-info">
        ${mediaLine('media-title', mediaTitle)}
        ${mediaArtist ? mediaLine('media-artist', mediaArtist) : ''}
        ${mediaAlbum && !mediaArtist ? mediaLine('media-album', mediaAlbum) : ''}
      </div>`;
    } else if (isOff) {
      mediaInfo = `<div class="media-info"><div class="media-title">${utils.escapeHtml(t('No media'))}</div></div>`;
    } else {
      mediaInfo = `<div class="media-info"><div class="media-title">${utils.escapeHtml(t('Ready'))}</div></div>`;
    }

    // Update the control info section (no inline controls; whole tile toggles)
    const controlInfo = div.querySelector('.control-info');
    if (controlInfo) {
      const nextInfoMarkup = `
        <div class="control-name">${utils.escapeHtml(utils.getEntityDisplayName(entity))}</div>
        ${mediaInfo}
      `;
      if (controlInfo.innerHTML !== nextInfoMarkup) {
        controlInfo.innerHTML = nextInfoMarkup;
      }
    }

    // Update album art in the icon - show when media info is present
    const controlIcon = div.querySelector('.control-icon');
    if (controlIcon) {
      // Save the original icon on first setup
      if (!controlIcon.dataset.defaultIcon) {
        controlIcon.dataset.defaultIcon = controlIcon.innerHTML;
      }

      const artworkUrl =
        entity.attributes?.entity_picture ||
        entity.attributes?.media_image_url ||
        entity.attributes?.media_content_id;

      // Show artwork when media info is present (playing or paused with media loaded)
      // Only hide when idle/off or no media info available
      const hasMediaInfo = mediaTitle && !isOff;
      const normalizedArtworkTarget = normalizeMediaArtworkTarget(artworkUrl);
      if (hasMediaInfo && normalizedArtworkTarget) {
        // Keep HA-relative paths relative. The main-process protocol uses that boundary to decide
        // whether the Home Assistant bearer token should be attached.
        const urlToEncode = normalizedArtworkTarget;

        // Encode URL in base64 for the ha:// protocol
        const encodedUrl = utils.base64Encode(urlToEncode);
        const retryKey = encodedUrl;

        // Add cache buster for better updates (rounded to 30 seconds to allow caching)
        const now = Date.now();
        pruneExpiredArtworkRetryEntries(now);
        const cacheBuster = Math.floor(now / 30000);
        const proxyUrl = getRendererHost().resolveMediaUrl({
          kind: 'media_artwork',
          url: urlToEncode,
          cacheKey: cacheBuster,
        });
        const retryAt = failedMediaArtworkRetryAtByUrl.get(retryKey) || 0;
        const skipForRecentFailure = retryAt > now;

        const existingImg = controlIcon.querySelector('.media-player-artwork');
        const existingSrc = existingImg ? existingImg.getAttribute('src') : null;
        if (
          !skipForRecentFailure &&
          (existingSrc !== proxyUrl || !controlIcon.classList.contains('has-artwork'))
        ) {
          // Replace icon with album art image only when the source changed.
          const img = document.createElement('img');
          img.src = proxyUrl;
          img.alt = t('Album art');
          img.className = 'media-player-artwork';
          img.onload = function () {
            failedMediaArtworkRetryAtByUrl.delete(retryKey);
          };
          img.onerror = function () {
            // Restore original icon on error
            failedMediaArtworkRetryAtByUrl.set(retryKey, Date.now() + MEDIA_ARTWORK_RETRY_DELAY_MS);
            const icon = this.parentElement;
            if (icon && icon.dataset.defaultIcon) {
              icon.innerHTML = icon.dataset.defaultIcon;
              icon.classList.remove('has-artwork');
            }
          };
          controlIcon.innerHTML = '';
          controlIcon.appendChild(img);
          controlIcon.classList.add('has-artwork');
        } else if (
          skipForRecentFailure &&
          controlIcon.classList.contains('has-artwork') &&
          existingSrc !== proxyUrl &&
          controlIcon.dataset.defaultIcon
        ) {
          // Avoid rapid fallback/restore churn while an artwork URL is failing repeatedly.
          controlIcon.innerHTML = controlIcon.dataset.defaultIcon;
          controlIcon.classList.remove('has-artwork');
        }
      } else {
        // No media info or no artwork - show original icon
        if (controlIcon.classList.contains('has-artwork') && controlIcon.dataset.defaultIcon) {
          controlIcon.innerHTML = controlIcon.dataset.defaultIcon;
          controlIcon.classList.remove('has-artwork');
        }
      }
    }

    // Only set up event listeners once
    if (!div.dataset.mediaControlsSetup) {
      div.dataset.mediaControlsSetup = 'true';

      // Make entire tile a play/pause toggle with long-press for details
      let pressTimer = null;
      let longPressTriggered = false;

      const startPress = (_e) => {
        if (shouldBlockInteraction(div)) return;
        longPressTriggered = false;
        if (pressTimer) {
          clearTimeout(pressTimer);
          activePressTimers.delete(pressTimer);
        }
        pressTimer = setTimeout(() => {
          longPressTriggered = true;
          activePressTimers.delete(pressTimer);
          const currentEntity = state.STATES[entity.entity_id];
          if (currentEntity) showMediaDetail(currentEntity);
        }, 500);
        activePressTimers.add(pressTimer);
      };

      const cancelPress = () => {
        if (pressTimer) {
          clearTimeout(pressTimer);
          activePressTimers.delete(pressTimer);
        }
      };

      div.addEventListener('mousedown', startPress);
      div.addEventListener('mouseup', cancelPress);
      div.addEventListener('mouseleave', cancelPress);

      div.addEventListener('click', (e) => {
        if (shouldBlockInteraction(div) || longPressTriggered) {
          e.preventDefault();
          e.stopPropagation();
          return;
        }
        const currentEntity = state.STATES[entity.entity_id];
        if (!currentEntity) return;
        executeEntityPrimaryAction(currentEntity, { source: 'quick-access-click' });
      });
    }

    // Update data attributes for styling (always update these)
    div.setAttribute('data-state', entity.state);
    div.setAttribute('data-media-playing', isPlaying ? 'true' : 'false');
  } catch (error) {
    console.error('Error setting up media player controls:', error);
  }
}

// Return desired grid span for an entity (configurable per entity)
function getTileSpan(entity) {
  try {
    const id = entity.entity_id;
    const spanCfg = state.CONFIG.tileSpans && state.CONFIG.tileSpans[id];
    if (Number.isInteger(spanCfg) && spanCfg > 0) return spanCfg;
    // Media players use 2-column span for better information display with centered layout
    return id.startsWith('media_player.') ? 2 : 1;
  } catch {
    return entity.entity_id.startsWith('media_player.') ? 2 : 1;
  }
}

function parseMediaSeconds(value) {
  if (typeof value === 'number') {
    return Number.isFinite(value) && value >= 0 ? value : null;
  }

  if (typeof value !== 'string') return null;

  const trimmed = value.trim();
  if (!trimmed) return null;

  const numericValue = Number(trimmed);
  if (!isNaN(numericValue) && numericValue >= 0) {
    return numericValue;
  }

  const parts = trimmed.split(':');
  if (parts.length < 2 || parts.length > 3) return null;
  if (!parts.every((part) => /^\d+$/.test(part))) return null;

  const [hours, minutes, seconds] =
    parts.length === 3
      ? [Number(parts[0]), Number(parts[1]), Number(parts[2])]
      : [0, Number(parts[0]), Number(parts[1])];

  if (seconds > 59) return null;
  if (parts.length === 3 && minutes > 59) return null;

  return hours * 3600 + minutes * 60 + seconds;
}

function getMediaTimeline(entity) {
  const duration = parseMediaSeconds(entity?.attributes?.media_duration) ?? 0;
  const basePosition = parseMediaSeconds(entity?.attributes?.media_position) ?? 0;

  const updatedAtRaw = entity?.attributes?.media_position_updated_at;
  const updatedAtValue = updatedAtRaw ? new Date(updatedAtRaw).getTime() : 0;
  const updatedAt = Number.isFinite(updatedAtValue) ? updatedAtValue : 0;

  let currentPosition = basePosition;
  if (entity?.state === 'playing' && updatedAt > 0) {
    const elapsedSinceUpdate = Math.max(0, (Date.now() - updatedAt) / 1000);
    currentPosition = basePosition + elapsedSinceUpdate;
  }

  if (duration > 0) {
    currentPosition = Math.min(currentPosition, duration);
  }

  return {
    duration,
    currentPosition: Math.max(0, currentPosition),
  };
}

function hasMediaSeekData(entity) {
  const attrs = entity?.attributes || {};
  const hasPosition = parseMediaSeconds(attrs.media_position) != null;
  const hasDuration = parseMediaSeconds(attrs.media_duration) != null;
  return hasPosition || hasDuration;
}

function canSeekMedia(entity) {
  if (!isEntityAvailable(entity)) return false;
  if (!entity?.entity_id?.startsWith('media_player.')) return false;
  if (!hasEntityService(entity, 'media_seek')) return false;
  const features = entity.attributes?.supported_features;
  if (!uiUtils.hasSupportedFeature(features, MEDIA_PLAYER_SUPPORT_SEEK)) return false;
  return hasMediaSeekData(entity);
}

function clampRange(value, min, max) {
  const numericValue = Number(value);
  if (!Number.isFinite(numericValue)) return min;
  return Math.max(min, Math.min(max, numericValue));
}

function getMediaSeekTarget(entity, deltaSeconds) {
  if (!hasMediaSeekData(entity)) return null;

  const delta = Number(deltaSeconds);
  if (!Number.isFinite(delta)) return null;

  const { duration, currentPosition } = getMediaTimeline(entity);
  const maxPosition = duration > 0 ? duration : Number.POSITIVE_INFINITY;
  const nextPosition = Math.max(0, Math.min(maxPosition, currentPosition + delta));

  return Math.round(nextPosition);
}

function rgbToHex(rgb) {
  if (!Array.isArray(rgb) || rgb.length < 3) return '#FFFFFF';
  const channels = rgb
    .slice(0, 3)
    .map((channel) => clampRange(Math.round(Number(channel) || 0), 0, 255));
  return `#${channels
    .map((channel) => channel.toString(16).padStart(2, '0'))
    .join('')
    .toUpperCase()}`;
}

function getLightColorTempRange(attributes = {}) {
  const minKelvinValue = Number(attributes.min_color_temp_kelvin);
  const maxKelvinValue = Number(attributes.max_color_temp_kelvin);
  if (
    Number.isFinite(minKelvinValue) &&
    Number.isFinite(maxKelvinValue) &&
    minKelvinValue > 0 &&
    maxKelvinValue > 0
  ) {
    return {
      min: Math.min(minKelvinValue, maxKelvinValue),
      max: Math.max(minKelvinValue, maxKelvinValue),
    };
  }

  const minFromMireds = uiUtils.miredsToKelvin(attributes.max_mireds);
  const maxFromMireds = uiUtils.miredsToKelvin(attributes.min_mireds);
  if (minFromMireds && maxFromMireds) {
    return {
      min: Math.min(minFromMireds, maxFromMireds),
      max: Math.max(minFromMireds, maxFromMireds),
    };
  }

  return { min: 2000, max: 6500 };
}

function getInitialLightColorTempKelvin(attributes = {}, range) {
  const kelvinValue = Number(attributes.color_temp_kelvin);
  if (Number.isFinite(kelvinValue) && kelvinValue > 0) {
    return clampRange(Math.round(kelvinValue), range.min, range.max);
  }

  const kelvinFromMireds = uiUtils.miredsToKelvin(attributes.color_temp);
  if (kelvinFromMireds) {
    return clampRange(kelvinFromMireds, range.min, range.max);
  }

  return clampRange(Math.round((range.min + range.max) / 2), range.min, range.max);
}

function getSupportedLightColorModes(attributes = {}) {
  return Array.isArray(attributes.supported_color_modes)
    ? attributes.supported_color_modes.map((mode) => String(mode))
    : [];
}

function supportsLightColor(attributes = {}) {
  return getSupportedLightColorModes(attributes).some((mode) => LIGHT_COLOR_MODES.has(mode));
}

function supportsLightColorTemp(attributes = {}) {
  return getSupportedLightColorModes(attributes).includes('color_temp');
}

// Which controls the media dialog renders. Lost capabilities only disable a rendered control;
// gained ones need the dialog rebuilt.
function getMediaDetailControls(entity) {
  const capabilities = getDesktopPinCapabilities(entity);
  const features = entity?.attributes?.supported_features;
  return [
    capabilities.canPreviousTrack,
    capabilities.canNextTrack,
    capabilities.canPlay || capabilities.canPause,
    canSeekMedia(entity),
    uiUtils.hasSupportedFeature(features, MEDIA_PLAYER_SUPPORT_VOLUME_SET),
    uiUtils.hasSupportedFeature(features, MEDIA_PLAYER_SUPPORT_VOLUME_MUTE),
  ];
}

// "+10s" and "−10s" (a real minus), in the active language: the seek buttons say how far they
// jump. The unit comes from Intl, so it needs no string of its own. Arabic wraps the sign in
// direction marks that would put it behind the number, and the transport row keeps its signs in
// front, so the marks go.
function formatSeekStep(seconds) {
  return formatNumber(seconds, {
    style: 'unit',
    unit: 'second',
    unitDisplay: 'narrow',
    signDisplay: 'always',
  })
    .replace(/[\u061C\u200E\u200F]/g, '')
    .replace('-', '\u2212');
}

// `replaces` and `focusSelector` rebuild a dialog the user is looking at (the player gained a
// control): the new one takes the old one's place and opener, and focus returns to the same control.
function showMediaDetail(entity, { replaces = null, focusSelector = null } = {}) {
  try {
    ensureEntityCacheScope();
    const renderedControls = getMediaDetailControls(entity);
    const name = utils.escapeHtml(utils.getEntityDisplayName(entity));
    const mediaTitle = utils.escapeHtml(entity.attributes?.media_title || '');
    const mediaArtist = utils.escapeHtml(entity.attributes?.media_artist || '');
    const initialTimeline = getMediaTimeline(entity);
    const mediaCapabilities = getDesktopPinCapabilities(entity);
    const supportsSeek = canSeekMedia(entity);
    const supportsAnyPlaybackToggle = mediaCapabilities.canPlay || mediaCapabilities.canPause;
    const mediaAttributes = entity.attributes || {};
    const supportsVolumeSet = uiUtils.hasSupportedFeature(
      mediaAttributes.supported_features,
      MEDIA_PLAYER_SUPPORT_VOLUME_SET
    );
    const supportsVolumeMute = uiUtils.hasSupportedFeature(
      mediaAttributes.supported_features,
      MEDIA_PLAYER_SUPPORT_VOLUME_MUTE
    );
    const initialVolume = clampRange(
      Math.round(Number(mediaAttributes.volume_level ?? 0) * 100),
      0,
      100
    );
    const initialMuted = mediaAttributes.is_volume_muted === true;
    const volumeControlsMarkup =
      supportsVolumeSet || supportsVolumeMute
        ? `
          <div class="media-volume-controls">
            ${
              supportsVolumeSet
                ? `
              <div class="media-volume-row">
                <label class="media-volume-label" for="media-volume-slider">${utils.escapeHtml(t('Volume'))}</label>
                <input
                  type="range"
                  min="0"
                  max="100"
                  step="1"
                  value="${initialVolume}"
                  id="media-volume-slider"
                  class="media-volume-slider"
                  aria-label="${escapeHtmlAttribute(t('Volume'))}"
                />
                <span class="media-volume-value" id="media-volume-value">${formatPercent(initialVolume)}</span>
              </div>
            `
                : ''
            }
            ${
              supportsVolumeMute
                ? `
              <button
                class="media-mute-toggle ${initialMuted ? 'active' : ''}"
                id="media-mute-toggle"
                type="button"
                aria-pressed="${initialMuted ? 'true' : 'false'}"
              >${utils.escapeHtml(t('Mute'))}</button>
            `
                : ''
            }
          </div>
        `
        : '';

    const fmt = (s) => utils.formatDuration(Math.max(0, Math.floor(s)) * 1000);

    const modal = document.createElement('div');
    modal.className = 'modal media-modal';
    modal.innerHTML = `
      <div class="modal-content">
        <div class="modal-header">
          <h2>${name}</h2>
          <button class="close-btn" id="media-close" type="button" aria-label="${escapeHtmlAttribute(t('Close'))}">×</button>
        </div>
        <div class="modal-body">
          <div class="media-detail-info">
            <div class="media-detail-title">${mediaTitle || '—'}</div>
            <div class="media-detail-artist" ${mediaArtist ? '' : 'hidden'}>${mediaArtist}</div>
          </div>
          <div class="media-progress">
            <div class="media-time-row">
              <span id="media-current">${fmt(initialTimeline.currentPosition)}</span>
              <span id="media-total">${initialTimeline.duration ? fmt(initialTimeline.duration) : '--:--'}</span>
            </div>
            <div class="media-progress-track">
              <div class="media-progress-fill" id="media-progress-fill" style="width: 0%"></div>
            </div>
          </div>
          ${volumeControlsMarkup}
          <div class="media-detail-controls">
            ${mediaCapabilities.canPreviousTrack ? `<button class="btn media-detail-prev-btn" data-action="previous_track" title="${escapeHtmlAttribute(t('Previous'))}" aria-label="${escapeHtmlAttribute(t('Previous track'))}"></button>` : ''}
            ${supportsSeek ? `<button class="btn media-detail-seek-btn" data-action="seek_relative" data-seek-delta="-10" title="${escapeHtmlAttribute(t('Rewind 10 seconds'))}" aria-label="${escapeHtmlAttribute(t('Rewind 10 seconds'))}">${formatSeekStep(-10)}</button>` : ''}
            ${supportsAnyPlaybackToggle ? `<button class="btn play-pause-btn media-detail-play-btn" data-action="play_pause" title="${escapeHtmlAttribute(t('Play/Pause'))}" aria-label="${escapeHtmlAttribute(t('Play or pause'))}"></button>` : ''}
            ${supportsSeek ? `<button class="btn media-detail-seek-btn" data-action="seek_relative" data-seek-delta="10" title="${escapeHtmlAttribute(t('Forward 10 seconds'))}" aria-label="${escapeHtmlAttribute(t('Forward 10 seconds'))}">${formatSeekStep(10)}</button>` : ''}
            ${mediaCapabilities.canNextTrack ? `<button class="btn media-detail-next-btn" data-action="next_track" title="${escapeHtmlAttribute(t('Next'))}" aria-label="${escapeHtmlAttribute(t('Next track'))}"></button>` : ''}
            ${
              !mediaCapabilities.canPreviousTrack &&
              !supportsSeek &&
              !supportsAnyPlaybackToggle &&
              !mediaCapabilities.canNextTrack
                ? `<span class="control-capability-note">${utils.escapeHtml(t("This player can't be controlled from here."))}</span>`
                : ''
            }
          </div>
        </div>
        <div class="modal-footer">
          <button class="btn btn-secondary" id="media-close-footer">${utils.escapeHtml(t('Close'))}</button>
        </div>
      </div>
    `;

    document.body.appendChild(modal);
    applyCloseButtonIcons(modal);
    activateAccessibleDialogModal(modal, {
      titleIdPrefix: 'media-detail-title',
      dismiss: () => closeModal(),
      initialFocus: startOnHeading(modal, focusSelector),
      replaces,
    });

    // Set SVG icons for media controls
    // setIconContent already imported at top
    const prevBtn = modal.querySelector('.media-detail-prev-btn');
    const playBtn = modal.querySelector('.media-detail-play-btn');
    const nextBtn = modal.querySelector('.media-detail-next-btn');

    if (prevBtn) setIconContent(prevBtn, 'skipPrevious', { size: 20 });
    if (nextBtn) setIconContent(nextBtn, 'skipNext', { size: 20 });
    if (playBtn) {
      const isPlaying = entity.state === 'playing';
      setIconContent(playBtn, isPlaying ? 'pause' : 'play', { size: 24 });
      playBtn.dataset.playbackIcon = isPlaying ? 'pause' : 'play';
      if (isPlaying) playBtn.classList.add('playing');
    }

    const closeBtns = modal.querySelectorAll('#media-close, #media-close-footer');
    const progressFill = modal.querySelector('#media-progress-fill');
    const curEl = modal.querySelector('#media-current');
    const totalEl = modal.querySelector('#media-total');
    const volumeSlider = modal.querySelector('#media-volume-slider');
    const volumeValue = modal.querySelector('#media-volume-value');
    const muteToggle = modal.querySelector('#media-mute-toggle');

    // Once Home Assistant removes the player, the opening snapshot must not keep its metadata or
    // controls alive.
    let removed = false;
    const liveMedia = () =>
      removed
        ? {
            ...entity,
            state: 'unavailable',
            attributes: {
              friendly_name: entity.attributes?.friendly_name,
              supported_features: entity.attributes?.supported_features,
            },
          }
        : state.STATES[entity.entity_id] || entity;

    const getLiveTimeline = () => getMediaTimeline(liveMedia());

    const updateVolumeControls = () => {
      const currentEntity = liveMedia();
      const attrs = currentEntity.attributes || {};
      if (volumeSlider && volumeValue && document.activeElement !== volumeSlider) {
        // An off player reports no volume; show that instead of a made-up 0%.
        if (attrs.volume_level == null || !Number.isFinite(Number(attrs.volume_level))) {
          volumeValue.textContent = '—';
        } else {
          const volume = clampRange(Math.round(Number(attrs.volume_level) * 100), 0, 100);
          volumeSlider.value = String(volume);
          volumeValue.textContent = formatPercent(volume);
        }
      }
      if (muteToggle) {
        const isMuted = attrs.is_volume_muted === true;
        muteToggle.classList.toggle('active', isMuted);
        muteToggle.setAttribute('aria-pressed', isMuted ? 'true' : 'false');
      }
    };

    let tick;
    const updateProgress = () => {
      const timeline = getLiveTimeline();
      curEl.textContent = fmt(timeline.currentPosition);
      if (totalEl) totalEl.textContent = timeline.duration ? fmt(timeline.duration) : '--:--';
      if (progressFill) {
        const pct =
          timeline.duration > 0
            ? Math.max(0, Math.min(100, (timeline.currentPosition / timeline.duration) * 100))
            : 0;
        progressFill.style.width = pct + '%';
      }
    };
    const syncProgressTimer = () => {
      clearInterval(tick);
      tick = null;
      if (!document.hidden && liveMedia().state === 'playing') {
        tick = setInterval(updateProgress, 1000);
      }
    };

    // Wire up controls
    const updatePlayPauseBtn = () => {
      const currentEntity = liveMedia();
      const isCurrentlyPlaying = currentEntity.state === 'playing';
      const canTogglePlayback = canPerformMediaAction(
        currentEntity,
        isCurrentlyPlaying ? 'pause' : 'play'
      );
      const pp = modal.querySelector('.play-pause-btn');
      if (pp) {
        // setIconContent already imported at top
        const iconName = isCurrentlyPlaying ? 'pause' : 'play';
        if (pp.dataset.playbackIcon !== iconName) {
          setIconContent(pp, iconName, { size: 24 });
          pp.dataset.playbackIcon = iconName;
        }
        pp.classList.toggle('playing', isCurrentlyPlaying);
        pp.disabled = !canTogglePlayback;
        pp.setAttribute('aria-disabled', canTogglePlayback ? 'false' : 'true');
      }
      return { canTogglePlayback, isCurrentlyPlaying };
    };

    modal.addEventListener('click', (e) => {
      const btn = e.target.closest('.btn');
      if (!btn || btn.disabled) return;
      const action = btn.dataset.action;
      if (action === 'previous_track' || action === 'next_track') {
        callMediaPlayerService(entity.entity_id, action);
      } else if (action === 'seek_relative') {
        callMediaPlayerService(entity.entity_id, 'seek_relative', {
          deltaSeconds: Number(btn.dataset.seekDelta),
        });
      } else if (action === 'play_pause') {
        const { canTogglePlayback, isCurrentlyPlaying } = updatePlayPauseBtn();
        if (!canTogglePlayback) return;
        callMediaPlayerService(entity.entity_id, isCurrentlyPlaying ? 'pause' : 'play');
        // Optimistically update UI
        setTimeout(() => updatePlayPauseBtn(), 100);
      }
    });

    let volumeDebounceTimer;
    if (volumeSlider) {
      volumeSlider.addEventListener('input', (e) => {
        if (!canPerformMediaAction(liveMedia(), 'volume_set')) return;
        const value = clampRange(Math.round(Number(e.target.value)), 0, 100);
        if (volumeValue) volumeValue.textContent = formatPercent(value);
        clearTimeout(volumeDebounceTimer);
        volumeDebounceTimer = setTimeout(() => {
          callMediaPlayerService(entity.entity_id, 'volume_set', {
            volumeLevel: value / 100,
          });
        }, 150);
      });
    }

    if (muteToggle) {
      muteToggle.addEventListener('click', () => {
        if (!canPerformMediaAction(liveMedia(), 'volume_mute')) return;
        const nextMuted = muteToggle.getAttribute('aria-pressed') !== 'true';
        muteToggle.classList.toggle('active', nextMuted);
        muteToggle.setAttribute('aria-pressed', nextMuted ? 'true' : 'false');
        callMediaPlayerService(entity.entity_id, 'volume_mute', {
          isVolumeMuted: nextMuted,
        });
      });
    }

    const renderMedia = () => {
      const currentEntity = liveMedia();
      const attrs = currentEntity.attributes || {};
      modal.querySelector('.media-detail-title').textContent = attrs.media_title || '—';
      const artist = modal.querySelector('.media-detail-artist');
      artist.textContent = attrs.media_artist || '';
      artist.hidden = !attrs.media_artist;
      showUnavailableDialogState(modal, currentEntity);
      for (const control of modal.querySelectorAll('[data-action]')) {
        const action =
          control.dataset.action === 'play_pause'
            ? currentEntity.state === 'playing'
              ? 'pause'
              : 'play'
            : control.dataset.action;
        control.disabled = !canPerformMediaAction(currentEntity, action);
        control.setAttribute('aria-disabled', String(control.disabled));
      }
      if (volumeSlider) volumeSlider.disabled = !canPerformMediaAction(currentEntity, 'volume_set');
      if (muteToggle) muteToggle.disabled = !canPerformMediaAction(currentEntity, 'volume_mute');
      updatePlayPauseBtn();
      updateVolumeControls();
      updateProgress();
    };
    let unsubscribe = () => {};
    const onVisibilityChange = () => {
      if (document.hidden) {
        clearInterval(tick);
        tick = null;
      } else {
        refreshMedia();
      }
    };
    const stopUpdates = () => {
      clearInterval(tick);
      tick = null;
      unsubscribe();
      document.removeEventListener('visibilitychange', onVisibilityChange);
    };
    // Updates are pushed by entity state changes; progress only ticks while playing and visible.
    const refreshMedia = () => {
      if (!modal.isConnected) {
        stopUpdates();
        return;
      }
      const currentEntity = liveMedia();
      if (
        getMediaDetailControls(currentEntity).some(
          (supported, index) => supported && !renderedControls[index]
        )
      ) {
        // Controls are only rendered for the capabilities the player had at open, so rebuild
        // the dialog in place when it gains one, keeping focus on the same control.
        const focused = modal.contains(document.activeElement) ? document.activeElement : null;
        const focusSelector = focused?.id
          ? `#${focused.id}`
          : focused?.dataset?.action
            ? `[data-action="${focused.dataset.action}"]${focused.dataset.seekDelta ? `[data-seek-delta="${focused.dataset.seekDelta}"]` : ''}`
            : null;
        isClosing = true;
        entityDetailClosers.delete(closeModal);
        stopUpdates();
        clearTimeout(volumeDebounceTimer);
        showMediaDetail(currentEntity, { replaces: modal, focusSelector });
        modal.remove();
        return;
      }
      if (document.hidden) return;
      renderMedia();
      syncProgressTimer();
    };
    unsubscribe = state.subscribeEntity(entity.entity_id, (next) => {
      removed = !next;
      refreshMedia();
    });
    document.addEventListener('visibilitychange', onVisibilityChange);

    // Close handlers
    let isClosing = false;
    const closeModal = () => {
      if (isClosing) return;
      isClosing = true;
      entityDetailClosers.delete(closeModal);
      stopUpdates();
      if (volumeDebounceTimer) clearTimeout(volumeDebounceTimer);
      void uiUtils.closeDialog(modal, { remove: true });
    };
    entityDetailClosers.add(closeModal);
    closeBtns.forEach((b) => b && (b.onclick = closeModal));

    // Init
    renderMedia();
    syncProgressTimer();

    // Animate in
    setTimeout(() => modal.classList.add('modal-open'), 10);
  } catch (error) {
    console.error('Error showing media details:', error);
  }
}

function updateMediaEntityPosition(entityId, seekPosition) {
  const currentEntity = state.STATES?.[entityId];
  if (!currentEntity || !Number.isFinite(seekPosition)) return;

  const updatedEntity = {
    ...currentEntity,
    attributes: {
      ...(currentEntity.attributes || {}),
      media_position: seekPosition,
      media_position_updated_at: new Date().toISOString(),
    },
  };

  state.setEntityState(updatedEntity);

  if (state.CONFIG?.primaryMediaPlayer === entityId) {
    updateMediaSeekBar(updatedEntity);
  }
}

function callMediaPlayerService(entityId, action, options = {}) {
  try {
    const generation = ensureEntityCacheScope();
    // websocket already imported at top
    const entity = state.STATES[entityId];
    if (!canPerformMediaAction(entity, action)) return;
    const entityName = entity ? utils.getEntityDisplayName(entity) : entityId;

    let serviceCall;
    switch (action) {
      case 'play':
        serviceCall = websocket.callService('media_player', 'media_play', { entity_id: entityId });
        break;
      case 'pause':
        serviceCall = websocket.callService('media_player', 'media_pause', { entity_id: entityId });
        break;
      case 'next_track':
        serviceCall = websocket.callService('media_player', 'media_next_track', {
          entity_id: entityId,
        });
        break;
      case 'previous_track':
        serviceCall = websocket.callService('media_player', 'media_previous_track', {
          entity_id: entityId,
        });
        break;
      case 'seek_relative': {
        const seekPosition = getMediaSeekTarget(entity, options.deltaSeconds);
        if (seekPosition == null) return;
        serviceCall = websocket
          .callService('media_player', 'media_seek', {
            entity_id: entityId,
            seek_position: seekPosition,
          })
          .then((response) => {
            if (generation === ensureEntityCacheScope())
              updateMediaEntityPosition(entityId, seekPosition);
            return response;
          });
        break;
      }
      case 'volume_set': {
        const volumeLevel = clampRange(Number(options.volumeLevel), 0, 1);
        serviceCall = websocket.callService('media_player', 'volume_set', {
          entity_id: entityId,
          volume_level: volumeLevel,
        });
        break;
      }
      case 'volume_mute':
        serviceCall = websocket.callService('media_player', 'volume_mute', {
          entity_id: entityId,
          is_volume_muted: !!options.isVolumeMuted,
        });
        break;
      default:
        console.warn('Unknown media player action:', action);
        return;
    }

    if (serviceCall) {
      return serviceCall.catch((error) => {
        handleServiceError(error, entityName);
        return null;
      });
    }
    return undefined;
  } catch (error) {
    console.error('Error calling media player service:', error);
    uiUtils.showToast(t('Failed to control media player'), 'error', 3000);
    return undefined;
  }
}

function getEntityNameFromId(entityId) {
  const entity = state.STATES?.[entityId];
  if (entity) return utils.getEntityDisplayName(entity);
  return entityId || 'entity';
}

async function processPendingOnOffToggle(entityId, domain) {
  const generation = ensureEntityCacheScope();
  if (!entityId || !isOnOffToggleDomain(domain)) return;
  if (inFlightByEntity.get(entityId)) return;
  if (state.STATES?.[entityId]?.state === 'unavailable') {
    clearPendingOnOffToggle(entityId);
    return;
  }

  const desiredState = desiredStateByEntity.get(entityId);
  if (!isOnOffStateValue(desiredState)) return;

  const service = desiredState === 'on' ? 'turn_on' : 'turn_off';
  const serviceData = { entity_id: entityId };
  inFlightByEntity.set(entityId, true);
  lastRequestedStateByEntity.set(entityId, desiredState);

  emitUiDebug('entity.toggle_attempt', {
    entityId,
    domain,
    service,
    desiredState,
    serviceData,
  });

  try {
    const response = await websocket.callService(domain, service, serviceData);
    if (generation !== ensureEntityCacheScope()) return response;

    emitUiDebug('entity.toggle_success', {
      entityId,
      domain,
      service,
      desiredState,
      responseSuccess: response?.success !== false,
      responseId: response?.id || null,
    });

    const latestDesiredState = desiredStateByEntity.get(entityId);
    if (latestDesiredState === desiredState) {
      const currentEntity = state.STATES?.[entityId];
      if (!currentEntity) {
        clearPendingOnOffToggle(entityId);
      } else {
        // A successful service response only confirms that Home Assistant accepted the call.
        // Keep the requested visual state until the matching state_changed event arrives so an
        // older entity update cannot briefly repaint the tile with stale data.
        scheduleOnOffToggleConfirmationTimeout(entityId, domain, desiredState);
      }
    }

    return response;
  } catch (error) {
    if (generation !== ensureEntityCacheScope()) return;
    const requestedState = lastRequestedStateByEntity.get(entityId);
    const latestDesiredState = desiredStateByEntity.get(entityId);

    emitUiDebug('entity.toggle_primary_error', {
      entityId,
      domain,
      service,
      requestedState: requestedState || null,
      latestDesiredState: latestDesiredState || null,
      error: error?.message || String(error),
      code: error?.code || null,
    });

    if (latestDesiredState && latestDesiredState !== requestedState) {
      emitUiDebug('entity.toggle_error_ignored_stale_request', {
        entityId,
        domain,
        requestedState: requestedState || null,
        latestDesiredState,
      });
      return;
    }

    clearPendingOnOffToggle(entityId);

    const serverEntity = state.STATES?.[entityId];
    if (serverEntity) {
      updateEntityInUI(serverEntity, { skipQueueReconcile: true });
    }

    handleServiceError(error, getEntityNameFromId(entityId));
  } finally {
    if (generation === ensureEntityCacheScope()) {
      inFlightByEntity.delete(entityId);
      const requestedState = lastRequestedStateByEntity.get(entityId);
      const latestDesiredState = desiredStateByEntity.get(entityId);

      if (!latestDesiredState) {
        lastRequestedStateByEntity.delete(entityId);
      } else if (latestDesiredState !== requestedState) {
        processPendingOnOffToggle(entityId, domain);
      }
    }
  }
}

function queueOnOffToggle(entity) {
  ensureEntityCacheScope();
  if (!isEntityAvailable(state.STATES?.[entity?.entity_id] || entity)) return;
  if (!entity || !entity.entity_id) return;
  const entityId = entity.entity_id;
  const domain = getEntityDomain(entityId);
  if (!isOnOffToggleDomain(domain)) return;
  if (domain === 'light') {
    clearTimeout(desktopPinLightBrightnessTimers.get(entityId));
    desktopPinLightBrightnessTimers.delete(entityId);
    clearDesktopPinLightInteraction(entityId);
  }

  const effectiveState = getEffectiveOnOffState(entityId, entity.state);
  const desiredState = effectiveState === 'on' ? 'off' : 'on';
  clearOnOffToggleConfirmationTimer(entityId);
  rememberLightBrightness(state.STATES?.[entityId] || entity);
  desiredStateByEntity.set(entityId, desiredState);
  optimisticStateByEntity.set(entityId, desiredState);

  const sourceEntity = state.STATES?.[entityId] || entity;
  if (sourceEntity) {
    updateEntityInUI({ ...sourceEntity, state: desiredState }, { skipQueueReconcile: true });
  }

  emitUiDebug('entity.toggle_queued', {
    entityId,
    domain,
    previousState: effectiveState,
    desiredState,
    inFlight: !!inFlightByEntity.get(entityId),
  });

  processPendingOnOffToggle(entityId, domain);
}

function toggleEntity(entity) {
  try {
    entity = state.STATES?.[entity?.entity_id] || entity;
    if (!isEntityAvailable(entity)) return;
    const domain = entity.entity_id.split('.')[0];
    let service;
    const service_data = { entity_id: entity.entity_id };

    switch (domain) {
      case 'light':
      case 'switch':
      case 'fan':
      case 'input_boolean':
        queueOnOffToggle(entity);
        return;
      case 'automation':
        service = 'toggle';
        break;
      case 'lock':
        service = entity.state === 'locked' ? 'unlock' : 'lock';
        break;
      case 'cover': {
        cancelDesktopPinServiceCall(`cover:${entity.entity_id}:position`);
        const capabilities = getDesktopPinCapabilities(entity);
        const shouldClose = entity.state === 'open' || entity.state === 'opening';
        if (shouldClose && !capabilities.canClose) return;
        if (!shouldClose && !capabilities.canOpen) return;
        service = shouldClose ? 'close_cover' : 'open_cover';
        break;
      }
      case 'scene':
      case 'script':
        service = 'turn_on';
        // Add activation animation for scenes and scripts
        triggerActivationFeedback(entity.entity_id);
        break;
      case 'button':
      case 'input_button':
        service = 'press';
        triggerActivationFeedback(entity.entity_id);
        break;
      default:
        // No toggle action for this domain
        emitUiDebug('entity.toggle_ignored_domain', {
          entityId: entity.entity_id,
          domain,
          state: entity.state,
        });
        return;
    }
    emitUiDebug('entity.toggle_attempt', {
      entityId: entity.entity_id,
      domain,
      service,
      state: entity.state,
      serviceData: service_data,
    });
    websocket
      .callService(domain, service, service_data)
      .then((response) => {
        emitUiDebug('entity.toggle_success', {
          entityId: entity.entity_id,
          domain,
          service,
          responseSuccess: response?.success !== false,
          responseId: response?.id || null,
        });
        return response;
      })
      .catch((error) => handleServiceError(error, utils.getEntityDisplayName(entity)));
  } catch (error) {
    console.error('Error toggling entity:', error);
    emitUiDebug('entity.toggle_exception', {
      entityId: entity?.entity_id || null,
      error: error?.message || String(error),
    });
    uiUtils.showToast(t('Failed to toggle entity'), 'error', 3000);
  }
}

function toggleTimerEntity(entity) {
  if (!isEntityAvailable(entity) || !entity.entity_id.startsWith('timer.')) return;
  const service = entity.state === 'active' ? 'pause' : 'start';
  websocket
    .callService('timer', service, { entity_id: entity.entity_id })
    .catch((error) => handleServiceError(error, utils.getEntityDisplayName(entity)));
}

function executeEntityPrimaryAction(entity, options = {}) {
  try {
    const liveEntity = state.STATES?.[entity?.entity_id] || entity;
    if (!liveEntity?.entity_id) return;

    const domain = getEntityDomain(liveEntity.entity_id);

    emitUiDebug('entity.primary_action', {
      entityId: liveEntity.entity_id,
      domain,
      source: options.source || 'unknown',
      state: liveEntity.state,
    });

    if (domain === 'camera') {
      camera.openCamera(liveEntity.entity_id, { sourceTile: options.sourceElement });
      return;
    }

    if (domain === 'media_player') {
      const capabilities = getDesktopPinCapabilities(liveEntity);
      const action = liveEntity.state === 'playing' ? 'pause' : 'play';
      if (
        (action === 'pause' && capabilities.canPause) ||
        (action === 'play' && capabilities.canPlay)
      ) {
        callMediaPlayerService(liveEntity.entity_id, action);
      }
      return;
    }

    if (domain === 'climate') {
      showClimateControls(liveEntity);
      return;
    }

    if (domain === 'sensor') {
      showSensorDetails(liveEntity);
      return;
    }

    if (domain === 'timer') {
      toggleTimerEntity(liveEntity);
      return;
    }

    if (domain === 'todo') {
      showTodoDetails(liveEntity);
      return;
    }

    if (domain === 'calendar') {
      showCalendarDetails(liveEntity);
      return;
    }

    if (QUICK_ACCESS_HELPER_DOMAINS.has(domain)) {
      showHelperControls(liveEntity);
      return;
    }

    toggleEntity(liveEntity);
  } catch (error) {
    console.error('Error executing entity primary action:', error);
    uiUtils.showToast(t('Failed to toggle entity'), 'error', 3000);
  }
}

// Open the richest detail/control modal for an entity — the same modal a Quick
// Access tile shows on long-press. Returns false for domains without one
// (switches, locks, scenes, scripts, etc.) and never runs the primary action,
// so Shift+Enter and the Controls button cannot unlock or toggle anything.
function openEntityControls(entity) {
  try {
    const liveEntity = state.STATES?.[entity?.entity_id] || entity;
    if (!liveEntity?.entity_id) return false;

    const domain = getEntityDomain(liveEntity.entity_id);
    const isTimer = domain === 'timer' || isTimerLikeSensorEntity(liveEntity);

    switch (domain) {
      case 'camera':
        camera.openCamera(liveEntity.entity_id);
        return true;
      case 'light':
        showBrightnessSlider(liveEntity);
        return true;
      case 'climate':
        showClimateControls(liveEntity);
        return true;
      case 'fan':
        showFanControls(liveEntity);
        return true;
      case 'cover':
        showCoverControls(liveEntity);
        return true;
      case 'media_player':
        showMediaDetail(liveEntity);
        return true;
      case 'todo':
        showTodoDetails(liveEntity);
        return true;
      case 'calendar':
        showCalendarDetails(liveEntity);
        return true;
      case 'sensor':
        if (isTimer) return false;
        showSensorDetails(liveEntity);
        return true;
      case 'number':
      case 'input_number':
      case 'select':
      case 'input_select':
      case 'vacuum':
        showHelperControls(liveEntity);
        return true;
      default:
        return false;
    }
  } catch (error) {
    console.error('Error opening entity controls:', error);
    return false;
  }
}

/**
 * Whether the palette's Enter does anything for this entity: its controls open, or its primary
 * action runs. Sun, a person, weather, a device tracker, an update, a zone or a binary sensor have
 * neither, and locks and alarm panels are never run from a plain row (the palette offers named
 * commands for them). Built from the same domain sets as a Quick Access tile's click.
 * @param {Object} entity - Home Assistant entity state object.
 * @returns {boolean}
 */
function hasEntityAction(entity) {
  const liveEntity = state.STATES?.[entity?.entity_id] || entity;
  if (!liveEntity?.entity_id) return false;
  const domain = getEntityDomain(liveEntity.entity_id);
  if (domain === 'lock' || domain === 'alarm_control_panel') return false;
  // A dialog opens whatever the state; a toggle, a scene or a button does nothing while unavailable.
  if (QUICK_ACCESS_DIALOG_DOMAINS.has(domain) || QUICK_ACCESS_CONTROLS_DOMAINS.has(domain)) {
    return true;
  }
  return (
    (QUICK_ACCESS_TOGGLE_DOMAINS.has(domain) ||
      QUICK_ACCESS_ACTIVATE_DOMAINS.has(domain) ||
      domain === 'automation') &&
    isEntityAvailable(liveEntity)
  );
}

// The command palette opens an entity's controls, or runs its primary action
// when the domain has no controls modal. Locks and alarm panels are never
// toggled from a plain search result: the palette offers explicit, named
// commands for those instead.
function openEntityDetailModal(entity, options = {}) {
  try {
    if (openEntityControls(entity)) return;
    const liveEntity = state.STATES?.[entity?.entity_id] || entity;
    if (['lock', 'alarm_control_panel'].includes(getEntityDomain(liveEntity?.entity_id))) return;
    if (liveEntity?.entity_id) executeEntityPrimaryAction(liveEntity, options);
  } catch (error) {
    console.error('Error opening entity detail modal:', error);
  }
}

function triggerActivationFeedback(entityId) {
  try {
    const tile = document.querySelector(`[data-entity-id="${entityId}"]`);
    if (tile) {
      tile.classList.add('activating');
      setTimeout(() => {
        tile.classList.remove('activating');
      }, 600);
    }
  } catch (error) {
    console.error('Error triggering activation feedback:', error);
  }
}

function executeHotkeyAction(entity, action) {
  try {
    entity = state.STATES?.[entity?.entity_id] || entity;
    if (!isEntityAvailable(entity)) return;
    const domain = entity.entity_id.split('.')[0];

    // Validate numeric attributes to prevent NaN
    const brightnessValue = Number(entity.attributes?.brightness);
    const currentBrightness = !isNaN(brightnessValue) && brightnessValue >= 0 ? brightnessValue : 0;

    const entityName = utils.getEntityDisplayName(entity);

    switch (action) {
      case 'toggle':
        toggleEntity(entity);
        break;
      case 'turn_on':
        websocket
          .callService(domain, 'turn_on', { entity_id: entity.entity_id })
          .catch((error) => handleServiceError(error, entityName));
        break;
      case 'turn_off':
        websocket
          .callService(domain, 'turn_off', { entity_id: entity.entity_id })
          .catch((error) => handleServiceError(error, entityName));
        break;
      case 'brightness_up':
        // Increase brightness by 20% (51 units out of 255)
        if (domain === 'light') {
          const newBrightness = Math.min(255, currentBrightness + 51);
          websocket
            .callService('light', 'turn_on', {
              entity_id: entity.entity_id,
              brightness: newBrightness,
            })
            .catch((error) => handleServiceError(error, entityName));
        }
        break;
      case 'brightness_down':
        // Decrease brightness by 20% (51 units out of 255)
        if (domain === 'light') {
          const newBrightness = Math.max(0, currentBrightness - 51);
          websocket
            .callService('light', 'turn_on', {
              entity_id: entity.entity_id,
              brightness: newBrightness,
            })
            .catch((error) => handleServiceError(error, entityName));
        }
        break;
      case 'trigger':
        // For automations
        if (domain === 'automation') {
          websocket
            .callService('automation', 'trigger', { entity_id: entity.entity_id })
            .catch((error) => handleServiceError(error, entityName));
        }
        break;
      case 'press':
        if (isPressActionDomain(domain)) {
          websocket
            .callService(domain, 'press', { entity_id: entity.entity_id })
            .catch((error) => handleServiceError(error, entityName));
        }
        break;
      case 'increase_speed':
        // For fans - increase percentage by 33%
        if (domain === 'fan') {
          const percentageValue = Number(entity.attributes?.percentage);
          const currentPercentage =
            !isNaN(percentageValue) && percentageValue >= 0 ? percentageValue : 0;
          const newPercentage = Math.min(100, currentPercentage + 33);
          websocket
            .callService('fan', 'set_percentage', {
              entity_id: entity.entity_id,
              percentage: newPercentage,
            })
            .catch((error) => handleServiceError(error, entityName));
        }
        break;
      case 'decrease_speed':
        // For fans - decrease percentage by 33%
        if (domain === 'fan') {
          const percentageValue = Number(entity.attributes?.percentage);
          const currentPercentage =
            !isNaN(percentageValue) && percentageValue >= 0 ? percentageValue : 0;
          const newPercentage = Math.max(0, currentPercentage - 33);
          websocket
            .callService('fan', 'set_percentage', {
              entity_id: entity.entity_id,
              percentage: newPercentage,
            })
            .catch((error) => handleServiceError(error, entityName));
        }
        break;
      default:
        // Default to toggle for backward compatibility
        toggleEntity(entity);
    }
  } catch (error) {
    console.error(
      `Error executing hotkey action '${action}' for entity ${entity.entity_id}:`,
      error
    );
    uiUtils.showToast(t('Failed to execute hotkey action'), 'error', 3000);
  }
}

// --- Weather ---
function updateWeatherFromHA() {
  try {
    const selectedWeatherEntityId = resolveSelectedWeatherEntityId();
    const weatherEntity = selectedWeatherEntityId ? state.STATES?.[selectedWeatherEntityId] : null;
    if (!weatherEntity) return;

    const tempEl = document.getElementById('weather-temp');
    const conditionEl = document.getElementById('weather-condition');
    const humidityEl = document.getElementById('weather-humidity');
    const windEl = document.getElementById('weather-wind');
    const iconEl = document.getElementById('weather-icon');

    // Use Home Assistant's global unit system (from config)
    const tempUnit = state.UNIT_SYSTEM?.temperature || '°C';

    // Handle wind speed: trust entity's unit if provided, otherwise use HA system units
    let windSpeed = weatherEntity.attributes.wind_speed || 0;
    let windUnit;

    // Check if weather entity specifies its own wind_speed_unit (OpenWeatherMap and others do)
    const entityWindUnit = weatherEntity.attributes.wind_speed_unit;

    if (entityWindUnit) {
      // Entity provides its own unit - use it as-is
      windSpeed = Math.round(windSpeed);
      windUnit = entityWindUnit;
    } else {
      // Fall back to HA global unit system
      const haWindUnit = state.UNIT_SYSTEM?.wind_speed || 'm/s';
      const normalizedWindUnit = String(haWindUnit).trim().toLowerCase();

      if (normalizedWindUnit === 'm/s' || normalizedWindUnit === 'mps') {
        windSpeed = Math.round(windSpeed * 3.6);
        windUnit = 'km/h';
      } else {
        // Home Assistant already reports the value in its configured unit. Preserve km/h, mph,
        // knots, ft/s, and future units instead of treating every non-mph value as m/s.
        windSpeed = Math.round(windSpeed);
        windUnit = haWindUnit;
      }
    }

    if (tempEl) {
      tempEl.textContent = formatMeasurement(
        Math.round(weatherEntity.attributes.temperature || 0),
        tempUnit
      );
    }
    if (conditionEl) conditionEl.textContent = getWeatherConditionLabel(weatherEntity.state);
    if (humidityEl) {
      humidityEl.textContent = formatPercent(weatherEntity.attributes.humidity || 0);
    }
    if (windEl) windEl.textContent = formatMeasurement(windSpeed, windUnit);

    // Render a deterministic SVG for every Home Assistant weather condition.
    if (iconEl) {
      const normalizedCondition = normalizeWeatherCondition(weatherEntity.state);
      renderWeatherIcon(iconEl, normalizedCondition);
      iconEl.className = `weather-icon weather-icon-svg weather-icon-${normalizedCondition}`;
    }

    updateWeatherEffects();
  } catch (error) {
    console.error('Error updating weather:', error);
  }
}

function getWeatherEffectForState(condition) {
  if (!condition) return null;
  const cond = condition.toLowerCase();
  if (cond.includes('storm') || cond.includes('thunder') || cond.includes('lightning')) {
    return 'stormy';
  } else if (cond.includes('rain') || cond.includes('drizzle') || cond.includes('pouring')) {
    return 'rainy';
  } else if (cond.includes('snow') || cond.includes('hail') || cond.includes('sleet')) {
    return 'snowy';
  } else if (
    cond.includes('cloud') ||
    cond.includes('fog') ||
    cond.includes('mist') ||
    cond.includes('haze') ||
    cond.includes('wind') ||
    cond.includes('dust') ||
    cond.includes('sand') ||
    cond.includes('smoke') ||
    cond.includes('ash') ||
    cond.includes('squall') ||
    cond.includes('exceptional')
  ) {
    return 'cloudy';
  } else if (cond.includes('sun') || cond.includes('clear') || cond.includes('stable')) {
    return 'sunny';
  }
  return 'sunny';
}

function updateWeatherEffects(previewEnabled, previewOverride) {
  if (!window.weatherEffects) return;

  const uiConfig = state.CONFIG?.ui || {};

  // The effects live behind the glass; the solid panel Windows without acrylic gets would hide them.
  const enabled =
    state.CONFIG?.frostedGlass &&
    uiUtils.isFrostedGlassAvailable(state.CONFIG) &&
    (previewEnabled !== undefined ? !!previewEnabled : !!uiConfig.weatherEffectsEnabled);
  const override =
    previewOverride !== undefined ? previewOverride : uiConfig.weatherOverride || 'auto';

  if (!enabled) {
    window.weatherEffects.setEffect(null);
    return;
  }

  if (override !== 'auto') {
    window.weatherEffects.setEffect(override);
    return;
  }

  // Get current HA weather state
  const selectedWeatherEntityId = resolveSelectedWeatherEntityId();
  const weatherEntity = selectedWeatherEntityId ? state.STATES?.[selectedWeatherEntityId] : null;
  if (!weatherEntity) {
    window.weatherEffects.setEffect(null);
    return;
  }

  const condition = weatherEntity.state;
  const effect = getWeatherEffectForState(condition);
  window.weatherEffects.setEffect(effect);
}

function populateWeatherEntitiesList() {
  try {
    const list = document.getElementById('weather-entities-list');
    const currentNameEl = document.getElementById('current-weather-name');
    if (!list) return;
    list.setAttribute('role', 'listbox');
    list.setAttribute('aria-label', t('Weather entities'));

    const weatherEntities = Object.values(state.STATES || {})
      .filter((e) => e.entity_id.startsWith('weather.'))
      .sort((a, b) => compareNames(utils.getEntityDisplayName(a), utils.getEntityDisplayName(b)));

    // Rebuilding the list after a pick would otherwise drop focus to <body>, out of the dialog.
    const focusedEntityId = list.contains(document.activeElement)
      ? document.activeElement.closest('.entity-item')?.dataset.weatherEntityId
      : null;
    list.innerHTML = '';

    if (weatherEntities.length === 0) {
      list.innerHTML = `<div class="no-entities-message">${utils.escapeHtml(
        t("No weather entities available. Make sure you're connected to Home Assistant.")
      )}</div>`;
      return;
    }

    const selectedEntityId = state.CONFIG.selectedWeatherEntity;

    // Update current weather name display
    if (currentNameEl) {
      if (selectedEntityId && state.STATES[selectedEntityId]) {
        currentNameEl.textContent = t('{{name}} ✓ (selected)', {
          name: utils.getEntityDisplayName(state.STATES[selectedEntityId]),
        });
        currentNameEl.dataset.state = 'selected';
      } else {
        // Find the actual fallback entity being used (alphabetically first)
        const fallbackEntity = Object.values(state.STATES)
          .filter((e) => e.entity_id.startsWith('weather.'))
          .sort((a, b) =>
            compareNames(utils.getEntityDisplayName(a), utils.getEntityDisplayName(b))
          )[0];

        if (fallbackEntity) {
          currentNameEl.textContent = t('{{name}} (auto-detected)', {
            name: utils.getEntityDisplayName(fallbackEntity),
          });
          currentNameEl.dataset.state = 'auto';
        } else {
          currentNameEl.textContent = t('None available');
          currentNameEl.dataset.state = 'none';
        }
      }
    }

    weatherEntities.forEach((entity) => {
      const entityId = entity.entity_id;
      const isSelected = entityId === selectedEntityId;

      const item = document.createElement('div');
      item.className = 'entity-item' + (isSelected ? ' selected' : '');
      item.setAttribute('role', 'option');
      item.setAttribute('tabindex', '0');
      item.setAttribute('aria-selected', isSelected ? 'true' : 'false');
      item.dataset.weatherEntityId = entityId;

      const displayName = utils.getEntityDisplayName(entity);

      item.innerHTML = `
        <div class="entity-item-main">
          <span class="entity-icon" aria-hidden="true">${entityIconMarkup(entity)}</span>
          <div class="entity-item-info">
            <span class="entity-name">${utils.escapeHtml(displayName)}</span>
            <span class="entity-id">${utils.escapeHtml(entityId)}</span>
          </div>
        </div>
        ${isSelected ? `<span class="selected-badge">${utils.escapeHtml(t('✓ Selected'))}</span>` : ''}
      `;
      // Show each entity's current condition, like the weather card, unless it has its own icon.
      if (!state.CONFIG?.customEntityIcons?.[entityId] && !entity.attributes?.icon) {
        const iconEl = item.querySelector('.entity-icon');
        const condition = normalizeWeatherCondition(entity.state);
        // The card's classes carry the colours for each condition.
        iconEl.classList.add('weather-icon', 'weather-icon-svg', `weather-icon-${condition}`);
        renderWeatherIcon(iconEl, condition, { size: 24 });
      }

      // Add click handler to select this entity
      item.onclick = () => {
        selectWeatherEntity(entityId);
      };
      item.addEventListener('keydown', (event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          selectWeatherEntity(entityId);
          return;
        }
        // A listbox is one Tab stop; the arrows, Home and End move between its options.
        const options = [...list.querySelectorAll('[role="option"]')];
        const next =
          options[
            getNextTabIndex(options.indexOf(item), options.length, event.key, {
              orientation: 'vertical',
            })
          ];
        if (!next || event.ctrlKey || event.metaKey || event.altKey || event.shiftKey) return;
        event.preventDefault();
        syncRovingTabIndex(options, next);
        next.focus();
      });

      item.style.cursor = 'pointer';

      list.appendChild(item);
      if (entityId === focusedEntityId) item.focus();
    });
    const options = [...list.querySelectorAll('[role="option"]')];
    syncRovingTabIndex(
      options,
      options.find((option) => option === document.activeElement) ||
        options.find((option) => option.dataset.weatherEntityId === selectedEntityId)
    );
  } catch (error) {
    console.error('Error populating weather entities list:', error);
  }
}

async function selectWeatherEntity(entityId) {
  try {
    await persistAuthoritativeConfig({
      selectedWeatherEntity: entityId,
    });
    refreshVisibleEntityCache();

    // Refresh weather display
    updateWeatherFromHA();

    // Refresh the list to update selection highlight
    populateWeatherEntitiesList();

    // Show success toast
    const entity = state.STATES[entityId];
    if (entity) {
      uiUtils.showToast(
        t('Weather entity set to {{name}}', { name: utils.getEntityDisplayName(entity) }),
        'success',
        2000
      );
    }
  } catch (error) {
    console.error('Error selecting weather entity:', error);
    if (error?.result?.config?.homeAssistant) {
      refreshVisibleEntityCache();
      updateWeatherFromHA();
      populateWeatherEntitiesList();
    }
    uiUtils.showToast(t('Failed to save weather entity selection'), 'error', 3000);
  }
}

function normalizeMediaArtworkTarget(artworkUrl) {
  const normalized = typeof artworkUrl === 'string' ? artworkUrl.trim() : '';
  if (!normalized) return null;
  if (/^https?:\/\//i.test(normalized)) return normalized;
  return normalized.startsWith('/') ? normalized : `/${normalized}`;
}

function buildMediaArtworkProxyUrl(artworkUrl) {
  if (!artworkUrl || typeof artworkUrl !== 'string') return null;
  const urlToEncode = normalizeMediaArtworkTarget(artworkUrl);
  if (!urlToEncode) return null;

  const cacheBuster = Math.floor(Date.now() / 30000);
  return getRendererHost().resolveMediaUrl({
    kind: 'media_artwork',
    url: urlToEncode,
    cacheKey: cacheBuster,
  });
}

// --- Media Player Tile ---
function updateMediaTile() {
  try {
    const tile = document.getElementById('media-tile');
    if (!tile) return;

    // Check if a primary media player is configured
    const primaryPlayer = state.CONFIG.primaryMediaPlayer;
    if (!primaryPlayer) {
      tile.style.display = 'none';
      isMediaTileVisible = false;
      lastMediaTileRenderSignature = '';
      lastMediaTileArtworkSrc = '';
      refreshVisibleEntityCache();
      return;
    }

    // Get the media player entity
    const entity = state.STATES[primaryPlayer];
    if (!entity) {
      tile.style.display = 'none';
      isMediaTileVisible = false;
      lastMediaTileRenderSignature = '';
      lastMediaTileArtworkSrc = '';
      refreshVisibleEntityCache();
      return;
    }

    // Show the tile
    tile.style.display = 'grid';
    isMediaTileVisible = true;
    const actions = {
      'media-tile-play': entity.state === 'playing' ? 'pause' : 'play',
      'media-tile-prev': 'previous_track',
      'media-tile-next': 'next_track',
    };
    for (const [id, action] of Object.entries(actions)) {
      const control = document.getElementById(id);
      if (control) {
        control.disabled = !canPerformMediaAction(entity, action);
        control.setAttribute('aria-disabled', String(control.disabled));
      }
    }

    // Try multiple artwork sources (smart speakers might use different attributes)
    let artworkUrl =
      entity.attributes?.entity_picture ||
      entity.attributes?.media_image_url ||
      entity.attributes?.media_content_id;

    // Some media players provide thumbnail or image_url
    if (!artworkUrl && entity.attributes?.media_album_name) {
      // If we have album info but no artwork, entity_picture might update later
      artworkUrl = entity.attributes?.entity_picture;
    }

    // Update media info
    const titleEl = document.getElementById('media-tile-title');
    const artistEl = document.getElementById('media-tile-artist');
    const mediaTitle = entity.attributes?.media_title || t('No media playing');
    const mediaArtist = entity.attributes?.media_artist || '';
    const isPlaying = entity.state === 'playing';
    const proxyUrl = buildMediaArtworkProxyUrl(artworkUrl);
    const nextSignature = JSON.stringify({
      entityId: entity.entity_id,
      state: entity.state || '',
      title: mediaTitle,
      artist: mediaArtist,
      artwork: proxyUrl || '',
    });

    if (nextSignature !== lastMediaTileRenderSignature) {
      lastMediaTileRenderSignature = nextSignature;

      if (titleEl && titleEl.textContent !== mediaTitle) titleEl.textContent = mediaTitle;
      if (artistEl && artistEl.textContent !== mediaArtist) artistEl.textContent = mediaArtist;

      // Update play/pause button
      const playBtn = document.getElementById('media-tile-play');
      if (playBtn) {
        setIconContent(playBtn, isPlaying ? 'pause' : 'play', { size: 30 });
        playBtn.classList.toggle('playing', isPlaying);
      }

      // Update artwork only when the source actually changes.
      const artworkContainer = document.getElementById('media-tile-artwork');
      if (artworkContainer) {
        if (proxyUrl) {
          const existingImg = artworkContainer.querySelector('img');
          const existingSrc = existingImg?.getAttribute('src') || '';
          if (!existingImg || existingSrc !== proxyUrl || lastMediaTileArtworkSrc !== proxyUrl) {
            const img = document.createElement('img');
            img.src = proxyUrl;
            img.alt = t('Album art');
            img.onerror = function () {
              this.parentElement.innerHTML = `<div class="media-tile-artwork-placeholder">${lineIconMarkup('music')}</div>`;
              lastMediaTileArtworkSrc = '';
            };
            artworkContainer.innerHTML = '';
            artworkContainer.appendChild(img);
            lastMediaTileArtworkSrc = proxyUrl;
          }
        } else if (lastMediaTileArtworkSrc !== '') {
          artworkContainer.innerHTML = `<div class="media-tile-artwork-placeholder">${lineIconMarkup('music')}</div>`;
          lastMediaTileArtworkSrc = '';
        }
      }
    }

    // Keep seek bar updates separate from metadata/artwork render signature.
    updateMediaSeekBar(entity);
    refreshVisibleEntityCache();
  } catch (error) {
    console.error('Error updating media tile:', error);
  }
}

function updateMediaSeekBar(entity) {
  try {
    if (!entity) return;

    const seekFill = document.getElementById('media-tile-seek-fill');
    const timeCurrent = document.getElementById('media-tile-time-current');
    const timeTotal = document.getElementById('media-tile-time-total');
    const { duration, currentPosition } = getMediaTimeline(entity);

    // Format time as mm:ss or h:mm:ss when hours are present
    const formatTime = (seconds) => {
      const totalSeconds = Math.max(0, Math.floor(seconds));
      const hours = Math.floor(totalSeconds / 3600);
      const mins = Math.floor((totalSeconds % 3600) / 60);
      const secs = totalSeconds % 60;
      const minPart = hours > 0 ? mins.toString().padStart(2, '0') : mins.toString();
      const secPart = secs.toString().padStart(2, '0');
      return hours > 0 ? `${hours}:${minPart}:${secPart}` : `${minPart}:${secPart}`;
    };

    // Update UI
    if (timeCurrent) timeCurrent.textContent = formatTime(currentPosition);
    if (timeTotal) timeTotal.textContent = duration > 0 ? formatTime(duration) : '0:00';

    if (seekFill && duration > 0) {
      const percentage = Math.max(0, Math.min(100, (currentPosition / duration) * 100));
      seekFill.style.width = `${percentage}%`;
    } else if (seekFill) {
      seekFill.style.width = '0%';
    }
  } catch (error) {
    console.error('Error updating seek bar:', error);
  }
}

function callMediaTileService(action) {
  try {
    const primaryPlayer = state.CONFIG.primaryMediaPlayer;
    if (!primaryPlayer) return;

    const mapped = { previous: 'previous_track', next: 'next_track', play: 'play', pause: 'pause' };
    if (mapped[action]) return callMediaPlayerService(primaryPlayer, mapped[action]);
  } catch (error) {
    console.error('Error calling media tile service:', error);
    uiUtils.showToast(t('Failed to control media player'), 'error', 3000);
  }
}

// --- Misc UI ---
function showNoConnectionMessage() {
  try {
    const container = document.getElementById('quick-controls');
    if (!container) return;
    // An OAuth setup without a token is configured but waiting on its authorization; the
    // main window's connection panel explains that, so it never gets setup instructions.
    const needsSetup =
      !state.CONFIG ||
      !state.CONFIG.homeAssistant ||
      (state.CONFIG.homeAssistant.token === 'YOUR_LONG_LIVED_ACCESS_TOKEN' &&
        state.CONFIG.homeAssistant.authMethod !== 'oauth');
    const title = needsSetup ? t('Set up your connection') : t('Connecting to Home Assistant...');
    const detail = needsSetup
      ? t(
          'Connect your Home Assistant server to start building a compact control panel for your desktop.'
        )
      : t('If this takes a while, check the Home Assistant URL and sign-in in Settings.');
    container.innerHTML = `
      <div class="status-message${needsSetup ? '' : ' is-connecting'}" role="status">
        <span class="status-message-icon" aria-hidden="true">${lineIconMarkup(needsSetup ? 'settings' : 'refresh-cw')}</span>
        <h3 class="status-message-title">${utils.escapeHtml(title)}</h3>
        ${needsSetup ? '' : `<p class="status-message-url">${utils.escapeHtml(state.CONFIG.homeAssistant.url || '')}</p>`}
        <p class="status-message-detail">${utils.escapeHtml(detail)}</p>
        <button type="button" class="btn btn-secondary status-message-action">${utils.escapeHtml(t('Open Settings'))}</button>
      </div>`;
    container
      .querySelector('.status-message-action')
      ?.addEventListener('click', () => document.getElementById('settings-btn')?.click());
  } catch (error) {
    console.error('Error showing no connection message:', error);
  }
}

function updateTimeDisplay() {
  try {
    const now = new Date();
    const timeEl = document.getElementById('current-time');
    const dateEl = document.getElementById('current-date');

    // A 12-hour clock reads "7:31 AM" like every other time label; a 24-hour one keeps "07:31".
    if (timeEl) timeEl.textContent = formatClockTime(now, getClockFaceTimeOptions());
    if (dateEl) dateEl.textContent = formatDate(now, getClockDateOptions());
  } catch (error) {
    console.error('Error updating time display:', error);
  }
}

function handleCameraModalClosed(event) {
  try {
    const entityId = event?.detail?.entityId;
    if (!entityId) return;
    const entity = state.STATES[entityId];
    if (entity) {
      updateEntityInUI(entity);
      camera.refreshCameraPreview(entityId, { force: true });
    }
  } catch (error) {
    console.error('Error refreshing camera tile after modal close:', error);
  }
}

document.addEventListener('camera-modal-closed', handleCameraModalClosed);

let timeTickerId = null;

function startTimeTicker() {
  if (timeTickerId) return;
  updateTimeDisplay();
  timeTickerId = setInterval(updateTimeDisplay, 1000);
}

function stopTimeTicker() {
  if (!timeTickerId) return;
  clearInterval(timeTickerId);
  timeTickerId = null;
}

function updateTimerDisplays() {
  try {
    if (!hasVisibleTimerEntities) return;

    // Find all timer entities AND sensor entities with timer attributes in Quick Access
    const timerElements = document.querySelectorAll('.control-item.timer-entity');

    timerElements.forEach((timerEl) => {
      const entityId = timerEl.dataset.entityId;
      const entity = state.STATES[entityId];

      if (!entity) return;

      // Handle timer.* entities
      if (entityId.startsWith('timer.')) {
        if (entity.state !== 'active') return;

        // Calculate remaining time
        const finishesAt = entity.attributes?.finishes_at;
        if (!finishesAt) return;

        const endTime = new Date(finishesAt).getTime();
        const now = Date.now();
        const remaining = Math.max(0, Math.floor((endTime - now) / 1000));

        // Format as mm:ss or hh:mm:ss
        const hours = Math.floor(remaining / 3600);
        const minutes = Math.floor((remaining % 3600) / 60);
        const seconds = remaining % 60;

        let display;
        if (hours > 0) {
          display = `${hours}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
        } else {
          display = `${minutes}:${String(seconds).padStart(2, '0')}`;
        }

        // Update the countdown display
        const countdownEl = timerEl.querySelector('.timer-countdown');
        if (countdownEl && countdownEl.textContent !== display) {
          countdownEl.textContent = display;
        }
      }
      // Handle sensor.* entities that are timers (like Google Kitchen Timer)
      else if (entityId.startsWith('sensor.')) {
        // Check for various timer end time attributes
        let finishesAt =
          entity.attributes?.finishes_at ||
          entity.attributes?.end_time ||
          entity.attributes?.finish_time;

        // If no attribute, check if state is a timestamp (Google Kitchen Timer uses state as timestamp)
        if (
          !finishesAt &&
          entity.state &&
          entity.state !== 'unavailable' &&
          entity.state !== 'unknown'
        ) {
          // Only treat as timestamp if it looks like a full ISO 8601 date-time string with time component
          // Require time component (YYYY-MM-DDTHH:mm or YYYY-MM-DD HH:mm) to avoid matching date-only sensors
          // This prevents matching calendar/date sensors showing "2025-12-25" and other date-only values
          const iso8601Pattern = /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(:\d{2})?/;
          const looksLikeTimestamp = iso8601Pattern.test(entity.state);
          if (looksLikeTimestamp) {
            const stateTime = new Date(entity.state).getTime();
            if (!isNaN(stateTime)) {
              finishesAt = entity.state;
            }
          }
        }

        if (!finishesAt) return;

        // Check if timer is active (finishes_at is in the future)
        const endTime = new Date(finishesAt).getTime();
        const now = Date.now();

        if (endTime <= now) {
          // Timer finished
          const countdownEl = timerEl.querySelector('.timer-countdown');
          if (countdownEl) {
            countdownEl.textContent = t('Finished');
          }
          return;
        }

        const remaining = Math.max(0, Math.floor((endTime - now) / 1000));

        // Format as mm:ss or hh:mm:ss
        const hours = Math.floor(remaining / 3600);
        const minutes = Math.floor((remaining % 3600) / 60);
        const seconds = remaining % 60;

        let display;
        if (hours > 0) {
          display = `${hours}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
        } else {
          display = `${minutes}:${String(seconds).padStart(2, '0')}`;
        }

        // Update the countdown display
        const countdownEl = timerEl.querySelector('.timer-countdown');
        if (countdownEl && countdownEl.textContent !== display) {
          countdownEl.textContent = display;
        }
      }
    });
  } catch {
    // Silent fail - timers will just show static state from entity updates
  }
}

function showBrightnessSlider(light) {
  try {
    const name = utils.escapeHtml(utils.getEntityDisplayName(light));
    const currentBrightness =
      light.state === 'on' && light.attributes.brightness
        ? Math.round((light.attributes.brightness / 255) * 100)
        : 0;
    const canSetBrightness = getDesktopPinCapabilities(light).canSetBrightness;
    const lightAttributes = light.attributes || {};
    const showColorTempControl = supportsLightColorTemp(lightAttributes);
    const showColorControl = supportsLightColor(lightAttributes);
    const colorTempRange = getLightColorTempRange(lightAttributes);
    const currentColorTemp = getInitialLightColorTempKelvin(lightAttributes, colorTempRange);
    const currentColorHex = rgbToHex(lightAttributes.rgb_color);
    const colorTempMarkup = showColorTempControl
      ? `
            <div class="brightness-color-temp">
              <div class="brightness-control-heading">
                <span>${utils.escapeHtml(t('Color Temperature'))}</span>
                <span id="light-color-temp-value">${currentColorTemp}K</span>
              </div>
              <input
                type="range"
                min="${colorTempRange.min}"
                max="${colorTempRange.max}"
                step="50"
                value="${currentColorTemp}"
                id="light-color-temp-slider"
                class="light-color-temp-slider"
                aria-label="${escapeHtmlAttribute(t('Color Temperature'))}"
              />
              <div class="brightness-slider-labels">
                <span>${utils.escapeHtml(translateInContext('Color temperature: Warm', 'Warm'))}</span>
                <span>${utils.escapeHtml(translateInContext('Color temperature: Cool', 'Cool'))}</span>
              </div>
            </div>
        `
      : '';
    const colorControlMarkup = showColorControl
      ? `
            <div class="brightness-color-picker">
              <div class="brightness-control-heading">
                <span>${utils.escapeHtml(t('Color'))}</span>
              </div>
              <div class="brightness-color-row">
                <input
                  type="color"
                  value="${escapeHtmlAttribute(currentColorHex)}"
                  id="light-color-picker"
                  class="light-color-picker"
                  aria-label="${escapeHtmlAttribute(t('Light Color'))}"
                />
                <div class="light-color-swatches">
                  ${LIGHT_COLOR_PRESETS.map(
                    (color) => `
                    <button
                      class="light-color-swatch"
                      type="button"
                      data-color="${escapeHtmlAttribute(color)}"
                      style="--swatch-color: ${escapeHtmlAttribute(color)}"
                      aria-label="${escapeHtmlAttribute(t('Set light color {{color}}', { color }))}"
                    ></button>
                  `
                  ).join('')}
                </div>
              </div>
            </div>
        `
      : '';

    const modal = document.createElement('div');
    modal.className = 'modal brightness-modal';
    modal.innerHTML = `
      <div class="modal-content brightness-modal-content">
        <div class="modal-header">
          <h2>${name}</h2>
          <button class="close-btn" id="brightness-close" type="button" title="${escapeHtmlAttribute(t('Close'))}" aria-label="${escapeHtmlAttribute(t('Close'))}">×</button>
        </div>
        <div class="modal-body">
          <div class="brightness-content">
            <div class="brightness-icon-wrapper">
              <div class="brightness-icon" id="brightness-icon">${lineIconMarkup('lightbulb')}</div>
            </div>
            <div class="brightness-value-large" id="brightness-value-large">${canSetBrightness ? formatPercent(currentBrightness) : utils.escapeHtml(t(light.state === 'on' ? 'On' : 'Off'))}</div>
            <div class="brightness-label">${utils.escapeHtml(t(canSetBrightness ? 'Brightness' : 'State'))}</div>
            ${
              canSetBrightness
                ? `<div class="brightness-slider-wrapper">
              <input 
                type="range" 
                min="0" 
                max="100" 
                value="${currentBrightness}" 
                id="brightness-slider" 
                class="brightness-slider" 
                aria-label="${escapeHtmlAttribute(t('Brightness'))}" 
                orient="vertical" 
              />
            </div>
            <div class="brightness-presets">
              <button class="brightness-preset-btn" data-preset="25">25%</button>
              <button class="brightness-preset-btn" data-preset="50">50%</button>
              <button class="brightness-preset-btn" data-preset="75">75%</button>
              <button class="brightness-preset-btn" data-preset="100">100%</button>
            </div>
            `
                : ''
            }
            ${colorTempMarkup}
            ${colorControlMarkup}
          </div>
        </div>
        <div class="modal-footer">
          <button class="btn btn-secondary" id="brightness-cancel">${utils.escapeHtml(t('Close'))}</button>
          <button class="btn btn-primary" id="turn-off-btn">${utils.escapeHtml(t('Turn Off'))}</button>
        </div>
      </div>
    `;
    document.body.appendChild(modal);
    applyCloseButtonIcons(modal);
    activateAccessibleDialogModal(modal, {
      titleIdPrefix: 'brightness-title',
      dismiss: () => closeModal(),
      initialFocus: startOnHeading(modal),
    });

    const slider = modal.querySelector('#brightness-slider');
    const valueLarge = modal.querySelector('#brightness-value-large');
    const icon = modal.querySelector('#brightness-icon');
    const closeBtn = modal.querySelector('#brightness-close');
    const cancelBtn = modal.querySelector('#brightness-cancel');
    const turnOffBtn = modal.querySelector('#turn-off-btn');
    const presetButtons = modal.querySelectorAll('.brightness-preset-btn');
    const colorTempSlider = modal.querySelector('#light-color-temp-slider');
    const colorTempValue = modal.querySelector('#light-color-temp-value');
    const colorPicker = modal.querySelector('#light-color-picker');
    const colorSwatches = modal.querySelectorAll('.light-color-swatch');

    // Track current light state
    let lightIsOn = light.state === 'on';
    let confirmedLightIsOn = lightIsOn;
    let confirmedBrightness = currentBrightness;
    let confirmedColorTemp = currentColorTemp;
    let confirmedColorHex = currentColorHex;
    // Shown optimistically by Turn On, which lets the light restore its own last brightness.
    let lastOnBrightness = currentBrightness;
    let brightnessDebounceTimer = null;
    let colorTempDebounceTimer = null;
    let colorDebounceTimer = null;
    let lightCommandRevision = 0;
    let lightCommandsInFlight = 0;
    let missedLiveUpdate = false;
    const cancelPendingLightCommands = () => {
      clearTimeout(brightnessDebounceTimer);
      clearTimeout(colorTempDebounceTimer);
      clearTimeout(colorDebounceTimer);
      brightnessDebounceTimer = colorTempDebounceTimer = colorDebounceTimer = null;
      lightCommandRevision += 1;
    };
    const callLightService = (service, data, rollback) => {
      const revision = ++lightCommandRevision;
      lightCommandsInFlight += 1;
      return callServiceWithUiRollback(light, 'light', service, data, () => {
        if (revision === lightCommandRevision) rollback?.();
      }).then((result) => {
        lightCommandsInFlight -= 1;
        // Apply a state Home Assistant pushed while this command was pending, after its handler.
        if (missedLiveUpdate) setTimeout(() => syncFromEntity(state.STATES?.[light.entity_id]));
        return { ...result, ok: result.ok && revision === lightCommandRevision };
      });
    };
    const hasPendingLightCommand = () =>
      !!(brightnessDebounceTimer || colorTempDebounceTimer || colorDebounceTimer) ||
      lightCommandsInFlight > 0;

    // Update turn off/on button text
    const updateTurnButton = () => {
      if (!canSetBrightness && valueLarge) valueLarge.textContent = lightIsOn ? t('On') : t('Off');
      if (turnOffBtn) {
        turnOffBtn.textContent = lightIsOn ? t('Turn Off') : t('Turn On');
      }
    };
    updateTurnButton();
    // After updateTurnButton, which would otherwise write "Off" over "Unavailable".
    showUnavailableDialogState(modal, light);

    // Close handlers
    let isClosing = false;
    let unsubscribe = () => {};
    const closeModal = () => {
      if (isClosing) return;
      isClosing = true;
      entityDetailClosers.delete(closeModal);
      unsubscribe();
      if (brightnessDebounceTimer) clearTimeout(brightnessDebounceTimer);
      if (colorTempDebounceTimer) clearTimeout(colorTempDebounceTimer);
      if (colorDebounceTimer) clearTimeout(colorDebounceTimer);
      void uiUtils.closeDialog(modal, { remove: true });
    };
    // An account or server change closes this dialog with its timers and subscription.
    entityDetailClosers.add(closeModal);
    if (closeBtn) closeBtn.onclick = closeModal;
    if (cancelBtn) cancelBtn.onclick = closeModal;

    // Animate in
    setTimeout(() => modal.classList.add('modal-open'), 10);

    // Update icon and accent based on brightness
    // One bulb whose glow follows the level (see .brightness-icon in styles.css); off swaps in
    // the struck-through bulb.
    const updateIconAndAccent = (value) => {
      if (!icon) return;
      const iconName = value === 0 ? 'lightbulb-off' : 'lightbulb';
      if (icon.firstElementChild?.dataset.icon !== iconName) setLineIconContent(icon, iconName);
      if (value === 0) icon.className = 'brightness-icon brightness-off';
      else if (value <= 25) icon.className = 'brightness-icon brightness-low';
      else if (value <= 50) icon.className = 'brightness-icon brightness-mid';
      else if (value <= 75) icon.className = 'brightness-icon brightness-high';
      else icon.className = 'brightness-icon brightness-max';
    };

    // Slider behavior with debounce
    if (slider) {
      const applyValue = (value) => {
        if (valueLarge) valueLarge.textContent = formatPercent(value);
        updateIconAndAccent(value);
        if (value > 0) lastOnBrightness = value;
        clearTimeout(brightnessDebounceTimer);
        brightnessDebounceTimer = setTimeout(() => {
          brightnessDebounceTimer = null;
          const brightness = Math.round((value / 100) * 255);
          const nextIsOn = brightness > 0;
          const service = nextIsOn ? 'turn_on' : 'turn_off';
          const serviceData = nextIsOn
            ? { entity_id: light.entity_id, brightness }
            : { entity_id: light.entity_id };
          callLightService(service, serviceData, () => {
            lightIsOn = confirmedLightIsOn;
            slider.value = String(confirmedBrightness);
            if (valueLarge) valueLarge.textContent = formatPercent(confirmedBrightness);
            updateIconAndAccent(confirmedBrightness);
            updateTurnButton();
          }).then(({ ok }) => {
            if (!ok) return;
            confirmedBrightness = value;
            confirmedLightIsOn = nextIsOn;
            lightIsOn = nextIsOn;
            updateTurnButton();
          });
        }, 120);
      };
      slider.addEventListener('input', (e) => {
        const value = parseInt(e.target.value, 10) || 0;
        applyValue(value);
      });
      // Initialize icon/accent
      updateIconAndAccent(currentBrightness);
    }

    // Presets
    presetButtons.forEach((btn) => {
      btn.addEventListener('click', () => {
        const preset = parseInt(btn.getAttribute('data-preset'), 10) || 0;
        const sliderEl = modal.querySelector('#brightness-slider');
        if (sliderEl) {
          sliderEl.value = String(preset);
          sliderEl.dispatchEvent(new Event('input', { bubbles: true }));
        }
      });
    });

    if (colorTempSlider) {
      colorTempSlider.addEventListener('input', (e) => {
        const kelvin = clampRange(
          Math.round(Number(e.target.value)),
          colorTempRange.min,
          colorTempRange.max
        );
        if (colorTempValue) colorTempValue.textContent = `${kelvin}K`;
        clearTimeout(colorTempDebounceTimer);
        colorTempDebounceTimer = setTimeout(() => {
          colorTempDebounceTimer = null;
          lightIsOn = true;
          updateTurnButton();
          callLightService(
            'turn_on',
            {
              entity_id: light.entity_id,
              color_temp_kelvin: kelvin,
            },
            () => {
              lightIsOn = confirmedLightIsOn;
              colorTempSlider.value = String(confirmedColorTemp);
              if (colorTempValue) colorTempValue.textContent = `${confirmedColorTemp}K`;
              updateTurnButton();
            }
          ).then(({ ok }) => {
            if (!ok) return;
            confirmedColorTemp = kelvin;
            confirmedLightIsOn = true;
          });
        }, 150);
      });
    }

    const applyColor = (hexColor) => {
      const rgb = uiUtils.hexToRgb(hexColor);
      if (!rgb) return;
      if (colorPicker) colorPicker.value = rgbToHex([rgb.r, rgb.g, rgb.b]);
      clearTimeout(colorDebounceTimer);
      colorDebounceTimer = setTimeout(() => {
        colorDebounceTimer = null;
        lightIsOn = true;
        updateTurnButton();
        callLightService(
          'turn_on',
          {
            entity_id: light.entity_id,
            rgb_color: [rgb.r, rgb.g, rgb.b],
          },
          () => {
            lightIsOn = confirmedLightIsOn;
            if (colorPicker) colorPicker.value = confirmedColorHex;
            updateTurnButton();
          }
        ).then(({ ok }) => {
          if (!ok) return;
          confirmedColorHex = rgbToHex([rgb.r, rgb.g, rgb.b]);
          confirmedLightIsOn = true;
        });
      }, 150);
    };

    if (colorPicker) {
      colorPicker.addEventListener('input', (e) => {
        applyColor(e.target.value);
      });
    }

    colorSwatches.forEach((btn) => {
      btn.addEventListener('click', () => {
        applyColor(btn.getAttribute('data-color'));
      });
    });

    // Turn off/on button
    if (turnOffBtn) {
      turnOffBtn.onclick = () => {
        cancelPendingLightCommands();
        const previousLightIsOn = confirmedLightIsOn;
        const previousBrightness = confirmedBrightness;
        if (lightIsOn) {
          lightIsOn = false;
          if (slider) slider.value = '0';
          if (valueLarge) valueLarge.textContent = formatPercent(0);
          updateIconAndAccent(0);
          callLightService('turn_off', { entity_id: light.entity_id }, () => {
            lightIsOn = previousLightIsOn;
            if (slider) slider.value = String(previousBrightness);
            if (valueLarge) valueLarge.textContent = formatPercent(previousBrightness);
            updateIconAndAccent(previousBrightness);
            updateTurnButton();
          }).then(({ ok }) => {
            if (!ok) return;
            confirmedLightIsOn = false;
            confirmedBrightness = 0;
          });
        } else {
          // Like Home Assistant's own toggle, send no brightness so the light restores its
          // last level; show the last level seen here until the live state confirms it.
          lightIsOn = true;
          const targetValue = lastOnBrightness > 0 ? lastOnBrightness : 100;
          if (slider) slider.value = String(targetValue);
          if (valueLarge) valueLarge.textContent = formatPercent(targetValue);
          updateIconAndAccent(targetValue);
          callLightService('turn_on', { entity_id: light.entity_id }, () => {
            lightIsOn = previousLightIsOn;
            if (slider) slider.value = String(previousBrightness);
            if (valueLarge) valueLarge.textContent = formatPercent(previousBrightness);
            updateIconAndAccent(previousBrightness);
            updateTurnButton();
          }).then(({ ok }) => {
            if (!ok) return;
            confirmedLightIsOn = true;
            confirmedBrightness = targetValue;
          });
        }
        updateTurnButton();
      };
    }

    // Follow Home Assistant while open (e.g. an external turn-off), but never under a pending
    // command or a focused control.
    const syncFromEntity = (nextEntity) => {
      if (!modal.isConnected || isClosing) {
        unsubscribe();
        return;
      }
      if (!nextEntity) return;
      syncLightControls(nextEntity);
      // After the values and turn button, which would otherwise write over "Unavailable".
      showUnavailableDialogState(modal, nextEntity);
    };
    const syncLightControls = (nextEntity) => {
      // Only a state pushed while a command is in flight can reflect it; replay that one later.
      missedLiveUpdate = lightCommandsInFlight > 0;
      if (hasPendingLightCommand()) return;
      const attributes = nextEntity.attributes || {};
      const isOn = nextEntity.state === 'on';
      const brightness =
        isOn && attributes.brightness ? Math.round((attributes.brightness / 255) * 100) : 0;
      lightIsOn = confirmedLightIsOn = isOn;
      confirmedBrightness = brightness;
      if (brightness > 0) lastOnBrightness = brightness;
      if (slider && document.activeElement !== slider) {
        slider.value = String(brightness);
        if (valueLarge) valueLarge.textContent = formatPercent(brightness);
        updateIconAndAccent(brightness);
      }
      if (
        colorTempSlider &&
        document.activeElement !== colorTempSlider &&
        (attributes.color_temp_kelvin != null || attributes.color_temp != null)
      ) {
        confirmedColorTemp = getInitialLightColorTempKelvin(attributes, colorTempRange);
        colorTempSlider.value = String(confirmedColorTemp);
        if (colorTempValue) colorTempValue.textContent = `${confirmedColorTemp}K`;
      }
      if (colorPicker && document.activeElement !== colorPicker && attributes.rgb_color) {
        confirmedColorHex = rgbToHex(attributes.rgb_color);
        colorPicker.value = confirmedColorHex;
      }
      updateTurnButton();
    };
    unsubscribe = state.subscribeEntity(light.entity_id, syncFromEntity);
    // A focused control was skipped above; catch up once the user leaves it.
    [slider, colorTempSlider, colorPicker].forEach((control) =>
      control?.addEventListener('blur', () => syncFromEntity(state.STATES?.[light.entity_id]))
    );

    // Close on backdrop click only when clicking the overlay
  } catch (error) {
    console.error('Error showing brightness slider:', error);
  }
}

const climateRangeControllers = new WeakMap();

function climateRangeMarkup(capabilities, { pin = false, unit = '' } = {}) {
  if (!capabilities.canSetRange) return '';
  // Both bounds share the entity's full scale so their thumbs sit where the values are.
  const scaleLabels = pin
    ? ''
    : `<span class="climate-slider-labels" aria-hidden="true">
        <span>${formatMeasurement(capabilities.minTemp, unit)}</span>
        <span>${formatMeasurement(capabilities.maxTemp, unit)}</span>
      </span>`;
  return ['low', 'high']
    .map((bound) => {
      const low = bound === 'low';
      const label = low ? t('Heating target') : t('Cooling target');
      const visibleLabel = pin ? (low ? t('Heating') : t('Cooling')) : label;
      return `<label class="${pin ? 'desktop-pin-panel-slider-row' : 'climate-slider-wrapper'}">
      <span class="${pin ? 'desktop-pin-panel-slider-label' : 'climate-temp-label'}">${utils.escapeHtml(visibleLabel)}</span>
      <input type="range" class="${pin ? 'desktop-pin-panel-slider' : 'climate-slider'}" data-climate-range="${bound}"
        min="${capabilities.minTemp}" max="${capabilities.maxTemp}"
        step="${capabilities.temperatureStep}" value="${low ? capabilities.targetLow : capabilities.targetHigh}"
        aria-label="${utils.escapeHtml(label)}" />
      ${scaleLabels}
    </label>`;
    })
    .join('');
}

function bindClimateRangeControls(root, entity, capabilities, onChange) {
  const low = root.querySelector('[data-climate-range="low"]');
  const high = root.querySelector('[data-climate-range="high"]');
  if (!low || !high) return null;
  let confirmed = { low: capabilities.targetLow, high: capabilities.targetHigh };
  let revision = 0;
  let timer;
  let pending = false;
  let displayedRange = confirmed;
  let draggedInput = null;
  const apply = (range) => {
    displayedRange = range;
    low.value = String(range.low);
    high.value = String(range.high);
    onChange(range);
  };
  // A thumb the user is dragging or has focused keeps its value when Home Assistant reports a
  // change; it catches up once released or left.
  const isHeld = (input) => input === draggedInput || document.activeElement === input;
  const applyAroundHeld = (range) => {
    apply({
      low: isHeld(low) ? Number(low.value) : range.low,
      high: isHeld(high) ? Number(high.value) : range.high,
    });
  };
  const controller = {
    sync(range) {
      if (pending) onChange(displayedRange);
      else {
        confirmed = range;
        applyAroundHeld(range);
      }
    },
    cancel() {
      clearTimeout(timer);
      revision += 1;
      pending = false;
    },
  };
  [low, high].forEach((input) => {
    const release = () => {
      if (draggedInput === input) draggedInput = null;
      if (!pending) applyAroundHeld(confirmed);
    };
    input.addEventListener('pointerdown', () => {
      draggedInput = input;
    });
    input.addEventListener('pointerup', release);
    input.addEventListener('pointercancel', release);
    input.addEventListener('blur', release);
    input.addEventListener('input', (event) => {
      event.stopPropagation();
      // The bounds cannot cross: the dragged thumb stops at the other one.
      if (Number(low.value) > Number(high.value)) {
        if (input === low) low.value = high.value;
        else high.value = low.value;
      }
      const range = { low: Number(low.value), high: Number(high.value) };
      if (!Number.isFinite(range.low) || !Number.isFinite(range.high) || range.low > range.high)
        return;
      const requestRevision = ++revision;
      pending = true;
      apply(range);
      clearTimeout(timer);
      timer = setTimeout(async () => {
        const { ok } = await callServiceWithUiRollback(
          entity,
          'climate',
          'set_temperature',
          {
            entity_id: entity.entity_id,
            target_temp_low: range.low,
            target_temp_high: range.high,
          },
          () => {
            if (requestRevision === revision) apply(confirmed);
          }
        );
        if (requestRevision !== revision) return;
        pending = false;
        if (ok) confirmed = range;
      }, 300);
    });
  });
  climateRangeControllers.set(root, controller);
  apply(confirmed);
  return controller;
}

// `replaces` and `focusSelector` rebuild a dialog the user is looking at (a heat/cool mode swaps the
// slider for a range): the new one takes the old one's place and opener, focus stays on the same
// control, and the entrance is not replayed.
function showClimateControls(climateEntity, { replaces = null, focusSelector = null } = {}) {
  try {
    const attributes = climateEntity?.attributes || {};
    const capabilities = getClimateControlCapabilities(climateEntity);
    const name = utils.escapeHtml(utils.getEntityDisplayName(climateEntity));
    const currentTemp = capabilities.currentTemp;
    const targetTemp = capabilities.targetTemp;
    const currentMode = String(climateEntity.state || 'off');
    const minTemp = capabilities.minTemp;
    const maxTemp = capabilities.maxTemp;
    const tempUnit = utils.escapeHtml(
      attributes.temperature_unit ||
        attributes.unit_of_measurement ||
        state.UNIT_SYSTEM?.temperature ||
        '°C'
    );
    const hasCurrentHumidity =
      attributes.current_humidity !== undefined && attributes.current_humidity !== null;
    const currentHumidity = hasCurrentHumidity
      ? utils.escapeHtml(formatNumber(attributes.current_humidity))
      : '';
    const availableModes = capabilities.hvacModes;
    const availableFanModes = capabilities.fanModes;
    const availablePresetModes = capabilities.presetModes;
    const currentFanMode = String(attributes.fan_mode || '');
    const currentPresetMode = String(attributes.preset_mode || '');
    const hasControls =
      capabilities.canSetTemperature ||
      capabilities.canSetRange ||
      availableModes.length > 0 ||
      availableFanModes.length > 0 ||
      availablePresetModes.length > 0;

    const modal = document.createElement('div');
    modal.className = 'modal climate-modal';
    modal.innerHTML = `
      <div class="modal-content climate-modal-content">
        <div class="modal-header">
          <h2>${name}</h2>
          <button class="close-btn" id="climate-close" type="button" title="${escapeHtmlAttribute(t('Close'))}" aria-label="${escapeHtmlAttribute(t('Close'))}">×</button>
        </div>
        <div class="modal-body">
          <div class="climate-content">
            <div class="climate-temp-display${capabilities.canSetRange ? ' is-range' : ''}">
              <div class="climate-current-temp">
                <div class="climate-temp-label">${utils.escapeHtml(t('Current'))}</div>
                <div class="climate-temp-value">${currentTemp === null ? '—' : formatMeasurement(currentTemp, tempUnit)}</div>
              </div>
              <div class="climate-target-temp">
                <div class="climate-temp-label">${utils.escapeHtml(t('Target'))}</div>
                <div class="climate-temp-value-large" id="climate-target-value">${targetTemp === null ? '—' : formatMeasurement(targetTemp, tempUnit)}</div>
              </div>
            </div>
            ${
              hasCurrentHumidity
                ? `
              <div class="climate-extra-stats">
                <div class="climate-stat">
                  <div class="climate-temp-label">${utils.escapeHtml(t('Humidity'))}</div>
                  <div class="climate-temp-value">${formatPercent(currentHumidity)}</div>
                </div>
              </div>
            `
                : ''
            }

            ${
              capabilities.canSetTemperature
                ? `<div class="climate-slider-wrapper">
              <input
                type="range"
                min="${minTemp}"
                max="${maxTemp}"
                step="${capabilities.temperatureStep}"
                value="${targetTemp}"
                id="climate-slider"
                class="climate-slider"
                aria-label="${escapeHtmlAttribute(t('Target temperature'))}"
              />
              <div class="climate-slider-labels">
                <span>${formatMeasurement(minTemp, tempUnit)}</span>
                <span>${formatMeasurement(maxTemp, tempUnit)}</span>
              </div>
            </div>`
                : ''
            }

            ${climateRangeMarkup(capabilities, { unit: tempUnit })}
            ${
              availableModes.length
                ? `<div class="climate-modes">
              <div class="climate-modes-label" id="climate-mode-label">${utils.escapeHtml(t('Mode'))}</div>
              <div class="climate-mode-buttons" id="climate-mode-buttons" role="group" aria-labelledby="climate-mode-label" data-chip-group="mode"></div>
            </div>`
                : ''
            }
            ${
              availableFanModes.length
                ? `
              <div class="climate-modes">
                <div class="climate-modes-label" id="climate-fan-label">${utils.escapeHtml(t('Fan'))}</div>
                <div class="climate-option-buttons" id="climate-fan-buttons" role="group" aria-labelledby="climate-fan-label" data-chip-group="fan"></div>
              </div>
            `
                : ''
            }
            ${
              availablePresetModes.length
                ? `
              <div class="climate-modes">
                <div class="climate-modes-label" id="climate-preset-label">${utils.escapeHtml(t('Preset'))}</div>
                <div class="climate-option-buttons" id="climate-preset-buttons" role="group" aria-labelledby="climate-preset-label" data-chip-group="preset"></div>
              </div>
            `
                : ''
            }
            ${
              hasControls
                ? ''
                : `<p class="climate-controls-unavailable">${utils.escapeHtml(t('This climate entity does not advertise controls that Home Assistant can safely change.'))}</p>`
            }
          </div>
        </div>
        <div class="modal-footer">
          <button class="btn btn-secondary" id="climate-cancel">${utils.escapeHtml(t('Close'))}</button>
        </div>
      </div>
    `;
    document.body.appendChild(modal);
    applyCloseButtonIcons(modal);
    activateAccessibleDialogModal(modal, {
      titleIdPrefix: 'climate-title',
      dismiss: () => closeModal(),
      initialFocus: startOnHeading(modal, focusSelector),
      replaces,
    });

    const slider = modal.querySelector('#climate-slider');
    const targetValue = modal.querySelector('#climate-target-value');
    const currentTempValue = modal.querySelector('.climate-current-temp .climate-temp-value');
    const rangeController = bindClimateRangeControls(
      modal,
      climateEntity,
      capabilities,
      (range) => {
        targetValue.textContent = `${formatNumber(range.low)}–${formatMeasurement(range.high, tempUnit)}`;
      }
    );
    const closeBtn = modal.querySelector('#climate-close');
    const cancelBtn = modal.querySelector('#climate-cancel');
    const modeButtonsContainer = modal.querySelector('#climate-mode-buttons');
    const fanButtonsContainer = modal.querySelector('#climate-fan-buttons');
    const presetButtonsContainer = modal.querySelector('#climate-preset-buttons');

    // Line icon names for the HVAC modes.
    function getModeIcon(mode) {
      const icons = {
        off: 'power',
        heat: 'flame',
        cool: 'snowflake',
        auto: 'refresh-cw',
        heat_cool: 'refresh-cw',
        fan_only: 'fan',
        dry: 'droplet',
      };
      return icons[mode] || 'settings';
    }

    function formatModeLabel(mode) {
      const normalizedMode = String(mode ?? '').trim();
      if (!normalizedMode) return t('Mode');
      const knownLabel = CLIMATE_OPTION_LABELS[normalizedMode.toLowerCase()];
      if (knownLabel) return t(knownLabel);
      return titleCase(normalizedMode.replace(/[_-]+/g, ' '));
    }

    if (modeButtonsContainer) {
      availableModes.forEach((mode) => {
        const modeValue = String(mode ?? '');
        const modeLabel = formatModeLabel(modeValue);
        const button = document.createElement('button');
        button.className = `climate-mode-btn ${modeValue === currentMode ? 'active' : ''}`.trim();
        button.dataset.mode = modeValue;
        button.title = modeLabel;
        button.setAttribute('aria-pressed', String(modeValue === currentMode));

        const icon = document.createElement('span');
        icon.className = 'climate-mode-icon';
        icon.appendChild(createLineIcon(getModeIcon(modeValue)));
        button.appendChild(icon);

        const label = document.createElement('span');
        label.className = 'climate-mode-label';
        label.textContent = modeLabel;
        button.appendChild(label);

        modeButtonsContainer.appendChild(button);
      });
    }
    const modeButtons = modal.querySelectorAll('.climate-mode-btn');

    function createClimateOptionButtons(container, modes, currentValue, className) {
      if (!container) return;
      modes.forEach((mode) => {
        const modeValue = String(mode ?? '');
        const modeLabel = formatModeLabel(modeValue);
        const button = document.createElement('button');
        button.className = `${className} ${modeValue === currentValue ? 'active' : ''}`.trim();
        button.dataset.mode = modeValue;
        button.title = modeLabel;
        button.setAttribute('aria-pressed', String(modeValue === currentValue));
        button.textContent = modeLabel;
        container.appendChild(button);
      });
    }

    createClimateOptionButtons(
      fanButtonsContainer,
      availableFanModes,
      currentFanMode,
      'climate-fan-mode-btn'
    );
    createClimateOptionButtons(
      presetButtonsContainer,
      availablePresetModes,
      currentPresetMode,
      'climate-preset-mode-btn'
    );
    const fanModeButtons = modal.querySelectorAll('.climate-fan-mode-btn');
    const presetModeButtons = modal.querySelectorAll('.climate-preset-mode-btn');
    // After the mode, fan-mode and preset buttons exist, so they are disabled too.
    showUnavailableDialogState(modal, climateEntity);
    let confirmedTargetTemp = targetTemp;
    let confirmedMode = currentMode;
    let confirmedFanMode = currentFanMode;
    let confirmedPresetMode = currentPresetMode;
    let temperatureDebounceTimer = null;
    let temperatureCommandsInFlight = 0;
    let optionCommandsInFlight = 0;
    let missedLiveUpdate = false;
    const setActiveClimateOption = (buttons, value) => {
      buttons.forEach((button) => {
        const isActive = button.getAttribute('data-mode') === value;
        button.classList.toggle('active', isActive);
        button.setAttribute('aria-pressed', String(isActive));
      });
    };

    // Close handlers
    let isClosing = false;
    const closeModal = () => {
      if (isClosing) return;
      isClosing = true;
      entityDetailClosers.delete(closeModal);
      climateDialogRefreshers.delete(climateEntity.entity_id);
      if (temperatureDebounceTimer) clearTimeout(temperatureDebounceTimer);
      rangeController?.cancel();
      void uiUtils.closeDialog(modal, { remove: true });
    };
    // An account or server change closes this dialog with its timers and subscription.
    entityDetailClosers.add(closeModal);
    const controlSignature = (value) =>
      JSON.stringify([
        value.canSetTemperature,
        value.canSetRange,
        value.minTemp,
        value.maxTemp,
        value.temperatureStep,
      ]);
    climateDialogRefreshers.set(climateEntity.entity_id, (nextEntity) => {
      if (isClosing) return;
      const next = getClimateControlCapabilities(nextEntity);
      if (controlSignature(next) !== controlSignature(capabilities)) {
        const focused = modal.contains(document.activeElement) ? document.activeElement : null;
        // Mode, fan and preset chips share `data-mode`, so the group says which chip it was.
        const group = focused?.closest?.('[data-chip-group]')?.dataset.chipGroup;
        const nextFocusSelector = focused?.id
          ? `#${focused.id}`
          : focused?.dataset?.mode !== undefined && group
            ? `[data-chip-group="${group}"] [data-mode="${focused.dataset.mode}"]`
            : null;
        isClosing = true;
        clearTimeout(temperatureDebounceTimer);
        rangeController?.cancel();
        climateDialogRefreshers.delete(climateEntity.entity_id);
        entityDetailClosers.delete(closeModal);
        showClimateControls(nextEntity, { replaces: modal, focusSelector: nextFocusSelector });
        modal.remove();
      } else {
        rangeController?.sync({ low: next.targetLow, high: next.targetHigh });
        setActiveClimateOption(modeButtons, nextEntity.state);
        if (optionCommandsInFlight === 0) {
          setActiveClimateOption(fanModeButtons, String(nextEntity.attributes?.fan_mode || ''));
          setActiveClimateOption(
            presetModeButtons,
            String(nextEntity.attributes?.preset_mode || '')
          );
        }
        if (currentTempValue) {
          currentTempValue.textContent =
            next.currentTemp === null ? '—' : formatMeasurement(next.currentTemp, tempUnit);
        }
        missedLiveUpdate = temperatureCommandsInFlight > 0;
        if (slider && next.targetTemp !== null && !missedLiveUpdate && !temperatureDebounceTimer) {
          confirmedTargetTemp = next.targetTemp;
          if (document.activeElement !== slider) {
            slider.value = String(next.targetTemp);
            if (targetValue) {
              targetValue.textContent = formatMeasurement(next.targetTemp, tempUnit);
            }
          }
        }
        showUnavailableDialogState(modal, nextEntity);
      }
    });
    if (closeBtn) closeBtn.onclick = closeModal;
    if (cancelBtn) cancelBtn.onclick = closeModal;

    // Animate in
    setTimeout(() => modal.classList.add('modal-open'), 10);

    // Temperature slider behavior with debounce
    if (slider) {
      slider.addEventListener('input', (e) => {
        const value = parseFloat(e.target.value);
        if (targetValue) targetValue.textContent = formatMeasurement(value, tempUnit);

        clearTimeout(temperatureDebounceTimer);
        temperatureDebounceTimer = setTimeout(() => {
          temperatureDebounceTimer = null;
          temperatureCommandsInFlight += 1;
          callServiceWithUiRollback(
            climateEntity,
            'climate',
            'set_temperature',
            {
              entity_id: climateEntity.entity_id,
              temperature: value,
            },
            () => {
              slider.value = String(confirmedTargetTemp);
              if (targetValue) {
                targetValue.textContent = formatMeasurement(confirmedTargetTemp, tempUnit);
              }
            }
          ).then(({ ok }) => {
            temperatureCommandsInFlight -= 1;
            if (ok) confirmedTargetTemp = value;
            // Apply a state Home Assistant pushed while this change was pending.
            const latest = state.STATES?.[climateEntity.entity_id];
            if (missedLiveUpdate && latest)
              climateDialogRefreshers.get(climateEntity.entity_id)?.(latest);
          });
        }, 300);
      });
    }

    // A focused slider skips live updates; catch up once the user leaves it.
    slider?.addEventListener('blur', () => {
      const latest = state.STATES?.[climateEntity.entity_id];
      if (latest) climateDialogRefreshers.get(climateEntity.entity_id)?.(latest);
    });

    // Mode button handlers
    modeButtons.forEach((btn) => {
      btn.addEventListener('click', () => {
        const mode = btn.getAttribute('data-mode');
        clearTimeout(temperatureDebounceTimer);
        temperatureDebounceTimer = null;
        rangeController?.cancel();

        // Update UI immediately
        setActiveClimateOption(modeButtons, mode);

        // Call service
        callServiceWithUiRollback(
          climateEntity,
          'climate',
          'set_hvac_mode',
          {
            entity_id: climateEntity.entity_id,
            hvac_mode: mode,
          },
          () => setActiveClimateOption(modeButtons, confirmedMode)
        ).then(({ ok }) => {
          if (ok) confirmedMode = mode;
        });
      });
    });

    fanModeButtons.forEach((btn) => {
      btn.addEventListener('click', () => {
        const mode = btn.getAttribute('data-mode');
        setActiveClimateOption(fanModeButtons, mode);
        optionCommandsInFlight += 1;
        callServiceWithUiRollback(
          climateEntity,
          'climate',
          'set_fan_mode',
          {
            entity_id: climateEntity.entity_id,
            fan_mode: mode,
          },
          () => setActiveClimateOption(fanModeButtons, confirmedFanMode)
        ).then(({ ok }) => {
          optionCommandsInFlight -= 1;
          if (ok) confirmedFanMode = mode;
        });
      });
    });

    presetModeButtons.forEach((btn) => {
      btn.addEventListener('click', () => {
        const mode = btn.getAttribute('data-mode');
        setActiveClimateOption(presetModeButtons, mode);
        optionCommandsInFlight += 1;
        callServiceWithUiRollback(
          climateEntity,
          'climate',
          'set_preset_mode',
          {
            entity_id: climateEntity.entity_id,
            preset_mode: mode,
          },
          () => setActiveClimateOption(presetModeButtons, confirmedPresetMode)
        ).then(({ ok }) => {
          optionCommandsInFlight -= 1;
          if (ok) confirmedPresetMode = mode;
        });
      });
    });

    // Close on backdrop click
  } catch (error) {
    console.error('Error showing climate controls:', error);
  }
}

function showFanControls(fanEntity) {
  try {
    const capabilities = getDesktopPinCapabilities(fanEntity);
    const name = utils.escapeHtml(utils.getEntityDisplayName(fanEntity));
    const currentSpeedValue = Number(fanEntity.attributes.percentage);
    const currentSpeed = Number.isFinite(currentSpeedValue)
      ? Math.max(0, Math.min(100, Math.round(currentSpeedValue)))
      : 0;
    const isOn = fanEntity.state === 'on';

    const modal = document.createElement('div');
    modal.className = 'modal fan-modal';
    modal.innerHTML = `
      <div class="modal-content fan-modal-content">
        <div class="modal-header">
          <h2>${name}</h2>
          <button class="close-btn" id="fan-close" type="button" title="${escapeHtmlAttribute(t('Close'))}" aria-label="${escapeHtmlAttribute(t('Close'))}">×</button>
        </div>
        <div class="modal-body">
          <div class="fan-content">
            <div class="fan-icon-wrapper">
              <div class="fan-icon ${isOn ? 'spinning' : ''}" id="fan-icon">${lineIconMarkup('fan')}</div>
            </div>
            <div class="fan-speed-value" id="fan-speed-value">${capabilities.canSetPercentage ? formatPercent(currentSpeed) : utils.escapeHtml(getLocalizedEntityStateLabel(fanEntity.state))}</div>
            <div class="fan-speed-label">${utils.escapeHtml(capabilities.canSetPercentage ? t('Fan Speed') : t('State'))}</div>

            ${
              capabilities.canSetPercentage
                ? `<div class="fan-slider-wrapper">
              <input
                type="range"
                min="0"
                max="100"
                step="1"
                value="${currentSpeed}"
                id="fan-slider"
                class="fan-slider"
                aria-label="${escapeHtmlAttribute(t('Fan Speed'))}"
              />
            </div>

            <div class="fan-presets">
              <button class="fan-preset-btn" data-speed="0">${utils.escapeHtml(t('Off'))}</button>
              <button class="fan-preset-btn" data-speed="33">${utils.escapeHtml(t('Low'))}</button>
              <button class="fan-preset-btn" data-speed="66">${utils.escapeHtml(t('Medium'))}</button>
              <button class="fan-preset-btn" data-speed="100">${utils.escapeHtml(t('High'))}</button>
            </div>`
                : `<p class="control-capability-note">${utils.escapeHtml(t('This fan only turns on and off.'))}</p>`
            }
          </div>
        </div>
        <div class="modal-footer">
          <button class="btn btn-secondary" id="fan-cancel">${utils.escapeHtml(t('Close'))}</button>
          ${
            capabilities.canSetPercentage
              ? ''
              : `<button class="btn btn-primary" id="fan-power">${utils.escapeHtml(isOn ? t('Turn Off') : t('Turn On'))}</button>`
          }
        </div>
      </div>
    `;
    document.body.appendChild(modal);
    applyCloseButtonIcons(modal);
    activateAccessibleDialogModal(modal, {
      titleIdPrefix: 'fan-title',
      dismiss: () => closeModal(),
      initialFocus: startOnHeading(modal),
    });
    showUnavailableDialogState(modal, fanEntity);

    const slider = modal.querySelector('#fan-slider');
    const speedValue = modal.querySelector('#fan-speed-value');
    const fanIcon = modal.querySelector('#fan-icon');
    const closeBtn = modal.querySelector('#fan-close');
    const cancelBtn = modal.querySelector('#fan-cancel');
    const presetButtons = modal.querySelectorAll('.fan-preset-btn');
    let confirmedSpeed = currentSpeed;
    let speedDebounceTimer = null;
    let fanCommandRevision = 0;
    let fanCommandsInFlight = 0;
    let missedLiveUpdate = false;
    const callFanService = (service, data, rollback) => {
      const revision = ++fanCommandRevision;
      fanCommandsInFlight += 1;
      return callServiceWithUiRollback(fanEntity, 'fan', service, data, () => {
        if (revision === fanCommandRevision) rollback?.();
      }).then((result) => {
        fanCommandsInFlight -= 1;
        // Apply a state Home Assistant pushed while this command was pending, after its handler.
        if (missedLiveUpdate) setTimeout(() => syncFromEntity(state.STATES?.[fanEntity.entity_id]));
        return { ...result, ok: result.ok && revision === fanCommandRevision };
      });
    };

    // Close handlers
    let isClosing = false;
    let unsubscribe = () => {};
    const closeModal = () => {
      if (isClosing) return;
      isClosing = true;
      entityDetailClosers.delete(closeModal);
      unsubscribe();
      if (speedDebounceTimer) clearTimeout(speedDebounceTimer);
      void uiUtils.closeDialog(modal, { remove: true });
    };
    // An account or server change closes this dialog with its timers and subscription.
    entityDetailClosers.add(closeModal);
    if (closeBtn) closeBtn.onclick = closeModal;
    if (cancelBtn) cancelBtn.onclick = closeModal;
    const powerBtn = modal.querySelector('#fan-power');
    if (powerBtn) {
      powerBtn.onclick = () => {
        toggleEntity(state.STATES?.[fanEntity.entity_id] || fanEntity);
        closeModal();
      };
    }

    // Animate in
    setTimeout(() => modal.classList.add('modal-open'), 10);

    // Update icon based on speed
    const updateIcon = (speed) => {
      if (!fanIcon) return;
      if (speed > 0) {
        fanIcon.classList.add('spinning');
      } else {
        fanIcon.classList.remove('spinning');
      }
    };

    // Slider behavior with debounce
    if (slider) {
      slider.addEventListener('input', (e) => {
        const speed = parseInt(e.target.value, 10);
        if (speedValue) speedValue.textContent = formatPercent(speed);
        updateIcon(speed);

        clearTimeout(speedDebounceTimer);
        speedDebounceTimer = setTimeout(() => {
          speedDebounceTimer = null;
          const service = speed > 0 ? 'set_percentage' : 'turn_off';
          const serviceData =
            speed > 0
              ? { entity_id: fanEntity.entity_id, percentage: speed }
              : { entity_id: fanEntity.entity_id };
          callFanService(service, serviceData, () => {
            slider.value = String(confirmedSpeed);
            if (speedValue) speedValue.textContent = formatPercent(confirmedSpeed);
            updateIcon(confirmedSpeed);
          }).then(({ ok }) => {
            if (ok) confirmedSpeed = speed;
          });
        }, 200);
      });
    }

    // Follow Home Assistant while open, but never under a pending command or a focused slider.
    const syncFromEntity = (nextEntity) => {
      if (!modal.isConnected || isClosing) {
        unsubscribe();
        return;
      }
      if (!nextEntity) return;
      syncFanControls(nextEntity);
      // After the values, which would otherwise write over "Unavailable".
      showUnavailableDialogState(modal, nextEntity);
    };
    const syncFanControls = (nextEntity) => {
      if (powerBtn) {
        powerBtn.textContent = nextEntity.state === 'on' ? t('Turn Off') : t('Turn On');
      }
      missedLiveUpdate = fanCommandsInFlight > 0;
      if (missedLiveUpdate || speedDebounceTimer) return;
      const percentage = Number(nextEntity.attributes?.percentage);
      const speed =
        nextEntity.state === 'on' && Number.isFinite(percentage)
          ? Math.max(0, Math.min(100, Math.round(percentage)))
          : 0;
      if (!slider) {
        if (speedValue) speedValue.textContent = getLocalizedEntityStateLabel(nextEntity.state);
        updateIcon(nextEntity.state === 'on' ? 1 : 0);
        return;
      }
      confirmedSpeed = speed;
      if (document.activeElement === slider) return;
      slider.value = String(speed);
      if (speedValue) speedValue.textContent = formatPercent(speed);
      updateIcon(speed);
    };
    unsubscribe = state.subscribeEntity(fanEntity.entity_id, syncFromEntity);
    // A focused slider was skipped above; catch up once the user leaves it.
    slider?.addEventListener('blur', () => syncFromEntity(state.STATES?.[fanEntity.entity_id]));

    // Preset buttons
    presetButtons.forEach((btn) => {
      btn.addEventListener('click', () => {
        const speed = parseInt(btn.getAttribute('data-speed'), 10);
        if (slider) {
          slider.value = String(speed);
          slider.dispatchEvent(new Event('input', { bubbles: true }));
        }
      });
    });

    // Close on backdrop click
  } catch (error) {
    console.error('Error showing fan controls:', error);
  }
}

function showCoverControls(coverEntity) {
  try {
    const capabilities = getDesktopPinCapabilities(coverEntity);
    const availableActions = [
      capabilities.canClose
        ? { action: 'close_cover', icon: lineIconMarkup('chevron-down'), label: t('Close') }
        : null,
      capabilities.canStop
        ? { action: 'stop_cover', icon: lineIconMarkup('pause'), label: t('Stop') }
        : null,
      capabilities.canOpen
        ? {
            action: 'open_cover',
            icon: lineIconMarkup('chevron-up'),
            label: translateInContext('Action: Open', 'Open'),
          }
        : null,
    ].filter(Boolean);
    const name = utils.escapeHtml(utils.getEntityDisplayName(coverEntity));
    const currentPositionValue = Number(coverEntity.attributes.current_position);
    const currentPosition = Number.isFinite(currentPositionValue)
      ? Math.max(0, Math.min(100, Math.round(currentPositionValue)))
      : 0;
    const _state = coverEntity.state;

    const modal = document.createElement('div');
    modal.className = 'modal cover-modal';
    modal.innerHTML = `
      <div class="modal-content cover-modal-content">
        <div class="modal-header">
          <h2>${name}</h2>
          <button class="close-btn" id="cover-close" type="button" title="${escapeHtmlAttribute(t('Close'))}" aria-label="${escapeHtmlAttribute(t('Close'))}">×</button>
        </div>
        <div class="modal-body">
          <div class="cover-content">
            <div class="cover-visual">
              <div class="cover-icon-container">
                <div class="cover-icon" id="cover-icon">${entityIconMarkup(coverEntity)}</div>
                <div class="cover-overlay" id="cover-overlay" style="height: ${100 - currentPosition}%"></div>
              </div>
            </div>
            <div class="cover-position-value" id="cover-position-value">${capabilities.canSetPosition ? formatPercent(currentPosition) : utils.escapeHtml(getLocalizedEntityStateLabel(coverEntity.state))}</div>
            <div class="cover-position-label">${utils.escapeHtml(capabilities.canSetPosition ? t('Position') : t('State'))}</div>

            ${
              capabilities.canSetPosition
                ? `<div class="cover-slider-wrapper">
              <input
                type="range"
                min="0"
                max="100"
                step="1"
                value="${currentPosition}"
                id="cover-slider"
                class="cover-slider"
                aria-label="${escapeHtmlAttribute(t('Cover position'))}"
              />
              <div class="cover-slider-labels">
                <span>${utils.escapeHtml(t('Closed'))}</span>
                <span>${utils.escapeHtml(t('Open'))}</span>
              </div>
            </div>`
                : ''
            }

            ${
              availableActions.length
                ? `<div class="cover-actions">
              ${availableActions
                .map(
                  ({ action, icon, label }) => `
                <button class="cover-action-btn" type="button" data-action="${action}">
                  <span class="cover-action-icon">${icon}</span>
                  <span class="cover-action-label">${utils.escapeHtml(label)}</span>
                </button>`
                )
                .join('')}
            </div>`
                : `<p class="control-capability-note">${utils.escapeHtml(t("This cover can't be moved from here."))}</p>`
            }
          </div>
        </div>
        <div class="modal-footer">
          <button class="btn btn-secondary" id="cover-cancel">${utils.escapeHtml(t('Close'))}</button>
        </div>
      </div>
    `;
    document.body.appendChild(modal);
    applyCloseButtonIcons(modal);
    activateAccessibleDialogModal(modal, {
      titleIdPrefix: 'cover-title',
      dismiss: () => closeModal(),
      initialFocus: startOnHeading(modal),
    });
    showUnavailableDialogState(modal, coverEntity);

    const slider = modal.querySelector('#cover-slider');
    const positionValue = modal.querySelector('#cover-position-value');
    const coverOverlay = modal.querySelector('#cover-overlay');
    const closeBtn = modal.querySelector('#cover-close');
    const cancelBtn = modal.querySelector('#cover-cancel');
    const actionButtons = modal.querySelectorAll('.cover-action-btn');
    let confirmedPosition = currentPosition;
    let positionDebounceTimer = null;
    let coverCommandRevision = 0;
    let coverCommandsInFlight = 0;
    let missedLiveUpdate = false;
    const callCoverService = (service, data, rollback) => {
      const revision = ++coverCommandRevision;
      coverCommandsInFlight += 1;
      return callServiceWithUiRollback(coverEntity, 'cover', service, data, () => {
        if (revision === coverCommandRevision) rollback?.();
      }).then((result) => {
        coverCommandsInFlight -= 1;
        // Apply a state Home Assistant pushed while this command was pending, after its handler.
        if (missedLiveUpdate) {
          setTimeout(() => syncFromEntity(state.STATES?.[coverEntity.entity_id]));
        }
        return { ...result, ok: result.ok && revision === coverCommandRevision };
      });
    };

    // Close handlers
    let isClosing = false;
    let unsubscribe = () => {};
    const closeModal = () => {
      if (isClosing) return;
      isClosing = true;
      entityDetailClosers.delete(closeModal);
      unsubscribe();
      if (positionDebounceTimer) clearTimeout(positionDebounceTimer);
      void uiUtils.closeDialog(modal, { remove: true });
    };
    // An account or server change closes this dialog with its timers and subscription.
    entityDetailClosers.add(closeModal);
    if (closeBtn) closeBtn.onclick = closeModal;
    if (cancelBtn) cancelBtn.onclick = closeModal;

    // Animate in
    setTimeout(() => modal.classList.add('modal-open'), 10);

    // Update visual overlay based on position
    const updateVisual = (position) => {
      if (coverOverlay) {
        coverOverlay.style.height = `${100 - position}%`;
      }
    };

    // Slider behavior with debounce
    if (slider) {
      slider.addEventListener('input', (e) => {
        const position = parseInt(e.target.value, 10);
        if (positionValue) positionValue.textContent = formatPercent(position);
        updateVisual(position);

        clearTimeout(positionDebounceTimer);
        positionDebounceTimer = setTimeout(() => {
          positionDebounceTimer = null;
          callCoverService(
            'set_cover_position',
            {
              entity_id: coverEntity.entity_id,
              position: position,
            },
            () => {
              slider.value = String(confirmedPosition);
              if (positionValue) positionValue.textContent = formatPercent(confirmedPosition);
              updateVisual(confirmedPosition);
            }
          ).then(({ ok }) => {
            if (ok) confirmedPosition = position;
          });
        }, 300);
      });
    }

    // Action buttons
    actionButtons.forEach((btn) => {
      btn.addEventListener('click', () => {
        clearTimeout(positionDebounceTimer);
        positionDebounceTimer = null;
        const action = btn.getAttribute('data-action');
        const previousPosition = confirmedPosition;

        // Visual feedback
        if (action === 'open_cover' && slider) {
          slider.value = '100';
          if (positionValue) positionValue.textContent = formatPercent(100);
          updateVisual(100);
        } else if (action === 'close_cover' && slider) {
          slider.value = '0';
          if (positionValue) positionValue.textContent = formatPercent(0);
          updateVisual(0);
        }
        callCoverService(action, { entity_id: coverEntity.entity_id }, () => {
          if (slider) slider.value = String(previousPosition);
          if (positionValue) positionValue.textContent = formatPercent(previousPosition);
          updateVisual(previousPosition);
        }).then(({ ok }) => {
          if (!ok) return;
          if (action === 'open_cover') confirmedPosition = 100;
          if (action === 'close_cover') confirmedPosition = 0;
        });
      });
    });

    // Follow Home Assistant while open (e.g. where Stop left the cover), but never under a
    // pending command or a focused slider.
    const syncFromEntity = (nextEntity) => {
      if (!modal.isConnected || isClosing) {
        unsubscribe();
        return;
      }
      if (!nextEntity) return;
      syncCoverControls(nextEntity);
      // After the values, which would otherwise write over "Unavailable".
      showUnavailableDialogState(modal, nextEntity);
    };
    const syncCoverControls = (nextEntity) => {
      missedLiveUpdate = coverCommandsInFlight > 0;
      if (missedLiveUpdate || positionDebounceTimer) return;
      if (!slider) {
        if (positionValue)
          positionValue.textContent = getLocalizedEntityStateLabel(nextEntity.state);
        return;
      }
      const position = Number(nextEntity.attributes?.current_position);
      if (nextEntity.attributes?.current_position == null || !Number.isFinite(position)) return;
      confirmedPosition = Math.max(0, Math.min(100, Math.round(position)));
      if (document.activeElement === slider) return;
      slider.value = String(confirmedPosition);
      if (positionValue) positionValue.textContent = formatPercent(confirmedPosition);
      updateVisual(confirmedPosition);
    };
    unsubscribe = state.subscribeEntity(coverEntity.entity_id, syncFromEntity);
    // A focused slider was skipped above; catch up once the user leaves it.
    slider?.addEventListener('blur', () => syncFromEntity(state.STATES?.[coverEntity.entity_id]));

    // Close on backdrop click
  } catch (error) {
    console.error('Error showing cover controls:', error);
  }
}

// Opening the dialog starts a fresh search; a rebuild after Add or Remove keeps the search, and
// focus on the same row's button.
function populateQuickControlsList({ resetSearch = true } = {}) {
  try {
    const list = document.getElementById('quick-controls-list');
    const searchInput = document.getElementById('quick-controls-search');
    const targetHint = document.getElementById('quick-controls-target-hint');
    if (!list) return;
    const pageSize = 50;
    if (resetSearch) list.dataset.page = '0';
    let page = Number(list.dataset.page) || 0;
    let searchTimer = null;
    let pager = document.getElementById('quick-controls-pagination');
    if (!pager) {
      pager = document.createElement('div');
      pager.id = 'quick-controls-pagination';
      pager.className = 'entity-selector-pagination';
      list.after(pager);
    }
    const previous = document.createElement('button');
    previous.type = 'button';
    previous.className = 'btn btn-secondary btn-sm';
    previous.textContent = t('Previous');
    const count = document.createElement('span');
    count.className = 'entity-selector-pagination-status';
    count.setAttribute('role', 'status');
    const next = document.createElement('button');
    next.type = 'button';
    next.className = 'btn btn-secondary btn-sm';
    next.textContent = t('Next');
    pager.replaceChildren(previous, count, next);

    const renderList = () => {
      const filter = searchInput ? searchInput.value.toLowerCase() : '';
      const config = ensureQuickAccessConfig();
      const activeTab = getActiveQuickAccessTab(config);

      if (targetHint) {
        targetHint.textContent = t('Adding to: {{name}}', { name: activeTab?.name || '' });
      }

      // Score and filter entities
      const scoredEntities = Object.values(state.STATES)
        .filter((e) => !e.entity_id.startsWith('sun.') && !e.entity_id.startsWith('zone.'))
        .map((entity) => {
          if (!filter) {
            return { entity, score: 1 };
          }
          // Search both display name and entity ID
          const nameScore = utils.getSearchScore(utils.getEntityDisplayName(entity), filter);
          const idScore = utils.getSearchScore(entity.entity_id, filter);
          return { entity, score: nameScore + idScore };
        })
        .filter((item) => item.score > 0)
        .sort((a, b) => {
          // Sort by score first, then alphabetically
          if (b.score !== a.score) {
            return b.score - a.score;
          }
          return compareNames(
            utils.getEntityDisplayName(a.entity),
            utils.getEntityDisplayName(b.entity)
          );
        });

      const pages = Math.max(1, Math.ceil(scoredEntities.length / pageSize));
      page = Math.min(page, pages - 1);
      list.dataset.page = String(page);
      const pageNumbers = { page: formatNumber(page + 1), pages: formatNumber(pages) };
      count.textContent =
        scoredEntities.length === 1
          ? t('Page {{page}} of {{pages}} · 1 entity', pageNumbers)
          : t('Page {{page}} of {{pages}} · {{count}} entities', {
              ...pageNumbers,
              count: formatNumber(scoredEntities.length),
            });
      previous.setAttribute('aria-disabled', String(page === 0));
      next.setAttribute('aria-disabled', String(page >= pages - 1));
      previous.onclick = () => {
        if (page > 0) {
          page -= 1;
          renderList();
        }
      };
      next.onclick = () => {
        if (page < pages - 1) {
          page += 1;
          renderList();
        }
      };
      pager.hidden = scoredEntities.length <= pageSize;
      list.innerHTML = '';
      if (!scoredEntities.length) {
        const empty = document.createElement('p');
        empty.className = 'entity-selector-empty';
        empty.textContent = t('No matching entities');
        list.appendChild(empty);
        return;
      }

      scoredEntities.slice(page * pageSize, (page + 1) * pageSize).forEach(({ entity }) => {
        const item = document.createElement('div');
        item.className = 'entity-item';

        const isOverlayDemo = isDevelopmentClimateOverlayEntity(entity.entity_id);
        const isInActiveView = isOverlayDemo || activeTab?.entityIds.includes(entity.entity_id);

        const main = document.createElement('div');
        main.className = 'entity-item-main';

        const icon = document.createElement('span');
        icon.className = 'entity-icon';
        renderEntityIcon(icon, entity);

        const info = document.createElement('div');
        info.className = 'entity-item-info';

        const name = document.createElement('span');
        name.className = 'entity-name';
        name.textContent = utils.getEntityDisplayName(entity);

        const id = document.createElement('span');
        id.className = 'entity-id';
        id.title = entity.entity_id;
        id.textContent = entity.entity_id;

        info.appendChild(name);
        info.appendChild(id);
        main.appendChild(icon);
        main.appendChild(info);

        item.classList.toggle('is-added', !!isInActiveView && !isOverlayDemo);

        const actions = document.createElement('div');
        actions.className = 'entity-item-actions quick-access-entity-actions';

        const button = document.createElement('button');
        button.type = 'button';
        button.className = `entity-selector-btn ${isInActiveView ? 'remove' : 'add'}`;
        button.dataset.entityId = entity.entity_id;
        button.textContent = isOverlayDemo
          ? t('Development demo')
          : isInActiveView
            ? t('Remove')
            : t('Add');
        button.disabled = isOverlayDemo;
        button.onclick = isOverlayDemo ? null : () => toggleQuickAccess(entity.entity_id);

        actions.appendChild(button);

        item.appendChild(main);
        item.appendChild(actions);

        list.appendChild(item);
      });
    };

    if (searchInput && resetSearch) searchInput.value = '';
    const focusedEntityId = list.contains(document.activeElement)
      ? document.activeElement.dataset.entityId
      : null;
    renderList();
    if (focusedEntityId) {
      const button = [...list.querySelectorAll('.entity-selector-btn')].find(
        (candidate) => candidate.dataset.entityId === focusedEntityId
      );
      (button || searchInput)?.focus();
    }

    // Set up search with proper scoring
    if (searchInput) {
      searchInput.oninput = () => {
        clearTimeout(searchTimer);
        searchTimer = setTimeout(() => {
          page = 0;
          renderList();
        }, 150);
      };
      // Note: Focus is managed by trapFocus() in renderer.js when modal opens
    }
  } catch (error) {
    console.error('Error populating quick controls list:', error);
  }
}

function toggleQuickAccess(entityId) {
  try {
    if (isDevelopmentClimateOverlayEntity(entityId)) return;
    const config = ensureQuickAccessConfig();
    const activeTab = getActiveQuickAccessTab(config);
    // Page-scoped: a duplicated page shares entities with its original, so ticking or unticking
    // here must not touch any other page.
    const nextConfig = activeTab?.entityIds.includes(entityId)
      ? removeEntityFromQuickAccessView(config, entityId, activeTab.id)
      : addEntityToQuickAccessView(config, entityId, activeTab?.id);
    setQuickAccessConfig(nextConfig);
  } catch (error) {
    console.error('Error toggling quick access:', error);
  }
}

let updateStatusRender = null;

// Re-renders the Settings update status line in the current language.
function relocalizeUpdateStatus() {
  const updateStatusText = document.getElementById('update-status-text');
  if (updateStatusText && updateStatusRender) updateStatusText.textContent = updateStatusRender();
}

function initUpdateUI() {
  try {
    // Use version injected by Vite at build time
    const version = typeof __APP_VERSION__ !== 'undefined' ? __APP_VERSION__ : 'dev';

    // Set current version
    const currentVersionEl = document.getElementById('current-version');
    if (currentVersionEl) {
      currentVersionEl.textContent = version;
    }

    // The button labels are owned here (ids on the i18n guardrail's dynamic list).
    const checkUpdatesLabel = document.getElementById('check-updates-text');
    if (checkUpdatesLabel) checkUpdatesLabel.textContent = t('Check for updates');
    const installUpdateLabel = document.getElementById('install-update-text');
    if (installUpdateLabel) installUpdateLabel.textContent = t('Install update');

    // Wire up check for updates button
    const checkUpdatesBtn = document.getElementById('check-updates-btn');
    const updateStatusText = document.getElementById('update-status-text');
    const installUpdateBtn = document.getElementById('install-update-btn');
    const updateProgress = document.getElementById('update-progress');
    const progressFill = document.getElementById('progress-fill');
    const progressText = document.getElementById('progress-text');
    let portableDownloadUrl = null;
    // Keep how the status line was produced so a language change can re-render it.
    const showUpdateStatus = (render) => {
      updateStatusRender = render;
      if (updateStatusText) updateStatusText.textContent = render();
    };

    // Disabling the button while a check runs drops keyboard focus to <body>, and enabling it again
    // does not bring it back; this does, as the entity switches in Settings do.
    let reenableCheckUpdates = null;
    const setCheckUpdatesDisabled = (disabled) => {
      if (!checkUpdatesBtn) return;
      if (disabled) {
        reenableCheckUpdates ??= uiUtils.disableControlsKeepingFocus([checkUpdatesBtn]);
        return;
      }
      if (reenableCheckUpdates) reenableCheckUpdates();
      else checkUpdatesBtn.disabled = false;
      reenableCheckUpdates = null;
    };

    // Enable the check button
    if (checkUpdatesBtn) {
      checkUpdatesBtn.disabled = false;
      checkUpdatesBtn.onclick = async () => {
        // Disable button and show checking status
        setCheckUpdatesDisabled(true);
        showUpdateStatus(() => t('Checking for updates...'));

        try {
          const result = await window.electronAPI.checkForUpdates();
          if (result.status === 'dev') {
            // In development mode, auto-updater doesn't work
            showUpdateStatus(() => t('Auto-updates only work in packaged builds'));
            setCheckUpdatesDisabled(false);
          } else if (result.status === 'portable' || result.status === 'manual') {
            portableDownloadUrl = result.downloadUrl || null;
            showUpdateStatus(
              () => result.message || t('Portable builds do not support in-app updates.')
            );
            setCheckUpdatesDisabled(false);
            if (installUpdateBtn) {
              if (portableDownloadUrl) {
                installUpdateBtn.textContent =
                  result.status === 'manual' ? t('Download Update') : t('Download Portable Update');
                installUpdateBtn.classList.remove('hidden');
              } else {
                installUpdateBtn.classList.add('hidden');
              }
            }
            if (updateProgress) updateProgress.classList.add('hidden');
          } else if (result.status === 'none') {
            portableDownloadUrl = null;
            showUpdateStatus(() => result.message || t('You are up to date!'));
            setCheckUpdatesDisabled(false);
            if (installUpdateBtn) installUpdateBtn.classList.add('hidden');
            if (updateProgress) updateProgress.classList.add('hidden');
          } else if (result.status === 'error') {
            portableDownloadUrl = null;
            showUpdateStatus(() =>
              t('Error: {{error}}', {
                error: result.error || t('Unknown error'),
              })
            );
            setCheckUpdatesDisabled(false);
            if (installUpdateBtn) installUpdateBtn.classList.add('hidden');
            if (updateProgress) updateProgress.classList.add('hidden');
          }
          // In packaged mode, the auto-update events will update the UI
          // The button will be re-enabled by the event handlers
        } catch (error) {
          console.error('Error checking for updates:', error);
          showUpdateStatus(() => t('Error checking for updates'));
          setCheckUpdatesDisabled(false);
        }
      };
    }

    // Wire up install button
    if (installUpdateBtn) {
      installUpdateBtn.onclick = () => {
        if (portableDownloadUrl) {
          window.electronAPI.openExternal(portableDownloadUrl);
        } else {
          window.electronAPI.quitAndInstall();
        }
      };
    }

    // Listen for auto-update events from main process
    if (typeof unsubscribeAutoUpdate === 'function') {
      unsubscribeAutoUpdate();
      unsubscribeAutoUpdate = null;
    }
    const disposeAutoUpdateListener = window.electronAPI.onAutoUpdate((data) => {
      try {
        if (!data) return;

        switch (data.status) {
          case 'checking':
            portableDownloadUrl = null;
            showUpdateStatus(() => t('Checking for updates...'));
            setCheckUpdatesDisabled(true);
            if (installUpdateBtn) installUpdateBtn.classList.add('hidden');
            if (updateProgress) updateProgress.classList.add('hidden');
            break;

          case 'available':
            portableDownloadUrl = null;
            showUpdateStatus(() =>
              t('Update available: v{{version}}', { version: data.info?.version || 'unknown' })
            );
            setCheckUpdatesDisabled(false);
            if (updateProgress) updateProgress.classList.remove('hidden');
            break;

          case 'none':
            portableDownloadUrl = null;
            showUpdateStatus(() => t('You are up to date!'));
            setCheckUpdatesDisabled(false);
            if (installUpdateBtn) installUpdateBtn.classList.add('hidden');
            if (updateProgress) updateProgress.classList.add('hidden');
            break;

          case 'downloading':
            portableDownloadUrl = null;
            showUpdateStatus(() => t('Downloading update...'));
            setCheckUpdatesDisabled(true);
            if (updateProgress) updateProgress.classList.remove('hidden');
            if (data.progress) {
              const percent = Math.round(data.progress.percent);
              if (progressFill) progressFill.style.width = `${percent}%`;
              if (progressText) progressText.textContent = formatPercent(percent);
            }
            break;

          case 'downloaded':
            portableDownloadUrl = null;
            showUpdateStatus(() =>
              t('Update v{{version}} ready to install', {
                version: data.info?.version || 'unknown',
              })
            );
            setCheckUpdatesDisabled(false);
            if (installUpdateBtn) {
              installUpdateBtn.textContent = t('Install update');
              installUpdateBtn.classList.remove('hidden');
            }
            if (updateProgress) updateProgress.classList.add('hidden');
            break;

          case 'error':
            portableDownloadUrl = null;
            showUpdateStatus(() =>
              t('Error: {{error}}', {
                error: data.error || t('Unknown error'),
              })
            );
            setCheckUpdatesDisabled(false);
            if (installUpdateBtn) installUpdateBtn.classList.add('hidden');
            if (updateProgress) updateProgress.classList.add('hidden');
            break;

          case 'portable':
          case 'manual':
            portableDownloadUrl = data.downloadUrl || null;
            showUpdateStatus(
              () => data.message || t('Portable builds do not support in-app updates.')
            );
            setCheckUpdatesDisabled(false);
            if (installUpdateBtn) {
              if (portableDownloadUrl) {
                installUpdateBtn.textContent =
                  data.status === 'manual' ? t('Download Update') : t('Download Portable Update');
                installUpdateBtn.classList.remove('hidden');
              } else {
                installUpdateBtn.classList.add('hidden');
              }
            }
            if (updateProgress) updateProgress.classList.add('hidden');
            break;
        }
      } catch (error) {
        console.error('Error handling auto-update event:', error);
      }
    });
    if (typeof disposeAutoUpdateListener === 'function') {
      unsubscribeAutoUpdate = disposeAutoUpdateListener;
    }

    // Initialize with ready status
    showUpdateStatus(() => t('Ready to check for updates'));
  } catch (error) {
    console.error('Error initializing update UI:', error);
  }
}

// ESC key handler for reorganize mode
function handleEscapeKey(e) {
  if (e.key !== 'Escape' || !isReorganizeMode) return;
  // Escape belongs to whatever is on top of the dashboard: a key a control or dialog already used,
  // an open dialog (the dialog helper closes it and stops the key, but a dialog opened any other
  // way would still reach here), or an inline rename in the page tabs.
  if (e.defaultPrevented || uiUtils.hasOpenDialog()) return;
  if (document.querySelector('#quick-access-tabs .qa-tab-rename-input')) return;
  if (pickedUpTile?.isConnected) {
    e.preventDefault();
    e.stopPropagation();
    clearPickedUpTile();
    return;
  }
  e.preventDefault();
  e.stopPropagation();
  toggleReorganizeMode();
}

function addEscapeKeyListener() {
  document.addEventListener('keydown', handleEscapeKey);
}

function removeEscapeKeyListener() {
  document.removeEventListener('keydown', handleEscapeKey);
}

export {
  requestAlarmCode,
  ensureEntityCacheScope,
  showAddPageModal,
  restoreDashboard,
  renderActiveTab,
  updateEntityInUI,
  getQuickAccessTileChartType,
  getQuickAccessTileGaugeRange,
  setQuickAccessTileChartType,
  setQuickAccessTileGaugeRange,
  isEntityInTray,
  updateWeatherFromHA,
  updateWeatherEffects,
  populateWeatherEntitiesList,
  selectWeatherEntity,
  initUpdateUI,
  relocalizeUpdateStatus,
  updateTimeDisplay,
  startTimeTicker,
  stopTimeTicker,
  updateTimerDisplays,
  renderPrimaryCards,
  toggleReorganizeMode,
  exitReorganizeMode,
  populateQuickControlsList,
  addComparisonGraphTile,
  isEntityVisible,
  getTickTargets,
  refreshVisibleEntityCache,
  executeHotkeyAction,
  executeEntityPrimaryAction,
  openEntityControls,
  describeQuickAccessTile,
  getCalendarDescriptionText,
  getQuickAccessTileControls,
  executeQuickAccessControl,
  openEntityDetailModal,
  hasEntityAction,
  describeServiceErrorMessage,
  isConnectionServiceError,
  getEntityDomain,
  handleDesktopPinActionRequest,
  renderDesktopPinnedTile,
  getDesktopPinTickTargets,
  updateDesktopPinLiveDisplays,
  updateMediaTile,
  updateMediaSeekBar,
  callMediaTileService,
  callMediaPlayerService,
  getMediaSeekTarget,
  getTodoActiveCount,
  switchQuickAccessPage,
};

/**
 * Renderer side of tray entity icons.
 *
 * Main owns one Tray per configured entity but has neither a canvas nor the live state map, so
 * the renderer draws each icon (a short text label at every tray scale factor) and ships PNG
 * data URLs over IPC. Updates are debounced per entity and skipped when nothing visible changed.
 */
import log from './logger.js';
import state from './state.js';
import * as utils from './utils.js';
import trayEntities from './tray-entities.cjs';
import { t, getLocaleState } from './i18n.js';

const TRAY_ICON_UPDATE_DEBOUNCE_MS = 250;
const TRAY_ICON_RETRY_MS = 2000;
const TRAY_ICON_FONT_FAMILY =
  '"Segoe UI", system-ui, -apple-system, "Helvetica Neue", Arial, sans-serif';
const TRAY_ICON_COLORS = Object.freeze({
  dark: Object.freeze({
    neutral: '#ffffff',
    on: '#4ade80',
    off: '#b0b7c3',
    unavailable: '#fbbf24',
    blue: '#93c5fd',
    cyan: '#67e8f9',
    purple: '#d8b4fe',
    pink: '#f9a8d4',
    orange: '#fdba74',
    outline: 'rgba(0, 0, 0, 0.85)',
  }),
  light: Object.freeze({
    neutral: '#1f2937',
    on: '#15803d',
    off: '#6b7280',
    unavailable: '#b45309',
    blue: '#1d4ed8',
    cyan: '#0e7490',
    purple: '#7e22ce',
    pink: '#be185d',
    orange: '#c2410c',
    outline: 'rgba(255, 255, 255, 0.92)',
  }),
});

let electronAPI = null;
let connectionIsLive = false;
let liveEntityIds = null;
let generation = 0;
let platform = '';
let iconSize = trayEntities.getTrayIconSizeForPlatform('');
let createCanvas = null;
let colorSchemeQuery = null;
let colorSchemeListener = null;
const pendingUpdates = new Map();
const publishedSignatures = new Map();

function defaultCreateCanvas(width, height) {
  if (typeof document === 'undefined') return null;
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  return canvas;
}

function getCanvasContext(canvas) {
  try {
    return canvas?.getContext?.('2d') || null;
  } catch {
    return null;
  }
}

export function initTrayEntityIcons({
  electronAPI: api = null,
  platform: platformName = '',
  createCanvas: canvasFactory = null,
  connected = false,
} = {}) {
  disposeTrayEntityIcons();
  connectionIsLive = !!connected;
  electronAPI = api && typeof api.updateTrayEntityIcon === 'function' ? api : null;
  platform = platformName || api?.platform || '';
  iconSize = trayEntities.getTrayIconSizeForPlatform(platform);
  createCanvas = typeof canvasFactory === 'function' ? canvasFactory : defaultCreateCanvas;
  if (typeof window !== 'undefined' && typeof window.matchMedia === 'function') {
    try {
      colorSchemeQuery = window.matchMedia('(prefers-color-scheme: dark)');
      colorSchemeListener = () => refreshTrayEntityIcons({ force: true });
      colorSchemeQuery?.addEventListener?.('change', colorSchemeListener);
    } catch {
      colorSchemeQuery = null;
      colorSchemeListener = null;
    }
  }
  return !!electronAPI;
}

export function disposeTrayEntityIcons() {
  generation += 1;
  connectionIsLive = false;
  liveEntityIds = null;
  pendingUpdates.forEach((pending) => clearTimeout(pending.timer));
  pendingUpdates.clear();
  publishedSignatures.clear();
  if (colorSchemeQuery && colorSchemeListener) {
    colorSchemeQuery.removeEventListener?.('change', colorSchemeListener);
  }
  colorSchemeQuery = null;
  colorSchemeListener = null;
  electronAPI = null;
}

/** A socket reconnect is not live until its replacement state snapshot arrives. */
export function setTrayEntityConnectionState(connected, entityIds = null) {
  if (Array.isArray(entityIds)) liveEntityIds = new Set(entityIds);
  if (!connected) liveEntityIds = null;
  if (connectionIsLive === !!connected && !Array.isArray(entityIds)) return;
  connectionIsLive = !!connected;
  generation += 1;
  pendingUpdates.forEach((pending) => clearTimeout(pending.timer));
  pendingUpdates.clear();
  trayEntities.getTrayEntityIds(state.CONFIG).forEach((entityId) => {
    void publishTrayEntityIcon(entityId, { force: true });
  });
}

/** The tray sits on the OS shell, so its colors follow the OS scheme rather than the app theme. */
export function getTrayColorScheme() {
  try {
    let matches;
    if (colorSchemeQuery) {
      matches = colorSchemeQuery.matches;
    } else if (typeof window !== 'undefined' && typeof window.matchMedia === 'function') {
      matches = window.matchMedia('(prefers-color-scheme: dark)')?.matches;
    }
    return matches === false ? 'light' : 'dark';
  } catch {
    return 'dark';
  }
}

function buildFont(fontSize, scaleFactor) {
  const px = (fontSize * scaleFactor * iconSize) / 16;
  return `700 ${px.toFixed(2)}px ${TRAY_ICON_FONT_FAMILY}`;
}

function createMeasureFunction() {
  const canvas = createCanvas ? createCanvas(iconSize, iconSize) : null;
  const ctx = getCanvasContext(canvas);
  if (!ctx || typeof ctx.measureText !== 'function') {
    return (text, fontSize) => (Array.from(text).length * fontSize * 0.62 * iconSize) / 16;
  }
  return (text, fontSize) => {
    ctx.font = buildFont(fontSize, 1);
    return ctx.measureText(text).width;
  };
}

/**
 * Draw `text` at every tray scale factor and return PNG data URLs, or [] when no 2D context is
 * available (main then keeps the placeholder icon and only updates the tooltip).
 */
export function renderTrayIconRepresentations({ text, fontSize, accent, scheme, color }) {
  const colors = TRAY_ICON_COLORS[scheme] || TRAY_ICON_COLORS.dark;
  const fill =
    colors[accent === 'unavailable' ? accent : color] || colors[accent] || colors.neutral;
  const representations = [];

  for (const scaleFactor of trayEntities.TRAY_ICON_SCALE_FACTORS) {
    const px = Math.round(iconSize * scaleFactor);
    const canvas = createCanvas ? createCanvas(px, px) : null;
    const ctx = getCanvasContext(canvas);
    if (!ctx) return [];

    ctx.clearRect(0, 0, px, px);
    ctx.font = buildFont(fontSize, scaleFactor);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.lineJoin = 'round';
    ctx.lineWidth = Math.max(1.5, (2.2 * scaleFactor * iconSize) / 16);
    ctx.strokeStyle = colors.outline;
    ctx.fillStyle = fill;
    const x = px / 2;
    const y = px / 2 + px * 0.04;
    ctx.strokeText(text, x, y);
    ctx.fillText(text, x, y);

    let dataURL = '';
    try {
      dataURL = canvas.toDataURL('image/png');
    } catch {
      dataURL = '';
    }
    if (typeof dataURL !== 'string' || !dataURL.startsWith('data:image/png')) return [];
    representations.push({ scaleFactor, dataURL });
  }
  return representations;
}

function describeTrayEntity(entityId) {
  const entity =
    !liveEntityIds || liveEntityIds.has(entityId) ? state.STATES?.[entityId] || null : null;
  const options = trayEntities.normalizeTrayEntityOptions(state.CONFIG?.trayEntities?.[entityId]);
  const name = entity
    ? utils.getEntityDisplayName(entity)
    : state.CONFIG?.customEntityNames?.[entityId] || entityId;
  const displayName = options.label ? `${options.label} · ${name}` : name;
  const isTimer = entityId.startsWith('timer.');
  const remaining = entity && isTimer ? utils.getTimerRemainingSeconds(entity) : null;
  const presentation = trayEntities.buildTrayEntityPresentation(
    connectionIsLive && entity
      ? entity
      : { entity_id: entityId, state: 'unavailable', attributes: {} },
    {
      displayName,
      timerRemainingSeconds: remaining,
      temperatureUnit: state.UNIT_SYSTEM?.temperature,
      translate: t,
      locale: getLocaleState().activeLocale,
    }
  );
  if (!connectionIsLive) {
    presentation.candidates = ['--'];
    presentation.valueText = t('Offline');
    presentation.tooltip = `${displayName}: ${t('Offline')}`;
  }
  const layout =
    platform === 'darwin'
      ? { text: presentation.valueText, fontSize: 12 }
      : trayEntities.chooseTrayLabelLayout(presentation.candidates, createMeasureFunction(), {
          maxWidth: iconSize - 2,
        });
  // A native macOS title has room for units and a name; bitmap trays keep their tiny value.
  const label =
    platform === 'darwin' && options.label ? `${options.label}: ${layout.text}` : layout.text;
  return {
    entityId,
    label,
    fontSize: layout.fontSize,
    tooltip: presentation.tooltip,
    accent: presentation.accent,
    color: options.color,
    isActiveTimer:
      connectionIsLive && !!entity && isTimer && entity.state === 'active' && remaining > 0,
  };
}

function renderRepresentationsFor(description, scheme) {
  if (platform === 'darwin') return [];
  return renderTrayIconRepresentations({
    text: description.label,
    fontSize: description.fontSize,
    accent: description.accent,
    color: description.color,
    scheme,
  });
}

/**
 * Build the IPC payload for one entity. Exposed for tests and diagnostics.
 */
export function buildTrayEntityIconPayload(entityId, { scheme = getTrayColorScheme() } = {}) {
  const description = describeTrayEntity(entityId);
  return {
    entityId,
    label: description.label,
    tooltip: description.tooltip,
    representations: renderRepresentationsFor(description, scheme),
    activeTimer: description.isActiveTimer,
  };
}

function cancelPendingUpdate(entityId) {
  const pending = pendingUpdates.get(entityId);
  if (!pending) return;
  clearTimeout(pending.timer);
  pendingUpdates.delete(entityId);
}

function scheduleTrayEntityIconUpdate(
  entityId,
  { force = false, delayMs = TRAY_ICON_UPDATE_DEBOUNCE_MS } = {}
) {
  if (!electronAPI) return;
  if (
    delayMs === TRAY_ICON_UPDATE_DEBOUNCE_MS &&
    typeof document !== 'undefined' &&
    document.hidden
  ) {
    cancelPendingUpdate(entityId);
    void publishTrayEntityIcon(entityId, { force });
    return;
  }
  const pending = pendingUpdates.get(entityId);
  const dueAt = Date.now() + delayMs;
  if (pending) {
    force = pending.force || force;
    if (pending.dueAt <= dueAt) {
      pending.force = force;
      return;
    }
    clearTimeout(pending.timer);
  }
  const entry = { force, dueAt, timer: null };
  entry.timer = setTimeout(() => {
    pendingUpdates.delete(entityId);
    void publishTrayEntityIcon(entityId, { force: entry.force });
  }, delayMs);
  pendingUpdates.set(entityId, entry);
}

async function publishTrayEntityIcon(entityId, { force = false } = {}) {
  if (!electronAPI || !trayEntities.isTrayEntity(state.CONFIG, entityId)) return null;

  const publishGeneration = generation;
  const scheme = getTrayColorScheme();
  const description = describeTrayEntity(entityId);
  const signature = JSON.stringify([
    description.label,
    description.tooltip,
    description.accent,
    description.color,
    description.isActiveTimer,
    scheme,
  ]);

  if (!force && publishedSignatures.get(entityId) === signature) {
    return null;
  }

  const payload = {
    entityId,
    label: description.label,
    tooltip: description.tooltip,
    representations: renderRepresentationsFor(description, scheme),
    activeTimer: description.isActiveTimer,
  };
  publishedSignatures.set(entityId, signature);
  let failed = false;
  try {
    const result = await electronAPI.updateTrayEntityIcon(payload);
    if (result && result.success === false) {
      failed = true;
      if (publishGeneration === generation) publishedSignatures.delete(entityId);
      log.debug?.(`Tray icon update for ${entityId} was not applied: ${result.error || 'unknown'}`);
    }
    return result;
  } catch (error) {
    failed = true;
    if (publishGeneration === generation) publishedSignatures.delete(entityId);
    log.warn('Failed to update tray entity icon:', error);
    return null;
  } finally {
    if (
      failed &&
      publishGeneration === generation &&
      trayEntities.isTrayEntity(state.CONFIG, entityId)
    ) {
      scheduleTrayEntityIconUpdate(entityId, { delayMs: TRAY_ICON_RETRY_MS });
    }
  }
}

/** IPC clocks run in main so hidden renderers do not need unthrottled timers or animations. */
export function tickTrayEntityIcon(entityId) {
  return publishTrayEntityIcon(entityId);
}

/** Called for every entity state change; cheap when the entity is not in the tray. */
export function handleTrayEntityStateChange(entityId) {
  if (connectionIsLive && liveEntityIds && state.STATES?.[entityId]) liveEntityIds.add(entityId);
  if (!electronAPI || !entityId || !trayEntities.isTrayEntity(state.CONFIG, entityId)) return;
  scheduleTrayEntityIconUpdate(entityId);
}

/** Re-render every configured tray entity, e.g. after a fresh state snapshot. */
export function refreshTrayEntityIcons({ force = false } = {}) {
  if (!electronAPI) return;
  trayEntities.getTrayEntityIds(state.CONFIG).forEach((entityId) => {
    scheduleTrayEntityIconUpdate(entityId, { force });
  });
}

/** Reconcile pending and published icons against the current config. */
export function syncTrayEntityIconsWithConfig() {
  if (!electronAPI) return;
  const configured = new Set(trayEntities.getTrayEntityIds(state.CONFIG));
  [...publishedSignatures.keys(), ...pendingUpdates.keys()].forEach((entityId) => {
    if (configured.has(entityId)) return;
    cancelPendingUpdate(entityId);
    publishedSignatures.delete(entityId);
  });
  configured.forEach((entityId) => {
    scheduleTrayEntityIconUpdate(entityId);
  });
}

export function hasPendingTrayEntityIconUpdates() {
  return pendingUpdates.size > 0;
}

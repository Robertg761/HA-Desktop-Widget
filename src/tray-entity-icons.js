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

const TRAY_ICON_UPDATE_DEBOUNCE_MS = 250;
const TRAY_ICON_TIMER_TICK_MS = 30 * 1000;
const TRAY_ICON_FONT_FAMILY =
  '"Segoe UI", system-ui, -apple-system, "Helvetica Neue", Arial, sans-serif';
const TRAY_ICON_COLORS = Object.freeze({
  dark: Object.freeze({
    neutral: '#ffffff',
    on: '#4ade80',
    off: '#b0b7c3',
    unavailable: '#fbbf24',
    outline: 'rgba(0, 0, 0, 0.85)',
  }),
  light: Object.freeze({
    neutral: '#1f2937',
    on: '#15803d',
    off: '#6b7280',
    unavailable: '#b45309',
    outline: 'rgba(255, 255, 255, 0.92)',
  }),
});

let electronAPI = null;
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
} = {}) {
  disposeTrayEntityIcons();
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
export function renderTrayIconRepresentations({ text, fontSize, accent, scheme }) {
  const colors = TRAY_ICON_COLORS[scheme] || TRAY_ICON_COLORS.dark;
  const fill = colors[accent] || colors.neutral;
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
  const entity = state.STATES?.[entityId] || null;
  const fallbackName = state.CONFIG?.customEntityNames?.[entityId] || entityId;
  const isTimer = entityId.startsWith('timer.');
  const presentation = trayEntities.buildTrayEntityPresentation(
    entity || { entity_id: entityId, state: 'unavailable', attributes: {} },
    {
      displayName: entity ? utils.getEntityDisplayName(entity) : fallbackName,
      displayState: entity ? utils.getEntityDisplayState(entity) : '',
      timerRemainingSeconds:
        entity && isTimer && typeof utils.getTimerRemainingSeconds === 'function'
          ? utils.getTimerRemainingSeconds(entity)
          : null,
    }
  );
  const layout = trayEntities.chooseTrayLabelLayout(
    presentation.candidates,
    createMeasureFunction(),
    { maxWidth: iconSize - 1 }
  );
  return {
    entityId,
    label: layout.text,
    fontSize: layout.fontSize,
    tooltip: presentation.tooltip,
    accent: presentation.accent,
    isActiveTimer: !!entity && isTimer && entity.state === 'active',
  };
}

function renderRepresentationsFor(description, scheme) {
  if (platform === 'darwin') return [];
  return renderTrayIconRepresentations({
    text: description.label,
    fontSize: description.fontSize,
    accent: description.accent,
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

  const scheme = getTrayColorScheme();
  const description = describeTrayEntity(entityId);
  const signature = [description.label, description.tooltip, description.accent, scheme].join('|');
  const scheduleTimerTick = () => {
    // Timers count down without emitting state changes, so an active timer re-renders on a
    // slow tick to keep the remaining time roughly honest.
    if (description.isActiveTimer) {
      scheduleTrayEntityIconUpdate(entityId, { delayMs: TRAY_ICON_TIMER_TICK_MS });
    }
  };

  if (!force && publishedSignatures.get(entityId) === signature) {
    scheduleTimerTick();
    return null;
  }

  const payload = {
    entityId,
    label: description.label,
    tooltip: description.tooltip,
    representations: renderRepresentationsFor(description, scheme),
  };
  publishedSignatures.set(entityId, signature);
  try {
    const result = await electronAPI.updateTrayEntityIcon(payload);
    if (result && result.success === false) {
      publishedSignatures.delete(entityId);
      log.debug?.(`Tray icon update for ${entityId} was not applied: ${result.error || 'unknown'}`);
    }
    return result;
  } catch (error) {
    publishedSignatures.delete(entityId);
    log.warn('Failed to update tray entity icon:', error);
    return null;
  } finally {
    scheduleTimerTick();
  }
}

/** Called for every entity state change; cheap when the entity is not in the tray. */
export function handleTrayEntityStateChange(entityId) {
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
    if (!publishedSignatures.has(entityId)) {
      scheduleTrayEntityIconUpdate(entityId, { force: true });
    }
  });
}

export function hasPendingTrayEntityIconUpdates() {
  return pendingUpdates.size > 0;
}

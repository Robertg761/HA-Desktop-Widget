/* global module, require */

const DESKTOP_PIN_DEFAULT_BOUNDS = { width: 168, height: 148 };
const DESKTOP_PIN_WIDE_BOUNDS = { width: 328, height: 156 };
const DESKTOP_PIN_TINY_MIN_BOUNDS = { width: 140, height: 110 };
const DESKTOP_PIN_SMALL_ACTION_MIN_BOUNDS = { width: 156, height: 122 };
const DESKTOP_PIN_DENSE_MIN_BOUNDS = { width: 168, height: 148 };
const DESKTOP_PIN_MEDIA_MIN_BOUNDS = { width: 260, height: 148 };
const DESKTOP_PIN_SCENE_MIN_BOUNDS = { width: 97, height: 83 };
// The "Text and control size" steps; pin content zooms by the same factor as the main window.
const DESKTOP_PIN_UI_SCALES = [1, 1.15, 1.3, 1.5];
const { resolveDesktopPinProfile } = require('./desktop-pin-support.cjs');

function normalizeDesktopPinScale(scale) {
  const number = Number(scale);
  return DESKTOP_PIN_UI_SCALES.includes(number) ? number : 1;
}

// Rounds up so zoomed content still fits; the epsilon absorbs float noise such as 120 * 1.15.
function scaleDesktopPinSize(size, scale = 1) {
  const factor = normalizeDesktopPinScale(scale);
  return {
    width: Math.ceil(size.width * factor - 1e-6),
    height: Math.ceil(size.height * factor - 1e-6),
  };
}

function normalizeEntityId(entityId) {
  if (typeof entityId !== 'string') return '';
  return entityId.trim();
}

function getDesktopPinDomain(entityId = '') {
  const normalizedEntityId = normalizeEntityId(entityId);
  if (!normalizedEntityId) return '';
  const [domain = ''] = normalizedEntityId.split('.');
  return domain;
}

function getDesktopPinBaseBounds(entityId = '', scale = 1) {
  return scaleDesktopPinSize(
    getDesktopPinDomain(entityId) === 'media_player'
      ? DESKTOP_PIN_WIDE_BOUNDS
      : DESKTOP_PIN_DEFAULT_BOUNDS,
    scale
  );
}

function getDesktopPinMinBounds(entityId = '', scale = 1) {
  return scaleDesktopPinSize(getUnscaledDesktopPinMinBounds(entityId), scale);
}

function getUnscaledDesktopPinMinBounds(entityId = '') {
  const domain = getDesktopPinDomain(entityId);
  if (domain === 'scene') {
    return { ...DESKTOP_PIN_SCENE_MIN_BOUNDS };
  }
  if (domain === 'script') {
    return { ...DESKTOP_PIN_TINY_MIN_BOUNDS };
  }

  switch (resolveDesktopPinProfile(entityId).family) {
    case 'scene':
      return { ...DESKTOP_PIN_SCENE_MIN_BOUNDS };
    case 'sensor':
    case 'timer':
      return { ...DESKTOP_PIN_TINY_MIN_BOUNDS };
    case 'light':
    case 'fan':
    case 'climate':
    case 'cover':
    case 'weather':
    case 'numeric':
    case 'enum':
      return { ...DESKTOP_PIN_DENSE_MIN_BOUNDS };
    case 'vacuum':
      return { ...DESKTOP_PIN_SMALL_ACTION_MIN_BOUNDS };
    case 'media':
      return { ...DESKTOP_PIN_MEDIA_MIN_BOUNDS };
    case 'toggle':
    case 'action':
    case 'camera':
    case 'presence':
    case 'unsupported':
    default:
      return { ...DESKTOP_PIN_SMALL_ACTION_MIN_BOUNDS };
  }
}

function roundFinite(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.round(number) : fallback;
}

function normalizeDesktopPinContentMinBounds(bounds = null) {
  if (!bounds || typeof bounds !== 'object') return null;
  const width = roundFinite(bounds.width, NaN);
  const height = roundFinite(bounds.height, NaN);
  if (!Number.isFinite(width) || !Number.isFinite(height)) return null;
  if (width <= 0 || height <= 0) return null;
  return { width, height };
}

// Content minimums are CSS pixels at 100%, like the domain minimums they extend.
function resolveDesktopPinMinBounds(entityId = '', contentMinBounds = null, scale = 1) {
  const baseMinBounds = getDesktopPinMinBounds(entityId, scale);
  let normalizedContentMinBounds = normalizeDesktopPinContentMinBounds(contentMinBounds);
  if (!normalizedContentMinBounds) {
    return { ...baseMinBounds };
  }
  normalizedContentMinBounds = scaleDesktopPinSize(normalizedContentMinBounds, scale);

  return {
    width: Math.max(baseMinBounds.width, normalizedContentMinBounds.width),
    height: Math.max(baseMinBounds.height, normalizedContentMinBounds.height),
  };
}

function inferResizeAnchors(bounds = {}, previousBounds = {}) {
  const nextX = Number(bounds.x);
  const nextY = Number(bounds.y);
  const nextWidth = Number(bounds.width);
  const nextHeight = Number(bounds.height);
  const prevX = Number(previousBounds.x);
  const prevY = Number(previousBounds.y);
  const prevWidth = Number(previousBounds.width);
  const prevHeight = Number(previousBounds.height);

  return {
    anchorRight:
      Number.isFinite(nextX) &&
      Number.isFinite(nextWidth) &&
      Number.isFinite(prevX) &&
      Number.isFinite(prevWidth) &&
      nextX !== prevX &&
      nextWidth !== prevWidth,
    anchorBottom:
      Number.isFinite(nextY) &&
      Number.isFinite(nextHeight) &&
      Number.isFinite(prevY) &&
      Number.isFinite(prevHeight) &&
      nextY !== prevY &&
      nextHeight !== prevHeight,
  };
}

function clampDesktopPinBounds(
  bounds = {},
  {
    entityId = '',
    contentMinBounds = null,
    fallbackOrigin = { x: 0, y: 0 },
    workArea = { x: 0, y: 0, width: 1280, height: 720 },
    previousBounds = null,
    scale = 1,
  } = {}
) {
  const baseBounds = getDesktopPinBaseBounds(entityId, scale);
  const minBounds = resolveDesktopPinMinBounds(entityId, contentMinBounds, scale);
  const safeWorkArea = {
    x: roundFinite(workArea?.x, 0),
    y: roundFinite(workArea?.y, 0),
    width: Math.max(1, roundFinite(workArea?.width, 1280)),
    height: Math.max(1, roundFinite(workArea?.height, 720)),
  };

  let width = roundFinite(bounds.width, baseBounds.width);
  let height = roundFinite(bounds.height, baseBounds.height);
  let x = roundFinite(bounds.x, roundFinite(fallbackOrigin?.x, safeWorkArea.x));
  let y = roundFinite(bounds.y, roundFinite(fallbackOrigin?.y, safeWorkArea.y));

  const rawRight = x + width;
  const rawBottom = y + height;
  const { anchorRight, anchorBottom } = inferResizeAnchors(bounds, previousBounds || {});

  width = Math.max(minBounds.width, Math.min(width, safeWorkArea.width));
  height = Math.max(minBounds.height, Math.min(height, safeWorkArea.height));

  if (anchorRight) {
    x = rawRight - width;
  }
  if (anchorBottom) {
    y = rawBottom - height;
  }

  const maxX = safeWorkArea.x + Math.max(0, safeWorkArea.width - width);
  const maxY = safeWorkArea.y + Math.max(0, safeWorkArea.height - height);

  x = Math.min(Math.max(x, safeWorkArea.x), maxX);
  y = Math.min(Math.max(y, safeWorkArea.y), maxY);

  return { x, y, width, height };
}

/**
 * Native window bounds for saved pin bounds at a given interface scale.
 *
 * Saved bounds keep the pin's size at 100% and its screen position, so changing the scale never
 * rewrites them: the window grows or shrinks from the saved top-left corner and is only nudged
 * back inside the work area for display, and returning to 100% restores the saved window exactly.
 */
function getDesktopPinWindowBounds(bounds = {}, options = {}) {
  const scale = normalizeDesktopPinScale(options.scale);
  const width = Number(bounds?.width);
  const height = Number(bounds?.height);
  const scaledSize =
    Number.isFinite(width) && Number.isFinite(height)
      ? scaleDesktopPinSize({ width, height }, scale)
      : {};
  return clampDesktopPinBounds(
    { x: bounds?.x, y: bounds?.y, ...scaledSize },
    { ...options, previousBounds: null, scale }
  );
}

module.exports = {
  DESKTOP_PIN_DEFAULT_BOUNDS,
  DESKTOP_PIN_WIDE_BOUNDS,
  DESKTOP_PIN_TINY_MIN_BOUNDS,
  DESKTOP_PIN_SMALL_ACTION_MIN_BOUNDS,
  DESKTOP_PIN_DENSE_MIN_BOUNDS,
  DESKTOP_PIN_MEDIA_MIN_BOUNDS,
  DESKTOP_PIN_SCENE_MIN_BOUNDS,
  DESKTOP_PIN_UI_SCALES,
  normalizeEntityId,
  normalizeDesktopPinScale,
  getDesktopPinDomain,
  getDesktopPinBaseBounds,
  getDesktopPinMinBounds,
  normalizeDesktopPinContentMinBounds,
  resolveDesktopPinMinBounds,
  clampDesktopPinBounds,
  getDesktopPinWindowBounds,
};

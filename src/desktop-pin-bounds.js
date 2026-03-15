/* eslint-env node */
/* global module */

const DESKTOP_PIN_DEFAULT_BOUNDS = { width: 168, height: 148 };
const DESKTOP_PIN_WIDE_BOUNDS = { width: 328, height: 156 };
const DESKTOP_PIN_TINY_MIN_BOUNDS = { width: 140, height: 110 };
const DESKTOP_PIN_SMALL_ACTION_MIN_BOUNDS = { width: 156, height: 122 };
const DESKTOP_PIN_DENSE_MIN_BOUNDS = { width: 168, height: 148 };
const DESKTOP_PIN_MEDIA_MIN_BOUNDS = { width: 260, height: 148 };
const DESKTOP_PIN_SCENE_MIN_BOUNDS = { width: 36, height: 56 };

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

function getDesktopPinBaseBounds(entityId = '') {
  return getDesktopPinDomain(entityId) === 'media_player'
    ? { ...DESKTOP_PIN_WIDE_BOUNDS }
    : { ...DESKTOP_PIN_DEFAULT_BOUNDS };
}

function getDesktopPinMinBounds(entityId = '') {
  switch (getDesktopPinDomain(entityId)) {
    case 'scene':
      return { ...DESKTOP_PIN_SCENE_MIN_BOUNDS };
    case 'script':
    case 'sensor':
    case 'binary_sensor':
    case 'timer':
      return { ...DESKTOP_PIN_TINY_MIN_BOUNDS };
    case 'light':
    case 'fan':
    case 'climate':
    case 'cover':
      return { ...DESKTOP_PIN_DENSE_MIN_BOUNDS };
    case 'media_player':
      return { ...DESKTOP_PIN_MEDIA_MIN_BOUNDS };
    case 'switch':
    case 'input_boolean':
    case 'lock':
    case 'camera':
    default:
      return { ...DESKTOP_PIN_SMALL_ACTION_MIN_BOUNDS };
  }
}

function roundFinite(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.round(number) : fallback;
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
    anchorRight: Number.isFinite(nextX)
      && Number.isFinite(nextWidth)
      && Number.isFinite(prevX)
      && Number.isFinite(prevWidth)
      && nextX !== prevX
      && nextWidth !== prevWidth,
    anchorBottom: Number.isFinite(nextY)
      && Number.isFinite(nextHeight)
      && Number.isFinite(prevY)
      && Number.isFinite(prevHeight)
      && nextY !== prevY
      && nextHeight !== prevHeight,
  };
}

function clampDesktopPinBounds(bounds = {}, {
  entityId = '',
  fallbackOrigin = { x: 0, y: 0 },
  workArea = { x: 0, y: 0, width: 1280, height: 720 },
  previousBounds = null,
} = {}) {
  const baseBounds = getDesktopPinBaseBounds(entityId);
  const minBounds = getDesktopPinMinBounds(entityId);
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

module.exports = {
  DESKTOP_PIN_DEFAULT_BOUNDS,
  DESKTOP_PIN_WIDE_BOUNDS,
  DESKTOP_PIN_TINY_MIN_BOUNDS,
  DESKTOP_PIN_SMALL_ACTION_MIN_BOUNDS,
  DESKTOP_PIN_DENSE_MIN_BOUNDS,
  DESKTOP_PIN_MEDIA_MIN_BOUNDS,
  DESKTOP_PIN_SCENE_MIN_BOUNDS,
  normalizeEntityId,
  getDesktopPinDomain,
  getDesktopPinBaseBounds,
  getDesktopPinMinBounds,
  clampDesktopPinBounds,
};

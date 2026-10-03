// How far a pin window grows for a pointer drag, worked out where the pointer is.
//
// A pin's saved size is its size at 100% "Text and control size"; the window is that size times
// the scale. The pointer moves in screen pixels. Treating its distance as a change of saved size
// (or of the window's position) made the handle drift away from the pointer at 115-150%.

const RIGHT_CORNERS = new Set(['top-right', 'bottom-right']);
const BOTTOM_CORNERS = new Set(['bottom-left', 'bottom-right']);

/**
 * Pointer distances come from MouseEvent.screenX/Y, which Chromium reports either in screen pixels
 * or divided by the page zoom, depending on the platform. The window's own outer width is reported
 * in the same unit, so comparing it with the width the window really has on screen says how many
 * screen pixels one unit of pointer distance is. It is never less than 1 nor more than the scale.
 */
function getPointerScreenFactor({ scale = 1, windowWidth, outerWidth } = {}) {
  const factor = Number(scale) > 1 ? Number(scale) : 1;
  if (factor === 1 || !(windowWidth > 0) || !(outerWidth > 0)) return 1;
  return Math.min(factor, Math.max(1, windowWidth / outerWidth));
}

/**
 * The saved size a corner drag asks for.
 *
 * @param {{width: number, height: number}} startSize - Saved size when the drag began.
 * @param {string} corner - 'top-left', 'top-right', 'bottom-left' or 'bottom-right'.
 * @param {{x: number, y: number}} delta - Pointer movement since the drag began.
 * @param {{scale?: number, pointerFactor?: number}} [options] - The interface scale, and screen
 *   pixels per unit of pointer distance (getPointerScreenFactor).
 * @returns {{width: number, height: number}}
 */
function getDesktopPinResizeRequest(
  startSize,
  corner,
  delta,
  { scale = 1, pointerFactor = 1 } = {}
) {
  const factor = Number(scale) > 0 ? Number(scale) : 1;
  const screenX = (Number(delta?.x) || 0) * pointerFactor;
  const screenY = (Number(delta?.y) || 0) * pointerFactor;
  return {
    width: Math.round(startSize.width + ((RIGHT_CORNERS.has(corner) ? 1 : -1) * screenX) / factor),
    height: Math.round(
      startSize.height + ((BOTTOM_CORNERS.has(corner) ? 1 : -1) * screenY) / factor
    ),
  };
}

// An arrow key moves the handle one step the way a pointer would: towards the key's direction.
const ARROW_DELTAS = Object.freeze({
  ArrowLeft: { x: -1, y: 0 },
  ArrowRight: { x: 1, y: 0 },
  ArrowUp: { x: 0, y: -1 },
  ArrowDown: { x: 0, y: 1 },
});

function getDesktopPinResizeKeyDelta(key, { shiftKey = false } = {}) {
  const direction = ARROW_DELTAS[key];
  if (!direction) return null;
  const step = shiftKey ? 32 : 8;
  return { x: direction.x * step, y: direction.y * step };
}

module.exports = {
  getDesktopPinResizeKeyDelta,
  getDesktopPinResizeRequest,
  getPointerScreenFactor,
};

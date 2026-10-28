// How close, in px, an edge has to be dropped to a target before it snaps there.
const DESKTOP_PIN_SNAP_DISTANCE = 12;
// The spaces a pin settles at beside another pin or the screen edge: touching, or the gap the app
// leaves between pins it places itself.
const DESKTOP_PIN_SNAP_GAPS = [0, 16];

function toRect(value) {
  const rect = {
    x: Number(value?.x),
    y: Number(value?.y),
    width: Number(value?.width),
    height: Number(value?.height),
  };
  return Object.values(rect).every(Number.isFinite) && rect.width > 0 && rect.height > 0
    ? rect
    : null;
}

function overlaps(a, b) {
  return a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;
}

// Within `distance` of overlapping along the other axis: a pin is only put beside one it is level
// with, not beside one at the far end of the screen.
function isLevelWith(rect, other, axis, distance) {
  return axis === 'x'
    ? rect.y < other.y + other.height + distance && rect.y + rect.height > other.y - distance
    : rect.x < other.x + other.width + distance && rect.x + rect.width > other.x - distance;
}

// The origins along one axis that line the pin up with the others or the work area.
function getSnapTargets(rect, others, workArea, axis, { distance, gaps }) {
  const pos = axis === 'x' ? 'x' : 'y';
  const size = axis === 'x' ? 'width' : 'height';
  const targets = [];
  for (const other of others) {
    // Lined up with the other pin's start edge, end edge or middle.
    targets.push(
      other[pos],
      other[pos] + other[size] - rect[size],
      Math.round(other[pos] + (other[size] - rect[size]) / 2)
    );
    if (!isLevelWith(rect, other, axis, distance)) continue;
    for (const gap of gaps) {
      targets.push(other[pos] + other[size] + gap, other[pos] - gap - rect[size]);
    }
  }
  if (workArea) {
    for (const gap of gaps) {
      targets.push(workArea[pos] + gap, workArea[pos] + workArea[size] - rect[size] - gap);
    }
  }
  return targets;
}

function snapAxis(rect, others, workArea, axis, options) {
  const current = rect[axis];
  let best = current;
  let bestDistance = options.distance + 1;
  for (const target of getSnapTargets(rect, others, workArea, axis, options)) {
    const distance = Math.abs(target - current);
    if (distance < bestDistance) {
      best = target;
      bestDistance = distance;
    }
  }
  return best;
}

/**
 * Where a pin dropped at `rect` settles: each axis on its own moves to the nearest edge or middle
 * of another pin, beside one it is level with, or to the work area's edge, when one is within
 * `distance`. Otherwise the pin stays where it was dropped. Rectangles are window bounds on screen
 * (or all on one monitor's coordinates); pins outside the work area are not lined up with.
 *
 * @param {{x: number, y: number, width: number, height: number}} rect
 * @param {{others?: Object[], workArea?: Object|null, distance?: number, gaps?: number[]}} [options]
 * @returns {{x: number, y: number}}
 */
function snapDesktopPinPosition(
  rect,
  {
    others = [],
    workArea = null,
    distance = DESKTOP_PIN_SNAP_DISTANCE,
    gaps = DESKTOP_PIN_SNAP_GAPS,
  } = {}
) {
  const pin = toRect(rect);
  if (!pin) return { x: rect?.x, y: rect?.y };
  const area = toRect(workArea);
  const neighbours = (Array.isArray(others) ? others : [])
    .map(toRect)
    .filter((other) => other && (!area || overlaps(other, area)));
  const options = { distance, gaps };
  return {
    x: snapAxis(pin, neighbours, area, 'x', options),
    y: snapAxis(pin, neighbours, area, 'y', options),
  };
}

module.exports = {
  DESKTOP_PIN_SNAP_DISTANCE,
  DESKTOP_PIN_SNAP_GAPS,
  snapDesktopPinPosition,
};

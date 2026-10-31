// How close, in px, an edge has to be dropped to a target before it snaps there.
const DESKTOP_PIN_SNAP_DISTANCE = 12;

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

// Shares a column with `other` (for the y axis) or a row (for the x axis): the two overlap across
// the axis the pin moves along. Pins side by side in neighbouring columns do not.
function sharesLine(rect, other, axis) {
  return axis === 'y'
    ? rect.x < other.x + other.width && rect.x + rect.width > other.x
    : rect.y < other.y + other.height && rect.y + rect.height > other.y;
}

// The spaces between neighbouring pins in a column (or row): each pin and the next one after it in
// the same column. A wide pin dropped across two columns has both in its line, and the space from
// a pin in one to a pin in the other is no column's spacing.
function getLineGaps(line, axis, pos, size) {
  const gaps = new Set();
  for (const pin of line) {
    let next = null;
    for (const other of line) {
      if (other === pin || other[pos] < pin[pos] + pin[size]) continue;
      if (!sharesLine(pin, other, axis)) continue;
      if (!next || other[pos] < next[pos]) next = other;
    }
    if (next) gaps.add(next[pos] - (pin[pos] + pin[size]));
  }
  return [...gaps];
}

/**
 * The origins along one axis that line the pin up, in two tiers. The first tier wins whenever one
 * of its targets is in reach:
 *
 * 1. Another pin's start or end edge, so a column (or row) shares one straight edge; the same
 *    space from a pin in its column (or row) as already separates two pins there, so a column can
 *    be spread evenly at whatever spacing the user picked; or, for a pin dropped a little over one
 *    in its column, touching it. The nearest of these wins, an edge on a tie, so an edge of the
 *    column beside only moves a pin off its column's spacing when the pin was dropped nearer to
 *    the edge.
 * 2. Another pin's middle, or the work area's edge.
 *
 * There is no fixed space to settle at beside a pin: a pin dropped near another stays the distance
 * from it it was dropped at, so a column can be spaced to match one of a different height.
 */
function getSnapTiers(rect, others, workArea, axis) {
  const pos = axis === 'x' ? 'x' : 'y';
  const size = axis === 'x' ? 'width' : 'height';
  const edges = [];
  const spacing = [];
  const rest = [];
  for (const other of others) {
    edges.push(other[pos], other[pos] + other[size] - rect[size]);
    rest.push(Math.round(other[pos] + (other[size] - rect[size]) / 2));
  }
  const line = others.filter((other) => sharesLine(rect, other, axis));
  const gaps = getLineGaps(line, axis, pos, size);
  for (const other of line) {
    for (const gap of gaps) {
      spacing.push(other[pos] + other[size] + gap, other[pos] - gap - rect[size]);
    }
    // Dropped a little over a pin in its column: up against it instead of covering it. A pin
    // dropped clear of it keeps its space.
    if (rect[pos] < other[pos] + other[size] && rect[pos] + rect[size] > other[pos]) {
      spacing.push(other[pos] + other[size], other[pos] - rect[size]);
    }
  }
  if (workArea) {
    rest.push(workArea[pos], workArea[pos] + workArea[size] - rect[size]);
  }
  return [[...edges, ...spacing], rest];
}

function snapAxis(rect, others, workArea, axis, distance) {
  const current = rect[axis];
  for (const targets of getSnapTiers(rect, others, workArea, axis)) {
    let best = null;
    let bestDistance = distance + 1;
    for (const target of targets) {
      const offset = Math.abs(target - current);
      if (offset < bestDistance) {
        best = target;
        bestDistance = offset;
      }
    }
    if (best !== null) return best;
  }
  return current;
}

/**
 * Where a pin dropped at `rect` settles: each axis on its own moves to the best target within
 * `distance` (see getSnapTiers), the nearest one when several of the same kind are in reach.
 * Otherwise the pin stays where it was dropped. Rectangles are window bounds on screen (or all on
 * one monitor's coordinates); pins outside the work area are not lined up with.
 *
 * @param {{x: number, y: number, width: number, height: number}} rect
 * @param {{others?: Object[], workArea?: Object|null, distance?: number}} [options]
 * @returns {{x: number, y: number}}
 */
function snapDesktopPinPosition(
  rect,
  { others = [], workArea = null, distance = DESKTOP_PIN_SNAP_DISTANCE } = {}
) {
  const pin = toRect(rect);
  if (!pin) return { x: rect?.x, y: rect?.y };
  const area = toRect(workArea);
  const neighbours = (Array.isArray(others) ? others : [])
    .map(toRect)
    .filter((other) => other && (!area || overlaps(other, area)));
  return {
    x: snapAxis(pin, neighbours, area, 'x', distance),
    y: snapAxis(pin, neighbours, area, 'y', distance),
  };
}

module.exports = {
  DESKTOP_PIN_SNAP_DISTANCE,
  snapDesktopPinPosition,
};

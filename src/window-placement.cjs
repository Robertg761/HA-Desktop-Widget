// Shared geometry helpers for keeping the main window on a display the user can see.
// A saved position can point at a monitor that is no longer connected, or at empty space
// between monitors in a multi-display layout, and a window placed there is simply gone.

// How much of the window has to land on a display before its position counts as usable.
const MIN_VISIBLE_OVERLAP_PX = 48;

const FALLBACK_WORK_AREA = { x: 0, y: 0, width: 1280, height: 720 };

function toFiniteInteger(value, fallback = null) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.round(number) : fallback;
}

function isUsableWorkArea(workArea) {
  return (
    !!workArea &&
    Number.isFinite(Number(workArea.x)) &&
    Number.isFinite(Number(workArea.y)) &&
    Number(workArea.width) > 0 &&
    Number(workArea.height) > 0
  );
}

function overlapAmount(startA, sizeA, startB, sizeB) {
  return Math.min(startA + sizeA, startB + sizeB) - Math.max(startA, startB);
}

/** Does enough of `bounds` land on `workArea` for the user to see and grab the window? */
function boundsOverlapWorkArea(bounds, workArea, minOverlap = MIN_VISIBLE_OVERLAP_PX) {
  if (!isUsableWorkArea(workArea)) return false;
  const overlapWidth = overlapAmount(bounds.x, bounds.width, workArea.x, workArea.width);
  const overlapHeight = overlapAmount(bounds.y, bounds.height, workArea.y, workArea.height);
  return (
    overlapWidth >= Math.min(minOverlap, bounds.width) &&
    overlapHeight >= Math.min(minOverlap, bounds.height)
  );
}

function boundsVisibleOnAnyWorkArea(bounds, workAreas = [], minOverlap = MIN_VISIBLE_OVERLAP_PX) {
  return (workAreas || []).some((workArea) => boundsOverlapWorkArea(bounds, workArea, minOverlap));
}

function distanceBetweenCenters(bounds, workArea) {
  const dx = bounds.x + bounds.width / 2 - (workArea.x + workArea.width / 2);
  const dy = bounds.y + bounds.height / 2 - (workArea.y + workArea.height / 2);
  return Math.hypot(dx, dy);
}

/**
 * Move a position back onto a display when it no longer lands on one.
 *
 * Returns the position unchanged when it is already usable, so a window the user placed
 * deliberately, including one hanging slightly off an edge, is left alone.
 */
function clampPositionToWorkAreas(bounds = {}, workAreas = []) {
  const width = Math.max(1, toFiniteInteger(bounds.width, FALLBACK_WORK_AREA.width));
  const height = Math.max(1, toFiniteInteger(bounds.height, FALLBACK_WORK_AREA.height));
  const usableWorkAreas = (workAreas || []).filter(isUsableWorkArea);
  const x = toFiniteInteger(bounds.x);
  const y = toFiniteInteger(bounds.y);

  if (!usableWorkAreas.length) {
    return { x: x === null ? FALLBACK_WORK_AREA.x : x, y: y === null ? FALLBACK_WORK_AREA.y : y };
  }

  const target = { x: x === null ? 0 : x, y: y === null ? 0 : y, width, height };
  if (x !== null && y !== null && boundsVisibleOnAnyWorkArea(target, usableWorkAreas)) {
    return { x, y };
  }

  const nearest = usableWorkAreas.reduce((best, workArea) =>
    distanceBetweenCenters(target, workArea) < distanceBetweenCenters(target, best)
      ? workArea
      : best
  );

  const maxX = nearest.x + nearest.width - width;
  const maxY = nearest.y + nearest.height - height;
  return {
    x: Math.round(
      width >= nearest.width ? nearest.x : Math.min(Math.max(target.x, nearest.x), maxX)
    ),
    y: Math.round(
      height >= nearest.height ? nearest.y : Math.min(Math.max(target.y, nearest.y), maxY)
    ),
  };
}

module.exports = {
  MIN_VISIBLE_OVERLAP_PX,
  boundsOverlapWorkArea,
  boundsVisibleOnAnyWorkArea,
  clampPositionToWorkAreas,
};

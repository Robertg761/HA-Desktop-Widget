function getNextQuickAccessFocusIndex(
  currentIndex,
  itemCount,
  key,
  columns = 1,
  direction = 'ltr'
) {
  if (!Number.isInteger(itemCount) || itemCount <= 0) return -1;

  const normalizedCurrent = Number.isInteger(currentIndex)
    ? Math.min(Math.max(currentIndex, 0), itemCount - 1)
    : 0;
  const normalizedColumns = Math.max(1, Number.isInteger(columns) ? columns : 1);
  if (direction === 'rtl' && ['ArrowLeft', 'ArrowRight'].includes(key)) {
    key = key === 'ArrowLeft' ? 'ArrowRight' : 'ArrowLeft';
  }

  switch (key) {
    case 'ArrowLeft':
      return Math.max(0, normalizedCurrent - 1);
    case 'ArrowRight':
      return Math.min(itemCount - 1, normalizedCurrent + 1);
    case 'ArrowUp':
      return Math.max(0, normalizedCurrent - normalizedColumns);
    case 'ArrowDown':
      return Math.min(itemCount - 1, normalizedCurrent + normalizedColumns);
    case 'Home':
      return 0;
    case 'End':
      return itemCount - 1;
    default:
      return normalizedCurrent;
  }
}

// How far in from the strip's edges the active page is kept. It matches the fade drawn over a
// clipped edge, so a page that was scrolled into view is never the one under the fade.
const QUICK_ACCESS_TAB_EDGE_INSET = 20;

/**
 * Where an arrow key moves on the Quick Access grid, judged by where the tiles are on screen
 * rather than by their order in the DOM. Wide tiles (media players, graphs, tiles with a column
 * span) make the two differ: stepping one place along the DOM skips tiles or dead-ends beside
 * a wide one. Left and right stay in the row, in the direction pressed on screen (so right-to-left
 * needs no swap); up and down go to the adjacent row, to the tile under or over the current one.
 *
 * @param {Array<{left: number, right: number, top: number, bottom: number}>} rects - One box per
 *   tile, in DOM order.
 * @param {number} currentIndex - The focused tile.
 * @param {string} key - A KeyboardEvent key.
 * @returns {number} The tile to focus (the current one when nothing lies that way), or -1 when
 *   the boxes carry no layout (a hidden grid, jsdom) and the caller should count in DOM order.
 */
function getNextQuickAccessFocusIndexByLayout(rects, currentIndex, key) {
  const current = rects?.[currentIndex];
  const hasBox = (rect) => rect.right - rect.left > 0 && rect.bottom - rect.top > 0;
  if (!current || !rects.some(hasBox)) return -1;
  if (key === 'Home') return 0;
  if (key === 'End') return rects.length - 1;

  const sameRow = (rect) => Math.abs(rect.top - current.top) <= 2;
  const centerX = (rect) => (rect.left + rect.right) / 2;
  // A tile with no box (hidden, or not laid out) sits at 0,0 and would pass for the row above.
  const candidates = rects
    .map((rect, index) => ({ rect, index }))
    .filter(({ rect, index }) => index !== currentIndex && hasBox(rect));

  if (key === 'ArrowLeft' || key === 'ArrowRight') {
    const direction = key === 'ArrowLeft' ? -1 : 1;
    const ahead = candidates
      .filter(({ rect }) => sameRow(rect) && (centerX(rect) - centerX(current)) * direction > 0)
      .sort((a, b) => (centerX(a.rect) - centerX(b.rect)) * direction);
    return ahead.length ? ahead[0].index : currentIndex;
  }

  if (key === 'ArrowUp' || key === 'ArrowDown') {
    const direction = key === 'ArrowUp' ? -1 : 1;
    const inDirection = candidates.filter(
      ({ rect }) => !sameRow(rect) && (rect.top - current.top) * direction > 0
    );
    if (!inDirection.length) return currentIndex;
    // The nearest row that way, then the tile in it that overlaps the current one the most (or,
    // under a gap, the one whose centre is closest).
    const nearestTop = inDirection.reduce(
      (best, { rect }) => ((rect.top - best) * direction < 0 ? rect.top : best),
      inDirection[0].rect.top
    );
    const row = inDirection.filter(({ rect }) => Math.abs(rect.top - nearestTop) <= 2);
    const overlap = ({ rect }) =>
      Math.min(rect.right, current.right) - Math.max(rect.left, current.left);
    const distance = ({ rect }) => Math.abs(centerX(rect) - centerX(current));
    row.sort((a, b) => overlap(b) - overlap(a) || distance(a) - distance(b));
    return row[0].index;
  }

  return currentIndex;
}

/**
 * How far to scroll the page tab strip so one tab sits fully in view, kept clear of the faded
 * edges. Positions are measured from the strip's left edge on screen, which makes the sum the
 * same in either text direction; the caller adds the result to the strip's scrollLeft.
 *
 * @param {Object} box
 * @param {number} box.itemLeft - Left edge of the tab, from the strip's left edge.
 * @param {number} box.itemRight - Right edge of the tab, from the strip's left edge.
 * @param {number} box.viewWidth - Width of the strip's visible area.
 * @param {number} [box.inset] - Room to leave at each edge.
 * @param {string} [box.direction='ltr'] - Text direction; a tab wider than the strip shows its
 *   leading edge (a tab that is too wide only for the margins is centred).
 * @returns {number} Pixels to scroll right (negative to scroll left); 0 when the tab is in view.
 */
function getQuickAccessTabRevealDelta({
  itemLeft,
  itemRight,
  viewWidth,
  inset = QUICK_ACCESS_TAB_EDGE_INSET,
  direction = 'ltr',
}) {
  const rightLimit = viewWidth - inset;
  const width = itemRight - itemLeft;
  if (width > rightLimit - inset) {
    // Too wide for the margins: centre it when it still fits, else show its leading edge.
    if (width <= viewWidth) return (itemLeft + itemRight - viewWidth) / 2;
    return direction === 'rtl' ? itemRight - viewWidth + inset : itemLeft - inset;
  }
  if (itemLeft < inset) return itemLeft - inset;
  if (itemRight > rightLimit) return itemRight - rightLimit;
  return 0;
}

/**
 * Whether pages are hidden past either edge of the tab strip, for the fade that tells people the
 * strip scrolls. Left and right are on screen, whatever the text direction: Chromium's scrollLeft
 * counts from 0 at the start edge, up in left-to-right text and down (negative) in right-to-left.
 *
 * @param {Object} metrics
 * @param {number} metrics.scrollLeft
 * @param {number} metrics.scrollWidth
 * @param {number} metrics.clientWidth
 * @param {string} [metrics.direction='ltr']
 * @returns {{left: boolean, right: boolean}}
 */
function getQuickAccessTabOverflow({ scrollLeft, scrollWidth, clientWidth, direction = 'ltr' }) {
  const maxScroll = scrollWidth - clientWidth;
  if (!(maxScroll > 1)) return { left: false, right: false };
  const fromLeft = direction === 'rtl' ? maxScroll + scrollLeft : scrollLeft;
  return { left: fromLeft > 1, right: maxScroll - fromLeft > 1 };
}

/**
 * What a mouse wheel turn does to the tab strip. A plain wheel only turns vertically, which does
 * nothing to a row, so it scrolls the row sideways (down moves toward the end); a trackpad swipe
 * or a tilt wheel already scrolls sideways and is left to the browser.
 *
 * @param {{deltaX: number, deltaY: number, deltaMode: number}} wheel
 * @param {number} viewWidth - Width of the strip, the size of a "page" of scrolling.
 * @param {string} [direction='ltr']
 * @returns {number} Pixels to add to scrollLeft, or 0 to leave the event alone.
 */
function getQuickAccessTabWheelDelta({ deltaX, deltaY, deltaMode }, viewWidth, direction = 'ltr') {
  if (!deltaY || Math.abs(deltaY) <= Math.abs(deltaX)) return 0;
  const LINE_HEIGHT = 16;
  const pixels =
    deltaMode === 1 ? deltaY * LINE_HEIGHT : deltaMode === 2 ? deltaY * viewWidth : deltaY;
  return direction === 'rtl' ? -pixels : pixels;
}

/** The smallest a sensor reading is shrunk to before it is cut with an ellipsis instead. */
const SENSOR_VALUE_MIN_FONT_PX = 10;

/**
 * The font size at which a number that is too wide for its tile fits, so a reading shrinks instead
 * of losing digits: '123,456.79' cut to '123,456…' reads as a smaller number than it is.
 *
 * @param {Object} metrics
 * @param {number} metrics.fontSize - The size the reading is drawn at, in px.
 * @param {number} metrics.naturalWidth - Its full width at that size.
 * @param {number} metrics.availableWidth - The room it has.
 * @returns {number|null} The size to draw it at, in px (half pixels, never below
 *   SENSOR_VALUE_MIN_FONT_PX), or null when it already fits or cannot be measured.
 */
function getFittedSensorValueFontSize({ fontSize, naturalWidth, availableWidth }) {
  if (!(fontSize > 0) || !(naturalWidth > 0) || !(availableWidth > 0)) return null;
  if (naturalWidth <= availableWidth + 1) return null;
  const fitted = Math.floor(((fontSize * availableWidth) / naturalWidth) * 2) / 2;
  return Math.min(fontSize, Math.max(SENSOR_VALUE_MIN_FONT_PX, fitted));
}

export {
  QUICK_ACCESS_TAB_EDGE_INSET,
  SENSOR_VALUE_MIN_FONT_PX,
  getFittedSensorValueFontSize,
  getNextQuickAccessFocusIndex,
  getNextQuickAccessFocusIndexByLayout,
  getQuickAccessTabOverflow,
  getQuickAccessTabRevealDelta,
  getQuickAccessTabWheelDelta,
};

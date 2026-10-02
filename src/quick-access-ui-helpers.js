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

export {
  QUICK_ACCESS_TAB_EDGE_INSET,
  getNextQuickAccessFocusIndex,
  getQuickAccessTabOverflow,
  getQuickAccessTabRevealDelta,
  getQuickAccessTabWheelDelta,
};

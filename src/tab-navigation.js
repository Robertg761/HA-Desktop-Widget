/**
 * Keyboard navigation for tab lists, as the WAI-ARIA tabs pattern describes it. Shared by the
 * Quick Access page tabs and the Settings section rail.
 */

/**
 * The reading direction an element lays out in.
 * @param {Element} element
 * @returns {'ltr'|'rtl'}
 */
function getTextDirection(element) {
  const direction = window.getComputedStyle(element).direction || document.documentElement.dir;
  return direction === 'rtl' ? 'rtl' : 'ltr';
}

/**
 * Which tab an arrow, Home or End key moves to.
 *
 * Along the list the arrows wrap around its ends. In a horizontal list under right-to-left text
 * they swap, so the key that points right still moves right on screen. A vertical list uses the
 * up and down arrows.
 *
 * @param {number} currentIndex - Index of the focused tab; anything else counts as the first.
 * @param {number} tabCount - How many tabs there are.
 * @param {string} key - A KeyboardEvent key.
 * @param {Object} [options]
 * @param {string} [options.direction='ltr'] - Text direction, for the left and right arrows.
 * @param {string} [options.orientation='horizontal'] - 'horizontal' (left and right arrows),
 *   'vertical' (up and down) or 'both' for a list that can lay out either way.
 * @returns {number} Index of the tab to focus, or -1 when the key is not one of these.
 */
function getNextTabIndex(
  currentIndex,
  tabCount,
  key,
  { direction = 'ltr', orientation = 'horizontal' } = {}
) {
  if (!Number.isInteger(tabCount) || tabCount <= 0) return -1;

  const current = Number.isInteger(currentIndex)
    ? Math.min(Math.max(currentIndex, 0), tabCount - 1)
    : 0;
  if (key === 'Home') return 0;
  if (key === 'End') return tabCount - 1;

  const previousKeys = [];
  const nextKeys = [];
  if (orientation !== 'horizontal') {
    previousKeys.push('ArrowUp');
    nextKeys.push('ArrowDown');
  }
  if (orientation !== 'vertical') {
    previousKeys.push(direction === 'rtl' ? 'ArrowRight' : 'ArrowLeft');
    nextKeys.push(direction === 'rtl' ? 'ArrowLeft' : 'ArrowRight');
  }
  if (previousKeys.includes(key)) return (current - 1 + tabCount) % tabCount;
  if (nextKeys.includes(key)) return (current + 1) % tabCount;
  return -1;
}

/**
 * Make a list of tabs answer the arrow keys, Home and End: focus moves to the tab and selects it
 * (by clicking it), the way a segmented control does.
 *
 * @param {HTMLElement} tablist - The element that holds the tabs; the listener stays on it, so
 *   tabs that are rebuilt need no new listeners.
 * @param {string} tabSelector - Selector for the tab buttons inside it.
 * @param {Object} [options]
 * @param {string} [options.orientation='horizontal'] - See getNextTabIndex.
 */
function bindTabListKeyboard(tablist, tabSelector, { orientation = 'horizontal' } = {}) {
  tablist.addEventListener('keydown', (event) => {
    if (event.ctrlKey || event.metaKey || event.altKey || event.shiftKey) return;
    const tabs = [...tablist.querySelectorAll(tabSelector)];
    const current = tabs.indexOf(event.target?.closest?.(tabSelector));
    if (current < 0) return;

    const next =
      tabs[
        getNextTabIndex(current, tabs.length, event.key, {
          direction: getTextDirection(tablist),
          orientation,
        })
      ];
    if (!next) return;

    event.preventDefault();
    if (next === tabs[current]) return;
    next.focus({ preventScroll: true });
    next.click();
  });
}

/**
 * Roving tabindex: only the selected tab is a Tab stop, and the arrow keys reach the rest.
 * @param {Iterable<HTMLElement>} tabs
 * @param {HTMLElement|undefined} selected - The tab that stays reachable; the first when absent.
 */
function syncRovingTabIndex(tabs, selected) {
  const list = [...tabs];
  const stop = list.includes(selected) ? selected : list[0];
  list.forEach((tab) => {
    tab.tabIndex = tab === stop ? 0 : -1;
  });
}

export { bindTabListKeyboard, getNextTabIndex, getTextDirection, syncRovingTabIndex };

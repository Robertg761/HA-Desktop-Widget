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
 * (by clicking it), the way a segmented control does. Only while the element is a tablist; one
 * that is a plain group for a while (the Quick Access pages being edited) promises no arrow keys.
 *
 * @param {HTMLElement} tablist - The element that holds the tabs; the listener stays on it, so
 *   tabs that are rebuilt need no new listeners.
 * @param {string} tabSelector - Selector for the tab buttons inside it.
 * @param {Object} [options]
 * @param {string} [options.orientation='horizontal'] - See getNextTabIndex.
 */
function bindTabListKeyboard(tablist, tabSelector, { orientation = 'horizontal' } = {}) {
  tablist.addEventListener('keydown', (event) => {
    if (tablist.getAttribute('role') !== 'tablist') return;
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

/**
 * Keep aria-orientation true for a list that lays out as a column or a row depending on the
 * window (the Settings rail). It is read from the layout, so it cannot disagree with the CSS
 * breakpoints, and it is read again whenever the window is resized.
 * @param {HTMLElement} tablist
 */
function bindTabListOrientation(tablist) {
  const sync = () => {
    const column = window.getComputedStyle(tablist).flexDirection.startsWith('column');
    tablist.setAttribute('aria-orientation', column ? 'vertical' : 'horizontal');
  };
  sync();
  window.addEventListener('resize', sync);
}

/**
 * Give an icon-only tab list a label for the tab under the pointer or focus.
 *
 * The Settings rail shows icons and keeps each page's name only for screen readers. A native `title`
 * appears for the mouse alone, so a keyboard user tabbing the rail saw a ring round a bare icon (a
 * house, a grid, a wrench) and learned the page by opening it. One shared label element is placed
 * beside the tab, outside the rail, whose own overflow would clip a tooltip drawn inside it.
 * It reads the tab's visually hidden `.tab-link-label`, so there is nothing more to translate.
 *
 * @param {HTMLElement} tablist - The rail.
 * @param {string} tabSelector - Selector for the tab buttons inside it.
 * @param {HTMLElement} [host] - Where the label lives; the rail's dialog by default.
 */
function bindTabTooltips(tablist, tabSelector, host = tablist.closest('.modal-content')) {
  if (!host || tablist.dataset.tabTooltips) return;
  tablist.dataset.tabTooltips = 'true';
  let tooltip = null;
  const ensure = () => {
    if (tooltip) return tooltip;
    tooltip = document.createElement('div');
    tooltip.className = 'tab-tooltip';
    // The tab already has its name; this is a visual aid, so assistive technology skips it.
    tooltip.setAttribute('aria-hidden', 'true');
    host.appendChild(tooltip);
    return tooltip;
  };
  const hide = () => tooltip?.classList.remove('visible');
  const show = (tab) => {
    const label = tab.querySelector('.tab-link-label')?.textContent.trim();
    if (!label) return;
    const bubble = ensure();
    bubble.textContent = label;
    bubble.classList.add('visible');
    const hostRect = host.getBoundingClientRect();
    const rect = tab.getBoundingClientRect();
    const gap = 8;
    const vertical = tablist.getAttribute('aria-orientation') !== 'horizontal';
    const rtl = getTextDirection(tablist) === 'rtl';
    const size = bubble.getBoundingClientRect();
    // Beside a column of tabs; below a row of them. Coordinates are the host's, which is positioned.
    const top = vertical ? rect.top + rect.height / 2 - size.height / 2 : rect.bottom + gap;
    const left = vertical
      ? rtl
        ? rect.left - size.width - gap
        : rect.right + gap
      : rect.left + rect.width / 2 - size.width / 2;
    bubble.style.top = `${Math.round(top - hostRect.top)}px`;
    bubble.style.left = `${Math.round(Math.max(gap, left - hostRect.left))}px`;
  };
  tablist.addEventListener('pointerover', (event) => {
    const tab = event.target.closest?.(tabSelector);
    if (tab) show(tab);
  });
  tablist.addEventListener('pointerout', (event) => {
    if (event.target.closest?.(tabSelector)) hide();
  });
  tablist.addEventListener('focusin', (event) => {
    const tab = event.target.closest?.(tabSelector);
    if (tab) show(tab);
  });
  tablist.addEventListener('focusout', hide);
  // Choosing a page makes its title the label; scrolling the rail moves the tab away from it.
  tablist.addEventListener('click', hide);
  tablist.addEventListener('scroll', hide, { passive: true });
}

export {
  bindTabListKeyboard,
  bindTabTooltips,
  bindTabListOrientation,
  getNextTabIndex,
  getTextDirection,
  syncRovingTabIndex,
};

import { formatNumber, t } from './i18n.js';

// The Settings lists that name every entity (top cards, custom icons, hotkeys) hold hundreds of
// rows in a large home. Building them all at once, on every keystroke, took a second or more, so
// each shows one page and a pager.
const LIST_PAGE_SIZE = 50;

/**
 * The part of a list one page shows.
 * @param {Array} items - The whole list, already filtered and sorted.
 * @param {number} page - The wanted page, from 0; kept inside the list.
 * @returns {{items: Array, page: number, pageCount: number}}
 */
function paginate(items, page = 0) {
  const pageCount = Math.max(1, Math.ceil(items.length / LIST_PAGE_SIZE));
  const current = Math.min(Math.max(page, 0), pageCount - 1);
  return {
    items: items.slice(current * LIST_PAGE_SIZE, (current + 1) * LIST_PAGE_SIZE),
    page: current,
    pageCount,
  };
}

/**
 * Puts the pager at the end of a list: where the person is and Previous/Next. Nothing is added for
 * a single page.
 * @param {HTMLElement} list - The element holding the rows.
 * @param {Object} options
 * @param {number} options.page - The page shown, from 0.
 * @param {number} options.pageCount - How many pages there are.
 * @param {Function} options.onChange - Called with the new page when a pager button is used.
 */
function renderListPager(list, { page, pageCount, onChange }) {
  if (pageCount <= 1) return;
  const navigation = document.createElement('div');
  navigation.className = 'primary-cards-list-actions primary-cards-pagination';
  const status = document.createElement('span');
  status.setAttribute('role', 'status');
  status.textContent = t('Page {{page}} / {{count}}', {
    page: formatNumber(page + 1),
    count: formatNumber(pageCount),
  });
  navigation.appendChild(status);
  for (const [key, label, delta] of [
    ['previous', t('Previous'), -1],
    ['next', t('Next'), 1],
  ]) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'btn btn-secondary btn-sm';
    button.textContent = label;
    button.dataset.primaryPage = key;
    // Lists rebuilt through renderKeepingFocus hand the keyboard back to this button.
    button.dataset.focusKey = `list-pager:${key}`;
    const unavailable = page + delta < 0 || page + delta >= pageCount;
    button.setAttribute('aria-disabled', String(unavailable));
    button.addEventListener('click', () => {
      if (unavailable) return;
      onChange(page + delta);
      // A new page starts at its first row; focus stays on the pager button.
      list.scrollTop = 0;
    });
    navigation.appendChild(button);
  }
  list.appendChild(navigation);
}

export { LIST_PAGE_SIZE, paginate, renderListPager };

import { t } from './i18n.js';

function searchText(value) {
  return value.normalize('NFKD').replace(/\p{M}/gu, '').toLocaleLowerCase().replace(/[-_]/g, ' ');
}

// Index labels and explanatory copy, never input values, tokens, or entity lists.
function settingsSearchEntries(modal) {
  return [
    ...modal.querySelectorAll(
      '.tab-content label, .tab-content .setting-label, .tab-content summary, .tab-content .section-toggle, .tab-content .setting-row-action > button[data-i18n]'
    ),
  ]
    .filter((label) => !label.closest('[hidden]'))
    .map((label) => {
      const panel = label.closest('.tab-content');
      const row = label.closest('.form-group, .settings-details, .personalization-section');
      const page = panel.querySelector('.settings-page-title')?.textContent.trim() || '';
      const group =
        label
          .closest('.settings-group')
          ?.querySelector('.settings-group-caption')
          ?.textContent.trim() || '';
      const title = label.textContent.trim();
      const help = [
        ...(row?.querySelectorAll('[data-i18n].form-help, [data-i18n].help-text') || []),
      ]
        .map((node) => node.textContent.trim())
        .join(' ');
      return {
        label,
        panel,
        row,
        page,
        title,
        text: searchText(`${title} ${page} ${group} ${help} ${label.htmlFor || ''}`),
      };
    });
}

function initializeSettingsSearch(modal) {
  const input = modal.querySelector('#settings-search');
  const results = modal.querySelector('#settings-search-results');
  const status = modal.querySelector('#settings-search-status');
  if (!input || !results || !status) return;

  const reset = () => {
    input.value = '';
    results.replaceChildren();
    results.hidden = true;
    status.textContent = '';
    modal.classList.remove('settings-searching');
  };
  const search = () => {
    const words = searchText(input.value.trim()).split(/\s+/).filter(Boolean);
    resetResults();
    if (!words.length) return;
    const entries = settingsSearchEntries(modal).filter((entry) =>
      words.every((word) => entry.text.includes(word))
    );
    status.textContent = entries.length
      ? t('{{count}} matching settings', { count: entries.length })
      : t('No matching settings');
    for (const entry of entries) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'btn btn-secondary settings-search-result';
      const title = document.createElement('span');
      title.textContent = entry.title;
      const page = document.createElement('small');
      page.textContent = entry.page;
      button.append(title, page);
      button.onclick = () => {
        reset();
        modal
          .querySelector(`.modal-tabs [data-tab="${entry.panel.id.replace(/-tab$/, '')}"]`)
          ?.click();
        // Open outer disclosures before inner ones, using their existing hydration handlers.
        const ancestors = [];
        for (
          let node = entry.label.parentElement;
          node && node !== modal;
          node = node.parentElement
        )
          ancestors.unshift(node);
        for (const node of ancestors) {
          if (node.tagName === 'DETAILS') node.open = true;
          if (
            node.classList.contains('personalization-section') &&
            node.classList.contains('collapsed')
          )
            node.querySelector('.section-toggle')?.click();
        }
        const target =
          (entry.label.htmlFor && document.getElementById(entry.label.htmlFor)) ||
          (entry.label.matches('summary, button')
            ? entry.label
            : entry.row?.querySelector('input:not([type="hidden"]), select, button, textarea'));
        requestAnimationFrame(() => {
          entry.label.scrollIntoView?.({ block: 'center' });
          const focusTarget = target && !target.disabled ? target : entry.label;
          if (!focusTarget.matches('input, select, button, textarea, summary'))
            focusTarget.tabIndex = -1;
          focusTarget.focus();
        });
      };
      results.append(button);
    }
  };
  function resetResults() {
    results.replaceChildren();
    const active = !!input.value.trim();
    results.hidden = !active;
    modal.classList.toggle('settings-searching', active);
    status.textContent = '';
  }
  // Reopening Settings must not accumulate listeners or keep an old query.
  input.oninput = search;
  input.onkeydown = (event) => {
    if (event.key === 'Escape' && input.value) {
      event.preventDefault();
      event.stopPropagation();
      reset();
    } else if (event.key === 'ArrowDown' || event.key === 'Enter') {
      const first = results.querySelector('button');
      if (first) {
        event.preventDefault();
        first.focus();
      }
    }
  };
  modal.querySelectorAll('.modal-tabs .tab-link').forEach((button) => {
    if (!button.dataset.searchResetBound) {
      button.addEventListener('click', reset);
      button.dataset.searchResetBound = 'true';
    }
  });
  reset();
}

export { initializeSettingsSearch, settingsSearchEntries };

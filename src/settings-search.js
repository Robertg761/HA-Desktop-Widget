import { t } from './i18n.js';

function searchText(value) {
  return value.normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase().replace(/[-_]/g, ' ');
}

// Controls toggled with inline display (e.g. the weather override group) are not reachable.
// A label the stylesheet hides itself duplicates a visible title; pages and disclosures hide
// their containers instead, so only the label's own computed style is checked.
function isHidden(node, modal) {
  for (let el = node; el && el !== modal; el = el.parentElement)
    if (el.style?.display === 'none') return true;
  return getComputedStyle(node).display === 'none';
}

const ARIA_NAMED_CONTROL = 'select[aria-label], input[aria-label], textarea[aria-label]';

// Index labels and explanatory copy, never input values, tokens, or entity lists.
function settingsSearchEntries(modal) {
  return (
    [
      ...modal.querySelectorAll(
        `.tab-content label, .tab-content .setting-label, .tab-content summary, .tab-content .section-toggle, .tab-content .setting-row-action > button[data-i18n], .tab-content button.btn, .tab-content :is(${ARIA_NAMED_CONTROL})`
      ),
    ]
      // Generated lists (entities, alerts, language packs, hotkeys) repeat a row per item; their
      // parent setting is the entry. Every such container in the settings markup ends in -list.
      .filter((label) => !label.closest('.entity-selector-list, [id$="-list"]'))
      // Segmented choices (Weather/Time/Hide) belong to the setting that labels the group.
      .filter((label) => !(label.matches('button') && label.closest('.segmented-control')))
      // A wrapping <label> is the entry for its control; skip the nested title span.
      .filter((label) => !(label.matches('.setting-label') && label.closest('label')))
      .filter((label) => !label.closest('[hidden], .hidden') && !isHidden(label, modal))
      // An aria-label names its own entry unless one of its <label>s is indexed instead.
      .filter(
        (label) =>
          !label.matches(ARIA_NAMED_CONTROL) ||
          ![...(label.labels || [])].some(
            (own) => !own.closest('[hidden], .hidden') && !isHidden(own, modal)
          )
      )
      .map((label) => {
        const panel = label.closest('.tab-content');
        const row = label.closest('.form-group, .settings-details, .personalization-section');
        const page = panel.querySelector('.settings-page-title')?.textContent.trim() || '';
        const group =
          label
            .closest('.settings-group')
            ?.querySelector('.settings-group-caption')
            ?.textContent.trim() || '';
        const titleNode = label.matches('label') ? label.querySelector('.setting-label') : null;
        const title = label.matches(ARIA_NAMED_CONTROL)
          ? label.getAttribute('aria-label').trim()
          : (titleNode || label).textContent.trim();
        // Options sharing a group must not match on each other's help, so use only their own.
        const helpNodes = titleNode
          ? label.querySelectorAll('.form-help, .help-text')
          : row?.querySelectorAll('[data-i18n].form-help, [data-i18n].help-text') || [];
        const help = [...helpNodes].map((node) => node.textContent.trim()).join(' ');
        return {
          label,
          panel,
          row,
          page,
          title,
          text: searchText(`${title} ${page} ${group} ${help} ${label.htmlFor || ''}`),
        };
      })
      .filter((entry) => entry.title)
  );
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
        const labelled = entry.label.matches('label') ? entry.label : entry.label.closest('label');
        // A custom widget such as a radiogroup points back at its label through aria-labelledby.
        const labelledWidget =
          entry.label.id && modal.querySelector(`[aria-labelledby~="${entry.label.id}"]`);
        const target =
          labelled?.control ||
          (entry.label.htmlFor && document.getElementById(entry.label.htmlFor)) ||
          (labelledWidget &&
            (labelledWidget.querySelector('[aria-checked="true"], [tabindex="0"]') ||
              labelledWidget.querySelector('button, input, select, textarea'))) ||
          (entry.label.matches('summary, button, input, select, textarea')
            ? entry.label
            : entry.row?.querySelector(
                ':is(input:not([type="hidden"]), select, button, textarea):not([aria-hidden="true"])'
              ));
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

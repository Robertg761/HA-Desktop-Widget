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

// Help copy, whichever way it is translated. Status lines (current values, sync or update state)
// are left out, so search never reflects live state.
const STATIC_HELP =
  ':is(.form-help, .help-text):is([data-i18n], [data-i18n-html], [data-search-help])';
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
      // Its Details button belongs to a live status line, not to a setting.
      .filter((label) => !label.closest('.profile-sync-status-block'))
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
          : row?.querySelectorAll(STATIC_HELP) || [];
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

// Marks the setting a search result jumped to for a moment, so there is something to find on a page
// of similar rows. Reduced motion (and forced colours) get the outline without the fade.
function highlightTarget(row) {
  if (!row?.classList) return;
  document.querySelectorAll('.settings-search-target').forEach((node) => {
    node.classList.remove('settings-search-target');
  });
  row.classList.add('settings-search-target');
  setTimeout(() => row.classList.remove('settings-search-target'), 1600);
}

function initializeSettingsSearch(modal) {
  const input = modal.querySelector('#settings-search');
  const results = modal.querySelector('#settings-search-results');
  const status = modal.querySelector('#settings-search-status');
  if (!input || !results || !status) return;

  // While results stand in for the page, no page is the current one. The rail says so, to the eye
  // (the pill steps back, in CSS) and to assistive technology (aria-selected), instead of claiming
  // General while showing matches from every page. Which tab is the current one is the `.active`
  // class, which searching does not touch, so it is read back from there.
  const syncTabSelection = (searching) => {
    modal.querySelectorAll('.modal-tabs .tab-link').forEach((tab) => {
      tab.setAttribute('aria-selected', String(!searching && tab.classList.contains('active')));
    });
  };
  const reset = () => {
    input.value = '';
    results.replaceChildren();
    results.hidden = true;
    status.textContent = '';
    modal.classList.remove('settings-searching');
    syncTabSelection(false);
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
        // Where the result lands is lost on arrival (several similar rows, and a pointer click
        // does not draw a focus ring), so the row says "this one" for a moment.
        highlightTarget(entry.row || entry.label);
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
    syncTabSelection(active);
    status.textContent = '';
  }
  // Escape and the arrows work from the results too, as they do from the field: Escape backs out of
  // the search (and not out of Settings with every unsaved edit), and the arrows walk the list.
  results.onkeydown = (event) => {
    const buttons = [...results.querySelectorAll('button')];
    const current = buttons.indexOf(event.target.closest('button'));
    if (current < 0) return;
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      reset();
      input.focus();
    } else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      const next = buttons[current + (event.key === 'ArrowDown' ? 1 : -1)];
      // Up from the first result returns to the field.
      (next || (event.key === 'ArrowUp' ? input : buttons[current])).focus();
    }
  };
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

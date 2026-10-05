import { foldSearchMarks } from './format.js';
import { formatNumber, t } from './i18n.js';

function searchText(value) {
  return foldSearchMarks(value).replace(/\p{M}/gu, '').toLowerCase().replace(/[-_]/g, ' ');
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
// The control a result for a row, or for a whole group, lands on: its first one.
const FOCUSABLE_IN_ROW = ['input:not([type="hidden"])', 'select', 'button', 'textarea']
  .map((selector) => `${selector}:not([aria-hidden="true"])`)
  .join(', ');
// What a setting offers as choices, which is how people look for "dark" or "24-hour".
const OPTION_TEXT = 'option, .segmented-option';

// The English the markup was written in. A translated interface still follows English instructions
// ("turn on Dark mode"), the docs and the community posts, so those words find the setting too.
function sourceText(...nodes) {
  return nodes
    .filter(Boolean)
    .flatMap((node) => [node, ...node.querySelectorAll('[data-i18n], [data-i18n-html]')])
    .map((node) => node.getAttribute?.('data-i18n') || node.getAttribute?.('data-i18n-html') || '')
    .join(' ');
}

// Where in a result a word was found. The setting's own name outranks the group it sits in, which
// outranks help text and the names of its choices: "hotkey" should lead with the setting called
// that, not with whatever else is on the page.
const RANK_TITLE = 3;
const RANK_GROUP = 2;
const RANK_DETAIL = 1;

// Index labels and explanatory copy, never input values, tokens, or entity lists.
function settingsSearchEntries(modal) {
  return (
    [
      ...modal.querySelectorAll(
        `.tab-content label, .tab-content .setting-label, .tab-content summary, .tab-content .section-toggle, .tab-content .setting-row-action > button[data-i18n], .tab-content button.btn, .tab-content :is(${ARIA_NAMED_CONTROL})`
      ),
    ]
      // Example key combinations are values to press, not settings.
      .filter((label) => !label.closest('[data-search-skip]'))
      // A button that cannot be pressed leads nowhere (the check for updates before it is ready).
      .filter((label) => !(label.matches('button.btn') && label.disabled))
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
        const groupBox = label.closest('.settings-group');
        const groupNode = groupBox?.querySelector('.settings-group-caption');
        const group = groupNode?.textContent.trim() || '';
        const titleNode = label.matches('label') ? label.querySelector('.setting-label') : null;
        const title = label.matches(ARIA_NAMED_CONTROL)
          ? label.getAttribute('aria-label').trim()
          : (titleNode || label).textContent.trim();
        // A button in a row that has a name of its own is found by its own label only. The row's
        // help is the row's: Export settings and Import settings each matched "hotkey" through
        // "hotkeys and profile sync stay on this computer", under the row that says it.
        const ownsRow = !(
          label.matches('button.btn') && row?.querySelector('label, .setting-label, summary')
        );
        // Options sharing a group must not match on each other's help, so use only their own.
        const helpNodes = titleNode
          ? label.querySelectorAll('.form-help, .help-text')
          : (ownsRow && row?.querySelectorAll(STATIC_HELP)) || [];
        const help = [...helpNodes].map((node) => node.textContent.trim()).join(' ');
        // The choices of a control (its options, or the segments of a switch group). A disclosure or
        // card row holds other settings' choices, so only a plain setting row contributes them.
        const choiceNodes =
          ownsRow && row?.matches('.form-group') ? row.querySelectorAll(OPTION_TEXT) : [];
        const choices = [...choiceNodes].map((node) => node.textContent.trim()).join(' ');
        // A control named only by aria-label carries its English name in data-i18n-aria-label.
        const titleSource = label.matches(ARIA_NAMED_CONTROL)
          ? label.getAttribute('data-i18n-aria-label') || ''
          : sourceText(titleNode || label);
        return makeEntry({
          label,
          panel,
          row,
          title,
          page,
          groupBox: group ? groupBox : null,
          groupNode: group ? groupNode : null,
          group,
          // Where it lives: the page and, when the page has several groups, the group it is in.
          subtitle: group && group !== page ? `${page} › ${group}` : page,
          fields: [
            [RANK_TITLE, `${title} ${titleSource}`],
            [RANK_GROUP, `${group} ${sourceText(groupNode)}`],
            [RANK_DETAIL, `${help} ${choices} ${sourceText(...helpNodes, ...choiceNodes)}`],
          ],
        });
      })
      .filter((entry) => entry.title)
  );
}

// The searchable text of an entry, kept by field so ranking can tell a title hit from a help hit.
function makeEntry({ fields, ...entry }) {
  const searchable = fields.map(([rank, text]) => [rank, searchText(text)]);
  return { ...entry, fields: searchable, text: searchable.map(([, text]) => text).join(' ') };
}

// A page is a result of its own. Its name and description are not repeated into every row on it,
// which made a word like "theme" match the whole Appearance page.
function settingsSearchPageEntries(modal) {
  return (
    [...modal.querySelectorAll('.tab-content')]
      // Pages are shown and hidden by class (only the current one is displayed), so a page counts
      // unless something takes it out of Settings altogether.
      .filter((panel) => !panel.closest('[hidden], .hidden') && panel.style.display !== 'none')
      .map((panel) => {
        const titleNode = panel.querySelector('.settings-page-title');
        const descriptionNode = panel.querySelector('.settings-page-description');
        const title = titleNode?.textContent.trim() || '';
        const description = descriptionNode?.textContent.trim() || '';
        return makeEntry({
          label: titleNode,
          panel,
          row: null,
          title,
          subtitle: description,
          fields: [
            [RANK_TITLE, `${title} ${sourceText(titleNode)}`],
            [RANK_DETAIL, `${description} ${sourceText(descriptionNode)}`],
          ],
        });
      })
      .filter((entry) => entry.title)
  );
}

// Zero when a word is nowhere in the entry; otherwise the sum of where each word was best found,
// and whether the group's name is where every word was best found.
function scoreEntry(entry, words) {
  let score = 0;
  let onlyGroup = true;
  for (const word of words) {
    const hit = entry.fields.find(([, text]) => text.includes(word));
    if (!hit) return { score: 0, onlyGroup: false };
    score += hit[0];
    onlyGroup &&= hit[0] === RANK_GROUP;
  }
  return { score, onlyGroup };
}

/**
 * The results in rank order, with the rows a query found only through their group's name folded
 * into one result for the group. "theme" listed every row under Seasonal Themes, a holiday each,
 * because the caption said "Themes"; it now lists the group once, which opens on its first row. A
 * row whose own words match stays a result of its own.
 */
function rankResults(entries, words) {
  const ranked = entries
    .map((entry) => ({ entry, ...scoreEntry(entry, words) }))
    .filter(({ score }) => score > 0)
    // Best match first; equal scores keep the order of the pages.
    .sort((a, b) => b.score - a.score);
  const groups = new Set();
  return ranked.flatMap(({ entry, onlyGroup }) => {
    if (!onlyGroup || !entry.groupBox) return [entry];
    if (groups.has(entry.groupBox)) return [];
    groups.add(entry.groupBox);
    // The caption is what the result jumps to and names, and the whole group is what lights up.
    return [
      {
        ...entry,
        label: entry.groupNode,
        row: entry.groupBox,
        title: entry.group,
        subtitle: entry.page,
      },
    ];
  });
}

// A zero-hit query leaves the whole page empty, so it says so in the page's own voice instead of a
// single faint caption. The status line above keeps the plain sentence for assistive technology
// only, so the page does not say the same thing twice.
function buildEmptyState(query) {
  const box = document.createElement('div');
  box.className = 'no-entities-message settings-search-empty';
  box.innerHTML =
    '<svg class="settings-search-empty-icon" width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="m21 21-4.3-4.3"/></svg>';
  const title = document.createElement('strong');
  title.className = 'settings-search-empty-title';
  title.textContent = t('No settings match “{{query}}”', { query });
  const hint = document.createElement('span');
  hint.textContent = t('Try a different word, or clear the search to see every setting.');
  box.append(title, hint);
  return box;
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
    status.classList.remove('sr-only');
    modal.classList.remove('settings-searching');
    syncTabSelection(false);
  };
  const search = () => {
    const words = searchText(input.value.trim()).split(/\s+/).filter(Boolean);
    // A query of only separators ("-") has nothing to look for: the page stays, as if empty.
    resetResults(words.length > 0);
    if (!words.length) return;
    const entries = rankResults(
      [...settingsSearchPageEntries(modal), ...settingsSearchEntries(modal)],
      words
    );
    if (!entries.length) {
      status.textContent = t('No matching settings');
      status.classList.add('sr-only');
      results.append(buildEmptyState(input.value.trim()));
      return;
    }
    status.textContent =
      entries.length === 1
        ? t('1 matching setting')
        : t('{{count}} matching settings', { count: formatNumber(entries.length) });
    for (const entry of entries) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'btn btn-secondary settings-search-result';
      const title = document.createElement('span');
      title.textContent = entry.title;
      const subtitle = document.createElement('small');
      subtitle.textContent = entry.subtitle;
      button.append(title, subtitle);
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
            : entry.row?.querySelector(FOCUSABLE_IN_ROW));
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
  function resetResults(active) {
    results.replaceChildren();
    results.hidden = !active;
    modal.classList.toggle('settings-searching', active);
    syncTabSelection(active);
    status.textContent = '';
    status.classList.remove('sr-only');
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
    // Enter commits an input method's candidate, and the arrows and Escape belong to it; none of
    // them is a command to leave the field or clear it. Some engines report the key after the
    // composition ended with keyCode 229.
    if (event.isComposing || event.keyCode === 229) return;
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

export { initializeSettingsSearch, settingsSearchEntries, settingsSearchPageEntries };

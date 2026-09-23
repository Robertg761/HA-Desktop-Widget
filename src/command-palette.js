import state from './state.js';
import * as utils from './utils.js';
import { openEntityDetailModal, getEntityDomain, switchQuickAccessPage } from './ui.js';
import websocket from './websocket.js';
import { showToast } from './ui-utils.js';
import { t } from './i18n.js';
import { getActiveQuickAccessTab } from './quick-access-tabs.js';

const MAX_RESULTS = 20;
const MAX_RECENT_COMMANDS = 10;

let initialized = false;
let recentCommands = [];
let recentServer = null;
let executing = false;
let overlay = null;
let input = null;
let list = null;
let emptyState = null;
let results = [];
let highlightedIndex = -1;
let previouslyFocusedElement = null;
let paletteCommands = null;

function normalizeSearchValue(value) {
  return String(value ?? '')
    .normalize('NFKD')
    .toLowerCase()
    .replace(/\p{M}+/gu, '')
    .replace(/['’`]/g, '')
    .replace(/[_-]/g, ' ')
    .replace(/[^\p{L}\p{N}\s.]/gu, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function getSubsequenceScore(text, query) {
  let queryIndex = 0;
  let firstMatch = -1;
  let lastMatch = -1;

  for (let textIndex = 0; textIndex < text.length && queryIndex < query.length; textIndex += 1) {
    if (text[textIndex] !== query[queryIndex]) continue;
    if (firstMatch === -1) firstMatch = textIndex;
    lastMatch = textIndex;
    queryIndex += 1;
  }

  if (queryIndex !== query.length) return 0;

  const span = lastMatch - firstMatch + 1;
  const gaps = Math.max(0, span - query.length);
  return Math.max(250, 400 - firstMatch - gaps);
}

function scoreCommandPaletteMatch(text, query) {
  const normalizedText = normalizeSearchValue(text);
  const normalizedQuery = normalizeSearchValue(query);

  if (!normalizedQuery) return String(query ?? '').trim() ? 0 : 1;
  if (!normalizedText) return 0;
  if (normalizedText === normalizedQuery) return 1000;
  if (normalizedText.startsWith(normalizedQuery)) {
    return Math.max(700, 850 - (normalizedText.length - normalizedQuery.length));
  }

  const substringIndex = normalizedText.indexOf(normalizedQuery);
  if (substringIndex !== -1) {
    return Math.max(500, 650 - substringIndex);
  }

  return getSubsequenceScore(normalizedText, normalizedQuery);
}

function rankCommandPaletteEntities(entities, query, options = {}) {
  const getDisplayName = options.getDisplayName || utils.getEntityDisplayName;
  return Array.from(entities || [])
    .filter((entity) => entity?.entity_id)
    .map((entity) => {
      const displayName = getDisplayName(entity);
      const nameScore = scoreCommandPaletteMatch(displayName, query);
      const idScore = scoreCommandPaletteMatch(entity.entity_id, query);
      return {
        entity,
        displayName,
        score: Math.max(nameScore, idScore),
      };
    })
    .filter((item) => item.score > 0)
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      return a.displayName.localeCompare(b.displayName);
    });
}

// Recent commands are entity ids and page ids only, stored per server so they survive a restart.
function recentCommandsKey(config) {
  try {
    const url = new URL(config?.homeAssistant?.url);
    return `command-palette-recent:${url.origin}${url.pathname.replace(/\/+$/, '')}`;
  } catch {
    return 'command-palette-recent:local';
  }
}

function readRecentCommands(config) {
  try {
    const stored = JSON.parse(localStorage.getItem(recentCommandsKey(config)) || '[]');
    return Array.isArray(stored)
      ? stored.filter((key) => typeof key === 'string').slice(0, MAX_RECENT_COMMANDS)
      : [];
  } catch {
    return [];
  }
}

function rememberRecentCommand(key, config = state.CONFIG) {
  recentCommands = [key, ...recentCommands.filter((recent) => recent !== key)].slice(
    0,
    MAX_RECENT_COMMANDS
  );
  try {
    localStorage.setItem(recentCommandsKey(config), JSON.stringify(recentCommands));
  } catch {
    /* Recents are a convenience; running the command already succeeded. */
  }
}

function isPaletteOpen() {
  return !!overlay && !overlay.classList.contains('hidden');
}

function isTypingTarget(target) {
  if (!target || target === document.body) return false;
  const tagName = target.tagName?.toLowerCase();
  return (
    tagName === 'input' ||
    tagName === 'textarea' ||
    tagName === 'select' ||
    target.isContentEditable === true
  );
}

function createElement(tagName, className, text = '') {
  const element = document.createElement(tagName);
  if (className) element.className = className;
  if (text) element.textContent = text;
  return element;
}

function createPaletteShell() {
  overlay = createElement('div', 'command-palette-overlay hidden');
  overlay.setAttribute('aria-hidden', 'true');

  const palettePanel = createElement('div', 'command-palette-panel');
  palettePanel.setAttribute('role', 'dialog');
  palettePanel.setAttribute('aria-modal', 'true');
  palettePanel.setAttribute('aria-label', t('Command palette'));

  const searchWrap = createElement('div', 'command-palette-search');

  input = createElement('input', 'command-palette-input');
  input.type = 'text';
  input.autocomplete = 'off';
  input.spellcheck = false;
  input.placeholder = t('Search entities, commands, and pages');
  input.setAttribute('role', 'combobox');
  input.setAttribute('aria-label', t('Search entities, commands, and pages'));
  input.setAttribute('aria-controls', 'command-palette-results');
  input.setAttribute('aria-autocomplete', 'list');
  input.setAttribute('aria-expanded', 'false');

  const closeButton = createElement('button', 'command-palette-close', '×');
  closeButton.type = 'button';
  closeButton.title = t('Close');
  closeButton.setAttribute('aria-label', t('Close command palette'));
  closeButton.addEventListener('click', closeCommandPalette);

  searchWrap.append(input, closeButton);

  list = createElement('div', 'command-palette-results');
  list.id = 'command-palette-results';
  list.setAttribute('role', 'listbox');

  emptyState = createElement('div', 'command-palette-empty', t('No matching results'));
  emptyState.hidden = true;

  palettePanel.append(searchWrap, list, emptyState);
  overlay.appendChild(palettePanel);
  document.body.appendChild(overlay);

  overlay.addEventListener('click', (event) => {
    if (event.target === overlay) closeCommandPalette();
  });
  overlay.addEventListener('keydown', handlePaletteKeydown);
  input.addEventListener('input', renderResults);
}

function ensurePaletteShell() {
  if (!overlay || !input || !list || !emptyState) createPaletteShell();
}

function updateHighlightedResult(nextIndex) {
  if (!results.length) {
    highlightedIndex = -1;
    input?.removeAttribute('aria-activedescendant');
    return;
  }

  highlightedIndex = ((nextIndex % results.length) + results.length) % results.length;
  const rows = list.querySelectorAll('.command-palette-result');
  rows.forEach((row, index) => {
    const isHighlighted = index === highlightedIndex;
    row.classList.toggle('highlighted', isHighlighted);
    row.setAttribute('aria-selected', isHighlighted ? 'true' : 'false');
    if (isHighlighted) {
      input.setAttribute('aria-activedescendant', row.id);
      row.scrollIntoView({ block: 'nearest' });
    }
  });
}

function buildPaletteCommands(entities, config = state.CONFIG, services = state.SERVICES) {
  const commands = entities.flatMap((entity) => {
    const domain = getEntityDomain(entity.entity_id);
    const name = utils.getEntityDisplayName(entity);
    if (['unavailable', 'unknown'].includes(entity.state)) return [];
    // Only offer the action that changes something: a device that is on gets "Turn off".
    const actions = ['light', 'switch', 'fan', 'input_boolean'].includes(domain)
      ? [
          entity.state !== 'on' && ['turn_on', t('Turn on {{name}}', { name })],
          entity.state !== 'off' && ['turn_off', t('Turn off {{name}}', { name })],
        ].filter(Boolean)
      : ['scene', 'script'].includes(domain)
        ? [['turn_on', t('Run {{name}}', { name })]]
        : [];
    return actions
      .filter(([service]) => services?.[domain]?.[service])
      .map(([service, displayName]) => ({
        entity,
        displayName,
        domain,
        service,
        // Recency belongs to the device, not the action: after "Turn on" the palette offers
        // "Turn off", and that is the command the user most likely wants next.
        key: entity.entity_id,
      }));
  });
  const customTabs = config?.customTabs || [];
  const activeTabId = customTabs.length ? getActiveQuickAccessTab(config)?.id : null;
  customTabs
    .filter((tab) => tab.id !== activeTabId)
    .forEach((tab) =>
      commands.push({
        tabId: tab.id,
        displayName: t('Switch to {{name}}', { name: tab.name }),
        key: `page:${tab.id}`,
      })
    );
  return commands;
}

async function executeHighlightedResult() {
  const selected = results[highlightedIndex];
  if (!selected || executing) return;
  closeCommandPalette();
  if (!selected.service && !selected.tabId) {
    openEntityDetailModal(selected.entity, { source: 'command-palette' });
    return;
  }
  executing = true;
  try {
    if (selected.tabId) {
      const result = await switchQuickAccessPage(selected.tabId);
      if (result?.success === false) return;
    } else {
      const current = state.STATES[selected.entity.entity_id];
      if (
        !websocket.isConnected() ||
        !current ||
        ['unknown', 'unavailable'].includes(current.state)
      ) {
        throw new Error(t('Entity is unavailable'));
      }
      await websocket.callService(selected.domain, selected.service, {
        entity_id: current.entity_id,
      });
      showToast(t('Command sent'), 'success', 1600);
    }
    rememberRecentCommand(selected.key);
  } catch {
    showToast(t('Could not run command. Check your connection and retry.'), 'error');
  } finally {
    executing = false;
  }
}

function createResultRow(item, index) {
  const { entity, displayName } = item;
  const row = createElement('button', 'command-palette-result');
  row.type = 'button';
  row.id = `command-palette-result-${index}`;
  row.setAttribute('role', 'option');
  row.setAttribute('aria-selected', 'false');

  const icon = createElement(
    'span',
    'command-palette-result-icon',
    entity ? utils.getEntityIcon(entity) : '▦'
  );
  icon.setAttribute('aria-hidden', 'true');

  const main = createElement('span', 'command-palette-result-main');
  const name = createElement('span', 'command-palette-result-name', displayName);
  main.append(name);

  const meta = createElement('span', 'command-palette-result-meta');
  const domain = createElement(
    'span',
    'command-palette-result-domain',
    item.tabId ? t('Page') : getEntityDomain(entity.entity_id)
  );
  const value = createElement(
    'span',
    'command-palette-result-state',
    entity ? utils.getEntityDisplayState(entity) : ''
  );
  meta.append(domain, value);

  row.append(icon, main, meta);
  row.addEventListener('mouseenter', () => updateHighlightedResult(index));
  row.addEventListener('click', () => {
    highlightedIndex = index;
    executeHighlightedResult();
  });
  return row;
}

function renderResults() {
  const query = input?.value || '';
  const server = state.CONFIG?.homeAssistant?.url || '';
  if (recentServer !== server) {
    recentCommands = readRecentCommands(state.CONFIG);
    recentServer = server;
  }
  const entities = Object.values(state.STATES || {});
  // Building commands interpolates a label per entity action, so do it once per open rather than
  // on every keystroke. Execution re-reads the live entity state before sending anything.
  paletteCommands ??= buildPaletteCommands(entities);
  const commands = paletteCommands
    .map((item) => ({
      ...item,
      score: scoreCommandPaletteMatch(item.displayName, query),
    }))
    .filter((item) => item.score > 0);
  results = [...rankCommandPaletteEntities(entities, query), ...commands]
    .sort((a, b) => {
      if (!query.trim()) {
        const aRecent = recentCommands.indexOf(a.key);
        const bRecent = recentCommands.indexOf(b.key);
        if (aRecent !== bRecent)
          return (aRecent < 0 ? Infinity : aRecent) - (bRecent < 0 ? Infinity : bRecent);
      }
      return b.score - a.score;
    })
    .slice(0, MAX_RESULTS);
  highlightedIndex = results.length ? 0 : -1;
  list.replaceChildren();

  results.forEach((item, index) => {
    list.appendChild(createResultRow(item, index));
  });

  emptyState.hidden = results.length > 0;
  updateHighlightedResult(highlightedIndex);
}

function openCommandPalette() {
  ensurePaletteShell();
  if (!isPaletteOpen() && document.activeElement && document.activeElement !== document.body) {
    previouslyFocusedElement = document.activeElement;
  }
  overlay.classList.remove('hidden');
  overlay.setAttribute('aria-hidden', 'false');
  input.setAttribute('aria-expanded', 'true');
  input.value = '';
  paletteCommands = null;
  renderResults();
  requestAnimationFrame(() => {
    input.focus();
    input.select();
  });
}

function closeCommandPalette({ restoreFocus = true } = {}) {
  if (!overlay) return;
  overlay.classList.add('hidden');
  overlay.setAttribute('aria-hidden', 'true');
  paletteCommands = null;
  input?.setAttribute('aria-expanded', 'false');
  input?.removeAttribute('aria-activedescendant');
  if (restoreFocus && previouslyFocusedElement?.isConnected) {
    previouslyFocusedElement.focus();
  }
  previouslyFocusedElement = null;
}

function handleGlobalKeydown(event) {
  const key = typeof event.key === 'string' ? event.key.toLowerCase() : '';
  const isCommandPaletteShortcut =
    key === 'k' && (event.ctrlKey || event.metaKey) && !event.altKey && !event.shiftKey;
  if (!isCommandPaletteShortcut) return;
  if (isTypingTarget(event.target) && !isPaletteOpen()) return;

  event.preventDefault();
  event.stopPropagation();
  openCommandPalette();
}

function handlePaletteKeydown(event) {
  if (!isPaletteOpen()) return;

  if (event.key === 'Tab') {
    const focusable = Array.from(
      overlay.querySelectorAll(
        'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])'
      )
    ).filter((element) => element.getAttribute('aria-hidden') !== 'true');
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (!first || !last) {
      event.preventDefault();
      return;
    }

    if (
      event.shiftKey &&
      (document.activeElement === first || !overlay.contains(document.activeElement))
    ) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
    return;
  }

  if (event.key === 'Escape') {
    event.preventDefault();
    event.stopPropagation();
    closeCommandPalette();
    return;
  }

  if (event.key === 'ArrowDown') {
    event.preventDefault();
    event.stopPropagation();
    updateHighlightedResult(highlightedIndex + 1);
    return;
  }

  if (event.key === 'ArrowUp') {
    event.preventDefault();
    event.stopPropagation();
    updateHighlightedResult(highlightedIndex - 1);
    return;
  }

  if (event.key === 'Enter') {
    event.preventDefault();
    event.stopPropagation();
    executeHighlightedResult();
  }
}

// The palette has no button of its own, so the shortcut is pointed out where people already go to
// find an entity: under the search field of Manage Quick Access.
function addShortcutHint() {
  const search = document.getElementById('quick-controls-search');
  if (!search || document.getElementById('command-palette-hint')) return;
  const hint = createElement(
    'div',
    'form-help',
    t('Tip: press Ctrl+K anywhere to search entities, run commands, and switch pages.')
  );
  hint.id = 'command-palette-hint';
  // Lets translateDocument() update the hint when the language changes.
  hint.dataset.i18n =
    'Tip: press Ctrl+K anywhere to search entities, run commands, and switch pages.';
  search.setAttribute('aria-describedby', hint.id);
  search.after(hint);
}

function initializeCommandPalette() {
  if (initialized) return;
  initialized = true;
  document.addEventListener('keydown', handleGlobalKeydown);
  addShortcutHint();
}

export {
  buildPaletteCommands,
  initializeCommandPalette,
  openCommandPalette,
  closeCommandPalette,
  rankCommandPaletteEntities,
  scoreCommandPaletteMatch,
};

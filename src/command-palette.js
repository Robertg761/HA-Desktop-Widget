import state from './state.js';
import * as utils from './utils.js';
import { openEntityDetailModal, getEntityDomain } from './ui.js';

const MAX_RESULTS = 20;

let initialized = false;
let overlay = null;
let input = null;
let list = null;
let emptyState = null;
let results = [];
let highlightedIndex = -1;

function normalizeSearchValue(value) {
  return String(value ?? '')
    .toLowerCase()
    .replace(/[''`]/g, '')
    .replace(/[_-]/g, ' ')
    .replace(/[^\w\s.]/g, '')
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

  if (!normalizedQuery) return 1;
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
  palettePanel.setAttribute('aria-label', 'Command palette');

  const searchWrap = createElement('div', 'command-palette-search');

  input = createElement('input', 'command-palette-input');
  input.type = 'text';
  input.autocomplete = 'off';
  input.spellcheck = false;
  input.placeholder = 'Search entities';
  input.setAttribute('aria-label', 'Search entities');
  input.setAttribute('aria-controls', 'command-palette-results');
  input.setAttribute('aria-autocomplete', 'list');

  const closeButton = createElement('button', 'command-palette-close', '×');
  closeButton.type = 'button';
  closeButton.title = 'Close';
  closeButton.setAttribute('aria-label', 'Close command palette');
  closeButton.addEventListener('click', closeCommandPalette);

  searchWrap.append(input, closeButton);

  list = createElement('div', 'command-palette-results');
  list.id = 'command-palette-results';
  list.setAttribute('role', 'listbox');

  emptyState = createElement('div', 'command-palette-empty', 'No matching entities');
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

function executeHighlightedResult() {
  const selected = results[highlightedIndex];
  if (!selected?.entity) return;
  closeCommandPalette();
  openEntityDetailModal(selected.entity, { source: 'command-palette' });
}

function createResultRow(item, index) {
  const { entity, displayName } = item;
  const row = createElement('button', 'command-palette-result');
  row.type = 'button';
  row.id = `command-palette-result-${index}`;
  row.setAttribute('role', 'option');
  row.setAttribute('aria-selected', 'false');

  const icon = createElement('span', 'command-palette-result-icon', utils.getEntityIcon(entity));
  icon.setAttribute('aria-hidden', 'true');

  const main = createElement('span', 'command-palette-result-main');
  const name = createElement('span', 'command-palette-result-name', displayName);
  main.append(name);

  const meta = createElement('span', 'command-palette-result-meta');
  const domain = createElement(
    'span',
    'command-palette-result-domain',
    getEntityDomain(entity.entity_id)
  );
  const value = createElement(
    'span',
    'command-palette-result-state',
    utils.getEntityDisplayState(entity)
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
  results = rankCommandPaletteEntities(Object.values(state.STATES || {}), query).slice(
    0,
    MAX_RESULTS
  );
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
  overlay.classList.remove('hidden');
  overlay.setAttribute('aria-hidden', 'false');
  input.value = '';
  renderResults();
  requestAnimationFrame(() => {
    input.focus();
    input.select();
  });
}

function closeCommandPalette() {
  if (!overlay) return;
  overlay.classList.add('hidden');
  overlay.setAttribute('aria-hidden', 'true');
  input?.removeAttribute('aria-activedescendant');
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

function initializeCommandPalette() {
  if (initialized) return;
  initialized = true;
  document.addEventListener('keydown', handleGlobalKeydown);
}

export {
  initializeCommandPalette,
  openCommandPalette,
  closeCommandPalette,
  rankCommandPaletteEntities,
  scoreCommandPaletteMatch,
};

import state from './state.js';
import * as utils from './utils.js';
import {
  openEntityDetailModal,
  getEntityDomain,
  switchQuickAccessPage,
  requestAlarmCode,
} from './ui.js';
import websocket from './websocket.js';
import { closeDialog, openDialog, showToast } from './ui-utils.js';
import { t } from './i18n.js';
import { compareNames, normalizeSearchText } from './format.js';
import { renderEntityIcon, setLineIconContent } from './entity-icons.js';
import { applyCloseButtonIcons } from './icons.js';
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
let paletteCommands = null;
let hint = null;
// Where the pointer last moved, so a row that renders under a still pointer does not take the
// highlight (and with it Enter) from the first result.
let lastPointerPosition = null;

// Commands that open something up are never offered from recents with an empty query: after
// "Lock" the list would lead with "Unlock", one Enter away. Typing a matching query finds them.
const QUERY_ONLY_SERVICES = new Set(['unlock', 'alarm_disarm']);
// Devices whose result row has no safe default action; Enter looks for their explicit command.
const COMMAND_ONLY_DOMAINS = new Set(['lock', 'alarm_control_panel']);

// The same text rules as every other search, keeping dots so an entity id still reads as one.
function normalizeSearchValue(value) {
  return normalizeSearchText(value, { keepDots: true });
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
      return compareNames(a.displayName, b.displayName);
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

  const searchWrap = createElement('div', 'command-palette-search');

  input = createElement('input', 'command-palette-input');
  input.type = 'text';
  input.autocomplete = 'off';
  input.spellcheck = false;
  input.setAttribute('role', 'combobox');
  input.setAttribute('aria-controls', 'command-palette-results');
  input.setAttribute('aria-autocomplete', 'list');
  input.setAttribute('aria-expanded', 'false');

  const closeButton = createElement('button', 'close-btn command-palette-close', '×');
  closeButton.type = 'button';
  closeButton.addEventListener('click', closeCommandPalette);

  searchWrap.append(input, closeButton);
  applyCloseButtonIcons(searchWrap);

  list = createElement('div', 'command-palette-results');
  list.id = 'command-palette-results';
  list.setAttribute('role', 'listbox');

  emptyState = createElement('div', 'command-palette-empty');
  emptyState.hidden = true;

  hint = createElement('div', 'command-palette-empty command-palette-hint');
  hint.setAttribute('role', 'status');
  hint.hidden = true;

  palettePanel.append(searchWrap, list, emptyState, hint);
  overlay.appendChild(palettePanel);
  document.body.appendChild(overlay);
  applyPaletteLabels();

  overlay.addEventListener('keydown', handlePaletteKeydown);
  input.addEventListener('input', renderResults);
}

// The shell outlives a language change, so its labels are applied again on every open.
function applyPaletteLabels() {
  if (!overlay) return;
  if (input) {
    input.placeholder = t('Search entities, commands, and pages');
    input.setAttribute('aria-label', t('Search entities, commands, and pages'));
  }
  const closeButton = overlay.querySelector('.command-palette-close');
  if (closeButton) {
    closeButton.title = t('Close');
    closeButton.setAttribute('aria-label', t('Close command palette'));
  }
  if (emptyState) emptyState.textContent = t('No matching results');
}

function ensurePaletteShell() {
  if (!overlay || !input || !list || !emptyState || !hint) createPaletteShell();
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
    if (
      entity.state === 'unavailable' ||
      (entity.state === 'unknown' && !['scene', 'script'].includes(domain))
    )
      return [];
    // Only offer the action that changes something: a device that is on gets "Turn off".
    const actions = ['light', 'switch', 'fan', 'input_boolean'].includes(domain)
      ? [
          entity.state !== 'on' && ['turn_on', t('Turn on {{name}}', { name })],
          entity.state !== 'off' && ['turn_off', t('Turn off {{name}}', { name })],
        ].filter(Boolean)
      : ['scene', 'script'].includes(domain)
        ? [['turn_on', t('Run {{name}}', { name })]]
        : domain === 'lock'
          ? [
              entity.state === 'unlocked' && ['lock', t('Lock {{name}}', { name })],
              entity.state === 'locked' && ['unlock', t('Unlock {{name}}', { name })],
            ].filter(Boolean)
          : domain === 'alarm_control_panel'
            ? getAlarmActions(entity, name)
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

// A lock or alarm panel row has no default action. Point at its explicit command instead of
// closing, or explain why there is none.
function getAlarmActions(entity, name) {
  const features = Number(entity.attributes?.supported_features) || 0;
  return [
    [1, 'alarm_arm_home', 'armed_home', t('Arm {{name}} at home', { name })],
    [2, 'alarm_arm_away', 'armed_away', t('Arm {{name}} away', { name })],
    [4, 'alarm_arm_night', 'armed_night', t('Arm {{name}} at night', { name })],
    [16, 'alarm_arm_custom_bypass', 'armed_custom_bypass', t('Arm {{name}} with bypass', { name })],
    [32, 'alarm_arm_vacation', 'armed_vacation', t('Arm {{name}} for vacation', { name })],
  ]
    .filter(([flag, , target]) => (features & flag) === flag && entity.state !== target)
    .map(([, service, , label]) => [service, label])
    .concat(entity.state !== 'disarmed' ? [['alarm_disarm', t('Disarm {{name}}', { name })]] : []);
}

function redirectToExplicitCommand(selected) {
  const entityId = selected.entity.entity_id;
  const commandIndex = results.findIndex(
    (item) => item.service && item.entity?.entity_id === entityId
  );
  if (commandIndex >= 0) {
    hint.hidden = true;
    updateHighlightedResult(commandIndex);
    return;
  }
  const name = utils.getEntityDisplayName(selected.entity);
  const hasCommand = (paletteCommands || []).some((item) => item.entity?.entity_id === entityId);
  hint.textContent = hasCommand
    ? getEntityDomain(entityId) === 'alarm_control_panel'
      ? t('To control {{name}}, type "arm" or "disarm".', { name })
      : t('To control {{name}}, type "lock" or "unlock".', { name })
    : t('No command is available for {{name}}.', { name });
  hint.hidden = false;
}

async function executeHighlightedResult() {
  const selected = results[highlightedIndex];
  if (!selected || executing) return;
  if (
    !selected.service &&
    !selected.tabId &&
    COMMAND_ONLY_DOMAINS.has(getEntityDomain(selected.entity.entity_id))
  ) {
    redirectToExplicitCommand(selected);
    return;
  }
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
      let current = state.STATES[selected.entity.entity_id];
      const allowed = () =>
        websocket.isConnected() &&
        current &&
        buildPaletteCommands([current], state.CONFIG, state.SERVICES).some(
          (item) => item.service === selected.service && item.domain === selected.domain
        );
      if (!allowed()) throw new Error(t('Entity is unavailable'));
      let code = null;
      if (
        selected.domain === 'alarm_control_panel' &&
        current.attributes?.code_format &&
        (selected.service === 'alarm_disarm' || current.attributes?.code_arm_required !== false)
      ) {
        const connection = JSON.stringify(state.CONFIG.homeAssistant);
        code = await requestAlarmCode(current);
        if (code === null) return;
        current = state.STATES[selected.entity.entity_id];
        if (connection !== JSON.stringify(state.CONFIG.homeAssistant) || !allowed())
          throw new Error(t('Entity is unavailable'));
      }
      await websocket.callService(selected.domain, selected.service, {
        entity_id: current.entity_id,
        ...(code !== null ? { code } : {}),
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
  // The input keeps focus and the arrows move the highlight (aria-activedescendant), so the rows
  // are not Tab stops: Tab would walk up to twenty of them, and Enter would run the highlighted
  // row rather than the one under the focus ring.
  row.tabIndex = -1;
  row.id = `command-palette-result-${index}`;
  row.setAttribute('role', 'option');
  row.setAttribute('aria-selected', 'false');

  const icon = createElement('span', 'command-palette-result-icon');
  if (entity) renderEntityIcon(icon, entity);
  else setLineIconContent(icon, 'list');
  icon.setAttribute('aria-hidden', 'true');

  const main = createElement('span', 'command-palette-result-main');
  const name = createElement('span', 'command-palette-result-name', displayName);
  main.append(name);

  const meta = createElement('span', 'command-palette-result-meta');
  const domain = createElement(
    'span',
    'command-palette-result-domain',
    item.tabId ? t('Page') : utils.getEntityTypeDescription(entity)
  );
  const value = createElement(
    'span',
    'command-palette-result-state',
    entity ? utils.getEntityDisplayState(entity) : ''
  );
  // Long type names ("Panel de control de alarma") end in an ellipsis; the title keeps them whole.
  domain.title = domain.textContent;
  meta.append(domain, value);

  row.append(icon, main, meta);
  row.addEventListener('mousemove', (event) => {
    const position = `${event.screenX},${event.screenY}`;
    const moved = lastPointerPosition !== null && position !== lastPointerPosition;
    lastPointerPosition = position;
    if (moved && highlightedIndex !== index) updateHighlightedResult(index);
  });
  // Anything that focuses a row (a click, a screen reader) moves the highlight with it, so Enter
  // always runs the row that is selected.
  row.addEventListener('focus', () => {
    if (highlightedIndex !== index) updateHighlightedResult(index);
  });
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
    .filter((item) => query.trim() || !QUERY_ONLY_SERVICES.has(item.service))
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
  hint.hidden = true;
  updateHighlightedResult(highlightedIndex);
}

function openCommandPalette() {
  ensurePaletteShell();
  applyPaletteLabels();
  // The overlay is the dialog: it names itself, traps focus and answers Escape and a click on
  // the backdrop as the top layer, so Escape pressed with focus on <body> closes the palette and
  // not a dialog open underneath it. Focus goes back to whatever opened it, found again if that
  // was a tile rebuilt while the palette was up. The search field takes focus below.
  openDialog(overlay, {
    display: null,
    label: t('Command palette'),
    initialFocus: false,
    dismiss: () => closeCommandPalette(),
  });
  overlay.setAttribute('aria-hidden', 'false');
  input.setAttribute('aria-expanded', 'true');
  input.value = '';
  paletteCommands = null;
  lastPointerPosition = null;
  renderResults();
  requestAnimationFrame(() => {
    input.focus();
    input.select();
  });
}

function closeCommandPalette({ restoreFocus = true } = {}) {
  if (!overlay) return;
  void closeDialog(overlay, { animate: false, restoreFocus });
  overlay.setAttribute('aria-hidden', 'true');
  paletteCommands = null;
  input?.setAttribute('aria-expanded', 'false');
  input?.removeAttribute('aria-activedescendant');
}

function handleGlobalKeydown(event) {
  const key = typeof event.key === 'string' ? event.key.toLowerCase() : '';
  const isCommandPaletteShortcut =
    key === 'k' && (event.ctrlKey || event.metaKey) && !event.altKey && !event.shiftKey;
  if (!isCommandPaletteShortcut) return;
  if (isTypingTarget(event.target) && !isPaletteOpen()) return;
  // Behind the first-run wizard or the connecting screen the palette would open out of sight and
  // take the keyboard from the controls that are showing.
  if (
    document.body.classList.contains('first-run-active') ||
    document.querySelector('#loading-overlay:not(.hidden)')
  ) {
    return;
  }

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
    ).filter((element) => element.getAttribute('aria-hidden') !== 'true' && element.tabIndex >= 0);
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
    // On the Close button Enter is that button's own click, not a command.
    if (event.target?.closest?.('.command-palette-close')) return;
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
  buildPaletteCommands,
  initializeCommandPalette,
  openCommandPalette,
  closeCommandPalette,
  rankCommandPaletteEntities,
  scoreCommandPaletteMatch,
};

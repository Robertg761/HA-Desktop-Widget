import state from './state.js';
import * as utils from './utils.js';
import {
  openEntityDetailModal,
  getEntityDomain,
  switchQuickAccessPage,
  requestAlarmCode,
  hasEntityAction,
  describeServiceErrorMessage,
  isConnectionServiceError,
} from './ui.js';
import websocket from './websocket.js';
import { closeDialog, openDialog, showToast } from './ui-utils.js';
import { formatNumber, t } from './i18n.js';
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
let footer = null;
let statusRegion = null;
let unsubscribeStates = null;
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
// The kinds of device the palette has named commands for: Turn on and Turn off, Run, Lock and
// Unlock, Arm and Disarm. buildPaletteCommands reads these, and so does the decision whether Enter
// on a result may act (hasCommandDomain), so the two cannot drift apart.
const TOGGLE_COMMAND_DOMAINS = new Set(['light', 'switch', 'fan', 'input_boolean']);
const RUN_COMMAND_DOMAINS = new Set(['scene', 'script']);

// The same text rules as every other search, keeping dots so an entity id still reads as one.
function normalizeSearchValue(value) {
  return normalizeSearchText(value, { keepDots: true });
}

// Fuzzy (in-order, gaps allowed) matching only helps with an abbreviation of a real word. With one
// or two letters nearly every name has them somewhere, and over a long name any word does: "disarm"
// scattered through "Upstairs hallway ceiling pendant light" is not a match. So it needs three letters
// and a match that stays close together.
const MIN_FUZZY_QUERY_LENGTH = 3;

function getSubsequenceScore(text, query) {
  if (query.length < MIN_FUZZY_QUERY_LENGTH) return 0;
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
  if (span > Math.max(query.length * 2, query.length + 4)) return 0;
  const gaps = Math.max(0, span - query.length);
  return Math.max(1, 400 - firstMatch - gaps);
}

// With `fuzzy` off only an exact, prefix, substring or all-the-words match counts; entity ids are
// matched that way, since an id is not a word to abbreviate.
function scoreCommandPaletteMatch(text, query, { fuzzy = true } = {}) {
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

  // Every word of the query somewhere in the text, in any order: "lamp desk" finds "Desk lamp".
  const words = normalizedQuery.split(' ');
  if (words.length > 1 && words.every((word) => normalizedText.includes(word))) {
    return Math.max(300, 450 - normalizedText.indexOf(words[0]));
  }

  return fuzzy ? getSubsequenceScore(normalizedText, normalizedQuery) : 0;
}

// The object id on its own ("kitchen" of light.kitchen), unless the query carries a dot, which is
// part of a full id. Matching the whole id made every domain a prefix: "a" put every
// alarm_control_panel.* ahead of the entities actually named for it.
function scoreEntityIdMatch(entityId, query) {
  const target = String(query ?? '').includes('.')
    ? entityId
    : entityId.slice(entityId.indexOf('.') + 1);
  return scoreCommandPaletteMatch(target, query, { fuzzy: false });
}

function rankCommandPaletteEntities(entities, query, options = {}) {
  const getDisplayName = options.getDisplayName || utils.getEntityDisplayName;
  return Array.from(entities || [])
    .filter((entity) => entity?.entity_id)
    .map((entity) => {
      const displayName = getDisplayName(entity);
      const nameScore = scoreCommandPaletteMatch(displayName, query);
      const idScore = scoreEntityIdMatch(entity.entity_id, query);
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

// Input types that take typed text. A checkbox, a slider or a button has no use for Ctrl+K, so the
// palette opens from them as it does from the page.
const TEXT_INPUT_TYPES = new Set([
  'text',
  'search',
  'email',
  'url',
  'tel',
  'password',
  'number',
  'date',
  'datetime-local',
  'month',
  'time',
  'week',
]);

function isTextEntryTarget(target) {
  if (!target || target === document.body) return false;
  const tagName = target.tagName?.toLowerCase();
  if (tagName === 'input') return TEXT_INPUT_TYPES.has((target.type || 'text').toLowerCase());
  return tagName === 'textarea' || target.isContentEditable === true;
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
  // Spoken through the status region below. A live region that starts hidden and changes its text
  // and its visibility in one go is not announced, so the visible hint stays out of the way.
  hint.setAttribute('aria-hidden', 'true');
  hint.hidden = true;

  footer = createElement('div', 'command-palette-footer');
  footer.hidden = true;

  // Always present, so screen readers have a region to watch when its text changes: the number of
  // results, that nothing matched, or the hint.
  statusRegion = createElement('div', 'sr-only');
  statusRegion.setAttribute('role', 'status');
  statusRegion.setAttribute('aria-live', 'polite');
  statusRegion.setAttribute('aria-atomic', 'true');

  palettePanel.append(searchWrap, list, emptyState, hint, footer, statusRegion);
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
  if (list) list.setAttribute('aria-label', t('Search results'));
}

function ensurePaletteShell() {
  if (!overlay || !input || !list || !emptyState || !hint || !footer || !statusRegion) {
    createPaletteShell();
  }
}

function announce(text) {
  if (statusRegion) statusRegion.textContent = text;
}

function showHint(text) {
  hint.textContent = text;
  hint.hidden = false;
  announce(text);
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
      (entity.state === 'unknown' && !RUN_COMMAND_DOMAINS.has(domain))
    )
      return [];
    // Only offer the action that changes something: a device that is on gets "Turn off".
    const actions = TOGGLE_COMMAND_DOMAINS.has(domain)
      ? [
          entity.state !== 'on' && ['turn_on', t('Turn on {{name}}', { name })],
          entity.state !== 'off' && ['turn_off', t('Turn off {{name}}', { name })],
        ].filter(Boolean)
      : RUN_COMMAND_DOMAINS.has(domain)
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

// Whether the palette lists a command (turn on, run, lock) for the entity right now.
function hasCommandFor(entityId) {
  return (paletteCommands || []).some((item) => item.entity?.entity_id === entityId);
}

// Whether the palette has commands for this kind of device, whether or not it lists one right now.
// A switch whose state is unknown has no Turn on or Turn off, and none are listed before Home
// Assistant has answered get_services, yet Enter on its result must still only say what it is: the
// command that acts is the row beside it, when there is one. The list cannot decide this.
function hasCommandDomain(entityId) {
  const domain = getEntityDomain(entityId);
  return (
    TOGGLE_COMMAND_DOMAINS.has(domain) ||
    RUN_COMMAND_DOMAINS.has(domain) ||
    COMMAND_ONLY_DOMAINS.has(domain)
  );
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
  showHint(
    hasCommandFor(entityId)
      ? getEntityDomain(entityId) === 'alarm_control_panel'
        ? t('To control {{name}}, type “arm” or “disarm”.', { name })
        : t('To control {{name}}, type “lock” or “unlock”.', { name })
      : t('No command is available for {{name}}.', { name })
  );
}

async function executeHighlightedResult() {
  const selected = results[highlightedIndex];
  if (!selected || executing) return;
  if (!selected.service && !selected.tabId) {
    if (COMMAND_ONLY_DOMAINS.has(getEntityDomain(selected.entity.entity_id))) {
      redirectToExplicitCommand(selected);
      return;
    }
    // Sun, a person, an update or a binary sensor have no controls and nothing to run. Closing on
    // them looked like a click that failed, so the palette stays and says so.
    if (!hasEntityAction(selected.entity)) {
      showHint(
        t('No command is available for {{name}}.', {
          name: utils.getEntityDisplayName(selected.entity),
        })
      );
      return;
    }
  }
  const hasCommand = hasCommandDomain(selected.entity?.entity_id);
  closeCommandPalette();
  if (!selected.service && !selected.tabId) {
    // Opened entities are remembered too, so what is looked up often is where an empty search starts.
    rememberRecentCommand(selected.key);
    openEntityDetailModal(selected.entity, { source: 'command-palette', hasCommand });
    return;
  }
  executing = true;
  try {
    if (selected.tabId) {
      const result = await switchQuickAccessPage(selected.tabId);
      if (result?.success === false) return;
    } else {
      let current = state.STATES[selected.entity.entity_id];
      const ensureConnected = () => {
        // A connection error, so the toast says to check the connection and not that the entity
        // is unavailable.
        if (!websocket.isConnected()) throw new Error('WebSocket not connected');
      };
      const allowed = () =>
        current &&
        buildPaletteCommands([current], state.CONFIG, state.SERVICES).some(
          (item) => item.service === selected.service && item.domain === selected.domain
        );
      ensureConnected();
      if (!allowed()) throw new Error(t('Entity is unavailable'));
      let code = null;
      if (
        selected.domain === 'alarm_control_panel' &&
        current.attributes?.code_format &&
        (selected.service === 'alarm_disarm' || current.attributes?.code_arm_required !== false)
      ) {
        const connection = JSON.stringify(state.CONFIG.homeAssistant);
        // The dialog repeats which command it is for ("Disarm Home alarm") on a button that says it.
        code = await requestAlarmCode(current, {
          title: selected.displayName,
          submitLabel: selected.service === 'alarm_disarm' ? t('Disarm') : t('Arm'),
        });
        if (code === null) return;
        current = state.STATES[selected.entity.entity_id];
        ensureConnected();
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
  } catch (error) {
    // Home Assistant's own reason (a wrong alarm code, a refused service) is what helps the user;
    // only a lost connection gets the generic advice.
    showToast(
      isConnectionServiceError(error)
        ? t('Could not run command. Check your connection and retry.')
        : t('Could not run command: {{errorMessage}}', {
            errorMessage: describeServiceErrorMessage(error),
          }),
      'error'
    );
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
  // A dead entity is dimmed as its tile is, so it does not look as ready as a working one.
  if (entity?.state === 'unavailable') row.classList.add('is-unavailable');

  const icon = createElement('span', 'command-palette-result-icon');
  if (entity) renderEntityIcon(icon, entity);
  else setLineIconContent(icon, 'list');
  icon.setAttribute('aria-hidden', 'true');

  const main = createElement('span', 'command-palette-result-main');
  const name = createElement('span', 'command-palette-result-name', displayName);
  main.append(name);

  const meta = createElement('span', 'command-palette-result-meta');
  // A command row says what kind of row it is, not the entity's state before the command runs (a
  // "Turn on" row showing "Off" read as if it were the result).
  const domain = createElement(
    'span',
    'command-palette-result-domain',
    item.tabId ? t('Page') : item.service ? t('Command') : utils.getEntityTypeDescription(entity)
  );
  const value = createElement(
    'span',
    'command-palette-result-state',
    entity && !item.service ? utils.getEntityDisplayState(entity) : ''
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

// What an empty search lists: what was used last, then the pages to switch to, then the entities of
// the page on screen, then the rest by name, then the device commands. Sorting all of them by score
// (every score being 1) kept only the first twenty entities alphabetically, and no command or page
// ever showed in a home of any size.
function orderForEmptyQuery(entityRows, commands) {
  const ordered = [];
  const taken = new Set();
  const add = (item) => {
    if (!item || taken.has(item)) return;
    taken.add(item);
    ordered.push(item);
  };
  const byKey = new Map();
  [...entityRows, ...commands].forEach((item) => {
    if (!item.key) return;
    byKey.set(item.key, [...(byKey.get(item.key) || []), item]);
  });
  recentCommands.forEach((key) => {
    (byKey.get(key) || []).filter((item) => !QUERY_ONLY_SERVICES.has(item.service)).forEach(add);
  });
  commands.filter((item) => item.tabId).forEach(add);
  const rowById = new Map(entityRows.map((item) => [item.entity.entity_id, item]));
  const activeTab = getActiveQuickAccessTab(state.CONFIG);
  (activeTab?.entityIds || []).forEach((entityId) => add(rowById.get(entityId)));
  entityRows.forEach(add);
  // A small home has room for its commands too, by name; in a large one they fall past the cut and
  // are found by searching.
  commands
    .filter((item) => !item.tabId && !QUERY_ONLY_SERVICES.has(item.service))
    .sort((a, b) => compareNames(a.displayName, b.displayName))
    .forEach(add);
  return ordered;
}

// Says why the list is empty. An empty search with no entities is not "no match": nothing has
// loaded, or the connection is down.
function renderEmptyState(query, hasEntities) {
  const title = createElement('div', 'command-palette-empty-title');
  const detail = createElement('div', 'command-palette-empty-hint');
  if (!query.trim() && !hasEntities) {
    title.textContent = websocket.isConnected()
      ? t('Waiting for live Home Assistant data...')
      : t('Not connected to Home Assistant');
    emptyState.replaceChildren(title);
    return title.textContent;
  }
  title.textContent = t('No matching results');
  detail.textContent = t('Try a device name, a command like “turn on”, or a page name');
  emptyState.replaceChildren(title, detail);
  return title.textContent;
}

// Whether two rows stand for the same thing: one entity, one command on it, one page.
function isSameResult(a, b) {
  return a.key === b.key && a.service === b.service;
}

function renderResults({ keepHighlight = false } = {}) {
  const query = input?.value || '';
  const highlighted = keepHighlight ? results[highlightedIndex] : null;
  const server = state.CONFIG?.homeAssistant?.url || '';
  if (recentServer !== server) {
    recentCommands = readRecentCommands(state.CONFIG);
    recentServer = server;
  }
  const entities = Object.values(state.STATES || {});
  // Building commands interpolates a label per entity action, so do it once per open rather than
  // on every keystroke. Execution re-reads the live entity state before sending anything.
  paletteCommands ??= buildPaletteCommands(entities);
  const entityRows = rankCommandPaletteEntities(entities, query).map((item) => ({
    ...item,
    key: `entity:${item.entity.entity_id}`,
  }));
  let ranked;
  if (query.trim()) {
    const commands = paletteCommands
      .map((item) => ({ ...item, score: scoreCommandPaletteMatch(item.displayName, query) }))
      .filter((item) => item.score > 0);
    ranked = [...entityRows, ...commands].sort((a, b) => b.score - a.score);
  } else {
    ranked = orderForEmptyQuery(entityRows, paletteCommands);
  }
  results = ranked.slice(0, MAX_RESULTS);
  const kept = highlighted ? results.findIndex((item) => isSameResult(item, highlighted)) : -1;
  highlightedIndex = kept >= 0 ? kept : results.length ? 0 : -1;
  list.replaceChildren();

  results.forEach((item, index) => {
    list.appendChild(createResultRow(item, index));
  });

  const truncated = ranked.length > results.length;
  footer.hidden = !truncated;
  footer.textContent = truncated
    ? t('Showing {{shown}} of {{total}} results', {
        shown: formatNumber(results.length),
        total: formatNumber(ranked.length),
      })
    : '';
  emptyState.hidden = results.length > 0;
  let spoken;
  if (results.length) {
    emptyState.replaceChildren();
    spoken = truncated
      ? footer.textContent
      : t('Results: {{count}}', { count: formatNumber(results.length) });
  } else {
    spoken = renderEmptyState(query, entities.length > 0);
  }
  hint.hidden = true;
  input.setAttribute('aria-expanded', String(results.length > 0));
  announce(spoken);
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
  input.value = '';
  paletteCommands = null;
  lastPointerPosition = null;
  renderResults();
  // A full snapshot (the first one after launch, or one after a reconnect) replaces every entity
  // under an open palette. Page commands and last session's entities can already fill the list
  // before it arrives, so it is redrawn whether or not the list was empty, with the row the
  // keyboard is on kept.
  unsubscribeStates?.();
  unsubscribeStates =
    state.subscribeStates?.(() => {
      if (!isPaletteOpen()) return;
      paletteCommands = null;
      renderResults({ keepHighlight: true });
    }) || null;
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
  unsubscribeStates?.();
  unsubscribeStates = null;
  input?.setAttribute('aria-expanded', 'false');
  input?.removeAttribute('aria-activedescendant');
  announce('');
}

function handleGlobalKeydown(event) {
  const key = typeof event.key === 'string' ? event.key.toLowerCase() : '';
  const isCommandPaletteShortcut =
    key === 'k' && (event.ctrlKey || event.metaKey) && !event.altKey && !event.shiftKey;
  if (!isCommandPaletteShortcut) return;
  // Ctrl+K has no meaning in a text field, apart from a Mac's "delete to the end of the line"; the
  // palette opens from there too, and from checkboxes and sliders, which is where the Quick
  // Access search that advertises the shortcut sits.
  if (
    !isPaletteOpen() &&
    isTextEntryTarget(event.target) &&
    window.electronAPI?.platform === 'darwin' &&
    !event.metaKey
  ) {
    return;
  }
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

  // While an input method is composing, Enter commits the candidate, the arrows pick one and
  // Escape cancels the composition: none of them is the palette's. (Some engines report the key
  // after the composition ends with keyCode 229 and isComposing false.)
  if (event.isComposing || event.keyCode === 229) return;

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

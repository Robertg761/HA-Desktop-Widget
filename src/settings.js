import { applyDesktopAppearance } from './desktop-appearance.js';
import { getAlertStateSuggestions, normalizeAlertState } from './alert-rules.js';
import { initializeSettingsSearch } from './settings-search.js';
import { initializeSettingsFiles } from './settings-files-ui.js';
import { createEmojiSupportCheck } from './emoji-support.js';
import { clearFieldError, clearFieldErrors, showFieldError } from './field-errors.js';
import { paginate, renderListPager } from './list-pager.js';
import { linkSettingsHelpText, setDescribedByLine } from './settings-help-links.js';
import state from './state.js';
import log from './logger.js';
import websocket from './websocket.js';
import {
  applyTheme,
  applyAccentTheme,
  applyAccentThemeFromColor,
  applyBackgroundTheme,
  applyBackgroundThemeFromColor,
  getAccentThemes,
  getBackgroundWindowColor,
  setCustomThemes,
  applyUiPreferences,
  suspendSeasonalColors,
  applyWindowEffects,
  isFrostedGlassAvailable,
  openDialog,
  closeDialog,
  disableControlsKeepingFocus,
  findFocusKey,
  showToast,
  showConfirm,
  copyTextToClipboard,
} from './ui-utils.js';
import {
  cleanupHotkeyEventListeners,
  describeHotkeyFailure,
  describeRecording,
  flashHotkeyRow,
  formatHotkey,
  recordKeyEvent,
} from './hotkeys.js';
import { getNextTabIndex, getTextDirection, syncRovingTabIndex } from './tab-navigation.js';
import { prefersReducedMotion, syncSlidingIndicator } from './motion.js';
import {
  describeHomeAssistantOAuthFailure,
  describeHomeAssistantOAuthReauthReason,
  describeHomeAssistantOAuthRefreshError,
  renderConnectionStatus,
  setConnectionStatusBusy,
} from './connection-status.js';
import * as utils from './utils.js';
import {
  entityIconMarkup,
  lineIconMarkup,
  renderEntityIcon,
  setLineIconContent,
} from './entity-icons.js';
import {
  PRIMARY_CARD_DEFAULTS,
  PRIMARY_CARD_NONE,
  normalizePrimaryCards,
} from './primary-cards.js';
import {
  formatDate,
  formatNumber,
  getFormatLocale,
  getLanguageDisplayName,
  getLocaleState,
  isolateLtr,
  t,
} from './i18n.js';
import {
  compareNames,
  foldSearchMarks,
  formatClockDateTime,
  formatClockTime,
  formatList,
  formatPercent,
  getClockFaceTimeOptions,
} from './format.js';
import {
  SHOW_DURATION_MS,
  findActiveHoliday,
  findNextHoliday,
  getEnabledHolidayIds,
  getHolidayById,
  getUpcomingHolidayRange,
  isSeasonalEnabled,
  normalizeSeasonalSettings,
} from './seasonal-calendar.js';
import {
  classifyConnectionError,
  isPlaceholderOrEmptyToken,
  normalizeBaseUrl,
  startHomeAssistantPairing,
} from './connection.js';

const BUILTIN_LANGUAGE_OPTIONS = new Set(['auto', 'en', 'de']);

let previewState = null;
let previewRaf = null;
let previewAccent = null;
let pendingAccent = null;
let previewBackground = null;
let pendingBackground = null;
// Theme mode picked in Settings but not saved yet (null = unchanged).
let pendingThemeMode = null;
const THEME_MODES = ['auto', 'dark', 'light'];
const COLOR_TARGETS = {
  accent: 'accent',
  background: 'background',
};
// Called at render time so the warning follows the active language.
const getFrostedGlassUnavailableMessage = () => t('Needs Windows 11 version 22H2 or later.');
// While Frosted glass is off the effects are held back, not turned off: the switch keeps its
// position and the effects return with the glass. The line says which of the two it is.
const getWeatherEffectsGlassWarning = (effectsOn = false) =>
  isFrostedGlassAvailable(state.CONFIG)
    ? effectsOn
      ? t('Subtle weather effects need Frosted glass, so they are paused.')
      : t('Turn on Frosted glass background before enabling subtle weather effects.')
    : getFrostedGlassUnavailableMessage();
const WEATHER_UNAVAILABLE_STATES = new Set(['unknown', 'unavailable']);
let activeColorTarget = COLOR_TARGETS.accent;
let themeTooltip = null;
let themeTooltipScrollBound = false;
let pendingPrimaryCards = null;
let pendingCustomEntityIcons = {};
let activeCustomEntityIconPickerEntityId = null;
let customEntityIconPickerQueryByEntityId = {};
let lastCustomEntityIconAction = null;
let customEntityIconPage = 0;
let customEntityIconSearchTimer;
let pendingCustomColors = [];
let activeCustomManagementThemeId = null;
let isSyncingCustomColorEditor = false;
let lastValidCustomColorHex = '#64B5F6';
let hasDraftColorPreview = false;
let isCustomEditorActive = false;
let settingsUiHooks = null;
let languageSaveQueue = Promise.resolve();
// The Start at login state shown when Settings opened, so Save only writes a real change.
let loadedStartAtLogin = null;
let profileSyncStatusCache = null;
let profileSyncErrorObserver = null;
let localePackListCache = [];
let localePackListError = '';
let languagePackRefreshPromise = Promise.resolve();
let languagePackRefreshGeneration = 0;
const PERSONALIZATION_SECTION_STATE_KEY = 'personalizationSectionsCollapsed';
const PERSONALIZATION_SECTION_PERSIST_DEBOUNCE_MS = 250;
const PERSONALIZATION_LAZY_SECTION_IDS = new Set([
  'primary-cards-section',
  'custom-entity-icons-section',
]);
const personalizationSectionPersistTimers = new Map();
const hydratedPersonalizationSections = new Set();
const CUSTOM_THEME_ID_PREFIX = 'custom-';

function applyPersistedConfigResponse(updatedConfig) {
  if (!updatedConfig || updatedConfig.success === false || !updatedConfig.homeAssistant) {
    throw new Error(updatedConfig?.error || t('The main process rejected the settings update'));
  }

  const persistentConfig = { ...updatedConfig };
  delete persistentConfig.configRecovery;
  delete persistentConfig.configRevision;
  delete persistentConfig.persistenceWarnings;
  delete persistentConfig.runtimeWarnings;
  state.setConfig(persistentConfig);

  return persistentConfig;
}
const CUSTOM_EDITOR_SCOPE_SELECTOR = [
  '#custom-color-picker',
  '#custom-color-r',
  '#custom-color-g',
  '#custom-color-b',
  '#custom-color-hex',
  '#custom-color-name-input',
  '#save-custom-color-btn',
  '#rename-custom-color-btn',
  '#remove-custom-color-btn',
].join(', ');
const ICON_GRAPHEME_SEGMENTER =
  typeof Intl !== 'undefined' && typeof Intl.Segmenter === 'function'
    ? new Intl.Segmenter(undefined, { granularity: 'grapheme' })
    : null;
const CUSTOM_ENTITY_ICON_FALLBACKS = [
  '💡',
  '🔌',
  '💨',
  '🌡️',
  '💧',
  '🔋',
  '⚡',
  '📈',
  '🏃',
  '🧍',
  '🚪',
  '🪟',
  '✔️',
  '❌',
  '🎵',
  '📷',
  '🔒',
  '🔓',
  '🏠',
  '✈️',
  '⏲️',
  '🛡️',
  '🤖',
  '✨',
  '🧹',
  '🔥',
  '❄️',
  '🌙',
  '☀️',
  '⭐',
  '🛋️',
  '🛏️',
  '🍳',
  '🚿',
];

// Windows before 11 22H2 cannot blur behind the window, so the widget draws the solid panel and
// the switch shows off and locked. Saving leaves a locked switch alone, so the saved choice comes
// back into effect if the machine is upgraded.
function syncFrostedGlassAvailability() {
  const frostedGlass = document.getElementById('frosted-glass');
  if (!frostedGlass) return;
  const unavailable = !isFrostedGlassAvailable(state.CONFIG);
  frostedGlass.disabled = unavailable;
  frostedGlass.title = unavailable ? getFrostedGlassUnavailableMessage() : '';
  if (unavailable) frostedGlass.checked = false;
  const warning = document.getElementById('frosted-glass-warning');
  if (warning) {
    warning.classList.toggle('hidden', !unavailable);
    warning.textContent = getFrostedGlassUnavailableMessage();
  }
}

function syncWeatherEffectsAvailability(options = {}) {
  const { showWarning = false } = options;
  const frostedGlass = document.getElementById('frosted-glass');
  const weatherEffectsEnabled = document.getElementById('weather-effects-enabled');
  const weatherOverrideGroup = document.getElementById('weather-override-group');
  const warning = document.getElementById('weather-effects-warning');
  if (!weatherEffectsEnabled) return true;

  const frostedGlassEnabled = !!frostedGlass?.checked;
  // Where the glass cannot be drawn at all the switch reads off (the saved choice is left alone, as
  // Save skips a locked switch). Where the person only turned the glass off, it keeps its position.
  if (!isFrostedGlassAvailable(state.CONFIG)) weatherEffectsEnabled.checked = false;
  const effectsOn = !!weatherEffectsEnabled.checked;
  // Locked, not cleared: turning Frosted glass off used to untick this switch, so turning the glass
  // back on found the person's choice gone.
  weatherEffectsEnabled.disabled = !frostedGlassEnabled;
  weatherEffectsEnabled.setAttribute('aria-disabled', String(!frostedGlassEnabled));
  weatherEffectsEnabled.title = frostedGlassEnabled ? '' : getWeatherEffectsGlassWarning(effectsOn);

  if (weatherOverrideGroup) {
    weatherOverrideGroup.style.display = frostedGlassEnabled && effectsOn ? '' : 'none';
  }

  if (warning) {
    warning.classList.toggle('hidden', frostedGlassEnabled);
    warning.textContent = getWeatherEffectsGlassWarning(effectsOn);
  }

  if (!frostedGlassEnabled && showWarning && effectsOn) {
    showToast(getWeatherEffectsGlassWarning(true), 'warning', 3500);
  }

  return frostedGlassEnabled;
}

function isAvailableWeatherEntity(entity) {
  if (typeof entity?.entity_id !== 'string' || !entity.entity_id.startsWith('weather.')) {
    return false;
  }
  return !WEATHER_UNAVAILABLE_STATES.has(String(entity.state || '').toLowerCase());
}

function getAvailableWeatherEntities() {
  return Object.values(state.STATES || {})
    .filter(isAvailableWeatherEntity)
    .sort((a, b) => compareNames(utils.getEntityDisplayName(a), utils.getEntityDisplayName(b)));
}

// Desktop layer mode keeps the widget behind normal windows, so it has no use for being on top or
// for hiding when it loses focus, and Settings turns both switches off. A disabled switch ignores
// clicks but still shows its title on hover, which is where it says why.
function syncLayerModeSwitchReasons() {
  const reason = t('Desktop layer mode keeps the widget behind normal windows.');
  for (const id of ['always-on-top', 'hide-on-blur']) {
    const input = document.getElementById(id);
    if (input) input.title = input.disabled ? reason : '';
  }
  // A disabled switch takes no pointer events, so its title is never shown. Always on top has no
  // help text of its own, so the reason is written under it while the switch cannot be used.
  const help = document.getElementById('always-on-top-help');
  const alwaysOnTop = document.getElementById('always-on-top');
  if (help && alwaysOnTop) {
    help.hidden = !alwaysOnTop.disabled;
    help.textContent = alwaysOnTop.disabled ? reason : '';
  }
}

function populateWeatherEntitySelect() {
  const select = document.getElementById('weather-entity-select');
  const help = document.getElementById('weather-entity-help');
  if (!select) return;

  const availableEntities = getAvailableWeatherEntities();
  const selectedEntityId = state.CONFIG?.selectedWeatherEntity;
  const selectedEntity = selectedEntityId ? state.STATES?.[selectedEntityId] : null;
  const selectedIsAvailable = availableEntities.some(
    (entity) => entity.entity_id === selectedEntityId
  );

  select.replaceChildren();
  const automaticOption = document.createElement('option');
  automaticOption.value = '';
  automaticOption.textContent = t('Automatic (first available)');
  select.appendChild(automaticOption);

  // Keep a saved but temporarily unavailable weather source visible and intact. The
  // widget falls back to Automatic until Home Assistant reports it as available again.
  if (
    typeof selectedEntityId === 'string' &&
    !selectedIsAvailable &&
    selectedEntityId.startsWith('weather.')
  ) {
    const unavailableOption = document.createElement('option');
    unavailableOption.value = selectedEntityId;
    unavailableOption.disabled = true;
    unavailableOption.dataset.savedUnavailable = 'true';
    unavailableOption.textContent = t('Unavailable saved source: {{entityId}}', {
      entityId: selectedEntity ? utils.getEntityDisplayName(selectedEntity) : selectedEntityId,
    });
    select.appendChild(unavailableOption);
  }

  availableEntities.forEach((entity) => {
    const option = document.createElement('option');
    option.value = entity.entity_id;
    option.textContent = `${utils.getEntityDisplayName(entity)} (${entity.entity_id})`;
    select.appendChild(option);
  });

  select.value =
    selectedIsAvailable || select.querySelector('[data-saved-unavailable]') ? selectedEntityId : '';

  if (help) {
    if (
      typeof selectedEntityId === 'string' &&
      !selectedIsAvailable &&
      selectedEntityId.startsWith('weather.')
    ) {
      help.textContent = t(
        'The saved weather source is unavailable. The widget is using the first available source until it returns.'
      );
    } else if (availableEntities.length) {
      help.textContent = t('Choose the Home Assistant weather entity used by the weather card.');
    } else {
      help.textContent = t(
        'No available weather entities found. Connect Home Assistant or try again later.'
      );
    }
  }
}

const CUSTOM_ENTITY_ICON_SEARCH_ALIASES = {
  '💡': ['light', 'lamp', 'bulb'],
  '🔌': ['plug', 'socket', 'power'],
  '💨': ['fan', 'wind', 'air'],
  '🌡️': ['temperature', 'thermometer', 'temp', 'thermostat', 'climate', 'hvac'],
  '💧': ['humidity', 'water', 'moisture'],
  '🔋': ['battery', 'charge', 'power'],
  '⚡': ['energy', 'electric', 'power'],
  '📈': ['sensor', 'chart', 'trend'],
  '🏃': ['motion', 'active', 'running'],
  '🧍': ['motion', 'clear', 'idle'],
  '🚪': ['door', 'entry'],
  '🪟': ['window'],
  '✔️': ['on', 'enabled', 'detected'],
  '❌': ['off', 'disabled', 'clear'],
  '🎵': ['media', 'music', 'audio'],
  '📷': ['camera', 'snapshot'],
  '🔒': ['lock', 'locked', 'secure'],
  '🔓': ['unlock', 'unlocked', 'open'],
  '🏠': ['home', 'house', 'garage'],
  '✈️': ['away', 'travel', 'vacation'],
  '⏲️': ['timer', 'countdown', 'clock'],
  '🛡️': ['security', 'shield', 'alarm'],
  '🤖': ['automation', 'robot', 'bot'],
  '✨': ['scene', 'sparkle'],
  '🧹': ['vacuum', 'clean', 'cleanup'],
  '🔥': ['heat', 'heating', 'fire'],
  '❄️': ['cool', 'cooling', 'cold'],
  '🌙': ['night', 'sleep', 'moon'],
  '☀️': ['day', 'sun', 'bright'],
  '⭐': ['favorite', 'star'],
  '🛋️': ['living room', 'sofa'],
  '🛏️': ['bedroom', 'bed', 'sleep'],
  '🍳': ['kitchen', 'cook', 'food'],
  '🚿': ['bathroom', 'shower'],
  // Devices Home Assistant users name their entities after. The emoji catalog carries no words of
  // its own, so a search for these finds nothing without them.
  '📺': ['tv', 'television', 'screen'],
  '🖥️': ['computer', 'desktop', 'monitor', 'pc', 'screen'],
  '💻': ['computer', 'laptop', 'pc'],
  '🚗': ['car', 'garage', 'vehicle', 'auto'],
  '🚙': ['car', 'suv', 'vehicle'],
  '🐶': ['dog', 'puppy', 'pet'],
  '🐕': ['dog', 'pet'],
  '🐱': ['cat', 'kitten', 'pet'],
  '🐈': ['cat', 'pet'],
  '🧺': ['laundry', 'washer', 'washing machine', 'dryer'],
  '🫧': ['washer', 'washing machine', 'dishwasher', 'bubbles'],
  '🧼': ['soap', 'wash', 'washer', 'dishwasher'],
  '🧊': ['fridge', 'refrigerator', 'freezer', 'ice'],
  '📡': ['router', 'antenna', 'satellite'],
  '🛜': ['wifi', 'router', 'wireless', 'network'],
  '📶': ['wifi', 'signal', 'network', 'router'],
  '🌐': ['network', 'internet', 'router'],
  '🔔': ['doorbell', 'bell', 'chime', 'notification'],
  '🛎️': ['doorbell', 'bell'],
  '🔊': ['speaker', 'sound', 'volume', 'audio'],
  '🔉': ['speaker', 'sound', 'volume'],
  '☕': ['coffee', 'tea', 'kettle', 'mug'],
  '🖨️': ['printer'],
  '📱': ['phone', 'mobile'],
  '🚨': ['alarm', 'siren', 'smoke'],
  '🧯': ['smoke', 'fire extinguisher'],
  '🪴': ['plant', 'garden'],
  '📬': ['mailbox', 'mail', 'post'],
  '📦': ['package', 'parcel', 'delivery'],
};
const PROFILE_SYNC_DEFAULT_FILE_NAME = 'ha-widget-profile-sync.json';
// Main enforces the same minimum (PROFILE_SYNC_MIN_PASSPHRASE_LENGTH in main.js); checking it
// here keeps a short passphrase from ever reaching a half-saved state.
const PROFILE_SYNC_MIN_PASSPHRASE_LENGTH = 8;
const PROFILE_SYNC_HELP_URL = 'https://github.com/Robertg761/HA-Desktop-Widget#profile-sync';
const GITHUB_SPONSORS_URL = 'https://github.com/sponsors/robertg761';
// GitHub Sponsors caps custom amounts at $12,000; higher values 404 the checkout page.
const GITHUB_SPONSORS_MAX_AMOUNT = 12000;
const PROFILE_SYNC_SCOPE_PRESETS = new Set(['all', 'visual', 'quick_access', 'custom']);
const PROFILE_SYNC_SCOPE_SECTION_KEYS = [
  'quickAccessLayout',
  'visualPersonalization',
  'automationAlerts',
  'connectionMediaPreferences',
];
const PROFILE_SYNC_SCOPE_SECTION_INPUT_IDS = {
  quickAccessLayout: 'profile-sync-scope-quick-access-layout',
  visualPersonalization: 'profile-sync-scope-visual-personalization',
  automationAlerts: 'profile-sync-scope-automation-alerts',
  connectionMediaPreferences: 'profile-sync-scope-connection-media-preferences',
};
const CUSTOM_ENTITY_ICON_KEYWORD_GROUPS = {
  tree: ['🌲', '🌳', '🌴', '🎄', '🌵', '🎋', '🪾'],
  forest: ['🌲', '🌳', '🌴', '🏕️'],
  plant: ['🌱', '🪴', '🌿', '☘️', '🍀', '🎍', '🎋', '🪾', '🌾'],
  flower: ['🌸', '💮', '🪷', '🏵️', '🌹', '🥀', '🌺', '🌻', '🌼', '🌷', '🪻', '💐'],
  leaf: ['🍃', '🍂', '🍁', '🌿', '☘️', '🍀'],
  nature: ['🌲', '🌳', '🌴', '🌵', '🌱', '🌿', '🍃', '🍂', '🍁', '🌊', '⛰️', '🏞️'],
  weather: [
    '☀️',
    '🌤️',
    '⛅',
    '🌥️',
    '☁️',
    '🌦️',
    '🌧️',
    '⛈️',
    '🌩️',
    '🌨️',
    '❄️',
    '🌫️',
    '🌪️',
    '🌈',
    '☔',
  ],
  rain: ['🌧️', '☔', '🌦️', '⛈️'],
  snow: ['❄️', '☃️', '⛄', '🌨️'],
  sun: ['☀️', '🌤️', '🌞'],
  moon: ['🌙', '🌕', '🌖', '🌗', '🌘', '🌑', '🌒', '🌓', '🌔'],
  fire: ['🔥', '🧯', '♨️', '💥'],
  water: ['💧', '🌊', '🚿', '🛁', '🚰'],
  home: ['🏠', '🏡', '🏘️', '🏚️', '🛋️', '🛏️', '🪑', '🚪', '🪟'],
  kitchen: ['🍳', '🍽️', '🥣', '🥄', '🧂', '🧊'],
  bedroom: ['🛏️', '🛌'],
  bathroom: ['🚿', '🛁', '🚽', '🧻'],
  security: ['🛡️', '🔒', '🔓', '🚨', '🔔', '📹'],
  power: ['⚡', '🔋', '🔌', '🪫', '💡'],
  media: ['🎵', '🎶', '🎼', '🎧', '📻', '📺', '📷', '🎬'],
  camera: ['📷', '📸', '📹'],
  robot: ['🤖', '⚙️', '🦾', '🧠'],
  timer: ['⏲️', '⏰', '⌚', '🕒', '🕓', '🕔', '🕕', '🕖', '🕗', '🕘', '🕙', '🕚', '🕛'],
  favorite: ['⭐', '🌟', '✨', '💖', '💛'],
  travel: ['✈️', '🚗', '🚙', '🚌', '🚆', '🛳️'],
  animal: [
    '🐶',
    '🐱',
    '🐭',
    '🐹',
    '🐰',
    '🦊',
    '🐻',
    '🐼',
    '🐨',
    '🐯',
    '🦁',
    '🐮',
    '🐷',
    '🐸',
    '🐵',
    '🐔',
    '🐧',
    '🐦',
    '🦉',
    '🦄',
    '🐝',
    '🦋',
    '🐞',
    '🐢',
    '🐍',
    '🐙',
    '🦑',
    '🦀',
    '🐠',
    '🐟',
    '🐡',
    '🐬',
    '🦈',
    '🐳',
    '🐋',
  ],
  pet: ['🐶', '🐱', '🐭', '🐹', '🐰', '🐦', '🐠', '🐢'],
  rodent: ['🐀', '🐁', '🐭', '🐹', '🐿️', '🦫'],
  rat: ['🐀', '🐁', '🐭'],
  mouse: ['🐁', '🐭', '🐀'],
  mammal: [
    '🐶',
    '🐱',
    '🐭',
    '🐹',
    '🐰',
    '🦊',
    '🐻',
    '🐼',
    '🐨',
    '🐯',
    '🦁',
    '🐮',
    '🐷',
    '🐵',
    '🦄',
    '🐘',
    '🦒',
    '🦛',
    '🦏',
    '🐪',
    '🐫',
    '🦘',
    '🦥',
    '🦦',
    '🦨',
    '🦡',
    '🦫',
  ],
  bird: ['🐔', '🐤', '🐣', '🐥', '🐦', '🦅', '🦆', '🦉', '🦇', '🦜', '🦢', '🦩', '🕊️'],
  fish: ['🐟', '🐠', '🐡', '🦈', '🐬', '🐳', '🐋', '🦭', '🐙', '🦑', '🦀', '🦞', '🦐'],
  insect: ['🐝', '🪲', '🪳', '🦋', '🐛', '🐜', '🐞', '🕷️', '🦂', '🪰', '🪱'],
};
const CUSTOM_ENTITY_ICON_TERM_SYNONYMS = {
  mice: ['mouse', 'rodent', 'rat', 'animal'],
  mouse: ['rodent', 'rat', 'mice', 'animal', 'pet'],
  rat: ['rodent', 'mouse', 'mice', 'animal'],
  rodent: ['mouse', 'rat', 'hamster', 'animal'],
  hamster: ['rodent', 'mouse', 'animal', 'pet'],
  squirrel: ['rodent', 'animal'],
  beaver: ['rodent', 'animal'],
  pet: ['animal'],
  creature: ['animal'],
  fauna: ['animal'],
  wildlife: ['animal', 'wild'],
  birds: ['bird', 'animal'],
  fishes: ['fish', 'animal'],
  bugs: ['insect', 'animal'],
  insects: ['insect', 'animal'],
};
const CUSTOM_ENTITY_ICON_GROUP_ALIASES = buildCustomEntityIconGroupAliases();
let customEntityIconChoices = null;
let customEntityIconChoicesPromise = null;
let rgiEmojiDataCache = null;

function normalizeHexColor(hex) {
  if (!hex || typeof hex !== 'string') return null;
  const normalized = hex.trim().replace('#', '');
  if (![3, 6].includes(normalized.length)) return null;
  if (!/^[0-9a-fA-F]+$/.test(normalized)) return null;
  const sixDigit =
    normalized.length === 3
      ? normalized
          .split('')
          .map((ch) => ch + ch)
          .join('')
      : normalized;
  return `#${sixDigit.toUpperCase()}`;
}

// While the user types, only a complete 6-digit value counts. normalizeHexColor() also expands
// 3-digit shorthand, which would rewrite "#1E8" to "#11EE88" before the rest of "#1E88E5" is typed.
function normalizeFullHexColor(hex) {
  if (typeof hex !== 'string' || !/^#?[0-9a-f]{6}$/i.test(hex.trim())) return null;
  return normalizeHexColor(hex);
}

function hexToRgb(hex) {
  const normalized = normalizeHexColor(hex);
  if (!normalized) return null;
  const value = normalized.slice(1);
  return {
    r: Number.parseInt(value.slice(0, 2), 16),
    g: Number.parseInt(value.slice(2, 4), 16),
    b: Number.parseInt(value.slice(4, 6), 16),
  };
}

function clampRgbChannel(value) {
  if (!Number.isFinite(value)) return null;
  return Math.max(0, Math.min(255, Math.round(value)));
}

function rgbToHex(r, g, b) {
  const channels = [r, g, b].map((value) => clampRgbChannel(value));
  if (channels.some((channel) => channel === null)) return null;
  const [safeR, safeG, safeB] = channels;
  return `#${safeR.toString(16).padStart(2, '0')}${safeG.toString(16).padStart(2, '0')}${safeB.toString(16).padStart(2, '0')}`.toUpperCase();
}

function buildCustomColorId(seed = '') {
  const cleanedSeed = String(seed || 'color')
    .replace(/[^a-zA-Z0-9]+/g, '')
    .toLowerCase();
  const suffix = Math.random().toString(36).slice(2, 8);
  return `${CUSTOM_THEME_ID_PREFIX}${cleanedSeed || 'color'}-${suffix}`;
}

function normalizeCustomColorList(customColors) {
  if (!Array.isArray(customColors)) return [];

  const seenIds = new Set();
  const seenColors = new Set();

  return customColors.reduce((acc, entry, index) => {
    if (!entry || typeof entry !== 'object') return acc;
    const color = normalizeHexColor(entry.color);
    if (!color || seenColors.has(color)) return acc;

    const providedId = typeof entry.id === 'string' ? entry.id.trim() : '';
    let id = providedId || buildCustomColorId(color.slice(1));
    while (!id || seenIds.has(id)) {
      id = buildCustomColorId(`${color.slice(1)}${index}`);
    }

    const createdAt =
      typeof entry.createdAt === 'string' && entry.createdAt.trim()
        ? entry.createdAt
        : new Date().toISOString();
    const updatedAt =
      typeof entry.updatedAt === 'string' && entry.updatedAt.trim() ? entry.updatedAt : createdAt;
    const name =
      typeof entry.name === 'string' && entry.name.trim()
        ? entry.name.trim()
        : t('Custom {{color}}', { color });

    seenIds.add(id);
    seenColors.add(color);
    acc.push({
      id,
      name,
      color,
      createdAt,
      updatedAt,
    });
    return acc;
  }, []);
}

function getSavedCustomColors() {
  return normalizeCustomColorList(state.CONFIG?.ui?.customColors);
}

function setPendingCustomColorList(customColors) {
  pendingCustomColors = normalizeCustomColorList(customColors);
  setCustomThemes(pendingCustomColors);
}

function getCustomColorsForSave() {
  return pendingCustomColors.map((color) => ({
    id: color.id,
    name: color.name,
    color: color.color,
    createdAt: color.createdAt,
    updatedAt: color.updatedAt,
  }));
}

function countIconGraphemes(value) {
  if (!value || typeof value !== 'string') return 0;
  if (ICON_GRAPHEME_SEGMENTER) {
    let count = 0;
    for (const _segment of ICON_GRAPHEME_SEGMENTER.segment(value)) {
      count += 1;
      if (count > 1) break;
    }
    return count;
  }
  return Array.from(value).length;
}

function normalizeCustomEntityIcon(icon) {
  if (typeof icon !== 'string') return null;
  const trimmed = icon.trim();
  if (!trimmed) return null;
  return countIconGraphemes(trimmed) === 1 ? trimmed : null;
}

function stripEmojiVariationSelectors(value) {
  return String(value || '').replace(/\uFE0F/g, '');
}

function getIconCodepointTerms(icon) {
  const codepoints = Array.from(String(icon || '')).map((char) => char.codePointAt(0).toString(16));
  if (!codepoints.length) return [];
  const perCodepoint = codepoints.flatMap((cp) => [cp, `u+${cp}`]);
  return [...perCodepoint, codepoints.join('-')];
}

// Letters, numbers and the combining marks inside words stay in a search token, in every script;
// only punctuation is dropped. An ASCII-only filter made a Chinese, Arabic or accented query
// vanish, and an empty query matches every icon. Accents fold away like in every other search, but
// Hindi vowel signs do not: "कुत्ता" stays one word.
function normalizeEmojiSearchToken(term) {
  return foldSearchMarks(term)
    .toLowerCase()
    .trim()
    .replace(/[^\p{L}\p{M}\p{N}+#_-]+/gu, '');
}

function stemEmojiSearchToken(term) {
  if (term.length < 4) return term;
  if (term.endsWith('ies') && term.length > 4) return `${term.slice(0, -3)}y`;
  if (term.endsWith('ing') && term.length > 5) return term.slice(0, -3);
  if (term.endsWith('ed') && term.length > 4) return term.slice(0, -2);
  if (term.endsWith('es') && term.length > 4) return term.slice(0, -2);
  if (term.endsWith('s') && term.length > 3) return term.slice(0, -1);
  return term;
}

function tokenizeEmojiSearchInput(value) {
  return String(value || '')
    .toLowerCase()
    .split(/[\s,./\\|:;()[\]{}"'`~!?@%^&*+=<>]+/)
    .map(normalizeEmojiSearchToken)
    .filter(Boolean)
    .map((token) => {
      const stemmed = stemEmojiSearchToken(token);
      return stemmed || token;
    });
}

function expandEmojiSearchToken(token) {
  const normalized = normalizeEmojiSearchToken(token);
  if (!normalized) return [];

  const expanded = new Set([normalized]);
  const stemmed = stemEmojiSearchToken(normalized);
  if (stemmed) expanded.add(stemmed);

  const mapped =
    CUSTOM_ENTITY_ICON_TERM_SYNONYMS[normalized] || CUSTOM_ENTITY_ICON_TERM_SYNONYMS[stemmed] || [];
  mapped.forEach((term) => {
    const normalizedTerm = normalizeEmojiSearchToken(term);
    if (!normalizedTerm) return;
    expanded.add(normalizedTerm);
    const stemmedTerm = stemEmojiSearchToken(normalizedTerm);
    if (stemmedTerm) expanded.add(stemmedTerm);
  });

  return Array.from(expanded);
}

function buildEmojiSearchAlternativeGroups(filterValue) {
  return tokenizeEmojiSearchInput(filterValue)
    .map((token) => expandEmojiSearchToken(token))
    .filter((group) => group.length > 0);
}

function isNearMatchByEditDistance(left, right) {
  const a = String(left || '');
  const b = String(right || '');
  if (!a || !b) return false;

  if (a === b) return true;
  // A short word inside a long one ("tv" in "activity") is not a near match.
  if (a.includes(b)) return true;

  const maxDistance = a.length <= 4 || b.length <= 4 ? 1 : 2;
  if (Math.abs(a.length - b.length) > maxDistance) return false;

  const prev = new Array(b.length + 1);
  const curr = new Array(b.length + 1);

  for (let j = 0; j <= b.length; j += 1) prev[j] = j;

  for (let i = 1; i <= a.length; i += 1) {
    curr[0] = i;
    let minInRow = curr[0];
    for (let j = 1; j <= b.length; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      const value = Math.min(prev[j] + 1, curr[j - 1] + 1, prev[j - 1] + cost);
      curr[j] = value;
      if (value < minInRow) minInRow = value;
    }
    if (minInRow > maxDistance) return false;
    for (let j = 0; j <= b.length; j += 1) prev[j] = curr[j];
  }

  return prev[b.length] <= maxDistance;
}

function choiceMatchesAlternativeGroup(choice, alternatives, allowFuzzy = false) {
  if (!choice || !Array.isArray(choice.searchTerms) || !alternatives.length) return false;
  return alternatives.some((term) =>
    choice.searchTerms.some((choiceTerm) => {
      if (choiceTerm.includes(term)) return true;
      // Short words are too close to everything for an edit distance to mean anything.
      return allowFuzzy && term.length >= 4 ? isNearMatchByEditDistance(choiceTerm, term) : false;
    })
  );
}

function buildCustomEntityIconGroupAliases() {
  return Object.entries(CUSTOM_ENTITY_ICON_KEYWORD_GROUPS).reduce((acc, [keyword, icons]) => {
    if (!Array.isArray(icons)) return acc;
    const normalizedKeyword = normalizeEmojiSearchToken(keyword);
    if (!normalizedKeyword) return acc;

    icons.forEach((icon) => {
      const normalizedIcon = normalizeCustomEntityIcon(icon);
      if (!normalizedIcon) return;
      if (!acc[normalizedIcon]) acc[normalizedIcon] = new Set();
      acc[normalizedIcon].add(normalizedKeyword);
      const stemmed = stemEmojiSearchToken(normalizedKeyword);
      if (stemmed && stemmed !== normalizedKeyword) {
        acc[normalizedIcon].add(stemmed);
      }
    });

    return acc;
  }, {});
}

function getCustomEntityIconSearchAliases(icon) {
  const stripped = stripEmojiVariationSelectors(icon);
  const directAliases =
    CUSTOM_ENTITY_ICON_SEARCH_ALIASES[icon] || CUSTOM_ENTITY_ICON_SEARCH_ALIASES[stripped] || [];
  const groupedAliases = Array.from(
    CUSTOM_ENTITY_ICON_GROUP_ALIASES[icon] || CUSTOM_ENTITY_ICON_GROUP_ALIASES[stripped] || []
  );
  return Array.from(new Set([...directAliases, ...groupedAliases]));
}

function buildCustomEntityIconSearchTerms(icon, aliases, codepointTerms) {
  const searchTerms = new Set([String(icon || '').toLowerCase()]);
  const stripped = stripEmojiVariationSelectors(icon);
  if (stripped) searchTerms.add(stripped.toLowerCase());

  [...aliases, ...codepointTerms].forEach((term) => {
    const rawTerm = String(term || '').toLowerCase();
    if (!rawTerm) return;
    searchTerms.add(rawTerm);
    tokenizeEmojiSearchInput(rawTerm).forEach((token) => {
      if (token.length < 2) return;
      searchTerms.add(token);
      const stemmed = stemEmojiSearchToken(token);
      if (stemmed) searchTerms.add(stemmed);
    });
  });

  return Array.from(searchTerms);
}

// Skin tones, joined people and objects (family, profession), flags and their tag sequences are
// about three quarters of the emoji list and near-duplicates of one another. They stay findable by
// searching and by pasting, but the list a person scrolls through does not open with them.
const ICON_VARIANT_PATTERN = /[\u{1F3FB}-\u{1F3FF}\u{1F1E6}-\u{1F1FF}\u{E0020}-\u{E007F}]|\u200D/u;

function isCustomEntityIconVariant(icon) {
  return ICON_VARIANT_PATTERN.test(icon);
}

function buildCustomEntityIconChoices(rgiEmojiData) {
  // The icons made for the home first, in the order they were written, then the rest of Unicode's
  // emoji. A sorted catalogue opened on copyright signs and keycap digits.
  const curatedIcons = new Set(CUSTOM_ENTITY_ICON_FALLBACKS);

  Object.values(CUSTOM_ENTITY_ICON_KEYWORD_GROUPS).forEach((icons) => {
    (Array.isArray(icons) ? icons : []).forEach((icon) => {
      const normalized = normalizeCustomEntityIcon(icon);
      if (normalized) curatedIcons.add(normalized);
    });
  });

  // An emoji the computer's fonts cannot draw would be an empty box here and on the saved tile.
  // Only the list a person scrolls through is checked: the variants are three quarters of the
  // emoji and cost three quarters of the check, and they are only ever found by searching.
  const isDrawn = createEmojiSupportCheck(getComputedStyle(document.body).fontFamily || undefined);
  const otherIcons = new Set();
  const addOther = (icon) => {
    const normalized = normalizeCustomEntityIcon(icon);
    if (!normalized || curatedIcons.has(normalized)) return;
    if (isCustomEntityIconVariant(normalized) || isDrawn(normalized)) otherIcons.add(normalized);
  };
  if (Array.isArray(rgiEmojiData?.strings)) rgiEmojiData.strings.forEach(addOther);

  if (rgiEmojiData?.characters && typeof rgiEmojiData.characters.toArray === 'function') {
    rgiEmojiData.characters.toArray().forEach((codepoint) => {
      // Digits, # and * are only emoji as part of a keycap sequence, which the strings carry.
      if (!Number.isInteger(codepoint) || codepoint < 0x80) return;
      addOther(String.fromCodePoint(codepoint));
    });
  }

  // Unicode order keeps the neighbours together (faces, animals, food, travel).
  const byCodepoint = (a, b) => a.codePointAt(0) - b.codePointAt(0) || (a < b ? -1 : a > b ? 1 : 0);
  return [...curatedIcons, ...[...otherIcons].sort(byCodepoint)].map((icon) => {
    const stripped = stripEmojiVariationSelectors(icon);
    const aliases = getCustomEntityIconSearchAliases(icon);
    const codepointTerms = getIconCodepointTerms(icon);
    const searchTerms = buildCustomEntityIconSearchTerms(icon, aliases, codepointTerms);
    const searchText = [icon, stripped, ...aliases, ...codepointTerms, ...searchTerms]
      .join(' ')
      .toLowerCase();

    return {
      icon,
      aliases,
      codepointTerms,
      searchTerms,
      searchText,
      variant: !curatedIcons.has(icon) && isCustomEntityIconVariant(icon),
    };
  });
}

async function ensureCustomEntityIconChoicesLoaded() {
  if (Array.isArray(customEntityIconChoices)) {
    return customEntityIconChoices;
  }
  if (customEntityIconChoicesPromise) {
    return customEntityIconChoicesPromise;
  }

  customEntityIconChoicesPromise = (async () => {
    if (!rgiEmojiDataCache) {
      const rgiEmojiDataModule =
        await import('regenerate-unicode-properties/Property_of_Strings/RGI_Emoji.js');
      rgiEmojiDataCache = rgiEmojiDataModule?.default || rgiEmojiDataModule;
    }

    customEntityIconChoices = buildCustomEntityIconChoices(rgiEmojiDataCache);
    return customEntityIconChoices;
  })();

  try {
    return await customEntityIconChoicesPromise;
  } finally {
    customEntityIconChoicesPromise = null;
  }
}

function getFilteredCustomEntityIconChoices(filterValue = '') {
  const choices = Array.isArray(customEntityIconChoices) ? customEntityIconChoices : [];
  if (!choices.length) return [];

  const rawFilter = String(filterValue || '')
    .trim()
    .toLowerCase();
  if (!rawFilter) return choices.filter((choice) => !choice.variant);

  const alternativeGroups = buildEmojiSearchAlternativeGroups(rawFilter);

  // The text as typed is checked first, so a pasted emoji finds itself even though it has no
  // letters to make a keyword of.
  const strictMatches = choices.filter((choice) => {
    if (choice.searchText.includes(rawFilter)) return true;
    return (
      alternativeGroups.length > 0 &&
      alternativeGroups.every((group) => choiceMatchesAlternativeGroup(choice, group, false))
    );
  });
  if (strictMatches.length) return strictMatches;
  // A query with nothing to search by matches nothing, not everything.
  if (!alternativeGroups.length) return [];

  // Fallback: fuzzy category search when exact tokens miss.
  return choices.filter((choice) =>
    alternativeGroups.every((group) => choiceMatchesAlternativeGroup(choice, group, true))
  );
}

function getCustomEntityIconPickerQuery(entityId) {
  if (!entityId) return '';
  return customEntityIconPickerQueryByEntityId[entityId] || '';
}

function setCustomEntityIconPickerQuery(entityId, queryValue) {
  if (!entityId) return;
  const next = String(queryValue || '').trim();
  if (!next) {
    delete customEntityIconPickerQueryByEntityId[entityId];
    return;
  }
  customEntityIconPickerQueryByEntityId[entityId] = next;
}

function syncCustomEntityIconPickerQueryFromInput(entityId, rawInputValue) {
  const nextValue = String(rawInputValue || '').trim();
  const pendingIcon = getPendingCustomIcon(entityId) || '';
  if (!nextValue || nextValue === pendingIcon) {
    setCustomEntityIconPickerQuery(entityId, '');
    return;
  }
  setCustomEntityIconPickerQuery(entityId, nextValue);
}

function refocusCustomEntityIconInput(section, entityId) {
  if (!section || !entityId) return;
  const refreshedInput = section.querySelector(`[data-custom-icon-input="${entityId}"]`);
  if (!refreshedInput) return;
  const cursorPosition = refreshedInput.value.length;
  refreshedInput.focus();
  if (typeof refreshedInput.setSelectionRange === 'function') {
    refreshedInput.setSelectionRange(cursorPosition, cursorPosition);
  }
}

function normalizeCustomEntityIconMap(customEntityIcons) {
  if (
    !customEntityIcons ||
    typeof customEntityIcons !== 'object' ||
    Array.isArray(customEntityIcons)
  ) {
    return {};
  }

  return Object.entries(customEntityIcons).reduce((acc, [entityId, icon]) => {
    if (typeof entityId !== 'string') return acc;
    const trimmedEntityId = entityId.trim();
    const normalizedIcon = normalizeCustomEntityIcon(icon);
    if (!trimmedEntityId || !normalizedIcon) return acc;
    acc[trimmedEntityId] = normalizedIcon;
    return acc;
  }, {});
}

function getSavedCustomEntityIcons() {
  return normalizeCustomEntityIconMap(state.CONFIG?.customEntityIcons);
}

function setPendingCustomEntityIcons(customEntityIcons) {
  pendingCustomEntityIcons = normalizeCustomEntityIconMap(customEntityIcons);
}

function refreshRestoredDashboardSettings() {
  const modal = document.getElementById('settings-modal');
  if (!modal || modal.classList.contains('hidden') || modal.style.display === 'none') return;
  setPendingCustomEntityIcons(getSavedCustomEntityIcons());
  activeCustomEntityIconPickerEntityId = null;
  customEntityIconPickerQueryByEntityId = {};
  lastCustomEntityIconAction = null;
  if (hydratedPersonalizationSections.has('custom-entity-icons-section')) {
    renderCustomEntityIconsList();
  } else {
    updateCustomEntityIconSummary();
  }
}

function getPendingCustomEntityIconsForSave() {
  return { ...pendingCustomEntityIcons };
}

function persistCustomColorsImmediately() {
  if (!state.CONFIG) return;

  const customColors = getCustomColorsForSave();
  state.CONFIG.ui = state.CONFIG.ui || {};
  state.CONFIG.ui.customColors = customColors;

  if (!window?.electronAPI?.updateConfig) return;

  window.electronAPI
    .updateConfig({
      ui: {
        ...state.CONFIG.ui,
        customColors,
      },
    })
    .catch((error) => {
      log.error('Failed to persist custom colors:', error);
      showToast(t('Could not persist custom colors. Try Save in settings.'), 'warning', 3000);
    });
}

// Built-in theme names are English keys in ui-utils; custom color names are the user's own text.
// A hex code in one ("Custom #AB34CD", the name a color gets when it is saved) is isolated for
// display, since in an Arabic sentence its '#' would otherwise land beside the wrong end of it. The
// name itself is left as typed, because the rename field and the comparison with it use that.
function getThemeDisplayName(theme) {
  if (!theme) return '';
  if (!theme.isCustom) return t(theme.name || '');
  return (theme.name || '').replace(/#[0-9a-f]{6}\b/gi, (hex) => isolateLtr(hex));
}

function getThemeById(themeId) {
  if (!themeId) return null;
  return getAccentThemes().find((theme) => theme.id === themeId) || null;
}

function getCustomColorEditorElements() {
  return {
    picker: document.getElementById('custom-color-picker'),
    rInput: document.getElementById('custom-color-r'),
    gInput: document.getElementById('custom-color-g'),
    bInput: document.getElementById('custom-color-b'),
    hexInput: document.getElementById('custom-color-hex'),
    hexError: document.getElementById('custom-color-hex-error'),
    saveBtn: document.getElementById('save-custom-color-btn'),
    managementRow: document.getElementById('custom-theme-management'),
    nameInput: document.getElementById('custom-color-name-input'),
    renameBtn: document.getElementById('rename-custom-color-btn'),
    removeBtn: document.getElementById('remove-custom-color-btn'),
  };
}

function isElementInsideCustomEditor(element) {
  if (!element || typeof element !== 'object') return false;
  if (typeof element.matches === 'function' && element.matches(CUSTOM_EDITOR_SCOPE_SELECTOR))
    return true;
  return !!element.closest?.(CUSTOM_EDITOR_SCOPE_SELECTOR);
}

// Whether a custom colour field is being used. Re-labelling Settings while it is must not rebuild the
// swatches under a draft. Save stays available throughout: it asks what to do with an unsaved colour
// (handlePendingCustomEditorChangesBeforeSave), and a Save that went disabled the moment a field took
// focus swallowed a quick first click, since the field's blur re-enabled it only after the press.
function setCustomEditorActive(isActive) {
  isCustomEditorActive = isActive;
}

function setCustomColorHexInvalid(invalid) {
  const { hexInput, hexError } = getCustomColorEditorElements();
  if (hexInput) {
    if (invalid) {
      hexInput.setAttribute('aria-invalid', 'true');
    } else {
      hexInput.removeAttribute('aria-invalid');
    }
  }
  hexError?.classList.toggle('hidden', !invalid);
}

/**
 * Write one colour into every editor field.
 * @param {string} hex - The colour to show.
 * @param {Object} [options] - Write behaviour.
 * @param {HTMLInputElement|null} [options.skipField] - A field the user is typing in; rewriting it
 *   would replace their half-typed text with the normalized colour.
 */
function setCustomColorEditorValues(hex, { skipField = null } = {}) {
  const normalized = normalizeHexColor(hex);
  if (!normalized) return;
  const rgb = hexToRgb(normalized);
  if (!rgb) return;

  const { picker, rInput, gInput, bInput, hexInput } = getCustomColorEditorElements();
  const write = (input, value) => {
    if (input && input !== skipField) input.value = value;
  };
  isSyncingCustomColorEditor = true;
  write(picker, normalized.toLowerCase());
  write(rInput, `${rgb.r}`);
  write(gInput, `${rgb.g}`);
  write(bInput, `${rgb.b}`);
  write(hexInput, normalized);
  isSyncingCustomColorEditor = false;
  if (hexInput && hexInput !== skipField) setCustomColorHexInvalid(false);
  lastValidCustomColorHex = normalized;
}

function getCustomColorHexFromChannels() {
  const { rInput, gInput, bInput } = getCustomColorEditorElements();
  const parseChannel = (input) => {
    if (!input) return null;
    const raw = (input.value || '').trim();
    if (!raw) return null;
    const parsed = Number.parseInt(raw, 10);
    if (Number.isNaN(parsed)) return null;
    return clampRgbChannel(parsed);
  };

  const r = parseChannel(rInput);
  const g = parseChannel(gInput);
  const b = parseChannel(bInput);
  if (r === null || g === null || b === null) return null;
  return rgbToHex(r, g, b);
}

function getCustomColorHexFromEditor() {
  const { hexInput } = getCustomColorEditorElements();
  return normalizeHexColor(hexInput?.value) || getCustomColorHexFromChannels();
}

function applyCustomColorPreview(hex) {
  const normalized = normalizeHexColor(hex);
  if (!normalized) return;
  hasDraftColorPreview = true;

  if (activeColorTarget === COLOR_TARGETS.background) {
    applyBackgroundThemeFromColor(normalized);
  } else {
    applyAccentThemeFromColor(normalized);
  }
}

function getSelectedThemeForActiveTarget() {
  return getThemeById(getPendingTheme(activeColorTarget));
}

function updateCustomThemeManagementUI(theme = null) {
  const selectedTheme = theme || getSelectedThemeForActiveTarget();
  const isCustomTheme = !!selectedTheme?.isCustom;
  const { managementRow, nameInput, renameBtn, removeBtn } = getCustomColorEditorElements();

  if (managementRow) {
    managementRow.classList.toggle('hidden', !isCustomTheme);
  }
  if (renameBtn) renameBtn.disabled = !isCustomTheme;
  if (removeBtn) removeBtn.disabled = !isCustomTheme;

  if (!isCustomTheme) {
    activeCustomManagementThemeId = null;
    if (nameInput) nameInput.value = '';
    return;
  }

  if (nameInput && activeCustomManagementThemeId !== selectedTheme.id) {
    nameInput.value = selectedTheme.name || '';
  }
  activeCustomManagementThemeId = selectedTheme.id;
}

function syncCustomColorEditorFromSelectedTheme() {
  const selectedTheme = getSelectedThemeForActiveTarget();
  const selectedHex = normalizeHexColor(selectedTheme?.color);
  if (selectedHex) {
    setCustomColorEditorValues(selectedHex);
  } else {
    setCustomColorEditorValues(lastValidCustomColorHex);
  }
  updateCustomThemeManagementUI(selectedTheme);
}

function selectThemeForActiveTarget(themeId) {
  if (activeColorTarget === COLOR_TARGETS.background) {
    selectBackgroundTheme(themeId, { preview: true });
  } else {
    selectAccentTheme(themeId, { preview: true });
  }
}

function saveCustomColorFromEditor() {
  const { hexInput } = getCustomColorEditorElements();
  // The channel boxes only ever hold the last valid colour, so they must not stand in for a hex
  // value the user typed wrongly; they are the fallback only when the hex field is empty.
  const typedHex = (hexInput?.value || '').trim();
  const color = typedHex ? normalizeHexColor(typedHex) : getCustomColorHexFromChannels();
  if (!color) {
    setCustomColorHexInvalid(true);
    hexInput?.focus();
    showToast(t('Enter a valid color before saving.'), 'warning', 2500);
    return false;
  }

  const existing = pendingCustomColors.find((entry) => entry.color === color);
  if (existing) {
    selectThemeForActiveTarget(existing.id);
    renderColorThemeOptions();
    showToast(t('Color already saved. Selected existing custom color.'), 'info', 2200);
    return true;
  }

  const timestamp = new Date().toISOString();
  const customColor = {
    id: buildCustomColorId(color.slice(1)),
    name: t('Custom {{color}}', { color }),
    color,
    createdAt: timestamp,
    updatedAt: timestamp,
  };

  pendingCustomColors = [...pendingCustomColors, customColor];
  markSettingsTouched('ui.customColors');
  setCustomThemes(pendingCustomColors);
  persistCustomColorsImmediately();
  selectThemeForActiveTarget(customColor.id);
  renderColorThemeOptions();
  showToast(t('Custom color saved.'), 'success', 2000);
  return true;
}

function renameSelectedCustomColor() {
  const selectedTheme = getSelectedThemeForActiveTarget();
  if (!selectedTheme?.isCustom) return;

  const { nameInput } = getCustomColorEditorElements();
  if (!nameInput) return;

  const nextName = (nameInput.value || '').trim();
  if (!nextName) {
    nameInput.value = selectedTheme.name || '';
    return;
  }

  markSettingsTouched('ui.customColors');
  pendingCustomColors = pendingCustomColors.map((entry) => {
    if (entry.id !== selectedTheme.id) return entry;
    return {
      ...entry,
      name: nextName,
      updatedAt: new Date().toISOString(),
    };
  });

  setCustomThemes(pendingCustomColors);
  persistCustomColorsImmediately();
  renderColorThemeOptions();
  showToast(t('Custom color renamed.'), 'success', 1800);
}

async function removeSelectedCustomColor() {
  const selectedTheme = getSelectedThemeForActiveTarget();
  if (!selectedTheme?.isCustom) return;

  // Removing saves at once (Cancel in Settings cannot bring the colour back), and the accent or
  // background using it falls back to the default, so a stray click should not do it.
  const confirmed = await showConfirm(
    t('Remove Custom Color'),
    t('Remove "{{name}}" from your custom colors?', { name: selectedTheme.name }),
    { confirmText: t('Remove'), confirmClass: 'btn-danger' }
  );
  if (!confirmed) return;

  pendingCustomColors = pendingCustomColors.filter((entry) => entry.id !== selectedTheme.id);
  markSettingsTouched('ui.customColors');
  setCustomThemes(pendingCustomColors);
  persistCustomColorsImmediately();

  if (pendingAccent === selectedTheme.id) {
    pendingAccent = resolveThemeId(null);
    applyAccentTheme(pendingAccent);
  }
  if (pendingBackground === selectedTheme.id) {
    pendingBackground = resolveThemeId(null, { preferSlate: true });
    applyBackgroundTheme(pendingBackground);
  }

  renderColorThemeOptions();
  showToast(t('Custom color removed.'), 'success', 1800);
}

function initCustomColorEditor() {
  const { picker, rInput, gInput, bInput, hexInput, saveBtn, nameInput, renameBtn, removeBtn } =
    getCustomColorEditorElements();
  const customEditorControls = [
    picker,
    rInput,
    gInput,
    bInput,
    hexInput,
    nameInput,
    saveBtn,
    renameBtn,
    removeBtn,
  ].filter(Boolean);

  const scheduleUnlockIfOutsideEditor = () => {
    setTimeout(() => {
      if (!isElementInsideCustomEditor(document.activeElement)) {
        setCustomEditorActive(false);
      }
    }, 0);
  };

  customEditorControls.forEach((control) => {
    if (control.dataset.saveLockBound === 'true') return;
    control.addEventListener('focus', () => setCustomEditorActive(true));
    control.addEventListener('blur', scheduleUnlockIfOutsideEditor);
    control.dataset.saveLockBound = 'true';
  });

  if (picker) {
    picker.oninput = () => {
      if (isSyncingCustomColorEditor) return;
      setCustomEditorActive(true);
      const normalized = normalizeHexColor(picker.value);
      if (!normalized) return;
      setCustomColorEditorValues(normalized);
      applyCustomColorPreview(normalized);
    };
  }

  // `event` is absent when blur re-applies the clamped value, so every field is rewritten then.
  const handleRgbInput = (event) => {
    if (isSyncingCustomColorEditor) return;
    setCustomEditorActive(true);
    const color = getCustomColorHexFromChannels();
    if (!color) return;
    setCustomColorEditorValues(color, { skipField: event?.target });
    applyCustomColorPreview(color);
  };

  [rInput, gInput, bInput].forEach((input) => {
    if (!input) return;
    input.oninput = handleRgbInput;
    input.onblur = () => {
      const parsed = Number.parseInt(input.value, 10);
      if (Number.isNaN(parsed)) {
        setCustomColorEditorValues(lastValidCustomColorHex);
        return;
      }
      input.value = `${clampRgbChannel(parsed)}`;
      handleRgbInput();
    };
  });

  if (hexInput) {
    hexInput.oninput = () => {
      if (isSyncingCustomColorEditor) return;
      setCustomColorHexInvalid(false);
      const normalized = normalizeFullHexColor(hexInput.value);
      if (!normalized) return;
      setCustomColorEditorValues(normalized, { skipField: hexInput });
      applyCustomColorPreview(normalized);
    };
    hexInput.onblur = () => {
      if (!hexInput.value.trim()) {
        setCustomColorEditorValues(lastValidCustomColorHex);
        return;
      }
      const normalized = normalizeHexColor(hexInput.value);
      if (!normalized) {
        // Keep what was typed and flag it: reverting here would hide the typo, and Save would then
        // quietly store the previous colour.
        setCustomColorHexInvalid(true);
        return;
      }
      // A shorthand value ("#1E8") was not previewed while typing, so expanding it is the change.
      if (normalized !== lastValidCustomColorHex) applyCustomColorPreview(normalized);
      setCustomColorEditorValues(normalized);
    };
  }

  [rInput, gInput, bInput, hexInput].forEach((input) => {
    if (!input) return;
    input.onkeydown = (event) => {
      // An Enter that commits an IME composition belongs to the IME, not to Save.
      if (event.key !== 'Enter' || event.isComposing) return;
      event.preventDefault();
      if (saveCustomColorFromEditor()) setCustomEditorActive(false);
    };
  });

  if (saveBtn) {
    saveBtn.onclick = () => {
      if (saveCustomColorFromEditor()) setCustomEditorActive(false);
    };
  }

  if (renameBtn) {
    renameBtn.onclick = () => {
      renameSelectedCustomColor();
      setCustomEditorActive(false);
    };
  }

  if (nameInput) {
    nameInput.oninput = () => {
      setCustomEditorActive(true);
    };
    nameInput.onkeydown = (event) => {
      // The Enter that commits an input method's candidate is not a request to save the name.
      if (event.key !== 'Enter' || event.isComposing || event.keyCode === 229) return;
      event.preventDefault();
      renameSelectedCustomColor();
      setCustomEditorActive(false);
    };
  }

  if (removeBtn) {
    removeBtn.onclick = async () => {
      await removeSelectedCustomColor();
      setCustomEditorActive(false);
    };
  }

  setCustomEditorActive(false);
  syncCustomColorEditorFromSelectedTheme();
}

function hasPendingCustomNameEdit() {
  const selectedTheme = getSelectedThemeForActiveTarget();
  if (!selectedTheme?.isCustom) return false;

  const { nameInput } = getCustomColorEditorElements();
  if (!nameInput) return false;

  const pendingName = (nameInput.value || '').trim();
  const currentName = (selectedTheme.name || '').trim();
  return !!pendingName && pendingName !== currentName;
}

async function handlePendingCustomEditorChangesBeforeSave() {
  const hasPendingColorDraft = hasDraftColorPreview;
  const hasNameDraft = hasPendingCustomNameEdit();
  if (!hasPendingColorDraft && !hasNameDraft) return true;

  // Three ways out. Escape, a click outside and the Cancel button all mean "go back", the way they
  // do in every dialog: the draft survives and Settings stays open, instead of the draft being thrown
  // away and the whole form saved and closed behind the user's back.
  const choice = await showConfirm(
    t('Unsaved Custom Color Changes'),
    t('You have unsaved custom color edits. Save them before applying settings?'),
    {
      confirmText: t('Save and Continue'),
      alternateText: t('Discard color edits'),
      cancelText: t('Keep editing'),
      confirmClass: 'btn-primary',
      confirmFirst: true,
    }
  );

  if (choice === false) return false;
  if (choice === 'alternate') return true;

  if (hasPendingColorDraft) {
    const saved = saveCustomColorFromEditor();
    if (!saved) return false;
  }

  if (hasPendingCustomNameEdit()) {
    renameSelectedCustomColor();
  }

  return true;
}

/**
 * Resolve a valid accent theme id from a candidate, with optional preference for the 'slate' theme.
 *
 * If the provided `themeId` is a known theme id it is returned. If `themeId` is `'sky'`, it maps to
 * the `'original'` theme when available. When `preferSlate` is true the function prefers `'slate'`,
 * then `'original'`, then the first available theme; otherwise it prefers `'original'` then the
 * first available theme. Always falls back to `'original'` if no themes are available.
 * @param {string|undefined|null} themeId - Candidate theme id to validate or resolve.
 * @param {{preferSlate?: boolean}=} options - Resolution options.
 * @param {boolean} [options.preferSlate=false] - When true prefer the `slate` theme over `original`.
 * @return {string} The resolved valid theme id.
 */
function resolveThemeId(themeId, { preferSlate = false } = {}) {
  const themes = getAccentThemes();
  const validIds = new Set(themes.map((theme) => theme.id));
  if (themeId && validIds.has(themeId)) return themeId;
  if (themeId === 'sky') {
    const original = themes.find((theme) => theme.id === 'original')?.id;
    if (original) return original;
  }
  if (preferSlate) {
    return (
      themes.find((theme) => theme.id === 'slate')?.id ||
      themes.find((theme) => theme.id === 'original')?.id ||
      themes[0]?.id ||
      'original'
    );
  }
  return themes.find((theme) => theme.id === 'original')?.id || themes[0]?.id || 'original';
}

/**
 * Get the current accent theme id from the configuration or a resolved default.
 * @returns {string} The configured accent theme id, or the resolved fallback theme id.
 */
function getCurrentAccentTheme() {
  const fallback = resolveThemeId(null);
  return state.CONFIG?.ui?.accent || fallback;
}

/**
 * Determine the current background theme ID, falling back to a preferred default.
 * @returns {string} The background theme id from configuration, or a resolved default if not set.
 */
function getCurrentBackgroundTheme() {
  const fallback = resolveThemeId(null, { preferSlate: true });
  return state.CONFIG?.ui?.background || fallback;
}

/**
 * Get the currently pending theme id for the specified color target, or the active theme id if none is pending.
 * @param {string} target - Color target, either COLOR_TARGETS.accent or COLOR_TARGETS.background.
 * @returns {string} The pending theme id for the target, or the current theme id if no pending selection exists.
 */
function getPendingTheme(target) {
  if (target === COLOR_TARGETS.background) {
    return pendingBackground || getCurrentBackgroundTheme();
  }
  return pendingAccent || getCurrentAccentTheme();
}

/**
 * Selects an accent theme as the pending choice and updates the UI accordingly.
 *
 * Sets the pending accent theme to the resolved theme for `accentKey`, optionally applies it as a live preview, and refreshes theme selection visuals and the summary text.
 *
 * @param {string} accentKey - Identifier or key of the accent theme to select.
 * @param {{preview?: boolean}} [options] - Selection options.
 * @param {boolean} [options.preview=true] - If `true`, apply the selected accent immediately as a live preview.
 */
function selectAccentTheme(accentKey, { preview = true } = {}) {
  const resolvedAccent = resolveThemeId(accentKey);
  // Picking the accent already chosen is not an edit, and must not pin it over a sync.
  if (preview && resolvedAccent !== getPendingTheme(COLOR_TARGETS.accent)) {
    markSettingsTouched('ui.accent');
  }
  pendingAccent = resolvedAccent;
  hasDraftColorPreview = false;
  if (preview) {
    // Show the pick even while a holiday's colours are on.
    suspendSeasonalColors(true);
    applyAccentTheme(resolvedAccent);
  }
  if (activeColorTarget === COLOR_TARGETS.accent) {
    updateThemeSelectionUI();
    syncCustomColorEditorFromSelectedTheme();
  }
  updateThemeSummary();
}

/**
 * Selects a background color theme and updates the pending state and UI.
 *
 * Sets the pending background theme, optionally applies it as a live preview, and refreshes
 * the theme selection UI and summary text.
 *
 * @param {string} backgroundKey - The identifier of the background theme to select.
 * @param {Object} [options] - Optional settings.
 * @param {boolean} [options.preview=true] - If true, apply the selected background as a live preview.
 */
function selectBackgroundTheme(backgroundKey, { preview = true } = {}) {
  const resolvedBackground = resolveThemeId(backgroundKey, { preferSlate: true });
  if (preview && resolvedBackground !== getPendingTheme(COLOR_TARGETS.background)) {
    markSettingsTouched('ui.background');
  }
  pendingBackground = resolvedBackground;
  hasDraftColorPreview = false;
  if (preview) {
    suspendSeasonalColors(true);
    applyBackgroundTheme(resolvedBackground);
  }
  if (activeColorTarget === COLOR_TARGETS.background) {
    updateThemeSelectionUI();
    syncCustomColorEditorFromSelectedTheme();
  }
  updateThemeSummary();
}

/**
 * Update the visual selection and ARIA state of theme option buttons to match the pending theme for the active color target.
 *
 * Finds elements with the `color-theme-option` class and toggles their `selected` class and `aria-checked` attribute based on the currently pending theme.
 */
function updateThemeSelectionUI() {
  const selectedTheme = getPendingTheme(activeColorTarget);
  const options = document.querySelectorAll('.color-theme-option');
  options.forEach((option) => {
    const isSelected = option.dataset.theme === selectedTheme;
    option.classList.toggle('selected', isSelected);
    option.setAttribute('aria-checked', isSelected ? 'true' : 'false');
  });
  // One Tab stop for the group: the chosen swatch, or the first when the choice is not listed.
  syncRovingTabIndex(
    options,
    [...options].find((option) => option.dataset.theme === selectedTheme)
  );
}

function updateColorTargetUI() {
  const select = document.getElementById('color-target-select');
  if (select) select.value = activeColorTarget;

  document.querySelectorAll('.color-target-option').forEach((option) => {
    const isActive = option.dataset.colorTarget === activeColorTarget;
    option.classList.toggle('active', isActive);
    option.setAttribute('aria-checked', isActive ? 'true' : 'false');
  });
}

/**
 * Update the theme options label to indicate whether Accent or Background colors are active.
 *
 * Sets the element with id "theme-options-label" to "Color Options (Accent)" or
 * "Color Options (Background)" based on the current active color target. Does nothing if the label element is not present.
 */
function updateThemeOptionsLabel() {
  const label = document.getElementById('theme-options-label');
  if (!label) return;
  label.textContent =
    activeColorTarget === COLOR_TARGETS.background ? t('Background colors') : t('Accent colors');
}

/**
 * Update the visible summary text to show the current accent and background theme names.
 *
 * Looks up the pending accent and background theme ids, uses their display names when available,
 * and sets the textContent of the element with id "theme-current-selection". If a theme id
 * cannot be resolved, the name "Custom" is used as a fallback.
 */
function updateThemeSummary() {
  const summary = document.getElementById('theme-current-selection');
  if (!summary) return;
  const themes = getAccentThemes();
  const accentTheme = themes.find((theme) => theme.id === getPendingTheme(COLOR_TARGETS.accent));
  const backgroundTheme = themes.find(
    (theme) => theme.id === getPendingTheme(COLOR_TARGETS.background)
  );
  summary.textContent = t('Accent: {{accent}} • Background: {{background}}', {
    accent: accentTheme ? getThemeDisplayName(accentTheme) : t('Custom'),
    background: backgroundTheme ? getThemeDisplayName(backgroundTheme) : t('Custom'),
  });
}

/**
 * Set which color target (accent or background) is active for the theme options UI.
 * @param {string} target - Desired color target; expected values are `"accent"` or `"background"`. Any other value selects `"accent"`.
 */
function setActiveColorTarget(target) {
  activeColorTarget =
    target === COLOR_TARGETS.background ? COLOR_TARGETS.background : COLOR_TARGETS.accent;
  hasDraftColorPreview = false;
  updateColorTargetUI();
  renderColorThemeOptions();
}

/**
 * Create and initialize the theme tooltip flyout and return its DOM element.
 *
 * If the tooltip already exists this returns the existing element. When first created,
 * the tooltip is appended to document.body and a scroll listener is bound to the
 * settings modal body to hide the tooltip on scroll.
 *
 * @returns {HTMLElement} The tooltip DOM element used for theme previews.
 */
function ensureThemeTooltip() {
  if (themeTooltip) return themeTooltip;
  const tooltip = document.createElement('div');
  tooltip.id = 'theme-tooltip-flyout';
  tooltip.className = 'theme-tooltip-flyout';
  tooltip.setAttribute('role', 'tooltip');
  tooltip.setAttribute('aria-hidden', 'true');
  tooltip.innerHTML = `
    <span class="theme-tooltip-name"></span>
    <span class="theme-tooltip-note"></span>
  `;
  document.body.appendChild(tooltip);
  themeTooltip = tooltip;

  if (!themeTooltipScrollBound) {
    const modalBody = document.querySelector('#settings-modal .modal-body');
    if (modalBody) {
      modalBody.addEventListener('scroll', hideThemeTooltip, { passive: true });
      themeTooltipScrollBound = true;
    }
  }

  return tooltip;
}

/**
 * Position the theme tooltip relative to a target element.
 *
 * The tooltip sits under the whole swatch grid (above it when the window has no room below), not
 * beside the one swatch: centred over a swatch it hid the swatches being compared, and over the
 * first column it spilled across the icon rail. It stays inside the settings page, the arrow keeps
 * pointing at the swatch, and the chosen placement is recorded in `dataset.placement`.
 * @param {Element} target - The DOM element to anchor the tooltip to.
 */
function positionThemeTooltip(target) {
  if (!themeTooltip || !target) return;
  const rect = target.getBoundingClientRect();
  const grid = (target.closest('.accent-theme-grid') || target).getBoundingClientRect();
  const page = (
    document.querySelector('#settings-modal .modal-body') || document.body
  ).getBoundingClientRect();
  const tooltipRect = themeTooltip.getBoundingClientRect();
  const padding = 12;
  const below = grid.bottom + 12;
  const placeAbove = below + tooltipRect.height > window.innerHeight - padding;
  const top = placeAbove ? grid.top - tooltipRect.height - 12 : below;
  const minLeft = Math.max(padding, page.left + padding);
  const maxLeft = Math.min(window.innerWidth, page.right) - tooltipRect.width - padding;
  const centred = rect.left + rect.width / 2 - tooltipRect.width / 2;
  const left = Math.max(minLeft, Math.min(centred, maxLeft));
  const arrowX = rect.left + rect.width / 2 - left;
  themeTooltip.style.top = `${top}px`;
  themeTooltip.style.left = `${left}px`;
  themeTooltip.style.setProperty(
    '--tooltip-arrow-x',
    `${Math.max(16, Math.min(arrowX, tooltipRect.width - 16))}px`
  );
  themeTooltip.dataset.placement = placeAbove ? 'top' : 'bottom';
}

/**
 * Display the theme tooltip populated with the given title and note.
 *
 * If a target element is provided, the tooltip will copy its `--swatch` and
 * `--swatch-rgb` CSS custom properties when present and will be positioned
 * relative to the target.
 *
 * @param {HTMLElement|null} target - Element the tooltip should reference/anchor to, or `null` to show without swatch/anchor.
 * @param {string} name - Title text to display in the tooltip.
 * @param {string} note - Supplemental note text to display in the tooltip.
 */
function showThemeTooltip(target, name, note) {
  const tooltip = ensureThemeTooltip();
  const nameEl = tooltip.querySelector('.theme-tooltip-name');
  const noteEl = tooltip.querySelector('.theme-tooltip-note');
  if (nameEl) nameEl.textContent = name;
  if (noteEl) noteEl.textContent = note;
  if (target) {
    const computed = window.getComputedStyle(target);
    const swatch = computed.getPropertyValue('--swatch').trim();
    const swatchRgb = computed.getPropertyValue('--swatch-rgb').trim();
    if (swatch) {
      tooltip.style.setProperty('--swatch', swatch);
    }
    if (swatchRgb) {
      tooltip.style.setProperty('--swatch-rgb', swatchRgb);
    }
  }
  tooltip.classList.add('visible');
  tooltip.setAttribute('aria-hidden', 'false');
  positionThemeTooltip(target);
}

/**
 * Hide the theme tooltip and update its accessibility state.
 *
 * If a tooltip exists, it will be hidden from view and marked with `aria-hidden="true"` for assistive technologies.
 */
function hideThemeTooltip() {
  if (!themeTooltip) return;
  themeTooltip.classList.remove('visible');
  themeTooltip.setAttribute('aria-hidden', 'true');
}

/**
 * Apply the pending background theme if present, otherwise apply the currently selected background theme.
 */
function refreshBackgroundTheme() {
  applyBackgroundTheme(pendingBackground || getCurrentBackgroundTheme());
}

/**
 * Render interactive color theme option buttons for the currently active color target.
 *
 * Clears and populates the #theme-options container with a button for each available theme.
 * Each option includes a visual swatch, appropriate ARIA attributes, and event listeners to:
 * - apply the theme as a pending preview when clicked,
 * - show and position a tooltip on hover/focus/mousemove,
 * - hide the tooltip on blur/leave.
 *
 * Does nothing if the theme options container is not present in the DOM. Updates the theme
 * options label and the summary text after rendering.
 */
function renderColorThemeOptions() {
  const container = document.getElementById('theme-options');
  if (!container) return;

  container.innerHTML = '';
  const themes = getAccentThemes();
  const selectedTheme = getPendingTheme(activeColorTarget);

  themes.forEach((theme) => {
    const option = document.createElement('button');
    option.type = 'button';
    option.className = 'theme-option color-theme-option';
    option.dataset.theme = theme.id;
    option.dataset.customTheme = theme.isCustom ? 'true' : 'false';
    const isOriginalTheme = theme.id === 'original';
    const isBackgroundTarget = activeColorTarget === COLOR_TARGETS.background;
    const tooltipName = getThemeDisplayName(theme);
    const tooltipDescription = isOriginalTheme
      ? isBackgroundTarget
        ? t('Original base (no tint)')
        : t('Original accent blue')
      : theme.isCustom
        ? t('Saved custom color')
        : theme.description
          ? t(theme.description)
          : t('Theme color');
    option.setAttribute('role', 'radio');
    option.setAttribute('aria-label', `${tooltipName}. ${tooltipDescription}`);
    option.setAttribute('aria-checked', theme.id === selectedTheme ? 'true' : 'false');
    if (theme.id === selectedTheme) {
      option.classList.add('selected');
    }

    if (isBackgroundTarget) {
      // A background swatch is the window the choice gives (the colour mixed in lightly, in the
      // theme that is showing), with the choice itself as a dot, so the picker does not promise
      // a full-strength colour. The untinted base has no dot, and is the window colour itself.
      const windowColor =
        getBackgroundWindowColor(isOriginalTheme ? null : theme.color) ??
        getBackgroundWindowColor();
      const windowRgb = hexToRgb(windowColor);
      option.dataset.backgroundSwatch = isOriginalTheme ? 'base' : 'tinted';
      option.style.setProperty('--swatch-window', windowColor);
      option.style.setProperty(
        '--swatch',
        isOriginalTheme ? windowColor : theme.color || windowColor
      );
      if (isOriginalTheme && windowRgb) {
        option.style.setProperty('--swatch-rgb', `${windowRgb.r}, ${windowRgb.g}, ${windowRgb.b}`);
      } else if (theme.rgb) {
        option.style.setProperty('--swatch-rgb', theme.rgb);
      }
    } else {
      if (theme.color) {
        option.style.setProperty('--swatch', theme.color);
      }
      if (theme.rgb) {
        option.style.setProperty('--swatch-rgb', theme.rgb);
      }
    }

    const swatch = document.createElement('span');
    swatch.className = 'accent-theme-swatch';
    option.appendChild(swatch);

    option.addEventListener('click', () => {
      if (activeColorTarget === COLOR_TARGETS.background) {
        selectBackgroundTheme(theme.id, { preview: true });
      } else {
        selectAccentTheme(theme.id, { preview: true });
      }
    });
    // A radio group answers the arrow keys, Home and End by choosing and focusing the neighbour; the
    // pair of arrows for each direction means the grid works whichever way the eye reads it.
    option.addEventListener('keydown', (event) => {
      if (event.ctrlKey || event.metaKey || event.altKey || event.shiftKey) return;
      const swatches = [...container.querySelectorAll('.color-theme-option')];
      const next =
        swatches[
          getNextTabIndex(swatches.indexOf(option), swatches.length, event.key, {
            direction: getTextDirection(container),
            orientation: 'both',
          })
        ];
      if (!next) return;
      event.preventDefault();
      next.focus({ preventScroll: true });
      next.click();
    });
    option.addEventListener('mouseenter', () => {
      showThemeTooltip(option, tooltipName, tooltipDescription);
    });
    option.addEventListener('mouseleave', hideThemeTooltip);
    option.addEventListener('focus', () => {
      showThemeTooltip(option, tooltipName, tooltipDescription);
    });
    option.addEventListener('blur', hideThemeTooltip);
    option.addEventListener('mousemove', () => {
      positionThemeTooltip(option);
    });

    container.appendChild(option);
  });

  updateThemeSelectionUI();
  updateThemeOptionsLabel();
  updateThemeSummary();
  syncCustomColorEditorFromSelectedTheme();
  syncPersonalizationSectionHeight(document.getElementById('color-themes-section'));
}

/**
 * Slide each segmented control's highlight under its selected option. Controls on a hidden page
 * have no layout yet and are placed when their page opens.
 * @param {ParentNode} [root=document] - Where to look for segmented controls.
 */
function syncSegmentedIndicators(root = document) {
  root?.querySelectorAll?.('.segmented-control').forEach((control) => {
    syncSlidingIndicator(
      control,
      control.querySelector('.segmented-option.active, .btn.btn-primary') || null
    );
  });
}

function normalizeThemeMode(mode) {
  return THEME_MODES.includes(mode) ? mode : 'auto';
}

function getSavedThemeMode() {
  return normalizeThemeMode(state.CONFIG?.ui?.theme);
}

function isFollowingDesktopPalette() {
  const followOmarchy = document.getElementById('follow-omarchy');
  return !!followOmarchy && !followOmarchy.disabled && followOmarchy.checked;
}

function updateThemeModeControl() {
  const control = document.getElementById('theme-mode-control');
  if (!control) return;
  // A followed desktop palette decides light or dark itself, so the control shows the mode the
  // palette is in rather than a pick it ignores.
  const locked = isFollowingDesktopPalette();
  const paletteMode = state.CONFIG?.desktopAppearance?.mode;
  const mode =
    locked && THEME_MODES.includes(paletteMode)
      ? paletteMode
      : pendingThemeMode || getSavedThemeMode();
  control.classList.toggle('is-disabled', locked);
  control.querySelectorAll('[data-theme-mode]').forEach((option) => {
    const selected = option.dataset.themeMode === mode;
    option.classList.toggle('active', selected);
    option.setAttribute('aria-checked', selected ? 'true' : 'false');
    option.tabIndex = selected ? 0 : -1;
    option.disabled = locked;
  });
  syncSlidingIndicator(control, control.querySelector('.segmented-option.active'));
}

/**
 * Preview a theme mode live. Accent, background and glass tints are derived per mode, so they
 * are re-applied too; nothing is saved until Save.
 * @param {string} mode - 'auto', 'dark' or 'light'.
 */
function previewThemeMode(mode) {
  const nextMode = normalizeThemeMode(mode);
  if (nextMode !== (pendingThemeMode || getSavedThemeMode())) markSettingsTouched('ui.theme');
  pendingThemeMode = nextMode;
  applyTheme(pendingThemeMode);
  applyAccentTheme(pendingAccent || getCurrentAccentTheme());
  refreshBackgroundTheme();
  const values = getPreviewValuesFromInputs();
  applyWindowEffects(values || state.CONFIG || {});
  updateThemeModeControl();
  // The background swatches are drawn in the theme that is showing.
  if (activeColorTarget === COLOR_TARGETS.background) renderColorThemeOptions();
}

function restoreSavedThemeMode() {
  if (!pendingThemeMode) return;
  const changed = pendingThemeMode !== getSavedThemeMode();
  pendingThemeMode = null;
  if (!changed) return;
  applyTheme(getSavedThemeMode());
  applyAccentTheme(state.CONFIG?.ui?.accent || getCurrentAccentTheme());
  applyBackgroundTheme(state.CONFIG?.ui?.background || getCurrentBackgroundTheme());
  applyDesktopAppearance(state.CONFIG || {});
  applyWindowEffects(state.CONFIG || {});
  if (activeColorTarget === COLOR_TARGETS.background) renderColorThemeOptions();
}

function initThemeModeControl() {
  const control = document.getElementById('theme-mode-control');
  if (!control) return;
  pendingThemeMode = null;
  const options = [...control.querySelectorAll('[data-theme-mode]')];
  options.forEach((option, index) => {
    option.onclick = () => previewThemeMode(option.dataset.themeMode);
    option.onkeydown = (event) => {
      if (event.ctrlKey || event.metaKey || event.altKey || event.shiftKey) return;
      // The segments run right to left in Arabic, so the arrow that points at a neighbour has to
      // move there; getNextTabIndex swaps the pair in right-to-left text.
      const next =
        options[
          getNextTabIndex(index, options.length, event.key, {
            direction: getTextDirection(control),
            orientation: 'both',
          })
        ];
      if (!next) return;
      event.preventDefault();
      previewThemeMode(next.dataset.themeMode);
      next.focus();
    };
  });
  const followOmarchy = document.getElementById('follow-omarchy');
  if (followOmarchy && !followOmarchy.dataset.themeModeBound) {
    followOmarchy.dataset.themeModeBound = 'true';
    followOmarchy.addEventListener('change', previewFollowOmarchy);
  }
  updateThemeModeControl();
  updateColorsFollowState();
}

// Set once the Follow Omarchy switch has been used, so closing Settings puts the saved look back.
let followOmarchyPreviewed = false;

/**
 * While the Omarchy palette is followed it decides the accent, the background and the mode, and
 * Save would only have them overwritten again. The colour controls show that instead of looking
 * live: dimmed, out of the tab order, with a note.
 */
function updateColorsFollowState() {
  const group = document.getElementById('colors-group');
  if (!group) return;
  const following = isFollowingDesktopPalette();
  group.classList.toggle('is-following-palette', following);
  const body = group.querySelector('.settings-group-body');
  if (body) body.inert = following;
  const note = document.getElementById('colors-follow-note');
  if (note) note.hidden = !following;
}

/**
 * Show the Follow Omarchy switch's effect at once, like every other appearance control: the
 * palette when it is turned on, your own mode, accent and background when it is turned off.
 * Nothing is saved until Save, and closing Settings puts the saved look back.
 */
function previewFollowOmarchy() {
  updateThemeModeControl();
  updateColorsFollowState();
  followOmarchyPreviewed = true;
  const following = isFollowingDesktopPalette();
  const config = { ...state.CONFIG, ui: { ...state.CONFIG?.ui, followOmarchy: following } };
  if (!following) {
    applyTheme(pendingThemeMode || getSavedThemeMode());
    applyAccentTheme(pendingAccent || getCurrentAccentTheme());
    refreshBackgroundTheme();
  }
  applyDesktopAppearance(config);
  applyWindowEffects(getPreviewValuesFromInputs() || config);
}

function restoreFollowOmarchyPreview() {
  if (!followOmarchyPreviewed) return;
  followOmarchyPreviewed = false;
  applyTheme(getSavedThemeMode());
  applyAccentTheme(state.CONFIG?.ui?.accent || getCurrentAccentTheme());
  applyBackgroundTheme(state.CONFIG?.ui?.background || getCurrentBackgroundTheme());
  applyDesktopAppearance(state.CONFIG || {});
  applyWindowEffects(state.CONFIG || {});
}

/**
 * Initialize the "color-target-select" dropdown and bind its change handler to update the active color target.
 *
 * Sets the select's value to the current activeColorTarget and calls setActiveColorTarget when the user changes selection.
 */
function initColorTargetSelect() {
  const select = document.getElementById('color-target-select');
  if (select) {
    select.value = activeColorTarget;
    select.onchange = (e) => {
      setActiveColorTarget(e.target.value);
    };
  }

  document.querySelectorAll('.color-target-option').forEach((option) => {
    option.onclick = () => {
      setActiveColorTarget(option.dataset.colorTarget);
    };
    option.onkeydown = (event) => {
      if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) return;
      event.preventDefault();
      const nextTarget =
        activeColorTarget === COLOR_TARGETS.accent
          ? COLOR_TARGETS.background
          : COLOR_TARGETS.accent;
      setActiveColorTarget(nextTarget);
      document.querySelector(`.color-target-option[data-color-target="${nextTarget}"]`)?.focus();
    };
  });

  updateColorTargetUI();
}

function getSavedPersonalizationSectionStates() {
  const savedStates = state.CONFIG?.ui?.[PERSONALIZATION_SECTION_STATE_KEY];
  if (!savedStates || typeof savedStates !== 'object') return {};
  return Object.entries(savedStates).reduce((acc, [sectionId, isCollapsed]) => {
    if (!sectionId || isCollapsed !== true) return acc;
    acc[sectionId] = true;
    return acc;
  }, {});
}

function hydratePersonalizationSectionIfNeeded(section) {
  if (!section || !section.id) return;
  if (!PERSONALIZATION_LAZY_SECTION_IDS.has(section.id)) return;
  if (hydratedPersonalizationSections.has(section.id)) return;

  if (section.id === 'primary-cards-section') {
    renderPrimaryCardsEntityList();
  } else if (section.id === 'custom-entity-icons-section') {
    // Prime the icon catalog the first time the section opens.
    void ensureCustomEntityIconChoicesLoaded().catch((error) => {
      log.error('Failed to warm custom icon catalog:', error);
    });
    renderCustomEntityIconsList();
  }

  hydratedPersonalizationSections.add(section.id);
}

function applyPersonalizationSectionState(section, toggle, isCollapsed, options = {}) {
  if (!section || !toggle) return;
  const body = section.querySelector('.section-body');
  const immediate = options.immediate === true;

  toggle.setAttribute('aria-expanded', isCollapsed ? 'false' : 'true');
  if (!body) {
    section.classList.toggle('collapsed', isCollapsed);
    return;
  }

  body.hidden = false;
  // A collapsed body is only 0px high, which does not stop Tab entering it or a screen reader reading
  // it. Inert does, at once, in both directions.
  body.inert = isCollapsed;

  if (!isCollapsed) {
    hydratePersonalizationSectionIfNeeded(section);
  }

  syncPersonalizationSectionHeight(section);

  if (immediate) {
    const previousTransition = body.style.transition;
    body.style.transition = 'none';
    section.classList.toggle('collapsed', isCollapsed);
    syncPersonalizationSectionHeight(section);
    // Force layout so the no-transition state is applied before restoring transitions.
    void body.offsetHeight;
    body.style.transition = previousTransition;
    return;
  }

  section.classList.toggle('collapsed', isCollapsed);
  requestAnimationFrame(() => syncPersonalizationSectionHeight(section));
}

function persistPersonalizationSectionState(sectionId, isCollapsed) {
  if (!sectionId || !state.CONFIG) return;

  state.CONFIG.ui = state.CONFIG.ui || {};
  const currentStates = getSavedPersonalizationSectionStates();
  const currentlyCollapsed = currentStates[sectionId] === true;
  if (currentlyCollapsed === isCollapsed) return;

  const nextStates = { ...currentStates };
  if (isCollapsed) {
    nextStates[sectionId] = true;
  } else {
    delete nextStates[sectionId];
  }

  state.CONFIG.ui[PERSONALIZATION_SECTION_STATE_KEY] = nextStates;

  if (personalizationSectionPersistTimers.has(sectionId)) {
    clearTimeout(personalizationSectionPersistTimers.get(sectionId));
  }

  if (!window?.electronAPI?.updateConfig) return;
  const persistTimer = setTimeout(() => {
    personalizationSectionPersistTimers.delete(sectionId);
    const latestStates = getSavedPersonalizationSectionStates();
    window.electronAPI
      .updateConfig({
        ui: {
          ...state.CONFIG.ui,
          [PERSONALIZATION_SECTION_STATE_KEY]: latestStates,
        },
      })
      .catch((error) => {
        log.error('Failed to persist personalization section state:', error);
      });
  }, PERSONALIZATION_SECTION_PERSIST_DEBOUNCE_MS);
  personalizationSectionPersistTimers.set(sectionId, persistTimer);
}

/**
 * Initialize the color themes section toggle: ensure the section is expanded and wire the toggle button to collapse/expand it.
 *
 * If the section or toggle elements are not present in the DOM, the function no-ops.
 */
function initColorThemeSectionToggle() {
  const sections = document.querySelectorAll('.personalization-section');
  if (!sections.length) return;
  const savedSectionStates = getSavedPersonalizationSectionStates();

  sections.forEach((section) => {
    const toggle = section.querySelector('.section-toggle');
    if (!toggle) return;
    const body = section.querySelector('.section-body');
    if (body) personalizationSectionObserver?.observe(body);

    const isCollapsed =
      savedSectionStates[section.id] === true ? true : section.classList.contains('collapsed');
    applyPersonalizationSectionState(section, toggle, isCollapsed, { immediate: true });

    toggle.onclick = () => {
      const nextCollapsed = !section.classList.contains('collapsed');
      applyPersonalizationSectionState(section, toggle, nextCollapsed, { immediate: false });
      persistPersonalizationSectionState(section.id, nextCollapsed);
    };
  });
}

// A section's open height is measured when it opens and whenever its list is drawn, so a window
// made narrower (or a tiling manager resizing it) while one is open reflowed the text inside it and
// cut off its last rows. Watching the body re-measures it when its width changes.
const personalizationSectionObserver =
  typeof ResizeObserver === 'function'
    ? new ResizeObserver((entries) => {
        // Measuring changes layout, which an observer must not do while it is being delivered.
        requestAnimationFrame(() => {
          for (const { target } of entries) {
            // A hidden Settings dialog measures as zero, which would collapse the section.
            if (!target.getClientRects().length) continue;
            syncPersonalizationSectionHeight(target.closest('.personalization-section'));
          }
        });
      })
    : null;

function syncPersonalizationSectionHeight(section) {
  if (!section) return;
  const body = section.querySelector('.section-body');
  if (!body) return;

  // Measure natural content height even when section is collapsed.
  const previousInlineMaxHeight = body.style.maxHeight;
  body.style.maxHeight = 'none';
  const height = Math.max(0, body.scrollHeight);
  body.style.maxHeight = previousInlineMaxHeight;

  const nextValue = `${height}px`;
  if (section.style.getPropertyValue('--section-body-height') !== nextValue) {
    section.style.setProperty('--section-body-height', nextValue);
  }
}

function refreshPersonalizationSectionHeights() {
  const sections = document.querySelectorAll('.personalization-section');
  if (!sections.length) return;
  sections.forEach((section) => {
    syncPersonalizationSectionHeight(section);
  });
}

function getPendingPrimaryCards() {
  return normalizePrimaryCards(pendingPrimaryCards || state.CONFIG?.primaryCards);
}

function getPrimaryCardEntityOptions(filter = '') {
  const normalizedFilter = filter.toLowerCase();
  return Object.values(state.STATES || {})
    .filter(
      (entity) => !entity.entity_id.startsWith('sun.') && !entity.entity_id.startsWith('zone.')
    )
    .map((entity) => {
      if (!normalizedFilter) return { entity, score: 1 };
      const nameScore = utils.getSearchScore(utils.getEntityDisplayName(entity), normalizedFilter);
      const idScore = utils.getSearchScore(entity.entity_id, normalizedFilter);
      return { entity, score: nameScore + idScore };
    })
    .filter((item) => item.score > 0)
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      return compareNames(
        utils.getEntityDisplayName(a.entity),
        utils.getEntityDisplayName(b.entity)
      );
    });
}

// "(default)" belongs to the slot, not the item: Weather is Card 1's default and Time is Card 2's,
// so after swapping them neither card claims it.
function getPrimaryCardDisplay(selection, slotIndex) {
  if (selection === PRIMARY_CARD_NONE) return t('Hidden');
  if (selection === 'weather') return slotIndex === 0 ? t('Weather (default)') : t('Weather');
  if (selection === 'time') return slotIndex === 1 ? t('Time (default)') : t('Time');
  const entity = state.STATES?.[selection];
  if (entity) return `${utils.getEntityDisplayName(entity)} (${selection})`;
  return t('Unavailable: {{entityId}}', { entityId: selection });
}

function updatePrimaryCardSummary() {
  const selections = getPendingPrimaryCards();
  const cardOne = document.getElementById('primary-card-1-current');
  const cardTwo = document.getElementById('primary-card-2-current');
  if (cardOne) cardOne.textContent = getPrimaryCardDisplay(selections[0], 0);
  if (cardTwo) cardTwo.textContent = getPrimaryCardDisplay(selections[1], 1);
}

function updatePrimaryCardActionButtons() {
  const selections = getPendingPrimaryCards();
  document.querySelectorAll('[data-primary-card][data-primary-value]').forEach((btn) => {
    const cardIndex = Number(btn.dataset.primaryCard);
    const value = btn.dataset.primaryValue;
    const isActive = selections[cardIndex] === value;
    btn.classList.toggle('btn-primary', isActive);
    btn.classList.toggle('btn-secondary', !isActive);
    // The fill is the only visual cue; this is what a screen reader hears.
    btn.setAttribute('aria-pressed', String(isActive));
  });
  syncSegmentedIndicators(document.getElementById('settings-modal') || document);
}

let primaryCardPage = 0;
let primaryCardSearchTimer;

// Rebuilds a paged list the keyboard is working in. The pager buttons and the row controls are
// replaced by the render, which would send focus to <body>; the control with the same data-*
// attributes takes it back, and the list keeps its scroll position.
function preserveListFocus(list, render) {
  const focused = list.contains(document.activeElement) ? document.activeElement : null;
  const attributes = focused
    ? Array.from(focused.attributes).filter(({ name }) => name.startsWith('data-'))
    : [];
  const scrollTop = list.scrollTop;
  render();
  if (attributes.length) {
    const replacement = Array.from(list.querySelectorAll('button, input')).find((control) =>
      attributes.every(({ name, value }) => control.getAttribute(name) === value)
    );
    replacement?.focus({ preventScroll: true });
  }
  list.scrollTop = scrollTop;
}

function renderPrimaryCardsEntityList() {
  const list = document.getElementById('primary-cards-list');
  if (list) preserveListFocus(list, renderPrimaryCardsEntityRows);
}

function renderPrimaryCardsEntityRows() {
  const list = document.getElementById('primary-cards-list');
  const searchInput = document.getElementById('primary-cards-search');
  if (!list || !searchInput) return;

  const filter = searchInput.value || '';
  const selections = getPendingPrimaryCards();
  const scoredEntities = getPrimaryCardEntityOptions(filter);

  list.innerHTML = '';

  if (!scoredEntities.length) {
    list.innerHTML = `<div class="no-entities-message">${utils.escapeHtml(t('No matching entities found.'))}</div>`;
    return;
  }

  const shown = paginate(scoredEntities, primaryCardPage);
  primaryCardPage = shown.page;
  shown.items.forEach(({ entity }) => {
    const item = document.createElement('div');
    item.className = 'entity-item';

    const icon = entityIconMarkup(entity);
    const displayName = utils.escapeHtml(utils.getEntityDisplayName(entity));
    const entityId = utils.escapeHtml(entity.entity_id);
    const entityIdAttr = utils.escapeHtmlAttribute(entity.entity_id);

    const isCardOne = selections[0] === entity.entity_id;
    const isCardTwo = selections[1] === entity.entity_id;

    const cardOneLabel = utils.escapeHtml(
      isCardOne ? t('Card {{index}} ✓', { index: 1 }) : t('Set Card {{index}}', { index: 1 })
    );
    const cardTwoLabel = utils.escapeHtml(
      isCardTwo ? t('Card {{index}} ✓', { index: 2 }) : t('Set Card {{index}}', { index: 2 })
    );
    const cardOneClass = isCardOne ? 'btn btn-primary btn-sm' : 'btn btn-secondary btn-sm';
    const cardTwoClass = isCardTwo ? 'btn btn-primary btn-sm' : 'btn btn-secondary btn-sm';
    const cardOneDisabled = isCardOne ? 'aria-disabled="true"' : '';
    const cardTwoDisabled = isCardTwo ? 'aria-disabled="true"' : '';

    item.innerHTML = `
      <div class="entity-item-main">
        <span class="entity-icon">${icon}</span>
        <div class="entity-item-info">
          <span class="entity-name">${displayName}</span>
          <span class="entity-id" title="${entityIdAttr}">${entityId}</span>
        </div>
      </div>
      <div class="primary-cards-list-actions">
        <button class="${cardOneClass}" type="button" data-primary-assign="0" data-entity-id="${entityIdAttr}" ${cardOneDisabled}>${cardOneLabel}</button>
        <button class="${cardTwoClass}" type="button" data-primary-assign="1" data-entity-id="${entityIdAttr}" ${cardTwoDisabled}>${cardTwoLabel}</button>
      </div>
    `;
    // Two buttons per entity, and a screen reader hears "Set Card 1" a hundred times; the group
    // says which entity they are for.
    const actionGroup = item.querySelector('.primary-cards-list-actions');
    actionGroup.setAttribute('role', 'group');
    actionGroup.setAttribute('aria-label', utils.getEntityDisplayName(entity));

    list.appendChild(item);
  });

  renderListPager(list, {
    page: shown.page,
    pageCount: shown.pageCount,
    onChange: (page) => {
      primaryCardPage = page;
      renderPrimaryCardsEntityList();
    },
  });

  syncPersonalizationSectionHeight(document.getElementById('primary-cards-section'));
}

function setPendingPrimaryCards(value, options = {}) {
  pendingPrimaryCards = normalizePrimaryCards(value);
  updatePrimaryCardSummary();
  updatePrimaryCardActionButtons();
  const shouldRenderList = options.renderList !== false;
  if (shouldRenderList) {
    renderPrimaryCardsEntityList();
    hydratedPersonalizationSections.add('primary-cards-section');
  }
}

function initPrimaryCardsUI() {
  const section = document.getElementById('primary-cards-section');
  if (!section || section.dataset.initialized) return;

  const resetBtn = document.getElementById('primary-cards-reset');
  if (resetBtn) {
    resetBtn.addEventListener('click', () => {
      markSettingsTouched('primaryCards');
      setPendingPrimaryCards(PRIMARY_CARD_DEFAULTS);
    });
  }

  // The Card 1 / Card 2 choices sit beside the collapsible entity picker rather than inside it,
  // so listen on the group that holds both.
  const clickRoot = section.closest('.settings-group') || section;
  clickRoot.addEventListener('click', (event) => {
    const actionBtn = event.target.closest('[data-primary-card][data-primary-value]');
    if (actionBtn) {
      const cardIndex = Number(actionBtn.dataset.primaryCard);
      const value = actionBtn.dataset.primaryValue;
      const selections = getPendingPrimaryCards();
      selections[cardIndex] = value;
      markSettingsTouched('primaryCards');
      setPendingPrimaryCards(selections);
      return;
    }

    const assignBtn = event.target.closest('[data-primary-assign][data-entity-id]');
    if (assignBtn) {
      if (assignBtn.getAttribute('aria-disabled') === 'true') return;
      const cardIndex = Number(assignBtn.dataset.primaryAssign);
      const entityId = assignBtn.dataset.entityId;
      const selections = getPendingPrimaryCards();
      selections[cardIndex] = entityId;
      markSettingsTouched('primaryCards');
      setPendingPrimaryCards(selections);
    }
  });

  const searchInput = document.getElementById('primary-cards-search');
  if (searchInput) {
    searchInput.addEventListener('input', () => {
      clearTimeout(primaryCardSearchTimer);
      primaryCardPage = 0;
      primaryCardSearchTimer = setTimeout(() => {
        renderPrimaryCardsEntityList();
        // A new query starts at its first match, not wherever the last list was scrolled to.
        const list = document.getElementById('primary-cards-list');
        if (list) list.scrollTop = 0;
      }, 150);
    });
  }

  section.dataset.initialized = 'true';
}

function getPendingCustomIcon(entityId) {
  if (!entityId) return null;
  return pendingCustomEntityIcons[entityId] || null;
}

function updateCustomEntityIconSummary() {
  const summaryEl = document.getElementById('custom-entity-icons-summary');
  if (!summaryEl) return;
  const count = Object.keys(pendingCustomEntityIcons).length;
  // Nothing to reset with no icons set; the button says so instead of claiming it cleared them.
  const resetAll = document.getElementById('custom-entity-icons-reset-all');
  if (resetAll) resetAll.disabled = count === 0;
  if (count === 0) {
    summaryEl.textContent = t('No custom icons configured.');
    return;
  }
  summaryEl.textContent =
    count === 1
      ? t('1 custom icon configured.')
      : t('{{count}} custom icons configured.', { count });
}

function getCustomEntityIconChoiceLabel(choice) {
  if (choice.aliases.length) {
    const visibleAliases = choice.aliases.slice(0, 4).join(', ');
    return choice.aliases.length > 4 ? `${visibleAliases}, ...` : visibleAliases;
  }
  const codepointLabel = choice.codepointTerms.find((term) => term.startsWith('u+'));
  return codepointLabel ? codepointLabel.toUpperCase() : t('Emoji');
}

// A grid of every emoji (nearly four thousand) is slow to build and a mile to scroll, so the picker
// shows the best matches and asks for a query to narrow the rest.
const CUSTOM_ENTITY_ICON_PICKER_LIMIT = 120;

function renderCustomEntityIconPickerChoices(pickerEl, entityId, filterValue = '') {
  if (!pickerEl) return;
  const choices = Array.isArray(customEntityIconChoices) ? customEntityIconChoices : [];

  if (!choices.length) {
    pickerEl.innerHTML = '';
    const loadingState = document.createElement('div');
    loadingState.className = 'custom-entity-icon-picker-meta';
    loadingState.textContent = t('Loading icon catalog...');
    pickerEl.appendChild(loadingState);
    ensureCustomEntityIconChoicesLoaded()
      .then(() => {
        if (!pickerEl.isConnected) return;
        renderCustomEntityIconPickerChoices(pickerEl, entityId, filterValue);
      })
      .catch((error) => {
        log.error('Failed to load custom icon catalog:', error);
        if (!pickerEl.isConnected) return;
        pickerEl.innerHTML = '';
        const errorState = document.createElement('div');
        errorState.className = 'custom-entity-icon-picker-empty';
        errorState.textContent = t('Failed to load icon catalog.');
        pickerEl.appendChild(errorState);
      });
    return;
  }

  const filteredChoices = getFilteredCustomEntityIconChoices(filterValue);
  pickerEl.innerHTML = '';

  // Nothing matched: one line that says so and what to try, not a count of zero above a second line.
  if (!filteredChoices.length) {
    const emptyState = document.createElement('div');
    emptyState.className = 'custom-entity-icon-picker-empty';
    emptyState.setAttribute('role', 'status');
    emptyState.textContent = t(
      'No icons match “{{query}}”. Try a simpler word, or paste an emoji.',
      { query: filterValue }
    );
    pickerEl.appendChild(emptyState);
    return;
  }

  const shownChoices = filteredChoices.slice(0, CUSTOM_ENTITY_ICON_PICKER_LIMIT);
  const summary = document.createElement('div');
  summary.className = 'custom-entity-icon-picker-meta';
  // The count changes as the query does; saying so lets a screen reader follow the narrowing.
  summary.setAttribute('aria-live', 'polite');
  if (filteredChoices.length > shownChoices.length) {
    summary.textContent = t(
      'Showing the first {{shown}} of {{count}} icons. Type to narrow them.',
      {
        shown: formatNumber(shownChoices.length),
        count: formatNumber(filteredChoices.length),
      }
    );
  } else {
    summary.textContent = t('Showing {{shown}} of {{total}} icons for “{{query}}”.', {
      shown: formatNumber(filteredChoices.length),
      total: formatNumber(choices.length),
      query: filterValue,
    });
  }
  pickerEl.appendChild(summary);

  const grid = document.createElement('div');
  grid.className = 'custom-entity-icon-picker-grid';
  // The choices are buttons, not options: a listbox needs role="option" children.
  grid.setAttribute('role', 'group');
  grid.setAttribute('aria-label', t('Choose icon for {{entityId}}', { entityId }));
  grid.addEventListener('keydown', handleCustomEntityIconGridKeydown);

  shownChoices.forEach((choice, index) => {
    const choiceBtn = document.createElement('button');
    choiceBtn.type = 'button';
    choiceBtn.className = 'custom-entity-icon-choice';
    // One Tab stop for the grid, whatever its size; the arrow keys move within it.
    choiceBtn.tabIndex = index === 0 ? 0 : -1;
    choiceBtn.textContent = choice.icon;
    const choiceLabel = getCustomEntityIconChoiceLabel(choice);
    choiceBtn.title = choiceLabel;
    choiceBtn.dataset.customIconChoice = choice.icon;
    choiceBtn.dataset.customIconChoiceEntity = entityId;
    choiceBtn.setAttribute('aria-label', `${choiceLabel} (${choice.icon})`);
    grid.appendChild(choiceBtn);
  });

  pickerEl.appendChild(grid);
}

// Arrow keys, Home and End move through the icon grid, which is a single Tab stop. Up and Down jump
// a row, worked out from where the buttons are laid out.
function handleCustomEntityIconGridKeydown(event) {
  const choices = [...event.currentTarget.querySelectorAll('.custom-entity-icon-choice')];
  const current = choices.indexOf(event.target.closest('.custom-entity-icon-choice'));
  if (current < 0) return;
  const rtl = getComputedStyle(event.currentTarget).direction === 'rtl';
  const firstRowTop = choices[0].offsetTop;
  const secondRowStart = choices.findIndex((button) => button.offsetTop !== firstRowTop);
  const rowLength = secondRowStart > 0 ? secondRowStart : choices.length;
  const steps = {
    ArrowRight: rtl ? -1 : 1,
    ArrowLeft: rtl ? 1 : -1,
    ArrowDown: rowLength,
    ArrowUp: -rowLength,
  };
  let next;
  if (event.key === 'Home') next = 0;
  else if (event.key === 'End') next = choices.length - 1;
  else if (event.key in steps)
    next = Math.min(Math.max(current + steps[event.key], 0), choices.length - 1);
  else return;
  event.preventDefault();
  choices[current].tabIndex = -1;
  choices[next].tabIndex = 0;
  choices[next].focus();
}

// The row the person is working in: the one whose picker is open, or the one holding the focus.
function getCustomEntityIconAnchorEntityId(list) {
  if (activeCustomEntityIconPickerEntityId) return activeCustomEntityIconPickerEntityId;
  const focused = list.contains(document.activeElement) ? document.activeElement : null;
  const control = focused?.closest('[data-custom-icon-input], [data-custom-icon-picker-toggle]');
  return control?.dataset.customIconInput || control?.dataset.customIconPickerToggle || '';
}

// Every caller (the pager, the search, a row's buttons, closing a picker) rebuilds the whole page,
// so each one hands the keyboard back to the control it was on instead of dropping it to <body>.
function renderCustomEntityIconsList() {
  const list = document.getElementById('custom-entity-icons-list');
  if (list) preserveListFocus(list, renderCustomEntityIconRows);
}

function renderCustomEntityIconRows() {
  const list = document.getElementById('custom-entity-icons-list');
  const searchInput = document.getElementById('custom-entity-icons-search');
  if (!list || !searchInput) return;
  const anchorEntityId = getCustomEntityIconAnchorEntityId(list);
  list.classList.toggle(
    'custom-entity-icons-list-expanded',
    !!activeCustomEntityIconPickerEntityId
  );

  const filter = searchInput.value || '';
  const scoredEntities = getPrimaryCardEntityOptions(filter);
  list.innerHTML = '';

  if (!scoredEntities.length) {
    list.innerHTML = `<div class="no-entities-message">${utils.escapeHtml(t('No matching entities found.'))}</div>`;
    updateCustomEntityIconSummary();
    syncPersonalizationSectionHeight(document.getElementById('custom-entity-icons-section'));
    return;
  }

  const shown = paginate(scoredEntities, customEntityIconPage);
  customEntityIconPage = shown.page;
  shown.items.forEach(({ entity }) => {
    const entityId = entity.entity_id;
    const pendingIcon = getPendingCustomIcon(entityId);
    const pickerQuery = getCustomEntityIconPickerQuery(entityId);
    const hasCustomIcon = !!pendingIcon;
    const isPickerOpen = activeCustomEntityIconPickerEntityId === entityId;
    const showAppliedIndicator =
      !!lastCustomEntityIconAction && lastCustomEntityIconAction.entityId === entityId;

    const item = document.createElement('div');
    item.className = 'entity-item custom-entity-icon-item';

    const itemMain = document.createElement('div');
    itemMain.className = 'entity-item-main';

    const icon = document.createElement('span');
    icon.className = 'entity-icon custom-entity-icon-preview';
    // Without a custom icon the preview shows what the tile draws: the default line icon.
    if (pendingIcon) icon.textContent = pendingIcon;
    else renderEntityIcon(icon, entity, { ignoreCustomIcon: true });
    itemMain.appendChild(icon);

    const info = document.createElement('div');
    info.className = 'entity-item-info';

    const name = document.createElement('span');
    name.className = 'entity-name';
    name.textContent = utils.getEntityDisplayName(entity);
    info.appendChild(name);

    const entityIdLabel = document.createElement('span');
    entityIdLabel.className = 'entity-id';
    entityIdLabel.title = entityId;
    entityIdLabel.textContent = entityId;
    info.appendChild(entityIdLabel);

    if (hasCustomIcon) {
      const customBadge = document.createElement('span');
      customBadge.className = 'custom-entity-icon-badge';
      customBadge.textContent = t('Custom');
      info.appendChild(customBadge);
    }

    if (showAppliedIndicator) {
      const actionBadge = document.createElement('span');
      actionBadge.className = 'custom-entity-icon-action-badge';
      actionBadge.textContent =
        lastCustomEntityIconAction.action === 'reset'
          ? t('Reset (unsaved)')
          : t('Applied (unsaved)');
      info.appendChild(actionBadge);
    }

    itemMain.appendChild(info);
    item.appendChild(itemMain);

    const controls = document.createElement('div');
    controls.className = 'custom-entity-icon-controls';

    const actions = document.createElement('div');
    actions.className = 'custom-entity-icon-actions';

    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'custom-entity-icon-input';
    input.placeholder = t('Search emoji or paste one');
    input.maxLength = 64;
    input.value = pickerQuery || pendingIcon || '';
    input.autocomplete = 'off';
    input.setAttribute('aria-label', t('Custom icon for {{entityId}}', { entityId }));
    input.dataset.customIconInput = entityId;
    actions.appendChild(input);

    const chooseBtn = document.createElement('button');
    chooseBtn.type = 'button';
    chooseBtn.className = 'btn btn-secondary btn-sm';
    chooseBtn.textContent = t('Search');
    chooseBtn.dataset.customIconPickerToggle = entityId;
    chooseBtn.setAttribute('aria-expanded', isPickerOpen ? 'true' : 'false');
    actions.appendChild(chooseBtn);

    const applyBtn = document.createElement('button');
    applyBtn.type = 'button';
    applyBtn.className = 'btn btn-secondary btn-sm';
    applyBtn.textContent = t('Apply');
    applyBtn.dataset.customIconApply = entityId;
    actions.appendChild(applyBtn);

    const resetBtn = document.createElement('button');
    resetBtn.type = 'button';
    resetBtn.className = 'btn btn-secondary btn-reset btn-sm';
    resetBtn.textContent = t('Reset');
    resetBtn.disabled = !hasCustomIcon;
    resetBtn.dataset.customIconReset = entityId;
    actions.appendChild(resetBtn);

    // Search, Apply and Reset repeat for every entity; the group says which one they belong to.
    actions.setAttribute('role', 'group');
    actions.setAttribute('aria-label', name.textContent);
    controls.appendChild(actions);

    if (isPickerOpen) {
      const picker = document.createElement('div');
      picker.className = 'custom-entity-icon-picker';
      picker.dataset.customIconPicker = entityId;
      renderCustomEntityIconPickerChoices(picker, entityId, pickerQuery);

      controls.appendChild(picker);
    }

    item.appendChild(controls);
    list.appendChild(item);
  });

  renderListPager(list, {
    page: shown.page,
    pageCount: shown.pageCount,
    onChange: (page) => {
      customEntityIconPage = page;
      activeCustomEntityIconPickerEntityId = null;
      renderCustomEntityIconsList();
    },
  });

  updateCustomEntityIconSummary();
  syncPersonalizationSectionHeight(document.getElementById('custom-entity-icons-section'));
  // The list is rebuilt, and opening a picker also lets the list grow to its full height, which
  // used to leave the row the person was in thousands of pixels away. Bring it back into view.
  if (anchorEntityId) {
    const anchorRow = [...list.querySelectorAll('[data-custom-icon-input]')]
      .find((input) => input.dataset.customIconInput === anchorEntityId)
      ?.closest('.custom-entity-icon-item');
    requestAnimationFrame(() => anchorRow?.scrollIntoView?.({ block: 'nearest' }));
  }
}

function applyCustomEntityIconFromInput(entityId, rawIcon) {
  if (!entityId) return;

  const trimmed = typeof rawIcon === 'string' ? rawIcon.trim() : '';
  const normalized = normalizeCustomEntityIcon(rawIcon);
  if (trimmed && !normalized) {
    showToast(t('Custom icon must be a single emoji.'), 'error', 3000);
    return;
  }
  // An empty field on a row with no icon has nothing to clear: no message, no unsaved badge, and
  // the setting is not marked edited.
  if (!normalized && !getPendingCustomIcon(entityId)) return;

  const next = { ...pendingCustomEntityIcons };
  if (normalized) {
    next[entityId] = normalized;
    lastCustomEntityIconAction = { entityId, action: 'apply' };
    showToast(t('Icon applied. Click Save to persist changes.'), 'success', 2200);
  } else {
    delete next[entityId];
    lastCustomEntityIconAction = { entityId, action: 'reset' };
    showToast(t('Custom icon cleared. Click Save to persist changes.'), 'info', 2200);
  }
  pendingCustomEntityIcons = next;
  markSettingsTouched('customEntityIcons');
  setCustomEntityIconPickerQuery(entityId, '');
  activeCustomEntityIconPickerEntityId = null;
  renderCustomEntityIconsList();
}

function resetCustomEntityIcon(entityId) {
  if (!entityId) return;
  if (!Object.prototype.hasOwnProperty.call(pendingCustomEntityIcons, entityId)) return;
  const next = { ...pendingCustomEntityIcons };
  delete next[entityId];
  lastCustomEntityIconAction = { entityId, action: 'reset' };
  showToast(t('Custom icon reset. Click Save to persist changes.'), 'info', 2200);
  pendingCustomEntityIcons = next;
  markSettingsTouched('customEntityIcons');
  setCustomEntityIconPickerQuery(entityId, '');
  activeCustomEntityIconPickerEntityId = null;
  renderCustomEntityIconsList();
}

async function resetAllCustomEntityIcons() {
  if (!Object.keys(pendingCustomEntityIcons).length) return;
  // Every icon the person set is dropped at once, and Cancel on the Settings window would also drop
  // every other edit to get them back.
  const confirmed = await showConfirm(
    t('Reset all custom icons'),
    t('Remove every custom icon? Nothing changes for good until you select Save.'),
    { confirmText: t('Reset'), confirmClass: 'btn-danger' }
  );
  if (!confirmed) return;
  pendingCustomEntityIcons = {};
  markSettingsTouched('customEntityIcons');
  customEntityIconPickerQueryByEntityId = {};
  activeCustomEntityIconPickerEntityId = null;
  lastCustomEntityIconAction = null;
  showToast(t('All custom icons cleared. Click Save to persist changes.'), 'info', 2400);
  renderCustomEntityIconsList();
}

function initCustomEntityIconsUI() {
  const section = document.getElementById('custom-entity-icons-section');
  if (!section || section.dataset.initialized) return;

  section.addEventListener('click', (event) => {
    const resetAllBtn = event.target.closest('#custom-entity-icons-reset-all');
    if (resetAllBtn) {
      void resetAllCustomEntityIcons();
      return;
    }

    const pickerToggleBtn = event.target.closest('[data-custom-icon-picker-toggle]');
    if (pickerToggleBtn) {
      const entityId = pickerToggleBtn.dataset.customIconPickerToggle;
      const iconInput = section.querySelector(`[data-custom-icon-input="${entityId}"]`);
      syncCustomEntityIconPickerQueryFromInput(entityId, iconInput?.value || '');
      // Search always shows the matches. It used to toggle, so a query that had already opened the
      // picker was hidden by pressing the button that says Search; Escape and leaving the row close.
      activeCustomEntityIconPickerEntityId = entityId;
      renderCustomEntityIconsList();
      // The list was rebuilt under the Search button; the keyboard stays on it.
      section.querySelector(`[data-custom-icon-picker-toggle="${entityId}"]`)?.focus();
      return;
    }

    const choiceBtn = event.target.closest(
      '[data-custom-icon-choice][data-custom-icon-choice-entity]'
    );
    if (choiceBtn) {
      const entityId = choiceBtn.dataset.customIconChoiceEntity;
      const icon = choiceBtn.dataset.customIconChoice;
      applyCustomEntityIconFromInput(entityId, icon || '');
      // The picker closed with the choice; the row's field is where to carry on.
      refocusCustomEntityIconInput(section, entityId);
      return;
    }

    const applyBtn = event.target.closest('[data-custom-icon-apply]');
    if (applyBtn) {
      const entityId = applyBtn.dataset.customIconApply;
      const input = section.querySelector(`[data-custom-icon-input="${entityId}"]`);
      applyCustomEntityIconFromInput(entityId, input?.value || '');
      section.querySelector(`[data-custom-icon-apply="${entityId}"]`)?.focus();
      return;
    }

    const resetBtn = event.target.closest('[data-custom-icon-reset]');
    if (resetBtn) {
      const entityId = resetBtn.dataset.customIconReset;
      resetCustomEntityIcon(entityId);
      // Reset is disabled now that there is nothing to reset, so focus moves to the row's field.
      refocusCustomEntityIconInput(section, entityId);
    }
  });

  section.addEventListener('input', (event) => {
    const input = event.target.closest('[data-custom-icon-input]');
    if (!input) return;
    const entityId = input.dataset.customIconInput;
    syncCustomEntityIconPickerQueryFromInput(entityId, input.value);
    if (activeCustomEntityIconPickerEntityId !== entityId) {
      if (!getCustomEntityIconPickerQuery(entityId)) return;
      activeCustomEntityIconPickerEntityId = entityId;
      renderCustomEntityIconsList();
      refocusCustomEntityIconInput(section, entityId);
      return;
    }

    const pickerEl = section.querySelector(`[data-custom-icon-picker="${entityId}"]`);
    if (!pickerEl) return;
    const query = getCustomEntityIconPickerQuery(entityId);
    renderCustomEntityIconPickerChoices(pickerEl, entityId, query);
    syncPersonalizationSectionHeight(document.getElementById('custom-entity-icons-section'));
  });

  section.addEventListener('focusout', (event) => {
    const input = event.target.closest('[data-custom-icon-input]');
    if (!input) return;
    const entityId = input.dataset.customIconInput;
    if (!entityId || activeCustomEntityIconPickerEntityId !== entityId) return;
    const capturedEntityId = entityId;

    // Allow focus to settle before deciding whether the picker should close.
    setTimeout(() => {
      if (activeCustomEntityIconPickerEntityId !== capturedEntityId) return;

      const controls = section
        .querySelector(`[data-custom-icon-input="${capturedEntityId}"]`)
        ?.closest('.custom-entity-icon-controls');
      const activeElement = document.activeElement;
      const shouldKeepOpen = !!(controls && activeElement && controls.contains(activeElement));
      if (shouldKeepOpen) return;
      activeCustomEntityIconPickerEntityId = null;
      renderCustomEntityIconsList();
    }, 0);
  });

  section.addEventListener('keydown', (event) => {
    // Escape closes the open picker and nothing else. Left alone it would reach Settings and discard
    // every unsaved edit on every page, when all that was meant was to dismiss a grid.
    if (event.key === 'Escape' && activeCustomEntityIconPickerEntityId) {
      event.preventDefault();
      event.stopPropagation();
      const entityId = activeCustomEntityIconPickerEntityId;
      activeCustomEntityIconPickerEntityId = null;
      renderCustomEntityIconsList();
      refocusCustomEntityIconInput(section, entityId);
      return;
    }
    // An IME's Enter confirms its composition (and can arrive with isComposing already false, as
    // keyCode 229); it is not a request to apply, so it is left alone before anything is cancelled.
    if (event.key !== 'Enter' || event.isComposing || event.keyCode === 229) return;
    const input = event.target.closest('[data-custom-icon-input]');
    if (!input) return;
    event.preventDefault();
    const entityId = input.dataset.customIconInput;
    const typed = input.value.trim();
    if (typed && !normalizeCustomEntityIcon(typed)) {
      // A keyword is a search, not an icon: show what it found and step into the matches, rather
      // than reporting that "lamp" is not a single emoji.
      syncCustomEntityIconPickerQueryFromInput(entityId, input.value);
      activeCustomEntityIconPickerEntityId = entityId;
      renderCustomEntityIconsList();
      refocusCustomEntityIconInput(section, entityId);
      section
        .querySelector(`[data-custom-icon-picker="${entityId}"] .custom-entity-icon-choice`)
        ?.focus();
      return;
    }
    applyCustomEntityIconFromInput(entityId, input.value || '');
  });

  // Rows are rebuilt for every query, so typing waits for a pause, as the top cards' search does.
  const searchInput = document.getElementById('custom-entity-icons-search');
  if (searchInput) {
    searchInput.addEventListener('input', () => {
      clearTimeout(customEntityIconSearchTimer);
      customEntityIconSearchTimer = setTimeout(() => {
        activeCustomEntityIconPickerEntityId = null;
        customEntityIconPage = 0;
        renderCustomEntityIconsList();
        const list = document.getElementById('custom-entity-icons-list');
        if (list) list.scrollTop = 0;
      }, 150);
    });
  }

  section.dataset.initialized = 'true';
}

/**
 * Map a stored window opacity (0.5-1.0) to the Window Opacity slider position (1-100).
 * @param {number} opacity - Stored opacity.
 * @returns {number} Slider position.
 */
function opacityToSliderValue(opacity) {
  const storedOpacity = Math.max(0.5, Math.min(1, opacity || 0.95));
  return Math.round(1 + (storedOpacity - 0.5) * 198);
}

/**
 * Map a Window Opacity slider position (1-100) back to an opacity (0.5-1.0).
 *
 * The slider has 100 steps, so most stored opacities (the 0.95 default included) sit between two
 * of them. While the slider still shows the position the stored value loaded at, the stored value
 * is kept, so saving without touching the slider does not nudge it.
 * @param {number} sliderValue - Slider position.
 * @param {number} [storedOpacity] - Current stored opacity.
 * @returns {number} Opacity to preview or save.
 */
function sliderValueToOpacity(sliderValue, storedOpacity) {
  if (
    storedOpacity >= 0.5 &&
    storedOpacity <= 1 &&
    sliderValue === opacityToSliderValue(storedOpacity)
  ) {
    return storedOpacity;
  }
  return 0.5 + ((sliderValue - 1) * 0.5) / 99;
}

/**
 * Write the Window opacity readout beside the slider: the opacity its position stands for, as a
 * percentage. The slider runs 1 to 100 over opacities of 50 to 100%, so its raw position is not
 * a figure anyone can read as a percentage.
 */
function updateOpacityReadout() {
  const slider = document.getElementById('opacity-slider');
  const readout = document.getElementById('opacity-value');
  if (!slider || !readout) return;
  const opacity = sliderValueToOpacity(parseInt(slider.value, 10) || 90, state.CONFIG?.opacity);
  const text = formatPercent(Math.round(opacity * 100));
  readout.textContent = text;
  // The thumb's position (1 to 100) is not the opacity; a screen reader announces the percentage.
  slider.setAttribute('aria-valuetext', text);
}

/**
 * Read preview controls from the DOM and derive window effect values.
 *
 * Reads the #opacity-slider and #frosted-glass inputs; if either is missing, returns `null`.
 * Maps the slider (1–100, default 90) to an opacity value in the range 0.5–1.0 and reads the frosted glass checkbox state.
 * @returns {{opacity: number, frostedGlass: boolean} | null} An object with `opacity` (0.5–1.0) and `frostedGlass` boolean, or `null` if required inputs are not present.
 */
function getPreviewValuesFromInputs() {
  const opacitySlider = document.getElementById('opacity-slider');
  const frostedGlass = document.getElementById('frosted-glass');
  if (!opacitySlider || !frostedGlass) return null;

  const sliderValue = parseInt(opacitySlider.value, 10) || 90;
  const opacity = sliderValueToOpacity(sliderValue, state.CONFIG?.opacity);
  const frostedGlassEnabled = !!frostedGlass.checked;

  const weatherEffectsEnabled = document.getElementById('weather-effects-enabled');
  const weatherEffectsEnabledVal = weatherEffectsEnabled
    ? frostedGlassEnabled && !!weatherEffectsEnabled.checked
    : false;

  const weatherOverrideSelect = document.getElementById('weather-override-select');
  const weatherOverrideVal = weatherOverrideSelect ? weatherOverrideSelect.value : 'auto';

  return {
    opacity,
    frostedGlass: frostedGlassEnabled,
    weatherEffectsEnabled: weatherEffectsEnabledVal,
    weatherOverride: weatherOverrideVal,
    desktopCapabilities: state.CONFIG?.desktopCapabilities,
  };
}

/**
 * Apply the current preview window effect settings from the UI and request a native preview.
 *
 * Reads preview controls, re-applies the background preview, applies the window effects in-page, and, if present, asks the Electron API to show a native preview. Errors during application or the native preview request are logged to the console.
 */
function previewWindowEffectsNow() {
  try {
    const values = getPreviewValuesFromInputs();
    if (!values) return;

    refreshBackgroundTheme();
    applyWindowEffects(values);

    if (window?.electronAPI?.previewWindowEffects) {
      window.electronAPI
        .previewWindowEffects({
          opacity: values.opacity,
          frostedGlass: values.frostedGlass,
        })
        .catch((err) => {
          log.error('Failed to preview window effects:', err);
        });
    }

    if (settingsUiHooks?.updateWeatherEffects) {
      settingsUiHooks.updateWeatherEffects(values.weatherEffectsEnabled, values.weatherOverride);
    }
  } catch (error) {
    log.error('Error applying preview window effects:', error);
  }
}

/**
 * Schedule an update to the window preview effects, coalescing multiple calls into a single animation frame.
 *
 * If `requestAnimationFrame` is not available, performs the update immediately. Additional calls while an update is already scheduled have no effect.
 */
function previewWindowEffects() {
  if (previewRaf) return;
  if (typeof requestAnimationFrame !== 'function') {
    previewWindowEffectsNow();
    return;
  }
  previewRaf = requestAnimationFrame(() => {
    previewRaf = null;
    previewWindowEffectsNow();
  });
}

/**
 * Cancel any pending window-effects preview and clear its scheduled handle.
 *
 * This stops a previously scheduled animation-frame preview (if any) and resets the internal RAF handle.
 */
function cancelPreviewWindowEffects() {
  if (!previewRaf || typeof cancelAnimationFrame !== 'function') return;
  cancelAnimationFrame(previewRaf);
  previewRaf = null;
}

/**
 * Restore the window's visual effects from the saved preview state.
 *
 * If no preview state is available this function is a no-op. When a preview
 * exists it cancels any pending preview updates, re-applies the current
 * background theme, applies the saved window effect values (opacity and
 * frosted-glass) and requests the native/Electron layer to apply the same
 * preview. Errors are logged to the console.
 */
/** The window effects a config saves, which closing Settings restores. */
function savedWindowEffects(config) {
  return {
    opacity: Math.max(0.5, Math.min(1, config?.opacity || 0.95)),
    frostedGlass: !!config?.frostedGlass,
    weatherEffectsEnabled: !!config?.frostedGlass && !!config?.ui?.weatherEffectsEnabled,
    weatherOverride: config?.ui?.weatherOverride || 'auto',
    desktopCapabilities: config?.desktopCapabilities,
  };
}

function restorePreviewWindowEffects() {
  if (!previewState) return;

  try {
    cancelPreviewWindowEffects();
    refreshBackgroundTheme();
    applyWindowEffects(previewState);
    if (window?.electronAPI?.previewWindowEffects) {
      window.electronAPI
        .previewWindowEffects({
          opacity: previewState.opacity,
          frostedGlass: previewState.frostedGlass,
        })
        .catch((err) => {
          log.error('Failed to restore preview window effects:', err);
        });
    }

    if (settingsUiHooks?.updateWeatherEffects) {
      settingsUiHooks.updateWeatherEffects(
        previewState.weatherEffectsEnabled,
        previewState.weatherOverride
      );
    }
  } catch (error) {
    log.error('Error restoring preview window effects:', error);
  }
}

/**
 * Re-apply the unsaved Settings previews after a config echo reset the window to the saved
 * appearance (for example when a collapsed section is remembered). No-op while Settings is closed.
 */
function reapplySettingsPreviews() {
  if (!previewState) return;
  setCustomThemes(pendingCustomColors);
  applyUiPreferences(getAppearanceFromInputs());
  // The echo put the saved mode back, while the Mode control still shows the pick. A followed
  // palette decides the mode itself (and was just applied), so it keeps its say.
  if (pendingThemeMode && !isFollowingDesktopPalette()) applyTheme(pendingThemeMode);
  applyAccentTheme(pendingAccent || getCurrentAccentTheme());
  // Also re-applies the pending background.
  previewWindowEffectsNow();
  if (hasDraftColorPreview) applyCustomColorPreview(getCustomColorHexFromEditor());
}

/**
 * Validate the Home Assistant URL with the same rules Test connection, the setup wizard and the
 * connection itself use, so an address one of them accepts is not refused by another. A bare
 * "homeassistant.local:8123" or "HTTP://ha.local" is fine, and a pasted dashboard address
 * ("https://ha.example.com/lovelace/0") is reduced to the server, since the socket path is built
 * from what is saved and Home Assistant is not served from a sub-path.
 * @param {string} url - The URL to validate
 * @returns {object} - { valid: boolean, error: string|null, url: string }
 */
function validateHomeAssistantUrl(url) {
  const trimmedUrl = typeof url === 'string' ? url.trim() : '';
  if (!trimmedUrl) {
    return { valid: false, error: t('Home Assistant URL cannot be empty'), url: null };
  }
  const normalizedUrl = normalizeBaseUrl(trimmedUrl);
  if (normalizedUrl) return { valid: true, error: null, url: normalizedUrl };

  if (/^https?:\/*$/i.test(trimmedUrl)) {
    return { valid: false, error: t('Invalid URL: missing hostname'), url: null };
  }
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(trimmedUrl) && !/^https?:\/\//i.test(trimmedUrl)) {
    return { valid: false, error: t('URL must start with http:// or https://'), url: null };
  }
  return { valid: false, error: t('Invalid URL format'), url: null };
}

function getDefaultProfileSyncConfig() {
  return {
    enabled: false,
    provider: 'cloudFile',
    cloudFilePath: '',
    syncScope: {
      preset: 'all',
      sections: {
        quickAccessLayout: true,
        visualPersonalization: true,
        automationAlerts: true,
        connectionMediaPreferences: true,
      },
    },
    intervalMinutes: 5,
    encryptionEnabled: false,
    rememberPassphrase: false,
    passphraseEncrypted: false,
    lastSyncAt: null,
    lastSyncStatus: 'idle',
    lastSyncError: '',
  };
}

function normalizeProfileSyncScopePreset(value) {
  if (typeof value !== 'string') return 'all';
  const normalized = value.trim().toLowerCase();
  if (normalized === 'quickaccess') return 'quick_access';
  if (!PROFILE_SYNC_SCOPE_PRESETS.has(normalized)) return 'all';
  return normalized;
}

function resolveProfileSyncScopeSections(preset, sectionsInput = {}) {
  if (preset === 'all') {
    return {
      quickAccessLayout: true,
      visualPersonalization: true,
      automationAlerts: true,
      connectionMediaPreferences: true,
    };
  }

  if (preset === 'visual') {
    return {
      quickAccessLayout: false,
      visualPersonalization: true,
      automationAlerts: false,
      connectionMediaPreferences: false,
    };
  }

  if (preset === 'quick_access') {
    return {
      quickAccessLayout: true,
      visualPersonalization: false,
      automationAlerts: false,
      connectionMediaPreferences: false,
    };
  }

  return {
    quickAccessLayout: !!sectionsInput.quickAccessLayout,
    visualPersonalization: !!sectionsInput.visualPersonalization,
    automationAlerts: !!sectionsInput.automationAlerts,
    connectionMediaPreferences: !!sectionsInput.connectionMediaPreferences,
  };
}

function normalizeProfileSyncScope(input) {
  const defaultScope = getDefaultProfileSyncConfig().syncScope;
  if (!input || typeof input !== 'object') return defaultScope;
  const preset = normalizeProfileSyncScopePreset(input.preset);
  const sections = resolveProfileSyncScopeSections(
    preset,
    input.sections && typeof input.sections === 'object' ? input.sections : {}
  );
  return { preset, sections };
}

function trimTrailingPathSeparators(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  if (/^\/+$/.test(raw)) return '/';
  if (/^\\+$/.test(raw)) return '\\';
  const windowsRootMatch = raw.match(/^([A-Za-z]:)[\\/]+$/);
  if (windowsRootMatch) {
    const separator = raw.includes('\\') ? '\\' : '/';
    return `${windowsRootMatch[1]}${separator}`;
  }
  return raw.replace(/[\\/]+$/, '');
}

function deriveProfileSyncFolderPath(filePath) {
  if (!filePath || typeof filePath !== 'string') return '';
  const trimmed = filePath.trim();
  if (!trimmed) return '';
  const normalized = trimTrailingPathSeparators(trimmed);
  if (!normalized) return '';
  const separatorIndex = Math.max(normalized.lastIndexOf('/'), normalized.lastIndexOf('\\'));
  if (separatorIndex < 0) return normalized;
  if (separatorIndex === 0) return normalized.charAt(0);
  if (separatorIndex === 2 && /^[A-Za-z]:[\\/]/.test(normalized)) return normalized.slice(0, 3);
  return normalized.slice(0, separatorIndex);
}

function buildProfileSyncFilePathFromFolder(folderPath) {
  const normalizedFolder = trimTrailingPathSeparators(folderPath);
  if (!normalizedFolder) return '';
  const separator = /[\\/]$/.test(normalizedFolder)
    ? ''
    : normalizedFolder.includes('\\')
      ? '\\'
      : '/';
  return `${normalizedFolder}${separator}${PROFILE_SYNC_DEFAULT_FILE_NAME}`;
}

function ensureProfileSyncConfig(targetConfig = state.CONFIG) {
  targetConfig.profileSync = {
    ...getDefaultProfileSyncConfig(),
    ...(targetConfig.profileSync || {}),
  };
  targetConfig.profileSync.syncScope = normalizeProfileSyncScope(
    targetConfig.profileSync.syncScope
  );
  return targetConfig.profileSync;
}

function formatProfileSyncTimestamp(isoString) {
  if (!isoString) return t('never');
  const value = Date.parse(isoString);
  if (Number.isNaN(value)) return t('never');
  return formatClockDateTime(value);
}

const PROFILE_SYNC_SECTION_LABEL_KEYS = {
  quickAccessLayout: 'Quick Access and layout',
  visualPersonalization: 'Appearance',
  automationAlerts: 'Alerts',
  connectionMediaPreferences: 'Weather and media',
};

function formatProfileSyncSectionList(sectionKeys = []) {
  const labels = sectionKeys
    .map((key) =>
      PROFILE_SYNC_SECTION_LABEL_KEYS[key] ? t(PROFILE_SYNC_SECTION_LABEL_KEYS[key]) : ''
    )
    .filter(Boolean);
  return formatList(labels);
}

/**
 * The status line: what sync is doing, when it last worked, and who last changed
 * the file, in sentences rather than raw state codes.
 */
function describeProfileSyncStatus(status = {}) {
  if (status.inFlight) return t('Sync in progress...');
  const lastSuccess = formatProfileSyncTimestamp(status.lastSuccessfulSyncAt);
  if (status.needsResolution) return t('Waiting for your choice below.');
  const parts = [];
  if (status.lastSyncStatus === 'error') {
    parts.push(t('The last sync failed. Last successful sync: {{time}}.', { time: lastSuccess }));
  } else if (status.lastSuccessfulSyncAt) {
    parts.push(t('Up to date. Last synced {{time}}.', { time: lastSuccess }));
  } else {
    parts.push(t('Not synced yet.'));
  }
  if (status.lastRemoteUpdatedAt && status.lastSyncStatus !== 'error') {
    const time = formatProfileSyncTimestamp(status.lastRemoteUpdatedAt);
    parts.push(
      status.lastRemoteUpdatedByThisDevice
        ? t('This computer last changed the sync file {{time}}.', { time })
        : t('Another computer last changed the sync file {{time}}.', { time })
    );
  }
  const summary = status.lastRunSummary;
  const replaced = [
    ...new Set([...(summary?.replacedLocal || []), ...(summary?.replacedRemote || [])]),
  ];
  if (replaced.length > 0 && status.lastSyncStatus !== 'error') {
    parts.push(
      t(
        'Both computers changed {{sections}}, so the newer change was kept and the other was backed up.',
        { sections: formatProfileSyncSectionList(replaced) }
      )
    );
  }
  return parts.join(' ');
}

/**
 * Error text stays at two lines until asked for, so a long one cannot push the rows below it
 * down by a paragraph. The element is never hidden: it is a live region, and one that appears
 * with its text in it may not be announced.
 */
function setProfileSyncErrorExpanded(expanded) {
  document.getElementById('profile-sync-error')?.classList.toggle('is-clamped', !expanded);
  document
    .getElementById('profile-sync-error-toggle')
    ?.setAttribute('aria-expanded', String(expanded));
  updateProfileSyncErrorToggle();
}

/** Offers "Details" only when the clamped text does not fit; an open message keeps its way back. */
function updateProfileSyncErrorToggle() {
  const errorEl = document.getElementById('profile-sync-error');
  const toggle = document.getElementById('profile-sync-error-toggle');
  if (!errorEl || !toggle) return;
  const expanded = toggle.getAttribute('aria-expanded') === 'true';
  toggle.classList.toggle('hidden', !expanded && errorEl.scrollHeight <= errorEl.clientHeight + 1);
}

function setProfileSyncSettingsVisibility() {
  const enabledCheckbox = document.getElementById('profile-sync-enabled');
  const settingsContainer = document.getElementById('profile-sync-settings');
  if (!enabledCheckbox || !settingsContainer) return;
  settingsContainer.classList.toggle('hidden', !enabledCheckbox.checked);
}

function updateProfileSyncStatusUi(status, { syncFormState = false } = {}) {
  if (!status || typeof status !== 'object') return;
  profileSyncStatusCache = status;
  // Main can publish sync status while a reloaded renderer is still fetching config.
  // Keep the status, but wait for configuration before rendering its controls.
  if (!state.CONFIG) return;

  const statusEl = document.getElementById('profile-sync-status');
  const errorEl = document.getElementById('profile-sync-error');
  const resolutionEl = document.getElementById('profile-sync-resolution');
  const enabledCheckbox = document.getElementById('profile-sync-enabled');
  const settingsContainer = document.getElementById('profile-sync-settings');
  const passphraseHint = document.getElementById('profile-sync-passphrase-group');
  const folderInput = document.getElementById('profile-sync-folder-path');

  if (syncFormState && enabledCheckbox) {
    enabledCheckbox.checked = !!status.enabled;
  }
  if (syncFormState && settingsContainer) {
    settingsContainer.classList.toggle('hidden', !status.enabled);
  }

  if (statusEl) {
    statusEl.textContent = describeProfileSyncStatus(status);
    // The spinner sits in the line's own text, so a run starting moves nothing.
    statusEl.dataset.busy = status.inFlight ? 'true' : 'false';
  }

  if (errorEl) {
    const warning = status.passphraseWarning || '';
    const errorText = status.lastSyncError || '';
    const rewriteWarning = status.remoteRewritePending
      ? t('The remote profile still needs its encryption update. Use Sync up to retry.')
      : '';
    const pendingEncryptionWarning =
      typeof status.encryptionChangePending === 'boolean'
        ? status.encryptionChangePending
          ? t(
              'Encryption is not on yet. Enter a passphrase of at least 8 characters and save to finish, or press Cancel change. Sync is paused until then.'
            )
          : t(
              'Encryption is not off yet. Enter the current passphrase and save to finish, or press Cancel change. Sync is paused until then.'
            )
        : '';
    const recoveryWarning = status.rewriteRecoveryInvalid
      ? t(
          'The protected sync-key recovery record is invalid. Sync is paused to prevent an unsafe overwrite; restore a known-good config backup before retrying.'
        )
      : status.rewriteRecoveryRequired
        ? t(
            'A protected sync-key recovery is pending. Use Sync up to resume it; sync remains paused if the remote changed.'
          )
        : '';
    const messages = [
      warning,
      errorText,
      rewriteWarning,
      pendingEncryptionWarning,
      recoveryWarning,
    ].filter(Boolean);
    // A message already open stays open when the same text arrives again.
    const sameMessages = errorEl.textContent === messages.join('');
    // One line per message: run together they read as a single garbled sentence.
    errorEl.replaceChildren(
      ...messages.flatMap((message, index) =>
        index === 0 ? [message] : [document.createElement('br'), message]
      )
    );
    if (!sameMessages) setProfileSyncErrorExpanded(false);
    updateProfileSyncErrorToggle();
  }

  if (resolutionEl) {
    resolutionEl.classList.toggle('hidden', !status.needsResolution);
    const resolutionHelp = resolutionEl.querySelector('#profile-sync-resolution-text');
    const uploadButton = resolutionEl.querySelector('#profile-sync-resolve-upload');
    const remoteButton = resolutionEl.querySelector('#profile-sync-resolve-remote');
    if (status.resolutionRetryRequired) {
      if (resolutionHelp) {
        resolutionHelp.textContent = t(
          'The first-time conflict check did not complete. Retry it before syncing.'
        );
      }
      if (uploadButton) uploadButton.textContent = t('Retry Conflict Check');
      if (remoteButton) remoteButton.classList.add('hidden');
    } else if (status.damagedConflictSections?.length) {
      // The file's copy is unreadable, so only this computer's can be kept.
      if (resolutionHelp) {
        resolutionHelp.textContent = t(
          "The sync file's {{sections}} settings are damaged. Keep this computer's settings to repair them; the damaged copy is backed up first.",
          { sections: formatProfileSyncSectionList(status.damagedConflictSections) }
        );
      }
      if (uploadButton) uploadButton.textContent = t('This computer (upload)');
      if (remoteButton) remoteButton.classList.add('hidden');
    } else {
      if (resolutionHelp) {
        const sections = formatProfileSyncSectionList(status.conflictSections);
        resolutionHelp.textContent = sections
          ? t(
              "This computer and the sync file have different settings for {{sections}}. Keep this computer's settings and upload them, or replace them with the sync file's. Either way, the replaced settings are backed up.",
              { sections }
            )
          : t(
              "This computer and the sync file have different settings. Keep this computer's settings and upload them, or replace them with the sync file's. Either way, the replaced settings are backed up."
            );
      }
      if (uploadButton) uploadButton.textContent = t('This computer (upload)');
      if (remoteButton) remoteButton.classList.remove('hidden');
    }
  }

  renderProfileSyncFolderWarnings(status);

  // The status line says a sync is running; a second press would only be turned away.
  ['profile-sync-now', 'profile-sync-push-now', 'profile-sync-pull-now'].forEach((id) => {
    const button = document.getElementById(id);
    if (button) button.disabled = !!status.inFlight;
  });

  const clearPassphraseButton = document.getElementById('profile-sync-clear-passphrase');
  if (clearPassphraseButton) {
    clearPassphraseButton.classList.toggle('hidden', !status.passphraseStored);
  }

  if (passphraseHint) {
    const profileSync = ensureProfileSyncConfig();
    passphraseHint.classList.toggle(
      'hidden',
      !status.enabled ||
        (!profileSync.encryptionEnabled && typeof status.encryptionChangePending !== 'boolean')
    );
  }

  if (
    folderInput &&
    !folderInput.value.trim() &&
    typeof status.cloudFilePath === 'string' &&
    status.cloudFilePath.trim()
  ) {
    const derivedFolder = deriveProfileSyncFolderPath(status.cloudFilePath);
    setProfileSyncFolderField(derivedFolder || status.cloudFilePath);
  }

  updateProfileSyncPassphraseFields();
}

/**
 * Which sync states need a person, not just a status line: a choice to make, a failed
 * run, or a paused encryption change. Used to say so outside Settings.
 */
function profileSyncNeedsAttention(status) {
  return (
    !!status?.enabled &&
    (!!status.needsResolution ||
      status.lastSyncStatus === 'error' ||
      typeof status.encryptionChangePending === 'boolean' ||
      !!status.rewriteRecoveryRequired)
  );
}

/**
 * Keeps the passphrase fields in step with the encryption switch and the sync state: the
 * hint for a passphrase already saved, the second field that catches a typo while one is
 * being chosen, and the way out of a change that is waiting.
 */
function updateProfileSyncPassphraseFields() {
  const status = profileSyncStatusCache || {};
  const encryption = document.getElementById('profile-sync-encryption-enabled');
  const confirmGroup = document.getElementById('profile-sync-passphrase-confirm-group');
  const passphraseInput = document.getElementById('profile-sync-passphrase');
  const cancelChange = document.getElementById('profile-sync-cancel-encryption-change');

  // A typo is locked in wherever a passphrase is chosen: a new key for the file, or one in
  // use replaced, which re-encrypts it. One in use may be saved, or held only for this
  // session; main rekeys the file either way. Joining a file that is already encrypted needs
  // no second field, because a wrong passphrase is refused on the spot. The renderer cannot
  // tell a retyped passphrase from a new one, so any text typed over one in use asks twice.
  const passphraseInUse = !!status.passphraseStored || !!status.passphraseActive;
  const choosingPassphrase = passphraseInUse
    ? !!passphraseInput?.value.trim()
    : status.remoteEncrypted !== true;
  if (confirmGroup) {
    confirmGroup.classList.toggle('hidden', !encryption?.checked || !choosingPassphrase);
  }
  if (passphraseInput) {
    passphraseInput.placeholder = status.passphraseStored
      ? t('Saved on this device. Type a new one to change it.')
      : t('Enter passphrase (min 8 chars)');
  }
  if (cancelChange) {
    cancelChange.classList.toggle('hidden', typeof status.encryptionChangePending !== 'boolean');
  }
}

function setProfileSyncPassphraseRevealed(revealed) {
  const reveal = document.getElementById('profile-sync-passphrase-reveal');
  ['profile-sync-passphrase', 'profile-sync-passphrase-confirm'].forEach((id) => {
    const input = document.getElementById(id);
    if (input) input.type = revealed ? 'text' : 'password';
  });
  // The label stays put: aria-pressed already tells a screen reader which way it is set.
  if (reveal) reveal.setAttribute('aria-pressed', String(revealed));
}

/**
 * Renders the warning codes main sends alongside the sync status. These cover
 * setups that report a healthy sync while sharing nothing, so they are shown even
 * when lastSyncStatus is 'success'.
 */
function renderProfileSyncFolderWarnings(status) {
  const hintEl = document.getElementById('profile-sync-provider-hint');
  if (!hintEl) return;

  const warnings = Array.isArray(status.folderWarnings) ? status.folderWarnings : [];
  const messages = warnings
    .map((code) => {
      if (code === 'unsynced_folder') {
        return t(
          'This folder is on this device only, so nothing is shared. Choose a folder your cloud or sync client keeps in sync.'
        );
      }
      if (code === 'google_drive_linux') {
        return t(
          'Google Drive has no official Linux client. Use a third-party client such as Insync or rclone, or switch to Syncthing.'
        );
      }
      if (code === 'conflict_copies') {
        const count = Array.isArray(status.conflictCopies) ? status.conflictCopies.length : 0;
        return t(
          'Found {{count}} conflict copy file(s) next to the sync file, which means two devices saved at once. Check the folder and delete the copies you do not need.',
          { count }
        );
      }
      return '';
    })
    .filter(Boolean);

  hintEl.textContent = messages.join(' ');
  hintEl.classList.toggle('hidden', messages.length === 0);
}

async function refreshProfileSyncStatusUi(options = {}) {
  if (!window.electronAPI?.getProfileSyncStatus) return;
  try {
    const status = await window.electronAPI.getProfileSyncStatus();
    updateProfileSyncStatusUi(status, options);
  } catch (error) {
    log.error('Failed to refresh profile sync status:', error);
  }
}

function setProfileSyncScopeAdvancedVisibility() {
  const presetSelect = document.getElementById('profile-sync-scope-preset');
  const advanced = document.getElementById('profile-sync-scope-advanced');
  if (!presetSelect || !advanced) return;
  const preset = normalizeProfileSyncScopePreset(presetSelect.value);
  advanced.classList.toggle('hidden', preset !== 'custom');
}

function applyProfileSyncScopeToForm(syncScopeInput) {
  const scope = normalizeProfileSyncScope(syncScopeInput);
  const presetSelect = document.getElementById('profile-sync-scope-preset');
  if (presetSelect) {
    presetSelect.value = scope.preset;
    if (presetSelect.value !== scope.preset) {
      presetSelect.value = 'all';
    }
  }

  PROFILE_SYNC_SCOPE_SECTION_KEYS.forEach((sectionKey) => {
    const inputId = PROFILE_SYNC_SCOPE_SECTION_INPUT_IDS[sectionKey];
    const checkbox = document.getElementById(inputId);
    if (!checkbox) return;
    checkbox.checked = !!scope.sections[sectionKey];
  });

  setProfileSyncScopeAdvancedVisibility();
}

function readProfileSyncScopeFromForm() {
  const presetSelect = document.getElementById('profile-sync-scope-preset');
  const preset = normalizeProfileSyncScopePreset(presetSelect?.value || 'all');
  const sections = {};
  PROFILE_SYNC_SCOPE_SECTION_KEYS.forEach((sectionKey) => {
    const inputId = PROFILE_SYNC_SCOPE_SECTION_INPUT_IDS[sectionKey];
    const checkbox = document.getElementById(inputId);
    sections[sectionKey] = !!checkbox?.checked;
  });
  return normalizeProfileSyncScope({ preset, sections });
}

/** Sets the folder field. It is cut to its width, so the whole path is its tooltip. */
function setProfileSyncFolderField(folder) {
  const input = document.getElementById('profile-sync-folder-path');
  if (!input) return;
  input.value = folder;
  input.title = folder;
  // A folder was chosen, so "choose a sync folder" no longer applies.
  if (folder) clearFieldError(input);
}

/**
 * The encryption choice the form shows for the saved settings. A change that is waiting is
 * drawn as it was asked for, so saving carries it on: drawn as the old value, following the
 * on-screen advice would take the save for a cancel.
 */
function getSavedProfileSyncEncryptionChoice(profileSync) {
  return typeof profileSync.encryptionChangePending === 'boolean'
    ? profileSync.encryptionChangePending
    : !!profileSync.encryptionEnabled;
}

function applyProfileSyncConfigToForm() {
  const profileSync = ensureProfileSyncConfig();
  const enabled = document.getElementById('profile-sync-enabled');
  const provider = document.getElementById('profile-sync-provider');
  const folderPath = document.getElementById('profile-sync-folder-path');
  const interval = document.getElementById('profile-sync-interval');
  const encryption = document.getElementById('profile-sync-encryption-enabled');
  const remember = document.getElementById('profile-sync-remember-passphrase');
  const passphraseGroup = document.getElementById('profile-sync-passphrase-group');
  const passphraseInput = document.getElementById('profile-sync-passphrase');

  if (enabled) enabled.checked = !!profileSync.enabled;
  if (provider) {
    const providerValue = profileSync.provider || 'cloudFile';
    provider.value = providerValue;
    if (provider.value !== providerValue) {
      provider.value = 'cloudFile';
    }
  }
  if (folderPath) {
    const derivedFolder = deriveProfileSyncFolderPath(profileSync.cloudFilePath || '');
    setProfileSyncFolderField(derivedFolder || profileSync.cloudFilePath || '');
  }
  if (interval) interval.value = String(profileSync.intervalMinutes || 5);
  if (encryption) encryption.checked = getSavedProfileSyncEncryptionChoice(profileSync);
  if (remember) remember.checked = !!profileSync.rememberPassphrase;
  applyProfileSyncScopeToForm(profileSync.syncScope);
  if (passphraseGroup)
    passphraseGroup.classList.toggle(
      'hidden',
      !profileSync.enabled ||
        (!profileSync.encryptionEnabled && typeof profileSync.encryptionChangePending !== 'boolean')
    );
  if (passphraseInput) passphraseInput.value = '';
  const passphraseConfirm = document.getElementById('profile-sync-passphrase-confirm');
  if (passphraseConfirm) passphraseConfirm.value = '';
  setProfileSyncPassphraseRevealed(false);

  setProfileSyncSettingsVisibility();
  updateProfileSyncPassphraseFields();
}

const PROFILE_SYNC_REPLACE_CONFIRMATIONS = {
  push: {
    title: 'Sync up',
    message:
      "Replace the sync file with this computer's settings? Your other computers receive them on their next sync. The file's current settings are backed up on this computer.",
  },
  pull: {
    title: 'Sync down',
    message:
      "Replace this computer's settings with the sync file's? This computer's current settings are backed up first.",
  },
};

function applyConfigFromProfileSync(nextConfig) {
  state.setConfig(nextConfig);
  applyProfileSyncConfigToForm();
  applyTheme(state.CONFIG.ui?.theme || 'auto');
  applyAccentTheme(state.CONFIG.ui?.accent || 'original');
  applyBackgroundTheme(state.CONFIG.ui?.background || 'original');
  applyUiPreferences(state.CONFIG.ui || {});
  applyDesktopAppearance(state.CONFIG);
  applyWindowEffects(state.CONFIG || {});
}

/**
 * Takes in a config that changed outside the form (a sync pull, a restored backup, an
 * import) while Settings is open. The form, the pending colours and the window-effect
 * preview all describe the old config, so Cancel would put the old look back and Save
 * would write the stale values over the new ones. Reopening rebuilds them from the new
 * config, at the cost of any edits not yet saved, which the return value reports.
 *
 * @returns {Promise<boolean>} whether unsaved edits were discarded
 */
async function reopenSettingsWithConfig(nextConfig) {
  const discardedEdits = settingsTouchedKeys.size > 0;
  const hooks = settingsUiHooks;
  // Closing restores the window effects Settings opened with; after this change those are
  // the new ones, which the main process has already applied natively.
  if (previewState) previewState = savedWindowEffects(nextConfig);
  closeSettings();
  applyConfigFromProfileSync(nextConfig);
  hooks?.renderActiveTab?.();
  await openSettings(hooks);
  return discardedEdits;
}

/** Says why a manual sync cannot run right now, or returns null when it can. */
function getProfileSyncBlockedMessage() {
  const status = profileSyncStatusCache || {};
  const saved = ensureProfileSyncConfig();
  const formScope = readProfileSyncScopeFromForm();
  const formFolder = (document.getElementById('profile-sync-folder-path')?.value || '').trim();
  const formEncryption = document.getElementById('profile-sync-encryption-enabled');
  const formDiffersFromSaved =
    !!document.getElementById('profile-sync-enabled')?.checked !== !!saved.enabled ||
    (document.getElementById('profile-sync-provider')?.value || 'cloudFile') !==
      (saved.provider || 'cloudFile') ||
    formFolder !== deriveProfileSyncFolderPath(saved.cloudFilePath || '') ||
    JSON.stringify(formScope) !== JSON.stringify(normalizeProfileSyncScope(saved.syncScope)) ||
    (!!formEncryption && formEncryption.checked !== getSavedProfileSyncEncryptionChoice(saved)) ||
    // The field is empty unless a passphrase was typed, and a typed one is not in use until saved.
    !!document.getElementById('profile-sync-passphrase')?.value.trim();
  // Sync runs against what is saved, so a switch or folder that has not been saved yet would be
  // ignored and the run would only report that sync is off, and an encryption mode or passphrase
  // that has not been saved yet would be ignored too, publishing or reading the file in the old
  // mode while the form shows another.
  if (!saved.enabled || formDiffersFromSaved) {
    return { type: 'warning', text: t('Save your settings first to start syncing.') };
  }
  if (status.needsResolution) {
    return { type: 'warning', text: t('Resolve first-time sync conflict before syncing.') };
  }
  if (typeof status.encryptionChangePending === 'boolean' && !status.rewriteRecoveryRequired) {
    return { type: 'warning', text: t('Finish or cancel the pending encryption change first.') };
  }
  if (status.inFlight) {
    return { type: 'info', text: t('A sync is already running. Try again in a moment.') };
  }
  return null;
}

/** The toast for a run main declined with a reason instead of an error. */
function describeProfileSyncDeclined(result) {
  switch (result?.reason) {
    case 'needs_resolution':
      return { type: 'warning', text: t('Resolve first-time sync conflict before syncing.') };
    case 'disabled':
      return { type: 'warning', text: t('Save your settings first to start syncing.') };
    case 'encryption_change_pending':
    case 'rewrite_pending':
      return { type: 'warning', text: t('Finish or cancel the pending encryption change first.') };
    case 'in_flight':
      return { type: 'info', text: t('A sync is already running. Try again in a moment.') };
    default:
      return { type: 'error', text: result?.error || t('Profile sync failed.') };
  }
}

async function runManualProfileSync(direction) {
  // Answer a run that cannot start before the confirmation, which warns about replacing
  // settings that nothing is going to replace.
  const blocked = getProfileSyncBlockedMessage();
  if (blocked) {
    showToast(blocked.text, blocked.type, 3500);
    return;
  }
  const confirmation = PROFILE_SYNC_REPLACE_CONFIRMATIONS[direction];
  if (confirmation) {
    const confirmed = await showConfirm(t(confirmation.title), t(confirmation.message), {
      confirmText: t(confirmation.title),
      confirmClass: 'btn-primary',
    });
    if (!confirmed) return;
  }
  try {
    const result = await window.electronAPI.runProfileSync(direction);
    if (!result?.ok) {
      const declined = describeProfileSyncDeclined(result);
      showToast(declined.text, declined.type, 3500);
      if (result?.status) updateProfileSyncStatusUi(result.status);
      return;
    }

    const discardedEdits = result?.config ? await reopenSettingsWithConfig(result.config) : false;

    if (result?.status) {
      updateProfileSyncStatusUi(result.status);
    } else {
      await refreshProfileSyncStatusUi();
    }
    void refreshProfileSyncBackups();
    if (discardedEdits) {
      showToast(
        t('Synced settings were applied. Unsaved changes in this window were discarded.'),
        'warning',
        4000
      );
      return;
    }
    if (direction === 'pull' && result.action === 'none') {
      // Nothing came down: either there is no file yet, or this computer already has it all.
      showToast(
        result.status?.lastRemoteUpdatedAt
          ? t('This computer already matches the sync file.')
          : t('No sync file found yet.'),
        'info',
        2600
      );
      return;
    }
    const completeMessage = {
      push: 'Profile sync upload complete.',
      pull: 'Profile sync download complete.',
    }[direction];
    showToast(t(completeMessage || 'Profile sync complete.'), 'success', 2200);
  } catch (error) {
    log.error('Manual profile sync failed:', error);
    showToast(error?.message || t('Profile sync failed.'), 'error', 3500);
    await refreshProfileSyncStatusUi();
  }
}

async function resolveProfileSyncFirstEnable(choice) {
  try {
    const result = await window.electronAPI.resolveProfileSyncFirstEnable(choice);
    if (!result?.success) {
      showToast(result?.error || t('Failed to resolve sync conflict.'), 'error', 3500);
      if (result?.status) updateProfileSyncStatusUi(result.status);
      return;
    }
    // Using the file's settings replaces this computer's, which the open form still shows.
    let discardedEdits = false;
    if (result?.config) {
      if (choice === 'use_remote') {
        discardedEdits = await reopenSettingsWithConfig(result.config);
      } else {
        state.setConfig(result.config);
        applyProfileSyncConfigToForm();
      }
    }
    if (result?.status) updateProfileSyncStatusUi(result.status);
    const outcomeMessage = {
      cancel: () => t('Profile sync turned off. No settings were changed.'),
      upload_local: () => t("This computer's settings were uploaded to the sync file."),
      use_remote: () => t('Settings downloaded from the sync file.'),
    }[choice];
    if (discardedEdits) {
      showToast(
        t('Synced settings were applied. Unsaved changes in this window were discarded.'),
        'warning',
        4000
      );
      return;
    }
    showToast(outcomeMessage(), 'success', 2500);
  } catch (error) {
    log.error('Failed to resolve profile sync conflict:', error);
    showToast(error?.message || t('Failed to resolve sync conflict.'), 'error', 3500);
  }
}

function getSelectedDonationAmount(modal) {
  const customInput = modal.querySelector('#donate-custom-amount');
  if (customInput && (customInput.value !== '' || customInput.validity.badInput)) {
    const amount = customInput.valueAsNumber;
    const valid =
      customInput.validity.valid &&
      Number.isInteger(amount) &&
      amount >= 1 &&
      amount <= GITHUB_SPONSORS_MAX_AMOUNT;
    return valid ? { valid: true, amount } : { valid: false, amount: null };
  }
  const selectedChip = modal.querySelector('.donate-amount-chip.selected');
  const chipAmount = Number(selectedChip?.dataset.amount);
  if (Number.isFinite(chipAmount) && chipAmount >= 1) {
    return { valid: true, amount: chipAmount };
  }
  return { valid: false, amount: null };
}

function buildDonationUrl(modal) {
  const frequency =
    modal.querySelector('input[name="donate-frequency"]:checked')?.value === 'recurring'
      ? 'recurring'
      : 'one-time';
  const url = new URL(`${GITHUB_SPONSORS_URL}/sponsorships`);
  url.searchParams.set('frequency', frequency);
  const { amount } = getSelectedDonationAmount(modal);
  if (amount) url.searchParams.set('amount', String(amount));
  return url.toString();
}

function bindSupportDevelopmentUi() {
  const modal = document.getElementById('donate-modal');
  const openBtn = document.getElementById('open-donate-modal-btn');
  if (!modal || !openBtn) return;

  const closeDonateModal = () => closeDialog(modal);

  const continueBtn = modal.querySelector('#donate-continue-btn');
  openBtn.onclick = () => {
    resetDonation();
    openDialog(modal, {
      describedBy: 'donate-intro',
      dismiss: closeDonateModal,
      // Enter in the amount field goes on, as it does in the confirmation dialog.
      onEnter: (event) => {
        if (event.target === customInput) continueBtn?.click();
      },
    });
  };

  const customInput = modal.querySelector('#donate-custom-amount');
  const chips = [...modal.querySelectorAll('.donate-amount-chip')];
  const amountError = modal.querySelector('#donate-amount-error');
  // The error stays under the field until the amount changes, and the field says so: a toast gone in
  // a few seconds is not tied to the field and covered the paragraph below it.
  const setAmountError = (message) => {
    if (!customInput || !amountError) return;
    amountError.textContent = message;
    amountError.hidden = !message;
    if (message) {
      customInput.setAttribute('aria-invalid', 'true');
      customInput.setAttribute('aria-describedby', amountError.id);
    } else {
      customInput.removeAttribute('aria-invalid');
      customInput.removeAttribute('aria-describedby');
    }
  };
  const setChipSelected = (chip, selected) => {
    chip.classList.toggle('selected', selected);
    chip.setAttribute('aria-pressed', String(selected));
  };
  // Each visit starts at a one-time $5: the dialog is kept between visits, so without this a
  // cancelled or failed attempt reopened on Monthly with a rejected amount and no chip chosen.
  function resetDonation() {
    const oneTime = modal.querySelector('input[name="donate-frequency"][value="one-time"]');
    if (oneTime) oneTime.checked = true;
    if (customInput) customInput.value = '';
    chips.forEach((chip) => setChipSelected(chip, chip.dataset.amount === '5'));
    setAmountError('');
  }
  chips.forEach((chip) => {
    chip.onclick = () => {
      chips.forEach((other) => setChipSelected(other, other === chip));
      if (customInput) customInput.value = '';
      setAmountError('');
    };
  });
  if (customInput) {
    customInput.oninput = () => {
      setAmountError('');
      if (customInput.value !== '' || customInput.validity.badInput) {
        chips.forEach((chip) => setChipSelected(chip, false));
      }
    };
  }

  const closeBtn = modal.querySelector('#close-donate-modal');
  if (closeBtn) closeBtn.onclick = () => closeDonateModal();
  const cancelBtn = modal.querySelector('#donate-cancel-btn');
  if (cancelBtn) cancelBtn.onclick = () => closeDonateModal();

  if (continueBtn) {
    continueBtn.onclick = async () => {
      if (!getSelectedDonationAmount(modal).valid) {
        setAmountError(t('Please enter a whole dollar amount between $1 and $12,000.'));
        customInput?.focus();
        customInput?.select();
        return;
      }
      try {
        const result = await window.electronAPI.openExternal(buildDonationUrl(modal));
        if (result?.success === false) {
          throw new Error(result.error || 'Failed to open GitHub Sponsors link');
        }
        await closeDonateModal();
        // Whether anything was donated is for the sponsors page to say, so this only says what
        // happened here: it reads as neither a payment nor a thank-you for one.
        showToast(t('Opened GitHub Sponsors in your browser.'), 'info', 3000);
      } catch (error) {
        log.error('Failed to open GitHub Sponsors link:', error);
        showToast(t('Could not open GitHub Sponsors. Please try again.'), 'error', 3500);
      }
    };
  }
}

let profileSyncBackupsCache = [];

function describeProfileSyncBackup(backup) {
  const time = formatProfileSyncTimestamp(backup.createdAt);
  if (backup.kind === 'remote') return t('{{time}} · Sync file, before an upload', { time });
  if (backup.reason === 'import') {
    return t('{{time}} · This computer, before an import', { time });
  }
  if (backup.reason === 'restore') {
    return t('{{time}} · This computer, before a restore', { time });
  }
  return t('{{time}} · This computer, before a sync', { time });
}

/** The line under the list: what the selected backup holds, which the cut-off names cannot say. */
function updateProfileSyncBackupDetail() {
  const select = document.getElementById('profile-sync-backup-select');
  const detail = document.getElementById('profile-sync-backup-detail');
  if (!select || !detail) return;
  const backup = profileSyncBackupsCache.find((entry) => entry.id === select.value);
  detail.textContent = backup
    ? t('Contains: {{sections}}', { sections: formatProfileSyncSectionList(backup.sections) })
    : '';
  detail.classList.toggle('hidden', !backup);
}

function renderProfileSyncBackups() {
  const select = document.getElementById('profile-sync-backup-select');
  const restore = document.getElementById('profile-sync-restore-backup');
  if (!select) return;
  const previous = select.value;
  if (profileSyncBackupsCache.length === 0) {
    const empty = document.createElement('option');
    empty.value = '';
    empty.textContent = t('No backups yet');
    select.replaceChildren(empty);
    select.disabled = true;
    if (restore) restore.disabled = true;
    updateProfileSyncBackupDetail();
    return;
  }
  select.replaceChildren(
    ...profileSyncBackupsCache.map((backup) => {
      const option = document.createElement('option');
      option.value = backup.id;
      option.textContent = describeProfileSyncBackup(backup);
      option.title = t('Contains: {{sections}}', {
        sections: formatProfileSyncSectionList(backup.sections),
      });
      return option;
    })
  );
  if (profileSyncBackupsCache.some((backup) => backup.id === previous)) select.value = previous;
  select.disabled = false;
  if (restore) restore.disabled = false;
  updateProfileSyncBackupDetail();
}

async function refreshProfileSyncBackups() {
  if (!window.electronAPI?.listProfileSyncBackups) return;
  try {
    const result = await window.electronAPI.listProfileSyncBackups();
    profileSyncBackupsCache = Array.isArray(result?.backups) ? result.backups : [];
  } catch (error) {
    log.error('Failed to list profile sync backups:', error);
    profileSyncBackupsCache = [];
  }
  renderProfileSyncBackups();
}

// A restore only reaches other computers through sync, and only for the sections in its scope.
function describeProfileSyncRestore() {
  const profileSync = state.CONFIG?.profileSync;
  if (!profileSync?.enabled)
    return t('Apply this backup on this computer? Your current settings are backed up first.');
  const { sections } = normalizeProfileSyncScope(profileSync.syncScope);
  if (!PROFILE_SYNC_SCOPE_SECTION_KEYS.every((key) => sections[key]))
    return t(
      'Apply this backup on this computer? Your current settings are backed up first, and restored settings in your sync scope then sync to your other computers.'
    );
  return t(
    'Apply this backup on this computer? Your current settings are backed up first, and the restored ones then sync to your other computers.'
  );
}

async function restoreSelectedProfileSyncBackup() {
  const select = document.getElementById('profile-sync-backup-select');
  const id = select?.value;
  if (!id) return;
  const backup = profileSyncBackupsCache.find((entry) => entry.id === id);
  // Named by its time, so the confirmation says which of the near-identical entries it replaces.
  const confirmed = await showConfirm(
    backup
      ? t('Restore the backup from {{time}}', {
          time: formatProfileSyncTimestamp(backup.createdAt),
        })
      : t('Restore'),
    describeProfileSyncRestore(),
    {
      confirmText: t('Restore'),
      confirmClass: 'btn-primary',
    }
  );
  if (!confirmed) return;
  try {
    const result = await window.electronAPI.restoreProfileSyncBackup(id);
    if (!result?.success) {
      showToast(result?.error || t('Failed to restore the backup.'), 'error', 3500);
      return;
    }
    const discardedEdits = result.config ? await reopenSettingsWithConfig(result.config) : false;
    showToast(
      discardedEdits
        ? t('Synced settings were applied. Unsaved changes in this window were discarded.')
        : t('Backup restored.'),
      discardedEdits ? 'warning' : 'success',
      discardedEdits ? 4000 : 2200
    );
  } catch (error) {
    log.error('Failed to restore profile sync backup:', error);
    showToast(t('Failed to restore the backup.'), 'error', 3500);
  }
  await refreshProfileSyncBackups();
}

/**
 * Gives up on an encryption change that is waiting, by asking main for the mode already in
 * force. An explicit button rather than a side effect of saving: the form draws the waiting
 * change as asked for, so a save carries it on.
 */
async function cancelPendingEncryptionChange() {
  const committed = !!ensureProfileSyncConfig().encryptionEnabled;
  try {
    const result = await window.electronAPI.setProfileSyncPassphrase('', false, committed);
    if (!result?.success) {
      if (result?.status) updateProfileSyncStatusUi(result.status);
      showToast(result?.error || t('Failed to save sync passphrase.'), 'error', 3400);
      return;
    }
    if (result.config) applyPersistedConfigResponse(result.config);
    applyProfileSyncConfigToForm();
    if (result.status) updateProfileSyncStatusUi(result.status);
    showToast(t('Encryption change canceled.'), 'info', 2400);
  } catch (error) {
    log.error('Failed to cancel the pending encryption change:', error);
    showToast(error?.message || t('Failed to save sync passphrase.'), 'error', 3400);
  }
}

function bindProfileSyncSettingsUi() {
  const enabled = document.getElementById('profile-sync-enabled');
  if (enabled) {
    enabled.onchange = () => {
      setProfileSyncSettingsVisibility();
      const passphraseGroup = document.getElementById('profile-sync-passphrase-group');
      const encryptionEnabled = document.getElementById('profile-sync-encryption-enabled');
      if (passphraseGroup && encryptionEnabled) {
        const needsCurrentKeyToDisable =
          enabled.checked &&
          !encryptionEnabled.checked &&
          !!state.CONFIG?.profileSync?.encryptionEnabled;
        passphraseGroup.classList.toggle(
          'hidden',
          !enabled.checked || (!encryptionEnabled.checked && !needsCurrentKeyToDisable)
        );
      }
      updateProfileSyncPassphraseFields();
    };
  }

  const scopePreset = document.getElementById('profile-sync-scope-preset');
  if (scopePreset) {
    scopePreset.onchange = () => {
      const preset = normalizeProfileSyncScopePreset(scopePreset.value);
      if (preset !== 'custom') {
        applyProfileSyncScopeToForm({ preset });
      } else {
        setProfileSyncScopeAdvancedVisibility();
      }
    };
  }

  PROFILE_SYNC_SCOPE_SECTION_KEYS.forEach((sectionKey) => {
    const checkbox = document.getElementById(PROFILE_SYNC_SCOPE_SECTION_INPUT_IDS[sectionKey]);
    if (!checkbox) return;
    checkbox.onchange = () => {
      const presetSelect = document.getElementById('profile-sync-scope-preset');
      if (presetSelect) {
        presetSelect.value = 'custom';
      }
      setProfileSyncScopeAdvancedVisibility();
    };
  });

  const chooseProfileSyncFolder = async () => {
    try {
      const provider = document.getElementById('profile-sync-provider');
      const selectedProvider = provider?.value || 'cloudFile';
      // Starting where the form already points keeps the dialog next to what is being replaced.
      const currentFolder = document.getElementById('profile-sync-folder-path')?.value || '';
      const response = await window.electronAPI.chooseProfileSyncFolder(
        selectedProvider,
        currentFolder
      );
      if (response?.canceled) return;
      const folderPath =
        response?.folderPath || deriveProfileSyncFolderPath(response?.filePath || '');
      if (!folderPath) return;
      setProfileSyncFolderField(folderPath);
    } catch (error) {
      log.error('Failed to choose profile sync folder:', error);
      showToast(t('Failed to choose sync folder.'), 'error', 3000);
    }
  };

  const chooseFolderBtn = document.getElementById('profile-sync-choose-folder');
  if (chooseFolderBtn) {
    chooseFolderBtn.onclick = () => chooseProfileSyncFolder();
  }
  // The field looks like one you can type in, but it only shows the folder: using it opens
  // the chooser, as the button does.
  const folderField = document.getElementById('profile-sync-folder-path');
  if (folderField) {
    folderField.onclick = () => chooseProfileSyncFolder();
    folderField.onkeydown = (event) => {
      if (event.key === 'Enter') {
        event.preventDefault();
        chooseProfileSyncFolder();
      }
    };
  }

  const profileSyncHelpBtn = document.getElementById('profile-sync-help-btn');
  if (profileSyncHelpBtn) {
    profileSyncHelpBtn.onclick = async () => {
      try {
        const result = await window.electronAPI.openExternal(PROFILE_SYNC_HELP_URL);
        if (result?.success === false) {
          throw new Error(result.error || 'Failed to open help link');
        }
      } catch (error) {
        log.error('Failed to open profile sync help link:', error);
        showToast(t('Could not open help instructions.'), 'error', 3000);
      }
    };
  }

  const encryption = document.getElementById('profile-sync-encryption-enabled');
  if (encryption) {
    encryption.onchange = () => {
      const enabledCheckbox = document.getElementById('profile-sync-enabled');
      const passphraseGroup = document.getElementById('profile-sync-passphrase-group');
      if (passphraseGroup) {
        const needsCurrentKeyToDisable =
          !!enabledCheckbox?.checked &&
          !encryption.checked &&
          !!state.CONFIG?.profileSync?.encryptionEnabled;
        passphraseGroup.classList.toggle(
          'hidden',
          !enabledCheckbox?.checked || (!encryption.checked && !needsCurrentKeyToDisable)
        );
      }
      updateProfileSyncPassphraseFields();
    };
  }

  // Typing over a saved passphrase starts a change of key, which asks for it twice.
  const passphraseField = document.getElementById('profile-sync-passphrase');
  if (passphraseField) passphraseField.oninput = () => updateProfileSyncPassphraseFields();

  const revealPassphrase = document.getElementById('profile-sync-passphrase-reveal');
  if (revealPassphrase) {
    revealPassphrase.onclick = () =>
      setProfileSyncPassphraseRevealed(revealPassphrase.getAttribute('aria-pressed') !== 'true');
  }

  const errorToggle = document.getElementById('profile-sync-error-toggle');
  if (errorToggle) {
    errorToggle.onclick = () =>
      setProfileSyncErrorExpanded(errorToggle.getAttribute('aria-expanded') !== 'true');
  }
  // The text is measured while it is on screen; the page it sits on may be shown later.
  const errorEl = document.getElementById('profile-sync-error');
  if (!profileSyncErrorObserver && errorEl && typeof ResizeObserver === 'function') {
    profileSyncErrorObserver = new ResizeObserver(() => updateProfileSyncErrorToggle());
    profileSyncErrorObserver.observe(errorEl);
  }

  const cancelEncryptionChange = document.getElementById('profile-sync-cancel-encryption-change');
  if (cancelEncryptionChange) {
    cancelEncryptionChange.onclick = () => cancelPendingEncryptionChange();
  }

  const syncNow = document.getElementById('profile-sync-now');
  if (syncNow) syncNow.onclick = () => runManualProfileSync('auto');

  const restoreBackup = document.getElementById('profile-sync-restore-backup');
  if (restoreBackup) restoreBackup.onclick = () => restoreSelectedProfileSyncBackup();

  const backupSelect = document.getElementById('profile-sync-backup-select');
  if (backupSelect) backupSelect.onchange = () => updateProfileSyncBackupDetail();

  const pullNow = document.getElementById('profile-sync-pull-now');
  if (pullNow) pullNow.onclick = () => runManualProfileSync('pull');

  const pushNow = document.getElementById('profile-sync-push-now');
  if (pushNow) pushNow.onclick = () => runManualProfileSync('push');

  const clearPassphrase = document.getElementById('profile-sync-clear-passphrase');
  if (clearPassphrase) {
    clearPassphrase.onclick = async () => {
      const confirmed = await showConfirm(
        t('Clear Saved Passphrase'),
        t(
          'Remove the saved sync passphrase from this device? Syncing stays paused until you enter it again.'
        ),
        { confirmText: t('Action: Clear'), confirmClass: 'btn-danger' }
      );
      if (!confirmed) return;
      try {
        await window.electronAPI.clearProfileSyncPassphrase();
      } catch (error) {
        log.error('Failed to clear saved profile sync passphrase:', error);
        showToast(
          t('Failed to clear saved passphrase: {{error}}', {
            error: error?.message || t('Unknown error'),
          }),
          'error',
          3400
        );
        return;
      }

      const passphraseInput = document.getElementById('profile-sync-passphrase');
      const remember = document.getElementById('profile-sync-remember-passphrase');
      if (passphraseInput) passphraseInput.value = '';
      if (remember) remember.checked = false;
      await refreshProfileSyncStatusUi();
      showToast(t('Saved passphrase cleared.'), 'success', 2000);
    };
  }

  const resolveUpload = document.getElementById('profile-sync-resolve-upload');
  if (resolveUpload) resolveUpload.onclick = () => resolveProfileSyncFirstEnable('upload_local');

  const resolveRemote = document.getElementById('profile-sync-resolve-remote');
  if (resolveRemote) resolveRemote.onclick = () => resolveProfileSyncFirstEnable('use_remote');

  const resolveCancel = document.getElementById('profile-sync-resolve-cancel');
  if (resolveCancel) resolveCancel.onclick = () => resolveProfileSyncFirstEnable('cancel');
}

function compareLocalePackVersions(a = '', b = '') {
  const toParts = (value) =>
    String(value || '')
      .split('.')
      .map((part) => Number.parseInt(part, 10))
      .map((part) => (Number.isNaN(part) ? 0 : part));
  const aParts = toParts(a);
  const bParts = toParts(b);
  const length = Math.max(aParts.length, bParts.length);
  for (let index = 0; index < length; index += 1) {
    const diff = (aParts[index] || 0) - (bParts[index] || 0);
    if (diff !== 0) return diff;
  }
  return 0;
}

function getLanguagePackDisplayName(pack = {}) {
  return (
    pack.displayName || getLanguageDisplayName(pack.locale, pack.englishName || pack.locale || '')
  );
}

// The pack for the system's language when Auto is showing English for want of it.
function findSystemLanguagePackToDownload() {
  const { usingEnglishFallback, detectedLocale } = getLocaleState();
  if (!usingEnglishFallback) return null;
  const language = String(detectedLocale || '')
    .split('-')[0]
    .toLowerCase();
  return (
    localePackListCache.find(
      (pack) => !pack.installed && String(pack.locale || '').toLowerCase() === language
    ) || null
  );
}

// The card says only what the select does not: how to get more languages while some are still to
// download, which language Auto means, and when English is standing in for a pack not installed yet.
function updateLanguageSummaryText() {
  const downloadHint = document.getElementById('language-select-help');
  const systemSummary = document.getElementById('language-system-summary');
  const fallbackSummary = document.getElementById('language-fallback-summary');
  const languageSelect = document.getElementById('language-select');
  const localeState = getLocaleState();
  const selectedLocale = languageSelect?.value || state.CONFIG?.ui?.language || 'auto';
  const detectedLabel = getLanguageDisplayName(
    localeState.detectedLocale,
    localeState.detectedLocale || 'en'
  );

  // Nothing to say about downloading once every pack is installed, or while there are none to offer.
  const hasPackToDownload = localePackListCache.some((pack) => !pack.installed);
  downloadHint?.classList.toggle('hidden', !hasPackToDownload);
  // The select is described by it only while it is shown: a hidden line is still read out.
  setDescribedByLine(languageSelect, downloadHint, hasPackToDownload);
  if (systemSummary) {
    // Only Auto follows the system, so only Auto needs to say what it found.
    systemSummary.classList.toggle('hidden', selectedLocale !== 'auto');
    systemSummary.textContent = t('System language detected: {{language}}', {
      language: detectedLabel,
    });
  }
  if (fallbackSummary) {
    // Auto stands in English for a system language whose pack is still to download; the line under
    // "System language detected" says so, or the two lines would contradict each other.
    const systemPack = selectedLocale === 'auto' ? findSystemLanguagePackToDownload() : null;
    const needsPack =
      !!systemPack ||
      (!BUILTIN_LANGUAGE_OPTIONS.has(selectedLocale) && localeState.activeLocale === 'en');
    fallbackSummary.classList.toggle('hidden', !needsPack);
    // Named in the interface's language, as the "System language detected" line above it is.
    fallbackSummary.textContent = systemPack
      ? t('Using English until the {{language}} language pack is downloaded.', {
          language: getLanguageDisplayName(systemPack.locale, systemPack.englishName),
        })
      : t('Using English until the selected language pack is installed.');
  }
}

function syncLanguageSelectOptions() {
  const languageSelect = document.getElementById('language-select');
  if (!languageSelect) return;
  const selectedValue = languageSelect.value || state.CONFIG?.ui?.language || 'auto';
  const builtinValues = BUILTIN_LANGUAGE_OPTIONS;

  Array.from(languageSelect.querySelectorAll('option'))
    .filter((option) => !builtinValues.has(option.value))
    .forEach((option) => option.remove());

  localePackListCache.forEach((pack) => {
    if (!pack?.locale || builtinValues.has(pack.locale)) return;
    const option = document.createElement('option');
    option.value = pack.locale;
    option.textContent = getLanguagePackDisplayName(pack);
    option.lang = pack.locale;
    if (!pack.installed) {
      option.disabled = true;
      option.textContent += ` (${t('Not downloaded')})`;
    }
    languageSelect.appendChild(option);
  });

  if (
    selectedValue &&
    !Array.from(languageSelect.options).some((option) => option.value === selectedValue)
  ) {
    const fallbackOption = document.createElement('option');
    fallbackOption.value = selectedValue;
    fallbackOption.disabled = !builtinValues.has(selectedValue);
    fallbackOption.textContent = `${getLanguageDisplayName(selectedValue, selectedValue)}${fallbackOption.disabled ? ` (${t('Not downloaded')})` : ''}`;
    languageSelect.appendChild(fallbackOption);
  }

  if (Array.from(languageSelect.options).some((option) => option.value === selectedValue)) {
    languageSelect.value = selectedValue;
  }
}

function renderLanguagePackList() {
  const container = document.getElementById('language-packs-list');
  const statusEl = document.getElementById('language-pack-status');
  if (!container) return;

  container.innerHTML = '';
  if (statusEl) {
    statusEl.classList.toggle('hidden', !localePackListError);
    statusEl.textContent = localePackListError;
  }

  if (!localePackListCache.length) {
    // The status line already shows the load error; don't repeat it in the list.
    if (localePackListError && statusEl) return;
    const empty = document.createElement('div');
    empty.className = 'help-text';
    empty.textContent =
      localePackListError || t('No downloadable language packs are currently available.');
    container.appendChild(empty);
    return;
  }

  localePackListCache.forEach((pack) => {
    const row = document.createElement('div');
    row.className = 'language-pack-row';
    const language = getLanguagePackDisplayName(pack);

    const info = document.createElement('div');
    info.className = 'language-pack-info';

    const name = document.createElement('div');
    name.className = 'language-pack-name';
    name.textContent = language;
    // The name is in its own language ("العربية", "हिन्दी"): marked as such, a screen reader reads it
    // in that voice and the browser picks that script's font, not the interface's.
    name.lang = pack.locale;

    const meta = document.createElement('div');
    meta.className = 'language-pack-meta';
    // The same words as the selector's suffix: a language is either downloaded or it is not.
    const stateLabel = pack.installed ? t('Installed') : t('Not downloaded');
    const versionLabel = pack.version ? `v${pack.version}` : '';
    const downloadedLabel = pack.downloadedAt ? ` • ${formatClockDateTime(pack.downloadedAt)}` : '';
    meta.textContent = `${stateLabel}${versionLabel ? ` • ${versionLabel}` : ''}${downloadedLabel}`;

    info.appendChild(name);
    info.appendChild(meta);

    const actions = document.createElement('div');
    actions.className = 'language-pack-actions';

    const versionAhead =
      !!pack.updateAvailable ||
      (pack.latestVersion && compareLocalePackVersions(pack.latestVersion, pack.version) > 0);
    if (pack.installed && versionAhead) {
      const updateBtn = document.createElement('button');
      updateBtn.type = 'button';
      updateBtn.className = 'btn btn-secondary btn-sm';
      updateBtn.dataset.localeAction = 'download';
      updateBtn.dataset.locale = pack.locale;
      updateBtn.textContent = t('Update');
      updateBtn.setAttribute('aria-label', t('Update {{language}}', { language }));
      actions.appendChild(updateBtn);
    } else if (!pack.installed) {
      const downloadBtn = document.createElement('button');
      downloadBtn.type = 'button';
      downloadBtn.className = 'btn btn-secondary btn-sm';
      downloadBtn.dataset.localeAction = 'download';
      downloadBtn.dataset.locale = pack.locale;
      downloadBtn.textContent = t('Download');
      downloadBtn.setAttribute('aria-label', t('Download {{language}}', { language }));
      actions.appendChild(downloadBtn);
    }

    if (pack.installed) {
      const removeBtn = document.createElement('button');
      removeBtn.type = 'button';
      removeBtn.className = 'btn btn-secondary btn-sm';
      removeBtn.dataset.localeAction = 'remove';
      removeBtn.dataset.locale = pack.locale;
      removeBtn.textContent = t('Remove');
      removeBtn.setAttribute('aria-label', t('Remove {{language}}', { language }));
      actions.appendChild(removeBtn);
    }

    row.appendChild(info);
    row.appendChild(actions);
    container.appendChild(row);
  });
}

async function refreshLanguagePackList(forceRefresh = false) {
  const generation = ++languagePackRefreshGeneration;
  try {
    localePackListError = '';
    if (!window?.electronAPI?.getLocalePacks) {
      localePackListCache = [];
    } else {
      const result = await window.electronAPI.getLocalePacks(forceRefresh);
      if (generation !== languagePackRefreshGeneration) return;
      if (Array.isArray(result)) {
        localePackListCache = result;
      } else {
        localePackListCache = Array.isArray(result?.installedPacks) ? result.installedPacks : [];
        localePackListError = t('Unable to load language packs right now.');
      }
    }
  } catch (error) {
    if (generation !== languagePackRefreshGeneration) return;
    log.error('Failed to load locale packs:', error);
    localePackListCache = Array.isArray(error?.installedPacks) ? error.installedPacks : [];
    localePackListError = t('Unable to load language packs right now.');
  }
  syncLanguageSelectOptions();
  renderLanguagePackList();
  updateLanguageSummaryText();
}

function refreshLanguagePackListInBackground(forceRefresh = false) {
  languagePackRefreshPromise = refreshLanguagePackList(forceRefresh).catch((error) => {
    log.error('Unexpected language pack refresh failure:', error);
  });
  return languagePackRefreshPromise;
}

function waitForLanguagePackRefresh() {
  return languagePackRefreshPromise;
}

async function persistLanguageSelection(nextLanguage) {
  const normalizedLanguage = String(nextLanguage || '').trim() || 'auto';
  if (!window?.electronAPI?.updateConfig) {
    throw new Error('Language updates are unavailable on this build.');
  }

  state.CONFIG.ui = state.CONFIG.ui || {};
  const nextUiConfig = {
    ...state.CONFIG.ui,
    language: normalizedLanguage,
  };

  const updatedConfig = await window.electronAPI.updateConfig({
    ui: nextUiConfig,
  });

  if (updatedConfig) {
    applyPersistedConfigResponse(updatedConfig);
  } else {
    state.CONFIG.ui = nextUiConfig;
  }

  return updatedConfig;
}

/**
 * Read the text size, contrast, density and tile glow controls on top of `ui`.
 *
 * These preview live like the window effects and persist only on Save. The readable preset
 * stands for both contrast flags, so they are left alone unless the preset was toggled.
 */
function getAppearanceFromInputs(ui = state.CONFIG?.ui || {}) {
  const scale = document.getElementById('ui-scale-select');
  const preset = document.getElementById('readable-preset');
  const density = document.getElementById('density-select');
  const activeTileGlow = document.getElementById('active-tile-glow');
  const next = { ...ui };
  if (scale) next.scale = Number(scale.value) || 1;
  if (preset && preset.checked !== (!!ui.highContrast && !!ui.opaquePanels)) {
    next.highContrast = preset.checked;
    next.opaquePanels = preset.checked;
  }
  if (density) next.density = density.value === 'compact' ? 'compact' : 'comfortable';
  if (activeTileGlow) next.activeTileGlow = !!activeTileGlow.checked;
  const seasonal = readSeasonalInputs(ui.seasonal);
  if (seasonal) next.seasonal = seasonal;
  return next;
}

// Set once the user flips the seasonal switch, so an untouched switch keeps following reduced
// motion and high contrast instead of being saved as a fixed choice.
let seasonalEnabledTouched = false;

/**
 * Read the Seasonal Themes controls on top of the saved `ui.seasonal`.
 * @returns {object|null} The next `ui.seasonal`, or null when the controls are missing.
 */
function readSeasonalInputs(saved) {
  const enabled = document.getElementById('seasonal-enabled');
  if (!enabled) return null;
  const previous = normalizeSeasonalSettings(saved);
  const next = { colors: previous.colors, holidays: {}, show: previous.show };
  if (seasonalEnabledTouched || typeof previous.enabled === 'boolean') {
    next.enabled = !!enabled.checked;
  }
  const colors = document.getElementById('seasonal-colors');
  if (colors) next.colors = !!colors.checked;
  const show = document.getElementById('seasonal-show');
  if (show) next.show = show.value || 'auto';
  // A picked holiday is a preview that lasts a day from when it was picked; keeping the same pick
  // keeps its end time.
  if (next.show !== 'auto') {
    next.showUntil =
      next.show === previous.show ? previous.showUntil : Date.now() + SHOW_DURATION_MS;
  }
  document.querySelectorAll('#seasonal-settings input[data-holiday]').forEach((input) => {
    if (!input.checked) next.holidays[input.dataset.holiday] = false;
  });
  const normalized = normalizeSeasonalSettings(next);
  if (normalized.enabled === null) delete normalized.enabled;
  return normalized;
}

function formatSeasonalDate(date) {
  return formatDate(date, { month: 'short', day: 'numeric' });
}

// "Dec 1 – 26" rather than "Dec 1 – Dec 26", in the order the language writes ranges. A range over
// New Year stays "Dec 27 – Jan 2": the date formatter would add both years to it, which no other
// holiday row has.
function formatSeasonalRange(range) {
  try {
    const formatter = new Intl.DateTimeFormat(getFormatLocale(), {
      month: 'short',
      day: 'numeric',
    });
    if (
      typeof formatter.formatRange === 'function' &&
      range.start.getFullYear() === range.end.getFullYear()
    ) {
      return formatter.formatRange(range.start, range.end);
    }
  } catch {
    // Fall through to two separate dates.
  }
  return `${formatSeasonalDate(range.start)} – ${formatSeasonalDate(range.end)}`;
}

/**
 * Bring the seasonal switch, its sub-options and the status line in line with a `ui` preview.
 * @param {object} ui
 */
function syncSeasonalControls(ui) {
  const enabledInput = document.getElementById('seasonal-enabled');
  if (!enabledInput) return;
  const settings = normalizeSeasonalSettings(ui.seasonal);
  const enabled = isSeasonalEnabled(settings, {
    reducedMotion: prefersReducedMotion(),
    highContrast: !!ui.highContrast,
  });
  if (!seasonalEnabledTouched && settings.enabled === null) enabledInput.checked = enabled;
  document
    .querySelectorAll('#seasonal-settings .seasonal-option')
    .forEach((element) => element.classList.toggle('is-disabled', !enabled));
  document
    .querySelectorAll(
      '#seasonal-settings .seasonal-option input, #seasonal-settings .seasonal-option select'
    )
    .forEach((control) => {
      control.disabled = !enabled;
    });

  const now = new Date();
  document.querySelectorAll('#seasonal-settings [data-holiday-dates]').forEach((element) => {
    const range = getUpcomingHolidayRange(element.dataset.holidayDates, now);
    element.textContent = range ? formatSeasonalRange(range) : '';
  });

  const status = document.getElementById('seasonal-status');
  if (!status) return;
  let message = '';
  if (enabled && settings.show !== 'auto') {
    message = t('Showing {{holiday}} until {{time}}.', {
      holiday: t(getHolidayById(settings.show).name),
      time: formatClockDateTime(new Date(settings.showUntil), {
        weekday: 'short',
        ...getClockFaceTimeOptions(),
      }),
    });
  } else if (enabled) {
    const enabledIds = getEnabledHolidayIds(settings);
    const active = findActiveHoliday(now, enabledIds);
    const next = active ? null : findNextHoliday(now, enabledIds);
    if (active) {
      message = t('{{holiday}} is on until {{date}}.', {
        holiday: t(active.holiday.name),
        date: formatSeasonalDate(active.end),
      });
    } else if (next) {
      message = t('Nothing right now. {{holiday}} starts {{date}}.', {
        holiday: t(next.holiday.name),
        date: formatSeasonalDate(next.start),
      });
    } else {
      message = t('No holidays are picked.');
    }
  }
  // A live region: rewriting the same words would make some screen readers announce them again
  // for every unrelated appearance change.
  if (status.textContent !== message) status.textContent = message;
  status.classList.toggle('hidden', !message);
}

/**
 * Dim the rows the Readable preset replaces (the colours, the glass, the window opacity and the
 * holiday colours) while it is on. They stay editable, since they take effect again once it is off.
 * @param {object} ui - The appearance settings being shown.
 */
function syncReadablePresetOverrides(ui) {
  // The switch reads as on only when both flags are, so the dimming follows the same rule; a
  // config with just one of them does not claim that the preset replaced anything.
  const overridden = !!ui.highContrast && !!ui.opaquePanels;
  document.querySelectorAll('[data-readable-overrides]').forEach((element) => {
    element.classList.toggle('is-overridden', overridden);
  });
}

function previewAppearance() {
  const ui = getAppearanceFromInputs();
  syncSeasonalControls(ui);
  syncReadablePresetOverrides(ui);
  applyUiPreferences(ui);
}

function bindSeasonalSettingsUi(ui) {
  const settings = normalizeSeasonalSettings(ui.seasonal);
  seasonalEnabledTouched = false;
  const enabled = document.getElementById('seasonal-enabled');
  const colors = document.getElementById('seasonal-colors');
  const show = document.getElementById('seasonal-show');
  if (!enabled) return;
  enabled.checked = isSeasonalEnabled(settings, {
    reducedMotion: prefersReducedMotion(),
    highContrast: !!ui.highContrast,
  });
  // Touching a seasonal control shows the holiday's colours again after a colour pick hid them.
  const previewSeasonal = () => {
    suspendSeasonalColors(false);
    previewAppearance();
  };
  enabled.onchange = () => {
    seasonalEnabledTouched = true;
    previewSeasonal();
  };
  if (colors) {
    colors.checked = settings.colors;
    colors.onchange = previewSeasonal;
  }
  if (show) {
    show.value = settings.show;
    show.onchange = previewSeasonal;
  }
  document.querySelectorAll('#seasonal-settings input[data-holiday]').forEach((input) => {
    input.checked = settings.holidays[input.dataset.holiday] !== false;
    input.onchange = previewSeasonal;
  });
  syncSeasonalControls(ui);
}

function bindAppearanceSettingsUi() {
  const ui = state.CONFIG?.ui || {};
  const scale = document.getElementById('ui-scale-select');
  const preset = document.getElementById('readable-preset');
  const activeTileGlow = document.getElementById('active-tile-glow');
  const densitySelect = document.getElementById('density-select');
  if (scale) scale.value = String(ui.scale || 1);
  if (preset) preset.checked = !!ui.highContrast && !!ui.opaquePanels;
  if (activeTileGlow) activeTileGlow.checked = ui.activeTileGlow !== false;
  if (densitySelect) densitySelect.value = ui.density === 'compact' ? 'compact' : 'comfortable';
  for (const control of [scale, preset, activeTileGlow, densitySelect].filter(Boolean)) {
    control.onchange = previewAppearance;
  }
  syncReadablePresetOverrides(ui);
  bindSeasonalSettingsUi(ui);
}

function bindLanguageSettingsUi() {
  const languageSelect = document.getElementById('language-select');
  if (languageSelect) {
    languageSelect.value = state.CONFIG?.ui?.language || 'auto';
    // Saves run one at a time instead of disabling the select, which would drop keyboard focus
    // while someone arrows through the languages. A choice already replaced by a newer one is
    // skipped.
    languageSelect.onchange = () => {
      updateLanguageSummaryText();
      languageSaveQueue = languageSaveQueue.then(async () => {
        const previousLanguage = state.CONFIG?.ui?.language || 'auto';
        const nextLanguage = languageSelect.value || previousLanguage;
        if (nextLanguage === previousLanguage) return;
        try {
          await persistLanguageSelection(nextLanguage);
        } catch (error) {
          log.error('Failed to update language selection:', error);
          if (languageSelect.value === nextLanguage) {
            languageSelect.value = previousLanguage;
            updateLanguageSummaryText();
          }
          showToast(t('Failed to save language selection'), 'error', 2600);
        }
      });
      return languageSaveQueue;
    };
  }

  const languagePackList = document.getElementById('language-packs-list');
  if (languagePackList) {
    languagePackList.onclick = async (event) => {
      const button = event.target.closest('[data-locale-action]');
      if (!button) return;
      const locale = button.dataset.locale;
      const action = button.dataset.localeAction;
      if (!locale || !action) return;

      const hadFocus = button === document.activeElement;
      button.disabled = true;
      try {
        if (action === 'download') {
          const result = await window.electronAPI.downloadLocalePack(locale);
          localePackListCache = Array.isArray(result?.packs) ? result.packs : localePackListCache;
          await refreshLocaleIfAffected(locale);
          showToast(
            t('Language pack downloaded: {{language}}', {
              language: getLanguageDisplayName(locale, locale),
            }),
            'success',
            2200
          );
        } else if (action === 'remove') {
          await window.electronAPI.removeLocalePack(locale);
          await refreshLocaleIfAffected(locale);
          showToast(
            t('Language pack removed: {{language}}', {
              language: getLanguageDisplayName(locale, locale),
            }),
            'success',
            2200
          );
        }
      } catch (error) {
        log.error(`Failed locale pack action: ${action}`, error);
        showToast(
          action === 'remove'
            ? t('Failed to remove language pack')
            : t('Failed to download language pack'),
          'error',
          2600
        );
      } finally {
        await refreshLanguagePackList(true);
        if (hadFocus) focusLanguagePackRow(locale);
      }
    };
  }
}

/**
 * Switch the interface language right away when a download or removal changes the pack in use,
 * rather than on the next launch. A removed active language falls back to English with the
 * same "Using English" notice as at startup; the selection stays for a later re-download.
 */
async function refreshLocaleIfAffected(locale) {
  const baseLocale = (locale || '').split('-')[0].toLowerCase();
  const { activeLocale, requestedLocale } = getLocaleState();
  const inUse = [activeLocale, requestedLocale].some(
    (value) => (value || '').split('-')[0].toLowerCase() === baseLocale
  );
  if (!inUse || !settingsUiHooks?.refreshLocale) return;
  try {
    await settingsUiHooks.refreshLocale();
    relocalizeOpenSettings();
  } catch (error) {
    log.error('Failed to refresh the interface language:', error);
  }
}

// The pack list re-renders after every action; keep keyboard focus on the same language's row.
function focusLanguagePackRow(locale) {
  const buttons = Array.from(
    document.querySelectorAll('#language-packs-list button[data-locale]:not(:disabled)')
  );
  // An offline catalog drops a removed pack's row; fall back to the language selector.
  const target =
    buttons.find((button) => button.dataset.locale === locale) ||
    document.getElementById('language-select');
  target?.focus({ preventScroll: true });
}

function isSettingsModalOpen() {
  const modal = document.getElementById('settings-modal');
  return !!modal && !modal.classList.contains('hidden') && modal.style.display !== 'none';
}

function renderUpdateButtonLabels() {
  // The check button's label lives in a span the update UI owns, so it is translated here rather
  // than with data-i18n. The install button's depends on the update (Install, Download, Download
  // Portable) and is drawn with the status line. One spelling for both: the ui module and this one
  // used different cases, and the label changed case after a language change.
  const checkUpdatesText = document.getElementById('check-updates-text');
  if (checkUpdatesText) checkUpdatesText.textContent = t('Check for updates');
}

function getSettingsLocaleSignature() {
  const { activeLocale, usingEnglishFallback, messages } = getLocaleState();
  return `${activeLocale}|${!!usingEnglishFallback}|${Object.keys(messages || {}).length}`;
}

// A pairing in progress shows its own status line; leave it until the attempt finishes.
function updateHomeAssistantAuthStatusText() {
  const connectButton = document.getElementById('connect-ha-oauth-btn');
  if (connectButton?.getAttribute('aria-busy') === 'true') return;
  updateHomeAssistantAuthUi();
}

let settingsLocaleSignature = '';
let settingsLocaleObserver = null;

/**
 * Re-render the Settings text that JavaScript writes (status lines, summaries, pickers, labels)
 * after the interface language changes while Settings is open. translateDocument() only covers
 * data-i18n markup. Pending edits, selections and the custom color draft are left untouched.
 */
function relocalizeOpenSettings({ force = false } = {}) {
  if (!isSettingsModalOpen()) return;
  const signature = getSettingsLocaleSignature();
  if (!force && signature === settingsLocaleSignature) return;
  settingsLocaleSignature = signature;
  try {
    updateHomeAssistantAuthStatusText();
    const weatherSelect = document.getElementById('weather-entity-select');
    const pendingWeather = weatherSelect?.value;
    populateWeatherEntitySelect();
    if (
      weatherSelect &&
      Array.from(weatherSelect.options).some((option) => option.value === pendingWeather)
    ) {
      weatherSelect.value = pendingWeather;
    }
    syncLayerModeSwitchReasons();
    syncLanguageSelectOptions();
    renderLanguagePackList();
    updateLanguageSummaryText();
    if (profileSyncStatusCache) updateProfileSyncStatusUi(profileSyncStatusCache);
    renderProfileSyncBackups();
    renderUpdateButtonLabels();
    settingsUiHooks?.relocalizeUpdateStatus?.();
    syncFrostedGlassAvailability();
    syncWeatherEffectsAvailability();
    // The holiday dates and the status line under them are written in the language too.
    syncSeasonalControls(getAppearanceFromInputs());
    if (hasDraftColorPreview || isCustomEditorActive) {
      // Rebuilding the swatches would reset the custom color draft; relabel only.
      updateThemeOptionsLabel();
      updateThemeSummary();
    } else {
      renderColorThemeOptions();
    }
    updatePrimaryCardSummary();
    if (hydratedPersonalizationSections.has('primary-cards-section')) {
      renderPrimaryCardsEntityList();
    }
    if (hydratedPersonalizationSections.has('custom-entity-icons-section')) {
      renderCustomEntityIconsList();
    } else {
      updateCustomEntityIconSummary();
    }
    // Rebuilt rather than relabelled: the player Home Assistant is not reporting right now is an
    // option too, with the entity id in its label. A choice made but not saved yet stays, even
    // when that player has gone since it was chosen.
    populateMediaPlayerSelect(document.getElementById('primary-media-player')?.value);
    if (document.getElementById('entity-alerts-enabled')?.checked) renderAlertsListInline();
    relabelAlertAdvancedOptions();
    relocalizePopupHotkeyText();
    void refreshDesktopIntegration().catch((error) => {
      log.error('Failed to refresh desktop integration text:', error);
    });
  } catch (error) {
    log.error('Failed to relocalize settings:', error);
  }
}

// setLocaleBootstrap() stamps <html lang> on every locale refresh, including the one that
// follows a language change in Settings, so watching it keeps the open dialog in one language.
function observeSettingsLocale() {
  if (settingsLocaleObserver || typeof MutationObserver !== 'function') return;
  settingsLocaleObserver = new MutationObserver(() => relocalizeOpenSettings());
  settingsLocaleObserver.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ['lang', 'dir'],
  });
}

/**
 * Open and initialize the settings modal, populate controls from persisted config, initialize theme and preview state, and trap focus.
 *
 * Populates Home Assistant fields, window and visual-effect controls, start-on-login, hotkeys, alerts, media player selection, and color theme previews; initializes related UI components, renders theme options, and shows the modal.
 *
 * @param {Object} [uiHooks] - Optional UI hook callbacks provided by the renderer.
 * @param {Function} [uiHooks.exitReorganizeMode] - Called to exit any active reorganize mode before opening settings.
 * @param {Function} [uiHooks.showToast] - Called to display transient messages (signature: (message, type, durationMs) => void).
 * @param {Function} [uiHooks.initUpdateUI] - Called after DOM fields are populated so the renderer can perform any additional UI initialization.
 * @param {Function} [uiHooks.relocalizeUpdateStatus] - Called after a language change to re-render the update status line.
 * @param {Function} [uiHooks.renderActiveTab] - Called after save to fully re-render the active UI tab when available.
 * @param {Function} [uiHooks.updateMediaTile] - Fallback hook called after save to refresh media tile state.
 * @param {Function} [uiHooks.renderPrimaryCards] - Fallback hook called after save to refresh primary cards.
 */
// Settings profile sync can change on another computer while this form is open.
const PROFILE_SYNCED_SETTINGS = [
  'alwaysOnTop',
  'hideOnBlur',
  'opacity',
  'frostedGlass',
  'favoriteEntities',
  'trayEntities',
  'customEntityNames',
  'customEntityIcons',
  'tileSpans',
  'quickAccessTileOptions',
  'primaryCards',
  'customTabs',
  'comparisonGraphs',
  'entityAlerts',
  'selectedWeatherEntity',
  'primaryMediaPlayer',
];
// The config the open form was filled from.
let settingsFormBaseConfig = null;
// Synced settings the user has changed since the form opened ('key' or
// 'ui.key'). An explicit choice wins even when it equals the value the form
// opened with. Native controls are tracked through their input and change
// events (SETTINGS_CONTROL_KEYS); button-style pickers mark themselves where
// they change their pending value, so merely opening a picker counts as nothing.
let settingsTouchedKeys = new Set();
const SETTINGS_CONTROL_KEYS = [
  ['#always-on-top', ['alwaysOnTop']],
  ['#hide-on-blur', ['hideOnBlur']],
  ['#opacity-slider', ['opacity']],
  ['#frosted-glass', ['frostedGlass']],
  ['#weather-entity-select', ['selectedWeatherEntity']],
  ['#entity-alerts-enabled', ['entityAlerts']],
  ['#weather-effects-enabled', ['ui.weatherEffectsEnabled']],
  ['#weather-override-select', ['ui.weatherOverride']],
  ['#language-select', ['ui.language']],
  ['#readable-preset', ['ui.highContrast', 'ui.opaquePanels']],
  ['#density-select', ['ui.density']],
  ['#active-tile-glow', ['ui.activeTileGlow']],
  ['#seasonal-settings', ['ui.seasonal']],
  ['#ui-scale-select', ['ui.scale']],
  ['#follow-omarchy', ['ui.followOmarchy']],
  ['#time-format', ['ui.timeFormat', 'ui.use24HourClock']],
  ['#date-format', ['ui.dateFormat']],
];

function markSettingsTouched(...keys) {
  keys.forEach((key) => settingsTouchedKeys.add(key));
}

function trackSettingsControlInteraction(event) {
  const target = event.target;
  if (!target || typeof target.closest !== 'function') return;
  SETTINGS_CONTROL_KEYS.forEach(([selector, keys]) => {
    if (target.closest(selector)) markSettingsTouched(...keys);
  });
}

function cloneConfigValue(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

/**
 * A control the user left alone still holds the value the form opened with.
 * Saving that value would quietly undo a change profile sync brought in from
 * another computer meanwhile, so those settings keep the latest value instead.
 * Settings the user touched keep the form's value, even one equal to the base.
 */
function keepNewerSyncedSettings(nextConfig, formBase, latest, touched = new Set()) {
  if (!formBase || !latest) return nextConfig;
  const same = (a, b) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
  const keepLatest = (target, base, current, key, touchedKey = key) => {
    if (touched.has(touchedKey)) return;
    if (same(target[key], base[key]) && !same(base[key], current[key])) {
      if (current[key] === undefined) delete target[key];
      else target[key] = cloneConfigValue(current[key]);
    }
  };
  PROFILE_SYNCED_SETTINGS.forEach((key) => keepLatest(nextConfig, formBase, latest, key));
  const nextUi = nextConfig.ui || {};
  const baseUi = formBase.ui || {};
  const latestUi = latest.ui || {};
  new Set([...Object.keys(nextUi), ...Object.keys(baseUi), ...Object.keys(latestUi)]).forEach(
    (key) => keepLatest(nextUi, baseUi, latestUi, key, `ui.${key}`)
  );
  nextConfig.ui = nextUi;
  return nextConfig;
}

async function openSettings(uiHooks) {
  try {
    settingsUiHooks = uiHooks || null;
    settingsFormBaseConfig = cloneConfigValue(state.CONFIG || {});
    settingsTouchedKeys = new Set();
    settingsLocaleSignature = getSettingsLocaleSignature();
    observeSettingsLocale();
    hydratedPersonalizationSections.clear();

    // Exit reorganize mode if active to prevent state conflicts
    if (uiHooks && uiHooks.exitReorganizeMode) {
      uiHooks.exitReorganizeMode();
    }

    const modal = document.getElementById('settings-modal');
    if (!modal) return;
    if (!modal.dataset.touchTracking) {
      modal.dataset.touchTracking = 'true';
      ['input', 'change'].forEach((type) =>
        modal.addEventListener(type, trackSettingsControlInteraction, true)
      );
    }

    // An error from an earlier Save would otherwise greet the next visit.
    clearFieldErrors(modal);
    // The markup is static, so its help lines are tied to their controls once.
    if (!modal.dataset.helpLinked) {
      linkSettingsHelpText(modal);
      modal.dataset.helpLinked = 'true';
    }

    // Populate fields
    const haUrl = document.getElementById('ha-url');
    const haToken = document.getElementById('ha-token');
    const alwaysOnTop = document.getElementById('always-on-top');
    const hideOnBlur = document.getElementById('hide-on-blur');
    const opacitySlider = document.getElementById('opacity-slider');
    const frostedGlass = document.getElementById('frosted-glass');
    const enableInteractionDebugLogs = document.getElementById('enable-interaction-debug-logs');
    const allowPrereleaseUpdates = document.getElementById('allow-prerelease-updates');
    if (haUrl) haUrl.value = state.CONFIG.homeAssistant.url || '';
    if (haToken) {
      const tokenValue = state.CONFIG.homeAssistant.token || '';
      // Don't display default token - show empty field instead to prompt user to enter real token.
      // A token that has to be entered again is explained in the status line above the field.
      haToken.value = tokenValue === 'YOUR_LONG_LIVED_ACCESS_TOKEN' ? '' : tokenValue;
    }
    void refreshSecureStorageNotice();
    bindHomeAssistantOAuthUi();
    updateHomeAssistantAuthUi();
    bindConnectionTestUi();
    setSettingsConnectionTestStatus('', '');
    setSettingsConnectionTestBusy(false);
    populateWeatherEntitySelect();
    if (alwaysOnTop) {
      alwaysOnTop.checked =
        !state.CONFIG.desktopCapabilities?.layerMode && state.CONFIG.alwaysOnTop !== false;
      alwaysOnTop.disabled = !!state.CONFIG.desktopCapabilities?.layerMode;
    }
    if (hideOnBlur) {
      hideOnBlur.checked =
        !state.CONFIG.desktopCapabilities?.layerMode && state.CONFIG.hideOnBlur === true;
      hideOnBlur.disabled = !!state.CONFIG.desktopCapabilities?.layerMode;
    }
    syncLayerModeSwitchReasons();
    const followOmarchy = document.getElementById('follow-omarchy');
    if (followOmarchy) {
      followOmarchy.checked = !!state.CONFIG.ui?.followOmarchy;
      followOmarchy.disabled = !state.CONFIG.desktopAppearance;
      // Like the Hyprland panel, the option only appears where Omarchy is detected.
      document
        .getElementById('follow-omarchy-group')
        ?.classList.toggle('hidden', followOmarchy.disabled);
      updateThemeModeControl();
      updateColorsFollowState();
    }
    if (frostedGlass) frostedGlass.checked = !!state.CONFIG.frostedGlass;
    renderFrostedGlassHelp();
    syncFrostedGlassAvailability();
    if (allowPrereleaseUpdates) {
      allowPrereleaseUpdates.checked = state.CONFIG.updates?.allowPrerelease === true;
    }

    // Initialize "Start at login" checkbox
    const startWithWindows = document.getElementById('start-with-windows');
    if (startWithWindows) {
      try {
        const loginSettings = await window.electronAPI.getLoginItemSettings();
        startWithWindows.checked = loginSettings.openAtLogin || false;
        startWithWindows.disabled = loginSettings.supported === false;
      } catch (error) {
        log.error('Failed to get login item settings:', error);
        startWithWindows.checked = false;
      }
      loadedStartAtLogin = startWithWindows.checked;
    }

    bindLanguageSettingsUi();
    bindAppearanceSettingsUi();
    syncLanguageSelectOptions();
    renderLanguagePackList();
    updateLanguageSummaryText();
    // Main keeps the catalogue for five minutes, so opening Settings asks for that copy; forcing a
    // fresh download on every open cost a request each time and showed "Unable to load language
    // packs" when offline. Downloading or removing a pack still asks for a fresh one.
    refreshLanguagePackListInBackground(false);

    applyProfileSyncConfigToForm();
    bindProfileSyncSettingsUi();
    initializeSettingsFiles({
      onImported: async (nextConfig) => {
        await reopenSettingsWithConfig(nextConfig);
      },
      hasUnsavedChanges: () => settingsTouchedKeys.size > 0,
    });
    bindSupportDevelopmentUi();
    await refreshProfileSyncStatusUi({ syncFormState: true });
    void refreshProfileSyncBackups();

    const storedOpacity = Math.max(0.5, Math.min(1, state.CONFIG.opacity || 0.95));
    const sliderScale = opacityToSliderValue(storedOpacity);
    if (opacitySlider) opacitySlider.value = sliderScale;
    updateOpacityReadout();

    const weatherEffectsEnabled = document.getElementById('weather-effects-enabled');
    const weatherOverrideSelect = document.getElementById('weather-override-select');

    // The saved choice, whether or not Frosted glass is on: with it off the switch shows the choice
    // held back, and syncWeatherEffectsAvailability below shows or hides the override beneath it.
    if (weatherEffectsEnabled) {
      weatherEffectsEnabled.checked = !!state.CONFIG.ui?.weatherEffectsEnabled;
    }
    if (weatherOverrideSelect) {
      weatherOverrideSelect.value = state.CONFIG.ui?.weatherOverride || 'auto';
    }

    previewState = savedWindowEffects(state.CONFIG);
    syncWeatherEffectsAvailability();
    hasDraftColorPreview = false;

    state.CONFIG.ui = state.CONFIG.ui || {};
    if (enableInteractionDebugLogs) {
      enableInteractionDebugLogs.checked = !!state.CONFIG.ui.enableInteractionDebugLogs;
    }
    setPendingCustomColorList(state.CONFIG.ui.customColors || []);

    const currentAccent = getCurrentAccentTheme();
    previewAccent = currentAccent;
    pendingAccent = currentAccent;
    selectAccentTheme(currentAccent, { preview: false });
    const currentBackground = getCurrentBackgroundTheme();
    previewBackground = currentBackground;
    pendingBackground = currentBackground;
    selectBackgroundTheme(currentBackground, { preview: false });
    activeColorTarget = COLOR_TARGETS.accent;
    renderColorThemeOptions();
    initColorTargetSelect();
    initThemeModeControl();
    setCustomEditorActive(false);
    initCustomColorEditor();
    initColorThemeSectionToggle();

    const globalHotkeysEnabled = document.getElementById('global-hotkeys-enabled');
    if (globalHotkeysEnabled) {
      globalHotkeysEnabled.checked = !!(
        state.CONFIG.globalHotkeys && state.CONFIG.globalHotkeys.enabled
      );
      const hotkeysSection = document.getElementById('hotkeys-section');
      if (hotkeysSection) {
        hotkeysSection.style.display = globalHotkeysEnabled.checked ? 'block' : 'none';
      }
    }

    // On unless it was turned off: a config from before the switch has no value for it.
    const persistentNotificationToasts = document.getElementById('persistent-notification-toasts');
    if (persistentNotificationToasts) {
      persistentNotificationToasts.checked =
        state.CONFIG.entityAlerts?.persistentNotifications !== false;
    }

    const entityAlertsEnabled = document.getElementById('entity-alerts-enabled');
    if (entityAlertsEnabled) {
      entityAlertsEnabled.checked = !!(
        state.CONFIG.entityAlerts && state.CONFIG.entityAlerts.enabled
      );
      const alertsSection = document.getElementById('alerts-section');
      if (alertsSection) {
        alertsSection.style.display = entityAlertsEnabled.checked ? 'block' : 'none';
      }
      // Render inline alerts list if alerts are enabled
      if (entityAlertsEnabled.checked) {
        renderAlertsListInline();
      }
    }

    renderUpdateButtonLabels();

    // Call UI hooks passed from renderer.js
    if (uiHooks) {
      uiHooks.initUpdateUI();
    }

    // Populate media player dropdown after UI hooks (when states are loaded)
    populateMediaPlayerSelect();
    initPrimaryCardsUI();
    const primarySection = document.getElementById('primary-cards-section');
    const primaryCardsList = document.getElementById('primary-cards-list');
    if (primaryCardsList) primaryCardsList.innerHTML = '';
    const shouldRenderPrimaryCardsList = !primarySection?.classList.contains('collapsed');
    const primarySearch = document.getElementById('primary-cards-search');
    if (primarySearch) primarySearch.value = '';
    const timeFormat = document.getElementById('time-format');
    if (timeFormat) {
      const savedTimeFormat = state.CONFIG?.ui?.timeFormat;
      // Mirrors the main-process migration: only an explicit 24-hour preference maps to a
      // fixed format, everything else follows the locale.
      timeFormat.value = ['system', '12-hour', '24-hour'].includes(savedTimeFormat)
        ? savedTimeFormat
        : state.CONFIG?.ui?.use24HourClock === true
          ? '24-hour'
          : 'system';
    }
    const dateFormat = document.getElementById('date-format');
    if (dateFormat) {
      // "System default" wrote exactly what "Numeric date" does, so it is no longer offered and a
      // setting saved with it reads as Numeric date.
      const savedDateFormat =
        state.CONFIG?.ui?.dateFormat === 'system' ? 'numeric' : state.CONFIG?.ui?.dateFormat;
      dateFormat.value = ['weekday-short', 'long', 'numeric'].includes(savedDateFormat)
        ? savedDateFormat
        : 'weekday-short';
    }
    setPendingPrimaryCards(state.CONFIG?.primaryCards || PRIMARY_CARD_DEFAULTS, {
      renderList: shouldRenderPrimaryCardsList,
    });

    const customIconsSection = document.getElementById('custom-entity-icons-section');
    const customIconsList = document.getElementById('custom-entity-icons-list');
    if (customIconsList) {
      customIconsList.innerHTML = '';
      customIconsList.classList.remove('custom-entity-icons-list-expanded');
    }
    const shouldRenderCustomIconsList = !customIconsSection?.classList.contains('collapsed');
    setPendingCustomEntityIcons(getSavedCustomEntityIcons());
    activeCustomEntityIconPickerEntityId = null;
    customEntityIconPickerQueryByEntityId = {};
    lastCustomEntityIconAction = null;
    customEntityIconPage = 0;
    clearTimeout(customEntityIconSearchTimer);
    initCustomEntityIconsUI();
    const customIconSearch = document.getElementById('custom-entity-icons-search');
    if (customIconSearch) customIconSearch.value = '';
    if (shouldRenderCustomIconsList) {
      // The emoji catalog is a chunk that loads on demand. If it fails to load, the list is drawn
      // without it and Settings still opens: this used to end in the outer catch, which only logged,
      // and the dialog never appeared.
      try {
        await ensureCustomEntityIconChoicesLoaded();
      } catch (error) {
        log.warn('Could not load the emoji catalog for the custom icon list:', error);
      }
      renderCustomEntityIconsList();
      hydratedPersonalizationSections.add('custom-entity-icons-section');
    } else {
      updateCustomEntityIconSummary();
    }

    // Initialize popup hotkey UI
    initializePopupHotkey();

    // Focus starts on the page the user is on, not on the header's Close button, where a stray Enter
    // or Space would discard every unsaved edit. Only Escape and the buttons close Settings: a
    // click that misses a control must not throw away a form this large. The one exception is a
    // token to fix, rejected or no longer readable: the field is open on screen, so the cursor goes
    // there.
    const liveConnection = getLiveConnectionState();
    const tokenRejected =
      state.CONFIG.homeAssistant?.authMethod !== 'oauth' &&
      (liveConnection.status === 'auth-failed' || !!liveConnection.needsToken);
    openDialog(modal, {
      initialFocus: () => {
        const token = document.getElementById('ha-token');
        if (
          tokenRejected &&
          token &&
          !token.disabled &&
          !token.closest('.tab-content:not(.active)')
        ) {
          return token;
        }
        return (
          modal.querySelector('.tab-link.active') || document.getElementById('settings-search')
        );
      },
      dismiss: () => closeSettings(),
      dismissOnBackdrop: false,
    });
    initializeSettingsSearch(modal);
    requestAnimationFrame(() => {
      refreshPersonalizationSectionHeights();
      const tabList = modal.querySelector('.modal-tabs');
      syncSlidingIndicator(tabList, tabList?.querySelector('.tab-link.active') || null);
      syncSegmentedIndicators(modal.querySelector('.tab-content.active'));
      requestAnimationFrame(() => {
        refreshPersonalizationSectionHeights();
      });
    });
  } catch (error) {
    log.error('Error opening settings:', error);
  }
}

/**
 * Close the settings modal and revert any in-progress previews and UI changes.
 *
 * Restores window effect previews and theme previews that were active while the settings modal was open, clears pending preview state, hides the theme tooltip, removes hotkey listeners, and hides/releases the settings modal's focus trap.
 */
function closeSettings() {
  clearTimeout(primaryCardSearchTimer);
  clearTimeout(customEntityIconSearchTimer);
  primaryCardPage = 0;
  customEntityIconPage = 0;
  try {
    // A recording left armed would swallow the next key pressed anywhere in the widget, and register
    // a combination such as Ctrl+K as the global popup hotkey.
    if (isCapturingPopupHotkey) stopCapturingPopupHotkey();
    setCustomEditorActive(false);
    // Holiday colours come back with the saved or restored colours below.
    suspendSeasonalColors(false);
    cancelPreviewWindowEffects();
    if (previewState) {
      restorePreviewWindowEffects();
      applyUiPreferences(state.CONFIG?.ui || {});
      previewState = null;
    }
    if (hasDraftColorPreview) {
      if (previewAccent) applyAccentTheme(previewAccent);
      if (previewBackground) applyBackgroundTheme(previewBackground);
    }
    if (previewAccent && pendingAccent && previewAccent !== pendingAccent) {
      applyAccentTheme(previewAccent);
    }
    previewAccent = null;
    pendingAccent = null;
    if (previewBackground && pendingBackground && previewBackground !== pendingBackground) {
      applyBackgroundTheme(previewBackground);
    }
    previewBackground = null;
    pendingBackground = null;
    restoreSavedThemeMode();
    restoreFollowOmarchyPreview();
    pendingPrimaryCards = null;
    pendingCustomEntityIcons = {};
    activeCustomEntityIconPickerEntityId = null;
    customEntityIconPickerQueryByEntityId = {};
    lastCustomEntityIconAction = null;
    pendingCustomColors = [];
    activeCustomManagementThemeId = null;
    hasDraftColorPreview = false;
    setCustomThemes(getSavedCustomColors());
    hideThemeTooltip();

    // Clean up hotkey event listeners to prevent memory leaks
    cleanupHotkeyEventListeners();

    const modal = document.getElementById('settings-modal');
    if (modal) {
      void closeDialog(modal);
    }
  } catch (error) {
    log.error('Error closing settings:', error);
  }
}

// Says what the test found, as far as the main process could tell. A wrong port, a proxy that is
// down and a certificate Chromium refuses each have a different fix, so they are not all
// "could not reach".
function getConnectionTestMessage(resultOrError) {
  if (resultOrError?.success) {
    return {
      type: 'success',
      text: t('Token accepted. Home Assistant is reachable. Select Save to keep it.'),
    };
  }

  const code = classifyConnectionError(resultOrError);
  if (code === 'invalid-url') {
    return {
      type: 'error',
      text: t('Enter a valid Home Assistant URL and long-lived access token before testing.'),
    };
  }
  if (code === 'auth-failed') {
    return {
      type: 'error',
      text: t('Authentication failed. Check your long-lived access token.'),
    };
  }
  const status = Number(resultOrError?.status || 0);
  const detail = String(resultOrError?.error || resultOrError?.message || '');
  if (status >= 400) {
    return { type: 'error', text: t('HTTP {{status}}: check the URL and port.', { status }) };
  }
  // The main process passes Chromium's own error name along (net::ERR_CERT_AUTHORITY_INVALID).
  // A certificate Chromium refuses is one problem; an https:// address that reaches a server
  // speaking plain http (net::ERR_SSL_PROTOCOL_ERROR) is another, with the scheme or port to fix.
  if (/ERR_CERT_|certificate/i.test(detail)) {
    return { type: 'error', text: t('The certificate is not trusted.') };
  }
  if (/ERR_SSL_|ERR_TLS_|\b(?:ssl|tls)\b/i.test(detail)) {
    return {
      type: 'error',
      text: t(
        'The secure connection failed. Check whether the URL should start with http:// or https://, and the port.'
      ),
    };
  }
  // "Request timed out" from the main process, net::ERR_CONNECTION_TIMED_OUT and net::ERR_TIMED_OUT.
  if (/time(?:d)?[\s_-]*out/i.test(detail)) {
    return { type: 'error', text: t('Timed out. Check the URL and port.') };
  }
  return {
    type: 'error',
    text: t('Could not reach Home Assistant at that URL.'),
  };
}

function setSettingsConnectionTestStatus(message = '', type = '') {
  renderConnectionStatus(document.getElementById('test-ha-connection-status'), message, type);
}

function setSettingsConnectionTestBusy(isBusy) {
  const button = document.getElementById('test-ha-connection-btn');
  if (button) {
    // With browser authorization active the token field is unused, and testing it can only fail.
    button.disabled = !!isBusy || (state.CONFIG?.homeAssistant || {}).authMethod === 'oauth';
    button.setAttribute('aria-busy', isBusy ? 'true' : 'false');
  }
  setConnectionStatusBusy(document.getElementById('test-ha-connection-status'), isBusy);
}

function setHomeAssistantOAuthStatus(message = '', type = '') {
  renderConnectionStatus(document.getElementById('ha-oauth-status'), message, type);
}

function setHomeAssistantOAuthBusy(isBusy, { cancellable = false } = {}) {
  const connectButton = document.getElementById('connect-ha-oauth-btn');
  const disconnectButton = document.getElementById('disconnect-ha-oauth-btn');
  const cancelButton = document.getElementById('cancel-ha-oauth-btn');
  if (connectButton) {
    connectButton.disabled = !!isBusy;
    connectButton.setAttribute('aria-busy', isBusy ? 'true' : 'false');
  }
  if (disconnectButton) disconnectButton.disabled = !!isBusy;
  if (cancelButton) {
    // Only a pairing attempt can be abandoned, and its own button must stay
    // clickable while everything else is disabled.
    const showCancel = !!isBusy && cancellable;
    cancelButton.classList.toggle('hidden', !showCancel);
    cancelButton.disabled = !showCancel;
  }
  setConnectionStatusBusy(document.getElementById('ha-oauth-status'), isBusy);
}

let renderedHomeAssistantAuthState = '';

function getHomeAssistantAuthState(homeAssistant) {
  const connection = getLiveConnectionState();
  return JSON.stringify([
    homeAssistant.authMethod || '',
    homeAssistant.oauthStatus || '',
    homeAssistant.oauthLastError || '',
    homeAssistant.oauthLastErrorCode || '',
    connection.status || '',
    connection.reason || '',
    !!connection.needsToken,
    connection.tokenReason || '',
  ]);
}

// A new sign-in is only offered when one is needed: no authorization yet, an expired one, or a URL
// edited to another server. While the saved authorization is good but Home Assistant cannot be
// reached, the button retries restoring it; once connected there is nothing to do.
function getHomeAssistantConnectAction() {
  const homeAssistant = state.CONFIG?.homeAssistant || {};
  if (homeAssistant.authMethod !== 'oauth') return 'connect';
  const typedUrl = normalizeBaseUrl(document.getElementById('ha-url')?.value || '');
  const sameServer = !typedUrl || typedUrl === normalizeBaseUrl(homeAssistant.url || '');
  if (!sameServer || homeAssistant.oauthStatus === 'reauth_required') return 'reconnect';
  return homeAssistant.oauthStatus === 'connected' ? 'none' : 'retry';
}

function updateHomeAssistantConnectButton() {
  const connectButton = document.getElementById('connect-ha-oauth-btn');
  if (!connectButton) return;
  const action = getHomeAssistantConnectAction();
  connectButton.dataset.action = action;
  connectButton.classList.toggle('hidden', action === 'none');
  connectButton.textContent =
    action === 'retry'
      ? t('Retry')
      : action === 'connect'
        ? t('Connect with Home Assistant')
        : t('Reconnect with Home Assistant');
}

// What the main window knows about the live connection, when it opened Settings: the red panel's
// "Open Settings" lands here, and the page must not look healthy while that panel is up.
function getLiveConnectionState() {
  return settingsUiHooks?.getConnectionState?.() || { status: '', reason: '' };
}

function updateHomeAssistantAuthUi() {
  const homeAssistant = state.CONFIG?.homeAssistant || {};
  const usesOAuth = homeAssistant.authMethod === 'oauth';
  renderedHomeAssistantAuthState = getHomeAssistantAuthState(homeAssistant);
  const disconnectButton = document.getElementById('disconnect-ha-oauth-btn');
  const tokenInput = document.getElementById('ha-token');
  const testButton = document.getElementById('test-ha-connection-btn');
  const legacySettings = document.getElementById('legacy-ha-token-settings');
  const oauthNote = document.getElementById('legacy-ha-token-oauth-note');

  updateHomeAssistantConnectButton();
  updateSecureStorageNotice();
  disconnectButton?.classList.toggle('hidden', !usesOAuth);
  if (tokenInput) {
    tokenInput.disabled = usesOAuth;
    if (usesOAuth) tokenInput.value = '';
  }
  // Testing needs a token, and an OAuth setup has none to type: say why instead of leaving a
  // button that can only fail beside a dead field.
  if (testButton) testButton.disabled = usesOAuth;
  oauthNote?.classList.toggle('hidden', !usesOAuth);
  if (legacySettings && usesOAuth) legacySettings.open = false;

  if (!usesOAuth) {
    const connection = getLiveConnectionState();
    if (connection.status === 'auth-failed') {
      // The saved token was refused: the field to fix it is under "advanced", so open that.
      setHomeAssistantOAuthStatus(
        connection.reason ||
          t('Authentication failed. Check your long-lived access token in Settings.'),
        'error'
      );
      if (legacySettings) legacySettings.open = true;
    } else if (connection.needsToken) {
      // The saved token could not be read: the main window's reason, and the field to enter it in.
      setHomeAssistantOAuthStatus(connection.reason, 'error');
      if (legacySettings) legacySettings.open = true;
    } else if (connection.status === 'disconnected' && connection.reason) {
      setHomeAssistantOAuthStatus(connection.reason, 'error');
    } else {
      // Standing advice, not progress: plain help text, not the accent-coloured pending line.
      setHomeAssistantOAuthStatus(
        t('Browser authorization is recommended. The legacy token option remains available below.'),
        ''
      );
    }
  } else if (homeAssistant.oauthStatus === 'connected') {
    setHomeAssistantOAuthStatus(t('Connected with Home Assistant authorization.'), 'success');
  } else if (homeAssistant.oauthStatus === 'restoring') {
    setHomeAssistantOAuthStatus(t('Restoring Home Assistant authorization...'), 'pending');
  } else if (homeAssistant.oauthStatus === 'reauth_required') {
    setHomeAssistantOAuthStatus(
      describeHomeAssistantOAuthReauthReason(homeAssistant) ||
        t(
          'Home Assistant no longer accepts the authorization for this app. It may have expired or been revoked. Reconnect with Home Assistant to continue.'
        ),
      'error'
    );
  } else {
    setHomeAssistantOAuthStatus(describeHomeAssistantOAuthRefreshError(homeAssistant), 'error');
  }
}

// Main can change the authorization state while Settings is open, for example when a refresh finds
// the authorization revoked. Keep the status line truthful unless a pairing is showing progress.
function refreshHomeAssistantAuthStatus() {
  const modal = document.getElementById('settings-modal');
  if (!modal || modal.classList.contains('hidden')) return;
  if (document.getElementById('connect-ha-oauth-btn')?.getAttribute('aria-busy') === 'true') return;
  // Other config echoes (an autosaved toggle) must not reset the section the user is working in.
  if (
    getHomeAssistantAuthState(state.CONFIG?.homeAssistant || {}) === renderedHomeAssistantAuthState
  )
    return;
  updateHomeAssistantAuthUi();
}

async function retryHomeAssistantOAuthFromSettings() {
  setHomeAssistantOAuthBusy(true);
  setHomeAssistantOAuthStatus(t('Restoring Home Assistant authorization...'), 'pending');
  try {
    await window.electronAPI.refreshHomeAssistantOAuth();
  } catch (error) {
    log.warn('Retrying Home Assistant authorization failed:', error);
  } finally {
    setHomeAssistantOAuthBusy(false);
    updateHomeAssistantAuthUi();
  }
}

async function startHomeAssistantOAuthFromSettings() {
  const haUrl = document.getElementById('ha-url');
  const validation = validateHomeAssistantUrl(haUrl?.value || '');
  if (!validation.valid) {
    showFieldError(haUrl, validation.error);
    return;
  }
  // Show the address that will be used (a bare host gains its scheme, a dashboard path goes).
  if (haUrl) haUrl.value = validation.url;
  setHomeAssistantOAuthBusy(true, { cancellable: true });
  setHomeAssistantOAuthStatus(t('Waiting for you to approve in your browser...'), 'pending');
  try {
    const result = await startHomeAssistantPairing(window.electronAPI, validation.url);
    applyPersistedConfigResponse(result.config);
    if (haUrl) haUrl.value = state.CONFIG.homeAssistant.url || validation.url;
    updateHomeAssistantAuthUi();
    showToast(t('Home Assistant authorization connected'), 'success', 2600);
  } catch (error) {
    if (error?.result?.code === 'OAUTH_AUTHORIZATION_CANCELED') {
      // The user abandoned the attempt on purpose, so restore the real auth
      // state rather than reporting a failure. A previously connected account is
      // untouched by a cancelled reconnect, so leave its status line alone.
      updateHomeAssistantAuthUi();
      if (state.CONFIG?.homeAssistant?.oauthStatus !== 'connected') {
        setHomeAssistantOAuthStatus(t('Home Assistant authorization canceled'), 'pending');
      }
    } else {
      setHomeAssistantOAuthStatus(describeHomeAssistantOAuthFailure(error), 'error');
    }
  } finally {
    setHomeAssistantOAuthBusy(false);
  }
}

async function cancelHomeAssistantOAuthFromSettings() {
  const cancelButton = document.getElementById('cancel-ha-oauth-btn');
  if (cancelButton) cancelButton.disabled = true;
  setHomeAssistantOAuthStatus(t('Canceling Home Assistant authorization...'), 'pending');
  try {
    await window.electronAPI.cancelHomeAssistantOAuth();
  } catch (error) {
    setHomeAssistantOAuthStatus(
      error?.message || t('Could not cancel Home Assistant authorization'),
      'error'
    );
  }
}

async function disconnectHomeAssistantOAuthFromSettings() {
  // The widget stops talking to Home Assistant and has to be authorized again, so a stray click
  // should not do it.
  const confirmed = await showConfirm(
    t('Disconnect'),
    t('Disconnect this widget from Home Assistant? You will need to authorize again.'),
    { confirmText: t('Disconnect'), confirmClass: 'btn-danger' }
  );
  if (!confirmed) return;
  setHomeAssistantOAuthBusy(true);
  try {
    const result = await window.electronAPI.disconnectHomeAssistantOAuth();
    applyPersistedConfigResponse(result.config);
    updateHomeAssistantAuthUi();
    // The warning is main-process English; it always means the remote revocation is unconfirmed.
    if (result.warning) {
      showToast(
        t(
          'Disconnected. Home Assistant did not confirm that it revoked the authorization, so you can remove it from your Home Assistant profile.'
        ),
        'warning',
        5000
      );
    } else {
      showToast(t('Home Assistant authorization disconnected'), 'success', 2600);
    }
  } catch (error) {
    setHomeAssistantOAuthStatus(error?.message || t('Could not disconnect authorization'), 'error');
  } finally {
    setHomeAssistantOAuthBusy(false);
  }
}

function bindHomeAssistantOAuthUi() {
  const connectButton = document.getElementById('connect-ha-oauth-btn');
  const disconnectButton = document.getElementById('disconnect-ha-oauth-btn');
  const cancelButton = document.getElementById('cancel-ha-oauth-btn');
  if (cancelButton && cancelButton.dataset.initialized !== 'true') {
    cancelButton.addEventListener('click', () => void cancelHomeAssistantOAuthFromSettings());
    cancelButton.dataset.initialized = 'true';
  }
  if (connectButton && connectButton.dataset.initialized !== 'true') {
    connectButton.addEventListener('click', () =>
      getHomeAssistantConnectAction() === 'retry'
        ? void retryHomeAssistantOAuthFromSettings()
        : void startHomeAssistantOAuthFromSettings()
    );
    connectButton.dataset.initialized = 'true';
    document.getElementById('ha-url')?.addEventListener('input', updateHomeAssistantConnectButton);
  }
  if (disconnectButton && disconnectButton.dataset.initialized !== 'true') {
    disconnectButton.addEventListener(
      'click',
      () => void disconnectHomeAssistantOAuthFromSettings()
    );
    disconnectButton.dataset.initialized = 'true';
  }
}

async function runSettingsConnectionTest() {
  const haUrl = document.getElementById('ha-url');
  const haToken = document.getElementById('ha-token');
  const normalizedUrl = normalizeBaseUrl(haUrl?.value || '');
  const token = (haToken?.value || '').trim();

  if (!normalizedUrl || isPlaceholderOrEmptyToken(token)) {
    const message = getConnectionTestMessage({ code: 'invalid-url' });
    setSettingsConnectionTestStatus(message.text, message.type);
    return false;
  }

  setSettingsConnectionTestBusy(true);
  setSettingsConnectionTestStatus(t('Testing Home Assistant connection...'), 'pending');
  try {
    const result = await window.electronAPI.testHaConnection(normalizedUrl, token);
    const message = getConnectionTestMessage(result);
    setSettingsConnectionTestStatus(message.text, message.type);
    return !!result?.success;
  } catch (error) {
    const message = getConnectionTestMessage(error);
    setSettingsConnectionTestStatus(message.text, message.type);
    return false;
  } finally {
    setSettingsConnectionTestBusy(false);
  }
}

function bindConnectionTestUi() {
  const button = document.getElementById('test-ha-connection-btn');
  if (!button || button.dataset.initialized === 'true') return;
  button.addEventListener('click', () => {
    void runSettingsConnectionTest();
  });
  // A result describes the address and token that were tested. Once either is edited it describes
  // something else, and a green line beside a changed field would be a claim nobody checked.
  ['ha-url', 'ha-token'].forEach((id) =>
    document
      .getElementById(id)
      ?.addEventListener('input', () => setSettingsConnectionTestStatus('', ''))
  );
  button.dataset.initialized = 'true';
}

// A second Save while one is running (a double click, or Enter held down) would write the config
// twice and raise every restart and sync prompt twice. Only the first call does the work.
let settingsSaveInFlight = false;

async function saveSettings() {
  if (settingsSaveInFlight) return;
  settingsSaveInFlight = true;
  const saveButton = document.getElementById('save-settings');
  saveButton?.setAttribute('aria-busy', 'true');
  const reenableSaveButton = disableControlsKeepingFocus([saveButton]);
  try {
    await persistSettings();
  } finally {
    settingsSaveInFlight = false;
    saveButton?.removeAttribute('aria-busy');
    reenableSaveButton();
  }
}

/**
 * Persist current settings from the settings UI, apply them to the app, and update related subsystems.
 *
 * Reads and validates form fields (including Home Assistant URL and token), persists the resulting configuration,
 * applies UI and window-effect changes (opacity, themes, frosted glass, always-on-top), updates platform-specific
 * settings (Start at login, global hotkeys, entity alerts, primary media player), refreshes the media tile,
 * and reconnects to Home Assistant only if connection settings changed. May prompt the user to restart the app when
 * toggling Always on Top. Errors are logged and reported via toasts where validation fails.
 */
async function persistSettings() {
  let configPersisted = false;
  let syncFileCopiedThisSave = false;
  try {
    const currentConfig = state.CONFIG || {};
    const nextConfig = JSON.parse(JSON.stringify(currentConfig));
    nextConfig.homeAssistant = { ...(nextConfig.homeAssistant || {}) };
    const prevAlwaysOnTop = currentConfig.alwaysOnTop;
    const prevOpacity = typeof currentConfig.opacity === 'number' ? currentConfig.opacity : 1;
    const prevProfileSync = { ...(currentConfig.profileSync || {}) };
    // A choice put off earlier is not this save's business unless the save touches sync.
    const choiceWasWaiting = !!profileSyncStatusCache?.needsResolution;

    // Store previous HA connection settings to detect if reconnect is needed
    const prevHaUrl = currentConfig.homeAssistant?.url;
    const prevHaToken = currentConfig.homeAssistant?.token;

    const haUrl = document.getElementById('ha-url');
    const haToken = document.getElementById('ha-token');
    const alwaysOnTop = document.getElementById('always-on-top');
    const hideOnBlur = document.getElementById('hide-on-blur');
    const opacitySlider = document.getElementById('opacity-slider');
    const frostedGlass = document.getElementById('frosted-glass');
    const enableInteractionDebugLogs = document.getElementById('enable-interaction-debug-logs');
    const allowPrereleaseUpdates = document.getElementById('allow-prerelease-updates');
    const languageSelect = document.getElementById('language-select');
    const weatherEntitySelect = document.getElementById('weather-entity-select');
    const globalHotkeysEnabled = document.getElementById('global-hotkeys-enabled');
    const entityAlertsEnabled = document.getElementById('entity-alerts-enabled');
    const profileSyncEnabled = document.getElementById('profile-sync-enabled');
    const profileSyncProvider = document.getElementById('profile-sync-provider');
    const profileSyncFolderPath = document.getElementById('profile-sync-folder-path');
    const profileSyncInterval = document.getElementById('profile-sync-interval');
    const profileSyncEncryptionEnabled = document.getElementById('profile-sync-encryption-enabled');
    const profileSyncPassphrase = document.getElementById('profile-sync-passphrase');
    const profileSyncRememberPassphrase = document.getElementById(
      'profile-sync-remember-passphrase'
    );

    const canProceedWithSave = await handlePendingCustomEditorChangesBeforeSave();
    if (!canProceedWithSave) return;

    const usesOAuth = currentConfig.homeAssistant?.authMethod === 'oauth';
    // OAuth connection fields are main-process-owned and changed only through
    // Connect/Disconnect. Saving unrelated settings must not echo access tokens.
    if (usesOAuth) {
      nextConfig.homeAssistant = { ...currentConfig.homeAssistant };
      // The address of an authorized setup is changed by authorizing again, not by Save. Saving
      // would drop the edit and close Settings as if it had been kept.
      const typedUrl = haUrl ? validateHomeAssistantUrl(haUrl.value) : null;
      const savedUrl = normalizeBaseUrl(currentConfig.homeAssistant?.url || '');
      if (typedUrl && savedUrl && !typedUrl.valid) {
        showFieldError(haUrl, typedUrl.error);
        return;
      }
      if (typedUrl && savedUrl && typedUrl.url !== savedUrl) {
        showFieldError(
          haUrl,
          t(
            'Saving does not switch servers. Select Reconnect with Home Assistant to use this address, or restore the saved one.'
          )
        );
        return;
      }
    } else if (haUrl) {
      const validation = validateHomeAssistantUrl(haUrl.value);
      if (!validation.valid) {
        // Settings has many pages, and this is rarely the one Save was pressed from.
        showFieldError(haUrl, validation.error);
        return;
      }
      nextConfig.homeAssistant.url = validation.url;
      haUrl.value = validation.url;
    }

    if (haToken && !usesOAuth) {
      const nextToken = haToken.value.trim();
      const currentToken = currentConfig.homeAssistant?.token || '';
      const shouldPreservePlaceholderToken =
        !nextToken && currentToken === 'YOUR_LONG_LIVED_ACCESS_TOKEN';

      if (!shouldPreservePlaceholderToken) {
        nextConfig.homeAssistant.token = nextToken;
        nextConfig.homeAssistant.authMethod = 'token';
      }

      // Clear tokenResetReason only after the user enters a replacement token.
      if (nextToken && nextConfig.tokenResetReason) {
        delete nextConfig.tokenResetReason;
      }
    }
    if (weatherEntitySelect) {
      const selectedOption = weatherEntitySelect.selectedOptions[0];
      const selectedWeatherEntity = weatherEntitySelect.value;
      const selectedIsStillUnavailable =
        selectedOption?.dataset?.savedUnavailable === 'true' &&
        selectedWeatherEntity === currentConfig.selectedWeatherEntity;

      if (selectedIsStillUnavailable) {
        // Preserve an existing unavailable selection so it automatically resumes when HA restores it.
        nextConfig.selectedWeatherEntity = selectedWeatherEntity;
      } else if (
        getAvailableWeatherEntities().some((entity) => entity.entity_id === selectedWeatherEntity)
      ) {
        nextConfig.selectedWeatherEntity = selectedWeatherEntity;
      } else {
        // Empty, stale, or malformed selections return to the long-standing automatic behaviour.
        nextConfig.selectedWeatherEntity = null;
      }
    }
    if (alwaysOnTop && !alwaysOnTop.disabled) nextConfig.alwaysOnTop = alwaysOnTop.checked;
    if (hideOnBlur && !hideOnBlur.disabled) nextConfig.hideOnBlur = hideOnBlur.checked;
    if (frostedGlass && !frostedGlass.disabled) nextConfig.frostedGlass = frostedGlass.checked;
    delete nextConfig.frostedGlassStrength;
    delete nextConfig.frostedGlassTint;

    const weatherEffectsEnabled = document.getElementById('weather-effects-enabled');
    const weatherOverrideSelect = document.getElementById('weather-override-select');
    nextConfig.ui = nextConfig.ui || {};
    const followOmarchy = document.getElementById('follow-omarchy');
    if (followOmarchy && !followOmarchy.disabled)
      nextConfig.ui.followOmarchy = followOmarchy.checked;
    // A locked Frosted glass switch means the weather switch is locked with it, not turned off. With
    // the glass merely switched off, the effects are paused and the choice is kept for its return.
    if (!frostedGlass?.disabled) {
      nextConfig.ui.weatherEffectsEnabled = weatherEffectsEnabled
        ? !!weatherEffectsEnabled.checked
        : false;
    }
    nextConfig.ui.weatherOverride = weatherOverrideSelect ? weatherOverrideSelect.value : 'auto';
    nextConfig.ui.language = languageSelect?.value || nextConfig.ui.language || 'auto';
    nextConfig.ui = getAppearanceFromInputs(nextConfig.ui);
    if (enableInteractionDebugLogs) {
      nextConfig.ui.enableInteractionDebugLogs = !!enableInteractionDebugLogs.checked;
    }
    nextConfig.updates = nextConfig.updates || {};
    if (allowPrereleaseUpdates) {
      nextConfig.updates.allowPrerelease = !!allowPrereleaseUpdates.checked;
    }
    nextConfig.ui.theme = pendingThemeMode || normalizeThemeMode(nextConfig.ui.theme);
    nextConfig.ui.accent = pendingAccent || getCurrentAccentTheme();
    nextConfig.ui.background = pendingBackground || getCurrentBackgroundTheme();
    nextConfig.ui.customColors = getCustomColorsForSave();
    const timeFormat = document.getElementById('time-format');
    nextConfig.ui.timeFormat = ['system', '12-hour', '24-hour'].includes(timeFormat?.value)
      ? timeFormat.value
      : 'system';
    const dateFormat = document.getElementById('date-format');
    nextConfig.ui.dateFormat = ['system', 'weekday-short', 'long', 'numeric'].includes(
      dateFormat?.value
    )
      ? dateFormat.value
      : 'weekday-short';
    nextConfig.ui.use24HourClock = nextConfig.ui.timeFormat === '24-hour';

    // Apply "Start at login" only after the complete config has validated and persisted.
    const startWithWindows = document.getElementById('start-with-windows');

    if (opacitySlider) {
      const sliderValue = parseInt(opacitySlider.value) || 90;
      nextConfig.opacity = sliderValueToOpacity(sliderValue, currentConfig.opacity);
    }

    nextConfig.globalHotkeys = nextConfig.globalHotkeys || { enabled: false, hotkeys: {} };
    if (globalHotkeysEnabled) nextConfig.globalHotkeys.enabled = globalHotkeysEnabled.checked;

    nextConfig.entityAlerts = nextConfig.entityAlerts || { enabled: false, alerts: {} };
    if (entityAlertsEnabled) nextConfig.entityAlerts.enabled = entityAlertsEnabled.checked;

    // Save the primary media player straight from its select
    nextConfig.primaryMediaPlayer = document.getElementById('primary-media-player')?.value || null;

    nextConfig.primaryCards = getPendingPrimaryCards();
    nextConfig.customEntityIcons = getPendingCustomEntityIconsForSave();

    const nextProfileSync = ensureProfileSyncConfig(nextConfig);
    nextProfileSync.enabled = !!profileSyncEnabled?.checked;
    nextProfileSync.provider = profileSyncProvider?.value || 'cloudFile';
    const syncFolderPath = (profileSyncFolderPath?.value || '').trim();
    nextProfileSync.cloudFilePath = buildProfileSyncFilePathFromFolder(syncFolderPath);
    nextProfileSync.syncScope = readProfileSyncScopeFromForm();
    const parsedIntervalMinutes = Number.parseInt(profileSyncInterval?.value || '', 10);
    nextProfileSync.intervalMinutes =
      Number.isFinite(parsedIntervalMinutes) && parsedIntervalMinutes > 0
        ? parsedIntervalMinutes
        : 5;
    nextProfileSync.encryptionEnabled = !!profileSyncEncryptionEnabled?.checked;
    nextProfileSync.rememberPassphrase =
      nextProfileSync.encryptionEnabled && !!profileSyncRememberPassphrase?.checked;
    nextProfileSync.passphraseEncrypted = false;

    // Only turning sync on needs a folder. Sync that was already on without one keeps working
    // against its private file (the folder warning says so), so an unrelated save must not
    // be refused for it.
    if (
      nextProfileSync.enabled &&
      prevProfileSync.enabled !== true &&
      !nextProfileSync.cloudFilePath
    ) {
      showProfileSyncFieldError(
        profileSyncFolderPath,
        t('Choose a sync folder before enabling profile sync.')
      );
      return;
    }

    // Checked here, before anything is saved or copied: main would refuse a short passphrase
    // only after the rest of the save was persisted, leaving encrypted sync half enabled.
    const typedPassphrase = (profileSyncPassphrase?.value || '').trim();
    if (
      nextProfileSync.enabled &&
      nextProfileSync.encryptionEnabled &&
      typedPassphrase &&
      typedPassphrase.length < PROFILE_SYNC_MIN_PASSPHRASE_LENGTH
    ) {
      showProfileSyncFieldError(
        profileSyncPassphrase,
        t('Passphrase must be at least {{count}} characters long', {
          count: PROFILE_SYNC_MIN_PASSPHRASE_LENGTH,
        })
      );
      return;
    }
    const passphraseConfirm = document.getElementById('profile-sync-passphrase-confirm');
    const confirmShown =
      !!passphraseConfirm &&
      !document
        .getElementById('profile-sync-passphrase-confirm-group')
        ?.classList.contains('hidden');
    if (
      nextProfileSync.enabled &&
      nextProfileSync.encryptionEnabled &&
      typedPassphrase &&
      confirmShown &&
      passphraseConfirm.value.trim() !== typedPassphrase
    ) {
      showProfileSyncFieldError(passphraseConfirm, t('The passphrases do not match.'));
      return;
    }

    const previousSyncFilePath = (prevProfileSync.cloudFilePath || '').trim();
    const nextSyncFilePath = (nextProfileSync.cloudFilePath || '').trim();
    // A first enable is not a move: before sync has run there is no file to carry along, and
    // main reports no folder while the private default one is in use.
    const syncPathChanged =
      nextProfileSync.enabled &&
      prevProfileSync.enabled === true &&
      !!previousSyncFilePath &&
      !!nextSyncFilePath &&
      previousSyncFilePath !== nextSyncFilePath;
    if (syncPathChanged) {
      const previousFolder = deriveProfileSyncFolderPath(previousSyncFilePath);
      const nextFolder = deriveProfileSyncFolderPath(nextSyncFilePath);
      const copyAndSwitch = await showConfirm(
        t('Sync folder changed'),
        t('Copy the existing sync data file from {{from}} into {{to}} and switch sync there?', {
          from: previousFolder,
          to: nextFolder,
        }),
        {
          confirmText: t('Copy & Switch'),
          cancelText: t('Keep Current'),
          confirmClass: 'btn-primary',
        }
      );

      const revertToPreviousSyncPath = () => {
        nextProfileSync.cloudFilePath = previousSyncFilePath;
        setProfileSyncFolderField(previousFolder);
      };
      const keepCurrentSyncFolder = () => {
        revertToPreviousSyncPath();
        showToast(
          t('Kept the current sync folder: {{folder}}', { folder: previousFolder }),
          'info',
          2600
        );
      };

      let usedExistingFile = false;
      if (!copyAndSwitch) {
        keepCurrentSyncFolder();
      } else if (!window.electronAPI?.copyProfileSyncFile) {
        revertToPreviousSyncPath();
        showToast(
          t('Copy is unavailable on this build. Kept current sync folder.'),
          'warning',
          3200
        );
      } else {
        const copyResult = await window.electronAPI.copyProfileSyncFile(
          previousSyncFilePath,
          nextSyncFilePath
        );
        if (copyResult?.status === 'destination_exists') {
          // Whatever is there is probably another computer's file, so it is never replaced
          // with a copy. Switching to it compares the two sides' settings first, and the
          // choice panel offers This computer (with the replaced settings backed up).
          usedExistingFile = await showConfirm(
            t('Sync file already exists'),
            t(
              '{{folder}} already has a sync file, probably from another computer. Switch to it? Settings that differ are compared first, and you choose which to keep before anything is replaced.',
              { folder: nextFolder }
            ),
            {
              confirmText: t('Use That File'),
              cancelText: t('Keep Current'),
              confirmClass: 'btn-primary',
            }
          );
          if (!usedExistingFile) keepCurrentSyncFolder();
        }

        if (nextProfileSync.cloudFilePath !== previousSyncFilePath && !usedExistingFile) {
          if (copyResult?.status === 'source_missing') {
            showToast(t('No existing sync file found. Switched to the new folder.'), 'info', 3200);
          } else if (!copyResult?.ok) {
            revertToPreviousSyncPath();
            showToast(
              copyResult?.error || t('Failed to copy sync file. Kept current sync folder.'),
              'error',
              3400
            );
          } else if (copyResult?.copied) {
            syncFileCopiedThisSave = true;
            showToast(t('Copied sync file and switched folders.'), 'success', 2200);
          }
        }
      }
    }

    const hasSavedPassphrase = !!profileSyncStatusCache?.passphraseStored;
    const encryptionSettingChanged =
      nextProfileSync.encryptionEnabled !== !!prevProfileSync.encryptionEnabled;
    const pendingEncryptionChangeCancelled =
      typeof prevProfileSync.encryptionChangePending === 'boolean' &&
      nextProfileSync.encryptionEnabled === !!prevProfileSync.encryptionEnabled;
    const disablingEncryption =
      nextProfileSync.enabled &&
      !!prevProfileSync.encryptionEnabled &&
      !nextProfileSync.encryptionEnabled;
    const removingRememberedPassphrase =
      nextProfileSync.enabled &&
      nextProfileSync.encryptionEnabled &&
      !nextProfileSync.rememberPassphrase &&
      !!prevProfileSync.rememberPassphrase;
    let passphraseUpdatedThisSave = false;
    let profileSyncCredentialOperationFailed = false;

    // The file's own mode decides whether the current passphrase is needed: when another computer
    // already turned encryption off, there is nothing to unlock.
    if (
      disablingEncryption &&
      !typedPassphrase &&
      !hasSavedPassphrase &&
      profileSyncStatusCache?.remoteEncrypted !== false
    ) {
      showProfileSyncFieldError(
        profileSyncPassphrase,
        t('Enter the current remote passphrase before disabling encrypted sync.')
      );
      return;
    }

    if (nextProfileSync.enabled && nextProfileSync.encryptionEnabled) {
      const canReuseSavedPassphrase = hasSavedPassphrase && !removingRememberedPassphrase;
      if (!typedPassphrase && !canReuseSavedPassphrase) {
        showProfileSyncFieldError(
          profileSyncPassphrase,
          t(
            'Enter a passphrase or use an existing saved passphrase before enabling encrypted sync.'
          )
        );
        return;
      }

      if (typedPassphrase) {
        // Validate that this build can persist a passphrase before we touch config,
        // but defer the actual keychain write until after the config is safely
        // persisted so a failed save can never overwrite a previously stored secret.
        if (!window.electronAPI?.setProfileSyncPassphrase) {
          showToast(t('This build cannot save a sync passphrase.'), 'error', 3400);
          return;
        }
        // Predicted metadata: rememberPassphrase is already the requested value; a
        // freshly typed passphrase has not yet been encrypted at rest.
        nextProfileSync.passphraseEncrypted = false;
      } else {
        nextProfileSync.passphraseEncrypted = !!profileSyncStatusCache?.passphraseEncrypted;
      }
    }

    keepNewerSyncedSettings(nextConfig, settingsFormBaseConfig, state.CONFIG, settingsTouchedKeys);
    // Tells main which values are deliberate, so its stale-echo guard keeps them.
    nextConfig.profileSyncTouchedKeys = [...settingsTouchedKeys];
    // Read before the touched keys are cleared below: the icons toast is about this save's edits,
    // not about whether any custom icon exists.
    const customIconsEdited = settingsTouchedKeys.has('customEntityIcons');
    const updatedConfig = await window.electronAPI.updateConfig(nextConfig);
    applyPersistedConfigResponse(updatedConfig);
    configPersisted = true;
    settingsFormBaseConfig = cloneConfigValue(state.CONFIG || {});
    settingsTouchedKeys = new Set();
    setCustomThemes(state.CONFIG.ui?.customColors || []);

    // Store the sync passphrase only now that the config is safely persisted. If this
    // fails, the settings are still saved and the previously stored secret is untouched.
    if (
      nextProfileSync.enabled &&
      (typedPassphrase || encryptionSettingChanged || pendingEncryptionChangeCancelled)
    ) {
      let passphraseResult = null;
      try {
        passphraseResult = await window.electronAPI.setProfileSyncPassphrase(
          typedPassphrase,
          !!nextProfileSync.rememberPassphrase,
          !!nextProfileSync.encryptionEnabled
        );
        if (!passphraseResult?.success) {
          throw new Error(passphraseResult?.error || t('Failed to save sync passphrase.'));
        }
        if (passphraseResult.warning) {
          showToast(passphraseResult.warning, 'warning', 5000);
        }
        if (passphraseResult.config) {
          applyPersistedConfigResponse(passphraseResult.config);
        }
        passphraseUpdatedThisSave = true;

        const resolvedRemembered =
          typeof passphraseResult.remembered === 'boolean'
            ? passphraseResult.remembered
            : !!nextProfileSync.rememberPassphrase;
        const resolvedEncrypted = !!passphraseResult.encrypted;
        nextProfileSync.rememberPassphrase = resolvedRemembered;
        nextProfileSync.passphraseEncrypted = resolvedEncrypted;

        const persistedProfileSync = state.CONFIG.profileSync || {};
        if (
          resolvedRemembered !== persistedProfileSync.rememberPassphrase ||
          resolvedEncrypted !== persistedProfileSync.passphraseEncrypted
        ) {
          try {
            const correctedConfig = JSON.parse(JSON.stringify(state.CONFIG));
            correctedConfig.profileSync = correctedConfig.profileSync || {};
            correctedConfig.profileSync.rememberPassphrase = resolvedRemembered;
            correctedConfig.profileSync.passphraseEncrypted = resolvedEncrypted;
            const correctedResult = await window.electronAPI.updateConfig(correctedConfig);
            if (
              !correctedResult ||
              correctedResult.success === false ||
              !correctedResult.homeAssistant
            ) {
              throw new Error(correctedResult?.error || 'Failed to persist passphrase metadata');
            }
            applyPersistedConfigResponse(correctedResult);
          } catch (correctiveError) {
            log.error('Failed to persist updated passphrase metadata:', correctiveError);
          }
        }
      } catch (passphraseError) {
        profileSyncCredentialOperationFailed = true;
        if (passphraseResult?.config) {
          applyPersistedConfigResponse(passphraseResult.config);
        }
        if (passphraseResult?.status) {
          updateProfileSyncStatusUi(passphraseResult.status);
        }
        log.error('Failed to store sync passphrase after saving settings:', passphraseError);
        const failureReason =
          passphraseResult?.error ||
          passphraseError?.message ||
          t('Settings were saved, but the sync passphrase could not be stored.');
        // A refusal can run to two sentences, which the usual few seconds are too short to read.
        showToast(failureReason, 'warning', failureReason.length > 100 ? 10000 : 5000);
      }
    }

    // Only a changed, supported checkbox touches the OS; isolated profiles report it unsupported.
    if (
      startWithWindows &&
      !startWithWindows.disabled &&
      startWithWindows.checked !== loadedStartAtLogin
    ) {
      try {
        const result = await window.electronAPI.setLoginItemSettings(startWithWindows.checked);
        if (!result.success) {
          log.error('Failed to set login item settings:', result.error);
          showToast(t('Failed to update Start at login setting'), 'warning', 3000);
        }
      } catch (error) {
        log.error('Failed to set login item settings:', error);
      }
    }

    if (customIconsEdited) {
      showToast(
        t('Custom icons saved. Icons apply to entities already shown in your tabs/tiles.'),
        'success',
        2600
      );
    }

    const shouldClearSavedPassphrase =
      !!window.electronAPI?.clearProfileSyncPassphrase &&
      !profileSyncCredentialOperationFailed &&
      !state.CONFIG.profileSync?.remoteRewritePending &&
      typeof state.CONFIG.profileSync?.encryptionChangePending !== 'boolean' &&
      (!nextProfileSync.encryptionEnabled ||
        (nextProfileSync.encryptionEnabled &&
          !nextProfileSync.rememberPassphrase &&
          prevProfileSync.rememberPassphrase &&
          !passphraseUpdatedThisSave));
    if (shouldClearSavedPassphrase) {
      try {
        await window.electronAPI.clearProfileSyncPassphrase();
      } catch (error) {
        log.error('Settings saved, but the sync passphrase could not be cleared:', error);
        const warningMessage = t('Error: {{error}}', {
          error: error?.message || t('Unknown error'),
        });
        showToast(warningMessage, 'warning', 5000);
      }
    }

    await refreshProfileSyncStatusUi({ syncFormState: true });
    // A sync that waits on the person (a first-sync choice, a passphrase that was refused)
    // would otherwise be known only to someone who reopens Advanced, so Settings stays there.
    const syncChangedBySave =
      nextProfileSync.enabled &&
      (prevProfileSync.enabled !== true ||
        // Read after the folder question: a switch the person declined is not a change.
        (nextProfileSync.cloudFilePath || '').trim() !== previousSyncFilePath ||
        encryptionSettingChanged ||
        !!typedPassphrase ||
        JSON.stringify(normalizeProfileSyncScope(prevProfileSync.syncScope)) !==
          JSON.stringify(normalizeProfileSyncScope(nextProfileSync.syncScope)));
    const keepSettingsOpenForSync =
      profileSyncCredentialOperationFailed ||
      (!!profileSyncStatusCache?.needsResolution && (!choiceWasWaiting || syncChangedBySave));

    // Apply opacity immediately
    if (opacitySlider) {
      await window.electronAPI.setOpacity(state.CONFIG.opacity);
    }

    const platform = window?.electronAPI?.platform || 'web';
    const nextOpacity = typeof state.CONFIG.opacity === 'number' ? state.CONFIG.opacity : 1;
    // Where the windows are transparent whatever the opacity (Wayland), 100% needs no restart.
    const opacityNeedsRestart =
      platform === 'linux' &&
      !state.CONFIG.desktopCapabilities?.alwaysTransparentWindows &&
      ((prevOpacity === 1 && nextOpacity < 1) || (prevOpacity < 1 && nextOpacity === 1));

    // The themed dialog, not the browser's: that one has no title, says OK and Cancel in the system
    // language (Cancel reads as "do not save", not "later"), and under the Linux layer shell it can
    // open behind the widget while the page waits on it.
    const askToRestart = (message) =>
      showConfirm(t('Restart required'), message, {
        confirmText: t('Restart now'),
        cancelText: t('Later'),
        confirmClass: 'btn-primary',
      });

    if (opacityNeedsRestart) {
      const restartForOpacity = await askToRestart(
        t(
          'Changing opacity between 100% and transparent on Linux requires an app restart. Restart now?'
        )
      );
      await window.electronAPI
        .focusWindow()
        .catch((err) => log.error('Failed to refocus window:', err));
      if (restartForOpacity) {
        await window.electronAPI.restartApp();
        return;
      }
    }

    if (prevAlwaysOnTop !== state.CONFIG.alwaysOnTop) {
      const res = await window.electronAPI.setAlwaysOnTop(state.CONFIG.alwaysOnTop);
      const windowState = await window.electronAPI.getWindowState();
      if (!res?.applied || windowState?.alwaysOnTop !== state.CONFIG.alwaysOnTop) {
        const restartForAlwaysOnTop = await askToRestart(
          t('Changing "Always on top" may require a restart. Restart now?')
        );
        // Force window to regain focus after the dialog, whatever was chosen (Windows focus bug
        // workaround)
        await window.electronAPI
          .focusWindow()
          .catch((err) => log.error('Failed to refocus window:', err));
        if (restartForAlwaysOnTop) {
          await window.electronAPI.restartApp();
          return;
        }
      }
    }

    previewState = null;
    previewAccent = null;
    pendingAccent = null;
    previewBackground = null;
    pendingBackground = null;
    hasDraftColorPreview = false;
    setCustomEditorActive(false);
    closeSettings();
    applyTheme(state.CONFIG.ui?.theme || 'auto');
    applyAccentTheme(state.CONFIG.ui?.accent || getCurrentAccentTheme());
    applyBackgroundTheme(state.CONFIG.ui?.background || getCurrentBackgroundTheme());
    applyUiPreferences(state.CONFIG.ui || {});
    applyDesktopAppearance(state.CONFIG);
    applyWindowEffects(state.CONFIG || {});

    // Update UI to reflect the newly saved settings selection.
    if (settingsUiHooks?.renderActiveTab) {
      settingsUiHooks.renderActiveTab();
    } else {
      settingsUiHooks?.updateMediaTile?.();
      settingsUiHooks?.renderPrimaryCards?.();
    }

    // Only reconnect WebSocket if HA connection settings actually changed
    const haSettingsChanged =
      prevHaUrl !== state.CONFIG.homeAssistant.url ||
      prevHaToken !== state.CONFIG.homeAssistant.token;

    if (haSettingsChanged) {
      websocket.connect();
    }

    if (keepSettingsOpenForSync) {
      await openSettings(settingsUiHooks);
      showProfileSyncAttention();
    }
  } catch (error) {
    log.error('Failed to save config:', error);
    let failureMessage;
    if (configPersisted) {
      failureMessage = t(
        'Settings were saved, but one or more changes could not be applied immediately.'
      );
    } else if (syncFileCopiedThisSave) {
      failureMessage = t(
        'Settings could not be saved. No configuration changes were applied, but the sync file was already copied to the new folder.'
      );
    } else {
      failureMessage = t('Settings could not be saved. No configuration changes were applied.');
    }
    showToast(failureMessage, 'error', 4000);
  }
}

// The list is rebuilt after every change, so each control says what it is for. A dialog opened
// from one hands focus back to its replacement, and a deleted row lands on the Add button.
function alertFocusKey(kind, entityId = '') {
  return entityId ? `alert-${kind}:${entityId}` : `alert-${kind}`;
}

function findAlertControl(entityId = '') {
  return (
    (entityId && findFocusKey(alertFocusKey('edit', entityId))) ||
    findFocusKey(alertFocusKey('add'))
  );
}

function renderAlertsListInline() {
  try {
    const alertsList = document.getElementById('inline-alerts-list');
    if (!alertsList) return;

    alertsList.innerHTML = '';

    const alerts = state.CONFIG.entityAlerts?.alerts || {};
    // utils already imported at top

    // Show message if no alerts
    if (Object.keys(alerts).length === 0) {
      const noAlertsMsg = document.createElement('div');
      noAlertsMsg.className = 'no-alerts-message';
      noAlertsMsg.textContent = t(
        'No alerts configured yet. Click the button below to add your first alert.'
      );
      alertsList.appendChild(noAlertsMsg);
    }

    // Add existing alerts. An entity that is not in the state map (Home Assistant has not sent it
    // yet, or it was deleted or renamed) keeps its row under its id, so the alert can still be
    // edited and removed; skipping it made the alerts look lost.
    Object.keys(alerts).forEach((entityId) => {
      const entity = state.STATES[entityId];

      const alertItem = document.createElement('div');
      alertItem.className = 'alert-item';

      const alertConfig = alerts[entityId];
      // "Above 25 °C", not "Above threshold 25": the reading's unit says what the number is, and a
      // template lets a language put the number where its grammar wants it.
      const unit = entity?.attributes?.unit_of_measurement;
      const thresholdText = `${formatNumber(Number(alertConfig.threshold))}${unit ? ` ${unit}` : ''}`;
      let alertType = alertConfig.onNumericThreshold
        ? alertConfig.comparison === 'below'
          ? t('Below {{value}}', { value: thresholdText })
          : t('Above {{value}}', { value: thresholdText })
        : alertConfig.onStateChange
          ? t('State change')
          : t('Specific state');
      if (alertConfig.onSpecificState) {
        alertType = t('When state is {{state}}', { state: alertConfig.targetState });
      }

      alertItem.innerHTML = `
        <div class="alert-item-info">
          <span class="alert-icon">${entity ? entityIconMarkup(entity) : lineIconMarkup('bell')}</span>
          <div class="alert-details">
            <span class="alert-name">${utils.escapeHtml(entity ? utils.getEntityDisplayName(entity) : entityId)}</span>
            <span class="alert-type">${utils.escapeHtml(alertType)}</span>
            ${entity ? '' : `<span class="alert-missing">${utils.escapeHtml(t('Unavailable'))}</span>`}
          </div>
        </div>
        <div class="alert-actions">
          <button class="btn btn-sm btn-secondary edit-alert" data-entity="${utils.escapeHtmlAttribute(entityId)}" data-focus-key="${utils.escapeHtmlAttribute(alertFocusKey('edit', entityId))}">${utils.escapeHtml(t('Edit'))}</button>
          <button class="btn btn-sm btn-danger remove-alert" data-entity="${utils.escapeHtmlAttribute(entityId)}" data-focus-key="${utils.escapeHtmlAttribute(alertFocusKey('remove', entityId))}">${utils.escapeHtml(t('Remove'))}</button>
        </div>
      `;

      // Edit and Remove repeat for every alert; the group is named for the entity they are about.
      const alertActions = alertItem.querySelector('.alert-actions');
      alertActions.setAttribute('role', 'group');
      alertActions.setAttribute('aria-label', alertItem.querySelector('.alert-name').textContent);

      alertsList.appendChild(alertItem);
    });

    // Add "Add new alert" button
    const addButton = document.createElement('button');
    addButton.className = 'btn btn-secondary btn-block add-alert-btn';
    addButton.textContent = `+ ${t('Add new alert')}`;
    addButton.dataset.focusKey = alertFocusKey('add');
    addButton.onclick = () => openAlertEntityPicker();
    addButton.style.marginTop = '10px';
    alertsList.appendChild(addButton);

    // Wire up event handlers
    alertsList.querySelectorAll('.edit-alert').forEach((btn) => {
      btn.onclick = () => openAlertConfigModal(btn.dataset.entity);
    });

    alertsList.querySelectorAll('.remove-alert').forEach((btn) => {
      btn.onclick = () => removeAlert(btn.dataset.entity);
    });
  } catch (error) {
    log.error('Error rendering alerts list inline:', error);
  }
}

function openAlertEntityPicker() {
  try {
    populateAlertEntityPicker();
    const modal = document.getElementById('alert-entity-picker-modal');
    if (modal) {
      openDialog(modal, {
        initialFocus: '#alert-entity-picker-search',
        focusFallback: () => findAlertControl(),
      });
    }
  } catch (error) {
    log.error('Error opening alert entity picker:', error);
  }
}

function closeAlertEntityPicker() {
  try {
    const modal = document.getElementById('alert-entity-picker-modal');
    if (modal) {
      void closeDialog(modal);
    }
  } catch (error) {
    log.error('Error closing alert entity picker:', error);
  }
}

// A home can have thousands of entities, and the picker used to build a row (with an icon) for
// every one on each open and score every row on each keystroke. It now draws the first rows of a
// ranked list, and works out the list again a moment after the typing pauses.
const ALERT_PICKER_MAX_ROWS = 100;
const ALERT_PICKER_SEARCH_DELAY_MS = 150;

function populateAlertEntityPicker() {
  try {
    const list = document.getElementById('alert-entity-picker-list');
    if (!list) return;

    // utils already imported at top
    const alerts = state.CONFIG.entityAlerts?.alerts || {};
    // The name is worked out once per entity: sorting by it asked for it at every comparison.
    const candidates = Object.values(state.STATES || {})
      .filter((e) => !e.entity_id.startsWith('sun.') && !e.entity_id.startsWith('zone.'))
      .map((entity) => ({ entity, name: utils.getEntityDisplayName(entity) }))
      .sort((a, b) => compareNames(a.name, b.name));

    list.innerHTML = '';

    if (candidates.length === 0) {
      list.innerHTML = `<div class="no-entities-message">${utils.escapeHtml(
        t("No entities available. Make sure you're connected to Home Assistant.")
      )}</div>`;
      return;
    }

    const buildRow = ({ entity, name }) => {
      const entityId = entity.entity_id;
      const hasAlert = !!alerts[entityId];

      const item = document.createElement('div');
      item.className = 'entity-item';

      item.innerHTML = `
        <div class="entity-item-main">
          <span class="entity-icon">${entityIconMarkup(entity)}</span>
          <div class="entity-item-info">
            <span class="entity-name">${utils.escapeHtml(name)}</span>
            <span class="entity-id">${utils.escapeHtml(entityId)}</span>
          </div>
        </div>
        <button class="entity-selector-btn ${hasAlert ? 'edit' : 'add'}" data-entity-id="${utils.escapeHtmlAttribute(entityId)}">
          ${utils.escapeHtml(hasAlert ? t('Edit alert') : t('Add alert'))}
        </button>
      `;

      item
        .querySelector('.entity-selector-btn')
        .setAttribute(
          'aria-label',
          hasAlert ? t('Edit alert for {{name}}', { name }) : t('Add alert for {{name}}', { name })
        );

      // Add badge if alert exists
      if (hasAlert) {
        const badge = document.createElement('span');
        badge.className = 'alert-badge';
        setLineIconContent(badge, 'bell');
        badge.title = t('Alert configured');
        badge.style.marginLeft = '8px';
        badge.style.fontSize = '14px';
        item.querySelector('.entity-item-main').appendChild(badge);
      }

      item.querySelector('.entity-selector-btn').onclick = () => {
        closeAlertEntityPicker();
        openAlertConfigModal(entityId);
      };
      return item;
    };

    // The best matches first: a name score and an id score added, as the picker always did.
    const matchesFor = (query) => {
      if (!query) return candidates;
      return candidates
        .map((candidate) => ({
          candidate,
          score:
            utils.getSearchScore(candidate.name, query) +
            utils.getSearchScore(candidate.entity.entity_id, query),
        }))
        .filter(({ score }) => score > 0)
        .sort((a, b) => b.score - a.score)
        .map(({ candidate }) => candidate);
    };

    const renderRows = (query) => {
      const matches = matchesFor(query);
      list.replaceChildren(...matches.slice(0, ALERT_PICKER_MAX_ROWS).map(buildRow));
      // A search with no hits says so inside the list, once.
      if (!matches.length) {
        const empty = document.createElement('p');
        empty.className = 'entity-selector-empty';
        empty.setAttribute('role', 'status');
        empty.textContent = t('No matching entities found.');
        list.appendChild(empty);
      } else if (matches.length > ALERT_PICKER_MAX_ROWS) {
        const more = document.createElement('p');
        more.className = 'entity-selector-empty';
        more.setAttribute('role', 'status');
        more.textContent = t(
          'Showing the first {{shown}} of {{count}} entities. Type to narrow them.',
          {
            shown: formatNumber(ALERT_PICKER_MAX_ROWS),
            count: formatNumber(matches.length),
          }
        );
        list.appendChild(more);
      }
    };

    renderRows('');

    // Search functionality
    const searchInput = document.getElementById('alert-entity-picker-search');
    if (searchInput) {
      searchInput.oninput = null;
      searchInput.value = '';
      let searchTimer = null;
      searchInput.oninput = (e) => {
        // getSearchScore folds accents and case itself, so the query goes in as typed.
        const query = e.target.value.trim();
        clearTimeout(searchTimer);
        searchTimer = setTimeout(() => renderRows(query), ALERT_PICKER_SEARCH_DELAY_MS);
      };
    }
  } catch (error) {
    log.error('Error populating alert entity picker:', error);
  }
}

let currentAlertEntity = null;

// What the three numbers of the alert dialog mean, under each: the unit and current reading of the
// threshold (filled when the dialog opens), and what 0 does for the duration and the cooldown. The
// help sits in the field's label so it takes the field's grid cell; the input is named by the label's
// own text and described by the help.
function addAlertFieldHelp(group) {
  [
    ['alert-threshold', ''],
    ['alert-duration', 'Only notify if the condition lasts this long. 0 = immediately.'],
    ['alert-cooldown', 'Wait at least this long between notifications. 0 = no limit.'],
  ].forEach(([fieldId, helpKey]) => {
    const input = group.querySelector(`#${fieldId}`);
    const label = input?.closest('label');
    const labelText = label?.querySelector('[data-alert-label-key]');
    if (!input || !label || !labelText) return;
    labelText.id = `${fieldId}-label`;
    const help = document.createElement('span');
    help.id = `${fieldId}-help`;
    help.className = 'form-help alert-field-help';
    if (helpKey) help.dataset.alertLabelKey = helpKey;
    label.append(help);
    input.setAttribute('aria-labelledby', labelText.id);
    input.setAttribute('aria-describedby', help.id);
  });
}

// "Currently 21.5 °C" under the threshold, so the number to type is in the unit of the reading it is
// compared with. A sensor that has no number to show leaves it empty.
function updateAlertThresholdHelp(modal, entity) {
  const help = modal.querySelector('#alert-threshold-help');
  if (!help) return;
  const reading = entity ? Number.parseFloat(entity.state) : Number.NaN;
  const unit = entity?.attributes?.unit_of_measurement;
  help.textContent = Number.isFinite(reading)
    ? t('Currently {{value}}', { value: `${formatNumber(reading)}${unit ? ` ${unit}` : ''}` })
    : unit
      ? t('In {{unit}}', { unit })
      : '';
}

function relabelAlertAdvancedOptions(root = document) {
  root.querySelectorAll('#alert-advanced-options [data-alert-label-key]').forEach((node) => {
    node.textContent = t(node.dataset.alertLabelKey);
  });
}

// The states this entity really has, so "Specific State" is picked rather than guessed. The field
// still takes anything: a state that is not listed (a zone name) is a legitimate target.
function populateAlertStateSuggestions(entity) {
  const list = document.getElementById('target-state-options');
  if (!list) return;
  list.replaceChildren(
    ...getAlertStateSuggestions(entity).map((suggestion) => new Option(suggestion, suggestion))
  );
}

const ALERT_TIME_STEP_MINUTES = 15;

// Quiet hours are picked from a list of times written in the Time format setting and the app's
// language. A native time field follows the browser's own locale instead, so a German dialog
// showed "10:00 PM". The stored value stays "HH:MM"; a value off the 15-minute grid (set by an
// older version) is kept as an extra choice rather than silently rounded.
function populateAlertTimeOptions(select, value) {
  const times = [];
  for (let minutes = 0; minutes < 24 * 60; minutes += ALERT_TIME_STEP_MINUTES) {
    times.push(minutes);
  }
  const match = /^(\d{2}):(\d{2})$/.exec(value || '');
  const selected = match ? Number(match[1]) * 60 + Number(match[2]) : null;
  if (selected !== null && !times.includes(selected)) {
    times.push(selected);
    times.sort((a, b) => a - b);
  }
  select.replaceChildren(
    ...times.map((minutes) => {
      const hours = Math.floor(minutes / 60);
      const rest = minutes % 60;
      const pad = (number) => String(number).padStart(2, '0');
      return new Option(
        formatClockTime(new Date(1970, 0, 1, hours, rest)),
        `${pad(hours)}:${pad(rest)}`
      );
    })
  );
  select.value = match ? value : '';
}

function openAlertConfigModal(entityId) {
  try {
    if (!entityId) {
      log.error('openAlertConfigModal requires entityId');
      return;
    }

    const modal = document.getElementById('alert-config-modal');
    if (!modal) return;

    currentAlertEntity = entityId;

    const stateChangeRadio = modal.querySelector('input[value="state-change"]');
    const specificStateRadio = modal.querySelector('input[value="specific-state"]');
    const specificStateGroup = document.getElementById('specific-state-group');
    const targetStateInput = document.getElementById('target-state-input');
    const title = document.getElementById('alert-config-title');

    const alertConfig = state.CONFIG.entityAlerts?.alerts[entityId];
    if (!modal.querySelector('#alert-advanced-options')) {
      const group = document.createElement('div');
      group.id = 'alert-advanced-options';
      group.className = 'alert-advanced-options form-group';
      const addField = (id, labelText, type, options = []) => {
        const label = document.createElement('label');
        // The group is built once and reused, so the English keys stay on the nodes and
        // relabelAlertAdvancedOptions() translates them each time the dialog opens.
        const text = document.createElement('span');
        text.dataset.alertLabelKey = labelText;
        label.append(text);
        if (type === 'checkbox') label.className = 'workflow-checkbox';
        const input = document.createElement(
          type === 'select' || type === 'time' ? 'select' : 'input'
        );
        input.id = id;
        if (type !== 'checkbox') input.className = 'form-control';
        if (type === 'select')
          options.forEach(([value, key]) => {
            const option = new Option(key, value);
            option.dataset.alertLabelKey = key;
            input.add(option);
          });
        // A time field is a select that populateAlertTimeOptions fills each time the dialog opens.
        else if (type !== 'time') input.type = type;
        if (type === 'number') {
          input.min = '0';
          input.max = '86400';
          input.step = '1';
        }
        label.append(input);
        group.append(label);
        return input;
      };
      addField('alert-condition', 'Condition', 'select', [
        ['state-change', 'State change'],
        ['specific-state', 'Specific state'],
        ['above', 'Above threshold'],
        ['below', 'Below threshold'],
      ]);
      const threshold = addField('alert-threshold', 'Threshold', 'number');
      threshold.removeAttribute('min');
      threshold.removeAttribute('max');
      threshold.step = 'any';
      group.insertBefore(specificStateGroup, threshold.parentElement);
      addField('alert-duration', 'Condition duration in seconds', 'number');
      addField('alert-cooldown', 'Notification cooldown in seconds', 'number');
      // A State Change rule tells about an entity going offline unless this is off. The help
      // names the built-in wait and limit (UNAVAILABLE_GRACE_MS and UNAVAILABLE_NOTIFY_INTERVAL_MS
      // in alert-rules.js) so a flapping device's silence is not a surprise.
      const unavailableRow = document.createElement('div');
      unavailableRow.className = 'alert-switch-row';
      const unavailableText = document.createElement('div');
      unavailableText.className = 'alert-switch-text';
      const unavailableLabel = document.createElement('label');
      unavailableLabel.htmlFor = 'alert-notify-unavailable';
      const unavailableLabelText = document.createElement('span');
      unavailableLabelText.dataset.alertLabelKey = 'Notify when unavailable or unknown';
      unavailableLabel.append(unavailableLabelText);
      const unavailableHelp = document.createElement('div');
      unavailableHelp.id = 'alert-notify-unavailable-help';
      unavailableHelp.className = 'form-help';
      unavailableHelp.dataset.alertLabelKey =
        'Waits 30 seconds first, and tells you at most once every 15 minutes per device.';
      unavailableText.append(unavailableLabel, unavailableHelp);
      const unavailableSwitch = document.createElement('input');
      unavailableSwitch.type = 'checkbox';
      unavailableSwitch.id = 'alert-notify-unavailable';
      unavailableSwitch.setAttribute('aria-describedby', unavailableHelp.id);
      unavailableRow.append(unavailableText, unavailableSwitch);
      group.append(unavailableRow);
      addField('alert-quiet-enabled', 'Enable quiet hours', 'checkbox');
      addField('alert-quiet-start', 'Quiet hours start, local time', 'time');
      addField('alert-quiet-end', 'Quiet hours end, local time', 'time');
      addAlertFieldHelp(group);
      modal.querySelector('.modal-body').append(group);
    }
    relabelAlertAdvancedOptions(modal);
    modal.querySelector('.alert-type-options').parentElement.hidden = true;
    const condition = modal.querySelector('#alert-condition');
    condition.value = alertConfig?.onNumericThreshold
      ? alertConfig.comparison || 'above'
      : alertConfig?.onSpecificState
        ? 'specific-state'
        : 'state-change';
    targetStateInput.value = alertConfig?.targetState || '';
    populateAlertStateSuggestions(state.STATES[entityId]);
    modal.querySelector('#alert-threshold').value = alertConfig?.threshold ?? '';
    updateAlertThresholdHelp(modal, state.STATES[entityId]);
    modal.querySelector('#alert-duration').value = alertConfig?.durationSeconds || 0;
    modal.querySelector('#alert-cooldown').value = alertConfig?.cooldownSeconds || 0;
    // On unless the rule says otherwise, which is also how a rule saved before the switch reads.
    modal.querySelector('#alert-notify-unavailable').checked =
      alertConfig?.notifyOnUnavailable !== false;
    modal.querySelector('#alert-quiet-enabled').checked = !!alertConfig?.quietHours?.enabled;
    populateAlertTimeOptions(
      modal.querySelector('#alert-quiet-start'),
      alertConfig?.quietHours?.start || '22:00'
    );
    populateAlertTimeOptions(
      modal.querySelector('#alert-quiet-end'),
      alertConfig?.quietHours?.end || '07:00'
    );
    const syncCondition = () => {
      stateChangeRadio.checked = condition.value === 'state-change';
      specificStateRadio.checked = condition.value === 'specific-state';
      specificStateGroup.style.display = specificStateRadio.checked ? 'block' : 'none';
      modal.querySelector('#alert-threshold').parentElement.hidden = !['above', 'below'].includes(
        condition.value
      );
      // Only a State Change rule tells about an entity going offline unasked. A rule for the state
      // "unavailable" is that request itself, and a threshold rule ignores a missing reading.
      modal.querySelector('.alert-switch-row').hidden = condition.value !== 'state-change';
    };
    condition.onchange = syncCondition;
    const quietEnabled = modal.querySelector('#alert-quiet-enabled');
    const syncQuietHours = () => {
      ['#alert-quiet-start', '#alert-quiet-end'].forEach((id) => {
        modal.querySelector(id).disabled = !quietEnabled.checked;
      });
    };
    quietEnabled.onchange = syncQuietHours;
    const entity = state.STATES[entityId];
    if (title)
      title.textContent = t('Configure alert – {{name}}', {
        name: entity ? utils.getEntityDisplayName(entity) : entityId,
      });

    // The hidden legacy radios are kept in sync by the condition select so the save path
    // can keep reading them.
    syncCondition();
    syncQuietHours();
    openDialog(modal, {
      initialFocus: '#alert-condition',
      focusFallback: () => findAlertControl(entityId),
      // Enter in a single-line field saves the alert, as it does in the confirmation dialog.
      onEnter: (event) => {
        if (event.target.matches?.('input')) void saveAlert();
      },
      dismiss: closeAlertConfigModal,
    });
  } catch (error) {
    log.error('Error opening alert config modal:', error);
  }
}

function closeAlertConfigModal() {
  try {
    const modal = document.getElementById('alert-config-modal');
    if (modal) {
      currentAlertEntity = null;
      void closeDialog(modal);
    }
  } catch (error) {
    log.error('Error closing alert config modal:', error);
  }
}

async function saveAlert() {
  try {
    if (!currentAlertEntity) return;

    const modal = document.getElementById('alert-config-modal');
    const stateChangeRadio = modal.querySelector('input[value="state-change"]');
    const specificStateRadio = modal.querySelector('input[value="specific-state"]');
    const targetStateInput = document.getElementById('target-state-input');

    const alertConfig = {
      onStateChange: stateChangeRadio?.checked || false,
      onSpecificState: specificStateRadio?.checked || false,
      // Saved the way Home Assistant spells it ("Not home" becomes not_home), which is also how
      // the alert list then reads and what the rule compares against.
      targetState: normalizeAlertState(targetStateInput?.value),
    };
    const condition = modal.querySelector('#alert-condition')?.value;
    alertConfig.onNumericThreshold = ['above', 'below'].includes(condition);
    alertConfig.comparison = condition === 'below' ? 'below' : 'above';
    const threshold = modal.querySelector('#alert-threshold');
    if (
      alertConfig.onNumericThreshold &&
      (!threshold.value.trim() || !Number.isFinite(Number(threshold.value)))
    ) {
      showToast(t('Enter a valid numeric threshold.'), 'error');
      threshold.focus();
      return;
    }
    if (alertConfig.onSpecificState && !alertConfig.targetState) {
      showToast(t('Enter a target state.'), 'error');
      targetStateInput.focus();
      return;
    }
    alertConfig.threshold = alertConfig.onNumericThreshold ? Number(threshold.value) : null;
    for (const [field, id] of [
      ['durationSeconds', 'alert-duration'],
      ['cooldownSeconds', 'alert-cooldown'],
    ]) {
      const input = modal.querySelector(`#${id}`);
      const seconds = input.value.trim() === '' ? 0 : Number(input.value);
      // Same toast-and-focus feedback as the other fields instead of a native validation bubble.
      if (!Number.isInteger(seconds) || seconds < 0 || seconds > 86400) {
        showToast(t('Enter a whole number of seconds from 0 to 86400.'), 'error');
        input.focus();
        return;
      }
      alertConfig[field] = seconds;
    }
    if (alertConfig.onStateChange) {
      alertConfig.notifyOnUnavailable = modal.querySelector('#alert-notify-unavailable').checked;
    }
    alertConfig.quietHours = {
      enabled: modal.querySelector('#alert-quiet-enabled').checked,
      start: modal.querySelector('#alert-quiet-start').value,
      end: modal.querySelector('#alert-quiet-end').value,
    };
    if (
      alertConfig.quietHours.enabled &&
      (!alertConfig.quietHours.start ||
        !alertConfig.quietHours.end ||
        alertConfig.quietHours.start === alertConfig.quietHours.end)
    ) {
      showToast(t('Choose different start and end times for quiet hours.'), 'error');
      return;
    }
    const nextConfig = JSON.parse(JSON.stringify(state.CONFIG));
    nextConfig.entityAlerts = nextConfig.entityAlerts || { enabled: false, alerts: {} };
    nextConfig.entityAlerts.alerts[currentAlertEntity] = alertConfig;
    const updatedConfig = await window.electronAPI.updateConfig(nextConfig);
    applyPersistedConfigResponse(updatedConfig);

    closeAlertConfigModal();
    renderAlertsListInline();

    // showToast already imported at top
    showToast(t('Alert saved successfully'), 'success', 2000);
  } catch (error) {
    log.error('Error saving alert:', error);
    // showToast already imported at top
    showToast(t('Error saving alert'), 'error', 2000);
  }
}

async function removeAlert(entityId) {
  try {
    const entity = state.STATES[entityId];
    // utils already imported at top
    // showToast, showConfirm, utils already imported at top
    const entityName = entity ? utils.getEntityDisplayName(entity) : entityId;

    const confirmed = await showConfirm(
      t('Remove Alert'),
      t('Remove alert for "{{name}}"?', { name: entityName }),
      {
        confirmText: t('Remove'),
        confirmClass: 'btn-danger',
        // The Remove button is gone once the row is, so focus goes to the Add button instead.
        focusFallback: () => findAlertControl(),
      }
    );

    if (!confirmed) return;

    if (state.CONFIG.entityAlerts?.alerts[entityId]) {
      const nextConfig = JSON.parse(JSON.stringify(state.CONFIG));
      delete nextConfig.entityAlerts.alerts[entityId];
      const updatedConfig = await window.electronAPI.updateConfig(nextConfig);
      applyPersistedConfigResponse(updatedConfig);
      renderAlertsListInline();

      showToast(t('Alert removed'), 'success', 2000);
    }
  } catch (error) {
    log.error('Error removing alert:', error);
    // showToast already imported at top
    showToast(t('Error removing alert'), 'error', 2000);
  }
}

// The media tile's player is a native select: it brings the keyboard model and the screen reader
// roles for free, and it looks like the other selects on the page. `selected` is the value to show,
// which is the saved player unless a choice not saved yet has to survive a rebuild.
function populateMediaPlayerSelect(selected = state.CONFIG.primaryMediaPlayer || '') {
  try {
    const select = document.getElementById('primary-media-player');
    if (!select) {
      console.warn('Media player select not found');
      return;
    }

    const mediaPlayers = Object.values(state.STATES || {})
      .filter((entity) => entity.entity_id.startsWith('media_player.'))
      .sort((a, b) => {
        return compareNames(utils.getEntityDisplayName(a), utils.getEntityDisplayName(b));
      });

    const options = [
      new Option(t('None (Hide Media Tile)'), ''),
      ...mediaPlayers.map(
        (entity) => new Option(utils.getEntityDisplayName(entity), entity.entity_id)
      ),
    ];
    // A player Home Assistant is not reporting right now (offline, renamed) keeps its place;
    // without it the select would show "None" and saving would quietly clear the choice. That
    // goes for the saved player and for one picked in this form that has gone since.
    const saved = state.CONFIG.primaryMediaPlayer || '';
    for (const entityId of new Set([saved, selected])) {
      if (entityId && !mediaPlayers.some((entity) => entity.entity_id === entityId)) {
        options.push(new Option(t('Unavailable: {{entityId}}', { entityId }), entityId));
      }
    }
    select.replaceChildren(...options);
    select.value = selected;
    // With no media player to pick and none chosen or saved, the select has nothing to offer but
    // "None"; say so instead of leaving a control that looks usable.
    const nothingToPick = mediaPlayers.length === 0 && !saved && !selected;
    select.disabled = nothingToPick;
    const emptyNote = document.getElementById('primary-media-player-empty');
    emptyNote?.classList.toggle('hidden', !nothingToPick);
    setDescribedByLine(select, emptyNote, nothingToPick);

    // Bound once: the select outlives each opening of Settings.
    if (!select.dataset.bound) {
      select.addEventListener('change', () => markSettingsTouched('primaryMediaPlayer'));
      select.dataset.bound = 'true';
    }
  } catch (error) {
    log.error('Error populating media player select:', error);
  }
}

// Popup Hotkey Management
let isCapturingPopupHotkey = false;
let popupHotkeyAvailable = null;

// What the main process last said about this desktop (Hyprland, desktop-layer mode), for the notes
// that depend on it.
let desktopIntegrationInfo = null;

// The notes under the popup and entity hotkeys say changes apply at once. On Hyprland a shortcut
// is only a name that Hyprland has to be told to run, so they point at the bindings panel instead.
function renderHotkeyImmediateNotes() {
  const onHyprland = desktopIntegrationInfo?.hyprland === true;
  const notes = [
    ['popup-hotkey-immediate-note', 'Popup hotkey changes take effect immediately.'],
    ['entity-hotkey-immediate-note', 'Entity hotkey changes take effect immediately.'],
  ];
  for (const [id, immediate] of notes) {
    const note = document.getElementById(id);
    if (note) {
      note.textContent = onHyprland
        ? t('After setting a hotkey, copy its binding from the Hyprland shortcuts panel above.')
        : t(immediate);
    }
  }
}

// A desktop layer sits under every window, so a key to bring it forward matters on any
// compositor; only Hyprland can list the binds, the others get the command to bind.
function renderLayerModeGuidance() {
  const layerMode = desktopIntegrationInfo?.layerMode === true;
  const onHyprland = desktopIntegrationInfo?.hyprland === true;
  const layerNote = document.getElementById('desktop-integration-layer-note');
  if (layerNote) layerNote.hidden = !layerMode;
  const toggleNote = document.getElementById('layer-toggle-note');
  if (toggleNote) toggleNote.hidden = !(layerMode && !onHyprland);
}

// "Frosted glass" blurs the window on Windows and macOS. On Linux Chromium cannot see what is behind
// a window, so it only tints it, and a compositor that blurs on its own (Hyprland, with the toggle
// below) does the rest.
function renderFrostedGlassHelp(blurActive = false) {
  const help = document.getElementById('frosted-glass-help');
  if (!help) return;
  const tintOnly = window.electronAPI?.platform === 'linux' && !blurActive;
  help.textContent = tintOnly
    ? t('Tints the window so it stays readable while transparent. Blur depends on your desktop.')
    : t("Blurs what's behind the widget to keep it readable while transparent.");
}

// The popup hotkey card's labels depend on the platform's shortcut backend, and on whether there is
// one at all: with no way to register a global shortcut the card says so, in place of help about a
// feature that does nothing here.
function renderPopupHotkeyModeText() {
  const usesLinuxShortcutBackend = window.electronAPI?.platform === 'linux';
  const modeLabel = document.getElementById('popup-hotkey-mode-label');
  const helpText = document.getElementById('popup-hotkey-help-text');
  const platformNotice = document.getElementById('popup-hotkey-platform-notice');
  // Hold-to-show and hide-on-release need key-release events, which the desktop shortcut service
  // does not send. The row is not shown disabled with nothing to say why; the notice above says it.
  const hideOnReleaseRow = document
    .getElementById('popup-hotkey-hide-on-release')
    ?.closest('.form-group');
  if (hideOnReleaseRow) hideOnReleaseRow.hidden = usesLinuxShortcutBackend;
  const toggleHelp = document.getElementById('popup-hotkey-toggle-mode-help');
  if (toggleHelp) {
    toggleHelp.textContent = usesLinuxShortcutBackend
      ? t('Press once to show the window and again to hide it.')
      : t('Press once to show the window and again to hide it, instead of holding.');
  }
  renderHotkeyImmediateNotes();
  if (modeLabel) modeLabel.textContent = t('Popup hotkey');
  if (popupHotkeyAvailable === false) {
    if (helpText) helpText.hidden = true;
    if (platformNotice) {
      platformNotice.hidden = false;
      platformNotice.textContent = t('Popup hotkey feature is not available on this platform.');
    }
    return;
  }
  if (helpText) {
    helpText.hidden = false;
    helpText.textContent = usesLinuxShortcutBackend
      ? t('Configure a global hotkey that brings the window to front when pressed.')
      : t(
          'Configure a global hotkey that brings the window to front while held down. When released, the window returns to normal z-order.'
        );
  }
  if (platformNotice) {
    platformNotice.hidden = !usesLinuxShortcutBackend;
    platformNotice.textContent = usesLinuxShortcutBackend
      ? t(
          'Hold-to-show and hide-on-release are unavailable on Linux; press-to-toggle remains supported.'
        )
      : '';
  }
}

// Labels, placeholders and notices of the popup hotkey card in the active language, without
// touching the recorded hotkey or an in-progress capture.
function relocalizePopupHotkeyText() {
  renderPopupHotkeyModeText();
  const input = document.getElementById('popup-hotkey-input');
  const setBtn = document.getElementById('popup-hotkey-set-btn');
  if (setBtn) setBtn.textContent = isCapturingPopupHotkey ? t('Stop recording') : t('Set hotkey');
  if (input) {
    if (isCapturingPopupHotkey) {
      input.value = t('Press keys... (Esc to cancel)');
    } else if (popupHotkeyAvailable === false) {
      input.placeholder = t('Not available on this platform');
    } else {
      input.placeholder = formatHotkey(state.CONFIG?.popupHotkey) || t('Not set');
    }
  }
}

async function initializePopupHotkey() {
  try {
    // Check if popup hotkey feature is available
    const isAvailable = await window.electronAPI.isPopupHotkeyAvailable();
    const usesLinuxShortcutBackend = window.electronAPI.platform === 'linux';

    const input = document.getElementById('popup-hotkey-input');
    const setBtn = document.getElementById('popup-hotkey-set-btn');
    const clearBtn = document.getElementById('popup-hotkey-clear-btn');
    await refreshDesktopIntegration();

    if (!input || !setBtn || !clearBtn) return;
    const currentHotkey = state.CONFIG.popupHotkey || '';
    // JS owns this label (it reads Cancel while capturing), so it is set here, not by data-i18n.
    if (!isCapturingPopupHotkey) setBtn.textContent = t('Set hotkey');

    if (isAvailable) {
      input.disabled = false;
      input.value = formatHotkey(currentHotkey);
      input.placeholder = formatHotkey(currentHotkey) || t('Not set');
      setBtn.disabled = false;
      // Clear and the suggestions come back too, as they were switched off when the service was
      // not there; a recording that is still going keeps them off.
      setPopupHotkeyControlsRecording(isCapturingPopupHotkey);
      clearBtn.style.display = currentHotkey ? 'inline-block' : 'none';
    }

    popupHotkeyAvailable = isAvailable;
    renderPopupHotkeyModeText();

    // Without a global shortcut service the card is read-only: the field, the recorder, the
    // suggestions and both switches go off together, and the card's notice says why.
    if (!isAvailable) {
      input.disabled = true;
      input.value = '';
      input.placeholder = t('Not available on this platform');
      setBtn.disabled = true;
      clearBtn.disabled = true;
      clearBtn.style.display = 'none';
      document.querySelectorAll('.preset-hotkey-btn').forEach((chip) => {
        chip.disabled = true;
      });
      for (const id of ['popup-hotkey-toggle-mode', 'popup-hotkey-hide-on-release']) {
        const checkbox = document.getElementById(id);
        if (checkbox) checkbox.disabled = true;
        document.getElementById(`${id}-label`)?.classList.add('disabled');
      }
      return;
    }

    // Load current popup hotkey
    if (currentHotkey) {
      input.value = formatHotkey(currentHotkey);
      input.placeholder = formatHotkey(currentHotkey);
      clearBtn.style.display = 'inline-block';
    }

    // Initialize "Toggle mode" checkbox and "Hide on release" checkbox with mutual exclusivity
    const toggleModeCheckbox = document.getElementById('popup-hotkey-toggle-mode');
    const toggleModeLabel = document.getElementById('popup-hotkey-toggle-mode-label');
    const hideOnReleaseCheckbox = document.getElementById('popup-hotkey-hide-on-release');
    const hideOnReleaseLabel = document.getElementById('popup-hotkey-hide-on-release-label');

    // Helper function to update disabled states
    const updateMutualExclusivity = () => {
      if (toggleModeCheckbox && hideOnReleaseCheckbox) {
        if (usesLinuxShortcutBackend) {
          hideOnReleaseCheckbox.disabled = true;
          if (hideOnReleaseLabel) hideOnReleaseLabel.classList.add('disabled');
          toggleModeCheckbox.disabled = false;
          if (toggleModeLabel) toggleModeLabel.classList.remove('disabled');
          return;
        }

        // When toggle mode is enabled, disable hide-on-release
        hideOnReleaseCheckbox.disabled = toggleModeCheckbox.checked;
        if (hideOnReleaseLabel) {
          hideOnReleaseLabel.classList.toggle('disabled', toggleModeCheckbox.checked);
        }

        // When hide-on-release is enabled, disable toggle mode
        toggleModeCheckbox.disabled = hideOnReleaseCheckbox.checked;
        if (toggleModeLabel) {
          toggleModeLabel.classList.toggle('disabled', hideOnReleaseCheckbox.checked);
        }
      }
    };

    if (toggleModeCheckbox) {
      toggleModeCheckbox.checked = !!state.CONFIG.popupHotkeyToggleMode;

      toggleModeCheckbox.onchange = async () => {
        const previousValue = !!state.CONFIG.popupHotkeyToggleMode;
        const requestedValue = !!toggleModeCheckbox.checked;
        let updatePersisted = false;
        const reenable = disableControlsKeepingFocus([toggleModeCheckbox]);

        try {
          const updatedConfig = await window.electronAPI.updateConfig({
            ...state.CONFIG,
            popupHotkeyToggleMode: requestedValue,
          });
          applyPersistedConfigResponse(updatedConfig);
          updatePersisted = true;
          if (state.CONFIG.popupHotkey) {
            const registrationResult = await window.electronAPI.registerPopupHotkey(
              state.CONFIG.popupHotkey
            );
            if (registrationResult?.success !== true) {
              throw new Error(registrationResult?.error || t('Failed to apply popup hotkey mode'));
            }
          }
          toggleModeCheckbox.checked = requestedValue;
          // showToast already imported at top
          showToast(
            requestedValue
              ? t('Toggle mode enabled: tap to show/hide')
              : usesLinuxShortcutBackend
                ? t('Press mode enabled: press to bring the window to front')
                : t('Hold mode enabled: hold to show, release to restore'),
            'success',
            2000
          );
        } catch (error) {
          log.error('Failed to save popup hotkey toggle mode setting:', error);
          if (updatePersisted) {
            try {
              const restoredConfig = await window.electronAPI.updateConfig({
                ...state.CONFIG,
                popupHotkeyToggleMode: previousValue,
              });
              state.setConfig(restoredConfig);
            } catch (rollbackError) {
              log.error('Failed to restore popup hotkey toggle mode:', rollbackError);
            }
          }
          toggleModeCheckbox.checked = previousValue;
          const failureMessage = t('Error: {{error}}', {
            error: error?.message || t('Unknown error'),
          });
          showToast(failureMessage, 'error', 3000);
        } finally {
          reenable();
          updateMutualExclusivity();
        }
      };
    }

    if (hideOnReleaseCheckbox) {
      hideOnReleaseCheckbox.checked = !!state.CONFIG.popupHotkeyHideOnRelease;

      hideOnReleaseCheckbox.onchange = async () => {
        const previousValue = !!state.CONFIG.popupHotkeyHideOnRelease;
        const requestedValue = !!hideOnReleaseCheckbox.checked;
        let updatePersisted = false;
        const reenable = disableControlsKeepingFocus([hideOnReleaseCheckbox]);

        try {
          const updatedConfig = await window.electronAPI.updateConfig({
            ...state.CONFIG,
            popupHotkeyHideOnRelease: requestedValue,
          });
          applyPersistedConfigResponse(updatedConfig);
          updatePersisted = true;
          if (state.CONFIG.popupHotkey) {
            const registrationResult = await window.electronAPI.registerPopupHotkey(
              state.CONFIG.popupHotkey
            );
            if (registrationResult?.success !== true) {
              throw new Error(
                registrationResult?.error || t('Failed to apply popup hotkey behavior')
              );
            }
          }
          hideOnReleaseCheckbox.checked = requestedValue;
          // showToast already imported at top
          showToast(
            requestedValue
              ? t('Window will hide when popup hotkey is released')
              : t('Window will stay visible when popup hotkey is released'),
            'success',
            2000
          );
        } catch (error) {
          log.error('Failed to save popup hotkey setting:', error);
          if (updatePersisted) {
            try {
              const restoredConfig = await window.electronAPI.updateConfig({
                ...state.CONFIG,
                popupHotkeyHideOnRelease: previousValue,
              });
              state.setConfig(restoredConfig);
            } catch (rollbackError) {
              log.error('Failed to restore popup hotkey release behavior:', rollbackError);
            }
          }
          hideOnReleaseCheckbox.checked = previousValue;
          const failureMessage = t('Error: {{error}}', {
            error: error?.message || t('Unknown error'),
          });
          showToast(failureMessage, 'error', 3000);
        } finally {
          reenable();
          updateMutualExclusivity();
        }
      };
    }

    // Set initial mutual exclusivity state
    updateMutualExclusivity();

    // Set hotkey button
    setBtn.onclick = () => {
      if (isCapturingPopupHotkey) {
        stopCapturingPopupHotkey();
        return;
      }
      startCapturingPopupHotkey();
    };

    // Clear button
    clearBtn.onclick = async () => {
      if (isCapturingPopupHotkey) stopCapturingPopupHotkey();
      try {
        const result = await window.electronAPI.unregisterPopupHotkey();
        if (result.success) {
          input.value = '';
          input.placeholder = t('Not set');
          clearBtn.style.display = 'none';
          state.CONFIG.popupHotkey = '';
          // showToast already imported at top
          showToast(t('Popup hotkey cleared'), 'success');
          if (result.warning) {
            showToast(result.warning, 'warning', 4000);
          }
        }
      } catch (error) {
        log.error('Failed to clear popup hotkey:', error);
        // showToast already imported at top
        showToast(t('Failed to clear popup hotkey'), 'error');
      }
    };

    // Preset hotkey buttons
    const presetButtons = document.querySelectorAll('.preset-hotkey-btn');
    presetButtons.forEach((btn) => {
      // The chip says the keys as this platform prints them; the accelerator it registers is the same.
      btn.textContent = formatHotkey(btn.dataset.hotkey);
      btn.onclick = async () => {
        if (isCapturingPopupHotkey) stopCapturingPopupHotkey();
        const hotkey = btn.dataset.hotkey;
        try {
          const result = await window.electronAPI.registerPopupHotkey(hotkey);
          if (result.success) {
            input.value = formatHotkey(hotkey);
            input.placeholder = formatHotkey(hotkey);
            clearBtn.style.display = 'inline-block';
            state.CONFIG.popupHotkey = hotkey;
            // showToast already imported at top
            await refreshDesktopIntegration();
            showToast(
              result.binding?.requiresCompositorBinding
                ? t(
                    'Shortcut target registered. Copy its binding from the Hyprland shortcuts panel.'
                  )
                : t('Popup hotkey set to {{hotkey}}', { hotkey: formatHotkey(hotkey) }),
              'success'
            );
          } else {
            // showToast already imported at top
            showToast(describeHotkeyFailure(result, t('Failed to set popup hotkey')), 'error');
            if (result.conflictEntityId) flashHotkeyRow(result.conflictEntityId);
          }
        } catch (error) {
          log.error('Failed to set preset hotkey:', error);
          // showToast already imported at top
          showToast(t('Failed to set popup hotkey'), 'error');
        }
      };
    });
  } catch (error) {
    log.error('Error initializing popup hotkey:', error);
  }
}

// The suggestion chips and Clear sit beside the recorder; while it listens they would only be a
// way to abandon it halfway.
function setPopupHotkeyControlsRecording(recording) {
  document.querySelectorAll('.preset-hotkey-btn, #popup-hotkey-clear-btn').forEach((control) => {
    control.disabled = recording;
  });
  // The field's value is an instruction while it listens, and the stylesheet sets it as text, not
  // as the code a hotkey is set in. The entity rows' fields are marked the same way.
  const field = document.getElementById('popup-hotkey-input');
  if (recording) field?.setAttribute('data-recording', 'true');
  else field?.removeAttribute('data-recording');
}

function startCapturingPopupHotkey() {
  isCapturingPopupHotkey = true;
  const input = document.getElementById('popup-hotkey-input');
  const setBtn = document.getElementById('popup-hotkey-set-btn');

  if (input) {
    input.value = t('Press keys... (Esc to cancel)');
    input.focus();
  }
  if (setBtn) {
    // The footer's Cancel throws away the whole form; this one only ends the recording.
    setBtn.textContent = t('Stop recording');
    setBtn.classList.add('btn-danger');
    setBtn.classList.remove('btn-secondary');
  }
  setPopupHotkeyControlsRecording(true);

  // Capture keydown event
  const captureHandler = async (e) => {
    // Escape ends the recording, as the hint says, instead of being offered as the hotkey (and
    // turned into an error toast); Tab leaves the field, which ends it too.
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      stopCapturingPopupHotkey();
      return;
    }
    if (e.key === 'Tab') {
      stopCapturingPopupHotkey({ keepFocus: true });
      return;
    }
    e.preventDefault();
    e.stopPropagation();

    // The same recorder as the entity hotkeys use: by physical key, so Space, the arrows and
    // Shift+digit work and the key is the one the keyboard hook sees. A modifier alone waits for
    // its key; a key with nothing but Shift is only a capital letter, and says what to add.
    const recorded = recordKeyEvent(e);
    if (!recorded.complete) {
      if (input && recorded.needsModifier) input.value = describeRecording(recorded);
      return;
    }
    const hotkey = recorded.accelerator;

    try {
      const result = await window.electronAPI.registerPopupHotkey(hotkey);
      if (result.success) {
        if (input) {
          input.value = formatHotkey(hotkey);
          input.placeholder = formatHotkey(hotkey);
        }
        const clearBtn = document.getElementById('popup-hotkey-clear-btn');
        if (clearBtn) clearBtn.style.display = 'inline-block';
        state.CONFIG.popupHotkey = hotkey;
        // showToast already imported at top
        await refreshDesktopIntegration();
        showToast(
          result.binding?.requiresCompositorBinding
            ? t('Shortcut target registered. Copy its binding from the Hyprland shortcuts panel.')
            : t('Popup hotkey set to {{hotkey}}', { hotkey: formatHotkey(hotkey) }),
          'success'
        );
      } else {
        // showToast already imported at top
        showToast(describeHotkeyFailure(result, t('Failed to set popup hotkey')), 'error');
        if (result.conflictEntityId) flashHotkeyRow(result.conflictEntityId);
        if (input) input.value = formatHotkey(state.CONFIG.popupHotkey);
      }
    } catch (error) {
      log.error('Failed to register popup hotkey:', error);
      // showToast already imported at top
      showToast(t('Failed to register popup hotkey'), 'error');
      if (input) input.value = formatHotkey(state.CONFIG.popupHotkey);
    }

    stopCapturingPopupHotkey();
  };

  // Clicking elsewhere, or switching to another window, leaves nothing to record into. Pressing the
  // recorder's own button blurs the field first and is left to that button's click, which ends the
  // recording; abandoning here would let the click start a new one.
  const abandon = (event) => {
    if (event?.relatedTarget === setBtn) return;
    stopCapturingPopupHotkey({ keepFocus: true });
  };

  // Store handlers for cleanup
  input._captureHandler = captureHandler;
  input._captureAbandon = abandon;
  document.addEventListener('keydown', captureHandler, true);
  input?.addEventListener('blur', abandon);
  window.addEventListener('blur', abandon);
}

function stopCapturingPopupHotkey({ keepFocus = false } = {}) {
  isCapturingPopupHotkey = false;
  const input = document.getElementById('popup-hotkey-input');
  const setBtn = document.getElementById('popup-hotkey-set-btn');

  if (input) {
    // The blur listeners go first: blurring the field below would otherwise stop the recording again.
    if (input._captureAbandon) {
      input.removeEventListener('blur', input._captureAbandon);
      window.removeEventListener('blur', input._captureAbandon);
      input._captureAbandon = null;
    }
    input.value = formatHotkey(state.CONFIG.popupHotkey);
    input.placeholder = formatHotkey(state.CONFIG.popupHotkey) || t('Not set');
    if (!keepFocus) input.blur();

    if (input._captureHandler) {
      document.removeEventListener('keydown', input._captureHandler, true);
      input._captureHandler = null;
    }
  }

  if (setBtn) {
    setBtn.textContent = t('Set hotkey');
    setBtn.classList.remove('btn-danger');
    setBtn.classList.add('btn-secondary');
  }
  setPopupHotkeyControlsRecording(false);
}

function handleProfileSyncStatusUpdate(status) {
  updateProfileSyncStatusUi(status);
}

/**
 * Says what is wrong with a sync field, under it, and puts the cursor there: on the field, or on the
 * Choose Folder button for the read-only path.
 */
function showProfileSyncFieldError(field, message) {
  showFieldError(field, message, {
    anchor: field?.closest(
      '.profile-sync-file-row, .profile-sync-passphrase-row, .profile-sync-passphrase-confirm'
    ),
    focusTarget:
      field?.id === 'profile-sync-folder-path'
        ? document.getElementById('profile-sync-choose-folder')
        : null,
  });
}

/** Shows General with the access token field open and focused: where a lost token is entered. */
function revealHomeAssistantToken() {
  document.querySelector('.modal-tabs .tab-link[data-tab="general"]')?.click();
  const legacySettings = document.getElementById('legacy-ha-token-settings');
  if (legacySettings) legacySettings.open = true;
  const token = document.getElementById('ha-token');
  if (!token || token.disabled) return;
  // From the top of the Home Assistant group, so the line saying why is in view above the field.
  (token.closest('.settings-group') || token).scrollIntoView?.({ block: 'start' });
  token.focus({ preventScroll: true });
}

/** Shows the Advanced page with the update status in view: where a tray check reports. */
function revealUpdateStatus() {
  document.querySelector('.modal-tabs .tab-link[data-tab="advanced"]')?.click();
  document.getElementById('update-status')?.scrollIntoView?.({ block: 'center' });
}

/** Brings the person to the part of Advanced that asks something of them. */
function showProfileSyncAttention() {
  document.querySelector('.modal-tabs .tab-link[data-tab="advanced"]')?.click();
  const waitingForChoice = !!profileSyncStatusCache?.needsResolution;
  document
    .getElementById(waitingForChoice ? 'profile-sync-resolution' : 'profile-sync-status')
    ?.scrollIntoView?.({ block: 'center' });
  if (waitingForChoice) {
    showToast(t('Waiting for your choice below.'), 'warning', 5000);
  }
}

export {
  revealUpdateStatus,
  updateOpacityReadout,
  syncSegmentedIndicators,
  refreshRestoredDashboardSettings,
  openSettings,
  closeSettings,
  saveSettings,
  previewWindowEffects,
  refreshDesktopBlur,
  refreshDesktopIntegrationIfHotkeysChanged,
  reapplySettingsPreviews,
  syncWeatherEffectsAvailability,
  renderAlertsListInline,
  openAlertEntityPicker,
  closeAlertEntityPicker,
  openAlertConfigModal,
  closeAlertConfigModal,
  saveAlert,
  initializePopupHotkey,
  refreshPersonalizationSectionHeights,
  handleProfileSyncStatusUpdate,
  profileSyncNeedsAttention,
  waitForLanguagePackRefresh,
  refreshHomeAssistantAuthStatus,
  revealHomeAssistantToken,
};

// Hyprland blurs the widget only while its own blur is on, and Omarchy ships with it off. Say so
// under Frosted glass, and on Omarchy offer to turn it on for the widget alone.
async function refreshDesktopBlur() {
  const row = document.getElementById('desktop-blur-row');
  if (!row || !window.electronAPI?.getDesktopBlurStatus) return;
  const status = await window.electronAPI.getDesktopBlurStatus();
  renderDesktopBlur(status);
}

function renderDesktopBlur(status) {
  const row = document.getElementById('desktop-blur-row');
  const text = document.getElementById('desktop-blur-status');
  const button = document.getElementById('desktop-blur-toggle');
  if (!row || !text || !button) return;
  const frosted = !!document.getElementById('frosted-glass')?.checked;
  const needsRetry = status?.enabled && status.widgetRuleFailed;
  renderFrostedGlassHelp(!!status?.enabled && !needsRetry);
  // A blur this app turned on can be turned off with Frosted glass off, and only from here.
  row.hidden =
    !status?.supported ||
    (!frosted && !(status.enabled && status.managed)) ||
    (status.enabled && !status.managed && !needsRetry);
  if (row.hidden) return;
  if (needsRetry) {
    text.textContent = t("Could not change Hyprland's blur.");
  } else if (status.enabled) {
    text.textContent = t('Hyprland blurs the widget. Other windows are not blurred.');
  } else if (status.canManage) {
    text.textContent = t("Hyprland's blur is off, so the widget is tinted but not frosted.");
  } else {
    text.textContent = t(
      "Hyprland's blur is off, so the widget is tinted but not frosted. Set decoration:blur:enabled in your Hyprland config to frost it."
    );
  }
  button.classList.toggle('hidden', !status.canManage);
  button.textContent =
    status.enabled && !needsRetry
      ? t('Turn off blur for the widget')
      : t('Turn on blur for the widget');
  button.onclick = async () => {
    const reenable = disableControlsKeepingFocus([button]);
    try {
      const result = await window.electronAPI.setDesktopBlur(!status.enabled || needsRetry);
      if (!result?.success) showToast(t("Could not change Hyprland's blur."), 'error');
      renderDesktopBlur(result?.status || status);
    } finally {
      reenable();
    }
  };
}

// Whether this Linux session has no unlocked keyring, as last read from main.
let secureStorageUnavailable = false;
// The reasons a token has to be entered again that come down to having no unlocked keyring.
const KEYRING_TOKEN_REASONS = new Set(['encryption_unavailable', 'not_persisted']);

/**
 * Says so in General while this Linux session has no unlocked keyring. The toast that reports
 * it is gone within seconds, and the condition stays: the token and the sync passphrase
 * cannot be remembered until a keyring is running.
 */
async function refreshSecureStorageNotice() {
  let unavailable = false;
  try {
    const info = await window.electronAPI?.getDesktopIntegration?.();
    unavailable = info?.platform === 'linux' && info.secureStorageAvailable === false;
  } catch (error) {
    log.warn('Failed to read the secure storage status:', error);
  }
  secureStorageUnavailable = unavailable;
  updateSecureStorageNotice();
}

// While the token has to be entered again for want of a keyring, the line above the field already
// says so and what to do; the notice under it would say the same again in another colour.
function updateSecureStorageNotice() {
  const notice = document.getElementById('secure-storage-notice');
  if (!notice) return;
  const connection = getLiveConnectionState();
  const saidAbove = !!connection.needsToken && KEYRING_TOKEN_REASONS.has(connection.tokenReason);
  notice.classList.toggle('hidden', !secureStorageUnavailable || saidAbove);
}

/** The name to show for the shortcut the desktop last delivered, whose id is an internal one. */
function describeShortcutId(id) {
  if (typeof id !== 'string' || !id) return '';
  if (id === 'popup-toggle') return t('Popup hotkey');
  const entityId = id.startsWith('entity.') ? id.slice('entity.'.length) : id;
  const entity = state.STATES?.[entityId];
  return entity ? utils.getEntityDisplayName(entity) : entityId;
}

// The bindings shown when the last hotkey change was made, to tell when the panel is out of date.
let desktopIntegrationHotkeys = null;

function getHotkeySignature(config) {
  return JSON.stringify([
    config?.popupHotkey || '',
    !!config?.popupHotkeyToggleMode,
    !!config?.popupHotkeyHideOnRelease,
    config?.globalHotkeys || null,
  ]);
}

/**
 * Bring the Hyprland bindings up to date after a hotkey changed somewhere else (a popup hotkey
 * cleared, an entity hotkey assigned or removed, the entity hotkeys switch). Every one of them
 * reaches here as a config change, which is why this is looked for in the config rather than at
 * each place that changes one. Does nothing until the panel has been shown once.
 */
async function refreshDesktopIntegrationIfHotkeysChanged(config = state.CONFIG) {
  const signature = getHotkeySignature(config);
  if (desktopIntegrationHotkeys === null || signature === desktopIntegrationHotkeys) return;
  if (!isSettingsModalOpen()) return;
  await refreshDesktopIntegration();
}

// What to change in a Hyprland bind that still names the retired app id, in the user's language. Main
// logs the same advice in English; it sends the parts so the panel can say it in the right words.
function describeLegacyDesktopActivation(activation, appId) {
  if (!activation?.legacyAppId || !activation.id || !appId) return activation?.notice || '';
  const values = {
    shortcut: describeShortcutId(activation.id),
    legacyAppId: activation.legacyAppId,
    target: `${appId}:${activation.id}`,
    binding: activation.binding,
  };
  return activation.binding
    ? t(
        'Hyprland sent "{{shortcut}}" through the old app name "{{legacyAppId}}". That still works for now; change the bind to "{{target}}", for example: {{binding}}',
        values
      )
    : t(
        'Hyprland sent "{{shortcut}}" through the old app name "{{legacyAppId}}". That still works for now; change the bind to "{{target}}".',
        values
      );
}

async function refreshDesktopIntegration({ announce = false } = {}) {
  void refreshDesktopBlur().catch((error) => {
    log.error('Failed to read Hyprland blur status:', error);
  });
  const panel = document.getElementById('desktop-integration');
  if (!panel || !window.electronAPI.getDesktopIntegration) return;
  const output = document.getElementById('desktop-bindings');
  const copyButton = document.getElementById('desktop-bindings-copy');
  // Keep the controls usable even before Hyprland detection succeeds.
  copyButton.onclick = async () => {
    // Nothing is set, so there is nothing to copy; copying an empty string would only clear the
    // clipboard and report success.
    if (!output.value) return;
    if (await copyTextToClipboard(output.value)) {
      showToast(t('Bindings copied'), 'success');
      return;
    }
    output.focus();
    output.select();
    showToast(t('Select and copy the bindings manually.'), 'info');
  };
  document.getElementById('desktop-integration-refresh').onclick = () =>
    refreshDesktopIntegration({ announce: true });
  const info = await window.electronAPI.getDesktopIntegration();
  desktopIntegrationInfo = info;
  desktopIntegrationHotkeys = getHotkeySignature(state.CONFIG);
  renderHotkeyImmediateNotes();
  renderLayerModeGuidance();
  panel.hidden = !info?.hyprland;
  if (!info?.hyprland) return;
  const format = document.getElementById('desktop-bindings-format');
  const renderBindings = () => {
    const field = format?.value === 'hyprlang' ? 'legacyBinding' : 'binding';
    const lines = (info.shortcuts || []).map((shortcut) => shortcut[field]).filter(Boolean);
    output.value = lines.join('\n');
    output.placeholder = t(
      'Set a popup hotkey or turn on entity hotkeys below, then copy the bindings here.'
    );
    copyButton.disabled = lines.length === 0;
    // Every bind is visible without scrolling, up to ten lines.
    output.rows = Math.min(10, Math.max(4, lines.length));
  };
  renderBindings();
  if (format) format.onchange = renderBindings;
  const activationTime = Date.parse(info.lastActivation?.at || '');
  const status = document.getElementById('desktop-integration-status');
  if (!(info.shortcuts || []).length) {
    status.textContent = t('No shortcuts are set yet.');
  } else {
    status.textContent = info.lastActivation
      ? t('Last shortcut received: {{id}} at {{time}}', {
          id: describeShortcutId(info.lastActivation.id),
          time: Number.isNaN(activationTime)
            ? info.lastActivation.at
            : formatClockDateTime(activationTime),
        })
      : t('No shortcut received yet. Press a configured shortcut, then refresh.');
  }
  // A bind still written for a retired app id keeps working, but only the
  // panel and the log say so; the replacement is the binding shown above.
  const legacy = document.getElementById('desktop-integration-legacy');
  if (legacy) {
    legacy.hidden = !info.legacyActivation;
    legacy.textContent = describeLegacyDesktopActivation(info.legacyActivation, info.appId);
  }
  // The button gives no other sign that it did anything when nothing has changed.
  if (announce) showToast(t('Shortcut status updated.'), 'info', 2000);
}

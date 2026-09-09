/**
 * Tray entity icons: pure helpers shared by the main process and the renderer.
 *
 * `config.trayEntities` is a map keyed by entity ID. Each configured entity gets its own system
 * tray icon whose image is a short text label rendered by the renderer (the only process with a
 * canvas and the live state map). Main owns the Tray objects and only accepts sanitized payloads.
 */

// Kept dependency-free on purpose: this module is shared by main (CommonJS) and the Vite-built
// renderer, and source-level `require` calls are not rewritten by the renderer bundle.
const ENTITY_ID_PATTERN = /^[a-z0-9_]+\.[a-z0-9_]+$/i;

function normalizeEntityId(value) {
  const trimmed = typeof value === 'string' ? value.trim() : '';
  return ENTITY_ID_PATTERN.test(trimmed) ? trimmed : '';
}

const TRAY_ENTITY_TOOLTIP_MAX_LENGTH = 127;
const TRAY_ENTITY_LABEL_MAX_LENGTH = 12;
const TRAY_ENTITY_TITLE_MAX_LENGTH = 64;
const TRAY_ENTITY_SHORT_NAME_MAX_LENGTH = 12;
const TRAY_ENTITY_COLORS = Object.freeze(['auto', 'blue', 'cyan', 'purple', 'pink', 'orange']);
const TRAY_ICON_MAX_REPRESENTATIONS = 4;
const TRAY_ICON_MAX_DATA_URL_LENGTH = 96 * 1024;
const TRAY_ICON_SCALE_FACTORS = Object.freeze([1, 1.5, 2, 3]);
const TRAY_ICON_FONT_SIZES = Object.freeze([12, 11, 10, 9, 8, 7]);
const TRAY_ICON_MIN_PREFERRED_FONT_SIZE = 9;
const PNG_DATA_URL_PREFIX = 'data:image/png;base64,';
const BASE64_PATTERN = /^[A-Za-z0-9+/]+={0,2}$/;

const ON_LIKE_STATES = new Set([
  'on',
  'home',
  'open',
  'opening',
  'unlocked',
  'unlocking',
  'playing',
  'buffering',
  'cleaning',
  'returning',
  'heat',
  'cool',
  'heat_cool',
  'auto',
  'dry',
  'fan_only',
  'active',
  'triggered',
  'arming',
  'armed_home',
  'armed_away',
  'armed_night',
  'armed_vacation',
  'armed_custom_bypass',
  'charging',
  'running',
]);

const OFF_LIKE_STATES = new Set([
  'off',
  'not_home',
  'closed',
  'closing',
  'locked',
  'locking',
  'idle',
  'docked',
  'standby',
  'paused',
  'disarmed',
  'clear',
  'stopped',
]);

const STATE_LABELS = Object.freeze({
  on: 'ON',
  off: 'OFF',
  home: 'HOME',
  not_home: 'AWAY',
  open: 'OPEN',
  opening: 'OPNG',
  closed: 'CLSD',
  closing: 'CLSG',
  stopped: 'STOP',
  locked: 'LOCK',
  unlocked: 'UNLK',
  locking: 'LCKG',
  unlocking: 'UNLK',
  jammed: 'JAM',
  playing: 'PLAY',
  paused: 'PAUS',
  idle: 'IDLE',
  standby: 'STBY',
  buffering: 'BUFR',
  active: 'ACTV',
  cleaning: 'CLN',
  docked: 'DOCK',
  returning: 'RTN',
  error: 'ERR',
  heat: 'HEAT',
  cool: 'COOL',
  heat_cool: 'AUTO',
  auto: 'AUTO',
  dry: 'DRY',
  fan_only: 'FAN',
  disarmed: 'OFF',
  armed_home: 'ARMH',
  armed_away: 'ARMA',
  armed_night: 'ARMN',
  armed_vacation: 'ARMV',
  armed_custom_bypass: 'ARMB',
  arming: 'ARMG',
  pending: 'PEND',
  triggered: 'ALRM',
  charging: 'CHRG',
  discharging: 'DSCH',
  not_charging: 'IDLE',
  full: 'FULL',
  running: 'RUN',
  unavailable: 'N/A',
  unknown: '?',
});

// Binary sensors read better with device-class words than a bare ON/OFF: [on, off].
const BINARY_SENSOR_LABELS = Object.freeze({
  door: ['OPEN', 'CLSD'],
  window: ['OPEN', 'CLSD'],
  garage_door: ['OPEN', 'CLSD'],
  opening: ['OPEN', 'CLSD'],
  lock: ['UNLK', 'LOCK'],
  motion: ['MOVE', 'CLR'],
  moving: ['MOVE', 'STIL'],
  occupancy: ['OCC', 'CLR'],
  presence: ['HOME', 'AWAY'],
  moisture: ['WET', 'DRY'],
  smoke: ['SMOK', 'CLR'],
  gas: ['GAS', 'CLR'],
  carbon_monoxide: ['CO', 'CLR'],
  problem: ['PROB', 'OK'],
  safety: ['UNSF', 'SAFE'],
  battery: ['LOW', 'OK'],
  battery_charging: ['CHRG', 'IDLE'],
  connectivity: ['CONN', 'DISC'],
  plug: ['PLUG', 'UNPL'],
  power: ['ON', 'OFF'],
  running: ['RUN', 'IDLE'],
  cold: ['COLD', 'OK'],
  heat: ['HOT', 'OK'],
  light: ['LIT', 'DARK'],
  sound: ['SND', 'CLR'],
  vibration: ['VIB', 'CLR'],
  tamper: ['TAMP', 'OK'],
  update: ['UPD', 'OK'],
});

const STATE_NAMES = Object.freeze({
  on: 'On',
  off: 'Off',
  home: 'Home',
  not_home: 'Away',
  open: 'Open',
  opening: 'Opening',
  closed: 'Closed',
  closing: 'Closing',
  stopped: 'Stopped',
  locked: 'Locked',
  unlocked: 'Unlocked',
  locking: 'Locking',
  unlocking: 'Unlocking',
  jammed: 'Jammed',
  playing: 'Playing',
  paused: 'Paused',
  idle: 'Idle',
  standby: 'Standby',
  buffering: 'Buffering',
  active: 'Active',
  cleaning: 'Cleaning',
  docked: 'Docked',
  returning: 'Returning',
  error: 'Error',
  heat: 'Heating',
  cool: 'Cooling',
  heat_cool: 'Automatic',
  auto: 'Automatic',
  dry: 'Drying',
  fan_only: 'Fan',
  disarmed: 'Disarmed',
  armed_home: 'Armed at home',
  armed_away: 'Armed away',
  armed_night: 'Armed at night',
  armed_vacation: 'Armed on vacation',
  armed_custom_bypass: 'Armed',
  arming: 'Arming',
  pending: 'Pending',
  triggered: 'Alarm',
  charging: 'Charging',
  discharging: 'Discharging',
  not_charging: 'Not charging',
  full: 'Full',
  running: 'Running',
  unavailable: 'Unavailable',
  unknown: 'Unknown',
});
const COMPACT_STATE_NAMES = new Set([
  'On',
  'Off',
  'Open',
  'Closed',
  'Opening',
  'Closing',
  'Locked',
  'Unlocked',
  'Locking',
  'Unlocking',
  'Armed at home',
  'Armed away',
  'Armed at night',
  'Armed on vacation',
  'Arming',
  'Disarmed',
]);

const BINARY_STATE_NAMES = Object.freeze({
  door: ['Open', 'Closed'],
  window: ['Open', 'Closed'],
  garage_door: ['Open', 'Closed'],
  opening: ['Open', 'Closed'],
  lock: ['Unlocked', 'Locked'],
  motion: ['Motion', 'Clear'],
  moving: ['Moving', 'Still'],
  occupancy: ['Occupied', 'Clear'],
  presence: ['Home', 'Away'],
  moisture: ['Wet', 'Dry'],
  smoke: ['Smoke', 'Clear'],
  gas: ['Gas', 'Clear'],
  carbon_monoxide: ['Carbon monoxide', 'Clear'],
  problem: ['Problem', 'OK'],
  safety: ['Unsafe', 'Safe'],
  battery: ['Low', 'OK'],
  battery_charging: ['Charging', 'Idle'],
  connectivity: ['Connected', 'Disconnected'],
  plug: ['Plugged in', 'Unplugged'],
  power: ['On', 'Off'],
  running: ['Running', 'Idle'],
  cold: ['Cold', 'OK'],
  heat: ['Hot', 'OK'],
  light: ['Light', 'Dark'],
  sound: ['Sound', 'Clear'],
  vibration: ['Vibration', 'Clear'],
  tamper: ['Tampered', 'OK'],
  update: ['Update', 'OK'],
});

function normalizeTrayEntityOptions(value) {
  const source = isPlainObject(value) ? value : {};
  const result = {};
  const label = truncateText(
    sanitizeTooltipText(source.label || ''),
    TRAY_ENTITY_SHORT_NAME_MAX_LENGTH
  );
  if (label) result.label = label;
  if (TRAY_ENTITY_COLORS.includes(source.color) && source.color !== 'auto')
    result.color = source.color;
  return result;
}

function isPlainObject(value) {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function getTrayIconSizeForPlatform(platform) {
  return platform === 'win32' ? 16 : 22;
}

/**
 * Normalize the persisted tray entity map. Unknown shapes collapse to `{}`; entity IDs are
 * normalized and per-entity options are limited to a short name and a supported color.
 */
function normalizeTrayEntitiesConfig(value) {
  const source = isPlainObject(value) ? value : {};
  const next = {};
  Object.entries(source).forEach(([entityId, options]) => {
    const normalizedEntityId = normalizeEntityId(entityId);
    if (!normalizedEntityId) return;
    next[normalizedEntityId] = normalizeTrayEntityOptions(options);
  });
  return next;
}

function getTrayEntityIds(config) {
  return Object.keys(normalizeTrayEntitiesConfig(config?.trayEntities));
}

function isTrayEntity(config, entityId) {
  const normalizedEntityId = normalizeEntityId(entityId);
  if (!normalizedEntityId || !isPlainObject(config?.trayEntities)) return false;
  return Object.prototype.hasOwnProperty.call(config.trayEntities, normalizedEntityId);
}

function toFiniteNumber(value) {
  if (value === null || value === undefined || value === '') return null;
  const parsed = typeof value === 'number' ? value : Number(String(value).trim());
  return Number.isFinite(parsed) ? parsed : null;
}

function getDomain(entityId) {
  return typeof entityId === 'string' ? entityId.split('.')[0] : '';
}

function trimDecimals(text) {
  return text.includes('.') ? text.replace(/0+$/, '').replace(/\.$/, '') : text;
}

function formatFixed(value, decimals) {
  return trimDecimals(value.toFixed(decimals));
}

function shortUnitSuffix(unit) {
  if (typeof unit !== 'string') return '';
  const trimmed = unit.trim();
  if (!trimmed) return '';
  if (trimmed === '%') return '%';
  if (trimmed.startsWith('°')) return '°';
  return trimmed.length <= 3 ? trimmed : '';
}

/**
 * Candidate labels for a number, most informative first. The renderer picks the first candidate
 * that fits the tray icon at a readable font size.
 */
function buildNumericLabelCandidates(value, unit = '') {
  const suffix = shortUnitSuffix(unit);
  const magnitude = Math.abs(value);
  const candidates = [];
  const push = (text) => {
    if (text && !candidates.includes(text)) candidates.push(text);
  };
  const pushWithUnit = (text) => {
    if (suffix) push(`${text}${suffix}`);
    push(text);
  };
  // Compact "1.2k"/"2.5M" forms only take a one-character unit ("1.2kW"); "2.5MkWh" is noise.
  const pushCompact = (text) => {
    if (suffix.length === 1) push(`${text}${suffix}`);
    push(text);
  };

  if (magnitude < 100) pushWithUnit(formatFixed(value, 1));
  pushWithUnit(String(Math.round(value)));
  if (magnitude >= 1e6) {
    pushCompact(`${formatFixed(value / 1e6, 1)}M`);
    pushCompact(`${formatFixed(value / 1e6, 0)}M`);
  } else if (magnitude >= 1e3) {
    pushCompact(`${formatFixed(value / 1e3, 1)}k`);
    pushCompact(`${formatFixed(value / 1e3, 0)}k`);
  }
  return candidates;
}

function splitGraphemes(text) {
  if (typeof Intl.Segmenter === 'function') {
    return Array.from(
      new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(text),
      (part) => part.segment
    );
  }
  return Array.from(text);
}

function buildTextLabelCandidates(text) {
  const compact = String(text ?? '')
    .replace(/_/g, ' ')
    .trim()
    .toUpperCase();
  if (!compact) return ['?'];
  const collapsed = compact.replace(/\s+/g, '');
  const candidates = [];
  [12, 4, 3, 2].forEach((length) => {
    const candidate = splitGraphemes(collapsed).slice(0, length).join('');
    if (candidate && !candidates.includes(candidate)) candidates.push(candidate);
  });
  return candidates;
}

function buildStateLabelCandidates(state) {
  const key = typeof state === 'string' ? state.trim().toLowerCase() : '';
  if (STATE_LABELS[key]) return [STATE_LABELS[key]];
  return buildTextLabelCandidates(key);
}

function buildTimerLabelCandidates(remainingSeconds) {
  const seconds = Math.max(0, Math.round(remainingSeconds));
  const pad = (value) => String(value).padStart(2, '0');
  if (seconds >= 3600) {
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    return [`${hours}:${pad(minutes)}`, `${hours}h`];
  }
  if (seconds >= 60) {
    const minutes = Math.floor(seconds / 60);
    return [`${minutes}:${pad(seconds % 60)}`, `${minutes}m`];
  }
  return [`${seconds}s`];
}

function resolveAccent(state, { numeric = false } = {}) {
  const key = typeof state === 'string' ? state.trim().toLowerCase() : '';
  if (key === 'unavailable' || key === 'unknown' || key === '') return 'unavailable';
  if (numeric) return 'neutral';
  if (ON_LIKE_STATES.has(key)) return 'on';
  if (OFF_LIKE_STATES.has(key)) return 'off';
  return 'neutral';
}

function truncateText(text, maxLength) {
  const characters = Array.from(String(text ?? ''));
  if (characters.length <= maxLength) return characters.join('');
  return `${characters.slice(0, Math.max(0, maxLength - 1)).join('')}…`;
}

function sanitizeTooltipText(text) {
  return String(text ?? '')
    .replace(/\p{Cc}/gu, ' ')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

/**
 * Build the tray label candidates, tooltip, and accent for an entity.
 *
 * @param {object} entity Home Assistant state object (may be a stub for missing entities).
 * @param {object} [options]
 * @param {string} [options.displayName] Friendly name to use in the tooltip.
 * @param {string} [options.displayState] Human-readable state for the tooltip.
 * @param {number|null} [options.timerRemainingSeconds] Remaining seconds for timers.
 * @returns {{entityId: string, candidates: string[], tooltip: string, accent: string}}
 */
function buildTrayEntityPresentation(entity, options = {}) {
  const entityId = typeof entity?.entity_id === 'string' ? entity.entity_id : '';
  const domain = getDomain(entityId);
  const attributes = isPlainObject(entity?.attributes) ? entity.attributes : {};
  const rawState = typeof entity?.state === 'string' ? entity.state.trim() : entity?.state;
  const stateKey = typeof rawState === 'string' ? rawState.toLowerCase() : '';
  const displayName =
    typeof options.displayName === 'string' && options.displayName.trim()
      ? options.displayName.trim()
      : attributes.friendly_name || entityId || 'Entity';
  const unit =
    typeof attributes.unit_of_measurement === 'string' ? attributes.unit_of_measurement : '';

  const translate = typeof options.translate === 'function' ? options.translate : null;
  let valueText = '';
  const localizedCandidates = (key) => {
    valueText = translate(key);
    const compactKey = `Tray: ${key}`;
    const compact = COMPACT_STATE_NAMES.has(key) ? translate(compactKey) : compactKey;
    return compact !== compactKey ? [compact] : buildTextLabelCandidates(valueText);
  };
  const stateCandidates = (key) => {
    if (!translate) return buildStateLabelCandidates(key);
    return localizedCandidates(STATE_NAMES[key] || String(key || '?').replace(/_/g, ' '));
  };
  const numericCandidates = (value, numericUnit) => {
    const labels = buildNumericLabelCandidates(value, numericUnit);
    if (!translate) return labels;
    const formatter = new Intl.NumberFormat(options.locale || 'en', { maximumFractionDigits: 1 });
    valueText = `${formatter.format(value)}${numericUnit ? ` ${numericUnit}` : ''}`;
    // Keep compact bitmaps ungrouped; use the locale's decimal separator.
    const decimal =
      formatter.formatToParts(1.1).find((part) => part.type === 'decimal')?.value || '.';
    return labels.map((label) => label.replace('.', decimal));
  };
  let candidates = null;
  let accent = resolveAccent(stateKey);

  if (!entity || stateKey === 'unavailable' || stateKey === 'unknown' || rawState == null) {
    candidates = [stateKey === 'unknown' ? '?' : translate ? '!' : 'N/A'];
    accent = 'unavailable';
    valueText = translate ? translate(stateKey === 'unknown' ? 'Unknown' : 'Unavailable') : '';
  } else if (domain === 'timer') {
    if (stateKey === 'active') {
      const remaining = toFiniteNumber(options.timerRemainingSeconds);
      candidates = remaining !== null ? buildTimerLabelCandidates(remaining) : ['ACTV'];
      valueText =
        remaining !== null
          ? buildTimerLabelCandidates(remaining)[0]
          : translate?.('Active') || 'ACTV';
      accent = 'on';
    } else {
      candidates = stateCandidates(stateKey);
      accent = 'off';
    }
  } else if (domain === 'climate' || domain === 'water_heater') {
    const temperature =
      toFiniteNumber(attributes.current_temperature) ?? toFiniteNumber(attributes.temperature);
    if (temperature !== null) {
      candidates = numericCandidates(
        temperature,
        attributes.temperature_unit || options.temperatureUnit || '°'
      );
      const action = typeof attributes.hvac_action === 'string' ? attributes.hvac_action : '';
      accent =
        action === 'heating' || action === 'cooling' || action === 'drying'
          ? 'on'
          : stateKey === 'off'
            ? 'off'
            : 'neutral';
    }
  } else if (domain === 'weather') {
    const temperature = toFiniteNumber(attributes.temperature);
    if (temperature !== null)
      candidates = numericCandidates(
        temperature,
        attributes.temperature_unit || options.temperatureUnit || '°'
      );
  } else if (domain === 'humidifier') {
    const humidity =
      toFiniteNumber(attributes.current_humidity) ?? toFiniteNumber(attributes.humidity);
    if (stateKey === 'on' && humidity !== null) {
      candidates = numericCandidates(humidity, '%');
      accent = 'on';
    }
  } else if (domain === 'light') {
    const brightness = toFiniteNumber(attributes.brightness);
    if (stateKey === 'on' && brightness !== null) {
      candidates = numericCandidates(Math.round((brightness / 255) * 100), '%');
      candidates.push('ON');
    }
  } else if (domain === 'fan') {
    const percentage = toFiniteNumber(attributes.percentage);
    if (stateKey === 'on' && percentage !== null) {
      candidates = numericCandidates(percentage, '%');
      candidates.push('ON');
    }
  } else if (domain === 'cover' || domain === 'valve') {
    const position = toFiniteNumber(attributes.current_position);
    if (position !== null && stateKey !== 'opening' && stateKey !== 'closing') {
      candidates = numericCandidates(position, '%');
      if (!translate) candidates.push(...stateCandidates(stateKey));
    }
  } else if (domain === 'binary_sensor') {
    const deviceClass =
      typeof attributes.device_class === 'string' ? attributes.device_class.toLowerCase() : '';
    const labels = BINARY_SENSOR_LABELS[deviceClass];
    if (labels && (stateKey === 'on' || stateKey === 'off')) {
      const names = BINARY_STATE_NAMES[deviceClass];
      candidates =
        translate && names
          ? localizedCandidates(names[stateKey === 'on' ? 0 : 1])
          : [stateKey === 'on' ? labels[0] : labels[1]];
    }
    accent = stateKey === 'on' ? 'on' : stateKey === 'off' ? 'off' : accent;
  } else if (domain === 'person' || domain === 'device_tracker') {
    if (stateKey !== 'home' && stateKey !== 'not_home') {
      valueText = String(rawState);
      candidates = buildTextLabelCandidates(rawState);
      accent = 'neutral';
    }
  }

  if (!candidates) {
    const numeric = toFiniteNumber(rawState);
    if (numeric !== null) {
      candidates = numericCandidates(numeric, unit);
      accent = 'neutral';
    } else {
      candidates = stateCandidates(stateKey);
    }
  }

  candidates = candidates
    .map((text) => truncateText(text, TRAY_ENTITY_LABEL_MAX_LENGTH))
    .filter((text, index, list) => text && list.indexOf(text) === index);
  if (!candidates.length) candidates = ['?'];

  const displayState =
    typeof options.displayState === 'string' && options.displayState.trim()
      ? options.displayState.trim()
      : valueText ||
        (rawState == null ? 'unavailable' : `${rawState}${unit ? ` ${unit.trim()}` : ''}`);
  const tooltip = truncateText(
    sanitizeTooltipText(`${displayName}: ${displayState}`),
    TRAY_ENTITY_TOOLTIP_MAX_LENGTH
  );

  return { entityId, candidates, tooltip, accent, valueText: valueText || displayState };
}

/**
 * Pick the label and font size for a tray icon.
 *
 * Candidates are ordered most informative first. The first candidate that fits at a readable
 * size wins; otherwise the largest font any candidate fits at is used, and as a last resort the
 * shortest candidate is drawn at the smallest size.
 *
 * @param {string[]} candidates
 * @param {(text: string, fontSize: number) => number} measure Width of `text` at `fontSize`.
 * @param {object} options
 * @param {number} options.maxWidth
 * @param {number[]} [options.fontSizes] Descending font sizes to try.
 * @param {number} [options.minPreferredFontSize]
 * @returns {{text: string, fontSize: number}}
 */
function chooseTrayLabelLayout(candidates, measure, options = {}) {
  const list = (Array.isArray(candidates) ? candidates : []).filter(
    (text) => typeof text === 'string' && text
  );
  const fontSizes =
    Array.isArray(options.fontSizes) && options.fontSizes.length
      ? options.fontSizes
      : TRAY_ICON_FONT_SIZES;
  const minPreferred = Number.isFinite(options.minPreferredFontSize)
    ? options.minPreferredFontSize
    : TRAY_ICON_MIN_PREFERRED_FONT_SIZE;
  const maxWidth = Number.isFinite(options.maxWidth) ? options.maxWidth : 16;
  const smallestFontSize = fontSizes[fontSizes.length - 1];
  if (!list.length) return { text: '?', fontSize: smallestFontSize };

  const fits = (text, fontSize) => {
    try {
      const width = measure(text, fontSize);
      return Number.isFinite(width) && width <= maxWidth;
    } catch {
      return false;
    }
  };

  for (const text of list) {
    for (const fontSize of fontSizes) {
      if (fontSize < minPreferred) break;
      if (fits(text, fontSize)) return { text, fontSize };
    }
  }
  for (const fontSize of fontSizes) {
    if (fontSize >= minPreferred) continue;
    for (const text of list) {
      if (fits(text, fontSize)) return { text, fontSize };
    }
  }
  // Unknown user states can still be long; render an ellipsis instead of clipped text.
  if (fits('…', smallestFontSize)) return { text: '…', fontSize: smallestFontSize };
  const shortest = list.reduce((best, text) => (text.length < best.length ? text : best), list[0]);
  return { text: shortest, fontSize: smallestFontSize };
}

function sanitizeRepresentation(representation) {
  if (!isPlainObject(representation)) return null;
  const scaleFactor = toFiniteNumber(representation.scaleFactor);
  if (scaleFactor === null || scaleFactor < 1 || scaleFactor > 4) return null;
  const dataURL = representation.dataURL;
  if (typeof dataURL !== 'string' || dataURL.length > TRAY_ICON_MAX_DATA_URL_LENGTH) return null;
  if (!dataURL.startsWith(PNG_DATA_URL_PREFIX)) return null;
  const payload = dataURL.slice(PNG_DATA_URL_PREFIX.length);
  if (!payload || !BASE64_PATTERN.test(payload)) return null;
  return { scaleFactor, dataURL };
}

/**
 * Validate a renderer-supplied tray icon payload before it touches a Tray object.
 *
 * @returns {{entityId: string, label: string, tooltip: string, representations: Array<{scaleFactor: number, dataURL: string}>}|null}
 */
function sanitizeTrayEntityIconPayload(payload) {
  if (!isPlainObject(payload)) return null;
  const entityId = normalizeEntityId(payload.entityId);
  if (!entityId) return null;
  const label =
    typeof payload.label === 'string'
      ? truncateText(sanitizeTooltipText(payload.label), TRAY_ENTITY_TITLE_MAX_LENGTH)
      : '';
  const tooltip =
    typeof payload.tooltip === 'string'
      ? truncateText(sanitizeTooltipText(payload.tooltip), TRAY_ENTITY_TOOLTIP_MAX_LENGTH)
      : '';
  const representations = (Array.isArray(payload.representations) ? payload.representations : [])
    .map(sanitizeRepresentation)
    .filter(Boolean)
    .slice(0, TRAY_ICON_MAX_REPRESENTATIONS);
  const activeTimer = entityId.startsWith('timer.') && payload.activeTimer === true;
  return { entityId, label, tooltip, representations, activeTimer };
}

module.exports = {
  TRAY_ENTITY_LABEL_MAX_LENGTH,
  TRAY_ENTITY_SHORT_NAME_MAX_LENGTH,
  TRAY_ENTITY_COLORS,
  STATE_NAMES,
  COMPACT_STATE_NAMES,
  BINARY_STATE_NAMES,
  normalizeTrayEntityOptions,
  TRAY_ENTITY_TOOLTIP_MAX_LENGTH,
  TRAY_ICON_FONT_SIZES,
  TRAY_ICON_MAX_DATA_URL_LENGTH,
  TRAY_ICON_MAX_REPRESENTATIONS,
  TRAY_ICON_MIN_PREFERRED_FONT_SIZE,
  TRAY_ICON_SCALE_FACTORS,
  buildNumericLabelCandidates,
  buildTrayEntityPresentation,
  chooseTrayLabelLayout,
  getTrayEntityIds,
  getTrayIconSizeForPlatform,
  isTrayEntity,
  normalizeEntityId,
  normalizeTrayEntitiesConfig,
  sanitizeTrayEntityIconPayload,
};

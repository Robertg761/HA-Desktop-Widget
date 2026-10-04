import state from './state.js';
import { t } from './i18n.js';
import {
  STATE_NAMES as HA_STATE_NAMES,
  formatBinarySensorState,
  formatDateState,
  formatDuration,
  formatNumberEntityValue,
  formatPercent,
  formatStateName,
  formatTemperature,
  formatTimeOfDayState,
  getClimateTemperature,
  getSensorReading,
  getTemperatureUnit,
  joinUnit,
  normalizeSearchText,
  parseNumericState,
} from './format.js';
import { normalizeWeatherCondition, WEATHER_LABELS } from './weather-icons.js';
import timerSensors from './timer-sensors.cjs';

const { isTimerLikeSensor } = timerSensors;

// HA_STATE_NAMES is the table in ha-state-names.cjs, shared with the tray so every surface uses
// the same words and the same translation keys.

// Names for the entity domains a tile can show. Anything else falls back to the domain id in
// title case, as before. Their translation keys carry a "Domain: " prefix because bare nouns such
// as "Light", "Lock" or "Update" are already keys with other meanings (a theme, verbs).
const HA_DOMAIN_NAMES = Object.freeze({
  ai_task: 'AI Task',
  air_quality: 'Air Quality',
  alarm_control_panel: 'Alarm Control Panel',
  assist_satellite: 'Assist Satellite',
  automation: 'Automation',
  binary_sensor: 'Binary Sensor',
  button: 'Button',
  calendar: 'Calendar',
  camera: 'Camera',
  climate: 'Climate',
  conversation: 'Conversation',
  counter: 'Counter',
  cover: 'Cover',
  date: 'Date',
  datetime: 'Date and Time',
  device_tracker: 'Device Tracker',
  event: 'Event',
  fan: 'Fan',
  geo_location: 'Geolocation',
  group: 'Group',
  humidifier: 'Humidifier',
  image: 'Image',
  image_processing: 'Image Processing',
  infrared: 'Infrared',
  input_boolean: 'Input Boolean',
  input_button: 'Input Button',
  input_datetime: 'Input Date and Time',
  input_number: 'Input Number',
  input_select: 'Input Select',
  input_text: 'Input Text',
  lawn_mower: 'Lawn Mower',
  light: 'Light',
  lock: 'Lock',
  media_player: 'Media Player',
  notify: 'Notifications',
  number: 'Number',
  person: 'Person',
  radio_frequency: 'Radio Frequency',
  remote: 'Remote',
  scene: 'Scene',
  schedule: 'Schedule',
  script: 'Script',
  select: 'Select',
  sensor: 'Sensor',
  siren: 'Siren',
  stt: 'Speech-to-Text',
  sun: 'Sun',
  switch: 'Switch',
  tag: 'Tag',
  text: 'Text',
  time: 'Time',
  timer: 'Timer',
  todo: 'To-do List',
  tts: 'Text-to-Speech',
  update: 'Update',
  vacuum: 'Vacuum',
  valve: 'Valve',
  wake_word: 'Wake Word',
  water_heater: 'Water Heater',
  weather: 'Weather',
  zone: 'Zone',
});

const TIMER_STATUS_NAMES = Object.freeze({
  idle: 'Idle',
  running: 'Running',
  paused: 'Paused',
  finished: 'Finished',
  unavailable: 'Unavailable',
});

/**
 * Localized display name for a raw Home Assistant state ("on" -> "On", "not_home" -> "Away").
 * A state without a name is made readable, and the text of a select or text entity is kept as
 * written (see formatStateName).
 * @param {string} value - The raw state.
 * @param {{domain?: string}} [options]
 * @returns {string} - The label to show.
 */
function getLocalizedStateName(value, options) {
  return formatStateName(value, options);
}

const graphemeSegmenter =
  typeof Intl !== 'undefined' && typeof Intl.Segmenter === 'function'
    ? new Intl.Segmenter(undefined, { granularity: 'grapheme' })
    : null;
const homeAssistantMdiGlyphs = new Map();
// How many stylesheets the last scan walked. A name still missing after a scan stays missing until
// a stylesheet is added, so repeated lookups of an icon the bundled font lacks do not rescan.
let scannedStyleSheetCount = -1;

function normalizeHomeAssistantMdiIcon(icon) {
  if (typeof icon !== 'string') return null;
  const match = /^mdi:([a-z0-9]+(?:-[a-z0-9]+)*)$/.exec(icon.trim().toLowerCase());
  return match?.[1] || null;
}

function decodeCssContent(content) {
  if (typeof content !== 'string') return null;
  let value = content.trim();
  if (!value || value === 'none' || value === 'normal') return null;

  const quote = value[0];
  if ((quote === '"' || quote === "'") && value[value.length - 1] === quote) {
    value = value.slice(1, -1);
  }

  value = value
    .replace(/\\([0-9a-f]{1,6})\s?/gi, (_match, codepoint) =>
      String.fromCodePoint(Number.parseInt(codepoint, 16))
    )
    .replace(/\\(["'\\])/g, '$1');

  return countGraphemes(value) === 1 ? value : null;
}

function collectHomeAssistantMdiGlyphsFromRules(rules) {
  if (!rules) return;

  for (const rule of rules) {
    // Since CSS nesting every style rule also exposes an empty cssRules list, so only a rule with no
    // selector (@media, @supports, ...) is a grouping rule to descend into.
    if (rule.selectorText === undefined && rule.cssRules) {
      collectHomeAssistantMdiGlyphsFromRules(rule.cssRules);
      continue;
    }

    if (!rule.selectorText || !rule.style) continue;
    const glyph = decodeCssContent(rule.style.content);
    if (!glyph) continue;

    rule.selectorText.split(',').forEach((selector) => {
      const match = /^\.mdi-([a-z0-9]+(?:-[a-z0-9]+)*)(?:::?before)$/.exec(selector.trim());
      if (match) homeAssistantMdiGlyphs.set(match[1], glyph);
    });
  }
}

function getHomeAssistantMdiGlyph(icon) {
  const iconName = normalizeHomeAssistantMdiIcon(icon);
  if (!iconName || typeof document === 'undefined') return null;
  if (homeAssistantMdiGlyphs.has(iconName)) return homeAssistantMdiGlyphs.get(iconName);

  const stylesheets = Array.from(document.styleSheets || []);
  if (stylesheets.length !== scannedStyleSheetCount) {
    scannedStyleSheetCount = stylesheets.length;
    for (const stylesheet of stylesheets) {
      try {
        collectHomeAssistantMdiGlyphsFromRules(stylesheet.cssRules);
      } catch {
        // A stylesheet outside the app origin may deny CSSOM access. The bundled MDI sheet does not.
      }
    }
  }

  return homeAssistantMdiGlyphs.get(iconName) || null;
}

function countGraphemes(value) {
  if (!value || typeof value !== 'string') return 0;
  if (graphemeSegmenter) {
    let count = 0;
    for (const _segment of graphemeSegmenter.segment(value)) {
      count += 1;
      if (count > 1) break;
    }
    return count;
  }
  return Array.from(value).length;
}

function normalizeEntityIconGlyph(icon) {
  if (typeof icon !== 'string') return null;
  const trimmed = icon.trim();
  if (!trimmed) return null;
  return countGraphemes(trimmed) === 1 ? trimmed : null;
}

function getEntityDisplayName(entity) {
  try {
    if (!entity) return t('Unknown');

    // Check for custom name first
    const customName = state.CONFIG?.customEntityNames?.[entity.entity_id];
    if (customName) return customName;

    // Fall back to friendly_name or entity_id
    return entity.attributes?.friendly_name || entity.entity_id;
  } catch (error) {
    console.error('Error getting entity display name:', error);
    return t('Unknown');
  }
}

function getEntityTypeDescription(entity) {
  try {
    if (!entity) return t('Unknown');
    const domain = entity.entity_id.split('.')[0];
    if (Object.prototype.hasOwnProperty.call(HA_DOMAIN_NAMES, domain)) {
      const name = HA_DOMAIN_NAMES[domain];
      const key = `Domain: ${name}`;
      const label = t(key);
      // t() hands back the key itself when no catalog has it; English shows the plain name.
      return label === key ? name : label;
    }
    return domain.replace(/_/g, ' ').replace(/\b\w/g, (l) => l.toUpperCase());
  } catch (error) {
    console.error('Error getting entity type description:', error);
    return t('Unknown');
  }
}

function getEntityIcon(entity, options = {}) {
  try {
    if (!entity) return '❓';
    const ignoreCustomIcon = !!options.ignoreCustomIcon;
    if (!ignoreCustomIcon) {
      const customIcon = normalizeEntityIconGlyph(
        state.CONFIG?.customEntityIcons?.[entity.entity_id]
      );
      if (customIcon) return customIcon;
    }

    const domain = entity.entity_id.split('.')[0];
    const entityState = entity.state;
    const attributes = entity.attributes || {};
    const homeAssistantIcon = getHomeAssistantMdiGlyph(attributes.icon);
    if (homeAssistantIcon) return homeAssistantIcon;

    switch (domain) {
      case 'light':
        return '💡';
      case 'switch':
        return entityState === 'on' ? '🔌' : '➖';
      case 'fan':
        return entityState === 'on' ? '💨' : '➖';
      case 'sensor':
        if (attributes.device_class === 'temperature') return '🌡️';
        if (attributes.device_class === 'humidity') return '💧';
        if (attributes.device_class === 'pressure') return '📊';
        if (attributes.device_class === 'illuminance') return '☀️';
        if (attributes.device_class === 'battery') return '🔋';
        if (attributes.device_class === 'power') return '⚡';
        if (attributes.device_class === 'energy') return '⚡';
        if (isTimerLikeSensor(entity)) return '⏲️';
        if (entity.entity_id.includes('battery')) return '🔋';
        if (entity.entity_id.includes('temperature') || entity.entity_id.includes('temp'))
          return '🌡️';
        return '📈';
      case 'binary_sensor':
        if (attributes.device_class === 'motion') return entityState === 'on' ? '🏃' : '🧍';
        if (attributes.device_class === 'door') return entityState === 'on' ? '🚪' : '🚪';
        if (attributes.device_class === 'window') return entityState === 'on' ? '🪟' : '🪟';
        return entityState === 'on' ? '✔️' : '❌';
      case 'climate':
        return '🌡️';
      case 'media_player':
        return '🎵';
      case 'scene':
        return '✨';
      case 'script':
        return '▶️';
      case 'automation':
        return '🤖';
      case 'button':
      case 'input_button':
        return '🔘';
      case 'camera':
        return '📷';
      case 'lock':
        return entityState === 'locked' ? '🔒' : '🔓';
      case 'cover':
        return '🪟';
      case 'person':
        return entityState === 'home' ? '🏠' : '✈️';
      case 'device_tracker':
        return entityState === 'home' ? '🏠' : '✈️';
      case 'alarm_control_panel':
        return '🛡️';
      case 'vacuum':
        return '🧹';
      case 'timer':
        return '⏲️';
      case 'todo':
        return '✅';
      case 'calendar':
        return '📅';
      case 'weather':
        return '🌤️';
      default:
        return '❓';
    }
  } catch (error) {
    console.error('Error getting entity icon:', error);
    return '❓';
  }
}

function getTimerEnd(entity) {
  try {
    const fin = entity.attributes?.finishes_at;
    if (fin) {
      const t = new Date(fin).getTime();
      if (!isNaN(t)) return t;
    }
    const rem = entity.attributes?.remaining;
    if (rem) {
      const parts = rem.split(':').map((n) => parseInt(n, 10));
      if (parts.length === 3 && parts.every((x) => !isNaN(x))) {
        const ms = (parts[0] * 3600 + parts[1] * 60 + parts[2]) * 1000;
        return Date.now() + ms;
      }
    }
    return null;
  } catch (error) {
    console.error('Error getting timer end:', error);
    return null;
  }
}

function getSearchScore(text, query) {
  try {
    const normalizedText = normalizeSearchText(text);
    const normalizedQuery = normalizeSearchText(query);

    // A query made only of punctuation still matches the text that contains it.
    if (!normalizedQuery) {
      const raw = typeof query === 'string' ? query.trim().toLowerCase() : '';
      if (!raw) return 2;
      const haystack = String(text ?? '').toLowerCase();
      if (!haystack.includes(raw)) return 0;
      return haystack.startsWith(raw) ? 2 : 1;
    }

    if (normalizedText.includes(normalizedQuery)) {
      if (normalizedText.startsWith(normalizedQuery)) {
        return 2;
      }
      return 1;
    }
    return 0;
  } catch (error) {
    console.error('Error getting search score:', error);
    return 0;
  }
}

// Entities that run once when pressed and have no lasting state: "Ready" until Home Assistant
// reports otherwise (a never-pressed button is `unknown`, a pressed one holds a timestamp).
const ACTION_STATE_DOMAINS = new Set(['scene', 'button', 'input_button']);

// A date or time entity's state as text; anything that is not one stays as sent.
function formatDateEntityState(entity) {
  const raw = typeof entity.state === 'string' ? entity.state.trim() : '';
  if (entity.entity_id.startsWith('time.') || /^\d{1,2}:\d{2}(:\d{2})?$/.test(raw)) {
    return formatTimeOfDayState(raw);
  }
  return formatDateState(raw, {
    dateOnly: entity.entity_id.startsWith('date.') || entity.attributes?.has_time === false,
  });
}

/**
 * The state of an entity as text, the same on every surface that shows one: tiles, desktop pins,
 * the command palette, dialogs, alerts and the tray tooltips. Numbers and units follow the user's
 * locale and Home Assistant's own unit and precision, binary sensors read by device class, dates
 * read as dates, and the text of select and text entities is never re-cased.
 * @param {object} entity - A Home Assistant state object.
 * @returns {string}
 */
function getEntityDisplayState(entity) {
  try {
    if (!entity) return t('Unknown');

    const domain = entity.entity_id.split('.')[0];
    const attributes = entity.attributes || {};
    const rawState = entity.state;

    // For timers (both timer.* and sensor.* with timer attributes)
    if (domain === 'timer' || isTimerLikeSensor(entity)) {
      return getTimerDisplay(entity);
    }

    if (
      rawState === 'unavailable' ||
      (rawState === 'unknown' && !ACTION_STATE_DOMAINS.has(domain))
    ) {
      return getLocalizedStateName(rawState);
    }

    switch (domain) {
      case 'sensor': {
        const deviceClass = attributes.device_class;
        if (deviceClass === 'timestamp' || deviceClass === 'date') {
          return formatDateState(rawState, { dateOnly: deviceClass === 'date' });
        }
        const reading = getSensorReading(entity);
        if (reading) return reading.text;
        const text = typeof rawState === 'string' ? rawState.trim() : String(rawState ?? '');
        if (deviceClass === 'enum') return getLocalizedStateName(text);
        // A full date-time with no device class is still a moment, not machine text.
        if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(text)) return formatDateState(text);
        return joinUnit(text, attributes.unit_of_measurement);
      }

      case 'binary_sensor':
        return formatBinarySensorState(rawState, attributes.device_class);

      case 'scene':
      case 'button':
      case 'input_button':
        return t('Ready');

      case 'weather': {
        // Weather reports condition ids ("rainy", "clear-night"); show the same labels as the card.
        const condition = normalizeWeatherCondition(rawState);
        if (condition !== 'unknown') return t(WEATHER_LABELS[condition]);
        break;
      }

      case 'light':
        // A light that is on reads as its brightness.
        if (rawState === 'on' && attributes.brightness) {
          return formatPercent(Math.round((attributes.brightness / 255) * 100));
        }
        break;

      case 'climate': {
        const temperature = getClimateTemperature(entity);
        if (temperature !== null) return formatTemperature(temperature, getTemperatureUnit(entity));
        break;
      }

      case 'number':
      case 'input_number':
      case 'counter': {
        const number = parseNumericState(rawState);
        if (number !== null) return formatNumberEntityValue(number, entity);
        break;
      }

      case 'date':
      case 'datetime':
      case 'time':
      case 'input_datetime':
        return formatDateEntityState(entity);

      default:
        break;
    }

    // Everything else: the state's name, or the state as written when no name is known.
    return getLocalizedStateName(rawState, { domain });
  } catch (error) {
    console.error('Error getting entity display state:', error);
    return t('Unknown');
  }
}

/**
 * Resolves the finish time of a sensor-backed timer (like Google Kitchen Timer).
 * @param {object} entity - The entity to inspect.
 * @returns {string|null} - The finish timestamp, or null when there is none.
 */
function resolveTimerFinishesAt(entity) {
  if (!entity?.entity_id?.startsWith('sensor.')) return null;

  // Check for various timer end time attributes
  const finishesAt =
    entity.attributes?.finishes_at || entity.attributes?.end_time || entity.attributes?.finish_time;
  if (finishesAt) return finishesAt;

  // If no attribute, check if state is a timestamp (Google Kitchen Timer uses state as timestamp)
  if (!entity.state || entity.state === 'unavailable' || entity.state === 'unknown') {
    return null;
  }

  // Only treat as timestamp if it looks like a full ISO 8601 date-time string with time component
  // Require time component (YYYY-MM-DDTHH:mm or YYYY-MM-DD HH:mm) to avoid matching date-only sensors
  // This prevents matching calendar/date sensors showing "2025-12-25" and other date-only values
  const iso8601Pattern = /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(:\d{2})?/;
  if (!iso8601Pattern.test(entity.state)) return null;

  return isNaN(new Date(entity.state).getTime()) ? null : entity.state;
}

/**
 * Parses a Home Assistant duration ("0:15:00", "15:00", "1 day, 0:00:00", "0:00:04.5" or a number
 * of seconds).
 * @param {string|number} value - The duration to parse.
 * @returns {number|null} - The duration in seconds, or null when unparseable.
 */
function parseTimerDurationSeconds(value) {
  if (typeof value === 'number') {
    return Number.isFinite(value) && value >= 0 ? value : null;
  }
  if (typeof value !== 'string') return null;

  let trimmed = value.trim();
  if (!trimmed) return null;
  if (/^\d+(\.\d+)?$/.test(trimmed)) return Number(trimmed);

  // Python writes a timer longer than a day as "1 day, 2:00:00".
  let days = 0;
  const dayMatch = /^(\d+)\s+days?,\s*(.+)$/i.exec(trimmed);
  if (dayMatch) {
    days = Number(dayMatch[1]);
    trimmed = dayMatch[2];
  }

  const parts = trimmed.split(':').map((part) => Number(part));
  if (parts.some((part) => !Number.isFinite(part) || part < 0)) return null;
  if (parts.length === 3) return days * 86400 + parts[0] * 3600 + parts[1] * 60 + parts[2];
  if (parts.length === 2) return days * 86400 + parts[0] * 60 + parts[1];
  return null;
}

/**
 * Seconds left on a timer, derived from its finish time so it stays correct
 * between state updates.
 * @param {object} entity - The timer (or timer-like sensor) entity.
 * @returns {number|null} - Seconds remaining, or null when the timer is not running.
 */
function getTimerRemainingSeconds(entity) {
  try {
    if (!entity?.entity_id) return null;

    if (entity.entity_id.startsWith('sensor.')) {
      const finishesAt = resolveTimerFinishesAt(entity);
      if (!finishesAt) return null;
      const endTime = new Date(finishesAt).getTime();
      if (isNaN(endTime)) return null;
      return Math.max(0, (endTime - Date.now()) / 1000);
    }

    const normalizedState =
      typeof entity.state === 'string' ? entity.state.trim().toLowerCase() : '';
    if (normalizedState === 'paused') {
      return parseTimerDurationSeconds(entity.attributes?.remaining);
    }
    if (normalizedState !== 'active') return null;

    const endTime = getTimerEnd(entity);
    if (endTime == null) return null;
    return Math.max(0, (endTime - Date.now()) / 1000);
  } catch (error) {
    console.error('Error getting timer remaining seconds:', error);
    return null;
  }
}

/**
 * Fraction of a timer still to run, for progress bars.
 * @param {object} entity - The timer (or timer-like sensor) entity.
 * @returns {number|null} - A value from 0 to 1, or null when the total duration is unknown.
 */
function getTimerRemainingFraction(entity) {
  const durationSeconds = parseTimerDurationSeconds(entity?.attributes?.duration);
  if (!durationSeconds) return null;

  const remainingSeconds = getTimerRemainingSeconds(entity);
  if (remainingSeconds == null) return null;

  return Math.max(0, Math.min(1, remainingSeconds / durationSeconds));
}

/**
 * Run state of a timer entity, for logic that must not depend on the display language.
 * @param {object} entity - The timer (or timer-like sensor) entity.
 * @returns {'idle'|'running'|'paused'|'finished'|'unavailable'|'other'} - The run state.
 */
function getTimerRunState(entity) {
  if (!entity?.entity_id) return 'idle';

  const rawState = typeof entity.state === 'string' ? entity.state.trim() : '';
  const normalizedState = rawState.toLowerCase();
  if (normalizedState === 'unavailable') return 'unavailable';
  if (!rawState || normalizedState === 'unknown') return 'idle';

  if (entity.entity_id.startsWith('sensor.')) {
    const finishesAt = resolveTimerFinishesAt(entity);
    if (finishesAt) {
      return new Date(finishesAt).getTime() > Date.now() ? 'running' : 'finished';
    }
    // A bare date state says nothing about whether the timer is running.
    if (/^\d{4}-\d{2}-\d{2}/.test(rawState)) return 'idle';
    return 'other';
  }

  if (normalizedState === 'active') return 'running';
  if (normalizedState === 'paused') return 'paused';
  if (normalizedState === 'idle') return 'idle';
  return 'other';
}

/**
 * Short, human-readable run status for a timer entity ("Running", "Paused", ...), in the
 * active language. Never returns a raw timestamp, so it is safe to show as a compact badge.
 * Compare getTimerRunState() instead of this label in logic.
 * @param {object} entity - The timer (or timer-like sensor) entity.
 * @returns {string} - The status label.
 */
function getTimerStatusLabel(entity) {
  try {
    const runState = getTimerRunState(entity);
    if (runState !== 'other') return t(TIMER_STATUS_NAMES[runState]);
    return getLocalizedStateName(entity.state);
  } catch (error) {
    console.error('Error getting timer status label:', error);
    return t('Idle');
  }
}

function getTimerDisplay(entity) {
  try {
    if (!entity) return '--:--';

    // Handle sensor-based timers (like Google Kitchen Timer)
    if (entity.entity_id.startsWith('sensor.')) {
      const finishesAt = resolveTimerFinishesAt(entity);

      if (finishesAt) {
        const endTime = new Date(finishesAt).getTime();
        const now = Date.now();

        if (endTime <= now) {
          return t('Finished');
        }

        return formatDuration(endTime - now);
      }

      // If no end time found, just return the state
      return Object.prototype.hasOwnProperty.call(HA_STATE_NAMES, entity.state)
        ? t(HA_STATE_NAMES[entity.state])
        : entity.state;
    }

    // Handle timer.* entities
    if (entity.state === 'idle') {
      return t('Idle');
    }

    if (entity.state === 'paused' || entity.state === 'active') {
      // Home Assistant sends "0:04:12" without padding, so parse it rather than cut the text.
      const remaining = entity.attributes?.remaining ?? '0:00:00';
      const seconds = parseTimerDurationSeconds(remaining);
      const text = seconds === null ? String(remaining) : formatDuration(seconds * 1000);
      return entity.state === 'paused' ? `${t('Paused')} ${text}` : text;
    }

    return getLocalizedStateName(entity.state);
  } catch (error) {
    console.error('Error getting timer display:', error);
    return '--:--';
  }
}

/**
 * Escapes HTML special characters to prevent XSS attacks
 * @param {string} text - The text to escape
 * @returns {string} - HTML-safe text
 */
function escapeHtml(text) {
  if (typeof text !== 'string') return text;
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

function escapeHtmlAttribute(text) {
  return String(escapeHtml(String(text ?? '')))
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Base64-encode a string using UTF-8 bytes (safe for Unicode).
 * @param {string} input - The string to encode.
 * @returns {string} - Base64 encoded string.
 */
function base64Encode(input) {
  try {
    const text = input == null ? '' : String(input);
    const bytes = new TextEncoder().encode(text);
    let binary = '';
    const chunkSize = 0x8000;
    for (let i = 0; i < bytes.length; i += chunkSize) {
      binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
    }
    return btoa(binary);
  } catch (error) {
    console.error('Error base64 encoding string:', error);
    return '';
  }
}

/**
 * Normalize an entity ID candidate for fuzzy matching.
 * This does not guarantee a valid Home Assistant entity ID.
 * @param {string} entityId
 * @returns {string}
 */
function normalizeEntityIdCandidate(entityId) {
  if (typeof entityId !== 'string') return '';
  const trimmed = entityId.trim().toLowerCase();
  if (!trimmed) return '';

  const dotIndex = trimmed.indexOf('.');
  if (dotIndex < 0) {
    return trimmed.replace(/\s+/g, '_');
  }

  const domain = trimmed.slice(0, dotIndex).replace(/\s+/g, '_');
  const objectId = trimmed.slice(dotIndex + 1).replace(/\s+/g, '_');
  return `${domain}.${objectId}`;
}

/**
 * Resolve a potentially malformed entity ID to an actual ID present in the current state map.
 * Returns null when no safe mapping is found.
 * @param {string} entityId
 * @param {Object.<string, any>} [states]
 * @returns {string|null}
 */
function resolveEntityId(entityId, states = state.STATES) {
  if (typeof entityId !== 'string') return null;
  if (!states || typeof states !== 'object') return null;

  if (Object.prototype.hasOwnProperty.call(states, entityId)) {
    return entityId;
  }

  const trimmed = entityId.trim();
  if (trimmed && Object.prototype.hasOwnProperty.call(states, trimmed)) {
    return trimmed;
  }

  const directLower = trimmed.toLowerCase();
  if (directLower) {
    const caseInsensitiveMatch = Object.keys(states).find(
      (key) => key.toLowerCase() === directLower
    );
    if (caseInsensitiveMatch) return caseInsensitiveMatch;
  }

  const normalized = normalizeEntityIdCandidate(trimmed);
  if (normalized && Object.prototype.hasOwnProperty.call(states, normalized)) {
    return normalized;
  }

  if (normalized) {
    const normalizedLower = normalized.toLowerCase();
    const normalizedMatch = Object.keys(states).find(
      (key) => key.toLowerCase() === normalizedLower
    );
    if (normalizedMatch) return normalizedMatch;
  }

  return null;
}

/**
 * Reconcile entity IDs stored in local config against live Home Assistant states.
 * IDs are only rewritten when a concrete matching entity exists in `states`.
 * Trusted explicit mappings, such as an entity-registry rename event or a user-selected
 * replacement, take precedence and do not require the destination state to have arrived yet.
 * @param {Object} config
 * @param {Object.<string, any>} [states]
 * @param {Object.<string, string>|Map<string, string>} [explicitMappings]
 * @returns {{ config: Object, changed: boolean }}
 */
function reconcileConfigEntityIds(config, states = state.STATES, explicitMappings = {}) {
  if (!config || typeof config !== 'object' || !states || typeof states !== 'object') {
    return { config, changed: false };
  }

  const getExplicitMapping = (entityId) => {
    const mapped =
      explicitMappings instanceof Map
        ? explicitMappings.get(entityId)
        : explicitMappings &&
            typeof explicitMappings === 'object' &&
            Object.prototype.hasOwnProperty.call(explicitMappings, entityId)
          ? explicitMappings[entityId]
          : null;
    return typeof mapped === 'string' && mapped.trim() ? mapped.trim() : null;
  };

  const sameArray = (a, b) =>
    Array.isArray(a) &&
    Array.isArray(b) &&
    a.length === b.length &&
    a.every((value, index) => value === b[index]);

  const remapEntityId = (value) => {
    if (typeof value !== 'string') return value;
    const explicitMapping = getExplicitMapping(value);
    if (explicitMapping) return explicitMapping;
    return resolveEntityId(value, states) || value;
  };

  const remapArray = (list, options = {}) => {
    if (!Array.isArray(list)) return { value: list, changed: false };
    const specialValues = options.specialValues || null;
    const dedupe = !!options.dedupe;
    const seen = new Set();
    let localChanged = false;

    const next = list.reduce((acc, item) => {
      const preserveSpecial = typeof item === 'string' && specialValues && specialValues.has(item);
      const mapped = preserveSpecial ? item : remapEntityId(item);
      if (mapped !== item) localChanged = true;

      if (dedupe && typeof mapped === 'string') {
        if (seen.has(mapped)) {
          localChanged = true;
          return acc;
        }
        seen.add(mapped);
      }

      acc.push(mapped);
      return acc;
    }, []);

    if (!localChanged && sameArray(list, next)) {
      return { value: list, changed: false };
    }
    return { value: next, changed: true };
  };

  const remapObjectKeys = (input) => {
    if (!input || typeof input !== 'object' || Array.isArray(input)) {
      return { value: input, changed: false };
    }

    let localChanged = false;
    const next = {};

    Object.entries(input).forEach(([key, value]) => {
      const mappedKey = remapEntityId(key);
      if (mappedKey !== key) localChanged = true;

      if (Object.prototype.hasOwnProperty.call(next, mappedKey)) {
        // Prefer exact keys when both malformed and corrected forms exist.
        if (mappedKey === key) {
          next[mappedKey] = value;
        } else {
          localChanged = true;
        }
        return;
      }

      next[mappedKey] = value;
    });

    return localChanged ? { value: next, changed: true } : { value: input, changed: false };
  };

  let changed = false;
  let nextConfig = config;
  const ensureConfigClone = () => {
    if (nextConfig === config) nextConfig = { ...config };
  };

  if (typeof config.primaryMediaPlayer === 'string') {
    const mapped = remapEntityId(config.primaryMediaPlayer);
    if (mapped !== config.primaryMediaPlayer) {
      ensureConfigClone();
      nextConfig.primaryMediaPlayer = mapped;
      changed = true;
    }
  }

  if (typeof config.selectedWeatherEntity === 'string') {
    const mapped = remapEntityId(config.selectedWeatherEntity);
    if (mapped !== config.selectedWeatherEntity) {
      ensureConfigClone();
      nextConfig.selectedWeatherEntity = mapped;
      changed = true;
    }
  }

  const favoritesResult = remapArray(config.favoriteEntities, { dedupe: true });
  if (favoritesResult.changed) {
    ensureConfigClone();
    nextConfig.favoriteEntities = favoritesResult.value;
    changed = true;
  }

  if (Array.isArray(config.customTabs)) {
    let customTabsChanged = false;
    const customTabsResult = config.customTabs.map((tab) => {
      if (!tab || typeof tab !== 'object' || Array.isArray(tab)) return tab;
      const entitySource = Array.isArray(tab.entityIds) ? tab.entityIds : tab.entities;
      const entityIdsResult = remapArray(entitySource, { dedupe: true });
      if (
        entityIdsResult.changed ||
        !Array.isArray(tab.entityIds) ||
        Object.prototype.hasOwnProperty.call(tab, 'entities')
      ) {
        customTabsChanged = true;
        const rest = { ...tab };
        delete rest.entities;
        return { ...rest, entityIds: entityIdsResult.value };
      }
      return tab;
    });
    if (customTabsChanged) {
      ensureConfigClone();
      nextConfig.customTabs = customTabsResult;
      changed = true;
    }
  }

  if (Array.isArray(config.comparisonGraphs)) {
    let comparisonGraphsChanged = false;
    const comparisonGraphsResult = config.comparisonGraphs.map((graph) => {
      if (!graph || typeof graph !== 'object' || Array.isArray(graph)) return graph;
      const entityIdsResult = remapArray(graph.entityIds, { dedupe: true });
      if (!entityIdsResult.changed) return graph;
      comparisonGraphsChanged = true;
      return { ...graph, entityIds: entityIdsResult.value };
    });
    if (comparisonGraphsChanged) {
      ensureConfigClone();
      nextConfig.comparisonGraphs = comparisonGraphsResult;
      changed = true;
    }
  }

  const desktopPinsResult = remapObjectKeys(config.desktopPins);
  if (desktopPinsResult.changed) {
    ensureConfigClone();
    nextConfig.desktopPins = desktopPinsResult.value;
    changed = true;
  }

  const primaryCardSpecial = new Set(['weather', 'time', 'none']);
  const primaryCardsResult = remapArray(config.primaryCards, { specialValues: primaryCardSpecial });
  if (primaryCardsResult.changed) {
    ensureConfigClone();
    nextConfig.primaryCards = primaryCardsResult.value;
    changed = true;
  }

  const customNamesResult = remapObjectKeys(config.customEntityNames);
  if (customNamesResult.changed) {
    ensureConfigClone();
    nextConfig.customEntityNames = customNamesResult.value;
    changed = true;
  }

  const customIconsResult = remapObjectKeys(config.customEntityIcons);
  if (customIconsResult.changed) {
    ensureConfigClone();
    nextConfig.customEntityIcons = customIconsResult.value;
    changed = true;
  }

  const tileSpansResult = remapObjectKeys(config.tileSpans);
  if (tileSpansResult.changed) {
    ensureConfigClone();
    nextConfig.tileSpans = tileSpansResult.value;
    changed = true;
  }

  const quickAccessTileOptionsResult = remapObjectKeys(config.quickAccessTileOptions);
  if (quickAccessTileOptionsResult.changed) {
    ensureConfigClone();
    nextConfig.quickAccessTileOptions = quickAccessTileOptionsResult.value;
    changed = true;
  }

  if (config.globalHotkeys && typeof config.globalHotkeys === 'object') {
    const hotkeysResult = remapObjectKeys(config.globalHotkeys.hotkeys);
    if (hotkeysResult.changed) {
      ensureConfigClone();
      nextConfig.globalHotkeys = { ...config.globalHotkeys, hotkeys: hotkeysResult.value };
      changed = true;
    }
  }

  if (config.entityAlerts && typeof config.entityAlerts === 'object') {
    const alertsResult = remapObjectKeys(config.entityAlerts.alerts);
    if (alertsResult.changed) {
      ensureConfigClone();
      nextConfig.entityAlerts = { ...config.entityAlerts, alerts: alertsResult.value };
      changed = true;
    }
  }

  return { config: nextConfig, changed };
}

export {
  getEntityDisplayName,
  getEntityTypeDescription,
  getEntityIcon,
  getHomeAssistantMdiGlyph,
  normalizeEntityIconGlyph,
  normalizeHomeAssistantMdiIcon,
  decodeCssContent,
  formatDuration,
  getTimerEnd,
  getSearchScore,
  getEntityDisplayState,
  getTimerDisplay,
  isTimerLikeSensor,
  getTimerStatusLabel,
  getTimerRunState,
  getLocalizedStateName,
  HA_DOMAIN_NAMES,
  HA_STATE_NAMES,
  getTimerRemainingSeconds,
  getTimerRemainingFraction,
  escapeHtml,
  escapeHtmlAttribute,
  base64Encode,
  resolveEntityId,
  reconcileConfigEntityIds,
};

import state from './state.js';
import { t, formatNumber, formatNumericState } from './i18n.js';

// Display names for raw Home Assistant states. The English names are the same as STATE_NAMES in
// src/tray-entities.cjs (a unit test keeps the two in step), so both share one set of translation
// keys. This package cannot import that CommonJS module, hence the copy.
const HA_STATE_NAMES = Object.freeze({
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

// Names for the entity domains a tile can show. Anything else falls back to the domain id in
// title case, as before. Their translation keys carry a "Domain: " prefix because bare nouns such
// as "Light", "Lock" or "Update" are already keys with other meanings (a theme, verbs).
const HA_DOMAIN_NAMES = Object.freeze({
  alarm_control_panel: 'Alarm Control Panel',
  automation: 'Automation',
  binary_sensor: 'Binary Sensor',
  button: 'Button',
  calendar: 'Calendar',
  camera: 'Camera',
  climate: 'Climate',
  counter: 'Counter',
  cover: 'Cover',
  device_tracker: 'Device Tracker',
  fan: 'Fan',
  humidifier: 'Humidifier',
  input_boolean: 'Input Boolean',
  input_button: 'Input Button',
  input_number: 'Input Number',
  input_select: 'Input Select',
  input_text: 'Input Text',
  light: 'Light',
  lock: 'Lock',
  media_player: 'Media Player',
  number: 'Number',
  person: 'Person',
  remote: 'Remote',
  scene: 'Scene',
  script: 'Script',
  select: 'Select',
  sensor: 'Sensor',
  siren: 'Siren',
  switch: 'Switch',
  timer: 'Timer',
  update: 'Update',
  vacuum: 'Vacuum',
  valve: 'Valve',
  water_heater: 'Water Heater',
  weather: 'Weather',
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
 * States without a known name keep their text with the first letter capitalized.
 * @param {string} value - The raw state.
 * @returns {string} - The label to show.
 */
function getLocalizedStateName(value) {
  const raw = typeof value === 'string' ? value.trim() : '';
  if (!raw) return t('Unknown');
  const key = raw.toLowerCase();
  if (Object.prototype.hasOwnProperty.call(HA_STATE_NAMES, key)) return t(HA_STATE_NAMES[key]);
  return raw.charAt(0).toUpperCase() + raw.slice(1);
}

function isUnavailableOrUnknownState(value) {
  return value === 'unavailable' || value === 'unknown';
}
const graphemeSegmenter =
  typeof Intl !== 'undefined' && typeof Intl.Segmenter === 'function'
    ? new Intl.Segmenter(undefined, { granularity: 'grapheme' })
    : null;
const homeAssistantMdiGlyphs = new Map();

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
    if (rule.cssRules) {
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

  for (const stylesheet of Array.from(document.styleSheets || [])) {
    try {
      collectHomeAssistantMdiGlyphsFromRules(stylesheet.cssRules);
    } catch {
      // A stylesheet outside the app origin may deny CSSOM access. The bundled MDI sheet does not.
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
        // Check for timer sensors (has timer-related attributes or timer in name)
        if (
          attributes.finishes_at ||
          attributes.end_time ||
          attributes.finish_time ||
          attributes.duration ||
          entity.entity_id.toLowerCase().includes('timer')
        )
          return '⏲️';
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

function formatDuration(ms) {
  try {
    if (ms < 0) ms = 0;
    const s = Math.floor(ms / 1000);
    const hh = Math.floor(s / 3600);
    const mm = Math.floor((s % 3600) / 60);
    const ss = s % 60;
    if (hh > 0) return `${hh}:${String(mm).padStart(2, '0')}:${String(ss).padStart(2, '0')}`;
    return `${mm}:${String(ss).padStart(2, '0')}`;
  } catch (error) {
    console.error('Error formatting duration:', error);
    return '0:00';
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
    // Normalize text by removing special characters, apostrophes, underscores, and extra spaces
    const normalizeText = (str) => {
      return str
        .toLowerCase()
        .replace(/[''`]/g, '') // Remove apostrophes and backticks
        .replace(/[_-]/g, ' ') // Replace underscores and hyphens with spaces
        .replace(/[^\w\s]/g, '') // Remove other special characters
        .replace(/\s+/g, ' ') // Normalize multiple spaces to single space
        .trim();
    };

    const normalizedText = normalizeText(text);
    const normalizedQuery = normalizeText(query);

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

function getEntityDisplayState(entity) {
  try {
    if (!entity) return t('Unknown');

    // Check if sensor is a timer (has timer-related attributes, timer in name, or timestamp as state)
    const hasTimerAttributes =
      entity.attributes &&
      (entity.attributes.finishes_at ||
        entity.attributes.end_time ||
        entity.attributes.finish_time ||
        entity.attributes.duration);
    const hasTimerInName = entity.entity_id.toLowerCase().includes('timer');

    // Check if state is a valid future timestamp
    let stateIsTimestamp = false;
    if (entity.state && entity.state !== 'unavailable' && entity.state !== 'unknown') {
      // Only treat as timestamp if it looks like a full ISO 8601 date-time string with time component
      // Require time component (YYYY-MM-DDTHH:mm or YYYY-MM-DD HH:mm) to avoid matching date-only sensors
      // This prevents matching calendar/date sensors showing "2025-12-25" and other date-only values
      const iso8601Pattern = /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(:\d{2})?/;
      const looksLikeTimestamp = iso8601Pattern.test(entity.state);
      if (looksLikeTimestamp) {
        const stateTime = new Date(entity.state).getTime();
        if (!isNaN(stateTime) && stateTime > Date.now()) {
          stateIsTimestamp = true;
        }
      }
    }

    const isTimerSensor =
      entity.entity_id.startsWith('sensor.') &&
      (hasTimerAttributes || hasTimerInName || stateIsTimestamp);

    // For timers (both timer.* and sensor.* with timer attributes)
    if (entity.entity_id.startsWith('timer.') || isTimerSensor) {
      return getTimerDisplay(entity);
    }

    // For sensors, return the actual value with unit
    if (entity.entity_id.startsWith('sensor.')) {
      if (isUnavailableOrUnknownState(entity.state)) return getLocalizedStateName(entity.state);
      const unit = entity.attributes?.unit_of_measurement || '';
      // Like Home Assistant, only format measurements; a bare "2026" or "01234" stays as sent.
      const value =
        unit || entity.attributes?.state_class ? formatNumericState(entity.state) : entity.state;
      return unit ? `${value} ${unit}` : value;
    }

    // For binary sensors
    if (entity.entity_id.startsWith('binary_sensor.')) {
      if (isUnavailableOrUnknownState(entity.state)) return getLocalizedStateName(entity.state);
      return entity.state === 'on' ? t('Detected') : t('Clear');
    }

    // For scenes - just show "Ready" or hide the state
    if (entity.entity_id.startsWith('scene.')) {
      return t('Ready');
    }

    // For lights with brightness
    if (
      entity.entity_id.startsWith('light.') &&
      entity.state === 'on' &&
      entity.attributes?.brightness
    ) {
      const brightness = Math.round((entity.attributes.brightness / 255) * 100);
      return `${brightness}%`;
    }

    // For climate
    if (entity.entity_id.startsWith('climate.')) {
      const temp = entity.attributes?.current_temperature || entity.attributes?.temperature;
      if (temp) return `${formatNumber(temp)}°`;
    }

    // Default: the localized state name, or the raw state with its first letter capitalized
    return getLocalizedStateName(entity.state);
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
 * Parses a Home Assistant duration ("0:15:00", "15:00" or a number of seconds).
 * @param {string|number} value - The duration to parse.
 * @returns {number|null} - The duration in seconds, or null when unparseable.
 */
function parseTimerDurationSeconds(value) {
  if (typeof value === 'number') {
    return Number.isFinite(value) && value >= 0 ? value : null;
  }
  if (typeof value !== 'string') return null;

  const trimmed = value.trim();
  if (!trimmed) return null;
  if (/^\d+(\.\d+)?$/.test(trimmed)) return Number(trimmed);

  const parts = trimmed.split(':').map((part) => Number(part));
  if (parts.some((part) => !Number.isFinite(part) || part < 0)) return null;
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
  if (parts.length === 2) return parts[0] * 60 + parts[1];
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

        const remaining = Math.max(0, Math.floor((endTime - now) / 1000));
        const hours = Math.floor(remaining / 3600);
        const minutes = Math.floor((remaining % 3600) / 60);
        const seconds = remaining % 60;

        if (hours > 0) {
          return `${hours}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
        }
        return `${minutes}:${String(seconds).padStart(2, '0')}`;
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

    if (entity.state === 'paused') {
      const remaining = entity.attributes?.remaining || '00:00:00';
      return `⏸ ${remaining.substring(0, 5)}`; // Show HH:MM
    }

    if (entity.state === 'active') {
      const remaining = entity.attributes?.remaining || '00:00:00';
      // Parse and format as mm:ss or hh:mm:ss
      const parts = remaining.split(':').map((p) => parseInt(p, 10));
      if (parts.length === 3) {
        const [h, m, s] = parts;
        if (h > 0) {
          return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
        }
        return `${m}:${String(s).padStart(2, '0')}`;
      }
      return remaining.substring(0, 5); // Fallback to HH:MM
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
  normalizeHomeAssistantMdiIcon,
  decodeCssContent,
  formatDuration,
  getTimerEnd,
  getSearchScore,
  getEntityDisplayState,
  getTimerDisplay,
  getTimerStatusLabel,
  getTimerRunState,
  getLocalizedStateName,
  HA_STATE_NAMES,
  getTimerRemainingSeconds,
  getTimerRemainingFraction,
  escapeHtml,
  escapeHtmlAttribute,
  base64Encode,
  resolveEntityId,
  reconcileConfigEntityIds,
};

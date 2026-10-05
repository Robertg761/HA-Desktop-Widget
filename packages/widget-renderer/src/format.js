/**
 * The one place values are turned into text: numbers, units, percentages, temperatures, times,
 * dates, durations, relative times and Home Assistant state words. Tiles, pins, the command
 * palette, dialogs, alerts and the tray all read these helpers (getEntityDisplayState in utils.js
 * is the per-entity entry point), so the same reading is written the same way on every surface.
 *
 * Everything follows the format locale (see getFormatLocale in i18n.js): the user's language with
 * their region, so "21,5 °C" in Germany, "21.5°C" in Britain and "1.234,5" in Brazil. Words come
 * from t(); numbers, units, dates and sort order come from Intl.
 */
import state from './state.js';
import {
  formatDate,
  formatDateTime,
  formatNumber,
  formatTime,
  getFormatLocale,
  t,
} from './i18n.js';
import stateNameTables from './ha-state-names.cjs';

const { HVAC_MODE_NAMES, STATE_NAMES, BINARY_STATE_NAMES } = stateNameTables;

const NO_BREAK_SPACE = '\u00a0';

// --- Clock and calendar settings -------------------------------------------------------------

/**
 * Intl options for the Time format setting. "Automatic" leaves the choice to the format locale:
 * Electron cannot read the operating system's own 12/24-hour switch.
 * @returns {{hour12?: boolean}}
 */
export function getClockTimeOptions() {
  const timeFormat = state.CONFIG?.ui?.timeFormat;
  if (timeFormat === '12-hour') return { hour12: true };
  if (timeFormat === '24-hour' || state.CONFIG?.ui?.use24HourClock) return { hour12: false };
  return {};
}

/**
 * Intl options for the Date format setting. The old "System default" choice produced exactly
 * what Numeric date does, so a stored 'system' reads as numeric.
 * @returns {Intl.DateTimeFormatOptions}
 */
export function getClockDateOptions() {
  switch (state.CONFIG?.ui?.dateFormat) {
    case 'long':
      return { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' };
    case 'system':
    case 'numeric':
      return { year: 'numeric', month: 'numeric', day: 'numeric' };
    case 'weekday-short':
    default:
      return { weekday: 'short', month: 'short', day: 'numeric' };
  }
}

/**
 * Hour and minute options for a time of day. A 12-hour clock drops the leading zero ("7:31 AM")
 * while a 24-hour clock keeps it ("07:31"), so every time label and the large clock agree.
 * @returns {Intl.DateTimeFormatOptions}
 */
export function getClockFaceTimeOptions() {
  const clock = getClockTimeOptions();
  let hour12 = false;
  try {
    hour12 = !!new Intl.DateTimeFormat(getFormatLocale(), {
      hour: 'numeric',
      ...clock,
    }).resolvedOptions().hour12;
  } catch {
    // Keep the 24-hour digits.
  }
  return { hour: hour12 ? 'numeric' : '2-digit', minute: '2-digit', ...clock };
}

/**
 * A time of day ("7:31 AM", "07:31") in the user's 12/24-hour setting.
 * @param {Date|number|string} date
 * @param {Intl.DateTimeFormatOptions} [options] - Replaces the default hour and minute.
 */
export function formatClockTime(date, options = getClockFaceTimeOptions()) {
  return formatTime(date, { ...options, ...getClockTimeOptions() });
}

/** A date with a time of day, in the user's 12/24-hour setting. */
export function formatClockDateTime(date, options = { dateStyle: 'medium', timeStyle: 'short' }) {
  return formatDateTime(date, { ...options, ...getClockTimeOptions() });
}

// --- Numbers and units -----------------------------------------------------------------------

const spacingCache = new Map();

// Only the spaces of a run of literals: bidi marks in right-to-left patterns are not part of the
// gap, and a plain space (German writes "21 °C" with one) becomes a no-break one, so the unit never
// wraps onto its own line.
function gapFrom(parts) {
  return parts
    .map((part) => part.value)
    .join('')
    .replace(/[^\s\u00a0\u202f]/g, '')
    .replace(/ /g, NO_BREAK_SPACE);
}

// The gap this locale writes between a number and "%" or a degree unit, read from its own
// patterns ("50 %" with a no-break space in German and French, "50%" in English), and whether "%"
// comes first ("%50" in Turkish).
function readUnitSpacing(locale) {
  const spacingBetween = (parts, signType) => {
    const signIndex = parts.findIndex((part) => part.type === signType);
    let numberEnd = -1;
    parts.forEach((part, index) => {
      if (part.type !== 'literal' && part.type !== signType && index < signIndex) numberEnd = index;
    });
    if (signIndex < 0 || numberEnd < 0) return '';
    return gapFrom(parts.slice(numberEnd + 1, signIndex));
  };
  try {
    const percentParts = new Intl.NumberFormat(locale, { style: 'percent' }).formatToParts(0.5);
    const percentIndex = percentParts.findIndex((part) => part.type === 'percentSign');
    const numberStart = percentParts.findIndex((part) => part.type === 'integer');
    const percentFirst = percentIndex >= 0 && numberStart > percentIndex;
    return {
      percent: percentFirst
        ? gapFrom(percentParts.slice(percentIndex + 1, numberStart))
        : spacingBetween(percentParts, 'percentSign'),
      percentFirst,
      degree: spacingBetween(
        new Intl.NumberFormat(locale, { style: 'unit', unit: 'celsius' }).formatToParts(21),
        'unit'
      ),
    };
  } catch {
    return { percent: '', percentFirst: false, degree: '' };
  }
}

function getUnitSpacing() {
  const locale = getFormatLocale();
  let spacing = spacingCache.get(locale);
  if (!spacing) {
    spacing = readUnitSpacing(locale);
    spacingCache.set(locale, spacing);
  }
  return spacing;
}

/**
 * Joins a formatted number and its unit with the right gap: the locale's own for "%" and the
 * degree units, nothing before a bare "°", and a no-break space for every other unit so a unit
 * never wraps onto its own line. "%" goes before the number where the locale writes it so
 * ("%50" in Turkish); other units always follow it.
 * @param {string} valueText - The number, already formatted.
 * @param {string} unit - The unit as Home Assistant reports it ("°C", "%", "kWh").
 * @returns {string}
 */
export function joinUnit(valueText, unit) {
  const trimmed = typeof unit === 'string' ? unit.trim() : '';
  if (!trimmed) return valueText;
  let gap = NO_BREAK_SPACE;
  if (trimmed === '%') {
    const spacing = getUnitSpacing();
    if (spacing.percentFirst) {
      // A minus sign stays in front of the whole thing: "-%50".
      const [, sign, digits] = /^([-\u2212+]?)([\s\S]*)$/.exec(valueText);
      return `${sign}%${spacing.percent}${digits}`;
    }
    gap = spacing.percent;
  } else if (trimmed === '°') gap = '';
  else if (trimmed.startsWith('°')) gap = getUnitSpacing().degree;
  return `${valueText}${gap}${trimmed}`;
}

/**
 * A number with its unit, in the user's number format ("1.234,5 kWh").
 * @param {number|string} value
 * @param {string} unit
 * @param {Intl.NumberFormatOptions} [options]
 */
export function formatMeasurement(value, unit, options = {}) {
  return joinUnit(formatNumber(value, options), unit);
}

/** A percentage such as a brightness or position: "80%", or "80 %" where the locale spaces it. */
export function formatPercent(value, options = {}) {
  return formatMeasurement(value, '%', { maximumFractionDigits: 1, ...options });
}

/** A light's colour temperature in whole kelvin, in the user's digits: "3,200 K". */
export function formatKelvin(kelvin) {
  return formatMeasurement(kelvin, 'K', { maximumFractionDigits: 0 });
}

/** A temperature with its unit, or "--" when there is no reading. */
export function formatTemperature(value, unit = '') {
  // Two decimals keep a 0.25-degree thermostat step intact and trim float noise ("21.123").
  return value == null ? '--' : formatMeasurement(value, unit, { maximumFractionDigits: 2 });
}

// A plain decimal as Home Assistant writes one. A leading zero ("02134") makes it a code, and an
// exponent or hex form ("1e3", "0x10") is text, so none of them is reformatted as a number.
const PLAIN_DECIMAL = /^\s*-?(?:0|[1-9]\d*)(?:\.\d+)?\s*$/;

/**
 * The number in a Home Assistant state string, or null for text, dates and codes with leading
 * zeros ("02134"), which must stay as sent.
 * @param {unknown} raw
 * @returns {number|null}
 */
export function parseNumericState(raw) {
  const text = typeof raw === 'number' ? String(raw) : typeof raw === 'string' ? raw : '';
  if (!PLAIN_DECIMAL.test(text)) return null;
  const value = Number(text);
  return Number.isFinite(value) ? value : null;
}

function isMeasurement(attributes) {
  return !!(attributes?.unit_of_measurement || attributes?.state_class);
}

// How many decimals a sensor tile shows: the integration's own suggestion when it has one (marked
// exact, so a reading is rounded to it like Home Assistant does), else one for temperatures,
// humidity and percentages and two for everything else.
export function getSensorPrecision(attributes = {}) {
  const suggested = attributes.suggested_display_precision;
  if (Number.isInteger(suggested) && suggested >= 0 && suggested <= 6) {
    return { minimum: suggested, maximum: suggested, exact: true };
  }
  const unit =
    typeof attributes.unit_of_measurement === 'string' ? attributes.unit_of_measurement.trim() : '';
  const compact =
    attributes.device_class === 'temperature' ||
    attributes.device_class === 'humidity' ||
    unit === '%' ||
    unit === '°C' ||
    unit === '°F';
  return { minimum: 0, maximum: compact ? 1 : 2 };
}

/**
 * Rounds a reading for display without ever showing "-0" or losing a value that is small but
 * not zero: -0.04 at one decimal reads "-0.04", not "-0". A precision the integration asked for
 * (`exact`) is kept as asked: -0.04 at no decimals reads "0", as it does in Home Assistant.
 * @param {number} value
 * @param {{minimum?: number, maximum: number, exact?: boolean}} precision
 * @param {boolean} [useGrouping]
 * @returns {string}
 */
export function formatReadingNumber(value, precision, useGrouping = true) {
  const { minimum = 0, maximum, exact = false } = precision;
  const options = {
    minimumFractionDigits: minimum,
    maximumFractionDigits: maximum,
    useGrouping,
    signDisplay: 'negative',
  };
  const formatted = formatNumber(value, options);
  // Rounded to zero although the reading is not: keep two significant digits (down to 0.0001).
  if (!exact && value !== 0 && Math.abs(value) >= 1e-4 && Number(value.toFixed(maximum)) === 0) {
    return formatNumber(value, {
      maximumSignificantDigits: 2,
      useGrouping,
      signDisplay: 'negative',
    });
  }
  return formatted;
}

/**
 * The reading of a numeric sensor, split for tiles that style the unit apart from the value.
 * @param {object} entity - A Home Assistant state object.
 * @returns {{value: string, unit: string, text: string}|null} Null for anything that is not a
 *   plain number, so codes ("02134") and text fall through to the text tile.
 */
export function getSensorReading(entity) {
  if (!entity?.entity_id?.startsWith('sensor.')) return null;
  const attributes = entity.attributes || {};
  const measured = isMeasurement(attributes);
  const number = parseNumericState(entity.state);
  if (number === null) return null;
  // A duration of a minute or more reads in units ("1 hr 15 min"), not as a count of seconds.
  if (attributes.device_class === 'duration') {
    const duration = formatDurationReading(number, attributes.unit_of_measurement);
    if (duration) return { value: duration, unit: '', text: duration };
  }
  const unit =
    typeof attributes.unit_of_measurement === 'string' ? attributes.unit_of_measurement.trim() : '';
  let precision = getSensorPrecision(attributes);
  if (!measured) {
    // A bare number may be a version or a code: keep the decimals it was sent with ("3.10").
    const sent = String(entity.state).trim().split('.')[1]?.length || 0;
    if (sent <= 3) precision = { minimum: sent, maximum: sent };
  }
  // A bare number without a state class may be a year or a code; don't group it ("2026").
  const value = formatReadingNumber(number, precision, measured);
  return { value, unit, text: joinUnit(value, unit) };
}

// Decimals a helper's step implies, from its fractional part whatever its size: 0.5 reads "21.5",
// 1 reads "21", 0.25 reads "0.25", and 2.5 reads "7.5" (not "8"). At most three are kept.
function getStepDecimals(step) {
  const number = Number(step);
  if (!Number.isFinite(number) || number <= 0) return 0;
  // Twelve significant digits drop floating-point noise (0.1 + 0.2 is 0.30000000000000004, meant
  // as 0.3) and spell exponent forms (2.5e-7) the same way as plain ones.
  const [mantissa, exponent = '0'] = number.toPrecision(12).split('e');
  const fraction = (mantissa.split('.')[1] || '').replace(/0+$/, '');
  return Math.max(0, Math.min(3, fraction.length - Number(exponent)));
}

/**
 * A value of a number, input_number or counter entity: its step sets the decimals and its unit
 * follows. Without a step the value keeps up to three decimals.
 * @param {number|string} value
 * @param {object} entity
 * @param {{step?: number}} [options] - A step to use instead of the entity's.
 */
export function formatNumberEntityValue(value, entity, { step } = {}) {
  const attributes = entity?.attributes || {};
  const effectiveStep = step ?? attributes.step;
  const hasStep = Number.isFinite(Number(effectiveStep)) && Number(effectiveStep) > 0;
  const decimals = getStepDecimals(effectiveStep);
  const number = Number(value);
  const text = formatReadingNumber(
    number,
    hasStep ? { minimum: decimals, maximum: decimals } : { maximum: 3 },
    true
  );
  return joinUnit(text, attributes.unit_of_measurement);
}

/**
 * The temperature a climate or water heater shows: the current reading, else its target. An
 * unavailable or unknown thermostat has none (its attributes may be stale) and a reading of 0 is
 * a reading, not a missing value.
 * @param {object} entity
 * @returns {number|null}
 */
export function getClimateTemperature(entity) {
  if (!entity?.entity_id || entity.state === 'unavailable' || entity.state === 'unknown') {
    return null;
  }
  const finite = (value) => {
    if (typeof value === 'number') return Number.isFinite(value) ? value : null;
    if (typeof value !== 'string' || !value.trim()) return null;
    const number = Number(value);
    return Number.isFinite(number) ? number : null;
  };
  return finite(entity.attributes?.current_temperature) ?? finite(entity.attributes?.temperature);
}

/**
 * The temperature unit of an entity: its own, else Home Assistant's unit system ("°F" for an
 * imperial installation), else a bare degree sign.
 */
export function getTemperatureUnit(entity, fallback = '°') {
  return (
    entity?.attributes?.temperature_unit ||
    entity?.attributes?.unit_of_measurement ||
    state.UNIT_SYSTEM?.temperature ||
    fallback
  );
}

// --- State words -----------------------------------------------------------------------------

// Entities whose state is text the user wrote or chose: shown as typed, never re-cased or mapped
// to a state name ("heat" in a select of heating options is not "Heating").
const FREE_FORM_DOMAINS = new Set(['select', 'input_select', 'text', 'input_text']);

function capitalizeFirst(text) {
  const [first] = Array.from(text);
  if (!first) return text;
  return first.toLocaleUpperCase(getFormatLocale()) + text.slice(first.length);
}

/**
 * Makes an unmapped state readable: underscores become spaces, and the first letter is
 * capitalised only when the whole text is lower case, so "iPhone" and "Work" stay as written.
 * @param {string} text
 */
export function humanizeState(text) {
  const spaced = text.replace(/_/g, ' ');
  return spaced === spaced.toLocaleLowerCase(getFormatLocale()) ? capitalizeFirst(spaced) : spaced;
}

/**
 * Capitalises the first letter of every word ("heat pump" -> "Heat Pump") for names an
 * integration defines, such as climate presets. Letters of every script count, so "éco" becomes
 * "Éco", not "éCo".
 * @param {string} text
 */
export function titleCase(text) {
  const locale = getFormatLocale();
  return String(text ?? '').replace(
    /(^|\s)(\p{L})/gu,
    (_match, space, letter) => space + letter.toLocaleUpperCase(locale)
  );
}

/**
 * The display name of a raw state ("not_home" -> "Away"). Free-form domains keep their text; a
 * state with no name is humanised, never shown with underscores.
 * @param {unknown} value - The raw state.
 * @param {{domain?: string}} [options]
 * @returns {string}
 */
export function formatStateName(value, { domain = '' } = {}) {
  const raw = typeof value === 'string' ? value.trim() : value == null ? '' : String(value);
  if (!raw) return t('Unknown');
  const key = raw.toLowerCase();
  if (key === 'unavailable' || key === 'unknown') return t(STATE_NAMES[key]);
  if (FREE_FORM_DOMAINS.has(domain)) return raw;
  if (Object.prototype.hasOwnProperty.call(STATE_NAMES, key)) return t(STATE_NAMES[key]);
  return humanizeState(raw);
}

/**
 * What a binary sensor reads on and off, by device class ("Open"/"Closed" for a door,
 * "Connected"/"Disconnected" for connectivity). Classes with no wording read "Detected"/"Clear".
 * @param {string} rawState - 'on' or 'off'.
 * @param {string} [deviceClass]
 */
export function formatBinarySensorState(rawState, deviceClass = '') {
  const names = Object.prototype.hasOwnProperty.call(BINARY_STATE_NAMES, deviceClass)
    ? BINARY_STATE_NAMES[deviceClass]
    : null;
  if (names) return t(rawState === 'on' ? names[0] : names[1]);
  return rawState === 'on' ? t('Detected') : t('Clear');
}

export { HVAC_MODE_NAMES, STATE_NAMES, BINARY_STATE_NAMES };

// --- Relative times, timestamps and durations ------------------------------------------------

const relativeFormatCache = new Map();

function getRelativeFormat(style = 'short') {
  const locale = getFormatLocale();
  const key = `${locale}|${style}`;
  let formatter = relativeFormatCache.get(key);
  if (!formatter) {
    try {
      formatter = new Intl.RelativeTimeFormat(locale, { numeric: 'auto', style });
    } catch {
      formatter = new Intl.RelativeTimeFormat('en', { numeric: 'auto', style });
    }
    relativeFormatCache.set(key, formatter);
  }
  return formatter;
}

const MINUTE_MS = 60 * 1000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;

function startOfDay(date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

// Whole calendar days from `now` to `date`: 0 today, 1 tomorrow, -1 yesterday.
function dayDifference(date, now) {
  return Math.round((startOfDay(date) - startOfDay(now)) / DAY_MS);
}

/**
 * "5 min. ago", "in 14 hr.", "yesterday": the language's own relative time, so no hand-made
 * "{{count}}m ago" strings and no Arabic abbreviations. Under a minute reads "just now". A time
 * in the past counts whole units ("5 min. ago" until the sixth minute); one ahead rounds to the
 * nearest ("in 14 hr." with 13 h 40 min left). From a day out it counts calendar days, so a
 * notification from 10 p.m. two evenings ago is "2 days ago", not "yesterday".
 * @param {Date|number|string} when
 * @param {{now?: number, style?: 'long'|'short'|'narrow'}} [options]
 * @returns {string} '' when `when` is not a date.
 */
export function formatRelativeTime(when, { now = Date.now(), style = 'short' } = {}) {
  const timestamp =
    typeof when === 'number' ? when : when instanceof Date ? when.getTime() : Date.parse(when);
  if (!Number.isFinite(timestamp)) return '';
  const difference = timestamp - now;
  const elapsed = Math.abs(difference);
  const sign = difference < 0 ? -1 : 1;
  const round = difference < 0 ? Math.floor : Math.round;
  const formatter = getRelativeFormat(style);
  const minutes = round(elapsed / MINUTE_MS);
  if (minutes < 1) return t('just now');
  if (minutes < 60) return formatter.format(sign * minutes, 'minute');
  // Under a day away is still hours, even when 23.6 hours round up to "in 24 hr.".
  if (elapsed < DAY_MS) return formatter.format(sign * round(elapsed / HOUR_MS), 'hour');
  const days = Math.max(1, Math.abs(dayDifference(new Date(timestamp), new Date(now))));
  return formatter.format(sign * days, 'day');
}

/**
 * The word for a day next to today ("today", "tomorrow", "yesterday"), capitalised to start a
 * line, or null for any other day.
 * @param {Date} date
 * @param {number} [now]
 */
export function formatNearbyDay(date, now = Date.now()) {
  const offset = dayDifference(date, new Date(now));
  if (offset < -1 || offset > 1) return null;
  return capitalizeFirst(getRelativeFormat('long').format(offset, 'day'));
}

// Intl options for a day that is not today or next to it: its weekday within the coming week, else
// month and day, with the year when it is another year.
function getDayOptions(date, now) {
  const offset = dayDifference(date, new Date(now));
  if (offset > 1 && offset < 7) return { weekday: 'short' };
  const sameYear = date.getFullYear() === new Date(now).getFullYear();
  return { month: 'short', day: 'numeric', ...(sameYear ? {} : { year: 'numeric' }) };
}

/**
 * A calendar day for a glance: its nearby word ("Tomorrow"), else the weekday within the next
 * week ("Thu"), else the date ("Oct 12").
 * @param {Date} date
 * @param {number} [now]
 */
export function formatDayLabel(date, now = Date.now()) {
  return formatNearbyDay(date, now) || formatDate(date, getDayOptions(date, now));
}

/**
 * A day and a time of day: "Today 8:12 AM", "Thu 10:00 PM", "Oct 12, 10:00 PM". The time follows
 * the 12/24-hour setting.
 * @param {Date} date
 * @param {number} [now]
 */
export function formatDayAndTime(date, now = Date.now()) {
  const nearby = formatNearbyDay(date, now);
  if (nearby) return `${nearby} ${formatClockTime(date)}`;
  return formatClockDateTime(date, {
    ...getDayOptions(date, now),
    ...getClockFaceTimeOptions(),
  });
}

/**
 * The state of a timestamp or date sensor, or of a date/time entity, as text. A value that is not a
 * date stays as sent.
 * @param {string} raw - The state, an ISO date or date-time.
 * @param {{dateOnly?: boolean, now?: number}} [options]
 */
export function formatDateState(raw, { dateOnly = false, now = Date.now() } = {}) {
  const text = typeof raw === 'string' ? raw.trim() : '';
  const isoDate = /^\d{4}-\d{2}-\d{2}$/.test(text);
  if (!isoDate && !/^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}/.test(text))
    return raw == null ? '' : String(raw);
  // A bare date has no zone: read it as that calendar day here, not as midnight UTC.
  const date = isoDate ? new Date(`${text}T00:00:00`) : new Date(text);
  if (Number.isNaN(date.getTime())) return String(raw);
  if (dateOnly || isoDate) return formatDayLabel(date, now);
  // The day and time, never "in 9 hr.": nothing redraws a tile every minute, so a relative label
  // would go stale until the entity next changes.
  return formatDayAndTime(date, now);
}

/**
 * A countdown or elapsed time as a clock: "4:12", or "1:05:00" from an hour up. Digits stay
 * Latin, like a timer face, in every language.
 * @param {number} ms
 */
export function formatDuration(ms) {
  const seconds = Math.floor(Math.max(0, Number(ms) || 0) / 1000);
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const rest = String(seconds % 60).padStart(2, '0');
  return hours > 0 ? `${hours}:${String(minutes).padStart(2, '0')}:${rest}` : `${minutes}:${rest}`;
}

/**
 * The state of a `time` entity ("08:30:00") as a time of day in the 12/24-hour setting; anything
 * else stays as sent.
 * @param {string} raw
 */
export function formatTimeOfDayState(raw) {
  const match = /^(\d{1,2}):(\d{2})(?::\d{2})?$/.exec(typeof raw === 'string' ? raw.trim() : '');
  if (!match) return raw == null ? '' : String(raw);
  return formatClockTime(new Date(1970, 0, 1, Number(match[1]), Number(match[2])));
}

const DURATION_UNIT_SECONDS = Object.freeze({
  ms: 0.001,
  s: 1,
  min: 60,
  h: 3600,
  d: 86400,
  w: 604800,
});

/**
 * A duration sensor ("4500" seconds) as "1 hr 15 min": the two largest units, in the language's own
 * unit names. Units Home Assistant does not use for durations, and spans under a minute, return
 * null so the caller shows the plain number.
 * @param {number} value
 * @param {string} unit - 'ms', 's', 'min', 'h', 'd' or 'w'.
 * @returns {string|null}
 */
export function formatDurationReading(value, unit) {
  const unitSeconds = DURATION_UNIT_SECONDS[typeof unit === 'string' ? unit.trim() : ''];
  if (!unitSeconds || !Number.isFinite(value)) return null;
  // A few seconds read better as the number itself ("1.5 s") than as rounded units.
  if (Math.abs(value) * unitSeconds < 60) return null;
  let remaining = Math.round(Math.abs(value) * unitSeconds);
  const parts = [];
  [
    ['day', 86400],
    ['hour', 3600],
    ['minute', 60],
    ['second', 1],
  ].forEach(([name, seconds]) => {
    const amount = Math.floor(remaining / seconds);
    remaining -= amount * seconds;
    if (amount > 0 && parts.length < 2) {
      parts.push(formatNumber(amount, { style: 'unit', unit: name, unitDisplay: 'short' }));
    }
  });
  try {
    // Arabic and Urdu join even narrow units with an "and" ("1 س و15 د"), which a glanceable readout
    // does not want and which sits glued to the next number: a gap that holds a word becomes a space.
    const joined = new Intl.ListFormat(getFormatLocale(), { type: 'unit', style: 'narrow' })
      .formatToParts(parts)
      .map((part) => (part.type === 'literal' && /\p{L}/u.test(part.value) ? ' ' : part.value))
      .join('');
    return value < 0 ? `-${joined}` : joined;
  } catch {
    return parts.join(' ');
  }
}

// --- Lists -----------------------------------------------------------------------------------

const listSeparatorCache = new Map();

// Arabic-script lists put an "and" in the first gap (" و" in Arabic, "، و" in Persian), so these
// languages use their comma instead of reading the gap from Intl.
const ARABIC_COMMA_LANGUAGES = new Set(['ar', 'fa', 'ur']);

// The separator a language puts between the first two items of a list: ", " in English and German,
// "、" in Chinese and Japanese, "، " in Arabic.
function getListSeparator() {
  const locale = getFormatLocale();
  if (!listSeparatorCache.has(locale)) {
    let separator = ', ';
    if (ARABIC_COMMA_LANGUAGES.has(locale.split('-')[0].toLowerCase())) {
      separator = '، ';
    } else {
      try {
        const parts = new Intl.ListFormat(locale, {
          style: 'long',
          type: 'conjunction',
        }).formatToParts(['a', 'b', 'c']);
        const literal = parts.find((part) => part.type === 'literal')?.value ?? separator;
        // A gap that holds a word is an "and" the labels do not want; a bidi mark is not text.
        const cleaned = literal.replace(/[\u200e\u200f\u061c]/g, '');
        if (cleaned && !/\p{L}/u.test(cleaned)) separator = cleaned;
      } catch {
        // Keep the comma.
      }
    }
    listSeparatorCache.set(locale, separator);
  }
  return listSeparatorCache.get(locale);
}

/**
 * Joins labels with the language's own list separator, never a hard-coded ", " (wrong in Arabic,
 * Chinese and Hindi). There is no "and" before the last item: the labels this joins ("Quick Access
 * and layout", page names) carry one of their own.
 * @param {string[]} items
 */
export function formatList(items) {
  return (Array.isArray(items) ? items : []).map(String).join(getListSeparator());
}

// --- Search and sorting ----------------------------------------------------------------------

/**
 * Compatibility-folds text and drops the marks a search should ignore: Latin accents, Arabic vowel
 * marks and the dot of Turkish "i". Every other combining mark stays, because Hindi vowel signs
 * and the virama are part of the word ("कुत्ता" must not become "कतत").
 *
 * The dotless "ı" is a letter of its own that no decomposition reaches, and lower-casing without a
 * locale turns "I" into "i" ("IŞIK" -> "isik") while a Turkish query keeps "ışık" -> "ısık". It
 * folds to "i" like an accent does, so either spelling, or plain "isik", finds the word.
 * @param {unknown} value
 */
export function foldSearchMarks(value) {
  return String(value ?? '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f\u064b-\u065f\u0670]/g, '')
    .replace(/\u0131/g, 'i');
}

/**
 * Text prepared for a search: compatibility-folded, without accents or Arabic vowel marks, lower
 * case, with punctuation dropped, so "Küche" finds "kuche" and a Chinese or Hindi query stays a
 * query instead of vanishing. Letters and digits of every script are kept.
 * @param {unknown} value
 * @param {{keepDots?: boolean}} [options] - Keep "." so an entity id ("light.kitchen") still reads
 *   as one.
 */
export function normalizeSearchText(value, { keepDots = false } = {}) {
  return foldSearchMarks(value)
    .toLowerCase()
    .replace(/['’`]/g, '')
    .replace(/[_-]/g, ' ')
    .replace(keepDots ? /[^\p{L}\p{N}\p{M}\s.]/gu : /[^\p{L}\p{N}\p{M}\s]/gu, '')
    .replace(/\s+/g, ' ')
    .trim();
}

const collatorCache = new Map();

/**
 * A comparison for sorting names in the user's language ("ä" with "a" in German, after "z" in
 * Swedish), with numbers in natural order ("Room 2" before "Room 10").
 * @returns {(a: string, b: string) => number}
 */
export function getNameCollator() {
  const locale = getFormatLocale();
  let collator = collatorCache.get(locale);
  if (!collator) {
    try {
      collator = new Intl.Collator(locale, { numeric: true, sensitivity: 'base' });
    } catch {
      collator = new Intl.Collator('en', { numeric: true, sensitivity: 'base' });
    }
    collatorCache.set(locale, collator);
  }
  return collator.compare;
}

/** Sorts two names for display in the user's language. */
export function compareNames(a, b) {
  return getNameCollator()(String(a ?? ''), String(b ?? ''));
}

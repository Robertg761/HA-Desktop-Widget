/**
 * Chart options for numeric sensor tiles in Quick Access.
 *
 * A tile can show the 24h line chart (default), a gauge of the current value, or no chart. The
 * gauge needs a range, and most sensors do not declare one, so the range is derived from the
 * best available hint in a fixed order: an explicit override from Tile Settings, `min`/`max`
 * attributes, percent units, a device-class table, the recent history, and finally the current
 * value alone. This module holds only the pure logic; ui.js owns the DOM.
 */

export const SENSOR_TILE_CHART_TYPE_DEFAULT = 'line';

export const SENSOR_TILE_CHART_OPTIONS = Object.freeze([
  Object.freeze({ value: 'line', label: 'Line chart (Default)' }),
  Object.freeze({ value: 'gauge', label: 'Gauge' }),
  Object.freeze({ value: 'none', label: 'No chart' }),
]);

const SENSOR_TILE_CHART_TYPES = new Set(SENSOR_TILE_CHART_OPTIONS.map((option) => option.value));

/**
 * Fixed gauge ranges keyed by sensor `device_class`. Percent-unit sensors are handled before this
 * table is consulted, so only classes with a natural non-percent scale are listed.
 */
export const GAUGE_DEVICE_CLASS_RANGES = Object.freeze({
  battery: Object.freeze([0, 100]),
  humidity: Object.freeze([0, 100]),
  moisture: Object.freeze([0, 100]),
  ph: Object.freeze([0, 14]),
  aqi: Object.freeze([0, 500]),
  uv_index: Object.freeze([0, 11]),
  carbon_dioxide: Object.freeze([400, 2000]),
  wind_direction: Object.freeze([0, 360]),
});

const SIGNAL_STRENGTH_DBM_RANGE = Object.freeze([-100, -30]);

export function normalizeSensorTileChartType(value) {
  if (typeof value !== 'string') return SENSOR_TILE_CHART_TYPE_DEFAULT;
  const normalized = value.trim().toLowerCase();
  return SENSOR_TILE_CHART_TYPES.has(normalized) ? normalized : SENSOR_TILE_CHART_TYPE_DEFAULT;
}

/**
 * Parse a gauge bound from config or a form field. Blank means "automatic" and yields null.
 */
export function normalizeGaugeBound(value) {
  if (value === null || value === undefined) return null;
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) ? parsed : null;
}

function toFiniteNumber(value) {
  if (value === null || value === undefined || value === '') return null;
  const parsed = typeof value === 'number' ? value : Number(String(value).trim());
  return Number.isFinite(parsed) ? parsed : null;
}

function getUnit(entity) {
  const unit = entity?.attributes?.unit_of_measurement;
  return typeof unit === 'string' ? unit.trim() : '';
}

/**
 * Round `value` up to the next "nice" number (1, 2, 2.5, 5, or 10 times a power of ten).
 */
export function niceCeil(value) {
  const magnitude = Math.abs(value);
  if (!Number.isFinite(magnitude) || magnitude === 0) return 0;
  const exponent = Math.floor(Math.log10(magnitude));
  const base = Math.pow(10, exponent);
  const fraction = magnitude / base;
  let nice;
  if (fraction <= 1) nice = 1;
  else if (fraction <= 2) nice = 2;
  else if (fraction <= 2.5) nice = 2.5;
  else if (fraction <= 5) nice = 5;
  else nice = 10;
  const result = nice * base;
  return value < 0 ? -result : result;
}

function resolveRangeFromAttributes(entity) {
  const min = toFiniteNumber(entity?.attributes?.min);
  const max = toFiniteNumber(entity?.attributes?.max);
  if (min === null || max === null || min >= max) return null;
  return { min, max, source: 'attributes' };
}

function resolveRangeFromUnitOrDeviceClass(entity) {
  const unit = getUnit(entity);
  if (unit === '%') return { min: 0, max: 100, source: 'percent' };

  const deviceClass =
    typeof entity?.attributes?.device_class === 'string'
      ? entity.attributes.device_class.trim().toLowerCase()
      : '';
  if (deviceClass === 'signal_strength' && /dbm/i.test(unit)) {
    return {
      min: SIGNAL_STRENGTH_DBM_RANGE[0],
      max: SIGNAL_STRENGTH_DBM_RANGE[1],
      source: 'device-class',
    };
  }
  const tableRange = GAUGE_DEVICE_CLASS_RANGES[deviceClass];
  if (tableRange) return { min: tableRange[0], max: tableRange[1], source: 'device-class' };
  return null;
}

function resolveRangeFromHistory(values) {
  if (!values.length) return null;
  let low = Infinity;
  let high = -Infinity;
  values.forEach((value) => {
    if (value < low) low = value;
    if (value > high) high = value;
  });
  if (!Number.isFinite(low) || !Number.isFinite(high)) return null;

  const span = high - low;
  const padding = span > 0 ? span * 0.1 : Math.max(Math.abs(high) * 0.1, 1);
  let min = low - padding;
  let max = high + padding;
  // Quantities that never went negative should not gain a negative axis from padding.
  if (low >= 0 && min < 0) min = 0;
  if (high <= 0 && max > 0) max = 0;
  if (min >= max) return null;
  return { min, max, source: 'history' };
}

function resolveRangeFromValue(value) {
  if (value === null) return { min: 0, max: 1, source: 'auto' };
  if (value > 0) return { min: 0, max: Math.max(niceCeil(value * 1.25), 1), source: 'auto' };
  if (value < 0) return { min: Math.min(niceCeil(value * 1.25), -1), max: 0, source: 'auto' };
  return { min: 0, max: 1, source: 'auto' };
}

/**
 * Resolve the gauge range for a sensor.
 *
 * @param {object} entity Home Assistant entity state object.
 * @param {object} [options]
 * @param {Array<{value: number}>} [options.series] Recent history samples.
 * @param {number|string|null} [options.min] Custom minimum from Tile Settings.
 * @param {number|string|null} [options.max] Custom maximum from Tile Settings.
 * @returns {{min: number, max: number, source: string}}
 */
export function resolveGaugeRange(entity, { series = [], min = null, max = null } = {}) {
  const customMin = normalizeGaugeBound(min);
  const customMax = normalizeGaugeBound(max);
  if (customMin !== null && customMax !== null && customMin < customMax) {
    return { min: customMin, max: customMax, source: 'custom' };
  }

  const currentValue = toFiniteNumber(entity?.state);
  const historyValues = (Array.isArray(series) ? series : [])
    .map((point) => toFiniteNumber(point?.value))
    .filter((value) => value !== null);
  // The live value joins the history so a fresh reading never sits outside the arc, but a value
  // with no history at all is not "history": it falls through to the nice-ceiling fallback.
  if (historyValues.length && currentValue !== null) historyValues.push(currentValue);

  const derived =
    resolveRangeFromAttributes(entity) ||
    resolveRangeFromUnitOrDeviceClass(entity) ||
    resolveRangeFromHistory(historyValues) ||
    resolveRangeFromValue(currentValue);

  // A single custom bound (or an inverted pair) keeps whichever side is usable and derives the rest.
  let resolvedMin = customMin !== null ? customMin : derived.min;
  let resolvedMax = customMax !== null ? customMax : derived.max;
  let source = derived.source;
  if (customMin !== null && customMax !== null) {
    // Inverted custom bounds: ignore them entirely rather than guess which one the user meant.
    resolvedMin = derived.min;
    resolvedMax = derived.max;
  } else if (customMin !== null || customMax !== null) {
    source = 'custom';
  }
  if (resolvedMin >= resolvedMax) {
    if (customMin !== null && customMax === null) {
      resolvedMax = resolvedMin + Math.max(Math.abs(resolvedMin), 1);
    } else if (customMax !== null && customMin === null) {
      resolvedMin = resolvedMax - Math.max(Math.abs(resolvedMax), 1);
    } else {
      resolvedMax = resolvedMin + 1;
    }
  }
  return { min: resolvedMin, max: resolvedMax, source };
}

export function clampGaugeFraction(value, min, max) {
  const numeric = toFiniteNumber(value);
  if (numeric === null || !Number.isFinite(min) || !Number.isFinite(max) || max <= min) return 0;
  return Math.min(1, Math.max(0, (numeric - min) / (max - min)));
}

function roundCoordinate(value) {
  return Math.round(value * 100) / 100;
}

/**
 * Semicircular gauge geometry for an SVG of `width` x `height` user units.
 *
 * @returns {{cx:number, cy:number, radius:number, trackPath:string, valuePath:string, endX:number, endY:number, fraction:number}}
 */
export function buildGaugeArc({ width, height, fraction, strokeWidth = 6 }) {
  const safeFraction = Number.isFinite(fraction) ? Math.min(1, Math.max(0, fraction)) : 0;
  const cx = width / 2;
  const cy = height - strokeWidth / 2 - 1;
  const radius = Math.max(1, Math.min((width - strokeWidth) / 2 - 1, cy - strokeWidth / 2 - 1));
  const startX = roundCoordinate(cx - radius);
  const endTrackX = roundCoordinate(cx + radius);
  const trackPath = `M ${startX} ${roundCoordinate(cy)} A ${roundCoordinate(radius)} ${roundCoordinate(radius)} 0 0 1 ${endTrackX} ${roundCoordinate(cy)}`;

  const angle = Math.PI * (1 - safeFraction);
  const endX = roundCoordinate(cx + radius * Math.cos(angle));
  const endY = roundCoordinate(cy - radius * Math.sin(angle));
  const valuePath =
    safeFraction > 0
      ? `M ${startX} ${roundCoordinate(cy)} A ${roundCoordinate(radius)} ${roundCoordinate(radius)} 0 0 1 ${endX} ${endY}`
      : '';

  return {
    cx: roundCoordinate(cx),
    cy: roundCoordinate(cy),
    radius: roundCoordinate(radius),
    trackPath,
    valuePath,
    endX,
    endY,
    fraction: safeFraction,
  };
}

/**
 * Compact label for a gauge bound: "0", "100", "1.5k", "-30".
 */
export function formatGaugeBoundLabel(value) {
  const numeric = toFiniteNumber(value);
  if (numeric === null) return '';
  const magnitude = Math.abs(numeric);
  const trim = (text) => text.replace(/\.0+$/, '').replace(/(\.\d*?)0+$/, '$1');
  if (magnitude >= 1e6) return `${trim((numeric / 1e6).toFixed(1))}M`;
  if (magnitude >= 1e4) return `${trim((numeric / 1e3).toFixed(1))}k`;
  if (magnitude >= 100) return String(Math.round(numeric));
  if (magnitude >= 10) return trim(numeric.toFixed(1));
  return trim(numeric.toFixed(2));
}

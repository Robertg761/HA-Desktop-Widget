const {
  SENSOR_TILE_CHART_OPTIONS,
  buildGaugeArc,
  clampGaugeFraction,
  formatGaugeBoundLabel,
  niceCeil,
  normalizeGaugeBound,
  normalizeSensorTileChartType,
  resolveGaugeRange,
} = require('../../src/sensor-gauge.js');

const sensor = (state, attributes = {}) => ({
  entity_id: 'sensor.test',
  state: String(state),
  attributes,
});

describe('sensor-gauge', () => {
  describe('normalizeSensorTileChartType', () => {
    it('accepts every listed chart option and falls back to line', () => {
      SENSOR_TILE_CHART_OPTIONS.forEach((option) => {
        expect(normalizeSensorTileChartType(option.value)).toBe(option.value);
      });
      expect(normalizeSensorTileChartType(' Gauge ')).toBe('gauge');
      expect(normalizeSensorTileChartType('pie')).toBe('line');
      expect(normalizeSensorTileChartType(undefined)).toBe('line');
      expect(normalizeSensorTileChartType(42)).toBe('line');
    });
  });

  describe('normalizeGaugeBound', () => {
    it('parses numbers and numeric strings, and treats blanks as automatic', () => {
      expect(normalizeGaugeBound(12)).toBe(12);
      expect(normalizeGaugeBound(' -3.5 ')).toBe(-3.5);
      expect(normalizeGaugeBound('')).toBeNull();
      expect(normalizeGaugeBound('   ')).toBeNull();
      expect(normalizeGaugeBound(null)).toBeNull();
      expect(normalizeGaugeBound('abc')).toBeNull();
      expect(normalizeGaugeBound(NaN)).toBeNull();
      expect(normalizeGaugeBound(Infinity)).toBeNull();
      expect(normalizeGaugeBound({})).toBeNull();
    });
  });

  describe('resolveGaugeRange', () => {
    it('prefers a valid custom range over every other hint', () => {
      const entity = sensor(50, { unit_of_measurement: '%', min: 10, max: 20 });
      expect(resolveGaugeRange(entity, { min: -5, max: 5 })).toEqual({
        min: -5,
        max: 5,
        source: 'custom',
      });
    });

    it('uses min/max attributes when present', () => {
      expect(resolveGaugeRange(sensor(3, { min: 1, max: 7 }))).toEqual({
        min: 1,
        max: 7,
        source: 'attributes',
      });
    });

    it('treats percent units as 0-100', () => {
      expect(resolveGaugeRange(sensor(63, { unit_of_measurement: '%' }))).toEqual({
        min: 0,
        max: 100,
        source: 'percent',
      });
    });

    it('applies device-class ranges, including dBm signal strength', () => {
      expect(resolveGaugeRange(sensor(7.2, { device_class: 'ph' }))).toEqual({
        min: 0,
        max: 14,
        source: 'device-class',
      });
      expect(
        resolveGaugeRange(
          sensor(-67, { device_class: 'signal_strength', unit_of_measurement: 'dBm' })
        )
      ).toEqual({ min: -100, max: -30, source: 'device-class' });
      expect(
        resolveGaugeRange(
          sensor(-67, { device_class: 'signal_strength', unit_of_measurement: 'dB' })
        ).source
      ).not.toBe('device-class');
    });

    it('derives a padded range from history and the live value', () => {
      const range = resolveGaugeRange(sensor(22, { unit_of_measurement: '°C' }), {
        series: [{ value: 18 }, { value: 20 }, { value: 'bad' }],
      });
      expect(range.source).toBe('history');
      expect(range.min).toBeCloseTo(17.6);
      expect(range.max).toBeCloseTo(22.4);
    });

    it('does not pad non-negative history below zero', () => {
      const range = resolveGaugeRange(sensor(1, { unit_of_measurement: 'W' }), {
        series: [{ value: 0 }, { value: 0.5 }],
      });
      expect(range.min).toBe(0);
      expect(range.max).toBeCloseTo(1.1);
    });

    it('falls back to a nice ceiling from the current value alone', () => {
      expect(resolveGaugeRange(sensor(340, { unit_of_measurement: 'W' }))).toEqual({
        min: 0,
        max: 500,
        source: 'auto',
      });
      expect(resolveGaugeRange(sensor(-12))).toEqual({ min: -20, max: 0, source: 'auto' });
      expect(resolveGaugeRange(sensor(0))).toEqual({ min: 0, max: 1, source: 'auto' });
      expect(resolveGaugeRange(sensor('unknown'))).toEqual({ min: 0, max: 1, source: 'auto' });
    });

    it('combines a single custom bound with the derived side', () => {
      const entity = sensor(40, { unit_of_measurement: '%' });
      expect(resolveGaugeRange(entity, { min: 20 })).toEqual({
        min: 20,
        max: 100,
        source: 'custom',
      });
      expect(resolveGaugeRange(entity, { max: '80' })).toEqual({
        min: 0,
        max: 80,
        source: 'custom',
      });
    });

    it('ignores inverted custom bounds and never returns an empty span', () => {
      const entity = sensor(40, { unit_of_measurement: '%' });
      expect(resolveGaugeRange(entity, { min: 90, max: 10 })).toEqual({
        min: 0,
        max: 100,
        source: 'percent',
      });
      const widened = resolveGaugeRange(entity, { min: 150 });
      expect(widened.max).toBeGreaterThan(widened.min);
    });
  });

  describe('clampGaugeFraction', () => {
    it('maps values into 0..1 and clamps outside the range', () => {
      expect(clampGaugeFraction(50, 0, 100)).toBe(0.5);
      expect(clampGaugeFraction(-10, 0, 100)).toBe(0);
      expect(clampGaugeFraction(250, 0, 100)).toBe(1);
      expect(clampGaugeFraction('75', 0, 100)).toBe(0.75);
      expect(clampGaugeFraction('n/a', 0, 100)).toBe(0);
      expect(clampGaugeFraction(5, 10, 10)).toBe(0);
    });
  });

  describe('buildGaugeArc', () => {
    it('builds a semicircle that fits the viewBox', () => {
      const arc = buildGaugeArc({ width: 96, height: 32, fraction: 0.5, strokeWidth: 6 });
      expect(arc.cx).toBe(48);
      expect(arc.cy).toBe(28);
      expect(arc.radius).toBe(24);
      expect(arc.trackPath).toBe('M 24 28 A 24 24 0 0 1 72 28');
      expect(arc.endX).toBeCloseTo(48);
      expect(arc.endY).toBeCloseTo(4);
      expect(arc.valuePath.startsWith('M 24 28 A 24 24 0 0 1 ')).toBe(true);
    });

    it('draws no value arc at zero and ends at the track end at one', () => {
      expect(buildGaugeArc({ width: 96, height: 32, fraction: 0 }).valuePath).toBe('');
      const full = buildGaugeArc({ width: 96, height: 32, fraction: 1 });
      expect(full.endX).toBe(72);
      expect(full.endY).toBe(28);
      expect(buildGaugeArc({ width: 96, height: 32, fraction: NaN }).fraction).toBe(0);
      expect(buildGaugeArc({ width: 96, height: 32, fraction: 4 }).fraction).toBe(1);
    });
  });

  describe('labels and rounding', () => {
    it('rounds up to nice numbers', () => {
      expect(niceCeil(0)).toBe(0);
      expect(niceCeil(1)).toBe(1);
      expect(niceCeil(1.4)).toBe(2);
      expect(niceCeil(2.2)).toBe(2.5);
      expect(niceCeil(3)).toBe(5);
      expect(niceCeil(7)).toBe(10);
      expect(niceCeil(425)).toBe(500);
      expect(niceCeil(-425)).toBe(-500);
    });

    it('formats bound labels compactly', () => {
      expect(formatGaugeBoundLabel(0)).toBe('0');
      expect(formatGaugeBoundLabel(100)).toBe('100');
      expect(formatGaugeBoundLabel(17.6)).toBe('17.6');
      expect(formatGaugeBoundLabel(2.25)).toBe('2.25');
      expect(formatGaugeBoundLabel(15000)).toBe('15k');
      expect(formatGaugeBoundLabel(2500000)).toBe('2.5M');
      expect(formatGaugeBoundLabel(-30)).toBe('-30');
      expect(formatGaugeBoundLabel('x')).toBe('');
    });
  });
});

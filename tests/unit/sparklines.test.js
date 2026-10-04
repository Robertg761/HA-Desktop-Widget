const { buildSparklinePoints } = require('../../src/sparklines.js');

describe('buildSparklinePoints', () => {
  it('returns an empty point string for an empty series', () => {
    expect(buildSparklinePoints([], 100, 40)).toBe('');
  });

  it('centers a single value', () => {
    expect(buildSparklinePoints([42], 100, 40)).toBe('50,20');
  });

  it('centers flat series without dividing by zero', () => {
    expect(buildSparklinePoints([5, 5, 5], 100, 40)).toBe('0,20 50,20 100,20');
  });

  it('scales a normal series across the sparkline box', () => {
    expect(buildSparklinePoints([0, 50, 100], 100, 40)).toBe('0,40 50,20 100,0');
  });
});

describe('buildSparklinePoints with a long series', () => {
  const { SPARKLINE_MAX_POINTS } = require('../../src/sparklines.js');
  const pointCount = (points) => (points ? points.split(' ').length : 0);

  // A reading every second for two days: ~172k values, past the ~125k where spreading them into
  // Math.min overflows the stack.
  const longSeries = (length = 200000) =>
    Array.from({ length }, (_value, index) => 50 + Math.sin(index / 5000) * 10);

  it('does not throw for 200,000 values and draws a bounded number of points', () => {
    const points = buildSparklinePoints(longSeries(), 96, 24);

    expect(pointCount(points)).toBeLessThanOrEqual(SPARKLINE_MAX_POINTS);
    expect(pointCount(points)).toBeGreaterThan(50);
  });

  it('keeps a spike and a dip that a plain every-nth thinning would skip', () => {
    const values = longSeries(100000);
    values[33333] = 500;
    values[77777] = -500;

    const ys = buildSparklinePoints(values, 100, 40)
      .split(' ')
      .map((pair) => Number(pair.split(',')[1]));

    expect(Math.min(...ys)).toBe(0);
    expect(Math.max(...ys)).toBe(40);
  });

  it('starts and ends on the first and last value, in time order', () => {
    const values = Array.from({ length: 5000 }, (_value, index) => index);

    const points = buildSparklinePoints(values, 100, 40)
      .split(' ')
      .map((pair) => pair.split(',').map(Number));

    expect(points[0]).toEqual([0, 40]);
    expect(points[points.length - 1]).toEqual([100, 0]);
    for (let index = 1; index < points.length; index += 1) {
      expect(points[index][0]).toBeGreaterThan(points[index - 1][0]);
      expect(points[index][1]).toBeLessThanOrEqual(points[index - 1][1]);
    }
  });

  it('leaves a short series exactly as it was', () => {
    const values = Array.from({ length: SPARKLINE_MAX_POINTS }, (_value, index) => index % 7);

    expect(pointCount(buildSparklinePoints(values, 100, 40))).toBe(SPARKLINE_MAX_POINTS);
  });

  it('honours a smaller limit', () => {
    const points = buildSparklinePoints(longSeries(1000), 96, 24, { maxPoints: 20 });

    expect(pointCount(points)).toBeLessThanOrEqual(20);
  });
});

describe('cached history series', () => {
  const {
    MAX_CACHED_HISTORY_POINTS,
    appendHistoryPoint,
    compactHistorySeries,
  } = require('../../src/sparklines.js');
  const at = (minutes, value = minutes) => ({ value, timestamp: minutes * 60000 });
  const range = (from, to) => Array.from({ length: to - from + 1 }, (_v, i) => at(from + i));

  describe('compactHistorySeries', () => {
    it('keeps the first and last readings and the extremes of a very long series', () => {
      const series = Array.from({ length: 86400 }, (_v, index) => ({
        value: 20 + Math.sin(index / 3000),
        timestamp: index * 1000,
      }));
      series[40000] = { value: 99, timestamp: 40000 * 1000 };
      series[60000] = { value: -99, timestamp: 60000 * 1000 };

      const compact = compactHistorySeries(series);

      expect(compact.length).toBeLessThanOrEqual(MAX_CACHED_HISTORY_POINTS);
      expect(compact[0]).toBe(series[0]);
      expect(compact[compact.length - 1]).toBe(series[series.length - 1]);
      expect(Math.max(...compact.map((point) => point.value))).toBe(99);
      expect(Math.min(...compact.map((point) => point.value))).toBe(-99);
      const times = compact.map((point) => point.timestamp);
      expect(times).toEqual([...times].sort((a, b) => a - b));
    });

    it('returns a short series itself', () => {
      const series = range(0, 10);

      expect(compactHistorySeries(series)).toBe(series);
    });
  });

  describe('appendHistoryPoint', () => {
    it('pushes a newer reading onto the series it was given', () => {
      const series = range(0, 3);

      const result = appendHistoryPoint(series, at(4), { cutoff: -1 });

      expect(result).toBe(series);
      expect(series.map((point) => point.timestamp / 60000)).toEqual([0, 1, 2, 3, 4]);
    });

    it('drops what left the window but keeps the newest reading before it as the boundary', () => {
      const series = range(0, 9);

      appendHistoryPoint(series, at(10), { cutoff: 5.5 * 60000 });

      expect(series.map((point) => point.timestamp / 60000)).toEqual([5, 6, 7, 8, 9, 10]);
    });

    it('counts a reading exactly on the window edge as inside it', () => {
      const series = range(0, 9);

      appendHistoryPoint(series, at(10), { cutoff: 5 * 60000 });

      // 5 is in the window, so the boundary is the reading before it.
      expect(series.map((point) => point.timestamp / 60000)).toEqual([4, 5, 6, 7, 8, 9, 10]);
    });

    it('keeps what rebuilding the series from scratch would keep', () => {
      const cutoff = 37.5 * 60000;
      const series = range(0, 60);
      const rebuilt = [...series, at(61)].filter((point, index, all) => {
        const next = all[index + 1];
        // The window's contents, plus the newest reading before it.
        return point.timestamp >= cutoff || (next && next.timestamp >= cutoff);
      });

      appendHistoryPoint(series, at(61), { cutoff });

      expect(series).toEqual(rebuilt);
      expect(series[0].timestamp).toBe(37 * 60000);
    });

    it('puts an older reading where it belongs', () => {
      const series = [at(0), at(2), at(4)];

      appendHistoryPoint(series, at(3, 99), { cutoff: -1 });

      expect(series.map((point) => point.timestamp / 60000)).toEqual([0, 2, 3, 4]);
      expect(series[2].value).toBe(99);
    });

    it('starts a series from nothing', () => {
      expect(appendHistoryPoint([], at(1), { cutoff: 0 })).toEqual([at(1)]);
    });

    it('thins a series that has grown far past the limit, once', () => {
      const series = range(0, 100);

      const result = appendHistoryPoint(series, at(101), { cutoff: -1, maxPoints: 20 });

      expect(result.length).toBeLessThanOrEqual(20);
      expect(result[0].timestamp).toBe(0);
      expect(result[result.length - 1].timestamp).toBe(101 * 60000);

      // Below twice the limit nothing is rebuilt, so a series resting at the limit stays cheap.
      const settled = range(0, 30);
      expect(appendHistoryPoint(settled, at(31), { cutoff: -1, maxPoints: 20 })).toBe(settled);
    });
  });
});

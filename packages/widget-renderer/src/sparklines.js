function formatSparklineCoordinate(value) {
  const rounded = Math.round(value * 100) / 100;
  if (Object.is(rounded, -0)) return '0';
  return Number.isInteger(rounded) ? String(rounded) : String(Number(rounded.toFixed(2)));
}

// A tile's line is drawn about a hundred pixels wide, so a vertex per recorded row is detail nobody
// can see. A power sensor reporting every second records 86,400 rows a day: drawing all of them
// put a megabyte of coordinates in the DOM, took 50 to 170 ms of the main thread on every update,
// and past ~125,000 rows made Math.min(...values) throw a RangeError, so the line vanished.
const SPARKLINE_MAX_POINTS = 240;

// What a series cached for drawing is kept down to. It holds a day of readings that are only ever
// drawn small, so there is no reason to hold, copy and sort tens of thousands of them.
const MAX_CACHED_HISTORY_POINTS = 2000;

/**
 * Thins a chronological series to at most `maxPoints` entries by keeping the lowest and highest of
 * each stretch of it, in order, plus the first and last entry. Unlike taking every n-th entry, a
 * spike or a dip survives, so the line still shows the day's extremes.
 *
 * @template T
 * @param {T[]} items - Chronological items.
 * @param {(item: T) => number} getValue - The number each item is drawn at.
 * @param {number} maxPoints - The most items to return.
 * @returns {T[]} `items` itself when it is already short enough.
 */
function keepBucketExtremes(items, getValue, maxPoints) {
  const count = items.length;
  if (count <= maxPoints || maxPoints < 4) return items;

  const bucketCount = Math.floor((maxPoints - 2) / 2);
  const bucketSize = (count - 2) / bucketCount;
  const thinned = [items[0]];
  for (let bucket = 0; bucket < bucketCount; bucket += 1) {
    const from = 1 + Math.floor(bucket * bucketSize);
    const to = Math.min(count - 1, 1 + Math.floor((bucket + 1) * bucketSize));
    let lowest = from;
    let highest = from;
    let lowestValue = getValue(items[from]);
    let highestValue = lowestValue;
    for (let index = from + 1; index < to; index += 1) {
      const value = getValue(items[index]);
      if (value < lowestValue) {
        lowestValue = value;
        lowest = index;
      }
      if (value > highestValue) {
        highestValue = value;
        highest = index;
      }
    }
    if (lowest === highest) thinned.push(items[lowest]);
    else if (lowest < highest) thinned.push(items[lowest], items[highest]);
    else thinned.push(items[highest], items[lowest]);
  }
  thinned.push(items[count - 1]);
  return thinned;
}

/**
 * Thins a cached history series ({ value, timestamp } entries, oldest first).
 *
 * @param {Array<{value: number, timestamp: number}>} series
 * @param {number} [maxPoints]
 */
function compactHistorySeries(series, maxPoints = MAX_CACHED_HISTORY_POINTS) {
  return keepBucketExtremes(series, (point) => point.value, maxPoints);
}

/**
 * Adds a live reading to a cached history series without rebuilding it.
 *
 * Readings arrive in time order, so the common case is a push and a trim of whatever has left the
 * window, instead of copying and sorting a day of readings on every update. The newest reading
 * older than the window stays as its first entry, so the line still starts at the window edge. A
 * reading that is older than the last one is put in its place.
 *
 * @param {Array<{value: number, timestamp: number}>} series - Oldest first. Changed in place.
 * @param {{value: number, timestamp: number}} point
 * @param {{cutoff: number, maxPoints?: number}} options - `cutoff` is the start of the window.
 * @returns {Array<{value: number, timestamp: number}>} The series to keep.
 */
function appendHistoryPoint(series, point, { cutoff, maxPoints = MAX_CACHED_HISTORY_POINTS } = {}) {
  const last = series[series.length - 1];
  if (last && point.timestamp < last.timestamp) {
    let position = series.length;
    while (position > 0 && series[position - 1].timestamp > point.timestamp) position -= 1;
    series.splice(position, 0, point);
  } else {
    series.push(point);
  }

  let stale = 0;
  while (stale + 1 < series.length && series[stale + 1].timestamp < cutoff) stale += 1;
  if (stale > 0) series.splice(0, stale);

  // Compacted well past the limit, not at it, so a series sitting at the limit does not do the
  // work again for each reading.
  return series.length > maxPoints * 2 ? compactHistorySeries(series, maxPoints) : series;
}

function buildSparklinePoints(values, width, height, { maxPoints = SPARKLINE_MAX_POINTS } = {}) {
  const finiteValues = Array.isArray(values) ? values.map(Number).filter(Number.isFinite) : [];
  const chartWidth = Number(width);
  const chartHeight = Number(height);

  if (
    !finiteValues.length ||
    !Number.isFinite(chartWidth) ||
    !Number.isFinite(chartHeight) ||
    chartWidth <= 0 ||
    chartHeight <= 0
  ) {
    return '';
  }

  if (finiteValues.length === 1) {
    return `${formatSparklineCoordinate(chartWidth / 2)},${formatSparklineCoordinate(chartHeight / 2)}`;
  }

  const numericValues = keepBucketExtremes(finiteValues, (value) => value, maxPoints);

  // A loop, not Math.min(...values): spreading a long array overflows the call stack.
  let min = numericValues[0];
  let max = numericValues[0];
  for (let index = 1; index < numericValues.length; index += 1) {
    if (numericValues[index] < min) min = numericValues[index];
    if (numericValues[index] > max) max = numericValues[index];
  }
  const range = max - min;

  return numericValues
    .map((value, index) => {
      const x = (chartWidth * index) / (numericValues.length - 1);
      const y = range === 0 ? chartHeight / 2 : chartHeight - ((value - min) / range) * chartHeight;
      return `${formatSparklineCoordinate(x)},${formatSparklineCoordinate(y)}`;
    })
    .join(' ');
}

export {
  MAX_CACHED_HISTORY_POINTS,
  SPARKLINE_MAX_POINTS,
  appendHistoryPoint,
  buildSparklinePoints,
  compactHistorySeries,
  keepBucketExtremes,
};

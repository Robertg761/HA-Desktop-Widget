import { getFavoriteEntityUnion } from './quick-access-tabs.js';

const COMPARISON_GRAPH_ID_PREFIX = 'graph:';
const DEFAULT_COMPARISON_GRAPH_NAME = 'Comparison Graph';
const MAX_COMPARISON_GRAPH_SERIES = 7;

// How many grid columns the graph tile occupies. One column would be too narrow to read a
// multi-series chart, so the range starts at two.
const COMPARISON_GRAPH_SPAN_OPTIONS = [2, 3, 4];
const DEFAULT_COMPARISON_GRAPH_SPAN = 2;

// Series colours are assigned by slot, never generated or cycled. Both columns were validated
// against the widget's composited card surfaces (light #f7f7fa, dark #212127) for lightness band,
// chroma floor, colour-vision separation and contrast. Changing a value means re-validating the set.
const SERIES_COLORS_LIGHT = [
  '#2a78d6',
  '#1baf7a',
  '#eda100',
  '#4a3aa7',
  '#e34948',
  '#e87ba4',
  '#eb6834',
];
const SERIES_COLORS_DARK = [
  '#3987e5',
  '#199e70',
  '#c98500',
  '#9085e9',
  '#e66767',
  '#d55181',
  '#d95926',
];

// Some entities carry the number you want to plot in an attribute rather than in their state — a
// weather entity's state is "partlycloudy" and its temperature is an attribute. Without this, the
// outside temperature (the whole point of a comparison graph) would not be graphable at all.
const GRAPH_SERIES_ATTRIBUTE_BY_DOMAIN = {
  weather: 'temperature',
  climate: 'current_temperature',
};

function isObject(value) {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function isComparisonGraphId(value) {
  return typeof value === 'string' && value.startsWith(COMPARISON_GRAPH_ID_PREFIX);
}

function getEntityDomain(entityId) {
  return typeof entityId === 'string' && entityId.includes('.') ? entityId.split('.')[0] : '';
}

/** The attribute a series reads instead of the entity state, or null when the state is the value. */
function getGraphSeriesAttribute(entityId) {
  return GRAPH_SERIES_ATTRIBUTE_BY_DOMAIN[getEntityDomain(entityId)] || null;
}

function toFiniteNumber(raw) {
  const value = Number(typeof raw === 'string' ? raw.trim() : raw);
  return Number.isFinite(value) ? value : null;
}

/** The current numeric value of a series, from the state or from its domain's attribute. */
function readGraphSeriesValue(entity) {
  if (!isObject(entity)) return null;
  const attribute = getGraphSeriesAttribute(entity.entity_id);
  return toFiniteNumber(attribute ? entity.attributes?.[attribute] : entity.state);
}

function readGraphSeriesUnit(entity, { fallbackTemperatureUnit = '' } = {}) {
  if (!isObject(entity)) return '';
  // Both attribute-backed domains expose temperatures, so they share the temperature unit.
  if (getGraphSeriesAttribute(entity.entity_id)) {
    return entity.attributes?.temperature_unit || fallbackTemperatureUnit || '';
  }
  return entity.attributes?.unit_of_measurement || '';
}

/** Can this entity be plotted at all? Numeric sensors, plus the attribute-backed domains above. */
function isGraphableEntity(entity) {
  const entityId = entity?.entity_id;
  if (typeof entityId !== 'string') return false;
  const domain = getEntityDomain(entityId);
  if (domain !== 'sensor' && !GRAPH_SERIES_ATTRIBUTE_BY_DOMAIN[domain]) return false;
  return readGraphSeriesValue(entity) !== null;
}

function normalizeEntityIds(value) {
  if (!Array.isArray(value)) return [];
  const seen = new Set();
  return value.reduce((acc, entityId) => {
    if (typeof entityId !== 'string') return acc;
    const trimmed = entityId.trim();
    // A graph can never plot another graph.
    if (!trimmed || seen.has(trimmed) || isComparisonGraphId(trimmed)) return acc;
    seen.add(trimmed);
    acc.push(trimmed);
    return acc;
  }, []);
}

function normalizeGraphName(name, fallback = DEFAULT_COMPARISON_GRAPH_NAME) {
  if (typeof name !== 'string') return fallback;
  const trimmed = name.trim();
  return trimmed || fallback;
}

function normalizeGraphSpan(span, fallback = DEFAULT_COMPARISON_GRAPH_SPAN) {
  const value = Number(span);
  return COMPARISON_GRAPH_SPAN_OPTIONS.includes(value) ? value : fallback;
}

function makeUniqueGraphId(baseId, usedIds) {
  let candidate = baseId;
  let suffix = 2;
  while (usedIds.has(candidate)) {
    candidate = `${baseId}-${suffix}`;
    suffix += 1;
  }
  usedIds.add(candidate);
  return candidate;
}

function normalizeGraphId(id, index, usedIds) {
  const raw = typeof id === 'string' ? id.trim() : '';
  const base = isComparisonGraphId(raw) ? raw : `${COMPARISON_GRAPH_ID_PREFIX}${index + 1}`;
  return makeUniqueGraphId(base, usedIds);
}

/**
 * Normalizes `config.comparisonGraphs` and reconciles it with the Quick Access tabs that
 * reference the graphs as tiles. Two orphan cases are garbage-collected here, because either
 * one renders as a broken "unavailable" tile:
 *   - a graph id sitting in a tab with no matching graph  -> drop the id from the tab
 *   - a graph referenced by no tab at all                 -> drop the graph
 */
function normalizeComparisonGraphsConfig(config, options = {}) {
  const source = isObject(config) ? config : {};
  const rawGraphs = Array.isArray(source.comparisonGraphs) ? source.comparisonGraphs : [];
  const usedIds = new Set();

  const graphs = rawGraphs.reduce((acc, rawGraph, index) => {
    if (!isObject(rawGraph)) return acc;
    acc.push({
      id: normalizeGraphId(rawGraph.id, index, usedIds),
      name: normalizeGraphName(rawGraph.name),
      span: normalizeGraphSpan(rawGraph.span),
      entityIds: normalizeEntityIds(rawGraph.entityIds).slice(0, MAX_COMPARISON_GRAPH_SERIES),
    });
    return acc;
  }, []);

  const rawTabs = Array.isArray(source.customTabs) ? source.customTabs : [];
  const knownGraphIds = new Set(graphs.map((graph) => graph.id));
  const referencedGraphIds = new Set();

  const customTabs = rawTabs.map((tab) => {
    if (!isObject(tab) || !Array.isArray(tab.entityIds)) return tab;
    const entityIds = tab.entityIds.filter((entityId) => {
      if (!isComparisonGraphId(entityId)) return true;
      if (!knownGraphIds.has(entityId)) return false;
      referencedGraphIds.add(entityId);
      return true;
    });
    return entityIds.length === tab.entityIds.length ? tab : { ...tab, entityIds };
  });

  const liveGraphs = graphs.filter((graph) => referencedGraphIds.has(graph.id));

  const normalizedConfig = {
    ...source,
    comparisonGraphs: liveGraphs,
    customTabs,
    favoriteEntities: getFavoriteEntityUnion(customTabs),
  };

  if (options.withChanged) {
    const changed =
      JSON.stringify({
        comparisonGraphs: source.comparisonGraphs,
        customTabs: source.customTabs,
      }) !==
      JSON.stringify({
        comparisonGraphs: normalizedConfig.comparisonGraphs,
        customTabs: normalizedConfig.customTabs,
      });
    return { config: normalizedConfig, changed };
  }

  return normalizedConfig;
}

function getComparisonGraphs(config) {
  const source = isObject(config) ? config : {};
  return Array.isArray(source.comparisonGraphs) ? source.comparisonGraphs : [];
}

function getComparisonGraph(config, graphId) {
  return getComparisonGraphs(config).find((graph) => graph.id === graphId) || null;
}

/** Every entity plotted by any graph — used to keep live state updates flowing to graph members. */
function getComparisonGraphEntityIds(config) {
  const seen = new Set();
  return getComparisonGraphs(config).reduce((acc, graph) => {
    normalizeEntityIds(graph?.entityIds).forEach((entityId) => {
      if (seen.has(entityId)) return;
      seen.add(entityId);
      acc.push(entityId);
    });
    return acc;
  }, []);
}

function addComparisonGraph(config, { name, entityIds, span, tabId, idFactory } = {}) {
  const source = isObject(config) ? config : {};
  const graphs = getComparisonGraphs(source);
  const usedIds = new Set(graphs.map((graph) => graph.id));
  const mintId =
    typeof idFactory === 'function'
      ? idFactory
      : () => `${COMPARISON_GRAPH_ID_PREFIX}${Date.now().toString(36)}`;
  const id = makeUniqueGraphId(normalizeGraphId(mintId(), graphs.length, new Set()), usedIds);

  const graph = {
    id,
    name: normalizeGraphName(name),
    span: normalizeGraphSpan(span),
    entityIds: normalizeEntityIds(entityIds).slice(0, MAX_COMPARISON_GRAPH_SERIES),
  };

  const rawTabs = Array.isArray(source.customTabs) ? source.customTabs : [];
  const targetTabId = rawTabs.some((tab) => isObject(tab) && tab.id === tabId)
    ? tabId
    : rawTabs.find(isObject)?.id;

  const customTabs = rawTabs.map((tab) =>
    isObject(tab) && tab.id === targetTabId
      ? { ...tab, entityIds: [...(Array.isArray(tab.entityIds) ? tab.entityIds : []), id] }
      : tab
  );

  return normalizeComparisonGraphsConfig({
    ...source,
    comparisonGraphs: [...graphs, graph],
    customTabs,
  });
}

function updateComparisonGraph(config, graphId, changes = {}) {
  const source = isObject(config) ? config : {};
  const graphs = getComparisonGraphs(source);
  if (!graphs.some((graph) => graph.id === graphId)) return normalizeComparisonGraphsConfig(source);

  return normalizeComparisonGraphsConfig({
    ...source,
    comparisonGraphs: graphs.map((graph) => {
      if (graph.id !== graphId) return graph;
      return {
        ...graph,
        name: Object.prototype.hasOwnProperty.call(changes, 'name')
          ? normalizeGraphName(changes.name, graph.name)
          : graph.name,
        span: Object.prototype.hasOwnProperty.call(changes, 'span')
          ? normalizeGraphSpan(changes.span, graph.span)
          : graph.span,
        entityIds: Object.prototype.hasOwnProperty.call(changes, 'entityIds')
          ? normalizeEntityIds(changes.entityIds).slice(0, MAX_COMPARISON_GRAPH_SERIES)
          : graph.entityIds,
      };
    }),
  });
}

function removeComparisonGraph(config, graphId) {
  const source = isObject(config) ? config : {};
  const rawTabs = Array.isArray(source.customTabs) ? source.customTabs : [];

  return normalizeComparisonGraphsConfig({
    ...source,
    comparisonGraphs: getComparisonGraphs(source).filter((graph) => graph.id !== graphId),
    customTabs: rawTabs.map((tab) =>
      isObject(tab) && Array.isArray(tab.entityIds)
        ? { ...tab, entityIds: tab.entityIds.filter((entityId) => entityId !== graphId) }
        : tab
    ),
  });
}

/**
 * Colour slot for a series, 1-based. `index` is the entity's position in the graph's persisted
 * entityIds — never its position among the currently *visible* series, so hiding one series must
 * not repaint the others.
 */
function getSeriesColorSlot(index) {
  if (!Number.isInteger(index) || index < 0 || index >= MAX_COMPARISON_GRAPH_SERIES) return null;
  return index + 1;
}

function groupSeriesByUnit(entries) {
  const groups = [];
  const byUnit = new Map();

  (Array.isArray(entries) ? entries : []).forEach((entry) => {
    if (!isObject(entry) || typeof entry.entityId !== 'string') return;
    const unit = typeof entry.unit === 'string' ? entry.unit.trim() : '';
    if (!byUnit.has(unit)) {
      const group = { unit, entityIds: [] };
      byUnit.set(unit, group);
      groups.push(group);
    }
    byUnit.get(unit).entityIds.push(entry.entityId);
  });

  return { groups, hasMismatch: groups.length > 1 };
}

/**
 * Splits a series into the spans that were MEASURED and the spans whose value is merely HELD.
 *
 * Entities report at different times, so a line's samples rarely reach either edge of the window.
 * A Home Assistant state persists until it changes, so the value at the edges is known — but
 * nothing was *recorded* there. Drawing those spans identically to real samples overstates what we
 * know, and leaving them out makes the lines start and end at different x positions so they can't
 * be compared. So they are rendered, and rendered differently (dashed).
 *
 *  - `lead`: window start → first sample inside the window, at the value the entity held then.
 *  - `measured`: the samples actually recorded inside the window.
 *  - `trail`: last recorded sample → now, holding that reading.
 *
 * @param {Array<{value: number, timestamp: number}>} series - May include one sample from before
 *   the window (the boundary state), which is what makes `lead` possible.
 * @param {{start: number, end: number}} timeDomain
 * @returns {{lead: Array<Object>, measured: Array<Object>, trail: Array<Object>}}
 */
function splitSeriesAtWindow(series, timeDomain) {
  const empty = { lead: [], measured: [], trail: [] };
  if (!isObject(timeDomain)) return empty;

  const start = Number(timeDomain.start);
  const end = Number(timeDomain.end);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return empty;

  const ordered = toFinitePoints(series)
    .slice()
    .sort((a, b) => Number(a.timestamp) - Number(b.timestamp));
  if (!ordered.length) return empty;

  const measured = ordered.filter(
    (p) => Number(p.timestamp) >= start && Number(p.timestamp) <= end
  );
  const boundary = ordered.filter((p) => Number(p.timestamp) < start).pop();

  // Nothing was recorded inside the window: the entity simply held one value throughout.
  if (!measured.length) {
    if (!boundary) return empty;
    return {
      lead: [],
      measured: [],
      trail: [
        { value: boundary.value, timestamp: start },
        { value: boundary.value, timestamp: end },
      ],
    };
  }

  const first = measured[0];
  const last = measured[measured.length - 1];

  // Without a boundary sample the entity has no known state at the window start (it may not have
  // existed yet), so there is nothing to draw there — inventing one would be fabrication.
  const lead =
    boundary && Number(first.timestamp) > start
      ? [{ value: boundary.value, timestamp: start }, first]
      : [];

  const trail = Number(last.timestamp) < end ? [last, { value: last.value, timestamp: end }] : [];

  return { lead, measured, trail };
}

function toFinitePoints(series) {
  return (Array.isArray(series) ? series : []).filter(
    (point) =>
      isObject(point) &&
      Number.isFinite(Number(point.value)) &&
      Number.isFinite(Number(point.timestamp))
  );
}

/**
 * The time axis is shared by every series so curves with different sample counts stay comparable.
 * It is anchored to the wall clock (now - windowMs .. now), not to the data, so a sensor that
 * stopped reporting visibly stops rather than being stretched across the full width.
 */
function computeTimeDomain({ now, windowMs } = {}) {
  const end = Number(now);
  const span = Number(windowMs);
  if (!Number.isFinite(end) || !Number.isFinite(span) || span <= 0) return null;
  return { start: end - span, end };
}

/** One shared value domain, so overlaid series are read against the same scale. */
function computeValueDomain(seriesList, { padding = 0.05 } = {}) {
  const values = (Array.isArray(seriesList) ? seriesList : []).flatMap((series) =>
    toFinitePoints(series).map((point) => Number(point.value))
  );

  if (!values.length) return null;

  const min = Math.min(...values);
  const max = Math.max(...values);

  // A flat series has no range to divide by; give it a band so it renders as a centred line.
  if (min === max) {
    const bump = Math.abs(min) > 0 ? Math.abs(min) * 0.05 : 0.5;
    return { min: min - bump, max: max + bump };
  }

  const pad = (max - min) * padding;
  return { min: min - pad, max: max + pad };
}

// Turning off Home Assistant's significant-change filter means a chatty sensor can return a point
// per minute (~1440/day). The plot is only a few hundred pixels wide, so beyond roughly one point
// per pixel we are paying to draw detail nobody can see.
const MAX_RENDERED_POINTS_PER_SERIES = 500;

/**
 * Evenly thins a series for rendering, always keeping the first and last sample so the line still
 * spans the full window and ends on the current value. Trades away sub-pixel spikes, not shape.
 */
function decimatePoints(points, maxPoints = MAX_RENDERED_POINTS_PER_SERIES) {
  if (!Array.isArray(points) || points.length <= maxPoints || maxPoints < 2) return points;

  const stride = (points.length - 1) / (maxPoints - 1);
  const thinned = [];
  for (let i = 0; i < maxPoints - 1; i += 1) {
    thinned.push(points[Math.round(i * stride)]);
  }
  thinned.push(points[points.length - 1]);
  return thinned;
}

function formatCoordinate(value) {
  const rounded = Math.round(value * 100) / 100;
  if (Object.is(rounded, -0)) return '0';
  return Number.isInteger(rounded) ? String(rounded) : String(Number(rounded.toFixed(2)));
}

/**
 * Projects one series onto a shared time/value domain. Unlike buildSparklinePoints (which spaces
 * points by array index and scales each series to its own extremes), x comes from the timestamp
 * and y from the shared domain — the two properties that make overlaid series comparable.
 */
function buildTimeSeriesPoints(series, { timeDomain, valueDomain, width, height, maxPoints } = {}) {
  const chartWidth = Number(width);
  const chartHeight = Number(height);
  const points = toFinitePoints(series);

  if (
    !points.length ||
    !isObject(timeDomain) ||
    !isObject(valueDomain) ||
    !Number.isFinite(chartWidth) ||
    !Number.isFinite(chartHeight) ||
    chartWidth <= 0 ||
    chartHeight <= 0
  ) {
    return '';
  }

  const timeSpan = timeDomain.end - timeDomain.start;
  const valueSpan = valueDomain.max - valueDomain.min;
  if (
    !Number.isFinite(timeSpan) ||
    timeSpan <= 0 ||
    !Number.isFinite(valueSpan) ||
    valueSpan <= 0
  ) {
    return '';
  }

  const ordered = points.slice().sort((a, b) => Number(a.timestamp) - Number(b.timestamp));

  return decimatePoints(ordered, maxPoints ?? MAX_RENDERED_POINTS_PER_SERIES)
    .map((point) => {
      const ratioX = (Number(point.timestamp) - timeDomain.start) / timeSpan;
      const clampedX = Math.min(1, Math.max(0, ratioX));
      const x = clampedX * chartWidth;
      const y = chartHeight - ((Number(point.value) - valueDomain.min) / valueSpan) * chartHeight;
      return `${formatCoordinate(x)},${formatCoordinate(y)}`;
    })
    .join(' ');
}

export {
  COMPARISON_GRAPH_ID_PREFIX,
  COMPARISON_GRAPH_SPAN_OPTIONS,
  MAX_RENDERED_POINTS_PER_SERIES,
  decimatePoints,
  DEFAULT_COMPARISON_GRAPH_NAME,
  DEFAULT_COMPARISON_GRAPH_SPAN,
  GRAPH_SERIES_ATTRIBUTE_BY_DOMAIN,
  MAX_COMPARISON_GRAPH_SERIES,
  SERIES_COLORS_DARK,
  SERIES_COLORS_LIGHT,
  addComparisonGraph,
  getGraphSeriesAttribute,
  isGraphableEntity,
  readGraphSeriesUnit,
  readGraphSeriesValue,
  buildTimeSeriesPoints,
  computeTimeDomain,
  computeValueDomain,
  splitSeriesAtWindow,
  getComparisonGraph,
  getComparisonGraphEntityIds,
  getComparisonGraphs,
  getSeriesColorSlot,
  groupSeriesByUnit,
  isComparisonGraphId,
  normalizeComparisonGraphsConfig,
  normalizeGraphSpan as normalizeComparisonGraphSpan,
  removeComparisonGraph,
  updateComparisonGraph,
};

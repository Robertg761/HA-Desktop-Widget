const {
  MAX_COMPARISON_GRAPH_SERIES,
  addComparisonGraph,
  buildTimeSeriesPoints,
  computeTimeDomain,
  computeValueDomain,
  decimatePoints,
  splitSeriesAtWindow,
  getComparisonGraph,
  getComparisonGraphEntityIds,
  getGraphSeriesAttribute,
  getSeriesColorSlot,
  groupSeriesByUnit,
  isComparisonGraphId,
  isGraphableEntity,
  normalizeComparisonGraphsConfig,
  readGraphSeriesUnit,
  readGraphSeriesValue,
  removeComparisonGraph,
  updateComparisonGraph,
} = require('../../src/comparison-graphs.js');

const HOUR = 60 * 60 * 1000;
const NOW = 1_700_000_000_000;

function configWithGraph(entityIds = ['sensor.a', 'sensor.b']) {
  return {
    comparisonGraphs: [{ id: 'graph:1', name: 'Temperatures', span: 2, entityIds }],
    customTabs: [{ id: 'default', name: 'All', entityIds: ['light.x', 'graph:1'] }],
  };
}

describe('isComparisonGraphId', () => {
  it('distinguishes synthetic graph tile ids from real entity ids', () => {
    expect(isComparisonGraphId('graph:abc')).toBe(true);
    expect(isComparisonGraphId('sensor.living_room')).toBe(false);
    expect(isComparisonGraphId(undefined)).toBe(false);
  });
});

describe('normalizeComparisonGraphsConfig', () => {
  it('returns an empty list when nothing is configured', () => {
    expect(normalizeComparisonGraphsConfig({}).comparisonGraphs).toEqual([]);
  });

  it('keeps a graph that is referenced by a tab', () => {
    const config = normalizeComparisonGraphsConfig(configWithGraph());
    expect(config.comparisonGraphs).toHaveLength(1);
    expect(config.customTabs[0].entityIds).toEqual(['light.x', 'graph:1']);
  });

  it('drops a graph id from a tab when the graph no longer exists', () => {
    const config = normalizeComparisonGraphsConfig({
      comparisonGraphs: [],
      customTabs: [{ id: 'default', name: 'All', entityIds: ['light.x', 'graph:gone'] }],
    });
    expect(config.customTabs[0].entityIds).toEqual(['light.x']);
  });

  it('drops a graph that no tab references, so it cannot linger invisibly', () => {
    const config = normalizeComparisonGraphsConfig({
      comparisonGraphs: [{ id: 'graph:orphan', name: 'Orphan', entityIds: ['sensor.a'] }],
      customTabs: [{ id: 'default', name: 'All', entityIds: ['light.x'] }],
    });
    expect(config.comparisonGraphs).toEqual([]);
  });

  it('recomputes favoriteEntities from the reconciled tabs', () => {
    const config = normalizeComparisonGraphsConfig({
      comparisonGraphs: [],
      customTabs: [{ id: 'default', name: 'All', entityIds: ['light.x', 'graph:gone'] }],
    });
    expect(config.favoriteEntities).toEqual(['light.x']);
  });

  it('caps a graph at the number of validated colour slots', () => {
    const tooMany = Array.from({ length: 12 }, (_, i) => `sensor.s${i}`);
    const config = normalizeComparisonGraphsConfig({
      comparisonGraphs: [{ id: 'graph:1', name: 'Big', entityIds: tooMany }],
      customTabs: [{ id: 'default', name: 'All', entityIds: ['graph:1'] }],
    });
    expect(config.comparisonGraphs[0].entityIds).toHaveLength(MAX_COMPARISON_GRAPH_SERIES);
  });

  it('never lets a graph plot another graph', () => {
    const config = normalizeComparisonGraphsConfig({
      comparisonGraphs: [{ id: 'graph:1', name: 'X', entityIds: ['sensor.a', 'graph:2'] }],
      customTabs: [{ id: 'default', name: 'All', entityIds: ['graph:1'] }],
    });
    expect(config.comparisonGraphs[0].entityIds).toEqual(['sensor.a']);
  });

  it('de-duplicates entity ids and defaults a blank name', () => {
    const config = normalizeComparisonGraphsConfig({
      comparisonGraphs: [{ id: 'graph:1', name: '  ', entityIds: ['sensor.a', 'sensor.a'] }],
      customTabs: [{ id: 'default', name: 'All', entityIds: ['graph:1'] }],
    });
    expect(config.comparisonGraphs[0].entityIds).toEqual(['sensor.a']);
    expect(config.comparisonGraphs[0].name).toBe('Comparison Graph');
  });

  it('reports changed only when it actually rewrote something', () => {
    const clean = normalizeComparisonGraphsConfig(configWithGraph(), { withChanged: true });
    expect(clean.changed).toBe(false);

    const dirty = normalizeComparisonGraphsConfig(
      {
        comparisonGraphs: [],
        customTabs: [{ id: 'default', name: 'All', entityIds: ['graph:gone'] }],
      },
      { withChanged: true }
    );
    expect(dirty.changed).toBe(true);
  });
});

describe('addComparisonGraph / updateComparisonGraph / removeComparisonGraph', () => {
  const idFactory = () => 'graph:new';

  it('adds the graph and registers its id as a tile in the active tab', () => {
    const config = addComparisonGraph(
      {
        customTabs: [{ id: 'default', name: 'All', entityIds: ['light.x'] }],
      },
      { name: 'Temps', entityIds: ['sensor.a'], tabId: 'default', idFactory }
    );

    expect(config.comparisonGraphs).toHaveLength(1);
    expect(config.customTabs[0].entityIds).toEqual(['light.x', 'graph:new']);
  });

  it('gives a second graph a distinct id', () => {
    const first = addComparisonGraph(
      {
        customTabs: [{ id: 'default', name: 'All', entityIds: [] }],
      },
      { name: 'A', entityIds: ['sensor.a'], tabId: 'default', idFactory }
    );
    const second = addComparisonGraph(first, {
      name: 'B',
      entityIds: ['sensor.b'],
      tabId: 'default',
      idFactory,
    });

    const ids = second.comparisonGraphs.map((graph) => graph.id);
    expect(new Set(ids).size).toBe(2);
  });

  it('updates a graph in place', () => {
    const config = updateComparisonGraph(configWithGraph(), 'graph:1', {
      name: 'Renamed',
      entityIds: ['sensor.c'],
    });
    expect(getComparisonGraph(config, 'graph:1')).toEqual({
      id: 'graph:1',
      name: 'Renamed',
      span: 2,
      entityIds: ['sensor.c'],
    });
  });

  it('removes the graph and its tile in one step', () => {
    const config = removeComparisonGraph(configWithGraph(), 'graph:1');
    expect(config.comparisonGraphs).toEqual([]);
    expect(config.customTabs[0].entityIds).toEqual(['light.x']);
  });
});

describe('graph width (span)', () => {
  it('defaults to 2 columns and persists the default back for a graph saved before widths existed', () => {
    const legacy = {
      comparisonGraphs: [{ id: 'graph:1', name: 'Temperatures', entityIds: ['sensor.a'] }],
      customTabs: [{ id: 'default', name: 'All', entityIds: ['graph:1'] }],
    };
    const { config, changed } = normalizeComparisonGraphsConfig(legacy, { withChanged: true });
    expect(config.comparisonGraphs[0].span).toBe(2);
    expect(changed).toBe(true);
  });

  it('accepts 2, 3 and 4', () => {
    [2, 3, 4].forEach((span) => {
      const config = normalizeComparisonGraphsConfig({
        comparisonGraphs: [{ id: 'graph:1', name: 'G', span, entityIds: [] }],
        customTabs: [{ id: 'default', name: 'All', entityIds: ['graph:1'] }],
      });
      expect(config.comparisonGraphs[0].span).toBe(span);
    });
  });

  it('falls back to the default for a nonsense width', () => {
    ['wide', 0, 1, 9, null].forEach((span) => {
      const config = normalizeComparisonGraphsConfig({
        comparisonGraphs: [{ id: 'graph:1', name: 'G', span, entityIds: [] }],
        customTabs: [{ id: 'default', name: 'All', entityIds: ['graph:1'] }],
      });
      expect(config.comparisonGraphs[0].span).toBe(2);
    });
  });

  it('updates the width in place without touching the series', () => {
    const config = updateComparisonGraph(configWithGraph(['sensor.a']), 'graph:1', { span: 4 });
    const graph = getComparisonGraph(config, 'graph:1');
    expect(graph.span).toBe(4);
    expect(graph.entityIds).toEqual(['sensor.a']);
  });
});

describe('getComparisonGraphEntityIds', () => {
  it('collects every plotted entity across graphs without duplicates', () => {
    const config = {
      comparisonGraphs: [
        { id: 'graph:1', name: 'A', entityIds: ['sensor.a', 'sensor.b'] },
        { id: 'graph:2', name: 'B', entityIds: ['sensor.b', 'sensor.c'] },
      ],
    };
    expect(getComparisonGraphEntityIds(config)).toEqual(['sensor.a', 'sensor.b', 'sensor.c']);
  });
});

describe('attribute-backed series', () => {
  // A weather entity's state is "partlycloudy"; its temperature lives in an attribute. Without
  // this, the outside temperature could not be plotted at all.
  const weather = {
    entity_id: 'weather.home',
    state: 'partlycloudy',
    attributes: { temperature: 8.3, temperature_unit: '°C' },
  };
  const climate = {
    entity_id: 'climate.living',
    state: 'heat',
    attributes: { current_temperature: 21.4 },
  };
  const numericSensor = {
    entity_id: 'sensor.bedroom',
    state: '19.8',
    attributes: { unit_of_measurement: '°C' },
  };

  it('reads the value from the domain attribute, not the state', () => {
    expect(readGraphSeriesValue(weather)).toBe(8.3);
    expect(readGraphSeriesValue(climate)).toBe(21.4);
    expect(readGraphSeriesValue(numericSensor)).toBe(19.8);
  });

  it('knows which entities need an attribute read', () => {
    expect(getGraphSeriesAttribute('weather.home')).toBe('temperature');
    expect(getGraphSeriesAttribute('climate.living')).toBe('current_temperature');
    expect(getGraphSeriesAttribute('sensor.bedroom')).toBeNull();
  });

  it('resolves the unit, falling back to the system temperature unit', () => {
    expect(readGraphSeriesUnit(weather)).toBe('°C');
    expect(readGraphSeriesUnit(climate, { fallbackTemperatureUnit: '°F' })).toBe('°F');
    expect(readGraphSeriesUnit(numericSensor)).toBe('°C');
  });

  it('makes weather and climate graphable, and rejects non-numeric entities', () => {
    expect(isGraphableEntity(weather)).toBe(true);
    expect(isGraphableEntity(climate)).toBe(true);
    expect(isGraphableEntity(numericSensor)).toBe(true);
    expect(isGraphableEntity({ entity_id: 'sensor.mode', state: 'auto', attributes: {} })).toBe(
      false
    );
    expect(isGraphableEntity({ entity_id: 'light.lamp', state: 'on', attributes: {} })).toBe(false);
  });

  it('groups a weather temperature with room sensors on the same scale', () => {
    const { hasMismatch, groups } = groupSeriesByUnit([
      { entityId: 'sensor.bedroom', unit: '°C' },
      { entityId: 'weather.home', unit: '°C' },
    ]);
    expect(hasMismatch).toBe(false);
    expect(groups[0].entityIds).toEqual(['sensor.bedroom', 'weather.home']);
  });
});

describe('getSeriesColorSlot', () => {
  it('maps a series to a fixed 1-based slot', () => {
    expect(getSeriesColorSlot(0)).toBe(1);
    expect(getSeriesColorSlot(6)).toBe(7);
  });

  it('never cycles or invents a slot past the validated palette', () => {
    expect(getSeriesColorSlot(MAX_COMPARISON_GRAPH_SERIES)).toBeNull();
  });
});

describe('groupSeriesByUnit', () => {
  it('groups matching units into a single scale', () => {
    const { groups, hasMismatch } = groupSeriesByUnit([
      { entityId: 'sensor.a', unit: '°C' },
      { entityId: 'sensor.b', unit: '°C' },
    ]);
    expect(hasMismatch).toBe(false);
    expect(groups).toEqual([{ unit: '°C', entityIds: ['sensor.a', 'sensor.b'] }]);
  });

  it('flags a mismatch when units differ', () => {
    const { groups, hasMismatch } = groupSeriesByUnit([
      { entityId: 'sensor.a', unit: '°C' },
      { entityId: 'sensor.b', unit: '%' },
    ]);
    expect(hasMismatch).toBe(true);
    expect(groups).toHaveLength(2);
  });
});

describe('computeValueDomain', () => {
  it('shares one domain across every series, not per-series extremes', () => {
    const cold = [{ value: 5, timestamp: NOW }];
    const warm = [{ value: 25, timestamp: NOW }];
    expect(computeValueDomain([cold, warm], { padding: 0 })).toEqual({ min: 5, max: 25 });
  });

  it('gives a flat series a band instead of dividing by zero', () => {
    const domain = computeValueDomain([
      [
        { value: 20, timestamp: NOW },
        { value: 20, timestamp: NOW + 1 },
      ],
    ]);
    expect(domain.min).toBeLessThan(20);
    expect(domain.max).toBeGreaterThan(20);
  });

  it('returns null when there is nothing to plot', () => {
    expect(computeValueDomain([])).toBeNull();
    expect(computeValueDomain([[]])).toBeNull();
  });
});

describe('splitSeriesAtWindow', () => {
  const timeDomain = { start: NOW - 24 * HOUR, end: NOW };

  it('separates measured samples from the spans that are merely held', () => {
    const { lead, measured, trail } = splitSeriesAtWindow(
      [
        { value: 19, timestamp: NOW - 30 * HOUR }, // boundary: before the window
        { value: 20, timestamp: NOW - 6 * HOUR },
        { value: 26.2, timestamp: NOW - 2 * HOUR },
      ],
      timeDomain
    );

    expect(measured).toHaveLength(2);

    // Held at the boundary value from the window start up to the first reading.
    expect(lead[0]).toEqual({ value: 19, timestamp: timeDomain.start });
    expect(lead[1].value).toBe(20);

    // Held at the last reading from then up to now.
    expect(trail[0].value).toBe(26.2);
    expect(trail[1]).toEqual({ value: 26.2, timestamp: NOW });
  });

  it('brings series that reported at different times to the same both edges', () => {
    const chatty = splitSeriesAtWindow(
      [
        { value: 21, timestamp: NOW - 30 * HOUR },
        { value: 21.4, timestamp: NOW - 60_000 },
      ],
      timeDomain
    );
    const stale = splitSeriesAtWindow(
      [
        { value: 8, timestamp: NOW - 30 * HOUR },
        { value: 8.3, timestamp: NOW - 5 * HOUR },
      ],
      timeDomain
    );

    [chatty, stale].forEach((split) => {
      expect(split.lead[0].timestamp).toBe(timeDomain.start);
      expect(split.trail.at(-1).timestamp).toBe(NOW);
    });
    // ...without inventing values: each holds its own readings.
    expect(stale.trail.at(-1).value).toBe(8.3);
  });

  it('does not fabricate a start when the entity has no state before the window', () => {
    // A sensor created 3h ago genuinely has no reading at the window start.
    const { lead, measured } = splitSeriesAtWindow(
      [{ value: 5, timestamp: NOW - 3 * HOUR }],
      timeDomain
    );

    expect(lead).toEqual([]);
    expect(measured).toHaveLength(1);
  });

  it('holds a value across the whole window when nothing was recorded inside it', () => {
    const { measured, trail } = splitSeriesAtWindow(
      [{ value: 12, timestamp: NOW - 40 * HOUR }],
      timeDomain
    );

    expect(measured).toEqual([]);
    expect(trail).toEqual([
      { value: 12, timestamp: timeDomain.start },
      { value: 12, timestamp: NOW },
    ]);
  });

  it('adds no held spans when samples already reach both edges', () => {
    const { lead, trail } = splitSeriesAtWindow(
      [
        { value: 1, timestamp: timeDomain.start },
        { value: 2, timestamp: NOW },
      ],
      timeDomain
    );

    expect(lead).toEqual([]);
    expect(trail).toEqual([]);
  });

  it('returns nothing for an empty series rather than inventing points', () => {
    expect(splitSeriesAtWindow([], timeDomain)).toEqual({ lead: [], measured: [], trail: [] });
  });
});

describe('decimatePoints', () => {
  const series = (n) => Array.from({ length: n }, (_, i) => ({ value: i, timestamp: NOW + i }));

  it('leaves a series alone when it already fits', () => {
    const small = series(10);
    expect(decimatePoints(small, 500)).toBe(small);
  });

  it('thins a dense series down to the cap', () => {
    expect(decimatePoints(series(5000), 500)).toHaveLength(500);
  });

  it('always keeps the first and last sample, so the line still spans the window', () => {
    const dense = series(5000);
    const thinned = decimatePoints(dense, 500);
    expect(thinned[0]).toBe(dense[0]);
    expect(thinned.at(-1)).toBe(dense.at(-1));
  });

  it('keeps samples in chronological order', () => {
    const thinned = decimatePoints(series(5000), 500);
    const timestamps = thinned.map((p) => p.timestamp);
    expect([...timestamps].sort((a, b) => a - b)).toEqual(timestamps);
  });
});

describe('buildTimeSeriesPoints', () => {
  const timeDomain = computeTimeDomain({ now: NOW, windowMs: 24 * HOUR });
  const valueDomain = { min: 0, max: 100 };
  const geometry = { timeDomain, valueDomain, width: 100, height: 40 };

  it('places x by timestamp, not by array index', () => {
    // A single point 12h into a 24h window belongs at the horizontal midpoint, even though it is
    // the only element in the array. Index-based scaling would put it at x=0.
    const points = buildTimeSeriesPoints([{ value: 50, timestamp: NOW - 12 * HOUR }], geometry);
    expect(points).toBe('50,20');
  });

  it('puts series with different sample counts on the same time axis', () => {
    const dense = buildTimeSeriesPoints(
      [
        { value: 0, timestamp: NOW - 24 * HOUR },
        { value: 0, timestamp: NOW - 18 * HOUR },
        { value: 0, timestamp: NOW - 12 * HOUR },
        { value: 0, timestamp: NOW },
      ],
      geometry
    );
    const sparse = buildTimeSeriesPoints(
      [
        { value: 0, timestamp: NOW - 24 * HOUR },
        { value: 0, timestamp: NOW },
      ],
      geometry
    );

    const xOf = (str) => str.split(' ').map((pair) => pair.split(',')[0]);
    // Both start at the left edge and end at the right edge; the dense one just has more points
    // in between. Index-based scaling would have stretched them to different time scales.
    expect(xOf(dense)[0]).toBe('0');
    expect(xOf(dense).at(-1)).toBe('100');
    expect(xOf(sparse)).toEqual(['0', '100']);
  });

  it('reads two series against the shared domain, preserving their real offset', () => {
    const shared = { timeDomain, valueDomain: { min: 0, max: 100 }, width: 100, height: 40 };
    const low = buildTimeSeriesPoints([{ value: 25, timestamp: NOW }], shared);
    const high = buildTimeSeriesPoints([{ value: 75, timestamp: NOW }], shared);
    // 25 sits below 75 on the same scale. Per-series normalization would have drawn both centred.
    expect(low).toBe('100,30');
    expect(high).toBe('100,10');
  });

  it('sorts unordered points by time', () => {
    const points = buildTimeSeriesPoints(
      [
        { value: 100, timestamp: NOW },
        { value: 0, timestamp: NOW - 24 * HOUR },
      ],
      geometry
    );
    expect(points).toBe('0,40 100,0');
  });

  it('clamps points that fall outside the window', () => {
    const points = buildTimeSeriesPoints([{ value: 50, timestamp: NOW - 48 * HOUR }], geometry);
    expect(points).toBe('0,20');
  });

  it('ignores non-numeric samples', () => {
    const points = buildTimeSeriesPoints(
      [
        { value: 'unavailable', timestamp: NOW - 24 * HOUR },
        { value: 50, timestamp: NOW },
      ],
      geometry
    );
    expect(points).toBe('100,20');
  });

  it('returns an empty string for an empty series or a missing domain', () => {
    expect(buildTimeSeriesPoints([], geometry)).toBe('');
    expect(
      buildTimeSeriesPoints([{ value: 1, timestamp: NOW }], { ...geometry, valueDomain: null })
    ).toBe('');
  });
});

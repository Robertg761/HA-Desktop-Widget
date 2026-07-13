/**
 * @jest-environment jsdom
 */

const { createMockElectronAPI } = require('../mocks/electron.js');

window.electronAPI = createMockElectronAPI();

jest.mock('../../src/camera.js', () => ({ openCamera: jest.fn() }));
jest.mock('../../src/icons.js', () => ({ setIconContent: jest.fn() }));
jest.mock('sortablejs', () => ({ create: jest.fn(() => ({ destroy: jest.fn() })) }));
jest.mock('../../src/ui-utils.js', () => ({
  showToast: jest.fn(),
  showConfirm: jest.fn().mockResolvedValue(false),
  showLoading: jest.fn(),
  setStatus: jest.fn(),
  applyTheme: jest.fn(),
  applyUiPreferences: jest.fn(),
  hexToRgb: jest.fn(() => null),
  miredsToKelvin: jest.fn(() => null),
  hasSupportedFeature: jest.fn(() => false),
}));

const mockRequest = jest.fn();
jest.mock('../../src/websocket.js', () => ({
  callService: jest.fn().mockResolvedValue({}),
  callServiceWithResponse: jest.fn().mockResolvedValue({}),
  request: (...args) => mockRequest(...args),
  on: jest.fn(),
  emit: jest.fn(),
}));

const ui = require('../../src/ui.js');
const state = require('../../src/state.js').default;

const NOW = Date.now();
const HOUR = 60 * 60 * 1000;

// The sensor history cache is module state keyed by entity id and throttled for 5 minutes, so each
// test uses its own sensors — otherwise the second test is served from the first test's cache.
let sensorSeq = 0;

function makeScenario({ unit = '°C' } = {}) {
  sensorSeq += 1;
  const warmId = `sensor.living_${sensorSeq}`;
  const coldId = `sensor.outside_${sensorSeq}`;

  state.setStates({
    [warmId]: {
      entity_id: warmId,
      state: '21.4',
      attributes: { friendly_name: 'Living Room', unit_of_measurement: '°C' },
      last_changed: new Date(NOW).toISOString(),
    },
    [coldId]: {
      entity_id: coldId,
      state: '8.3',
      attributes: { friendly_name: 'Outside', unit_of_measurement: unit },
      last_changed: new Date(NOW).toISOString(),
    },
  });

  return { warmId, coldId };
}

/** Home Assistant returns history keyed by entity id, compressed as { s: state, lu: unix_secs }. */
function historyResponse(byEntity) {
  const result = {};
  Object.entries(byEntity).forEach(([entityId, samples]) => {
    result[entityId] = samples.map(([value, timestamp]) => ({
      s: String(value),
      lu: timestamp / 1000,
    }));
  });
  return { result };
}

function setupConfig(entityIds, span) {
  state.setConfig({
    homeAssistant: { url: 'http://ha.local', token: 'x' },
    comparisonGraphs: [{ id: 'graph:temps', name: 'Temperatures', span, entityIds }],
    customTabs: [{ id: 'default', name: 'All', entityIds: ['graph:temps'] }],
    activeTabId: 'default',
    favoriteEntities: ['graph:temps'],
    primaryCards: ['none', 'none'],
    ui: {},
  });
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

/** Only the MEASURED spans — the dashed "held" spans at the edges are separate polylines. */
const solidLines = (root = document) => [
  ...root.querySelectorAll('.comparison-graph-line:not(.comparison-graph-line-held)'),
];

describe('comparison graph tile', () => {
  beforeEach(() => {
    mockRequest.mockReset();
    document.body.innerHTML = '<div id="quick-controls"></div>';
    state.setServices({});
    state.setAreas({});
    state.setUnitSystem({});
  });

  it('renders a graph id as a graph tile rather than an unavailable entity', () => {
    mockRequest.mockResolvedValue(historyResponse({}));
    const { warmId, coldId } = makeScenario();
    setupConfig([warmId, coldId]);

    ui.renderActiveTab();

    const tile = document.querySelector('.control-item[data-entity-id="graph:temps"]');
    expect(tile).not.toBeNull();
    expect(tile.classList.contains('comparison-graph-tile')).toBe(true);
    expect(tile.classList.contains('unavailable-entity')).toBe(false);
    expect(tile.querySelector('.comparison-graph-title').textContent).toBe('Temperatures');
    expect(tile.dataset.span).toBe('2');
  });

  it('fetches every plotted sensor in a single history request', async () => {
    const { warmId, coldId } = makeScenario();
    mockRequest.mockResolvedValue(
      historyResponse({
        [warmId]: [
          [20, NOW - 2 * HOUR],
          [21.4, NOW],
        ],
        [coldId]: [
          [7, NOW - 2 * HOUR],
          [8.3, NOW],
        ],
      })
    );
    setupConfig([warmId, coldId]);

    ui.renderActiveTab();
    await flush();

    const historyCalls = mockRequest.mock.calls
      .map(([payload]) => payload)
      .filter((payload) => payload?.type === 'history/history_during_period');

    expect(historyCalls).toHaveLength(1);
    expect(historyCalls[0].entity_ids).toEqual([warmId, coldId]);
    // HA defaults this to true and then drops rows its per-domain "significant change" rules
    // consider uninteresting — which starved the weather series down to ~4 points a day.
    expect(historyCalls[0].significant_changes_only).toBe(false);
  });

  it('draws one line per sensor and a legend entry for each', async () => {
    const { warmId, coldId } = makeScenario();
    mockRequest.mockResolvedValue(
      historyResponse({
        [warmId]: [
          [20, NOW - 2 * HOUR],
          [21.4, NOW],
        ],
        [coldId]: [
          [7, NOW - 2 * HOUR],
          [8.3, NOW],
        ],
      })
    );
    setupConfig([warmId, coldId]);

    ui.renderActiveTab();
    await flush();

    const tile = document.querySelector('.comparison-graph-tile');
    const lines = solidLines(tile);
    expect(lines).toHaveLength(2);

    // Colour comes from the entity's index in the persisted list, so it is stable per sensor.
    expect(lines[0].getAttribute('stroke')).toBe('var(--chart-series-1)');
    expect(lines[1].getAttribute('stroke')).toBe('var(--chart-series-2)');

    const names = [...tile.querySelectorAll('.comparison-graph-legend-name')].map(
      (el) => el.textContent
    );
    expect(names).toEqual(['Living Room', 'Outside']);
  });

  it('plots both sensors against one shared scale, keeping their real offset', async () => {
    const { warmId, coldId } = makeScenario();
    mockRequest.mockResolvedValue(
      historyResponse({
        [warmId]: [
          [20, NOW - 2 * HOUR],
          [21.4, NOW],
        ],
        [coldId]: [
          [7, NOW - 2 * HOUR],
          [8.3, NOW],
        ],
      })
    );
    setupConfig([warmId, coldId]);

    ui.renderActiveTab();
    await flush();

    const lines = solidLines();
    const lastY = (line) => Number(line.getAttribute('points').split(' ').at(-1).split(',')[1]);

    // Living Room is warmer than Outside, so on a shared scale its line sits higher (smaller y).
    // Per-series normalization would have drawn both at the same height.
    expect(lastY(lines[0])).toBeLessThan(lastY(lines[1]));
  });

  it('plots a weather entity by reading its temperature attribute, not its state', async () => {
    sensorSeq += 1;
    const roomId = `sensor.room_${sensorSeq}`;
    const weatherId = `weather.home_${sensorSeq}`;

    state.setStates({
      [roomId]: {
        entity_id: roomId,
        state: '21.4',
        attributes: { friendly_name: 'Bedroom', unit_of_measurement: '°C' },
        last_changed: new Date(NOW).toISOString(),
      },
      [weatherId]: {
        entity_id: weatherId,
        // The state is a condition string — the number we want is in the attributes.
        state: 'partlycloudy',
        attributes: { friendly_name: 'Outside', temperature: 8.3, temperature_unit: '°C' },
        last_changed: new Date(NOW).toISOString(),
      },
    });

    mockRequest.mockImplementation((payload) => {
      if (payload.entity_ids.includes(weatherId)) {
        // Attribute history: the value lives under `a`, and unchanged attributes are omitted.
        return Promise.resolve({
          result: {
            [weatherId]: [
              { s: 'cloudy', a: { temperature: 7 }, lu: (NOW - 2 * HOUR) / 1000 },
              { s: 'partlycloudy', lu: NOW / 1000 },
            ],
          },
        });
      }
      return Promise.resolve(
        historyResponse({
          [roomId]: [
            [20, NOW - 2 * HOUR],
            [21.4, NOW],
          ],
        })
      );
    });

    setupConfig([roomId, weatherId]);
    ui.renderActiveTab();
    await flush();

    const calls = mockRequest.mock.calls
      .map(([payload]) => payload)
      .filter((payload) => payload?.type === 'history/history_during_period');

    // The weather entity must be fetched WITH attributes, so it can't share the state-only request.
    const attrCall = calls.find((call) => call.entity_ids.includes(weatherId));
    expect(attrCall.no_attributes).toBe(false);
    expect(calls.find((call) => call.entity_ids.includes(roomId)).no_attributes).toBe(true);

    const tile = document.querySelector('.comparison-graph-tile');
    expect(solidLines(tile)).toHaveLength(2);

    const values = [...tile.querySelectorAll('.comparison-graph-legend-value')].map(
      (el) => el.textContent
    );
    expect(values).toEqual(['21.4 °C', '8.3 °C']);
  });

  it('retries the fetch after the first attempt fails because the socket is not open yet', async () => {
    // Tiles render on first paint, before the WebSocket connects, so the first history request is
    // rejected. A failed fetch must not burn the 5-minute refresh throttle, or the chart sits empty.
    const { warmId, coldId } = makeScenario();

    mockRequest.mockRejectedValueOnce(new Error('WebSocket not connected'));
    setupConfig([warmId, coldId]);

    ui.renderActiveTab();
    await flush();

    expect(document.querySelector('.comparison-graph-empty')).not.toBeNull();
    expect(solidLines()).toHaveLength(0);

    // Once connected, the next render must actually re-request rather than serve the failed cache.
    mockRequest.mockResolvedValue(
      historyResponse({
        [warmId]: [
          [20, NOW - 2 * HOUR],
          [21.4, NOW],
        ],
        [coldId]: [
          [7, NOW - 2 * HOUR],
          [8.3, NOW],
        ],
      })
    );

    ui.renderActiveTab();
    await flush();

    expect(solidLines()).toHaveLength(2);
    expect(document.querySelector('.comparison-graph-empty')).toBeNull();
  });

  it('reaches both edges even when sensors reported at different times', async () => {
    const { warmId, coldId } = makeScenario();
    mockRequest.mockResolvedValue(
      historyResponse({
        // Each has a boundary sample from before the window, then readings that stop at
        // different times: one an hour ago, the other five hours ago.
        [warmId]: [
          [19, NOW - 30 * HOUR],
          [20, NOW - 6 * HOUR],
          [21.4, NOW - 1 * HOUR],
        ],
        [coldId]: [
          [6, NOW - 30 * HOUR],
          [7, NOW - 8 * HOUR],
          [8.3, NOW - 5 * HOUR],
        ],
      })
    );
    setupConfig([warmId, coldId]);

    ui.renderActiveTab();
    await flush();

    const xsOf = (line) => {
      const pts = line.getAttribute('points').trim().split(/\s+/);
      return { first: Number(pts[0].split(',')[0]), last: Number(pts.at(-1).split(',')[0]) };
    };

    // Per series: the lead (held) span starts at the left edge, the trail (held) span ends at the
    // right edge — so both series span the full window and are comparable at the start and at now.
    const tile = document.querySelector('.comparison-graph-tile');
    const held = [...tile.querySelectorAll('.comparison-graph-line-held')];
    expect(held).toHaveLength(4); // a lead and a trail for each of the two series

    const leads = held.filter((line) => xsOf(line).first === 0);
    const trails = held.filter((line) => xsOf(line).last > 0 && xsOf(line).first > 0);
    expect(leads).toHaveLength(2);
    expect(trails).toHaveLength(2);

    const rightEdge = Math.max(...trails.map((line) => xsOf(line).last));
    trails.forEach((line) => expect(xsOf(line).last).toBeCloseTo(rightEdge, 1));
  });

  it('draws held spans dashed and measured spans solid, so filled-in data is never mistaken for real', async () => {
    const { warmId, coldId } = makeScenario();
    mockRequest.mockResolvedValue(
      historyResponse({
        [warmId]: [
          [19, NOW - 30 * HOUR],
          [20, NOW - 8 * HOUR],
          [21.4, NOW - 3 * HOUR],
        ],
        [coldId]: [
          [6, NOW - 30 * HOUR],
          [7, NOW - 8 * HOUR],
          [8.3, NOW - 3 * HOUR],
        ],
      })
    );
    setupConfig([warmId, coldId]);

    ui.renderActiveTab();
    await flush();

    const tile = document.querySelector('.comparison-graph-tile');
    const solid = [...tile.querySelectorAll('.comparison-graph-line')].filter(
      (line) => !line.classList.contains('comparison-graph-line-held')
    );

    expect(solid).toHaveLength(2);
    expect(tile.querySelectorAll('.comparison-graph-line-held').length).toBeGreaterThan(0);
  });

  it('renders the tile at the configured width', () => {
    mockRequest.mockResolvedValue(historyResponse({}));
    const { warmId } = makeScenario();
    setupConfig([warmId], 4);

    ui.renderActiveTab();

    const tile = document.querySelector('.comparison-graph-tile');
    expect(tile.dataset.span).toBe('4');
    expect(tile.style.gridColumn).toBe('span 4');
  });

  it('clamps the width to the columns the grid actually has', () => {
    // jsdom reports no computed grid template, so a real grid is faked: a 4-wide graph in a
    // 3-column grid must not create an implicit 4th column and overflow the widget.
    const spy = jest.spyOn(window, 'getComputedStyle').mockImplementation(() => ({
      gridTemplateColumns: '120px 120px 120px',
    }));

    try {
      mockRequest.mockResolvedValue(historyResponse({}));
      const { warmId } = makeScenario();
      setupConfig([warmId], 4);

      ui.renderActiveTab();

      const tile = document.querySelector('.comparison-graph-tile');
      expect(tile.style.gridColumn).toBe('span 3');
    } finally {
      spy.mockRestore();
    }
  });

  it('shows an empty state instead of a chart when no sensors are selected', () => {
    mockRequest.mockResolvedValue(historyResponse({}));
    makeScenario();
    setupConfig([]);

    ui.renderActiveTab();

    const tile = document.querySelector('.comparison-graph-tile');
    expect(tile.querySelector('.comparison-graph-empty')).not.toBeNull();
    expect(tile.querySelector('.comparison-graph-line')).toBeNull();
  });
});

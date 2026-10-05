/**
 * @jest-environment jsdom
 */

const { createMockElectronAPI } = require('../mocks/electron.js');

window.electronAPI = createMockElectronAPI();

jest.mock('../../src/camera.js', () => ({
  CAMERA_PREVIEW_REFRESH_OPTIONS: [],
  disposeCameraPreview: jest.fn(),
  mountCameraPreview: jest.fn(),
  normalizeCameraPreviewRefresh: jest.fn(() => 'off'),
  openCamera: jest.fn(),
  pruneCameraPreviews: jest.fn(),
  refreshCameraPreview: jest.fn(),
}));
jest.mock('../../src/icons.js', () => ({
  setIconContent: jest.fn(),
  applyCloseButtonIcons: jest.fn(),
}));
jest.mock('sortablejs', () => ({ create: jest.fn(() => ({ destroy: jest.fn() })) }));
jest.mock('../../src/ui-utils.js', () => ({
  ...require('../helpers/ui-utils-dialogs').realDialogHelpers(),
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

// Mirrors COMPARISON_GRAPH_REDRAW_INTERVAL_MS in ui.js: live updates coalesce into one repaint.
const REDRAW_DEBOUNCE_MS = 250;

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
    expect(values).toEqual(['21.4°C', '8.3°C']);
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

  it('drops a missing reading instead of plotting it as a zero', async () => {
    // Number('') and Number(null) are both 0. A sensor that went unavailable for a poll would
    // otherwise contribute a real-looking 0 °C: a line plunging to freezing, dragging the scale
    // down with it and hiding the real spread.
    const { warmId, coldId } = makeScenario();
    mockRequest.mockResolvedValue({
      result: {
        [warmId]: [
          { s: '20', lu: (NOW - 3 * HOUR) / 1000 },
          { s: '', lu: (NOW - 2 * HOUR) / 1000 },
          { s: 'unavailable', lu: (NOW - 1.5 * HOUR) / 1000 },
          { s: null, lu: (NOW - 1 * HOUR) / 1000 },
          { s: '21.4', lu: NOW / 1000 },
        ],
        [coldId]: [
          { s: '20.5', lu: (NOW - 3 * HOUR) / 1000 },
          { s: '21', lu: NOW / 1000 },
        ],
      },
    });
    setupConfig([warmId, coldId]);

    ui.renderActiveTab();
    await flush();

    const measured = solidLines()[0];
    const ys = measured
      .getAttribute('points')
      .trim()
      .split(/\s+/)
      .map((pair) => Number(pair.split(',')[1]));

    // Only the two real readings survive; the blank, the 'unavailable' and the null are gone.
    expect(ys).toHaveLength(2);

    // Both series sit in the same narrow band (20–21.4), so every point is drawn in the upper
    // reaches of the plot. A coerced 0 would have pinned one of them to the bottom edge.
    const plotHeight = 90 - 4 * 2;
    ys.forEach((y) => expect(y).toBeLessThan(plotHeight));
  });

  it('scales each unit separately, so a mismatched series is not squashed flat', async () => {
    // The editor warns that mixed units are scaled separately. One shared domain across °C and %
    // would stretch from 20 to 60 and crush the temperatures into a couple of pixels.
    const { warmId, coldId } = makeScenario({ unit: '%' });
    mockRequest.mockResolvedValue(
      historyResponse({
        [warmId]: [
          [20, NOW - 3 * HOUR],
          [21.4, NOW],
        ],
        [coldId]: [
          [55, NOW - 3 * HOUR],
          [60, NOW],
        ],
      })
    );
    setupConfig([warmId, coldId]);

    ui.renderActiveTab();
    await flush();

    const spread = (line) => {
      const ys = line
        .getAttribute('points')
        .trim()
        .split(/\s+/)
        .map((pair) => Number(pair.split(',')[1]));
      return Math.max(...ys) - Math.min(...ys);
    };

    const [temperature, humidity] = solidLines();
    const plotHeight = 90 - 4 * 2;

    // Each series is read against its own unit's extremes, so each uses most of the plot's height.
    expect(spread(temperature)).toBeGreaterThan(plotHeight * 0.5);
    expect(spread(humidity)).toBeGreaterThan(plotHeight * 0.5);
  });

  it('dates a weather temperature by last_updated, since its state does not move when it changes', async () => {
    sensorSeq += 1;
    const weatherId = `weather.home_${sensorSeq}`;

    const skyLastChanged = NOW - 6 * HOUR;
    state.setStates({
      [weatherId]: {
        entity_id: weatherId,
        state: 'partlycloudy',
        attributes: { friendly_name: 'Outside', temperature: 8.3, temperature_unit: '°C' },
        // The sky last changed six hours ago and has not moved since; the temperature just did.
        last_changed: new Date(skyLastChanged).toISOString(),
        last_updated: new Date(NOW).toISOString(),
      },
    });

    mockRequest.mockResolvedValue({
      result: {
        [weatherId]: [
          { s: 'cloudy', a: { temperature: 7 }, lu: (NOW - 8 * HOUR) / 1000 },
          { s: 'partlycloudy', a: { temperature: 7.5 }, lu: (NOW - 6 * HOUR) / 1000 },
        ],
      },
    });

    setupConfig([weatherId]);
    ui.renderActiveTab();
    await flush();

    // A live update whose temperature climbed but whose condition did not.
    ui.updateEntityInUI({
      ...state.STATES[weatherId],
      attributes: { friendly_name: 'Outside', temperature: 9.1, temperature_unit: '°C' },
      last_changed: new Date(skyLastChanged).toISOString(),
      last_updated: new Date(NOW).toISOString(),
    });

    // The graph repaint is debounced, so live updates don't rebuild the chart on every state event.
    await new Promise((resolve) => setTimeout(resolve, REDRAW_DEBOUNCE_MS + 50));

    const tile = document.querySelector('.comparison-graph-tile');
    const xOfLastPoint = (line) =>
      Number(line.getAttribute('points').trim().split(/\s+/).at(-1).split(',')[0]);

    // Dating the new reading by last_changed would file it six hours in the past — right on top of
    // the previous sample — so the measured span would stop three quarters of the way across.
    // last_updated is when the temperature actually moved, which carries the line to "now".
    const measured = solidLines(tile);
    const plotWidth = 260 - 4 * 2;

    expect(xOfLastPoint(measured[0])).toBeGreaterThan(plotWidth * 0.99);
  });

  it('reads every series at the hovered time, never at a reading it had not taken yet', async () => {
    const { warmId, coldId } = makeScenario();
    mockRequest.mockResolvedValue(
      historyResponse({
        [warmId]: [
          [20, NOW - 3 * HOUR],
          [22, NOW - 1 * HOUR],
        ],
        [coldId]: [
          [5, NOW - 2 * HOUR],
          [9, NOW - 0.5 * HOUR],
        ],
      })
    );
    setupConfig([warmId, coldId]);

    ui.renderActiveTab();
    await flush();

    const tile = document.querySelector('.comparison-graph-tile');
    const frame = tile.querySelector('.comparison-graph-frame');
    const svg = tile.querySelector('.comparison-graph-svg');

    // jsdom lays nothing out, so the plot is given the size it renders at.
    svg.getBoundingClientRect = () => ({ left: 0, top: 0, width: 260, height: 90 });

    // Hover 1.9h ago. Living Room last reported 20 (3h ago) and does not read 22 until an hour
    // ago; Outside last reported 5 (2h ago).
    const ratio = (24 - 1.9) / 24;
    frame.dispatchEvent(new MouseEvent('pointermove', { clientX: ratio * 260, bubbles: true }));

    const values = [...tile.querySelectorAll('.comparison-graph-tooltip-value')].map(
      (el) => el.textContent
    );

    // Nearest-sample would have answered 22 for Living Room — a reading from the future, taken an
    // hour after the time being hovered, compared against an Outside reading from 2h ago.
    expect(values).toEqual(['20°C', '5°C']);
  });

  // Puts the real clock back even when the test below fails part way.
  afterEach(() => {
    jest.useRealTimers();
  });

  it('heads the tooltip with the weekday and the minute, and rounds values as the legend does', async () => {
    // The day the heading names is checked against the hovered time, so the clock is held at
    // midday: run just after midnight, the graph's own sample and the test's arithmetic could
    // land either side of it. Only Date is faked; the timers the graph waits on stay real.
    const midday = new Date(NOW);
    midday.setHours(12, 0, 0, 0);
    const now = midday.getTime();
    jest.useFakeTimers({
      now,
      doNotFake: [
        'nextTick',
        'setImmediate',
        'clearImmediate',
        'setTimeout',
        'clearTimeout',
        'setInterval',
        'clearInterval',
        'queueMicrotask',
        'requestAnimationFrame',
        'cancelAnimationFrame',
        'requestIdleCallback',
        'cancelIdleCallback',
        'performance',
        'hrtime',
      ],
    });
    const { warmId, coldId } = makeScenario();
    mockRequest.mockResolvedValue(
      historyResponse({
        [warmId]: [
          [20.04, now - 3 * HOUR],
          [21.4567, now - 1 * HOUR],
        ],
        [coldId]: [[5, now - 2 * HOUR]],
      })
    );
    setupConfig([warmId, coldId]);
    ui.renderActiveTab();
    await flush();

    const tile = document.querySelector('.comparison-graph-tile');
    const frame = tile.querySelector('.comparison-graph-frame');
    tile.querySelector('.comparison-graph-svg').getBoundingClientRect = () => ({
      left: 0,
      top: 0,
      width: 260,
      height: 90,
    });
    const hoverAt = (hoursAgo) =>
      frame.dispatchEvent(
        new MouseEvent('pointermove', { clientX: ((24 - hoursAgo) / 24) * 260, bubbles: true })
      );

    hoverAt(0.5);
    const heading = tile.querySelector('.comparison-graph-tooltip-time').textContent;
    const hovered = new Date(now - 0.5 * HOUR);
    // A 24 hour graph names the day, and the time has no seconds.
    expect(heading).toContain(hovered.toLocaleDateString('en', { weekday: 'short' }));
    expect(heading).toMatch(/\d{1,2}:\d{2}(\s?[AP]M)?$/i);
    expect(heading).not.toMatch(/\d:\d{2}:\d{2}/);
    // 21.4567 reads 21.5, like the legend.
    const values = [...tile.querySelectorAll('.comparison-graph-tooltip-value')].map(
      (el) => el.textContent
    );
    expect(values[0]).toBe('21.5°C');
  });

  describe('live repaints', () => {
    // Two graphs, each with a sensor of its own.
    const twoGraphs = () => {
      const a = makeScenario();
      const first = { ...state.STATES };
      const b = makeScenario();
      // makeScenario replaces every state, so the first pair is put back beside the second.
      state.setStates({ ...first, ...state.STATES });
      state.setConfig({
        homeAssistant: { url: 'http://ha.local', token: 'x' },
        comparisonGraphs: [
          { id: 'graph:a', name: 'A', span: 2, entityIds: [a.warmId] },
          { id: 'graph:b', name: 'B', span: 2, entityIds: [b.warmId] },
        ],
        customTabs: [{ id: 'default', name: 'All', entityIds: ['graph:a', 'graph:b'] }],
        activeTabId: 'default',
        favoriteEntities: ['graph:a', 'graph:b'],
        primaryCards: ['none', 'none'],
        ui: {},
      });
      mockRequest.mockResolvedValue(
        historyResponse({
          [a.warmId]: [
            [20, NOW - 3 * HOUR],
            [21, NOW - 1 * HOUR],
          ],
          [b.warmId]: [
            [10, NOW - 3 * HOUR],
            [11, NOW - 1 * HOUR],
          ],
        })
      );
      return { a: a.warmId, b: b.warmId };
    };
    const legendOf = (graphId) =>
      document
        .querySelector(`.comparison-graph-tile[data-entity-id="${graphId}"]`)
        .querySelector('.comparison-graph-legend-value').textContent;
    const report = (entityId, value) => {
      const next = { ...state.STATES[entityId], state: String(value) };
      state.setEntityState(next);
      ui.updateEntityInUI(next);
    };
    const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

    it('repaints every graph that changed in one burst, not only the last one', async () => {
      const { a, b } = twoGraphs();
      ui.renderActiveTab();
      await flush();
      expect(legendOf('graph:a')).toBe('21.4°C');
      report(a, 25);
      await wait(50);
      report(b, 9);
      await wait(REDRAW_DEBOUNCE_MS + 100);
      // The first graph's repaint was cancelled by the second sensor's update, and it kept the old
      // end point and legend until one of its own sensors reported again.
      expect(legendOf('graph:a')).toBe('25°C');
      expect(legendOf('graph:b')).toBe('9°C');
    });

    it('repaints while sensors keep reporting faster than the delay', async () => {
      const { a } = twoGraphs();
      ui.renderActiveTab();
      await flush();
      // A reading every 80 ms never leaves a quiet moment; a repaint that waits for one waits
      // for the readings to stop.
      for (let value = 22; value < 30; value += 1) {
        report(a, value);
        await wait(80);
      }
      expect(legendOf('graph:a')).not.toBe('21.4°C');
      await wait(REDRAW_DEBOUNCE_MS + 100);
      expect(legendOf('graph:a')).toBe('29°C');
    });

    it('keeps the crosshair and the tooltip under a pointer that has not moved', async () => {
      const { a } = twoGraphs();
      ui.renderActiveTab();
      await flush();
      // jsdom lays nothing out, so every plot, the ones a repaint builds included, is given the
      // size it renders at.
      const box = { left: 0, top: 0, right: 260, bottom: 90, width: 260, height: 90 };
      const layout = jest.spyOn(Element.prototype, 'getBoundingClientRect').mockReturnValue(box);
      const graphA = () =>
        document.querySelector('.comparison-graph-tile[data-entity-id="graph:a"]');
      try {
        const before = graphA().querySelector('.comparison-graph-frame');
        // At the right edge, which is now.
        before.dispatchEvent(new MouseEvent('pointermove', { clientX: 260, bubbles: true }));
        expect(before.querySelector('.comparison-graph-tooltip').hidden).toBe(false);

        report(a, 25);
        await wait(REDRAW_DEBOUNCE_MS + 100);

        // A new chart, with the readout still showing, and showing the new reading.
        const frame = graphA().querySelector('.comparison-graph-frame');
        expect(frame).not.toBe(before);
        expect(frame.querySelector('.comparison-graph-tooltip').hidden).toBe(false);
        expect(frame.querySelector('.comparison-graph-tooltip-value').textContent).toBe('25°C');
        const crosshair = frame.querySelector('.comparison-graph-crosshair');
        expect(crosshair.getAttribute('visibility')).toBe('visible');

        // Once the pointer has left, a repaint brings nothing back.
        frame.dispatchEvent(new MouseEvent('pointerleave'));
        report(a, 26);
        await wait(REDRAW_DEBOUNCE_MS + 100);
        expect(graphA().querySelector('.comparison-graph-tooltip').hidden).toBe(true);
      } finally {
        layout.mockRestore();
      }
    });
  });

  describe('the hover readout', () => {
    // jsdom lays nothing out, so the frame, the plot and the tooltip are given the sizes they have
    // in a two-column graph: a 260px plot and a tooltip about 140px wide and 100px high.
    const hover = async (clientX, { tooltipHeight = 100, tooltipWidth = 140 } = {}) => {
      const { warmId, coldId } = makeScenario();
      mockRequest.mockResolvedValue(
        historyResponse({
          [warmId]: [
            [20, NOW - 3 * HOUR],
            [22, NOW - 1 * HOUR],
          ],
          [coldId]: [[5, NOW - 2 * HOUR]],
        })
      );
      setupConfig([warmId, coldId]);
      ui.renderActiveTab();
      await flush();
      const tile = document.querySelector('.comparison-graph-tile');
      const frame = tile.querySelector('.comparison-graph-frame');
      const tooltip = tile.querySelector('.comparison-graph-tooltip');
      const box = { left: 0, top: 0, width: 260, height: 90 };
      tile.querySelector('.comparison-graph-svg').getBoundingClientRect = () => box;
      frame.getBoundingClientRect = () => box;
      Object.defineProperty(frame, 'clientWidth', { value: 260 });
      Object.defineProperty(frame, 'clientHeight', { value: 90 });
      // 'content': the width follows the names (see the test that fits them), as a laid-out one would.
      if (tooltipWidth !== 'content')
        Object.defineProperty(tooltip, 'offsetWidth', { value: tooltipWidth });
      Object.defineProperty(tooltip, 'offsetHeight', { value: tooltipHeight });
      frame.dispatchEvent(new MouseEvent('pointermove', { clientX, bubbles: true }));
      return {
        tooltip,
        crosshair: tile.querySelector('.comparison-graph-crosshair'),
      };
    };

    it('sits to the right of the pointer when there is room, and to its left when there is not', async () => {
      const left = await hover(65);
      expect(left.tooltip.style.left).toBe('79px');
      const right = await hover(195);
      // 195 - 14 - 140: the tooltip ends before the crosshair.
      expect(right.tooltip.style.left).toBe('41px');
    });

    it('keeps the crosshair clear of it wherever the pointer is', async () => {
      for (const clientX of [10, 65, 130, 150, 195, 250]) {
        const { tooltip, crosshair } = await hover(clientX);
        const line = Number(crosshair.getAttribute('x1')) + 4;
        const start = parseFloat(tooltip.style.left);
        const covers = line >= start && line <= start + 140;
        // Room for it beside the pointer except in the last few pixels either side of the middle,
        // where a 140px tooltip fits on neither side of a 260px plot.
        if (clientX !== 130 && clientX !== 150)
          expect({ clientX, covers }).toEqual({ clientX, covers: false });
      }
    });

    it('rises over the header, not down over the legend, when it is taller than the plot', async () => {
      const { tooltip } = await hover(65, { tooltipHeight: 112 });
      expect(tooltip.style.top).toBe('-22px');
      const short = await hover(65, { tooltipHeight: 60 });
      expect(short.tooltip.style.top).toBe('0px');
    });

    describe('with long series names', () => {
      // A long name is 160px wide, the cap the stylesheet gives it, until the script narrows it; the
      // rest of the tooltip (swatch, value, padding) is `rest`. jsdom lays nothing out, so widths
      // follow those two numbers. The pointer is at 250 of 260, where the series have readings.
      let rest;
      let original;
      beforeEach(() => {
        rest = 60;
        original = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'offsetWidth');
        const nameWidth = (element) => Math.min(300, parseFloat(element.style.maxWidth) || 160);
        Object.defineProperty(HTMLElement.prototype, 'offsetWidth', {
          configurable: true,
          get() {
            if (this.classList.contains('comparison-graph-tooltip-name')) return nameWidth(this);
            if (this.classList.contains('comparison-graph-tooltip')) {
              const names = [...this.querySelectorAll('.comparison-graph-tooltip-name')];
              return rest + Math.max(0, ...names.map(nameWidth));
            }
            return 0;
          },
        });
      });
      afterEach(() => {
        if (original) Object.defineProperty(HTMLElement.prototype, 'offsetWidth', original);
        else delete HTMLElement.prototype.offsetWidth;
      });
      const capOf = (tooltip) =>
        [...tooltip.querySelectorAll('.comparison-graph-tooltip-name')].map(
          (name) => name.style.maxWidth
        );

      it('shows each name whole while the tooltip fits beside the pointer', async () => {
        // 236px of room to the pointer's left, against 60 + 160 = 220 wanted.
        const { tooltip } = await hover(250, { tooltipWidth: 'content' });
        expect(capOf(tooltip)).toEqual(['', '']);
        expect(tooltip.style.left).toBe('16px');
      });

      it('shortens them only as far as it takes to fit beside the pointer', async () => {
        // 236px of room against 120 + 160 = 280 wanted: the names give up the 44px between them,
        // not the 80 a fixed cap would take whatever the room.
        rest = 120;
        const { tooltip, crosshair } = await hover(250, { tooltipWidth: 'content' });
        expect(capOf(tooltip)).toEqual(['116px', '116px']);
        const start = parseFloat(tooltip.style.left);
        expect(start).toBe(0);
        expect(start + tooltip.offsetWidth).toBeLessThanOrEqual(236);
        expect(Number(crosshair.getAttribute('x1')) + 4).toBeGreaterThan(
          start + tooltip.offsetWidth
        );
      });

      it('never takes a name below a few letters, however little room there is', async () => {
        rest = 300;
        const { tooltip } = await hover(250, { tooltipWidth: 'content' });
        expect(capOf(tooltip)).toEqual(['48px', '48px']);
      });
    });

    it('is placed without a transition, which reduced motion would stretch to 0.01ms and so still start', () => {
      // The stylesheet gives every transition 0.01ms under reduced motion rather than none, so a
      // tooltip that sets left and reads it back in the same frame saw the old place, and one
      // shown for the first time sat at the left edge for a frame.
      const styles = require('fs').readFileSync(
        require('path').resolve(__dirname, '../../styles.css'),
        'utf8'
      );
      const rule = (selector) => styles.split('}').find((part) => part.includes(`\n${selector} {`));
      expect(rule('.comparison-graph-tooltip')).toContain('transition: none;');
      expect(rule('.comparison-graph-tooltip-name')).toContain('transition: none;');
    });

    it('puts the crosshair under the pointer, allowing for the margin round the plot', async () => {
      // The plot is a 252-unit stretch inside a 260-unit box with a 4-unit margin: the pointer at
      // the left edge is the plot's start, in the middle it is the plot's middle, at the right edge
      // its end.
      expect((await hover(0)).crosshair.getAttribute('x1')).toBe('0');
      expect((await hover(130)).crosshair.getAttribute('x1')).toBe('126');
      expect((await hover(260)).crosshair.getAttribute('x1')).toBe('252');
      expect((await hover(65)).crosshair.getAttribute('x1')).toBe('61');
    });
  });
});

const { entitiesForArea, loadRoomRegistry } = require('../../src/room-dashboard.js');
const {
  dashboardSnapshot,
  rememberDashboard,
  readDashboardHistory,
} = require('../../src/dashboard-history.js');
const { createAlertEvaluator, inQuietHours, matchesAlert } = require('../../src/alert-rules.js');
const {
  mountSensorHistoryDetail,
  summarizeHistory,
} = require('../../src/sensor-history-detail.js');

describe('room dashboards', () => {
  it('inherits device areas but respects entity overrides and unavailable registry entries', () => {
    const entities = [
      { entity_id: 'light.inherited', device_id: 'device' },
      { entity_id: 'light.override', device_id: 'device', area_id: 'bedroom' },
      { entity_id: 'light.hidden', area_id: 'office', hidden_by: 'user' },
      { entity_id: 'light.disabled', area_id: 'office', disabled_by: 'integration' },
      { entity_id: 'light.missing', area_id: 'office' },
    ];
    const states = Object.fromEntries(entities.slice(0, 4).map((entity) => [entity.entity_id, {}]));
    expect(
      entitiesForArea('office', entities, [{ id: 'device', area_id: 'office' }], states)
    ).toEqual(['light.inherited']);
    expect(
      entitiesForArea('bedroom', entities, [{ id: 'device', area_id: 'office' }], states)
    ).toEqual(['light.override']);
  });
  it('rejects permission errors instead of offering an incomplete room', async () => {
    const request = jest
      .fn()
      .mockResolvedValue({ success: false, error: { code: 'unauthorized' } });
    await expect(loadRoomRegistry({ request })).rejects.toThrow('permissions');
    expect(request).toHaveBeenCalledTimes(3);
  });
});

describe('dashboard restore points', () => {
  const config = (name) => ({
    homeAssistant: { url: 'http://test', token: 'secret' },
    customTabs: [{ id: 'one', name, entityIds: [] }],
  });
  beforeEach(() => localStorage.clear());
  it('keeps a bounded local history without credentials, pins, or hotkeys', () => {
    for (let i = 0; i < 25; i += 1) rememberDashboard(config(String(i)), config(String(i + 1)));
    const entries = readDashboardHistory(config('25'));
    expect(entries).toHaveLength(20);
    expect(entries[0].layout.customTabs[0].name).toBe('24');
    expect(JSON.stringify(entries)).not.toContain('secret');
    expect(
      dashboardSnapshot({ ...config('one'), desktopPins: { secret: true }, globalHotkeys: {} })
    ).not.toHaveProperty('desktopPins');
  });
  it('ignores tab navigation and separates different servers', () => {
    const before = config('one');
    rememberDashboard(before, { ...before, activeTabId: 'other' });
    expect(readDashboardHistory(before)).toEqual([]);
    rememberDashboard(before, config('two'));
    expect(readDashboardHistory({ homeAssistant: { url: 'http://other' } })).toEqual([]);
  });
  it('does not break saves when browser storage is corrupt', () => {
    localStorage.setItem('dashboard-history:http://test', '{');
    expect(readDashboardHistory(config('one'))).toEqual([]);
    expect(() => rememberDashboard(config('one'), config('two'))).not.toThrow();
  });
});

describe('alert conditions', () => {
  let config;
  let notify;
  let evaluator;
  beforeEach(() => {
    jest.useFakeTimers();
    config = {
      enabled: true,
      alerts: {
        sensor: {
          onNumericThreshold: true,
          comparison: 'above',
          threshold: 25,
          durationSeconds: 10,
        },
      },
    };
    notify = jest.fn();
    evaluator = createAlertEvaluator({ getConfig: () => config, notify });
  });
  afterEach(() => {
    evaluator.reset();
    jest.useRealTimers();
  });
  it('waits for a sustained threshold and cancels when the condition clears', () => {
    evaluator.check('sensor', '26');
    jest.advanceTimersByTime(9000);
    evaluator.check('sensor', '24');
    jest.advanceTimersByTime(10000);
    expect(notify).not.toHaveBeenCalled();
    evaluator.check('sensor', '26');
    jest.advanceTimersByTime(5000);
    evaluator.check('sensor', '27');
    jest.advanceTimersByTime(5000);
    expect(notify).toHaveBeenCalledTimes(1);
    expect(notify.mock.calls[0][2]).toBe('27');
    evaluator.check('sensor', '28');
    jest.advanceTimersByTime(20000);
    expect(notify).toHaveBeenCalledTimes(1);
  });
  it('cancels timers on disconnect, unavailable readings, and rule changes', () => {
    evaluator.check('sensor', '26');
    evaluator.reset();
    jest.advanceTimersByTime(10000);
    evaluator.check('sensor', '26');
    evaluator.check('sensor', 'unavailable');
    jest.advanceTimersByTime(10000);
    evaluator.check('sensor', '26');
    config.alerts.sensor.threshold = 30;
    jest.advanceTimersByTime(10000);
    expect(notify).not.toHaveBeenCalled();
  });
  it('honors cooldown across separate threshold crossings', () => {
    config.alerts.sensor.durationSeconds = 0;
    config.alerts.sensor.cooldownSeconds = 60;
    evaluator.check('sensor', '26');
    evaluator.check('sensor', '24');
    evaluator.check('sensor', '26');
    expect(notify).toHaveBeenCalledTimes(1);
    jest.advanceTimersByTime(60000);
    evaluator.check('sensor', '24');
    evaluator.check('sensor', '26');
    expect(notify).toHaveBeenCalledTimes(2);
  });
  it('handles overnight quiet hours and does not interpret missing readings as zero', () => {
    const quiet = { enabled: true, start: '22:00', end: '07:00' };
    expect(inQuietHours(quiet, new Date(2026, 8, 10, 23))).toBe(true);
    expect(inQuietHours(quiet, new Date(2026, 8, 10, 6))).toBe(true);
    expect(inQuietHours(quiet, new Date(2026, 8, 10, 7))).toBe(false);
    expect(matchesAlert({ onNumericThreshold: true, comparison: 'below', threshold: 10 }, '')).toBe(
      false
    );
  });
});

describe('sensor history detail', () => {
  it('computes statistics without treating missing readings as measurements', () => {
    expect(summarizeHistory([{ value: 1 }, { value: NaN }, { value: 3 }])).toEqual({
      min: 1,
      max: 3,
      average: 2,
    });
    expect(summarizeHistory([])).toBeNull();
  });
  it('refetches a period whose cached window is older than a minute', async () => {
    jest.useFakeTimers();
    const modal = document.createElement('div');
    document.body.append(modal);
    const request = jest.fn(async () => ({ result: [{ value: 1, timestamp: Date.now() - 1000 }] }));
    mountSensorHistoryDetail({
      body: modal,
      modal,
      entity: { entity_id: 'sensor.test' },
      websocket: { request },
      normalize: (response) => response.result,
      render: jest.fn(),
    });
    const period = modal.querySelector('select');
    const select = async (value) => {
      period.value = value;
      period.dispatchEvent(new Event('change'));
      await Promise.resolve();
      await Promise.resolve();
    };
    await select('1');
    await select('24');
    expect(request).toHaveBeenCalledTimes(2);
    jest.advanceTimersByTime(61000);
    await select('1');
    expect(request).toHaveBeenCalledTimes(3);
    modal.remove();
    jest.useRealTimers();
  });
  it('ignores an older response after the user selects another period', async () => {
    const modal = document.createElement('div');
    document.body.append(modal);
    const pending = [];
    const request = jest.fn(() => new Promise((resolve) => pending.push(resolve)));
    const render = jest.fn();
    mountSensorHistoryDetail({
      body: modal,
      modal,
      entity: { entity_id: 'sensor.test' },
      websocket: { request },
      normalize: (response) => response.result,
      render,
    });
    const period = modal.querySelector('select');
    period.value = '168';
    period.dispatchEvent(new Event('change'));
    // Samples must predate the request's end time, which was captured when the request was made.
    pending[1]({ result: [{ value: 7, timestamp: Date.now() - 1000 }] });
    await Promise.resolve();
    pending[0]({ result: [{ value: 1, timestamp: Date.now() - 1000 }] });
    await Promise.resolve();
    expect(render).toHaveBeenCalledTimes(1);
    expect(render.mock.calls[0][1][0].value).toBe(7);
    const payload = request.mock.calls[1][0];
    expect(Date.parse(payload.end_time) - Date.parse(payload.start_time)).toBe(7 * 24 * 3600000);
    modal.remove();
  });
});

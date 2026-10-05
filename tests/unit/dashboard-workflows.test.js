const {
  defaultPageEntityIds,
  entitiesForArea,
  loadRoomRegistry,
  pickStarterArea,
} = require('../../src/room-dashboard.js');
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
  it('gives child devices their parent device area unless they carry one of their own', () => {
    const entities = [
      { entity_id: 'switch.outlet_one', device_id: 'outlet-one' },
      { entity_id: 'switch.outlet_two', device_id: 'outlet-two' },
      { entity_id: 'sensor.strip_power', device_id: 'power-strip' },
    ];
    const devices = [
      { id: 'power-strip', area_id: 'garage', parent_device_id: null },
      { id: 'outlet-one', area_id: null, parent_device_id: 'power-strip' },
      { id: 'outlet-two', area_id: 'garden', parent_device_id: 'power-strip' },
    ];
    const states = Object.fromEntries(entities.map((entity) => [entity.entity_id, {}]));
    expect(entitiesForArea('garage', entities, devices, states)).toEqual([
      'switch.outlet_one',
      'sensor.strip_power',
    ]);
    expect(entitiesForArea('garden', entities, devices, states)).toEqual(['switch.outlet_two']);
  });
  it('leaves child devices out of every room when the parent has no area either', () => {
    const entities = [{ entity_id: 'switch.outlet_one', device_id: 'outlet-one' }];
    const devices = [
      { id: 'power-strip', area_id: null, parent_device_id: null },
      { id: 'outlet-one', area_id: null, parent_device_id: 'power-strip' },
    ];
    expect(entitiesForArea('garage', entities, devices, { 'switch.outlet_one': {} })).toEqual([]);
  });
  it('rejects permission errors instead of offering an incomplete room', async () => {
    const request = jest
      .fn()
      .mockResolvedValue({ success: false, error: { code: 'unauthorized' } });
    await expect(loadRoomRegistry({ request })).rejects.toThrow('permissions');
    // Marked so the Add Page dialog does not offer a retry that cannot succeed.
    await expect(loadRoomRegistry({ request })).rejects.toMatchObject({
      code: 'registry_unavailable',
    });
    expect(request).toHaveBeenCalledTimes(6);
  });
});

describe('first page starter', () => {
  const entity = (entity_id, area_id, extra = {}) => ({ entity_id, area_id, ...extra });
  const on = (...ids) => Object.fromEntries(ids.map((id) => [id, { state: 'on' }]));

  it('starts from the room with the most things to control, not the first with any entity', () => {
    // Attic holds one device setting; Kitchen and Living room hold real lights and switches.
    const entities = [
      entity('switch.attic_led_indicator', 'attic', { entity_category: 'config' }),
      entity('light.kitchen_ceiling', 'kitchen'),
      entity('switch.kitchen_coffee', 'kitchen'),
      entity('light.living_lamp', 'living'),
      entity('light.living_strip', 'living'),
      entity('media_player.living_tv', 'living'),
    ];
    const areas = [
      { area_id: 'living', name: 'Living room' },
      { area_id: 'attic', name: 'Attic' },
      { area_id: 'kitchen', name: 'Kitchen' },
    ];
    const states = on(...entities.map((item) => item.entity_id));
    expect(pickStarterArea(areas, entities, [], states)).toBe('living');
  });

  it('breaks a tie by room name, whatever order the rooms arrive in', () => {
    const entities = [entity('light.a', 'zeta'), entity('light.b', 'alpha')];
    const areas = [
      { area_id: 'zeta', name: 'Zeta room' },
      { area_id: 'alpha', name: 'Alpha room' },
    ];
    expect(pickStarterArea(areas, entities, [], on('light.a', 'light.b'))).toBe('alpha');
  });

  it('shows every device when no room has anything to control', () => {
    const entities = [
      entity('sensor.attic_temperature', 'attic'),
      entity('switch.attic_child_lock', 'attic', { entity_category: 'config' }),
      entity('light.cellar_lamp', 'cellar'),
    ];
    const areas = [
      { area_id: 'attic', name: 'Attic' },
      { area_id: 'cellar', name: 'Cellar' },
    ];
    // The cellar lamp is unavailable, so it is not a start either.
    const states = {
      ...on('sensor.attic_temperature', 'switch.attic_child_lock'),
      'light.cellar_lamp': { state: 'unavailable' },
    };
    expect(pickStarterArea(areas, entities, [], states)).toBe('');
    expect(pickStarterArea([], entities, [], states)).toBe('');
  });

  it('suggests the devices and appliances a home has, but not what acts with one click', () => {
    const ids = [
      'lock.front_door',
      'scene.movie',
      'script.goodnight',
      'vacuum.robot',
      'humidifier.bedroom',
      'water_heater.tank',
      'sensor.power',
      'binary_sensor.door',
      'button.restart',
    ];
    // Unticked but still listed: the Add Page dialog lists every id and ticks only these.
    expect(defaultPageEntityIds(ids, [], on(...ids))).toEqual([
      'vacuum.robot',
      'humidifier.bedroom',
      'water_heater.tank',
    ]);
  });

  it('fills a page of eight with devices before appliances', () => {
    const ids = [
      'vacuum.aaa_robot',
      ...Array.from({ length: 8 }, (_, index) => `light.l${index}`),
      'humidifier.bedroom',
    ];
    expect(defaultPageEntityIds(ids, [], on(...ids), 8)).toEqual(ids.slice(1, 9));
    // With room to spare the appliances come after the devices.
    expect(defaultPageEntityIds(ids, [], on(...ids), 10)).toEqual([
      ...ids.slice(1, 9),
      'vacuum.aaa_robot',
      'humidifier.bedroom',
    ]);
  });

  it('does not start a first page in a room whose only controls act with one click', () => {
    const entities = [entity('lock.hall_door', 'hall'), entity('script.hall_scene', 'hall')];
    const areas = [{ area_id: 'hall', name: 'Hall' }];
    expect(pickStarterArea(areas, entities, [], on('lock.hall_door', 'script.hall_scene'))).toBe(
      ''
    );
  });

  it('leaves out device settings and what is not ready, and keeps state-only entities', () => {
    const registry = [
      entity('switch.lamp_led_indicator', null, { entity_category: 'config' }),
      entity('switch.lamp_diagnostic', null, { entity_category: 'diagnostic' }),
      entity('light.lamp', null, { entity_category: null }),
    ];
    const states = {
      ...on('switch.lamp_led_indicator', 'switch.lamp_diagnostic', 'light.lamp', 'fan.state_only'),
      'light.broken': { state: 'unavailable' },
      'light.waking': { state: 'unknown' },
    };
    const ids = [
      'switch.lamp_led_indicator',
      'switch.lamp_diagnostic',
      'light.lamp',
      'fan.state_only',
      'light.broken',
      'light.waking',
    ];
    expect(defaultPageEntityIds(ids, registry, states)).toEqual(['light.lamp', 'fan.state_only']);
  });

  it('caps the suggestion at the limit it is given', () => {
    const ids = Array.from({ length: 12 }, (_, index) => `light.l${index}`);
    expect(defaultPageEntityIds(ids, [], on(...ids), 8)).toEqual(ids.slice(0, 8));
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
  it('does not count the name a page is shown with in some language as a change', () => {
    // The layout on screen names a page nobody named for the language ("Alle"); the main process
    // keeps it unnamed. They are the same dashboard, whichever way round they are compared.
    const shown = { id: 'default', name: 'Alle', nameIsDefault: true, entityIds: ['light.a'] };
    const stored = { id: 'default', name: '', entityIds: ['light.a'] };
    const layout = (tab) => ({ homeAssistant: { url: 'http://test' }, customTabs: [tab] });

    rememberDashboard(layout(shown), layout(stored));
    rememberDashboard(layout(stored), layout(shown));
    rememberDashboard(layout(shown), layout({ ...shown, name: 'All' }));
    expect(readDashboardHistory(layout(stored))).toEqual([]);

    // A change that is one still counts, and the same layout is not kept twice because it was
    // seen once under a language's name and once as stored.
    rememberDashboard(layout(shown), layout({ ...stored, entityIds: [] }));
    rememberDashboard(layout(stored), layout({ ...stored, entityIds: ['light.b'] }));
    expect(readDashboardHistory(layout(stored))).toHaveLength(1);
  });
  it('does not break saves when browser storage is corrupt', () => {
    localStorage.setItem('dashboard-history:http://test', '{');
    expect(readDashboardHistory(config('one'))).toEqual([]);
    expect(() => rememberDashboard(config('one'), config('two'))).not.toThrow();
  });
});

describe('Restore dashboard restore points', () => {
  const config = (...names) => ({
    homeAssistant: { url: 'http://test', token: 'secret' },
    customTabs: names.map((name) => ({ id: name, name, entityIds: [] })),
  });
  // Each list as its layouts' page names, newest first: "A+B" is a layout of pages A and B.
  const pages = (entries) =>
    entries.map((entry) => entry.layout.customTabs.map((tab) => tab.name).join('+'));
  let history;
  let current;
  // Saves `next` over the layout on screen, as the dashboard does after an edit.
  const edit = (next, options) => {
    history.rememberDashboard(current, next, options);
    current = next;
  };
  const wait = (seconds) => jest.advanceTimersByTime(seconds * 1000);

  beforeEach(() => {
    jest.useFakeTimers({ now: new Date('2026-10-05T10:00:00Z') });
    // A fresh module is a fresh start of the app: no burst of edits in progress.
    jest.resetModules();
    history = require('../../src/dashboard-history.js');
    localStorage.clear();
    current = config('A');
  });

  afterEach(() => {
    jest.useRealTimers();
    localStorage.clear();
  });

  it('makes one restore point of a burst of edits, while Undo keeps every step', () => {
    for (let i = 1; i <= 25; i += 1) {
      wait(10);
      edit(config('A', `E${i}`));
    }
    wait(29.999);
    edit(config('A', 'E26'));
    expect(history.readDashboardHistory(current)).toHaveLength(20);
    expect(pages(history.readDashboardHistory(current))[0]).toBe('A+E25');
    expect(pages(history.readRestorePoints(current))).toEqual(['A']);

    // Thirty seconds without a change end the burst; the next edit starts another.
    wait(30);
    edit(config('B'));
    expect(pages(history.readRestorePoints(current))).toEqual(['A+E26', 'A']);
  });

  it('keeps older restore points that a burst of edits pushes out of the Undo history', () => {
    ['B', 'C', 'D'].forEach((name) => {
      wait(60);
      edit(config(name));
    });
    wait(60);
    for (let i = 1; i <= 25; i += 1) {
      wait(2);
      edit(config('D', `E${i}`));
    }
    expect(pages(history.readDashboardHistory(current))).not.toContain('C');
    expect(pages(history.readRestorePoints(current))).toEqual(['D', 'C', 'B', 'A']);
  });

  it('keeps the newest 20 restore points, newest first, each dated when it was saved', () => {
    const start = Date.now();
    for (let i = 1; i <= 25; i += 1) {
      wait(30);
      edit(config(`P${i}`));
    }
    const points = history.readRestorePoints(current);
    expect(points).toHaveLength(20);
    expect(pages(points)[0]).toBe('P24');
    expect(pages(points)[19]).toBe('P5');
    expect(points[0].at).toBe(start + 24 * 30 * 1000);
  });

  it('keeps the layout a burst of edits leaves once the dashboard has been idle for 30 s', () => {
    edit(config('A', 'B'));
    wait(5);
    edit(config('A', 'B', 'C'));
    wait(5);
    const savedAt = Date.now();
    edit({ ...config('A', 'B', 'C', 'D'), activeTabId: 'D' });
    wait(29.999);
    expect(pages(history.readRestorePoints(current))).toEqual(['A']);
    wait(0.001);
    const points = history.readRestorePoints(current);
    expect(pages(points)).toEqual(['A+B+C+D', 'A']);
    expect(points[0]).toMatchObject({ at: savedAt, activeTabId: 'D' });
    expect(points[0]).not.toHaveProperty('undone');

    // A profile sync or a settings import later replaces it without passing here, and the next
    // edit starts from the layout they left. The finished layout is still there to go back to.
    wait(10 * 60);
    current = config('S');
    edit(config('S', 'T'));
    expect(pages(history.readRestorePoints(current))).toEqual(['S', 'A+B+C+D', 'A']);

    // The next burst starts from the layout this one left, which is not kept twice.
    wait(30);
    edit(config('S', 'T', 'U'));
    expect(pages(history.readRestorePoints(current))).toEqual(['S+T', 'S', 'A+B+C+D', 'A']);
  });

  it('keeps the layout an edit left when the app closes before the dashboard is idle', () => {
    // Earlier tests' copies of the module listen for the close too. A server of its own keeps the
    // layouts they hold out of this list.
    const closing = (...names) => ({ ...config(...names), homeAssistant: { url: 'http://close' } });
    current = closing('A');
    edit(closing('A', 'B'));
    wait(5);
    window.dispatchEvent(new Event('pagehide'));
    expect(pages(history.readRestorePoints(current))).toEqual(['A+B', 'A']);

    // A sync replaces it before the first edit after the restart.
    jest.resetModules();
    history = require('../../src/dashboard-history.js');
    current = closing('S');
    edit(closing('S', 'T'));
    expect(pages(history.readRestorePoints(current))).toEqual(['S', 'A+B', 'A']);
  });

  it('gives what a restore, an Undo or a profile replaces a restore point of its own', () => {
    edit(config('A', 'B'));
    wait(5);
    // A layout picked in Restore dashboard, or a profile from Home Assistant.
    edit(config('Z'), { wholeLayout: true });
    wait(5);
    edit(config('A'), { undone: true });
    // An edit straight after an Undo is part of the Undo's burst.
    wait(5);
    edit(config('A', 'C'));
    let points = history.readRestorePoints(current);
    expect(pages(points)).toEqual(['Z', 'A+B', 'A']);
    expect(points.map((point) => point.undone === true)).toEqual([true, false, false]);

    // Once idle, the layout the burst left is kept, and an Undo of it later still says so.
    wait(30);
    edit(config('A'), { undone: true });
    points = history.readRestorePoints(current);
    expect(pages(points)).toEqual(['A+C', 'Z', 'A+B', 'A']);
    expect(points.map((point) => point.undone === true)).toEqual([true, true, false, false]);
  });

  it('gives a layout that changed between edits, as a sync or an import does, a restore point', () => {
    edit(config('A', 'B'));
    wait(5);
    // Profile sync and settings imports save the layout without remembering what they replaced.
    current = config('S');
    wait(5);
    edit(config('S', 'T'));
    // The layout the edit left is kept as well, though it was replaced within 30 s.
    expect(pages(history.readRestorePoints(current))).toEqual(['S', 'A+B', 'A']);
  });

  it('starts a new restore point when the clock goes back', () => {
    edit(config('B'));
    jest.setSystemTime(Date.now() - 60 * 60 * 1000);
    edit(config('C'));
    expect(pages(history.readRestorePoints(current))).toEqual(['B', 'A']);
  });

  it('starts from the Undo history after an upgrade, once, and keeps the list across restarts', () => {
    const historyKey = 'dashboard-history:http://test';
    localStorage.setItem(
      historyKey,
      JSON.stringify([
        { at: 3000, layout: config('C'), activeTabId: 'C', undone: true },
        { at: 2000, layout: config('B') },
        { at: 1000, layout: config('A') },
      ])
    );
    const seeded = history.readRestorePoints(current);
    expect(seeded).toEqual(history.readDashboardHistory(current));
    expect(seeded[0]).toMatchObject({ at: 3000, activeTabId: 'C', undone: true });

    // The copy is made once: after a restart the restore points no longer follow the history.
    localStorage.setItem(historyKey, '[]');
    jest.resetModules();
    history = require('../../src/dashboard-history.js');
    expect(history.readRestorePoints(current)).toEqual(seeded);
    edit(config('A', 'X'));
    expect(pages(history.readRestorePoints(current))).toEqual(['A', 'C', 'B', 'A']);
  });

  it('copies the Undo history before its first change after an upgrade', () => {
    localStorage.setItem(
      'dashboard-history:http://test',
      JSON.stringify([{ at: 1000, layout: config('B') }])
    );
    // An Undo rewrites the history without reading the restore points first.
    history.writeDashboardHistory(current, []);
    expect(pages(history.readRestorePoints(current))).toEqual(['B']);

    localStorage.clear();
    localStorage.setItem(
      'dashboard-history:http://test',
      JSON.stringify([{ at: 1000, layout: config('B') }])
    );
    edit(config('C'));
    expect(pages(history.readRestorePoints(current))).toEqual(['A', 'B']);
  });

  it('keeps restore points per server and does not break saves when storage is corrupt', () => {
    edit(config('B'));
    expect(history.readRestorePoints({ homeAssistant: { url: 'http://other' } })).toEqual([]);
    // An edit on another server straight after keeps the layout this one was left with.
    const other = (...names) => ({ ...config(...names), homeAssistant: { url: 'http://other' } });
    history.rememberDashboard(other('X'), other('Y'));
    expect(pages(history.readRestorePoints(current))).toEqual(['B', 'A']);
    expect(pages(history.readRestorePoints(other()))).toEqual(['X']);
    localStorage.setItem('dashboard-restore-points:http://test', '{');
    expect(history.readRestorePoints(current)).toEqual([]);
    wait(60);
    expect(() => edit(config('C'))).not.toThrow();
    expect(pages(history.readRestorePoints(current))).toEqual(['B']);
    expect(JSON.stringify(localStorage)).not.toContain('secret');
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
  it('styles the target state field like the other condition fields', () => {
    const fs = require('fs');
    const path = require('path');
    const html = fs.readFileSync(path.join(__dirname, '../../index.html'), 'utf8');
    const markup = new DOMParser().parseFromString(html, 'text/html');
    const label = markup.querySelector('label[for="target-state-input"]');
    expect(label.textContent).toBe('Target state');
    expect(label.dataset.i18n).toBe('Target state');
    // Home Assistant states are at most 255 characters, and a settings file holds 256 of text.
    expect(markup.getElementById('target-state-input').maxLength).toBe(255);
    // The older form-group wrapper must not bring its own spacing or larger text into the grid.
    const css = fs.readFileSync(path.join(__dirname, '../../dashboard-workflows.css'), 'utf8');
    const rule = /\.alert-advanced-options > \.form-group \{([^}]*)\}/.exec(css)?.[1] || '';
    expect(rule).toMatch(/margin: 0;/);
    expect(rule).toMatch(/font-size: var\(--font-size-sm\);/);
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
  it('keeps focus on Refresh while it reloads and ignores presses until it finishes', async () => {
    const modal = document.createElement('div');
    document.body.append(modal);
    const pending = [];
    const request = jest.fn(() => new Promise((resolve) => pending.push(resolve)));
    mountSensorHistoryDetail({
      body: modal,
      modal,
      entity: { entity_id: 'sensor.test' },
      websocket: { request },
      normalize: (response) => response.result,
      render: jest.fn(),
    });
    const refresh = modal.querySelector('button');
    refresh.focus();
    expect(refresh.disabled).toBe(false);
    expect(refresh.getAttribute('aria-disabled')).toBe('true');
    expect(document.activeElement).toBe(refresh);
    refresh.click();
    expect(request).toHaveBeenCalledTimes(1);
    pending[0]({ result: [{ value: 1, timestamp: Date.now() - 1000 }] });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(refresh.hasAttribute('aria-disabled')).toBe(false);
    refresh.click();
    expect(request).toHaveBeenCalledTimes(2);
    expect(document.activeElement).toBe(refresh);
    modal.remove();
  });
  it('puts the Refresh label back when a retry succeeds with no recorded values', async () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    const modal = document.createElement('div');
    document.body.append(modal);
    const request = jest
      .fn()
      .mockRejectedValueOnce(new Error('recorder offline'))
      .mockResolvedValue({ result: [] });
    mountSensorHistoryDetail({
      body: modal,
      modal,
      entity: { entity_id: 'sensor.test' },
      websocket: { request },
      normalize: (response) => response.result,
      render: jest.fn(),
    });
    const refresh = modal.querySelector('button');
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(refresh.textContent).toBe('Retry');
    refresh.click();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(request).toHaveBeenCalledTimes(2);
    expect(modal.querySelector('.sensor-history-summary').textContent).toBe(
      'No recorded values in this period.'
    );
    expect(refresh.textContent).toBe('Refresh');
    modal.remove();
    warn.mockRestore();
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

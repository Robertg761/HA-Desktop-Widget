/**
 * @jest-environment node
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

const {
  USAGE_PING_URL,
  USAGE_STATE_FILE_NAME,
  createUsagePinger,
  isUsagePingDisabledByEnv,
  utcDay,
} = require('../../src/usage-ping.cjs');

const FIXED_ID = '6f1c2a9e-3b7d-4f0a-9c55-2e8d1b4a7f60';

describe('anonymous usage ping', () => {
  let userDataDir;
  let fetchImpl;
  let currentTime;
  let enabled;

  const createPinger = (overrides = {}) =>
    createUsagePinger({
      fs,
      path,
      userDataDir,
      randomUUID: () => FIXED_ID,
      fetchImpl,
      isEnabled: () => enabled,
      appVersion: '4.0.1',
      platform: 'win32',
      now: () => currentTime,
      ...overrides,
    });

  const readState = () =>
    JSON.parse(fs.readFileSync(path.join(userDataDir, USAGE_STATE_FILE_NAME), 'utf8'));

  beforeEach(() => {
    userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ha-widget-usage-'));
    fetchImpl = jest.fn().mockResolvedValue({ ok: true, status: 204 });
    currentTime = Date.parse('2026-10-02T12:00:00Z');
    enabled = true;
  });

  afterEach(() => {
    fs.rmSync(userDataDir, { recursive: true, force: true });
  });

  test('sends only the install ID, app version and OS family', async () => {
    await expect(createPinger().pingIfDue()).resolves.toBe(true);

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe(USAGE_PING_URL);
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body)).toEqual({ id: FIXED_ID, version: '4.0.1', os: 'win32' });
  });

  test('keeps the install ID in its own file and reuses it', async () => {
    await createPinger().pingIfDue();
    currentTime += 24 * 60 * 60 * 1000;
    await createPinger({ randomUUID: () => 'should-not-be-used' }).pingIfDue();

    const ids = fetchImpl.mock.calls.map(([, init]) => JSON.parse(init.body).id);
    expect(ids).toEqual([FIXED_ID, FIXED_ID]);
    expect(readState()).toEqual({ installId: FIXED_ID, lastPingDay: '2026-10-03' });
  });

  test('sends at most once per UTC day, even across restarts', async () => {
    await createPinger().pingIfDue();
    currentTime += 6 * 60 * 60 * 1000;
    await expect(createPinger().pingIfDue()).resolves.toBe(false);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  test('sends nothing and creates no ID while turned off', async () => {
    enabled = false;
    await expect(createPinger().pingIfDue()).resolves.toBe(false);
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(fs.existsSync(path.join(userDataDir, USAGE_STATE_FILE_NAME))).toBe(false);
  });

  test('retries later the same day after a failed send', async () => {
    fetchImpl.mockRejectedValueOnce(new Error('offline'));
    const pinger = createPinger({ log: { info: jest.fn() } });

    await expect(pinger.pingIfDue()).resolves.toBe(false);
    expect(readState().lastPingDay).toBe('');
    await expect(pinger.pingIfDue()).resolves.toBe(true);
    expect(readState().lastPingDay).toBe('2026-10-02');
  });

  test('treats a non-2xx response as not sent', async () => {
    fetchImpl.mockResolvedValueOnce({ ok: false, status: 503 });
    await expect(createPinger({ log: { info: jest.fn() } }).pingIfDue()).resolves.toBe(false);
    expect(readState().lastPingDay).toBe('');
  });

  test('replaces a damaged state file with a fresh ID', async () => {
    fs.writeFileSync(path.join(userDataDir, USAGE_STATE_FILE_NAME), '{"installId":"nope"');
    await createPinger().pingIfDue();
    expect(readState().installId).toBe(FIXED_ID);
  });

  test('reports unknown platforms as "other"', async () => {
    await createPinger({ platform: 'freebsd' }).pingIfDue();
    expect(JSON.parse(fetchImpl.mock.calls[0][1].body).os).toBe('other');
  });

  test('start schedules a first check after the initial delay, then rechecks', async () => {
    const timers = [];
    const setTimer = jest.fn((callback, delay) => {
      timers.push({ callback, delay });
      return { unref: jest.fn() };
    });
    const pinger = createPinger({ setTimer, initialDelayMs: 5, checkIntervalMs: 50 });

    pinger.start();
    pinger.start();
    expect(timers.map((timer) => timer.delay)).toEqual([5]);

    await timers[0].callback();
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(timers.map((timer) => timer.delay)).toEqual([5, 50]);
  });

  test('honours DO_NOT_TRACK and the app-specific opt-out variable', () => {
    expect(isUsagePingDisabledByEnv({})).toBe(false);
    expect(isUsagePingDisabledByEnv({ DO_NOT_TRACK: '0' })).toBe(false);
    expect(isUsagePingDisabledByEnv({ DO_NOT_TRACK: '1' })).toBe(true);
    expect(isUsagePingDisabledByEnv({ HA_WIDGET_DISABLE_USAGE_PING: 'true' })).toBe(true);
  });

  test('utcDay uses the UTC calendar date', () => {
    expect(utcDay(Date.parse('2026-10-02T23:59:59-05:00'))).toBe('2026-10-03');
  });
});

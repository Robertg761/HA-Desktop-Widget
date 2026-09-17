/** @jest-environment node */
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const source = fs.readFileSync(path.join(__dirname, '../../main.js'), 'utf8');

function fixture(overrides = {}) {
  const context = {
    isQuitting: false,
    usesPortalGlobalShortcuts: true,
    portalShortcutsFallbackLatched: false,
    portalReconnectTimer: null,
    portalReconnectAttempts: 0,
    PORTAL_RECONNECT_DELAY_MS: 1000,
    portalShortcutsActive: true,
    portalShortcutsController: {},
    syncPortalShortcuts: jest.fn().mockResolvedValue({ success: true }),
    ensurePortalShortcutsBackendInitialized: jest.fn(),
    setTimeout,
    ...overrides,
  };
  vm.createContext(context);
  vm.runInContext(
    source.slice(
      source.indexOf('function schedulePortalConnectionRecovery()'),
      source.indexOf('// Once the portal has demonstrated')
    ),
    context
  );
  return context;
}

beforeEach(() => jest.useFakeTimers());
afterEach(() => jest.useRealTimers());

test('recovery coalesces signals, backs off after failure and resets after success', async () => {
  const f = fixture();
  f.syncPortalShortcuts.mockResolvedValueOnce({ success: false });
  f.schedulePortalConnectionRecovery();
  f.schedulePortalConnectionRecovery();
  await jest.advanceTimersByTimeAsync(1000);
  expect(f.syncPortalShortcuts).toHaveBeenCalledTimes(1);
  await jest.advanceTimersByTimeAsync(1999);
  expect(f.syncPortalShortcuts).toHaveBeenCalledTimes(1);
  await jest.advanceTimersByTimeAsync(1);
  expect(f.syncPortalShortcuts).toHaveBeenCalledTimes(2);
  expect(f.portalReconnectAttempts).toBe(0);
  expect(jest.getTimerCount()).toBe(0);
});

test('a late portal is initialized without opening settings', async () => {
  const f = fixture({ portalShortcutsActive: false, portalShortcutsController: null });
  f.schedulePortalConnectionRecovery();
  await jest.advanceTimersByTimeAsync(1000);
  expect(f.ensurePortalShortcutsBackendInitialized).toHaveBeenCalledTimes(1);
});

test('cancelled approval stops retries', async () => {
  const f = fixture();
  f.syncPortalShortcuts.mockResolvedValue({ success: false, retryable: false });
  f.schedulePortalConnectionRecovery();
  await jest.advanceTimersByTimeAsync(60000);
  expect(f.syncPortalShortcuts).toHaveBeenCalledTimes(1);
  expect(jest.getTimerCount()).toBe(0);
});

test.each([
  { isQuitting: true },
  { portalShortcutsFallbackLatched: true },
  { usesPortalGlobalShortcuts: false },
])('does not schedule recovery when disabled: %j', (options) => {
  fixture(options).schedulePortalConnectionRecovery();
  expect(jest.getTimerCount()).toBe(0);
});

test('startup repairs continue after each independent operation fails', () => {
  const names = [
    'ensureAppImageDesktopEntry',
    'repairStaleAppImageLaunchers',
    'migrateLegacyLinuxAutostartEntry',
    'syncLinuxAutostartExecutablePath',
  ];
  for (const failing of names.slice(0, -1)) {
    const context = {
      path,
      __dirname: '/app',
      pkg: {},
      app: { getName: () => 'widget' },
      process: { env: {} },
      log: { info: jest.fn(), warn: jest.fn() },
      getLinuxStartupExecutablePath: () => '/widget',
    };
    names.forEach((name) => {
      context[name] = jest.fn(() => {
        if (name === failing) throw new Error('read-only');
        return name === 'repairStaleAppImageLaunchers' ? [] : {};
      });
    });
    vm.createContext(context);
    const start = source.indexOf('      try {\n        ensureAppImageDesktopEntry');
    const end = source.indexOf('\n    installApplicationMenu', start);
    // Exclude the enclosing packaged-startup condition's closing brace.
    vm.runInContext(source.slice(start, end).replace(/\n {4}}\s*$/, ''), context);
    names.forEach((name) => expect(context[name]).toHaveBeenCalledTimes(1));
    expect(context.log.warn).toHaveBeenCalledTimes(1);
  }
});

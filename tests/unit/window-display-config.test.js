/** @jest-environment node */
const fs = require('fs');
const vm = require('vm');
const { createProfileSyncHarness, profileSyncCore } = require('../helpers/profile-sync-devices.js');
const helpers = require('../../src/window-display.cjs');
const source = fs.readFileSync(require.resolve('../../main.js'), 'utf8');
const harness = createProfileSyncHarness();
beforeEach(() => harness.setup());
afterEach(() => harness.teardown());

function device() {
  const device = harness.createDevice('desktop', { syncing: false });
  const primary = { id: 1, label: 'Laptop', workArea: { x: 0, y: 0, width: 1920, height: 1080 } };
  const secondary = {
    id: 2,
    label: 'Desk',
    workArea: { x: 1920, y: 0, width: 1920, height: 1080 },
  };
  Object.assign(device.config, {
    windowPosition: { x: 100, y: 100 },
    windowSize: { width: 500, height: 600 },
  });
  Object.assign(device.context, helpers, {
    usesCompositorOwnedPlacement: false,
    electronScreen: {
      getAllDisplays: () => [primary, secondary],
      getPrimaryDisplay: () => primary,
      getDisplayMatching: (bounds) => (bounds.x >= 1920 ? secondary : primary),
    },
  });
  const start = source.indexOf('function getWindowDisplaySettings(');
  vm.runInContext(
    source.slice(start, source.indexOf('// Save the monitor choice', start)),
    device.context
  );
  return device;
}

test('Settings persists a selected display and consumes the one-time request', async () => {
  const desktop = device();
  const result = await desktop.invoke('update-config', { windowDisplayChoice: '2' });
  expect(result.success).not.toBe(false);
  expect(desktop.config.windowDisplay).toEqual({
    id: '2',
    label: 'Desk',
    offset: { x: 100, y: 100 },
  });
  expect(desktop.config.windowPosition).toEqual({ x: 2020, y: 100 });
  expect(desktop.config).not.toHaveProperty('windowDisplayChoice');
  expect(profileSyncCore.projectSyncProfile(desktop.config)).not.toHaveProperty('windowDisplay');
});

test('an old renderer snapshot cannot erase a tray selection or a newer position', async () => {
  const desktop = device();
  const stale = desktop.rendererConfig();
  await desktop.invoke('update-config', { windowDisplayChoice: '2' });
  const preference = desktop.config.windowDisplay;
  const result = await desktop.invoke('update-config', { ...stale, opacity: 0.7 });
  expect(result.success).not.toBe(false);
  expect(desktop.config.windowDisplay).toEqual(preference);
  expect(desktop.config.windowPosition).toEqual({ x: 2020, y: 100 });
  expect(desktop.config.opacity).toBe(0.7);
});

test('an invalid display or a failed save does not partially apply Settings', async () => {
  const desktop = device();
  const before = JSON.stringify(desktop.config);
  expect(
    (await desktop.invoke('update-config', { windowDisplayChoice: 'gone', opacity: 0.5 })).success
  ).toBe(false);
  expect(JSON.stringify(desktop.config)).toBe(before);
  desktop.context.saveConfigDurably = async () => ({ success: false, error: 'disk full' });
  expect(
    (await desktop.invoke('update-config', { windowDisplayChoice: '2', opacity: 0.5 })).success
  ).toBe(false);
  expect(JSON.stringify(desktop.config)).toBe(before);
});

test('a compositor-owned window rejects a normal display request', async () => {
  const desktop = device();
  desktop.context.usesCompositorOwnedPlacement = true;
  expect((await desktop.invoke('update-config', { windowDisplayChoice: '2' })).success).toBe(false);
  expect(desktop.config.windowDisplay).toBeUndefined();
});

test('Settings preserves a drag made while its display selection is being saved', async () => {
  const desktop = device();
  let bounds = { x: 100, y: 100, width: 500, height: 600 };
  let moved;
  Object.assign(desktop.context, {
    mainWindow: {
      isDestroyed: () => false,
      getBounds: () => ({ ...bounds }),
      setPosition: (x, y) => {
        bounds = { ...bounds, x, y };
      },
    },
    pendingWindowBounds: null,
    displayChangeTimer: null,
    isLayerShellChildProcess: false,
    setTimeout: () => 1,
    mainWindowMatchesSavedBounds: () => false,
    onWindowBoundsChanged: (_window, handlers) => {
      moved = handlers.onMove;
    },
    windowStateSaveTimer: null,
    clearTimeout,
    clampToMinimumWindowSize: ({ width, height }) => ({ width, height }),
    desktopPinWindows: new Map(),
    refreshTrayMenu: () => {},
  });
  for (const [startMarker, endMarker] of [
    ['function watchMainWindowBounds(', 'const DISPLAY_CHANGE_RECOVERY_DELAY_MS'],
    ['function moveMainWindowToPosition(', 'function getWindowDisplaySettings('],
    ['function applyMainWindowSettingSideEffects(', 'function configSectionChanged('],
  ]) {
    const start = source.indexOf(startMarker);
    vm.runInContext(source.slice(start, source.indexOf(endMarker, start)), desktop.context);
  }
  desktop.context.watchMainWindowBounds(desktop.context.mainWindow);
  desktop.context.saveConfigDurably = async () => {
    bounds = { x: 320, y: 190, width: 500, height: 600 };
    moved();
    return { success: true, persistenceWarnings: [] };
  };
  const result = await desktop.invoke('update-config', { windowDisplayChoice: '2' });
  expect(result.success).not.toBe(false);
  expect(bounds).toEqual({ x: 320, y: 190, width: 500, height: 600 });
  expect(desktop.config.windowDisplay).toMatchObject({ id: '1', offset: { x: 320, y: 190 } });
  expect(desktop.config.windowPosition).toEqual({ x: 320, y: 190 });
});

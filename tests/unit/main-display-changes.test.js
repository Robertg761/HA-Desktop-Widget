/**
 * @jest-environment node
 */

const { EventEmitter } = require('events');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const {
  clampDesktopPinBounds,
  getDesktopPinBaseBounds,
  getDesktopPinWindowBounds,
} = require('../../src/desktop-pin-bounds.js');
const {
  boundsVisibleOnAnyWorkArea,
  clampPositionToWorkAreas,
} = require('../../src/window-placement.cjs');

const { onWindowBoundsChanged } = require('../../src/window-bounds-events.cjs');

const mainSource = fs.readFileSync(path.resolve(__dirname, '../../main.js'), 'utf8');
const {
  resolveWindowDisplayPosition,
  findPreferredWindowDisplay,
  createDisplayIdentityScreen,
  rememberWindowDisplayPosition,
} = require('../../src/window-display.cjs');

function sliceMain(startMarker, endMarker) {
  const start = mainSource.indexOf(startMarker);
  const end = mainSource.indexOf(endMarker, start);
  expect(start).toBeGreaterThan(-1);
  expect(end).toBeGreaterThan(start);
  return mainSource.slice(start, end);
}

const PRIMARY = { x: 0, y: 0, width: 1920, height: 1040 };
const SECONDARY = { x: 1920, y: 0, width: 1920, height: 1040 };

function createScreen(workAreas) {
  const screen = new EventEmitter();
  let areas = workAreas;
  const nearest = (point) =>
    areas.reduce((best, area) =>
      Math.abs(point.x - (area.x + area.width / 2)) < Math.abs(point.x - (best.x + best.width / 2))
        ? area
        : best
    );
  Object.assign(screen, {
    getAllDisplays: () => areas.map((workArea, index) => ({ id: index + 1, workArea })),
    getPrimaryDisplay: () => ({ id: 1, workArea: areas[0] }),
    getDisplayMatching: (bounds) => {
      const workArea = nearest(bounds);
      return { id: areas.indexOf(workArea) + 1, workArea };
    },
    setDisplays: (next) => {
      areas = next;
    },
  });
  return screen;
}

describe('a pin saved on a monitor that is not connected', () => {
  function loadPins({ displays = [PRIMARY], compositorOwned = false } = {}) {
    const electronScreen = createScreen(displays);
    const context = {
      config: { ui: { scale: 1 }, desktopPins: {} },
      electronScreen,
      boundsVisibleOnAnyWorkArea,
      usesCompositorOwnedPlacement: compositorOwned,
      isLayerShellChildProcess: false,
      desktopPinContentMinBounds: new Map(),
      clampDesktopPinBoundsWithWorkArea: clampDesktopPinBounds,
      getDesktopPinBaseBounds,
      getDesktopPinWindowBoundsInWorkArea: getDesktopPinWindowBounds,
      isPlainObject: (value) => !!value && typeof value === 'object' && !Array.isArray(value),
      normalizeEntityId: (id) => String(id || '').trim(),
      DEFAULT_WINDOW_SIZE: { width: 500, height: 600 },
      getMainWindowMinimumSizeForConfig: () => ({ width: 320, height: 360 }),
      applyDesktopPinWindowShape: jest.fn(),
      placeLayerWindow: jest.fn(),
      log: { warn: jest.fn() },
    };
    vm.runInNewContext(
      [
        sliceMain(
          'function getDesktopPinCascadeOrigin',
          'async function syncDesktopPinContentMinBounds'
        ),
        sliceMain('function getDesktopPinBounds(', 'function applyDesktopPinDesktopBehavior'),
        sliceMain('function normalizeDesktopPinsConfig(', 'function normalizeWindowGeometryConfig'),
      ].join('\n'),
      context
    );
    return { context, electronScreen };
  }

  it('keeps its saved position when the config is normalized, but is drawn on a connected screen', () => {
    const { context } = loadPins();
    const config = {
      desktopPins: { 'light.desk': { x: 3000, y: 200, width: 168, height: 148 } },
    };

    context.normalizeDesktopPinsConfig(config);

    // Saved as it was: the monitor may only be late to enumerate, or unplugged for a trip.
    expect(config.desktopPins['light.desk']).toEqual({ x: 3000, y: 200, width: 168, height: 148 });
    // The window itself is held to the screen that is there.
    expect(
      context.getDesktopPinWindowBounds('light.desk', config.desktopPins['light.desk'])
    ).toMatchObject({ x: 1752, y: 200 });
  });

  it('puts the pin back on that monitor once it is connected again', () => {
    const { context, electronScreen } = loadPins();
    const saved = { x: 3000, y: 200, width: 168, height: 148 };
    context.config.desktopPins['light.desk'] = context.getDesktopPinBounds('light.desk', saved);
    expect(context.config.desktopPins['light.desk']).toEqual(saved);

    electronScreen.setDisplays([PRIMARY, SECONDARY]);
    expect(
      context.getDesktopPinWindowBounds('light.desk', context.config.desktopPins['light.desk'])
    ).toMatchObject({ x: 3000, y: 200 });
  });

  it('still clamps the size, and fills in a position that is missing', () => {
    const { context } = loadPins();
    const config = {
      desktopPins: {
        'light.big': { x: 5000, y: 100, width: 9000, height: 9000 },
        'light.new': { width: 168, height: 148 },
      },
    };

    context.normalizeDesktopPinsConfig(config);

    expect(config.desktopPins['light.big']).toMatchObject({
      x: 5000,
      y: 100,
      width: PRIMARY.width,
      height: PRIMARY.height,
    });
    expect(Number.isFinite(config.desktopPins['light.new'].x)).toBe(true);
    expect(boundsVisibleOnAnyWorkArea(config.desktopPins['light.new'], [PRIMARY])).toBe(true);
  });

  it('leaves a pin on a connected monitor clamped to it as before', () => {
    const { context } = loadPins({ displays: [PRIMARY, SECONDARY] });
    const config = {
      desktopPins: { 'light.edge': { x: 1850, y: 100, width: 168, height: 148 } },
    };

    context.normalizeDesktopPinsConfig(config);

    // Mostly on the primary monitor, so held inside it.
    expect(config.desktopPins['light.edge'].x).toBe(PRIMARY.width - 168);
  });

  it('clamps a position the user just set by dragging a pin off the screen', () => {
    const { context } = loadPins();
    const dragged = context.getDesktopPinBounds(
      'light.desk',
      { x: 3000, y: 200, width: 168, height: 148 },
      { clampPosition: true }
    );
    expect(dragged.x).toBe(PRIMARY.width - 168);
  });
});

describe('the widget after the monitors change', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  function loadDisplays({
    bounds = { x: 2100, y: 100, width: 500, height: 600 },
    ...overrides
  } = {}) {
    const electronScreen = createScreen([PRIMARY]);
    const mainWindow = Object.assign(new EventEmitter(), {
      bounds: { ...bounds },
      isDestroyed: () => false,
      isMaximized: () => false,
      isFullScreen: () => false,
      getBounds() {
        return { ...this.bounds };
      },
      setPosition: jest.fn(function (x, y) {
        this.bounds = { ...this.bounds, x, y };
      }),
      setBounds: jest.fn(function (bounds) {
        this.bounds = { ...bounds };
      }),
    });
    const pinWindow = { isDestroyed: () => false };
    const context = {
      electronScreen,
      process: { platform: 'linux' },
      clampPositionToWorkAreas,
      mainWindow,
      usesCompositorOwnedPlacement: false,
      isQuitting: false,
      config: {
        windowPosition: { x: bounds.x, y: bounds.y },
        windowSize: { width: bounds.width, height: bounds.height },
        desktopPins: { 'light.desk': { x: 3000, y: 200, width: 168, height: 148 } },
      },
      desktopPinWindows: new Map([['light.desk', pinWindow]]),
      applyDesktopPinBoundsToWindowIfMoved: jest.fn(),
      refreshTrayIconForDisplayScale: jest.fn(),
      refreshTrayMenu: jest.fn(),
      pushConfigToRenderer: jest.fn(),
      resolveWindowDisplayPosition,
      findPreferredWindowDisplay,
      getMainWindowMinimumSizeForConfig: () => ({ width: 320, height: 360 }),
      runBackgroundConfigMutation: jest.fn((mutation) => mutation()),
      saveConfig: jest.fn(),
      setTimeout,
      clearTimeout,
      log: { info: jest.fn(), warn: jest.fn() },
      ...overrides,
    };
    vm.runInNewContext(
      sliceMain(
        'const DISPLAY_CHANGE_RECOVERY_DELAY_MS',
        "/**\n * The main window's minimum size"
      ) + sliceMain('function moveMainWindowToPosition(', 'function getWindowDisplaySettings('),
      context
    );
    return { context, electronScreen, mainWindow, pinWindow };
  }

  it('moves a widget that was on the unplugged monitor to the one that is left, and saves that', () => {
    const { context, mainWindow } = loadDisplays();

    context.recoverWindowsAfterDisplayChange();

    expect(mainWindow.setPosition).toHaveBeenCalledWith(1420, 100);
    // A programmatic move is not always reported as one, so it is saved directly.
    expect(context.config.windowPosition).toEqual({ x: 1420, y: 100 });
    expect(context.saveConfig).toHaveBeenCalledTimes(1);
  });

  it('leaves a widget that is already on a connected monitor where the user put it', () => {
    const { context, mainWindow } = loadDisplays({
      bounds: { x: 1800, y: 100, width: 500, height: 600 },
    });

    context.recoverWindowsAfterDisplayChange();

    // Hanging slightly off the edge is the user's choice.
    expect(mainWindow.setPosition).not.toHaveBeenCalled();
    expect(context.saveConfig).not.toHaveBeenCalled();
  });

  it('returns to the selected monitor when it reconnects, retaining its saved offset', () => {
    const { context, electronScreen, mainWindow } = loadDisplays();
    const preference = { id: '2', label: 'Desk', offset: { x: 180, y: 120 } };
    context.config.windowDisplay = preference;
    context.recoverWindowsAfterDisplayChange();
    expect(mainWindow.setPosition).toHaveBeenLastCalledWith(180, 120);
    expect(context.config.windowDisplay).toEqual(preference);
    electronScreen.setDisplays([PRIMARY, SECONDARY]);
    context.recoverWindowsAfterDisplayChange();
    expect(mainWindow.setPosition).toHaveBeenLastCalledWith(2100, 120);
    expect(context.config.windowDisplay).toEqual(preference);
  });

  it.each([
    ['unchanged position', { x: 0, y: 0, width: 1920, height: 1040 }],
    ['smaller fallback display', { x: 0, y: 0, width: 1024, height: 720 }],
  ])('recovers the saved Windows DIP size with an %s', (_case, workArea) => {
    const { context, electronScreen, mainWindow } = loadDisplays({
      bounds: { x: 100, y: 100, width: 750, height: 900 },
      process: { platform: 'win32' },
    });
    electronScreen.setDisplays([workArea]);
    context.config.windowSize = { width: 500, height: 600 };
    context.config.windowDisplay = { id: '2', offset: { x: 100, y: 100 } };
    mainWindow.setBounds.mockImplementation((bounds) => {
      mainWindow.bounds = { ...bounds };
    });

    context.recoverWindowsAfterDisplayChange();

    expect(mainWindow.getBounds()).toEqual({ x: 100, y: 100, width: 500, height: 600 });
    expect(context.config.windowDisplay).toEqual({ id: '2', offset: { x: 100, y: 100 } });
  });

  it('re-places the pins, so a returning monitor gets its pins back', () => {
    const { context, pinWindow } = loadDisplays({
      bounds: { x: 100, y: 100, width: 500, height: 600 },
    });

    context.recoverWindowsAfterDisplayChange();

    expect(context.applyDesktopPinBoundsToWindowIfMoved).toHaveBeenCalledWith(
      pinWindow,
      'light.desk',
      context.config.desktopPins['light.desk']
    );
  });

  it('does nothing where the compositor owns placement', () => {
    const { context, mainWindow } = loadDisplays({ usesCompositorOwnedPlacement: true });
    context.recoverWindowsAfterDisplayChange();
    expect(mainWindow.setPosition).not.toHaveBeenCalled();
    expect(context.applyDesktopPinBoundsToWindowIfMoved).not.toHaveBeenCalled();
  });

  it('waits for a burst of display events to settle, then recovers once', () => {
    const { context, electronScreen, mainWindow } = loadDisplays();
    context.watchDisplayChanges();

    electronScreen.emit('display-removed');
    electronScreen.emit('display-metrics-changed');
    electronScreen.emit('display-added');
    jest.advanceTimersByTime(499);
    expect(mainWindow.setPosition).not.toHaveBeenCalled();
    jest.advanceTimersByTime(1);
    expect(mainWindow.setPosition).toHaveBeenCalledTimes(1);
  });

  it('waits for Windows identities and ignores recovery superseded by another display event', async () => {
    const completions = [];
    const { context, electronScreen, mainWindow } = loadDisplays({
      process: { platform: 'win32' },
      invalidateDisplayIdentities: jest.fn(),
      refreshDisplayIdentities: jest.fn(() => new Promise((resolve) => completions.push(resolve))),
    });
    context.watchDisplayChanges();
    electronScreen.emit('display-removed');
    jest.advanceTimersByTime(500);
    expect(mainWindow.setPosition).not.toHaveBeenCalled();
    electronScreen.emit('display-added');
    completions[0]();
    await jest.advanceTimersByTimeAsync(0);
    expect(mainWindow.setPosition).not.toHaveBeenCalled();
    jest.advanceTimersByTime(500);
    completions[1]();
    await jest.advanceTimersByTimeAsync(0);
    expect(mainWindow.setPosition).toHaveBeenCalledTimes(1);
    expect(context.invalidateDisplayIdentities).toHaveBeenCalledTimes(2);
  });

  it.each([
    ...['win32', 'darwin'].flatMap((platform) =>
      ['move', 'resize', 'automatic'].map((kind) => ({ platform, kind }))
    ),
    { platform: 'win32', kind: 'move', disconnected: true },
    { platform: 'darwin', kind: 'move', missingIdentities: true },
    { platform: 'win32', kind: 'move', superseded: true },
    { platform: 'darwin', kind: 'resize', superseded: true },
    { platform: 'win32', kind: 'move', unsettled: true },
    { platform: 'win32', kind: 'move', laterChoice: true },
    { platform: 'win32', kind: 'move', laterChoice: true, duringChoice: 'resize' },
    { platform: 'darwin', kind: 'move', laterChoice: true, duringChoice: 'move' },
  ])(
    'preserves $kind intent while identity recovery waits ($platform, $disconnected, $missingIdentities, $superseded, $unsettled)',
    async ({
      platform,
      kind,
      disconnected = false,
      missingIdentities = false,
      superseded = false,
      unsettled = false,
      laterChoice = false,
      duringChoice,
    }) => {
      let identities = { 1: 'laptop', 2: 'desk' };
      const completions = [];
      const { context, electronScreen, mainWindow } = loadDisplays({
        process: { platform },
        windowStateSaveTimer: null,
        pendingWindowBounds: null,
        isLayerShellChildProcess: false,
        onWindowBoundsChanged,
        rememberWindowDisplayPosition,
        invalidateDisplayIdentities: () => {
          identities = {};
        },
        refreshDisplayIdentities: () =>
          new Promise((resolve) =>
            completions.push(() => {
              identities = missingIdentities ? {} : { 1: 'laptop', 2: 'desk' };
              resolve();
            })
          ),
      });
      const saved = [];
      const rememberSaved = () => saved.push(JSON.parse(JSON.stringify(context.config)));
      context.saveConfig.mockImplementation(rememberSaved);
      electronScreen.setDisplays(disconnected ? [PRIMARY] : [PRIMARY, SECONDARY]);
      context.electronScreen = createDisplayIdentityScreen(electronScreen, () => identities);
      context.config.windowDisplay = { id: '2', persistentId: 'desk', offset: { x: 100, y: 100 } };
      vm.runInNewContext(
        sliceMain(
          'function mainWindowMatchesSavedBounds(',
          'const DISPLAY_CHANGE_RECOVERY_DELAY_MS'
        ),
        context
      );
      context.watchMainWindowBounds(mainWindow);
      context.watchDisplayChanges();
      electronScreen.emit('display-metrics-changed');
      jest.advanceTimersByTime(500);
      expect(completions).toHaveLength(1);
      // The OS relocation before user input must not become a monitor preference.
      mainWindow.bounds = { x: 80, y: 80, width: 500, height: 600 };
      mainWindow.emit('moved');
      const userBounds =
        kind === 'resize'
          ? { x: 50, y: 80, width: 530, height: 650 }
          : { x: 300, y: 180, width: 500, height: 600 };
      if (kind !== 'automatic') {
        mainWindow.emit(kind === 'move' ? 'will-move' : 'will-resize', {}, userBounds);
        mainWindow.bounds = { ...userBounds };
        if (!unsettled) mainWindow.emit(kind === 'move' ? 'moved' : 'resized');
      }
      jest.advanceTimersByTime(700);
      if (superseded) {
        electronScreen.emit('display-added');
        completions[0]();
        await jest.advanceTimersByTimeAsync(500);
        expect(completions).toHaveLength(2);
      }
      let expectedBounds = userBounds;
      let expectedId = disconnected || missingIdentities ? '2' : '1';
      if (laterChoice) {
        // A choice can finish its own inventory read before delayed recovery resumes.
        identities = { 1: 'laptop', 2: 'desk' };
        Object.assign(context, require('../../src/window-display.cjs'), {
          runSerializedConfigMutation: (fn) => Promise.resolve().then(fn),
          saveConfigDurably: async () => {
            rememberSaved();
            if (duringChoice) {
              const newer =
                duringChoice === 'move'
                  ? { x: 400, y: 200, width: 500, height: 600 }
                  : { x: 250, y: 180, width: 550, height: 600 };
              mainWindow.emit(duringChoice === 'move' ? 'will-move' : 'will-resize', {}, newer);
              mainWindow.bounds = newer;
            }
            return { success: true };
          },
        });
        vm.runInNewContext(
          sliceMain('function getWindowDisplaySettings(', '// Save the monitor choice'),
          context
        );
        await context.applyWindowDisplayChoice('2');
        expectedBounds =
          duringChoice === 'move'
            ? { x: 400, y: 200, width: 500, height: 600 }
            : { x: 2220, y: 180, width: duringChoice === 'resize' ? 550 : 500, height: 600 };
        expectedId = duringChoice === 'move' ? '1' : '2';
      }
      completions.at(-1)();
      await jest.advanceTimersByTimeAsync(0);
      if (kind === 'automatic') {
        expect(mainWindow.getBounds()).toEqual({ x: 2020, y: 100, width: 500, height: 600 });
        expect(context.config.windowDisplay.id).toBe('2');
      } else {
        expect(mainWindow.getBounds()).toEqual(expectedBounds);
        expect(context.config.windowPosition).toEqual({ x: expectedBounds.x, y: expectedBounds.y });
        expect(context.config.windowSize).toEqual({
          width: expectedBounds.width,
          height: expectedBounds.height,
        });
        expect(context.config.windowDisplay.id).toBe(expectedId);
        expect(saved.at(-1)).toMatchObject({
          windowPosition: context.config.windowPosition,
          windowSize: context.config.windowSize,
          windowDisplay: context.config.windowDisplay,
        });
      }
    }
  );

  it.each(['isMaximized', 'isFullScreen'])(
    'expires user intent when %s skips recovery',
    (state) => {
      const { context, electronScreen, mainWindow } = loadDisplays();
      electronScreen.setDisplays([PRIMARY, SECONDARY]);
      context.config.windowDisplay = { id: '2', offset: { x: 100, y: 100 } };
      Object.assign(context, {
        windowStateSaveTimer: null,
        pendingWindowBounds: null,
        rememberWindowDisplayPosition,
      });
      vm.runInNewContext(
        sliceMain('function clampToMinimumWindowSize(', '/** Save the main window'),
        context
      );
      mainWindow.__displayRecoveryUserBounds = { x: 300, y: 180, width: 500, height: 600 };
      mainWindow[state] = () => true;
      context.recoverWindowsAfterDisplayChange();
      mainWindow[state] = () => false;
      context.recoverWindowsAfterDisplayChange();
      expect(mainWindow.getBounds()).toEqual({ x: 2020, y: 100, width: 500, height: 600 });
    }
  );

  it('survives a failure while recovering', () => {
    const { context, electronScreen } = loadDisplays();
    context.mainWindow.getBounds = () => {
      throw new Error('Object has been destroyed');
    };
    context.watchDisplayChanges();

    electronScreen.emit('display-removed');
    expect(() => jest.advanceTimersByTime(500)).not.toThrow();
    expect(context.log.warn).toHaveBeenCalledWith(
      'Failed to recover windows after a display change:',
      'Object has been destroyed'
    );
  });
});

describe('Reset Position', () => {
  function loadDefaults({ windowSize, workArea = PRIMARY }) {
    const context = {
      electronScreen: createScreen([workArea]),
      clampPositionToWorkAreas,
      config: { windowSize },
      findPreferredWindowDisplay,
      getMainWindowMinimumSizeForConfig: () => ({ width: 320, height: 360 }),
    };
    vm.runInNewContext(
      sliceMain('function getPrimaryWorkArea()', 'function recoverWindowsAfterDisplayChange'),
      context
    );
    return context;
  }

  it('opens 100 px in from the primary monitor corner, wherever that corner is', () => {
    const context = loadDefaults({
      windowSize: { width: 500, height: 600 },
      workArea: { x: 0, y: 28, width: 1920, height: 1052 },
    });
    expect(context.getDefaultMainWindowBounds()).toEqual({
      x: 100,
      y: 128,
      width: 500,
      height: 600,
    });
  });

  it('keeps the size the user chose, so Reset Position only moves the widget', () => {
    const context = loadDefaults({ windowSize: { width: 700, height: 800 } });
    expect(context.getDefaultMainWindowBounds()).toMatchObject({ width: 700, height: 800 });
  });

  it('shrinks a window that no longer fits the screen, so it cannot be left unreachable', () => {
    const context = loadDefaults({
      windowSize: { width: 4000, height: 3000 },
      workArea: { x: 0, y: 0, width: 1366, height: 728 },
    });
    expect(context.getDefaultMainWindowBounds()).toEqual({
      x: 0,
      y: 0,
      width: 1366,
      height: 728,
    });
  });
});

describe.each(['win32', 'darwin'])('%s identity inventory', (platform) => {
  it('awaits a fresh inventory when startup discovery was invalidated', async () => {
    const pending = [];
    const context = {
      process: { platform },
      displayIdentityRevision: 0,
      displayIdentityRead: null,
      displayIdentities: {},
      nativeElectronScreen: { getAllDisplays: () => [{ id: 2 }] },
      loadPlatformDisplayIdentities: () => new Promise((resolve) => pending.push(resolve)),
      log: { warn: jest.fn() },
    };
    vm.runInNewContext(
      sliceMain('function invalidateDisplayIdentities()', 'const { onWindowBoundsChanged }'),
      context
    );
    let ready = false;
    const waiting = context.ensureDisplayIdentities().then(() => {
      ready = true;
    });
    expect(pending).toHaveLength(1);
    context.invalidateDisplayIdentities();
    pending[0]({ 2: 'stale-device' });
    await new Promise(setImmediate);
    expect(ready).toBe(false);
    expect(pending).toHaveLength(2);
    pending[1]({ 2: 'current-device' });
    await waiting;
    expect(context.displayIdentities).toEqual({ 2: 'current-device' });
  });

  it('does not publish an inventory invalidated by a later display event', async () => {
    const pending = [];
    const context = {
      process: { platform },
      displayIdentityRevision: 0,
      displayIdentityRead: null,
      displayIdentities: { old: 'old-device' },
      loadPlatformDisplayIdentities: () => new Promise((resolve) => pending.push(resolve)),
      log: { warn: jest.fn() },
    };
    vm.runInNewContext(
      sliceMain('function invalidateDisplayIdentities()', 'const { onWindowBoundsChanged }'),
      context
    );
    const first = context.refreshDisplayIdentities();
    context.invalidateDisplayIdentities();
    const second = context.refreshDisplayIdentities();
    expect(pending).toHaveLength(2);
    pending[1]({ current: 'current-device' });
    await second;
    pending[0]({ stale: 'stale-device' });
    await first;
    expect(context.displayIdentities).toEqual({ current: 'current-device' });
  });
});

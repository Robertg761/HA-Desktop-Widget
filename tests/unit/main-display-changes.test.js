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

const mainSource = fs.readFileSync(path.resolve(__dirname, '../../main.js'), 'utf8');

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
    getAllDisplays: () => areas.map((workArea) => ({ workArea })),
    getPrimaryDisplay: () => ({ workArea: areas[0] }),
    getDisplayMatching: (bounds) => ({ workArea: nearest(bounds) }),
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
    const mainWindow = {
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
      setBounds: jest.fn(),
    };
    const pinWindow = { isDestroyed: () => false };
    const context = {
      electronScreen,
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
      getMainWindowMinimumSizeForConfig: () => ({ width: 320, height: 360 }),
      runBackgroundConfigMutation: jest.fn((mutation) => mutation()),
      saveConfig: jest.fn(),
      setTimeout,
      clearTimeout,
      log: { info: jest.fn(), warn: jest.fn() },
      ...overrides,
    };
    vm.runInNewContext(
      sliceMain('const DISPLAY_CHANGE_RECOVERY_DELAY_MS', "/**\n * The main window's minimum size"),
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

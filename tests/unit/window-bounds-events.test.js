const { EventEmitter } = require('events');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const {
  emitsSettledBoundsEvents,
  onWindowBoundsChanged,
} = require('../../src/window-bounds-events.cjs');
const {
  getDesktopPinBaseBounds,
  clampDesktopPinBounds,
  getDesktopPinWindowBounds,
} = require('../../src/desktop-pin-bounds.js');

const mainSource = fs.readFileSync(path.resolve(__dirname, '../../main.js'), 'utf8');

function sliceMain(startMarker, endMarker) {
  const start = mainSource.indexOf(startMarker);
  const end = mainSource.indexOf(endMarker, start);
  expect(start).toBeGreaterThan(-1);
  expect(end).toBeGreaterThan(start);
  return mainSource.slice(start, end);
}

/** A BrowserWindow stand-in that, like Electron on Linux, emits 'move'/'resize' for every change. */
class FakeWindow extends EventEmitter {
  constructor(bounds = { x: 0, y: 0, width: 500, height: 600 }) {
    super();
    this.bounds = { ...bounds };
    this.webContents = new EventEmitter();
    this.webContents.send = jest.fn();
  }

  getBounds() {
    return { ...this.bounds };
  }

  setBounds(next) {
    const moved = next.x !== this.bounds.x || next.y !== this.bounds.y;
    const resized = next.width !== this.bounds.width || next.height !== this.bounds.height;
    this.bounds = { ...this.bounds, ...next };
    if (moved) this.emit('move');
    if (resized) this.emit('resize');
  }

  setPosition(x, y) {
    this.setBounds({ x, y });
  }

  setSize(width, height) {
    this.setBounds({ width, height });
  }

  isDestroyed() {
    return false;
  }
}

function baseContext(platform) {
  const context = {
    process: { platform },
    usesCompositorOwnedPlacement: false,
    isLayerShellChildProcess: false,
    onWindowBoundsChanged,
    setTimeout,
    clearTimeout,
    saveConfig: jest.fn(),
    runBackgroundConfigMutation: jest.fn((mutation) => mutation()),
    log: { warn: jest.fn() },
  };
  return context;
}

function loadMainWindowRuntime(platform, overrides = {}) {
  const context = {
    ...baseContext(platform),
    config: { windowPosition: { x: 100, y: 100 }, windowSize: { width: 500, height: 600 } },
    windowStateSaveTimer: null,
    pendingWindowBounds: null,
    ...overrides,
  };
  vm.runInNewContext(
    `var windowStateSaveTimer = null; var pendingWindowBounds = null;\n${sliceMain(
      'function mainWindowMatchesSavedBounds',
      'function createWindow()'
    )}`,
    context
  );
  const mainWindow = new FakeWindow({ x: 100, y: 100, width: 500, height: 600 });
  context.watchMainWindowBounds(mainWindow);
  return { context, mainWindow };
}

describe('window bounds events', () => {
  it.each([
    ['linux', ['move', 'resize']],
    ['darwin', ['moved', 'resized']],
    ['win32', ['moved', 'resized']],
  ])('listens to the events Electron emits on %s', (platform, events) => {
    const target = new FakeWindow();
    expect(
      onWindowBoundsChanged(target, { platform, onMove: jest.fn(), onResize: jest.fn() })
    ).toEqual(events);
    expect(target.eventNames()).toEqual(events);
    expect(emitsSettledBoundsEvents(platform)).toBe(platform !== 'linux');
  });
});

describe('main window bounds on Linux', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it('saves a user move and resize once the 400 ms debounce settles', () => {
    const { context, mainWindow } = loadMainWindowRuntime('linux');
    mainWindow.setPosition(300, 200);
    mainWindow.setPosition(320, 210);
    mainWindow.setSize(520, 640);
    jest.advanceTimersByTime(399);
    expect(context.saveConfig).not.toHaveBeenCalled();
    jest.advanceTimersByTime(1);
    expect(context.saveConfig).toHaveBeenCalledTimes(1);
    expect(context.config.windowPosition).toEqual({ x: 320, y: 210 });
    expect(context.config.windowSize).toEqual({ width: 520, height: 640 });
  });

  it('does not save programmatic moves back to the saved bounds', () => {
    const { context, mainWindow } = loadMainWindowRuntime('linux');
    // The compositor drops the window elsewhere on show; the popup presenter restores it.
    mainWindow.setPosition(0, 0);
    mainWindow.setPosition(100, 100);
    // "Show" restores the saved size.
    mainWindow.setSize(500, 600);
    jest.advanceTimersByTime(1000);
    expect(context.saveConfig).not.toHaveBeenCalled();
    expect(context.pendingWindowBounds).toBeNull();
  });

  it('keeps positions unsaved where the compositor owns placement', () => {
    const { context, mainWindow } = loadMainWindowRuntime('linux', {
      usesCompositorOwnedPlacement: true,
    });
    mainWindow.setBounds({ x: 40, y: 40, width: 560, height: 600 });
    jest.advanceTimersByTime(400);
    expect(context.config.windowPosition).toEqual({ x: 100, y: 100 });
    expect(context.config.windowSize).toEqual({ width: 560, height: 600 });
  });

  it('leaves layer-shell placement to the layer drag path', () => {
    const { mainWindow } = loadMainWindowRuntime('linux', { isLayerShellChildProcess: true });
    expect(mainWindow.eventNames()).toEqual([]);
  });

  it.each(['darwin', 'win32'])('still saves only on moved/resized on %s', (platform) => {
    const { context, mainWindow } = loadMainWindowRuntime(platform);
    mainWindow.setPosition(300, 200);
    jest.advanceTimersByTime(400);
    expect(context.saveConfig).not.toHaveBeenCalled();
    mainWindow.emit('moved');
    jest.advanceTimersByTime(400);
    expect(context.config.windowPosition).toEqual({ x: 300, y: 200 });
  });
});

describe('desktop pin bounds on Linux', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  function loadPinRuntime({ platform = 'linux', scale = 1, editMode = true, ...overrides } = {}) {
    const workArea = { x: 0, y: 0, width: 1280, height: 720 };
    const windows = [];
    const context = {
      ...baseContext(platform),
      config: {
        ui: { scale },
        desktopPins: { 'light.office': { x: 200, y: 120, width: 168, height: 148 } },
      },
      desktopPinEditMode: editMode,
      isQuitting: false,
      electronScreen: {
        getPrimaryDisplay: () => ({ workArea }),
        getDisplayMatching: () => ({ workArea }),
      },
      desktopPinContentMinBounds: new Map(),
      desktopPinWindows: new Map(),
      latestEntityStates: new Map(),
      clampDesktopPinBoundsWithWorkArea: clampDesktopPinBounds,
      getDesktopPinBaseBounds,
      getDesktopPinWindowBoundsInWorkArea: getDesktopPinWindowBounds,
      normalizeEntityId: (id) => String(id || '').trim(),
      BrowserWindow: function (options) {
        const window = new FakeWindow({
          x: options.x,
          y: options.y,
          width: options.width,
          height: options.height,
        });
        Object.assign(window, {
          setMenuBarVisibility: jest.fn(),
          loadFile: jest.fn(),
          setShape: jest.fn(),
        });
        windows.push(window);
        return window;
      },
      getAppIconPath: () => 'icon.png',
      getWindowTransparencyOptions: () => ({ transparent: true, backgroundColor: '#00000000' }),
      hardenRendererNavigation: jest.fn(),
      placeLayerWindow: jest.fn(),
      applyWindowOpacity: jest.fn(),
      applyDesktopPinWindowShape: jest.fn(),
      applyDesktopPinWindowEffects: jest.fn(),
      wireWindowEffectsRefresh: jest.fn(),
      applyDesktopPinEditModeToWindow: jest.fn(),
      applyDesktopPinDesktopBehavior: jest.fn(),
      focusDesktopPinWindow: jest.fn(),
      sendDesktopPinUpdate: jest.fn(),
      pushConfigToRenderer: jest.fn(),
      getDesktopPinWindowTitle: (id) => `HA Pin: ${id}`,
      PRELOAD_SCRIPT_PATH: 'preload.js',
      __dirname: '/app',
      ...overrides,
    };
    vm.runInNewContext(
      [
        sliceMain(
          'function getDesktopPinCascadeOrigin',
          'async function syncDesktopPinContentMinBounds'
        ),
        sliceMain('function getDesktopPinBounds(', 'function applyDesktopPinDesktopBehavior'),
        sliceMain('function createDesktopPinWindow(', 'function syncDesktopPinWindowsWithConfig'),
        sliceMain(
          'function syncDesktopPinWindowsWithConfig',
          'function applyMainWindowSettingSideEffects'
        ),
      ].join('\n'),
      context
    );
    context.createDesktopPinWindow('light.office');
    return { context, pinWindow: windows[0] };
  }

  it('saves a moved pin after the 180 ms debounce, keeping its 100% size at 150%', () => {
    const { context, pinWindow } = loadPinRuntime({ scale: 1.5 });
    expect(pinWindow.getBounds()).toEqual({ x: 200, y: 120, width: 252, height: 222 });
    pinWindow.setPosition(400, 300);
    jest.advanceTimersByTime(179);
    expect(context.saveConfig).not.toHaveBeenCalled();
    jest.advanceTimersByTime(1);
    expect(context.saveConfig).toHaveBeenCalledTimes(1);
    expect(context.config.desktopPins['light.office']).toEqual({
      x: 400,
      y: 300,
      width: 168,
      height: 148,
    });
  });

  it('does not save moves the app makes to a pin', () => {
    const { context, pinWindow } = loadPinRuntime();
    const saved = { ...context.config.desktopPins['light.office'] };

    // A scale change resizes the pin, and near the edge moves it to stay on screen.
    context.config.desktopPins['light.office'] = { x: 1100, y: 560, width: 168, height: 148 };
    context.config.ui.scale = 1.5;
    context.syncDesktopPinWindowsWithConfig();
    expect(pinWindow.getBounds()).toEqual({ x: 1028, y: 498, width: 252, height: 222 });
    // The window system echoes the applied bounds after the applying flag is cleared.
    pinWindow.emit('move');
    jest.advanceTimersByTime(1000);
    expect(context.saveConfig).not.toHaveBeenCalled();
    expect(context.config.desktopPins['light.office']).toEqual({
      x: 1100,
      y: 560,
      width: 168,
      height: 148,
    });
    expect(saved).toEqual({ x: 200, y: 120, width: 168, height: 148 });
  });

  it('ignores moves outside edit mode and where the compositor owns placement', () => {
    for (const overrides of [{ editMode: false }, { usesCompositorOwnedPlacement: true }]) {
      const { context, pinWindow } = loadPinRuntime(overrides);
      pinWindow.setPosition(400, 300);
      jest.advanceTimersByTime(1000);
      expect(context.saveConfig).not.toHaveBeenCalled();
    }
  });

  it.each(['darwin', 'win32'])('still saves pin moves only on moved on %s', (platform) => {
    const { context, pinWindow } = loadPinRuntime({ platform });
    pinWindow.setPosition(400, 300);
    jest.advanceTimersByTime(1000);
    expect(context.saveConfig).not.toHaveBeenCalled();
    pinWindow.emit('moved');
    jest.advanceTimersByTime(180);
    expect(context.config.desktopPins['light.office']).toMatchObject({ x: 400, y: 300 });
  });
});

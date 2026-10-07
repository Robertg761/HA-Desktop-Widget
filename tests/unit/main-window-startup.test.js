/**
 * @jest-environment node
 */

const { EventEmitter } = require('events');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { createMainWindowReveal } = require('../../src/main-window-reveal.cjs');

const mainSource = fs.readFileSync(path.resolve(__dirname, '../../main.js'), 'utf8');

function sliceMain(startMarker, endMarker) {
  const start = mainSource.indexOf(startMarker);
  const end = mainSource.indexOf(endMarker, start);
  expect(start).toBeGreaterThan(-1);
  expect(end).toBeGreaterThan(start);
  return mainSource.slice(start, end);
}

/** A BrowserWindow stand-in that records what the app asks of it. */
class FakeWindow extends EventEmitter {
  constructor(options) {
    super();
    this.options = options;
    this.visible = options.show !== false;
    this.destroyed = false;
    this.maximized = false;
    this.webContents = new EventEmitter();
    this.webContents.send = jest.fn();
    this.webContents.openDevTools = jest.fn();
    this.loadFile = jest.fn();
    this.show = jest.fn(() => {
      this.visible = true;
    });
    this.showInactive = jest.fn(() => {
      this.visible = true;
    });
    this.hide = jest.fn(() => {
      this.visible = false;
    });
    this.minimize = jest.fn();
    this.unmaximize = jest.fn(() => {
      this.maximized = false;
    });
    this.setSkipTaskbar = jest.fn();
  }

  isVisible() {
    return this.visible;
  }

  isDestroyed() {
    return this.destroyed;
  }

  isMaximized() {
    return this.maximized;
  }

  isFullScreen() {
    return false;
  }

  getBounds() {
    return { x: 100, y: 100, width: 500, height: 600 };
  }
}

// Each createWindow() arms the real 3 s fallback timer; stop them so the run can exit.
const pendingReveals = [];
afterEach(() => pendingReveals.splice(0).forEach((reveal) => reveal.cancel()));

function loadCreateWindow({
  layerMode = false,
  launchAction = 'show',
  platform = 'linux',
  wasOpenedAtLogin = false,
} = {}) {
  const windows = [];
  const created = [];
  const context = {
    process: { platform, env: {}, argv: [] },
    app: {
      getLoginItemSettings: () => ({ wasOpenedAtLogin }),
    },
    BrowserWindow: function (options) {
      const window = new FakeWindow(options);
      windows.push(window);
      context.mainWindow = window;
      return window;
    },
    mainWindow: null,
    createMainWindowReveal: (options) => {
      const reveal = createMainWindowReveal(options);
      jest.spyOn(reveal, 'hold');
      created.push(reveal);
      pendingReveals.push(reveal);
      return reveal;
    },
    config: {
      alwaysOnTop: true,
      opacity: 0.95,
      frostedGlass: true,
      hideOnBlur: false,
      windowPosition: { x: 100, y: 100 },
      windowSize: { width: 500, height: 600 },
    },
    log: { info: jest.fn(), warn: jest.fn() },
    isLayerShellChildProcess: layerMode,
    initialLaunchAction: launchAction,
    initialLaunchRaise: false,
    usesCompositorOwnedPlacement: false,
    minimizedWithoutTrayHost: false,
    appliedHideOnBlur: false,
    isQuitting: false,
    IS_DEV_MODE: false,
    IS_SMOKE_TEST_MODE: false,
    NATIVE_GLASS_SUPPORTED: true,
    MAIN_WINDOW_TITLE: 'HA Desktop Widget',
    PRELOAD_SCRIPT_PATH: 'preload.js',
    __dirname: '/app',
    electronScreen: {
      getPrimaryDisplay: () => ({ workAreaSize: { width: 1920, height: 1080 } }),
      getAllDisplays: () => [{ workArea: { x: 0, y: 0, width: 1920, height: 1080 } }],
    },
    clampPositionToWorkAreas: (bounds) => ({ x: bounds.x, y: bounds.y }),
    getAppIconPath: () => 'icon.png',
    getWindowTransparencyOptions: () => ({ transparent: true, backgroundColor: '#00000000' }),
    getMainWindowVisualOptions: () => ({ transparent: true, backgroundColor: '#00000000' }),
    getMainWindowMinimumSizeForConfig: () => ({ width: 320, height: 360 }),
    hardenRendererNavigation: jest.fn(),
    forwardRendererConsole: jest.fn(),
    attachEditHandlers: jest.fn(),
    Menu: {},
    windowAutoHide: {
      watchDevTools: jest.fn(),
      prepareToShow: jest.fn(),
      handleHidden: jest.fn(),
      handleBlur: jest.fn(),
      handleFocus: jest.fn(),
      handleClosed: jest.fn(),
      suspend: jest.fn(),
    },
    popupWindowPresenter: {
      syncWorkspaceVisibility: jest.fn(),
      handleWindowHidden: jest.fn(),
      handleWindowBlur: jest.fn(),
      isElevated: () => false,
    },
    keepOutOfTaskbarWhenShown: jest.fn(),
    applyWindowOpacity: jest.fn(() => 0.95),
    applyFrostedGlass: jest.fn(),
    wireWindowEffectsRefresh: jest.fn(),
    getPreviewFrostedGlassOverride: jest.fn(),
    invalidateHaConnectionState: jest.fn(),
    requestTrayEntityIconRefresh: jest.fn(),
    emitProfileSyncStatus: jest.fn(),
    refreshLayerPlacement: jest.fn(),
    pushConfigToRenderer: jest.fn(),
    raiseLayerWidgetOnceMapped: jest.fn(),
    watchMainWindowBounds: jest.fn(),
    endDesktopPinEditModeFromMainProcess: jest.fn(),
    notifyDesktopCompanionStateChanged: jest.fn(),
    requestOpportunisticProfileSync: jest.fn(),
    layerPointerRelease: { start: jest.fn(() => false), stop: jest.fn() },
    isHyprland: () => false,
    layerActualMonitor: null,
    readHyprlandMonitors: () => [],
    layerOutputWasRemoved: false,
    layerBlurReleasedAt: null,
    mainT: (key) => key,
    finishSmokeTest: jest.fn(),
    maybeFinishSmokeTest: jest.fn(),
    smokeTestRendererLoaded: false,
  };
  vm.createContext(context);
  // The reveal and its login check as main.js defines them, then the real createWindow.
  vm.runInContext(
    sliceMain(
      'const mainWindowReveal = createMainWindowReveal({',
      '// Where the main widget is on screen'
    ) + sliceMain('function createWindow() {', '// Save the monitor choice'),
    context
  );
  const [reveal] = created;
  return { context, windows, reveal, holdSpy: reveal.hold };
}

describe('main window creation', () => {
  it.each([
    [
      'scaled',
      [
        { id: 1, x: 0, width: 1280 },
        { id: 2, x: 1280, width: 853 },
      ],
      1380,
    ],
    [
      'rearranged',
      [
        { id: 1, x: 1280, width: 1920 },
        { id: 2, x: 0, width: 1280 },
      ],
      100,
    ],
    ['disconnected', [{ id: 1, x: 0, width: 1920 }], 100],
  ])(
    'restores the preferred display after it was %s while the app was closed',
    (_case, layout, x) => {
      const { context, windows } = loadCreateWindow();
      const displays = layout.map((display) => ({
        id: display.id,
        workArea: { x: display.x, y: 0, width: display.width, height: 533 },
        workAreaSize: { width: display.width, height: 533 },
      }));
      context.electronScreen.getAllDisplays = () => displays;
      context.electronScreen.getPrimaryDisplay = () => displays[0];
      context.resolveWindowDisplayPosition =
        require('../../src/window-display.cjs').resolveWindowDisplayPosition;
      context.clampPositionToWorkAreas =
        require('../../src/window-placement.cjs').clampPositionToWorkAreas;
      context.config.windowPosition = { x: 2020, y: 100 };
      context.config.windowSize = { width: 400, height: 400 };
      context.config.windowDisplay = { id: '2', offset: { x: 100, y: 100 } };

      context.createWindow();

      expect(windows[0].options).toMatchObject({ x, y: 100 });
      expect(context.config.windowPosition).toEqual({ x, y: 100 });
      expect(context.config.windowDisplay).toEqual({ id: '2', offset: { x: 100, y: 100 } });
    }
  );

  it.each([false, true])(
    'restores the intended Windows startup size with an explicit display: %s',
    (selected) => {
      const { context } = loadCreateWindow({ platform: 'win32' });
      context.config.windowPosition = { x: 2020, y: 100 };
      context.config.windowDisplay = selected ? { id: '2', offset: { x: 100, y: 100 } } : null;
      context.resolveWindowDisplayPosition = () => ({ x: 2020, y: 100 });
      let bounds;
      context.BrowserWindow = function (options) {
        const window = new FakeWindow(options);
        // Native construction performs several position updates on fractional DPI.
        bounds = { x: options.x, y: options.y, width: options.width + 4, height: options.height };
        window.getBounds = () => ({ ...bounds });
        window.setPosition = (x, y) => {
          bounds = { ...bounds, x, y };
        };
        window.setBounds = (next) => {
          bounds = { ...next, width: next.width + 1 };
        };
        return window;
      };

      context.createWindow();

      expect(bounds).toEqual({ x: 2020, y: 100, width: 501, height: 600 });
      expect(context.config.windowSize).toEqual({ width: 500, height: 600 });
    }
  );

  it('opens hidden and waits for the first real frame', () => {
    const { context, windows, holdSpy } = loadCreateWindow();
    context.createWindow();

    expect(windows).toHaveLength(1);
    expect(windows[0].options.show).toBe(false);
    expect(windows[0].isVisible()).toBe(false);
    expect(holdSpy).toHaveBeenCalledTimes(1);
  });

  it('cannot be maximized or made full screen by a header double-click or a snap', () => {
    const { context, windows } = loadCreateWindow();
    context.createWindow();

    expect(windows[0].options.maximizable).toBe(false);
    expect(windows[0].options.fullscreenable).toBe(false);
    expect(windows[0].options.resizable).toBe(true);
  });

  it('undoes a maximize a window manager shortcut still manages to ask for', () => {
    const { context, windows } = loadCreateWindow();
    context.createWindow();

    windows[0].maximized = true;
    windows[0].emit('maximize');
    expect(windows[0].unmaximize).toHaveBeenCalledTimes(1);
  });

  it('never shows a launch that was asked to stay hidden', () => {
    const { context, windows, holdSpy } = loadCreateWindow({ launchAction: 'hide' });
    context.createWindow();

    expect(windows[0].options.show).toBe(false);
    expect(holdSpy).not.toHaveBeenCalled();
    windows[0].webContents.emit('did-finish-load');
    expect(windows[0].show).not.toHaveBeenCalled();
    expect(windows[0].showInactive).not.toHaveBeenCalled();
  });

  it('keeps the immediate show for a desktop-layer surface, which its helper maps itself', () => {
    const { context, windows, holdSpy } = loadCreateWindow({ layerMode: true });
    context.createWindow();

    expect(windows[0].options.show).toBe(true);
    expect(holdSpy).not.toHaveBeenCalled();
  });

  it('clears a waiting reveal when the window goes away', () => {
    const { context, windows, reveal } = loadCreateWindow();
    context.createWindow();
    expect(reveal.isPending()).toBe(true);

    windows[0].emit('closed');
    expect(reveal.isPending()).toBe(false);
    expect(context.mainWindow).toBeNull();
  });
});

describe('showing the main window once it is ready', () => {
  function revealWith(options) {
    const runtime = loadCreateWindow(options);
    runtime.context.createWindow();
    return runtime;
  }

  it('shows it, with focus, when the page reports in', () => {
    const { windows, reveal } = revealWith();
    reveal.release();

    expect(windows[0].show).toHaveBeenCalledTimes(1);
    expect(windows[0].showInactive).not.toHaveBeenCalled();
  });

  it('shows it without taking focus when macOS started the app at login', () => {
    const { windows, reveal } = revealWith({ platform: 'darwin', wasOpenedAtLogin: true });
    reveal.release();

    expect(windows[0].showInactive).toHaveBeenCalledTimes(1);
    expect(windows[0].show).not.toHaveBeenCalled();
  });

  it('leaves a window alone that the user already brought up from the tray', () => {
    const { windows, reveal } = revealWith();
    windows[0].visible = true;
    reveal.release();

    expect(windows[0].show).not.toHaveBeenCalled();
    expect(windows[0].showInactive).not.toHaveBeenCalled();
  });

  it('is released by the renderer-ready signal', () => {
    const source = sliceMain("ipcMain.handle('renderer-ready'", "ipcMain.handle('get-config'");
    const mainWindowReveal = { release: jest.fn() };
    const handlers = {};
    vm.runInNewContext(source, {
      ipcMain: { handle: (name, handler) => (handlers[name] = handler) },
      authorizeIpcSender: () => ({ type: 'main' }),
      rejectUnauthorizedIpc: () => ({ success: false }),
      IS_SMOKE_TEST_MODE: false,
      mainWindowReveal,
    });

    expect(handlers['renderer-ready']({})).toEqual({ success: true });
    expect(mainWindowReveal.release).toHaveBeenCalledTimes(1);
  });

  it('does not release it for a sender that is not the app', () => {
    const source = sliceMain("ipcMain.handle('renderer-ready'", "ipcMain.handle('get-config'");
    const mainWindowReveal = { release: jest.fn() };
    const handlers = {};
    vm.runInNewContext(source, {
      ipcMain: { handle: (name, handler) => (handlers[name] = handler) },
      authorizeIpcSender: () => null,
      rejectUnauthorizedIpc: () => ({ success: false }),
      IS_SMOKE_TEST_MODE: false,
      mainWindowReveal,
    });

    expect(handlers['renderer-ready']({})).toEqual({ success: false });
    expect(mainWindowReveal.release).not.toHaveBeenCalled();
  });
});

describe('hiding the main window before it was ever shown', () => {
  it('a second --hide launch cancels the pending reveal', () => {
    const cancel = jest.fn();
    const context = {
      mainWindow: { isDestroyed: () => false },
      mainWindowReveal: { cancel },
      popupWindowPresenter: { hidePopup: jest.fn(() => true) },
    };
    vm.runInNewContext(
      sliceMain('function hideMainWindowToTray()', '/**\n * Push the user'),
      context
    );

    expect(context.hideMainWindowToTray()).toBe(true);
    expect(cancel).toHaveBeenCalledTimes(1);
    expect(context.popupWindowPresenter.hidePopup).toHaveBeenCalledWith(context.mainWindow);
  });

  it('restarting while the first frame is pending keeps the widget visible afterwards', () => {
    const source = sliceMain('async function restartApplication()', 'ipcMain.handle(');
    const env = {};
    const context = {
      process: { env },
      mainWindow: { isVisible: () => false },
      mainWindowReveal: { isPending: () => true },
      log: { info: jest.fn() },
      flushConfigForBoundedExit: jest.fn(() => Promise.reject(new Error('stop here'))),
    };
    vm.runInNewContext(source, context);

    return context.restartApplication().catch(() => {
      expect(env.HA_WIDGET_LAUNCH_VISIBILITY).toBe('show');
    });
  });
});

describe('opening the app again on macOS', () => {
  function loadActivate({ mainWindow, pending = false }) {
    const handlers = {};
    const context = {
      app: { on: (name, handler) => (handlers[name] = handler) },
      mainWindow,
      mainWindowReveal: { isPending: () => pending },
      createWindow: jest.fn(),
      showMainWindowFromTray: jest.fn(),
      syncDesktopPinWindowsWithConfig: jest.fn(),
      syncTrayEntitiesWithConfig: jest.fn(),
    };
    vm.runInNewContext(sliceMain("app.on('activate'", '\n});') + '\n});', context);
    return { handler: handlers.activate, context };
  }

  it('brings back a widget that was hidden to the tray', () => {
    const { handler, context } = loadActivate({
      mainWindow: { isDestroyed: () => false, isVisible: () => false },
    });
    handler();

    expect(context.showMainWindowFromTray).toHaveBeenCalledTimes(1);
    expect(context.createWindow).not.toHaveBeenCalled();
    expect(context.syncDesktopPinWindowsWithConfig).toHaveBeenCalled();
    expect(context.syncTrayEntitiesWithConfig).toHaveBeenCalled();
  });

  it('leaves a visible widget alone', () => {
    const { handler, context } = loadActivate({
      mainWindow: { isDestroyed: () => false, isVisible: () => true },
    });
    handler();
    expect(context.showMainWindowFromTray).not.toHaveBeenCalled();
  });

  it('does not race the startup reveal', () => {
    const { handler, context } = loadActivate({
      mainWindow: { isDestroyed: () => false, isVisible: () => false },
      pending: true,
    });
    handler();
    expect(context.showMainWindowFromTray).not.toHaveBeenCalled();
  });

  it('creates the window again when there is none', () => {
    const { handler, context } = loadActivate({ mainWindow: null });
    handler();
    expect(context.createWindow).toHaveBeenCalledTimes(1);
    expect(context.showMainWindowFromTray).not.toHaveBeenCalled();
  });
});

describe('the title bar minimize button', () => {
  function loadMinimize({ platform = 'win32', usesCompositorOwnedPlacement = false, noTray } = {}) {
    const mainWindow = new FakeWindow({});
    const context = {
      process: { platform },
      mainWindow,
      usesCompositorOwnedPlacement,
      trayHostMissing: !!noTray,
      minimizedWithoutTrayHost: false,
      hideMainWindowToTray: jest.fn(),
    };
    vm.runInNewContext(
      sliceMain('function minimizeMainWindow()', "ipcMain.handle('minimize-window'"),
      context
    );
    return context;
  }

  it('minimizes where the window manager supports it', () => {
    const context = loadMinimize();
    context.minimizeMainWindow();
    expect(context.mainWindow.minimize).toHaveBeenCalledTimes(1);
    expect(context.hideMainWindowToTray).not.toHaveBeenCalled();
  });

  it('hides to the tray on native Wayland, which cannot minimize reliably', () => {
    const context = loadMinimize({ platform: 'linux', usesCompositorOwnedPlacement: true });
    context.minimizeMainWindow();
    expect(context.hideMainWindowToTray).toHaveBeenCalledTimes(1);
    expect(context.mainWindow.minimize).not.toHaveBeenCalled();
  });

  it('hides to the tray on macOS instead of leaving a Dock tile behind a hidden window', () => {
    const context = loadMinimize({ platform: 'darwin' });
    context.minimizeMainWindow();
    expect(context.hideMainWindowToTray).toHaveBeenCalledTimes(1);
    expect(context.mainWindow.minimize).not.toHaveBeenCalled();
  });

  it('minimizes into the switcher when no tray host exists to bring the widget back', () => {
    const context = loadMinimize({
      platform: 'linux',
      usesCompositorOwnedPlacement: true,
      noTray: true,
    });
    context.minimizeMainWindow();

    expect(context.hideMainWindowToTray).not.toHaveBeenCalled();
    expect(context.mainWindow.setSkipTaskbar).toHaveBeenCalledWith(false);
    expect(context.mainWindow.minimize).toHaveBeenCalledTimes(1);
    expect(context.minimizedWithoutTrayHost).toBe(true);
  });

  it('keeps the minimized window out of the tray hide and goes back to skipping the taskbar on restore', () => {
    const runtime = loadCreateWindow({ platform: 'linux' });
    runtime.context.createWindow();
    const [window] = runtime.windows;

    runtime.context.minimizedWithoutTrayHost = true;
    const event = { preventDefault: jest.fn() };
    window.emit('minimize', event);
    expect(event.preventDefault).not.toHaveBeenCalled();
    expect(window.hide).not.toHaveBeenCalled();

    window.emit('restore');
    expect(window.setSkipTaskbar).toHaveBeenCalledWith(true);
    expect(runtime.context.minimizedWithoutTrayHost).toBe(false);

    // Back to the normal behaviour: a minimize hides the widget to the tray.
    window.emit('minimize', event);
    expect(event.preventDefault).toHaveBeenCalledTimes(1);
    expect(window.hide).toHaveBeenCalledTimes(1);
  });
});

describe('keeping windows out of the taskbar on X11', () => {
  function loadKeep({ platform = 'linux', usesCompositorOwnedPlacement = false } = {}) {
    const context = {
      process: { platform },
      usesCompositorOwnedPlacement,
      mainWindow: null,
      minimizedWithoutTrayHost: false,
    };
    vm.runInNewContext(
      sliceMain('function keepOutOfTaskbarWhenShown', 'function focusMainWindow('),
      context
    );
    return context;
  }

  it('asks again each time a mapped window is shown, which is when window managers act on it', () => {
    const context = loadKeep();
    const window = new FakeWindow({});
    context.keepOutOfTaskbarWhenShown(window);

    window.emit('show');
    window.emit('show');
    expect(window.setSkipTaskbar).toHaveBeenCalledTimes(2);
    expect(window.setSkipTaskbar).toHaveBeenLastCalledWith(true);
  });

  it('leaves a widget that was minimized for lack of a tray in the switcher', () => {
    const context = loadKeep();
    const window = new FakeWindow({});
    context.mainWindow = window;
    context.keepOutOfTaskbarWhenShown(window);

    context.minimizedWithoutTrayHost = true;
    window.emit('show');
    expect(window.setSkipTaskbar).not.toHaveBeenCalled();
  });

  it.each([
    ['win32', false],
    ['darwin', false],
    ['linux', true],
  ])(
    'does nothing on %s (native Wayland: %s), where it is not needed or not possible',
    (platform, native) => {
      const context = loadKeep({ platform, usesCompositorOwnedPlacement: native });
      const window = new FakeWindow({});
      context.keepOutOfTaskbarWhenShown(window);
      window.emit('show');
      expect(window.setSkipTaskbar).not.toHaveBeenCalled();
    }
  );

  it('is wired to the main window and to every pin', () => {
    expect(mainSource).toMatch(
      /mainWindow = new BrowserWindow\(windowOptions\);\s*keepOutOfTaskbarWhenShown\(mainWindow\);/
    );
    expect(mainSource).toMatch(
      /const pinWindow = new BrowserWindow\(windowOptions\);\s*keepOutOfTaskbarWhenShown\(pinWindow\);/
    );
  });
});

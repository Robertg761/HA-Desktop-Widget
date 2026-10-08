/** @jest-environment node */
const { EventEmitter } = require('events');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { createWindowAutoHideController } = require('../../src/window-auto-hide.cjs');
const { createPopupWindowPresenter } = require('../../src/popup-window-presenter.cjs');

function setup({ initiallyFocused = true, getCursorPosition = () => ({ x: 10, y: 10 }) } = {}) {
  let enabled = true;
  let suppressed = false;
  let focused = initiallyFocused;
  let visible = true;
  let destroyed = false;
  const window = new EventEmitter();
  Object.assign(window, {
    isDestroyed: () => destroyed,
    isVisible: () => visible,
    isFocused: () => focused,
    setAlwaysOnTop: jest.fn(),
    show: jest.fn(() => {
      visible = true;
    }),
    focus: jest.fn(() => {
      focused = true;
      window.emit('focus');
    }),
    moveTop: jest.fn(),
    hide: jest.fn(() => {
      visible = false;
      window.emit('hide');
    }),
    webContents: Object.assign(new EventEmitter(), {
      isDevToolsFocused: jest.fn(() => false),
    }),
  });
  let currentWindow = window;
  const hideWindow = jest.fn(() => presenter.hidePopup(window));
  const controller = createWindowAutoHideController({
    getWindow: () => currentWindow,
    isEnabled: () => enabled,
    isSuppressed: () => suppressed,
    hideWindow,
    getCursorPosition,
  });
  const presenter = createPopupWindowPresenter({
    onWillShow: controller.prepareToShow,
    getConfig: () => ({ alwaysOnTop: false }),
  });
  window.on('hide', () => {
    controller.handleHidden();
    presenter.handleWindowHidden(window);
  });
  controller.watchDevTools();
  window.on('focus', controller.handleFocus);
  window.on('blur', controller.handleBlur);
  if (initiallyFocused) controller.handleFocus();
  return {
    controller,
    presenter,
    window,
    hideWindow,
    blur: () => {
      focused = false;
      window.emit('blur');
    },
    focus: () => window.focus(),
    setEnabled: (value) => {
      enabled = value;
    },
    setSuppressed: (value) => {
      suppressed = value;
    },
    destroy: () => {
      destroyed = true;
      controller.handleHidden();
    },
    replace: () => {
      currentWindow = { ...window };
    },
  };
}

describe('optional hide on focus loss', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => {
    jest.clearAllTimers();
    jest.useRealTimers();
  });

  test('hides after sustained blur and restores the configured window level', () => {
    const r = setup();
    r.presenter.showAboveFullScreen(r.window);
    jest.advanceTimersByTime(200);
    r.blur();
    jest.advanceTimersByTime(199);
    expect(r.window.hide).not.toHaveBeenCalled();
    jest.advanceTimersByTime(1);
    expect(r.window.hide).toHaveBeenCalledTimes(1);
    expect(r.presenter.isElevated()).toBe(false);
    expect(r.window.setAlwaysOnTop).toHaveBeenLastCalledWith(false);
    jest.runOnlyPendingTimers();
    expect(r.window.show).toHaveBeenCalledTimes(1);
  });

  test.each([
    'disabled',
    'disabled while pending',
    'focus returns',
    'hidden',
    'destroyed',
    'replaced',
    'devtools',
    'hold starts',
  ])('%s cancels or prevents dismissal', (scenario) => {
    const r = setup();
    if (scenario === 'disabled') r.setEnabled(false);
    r.blur();
    if (scenario === 'disabled while pending') r.setEnabled(false);
    if (scenario === 'focus returns') r.focus();
    if (scenario === 'hidden') r.window.hide();
    if (scenario === 'destroyed') r.destroy();
    if (scenario === 'replaced') r.replace();
    if (scenario === 'devtools') r.window.webContents.isDevToolsFocused.mockReturnValue(true);
    if (scenario === 'hold starts') r.setSuppressed(true);
    jest.runOnlyPendingTimers();
    expect(r.hideWindow).not.toHaveBeenCalled();
  });

  test('an unfocused startup does not hide until the window has received focus', () => {
    const r = setup({ initiallyFocused: false });
    r.controller.prepareToShow();
    r.blur();
    jest.advanceTimersByTime(1000);
    expect(r.hideWindow).not.toHaveBeenCalled();
    r.focus();
    r.blur();
    jest.advanceTimersByTime(200);
    expect(r.hideWindow).toHaveBeenCalledTimes(1);
  });

  test('ignores activation blur when raising an already visible window', () => {
    const r = setup();
    r.presenter.showAboveFullScreen(r.window);
    r.blur();
    jest.advanceTimersByTime(100);
    r.focus();
    jest.advanceTimersByTime(300);
    expect(r.hideWindow).not.toHaveBeenCalled();
    r.blur();
    jest.advanceTimersByTime(200);
    expect(r.hideWindow).toHaveBeenCalledTimes(1);
  });

  test.each([true, false])(
    'remembers focus lost during activation, initially focused: %s',
    (initiallyFocused) => {
      const r = setup({ initiallyFocused });
      r.controller.prepareToShow();
      if (!initiallyFocused) r.focus();
      jest.advanceTimersByTime(30);
      r.blur();
      jest.advanceTimersByTime(169);
      expect(r.hideWindow).not.toHaveBeenCalled();
      jest.advanceTimersByTime(201);
      expect(r.hideWindow).toHaveBeenCalledTimes(1);
    }
  );

  test('an old activation timer cannot arm a replacement window', () => {
    const r = setup();
    r.controller.prepareToShow();
    r.replace();
    jest.advanceTimersByTime(200);
    r.blur();
    jest.advanceTimersByTime(200);
    expect(r.hideWindow).not.toHaveBeenCalled();
  });

  test('showing again cancels an old pending dismissal', () => {
    const r = setup();
    r.blur();
    jest.advanceTimersByTime(100);
    r.presenter.showAboveFullScreen(r.window);
    jest.advanceTimersByTime(1000);
    expect(r.hideWindow).not.toHaveBeenCalled();
  });

  test('holds visibility until key release, then reevaluates focus', () => {
    const r = setup();
    r.setSuppressed(true);
    r.blur();
    jest.advanceTimersByTime(1000);
    expect(r.hideWindow).not.toHaveBeenCalled();
    r.setSuppressed(false);
    r.controller.handleBlur();
    jest.advanceTimersByTime(200);
    expect(r.hideWindow).toHaveBeenCalledTimes(1);
  });

  test('nested menus and dialogs suspend a pending hide until all close', () => {
    const r = setup();
    r.blur();
    const resumeMenu = r.controller.suspend();
    const resumeDialog = r.controller.suspend();
    jest.advanceTimersByTime(1000);
    resumeMenu();
    resumeMenu();
    jest.advanceTimersByTime(1000);
    expect(r.hideWindow).not.toHaveBeenCalled();
    resumeDialog();
    r.focus();
    jest.advanceTimersByTime(1000);
    expect(r.hideWindow).not.toHaveBeenCalled();
    r.blur();
    jest.advanceTimersByTime(200);
    expect(r.hideWindow).toHaveBeenCalledTimes(1);
  });

  test('dismisses after a dialog closes if focus remains elsewhere', () => {
    const r = setup();
    const resume = r.controller.suspend();
    r.blur();
    jest.advanceTimersByTime(1000);
    resume();
    jest.advanceTimersByTime(200);
    expect(r.hideWindow).toHaveBeenCalledTimes(1);
  });

  test.each(['leave', 'close'])('resumes auto-hide when detached DevTools %s', (action) => {
    const r = setup();
    const devTools = new EventEmitter();
    r.window.webContents.devToolsWebContents = devTools;
    r.window.webContents.emit('devtools-opened');
    r.window.webContents.isDevToolsFocused.mockReturnValue(true);
    r.blur();
    jest.advanceTimersByTime(500);
    expect(r.hideWindow).not.toHaveBeenCalled();
    r.window.webContents.isDevToolsFocused.mockReturnValue(false);
    if (action === 'leave') devTools.emit('blur');
    else r.window.webContents.emit('devtools-closed');
    jest.advanceTimersByTime(200);
    expect(r.hideWindow).toHaveBeenCalledTimes(1);
  });

  test('returning from DevTools to the widget cancels dismissal', () => {
    const r = setup();
    const devTools = new EventEmitter();
    r.window.webContents.devToolsWebContents = devTools;
    r.window.webContents.emit('devtools-opened');
    r.window.webContents.isDevToolsFocused.mockReturnValue(true);
    r.blur();
    jest.advanceTimersByTime(500);
    r.window.webContents.isDevToolsFocused.mockReturnValue(false);
    devTools.emit('blur');
    r.focus();
    jest.advanceTimersByTime(500);
    expect(r.hideWindow).not.toHaveBeenCalled();
  });

  test('cleans up DevTools listeners on reopening and window destruction', () => {
    const r = setup();
    const oldTools = new EventEmitter();
    const newTools = new EventEmitter();
    r.window.webContents.devToolsWebContents = oldTools;
    r.window.webContents.emit('devtools-opened');
    expect(oldTools.listenerCount('blur')).toBe(1);
    r.window.webContents.emit('devtools-closed');
    expect(oldTools.listenerCount('blur')).toBe(0);
    r.window.webContents.devToolsWebContents = newTools;
    r.window.webContents.emit('devtools-opened');
    r.window.webContents.emit('devtools-opened');
    expect(newTools.listenerCount('blur')).toBe(1);
    r.window.emit('closed');
    expect(newTools.listenerCount('blur')).toBe(0);
    expect(r.window.webContents.listenerCount('devtools-opened')).toBe(0);
    expect(r.window.webContents.listenerCount('devtools-closed')).toBe(0);
  });

  test('tray toggle consumes a recent auto-hide once and allows later reopening', () => {
    const r = setup();
    r.blur();
    jest.advanceTimersByTime(200);
    expect(r.controller.consumeTrayDismissal({ x: 0, y: 0, width: 24, height: 24 })).toBe(true);
    expect(r.controller.consumeTrayDismissal({ x: 0, y: 0, width: 24, height: 24 })).toBe(false);
    r.presenter.showAboveFullScreen(r.window);
    jest.advanceTimersByTime(200);
    r.blur();
    jest.advanceTimersByTime(700);
    expect(r.controller.consumeTrayDismissal({ x: 0, y: 0, width: 24, height: 24 })).toBe(false);
  });

  test('an unrelated auto-hide does not swallow a quick tray click', () => {
    const r = setup({ getCursorPosition: () => ({ x: 600, y: 400 }) });
    r.blur();
    jest.advanceTimersByTime(200);
    expect(r.controller.consumeTrayDismissal({ x: 0, y: 0, width: 24, height: 24 })).toBe(false);
  });

  test.each([
    undefined,
    { x: 0, y: 0, width: 0, height: 0 },
    { x: NaN, y: 0, width: 24, height: 24 },
  ])('unknown or invalid tray bounds never suppress activation: %p', (bounds) => {
    const r = setup();
    r.blur();
    jest.advanceTimersByTime(200);
    expect(r.controller.consumeTrayDismissal(bounds)).toBe(false);
  });

  test.each([
    () => null,
    () => {
      throw new Error('cursor unavailable');
    },
  ])(
    'missing cursor data does not prevent hiding or swallow tray activation',
    (getCursorPosition) => {
      const r = setup({ getCursorPosition });
      r.blur();
      jest.advanceTimersByTime(200);
      expect(r.hideWindow).toHaveBeenCalledTimes(1);
      expect(r.controller.consumeTrayDismissal({ x: 0, y: 0, width: 24, height: 24 })).toBe(false);
    }
  );

  test('uses the pointer location at blur, even if it moves over the tray before hiding', () => {
    const point = { x: 600, y: 400 };
    const r = setup({ getCursorPosition: () => point });
    r.blur();
    Object.assign(point, { x: 10, y: 10 });
    jest.advanceTimersByTime(200);
    expect(r.controller.consumeTrayDismissal({ x: 0, y: 0, width: 24, height: 24 })).toBe(false);
  });

  test('recognizes tray bounds on monitors with negative coordinates', () => {
    const r = setup({ getCursorPosition: () => ({ x: -100, y: -10 }) });
    r.blur();
    jest.advanceTimersByTime(200);
    expect(r.controller.consumeTrayDismissal({ x: -110, y: -20, width: 24, height: 24 })).toBe(
      true
    );
  });

  test('closing a window clears suspensions without letting old callbacks alter new ones', () => {
    const r = setup();
    const oldResume = r.controller.suspend();
    r.controller.handleClosed();
    r.controller.prepareToShow();
    r.focus();
    jest.advanceTimersByTime(200);
    const newResume = r.controller.suspend();
    oldResume();
    r.blur();
    jest.advanceTimersByTime(500);
    expect(r.hideWindow).not.toHaveBeenCalled();
    newResume();
    jest.advanceTimersByTime(200);
    expect(r.hideWindow).toHaveBeenCalledTimes(1);
  });

  test('a tray click before the hide timer fires cancels that timer', () => {
    const r = setup();
    r.blur();
    expect(r.controller.consumeTrayDismissal()).toBe(false);
    jest.advanceTimersByTime(500);
    expect(r.hideWindow).not.toHaveBeenCalled();
  });

  test('main-process opt-in keeps the widget while the pins are being edited', () => {
    // Reorganize mode puts the pins in edit mode, and pressing a pin blurs the main window. Hiding it
    // then would strand every pin in an edit state whose exit controls are in the hidden window.
    const source = fs.readFileSync(path.resolve(__dirname, '../../main.js'), 'utf8');
    const start = source.indexOf('const windowAutoHide = createWindowAutoHideController({');
    const end = source.indexOf('const popupWindowPresenter =', start);
    const context = {
      createWindowAutoHideController: jest.fn(),
      popupHotkeyPressed: false,
      desktopPinEditMode: false,
    };
    vm.runInNewContext(source.slice(start, end), context);
    const { isSuppressed } = context.createWindowAutoHideController.mock.calls[0][0];
    expect(isSuppressed()).toBe(false);
    context.desktopPinEditMode = true;
    expect(isSuppressed()).toBe(true);
    context.desktopPinEditMode = false;
    context.popupHotkeyPressed = true;
    expect(isSuppressed()).toBe(true);
  });

  describe('ending pin edit mode when the main window hides', () => {
    const source = fs.readFileSync(path.resolve(__dirname, '../../main.js'), 'utf8');

    // main.js's own functions and its real 'hide' handler, run against stand-ins for the rest.
    function loadHideRuntime({ editMode = true } = {}) {
      const mainWindow = new EventEmitter();
      mainWindow.isDestroyed = () => false;
      mainWindow.webContents = { send: jest.fn() };
      const pinWindow = { isDestroyed: () => false, setMovable: jest.fn() };
      const context = {
        mainWindow,
        desktopPinEditMode: editMode,
        desktopPinResizeSessions: new Map(),
        desktopPinWindows: new Map([['light.desk', pinWindow]]),
        sendDesktopPinUpdate: jest.fn(),
        endDesktopPinResizeSession: jest.fn(),
        runBackgroundConfigMutation: jest.fn(),
        saveConfig: jest.fn(),
        pushConfigToRenderer: jest.fn(),
        log: { warn: jest.fn() },
        windowAutoHide: { handleHidden: jest.fn() },
        popupWindowPresenter: { handleWindowHidden: jest.fn() },
        notifyDesktopCompanionStateChanged: jest.fn(),
      };
      const slice = (from, to) => source.slice(source.indexOf(from), source.indexOf(to));
      vm.runInNewContext(
        [
          slice('function applyDesktopPinEditModeToWindow(', '// A corner drag reports itself'),
          slice("mainWindow.on('hide', () => {", "mainWindow.on('show', () => {"),
        ].join('\n'),
        context
      );
      return { context, mainWindow, pinWindow };
    }

    // The tray toggle, close to tray and minimize all end in this one 'hide' event.
    test('ends it and tells the dashboard to leave Reorganize mode, whatever hid the window', () => {
      const { context, mainWindow, pinWindow } = loadHideRuntime();

      mainWindow.emit('hide');

      expect(context.desktopPinEditMode).toBe(false);
      expect(pinWindow.setMovable).toHaveBeenLastCalledWith(false);
      expect(context.sendDesktopPinUpdate).toHaveBeenCalledWith('light.desk', {
        type: 'edit-mode',
      });
      // The dashboard has to follow, or it shows Reorganize mode over pins that cannot be edited.
      expect(mainWindow.webContents.send).toHaveBeenCalledTimes(1);
      expect(mainWindow.webContents.send).toHaveBeenCalledWith('desktop-pin-edit-mode-ended');
      expect(context.windowAutoHide.handleHidden).toHaveBeenCalled();
    });

    test('says nothing to the dashboard when the pins were not being edited', () => {
      const { context, mainWindow, pinWindow } = loadHideRuntime({ editMode: false });

      mainWindow.emit('hide');

      expect(context.desktopPinEditMode).toBe(false);
      expect(pinWindow.setMovable).not.toHaveBeenCalled();
      expect(mainWindow.webContents.send).not.toHaveBeenCalled();
      expect(context.windowAutoHide.handleHidden).toHaveBeenCalled();
    });

    test('sends the dashboard back out of Reorganize mode once per edit session', () => {
      const { mainWindow } = loadHideRuntime();

      mainWindow.emit('hide');
      mainWindow.emit('hide');

      expect(mainWindow.webContents.send).toHaveBeenCalledTimes(1);
    });

    test('the renderer subscribes and leaves Reorganize mode, but not in a desktop pin window', () => {
      const rendererSource = fs.readFileSync(path.resolve(__dirname, '../../renderer.js'), 'utf8');
      const block = rendererSource.slice(
        rendererSource.indexOf('window.electronAPI.onDesktopPinEditModeEnded'),
        rendererSource.indexOf('window.electronAPI.onEntityTileHotkeyRequested')
      );
      const run = (isPin) => {
        let listener;
        const context = {
          IS_DESKTOP_PIN_MODE: isPin,
          ui: { exitReorganizeMode: jest.fn() },
          window: {
            electronAPI: { onDesktopPinEditModeEnded: (callback) => (listener = callback) },
          },
        };
        vm.runInNewContext(block, context);
        listener();
        return context.ui.exitReorganizeMode;
      };

      expect(run(false)).toHaveBeenCalledTimes(1);
      expect(run(true)).not.toHaveBeenCalled();
    });
  });

  describe('Home Assistant browser authorization', () => {
    const source = fs.readFileSync(path.resolve(__dirname, '../../main.js'), 'utf8');
    const start = source.indexOf("ipcMain.handle('start-home-assistant-oauth'");
    const handlerSource = source.slice(start, source.indexOf('\n});\n', start) + 5);
    const flush = async () => {
      for (let index = 0; index < 12; index += 1) await Promise.resolve();
    };

    // The real handler, auto-hide controller and popup presenter, against a pairing the test settles.
    function startPairing() {
      const r = setup();
      let settle;
      const handlers = {};
      const context = {
        ipcMain: { handle: (channel, handler) => (handlers[channel] = handler) },
        authorizeIpcSender: () => ({ type: 'main' }),
        rejectUnauthorizedIpc: jest.fn(),
        windowAutoHide: r.controller,
        showMainWindowFromTray: jest.fn(() => r.presenter.showAboveFullScreen(r.window)),
        getHomeAssistantOAuthClient: () => ({
          pair: (_url, { commit }) =>
            new Promise((resolve, reject) => (settle = { resolve, reject })).then((session) =>
              commit((persistSession) => persistSession(session))
            ),
        }),
        runSerializedConfigMutation: (task) => Promise.resolve().then(task),
        applyHomeAssistantOAuthSession: jest.fn(async () => ({ homeAssistant: {} })),
        describeLinuxKeyringPairingError: (code) => code,
        log: { warn: jest.fn() },
      };
      vm.runInNewContext(handlerSource, context);
      const pending = handlers['start-home-assistant-oauth']({}, 'http://ha.local:8123');
      // The browser opens and takes focus from the widget while the person authorizes.
      r.blur();
      return { r, context, pending, settle: () => settle };
    }

    const failures = [
      ['declined', 'OAUTH_AUTHORIZATION_DECLINED'],
      ['timed out', 'OAUTH_AUTHORIZATION_TIMEOUT'],
      ['failed', 'OAUTH_CALLBACK_FAILED'],
      ['failed with no code', undefined],
    ];

    test('holds the widget while the browser has focus', async () => {
      const { r, pending, settle } = startPairing();
      jest.advanceTimersByTime(5000);
      expect(r.hideWindow).not.toHaveBeenCalled();
      settle().resolve({});
      await pending;
    });

    test.each(failures)(
      'raises the widget when authorization %s, so its message stays visible',
      async (_label, code) => {
        const { r, context, pending, settle } = startPairing();
        settle().reject(Object.assign(new Error('not authorized'), code ? { code } : {}));

        await expect(pending).resolves.toMatchObject({
          success: false,
          error: 'not authorized',
        });
        await flush();
        expect(context.showMainWindowFromTray).toHaveBeenCalledTimes(1);
        expect(r.window.focus).toHaveBeenCalled();
        // Resuming auto-hide rechecks the browser's blur; the raise has to be in before that.
        jest.advanceTimersByTime(5000);
        expect(r.hideWindow).not.toHaveBeenCalled();
        expect(r.window.hide).not.toHaveBeenCalled();
      }
    );

    test('raises the widget once the connection is made', async () => {
      const { r, context, pending, settle } = startPairing();
      settle().resolve({ accessToken: 'token' });

      await expect(pending).resolves.toMatchObject({ success: true });
      expect(context.applyHomeAssistantOAuthSession).toHaveBeenCalledTimes(1);
      expect(context.showMainWindowFromTray).toHaveBeenCalledTimes(1);
      jest.advanceTimersByTime(5000);
      expect(r.hideWindow).not.toHaveBeenCalled();
    });

    test('raises the widget when saving the authorization fails', async () => {
      const { r, context, pending, settle } = startPairing();
      context.applyHomeAssistantOAuthSession.mockRejectedValue(
        Object.assign(new Error('keyring locked'), { code: 'OAUTH_STORE_WRITE' })
      );
      settle().resolve({});

      await expect(pending).resolves.toMatchObject({ success: false, code: 'OAUTH_STORE_WRITE' });
      expect(context.showMainWindowFromTray).toHaveBeenCalledTimes(1);
      jest.advanceTimersByTime(5000);
      expect(r.hideWindow).not.toHaveBeenCalled();
    });

    test('still resumes auto-hide, and keeps the result, if the raise throws', async () => {
      const { r, context, pending, settle } = startPairing();
      context.showMainWindowFromTray.mockImplementation(() => {
        throw new Error('window gone');
      });
      settle().reject(
        Object.assign(new Error('declined'), { code: 'OAUTH_AUTHORIZATION_DECLINED' })
      );

      await expect(pending).resolves.toMatchObject({ success: false, error: 'declined' });
      expect(context.log.warn).toHaveBeenCalled();
      // The suspension is released: with focus still in the browser, the widget goes back to hiding.
      jest.advanceTimersByTime(200);
      expect(r.hideWindow).toHaveBeenCalledTimes(1);
    });
  });

  test('main-process opt-in excludes desktop-layer mode and quitting', () => {
    const source = fs.readFileSync(path.resolve(__dirname, '../../main.js'), 'utf8');
    const start = source.indexOf('const windowAutoHide = createWindowAutoHideController({');
    const end = source.indexOf('const popupWindowPresenter =', start);
    const context = {
      createWindowAutoHideController: jest.fn(),
      appliedHideOnBlur: false,
      isLayerShellChildProcess: false,
      isQuitting: false,
    };
    vm.runInNewContext(source.slice(start, end), context);
    const { isEnabled } = context.createWindowAutoHideController.mock.calls[0][0];
    expect(isEnabled()).toBe(false);
    context.appliedHideOnBlur = true;
    expect(isEnabled()).toBe(true);
    context.isLayerShellChildProcess = true;
    expect(isEnabled()).toBe(false);
    context.isLayerShellChildProcess = false;
    context.isQuitting = true;
    expect(isEnabled()).toBe(false);
  });
});

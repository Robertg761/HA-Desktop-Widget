/**
 * @jest-environment node
 */

const {
  LINUX_POPUP_HOTKEY_BACKEND,
  POPUP_TOGGLE_DEBOUNCE_MS,
  createLinuxPopupHotkeyController,
  isLinuxPopupHotkeyPlatform,
} = require('../../src/linux-popup-hotkey.cjs');

function createGlobalShortcutMock() {
  const callbacks = new Map();
  return {
    callbacks,
    register: jest.fn((accelerator, callback) => {
      if (callbacks.has(accelerator)) return false;
      callbacks.set(accelerator, callback);
      return true;
    }),
    unregister: jest.fn((accelerator) => callbacks.delete(accelerator)),
    isRegistered: jest.fn((accelerator) => callbacks.has(accelerator)),
  };
}

function createWindowMock(overrides = {}) {
  return {
    isDestroyed: jest.fn(() => false),
    isAlwaysOnTop: jest.fn(() => false),
    isMinimized: jest.fn(() => false),
    isVisible: jest.fn(() => false),
    isFocused: jest.fn(() => false),
    restore: jest.fn(),
    show: jest.fn(),
    hide: jest.fn(),
    setAlwaysOnTop: jest.fn(),
    focus: jest.fn(),
    moveTop: jest.fn(),
    ...overrides,
  };
}

function createController(overrides = {}) {
  const globalShortcut = overrides.globalShortcut || createGlobalShortcutMock();
  const targetWindow = overrides.targetWindow || createWindowMock();
  const config = overrides.config || { popupHotkeyToggleMode: false };
  let timestamp = overrides.timestamp || 1000;
  const log = {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  };
  const controller = createLinuxPopupHotkeyController({
    globalShortcut,
    getConfig: () => config,
    getMainWindow: () => targetWindow,
    log,
    now: () => timestamp,
  });

  return {
    controller,
    globalShortcut,
    targetWindow,
    config,
    log,
    setTimestamp(value) {
      timestamp = value;
    },
  };
}

describe('Linux popup hotkeys', () => {
  beforeEach(() => {
    // The presenter re-asserts its raise on a timer; fake timers keep those callbacks
    // inside the test instead of firing after teardown.
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.clearAllTimers();
    jest.useRealTimers();
  });

  test('selects the Linux backend only on Linux', () => {
    expect(isLinuxPopupHotkeyPlatform('linux')).toBe(true);
    expect(isLinuxPopupHotkeyPlatform('darwin')).toBe(false);
    expect(isLinuxPopupHotkeyPlatform('win32')).toBe(false);
  });

  test('registers and unregisters only its own accelerator', () => {
    const { controller, globalShortcut } = createController();

    expect(controller.register('Ctrl+Alt+H')).toEqual({
      success: true,
      backend: LINUX_POPUP_HOTKEY_BACKEND,
    });
    expect(controller.getRegisteredAccelerator()).toBe('Ctrl+Alt+H');
    expect(globalShortcut.isRegistered('Ctrl+Alt+H')).toBe(true);

    expect(controller.unregister()).toEqual({
      success: true,
      backend: LINUX_POPUP_HOTKEY_BACKEND,
    });
    expect(globalShortcut.unregister).toHaveBeenCalledWith('Ctrl+Alt+H');
    expect(controller.getRegisteredAccelerator()).toBe('');
  });

  test('reports conflicts without remembering a failed registration', () => {
    const globalShortcut = createGlobalShortcutMock();
    globalShortcut.register.mockReturnValueOnce(false);
    const { controller } = createController({ globalShortcut });

    expect(controller.register('Ctrl+Shift+F12')).toEqual({
      success: false,
      backend: LINUX_POPUP_HOTKEY_BACKEND,
      error: 'Hotkey is likely in use by another application',
    });
    expect(controller.getRegisteredAccelerator()).toBe('');
  });

  test('replaces an existing popup shortcut without unregistering entity shortcuts', () => {
    const { controller, globalShortcut } = createController();
    globalShortcut.callbacks.set('Ctrl+1', jest.fn());

    controller.register('Ctrl+Alt+H');
    controller.register('Ctrl+Shift+F12');

    expect(globalShortcut.unregister).toHaveBeenCalledTimes(1);
    expect(globalShortcut.unregister).toHaveBeenCalledWith('Ctrl+Alt+H');
    expect(globalShortcut.isRegistered('Ctrl+1')).toBe(true);
    expect(globalShortcut.isRegistered('Ctrl+Shift+F12')).toBe(true);
  });

  test('press mode restores a minimized window and raises it above full-screen windows', () => {
    const targetWindow = createWindowMock({
      isAlwaysOnTop: jest.fn(() => false),
      isMinimized: jest.fn(() => true),
    });
    const { controller, globalShortcut } = createController({ targetWindow });

    controller.register('Ctrl+Alt+H');
    globalShortcut.callbacks.get('Ctrl+Alt+H')();

    expect(targetWindow.restore).toHaveBeenCalledTimes(1);
    expect(targetWindow.show).toHaveBeenCalledTimes(1);
    expect(targetWindow.focus).toHaveBeenCalledTimes(1);
    expect(targetWindow.moveTop).toHaveBeenCalledTimes(1);
    // The raise is held instead of being reverted in the same tick, which is what let a
    // full-screen video cover the window again right after it appeared.
    expect(targetWindow.setAlwaysOnTop.mock.calls).toEqual([[true, 'screen-saver']]);
    expect(targetWindow.hide).not.toHaveBeenCalled();
  });

  test('re-asserts the raise after the window is shown', () => {
    const targetWindow = createWindowMock({ isVisible: jest.fn(() => true) });
    const { controller, globalShortcut } = createController({ targetWindow });

    controller.register('Ctrl+Alt+H');
    globalShortcut.callbacks.get('Ctrl+Alt+H')();
    expect(targetWindow.moveTop).toHaveBeenCalledTimes(1);

    jest.runOnlyPendingTimers();
    expect(targetWindow.moveTop.mock.calls.length).toBeGreaterThan(1);
    expect(targetWindow.setAlwaysOnTop).toHaveBeenLastCalledWith(true, 'screen-saver');
  });

  test('hiding cancels a pending raise so the window stays hidden', () => {
    let visible = false;
    const targetWindow = createWindowMock({
      isVisible: jest.fn(() => visible),
      isFocused: jest.fn(() => visible),
      show: jest.fn(() => {
        visible = true;
      }),
      hide: jest.fn(() => {
        visible = false;
      }),
    });
    const { controller, globalShortcut, setTimestamp } = createController({
      targetWindow,
      config: { popupHotkeyToggleMode: true },
    });

    controller.register('Ctrl+Alt+H');
    const trigger = globalShortcut.callbacks.get('Ctrl+Alt+H');
    trigger();
    setTimestamp(1000 + POPUP_TOGGLE_DEBOUNCE_MS + 1);
    trigger();

    expect(targetWindow.hide).toHaveBeenCalledTimes(1);
    const moveTopCallsAtHide = targetWindow.moveTop.mock.calls.length;
    jest.runOnlyPendingTimers();
    expect(targetWindow.moveTop.mock.calls.length).toBe(moveTopCallsAtHide);
    expect(targetWindow.show).toHaveBeenCalledTimes(1);
    // Back to the user's own preference, not left pinned above every other window.
    expect(targetWindow.setAlwaysOnTop).toHaveBeenLastCalledWith(false);
  });

  test('toggle mode shows, debounces, and then hides a focused window', () => {
    let visible = false;
    let focused = false;
    const targetWindow = createWindowMock({
      isVisible: jest.fn(() => visible),
      isFocused: jest.fn(() => focused),
      show: jest.fn(() => {
        visible = true;
        focused = true;
      }),
      focus: jest.fn(() => {
        focused = true;
      }),
      hide: jest.fn(() => {
        visible = false;
        focused = false;
      }),
    });
    const config = { popupHotkeyToggleMode: true };
    const { controller, globalShortcut, setTimestamp } = createController({
      targetWindow,
      config,
    });

    controller.register('Ctrl+Alt+H');
    const trigger = globalShortcut.callbacks.get('Ctrl+Alt+H');
    trigger();
    trigger();
    expect(targetWindow.show).toHaveBeenCalledTimes(2);
    expect(targetWindow.hide).not.toHaveBeenCalled();

    setTimestamp(1000 + POPUP_TOGGLE_DEBOUNCE_MS + 1);
    trigger();
    expect(targetWindow.hide).toHaveBeenCalledTimes(1);
  });

  test('contains callback failures instead of throwing through Electron', () => {
    const targetWindow = createWindowMock({
      isVisible: jest.fn(() => {
        throw new Error('window failure');
      }),
    });
    const { controller, globalShortcut, log } = createController({
      targetWindow,
      config: { popupHotkeyToggleMode: true },
    });

    controller.register('Ctrl+Alt+H');
    expect(() => globalShortcut.callbacks.get('Ctrl+Alt+H')()).not.toThrow();
    expect(log.error).toHaveBeenCalledWith(
      'Failed to handle Linux popup hotkey:',
      expect.any(Error)
    );
  });
});

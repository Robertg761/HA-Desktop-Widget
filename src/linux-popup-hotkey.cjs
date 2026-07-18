/* global console, process */

const LINUX_POPUP_HOTKEY_BACKEND = 'globalShortcut';
const POPUP_TOGGLE_DEBOUNCE_MS = 300;

function isLinuxPopupHotkeyPlatform(platform = process.platform) {
  return platform === 'linux';
}

function createLinuxPopupHotkeyController(options = {}) {
  const {
    globalShortcut,
    getConfig = () => ({}),
    getMainWindow = () => null,
    log = console,
    now = () => Date.now(),
  } = options;

  if (!globalShortcut || typeof globalShortcut.register !== 'function') {
    throw new TypeError('Linux popup hotkeys require Electron globalShortcut');
  }

  let registeredAccelerator = '';
  let popupHotkeyLastShownTime = null;

  function unregister() {
    const accelerator = registeredAccelerator;
    registeredAccelerator = '';
    popupHotkeyLastShownTime = null;

    if (!accelerator) return { success: true, backend: LINUX_POPUP_HOTKEY_BACKEND };

    try {
      globalShortcut.unregister(accelerator);
      log.info?.(`Linux popup hotkey unregistered: ${accelerator}`);
      return { success: true, backend: LINUX_POPUP_HOTKEY_BACKEND };
    } catch (error) {
      log.error?.('Failed to unregister Linux popup hotkey:', error);
      return {
        success: false,
        backend: LINUX_POPUP_HOTKEY_BACKEND,
        error: error?.message || String(error),
      };
    }
  }

  function bringWindowToFront(targetWindow, timestamp) {
    const wasAlwaysOnTop = targetWindow.isAlwaysOnTop();
    if (targetWindow.isMinimized()) targetWindow.restore();
    targetWindow.show();
    targetWindow.setAlwaysOnTop(true);
    targetWindow.focus();
    targetWindow.moveTop();
    targetWindow.setAlwaysOnTop(wasAlwaysOnTop);
    popupHotkeyLastShownTime = timestamp;
  }

  function handleShortcut() {
    try {
      const targetWindow = getMainWindow();
      if (!targetWindow || targetWindow.isDestroyed()) return;

      const popupConfig = getConfig() || {};
      const timestamp = now();
      const recentlyShown =
        popupHotkeyLastShownTime !== null &&
        timestamp - popupHotkeyLastShownTime < POPUP_TOGGLE_DEBOUNCE_MS;

      if (
        popupConfig.popupHotkeyToggleMode &&
        targetWindow.isVisible() &&
        targetWindow.isFocused() &&
        !recentlyShown
      ) {
        targetWindow.hide();
        popupHotkeyLastShownTime = null;
        log.info?.('Linux popup hotkey toggle: window hidden');
        return;
      }

      bringWindowToFront(targetWindow, timestamp);
      log.info?.(
        popupConfig.popupHotkeyToggleMode
          ? 'Linux popup hotkey toggle: window shown'
          : 'Linux popup hotkey: window brought to front'
      );
    } catch (error) {
      log.error?.('Failed to handle Linux popup hotkey:', error);
    }
  }

  function register(accelerator) {
    const normalizedAccelerator = typeof accelerator === 'string' ? accelerator.trim() : '';
    if (!normalizedAccelerator) {
      unregister();
      return {
        success: false,
        backend: LINUX_POPUP_HOTKEY_BACKEND,
        error: 'Popup hotkey is empty',
      };
    }

    if (
      registeredAccelerator === normalizedAccelerator &&
      (typeof globalShortcut.isRegistered !== 'function' ||
        globalShortcut.isRegistered(normalizedAccelerator))
    ) {
      return { success: true, backend: LINUX_POPUP_HOTKEY_BACKEND };
    }

    const unregisterResult = unregister();
    if (!unregisterResult.success) return unregisterResult;

    try {
      const registered = globalShortcut.register(normalizedAccelerator, handleShortcut);
      if (!registered) {
        const error = 'Hotkey is likely in use by another application';
        log.warn?.(`Failed to register Linux popup hotkey: ${normalizedAccelerator}`);
        return { success: false, backend: LINUX_POPUP_HOTKEY_BACKEND, error };
      }

      registeredAccelerator = normalizedAccelerator;
      log.info?.(`Linux popup hotkey registered: ${normalizedAccelerator}`);
      return { success: true, backend: LINUX_POPUP_HOTKEY_BACKEND };
    } catch (error) {
      log.error?.(`Failed to register Linux popup hotkey ${normalizedAccelerator}:`, error);
      return {
        success: false,
        backend: LINUX_POPUP_HOTKEY_BACKEND,
        error: error?.message || String(error),
      };
    }
  }

  return {
    register,
    unregister,
    handleShortcut,
    getRegisteredAccelerator: () => registeredAccelerator,
  };
}

module.exports = {
  LINUX_POPUP_HOTKEY_BACKEND,
  POPUP_TOGGLE_DEBOUNCE_MS,
  createLinuxPopupHotkeyController,
  isLinuxPopupHotkeyPlatform,
};

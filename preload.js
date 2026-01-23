const { ipcRenderer } = require('electron');

// With contextIsolation: false, we're in the same context as the renderer
// So we can directly set window.electronAPI without using contextBridge
window.electronAPI = {
  // Config operations
  getConfig: () => ipcRenderer.invoke('get-config'),
  updateConfig: (config) => ipcRenderer.invoke('update-config', config),
  saveConfig: (config) => ipcRenderer.invoke('save-config', config),

  // Window operations
  setOpacity: (opacity) => ipcRenderer.invoke('set-opacity', opacity),
  setAlwaysOnTop: (value) => ipcRenderer.invoke('set-always-on-top', value),
  getWindowState: () => ipcRenderer.invoke('get-window-state'),
  getLoginItemSettings: () => ipcRenderer.invoke('get-login-item-settings'),
  setLoginItemSettings: (openAtLogin) => ipcRenderer.invoke('set-login-item-settings', openAtLogin),
  minimizeWindow: () => ipcRenderer.invoke('minimize-window'),
  focusWindow: () => ipcRenderer.invoke('focus-window'),
  restartApp: () => ipcRenderer.invoke('restart-app'),
  quitApp: () => ipcRenderer.invoke('quit-app'),

  // Hotkey operations
  registerHotkey: (entityId, hotkey, action) => ipcRenderer.invoke('register-hotkey', entityId, hotkey, action),
  unregisterHotkey: (entityId) => ipcRenderer.invoke('unregister-hotkey', entityId),
  registerHotkeys: () => ipcRenderer.invoke('register-hotkeys'),
  toggleHotkeys: (enabled) => ipcRenderer.invoke('toggle-hotkeys', enabled),
  validateHotkey: (hotkey) => ipcRenderer.invoke('validate-hotkey', hotkey),
  registerPopupHotkey: (hotkey) => ipcRenderer.invoke('register-popup-hotkey', hotkey),
  unregisterPopupHotkey: () => ipcRenderer.invoke('unregister-popup-hotkey'),
  getPopupHotkey: () => ipcRenderer.invoke('get-popup-hotkey'),
  isPopupHotkeyAvailable: () => ipcRenderer.invoke('is-popup-hotkey-available'),

  // Alert operations
  setEntityAlert: (entityId, alertConfig) => ipcRenderer.invoke('set-entity-alert', entityId, alertConfig),
  removeEntityAlert: (entityId) => ipcRenderer.invoke('remove-entity-alert', entityId),
  toggleAlerts: (enabled) => ipcRenderer.invoke('toggle-alerts', enabled),

  // Update operations
  checkForUpdates: () => ipcRenderer.invoke('check-for-updates'),
  quitAndInstall: () => ipcRenderer.invoke('quit-and-install'),

  // Utility operations
  getAppVersion: () => ipcRenderer.invoke('get-app-version'),
  openLogs: () => ipcRenderer.invoke('open-logs'),

  // Event listeners (one-way from main to renderer)
  // Each returns a cleanup function to remove the listener
  onHotkeyTriggered: (callback) => {
    const handler = (_event, data) => callback(data);
    ipcRenderer.on('hotkey-triggered', handler);
    return () => ipcRenderer.removeListener('hotkey-triggered', handler);
  },
  onHotkeyRegistrationFailed: (callback) => {
    const handler = (_event, data) => callback(data);
    ipcRenderer.on('hotkey-registration-failed', handler);
    return () => ipcRenderer.removeListener('hotkey-registration-failed', handler);
  },
  onAutoUpdate: (callback) => {
    const handler = (_event, data) => callback(data);
    ipcRenderer.on('auto-update', handler);
    return () => ipcRenderer.removeListener('auto-update', handler);
  },
  onOpenSettings: (callback) => {
    const handler = () => callback();
    ipcRenderer.on('open-settings', handler);
    return () => ipcRenderer.removeListener('open-settings', handler);
  }
};

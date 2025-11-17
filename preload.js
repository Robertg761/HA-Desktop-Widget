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
  onHotkeyTriggered: (callback) => {
    ipcRenderer.on('hotkey-triggered', (event, data) => callback(data));
  },
  onHotkeyRegistrationFailed: (callback) => {
    ipcRenderer.on('hotkey-registration-failed', (event, data) => callback(data));
  },
  onAutoUpdate: (callback) => {
    ipcRenderer.on('auto-update', (event, data) => callback(data));
  },
  onOpenSettings: (callback) => {
    ipcRenderer.on('open-settings', (_event) => callback());
  }
};

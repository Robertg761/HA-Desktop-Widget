const { contextBridge, ipcRenderer } = require('electron');

// With contextIsolation: true, we must use contextBridge to expose API
// This creates a secure bridge between the main and renderer processes
contextBridge.exposeInMainWorld('electronAPI', {
  platform: process.platform,
  // Config operations
  getConfig: () => ipcRenderer.invoke('get-config'),
  updateConfig: (config) => ipcRenderer.invoke('update-config', config),
  saveConfig: (config) => ipcRenderer.invoke('save-config', config),
  pinEntityToDesktop: (entityId) => ipcRenderer.invoke('pin-entity-to-desktop', entityId),
  unpinEntityFromDesktop: (entityId) => ipcRenderer.invoke('unpin-entity-from-desktop', entityId),
  setDesktopPinEditMode: (enabled) => ipcRenderer.invoke('set-desktop-pin-edit-mode', enabled),
  getDesktopPinBootstrap: (entityId) => ipcRenderer.invoke('get-desktop-pin-bootstrap', entityId),
  publishHaSnapshot: (states) => ipcRenderer.invoke('publish-ha-snapshot', states),
  publishHaEntityUpdate: (entity) => ipcRenderer.invoke('publish-ha-entity-update', entity),
  requestDesktopPinAction: (entityId, action, payload) => ipcRenderer.invoke('request-desktop-pin-action', entityId, action, payload),
  showEntityTileMenu: (entityId) => ipcRenderer.invoke('show-entity-tile-menu', entityId),
  chooseProfileSyncFolder: (provider) => ipcRenderer.invoke('choose-profile-sync-folder', provider),
  copyProfileSyncFile: (fromPath, toPath, overwrite = false) => ipcRenderer.invoke('copy-profile-sync-file', fromPath, toPath, overwrite),
  getProfileSyncStatus: () => ipcRenderer.invoke('get-profile-sync-status'),
  runProfileSync: (direction) => ipcRenderer.invoke('run-profile-sync', direction),
  setProfileSyncPassphrase: (passphrase, remember) => ipcRenderer.invoke('set-profile-sync-passphrase', passphrase, remember),
  clearProfileSyncPassphrase: () => ipcRenderer.invoke('clear-profile-sync-passphrase'),
  resolveProfileSyncFirstEnable: (choice) => ipcRenderer.invoke('resolve-profile-sync-first-enable', choice),

  // Window operations
  setOpacity: (opacity) => ipcRenderer.invoke('set-opacity', opacity),
  previewWindowEffects: (effects) => ipcRenderer.invoke('preview-window-effects', effects),
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
  openExternal: (url) => ipcRenderer.invoke('open-external', url),
  debugLog: (payload) => ipcRenderer.invoke('debug-log', payload),

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
  },
  onProfileSyncStatus: (callback) => {
    const handler = (_event, data) => callback(data);
    ipcRenderer.on('profile-sync-status', handler);
    return () => ipcRenderer.removeListener('profile-sync-status', handler);
  },
  onConfigUpdated: (callback) => {
    const handler = (_event, data) => callback(data);
    ipcRenderer.on('config-updated', handler);
    return () => ipcRenderer.removeListener('config-updated', handler);
  },
  onDesktopPinUpdate: (callback) => {
    const handler = (_event, data) => callback(data);
    ipcRenderer.on('desktop-pin-update', handler);
    return () => ipcRenderer.removeListener('desktop-pin-update', handler);
  },
  onDesktopPinActionRequested: (callback) => {
    const handler = (_event, data) => callback(data);
    ipcRenderer.on('desktop-pin-action-requested', handler);
    return () => ipcRenderer.removeListener('desktop-pin-action-requested', handler);
  }
});

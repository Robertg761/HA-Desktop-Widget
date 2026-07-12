function createElectronApi(ipcRenderer, platform) {
  const invoke = (channel, ...args) => ipcRenderer.invoke(channel, ...args);
  const subscribe = (channel, callback, { includeData = true } = {}) => {
    if (typeof callback !== 'function') {
      throw new TypeError(`${channel} listener requires a callback`);
    }
    const handler = includeData
      ? (_event, data) => callback(data)
      : () => callback();
    ipcRenderer.on(channel, handler);
    return () => ipcRenderer.removeListener(channel, handler);
  };

  return {
    platform,

    getConfig: () => invoke('get-config'),
    getLocaleBootstrap: () => invoke('get-locale-bootstrap'),
    getLocalePacks: (forceRefresh = false) => invoke('get-locale-packs', forceRefresh),
    downloadLocalePack: (locale) => invoke('download-locale-pack', locale),
    removeLocalePack: (locale) => invoke('remove-locale-pack', locale),
    updateConfig: (config) => invoke('update-config', config),
    clearTokenResetReason: () => invoke('clear-token-reset-reason'),
    saveConfig: (config) => invoke('save-config', config),
    pinEntityToDesktop: (entityId, supportInfo = null) =>
      invoke('pin-entity-to-desktop', entityId, supportInfo),
    unpinEntityFromDesktop: (entityId) => invoke('unpin-entity-from-desktop', entityId),
    setDesktopPinEditMode: (enabled) => invoke('set-desktop-pin-edit-mode', enabled),
    updateDesktopPinBounds: (entityId, bounds) =>
      invoke('update-desktop-pin-bounds', entityId, bounds),
    syncDesktopPinContentMinBounds: (entityId, minBounds) =>
      invoke('sync-desktop-pin-content-min-bounds', entityId, minBounds),
    getDesktopPinBootstrap: (entityId) => invoke('get-desktop-pin-bootstrap', entityId),
    publishHaSnapshot: (states) => invoke('publish-ha-snapshot', states),
    publishHaEntityUpdate: (entity) => invoke('publish-ha-entity-update', entity),
    requestDesktopPinAction: (entityId, action, payload) =>
      invoke('request-desktop-pin-action', entityId, action, payload),
    respondDesktopPinActionRequest: (requestId, response) =>
      invoke('desktop-pin-action-response', requestId, response),
    showEntityTileMenu: (entityId, supportInfo = null) =>
      invoke('show-entity-tile-menu', entityId, supportInfo),
    chooseProfileSyncFolder: (provider) => invoke('choose-profile-sync-folder', provider),
    copyProfileSyncFile: (fromPath, toPath, overwrite = false) =>
      invoke('copy-profile-sync-file', fromPath, toPath, overwrite),
    getProfileSyncStatus: () => invoke('get-profile-sync-status'),
    runProfileSync: (direction) => invoke('run-profile-sync', direction),
    setProfileSyncPassphrase: (passphrase, remember) =>
      invoke('set-profile-sync-passphrase', passphrase, remember),
    clearProfileSyncPassphrase: () => invoke('clear-profile-sync-passphrase'),
    resolveProfileSyncFirstEnable: (choice) => invoke('resolve-profile-sync-first-enable', choice),

    setOpacity: (opacity) => invoke('set-opacity', opacity),
    previewWindowEffects: (effects) => invoke('preview-window-effects', effects),
    setAlwaysOnTop: (value) => invoke('set-always-on-top', value),
    getWindowState: () => invoke('get-window-state'),
    getLoginItemSettings: () => invoke('get-login-item-settings'),
    setLoginItemSettings: (openAtLogin) => invoke('set-login-item-settings', openAtLogin),
    minimizeWindow: () => invoke('minimize-window'),
    focusWindow: () => invoke('focus-window'),
    focusDesktopPin: (entityId) => invoke('focus-desktop-pin', entityId),
    restartApp: () => invoke('restart-app'),
    quitApp: () => invoke('quit-app'),

    registerHotkey: (entityId, hotkey, action) =>
      invoke('register-hotkey', entityId, hotkey, action),
    unregisterHotkey: (entityId) => invoke('unregister-hotkey', entityId),
    registerHotkeys: () => invoke('register-hotkeys'),
    toggleHotkeys: (enabled) => invoke('toggle-hotkeys', enabled),
    validateHotkey: (hotkey) => invoke('validate-hotkey', hotkey),
    registerPopupHotkey: (hotkey) => invoke('register-popup-hotkey', hotkey),
    unregisterPopupHotkey: () => invoke('unregister-popup-hotkey'),
    getPopupHotkey: () => invoke('get-popup-hotkey'),
    isPopupHotkeyAvailable: () => invoke('is-popup-hotkey-available'),

    setEntityAlert: (entityId, alertConfig) =>
      invoke('set-entity-alert', entityId, alertConfig),
    removeEntityAlert: (entityId) => invoke('remove-entity-alert', entityId),
    toggleAlerts: (enabled) => invoke('toggle-alerts', enabled),

    checkForUpdates: () => invoke('check-for-updates'),
    quitAndInstall: () => invoke('quit-and-install'),

    getAppVersion: () => invoke('get-app-version'),
    openLogs: () => invoke('open-logs'),
    openExternal: (url) => invoke('open-external', url),
    testHaConnection: (url, token) => invoke('test-ha-connection', url, token),
    debugLog: (payload) => invoke('debug-log', payload),

    onHotkeyTriggered: (callback) => subscribe('hotkey-triggered', callback),
    onHotkeyRegistrationFailed: (callback) =>
      subscribe('hotkey-registration-failed', callback),
    onAutoUpdate: (callback) => subscribe('auto-update', callback),
    onOpenSettings: (callback) => subscribe('open-settings', callback, { includeData: false }),
    onProfileSyncStatus: (callback) => subscribe('profile-sync-status', callback),
    onConfigUpdated: (callback) => subscribe('config-updated', callback),
    onDesktopPinUpdate: (callback) => subscribe('desktop-pin-update', callback),
    onDesktopPinActionRequested: (callback) =>
      subscribe('desktop-pin-action-requested', callback),
    onEntityTileHotkeyRequested: (callback) =>
      subscribe('entity-tile-hotkey-requested', callback),
  };
}

module.exports = { createElectronApi };

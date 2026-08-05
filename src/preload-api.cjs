function createElectronApi(ipcRenderer, platform) {
  const invoke = (channel, ...args) => ipcRenderer.invoke(channel, ...args);
  const invokeChecked = async (channel, ...args) => {
    const result = await invoke(channel, ...args);
    if (result && typeof result === 'object' && result.success === false) {
      const error = new Error(result.error || `${channel} failed`);
      error.result = result;
      throw error;
    }
    return result;
  };
  const subscribe = (channel, callback, { includeData = true } = {}) => {
    if (typeof callback !== 'function') {
      throw new TypeError(`${channel} listener requires a callback`);
    }
    const handler = includeData ? (_event, data) => callback(data) : () => callback();
    ipcRenderer.on(channel, handler);
    return () => ipcRenderer.removeListener(channel, handler);
  };
  let pendingConfigMutations = 0;
  let latestSettledConfigRevision = -1;
  let latestDeliveredConfigRevision = -1;
  let deferredConfigUpdate = null;
  const configUpdatedSubscribers = new Set();
  let configUpdatedHandler = null;

  const getConfigRevision = (value) => {
    const revision = Number(value?.configRevision);
    return Number.isFinite(revision) ? revision : null;
  };
  const deliverConfigUpdate = (nextConfig) => {
    const revision = getConfigRevision(nextConfig);
    if (
      revision !== null &&
      (revision < latestSettledConfigRevision || revision < latestDeliveredConfigRevision)
    ) {
      return;
    }
    if (revision !== null) {
      latestDeliveredConfigRevision = Math.max(latestDeliveredConfigRevision, revision);
    }
    configUpdatedSubscribers.forEach((callback) => callback(nextConfig));
  };
  const flushDeferredConfigUpdate = () => {
    if (pendingConfigMutations || !deferredConfigUpdate) return;
    const nextConfig = deferredConfigUpdate;
    deferredConfigUpdate = null;
    deliverConfigUpdate(nextConfig);
  };
  const invokeConfigMutation = async (channel, ...args) => {
    pendingConfigMutations += 1;
    try {
      const result = await invokeChecked(channel, ...args);
      const revision = getConfigRevision(result?.config || result);
      if (revision !== null) {
        latestSettledConfigRevision = Math.max(latestSettledConfigRevision, revision);
      }
      return result;
    } catch (error) {
      const revision = getConfigRevision(error?.result?.config);
      if (revision !== null) {
        latestSettledConfigRevision = Math.max(latestSettledConfigRevision, revision);
      }
      throw error;
    } finally {
      pendingConfigMutations = Math.max(0, pendingConfigMutations - 1);
      flushDeferredConfigUpdate();
    }
  };
  const updateConfig = (config) => invokeConfigMutation('update-config', config);
  const replaceConfigEntityId = (oldEntityId, newEntityId) =>
    invokeConfigMutation('replace-config-entity-id', oldEntityId, newEntityId);
  const subscribeConfigUpdated = (callback) => {
    if (typeof callback !== 'function') {
      throw new TypeError('config-updated listener requires a callback');
    }
    configUpdatedSubscribers.add(callback);
    if (!configUpdatedHandler) {
      configUpdatedHandler = (_event, nextConfig) => {
        if (pendingConfigMutations) {
          const deferredRevision = getConfigRevision(deferredConfigUpdate);
          const nextRevision = getConfigRevision(nextConfig);
          if (
            !deferredConfigUpdate ||
            nextRevision === null ||
            deferredRevision === null ||
            nextRevision >= deferredRevision
          ) {
            deferredConfigUpdate = nextConfig;
          }
          return;
        }
        deliverConfigUpdate(nextConfig);
      };
      ipcRenderer.on('config-updated', configUpdatedHandler);
    }
    return () => {
      configUpdatedSubscribers.delete(callback);
      if (!configUpdatedSubscribers.size && configUpdatedHandler) {
        ipcRenderer.removeListener('config-updated', configUpdatedHandler);
        configUpdatedHandler = null;
        deferredConfigUpdate = null;
      }
    };
  };

  return {
    platform,

    signalRendererReady: () => invoke('renderer-ready'),
    getConfig: () => invoke('get-config'),
    getLocaleBootstrap: () => invoke('get-locale-bootstrap'),
    getLocalePacks: (forceRefresh = false) => invoke('get-locale-packs', forceRefresh),
    downloadLocalePack: (locale) => invoke('download-locale-pack', locale),
    removeLocalePack: (locale) => invoke('remove-locale-pack', locale),
    updateConfig,
    replaceConfigEntityId,
    clearTokenResetReason: () => invokeChecked('clear-token-reset-reason'),
    saveConfig: (config) => invokeChecked('save-config', config),
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
    setProfileSyncPassphrase: (passphrase, remember, encryptionEnabled = null) =>
      invoke('set-profile-sync-passphrase', passphrase, remember, encryptionEnabled),
    clearProfileSyncPassphrase: () => invokeChecked('clear-profile-sync-passphrase'),
    resolveProfileSyncFirstEnable: (choice) => invoke('resolve-profile-sync-first-enable', choice),

    setOpacity: (opacity) => invokeChecked('set-opacity', opacity),
    previewWindowEffects: (effects) => invoke('preview-window-effects', effects),
    setAlwaysOnTop: (value) => invokeChecked('set-always-on-top', value),
    getWindowState: () => invoke('get-window-state'),
    getLoginItemSettings: () => invoke('get-login-item-settings'),
    setLoginItemSettings: (openAtLogin) => invoke('set-login-item-settings', openAtLogin),
    minimizeWindow: () => invoke('minimize-window'),
    focusWindow: () => invoke('focus-window'),
    focusDesktopPin: (entityId) => invoke('focus-desktop-pin', entityId),
    restartApp: () => invokeChecked('restart-app'),
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

    setEntityAlert: (entityId, alertConfig) => invoke('set-entity-alert', entityId, alertConfig),
    removeEntityAlert: (entityId) => invoke('remove-entity-alert', entityId),
    toggleAlerts: (enabled) => invoke('toggle-alerts', enabled),

    checkForUpdates: () => invoke('check-for-updates'),
    quitAndInstall: () => invoke('quit-and-install'),

    getAppVersion: () => invoke('get-app-version'),
    openLogs: () => invoke('open-logs'),
    openExternal: (url) => invoke('open-external', url),
    testHaConnection: (url, token) => invoke('test-ha-connection', url, token),
    startHomeAssistantOAuth: (url) => invokeChecked('start-home-assistant-oauth', url),
    cancelHomeAssistantOAuth: () => invokeChecked('cancel-home-assistant-oauth'),
    disconnectHomeAssistantOAuth: () => invokeChecked('disconnect-home-assistant-oauth'),
    getDesktopCompanionRegistration: async () =>
      (await invokeChecked('get-desktop-companion-registration')).registration,
    getDesktopCompanionState: () => invoke('get-desktop-companion-state'),
    applyDesktopCompanionCommand: async (action) =>
      (await invokeChecked('apply-desktop-companion-command', action)).state,
    debugLog: (payload) => invoke('debug-log', payload),

    onHotkeyTriggered: (callback) => subscribe('hotkey-triggered', callback),
    onHotkeyRegistrationFailed: (callback) => subscribe('hotkey-registration-failed', callback),
    onAutoUpdate: (callback) => subscribe('auto-update', callback),
    onOpenSettings: (callback) => subscribe('open-settings', callback, { includeData: false }),
    onProfileSyncStatus: (callback) => subscribe('profile-sync-status', callback),
    onConfigUpdated: subscribeConfigUpdated,
    onConfigPersistenceWarning: (callback) => subscribe('config-persistence-warning', callback),
    onDesktopPinUpdate: (callback) => subscribe('desktop-pin-update', callback),
    onDesktopPinActionRequested: (callback) => subscribe('desktop-pin-action-requested', callback),
    onEntityTileHotkeyRequested: (callback) => subscribe('entity-tile-hotkey-requested', callback),
    onDesktopCompanionStateChanged: (callback) =>
      subscribe('desktop-companion-state-changed', callback),
  };
}

module.exports = { createElectronApi };

/**
 * @jest-environment node
 */

const { EventEmitter } = require('events');

const { createElectronApi } = require('../../src/preload-api.cjs');

describe('preload Electron API', () => {
  function createIpcRenderer() {
    const ipcRenderer = new EventEmitter();
    ipcRenderer.invoke = jest.fn(async (channel, ...args) => ({ channel, args }));
    jest.spyOn(ipcRenderer, 'on');
    jest.spyOn(ipcRenderer, 'removeListener');
    return ipcRenderer;
  }

  it('maps renderer methods to the intended IPC channels and arguments', async () => {
    const ipcRenderer = createIpcRenderer();
    const api = createElectronApi(ipcRenderer, 'test-platform');
    const objectArg = { value: true };
    const cases = [
      ['signalRendererReady', [], 'renderer-ready', []],
      ['getConfig', [], 'get-config', []],
      ['getLocaleBootstrap', [], 'get-locale-bootstrap', []],
      ['getLocalePacks', [], 'get-locale-packs', [false]],
      ['getLocalePacks', [true], 'get-locale-packs', [true]],
      ['downloadLocalePack', ['fr'], 'download-locale-pack', ['fr']],
      ['removeLocalePack', ['fr'], 'remove-locale-pack', ['fr']],
      ['updateConfig', [objectArg], 'update-config', [objectArg]],
      ['clearTokenResetReason', [], 'clear-token-reset-reason', []],
      ['saveConfig', [objectArg], 'save-config', [objectArg]],
      ['pinEntityToDesktop', ['light.office'], 'pin-entity-to-desktop', ['light.office', null]],
      ['unpinEntityFromDesktop', ['light.office'], 'unpin-entity-from-desktop', ['light.office']],
      ['setDesktopPinEditMode', [true], 'set-desktop-pin-edit-mode', [true]],
      [
        'updateDesktopPinBounds',
        ['light.office', objectArg],
        'update-desktop-pin-bounds',
        ['light.office', objectArg],
      ],
      [
        'syncDesktopPinContentMinBounds',
        ['light.office', objectArg],
        'sync-desktop-pin-content-min-bounds',
        ['light.office', objectArg],
      ],
      ['getDesktopPinBootstrap', ['light.office'], 'get-desktop-pin-bootstrap', ['light.office']],
      ['publishHaSnapshot', [objectArg], 'publish-ha-snapshot', [objectArg]],
      ['publishHaEntityUpdate', [objectArg], 'publish-ha-entity-update', [objectArg]],
      [
        'requestDesktopPinAction',
        ['light.office', 'focus-main', objectArg],
        'request-desktop-pin-action',
        ['light.office', 'focus-main', objectArg],
      ],
      [
        'respondDesktopPinActionRequest',
        ['request-1', objectArg],
        'desktop-pin-action-response',
        ['request-1', objectArg],
      ],
      ['showEntityTileMenu', ['light.office'], 'show-entity-tile-menu', ['light.office', null]],
      ['chooseProfileSyncFolder', ['cloudFile'], 'choose-profile-sync-folder', ['cloudFile']],
      ['copyProfileSyncFile', ['/a', '/b'], 'copy-profile-sync-file', ['/a', '/b', false]],
      ['getProfileSyncStatus', [], 'get-profile-sync-status', []],
      ['runProfileSync', ['push'], 'run-profile-sync', ['push']],
      [
        'setProfileSyncPassphrase',
        ['secret', true, true],
        'set-profile-sync-passphrase',
        ['secret', true, true],
      ],
      [
        'setProfileSyncPassphrase',
        ['secret', true],
        'set-profile-sync-passphrase',
        ['secret', true, null],
      ],
      ['clearProfileSyncPassphrase', [], 'clear-profile-sync-passphrase', []],
      ['resolveProfileSyncFirstEnable', ['merge'], 'resolve-profile-sync-first-enable', ['merge']],
      ['setOpacity', [0.8], 'set-opacity', [0.8]],
      ['previewWindowEffects', [objectArg], 'preview-window-effects', [objectArg]],
      ['setAlwaysOnTop', [true], 'set-always-on-top', [true]],
      ['getWindowState', [], 'get-window-state', []],
      ['getLoginItemSettings', [], 'get-login-item-settings', []],
      ['setLoginItemSettings', [true], 'set-login-item-settings', [true]],
      ['minimizeWindow', [], 'minimize-window', []],
      ['focusWindow', [], 'focus-window', []],
      ['focusDesktopPin', ['light.office'], 'focus-desktop-pin', ['light.office']],
      ['restartApp', [], 'restart-app', []],
      ['quitApp', [], 'quit-app', []],
      [
        'registerHotkey',
        ['light.office', 'Ctrl+1', 'toggle'],
        'register-hotkey',
        ['light.office', 'Ctrl+1', 'toggle'],
      ],
      ['unregisterHotkey', ['light.office'], 'unregister-hotkey', ['light.office']],
      ['registerHotkeys', [], 'register-hotkeys', []],
      ['toggleHotkeys', [true], 'toggle-hotkeys', [true]],
      ['validateHotkey', ['Ctrl+1'], 'validate-hotkey', ['Ctrl+1']],
      ['registerPopupHotkey', ['Ctrl+Space'], 'register-popup-hotkey', ['Ctrl+Space']],
      ['unregisterPopupHotkey', [], 'unregister-popup-hotkey', []],
      ['getPopupHotkey', [], 'get-popup-hotkey', []],
      ['isPopupHotkeyAvailable', [], 'is-popup-hotkey-available', []],
      [
        'setEntityAlert',
        ['sensor.temp', objectArg],
        'set-entity-alert',
        ['sensor.temp', objectArg],
      ],
      ['removeEntityAlert', ['sensor.temp'], 'remove-entity-alert', ['sensor.temp']],
      ['toggleAlerts', [true], 'toggle-alerts', [true]],
      ['checkForUpdates', [], 'check-for-updates', []],
      ['quitAndInstall', [], 'quit-and-install', []],
      ['getAppVersion', [], 'get-app-version', []],
      ['openLogs', [], 'open-logs', []],
      ['openExternal', ['https://example.test'], 'open-external', ['https://example.test']],
      [
        'testHaConnection',
        ['https://ha.test', 'token'],
        'test-ha-connection',
        ['https://ha.test', 'token'],
      ],
      [
        'startHomeAssistantOAuth',
        ['https://ha.test'],
        'start-home-assistant-oauth',
        ['https://ha.test'],
      ],
      ['cancelHomeAssistantOAuth', [], 'cancel-home-assistant-oauth', []],
      ['disconnectHomeAssistantOAuth', [], 'disconnect-home-assistant-oauth', []],
      ['getDesktopCompanionRegistration', [], 'get-desktop-companion-registration', []],
      ['getDesktopCompanionState', [], 'get-desktop-companion-state', []],
      ['applyDesktopCompanionCommand', ['toggle'], 'apply-desktop-companion-command', ['toggle']],
      ['debugLog', [objectArg], 'debug-log', [objectArg]],
    ];

    expect(api.platform).toBe('test-platform');
    for (const [method, callArgs, channel, ipcArgs] of cases) {
      ipcRenderer.invoke.mockClear();
      await api[method](...callArgs);
      expect(ipcRenderer.invoke).toHaveBeenCalledWith(channel, ...ipcArgs);
    }
  });

  it('forwards event data and removes exactly the registered listener', () => {
    const ipcRenderer = createIpcRenderer();
    const api = createElectronApi(ipcRenderer, 'test-platform');
    const listeners = [
      ['onHotkeyTriggered', 'hotkey-triggered'],
      ['onHotkeyRegistrationFailed', 'hotkey-registration-failed'],
      ['onAutoUpdate', 'auto-update'],
      ['onProfileSyncStatus', 'profile-sync-status'],
      ['onConfigUpdated', 'config-updated'],
      ['onConfigPersistenceWarning', 'config-persistence-warning'],
      ['onDesktopPinUpdate', 'desktop-pin-update'],
      ['onDesktopPinActionRequested', 'desktop-pin-action-requested'],
      ['onEntityTileHotkeyRequested', 'entity-tile-hotkey-requested'],
      ['onDesktopCompanionStateChanged', 'desktop-companion-state-changed'],
    ];

    for (const [method, channel] of listeners) {
      const callback = jest.fn();
      const cleanup = api[method](callback);
      const handler = ipcRenderer.on.mock.calls.at(-1)[1];

      ipcRenderer.emit(channel, {}, { channel });
      expect(callback).toHaveBeenCalledWith({ channel });

      cleanup();
      expect(ipcRenderer.removeListener).toHaveBeenCalledWith(channel, handler);
      callback.mockClear();
      ipcRenderer.emit(channel, {}, { channel });
      expect(callback).not.toHaveBeenCalled();
    }
  });

  it('supports payload-free events and rejects invalid callbacks', () => {
    const ipcRenderer = createIpcRenderer();
    const api = createElectronApi(ipcRenderer, 'test-platform');
    const callback = jest.fn();
    const cleanup = api.onOpenSettings(callback);

    ipcRenderer.emit('open-settings', { ignored: true }, { ignored: true });
    expect(callback).toHaveBeenCalledWith();
    cleanup();

    expect(() => api.onHotkeyTriggered(null)).toThrow(
      'hotkey-triggered listener requires a callback'
    );
    expect(() => api.onConfigUpdated(null)).toThrow('config-updated listener requires a callback');
  });

  it('shares one config listener across subscribers and removes it after the last cleanup', () => {
    const ipcRenderer = createIpcRenderer();
    const api = createElectronApi(ipcRenderer, 'test-platform');
    const firstCallback = jest.fn();
    const secondCallback = jest.fn();

    const cleanupFirst = api.onConfigUpdated(firstCallback);
    const cleanupSecond = api.onConfigUpdated(secondCallback);
    expect(ipcRenderer.on).toHaveBeenCalledTimes(1);

    ipcRenderer.emit('config-updated', {}, { configRevision: 1 });
    expect(firstCallback).toHaveBeenCalledTimes(1);
    expect(secondCallback).toHaveBeenCalledTimes(1);

    cleanupFirst();
    expect(ipcRenderer.removeListener).not.toHaveBeenCalled();
    ipcRenderer.emit('config-updated', {}, { configRevision: 2 });
    expect(firstCallback).toHaveBeenCalledTimes(1);
    expect(secondCallback).toHaveBeenCalledTimes(2);

    cleanupSecond();
    expect(ipcRenderer.removeListener).toHaveBeenCalledWith('config-updated', expect.any(Function));
  });

  it('buffers config echoes until concurrent renderer mutations settle and drops stale revisions', async () => {
    const ipcRenderer = createIpcRenderer();
    const resolvers = [];
    ipcRenderer.invoke.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolvers.push(resolve);
        })
    );
    const api = createElectronApi(ipcRenderer, 'test-platform');
    const callback = jest.fn();
    api.onConfigUpdated(callback);

    const firstUpdate = api.updateConfig({ favoriteEntities: ['light.first'] });
    const secondUpdate = api.updateConfig({ favoriteEntities: ['light.second'] });
    ipcRenderer.emit('config-updated', {}, { homeAssistant: {}, configRevision: 2 });
    ipcRenderer.emit('config-updated', {}, { homeAssistant: {}, configRevision: 1 });
    expect(callback).not.toHaveBeenCalled();

    resolvers[0]({ homeAssistant: {}, configRevision: 1 });
    await firstUpdate;
    expect(callback).not.toHaveBeenCalled();

    resolvers[1]({ homeAssistant: {}, configRevision: 2 });
    await secondUpdate;
    expect(callback).toHaveBeenCalledTimes(1);
    expect(callback).toHaveBeenLastCalledWith(expect.objectContaining({ configRevision: 2 }));

    ipcRenderer.emit('config-updated', {}, { homeAssistant: {}, configRevision: 1 });
    expect(callback).toHaveBeenCalledTimes(1);
  });

  it('drops a deferred config echo older than the authoritative failed-write revision', async () => {
    const ipcRenderer = createIpcRenderer();
    let rejectUpdate;
    ipcRenderer.invoke.mockImplementation(
      () =>
        new Promise((_resolve, reject) => {
          rejectUpdate = reject;
        })
    );
    const api = createElectronApi(ipcRenderer, 'test-platform');
    const callback = jest.fn();
    api.onConfigUpdated(callback);

    const update = api.updateConfig({ theme: 'dark' });
    ipcRenderer.emit('config-updated', {}, { theme: 'light', configRevision: 4 });

    const error = new Error('disk unavailable');
    error.result = { config: { theme: 'dark', configRevision: 5 } };
    rejectUpdate(error);

    await expect(update).rejects.toBe(error);
    expect(callback).not.toHaveBeenCalled();

    ipcRenderer.emit('config-updated', {}, { theme: 'dark', configRevision: 6 });
    expect(callback).toHaveBeenCalledWith({ theme: 'dark', configRevision: 6 });
  });

  it('uses an IPC channel fallback when a checked failure has no message', async () => {
    const ipcRenderer = createIpcRenderer();
    ipcRenderer.invoke.mockResolvedValue({ success: false });
    const api = createElectronApi(ipcRenderer, 'test-platform');

    await expect(api.setOpacity(0.5)).rejects.toMatchObject({
      message: 'set-opacity failed',
      result: { success: false },
    });
  });

  it.each([
    ['updateConfig', [{ theme: 'dark' }], 'update-config'],
    ['clearTokenResetReason', [], 'clear-token-reset-reason'],
    ['saveConfig', [{ theme: 'dark' }], 'save-config'],
    ['clearProfileSyncPassphrase', [], 'clear-profile-sync-passphrase'],
    ['startHomeAssistantOAuth', ['https://ha.test'], 'start-home-assistant-oauth'],
    ['cancelHomeAssistantOAuth', [], 'cancel-home-assistant-oauth'],
    ['disconnectHomeAssistantOAuth', [], 'disconnect-home-assistant-oauth'],
    ['getDesktopCompanionRegistration', [], 'get-desktop-companion-registration'],
    ['applyDesktopCompanionCommand', ['show'], 'apply-desktop-companion-command'],
    ['restartApp', [], 'restart-app'],
  ])(
    'rejects %s when the main-process persistence contract reports failure',
    async (method, args, channel) => {
      const ipcRenderer = createIpcRenderer();
      ipcRenderer.invoke.mockResolvedValue({
        success: false,
        error: 'disk unavailable',
        config: { homeAssistant: {} },
      });
      const api = createElectronApi(ipcRenderer, 'test-platform');

      await expect(api[method](...args)).rejects.toMatchObject({
        message: 'disk unavailable',
        result: expect.objectContaining({ success: false }),
      });
      expect(ipcRenderer.invoke).toHaveBeenCalledWith(channel, ...args);
    }
  );
});

describe('preload bootstrap', () => {
  it('exposes the created API through contextBridge', () => {
    jest.resetModules();
    const contextBridge = { exposeInMainWorld: jest.fn() };
    const ipcRenderer = { invoke: jest.fn(), on: jest.fn(), removeListener: jest.fn() };
    jest.doMock('electron', () => ({ contextBridge, ipcRenderer }));

    require('../../preload.js');

    expect(contextBridge.exposeInMainWorld).toHaveBeenCalledWith(
      'electronAPI',
      expect.objectContaining({ platform: process.platform, getConfig: expect.any(Function) })
    );
  });
});

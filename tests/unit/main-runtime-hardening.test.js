const fs = require('fs');
const path = require('path');

const mainSource = fs.readFileSync(path.resolve(__dirname, '../../main.js'), 'utf8');
const stylesSource = fs.readFileSync(path.resolve(__dirname, '../../styles.css'), 'utf8');

describe('main-process wiring safeguards', () => {
  it('denies renderer-created windows and routes http/https navigation externally', () => {
    expect(mainSource).toContain('function hardenRendererNavigation');
    expect(mainSource).toContain('setWindowOpenHandler');
    expect(mainSource).toContain("return { action: 'deny' }");
    expect(mainSource).toContain("webContents.on('will-navigate'");
    expect(mainSource).toContain('routeExternalHttpLink(url)');
    expect(mainSource).toContain('shell.openExternal');
    expect(mainSource).toContain("webContents.on('select-bluetooth-device'");
  });

  it('installs a default-deny session permission policy before creating renderers', () => {
    expect(mainSource).toContain("require('./src/session-permissions.cjs')");
    expect(mainSource).toContain('function isTrustedAppWebContents');
    expect(mainSource).toContain('candidate === mainWindow.webContents');
    expect(mainSource).toContain('candidate === pinWindow.webContents');

    const readyStart = mainSource.indexOf('app\n  .whenReady()');
    const installPolicy = mainSource.indexOf(
      'installSessionPermissionPolicy(session.defaultSession',
      readyStart
    );
    const createWindow = mainSource.indexOf('createWindow();', installPolicy);
    expect(installPolicy).toBeGreaterThan(readyStart);
    expect(createWindow).toBeGreaterThan(installPolicy);
  });

  it('runs Wayland sessions through XWayland and keeps the recovery discoverable', () => {
    expect(mainSource).toContain('shouldForceX11OzonePlatform({');
    expect(mainSource).toContain('const waylandSession = isWaylandSession();');
    expect(mainSource).toContain('waylandSession,');
    expect(mainSource).toContain("app.commandLine.appendSwitch('ozone-platform', 'x11')");
    // The popup presenter must know whether it can position the window at all.
    expect(mainSource).toContain('supportsWindowPositioning: !usesCompositorOwnedPlacement');
    expect(mainSource).toContain("app.on('child-process-gone'");
    expect(mainSource).toContain('NATIVE_WAYLAND_ENV_OVERRIDE');
    // A machine where XWayland cannot render must end up on Wayland, not with no window.
    expect(mainSource).toContain(
      "app.relaunch({ args: process.argv.slice(1).concat('--ozone-platform=wayland') })"
    );
    expect(mainSource).toContain('forcedX11FallbackStarted');
    // The verdict is remembered so a machine without working XWayland stops paying for it.
    expect(mainSource).toContain('XWAYLAND_UNAVAILABLE_MARKER_PATH');
    expect(mainSource).toContain('previousAttemptFailed: hasXWaylandFailureMarker()');
    // A saved position on a disconnected monitor must not open the widget off-screen.
    expect(mainSource).toContain('clampPositionToWorkAreas(');
    // Window rules match on the title, so it has to be stable and not follow the page.
    expect(mainSource).toContain("const MAIN_WINDOW_TITLE = 'HA Desktop Widget'");
    expect(mainSource).toContain('title: MAIN_WINDOW_TITLE');
    expect(mainSource).toContain("mainWindow.on('page-title-updated'");
    // The tray is another way in, so it must use the same raise rather than a bare show().
    expect(mainSource).toContain('function showMainWindowFromTray');
    expect(mainSource).toContain('function hideMainWindowToTray');
    // Minimize is routed through hide(), so the one 'hide' listener has to cover every way
    // the widget leaves the screen or a raise stays armed after it is gone.
    expect(mainSource).toContain("mainWindow.on('hide'");
    expect(mainSource).toContain("mainWindow.on('blur'");
    expect(mainSource).toContain('popupWindowPresenter.handleWindowBlur(mainWindow)');
    expect(mainSource).toContain('shouldReleaseElevationOnBlur: () =>');
    const trayMenuStart = mainSource.indexOf('function buildTrayContextMenu');
    const trayMenuEnd = mainSource.indexOf('function createTray', trayMenuStart);
    const traySource = mainSource.slice(trayMenuStart, mainSource.indexOf('const contextMenu'));
    expect(trayMenuEnd).toBeGreaterThan(trayMenuStart);
    expect(traySource).not.toContain('mainWindow.show()');
    // Desktop pins must keep Chromium's default title, or a window rule written for the widget
    // would match them too and drag them to the widget's remembered position.
    const pinOptionsStart = mainSource.indexOf('function createDesktopPinWindow');
    const pinOptionsEnd = mainSource.indexOf(
      'hardenRendererNavigation(pinWindow)',
      pinOptionsStart
    );
    expect(pinOptionsEnd).toBeGreaterThan(pinOptionsStart);
    expect(mainSource.slice(pinOptionsStart, pinOptionsEnd)).not.toContain('MAIN_WINDOW_TITLE');
    // The XWayland marker must resolve from the settled user data path, so the climate demo's
    // throwaway profile cannot read or write the real one.
    expect(mainSource).toContain(
      "const XWAYLAND_UNAVAILABLE_MARKER_PATH = path.join(userDataPath, 'xwayland-unavailable')"
    );
    expect(mainSource.indexOf('const userDataPath = app.getPath')).toBeLessThan(
      mainSource.indexOf('XWAYLAND_UNAVAILABLE_MARKER_PATH')
    );
  });

  it('runs one widget per profile and shows the existing window on a second launch', () => {
    expect(mainSource).toContain('const gotSingleInstanceLock = app.requestSingleInstanceLock()');
    expect(mainSource).toContain("app.on('second-instance'");
    // The second launch is a request to see the widget, not to build another one.
    const secondInstanceStart = mainSource.indexOf("app.on('second-instance'");
    const secondInstanceSource = mainSource.slice(secondInstanceStart, secondInstanceStart + 400);
    expect(secondInstanceSource).toContain('showMainWindowFromTray()');
    expect(secondInstanceSource).not.toContain('createWindow()');
    // The losing instance must not load config, take the tray, or claim the hotkeys.
    expect(mainSource).toContain('if (!gotSingleInstanceLock) return;');
    const readyStart = mainSource.indexOf('app\n  .whenReady()');
    const readySource = mainSource.slice(readyStart, mainSource.indexOf('loadConfig(', readyStart));
    expect(readySource).toContain('if (!gotSingleInstanceLock) return;');
    // The lock has to be requested after the user data path is settled, so the climate demo's
    // throwaway profile gets its own lock instead of colliding with the real widget.
    expect(mainSource.indexOf('const userDataPath = app.getPath')).toBeLessThan(
      mainSource.indexOf('app.requestSingleInstanceLock()')
    );
  });

  it('handles a correlated desktop-pin action response channel', () => {
    expect(mainSource).toContain("ipcMain.handle('desktop-pin-action-response'");
    expect(mainSource).toContain('pendingDesktopPinActionRequests');
    expect(mainSource).toContain("awaitResponse: normalizedAction === 'service-call'");
  });

  it('registers the streaming custom scheme with the current protocol API', () => {
    expect(mainSource).toContain('stream: true');
    expect(mainSource).toContain('protocol.handle(');
    expect(mainSource).toContain('createHaProtocolHandler({');
    expect(mainSource).not.toContain('protocol.registerStreamProtocol');
  });

  it('keeps Linux popup hotkeys off the native hook and preserves unrelated shortcuts', () => {
    expect(mainSource).toContain('Using Electron globalShortcut for Linux popup hotkeys');
    expect(mainSource).toContain('usesLinuxPopupHotkeyBackend');
    expect(mainSource).toContain(
      "app.commandLine.appendSwitch('enable-features', 'GlobalShortcutsPortal')"
    );
    expect(mainSource).toContain('linuxPopupHotkeyController.register(config.popupHotkey)');
    expect(mainSource).toContain('registeredEntityHotkeyAccelerators');
    expect(mainSource).toContain('findConfiguredEntityHotkey(hotkey)');
    expect(mainSource).toContain('Hotkey already assigned to the popup trigger');
    expect(mainSource).not.toContain('globalShortcut.unregisterAll()');
  });

  it('does not load the native input hook on Linux (preserves the 3.7.2 crash fix)', () => {
    // uiohook-napi is required only in the non-Linux branch; loading it on Linux is what
    // crashed users before 3.7.2. Guard against anyone re-adding an unconditional require.
    const requireIndex = mainSource.indexOf("require('uiohook-napi')");
    expect(requireIndex).toBeGreaterThanOrEqual(0);
    const guardIndex = mainSource.lastIndexOf('if (usesLinuxPopupHotkeyBackend) {', requireIndex);
    const elseIndex = mainSource.lastIndexOf('} else {', requireIndex);
    // The require must sit inside the `else` of the usesLinuxPopupHotkeyBackend gate.
    expect(elseIndex).toBeGreaterThan(guardIndex);
    expect(guardIndex).toBeGreaterThanOrEqual(0);

    const registrationStart = mainSource.indexOf('function registerPopupHotkey');
    const registrationEnd = mainSource.indexOf('function unregisterPopupHotkey', registrationStart);
    const registrationSource = mainSource.slice(registrationStart, registrationEnd);
    expect(mainSource).toContain('function cleanupUiohookPopupHotkeyRuntime');
    expect(registrationSource).toContain('cleanupUiohookPopupHotkeyRuntime()');
  });

  it('routes Wayland global hotkeys through the portal while X11 keeps globalShortcut', () => {
    // Wayland: globalShortcut is a silent no-op, so entity + popup hotkeys use the portal.
    expect(mainSource).toContain("require('./src/portal-global-shortcuts.cjs')");
    expect(mainSource).toContain('function initPortalShortcutsBackend');
    // The portal only activates on a Linux Wayland session; X11/other keep globalShortcut.
    expect(mainSource).toContain('if (!usesCompositorOwnedPlacement) return;');
    expect(mainSource).toContain('handlePortalShortcutActivated');
    expect(mainSource).toContain('portalShortcutsActive');
    expect(mainSource).toContain('portalShortcutsInitPromise');
    expect(mainSource).toContain('await ensurePortalShortcutsBackendInitialized()');
    expect(mainSource).toContain(
      'The desktop does not provide the Global Shortcuts portal required on Wayland'
    );
    // Digit hotkeys (Alt+1) must map to the real uiohook key names, not the absent DigitN.
    expect(mainSource).toContain("1: UiohookKey['1']");
    expect(mainSource).not.toMatch(/UiohookKey\.Digit\d/);

    const activationStart = mainSource.indexOf('function handlePortalShortcutActivated');
    const activationEnd = mainSource.indexOf('function collectPortalShortcuts', activationStart);
    const activationSource = mainSource.slice(activationStart, activationEnd);
    expect(activationSource).toContain("if (!String(config?.popupHotkey || '').trim()) return;");
    expect(
      activationSource.indexOf("if (!String(config?.popupHotkey || '').trim()) return;")
    ).toBeLessThan(activationSource.indexOf('linuxPopupHotkeyController.handleShortcut()'));
  });

  it('persists a replacement popup hotkey only after successful registration', () => {
    const handlerStart = mainSource.indexOf("'register-popup-hotkey'");
    const handlerEnd = mainSource.indexOf("'unregister-popup-hotkey'", handlerStart);
    const handlerSource = mainSource.slice(handlerStart, handlerEnd);

    expect(handlerSource).toContain('const previousHotkey = config.popupHotkey');
    expect(handlerSource).toContain('if (!registrationResult.success)');
    expect(handlerSource).toContain('await Promise.resolve(unregisterPopupHotkey())');
    expect(handlerSource).toContain('config.popupHotkey = previousHotkey');
    expect(handlerSource.indexOf('saveConfigDurably()')).toBeGreaterThan(
      handlerSource.indexOf('if (!registrationResult.success)')
    );
  });

  it('uses target-specific registration success while keeping portal transactions authoritative', () => {
    const handlerStart = mainSource.indexOf("'register-hotkey'");
    const handlerEnd = mainSource.indexOf("'unregister-hotkey'", handlerStart);
    const handlerSource = mainSource.slice(handlerStart, handlerEnd);

    expect(handlerSource).toContain('await syncPortalShortcuts({ immediate: true })');
    expect(handlerSource).toContain('registrationResult.success && !!portalBinding?.trigger');
    expect(handlerSource).toContain(
      ': !usesCompositorOwnedPlacement && globalShortcut.isRegistered(hotkey)'
    );
    expect(handlerSource).not.toContain(
      'registrationResult?.success !== false && globalShortcut.isRegistered(hotkey)'
    );
    expect(handlerSource.indexOf('saveConfigDurably()')).toBeGreaterThan(
      handlerSource.indexOf('if (!registered)')
    );
  });

  it('keeps native Wayland minimize and compositor-owned positions recoverable', () => {
    const minimizeStart = mainSource.indexOf("ipcMain.handle('minimize-window'");
    const minimizeEnd = mainSource.indexOf("ipcMain.handle('focus-window'", minimizeStart);
    const minimizeSource = mainSource.slice(minimizeStart, minimizeEnd);
    expect(minimizeSource).toContain('if (usesCompositorOwnedPlacement)');
    expect(minimizeSource).toContain('hideMainWindowToTray()');
    expect(minimizeSource).toContain('mainWindow.minimize()');

    const changeWindowStart = mainSource.indexOf('const changeWin = () =>');
    const changeWindowEnd = mainSource.indexOf(
      '// Save position when window is moved',
      changeWindowStart
    );
    const changeWindowSource = mainSource.slice(changeWindowStart, changeWindowEnd);
    expect(changeWindowSource).toContain('if (!usesCompositorOwnedPlacement)');
    expect(changeWindowSource.indexOf('config.windowPosition')).toBeGreaterThan(
      changeWindowSource.indexOf('if (!usesCompositorOwnedPlacement)')
    );

    const createWindowStart = mainSource.indexOf('function createWindow()');
    const browserWindowCreation = mainSource.indexOf(
      'mainWindow = new BrowserWindow(windowOptions)',
      createWindowStart
    );
    const createWindowSource = mainSource.slice(createWindowStart, browserWindowCreation);
    expect(createWindowSource).toContain('const positionOptions = {}');
    expect(createWindowSource).toContain('if (!usesCompositorOwnedPlacement)');
    expect(createWindowSource).toContain('...positionOptions');

    const trayStart = mainSource.indexOf('function buildTrayContextMenu');
    const trayEnd = mainSource.indexOf('function createTray', trayStart);
    const traySource = mainSource.slice(trayStart, trayEnd);
    expect(traySource).toContain('enabled: !usesCompositorOwnedPlacement');
    expect(traySource).toContain('if (usesCompositorOwnedPlacement) return;');

    const clampStart = mainSource.indexOf('function clampDesktopPinBounds(');
    const clampEnd = mainSource.indexOf('function applyDesktopPinBoundsToWindow', clampStart);
    const clampSource = mainSource.slice(clampStart, clampEnd);
    expect(clampSource).toContain('if (usesCompositorOwnedPlacement)');
    expect(clampSource).toContain('Number.isFinite(Number(bounds.x))');
    expect(clampSource).toContain('clampedBounds.x = Math.round(Number(bounds.x))');
    expect(mainSource).toContain('shouldUseCompositorOwnedPlacement({');
  });

  it('requires a modifier for user-configured global accelerators', () => {
    const validationStart = mainSource.indexOf('function validateHotkey');
    const validationEnd = mainSource.indexOf(
      'function findConfiguredEntityHotkey',
      validationStart
    );
    const validationSource = mainSource.slice(validationStart, validationEnd);
    expect(validationSource).toContain('const hasModifier =');
    expect(validationSource).toContain('if (!hasModifier || nonModifiers.length !== 1');
  });

  it('preserves persisted desktop pins during config normalization even when favorites are stale', () => {
    const start = mainSource.indexOf('function normalizeDesktopPinsConfig');
    const end = mainSource.indexOf('function resolveDesktopPinSupportDecision');
    const normalizeDesktopPinsConfigSource = mainSource.slice(start, end);

    expect(normalizeDesktopPinsConfigSource).toContain('targetConfig.desktopPins = nextPins');
    expect(normalizeDesktopPinsConfigSource).not.toContain('favoriteSet.has');
  });

  it('backs up config before first write and blocks writes only after an unsafe load', () => {
    expect(mainSource).toContain('ensureConfigBackupBeforeFirstWrite');
    expect(mainSource).toContain('configBackupCreatedThisRun');
    expect(mainSource).toContain('shouldBlockPotentialConfigClobber');
    expect(mainSource).toContain(
      'shouldBlockConfigWrite({ blockedReason: configWriteBlockedReason })'
    );
    expect(mainSource).not.toContain('function hasMeaningfulConfigData');
  });

  it('quarantines malformed config and reports durable persistence failures', () => {
    expect(mainSource).toContain('function quarantineCorruptConfig');
    expect(mainSource).toContain('config.corrupt.${timestamp}.json');
    expect(mainSource).toContain('configRecoveryNotice');
    expect(mainSource).toContain('configWriteBlockedReason');
    expect(mainSource).toContain('Configuration root must be a JSON object');
    expect(mainSource).toContain('async function saveConfigDurably');

    const updateStart = mainSource.indexOf("'update-config'");
    const updateEnd = mainSource.indexOf("'clear-token-reset-reason'", updateStart);
    const updateSource = mainSource.slice(updateStart, updateEnd);
    expect(updateSource).toContain('const persistence = await saveConfigDurably');
    expect(updateSource).toContain('success: false');
    expect(updateSource).toContain('config = prevConfig');
    expect(mainSource).toContain('cloned.configRevision = configSnapshotVersion');
    expect(mainSource).toContain('delete target.configRevision');
  });

  it('does not turn durable config changes into rejected IPC when runtime refreshes fail', () => {
    expect(mainSource).toContain('async function runPostSaveSideEffect');

    const pinStart = mainSource.indexOf('async function pinEntityToDesktopInternal');
    const pinEnd = mainSource.indexOf('async function unpinEntityFromDesktopInternal', pinStart);
    const pinSource = mainSource.slice(pinStart, pinEnd);
    expect(pinSource).toContain(
      "runPostSaveSideEffect(runtimeWarnings, 'desktop pin window creation'"
    );
    expect(pinSource).toContain('...(runtimeWarnings.length ? { runtimeWarnings } : {})');

    const deprecatedStart = mainSource.indexOf("'save-config'");
    const deprecatedEnd = mainSource.indexOf("'toggle-hotkeys'", deprecatedStart);
    const deprecatedSource = mainSource.slice(deprecatedStart, deprecatedEnd);
    expect(deprecatedSource).toContain(
      "error: 'save-config is no longer supported; use update-config'"
    );
    expect(deprecatedSource).not.toContain('config =');

    const syncStart = mainSource.indexOf('async function applySyncedProfileToConfig');
    const syncEnd = mainSource.indexOf('function clearProfileSyncTimers', syncStart);
    expect(mainSource.slice(syncStart, syncEnd)).toContain(
      "runPostSaveSideEffect(runtimeWarnings, 'synced runtime settings'"
    );

    const runtimeStart = mainSource.indexOf('async function applyRuntimeConfigSideEffects');
    const runtimeEnd = mainSource.indexOf('function pushConfigToRenderer', runtimeStart);
    const runtimeSource = mainSource.slice(runtimeStart, runtimeEnd);
    expect(runtimeSource).toContain(
      "failures.push(`portal shortcuts: ${result.error || 'activation failed'}`)"
    );
    expect(runtimeSource).toContain(
      "failures.push(`entity hotkeys: ${result.error || 'activation failed'}`)"
    );
    expect(runtimeSource).toContain(
      "failures.push(`popup hotkey: ${result.error || 'activation failed'}`)"
    );
    expect(runtimeSource).toContain('if (failures.length)');
    expect(runtimeSource).toContain('throw new Error(');
  });

  it('keeps invalid opacity input finite before persisting it', () => {
    const handlerStart = mainSource.indexOf("'set-opacity'");
    const handlerEnd = mainSource.indexOf("'preview-window-effects'", handlerStart);
    const handlerSource = mainSource.slice(handlerStart, handlerEnd);
    expect(handlerSource).toContain('Number.isFinite(requestedOpacity)');
    expect(handlerSource).toContain('Number(previousOpacity) || 1');
  });

  it('does not acknowledge passphrase or recovery mutations before durable persistence', () => {
    const setPassphraseStart = mainSource.indexOf("'set-profile-sync-passphrase'");
    const clearPassphraseStart = mainSource.indexOf(
      "'clear-profile-sync-passphrase'",
      setPassphraseStart
    );
    const resolveStart = mainSource.indexOf(
      "'resolve-profile-sync-first-enable'",
      clearPassphraseStart
    );
    const setPassphraseSource = mainSource.slice(setPassphraseStart, clearPassphraseStart);
    const clearPassphraseSource = mainSource.slice(clearPassphraseStart, resolveStart);

    expect(setPassphraseSource).toContain('const persistence = await saveConfigDurably()');
    expect(setPassphraseSource).toContain(
      'profileSync.storedPassphrase = previous.storedPassphrase'
    );
    expect(clearPassphraseSource).toContain('const persistence = await saveConfigDurably()');
    expect(clearPassphraseSource).toContain(
      'profileSyncRuntime.passphraseSession = previous.passphraseSession'
    );
  });

  it('keeps credential metadata main-owned across the config/passphrase IPC boundary', () => {
    const updateStart = mainSource.indexOf("'update-config'");
    const updateEnd = mainSource.indexOf("'clear-token-reset-reason'", updateStart);
    const updateSource = mainSource.slice(updateStart, updateEnd);

    expect(updateSource).toContain('const previousPassphraseMetadata = {');
    expect(updateSource).toContain('Object.assign(profileSync, previousPassphraseMetadata)');
    expect(updateSource).toContain('resolveProfileSyncEncryptionRequest({');
    expect(mainSource).toContain('encryptionChangePending');
  });

  it('uses a crash-recoverable exact transaction for active key rewrites', () => {
    expect(mainSource).toContain('async function stageProfileSyncRewrite');
    expect(mainSource).toContain('oldPassphraseEncrypted');
    expect(mainSource).toContain('newPassphraseEncrypted');
    expect(mainSource).toContain('targetEnvelopeSerialized');
    expect(mainSource).toContain('targetRemoteIdentity');
    expect(mainSource).toContain('runProfileSyncRewriteRecovery({');
    expect(mainSource).toContain('await executePendingProfileSyncRewrite();');
    expect(mainSource).toContain("source === 'startup_rewrite_recovery'");
    expect(mainSource).toContain('if (profileSync.passphraseTransition) {');
  });

  it('re-arms conflict preparation when an enabled sync target changes', () => {
    const updateStart = mainSource.indexOf("'update-config'");
    const updateEnd = mainSource.indexOf("'clear-token-reset-reason'", updateStart);
    const updateSource = mainSource.slice(updateStart, updateEnd);

    expect(updateSource).toContain('const remoteTargetChanged =');
    expect(updateSource).toContain('normalizedNextProvider !== previousProvider');
    expect(updateSource).toContain('normalizedNextPath !== previousCloudFilePath');
    expect(updateSource).toContain('const requiresInitialPreparation =');
    expect(updateSource).toContain('profileSync.firstEnableResolutionPending = true');
    expect(updateSource).toContain('prepareProfileSyncFirstEnableResolution()');
  });

  it('flushes the latest config before restart can bypass before-quit', () => {
    const restartStart = mainSource.indexOf("'restart-app'");
    const restartEnd = mainSource.indexOf("ipcMain.handle('minimize-window'", restartStart);
    const restartSource = mainSource.slice(restartStart, restartEnd);
    expect(restartSource).toContain("await flushConfigForBoundedExit('restarting')");
    expect(restartSource.indexOf('app.relaunch()')).toBeLessThan(
      restartSource.indexOf('app.exit(0)')
    );

    const boundedExitStart = mainSource.indexOf('async function flushConfigForBoundedExit');
    const boundedExitEnd = mainSource.indexOf(
      'function shutDownRuntimeAfterConfigFlush',
      boundedExitStart
    );
    const boundedExitSource = mainSource.slice(boundedExitStart, boundedExitEnd);
    expect(boundedExitSource).toContain('capturePendingWindowBoundsForShutdown()');
    expect(boundedExitSource.indexOf('saveConfig({ allowDebouncedPush: false })')).toBeLessThan(
      boundedExitSource.indexOf('flushPendingConfigWriteSync({ shutdown: true })')
    );
    expect(boundedExitSource).toContain('QUIT_FINALIZATION_TIMEOUT');
    expect(boundedExitSource).toContain('void finalization');
    expect(boundedExitSource).toContain('setupProfileSyncInterval()');

    const asyncWriteStart = mainSource.indexOf('async function writeConfigSnapshotAsync');
    const asyncWriteEnd = mainSource.indexOf(
      'function emitConfigPersistenceWarnings',
      asyncWriteStart
    );
    const asyncWriteSource = mainSource.slice(asyncWriteStart, asyncWriteEnd);
    expect(asyncWriteSource).toContain('canCommitSnapshot(snapshot');
    expect(asyncWriteSource).toContain('currentEpoch: configWriteEpoch');
    expect(asyncWriteSource).toContain('fs.renameSync(snapshot.tempPath, snapshot.configPath)');
    expect(asyncWriteSource).not.toContain(
      'await fs.promises.rename(snapshot.tempPath, snapshot.configPath)'
    );

    const quitStart = mainSource.indexOf("app.on('before-quit'");
    const quitEnd = mainSource.indexOf('// Register custom protocol', quitStart);
    const quitSource = mainSource.slice(quitStart, quitEnd);
    expect(quitSource).toContain("flushConfigForBoundedExit('quitting')");
  });

  it('runs packaged smoke tests in an isolated profile and fails closed on startup errors', () => {
    expect(mainSource).toContain("process.argv.includes('--smoke-test')");
    expect(mainSource).toContain('SMOKE_TEST_PROFILE_PREFIX');
    expect(mainSource).toContain('removeSmokeTestProfile(smokeTestUserDataPath');
    expect(mainSource).toContain('function startSmokeTestTimeout');
    expect(mainSource).toContain("'did-fail-load'");
    expect(mainSource).toContain("mainWindow.webContents.on('render-process-gone'");
    expect(mainSource).toContain('smokeTestRendererLoaded &&');
    expect(mainSource).toContain('smokeTestRendererReady &&');
    expect(mainSource).toContain('smokeTestTrayReady &&');
    expect(mainSource).toContain("ipcMain.handle('renderer-ready'");
    expect(mainSource).toContain('smokeTestRendererReady = true');
    expect(mainSource).toContain('HA_WIDGET_SMOKE_TEST_OK');
    expect(mainSource).toContain('app.exit(success ? 0 : 1)');
    expect(mainSource).toContain('setImmediate(async () =>');
    expect(mainSource).toContain('await session.defaultSession.flushStorageData()');
    expect(mainSource).toContain(
      'error = `Failed to remove isolated smoke-test profile: ${cleanup.error}`'
    );
  });

  it('defers secure config resolution until after the first window can render', () => {
    expect(mainSource).toContain('loadConfig({ deferSecureStorage: true });');
    expect(mainSource).toContain('runSerializedConfigMutation(() =>');
    expect(mainSource).toContain('resolveDeferredSecureConfig({ notifyRenderer: true })');

    const getConfigStart = mainSource.indexOf("ipcMain.handle('get-config'");
    const getConfigEnd = mainSource.indexOf(
      "ipcMain.handle('get-locale-bootstrap'",
      getConfigStart
    );
    const getConfigSource = mainSource.slice(getConfigStart, getConfigEnd);
    expect(getConfigSource).not.toContain('resolveDeferredSecureConfig');

    const desktopPinBootstrapStart = mainSource.indexOf(
      "ipcMain.handle('get-desktop-pin-bootstrap'"
    );
    const desktopPinBootstrapEnd = mainSource.indexOf(
      "ipcMain.handle('publish-ha-snapshot'",
      desktopPinBootstrapStart
    );
    const desktopPinBootstrapSource = mainSource.slice(
      desktopPinBootstrapStart,
      desktopPinBootstrapEnd
    );
    expect(desktopPinBootstrapSource).not.toContain('resolveDeferredSecureConfig');
  });

  it('loads electron-updater lazily so development startup is not coupled to updater detection', () => {
    expect(mainSource).toContain('function getAutoUpdater()');
    expect(mainSource).toContain("require('electron-updater')");
    expect(mainSource).not.toContain("const { autoUpdater } = require('electron-updater');");
  });

  it('keeps the connected climate demo as a development-only runtime overlay', () => {
    expect(mainSource).toContain('IS_CLIMATE_DEMO_OVERLAY_MODE');
    expect(mainSource).toContain("process.argv.includes('--demo-climate-overlay')");
    expect(mainSource).toContain("cloned.developmentDemo = { climate: true, mode: 'overlay' }");
    expect(mainSource).toContain('delete newConfig.developmentDemo;');
    expect(mainSource).toContain('delete cloned.developmentDemo;');
  });

  it('allows Electron to throttle background renderers', () => {
    expect(mainSource).not.toContain('backgroundThrottling: false');
  });

  it('supports opt-in prerelease update checks without moving stable users to prereleases', () => {
    expect(mainSource).toContain('function configureAutoUpdaterChannel');
    expect(mainSource).toContain('autoUpdater.allowPrerelease = allowPrerelease');
    expect(mainSource).toContain('await autoUpdater.checkForUpdates()');
    expect(mainSource).toContain('function selectPortableRelease');
    expect(mainSource).toContain('allowPrerelease || !release.prerelease');
    expect(mainSource).toContain('releases?per_page=20');
    expect(mainSource).toContain('/releases/latest');
  });

  it('routes tray and renderer update checks through the same package capability guard', () => {
    const trayStart = mainSource.indexOf('function buildTrayContextMenu');
    const trayEnd = mainSource.indexOf('function createTray', trayStart);
    const traySource = mainSource.slice(trayStart, trayEnd);
    const updateCheckStart = mainSource.indexOf('async function checkForUpdatesForCurrentPackage');
    const updateCheckEnd = mainSource.indexOf(
      "ipcMain.handle('quit-and-install'",
      updateCheckStart
    );
    const updateCheckSource = mainSource.slice(updateCheckStart, updateCheckEnd);

    expect(traySource).toContain('checkForUpdatesForCurrentPackage()');
    expect(traySource).not.toContain('getAutoUpdater()');
    expect(traySource).toContain("if (result.status === 'checking') return;");
    expect(
      updateCheckSource.indexOf('supportsAutoUpdater(process.platform, process.env)')
    ).toBeLessThan(updateCheckSource.indexOf('getAutoUpdater()'));
    expect(updateCheckSource).toContain('return checkManualReleaseUpdate()');
    expect(mainSource).toContain('async function checkManualReleaseUpdate()');
    expect(mainSource).toContain("status: 'manual'");
  });

  it('flushes config and pending window bounds before an update closes windows', () => {
    const installStart = mainSource.indexOf("ipcMain.handle('quit-and-install'");
    const installEnd = mainSource.indexOf('// Handle quit request from renderer', installStart);
    const installSource = mainSource.slice(installStart, installEnd);

    expect(installSource).toContain("await flushConfigForBoundedExit('installing the update')");
    expect(
      installSource.indexOf("flushConfigForBoundedExit('installing the update')")
    ).toBeLessThan(installSource.indexOf('autoUpdater.quitAndInstall()'));
    expect(installSource).toContain('quitFinalized = true');
  });

  it('migrates the legacy clock boolean and constrains configurable clock formats', () => {
    expect(mainSource).toContain('function ensureDateTimeFormatConfigDefaults');
    expect(mainSource).toContain("new Set(['system', '12-hour', '24-hour'])");
    expect(mainSource).toContain("new Set(['system', 'weekday-short', 'long', 'numeric'])");
    // Only an explicit 24-hour preference migrates to a fixed format. Migrating the
    // never-chosen `false` to '12-hour' would force hour12 on every 24-hour locale.
    expect(mainSource.replace(/\s+/g, ' ')).toContain(
      "options.migrateLegacyClock === true && target.ui.use24HourClock === true ? '24-hour' : 'system'"
    );
    expect(mainSource).toContain("target.ui.dateFormat = 'weekday-short'");
  });

  it('fails closed for token saves when encryption is unavailable', () => {
    expect(mainSource).toContain('delete configToSave.homeAssistant.token');
    expect(mainSource).toContain('configToSave.tokenResetReason = reason');
    expect(mainSource).toContain('config.tokenResetReason = reason');
    expect(mainSource).toContain(
      'omitting token from saved config so it is not written in plaintext'
    );
    expect(mainSource).not.toContain('Failed to encrypt token, saving as plaintext');

    const loadMigrationStart = mainSource.indexOf(
      'Detected plaintext token from pre-encryption version'
    );
    const loadMigrationEnd = mainSource.indexOf(
      '// Migrate legacy config if present in app directory',
      loadMigrationStart
    );
    const loadMigrationSource = mainSource.slice(loadMigrationStart, loadMigrationEnd);
    const deferredMigrationStart = mainSource.indexOf('Detected plaintext token after startup');
    const deferredMigrationEnd = mainSource.indexOf(
      'if (deferredProfileSyncPassphraseDecryptPending)',
      deferredMigrationStart
    );
    const deferredMigrationSource = mainSource.slice(deferredMigrationStart, deferredMigrationEnd);
    expect(loadMigrationSource).not.toContain("encryptedBuffer.toString('base64')");
    expect(deferredMigrationSource).not.toContain("encryptedBuffer.toString('base64')");
    expect(loadMigrationSource).toContain('const migrationSnapshot = saveConfig()');
    expect(deferredMigrationSource).toContain('const migrationSnapshot = saveConfig()');
  });

  it('guards privileged IPC senders and restricts desktop-pin channels', () => {
    expect(mainSource).toContain('function getAuthorizedIpcSender');
    expect(mainSource).toContain(
      "sender.type === 'desktop-pin' && options.allowDesktopPin === true"
    );
    expect(mainSource).toContain("authorizeIpcSender(event, 'update-config')");
    expect(mainSource).toContain("authorizeIpcSender(event, 'copy-profile-sync-file')");
    expect(mainSource).toContain(
      "authorizeIpcSender(event, 'request-desktop-pin-action', { allowDesktopPin: true })"
    );
    expect(mainSource).toContain('config: createDesktopPinRendererConfig(config)');
    expect(mainSource).toContain('connection: createDesktopPinConnectionState(config');
    expect(mainSource).not.toContain(
      "authorizeIpcSender(event, 'get-config', { allowDesktopPin: true })"
    );
    expect(mainSource).not.toContain(
      "authorizeIpcSender(event, 'publish-ha-snapshot', { allowDesktopPin: true })"
    );
    expect(mainSource).not.toContain(
      "authorizeIpcSender(event, 'publish-ha-entity-update', { allowDesktopPin: true })"
    );
  });

  it('keeps Windows non-glass opacity on renderer background surfaces', () => {
    expect(mainSource).toContain('function shouldUseNativeWindowOpacity');
    expect(mainSource).toContain("process.platform === 'win32'");
    expect(mainSource).toContain('transparent = true;');
    expect(mainSource).toContain(
      'targetWindow.setOpacity(shouldUseNativeWindowOpacity(currentConfig) ? safeOpacity : 1)'
    );
  });

  it('reapplies Windows acrylic after focus and visibility lifecycle changes', () => {
    const start = mainSource.indexOf('function wireWindowEffectsRefresh');
    const end = mainSource.indexOf('function applyDesktopPinWindowEffects');
    const refreshSource = mainSource.slice(start, end);

    expect(start).toBeGreaterThanOrEqual(0);
    expect(refreshSource).toContain("process.platform !== 'win32'");
    expect(refreshSource).toContain("'focus'");
    expect(refreshSource).toContain("'blur'");
    expect(refreshSource).toContain("'show'");
    expect(refreshSource).toContain("'restore'");
    expect(refreshSource).toContain("'enter-full-screen'");
    expect(refreshSource).toContain("'leave-full-screen'");
    expect(refreshSource).toContain(
      'applyWindowEffectsToWindow(targetWindow, currentConfig, overrideFrostedGlass)'
    );
    expect(refreshSource).toContain('setTimeout(refreshEffects, 50)');
    expect(refreshSource).toContain('setTimeout(refreshEffects, 250)');
    expect(mainSource).toContain('wireWindowEffectsRefresh(mainWindow, () => config)');
    expect(mainSource).toContain('wireWindowEffectsRefresh(pinWindow, () => config, false)');
  });

  it('limits non-glass window alpha CSS to background containers', () => {
    const selectorStart = stylesSource.indexOf('body:not(.desktop-pin-mode):not(.frosted-glass),');
    const ruleEnd = stylesSource.indexOf('}', selectorStart);
    const nonGlassBackgroundRule = stylesSource.slice(selectorStart, ruleEnd);

    expect(selectorStart).toBeGreaterThanOrEqual(0);
    expect(nonGlassBackgroundRule).toContain('.widget-header');
    expect(nonGlassBackgroundRule).toContain('.widget-content');
    expect(nonGlassBackgroundRule).not.toContain('.status-card');
    expect(nonGlassBackgroundRule).not.toContain('.media-tile');
    expect(nonGlassBackgroundRule).not.toContain('.control-item');
    expect(stylesSource).not.toMatch(/opacity:\s*var\(--window-opacity/);
  });
});

describe('profile sync runtime safeguards', () => {
  it('reapplies runtime hotkey and alert state after a pulled profile is durable', () => {
    const applyStart = mainSource.indexOf('async function applySyncedProfileToConfig');
    const applyEnd = mainSource.indexOf('function clearProfileSyncTimers', applyStart);
    const applySource = mainSource.slice(applyStart, applyEnd);

    expect(applySource).toContain('await saveConfigDurably({ allowDebouncedPush: false })');
    expect(applySource).toContain(
      "applyRuntimeConfigSideEffects(previous, config, 'profile sync pull')"
    );
    expect(mainSource).toContain('registerGlobalHotkeys()');
    expect(mainSource).toContain('registerPopupHotkey()');
    expect(mainSource).toContain('setupEntityAlerts()');
  });

  it('identifies the post-pull renderer echo by content instead of by timing', () => {
    expect(mainSource).toContain('pendingPullEchoHash');
    expect(mainSource).not.toContain('suppressNextAutoPush');
    expect(mainSource).not.toContain('suppressAutoPushUntil');
    // No timer may gate auto-push: a genuine edit made moments after a pull
    // has to push immediately rather than wait for the 5-minute interval.
    expect(mainSource).not.toContain('PROFILE_SYNC_PULL_ECHO_SUPPRESS_MS');
    expect(mainSource).toContain('nextHash === profileSyncRuntime.pendingPullEchoHash');
  });

  it('leaves the content timestamp behind when it drops a stale pull echo', () => {
    const trackingStart = mainSource.indexOf('function updateLocalProfileSyncTracking');
    const echoBranch = mainSource.indexOf(
      'nextHash === profileSyncRuntime.pendingPullEchoHash',
      trackingStart
    );
    const timestampAdvance = mainSource.indexOf(
      'profileSyncRuntime.localProfileUpdatedAt = new Date().toISOString();',
      echoBranch
    );
    const echoReturn = mainSource.indexOf('return;', echoBranch);

    // The echo branch must return before the timestamp is advanced, otherwise the
    // stale echo looks newer than the remote and the next auto sync pushes it out.
    expect(trackingStart).toBeGreaterThanOrEqual(0);
    expect(echoReturn).toBeGreaterThanOrEqual(0);
    expect(echoReturn).toBeLessThan(timestampAdvance);
  });

  it('reverses a stale renderer config update before it can overwrite a pulled profile', () => {
    expect(mainSource).toContain('function restoreProfileFromStalePullEcho');

    // The guard has to run inside update-config, after the renderer payload is
    // merged and pruned but before the merged config is treated as authoritative.
    const handlerStart = mainSource.indexOf("'update-config'");
    const merge = mainSource.indexOf('config = { ...config, ...newConfig', handlerStart);
    const guard = mainSource.indexOf('restoreProfileFromStalePullEcho(prevConfig)', handlerStart);
    const timestampOverride = mainSource.indexOf(
      'config.profileSync.profileUpdatedAt = prevConfig',
      handlerStart
    );

    expect(handlerStart).toBeGreaterThanOrEqual(0);
    expect(guard).toBeGreaterThan(merge);
    expect(guard).toBeLessThan(timestampOverride);
  });

  it('keeps provider folder probing off the synchronous filesystem API', () => {
    const helperStart = mainSource.indexOf('function getDefaultProfileSyncFolderPath');
    const helperEnd = mainSource.indexOf('\n}', helperStart);
    const helper = mainSource.slice(helperStart, helperEnd);

    expect(helperStart).toBeGreaterThanOrEqual(0);
    expect(helper).not.toContain('statSync');
    expect(helper).toContain('await fs.promises.stat');
  });

  it('re-checks the remote file before overwriting it on push', () => {
    const pushBranch = mainSource.indexOf("if (finalDirection === 'push')");
    const compare = mainSource.indexOf('hasRemoteSyncEnvelopeChanged(remoteResult)', pushBranch);
    const write = mainSource.indexOf('writeConfiguredSyncEnvelope(envelopeToWrite)', pushBranch);

    expect(pushBranch).toBeGreaterThanOrEqual(0);
    expect(compare).toBeGreaterThanOrEqual(0);
    // The compare must precede the write, or it is not a compare-and-swap.
    expect(compare).toBeLessThan(write);
  });

  it('treats an unreadable remote file as changed rather than overwriting it', () => {
    const fnStart = mainSource.indexOf('async function hasRemoteSyncEnvelopeChanged');
    const fnEnd = mainSource.indexOf('\n}', fnStart);
    const fn = mainSource.slice(fnStart, fnEnd);

    expect(fnStart).toBeGreaterThanOrEqual(0);
    // A read failure must fail closed: returning false here would overwrite a
    // file that another device may be midway through replicating.
    expect(fn).toMatch(/catch[\s\S]*?return true;/);
    expect(fn).toContain('getSyncEnvelopeIdentity(currentResult)');
    expect(mainSource).toContain('profileSyncCore.serializeSyncEnvelope(readResult.envelope)');
  });

  it('rate-limits focus and resume triggered syncs', () => {
    const fnStart = mainSource.indexOf('function requestOpportunisticProfileSync');
    const fnEnd = mainSource.indexOf('\n}', fnStart);
    const fn = mainSource.slice(fnStart, fnEnd);

    expect(fnStart).toBeGreaterThanOrEqual(0);
    expect(fn).toContain('PROFILE_SYNC_OPPORTUNISTIC_MIN_GAP_MS');
    expect(fn).toContain('profileSyncRuntime.inFlight');
    expect(mainSource).toContain("mainWindow.on('focus'");
    expect(mainSource).toContain("powerMonitor.on('resume'");
  });

  it('surfaces setups that report success while sharing nothing', () => {
    expect(mainSource).toContain('function collectProfileSyncFolderWarnings');
    expect(mainSource).toContain('unsynced_folder');
    expect(mainSource).toContain('google_drive_linux');
    expect(mainSource).toContain('conflict_copies');
    // Codes, not sentences, so wording stays with the translated renderer text.
    expect(mainSource).toContain('folderWarnings: collectProfileSyncFolderWarnings()');
  });

  it('probes the folder layouts current cloud clients actually use', () => {
    // Drive for Desktop stopped using ~/Google Drive years ago; these are the
    // layouts a real install has today.
    expect(mainSource).toContain('CloudStorage');
    expect(mainSource).toContain('GoogleDrive-');
    expect(mainSource).toContain("'My Drive'");
    // Dropbox and OneDrive both publish their real root, which matters when the
    // user moved the folder off its default location.
    expect(mainSource).toContain("'.dropbox', 'info.json'");
    expect(mainSource).toContain('process.env.OneDrive');
  });

  it('offers the relocated providers in the settings picker', () => {
    const html = fs.readFileSync(path.resolve(__dirname, '../../index.html'), 'utf8');
    ['dropbox', 'oneDrive', 'googleDrive', 'icloudDrive', 'syncthing', 'cloudFile'].forEach(
      (provider) => {
        expect(mainSource).toContain(`'${provider}'`);
        expect(html).toContain(`value="${provider}"`);
      }
    );
  });

  it('tracks profile content changes separately from sync attempt timestamps', () => {
    expect(mainSource).toContain('profileUpdatedAt: null');
    expect(mainSource).toContain('config?.profileSync?.profileUpdatedAt ||');
    expect(mainSource).toContain(
      'config.profileSync.profileUpdatedAt = profileSyncRuntime.localProfileUpdatedAt'
    );
    expect(mainSource).toContain('config.profileSync.profileUpdatedAt = localProfileUpdatedAtSeed');
    // Tracking must run before the snapshot is built so the timestamp lands in
    // the same save instead of trailing one save behind.
    expect(mainSource.indexOf('updateLocalProfileSyncTracking();')).toBeLessThan(
      mainSource.indexOf('pendingConfigSnapshot = buildConfigSnapshotForSave();')
    );
  });

  it('resolves startup sync direction from content timestamps instead of forcing a pull', () => {
    expect(mainSource).toContain("await runProfileSyncInternal('auto', 'startup')");
    expect(mainSource).not.toContain("runProfileSync('pull', 'startup')");
  });

  it('persists and enforces the first-enable conflict gate until preparation succeeds', () => {
    expect(mainSource).toContain('firstEnableResolutionPending: false');
    expect(mainSource).toContain('profileSync.firstEnableResolutionPending = true');
    expect(mainSource).toContain('async function clearProfileSyncFirstEnableResolutionPending');
    expect(mainSource).toContain(
      'profileSyncRuntime.needsResolution || profileSync.firstEnableResolutionPending'
    );
    expect(mainSource).toContain(
      'return runSerializedConfigMutation(initializeProfileSyncOnStartupInternal)'
    );
  });

  it('backs up the local profile before applying a remote profile', () => {
    expect(mainSource).toContain('async function backupLocalProfileBeforePullApply');
    expect(mainSource).toContain('await backupLocalProfileBeforePullApply(remoteSyncScope);');
    expect(mainSource).toContain("const PROFILE_SYNC_BACKUP_DIR_NAME = 'profile-sync-backups'");
    expect(mainSource).toContain(
      'Created local profile backup, but failed to prune older profile backups:'
    );
  });

  it('enforces a stronger passphrase minimum and random device ids', () => {
    expect(mainSource).toContain('const PROFILE_SYNC_MIN_PASSPHRASE_LENGTH = 8');
    expect(mainSource).toContain('candidatePassphrase.length < PROFILE_SYNC_MIN_PASSPHRASE_LENGTH');
    expect(mainSource).not.toContain('os.hostname');
    expect(mainSource).toContain('.randomBytes(16)');
  });

  it('cleans up temp sync files and restricts copy sources and destinations', () => {
    expect(mainSource).toContain('await fs.promises.unlink(tempPath).catch(() => {});');
    expect(mainSource).toContain('allowedSourceFolders: [configuredSyncFolder');
    expect(mainSource).toContain('approvedCopyDestinationFolders');
  });
});

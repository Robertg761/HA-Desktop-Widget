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
  });

  it('routes Wayland global hotkeys through the portal while X11 keeps globalShortcut', () => {
    // Wayland: globalShortcut is a silent no-op, so entity + popup hotkeys use the portal.
    expect(mainSource).toContain("require('./src/portal-global-shortcuts.cjs')");
    expect(mainSource).toContain('function initPortalShortcutsBackend');
    // The portal only activates on a Linux Wayland session; X11/other keep globalShortcut.
    expect(mainSource).toContain(
      "if (process.platform !== 'linux' || !isWaylandSession()) return;"
    );
    expect(mainSource).toContain('handlePortalShortcutActivated');
    expect(mainSource).toContain('portalShortcutsActive');
    // Digit hotkeys (Alt+1) must map to the real uiohook key names, not the absent DigitN.
    expect(mainSource).toContain("1: UiohookKey['1']");
    expect(mainSource).not.toMatch(/UiohookKey\.Digit\d/);
  });

  it('persists a replacement popup hotkey only after successful registration', () => {
    const handlerStart = mainSource.indexOf("ipcMain.handle('register-popup-hotkey'");
    const handlerEnd = mainSource.indexOf("ipcMain.handle('unregister-popup-hotkey'", handlerStart);
    const handlerSource = mainSource.slice(handlerStart, handlerEnd);

    expect(handlerSource).toContain('const previousHotkey = config.popupHotkey');
    expect(handlerSource).toContain('if (!registrationResult.success)');
    expect(handlerSource).toContain('config.popupHotkey = previousHotkey');
    expect(handlerSource.indexOf('saveConfig()')).toBeGreaterThan(
      handlerSource.indexOf('if (!registrationResult.success)')
    );
  });

  it('preserves persisted desktop pins during config normalization even when favorites are stale', () => {
    const start = mainSource.indexOf('function normalizeDesktopPinsConfig');
    const end = mainSource.indexOf('function resolveDesktopPinSupportDecision');
    const normalizeDesktopPinsConfigSource = mainSource.slice(start, end);

    expect(normalizeDesktopPinsConfigSource).toContain('targetConfig.desktopPins = nextPins');
    expect(normalizeDesktopPinsConfigSource).not.toContain('favoriteSet.has');
  });

  it('backs up config before first write and blocks default-like config clobbers', () => {
    expect(mainSource).toContain('ensureConfigBackupBeforeFirstWrite');
    expect(mainSource).toContain('configBackupCreatedThisRun');
    expect(mainSource).toContain('shouldBlockPotentialConfigClobber');
    expect(mainSource).toContain(
      'Blocked config save because it would replace an existing user config with default-like data.'
    );
  });

  it('defers secure config resolution until after the first window can render', () => {
    expect(mainSource).toContain('loadConfig({ deferSecureStorage: true });');
    expect(mainSource).toContain('resolveDeferredSecureConfig({ notifyRenderer: true });');

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

  it('allows Electron to throttle background renderers', () => {
    expect(mainSource).not.toContain('backgroundThrottling: false');
  });

  it('supports opt-in prerelease update checks without moving stable users to prereleases', () => {
    expect(mainSource).toContain('function configureAutoUpdaterChannel');
    expect(mainSource).toContain('autoUpdater.allowPrerelease = allowPrerelease');
    expect(mainSource).toContain('autoUpdater.checkForUpdates().catch');
    expect(mainSource).toContain('function selectPortableRelease');
    expect(mainSource).toContain('allowPrerelease || !release.prerelease');
    expect(mainSource).toContain('releases?per_page=20');
    expect(mainSource).toContain('/releases/latest');
  });

  it('migrates the legacy clock boolean and constrains configurable clock formats', () => {
    expect(mainSource).toContain('function ensureDateTimeFormatConfigDefaults');
    expect(mainSource).toContain("new Set(['system', '12-hour', '24-hour'])");
    expect(mainSource).toContain("new Set(['system', 'weekday-short', 'long', 'numeric'])");
    expect(mainSource).toContain("target.ui.use24HourClock === 'boolean'");
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
    const handlerStart = mainSource.indexOf("ipcMain.handle('update-config'");
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
    expect(fn).toContain('updatedByDeviceId');
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
    // Tracking must run before the snapshot is built so the timestamp lands in
    // the same save instead of trailing one save behind.
    expect(mainSource.indexOf('updateLocalProfileSyncTracking();')).toBeLessThan(
      mainSource.indexOf('pendingConfigSnapshot = buildConfigSnapshotForSave();')
    );
  });

  it('resolves startup sync direction from content timestamps instead of forcing a pull', () => {
    expect(mainSource).toContain("await runProfileSync('auto', 'startup')");
    expect(mainSource).not.toContain("runProfileSync('pull', 'startup')");
  });

  it('backs up the local profile before applying a remote profile', () => {
    expect(mainSource).toContain('async function backupLocalProfileBeforePullApply');
    expect(mainSource).toContain('await backupLocalProfileBeforePullApply(remoteSyncScope);');
    expect(mainSource).toContain("const PROFILE_SYNC_BACKUP_DIR_NAME = 'profile-sync-backups'");
  });

  it('enforces a stronger passphrase minimum and random device ids', () => {
    expect(mainSource).toContain('const PROFILE_SYNC_MIN_PASSPHRASE_LENGTH = 8');
    expect(mainSource).toContain('passphrase.trim().length < PROFILE_SYNC_MIN_PASSPHRASE_LENGTH');
    expect(mainSource).not.toContain('os.hostname');
    expect(mainSource).toContain('.randomBytes(16)');
  });

  it('cleans up temp sync files and restricts copy sources and destinations', () => {
    expect(mainSource).toContain('await fs.promises.unlink(tempPath).catch(() => {});');
    expect(mainSource).toContain('allowedSourceFolders: [configuredSyncFolder');
    expect(mainSource).toContain('approvedCopyDestinationFolders');
  });
});

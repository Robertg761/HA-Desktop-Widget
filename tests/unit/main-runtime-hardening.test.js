const fs = require('fs');
const path = require('path');

const mainSource = fs.readFileSync(path.resolve(__dirname, '../../main.js'), 'utf8');
const preloadSource = fs.readFileSync(path.resolve(__dirname, '../../preload.js'), 'utf8');
const stylesSource = fs.readFileSync(path.resolve(__dirname, '../../styles.css'), 'utf8');

describe('main-process runtime hardening', () => {
  it('denies renderer-created windows and routes http/https navigation externally', () => {
    expect(mainSource).toContain('function hardenRendererNavigation');
    expect(mainSource).toContain('setWindowOpenHandler');
    expect(mainSource).toContain("return { action: 'deny' }");
    expect(mainSource).toContain("webContents.on('will-navigate'");
    expect(mainSource).toContain('routeExternalHttpLink(url)');
    expect(mainSource).toContain('shell.openExternal');
  });

  it('exposes and handles a correlated desktop-pin action response channel', () => {
    expect(preloadSource).toContain('respondDesktopPinActionRequest');
    expect(preloadSource).toContain("ipcRenderer.invoke('desktop-pin-action-response'");
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
    expect(mainSource).toContain('Blocked config save because it would replace an existing user config with default-like data.');
  });

  it('defers secure config resolution until after the first window can render', () => {
    expect(mainSource).toContain('loadConfig({ deferSecureStorage: true });');
    expect(mainSource).toContain('resolveDeferredSecureConfig({ notifyRenderer: true });');

    const getConfigStart = mainSource.indexOf("ipcMain.handle('get-config'");
    const getConfigEnd = mainSource.indexOf("ipcMain.handle('get-locale-bootstrap'", getConfigStart);
    const getConfigSource = mainSource.slice(getConfigStart, getConfigEnd);
    expect(getConfigSource).not.toContain('resolveDeferredSecureConfig');

    const desktopPinBootstrapStart = mainSource.indexOf("ipcMain.handle('get-desktop-pin-bootstrap'");
    const desktopPinBootstrapEnd = mainSource.indexOf("ipcMain.handle('publish-ha-snapshot'", desktopPinBootstrapStart);
    const desktopPinBootstrapSource = mainSource.slice(desktopPinBootstrapStart, desktopPinBootstrapEnd);
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

  it('fails closed for token saves when encryption is unavailable', () => {
    expect(mainSource).toContain('delete configToSave.homeAssistant.token');
    expect(mainSource).toContain("configToSave.tokenResetReason = reason");
    expect(mainSource).toContain("config.tokenResetReason = reason");
    expect(mainSource).toContain('omitting token from saved config so it is not written in plaintext');
    expect(mainSource).not.toContain('Failed to encrypt token, saving as plaintext');
  });

  it('guards privileged IPC senders and restricts desktop-pin channels', () => {
    expect(mainSource).toContain('function getAuthorizedIpcSender');
    expect(mainSource).toContain("sender.type === 'desktop-pin' && options.allowDesktopPin === true");
    expect(mainSource).toContain("authorizeIpcSender(event, 'update-config')");
    expect(mainSource).toContain("authorizeIpcSender(event, 'copy-profile-sync-file')");
    expect(mainSource).toContain("authorizeIpcSender(event, 'request-desktop-pin-action', { allowDesktopPin: true })");
  });

  it('keeps Windows non-glass opacity on renderer background surfaces', () => {
    expect(mainSource).toContain('function shouldUseNativeWindowOpacity');
    expect(mainSource).toContain("process.platform === 'win32'");
    expect(mainSource).toContain('transparent = true;');
    expect(mainSource).toContain('targetWindow.setOpacity(shouldUseNativeWindowOpacity(currentConfig) ? safeOpacity : 1)');
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
    expect(refreshSource).toContain('applyWindowEffectsToWindow(targetWindow, currentConfig, overrideFrostedGlass)');
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

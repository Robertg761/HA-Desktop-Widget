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

  it('limits media artwork proxy responses to image content within a bounded size', () => {
    expect(mainSource).toContain('MEDIA_ARTWORK_MAX_RESPONSE_BYTES');
    expect(mainSource).toContain('isPotentialMediaArtworkContentType');
    expect(mainSource).toContain('resolveMediaArtworkContentType');
    expect(mainSource).toContain('MEDIA_ARTWORK_TOO_LARGE');
    expect(mainSource).toContain('MEDIA_ARTWORK_UNSUPPORTED_TYPE');
    expect(mainSource).toContain("host === 'media_artwork'");
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

  it('loads secure Home Assistant config before the renderer can enter setup mode', () => {
    expect(mainSource).toContain('loadConfig();');
    expect(mainSource).not.toContain('loadConfig({ deferSecureStorage: true });');
  });

  it('loads electron-updater lazily so development startup is not coupled to updater detection', () => {
    expect(mainSource).toContain('function getAutoUpdater()');
    expect(mainSource).toContain("require('electron-updater')");
    expect(mainSource).not.toContain("const { autoUpdater } = require('electron-updater');");
  });

  it('supports opt-in prerelease update checks without moving stable users to prereleases', () => {
    expect(mainSource).toContain('function configureAutoUpdaterChannel');
    expect(mainSource).toContain('autoUpdater.allowPrerelease = allowPrerelease');
    expect(mainSource).toMatch(/configureAutoUpdaterChannel\(autoUpdater\);\s+autoUpdater\.checkForUpdates\(\);/);
    expect(mainSource).toContain('function selectPortableRelease');
    expect(mainSource).toContain('allowPrerelease || !release.prerelease');
    expect(mainSource).toContain('releases?per_page=20');
    expect(mainSource).toContain('/releases/latest');
  });

  it('keeps Windows non-glass opacity on renderer background surfaces', () => {
    expect(mainSource).toContain('function shouldUseNativeWindowOpacity');
    expect(mainSource).toContain("process.platform === 'win32'");
    expect(mainSource).toContain('transparent = true;');
    expect(mainSource).toContain('targetWindow.setOpacity(shouldUseNativeWindowOpacity(currentConfig) ? safeOpacity : 1)');
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

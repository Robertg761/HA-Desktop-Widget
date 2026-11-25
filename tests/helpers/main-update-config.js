/**
 * main.js's own update-config handler, run over a device from profile-sync-devices.js: the
 * Settings save as main runs it, with the device's config store and main's config change
 * effects, and the device's profile sync engine deciding the sync settings. For tests of what a
 * Settings save does with everything besides sync; the sync half is the engine's, tested there.
 *
 *   const device = harness.createDevice('desktop', { syncing: false });
 *   useMainUpdateConfig(device);
 *   await device.invoke('update-config', next);
 *
 * The handler runs in `device.main`, where a test can put what else from main.js it needs.
 */

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { formatTemplate } = require('../../src/i18n-main.cjs');
const { toStoredPages } = require('../../src/page-names.cjs');
const { replaceConfigContents } = require('../../src/main-config-store.cjs');
const { describeKnownProfileSyncFailure } = require('../../src/profile-sync-engine.cjs');

const mainSource = fs.readFileSync(path.resolve(__dirname, '../../main.js'), 'utf8');

function sliceMain(startMarker, endMarker) {
  const start = mainSource.indexOf(startMarker);
  const end = mainSource.indexOf(endMarker, start);
  if (start < 0 || end <= start) {
    throw new Error(`Could not slice main.js from ${startMarker}`);
  }
  return mainSource.slice(start, end);
}

const UPDATE_CONFIG_SOURCE = [
  sliceMain('const TOKEN_RESET_RECOVERY_REASONS', 'const HOME_ASSISTANT_OAUTH_REFRESH_SKEW_MS'),
  sliceMain('function mainTError(', '// Hotkey changes roll back on failure'),
  sliceMain('function ensureUpdateConfigDefaults(', 'const TIME_DISPLAY_FORMATS'),
  sliceMain('function sanitizeConfigForRenderer(', 'function getAuthorizedIpcSender('),
  sliceMain("ipcMain.handle(\n  'update-config'", "ipcMain.handle(\n  'clear-token-reset-reason'"),
].join('\n');

const TOKEN_PLACEHOLDER = 'YOUR_LONG_LIVED_ACCESS_TOKEN';

function useMainUpdateConfig(device) {
  const context = device.main;
  const { configStore } = context;
  const handlers = {};
  const stubs = {
    log: { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} },
    process: Object.create(process, { platform: { value: 'linux' } }),
    mainT: (key, vars) => formatTemplate(key, vars),
    describeKnownProfileSyncFailure,
    replaceConfigContents,
    toStoredPages,
    electronScreen: {},
    mainWindow: null,
    preservedEncryptedTokenForRecovery: null,
    HOME_ASSISTANT_TOKEN_PLACEHOLDER: TOKEN_PLACEHOLDER,
    isPlaceholderOrEmptyToken: (token) => !token || token === TOKEN_PLACEHOLDER,
    // Normalizers with tests of their own.
    pruneConfig: () => {},
    ensureDateTimeFormatConfigDefaults: () => {},
    normalizeDesktopPinsConfig: () => {},
    normalizeTrayEntitiesConfigInPlace: () => {},
    // What sanitizeConfigForRenderer reads besides the config.
    IS_CLIMATE_DEMO_MODE: false,
    IS_CLIMATE_DEMO_OVERLAY_MODE: false,
    IS_ISOLATED_PROFILE: false,
    isLayerShellChildProcess: false,
    configRecoveryNotice: null,
    NATIVE_GLASS_SUPPORTED: true,
    omarchyThemeWatcher: null,
    getOmarchyBarEntities: () => ({ all: [] }),
    isHyprland: () => false,
    windowsAreAlwaysTransparent: () => false,
    getSystemColorScheme: () => null,
    rendersInSoftware: () => false,
    hasDeferredSecureConfigWork: () => false,
    ipcMain: { handle: (channel, handler) => (handlers[channel] = handler) },
    serializeConfigMutationHandler:
      (handler) =>
      (...args) =>
        configStore.serialize(() => handler(...args)),
    authorizeIpcSender: () => ({ type: 'main', window: {} }),
    rejectUnauthorizedIpc: () => ({ success: false, error: 'Unauthorized' }),
  };
  Object.entries(stubs).forEach(([name, value]) => {
    if (!(name in context)) context[name] = value;
  });
  vm.runInContext(UPDATE_CONFIG_SOURCE, context);
  device.handle('update-config', (newConfig) => handlers['update-config']({}, newConfig));
  return device;
}

module.exports = { useMainUpdateConfig };

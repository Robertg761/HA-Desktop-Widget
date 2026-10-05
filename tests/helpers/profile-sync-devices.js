/**
 * Runs the real profile sync engine from main.js for several simulated devices
 * sharing one sync folder. Each device is its own vm context with its own
 * config, runtime state, app data folder and clock; only the Electron-facing
 * side effects are stubbed.
 *
 * Besides the engine, each device runs the real update-config and profile sync
 * IPC handlers, so a test can drive a Settings save the way the renderer does
 * (see `saveSettings`) and watch what the main process does with it.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const vm = require('vm');
const nodeCrypto = require('crypto');
const profileSyncCore = require('../../profile-sync-core.js');
const { requireExistingSyncParentDirectory } = require('../../src/cloud-sync-path.cjs');
const rewriteTransaction = require('../../src/profile-sync-rewrite-transaction.cjs');
const { formatTemplate } = require('../../src/i18n-main.cjs');
const { toStoredPages } = require('../../src/page-names.cjs');
const {
  createSettingsFileController,
  settingsFileErrorCode,
} = require('../../src/settings-file-controller.cjs');
const {
  isPathInsideDirectory,
  validateProfileSyncCopyPaths,
} = require('../../src/main-security.cjs');

const mainSource = fs.readFileSync(path.resolve(__dirname, '../../main.js'), 'utf8');

function sliceMain(startMarker, endMarker) {
  const start = mainSource.indexOf(startMarker);
  const end = mainSource.indexOf(endMarker, start);
  if (start < 0 || end <= start) {
    throw new Error(`Could not slice main.js from ${startMarker}`);
  }
  return mainSource.slice(start, end);
}

const ENGINE_SOURCE = [
  sliceMain('function describeKnownProfileSyncFailure(', '// Hotkey changes roll back on failure'),
  sliceMain('function getRendererSyncFilePath(', 'function isPlainObject('),
  sliceMain('function isProfileSyncProviderSupported(', 'function isPortableBuild('),
  sliceMain('function generateProfileSyncDeviceId(', 'function ensureUpdateConfigDefaults('),
  sliceMain('function ensureUpdateConfigDefaults(', 'function ensureHaProfileConfigDefaults('),
  sliceMain('function getProfileSyncConfig(', 'function hasDeferredSecureConfigWork('),
  sliceMain('function buildProfileSyncStatus(', 'async function readCloudFileEnvelope('),
  sliceMain(
    'async function readCloudFileEnvelope(',
    '/**\n * Selects and returns an appropriate tray icon'
  ),
  sliceMain(
    'async function findProfileSyncConflictSections(',
    'function scheduleDebouncedProfileSyncPush('
  ),
  sliceMain(
    'async function runProfileSyncInternal(',
    '/**\n * Runs a sync triggered by something other than the interval timer'
  ),
].join('\n');

// The IPC handlers that make up a Settings save and the sync controls beside it.
const HANDLER_SOURCE = [
  sliceMain("ipcMain.handle(\n  'update-config'", "ipcMain.handle(\n  'clear-token-reset-reason'"),
  sliceMain("ipcMain.handle('choose-profile-sync-folder'", '// Start at login IPC handlers'),
].join('\n');

// The sync constants and the runtime state object that follows them. The runtime is a var
// so tests can reach it as a property of the device's context.
const PROFILE_SYNC_CONSTANTS = (
  sliceMain('const PROFILE_SYNC_PUSH_DEBOUNCE_MS', '\n};\n') + '\n};\n'
).replace('const profileSyncRuntime', 'var profileSyncRuntime');

/**
 * Stands in for Electron's safeStorage. `keyring: 'libsecret'` behaves like
 * Chromium's OSCrypt on a Linux desktop with a working Secret Service, which
 * seals an empty string to an empty buffer; `'none'` is a session without one.
 */
function createSafeStorage({ keyring = 'libsecret' } = {}) {
  const available = keyring !== 'none';
  return {
    isEncryptionAvailable: () => available,
    getSelectedStorageBackend: () => (available ? 'gnome_libsecret' : 'basic_text'),
    encryptString: (value) => {
      if (!available) throw new Error('Encryption is not available');
      return value === '' ? Buffer.alloc(0) : Buffer.from(`sealed:${value}`);
    },
    decryptString: (buffer) => {
      if (!available) throw new Error('Encryption is not available');
      if (buffer.length === 0) throw new Error('Error while decrypting the ciphertext');
      return buffer.toString().slice('sealed:'.length);
    },
  };
}

/**
 * @param {object} [defaults]
 * @param {() => object} [defaults.createSafeStorage] credential store for devices that bring none
 */
function createProfileSyncHarness({ createDefaultSafeStorage = () => createSafeStorage() } = {}) {
  let sharedFolder;
  let tempRoot;

  function setup() {
    tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'profile-sync-engine-'));
    sharedFolder = path.join(tempRoot, 'Dropbox');
    fs.mkdirSync(sharedFolder);
  }

  function teardown() {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }

  function syncFilePath() {
    return path.join(sharedFolder, 'ha-widget-profile-sync.json');
  }

  function readSyncFile() {
    return JSON.parse(fs.readFileSync(syncFilePath(), 'utf8'));
  }

  function baseContent() {
    return {
      opacity: 0.9,
      alwaysOnTop: true,
      frostedGlass: true,
      hideOnBlur: false,
      ui: { theme: 'dark', accent: 'original', scale: 1 },
      favoriteEntities: ['light.kitchen'],
      customTabs: [],
      activeTabId: '',
      desktopPins: {},
      globalHotkeys: { enabled: false, hotkeys: {} },
      entityAlerts: { enabled: false, alerts: {} },
      popupHotkey: '',
    };
  }

  /**
   * @param {string} name used for the device's app data folder
   * @param {object} [options]
   * @param {object} [options.content] config content, defaults to baseContent()
   * @param {object} [options.profileSync] profileSync overrides
   * @param {number} [options.clockOffsetMs] how far this device's clock is ahead
   * @param {object} [options.safeStorage] OS credential store, see createSafeStorage
   * @param {boolean} [options.syncing] whether the device starts with sync on (default true)
   */
  function createDevice(
    name,
    {
      content = baseContent(),
      profileSync = {},
      clockOffsetMs = 0,
      safeStorage = createDefaultSafeStorage(),
      syncing = true,
    } = {}
  ) {
    const userData = path.join(tempRoot, `${name}-userData`);
    fs.mkdirSync(userData);
    const RealDate = Date;
    class DeviceDate extends RealDate {
      constructor(...args) {
        super(...(args.length ? args : [RealDate.now() + clockOffsetMs]));
      }
      static now() {
        return RealDate.now() + clockOffsetMs;
      }
    }

    const handlers = {};
    const dialogResults = [];
    const dialogCalls = [];
    // The window each dialog was parented to, in the same order; null when it had none.
    const dialogParents = [];
    const context = {
      Date: DeviceDate,
      Buffer,
      console,
      // Sealing secrets only needs a keyring on Linux, so every device pretends to be one.
      process: Object.create(process, { platform: { value: 'linux' } }),
      fs,
      path,
      nodeCrypto,
      profileSyncCore,
      requireExistingSyncParentDirectory,
      ...rewriteTransaction,
      createSettingsFileController,
      settingsFileErrorCode,
      validateProfileSyncCopyPaths,
      app: { getPath: (key) => (key === 'home' ? tempRoot : userData) },
      log: { warn: () => {}, info: () => {}, debug: () => {}, error: () => {} },
      // Stands in for the OS credential store the rewrite transaction seals secrets with.
      safeStorage,
      mainT: (key, vars) => formatTemplate(key, vars),
      isPlainObject: (value) => !!value && typeof value === 'object' && !Array.isArray(value),
      toStoredPages,
      // The real check: path.relative alone calls a path on another Windows drive inside.
      isPathInsideDirectory,
      preservedEncryptedTokenForRecovery: null,
      mainWindow: null,
      tray: null,
      autoUpdaterInstance: null,
      pushes: [],
      emittedStatuses: [],
      savedSnapshots: 0,
      ipcMain: { handle: (channel, handler) => (handlers[channel] = handler) },
      serializeConfigMutationHandler: (handler) => handler,
      authorizeIpcSender: () => ({ type: 'main', window: {} }),
      rejectUnauthorizedIpc: () => ({ success: false, error: 'Unauthorized' }),
      windowAutoHide: { suspend: () => () => {} },
      dialog: {
        showOpenDialog: async (...args) => {
          dialogCalls.push(args.at(-1));
          dialogParents.push(args.length > 1 ? args[0] : null);
          return dialogResults.shift() || { canceled: true, filePaths: [] };
        },
        showSaveDialog: async (...args) => {
          dialogCalls.push(args.at(-1));
          return dialogResults.shift() || { canceled: true };
        },
      },
    };
    vm.createContext(context);
    vm.runInContext(
      `${PROFILE_SYNC_CONSTANTS}
     ${ENGINE_SOURCE}
     var configSnapshotVersion = 0;
     function saveConfig(options = {}) {
       updateLocalProfileSyncTracking({ allowDebouncedPush: options.allowDebouncedPush !== false });
       savedSnapshots += 1;
       configSnapshotVersion += 1;
       return {};
     }
     async function saveConfigDurably(options = {}) {
       saveConfig(options);
       return { success: true, persistenceWarnings: [] };
     }
     function scheduleDebouncedProfileSyncPush(source) { pushes.push(source); }
     function runProfileSync(direction, source) { return runProfileSyncInternal(direction, source); }
     function emitProfileSyncStatus(extra = {}) { emittedStatuses.push(buildProfileSyncStatus(extra)); }
     function setupProfileSyncInterval() {}
     async function runPostSaveSideEffect(warnings, label, fn) { await fn(); }
     function applyMainWindowSettingSideEffects() {}
     function applyRuntimeConfigSideEffects() {}
     function syncDesktopPinWindowsWithConfig() {}
     function syncTrayEntitiesWithConfig() {}
     function broadcastDesktopPinConfigUpdate() {}
     function pushConfigToRenderer() {}
     function createTray() {}
     function configureAutoUpdaterChannel() {}
     function pruneConfig() {}
     function ensureDateTimeFormatConfigDefaults() {}
     function ensureHaProfileConfigDefaults() {}
     function normalizeDesktopPinsConfig() {}
     function normalizeTrayEntitiesConfigInPlace() {}
     function isPlaceholderOrEmptyToken(token) { return !token || token === HOME_ASSISTANT_TOKEN_PLACEHOLDER; }
     // What the real sanitizeConfigForRenderer reads besides the config.
     var IS_CLIMATE_DEMO_MODE = false, IS_CLIMATE_DEMO_OVERLAY_MODE = false;
     var IS_ISOLATED_PROFILE = false, isLayerShellChildProcess = false, configRecoveryNotice = null;
     var NATIVE_GLASS_SUPPORTED = true;
     var omarchyThemeWatcher = null;
     function getOmarchyBarEntities() { return { all: [] }; }
     function isHyprland() { return false; }
     function windowsAreAlwaysTransparent() { return false; }
     function getSystemColorScheme() { return null; }
     function rendersInSoftware() { return false; }
     function hasDeferredSecureConfigWork() { return false; }
     function getDefaultProfileSyncFilePath() { return path.join(app.getPath('userData'), PROFILE_SYNC_DEFAULT_FILE_NAME); }
     var config = null;
     ${HANDLER_SOURCE}`,
      context
    );

    context.config = {
      ...JSON.parse(JSON.stringify(content)),
      profileSync: {
        enabled: syncing,
        provider: 'dropbox',
        cloudFilePath: syncFilePath(),
        ...profileSync,
      },
    };
    vm.runInContext(
      `ensureProfileSyncConfigDefaults(config);
     // Seeded at startup, as refreshProfileSyncRuntimeTracking does, from this device's clock.
     config.profileSync.profileUpdatedAt = config.profileSync.profileUpdatedAt || new Date().toISOString();
     profileSyncRuntime.passphraseSession = config.profileSync.__passphrase || '';
     delete config.profileSync.__passphrase;
     profileSyncRuntime.localProfileHash = computeScopedProfileHash(
       profileSyncCore.projectSyncProfile(config, getActiveProfileSyncScope()),
       getActiveProfileSyncScope()
     );
     profileSyncRuntime.localSectionHashes = computeLocalSectionHashes();`,
      context
    );

    const device = {
      context,
      get config() {
        return context.config;
      },
      /** Makes a local edit the way a settings save does. */
      edit(mutate) {
        mutate(context.config);
        context.saveConfig();
      },
      sync(direction = 'auto', source = 'interval') {
        return context.runProfileSyncInternal(direction, source);
      },
      firstEnable() {
        context.config.profileSync.firstEnableResolutionPending = true;
        return context.prepareProfileSyncFirstEnableResolution();
      },
      status() {
        return context.buildProfileSyncStatus();
      },
      /** What the renderer was sent, in order, as each run started and ended. */
      get emittedStatuses() {
        return context.emittedStatuses;
      },
      backups(prefix) {
        const dir = path.join(userData, 'profile-sync-backups');
        if (!fs.existsSync(dir)) return [];
        return fs
          .readdirSync(dir)
          .filter((file) => file.startsWith(prefix))
          .map((file) => JSON.parse(fs.readFileSync(path.join(dir, file), 'utf8')));
      },
      userData,
      /** Calls an IPC handler as the renderer would. */
      invoke(channel, ...args) {
        if (!handlers[channel]) throw new Error(`No handler registered for ${channel}`);
        return handlers[channel]({ sender: {} }, ...args);
      },
      /** The options each native dialog was opened with. */
      dialogCalls,
      dialogParents,
      /** Queues what the next native dialog returns. */
      queueDialogResult(result) {
        dialogResults.push(result);
      },
      /** The config as the Settings window holds it. */
      rendererConfig() {
        return context.sanitizeConfigForRenderer(context.config);
      },
      /**
       * A Settings save, as saveSettings in src/settings.js performs it: the whole
       * config goes through update-config, then the passphrase IPC runs when a
       * passphrase was typed or the encryption switch moved.
       *
       * @param {object} [options]
       * @param {(config: object) => void} [options.edit] changes to the non-sync settings
       * @param {object} [options.profileSync] the sync form: enabled, encryptionEnabled, ...
       * @param {string} [options.passphrase] what was typed in the passphrase field
       * @param {boolean} [options.remember] the "Remember passphrase" switch
       */
      async saveSettings({ edit, profileSync: form = {}, passphrase = '', remember = false } = {}) {
        const previous = context.config.profileSync;
        const next = device.rendererConfig();
        if (edit) edit(next);
        next.profileSync = {
          ...next.profileSync,
          enabled: previous.enabled,
          encryptionEnabled: previous.encryptionEnabled,
          ...form,
        };
        next.profileSync.rememberPassphrase = !!next.profileSync.encryptionEnabled && remember;
        const update = await device.invoke('update-config', next);
        if (update?.success === false) return { update, passphrase: null };
        const encryptionChanged =
          !!next.profileSync.encryptionEnabled !== !!previous.encryptionEnabled;
        const pendingCancelled =
          typeof previous.encryptionChangePending === 'boolean' &&
          !!next.profileSync.encryptionEnabled === !!previous.encryptionEnabled;
        let result = null;
        if (next.profileSync.enabled && (passphrase || encryptionChanged || pendingCancelled)) {
          result = await device.invoke(
            'set-profile-sync-passphrase',
            passphrase,
            !!next.profileSync.rememberPassphrase,
            !!next.profileSync.encryptionEnabled
          );
        }
        return { update, passphrase: result };
      },
    };
    return device;
  }

  /** Two devices that have already synced once and agree on everything. */
  async function createSyncedPair(options = {}) {
    const desktop = createDevice('desktop', options.desktop);
    const laptop = createDevice('laptop', options.laptop);
    await desktop.sync();
    await laptop.sync();
    return { desktop, laptop };
  }

  return {
    setup,
    teardown,
    syncFilePath,
    readSyncFile,
    baseContent,
    createDevice,
    createSyncedPair,
  };
}

module.exports = { createProfileSyncHarness, createSafeStorage, profileSyncCore };

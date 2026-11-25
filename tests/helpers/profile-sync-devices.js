/**
 * Runs the profile sync engine (src/profile-sync-engine.cjs) for several simulated devices
 * sharing one sync folder. Each device has its own config store, engine, app data folder, clock
 * and OS keyring; the folder target writes real files in a temp folder, and a device signed in to
 * a test Cloud Sync service (tests/helpers/cloud-sync-world.js) syncs through it instead.
 *
 * Each device wires its engine the way main.js does: main's config change effects run on its
 * config store (see tests/helpers/main-config-store.js), and `invoke` stands in for main's IPC
 * handlers, which are thin calls into the engine. A test can drive a Settings save the way the
 * renderer does (see `saveSettings`) and watch what the engine does with it.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const profileSyncCore = require('../../profile-sync-core.js');
const {
  createProfileSyncEngine,
  describeKnownProfileSyncFailure,
} = require('../../src/profile-sync-engine.cjs');
const { formatTemplate } = require('../../src/i18n-main.cjs');
const { createSettingsFileController } = require('../../src/settings-file-controller.cjs');
const { createMainConfigStore, replaceConfigContents } = require('./main-config-store.js');

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

// A Cloud Sync client for a build without the service.
const NO_CLOUD_SYNC = {
  isAvailable: () => false,
  getStoredAccount: () => null,
  serviceUrl: '',
  signInController: null,
};

/**
 * Timers that never fire on their own: a test sees what the engine scheduled (a debounced push,
 * the interval) without a sync starting behind its back.
 */
function createHeldTimers() {
  const pending = new Set();
  const add = (kind) => (fn, ms) => {
    const timer = { kind, fn, ms };
    pending.add(timer);
    return timer;
  };
  return {
    pending,
    setTimeout: add('timeout'),
    setInterval: add('interval'),
    clearTimeout: (timer) => pending.delete(timer),
    clearInterval: (timer) => pending.delete(timer),
  };
}

const translate = (key, vars) => formatTemplate(key, vars);
// main.js's mainTError, for the engine's error wording.
const translateError = (error) =>
  describeKnownProfileSyncFailure(error, translate) ||
  translate(typeof error === 'string' ? error : error?.message || String(error ?? ''));

/**
 * @param {object} [defaults]
 * @param {() => object} [defaults.createDefaultSafeStorage] credential store for devices that bring none
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
   * @param {object} [options.profileSync] profileSync overrides; `__passphrase` is a passphrase
   *   this device remembers
   * @param {number} [options.clockOffsetMs] how far this device's clock is ahead
   * @param {object} [options.safeStorage] OS credential store, see createSafeStorage
   * @param {boolean} [options.syncing] whether the device starts with sync on (default true)
   * @param {object} [options.cloudClient] a Cloud Sync client signed in to a test service
   * @param {Function} [options.t] main's translator (English by default)
   * @param {Function} [options.tError] main's error wording, with `t`
   */
  function createDevice(
    name,
    {
      content = baseContent(),
      profileSync = {},
      clockOffsetMs = 0,
      safeStorage = createDefaultSafeStorage(),
      syncing = true,
      cloudClient = null,
      t = translate,
      tError = translateError,
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

    const { __passphrase: sessionPassphrase = '', ...profileSyncOverrides } = profileSync;
    const config = {
      ...JSON.parse(JSON.stringify(content)),
      profileSync: {
        enabled: syncing,
        provider: 'dropbox',
        cloudFilePath: syncFilePath(),
        ...profileSyncOverrides,
        ...(sessionPassphrase
          ? { rememberPassphrase: true, storedPassphrase: sessionPassphrase }
          : {}),
      },
    };
    // The config store with main.js's config change effects; the engine is set below.
    const store = createMainConfigStore(config);
    const { configStore } = store;

    const timers = createHeldTimers();
    let deviceFs = fs;
    const platform = { platform: 'linux', env: {} };
    const dialogResults = [];
    const dialogCalls = [];
    // The window each dialog was parented to, in the same order; null when it had none.
    const dialogParents = [];
    const emittedStatuses = [];
    const warnings = [];
    const hooks = { beforeReread: async () => {} };

    const startEngine = () =>
      createProfileSyncEngine({
        configStore,
        // Swappable, so a test can make the folder fail as a real disk or sync client would.
        fs: new Proxy({}, { get: (_target, key) => deviceFs[key] }),
        app: { getPath: (key) => (key === 'home' ? tempRoot : userData) },
        // Sealing secrets only needs a keyring on Linux, so every device pretends to be one.
        process: platform,
        safeStorage,
        Date: DeviceDate,
        getCloudSyncClient: () => cloudClient || NO_CLOUD_SYNC,
        dialog: {
          showOpenDialog: async (...args) => {
            dialogCalls.push(args.at(-1));
            dialogParents.push(args.length > 1 ? args[0] : null);
            return dialogResults.shift() || { canceled: true, filePaths: [] };
          },
        },
        suspendAutoHide: () => () => {},
        t,
        tError,
        log: {
          warn: (...args) => warnings.push(args.join(' ')),
          info: () => {},
          debug: () => {},
          error: () => {},
        },
        sendStatus: (buildStatus) => emittedStatuses.push(buildStatus()),
        rendererConfig: () => rendererConfig(),
        normalizeConfig: () => {},
        snapshotMainState: () => () => {},
        ...timers,
        // No pause before reading a damaged file again; a test can set one that changes the file.
        sleep: () => hooks.beforeReread(),
      });
    let engine = startEngine();
    store.context.profileSyncEngine = engine;

    // Seeded at startup, as loading the config does, from this device's clock.
    engine.normalizeSettings(config);
    config.profileSync.profileUpdatedAt =
      config.profileSync.profileUpdatedAt || new DeviceDate().toISOString();
    engine.configLoaded();

    /** The config as the Settings window holds it, as main's sanitizeConfigForRenderer gives it. */
    function rendererConfig() {
      const copy = JSON.parse(JSON.stringify(config));
      if (copy.profileSync) engine.redactForRenderer(copy.profileSync);
      copy.configRevision = configStore.revision();
      return copy;
    }

    /** The sync half of main.js's update-config handler, run the same way around the engine. */
    async function updateConfig(newConfig) {
      return configStore.serialize(async () => {
        delete newConfig.configRevision;
        const syncSettings = engine.receiveSettings(newConfig);
        if (syncSettings.error) {
          return { success: false, error: syncSettings.error, config: rendererConfig() };
        }
        const persistence = await configStore.apply(
          (current) => {
            const prevConfig = JSON.parse(JSON.stringify(current));
            replaceConfigContents(current, {
              ...current,
              ...newConfig,
              profileSync: syncSettings.profileSync,
            });
            engine.normalizeSettings(current);
            syncSettings.merged(current, prevConfig);
          },
          {
            origin: 'settings',
            requiresInitialPreparation: syncSettings.requiresInitialPreparation,
          }
        );
        if (!persistence.success) {
          syncSettings.notSaved();
          return {
            success: false,
            error: `Failed to save settings: ${persistence.error}`,
            config: rendererConfig(),
          };
        }
        return { success: true, config: rendererConfig() };
      });
    }

    const settingsFile = createSettingsFileController({
      fs,
      dialog: {
        showOpenDialog: async (...args) => {
          dialogCalls.push(args.at(-1));
          return dialogResults.shift() || { canceled: true, filePaths: [] };
        },
        showSaveDialog: async (...args) => {
          dialogCalls.push(args.at(-1));
          return dialogResults.shift() || { canceled: true };
        },
      },
      suspendAutoHide: () => () => {},
      getConfig: () => config,
      translate: (key) => translate(key),
      applySections: async (sections) => {
        await engine.importSections(sections);
        return { config: rendererConfig() };
      },
    });

    // main.js's IPC handlers for sync, each a call into the engine. Those that change the config
    // run in its queue, as serializeConfigMutationHandler runs them.
    const settingsWindow = {};
    const serialized =
      (method) =>
      (...args) =>
        configStore.serialize(() => engine[method](...args));
    const handlers = {
      'update-config': (newConfig) => updateConfig(newConfig),
      'get-profile-sync-status': () => engine.status(),
      'run-profile-sync': (direction) => engine.syncNow(direction),
      // Main hands over the Settings window the request came from, to parent the dialog.
      'choose-profile-sync-folder': (provider, currentFolder) =>
        engine.chooseFolder(provider, currentFolder, settingsWindow),
      'copy-profile-sync-file': (fromPath, toPath) => engine.copySyncFile(fromPath, toPath),
      'set-profile-sync-passphrase': serialized('setPassphrase'),
      'clear-profile-sync-passphrase': serialized('clearPassphrase'),
      'resolve-profile-sync-first-enable': serialized('resolveFirstEnable'),
      'list-profile-sync-backups': () => engine.listBackups(),
      'restore-profile-sync-backup': serialized('restoreBackup'),
      'get-cloud-sync-account': () => engine.cloudAccount(),
      'cloud-sync-sign-in': (provider) => engine.cloudSignIn(provider),
      'cloud-sync-sign-out': () => engine.cloudSignOut(),
      'cloud-sync-open-billing': () => engine.cloudOpenBilling(),
      'cloud-sync-delete-account': () => engine.cloudDeleteAccount(),
      'preview-settings-import': async () => ({
        success: true,
        ...(await settingsFile.previewImport(null, 1)),
      }),
      'apply-settings-import': (id) =>
        configStore.serialize(async () => ({
          success: true,
          ...(await settingsFile.applyImport(1, id)),
        })),
    };

    const device = {
      get engine() {
        return engine;
      },
      /**
       * The app closes and opens again: a new engine over the config as it was last saved. What
       * was held only for the session, such as a passphrase not remembered, is gone.
       */
      restart() {
        engine.pause();
        replaceConfigContents(config, device.writtenConfig() || config);
        engine = startEngine();
        store.context.profileSyncEngine = engine;
        engine.normalizeSettings(config);
        engine.configLoaded();
      },
      get config() {
        return config;
      },
      /** Makes a local edit and saves it, as the window geometry and status fields are saved. */
      edit(mutate) {
        mutate(config);
        device.save();
      },
      /** Saves the config as it stands, through the store's sync tracking. */
      save() {
        return configStore.save({ origin: 'local' });
      },
      /** Puts `next` in place of the config, as a change that builds a new config does. */
      replaceConfig(next) {
        replaceConfigContents(config, next);
      },
      /** A copy of the config as it stands now. */
      configCopy() {
        return JSON.parse(JSON.stringify(config));
      },
      /** The revision of the last config written: what the renderer's copy carries. */
      revision() {
        return configStore.revision();
      },
      /** The config as this device's config.json holds it, or null before the first write. */
      writtenConfig() {
        return store.written();
      },
      /** Makes the next config writes fail, as a full disk would. */
      failConfigWrites(message = 'disk full') {
        store.failWrites(message);
      },
      /** Runs `interceptor` while the next config write is under way; it fails if that throws. */
      interceptNextConfigWrite(interceptor) {
        store.interceptNextWrite(interceptor);
      },
      /** Waits for everything queued behind the last change, such as a re-check a run queued. */
      settle() {
        return configStore.serialize(() => {});
      },
      /**
       * An update-config call carrying `next`, as a renderer sends it: `touchedKeys` are the synced
       * settings it says the user changed, and `baseRevision` the config revision it was built
       * from (none from an older renderer).
       */
      updateFromRenderer(next, { touchedKeys, baseRevision } = {}) {
        return device.invoke('update-config', {
          ...JSON.parse(JSON.stringify(next)),
          ...(touchedKeys ? { profileSyncTouchedKeys: touchedKeys } : {}),
          ...(baseRevision !== undefined ? { configBaseRevision: baseRevision } : {}),
        });
      },
      /** A sync run, as the interval timer starts one unless a `source` is given. */
      sync(direction = 'auto', source = 'interval') {
        return engine.sync(direction, source);
      },
      /**
       * Treats sync as just enabled (a Settings save turning it on or moving it), and runs it the
       * way Sync now does then: the file is compared with this device first.
       */
      async firstEnable() {
        config.profileSync.firstEnableResolutionPending = true;
        const result = await engine.sync('auto', 'manual');
        return { ...result, needsResolution: result?.reason === 'needs_resolution' };
      },
      status() {
        return engine.status();
      },
      /** What the renderer was sent, in order, as each run started and ended. */
      emittedStatuses,
      /** What the engine logged as warnings, such as why a run at startup stopped. */
      warnings,
      /** Whether a debounced push is waiting to run. */
      pushQueued() {
        return [...timers.pending].some((timer) => timer.kind === 'timeout');
      },
      /** Whether the sync interval is running. */
      intervalRunning() {
        return [...timers.pending].some((timer) => timer.kind === 'interval');
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
      /** Moves this device's clock forward, as time passing before its next edit would. */
      advanceClock(ms) {
        clockOffsetMs += ms;
      },
      /** The fs this device's engine uses from now on: a stand-in that fails some calls. */
      set fs(next) {
        deviceFs = next;
      },
      /** The operating system this device reports from now on. */
      set platform(next) {
        platform.platform = next;
      },
      /** Runs instead of the pause before a damaged sync file is read again. */
      set beforeReread(hook) {
        hooks.beforeReread = hook;
      },
      /** Calls an IPC handler as the renderer would. */
      invoke(channel, ...args) {
        if (!handlers[channel]) throw new Error(`No handler registered for ${channel}`);
        return handlers[channel](...args);
      },
      /** Answers `channel` with `handler` instead, as a test running main.js's own handler does. */
      handle(channel, handler) {
        handlers[channel] = handler;
      },
      /** The vm context main.js's config change effects run in, for a test running more of main. */
      get main() {
        return store.context;
      },
      /** The options each native dialog was opened with. */
      dialogCalls,
      dialogParents,
      /** Queues what the next native dialog returns. */
      queueDialogResult(result) {
        dialogResults.push(result);
      },
      rendererConfig,
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
        const previous = config.profileSync;
        const next = rendererConfig();
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
    tempRoot: () => tempRoot,
    syncFilePath,
    readSyncFile,
    baseContent,
    createDevice,
    createSyncedPair,
  };
}

module.exports = {
  createProfileSyncHarness,
  createSafeStorage,
  describeError: translateError,
  profileSyncCore,
};

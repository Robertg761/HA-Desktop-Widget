/**
 * @jest-environment node
 *
 * Runs the real profile sync engine from main.js for several simulated devices
 * sharing one sync folder. Each device is its own vm context with its own
 * config, runtime state, app data folder and clock; only the Electron-facing
 * side effects are stubbed.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const vm = require('vm');
const nodeCrypto = require('crypto');
const profileSyncCore = require('../../profile-sync-core.js');
const { requireExistingSyncParentDirectory } = require('../../src/cloud-sync-path.cjs');
const {
  normalizeProfileSyncRewriteTransaction,
} = require('../../src/profile-sync-rewrite-transaction.cjs');
const { formatTemplate } = require('../../src/i18n-main.cjs');

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
  sliceMain(
    'function isProfileSyncProviderSupported(',
    'async function getGoogleDriveFolderCandidates'
  ),
  sliceMain('function generateProfileSyncDeviceId(', 'function ensureUpdateConfigDefaults('),
  sliceMain('function getProfileSyncConfig(', 'function hasDeferredSecureConfigWork('),
  sliceMain('function buildProfileSyncStatus(', 'function sealProfileSyncTransitionSecret('),
  sliceMain(
    'async function buildProfileSyncEnvelopeForConfig(',
    'async function stageProfileSyncRewrite({'
  ),
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

const PROFILE_SYNC_CONSTANTS = sliceMain(
  'const PROFILE_SYNC_PUSH_DEBOUNCE_MS',
  'const profileSyncRuntime = {'
);

let sharedFolder;
let tempRoot;

beforeEach(() => {
  tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'profile-sync-engine-'));
  sharedFolder = path.join(tempRoot, 'Dropbox');
  fs.mkdirSync(sharedFolder);
});

afterEach(() => {
  fs.rmSync(tempRoot, { recursive: true, force: true });
});

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
 */
function createDevice(name, { content = baseContent(), profileSync = {}, clockOffsetMs = 0 } = {}) {
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

  const context = {
    Date: DeviceDate,
    Buffer,
    console,
    process,
    fs,
    path,
    nodeCrypto,
    profileSyncCore,
    requireExistingSyncParentDirectory,
    normalizeProfileSyncRewriteTransaction,
    app: { getPath: () => userData },
    log: { warn: () => {}, info: () => {}, debug: () => {}, error: () => {} },
    safeStorage: { isEncryptionAvailable: () => false },
    mainT: (key, vars) => formatTemplate(key, vars),
    mainTError: (error) => (typeof error === 'string' ? error : error?.message || ''),
    isPlainObject: (value) => !!value && typeof value === 'object' && !Array.isArray(value),
    isPathInsideDirectory: (target, dir) => !path.relative(dir, target).startsWith('..'),
    preservedEncryptedTokenForRecovery: null,
    mainWindow: null,
    pushes: [],
    savedSnapshots: 0,
  };
  vm.createContext(context);
  vm.runInContext(
    `${PROFILE_SYNC_CONSTANTS}
     var profileSyncRuntime = {
       inFlight: false, pushDebounceTimer: null, intervalTimer: null, pendingPullEchoHash: null,
       conflictCopies: [], lastOpportunisticSyncAt: 0, needsResolution: false,
       pendingRemoteEnvelope: null, pendingRemoteIdentity: null, localProfileHash: null,
       localProfileUpdatedAt: null, localSectionHashes: {}, conflictSections: [],
       lastRunSummary: null, lastRemote: null, passphraseSession: '', passphraseWarning: '',
       approvedCopyDestinationFolders: [],
     };
     ${ENGINE_SOURCE}
     function saveConfig(options = {}) {
       updateLocalProfileSyncTracking({ allowDebouncedPush: options.allowDebouncedPush !== false });
       savedSnapshots += 1;
       return {};
     }
     async function saveConfigDurably(options = {}) {
       saveConfig(options);
       return { success: true, persistenceWarnings: [] };
     }
     function scheduleDebouncedProfileSyncPush(source) { pushes.push(source); }
     function runProfileSync(direction, source) { return runProfileSyncInternal(direction, source); }
     function emitProfileSyncStatus() {}
     function setupProfileSyncInterval() {}
     async function runPostSaveSideEffect(warnings, label, fn) { await fn(); }
     function applyMainWindowSettingSideEffects() {}
     function applyRuntimeConfigSideEffects() {}
     function syncDesktopPinWindowsWithConfig() {}
     function syncTrayEntitiesWithConfig() {}
     function broadcastDesktopPinConfigUpdate() {}
     function pushConfigToRenderer() {}
     function pruneConfig() {}
     function ensureDateTimeFormatConfigDefaults() {}
     function normalizeDesktopPinsConfig() {}
     function normalizeTrayEntitiesConfigInPlace() {}
     function sanitizeConfigForRenderer(value) { return JSON.parse(JSON.stringify(value)); }
     function getDefaultProfileSyncFilePath() { return path.join(app.getPath('userData'), PROFILE_SYNC_DEFAULT_FILE_NAME); }
     var config = null;`,
    context
  );

  context.config = {
    ...JSON.parse(JSON.stringify(content)),
    profileSync: {
      enabled: true,
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

  return {
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
    backups(prefix) {
      const dir = path.join(userData, 'profile-sync-backups');
      if (!fs.existsSync(dir)) return [];
      return fs
        .readdirSync(dir)
        .filter((file) => file.startsWith(prefix))
        .map((file) => JSON.parse(fs.readFileSync(path.join(dir, file), 'utf8')));
    },
  };
}

/** Two devices that have already synced once and agree on everything. */
async function createSyncedPair(options = {}) {
  const desktop = createDevice('desktop', options.desktop);
  const laptop = createDevice('laptop', options.laptop);
  await desktop.sync();
  await laptop.sync();
  return { desktop, laptop };
}

describe('profile sync engine', () => {
  test('keeps edits two devices made to different sections', async () => {
    const { desktop, laptop } = await createSyncedPair();

    laptop.edit((config) => {
      config.favoriteEntities = ['light.kitchen', 'light.porch'];
    });
    await laptop.sync();
    // The desktop changes its opacity before it has seen the laptop's favorite.
    desktop.edit((config) => {
      config.opacity = 0.7;
    });
    const result = await desktop.sync();

    expect(result.action).toBe('merge');
    expect(desktop.config.favoriteEntities).toEqual(['light.kitchen', 'light.porch']);
    expect(desktop.config.opacity).toBe(0.7);

    await laptop.sync();
    expect(laptop.config.opacity).toBe(0.7);
    expect(laptop.config.favoriteEntities).toEqual(['light.kitchen', 'light.porch']);
  });

  test('a device with a fast clock does not undo another device’s change', async () => {
    const { desktop, laptop } = await createSyncedPair({
      laptop: { clockOffsetMs: 6 * 60 * 60 * 1000 },
    });

    desktop.edit((config) => {
      config.ui = { ...config.ui, theme: 'light' };
    });
    await desktop.sync();

    const result = await laptop.sync();
    expect(result.action).toBe('pull');
    expect(laptop.config.ui.theme).toBe('light');
    expect(readSyncFile().updatedByDeviceId).toBe(desktop.config.profileSync.deviceId);
  });

  test('when both devices change the same section the newer edit wins and the other is backed up', async () => {
    const { desktop, laptop } = await createSyncedPair();

    desktop.edit((config) => {
      config.opacity = 0.6;
    });
    await desktop.sync();
    await new Promise((resolve) => setTimeout(resolve, 5));
    laptop.edit((config) => {
      config.opacity = 0.8;
    });
    const laptopResult = await laptop.sync();

    // The laptop's edit is newer, so it replaces the desktop's in the file, and the
    // desktop's version is kept in the laptop's backups.
    expect(laptopResult.action).toBe('push');
    expect(laptop.backups('remote-profile')).toHaveLength(1);
    expect(laptop.backups('remote-profile')[0].sections.visualPersonalization.data.opacity).toBe(
      0.6
    );

    await desktop.sync();
    expect(desktop.config.opacity).toBe(0.8);
    expect(desktop.backups('local-profile')[0].sections.visualPersonalization.opacity).toBe(0.6);
  });

  test('Sync Up backs up the file’s version of every section it replaces', async () => {
    const { laptop } = await createSyncedPair();
    // Only this computer changed the section, so a merge would not count it as a conflict.
    laptop.edit((config) => {
      config.opacity = 0.4;
    });

    await laptop.sync('push', 'manual');

    const backups = laptop.backups('remote-profile');
    expect(backups).toHaveLength(1);
    expect(backups[0].sections.visualPersonalization.data.opacity).toBe(0.9);
  });

  test('restoring a backup applies it here and syncs it to the other devices', async () => {
    const { desktop, laptop } = await createSyncedPair();
    desktop.edit((config) => {
      config.opacity = 0.6;
    });
    await desktop.sync();
    await new Promise((resolve) => setTimeout(resolve, 5));
    laptop.edit((config) => {
      config.opacity = 0.8;
    });
    await laptop.sync();

    const backups = await laptop.context.listProfileSyncBackups();
    const replacedRemote = backups.find((backup) => backup.kind === 'remote');
    expect(replacedRemote.sections).toContain('visualPersonalization');

    await laptop.context.restoreProfileSyncBackup(replacedRemote.id);
    expect(laptop.config.opacity).toBe(0.6);
    expect(laptop.context.pushes).toContain('config_change');
    // The settings the restore replaced are backed up too, so it can be undone.
    expect(laptop.backups('local-profile').length).toBeGreaterThan(0);

    await laptop.sync();
    await desktop.sync();
    expect(desktop.config.opacity).toBe(0.6);

    await expect(laptop.context.restoreProfileSyncBackup('../config.json')).rejects.toThrow(
      'That backup is no longer available'
    );
  });

  test('scope belongs to each device and pushes keep sections other devices sync', async () => {
    const desktop = createDevice('desktop');
    await desktop.sync();
    const laptop = createDevice('laptop', {
      content: { ...baseContent(), favoriteEntities: [], opacity: 0.9 },
      profileSync: { syncScope: { preset: 'visual' } },
    });
    await laptop.sync();

    laptop.edit((config) => {
      config.opacity = 0.75;
    });
    await laptop.sync();

    expect(laptop.config.favoriteEntities).toEqual([]);
    expect(laptop.config.profileSync.syncScope.preset).toBe('visual');
    const file = readSyncFile();
    expect(file.syncScope).toBeUndefined();
    expect(file.payload.sections.quickAccessLayout.data.favoriteEntities).toEqual([
      'light.kitchen',
    ]);

    await desktop.sync();
    expect(desktop.config.opacity).toBe(0.75);
    expect(desktop.config.favoriteEntities).toEqual(['light.kitchen']);
    expect(desktop.config.profileSync.syncScope.preset).toBe('all');
  });

  test('never writes desktop pins, hotkeys, the open page or display-specific ui to the file', async () => {
    const desktop = createDevice('desktop', {
      content: {
        ...baseContent(),
        activeTabId: 'tab-2',
        desktopPins: { 'light.kitchen': { x: 1800, y: 40, width: 176, height: 176 } },
        globalHotkeys: { enabled: true, hotkeys: { 'light.kitchen': 'Command+K' } },
        popupHotkey: 'Command+Space',
        ui: { theme: 'dark', scale: 1.5, followOmarchy: true, enableInteractionDebugLogs: true },
      },
    });
    await desktop.sync();

    const text = fs.readFileSync(syncFilePath(), 'utf8');
    expect(text).not.toContain('desktopPins');
    expect(text).not.toContain('Command+');
    expect(text).not.toContain('tab-2');
    expect(text).not.toContain('scale');
    expect(text).not.toContain('followOmarchy');

    const laptop = createDevice('laptop', {
      content: { ...baseContent(), ui: { theme: 'light', scale: 1 } },
    });
    // Joining with different content, the user chose Use Remote.
    await laptop.sync('pull', 'first_enable_resolution');
    expect(laptop.config.ui).toEqual({ theme: 'dark', scale: 1 });
    expect(laptop.config.desktopPins).toEqual({});
  });

  test('a first sync against a different profile asks which side to keep', async () => {
    const desktop = createDevice('desktop');
    await desktop.sync();
    const laptop = createDevice('laptop', {
      content: { ...baseContent(), favoriteEntities: ['switch.fan'], opacity: 0.9 },
    });

    const resolution = await laptop.firstEnable();
    expect(resolution.needsResolution).toBe(true);
    expect(laptop.status().conflictSections).toEqual(['quickAccessLayout']);
  });

  test('choosing a side for a newly added section leaves other pending edits alone', async () => {
    const desktop = createDevice('desktop');
    await desktop.sync();
    const laptop = createDevice('laptop', {
      content: { ...baseContent(), favoriteEntities: ['switch.fan'] },
      profileSync: { syncScope: { preset: 'visual' } },
    });
    await laptop.sync();

    // The laptop changes its opacity offline, then starts syncing layout too.
    laptop.edit((config) => {
      config.opacity = 0.5;
    });
    laptop.config.profileSync.syncScope = profileSyncCore.normalizeSyncScope({ preset: 'all' });
    const resolution = await laptop.firstEnable();
    expect(resolution.needsResolution).toBe(true);
    expect(laptop.status().conflictSections).toEqual(['quickAccessLayout']);

    // Use Remote for the section the prompt named.
    await laptop.context.runProfileSyncInternal('pull', 'first_enable_resolution', {
      expectedRemoteIdentity: laptop.context.profileSyncRuntime.pendingRemoteIdentity,
      forceSections: [...laptop.context.profileSyncRuntime.conflictSections],
    });

    expect(laptop.config.favoriteEntities).toEqual(['light.kitchen']);
    expect(laptop.config.opacity).toBe(0.5);
    await desktop.sync();
    expect(desktop.config.opacity).toBe(0.5);
  });

  test('a choice made after the file stopped conflicting forces nothing', async () => {
    const desktop = createDevice('desktop');
    await desktop.sync();
    const laptop = createDevice('laptop', {
      content: { ...baseContent(), favoriteEntities: ['switch.fan'] },
      profileSync: { syncScope: { preset: 'visual' } },
    });
    await laptop.sync();
    laptop.edit((config) => {
      config.opacity = 0.5;
    });
    laptop.config.profileSync.syncScope = profileSyncCore.normalizeSyncScope({ preset: 'all' });
    await laptop.firstEnable();
    expect(laptop.status().conflictSections).toEqual(['quickAccessLayout']);

    // While the prompt is open, the desktop adopts the laptop's favorites.
    desktop.edit((config) => {
      config.favoriteEntities = ['switch.fan'];
    });
    await desktop.sync();
    await expect(laptop.context.verifyPendingRemoteEnvelopeUnchanged()).rejects.toThrow(
      'The remote profile changed while waiting for conflict resolution'
    );
    expect(laptop.context.profileSyncRuntime.conflictSections).toEqual([]);

    // Retrying Use Remote, as the resolve handler does, keeps the unrelated local edit.
    await laptop.context.runProfileSyncInternal('pull', 'first_enable_resolution', {
      expectedRemoteIdentity: laptop.context.profileSyncRuntime.pendingRemoteIdentity,
      forceSections: [...laptop.context.profileSyncRuntime.conflictSections],
    });
    expect(laptop.config.opacity).toBe(0.5);
  });

  test('refuses to push plaintext over an encrypted file', async () => {
    const desktop = createDevice('desktop', {
      profileSync: { encryptionEnabled: true, __passphrase: 'correct horse' },
    });
    await desktop.sync();
    const before = fs.readFileSync(syncFilePath(), 'utf8');

    const laptop = createDevice('laptop');
    await expect(laptop.sync()).rejects.toThrow('The sync file is encrypted.');
    expect(fs.readFileSync(syncFilePath(), 'utf8')).toBe(before);
  });

  test('refuses to re-encrypt with a passphrase the file no longer uses', async () => {
    const desktop = createDevice('desktop', {
      profileSync: { encryptionEnabled: true, __passphrase: 'new passphrase' },
    });
    await desktop.sync();
    const laptop = createDevice('laptop', {
      profileSync: { encryptionEnabled: true, __passphrase: 'old passphrase' },
    });
    laptop.edit((config) => {
      config.opacity = 0.5;
    });

    await expect(laptop.sync()).rejects.toThrow('The sync passphrase does not match');
    const decoded = await profileSyncCore.decodeEnvelopeSections(readSyncFile(), 'new passphrase');
    expect(decoded.sections.visualPersonalization.data.opacity).toBe(0.9);
  });

  test('upgrades a version 2 file, taking the newer remote content once', async () => {
    fs.writeFileSync(
      syncFilePath(),
      JSON.stringify({
        schemaVersion: 2,
        updatedAt: new Date(Date.now() + 60_000).toISOString(),
        updatedByDeviceId: 'old-device',
        syncScope: { preset: 'all' },
        payload: {
          ...baseContent(),
          favoriteEntities: ['light.from_v2'],
          desktopPins: { 'light.from_v2': { x: 5, y: 5 } },
        },
      })
    );
    const desktop = createDevice('desktop', {
      profileSync: { profileUpdatedAt: new Date(Date.now() - 60_000).toISOString() },
    });

    const result = await desktop.sync();
    expect(result.pulled).toEqual(['quickAccessLayout']);
    expect(desktop.config.favoriteEntities).toEqual(['light.from_v2']);
    expect(desktop.config.desktopPins).toEqual({});

    desktop.edit((config) => {
      config.opacity = 0.5;
    });
    await desktop.sync();
    const file = readSyncFile();
    expect(file.schemaVersion).toBe(3);
    expect(file.payload.sections.quickAccessLayout.data.favoriteEntities).toEqual([
      'light.from_v2',
    ]);
  });

  test('keeps sections and fields written by a newer version', async () => {
    const desktop = createDevice('desktop');
    await desktop.sync();
    const file = readSyncFile();
    file.schemaVersion = 4;
    file.minReaderVersion = 3;
    file.futureEnvelopeField = { mode: 'x' };
    file.payload.futurePayloadField = [1, 2];
    file.payload.sections.futureSection = {
      updatedAt: file.updatedAt,
      updatedByDeviceId: 'future-device',
      data: { novel: true },
    };
    file.payload.sections.visualPersonalization.data.futureField = 'kept';
    fs.writeFileSync(syncFilePath(), JSON.stringify(file));

    desktop.edit((config) => {
      config.opacity = 0.55;
    });
    await desktop.sync();

    const written = readSyncFile();
    // Still labelled as the newer version, with everything that version added.
    expect(written.schemaVersion).toBe(4);
    expect(written.minReaderVersion).toBe(3);
    expect(written.futureEnvelopeField).toEqual({ mode: 'x' });
    expect(written.payload.futurePayloadField).toEqual([1, 2]);
    expect(written.payload.sections.futureSection.data).toEqual({ novel: true });
    expect(written.payload.sections.visualPersonalization.data).toMatchObject({
      opacity: 0.55,
      futureField: 'kept',
    });
  });

  test('a stale renderer echo after a pull is not pushed back out', async () => {
    const { desktop, laptop } = await createSyncedPair();
    laptop.edit((config) => {
      config.opacity = 0.65;
    });
    await laptop.sync();
    await desktop.sync();
    expect(desktop.config.opacity).toBe(0.65);

    // A config snapshot from before the pull arrives afterwards.
    desktop.edit((config) => {
      config.opacity = 0.9;
    });
    await desktop.sync();

    expect(desktop.config.opacity).toBe(0.65);
    const decoded = await profileSyncCore.decodeEnvelopeSections(readSyncFile());
    expect(decoded.sections.visualPersonalization.data.opacity).toBe(0.65);
  });

  test('refuses to write a file other devices would reject as too large', async () => {
    const desktop = createDevice('desktop', {
      content: { ...baseContent(), customEntityNames: { big: 'x'.repeat(600 * 1024) } },
    });
    await expect(desktop.sync()).rejects.toThrow('Sync file exceeds size limit (512 KB)');
    expect(fs.existsSync(syncFilePath())).toBe(false);
  });

  test('reports when the file was last written and by whom', async () => {
    const { desktop, laptop } = await createSyncedPair();
    laptop.edit((config) => {
      config.opacity = 0.7;
    });
    await laptop.sync();
    await desktop.sync();

    const status = desktop.status();
    expect(status.lastRemoteUpdatedByThisDevice).toBe(false);
    expect(status.lastSuccessfulSyncAt).toEqual(expect.any(String));
    expect(status.lastRunSummary.pulled).toEqual(['visualPersonalization']);
  });
});

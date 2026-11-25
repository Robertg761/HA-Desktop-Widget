/**
 * The profile sync engine: everything that keeps this device's synced settings and a shared
 * copy in step, behind one interface. main.js creates it with its adapters and calls it from its
 * IPC handlers and config change effects; nothing outside this file needs profile-sync-core.js
 * or the rewrite transaction.
 *
 * The shared copy is a sync target, one of two adapters picked by the provider setting: a file in
 * a folder some other program replicates (Dropbox, Syncthing, ...), or a hosted Cloud Sync
 * account. Merging, ordering, backups, first-enable conflicts, encryption and crash recovery work
 * the same way against either.
 *
 * Ports (all injected, so tests run the real engine against a temp folder and a fake service):
 * the main-process config store, fs (the folder target and the backups), the Cloud Sync client
 * (the hosted target), safeStorage (seals secrets), a Date (the clock), timers, the native folder
 * dialog, translation, a log, and a status sink the renderer listens on.
 */

const path = require('path');
const nodeCrypto = require('crypto');
const profileSyncCore = require('../profile-sync-core.js');
const { requireExistingSyncParentDirectory } = require('./cloud-sync-path.cjs');
const {
  createProfileSyncRewriteTransaction,
  normalizeProfileSyncRewriteTransaction,
  profileSyncRewriteEndpointMatches,
  isSecureProfileSyncStorageAvailable,
  classifyProfileSyncPassphraseSubmission,
  resolveProfileSyncEncryptionRequest,
  stageProfileSyncRewriteTransaction,
  runProfileSyncRewriteRecovery,
  REWRITE_TRANSACTION_INVALID,
  createRewriteTransactionError,
} = require('./profile-sync-rewrite-transaction.cjs');
const { isPathInsideDirectory, validateProfileSyncCopyPaths } = require('./main-security.cjs');
const { createLatestTaskCoalescer } = require('./serialized-task-runner.cjs');
const { replaceConfigContents } = require('./main-config-store.cjs');

const PROFILE_SYNC_PUSH_DEBOUNCE_MS = 2000;
// After Cloud Sync refuses a save for want of a subscription, automatic runs only download
// for this long; Sync now, signing in and a renewed subscription try saving straight away.
const CLOUD_SYNC_WRITE_RETRY_MS = 6 * 60 * 60 * 1000;
const PROFILE_SYNC_DEFAULT_INTERVAL_MINUTES = 5;
const PROFILE_SYNC_MAX_FILE_BYTES = 512 * 1024;
const PROFILE_SYNC_MIN_PASSPHRASE_LENGTH = 8;
// Floor between syncs triggered by focus or resume, so alt-tabbing does not turn
// into constant reads of a cloud-synced folder.
const PROFILE_SYNC_OPPORTUNISTIC_MIN_GAP_MS = 60 * 1000;
const PROFILE_SYNC_BACKUP_DIR_NAME = 'profile-sync-backups';
const PROFILE_SYNC_BACKUP_KEEP = 5;
// Backups holding edits a run threw away (the losing side of a conflict, a stale copy of the
// file) are kept longer: the newest 20, and any younger than 30 days up to 100 in all. A lost
// edit may only be noticed weeks later, long after routine pulls would have pruned it.
const PROFILE_SYNC_DISCARD_BACKUP_KEEP = 20;
const PROFILE_SYNC_DISCARD_BACKUP_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;
const PROFILE_SYNC_DISCARD_BACKUP_LIMIT = 100;
// Pulls remembered for recognising config updates built before them.
const PROFILE_SYNC_PULL_HISTORY_LIMIT = 16;
const PROFILE_SYNC_MAX_APPROVED_COPY_FOLDERS = 10;
const PROFILE_SYNC_RESOLUTION_CHOICES = new Set(['upload_local', 'use_remote', 'cancel']);
// Sync through a hosted account (Cloud Sync) rather than a file in a folder.
const PROFILE_SYNC_HOSTED_PROVIDER = 'hostedAccount';
const PROFILE_SYNC_SUPPORTED_PROVIDERS = new Set([
  PROFILE_SYNC_HOSTED_PROVIDER,
  'cloudFile',
  'googleDrive',
  'dropbox',
  'oneDrive',
  'icloudDrive',
  'syncthing',
]);
// Filenames these providers leave behind when two devices write at once. Their
// presence beside the sync file means a race already happened. OneDrive and iCloud
// name a copy after the original, so theirs are built from the file's own name.
const PROFILE_SYNC_CONFLICT_PATTERNS = [
  /\.sync-conflict-/i, // Syncthing
  /\bconflicted copy\b/i, // Dropbox
  /\(\d+\)\.json$/i, // Google Drive / generic duplicate suffix
];
const PROFILE_SYNC_DEFAULT_FILE_NAME = 'ha-widget-profile-sync.json';

// Written by main as syncs run and as settings change. A renderer snapshot taken
// before the last run would roll them back, so update-config keeps main's.
const PROFILE_SYNC_MAIN_OWNED_RESULT_FIELDS = [
  'lastSyncAt',
  'lastSuccessfulSyncAt',
  'lastSyncStatus',
  'lastSyncError',
  'profileUpdatedAt',
  'deviceId',
];

// Chromium seals an empty string to an empty buffer on some platforms (Linux with a
// Secret Service keyring), and a recovery record needs a value for every secret. The old
// passphrase of a file that is not encrypted yet is empty, so each secret is stored behind
// this marker. Records written before it existed hold the bare secret.
const PROFILE_SYNC_SEALED_SECRET_MARKER = '\u0001ha1:';

const PROFILE_SYNC_SECTION_LABELS = {
  quickAccessLayout: 'Quick Access and layout',
  visualPersonalization: 'Appearance',
  automationAlerts: 'Alerts',
  connectionMediaPreferences: 'Weather and media',
};

const PROFILE_SYNC_TEMP_FILE_MAX_AGE_MS = 60 * 60 * 1000;

const CLOUD_SYNC_ERROR_MESSAGES = {
  CLOUD_SYNC_SIGNED_OUT: 'Sign in to Cloud Sync to keep syncing',
  CLOUD_SYNC_SUBSCRIPTION_REQUIRED: 'Cloud Sync needs a subscription to save changes',
  CLOUD_SYNC_CONFLICT: 'Sync file kept changing on the other device; try again',
  CLOUD_SYNC_NETWORK: 'Cloud Sync could not be reached. Check your connection.',
  CLOUD_SYNC_TIMEOUT: 'Cloud Sync could not be reached. Check your connection.',
  CLOUD_SYNC_UNAVAILABLE: 'Cloud Sync is not available in this version of the app',
  CLOUD_SYNC_SECURE_STORAGE_UNAVAILABLE:
    'Cloud Sync needs secure credential storage, which is unavailable on this system',
  CLOUD_SYNC_TOO_LARGE: 'Sync file exceeds size limit (512 KB)',
  CLOUD_SYNC_SIGN_IN_CANCELED: 'Sign-in was canceled',
  CLOUD_SYNC_SIGN_IN_DECLINED: 'Sign-in was declined in the browser',
  CLOUD_SYNC_SIGN_IN_FAILED: 'Sign-in did not complete. Try again.',
  CLOUD_SYNC_SIGN_IN_TIMEOUT: 'Sign-in timed out. Try again.',
  CLOUD_SYNC_BILLING_UNAVAILABLE: 'Subscriptions are not available right now',
  CLOUD_SYNC_NO_BILLING_ACCOUNT: 'There is no subscription to manage yet',
  CLOUD_SYNC_BILLING_BUSY: 'A billing change is in progress. Try again shortly.',
  CLOUD_SYNC_BILLING_PENDING: 'Your payment is being processed. Try again shortly.',
  CLOUD_SYNC_SUBSCRIPTION_EXISTS: 'You already have a subscription. Reopen Settings to manage it.',
  CLOUD_SYNC_NOT_LAUNCHED: 'Cloud Sync is not available yet.',
};

// Why a backup was taken. Syncing replaces settings routinely, many times a day with
// several computers; an import or a restore is the person's own undo. The two are kept
// in separate groups, so a busy stretch of syncing cannot push out the one backup
// someone is counting on. A sync backup that holds edits the run discarded (`discarded`
// names their sections) goes in a third group, kept longer still.
const PROFILE_SYNC_MANUAL_BACKUP_REASONS = new Set(['import', 'restore']);

const PROFILE_SYNC_BACKUP_FILE_PATTERN = /^(local|remote)-profile-(\d+)\.json$/;

const PROFILE_SYNC_DAMAGED_REREAD_DELAY_MS = 1500;

function isPlainObject(value) {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

/**
 * Words the failures profile sync reports by code for a person, or '' for any other error. The
 * technical text in the error stays for the log.
 */
function describeKnownProfileSyncFailure(error, mainT) {
  if (profileSyncCore.isSyncFileDamagedError(error)) {
    return mainT(
      "The sync file is damaged. Use Sync up to replace it with this computer's settings; the old file is backed up first."
    );
  }
  if (error?.code === REWRITE_TRANSACTION_INVALID) {
    return mainT("Could not update the sync file's encryption. Nothing was changed. Try again.");
  }
  return '';
}

/**
 * Gives entityAlerts its full shape after a sync pull or backup restore, which
 * can bring a partial object or clear it altogether.
 */
function ensureEntityAlertsConfigDefaults(target) {
  const current = isPlainObject(target.entityAlerts) ? target.entityAlerts : {};
  target.entityAlerts = {
    ...current,
    enabled: current.enabled === true,
    alerts: isPlainObject(current.alerts) ? current.alerts : {},
  };
  return target;
}

/**
 * Whether two Cloud Sync sign-ins are the same account: by id, or by email for a
 * sign-in saved before ids were kept. Two accounts without an email never match.
 */
function isSameCloudSyncAccount(previousAccount, account) {
  if (!previousAccount || !account) return false;
  if (previousAccount.id && account.id) return previousAccount.id === account.id;
  return !!previousAccount.email && previousAccount.email === account.email;
}

/**
 * Adds a pull to the history, merging the two oldest entries once it is full.
 * The merged entry keeps the older state and where its range began: an update
 * built before the range is still compared exactly, and one built inside it,
 * whose starting state is gone, is handled conservatively.
 */
function appendPendingPull(pulls, pull) {
  let next = [...(pulls || []), pull];
  while (next.length > PROFILE_SYNC_PULL_HISTORY_LIMIT) {
    const [oldest, following, ...rest] = next;
    next = [
      {
        profile: oldest.profile,
        revision: following.revision,
        compactedFrom:
          typeof oldest.compactedFrom === 'number' ? oldest.compactedFrom : oldest.revision,
      },
      ...rest,
    ];
  }
  return next;
}

/**
 * @param {object} ports
 * @param {object} ports.configStore the main-process config store (src/main-config-store.cjs)
 * @param {object} ports.fs node's fs: the folder target, the backups and copying a sync file
 * @param {{getPath: (name: 'userData'|'home') => string}} ports.app where the app data folder
 *   (backups, the default sync file) and the home folder (sync apps' usual folders) are
 * @param {{platform: string, env: object}} ports.process the operating system
 * @param {object} ports.safeStorage Electron's safeStorage, which seals remembered passphrases
 *   and the secrets of a staged key rewrite
 * @param {DateConstructor} [ports.Date] the clock
 * @param {() => object} ports.getCloudSyncClient the Cloud Sync client (src/cloud-sync-client.cjs)
 * @param {{showOpenDialog: Function}} ports.dialog Electron's dialog, for choosing a sync folder
 * @param {() => () => void} ports.suspendAutoHide keeps the widget up while a dialog is open;
 *   returns what ends that
 * @param {(key: string, vars?: object) => string} ports.t translates a catalog key
 * @param {(error: Error|string) => string} ports.tError words an error for the renderer
 * @param {object} ports.log
 * @param {(buildStatus: () => object) => void} ports.sendStatus tells the renderer the status;
 *   called with what builds it, so nothing is built while no window listens
 * @param {() => object} ports.rendererConfig the config as the renderer receives it
 * @param {(config: object) => void} ports.normalizeConfig normalizes the rest of a config a pull,
 *   a restore or an import replaced (the sync settings are the engine's)
 * @param {() => () => void} ports.snapshotMainState captures main-owned state that a pull which
 *   cannot be written puts back; returns what puts it back
 * @param {(ms: number) => Promise<void>} [ports.sleep] waits before a damaged file is read again
 */
function createProfileSyncEngine({
  configStore,
  fs,
  app,
  process,
  safeStorage,
  Date = globalThis.Date,
  getCloudSyncClient,
  dialog,
  suspendAutoHide,
  t: mainT,
  tError: mainTError,
  log,
  sendStatus,
  rendererConfig,
  normalizeConfig,
  snapshotMainState,
  setTimeout = globalThis.setTimeout,
  clearTimeout = globalThis.clearTimeout,
  setInterval = globalThis.setInterval,
  clearInterval = globalThis.clearInterval,
  sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
}) {
  const profileSyncRuntime = {
    inFlight: false,
    pushDebounceTimer: null,
    intervalTimer: null,
    // Hash of the scoped profile as it stood immediately before a pulled profile
    // was applied. Armed by applySyncedProfileToConfig so the renderer's stale
    // config echo can be recognised by content rather than by timing; see
    // updateLocalProfileSyncTracking.
    pendingPullEchoHash: null,
    // The synced profile as it stood before that pull, for updates that carry no
    // config revision.
    pendingPullEchoProfile: null,
    // Pulls applied this session, oldest first: the synced profile as it stood
    // before each, and the config revision the renderer first sees it in. An
    // update built from an older revision is compared with the profile before the
    // first pull it missed. Kept after an update is answered, since another one
    // built earlier (a rollback snapshot) can still follow.
    pendingPulls: [],
    // Cloud Sync revision of the last read; the next write expects it unchanged.
    hostedRevision: null,
    // When Cloud Sync last refused a save because the account has no subscription (0: never).
    cloudSyncWriteRefusedAt: 0,
    // Conflict-copy filenames found beside the sync file on the last run. Refreshed
    // by sync runs because the check needs the filesystem.
    conflictCopies: [],
    lastOpportunisticSyncAt: 0,
    needsResolution: false,
    pendingRemoteEnvelope: null,
    pendingRemoteIdentity: null,
    localProfileHash: null,
    localProfileUpdatedAt: null,
    // Hash of each in-scope section as last seen locally. A save that changes a
    // section stamps profileSync.sectionUpdatedAt for it, which only matters when
    // two devices changed the same section and the newer edit has to win.
    localSectionHashes: {},
    // Sections that differ between this device and the file while a first-sync
    // choice is pending, for the conflict prompt.
    conflictSections: [],
    // The subset of conflictSections that are damaged in the file, where only
    // keeping this device's settings can resolve the conflict.
    damagedConflictSections: [],
    // What the last successful run moved, for the status line.
    lastRunSummary: null,
    lastRemote: null,
    passphraseSession: '',
    passphraseWarning: '',
    approvedCopyDestinationFolders: [],
  };

  function refreshProfileSyncRuntimeTracking({ decodePassphrase = true } = {}) {
    if (decodePassphrase) {
      profileSyncRuntime.passphraseSession = decodeStoredProfileSyncPassphrase() || '';
    }
    const activeScope = getActiveProfileSyncScope();
    const initialProfile = profileSyncCore.projectSyncProfile(configStore.get(), activeScope);
    profileSyncRuntime.localProfileHash = computeScopedProfileHash(initialProfile, activeScope);
    profileSyncRuntime.localSectionHashes = computeLocalSectionHashes(activeScope);
    profileSyncRuntime.pendingPullEchoHash = null;
    profileSyncRuntime.pendingPullEchoProfile = null;
    profileSyncRuntime.pendingPulls = [];
    // Seed from the persisted content-change timestamp. lastSyncAt is only a
    // fallback for configs written before profileUpdatedAt existed — it tracks
    // sync *attempts* (including failures), so it must not be preferred here or
    // a string of failed syncs would make the local profile look freshly edited.
    const localProfileUpdatedAtSeed =
      configStore.get()?.profileSync?.profileUpdatedAt ||
      configStore.get()?.profileSync?.lastSyncAt ||
      new Date().toISOString();
    profileSyncRuntime.localProfileUpdatedAt = localProfileUpdatedAtSeed;
    if (configStore.get()?.profileSync && !configStore.get().profileSync.profileUpdatedAt) {
      configStore.get().profileSync.profileUpdatedAt = localProfileUpdatedAtSeed;
      // Persist the migration once. Otherwise a failed attempt can advance
      // lastSyncAt, and the next restart would mistake that failure timestamp for
      // the age of local profile content.
      configStore.save({ origin: 'profile-sync' });
    }
  }

  function isProfileSyncProviderSupported(provider) {
    if (typeof provider !== 'string') return false;
    return PROFILE_SYNC_SUPPORTED_PROVIDERS.has(provider.trim());
  }

  function normalizeProfileSyncProvider(provider) {
    if (!isProfileSyncProviderSupported(provider)) return 'cloudFile';
    return provider.trim();
  }

  async function getGoogleDriveFolderCandidates(home) {
    const candidates = [];

    if (process.platform === 'darwin') {
      // Drive for Desktop mounts one root per signed-in account under CloudStorage,
      // named GoogleDrive-<account>. The account is unknown here, so enumerate.
      const cloudStorage = path.join(home, 'Library', 'CloudStorage');
      try {
        const entries = await fs.promises.readdir(cloudStorage);
        entries
          .filter((entry) => entry.startsWith('GoogleDrive-'))
          .forEach((entry) => candidates.push(path.join(cloudStorage, entry, 'My Drive')));
      } catch {
        // CloudStorage is absent unless Drive for Desktop is installed
      }
    }

    if (process.platform === 'win32') {
      // Drive for Desktop mounts a virtual drive, G: by default. Only the default
      // is probed: the letter is user-configurable, and stat on a disconnected
      // network drive can block, so a full A-Z scan is not worth the risk.
      candidates.push(path.join(`G:${path.sep}`, 'My Drive'));
    }

    // Legacy Backup and Sync, and the third-party clients Linux users rely on.
    candidates.push(path.join(home, 'Google Drive'), path.join(home, 'GoogleDrive'));
    return candidates;
  }

  async function getDropboxFolderCandidates(home) {
    const candidates = [];
    // The Dropbox client records its real folder here, which is authoritative when
    // the user moved it off the default location.
    try {
      const info = JSON.parse(
        await fs.promises.readFile(path.join(home, '.dropbox', 'info.json'), 'utf8')
      );
      Object.values(info || {}).forEach((account) => {
        if (account && typeof account.path === 'string' && account.path.trim()) {
          candidates.push(account.path.trim());
        }
      });
    } catch {
      // info.json is absent unless the desktop client is installed
    }
    candidates.push(path.join(home, 'Dropbox'));
    return candidates;
  }

  function getOneDriveFolderCandidates(home) {
    // The client exports its root through these, covering relocated folders and
    // the personal/business split.
    return [
      process.env.OneDrive,
      process.env.OneDriveConsumer,
      process.env.OneDriveCommercial,
      path.join(home, 'OneDrive'),
    ].filter((candidate) => typeof candidate === 'string' && candidate.trim());
  }

  async function getProviderDefaultFolderCandidates(provider) {
    let home;
    try {
      home = app.getPath('home');
    } catch {
      return [];
    }
    if (provider === 'googleDrive') {
      return getGoogleDriveFolderCandidates(home);
    }
    if (provider === 'dropbox') {
      return getDropboxFolderCandidates(home);
    }
    if (provider === 'oneDrive') {
      return getOneDriveFolderCandidates(home);
    }
    if (provider === 'icloudDrive') {
      if (process.platform === 'darwin') {
        return [path.join(home, 'Library', 'Mobile Documents', 'com~apple~CloudDocs')];
      }
      return [path.join(home, 'iCloudDrive'), path.join(home, 'iCloud Drive')];
    }
    if (provider === 'syncthing') {
      return [path.join(home, 'Sync'), path.join(home, 'Syncthing')];
    }
    return [];
  }

  /**
   * Where the folder chooser opens: the folder already in use, else the sync app's usual
   * folder. The app's own data folder never counts as in use. It holds the default sync
   * file that nothing replicates, so starting there would hide the sync app's folder.
   */
  async function getDefaultProfileSyncFolderPath(provider, existingFolder = '') {
    if (existingFolder && existingFolder !== '.' && !isProfileSyncFolderUnsynced(existingFolder)) {
      return existingFolder;
    }
    for (const candidate of await getProviderDefaultFolderCandidates(
      normalizeProfileSyncProvider(provider)
    )) {
      try {
        if ((await fs.promises.stat(candidate)).isDirectory()) return candidate;
      } catch {
        // candidate does not exist; try the next one
      }
    }
    return app.getPath('userData');
  }

  function generateProfileSyncDeviceId() {
    // Fully random: the ID is written into the shared sync file, so it must not
    // leak host details such as the machine name.
    return (
      nodeCrypto
        .randomBytes(16)
        .toString('base64')
        .replace(/[^a-zA-Z0-9]/g, '')
        .slice(0, 20) || 'device'
    );
  }

  function getDefaultProfileSyncFilePath() {
    return path.join(app.getPath('userData'), PROFILE_SYNC_DEFAULT_FILE_NAME);
  }

  // A sync file path the renderer may switch to: the fixed file name inside the
  // app data folder, the folder already in use, or a folder picked in the native
  // dialog during this run.
  function isApprovedProfileSyncFilePath(filePath, currentFilePath = '') {
    if (typeof filePath !== 'string' || !filePath || !path.isAbsolute(filePath)) return false;
    const resolvedPath = path.resolve(filePath);
    if (path.basename(resolvedPath) !== PROFILE_SYNC_DEFAULT_FILE_NAME) return false;
    const folder = path.dirname(resolvedPath);
    const approvedFolders = [
      app.getPath('userData'),
      currentFilePath ? path.dirname(currentFilePath) : '',
      ...profileSyncRuntime.approvedCopyDestinationFolders,
    ];
    return approvedFolders.some(
      (approved) => typeof approved === 'string' && approved && path.resolve(approved) === folder
    );
  }

  function getNormalizedProfileSyncScopeValue(value) {
    return profileSyncCore.normalizeSyncScope(value);
  }

  function normalizeProfileSyncStringMap(value) {
    if (!isPlainObject(value)) return {};
    return Object.fromEntries(
      Object.entries(value).filter(
        ([key, entry]) =>
          profileSyncCore.SYNC_SCOPE_SECTION_KEYS.includes(key) && typeof entry === 'string'
      )
    );
  }

  /** Keeps the agreed-version entries ({hash, updatedAt}) of known sections. */
  function normalizeProfileSyncAgreedMap(value) {
    if (!isPlainObject(value)) return {};
    return Object.fromEntries(
      Object.entries(value)
        .filter(
          ([key, entry]) =>
            profileSyncCore.SYNC_SCOPE_SECTION_KEYS.includes(key) &&
            isPlainObject(entry) &&
            typeof entry.hash === 'string' &&
            typeof entry.updatedAt === 'string' &&
            !Number.isNaN(Date.parse(entry.updatedAt))
        )
        .map(([key, entry]) => [key, { hash: entry.hash, updatedAt: entry.updatedAt }])
    );
  }

  function getDefaultProfileSyncConfig() {
    return {
      enabled: false,
      provider: 'cloudFile',
      cloudFilePath: getDefaultProfileSyncFilePath(),
      syncScope: getNormalizedProfileSyncScopeValue(profileSyncCore.getDefaultSyncScope()),
      intervalMinutes: PROFILE_SYNC_DEFAULT_INTERVAL_MINUTES,
      encryptionEnabled: false,
      encryptionChangePending: null,
      rememberPassphrase: false,
      passphraseEncrypted: false,
      storedPassphrase: '',
      lastSyncAt: null,
      lastSuccessfulSyncAt: null,
      lastSyncStatus: 'idle',
      lastSyncError: '',
      profileUpdatedAt: null,
      // Main-process-owned merge state: each section's hash after the last
      // successful sync, the edit time of that agreed version ({hash, updatedAt},
      // ignored once the hash no longer matches the baseline), and when each
      // section last changed on this device.
      syncBaseline: {},
      syncBaselineUpdatedAt: {},
      sectionUpdatedAt: {},
      firstEnableResolutionPending: false,
      remoteRewritePending: false,
      passphraseTransition: null,
      passphraseTransitionInvalid: false,
      deviceId: generateProfileSyncDeviceId(),
    };
  }

  function ensureProfileSyncConfigDefaults(target) {
    if (!target || typeof target !== 'object') return target;
    const defaults = getDefaultProfileSyncConfig();
    // Fill in place rather than replacing the object: code that holds on to
    // config.profileSync across a helper that calls this again would otherwise
    // write to a detached copy, and those writes (a staged key rewrite, a
    // completion marker) would never be saved.
    const profileSync = isPlainObject(target.profileSync) ? target.profileSync : {};
    Object.keys(defaults).forEach((key) => {
      if (!Object.prototype.hasOwnProperty.call(profileSync, key)) profileSync[key] = defaults[key];
    });
    target.profileSync = profileSync;
    target.profileSync.intervalMinutes = Number.isFinite(Number(target.profileSync.intervalMinutes))
      ? Math.max(1, Math.min(60, Number(target.profileSync.intervalMinutes)))
      : PROFILE_SYNC_DEFAULT_INTERVAL_MINUTES;
    target.profileSync.provider = normalizeProfileSyncProvider(target.profileSync.provider);
    target.profileSync.cloudFilePath =
      typeof target.profileSync.cloudFilePath === 'string' &&
      target.profileSync.cloudFilePath.trim()
        ? target.profileSync.cloudFilePath.trim()
        : getDefaultProfileSyncFilePath();
    target.profileSync.syncScope = getNormalizedProfileSyncScopeValue(target.profileSync.syncScope);
    if (!target.profileSync.deviceId || typeof target.profileSync.deviceId !== 'string') {
      target.profileSync.deviceId = generateProfileSyncDeviceId();
    }
    if (typeof target.profileSync.lastSyncError !== 'string') {
      target.profileSync.lastSyncError = '';
    }
    if (
      target.profileSync.profileUpdatedAt != null &&
      typeof target.profileSync.profileUpdatedAt !== 'string'
    ) {
      target.profileSync.profileUpdatedAt = null;
    }
    if (typeof target.profileSync.lastSuccessfulSyncAt !== 'string') {
      target.profileSync.lastSuccessfulSyncAt = null;
    }
    target.profileSync.syncBaseline = normalizeProfileSyncStringMap(
      target.profileSync.syncBaseline
    );
    target.profileSync.syncBaselineUpdatedAt = normalizeProfileSyncAgreedMap(
      target.profileSync.syncBaselineUpdatedAt
    );
    target.profileSync.sectionUpdatedAt = normalizeProfileSyncStringMap(
      target.profileSync.sectionUpdatedAt
    );
    target.profileSync.firstEnableResolutionPending =
      target.profileSync.firstEnableResolutionPending === true;
    target.profileSync.remoteRewritePending = target.profileSync.remoteRewritePending === true;
    target.profileSync.encryptionChangePending =
      typeof target.profileSync.encryptionChangePending === 'boolean'
        ? target.profileSync.encryptionChangePending
        : null;
    const rawPassphraseTransition = target.profileSync.passphraseTransition;
    const normalizedPassphraseTransition =
      normalizeProfileSyncRewriteTransaction(rawPassphraseTransition);
    target.profileSync.passphraseTransitionInvalid =
      !!rawPassphraseTransition && !normalizedPassphraseTransition;
    target.profileSync.passphraseTransition =
      normalizedPassphraseTransition || rawPassphraseTransition || null;
    if (target.profileSync.passphraseTransition || target.profileSync.passphraseTransitionInvalid) {
      target.profileSync.remoteRewritePending = true;
    }
    return target;
  }

  function getProfileSyncConfig() {
    ensureProfileSyncConfigDefaults(configStore.get());
    return configStore.get().profileSync;
  }

  // The file sync uses until a folder is chosen lives in the app's own data folder, where
  // nothing replicates it. Settings is told there is no folder, so a first enable does not
  // read as a move from that folder and the field asks for one.
  function getRendererSyncFilePath(cloudFilePath) {
    return cloudFilePath === getDefaultProfileSyncFilePath() ? '' : cloudFilePath || '';
  }

  function buildProfileSyncStatus(extra = {}) {
    const profileSync = getProfileSyncConfig();
    const status = {
      enabled: !!profileSync.enabled,
      provider: normalizeProfileSyncProvider(profileSync.provider),
      cloudFilePath: getRendererSyncFilePath(profileSync.cloudFilePath),
      cloudSync: getCloudSyncStatus(),
      syncScope: getNormalizedProfileSyncScopeValue(profileSync.syncScope),
      intervalMinutes: profileSync.intervalMinutes || PROFILE_SYNC_DEFAULT_INTERVAL_MINUTES,
      encryptionEnabled: !!profileSync.encryptionEnabled,
      // What the file itself held when last read: true, false, or null when unknown.
      remoteEncrypted: profileSyncRuntime.remoteEncrypted,
      rememberPassphrase: !!profileSync.rememberPassphrase,
      passphraseEncrypted: !!profileSync.passphraseEncrypted,
      passphraseStored: !!profileSync.storedPassphrase,
      // A passphrase is in use, saved on this device or only held until the app closes.
      // Typing a different one over it re-encrypts the file.
      passphraseActive: !!(profileSyncRuntime.passphraseSession || profileSync.storedPassphrase),
      // Stored messages may be English text from shared helpers or older versions.
      passphraseWarning: mainTError(profileSyncRuntime.passphraseWarning || ''),
      lastSyncAt: profileSync.lastSyncAt || null,
      lastSuccessfulSyncAt: profileSync.lastSuccessfulSyncAt || null,
      lastRemoteUpdatedAt: profileSyncRuntime.lastRemote?.updatedAt || null,
      lastRemoteUpdatedByThisDevice: profileSyncRuntime.lastRemote
        ? profileSyncRuntime.lastRemote.updatedByDeviceId === profileSync.deviceId
        : null,
      lastRunSummary: profileSyncRuntime.lastRunSummary,
      conflictSections: profileSyncRuntime.needsResolution
        ? [...profileSyncRuntime.conflictSections]
        : [],
      damagedConflictSections: profileSyncRuntime.needsResolution
        ? [...profileSyncRuntime.damagedConflictSections]
        : [],
      lastSyncStatus: profileSync.lastSyncStatus || 'idle',
      lastSyncError: mainTError(profileSync.lastSyncError || ''),
      inFlight: !!profileSyncRuntime.inFlight,
      needsResolution:
        !!profileSyncRuntime.needsResolution || !!profileSync.firstEnableResolutionPending,
      firstEnableResolutionPending: !!profileSync.firstEnableResolutionPending,
      resolutionRetryRequired:
        !!profileSync.firstEnableResolutionPending && !profileSyncRuntime.needsResolution,
      remoteRewritePending: !!profileSync.remoteRewritePending,
      rewriteRecoveryRequired:
        !!profileSync.passphraseTransition || !!profileSync.passphraseTransitionInvalid,
      rewriteRecoveryInvalid: !!profileSync.passphraseTransitionInvalid,
      encryptionChangePending:
        typeof profileSync.encryptionChangePending === 'boolean'
          ? profileSync.encryptionChangePending
          : null,
      deviceId: profileSync.deviceId,
      // Machine-readable codes rather than sentences, so the wording stays in the
      // renderer with the rest of the translated UI text.
      folderWarnings: collectProfileSyncFolderWarnings(),
      conflictCopies: [...profileSyncRuntime.conflictCopies],
      ...extra,
    };
    return status;
  }

  function hasProfileSyncCredentialTransitionPending(profileSync = getProfileSyncConfig()) {
    return (
      !!profileSync.passphraseTransition ||
      !!profileSync.passphraseTransitionInvalid ||
      typeof profileSync.encryptionChangePending === 'boolean' ||
      !!profileSync.remoteRewritePending
    );
  }

  /**
   * Conditions that make a sync setup look healthy while not actually working.
   * Only the cheap synchronous checks live here; conflict-copy detection needs the
   * filesystem and is refreshed on sync runs instead.
   *
   * @returns {string[]} warning codes for the renderer to translate
   */
  function collectProfileSyncFolderWarnings() {
    const profileSync = getProfileSyncConfig();
    return syncTargetFor(profileSync.provider).warnings(profileSync);
  }

  function collectSyncFolderWarnings(profileSync) {
    const warnings = [];
    if (profileSync.enabled && isProfileSyncFolderUnsynced(profileSync.cloudFilePath)) {
      warnings.push('unsynced_folder');
    }
    // Google has never shipped a Linux client, so picking that provider here means
    // a third-party tool or nothing at all.
    if (
      normalizeProfileSyncProvider(profileSync.provider) === 'googleDrive' &&
      process.platform === 'linux'
    ) {
      warnings.push('google_drive_linux');
    }
    if (profileSyncRuntime.conflictCopies.length > 0) {
      warnings.push('conflict_copies');
    }

    return warnings;
  }

  /** Cloud Sync as the settings show it, from local state only (no network). */
  function getCloudSyncStatus() {
    const client = getCloudSyncClient();
    const account = client.getStoredAccount();
    return {
      available: client.isAvailable(),
      signedIn: !!account,
      email: account?.email || '',
      provider: account?.provider || '',
      signInPending: !!client.signInController,
    };
  }

  /**
   * Replaces the sync-result fields of an incoming profileSync object with the
   * values main holds.
   */
  function keepMainOwnedProfileSyncResults(nextProfileSync, currentProfileSync) {
    PROFILE_SYNC_MAIN_OWNED_RESULT_FIELDS.forEach((field) => {
      if (currentProfileSync && Object.prototype.hasOwnProperty.call(currentProfileSync, field)) {
        nextProfileSync[field] = currentProfileSync[field];
      } else {
        delete nextProfileSync[field];
      }
    });
    return nextProfileSync;
  }

  function updateProfileSyncStatus(status, errorMessage = '') {
    const profileSync = getProfileSyncConfig();
    profileSync.lastSyncAt = new Date().toISOString();
    profileSync.lastSyncStatus = status;
    profileSync.lastSyncError = errorMessage || '';
    if (status === 'success') {
      profileSync.lastSuccessfulSyncAt = profileSync.lastSyncAt;
    }
    configStore.save({ origin: 'local' });
  }

  function decodeStoredProfileSyncPassphrase() {
    const profileSync = getProfileSyncConfig();
    profileSyncRuntime.passphraseWarning = '';
    if (!profileSync.rememberPassphrase || !profileSync.storedPassphrase) {
      return '';
    }

    if (profileSync.passphraseEncrypted) {
      if (!safeStorage.isEncryptionAvailable()) {
        profileSyncRuntime.passphraseWarning = mainT(
          'Stored passphrase could not be decrypted on this system.'
        );
        return '';
      }
      try {
        const encryptedBuffer = Buffer.from(profileSync.storedPassphrase, 'base64');
        return safeStorage.decryptString(encryptedBuffer);
      } catch (error) {
        log.warn('Failed to decrypt remembered profile sync passphrase:', error.message);
        profileSyncRuntime.passphraseWarning = mainT('Stored passphrase could not be decrypted.');
        return '';
      }
    }

    return profileSync.storedPassphrase;
  }

  /** Drops the sync passphrase from this device, for a file that no longer needs one. */
  function forgetProfileSyncPassphrase(profileSync) {
    profileSync.rememberPassphrase = false;
    profileSync.passphraseEncrypted = false;
    profileSync.storedPassphrase = '';
    profileSyncRuntime.passphraseSession = '';
    profileSyncRuntime.passphraseWarning = '';
  }

  function persistRememberedProfileSyncPassphrase(passphrase, remember) {
    const profileSync = getProfileSyncConfig();

    // An empty passphrase has nothing to remember, and sealing it would store nothing.
    if (!remember || !passphrase) {
      profileSync.rememberPassphrase = false;
      profileSync.passphraseEncrypted = false;
      profileSync.storedPassphrase = '';
      profileSyncRuntime.passphraseSession = passphrase || '';
      return { remembered: false, encrypted: false };
    }

    profileSync.rememberPassphrase = true;
    profileSyncRuntime.passphraseSession = passphrase || '';
    profileSyncRuntime.passphraseWarning = '';

    if (safeStorage.isEncryptionAvailable()) {
      try {
        const encrypted = safeStorage.encryptString(passphrase || '');
        profileSync.storedPassphrase = encrypted.toString('base64');
        profileSync.passphraseEncrypted = true;
        return { remembered: true, encrypted: true };
      } catch (error) {
        log.warn('Failed to encrypt remembered profile sync passphrase:', error.message);
      }
    }

    profileSync.rememberPassphrase = false;
    profileSync.passphraseEncrypted = false;
    profileSync.storedPassphrase = '';
    profileSyncRuntime.passphraseWarning = mainT(
      'Passphrase will only be kept for this session because OS encryption is unavailable.'
    );
    return { remembered: false, encrypted: false };
  }

  function getActiveProfileSyncPassphrase() {
    if (profileSyncRuntime.passphraseSession) {
      return profileSyncRuntime.passphraseSession;
    }
    const remembered = decodeStoredProfileSyncPassphrase();
    if (remembered) {
      profileSyncRuntime.passphraseSession = remembered;
    }
    return remembered;
  }

  function sealProfileSyncTransitionSecret(secret) {
    if (!isSecureProfileSyncStorageAvailable(safeStorage, process.platform)) {
      throw new Error(
        mainT('Secure OS credential storage is required to change an active sync passphrase safely')
      );
    }
    const encrypted = safeStorage.encryptString(
      PROFILE_SYNC_SEALED_SECRET_MARKER + (typeof secret === 'string' ? secret : '')
    );
    if (!encrypted?.length) {
      throw new Error(
        mainT('Secure OS credential storage is required to change an active sync passphrase safely')
      );
    }
    return encrypted.toString('base64');
  }

  function unsealProfileSyncTransitionSecret(encryptedSecret) {
    if (!isSecureProfileSyncStorageAvailable(safeStorage, process.platform)) {
      throw new Error(
        mainT('Secure OS credential storage is unavailable for pending sync-key recovery')
      );
    }
    try {
      const secret = safeStorage.decryptString(Buffer.from(encryptedSecret, 'base64'));
      return secret.startsWith(PROFILE_SYNC_SEALED_SECRET_MARKER)
        ? secret.slice(PROFILE_SYNC_SEALED_SECRET_MARKER.length)
        : secret;
    } catch {
      throw new Error(mainT('Pending sync-key recovery credentials could not be decrypted'));
    }
  }

  /**
   * Builds a sync file from a config for the rewrite transaction (encryption and
   * passphrase changes). Sections already in the file are carried over as they
   * are, including ones this device does not sync; in-scope sections the file
   * lacks are added from the config.
   */
  async function buildProfileSyncEnvelopeForConfig(
    sourceConfig,
    {
      encrypt,
      passphrase,
      remoteSections = {},
      remoteExtensions = null,
      updatedAt = new Date().toISOString(),
    }
  ) {
    const profileSync = sourceConfig?.profileSync || getProfileSyncConfig();
    const syncScope = getNormalizedProfileSyncScopeValue(profileSync.syncScope);
    const localSections = profileSyncCore.buildLocalSections(sourceConfig, syncScope);
    const sections = { ...remoteSections };
    Object.entries(localSections).forEach(([key, data]) => {
      if (sections[key]) return;
      sections[key] = profileSyncCore.buildPushedSectionEntry(key, data, null, {
        updatedAt: profileSync.sectionUpdatedAt?.[key] || updatedAt,
        deviceId: profileSync.deviceId,
      });
    });
    return profileSyncCore.buildSyncEnvelope({
      sections,
      updatedAt,
      updatedByDeviceId: profileSync.deviceId,
      encrypt: encrypt === true,
      passphrase: passphrase || '',
      extensions: remoteExtensions,
    });
  }

  function createDamagedSyncSectionsError(sectionKeys) {
    return new Error(
      mainT(
        "The sync file's {{sections}} settings are damaged. Use Sync up to replace them with this computer's; the damaged copy is backed up first.",
        {
          sections: sectionKeys
            .map((key) => mainT(PROFILE_SYNC_SECTION_LABELS[key] || key))
            .join(', '),
        }
      )
    );
  }

  async function decodeRemoteFileWithPassphrase(readResult, passphrase) {
    if (!readResult?.exists || !readResult.envelope) {
      return { sections: {}, malformed: {}, extensions: null };
    }
    const decoded = await profileSyncCore.decodeEnvelopeSections(readResult.envelope, passphrase);
    // A key rewrite copies sections as they are, so it must not run over damage
    // in sections this device syncs. Damaged sections it doesn't sync are carried
    // through untouched.
    const { inScope, outOfScope } = splitDamagedSyncSections(
      decoded.malformed,
      profileSyncCore.getScopeSectionKeys(getActiveProfileSyncScope())
    );
    const damaged = Object.keys(inScope);
    if (damaged.length > 0) throw createDamagedSyncSectionsError(damaged);
    return { ...decoded, sections: { ...outOfScope, ...decoded.sections } };
  }

  function splitDamagedSyncSections(malformed, sectionKeys) {
    const inScope = {};
    const outOfScope = {};
    Object.entries(malformed || {}).forEach(([key, entry]) => {
      (sectionKeys.includes(key) ? inScope : outOfScope)[key] = entry;
    });
    return { inScope, outOfScope };
  }

  async function decodeRemoteSectionsWithPassphrase(readResult, passphrase) {
    return (await decodeRemoteFileWithPassphrase(readResult, passphrase)).sections;
  }

  /**
   * Whether every section this device syncs is the same in the file and in the
   * given config. A section the file lacks does not count as different.
   */
  function remoteSectionsMatchConfig(remoteSections, baselineConfig) {
    const syncScope = getNormalizedProfileSyncScopeValue(baselineConfig?.profileSync?.syncScope);
    const localSections = profileSyncCore.buildLocalSections(baselineConfig, syncScope);
    return !Object.entries(localSections).some(
      ([key, data]) =>
        remoteSections[key] &&
        profileSyncCore.computeSectionHash(key, data) !==
          profileSyncCore.computeSectionHash(key, remoteSections[key].data)
    );
  }

  /**
   * Throws when a section this device syncs differs between the file and the
   * given config, so a rewrite never publishes stale local content or hides
   * unsynced remote changes behind a new key.
   */
  function assertRemoteSectionsMatchConfig(remoteSections, baselineConfig) {
    if (!remoteSectionsMatchConfig(remoteSections, baselineConfig)) {
      throw new Error(
        mainT(
          'The remote profile has changes that are not present locally. Sync or resolve them before changing encryption.'
        )
      );
    }
  }

  async function stageProfileSyncRewrite({
    oldPassphrase,
    newPassphrase,
    rememberNewPassphrase,
    targetEncryptionEnabled,
    changeCredential,
    baselineConfig = configStore.get(),
    targetConfig = configStore.get(),
    reason,
    remoteResult = null,
  }) {
    const profileSync = getProfileSyncConfig();
    if (profileSync.passphraseTransition) {
      throw new Error(mainT('A sync-key rewrite is already pending recovery'));
    }
    if (!profileSync.enabled || !hasProfileSyncTarget(profileSync)) {
      throw new Error(
        mainT('Profile sync must have an active remote file before it can be rewritten')
      );
    }

    // Seal both credentials before either side changes. This is intentionally
    // required even for users who do not normally remember a passphrase: the
    // short-lived recovery record is what makes every crash point reversible.
    const oldPassphraseEncrypted = sealProfileSyncTransitionSecret(oldPassphrase);
    const newPassphraseEncrypted = sealProfileSyncTransitionSecret(newPassphrase);
    const baselineRemote = remoteResult || (await readConfiguredSyncEnvelope());
    const { sections: remoteSections, extensions: remoteExtensions } =
      await decodeRemoteFileWithPassphrase(baselineRemote, oldPassphrase);
    assertRemoteSectionsMatchConfig(remoteSections, baselineConfig);

    const targetEnvelope = await buildProfileSyncEnvelopeForConfig(targetConfig, {
      encrypt: targetEncryptionEnabled,
      passphrase: newPassphrase,
      remoteSections,
      remoteExtensions,
    });
    const targetEnvelopeSerialized = profileSyncCore.serializeSyncEnvelope(targetEnvelope);
    const transaction = createProfileSyncRewriteTransaction({
      reason,
      provider: normalizeProfileSyncProvider(profileSync.provider),
      cloudFilePath: getProfileSyncEndpoint(profileSync),
      expectedRemoteIdentity: getSyncEnvelopeIdentity(baselineRemote),
      targetRemoteIdentity: getSyncEnvelopeIdentity({ exists: true, envelope: targetEnvelope }),
      targetEnvelopeSerialized,
      oldPassphraseEncrypted,
      newPassphraseEncrypted,
      targetEncryptionEnabled,
      changeCredential,
      rememberNewPassphrase,
    });

    const previousTransition = profileSync.passphraseTransition;
    const previousRemoteRewritePending = profileSync.remoteRewritePending;
    await stageProfileSyncRewriteTransaction(transaction, async (stagedTransaction) => {
      profileSync.passphraseTransition = stagedTransaction;
      profileSync.remoteRewritePending = true;
      const persistence = await configStore.apply(null, { origin: 'profile-sync' });
      if (!persistence.success) {
        profileSync.passphraseTransition = previousTransition;
        profileSync.remoteRewritePending = previousRemoteRewritePending;
        throw new Error(
          mainT('Failed to stage sync-key recovery: {{error}}', { error: persistence.error })
        );
      }
    });
    return transaction;
  }

  async function executePendingProfileSyncRewrite() {
    const profileSync = getProfileSyncConfig();
    const transaction = normalizeProfileSyncRewriteTransaction(profileSync.passphraseTransition);
    if (!transaction) {
      throw createRewriteTransactionError('No valid sync-key rewrite transaction is available');
    }
    if (!profileSyncRewriteTargetMatches(transaction, profileSync)) {
      throw new Error(
        mainT(
          'The sync provider or file changed during key recovery. Restore the original target before retrying.'
        )
      );
    }

    const oldPassphrase = unsealProfileSyncTransitionSecret(transaction.oldPassphraseEncrypted);
    const newPassphrase = unsealProfileSyncTransitionSecret(transaction.newPassphraseEncrypted);
    const targetEnvelope = profileSyncCore.parseSyncEnvelope(transaction.targetEnvelopeSerialized);
    const stagedTargetIdentity = getSyncEnvelopeIdentity({
      exists: true,
      envelope: targetEnvelope,
    });
    if (stagedTargetIdentity !== transaction.targetRemoteIdentity) {
      throw createRewriteTransactionError('The staged sync-key target failed its integrity check');
    }

    let persistedCredential = {
      remembered: profileSync.rememberPassphrase,
      encrypted: profileSync.passphraseEncrypted,
    };
    try {
      await runProfileSyncRewriteRecovery({
        transaction,
        readRemoteIdentity: async () => getSyncEnvelopeIdentity(await readConfiguredSyncEnvelope()),
        verifyOldRemote: async () => {
          const currentRemote = await readConfiguredSyncEnvelope();
          await decodeRemoteSectionsWithPassphrase(currentRemote, oldPassphrase);
        },
        writeExactTarget: async (serializedTarget) => {
          if (serializedTarget !== transaction.targetEnvelopeSerialized) {
            throw createRewriteTransactionError(
              'The staged sync-key target changed before its exact write'
            );
          }
          await writeConfiguredSyncEnvelope(targetEnvelope);
        },
        promoteLocal: async () => {
          // The baseline is what the file now holds, not the current config:
          // settings edited while recovery was pending still differ from the staged
          // file, and have to merge as local changes afterwards.
          const writtenSections = (
            await profileSyncCore.decodeEnvelopeSections(targetEnvelope, newPassphrase)
          ).sections;
          const writtenBaseline = {};
          const writtenBaselineUpdatedAt = {};
          profileSyncCore.getScopeSectionKeys(getActiveProfileSyncScope()).forEach((key) => {
            if (writtenSections[key]) {
              writtenBaseline[key] = profileSyncCore.computeSectionHash(
                key,
                writtenSections[key].data
              );
              writtenBaselineUpdatedAt[key] = {
                hash: writtenBaseline[key],
                updatedAt: writtenSections[key].updatedAt,
              };
            }
          });
          const previous = {
            rememberPassphrase: profileSync.rememberPassphrase,
            passphraseEncrypted: profileSync.passphraseEncrypted,
            storedPassphrase: profileSync.storedPassphrase,
            passphraseSession: profileSyncRuntime.passphraseSession,
            passphraseWarning: profileSyncRuntime.passphraseWarning,
            encryptionEnabled: profileSync.encryptionEnabled,
            encryptionChangePending: profileSync.encryptionChangePending,
            passphraseTransition: profileSync.passphraseTransition,
            remoteRewritePending: profileSync.remoteRewritePending,
            lastSyncAt: profileSync.lastSyncAt,
            lastSyncStatus: profileSync.lastSyncStatus,
            lastSyncError: profileSync.lastSyncError,
            profileUpdatedAt: profileSync.profileUpdatedAt,
            localProfileUpdatedAt: profileSyncRuntime.localProfileUpdatedAt,
            syncBaseline: profileSync.syncBaseline,
            syncBaselineUpdatedAt: profileSync.syncBaselineUpdatedAt,
            lastSuccessfulSyncAt: profileSync.lastSuccessfulSyncAt,
          };

          if (transaction.changeCredential) {
            persistedCredential = persistRememberedProfileSyncPassphrase(
              newPassphrase,
              transaction.rememberNewPassphrase
            );
          } else if (!transaction.targetEncryptionEnabled) {
            profileSync.rememberPassphrase = false;
            profileSync.passphraseEncrypted = false;
            profileSync.storedPassphrase = '';
            profileSyncRuntime.passphraseSession = '';
            profileSyncRuntime.passphraseWarning = '';
            persistedCredential = { remembered: false, encrypted: false };
          } else {
            profileSyncRuntime.passphraseSession = newPassphrase;
          }
          profileSync.encryptionEnabled = transaction.targetEncryptionEnabled;
          profileSync.encryptionChangePending = null;
          profileSync.passphraseTransition = null;
          profileSync.remoteRewritePending = false;
          profileSync.lastSyncAt = new Date().toISOString();
          profileSync.lastSyncStatus = 'success';
          profileSync.lastSyncError = '';
          profileSyncRuntime.localProfileUpdatedAt = targetEnvelope.updatedAt;
          profileSync.profileUpdatedAt = targetEnvelope.updatedAt;
          profileSync.syncBaseline = writtenBaseline;
          profileSync.syncBaselineUpdatedAt = writtenBaselineUpdatedAt;
          profileSync.lastSuccessfulSyncAt = profileSync.lastSyncAt;

          const persistence = await configStore.apply(null, { origin: 'profile-sync' });
          if (!persistence.success) {
            profileSync.rememberPassphrase = previous.rememberPassphrase;
            profileSync.passphraseEncrypted = previous.passphraseEncrypted;
            profileSync.storedPassphrase = previous.storedPassphrase;
            profileSyncRuntime.passphraseSession = oldPassphrase || previous.passphraseSession;
            profileSyncRuntime.passphraseWarning = previous.passphraseWarning;
            profileSync.encryptionEnabled = previous.encryptionEnabled;
            profileSync.encryptionChangePending = previous.encryptionChangePending;
            profileSync.passphraseTransition = previous.passphraseTransition;
            profileSync.remoteRewritePending = previous.remoteRewritePending;
            profileSync.lastSyncAt = previous.lastSyncAt;
            profileSync.lastSyncStatus = previous.lastSyncStatus;
            profileSync.lastSyncError = previous.lastSyncError;
            profileSync.profileUpdatedAt = previous.profileUpdatedAt;
            profileSyncRuntime.localProfileUpdatedAt = previous.localProfileUpdatedAt;
            profileSync.syncBaseline = previous.syncBaseline;
            profileSync.syncBaselineUpdatedAt = previous.syncBaselineUpdatedAt;
            profileSync.lastSuccessfulSyncAt = previous.lastSuccessfulSyncAt;
            const error = new Error(
              mainT(
                'The remote rewrite committed, but local key promotion could not be saved: {{error}}',
                { error: persistence.error }
              )
            );
            error.remoteRewriteCommitted = true;
            throw error;
          }
        },
      });
    } catch (error) {
      if (error?.code === 'PROFILE_SYNC_REWRITE_REMOTE_DIVERGED') {
        profileSyncRuntime.passphraseSession = oldPassphrase;
      }
      throw error;
    }

    setupProfileSyncInterval();
    emitProfileSyncStatus();
    return {
      ok: true,
      action: 'rewrite_complete',
      ...persistedCredential,
      status: buildProfileSyncStatus(),
    };
  }

  /**
   * Sentences for the file-system failures a sync folder produces, or an empty
   * string for an error that has none. The system's own text (a code, a path, the
   * temporary file's name) is for the log, not for the person using the widget.
   */
  function describeSyncFileSystemError(error) {
    // Windows refuses to replace a file another program has open (a sync client scanning it,
    // an antivirus) with EPERM. A read-only file or a protected folder gives the same code, so
    // the sentence names both rather than sending the user to retry what cannot succeed.
    if (error?.code === 'EPERM' && process.platform === 'win32') {
      return mainT(
        "The sync file is in use by another program or is read-only. Try again in a moment, and check the folder's permissions if it keeps happening."
      );
    }
    switch (error?.code) {
      case 'EACCES':
      case 'EPERM':
      case 'EROFS':
        return mainT(
          "This app does not have permission to use the sync file or its folder. Check the folder's permissions and that it is not read-only."
        );
      case 'ENOSPC':
        return mainT('The disk that holds the sync folder is full.');
      case 'EBUSY':
        return mainT('The sync file is in use by another program. Try again in a moment.');
      case 'ENOTDIR':
        return mainT('The selected sync folder path is not a directory');
      case 'ENOENT':
        // The folder went away between checking it and writing (an unmounted drive).
        return mainT(
          'The selected sync folder is unavailable. Reconnect the cloud provider or choose the folder again.'
        );
      case 'EEXIST':
      case 'ENOTEMPTY':
        return '';
      default:
        return typeof error?.code === 'string' && /^E[A-Z0-9]+$/.test(error.code)
          ? mainT(
              'Could not access the sync file ({{code}}). Check the sync folder and try again.',
              {
                code: error.code,
              }
            )
          : '';
    }
  }

  function throwSyncFileSystemError(error) {
    const friendly = describeSyncFileSystemError(error);
    if (!friendly) throw error;
    log.warn('Sync file access failed:', error.message);
    throw Object.assign(new Error(friendly), { cause: error });
  }

  /**
   * Reads the sync file. A file that exists but cannot be parsed comes back with
   * `damaged` (its text and the reason) instead of throwing, so the callers that may
   * replace it (Sync up, Keep Local on first enable) can keep a copy first;
   * readConfiguredSyncEnvelope throws for it unless asked to hand it back.
   */
  async function readCloudFileEnvelope(filePath) {
    if (!filePath) {
      return { exists: false, envelope: null };
    }

    try {
      const stats = await fs.promises.stat(filePath);
      if (!stats.isFile()) {
        throw new Error(mainT('Selected sync path is not a file'));
      }
      if (stats.size > PROFILE_SYNC_MAX_FILE_BYTES) {
        throw new Error(mainT('Sync file exceeds size limit (512 KB)'));
      }
      const raw = await fs.promises.readFile(filePath, 'utf8');
      try {
        return { exists: true, envelope: profileSyncCore.parseSyncEnvelope(raw) };
      } catch (error) {
        if (!profileSyncCore.isSyncFileDamagedError(error)) throw error;
        return { exists: true, envelope: null, damaged: { raw, error } };
      }
    } catch (error) {
      if (error && error.code === 'ENOENT') {
        await requireExistingSyncParentDirectory(filePath, fs);
        return { exists: false, envelope: null };
      }
      return throwSyncFileSystemError(error);
    }
  }

  async function writeCloudFileEnvelope(filePath, envelope) {
    if (!filePath) {
      throw new Error(mainT('Sync file path is not configured'));
    }
    const serialized = profileSyncCore.serializeSyncEnvelope(envelope);
    // Readers refuse files over the limit, so writing one would stop every device
    // syncing, this one included.
    if (Buffer.byteLength(serialized, 'utf8') > PROFILE_SYNC_MAX_FILE_BYTES) {
      throw new Error(mainT('Sync file exceeds size limit (512 KB)'));
    }
    await requireExistingSyncParentDirectory(filePath, fs);
    // Hidden, and unique to this write, so a crash leaves nothing a person sees in the folder
    // and two writers never share one; removeStaleSyncTempFiles clears what a crash leaves.
    const tempPath = path.join(
      path.dirname(filePath),
      `.${path.basename(filePath)}.tmp-${Date.now()}-${nodeCrypto.randomBytes(4).toString('hex')}`
    );
    let handle = null;
    try {
      await fs.promises.writeFile(tempPath, serialized, { encoding: 'utf8', flag: 'wx' });
      // On disk before the rename, so a crash or power cut cannot leave the sync file pointing
      // at contents that were never written. fsync covers the file whichever handle asks.
      handle = await fs.promises.open(tempPath, 'r+');
      await handle.sync();
      await handle.close();
      handle = null;
      // Replaces the file in one step, on Windows too.
      await fs.promises.rename(tempPath, filePath);
    } catch (error) {
      await handle?.close().catch(() => {});
      await fs.promises.unlink(tempPath).catch(() => {});
      throwSyncFileSystemError(error);
    }
  }

  /**
   * Deletes temporary files a crashed write left beside the sync file, once they are an hour
   * old: they would otherwise replicate to every computer. Includes the visible ones earlier
   * versions wrote. Best effort; a folder that cannot be read is left alone.
   */
  async function removeStaleSyncTempFiles(filePath) {
    if (!filePath) return;
    const folder = path.dirname(filePath);
    const name = path.basename(filePath).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const pattern = new RegExp(`^(\\.${name}\\.tmp-\\d+-[0-9a-f]+|${name}\\.tmp-\\d+)$`);
    try {
      for (const entry of await fs.promises.readdir(folder)) {
        if (!pattern.test(entry)) continue;
        const target = path.join(folder, entry);
        const stats = await fs.promises.stat(target).catch(() => null);
        if (stats?.isFile() && Date.now() - stats.mtimeMs > PROFILE_SYNC_TEMP_FILE_MAX_AGE_MS) {
          await fs.promises.unlink(target).catch(() => {});
        }
      }
    } catch {
      // nothing to clean up in a folder that cannot be read
    }
  }

  async function copyProfileSyncFile(fromPath, toPath) {
    try {
      const profileSync = getProfileSyncConfig();
      const configuredSyncFolder = profileSync.cloudFilePath
        ? path.dirname(profileSync.cloudFilePath)
        : '';
      const { sourcePath, destinationPath } = await validateProfileSyncCopyPaths({
        fromPath,
        toPath,
        defaultFileName: PROFILE_SYNC_DEFAULT_FILE_NAME,
        allowedSourceFolders: [configuredSyncFolder, app.getPath('userData')],
        allowedDestinationFolders: [
          configuredSyncFolder,
          app.getPath('userData'),
          ...profileSyncRuntime.approvedCopyDestinationFolders,
        ],
        fsModule: fs,
      });

      if (sourcePath === destinationPath) {
        return { ok: true, status: 'copied', copied: false, reason: 'same_path' };
      }

      let sourceStats;
      try {
        sourceStats = await fs.promises.stat(sourcePath);
      } catch (error) {
        if (error?.code === 'ENOENT') {
          return { ok: false, status: 'source_missing' };
        }
        throw error;
      }

      if (!sourceStats.isFile()) {
        return { ok: false, status: 'error', error: mainT('Source sync file is not a file') };
      }

      await requireExistingSyncParentDirectory(destinationPath, fs);
      try {
        // Whatever is there may be another computer's file, so it is never replaced.
        await fs.promises.copyFile(sourcePath, destinationPath, fs.constants.COPYFILE_EXCL);
        return { ok: true, status: 'copied', copied: true };
      } catch (error) {
        if (error?.code === 'EEXIST') {
          return { ok: false, status: 'destination_exists' };
        }
        throw error;
      }
    } catch (error) {
      return {
        ok: false,
        status: 'error',
        error: describeSyncFileSystemError(error) || mainTError(error),
      };
    }
  }

  /**
   * Reads the configured sync file. A damaged file throws, as it cannot be merged or
   * rewritten; `allowDamaged` hands it back instead to the callers that may replace it.
   */
  async function readConfiguredSyncEnvelope({ allowDamaged = false } = {}) {
    const profileSync = getProfileSyncConfig();
    if (!isProfileSyncProviderSupported(profileSync.provider)) {
      throw new Error(mainT('Unsupported profile sync provider'));
    }
    // Kept for the status: Settings needs to know what mode the file is in even when a sync
    // stops on it, to ask for the right thing. A file that could not be read is not known,
    // but the last answer stands while a read is under way so the form does not flicker.
    let result;
    try {
      result = await syncTargetFor(profileSync.provider).read(profileSync);
    } catch (error) {
      profileSyncRuntime.remoteEncrypted = null;
      throw error;
    }
    profileSyncRuntime.remoteEncrypted =
      result.exists && result.envelope
        ? profileSyncCore.isEnvelopeEncrypted(result.envelope)
        : null;
    if (result.damaged && !allowDamaged) throw result.damaged.error;
    return result;
  }

  async function writeConfiguredSyncEnvelope(envelope) {
    const profileSync = getProfileSyncConfig();
    if (!isProfileSyncProviderSupported(profileSync.provider)) {
      throw new Error(mainT('Unsupported profile sync provider'));
    }
    return syncTargetFor(profileSync.provider).write(profileSync, envelope);
  }

  /**
   * Whether sync has somewhere to go: a file path, or for Cloud Sync, a build
   * that knows the service and a signed-in account.
   */
  function hasProfileSyncTarget(profileSync = getProfileSyncConfig()) {
    return syncTargetFor(profileSync.provider).isReady(profileSync);
  }

  function describeMissingProfileSyncTarget(profileSync = getProfileSyncConfig()) {
    return syncTargetFor(profileSync.provider).describeNotReady();
  }

  /**
   * Names where the synced profile lives, for the key-rewrite transaction to bind
   * to: the file path, or for Cloud Sync the service and account. The account is
   * named by its id, since an email can be empty (GitHub without a verified one);
   * a sign-in saved before ids were kept still names it by email.
   */
  function getProfileSyncEndpoint(profileSync = getProfileSyncConfig()) {
    return syncTargetFor(profileSync.provider).endpoints(profileSync)[0];
  }

  /**
   * Whether a key-rewrite transaction was staged for where sync points now. One staged
   * against Cloud Sync before account ids were kept names the account by email, and still
   * matches once signing in again has saved the id.
   */
  function profileSyncRewriteTargetMatches(transaction, profileSync = getProfileSyncConfig()) {
    const provider = normalizeProfileSyncProvider(profileSync.provider);
    return syncTargetFor(profileSync.provider)
      .endpoints(profileSync)
      .some((endpoint) => profileSyncRewriteEndpointMatches(transaction, provider, endpoint));
  }

  /**
   * Whether an automatic run should only download because Cloud Sync recently refused a save
   * for want of a subscription. Sync now always tries again.
   */
  function shouldHoldCloudSyncWrites(profileSync, source) {
    if (!syncTargetFor(profileSync.provider).refusesWritesWithoutSubscription) return false;
    if (source === 'manual') return false;
    const refusedAt = profileSyncRuntime.cloudSyncWriteRefusedAt;
    return !!refusedAt && Date.now() - refusedAt < CLOUD_SYNC_WRITE_RETRY_MS;
  }

  /** Lets the next run save again, and queues one when edits may be waiting. */
  function resumeCloudSyncWrites() {
    if (!profileSyncRuntime.cloudSyncWriteRefusedAt) return;
    profileSyncRuntime.cloudSyncWriteRefusedAt = 0;
    scheduleDebouncedProfileSyncPush('subscription_restored');
  }

  /** Gives a Cloud Sync failure a translated message, keeping its code. */
  function toCloudSyncError(error) {
    const key = CLOUD_SYNC_ERROR_MESSAGES[error?.code];
    const translated = new Error(
      key
        ? mainT(key)
        : mainT('Cloud Sync failed: {{error}}', { error: error?.message || String(error) })
    );
    translated.code = error?.code;
    return translated;
  }

  async function readHostedSyncEnvelope() {
    let result;
    try {
      result = await getCloudSyncClient().readProfile();
    } catch (error) {
      throw toCloudSyncError(error);
    }
    // Writes are compare-and-swap against the revision last read.
    profileSyncRuntime.hostedRevision = result.exists ? result.revision : null;
    if (!result.exists) return { exists: false, envelope: null };
    if (Buffer.byteLength(result.text, 'utf8') > PROFILE_SYNC_MAX_FILE_BYTES) {
      throw new Error(mainT('Sync file exceeds size limit (512 KB)'));
    }
    try {
      return { exists: true, envelope: profileSyncCore.parseSyncEnvelope(result.text) };
    } catch (error) {
      // Handed back like a damaged sync file, so only the callers that may replace it see it.
      return { exists: true, envelope: null, damaged: { raw: result.text, error } };
    }
  }

  async function writeHostedSyncEnvelope(envelope) {
    const serialized = profileSyncCore.serializeSyncEnvelope(envelope);
    if (Buffer.byteLength(serialized, 'utf8') > PROFILE_SYNC_MAX_FILE_BYTES) {
      throw new Error(mainT('Sync file exceeds size limit (512 KB)'));
    }
    try {
      // A null revision means none existed at the last read, so this only creates.
      const { revision } = await getCloudSyncClient().writeProfile(
        serialized,
        profileSyncRuntime.hostedRevision ?? null
      );
      profileSyncRuntime.hostedRevision = revision;
    } catch (error) {
      throw toCloudSyncError(error);
    }
  }

  /**
   * Re-reads the configured sync file and reports whether it moved since an earlier
   * read. This is the compare half of the compare-and-swap guarding a push.
   *
   * A failed re-read counts as changed: when the file is unreadable or a provider
   * is midway through replicating it, backing off is safer than overwriting.
   *
   * @param {{exists: boolean, envelope: object|null}} previousResult earlier read to compare against
   * @returns {Promise<boolean>} whether the remote file changed
   */
  async function hasRemoteSyncEnvelopeChanged(previousResult) {
    let currentResult;
    try {
      currentResult = await readConfiguredSyncEnvelope({ allowDamaged: true });
    } catch (error) {
      log.warn('Could not re-read the sync file before pushing:', error.message);
      return true;
    }

    return getSyncEnvelopeIdentity(currentResult) !== getSyncEnvelopeIdentity(previousResult);
  }

  /**
   * Looks beside the sync file for the copies Syncthing, Dropbox, OneDrive and
   * Drive leave when two devices write at once. Their presence is the only signal
   * the app gets that a provider-level race happened, since the providers resolve
   * it by forking the file rather than reporting an error.
   *
   * @returns {Promise<string[]>} conflict-copy filenames, empty when none
   */
  async function findProfileSyncConflictCopies() {
    const profileSync = getProfileSyncConfig();
    return syncTargetFor(profileSync.provider).findConflictCopies(profileSync);
  }

  async function findSyncFolderConflictCopies(filePath) {
    if (!filePath) return [];

    const folder = path.dirname(filePath);
    const extension = path.extname(filePath);
    const baseName = path.basename(filePath, extension);
    const escapeRegex = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const escapedBase = escapeRegex(baseName);
    const escapedExtension = escapeRegex(extension);
    const namedAfterOriginal = [
      new RegExp(`^${escapedBase}-[^./\\\\]+${escapedExtension}$`, 'i'), // OneDrive: name-COMPUTER.json
      new RegExp(`^${escapedBase} \\d+${escapedExtension}$`, 'i'), // iCloud Drive: name 2.json
    ];
    try {
      const entries = await fs.promises.readdir(folder);
      return entries.filter(
        (entry) =>
          entry !== path.basename(filePath) &&
          entry.includes(baseName) &&
          [...PROFILE_SYNC_CONFLICT_PATTERNS, ...namedAfterOriginal].some((pattern) =>
            pattern.test(entry)
          )
      );
    } catch {
      // folder unreadable or gone; nothing useful to report
      return [];
    }
  }

  /**
   * True when the sync file sits in the app's own data folder, which nothing
   * replicates. Enabling sync there succeeds and shares the profile with no one,
   * so it is worth calling out rather than reporting a healthy sync.
   */
  function isProfileSyncFolderUnsynced(filePath = getProfileSyncConfig().cloudFilePath) {
    if (!filePath) return false;
    try {
      return isPathInsideDirectory(filePath, app.getPath('userData'));
    } catch {
      return false;
    }
  }

  /**
   * Where the synced profile lives. The engine only speaks to a sync target through
   * this interface, so the merge, backup and rewrite logic is the same for both
   * adapters: a file in a folder another program replicates, and a Cloud Sync account.
   *
   * - read / write: the envelope, with damaged content handed back rather than thrown
   * - isReady / describeNotReady: whether there is somewhere to sync now, and why not
   * - endpoints: names a key rewrite binds to; the first is the current one
   * - findConflictCopies / removeStaleTempFiles: the folder clean-up after a read
   * - warnings: setups that look healthy but share nothing
   * - usesFilePath: whether profileSync.cloudFilePath is where it syncs
   * - refusesWritesWithoutSubscription: whether a refused save holds later automatic saves
   * - describeMissingProfile: why a profile this device synced with before is gone
   */
  const folderSyncTarget = {
    read: (profileSync) => readCloudFileEnvelope(profileSync.cloudFilePath),
    write: (profileSync, envelope) => writeCloudFileEnvelope(profileSync.cloudFilePath, envelope),
    isReady: (profileSync) => !!profileSync.cloudFilePath,
    describeNotReady: () => mainT('Profile sync file is not configured'),
    endpoints: (profileSync) => [profileSync.cloudFilePath],
    findConflictCopies: (profileSync) => findSyncFolderConflictCopies(profileSync.cloudFilePath),
    removeStaleTempFiles: (profileSync) => removeStaleSyncTempFiles(profileSync.cloudFilePath),
    warnings: collectSyncFolderWarnings,
    usesFilePath: true,
    refusesWritesWithoutSubscription: false,
    describeMissingProfile: () =>
      mainT(
        'The sync file is missing from the sync folder. If you deleted it on purpose, use Sync up to create it again.'
      ),
  };

  const cloudSyncTarget = {
    read: () => readHostedSyncEnvelope(),
    write: (_profileSync, envelope) => writeHostedSyncEnvelope(envelope),
    isReady: () => {
      const client = getCloudSyncClient();
      return client.isAvailable() && !!client.getStoredAccount();
    },
    describeNotReady: () =>
      getCloudSyncClient().isAvailable()
        ? mainT('Sign in to Cloud Sync to keep syncing')
        : mainT('Cloud Sync is not available in this version of the app'),
    // The account is named by its id, since an email can be empty (GitHub without a
    // verified one); a sign-in saved before ids were kept still names it by email, and a
    // rewrite staged then still matches once signing in again has saved the id.
    endpoints: () => {
      const client = getCloudSyncClient();
      const account = client.getStoredAccount();
      const endpoint = `cloud-sync:${client.serviceUrl}:${account?.id || account?.email || 'account'}`;
      return account?.id && account.email
        ? [endpoint, `cloud-sync:${client.serviceUrl}:${account.email}`]
        : [endpoint];
    },
    // Cloud Sync has no folder, so nothing forks the file or leaves temp files.
    findConflictCopies: async () => [],
    removeStaleTempFiles: async () => {},
    warnings: () => [],
    // Cloud Sync has no file, so a path left over from folder sync is not a target.
    usesFilePath: false,
    refusesWritesWithoutSubscription: true,
    describeMissingProfile: () =>
      mainT(
        'Your synced settings are missing from Cloud Sync. If you deleted them on purpose, use Sync up to save them again.'
      ),
  };

  function syncTargetFor(provider) {
    return provider === PROFILE_SYNC_HOSTED_PROVIDER ? cloudSyncTarget : folderSyncTarget;
  }

  function getActiveProfileSyncScope() {
    const profileSync = getProfileSyncConfig();
    const normalizedScope = getNormalizedProfileSyncScopeValue(profileSync.syncScope);
    profileSync.syncScope = normalizedScope;
    return normalizedScope;
  }

  function computeScopedProfileHash(profile, syncScope) {
    return profileSyncCore.computeProfileHash({
      syncScope: getNormalizedProfileSyncScopeValue(syncScope),
      profile: profile || {},
    });
  }

  function computeLocalSectionHashes(
    syncScope = getActiveProfileSyncScope(),
    source = configStore.get()
  ) {
    const sections = profileSyncCore.buildLocalSections(source, syncScope);
    return Object.fromEntries(
      Object.entries(sections).map(([key, data]) => [
        key,
        profileSyncCore.computeSectionHash(key, data),
      ])
    );
  }

  function pickSections(sections, keys) {
    return Object.fromEntries(
      keys.filter((key) => sections[key]).map((key) => [key, sections[key]])
    );
  }

  async function writeProfileSyncBackup(
    prefix,
    contents,
    reason = 'pull',
    { discarded = [] } = {}
  ) {
    const backupDir = path.join(app.getPath('userData'), PROFILE_SYNC_BACKUP_DIR_NAME);
    await fs.promises.mkdir(backupDir, { recursive: true });
    await fs.promises.writeFile(
      path.join(backupDir, `${prefix}-${Date.now()}.json`),
      JSON.stringify(
        {
          backedUpAt: new Date().toISOString(),
          reason,
          ...(discarded.length > 0 ? { discarded } : {}),
          ...contents,
        },
        null,
        2
      ),
      'utf8'
    );

    await pruneProfileSyncBackups(
      backupDir,
      new RegExp(`^${prefix}-\\d+\\.json$`),
      async (name) => {
        try {
          const saved = JSON.parse(await fs.promises.readFile(path.join(backupDir, name), 'utf8'));
          if (PROFILE_SYNC_MANUAL_BACKUP_REASONS.has(saved?.reason)) return 'manual';
          return Array.isArray(saved?.discarded) && saved.discarded.length > 0
            ? 'discarded'
            : 'routine';
        } catch {
          return 'routine';
        }
      }
    );
  }

  /** Whether pruning should delete the oldest of a group's backups (oldest first in `names`). */
  function shouldPruneOldestProfileSyncBackup(group, names) {
    if (group !== 'discarded') return names.length > PROFILE_SYNC_BACKUP_KEEP;
    if (names.length > PROFILE_SYNC_DISCARD_BACKUP_LIMIT) return true;
    const takenAt = Number(names[0].match(/-(\d+)\.[a-z]+$/)?.[1]);
    return (
      names.length > PROFILE_SYNC_DISCARD_BACKUP_KEEP &&
      Date.now() - takenAt > PROFILE_SYNC_DISCARD_BACKUP_MAX_AGE_MS
    );
  }

  /**
   * Deletes the oldest of the backups matching the pattern beyond the number kept, for
   * each group `groupOf` puts them in.
   */
  async function pruneProfileSyncBackups(backupDir, pattern, groupOf = async () => '') {
    try {
      const entries = (await fs.promises.readdir(backupDir))
        .filter((name) => pattern.test(name))
        .sort();
      // No group can hold more than all of them, so there is nothing to sort into groups.
      if (entries.length <= PROFILE_SYNC_BACKUP_KEEP) return;
      const groups = new Map();
      for (const name of entries) {
        const group = await groupOf(name);
        groups.set(group, [...(groups.get(group) || []), name]);
      }
      for (const [group, names] of groups) {
        while (shouldPruneOldestProfileSyncBackup(group, names)) {
          await fs.promises.unlink(path.join(backupDir, names.shift()));
        }
      }
    } catch (error) {
      log.warn('Created a profile sync backup, but failed to prune older backups:', error.message);
    }
  }

  /**
   * Keeps a copy of a whole sync file before something replaces it. These are for the
   * user to open, not for restore: the file has no settings in it to apply. Fails the
   * operation when the copy cannot be made.
   */
  async function keepSyncFileCopy(prefix, extension, writeCopy) {
    const backupDir = path.join(app.getPath('userData'), PROFILE_SYNC_BACKUP_DIR_NAME);
    try {
      await fs.promises.mkdir(backupDir, { recursive: true });
      await writeCopy(path.join(backupDir, `${prefix}-${Date.now()}.${extension}`));
    } catch (error) {
      log.warn('Failed to keep a copy of the sync file before replacing it:', error.message);
      throw new Error(
        mainT('The sync file was not updated because its backup failed: {{error}}', {
          error: describeSyncFileSystemError(error) || mainTError(error),
        }),
        { cause: error }
      );
    }
    await pruneProfileSyncBackups(backupDir, new RegExp(`^${prefix}-\\d+\\.${extension}$`));
  }

  /** Keeps the text of a sync file that could not be read before Sync up replaces it. */
  function backupDamagedSyncFile(raw) {
    return keepSyncFileCopy('damaged-sync-file', 'txt', (target) =>
      fs.promises.writeFile(target, raw, 'utf8')
    );
  }

  /**
   * Keeps this device's sections before something replaces them. `discarded` names the ones
   * holding edits the replacement throws away, which keeps the backup longer.
   */
  async function backupLocalProfileBeforePullApply(
    sectionKeys,
    incomingSections = null,
    reason = 'pull',
    { discarded = [] } = {}
  ) {
    try {
      const sections = profileSyncCore.scopeBackupToIncoming(
        profileSyncCore.buildLocalSections(configStore.get(), {
          preset: 'custom',
          sections: Object.fromEntries(sectionKeys.map((key) => [key, true])),
        }),
        incomingSections
      );
      await writeProfileSyncBackup('local-profile', { sections }, reason, { discarded });
    } catch (error) {
      log.warn('Failed to back up local profile before applying remote sync:', error.message);
      throw new Error(
        mainT('Remote profile was not applied because the local backup failed: {{error}}', {
          error: error?.message || String(error),
        }),
        { cause: error }
      );
    }
  }

  /**
   * Keeps a copy of sections another device wrote before this device's newer
   * edits replace them in the file. Pushing without one would lose them for good.
   * `discarded` is as for backupLocalProfileBeforePullApply.
   */
  async function backupRemoteSectionsBeforePush(remoteSections, { discarded = [] } = {}) {
    try {
      await writeProfileSyncBackup('remote-profile', { sections: remoteSections }, 'push', {
        discarded,
      });
    } catch (error) {
      log.warn('Failed to back up remote profile sections before pushing:', error.message);
      throw new Error(
        mainT('The sync file was not updated because its backup failed: {{error}}', {
          error: error?.message || String(error),
        }),
        { cause: error }
      );
    }
  }

  /**
   * Applies pulled sections to the config and runtime.
   *
   * @param {Object<string, {updatedAt: string, data: object}>} pulledSections remote entries to apply
   */
  async function applySyncedProfileToConfig(pulledSections) {
    const previous = JSON.parse(JSON.stringify(configStore.get()));
    const previousRuntimeTracking = {
      localProfileHash: profileSyncRuntime.localProfileHash,
      localProfileUpdatedAt: profileSyncRuntime.localProfileUpdatedAt,
      localSectionHashes: profileSyncRuntime.localSectionHashes,
      pendingPullEchoHash: profileSyncRuntime.pendingPullEchoHash,
      pendingPullEchoProfile: profileSyncRuntime.pendingPullEchoProfile,
      pendingPulls: profileSyncRuntime.pendingPulls,
    };
    const restoreMainState = snapshotMainState();
    const scope = getActiveProfileSyncScope();
    // Captured under the active scope so it is directly comparable to the hashes
    // updateLocalProfileSyncTracking computes afterwards.
    const prePullHash = computeScopedProfileHash(
      profileSyncCore.projectSyncProfile(previous, scope),
      scope
    );
    const sectionData = Object.fromEntries(
      Object.entries(pulledSections).map(([key, entry]) => [key, entry.data])
    );
    const merged = profileSyncCore.mergeSectionsIntoConfig(configStore.get(), sectionData);
    // An edit time from a clock ahead of this one is recorded as now. File times count as at
    // most five minutes ahead in a conflict, so a future one kept here would make a pulled
    // section look like a newer edit of this device's. The agreed version keeps the time as
    // written, but an edit made after this pull is stamped at most five minutes ahead of now
    // (see stampLocalSectionEdit).
    const nowIso = new Date().toISOString();
    const notAfterNow = (value) =>
      profileSyncCore.compareIsoTimestamps(value, nowIso) > 0 ? nowIso : value;
    const latestPulledAt = Object.values(pulledSections)
      .map((entry) => notAfterNow(entry.updatedAt))
      .reduce(
        (latest, value) =>
          profileSyncCore.compareIsoTimestamps(value, latest) > 0 ? value : latest,
        null
      );
    merged.profileSync = {
      ...previous.profileSync,
      // A pulled section counts as changed when the other device changed it, so a
      // later conflict on it compares against that edit rather than this pull.
      sectionUpdatedAt: {
        ...(previous.profileSync?.sectionUpdatedAt || {}),
        ...Object.fromEntries(
          Object.entries(pulledSections).map(([key, entry]) => [key, notAfterNow(entry.updatedAt)])
        ),
      },
      profileUpdatedAt: latestPulledAt || new Date().toISOString(),
    };
    const pull = { profile: profileSyncCore.projectSyncProfile(previous, scope), revision: null };
    const persistence = await configStore.apply(
      (current) => {
        replaceConfigContents(current, merged);
        normalizeConfig(current);
        ensureProfileSyncConfigDefaults(current);
        ensureEntityAlertsConfigDefaults(current);

        const projected = profileSyncCore.projectSyncProfile(current, scope);
        profileSyncRuntime.localProfileHash = computeScopedProfileHash(projected, scope);
        profileSyncRuntime.localSectionHashes = computeLocalSectionHashes(scope);
        profileSyncRuntime.localProfileUpdatedAt = current.profileSync.profileUpdatedAt;
        // A pull that lands before anything answered the previous one leaves the
        // content guard on the state before the first: a stale snapshot may predate both.
        if (profileSyncRuntime.pendingPullEchoHash === null) {
          profileSyncRuntime.pendingPullEchoHash =
            prePullHash === profileSyncRuntime.localProfileHash ? null : prePullHash;
          profileSyncRuntime.pendingPullEchoProfile = pull.profile;
        }
        profileSyncRuntime.pendingPulls = appendPendingPull(profileSyncRuntime.pendingPulls, pull);
      },
      { origin: 'profile-sync-pull' }
    );
    if (!persistence.success) {
      Object.assign(profileSyncRuntime, previousRuntimeTracking);
      restoreMainState();
      throw new Error(
        mainT('Failed to persist pulled profile: {{error}}', { error: persistence.error })
      );
    }
    pull.revision = persistence.revision;
    return { runtimeWarnings: persistence.runtimeWarnings };
  }

  function extractProfileSyncBackupSections(backup, kind) {
    if (isPlainObject(backup?.sections)) {
      return Object.fromEntries(
        Object.entries(backup.sections)
          .filter(([key]) => profileSyncCore.SYNC_SCOPE_SECTION_KEYS.includes(key))
          .map(([key, value]) => [key, kind === 'remote' ? value?.data : value])
          // A damaged section is kept in the file for reference but never restored.
          .filter(([key, data]) => profileSyncCore.hasValidSectionFields(key, data))
      );
    }
    // Backups written before sections existed hold one flat profile.
    if (isPlainObject(backup?.profile)) {
      const scope = profileSyncCore.normalizeSyncScope(backup.syncScope);
      return Object.fromEntries(
        profileSyncCore
          .getScopeSectionKeys(scope)
          .map((key) => [key, profileSyncCore.projectSection(backup.profile, key)])
          .filter(([key, data]) => profileSyncCore.hasValidSectionFields(key, data))
      );
    }
    return {};
  }

  async function readProfileSyncBackup(id) {
    const match = typeof id === 'string' ? id.match(PROFILE_SYNC_BACKUP_FILE_PATTERN) : null;
    if (!match) {
      throw new Error(mainT('That backup is no longer available'));
    }
    const backupDir = path.join(app.getPath('userData'), PROFILE_SYNC_BACKUP_DIR_NAME);
    let backup;
    try {
      backup = JSON.parse(await fs.promises.readFile(path.join(backupDir, id), 'utf8'));
    } catch {
      throw new Error(mainT('That backup is no longer available'));
    }
    return {
      id,
      kind: match[1],
      // Backups written before the reason was recorded are all from syncing.
      reason:
        typeof backup?.reason === 'string'
          ? backup.reason
          : match[1] === 'remote'
            ? 'push'
            : 'pull',
      createdAt: new Date(Number(match[2])).toISOString(),
      sections: extractProfileSyncBackupSections(backup, match[1]),
    };
  }

  /**
   * Lists the backups kept before settings are replaced, newest first: `local` ones
   * hold this device's settings before a pull, an import or a restore replaced them
   * (`reason` says which), and `remote` ones hold the file's settings before this
   * device's push replaced them.
   */
  async function listProfileSyncBackups() {
    const backupDir = path.join(app.getPath('userData'), PROFILE_SYNC_BACKUP_DIR_NAME);
    let entries;
    try {
      entries = await fs.promises.readdir(backupDir);
    } catch (error) {
      if (error?.code === 'ENOENT') return [];
      throw error;
    }
    const backups = await Promise.all(
      entries
        .filter((name) => PROFILE_SYNC_BACKUP_FILE_PATTERN.test(name))
        .map((name) => readProfileSyncBackup(name).catch(() => null))
    );
    return backups
      .filter((backup) => backup && Object.keys(backup.sections).length > 0)
      .map(({ id, kind, reason, createdAt, sections }) => ({
        id,
        kind,
        reason,
        createdAt,
        sections: Object.keys(sections),
      }))
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  /**
   * Applies a backup on this device as an ordinary local change, so the next merge
   * run carries it to the other devices. The settings it replaces are backed up
   * first, which keeps the restore itself undoable.
   */
  async function restoreProfileSyncBackup(id) {
    const backup = await readProfileSyncBackup(id);
    return applyLocalProfileSections(backup.sections, { clearNullUiKeys: true }, 'restore');
  }

  async function applyLocalProfileSections(sections, mergeOptions, reason = 'import') {
    const sectionKeys = Object.keys(sections);
    if (sectionKeys.length === 0) {
      throw new Error(mainT('That backup is no longer available'));
    }
    await backupLocalProfileBeforePullApply(sectionKeys, sections, reason);

    const previousRuntimeTracking = {
      localProfileHash: profileSyncRuntime.localProfileHash,
      localProfileUpdatedAt: profileSyncRuntime.localProfileUpdatedAt,
      localSectionHashes: profileSyncRuntime.localSectionHashes,
      pendingPullEchoHash: profileSyncRuntime.pendingPullEchoHash,
      pendingPullEchoProfile: profileSyncRuntime.pendingPullEchoProfile,
    };
    // Restoring what the last pull replaced reproduces the pre-pull profile exactly,
    // which the content guard would otherwise drop as a stale echo instead of
    // syncing it. The pull history stays: an update built before the pull is
    // still stale.
    profileSyncRuntime.pendingPullEchoHash = null;
    profileSyncRuntime.pendingPullEchoProfile = null;
    const persistence = await configStore.apply(
      (current) => {
        replaceConfigContents(
          current,
          profileSyncCore.mergeSectionsIntoConfig(current, sections, mergeOptions)
        );
        normalizeConfig(current);
        ensureProfileSyncConfigDefaults(current);
        ensureEntityAlertsConfigDefaults(current);
      },
      { origin: 'profile-restore' }
    );
    if (!persistence.success) {
      Object.assign(profileSyncRuntime, previousRuntimeTracking);
      throw new Error(
        mainT('Failed to restore the backup: {{error}}', { error: persistence.error })
      );
    }
    return { restored: sectionKeys };
  }

  function clearProfileSyncTimers() {
    if (profileSyncRuntime.pushDebounceTimer) {
      clearTimeout(profileSyncRuntime.pushDebounceTimer);
      profileSyncRuntime.pushDebounceTimer = null;
    }
    if (profileSyncRuntime.intervalTimer) {
      clearInterval(profileSyncRuntime.intervalTimer);
      profileSyncRuntime.intervalTimer = null;
    }
  }

  /**
   * Reverses a renderer config update that predates a just-applied pull.
   *
   * applySyncedProfileToConfig pushes the pulled profile out to the renderer, but a
   * config update already in flight arrives afterwards still carrying the pre-pull
   * values, and the update-config merge would silently revert the pull. The stale
   * update is recognised by content — every setting the user did not touch still
   * holds its pre-pull value — and the pulled fields are merged back over it,
   * keeping the ones the user touched.
   *
   * @param {object} pulledConfig config as it stood before this update, i.e. the pulled state
   * @param {string[]} [touchedKeys] settings the user changed ('key' or 'ui.key'), kept as sent
   * @param {number|null} [baseRevision] config revision the renderer built the update from
   * @returns {boolean} whether a stale update was detected and reversed
   */
  function restoreProfileFromStalePullEcho(pulledConfig, touchedKeys = [], baseRevision = null) {
    if (!pulledConfig) return false;
    const pulls = profileSyncRuntime.pendingPulls || [];
    const revisionKnown = baseRevision !== null && pulls.length > 0;
    let prePullProfile;
    let startingStateLost = false;
    if (revisionKnown) {
      // The profile the update was built from: before the first pull it missed. A
      // pull still being saved has no revision yet, and nothing has seen it.
      const missedPull = pulls.find(
        (entry) => entry.revision === null || entry.revision > baseRevision
      );
      if (!missedPull) {
        // Built after the renderer saw every pull: every value in it is deliberate.
        profileSyncRuntime.pendingPullEchoHash = null;
        return false;
      }
      prePullProfile = missedPull.profile;
      startingStateLost =
        typeof missedPull.compactedFrom === 'number' && baseRevision >= missedPull.compactedFrom;
    } else {
      // No revision (an older renderer): checked once, against the last pull.
      if (profileSyncRuntime.pendingPullEchoHash === null) return false;
      prePullProfile = profileSyncRuntime.pendingPullEchoProfile;
      if (!prePullProfile) return false;
    }

    // Scope comes from the pulled config, not the merged one: the stale update may
    // carry a stale syncScope too.
    const scope = getNormalizedProfileSyncScopeValue(pulledConfig?.profileSync?.syncScope);
    const touched = new Set(touchedKeys);
    const incomingProfile = profileSyncCore.projectSyncProfile(configStore.get(), scope);
    const same = (a, b) =>
      profileSyncCore.computeProfileHash({ value: a }) ===
      profileSyncCore.computeProfileHash({ value: b });
    const eachSyncedSetting = (visit) => {
      const fields = new Set([...Object.keys(prePullProfile), ...Object.keys(incomingProfile)]);
      return [...fields].every((field) => {
        if (field !== 'ui') return visit(field, incomingProfile[field], prePullProfile[field]);
        const incomingUi = incomingProfile.ui || {};
        const prePullUi = prePullProfile.ui || {};
        return [...new Set([...Object.keys(incomingUi), ...Object.keys(prePullUi)])].every((key) =>
          visit(`ui.${key}`, incomingUi[key], prePullUi[key])
        );
      });
    };

    let keep = touched;
    if (revisionKnown) {
      // Built before the pull. Whatever it changed relative to the pre-pull
      // profile is a deliberate edit; everything else is stale.
      keep = new Set(touched);
      // Built inside a compacted stretch of history, the state it started from is
      // unknown, so only settings the user touched are taken from it.
      if (!startingStateLost) {
        eachSyncedSetting((key, incomingValue, prePullValue) => {
          if (!same(incomingValue, prePullValue)) keep.add(key);
          return true;
        });
      }
    } else {
      // Stale when every setting the user did not touch still holds its pre-pull value.
      const stale = eachSyncedSetting(
        (key, incomingValue, prePullValue) => touched.has(key) || same(incomingValue, prePullValue)
      );
      if (!stale) return false;
    }

    const incoming = { ...configStore.get() };
    replaceConfigContents(
      configStore.get(),
      profileSyncCore.mergeSyncedProfileIntoConfig(
        configStore.get(),
        // Cleared fields come through as null, so a setting the pull removed is
        // removed from the stale update too rather than left as it was.
        profileSyncCore.projectSyncProfile(pulledConfig, scope, { markCleared: true }),
        scope
      )
    );
    // Deliberate values from the update survive, even ones equal to the pre-pull value.
    keep.forEach((key) => {
      const [owner, field] = key.startsWith('ui.') ? [incoming.ui, key.slice(3)] : [incoming, key];
      const target = key.startsWith('ui.')
        ? (configStore.get().ui = { ...(configStore.get().ui || {}) })
        : configStore.get();
      if (owner && Object.prototype.hasOwnProperty.call(owner, field)) {
        target[field] = owner[field];
      } else {
        delete target[field];
      }
    });
    ensureProfileSyncConfigDefaults(configStore.get());
    configStore.get().profileSync.syncScope = scope;
    profileSyncRuntime.pendingPullEchoHash = null;
    log.debug('Reverted the stale part of a renderer config update that predates the last pull');
    return true;
  }

  function updateLocalProfileSyncTracking({ allowDebouncedPush = true } = {}) {
    const scope = getActiveProfileSyncScope();
    const profile = profileSyncCore.projectSyncProfile(configStore.get(), scope);
    const nextHash = computeScopedProfileHash(profile, scope);
    const previousSectionHashes = profileSyncRuntime.localSectionHashes || {};
    const nextSectionHashes = computeLocalSectionHashes(scope);
    profileSyncRuntime.localSectionHashes = nextSectionHashes;
    const changedSections = Object.keys(nextSectionHashes).filter(
      (key) => previousSectionHashes[key] !== nextSectionHashes[key]
    );
    if (profileSyncRuntime.localProfileHash === null) {
      profileSyncRuntime.localProfileHash = nextHash;
      profileSyncRuntime.localProfileUpdatedAt = new Date().toISOString();
      return;
    }
    if (profileSyncRuntime.localProfileHash === nextHash) {
      return;
    }

    // A pulled profile is applied here in main, but the renderer may still have an
    // in-flight config snapshot from before the pull. That snapshot comes back
    // through update-config and looks like a change back to the pre-pull content.
    // Reverting to byte-identical pre-pull content is never a real user edit, so
    // drop it instead of pushing stale data over the newer remote profile. Matching
    // on content rather than on a timer means a genuine edit made moments after a
    // pull still pushes immediately.
    if (
      profileSyncRuntime.pendingPullEchoHash !== null &&
      nextHash === profileSyncRuntime.pendingPullEchoHash
    ) {
      profileSyncRuntime.pendingPullEchoHash = null;
      profileSyncRuntime.localProfileHash = nextHash;
      // The edit times deliberately stay on the pulled sections' timestamps, and
      // their baseline is dropped: the next run then sees a tie with the file,
      // which the file wins, so the pulled content comes back instead of the
      // stale echo being pushed out.
      if (configStore.get()?.profileSync?.syncBaseline) {
        changedSections.forEach((key) => {
          delete configStore.get().profileSync.syncBaseline[key];
        });
      }
      return;
    }

    profileSyncRuntime.pendingPullEchoHash = null;
    profileSyncRuntime.localProfileHash = nextHash;
    profileSyncRuntime.localProfileUpdatedAt = new Date().toISOString();
    if (configStore.get()?.profileSync) {
      configStore.get().profileSync.profileUpdatedAt = profileSyncRuntime.localProfileUpdatedAt;
      const nowMs = Date.parse(profileSyncRuntime.localProfileUpdatedAt);
      configStore.get().profileSync.sectionUpdatedAt = {
        ...(configStore.get().profileSync.sectionUpdatedAt || {}),
        ...Object.fromEntries(
          changedSections.map((key) => [
            key,
            stampLocalSectionEdit(configStore.get().profileSync, key, nowMs),
          ])
        ),
      };
    }

    if (allowDebouncedPush) {
      scheduleDebouncedProfileSyncPush('config_change');
    }
  }

  /**
   * The latest edit time this device knows for a section: its own last edit or pull, or the
   * version it last agreed on with the file, as that version's writer recorded it.
   */
  function getKnownSectionUpdatedAt(profileSync, key) {
    return [
      profileSync?.sectionUpdatedAt?.[key],
      profileSync?.syncBaselineUpdatedAt?.[key]?.updatedAt,
    ].reduce(
      (latest, value) =>
        typeof value === 'string' && profileSyncCore.compareIsoTimestamps(value, latest) > 0
          ? value
          : latest,
      null
    );
  }

  /**
   * The edit time of a section changed on this device: now, or just after the version it
   * replaced when this clock is slightly behind the one that wrote that version. An edit made
   * after a pull then beats what it replaced, and no device takes it for a stale copy of the
   * file. It never carries more of another clock's lead than the sync clock tolerance, or one
   * pull from a clock a day ahead would stamp every later edit here a day ahead as well, and
   * those would win conflicts they should lose.
   */
  function stampLocalSectionEdit(profileSync, key, nowMs = Date.now()) {
    const knownMs = Date.parse(getKnownSectionUpdatedAt(profileSync, key) || '');
    const latestMs = nowMs + profileSyncCore.SYNC_FUTURE_TOLERANCE_MS;
    return new Date(
      Number.isNaN(knownMs) ? nowMs : Math.min(Math.max(nowMs, knownMs + 1), latestMs)
    ).toISOString();
  }

  /**
   * The edit time written for a pushed section. It is always later than the file's version it
   * replaces, so no other device takes it for a stale copy of the file: Sync up and Keep local
   * can push a section this device last changed before the file's version was written.
   */
  function stampPushedSection(profileSync, key, remoteEntry) {
    const own = getKnownSectionUpdatedAt(profileSync, key) || new Date().toISOString();
    const remoteMs = Date.parse(remoteEntry?.updatedAt || '');
    return Number.isNaN(remoteMs) || Date.parse(own) > remoteMs
      ? own
      : new Date(remoteMs + 1).toISOString();
  }

  /**
   * Starts, stops or prepares sync after a Settings save turned it on or off, moved it to another
   * file, or changed what it covers.
   */
  async function applyProfileSyncSettingsChange({ requiresInitialPreparation = false } = {}) {
    const syncEnabled = !!configStore.get().profileSync?.enabled;
    if (!syncEnabled) {
      profileSyncRuntime.needsResolution = false;
      profileSyncRuntime.pendingRemoteEnvelope = null;
      clearProfileSyncTimers();
    } else if (typeof configStore.get().profileSync.encryptionChangePending === 'boolean') {
      clearProfileSyncTimers();
      emitProfileSyncStatus();
    } else if (requiresInitialPreparation) {
      profileSyncRuntime.needsResolution = false;
      profileSyncRuntime.pendingRemoteEnvelope = null;
      profileSyncRuntime.pendingRemoteIdentity = null;
      const hasRequiredPassphrase =
        !configStore.get().profileSync.encryptionEnabled || !!getActiveProfileSyncPassphrase();
      if (hasRequiredPassphrase) {
        try {
          const resolution = await prepareProfileSyncFirstEnableResolution();
          if (!resolution?.needsResolution) {
            await completeProfileSyncFirstEnablePreparation('settings_enable');
          }
        } catch (error) {
          clearProfileSyncTimers();
          updateProfileSyncStatus('error', mainTError(error));
        }
      } else {
        clearProfileSyncTimers();
        emitProfileSyncStatus();
      }
    } else if (configStore.get().profileSync.firstEnableResolutionPending) {
      clearProfileSyncTimers();
    } else {
      setupProfileSyncInterval();
    }
  }

  function setupProfileSyncInterval() {
    if (profileSyncRuntime.intervalTimer) {
      clearInterval(profileSyncRuntime.intervalTimer);
      profileSyncRuntime.intervalTimer = null;
    }

    const profileSync = getProfileSyncConfig();
    if (
      !profileSync.enabled ||
      profileSyncRuntime.needsResolution ||
      profileSync.firstEnableResolutionPending ||
      hasProfileSyncCredentialTransitionPending(profileSync) ||
      !hasProfileSyncTarget(profileSync)
    ) {
      return;
    }

    const intervalMs =
      Math.max(1, Number(profileSync.intervalMinutes) || PROFILE_SYNC_DEFAULT_INTERVAL_MINUTES) *
      60 *
      1000;
    profileSyncRuntime.intervalTimer = setInterval(() => {
      runProfileSync('auto', 'interval').catch((error) => {
        log.warn('Profile sync interval run failed:', error.message);
      });
    }, intervalMs);
  }

  /**
   * Sections this computer and the file both hold, with different content and no
   * shared history to merge from.
   */
  async function findProfileSyncConflictSections(envelope) {
    const localSections = profileSyncCore.buildLocalSections(
      configStore.get(),
      getActiveProfileSyncScope()
    );
    let decoded;
    try {
      decoded = await profileSyncCore.decodeEnvelopeSections(
        envelope,
        getActiveProfileSyncPassphrase()
      );
    } catch (error) {
      // A file whose content cannot be read is damaged in every section.
      if (!profileSyncCore.isSyncFileDamagedError(error)) throw error;
      const everySection = Object.keys(localSections);
      return { sections: everySection, damaged: everySection, unreadable: true };
    }
    const { sections: remoteSections, malformed } = decoded;
    const baseline = getProfileSyncConfig().syncBaseline || {};
    // A damaged section also needs a choice: Keep Local replaces it after backing
    // it up, where an automatic run would only stop. Use Remote cannot apply it.
    const isDamaged = (key) => !!malformed && Object.prototype.hasOwnProperty.call(malformed, key);
    const sections = Object.entries(localSections)
      .filter(
        ([key, data]) =>
          isDamaged(key) ||
          (!baseline[key] &&
            remoteSections[key] &&
            profileSyncCore.computeSectionHash(key, data) !==
              profileSyncCore.computeSectionHash(key, remoteSections[key].data))
      )
      .map(([key]) => key);
    return { sections, damaged: sections.filter(isDamaged) };
  }

  /**
   * Before the first sync against a file (or of a section newly added to this
   * device's scope), finds sections where this device and the file already hold
   * different content with no shared history to merge from. Those need the user to
   * choose a side; everything else can sync normally.
   */
  async function prepareProfileSyncFirstEnableResolution() {
    const profileSync = getProfileSyncConfig();
    profileSyncRuntime.needsResolution = false;
    profileSyncRuntime.pendingRemoteEnvelope = null;
    profileSyncRuntime.pendingRemoteIdentity = null;
    profileSyncRuntime.conflictSections = [];
    profileSyncRuntime.damagedConflictSections = [];

    if (!profileSync.enabled || !hasProfileSyncTarget(profileSync)) {
      return { needsResolution: false };
    }

    let readResult = await readConfiguredSyncEnvelope({ allowDamaged: true });
    profileSyncRuntime.pendingRemoteIdentity = getSyncEnvelopeIdentity(readResult);
    if (!readResult.exists) {
      return { needsResolution: false };
    }

    let conflicts = await findProfileSyncConflictSectionsInRead(readResult);
    if (conflicts.unreadable) {
      // A file the provider is still delivering reads as damaged for a moment, and the choice
      // offered for a damaged file replaces it. It is read once more before that is offered.
      await waitForSyncFileToSettle();
      readResult = await readConfiguredSyncEnvelope({ allowDamaged: true });
      profileSyncRuntime.pendingRemoteIdentity = getSyncEnvelopeIdentity(readResult);
      if (!readResult.exists) {
        return { needsResolution: false };
      }
      conflicts = await findProfileSyncConflictSectionsInRead(readResult);
    }
    const { sections: conflictSections, damaged } = conflicts;
    if (conflictSections.length === 0) {
      return { needsResolution: false };
    }

    profileSyncRuntime.needsResolution = true;
    profileSyncRuntime.conflictSections = conflictSections;
    profileSyncRuntime.damagedConflictSections = damaged;
    profileSyncRuntime.pendingRemoteEnvelope = readResult.envelope;
    profileSyncRuntime.pendingRemoteIdentity = getSyncEnvelopeIdentity(readResult);
    // A pending choice is not a failure: the status line and the choice panel carry it.
    updateProfileSyncStatus('needs_resolution');
    emitProfileSyncStatus();
    return { needsResolution: true };
  }

  /**
   * The conflict check for what a read returned, which may be a file that cannot be parsed.
   * `unreadable` says the whole file could not be read, rather than some of its sections.
   */
  async function findProfileSyncConflictSectionsInRead(readResult) {
    if (readResult.damaged) {
      const everySection = Object.keys(
        profileSyncCore.buildLocalSections(configStore.get(), getActiveProfileSyncScope())
      );
      return { sections: everySection, damaged: everySection, unreadable: true };
    }
    return findProfileSyncConflictSections(readResult.envelope);
  }

  /** The pause before reading again a sync file that read as damaged on first enable. */
  function waitForSyncFileToSettle() {
    return sleep(PROFILE_SYNC_DAMAGED_REREAD_DELAY_MS);
  }

  function getSyncEnvelopeIdentity(readResult) {
    if (readResult?.damaged) {
      return `damaged:${nodeCrypto.createHash('sha256').update(readResult.damaged.raw).digest('hex')}`;
    }
    if (!readResult?.exists || !readResult.envelope) return 'missing';
    return nodeCrypto
      .createHash('sha256')
      .update(profileSyncCore.serializeSyncEnvelope(readResult.envelope))
      .digest('hex');
  }

  async function prepareRemoteRewriteBaseline(passphrase, baselineConfig = configStore.get()) {
    const readResult = await readConfiguredSyncEnvelope();
    const remoteSections = await decodeRemoteSectionsWithPassphrase(readResult, passphrase);
    assertRemoteSectionsMatchConfig(remoteSections, baselineConfig);
    return getSyncEnvelopeIdentity(readResult);
  }

  async function verifyPendingRemoteEnvelopeUnchanged() {
    const expectedIdentity = profileSyncRuntime.pendingRemoteIdentity;
    if (!expectedIdentity) {
      throw new Error(
        mainT('The pending profile conflict is no longer available; retry conflict check')
      );
    }
    const currentResult = await readConfiguredSyncEnvelope({ allowDamaged: true });
    const currentIdentity = getSyncEnvelopeIdentity(currentResult);
    if (currentIdentity !== expectedIdentity) {
      profileSyncRuntime.pendingRemoteEnvelope = currentResult.envelope;
      profileSyncRuntime.pendingRemoteIdentity = currentIdentity;
      profileSyncRuntime.needsResolution = true;
      const refreshed = currentResult.exists
        ? await findProfileSyncConflictSectionsInRead(currentResult).catch(() => null)
        : null;
      profileSyncRuntime.conflictSections = refreshed?.sections || [];
      profileSyncRuntime.damagedConflictSections = refreshed?.damaged || [];
      updateProfileSyncStatus(
        'needs_resolution',
        mainT('The remote profile changed while waiting for a choice. Review it and choose again.')
      );
      emitProfileSyncStatus();
      const error = new Error(
        mainT('The remote profile changed while waiting for conflict resolution')
      );
      error.remoteConflictRefreshed = true;
      throw error;
    }
    return currentResult;
  }

  async function clearProfileSyncFirstEnableResolutionPending() {
    const profileSync = getProfileSyncConfig();
    if (!profileSync.firstEnableResolutionPending) {
      return { success: true };
    }

    profileSync.firstEnableResolutionPending = false;
    const persistence = await configStore.apply(null, { origin: 'profile-sync' });
    if (!persistence.success) {
      profileSync.firstEnableResolutionPending = true;
      throw new Error(
        mainT('Failed to save profile sync conflict check: {{error}}', { error: persistence.error })
      );
    }
    return persistence;
  }

  /** Words why a first sync stopped short, rather than handing its reason code to the status line. */
  function describeIncompleteFirstProfileSync(result) {
    switch (result?.reason) {
      case 'rewrite_pending':
        return getProfileSyncConfig().passphraseTransition
          ? mainT(
              'A protected sync-key recovery is pending. Use Sync up to resume it; sync remains paused if the remote changed.'
            )
          : mainT('The remote profile still needs its encryption update. Use Sync up to retry.');
      case 'encryption_change_pending':
        return mainT('Finish or cancel the pending encryption change first.');
      case 'needs_resolution':
        return mainT('The first-time conflict check did not complete. Retry it before syncing.');
      case 'remote_changed':
        return mainT('The remote profile changed before the initial sync could complete');
      default:
        return mainT('Initial profile sync did not complete');
    }
  }

  async function completeProfileSyncFirstEnablePreparation(source) {
    const profileSync = getProfileSyncConfig();
    if (!profileSync.enabled || !hasProfileSyncTarget(profileSync)) {
      clearProfileSyncTimers();
      return { ok: false, reason: 'not_configured', status: buildProfileSyncStatus() };
    }
    // Keep the durable gate armed through the first identity-checked write. If the
    // provider changes or fails, retry remains available and no conflict is
    // silently bypassed.
    // No section conflicts remain, so a merge run syncs each section the right way:
    // matching ones only record their baseline, missing ones are uploaded.
    const expectedRemoteIdentity = profileSyncRuntime.pendingRemoteIdentity;
    const result = await runProfileSyncInternal('auto', source, { expectedRemoteIdentity });
    if (result?.ok !== true || result?.reason === 'remote_changed') {
      throw new Error(
        result?.error ? mainTError(result.error) : describeIncompleteFirstProfileSync(result)
      );
    }
    await clearProfileSyncFirstEnableResolutionPending();
    profileSyncRuntime.needsResolution = false;
    profileSyncRuntime.pendingRemoteEnvelope = null;
    profileSyncRuntime.pendingRemoteIdentity = null;
    setupProfileSyncInterval();
    return result;
  }

  function scheduleDebouncedProfileSyncPush(source = 'config_change') {
    const profileSync = getProfileSyncConfig();
    if (
      !profileSync.enabled ||
      profileSyncRuntime.needsResolution ||
      profileSync.firstEnableResolutionPending ||
      hasProfileSyncCredentialTransitionPending(profileSync)
    )
      return;
    if (
      !hasProfileSyncTarget(profileSync) ||
      !isProfileSyncProviderSupported(profileSync.provider)
    ) {
      return;
    }

    if (profileSyncRuntime.pushDebounceTimer) {
      clearTimeout(profileSyncRuntime.pushDebounceTimer);
    }
    profileSyncRuntime.pushDebounceTimer = setTimeout(() => {
      profileSyncRuntime.pushDebounceTimer = null;
      // A merge, not a forced push: another device may have changed other
      // sections since the last run, and those have to come in, not be overwritten.
      runProfileSync('auto', source).catch((error) => {
        log.warn('Debounced profile sync push failed:', error.message);
      });
    }, PROFILE_SYNC_PUSH_DEBOUNCE_MS);
  }

  const runCoalescedProfileSync = createLatestTaskCoalescer(
    (direction, source) => configStore.serialize(() => runProfileSyncInternal(direction, source)),
    { getPriority: (args) => (args[1] === 'manual' ? 1 : 0) }
  );

  function runProfileSync(direction = 'auto', source = 'manual') {
    return runCoalescedProfileSync(direction, source);
  }

  async function runProfileSyncInternal(direction = 'auto', source = 'manual', options = {}) {
    // Reassigned after a pull: applying one replaces config, and with it this object.
    let profileSync = getProfileSyncConfig();

    if (!profileSync.enabled) {
      return { ok: false, reason: 'disabled', status: buildProfileSyncStatus() };
    }
    if (!isProfileSyncProviderSupported(profileSync.provider)) {
      throw new Error(mainT('Unsupported profile sync provider'));
    }
    if (!hasProfileSyncTarget(profileSync)) {
      throw new Error(describeMissingProfileSyncTarget(profileSync));
    }
    if (profileSync.passphraseTransition) {
      if (source === 'manual' || source === 'startup_rewrite_recovery') {
        return executePendingProfileSyncRewrite();
      }
      return { ok: false, reason: 'rewrite_pending', status: buildProfileSyncStatus() };
    }
    // The merge that precedes an encryption change (options.encryptionPrepare) has to run
    // while that change is pending, or the edits it must publish could never be pushed.
    if (typeof profileSync.encryptionChangePending === 'boolean' && !options.encryptionPrepare) {
      return { ok: false, reason: 'encryption_change_pending', status: buildProfileSyncStatus() };
    }
    if (profileSync.firstEnableResolutionPending && source === 'manual') {
      try {
        const resolution = await prepareProfileSyncFirstEnableResolution();
        if (resolution?.needsResolution) {
          return { ok: false, reason: 'needs_resolution', status: buildProfileSyncStatus() };
        }
        return await completeProfileSyncFirstEnablePreparation('first_enable_resolution_retry');
      } catch (error) {
        updateProfileSyncStatus('error', mainTError(error));
        emitProfileSyncStatus();
        throw error;
      }
    }
    if (profileSync.remoteRewritePending && source === 'manual') {
      try {
        const expectedRemoteIdentity = await prepareRemoteRewriteBaseline(
          getActiveProfileSyncPassphrase(),
          configStore.get()
        );
        return await runProfileSyncInternal('push', 'remote_rewrite_retry', {
          expectedRemoteIdentity,
        });
      } catch (error) {
        updateProfileSyncStatus('error', mainTError(error));
        emitProfileSyncStatus();
        throw error;
      }
    }
    if (profileSync.remoteRewritePending && !options.expectedRemoteIdentity) {
      return { ok: false, reason: 'rewrite_pending', status: buildProfileSyncStatus() };
    }
    if (
      (profileSyncRuntime.needsResolution || profileSync.firstEnableResolutionPending) &&
      source !== 'first_enable_resolution' &&
      !options.expectedRemoteIdentity
    ) {
      return { ok: false, reason: 'needs_resolution', status: buildProfileSyncStatus() };
    }

    if (profileSyncRuntime.inFlight) {
      return { ok: false, reason: 'in_flight', queued: true, status: buildProfileSyncStatus() };
    }

    profileSyncRuntime.inFlight = true;
    emitProfileSyncStatus();

    try {
      const remoteResult = await readConfiguredSyncEnvelope({ allowDamaged: true });
      if (
        options.expectedRemoteIdentity &&
        getSyncEnvelopeIdentity(remoteResult) !== options.expectedRemoteIdentity
      ) {
        profileSyncRuntime.needsResolution = false;
        profileSyncRuntime.pendingRemoteEnvelope = remoteResult.envelope;
        profileSyncRuntime.pendingRemoteIdentity = getSyncEnvelopeIdentity(remoteResult);
        const error = new Error(
          mainT('The remote profile changed before the initial sync could complete')
        );
        error.remoteChangedBeforeResolution = true;
        error.remoteConflictRefreshed = true;
        throw error;
      }
      profileSyncRuntime.conflictCopies = await findProfileSyncConflictCopies();
      await syncTargetFor(profileSync.provider).removeStaleTempFiles(profileSync);

      if (remoteResult.damaged) {
        // A file that cannot be read is only replaced by an explicit Sync up (or Keep
        // Local on first enable), and only after a copy is kept.
        if (direction !== 'push') throw remoteResult.damaged.error;
        await backupDamagedSyncFile(remoteResult.damaged.raw);
      }
      // No file where this device has synced with one before is more likely an unmounted drive,
      // a file the provider evicted or a stopped sync client than a fresh start. Recreating it
      // would leave only this device's sections, so only an explicit Sync up may.
      if (
        !remoteResult.exists &&
        direction !== 'push' &&
        Object.keys(profileSync.syncBaseline || {}).length > 0
      ) {
        throw new Error(syncTargetFor(profileSync.provider).describeMissingProfile());
      }

      // A routine run never changes the file's encryption. Only the rewrite and
      // first-sync flows (which pin the exact remote they checked) may, so a
      // device with stale settings cannot publish the profile unencrypted or
      // re-encrypt it under a passphrase another device has replaced.
      let remoteEnvelope = remoteResult.exists ? remoteResult.envelope : null;
      const mayChangeEncryption =
        !!options.expectedRemoteIdentity || !!profileSync.remoteRewritePending;
      const remoteEncrypted =
        !!remoteEnvelope && profileSyncCore.isEnvelopeEncrypted(remoteEnvelope);
      if (
        remoteEnvelope &&
        !mayChangeEncryption &&
        remoteEncrypted !== !!profileSync.encryptionEnabled
      ) {
        throw new Error(
          profileSync.encryptionEnabled
            ? mainT(
                'The sync file is not encrypted, but encryption is on for this device. If another device turned encryption off, turn it off here too.'
              )
            : mainT(
                'The sync file is encrypted. Turn on encryption and enter the passphrase your other devices use.'
              )
        );
      }
      // Encryption is already on here, so the file's own error would send the user to turn
      // it on. What is missing is the passphrase (not remembered across a restart).
      if (remoteEncrypted && profileSync.encryptionEnabled && !getActiveProfileSyncPassphrase()) {
        throw new Error(
          mainT('Enter the sync passphrase in Settings > Advanced to continue syncing.')
        );
      }

      let decoded = { sections: {}, malformed: {}, extensions: null };
      if (remoteEnvelope) {
        try {
          decoded = await profileSyncCore.decodeEnvelopeSections(
            remoteEnvelope,
            getActiveProfileSyncPassphrase()
          );
        } catch (error) {
          // Content that parsed but cannot be read (a cut-off encrypted payload) is
          // damage like an unparseable file: Sync up replaces it after keeping a copy.
          if (!profileSyncCore.isSyncFileDamagedError(error) || direction !== 'push') throw error;
          await backupDamagedSyncFile(profileSyncCore.serializeSyncEnvelope(remoteEnvelope));
          remoteEnvelope = null;
        }
      }
      const {
        sections: remoteSections,
        malformed: remoteMalformed,
        extensions: remoteExtensions,
      } = decoded;
      const syncScope = getActiveProfileSyncScope();
      const scopeKeys = profileSyncCore.getScopeSectionKeys(syncScope);
      // A run can be limited to some sections (repairing damage on first enable);
      // the others are left exactly as they are on both sides.
      const sectionKeys = Array.isArray(options.onlySections)
        ? scopeKeys.filter((key) => options.onlySections.includes(key))
        : scopeKeys;
      // Damage only matters in sections this run syncs; the rest are written
      // back exactly as found.
      const { inScope: damagedInScope, outOfScope: damagedOutOfScope } = splitDamagedSyncSections(
        remoteMalformed,
        sectionKeys
      );
      const damagedSections = Object.keys(damagedInScope);
      if (damagedSections.length > 0) {
        // Only an explicit Sync up may replace damaged sections, after keeping them.
        if (direction !== 'push') throw createDamagedSyncSectionsError(damagedSections);
        await backupRemoteSectionsBeforePush(damagedInScope);
      }
      const localSections = profileSyncCore.buildLocalSections(configStore.get(), syncScope);
      const localUpdatedAt = Object.fromEntries(
        sectionKeys.map((key) => [
          key,
          profileSync.sectionUpdatedAt?.[key] || profileSync.profileUpdatedAt || null,
        ])
      );
      const runStartedMs = Date.now();
      const plan = profileSyncCore.planSectionSync({
        sectionKeys,
        localSections,
        remoteSections,
        baseline: profileSync.syncBaseline,
        agreedUpdatedAt: profileSync.syncBaselineUpdatedAt,
        localUpdatedAt,
        direction,
        forceSections: options.forceSections || null,
        now: runStartedMs,
      });
      const nextBaseline = {};
      // The edit time of each agreed version, which tells a stale copy of the file from an edit.
      const nextBaselineUpdatedAt = {};
      const previousAgreed = profileSync.syncBaselineUpdatedAt || {};
      const agreeOnRemote = (key, hash) => {
        nextBaseline[key] = hash;
        // The same content in an older copy of the file (a restored version holding it, or
        // another computer that wrote it earlier) must not move the agreed time back: a later
        // stale copy would then no longer read as older than it.
        const remoteAt = remoteSections[key].updatedAt;
        const before = previousAgreed[key];
        nextBaselineUpdatedAt[key] =
          before?.hash === hash &&
          profileSyncCore.compareIsoTimestamps(before.updatedAt, remoteAt) > 0
            ? before.updatedAt
            : remoteAt;
      };
      plan.unchanged.forEach((key) => {
        if (plan.localHashes[key] === plan.remoteHashes[key]) {
          agreeOnRemote(key, plan.localHashes[key]);
        }
      });

      let currentLocalSections = localSections;
      const pushKeys = [...plan.push];
      if (plan.pull.length > 0) {
        await backupLocalProfileBeforePullApply(plan.pull, null, 'pull', {
          discarded: plan.discardsLocal,
        });
        await applySyncedProfileToConfig(pickSections(remoteSections, plan.pull));
        profileSync = getProfileSyncConfig();
        currentLocalSections = profileSyncCore.buildLocalSections(configStore.get(), syncScope);
        plan.pull.forEach((key) => {
          const appliedHash = profileSyncCore.computeSectionHash(key, currentLocalSections[key]);
          if (appliedHash === plan.remoteHashes[key]) {
            agreeOnRemote(key, appliedHash);
          } else {
            // The file lacked fields this version keeps (an older writer), so the
            // applied section still differs; write it back so both sides agree.
            pushKeys.push(key);
          }
        });
      }

      // Changing the encryption mode rewrites the whole file even when no section
      // content changed. A file that is already in this device's mode (another computer
      // got there first) needs no rewrite, only the marker cleared.
      const remoteModeMatches =
        !remoteEnvelope || remoteEncrypted === !!profileSync.encryptionEnabled;
      const rewriteRequired =
        !!profileSync.remoteRewritePending && mayChangeEncryption && !remoteModeMatches;
      // Without a subscription Cloud Sync still serves the profile but refuses saves. The
      // pulls above are kept and recorded; this device's own edits wait, unsaved, until a
      // save is accepted. A pending encryption rewrite cannot wait like that, so it fails.
      const mayHoldPushes = !rewriteRequired && !profileSync.remoteRewritePending;
      const finishWithoutSaving = async () => {
        await persistProfileSyncBaseline(nextBaseline, scopeKeys, nextBaselineUpdatedAt);
        profileSyncRuntime.lastRemote = remoteEnvelope
          ? {
              updatedAt: remoteEnvelope.updatedAt,
              updatedByDeviceId: remoteEnvelope.updatedByDeviceId,
            }
          : null;
        profileSyncRuntime.lastRunSummary = {
          at: new Date().toISOString(),
          pushed: [],
          pulled: plan.pull,
          replacedLocal: plan.discardsLocal,
          replacedRemote: [],
          staleRemote: [],
        };
        updateProfileSyncStatus(
          'error',
          mainT(
            'Cloud Sync needs a subscription to save changes. Changes from your other computers still download.'
          )
        );
        setupProfileSyncInterval();
        profileSyncRuntime.inFlight = false;
        const status = buildProfileSyncStatus();
        emitProfileSyncStatus();
        const pulled = plan.pull.length > 0;
        return {
          ok: true,
          action: pulled ? 'pull' : 'none',
          reason: 'subscription_required',
          pushed: [],
          pulled: plan.pull,
          status,
          ...(pulled ? { config: rendererConfig() } : {}),
        };
      };
      if (pushKeys.length > 0 && mayHoldPushes && shouldHoldCloudSyncWrites(profileSync, source)) {
        return await finishWithoutSaving();
      }

      let wroteEnvelope = null;
      if (pushKeys.length > 0 || rewriteRequired) {
        // A merge only replaces remote edits it reports as discarded. Sync up replaces
        // whatever the file holds for the sections it pushes, so it keeps all of them.
        const replacedRemoteKeys = direction === 'push' ? plan.push : plan.discardsRemote;
        const replacedRemoteSections = pickSections(remoteSections, replacedRemoteKeys);
        if (Object.keys(replacedRemoteSections).length > 0) {
          await backupRemoteSectionsBeforePush(replacedRemoteSections, {
            discarded: plan.discardsRemote.filter((key) => replacedRemoteSections[key]),
          });
        }
        const now = new Date().toISOString();
        const nextSections = { ...damagedOutOfScope, ...remoteSections };
        pushKeys.forEach((key) => {
          nextSections[key] = profileSyncCore.buildPushedSectionEntry(
            key,
            currentLocalSections[key],
            remoteSections[key],
            {
              updatedAt: stampPushedSection(profileSync, key, remoteSections[key]),
              deviceId: profileSync.deviceId,
            }
          );
        });
        const encrypt = !!profileSync.encryptionEnabled;
        const passphrase = getActiveProfileSyncPassphrase();
        if (encrypt && !passphrase) {
          throw new Error(mainT('A passphrase is required to sync encrypted profiles'));
        }
        const envelopeToWrite = await profileSyncCore.buildSyncEnvelope({
          sections: nextSections,
          updatedAt: now,
          updatedByDeviceId: profileSync.deviceId,
          encrypt,
          passphrase,
          extensions: remoteExtensions,
        });

        // Another device wrote first: keep what this run agreed on and merge again from
        // what is there now.
        const recheckAfterRemoteChange = async () => {
          await persistProfileSyncBaseline(nextBaseline, scopeKeys, nextBaselineUpdatedAt);
          // Sync up and a conflict choice were decided against the file as it was;
          // an automatic merge must not stand in for them, so the user is asked again.
          if (source === 'conflict_recheck' || direction !== 'auto') {
            throw new Error(mainT('Sync file kept changing on the other device; try again'));
          }
          void runProfileSync('auto', 'conflict_recheck');
          // The finally below only clears this after the last status has gone out, so the
          // run is marked over first or Settings would keep its buttons disabled.
          profileSyncRuntime.inFlight = false;
          const status = buildProfileSyncStatus();
          emitProfileSyncStatus();
          return { ok: true, action: 'none', reason: 'remote_changed', queued: true, status };
        };

        // Best-effort compare-before-write: encryption and provider replication take time, so
        // another device can land a write between the read above and this one.
        // Overwriting blind would silently drop it, so re-check and re-resolve.
        if (await hasRemoteSyncEnvelopeChanged(remoteResult)) {
          log.info('Remote sync file changed while preparing a push; re-resolving direction');
          return await recheckAfterRemoteChange();
        }

        try {
          await writeConfiguredSyncEnvelope(envelopeToWrite);
        } catch (error) {
          // Cloud Sync refuses a write that lost the race after the check above, the same
          // situation that check catches earlier.
          if (error?.code === 'CLOUD_SYNC_CONFLICT') {
            log.info('Cloud Sync profile changed during the push; re-resolving direction');
            return await recheckAfterRemoteChange();
          }
          if (error?.code !== 'CLOUD_SYNC_SUBSCRIPTION_REQUIRED' || !mayHoldPushes) throw error;
          profileSyncRuntime.cloudSyncWriteRefusedAt = Date.now();
          return await finishWithoutSaving();
        }
        profileSyncRuntime.cloudSyncWriteRefusedAt = 0;
        wroteEnvelope = envelopeToWrite;
        pushKeys.forEach((key) => {
          nextBaseline[key] = profileSyncCore.computeSectionHash(key, currentLocalSections[key]);
          nextBaselineUpdatedAt[key] = nextSections[key].updatedAt;
        });
        if (profileSync.remoteRewritePending) await completeProfileSyncRemoteRewrite();
      } else if (profileSync.remoteRewritePending && mayChangeEncryption && remoteModeMatches) {
        await completeProfileSyncRemoteRewrite();
      }

      await persistProfileSyncBaseline(nextBaseline, scopeKeys, nextBaselineUpdatedAt);
      const finalEnvelope = wroteEnvelope || remoteEnvelope;
      profileSyncRuntime.lastRemote = finalEnvelope
        ? {
            updatedAt: finalEnvelope.updatedAt,
            updatedByDeviceId: finalEnvelope.updatedByDeviceId,
          }
        : null;
      profileSyncRuntime.lastRunSummary = {
        at: new Date().toISOString(),
        pushed: pushKeys,
        pulled: plan.pull,
        replacedLocal: plan.discardsLocal,
        // A stale copy was not an edit on another computer, so it is reported on its own.
        replacedRemote: plan.discardsRemote.filter((key) => !plan.staleRemote.includes(key)),
        staleRemote: plan.staleRemote,
      };
      updateProfileSyncStatus('success', '');
      setupProfileSyncInterval();
      profileSyncRuntime.inFlight = false;
      const status = buildProfileSyncStatus();
      emitProfileSyncStatus();
      const pushed = pushKeys.length > 0 || !!wroteEnvelope;
      const pulled = plan.pull.length > 0;
      const action = pushed && pulled ? 'merge' : pushed ? 'push' : pulled ? 'pull' : 'none';
      return {
        ok: true,
        action,
        pushed: pushKeys,
        pulled: plan.pull,
        status,
        ...(pulled ? { config: rendererConfig() } : {}),
      };
    } catch (error) {
      profileSyncRuntime.inFlight = false;
      updateProfileSyncStatus('error', mainTError(error));
      emitProfileSyncStatus();
      throw error;
    } finally {
      profileSyncRuntime.inFlight = false;
    }
  }

  /**
   * Clears the marker saying the sync file still has to be rewritten in this device's
   * encryption mode, once the file is in it. Turning encryption off also forgets the
   * passphrase, which nothing needs any more.
   */
  async function completeProfileSyncRemoteRewrite() {
    const profileSync = getProfileSyncConfig();
    const previousCredential = {
      rememberPassphrase: profileSync.rememberPassphrase,
      passphraseEncrypted: profileSync.passphraseEncrypted,
      storedPassphrase: profileSync.storedPassphrase,
      passphraseSession: profileSyncRuntime.passphraseSession,
      passphraseWarning: profileSyncRuntime.passphraseWarning,
    };
    profileSync.remoteRewritePending = false;
    if (!profileSync.encryptionEnabled) forgetProfileSyncPassphrase(profileSync);
    const markerPersistence = await configStore.apply(null, { origin: 'profile-sync' });
    if (!markerPersistence.success) {
      profileSync.remoteRewritePending = true;
      profileSync.rememberPassphrase = previousCredential.rememberPassphrase;
      profileSync.passphraseEncrypted = previousCredential.passphraseEncrypted;
      profileSync.storedPassphrase = previousCredential.storedPassphrase;
      profileSyncRuntime.passphraseSession = previousCredential.passphraseSession;
      profileSyncRuntime.passphraseWarning = previousCredential.passphraseWarning;
      const markerError = new Error(
        mainT(
          'Remote profile was rewritten, but the local completion marker could not be saved: {{error}}',
          { error: markerPersistence.error }
        )
      );
      markerError.remoteRewriteCommitted = true;
      throw markerError;
    }
  }

  /**
   * Records which sections this device and the file now agree on. Sections that
   * are out of scope are forgotten, and ones whose outcome is still open (a
   * re-check is queued) keep their previous baseline. `agreedUpdatedAt` holds the
   * edit time of each agreed version.
   */
  async function persistProfileSyncBaseline(agreedHashes, sectionKeys, agreedUpdatedAt = {}) {
    const profileSync = getProfileSyncConfig();
    const previous = profileSync.syncBaseline || {};
    const previousUpdatedAt = profileSync.syncBaselineUpdatedAt || {};
    const next = {};
    const nextUpdatedAt = {};
    sectionKeys.forEach((key) => {
      if (agreedHashes[key]) {
        next[key] = agreedHashes[key];
        if (typeof agreedUpdatedAt[key] === 'string') {
          nextUpdatedAt[key] = { hash: agreedHashes[key], updatedAt: agreedUpdatedAt[key] };
        }
      } else if (previous[key]) {
        next[key] = previous[key];
        if (previousUpdatedAt[key]) nextUpdatedAt[key] = previousUpdatedAt[key];
      }
    });
    profileSync.syncBaseline = next;
    profileSync.syncBaselineUpdatedAt = nextUpdatedAt;
    const persistence = await configStore.apply(null, { origin: 'profile-sync' });
    if (!persistence.success) {
      profileSync.syncBaseline = previous;
      profileSync.syncBaselineUpdatedAt = previousUpdatedAt;
      throw new Error(
        mainT('Failed to save profile sync state: {{error}}', { error: persistence.error })
      );
    }
  }

  /**
   * Runs a sync triggered by something other than the interval timer (window focus,
   * waking from suspend). Best-effort: it declines rather than queues when a sync is
   * already running or the setup is incomplete.
   *
   * @param {string} source label recorded for logging
   */
  function requestOpportunisticProfileSync(source) {
    const profileSync = getProfileSyncConfig();
    if (!profileSync.enabled || !hasProfileSyncTarget(profileSync)) return;
    if (
      profileSyncRuntime.needsResolution ||
      profileSync.firstEnableResolutionPending ||
      hasProfileSyncCredentialTransitionPending(profileSync) ||
      profileSyncRuntime.inFlight
    )
      return;

    // focus fires on every alt-tab, so without a floor this would hit the sync
    // folder constantly to discover nothing changed.
    const now = Date.now();
    if (now - profileSyncRuntime.lastOpportunisticSyncAt < PROFILE_SYNC_OPPORTUNISTIC_MIN_GAP_MS) {
      return;
    }
    profileSyncRuntime.lastOpportunisticSyncAt = now;

    runProfileSync('auto', source).catch((error) => {
      log.warn(`Opportunistic profile sync (${source}) failed:`, error.message);
    });
  }

  async function initializeProfileSyncOnStartupInternal() {
    const profileSync = getProfileSyncConfig();
    if (!profileSync.enabled || !hasProfileSyncTarget(profileSync)) return;
    if (profileSyncRuntime.needsResolution || profileSyncRuntime.pendingRemoteEnvelope) return;

    try {
      if (profileSync.passphraseTransition) {
        await executePendingProfileSyncRewrite();
        return;
      }
      if (profileSync.firstEnableResolutionPending) {
        const resolution = await prepareProfileSyncFirstEnableResolution();
        if (resolution?.needsResolution) {
          clearProfileSyncTimers();
          return;
        }
        await completeProfileSyncFirstEnablePreparation('startup_first_enable');
        return;
      }
      setupProfileSyncInterval();
      // 'auto' compares content timestamps, so offline edits made on this device
      // after the remote's last write are pushed instead of being discarded by a
      // forced pull.
      await runProfileSyncInternal('auto', 'startup');
    } catch (error) {
      // Keep the interval: at login the sync folder is often not mounted yet
      // (OneDrive, a Google Drive letter) and a later run succeeds on its own.
      // setupProfileSyncInterval stays off while a choice or recovery is pending.
      clearProfileSyncTimers();
      setupProfileSyncInterval();
      log.warn('Profile sync startup run failed:', error.message);
    }
  }

  function initializeProfileSyncOnStartup() {
    return configStore.serialize(initializeProfileSyncOnStartupInternal);
  }

  /**
   * Picks sync up after signing in to Cloud Sync while it is the enabled target.
   * The same account carries on from its shared history; a different or first
   * account is compared with this device the way enabling sync does. A sync-key
   * change waiting for recovery is left to finish first, unless it was the other
   * account's.
   */
  async function startHostedProfileSyncAfterSignIn(previousAccount, account) {
    // A refusal belonged to the account signed in before; this one may be subscribed.
    profileSyncRuntime.cloudSyncWriteRefusedAt = 0;
    const profileSync = getProfileSyncConfig();
    if (!profileSync.enabled || syncTargetFor(profileSync.provider) !== cloudSyncTarget) return;
    // Signing out left this error behind; it is wrong now whichever way sign-in goes on,
    // including when a pending key change holds sync back and no run replaces it.
    if (profileSync.lastSyncError === mainT('Sign in to Cloud Sync to keep syncing')) {
      profileSync.lastSyncStatus = 'idle';
      profileSync.lastSyncError = '';
      configStore.save({ origin: 'local' });
    }
    const sameAccount = isSameCloudSyncAccount(previousAccount, account);
    if (hasProfileSyncCredentialTransitionPending(profileSync)) {
      // The recovery needs the history it was staged against, so it is kept rather than
      // compared afresh; Settings shows what is pending, and Sync up resumes it.
      if (sameAccount) {
        setupProfileSyncInterval();
        emitProfileSyncStatus();
        return 'recovery_pending';
      }
      // Those markers name no account, but the work they describe was the other account's:
      // its file is not this one's, and a staged rewrite refuses to run anywhere else. They
      // are dropped so they cannot pause, or later be merged into, the account signed in now.
      profileSync.encryptionChangePending = null;
      profileSync.passphraseTransition = null;
      profileSync.passphraseTransitionInvalid = false;
      profileSync.remoteRewritePending = false;
    }
    if (
      sameAccount &&
      !profileSync.firstEnableResolutionPending &&
      Object.keys(profileSync.syncBaseline || {}).length > 0
    ) {
      setupProfileSyncInterval();
      return 'resume';
    }
    profileSync.syncBaseline = {};
    profileSync.firstEnableResolutionPending = true;
    profileSyncRuntime.needsResolution = false;
    profileSyncRuntime.pendingRemoteEnvelope = null;
    profileSyncRuntime.pendingRemoteIdentity = null;
    const persistence = await configStore.apply(null, { origin: 'profile-sync' });
    if (!persistence.success) {
      throw new Error(mainT('Failed to save settings: {{error}}', { error: persistence.error }));
    }
    if (profileSync.encryptionEnabled && !getActiveProfileSyncPassphrase()) {
      clearProfileSyncTimers();
      emitProfileSyncStatus();
      return 'needs_passphrase';
    }
    const resolution = await prepareProfileSyncFirstEnableResolution();
    if (!resolution?.needsResolution) {
      await completeProfileSyncFirstEnablePreparation('cloud_sign_in');
    }
    return 'prepared';
  }

  /** Stops syncing to an account this device is no longer signed in to, and says so. */
  function stopHostedProfileSyncAfterSignOut() {
    const profileSync = getProfileSyncConfig();
    if (syncTargetFor(profileSync.provider) !== cloudSyncTarget) return;
    clearProfileSyncTimers();
    profileSyncRuntime.needsResolution = false;
    profileSyncRuntime.pendingRemoteEnvelope = null;
    profileSyncRuntime.pendingRemoteIdentity = null;
    profileSyncRuntime.hostedRevision = null;
    if (profileSync.enabled) {
      updateProfileSyncStatus('error', mainT('Sign in to Cloud Sync to keep syncing'));
    }
  }

  function cloudSyncFailure(error) {
    return {
      success: false,
      code: error?.code || '',
      error: toCloudSyncError(error).message,
      status: buildProfileSyncStatus(),
    };
  }

  /*
   * Profile sync encryption, as one state machine.
   *
   * A device holds a committed mode (`encryptionEnabled`, which every routine sync checks
   * the file against), a passphrase (remembered, or kept for the session) and two markers
   * for work in flight: `encryptionChangePending` (Settings asked for a mode that is not
   * committed yet) and `passphraseTransition` (a staged, crash-recoverable rewrite). The
   * file is missing, plain text or encrypted.
   *
   * A Settings save runs update-config, which stores everything except credentials and
   * the mode (a requested mode change is only recorded as pending), then the handler
   * below, which compares the requested mode with the file:
   *
   *   sync was off, or there is no file   commit the mode here; first-enable writes the file
   *   the file is already in that mode    join: prove the passphrase unlocks it (on) or follow
   *                                       it (off); nothing is rewritten
   *   the file is in the other mode       rewrite: merge what differs, stage, write the exact
   *                                       target, promote the new mode and passphrase here
   *   same mode, a different passphrase   rekey: the same rewrite under a new key
   *   same mode, the passphrase only      unlock or remember it
   *
   * Every refusal (no keyring to seal the recovery record with, a missing or wrong
   * passphrase, changes that could not be merged) happens before anything is staged or
   * written. It puts the device back as it was and drops the pending marker, so sync is
   * never left paused behind advice that cannot work. Only a staged rewrite survives a
   * failure, because only then can the file be half changed.
   */

  // A request that cannot be carried out. The message is already worded for the user.
  function createProfileSyncRefusal(message) {
    const error = new Error(message);
    error.profileSyncRefusal = true;
    return error;
  }

  /**
   * Drops an encryption change that update-config recorded as pending but that could not
   * be carried out, so sync resumes. A staged rewrite is left for recovery.
   */
  async function abandonProfileSyncEncryptionChange() {
    const profileSync = getProfileSyncConfig();
    if (
      typeof profileSync.encryptionChangePending !== 'boolean' ||
      profileSync.passphraseTransition
    ) {
      return;
    }
    profileSync.encryptionChangePending = null;
    const persistence = await configStore.apply(null, { origin: 'profile-sync' });
    if (!persistence.success) {
      log.warn('Could not save the dropped encryption change:', persistence.error);
    }
    setupProfileSyncInterval();
    // Edits saved with the request were held back by the pending marker.
    scheduleDebouncedProfileSyncPush('config_change');
  }

  async function chooseProfileSyncFolder(provider, currentFolder = '', parentWindow = null) {
    const profileSync = getProfileSyncConfig();
    const providerToUse = normalizeProfileSyncProvider(provider || profileSync.provider);
    // The folder in the form, which may not be saved yet, comes before the saved one.
    const formFolder = typeof currentFolder === 'string' ? currentFolder.trim() : '';
    const defaultPath = await getDefaultProfileSyncFolderPath(
      providerToUse,
      formFolder || path.dirname(profileSync.cloudFilePath)
    );
    const resumeAutoHide = suspendAutoHide();
    let result;
    try {
      const dialogOptions = {
        title: mainT('Choose profile sync folder'),
        defaultPath,
        properties: ['openDirectory', 'createDirectory'],
      };
      // Parented to the Settings window, like the export and import pickers: a free-floating dialog
      // can open behind an always-on-top widget on Windows, and is a panel rather than a sheet on macOS.
      const parent = parentWindow && !parentWindow.isDestroyed?.() ? parentWindow : null;
      result = await (parent
        ? dialog.showOpenDialog(parent, dialogOptions)
        : dialog.showOpenDialog(dialogOptions));
    } finally {
      resumeAutoHide();
    }

    const folderPath = Array.isArray(result.filePaths) ? result.filePaths[0] : '';
    if (result.canceled || !folderPath) {
      return { canceled: true };
    }

    // Folders picked through the native dialog become valid copy destinations;
    // copy-profile-sync-file rejects destinations the user never selected.
    profileSyncRuntime.approvedCopyDestinationFolders.push(folderPath);
    if (
      profileSyncRuntime.approvedCopyDestinationFolders.length >
      PROFILE_SYNC_MAX_APPROVED_COPY_FOLDERS
    ) {
      profileSyncRuntime.approvedCopyDestinationFolders.shift();
    }

    const filePath = path.join(folderPath, PROFILE_SYNC_DEFAULT_FILE_NAME);
    return { canceled: false, folderPath, filePath, provider: providerToUse };
  }

  async function runProfileSyncFromSettings(direction = 'auto') {
    try {
      const allowedDirections = new Set(['auto', 'pull', 'push']);
      const normalizedDirection = allowedDirections.has(direction) ? direction : 'auto';
      return await runProfileSync(normalizedDirection, 'manual');
    } catch (error) {
      return { ok: false, error: mainTError(error), status: buildProfileSyncStatus() };
    }
  }

  async function getCloudSyncAccount() {
    const client = getCloudSyncClient();
    const result = {
      success: true,
      ...getCloudSyncStatus(),
      providers: [],
      billingAvailable: false,
      account: null,
      error: '',
    };
    if (!result.available) return result;
    try {
      Object.assign(result, await client.getServiceConfig());
    } catch (error) {
      result.error = toCloudSyncError(error).message;
    }
    if (result.signedIn) {
      try {
        result.account = await client.getAccount();
        if (result.account?.entitled) resumeCloudSyncWrites();
      } catch (error) {
        result.error = toCloudSyncError(error).message;
        Object.assign(result, getCloudSyncStatus());
      }
    }
    return result;
  }

  async function signInToCloudSync(provider) {
    const client = getCloudSyncClient();
    // The account this device's sync history belongs to: the one signed in now, or the
    // one signed in before a sign-out or expired session.
    const previousAccount = client.getStoredAccount() || client.getLastAccount();
    try {
      const signingIn = client.signIn(typeof provider === 'string' ? provider : '');
      emitProfileSyncStatus();
      const account = await signingIn;
      try {
        // Signing out while this waited its turn leaves nothing to start.
        const next = await configStore.serialize(() =>
          client.getStoredAccount()
            ? startHostedProfileSyncAfterSignIn(previousAccount, account)
            : null
        );
        if (next === 'resume') void runProfileSync('auto', 'cloud_sign_in').catch(() => {});
      } catch (error) {
        // Signed in either way; the status line explains why sync did not start.
        clearProfileSyncTimers();
        updateProfileSyncStatus('error', error.message);
      }
      return { success: true, account, status: buildProfileSyncStatus() };
    } catch (error) {
      return cloudSyncFailure(error);
    } finally {
      emitProfileSyncStatus();
    }
  }

  async function signOutOfCloudSync() {
    // Also cancels a sign-in still waiting for the browser, which would sign back in.
    await getCloudSyncClient().signOut();
    stopHostedProfileSyncAfterSignOut();
    emitProfileSyncStatus();
    return { success: true, status: buildProfileSyncStatus() };
  }

  async function openCloudSyncBilling() {
    try {
      return { success: true, ...(await getCloudSyncClient().openBilling()) };
    } catch (error) {
      return cloudSyncFailure(error);
    }
  }

  async function deleteCloudSyncAccount() {
    try {
      await getCloudSyncClient().deleteAccount();
      stopHostedProfileSyncAfterSignOut();
      return { success: true, status: buildProfileSyncStatus() };
    } catch (error) {
      // The service keeps the account when it cannot cancel the subscription first.
      if (error?.code === 'CLOUD_SYNC_BILLING_UNAVAILABLE') {
        return {
          success: false,
          code: error.code,
          error: mainT(
            'Your subscription could not be canceled, so the account was kept. Try again later.'
          ),
          status: buildProfileSyncStatus(),
        };
      }
      return cloudSyncFailure(error);
    } finally {
      emitProfileSyncStatus();
    }
  }

  async function listProfileSyncBackupsForSettings() {
    try {
      return { success: true, backups: await listProfileSyncBackups() };
    } catch (error) {
      return { success: false, error: mainTError(error), backups: [] };
    }
  }

  async function restoreProfileSyncBackupForSettings(id) {
    try {
      const result = await restoreProfileSyncBackup(id);
      return { success: true, ...result, config: rendererConfig() };
    } catch (error) {
      return { success: false, error: mainTError(error) };
    }
  }

  async function setProfileSyncPassphrase(
    passphrase,
    remember = false,
    desiredEncryptionEnabled = null
  ) {
    const refuse = async (error) => {
      await abandonProfileSyncEncryptionChange();
      return { success: false, error, status: buildProfileSyncStatus() };
    };
    try {
      const candidatePassphrase = typeof passphrase === 'string' ? passphrase.trim() : '';
      if (candidatePassphrase && candidatePassphrase.length < PROFILE_SYNC_MIN_PASSPHRASE_LENGTH) {
        return refuse(
          mainT('Passphrase must be at least {{count}} characters long', {
            count: PROFILE_SYNC_MIN_PASSPHRASE_LENGTH,
          })
        );
      }
      const profileSync = getProfileSyncConfig();

      if (profileSync.passphraseTransition) {
        try {
          await executePendingProfileSyncRewrite();
        } catch (error) {
          return {
            success: false,
            error: mainT(
              'Finish the pending sync-key recovery before changing the passphrase: {{error}}',
              { error: mainTError(error) }
            ),
            status: buildProfileSyncStatus(),
          };
        }
      }

      const activePassphrase = getActiveProfileSyncPassphrase();
      const targetEncryptionEnabled =
        typeof desiredEncryptionEnabled === 'boolean'
          ? desiredEncryptionEnabled
          : typeof profileSync.encryptionChangePending === 'boolean'
            ? profileSync.encryptionChangePending
            : profileSync.encryptionEnabled;
      const effectiveNewPassphrase = candidatePassphrase || activePassphrase;
      // Giving up on a pending change needs neither a passphrase nor the file.
      if (
        typeof desiredEncryptionEnabled === 'boolean' &&
        typeof profileSync.encryptionChangePending === 'boolean' &&
        desiredEncryptionEnabled === profileSync.encryptionEnabled
      ) {
        const previousPendingTarget = profileSync.encryptionChangePending;
        profileSync.encryptionChangePending = null;
        const cancellationPersistence = await configStore.apply(null, {
          origin: 'profile-sync',
        });
        if (!cancellationPersistence.success) {
          profileSync.encryptionChangePending = previousPendingTarget;
          return {
            success: false,
            error: mainT('Failed to cancel the pending encryption change: {{error}}', {
              error: cancellationPersistence.error,
            }),
            status: buildProfileSyncStatus(),
          };
        }
        setupProfileSyncInterval();
        if (!candidatePassphrase) {
          emitProfileSyncStatus();
          return {
            success: true,
            remembered: profileSync.rememberPassphrase,
            encrypted: profileSync.passphraseEncrypted,
            status: buildProfileSyncStatus(),
            config: rendererConfig(),
          };
        }
      }

      if (targetEncryptionEnabled && !effectiveNewPassphrase) {
        return refuse(
          mainT('Passphrase must be at least {{count}} characters long', {
            count: PROFILE_SYNC_MIN_PASSPHRASE_LENGTH,
          })
        );
      }

      const remoteResult =
        profileSync.enabled && hasProfileSyncTarget(profileSync)
          ? await readConfiguredSyncEnvelope()
          : { exists: false, envelope: null };

      if (targetEncryptionEnabled !== profileSync.encryptionEnabled) {
        let localEncryptionCommitPersisted = false;
        const previous = {
          encryptionEnabled: profileSync.encryptionEnabled,
          remoteRewritePending: profileSync.remoteRewritePending,
          rememberPassphrase: profileSync.rememberPassphrase,
          passphraseEncrypted: profileSync.passphraseEncrypted,
          storedPassphrase: profileSync.storedPassphrase,
          passphraseSession: profileSyncRuntime.passphraseSession,
          passphraseWarning: profileSyncRuntime.passphraseWarning,
        };
        const remoteExists = !!remoteResult.exists && !!remoteResult.envelope;
        const remoteMatchesTarget =
          remoteExists &&
          profileSyncCore.isEnvelopeEncrypted(remoteResult.envelope) === targetEncryptionEnabled;
        // What decrypts the file as it stands: nothing while it is plain text.
        const oldPassphrase = profileSync.encryptionEnabled
          ? candidatePassphrase || activePassphrase
          : '';

        try {
          if (profileSync.firstEnableResolutionPending || !remoteExists) {
            // The first-enable gate prevents either direction from running, so
            // committing the requested mode and credential locally is safe
            // until conflict preparation chooses the exact first write.
            profileSync.encryptionEnabled = targetEncryptionEnabled;
            profileSync.encryptionChangePending = null;
            profileSync.remoteRewritePending =
              !!remoteResult.envelope &&
              (remoteResult.envelope?.payload?.encrypted === true) !== targetEncryptionEnabled;
            let persisted = {
              remembered: profileSync.rememberPassphrase,
              encrypted: profileSync.passphraseEncrypted,
            };
            if (targetEncryptionEnabled) {
              persisted = persistRememberedProfileSyncPassphrase(
                effectiveNewPassphrase,
                !!remember
              );
            } else {
              profileSync.rememberPassphrase = false;
              profileSync.passphraseEncrypted = false;
              profileSync.storedPassphrase = '';
              profileSyncRuntime.passphraseSession = '';
              profileSyncRuntime.passphraseWarning = '';
              persisted = { remembered: false, encrypted: false };
            }
            const persistence = await configStore.apply(null, { origin: 'profile-sync' });
            if (!persistence.success) {
              throw new Error(
                mainT('Failed to save the requested encryption mode: {{error}}', {
                  error: persistence.error,
                })
              );
            }
            localEncryptionCommitPersisted = true;

            if (profileSync.enabled && profileSync.firstEnableResolutionPending) {
              const resolution = await prepareProfileSyncFirstEnableResolution();
              if (!resolution?.needsResolution) {
                await completeProfileSyncFirstEnablePreparation('passphrase_first_enable');
              } else {
                clearProfileSyncTimers();
              }
            } else if (profileSync.enabled && !remoteResult.exists) {
              const createResult = await runProfileSyncInternal(
                'push',
                'encryption_transition_missing',
                { expectedRemoteIdentity: 'missing' }
              );
              if (createResult?.ok !== true || createResult?.reason === 'remote_changed') {
                throw new Error(
                  createResult?.error ||
                    createResult?.reason ||
                    mainT('The missing remote profile could not be created')
                );
              }
              setupProfileSyncInterval();
            }
            emitProfileSyncStatus();
            return {
              success: true,
              ...persisted,
              status: buildProfileSyncStatus(),
              config: rendererConfig(),
            };
          }

          if (remoteMatchesTarget) {
            // Another computer already put the file in the requested mode, so this one
            // only follows it. Nothing is rewritten, whatever the old mode was here.
            const joinPassphrase = candidatePassphrase || activePassphrase;
            if (targetEncryptionEnabled) {
              if (!joinPassphrase) {
                throw createProfileSyncRefusal(
                  mainT('Enter the passphrase your other computers use for this sync file.')
                );
              }
              // Decoding proves the passphrase before anything is stored.
              await profileSyncCore.decodeEnvelopeSections(remoteResult.envelope, joinPassphrase);
            }
            profileSync.encryptionEnabled = targetEncryptionEnabled;
            profileSync.encryptionChangePending = null;
            profileSync.remoteRewritePending = false;
            let persisted = { remembered: false, encrypted: false };
            if (targetEncryptionEnabled) {
              persisted = persistRememberedProfileSyncPassphrase(joinPassphrase, !!remember);
            } else {
              forgetProfileSyncPassphrase(profileSync);
            }
            const persistence = await configStore.apply(null, { origin: 'profile-sync' });
            if (!persistence.success) {
              throw new Error(
                mainT('Failed to save the requested encryption mode: {{error}}', {
                  error: persistence.error,
                })
              );
            }
            localEncryptionCommitPersisted = true;
            setupProfileSyncInterval();
            // Bring this device level with the file now rather than at the next interval.
            let warning = '';
            try {
              await runProfileSyncInternal('auto', 'encryption_join');
            } catch (error) {
              warning = mainTError(error);
            }
            emitProfileSyncStatus();
            return {
              success: true,
              ...persisted,
              warning,
              status: buildProfileSyncStatus(),
              config: rendererConfig(),
            };
          }

          // The file is in the other mode, so it has to be rewritten. Every check that
          // can say no comes first: once a rewrite is staged the file may be half changed.
          if (!isSecureProfileSyncStorageAvailable(safeStorage, process.platform)) {
            throw createProfileSyncRefusal(
              mainT(
                'Secure system storage is unavailable, and changing the encryption of an existing sync file needs it. On Linux, start and unlock a keyring such as GNOME Keyring or KWallet, then restart the widget.'
              )
            );
          }
          if (profileSync.encryptionEnabled && !oldPassphrase) {
            throw createProfileSyncRefusal(
              mainT('Enter the current remote passphrase before disabling profile encryption')
            );
          }
          let currentRemote = remoteResult;
          const { sections: remoteSections } = await decodeRemoteFileWithPassphrase(
            currentRemote,
            oldPassphrase
          );
          if (!remoteSectionsMatchConfig(remoteSections, configStore.get())) {
            // Settings changed here in the same save, or on another computer since the
            // last sync. A rewrite must not hide either behind the new mode, so merge first.
            if (profileSync.encryptionEnabled) profileSyncRuntime.passphraseSession = oldPassphrase;
            const merged = await runProfileSyncInternal('auto', 'encryption_prepare', {
              encryptionPrepare: true,
            });
            if (merged?.ok !== true) {
              throw createProfileSyncRefusal(
                mainT(
                  'The remote profile has changes that are not present locally. Sync or resolve them before changing encryption.'
                )
              );
            }
            currentRemote = await readConfiguredSyncEnvelope();
          }

          const targetConfig = {
            ...configStore.get(),
            profileSync: {
              ...getProfileSyncConfig(),
              encryptionEnabled: targetEncryptionEnabled,
              encryptionChangePending: null,
            },
          };
          await stageProfileSyncRewrite({
            oldPassphrase,
            newPassphrase: targetEncryptionEnabled ? effectiveNewPassphrase : oldPassphrase,
            rememberNewPassphrase: !!remember,
            targetEncryptionEnabled,
            changeCredential: targetEncryptionEnabled,
            baselineConfig: configStore.get(),
            targetConfig,
            reason: 'encryption_transition',
            remoteResult: currentRemote,
          });
          const result = await executePendingProfileSyncRewrite();
          emitProfileSyncStatus();
          return {
            success: true,
            ...result,
            status: buildProfileSyncStatus(),
            config: rendererConfig(),
          };
        } catch (error) {
          // A merge or rewrite can replace the config, and the profileSync in it.
          const current = getProfileSyncConfig();
          if (!current.passphraseTransition && !localEncryptionCommitPersisted) {
            // Nothing was written: put the device back as it was and drop the request.
            current.encryptionEnabled = previous.encryptionEnabled;
            current.remoteRewritePending = previous.remoteRewritePending;
            current.rememberPassphrase = previous.rememberPassphrase;
            current.passphraseEncrypted = previous.passphraseEncrypted;
            current.storedPassphrase = previous.storedPassphrase;
            profileSyncRuntime.passphraseSession = previous.passphraseSession;
            profileSyncRuntime.passphraseWarning = previous.passphraseWarning;
            await abandonProfileSyncEncryptionChange();
            emitProfileSyncStatus();
            return {
              success: false,
              error: error?.profileSyncRefusal
                ? mainTError(error)
                : mainT('Cannot change profile encryption safely: {{error}}', {
                    error: mainTError(error),
                  }),
              status: buildProfileSyncStatus(),
              config: rendererConfig(),
            };
          }
          clearProfileSyncTimers();
          if (localEncryptionCommitPersisted) {
            setupProfileSyncInterval();
          }
          updateProfileSyncStatus('error', mainTError(error));
          emitProfileSyncStatus();
          return {
            success: false,
            error: mainT('Cannot change profile encryption safely: {{error}}', {
              error: mainTError(error),
            }),
            status: buildProfileSyncStatus(),
            config: rendererConfig(),
          };
        }
      }

      let candidateUnlocksRemote = !remoteResult.exists || !remoteResult.envelope;
      if (remoteResult.exists && remoteResult.envelope) {
        try {
          await decodeRemoteSectionsWithPassphrase(
            remoteResult,
            candidatePassphrase || activePassphrase
          );
          candidateUnlocksRemote = true;
        } catch {
          candidateUnlocksRemote = false;
        }
      }

      const passphraseSubmission = classifyProfileSyncPassphraseSubmission({
        remoteExists: !!remoteResult.exists && !!remoteResult.envelope,
        remoteEncrypted: remoteResult.envelope?.payload?.encrypted === true,
        candidateUnlocksRemote,
        activePassphrase,
        candidatePassphrase,
      });

      if (passphraseSubmission === 'rekey') {
        try {
          // Prove the current key still owns the exact remote state before
          // staging a crash-recoverable exact replacement.
          await stageProfileSyncRewrite({
            oldPassphrase: activePassphrase,
            newPassphrase: candidatePassphrase,
            rememberNewPassphrase: !!remember,
            targetEncryptionEnabled: true,
            changeCredential: true,
            baselineConfig: configStore.get(),
            targetConfig: configStore.get(),
            reason: 'passphrase_rekey',
            remoteResult,
          });
          const result = await executePendingProfileSyncRewrite();
          emitProfileSyncStatus();
          return {
            success: true,
            ...result,
            status: buildProfileSyncStatus(),
            config: rendererConfig(),
          };
        } catch (error) {
          clearProfileSyncTimers();
          updateProfileSyncStatus('error', mainTError(error));
          emitProfileSyncStatus();
          return {
            success: false,
            error: mainT('Cannot change the sync passphrase safely: {{error}}', {
              error: mainTError(error),
            }),
            status: buildProfileSyncStatus(),
            config: rendererConfig(),
          };
        }
      }

      if (passphraseSubmission === 'reject') {
        // This device cannot read the file with what it holds, so say so in the
        // status too: the toast is gone once Settings closes.
        const message = mainT(
          'That passphrase does not unlock the sync file. Enter the passphrase your other computers use.'
        );
        updateProfileSyncStatus('error', message);
        emitProfileSyncStatus();
        return { success: false, error: message, status: buildProfileSyncStatus() };
      }

      // The submitted candidate already decrypts the remote (including the
      // remember=false restart case), matches the active key, or initializes a
      // missing remote. This is unlock/remember-only, not a rewrite.
      const previous = {
        rememberPassphrase: profileSync.rememberPassphrase,
        passphraseEncrypted: profileSync.passphraseEncrypted,
        storedPassphrase: profileSync.storedPassphrase,
        passphraseSession: profileSyncRuntime.passphraseSession,
        passphraseWarning: profileSyncRuntime.passphraseWarning,
      };
      const persisted = persistRememberedProfileSyncPassphrase(
        candidatePassphrase || activePassphrase,
        !!remember
      );
      const persistence = await configStore.apply(null, { origin: 'local' });
      if (!persistence.success) {
        profileSync.rememberPassphrase = previous.rememberPassphrase;
        profileSync.passphraseEncrypted = previous.passphraseEncrypted;
        profileSync.storedPassphrase = previous.storedPassphrase;
        profileSyncRuntime.passphraseSession = previous.passphraseSession;
        profileSyncRuntime.passphraseWarning = previous.passphraseWarning;
        emitProfileSyncStatus();
        return {
          success: false,
          error: mainT('Failed to save sync passphrase: {{error}}', { error: persistence.error }),
          status: buildProfileSyncStatus(),
        };
      }
      let resolutionWarning = '';
      try {
        if (profileSync.enabled && profileSync.firstEnableResolutionPending) {
          const resolution = await prepareProfileSyncFirstEnableResolution();
          if (!resolution?.needsResolution) {
            await completeProfileSyncFirstEnablePreparation('passphrase_first_enable');
          } else {
            clearProfileSyncTimers();
          }
        } else {
          setupProfileSyncInterval();
        }
      } catch (error) {
        clearProfileSyncTimers();
        resolutionWarning = mainTError(error);
        updateProfileSyncStatus('error', resolutionWarning);
      }
      emitProfileSyncStatus();
      return {
        success: true,
        ...persisted,
        warning: resolutionWarning,
        status: buildProfileSyncStatus(),
        config: rendererConfig(),
      };
    } catch (error) {
      return refuse(mainTError(error));
    }
  }

  async function clearProfileSyncPassphrase() {
    const profileSync = getProfileSyncConfig();
    if (hasProfileSyncCredentialTransitionPending(profileSync)) {
      return {
        success: false,
        error: mainT(
          'The passphrase cannot be cleared until the pending encryption change or remote rewrite succeeds'
        ),
        status: buildProfileSyncStatus(),
      };
    }
    const previous = {
      rememberPassphrase: profileSync.rememberPassphrase,
      passphraseEncrypted: profileSync.passphraseEncrypted,
      storedPassphrase: profileSync.storedPassphrase,
      passphraseSession: profileSyncRuntime.passphraseSession,
      passphraseWarning: profileSyncRuntime.passphraseWarning,
    };
    profileSyncRuntime.passphraseSession = '';
    profileSync.rememberPassphrase = false;
    profileSync.passphraseEncrypted = false;
    profileSync.storedPassphrase = '';
    profileSyncRuntime.passphraseWarning = '';
    const persistence = await configStore.apply(null, { origin: 'local' });
    if (!persistence.success) {
      profileSync.rememberPassphrase = previous.rememberPassphrase;
      profileSync.passphraseEncrypted = previous.passphraseEncrypted;
      profileSync.storedPassphrase = previous.storedPassphrase;
      profileSyncRuntime.passphraseSession = previous.passphraseSession;
      profileSyncRuntime.passphraseWarning = previous.passphraseWarning;
      emitProfileSyncStatus();
      return {
        success: false,
        error: mainT('Failed to clear sync passphrase: {{error}}', { error: persistence.error }),
        status: buildProfileSyncStatus(),
      };
    }
    emitProfileSyncStatus();
    return { success: true, status: buildProfileSyncStatus() };
  }

  async function resolveProfileSyncFirstEnable(choice) {
    if (!PROFILE_SYNC_RESOLUTION_CHOICES.has(choice)) {
      return {
        success: false,
        error: 'Invalid resolution choice',
        status: buildProfileSyncStatus(),
      };
    }
    const activeProfileSync = getProfileSyncConfig();
    if (
      activeProfileSync.passphraseTransition ||
      typeof activeProfileSync.encryptionChangePending === 'boolean'
    ) {
      return {
        success: false,
        error: mainT(
          'Finish the pending encryption or key recovery before resolving this conflict'
        ),
        status: buildProfileSyncStatus(),
      };
    }

    const previousResolutionState = {
      needsResolution: profileSyncRuntime.needsResolution,
      pendingRemoteEnvelope: profileSyncRuntime.pendingRemoteEnvelope,
      pendingRemoteIdentity: profileSyncRuntime.pendingRemoteIdentity,
      firstEnableResolutionPending: getProfileSyncConfig().firstEnableResolutionPending,
    };

    try {
      if (
        choice !== 'cancel' &&
        !profileSyncRuntime.needsResolution &&
        getProfileSyncConfig().firstEnableResolutionPending
      ) {
        const resolution = await prepareProfileSyncFirstEnableResolution();
        if (!resolution?.needsResolution) {
          const result = await completeProfileSyncFirstEnablePreparation(
            'first_enable_resolution_retry'
          );
          return {
            success: true,
            ...result,
            status: buildProfileSyncStatus(),
            config: rendererConfig(),
          };
        }
        return {
          success: false,
          error: mainT('A remote profile conflict was found. Review it and choose again.'),
          status: buildProfileSyncStatus(),
          config: rendererConfig(),
        };
      }
      if (!profileSyncRuntime.needsResolution && choice !== 'cancel') {
        return { success: true, status: buildProfileSyncStatus() };
      }

      if (choice === 'cancel') {
        const profileSync = getProfileSyncConfig();
        const previousEnabled = profileSync.enabled;
        const previousNeedsResolution = profileSyncRuntime.needsResolution;
        const previousPendingRemoteEnvelope = profileSyncRuntime.pendingRemoteEnvelope;
        const previousPendingRemoteIdentity = profileSyncRuntime.pendingRemoteIdentity;
        const previousFirstEnableResolutionPending = profileSync.firstEnableResolutionPending;
        const previousRemoteRewritePending = profileSync.remoteRewritePending;
        profileSync.enabled = false;
        profileSync.firstEnableResolutionPending = false;
        profileSync.remoteRewritePending = false;
        profileSyncRuntime.needsResolution = false;
        profileSyncRuntime.pendingRemoteEnvelope = null;
        profileSyncRuntime.pendingRemoteIdentity = null;
        clearProfileSyncTimers();
        const persistence = await configStore.apply(null, { origin: 'local' });
        if (!persistence.success) {
          profileSync.enabled = previousEnabled;
          profileSync.firstEnableResolutionPending = previousFirstEnableResolutionPending;
          profileSync.remoteRewritePending = previousRemoteRewritePending;
          profileSyncRuntime.needsResolution = previousNeedsResolution;
          profileSyncRuntime.pendingRemoteEnvelope = previousPendingRemoteEnvelope;
          profileSyncRuntime.pendingRemoteIdentity = previousPendingRemoteIdentity;
          setupProfileSyncInterval();
          emitProfileSyncStatus();
          return {
            success: false,
            error: mainT('Failed to save profile sync cancellation: {{error}}', {
              error: persistence.error,
            }),
            status: buildProfileSyncStatus(),
            config: rendererConfig(),
          };
        }
        emitProfileSyncStatus();
        return {
          success: true,
          status: buildProfileSyncStatus(),
          config: rendererConfig(),
        };
      }

      // The choice covers only the sections the prompt named; sections this
      // computer already shares a history with keep merging normally. An empty
      // list (the file changed and no longer conflicts) forces nothing.
      const chosenSections = [...profileSyncRuntime.conflictSections];
      const damagedSections = [...profileSyncRuntime.damagedConflictSections];
      if (choice === 'upload_local' && damagedSections.length > 0) {
        // Repair the damaged sections only; valid conflicts are then offered again
        // with both choices instead of being overwritten along with them.
        const remoteResult = await verifyPendingRemoteEnvelopeUnchanged();
        const repair = await runProfileSyncInternal('push', 'first_enable_resolution', {
          expectedRemoteIdentity: getSyncEnvelopeIdentity(remoteResult),
          forceSections: damagedSections,
          onlySections: damagedSections,
        });
        if (repair?.ok !== true || repair?.reason === 'remote_changed') {
          throw new Error(
            repair?.reason === 'remote_changed'
              ? mainT('The remote profile changed during upload; review the conflict and try again')
              : repair?.error || repair?.reason || mainT('Profile upload did not complete')
          );
        }
        const next = await prepareProfileSyncFirstEnableResolution();
        const result = next?.needsResolution
          ? repair
          : await completeProfileSyncFirstEnablePreparation('first_enable_resolution_retry');
        return {
          success: true,
          ...result,
          status: buildProfileSyncStatus(),
          config: rendererConfig(),
        };
      }
      if (choice === 'upload_local') {
        const remoteResult = await verifyPendingRemoteEnvelopeUnchanged();
        const result = await runProfileSyncInternal('push', 'first_enable_resolution', {
          expectedRemoteIdentity: getSyncEnvelopeIdentity(remoteResult),
          forceSections: chosenSections,
        });
        if (result?.ok !== true || result?.reason === 'remote_changed') {
          throw new Error(
            result?.reason === 'remote_changed'
              ? mainT('The remote profile changed during upload; review the conflict and try again')
              : result?.error || result?.reason || mainT('Profile upload did not complete')
          );
        }
        await clearProfileSyncFirstEnableResolutionPending();
        profileSyncRuntime.needsResolution = false;
        profileSyncRuntime.pendingRemoteEnvelope = null;
        profileSyncRuntime.pendingRemoteIdentity = null;
        setupProfileSyncInterval();
        return {
          success: true,
          ...result,
          status: buildProfileSyncStatus(),
          config: rendererConfig(),
        };
      }

      if (choice === 'use_remote') {
        const remoteResult = await verifyPendingRemoteEnvelopeUnchanged();
        if (!remoteResult.envelope) {
          throw new Error(mainT('Remote profile is no longer available'));
        }
        profileSyncRuntime.needsResolution = false;
        profileSyncRuntime.pendingRemoteEnvelope = null;
        profileSyncRuntime.pendingRemoteIdentity = null;
        // A forced pull of the exact file the user reviewed. When an encryption
        // change is pending, the same run rewrites the file in the new mode.
        const result = await runProfileSyncInternal('pull', 'first_enable_resolution', {
          expectedRemoteIdentity: getSyncEnvelopeIdentity(remoteResult),
          forceSections: chosenSections,
        });
        if (result?.ok !== true || result?.reason === 'remote_changed') {
          throw new Error(
            result?.reason === 'remote_changed'
              ? mainT(
                  'The remote profile changed before encryption could be applied; review it again'
                )
              : result?.error || mainT('The accepted remote profile could not be rewritten safely')
          );
        }
        await clearProfileSyncFirstEnableResolutionPending();
        setupProfileSyncInterval();
        emitProfileSyncStatus();
        return {
          success: true,
          status: buildProfileSyncStatus(),
          config: rendererConfig(),
        };
      }
    } catch (error) {
      if (!error?.remoteConflictRefreshed) {
        profileSyncRuntime.needsResolution = previousResolutionState.needsResolution;
        profileSyncRuntime.pendingRemoteEnvelope = previousResolutionState.pendingRemoteEnvelope;
        profileSyncRuntime.pendingRemoteIdentity = previousResolutionState.pendingRemoteIdentity;
        getProfileSyncConfig().firstEnableResolutionPending =
          previousResolutionState.firstEnableResolutionPending;
      }
      updateProfileSyncStatus('error', mainTError(error));
      emitProfileSyncStatus();
      return { success: false, error: mainTError(error), status: buildProfileSyncStatus() };
    }
  }

  function emitProfileSyncStatus(extra = {}) {
    sendStatus(() => buildProfileSyncStatus(extra));
  }

  /**
   * The sync half of a Settings save (update-config): takes the sync form out of the renderer's
   * config and decides what may change. The renderer's copy may be stale and holds none of the
   * credentials, so everything main owns is kept, and a new folder is only taken from the
   * folder dialog. Returns `{ error }` when the save must be refused, or the settings to store
   * with what update-config calls as it writes them.
   */
  function receiveSettings(newConfig) {
    const config = configStore.get();
    const previousRuntimeTracking = {
      localProfileHash: profileSyncRuntime.localProfileHash,
      localProfileUpdatedAt: profileSyncRuntime.localProfileUpdatedAt,
      pendingPullEchoHash: profileSyncRuntime.pendingPullEchoHash,
      localSectionHashes: profileSyncRuntime.localSectionHashes,
    };
    const prevSyncEnabled = !!config?.profileSync?.enabled;
    // Settings lists the synced settings the user changed, for the stale-echo
    // guard below. It is never stored.
    const touchedSyncKeys = Array.isArray(newConfig.profileSyncTouchedKeys)
      ? newConfig.profileSyncTouchedKeys
          .filter((key) => typeof key === 'string' && /^(ui\.)?[A-Za-z0-9_]{1,64}$/.test(key))
          .slice(0, 100)
      : [];
    delete newConfig.profileSyncTouchedKeys;
    // The config revision the renderer built this update from (added by preload).
    const baseRevision = Number.isInteger(newConfig.configBaseRevision)
      ? newConfig.configBaseRevision
      : null;
    delete newConfig.configBaseRevision;
    const previousFirstEnableResolutionPending =
      config.profileSync?.firstEnableResolutionPending === true;
    const previousRemoteRewritePending = config.profileSync?.remoteRewritePending === true;
    const previousEncryptionEnabled = config.profileSync?.encryptionEnabled === true;
    const previousProvider = normalizeProfileSyncProvider(config.profileSync?.provider);
    const previousCloudFilePath = config.profileSync?.cloudFilePath || '';
    const previousSyncScope = getNormalizedProfileSyncScopeValue(config.profileSync?.syncScope);
    const previousPassphraseMetadata = {
      rememberPassphrase: config.profileSync?.rememberPassphrase === true,
      passphraseEncrypted: config.profileSync?.passphraseEncrypted === true,
      storedPassphrase: config.profileSync?.storedPassphrase || '',
      passphraseTransition: config.profileSync?.passphraseTransition || null,
      encryptionChangePending:
        typeof config.profileSync?.encryptionChangePending === 'boolean'
          ? config.profileSync.encryptionChangePending
          : null,
    };
    const profileSync = { ...(config.profileSync || {}), ...(newConfig.profileSync || {}) };
    const requestedEncryptionEnabled = profileSync.encryptionEnabled === true;
    // Credential metadata and rewrite recovery are main-owned. The settings
    // renderer sends a sanitized snapshot before the dedicated passphrase IPC;
    // accepting those fields here creates a crash window that can discard or
    // mislabel the only working credential.
    Object.assign(profileSync, previousPassphraseMetadata);
    profileSync.encryptionEnabled = previousEncryptionEnabled;
    const normalizedNextProvider = normalizeProfileSyncProvider(profileSync.provider);
    // Settings shows no folder until one is chosen (see getRendererSyncFilePath).
    const normalizedNextPath =
      (typeof profileSync.cloudFilePath === 'string' ? profileSync.cloudFilePath.trim() : '') ||
      getDefaultProfileSyncFilePath();
    const normalizedNextScope = getNormalizedProfileSyncScopeValue(profileSync.syncScope);
    const pathChanged =
      syncTargetFor(normalizedNextProvider).usesFilePath &&
      normalizedNextPath !== previousCloudFilePath;
    // The sync engine reads this path and renames a temp file over it, so a new
    // one is only taken from a folder the user picked in the native dialog (or
    // one already in use), never as free text from the renderer.
    if (
      normalizedNextPath !== previousCloudFilePath &&
      !isApprovedProfileSyncFilePath(normalizedNextPath, previousCloudFilePath)
    ) {
      log.warn('Rejected a profile sync file path that was not chosen through the folder dialog');
      return { error: mainT('Choose a sync folder before enabling profile sync.') };
    }
    const remoteTargetChanged =
      prevSyncEnabled &&
      profileSync.enabled &&
      (normalizedNextProvider !== previousProvider ||
        pathChanged ||
        JSON.stringify(normalizedNextScope) !== JSON.stringify(previousSyncScope));
    if (
      previousPassphraseMetadata.passphraseTransition &&
      (profileSync.enabled !== prevSyncEnabled ||
        remoteTargetChanged ||
        requestedEncryptionEnabled !== previousEncryptionEnabled)
    ) {
      return {
        error: mainT(
          'Finish the pending sync-key recovery before changing the sync target or encryption setting'
        ),
      };
    }
    const requiresInitialPreparation =
      !!profileSync.enabled && (!prevSyncEnabled || remoteTargetChanged);
    // Merge state is main-process-owned and describes the file it was built
    // against: a new file or a fresh enable starts with no shared history, and a
    // narrower scope forgets sections this device no longer syncs.
    const syncFileChanged =
      !prevSyncEnabled || normalizedNextProvider !== previousProvider || pathChanged;
    const nextScopeKeys = new Set(profileSyncCore.getScopeSectionKeys(normalizedNextScope));
    // What was last read from the old file says nothing about the new one.
    if (syncFileChanged || !profileSync.enabled) profileSyncRuntime.remoteEncrypted = null;
    profileSync.syncBaseline = syncFileChanged
      ? {}
      : Object.fromEntries(
          Object.entries(config.profileSync?.syncBaseline || {}).filter(([key]) =>
            nextScopeKeys.has(key)
          )
        );
    profileSync.syncBaselineUpdatedAt = syncFileChanged
      ? {}
      : Object.fromEntries(
          Object.entries(config.profileSync?.syncBaselineUpdatedAt || {}).filter(([key]) =>
            nextScopeKeys.has(key)
          )
        );
    profileSync.sectionUpdatedAt = { ...(config.profileSync?.sectionUpdatedAt || {}) };
    keepMainOwnedProfileSyncResults(profileSync, config.profileSync);
    if (requiresInitialPreparation) {
      profileSync.firstEnableResolutionPending = true;
    } else if (!profileSync.enabled) {
      profileSync.firstEnableResolutionPending = false;
    } else {
      // This safety marker is main-process-authoritative. Renderer snapshots can
      // arrive after a passphrase/conflict operation and must not resurrect or
      // clear a first-enable gate with stale state.
      profileSync.firstEnableResolutionPending = previousFirstEnableResolutionPending;
    }
    const encryptionRequest = resolveProfileSyncEncryptionRequest({
      syncEnabled: !!profileSync.enabled,
      wasSyncEnabled: prevSyncEnabled,
      currentEncryptionEnabled: previousEncryptionEnabled,
      requestedEncryptionEnabled,
      existingPendingTarget: previousPassphraseMetadata.encryptionChangePending,
    });
    profileSync.encryptionEnabled = encryptionRequest.encryptionEnabled;
    profileSync.encryptionChangePending = encryptionRequest.pendingTarget;
    if (!profileSync.enabled) {
      profileSync.remoteRewritePending = false;
      profileSync.passphraseTransition = null;
    } else if (!prevSyncEnabled) {
      // The durable first-enable gate blocks every sync direction until the
      // passphrase/conflict flow completes, so the requested mode can be
      // recorded immediately without exposing the old-mode remote.
      profileSync.remoteRewritePending =
        requestedEncryptionEnabled !== previousEncryptionEnabled || previousRemoteRewritePending;
    } else {
      profileSync.remoteRewritePending = previousRemoteRewritePending;
      if (requestedEncryptionEnabled !== previousEncryptionEnabled) {
        profileSync.encryptionChangePending = requestedEncryptionEnabled;
      }
    }
    return {
      profileSync,
      requiresInitialPreparation,
      /**
       * Called once the save is merged into the config (`current`), with the config as it
       * stood before (`previous`): undoes a stale echo of a pull, and keeps the edit time, which
       * the write's own tracking advances on a real change.
       */
      merged(current, previous) {
        restoreProfileFromStalePullEcho(previous, touchedSyncKeys, baseRevision);
        // The renderer's echo of profileSync may be stale; the content-change
        // timestamp is main-process-authoritative (the store's sync tracking advances it on
        // real profile changes).
        current.profileSync.profileUpdatedAt = previous?.profileSync?.profileUpdatedAt ?? null;
      },
      /** Called when the save could not be written. */
      notSaved() {
        Object.assign(profileSyncRuntime, previousRuntimeTracking);
      },
    };
  }

  // Sync dirty-tracking: each write records whether the synced profile changed and stamps its edit
  // time into the snapshot. A change waiting on its write pushes only once it is on disk
  // (pushAfterWrite); a save that only writes pushes straight away.
  const syncedProfileChangedBy = new WeakMap();

  /**
   * The config store's before-write hook. `pushes` says whether this kind of change is one to
   * sync (a pull is not). Returns the undo for a write that fails.
   */
  function trackConfigWrite(change, { pushes }) {
    const previousTracking = {
      localProfileHash: profileSyncRuntime.localProfileHash,
      localProfileUpdatedAt: profileSyncRuntime.localProfileUpdatedAt,
      pendingPullEchoHash: profileSyncRuntime.pendingPullEchoHash,
      localSectionHashes: profileSyncRuntime.localSectionHashes,
    };
    updateLocalProfileSyncTracking({
      allowDebouncedPush: change.background === true && pushes,
    });
    syncedProfileChangedBy.set(
      change,
      profileSyncRuntime.localProfileHash !== previousTracking.localProfileHash
    );
    return () => Object.assign(profileSyncRuntime, previousTracking);
  }

  /** Queues a push once a change that altered the synced profile is on disk. */
  function pushAfterWrite(change) {
    if (syncedProfileChangedBy.get(change)) scheduleDebouncedProfileSyncPush('config_change');
  }

  // Set while a remembered passphrase waits for the OS keyring, which may not be unlocked yet when
  // the config is read at startup.
  let passphraseDecryptDeferred = false;

  /**
   * Takes up a config just read from disk. With `deferPassphrase`, a remembered passphrase is
   * left sealed until unlockDeferredPassphrase.
   */
  function configLoaded({ deferPassphrase = false } = {}) {
    const config = configStore.get();
    passphraseDecryptDeferred = !!(
      deferPassphrase &&
      config?.profileSync?.rememberPassphrase &&
      config?.profileSync?.storedPassphrase &&
      config?.profileSync?.passphraseEncrypted
    );
    if (passphraseDecryptDeferred) {
      profileSyncRuntime.passphraseSession = '';
      profileSyncRuntime.passphraseWarning = '';
      refreshProfileSyncRuntimeTracking({ decodePassphrase: false });
    } else {
      refreshProfileSyncRuntimeTracking();
    }
  }

  /** Unseals a passphrase configLoaded deferred. Returns whether there was one. */
  function unlockDeferredPassphrase() {
    let changed = false;
    if (passphraseDecryptDeferred) {
      passphraseDecryptDeferred = false;
      profileSyncRuntime.passphraseSession = decodeStoredProfileSyncPassphrase() || '';
      changed = true;
    }
    refreshProfileSyncRuntimeTracking({ decodePassphrase: false });
    return changed;
  }

  /** The renderer's copy of the sync settings, without the secrets and merge state main keeps. */
  function redactForRenderer(profileSync) {
    delete profileSync.storedPassphrase;
    delete profileSync.passphraseTransition;
    delete profileSync.syncBaseline;
    delete profileSync.syncBaselineUpdatedAt;
    delete profileSync.sectionUpdatedAt;
    profileSync.cloudFilePath = getRendererSyncFilePath(profileSync.cloudFilePath);
    return profileSync;
  }

  return {
    // Running
    start: initializeProfileSyncOnStartup,
    pause: clearProfileSyncTimers,
    resume: setupProfileSyncInterval,
    sync: runProfileSync,
    syncNow: runProfileSyncFromSettings,
    requestSync: requestOpportunisticProfileSync,
    status: buildProfileSyncStatus,
    emitStatus: emitProfileSyncStatus,
    // The config
    defaultSettings: getDefaultProfileSyncConfig,
    normalizeSettings: ensureProfileSyncConfigDefaults,
    configLoaded,
    hasDeferredPassphrase: () => passphraseDecryptDeferred,
    unlockDeferredPassphrase,
    redactForRenderer,
    // Config changes
    receiveSettings,
    trackConfigWrite,
    pushAfterWrite,
    applySettingsChange: applyProfileSyncSettingsChange,
    importSections: (sections) => applyLocalProfileSections(sections, { clearNullUiKeys: true }),
    // Settings
    chooseFolder: chooseProfileSyncFolder,
    copySyncFile: copyProfileSyncFile,
    setPassphrase: setProfileSyncPassphrase,
    clearPassphrase: clearProfileSyncPassphrase,
    resolveFirstEnable: resolveProfileSyncFirstEnable,
    listBackups: listProfileSyncBackupsForSettings,
    restoreBackup: restoreProfileSyncBackupForSettings,
    // Cloud Sync's account
    cloudAccount: getCloudSyncAccount,
    cloudSignIn: signInToCloudSync,
    cloudSignOut: signOutOfCloudSync,
    cloudOpenBilling: openCloudSyncBilling,
    cloudDeleteAccount: deleteCloudSyncAccount,
  };
}

module.exports = {
  appendPendingPull,
  createProfileSyncEngine,
  ensureEntityAlertsConfigDefaults,
  isSameCloudSyncAccount,
  describeKnownProfileSyncFailure,
  isSecureProfileSyncStorageAvailable,
};

const {
  app,
  BrowserWindow,
  ipcMain,
  Menu,
  Tray,
  screen: electronScreen,
  shell,
  protocol,
  globalShortcut,
  nativeImage,
  safeStorage,
  net,
  dialog,
  powerMonitor,
  session,
} = require('electron');
const path = require('path');
const fs = require('fs');
const nodeCrypto = require('crypto');
const { pathToFileURL, fileURLToPath } = require('url');

// The BUNDLED preload (see vite.preload.config.js), not the unbundled preload.js. Preload scripts
// are sandboxed, and a sandboxed preload cannot require a file from disk — so loading preload.js
// directly leaves the renderer with no window.electronAPI at all.
const PRELOAD_SCRIPT_PATH = path.join(__dirname, 'dist-preload', 'preload.cjs');
const log = require('electron-log');
const axios = require('axios');
const pkg = require('./package.json');
const profileSyncCore = require('./profile-sync-core.js');
const { createLocalizationService } = require('./src/i18n-main.cjs');
const {
  normalizeEntityId,
  getDesktopPinBaseBounds,
  getDesktopPinDomain,
  normalizeDesktopPinContentMinBounds,
  clampDesktopPinBounds: clampDesktopPinBoundsWithWorkArea,
} = require('./src/desktop-pin-bounds.js');
const {
  resolveDesktopPinProfile,
  sanitizeDesktopPinSupportInfo,
} = require('./src/desktop-pin-support.cjs');
const {
  createDesktopPinConnectionState,
  createDesktopPinRendererConfig,
  normalizeDesktopPinActionRequest,
} = require('./src/desktop-pin-ipc.cjs');
const {
  getWindowsStartupRegistryName,
  isWindowsLoginItemEnabled,
  quoteWindowsExecutablePath,
} = require('./src/windows-startup.cjs');
const {
  getLinuxStartupExecutablePath,
  isLinuxLoginItemEnabled,
  setLinuxLoginItemSettings,
} = require('./src/linux-startup.cjs');
const {
  isAllowedHlsProxyPath,
  isPathInsideDirectory,
  normalizeEntityIdForObjectKey,
  validateProfileSyncCopyPaths,
} = require('./src/main-security.cjs');
const {
  createElectronNetBinaryFetcher,
  createPinnedDnsBinaryFetcher,
  createHaProtocolHandler,
} = require('./src/ha-protocol.cjs');
const {
  NATIVE_WAYLAND_ENV_OVERRIDE,
  getAppIconPath,
  getMainWindowVisualOptions,
  shouldForceX11OzonePlatform,
  shouldUseCompositorOwnedPlacement,
  shouldUseTransparentWindow,
  supportsAutoUpdater,
} = require('./src/platform.cjs');
const { clampPositionToWorkAreas } = require('./src/window-placement.cjs');
const { configureMainLogging } = require('./src/main-logging.cjs');
const { attachEditHandlers, installApplicationMenu } = require('./src/application-menu.cjs');
const {
  createLinuxPopupHotkeyController,
  isLinuxPopupHotkeyPlatform,
} = require('./src/linux-popup-hotkey.cjs');
const { createPopupWindowPresenter } = require('./src/popup-window-presenter.cjs');
const { installSessionPermissionPolicy } = require('./src/session-permissions.cjs');
const {
  createSerializedTaskRunner,
  createLatestTaskCoalescer,
} = require('./src/serialized-task-runner.cjs');
const { shouldBlockConfigWrite } = require('./src/config-write-guard.cjs');
const { requireExistingSyncParentDirectory } = require('./src/cloud-sync-path.cjs');
const {
  createProfileSyncRewriteTransaction,
  normalizeProfileSyncRewriteTransaction,
  profileSyncRewriteEndpointMatches,
  isSecureProfileSyncStorageAvailable,
  classifyProfileSyncPassphraseSubmission,
  resolveProfileSyncEncryptionRequest,
  stageProfileSyncRewriteTransaction,
  runProfileSyncRewriteRecovery,
} = require('./src/profile-sync-rewrite-transaction.cjs');
const {
  canCommitSnapshot,
  createVersionedWriteAcknowledgements,
} = require('./src/versioned-write-acknowledgements.cjs');
const {
  SMOKE_TEST_PROFILE_PREFIX,
  removeSmokeTestProfile,
} = require('./src/smoke-test-profile.cjs');
const {
  HomeAssistantOAuthClient,
  normalizeHomeAssistantBaseUrl,
  requestFormWithElectronNet,
} = require('./src/ha-oauth.cjs');
const {
  PORTAL_SHORTCUTS_BACKEND,
  createPortalGlobalShortcutsController,
  isWaylandSession,
} = require('./src/portal-global-shortcuts.cjs');

configureMainLogging(log, { isPackaged: app.isPackaged });

let autoUpdaterInstance = null;

function getAutoUpdater() {
  if (!autoUpdaterInstance) {
    ({ autoUpdater: autoUpdaterInstance } = require('electron-updater'));
  }
  return autoUpdaterInstance;
}

const DESKTOP_PIN_WINDOW_CORNER_RADIUS = 24;
const LOCALE_PACK_MANIFEST_URL =
  'https://raw.githubusercontent.com/Robertg761/HA-Desktop-Widget/main/locale-packs/manifest.json';
const DESKTOP_PIN_ACTION_RESPONSE_TIMEOUT_MS = 30000;
const EXTERNAL_LINK_PROTOCOLS = new Set(['http:', 'https:']);

function getLocalePackManifestSource() {
  if (!app.isPackaged) {
    return pathToFileURL(path.join(__dirname, 'locale-packs', 'manifest.json')).toString();
  }
  return LOCALE_PACK_MANIFEST_URL;
}

function isHttpOrHttpsUrl(rawUrl) {
  try {
    const parsed = new URL(rawUrl);
    return EXTERNAL_LINK_PROTOCOLS.has(parsed.protocol);
  } catch {
    return false;
  }
}

function routeExternalHttpLink(rawUrl) {
  if (!isHttpOrHttpsUrl(rawUrl)) return false;

  try {
    const parsed = new URL(rawUrl);
    shell.openExternal(parsed.toString()).catch((error) => {
      log.warn('Failed to open external link:', error?.message || error);
    });
    return true;
  } catch (error) {
    log.warn('Failed to route external link:', error?.message || error);
    return false;
  }
}

function isAllowedRendererNavigation(rawUrl) {
  try {
    const parsed = new URL(rawUrl);
    if (parsed.protocol !== 'file:') return false;

    const targetPath = path.resolve(fileURLToPath(parsed));
    const indexPath = path.resolve(path.join(__dirname, 'index.html'));
    return targetPath === indexPath;
  } catch {
    return false;
  }
}

function hardenRendererNavigation(targetWindow) {
  const webContents = targetWindow?.webContents;
  if (!webContents) return;

  if (typeof webContents.setWindowOpenHandler === 'function') {
    webContents.setWindowOpenHandler(({ url }) => {
      routeExternalHttpLink(url);
      return { action: 'deny' };
    });
  }

  webContents.on('will-navigate', (event, url) => {
    if (isAllowedRendererNavigation(url)) return;

    if (event && typeof event.preventDefault === 'function') {
      event.preventDefault();
    }
    routeExternalHttpLink(url);
  });

  // Web Bluetooth bypasses the ordinary session permission request handler and has
  // its own chooser event. The widget has no Bluetooth feature, so cancel it.
  webContents.on('select-bluetooth-device', (event, _devices, callback) => {
    event?.preventDefault?.();
    callback('');
  });
}

// Renderer warnings never reached the log file, so camera, stream and websocket failures were
// invisible in user-supplied logs — the main process only ever saw its own side of the problem.
// Warnings and errors only, to keep the log readable.
function forwardRendererConsole(webContents, label = 'renderer') {
  if (!webContents || typeof webContents.on !== 'function') return;

  webContents.on('console-message', (...args) => {
    // Electron 37 replaced the (event, level, message) signature with a single details object.
    const usesDetailsObject = args[0] && typeof args[0] === 'object' && 'level' in args[0];
    const level = String((usesDetailsObject ? args[0].level : args[1]) ?? '').toLowerCase();
    const message = String((usesDetailsObject ? args[0].message : args[2]) ?? '').trim();
    if (!message) return;

    if (level === 'error' || level === '3') {
      log.error(`[${label}] ${message}`);
    } else if (level === 'warning' || level === 'warn' || level === '2') {
      log.warn(`[${label}] ${message}`);
    }
  });
}

const usesLinuxPopupHotkeyBackend = isLinuxPopupHotkeyPlatform(process.platform);
if (usesLinuxPopupHotkeyBackend) {
  app.commandLine.appendSwitch('enable-features', 'GlobalShortcutsPortal');
}

// Used to tell a GPU process that never started from one that died later in the session.
const processStartedAt = Date.now();

// Window managers match rules against this, so it must stay stable across releases and locales.
const MAIN_WINDOW_TITLE = 'HA Desktop Widget';

// Try to load uiohook-napi for platforms that support hold/release detection. Linux uses
// Electron's globalShortcut instead so a native hook failure cannot terminate the main process.
let uIOhook, UiohookKey;
let uiohookAvailable = false;
if (usesLinuxPopupHotkeyBackend) {
  log.info('Using Electron globalShortcut for Linux popup hotkeys');
} else {
  try {
    const module = require('uiohook-napi');
    uIOhook = module.uIOhook;
    UiohookKey = module.UiohookKey;
    uiohookAvailable = true;
    log.info('uiohook-napi loaded successfully');
  } catch (error) {
    log.warn(
      'uiohook-napi is not available on this platform. Popup hotkey feature will be disabled.',
      error.message
    );
  }
}

// Log the app starting up
log.info('App starting...');

const IS_DEV_MODE = process.argv.includes('--dev');
const IS_SMOKE_TEST_MODE = process.argv.includes('--smoke-test');
const IS_CLIMATE_DEMO_MODE =
  IS_DEV_MODE && !app.isPackaged && process.argv.includes('--demo-climate');
const IS_CLIMATE_DEMO_OVERLAY_MODE =
  IS_DEV_MODE &&
  !app.isPackaged &&
  !IS_CLIMATE_DEMO_MODE &&
  process.argv.includes('--demo-climate-overlay');
let smokeTestUserDataPath = '';
let smokeTestTempRootPath = '';

// The demo gets a fresh temporary Electron profile, so it cannot read or write
// a user's Home Assistant token, favorites, pins, or other production settings.
if (IS_CLIMATE_DEMO_MODE) {
  const demoUserDataPath = fs.mkdtempSync(
    path.join(app.getPath('temp'), 'ha-desktop-widget-climate-demo-')
  );
  app.setPath('userData', demoUserDataPath);
  log.info(`Starting isolated development climate demo: ${demoUserDataPath}`);
} else if (IS_SMOKE_TEST_MODE) {
  smokeTestTempRootPath = app.getPath('temp');
  smokeTestUserDataPath = fs.mkdtempSync(
    path.join(smokeTestTempRootPath, SMOKE_TEST_PROFILE_PREFIX)
  );
  app.setPath('userData', smokeTestUserDataPath);
  log.info(`Starting isolated packaged-runtime smoke test: ${smokeTestUserDataPath}`);
}

// Set cache paths before app is ready to avoid access issues
const userDataPath = app.getPath('userData');
app.setPath('userData', userDataPath);
app.setPath('sessionData', path.join(userDataPath, 'session'));

// One widget per user data directory. Without this a second launch raised a second tray icon and
// a second window writing the same config file, so the two instances fought over it and the loser's
// state won whichever happened to save last. The lock lives in the user data directory, and the
// climate demo redirects that above, so an isolated demo still runs alongside the real widget.
const gotSingleInstanceLock = app.requestSingleInstanceLock();
if (!gotSingleInstanceLock) {
  log.info('Another instance already owns this profile; handing the request to it and exiting');
  app.quit();
} else {
  // Launching the widget again is the user asking to see it, the same thing the tray click and the
  // popup hotkey do. This is also the only way back for a window hidden to the tray on a desktop
  // whose tray is missing or broken.
  app.on('second-instance', () => {
    log.info('Second instance launched; showing the existing window');
    showMainWindowFromTray();
  });
}

// A Wayland compositor places windows itself and ignores where the widget asks to be, so a
// hidden-then-shown widget comes back wherever the compositor decides and native window opacity
// does nothing. XWayland restores the X11 behavior the widget is built on; see
// docs/linux-wayland-notes.md for the measurements. Must run before app.whenReady(), and after
// the user data path is settled so the climate demo's throwaway profile stays isolated.
// The marker is written once by the GPU-crash fallback, on a machine where XWayland cannot render.
const XWAYLAND_UNAVAILABLE_MARKER_PATH = path.join(userDataPath, 'xwayland-unavailable');

function hasXWaylandFailureMarker() {
  try {
    return fs.existsSync(XWAYLAND_UNAVAILABLE_MARKER_PATH);
  } catch {
    return false;
  }
}

const waylandSession = isWaylandSession();
const forcedX11Ozone = shouldForceX11OzonePlatform({
  waylandSession,
  previousAttemptFailed: hasXWaylandFailureMarker(),
});
if (forcedX11Ozone) {
  app.commandLine.appendSwitch('ozone-platform', 'x11');
  log.info(
    `Wayland session detected; running through XWayland so the widget keeps its position and opacity (set ${NATIVE_WAYLAND_ENV_OVERRIDE}=1 to use the native Wayland backend)`
  );
}

// The compositor only owns placement when we are really running on Wayland; under XWayland
// the widget can position itself again.
const usesCompositorOwnedPlacement = shouldUseCompositorOwnedPlacement({
  platform: process.platform,
  env: process.env,
  argv: process.argv,
  waylandSession,
  forcedX11Ozone,
});

let mainWindow;
let tray;
let config;
let isQuitting = false;
let autoUpdateDownloaded = false;
let windowStateSaveTimer = null;
let pendingWindowBounds = null;
let quitFinalizationStarted = false;
let quitFinalized = false;
let smokeTestTimeout = null;
let smokeTestFinished = false;
let smokeTestRendererLoaded = false;
let smokeTestRendererReady = false;
let smokeTestTrayReady = false;
const CONFIG_SAVE_DEBOUNCE_MS = 120;
const QUIT_FINALIZATION_TIMEOUT_MS = 15000;
let configWriteTimer = null;
let configWriteInFlight = false;
let pendingConfigSnapshot = null;
let configSnapshotVersion = 0;
let configWriteEpoch = 0;
let configShutdownPending = false;
const configWriteAcknowledgements = createVersionedWriteAcknowledgements();
let lastConfigWriteError = null;
let lastConfigPersistenceWarningSignature = '';
let lastConfigPersistenceWarningAt = 0;
let configRecoveryNotice = null;
let configWriteBlockedReason = '';
let configBackupCreatedThisRun = false;
let preservedEncryptedTokenForRecovery = null;
let configMutationQueueClosed = false;
const runSerializedConfigMutationUnchecked = createSerializedTaskRunner();
const runSerializedConfigMutation = (task) => {
  if (configMutationQueueClosed) {
    return Promise.reject(
      new Error('The application is shutting down; the change was not applied')
    );
  }
  return runSerializedConfigMutationUnchecked(task);
};
const runBackgroundConfigMutation = (task, context = 'background config mutation') => {
  void runSerializedConfigMutation(task).catch((error) => {
    if (configMutationQueueClosed || quitFinalizationStarted) return;
    log.warn(`${context} failed:`, error?.message || String(error));
  });
};
const serializeConfigMutationHandler =
  (handler) =>
  (...args) => {
    if (quitFinalizationStarted || configMutationQueueClosed) {
      return Promise.resolve({
        success: false,
        error: 'The application is shutting down; the change was not applied',
      });
    }
    return runSerializedConfigMutation(() => handler(...args));
  };
const PROFILE_SYNC_PUSH_DEBOUNCE_MS = 2000;
const PROFILE_SYNC_DEFAULT_INTERVAL_MINUTES = 5;
const PROFILE_SYNC_MAX_FILE_BYTES = 512 * 1024;
const PROFILE_SYNC_MIN_PASSPHRASE_LENGTH = 8;
// Floor between syncs triggered by focus or resume, so alt-tabbing does not turn
// into constant reads of a cloud-synced folder.
const PROFILE_SYNC_OPPORTUNISTIC_MIN_GAP_MS = 60 * 1000;
const PROFILE_SYNC_BACKUP_DIR_NAME = 'profile-sync-backups';
const PROFILE_SYNC_BACKUP_KEEP = 5;
const PROFILE_SYNC_MAX_APPROVED_COPY_FOLDERS = 10;
const PROFILE_SYNC_RESOLUTION_CHOICES = new Set(['upload_local', 'use_remote', 'cancel']);
const PROFILE_SYNC_SUPPORTED_PROVIDERS = new Set([
  'cloudFile',
  'googleDrive',
  'dropbox',
  'oneDrive',
  'icloudDrive',
  'syncthing',
]);
// Filenames these providers leave behind when two devices write at once. Their
// presence beside the sync file means a race already happened.
const PROFILE_SYNC_CONFLICT_PATTERNS = [
  /\.sync-conflict-/i, // Syncthing
  /\bconflicted copy\b/i, // Dropbox
  /-[A-Za-z0-9]+'s conflicted copy\b/i, // OneDrive
  /\(\d+\)\.json$/i, // Google Drive / generic duplicate suffix
];
const PROFILE_SYNC_DEFAULT_FILE_NAME = 'ha-widget-profile-sync.json';
const HOME_ASSISTANT_TOKEN_PLACEHOLDER = 'YOUR_LONG_LIVED_ACCESS_TOKEN';
const TOKEN_RESET_RECOVERY_REASONS = new Set(['encryption_unavailable', 'decryption_failed']);
const HOME_ASSISTANT_OAUTH_REFRESH_SKEW_MS = 5 * 60 * 1000;
const HOME_ASSISTANT_OAUTH_RETRY_MS = 60 * 1000;

const profileSyncRuntime = {
  inFlight: false,
  pushDebounceTimer: null,
  intervalTimer: null,
  // Hash of the scoped profile as it stood immediately before a pulled profile
  // was applied. Armed by applySyncedProfileToConfig so the renderer's stale
  // config echo can be recognised by content rather than by timing; see
  // updateLocalProfileSyncTracking.
  pendingPullEchoHash: null,
  // Conflict-copy filenames found beside the sync file on the last run. Refreshed
  // by sync runs because the check needs the filesystem.
  conflictCopies: [],
  lastOpportunisticSyncAt: 0,
  needsResolution: false,
  pendingRemoteEnvelope: null,
  pendingRemoteIdentity: null,
  localProfileHash: null,
  localProfileUpdatedAt: null,
  passphraseSession: '',
  passphraseWarning: '',
  approvedCopyDestinationFolders: [],
};

// Popup hotkey state
let popupHotkeyPressed = false;
let popupHotkeyConfig = null; // Stores { keycode, alt, ctrl, shift, meta }
let popupHotkeyKeydownHandler = null; // Reference to keydown handler for cleanup
let popupHotkeyKeyupHandler = null; // Reference to keyup handler for cleanup
let uIOhookRunning = false; // Track whether uIOhook is currently running
let _popupHotkeyWindowVisible = false; // Toggle mode: track whether window is currently shown via hotkey
let popupHotkeyLastShownTime = null;
const registeredEntityHotkeyAccelerators = new Set();
// Owns the window level, full-screen visibility, and saved position for every path that
// pops the widget up, so a hotkey press lands above full-screen video instead of behind it.
const popupWindowPresenter = createPopupWindowPresenter({
  getConfig: () => config,
  getWorkAreas: () => electronScreen.getAllDisplays().map((display) => display.workArea),
  supportsWindowPositioning: !usesCompositorOwnedPlacement,
  // Linux has press-only global shortcuts, and toggle-mode popups on other platforms
  // likewise have no key-release event. In both cases, blur is the safe point to stop
  // holding Electron's screen-saver window level.
  shouldReleaseElevationOnBlur: () =>
    usesLinuxPopupHotkeyBackend || !!config?.popupHotkeyToggleMode,
  log,
});
const linuxPopupHotkeyController = createLinuxPopupHotkeyController({
  globalShortcut,
  getConfig: () => config,
  getMainWindow: () => mainWindow,
  log,
  presenter: popupWindowPresenter,
});
const desktopPinWindows = new Map();
const desktopPinContentMinBounds = new Map();
const pendingDesktopPinActionRequests = new Map();
let nextDesktopPinActionRequestId = 1;
const latestEntityStates = new Map();
let hasPublishedHaSnapshot = false;
let desktopPinEditMode = false;
const localizationService = createLocalizationService({
  bundledDir: path.join(__dirname, 'locales'),
  getUserDataDir: () => app.getPath('userData'),
  appVersion: pkg.version,
  getDetectedLocale: () => {
    try {
      return app.getLocale() || app.getSystemLocale() || 'en';
    } catch {
      return 'en';
    }
  },
  manifestUrl: getLocalePackManifestSource(),
});
const DEV_RENDERER_BUNDLE_PATH = path.join(__dirname, 'dist-renderer', 'renderer.bundle.js');
const DEV_RELOAD_DEBOUNCE_MS = 220;
const DEV_RELOAD_RETRY_MS = 160;
const DEV_RELOAD_MAX_RETRIES = 20;
const OPAQUE_WINDOW_BACKGROUND_COLOR = '#28282d';
let devReloadTimer = null;
let devReloadWatchersStarted = false;
const devReloadWatchers = [];

function isTrustedAppWebContents(candidate) {
  if (!candidate) return false;
  if (mainWindow && !mainWindow.isDestroyed() && candidate === mainWindow.webContents) {
    return true;
  }

  for (const pinWindow of desktopPinWindows.values()) {
    if (pinWindow && !pinWindow.isDestroyed() && candidate === pinWindow.webContents) {
      return true;
    }
  }
  return false;
}
let postWindowStartupTasksScheduled = false;
let deferredHomeAssistantTokenDecryptPending = false;
let deferredPlaintextTokenMigrationPending = false;
let deferredProfileSyncPassphraseDecryptPending = false;
let deferredSecureConfigResolutionInProgress = false;
let homeAssistantOAuthClient = null;
let homeAssistantOAuthRefreshTimer = null;

function resolveFrostedGlassConfig(currentConfig = config, overrideFrostedGlass) {
  return typeof overrideFrostedGlass === 'boolean'
    ? overrideFrostedGlass
    : !!currentConfig?.frostedGlass;
}

function getWindowTransparencyOptions(currentConfig = config) {
  let transparent = shouldUseTransparentWindow(process.platform, process.env);

  // Windows keeps a transparent window in both glass and non-glass modes so
  // opacity can be applied to background surfaces without fading tiles/controls.
  if (process.platform === 'win32') {
    transparent = true;
  }

  // On Linux, if transparency is not already enabled via env override, but the user
  // has configured an opacity less than 1.0, we must enable transparent window
  // to allow CSS-based transparency to render. Otherwise, the window is opaque
  // and native opacity adjustments are ignored/unsupported by the compositor.
  if (
    process.platform === 'linux' &&
    !transparent &&
    currentConfig &&
    typeof currentConfig.opacity === 'number' &&
    currentConfig.opacity < 1
  ) {
    transparent = true;
  }

  return {
    transparent,
    backgroundColor: transparent ? '#00000000' : OPAQUE_WINDOW_BACKGROUND_COLOR,
  };
}

function shouldUseNativeWindowOpacity(currentConfig = config) {
  const transparencyOptions = getWindowTransparencyOptions(currentConfig);
  return !transparencyOptions.transparent;
}

function applyWindowOpacity(targetWindow, opacity, currentConfig = config) {
  if (!targetWindow || targetWindow.isDestroyed()) return Math.max(0.5, Math.min(1, opacity || 1));
  const safeOpacity = Math.max(0.5, Math.min(1, opacity || 1));
  targetWindow.setOpacity(shouldUseNativeWindowOpacity(currentConfig) ? safeOpacity : 1);
  return safeOpacity;
}

function refreshProfileSyncRuntimeTracking({ decodePassphrase = true } = {}) {
  if (decodePassphrase) {
    profileSyncRuntime.passphraseSession = decodeStoredProfileSyncPassphrase() || '';
  }
  const activeScope = getActiveProfileSyncScope();
  const initialProfile = profileSyncCore.projectSyncProfile(config, activeScope);
  profileSyncRuntime.localProfileHash = computeScopedProfileHash(initialProfile, activeScope);
  profileSyncRuntime.pendingPullEchoHash = null;
  // Seed from the persisted content-change timestamp. lastSyncAt is only a
  // fallback for configs written before profileUpdatedAt existed — it tracks
  // sync *attempts* (including failures), so it must not be preferred here or
  // a string of failed syncs would make the local profile look freshly edited.
  const localProfileUpdatedAtSeed =
    config?.profileSync?.profileUpdatedAt ||
    config?.profileSync?.lastSyncAt ||
    new Date().toISOString();
  profileSyncRuntime.localProfileUpdatedAt = localProfileUpdatedAtSeed;
  if (config?.profileSync && !config.profileSync.profileUpdatedAt) {
    config.profileSync.profileUpdatedAt = localProfileUpdatedAtSeed;
    // Persist the migration once. Otherwise a failed attempt can advance
    // lastSyncAt, and the next restart would mistake that failure timestamp for
    // the age of local profile content.
    saveConfig({ allowDebouncedPush: false });
  }
}

function mainT(key, vars = {}) {
  return localizationService.translate(config?.ui?.language || 'auto', key, vars);
}

function finishSmokeTest(success, error = '') {
  if (!IS_SMOKE_TEST_MODE || smokeTestFinished) return;
  smokeTestFinished = true;
  if (smokeTestTimeout) {
    clearTimeout(smokeTestTimeout);
    smokeTestTimeout = null;
  }

  if (success) {
    const persistence = flushPendingConfigWriteSync({ shutdown: true });
    if (!persistence.success) {
      success = false;
      error = `Configuration flush failed: ${persistence.error}`;
    }
  }

  isQuitting = true;
  setImmediate(async () => {
    desktopPinWindows.forEach((pinWindow) => {
      if (pinWindow && !pinWindow.isDestroyed()) {
        pinWindow.destroy();
      }
    });
    desktopPinWindows.clear();
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.destroy();
    }
    if (tray && !tray.isDestroyed?.()) {
      tray.destroy();
    }
    try {
      await session.defaultSession.flushStorageData();
    } catch (storageError) {
      success = false;
      error = `Failed to flush smoke-test session storage: ${storageError.message}`;
    }

    const cleanup = removeSmokeTestProfile(smokeTestUserDataPath, smokeTestTempRootPath);
    if (!cleanup.success) {
      if (process.platform === 'win32') {
        // Windows keeps profile files locked until this process exits, so the
        // launcher is responsible for removing the retained directory afterwards.
        log.warn(`HA_WIDGET_SMOKE_TEST_PROFILE_RETAINED: ${smokeTestUserDataPath}`);
        console.warn(`HA_WIDGET_SMOKE_TEST_PROFILE_RETAINED: ${smokeTestUserDataPath}`);
      } else {
        success = false;
        error = `Failed to remove isolated smoke-test profile: ${cleanup.error}`;
      }
    } else {
      smokeTestUserDataPath = '';
    }

    if (success) {
      log.info('HA_WIDGET_SMOKE_TEST_OK');
      console.log('HA_WIDGET_SMOKE_TEST_OK');
    } else {
      const message = error || 'Packaged runtime smoke test failed';
      log.error(`HA_WIDGET_SMOKE_TEST_FAILED: ${message}`);
      console.error(`HA_WIDGET_SMOKE_TEST_FAILED: ${message}`);
    }
    app.exit(success ? 0 : 1);
  });
}

function maybeFinishSmokeTest() {
  if (
    IS_SMOKE_TEST_MODE &&
    smokeTestRendererLoaded &&
    smokeTestRendererReady &&
    smokeTestTrayReady &&
    mainWindow &&
    !mainWindow.isDestroyed()
  ) {
    finishSmokeTest(true);
  }
}

function startSmokeTestTimeout() {
  if (!IS_SMOKE_TEST_MODE || smokeTestTimeout || smokeTestFinished) return;
  smokeTestTimeout = setTimeout(() => {
    finishSmokeTest(false, 'Timed out waiting for the renderer and tray to initialize');
  }, 20000);
}

function closeDevReloadWatchers() {
  if (devReloadTimer) {
    clearTimeout(devReloadTimer);
    devReloadTimer = null;
  }

  while (devReloadWatchers.length) {
    const watcher = devReloadWatchers.pop();
    try {
      watcher?.close?.();
    } catch (error) {
      log.warn('Failed to close dev reload watcher:', error.message);
    }
  }

  devReloadWatchersStarted = false;
}

function reloadOpenWindowsIgnoringCache() {
  const windows = [];
  if (mainWindow && !mainWindow.isDestroyed()) {
    windows.push(mainWindow);
  }
  desktopPinWindows.forEach((window) => {
    if (window && !window.isDestroyed()) {
      windows.push(window);
    }
  });

  windows.forEach((window) => {
    try {
      window.webContents.reloadIgnoringCache();
    } catch (error) {
      log.warn('Failed to reload dev window:', error.message);
    }
  });
}

function attemptDevWindowReload(triggerLabel = 'unknown', attempt = 0) {
  if (!IS_DEV_MODE || isQuitting) return;

  if (!fs.existsSync(DEV_RENDERER_BUNDLE_PATH) && attempt < DEV_RELOAD_MAX_RETRIES) {
    devReloadTimer = setTimeout(() => {
      attemptDevWindowReload(triggerLabel, attempt + 1);
    }, DEV_RELOAD_RETRY_MS);
    return;
  }

  devReloadTimer = null;
  log.info(`Dev live reload triggered by ${triggerLabel}`);
  reloadOpenWindowsIgnoringCache();
}

function scheduleDevWindowReload(triggerPath = '') {
  if (!IS_DEV_MODE || isQuitting) return;
  if (devReloadTimer) {
    clearTimeout(devReloadTimer);
  }

  const triggerLabel = triggerPath ? path.relative(__dirname, triggerPath) : 'file watcher';

  devReloadTimer = setTimeout(() => {
    attemptDevWindowReload(triggerLabel);
  }, DEV_RELOAD_DEBOUNCE_MS);
}

function watchDevReloadTarget(targetPath, options = {}) {
  if (!IS_DEV_MODE || !targetPath || !fs.existsSync(targetPath)) return;

  try {
    const watcher = fs.watch(targetPath, options, (_eventType, fileName) => {
      const changedPath = fileName ? path.join(targetPath, String(fileName)) : targetPath;
      scheduleDevWindowReload(changedPath);
    });
    watcher.on('error', (error) => {
      log.warn(`Dev reload watcher error for ${targetPath}:`, error.message);
    });
    devReloadWatchers.push(watcher);
  } catch (error) {
    log.warn(`Unable to watch ${targetPath} for dev reload:`, error.message);
  }
}

function startDevLiveReloadWatchers() {
  if (!IS_DEV_MODE || devReloadWatchersStarted) return;
  devReloadWatchersStarted = true;

  watchDevReloadTarget(path.join(__dirname, 'index.html'));
  watchDevReloadTarget(path.join(__dirname, 'styles.css'));
  watchDevReloadTarget(path.join(__dirname, 'dist-renderer'), { recursive: true });

  log.info('Dev live reload watchers enabled');
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
  let home = '';
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

async function getDefaultProfileSyncFolderPath(provider, existingPath = '') {
  if (existingPath) {
    const existingFolder = path.dirname(existingPath);
    if (existingFolder && existingFolder !== '.') {
      return existingFolder;
    }
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

function isPortableBuild() {
  if (!app.isPackaged) return false;
  const env = process.env || {};
  return Boolean(
    env.PORTABLE_EXECUTABLE_DIR ||
    env.PORTABLE_EXECUTABLE_FILE ||
    env.PORTABLE_EXECUTABLE_APP_FILENAME
  );
}

/**
 * Resolve the executable path/options used for Windows startup registration.
 *
 * Portable builds run from a temporary extracted executable, so we must use
 * PORTABLE_EXECUTABLE_FILE to register the launcher that actually exists
 * across reboots.
 * @param {{quotePath?: boolean}} [options]
 * @returns {{path: string, args: string[], name: string, executablePath: string}}
 */
function getWindowsStartupRegistrationTarget(options = {}) {
  const env = process.env || {};
  const portableExecutable = env.PORTABLE_EXECUTABLE_FILE;
  const portableBuild = isPortableBuild();
  const quotePath = options.quotePath !== false;

  if (portableBuild && portableExecutable) {
    const executablePath = portableExecutable;
    return {
      path: quotePath ? quoteWindowsExecutablePath(executablePath) : executablePath,
      args: [],
      name: getWindowsStartupRegistryName(pkg, app.getName()),
      executablePath,
    };
  }

  if (portableBuild && !portableExecutable) {
    log.warn(
      "Portable build detected but PORTABLE_EXECUTABLE_FILE is not set; startup registration will use app.getPath('exe') which may be an ephemeral path."
    );
  }

  const executablePath = app.getPath('exe');
  return {
    path: quotePath ? quoteWindowsExecutablePath(executablePath) : executablePath,
    args: [],
    name: getWindowsStartupRegistryName(pkg, app.getName()),
    executablePath,
  };
}

function getWindowsStartupLookupOptions(target) {
  return {
    path: target.path,
    args: target.args,
  };
}

function normalizeVersion(value) {
  if (!value) return '';
  return String(value).trim().replace(/^v/i, '');
}

function parseVersionParts(value) {
  const normalized = normalizeVersion(value);
  const match = normalized.match(/^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?/);
  if (!match) return null;
  return {
    version: normalized,
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
    prerelease: match[4] || '',
  };
}

function comparePrereleaseIdentifiers(left, right) {
  const leftNumeric = /^\d+$/.test(left);
  const rightNumeric = /^\d+$/.test(right);
  if (leftNumeric && rightNumeric) return Number(left) - Number(right);
  if (leftNumeric) return -1;
  if (rightNumeric) return 1;
  return left.localeCompare(right);
}

function compareVersions(leftValue, rightValue) {
  const left = parseVersionParts(leftValue);
  const right = parseVersionParts(rightValue);
  if (!left && !right) return 0;
  if (!left) return -1;
  if (!right) return 1;

  for (const key of ['major', 'minor', 'patch']) {
    if (left[key] !== right[key]) return left[key] - right[key];
  }

  if (!left.prerelease && !right.prerelease) return 0;
  if (!left.prerelease) return 1;
  if (!right.prerelease) return -1;

  const leftParts = left.prerelease.split('.');
  const rightParts = right.prerelease.split('.');
  const max = Math.max(leftParts.length, rightParts.length);
  for (let index = 0; index < max; index += 1) {
    if (leftParts[index] === undefined) return -1;
    if (rightParts[index] === undefined) return 1;
    const compared = comparePrereleaseIdentifiers(leftParts[index], rightParts[index]);
    if (compared !== 0) return compared;
  }
  return 0;
}

function isPrereleaseVersion(value) {
  return !!parseVersionParts(value)?.prerelease;
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

function getNormalizedProfileSyncScopeValue(value) {
  return profileSyncCore.normalizeSyncScope(value);
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
    lastSyncStatus: 'idle',
    lastSyncError: '',
    profileUpdatedAt: null,
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
  target.profileSync = { ...defaults, ...(target.profileSync || {}) };
  target.profileSync.intervalMinutes = Number.isFinite(Number(target.profileSync.intervalMinutes))
    ? Math.max(1, Math.min(60, Number(target.profileSync.intervalMinutes)))
    : PROFILE_SYNC_DEFAULT_INTERVAL_MINUTES;
  target.profileSync.provider = normalizeProfileSyncProvider(target.profileSync.provider);
  target.profileSync.cloudFilePath =
    typeof target.profileSync.cloudFilePath === 'string' && target.profileSync.cloudFilePath.trim()
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

function ensureUpdateConfigDefaults(target) {
  if (!target || typeof target !== 'object') return target;
  target.updates = {
    allowPrerelease: false,
    ...(target.updates || {}),
  };
  target.updates.allowPrerelease = target.updates.allowPrerelease === true;
  return target;
}

/**
 * Keep the Home Assistant profile marker bounded and well-typed. The marker
 * records which HA-authored profile this desktop last applied, for revision
 * drift reporting through the companion protocol.
 */
function ensureHaProfileConfigDefaults(target) {
  if (!target || typeof target !== 'object') return target;
  const haProfile =
    target.haProfile && typeof target.haProfile === 'object' ? target.haProfile : {};
  const activeProfileId =
    typeof haProfile.activeProfileId === 'string'
      ? haProfile.activeProfileId.trim().slice(0, 64)
      : '';
  target.haProfile = {
    activeProfileId,
    revision:
      activeProfileId && Number.isInteger(haProfile.revision) && haProfile.revision >= 0
        ? haProfile.revision
        : 0,
    appliedAt:
      activeProfileId && typeof haProfile.appliedAt === 'string'
        ? haProfile.appliedAt.slice(0, 64)
        : '',
  };
  return target;
}

const TIME_DISPLAY_FORMATS = new Set(['system', '12-hour', '24-hour']);
const DATE_DISPLAY_FORMATS = new Set(['system', 'weekday-short', 'long', 'numeric']);

/**
 * Keep clock preferences constrained to formats the renderer understands.
 * Existing profiles only stored a 24-hour boolean, so preserve that behavior
 * while they are migrated to the explicit time format setting.
 *
 * Only `true` carries an intent to migrate. `false` was the default nobody chose, and it
 * meant "no hour12 option", i.e. whatever the active locale does — so it becomes 'system'
 * rather than '12-hour', which would flip 14:30 to 2:30 PM for every user on a 24-hour
 * locale the first time they open 3.8.0.
 */
function ensureDateTimeFormatConfigDefaults(target, options = {}) {
  if (!target || typeof target !== 'object') return target;
  target.ui = target.ui && typeof target.ui === 'object' ? target.ui : {};

  if (!TIME_DISPLAY_FORMATS.has(target.ui.timeFormat)) {
    target.ui.timeFormat =
      options.migrateLegacyClock === true && target.ui.use24HourClock === true
        ? '24-hour'
        : 'system';
  }
  if (!DATE_DISPLAY_FORMATS.has(target.ui.dateFormat)) {
    // Matches the date card shown before date formats were configurable.
    target.ui.dateFormat = 'weekday-short';
  }

  // Keep this legacy field as a compatibility alias for older synced profiles.
  target.ui.use24HourClock = target.ui.timeFormat === '24-hour';
  return target;
}

function getProfileSyncConfig() {
  ensureProfileSyncConfigDefaults(config);
  return config.profileSync;
}

function hasDeferredSecureConfigWork() {
  return (
    deferredHomeAssistantTokenDecryptPending ||
    deferredPlaintextTokenMigrationPending ||
    deferredProfileSyncPassphraseDecryptPending
  );
}

function sanitizeConfigForRenderer(inputConfig) {
  const cloned = JSON.parse(JSON.stringify(inputConfig || {}));
  if (cloned.profileSync) {
    delete cloned.profileSync.storedPassphrase;
    delete cloned.profileSync.passphraseTransition;
  }
  // The marker is runtime-only. It is never read from or written to a user
  // profile, including when the connected overlay is active.
  delete cloned.developmentDemo;
  if (IS_CLIMATE_DEMO_MODE) {
    cloned.developmentDemo = { climate: true, mode: 'isolated' };
  } else if (IS_CLIMATE_DEMO_OVERLAY_MODE) {
    cloned.developmentDemo = { climate: true, mode: 'overlay' };
  }
  cloned.configRevision = configSnapshotVersion;
  cloned.secureStoragePending = hasDeferredSecureConfigWork();
  if (configRecoveryNotice) {
    cloned.configRecovery = { ...configRecoveryNotice };
  }
  return cloned;
}

function isPlainObject(value) {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function getAuthorizedIpcSender(event) {
  const sender = event?.sender || null;
  if (!sender) return null;

  const senderWindow = BrowserWindow.fromWebContents(sender);
  if (!senderWindow || senderWindow.isDestroyed()) return null;

  const senderFrame = event?.senderFrame || null;
  if (senderFrame?.top && senderFrame.top !== senderFrame) {
    return null;
  }

  if (
    mainWindow &&
    !mainWindow.isDestroyed() &&
    sender === mainWindow.webContents &&
    senderWindow === mainWindow
  ) {
    return { type: 'main', window: mainWindow };
  }

  for (const [entityId, pinWindow] of desktopPinWindows.entries()) {
    if (
      pinWindow &&
      !pinWindow.isDestroyed() &&
      sender === pinWindow.webContents &&
      senderWindow === pinWindow
    ) {
      return { type: 'desktop-pin', entityId, window: pinWindow };
    }
  }

  return null;
}

function rejectUnauthorizedIpc(channel, response = { success: false, error: 'Unauthorized' }) {
  log.warn(`Unauthorized IPC sender rejected for ${channel}`);
  return response;
}

function authorizeIpcSender(event, channel, options = {}) {
  void channel;
  const sender = getAuthorizedIpcSender(event);
  if (!sender) return null;
  if (sender.type === 'main') return sender;
  if (sender.type === 'desktop-pin' && options.allowDesktopPin === true) return sender;
  return null;
}

function normalizeIpcEntityIdForKey(entityId) {
  return normalizeEntityIdForObjectKey(entityId, normalizeEntityId);
}

function normalizeDesktopPinActionError(error) {
  if (isPlainObject(error)) {
    return {
      ...error,
      message:
        typeof error.message === 'string' && error.message.trim()
          ? error.message
          : 'Desktop pin action failed',
    };
  }
  if (typeof error === 'string' && error.trim()) {
    return { message: error };
  }
  return { message: 'Desktop pin action failed' };
}

function normalizeDesktopPinActionResponse(response) {
  if (!isPlainObject(response)) {
    return { success: true, result: response };
  }

  if (response.success === false) {
    return {
      success: false,
      error: normalizeDesktopPinActionError(response.error),
    };
  }

  return { success: true, ...response };
}

function createDesktopPinActionRequestId() {
  const requestId = `desktop-pin-action-${Date.now()}-${nextDesktopPinActionRequestId}`;
  nextDesktopPinActionRequestId += 1;
  return requestId;
}

function settleDesktopPinActionRequest(requestId, settle, value) {
  const pending = pendingDesktopPinActionRequests.get(requestId);
  if (!pending) return false;

  pendingDesktopPinActionRequests.delete(requestId);
  clearTimeout(pending.timeoutId);
  pending[settle](value);
  return true;
}

function forwardDesktopPinActionToMainWindow(entityId, action, payload = {}, options = {}) {
  if (!mainWindow || mainWindow.isDestroyed()) {
    return Promise.resolve({ success: false, error: 'Main window is not available' });
  }

  const requestPayload = {
    entityId,
    action,
    payload: isPlainObject(payload) ? payload : {},
  };

  if (!options.awaitResponse) {
    mainWindow.webContents.send('desktop-pin-action-requested', requestPayload);
    return Promise.resolve({ success: true, forwarded: true });
  }

  const requestId = createDesktopPinActionRequestId();
  requestPayload.requestId = requestId;

  return new Promise((resolve, reject) => {
    const timeoutId = setTimeout(() => {
      settleDesktopPinActionRequest(
        requestId,
        'reject',
        new Error(`Timed out waiting for desktop pin action response: ${action}`)
      );
    }, DESKTOP_PIN_ACTION_RESPONSE_TIMEOUT_MS);

    pendingDesktopPinActionRequests.set(requestId, {
      resolve: (response) => resolve(normalizeDesktopPinActionResponse(response)),
      reject,
      timeoutId,
    });

    try {
      mainWindow.webContents.send('desktop-pin-action-requested', requestPayload);
    } catch (error) {
      settleDesktopPinActionRequest(requestId, 'reject', error);
    }
  });
}

function getDesktopPinCascadeOrigin(index = 0) {
  const primaryDisplay = electronScreen.getPrimaryDisplay();
  const workArea = primaryDisplay?.workArea || { x: 0, y: 0, width: 1280, height: 720 };
  return {
    x: workArea.x + 24 + (index % 4) * 28,
    y: workArea.y + 24 + (index % 6) * 28,
  };
}

function clampDesktopPinBounds(
  bounds = {},
  entityId = '',
  fallbackIndex = 0,
  previousBounds = null
) {
  const baseBounds = getDesktopPinBaseBounds(entityId);
  const cascadeOrigin = getDesktopPinCascadeOrigin(fallbackIndex);

  const width = Number.isFinite(Number(bounds.width))
    ? Math.round(Number(bounds.width))
    : baseBounds.width;
  const height = Number.isFinite(Number(bounds.height))
    ? Math.round(Number(bounds.height))
    : baseBounds.height;
  const x = Number.isFinite(Number(bounds.x)) ? Math.round(Number(bounds.x)) : cascadeOrigin.x;
  const y = Number.isFinite(Number(bounds.y)) ? Math.round(Number(bounds.y)) : cascadeOrigin.y;

  const display = electronScreen.getDisplayMatching({ x, y, width, height });
  const workArea = display?.workArea ||
    electronScreen.getPrimaryDisplay()?.workArea || { x: 0, y: 0, width: 1280, height: 720 };
  const clampedBounds = clampDesktopPinBoundsWithWorkArea(bounds, {
    entityId,
    contentMinBounds: desktopPinContentMinBounds.get(entityId) || null,
    fallbackOrigin: cascadeOrigin,
    workArea,
    previousBounds,
  });
  if (usesCompositorOwnedPlacement) {
    // Native Wayland owns placement. Keep valid coordinates as opaque
    // persisted metadata so an unrelated save cannot replace an X11 or
    // multi-monitor position that Electron cannot apply in this session.
    if (Number.isFinite(Number(bounds.x))) {
      clampedBounds.x = Math.round(Number(bounds.x));
    }
    if (Number.isFinite(Number(bounds.y))) {
      clampedBounds.y = Math.round(Number(bounds.y));
    }
  }
  return clampedBounds;
}

function applyDesktopPinBoundsToWindow(targetWindow, nextBounds) {
  if (!targetWindow || targetWindow.isDestroyed() || !nextBounds) return;
  try {
    targetWindow.__desktopPinApplyingBounds = true;
    if (usesCompositorOwnedPlacement) {
      targetWindow.setSize(nextBounds.width, nextBounds.height);
    } else {
      targetWindow.setBounds(nextBounds);
    }
    applyDesktopPinWindowShape(targetWindow, nextBounds);
    targetWindow.__desktopPinApplyingBounds = false;
  } catch (error) {
    targetWindow.__desktopPinApplyingBounds = false;
    log.warn('Failed to apply desktop pin bounds update:', error.message);
  }
}

async function syncDesktopPinContentMinBounds(entityId, minBounds = {}) {
  const normalizedEntityId = normalizeEntityId(entityId);
  if (!normalizedEntityId) {
    return { success: false, error: 'Invalid entity ID' };
  }

  if (getDesktopPinDomain(normalizedEntityId) !== 'scene') {
    return { success: false, error: 'Content-aware minimums only apply to scene desktop pins' };
  }

  if (!config?.desktopPins?.[normalizedEntityId]) {
    return { success: false, error: 'Desktop pin does not exist' };
  }

  const normalizedMinBounds = normalizeDesktopPinContentMinBounds(minBounds);
  if (!normalizedMinBounds) {
    return { success: false, error: 'Invalid content minimum bounds' };
  }

  const previousMinBounds = desktopPinContentMinBounds.get(normalizedEntityId);
  desktopPinContentMinBounds.set(normalizedEntityId, normalizedMinBounds);

  const currentBounds = config.desktopPins[normalizedEntityId];
  const clampedBounds = clampDesktopPinBounds(currentBounds, normalizedEntityId, 0, currentBounds);
  if (usesCompositorOwnedPlacement) {
    clampedBounds.x = currentBounds.x;
    clampedBounds.y = currentBounds.y;
  }
  const boundsChanged =
    clampedBounds.x !== currentBounds.x ||
    clampedBounds.y !== currentBounds.y ||
    clampedBounds.width !== currentBounds.width ||
    clampedBounds.height !== currentBounds.height;

  if (boundsChanged) {
    const previousBounds = currentBounds;
    config.desktopPins[normalizedEntityId] = clampedBounds;
    const persistence = await saveConfigDurably();
    if (!persistence.success) {
      config.desktopPins[normalizedEntityId] = previousBounds;
      if (previousMinBounds) {
        desktopPinContentMinBounds.set(normalizedEntityId, previousMinBounds);
      } else {
        desktopPinContentMinBounds.delete(normalizedEntityId);
      }
      return {
        success: false,
        error: `Failed to save desktop pin size: ${persistence.error}`,
      };
    }
    const runtimeWarnings = [];
    await runPostSaveSideEffect(runtimeWarnings, 'desktop pin minimum bounds', () =>
      applyDesktopPinBoundsToWindow(desktopPinWindows.get(normalizedEntityId), clampedBounds)
    );
    await runPostSaveSideEffect(runtimeWarnings, 'desktop pin bounds update', () =>
      sendDesktopPinUpdate(normalizedEntityId, { type: 'bounds' })
    );
    await runPostSaveSideEffect(runtimeWarnings, 'desktop pin renderer broadcast', () =>
      pushConfigToRenderer({ runtimeWarnings })
    );
    return {
      success: true,
      minBounds: normalizedMinBounds,
      pinBounds: config.desktopPins[normalizedEntityId],
      resized: true,
      ...(runtimeWarnings.length ? { runtimeWarnings } : {}),
    };
  }

  return {
    success: true,
    minBounds: normalizedMinBounds,
    pinBounds: config.desktopPins[normalizedEntityId],
    resized: boundsChanged,
  };
}

function normalizeDesktopPinsConfig(targetConfig) {
  if (!isPlainObject(targetConfig)) return targetConfig;
  const sourcePins = isPlainObject(targetConfig.desktopPins) ? targetConfig.desktopPins : {};
  const nextPins = {};
  let index = 0;

  Object.entries(sourcePins).forEach(([entityId, bounds]) => {
    const normalizedEntityId = normalizeEntityId(entityId);
    if (!normalizedEntityId) return;
    nextPins[normalizedEntityId] = clampDesktopPinBounds(bounds, normalizedEntityId, index++);
  });

  targetConfig.desktopPins = nextPins;
  return targetConfig;
}

function resolveDesktopPinSupportDecision(entityId, supportInfo = null) {
  const normalizedEntityId = normalizeEntityId(entityId);
  const fallbackProfile = resolveDesktopPinProfile(normalizedEntityId);
  if (!normalizedEntityId) return fallbackProfile;
  if (!isPlainObject(supportInfo)) return fallbackProfile;

  const sanitizedSupportInfo = sanitizeDesktopPinSupportInfo(supportInfo, normalizedEntityId);
  if (sanitizedSupportInfo.entityId !== normalizedEntityId) {
    return fallbackProfile;
  }

  return {
    ...fallbackProfile,
    ...sanitizedSupportInfo,
  };
}

async function pinEntityToDesktopInternal(entityId, supportInfo = null) {
  const normalizedEntityId = normalizeEntityId(entityId);
  if (!normalizedEntityId) {
    return { success: false, error: 'Invalid entity ID' };
  }

  const supportProfile = resolveDesktopPinSupportDecision(normalizedEntityId, supportInfo);
  if (!supportProfile.supported) {
    return {
      success: false,
      error: supportProfile.reason || 'Desktop pin not supported yet',
      supportProfile,
    };
  }

  const favorites = new Set((config.favoriteEntities || []).map(normalizeEntityId).filter(Boolean));
  if (!favorites.has(normalizedEntityId)) {
    return {
      success: false,
      error: 'Only Quick Access entities can be pinned in this version',
      supportProfile,
    };
  }

  const existed = !!config?.desktopPins?.[normalizedEntityId];
  const previousBounds = config?.desktopPins?.[normalizedEntityId];
  config.desktopPins = config.desktopPins || {};
  config.desktopPins[normalizedEntityId] = getDesktopPinBounds(
    normalizedEntityId,
    config.desktopPins[normalizedEntityId]
  );
  normalizeDesktopPinsConfig(config);
  const persistence = await saveConfigDurably();
  if (!persistence.success) {
    if (existed) {
      config.desktopPins[normalizedEntityId] = previousBounds;
    } else {
      delete config.desktopPins[normalizedEntityId];
    }
    return {
      success: false,
      error: `Failed to save desktop pin: ${persistence.error}`,
      supportProfile,
    };
  }
  const runtimeWarnings = [];
  await runPostSaveSideEffect(runtimeWarnings, 'desktop pin window creation', () =>
    syncDesktopPinWindowsWithConfig({ focusEntityId: normalizedEntityId })
  );
  await runPostSaveSideEffect(runtimeWarnings, 'desktop pin config broadcast', () =>
    broadcastDesktopPinConfigUpdate()
  );
  await runPostSaveSideEffect(runtimeWarnings, 'desktop pin renderer broadcast', () =>
    pushConfigToRenderer({ runtimeWarnings })
  );

  return {
    success: true,
    pinned: true,
    existed,
    supportProfile,
    pinBounds: config.desktopPins[normalizedEntityId],
    ...(runtimeWarnings.length ? { runtimeWarnings } : {}),
  };
}

async function unpinEntityFromDesktopInternal(entityId) {
  const normalizedEntityId = normalizeEntityId(entityId);
  if (!normalizedEntityId) {
    return { success: false, error: 'Invalid entity ID' };
  }

  const previousBounds = config?.desktopPins?.[normalizedEntityId];
  const previousMinBounds = desktopPinContentMinBounds.get(normalizedEntityId);
  if (previousBounds) {
    delete config.desktopPins[normalizedEntityId];
  }
  desktopPinContentMinBounds.delete(normalizedEntityId);
  const persistence = await saveConfigDurably();
  if (!persistence.success) {
    if (previousBounds) {
      config.desktopPins[normalizedEntityId] = previousBounds;
    }
    if (previousMinBounds) {
      desktopPinContentMinBounds.set(normalizedEntityId, previousMinBounds);
    }
    return {
      success: false,
      error: `Failed to save desktop pin removal: ${persistence.error}`,
    };
  }
  const runtimeWarnings = [];
  await runPostSaveSideEffect(runtimeWarnings, 'desktop pin window removal', () =>
    syncDesktopPinWindowsWithConfig()
  );
  await runPostSaveSideEffect(runtimeWarnings, 'desktop pin removal broadcast', () =>
    broadcastDesktopPinConfigUpdate()
  );
  await runPostSaveSideEffect(runtimeWarnings, 'desktop pin renderer broadcast', () =>
    pushConfigToRenderer({ runtimeWarnings })
  );

  return {
    success: true,
    pinned: false,
    ...(runtimeWarnings.length ? { runtimeWarnings } : {}),
  };
}

function applyWindowEffectsToWindow(targetWindow, currentConfig, overrideFrostedGlass) {
  if (!targetWindow || targetWindow.isDestroyed()) return;
  const transparencyOptions = getWindowTransparencyOptions(currentConfig);
  const enabled = resolveFrostedGlassConfig(currentConfig, overrideFrostedGlass);

  if (process.platform === 'win32' && typeof targetWindow.setBackgroundMaterial === 'function') {
    try {
      targetWindow.setBackgroundMaterial(enabled ? 'acrylic' : 'none');
    } catch (error) {
      log.warn('Failed to set background material:', error.message);
    }
  } else if (process.platform === 'darwin') {
    if (typeof targetWindow.setVibrancy === 'function') {
      try {
        targetWindow.setVibrancy(enabled ? 'sidebar' : null);
      } catch (error) {
        log.warn('Failed to set vibrancy:', error.message);
      }
    }
    if (typeof targetWindow.setVisualEffectState === 'function') {
      try {
        targetWindow.setVisualEffectState(enabled ? 'active' : 'inactive');
      } catch (error) {
        log.warn('Failed to set visual effect state:', error.message);
      }
    }
  }

  try {
    targetWindow.setBackgroundColor(transparencyOptions.backgroundColor);
  } catch (error) {
    log.warn('Failed to set background color:', error.message);
  }
}

function wireWindowEffectsRefresh(targetWindow, currentConfigProvider, overrideFrostedGlass) {
  if (!targetWindow || process.platform !== 'win32') return;

  const refreshEffects = () => {
    const currentConfig =
      typeof currentConfigProvider === 'function' ? currentConfigProvider() : currentConfigProvider;
    applyWindowEffectsToWindow(targetWindow, currentConfig, overrideFrostedGlass);
  };

  const scheduleRefresh = () => {
    refreshEffects();
    setTimeout(refreshEffects, 50);
    setTimeout(refreshEffects, 250);
  };

  ['focus', 'blur', 'show', 'restore', 'enter-full-screen', 'leave-full-screen'].forEach(
    (eventName) => {
      targetWindow.on(eventName, scheduleRefresh);
    }
  );
}

function applyDesktopPinWindowEffects(targetWindow, currentConfig) {
  // Desktop pins intentionally keep native acrylic/vibrancy disabled so the
  // rounded CSS shape does not reveal a square backdrop during refreshes.
  applyWindowEffectsToWindow(targetWindow, currentConfig, false);
}

function getDesktopPinBounds(entityId, existingBounds = null) {
  const fallbackIndex = Object.keys(config?.desktopPins || {}).length;
  return clampDesktopPinBounds(existingBounds || {}, entityId, fallbackIndex);
}

function applyDesktopPinDesktopBehavior(targetWindow) {
  if (!targetWindow || targetWindow.isDestroyed()) return;

  try {
    targetWindow.setAlwaysOnTop(false);
  } catch (error) {
    log.warn('Failed to clear always-on-top for desktop pin window:', error.message);
  }
}

function buildRoundedRectShape(width, height, radius = DESKTOP_PIN_WINDOW_CORNER_RADIUS) {
  const safeWidth = Math.max(1, Math.floor(Number(width) || 0));
  const safeHeight = Math.max(1, Math.floor(Number(height) || 0));
  const safeRadius = Math.max(
    0,
    Math.min(Math.floor(radius), Math.floor(safeWidth / 2), Math.floor(safeHeight / 2))
  );

  if (safeRadius <= 0) {
    return [{ x: 0, y: 0, width: safeWidth, height: safeHeight }];
  }

  const rects = [];
  for (let y = 0; y < safeHeight; y += 1) {
    const topDistance = y;
    const bottomDistance = safeHeight - 1 - y;
    let inset = 0;

    if (topDistance < safeRadius) {
      const dy = safeRadius - topDistance - 1;
      inset = Math.max(
        inset,
        Math.ceil(safeRadius - Math.sqrt(Math.max(0, safeRadius * safeRadius - dy * dy)))
      );
    }

    if (bottomDistance < safeRadius) {
      const dy = safeRadius - bottomDistance - 1;
      inset = Math.max(
        inset,
        Math.ceil(safeRadius - Math.sqrt(Math.max(0, safeRadius * safeRadius - dy * dy)))
      );
    }

    const rowWidth = Math.max(1, safeWidth - inset * 2);
    rects.push({ x: inset, y, width: rowWidth, height: 1 });
  }

  return rects;
}

function applyDesktopPinWindowShape(targetWindow, bounds = null) {
  if (!targetWindow || targetWindow.isDestroyed() || typeof targetWindow.setShape !== 'function')
    return;

  const nextBounds = bounds || targetWindow.getBounds();
  const shape = buildRoundedRectShape(
    nextBounds.width,
    nextBounds.height,
    DESKTOP_PIN_WINDOW_CORNER_RADIUS
  );

  try {
    targetWindow.setShape(shape);
  } catch (error) {
    log.warn('Failed to apply rounded shape to desktop pin window:', error.message);
  }
}

function sendDesktopPinUpdate(entityId, extra = {}) {
  const window = desktopPinWindows.get(entityId);
  if (!window || window.isDestroyed()) return;
  window.webContents.send('desktop-pin-update', {
    entityId,
    entity: latestEntityStates.get(entityId) || null,
    hasSnapshot: hasPublishedHaSnapshot,
    pinBounds: config?.desktopPins?.[entityId] || null,
    config: createDesktopPinRendererConfig(config),
    connection: createDesktopPinConnectionState(config, {
      secureStoragePending: hasDeferredSecureConfigWork(),
    }),
    editMode: desktopPinEditMode,
    ...extra,
  });
}

function broadcastDesktopPinConfigUpdate() {
  desktopPinWindows.forEach((_window, entityId) => {
    sendDesktopPinUpdate(entityId, { type: 'config' });
  });
}

function focusMainWindow() {
  if (!mainWindow || mainWindow.isDestroyed()) {
    createWindow();
  }
  if (!mainWindow || mainWindow.isDestroyed()) {
    return { focused: false };
  }

  // A one-off raise: it clears full-screen windows the same way the popup hotkey does,
  // then settles back to the user's always-on-top preference.
  popupWindowPresenter.showAboveFullScreen(mainWindow, { keepElevated: false });

  return { focused: mainWindow.isFocused() };
}

/**
 * Show the widget from the tray, going through the same raise the popup hotkey uses so it
 * cannot open behind a full-screen window either.
 */
function showMainWindowFromTray() {
  if (mainWindow && !mainWindow.isDestroyed()) {
    try {
      // Restore the configured size before showing; a hide can leave a stale size behind.
      mainWindow.setSize(config.windowSize?.width || 500, config.windowSize?.height || 600);
    } catch (error) {
      log.warn('Failed to restore window size before showing:', error.message);
    }
  }
  return focusMainWindow();
}

/** Hide the widget to the tray, ending any raise still in flight. */
function hideMainWindowToTray() {
  if (!mainWindow || mainWindow.isDestroyed()) return false;
  return popupWindowPresenter.hidePopup(mainWindow);
}

/**
 * Push the user's always-on-top preference onto the main window.
 *
 * While a popup raise is in flight the window sits above full-screen content on purpose;
 * writing the preference then would drop it behind the video mid-popup, so the presenter
 * applies it when the raise ends instead.
 */
function applyAlwaysOnTopPreference() {
  if (!mainWindow || mainWindow.isDestroyed()) return false;
  if (popupWindowPresenter.isElevated()) return false;
  mainWindow.setAlwaysOnTop(!!config.alwaysOnTop);
  return true;
}

function focusDesktopPinWindow(entityId) {
  const window = desktopPinWindows.get(entityId);
  if (!window || window.isDestroyed()) {
    return { focused: false, exists: false };
  }

  if (window.isMinimized()) {
    window.restore();
  }
  window.show();
  window.focus();
  window.moveTop();
  return { focused: window.isFocused(), exists: true };
}

function closeDesktopPinWindow(entityId, options = {}) {
  const window = desktopPinWindows.get(entityId);
  if (!window || window.isDestroyed()) return;
  window.__desktopPinProgrammaticClose = true;
  if (options.destroyConfig && config?.desktopPins?.[entityId]) {
    delete config.desktopPins[entityId];
  }
  window.close();
}

function applyDesktopPinEditModeToWindow(targetWindow) {
  if (!targetWindow || targetWindow.isDestroyed()) return;

  if (typeof targetWindow.setMovable === 'function') {
    try {
      targetWindow.setMovable(!!desktopPinEditMode);
    } catch (error) {
      log.warn('Failed to update desktop pin movable state:', error.message);
    }
  }
}

function setDesktopPinEditMode(enabled) {
  desktopPinEditMode = !!enabled;
  desktopPinWindows.forEach((window, entityId) => {
    applyDesktopPinEditModeToWindow(window);
    sendDesktopPinUpdate(entityId, { type: 'edit-mode' });
  });

  return { success: true, enabled: desktopPinEditMode };
}

async function updateDesktopPinBounds(entityId, nextBounds = {}) {
  const normalizedEntityId = normalizeEntityId(entityId);
  if (!normalizedEntityId) {
    return { success: false, error: 'Invalid entity ID' };
  }

  if (!desktopPinEditMode) {
    return { success: false, error: 'Desktop pin edit mode is not active' };
  }

  if (!config?.desktopPins?.[normalizedEntityId]) {
    return { success: false, error: 'Desktop pin does not exist' };
  }

  const clampedBounds = clampDesktopPinBounds(
    {
      ...config.desktopPins[normalizedEntityId],
      ...(isPlainObject(nextBounds) ? nextBounds : {}),
    },
    normalizedEntityId,
    0,
    config.desktopPins[normalizedEntityId]
  );
  if (usesCompositorOwnedPlacement) {
    clampedBounds.x = config.desktopPins[normalizedEntityId].x;
    clampedBounds.y = config.desktopPins[normalizedEntityId].y;
  }

  const previousBounds = config.desktopPins[normalizedEntityId];
  config.desktopPins[normalizedEntityId] = clampedBounds;
  const persistence = await saveConfigDurably();
  if (!persistence.success) {
    config.desktopPins[normalizedEntityId] = previousBounds;
    return {
      success: false,
      error: `Failed to save desktop pin position: ${persistence.error}`,
      pinBounds: previousBounds,
    };
  }

  const runtimeWarnings = [];
  await runPostSaveSideEffect(runtimeWarnings, 'desktop pin bounds', () => {
    const window = desktopPinWindows.get(normalizedEntityId);
    if (window && !window.isDestroyed()) {
      applyDesktopPinBoundsToWindow(window, clampedBounds);
    }
  });
  await runPostSaveSideEffect(runtimeWarnings, 'desktop pin bounds update', () =>
    sendDesktopPinUpdate(normalizedEntityId, { type: 'bounds' })
  );
  await runPostSaveSideEffect(runtimeWarnings, 'desktop pin renderer broadcast', () =>
    pushConfigToRenderer({ runtimeWarnings })
  );
  return {
    success: true,
    pinBounds: clampedBounds,
    ...(runtimeWarnings.length ? { runtimeWarnings } : {}),
  };
}

function createDesktopPinWindow(entityId, options = {}) {
  const normalizedEntityId = normalizeEntityId(entityId);
  if (!normalizedEntityId) return null;

  const existingWindow = desktopPinWindows.get(normalizedEntityId);
  if (existingWindow && !existingWindow.isDestroyed()) {
    if (options.focus) {
      focusDesktopPinWindow(normalizedEntityId);
    }
    sendDesktopPinUpdate(normalizedEntityId, { type: 'bootstrap' });
    return existingWindow;
  }

  const pinBounds = getDesktopPinBounds(
    normalizedEntityId,
    config?.desktopPins?.[normalizedEntityId]
  );
  config.desktopPins = config.desktopPins || {};
  config.desktopPins[normalizedEntityId] = pinBounds;

  const iconPath = getAppIconPath(__dirname);
  const transparencyOptions = getWindowTransparencyOptions(config);
  const pinPositionOptions = usesCompositorOwnedPlacement ? {} : { x: pinBounds.x, y: pinBounds.y };
  const windowOptions = {
    ...pinPositionOptions,
    width: pinBounds.width,
    height: pinBounds.height,
    transparent: transparencyOptions.transparent,
    backgroundColor: transparencyOptions.backgroundColor,
    frame: false,
    hasShadow: false,
    alwaysOnTop: false,
    skipTaskbar: true,
    resizable: false,
    maximizable: false,
    minimizable: false,
    fullscreenable: false,
    movable: desktopPinEditMode,
    icon: iconPath,
    show: false,
    webPreferences: {
      preload: PRELOAD_SCRIPT_PATH,
      nodeIntegration: false,
      contextIsolation: true,
      webSecurity: true,
    },
  };

  if (process.platform === 'linux') {
    windowOptions.roundedCorners = false;
  }

  // Desktop pin windows render their own rounded glass surface in CSS.
  // Keeping native acrylic enabled here leaves a rectangular backdrop behind
  // the rounded widget, which creates mismatched corners.
  if (config.frostedGlass && options.useNativeFrostedGlass !== false) {
    if (process.platform === 'win32') {
      windowOptions.backgroundMaterial = 'acrylic';
    } else if (process.platform === 'darwin') {
      windowOptions.vibrancy = 'sidebar';
    }
  }

  const pinWindow = new BrowserWindow(windowOptions);
  hardenRendererNavigation(pinWindow);
  pinWindow.setMenuBarVisibility(false);
  pinWindow.__desktopPinEntityId = normalizedEntityId;
  desktopPinWindows.set(normalizedEntityId, pinWindow);

  try {
    const safeOpacity = Math.max(0.5, Math.min(1, config.opacity || 1));
    pinWindow.setOpacity(transparencyOptions.transparent ? 1 : safeOpacity);
  } catch (error) {
    log.warn('Failed to set desktop pin opacity:', error.message);
  }
  applyDesktopPinWindowShape(pinWindow, pinBounds);
  applyDesktopPinWindowEffects(pinWindow, config);
  wireWindowEffectsRefresh(pinWindow, () => config, false);
  applyDesktopPinEditModeToWindow(pinWindow);

  const persistBounds = () => {
    if (
      usesCompositorOwnedPlacement ||
      !desktopPinEditMode ||
      pinWindow.__desktopPinApplyingBounds
    ) {
      return;
    }
    if (pinWindow.__desktopPinSaveTimer) {
      clearTimeout(pinWindow.__desktopPinSaveTimer);
    }
    pinWindow.__desktopPinPendingBounds = getDesktopPinBounds(
      normalizedEntityId,
      pinWindow.getBounds()
    );
    pinWindow.__desktopPinSaveTimer = setTimeout(() => {
      pinWindow.__desktopPinSaveTimer = null;
      if (!pinWindow || pinWindow.isDestroyed()) return;
      if (!desktopPinEditMode) return;
      const nextBounds =
        pinWindow.__desktopPinPendingBounds ||
        getDesktopPinBounds(normalizedEntityId, pinWindow.getBounds());
      pinWindow.__desktopPinPendingBounds = null;
      runBackgroundConfigMutation(() => {
        config.desktopPins = config.desktopPins || {};
        config.desktopPins[normalizedEntityId] = nextBounds;
        saveConfig();
        pushConfigToRenderer();
        sendDesktopPinUpdate(normalizedEntityId, { type: 'bounds' });
      }, 'desktop pin bounds save');
    }, 180);
  };

  pinWindow.on('moved', persistBounds);

  pinWindow.on('close', (event) => {
    if (isQuitting || pinWindow.__desktopPinProgrammaticClose) return;
    if (event && typeof event.preventDefault === 'function') {
      event.preventDefault();
    }
  });

  pinWindow.on('closed', () => {
    desktopPinWindows.delete(normalizedEntityId);
    if (pinWindow.__desktopPinSaveTimer) {
      clearTimeout(pinWindow.__desktopPinSaveTimer);
      pinWindow.__desktopPinSaveTimer = null;
    }
  });

  pinWindow.loadFile('index.html', {
    query: { mode: 'desktop-pin', entityId: normalizedEntityId },
  });
  pinWindow.webContents.on('did-finish-load', () => {
    sendDesktopPinUpdate(normalizedEntityId, { type: 'bootstrap' });
    applyDesktopPinDesktopBehavior(pinWindow);
    applyDesktopPinEditModeToWindow(pinWindow);
    if (options.focus) {
      pinWindow.show();
      pinWindow.focus();
      pinWindow.moveTop();
    } else if (typeof pinWindow.showInactive === 'function') {
      pinWindow.showInactive();
    } else {
      pinWindow.show();
    }
  });

  return pinWindow;
}

function syncDesktopPinWindowsWithConfig(options = {}) {
  const desiredPins = Object.keys(config?.desktopPins || {});

  desktopPinWindows.forEach((_window, entityId) => {
    if (!desiredPins.includes(entityId)) {
      closeDesktopPinWindow(entityId);
    }
  });

  desiredPins.forEach((entityId) => {
    const bounds = getDesktopPinBounds(entityId, config.desktopPins[entityId]);
    config.desktopPins[entityId] = bounds;
    const window = desktopPinWindows.get(entityId);
    if (!window || window.isDestroyed()) {
      createDesktopPinWindow(entityId, {
        focus: !!options.focusEntityId && options.focusEntityId === entityId,
      });
      return;
    }

    const currentBounds = window.getBounds();
    const boundsChanged =
      currentBounds.x !== bounds.x ||
      currentBounds.y !== bounds.y ||
      currentBounds.width !== bounds.width ||
      currentBounds.height !== bounds.height;

    if (boundsChanged) {
      applyDesktopPinBoundsToWindow(window, bounds);
    }

    try {
      const safeOpacity = Math.max(0.5, Math.min(1, config.opacity || 1));
      const transparencyOptions = getWindowTransparencyOptions(config);
      window.setOpacity(transparencyOptions.transparent ? 1 : safeOpacity);
    } catch (error) {
      log.warn('Failed to refresh desktop pin window state:', error.message);
    }
    applyDesktopPinEditModeToWindow(window);
    applyDesktopPinWindowEffects(window, config);
    sendDesktopPinUpdate(entityId, { type: 'config' });
  });
}

function applyMainWindowSettingSideEffects(previousConfig, nextConfig) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    try {
      if (previousConfig?.alwaysOnTop !== nextConfig?.alwaysOnTop) {
        applyAlwaysOnTopPreference();
      }
    } catch (error) {
      log.warn('Failed to apply always-on-top update from sync:', error.message);
    }

    if (previousConfig?.frostedGlass !== nextConfig?.frostedGlass) {
      applyFrostedGlass();
    }

    try {
      if (
        typeof nextConfig?.opacity === 'number' &&
        (previousConfig?.opacity !== nextConfig.opacity ||
          previousConfig?.frostedGlass !== nextConfig?.frostedGlass)
      ) {
        applyWindowOpacity(mainWindow, nextConfig.opacity, nextConfig);
      }
    } catch (error) {
      log.warn('Failed to apply opacity update from sync:', error.message);
    }
  }

  desktopPinWindows.forEach((window) => {
    if (!window || window.isDestroyed()) return;
    try {
      const safeOpacity = Math.max(0.5, Math.min(1, nextConfig?.opacity || 1));
      const transparencyOptions = getWindowTransparencyOptions(nextConfig);
      window.setOpacity(transparencyOptions.transparent ? 1 : safeOpacity);
    } catch (error) {
      log.warn('Failed to update desktop pin opacity:', error.message);
    }

    if (previousConfig?.frostedGlass !== nextConfig?.frostedGlass) {
      applyDesktopPinWindowEffects(window, nextConfig);
    }
  });
}

function configSectionChanged(previousValue, nextValue) {
  return JSON.stringify(previousValue ?? null) !== JSON.stringify(nextValue ?? null);
}

async function applyRuntimeConfigSideEffects(previousConfig, nextConfig, source = 'config update') {
  const entityHotkeysChanged = configSectionChanged(
    previousConfig?.globalHotkeys,
    nextConfig?.globalHotkeys
  );
  const popupHotkeyChanged =
    previousConfig?.popupHotkey !== nextConfig?.popupHotkey ||
    previousConfig?.popupHotkeyHideOnRelease !== nextConfig?.popupHotkeyHideOnRelease ||
    previousConfig?.popupHotkeyToggleMode !== nextConfig?.popupHotkeyToggleMode;
  const failures = [];

  try {
    if (usesCompositorOwnedPlacement && (entityHotkeysChanged || popupHotkeyChanged)) {
      await ensurePortalShortcutsBackendInitialized();
    }
    if (portalShortcutsActive && (entityHotkeysChanged || popupHotkeyChanged)) {
      const result = await syncPortalShortcuts({ immediate: true });
      if (!result.success) {
        failures.push(`portal shortcuts: ${result.error || 'activation failed'}`);
      }
    } else {
      if (entityHotkeysChanged) {
        const result = await Promise.resolve(registerGlobalHotkeys());
        if (result?.success === false) {
          failures.push(`entity hotkeys: ${result.error || 'activation failed'}`);
        }
      }
      if (popupHotkeyChanged) {
        const result = await Promise.resolve(registerPopupHotkey());
        if (result?.success === false) {
          failures.push(`popup hotkey: ${result.error || 'activation failed'}`);
        }
      }
    }
  } catch (error) {
    failures.push(`hotkey runtime: ${error?.message || String(error)}`);
  }

  if (configSectionChanged(previousConfig?.entityAlerts, nextConfig?.entityAlerts)) {
    try {
      setupEntityAlerts();
    } catch (error) {
      failures.push(`entity alerts: ${error?.message || String(error)}`);
    }
  }

  if (failures.length) {
    throw new Error(`Failed to refresh runtime state after ${source}: ${failures.join('; ')}`);
  }
}

function pushConfigToRenderer(extra = {}) {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  mainWindow.webContents.send('config-updated', {
    ...sanitizeConfigForRenderer(config),
    ...(isPlainObject(extra) ? extra : {}),
  });
}

function getDesktopCompanionState() {
  const state = {
    visible: !!mainWindow && !mainWindow.isDestroyed() && mainWindow.isVisible(),
    current_page:
      typeof config?.activeTabId === 'string' && config.activeTabId.trim()
        ? config.activeTabId.trim().slice(0, 128)
        : 'default',
  };
  // The window size drives tile wrapping, so Home Assistant's preview needs it
  // to reproduce the layout faithfully.
  const bounds =
    mainWindow && !mainWindow.isDestroyed() ? mainWindow.getBounds() : config?.windowSize || {};
  if (Number.isInteger(bounds?.width) && bounds.width > 0 && Number.isInteger(bounds?.height)) {
    state.window_width = Math.max(100, Math.min(bounds.width, 10000));
    state.window_height = Math.max(100, Math.min(bounds.height, 10000));
  }
  const haProfile = config?.haProfile;
  if (typeof haProfile?.activeProfileId === 'string' && haProfile.activeProfileId.trim()) {
    state.active_profile_id = haProfile.activeProfileId.trim().slice(0, 64);
    if (Number.isInteger(haProfile.revision) && haProfile.revision >= 0) {
      state.profile_revision = haProfile.revision;
    }
  }
  return state;
}

function notifyDesktopCompanionStateChanged() {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  mainWindow.webContents.send('desktop-companion-state-changed', getDesktopCompanionState());
}

function getDesktopCompanionRegistration() {
  const desktopId = config?.desktopCompanion?.desktopId || '';
  if (!desktopId) return null;
  const platformNames = {
    darwin: 'macOS',
    linux: 'Linux',
    win32: 'Windows',
  };
  return {
    desktop_id: desktopId,
    name: `HA Desktop Widget (${platformNames[process.platform] || 'Desktop'})`,
    platform: process.platform,
    architecture: process.arch,
    app_version: app.getVersion(),
    capabilities: ['visibility', 'switch_page', 'apply_profile'],
  };
}

function ensureDesktopCompanionIdentity() {
  config.desktopCompanion =
    config.desktopCompanion && typeof config.desktopCompanion === 'object'
      ? config.desktopCompanion
      : {};
  if (!config.desktopCompanion.desktopId) {
    config.desktopCompanion.desktopId = nodeCrypto.randomUUID();
  }
  return config.desktopCompanion.desktopId;
}

function buildProfileSyncStatus(extra = {}) {
  const profileSync = getProfileSyncConfig();
  const status = {
    enabled: !!profileSync.enabled,
    provider: normalizeProfileSyncProvider(profileSync.provider),
    cloudFilePath: profileSync.cloudFilePath || '',
    syncScope: getNormalizedProfileSyncScopeValue(profileSync.syncScope),
    intervalMinutes: profileSync.intervalMinutes || PROFILE_SYNC_DEFAULT_INTERVAL_MINUTES,
    encryptionEnabled: !!profileSync.encryptionEnabled,
    rememberPassphrase: !!profileSync.rememberPassphrase,
    passphraseEncrypted: !!profileSync.passphraseEncrypted,
    passphraseStored: !!profileSync.storedPassphrase,
    passphraseWarning: profileSyncRuntime.passphraseWarning || '',
    lastSyncAt: profileSync.lastSyncAt || null,
    lastSyncStatus: profileSync.lastSyncStatus || 'idle',
    lastSyncError: profileSync.lastSyncError || '',
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

function updateProfileSyncStatus(status, errorMessage = '') {
  const profileSync = getProfileSyncConfig();
  profileSync.lastSyncAt = new Date().toISOString();
  profileSync.lastSyncStatus = status;
  profileSync.lastSyncError = errorMessage || '';
  saveConfig();
}

function decodeStoredProfileSyncPassphrase() {
  const profileSync = getProfileSyncConfig();
  profileSyncRuntime.passphraseWarning = '';
  if (!profileSync.rememberPassphrase || !profileSync.storedPassphrase) {
    return '';
  }

  if (profileSync.passphraseEncrypted) {
    if (!safeStorage.isEncryptionAvailable()) {
      profileSyncRuntime.passphraseWarning =
        'Stored passphrase could not be decrypted on this system.';
      return '';
    }
    try {
      const encryptedBuffer = Buffer.from(profileSync.storedPassphrase, 'base64');
      return safeStorage.decryptString(encryptedBuffer);
    } catch (error) {
      log.warn('Failed to decrypt remembered profile sync passphrase:', error.message);
      profileSyncRuntime.passphraseWarning = 'Stored passphrase could not be decrypted.';
      return '';
    }
  }

  return profileSync.storedPassphrase;
}

function persistRememberedProfileSyncPassphrase(passphrase, remember) {
  const profileSync = getProfileSyncConfig();

  if (!remember) {
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
  profileSyncRuntime.passphraseWarning =
    'Passphrase will only be kept for this session because OS encryption is unavailable.';
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
      'Secure OS credential storage is required to change an active sync passphrase safely'
    );
  }
  const encrypted = safeStorage.encryptString(typeof secret === 'string' ? secret : '');
  return encrypted.toString('base64');
}

function unsealProfileSyncTransitionSecret(encryptedSecret) {
  if (!isSecureProfileSyncStorageAvailable(safeStorage, process.platform)) {
    throw new Error('Secure OS credential storage is unavailable for pending sync-key recovery');
  }
  try {
    return safeStorage.decryptString(Buffer.from(encryptedSecret, 'base64'));
  } catch {
    throw new Error('Pending sync-key recovery credentials could not be decrypted');
  }
}

async function buildProfileSyncEnvelopeForConfig(
  sourceConfig,
  { encrypt, passphrase, updatedAt = new Date().toISOString() }
) {
  const profileSync = sourceConfig?.profileSync || getProfileSyncConfig();
  const syncScope = getNormalizedProfileSyncScopeValue(profileSync.syncScope);
  return profileSyncCore.buildSyncEnvelope({
    profile: profileSyncCore.projectSyncProfile(sourceConfig, syncScope),
    updatedAt,
    updatedByDeviceId: profileSync.deviceId,
    syncScope,
    encrypt: encrypt === true,
    passphrase: passphrase || '',
  });
}

async function decodeRemoteProfileWithPassphrase(readResult, passphrase) {
  if (!readResult?.exists || !readResult.envelope) {
    return { profile: null, syncScope: null };
  }
  const profile = await profileSyncCore.decodeEnvelopeProfile(readResult.envelope, passphrase);
  return {
    profile,
    syncScope: profileSyncCore.extractSyncScopeFromEnvelope(readResult.envelope),
  };
}

function assertRemoteProfileMatchesConfig(decodedRemote, baselineConfig) {
  if (!decodedRemote?.profile || !decodedRemote.syncScope) return;
  const localProfile = profileSyncCore.projectSyncProfile(baselineConfig, decodedRemote.syncScope);
  if (
    computeScopedProfileHash(decodedRemote.profile, decodedRemote.syncScope) !==
    computeScopedProfileHash(localProfile, decodedRemote.syncScope)
  ) {
    throw new Error(
      'The remote profile has changes that are not present locally. Sync or resolve them before changing encryption.'
    );
  }
}

async function stageProfileSyncRewrite({
  oldPassphrase,
  newPassphrase,
  rememberNewPassphrase,
  targetEncryptionEnabled,
  changeCredential,
  baselineConfig = config,
  targetConfig = config,
  reason,
  remoteResult = null,
}) {
  const profileSync = getProfileSyncConfig();
  if (profileSync.passphraseTransition) {
    throw new Error('A sync-key rewrite is already pending recovery');
  }
  if (!profileSync.enabled || !profileSync.cloudFilePath) {
    throw new Error('Profile sync must have an active remote file before it can be rewritten');
  }

  // Seal both credentials before either side changes. This is intentionally
  // required even for users who do not normally remember a passphrase: the
  // short-lived recovery record is what makes every crash point reversible.
  const oldPassphraseEncrypted = sealProfileSyncTransitionSecret(oldPassphrase);
  const newPassphraseEncrypted = sealProfileSyncTransitionSecret(newPassphrase);
  const baselineRemote = remoteResult || (await readConfiguredSyncEnvelope());
  const decodedRemote = await decodeRemoteProfileWithPassphrase(baselineRemote, oldPassphrase);
  assertRemoteProfileMatchesConfig(decodedRemote, baselineConfig);

  const targetEnvelope = await buildProfileSyncEnvelopeForConfig(targetConfig, {
    encrypt: targetEncryptionEnabled,
    passphrase: newPassphrase,
  });
  const targetEnvelopeSerialized = profileSyncCore.serializeSyncEnvelope(targetEnvelope);
  const transaction = createProfileSyncRewriteTransaction({
    reason,
    provider: normalizeProfileSyncProvider(profileSync.provider),
    cloudFilePath: profileSync.cloudFilePath,
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
    const persistence = await saveConfigDurably({ allowDebouncedPush: false });
    if (!persistence.success) {
      profileSync.passphraseTransition = previousTransition;
      profileSync.remoteRewritePending = previousRemoteRewritePending;
      throw new Error(`Failed to stage sync-key recovery: ${persistence.error}`);
    }
  });
  return transaction;
}

async function executePendingProfileSyncRewrite() {
  const profileSync = getProfileSyncConfig();
  const transaction = normalizeProfileSyncRewriteTransaction(profileSync.passphraseTransition);
  if (!transaction) {
    throw new Error('No valid sync-key rewrite transaction is available');
  }
  if (
    !profileSyncRewriteEndpointMatches(
      transaction,
      normalizeProfileSyncProvider(profileSync.provider),
      profileSync.cloudFilePath
    )
  ) {
    throw new Error(
      'The sync provider or file changed during key recovery. Restore the original target before retrying.'
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
    throw new Error('The staged sync-key target failed its integrity check');
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
        await decodeRemoteProfileWithPassphrase(currentRemote, oldPassphrase);
      },
      writeExactTarget: async (serializedTarget) => {
        if (serializedTarget !== transaction.targetEnvelopeSerialized) {
          throw new Error('The staged sync-key target changed before its exact write');
        }
        await writeConfiguredSyncEnvelope(targetEnvelope);
      },
      promoteLocal: async () => {
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

        const persistence = await saveConfigDurably({ allowDebouncedPush: false });
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
          const error = new Error(
            `The remote rewrite committed, but local key promotion could not be saved: ${persistence.error}`
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

async function readCloudFileEnvelope(filePath) {
  if (!filePath) {
    return { exists: false, envelope: null };
  }

  try {
    const stats = await fs.promises.stat(filePath);
    if (!stats.isFile()) {
      throw new Error('Selected sync path is not a file');
    }
    if (stats.size > PROFILE_SYNC_MAX_FILE_BYTES) {
      throw new Error('Sync file exceeds size limit (512 KB)');
    }
    const raw = await fs.promises.readFile(filePath, 'utf8');
    const envelope = profileSyncCore.parseSyncEnvelope(raw);
    return { exists: true, envelope };
  } catch (error) {
    if (error && error.code === 'ENOENT') {
      await requireExistingSyncParentDirectory(filePath, fs);
      return { exists: false, envelope: null };
    }
    throw error;
  }
}

async function writeCloudFileEnvelope(filePath, envelope) {
  if (!filePath) {
    throw new Error('Sync file path is not configured');
  }
  const serialized = profileSyncCore.serializeSyncEnvelope(envelope);
  await requireExistingSyncParentDirectory(filePath, fs);
  const tempPath = `${filePath}.tmp-${Date.now()}`;
  try {
    await fs.promises.writeFile(tempPath, serialized, 'utf8');
    await fs.promises.rename(tempPath, filePath);
  } catch (error) {
    await fs.promises.unlink(tempPath).catch(() => {});
    throw error;
  }
}

async function copyProfileSyncFile(fromPath, toPath, overwrite = false) {
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
      return { ok: false, status: 'error', error: 'Source sync file is not a file' };
    }

    await requireExistingSyncParentDirectory(destinationPath, fs);
    try {
      const copyFlags = overwrite ? 0 : fs.constants.COPYFILE_EXCL;
      await fs.promises.copyFile(sourcePath, destinationPath, copyFlags);
      return { ok: true, status: 'copied', copied: true, overwritten: overwrite };
    } catch (error) {
      if (error?.code === 'EEXIST') {
        return { ok: false, status: 'destination_exists' };
      }
      throw error;
    }
  } catch (error) {
    return { ok: false, status: 'error', error: error?.message || String(error) };
  }
}

async function readConfiguredSyncEnvelope() {
  const profileSync = getProfileSyncConfig();
  if (!isProfileSyncProviderSupported(profileSync.provider)) {
    throw new Error('Unsupported profile sync provider');
  }
  return readCloudFileEnvelope(profileSync.cloudFilePath);
}

async function writeConfiguredSyncEnvelope(envelope) {
  const profileSync = getProfileSyncConfig();
  if (!isProfileSyncProviderSupported(profileSync.provider)) {
    throw new Error('Unsupported profile sync provider');
  }
  return writeCloudFileEnvelope(profileSync.cloudFilePath, envelope);
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
    currentResult = await readConfiguredSyncEnvelope();
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
  const filePath = getProfileSyncConfig().cloudFilePath;
  if (!filePath) return [];

  const folder = path.dirname(filePath);
  const baseName = path.basename(filePath, path.extname(filePath));
  try {
    const entries = await fs.promises.readdir(folder);
    return entries.filter(
      (entry) =>
        entry !== path.basename(filePath) &&
        entry.includes(baseName) &&
        PROFILE_SYNC_CONFLICT_PATTERNS.some((pattern) => pattern.test(entry))
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

async function buildLocalProfileEnvelope(
  updatedAt = profileSyncRuntime.localProfileUpdatedAt || new Date().toISOString()
) {
  const profileSync = getProfileSyncConfig();
  const syncScope = getActiveProfileSyncScope();
  const profile = profileSyncCore.projectSyncProfile(config, syncScope);
  const encrypt = !!profileSync.encryptionEnabled;
  const passphrase = getActiveProfileSyncPassphrase();
  if (encrypt && !passphrase) {
    throw new Error('A passphrase is required to sync encrypted profiles');
  }
  return profileSyncCore.buildSyncEnvelope({
    profile,
    updatedAt,
    updatedByDeviceId: profileSync.deviceId,
    syncScope,
    encrypt,
    passphrase,
  });
}

async function decodeEnvelopeProfile(envelope) {
  const passphrase = getActiveProfileSyncPassphrase();
  const profile = await profileSyncCore.decodeEnvelopeProfile(envelope, passphrase);
  const syncScope = profileSyncCore.extractSyncScopeFromEnvelope(envelope);
  return { profile, syncScope };
}

async function backupLocalProfileBeforePullApply(syncScope) {
  let backupDir;
  try {
    backupDir = path.join(app.getPath('userData'), PROFILE_SYNC_BACKUP_DIR_NAME);
    await fs.promises.mkdir(backupDir, { recursive: true });
    const normalizedScope = getNormalizedProfileSyncScopeValue(syncScope);
    const backup = {
      backedUpAt: new Date().toISOString(),
      syncScope: normalizedScope,
      profile: profileSyncCore.projectSyncProfile(config, normalizedScope),
    };
    await fs.promises.writeFile(
      path.join(backupDir, `local-profile-${Date.now()}.json`),
      JSON.stringify(backup, null, 2),
      'utf8'
    );
  } catch (error) {
    log.warn('Failed to back up local profile before applying remote sync:', error.message);
    throw new Error(
      `Remote profile was not applied because the local backup failed: ${error?.message || String(error)}`
    );
  }

  try {
    const entries = (await fs.promises.readdir(backupDir))
      .filter((name) => /^local-profile-\d+\.json$/.test(name))
      .sort();
    while (entries.length > PROFILE_SYNC_BACKUP_KEEP) {
      const oldest = entries.shift();
      await fs.promises.unlink(path.join(backupDir, oldest));
    }
  } catch (error) {
    log.warn(
      'Created local profile backup, but failed to prune older profile backups:',
      error.message
    );
  }
}

async function applySyncedProfileToConfig(syncedProfile, updatedAt, syncScopeValue = null) {
  const previous = config;
  const previousRuntimeTracking = {
    localProfileHash: profileSyncRuntime.localProfileHash,
    localProfileUpdatedAt: profileSyncRuntime.localProfileUpdatedAt,
    pendingPullEchoHash: profileSyncRuntime.pendingPullEchoHash,
  };
  const previousEncryptedTokenForRecovery = preservedEncryptedTokenForRecovery;
  const nextScope = getNormalizedProfileSyncScopeValue(
    syncScopeValue || previous?.profileSync?.syncScope
  );
  // Captured under nextScope (not the pre-pull scope) so it is directly
  // comparable to the hashes updateLocalProfileSyncTracking computes afterwards.
  const prePullHash = computeScopedProfileHash(
    profileSyncCore.projectSyncProfile(previous, nextScope),
    nextScope
  );
  const merged = profileSyncCore.mergeSyncedProfileIntoConfig(config, syncedProfile, nextScope);
  ensureDateTimeFormatConfigDefaults(merged);
  ensureProfileSyncConfigDefaults(merged);
  merged.profileSync = {
    ...previous.profileSync,
    syncScope: nextScope,
    profileUpdatedAt: updatedAt || new Date().toISOString(),
  };
  config = merged;
  pruneConfig(config);
  ensureDateTimeFormatConfigDefaults(config);
  ensureProfileSyncConfigDefaults(config);
  normalizeDesktopPinsConfig(config);

  const projected = profileSyncCore.projectSyncProfile(config, getActiveProfileSyncScope());
  profileSyncRuntime.localProfileHash = computeScopedProfileHash(
    projected,
    getActiveProfileSyncScope()
  );
  profileSyncRuntime.localProfileUpdatedAt = updatedAt || new Date().toISOString();
  profileSyncRuntime.pendingPullEchoHash =
    prePullHash === profileSyncRuntime.localProfileHash ? null : prePullHash;

  const persistence = await saveConfigDurably({ allowDebouncedPush: false });
  if (!persistence.success) {
    config = previous;
    Object.assign(profileSyncRuntime, previousRuntimeTracking);
    preservedEncryptedTokenForRecovery = previousEncryptedTokenForRecovery;
    throw new Error(`Failed to persist pulled profile: ${persistence.error}`);
  }

  const runtimeWarnings = [];
  await runPostSaveSideEffect(runtimeWarnings, 'synced main window settings', () =>
    applyMainWindowSettingSideEffects(previous, config)
  );
  await runPostSaveSideEffect(runtimeWarnings, 'synced runtime settings', () =>
    applyRuntimeConfigSideEffects(previous, config, 'profile sync pull')
  );
  await runPostSaveSideEffect(runtimeWarnings, 'synced desktop pin windows', () =>
    syncDesktopPinWindowsWithConfig()
  );
  await runPostSaveSideEffect(runtimeWarnings, 'synced desktop pin config broadcast', () =>
    broadcastDesktopPinConfigUpdate()
  );
  await runPostSaveSideEffect(runtimeWarnings, 'synced renderer config broadcast', () =>
    pushConfigToRenderer({
      persistenceWarnings: persistence.persistenceWarnings,
      runtimeWarnings,
    })
  );
  return { runtimeWarnings };
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
 * update is recognised by content — it reproduces the pre-pull profile exactly —
 * and the pulled fields are merged back over it.
 *
 * @param {object} pulledConfig config as it stood before this update, i.e. the pulled state
 * @returns {boolean} whether a stale update was detected and reversed
 */
function restoreProfileFromStalePullEcho(pulledConfig) {
  const prePullHash = profileSyncRuntime.pendingPullEchoHash;
  if (prePullHash === null || !pulledConfig) return false;

  // Scope comes from the pulled config, not the merged one: the stale update may
  // carry a stale syncScope too.
  const scope = getNormalizedProfileSyncScopeValue(pulledConfig?.profileSync?.syncScope);
  const incomingHash = computeScopedProfileHash(
    profileSyncCore.projectSyncProfile(config, scope),
    scope
  );
  if (incomingHash !== prePullHash) return false;

  config = profileSyncCore.mergeSyncedProfileIntoConfig(
    config,
    profileSyncCore.projectSyncProfile(pulledConfig, scope),
    scope
  );
  ensureProfileSyncConfigDefaults(config);
  config.profileSync.syncScope = scope;
  profileSyncRuntime.pendingPullEchoHash = null;
  log.debug('Reverted a renderer config update that predates the last profile sync pull');
  return true;
}

function updateLocalProfileSyncTracking({ allowDebouncedPush = true } = {}) {
  const profile = profileSyncCore.projectSyncProfile(config, getActiveProfileSyncScope());
  const nextHash = computeScopedProfileHash(profile, getActiveProfileSyncScope());
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
    // localProfileUpdatedAt deliberately stays on the pulled envelope's
    // timestamp: leaving it behind keeps the next auto sync from treating the
    // stale echo as the newer side and pushing it out.
    return;
  }

  profileSyncRuntime.pendingPullEchoHash = null;
  profileSyncRuntime.localProfileHash = nextHash;
  profileSyncRuntime.localProfileUpdatedAt = new Date().toISOString();
  if (config?.profileSync) {
    config.profileSync.profileUpdatedAt = profileSyncRuntime.localProfileUpdatedAt;
  }

  if (allowDebouncedPush) {
    scheduleDebouncedProfileSyncPush('config_change');
  }
}

/**
 * Selects and returns an appropriate tray icon image for the current platform.
 *
 * Searches common resource locations (including packaged resources when available) for platform-preferred icon files,
 * resizes the found image to the platform's tray size (16px on Windows, 24px otherwise), and returns a fallback generated
 * placeholder image if no icon is found.
 * @returns {Electron.NativeImage} The resolved and appropriately sized tray icon image.
 */
function resolveTrayIcon() {
  log.debug('Resolving tray icon');
  const preferIco = process.platform === 'win32';
  const traySize = preferIco ? 16 : 24;
  const names = preferIco ? ['icon.ico', 'icon.png'] : ['icon.png', 'icon.ico'];
  const searchRoots = [path.join(__dirname, 'build'), __dirname];

  if (app && app.isPackaged) {
    const resourcesPath = process.resourcesPath;
    if (resourcesPath) {
      searchRoots.push(resourcesPath);
      searchRoots.push(path.join(resourcesPath, 'build'));
      searchRoots.push(path.join(resourcesPath, '..', 'app.asar.unpacked', 'build'));
    }
  }

  const ensureTraySize = (image) => {
    if (!image || image.isEmpty()) return image;
    const { width, height } = image.getSize();
    if (width === traySize && height === traySize) return image;
    return image.resize({ width: traySize, height: traySize });
  };

  try {
    const exePath = app?.getPath ? app.getPath('exe') : process.execPath;
    if (exePath && fs.existsSync(exePath)) {
      const exeImage = nativeImage.createFromPath(exePath);
      if (exeImage && !exeImage.isEmpty()) {
        return ensureTraySize(exeImage);
      }
    }
  } catch (error) {
    log.warn('Unable to load tray icon from executable:', error.message);
  }

  const candidates = [];
  names.forEach((name) => {
    searchRoots.forEach((root) => {
      if (!root) return;
      candidates.push(path.join(root, name));
      candidates.push(path.join(root, 'icons', name));
    });
  });

  for (const candidate of candidates) {
    try {
      if (!candidate || !fs.existsSync(candidate)) continue;
      const image = nativeImage.createFromPath(candidate);
      if (image && !image.isEmpty()) {
        return ensureTraySize(image);
      }
    } catch (error) {
      log.warn('Failed to load tray icon', candidate, error.message);
    }
  }

  log.info('Tray icon not found. Using generated fallback icon.');
  return nativeImage
    .createFromDataURL(
      'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAA4AAAAPCAYAAADJViUEAAAAGElEQVQ4T2NkwAT/Gf4zjIGBoRAjGAgjGAgADt4C24gldLoAAAAASUVORK5CYII='
    )
    .resize({ width: traySize, height: traySize });
}

/**
 * Remove deprecated config keys from an object in place.
 * @param {Object} target
 * @returns {Object} The same object reference after pruning.
 */
function pruneConfig(target) {
  if (!target || typeof target !== 'object') return target;
  if (Object.prototype.hasOwnProperty.call(target, 'updateInterval')) {
    delete target.updateInterval;
  }
  if (Object.prototype.hasOwnProperty.call(target, 'filters')) {
    delete target.filters;
  }
  delete target.secureStoragePending;
  delete target.configRevision;
  delete target.configRecovery;
  delete target.persistenceWarnings;
  delete target.runtimeWarnings;
  return target;
}

function isPlaceholderOrEmptyToken(token) {
  return !token || token === HOME_ASSISTANT_TOKEN_PLACEHOLDER;
}

function hasRecoveryTokenBackup() {
  return !!preservedEncryptedTokenForRecovery;
}

function shouldPreserveRecoveryTokenForSave(configToSave) {
  if (!hasRecoveryTokenBackup()) return false;
  return isPlaceholderOrEmptyToken(configToSave?.homeAssistant?.token);
}

function quarantineCorruptConfig(configPath) {
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const quarantinePath = path.join(path.dirname(configPath), `config.corrupt.${timestamp}.json`);

  try {
    fs.renameSync(configPath, quarantinePath);
    log.error(`Invalid config moved aside for recovery: ${quarantinePath}`);
    return { success: true, path: quarantinePath };
  } catch (error) {
    log.error('Failed to preserve invalid config for recovery:', error);
    return { success: false, error: error?.message || String(error) };
  }
}

/**
 * Load the application's configuration into the in-memory `config` variable.
 *
 * Loads user configuration from the userData config.json, merges it with sensible defaults,
 * and performs necessary migrations and persistence. Specifically:
 * - Merges persisted values with defaults for window, UI, hotkeys, and alerts.
 * - If a token is stored as encrypted, attempts to decrypt it for runtime use; if decryption
 *   is unavailable or fails, preserves the encrypted token on disk and sets a placeholder
 *   in memory with a migration reason recorded.
 * - If a plaintext token from a pre-encryption version is detected, attempts to migrate it
 *   to encrypted storage (creating a backup before migration); if encryption is unavailable
 *   or encryption fails, records migration info and preserves plaintext as configured.
 * - If no user config exists, attempts to migrate a legacy config from the app directory,
 *   ensures the userData directory exists, and saves the initial config.
 *
 * Side effects:
 * - Mutates the module-level `config` variable.
 * - May call `saveConfig()` and `backupConfig()` to persist changes or backups.
 * - Logs migration and error information.
 */
function loadConfig(options = {}) {
  log.debug('Loading configuration');
  configRecoveryNotice = null;
  configWriteBlockedReason = '';
  const deferSecureStorage = !!options.deferSecureStorage;
  const userDataDir = app.getPath('userData');
  const configPath = path.join(userDataDir, 'config.json');
  preservedEncryptedTokenForRecovery = null;
  deferredHomeAssistantTokenDecryptPending = false;
  deferredPlaintextTokenMigrationPending = false;
  deferredProfileSyncPassphraseDecryptPending = false;

  // Default configuration
  const defaultConfig = {
    windowPosition: { x: 100, y: 100 },
    windowSize: { width: 500, height: 600 },
    alwaysOnTop: true,
    opacity: 0.95,
    frostedGlass: true,
    homeAssistant: {
      url: 'http://homeassistant.local:8123',
      token: 'YOUR_LONG_LIVED_ACCESS_TOKEN',
      authMethod: 'token',
    },
    desktopCompanion: {
      desktopId: '',
    },
    haProfile: {
      activeProfileId: '',
      revision: 0,
      appliedAt: '',
    },
    globalHotkeys: {
      enabled: false,
      hotkeys: {}, // entityId -> hotkey combination
    },
    entityAlerts: {
      enabled: false,
      alerts: {}, // entityId -> alert configuration
    },
    ui: {
      theme: 'auto',
      accent: 'original',
      background: 'original',
      language: 'auto',
      customColors: [],
      density: 'comfortable',
      activeTileGlow: true,
      personalizationSectionsCollapsed: {},
      use24HourClock: false,
      timeFormat: 'system',
      dateFormat: 'weekday-short',
      weatherEffectsEnabled: false,
      weatherOverride: 'auto',
      enableInteractionDebugLogs: false,
    },
    primaryCards: ['weather', 'time'],
    favoriteEntities: [],
    customTabs: [],
    activeTabId: '',
    comparisonGraphs: [],
    desktopPins: {},
    customEntityIcons: {},
    quickAccessTileOptions: {},
    updates: {
      allowPrerelease: false,
    },
    popupHotkey: '', // Global hotkey to temporarily bring window to front while held
    popupHotkeyHideOnRelease: false, // Hide window when popup hotkey is released (instead of just restoring z-order)
    popupHotkeyToggleMode: false, // Press once to show, press again to hide (instead of hold)
    profileSync: getDefaultProfileSyncConfig(),
  };

  try {
    if (fs.existsSync(configPath)) {
      let userConfig;
      let serializedConfig;
      try {
        serializedConfig = fs.readFileSync(configPath, 'utf8');
      } catch (error) {
        configWriteBlockedReason = `The existing config could not be read safely: ${error?.message || String(error)}`;
        lastConfigWriteError = configWriteBlockedReason;
        configRecoveryNotice = {
          recovered: false,
          backupPath: '',
          error: configWriteBlockedReason,
        };
        throw error;
      }
      try {
        userConfig = JSON.parse(serializedConfig);
        if (!isPlainObject(userConfig)) {
          throw new SyntaxError('Configuration root must be a JSON object');
        }
      } catch (error) {
        log.error('Configuration could not be parsed:', error.message);
        const recovery = quarantineCorruptConfig(configPath);
        config = defaultConfig;
        pruneConfig(config);
        ensureDateTimeFormatConfigDefaults(config);
        ensureProfileSyncConfigDefaults(config);
        ensureUpdateConfigDefaults(config);
        ensureHaProfileConfigDefaults(config);
        normalizeDesktopPinsConfig(config);

        if (recovery.success) {
          const scheduled = saveConfig();
          const persisted = scheduled
            ? flushPendingConfigWriteSync({ shutdown: false })
            : {
                success: false,
                error: lastConfigWriteError || 'Failed to schedule recovered config save',
              };
          configRecoveryNotice = {
            recovered: persisted.success,
            backupPath: recovery.path,
            error: persisted.success ? '' : persisted.error,
          };
        } else {
          lastConfigWriteError = `The existing config is invalid and could not be moved aside: ${recovery.error}`;
          configWriteBlockedReason = lastConfigWriteError;
          configRecoveryNotice = {
            recovered: false,
            backupPath: '',
            error: lastConfigWriteError,
          };
        }

        refreshProfileSyncRuntimeTracking();
        return;
      }
      config = {
        ...defaultConfig,
        ...userConfig,
        homeAssistant: { ...defaultConfig.homeAssistant, ...(userConfig.homeAssistant || {}) },
        desktopCompanion: {
          ...defaultConfig.desktopCompanion,
          ...(userConfig.desktopCompanion || {}),
        },
        haProfile: { ...defaultConfig.haProfile, ...(userConfig.haProfile || {}) },
        globalHotkeys: { ...defaultConfig.globalHotkeys, ...(userConfig.globalHotkeys || {}) },
        entityAlerts: { ...defaultConfig.entityAlerts, ...(userConfig.entityAlerts || {}) },
        ui: { ...defaultConfig.ui, ...(userConfig.ui || {}) },
        profileSync: { ...defaultConfig.profileSync, ...(userConfig.profileSync || {}) },
        updates: { ...defaultConfig.updates, ...(userConfig.updates || {}) },
      };
      normalizeDesktopPinsConfig(config);
      pruneConfig(config);
      if (typeof config.ui?.language !== 'string' || !config.ui.language.trim()) {
        config.ui.language = 'auto';
      }
      ensureDateTimeFormatConfigDefaults(config, {
        migrateLegacyClock: !Object.prototype.hasOwnProperty.call(
          userConfig.ui || {},
          'timeFormat'
        ),
      });
      ensureProfileSyncConfigDefaults(config);
      ensureUpdateConfigDefaults(config);
      ensureHaProfileConfigDefaults(config);

      // OAuth access tokens are short-lived runtime state. Ignore any stale copy
      // that an earlier development build may have put in config.json.
      if (config.homeAssistant?.authMethod === 'oauth') {
        config.homeAssistant.token = HOME_ASSISTANT_TOKEN_PLACEHOLDER;
        config.homeAssistant.tokenEncrypted = false;
        config.homeAssistant.oauthStatus = 'restoring';
        delete config.tokenResetReason;
      } else if (config.homeAssistant?.tokenEncrypted && config.homeAssistant?.token) {
        if (deferSecureStorage) {
          preservedEncryptedTokenForRecovery = config.homeAssistant.token;
          config.homeAssistant.token = HOME_ASSISTANT_TOKEN_PLACEHOLDER;
          deferredHomeAssistantTokenDecryptPending = true;
        } else {
          // Token is marked as encrypted, decrypt it
          log.debug('Attempting to decrypt stored token...');
          try {
            log.debug('Checking if encryption is available...');
            const encryptionAvailable = safeStorage.isEncryptionAvailable();
            log.debug(`Encryption available: ${encryptionAvailable}`);

            if (encryptionAvailable) {
              log.debug('Decrypting token...');
              const encryptedBuffer = Buffer.from(config.homeAssistant.token, 'base64');
              config.homeAssistant.token = safeStorage.decryptString(encryptedBuffer);
              preservedEncryptedTokenForRecovery = null;
              log.info('Token decrypted successfully');
            } else {
              // Encryption not available - preserve encrypted token on disk but set in-memory token to default
              log.warn(
                'Encryption not available on this system. Encrypted token cannot be decrypted.'
              );
              log.warn(
                'Token preserved on disk. User must re-enter token or use on a system with encryption support.'
              );
              preservedEncryptedTokenForRecovery = config.homeAssistant.token;
              config.homeAssistant.token = HOME_ASSISTANT_TOKEN_PLACEHOLDER; // In-memory default for UI
              config.tokenResetReason = 'encryption_unavailable';
              // Don't save config here - this preserves the encrypted token on disk as a backup
              log.info(
                'Encrypted token preserved in config file. If encryption becomes available, it can be decrypted.'
              );
            }
          } catch (error) {
            // Decryption failed - token may be corrupted or encryption API failed
            log.error('Exception during token decryption:', error);
            log.warn('Encrypted token preserved on disk. User must re-enter token.');
            preservedEncryptedTokenForRecovery = config.homeAssistant.token;
            config.homeAssistant.token = HOME_ASSISTANT_TOKEN_PLACEHOLDER; // In-memory default for UI
            config.tokenResetReason = 'decryption_failed';
            // Don't save config here - this preserves the encrypted token on disk
            log.info('Encrypted token preserved in config file for recovery attempts.');
          }
        }
      } else if (
        config.homeAssistant?.token &&
        config.homeAssistant.token !== HOME_ASSISTANT_TOKEN_PLACEHOLDER &&
        !config.homeAssistant?.tokenEncrypted
      ) {
        if (deferSecureStorage) {
          deferredPlaintextTokenMigrationPending = true;
        } else {
          // Migration: existing plaintext token from pre-encryption version
          log.info(
            'Detected plaintext token from pre-encryption version - attempting migration...'
          );

          // Create backup before migration
          backupConfig();

          try {
            log.debug('Checking if encryption is available for migration...');
            const encryptionAvailable = safeStorage.isEncryptionAvailable();
            log.debug(`Encryption available for migration: ${encryptionAvailable}`);

            if (encryptionAvailable) {
              log.info('Migrating plaintext token to encrypted storage...');
              try {
                config.homeAssistant.tokenEncrypted = true;
                config.migrationInfo = {
                  version: app.getVersion(),
                  date: new Date().toISOString(),
                  tokenEncrypted: true,
                };
                log.debug('Saving encrypted config...');
                // buildConfigSnapshotForSave owns encryption. Keeping plaintext
                // in memory here avoids encrypting the already-encrypted base64
                // a second time when the snapshot is built.
                const migrationSnapshot = saveConfig();
                if (
                  !migrationSnapshot ||
                  migrationSnapshot.persistenceWarnings?.some(
                    (warning) => warning.code === 'home_assistant_token_not_persisted'
                  )
                ) {
                  throw new Error(lastConfigWriteError || 'Token encryption failed');
                }
                log.info('Token migration complete - token is now encrypted at rest');
              } catch (error) {
                log.error('Exception during token encryption:', error);
                log.warn(
                  'Token encryption failed; token will stay in memory for this session and be omitted from saved config'
                );
                // Keep the in-memory token for this session and set a flag to prevent retry.
                config.homeAssistant.tokenEncrypted = false;
                config.migrationInfo = {
                  version: app.getVersion(),
                  date: new Date().toISOString(),
                  tokenEncrypted: false,
                  reason: 'encryption_failed',
                };
                saveConfig(); // Persist the flag without writing the plaintext token.
                log.info('Token omitted from saved config until it can be re-entered or encrypted');
              }
            } else {
              log.info(
                'Encryption not available; token will stay in memory for this session and be omitted from saved config'
              );
              // Keep the in-memory token for this session and set a flag to prevent retry.
              config.homeAssistant.tokenEncrypted = false;
              config.migrationInfo = {
                version: app.getVersion(),
                date: new Date().toISOString(),
                tokenEncrypted: false,
                reason: 'encryption_unavailable',
              };
              saveConfig(); // Persist the flag without writing the plaintext token.
              log.info('Token omitted from saved config until it can be re-entered or encrypted');
            }
          } catch (error) {
            // Catch any unexpected errors during migration check
            log.error('Unexpected error during migration check:', error);
            log.warn(
              'Migration aborted; token will stay in memory for this session and be omitted from saved config'
            );
            config.homeAssistant.tokenEncrypted = false;
            config.migrationInfo = {
              version: app.getVersion(),
              date: new Date().toISOString(),
              tokenEncrypted: false,
              reason: 'migration_error',
            };
            saveConfig();
          }
        }
      }
    } else {
      // Migrate legacy config if present in app directory
      const legacyPath = path.join(__dirname, 'config.json');
      let migrated = false;
      if (fs.existsSync(legacyPath)) {
        try {
          const legacyConfig = JSON.parse(fs.readFileSync(legacyPath, 'utf8'));
          config = { ...defaultConfig, ...legacyConfig };
          pruneConfig(config);
          ensureDateTimeFormatConfigDefaults(config, {
            migrateLegacyClock: !Object.prototype.hasOwnProperty.call(
              legacyConfig.ui || {},
              'timeFormat'
            ),
          });
          ensureProfileSyncConfigDefaults(config);
          ensureUpdateConfigDefaults(config);
          normalizeDesktopPinsConfig(config);
          migrated = true;
        } catch (error) {
          log.warn('Legacy config exists but could not be parsed, using defaults:', error.message);
          config = defaultConfig;
        }
      } else {
        config = defaultConfig;
      }
      ensureDateTimeFormatConfigDefaults(config);
      ensureProfileSyncConfigDefaults(config);
      ensureUpdateConfigDefaults(config);
      normalizeDesktopPinsConfig(config);
      // Ensure directory exists and persist
      fs.mkdirSync(userDataDir, { recursive: true });
      saveConfig();
      if (migrated) {
        log.info('Migrated legacy config.json to userData.');
      }
    }
  } catch (error) {
    log.error('Error loading config:', error);
    if (!configWriteBlockedReason && fs.existsSync(configPath)) {
      configWriteBlockedReason = `The existing config could not be normalized safely: ${error?.message || String(error)}`;
      lastConfigWriteError = configWriteBlockedReason;
      configRecoveryNotice = {
        recovered: false,
        backupPath: '',
        error: configWriteBlockedReason,
      };
    }
    config = defaultConfig;
    pruneConfig(config);
    ensureDateTimeFormatConfigDefaults(config);
    ensureProfileSyncConfigDefaults(config);
    ensureUpdateConfigDefaults(config);
    normalizeDesktopPinsConfig(config);
  }

  deferredProfileSyncPassphraseDecryptPending = !!(
    deferSecureStorage &&
    config?.profileSync?.rememberPassphrase &&
    config?.profileSync?.storedPassphrase &&
    config?.profileSync?.passphraseEncrypted
  );
  if (deferredProfileSyncPassphraseDecryptPending) {
    profileSyncRuntime.passphraseSession = '';
    profileSyncRuntime.passphraseWarning = '';
    refreshProfileSyncRuntimeTracking({ decodePassphrase: false });
  } else {
    refreshProfileSyncRuntimeTracking();
  }
}

function enableDevelopmentClimateDemo() {
  if (!IS_CLIMATE_DEMO_MODE) return;

  config = {
    ...config,
    homeAssistant: {
      url: '',
      token: HOME_ASSISTANT_TOKEN_PLACEHOLDER,
    },
    favoriteEntities: ['climate.demo_air_conditioner'],
    customTabs: [],
    activeTabId: '',
    desktopPins: {},
    globalHotkeys: { enabled: false, hotkeys: {} },
    entityAlerts: { enabled: false, alerts: {} },
    profileSync: { ...getDefaultProfileSyncConfig(), enabled: false },
  };
}

function resolveDeferredSecureConfig(options = {}) {
  if (deferredSecureConfigResolutionInProgress) return false;
  const notifyRenderer = !!options.notifyRenderer;
  const hasDeferredWork = hasDeferredSecureConfigWork();
  if (!hasDeferredWork) return false;

  deferredSecureConfigResolutionInProgress = true;
  let changed = false;

  try {
    if (deferredHomeAssistantTokenDecryptPending) {
      deferredHomeAssistantTokenDecryptPending = false;
      const encryptedToken = preservedEncryptedTokenForRecovery;
      if (encryptedToken) {
        try {
          if (safeStorage.isEncryptionAvailable()) {
            const encryptedBuffer = Buffer.from(encryptedToken, 'base64');
            config.homeAssistant = config.homeAssistant || {};
            config.homeAssistant.token = safeStorage.decryptString(encryptedBuffer);
            config.homeAssistant.tokenEncrypted = true;
            preservedEncryptedTokenForRecovery = null;
            changed = true;
            log.info('Token decrypted after initial window startup');
          } else {
            log.warn(
              'Encryption not available on this system. Encrypted token cannot be decrypted.'
            );
            config.homeAssistant = config.homeAssistant || {};
            config.homeAssistant.token = HOME_ASSISTANT_TOKEN_PLACEHOLDER;
            config.tokenResetReason = 'encryption_unavailable';
            changed = true;
          }
        } catch (error) {
          log.error('Exception during deferred token decryption:', error);
          config.homeAssistant = config.homeAssistant || {};
          config.homeAssistant.token = HOME_ASSISTANT_TOKEN_PLACEHOLDER;
          config.tokenResetReason = 'decryption_failed';
          changed = true;
        }
      }
    }

    if (deferredPlaintextTokenMigrationPending) {
      deferredPlaintextTokenMigrationPending = false;
      if (
        config.homeAssistant?.token &&
        config.homeAssistant.token !== HOME_ASSISTANT_TOKEN_PLACEHOLDER &&
        !config.homeAssistant?.tokenEncrypted
      ) {
        log.info('Detected plaintext token after startup - attempting migration...');
        backupConfig();

        try {
          if (safeStorage.isEncryptionAvailable()) {
            try {
              config.homeAssistant.tokenEncrypted = true;
              config.migrationInfo = {
                version: app.getVersion(),
                date: new Date().toISOString(),
                tokenEncrypted: true,
              };
              // Snapshot construction performs the one and only encryption,
              // while the runtime value remains plaintext.
              const migrationSnapshot = saveConfig();
              if (
                !migrationSnapshot ||
                migrationSnapshot.persistenceWarnings?.some(
                  (warning) => warning.code === 'home_assistant_token_not_persisted'
                )
              ) {
                throw new Error(lastConfigWriteError || 'Token encryption failed');
              }
              changed = true;
              log.info('Deferred token migration complete - token is now encrypted at rest');
            } catch (error) {
              log.error('Exception during deferred token encryption:', error);
              config.homeAssistant.tokenEncrypted = false;
              config.migrationInfo = {
                version: app.getVersion(),
                date: new Date().toISOString(),
                tokenEncrypted: false,
                reason: 'encryption_failed',
              };
              saveConfig();
              changed = true;
            }
          } else {
            config.homeAssistant.tokenEncrypted = false;
            config.migrationInfo = {
              version: app.getVersion(),
              date: new Date().toISOString(),
              tokenEncrypted: false,
              reason: 'encryption_unavailable',
            };
            saveConfig();
            changed = true;
          }
        } catch (error) {
          log.error('Unexpected error during deferred token migration:', error);
          config.homeAssistant.tokenEncrypted = false;
          config.migrationInfo = {
            version: app.getVersion(),
            date: new Date().toISOString(),
            tokenEncrypted: false,
            reason: 'migration_error',
          };
          saveConfig();
          changed = true;
        }
      }
    }

    if (deferredProfileSyncPassphraseDecryptPending) {
      deferredProfileSyncPassphraseDecryptPending = false;
      profileSyncRuntime.passphraseSession = decodeStoredProfileSyncPassphrase() || '';
      changed = true;
    }

    refreshProfileSyncRuntimeTracking({ decodePassphrase: false });

    if (changed && notifyRenderer) {
      pushConfigToRenderer();
      broadcastDesktopPinConfigUpdate();
      emitProfileSyncStatus();
    }

    return changed;
  } finally {
    deferredSecureConfigResolutionInProgress = false;
  }
}

function getSafeConfigBackupLabel(reason) {
  const label = typeof reason === 'string' && reason.trim() ? reason.trim() : 'backup';
  return (
    label
      .replace(/[^a-zA-Z0-9._-]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 48) || 'backup'
  );
}

// Backup configuration before migration or first write in a process.
function backupConfig(reason = 'migration') {
  const userDataDir = app.getPath('userData');
  const configPath = path.join(userDataDir, 'config.json');
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const backupLabel = getSafeConfigBackupLabel(reason);
  const backupPath = path.join(userDataDir, 'config.backup.json');
  const timestampedBackupPath = path.join(userDataDir, `config.${backupLabel}.${timestamp}.json`);
  try {
    if (fs.existsSync(configPath)) {
      const configContent = fs.readFileSync(configPath, 'utf8');
      fs.writeFileSync(timestampedBackupPath, configContent);
      fs.writeFileSync(backupPath, configContent);
      log.info('Config backup created at', timestampedBackupPath);
      return true;
    }
  } catch (error) {
    log.warn('Failed to create config backup:', error);
  }
  return false;
}

function ensureConfigBackupBeforeFirstWrite(reason = 'pre-save') {
  if (configBackupCreatedThisRun) return;
  configBackupCreatedThisRun = backupConfig(reason);
}

function shouldBlockPotentialConfigClobber() {
  // Authorized mutations may intentionally clear the last favorite, pin,
  // token, or custom page. Only an unsafe config load arms the write block;
  // shape/content heuristics cannot distinguish those valid clears.
  return shouldBlockConfigWrite({ blockedReason: configWriteBlockedReason });
}

/**
 * Persist the in-memory configuration to the user's config.json and attempt to secure the Home Assistant token.
 *
 * Writes the current `config` object to the application's userData/config.json. If `homeAssistant.token` is present
 * and not the placeholder value, this function attempts to encrypt the token using Electron's `safeStorage`; on
 * successful encryption the token is stored as a base64 string and `homeAssistant.tokenEncrypted` is set to `true`.
 * If encryption is unavailable or fails, the token is omitted from the saved config and `tokenResetReason` is recorded.
 * The in-memory `config` remains unchanged with the token kept in plaintext for runtime use. Errors during the save
 * process are logged; the function does not throw.
 */
function buildConfigSnapshotForSave() {
  if (configWriteBlockedReason) {
    throw new Error(configWriteBlockedReason);
  }
  const userDataDir = app.getPath('userData');
  const configPath = path.join(userDataDir, 'config.json');
  const snapshotVersion = ++configSnapshotVersion;
  const tempPath = `${configPath}.${snapshotVersion}.tmp`;

  ensureConfigBackupBeforeFirstWrite('pre-save');

  // Create a copy for saving with encrypted token
  const configToSave = JSON.parse(JSON.stringify(config));
  pruneConfig(configToSave);
  const usesOAuth = configToSave.homeAssistant?.authMethod === 'oauth';
  const preserveRecoveryToken = !usesOAuth && shouldPreserveRecoveryTokenForSave(configToSave);
  const persistenceWarnings = [];

  if (usesOAuth) {
    delete configToSave.homeAssistant.token;
    delete configToSave.homeAssistant.tokenEncrypted;
    delete configToSave.homeAssistant.oauthExpiresAt;
    delete configToSave.homeAssistant.oauthLastError;
    delete configToSave.tokenResetReason;
  }

  if (preserveRecoveryToken) {
    configToSave.homeAssistant = configToSave.homeAssistant || {};
    configToSave.homeAssistant.token = preservedEncryptedTokenForRecovery;
    configToSave.homeAssistant.tokenEncrypted = true;
  }

  const omitTokenFromSavedConfig = (reason, warning, error = null) => {
    configToSave.homeAssistant = configToSave.homeAssistant || {};
    delete configToSave.homeAssistant.token;
    configToSave.homeAssistant.tokenEncrypted = false;
    configToSave.tokenResetReason = reason;
    config.tokenResetReason = reason;
    if (!persistenceWarnings.some((entry) => entry.code === 'home_assistant_token_not_persisted')) {
      persistenceWarnings.push({
        code: 'home_assistant_token_not_persisted',
        error: error?.message || '',
      });
    }
    if (error) {
      log.warn(warning, error);
    } else {
      log.warn(warning);
    }
  };

  // Encrypt token before saving
  // Note: Token is always stored as plaintext in memory (even if decrypted from encrypted storage)
  if (
    !usesOAuth &&
    configToSave.homeAssistant?.token &&
    configToSave.homeAssistant.token !== HOME_ASSISTANT_TOKEN_PLACEHOLDER
  ) {
    if (preserveRecoveryToken) {
      log.debug('Preserving encrypted recovery token for storage');
    } else if (safeStorage.isEncryptionAvailable()) {
      try {
        const plainToken = configToSave.homeAssistant.token;
        const encryptedBuffer = safeStorage.encryptString(plainToken);
        configToSave.homeAssistant.token = encryptedBuffer.toString('base64');
        configToSave.homeAssistant.tokenEncrypted = true;
        log.debug('Token encrypted for storage');
      } catch (error) {
        omitTokenFromSavedConfig(
          'encryption_unavailable',
          'Failed to encrypt token; omitting it from saved config so it is not written in plaintext:',
          error
        );
      }
    } else {
      omitTokenFromSavedConfig(
        'encryption_unavailable',
        'Encryption not available; omitting token from saved config so it is not written in plaintext'
      );
    }
  }

  return {
    userDataDir,
    configPath,
    tempPath,
    snapshotVersion,
    epoch: configWriteEpoch,
    configToSave,
    serializedConfig: JSON.stringify(configToSave, null, 2),
    persistenceWarnings,
  };
}

async function writeConfigSnapshotAsync(snapshot) {
  try {
    if (shouldBlockPotentialConfigClobber(snapshot)) {
      throw new Error(configWriteBlockedReason || 'Configuration writes are blocked');
    }
    await fs.promises.mkdir(snapshot.userDataDir, { recursive: true });
    await fs.promises.writeFile(snapshot.tempPath, snapshot.serializedConfig, 'utf8');
    if (
      !canCommitSnapshot(snapshot, {
        shutdownPending: configShutdownPending,
        currentEpoch: configWriteEpoch,
      })
    ) {
      await fs.promises.unlink(snapshot.tempPath).catch(() => {});
      return { written: false };
    }
    // Keep the epoch check and final atomic replacement in the same JavaScript turn.
    // If this were an awaited async rename, restart/before-quit could sync-write a newer
    // snapshot while the older rename was already queued, then the old write could win
    // after shutdown. The local rename is tiny and closes that race.
    fs.renameSync(snapshot.tempPath, snapshot.configPath);
    return { written: true };
  } catch (error) {
    await fs.promises.unlink(snapshot.tempPath).catch(() => {});
    throw error;
  }
}

function emitConfigPersistenceWarnings(warnings = []) {
  if (!Array.isArray(warnings) || warnings.length === 0) return;
  if (!mainWindow || mainWindow.isDestroyed()) return;

  const safeWarnings = warnings
    .filter((warning) => warning && typeof warning.code === 'string')
    .map((warning) => ({
      code: warning.code,
      error: typeof warning.error === 'string' ? warning.error : '',
    }));
  if (!safeWarnings.length) return;

  const signature = safeWarnings
    .map((warning) => warning.code)
    .sort()
    .join('|');
  const now = Date.now();
  if (
    signature === lastConfigPersistenceWarningSignature &&
    now - lastConfigPersistenceWarningAt < 30000
  ) {
    return;
  }
  lastConfigPersistenceWarningSignature = signature;
  lastConfigPersistenceWarningAt = now;
  mainWindow.webContents.send('config-persistence-warning', safeWarnings);
}

async function runPostSaveSideEffect(runtimeWarnings, context, sideEffect) {
  try {
    return await sideEffect();
  } catch (error) {
    const message = error?.message || String(error);
    log.warn(`Failed to apply ${context} after configuration was saved:`, message);
    runtimeWarnings.push({
      code: 'runtime_side_effect_failed',
      context,
      error: message,
    });
    return null;
  }
}

function flushConfigWriteQueue() {
  if (configWriteInFlight) return;
  if (!pendingConfigSnapshot) return;

  const snapshot = pendingConfigSnapshot;
  pendingConfigSnapshot = null;
  configWriteInFlight = true;
  lastConfigWriteError = null;

  writeConfigSnapshotAsync(snapshot)
    .then((writeResult) => {
      if (!writeResult?.written) return;
      lastConfigWriteError = null;
      configWriteAcknowledgements.complete(snapshot.snapshotVersion, { success: true });
    })
    .catch((error) => {
      log.error('Failed to save config asynchronously:', error);
      lastConfigWriteError = error?.message || String(error);
      // A newer queued snapshot contains this mutation too, so give it a chance
      // to satisfy the durable acknowledgement. Only fail now when there is no
      // superseding snapshot left to persist.
      configWriteAcknowledgements.complete(
        snapshot.snapshotVersion,
        {
          success: false,
          error: lastConfigWriteError,
        },
        { hasSupersedingSnapshot: !!pendingConfigSnapshot }
      );
    })
    .finally(() => {
      configWriteInFlight = false;
      if (pendingConfigSnapshot) {
        flushConfigWriteQueue();
      }
    });
}

function flushPendingConfigWriteSync(options = {}) {
  const shutdown = options.shutdown !== false;
  configShutdownPending = shutdown;
  // Invalidate any older in-flight async write attempts before flushing latest config.
  configWriteEpoch += 1;

  if (configWriteTimer) {
    clearTimeout(configWriteTimer);
    configWriteTimer = null;
  }

  let snapshot = pendingConfigSnapshot;
  pendingConfigSnapshot = null;

  if (!snapshot) {
    try {
      snapshot = buildConfigSnapshotForSave();
    } catch (error) {
      log.error('Failed to build config snapshot for sync flush:', error);
      lastConfigWriteError = error?.message || String(error);
      const result = { success: false, error: lastConfigWriteError };
      configWriteAcknowledgements.failAll(lastConfigWriteError);
      return result;
    }
  }

  try {
    if (shouldBlockPotentialConfigClobber(snapshot)) {
      throw new Error(
        'Blocked synchronous config save because it would replace an existing user config with default-like data.'
      );
    }
    fs.mkdirSync(snapshot.userDataDir, { recursive: true });
    fs.writeFileSync(snapshot.tempPath, snapshot.serializedConfig, 'utf8');
    fs.renameSync(snapshot.tempPath, snapshot.configPath);
    lastConfigWriteError = null;
    const result = { success: true };
    configWriteAcknowledgements.complete(snapshot.snapshotVersion, result);
    return result;
  } catch (error) {
    log.error('Failed to flush config synchronously:', error);
    lastConfigWriteError = error?.message || String(error);
    try {
      if (snapshot?.tempPath && fs.existsSync(snapshot.tempPath)) {
        fs.unlinkSync(snapshot.tempPath);
      }
    } catch {
      // best effort cleanup
    }
    const result = { success: false, error: lastConfigWriteError };
    configWriteAcknowledgements.failAll(lastConfigWriteError);
    return result;
  }
}

function saveConfig(options = {}) {
  log.debug('Scheduling configuration save');
  try {
    // Track first so profileSync.profileUpdatedAt lands in this snapshot
    // rather than trailing one save behind.
    updateLocalProfileSyncTracking({
      allowDebouncedPush: options.allowDebouncedPush !== false,
    });
    pendingConfigSnapshot = buildConfigSnapshotForSave();
    const scheduledSnapshot = pendingConfigSnapshot;
    emitConfigPersistenceWarnings(scheduledSnapshot.persistenceWarnings);
    if (configWriteTimer) {
      clearTimeout(configWriteTimer);
    }
    configWriteTimer = setTimeout(() => {
      configWriteTimer = null;
      flushConfigWriteQueue();
    }, CONFIG_SAVE_DEBOUNCE_MS);
    return scheduledSnapshot;
  } catch (error) {
    log.error('Failed to schedule config save:', error);
    lastConfigWriteError = error?.message || String(error);
    return false;
  }
}

async function saveConfigDurably(options = {}) {
  const previousRuntimeTracking = {
    localProfileHash: profileSyncRuntime.localProfileHash,
    localProfileUpdatedAt: profileSyncRuntime.localProfileUpdatedAt,
    pendingPullEchoHash: profileSyncRuntime.pendingPullEchoHash,
  };
  const previousProfileUpdatedAt = config?.profileSync?.profileUpdatedAt ?? null;
  const hadTokenResetReason = Object.prototype.hasOwnProperty.call(
    config || {},
    'tokenResetReason'
  );
  const previousTokenResetReason = config?.tokenResetReason;
  const restoreSaveSideEffects = () => {
    Object.assign(profileSyncRuntime, previousRuntimeTracking);
    if (config?.profileSync) {
      config.profileSync.profileUpdatedAt = previousProfileUpdatedAt;
    }
    if (hadTokenResetReason) {
      config.tokenResetReason = previousTokenResetReason;
    } else {
      delete config.tokenResetReason;
    }
  };
  const scheduledSnapshot = saveConfig({ allowDebouncedPush: false });
  if (!scheduledSnapshot) {
    restoreSaveSideEffects();
    return {
      success: false,
      error: lastConfigWriteError || 'Failed to schedule configuration save',
    };
  }

  if (configWriteTimer) {
    clearTimeout(configWriteTimer);
    configWriteTimer = null;
  }

  const completion = configWriteAcknowledgements.waitFor(scheduledSnapshot.snapshotVersion);
  flushConfigWriteQueue();
  const result = await completion;
  if (!result.success) {
    restoreSaveSideEffects();
    return result;
  }
  if (
    options.allowDebouncedPush !== false &&
    profileSyncRuntime.localProfileHash !== previousRuntimeTracking.localProfileHash
  ) {
    scheduleDebouncedProfileSyncPush('config_change');
  }
  return {
    ...result,
    persistenceWarnings: [...(scheduledSnapshot.persistenceWarnings || [])],
  };
}

function emitProfileSyncStatus(extra = {}) {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  mainWindow.webContents.send('profile-sync-status', buildProfileSyncStatus(extra));
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
    !profileSync.cloudFilePath
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

async function prepareProfileSyncFirstEnableResolution() {
  const profileSync = getProfileSyncConfig();
  profileSyncRuntime.needsResolution = false;
  profileSyncRuntime.pendingRemoteEnvelope = null;
  profileSyncRuntime.pendingRemoteIdentity = null;

  if (!profileSync.enabled || !profileSync.cloudFilePath) {
    return { needsResolution: false };
  }

  const readResult = await readConfiguredSyncEnvelope();
  profileSyncRuntime.pendingRemoteIdentity = getSyncEnvelopeIdentity(readResult);
  if (!readResult.exists || !readResult.envelope) {
    return { needsResolution: false };
  }

  const { profile: remoteProfile, syncScope } = await decodeEnvelopeProfile(readResult.envelope);
  const localProfile = profileSyncCore.projectSyncProfile(config, syncScope);
  const localHash = computeScopedProfileHash(localProfile, syncScope);
  const remoteHash = computeScopedProfileHash(remoteProfile, syncScope);
  if (remoteHash === localHash) {
    return { needsResolution: false };
  }

  profileSyncRuntime.needsResolution = true;
  profileSyncRuntime.pendingRemoteEnvelope = readResult.envelope;
  profileSyncRuntime.pendingRemoteIdentity = getSyncEnvelopeIdentity(readResult);
  updateProfileSyncStatus(
    'needs_resolution',
    'Choose how to resolve initial profile sync conflict.'
  );
  emitProfileSyncStatus();
  return { needsResolution: true };
}

function getSyncEnvelopeIdentity(readResult) {
  if (!readResult?.exists || !readResult.envelope) return 'missing';
  return nodeCrypto
    .createHash('sha256')
    .update(profileSyncCore.serializeSyncEnvelope(readResult.envelope))
    .digest('hex');
}

async function prepareRemoteRewriteBaseline(passphrase, baselineConfig = config) {
  const readResult = await readConfiguredSyncEnvelope();
  if (readResult.exists && readResult.envelope) {
    const remoteProfile = await profileSyncCore.decodeEnvelopeProfile(
      readResult.envelope,
      passphrase
    );
    const syncScope = profileSyncCore.extractSyncScopeFromEnvelope(readResult.envelope);
    const localProfile = profileSyncCore.projectSyncProfile(baselineConfig, syncScope);
    if (
      computeScopedProfileHash(remoteProfile, syncScope) !==
      computeScopedProfileHash(localProfile, syncScope)
    ) {
      throw new Error(
        'The remote profile has changes that are not present locally. Sync or resolve them before changing encryption.'
      );
    }
  }
  return getSyncEnvelopeIdentity(readResult);
}

async function verifyPendingRemoteEnvelopeUnchanged() {
  const expectedIdentity = profileSyncRuntime.pendingRemoteIdentity;
  if (!expectedIdentity) {
    throw new Error('The pending profile conflict is no longer available; retry conflict check');
  }
  const currentResult = await readConfiguredSyncEnvelope();
  const currentIdentity = getSyncEnvelopeIdentity(currentResult);
  if (currentIdentity !== expectedIdentity) {
    profileSyncRuntime.pendingRemoteEnvelope = currentResult.envelope;
    profileSyncRuntime.pendingRemoteIdentity = currentIdentity;
    profileSyncRuntime.needsResolution = true;
    updateProfileSyncStatus(
      'needs_resolution',
      'The remote profile changed while waiting for a choice. Review it and choose again.'
    );
    emitProfileSyncStatus();
    const error = new Error('The remote profile changed while waiting for conflict resolution');
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
  const persistence = await saveConfigDurably({ allowDebouncedPush: false });
  if (!persistence.success) {
    profileSync.firstEnableResolutionPending = true;
    throw new Error(`Failed to save profile sync conflict check: ${persistence.error}`);
  }
  return persistence;
}

async function completeProfileSyncFirstEnablePreparation(source) {
  const profileSync = getProfileSyncConfig();
  if (!profileSync.enabled || !profileSync.cloudFilePath) {
    clearProfileSyncTimers();
    return { ok: false, reason: 'not_configured', status: buildProfileSyncStatus() };
  }
  // Keep the durable gate armed through the first identity-checked write. If the
  // provider changes or fails, retry remains available and no conflict is
  // silently bypassed.
  const expectedRemoteIdentity = profileSyncRuntime.pendingRemoteIdentity;
  const result = await runProfileSyncInternal('push', source, { expectedRemoteIdentity });
  if (result?.ok !== true || result?.reason === 'remote_changed') {
    throw new Error(result?.error || result?.reason || 'Initial profile sync did not complete');
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
  if (!profileSync.cloudFilePath || !isProfileSyncProviderSupported(profileSync.provider)) return;

  if (profileSyncRuntime.pushDebounceTimer) {
    clearTimeout(profileSyncRuntime.pushDebounceTimer);
  }
  profileSyncRuntime.pushDebounceTimer = setTimeout(() => {
    profileSyncRuntime.pushDebounceTimer = null;
    runProfileSync('push', source).catch((error) => {
      log.warn('Debounced profile sync push failed:', error.message);
    });
  }, PROFILE_SYNC_PUSH_DEBOUNCE_MS);
}

const runCoalescedProfileSync = createLatestTaskCoalescer(
  (direction, source) =>
    runSerializedConfigMutation(() => runProfileSyncInternal(direction, source)),
  { getPriority: (args) => (args[1] === 'manual' ? 1 : 0) }
);

function runProfileSync(direction = 'auto', source = 'manual') {
  return runCoalescedProfileSync(direction, source);
}

async function runProfileSyncInternal(direction = 'auto', source = 'manual', options = {}) {
  const profileSync = getProfileSyncConfig();

  if (!profileSync.enabled) {
    return { ok: false, reason: 'disabled', status: buildProfileSyncStatus() };
  }
  if (!isProfileSyncProviderSupported(profileSync.provider)) {
    throw new Error('Unsupported profile sync provider');
  }
  if (!profileSync.cloudFilePath) {
    throw new Error('Profile sync file is not configured');
  }
  if (profileSync.passphraseTransition) {
    if (source === 'manual' || source === 'startup_rewrite_recovery') {
      return executePendingProfileSyncRewrite();
    }
    return { ok: false, reason: 'rewrite_pending', status: buildProfileSyncStatus() };
  }
  if (typeof profileSync.encryptionChangePending === 'boolean') {
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
      updateProfileSyncStatus('error', error?.message || String(error));
      emitProfileSyncStatus();
      throw error;
    }
  }
  if (profileSync.remoteRewritePending && source === 'manual') {
    try {
      const expectedRemoteIdentity = await prepareRemoteRewriteBaseline(
        getActiveProfileSyncPassphrase(),
        config
      );
      return await runProfileSyncInternal('push', 'remote_rewrite_retry', {
        expectedRemoteIdentity,
      });
    } catch (error) {
      updateProfileSyncStatus('error', error?.message || String(error));
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
    const localUpdatedAt = profileSyncRuntime.localProfileUpdatedAt || new Date().toISOString();
    const remoteResult = await readConfiguredSyncEnvelope();
    if (
      options.expectedRemoteIdentity &&
      getSyncEnvelopeIdentity(remoteResult) !== options.expectedRemoteIdentity
    ) {
      profileSyncRuntime.needsResolution = false;
      profileSyncRuntime.pendingRemoteEnvelope = remoteResult.envelope;
      profileSyncRuntime.pendingRemoteIdentity = getSyncEnvelopeIdentity(remoteResult);
      const error = new Error('The remote profile changed before the initial sync could complete');
      error.remoteChangedBeforeResolution = true;
      error.remoteConflictRefreshed = true;
      throw error;
    }
    profileSyncRuntime.conflictCopies = await findProfileSyncConflictCopies();
    let finalDirection = direction;

    if (direction === 'auto') {
      finalDirection = profileSyncCore.chooseSyncDirection({
        localUpdatedAt,
        remoteUpdatedAt: remoteResult.envelope?.updatedAt || null,
        remoteExists: remoteResult.exists,
      });
    }

    if (finalDirection === 'none') {
      updateProfileSyncStatus('idle', '');
      const status = buildProfileSyncStatus();
      emitProfileSyncStatus();
      return { ok: true, action: 'none', status };
    }

    if (finalDirection === 'pull') {
      if (!remoteResult.exists || !remoteResult.envelope) {
        updateProfileSyncStatus('idle', '');
        const status = buildProfileSyncStatus();
        emitProfileSyncStatus();
        return { ok: true, action: 'none', status };
      }

      const { profile: remoteProfile, syncScope: remoteSyncScope } = await decodeEnvelopeProfile(
        remoteResult.envelope
      );
      const localProfile = profileSyncCore.projectSyncProfile(config, remoteSyncScope);
      const localHash = computeScopedProfileHash(localProfile, remoteSyncScope);
      const remoteHash = computeScopedProfileHash(remoteProfile, remoteSyncScope);
      if (remoteHash !== localHash || source === 'first_enable_resolution') {
        await backupLocalProfileBeforePullApply(remoteSyncScope);
        await applySyncedProfileToConfig(
          remoteProfile,
          remoteResult.envelope.updatedAt,
          remoteSyncScope
        );
      }
      profileSyncRuntime.localProfileUpdatedAt = remoteResult.envelope.updatedAt;
      getProfileSyncConfig().profileUpdatedAt = remoteResult.envelope.updatedAt;
      updateProfileSyncStatus('success', '');
      setupProfileSyncInterval();
      const status = buildProfileSyncStatus();
      emitProfileSyncStatus();
      return { ok: true, action: 'pull', status, config: sanitizeConfigForRenderer(config) };
    }

    if (finalDirection === 'push') {
      const envelopeToWrite = await buildLocalProfileEnvelope(new Date().toISOString());

      // Best-effort compare-before-write: encryption and provider replication take time, so
      // another device can land a write between the read above and this one.
      // Overwriting blind would silently drop it, so re-check and re-resolve.
      if (await hasRemoteSyncEnvelopeChanged(remoteResult)) {
        log.info('Remote sync file changed while preparing a push; re-resolving direction');
        if (source === 'conflict_recheck') {
          throw new Error('Sync file kept changing on the other device; try again');
        }
        void runProfileSync('auto', 'conflict_recheck');
        const status = buildProfileSyncStatus();
        emitProfileSyncStatus();
        return { ok: true, action: 'none', reason: 'remote_changed', queued: true, status };
      }

      await writeConfiguredSyncEnvelope(envelopeToWrite);
      if (profileSync.remoteRewritePending) {
        const previousCredential = {
          rememberPassphrase: profileSync.rememberPassphrase,
          passphraseEncrypted: profileSync.passphraseEncrypted,
          storedPassphrase: profileSync.storedPassphrase,
          passphraseSession: profileSyncRuntime.passphraseSession,
          passphraseWarning: profileSyncRuntime.passphraseWarning,
        };
        profileSync.remoteRewritePending = false;
        if (!profileSync.encryptionEnabled) {
          profileSync.rememberPassphrase = false;
          profileSync.passphraseEncrypted = false;
          profileSync.storedPassphrase = '';
          profileSyncRuntime.passphraseSession = '';
          profileSyncRuntime.passphraseWarning = '';
        }
        const markerPersistence = await saveConfigDurably({ allowDebouncedPush: false });
        if (!markerPersistence.success) {
          profileSync.remoteRewritePending = true;
          profileSync.rememberPassphrase = previousCredential.rememberPassphrase;
          profileSync.passphraseEncrypted = previousCredential.passphraseEncrypted;
          profileSync.storedPassphrase = previousCredential.storedPassphrase;
          profileSyncRuntime.passphraseSession = previousCredential.passphraseSession;
          profileSyncRuntime.passphraseWarning = previousCredential.passphraseWarning;
          const markerError = new Error(
            `Remote profile was rewritten, but the local completion marker could not be saved: ${markerPersistence.error}`
          );
          markerError.remoteRewriteCommitted = true;
          throw markerError;
        }
      }
      profileSyncRuntime.localProfileUpdatedAt = envelopeToWrite.updatedAt;
      getProfileSyncConfig().profileUpdatedAt = envelopeToWrite.updatedAt;
      updateProfileSyncStatus('success', '');
      setupProfileSyncInterval();
      const status = buildProfileSyncStatus();
      emitProfileSyncStatus();
      return { ok: true, action: 'push', status };
    }

    throw new Error(`Unknown profile sync direction: ${finalDirection}`);
  } catch (error) {
    updateProfileSyncStatus('error', error.message);
    emitProfileSyncStatus();
    throw error;
  } finally {
    profileSyncRuntime.inFlight = false;
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
  if (!profileSync.enabled || !profileSync.cloudFilePath) return;
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

function setupProfileSyncWakeTriggers() {
  try {
    // Suspend stops the interval timer from firing on time, so the profile is
    // usually stale by the time the machine comes back.
    powerMonitor.on('resume', () => {
      requestOpportunisticProfileSync('resume');
    });
  } catch (error) {
    log.warn('Could not subscribe to power resume events:', error?.message || error);
  }
}

async function initializeProfileSyncOnStartupInternal() {
  const profileSync = getProfileSyncConfig();
  if (!profileSync.enabled || !profileSync.cloudFilePath) return;
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
    clearProfileSyncTimers();
    log.warn('Profile sync startup run failed:', error.message);
  }
}

function initializeProfileSyncOnStartup() {
  return runSerializedConfigMutation(initializeProfileSyncOnStartupInternal);
}

/**
 * Apply or remove platform-appropriate frosted glass effects to the main window.
 *
 * Applies Windows acrylic or macOS vibrancy/visual-effect state and ensures the window background is transparent.
 * If `override` is provided, its value determines whether effects are enabled; otherwise the function uses `config.frostedGlass`.
 * No-op if the main window is not available.
 * @param {boolean} [override] - When set, force enable (`true`) or disable (`false`) frosted glass effects.
 */
function applyFrostedGlass(override) {
  if (!mainWindow) return;
  applyWindowEffectsToWindow(mainWindow, config, override);
}

/**
 * Create and configure the application's main BrowserWindow.
 *
 * Creates the primary transparent window, applies visual effects (frosted glass and safe opacity),
 * loads the renderer (index.html), and attaches runtime behavior: persisting window position/size,
 * hiding to tray on minimize, preventing quit on close (hides instead unless the app is quitting),
 * and opening DevTools when the process was started with --dev.
 *
 * The window is created with security-conscious webPreferences and respects configured options
 * such as always-on-top, resizability, and the configured icon. This function updates in-memory
 * configuration (e.g., clamped opacity) and calls saveConfig() when position/size changes.
 */
function createWindow() {
  log.info('Creating main window');
  // Get the primary display's work area
  const primaryDisplay = electronScreen.getPrimaryDisplay();
  const { width: _width, height: _height } = primaryDisplay.workAreaSize;

  // Resolve icon path
  const iconPath = getAppIconPath(__dirname);
  const transparencyOptions = getWindowTransparencyOptions(config);

  // Create the browser window. Linux defaults to an opaque native window because
  // transparent Electron windows are a major compositor performance cost there.
  const visualOptions = getMainWindowVisualOptions({
    platform: process.platform,
    frostedGlass: !!config.frostedGlass,
    transparencyOptions,
  });
  const positionOptions = {};
  if (!usesCompositorOwnedPlacement) {
    // A saved position can point at a monitor that has since been unplugged, or at the empty
    // space between monitors in a multi-display layout, and a window opened there never
    // appears. Recover onto the nearest display instead of starting off-screen.
    const savedPosition = config.windowPosition || {};
    const placement = clampPositionToWorkAreas(
      {
        x: savedPosition.x,
        y: savedPosition.y,
        width: config.windowSize?.width,
        height: config.windowSize?.height,
      },
      electronScreen.getAllDisplays().map((display) => display.workArea)
    );
    if (placement.x !== savedPosition.x || placement.y !== savedPosition.y) {
      log.info(
        `Saved window position ${savedPosition.x},${savedPosition.y} is not on a connected display; opening at ${placement.x},${placement.y}`
      );
      config.windowPosition = { x: placement.x, y: placement.y };
    }
    positionOptions.x = config.windowPosition.x;
    positionOptions.y = config.windowPosition.y;
  }

  const windowOptions = {
    ...positionOptions,
    width: config.windowSize.width,
    height: config.windowSize.height,
    ...visualOptions,
    frame: false,
    // A frameless window still reports a title to the window manager, and a stable one is what
    // lets a user write a window rule that matches only this widget (see
    // docs/linux-wayland-notes.md for the KWin rule that keeps its position on Wayland).
    title: MAIN_WINDOW_TITLE,
    alwaysOnTop: config.alwaysOnTop,
    skipTaskbar: true,
    resizable: true,
    movable: true,
    icon: iconPath,
    webPreferences: {
      preload: PRELOAD_SCRIPT_PATH,
      nodeIntegration: false, // Security: disabled, renderer uses bundled code
      contextIsolation: true, // Security: enabled, uses contextBridge for IPC
      webSecurity: true,
    },
  };

  mainWindow = new BrowserWindow(windowOptions);
  hardenRendererNavigation(mainWindow);
  forwardRendererConsole(mainWindow.webContents, 'renderer');
  attachEditHandlers(mainWindow, Menu);

  // Transparent windows use renderer CSS surface opacity; opaque fallback
  // windows use native BrowserWindow opacity so the desktop shows through.
  const safeOpacity = applyWindowOpacity(mainWindow, config.opacity, config);
  config.opacity = safeOpacity; // Update config to safe value
  applyFrostedGlass();
  wireWindowEffectsRefresh(mainWindow, () => config);

  // index.html carries no <title>, so Chromium would name the window after the file and window
  // rules would have nothing stable to match. Desktop pins load the same file and deliberately
  // keep that default title, so a rule for the widget cannot catch them.
  mainWindow.on('page-title-updated', (event) => {
    event.preventDefault();
  });

  // Load the index.html file
  mainWindow.loadFile('index.html');
  mainWindow.webContents.on('did-finish-load', () => {
    emitProfileSyncStatus();
    pushConfigToRenderer();
    if (IS_SMOKE_TEST_MODE) {
      smokeTestRendererLoaded = true;
      maybeFinishSmokeTest();
    }
  });
  if (IS_SMOKE_TEST_MODE) {
    mainWindow.webContents.on(
      'did-fail-load',
      (_event, errorCode, errorDescription, validatedUrl, isMainFrame) => {
        if (isMainFrame === false) return;
        finishSmokeTest(
          false,
          `Renderer failed to load ${validatedUrl || 'index.html'} (${errorCode}: ${errorDescription})`
        );
      }
    );
    mainWindow.webContents.on('render-process-gone', (_event, details) => {
      finishSmokeTest(
        false,
        `Renderer process exited during startup (${details?.reason || 'unknown reason'})`
      );
    });
    mainWindow.on('unresponsive', () => {
      finishSmokeTest(false, 'Renderer became unresponsive during startup');
    });
  }

  const changeWin = () => {
    const bounds = mainWindow.getBounds();
    pendingWindowBounds = bounds;
    if (windowStateSaveTimer) {
      clearTimeout(windowStateSaveTimer);
    }
    windowStateSaveTimer = setTimeout(() => {
      windowStateSaveTimer = null;
      const boundsToPersist = pendingWindowBounds;
      pendingWindowBounds = null;
      if (!boundsToPersist) return;
      runBackgroundConfigMutation(() => {
        // Native Wayland compositors own placement and report coordinates that are not
        // stable app-controlled positions. Persisting those values during a resize makes
        // the next XWayland/X11 launch jump to compositor bookkeeping coordinates.
        if (!usesCompositorOwnedPlacement) {
          config.windowPosition = { x: boundsToPersist.x, y: boundsToPersist.y };
        }
        config.windowSize = {
          width: boundsToPersist.width,
          height: boundsToPersist.height,
        };
        saveConfig();
      }, 'window bounds save');
    }, 400);
  };

  // Save position when window is moved
  mainWindow.on('moved', changeWin);

  // Save size when window is resized
  mainWindow.on('resized', changeWin);

  // Hide to tray when minimizing
  mainWindow.on('minimize', (event) => {
    event.preventDefault();
    mainWindow.hide();
  });

  // Any hide (tray toggle, close to tray, minimize) ends a popup raise, so a later show
  // from the tray or menu does not inherit the above-full-screen z-order.
  mainWindow.on('hide', () => {
    popupWindowPresenter.handleWindowHidden(mainWindow);
    notifyDesktopCompanionStateChanged();
  });
  mainWindow.on('show', notifyDesktopCompanionStateChanged);
  mainWindow.on('blur', () => {
    popupWindowPresenter.handleWindowBlur(mainWindow);
  });

  // Coming back to the widget is the moment a stale profile is most visible, and
  // the provider has usually finished replicating by then.
  mainWindow.on('focus', () => {
    requestOpportunisticProfileSync('focus');
  });

  // Open DevTools in development mode
  if (IS_DEV_MODE) {
    mainWindow.webContents.openDevTools({ mode: 'detach' });
  }

  // Minimize to tray on close
  mainWindow.on('close', (e) => {
    if (!isQuitting) {
      e.preventDefault();
      mainWindow.hide();
    }
  });

  // Handle window closed (when quitting)
  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

function buildTrayContextMenu() {
  return Menu.buildFromTemplate([
    {
      label: mainT('Show/Hide'),
      click: () => {
        if (mainWindow?.isVisible()) {
          hideMainWindowToTray();
        } else {
          showMainWindowFromTray();
        }
      },
    },
    {
      label: mainT('Always on Top'),
      type: 'checkbox',
      checked: config.alwaysOnTop,
      click: (menuItem) => {
        const requestedValue = !!menuItem.checked;
        void runSerializedConfigMutation(async () => {
          const previousValue = !!config.alwaysOnTop;
          config.alwaysOnTop = requestedValue;
          applyAlwaysOnTopPreference();
          const persistence = await saveConfigDurably();
          if (!persistence.success) {
            config.alwaysOnTop = previousValue;
            menuItem.checked = previousValue;
            applyAlwaysOnTopPreference();
            log.warn(`Failed to save tray always-on-top setting: ${persistence.error}`);
          }
        }).catch((error) => {
          log.warn('Failed to apply tray always-on-top setting:', error.message);
        });
      },
    },
    {
      label: mainT('Reset Position'),
      enabled: !usesCompositorOwnedPlacement,
      click: () => {
        if (usesCompositorOwnedPlacement) return;
        void runSerializedConfigMutation(async () => {
          const previousPosition = config.windowPosition;
          config.windowPosition = { x: 100, y: 100 };
          const persistence = await saveConfigDurably();
          if (!persistence.success) {
            config.windowPosition = previousPosition;
            log.warn(`Failed to save reset window position: ${persistence.error}`);
            return;
          }
          mainWindow.setPosition(100, 100);
        }).catch((error) => {
          log.warn('Failed to reset window position:', error.message);
        });
      },
    },
    { type: 'separator' },
    {
      label: mainT('DevTools'),
      click: () => {
        mainWindow.webContents.openDevTools({ mode: 'detach' });
      },
    },
    {
      label: mainT('Reload'),
      click: () => {
        mainWindow.reload();
      },
    },
    { type: 'separator' },
    {
      label: mainT('Open Settings'),
      click: () => {
        showMainWindowFromTray();
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('open-settings');
        }
      },
    },
    {
      label: mainT('Check for Updates'),
      click: () => {
        void checkForUpdatesForCurrentPackage()
          .then((result) => {
            if (result.status === 'dev') {
              log.info('Update check is only available in packaged builds.');
            }
            // Supported auto-updaters emit their final available/none/error event before
            // checkForUpdates resolves. Re-sending the synthetic "checking" result here
            // would overwrite that final renderer state.
            if (result.status === 'checking') return;
            if (mainWindow && result) {
              mainWindow.webContents.send('auto-update', result);
            }
          })
          .catch((error) => {
            const payload = { status: 'error', error: error?.message || String(error) };
            log.warn('Tray update check failed:', payload.error);
            if (mainWindow) {
              mainWindow.webContents.send('auto-update', payload);
            }
          });
      },
    },
    {
      label: mainT('Report Issue'),
      click: () => {
        const url =
          (pkg && pkg.bugs && pkg.bugs.url) || (pkg && pkg.homepage) || 'https://github.com/';
        shell.openExternal(url);
      },
    },
    { type: 'separator' },
    {
      label: mainT('Quit'),
      click: () => {
        isQuitting = true;
        app.quit();
      },
    },
  ]);
}

function createTray() {
  log.info('Creating system tray icon');
  if (!tray || tray.isDestroyed?.()) {
    tray = new Tray(resolveTrayIcon());
    tray.on('click', () => {
      if (mainWindow?.isVisible()) {
        hideMainWindowToTray();
      } else {
        showMainWindowFromTray();
      }
    });
  }

  const contextMenu = buildTrayContextMenu();
  tray.setToolTip(mainT('Home Assistant Widget'));
  tray.setContextMenu(contextMenu);
  if (IS_SMOKE_TEST_MODE) {
    smokeTestTrayReady = true;
    maybeFinishSmokeTest();
  }
}

function schedulePostWindowStartupTasks() {
  if (postWindowStartupTasksScheduled) return;
  postWindowStartupTasksScheduled = true;

  setTimeout(() => {
    runBackgroundConfigMutation(async () => {
      resolveDeferredSecureConfig({ notifyRenderer: true });
      await restoreHomeAssistantOAuthSession();
    }, 'deferred secure config and OAuth resolution');

    try {
      syncDesktopPinWindowsWithConfig();
    } catch (error) {
      log.warn('Desktop pin startup sync failed:', error.message);
    }

    try {
      createTray();
    } catch (error) {
      log.warn('Tray startup initialization failed:', error.message);
      finishSmokeTest(false, `Tray startup initialization failed: ${error.message}`);
    }

    try {
      registerGlobalHotkeys();
    } catch (error) {
      log.warn('Global hotkey startup initialization failed:', error.message);
    }

    try {
      // On Wayland this rebinds all hotkeys through the portal once it confirms
      // availability; on X11/other the globalShortcut registration above stands.
      void ensurePortalShortcutsBackendInitialized();
    } catch (error) {
      log.warn('Portal shortcut startup initialization failed:', error.message);
    }

    try {
      setupEntityAlerts();
    } catch (error) {
      log.warn('Entity alert startup initialization failed:', error.message);
    }

    try {
      registerPopupHotkey();
    } catch (error) {
      log.warn('Popup hotkey startup initialization failed:', error.message);
    }

    setupProfileSyncWakeTriggers();
    void initializeProfileSyncOnStartup().catch((error) => {
      log.warn('Profile sync startup initialization failed:', error.message);
    });
  }, 1000);
}

// IPC handlers for configuration
ipcMain.handle('renderer-ready', (event) => {
  const sender = authorizeIpcSender(event, 'renderer-ready');
  if (!sender) return rejectUnauthorizedIpc('renderer-ready');
  if (IS_SMOKE_TEST_MODE) {
    smokeTestRendererReady = true;
    maybeFinishSmokeTest();
  }
  return { success: true };
});

ipcMain.handle('get-config', (event) => {
  const sender = authorizeIpcSender(event, 'get-config');
  if (!sender) return rejectUnauthorizedIpc('get-config');
  return sanitizeConfigForRenderer(config);
});

ipcMain.handle('get-locale-bootstrap', (event) => {
  const sender = authorizeIpcSender(event, 'get-locale-bootstrap', { allowDesktopPin: true });
  if (!sender) return rejectUnauthorizedIpc('get-locale-bootstrap');
  return localizationService.getLocaleBootstrap(config?.ui?.language || 'auto');
});

ipcMain.handle('get-locale-packs', async (event, forceRefresh = false) => {
  const sender = authorizeIpcSender(event, 'get-locale-packs');
  if (!sender) return rejectUnauthorizedIpc('get-locale-packs');
  return localizationService.listLocalePacks(!!forceRefresh);
});

ipcMain.handle('download-locale-pack', async (event, locale) => {
  const sender = authorizeIpcSender(event, 'download-locale-pack');
  if (!sender) return rejectUnauthorizedIpc('download-locale-pack');
  const pack = await localizationService.downloadLocalePack(locale);
  pushConfigToRenderer();
  if (tray) {
    createTray();
  }
  return {
    success: true,
    pack,
    localeBootstrap: localizationService.getLocaleBootstrap(config?.ui?.language || 'auto'),
    // Keep the response strict for now: if the authoritative manifest refresh fails
    // after mutation, the renderer reports failure. Decoupled success is deferred.
    packs: await localizationService.listLocalePacks(true),
  };
});

ipcMain.handle('remove-locale-pack', async (event, locale) => {
  const sender = authorizeIpcSender(event, 'remove-locale-pack');
  if (!sender) return rejectUnauthorizedIpc('remove-locale-pack');
  const result = localizationService.removeLocalePack(locale);
  pushConfigToRenderer();
  if (tray) {
    createTray();
  }
  return {
    success: true,
    ...result,
    localeBootstrap: localizationService.getLocaleBootstrap(config?.ui?.language || 'auto'),
    // Keep the response strict for now: if the authoritative manifest refresh fails
    // after mutation, the renderer reports failure. Decoupled success is deferred.
    packs: await localizationService.listLocalePacks(true),
  };
});

ipcMain.handle(
  'update-config',
  serializeConfigMutationHandler(async (event, newConfig) => {
    const sender = authorizeIpcSender(event, 'update-config');
    if (!sender) return rejectUnauthorizedIpc('update-config');
    if (!isPlainObject(newConfig)) {
      return { success: false, error: 'Invalid config payload' };
    }
    log.debug('Updating configuration');
    const prevConfig = config;
    const previousRuntimeTracking = {
      localProfileHash: profileSyncRuntime.localProfileHash,
      localProfileUpdatedAt: profileSyncRuntime.localProfileUpdatedAt,
      pendingPullEchoHash: profileSyncRuntime.pendingPullEchoHash,
    };
    const previousEncryptedTokenForRecovery = preservedEncryptedTokenForRecovery;
    const prevSyncEnabled = !!config?.profileSync?.enabled;
    const previousDesktopCompanion = { ...(config?.desktopCompanion || {}) };
    const previousHomeAssistant = { ...(config?.homeAssistant || {}) };
    // Development demo state is an IPC-only marker. Never let an overlay renderer
    // write it back into the user's real configuration.
    delete newConfig.developmentDemo;
    pruneConfig(newConfig);
    const customTabs = Array.isArray(newConfig.customTabs)
      ? newConfig.customTabs
      : Array.isArray(config.customTabs)
        ? config.customTabs
        : { ...(config.customTabs || {}), ...(newConfig.customTabs || {}) };
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
    const normalizedNextPath =
      typeof profileSync.cloudFilePath === 'string' ? profileSync.cloudFilePath.trim() : '';
    const normalizedNextScope = getNormalizedProfileSyncScopeValue(profileSync.syncScope);
    const remoteTargetChanged =
      prevSyncEnabled &&
      profileSync.enabled &&
      (normalizedNextProvider !== previousProvider ||
        normalizedNextPath !== previousCloudFilePath ||
        JSON.stringify(normalizedNextScope) !== JSON.stringify(previousSyncScope));
    if (
      previousPassphraseMetadata.passphraseTransition &&
      (profileSync.enabled !== prevSyncEnabled ||
        remoteTargetChanged ||
        requestedEncryptionEnabled !== previousEncryptionEnabled)
    ) {
      return {
        success: false,
        error:
          'Finish the pending sync-key recovery before changing the sync target or encryption setting',
        config: sanitizeConfigForRenderer(config),
      };
    }
    const requiresInitialPreparation =
      !!profileSync.enabled && (!prevSyncEnabled || remoteTargetChanged);
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
    const updates = { ...(config.updates || {}), ...(newConfig.updates || {}) };
    const homeAssistant = {
      ...(config.homeAssistant || {}),
      ...(newConfig.homeAssistant || {}),
    };
    if (previousHomeAssistant.authMethod === 'oauth') {
      Object.assign(homeAssistant, previousHomeAssistant);
    } else {
      // Entering OAuth creates credentials and runtime state through the dedicated
      // pairing IPC. A renderer config echo cannot opt itself into OAuth.
      homeAssistant.authMethod = 'token';
    }
    config = {
      ...config,
      ...newConfig,
      homeAssistant,
      desktopCompanion: previousDesktopCompanion,
      customTabs,
      profileSync,
      updates,
    };
    ensureDateTimeFormatConfigDefaults(config);
    ensureProfileSyncConfigDefaults(config);
    ensureUpdateConfigDefaults(config);
    ensureHaProfileConfigDefaults(config);
    normalizeDesktopPinsConfig(config);
    pruneConfig(config);
    restoreProfileFromStalePullEcho(prevConfig);
    // The renderer's echo of profileSync may be stale; the content-change
    // timestamp is main-process-authoritative (saveConfig advances it on real
    // profile changes).
    config.profileSync.profileUpdatedAt = prevConfig?.profileSync?.profileUpdatedAt ?? null;
    if (
      TOKEN_RESET_RECOVERY_REASONS.has(config?.tokenResetReason) &&
      !isPlaceholderOrEmptyToken(config.homeAssistant?.token)
    ) {
      delete config.tokenResetReason;
    }
    if (
      config.homeAssistant?.token &&
      config.homeAssistant.token !== HOME_ASSISTANT_TOKEN_PLACEHOLDER
    ) {
      preservedEncryptedTokenForRecovery = null;
    }
    const persistence = await saveConfigDurably({ allowDebouncedPush: false });
    if (!persistence.success) {
      config = prevConfig;
      Object.assign(profileSyncRuntime, previousRuntimeTracking);
      preservedEncryptedTokenForRecovery = previousEncryptedTokenForRecovery;
      log.error('Configuration update was not persisted:', persistence.error);
      return {
        success: false,
        error: `Failed to save settings: ${persistence.error}`,
        config: sanitizeConfigForRenderer(config),
      };
    }

    const runtimeWarnings = [];
    await runPostSaveSideEffect(runtimeWarnings, 'profile sync scheduling', async () => {
      if (profileSyncRuntime.localProfileHash !== previousRuntimeTracking.localProfileHash) {
        scheduleDebouncedProfileSyncPush('config_change');
      }

      const syncEnabled = !!config.profileSync?.enabled;
      if (!syncEnabled) {
        profileSyncRuntime.needsResolution = false;
        profileSyncRuntime.pendingRemoteEnvelope = null;
        clearProfileSyncTimers();
      } else if (typeof config.profileSync.encryptionChangePending === 'boolean') {
        clearProfileSyncTimers();
        emitProfileSyncStatus();
      } else if (requiresInitialPreparation) {
        profileSyncRuntime.needsResolution = false;
        profileSyncRuntime.pendingRemoteEnvelope = null;
        profileSyncRuntime.pendingRemoteIdentity = null;
        const hasRequiredPassphrase =
          !config.profileSync.encryptionEnabled || !!getActiveProfileSyncPassphrase();
        if (hasRequiredPassphrase) {
          try {
            const resolution = await prepareProfileSyncFirstEnableResolution();
            if (!resolution?.needsResolution) {
              await completeProfileSyncFirstEnablePreparation('settings_enable');
            }
          } catch (error) {
            clearProfileSyncTimers();
            updateProfileSyncStatus('error', error.message);
          }
        } else {
          clearProfileSyncTimers();
          emitProfileSyncStatus();
        }
      } else if (config.profileSync.firstEnableResolutionPending) {
        clearProfileSyncTimers();
      } else {
        setupProfileSyncInterval();
      }
    });

    await runPostSaveSideEffect(runtimeWarnings, 'main window settings', () =>
      applyMainWindowSettingSideEffects(prevConfig, config)
    );
    await runPostSaveSideEffect(runtimeWarnings, 'runtime settings', () =>
      applyRuntimeConfigSideEffects(prevConfig, config, 'settings update')
    );
    if (prevConfig?.ui?.language !== config?.ui?.language && tray) {
      await runPostSaveSideEffect(runtimeWarnings, 'tray language', () => createTray());
    }
    if (
      prevConfig?.updates?.allowPrerelease !== config?.updates?.allowPrerelease &&
      autoUpdaterInstance
    ) {
      await runPostSaveSideEffect(runtimeWarnings, 'update channel', () =>
        configureAutoUpdaterChannel(autoUpdaterInstance)
      );
    }
    await runPostSaveSideEffect(runtimeWarnings, 'desktop pin windows', () =>
      syncDesktopPinWindowsWithConfig()
    );

    const rendererConfig = sanitizeConfigForRenderer(config);
    if (persistence.persistenceWarnings?.length) {
      rendererConfig.persistenceWarnings = persistence.persistenceWarnings;
    }
    if (runtimeWarnings.length) {
      rendererConfig.runtimeWarnings = runtimeWarnings;
    }
    await runPostSaveSideEffect(runtimeWarnings, 'renderer config broadcast', () =>
      pushConfigToRenderer({
        persistenceWarnings: persistence.persistenceWarnings,
        runtimeWarnings,
      })
    );
    await runPostSaveSideEffect(runtimeWarnings, 'desktop pin config broadcast', () =>
      broadcastDesktopPinConfigUpdate()
    );
    await runPostSaveSideEffect(runtimeWarnings, 'profile sync status broadcast', () =>
      emitProfileSyncStatus()
    );
    if (runtimeWarnings.length) {
      rendererConfig.runtimeWarnings = runtimeWarnings;
    }
    return rendererConfig;
  })
);

ipcMain.handle(
  'clear-token-reset-reason',
  serializeConfigMutationHandler(async (event) => {
    const sender = authorizeIpcSender(event, 'clear-token-reset-reason');
    if (!sender) return rejectUnauthorizedIpc('clear-token-reset-reason');
    if (TOKEN_RESET_RECOVERY_REASONS.has(config?.tokenResetReason)) {
      const previousReason = config.tokenResetReason;
      delete config.tokenResetReason;
      const persistence = await saveConfigDurably();
      if (!persistence.success) {
        config.tokenResetReason = previousReason;
        return {
          success: false,
          error: `Failed to save token recovery acknowledgement: ${persistence.error}`,
          config: sanitizeConfigForRenderer(config),
        };
      }
      const runtimeWarnings = [];
      await runPostSaveSideEffect(runtimeWarnings, 'token recovery renderer broadcast', () =>
        pushConfigToRenderer({ runtimeWarnings })
      );
      const rendererConfig = sanitizeConfigForRenderer(config);
      if (runtimeWarnings.length) {
        rendererConfig.runtimeWarnings = runtimeWarnings;
      }
      return rendererConfig;
    }
    return sanitizeConfigForRenderer(config);
  })
);

function normalizeHomeAssistantBaseUrlForIpc(rawUrl) {
  return normalizeHomeAssistantBaseUrl(rawUrl);
}

function getHomeAssistantOAuthClient() {
  if (!homeAssistantOAuthClient) {
    homeAssistantOAuthClient = new HomeAssistantOAuthClient({
      safeStorage,
      platform: process.platform,
      userDataPath: app.getPath('userData'),
      openExternal: (url) => shell.openExternal(url),
      postForm: (url, fields) => requestFormWithElectronNet(net, url, fields),
      isSecureStorageAvailable: isSecureProfileSyncStorageAvailable,
      log,
    });
  }
  return homeAssistantOAuthClient;
}

function clearHomeAssistantOAuthRefreshTimer() {
  if (homeAssistantOAuthRefreshTimer) {
    clearTimeout(homeAssistantOAuthRefreshTimer);
    homeAssistantOAuthRefreshTimer = null;
  }
}

function scheduleHomeAssistantOAuthRefresh(expiresAt, delayOverride = null) {
  clearHomeAssistantOAuthRefreshTimer();
  if (config?.homeAssistant?.authMethod !== 'oauth' || isQuitting) return;
  const delay =
    delayOverride === null
      ? Math.max(30_000, Number(expiresAt || 0) - Date.now() - HOME_ASSISTANT_OAUTH_REFRESH_SKEW_MS)
      : Math.max(1000, Number(delayOverride) || HOME_ASSISTANT_OAUTH_RETRY_MS);
  homeAssistantOAuthRefreshTimer = setTimeout(() => {
    homeAssistantOAuthRefreshTimer = null;
    runBackgroundConfigMutation(
      () => refreshHomeAssistantOAuthSession(),
      'Home Assistant OAuth refresh'
    );
  }, delay);
  homeAssistantOAuthRefreshTimer.unref?.();
}

async function applyHomeAssistantOAuthSession(session, options = {}) {
  if (!session?.accessToken || !session?.baseUrl) {
    throw new Error('Home Assistant OAuth did not return a usable session');
  }
  const previousConfig = config;
  const nextConfig = {
    ...config,
    homeAssistant: {
      ...(config?.homeAssistant || {}),
      url: session.baseUrl,
      token: session.accessToken,
      tokenEncrypted: false,
      authMethod: 'oauth',
      oauthStatus: 'connected',
      oauthExpiresAt: session.expiresAt,
    },
    desktopCompanion: { ...(config?.desktopCompanion || {}) },
  };
  delete nextConfig.homeAssistant.oauthLastError;
  delete nextConfig.tokenResetReason;
  config = nextConfig;
  ensureDesktopCompanionIdentity();
  preservedEncryptedTokenForRecovery = null;

  if (options.persist === true) {
    const persistence = await saveConfigDurably({ allowDebouncedPush: false });
    if (!persistence.success) {
      config = previousConfig;
      throw new Error(`Failed to save Home Assistant authorization: ${persistence.error}`);
    }
  }

  scheduleHomeAssistantOAuthRefresh(session.expiresAt);
  pushConfigToRenderer();
  broadcastDesktopPinConfigUpdate();
  return sanitizeConfigForRenderer(config);
}

async function refreshHomeAssistantOAuthSession() {
  if (config?.homeAssistant?.authMethod !== 'oauth') return null;
  try {
    const session = await getHomeAssistantOAuthClient().refresh();
    if (!session) throw new Error('Saved Home Assistant authorization was not found');
    return applyHomeAssistantOAuthSession(session);
  } catch (error) {
    config.homeAssistant = config.homeAssistant || {};
    config.homeAssistant.oauthStatus =
      error?.code === 'OAUTH_INVALID_GRANT' ? 'reauth_required' : 'offline';
    config.homeAssistant.oauthLastError = String(error?.message || error).slice(0, 512);
    if (error?.code === 'OAUTH_INVALID_GRANT') {
      config.homeAssistant.token = HOME_ASSISTANT_TOKEN_PLACEHOLDER;
      clearHomeAssistantOAuthRefreshTimer();
    } else {
      scheduleHomeAssistantOAuthRefresh(null, HOME_ASSISTANT_OAUTH_RETRY_MS);
    }
    pushConfigToRenderer();
    return null;
  }
}

async function restoreHomeAssistantOAuthSession() {
  if (config?.homeAssistant?.authMethod !== 'oauth') return null;
  config.homeAssistant.oauthStatus = 'restoring';
  pushConfigToRenderer();
  return refreshHomeAssistantOAuthSession();
}

ipcMain.handle('start-home-assistant-oauth', async (event, rawUrl) => {
  const sender = authorizeIpcSender(event, 'start-home-assistant-oauth');
  if (!sender) return rejectUnauthorizedIpc('start-home-assistant-oauth');
  try {
    const session = await getHomeAssistantOAuthClient().pair(rawUrl);
    return await runSerializedConfigMutation(async () => ({
      success: true,
      config: await applyHomeAssistantOAuthSession(session, { persist: true }),
    }));
  } catch (error) {
    return {
      success: false,
      code: error?.code || 'OAUTH_PAIRING_FAILED',
      error: error?.message || 'Home Assistant authorization failed',
    };
  }
});

ipcMain.handle('cancel-home-assistant-oauth', async (event) => {
  const sender = authorizeIpcSender(event, 'cancel-home-assistant-oauth');
  if (!sender) return rejectUnauthorizedIpc('cancel-home-assistant-oauth');
  // Never constructs a client just to cancel: with no pairing in flight there is
  // nothing to abort.
  if (!homeAssistantOAuthClient) return { success: true, canceled: false };
  return { success: true, canceled: homeAssistantOAuthClient.cancelPairing() };
});

ipcMain.handle('disconnect-home-assistant-oauth', async (event) => {
  const sender = authorizeIpcSender(event, 'disconnect-home-assistant-oauth');
  if (!sender) return rejectUnauthorizedIpc('disconnect-home-assistant-oauth');
  const updateResult = await runSerializedConfigMutation(async () => {
    const previousConfig = config;
    clearHomeAssistantOAuthRefreshTimer();
    config = {
      ...config,
      homeAssistant: {
        url: config?.homeAssistant?.url || 'http://homeassistant.local:8123',
        token: HOME_ASSISTANT_TOKEN_PLACEHOLDER,
        tokenEncrypted: false,
        authMethod: 'token',
      },
    };
    delete config.tokenResetReason;
    const persistence = await saveConfigDurably({ allowDebouncedPush: false });
    if (!persistence.success) {
      config = previousConfig;
      return { success: false, error: `Failed to save disconnected state: ${persistence.error}` };
    }
    pushConfigToRenderer();
    return { success: true, config: sanitizeConfigForRenderer(config) };
  });
  if (!updateResult.success) return updateResult;
  const revocation = await getHomeAssistantOAuthClient().revoke();
  return { ...updateResult, ...revocation };
});

ipcMain.handle('get-desktop-companion-registration', async (event) => {
  const sender = authorizeIpcSender(event, 'get-desktop-companion-registration');
  if (!sender) return rejectUnauthorizedIpc('get-desktop-companion-registration');
  if (!config?.desktopCompanion?.desktopId) {
    const result = await runSerializedConfigMutation(async () => {
      ensureDesktopCompanionIdentity();
      return saveConfigDurably({ allowDebouncedPush: false });
    });
    if (!result.success) return { success: false, error: result.error };
  }
  return { success: true, registration: getDesktopCompanionRegistration() };
});

ipcMain.handle('get-desktop-companion-state', (event) => {
  const sender = authorizeIpcSender(event, 'get-desktop-companion-state');
  if (!sender) return rejectUnauthorizedIpc('get-desktop-companion-state');
  return getDesktopCompanionState();
});

ipcMain.handle('apply-desktop-companion-command', (event, action) => {
  const sender = authorizeIpcSender(event, 'apply-desktop-companion-command');
  if (!sender) return rejectUnauthorizedIpc('apply-desktop-companion-command');
  if (!['show', 'hide', 'toggle'].includes(action)) {
    return { success: false, error: 'Unsupported main-process desktop command' };
  }
  if (action === 'show' || (action === 'toggle' && !mainWindow?.isVisible())) {
    showMainWindowFromTray();
  } else {
    hideMainWindowToTray();
  }
  return { success: true, state: getDesktopCompanionState() };
});

function testHomeAssistantApiRoot(baseUrl, token, timeoutMs = 8000) {
  return new Promise((resolve) => {
    const normalizedBaseUrl = normalizeHomeAssistantBaseUrlForIpc(baseUrl);
    const normalizedToken = typeof token === 'string' ? token.trim() : '';
    if (!normalizedBaseUrl || isPlaceholderOrEmptyToken(normalizedToken)) {
      resolve({ success: false, code: 'invalid-url' });
      return;
    }

    let completed = false;
    const request = net.request({
      method: 'GET',
      url: `${normalizedBaseUrl}/api/`,
      redirect: 'follow',
    });

    const finish = (result) => {
      if (completed) return;
      completed = true;
      clearTimeout(timeoutId);
      try {
        request.abort();
      } catch {
        /* noop */
      }
      resolve(result);
    };

    const timeoutId = setTimeout(() => {
      finish({ success: false, code: 'unreachable', error: 'Request timed out' });
    }, timeoutMs);

    request.setHeader('Authorization', `Bearer ${normalizedToken}`);
    request.setHeader('Accept', 'application/json');

    request.on('response', (response) => {
      const statusCode = Number(response.statusCode || 0);
      response.on('data', () => {});
      response.on('end', () => {
        if (statusCode >= 200 && statusCode < 300) {
          finish({ success: true, code: 'ok', status: statusCode, url: normalizedBaseUrl });
          return;
        }
        if (statusCode === 401 || statusCode === 403) {
          finish({ success: false, code: 'auth-failed', status: statusCode });
          return;
        }
        finish({ success: false, code: 'unreachable', status: statusCode });
      });
    });

    request.on('error', (error) => {
      finish({ success: false, code: 'unreachable', error: error?.message || String(error) });
    });

    try {
      request.end();
    } catch (error) {
      finish({ success: false, code: 'unreachable', error: error?.message || String(error) });
    }
  });
}

ipcMain.handle('test-ha-connection', async (event, url, token) => {
  const sender = authorizeIpcSender(event, 'test-ha-connection');
  if (!sender) return rejectUnauthorizedIpc('test-ha-connection');
  return testHomeAssistantApiRoot(url, token);
});

ipcMain.handle(
  'pin-entity-to-desktop',
  serializeConfigMutationHandler(async (event, entityId, supportInfo = null) => {
    const sender = authorizeIpcSender(event, 'pin-entity-to-desktop');
    if (!sender) return rejectUnauthorizedIpc('pin-entity-to-desktop');
    return pinEntityToDesktopInternal(entityId, supportInfo);
  })
);

ipcMain.handle('set-desktop-pin-edit-mode', (event, enabled) => {
  const sender = authorizeIpcSender(event, 'set-desktop-pin-edit-mode');
  if (!sender) return rejectUnauthorizedIpc('set-desktop-pin-edit-mode');
  return setDesktopPinEditMode(enabled);
});

ipcMain.handle(
  'update-desktop-pin-bounds',
  serializeConfigMutationHandler(async (event, entityId, nextBounds = {}) => {
    const sender = authorizeIpcSender(event, 'update-desktop-pin-bounds', {
      allowDesktopPin: true,
    });
    if (!sender) return rejectUnauthorizedIpc('update-desktop-pin-bounds');
    if (sender.type === 'desktop-pin' && normalizeEntityId(entityId) !== sender.entityId) {
      return { success: false, error: 'Unauthorized' };
    }
    return updateDesktopPinBounds(entityId, nextBounds);
  })
);

ipcMain.handle(
  'sync-desktop-pin-content-min-bounds',
  serializeConfigMutationHandler(async (event, entityId, minBounds = {}) => {
    const sender = authorizeIpcSender(event, 'sync-desktop-pin-content-min-bounds', {
      allowDesktopPin: true,
    });
    if (!sender) return rejectUnauthorizedIpc('sync-desktop-pin-content-min-bounds');
    if (sender.type === 'desktop-pin' && normalizeEntityId(entityId) !== sender.entityId) {
      return { success: false, error: 'Unauthorized' };
    }
    return syncDesktopPinContentMinBounds(entityId, minBounds);
  })
);

ipcMain.handle(
  'unpin-entity-from-desktop',
  serializeConfigMutationHandler(async (event, entityId) => {
    const sender = authorizeIpcSender(event, 'unpin-entity-from-desktop');
    if (!sender) return rejectUnauthorizedIpc('unpin-entity-from-desktop');
    return unpinEntityFromDesktopInternal(entityId);
  })
);

ipcMain.handle('get-desktop-pin-bootstrap', (event, entityId) => {
  const sender = authorizeIpcSender(event, 'get-desktop-pin-bootstrap', { allowDesktopPin: true });
  if (!sender) return rejectUnauthorizedIpc('get-desktop-pin-bootstrap');
  const normalizedEntityId = normalizeEntityId(entityId);
  if (sender.type === 'desktop-pin' && normalizedEntityId !== sender.entityId) {
    return { success: false, error: 'Unauthorized' };
  }
  return {
    entityId: normalizedEntityId,
    entity: latestEntityStates.get(normalizedEntityId) || null,
    hasSnapshot: hasPublishedHaSnapshot,
    pinBounds: config?.desktopPins?.[normalizedEntityId] || null,
    config: createDesktopPinRendererConfig(config),
    connection: createDesktopPinConnectionState(config, {
      secureStoragePending: hasDeferredSecureConfigWork(),
    }),
    isPinned: !!config?.desktopPins?.[normalizedEntityId],
    editMode: desktopPinEditMode,
  };
});

ipcMain.handle('publish-ha-snapshot', (event, states) => {
  const sender = authorizeIpcSender(event, 'publish-ha-snapshot');
  if (!sender) return rejectUnauthorizedIpc('publish-ha-snapshot');
  hasPublishedHaSnapshot = true;
  latestEntityStates.clear();
  if (isPlainObject(states)) {
    Object.entries(states).forEach(([entityId, entity]) => {
      const normalizedEntityId = normalizeEntityId(entityId);
      if (!normalizedEntityId || !isPlainObject(entity)) return;
      latestEntityStates.set(normalizedEntityId, entity);
    });
  }

  Object.keys(config?.desktopPins || {}).forEach((entityId) => {
    sendDesktopPinUpdate(entityId, { type: 'entity' });
  });

  return { success: true, count: latestEntityStates.size };
});

ipcMain.handle('publish-ha-entity-update', (event, entity) => {
  const sender = authorizeIpcSender(event, 'publish-ha-entity-update');
  if (!sender) return rejectUnauthorizedIpc('publish-ha-entity-update');
  const normalizedEntityId = normalizeEntityId(entity?.entity_id);
  if (!normalizedEntityId || !isPlainObject(entity)) {
    return { success: false, error: 'Invalid entity payload' };
  }

  latestEntityStates.set(normalizedEntityId, entity);
  sendDesktopPinUpdate(normalizedEntityId, { type: 'entity' });
  return { success: true };
});

ipcMain.handle('request-desktop-pin-action', (event, entityId, action, payload = {}) => {
  const sender = authorizeIpcSender(event, 'request-desktop-pin-action', { allowDesktopPin: true });
  if (!sender) return rejectUnauthorizedIpc('request-desktop-pin-action');
  let normalizedEntityId = normalizeEntityId(entityId);
  let normalizedAction = typeof action === 'string' ? action.trim() : '';
  let normalizedPayload = payload;
  if (!normalizedEntityId || !normalizedAction) {
    return { success: false, error: 'Invalid desktop pin action' };
  }
  if (sender.type === 'desktop-pin' && normalizedEntityId !== sender.entityId) {
    return { success: false, error: 'Unauthorized' };
  }
  if (sender.type === 'desktop-pin') {
    const normalizedRequest = normalizeDesktopPinActionRequest(
      normalizedEntityId,
      normalizedAction,
      payload
    );
    if (!normalizedRequest.success) return normalizedRequest;
    normalizedEntityId = normalizedRequest.entityId;
    normalizedAction = normalizedRequest.action;
    normalizedPayload = normalizedRequest.payload;
  }

  if (normalizedAction === 'open-settings') {
    focusMainWindow();
    mainWindow?.webContents?.send('open-settings');
    return { success: true, forwarded: true };
  }

  if (normalizedAction === 'open-details' || normalizedAction === 'focus-main') {
    focusMainWindow();
  }

  if (!mainWindow || mainWindow.isDestroyed()) {
    return { success: false, error: 'Main window is not available' };
  }

  return forwardDesktopPinActionToMainWindow(
    normalizedEntityId,
    normalizedAction,
    normalizedPayload,
    { awaitResponse: normalizedAction === 'service-call' }
  );
});

ipcMain.handle('desktop-pin-action-response', (event, requestId, response = {}) => {
  const sender = authorizeIpcSender(event, 'desktop-pin-action-response');
  if (!sender) return rejectUnauthorizedIpc('desktop-pin-action-response');
  const normalizedRequestId = typeof requestId === 'string' ? requestId.trim() : '';
  if (!normalizedRequestId) {
    return { success: false, error: 'Invalid desktop pin action request ID' };
  }

  if (!mainWindow || mainWindow.isDestroyed() || event.sender !== mainWindow.webContents) {
    return { success: false, error: 'Desktop pin action responses must come from the main window' };
  }

  const settled = settleDesktopPinActionRequest(
    normalizedRequestId,
    'resolve',
    normalizeDesktopPinActionResponse(response)
  );

  if (!settled) {
    return { success: false, error: 'Unknown desktop pin action request ID' };
  }

  return { success: true };
});

ipcMain.handle('show-entity-tile-menu', (event, entityId, supportInfo = null) => {
  const sender = authorizeIpcSender(event, 'show-entity-tile-menu');
  if (!sender) return rejectUnauthorizedIpc('show-entity-tile-menu');
  const normalizedEntityId = normalizeEntityId(entityId);
  if (!normalizedEntityId) {
    return { success: false, error: 'Invalid entity ID' };
  }

  const senderWindow = BrowserWindow.fromWebContents(event.sender);
  if (!senderWindow) {
    return { success: false, error: 'Unable to resolve sender window' };
  }

  const isPinned = !!config?.desktopPins?.[normalizedEntityId];
  const supportProfile = resolveDesktopPinSupportDecision(normalizedEntityId, supportInfo);
  const canPinToDesktop = supportProfile.supported;
  const existingHotkeyConfig = config?.globalHotkeys?.hotkeys?.[normalizedEntityId];
  const existingHotkey =
    typeof existingHotkeyConfig === 'object' && existingHotkeyConfig?.hotkey
      ? existingHotkeyConfig.hotkey
      : existingHotkeyConfig;
  const hasHotkey = typeof existingHotkey === 'string' && existingHotkey.trim().length > 0;
  const menu = Menu.buildFromTemplate([
    {
      label: hasHotkey ? mainT('Edit Hotkey') : mainT('Add Hotkey'),
      click: () => {
        senderWindow.focus();
        senderWindow.webContents.send('entity-tile-hotkey-requested', {
          entityId: normalizedEntityId,
        });
      },
    },
    { type: 'separator' },
    {
      label: isPinned
        ? mainT('Unpin from Desktop')
        : canPinToDesktop
          ? mainT('Pin to Desktop')
          : mainT('Desktop Pin Not Supported Yet'),
      enabled: isPinned || canPinToDesktop,
      click: () => {
        void runSerializedConfigMutation(() =>
          isPinned
            ? unpinEntityFromDesktopInternal(normalizedEntityId)
            : pinEntityToDesktopInternal(normalizedEntityId, supportProfile)
        )
          .then((result) => {
            if (result?.success === false) {
              log.warn(`Desktop pin menu action failed: ${result.error}`);
            }
          })
          .catch((error) => {
            log.warn('Desktop pin menu action failed:', error.message);
          });
      },
    },
  ]);

  menu.popup({ window: senderWindow });
  return { success: true, pinned: isPinned, supportProfile };
});

ipcMain.handle(
  'set-opacity',
  serializeConfigMutationHandler(async (event, opacity) => {
    const sender = authorizeIpcSender(event, 'set-opacity');
    if (!sender) return rejectUnauthorizedIpc('set-opacity');
    const previousOpacity = config.opacity;
    // Ensure opacity is within safe range (50% to 100%)
    const requestedOpacity = Number(opacity);
    let safeOpacity = Number.isFinite(requestedOpacity)
      ? Math.max(0.5, Math.min(1, requestedOpacity))
      : Math.max(0.5, Math.min(1, Number(previousOpacity) || 1));
    try {
      safeOpacity = applyWindowOpacity(mainWindow, safeOpacity, config);
    } catch (error) {
      log.warn('Failed to set main window opacity:', error.message);
    }
    config.opacity = safeOpacity;
    const persistence = await saveConfigDurably();
    if (!persistence.success) {
      config.opacity = previousOpacity;
      try {
        applyWindowOpacity(mainWindow, previousOpacity, config);
      } catch (error) {
        log.warn('Failed to restore main window opacity:', error.message);
      }
      return {
        success: false,
        error: `Failed to save window opacity: ${persistence.error}`,
      };
    }
    return { success: true, opacity: safeOpacity };
  })
);

ipcMain.handle('preview-window-effects', (event, effects = {}) => {
  const sender = authorizeIpcSender(event, 'preview-window-effects');
  if (!sender) return rejectUnauthorizedIpc('preview-window-effects');
  if (!mainWindow) return;
  if (typeof effects.frostedGlass === 'boolean') {
    applyFrostedGlass(effects.frostedGlass);
  }
  if (typeof effects.opacity === 'number') {
    try {
      applyWindowOpacity(mainWindow, effects.opacity, config);
    } catch (error) {
      log.warn('Failed to preview main window opacity:', error.message);
    }
  } else if (typeof effects.frostedGlass === 'boolean') {
    try {
      applyWindowOpacity(mainWindow, config.opacity, config);
    } catch (error) {
      log.warn('Failed to preview main window opacity mode:', error.message);
    }
  }
});

ipcMain.handle(
  'set-always-on-top',
  serializeConfigMutationHandler(async (event, value) => {
    const sender = authorizeIpcSender(event, 'set-always-on-top');
    if (!sender) return rejectUnauthorizedIpc('set-always-on-top');
    const flag = !!value;
    const previousFlag = !!config.alwaysOnTop;
    config.alwaysOnTop = flag;
    let applied = false;
    try {
      if (popupWindowPresenter.isElevated()) {
        // A popup raise keeps the window above full-screen content until it hides; the new
        // preference is what the presenter falls back to when that raise ends.
        applied = !!mainWindow && !mainWindow.isDestroyed();
      } else {
        applyAlwaysOnTopPreference();
        applied = mainWindow?.isAlwaysOnTop?.() === flag;
      }
    } catch (error) {
      log.warn('Failed to set always on top:', error.message);
    }
    const persistence = await saveConfigDurably();
    if (!persistence.success) {
      config.alwaysOnTop = previousFlag;
      try {
        if (!popupWindowPresenter.isElevated()) {
          applyAlwaysOnTopPreference();
        }
      } catch (error) {
        log.warn('Failed to restore always on top:', error.message);
      }
      return {
        success: false,
        error: `Failed to save always-on-top setting: ${persistence.error}`,
        applied: false,
      };
    }
    return { success: true, applied };
  })
);

ipcMain.handle('get-window-state', (event) => {
  const sender = authorizeIpcSender(event, 'get-window-state');
  if (!sender) return rejectUnauthorizedIpc('get-window-state');
  // The temporary popup raise is not the user's preference, so report the stored value
  // while it is in effect.
  if (popupWindowPresenter.isElevated()) {
    return { alwaysOnTop: !!config.alwaysOnTop };
  }
  return { alwaysOnTop: !!(mainWindow && mainWindow.isAlwaysOnTop && mainWindow.isAlwaysOnTop()) };
});

ipcMain.handle('choose-profile-sync-folder', async (event, provider) => {
  const sender = authorizeIpcSender(event, 'choose-profile-sync-folder');
  if (!sender) return rejectUnauthorizedIpc('choose-profile-sync-folder');
  const profileSync = getProfileSyncConfig();
  const providerToUse = normalizeProfileSyncProvider(provider || profileSync.provider);
  const defaultPath = await getDefaultProfileSyncFolderPath(
    providerToUse,
    profileSync.cloudFilePath
  );
  const result = await dialog.showOpenDialog({
    title: mainT('Choose Profile Sync Folder'),
    defaultPath,
    properties: ['openDirectory', 'createDirectory'],
  });

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
});

ipcMain.handle('copy-profile-sync-file', async (event, fromPath, toPath, overwrite = false) => {
  const sender = authorizeIpcSender(event, 'copy-profile-sync-file');
  if (!sender) {
    return rejectUnauthorizedIpc('copy-profile-sync-file', {
      ok: false,
      status: 'error',
      error: 'Unauthorized',
    });
  }
  return copyProfileSyncFile(fromPath, toPath, overwrite);
});

ipcMain.handle('get-profile-sync-status', (event) => {
  const sender = authorizeIpcSender(event, 'get-profile-sync-status');
  if (!sender) return rejectUnauthorizedIpc('get-profile-sync-status');
  return buildProfileSyncStatus();
});

ipcMain.handle('run-profile-sync', async (event, direction = 'auto') => {
  const sender = authorizeIpcSender(event, 'run-profile-sync');
  if (!sender) return rejectUnauthorizedIpc('run-profile-sync');
  try {
    const allowedDirections = new Set(['auto', 'pull', 'push']);
    const normalizedDirection = allowedDirections.has(direction) ? direction : 'auto';
    return await runProfileSync(normalizedDirection, 'manual');
  } catch (error) {
    return { ok: false, error: error.message, status: buildProfileSyncStatus() };
  }
});

ipcMain.handle(
  'set-profile-sync-passphrase',
  serializeConfigMutationHandler(
    async (event, passphrase, remember = false, desiredEncryptionEnabled = null) => {
      const sender = authorizeIpcSender(event, 'set-profile-sync-passphrase');
      if (!sender) return rejectUnauthorizedIpc('set-profile-sync-passphrase');
      try {
        const candidatePassphrase = typeof passphrase === 'string' ? passphrase.trim() : '';
        if (
          candidatePassphrase &&
          candidatePassphrase.length < PROFILE_SYNC_MIN_PASSPHRASE_LENGTH
        ) {
          return {
            success: false,
            error: `Passphrase must be at least ${PROFILE_SYNC_MIN_PASSPHRASE_LENGTH} characters long`,
          };
        }
        const profileSync = getProfileSyncConfig();

        if (profileSync.passphraseTransition) {
          try {
            await executePendingProfileSyncRewrite();
          } catch (error) {
            return {
              success: false,
              error: `Finish the pending sync-key recovery before changing the passphrase: ${error?.message || String(error)}`,
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
        if (targetEncryptionEnabled && !effectiveNewPassphrase) {
          return {
            success: false,
            error: `Passphrase must be at least ${PROFILE_SYNC_MIN_PASSPHRASE_LENGTH} characters long`,
            status: buildProfileSyncStatus(),
          };
        }

        const remoteResult =
          profileSync.enabled && profileSync.cloudFilePath
            ? await readConfiguredSyncEnvelope()
            : { exists: false, envelope: null };

        if (
          typeof desiredEncryptionEnabled === 'boolean' &&
          typeof profileSync.encryptionChangePending === 'boolean' &&
          desiredEncryptionEnabled === profileSync.encryptionEnabled
        ) {
          const previousPendingTarget = profileSync.encryptionChangePending;
          profileSync.encryptionChangePending = null;
          const cancellationPersistence = await saveConfigDurably({
            allowDebouncedPush: false,
          });
          if (!cancellationPersistence.success) {
            profileSync.encryptionChangePending = previousPendingTarget;
            return {
              success: false,
              error: `Failed to cancel the pending encryption change: ${cancellationPersistence.error}`,
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
              config: sanitizeConfigForRenderer(config),
            };
          }
        }

        if (targetEncryptionEnabled !== profileSync.encryptionEnabled) {
          let localEncryptionCommitPersisted = false;
          const previous = {
            encryptionEnabled: profileSync.encryptionEnabled,
            encryptionChangePending: profileSync.encryptionChangePending,
            remoteRewritePending: profileSync.remoteRewritePending,
            rememberPassphrase: profileSync.rememberPassphrase,
            passphraseEncrypted: profileSync.passphraseEncrypted,
            storedPassphrase: profileSync.storedPassphrase,
            passphraseSession: profileSyncRuntime.passphraseSession,
            passphraseWarning: profileSyncRuntime.passphraseWarning,
          };
          const oldPassphrase = profileSync.encryptionEnabled
            ? candidatePassphrase || activePassphrase
            : '';
          if (profileSync.encryptionEnabled && !oldPassphrase) {
            return {
              success: false,
              error: 'Enter the current remote passphrase before disabling profile encryption',
              status: buildProfileSyncStatus(),
            };
          }

          try {
            if (
              profileSync.firstEnableResolutionPending ||
              !remoteResult.exists ||
              !remoteResult.envelope
            ) {
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
              const persistence = await saveConfigDurably({ allowDebouncedPush: false });
              if (!persistence.success) {
                throw new Error(
                  `Failed to save the requested encryption mode: ${persistence.error}`
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
                      'The missing remote profile could not be created'
                  );
                }
                setupProfileSyncInterval();
              }
              emitProfileSyncStatus();
              return {
                success: true,
                ...persisted,
                status: buildProfileSyncStatus(),
                config: sanitizeConfigForRenderer(config),
              };
            }

            const targetConfig = {
              ...config,
              profileSync: {
                ...profileSync,
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
              baselineConfig: config,
              targetConfig,
              reason: 'encryption_transition',
              remoteResult,
            });
            const result = await executePendingProfileSyncRewrite();
            emitProfileSyncStatus();
            return {
              success: true,
              ...result,
              status: buildProfileSyncStatus(),
              config: sanitizeConfigForRenderer(config),
            };
          } catch (error) {
            if (!profileSync.passphraseTransition && !localEncryptionCommitPersisted) {
              profileSync.encryptionEnabled = previous.encryptionEnabled;
              profileSync.encryptionChangePending = previous.encryptionChangePending;
              profileSync.remoteRewritePending = previous.remoteRewritePending;
              profileSync.rememberPassphrase = previous.rememberPassphrase;
              profileSync.passphraseEncrypted = previous.passphraseEncrypted;
              profileSync.storedPassphrase = previous.storedPassphrase;
              profileSyncRuntime.passphraseSession = previous.passphraseSession;
              profileSyncRuntime.passphraseWarning = previous.passphraseWarning;
            }
            clearProfileSyncTimers();
            if (localEncryptionCommitPersisted) {
              setupProfileSyncInterval();
            }
            updateProfileSyncStatus('error', error?.message || String(error));
            emitProfileSyncStatus();
            return {
              success: false,
              error: `Cannot change profile encryption safely: ${error?.message || String(error)}`,
              status: buildProfileSyncStatus(),
              config: sanitizeConfigForRenderer(config),
            };
          }
        }

        let candidateUnlocksRemote = !remoteResult.exists || !remoteResult.envelope;
        if (remoteResult.exists && remoteResult.envelope) {
          try {
            await decodeRemoteProfileWithPassphrase(
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
              baselineConfig: config,
              targetConfig: config,
              reason: 'passphrase_rekey',
              remoteResult,
            });
            const result = await executePendingProfileSyncRewrite();
            emitProfileSyncStatus();
            return {
              success: true,
              ...result,
              status: buildProfileSyncStatus(),
              config: sanitizeConfigForRenderer(config),
            };
          } catch (error) {
            clearProfileSyncTimers();
            updateProfileSyncStatus('error', error?.message || String(error));
            emitProfileSyncStatus();
            return {
              success: false,
              error: `Cannot change the sync passphrase safely: ${error?.message || String(error)}`,
              status: buildProfileSyncStatus(),
              config: sanitizeConfigForRenderer(config),
            };
          }
        }

        if (passphraseSubmission === 'reject') {
          return {
            success: false,
            error:
              'That passphrase does not unlock the remote profile. Enter the current remote passphrase before attempting a key change.',
            status: buildProfileSyncStatus(),
          };
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
        const persistence = await saveConfigDurably();
        if (!persistence.success) {
          profileSync.rememberPassphrase = previous.rememberPassphrase;
          profileSync.passphraseEncrypted = previous.passphraseEncrypted;
          profileSync.storedPassphrase = previous.storedPassphrase;
          profileSyncRuntime.passphraseSession = previous.passphraseSession;
          profileSyncRuntime.passphraseWarning = previous.passphraseWarning;
          emitProfileSyncStatus();
          return {
            success: false,
            error: `Failed to save sync passphrase: ${persistence.error}`,
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
          resolutionWarning = error?.message || String(error);
          updateProfileSyncStatus('error', resolutionWarning);
        }
        emitProfileSyncStatus();
        return {
          success: true,
          ...persisted,
          warning: resolutionWarning,
          status: buildProfileSyncStatus(),
          config: sanitizeConfigForRenderer(config),
        };
      } catch (error) {
        return { success: false, error: error.message };
      }
    }
  )
);

ipcMain.handle(
  'clear-profile-sync-passphrase',
  serializeConfigMutationHandler(async (event) => {
    const sender = authorizeIpcSender(event, 'clear-profile-sync-passphrase');
    if (!sender) return rejectUnauthorizedIpc('clear-profile-sync-passphrase');
    const profileSync = getProfileSyncConfig();
    if (hasProfileSyncCredentialTransitionPending(profileSync)) {
      return {
        success: false,
        error:
          'The passphrase cannot be cleared until the pending encryption change or remote rewrite succeeds',
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
    const persistence = await saveConfigDurably();
    if (!persistence.success) {
      profileSync.rememberPassphrase = previous.rememberPassphrase;
      profileSync.passphraseEncrypted = previous.passphraseEncrypted;
      profileSync.storedPassphrase = previous.storedPassphrase;
      profileSyncRuntime.passphraseSession = previous.passphraseSession;
      profileSyncRuntime.passphraseWarning = previous.passphraseWarning;
      emitProfileSyncStatus();
      return {
        success: false,
        error: `Failed to clear sync passphrase: ${persistence.error}`,
        status: buildProfileSyncStatus(),
      };
    }
    emitProfileSyncStatus();
    return { success: true, status: buildProfileSyncStatus() };
  })
);

ipcMain.handle(
  'resolve-profile-sync-first-enable',
  serializeConfigMutationHandler(async (event, choice) => {
    const sender = authorizeIpcSender(event, 'resolve-profile-sync-first-enable');
    if (!sender) return rejectUnauthorizedIpc('resolve-profile-sync-first-enable');
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
        error: 'Finish the pending encryption or key recovery before resolving this conflict',
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
            config: sanitizeConfigForRenderer(config),
          };
        }
        return {
          success: false,
          error: 'A remote profile conflict was found. Review it and choose again.',
          status: buildProfileSyncStatus(),
          config: sanitizeConfigForRenderer(config),
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
        const persistence = await saveConfigDurably();
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
            error: `Failed to save profile sync cancellation: ${persistence.error}`,
            status: buildProfileSyncStatus(),
            config: sanitizeConfigForRenderer(config),
          };
        }
        emitProfileSyncStatus();
        return {
          success: true,
          status: buildProfileSyncStatus(),
          config: sanitizeConfigForRenderer(config),
        };
      }

      if (choice === 'upload_local') {
        const remoteResult = await verifyPendingRemoteEnvelopeUnchanged();
        const result = await runProfileSyncInternal('push', 'first_enable_resolution', {
          expectedRemoteIdentity: getSyncEnvelopeIdentity(remoteResult),
        });
        if (result?.ok !== true || result?.reason === 'remote_changed') {
          throw new Error(
            result?.reason === 'remote_changed'
              ? 'The remote profile changed during upload; review the conflict and try again'
              : result?.error || result?.reason || 'Profile upload did not complete'
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
          config: sanitizeConfigForRenderer(config),
        };
      }

      if (choice === 'use_remote') {
        const remoteResult = await verifyPendingRemoteEnvelopeUnchanged();
        const envelope = remoteResult.envelope;
        if (!envelope) {
          throw new Error('Remote profile is no longer available');
        }
        const { profile: remoteProfile, syncScope: remoteSyncScope } =
          await decodeEnvelopeProfile(envelope);
        profileSyncRuntime.needsResolution = false;
        profileSyncRuntime.pendingRemoteEnvelope = null;
        profileSyncRuntime.pendingRemoteIdentity = null;
        await backupLocalProfileBeforePullApply(remoteSyncScope);
        await applySyncedProfileToConfig(remoteProfile, envelope.updatedAt, remoteSyncScope);
        if (getProfileSyncConfig().remoteRewritePending) {
          const rewriteResult = await runProfileSyncInternal('push', 'first_enable_resolution', {
            expectedRemoteIdentity: getSyncEnvelopeIdentity(remoteResult),
          });
          if (rewriteResult?.ok !== true || rewriteResult?.reason === 'remote_changed') {
            throw new Error(
              rewriteResult?.reason === 'remote_changed'
                ? 'The remote profile changed before encryption could be applied; review it again'
                : rewriteResult?.error ||
                    'The accepted remote profile could not be rewritten safely'
            );
          }
        }
        await clearProfileSyncFirstEnableResolutionPending();
        updateProfileSyncStatus('success', '');
        setupProfileSyncInterval();
        emitProfileSyncStatus();
        return {
          success: true,
          status: buildProfileSyncStatus(),
          config: sanitizeConfigForRenderer(config),
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
      updateProfileSyncStatus('error', error.message);
      emitProfileSyncStatus();
      return { success: false, error: error.message, status: buildProfileSyncStatus() };
    }
  })
);

// Start at login IPC handlers
ipcMain.handle('get-login-item-settings', (event) => {
  const sender = authorizeIpcSender(event, 'get-login-item-settings');
  if (!sender) return rejectUnauthorizedIpc('get-login-item-settings');
  try {
    if (process.platform === 'win32') {
      const startupTarget = getWindowsStartupRegistrationTarget();
      const legacyStartupTarget = getWindowsStartupRegistrationTarget({ quotePath: false });
      const settings = app.getLoginItemSettings(getWindowsStartupLookupOptions(startupTarget));
      let openAtLogin = isWindowsLoginItemEnabled(settings, startupTarget.executablePath);
      let legacySettings = null;

      if (!openAtLogin && legacyStartupTarget.path !== startupTarget.path) {
        legacySettings = app.getLoginItemSettings(
          getWindowsStartupLookupOptions(legacyStartupTarget)
        );
        openAtLogin = isWindowsLoginItemEnabled(legacySettings, startupTarget.executablePath);
      }

      log.debug('Login item settings:', { settings, legacySettings });
      return { openAtLogin, supported: true };
    }

    if (process.platform === 'linux') {
      const executablePath = getLinuxStartupExecutablePath(app, process.env);
      const openAtLogin = isLinuxLoginItemEnabled({
        pkg,
        appName: app.getName(),
        executablePath,
        env: process.env,
      });
      return { openAtLogin, supported: true };
    }

    const settings = app.getLoginItemSettings();
    const openAtLogin = Boolean(settings.openAtLogin);
    log.debug('Login item settings:', settings);
    return { openAtLogin, supported: true };
  } catch (error) {
    log.error('Failed to get login item settings:', error);
    return { openAtLogin: false, supported: false, error: error.message };
  }
});

ipcMain.handle('set-login-item-settings', (event, openAtLogin) => {
  const sender = authorizeIpcSender(event, 'set-login-item-settings');
  if (!sender) return rejectUnauthorizedIpc('set-login-item-settings');
  try {
    const normalizedOpenAtLogin = !!openAtLogin;
    if (process.platform === 'linux') {
      const executablePath = getLinuxStartupExecutablePath(app, process.env);
      setLinuxLoginItemSettings(normalizedOpenAtLogin, {
        pkg,
        appName: app.getName(),
        executablePath,
        env: process.env,
      });
      const confirmedOpenAtLogin = isLinuxLoginItemEnabled({
        pkg,
        appName: app.getName(),
        executablePath,
        env: process.env,
      });
      return { success: true, openAtLogin: confirmedOpenAtLogin, supported: true };
    }

    const startupTarget = process.platform === 'win32' ? getWindowsStartupRegistrationTarget() : {};
    const loginItemSettings = {
      openAtLogin: normalizedOpenAtLogin,
      ...(process.platform === 'win32'
        ? {
            path: startupTarget.path,
            args: startupTarget.args,
            name: startupTarget.name,
          }
        : startupTarget),
    };

    if (process.platform === 'win32') {
      // Keep Windows startup approval in sync with the toggle state.
      loginItemSettings.enabled = normalizedOpenAtLogin;
    }

    const withWindowsSuffix = process.platform === 'win32' ? ' with Windows' : '';
    log.info(
      `Setting app to ${normalizedOpenAtLogin ? 'start' : 'not start'}${withWindowsSuffix}`,
      loginItemSettings
    );
    app.setLoginItemSettings(loginItemSettings);

    if (process.platform === 'win32') {
      const settings = app.getLoginItemSettings(getWindowsStartupLookupOptions(startupTarget));
      const confirmedOpenAtLogin = isWindowsLoginItemEnabled(
        settings,
        startupTarget.executablePath
      );
      if (confirmedOpenAtLogin !== normalizedOpenAtLogin) {
        const error = `Windows startup setting did not persist as ${normalizedOpenAtLogin ? 'enabled' : 'disabled'}`;
        log.warn(error, settings);
        return { success: false, error, openAtLogin: confirmedOpenAtLogin };
      }
      return { success: true, openAtLogin: confirmedOpenAtLogin, supported: true };
    }

    return { success: true, openAtLogin: normalizedOpenAtLogin, supported: true };
  } catch (error) {
    log.error('Failed to set login item settings:', error);
    return { success: false, error: error.message, supported: false };
  }
});

ipcMain.handle('restart-app', async (event) => {
  const sender = authorizeIpcSender(event, 'restart-app');
  if (!sender) return rejectUnauthorizedIpc('restart-app');
  log.info('Restarting application');
  try {
    await flushConfigForBoundedExit('restarting');
    shutDownRuntimeAfterConfigFlush();
    quitFinalized = true;
    app.relaunch();
    app.exit(0);
    return { success: true };
  } catch (error) {
    log.warn('Failed to restart app:', error.message);
    return { success: false, error: error?.message || String(error) };
  }
});

ipcMain.handle('minimize-window', (event) => {
  const sender = authorizeIpcSender(event, 'minimize-window');
  if (!sender) return rejectUnauthorizedIpc('minimize-window');
  if (mainWindow) {
    if (usesCompositorOwnedPlacement) {
      hideMainWindowToTray();
    } else {
      mainWindow.minimize();
    }
  }
});

ipcMain.handle('focus-window', (event) => {
  const sender = authorizeIpcSender(event, 'focus-window');
  if (!sender) return rejectUnauthorizedIpc('focus-window');
  return focusMainWindow();
});

ipcMain.handle('focus-desktop-pin', (event, entityId) => {
  const sender = authorizeIpcSender(event, 'focus-desktop-pin');
  if (!sender) return rejectUnauthorizedIpc('focus-desktop-pin');
  return focusDesktopPinWindow(normalizeEntityId(entityId));
});

// Updates IPC
ipcMain.handle('check-for-updates', async (event) => {
  const sender = authorizeIpcSender(event, 'check-for-updates');
  if (!sender) return rejectUnauthorizedIpc('check-for-updates');
  return checkForUpdatesForCurrentPackage();
});

async function checkForUpdatesForCurrentPackage() {
  if (!app.isPackaged) return { status: 'dev' };
  if (isPortableBuild()) {
    return checkPortableUpdate();
  }
  if (!supportsAutoUpdater(process.platform, process.env)) {
    return checkManualReleaseUpdate();
  }
  try {
    const autoUpdater = getAutoUpdater();
    configureAutoUpdaterChannel(autoUpdater);
    const info = await autoUpdater.checkForUpdates();
    return { status: 'checking', info };
  } catch (e) {
    return { status: 'error', error: e?.message };
  }
}

ipcMain.handle('quit-and-install', async (event) => {
  const sender = authorizeIpcSender(event, 'quit-and-install');
  if (!sender) return rejectUnauthorizedIpc('quit-and-install');
  if (!app.isPackaged) {
    return { success: false, error: 'Update install is only available in packaged builds' };
  }
  if (isPortableBuild() || !supportsAutoUpdater(process.platform, process.env)) {
    return { success: false, error: 'In-app updates are not supported for this package' };
  }
  if (!autoUpdateDownloaded) {
    return { success: false, error: 'No downloaded update is ready to install' };
  }
  try {
    const autoUpdater = getAutoUpdater();
    await flushConfigForBoundedExit('installing the update');
    // electron-updater closes windows before Electron emits before-quit, so the
    // config and pending window bounds must already be durable at this point.
    quitFinalized = true;
    autoUpdater.quitAndInstall();
    return { success: true };
  } catch (error) {
    if (quitFinalized) {
      quitFinalized = false;
      quitFinalizationStarted = false;
      isQuitting = false;
      configMutationQueueClosed = false;
      configShutdownPending = false;
      setupProfileSyncInterval();
    }
    log.warn('Failed to install downloaded update:', error.message);
    return { success: false, error: error?.message || String(error) };
  }
});

// Handle quit request from renderer
ipcMain.handle('quit-app', (event) => {
  const sender = authorizeIpcSender(event, 'quit-app');
  if (!sender) return rejectUnauthorizedIpc('quit-app');
  isQuitting = true;
  app.quit();
});

ipcMain.handle('get-app-version', (event) => {
  const sender = authorizeIpcSender(event, 'get-app-version');
  if (!sender) return rejectUnauthorizedIpc('get-app-version');
  return app.getVersion();
});

// Log file viewer functionality
ipcMain.handle('open-logs', (event) => {
  const sender = authorizeIpcSender(event, 'open-logs');
  if (!sender) return rejectUnauthorizedIpc('open-logs');
  try {
    let logFilePath = null;
    try {
      if (
        log?.transports?.file?.resolvePath &&
        typeof log.transports.file.resolvePath === 'function'
      ) {
        logFilePath = log.transports.file.resolvePath();
      }
    } catch (error) {
      log.debug('Could not resolve log file path via resolvePath:', error.message);
    }

    if (!logFilePath) {
      try {
        const fileInfo = log?.transports?.file?.getFile && log.transports.file.getFile();
        if (fileInfo && fileInfo.path) {
          logFilePath = fileInfo.path;
        }
      } catch (error) {
        log.debug('Could not get log file info via getFile:', error.message);
      }
    }

    if (!logFilePath) {
      throw new Error('Could not resolve log file path from electron-log');
    }

    log.info(`Opening log file at: ${logFilePath}`);
    shell.showItemInFolder(logFilePath);
    return { success: true, path: logFilePath };
  } catch (error) {
    log.error('Failed to open log file:', error);
    return { success: false, error: error?.message || String(error) };
  }
});

ipcMain.handle('open-external', async (event, url) => {
  const sender = authorizeIpcSender(event, 'open-external');
  if (!sender) return rejectUnauthorizedIpc('open-external');
  try {
    if (!url || typeof url !== 'string') {
      return { success: false, error: 'Invalid URL' };
    }
    const parsed = new URL(url);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return { success: false, error: 'Only http/https URLs are allowed' };
    }
    await shell.openExternal(parsed.toString());
    return { success: true };
  } catch (error) {
    return { success: false, error: error?.message || String(error) };
  }
});

ipcMain.handle('debug-log', (event, payload) => {
  const sender = authorizeIpcSender(event, 'debug-log', { allowDesktopPin: true });
  if (!sender) return rejectUnauthorizedIpc('debug-log');
  try {
    if (typeof payload === 'string') {
      log.info(`[RendererDebug] ${payload}`);
      return { success: true };
    }

    if (payload && typeof payload === 'object') {
      const scope = String(payload.scope || 'renderer');
      const eventName = String(payload.event || 'log');
      const details = payload.details && typeof payload.details === 'object' ? payload.details : {};
      let serializedDetails = '';

      try {
        serializedDetails = JSON.stringify(details);
      } catch (error) {
        serializedDetails = `{"serializationError":"${error.message}"}`;
      }

      const maxLength = 6000;
      const safeDetails =
        serializedDetails.length > maxLength
          ? `${serializedDetails.slice(0, maxLength)}...[truncated]`
          : serializedDetails;

      log.info(`[RendererDebug][${scope}] ${eventName} ${safeDetails}`);
      return { success: true };
    }

    log.info(`[RendererDebug] ${String(payload)}`);
    return { success: true };
  } catch (error) {
    log.error('Failed to persist renderer debug log:', error);
    return { success: false, error: error?.message || String(error) };
  }
});

// Global Hotkey IPC Handlers
ipcMain.handle(
  'register-hotkey',
  serializeConfigMutationHandler(async (event, entityId, hotkey, action) => {
    const sender = authorizeIpcSender(event, 'register-hotkey');
    if (!sender) return rejectUnauthorizedIpc('register-hotkey');
    const normalizedEntityId = normalizeIpcEntityIdForKey(entityId);
    if (!normalizedEntityId) {
      return { success: false, error: 'Invalid entity ID' };
    }

    if (!validateHotkey(hotkey)) {
      return {
        success: false,
        error: 'Invalid hotkey format or conflicts with common system shortcuts',
      };
    }

    if (
      typeof config.popupHotkey === 'string' &&
      config.popupHotkey.toLowerCase() === hotkey.toLowerCase()
    ) {
      return { success: false, error: 'Hotkey already assigned to the popup trigger' };
    }

    // Check for conflicts with existing hotkeys first
    // Handle both string (legacy) and object (new) formats
    const existingEntity = findConfiguredEntityHotkey(hotkey, normalizedEntityId);

    if (existingEntity) {
      const entityName = existingEntity[0] || 'another action';
      return { success: false, error: `Hotkey already assigned to ${entityName}` };
    }

    if (config.globalHotkeys.enabled && usesCompositorOwnedPlacement) {
      await ensurePortalShortcutsBackendInitialized();
    }

    const previousHotkey = config.globalHotkeys.hotkeys[normalizedEntityId];
    config.globalHotkeys.hotkeys[normalizedEntityId] = { hotkey, action };

    // Only register if hotkeys are enabled
    if (config.globalHotkeys.enabled) {
      const registrationResult = portalShortcutsActive
        ? await syncPortalShortcuts({ immediate: true })
        : registerGlobalHotkeys();
      const portalBinding = registrationResult?.bound?.find(
        (entry) => entry.id === PORTAL_ENTITY_SHORTCUT_PREFIX + normalizedEntityId
      );
      const registered = portalShortcutsActive
        ? registrationResult.success && !!portalBinding?.trigger
        : !usesCompositorOwnedPlacement && globalShortcut.isRegistered(hotkey);

      if (!registered) {
        log.warn(
          `Failed to register hotkey: ${hotkey}. It might be in use or unapproved by the desktop.`
        );
        if (previousHotkey === undefined) {
          delete config.globalHotkeys.hotkeys[normalizedEntityId];
        } else {
          config.globalHotkeys.hotkeys[normalizedEntityId] = previousHotkey;
        }
        const rollbackResult = await Promise.resolve(
          portalShortcutsActive ? syncPortalShortcuts({ immediate: true }) : registerGlobalHotkeys()
        );
        const rollbackWarning =
          rollbackResult?.success === false
            ? rollbackResult.error || 'Previous hotkey bindings could not be restored'
            : '';
        return {
          success: false,
          error:
            (registrationResult?.error ||
              'Hotkey is in use, unsupported, or was not approved by the desktop') +
            (rollbackWarning ? `. Rollback failed: ${rollbackWarning}` : ''),
          rollbackWarning,
        };
      }
    }

    const persistence = await saveConfigDurably();
    if (!persistence.success) {
      if (previousHotkey === undefined) {
        delete config.globalHotkeys.hotkeys[normalizedEntityId];
      } else {
        config.globalHotkeys.hotkeys[normalizedEntityId] = previousHotkey;
      }
      const rollbackResult = await Promise.resolve(
        portalShortcutsActive ? syncPortalShortcuts({ immediate: true }) : registerGlobalHotkeys()
      );
      const rollbackWarning =
        rollbackResult?.success === false
          ? rollbackResult.error || 'Previous hotkey bindings could not be restored'
          : '';
      return {
        success: false,
        error: `Failed to save hotkey: ${persistence.error}${rollbackWarning ? `. Rollback failed: ${rollbackWarning}` : ''}`,
        rollbackWarning,
      };
    }

    return {
      success: true,
      backend: portalShortcutsActive ? PORTAL_SHORTCUTS_BACKEND : 'globalShortcut',
    };
  })
);

ipcMain.handle(
  'unregister-hotkey',
  serializeConfigMutationHandler(async (event, entityId) => {
    const sender = authorizeIpcSender(event, 'unregister-hotkey');
    if (!sender) return rejectUnauthorizedIpc('unregister-hotkey');
    const normalizedEntityId = normalizeIpcEntityIdForKey(entityId);
    if (!normalizedEntityId) {
      return { success: false, error: 'Invalid entity ID' };
    }
    const previousHotkey = config.globalHotkeys.hotkeys[normalizedEntityId];
    delete config.globalHotkeys.hotkeys[normalizedEntityId];
    let registrationResult;
    if (portalShortcutsActive && portalShortcutsController) {
      // Close the prior portal session first so this target is removed even if an
      // unrelated remaining accelerator cannot be rebound afterwards.
      await portalShortcutsController.syncShortcuts([]);
      registrationResult = await syncPortalShortcuts({ immediate: true });
    } else {
      registrationResult = await Promise.resolve(registerGlobalHotkeys());
    }
    const persistence = await saveConfigDurably();
    if (!persistence.success) {
      if (previousHotkey !== undefined) {
        config.globalHotkeys.hotkeys[normalizedEntityId] = previousHotkey;
        const rollbackResult = await Promise.resolve(
          portalShortcutsActive ? syncPortalShortcuts({ immediate: true }) : registerGlobalHotkeys()
        );
        const rollbackWarning =
          rollbackResult?.success === false
            ? rollbackResult.error || 'Previous hotkey bindings could not be restored'
            : '';
        return {
          success: false,
          error: `Failed to save hotkey removal: ${persistence.error}${rollbackWarning ? `. Rollback failed: ${rollbackWarning}` : ''}`,
          rollbackWarning,
        };
      }
      return { success: false, error: `Failed to save hotkey removal: ${persistence.error}` };
    }
    return {
      success: true,
      warning:
        registrationResult?.success === false
          ? registrationResult.error ||
            'The hotkey was removed, but another shortcut could not be activated'
          : '',
    };
  })
);

ipcMain.handle('register-hotkeys', async (event) => {
  const sender = authorizeIpcSender(event, 'register-hotkeys');
  if (!sender) return rejectUnauthorizedIpc('register-hotkeys');
  if (usesCompositorOwnedPlacement) {
    await ensurePortalShortcutsBackendInitialized();
  }
  // Re-register all hotkeys (useful after config changes)
  const result = await Promise.resolve(
    portalShortcutsActive ? syncPortalShortcuts({ immediate: true }) : registerGlobalHotkeys()
  );
  return result || { success: true };
});

// DEPRECATED: Use 'update-config' instead for safer config merging
// Whole-config replacement cannot preserve main-owned sync gates or encrypted
// secrets from a sanitized renderer snapshot, so it is intentionally rejected.
ipcMain.handle('save-config', (event) => {
  const sender = authorizeIpcSender(event, 'save-config');
  if (!sender) return rejectUnauthorizedIpc('save-config');
  return {
    success: false,
    error: 'save-config is no longer supported; use update-config',
    config: sanitizeConfigForRenderer(config),
  };
});

ipcMain.handle(
  'toggle-hotkeys',
  serializeConfigMutationHandler(async (event, enabled) => {
    const sender = authorizeIpcSender(event, 'toggle-hotkeys');
    if (!sender) return rejectUnauthorizedIpc('toggle-hotkeys');
    if (enabled && usesCompositorOwnedPlacement) {
      await ensurePortalShortcutsBackendInitialized();
    }
    const previousEnabled = !!config.globalHotkeys.enabled;
    config.globalHotkeys.enabled = !!enabled;

    let registrationResult;
    if (config.globalHotkeys.enabled) {
      registrationResult = await Promise.resolve(
        portalShortcutsActive ? syncPortalShortcuts({ immediate: true }) : registerGlobalHotkeys()
      );
    } else {
      unregisterGlobalHotkeys();
      if (portalShortcutsActive && portalShortcutsController) {
        await portalShortcutsController.syncShortcuts([]);
        registrationResult = await syncPortalShortcuts({ immediate: true });
      } else {
        registrationResult = { success: true };
      }
    }

    if (registrationResult?.success === false && config.globalHotkeys.enabled) {
      config.globalHotkeys.enabled = previousEnabled;
      const rollbackResult = await Promise.resolve(
        portalShortcutsActive ? syncPortalShortcuts({ immediate: true }) : registerGlobalHotkeys()
      );
      const rollbackWarning =
        rollbackResult?.success === false
          ? rollbackResult.error || 'Previous hotkey bindings could not be restored'
          : '';
      return {
        ...registrationResult,
        error: `${registrationResult.error || 'Failed to activate global hotkeys'}${rollbackWarning ? `. Rollback failed: ${rollbackWarning}` : ''}`,
        rollbackWarning,
      };
    }
    const persistence = await saveConfigDurably();
    if (!persistence.success) {
      config.globalHotkeys.enabled = previousEnabled;
      const rollbackResult = await Promise.resolve(
        portalShortcutsActive ? syncPortalShortcuts({ immediate: true }) : registerGlobalHotkeys()
      );
      const rollbackWarning =
        rollbackResult?.success === false
          ? rollbackResult.error || 'Previous hotkey bindings could not be restored'
          : '';
      return {
        success: false,
        error: `Failed to save hotkey setting: ${persistence.error}${rollbackWarning ? `. Rollback failed: ${rollbackWarning}` : ''}`,
        rollbackWarning,
      };
    }
    return {
      success: true,
      warning:
        registrationResult?.success === false
          ? registrationResult.error ||
            'Global hotkeys were disabled, but another shortcut could not be activated'
          : '',
    };
  })
);

ipcMain.handle('validate-hotkey', (event, hotkey) => {
  const sender = authorizeIpcSender(event, 'validate-hotkey');
  if (!sender) return rejectUnauthorizedIpc('validate-hotkey');
  return { valid: validateHotkey(hotkey) };
});

// Entity Alert IPC Handlers
ipcMain.handle(
  'set-entity-alert',
  serializeConfigMutationHandler(async (event, entityId, alertConfig) => {
    const sender = authorizeIpcSender(event, 'set-entity-alert');
    if (!sender) return rejectUnauthorizedIpc('set-entity-alert');
    const normalizedEntityId = normalizeIpcEntityIdForKey(entityId);
    if (!normalizedEntityId) {
      return { success: false, error: 'Invalid entity ID' };
    }
    const previousAlert = config.entityAlerts.alerts[normalizedEntityId];
    config.entityAlerts.alerts[normalizedEntityId] = alertConfig;
    const persistence = await saveConfigDurably();
    if (!persistence.success) {
      if (previousAlert === undefined) {
        delete config.entityAlerts.alerts[normalizedEntityId];
      } else {
        config.entityAlerts.alerts[normalizedEntityId] = previousAlert;
      }
      return { success: false, error: `Failed to save alert: ${persistence.error}` };
    }
    setupEntityAlerts();
    return { success: true };
  })
);

ipcMain.handle(
  'remove-entity-alert',
  serializeConfigMutationHandler(async (event, entityId) => {
    const sender = authorizeIpcSender(event, 'remove-entity-alert');
    if (!sender) return rejectUnauthorizedIpc('remove-entity-alert');
    const normalizedEntityId = normalizeIpcEntityIdForKey(entityId);
    if (!normalizedEntityId) {
      return { success: false, error: 'Invalid entity ID' };
    }
    const previousAlert = config.entityAlerts.alerts[normalizedEntityId];
    delete config.entityAlerts.alerts[normalizedEntityId];
    const persistence = await saveConfigDurably();
    if (!persistence.success) {
      if (previousAlert !== undefined) {
        config.entityAlerts.alerts[normalizedEntityId] = previousAlert;
      }
      return { success: false, error: `Failed to remove alert: ${persistence.error}` };
    }
    setupEntityAlerts();
    return { success: true };
  })
);

ipcMain.handle(
  'toggle-alerts',
  serializeConfigMutationHandler(async (event, enabled) => {
    const sender = authorizeIpcSender(event, 'toggle-alerts');
    if (!sender) return rejectUnauthorizedIpc('toggle-alerts');
    const previousEnabled = !!config.entityAlerts.enabled;
    config.entityAlerts.enabled = !!enabled;
    const persistence = await saveConfigDurably();
    if (!persistence.success) {
      config.entityAlerts.enabled = previousEnabled;
      return { success: false, error: `Failed to save alert setting: ${persistence.error}` };
    }
    setupEntityAlerts();
    return { success: true };
  })
);

// Popup Hotkey IPC Handlers
ipcMain.handle(
  'register-popup-hotkey',
  serializeConfigMutationHandler(async (event, hotkey) => {
    const sender = authorizeIpcSender(event, 'register-popup-hotkey');
    if (!sender) return rejectUnauthorizedIpc('register-popup-hotkey');
    if (usesCompositorOwnedPlacement) {
      await ensurePortalShortcutsBackendInitialized();
    }
    if (usesCompositorOwnedPlacement && !portalShortcutsActive) {
      return {
        success: false,
        error: 'The desktop does not provide the Global Shortcuts portal required on Wayland',
      };
    }
    if (!usesLinuxPopupHotkeyBackend && !uiohookAvailable) {
      return { success: false, error: 'Popup hotkey feature is not available on this platform' };
    }

    // Validate the hotkey
    if (!validateHotkey(hotkey)) {
      return {
        success: false,
        error: 'Invalid hotkey format or conflicts with common system shortcuts',
      };
    }

    const conflictingEntity = findConfiguredEntityHotkey(hotkey);
    if (conflictingEntity) {
      return { success: false, error: `Hotkey already assigned to ${conflictingEntity[0]}` };
    }

    const previousHotkey = config.popupHotkey || '';
    if (!portalShortcutsActive) {
      unregisterPopupHotkey();
    }
    config.popupHotkey = hotkey;
    const registrationResult = await Promise.resolve(
      portalShortcutsActive
        ? syncPortalShortcuts({ immediate: true }).then((result) => {
            if (!result.success) return result;
            const binding = result.bound.find((entry) => entry.id === PORTAL_POPUP_SHORTCUT_ID);
            return binding?.trigger
              ? { success: true, backend: PORTAL_SHORTCUTS_BACKEND, binding }
              : {
                  success: false,
                  backend: PORTAL_SHORTCUTS_BACKEND,
                  error:
                    'The desktop portal did not assign an active popup shortcut. Assign it in system shortcut settings.',
                };
          })
        : registerPopupHotkey()
    );

    if (!registrationResult.success) {
      if (!portalShortcutsActive) {
        // A native backend can fail after partially attaching listeners. Always
        // tear down the candidate before restoring (or clearing) the preference.
        await Promise.resolve(unregisterPopupHotkey());
      }
      config.popupHotkey = previousHotkey;
      let rollbackWarning = '';
      if (previousHotkey) {
        const rollbackResult = await Promise.resolve(
          portalShortcutsActive ? syncPortalShortcuts({ immediate: true }) : registerPopupHotkey()
        );
        if (!rollbackResult.success) {
          log.error('Failed to restore the previous popup hotkey:', rollbackResult.error);
          rollbackWarning =
            rollbackResult.error || 'The previous popup hotkey could not be restored';
        }
      }
      return {
        ...registrationResult,
        error: `${registrationResult.error || 'Failed to register popup hotkey'}${rollbackWarning ? `. Rollback failed: ${rollbackWarning}` : ''}`,
        rollbackWarning,
      };
    }

    const persistence = await saveConfigDurably();
    if (!persistence.success) {
      config.popupHotkey = previousHotkey;
      const rollbackResult = await Promise.resolve(
        portalShortcutsActive ? syncPortalShortcuts({ immediate: true }) : registerPopupHotkey()
      );
      const rollbackWarning =
        rollbackResult?.success === false
          ? rollbackResult.error || 'The previous popup hotkey could not be restored'
          : '';
      return {
        success: false,
        error: `Failed to save popup hotkey: ${persistence.error}${rollbackWarning ? `. Rollback failed: ${rollbackWarning}` : ''}`,
        rollbackWarning,
      };
    }
    return registrationResult;
  })
);

ipcMain.handle(
  'unregister-popup-hotkey',
  serializeConfigMutationHandler(async (event) => {
    const sender = authorizeIpcSender(event, 'unregister-popup-hotkey');
    if (!sender) return rejectUnauthorizedIpc('unregister-popup-hotkey');
    const previousHotkey = config.popupHotkey || '';
    config.popupHotkey = '';
    let unregisterResult;
    if (portalShortcutsActive && portalShortcutsController) {
      // Close the old session first so the removed popup target cannot survive an
      // unrelated failure while rebinding entity shortcuts.
      await portalShortcutsController.syncShortcuts([]);
      unregisterResult = await syncPortalShortcuts({ immediate: true });
    } else {
      unregisterResult = await Promise.resolve(unregisterPopupHotkey());
    }
    const persistence = await saveConfigDurably();
    if (!persistence.success) {
      config.popupHotkey = previousHotkey;
      const rollbackResult = await Promise.resolve(
        portalShortcutsActive ? syncPortalShortcuts({ immediate: true }) : registerPopupHotkey()
      );
      const rollbackWarning =
        rollbackResult?.success === false
          ? rollbackResult.error || 'The previous popup hotkey could not be restored'
          : '';
      return {
        success: false,
        error: `Failed to save popup hotkey removal: ${persistence.error}${rollbackWarning ? `. Rollback failed: ${rollbackWarning}` : ''}`,
        rollbackWarning,
      };
    }
    return {
      success: true,
      backend: unregisterResult?.backend,
      warning:
        unregisterResult?.success === false
          ? unregisterResult.error ||
            'The popup hotkey was removed, but another shortcut could not be activated'
          : '',
    };
  })
);

ipcMain.handle('get-popup-hotkey', (event) => {
  const sender = authorizeIpcSender(event, 'get-popup-hotkey');
  if (!sender) return rejectUnauthorizedIpc('get-popup-hotkey');
  return { hotkey: config.popupHotkey || '' };
});

ipcMain.handle('is-popup-hotkey-available', async (event) => {
  const sender = authorizeIpcSender(event, 'is-popup-hotkey-available');
  if (!sender) return rejectUnauthorizedIpc('is-popup-hotkey-available');
  if (usesCompositorOwnedPlacement) {
    await ensurePortalShortcutsBackendInitialized();
    return portalShortcutsActive;
  }
  return usesLinuxPopupHotkeyBackend || uiohookAvailable;
});

// Global Hotkey Management
//
// Coverage across Linux desktops (no native input hook — uiohook crashed Linux, see 3.7.2):
//   - X11 sessions: Electron globalShortcut (works, invisible to the compositor's settings).
//   - Wayland sessions: globalShortcut is a silent no-op (KWin/Mutter own global shortcuts),
//     so entity + popup hotkeys are routed through the XDG GlobalShortcuts portal instead.
//     Bound shortcuts then show up in the compositor's shortcut settings.
//   - Wayland without a GlobalShortcuts portal (some wlroots compositors): no global hotkeys,
//     but the app degrades gracefully rather than crashing.
// Windows/macOS are unaffected and keep globalShortcut.
const PORTAL_ENTITY_SHORTCUT_PREFIX = 'entity.';
const PORTAL_POPUP_SHORTCUT_ID = 'popup-toggle';
const PORTAL_SYNC_DEBOUNCE_MS = 25;
const PORTAL_RECONNECT_DELAY_MS = 5000;
let portalShortcutsController = null;
let portalShortcutsActive = false;
let portalShortcutsInitPromise = null;
let portalSyncTimer = null;
let portalReconnectTimer = null;
let portalSyncWaiters = [];

function handlePortalShortcutActivated(shortcutId) {
  log.info(`Portal shortcut activated: ${shortcutId}`);
  if (shortcutId === PORTAL_POPUP_SHORTCUT_ID) {
    // A stale portal session can emit briefly after an unregister/rebind
    // failure. Persisted config is authoritative, so a removed shortcut is
    // inert even if that old session still exists.
    if (!String(config?.popupHotkey || '').trim()) return;
    linuxPopupHotkeyController.handleShortcut();
    return;
  }
  if (!shortcutId.startsWith(PORTAL_ENTITY_SHORTCUT_PREFIX)) return;
  if (!config?.globalHotkeys?.enabled) return;

  const entityId = shortcutId.slice(PORTAL_ENTITY_SHORTCUT_PREFIX.length);
  const hotkeyConfig = config.globalHotkeys.hotkeys?.[entityId];
  if (!hotkeyConfig) return;
  const { hotkey, action } =
    typeof hotkeyConfig === 'object' ? hotkeyConfig : { hotkey: hotkeyConfig, action: 'toggle' };
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('hotkey-triggered', { entityId, hotkey, action });
  }
}

function collectPortalShortcuts() {
  const shortcuts = [];
  if (config?.globalHotkeys?.enabled) {
    Object.entries(config.globalHotkeys.hotkeys || {}).forEach(([entityId, hotkeyConfig]) => {
      const { hotkey, action } =
        typeof hotkeyConfig === 'object'
          ? hotkeyConfig
          : { hotkey: hotkeyConfig, action: 'toggle' };
      if (hotkey && hotkey.trim()) {
        shortcuts.push({
          id: PORTAL_ENTITY_SHORTCUT_PREFIX + entityId,
          description: `${action === 'turn_on' ? 'Turn on' : action === 'turn_off' ? 'Turn off' : 'Toggle'} ${entityId}`,
          accelerator: hotkey,
        });
      }
    });
  }
  const popupHotkey = typeof config?.popupHotkey === 'string' ? config.popupHotkey.trim() : '';
  if (popupHotkey) {
    shortcuts.push({
      id: PORTAL_POPUP_SHORTCUT_ID,
      description: 'Show or hide the widget window',
      accelerator: popupHotkey,
    });
  }
  return shortcuts;
}

function reportPortalShortcutSyncResult(result, shortcuts) {
  if (result.success) {
    if (result.bound.length) {
      const summary = result.bound
        .map((entry) => `${entry.id} -> ${entry.trigger || 'unset'}`)
        .join(', ');
      log.info(`Portal shortcuts bound: ${summary}`);
    }
    // A bind the user once dismissed stays approved with no active trigger; the
    // desktop reuses that saved state on every rebind without showing its dialog
    // again, so the only fix is assigning keys in the system shortcut settings.
    const unset = result.bound.filter((entry) => !entry.trigger);
    if (unset.length) {
      log.warn(
        `Portal shortcuts have no active trigger: ${unset.map((entry) => entry.id).join(', ')}. ` +
          'Assign them in your desktop\'s shortcut settings (e.g. KDE System Settings -> Shortcuts -> "HA Desktop Widget").'
      );
      if (mainWindow && !mainWindow.isDestroyed()) {
        unset.forEach((entry) => {
          if (entry.id.startsWith(PORTAL_ENTITY_SHORTCUT_PREFIX)) {
            const entityId = entry.id.slice(PORTAL_ENTITY_SHORTCUT_PREFIX.length);
            const shortcut = shortcuts.find((candidate) => candidate.id === entry.id);
            mainWindow.webContents.send('hotkey-registration-failed', {
              entityId,
              hotkey: shortcut?.accelerator || '',
            });
          }
        });
      }
    }
    return result;
  }

  log.warn(`Portal shortcut binding failed: ${result.error}`);
  if (mainWindow && !mainWindow.isDestroyed()) {
    shortcuts.forEach((shortcut) => {
      if (shortcut.id.startsWith(PORTAL_ENTITY_SHORTCUT_PREFIX)) {
        mainWindow.webContents.send('hotkey-registration-failed', {
          entityId: shortcut.id.slice(PORTAL_ENTITY_SHORTCUT_PREFIX.length),
          hotkey: shortcut.accelerator,
        });
      }
    });
  }
  return result;
}

async function flushPortalShortcutSync() {
  if (portalSyncTimer) {
    clearTimeout(portalSyncTimer);
    portalSyncTimer = null;
  }
  const waiters = portalSyncWaiters;
  portalSyncWaiters = [];
  const shortcuts = collectPortalShortcuts();
  let result;

  try {
    result = await portalShortcutsController.syncShortcuts(shortcuts);
  } catch (error) {
    result = {
      success: false,
      backend: PORTAL_SHORTCUTS_BACKEND,
      bound: [],
      error: error?.message || String(error),
    };
  }

  reportPortalShortcutSyncResult(result, shortcuts);
  waiters.forEach((resolve) => resolve(result));
  return result;
}

// Debounced so back-to-back register/unregister calls collapse into one portal
// rebind. Callers that need transactional registration can request an immediate
// flush and await the portal's actual bind result.
function syncPortalShortcuts({ immediate = false } = {}) {
  if (!portalShortcutsActive || !portalShortcutsController) {
    return Promise.resolve({
      success: false,
      backend: PORTAL_SHORTCUTS_BACKEND,
      bound: [],
      error: 'Global shortcuts portal is unavailable',
    });
  }

  const completion = new Promise((resolve) => {
    portalSyncWaiters.push(resolve);
  });
  if (portalSyncTimer) clearTimeout(portalSyncTimer);
  if (immediate) {
    void flushPortalShortcutSync();
  } else {
    portalSyncTimer = setTimeout(() => {
      void flushPortalShortcutSync();
    }, PORTAL_SYNC_DEBOUNCE_MS);
  }
  return completion;
}

function schedulePortalConnectionRecovery() {
  if (isQuitting || !portalShortcutsActive || portalReconnectTimer) return;
  portalReconnectTimer = setTimeout(() => {
    portalReconnectTimer = null;
    if (!isQuitting && portalShortcutsActive && portalShortcutsController) {
      void syncPortalShortcuts({ immediate: true });
    }
  }, PORTAL_RECONNECT_DELAY_MS);
}

// On a Wayland session, switch entity + popup hotkeys onto the portal. No-op (keeping the
// globalShortcut path) on X11, non-Linux, or when the compositor lacks the portal.
async function initPortalShortcutsBackend() {
  if (!usesCompositorOwnedPlacement) return;
  try {
    portalShortcutsController = createPortalGlobalShortcutsController({
      log,
      onActivated: handlePortalShortcutActivated,
      onConnectionLost: schedulePortalConnectionRecovery,
    });
    if (!(await portalShortcutsController.isAvailable())) {
      log.info(
        'GlobalShortcuts portal unavailable on this Wayland compositor; global hotkeys may not work here'
      );
      void portalShortcutsController.close();
      portalShortcutsController = null;
      return;
    }
    portalShortcutsActive = true;
    log.info('Using XDG GlobalShortcuts portal for global hotkeys (Wayland session)');
    // Drop the no-op globalShortcut registrations and rebind through the portal.
    unregisterGlobalHotkeys();
    linuxPopupHotkeyController.unregister();
    await syncPortalShortcuts({ immediate: true });
  } catch (error) {
    portalShortcutsActive = false;
    portalShortcutsController = null;
    log.warn(
      'GlobalShortcuts portal init failed; keeping globalShortcut:',
      error?.message || error
    );
  }
}

function ensurePortalShortcutsBackendInitialized() {
  if (!usesCompositorOwnedPlacement) {
    return Promise.resolve(false);
  }
  if (portalShortcutsActive && portalShortcutsController) {
    return Promise.resolve(true);
  }
  if (!portalShortcutsInitPromise) {
    portalShortcutsInitPromise = initPortalShortcutsBackend().then(
      () => {
        const active = portalShortcutsActive;
        if (!active) {
          // A portal or session bus can be late during desktop startup. Do not
          // cache that transient false forever; the next explicit availability
          // check gets one fresh attempt while this promise still coalesces callers.
          portalShortcutsInitPromise = null;
        }
        return active;
      },
      (error) => {
        portalShortcutsInitPromise = null;
        log.warn('Portal shortcut startup initialization failed:', error?.message || error);
        return false;
      }
    );
  }
  return portalShortcutsInitPromise;
}

function registerGlobalHotkeys() {
  if (portalShortcutsActive) {
    return syncPortalShortcuts();
  }
  unregisterGlobalHotkeys();
  if (!config.globalHotkeys.enabled) {
    return { success: true, backend: 'globalShortcut' };
  }
  if (usesCompositorOwnedPlacement) {
    return {
      success: false,
      backend: PORTAL_SHORTCUTS_BACKEND,
      error: 'The desktop does not provide the Global Shortcuts portal required on Wayland',
    };
  }

  // Register each configured hotkey
  let allRegistered = true;
  Object.entries(config.globalHotkeys.hotkeys).forEach(([entityId, hotkeyConfig]) => {
    const { hotkey, action } =
      typeof hotkeyConfig === 'object' ? hotkeyConfig : { hotkey: hotkeyConfig, action: 'toggle' };
    if (hotkey && hotkey.trim()) {
      try {
        const success = globalShortcut.register(hotkey, () => {
          // Send hotkey event to renderer process
          if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.webContents.send('hotkey-triggered', { entityId, hotkey, action });
          }
        });

        if (!success) {
          allRegistered = false;
          log.warn(`Failed to register hotkey: ${hotkey} for entity: ${entityId}`);
          if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.webContents.send('hotkey-registration-failed', { entityId, hotkey });
          }
        } else {
          registeredEntityHotkeyAccelerators.add(hotkey);
          log.info(`Registered hotkey: ${hotkey} for entity: ${entityId}`);
        }
      } catch (error) {
        allRegistered = false;
        log.error(`Error registering hotkey ${hotkey} for entity ${entityId}:`, error);
      }
    }
  });
  return {
    success: allRegistered,
    backend: 'globalShortcut',
    error: allRegistered ? '' : 'One or more entity hotkeys could not be registered',
  };
}

function unregisterGlobalHotkeys() {
  if (portalShortcutsActive) {
    // Portal binds follow the current config; a sync after the caller updates config
    // drops whatever is no longer configured or enabled.
    syncPortalShortcuts();
  }
  registeredEntityHotkeyAccelerators.forEach((accelerator) => {
    try {
      globalShortcut.unregister(accelerator);
    } catch (error) {
      log.warn(`Failed to unregister entity hotkey ${accelerator}:`, error.message);
    }
  });
  registeredEntityHotkeyAccelerators.clear();
}

function validateHotkey(hotkey) {
  if (!hotkey || typeof hotkey !== 'string') return false;

  // A valid hotkey must have at least one non-modifier key.
  // Support multiple modifier name variants: Ctrl/Control, Alt/Option, Shift, Meta/Cmd/Command/Super
  const modifiers = [
    'ctrl',
    'control',
    'alt',
    'option',
    'shift',
    'meta',
    'cmd',
    'command',
    'super',
    'commandorcontrol',
    'cmdorctrl',
  ];
  const keys = hotkey.split('+').map((key) => key.trim());
  const hasModifier = keys.some((key) => modifiers.includes(key.toLowerCase()));
  const nonModifiers = keys.filter((key) => !modifiers.includes(key.toLowerCase()));
  if (!hasModifier || nonModifiers.length !== 1 || !nonModifiers[0].trim()) {
    return false;
  }

  // Check for conflicts with system shortcuts
  const systemShortcuts = [
    'ctrl+alt+del',
    'alt+f4',
    'ctrl+c',
    'ctrl+v',
    'ctrl+x',
    'ctrl+z',
    'ctrl+a',
    'ctrl+s',
    'ctrl+o',
    'ctrl+n',
    'ctrl+w',
    'ctrl+r',
    'alt+tab',
    'ctrl+tab',
    'ctrl+shift+tab',
    'alt+shift+tab',
    'win+l',
    'win+r',
    'win+e',
    'win+d',
    'win+m',
    'win+tab',
  ];

  return !systemShortcuts.includes(hotkey.toLowerCase());
}

function findConfiguredEntityHotkey(hotkey, excludedEntityId = '') {
  if (!hotkey || typeof hotkey !== 'string') return null;
  const normalizedHotkey = hotkey.toLowerCase();

  return (
    Object.entries(config?.globalHotkeys?.hotkeys || {}).find(([entityId, hotkeyConfig]) => {
      if (entityId === excludedEntityId) return false;
      const configuredHotkey =
        typeof hotkeyConfig === 'object' && hotkeyConfig?.hotkey
          ? hotkeyConfig.hotkey
          : hotkeyConfig;
      return (
        typeof configuredHotkey === 'string' && configuredHotkey.toLowerCase() === normalizedHotkey
      );
    }) || null
  );
}

// Popup Hotkey Management
function acceleratorToUIOhookKey(accelerator) {
  if (!uiohookAvailable) return null;
  if (!accelerator || typeof accelerator !== 'string') return null;

  const parts = accelerator.split('+').map((p) => p.trim().toLowerCase());

  // Extract modifiers - support all variants
  const config = {
    ctrl:
      parts.includes('ctrl') ||
      parts.includes('control') ||
      parts.includes('commandorcontrol') ||
      parts.includes('cmdorctrl'),
    alt: parts.includes('alt') || parts.includes('option'),
    shift: parts.includes('shift'),
    meta:
      parts.includes('meta') ||
      parts.includes('cmd') ||
      parts.includes('command') ||
      parts.includes('super'),
  };

  // Get the main key (non-modifier) - include all possible modifier name variants
  const modifiers = [
    'ctrl',
    'control',
    'commandorcontrol',
    'cmdorctrl',
    'alt',
    'option',
    'shift',
    'meta',
    'cmd',
    'command',
    'super',
  ];
  const mainKey = parts.find((p) => !modifiers.includes(p));

  if (!mainKey) return null;

  // Map common keys to UiohookKey codes
  const keyMap = {
    space: UiohookKey.Space,
    enter: UiohookKey.Enter,
    return: UiohookKey.Return,
    tab: UiohookKey.Tab,
    backspace: UiohookKey.Backspace,
    delete: UiohookKey.Delete,
    escape: UiohookKey.Escape,
    esc: UiohookKey.Escape,
    home: UiohookKey.Home,
    end: UiohookKey.End,
    pageup: UiohookKey.PageUp,
    pagedown: UiohookKey.PageDown,
    up: UiohookKey.Up,
    down: UiohookKey.Down,
    left: UiohookKey.Left,
    right: UiohookKey.Right,
    f1: UiohookKey.F1,
    f2: UiohookKey.F2,
    f3: UiohookKey.F3,
    f4: UiohookKey.F4,
    f5: UiohookKey.F5,
    f6: UiohookKey.F6,
    f7: UiohookKey.F7,
    f8: UiohookKey.F8,
    f9: UiohookKey.F9,
    f10: UiohookKey.F10,
    f11: UiohookKey.F11,
    f12: UiohookKey.F12,
    // uiohook-napi names the number-row digit keys '0'..'9' (there is no DigitN alias),
    // so UiohookKey.DigitN is undefined and silently fails to parse digit hotkeys.
    0: UiohookKey['0'],
    1: UiohookKey['1'],
    2: UiohookKey['2'],
    3: UiohookKey['3'],
    4: UiohookKey['4'],
    5: UiohookKey['5'],
    6: UiohookKey['6'],
    7: UiohookKey['7'],
    8: UiohookKey['8'],
    9: UiohookKey['9'],
    a: UiohookKey.A,
    b: UiohookKey.B,
    c: UiohookKey.C,
    d: UiohookKey.D,
    e: UiohookKey.E,
    f: UiohookKey.F,
    g: UiohookKey.G,
    h: UiohookKey.H,
    i: UiohookKey.I,
    j: UiohookKey.J,
    k: UiohookKey.K,
    l: UiohookKey.L,
    m: UiohookKey.M,
    n: UiohookKey.N,
    o: UiohookKey.O,
    p: UiohookKey.P,
    q: UiohookKey.Q,
    r: UiohookKey.R,
    s: UiohookKey.S,
    t: UiohookKey.T,
    u: UiohookKey.U,
    v: UiohookKey.V,
    w: UiohookKey.W,
    x: UiohookKey.X,
    y: UiohookKey.Y,
    z: UiohookKey.Z,
  };

  const keycode = keyMap[mainKey];
  if (!keycode) {
    log.warn(`Unknown key in accelerator: ${mainKey}`);
    return null;
  }

  return { keycode, ...config };
}

/**
 * Register and enable the configured popup hotkey, replacing any previous handlers.
 *
 * Linux uses Electron globalShortcut with press and toggle behavior. Other platforms use uiohook
 * for hold/release detection.
 */
function cleanupUiohookPopupHotkeyRuntime() {
  let cleanupError = null;
  const removeHandler = (eventName, handler) => {
    if (!handler || !uiohookAvailable) return;
    try {
      uIOhook.off(eventName, handler);
    } catch (error) {
      cleanupError ||= error;
      log.warn(`Failed to remove popup ${eventName} handler:`, error.message);
    }
  };

  removeHandler('keydown', popupHotkeyKeydownHandler);
  removeHandler('keyup', popupHotkeyKeyupHandler);
  popupHotkeyKeydownHandler = null;
  popupHotkeyKeyupHandler = null;

  if (uIOhookRunning && uiohookAvailable) {
    try {
      uIOhook.stop();
      log.info('uIOhook stopped, popup hotkey unregistered');
    } catch (error) {
      cleanupError ||= error;
      log.warn('Failed to stop uIOhook while cleaning up popup hotkey:', error.message);
    } finally {
      uIOhookRunning = false;
    }
  }

  popupHotkeyConfig = null;
  popupHotkeyPressed = false;
  _popupHotkeyWindowVisible = false;
  return cleanupError
    ? { success: false, backend: 'uiohook', error: cleanupError?.message || String(cleanupError) }
    : { success: true, backend: 'uiohook' };
}

function registerPopupHotkey() {
  if (!config.popupHotkey || config.popupHotkey.trim() === '') {
    log.debug('No popup hotkey configured, cleaning up');
    return unregisterPopupHotkey();
  }

  if (portalShortcutsActive) {
    return syncPortalShortcuts().then((result) => {
      if (!result.success) return result;
      const popupBinding = result.bound.find((entry) => entry.id === PORTAL_POPUP_SHORTCUT_ID);
      if (!popupBinding?.trigger) {
        return {
          success: false,
          backend: PORTAL_SHORTCUTS_BACKEND,
          error:
            'The desktop portal did not assign an active popup shortcut. Assign it in system shortcut settings.',
        };
      }
      return { success: true, backend: PORTAL_SHORTCUTS_BACKEND, binding: popupBinding };
    });
  }

  if (usesCompositorOwnedPlacement) {
    return {
      success: false,
      backend: PORTAL_SHORTCUTS_BACKEND,
      error: 'The desktop does not provide the Global Shortcuts portal required on Wayland',
    };
  }

  if (usesLinuxPopupHotkeyBackend) {
    return linuxPopupHotkeyController.register(config.popupHotkey);
  }

  if (!uiohookAvailable) {
    log.warn('Cannot register popup hotkey: uiohook-napi not available on this platform');
    return {
      success: false,
      backend: 'uiohook',
      error: 'Popup hotkey feature is not available on this platform',
    };
  }

  const hotkeyConfig = acceleratorToUIOhookKey(config.popupHotkey);
  if (!hotkeyConfig) {
    log.warn(`Failed to parse popup hotkey: ${config.popupHotkey}`);
    return { success: false, backend: 'uiohook', error: 'Unsupported popup hotkey' };
  }

  try {
    // Remove old event handlers before registering new ones
    if (popupHotkeyKeydownHandler) {
      uIOhook.off('keydown', popupHotkeyKeydownHandler);
      log.debug('Removed old keydown handler');
    }
    if (popupHotkeyKeyupHandler) {
      uIOhook.off('keyup', popupHotkeyKeyupHandler);
      log.debug('Removed old keyup handler');
    }

    popupHotkeyConfig = hotkeyConfig;

    // Create new event handlers
    popupHotkeyKeydownHandler = (event) => {
      if (!popupHotkeyConfig) return;

      const { keycode, ctrl, alt, shift, meta } = popupHotkeyConfig;

      // Debug logging
      log.debug(
        `Popup hotkey event: keycode=${event.keycode}, ctrl=${event.ctrlKey}, alt=${event.altKey}, shift=${event.shiftKey}, meta=${event.metaKey}`
      );
      log.debug(
        `Expected config: keycode=${keycode}, ctrl=${ctrl}, alt=${alt}, shift=${shift}, meta=${meta}`
      );

      // Check if this is our hotkey - use Boolean coercion to handle undefined values
      if (
        event.keycode === keycode &&
        Boolean(event.ctrlKey) === ctrl &&
        Boolean(event.altKey) === alt &&
        Boolean(event.shiftKey) === shift &&
        Boolean(event.metaKey) === meta
      ) {
        if (config.popupHotkeyToggleMode) {
          // Smart toggle mode: only hide if window is visible AND focused, otherwise bring to top
          if (mainWindow && !mainWindow.isDestroyed()) {
            const isVisible = mainWindow.isVisible();
            const isFocused = mainWindow.isFocused();
            const now = Date.now();

            // Use timestamp to prevent hiding immediately after showing (debounce 300ms)
            // This handles edge cases where focus detection is unreliable
            const recentlyShown = popupHotkeyLastShownTime && now - popupHotkeyLastShownTime < 300;

            log.debug(
              `Popup hotkey: visible=${isVisible}, focused=${isFocused}, recentlyShown=${recentlyShown}`
            );

            if (isVisible && isFocused && !recentlyShown) {
              // Window is already visible and focused (and not recently shown) - hide it
              log.info('Popup hotkey toggle: window is focused, hiding...');
              popupWindowPresenter.hidePopup(mainWindow);
              _popupHotkeyWindowVisible = false;
              popupHotkeyLastShownTime = null;
              log.debug('Popup hotkey toggle - window hidden');
            } else {
              // Window is hidden, minimized, not focused, or was just shown - bring to top
              log.info('Popup hotkey toggle: bringing window to top...');

              // The raise is held until the next toggle hides the window, otherwise a
              // full-screen video takes the z-order back and the popup disappears.
              popupWindowPresenter.showAboveFullScreen(mainWindow);

              _popupHotkeyWindowVisible = true;
              popupHotkeyLastShownTime = now;
              log.debug('Popup hotkey toggle - window shown above full-screen windows');
            }
          }
        } else {
          // Hold mode (existing behavior): only process if not already pressed
          if (popupHotkeyPressed) return;

          popupHotkeyPressed = true;
          log.info('Popup hotkey matched! Bringing window to front...');

          if (mainWindow && !mainWindow.isDestroyed()) {
            popupWindowPresenter.showAboveFullScreen(mainWindow);
            log.debug('Popup hotkey pressed - window brought to front');
          }
        }
      }
    };

    popupHotkeyKeyupHandler = (event) => {
      if (!popupHotkeyConfig) return;

      // In toggle mode, keyup is ignored
      if (config.popupHotkeyToggleMode) return;

      // Hold mode: only process if hotkey was pressed
      if (!popupHotkeyPressed) return;

      const { keycode } = popupHotkeyConfig;

      // Debug logging
      log.debug(`Popup hotkey keyup: keycode=${event.keycode}, expected=${keycode}`);

      // Check if this is our hotkey being released
      if (event.keycode === keycode) {
        popupHotkeyPressed = false;
        log.info('Popup hotkey released! Restoring window state...');

        if (mainWindow && !mainWindow.isDestroyed()) {
          // Hide window if setting is enabled (Issue #21)
          if (config.popupHotkeyHideOnRelease) {
            popupWindowPresenter.hidePopup(mainWindow);
            log.debug('Popup hotkey released - window hidden');
          } else {
            // Hold mode ends the raise on release, dropping back to the user's
            // always-on-top preference rather than a stale snapshot of it.
            popupWindowPresenter.releaseElevation(mainWindow);
            log.debug('Popup hotkey released - window state restored');
          }
        }
      }
    };

    // Start uIOhook if not already started
    if (!uIOhookRunning) {
      uIOhook.start();
      uIOhookRunning = true;
      log.info('uIOhook started for popup hotkey');
    }

    // Register the new event handlers
    uIOhook.on('keydown', popupHotkeyKeydownHandler);
    uIOhook.on('keyup', popupHotkeyKeyupHandler);

    log.info(`Popup hotkey registered: ${config.popupHotkey}`);
    return { success: true, backend: 'uiohook' };
  } catch (error) {
    log.error('Failed to register popup hotkey:', error);
    cleanupUiohookPopupHotkeyRuntime();
    return { success: false, backend: 'uiohook', error: error?.message || String(error) };
  }
}

/**
 * Unregisters the configured popup hotkey and clears its runtime state.
 *
 * Removes any registered keydown/keyup handlers, stops the uIOhook listener if it is running, and resets related popup-hotkey state flags.
 *
 * Does nothing when the native uiohook integration is unavailable.
 */
function unregisterPopupHotkey() {
  if (portalShortcutsActive) {
    return syncPortalShortcuts();
  }

  if (usesLinuxPopupHotkeyBackend) {
    return linuxPopupHotkeyController.unregister();
  }

  if (!uiohookAvailable) {
    popupHotkeyConfig = null;
    popupHotkeyPressed = false;
    _popupHotkeyWindowVisible = false;
    return { success: true, backend: 'uiohook' };
  }

  return cleanupUiohookPopupHotkeyRuntime();
}

// Entity Alert Management
function setupEntityAlerts() {
  if (!config.entityAlerts.enabled) return;

  // This will be called when entity states change
  // The actual alert logic will be in the renderer process
  log.info('Entity alerts enabled');
}

function getUpdatesConfig() {
  ensureUpdateConfigDefaults(config);
  return config.updates;
}

function configureAutoUpdaterChannel(autoUpdater = getAutoUpdater()) {
  const allowPrerelease = !!getUpdatesConfig().allowPrerelease;
  autoUpdater.allowPrerelease = allowPrerelease;
  return autoUpdater;
}

function selectPortableRelease(releases, allowPrerelease) {
  const currentVersion = normalizeVersion(app.getVersion());
  return (
    (Array.isArray(releases) ? releases : [])
      .filter((release) => release && !release.draft)
      .filter((release) => allowPrerelease || !release.prerelease)
      .filter((release) => {
        const version = normalizeVersion(release.tag_name || release.name || '');
        if (!version) return false;
        return !currentVersion || compareVersions(version, currentVersion) > 0;
      })
      .sort((left, right) => {
        const leftVersion = normalizeVersion(left.tag_name || left.name || '');
        const rightVersion = normalizeVersion(right.tag_name || right.name || '');
        return compareVersions(rightVersion, leftVersion);
      })[0] || null
  );
}

async function fetchGitHubUpdateRelease() {
  const repo = 'Robertg761/HA-Desktop-Widget';
  const allowPrerelease = !!getUpdatesConfig().allowPrerelease;
  const apiUrl = allowPrerelease
    ? `https://api.github.com/repos/${repo}/releases?per_page=20`
    : `https://api.github.com/repos/${repo}/releases/latest`;
  try {
    const response = await axios.get(apiUrl, {
      headers: {
        'User-Agent': 'HA-Desktop-Widget',
        Accept: 'application/vnd.github+json',
      },
      timeout: 10000,
    });

    const releases = Array.isArray(response?.data) ? response.data : [response?.data];
    return selectPortableRelease(releases, allowPrerelease);
  } catch (error) {
    throw new Error(error?.message || String(error));
  }
}

async function checkManualReleaseUpdate() {
  try {
    const release = await fetchGitHubUpdateRelease();
    if (!release) {
      return { status: 'none', message: mainT('You are up to date!') };
    }
    const latestVersion = normalizeVersion(release.tag_name || release.name || '');
    const downloadUrl =
      release.html_url ||
      (pkg.homepage && release.tag_name
        ? `${pkg.homepage}/releases/tag/${encodeURIComponent(release.tag_name)}`
        : pkg.homepage
          ? `${pkg.homepage}/releases`
          : '');
    if (!latestVersion) {
      return {
        status: 'error',
        error: 'Unable to determine the latest release version.',
        downloadUrl,
      };
    }
    return {
      status: 'manual',
      message: `${mainT(
        'This package does not support in-app updates. Open Releases to download the latest build.'
      )} v${latestVersion}`,
      version: latestVersion,
      downloadUrl,
    };
  } catch (error) {
    return { status: 'error', error: error?.message || String(error) };
  }
}

async function checkPortableUpdate() {
  try {
    const release = await fetchGitHubUpdateRelease();
    if (!release) {
      return { status: 'none', message: mainT('You are up to date!') };
    }
    const assets = Array.isArray(release.assets) ? release.assets : [];
    const arch = process.arch || 'x64';
    const archToken = `win-${arch}`;
    let portableAsset = assets.find((asset) => {
      const name = String(asset?.name || '').toLowerCase();
      return name.includes('portable') && name.includes(archToken);
    });
    if (!portableAsset) {
      portableAsset = assets.find((asset) =>
        String(asset?.name || '')
          .toLowerCase()
          .includes('portable')
      );
    }

    const latestVersion = normalizeVersion(release.tag_name || release.name || '');
    const currentVersion = normalizeVersion(app.getVersion());
    const downloadUrl = portableAsset?.browser_download_url || release.html_url || '';
    if (!latestVersion) {
      return {
        status: 'error',
        error: 'Unable to determine the latest Portable release version.',
        downloadUrl,
      };
    }

    if (currentVersion && compareVersions(latestVersion, currentVersion) <= 0) {
      return { status: 'none', message: mainT('You are up to date!') };
    }

    return {
      status: 'portable',
      message: isPrereleaseVersion(latestVersion)
        ? mainT(
            'Portable beta update available: v{{version}}. Click "Download Portable Update" to get the Portable build.',
            { version: latestVersion }
          )
        : mainT(
            'Portable update available: v{{version}}. Click "Download Portable Update" to get the Portable build.',
            { version: latestVersion }
          ),
      version: latestVersion,
      downloadUrl,
    };
  } catch (error) {
    return { status: 'error', error: error?.message || String(error) };
  }
}

// App event handlers
function setupAutoUpdates() {
  if (!app.isPackaged) return;
  if (isPortableBuild()) {
    log.info('Portable build detected; auto-updates are disabled.');
    return;
  }
  if (!supportsAutoUpdater(process.platform, process.env)) {
    log.info(`${process.platform} package does not support in-app auto-updates.`);
    return;
  }
  try {
    const autoUpdater = getAutoUpdater();
    autoUpdater.logger = log;
    autoUpdater.logger.transports.file.level = 'info';
    autoUpdater.autoDownload = true;
    autoUpdater.autoInstallOnAppQuit = true;
    configureAutoUpdaterChannel(autoUpdater);

    autoUpdater.on('checking-for-update', () => {
      autoUpdateDownloaded = false;
      mainWindow?.webContents.send('auto-update', { status: 'checking' });
    });
    autoUpdater.on('update-available', (info) => {
      autoUpdateDownloaded = false;
      mainWindow?.webContents.send('auto-update', { status: 'available', info });
    });
    autoUpdater.on('update-not-available', (info) => {
      autoUpdateDownloaded = false;
      mainWindow?.webContents.send('auto-update', { status: 'none', info });
    });
    autoUpdater.on('download-progress', (progress) => {
      mainWindow?.webContents.send('auto-update', { status: 'downloading', progress });
    });
    autoUpdater.on('update-downloaded', (info) => {
      autoUpdateDownloaded = true;
      mainWindow?.webContents.send('auto-update', { status: 'downloaded', info });
    });
    autoUpdater.on('error', (err) => {
      autoUpdateDownloaded = false;
      mainWindow?.webContents.send('auto-update', { status: 'error', error: err?.message });
    });

    // Keep the first packaged-launch window responsive before doing network/update work.
    setTimeout(() => autoUpdater.checkForUpdatesAndNotify().catch(() => {}), 30000);
  } catch (error) {
    log.error('Auto-update setup failed:', error);
  }
}

function freezePendingWindowBoundsForShutdown() {
  if (windowStateSaveTimer) {
    clearTimeout(windowStateSaveTimer);
    windowStateSaveTimer = null;
  }
  desktopPinWindows.forEach((pinWindow) => {
    if (!pinWindow || pinWindow.isDestroyed()) return;
    if (pinWindow.__desktopPinSaveTimer) {
      clearTimeout(pinWindow.__desktopPinSaveTimer);
      pinWindow.__desktopPinSaveTimer = null;
    }
  });
}

function capturePendingWindowBoundsForShutdown() {
  let changed = false;
  freezePendingWindowBoundsForShutdown();
  if (pendingWindowBounds) {
    if (!usesCompositorOwnedPlacement) {
      config.windowPosition = {
        x: pendingWindowBounds.x,
        y: pendingWindowBounds.y,
      };
    }
    config.windowSize = {
      width: pendingWindowBounds.width,
      height: pendingWindowBounds.height,
    };
    pendingWindowBounds = null;
    changed = true;
  }

  desktopPinWindows.forEach((pinWindow, entityId) => {
    if (!pinWindow || pinWindow.isDestroyed()) return;
    if (!pinWindow.__desktopPinSaveTimer && !pinWindow.__desktopPinPendingBounds) return;
    if (!usesCompositorOwnedPlacement) {
      const bounds =
        pinWindow.__desktopPinPendingBounds || getDesktopPinBounds(entityId, pinWindow.getBounds());
      config.desktopPins = config.desktopPins || {};
      config.desktopPins[entityId] = bounds;
      changed = true;
    }
    pinWindow.__desktopPinPendingBounds = null;
  });
  return changed;
}

async function flushConfigForBoundedExit(actionLabel) {
  if (quitFinalizationStarted || configMutationQueueClosed) {
    throw new Error('An application shutdown is already in progress');
  }
  quitFinalizationStarted = true;
  isQuitting = true;
  freezePendingWindowBoundsForShutdown();
  configMutationQueueClosed = true;
  clearProfileSyncTimers();

  const shutdownAttempt = { canceled: false };
  const finalization = runSerializedConfigMutationUnchecked(() => {
    if (shutdownAttempt.canceled) {
      throw new Error(`The timed-out ${actionLabel} attempt was canceled`);
    }
    capturePendingWindowBoundsForShutdown();
    if (!saveConfig({ allowDebouncedPush: false })) {
      throw new Error(
        lastConfigWriteError || `Failed to prepare configuration before ${actionLabel}`
      );
    }
    const persistence = flushPendingConfigWriteSync({ shutdown: true });
    if (!persistence.success) {
      throw new Error(persistence.error || `Failed to save configuration before ${actionLabel}`);
    }
  });

  let exitTimeout;
  try {
    await Promise.race([
      finalization,
      new Promise((_, reject) => {
        exitTimeout = setTimeout(() => {
          const error = new Error(
            `Timed out waiting for an active settings or profile-sync operation before ${actionLabel}`
          );
          error.code = 'QUIT_FINALIZATION_TIMEOUT';
          reject(error);
        }, QUIT_FINALIZATION_TIMEOUT_MS);
      }),
    ]);
  } catch (error) {
    shutdownAttempt.canceled = true;
    configShutdownPending = false;
    quitFinalizationStarted = false;
    isQuitting = false;
    configMutationQueueClosed = false;
    if (error?.code === 'QUIT_FINALIZATION_TIMEOUT') {
      void finalization
        .catch(() => {})
        .finally(() => {
          if (!quitFinalizationStarted && !configMutationQueueClosed && !isQuitting) {
            setupProfileSyncInterval();
          }
        });
    } else {
      setupProfileSyncInterval();
    }
    throw error;
  } finally {
    if (exitTimeout) clearTimeout(exitTimeout);
  }
}

function shutDownRuntimeAfterConfigFlush() {
  isQuitting = true;
  closeDevReloadWatchers();
  clearProfileSyncTimers();
  clearHomeAssistantOAuthRefreshTimer();
  if (portalShortcutsController) {
    portalShortcutsActive = false;
    if (portalSyncTimer) {
      clearTimeout(portalSyncTimer);
      portalSyncTimer = null;
    }
    if (portalReconnectTimer) {
      clearTimeout(portalReconnectTimer);
      portalReconnectTimer = null;
    }
    const shutdownPortalResult = {
      success: false,
      backend: PORTAL_SHORTCUTS_BACKEND,
      bound: [],
      error: 'Application is shutting down',
    };
    portalSyncWaiters.splice(0).forEach((resolve) => resolve(shutdownPortalResult));
    void portalShortcutsController.close();
    portalShortcutsController = null;
  }
  unregisterGlobalHotkeys();
  unregisterPopupHotkey();
}

app.on('before-quit', (event) => {
  if (!gotSingleInstanceLock || !config) return;
  if (quitFinalized) return;
  event.preventDefault();
  if (quitFinalizationStarted) return;

  void flushConfigForBoundedExit('quitting')
    .then(() => {
      shutDownRuntimeAfterConfigFlush();
      quitFinalized = true;
      app.quit();
    })
    .catch((error) => {
      log.error('Quit canceled because configuration could not be saved:', error);
      dialog.showErrorBox(
        'Could not save settings',
        `The app stayed open because its configuration could not be saved.\n\n${error?.message || String(error)}`
      );
    });
});

// Register custom protocol before creating window
protocol.registerSchemesAsPrivileged([
  {
    scheme: 'ha',
    privileges: {
      secure: true,
      standard: true,
      supportFetchAPI: true,
      corsEnabled: true,
      stream: true,
    },
  },
]);

app
  .whenReady()
  .then(() => {
    // An instance that lost the single-instance lock is already on its way out. It must not load the
    // config, put up a tray icon, or claim the hotkeys that belong to the instance still running.
    if (!gotSingleInstanceLock) return;
    startSmokeTestTimeout();

    installApplicationMenu(Menu);
    installSessionPermissionPolicy(session.defaultSession, {
      rendererEntryPath: path.join(__dirname, 'index.html'),
      isTrustedWebContents: isTrustedAppWebContents,
    });

    // Set app ID for Windows (helps with icon caching and taskbar behavior)
    if (process.platform === 'win32') {
      app.setAppUserModelId('com.github.robertg761.hadesktopwidget');
    }

    loadConfig({ deferSecureStorage: true });
    enableDevelopmentClimateDemo();
    startDevLiveReloadWatchers();

    // Camera proxy: ha://camera/<entityId> (snapshot) and ha://camera_stream/<entityId> (MJPEG)
    try {
      protocol.handle(
        'ha',
        createHaProtocolHandler({
          getConfig: () => config,
          fetchStream: (url, options) => net.fetch(url, options),
          fetchBinary: createElectronNetBinaryFetcher(net),
          fetchExternalBinary: createPinnedDnsBinaryFetcher(),
          isAllowedHlsProxyPath,
          log,
        })
      );
    } catch (error) {
      log.error('Failed to register ha:// protocol', error);
      if (IS_SMOKE_TEST_MODE) {
        finishSmokeTest(false, `Failed to register ha:// protocol: ${error.message}`);
        return;
      }
    }

    createWindow();
    setupAutoUpdates();
    schedulePostWindowStartupTasks();
  })
  .catch((error) => {
    log.error('Application startup failed:', error);
    finishSmokeTest(false, error?.message || String(error));
  });

// XWayland cannot render at all on some machines (a driver stack where Chromium's GPU process
// dies on startup), and the widget would then simply never appear. Rather than leave the user
// with an invisible window, fall back to the native Wayland backend and say so.
const FORCED_X11_GPU_CRASH_LIMIT = 2;
const FORCED_X11_FALLBACK_WINDOW_MS = 20000;
let forcedX11GpuCrashes = 0;
let forcedX11FallbackStarted = false;
let reportedForcedX11RenderFailure = false;
app.on('child-process-gone', (_event, details) => {
  if (!forcedX11Ozone || details?.type !== 'GPU' || forcedX11FallbackStarted) return;
  forcedX11GpuCrashes += 1;

  // Only repeated crashes right after startup mean XWayland cannot render here. A crash later
  // on is ordinary GPU flakiness that Chromium recovers from by itself.
  const duringStartup = Date.now() - processStartedAt <= FORCED_X11_FALLBACK_WINDOW_MS;
  if (!duringStartup || forcedX11GpuCrashes < FORCED_X11_GPU_CRASH_LIMIT) {
    if (!reportedForcedX11RenderFailure) {
      reportedForcedX11RenderFailure = true;
      log.warn(
        `The GPU process exited (${details.reason}) while the widget was running through XWayland.`
      );
    }
    return;
  }

  forcedX11FallbackStarted = true;
  log.error(
    `The GPU process could not start under XWayland (${details.reason}); relaunching on the native ` +
      'Wayland backend. The widget will work, but it will forget its position whenever it is hidden.'
  );

  // Remember the verdict so later starts skip the attempt instead of paying for it every time.
  // Deleting this file makes the widget try XWayland again, e.g. after a driver update.
  try {
    fs.writeFileSync(
      XWAYLAND_UNAVAILABLE_MARKER_PATH,
      `XWayland could not render on this machine (GPU process ${details.reason}).\n` +
        'Delete this file to let the widget try XWayland again, which is what lets it keep its\n' +
        'position when hidden. Background:\n' +
        'https://github.com/Robertg761/HA-Desktop-Widget/blob/main/docs/linux-wayland-notes.md\n'
    );
    log.info(`Recorded the XWayland failure at ${XWAYLAND_UNAVAILABLE_MARKER_PATH}`);
  } catch (error) {
    log.warn(
      'Failed to record the XWayland failure; it will be retried next start:',
      error.message
    );
  }
  // The explicit platform argument is also what stops the relaunched instance from forcing
  // XWayland again, so this cannot loop.
  app.relaunch({ args: process.argv.slice(1).concat('--ozone-platform=wayland') });
  app.quit();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', () => {
  if (mainWindow === null) {
    createWindow();
  }
  syncDesktopPinWindowsWithConfig();
});

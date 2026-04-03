const { app, BrowserWindow, ipcMain, Menu, Tray, screen: electronScreen, shell, protocol, globalShortcut, nativeImage, safeStorage, net, dialog } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const log = require('electron-log');
const { autoUpdater } = require('electron-updater');
const axios = require('axios');
const http = require('http');
const https = require('https');
const profileSyncCore = require('./profile-sync-core.js');
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

// HTTP agents with keep-alive for streaming connections (MJPEG, HLS)
const httpKeepAliveAgent = new http.Agent({
  keepAlive: true,
  keepAliveMsecs: 1000,
  maxSockets: 100,
  maxFreeSockets: 10,
  timeout: 60000
});

const httpsKeepAliveAgent = new https.Agent({
  keepAlive: true,
  keepAliveMsecs: 1000,
  maxSockets: 100,
  maxFreeSockets: 10,
  timeout: 60000
});

const DESKTOP_PIN_WINDOW_CORNER_RADIUS = 24;

function getHeaderValue(headers, name) {
  if (!headers || !name) return undefined;
  const value = headers[String(name).toLowerCase()];
  if (Array.isArray(value)) return value[0];
  return value;
}

function fetchBinaryWithElectronNet(url, headers = {}, timeoutMs = 10000) {
  return new Promise((resolve, reject) => {
    let completed = false;
    const chunks = [];

    const request = net.request({
      method: 'GET',
      url,
      redirect: 'follow',
    });

    Object.entries(headers || {}).forEach(([key, value]) => {
      if (value === undefined || value === null) return;
      request.setHeader(key, String(value));
    });
    request.setHeader('Accept', 'image/avif,image/webp,image/apng,image/*,*/*;q=0.8');

    const timeoutId = setTimeout(() => {
      if (completed) return;
      completed = true;
      try { request.abort(); } catch { /* noop */ }
      reject(new Error(`Artwork request timeout after ${timeoutMs}ms`));
    }, timeoutMs);

    request.on('response', (response) => {
      response.on('data', (chunk) => {
        if (completed) return;
        chunks.push(Buffer.from(chunk));
      });

      response.on('end', () => {
        if (completed) return;
        completed = true;
        clearTimeout(timeoutId);
        resolve({
          status: response.statusCode || 0,
          headers: response.headers || {},
          data: Buffer.concat(chunks),
        });
      });

      response.on('error', (error) => {
        if (completed) return;
        completed = true;
        clearTimeout(timeoutId);
        reject(error);
      });
    });

    request.on('error', (error) => {
      if (completed) return;
      completed = true;
      clearTimeout(timeoutId);
      reject(error);
    });

    request.end();
  });
}

// Try to load uiohook-napi (optional dependency for popup hotkey feature)
let uIOhook, UiohookKey;
let uiohookAvailable = false;
try {
  const module = require('uiohook-napi');
  uIOhook = module.uIOhook;
  UiohookKey = module.UiohookKey;
  uiohookAvailable = true;
  log.info('uiohook-napi loaded successfully');
} catch (error) {
  log.warn('uiohook-napi is not available on this platform. Popup hotkey feature will be disabled.', error.message);
}

// --- Main Log Configuration ---
// This will catch any uncaught errors in your main process
log.errorHandler.startCatching();

// You can customize the log format if you want
log.transports.file.format = '[{y}-{m}-{d} {h}:{i}:{s}.{ms}] [{level}] {text}';

// Set the log level
// 'info' is a good default. Others: 'error', 'warn', 'verbose', 'debug', 'silly'
log.transports.file.level = 'info';
// Keep console quieter (DevTools): only warnings and errors
if (log?.transports?.console) {
  log.transports.console.level = 'warn';
}

// Log the app starting up
log.info('App starting...');

// Set cache paths before app is ready to avoid access issues
const userDataPath = app.getPath('userData');
app.setPath('userData', userDataPath);
app.setPath('sessionData', path.join(userDataPath, 'session'));

let mainWindow;
let tray;
let config;
let isQuitting = false;
const IS_DEV_MODE = process.argv.includes('--dev');
let windowStateSaveTimer = null;
const CONFIG_SAVE_DEBOUNCE_MS = 120;
let configWriteTimer = null;
let configWriteInFlight = false;
let pendingConfigSnapshot = null;
let configSnapshotVersion = 0;
let configWriteEpoch = 0;
let configShutdownPending = false;
const PROFILE_SYNC_PUSH_DEBOUNCE_MS = 2000;
const PROFILE_SYNC_DEFAULT_INTERVAL_MINUTES = 5;
const PROFILE_SYNC_MAX_FILE_BYTES = 512 * 1024;
const PROFILE_SYNC_RESOLUTION_CHOICES = new Set(['upload_local', 'use_remote', 'cancel']);
const PROFILE_SYNC_SUPPORTED_PROVIDERS = new Set(['cloudFile', 'googleDrive', 'icloudDrive', 'syncthing']);
const PROFILE_SYNC_DEFAULT_FILE_NAME = 'ha-widget-profile-sync.json';

const profileSyncRuntime = {
  inFlight: false,
  rerun: null,
  pushDebounceTimer: null,
  intervalTimer: null,
  suppressNextAutoPush: false,
  needsResolution: false,
  pendingRemoteEnvelope: null,
  localProfileHash: null,
  localProfileUpdatedAt: null,
  passphraseSession: '',
  passphraseWarning: '',
};

// Popup hotkey state
let popupHotkeyPressed = false;
let popupHotkeyConfig = null; // Stores { keycode, alt, ctrl, shift, meta }
let wasAlwaysOnTop = false; // Track original alwaysOnTop state
let popupHotkeyKeydownHandler = null; // Reference to keydown handler for cleanup
let popupHotkeyKeyupHandler = null; // Reference to keyup handler for cleanup
let uIOhookRunning = false; // Track whether uIOhook is currently running
let _popupHotkeyWindowVisible = false; // Toggle mode: track whether window is currently shown via hotkey
let popupHotkeyLastShownTime = null;
const desktopPinWindows = new Map();
const desktopPinContentMinBounds = new Map();
const latestEntityStates = new Map();
let hasPublishedHaSnapshot = false;
let desktopPinEditMode = false;
const DEV_RENDERER_BUNDLE_PATH = path.join(__dirname, 'dist-renderer', 'renderer.bundle.js');
const DEV_RELOAD_DEBOUNCE_MS = 220;
const DEV_RELOAD_RETRY_MS = 160;
const DEV_RELOAD_MAX_RETRIES = 20;
let devReloadTimer = null;
let devReloadWatchersStarted = false;
const devReloadWatchers = [];

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

  const triggerLabel = triggerPath
    ? path.relative(__dirname, triggerPath)
    : 'file watcher';

  devReloadTimer = setTimeout(() => {
    attemptDevWindowReload(triggerLabel);
  }, DEV_RELOAD_DEBOUNCE_MS);
}

function watchDevReloadTarget(targetPath, options = {}) {
  if (!IS_DEV_MODE || !targetPath || !fs.existsSync(targetPath)) return;

  try {
    const watcher = fs.watch(targetPath, options, (_eventType, fileName) => {
      const changedPath = fileName
        ? path.join(targetPath, String(fileName))
        : targetPath;
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

function getDefaultProfileSyncFolderPath(_provider, existingPath = '') {
  if (existingPath) {
    const existingFolder = path.dirname(existingPath);
    if (existingFolder && existingFolder !== '.') {
      return existingFolder;
    }
  }
  return app.getPath('userData');
}

function isPortableBuild() {
  if (!app.isPackaged) return false;
  const env = process.env || {};
  return Boolean(env.PORTABLE_EXECUTABLE_DIR || env.PORTABLE_EXECUTABLE_FILE || env.PORTABLE_EXECUTABLE_APP_FILENAME);
}

/**
 * Resolve the executable path/options used for Windows startup registration.
 *
 * Portable builds run from a temporary extracted executable, so we must use
 * PORTABLE_EXECUTABLE_FILE to register the launcher that actually exists
 * across reboots.
 * @returns {{path: string, args: string[]}}
 */
function getWindowsStartupRegistrationTarget() {
  const env = process.env || {};
  const portableExecutable = env.PORTABLE_EXECUTABLE_FILE;
  const portableBuild = isPortableBuild();

  if (portableBuild && portableExecutable) {
    return {
      path: portableExecutable,
      args: []
    };
  }

  if (portableBuild && !portableExecutable) {
    log.warn('Portable build detected but PORTABLE_EXECUTABLE_FILE is not set; startup registration will use app.getPath(\'exe\') which may be an ephemeral path.');
  }

  return {
    path: app.getPath('exe'),
    args: []
  };
}

function normalizeVersion(value) {
  if (!value) return '';
  return String(value).trim().replace(/^v/i, '');
}

function generateProfileSyncDeviceId() {
  const host = (os.hostname && os.hostname()) || 'unknown-host';
  const raw = `${host}-${process.platform}-${process.arch}-${Date.now()}-${Math.random()}`;
  return Buffer.from(raw).toString('base64').replace(/[^a-zA-Z0-9]/g, '').slice(0, 20) || 'device';
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
    rememberPassphrase: false,
    passphraseEncrypted: false,
    storedPassphrase: '',
    lastSyncAt: null,
    lastSyncStatus: 'idle',
    lastSyncError: '',
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
  target.profileSync.cloudFilePath = (typeof target.profileSync.cloudFilePath === 'string' && target.profileSync.cloudFilePath.trim())
    ? target.profileSync.cloudFilePath.trim()
    : getDefaultProfileSyncFilePath();
  target.profileSync.syncScope = getNormalizedProfileSyncScopeValue(target.profileSync.syncScope);
  if (!target.profileSync.deviceId || typeof target.profileSync.deviceId !== 'string') {
    target.profileSync.deviceId = generateProfileSyncDeviceId();
  }
  if (typeof target.profileSync.lastSyncError !== 'string') {
    target.profileSync.lastSyncError = '';
  }
  return target;
}

function getProfileSyncConfig() {
  ensureProfileSyncConfigDefaults(config);
  return config.profileSync;
}

function sanitizeConfigForRenderer(inputConfig) {
  const cloned = JSON.parse(JSON.stringify(inputConfig || {}));
  if (cloned.profileSync) {
    delete cloned.profileSync.storedPassphrase;
  }
  return cloned;
}

function isPlainObject(value) {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function getDesktopPinCascadeOrigin(index = 0) {
  const primaryDisplay = electronScreen.getPrimaryDisplay();
  const workArea = primaryDisplay?.workArea || { x: 0, y: 0, width: 1280, height: 720 };
  return {
    x: workArea.x + 24 + ((index % 4) * 28),
    y: workArea.y + 24 + ((index % 6) * 28),
  };
}

function clampDesktopPinBounds(bounds = {}, entityId = '', fallbackIndex = 0, previousBounds = null) {
  const baseBounds = getDesktopPinBaseBounds(entityId);
  const cascadeOrigin = getDesktopPinCascadeOrigin(fallbackIndex);

  const width = Number.isFinite(Number(bounds.width))
    ? Math.round(Number(bounds.width))
    : baseBounds.width;
  const height = Number.isFinite(Number(bounds.height))
    ? Math.round(Number(bounds.height))
    : baseBounds.height;
  const x = Number.isFinite(Number(bounds.x))
    ? Math.round(Number(bounds.x))
    : cascadeOrigin.x;
  const y = Number.isFinite(Number(bounds.y))
    ? Math.round(Number(bounds.y))
    : cascadeOrigin.y;

  const display = electronScreen.getDisplayMatching({ x, y, width, height });
  const workArea = display?.workArea || electronScreen.getPrimaryDisplay()?.workArea || { x: 0, y: 0, width: 1280, height: 720 };
  return clampDesktopPinBoundsWithWorkArea(bounds, {
    entityId,
    contentMinBounds: desktopPinContentMinBounds.get(entityId) || null,
    fallbackOrigin: cascadeOrigin,
    workArea,
    previousBounds,
  });
}

function applyDesktopPinBoundsToWindow(targetWindow, nextBounds) {
  if (!targetWindow || targetWindow.isDestroyed() || !nextBounds) return;
  try {
    targetWindow.__desktopPinApplyingBounds = true;
    targetWindow.setBounds(nextBounds);
    applyDesktopPinWindowShape(targetWindow, nextBounds);
    targetWindow.__desktopPinApplyingBounds = false;
  } catch (error) {
    targetWindow.__desktopPinApplyingBounds = false;
    log.warn('Failed to apply desktop pin bounds update:', error.message);
  }
}

function syncDesktopPinContentMinBounds(entityId, minBounds = {}) {
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

  desktopPinContentMinBounds.set(normalizedEntityId, normalizedMinBounds);

  const currentBounds = config.desktopPins[normalizedEntityId];
  const clampedBounds = clampDesktopPinBounds(
    currentBounds,
    normalizedEntityId,
    0,
    currentBounds,
  );
  const boundsChanged = clampedBounds.x !== currentBounds.x
    || clampedBounds.y !== currentBounds.y
    || clampedBounds.width !== currentBounds.width
    || clampedBounds.height !== currentBounds.height;

  if (boundsChanged) {
    config.desktopPins[normalizedEntityId] = clampedBounds;
    saveConfig();
    applyDesktopPinBoundsToWindow(desktopPinWindows.get(normalizedEntityId), clampedBounds);
    pushConfigToRenderer();
    sendDesktopPinUpdate(normalizedEntityId, { type: 'bounds' });
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
  const favoriteEntities = Array.isArray(targetConfig.favoriteEntities)
    ? targetConfig.favoriteEntities.map(normalizeEntityId).filter(Boolean)
    : [];
  const favoriteSet = new Set(favoriteEntities);
  const sourcePins = isPlainObject(targetConfig.desktopPins) ? targetConfig.desktopPins : {};
  const nextPins = {};
  let index = 0;

  Object.entries(sourcePins).forEach(([entityId, bounds]) => {
    const normalizedEntityId = normalizeEntityId(entityId);
    if (!normalizedEntityId || !favoriteSet.has(normalizedEntityId)) return;
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

function pinEntityToDesktopInternal(entityId, supportInfo = null) {
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
    return { success: false, error: 'Only Quick Access entities can be pinned in this version', supportProfile };
  }

  const existed = !!config?.desktopPins?.[normalizedEntityId];
  config.desktopPins = config.desktopPins || {};
  config.desktopPins[normalizedEntityId] = getDesktopPinBounds(normalizedEntityId, config.desktopPins[normalizedEntityId]);
  normalizeDesktopPinsConfig(config);
  saveConfig();
  syncDesktopPinWindowsWithConfig({ focusEntityId: normalizedEntityId });
  pushConfigToRenderer();
  broadcastDesktopPinConfigUpdate();

  return {
    success: true,
    pinned: true,
    existed,
    supportProfile,
    pinBounds: config.desktopPins[normalizedEntityId],
  };
}

function applyWindowEffectsToWindow(targetWindow, currentConfig, overrideFrostedGlass) {
  if (!targetWindow || targetWindow.isDestroyed()) return;
  const enabled = typeof overrideFrostedGlass === 'boolean'
    ? overrideFrostedGlass
    : !!currentConfig?.frostedGlass;

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
    targetWindow.setBackgroundColor('#00000000');
  } catch (error) {
    log.warn('Failed to set background color:', error.message);
  }
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
  const safeRadius = Math.max(0, Math.min(Math.floor(radius), Math.floor(safeWidth / 2), Math.floor(safeHeight / 2)));

  if (safeRadius <= 0) {
    return [{ x: 0, y: 0, width: safeWidth, height: safeHeight }];
  }

  const rects = [];
  for (let y = 0; y < safeHeight; y += 1) {
    const topDistance = y;
    const bottomDistance = (safeHeight - 1) - y;
    let inset = 0;

    if (topDistance < safeRadius) {
      const dy = safeRadius - topDistance - 1;
      inset = Math.max(inset, Math.ceil(safeRadius - Math.sqrt(Math.max(0, (safeRadius * safeRadius) - (dy * dy)))));
    }

    if (bottomDistance < safeRadius) {
      const dy = safeRadius - bottomDistance - 1;
      inset = Math.max(inset, Math.ceil(safeRadius - Math.sqrt(Math.max(0, (safeRadius * safeRadius) - (dy * dy)))));
    }

    const rowWidth = Math.max(1, safeWidth - (inset * 2));
    rects.push({ x: inset, y, width: rowWidth, height: 1 });
  }

  return rects;
}

function applyDesktopPinWindowShape(targetWindow, bounds = null) {
  if (!targetWindow || targetWindow.isDestroyed() || typeof targetWindow.setShape !== 'function') return;

  const nextBounds = bounds || targetWindow.getBounds();
  const shape = buildRoundedRectShape(nextBounds.width, nextBounds.height, DESKTOP_PIN_WINDOW_CORNER_RADIUS);

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
    config: sanitizeConfigForRenderer(config),
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

  if (mainWindow.isMinimized()) {
    mainWindow.restore();
  }
  mainWindow.show();
  mainWindow.focus();
  mainWindow.moveTop();

  const wasOnTop = mainWindow.isAlwaysOnTop();
  mainWindow.setAlwaysOnTop(true);
  mainWindow.setAlwaysOnTop(wasOnTop);

  return { focused: mainWindow.isFocused() };
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

function updateDesktopPinBounds(entityId, nextBounds = {}) {
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

  const clampedBounds = clampDesktopPinBounds({
    ...config.desktopPins[normalizedEntityId],
    ...(isPlainObject(nextBounds) ? nextBounds : {}),
  }, normalizedEntityId, 0, config.desktopPins[normalizedEntityId]);

  config.desktopPins[normalizedEntityId] = clampedBounds;
  saveConfig();

  const window = desktopPinWindows.get(normalizedEntityId);
  if (window && !window.isDestroyed()) {
    applyDesktopPinBoundsToWindow(window, clampedBounds);
  }

  pushConfigToRenderer();
  sendDesktopPinUpdate(normalizedEntityId, { type: 'bounds' });
  return { success: true, pinBounds: clampedBounds };
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

  const pinBounds = getDesktopPinBounds(normalizedEntityId, config?.desktopPins?.[normalizedEntityId]);
  config.desktopPins = config.desktopPins || {};
  config.desktopPins[normalizedEntityId] = pinBounds;

  const iconPath = path.join(__dirname, 'build', 'icon.ico');
  const windowOptions = {
    x: pinBounds.x,
    y: pinBounds.y,
    width: pinBounds.width,
    height: pinBounds.height,
    transparent: true,
    backgroundColor: '#00000000',
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
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
      webSecurity: true,
    }
  };

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
  pinWindow.setMenuBarVisibility(false);
  pinWindow.__desktopPinEntityId = normalizedEntityId;
  desktopPinWindows.set(normalizedEntityId, pinWindow);

  try {
    pinWindow.setOpacity(1);
  } catch (error) {
    log.warn('Failed to set desktop pin opacity:', error.message);
  }
  applyDesktopPinWindowShape(pinWindow, pinBounds);
  applyDesktopPinWindowEffects(pinWindow, config);
  applyDesktopPinEditModeToWindow(pinWindow);

  const persistBounds = () => {
    if (!desktopPinEditMode || pinWindow.__desktopPinApplyingBounds) return;
    if (pinWindow.__desktopPinSaveTimer) {
      clearTimeout(pinWindow.__desktopPinSaveTimer);
    }
    pinWindow.__desktopPinSaveTimer = setTimeout(() => {
      pinWindow.__desktopPinSaveTimer = null;
      if (!pinWindow || pinWindow.isDestroyed()) return;
      if (!desktopPinEditMode) return;
      const nextBounds = getDesktopPinBounds(normalizedEntityId, pinWindow.getBounds());
      config.desktopPins = config.desktopPins || {};
      config.desktopPins[normalizedEntityId] = nextBounds;
      saveConfig();
      pushConfigToRenderer();
      sendDesktopPinUpdate(normalizedEntityId, { type: 'bounds' });
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

  pinWindow.loadFile('index.html', { query: { mode: 'desktop-pin', entityId: normalizedEntityId } });
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
      createDesktopPinWindow(entityId, { focus: !!options.focusEntityId && options.focusEntityId === entityId });
      return;
    }

    const currentBounds = window.getBounds();
    const boundsChanged = currentBounds.x !== bounds.x
      || currentBounds.y !== bounds.y
      || currentBounds.width !== bounds.width
      || currentBounds.height !== bounds.height;

    if (boundsChanged) {
      applyDesktopPinBoundsToWindow(window, bounds);
    }

    try {
      window.setOpacity(1);
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
        mainWindow.setAlwaysOnTop(!!nextConfig?.alwaysOnTop);
      }
    } catch (error) {
      log.warn('Failed to apply always-on-top update from sync:', error.message);
    }

    try {
      if (typeof nextConfig?.opacity === 'number' && previousConfig?.opacity !== nextConfig.opacity) {
        const safeOpacity = Math.max(0.5, Math.min(1, nextConfig.opacity));
        mainWindow.setOpacity(safeOpacity);
      }
    } catch (error) {
      log.warn('Failed to apply opacity update from sync:', error.message);
    }

    if (previousConfig?.frostedGlass !== nextConfig?.frostedGlass) {
      applyFrostedGlass();
    }
  }

  desktopPinWindows.forEach((window) => {
    if (!window || window.isDestroyed()) return;
    try {
      window.setOpacity(1);
    } catch (error) {
      log.warn('Failed to update desktop pin opacity:', error.message);
    }

    if (previousConfig?.frostedGlass !== nextConfig?.frostedGlass) {
      applyDesktopPinWindowEffects(window, nextConfig);
    }
  });
}

function pushConfigToRenderer() {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  mainWindow.webContents.send('config-updated', sanitizeConfigForRenderer(config));
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
    needsResolution: !!profileSyncRuntime.needsResolution,
    deviceId: profileSync.deviceId,
    ...extra,
  };
  return status;
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
      profileSyncRuntime.passphraseWarning = 'Stored passphrase could not be decrypted on this system.';
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
    saveConfig();
    return { remembered: false, encrypted: false };
  }

  const hadPersistedPassphrase = !!profileSync.storedPassphrase || profileSync.rememberPassphrase || profileSync.passphraseEncrypted;
  profileSync.rememberPassphrase = true;
  profileSyncRuntime.passphraseSession = passphrase || '';
  profileSyncRuntime.passphraseWarning = '';

  if (safeStorage.isEncryptionAvailable()) {
    try {
      const encrypted = safeStorage.encryptString(passphrase || '');
      profileSync.storedPassphrase = encrypted.toString('base64');
      profileSync.passphraseEncrypted = true;
      saveConfig();
      return { remembered: true, encrypted: true };
    } catch (error) {
      log.warn('Failed to encrypt remembered profile sync passphrase:', error.message);
    }
  }

  profileSync.rememberPassphrase = false;
  profileSync.passphraseEncrypted = false;
  profileSync.storedPassphrase = '';
  profileSyncRuntime.passphraseWarning = 'Passphrase will only be kept for this session because OS encryption is unavailable.';
  if (hadPersistedPassphrase) {
    saveConfig();
  }
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
  const dirPath = path.dirname(filePath);
  const tempPath = `${filePath}.tmp-${Date.now()}`;
  await fs.promises.mkdir(dirPath, { recursive: true });
  await fs.promises.writeFile(tempPath, serialized, 'utf8');
  await fs.promises.rename(tempPath, filePath);
}

async function copyProfileSyncFile(fromPath, toPath, overwrite = false) {
  try {
    const sourcePath = String(fromPath || '').trim();
    const destinationPath = String(toPath || '').trim();
    if (!sourcePath || !destinationPath) {
      return { ok: false, status: 'error', error: 'Source and destination file paths are required' };
    }

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

    const destinationDir = path.dirname(destinationPath);
    await fs.promises.mkdir(destinationDir, { recursive: true });
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

function buildLocalProfileEnvelope(updatedAt = profileSyncRuntime.localProfileUpdatedAt || new Date().toISOString()) {
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

function decodeEnvelopeProfile(envelope) {
  const passphrase = getActiveProfileSyncPassphrase();
  const profile = profileSyncCore.decodeEnvelopeProfile(envelope, passphrase);
  const syncScope = profileSyncCore.extractSyncScopeFromEnvelope(envelope);
  return { profile, syncScope };
}

function applySyncedProfileToConfig(syncedProfile, updatedAt, syncScopeValue = null) {
  const previous = config;
  const nextScope = getNormalizedProfileSyncScopeValue(syncScopeValue || previous?.profileSync?.syncScope);
  const merged = profileSyncCore.mergeSyncedProfileIntoConfig(config, syncedProfile, nextScope);
  ensureProfileSyncConfigDefaults(merged);
  merged.profileSync = {
    ...previous.profileSync,
    syncScope: nextScope,
  };
  config = merged;
  pruneConfig(config);
  ensureProfileSyncConfigDefaults(config);
  normalizeDesktopPinsConfig(config);
  applyMainWindowSettingSideEffects(previous, config);

  const projected = profileSyncCore.projectSyncProfile(config, getActiveProfileSyncScope());
  profileSyncRuntime.localProfileHash = computeScopedProfileHash(projected, getActiveProfileSyncScope());
  profileSyncRuntime.localProfileUpdatedAt = updatedAt || new Date().toISOString();
  profileSyncRuntime.suppressNextAutoPush = true;

  saveConfig();
  syncDesktopPinWindowsWithConfig();
  pushConfigToRenderer();
  broadcastDesktopPinConfigUpdate();
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

  profileSyncRuntime.localProfileHash = nextHash;
  profileSyncRuntime.localProfileUpdatedAt = new Date().toISOString();

  if (profileSyncRuntime.suppressNextAutoPush) {
    profileSyncRuntime.suppressNextAutoPush = false;
    return;
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
  const searchRoots = [
    path.join(__dirname, 'build'),
    __dirname,
  ];

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
    .createFromDataURL('data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAA4AAAAPCAYAAADJViUEAAAAGElEQVQ4T2NkwAT/Gf4zjIGBoRAjGAgjGAgADt4C24gldLoAAAAASUVORK5CYII=')
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
  return target;
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
function loadConfig() {
  log.debug('Loading configuration');
  const userDataDir = app.getPath('userData');
  const configPath = path.join(userDataDir, 'config.json');

  // Default configuration
  const defaultConfig = {
    windowPosition: { x: 100, y: 100 },
    windowSize: { width: 500, height: 600 },
    alwaysOnTop: true,
    opacity: 0.95,
    frostedGlass: true,
    homeAssistant: {
      url: 'http://homeassistant.local:8123',
      token: 'YOUR_LONG_LIVED_ACCESS_TOKEN'
    },
    globalHotkeys: {
      enabled: false,
      hotkeys: {} // entityId -> hotkey combination
    },
    entityAlerts: {
      enabled: false,
      alerts: {} // entityId -> alert configuration
    },
    ui: {
      theme: 'auto',
      accent: 'original',
      background: 'original',
      customColors: [],
      personalizationSectionsCollapsed: {},
      enableInteractionDebugLogs: false
    },
    primaryCards: ['weather', 'time'],
    desktopPins: {},
    customEntityIcons: {},
    popupHotkey: '', // Global hotkey to temporarily bring window to front while held
    popupHotkeyHideOnRelease: false, // Hide window when popup hotkey is released (instead of just restoring z-order)
    popupHotkeyToggleMode: false, // Press once to show, press again to hide (instead of hold)
    profileSync: getDefaultProfileSyncConfig(),
  };

  try {
    if (fs.existsSync(configPath)) {
      const userConfig = JSON.parse(fs.readFileSync(configPath, 'utf8'));
      config = {
        ...defaultConfig, ...userConfig,
        globalHotkeys: { ...defaultConfig.globalHotkeys, ...(userConfig.globalHotkeys || {}) },
        entityAlerts: { ...defaultConfig.entityAlerts, ...(userConfig.entityAlerts || {}) },
        ui: { ...defaultConfig.ui, ...(userConfig.ui || {}) },
        profileSync: { ...defaultConfig.profileSync, ...(userConfig.profileSync || {}) },
      };
      normalizeDesktopPinsConfig(config);
      pruneConfig(config);
      ensureProfileSyncConfigDefaults(config);

      // Handle token encryption/decryption
      if (config.homeAssistant?.tokenEncrypted && config.homeAssistant?.token) {
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
            log.info('Token decrypted successfully');
          } else {
            // Encryption not available - preserve encrypted token on disk but set in-memory token to default
            log.warn('Encryption not available on this system. Encrypted token cannot be decrypted.');
            log.warn('Token preserved on disk. User must re-enter token or use on a system with encryption support.');
            const _encryptedTokenBackup = config.homeAssistant.token; // Keep encrypted version
            config.homeAssistant.token = 'YOUR_LONG_LIVED_ACCESS_TOKEN'; // In-memory default for UI
            config.tokenResetReason = 'encryption_unavailable';
            // Don't save config here - this preserves the encrypted token on disk as a backup
            log.info('Encrypted token preserved in config file. If encryption becomes available, it can be decrypted.');
          }
        } catch (error) {
          // Decryption failed - token may be corrupted or encryption API failed
          log.error('Exception during token decryption:', error);
          log.warn('Encrypted token preserved on disk. User must re-enter token.');
          const _encryptedTokenBackup = config.homeAssistant.token; // Keep encrypted version
          config.homeAssistant.token = 'YOUR_LONG_LIVED_ACCESS_TOKEN'; // In-memory default for UI
          config.tokenResetReason = 'decryption_failed';
          // Don't save config here - this preserves the encrypted token on disk
          log.info('Encrypted token preserved in config file for recovery attempts.');
        }
      } else if (config.homeAssistant?.token &&
        config.homeAssistant.token !== 'YOUR_LONG_LIVED_ACCESS_TOKEN' &&
        !config.homeAssistant?.tokenEncrypted) {
        // Migration: existing plaintext token from pre-encryption version
        log.info('Detected plaintext token from pre-encryption version - attempting migration...');

        // Create backup before migration
        backupConfig();

        try {
          log.debug('Checking if encryption is available for migration...');
          const encryptionAvailable = safeStorage.isEncryptionAvailable();
          log.debug(`Encryption available for migration: ${encryptionAvailable}`);

          if (encryptionAvailable) {
            log.info('Migrating plaintext token to encrypted storage...');
            const plainToken = config.homeAssistant.token;
            try {
              log.debug('Encrypting token...');
              const encryptedBuffer = safeStorage.encryptString(plainToken);
              config.homeAssistant.token = encryptedBuffer.toString('base64');
              config.homeAssistant.tokenEncrypted = true;
              config.migrationInfo = {
                version: app.getVersion(),
                date: new Date().toISOString(),
                tokenEncrypted: true
              };
              log.debug('Saving encrypted config...');
              saveConfig();
              // Restore decrypted token for runtime use
              config.homeAssistant.token = plainToken;
              log.info('Token migration complete - token is now encrypted at rest');
            } catch (error) {
              log.error('Exception during token encryption:', error);
              log.warn('Token encryption failed, keeping plaintext');
              // Keep plaintext token and set flag to prevent retry
              config.homeAssistant.tokenEncrypted = false;
              config.migrationInfo = {
                version: app.getVersion(),
                date: new Date().toISOString(),
                tokenEncrypted: false,
                reason: 'encryption_failed'
              };
              saveConfig(); // Persist the flag to prevent migration retry on every load
              log.info('Token will remain in plaintext storage');
            }
          } else {
            log.info('Encryption not available, keeping token in plaintext');
            // Token stays plaintext - set flag to prevent migration retry
            config.homeAssistant.tokenEncrypted = false;
            config.migrationInfo = {
              version: app.getVersion(),
              date: new Date().toISOString(),
              tokenEncrypted: false,
              reason: 'encryption_unavailable'
            };
            saveConfig(); // Persist the flag to prevent migration retry on every load
            log.info('Token will remain in plaintext storage');
          }
        } catch (error) {
          // Catch any unexpected errors during migration check
          log.error('Unexpected error during migration check:', error);
          log.warn('Migration aborted, keeping token in plaintext');
          config.homeAssistant.tokenEncrypted = false;
          config.migrationInfo = {
            version: app.getVersion(),
            date: new Date().toISOString(),
            tokenEncrypted: false,
            reason: 'migration_error'
          };
          saveConfig();
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
          ensureProfileSyncConfigDefaults(config);
          normalizeDesktopPinsConfig(config);
          migrated = true;
        } catch (error) {
          log.warn('Legacy config exists but could not be parsed, using defaults:', error.message);
          config = defaultConfig;
        }
      } else {
        config = defaultConfig;
      }
      ensureProfileSyncConfigDefaults(config);
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
    config = defaultConfig;
    pruneConfig(config);
    ensureProfileSyncConfigDefaults(config);
    normalizeDesktopPinsConfig(config);
  }

  profileSyncRuntime.passphraseSession = decodeStoredProfileSyncPassphrase() || '';
  const initialProfile = profileSyncCore.projectSyncProfile(config, getActiveProfileSyncScope());
  profileSyncRuntime.localProfileHash = computeScopedProfileHash(initialProfile, getActiveProfileSyncScope());
  profileSyncRuntime.localProfileUpdatedAt = config?.profileSync?.lastSyncAt || new Date().toISOString();
}

// Backup configuration before migration
function backupConfig() {
  const userDataDir = app.getPath('userData');
  const configPath = path.join(userDataDir, 'config.json');
  const backupPath = path.join(userDataDir, 'config.backup.json');
  try {
    if (fs.existsSync(configPath)) {
      const configContent = fs.readFileSync(configPath, 'utf8');
      fs.writeFileSync(backupPath, configContent);
      log.info('Config backup created at', backupPath);
      return true;
    }
  } catch (error) {
    log.warn('Failed to create config backup:', error);
  }
  return false;
}

/**
 * Persist the in-memory configuration to the user's config.json and attempt to secure the Home Assistant token.
 *
 * Writes the current `config` object to the application's userData/config.json. If `homeAssistant.token` is present
 * and not the placeholder value, this function attempts to encrypt the token using Electron's `safeStorage`; on
 * successful encryption the token is stored as a base64 string and `homeAssistant.tokenEncrypted` is set to `true`.
 * If encryption is unavailable or fails, the token is written as plaintext and `homeAssistant.tokenEncrypted` is set to
 * `false`. The in-memory `config` remains unchanged with the token kept in plaintext for runtime use. Errors during
 * the save process are logged; the function does not throw.
 */
function buildConfigSnapshotForSave() {
  const userDataDir = app.getPath('userData');
  const configPath = path.join(userDataDir, 'config.json');
  const snapshotVersion = ++configSnapshotVersion;
  const tempPath = `${configPath}.${snapshotVersion}.tmp`;

  // Create a copy for saving with encrypted token
  const configToSave = JSON.parse(JSON.stringify(config));
  pruneConfig(configToSave);

  // Encrypt token before saving
  // Note: Token is always stored as plaintext in memory (even if decrypted from encrypted storage)
  if (configToSave.homeAssistant?.token &&
    configToSave.homeAssistant.token !== 'YOUR_LONG_LIVED_ACCESS_TOKEN') {
    if (safeStorage.isEncryptionAvailable()) {
      try {
        const plainToken = configToSave.homeAssistant.token;
        const encryptedBuffer = safeStorage.encryptString(plainToken);
        configToSave.homeAssistant.token = encryptedBuffer.toString('base64');
        configToSave.homeAssistant.tokenEncrypted = true;
        log.debug('Token encrypted for storage');
      } catch (error) {
        log.warn('Failed to encrypt token, saving as plaintext:', error);
        configToSave.homeAssistant.tokenEncrypted = false;
        // Keep plaintext token if encryption fails
      }
    } else {
      log.debug('Encryption not available, saving token as plaintext');
      configToSave.homeAssistant.tokenEncrypted = false;
      // Token stays plaintext
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
  };
}

async function writeConfigSnapshotAsync(snapshot) {
  await fs.promises.mkdir(snapshot.userDataDir, { recursive: true });
  await fs.promises.writeFile(snapshot.tempPath, snapshot.serializedConfig, 'utf8');
  if (configShutdownPending || snapshot.epoch !== configWriteEpoch) {
    await fs.promises.unlink(snapshot.tempPath).catch(() => { });
    return;
  }
  await fs.promises.rename(snapshot.tempPath, snapshot.configPath);
}

function flushConfigWriteQueue() {
  if (configWriteInFlight) return;
  if (!pendingConfigSnapshot) return;

  const snapshot = pendingConfigSnapshot;
  pendingConfigSnapshot = null;
  configWriteInFlight = true;

  writeConfigSnapshotAsync(snapshot)
    .catch((error) => {
      log.error('Failed to save config asynchronously:', error);
    })
    .finally(() => {
      configWriteInFlight = false;
      if (pendingConfigSnapshot) {
        flushConfigWriteQueue();
      }
    });
}

function flushPendingConfigWriteSync() {
  configShutdownPending = true;
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
      return;
    }
  }

  try {
    fs.mkdirSync(snapshot.userDataDir, { recursive: true });
    fs.writeFileSync(snapshot.tempPath, snapshot.serializedConfig, 'utf8');
    fs.renameSync(snapshot.tempPath, snapshot.configPath);
  } catch (error) {
    log.error('Failed to flush config synchronously:', error);
    try {
      if (snapshot?.tempPath && fs.existsSync(snapshot.tempPath)) {
        fs.unlinkSync(snapshot.tempPath);
      }
    } catch {
      // best effort cleanup
    }
  }
}

function saveConfig() {
  log.debug('Scheduling configuration save');
  try {
    pendingConfigSnapshot = buildConfigSnapshotForSave();
    if (configWriteTimer) {
      clearTimeout(configWriteTimer);
    }
    configWriteTimer = setTimeout(() => {
      configWriteTimer = null;
      flushConfigWriteQueue();
    }, CONFIG_SAVE_DEBOUNCE_MS);
    updateLocalProfileSyncTracking();
  } catch (error) {
    log.error('Failed to schedule config save:', error);
  }
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
  if (!profileSync.enabled || profileSyncRuntime.needsResolution || !profileSync.cloudFilePath) {
    return;
  }

  const intervalMs = Math.max(1, Number(profileSync.intervalMinutes) || PROFILE_SYNC_DEFAULT_INTERVAL_MINUTES) * 60 * 1000;
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

  if (!profileSync.enabled || !profileSync.cloudFilePath) {
    return { needsResolution: false };
  }

  const readResult = await readConfiguredSyncEnvelope();
  if (!readResult.exists || !readResult.envelope) {
    return { needsResolution: false };
  }

  const { profile: remoteProfile, syncScope } = decodeEnvelopeProfile(readResult.envelope);
  const localProfile = profileSyncCore.projectSyncProfile(config, syncScope);
  const localHash = computeScopedProfileHash(localProfile, syncScope);
  const remoteHash = computeScopedProfileHash(remoteProfile, syncScope);
  if (remoteHash === localHash) {
    return { needsResolution: false };
  }

  profileSyncRuntime.needsResolution = true;
  profileSyncRuntime.pendingRemoteEnvelope = readResult.envelope;
  updateProfileSyncStatus('needs_resolution', 'Choose how to resolve initial profile sync conflict.');
  emitProfileSyncStatus();
  return { needsResolution: true };
}

function scheduleDebouncedProfileSyncPush(source = 'config_change') {
  const profileSync = getProfileSyncConfig();
  if (!profileSync.enabled || profileSyncRuntime.needsResolution) return;
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

async function runProfileSync(direction = 'auto', source = 'manual') {
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
  if (profileSyncRuntime.needsResolution && source !== 'first_enable_resolution') {
    return { ok: false, reason: 'needs_resolution', status: buildProfileSyncStatus() };
  }

  if (profileSyncRuntime.inFlight) {
    profileSyncRuntime.rerun = { direction, source };
    return { ok: false, reason: 'in_flight', queued: true, status: buildProfileSyncStatus() };
  }

  profileSyncRuntime.inFlight = true;
  emitProfileSyncStatus();

  try {
    const localEnvelope = buildLocalProfileEnvelope(profileSyncRuntime.localProfileUpdatedAt || new Date().toISOString());
    const remoteResult = await readConfiguredSyncEnvelope();
    let finalDirection = direction;

    if (direction === 'auto') {
      finalDirection = profileSyncCore.chooseSyncDirection({
        localUpdatedAt: localEnvelope.updatedAt,
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

      const { profile: remoteProfile, syncScope: remoteSyncScope } = decodeEnvelopeProfile(remoteResult.envelope);
      const localProfile = profileSyncCore.projectSyncProfile(config, remoteSyncScope);
      const localHash = computeScopedProfileHash(localProfile, remoteSyncScope);
      const remoteHash = computeScopedProfileHash(remoteProfile, remoteSyncScope);
      if (remoteHash !== localHash || source === 'first_enable_resolution') {
        applySyncedProfileToConfig(remoteProfile, remoteResult.envelope.updatedAt, remoteSyncScope);
      }
      profileSyncRuntime.localProfileUpdatedAt = remoteResult.envelope.updatedAt;
      updateProfileSyncStatus('success', '');
      setupProfileSyncInterval();
      const status = buildProfileSyncStatus();
      emitProfileSyncStatus();
      return { ok: true, action: 'pull', status, config: sanitizeConfigForRenderer(config) };
    }

    if (finalDirection === 'push') {
      const envelopeToWrite = buildLocalProfileEnvelope(new Date().toISOString());
      await writeConfiguredSyncEnvelope(envelopeToWrite);
      profileSyncRuntime.localProfileUpdatedAt = envelopeToWrite.updatedAt;
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
    if (profileSyncRuntime.rerun) {
      const rerun = profileSyncRuntime.rerun;
      profileSyncRuntime.rerun = null;
      runProfileSync(rerun.direction, rerun.source).catch((error) => {
        log.warn('Queued profile sync rerun failed:', error.message);
      });
    }
  }
}

async function initializeProfileSyncOnStartup() {
  setupProfileSyncInterval();
  const profileSync = getProfileSyncConfig();
  if (!profileSync.enabled || !profileSync.cloudFilePath) return;
  if (profileSyncRuntime.needsResolution || profileSyncRuntime.pendingRemoteEnvelope) return;

  try {
    await runProfileSync('pull', 'startup');
  } catch (error) {
    log.warn('Profile sync startup pull failed:', error.message);
  }
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
  const iconPath = path.join(__dirname, 'build', 'icon.ico');

  // Create the browser window with transparency
  const windowOptions = {
    x: config.windowPosition.x,
    y: config.windowPosition.y,
    width: config.windowSize.width,
    height: config.windowSize.height,
    transparent: true,
    backgroundColor: '#00000000',
    frame: false,
    alwaysOnTop: config.alwaysOnTop,
    skipTaskbar: true,
    resizable: true,
    movable: true,
    icon: iconPath,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false, // Security: disabled, renderer uses bundled code
      contextIsolation: true, // Security: enabled, uses contextBridge for IPC
      webSecurity: true
    }
  };

  if (config.frostedGlass) {
    if (process.platform === 'win32') {
      windowOptions.backgroundMaterial = 'acrylic';
    } else if (process.platform === 'darwin') {
      windowOptions.vibrancy = 'sidebar';
    }
  }

  mainWindow = new BrowserWindow(windowOptions);

  // Set window opacity with failsafe
  const safeOpacity = Math.max(0.5, Math.min(1, config.opacity || 1));
  mainWindow.setOpacity(safeOpacity);
  config.opacity = safeOpacity; // Update config to safe value
  applyFrostedGlass();

  // Load the index.html file
  mainWindow.loadFile('index.html');
  mainWindow.webContents.on('did-finish-load', () => {
    emitProfileSyncStatus();
    pushConfigToRenderer();
  });

  const changeWin = () => {
    const bounds = mainWindow.getBounds();

    config.windowPosition = { x: bounds.x, y: bounds.y };
    config.windowSize = { width: bounds.width, height: bounds.height };
    if (windowStateSaveTimer) {
      clearTimeout(windowStateSaveTimer);
    }
    windowStateSaveTimer = setTimeout(() => {
      windowStateSaveTimer = null;
      saveConfig();
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

function createTray() {
  log.info('Creating system tray icon');
  // Resolve a tray icon that works in dev and production
  const pkg = require('./package.json');

  tray = new Tray(resolveTrayIcon());

  const contextMenu = Menu.buildFromTemplate([
    {
      label: 'Show/Hide',
      click: () => {
        if (mainWindow.isVisible()) {
          mainWindow.hide();
        } else {
          // Restore window size before showing to prevent resizing issues
          mainWindow.setSize(config.windowSize.width, config.windowSize.height);
          mainWindow.show();
        }
      }
    },
    {
      label: 'Always on Top',
      type: 'checkbox',
      checked: config.alwaysOnTop,
      click: (menuItem) => {
        config.alwaysOnTop = menuItem.checked;
        mainWindow.setAlwaysOnTop(config.alwaysOnTop);
        saveConfig();
      }
    },
    {
      label: 'Reset Position',
      click: () => {
        mainWindow.setPosition(100, 100);
        config.windowPosition = { x: 100, y: 100 };
        saveConfig();
      }
    },
    { type: 'separator' },
    {
      label: 'DevTools',
      click: () => {
        mainWindow.webContents.openDevTools({ mode: 'detach' });
      }
    },
    {
      label: 'Reload',
      click: () => {
        mainWindow.reload();
      }
    },
    { type: 'separator' },
    {
      label: 'Open Settings',
      click: () => {
        if (mainWindow) {
          // Restore window size before showing to prevent resizing issues
          mainWindow.setSize(config.windowSize.width, config.windowSize.height);
          mainWindow.show();
          mainWindow.webContents.send('open-settings');
        }
      }
    },
    {
      label: 'Check for Updates',
      click: () => {
        if (app.isPackaged) {
          if (isPortableBuild()) {
            checkPortableUpdate().then((result) => {
              if (mainWindow && result) {
                mainWindow.webContents.send('auto-update', result);
              }
            }).catch((error) => {
              if (mainWindow) {
                mainWindow.webContents.send('auto-update', { status: 'error', error: error?.message || String(error) });
              }
            });
          } else {
            autoUpdater.checkForUpdates();
          }
        } else {
          log.info('Update check is only available in packaged builds.');
        }
      }
    },
    {
      label: 'Report Issue',
      click: () => {
        const url = (pkg && pkg.bugs && pkg.bugs.url) || (pkg && pkg.homepage) || 'https://github.com/';
        shell.openExternal(url);
      }
    },
    { type: 'separator' },
    {
      label: 'Quit',
      click: () => {
        isQuitting = true;
        app.quit();
      }
    }
  ]);

  tray.setToolTip('Home Assistant Widget');
  tray.setContextMenu(contextMenu);

  tray.on('click', () => {
    if (!mainWindow) return;
    if (mainWindow.isVisible()) {
      mainWindow.hide();
    } else {
      // Restore window size before showing to prevent resizing issues
      mainWindow.setSize(config.windowSize.width, config.windowSize.height);
      mainWindow.show();
      mainWindow.focus();
    }
  });
}

// IPC handlers for configuration
ipcMain.handle('get-config', () => {
  return sanitizeConfigForRenderer(config);
});

ipcMain.handle('update-config', async (event, newConfig) => {
  log.debug('Updating configuration');
  const prevConfig = config;
  const prevSyncEnabled = !!config?.profileSync?.enabled;
  pruneConfig(newConfig);
  const customTabs = { ...(config.customTabs || {}), ...(newConfig.customTabs || {}) };
  const profileSync = { ...(config.profileSync || {}), ...(newConfig.profileSync || {}) };
  config = { ...config, ...newConfig, customTabs, profileSync };
  ensureProfileSyncConfigDefaults(config);
  normalizeDesktopPinsConfig(config);
  pruneConfig(config);
  applyMainWindowSettingSideEffects(prevConfig, config);

  const syncEnabled = !!config.profileSync?.enabled;
  if (!syncEnabled) {
    profileSyncRuntime.needsResolution = false;
    profileSyncRuntime.pendingRemoteEnvelope = null;
    clearProfileSyncTimers();
  } else if (!prevSyncEnabled && syncEnabled) {
    try {
      const resolution = await prepareProfileSyncFirstEnableResolution();
      if (!resolution?.needsResolution) {
        setupProfileSyncInterval();
      }
    } catch (error) {
      updateProfileSyncStatus('error', error.message);
    }
  } else {
    setupProfileSyncInterval();
  }

  saveConfig();
  syncDesktopPinWindowsWithConfig();
  pushConfigToRenderer();
  broadcastDesktopPinConfigUpdate();
  emitProfileSyncStatus();
  return sanitizeConfigForRenderer(config);
});

ipcMain.handle('pin-entity-to-desktop', (_event, entityId, supportInfo = null) => {
  return pinEntityToDesktopInternal(entityId, supportInfo);
});

ipcMain.handle('set-desktop-pin-edit-mode', (_event, enabled) => {
  return setDesktopPinEditMode(enabled);
});

ipcMain.handle('update-desktop-pin-bounds', (_event, entityId, nextBounds = {}) => {
  return updateDesktopPinBounds(entityId, nextBounds);
});

ipcMain.handle('sync-desktop-pin-content-min-bounds', (_event, entityId, minBounds = {}) => {
  return syncDesktopPinContentMinBounds(entityId, minBounds);
});

ipcMain.handle('unpin-entity-from-desktop', (_event, entityId) => {
  const normalizedEntityId = normalizeEntityId(entityId);
  if (!normalizedEntityId) {
    return { success: false, error: 'Invalid entity ID' };
  }

  if (config?.desktopPins?.[normalizedEntityId]) {
    delete config.desktopPins[normalizedEntityId];
  }
  desktopPinContentMinBounds.delete(normalizedEntityId);
  saveConfig();
  syncDesktopPinWindowsWithConfig();
  pushConfigToRenderer();
  broadcastDesktopPinConfigUpdate();

  return { success: true, pinned: false };
});

ipcMain.handle('get-desktop-pin-bootstrap', (_event, entityId) => {
  const normalizedEntityId = normalizeEntityId(entityId);
  return {
    entityId: normalizedEntityId,
    entity: latestEntityStates.get(normalizedEntityId) || null,
    hasSnapshot: hasPublishedHaSnapshot,
    pinBounds: config?.desktopPins?.[normalizedEntityId] || null,
    config: sanitizeConfigForRenderer(config),
    isPinned: !!config?.desktopPins?.[normalizedEntityId],
    editMode: desktopPinEditMode,
  };
});

ipcMain.handle('publish-ha-snapshot', (_event, states) => {
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

ipcMain.handle('publish-ha-entity-update', (_event, entity) => {
  const normalizedEntityId = normalizeEntityId(entity?.entity_id);
  if (!normalizedEntityId || !isPlainObject(entity)) {
    return { success: false, error: 'Invalid entity payload' };
  }

  latestEntityStates.set(normalizedEntityId, entity);
  sendDesktopPinUpdate(normalizedEntityId, { type: 'entity' });
  return { success: true };
});

ipcMain.handle('request-desktop-pin-action', (_event, entityId, action, payload = {}) => {
  const normalizedEntityId = normalizeEntityId(entityId);
  const normalizedAction = typeof action === 'string' ? action.trim() : '';
  if (!normalizedEntityId || !normalizedAction) {
    return { success: false, error: 'Invalid desktop pin action' };
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

  mainWindow.webContents.send('desktop-pin-action-requested', {
    entityId: normalizedEntityId,
    action: normalizedAction,
    payload: isPlainObject(payload) ? payload : {},
  });
  return { success: true, forwarded: true };
});

ipcMain.handle('show-entity-tile-menu', (event, entityId, supportInfo = null) => {
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
  const menu = Menu.buildFromTemplate([
    {
      label: isPinned
        ? 'Unpin from Desktop'
        : (canPinToDesktop ? 'Pin to Desktop' : 'Desktop Pin Not Supported Yet'),
      enabled: isPinned || canPinToDesktop,
      click: () => {
        if (isPinned) {
          if (config?.desktopPins?.[normalizedEntityId]) {
            delete config.desktopPins[normalizedEntityId];
          }
          saveConfig();
          syncDesktopPinWindowsWithConfig();
          pushConfigToRenderer();
          broadcastDesktopPinConfigUpdate();
        } else {
          pinEntityToDesktopInternal(normalizedEntityId, supportProfile);
        }
      }
    }
  ]);

  menu.popup({ window: senderWindow });
  return { success: true, pinned: isPinned, supportProfile };
});

ipcMain.handle('set-opacity', (event, opacity) => {
  // Ensure opacity is within safe range (50% to 100%)
  const safeOpacity = Math.max(0.5, Math.min(1, opacity));
  mainWindow.setOpacity(safeOpacity);
  config.opacity = safeOpacity;
  saveConfig();
});

ipcMain.handle('preview-window-effects', (event, effects = {}) => {
  if (!mainWindow) return;
  if (typeof effects.opacity === 'number') {
    const safeOpacity = Math.max(0.5, Math.min(1, effects.opacity));
    mainWindow.setOpacity(safeOpacity);
  }
  if (typeof effects.frostedGlass === 'boolean') {
    applyFrostedGlass(effects.frostedGlass);
  }
});

ipcMain.handle('set-always-on-top', (event, value) => {
  const flag = !!value;
  config.alwaysOnTop = flag;
  try {
    mainWindow.setAlwaysOnTop(flag);
  } catch (error) {
    log.warn('Failed to set always on top:', error.message);
  }
  saveConfig();
  return { applied: mainWindow?.isAlwaysOnTop?.() === flag };
});

ipcMain.handle('get-window-state', () => {
  return { alwaysOnTop: !!(mainWindow && mainWindow.isAlwaysOnTop && mainWindow.isAlwaysOnTop()) };
});

ipcMain.handle('choose-profile-sync-folder', async (_event, provider) => {
  const profileSync = getProfileSyncConfig();
  const providerToUse = normalizeProfileSyncProvider(provider || profileSync.provider);
  const defaultPath = getDefaultProfileSyncFolderPath(providerToUse, profileSync.cloudFilePath);
  const result = await dialog.showOpenDialog({
    title: 'Choose Profile Sync Folder',
    defaultPath,
    properties: ['openDirectory', 'createDirectory'],
  });

  const folderPath = Array.isArray(result.filePaths) ? result.filePaths[0] : '';
  if (result.canceled || !folderPath) {
    return { canceled: true };
  }

  const filePath = path.join(folderPath, PROFILE_SYNC_DEFAULT_FILE_NAME);
  return { canceled: false, folderPath, filePath, provider: providerToUse };
});

ipcMain.handle('copy-profile-sync-file', async (_event, fromPath, toPath, overwrite = false) => {
  return copyProfileSyncFile(fromPath, toPath, overwrite);
});

ipcMain.handle('get-profile-sync-status', () => {
  return buildProfileSyncStatus();
});

ipcMain.handle('run-profile-sync', async (_event, direction = 'auto') => {
  try {
    const allowedDirections = new Set(['auto', 'pull', 'push']);
    const normalizedDirection = allowedDirections.has(direction) ? direction : 'auto';
    return await runProfileSync(normalizedDirection, 'manual');
  } catch (error) {
    return { ok: false, error: error.message, status: buildProfileSyncStatus() };
  }
});

ipcMain.handle('set-profile-sync-passphrase', async (_event, passphrase, remember = false) => {
  try {
    if (typeof passphrase !== 'string' || passphrase.trim().length < 4) {
      return { success: false, error: 'Passphrase must be at least 4 characters long' };
    }
    const persisted = persistRememberedProfileSyncPassphrase(passphrase.trim(), !!remember);
    emitProfileSyncStatus();
    return { success: true, ...persisted, status: buildProfileSyncStatus() };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle('clear-profile-sync-passphrase', async () => {
  profileSyncRuntime.passphraseSession = '';
  const profileSync = getProfileSyncConfig();
  profileSync.rememberPassphrase = false;
  profileSync.passphraseEncrypted = false;
  profileSync.storedPassphrase = '';
  profileSyncRuntime.passphraseWarning = '';
  saveConfig();
  emitProfileSyncStatus();
  return { success: true, status: buildProfileSyncStatus() };
});

ipcMain.handle('resolve-profile-sync-first-enable', async (_event, choice) => {
  if (!PROFILE_SYNC_RESOLUTION_CHOICES.has(choice)) {
    return { success: false, error: 'Invalid resolution choice', status: buildProfileSyncStatus() };
  }

  if (!profileSyncRuntime.needsResolution) {
    return { success: true, status: buildProfileSyncStatus() };
  }

  try {
    if (choice === 'cancel') {
      getProfileSyncConfig().enabled = false;
      profileSyncRuntime.needsResolution = false;
      profileSyncRuntime.pendingRemoteEnvelope = null;
      clearProfileSyncTimers();
      saveConfig();
      emitProfileSyncStatus();
      return { success: true, status: buildProfileSyncStatus(), config: sanitizeConfigForRenderer(config) };
    }

    if (choice === 'upload_local') {
      profileSyncRuntime.needsResolution = false;
      profileSyncRuntime.pendingRemoteEnvelope = null;
      const result = await runProfileSync('push', 'first_enable_resolution');
      setupProfileSyncInterval();
      return { success: true, ...result, status: buildProfileSyncStatus(), config: sanitizeConfigForRenderer(config) };
    }

    if (choice === 'use_remote') {
      const envelope = profileSyncRuntime.pendingRemoteEnvelope || (await readConfiguredSyncEnvelope()).envelope;
      if (!envelope) {
        throw new Error('Remote profile is no longer available');
      }
      const { profile: remoteProfile, syncScope: remoteSyncScope } = decodeEnvelopeProfile(envelope);
      profileSyncRuntime.needsResolution = false;
      profileSyncRuntime.pendingRemoteEnvelope = null;
      applySyncedProfileToConfig(remoteProfile, envelope.updatedAt, remoteSyncScope);
      updateProfileSyncStatus('success', '');
      setupProfileSyncInterval();
      emitProfileSyncStatus();
      return { success: true, status: buildProfileSyncStatus(), config: sanitizeConfigForRenderer(config) };
    }
  } catch (error) {
    updateProfileSyncStatus('error', error.message);
    emitProfileSyncStatus();
    return { success: false, error: error.message, status: buildProfileSyncStatus() };
  }
});

// Start with Windows IPC handlers
ipcMain.handle('get-login-item-settings', () => {
  try {
    const lookupOptions = process.platform === 'win32'
      ? getWindowsStartupRegistrationTarget()
      : undefined;
    const settings = app.getLoginItemSettings(lookupOptions);
    const openAtLogin = lookupOptions
      ? Boolean(settings.executableWillLaunchAtLogin ?? settings.openAtLogin)
      : Boolean(settings.openAtLogin);
    log.debug('Login item settings:', settings);
    return { openAtLogin };
  } catch (error) {
    log.error('Failed to get login item settings:', error);
    return { openAtLogin: false };
  }
});

ipcMain.handle('set-login-item-settings', (event, openAtLogin) => {
  try {
    const normalizedOpenAtLogin = !!openAtLogin;
    const startupTarget = process.platform === 'win32'
      ? getWindowsStartupRegistrationTarget()
      : {};
    const loginItemSettings = {
      openAtLogin: normalizedOpenAtLogin,
      ...startupTarget
    };

    if (process.platform === 'win32') {
      // Keep Windows startup approval in sync with the toggle state.
      loginItemSettings.enabled = normalizedOpenAtLogin;
    }

    const withWindowsSuffix = process.platform === 'win32' ? ' with Windows' : '';
    log.info(`Setting app to ${normalizedOpenAtLogin ? 'start' : 'not start'}${withWindowsSuffix}`, loginItemSettings);
    app.setLoginItemSettings(loginItemSettings);
    return { success: true, openAtLogin: normalizedOpenAtLogin };
  } catch (error) {
    log.error('Failed to set login item settings:', error);
    return { success: false, error: error.message };
  }
});

ipcMain.handle('restart-app', () => {
  log.info('Restarting application');
  try {
    isQuitting = true;
    app.relaunch();
    app.exit(0);
  } catch (error) {
    log.warn('Failed to restart app:', error.message);
  }
});

ipcMain.handle('minimize-window', () => {
  if (mainWindow) {
    mainWindow.minimize();
  }
});

ipcMain.handle('focus-window', () => {
  return focusMainWindow();
});

ipcMain.handle('focus-desktop-pin', (_event, entityId) => {
  return focusDesktopPinWindow(normalizeEntityId(entityId));
});

// Updates IPC
ipcMain.handle('check-for-updates', async () => {
  if (!app.isPackaged) return { status: 'dev' };
  if (isPortableBuild()) {
    return checkPortableUpdate();
  }
  try {
    const info = await autoUpdater.checkForUpdates();
    return { status: 'checking', info };
  } catch (e) {
    return { status: 'error', error: e?.message };
  }
});

ipcMain.handle('quit-and-install', () => {
  if (app.isPackaged && !isPortableBuild()) {
    isQuitting = true;
    autoUpdater.quitAndInstall();
  }
});

// Handle quit request from renderer
ipcMain.handle('quit-app', () => {
  isQuitting = true;
  app.quit();
});

ipcMain.handle('get-app-version', () => {
  return app.getVersion();
});

// Log file viewer functionality
ipcMain.handle('open-logs', () => {
  try {
    let logFilePath = null;
    try {
      if (log?.transports?.file?.resolvePath && typeof log.transports.file.resolvePath === 'function') {
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

ipcMain.handle('debug-log', (_event, payload) => {
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
      const safeDetails = serializedDetails.length > maxLength
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
ipcMain.handle('register-hotkey', (event, entityId, hotkey, action) => {
  // Check for conflicts with existing hotkeys first
  // Handle both string (legacy) and object (new) formats
  const existingEntity = Object.entries(config.globalHotkeys.hotkeys).find(([id, hotkeyConfig]) => {
    if (id === entityId) return false; // Skip the entity we're currently updating

    // Extract hotkey from either format: string or object
    const existingHotkey = (typeof hotkeyConfig === 'object' && hotkeyConfig.hotkey)
      ? hotkeyConfig.hotkey
      : hotkeyConfig;

    // Only compare if we have a valid hotkey string
    return existingHotkey && typeof existingHotkey === 'string' && existingHotkey.toLowerCase() === hotkey.toLowerCase();
  });

  if (existingEntity) {
    const entityName = existingEntity[0] || 'another action';
    return { success: false, error: `Hotkey already assigned to ${entityName}` };
  }

  // Then, validate the hotkey format and check against system shortcuts
  if (!validateHotkey(hotkey)) {
    return { success: false, error: 'Invalid hotkey format or conflicts with common system shortcuts' };
  }

  config.globalHotkeys.hotkeys[entityId] = { hotkey, action };
  saveConfig();

  // Only register if hotkeys are enabled
  if (config.globalHotkeys.enabled) {
    registerGlobalHotkeys(); // This will re-register all hotkeys

    // Final check to see if Electron successfully registered it
    if (!globalShortcut.isRegistered(hotkey)) {
      log.warn(`Electron failed to register hotkey: ${hotkey}. It might be in use by another application.`);
      // Unset it from config so the user can try again
      delete config.globalHotkeys.hotkeys[entityId];
      saveConfig();
      registerGlobalHotkeys();
      return { success: false, error: 'Hotkey is likely in use by another application' };
    }
  }

  return { success: true };
});

ipcMain.handle('unregister-hotkey', (event, entityId) => {
  delete config.globalHotkeys.hotkeys[entityId];
  saveConfig();
  registerGlobalHotkeys();
  return { success: true };
});

ipcMain.handle('register-hotkeys', () => {
  // Re-register all hotkeys (useful after config changes)
  registerGlobalHotkeys();
  return { success: true };
});

// DEPRECATED: Use 'update-config' instead for safer config merging
// This handler replaces the entire config which can lose data if not careful
ipcMain.handle('save-config', (event, newConfig) => {
  log.warn('save-config handler is deprecated, use update-config instead');
  // Update the config with the new values
  pruneConfig(newConfig);
  ensureProfileSyncConfigDefaults(newConfig);
  config = newConfig;
  ensureProfileSyncConfigDefaults(config);
  pruneConfig(config);
  saveConfig();
  pushConfigToRenderer();
  emitProfileSyncStatus();
  return { success: true, config: sanitizeConfigForRenderer(config) };
});

ipcMain.handle('toggle-hotkeys', (event, enabled) => {
  config.globalHotkeys.enabled = enabled;
  saveConfig();

  if (enabled) {
    registerGlobalHotkeys();
  } else {
    unregisterGlobalHotkeys();
  }

  return { success: true };
});

ipcMain.handle('validate-hotkey', (event, hotkey) => {
  return { valid: validateHotkey(hotkey) };
});

// Entity Alert IPC Handlers
ipcMain.handle('set-entity-alert', (event, entityId, alertConfig) => {
  config.entityAlerts.alerts[entityId] = alertConfig;
  saveConfig();
  return { success: true };
});

ipcMain.handle('remove-entity-alert', (event, entityId) => {
  delete config.entityAlerts.alerts[entityId];
  saveConfig();
  return { success: true };
});

ipcMain.handle('toggle-alerts', (event, enabled) => {
  config.entityAlerts.enabled = enabled;
  saveConfig();
  return { success: true };
});

// Popup Hotkey IPC Handlers
ipcMain.handle('register-popup-hotkey', (event, hotkey) => {
  if (!uiohookAvailable) {
    return { success: false, error: 'Popup hotkey feature is not available on this platform' };
  }

  // Validate the hotkey
  if (!validateHotkey(hotkey)) {
    return { success: false, error: 'Invalid hotkey format or conflicts with common system shortcuts' };
  }

  // Unregister old hotkey if exists
  if (config.popupHotkey) {
    unregisterPopupHotkey();
  }

  // Update config
  config.popupHotkey = hotkey;
  saveConfig();

  // Register new hotkey
  registerPopupHotkey();

  return { success: true };
});

ipcMain.handle('unregister-popup-hotkey', () => {
  config.popupHotkey = '';
  saveConfig();
  unregisterPopupHotkey();
  return { success: true };
});

ipcMain.handle('get-popup-hotkey', () => {
  return { hotkey: config.popupHotkey || '' };
});

ipcMain.handle('is-popup-hotkey-available', () => {
  return uiohookAvailable;
});

// Global Hotkey Management
function registerGlobalHotkeys() {
  if (!config.globalHotkeys.enabled) return;

  // Unregister all existing hotkeys first
  globalShortcut.unregisterAll();

  // Register each configured hotkey
  Object.entries(config.globalHotkeys.hotkeys).forEach(([entityId, hotkeyConfig]) => {
    const { hotkey, action } = (typeof hotkeyConfig === 'object') ? hotkeyConfig : { hotkey: hotkeyConfig, action: 'toggle' };
    if (hotkey && hotkey.trim()) {
      try {
        const success = globalShortcut.register(hotkey, () => {
          // Send hotkey event to renderer process
          if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.webContents.send('hotkey-triggered', { entityId, hotkey, action });
          }
        });

        if (!success) {
          log.warn(`Failed to register hotkey: ${hotkey} for entity: ${entityId}`);
          if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.webContents.send('hotkey-registration-failed', { entityId, hotkey });
          }
        } else {
          log.info(`Registered hotkey: ${hotkey} for entity: ${entityId}`);
        }
      } catch (error) {
        log.error(`Error registering hotkey ${hotkey} for entity ${entityId}:`, error);
      }
    }
  });
}

function unregisterGlobalHotkeys() {
  globalShortcut.unregisterAll();
}

function validateHotkey(hotkey) {
  if (!hotkey || typeof hotkey !== 'string') return false;

  // A valid hotkey must have at least one non-modifier key.
  // Support multiple modifier name variants: Ctrl/Control, Alt/Option, Shift, Meta/Cmd/Command/Super
  const modifiers = ['ctrl', 'control', 'alt', 'option', 'shift', 'meta', 'cmd', 'command', 'super', 'commandorcontrol', 'cmdorctrl'];
  const keys = hotkey.split('+');
  const nonModifiers = keys.filter(key => !modifiers.includes(key.toLowerCase()));
  if (nonModifiers.length === 0) {
    return false;
  }

  // Check for conflicts with system shortcuts
  const systemShortcuts = [
    'ctrl+alt+del', 'alt+f4', 'ctrl+c', 'ctrl+v', 'ctrl+x', 'ctrl+z',
    'ctrl+a', 'ctrl+s', 'ctrl+o', 'ctrl+n', 'ctrl+w', 'ctrl+r',
    'alt+tab', 'ctrl+tab', 'ctrl+shift+tab', 'alt+shift+tab',
    'win+l', 'win+r', 'win+e', 'win+d', 'win+m', 'win+tab'
  ];

  return !systemShortcuts.includes(hotkey.toLowerCase());
}

// Popup Hotkey Management
function acceleratorToUIOhookKey(accelerator) {
  if (!uiohookAvailable) return null;
  if (!accelerator || typeof accelerator !== 'string') return null;

  const parts = accelerator.split('+').map(p => p.trim().toLowerCase());

  // Extract modifiers - support all variants
  const config = {
    ctrl: parts.includes('ctrl') || parts.includes('control') || parts.includes('commandorcontrol') || parts.includes('cmdorctrl'),
    alt: parts.includes('alt') || parts.includes('option'),
    shift: parts.includes('shift'),
    meta: parts.includes('meta') || parts.includes('cmd') || parts.includes('command') || parts.includes('super')
  };

  // Get the main key (non-modifier) - include all possible modifier name variants
  const modifiers = ['ctrl', 'control', 'commandorcontrol', 'cmdorctrl', 'alt', 'option', 'shift', 'meta', 'cmd', 'command', 'super'];
  const mainKey = parts.find(p => !modifiers.includes(p));

  if (!mainKey) return null;

  // Map common keys to UiohookKey codes
  const keyMap = {
    'space': UiohookKey.Space,
    'enter': UiohookKey.Enter,
    'return': UiohookKey.Return,
    'tab': UiohookKey.Tab,
    'backspace': UiohookKey.Backspace,
    'delete': UiohookKey.Delete,
    'escape': UiohookKey.Escape,
    'esc': UiohookKey.Escape,
    'home': UiohookKey.Home,
    'end': UiohookKey.End,
    'pageup': UiohookKey.PageUp,
    'pagedown': UiohookKey.PageDown,
    'up': UiohookKey.Up,
    'down': UiohookKey.Down,
    'left': UiohookKey.Left,
    'right': UiohookKey.Right,
    'f1': UiohookKey.F1,
    'f2': UiohookKey.F2,
    'f3': UiohookKey.F3,
    'f4': UiohookKey.F4,
    'f5': UiohookKey.F5,
    'f6': UiohookKey.F6,
    'f7': UiohookKey.F7,
    'f8': UiohookKey.F8,
    'f9': UiohookKey.F9,
    'f10': UiohookKey.F10,
    'f11': UiohookKey.F11,
    'f12': UiohookKey.F12,
    '0': UiohookKey.Digit0,
    '1': UiohookKey.Digit1,
    '2': UiohookKey.Digit2,
    '3': UiohookKey.Digit3,
    '4': UiohookKey.Digit4,
    '5': UiohookKey.Digit5,
    '6': UiohookKey.Digit6,
    '7': UiohookKey.Digit7,
    '8': UiohookKey.Digit8,
    '9': UiohookKey.Digit9,
    'a': UiohookKey.A,
    'b': UiohookKey.B,
    'c': UiohookKey.C,
    'd': UiohookKey.D,
    'e': UiohookKey.E,
    'f': UiohookKey.F,
    'g': UiohookKey.G,
    'h': UiohookKey.H,
    'i': UiohookKey.I,
    'j': UiohookKey.J,
    'k': UiohookKey.K,
    'l': UiohookKey.L,
    'm': UiohookKey.M,
    'n': UiohookKey.N,
    'o': UiohookKey.O,
    'p': UiohookKey.P,
    'q': UiohookKey.Q,
    'r': UiohookKey.R,
    's': UiohookKey.S,
    't': UiohookKey.T,
    'u': UiohookKey.U,
    'v': UiohookKey.V,
    'w': UiohookKey.W,
    'x': UiohookKey.X,
    'y': UiohookKey.Y,
    'z': UiohookKey.Z
  };

  const keycode = keyMap[mainKey];
  if (!keycode) {
    log.warn(`Unknown key in accelerator: ${mainKey}`);
    return null;
  }

  return { keycode, ...config };
}

/**
 * Register and enable the configured popup hotkey using uiohook, replacing any previous handlers.
 *
 * Registers keydown and keyup handlers derived from `config.popupHotkey` and honors `config.popupHotkeyToggleMode` and related settings (e.g., `popupHotkeyHideOnRelease`). Starts uIOhook if not running, updates internal popup hotkey state, and brings, focuses, hides, or restores the main window according to the configured behavior. If uiohook is not available or the configured accelerator is invalid or empty, the function logs a warning and returns without registering handlers.
 */
function registerPopupHotkey() {
  if (!uiohookAvailable) {
    log.warn('Cannot register popup hotkey: uiohook-napi not available on this platform');
    return;
  }

  // If no popup hotkey configured, clean up and return
  if (!config.popupHotkey || config.popupHotkey.trim() === '') {
    log.debug('No popup hotkey configured, cleaning up');
    unregisterPopupHotkey();
    return;
  }

  const hotkeyConfig = acceleratorToUIOhookKey(config.popupHotkey);
  if (!hotkeyConfig) {
    log.warn(`Failed to parse popup hotkey: ${config.popupHotkey}`);
    return;
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
      log.debug(`Popup hotkey event: keycode=${event.keycode}, ctrl=${event.ctrlKey}, alt=${event.altKey}, shift=${event.shiftKey}, meta=${event.metaKey}`);
      log.debug(`Expected config: keycode=${keycode}, ctrl=${ctrl}, alt=${alt}, shift=${shift}, meta=${meta}`);

      // Check if this is our hotkey - use Boolean coercion to handle undefined values
      if (event.keycode === keycode &&
        Boolean(event.ctrlKey) === ctrl &&
        Boolean(event.altKey) === alt &&
        Boolean(event.shiftKey) === shift &&
        Boolean(event.metaKey) === meta) {

        if (config.popupHotkeyToggleMode) {
          // Smart toggle mode: only hide if window is visible AND focused, otherwise bring to top
          if (mainWindow && !mainWindow.isDestroyed()) {
            const isVisible = mainWindow.isVisible();
            const isFocused = mainWindow.isFocused();
            const now = Date.now();

            // Use timestamp to prevent hiding immediately after showing (debounce 300ms)
            // This handles edge cases where focus detection is unreliable
            const recentlyShown = popupHotkeyLastShownTime && (now - popupHotkeyLastShownTime) < 300;

            log.debug(`Popup hotkey: visible=${isVisible}, focused=${isFocused}, recentlyShown=${recentlyShown}`);

            if (isVisible && isFocused && !recentlyShown) {
              // Window is already visible and focused (and not recently shown) - hide it
              log.info('Popup hotkey toggle: window is focused, hiding...');
              mainWindow.hide();
              _popupHotkeyWindowVisible = false;
              popupHotkeyLastShownTime = null;
              log.debug('Popup hotkey toggle - window hidden');
            } else {
              // Window is hidden, minimized, not focused, or was just shown - bring to top
              log.info('Popup hotkey toggle: bringing window to top...');

              // Save current alwaysOnTop state
              wasAlwaysOnTop = mainWindow.isAlwaysOnTop();

              // Bring window to front
              if (mainWindow.isMinimized()) {
                mainWindow.restore();
              }
              mainWindow.show();
              mainWindow.setAlwaysOnTop(true);
              mainWindow.focus();
              mainWindow.moveTop();

              // Restore original alwaysOnTop state immediately so popup doesn't override user preference
              mainWindow.setAlwaysOnTop(wasAlwaysOnTop);

              _popupHotkeyWindowVisible = true;
              popupHotkeyLastShownTime = now;
              log.debug('Popup hotkey toggle - window shown and focused, alwaysOnTop restored to user preference');
            }
          }
        } else {
          // Hold mode (existing behavior): only process if not already pressed
          if (popupHotkeyPressed) return;

          popupHotkeyPressed = true;
          log.info('Popup hotkey matched! Bringing window to front...');

          if (mainWindow && !mainWindow.isDestroyed()) {
            // Save current alwaysOnTop state
            wasAlwaysOnTop = mainWindow.isAlwaysOnTop();

            // Bring window to front
            if (mainWindow.isMinimized()) {
              mainWindow.restore();
            }
            mainWindow.show();
            mainWindow.setAlwaysOnTop(true);
            mainWindow.focus();
            mainWindow.moveTop();

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
          // Restore original alwaysOnTop state
          mainWindow.setAlwaysOnTop(wasAlwaysOnTop);

          // Hide window if setting is enabled (Issue #21)
          if (config.popupHotkeyHideOnRelease) {
            mainWindow.hide();
            log.debug('Popup hotkey released - window hidden');
          } else {
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
  } catch (error) {
    log.error('Failed to register popup hotkey:', error);
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
  if (!uiohookAvailable) {
    return;
  }

  try {
    // Remove event listeners first before stopping uIOhook
    if (popupHotkeyKeydownHandler) {
      uIOhook.off('keydown', popupHotkeyKeydownHandler);
      popupHotkeyKeydownHandler = null;
      log.debug('Removed keydown handler');
    }
    if (popupHotkeyKeyupHandler) {
      uIOhook.off('keyup', popupHotkeyKeyupHandler);
      popupHotkeyKeyupHandler = null;
      log.debug('Removed keyup handler');
    }

    // Stop uIOhook only if it's running
    if (uIOhookRunning) {
      uIOhook.stop();
      uIOhookRunning = false;
      log.info('uIOhook stopped, popup hotkey unregistered');
    }

    // Clear state
    popupHotkeyConfig = null;
    popupHotkeyPressed = false;
    _popupHotkeyWindowVisible = false;
  } catch (error) {
    log.error('Failed to unregister popup hotkey:', error);
  }
}

// Entity Alert Management
function setupEntityAlerts() {
  if (!config.entityAlerts.enabled) return;

  // This will be called when entity states change
  // The actual alert logic will be in the renderer process
  log.info('Entity alerts enabled');
}

async function checkPortableUpdate() {
  const repo = 'Robertg761/HA-Desktop-Widget';
  const apiUrl = `https://api.github.com/repos/${repo}/releases/latest`;
  try {
    const response = await axios.get(apiUrl, {
      headers: {
        'User-Agent': 'HA-Desktop-Widget',
        'Accept': 'application/vnd.github+json'
      },
      timeout: 10000
    });

    const release = response?.data || {};
    const assets = Array.isArray(release.assets) ? release.assets : [];
    const arch = process.arch || 'x64';
    const archToken = `win-${arch}`;
    let portableAsset = assets.find((asset) => {
      const name = String(asset?.name || '').toLowerCase();
      return name.includes('portable') && name.includes(archToken);
    });
    if (!portableAsset) {
      portableAsset = assets.find((asset) => String(asset?.name || '').toLowerCase().includes('portable'));
    }

    const latestVersion = normalizeVersion(release.tag_name || release.name || '');
    const currentVersion = normalizeVersion(app.getVersion());
    const downloadUrl = portableAsset?.browser_download_url || release.html_url || '';
    if (!latestVersion) {
      return {
        status: 'error',
        error: 'Unable to determine the latest Portable release version.',
        downloadUrl
      };
    }

    if (currentVersion && latestVersion === currentVersion) {
      return { status: 'none', message: 'You are up to date!' };
    }

    return {
      status: 'portable',
      message: `Portable update available: v${latestVersion}. Click "Download Portable Update" to get the Portable build.`,
      version: latestVersion,
      downloadUrl
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
  try {
    autoUpdater.logger = log;
    autoUpdater.logger.transports.file.level = 'info';
    autoUpdater.autoDownload = true;
    autoUpdater.autoInstallOnAppQuit = true;

    autoUpdater.on('checking-for-update', () => {
      mainWindow?.webContents.send('auto-update', { status: 'checking' });
    });
    autoUpdater.on('update-available', (info) => {
      mainWindow?.webContents.send('auto-update', { status: 'available', info });
    });
    autoUpdater.on('update-not-available', (info) => {
      mainWindow?.webContents.send('auto-update', { status: 'none', info });
    });
    autoUpdater.on('download-progress', (progress) => {
      mainWindow?.webContents.send('auto-update', { status: 'downloading', progress });
    });
    autoUpdater.on('update-downloaded', (info) => {
      mainWindow?.webContents.send('auto-update', { status: 'downloaded', info });
    });
    autoUpdater.on('error', (err) => {
      mainWindow?.webContents.send('auto-update', { status: 'error', error: err?.message });
    });

    // Initial check
    setTimeout(() => autoUpdater.checkForUpdatesAndNotify().catch(() => { }), 3000);
  } catch (error) {
    log.error('Auto-update setup failed:', error);
  }
}

app.on('before-quit', () => {
  isQuitting = true;
  closeDevReloadWatchers();
  if (windowStateSaveTimer) {
    clearTimeout(windowStateSaveTimer);
    windowStateSaveTimer = null;
  }
  clearProfileSyncTimers();
  flushPendingConfigWriteSync();
  unregisterGlobalHotkeys();
  unregisterPopupHotkey();
});

// Register custom protocol before creating window
protocol.registerSchemesAsPrivileged([
  { scheme: 'ha', privileges: { secure: true, standard: true, supportFetchAPI: true, corsEnabled: true } }
]);

app.whenReady().then(() => {
  // Set app ID for Windows (helps with icon caching and taskbar behavior)
  if (process.platform === 'win32') {
    app.setAppUserModelId('com.github.robertg761.hadesktopwidget');
  }

  loadConfig();
  startDevLiveReloadWatchers();

  // Camera proxy: ha://camera/<entityId> (snapshot) and ha://camera_stream/<entityId> (MJPEG)
  try {
    const { Readable } = require('stream');
    protocol.registerStreamProtocol('ha', async (request, respond) => {
      try {
        const url = new URL(request.url);
        const host = url.hostname; // 'camera' or 'camera_stream'
        const entityId = decodeURIComponent(url.pathname.replace(/^\//, ''));
        const haUrl = (config && config.homeAssistant && config.homeAssistant.url) || '';
        const token = (config && config.homeAssistant && config.homeAssistant.token) || '';
        if (!haUrl || !token || !entityId) {
          respond({ statusCode: 403 });
          return;
        }
        if (host === 'camera_stream') {
          const upstream = `${haUrl.replace(/\/$/, '')}/api/camera_proxy_stream/${entityId}`;
          const isHttps = haUrl.startsWith('https://');
          const res = await axios.get(upstream, {
            headers: { Authorization: `Bearer ${token}` },
            responseType: 'stream',
            validateStatus: () => true,
            timeout: 0,
            maxRedirects: 5,
            httpAgent: !isHttps ? httpKeepAliveAgent : undefined,
            httpsAgent: isHttps ? httpsKeepAliveAgent : undefined
          });
          if (res.status >= 200 && res.status < 300) {
            const contentType = res.headers['content-type'] || 'multipart/x-mixed-replace;boundary=--myboundary';
            respond({ data: res.data, statusCode: 200, headers: { 'Content-Type': contentType, 'Cache-Control': 'no-cache, no-store, must-revalidate', 'Pragma': 'no-cache', 'Expires': '0' } });
          } else {
            respond({ statusCode: res.status || 502 });
          }
        } else if (host === 'hls') {
          const upstream = `${haUrl.replace(/\/$/, '')}${url.pathname}${url.search || ''}`;
          const isHttps = haUrl.startsWith('https://');
          const res = await axios.get(upstream, {
            headers: { Authorization: `Bearer ${token}` },
            responseType: 'stream',
            validateStatus: () => true,
            timeout: 0,
            maxRedirects: 5,
            httpAgent: !isHttps ? httpKeepAliveAgent : undefined,
            httpsAgent: isHttps ? httpsKeepAliveAgent : undefined
          });
          if (res.status >= 200 && res.status < 300) {
            const contentType = res.headers['content-type'] || (upstream.endsWith('.m3u8') ? 'application/vnd.apple.mpegurl' : 'video/MP2T');
            respond({ data: res.data, statusCode: 200, headers: { 'Content-Type': contentType, 'Cache-Control': 'no-cache, no-store, must-revalidate', 'Pragma': 'no-cache', 'Expires': '0' } });
          } else {
            respond({ statusCode: res.status || 502 });
          }
        } else if (host === 'camera') {
          const upstream = `${haUrl.replace(/\/$/, '')}/api/camera_proxy/${entityId}`;
          const res = await axios.get(upstream, {
            headers: { Authorization: `Bearer ${token}` },
            responseType: 'arraybuffer',
            validateStatus: () => true,
            timeout: 15000, // 15 second timeout for snapshots
            maxRedirects: 5
          });
          if (res.status >= 200 && res.status < 300) {
            const buf = Buffer.from(res.data);
            const stream = Readable.from(buf);
            const contentType = res.headers['content-type'] || 'image/jpeg';
            respond({ data: stream, statusCode: 200, headers: { 'Content-Type': contentType, 'Cache-Control': 'no-cache, no-store, must-revalidate', 'Pragma': 'no-cache', 'Expires': '0' } });
          } else {
            respond({ statusCode: res.status || 502 });
          }
        } else if (host === 'media_artwork') {
          // Decode the base64-encoded URL from the path
          const encodedUrl = decodeURIComponent(url.pathname.replace(/^\//, ''));
          let artworkUrl;
          try {
            artworkUrl = Buffer.from(encodedUrl, 'base64').toString('utf-8');
          } catch (decodeError) {
            log.error('Failed to decode media artwork URL:', decodeError);
            respond({ statusCode: 400 });
            return;
          }

          // Determine if this is an external URL or HA-relative path
          const isExternalUrl = artworkUrl.startsWith('http://') || artworkUrl.startsWith('https://');
          let upstream;
          let headers = {};

          if (isExternalUrl) {
            // External CDN URL (Spotify, YouTube, etc.) - fetch without auth
            upstream = artworkUrl;
          } else {
            // HA-relative path - add auth and construct full URL
            const path = artworkUrl.startsWith('/') ? artworkUrl : '/' + artworkUrl;
            upstream = `${haUrl.replace(/\/$/, '')}${path}`;
            headers = { Authorization: `Bearer ${token}` };
          }

          const res = await fetchBinaryWithElectronNet(upstream, headers, 10000);

          if (res.status >= 200 && res.status < 300) {
            const buf = Buffer.isBuffer(res.data) ? res.data : Buffer.from(res.data);
            const stream = Readable.from(buf);
            const contentType = getHeaderValue(res.headers, 'content-type') || 'image/jpeg';
            respond({
              data: stream,
              statusCode: 200,
              headers: {
                'Content-Type': contentType,
                'Cache-Control': 'public, max-age=1800'
              }
            });
          } else {
            respond({ statusCode: res.status || 502 });
          }
        } else {
          respond({ statusCode: 404 });
        }
      } catch (error) {
        log.error('Protocol handler error:', error);
        respond({ statusCode: 500 });
      }
    });
  } catch (error) {
    log.error('Failed to register ha:// protocol', error);
  }

  createWindow();
  syncDesktopPinWindowsWithConfig();
  createTray();
  setupAutoUpdates();
  registerGlobalHotkeys();
  setupEntityAlerts();
  registerPopupHotkey();
  void initializeProfileSyncOnStartup().catch((error) => {
    log.warn('Profile sync startup initialization failed:', error.message);
  });
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

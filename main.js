const { app, BrowserWindow, ipcMain, Menu, Tray, screen: electronScreen, shell, protocol, globalShortcut, nativeImage, safeStorage } = require('electron');
const path = require('path');
const fs = require('fs');
const log = require('electron-log');
const { autoUpdater } = require('electron-updater');
const axios = require('axios');
const http = require('http');
const https = require('https');

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
let windowStateSaveTimer = null;

// Popup hotkey state
let popupHotkeyPressed = false;
let popupHotkeyConfig = null; // Stores { keycode, alt, ctrl, shift, meta }
let wasAlwaysOnTop = false; // Track original alwaysOnTop state
let popupHotkeyKeydownHandler = null; // Reference to keydown handler for cleanup
let popupHotkeyKeyupHandler = null; // Reference to keyup handler for cleanup
let uIOhookRunning = false; // Track whether uIOhook is currently running
let _popupHotkeyWindowVisible = false; // Toggle mode: track whether window is currently shown via hotkey
let popupHotkeyLastShownTime = null;

function isPortableBuild() {
  if (!app.isPackaged) return false;
  const env = process.env || {};
  return Boolean(env.PORTABLE_EXECUTABLE_DIR || env.PORTABLE_EXECUTABLE_FILE || env.PORTABLE_EXECUTABLE_APP_FILENAME);
}

function normalizeVersion(value) {
  if (!value) return '';
  return String(value).trim().replace(/^v/i, '');
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
      background: 'original'
    },
    primaryCards: ['weather', 'time'],
    popupHotkey: '', // Global hotkey to temporarily bring window to front while held
    popupHotkeyHideOnRelease: false, // Hide window when popup hotkey is released (instead of just restoring z-order)
    popupHotkeyToggleMode: false // Press once to show, press again to hide (instead of hold)
  };

  try {
    if (fs.existsSync(configPath)) {
      const userConfig = JSON.parse(fs.readFileSync(configPath, 'utf8'));
      config = {
        ...defaultConfig, ...userConfig,
        globalHotkeys: { ...defaultConfig.globalHotkeys, ...(userConfig.globalHotkeys || {}) },
        entityAlerts: { ...defaultConfig.entityAlerts, ...(userConfig.entityAlerts || {}) },
        ui: { ...defaultConfig.ui, ...(userConfig.ui || {}) }
      };
      pruneConfig(config);

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
          migrated = true;
        } catch (error) {
          log.warn('Legacy config exists but could not be parsed, using defaults:', error.message);
          config = defaultConfig;
        }
      } else {
        config = defaultConfig;
      }
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
  }
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
function saveConfig() {
  log.debug('Saving configuration');
  const userDataDir = app.getPath('userData');
  const configPath = path.join(userDataDir, 'config.json');
  try {
    fs.mkdirSync(userDataDir, { recursive: true });

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

    fs.writeFileSync(configPath, JSON.stringify(configToSave, null, 2));
  } catch (error) {
    log.error('Failed to save config:', error);
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
  const enabled = typeof override === 'boolean' ? override : !!config?.frostedGlass;

  if (process.platform === 'win32') {
    if (typeof mainWindow.setBackgroundMaterial === 'function') {
      try {
        mainWindow.setBackgroundMaterial(enabled ? 'acrylic' : 'none');
      } catch (error) {
        log.warn('Failed to set background material:', error.message);
      }
    }
  } else if (process.platform === 'darwin') {
    if (typeof mainWindow.setVibrancy === 'function') {
      try {
        mainWindow.setVibrancy(enabled ? 'sidebar' : null);
      } catch (error) {
        log.warn('Failed to set vibrancy:', error.message);
      }
    }
    if (typeof mainWindow.setVisualEffectState === 'function') {
      try {
        mainWindow.setVisualEffectState(enabled ? 'active' : 'inactive');
      } catch (error) {
        log.warn('Failed to set visual effect state:', error.message);
      }
    }
  }

  try {
    mainWindow.setBackgroundColor('#00000000');
  } catch (error) {
    log.warn('Failed to set background color:', error.message);
  }
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
  if (process.argv.includes('--dev')) {
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
  return config;
});

ipcMain.handle('update-config', (event, newConfig) => {
  log.debug('Updating configuration');
  const prevFrostedGlass = config?.frostedGlass;
  pruneConfig(newConfig);
  const customTabs = { ...(config.customTabs || {}), ...(newConfig.customTabs || {}) };
  config = { ...config, ...newConfig, customTabs };
  pruneConfig(config);
  if (prevFrostedGlass !== config.frostedGlass) {
    applyFrostedGlass();
  }
  saveConfig();
  return config;
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

// Start with Windows IPC handlers
ipcMain.handle('get-login-item-settings', () => {
  try {
    const settings = app.getLoginItemSettings();
    log.debug('Login item settings:', settings);
    return { openAtLogin: settings.openAtLogin };
  } catch (error) {
    log.error('Failed to get login item settings:', error);
    return { openAtLogin: false };
  }
});

ipcMain.handle('set-login-item-settings', (event, openAtLogin) => {
  try {
    log.info(`Setting app to ${openAtLogin ? 'start' : 'not start'} with Windows`);
    app.setLoginItemSettings({
      openAtLogin: openAtLogin,
      path: app.getPath('exe'),
      args: []
    });
    return { success: true, openAtLogin };
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
  if (mainWindow) {
    // Ensure window is visible and restored from minimized state
    if (mainWindow.isMinimized()) {
      mainWindow.restore();
    }
    mainWindow.show();

    // Request focus and bring to front
    mainWindow.focus();
    mainWindow.moveTop();

    // Windows focus workaround: Toggle always-on-top to force OS to refocus
    // This fixes the issue where native dialogs (confirm/alert) steal focus
    const wasOnTop = mainWindow.isAlwaysOnTop();
    mainWindow.setAlwaysOnTop(true);
    mainWindow.setAlwaysOnTop(wasOnTop);
  }
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
  config = newConfig;
  pruneConfig(config);
  saveConfig();
  return { success: true };
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
  if (windowStateSaveTimer) {
    clearTimeout(windowStateSaveTimer);
    windowStateSaveTimer = null;
    saveConfig();
  }
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

          const res = await axios.get(upstream, {
            headers: headers,
            responseType: 'arraybuffer',
            validateStatus: () => true,
            timeout: 10000
          });

          if (res.status >= 200 && res.status < 300) {
            const buf = Buffer.from(res.data);
            const stream = Readable.from(buf);
            const contentType = res.headers['content-type'] || 'image/jpeg';
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
  createTray();
  setupAutoUpdates();
  registerGlobalHotkeys();
  setupEntityAlerts();
  registerPopupHotkey();
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
});

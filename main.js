const { app, BrowserWindow, ipcMain, Menu, Tray, screen, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const log = require('electron-log');
const { autoUpdater } = require('electron-updater');

let mainWindow;
let tray;
let config;
let isQuitting = false;

// Load configuration
function loadConfig() {
  const userDataDir = app.getPath('userData');
  const configPath = path.join(userDataDir, 'config.json');

  // Default configuration
  const defaultConfig = {
    windowPosition: { x: 100, y: 100 },
    windowSize: { width: 400, height: 600 },
    alwaysOnTop: true,
    opacity: 0.95,
    homeAssistant: {
      url: 'http://homeassistant.local:8123',
      token: 'YOUR_LONG_LIVED_ACCESS_TOKEN'
    },
    updateInterval: 5000 // Update every 5 seconds
  };

  try {
    if (fs.existsSync(configPath)) {
      const userConfig = JSON.parse(fs.readFileSync(configPath, 'utf8'));
      config = { ...defaultConfig, ...userConfig };
    } else {
      // Migrate legacy config if present in app directory
      const legacyPath = path.join(__dirname, 'config.json');
      let migrated = false;
      if (fs.existsSync(legacyPath)) {
        try {
          const legacyConfig = JSON.parse(fs.readFileSync(legacyPath, 'utf8'));
          config = { ...defaultConfig, ...legacyConfig };
          migrated = true;
        } catch (e) {
          console.warn('Legacy config exists but could not be parsed, using defaults.');
          config = defaultConfig;
        }
      } else {
        config = defaultConfig;
      }
      // Ensure directory exists and persist
      fs.mkdirSync(userDataDir, { recursive: true });
      saveConfig();
      if (migrated) {
        console.log('Migrated legacy config.json to userData.');
      }
    }
  } catch (error) {
    console.error('Error loading config:', error);
    config = defaultConfig;
  }
}

// Save configuration
function saveConfig() {
  const userDataDir = app.getPath('userData');
  const configPath = path.join(userDataDir, 'config.json');
  try {
    fs.mkdirSync(userDataDir, { recursive: true });
    fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
  } catch (e) {
    console.error('Failed to save config:', e);
  }
}

function createWindow() {
  // Get the primary display's work area
  const primaryDisplay = screen.getPrimaryDisplay();
  const { width, height } = primaryDisplay.workAreaSize;

  // Create the browser window with transparency
  mainWindow = new BrowserWindow({
    x: config.windowPosition.x,
    y: config.windowPosition.y,
    width: config.windowSize.width,
    height: config.windowSize.height,
    transparent: true,
    frame: false,
    alwaysOnTop: config.alwaysOnTop,
    skipTaskbar: true,
    resizable: true,
    movable: true,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
      webSecurity: false
    }
  });

  // Set window opacity
  mainWindow.setOpacity(config.opacity);

  // Load the index.html file
  mainWindow.loadFile('index.html');

  // Save position when window is moved
  mainWindow.on('moved', () => {
    const [x, y] = mainWindow.getPosition();
    config.windowPosition = { x, y };
    saveConfig();
  });

  // Save size when window is resized
  mainWindow.on('resized', () => {
    const [width, height] = mainWindow.getSize();
    config.windowSize = { width, height };
    saveConfig();
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
  // Resolve a tray icon that works in dev and production
  const pkg = require('./package.json');
  const iconName = process.platform === 'win32' ? 'icon.ico' : 'icon.png';
  const candidates = [
    path.join(__dirname, iconName),
    path.join(__dirname, 'icon.png'), // fallback
    (process.resourcesPath ? path.join(process.resourcesPath, iconName) : null)
  ].filter(Boolean);

  const iconPath = candidates.find(p => fs.existsSync(p));
  if (!iconPath) {
    console.log('Tray icon not found. Add icon.png (or icon.ico on Windows) to the app resources.');
    return;
  }

  tray = new Tray(iconPath);

  const contextMenu = Menu.buildFromTemplate([
    {
      label: 'Show/Hide',
      click: () => {
        if (mainWindow.isVisible()) {
          mainWindow.hide();
        } else {
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
          mainWindow.show();
          mainWindow.webContents.send('open-settings');
        }
      }
    },
    {
      label: 'Check for Updates',
      click: () => {
        if (app.isPackaged) {
          autoUpdater.checkForUpdates();
        } else {
          console.log('Update check is only available in packaged builds.');
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
}

// IPC handlers for configuration
ipcMain.handle('get-config', () => {
  return config;
});

ipcMain.handle('update-config', (event, newConfig) => {
  config = { ...config, ...newConfig };
  saveConfig();
  return config;
});

ipcMain.handle('set-opacity', (event, opacity) => {
  mainWindow.setOpacity(opacity);
  config.opacity = opacity;
  saveConfig();
});

ipcMain.handle('minimize-window', () => {
  if (mainWindow) {
    mainWindow.minimize();
  }
});

// Updates IPC
ipcMain.handle('check-for-updates', async () => {
  if (!app.isPackaged) return { status: 'dev' };
  try {
    const info = await autoUpdater.checkForUpdates();
    return { status: 'checking', info };
  } catch (e) {
    return { status: 'error', error: e?.message };
  }
});

ipcMain.handle('quit-and-install', () => {
  if (app.isPackaged) {
    isQuitting = true;
    autoUpdater.quitAndInstall();
  }
});

// App event handlers
function setupAutoUpdates() {
  if (!app.isPackaged) return;
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
    setTimeout(() => autoUpdater.checkForUpdatesAndNotify().catch(() => {}), 3000);
  } catch (e) {
    console.error('Auto-update setup failed:', e);
  }
}

app.on('before-quit', () => {
  isQuitting = true;
});

app.whenReady().then(() => {
  loadConfig();
  createWindow();
  createTray();
  setupAutoUpdates();
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

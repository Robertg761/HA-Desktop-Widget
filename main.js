const { app, BrowserWindow, ipcMain, Menu, Tray, screen: electronScreen, shell, protocol } = require('electron');
const path = require('path');
const fs = require('fs');
const log = require('electron-log');
const { autoUpdater } = require('electron-updater');
const axios = require('axios');

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
        } catch (error) {
          console.warn('Legacy config exists but could not be parsed, using defaults:', error.message);
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
  } catch (error) {
    console.error('Failed to save config:', error);
  }
}

function createWindow() {
  // Get the primary display's work area
  const primaryDisplay = electronScreen.getPrimaryDisplay();
  const { width: _width, height: _height } = primaryDisplay.workAreaSize;

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
  const customTabs = { ...(config.customTabs || {}), ...(newConfig.customTabs || {}) };
  config = { ...config, ...newConfig, customTabs };
  saveConfig();
  return config;
});

ipcMain.handle('set-opacity', (event, opacity) => {
  mainWindow.setOpacity(opacity);
  config.opacity = opacity;
  saveConfig();
});

ipcMain.handle('set-always-on-top', (event, value) => {
  const flag = !!value;
  config.alwaysOnTop = flag;
  try {
    mainWindow.setAlwaysOnTop(flag);
  } catch (error) {
    console.warn('Failed to set always on top:', error.message);
  }
  saveConfig();
  return { applied: mainWindow?.isAlwaysOnTop?.() === flag };
});

ipcMain.handle('get-window-state', () => {
  return { alwaysOnTop: !!(mainWindow && mainWindow.isAlwaysOnTop && mainWindow.isAlwaysOnTop()) };
});

ipcMain.handle('restart-app', () => {
  try {
    isQuitting = true;
    app.relaunch();
    app.exit(0);
  } catch (error) {
    console.warn('Failed to restart app:', error.message);
  }
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

ipcMain.handle('get-app-version', () => {
  return app.getVersion();
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
  } catch (error) {
    console.error('Auto-update setup failed:', error);
  }
}

app.on('before-quit', () => {
  isQuitting = true;
});

// Register custom protocol before creating window
protocol.registerSchemesAsPrivileged([
  { scheme: 'ha', privileges: { secure: true, standard: true, supportFetchAPI: true, corsEnabled: true } }
]);

app.whenReady().then(() => {
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
          const res = await axios.get(upstream, {
            headers: { Authorization: `Bearer ${token}` },
            responseType: 'stream',
            validateStatus: () => true
          });
          if (res.status >= 200 && res.status < 300) {
            const contentType = res.headers['content-type'] || 'multipart/x-mixed-replace;boundary=--myboundary';
            respond({ data: res.data, statusCode: 200, headers: { 'Content-Type': contentType, 'Cache-Control': 'no-cache, no-store, must-revalidate', 'Pragma': 'no-cache', 'Expires': '0' } });
          } else {
            respond({ statusCode: res.status || 502 });
          }
        } else if (host === 'hls') {
          const upstream = `${haUrl.replace(/\/$/, '')}${url.pathname}${url.search || ''}`;
          const res = await axios.get(upstream, {
            headers: { Authorization: `Bearer ${token}` },
            responseType: 'stream',
            validateStatus: () => true
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
            validateStatus: () => true
          });
          if (res.status >= 200 && res.status < 300) {
            const buf = Buffer.from(res.data);
            const stream = Readable.from(buf);
            const contentType = res.headers['content-type'] || 'image/jpeg';
            respond({ data: stream, statusCode: 200, headers: { 'Content-Type': contentType, 'Cache-Control': 'no-cache, no-store, must-revalidate', 'Pragma': 'no-cache', 'Expires': '0' } });
          } else {
            respond({ statusCode: res.status || 502 });
          }
        } else {
          respond({ statusCode: 404 });
        }
      } catch (_err) {
        respond({ statusCode: 500 });
      }
    });
  } catch (error) {
    console.error('Failed to register ha:// protocol', error);
  }

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

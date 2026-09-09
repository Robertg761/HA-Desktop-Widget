const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { normalizeTrayEntitiesConfig } = require('../../src/tray-entities.cjs');
const mainSource = fs.readFileSync(path.resolve(__dirname, '../../main.js'), 'utf8');

function loadTrayRuntime(platform) {
  const createImage = () => ({ addRepresentation: jest.fn(), isEmpty: () => false });
  const context = {
    process: { platform },
    config: { trayEntities: { 'sensor.office': { label: 'Office' } } },
    trayEntityIcons: new Map(),
    trayEntityTicker: { clear: jest.fn(), reconcile: jest.fn() },
    normalizeTrayEntitiesConfig,
    isQuitting: false,
    LIVE_TRAY_VALUES_ENABLED: true,
    app: { isReady: () => true },
    mainWindow: {
      isDestroyed: () => false,
      isVisible: () => true,
      webContents: { send: jest.fn(), setBackgroundThrottling: jest.fn() },
    },
    hideMainWindowToTray: jest.fn(),
    showMainWindowFromTray: jest.fn(),
    mainT: (key) => key,
    resolveTrayIcon: () => 'app-icon',
    nativeImage: { createEmpty: createImage },
    Menu: { buildFromTemplate: (items) => items },
    log: { debug: jest.fn(), warn: jest.fn() },
    Tray: function (image) {
      this.initialImage = image;
      this.setTitle = jest.fn();
      this.setToolTip = jest.fn();
      this.setImage = jest.fn();
      this.setContextMenu = jest.fn();
      this.on = jest.fn();
      this.destroy = jest.fn();
    },
  };
  const start = mainSource.indexOf('function getTrayEntityDisplayName');
  const end = mainSource.indexOf('async function setTrayEntityInternal', start);
  vm.runInNewContext(mainSource.slice(start, end), context);
  return context;
}

describe('native tray integration', () => {
  it.each(['win32', 'linux', 'darwin'])(
    'creates and removes %s icons without changing dashboard background throttling',
    (platform) => {
      const runtime = loadTrayRuntime(platform);
      runtime.syncTrayEntitiesWithConfig();
      const icon = runtime.trayEntityIcons.get('sensor.office');
      expect(icon).toBeDefined();
      expect(runtime.mainWindow.webContents.setBackgroundThrottling).not.toHaveBeenCalled();
      expect(icon.setContextMenu.mock.lastCall[0][0].label).toBe('Office');
      runtime.config.trayEntities = {};
      runtime.syncTrayEntitiesWithConfig();
      expect(icon.destroy).toHaveBeenCalledTimes(1);
      expect(runtime.trayEntityTicker.reconcile).toHaveBeenLastCalledWith([]);
      expect(runtime.trayEntityIcons.size).toBe(0);
    }
  );

  it('keeps saved beta preferences dormant in stable builds', () => {
    const runtime = loadTrayRuntime('linux');
    runtime.LIVE_TRAY_VALUES_ENABLED = false;
    runtime.syncTrayEntitiesWithConfig();
    expect(runtime.trayEntityIcons.size).toBe(0);
    expect(runtime.config.trayEntities).toEqual({ 'sensor.office': { label: 'Office' } });
  });

  it('uses native monospaced digits on macOS and leaves clicking to its menu', () => {
    const runtime = loadTrayRuntime('darwin');
    const icon = runtime.createTrayEntityIcon('sensor.office');
    runtime.applyTrayEntityIconPayload(icon, {
      label: 'Office: 21.4 °C',
      tooltip: 'Office',
      representations: [],
    });
    expect(icon.setTitle).toHaveBeenLastCalledWith('Office: 21.4 °C', {
      fontType: 'monospacedDigit',
    });
    expect(icon.on).not.toHaveBeenCalledWith('click', expect.anything());
  });

  it.each(['win32', 'linux'])('publishes all bitmap resolutions on %s', (platform) => {
    const runtime = loadTrayRuntime(platform);
    const icon = runtime.createTrayEntityIcon('sensor.office');
    runtime.applyTrayEntityIconPayload(icon, {
      tooltip: 'Office',
      representations: [1, 1.5, 2, 3].map((scaleFactor) => ({ scaleFactor, dataURL: 'png' })),
    });
    expect(icon.setImage.mock.lastCall[0].addRepresentation).toHaveBeenCalledTimes(4);
    const click = icon.on.mock.calls.find(([event]) => event === 'click')[1];
    click();
    expect(runtime.hideMainWindowToTray).toHaveBeenCalledTimes(1);
  });

  it.each(['win32', 'linux', 'darwin'])(
    'clears cached readings on %s when the renderer cannot respond',
    (platform) => {
      const runtime = loadTrayRuntime(platform);
      runtime.syncTrayEntitiesWithConfig();
      const icon = runtime.trayEntityIcons.get('sensor.office');
      runtime.invalidateTrayEntityIcons();
      expect(icon.setToolTip).toHaveBeenLastCalledWith('Office: Offline');
      if (platform === 'darwin') expect(icon.setTitle).toHaveBeenLastCalledWith('Office: Offline');
      else expect(icon.setImage).toHaveBeenLastCalledWith('app-icon');
    }
  );
});

describe('tray connection lifecycle wiring', () => {
  it.each([false, true])(
    'only reconnects an already-open socket when offline was reported: %s',
    (wasOffline) => {
      const rendererSource = fs.readFileSync(path.resolve(__dirname, '../../renderer.js'), 'utf8');
      const start = rendererSource.indexOf("window.addEventListener('online'");
      const end = rendererSource.indexOf("window.addEventListener('offline'", start);
      let onOnline;
      const context = {
        window: {
          addEventListener: (_event, callback) => {
            onOnline = callback;
          },
        },
        resetConnectionToastTracking: jest.fn(),
        browserReportedOffline: wasOffline,
        websocket: { ws: { readyState: 1 } },
        WebSocket: { OPEN: 1 },
        setDisconnectedStatus: jest.fn(),
        connectWebSocket: jest.fn(),
        t: (key) => key,
      };
      vm.runInNewContext(rendererSource.slice(start, end), context);
      onOnline();
      expect(context.connectWebSocket).toHaveBeenCalledTimes(wasOffline ? 1 : 0);
      expect(context.setDisconnectedStatus).toHaveBeenCalledTimes(wasOffline ? 1 : 0);
    }
  );
});

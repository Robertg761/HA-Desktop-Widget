const fs = require('fs');
const path = require('path');
const vm = require('vm');
const omarchyBar = require('../../src/omarchy-bar.cjs');
const mainSource = fs.readFileSync(path.resolve(__dirname, '../../main.js'), 'utf8');

function block(startMarker) {
  const start = mainSource.indexOf(startMarker);
  const end = mainSource.indexOf('\n}\n', start);
  return mainSource.slice(start, end + 3);
}

const lightTile = {
  action: 'toggle',
  controls: true,
  controlState: {
    kind: 'light',
    on: true,
    brightness: 40,
    canSetBrightness: true,
    colorTemp: null,
    colors: [],
  },
};
const calendarTile = { action: 'dialog', controls: false };
const statusTile = { action: 'none', controls: false };

function loadRuntime({ enabled = true, present = true, tiles = {} } = {}) {
  const send = jest.fn();
  const context = {
    ...omarchyBar,
    omarchyBarPublisher: enabled ? {} : null,
    omarchyBarEntry: {
      present,
      entities: ['light.desk', 'calendar.home', 'sensor.status'],
      barEntities: [],
    },
    omarchyBarTiles: new Map(
      Object.entries({
        'light.desk': lightTile,
        'calendar.home': calendarTile,
        'sensor.status': statusTile,
        ...tiles,
      })
    ),
    config: { favoriteEntities: [] },
    mainWindow: { isDestroyed: () => false, webContents: { send } },
    showMainWindowFromTray: jest.fn(),
    log: { warn: jest.fn() },
  };
  vm.runInNewContext(
    block('function getOmarchyBarEntities') + block('function handleOmarchyBarEntityAction'),
    context
  );
  return { context, send };
}

const primary = (entityId) => ({ entityId, kind: 'primary' });
const controls = (entityId) => ({ entityId, kind: 'controls' });

describe('Omarchy bar requests in the main process', () => {
  it('passes a tile click to the renderer, which does what the widget tile does', () => {
    const { context, send } = loadRuntime();
    context.handleOmarchyBarEntityAction(primary('light.desk'));
    expect(send).toHaveBeenCalledWith('omarchy-bar-entity-action', {
      entityId: 'light.desk',
      kind: 'primary',
    });
    // A toggle happens in place; the widget stays where it is.
    expect(context.showMainWindowFromTray).not.toHaveBeenCalled();
  });

  it('brings the widget up for a dialog or the adjust controls', () => {
    const { context, send } = loadRuntime();
    context.handleOmarchyBarEntityAction(primary('calendar.home'));
    context.handleOmarchyBarEntityAction(controls('light.desk'));
    expect(context.showMainWindowFromTray).toHaveBeenCalledTimes(2);
    expect(send).toHaveBeenCalledWith('omarchy-bar-entity-action', {
      entityId: 'light.desk',
      kind: 'controls',
    });
  });

  it('applies a controls-popup change in place, without bringing the widget up', () => {
    const { context, send } = loadRuntime();
    const set = { entityId: 'light.desk', kind: 'set', command: 'brightness', value: 65 };
    context.handleOmarchyBarEntityAction(set);
    expect(send).toHaveBeenCalledWith('omarchy-bar-entity-action', {
      entityId: 'light.desk',
      kind: 'set',
      command: 'brightness',
      value: 65,
    });
    expect(context.showMainWindowFromTray).not.toHaveBeenCalled();
    send.mockClear();
    // Out of range, a command the tile lacks, and a tile without controls.
    context.handleOmarchyBarEntityAction({ ...set, value: 140 });
    context.handleOmarchyBarEntityAction({ ...set, command: 'color_temp', value: 3000 });
    context.handleOmarchyBarEntityAction({ ...set, entityId: 'sensor.status' });
    expect(send).not.toHaveBeenCalled();
  });

  describe('which runs take part in the bar integration', () => {
    function startWith(flags) {
      const context = {
        process: { platform: 'linux' },
        IS_SMOKE_TEST_MODE: false,
        IS_ISOLATED_PROFILE: false,
        IS_SOURCE_DEV_RUN: false,
        isOmarchyShellInstalled: jest.fn(() => false),
        ...flags,
      };
      vm.runInNewContext(block('function startOmarchyBarIntegration'), context);
      context.startOmarchyBarIntegration();
      return context.isOmarchyShellInstalled;
    }

    it('lets the installed widget in', () => {
      expect(startWith({})).toHaveBeenCalledTimes(1);
    });

    // npm run dev and the demos use a profile of their own, but the bar's socket and status file
    // live outside it. One of them would unlink the real widget's socket and delete both on exit.
    it.each([['a run from source'], ['a smoke test'], ['an isolated profile']])(
      'keeps %s out',
      (name) => {
        const flag = {
          'a run from source': 'IS_SOURCE_DEV_RUN',
          'a smoke test': 'IS_SMOKE_TEST_MODE',
          'an isolated profile': 'IS_ISOLATED_PROFILE',
        }[name];
        expect(startWith({ [flag]: true })).not.toHaveBeenCalled();
      }
    );

    it('treats --dev as a run from source only when the app is not packaged', () => {
      expect(mainSource).toContain('const IS_SOURCE_DEV_RUN = IS_DEV_MODE && !app.isPackaged;');
    });
  });

  it('listens on the bar socket while the integration runs', () => {
    const start = block('function startOmarchyBarIntegration');
    expect(start).toContain('socketPath: paths.socket');
    expect(start).toContain('onRequest: handleOmarchyBarEntityAction');
    expect(block('function stopOmarchyBarIntegration')).toContain(
      'omarchyBarCommandServer?.stop();'
    );
  });

  it('ignores anything else', () => {
    const { context, send } = loadRuntime();
    context.handleOmarchyBarEntityAction(primary('sensor.status'));
    context.handleOmarchyBarEntityAction(controls('calendar.home'));
    context.handleOmarchyBarEntityAction(primary('light.kitchen'));
    expect(send).not.toHaveBeenCalled();
    expect(context.showMainWindowFromTray).not.toHaveBeenCalled();
    const off = loadRuntime({ enabled: false });
    off.context.handleOmarchyBarEntityAction(primary('light.desk'));
    expect(off.send).not.toHaveBeenCalled();
    const removed = loadRuntime({ present: false });
    expect(removed.context.getOmarchyBarEntities().all).toEqual([]);
  });

  it('handles a bar request before any show or hide action on a second launch', () => {
    const start = mainSource.indexOf("app.on('second-instance'");
    const handler = mainSource.slice(start, mainSource.indexOf('\n  });\n', start));
    expect(handler.indexOf('getOmarchyBarActionRequest(argv)')).toBeLessThan(
      handler.indexOf('getLaunchAction(argv)')
    );
    // A request during startup waits in the same queue a first-instance request uses.
    expect(handler).toContain('pendingOmarchyBarAction = { ...barAction');
    expect(handler).toContain('deliverPendingOmarchyBarAction();\n      return;');
  });

  it('never keeps the runtime entity list in the saved config', () => {
    expect(block('function pruneConfig')).toContain('delete target.omarchyBarEntities;');
  });

  describe('a request that started a fresh widget', () => {
    function loadPending(requestedAt) {
      const { context, send } = loadRuntime();
      vm.runInNewContext(block('function deliverPendingOmarchyBarAction'), context);
      Object.assign(context, {
        OMARCHY_BAR_PENDING_ACTION_MS: 60000,
        pendingOmarchyBarAction: { ...primary('light.desk'), requestedAt },
        latestHaConnectionState: 'connecting',
      });
      context.omarchyBarTiles.clear();
      return { context, send };
    }

    it('waits for the connection and the tile, then acts once', () => {
      const { context, send } = loadPending(1000);
      context.deliverPendingOmarchyBarAction(2000);
      expect(send).not.toHaveBeenCalled();
      context.omarchyBarTiles.set('light.desk', lightTile);
      context.deliverPendingOmarchyBarAction(3000);
      expect(send).not.toHaveBeenCalled();
      context.latestHaConnectionState = 'connected';
      context.deliverPendingOmarchyBarAction(4000);
      context.deliverPendingOmarchyBarAction(5000);
      expect(send).toHaveBeenCalledTimes(1);
      expect(send).toHaveBeenCalledWith('omarchy-bar-entity-action', {
        entityId: 'light.desk',
        kind: 'primary',
      });
    });

    it('drops a request that could not be delivered within a minute', () => {
      const { context, send } = loadPending(1000);
      context.latestHaConnectionState = 'connected';
      context.omarchyBarTiles.set('light.desk', lightTile);
      context.deliverPendingOmarchyBarAction(62000);
      expect(send).not.toHaveBeenCalled();
      expect(context.pendingOmarchyBarAction).toBeNull();
    });

    it('is read from the first instance command line and delivered from both publish paths', () => {
      const lockStart = mainSource.indexOf('const gotSingleInstanceLock');
      expect(mainSource.slice(lockStart, lockStart + 300)).toContain(
        'getOmarchyBarActionRequest(process.argv)'
      );
      const tilesHandler = mainSource.slice(
        mainSource.indexOf("ipcMain.handle('publish-omarchy-bar-tiles'"),
        mainSource.indexOf("ipcMain.handle('publish-ha-snapshot'")
      );
      expect(tilesHandler).toContain('deliverPendingOmarchyBarAction();');
      expect(tilesHandler).toContain('cleanOmarchyBarTile(normalizedEntityId, tile)');
      expect(tilesHandler).toContain('cleanLineIconSvg(svg)');
      const connectionStart = mainSource.indexOf("ipcMain.handle('publish-ha-connection-state'");
      const connectionHandler = mainSource.slice(
        connectionStart,
        mainSource.indexOf('\n});\n', connectionStart)
      );
      expect(connectionHandler).toContain('deliverPendingOmarchyBarAction();');
    });
  });

  it('tells the bar about a locked keyring', () => {
    const context = { config: {} };
    vm.runInNewContext(block('function getOmarchyBarIssue'), context);
    expect(context.getOmarchyBarIssue()).toBe('');
    context.config = { homeAssistant: { oauthLastErrorCode: 'OAUTH_KEYRING_UNAVAILABLE' } };
    expect(context.getOmarchyBarIssue()).toBe('keyring');
    context.config = { tokenResetReason: 'encryption_unavailable' };
    expect(context.getOmarchyBarIssue()).toBe('keyring');
    context.config = { homeAssistant: { oauthLastErrorCode: 'OAUTH_STORE_DECRYPT' } };
    expect(context.getOmarchyBarIssue()).toBe('');
  });

  it('raises a desktop-layer widget started by an explicit --show or --toggle', () => {
    const declaration = mainSource.slice(
      mainSource.indexOf('let initialLaunchRaise'),
      mainSource.indexOf(';', mainSource.indexOf('let initialLaunchRaise'))
    );
    // Autostart passes no flag, and a restart carries HA_WIDGET_LAUNCH_VISIBILITY.
    expect(declaration).toContain('!process.env.HA_WIDGET_LAUNCH_VISIBILITY');
    expect(declaration).toContain("process.argv.includes('--toggle')");
    const loaded = mainSource.slice(
      mainSource.indexOf("mainWindow.webContents.on('did-finish-load'"),
      mainSource.indexOf('delete process.env.HA_WIDGET_LAUNCH_VISIBILITY')
    );
    expect(loaded).toContain(
      'else if (initialLaunchRaise && isLayerShellChildProcess) raiseLayerWidgetOnceMapped();'
    );
  });
});

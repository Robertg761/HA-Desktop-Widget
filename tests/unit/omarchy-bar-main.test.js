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

function loadRuntime({ enabled = true, present = true } = {}) {
  const send = jest.fn();
  const context = {
    ...omarchyBar,
    omarchyBarPublisher: enabled ? {} : null,
    omarchyBarEntry: { present, entities: ['light.desk', 'sensor.temp'], barEntities: [] },
    config: { favoriteEntities: [] },
    mainWindow: { isDestroyed: () => false, webContents: { send } },
    log: { warn: jest.fn() },
  };
  vm.runInNewContext(
    block('function getOmarchyBarEntities') + block('function handleOmarchyBarEntityToggle'),
    context
  );
  return { context, send };
}

describe('Omarchy bar requests in the main process', () => {
  it('toggles an entity the bar shows through the hotkey path', () => {
    const { context, send } = loadRuntime();
    context.handleOmarchyBarEntityToggle('light.desk');
    expect(send).toHaveBeenCalledWith('hotkey-triggered', {
      entityId: 'light.desk',
      action: 'toggle',
    });
  });

  it('ignores anything else', () => {
    const { context, send } = loadRuntime();
    context.handleOmarchyBarEntityToggle('sensor.temp');
    context.handleOmarchyBarEntityToggle('light.kitchen');
    expect(send).not.toHaveBeenCalled();
    const off = loadRuntime({ enabled: false });
    off.context.handleOmarchyBarEntityToggle('light.desk');
    expect(off.send).not.toHaveBeenCalled();
    const removed = loadRuntime({ present: false });
    expect(removed.context.getOmarchyBarEntities().all).toEqual([]);
  });

  it('handles --entity-toggle before any show or hide action on a second launch', () => {
    const start = mainSource.indexOf("app.on('second-instance'");
    const handler = mainSource.slice(start, mainSource.indexOf('\n  });\n', start));
    expect(handler.indexOf('getEntityToggleRequest(argv)')).toBeLessThan(
      handler.indexOf('getLaunchAction(argv)')
    );
    expect(handler).toContain('handleOmarchyBarEntityToggle(entityToggle);\n      return;');
  });

  it('never keeps the runtime entity list in the saved config', () => {
    expect(block('function pruneConfig')).toContain('delete target.omarchyBarEntities;');
  });

  describe('a toggle that started a fresh widget', () => {
    function loadPending(requestedAt) {
      const { context, send } = loadRuntime();
      vm.runInNewContext(block('function deliverPendingOmarchyBarToggle'), context);
      Object.assign(context, {
        OMARCHY_BAR_PENDING_TOGGLE_MS: 60000,
        pendingOmarchyBarToggle: { entityId: 'light.desk', requestedAt },
        latestHaConnectionState: 'connecting',
        omarchyBarStates: new Map(),
      });
      return { context, send };
    }

    it('waits for the connection and the entity state, then toggles once', () => {
      const { context, send } = loadPending(1000);
      context.deliverPendingOmarchyBarToggle(2000);
      expect(send).not.toHaveBeenCalled();
      context.omarchyBarStates.set('light.desk', { state: 'off' });
      context.deliverPendingOmarchyBarToggle(3000);
      expect(send).not.toHaveBeenCalled();
      context.latestHaConnectionState = 'connected';
      context.deliverPendingOmarchyBarToggle(4000);
      context.deliverPendingOmarchyBarToggle(5000);
      expect(send).toHaveBeenCalledTimes(1);
      expect(send).toHaveBeenCalledWith('hotkey-triggered', {
        entityId: 'light.desk',
        action: 'toggle',
      });
    });

    it('drops a request that could not be delivered within a minute', () => {
      const { context, send } = loadPending(1000);
      context.latestHaConnectionState = 'connected';
      context.omarchyBarStates.set('light.desk', { state: 'off' });
      context.deliverPendingOmarchyBarToggle(62000);
      expect(send).not.toHaveBeenCalled();
      expect(context.pendingOmarchyBarToggle).toBeNull();
    });

    it('is read from the first instance command line and delivered from both publish paths', () => {
      const lockStart = mainSource.indexOf('const gotSingleInstanceLock');
      expect(mainSource.slice(lockStart, lockStart + 300)).toContain(
        'getEntityToggleRequest(process.argv)'
      );
      const statesHandler = mainSource.slice(
        mainSource.indexOf("ipcMain.handle('publish-omarchy-bar-states'"),
        mainSource.indexOf("ipcMain.handle('publish-ha-snapshot'")
      );
      expect(statesHandler).toContain('deliverPendingOmarchyBarToggle();');
      const connectionStart = mainSource.indexOf("ipcMain.handle('publish-ha-connection-state'");
      const connectionHandler = mainSource.slice(
        connectionStart,
        mainSource.indexOf('\n});\n', connectionStart)
      );
      expect(connectionHandler).toContain('deliverPendingOmarchyBarToggle();');
    });
  });
});

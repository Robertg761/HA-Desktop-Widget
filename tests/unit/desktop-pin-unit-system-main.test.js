/**
 * @jest-environment node
 */

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const { normalizeHaUnitSystem } = require('../../src/desktop-pin-ipc.cjs');
const mainSource = fs.readFileSync(path.resolve(__dirname, '../../main.js'), 'utf8');

function sliceBetween(startMarker, endMarker) {
  const start = mainSource.indexOf(startMarker);
  return mainSource.slice(start, mainSource.indexOf(endMarker, start));
}

// Pin windows have no websocket, so main is the only way Home Assistant's unit system reaches them.
describe('desktop pin unit system relay in main', () => {
  function loadMain({ pins = ['climate.hall'] } = {}) {
    const send = jest.fn();
    const context = vm.createContext({
      normalizeHaUnitSystem,
      authorizeIpcSender: jest.fn(() => ({ type: 'main' })),
      rejectUnauthorizedIpc: jest.fn(() => ({ success: false })),
      ipcMain: { handle: jest.fn() },
      config: { desktopPins: Object.fromEntries(pins.map((id) => [id, {}])) },
      desktopPinWindows: new Map(
        pins.map((id) => [id, { isDestroyed: () => false, webContents: { send } }])
      ),
      latestEntityStates: new Map(),
      hasPublishedHaSnapshot: true,
      usesCompositorOwnedPlacement: false,
      createDesktopPinRendererConfig: () => ({}),
      createDesktopPinConnectionState: () => ({}),
      omarchyThemeWatcher: null,
      isLayerShellChildProcess: false,
      NATIVE_GLASS_SUPPORTED: true,
      isHyprland: () => false,
      hasDeferredSecureConfigWork: () => false,
      latestHaConnectionState: 'connected',
      desktopPinEditMode: false,
    });
    const handlerSource = sliceBetween(
      "ipcMain.handle('publish-ha-unit-system'",
      "ipcMain.handle('publish-ha-snapshot'"
    );
    vm.runInContext(
      `let latestHaUnitSystem = null;\n${sliceBetween(
        'function sendDesktopPinUpdate(',
        'function broadcastDesktopPinConfigUpdate('
      )}\n${handlerSource}`,
      context
    );
    const handler = context.ipcMain.handle.mock.calls.find(
      ([channel]) => channel === 'publish-ha-unit-system'
    )[1];
    return {
      context,
      send,
      publish: (unitSystem) => handler({}, unitSystem),
      sendUpdate: (entityId) => context.sendDesktopPinUpdate(entityId),
    };
  }

  it('has no unit system to send before the main renderer publishes one', () => {
    const { send, sendUpdate } = loadMain();

    sendUpdate('climate.hall');

    expect(send).toHaveBeenCalledWith(
      'desktop-pin-update',
      expect.objectContaining({ unitSystem: null })
    );
  });

  it('sends the published unit system with every update and tells open pins about a change', () => {
    const { send, publish, sendUpdate } = loadMain();

    expect(publish({ temperature: '°F', wind_speed: 'mph' })).toEqual({ success: true });

    expect(send).toHaveBeenCalledTimes(1);
    expect(send).toHaveBeenLastCalledWith(
      'desktop-pin-update',
      expect.objectContaining({
        type: 'unit-system',
        unitSystem: { temperature: '°F', wind_speed: 'mph' },
      })
    );
    sendUpdate('climate.hall');
    expect(send).toHaveBeenLastCalledWith(
      'desktop-pin-update',
      expect.objectContaining({ unitSystem: { temperature: '°F', wind_speed: 'mph' } })
    );
  });

  it('does not wake the pins when the same unit system is published again', () => {
    const { send, publish } = loadMain();

    publish({ temperature: '°F' });
    publish({ temperature: '°F' });

    expect(send).toHaveBeenCalledTimes(1);
  });

  it('rejects a payload that is not a unit system', () => {
    const { send, publish } = loadMain();

    expect(publish('°F')).toEqual({ success: false, error: 'Invalid unit system' });
    expect(send).not.toHaveBeenCalled();
  });

  it('includes the unit system in the bootstrap a new pin window asks for', () => {
    const bootstrapSource = sliceBetween(
      "ipcMain.handle('get-desktop-pin-bootstrap'",
      "ipcMain.handle('publish-ha-connection-state'"
    );

    expect(bootstrapSource).toContain('unitSystem: latestHaUnitSystem');
  });
});

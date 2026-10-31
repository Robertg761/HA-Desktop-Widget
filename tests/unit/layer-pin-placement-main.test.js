const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { clampLayerPosition } = require('../../src/layer-placement.cjs');

const mainSource = fs.readFileSync(path.resolve(__dirname, '../../main.js'), 'utf8');

function loadPlacementRuntime({ hyprland = false } = {}) {
  const place = jest.fn();
  const makeWindow = (id, title) => ({
    __desktopPinEntityId: id,
    isDestroyed: () => false,
    getBounds: () => ({ x: 0, y: 0, width: 168, height: 148 }),
    getTitle: () => title,
  });
  const pins = {
    'light.one': makeWindow('light.one', 'pin-one'),
    'light.two': makeWindow('light.two', 'pin-two'),
  };
  const context = {
    layerShellRaiser: { place },
    isHyprland: () => hyprland,
    layerActualMonitor: null,
    layerPositions: new Map(),
    clampLayerPosition,
    config: {
      layerPositions: {},
      // Both pins were saved at the same spot, as the old cascade could leave them.
      desktopPins: {
        'light.one': { x: 24, y: 24, width: 168, height: 148 },
        'light.two': { x: 24, y: 24, width: 168, height: 148 },
      },
    },
    desktopPinWindows: new Map(Object.entries(pins)),
    electronScreen: {
      getPrimaryDisplay: () => ({
        label: 'DP-1',
        id: 1,
        bounds: { x: 0, y: 0, width: 1920, height: 1080 },
        workArea: { x: 0, y: 28, width: 1920, height: 1052 },
      }),
    },
    log: { warn: jest.fn() },
  };
  const start = mainSource.indexOf('// The monitor surfaces are placed on, from Electron');
  const end = mainSource.indexOf('const hyprlandConfigReloadWatcher');
  expect(start).toBeGreaterThan(-1);
  expect(end).toBeGreaterThan(start);
  vm.runInNewContext(mainSource.slice(start, end), context);
  return { context, pins, place, makeWindow };
}

describe('placing layer surfaces without Hyprland', () => {
  it('spreads pins that were saved at the same spot instead of piling them in one corner', () => {
    const { context, pins, place } = loadPlacementRuntime();
    context.placeLayerWindow(pins['light.one']);
    context.placeLayerWindow(pins['light.two']);

    const [first, second] = place.mock.calls.map(([, position]) => position);
    expect(place.mock.calls.map(([title]) => title)).toEqual(['pin-one', 'pin-two']);
    // Both stay inside the work area (the primary display below its 28px panel).
    for (const position of [first, second]) {
      expect(position.x).toBeGreaterThanOrEqual(0);
      expect(position.y).toBeGreaterThanOrEqual(28);
      expect(position.x + 168).toBeLessThanOrEqual(1920);
      expect(position.y + 148).toBeLessThanOrEqual(1080);
    }
    expect(second).not.toEqual(first);
    // A pin never lands on top of the one placed before it.
    const overlaps =
      second.x < first.x + 168 + 8 &&
      second.x + 168 + 8 > first.x &&
      second.y < first.y + 148 + 8 &&
      second.y + 148 + 8 > first.y;
    expect(overlaps).toBe(false);
  });

  it('leaves the main widget at the helper anchor, since only Hyprland can say where it is', () => {
    const { context, place, makeWindow } = loadPlacementRuntime();
    context.placeLayerWindow(makeWindow(undefined, 'main widget'));
    expect(place).not.toHaveBeenCalled();
  });
});

describe('dropping a pin on a Hyprland layer surface', () => {
  function loadSnapRuntime() {
    const { snapDesktopPinPosition } = require('../../src/desktop-pin-snap.cjs');
    const place = jest.fn();
    const makeWindow = (id) => ({
      __desktopPinEntityId: id,
      isDestroyed: () => false,
      getBounds: () => ({ x: 0, y: 0, width: 168, height: 148 }),
      getTitle: () => `HA Pin: ${id}`,
    });
    const pins = { 'light.one': makeWindow('light.one'), 'light.two': makeWindow('light.two') };
    const context = {
      layerShellRaiser: { place },
      // Layer positions are in the monitor's coordinates; its work area is below a 28px bar.
      layerActualMonitor: {
        name: 'DP-1',
        x: 1920,
        y: 0,
        width: 1920,
        height: 1080,
        workArea: { x: 0, y: 28, width: 1920, height: 1052 },
      },
      layerPositions: new Map([['light.one', { x: 400, y: 100 }]]),
      desktopPinWindows: new Map(Object.entries(pins)),
      clampLayerPosition,
      snapDesktopPinPosition,
      config: { ui: {} },
    };
    const start = mainSource.indexOf('function snapLayerPinPosition');
    const end = mainSource.indexOf("ipcMain.handle('begin-layer-drag'");
    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
    const helper = mainSource.match(/function desktopPinSnapEnabled\(\) \{[^}]*\}/);
    expect(helper).not.toBeNull();
    vm.runInNewContext(`${helper[0]}\n${mainSource.slice(start, end)}`, context);
    return { context, pins, place };
  }

  it('lines the dropped pin up with the other pins', () => {
    const { context, pins, place } = loadSnapRuntime();
    context.layerPositions.set('light.two', { x: 405, y: 263 });

    context.snapLayerPinPosition({ id: 'light.two', window: pins['light.two'] });

    // Under light.one's left edge, still 15 px under its bottom (248), where it was dropped.
    expect(context.layerPositions.get('light.two')).toEqual({ x: 400, y: 263 });
    expect(place).toHaveBeenCalledWith('HA Pin: light.two', { x: 400, y: 263 });
  });

  it('leaves a dropped pin where it was dropped with snapping turned off', () => {
    const { context, pins, place } = loadSnapRuntime();
    context.config.ui.desktopPinSnap = false;
    context.layerPositions.set('light.two', { x: 405, y: 263 });

    context.snapLayerPinPosition({ id: 'light.two', window: pins['light.two'] });

    expect(context.layerPositions.get('light.two')).toEqual({ x: 405, y: 263 });
    expect(place).not.toHaveBeenCalled();
  });

  it('leaves a pin dropped away from the others alone', () => {
    const { context, pins, place } = loadSnapRuntime();
    context.layerPositions.set('light.two', { x: 900, y: 600 });

    context.snapLayerPinPosition({ id: 'light.two', window: pins['light.two'] });

    expect(context.layerPositions.get('light.two')).toEqual({ x: 900, y: 600 });
    expect(place).not.toHaveBeenCalled();
  });

  it('snaps to the bar edge of the work area', () => {
    const { context, pins } = loadSnapRuntime();
    context.layerPositions.set('light.two', { x: 1200, y: 33 });

    context.snapLayerPinPosition({ id: 'light.two', window: pins['light.two'] });

    expect(context.layerPositions.get('light.two')).toEqual({ x: 1200, y: 28 });
  });
});

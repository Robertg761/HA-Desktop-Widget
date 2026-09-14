/** @jest-environment node */
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const source = fs.readFileSync(path.join(__dirname, '../../main.js'), 'utf8');
const { chooseLayerMonitor, clampLayerPosition } = require('../../src/layer-placement.cjs');
function fixture() {
  const a = {
    name: 'DP-1',
    x: 0,
    y: 0,
    focused: true,
    workArea: { x: 0, y: 26, width: 1920, height: 1054 },
  };
  const b = { ...a, name: 'HDMI-A-1', x: 1920 };
  let monitors = [a, b];
  const mainWindow = {
    isDestroyed: () => false,
    getBounds: () => ({ width: 500, height: 600 }),
    getTitle: () => 'HA Desktop Widget',
  };
  const context = {
    isLayerShellChildProcess: true,
    isHyprland: () => true,
    mainWindow,
    config: {
      layerShellOutputName: 'DP-1',
      layerPositions: { main: { 'DP-1': { x: 1400, y: 470 } } },
    },
    process: { env: {} },
    readHyprlandMonitors: () => monitors,
    chooseLayerMonitor,
    clampLayerPosition,
    isQuitting: false,
    restartApplication: jest.fn(async () => {}),
    log: { warn: jest.fn() },
    layerShellRaiser: { place: jest.fn() },
    desktopPinWindows: new Map(),
  };
  vm.createContext(context);
  vm.runInContext(
    source.slice(
      source.indexOf('let layerMonitors ='),
      source.indexOf('const hyprlandConfigReloadWatcher =')
    ),
    context
  );
  return {
    ...context,
    context,
    a,
    b,
    setMonitors: (value) => {
      monitors = value;
    },
    refresh: () => vm.runInContext('refreshLayerPlacement()', context),
  };
}
test('unplugging the selected output requests fresh layer roles on the surviving output', () => {
  const f = fixture();
  f.refresh();
  expect(f.restartApplication).not.toHaveBeenCalled();
  f.setMonitors([f.b]);
  f.refresh();
  expect(f.restartApplication).toHaveBeenCalledTimes(1);
});
test('all displays disappearing and returning requires layer recovery even for the same output name', () => {
  const f = fixture();
  f.refresh();
  f.setMonitors([]);
  f.refresh();
  expect(f.restartApplication).not.toHaveBeenCalled();
  f.setMonitors([f.a]);
  f.refresh();
  expect(f.restartApplication).toHaveBeenCalledTimes(1);
});
test('scale and work-area changes clamp saved positions without restarting', () => {
  const f = fixture();
  f.refresh();
  f.setMonitors([{ ...f.a, workArea: { x: 0, y: 30, width: 1280, height: 690 } }]);
  f.refresh();
  expect(f.restartApplication).not.toHaveBeenCalled();
  expect(f.layerShellRaiser.place).toHaveBeenLastCalledWith('HA Desktop Widget', {
    x: 780,
    y: 120,
  });
});

test('an explicit output override stays authoritative after configuration reload', () => {
  const f = fixture();
  f.context.process.env.HA_WIDGET_LAYER_SHELL_OUTPUT = 'HDMI-A-1';
  f.refresh();
  expect(vm.runInContext('layerActualMonitor.name', f.context)).toBe('HDMI-A-1');
});

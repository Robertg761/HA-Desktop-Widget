const fs = require('fs');
const path = require('path');
const vm = require('vm');
const {
  getDesktopPinBaseBounds,
  clampDesktopPinBounds,
  getDesktopPinWindowBounds,
} = require('../../src/desktop-pin-bounds.js');

const mainSource = fs.readFileSync(path.resolve(__dirname, '../../main.js'), 'utf8');

function sliceMain(startMarker, endMarker) {
  const start = mainSource.indexOf(startMarker);
  const end = mainSource.indexOf(endMarker, start);
  expect(start).toBeGreaterThan(-1);
  expect(end).toBeGreaterThan(start);
  return mainSource.slice(start, end);
}

function createPinWindow(bounds) {
  let currentBounds = { ...bounds };
  return {
    __desktopPinEntityId: 'light.office',
    isDestroyed: () => false,
    getBounds: () => ({ ...currentBounds }),
    setBounds: jest.fn((next) => {
      currentBounds = { ...next };
    }),
    setSize: jest.fn(),
  };
}

function loadPinRuntime({ scale, pinBounds }) {
  const workArea = { x: 0, y: 0, width: 1280, height: 720 };
  const pinWindow = createPinWindow(pinBounds);
  const context = {
    config: { ui: { scale }, desktopPins: { 'light.office': { ...pinBounds } } },
    electronScreen: {
      getPrimaryDisplay: () => ({ workArea }),
      getDisplayMatching: () => ({ workArea }),
    },
    usesCompositorOwnedPlacement: false,
    isLayerShellChildProcess: false,
    desktopPinContentMinBounds: new Map(),
    desktopPinWindows: new Map([['light.office', pinWindow]]),
    latestEntityStates: new Map(),
    clampDesktopPinBoundsWithWorkArea: clampDesktopPinBounds,
    getDesktopPinBaseBounds,
    getDesktopPinWindowBoundsInWorkArea: getDesktopPinWindowBounds,
    applyDesktopPinWindowShape: jest.fn(),
    applyWindowOpacity: jest.fn(),
    applyDesktopPinEditModeToWindow: jest.fn(),
    applyDesktopPinWindowEffects: jest.fn(),
    sendDesktopPinUpdate: jest.fn(),
    closeDesktopPinWindow: jest.fn(),
    createDesktopPinWindow: jest.fn(),
    placeLayerWindow: jest.fn(),
    log: { warn: jest.fn() },
  };
  vm.runInNewContext(
    [
      sliceMain(
        'function getDesktopPinCascadeOrigin',
        'async function syncDesktopPinContentMinBounds'
      ),
      sliceMain('function getDesktopPinBounds(', 'function applyDesktopPinDesktopBehavior'),
      sliceMain(
        'function syncDesktopPinWindowsWithConfig',
        'function applyMainWindowSettingSideEffects'
      ),
    ].join('\n'),
    context
  );
  return { context, pinWindow };
}

describe('desktop pin windows follow Text and control size', () => {
  it('resizes an existing pin window from its saved position without rewriting saved bounds', () => {
    const saved = { x: 200, y: 120, width: 168, height: 148 };
    const { context, pinWindow } = loadPinRuntime({ scale: 1, pinBounds: saved });

    context.syncDesktopPinWindowsWithConfig();
    expect(pinWindow.setBounds).not.toHaveBeenCalled();

    context.config.ui.scale = 1.5;
    context.syncDesktopPinWindowsWithConfig();
    expect(pinWindow.getBounds()).toEqual({ x: 200, y: 120, width: 252, height: 222 });
    expect(context.applyDesktopPinWindowShape).toHaveBeenLastCalledWith(
      pinWindow,
      pinWindow.getBounds()
    );
    expect(context.config.desktopPins['light.office']).toEqual(saved);

    context.config.ui.scale = 1.3;
    context.syncDesktopPinWindowsWithConfig();
    expect(pinWindow.getBounds()).toEqual({ x: 200, y: 120, width: 219, height: 193 });

    context.config.ui.scale = 1;
    context.syncDesktopPinWindowsWithConfig();
    expect(pinWindow.getBounds()).toEqual(saved);
    expect(context.config.desktopPins['light.office']).toEqual(saved);
  });

  it('saves only the position when a scaled pin is moved', () => {
    const { context, pinWindow } = loadPinRuntime({
      scale: 1.5,
      pinBounds: { x: 200, y: 120, width: 168, height: 148 },
    });
    context.syncDesktopPinWindowsWithConfig();
    pinWindow.setBounds({ x: 300, y: 140, width: 252, height: 222 });

    expect(context.getDesktopPinBoundsFromWindow('light.office', pinWindow)).toEqual({
      x: 300,
      y: 140,
      width: 168,
      height: 148,
    });
  });
});

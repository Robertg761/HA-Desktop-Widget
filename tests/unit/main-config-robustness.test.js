/** @jest-environment node */
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const {
  clampDesktopPinBounds,
  getDesktopPinBaseBounds,
} = require('../../src/desktop-pin-bounds.js');
const { getMainWindowMinimumSize } = require('../../src/layer-shell.cjs');
const { boundsVisibleOnAnyWorkArea } = require('../../src/window-placement.cjs');

const mainSource = fs.readFileSync(path.resolve(__dirname, '../../main.js'), 'utf8');

function sliceMain(startMarker, endMarker) {
  const start = mainSource.indexOf(startMarker);
  const end = mainSource.indexOf(endMarker, start);
  expect(start).toBeGreaterThan(-1);
  expect(end).toBeGreaterThan(start);
  return mainSource.slice(start, end);
}

function loadConfigNormalizers() {
  const workArea = { x: 0, y: 0, width: 1920, height: 1080 };
  const context = {
    isPlainObject: (value) => !!value && typeof value === 'object' && !Array.isArray(value),
    DEFAULT_WINDOW_SIZE: { width: 500, height: 600 },
    getMainWindowMinimumSize,
    isLayerShellChildProcess: false,
    config: { ui: {} },
    normalizeEntityId: (value) =>
      typeof value === 'string' && /^[a-z_]+\.[a-z0-9_]+$/i.test(value) ? value.toLowerCase() : '',
    normalizeTrayEntitiesConfig: (value) => value || {},
    getDesktopPinBaseBounds,
    clampDesktopPinBoundsWithWorkArea: clampDesktopPinBounds,
    electronScreen: {
      getPrimaryDisplay: () => ({ workArea }),
      getDisplayMatching: () => ({ workArea }),
      getAllDisplays: () => [{ workArea }],
    },
    boundsVisibleOnAnyWorkArea,
    desktopPinContentMinBounds: new Map(),
    usesCompositorOwnedPlacement: false,
  };
  vm.createContext(context);
  vm.runInContext(
    sliceMain('function getDesktopPinCascadeOrigin(', 'function getDesktopPinWorkArea(') +
      sliceMain('function getDesktopPinWorkArea(', '/**\n * Native window bounds for a pin') +
      sliceMain(
        'function normalizeDesktopPinsConfig(',
        'function resolveDesktopPinSupportDecision('
      ) +
      sliceMain('function clampToMinimumWindowSize(', '/** Save the main window') +
      sliceMain('function getMainWindowMinimumSizeForConfig(', 'function createWindow('),
    context
  );
  return context;
}

describe('the size saved after a resize', () => {
  const context = loadConfigNormalizers();
  const { clampToMinimumWindowSize } = context;
  afterEach(() => {
    context.isLayerShellChildProcess = false;
    context.config = { ui: {} };
  });

  test('is held to the minimum for the text size in the config', () => {
    expect(clampToMinimumWindowSize({ width: 200, height: 250 })).toEqual({
      width: 320,
      height: 360,
    });

    context.config = { ui: { scale: 1.5 } };
    expect(clampToMinimumWindowSize({ width: 200, height: 250 })).toEqual({
      width: 480,
      height: 540,
    });
    // A window manager that ignores the hint saved 320x360 here, only 213x240 CSS pixels.
    expect(clampToMinimumWindowSize({ width: 320, height: 360 })).toEqual({
      width: 480,
      height: 540,
    });
    expect(clampToMinimumWindowSize({ width: 700, height: 500 })).toEqual({
      width: 700,
      height: 540,
    });
  });

  test('takes the text size of a config it is given instead of the live one', () => {
    context.config = { ui: { scale: 1 } };
    expect(clampToMinimumWindowSize({ width: 1, height: 1 }, { ui: { scale: 1.3 } })).toEqual({
      width: 416,
      height: 468,
    });
  });

  test('keeps the unscaled minimum for a desktop-layer surface', () => {
    context.isLayerShellChildProcess = true;
    context.config = { ui: { scale: 1.5 } };
    expect(clampToMinimumWindowSize({ width: 200, height: 250 })).toEqual({
      width: 320,
      height: 360,
    });
    const saved = { windowSize: { width: 330, height: 370 }, windowPosition: { x: 1, y: 1 } };
    saved.ui = { scale: 1.5 };
    context.normalizeWindowGeometryConfig(saved);
    expect(saved.windowSize).toEqual({ width: 330, height: 370 });
  });

  test('every place that saves the window size goes through it', () => {
    // Putting a size back after a failed save restores one that was already saved this way.
    const saves = mainSource
      .match(/config\.windowSize = [^;]+;/g)
      .filter((assignment) => !/= previous\w+;$/.test(assignment));
    expect(saves).toEqual([
      'config.windowSize = clampToMinimumWindowSize(boundsToPersist);',
      'config.windowSize = clampToMinimumWindowSize(defaultBounds);',
      'config.windowSize = clampToMinimumWindowSize(pendingWindowBounds);',
    ]);
  });
});

describe('a damaged config does not stop the widget from starting', () => {
  const { normalizeDesktopPinsConfig, normalizeWindowGeometryConfig } = loadConfigNormalizers();

  test('a pin saved as null, text or a list is dropped and the others are kept', () => {
    const config = {
      desktopPins: {
        'light.desk': { x: 10, y: 20, width: 200, height: 200 },
        'sensor.broken': null,
        'switch.text': 'left',
        'fan.list': [],
      },
    };

    expect(() => normalizeDesktopPinsConfig(config)).not.toThrow();

    expect(Object.keys(config.desktopPins)).toEqual(['light.desk']);
    expect(config.desktopPins['light.desk']).toMatchObject({ x: 10, y: 20 });
  });

  test('a pin saved as null does not fail a later save either', () => {
    const config = { desktopPins: { 'light.desk': null } };
    expect(() => normalizeDesktopPinsConfig(config)).not.toThrow();
    expect(config.desktopPins).toEqual({});
  });

  test.each([[null], ['big'], [42], [{ width: 'x', height: 600 }], [{ width: 500 }], [{}], [[]]])(
    'a window size of %j falls back to the default',
    (windowSize) => {
      const config = { windowSize, windowPosition: { x: 5, y: 6 } };

      normalizeWindowGeometryConfig(config);

      expect(config.windowSize).toEqual({ width: 500, height: 600 });
      expect(config.windowPosition).toEqual({ x: 5, y: 6 });
    }
  );

  test.each([[null], ['top left'], [{ x: 'a', y: 1 }], [{ x: 1 }], [{ x: NaN, y: 1 }]])(
    'a window position of %j falls back to the default',
    (windowPosition) => {
      const config = { windowSize: { width: 640, height: 480 }, windowPosition };

      normalizeWindowGeometryConfig(config);

      expect(config.windowPosition).toEqual({ x: 100, y: 100 });
      expect(config.windowSize).toEqual({ width: 640, height: 480 });
    }
  );

  test('keeps a sensible size and clamps an absurd one', () => {
    const sensible = {
      windowSize: { width: 640.4, height: 480 },
      windowPosition: { x: -20, y: 30 },
    };
    normalizeWindowGeometryConfig(sensible);
    expect(sensible).toEqual({
      windowSize: { width: 640, height: 480 },
      windowPosition: { x: -20, y: 30 },
    });

    const absurd = { windowSize: { width: 1e9, height: 0 }, windowPosition: { x: 1, y: 1 } };
    normalizeWindowGeometryConfig(absurd);
    expect(absurd.windowSize).toEqual({ width: 16384, height: 360 });
  });

  // A corner dragged far past the header once saved a 100x1 window, and the next start opened it
  // that size with Settings and Close out of reach.
  test('raises a sliver of a window to the minimum size', () => {
    const sliver = { windowSize: { width: 100, height: 1 }, windowPosition: { x: 1, y: 1 } };
    normalizeWindowGeometryConfig(sliver);
    expect(sliver.windowSize).toEqual({ width: 320, height: 360 });
  });

  // Electron's minimum-size hint is all that holds a window to its minimum, and some window
  // managers ignore it. The minimum grows with "Text and control size", so a size saved at 150%
  // text has to be held to 480x540, not 320x360, or the next start opens a window whose layout
  // is only 213x240 CSS pixels.
  test.each([
    [1, 320, 360],
    [1.15, 368, 414],
    [1.3, 416, 468],
    [1.5, 480, 540],
  ])('raises a saved size to the minimum for %sx text', (scale, width, height) => {
    const small = {
      windowSize: { width: 330, height: 370 },
      windowPosition: { x: 1, y: 1 },
      ui: { scale },
    };
    normalizeWindowGeometryConfig(small);
    expect(small.windowSize).toEqual({
      width: Math.max(330, width),
      height: Math.max(370, height),
    });

    const sliver = {
      windowSize: { width: 100, height: 1 },
      windowPosition: { x: 1, y: 1 },
      ui: { scale },
    };
    normalizeWindowGeometryConfig(sliver);
    expect(sliver.windowSize).toEqual({ width, height });
  });

  test('keeps a size above the scaled minimum, and treats an unknown text size as 100%', () => {
    const roomy = {
      windowSize: { width: 500, height: 600 },
      windowPosition: { x: 1, y: 1 },
      ui: { scale: 1.5 },
    };
    normalizeWindowGeometryConfig(roomy);
    expect(roomy.windowSize).toEqual({ width: 500, height: 600 });

    for (const scale of [undefined, 7, 'big', null]) {
      const unknown = { windowSize: { width: 1, height: 1 }, windowPosition: { x: 1, y: 1 } };
      unknown.ui = { scale };
      normalizeWindowGeometryConfig(unknown);
      expect(unknown.windowSize).toEqual({ width: 320, height: 360 });
    }
  });

  test('loadConfig applies it to the config it merged from disk', () => {
    const loadConfig = sliceMain('function loadConfig(', '\nfunction backupConfig(');
    expect(loadConfig.indexOf('normalizeWindowGeometryConfig(config)')).toBeGreaterThan(
      loadConfig.indexOf('normalizeDesktopPinsConfig(config)')
    );
  });

  test('a startup failure is shown and ends the process instead of leaving it headless', () => {
    const handler = mainSource.slice(
      mainSource.indexOf("log.error('Application startup failed:'"),
      mainSource.indexOf('// XWayland cannot render at all')
    );
    expect(handler).toContain('dialog.showErrorBox(');
    expect(handler).toContain('app.exit(1)');
    // A failure after the window is up leaves a working widget, which stays.
    expect(handler.slice(0, handler.indexOf('showErrorBox'))).toContain(
      'mainWindow && !mainWindow.isDestroyed()'
    );
    // The smoke test reports its own result and must not be interrupted by a dialog.
    expect(handler.indexOf('IS_SMOKE_TEST_MODE')).toBeLessThan(handler.indexOf('showErrorBox'));
  });
});

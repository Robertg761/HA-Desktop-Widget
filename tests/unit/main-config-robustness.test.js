/** @jest-environment node */
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const {
  clampDesktopPinBounds,
  getDesktopPinBaseBounds,
} = require('../../src/desktop-pin-bounds.js');

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
    MIN_WINDOW_SIZE: { width: 320, height: 360 },
    normalizeEntityId: (value) =>
      typeof value === 'string' && /^[a-z_]+\.[a-z0-9_]+$/i.test(value) ? value.toLowerCase() : '',
    normalizeTrayEntitiesConfig: (value) => value || {},
    getDesktopPinBaseBounds,
    clampDesktopPinBoundsWithWorkArea: clampDesktopPinBounds,
    electronScreen: {
      getPrimaryDisplay: () => ({ workArea }),
      getDisplayMatching: () => ({ workArea }),
    },
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
      ),
    context
  );
  return context;
}

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

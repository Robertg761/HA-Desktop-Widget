const fs = require('fs');
const path = require('path');
const vm = require('vm');
const {
  getDesktopPinBaseBounds,
  clampDesktopPinBounds,
  resizeDesktopPinBounds,
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

function loadResizeRuntime({ scale = 1, bounds }) {
  const primary = { x: 0, y: 0, width: 1920, height: 1080 };
  const secondary = { x: 1920, y: 0, width: 1920, height: 1080 };
  const pinWindow = {
    __desktopPinEntityId: 'light.office',
    isDestroyed: () => false,
    setBounds: jest.fn(),
    setSize: jest.fn(),
  };
  // A display picker that always answers with the monitor that holds the pin's left edge.
  const getDisplayMatching = jest.fn((rect) => ({
    workArea: rect.x >= secondary.x ? secondary : primary,
  }));
  const context = {
    config: { ui: { scale }, desktopPins: { 'light.office': { ...bounds } } },
    electronScreen: { getPrimaryDisplay: () => ({ workArea: primary }), getDisplayMatching },
    usesCompositorOwnedPlacement: false,
    isLayerShellChildProcess: false,
    desktopPinEditMode: true,
    desktopPinContentMinBounds: new Map(),
    desktopPinWindows: new Map([['light.office', pinWindow]]),
    desktopPinResizeSessions: new Map(),
    DESKTOP_PIN_RESIZE_IDLE_SAVE_MS: 1500,
    DESKTOP_PIN_RESIZE_CORNERS: new Set(['top-left', 'top-right', 'bottom-left', 'bottom-right']),
    clampDesktopPinBoundsWithWorkArea: clampDesktopPinBounds,
    resizeDesktopPinBoundsInWorkArea: resizeDesktopPinBounds,
    getDesktopPinBaseBounds,
    getDesktopPinWindowBoundsInWorkArea: getDesktopPinWindowBounds,
    applyDesktopPinWindowShape: jest.fn(),
    sendDesktopPinUpdate: jest.fn(),
    placeLayerWindow: jest.fn(),
    saveConfigDurably: jest.fn().mockResolvedValue({ success: true }),
    saveConfig: jest.fn(),
    pushConfigToRenderer: jest.fn(),
    runBackgroundConfigMutation: jest.fn((task) => task()),
    runPostSaveSideEffect: async (_warnings, _label, task) => task(),
    normalizeEntityId: (entityId) => String(entityId || '').trim(),
    mainT: (text) => text,
    isPlainObject: (value) => !!value && typeof value === 'object' && !Array.isArray(value),
    log: { warn: jest.fn() },
    setTimeout,
    clearTimeout,
  };
  vm.runInNewContext(
    [
      sliceMain(
        'function getDesktopPinCascadeOrigin',
        'async function syncDesktopPinContentMinBounds'
      ),
      sliceMain(
        'function normalizeDesktopPinResizeRequest',
        'function createDesktopPinWindow(entityId'
      ),
    ].join('\n'),
    context
  );
  return { context, pinWindow, getDisplayMatching };
}

describe('resizing a desktop pin in the main process', () => {
  afterEach(() => {
    jest.useRealTimers();
  });

  it('applies each drag step to the window without writing config or redrawing every window', async () => {
    const { context, pinWindow } = loadResizeRuntime({
      bounds: { x: 100, y: 100, width: 168, height: 148 },
    });

    for (const width of [180, 200, 220]) {
      const result = await context.updateDesktopPinBounds('light.office', {
        width,
        height: 160,
        resize: { corner: 'bottom-right', final: false },
      });
      expect(result).toMatchObject({ success: true, pinBounds: { x: 100, y: 100, width } });
    }

    expect(pinWindow.setBounds).toHaveBeenLastCalledWith({
      x: 100,
      y: 100,
      width: 220,
      height: 160,
    });
    expect(context.saveConfigDurably).not.toHaveBeenCalled();
    expect(context.pushConfigToRenderer).not.toHaveBeenCalled();
    expect(context.config.desktopPins['light.office']).toEqual({
      x: 100,
      y: 100,
      width: 220,
      height: 160,
    });
    // The pin itself hears about every step, to re-lay itself out.
    expect(context.sendDesktopPinUpdate).toHaveBeenCalledTimes(3);
    context.endDesktopPinResizeSession('light.office');
  });

  it('writes the size once, when the drag is reported finished', async () => {
    const { context } = loadResizeRuntime({
      bounds: { x: 100, y: 100, width: 168, height: 148 },
    });
    await context.updateDesktopPinBounds('light.office', {
      width: 200,
      height: 180,
      resize: { corner: 'bottom-right', final: false },
    });
    const result = await context.updateDesktopPinBounds('light.office', {
      width: 210,
      height: 190,
      resize: { corner: 'bottom-right', final: true },
    });

    expect(result).toMatchObject({ success: true, pinBounds: { width: 210, height: 190 } });
    expect(context.saveConfigDurably).toHaveBeenCalledTimes(1);
    expect(context.pushConfigToRenderer).toHaveBeenCalledTimes(1);
    expect(context.desktopPinResizeSessions.size).toBe(0);
  });

  it('keeps the work area the drag began on, so a pin does not jump to the next monitor', async () => {
    const { context, getDisplayMatching } = loadResizeRuntime({
      bounds: { x: 1700, y: 100, width: 168, height: 148 },
    });
    await context.updateDesktopPinBounds('light.office', {
      width: 400,
      height: 148,
      resize: { corner: 'bottom-right', final: false },
    });
    const picks = getDisplayMatching.mock.calls.length;
    await context.updateDesktopPinBounds('light.office', {
      width: 500,
      height: 148,
      resize: { corner: 'bottom-right', final: false },
    });

    // Growing stops at the first monitor's edge (220px of room) rather than sliding the pin left
    // or handing it to the second monitor; the display is looked up once per drag.
    expect(context.config.desktopPins['light.office']).toMatchObject({ x: 1700, width: 220 });
    expect(getDisplayMatching.mock.calls.length).toBe(picks);
    context.endDesktopPinResizeSession('light.office');
  });

  it('writes the size itself if the renderer never finishes the drag', async () => {
    jest.useFakeTimers();
    const { context } = loadResizeRuntime({
      bounds: { x: 100, y: 100, width: 168, height: 148 },
    });
    await context.updateDesktopPinBounds('light.office', {
      width: 200,
      height: 180,
      resize: { corner: 'bottom-right', final: false },
    });
    expect(context.saveConfig).not.toHaveBeenCalled();

    jest.advanceTimersByTime(1600);

    expect(context.saveConfig).toHaveBeenCalledTimes(1);
    expect(context.desktopPinResizeSessions.size).toBe(0);
  });

  it('does not store the resize hint in the saved bounds', async () => {
    const { context } = loadResizeRuntime({
      bounds: { x: 100, y: 100, width: 168, height: 148 },
    });
    await context.updateDesktopPinBounds('light.office', {
      width: 200,
      height: 180,
      resize: { corner: 'top-left', final: true },
    });
    expect(Object.keys(context.config.desktopPins['light.office']).sort()).toEqual([
      'height',
      'width',
      'x',
      'y',
    ]);
    // The right and bottom edges (268, 248) stayed where they were.
    expect(context.config.desktopPins['light.office']).toEqual({
      x: 68,
      y: 68,
      width: 200,
      height: 180,
    });
  });

  describe('when the final save fails', () => {
    const start = { x: 100, y: 100, width: 168, height: 148 };
    const frame = (context, width, corner = 'top-left', final = false) =>
      context.updateDesktopPinBounds('light.office', {
        width,
        height: 148,
        resize: { corner, final },
      });

    it('puts the pin back to what was saved before the drag, not to the last step', async () => {
      const { context, pinWindow } = loadResizeRuntime({ bounds: start });
      await frame(context, 200);
      await frame(context, 220);
      expect(context.config.desktopPins['light.office']).toMatchObject({ x: 48, width: 220 });
      context.sendDesktopPinUpdate.mockClear();
      context.saveConfigDurably.mockResolvedValueOnce({ success: false, error: 'disk full' });

      const result = await frame(context, 240, 'top-left', true);

      expect(result).toMatchObject({ success: false, pinBounds: start });
      expect(result.error).toContain('Failed to save desktop pin position');
      // Neither the config, which a later unrelated save would write out, nor the window keeps
      // a size that was never written.
      expect(context.config.desktopPins['light.office']).toEqual(start);
      expect(pinWindow.setBounds).toHaveBeenLastCalledWith(start);
      expect(context.sendDesktopPinUpdate).toHaveBeenCalledWith('light.office', { type: 'bounds' });
      expect(context.desktopPinResizeSessions.size).toBe(0);
    });

    it('goes back to the size an earlier idle save wrote', async () => {
      jest.useFakeTimers();
      const { context } = loadResizeRuntime({ bounds: start });
      await frame(context, 200);
      // The renderer went quiet for a moment, so main wrote the size it had reached.
      jest.advanceTimersByTime(1600);
      expect(context.saveConfig).toHaveBeenCalledTimes(1);
      const written = { ...context.config.desktopPins['light.office'] };
      await frame(context, 220);
      context.saveConfigDurably.mockResolvedValueOnce({ success: false, error: 'disk full' });

      const result = await frame(context, 240, 'top-left', true);

      expect(result.pinBounds).toEqual(written);
      expect(context.config.desktopPins['light.office']).toEqual(written);
    });

    it('restores a single keyboard step that cannot be saved', async () => {
      const { context, pinWindow } = loadResizeRuntime({ bounds: start });
      context.saveConfigDurably.mockResolvedValueOnce({ success: false, error: 'disk full' });

      const result = await frame(context, 200, 'bottom-right', true);

      expect(result).toMatchObject({ success: false, pinBounds: start });
      expect(context.config.desktopPins['light.office']).toEqual(start);
      expect(pinWindow.setBounds).toHaveBeenLastCalledWith(start);
    });
  });

  it('still moves a pin with a plain position update', async () => {
    const { context } = loadResizeRuntime({
      bounds: { x: 100, y: 100, width: 168, height: 148 },
    });
    const result = await context.updateDesktopPinBounds('light.office', { x: 300, y: 200 });
    expect(result.pinBounds).toEqual({ x: 300, y: 200, width: 168, height: 148 });
    expect(context.saveConfigDurably).toHaveBeenCalledTimes(1);
  });
});

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const {
  getDesktopPinBaseBounds,
  clampDesktopPinBounds,
  resizeDesktopPinBounds,
  getDesktopPinWindowBounds,
} = require('../../src/desktop-pin-bounds.js');
const { clampLayerPosition } = require('../../src/layer-placement.cjs');

const mainSource = fs.readFileSync(path.resolve(__dirname, '../../main.js'), 'utf8');

function sliceMain(startMarker, endMarker) {
  const start = mainSource.indexOf(startMarker);
  const end = mainSource.indexOf(endMarker, start);
  expect(start).toBeGreaterThan(-1);
  expect(end).toBeGreaterThan(start);
  return mainSource.slice(start, end);
}

// `layer` runs the pin as a layer surface on Hyprland: { monitor, layerPositions }, where the
// positions are the ones config.json holds, per output.
function loadResizeRuntime({ scale = 1, bounds, layer = null, compositorPlacement = !!layer }) {
  const primary = { x: 0, y: 0, width: 1920, height: 1080 };
  const secondary = { x: 1920, y: 0, width: 1920, height: 1080 };
  const place = jest.fn();
  const pinWindow = {
    __desktopPinEntityId: 'light.office',
    isDestroyed: () => false,
    getBounds: () => ({ x: 0, y: 0, width: 168, height: 148 }),
    getTitle: () => 'HA Pin: light.office',
    setBounds: jest.fn(),
    setSize: jest.fn(),
  };
  // A display picker that always answers with the monitor that holds the pin's left edge.
  const getDisplayMatching = jest.fn((rect) => ({
    workArea: rect.x >= secondary.x ? secondary : primary,
  }));
  const context = {
    config: {
      ui: { scale },
      desktopPins: { 'light.office': { ...bounds } },
      layerPositions: layer?.layerPositions || {},
    },
    electronScreen: { getPrimaryDisplay: () => ({ workArea: primary }), getDisplayMatching },
    usesCompositorOwnedPlacement: compositorPlacement,
    isLayerShellChildProcess: !!layer,
    layerShellRaiser: layer ? { place } : null,
    isHyprland: () => true,
    layerActualMonitor: layer?.monitor || null,
    layerPositions: new Map(),
    clampLayerPosition,
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
      sliceMain(
        '// The monitor surfaces are placed on, from Electron',
        'const hyprlandConfigReloadWatcher'
      ),
    ].join('\n'),
    context
  );
  // The window was placed when it opened, which is what a resize starts from.
  if (layer) context.placeLayerWindow(pinWindow);
  return { context, pinWindow, getDisplayMatching, place };
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

  it('moves the window origin with a top or left handle so the opposite edge stays put', async () => {
    const { context, pinWindow } = loadResizeRuntime({
      bounds: { x: 100, y: 100, width: 168, height: 148 },
    });
    await context.updateDesktopPinBounds('light.office', {
      width: 200,
      height: 180,
      resize: { corner: 'top-left', final: false },
    });

    // The right and bottom edges (268, 248) are where they were.
    expect(pinWindow.setBounds).toHaveBeenLastCalledWith({
      x: 68,
      y: 68,
      width: 200,
      height: 180,
    });
    expect(context.config.desktopPins['light.office']).toEqual({
      x: 68,
      y: 68,
      width: 200,
      height: 180,
    });
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
    expect(context.saveConfigDurably).not.toHaveBeenCalled();

    await jest.advanceTimersByTimeAsync(1600);

    // Durably, and the session is not given up until the write has succeeded.
    expect(context.saveConfigDurably).toHaveBeenCalledTimes(1);
    expect(context.pushConfigToRenderer).toHaveBeenCalledTimes(1);
    expect(context.desktopPinResizeSessions.size).toBe(0);
    expect(context.config.desktopPins['light.office']).toMatchObject({ width: 200, height: 180 });
  });

  it('keeps the drag when a step reached the config queue before the idle write did', async () => {
    jest.useFakeTimers();
    const { context } = loadResizeRuntime({
      bounds: { x: 100, y: 100, width: 168, height: 148 },
    });
    const queued = [];
    context.runBackgroundConfigMutation = jest.fn((task) => queued.push(task));
    const step = (width) =>
      context.updateDesktopPinBounds('light.office', {
        width,
        height: 148,
        resize: { corner: 'bottom-right', final: false },
      });
    await step(200);
    jest.advanceTimersByTime(1600);
    expect(queued).toHaveLength(1);

    // The renderer's next step is in the queue ahead of the idle write.
    await step(210);
    await queued[0]();

    expect(context.saveConfigDurably).not.toHaveBeenCalled();
    expect(context.saveConfig).not.toHaveBeenCalled();
    expect(context.pushConfigToRenderer).not.toHaveBeenCalled();
    expect(context.desktopPinResizeSessions.size).toBe(1);
    context.endDesktopPinResizeSession('light.office');
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
      await jest.advanceTimersByTimeAsync(1600);
      expect(context.saveConfigDurably).toHaveBeenCalledTimes(1);
      const written = { ...context.config.desktopPins['light.office'] };
      await frame(context, 220);
      context.saveConfigDurably.mockResolvedValueOnce({ success: false, error: 'disk full' });

      const result = await frame(context, 240, 'top-left', true);

      expect(result.pinBounds).toEqual(written);
      expect(context.config.desktopPins['light.office']).toEqual(written);
    });

    it('puts the pin back when the write after a quiet moment fails, and a drag that resumes goes back to the saved size', async () => {
      jest.useFakeTimers();
      const { context, pinWindow } = loadResizeRuntime({ bounds: start });
      await frame(context, 200);
      context.saveConfigDurably.mockResolvedValueOnce({ success: false, error: 'disk full' });

      await jest.advanceTimersByTimeAsync(1600);

      // Memory and file agree again: nothing keeps a size that was never written.
      expect(context.config.desktopPins['light.office']).toEqual(start);
      expect(pinWindow.setBounds).toHaveBeenLastCalledWith(start);
      expect(context.log.warn).toHaveBeenCalledWith(
        'Failed to save the desktop pin size:',
        'disk full'
      );
      expect(context.desktopPinResizeSessions.size).toBe(0);
      expect(context.pushConfigToRenderer).not.toHaveBeenCalled();

      // The drag carries on and its own final save fails too: it goes back to the file's size,
      // not to the intermediate one the failed write never stored.
      await frame(context, 230);
      context.saveConfigDurably.mockResolvedValueOnce({ success: false, error: 'disk full' });
      const result = await frame(context, 240, 'top-left', true);
      expect(result.pinBounds).toEqual(start);
      expect(context.config.desktopPins['light.office']).toEqual(start);
    });

    it('does not bring back a pin that was unpinned before the failed write ran', async () => {
      jest.useFakeTimers();
      const { context, pinWindow } = loadResizeRuntime({ bounds: start });
      await frame(context, 200);
      // Unpinning removes the pin from the config but leaves the drag's session to run out.
      delete context.config.desktopPins['light.office'];
      pinWindow.setBounds.mockClear();
      context.sendDesktopPinUpdate.mockClear();
      context.saveConfigDurably.mockResolvedValueOnce({ success: false, error: 'disk full' });

      await jest.advanceTimersByTimeAsync(1600);

      expect(context.config.desktopPins).not.toHaveProperty('light.office');
      expect(pinWindow.setBounds).not.toHaveBeenCalled();
      expect(context.sendDesktopPinUpdate).not.toHaveBeenCalled();
      expect(context.desktopPinResizeSessions.size).toBe(0);
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

  describe('as a layer surface', () => {
    // A Hyprland output to the right of the first, with a 30px bar along its top.
    const monitor = {
      name: 'DP-2',
      x: 1920,
      y: 0,
      width: 1920,
      height: 1080,
      workArea: { x: 0, y: 30, width: 1920, height: 1050 },
    };
    // Saved x/y are global; the layer position is relative to the output: (2100,200) is (180,200).
    const start = { x: 2100, y: 200, width: 168, height: 148 };
    const drag = (context, request, final = false) =>
      context.updateDesktopPinBounds('light.office', {
        height: 148,
        ...request,
        resize: { corner: request.corner, final },
      });
    const layerPositionOf = (context) => context.config.layerPositions['light.office']?.['DP-2'];

    it('keeps the edge opposite a top or left handle fixed by moving the layer position', async () => {
      const { context, pinWindow, place } = loadResizeRuntime({
        bounds: start,
        layer: { monitor },
      });
      expect(place).toHaveBeenLastCalledWith('HA Pin: light.office', { x: 180, y: 200 });

      // Right edge 2268 and bottom edge 348 on screen, so the corner moves to (2068, 168).
      await drag(context, { corner: 'top-left', width: 200, height: 180 });

      expect(pinWindow.setSize).toHaveBeenLastCalledWith(200, 180);
      expect(place).toHaveBeenLastCalledWith('HA Pin: light.office', { x: 148, y: 168 });
      expect(layerPositionOf(context)).toEqual({ x: 148, y: 168 });
      // The saved x and y stay what they were; a layer surface is not placed from them.
      expect(context.config.desktopPins['light.office']).toMatchObject({ x: 2100, y: 200 });

      // The next step measures from where the surface now is.
      await drag(context, { corner: 'top-left', width: 220, height: 200 });
      expect(place).toHaveBeenLastCalledWith('HA Pin: light.office', { x: 128, y: 148 });
    });

    it('anchors the left edge for a left handle and the top edge for a top handle alone', async () => {
      const { context, place } = loadResizeRuntime({ bounds: start, layer: { monitor } });
      await drag(context, { corner: 'bottom-left', width: 200, height: 180 });
      // Left handle: the right edge stays, the top edge does.
      expect(place).toHaveBeenLastCalledWith('HA Pin: light.office', { x: 148, y: 200 });

      await drag(context, { corner: 'top-right', width: 220, height: 200 });
      // Top handle: the bottom edge (380) stays, so the top moves up; the left edge stays.
      expect(place).toHaveBeenLastCalledWith('HA Pin: light.office', { x: 148, y: 180 });
    });

    it('leaves the surface where it is for a bottom-right handle', async () => {
      const { context, place } = loadResizeRuntime({ bounds: start, layer: { monitor } });
      await drag(context, { corner: 'bottom-right', width: 200, height: 180 });
      expect(place).toHaveBeenLastCalledWith('HA Pin: light.office', { x: 180, y: 200 });
    });

    it('resizes from where a dragged surface is, not from the pin saved x and y', async () => {
      // The surface was dragged to (50, 100) on its output, which only the layer position records.
      const { context, place } = loadResizeRuntime({
        bounds: start,
        layer: { monitor, layerPositions: { 'light.office': { 'DP-2': { x: 50, y: 100 } } } },
      });
      expect(place).toHaveBeenLastCalledWith('HA Pin: light.office', { x: 50, y: 100 });

      await drag(context, { corner: 'top-left', width: 200, height: 180 });

      // Its right edge (218) and bottom edge (248) stay, so the corner moves to (18, 68).
      expect(place).toHaveBeenLastCalledWith('HA Pin: light.office', { x: 18, y: 68 });
    });

    it('stops at the edge of the output work area instead of leaving it', async () => {
      const { context, place } = loadResizeRuntime({ bounds: start, layer: { monitor } });
      await drag(context, { corner: 'top-left', width: 900, height: 900 });
      // Left edge at the output's edge, top edge under the bar.
      expect(place).toHaveBeenLastCalledWith('HA Pin: light.office', { x: 0, y: 30 });
    });

    it('writes the new position with the size when the drag ends', async () => {
      const { context } = loadResizeRuntime({ bounds: start, layer: { monitor } });
      await drag(context, { corner: 'top-left', width: 200, height: 180 });
      let saved = null;
      context.saveConfigDurably.mockImplementationOnce(async () => {
        saved = JSON.parse(JSON.stringify(context.config));
        return { success: true };
      });

      await drag(context, { corner: 'top-left', width: 210, height: 190 }, true);

      expect(saved.layerPositions['light.office']['DP-2']).toEqual({ x: 138, y: 158 });
      expect(saved.desktopPins['light.office']).toMatchObject({ width: 210, height: 190 });
    });

    it('puts the layer position back with the size when the final save fails', async () => {
      const { context, pinWindow, place } = loadResizeRuntime({
        bounds: start,
        layer: { monitor },
      });
      await drag(context, { corner: 'top-left', width: 200, height: 180 });
      expect(layerPositionOf(context)).toEqual({ x: 148, y: 168 });
      context.saveConfigDurably.mockResolvedValueOnce({ success: false, error: 'disk full' });

      const result = await drag(context, { corner: 'top-left', width: 220, height: 200 }, true);

      expect(result).toMatchObject({ success: false, pinBounds: start });
      // Nothing was saved for this pin before the drag, so nothing is left in the config, and the
      // surface is placed where it opened.
      expect(context.config.layerPositions).toEqual({});
      expect(context.config.desktopPins['light.office']).toEqual(start);
      expect(pinWindow.setSize).toHaveBeenLastCalledWith(168, 148);
      expect(place).toHaveBeenLastCalledWith('HA Pin: light.office', { x: 180, y: 200 });
    });

    it('keeps a surface the app placed itself where it is drawn, and saves that spot', async () => {
      // The overlap search put this pin at (124, 154) on its output; its saved x and y say (180, 200).
      const { context, place } = loadResizeRuntime({ bounds: start, layer: { monitor } });
      context.layerPositions.set('light.office', { x: 124, y: 154 });

      await drag(context, { corner: 'bottom-right', width: 200, height: 180 });

      // Not placed afresh from the saved x and y, which can be another spot as its size changes.
      expect(place).toHaveBeenLastCalledWith('HA Pin: light.office', { x: 124, y: 154 });
      expect(layerPositionOf(context)).toEqual({ x: 124, y: 154 });
      context.endDesktopPinResizeSession('light.office');
    });

    it('puts a surface the app placed itself back where it was drawn when the save fails', async () => {
      const { context, place } = loadResizeRuntime({ bounds: start, layer: { monitor } });
      context.layerPositions.set('light.office', { x: 124, y: 154 });
      await drag(context, { corner: 'top-left', width: 200, height: 180 });
      expect(place).toHaveBeenLastCalledWith('HA Pin: light.office', { x: 92, y: 122 });
      context.saveConfigDurably.mockResolvedValueOnce({ success: false, error: 'disk full' });

      const result = await drag(context, { corner: 'top-left', width: 220, height: 200 }, true);

      expect(result).toMatchObject({ success: false, pinBounds: start });
      // No position was saved before the drag, so none is left; the surface is not placed from
      // the saved (180, 200) but goes back to where it was drawn.
      expect(context.config.layerPositions).toEqual({});
      expect(place).toHaveBeenLastCalledWith('HA Pin: light.office', { x: 124, y: 154 });
      expect(context.layerPositions.get('light.office')).toEqual({ x: 124, y: 154 });
    });

    it('does the same when a write after a quiet moment fails', async () => {
      jest.useFakeTimers();
      const { context, place } = loadResizeRuntime({ bounds: start, layer: { monitor } });
      context.layerPositions.set('light.office', { x: 124, y: 154 });
      await drag(context, { corner: 'top-left', width: 200, height: 180 });
      context.saveConfigDurably.mockResolvedValueOnce({ success: false, error: 'disk full' });

      await jest.advanceTimersByTimeAsync(1600);

      expect(context.config.layerPositions).toEqual({});
      expect(place).toHaveBeenLastCalledWith('HA Pin: light.office', { x: 124, y: 154 });
    });

    it('anchors the opposite edge at an enlarged interface size too', async () => {
      // At 150% the window is 252x222 for a saved 168x148, and asking for 200x180 makes it 300x270.
      const { context, pinWindow, place } = loadResizeRuntime({
        bounds: start,
        layer: { monitor },
        scale: 1.5,
      });
      expect(place).toHaveBeenLastCalledWith('HA Pin: light.office', { x: 180, y: 200 });

      await drag(context, { corner: 'top-left', width: 200, height: 180 });

      expect(pinWindow.setSize).toHaveBeenLastCalledWith(300, 270);
      // The window's right and bottom edges (432, 422 on the output) stay, so its corner moves by
      // the 48px it grew, in window pixels.
      expect(place).toHaveBeenLastCalledWith('HA Pin: light.office', { x: 132, y: 152 });
      expect(layerPositionOf(context)).toEqual({ x: 132, y: 152 });
      context.endDesktopPinResizeSession('light.office');
    });

    it.each([
      [
        'it has no position of its own yet',
        { monitor },
        (context) => context.layerPositions.clear(),
      ],
      ['the output is not known', { monitor: null }, () => {}],
    ])('leaves the position to the saved x and y when %s', async (_, layer, prepare) => {
      const { context, pinWindow } = loadResizeRuntime({ bounds: start, layer });
      prepare(context);

      const result = await drag(context, { corner: 'top-left', width: 200, height: 180 });

      // The compositor owns placement here: the size changes, no layer position is written.
      expect(result.pinBounds).toMatchObject({ x: 2100, y: 200, width: 200, height: 180 });
      expect(pinWindow.setSize).toHaveBeenLastCalledWith(200, 180);
      expect(context.config.layerPositions).toEqual({});
      context.endDesktopPinResizeSession('light.office');
    });

    it('restores a position saved before the drag when the final save fails', async () => {
      const saved = { 'light.office': { 'DP-2': { x: 50, y: 60 }, 'DP-1': { x: 5, y: 5 } } };
      const { context, place } = loadResizeRuntime({
        bounds: start,
        layer: { monitor, layerPositions: saved },
      });
      await drag(context, { corner: 'top-left', width: 200, height: 180 });
      context.saveConfigDurably.mockResolvedValueOnce({ success: false, error: 'disk full' });

      await drag(context, { corner: 'top-left', width: 220, height: 200 }, true);

      expect(context.config.layerPositions).toEqual(saved);
      expect(place).toHaveBeenLastCalledWith('HA Pin: light.office', { x: 50, y: 60 });
    });
  });

  describe('on native Wayland without a layer surface', () => {
    it('grows from the origin the compositor keeps and leaves the saved position alone', async () => {
      const { context, pinWindow, place } = loadResizeRuntime({
        bounds: { x: 100, y: 100, width: 168, height: 148 },
        compositorPlacement: true,
      });

      const result = await context.updateDesktopPinBounds('light.office', {
        width: 200,
        height: 180,
        resize: { corner: 'top-left', final: true },
      });

      // The size changes; a window the app cannot move is not given a position it cannot honour.
      expect(result.pinBounds).toEqual({ x: 100, y: 100, width: 200, height: 180 });
      expect(pinWindow.setSize).toHaveBeenLastCalledWith(200, 180);
      expect(pinWindow.setBounds).not.toHaveBeenCalled();
      expect(place).not.toHaveBeenCalled();
      expect(context.config.layerPositions).toEqual({});
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

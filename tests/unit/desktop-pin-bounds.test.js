const {
  getDesktopPinBaseBounds,
  getDesktopPinMinBounds,
  resolveDesktopPinMinBounds,
  clampDesktopPinBounds,
  resizeDesktopPinBounds,
  findFreeDesktopPinOrigin,
  getDesktopPinWindowBounds,
} = require('../../src/desktop-pin-bounds.js');

describe('desktop pin bounds helpers', () => {
  test('returns the expected default base bounds for standard and media tiles', () => {
    expect(getDesktopPinBaseBounds('light.bedroom')).toEqual({ width: 168, height: 148 });
    expect(getDesktopPinBaseBounds('media_player.spotify')).toEqual({ width: 328, height: 156 });
  });

  test('returns per-domain minimum bounds from the Stage 2 size matrix', () => {
    expect(getDesktopPinMinBounds('scene.relax')).toEqual({ width: 97, height: 83 });
    expect(getDesktopPinMinBounds('script.goodnight')).toEqual({ width: 140, height: 110 });
    expect(getDesktopPinMinBounds('sensor.temperature')).toEqual({ width: 140, height: 110 });
    expect(getDesktopPinMinBounds('switch.kettle')).toEqual({ width: 156, height: 122 });
    expect(getDesktopPinMinBounds('light.bedroom')).toEqual({ width: 168, height: 148 });
    expect(getDesktopPinMinBounds('media_player.spotify')).toEqual({ width: 260, height: 148 });
    expect(getDesktopPinMinBounds('vacuum.downstairs')).toEqual({ width: 156, height: 122 });
  });

  test('prefers larger runtime content minimums over the domain defaults', () => {
    expect(resolveDesktopPinMinBounds('scene.relax', { width: 132, height: 118 })).toEqual({
      width: 132,
      height: 118,
    });
    expect(resolveDesktopPinMinBounds('scene.relax', { width: 80, height: 60 })).toEqual({
      width: 97,
      height: 83,
    });
  });

  test('keeps the right edge anchored when a left-handle resize hits the domain minimum width', () => {
    const nextBounds = clampDesktopPinBounds(
      {
        x: 182,
        y: 40,
        width: 118,
        height: 160,
      },
      {
        entityId: 'light.bedroom',
        previousBounds: { x: 100, y: 40, width: 200, height: 160 },
        fallbackOrigin: { x: 24, y: 24 },
        workArea: { x: 0, y: 0, width: 1200, height: 900 },
      }
    );

    expect(nextBounds).toEqual({
      x: 132,
      y: 40,
      width: 168,
      height: 160,
    });
    expect(nextBounds.x + nextBounds.width).toBe(300);
  });

  test('keeps the bottom edge anchored when a top-handle resize hits the domain minimum height', () => {
    const nextBounds = clampDesktopPinBounds(
      {
        x: 120,
        y: 114,
        width: 168,
        height: 86,
      },
      {
        entityId: 'switch.kettle',
        previousBounds: { x: 120, y: 40, width: 168, height: 160 },
        fallbackOrigin: { x: 24, y: 24 },
        workArea: { x: 0, y: 0, width: 1200, height: 900 },
      }
    );

    expect(nextBounds).toEqual({
      x: 120,
      y: 78,
      width: 168,
      height: 122,
    });
    expect(nextBounds.y + nextBounds.height).toBe(200);
  });

  test('clamps wide media tiles to their validated minimum width and height', () => {
    const nextBounds = clampDesktopPinBounds(
      {
        x: 80,
        y: 60,
        width: 220,
        height: 130,
      },
      {
        entityId: 'media_player.spotify',
        fallbackOrigin: { x: 24, y: 24 },
        workArea: { x: 0, y: 0, width: 1200, height: 900 },
      }
    );

    expect(nextBounds).toEqual({
      x: 80,
      y: 60,
      width: 260,
      height: 148,
    });
  });

  test('clamps scene tiles against runtime content minimums when resizing', () => {
    const nextBounds = clampDesktopPinBounds(
      {
        x: 120,
        y: 72,
        width: 118,
        height: 92,
      },
      {
        entityId: 'scene.relax',
        contentMinBounds: { width: 132, height: 118 },
        previousBounds: { x: 120, y: 72, width: 168, height: 148 },
        fallbackOrigin: { x: 24, y: 24 },
        workArea: { x: 0, y: 0, width: 1200, height: 900 },
      }
    );

    expect(nextBounds).toEqual({
      x: 120,
      y: 72,
      width: 132,
      height: 118,
    });
  });

  describe('Text and control size', () => {
    const workArea = { x: 0, y: 0, width: 1280, height: 720 };

    test('scales default and minimum bounds with the interface scale', () => {
      expect(getDesktopPinBaseBounds('light.bedroom', 1.5)).toEqual({ width: 252, height: 222 });
      expect(getDesktopPinBaseBounds('media_player.spotify', 1.3)).toEqual({
        width: 427,
        height: 203,
      });
      expect(getDesktopPinMinBounds('light.bedroom', 1.3)).toEqual({ width: 219, height: 193 });
      expect(getDesktopPinMinBounds('switch.kettle', 1.5)).toEqual({ width: 234, height: 183 });
      // Float noise (120 * 1.15 = 138.00000000000003) must not add a pixel.
      expect(getDesktopPinMinBounds('switch.kettle', 1.15)).toEqual({ width: 180, height: 141 });
      expect(resolveDesktopPinMinBounds('scene.relax', { width: 132, height: 118 }, 1.5)).toEqual({
        width: 198,
        height: 177,
      });
    });

    test('ignores unsupported scale values', () => {
      expect(getDesktopPinMinBounds('light.bedroom', 3)).toEqual({ width: 168, height: 148 });
      expect(getDesktopPinBaseBounds('light.bedroom', 'large')).toEqual({
        width: 168,
        height: 148,
      });
    });

    test('scales saved 100% bounds into window bounds from the saved position', () => {
      const saved = { x: 200, y: 120, width: 168, height: 148 };
      expect(getDesktopPinWindowBounds(saved, { entityId: 'light.bedroom', workArea })).toEqual(
        saved
      );
      expect(
        getDesktopPinWindowBounds(saved, { entityId: 'light.bedroom', workArea, scale: 1.3 })
      ).toEqual({ x: 200, y: 120, width: 219, height: 193 });
      expect(
        getDesktopPinWindowBounds(
          { x: 40, y: 40, width: 200, height: 160 },
          { entityId: 'switch.kettle', workArea, scale: 1.5 }
        )
      ).toEqual({ x: 40, y: 40, width: 300, height: 240 });
      expect(saved).toEqual({ x: 200, y: 120, width: 168, height: 148 });
    });

    test('keeps a scaled pin inside the work area without moving its saved position', () => {
      const saved = { x: 1100, y: 560, width: 168, height: 148 };
      expect(
        getDesktopPinWindowBounds(saved, { entityId: 'light.bedroom', workArea, scale: 1.5 })
      ).toEqual({ x: 1028, y: 498, width: 252, height: 222 });
      expect(saved).toEqual({ x: 1100, y: 560, width: 168, height: 148 });
    });

    test('scales scene content minimums with the window', () => {
      expect(
        getDesktopPinWindowBounds(
          { x: 0, y: 0, width: 97, height: 83 },
          {
            entityId: 'scene.relax',
            contentMinBounds: { width: 132, height: 118 },
            workArea,
            scale: 1.5,
          }
        )
      ).toEqual({ x: 0, y: 0, width: 198, height: 177 });
    });
  });
});

describe('resizing a pin from a corner handle', () => {
  const workArea = { x: 0, y: 0, width: 1920, height: 1080 };
  const start = { x: 1000, y: 300, width: 200, height: 200 };

  test('grows from the bottom-right handle without moving the pin', () => {
    expect(
      resizeDesktopPinBounds(
        start,
        { corner: 'bottom-right', width: 240, height: 230 },
        { entityId: 'light.bedroom', workArea }
      )
    ).toEqual({ x: 1000, y: 300, width: 240, height: 230 });
  });

  test('keeps the right and bottom edges where they are when the top-left handle moves', () => {
    const next = resizeDesktopPinBounds(
      start,
      { corner: 'top-left', width: 230, height: 215 },
      { entityId: 'light.bedroom', workArea }
    );
    expect(next).toEqual({ x: 970, y: 285, width: 230, height: 215 });
    expect(next.x + next.width).toBe(1200);
    expect(next.y + next.height).toBe(500);
  });

  test('keeps the opposite edge fixed on screen when the interface is scaled', () => {
    // At 150% the window is 300x300 on screen: right edge 1300, bottom edge 600.
    const next = resizeDesktopPinBounds(
      start,
      { corner: 'top-left', width: 180, height: 180 },
      { entityId: 'light.bedroom', workArea, scale: 1.5 }
    );
    expect(next).toEqual({ x: 1030, y: 330, width: 180, height: 180 });
    expect(next.x + Math.ceil(next.width * 1.5)).toBe(1300);
    expect(next.y + Math.ceil(next.height * 1.5)).toBe(600);
  });

  test('stops at the minimum size with the opposite edge still in place', () => {
    const next = resizeDesktopPinBounds(
      start,
      { corner: 'top-left', width: 20, height: 20 },
      { entityId: 'light.bedroom', workArea }
    );
    expect(next).toEqual({ x: 1032, y: 352, width: 168, height: 148 });
  });

  test('stops the dragged edge at the work area instead of sliding the pin back', () => {
    const next = resizeDesktopPinBounds(
      { x: 1700, y: 300, width: 180, height: 200 },
      { corner: 'bottom-right', width: 400, height: 200 },
      { entityId: 'sensor.temperature', workArea }
    );
    // 220px of room to the right edge: the left edge stays at 1700.
    expect(next).toMatchObject({ x: 1700, width: 220 });
  });

  describe('when the interface scale has nudged the pin back inside the work area', () => {
    // A scene saved at x=1752 is 252px wide at 150% and shown at x=1668 (1920 - 252).
    const saved = { x: 1752, y: 300, width: 168, height: 148 };
    const options = { entityId: 'scene.relax', workArea, scale: 1.5 };
    const windowOf = (bounds) => getDesktopPinWindowBounds(bounds, options);

    test('shrinks from the right handle without jumping back to the saved origin', () => {
      const next = resizeDesktopPinBounds(
        saved,
        { corner: 'bottom-right', width: 100, height: 148 },
        options
      );
      // 100 * 1.5 = 150px fits at x=1752 now, but the window was drawn at 1668 and stays there.
      expect(next).toEqual({ x: 1668, y: 300, width: 100, height: 148 });
      expect(windowOf(next)).toMatchObject({ x: 1668, width: 150 });
    });

    test('keeps the window where it is drawn when the requested size has not changed', () => {
      const next = resizeDesktopPinBounds(
        saved,
        { corner: 'bottom-right', width: 168, height: 148 },
        options
      );
      expect(next).toEqual({ x: 1668, y: 300, width: 168, height: 148 });
      expect(windowOf(next)).toEqual(windowOf(saved));
    });

    test('allows growing back out to the work area edge it was nudged against', () => {
      const shrunk = resizeDesktopPinBounds(
        saved,
        { corner: 'bottom-right', width: 100, height: 148 },
        options
      );
      const regrown = resizeDesktopPinBounds(
        shrunk,
        { corner: 'bottom-right', width: 400, height: 148 },
        options
      );
      // 252px of room from the drawn origin at 1668.
      expect(regrown).toEqual({ x: 1668, y: 300, width: 168, height: 148 });
    });

    test('measures the opposite edge from the drawn window for the left handles too', () => {
      const next = resizeDesktopPinBounds(
        saved,
        { corner: 'top-left', width: 100, height: 100 },
        options
      );
      // The drawn window ends at 1920, so that stays put rather than the saved 1752 + 252.
      expect(windowOf(next).x + windowOf(next).width).toBe(1920);
      expect(next).toMatchObject({ x: 1770, width: 100, height: 100 });
    });

    test('does the same for the bottom edge', () => {
      const lowSaved = { x: 200, y: 1000, width: 168, height: 148 };
      const next = resizeDesktopPinBounds(
        lowSaved,
        { corner: 'bottom-right', width: 168, height: 90 },
        options
      );
      // 148 * 1.5 = 222px, drawn at y=858 (1080 - 222); 90 * 1.5 = 135px keeps that top edge.
      expect(next).toEqual({ x: 200, y: 858, width: 168, height: 90 });
    });
  });

  test('lets a pin that starts on a second monitor grow across its own work area', () => {
    const second = { x: 1920, y: 0, width: 1920, height: 1080 };
    const next = resizeDesktopPinBounds(
      { x: 3400, y: 100, width: 200, height: 200 },
      { corner: 'bottom-right', width: 600, height: 300 },
      { entityId: 'light.bedroom', workArea: second }
    );
    expect(next).toEqual({ x: 3400, y: 100, width: 440, height: 300 });
  });
});

describe('opening a new pin in a free spot', () => {
  const workArea = { x: 0, y: 0, width: 1000, height: 600 };
  const size = { width: 168, height: 148 };

  test('starts at the top-right corner of an empty screen', () => {
    expect(findFreeDesktopPinOrigin({ size, workArea })).toEqual({ x: 808, y: 24 });
  });

  test('walks left along the row past the pins already there', () => {
    const occupied = [{ x: 808, y: 24, width: 168, height: 148 }];
    expect(findFreeDesktopPinOrigin({ size, workArea, occupied })).toEqual({ x: 624, y: 24 });
  });

  test('moves to the next row when a row is full, and reuses a freed spot', () => {
    const row = [808, 624, 440, 256, 72].map((x) => ({ x, y: 24, width: 168, height: 148 }));
    expect(findFreeDesktopPinOrigin({ size, workArea, occupied: row })).toEqual({ x: 808, y: 188 });
    // Unpin the second one and the next pin takes its place.
    const withHole = row.filter((rect) => rect.x !== 624);
    expect(findFreeDesktopPinOrigin({ size, workArea, occupied: withHole })).toEqual({
      x: 624,
      y: 24,
    });
  });

  test('keeps clear of a pin that was dragged off the grid, and of the widget', () => {
    const occupied = [
      { x: 700, y: 60, width: 168, height: 148 },
      { x: 24, y: 24, width: 500, height: 560 },
    ];
    const origin = findFreeDesktopPinOrigin({ size, workArea, occupied });
    expect(origin).not.toBeNull();
    for (const rect of occupied) {
      const clear =
        origin.x + size.width <= rect.x ||
        origin.x >= rect.x + rect.width ||
        origin.y + size.height <= rect.y ||
        origin.y >= rect.y + rect.height;
      expect(clear).toBe(true);
    }
  });

  test('gives up on a full screen so the caller can cascade', () => {
    const full = [{ x: 0, y: 0, width: 1000, height: 600 }];
    expect(findFreeDesktopPinOrigin({ size, workArea, occupied: full })).toBeNull();
    expect(findFreeDesktopPinOrigin({ size, workArea: null })).toBeNull();
  });
});

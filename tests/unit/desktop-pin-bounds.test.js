const {
  getDesktopPinBaseBounds,
  getDesktopPinMinBounds,
  resolveDesktopPinMinBounds,
  clampDesktopPinBounds,
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

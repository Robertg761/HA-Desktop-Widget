/**
 * @jest-environment node
 */

const {
  boundsOverlapWorkArea,
  boundsVisibleOnAnyWorkArea,
  clampPositionToWorkAreas,
} = require('../../src/window-placement.cjs');

// The layout that exposed this: three displays with empty space above the left one and to
// the left of the middle one, so 0,0 and 100,100 are not on any display.
const DISPLAYS = [
  { x: 0, y: 1080, width: 2560, height: 1440 },
  { x: 1544, y: 0, width: 1920, height: 1080 },
  { x: 2560, y: 1080, width: 2560, height: 1080 },
];
const WINDOW_SIZE = { width: 500, height: 600 };

describe('window placement', () => {
  test('accepts a position that sits on a display', () => {
    expect(boundsOverlapWorkArea({ x: 300, y: 1200, ...WINDOW_SIZE }, DISPLAYS[0])).toBe(true);
    expect(boundsVisibleOnAnyWorkArea({ x: 2700, y: 1200, ...WINDOW_SIZE }, DISPLAYS)).toBe(true);
  });

  test('treats a barely-overlapping position as off-screen', () => {
    // Only 8px of the window would be grabbable on the left display.
    expect(boundsOverlapWorkArea({ x: -492, y: 1200, ...WINDOW_SIZE }, DISPLAYS[0])).toBe(false);
    // Hanging off an edge but still usable.
    expect(boundsOverlapWorkArea({ x: -200, y: 1200, ...WINDOW_SIZE }, DISPLAYS[0])).toBe(true);
  });

  test('leaves a deliberately placed position untouched', () => {
    expect(clampPositionToWorkAreas({ x: 300, y: 1200, ...WINDOW_SIZE }, DISPLAYS)).toEqual({
      x: 300,
      y: 1200,
    });
    expect(clampPositionToWorkAreas({ x: -120, y: 1200, ...WINDOW_SIZE }, DISPLAYS)).toEqual({
      x: -120,
      y: 1200,
    });
  });

  test('recovers a position in the gap between displays onto the nearest one', () => {
    const placement = clampPositionToWorkAreas({ x: 0, y: 0, ...WINDOW_SIZE }, DISPLAYS);
    expect(boundsVisibleOnAnyWorkArea({ ...placement, ...WINDOW_SIZE }, DISPLAYS)).toBe(true);
    // Nearest display centre to 0,0 is the left one, so the widget lands in its corner.
    expect(placement).toEqual({ x: 0, y: 1080 });
  });

  test('recovers a position on a monitor that is no longer connected', () => {
    const placement = clampPositionToWorkAreas({ x: 6000, y: 2400, ...WINDOW_SIZE }, DISPLAYS);
    expect(placement).toEqual({ x: 4620, y: 1560 });
    expect(boundsVisibleOnAnyWorkArea({ ...placement, ...WINDOW_SIZE }, DISPLAYS)).toBe(true);
  });

  test('handles a window larger than the display it lands on', () => {
    const placement = clampPositionToWorkAreas({ x: 9000, y: 9000, width: 4000, height: 3000 }, [
      { x: 0, y: 0, width: 1280, height: 720 },
    ]);
    expect(placement).toEqual({ x: 0, y: 0 });
  });

  test('falls back safely with unusable input', () => {
    expect(clampPositionToWorkAreas({ x: 10, y: 20, ...WINDOW_SIZE }, [])).toEqual({
      x: 10,
      y: 20,
    });
    expect(clampPositionToWorkAreas({}, DISPLAYS)).toEqual({ x: 0, y: 1080 });
    expect(
      clampPositionToWorkAreas({ x: 'nope', y: null, ...WINDOW_SIZE }, [
        { x: 0, y: 0, width: 0, height: 0 },
      ])
    ).toEqual({ x: 0, y: 0 });
  });
});

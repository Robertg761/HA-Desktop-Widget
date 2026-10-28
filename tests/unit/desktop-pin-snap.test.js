/**
 * @jest-environment node
 */

const { snapDesktopPinPosition } = require('../../src/desktop-pin-snap.cjs');

const workArea = { x: 0, y: 0, width: 1920, height: 1040 };
const pin = (x, y, width = 168, height = 148) => ({ x, y, width, height });

describe('desktop pin snapping', () => {
  test('lines a pin up under another one dropped a few pixels off', () => {
    // The issue's left column: each pin dropped a little left or right of the one above.
    expect(snapDesktopPinPosition(pin(407, 500), { others: [pin(400, 200)], workArea })).toEqual({
      x: 400,
      y: 500,
    });
    expect(snapDesktopPinPosition(pin(391, 500), { others: [pin(400, 200)], workArea })).toEqual({
      x: 400,
      y: 500,
    });
  });

  test('lines up end edges and middles of pins of different sizes', () => {
    const wide = pin(400, 200, 328, 156);
    // Right edges: 400 + 328 = 728, so a 168-wide pin ends there at x 560.
    expect(snapDesktopPinPosition(pin(565, 500), { others: [wide], workArea })).toEqual({
      x: 560,
      y: 500,
    });
    // Middles: 400 + (328 - 168) / 2 = 480.
    expect(snapDesktopPinPosition(pin(476, 500), { others: [wide], workArea })).toEqual({
      x: 480,
      y: 500,
    });
  });

  test('puts a pin beside one it is level with, touching or a gap apart', () => {
    const other = pin(400, 200);
    // Its right edge is at 568.
    expect(snapDesktopPinPosition(pin(572, 210), { others: [other], workArea })).toEqual({
      x: 568,
      y: 200,
    });
    expect(snapDesktopPinPosition(pin(580, 210), { others: [other], workArea })).toEqual({
      x: 584,
      y: 200,
    });
    // Above it: its top is at 200, so a 148-tall pin ends there at 52, or 36 with the gap.
    expect(snapDesktopPinPosition(pin(400, 40), { others: [other], workArea })).toEqual({
      x: 400,
      y: 36,
    });
  });

  test('does not put a pin beside one far away on the other axis', () => {
    // Level with nothing: x 572 is only near the far pin's right edge, which is a side-by-side
    // target, not an edge to line up with.
    expect(snapDesktopPinPosition(pin(572, 800), { others: [pin(400, 200)], workArea })).toEqual({
      x: 572,
      y: 800,
    });
  });

  test('snaps to the work area edges', () => {
    expect(snapDesktopPinPosition(pin(4, 1040 - 148 - 20), { workArea })).toEqual({
      x: 0,
      y: 1040 - 148 - 16,
    });
  });

  test('leaves a pin dropped away from every target where it was dropped', () => {
    expect(snapDesktopPinPosition(pin(700, 450), { others: [pin(400, 200)], workArea })).toEqual({
      x: 700,
      y: 450,
    });
  });

  test('takes the nearest target when several are in reach', () => {
    const others = [pin(400, 200), pin(405, 600)];
    expect(snapDesktopPinPosition(pin(404, 400), { others, workArea }).x).toBe(405);
    expect(snapDesktopPinPosition(pin(402, 400), { others, workArea }).x).toBe(400);
  });

  test('ignores pins on another monitor and malformed rectangles', () => {
    // The monitor below: its pin's left edge would otherwise be in reach.
    const others = [pin(700, 1045), { x: 'a', y: 0, width: 10, height: 10 }, null];
    expect(snapDesktopPinPosition(pin(705, 300), { others, workArea })).toEqual({
      x: 705,
      y: 300,
    });
  });

  test('returns the position unchanged for a rectangle it cannot read', () => {
    expect(snapDesktopPinPosition({ x: 5, y: 6 }, { workArea })).toEqual({ x: 5, y: 6 });
  });
});

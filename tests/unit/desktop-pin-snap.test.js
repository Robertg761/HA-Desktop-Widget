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

  test('leaves a pin dropped near another the distance from it it was dropped at', () => {
    const other = pin(400, 200);
    // 8 px under it (its bottom is at 348) and 4 px right of it (its right edge is at 568): there
    // is no fixed space to settle at beside a pin.
    expect(snapDesktopPinPosition(pin(400, 356), { others: [other], workArea })).toEqual({
      x: 400,
      y: 356,
    });
    expect(snapDesktopPinPosition(pin(572, 600), { others: [other], workArea })).toEqual({
      x: 572,
      y: 600,
    });
  });

  test('puts a pin dropped a little over another up against it', () => {
    const other = pin(400, 200);
    // 5 px into its bottom (348): touching. 4 px into its left side (400): touching.
    expect(snapDesktopPinPosition(pin(400, 343), { others: [other], workArea }).y).toBe(348);
    expect(snapDesktopPinPosition(pin(236, 260), { others: [other], workArea }).x).toBe(232);
  });

  test('spaces a column evenly at the spacing already used in it', () => {
    // Two pins 8 px apart; the third, dropped 13 px under the second, settles 8 px under it.
    const others = [pin(400, 200), pin(400, 356)];
    expect(snapDesktopPinPosition(pin(404, 517), { others, workArea })).toEqual({
      x: 400,
      y: 512,
    });
  });

  test('does not take a space between pins in two different columns as spacing', () => {
    // Column A ends at 120 and goes on at 200; column B goes on at 180. A wide pin over both columns
    // has all of them in its line, but 120 to 180 is no column's spacing: only 80 and 10 are.
    const others = [pin(0, 0, 168, 120), pin(0, 200), pin(200, 0, 168, 170), pin(200, 180)];
    const wide = (y) => pin(0, y, 368, 100);
    // 60 under the second pin of column B would be 388; dropped at 384, it stays.
    expect(snapDesktopPinPosition(wide(384), { others, workArea }).y).toBe(384);
    // Column B's own 10 px spacing is still offered: 328 + 10 = 338.
    expect(snapDesktopPinPosition(wide(342), { others, workArea }).y).toBe(338);
  });

  test('keeps a column evenly spaced when an edge of the column beside it is nearly as close', () => {
    // The issue's layout: small pins 10 px apart on the left, a tall pin on the right whose bottom
    // edge lines a 120-tall pin up at 270. Dropped at 262, the column's spacing (260) is nearer.
    const small = (y) => pin(6, y, 145, 120);
    const others = [small(0), small(130), pin(160, 0, 168, 390)];
    expect(snapDesktopPinPosition(small(262), { others, workArea }).y).toBe(260);
    // Dropped at 268, the edge is nearer, and wins.
    expect(snapDesktopPinPosition(small(268), { others, workArea }).y).toBe(270);
  });

  test('takes spacing only from its own column, not the one beside it', () => {
    // The column to the right is spaced 30 px apart; the pin dropped 25 px under the left pin stays.
    const others = [pin(400, 200), pin(600, 600), pin(600, 778)];
    expect(snapDesktopPinPosition(pin(400, 373), { others, workArea })).toEqual({
      x: 400,
      y: 373,
    });
  });

  test('lines a column up instead of settling beside the column next to it', () => {
    // The issue's layout: a column of smaller pins at x 6, a column of bigger ones 9 px to the
    // right of it. The pin dropped at x 12 is 3 px from touching the right column and 6 px from its
    // own column's edge; it goes to its column.
    const small = (y) => pin(6, y, 145, 120);
    const others = [small(0), small(130), pin(160, 0, 168, 320), pin(160, 330, 168, 320)];
    expect(snapDesktopPinPosition(small(262), { others, workArea }).x).toBe(6);
    // A column edge also wins over the work area's edge, even a nearer one.
    expect(snapDesktopPinPosition(small(400), { others, workArea: null }).x).toBe(6);
    expect(snapDesktopPinPosition(pin(2, 500, 145, 120), { others, workArea }).x).toBe(6);
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

/**
 * @jest-environment node
 */

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { normalizeDesktopPinScale } = require('../../src/desktop-pin-bounds.js');

const mainSource = fs.readFileSync(path.resolve(__dirname, '../../main.js'), 'utf8');

function loadShape({ scale = 1 } = {}) {
  const context = {
    DESKTOP_PIN_WINDOW_CORNER_RADIUS: 24,
    normalizeDesktopPinScale,
    config: { ui: { scale } },
    log: { warn: jest.fn() },
  };
  const start = mainSource.indexOf('function buildRoundedRectShape');
  const end = mainSource.indexOf('let latestHaConnectionState', start);
  expect(start).toBeGreaterThan(-1);
  expect(end).toBeGreaterThan(start);
  vm.runInNewContext(mainSource.slice(start, end), context);
  return context;
}

function pinWindow({ transparent }) {
  return {
    __desktopPinTransparent: transparent,
    isDestroyed: () => false,
    setShape: jest.fn(),
    getBounds: () => ({ x: 0, y: 0, width: 168, height: 148 }),
  };
}

describe('the rounded region of a desktop pin window', () => {
  it('is left off a transparent window, where the page already rounds the corners smoothly', () => {
    const context = loadShape();
    const window = pinWindow({ transparent: true });
    context.applyDesktopPinWindowShape(window, { width: 168, height: 148 });
    expect(window.setShape).not.toHaveBeenCalled();
  });

  it('still rounds an opaque window, which has nothing else to do it', () => {
    const context = loadShape();
    const window = pinWindow({ transparent: false });
    context.applyDesktopPinWindowShape(window, { width: 168, height: 148 });

    const [rows] = window.setShape.mock.calls[0];
    expect(rows).toHaveLength(148);
    // The top row is cut in by the corner; the middle rows are the full width.
    expect(rows[0].x).toBeGreaterThan(0);
    expect(rows[74]).toEqual({ x: 0, y: 74, width: 168, height: 1 });
  });

  it('scales the corner with Text and control size, as the page does', () => {
    const insetAt = (scale) => {
      const context = loadShape({ scale });
      const window = pinWindow({ transparent: false });
      context.applyDesktopPinWindowShape(window, { width: 252, height: 222 });
      return window.setShape.mock.calls[0][0][0].x;
    };

    expect(insetAt(1.5)).toBeGreaterThan(insetAt(1));
  });
});

/**
 * @jest-environment node
 */

const {
  getDesktopPinResizeKeyDelta,
  getDesktopPinResizeRequest,
  getPointerScreenFactor,
} = require('../../src/desktop-pin-resize.cjs');

describe('desktop pin resize requests', () => {
  const start = { width: 168, height: 148 };

  it('follows the pointer one to one at 100%', () => {
    expect(getDesktopPinResizeRequest(start, 'bottom-right', { x: 40, y: 20 })).toEqual({
      width: 208,
      height: 168,
    });
    expect(getDesktopPinResizeRequest(start, 'top-left', { x: 40, y: 20 })).toEqual({
      width: 128,
      height: 128,
    });
  });

  it('turns screen pixels into saved size at an enlarged interface', () => {
    // A 150% window gains 60 screen pixels from a 60px drag: 40 at the saved 100% size.
    expect(
      getDesktopPinResizeRequest(start, 'bottom-right', { x: 60, y: 30 }, { scale: 1.5 })
    ).toEqual({ width: 208, height: 168 });
    expect(
      getDesktopPinResizeRequest(start, 'top-right', { x: -30, y: -60 }, { scale: 1.5 })
    ).toEqual({ width: 148, height: 188 });
  });

  it('knows how many screen pixels a unit of pointer distance is', () => {
    // The page reports the window as wide as it is on screen: pointer distance is screen pixels.
    expect(getPointerScreenFactor({ scale: 1.5, windowWidth: 252, outerWidth: 252 })).toBe(1);
    // The page reports it divided by the zoom: one unit is `scale` screen pixels.
    expect(getPointerScreenFactor({ scale: 1.5, windowWidth: 252, outerWidth: 168 })).toBe(1.5);
    expect(getPointerScreenFactor({ scale: 1, windowWidth: 168, outerWidth: 100 })).toBe(1);
    expect(getPointerScreenFactor({ scale: 1.5, windowWidth: 252, outerWidth: 0 })).toBe(1);
    expect(getPointerScreenFactor({ scale: 1.5, windowWidth: 252, outerWidth: 40 })).toBe(1.5);
  });

  it('moves a handle a step per arrow key, a larger one with Shift', () => {
    expect(getDesktopPinResizeKeyDelta('ArrowRight')).toEqual({ x: 8, y: 0 });
    expect(getDesktopPinResizeKeyDelta('ArrowUp', { shiftKey: true })).toEqual({ x: 0, y: -32 });
    expect(getDesktopPinResizeKeyDelta('Enter')).toBeNull();
  });
});

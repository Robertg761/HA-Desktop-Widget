const {
  getNextQuickAccessFocusIndex,
  getQuickAccessTabOverflow,
  getQuickAccessTabRevealDelta,
  getQuickAccessTabWheelDelta,
} = require('../../src/quick-access-ui-helpers.js');

describe('quick access UI helpers', () => {
  describe('getNextQuickAccessFocusIndex', () => {
    it('follows visual horizontal order in RTL while preserving vertical and endpoint navigation', () => {
      expect(getNextQuickAccessFocusIndex(0, 5, 'ArrowLeft', 3, 'rtl')).toBe(1);
      expect(getNextQuickAccessFocusIndex(1, 5, 'ArrowRight', 3, 'rtl')).toBe(0);
      expect(getNextQuickAccessFocusIndex(0, 5, 'ArrowRight', 3, 'rtl')).toBe(0);
      expect(getNextQuickAccessFocusIndex(4, 5, 'ArrowLeft', 3, 'rtl')).toBe(4);
      expect(getNextQuickAccessFocusIndex(1, 5, 'ArrowDown', 3, 'rtl')).toBe(4);
      expect(getNextQuickAccessFocusIndex(4, 5, 'Home', 3, 'rtl')).toBe(0);
      expect(getNextQuickAccessFocusIndex(1, 5, 'End', 3, 'rtl')).toBe(4);
    });
    it('moves horizontally and clamps at edges', () => {
      expect(getNextQuickAccessFocusIndex(0, 4, 'ArrowLeft', 2)).toBe(0);
      expect(getNextQuickAccessFocusIndex(0, 4, 'ArrowRight', 2)).toBe(1);
      expect(getNextQuickAccessFocusIndex(3, 4, 'ArrowRight', 2)).toBe(3);
    });

    it('moves vertically by grid column count', () => {
      expect(getNextQuickAccessFocusIndex(1, 6, 'ArrowDown', 3)).toBe(4);
      expect(getNextQuickAccessFocusIndex(4, 6, 'ArrowUp', 3)).toBe(1);
      expect(getNextQuickAccessFocusIndex(4, 6, 'ArrowDown', 3)).toBe(5);
    });

    it('supports Home and End', () => {
      expect(getNextQuickAccessFocusIndex(2, 5, 'Home', 3)).toBe(0);
      expect(getNextQuickAccessFocusIndex(2, 5, 'End', 3)).toBe(4);
    });
  });

  describe('getQuickAccessTabRevealDelta', () => {
    const view = { viewWidth: 300, inset: 20 };

    it('leaves a tab that is fully inside the margins where it is', () => {
      expect(getQuickAccessTabRevealDelta({ itemLeft: 20, itemRight: 120, ...view })).toBe(0);
      expect(getQuickAccessTabRevealDelta({ itemLeft: 150, itemRight: 280, ...view })).toBe(0);
    });

    it('scrolls right to bring in a tab past the right edge, keeping the margin', () => {
      expect(getQuickAccessTabRevealDelta({ itemLeft: 400, itemRight: 500, ...view })).toBe(220);
      expect(getQuickAccessTabRevealDelta({ itemLeft: 200, itemRight: 290, ...view })).toBe(10);
    });

    it('scrolls left to bring in a tab past the left edge, keeping the margin', () => {
      expect(getQuickAccessTabRevealDelta({ itemLeft: -200, itemRight: -100, ...view })).toBe(-220);
      expect(getQuickAccessTabRevealDelta({ itemLeft: 5, itemRight: 90, ...view })).toBe(-15);
    });

    it('centres a tab that fits the strip but not the margins', () => {
      // 270 wide in a 300 strip: no room for two 20px margins, so it sits in the middle.
      expect(getQuickAccessTabRevealDelta({ itemLeft: 400, itemRight: 670, ...view })).toBe(385);
    });

    it('shows the leading edge of a tab wider than the strip, whichever way text runs', () => {
      expect(getQuickAccessTabRevealDelta({ itemLeft: 400, itemRight: 800, ...view })).toBe(380);
      expect(
        getQuickAccessTabRevealDelta({ itemLeft: 400, itemRight: 800, ...view, direction: 'rtl' })
      ).toBe(520);
    });
  });

  describe('getQuickAccessTabOverflow', () => {
    it('reports nothing when the pages fit', () => {
      expect(
        getQuickAccessTabOverflow({ scrollLeft: 0, scrollWidth: 300, clientWidth: 300 })
      ).toEqual({
        left: false,
        right: false,
      });
      // Sub-pixel rounding is not overflow.
      expect(
        getQuickAccessTabOverflow({ scrollLeft: 0, scrollWidth: 300.6, clientWidth: 300 })
      ).toEqual({
        left: false,
        right: false,
      });
    });

    it('reports the edges that have pages beyond them', () => {
      const metrics = { scrollWidth: 900, clientWidth: 300 };
      expect(getQuickAccessTabOverflow({ ...metrics, scrollLeft: 0 })).toEqual({
        left: false,
        right: true,
      });
      expect(getQuickAccessTabOverflow({ ...metrics, scrollLeft: 250 })).toEqual({
        left: true,
        right: true,
      });
      expect(getQuickAccessTabOverflow({ ...metrics, scrollLeft: 600 })).toEqual({
        left: true,
        right: false,
      });
    });

    it('reads right-to-left scrolling, which counts down from 0 at the right edge', () => {
      const metrics = { scrollWidth: 900, clientWidth: 300, direction: 'rtl' };
      expect(getQuickAccessTabOverflow({ ...metrics, scrollLeft: 0 })).toEqual({
        left: true,
        right: false,
      });
      expect(getQuickAccessTabOverflow({ ...metrics, scrollLeft: -250 })).toEqual({
        left: true,
        right: true,
      });
      expect(getQuickAccessTabOverflow({ ...metrics, scrollLeft: -600 })).toEqual({
        left: false,
        right: true,
      });
    });
  });

  describe('getQuickAccessTabWheelDelta', () => {
    it('turns a plain wheel into sideways scrolling toward the end', () => {
      expect(getQuickAccessTabWheelDelta({ deltaX: 0, deltaY: 100, deltaMode: 0 }, 300)).toBe(100);
      expect(getQuickAccessTabWheelDelta({ deltaX: 0, deltaY: -100, deltaMode: 0 }, 300)).toBe(
        -100
      );
      expect(
        getQuickAccessTabWheelDelta({ deltaX: 0, deltaY: 100, deltaMode: 0 }, 300, 'rtl')
      ).toBe(-100);
    });

    it('leaves sideways scrolling to the browser', () => {
      expect(getQuickAccessTabWheelDelta({ deltaX: 80, deltaY: 10, deltaMode: 0 }, 300)).toBe(0);
      expect(getQuickAccessTabWheelDelta({ deltaX: 40, deltaY: 0, deltaMode: 0 }, 300)).toBe(0);
    });

    it('measures a wheel that counts lines or pages', () => {
      expect(getQuickAccessTabWheelDelta({ deltaX: 0, deltaY: 3, deltaMode: 1 }, 300)).toBe(48);
      expect(getQuickAccessTabWheelDelta({ deltaX: 0, deltaY: 1, deltaMode: 2 }, 300)).toBe(300);
    });
  });
});

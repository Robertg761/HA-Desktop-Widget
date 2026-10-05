const {
  SENSOR_VALUE_MIN_FONT_PX,
  getFittedSensorValueFontSize,
  getNextQuickAccessFocusIndex,
  getNextQuickAccessFocusIndexByLayout,
  getQuickAccessTabOverflow,
  getQuickAccessTabRevealDelta,
  getQuickAccessTabWheelDelta,
  watchSensorValueFitInputs,
} = require('../../src/quick-access-ui-helpers.js');

// A tile's box, as getBoundingClientRect reports it.
const box = (left, top, columns = 1, width = 100, height = 80) => ({
  left,
  top,
  right: left + width * columns + (columns - 1) * 8,
  bottom: top + height,
});

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

  describe('getNextQuickAccessFocusIndexByLayout', () => {
    // Three columns: a media tile spanning two, a lamp, a graph spanning all three, then two lamps.
    //   [ media     ][ lamp ]
    //   [ graph               ]
    //   [ lamp ][ lamp ]
    const rects = [box(0, 0, 2), box(216, 0), box(0, 88, 3), box(0, 176), box(108, 176)];

    it('goes right and left along the row on screen', () => {
      expect(getNextQuickAccessFocusIndexByLayout(rects, 0, 'ArrowRight')).toBe(1);
      expect(getNextQuickAccessFocusIndexByLayout(rects, 1, 'ArrowLeft')).toBe(0);
      expect(getNextQuickAccessFocusIndexByLayout(rects, 3, 'ArrowRight')).toBe(4);
    });

    it('stays put at the ends of a row instead of jumping to the next one', () => {
      expect(getNextQuickAccessFocusIndexByLayout(rects, 1, 'ArrowRight')).toBe(1);
      expect(getNextQuickAccessFocusIndexByLayout(rects, 0, 'ArrowLeft')).toBe(0);
      expect(getNextQuickAccessFocusIndexByLayout(rects, 2, 'ArrowRight')).toBe(2);
    });

    it('goes down and up to the tile with the most overlap in the adjacent row', () => {
      // From the media tile (columns 1-2) down to the graph, and from the lamp beside it too.
      expect(getNextQuickAccessFocusIndexByLayout(rects, 0, 'ArrowDown')).toBe(2);
      expect(getNextQuickAccessFocusIndexByLayout(rects, 1, 'ArrowDown')).toBe(2);
      // The full-width graph overlaps both lamps below it equally, so the one nearer its middle
      // wins; going up it meets the media tile, which it overlaps more than the lamp.
      expect(getNextQuickAccessFocusIndexByLayout(rects, 2, 'ArrowDown')).toBe(4);
      expect(getNextQuickAccessFocusIndexByLayout(rects, 4, 'ArrowUp')).toBe(2);
      expect(getNextQuickAccessFocusIndexByLayout(rects, 2, 'ArrowUp')).toBe(0);
    });

    it('stays put at the top and bottom rows', () => {
      expect(getNextQuickAccessFocusIndexByLayout(rects, 0, 'ArrowUp')).toBe(0);
      expect(getNextQuickAccessFocusIndexByLayout(rects, 3, 'ArrowDown')).toBe(3);
    });

    it('goes to the nearest tile when the row below has none underneath', () => {
      const gap = [box(0, 0), box(108, 0), box(216, 0), box(216, 88)];
      expect(getNextQuickAccessFocusIndexByLayout(gap, 0, 'ArrowDown')).toBe(3);
    });

    it('is not mirrored in right-to-left layouts, where the boxes already are', () => {
      // The first tile sits at the right edge; left on screen is the next one in the DOM.
      const mirrored = [box(216, 0), box(108, 0), box(0, 0)];
      expect(getNextQuickAccessFocusIndexByLayout(mirrored, 0, 'ArrowLeft')).toBe(1);
      expect(getNextQuickAccessFocusIndexByLayout(mirrored, 1, 'ArrowRight')).toBe(0);
    });

    it('passes over a tile that has no box', () => {
      // A hidden tile reports a zero box at the page's corner, which is above every real row.
      const none = { left: 0, right: 0, top: 0, bottom: 0 };
      const withHidden = [box(0, 88), none, box(108, 88), box(0, 176)];
      expect(getNextQuickAccessFocusIndexByLayout(withHidden, 0, 'ArrowUp')).toBe(0);
      expect(getNextQuickAccessFocusIndexByLayout(withHidden, 2, 'ArrowUp')).toBe(2);
      expect(getNextQuickAccessFocusIndexByLayout(withHidden, 3, 'ArrowUp')).toBe(0);
      expect(getNextQuickAccessFocusIndexByLayout(withHidden, 0, 'ArrowRight')).toBe(2);
    });

    it('supports Home and End', () => {
      expect(getNextQuickAccessFocusIndexByLayout(rects, 3, 'Home')).toBe(0);
      expect(getNextQuickAccessFocusIndexByLayout(rects, 0, 'End')).toBe(4);
    });

    it('declines when nothing has a layout, so the caller can count in DOM order', () => {
      const empty = { left: 0, right: 0, top: 0, bottom: 0 };
      expect(getNextQuickAccessFocusIndexByLayout([empty, empty], 0, 'ArrowRight')).toBe(-1);
      expect(getNextQuickAccessFocusIndexByLayout([], 0, 'ArrowRight')).toBe(-1);
      expect(getNextQuickAccessFocusIndexByLayout(rects, 9, 'ArrowRight')).toBe(-1);
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
  describe('getFittedSensorValueFontSize', () => {
    it('leaves a reading that fits alone', () => {
      expect(
        getFittedSensorValueFontSize({ fontSize: 18, naturalWidth: 70, availableWidth: 90 })
      ).toBeNull();
      expect(
        getFittedSensorValueFontSize({ fontSize: 18, naturalWidth: 91, availableWidth: 90 })
      ).toBeNull();
    });

    it('shrinks a reading in proportion to what is missing, in half pixels', () => {
      // 180px of text at 18px in 120px: two thirds, 12px.
      expect(
        getFittedSensorValueFontSize({ fontSize: 18, naturalWidth: 180, availableWidth: 120 })
      ).toBe(12);
      // 130 in 100 at 24px is 18.46px; the half pixel below keeps it inside.
      expect(
        getFittedSensorValueFontSize({ fontSize: 24, naturalWidth: 130, availableWidth: 100 })
      ).toBe(18);
    });

    it('never shrinks a reading past the floor, and the ellipsis takes over there', () => {
      expect(
        getFittedSensorValueFontSize({ fontSize: 18, naturalWidth: 600, availableWidth: 60 })
      ).toBe(SENSOR_VALUE_MIN_FONT_PX);
    });

    it('never makes a reading bigger, even when the floor is above its size', () => {
      expect(
        getFittedSensorValueFontSize({ fontSize: 8, naturalWidth: 100, availableWidth: 50 })
      ).toBe(8);
    });

    it('gives up on a tile it cannot measure', () => {
      for (const metrics of [
        { fontSize: 0, naturalWidth: 100, availableWidth: 50 },
        { fontSize: 18, naturalWidth: 0, availableWidth: 50 },
        { fontSize: 18, naturalWidth: 100, availableWidth: 0 },
        { fontSize: NaN, naturalWidth: 100, availableWidth: 50 },
      ]) {
        expect(getFittedSensorValueFontSize(metrics)).toBeNull();
      }
    });
  });
  // A fit is measured in the font a reading is drawn in and at the density it is drawn at. Neither
  // changing moves the tile's width, so the resize observer never refit: a value fitted in the
  // fallback face before Plus Jakarta Sans arrived was left cut at full size ('123,456… W').
  describe('watchSensorValueFitInputs', () => {
    let frames;
    let fonts;
    let resolveFontsReady;
    let refit;
    let stop;

    const flushFrames = () => {
      const due = frames;
      frames = [];
      due.forEach((callback) => callback());
    };
    // The density observer reports at the end of the task that changed the class.
    const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

    beforeEach(() => {
      frames = [];
      fonts = new EventTarget();
      fonts.ready = new Promise((resolve) => {
        resolveFontsReady = resolve;
      });
      refit = jest.fn();
      document.body.className = '';
      const view = {
        requestAnimationFrame: (callback) => frames.push(callback),
        cancelAnimationFrame: () => {},
        MutationObserver: window.MutationObserver,
      };
      stop = watchSensorValueFitInputs({ defaultView: view, body: document.body, fonts }, refit);
    });

    afterEach(() => {
      stop();
      document.body.className = '';
    });

    it('fits the readings again once the fonts have loaded, after a fit taken before', async () => {
      resolveFontsReady();
      await settle();
      flushFrames();
      expect(refit).toHaveBeenCalledTimes(1);
    });

    it('fits them again when a font that arrives late finishes loading', () => {
      fonts.dispatchEvent(new Event('loadingdone'));
      flushFrames();
      expect(refit).toHaveBeenCalledTimes(1);
    });

    it('fits them again when the density switches, and not for other classes', async () => {
      document.body.classList.add('theme-light');
      await settle();
      flushFrames();
      expect(refit).not.toHaveBeenCalled();

      document.body.classList.add('density-compact');
      await settle();
      flushFrames();
      expect(refit).toHaveBeenCalledTimes(1);

      document.body.classList.remove('density-compact');
      await settle();
      flushFrames();
      expect(refit).toHaveBeenCalledTimes(2);
    });

    it('answers fonts and a density switch that come together with one refit', async () => {
      fonts.dispatchEvent(new Event('loadingdone'));
      fonts.dispatchEvent(new Event('loadingdone'));
      document.body.classList.add('density-compact');
      await settle();
      flushFrames();
      expect(refit).toHaveBeenCalledTimes(1);
    });

    it('stops when asked', async () => {
      stop();
      fonts.dispatchEvent(new Event('loadingdone'));
      document.body.classList.add('density-compact');
      await settle();
      flushFrames();
      expect(refit).not.toHaveBeenCalled();
    });
  });
});

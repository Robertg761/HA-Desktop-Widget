/**
 * @jest-environment jsdom
 */

jest.mock('../../src/ui-utils.js', () => ({ setSeasonalColors: jest.fn(() => true) }));
jest.mock('../../src/desktop-appearance.js', () => ({ reapplyDesktopAppearance: jest.fn() }));

const { setSeasonalColors } = require('../../src/ui-utils.js');
const { reapplyDesktopAppearance } = require('../../src/desktop-appearance.js');
const { SeasonalEffectsManager } = require('../../src/seasonal-effects.js');

// A holiday picked under "Holiday to show", which lasts a day from now.
const picked = (id) => ({ show: id, showUntil: Date.now() + 24 * 60 * 60 * 1000 });

// Any drawing call is a no-op; gradients only need addColorStop.
function createContext() {
  const calls = [];
  const target = {
    createRadialGradient: () => ({ addColorStop() {} }),
  };
  return {
    calls,
    context: new Proxy(target, {
      get(object, key) {
        if (key in object) return object[key];
        return (...args) => calls.push([key, ...args]);
      },
      set(object, key, value) {
        object[key] = value;
        return true;
      },
    }),
  };
}

describe('SeasonalEffectsManager', () => {
  let canvas;
  let drawing;
  let reducedMotion;
  let forcedColors;
  let motionListeners;
  let forcedColorsListeners;
  let resolutionListeners;
  let manager;

  beforeEach(() => {
    jest.useFakeTimers({ now: new Date(2026, 9, 15, 12) });
    drawing = createContext();
    canvas = { width: 0, height: 0, getContext: () => drawing.context };
    document.body.innerHTML = '';
    delete document.body.dataset.season;
    jest
      .spyOn(document, 'getElementById')
      .mockImplementation((id) => (id === 'seasonal-effects-canvas' ? canvas : null));
    reducedMotion = false;
    forcedColors = false;
    motionListeners = [];
    forcedColorsListeners = [];
    resolutionListeners = [];
    window.matchMedia = jest.fn((query) => {
      if (query.includes('resolution')) {
        return {
          matches: true,
          addEventListener: (type, listener) => resolutionListeners.push(listener),
          removeEventListener: jest.fn(),
        };
      }
      const forced = query.includes('forced-colors');
      return {
        get matches() {
          return forced ? forcedColors : reducedMotion;
        },
        addEventListener: (type, listener) =>
          (forced ? forcedColorsListeners : motionListeners).push(listener),
        removeEventListener: jest.fn(),
      };
    });
    window.requestAnimationFrame = jest.fn(() => 1);
    window.cancelAnimationFrame = jest.fn();
    setSeasonalColors.mockClear();
    reapplyDesktopAppearance.mockClear();
    manager = new SeasonalEffectsManager('seasonal-effects-canvas');
  });

  afterEach(() => {
    manager.destroy();
    jest.restoreAllMocks();
    jest.useRealTimers();
  });

  test('marks the running holiday on the body and swaps in its colours', () => {
    manager.apply({});

    expect(document.body.dataset.season).toBe('halloween');
    expect(setSeasonalColors).toHaveBeenLastCalledWith({
      accent: '#f97316',
      background: '#6d28d9',
    });
    // The Omarchy palette repaints itself, so it hears about the change.
    expect(reapplyDesktopAppearance).toHaveBeenCalled();
    expect(manager.getActiveHolidayId()).toBe('halloween');
    expect(manager.getParticleCount()).toBeGreaterThan(0);
    expect(window.requestAnimationFrame).toHaveBeenCalled();
  });

  test('keeps the decorations but not the colours when holiday colours are off', () => {
    manager.apply({ seasonal: { colors: false } });

    expect(document.body.dataset.season).toBe('halloween');
    expect(setSeasonalColors).toHaveBeenLastCalledWith(null);
  });

  test('clears everything when turned off or outside a holiday', () => {
    manager.apply({});
    manager.apply({ seasonal: { enabled: false } });
    expect(document.body.dataset.season).toBeUndefined();
    expect(setSeasonalColors).toHaveBeenLastCalledWith(null);
    expect(manager.getParticleCount()).toBe(0);

    jest.setSystemTime(new Date(2026, 8, 20, 12));
    manager.apply({});
    expect(document.body.dataset.season).toBeUndefined();
  });

  test('picks up a new holiday on its own once the date moves on', () => {
    jest.setSystemTime(new Date(2026, 10, 30, 23, 55));
    manager.apply({});
    expect(document.body.dataset.season).toBeUndefined();

    jest.advanceTimersByTime(10 * 60 * 1000);
    expect(document.body.dataset.season).toBe('christmas');
  });

  test('stays off by default under reduced motion and follows the system setting', () => {
    reducedMotion = true;
    manager.apply({});
    expect(document.body.dataset.season).toBeUndefined();

    reducedMotion = false;
    motionListeners.forEach((listener) => listener());
    expect(document.body.dataset.season).toBe('halloween');
  });

  test('draws one still frame instead of animating when reduced motion is on by choice', () => {
    reducedMotion = true;
    manager.apply({ seasonal: { enabled: true, ...picked('christmas') } });

    expect(document.body.dataset.season).toBe('christmas');
    expect(window.requestAnimationFrame).not.toHaveBeenCalled();
    expect(drawing.calls.some(([method]) => method === 'arc' || method === 'stroke')).toBe(true);
  });

  test('redraws a still scene when light or dark mode changes', async () => {
    reducedMotion = true;
    manager.apply({ seasonal: { enabled: true, ...picked('christmas') } });
    expect(window.requestAnimationFrame).not.toHaveBeenCalled();

    drawing.calls.length = 0;
    document.body.classList.add('theme-light');
    await Promise.resolve();
    expect(drawing.calls.length).toBeGreaterThan(0);

    // Other class changes leave the still frame alone.
    drawing.calls.length = 0;
    document.body.classList.add('density-compact');
    await Promise.resolve();
    expect(drawing.calls).toEqual([]);
    document.body.classList.remove('theme-light', 'density-compact');
  });

  test('stops drawing while forced colours hide the canvas, and resumes after', () => {
    forcedColors = true;
    manager.apply({ seasonal: picked('halloween') });
    // The holiday still applies (the stylesheet hides its art), but nothing is drawn.
    expect(document.body.dataset.season).toBe('halloween');
    expect(window.requestAnimationFrame).not.toHaveBeenCalled();
    drawing.calls.length = 0;
    manager.renderFrame(1000);
    expect(drawing.calls).toEqual([]);

    forcedColors = false;
    forcedColorsListeners.forEach((listener) => listener());
    expect(manager.animationFrameId).toBe(1);

    forcedColors = true;
    forcedColorsListeners.forEach((listener) => listener());
    expect(window.cancelAnimationFrame).toHaveBeenCalledWith(1);
    expect(manager.animationFrameId).toBeNull();
  });

  test('pauses while the window is hidden', () => {
    manager.apply({});
    expect(manager.animationFrameId).toBe(1);

    Object.defineProperty(document, 'hidden', { configurable: true, get: () => true });
    document.dispatchEvent(new Event('visibilitychange'));
    expect(window.cancelAnimationFrame).toHaveBeenCalledWith(1);
    expect(manager.animationFrameId).toBeNull();

    Object.defineProperty(document, 'hidden', { configurable: true, get: () => false });
    document.dispatchEvent(new Event('visibilitychange'));
    expect(manager.animationFrameId).toBe(1);
  });

  function addTile(top, height) {
    const tile = document.createElement('div');
    tile.className = 'control-item';
    tile.style.borderTopLeftRadius = '14px';
    tile.getBoundingClientRect = () => ({
      left: 10,
      top,
      width: 200,
      height,
      right: 210,
      bottom: top + height,
    });
    document.body.appendChild(tile);
    return tile;
  }

  test('frosts the scene under tiles with one blurred copy of the whole scene', () => {
    addTile(100, 80);
    addTile(200, 80);
    const frost = createContext();
    const createElement = document.createElement.bind(document);
    jest
      .spyOn(document, 'createElement')
      .mockImplementation((tag) =>
        tag === 'canvas'
          ? { width: 0, height: 0, getContext: () => frost.context }
          : createElement(tag)
      );

    manager.apply({ seasonal: picked('christmas') });
    drawing.calls.length = 0;
    manager.loop(1000);

    // The blurred copy is made once at quarter size...
    const blurCopies = frost.calls.filter(([method]) => method === 'drawImage');
    expect(blurCopies).toHaveLength(1);
    expect(blurCopies[0].slice(2)).toEqual([
      0,
      0,
      Math.round(window.innerWidth / 4),
      Math.round(window.innerHeight / 4),
    ]);
    // ...and stands in for the scene inside both tiles' rounded outlines.
    const outlines = drawing.calls.filter(([method]) => method === 'roundRect');
    expect(outlines.map((call) => call.slice(1))).toEqual([
      [10, 100, 200, 80, 14],
      [10, 200, 200, 80, 14],
    ]);
    const methods = drawing.calls.map(([method]) => method);
    expect(methods.lastIndexOf('clip')).toBeLessThan(methods.lastIndexOf('drawImage'));
  });

  test('finds a lane between tiles for fliers, and falls back when there is none', () => {
    addTile(0, 100);
    // Down past the bottom of the window, so the only gap runs from 100 to 140.
    addTile(140, window.innerHeight);
    const lane = manager.findClearLane(20, 24);
    expect(lane).toBeGreaterThanOrEqual(114);
    expect(lane).toBeLessThanOrEqual(126);
    // Nothing 60px tall fits anywhere, so the flier keeps its own height.
    expect(manager.findClearLane(20, 60)).toBe(20);
  });

  test('holds no canvas pixels while no holiday runs', () => {
    jest.setSystemTime(new Date(2026, 8, 20, 12));
    manager.apply({});
    expect([canvas.width, canvas.height]).toEqual([0, 0]);

    manager.apply({ seasonal: picked('halloween') });
    expect(canvas.width).toBe(Math.round(window.innerWidth * manager.pixelRatio));
    expect(canvas.height).toBe(Math.round(window.innerHeight * manager.pixelRatio));

    manager.apply({ seasonal: { enabled: false } });
    expect([canvas.width, canvas.height]).toEqual([0, 0]);
  });

  test('redraws at the new resolution when the screen scale changes', () => {
    manager.apply({ seasonal: picked('halloween') });
    const before = canvas.width;
    const original = window.devicePixelRatio;
    Object.defineProperty(window, 'devicePixelRatio', { configurable: true, value: 2 });
    resolutionListeners.at(-1)();
    expect(canvas.width).toBe(Math.round(window.innerWidth * 2));
    expect(canvas.width).not.toBe(before);
    // The watch moves on to the new ratio.
    expect(window.matchMedia).toHaveBeenLastCalledWith('(resolution: 2dppx)');
    Object.defineProperty(window, 'devicePixelRatio', { configurable: true, value: original });
  });

  test('follows scrolling without re-measuring the tiles', () => {
    const scroller = document.createElement('div');
    scroller.className = 'widget-content';
    document.body.appendChild(scroller);
    const tile = document.createElement('div');
    tile.className = 'control-item';
    const measure = jest.fn(() => ({ left: 10, top: 300, width: 200, height: 80 }));
    tile.getBoundingClientRect = measure;
    scroller.appendChild(tile);

    expect(manager.readFrostRects(1000)[0].y).toBe(300);
    expect(measure).toHaveBeenCalledTimes(1);

    scroller.scrollTop = 120;
    scroller.dispatchEvent(new Event('scroll'));
    expect(manager.readFrostRects(1100)[0].y).toBe(180);
    expect(measure).toHaveBeenCalledTimes(1);

    // The periodic re-measure still picks up anything else that moved.
    manager.readFrostRects(1600);
    expect(measure).toHaveBeenCalledTimes(2);
  });

  test('every holiday scene can start, advance and draw, visitors and fireworks included', () => {
    const ids = [
      'new-year',
      'lunar-new-year',
      'valentines',
      'st-patricks',
      'easter',
      'halloween',
      'thanksgiving',
      'christmas',
    ];
    for (const light of [false, true]) {
      document.body.classList.toggle('theme-light', light);
      for (const id of ids) {
        manager.apply({ seasonal: picked(id) });
        expect(manager.getActiveHolidayId()).toBe(id);
        drawing.calls.length = 0;
        // A minute of frames: long enough for a witch, sleigh, bunny or turkey to cross.
        manager.lastTime = 0;
        for (let time = 40; time < 60000; time += 40) manager.loop(time);
        expect(manager.getParticleCount()).toBeGreaterThan(0);
        expect(drawing.calls.length).toBeGreaterThan(0);
      }
    }
    document.body.classList.remove('theme-light');
  });
});

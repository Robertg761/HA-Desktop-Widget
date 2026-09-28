/**
 * @jest-environment jsdom
 */

jest.mock('../../src/ui-utils.js', () => ({ setSeasonalColors: jest.fn(() => true) }));
jest.mock('../../src/desktop-appearance.js', () => ({ reapplyDesktopAppearance: jest.fn() }));

const { setSeasonalColors } = require('../../src/ui-utils.js');
const { reapplyDesktopAppearance } = require('../../src/desktop-appearance.js');
const { SeasonalEffectsManager } = require('../../src/seasonal-effects.js');

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
  let motionListeners;
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
    motionListeners = [];
    window.matchMedia = jest.fn(() => ({
      get matches() {
        return reducedMotion;
      },
      addEventListener: (type, listener) => motionListeners.push(listener),
      removeEventListener: jest.fn(),
    }));
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
    manager.apply({ seasonal: { enabled: true, show: 'christmas' } });

    expect(document.body.dataset.season).toBe('christmas');
    expect(window.requestAnimationFrame).not.toHaveBeenCalled();
    expect(drawing.calls.some(([method]) => method === 'arc' || method === 'stroke')).toBe(true);
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

    manager.apply({ seasonal: { show: 'christmas' } });
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
        manager.apply({ seasonal: { show: id } });
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

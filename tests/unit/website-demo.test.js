/**
 * @jest-environment jsdom
 */

const fs = require('fs');
const path = require('path');
const vm = require('vm');

describe('website demo weather transitions', () => {
  let demo;
  let intersect;
  let resize;
  let hidden;
  let motionChange;
  let motionQuery;
  let context;

  beforeEach(() => {
    jest.useFakeTimers();
    hidden = false;
    motionQuery = {
      matches: false,
      addEventListener: (_event, callback) => {
        motionChange = callback;
      },
    };
    document.body.innerHTML = `
      <canvas id="weather-canvas"></canvas>
      <div class="dock"><div class="seg">
        <button data-fx=""></button><button data-fx="sunny"></button>
        <button data-fx="rainy"></button>
      </div></div>`;
    jest.spyOn(document, 'hidden', 'get').mockImplementation(() => hidden);
    context = {
      clearRect: jest.fn(),
      createRadialGradient: () => ({ addColorStop: jest.fn() }),
      fillRect: jest.fn(),
      beginPath: jest.fn(),
      arc: jest.fn(),
      fill: jest.fn(),
      setTransform: jest.fn(),
    };
    jest.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(context);
    let frame = 0;
    const source = fs.readFileSync(path.join(__dirname, '../../website/script.js'), 'utf8');
    const weather = source.slice(
      source.indexOf('class StageWeather'),
      source.indexOf('/* ---------------- Ghost hand-off')
    );
    const placePins = source.slice(
      source.indexOf('function placePinned('),
      source.indexOf('function pin(')
    );
    const savePins = source.slice(
      source.indexOf('function savePins('),
      source.indexOf('/* Below the breakpoint')
    );
    const manager = fs
      .readFileSync(path.join(__dirname, '../../website/weather-effects.js'), 'utf8')
      .replace('export class WeatherEffectsManager', 'class WeatherEffectsManager');
    demo = vm.createContext({
      document,
      window: {
        addEventListener: jest.fn(),
        // The engine also watches the screen's pixel ratio, which no test here changes that way.
        matchMedia: (query) =>
          query.includes('reduced-motion') ? motionQuery : { addEventListener: jest.fn() },
      },
      performance,
      Date,
      setTimeout,
      setInterval,
      requestAnimationFrame: jest.fn(() => ++frame),
      cancelAnimationFrame: jest.fn(),
      ResizeObserver: class {
        constructor(callback) {
          resize = callback;
        }
        observe() {}
      },
      IntersectionObserver: class {
        constructor(callback) {
          intersect = callback;
        }
        observe() {}
      },
      stage: { clientWidth: 1200, clientHeight: 600 },
      pinnedEls: new Map(),
      store: { set: jest.fn() },
      markInteracted: jest.fn(),
    });
    vm.runInContext(
      `const STAGE_BAR = 38;\n${placePins}\n${savePins}\n${manager}\n${weather}`,
      demo
    );
  });

  afterEach(() => {
    jest.clearAllTimers();
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  it('keeps a delayed effect stopped after scrolling the demo out of view', () => {
    jest.advanceTimersByTime(3500);
    expect(document.getElementById('weather-canvas').style.opacity).toBe('0');
    intersect([{ isIntersecting: false }]);
    jest.advanceTimersByTime(450);
    expect(vm.runInContext('fx.activeEffect', demo)).toBe('sunny');
    expect(vm.runInContext('fx.animationFrameId', demo)).toBeNull();
    jest.advanceTimersByTime(10000);
    expect(vm.runInContext('fx.animationFrameId', demo)).toBeNull();
    intersect([{ isIntersecting: true }]);
    expect(vm.runInContext('fx.animationFrameId', demo)).not.toBeNull();
  });

  it('keeps a delayed effect stopped after hiding the document', () => {
    jest.advanceTimersByTime(3500);
    hidden = true;
    document.dispatchEvent(new Event('visibilitychange'));
    jest.advanceTimersByTime(450);
    expect(vm.runInContext('fx.animationFrameId', demo)).toBeNull();
    hidden = false;
    document.dispatchEvent(new Event('visibilitychange'));
    expect(vm.runInContext('fx.animationFrameId', demo)).not.toBeNull();
  });

  it('keeps weather paused when reduced motion is turned off while the demo is offscreen', () => {
    jest.advanceTimersByTime(3950);
    expect(vm.runInContext('fx.animationFrameId', demo)).not.toBeNull();
    intersect([{ isIntersecting: false }]);
    motionQuery.matches = true;
    motionChange();
    motionQuery.matches = false;
    motionChange();
    expect(vm.runInContext('fx.animationFrameId', demo)).toBeNull();
    intersect([{ isIntersecting: true }]);
    expect(vm.runInContext('fx.animationFrameId', demo)).not.toBeNull();
  });

  it('stays off once the visitor turns the weather off, instead of restarting the tour', () => {
    jest.advanceTimersByTime(4000);
    expect(vm.runInContext('currentFx', demo)).toBe('sunny');
    document.querySelector('[data-fx=""]').click();
    expect(vm.runInContext('currentFx', demo)).toBe('');
    // The tour used to pick up again after the 45 second hold.
    jest.advanceTimersByTime(120000);
    expect(vm.runInContext('currentFx', demo)).toBe('');
    expect(vm.runInContext('fx.activeEffect', demo)).toBeNull();
  });

  it('tours each effect once and then rests on off', () => {
    const seen = [];
    for (let step = 0; step < 12; step += 1) {
      jest.advanceTimersByTime(7000);
      seen.push(vm.runInContext('currentFx', demo));
    }
    expect(seen.slice(0, 3)).toEqual(['sunny', 'rainy', '']);
    expect(new Set(seen.slice(2))).toEqual(new Set(['']));
  });

  it('repositions existing pins when the stage resizes and saves their new positions', () => {
    const slot = {
      style: { left: '1000px', top: '550px' },
      offsetWidth: 120,
      offsetHeight: 96,
      get offsetLeft() {
        return parseInt(this.style.left, 10);
      },
      get offsetTop() {
        return parseInt(this.style.top, 10);
      },
    };
    demo.pinnedEls.set('light.desk', slot);
    demo.stage.clientWidth = 800;
    demo.stage.clientHeight = 500;
    resize();
    expect(slot.offsetLeft).toBe(672);
    expect(slot.offsetTop).toBe(396);
    expect(demo.store.set).toHaveBeenCalledWith('pins', { 'light.desk': { x: 672, y: 396 } });
    expect(vm.runInContext('fx.canvas.width', demo)).toBe(800);
    expect(vm.runInContext('fx.canvas.height', demo)).toBe(500);
  });

  // The copy used to set the canvas to the stage's CSS size, so rain and snow were drawn at 1x
  // and blurred on a HiDPI screen, while the app drew them crisp.
  it('draws the weather at the resolution of the screen, as the app does', () => {
    const canvas = document.getElementById('weather-canvas');
    expect([canvas.width, canvas.height]).toEqual([1200, 600]);

    vm.runInContext('window.devicePixelRatio = 2; fx.resizeCanvas()', demo);

    expect([canvas.width, canvas.height]).toEqual([2400, 1200]);
    expect(context.setTransform).toHaveBeenLastCalledWith(2, 0, 0, 2, 0, 0);
    // The scenes still work in the stage's own size.
    expect(vm.runInContext('[fx.width, fx.height]', demo)).toEqual([1200, 600]);
  });
});

// The demo offers the app's weather as the real thing. A copy that drifted missed the app's
// high-density drawing and its light-theme colours for six weeks.
describe('website weather engine', () => {
  it('is the file the app runs, unchanged', () => {
    const read = (file) =>
      fs.readFileSync(path.join(__dirname, '../..', file), 'utf8').replace(/\r\n/g, '\n');
    expect(read('website/weather-effects.js')).toBe(read('src/weather-effects.js'));
  });
});

describe('website demo brightness dialog', () => {
  it('frees the whole page on close after a long press opened it twice', () => {
    document.body.innerHTML = `
      <header id="top"></header>
      <main>
        <section id="stage">
          <div id="bright-pop" hidden>
            <h3 id="bright-name"></h3><span id="bright-value"></span>
            <input id="bright-slider" type="range"><button id="bright-power"></button>
          </div>
          <button id="lamp">Lamp</button>
        </section>
      </main>
      <footer id="bottom"></footer>`;
    const source = fs.readFileSync(path.join(__dirname, '../../website/script.js'), 'utf8');
    const dialog = source.slice(
      source.indexOf('const pop = document.getElementById'),
      source.indexOf('function applyBrightness(')
    );
    const demo = vm.createContext({
      document,
      ENTITIES: { lamp: { name: 'Lamp', on: true, bri: 40 } },
    });
    vm.runInContext(
      `${dialog}; this.openBrightness = openBrightness; this.closeBrightness = closeBrightness;`,
      demo
    );
    const lamp = document.getElementById('lamp');

    // The hold timer and the contextmenu event both open it.
    demo.openBrightness('lamp', lamp);
    demo.openBrightness('lamp', lamp);
    expect(['top', 'bottom', 'lamp'].every((id) => document.getElementById(id).inert)).toBe(true);

    demo.closeBrightness();
    expect([...document.querySelectorAll('[inert]')]).toEqual([]);
    expect(['top', 'bottom', 'lamp'].some((id) => document.getElementById(id).inert)).toBe(false);
  });
});

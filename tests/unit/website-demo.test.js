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

  beforeEach(() => {
    jest.useFakeTimers();
    hidden = false;
    document.body.innerHTML = `
      <canvas id="weather-canvas"></canvas>
      <div class="dock"><div class="seg">
        <button data-fx=""></button><button data-fx="sunny"></button>
        <button data-fx="rainy"></button>
      </div></div>`;
    jest.spyOn(document, 'hidden', 'get').mockImplementation(() => hidden);
    jest.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
      clearRect: jest.fn(),
    });
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
      window: { addEventListener: jest.fn() },
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
});

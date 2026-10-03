/**
 * @jest-environment jsdom
 */

const { WeatherEffectsManager } = require('../../src/weather-effects.js');

describe('WeatherEffectsManager', () => {
  let mockCanvas;
  let mockContext;
  let mockGradient;
  let originalRAF;
  let originalCAF;
  let originalMatchMedia;

  beforeEach(() => {
    // Save original animation frame methods
    originalRAF = window.requestAnimationFrame;
    originalCAF = window.cancelAnimationFrame;
    originalMatchMedia = window.matchMedia;

    window.requestAnimationFrame = jest.fn((cb) => setTimeout(cb, 16));
    window.cancelAnimationFrame = jest.fn((id) => clearTimeout(id));
    window.matchMedia = undefined;

    // Set up mock canvas and context
    mockGradient = {
      addColorStop: jest.fn(),
    };

    mockContext = {
      clearRect: jest.fn(),
      beginPath: jest.fn(),
      moveTo: jest.fn(),
      lineTo: jest.fn(),
      stroke: jest.fn(),
      arc: jest.fn(),
      fill: jest.fn(),
      fillRect: jest.fn(),
      createRadialGradient: jest.fn().mockReturnValue(mockGradient),
      globalAlpha: 1.0,
      strokeStyle: '',
      lineWidth: 1,
      fillStyle: '',
    };

    mockCanvas = {
      getContext: jest.fn().mockReturnValue(mockContext),
      width: 800,
      height: 600,
    };

    document.body.innerHTML = '<canvas id="weather-effects-canvas"></canvas>';
    jest.spyOn(document, 'getElementById').mockImplementation((id) => {
      if (id === 'weather-effects-canvas') return mockCanvas;
      return null;
    });
  });

  afterEach(() => {
    window.requestAnimationFrame = originalRAF;
    window.cancelAnimationFrame = originalCAF;
    window.matchMedia = originalMatchMedia;
    jest.restoreAllMocks();
    jest.useRealTimers();
  });

  it('should initialize and resize canvas', () => {
    const manager = new WeatherEffectsManager('weather-effects-canvas');
    expect(manager.canvas).toBe(mockCanvas);
    expect(manager.ctx).toBe(mockContext);
    expect(mockCanvas.width).toBe(window.innerWidth);
    expect(mockCanvas.height).toBe(window.innerHeight);
    manager.destroy();
  });

  it('should set effect and initialize appropriate objects', () => {
    const manager = new WeatherEffectsManager('weather-effects-canvas');

    // Sunny
    manager.setEffect('sunny');
    expect(manager.activeEffect).toBe('sunny');
    expect(manager.sun).toBeDefined();
    expect(manager.particles.length).toBe(0);

    // Cloudy
    manager.setEffect('cloudy');
    expect(manager.activeEffect).toBe('cloudy');
    expect(manager.clouds.length).toBeGreaterThan(0);

    // Snowy
    manager.setEffect('snowy');
    expect(manager.activeEffect).toBe('snowy');
    expect(manager.particles.length).toBeGreaterThan(0);

    // Rainy
    manager.setEffect('rainy');
    expect(manager.activeEffect).toBe('rainy');
    expect(manager.particles.length).toBeGreaterThan(0);

    // Stormy
    manager.setEffect('stormy');
    expect(manager.activeEffect).toBe('stormy');
    expect(manager.particles.length).toBeGreaterThan(0);

    manager.destroy();
  });

  it('should request and cancel animation frame when setting/clearing effects', () => {
    const manager = new WeatherEffectsManager('weather-effects-canvas');
    manager.setEffect('rainy');
    expect(window.requestAnimationFrame).toHaveBeenCalled();
    expect(manager.animationFrameId).toBeDefined();

    manager.setEffect(null);
    expect(window.cancelAnimationFrame).toHaveBeenCalled();
    expect(manager.animationFrameId).toBeNull();
    expect(mockContext.clearRect).toHaveBeenCalled();

    manager.destroy();
  });

  it('renders a static frame without requesting animation when reduced motion is preferred', () => {
    const mediaQuery = {
      matches: true,
      addEventListener: jest.fn(),
      removeEventListener: jest.fn(),
    };
    window.matchMedia = jest.fn().mockReturnValue(mediaQuery);

    const manager = new WeatherEffectsManager('weather-effects-canvas');
    manager.setEffect('rainy');

    expect(window.matchMedia).toHaveBeenCalledWith('(prefers-reduced-motion: reduce)');
    expect(window.requestAnimationFrame).not.toHaveBeenCalled();
    expect(mockContext.clearRect).toHaveBeenCalled();
    expect(mockContext.stroke).toHaveBeenCalled();

    manager.destroy();
    expect(mediaQuery.removeEventListener).toHaveBeenCalledWith('change', expect.any(Function));
  });

  it('stops and restarts animation when the reduced-motion media query changes', () => {
    let changeHandler;
    const mediaQuery = {
      matches: false,
      addEventListener: jest.fn((event, handler) => {
        if (event === 'change') changeHandler = handler;
      }),
      removeEventListener: jest.fn(),
    };
    window.matchMedia = jest.fn().mockReturnValue(mediaQuery);

    const manager = new WeatherEffectsManager('weather-effects-canvas');
    manager.setEffect('sunny');
    expect(window.requestAnimationFrame).toHaveBeenCalledTimes(1);
    const frameId = manager.animationFrameId;

    mediaQuery.matches = true;
    changeHandler();
    expect(window.cancelAnimationFrame).toHaveBeenCalledWith(frameId);
    expect(manager.animationFrameId).toBeNull();

    mediaQuery.matches = false;
    changeHandler();
    expect(window.requestAnimationFrame).toHaveBeenCalledTimes(2);

    manager.destroy();
  });

  it('should run loop and invoke draw functions without error', () => {
    jest.useFakeTimers();
    const manager = new WeatherEffectsManager('weather-effects-canvas');

    // Test rainy
    manager.setEffect('rainy');
    jest.advanceTimersByTime(60);
    expect(mockContext.clearRect).toHaveBeenCalled();
    expect(mockContext.stroke).toHaveBeenCalled();

    // Test stormy (lightning)
    mockContext.clearRect.mockClear();
    manager.setEffect('stormy');
    jest.advanceTimersByTime(60);
    expect(mockContext.clearRect).toHaveBeenCalled();
    // Simulate lightning timer triggering
    manager.lightningTime = performance.now() - 100;
    jest.advanceTimersByTime(60);
    expect(manager.lightningOpacity).toBeGreaterThanOrEqual(0);

    // Test cloudy
    mockContext.clearRect.mockClear();
    manager.setEffect('cloudy');
    jest.advanceTimersByTime(60);
    expect(mockContext.clearRect).toHaveBeenCalled();
    expect(mockContext.fill).toHaveBeenCalled();

    // Test sunny
    mockContext.clearRect.mockClear();
    manager.setEffect('sunny');
    jest.advanceTimersByTime(60);
    expect(mockContext.clearRect).toHaveBeenCalled();
    expect(mockContext.fill).toHaveBeenCalled();

    manager.destroy();
  });

  it('should destroy cleanly and remove resize event listener', () => {
    const removeListenerSpy = jest.spyOn(window, 'removeEventListener');
    const manager = new WeatherEffectsManager('weather-effects-canvas');
    manager.setEffect('rainy');
    const frameId = manager.animationFrameId;

    manager.destroy();
    expect(removeListenerSpy).toHaveBeenCalledWith('resize', expect.any(Function));
    expect(window.cancelAnimationFrame).toHaveBeenCalledWith(frameId);
  });

  describe('on the light theme', () => {
    const luminance = ([r, g, b]) => {
      const linear = (v) =>
        v / 255 <= 0.03928 ? v / 255 / 12.92 : ((v / 255 + 0.055) / 1.055) ** 2.4;
      return 0.2126 * linear(r) + 0.7152 * linear(g) + 0.0722 * linear(b);
    };
    const channels = (color) => {
      if (color.startsWith('#')) return [1, 3, 5].map((i) => parseInt(color.slice(i, i + 2), 16));
      return color
        .match(/[\d.]+/g)
        .slice(0, 3)
        .map(Number);
    };
    const contrastOnWhite = (color) => 1.05 / (luminance(channels(color)) + 0.05);
    const run = (effect, light) => {
      jest.useFakeTimers();
      document.body.classList.toggle('theme-light', light);
      const manager = new WeatherEffectsManager('weather-effects-canvas');
      manager.setEffect(effect);
      jest.advanceTimersByTime(60);
      manager.destroy();
    };

    afterEach(() => {
      document.body.className = '';
    });

    it('draws snow in white on the dark theme and as slate flakes with an edge on the light one', () => {
      run('snowy', false);
      expect(mockContext.fillStyle).toBe('#ffffff');
      expect(mockContext.stroke).not.toHaveBeenCalled();

      run('snowy', true);
      expect(mockContext.fillStyle).not.toBe('#ffffff');
      // A flake shows on a white window at 2.5:1 or better, and each gets an edge.
      expect(contrastOnWhite(mockContext.fillStyle)).toBeGreaterThanOrEqual(2.5);
      expect(mockContext.stroke).toHaveBeenCalled();
    });

    it('draws rain, cloud and sun in tones that show on white', () => {
      run('rainy', true);
      expect(contrastOnWhite(mockContext.strokeStyle)).toBeGreaterThanOrEqual(3);

      mockGradient.addColorStop.mockClear();
      run('cloudy', true);
      const cloudStops = mockGradient.addColorStop.mock.calls.map(([, color]) => color);
      expect(cloudStops.length).toBeGreaterThan(0);
      expect(cloudStops.every((color) => color.startsWith('rgba(110, 130, 160'))).toBe(true);

      mockGradient.addColorStop.mockClear();
      run('sunny', true);
      expect(mockGradient.addColorStop.mock.calls[0][1]).toBe('rgba(245, 170, 40, 0.34)');

      mockGradient.addColorStop.mockClear();
      run('sunny', false);
      expect(mockGradient.addColorStop.mock.calls[0][1]).toBe('rgba(255, 225, 150, 0.25)');
    });
  });
});

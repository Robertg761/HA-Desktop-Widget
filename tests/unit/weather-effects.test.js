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
      setTransform: jest.fn(),
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

  describe('on a high-density screen', () => {
    let originalRatio;

    beforeEach(() => {
      originalRatio = window.devicePixelRatio;
    });

    afterEach(() => {
      window.devicePixelRatio = originalRatio;
    });

    it('draws at device resolution and keeps its scenes in CSS pixels', () => {
      window.devicePixelRatio = 2;
      const manager = new WeatherEffectsManager('weather-effects-canvas');

      expect(mockCanvas.width).toBe(window.innerWidth * 2);
      expect(mockCanvas.height).toBe(window.innerHeight * 2);
      expect(mockContext.setTransform).toHaveBeenLastCalledWith(2, 0, 0, 2, 0, 0);

      // Particles are placed in window coordinates, not in backing-store pixels.
      manager.setEffect('rainy');
      expect(Math.max(...manager.particles.map((p) => p.x))).toBeLessThanOrEqual(window.innerWidth);
      expect(Math.min(...manager.particles.map((p) => p.y))).toBeGreaterThanOrEqual(
        -window.innerHeight
      );
      manager.setEffect('sunny');
      expect(manager.sun.x).toBeCloseTo(window.innerWidth * 0.15);
      manager.destroy();
    });

    it('stops at twice the pixels and never draws below one per CSS pixel', () => {
      window.devicePixelRatio = 3;
      const heavy = new WeatherEffectsManager('weather-effects-canvas');
      expect(mockCanvas.width).toBe(window.innerWidth * 2);
      heavy.destroy();

      window.devicePixelRatio = 0.75;
      const light = new WeatherEffectsManager('weather-effects-canvas');
      expect(mockCanvas.width).toBe(window.innerWidth);
      light.destroy();
    });

    it('clears the whole scene in CSS pixels and does not resize a canvas that has not changed', () => {
      window.devicePixelRatio = 2;
      const manager = new WeatherEffectsManager('weather-effects-canvas');
      manager.setEffect('sunny');
      manager.setEffect(null);
      expect(mockContext.clearRect).toHaveBeenLastCalledWith(
        0,
        0,
        window.innerWidth,
        window.innerHeight
      );

      // Assigning a canvas size clears it, so a resize event that changes nothing leaves it be.
      mockContext.setTransform.mockClear();
      mockCanvas.width = 1;
      window.dispatchEvent(new Event('resize'));
      expect(mockCanvas.width).toBe(1);
      expect(mockContext.setTransform).not.toHaveBeenCalled();
      manager.destroy();
    });

    it('follows the window to a screen with another scale factor', () => {
      // Every query here is this one object; the scale-factor watcher registers first.
      const changeHandlers = [];
      const query = {
        matches: false,
        addEventListener: jest.fn((event, handler) => {
          if (event === 'change') changeHandlers.push(handler);
        }),
        removeEventListener: jest.fn(),
      };
      window.matchMedia = jest.fn().mockReturnValue(query);
      window.devicePixelRatio = 1;
      const manager = new WeatherEffectsManager('weather-effects-canvas');
      expect(window.matchMedia).toHaveBeenCalledWith('(resolution: 1dppx)');
      expect(mockCanvas.width).toBe(window.innerWidth);

      window.devicePixelRatio = 2;
      changeHandlers[0]();
      expect(mockCanvas.width).toBe(window.innerWidth * 2);
      expect(mockContext.setTransform).toHaveBeenLastCalledWith(2, 0, 0, 2, 0, 0);
      // The query matches one ratio only, so it is renewed for the new one.
      expect(window.matchMedia).toHaveBeenCalledWith('(resolution: 2dppx)');
      expect(query.removeEventListener).toHaveBeenCalledWith('change', expect.any(Function));
      manager.destroy();
    });
  });

  describe('with reduced motion, where the scene is drawn once', () => {
    beforeEach(() => {
      window.matchMedia = jest.fn().mockReturnValue({
        matches: true,
        addEventListener: jest.fn(),
        removeEventListener: jest.fn(),
      });
    });

    // The positions the static frame drew its strokes and flakes at.
    const drawnYs = (calls, index) => calls.map((call) => call[index]);

    it.each(['rainy', 'stormy'])('draws %s rain inside the window', (effect) => {
      const manager = new WeatherEffectsManager('weather-effects-canvas');
      manager.setEffect(effect);

      const starts = drawnYs(mockContext.moveTo.mock.calls, 1);
      expect(starts).toHaveLength(effect === 'stormy' ? 48 : 32);
      // Rain starts above the window and falls in; a still frame must not leave it all up there.
      expect(manager.particles.every((p) => p.y < 0)).toBe(true);
      starts.forEach((y) => {
        expect(y).toBeGreaterThanOrEqual(0);
        expect(y).toBeLessThan(window.innerHeight);
      });
      manager.destroy();
    });

    it('draws snow inside the window', () => {
      const manager = new WeatherEffectsManager('weather-effects-canvas');
      manager.setEffect('snowy');

      const ys = drawnYs(mockContext.arc.mock.calls, 1);
      expect(ys).toHaveLength(36);
      ys.forEach((y) => {
        expect(y).toBeGreaterThanOrEqual(0);
        expect(y).toBeLessThan(window.innerHeight);
      });
      manager.destroy();
    });

    it('also brings in particles that an animation had already moved', () => {
      const manager = new WeatherEffectsManager('weather-effects-canvas');
      manager.setEffect('snowy');
      mockContext.arc.mockClear();
      manager.particles.forEach((p, index) => {
        p.y = index % 2 ? window.innerHeight + 40 : -3 * window.innerHeight;
      });
      manager.renderStaticFrame();
      drawnYs(mockContext.arc.mock.calls, 1).forEach((y) => {
        expect(y).toBeGreaterThanOrEqual(0);
        expect(y).toBeLessThan(window.innerHeight);
      });
      manager.destroy();
    });
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

    describe('with reduced motion, where the scene is drawn once', () => {
      const flush = () => new Promise((resolve) => setTimeout(resolve, 0));
      let mediaQuery;

      beforeEach(() => {
        mediaQuery = { matches: true, addEventListener: jest.fn(), removeEventListener: jest.fn() };
        window.matchMedia = jest.fn().mockReturnValue(mediaQuery);
      });

      it('redraws it in the new theme when the theme changes', async () => {
        const manager = new WeatherEffectsManager('weather-effects-canvas');
        manager.setEffect('snowy');
        expect(window.requestAnimationFrame).not.toHaveBeenCalled();
        expect(mockContext.fillStyle).toBe('#ffffff');

        document.body.classList.add('theme-light');
        await flush();
        expect(mockContext.fillStyle).not.toBe('#ffffff');
        expect(mockContext.stroke).toHaveBeenCalled();

        document.body.classList.remove('theme-light');
        await flush();
        expect(mockContext.fillStyle).toBe('#ffffff');
        manager.destroy();
      });

      it('leaves it alone for a class change that is not the theme, and once destroyed', async () => {
        const manager = new WeatherEffectsManager('weather-effects-canvas');
        manager.setEffect('snowy');
        mockContext.clearRect.mockClear();

        document.body.classList.add('density-compact');
        await flush();
        expect(mockContext.clearRect).not.toHaveBeenCalled();

        manager.destroy();
        document.body.classList.add('theme-light');
        await flush();
        expect(mockContext.clearRect).not.toHaveBeenCalled();
      });
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

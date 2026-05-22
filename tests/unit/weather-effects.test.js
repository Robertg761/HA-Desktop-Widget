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

  beforeEach(() => {
    // Save original animation frame methods
    originalRAF = window.requestAnimationFrame;
    originalCAF = window.cancelAnimationFrame;

    window.requestAnimationFrame = jest.fn((cb) => setTimeout(cb, 16));
    window.cancelAnimationFrame = jest.fn((id) => clearTimeout(id));

    // Set up mock canvas and context
    mockGradient = {
      addColorStop: jest.fn()
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
      fillStyle: ''
    };

    mockCanvas = {
      getContext: jest.fn().mockReturnValue(mockContext),
      width: 800,
      height: 600
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

  it('should run loop and invoke draw functions without error', () => {
    jest.useFakeTimers();
    const manager = new WeatherEffectsManager('weather-effects-canvas');
    
    // Test rainy
    manager.setEffect('rainy');
    jest.advanceTimersByTime(20);
    expect(mockContext.clearRect).toHaveBeenCalled();
    expect(mockContext.stroke).toHaveBeenCalled();

    // Test stormy (lightning)
    mockContext.clearRect.mockClear();
    manager.setEffect('stormy');
    jest.advanceTimersByTime(20);
    expect(mockContext.clearRect).toHaveBeenCalled();
    // Simulate lightning timer triggering
    manager.lightningTime = performance.now() - 100;
    jest.advanceTimersByTime(20);
    expect(manager.lightningOpacity).toBeGreaterThanOrEqual(0);

    // Test cloudy
    mockContext.clearRect.mockClear();
    manager.setEffect('cloudy');
    jest.advanceTimersByTime(20);
    expect(mockContext.clearRect).toHaveBeenCalled();
    expect(mockContext.fill).toHaveBeenCalled();

    // Test sunny
    mockContext.clearRect.mockClear();
    manager.setEffect('sunny');
    jest.advanceTimersByTime(20);
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
});

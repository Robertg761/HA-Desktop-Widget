/**
 * @jest-environment jsdom
 */

const {
  createWeatherIcon,
  getWeatherConditionLabel,
  normalizeWeatherCondition,
  renderWeatherIcon,
} = require('../../src/weather-icons.js');

const HOME_ASSISTANT_WEATHER_CONDITIONS = [
  'clear-night',
  'cloudy',
  'exceptional',
  'fog',
  'hail',
  'lightning',
  'lightning-rainy',
  'partlycloudy',
  'pouring',
  'rainy',
  'snowy',
  'snowy-rainy',
  'sunny',
  'windy',
  'windy-variant',
];

describe('weather icons', () => {
  it.each(HOME_ASSISTANT_WEATHER_CONDITIONS)(
    'renders a deterministic SVG for the %s condition',
    (condition) => {
      const first = createWeatherIcon(condition);
      const second = createWeatherIcon(condition);

      expect(first.tagName.toLowerCase()).toBe('svg');
      expect(first.dataset.weatherCondition).toBe(condition);
      expect(first.outerHTML).toBe(second.outerHTML);
      expect(first.textContent).toBe('');
      expect(first.querySelectorAll('path, circle, line').length).toBeGreaterThan(0);
    }
  );

  it('draws the sun about as big as the cloud and moon beside it, centred in the box', () => {
    const sun = createWeatherIcon('sunny');
    const disc = sun.querySelector('circle.weather-glyph-fill');
    expect(Number(disc.getAttribute('r'))).toBeCloseTo(9.8);
    expect([disc.getAttribute('cx'), disc.getAttribute('cy')]).toEqual(['24', '24']);
    // Every ray stays inside the 48 unit box, and the sun spans about 34 units of it.
    const rays = [...sun.querySelectorAll('line.weather-glyph-ray')];
    expect(rays).toHaveLength(8);
    const reach = rays.flatMap((ray) =>
      ['x1', 'y1', 'x2', 'y2'].map((name) => Number(ray.getAttribute(name)))
    );
    expect(Math.min(...reach)).toBeGreaterThan(5);
    expect(Math.max(...reach)).toBeLessThan(43);
    expect(Math.max(...reach) - Math.min(...reach)).toBeGreaterThan(32);
  });

  it('keeps the partly cloudy sun as it was', () => {
    const disc = createWeatherIcon('partlycloudy').querySelector('circle.weather-glyph-fill');
    expect(disc.getAttribute('r')).toBe('5');
  });

  it('lowers a cloud that has nothing under it, and not one that has rain or snow', () => {
    const cloudOf = (condition) =>
      createWeatherIcon(condition).querySelector('path.weather-glyph-cloud');
    expect(cloudOf('cloudy').getAttribute('transform')).toBe('translate(0 4)');
    for (const condition of ['rainy', 'pouring', 'snowy', 'hail', 'lightning', 'lightning-rainy']) {
      expect(cloudOf(condition).hasAttribute('transform')).toBe(false);
    }
  });

  it('normalizes common integration aliases and unknown values safely', () => {
    expect(normalizeWeatherCondition('Partly Cloudy')).toBe('partlycloudy');
    expect(normalizeWeatherCondition('thunderstorm with rain')).toBe('lightning-rainy');
    expect(normalizeWeatherCondition('heavy snow showers')).toBe('snowy');
    expect(normalizeWeatherCondition('mist')).toBe('fog');
    expect(normalizeWeatherCondition('something-new')).toBe('unknown');
  });

  it('replaces any native emoji content when the weather changes', () => {
    const container = document.createElement('div');
    container.textContent = '🌫️';

    renderWeatherIcon(container, 'fog');

    expect(container.textContent).toBe('');
    expect(container.children).toHaveLength(1);
    expect(container.firstElementChild.tagName.toLowerCase()).toBe('svg');
    expect(container.dataset.weatherCondition).toBe('fog');
  });

  it('names an entity that is offline in words, not as the raw lowercase state', () => {
    expect(getWeatherConditionLabel('unavailable')).toBe('Unavailable');
    expect(getWeatherConditionLabel('Unavailable')).toBe('Unavailable');
    expect(getWeatherConditionLabel('unknown')).toBe('Unknown');
    // A condition the widget does not know is still the provider's own text.
    expect(getWeatherConditionLabel('Volcanic eruption')).toBe('Volcanic eruption');
    expect(getWeatherConditionLabel('')).toBe('--');
  });
});

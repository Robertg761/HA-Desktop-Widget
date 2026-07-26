/**
 * @jest-environment jsdom
 */

const {
  createWeatherIcon,
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
});

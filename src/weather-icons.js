const SVG_NS = 'http://www.w3.org/2000/svg';

const WEATHER_CONDITION_ALIASES = new Map([
  ['clear', 'sunny'],
  ['clear-day', 'sunny'],
  ['clear-night', 'clear-night'],
  ['cloudy', 'cloudy'],
  ['drizzle', 'rainy'],
  ['exceptional', 'exceptional'],
  ['fog', 'fog'],
  ['haze', 'fog'],
  ['hail', 'hail'],
  ['lightning', 'lightning'],
  ['lightning-rainy', 'lightning-rainy'],
  ['mist', 'fog'],
  ['night', 'clear-night'],
  ['overcast', 'cloudy'],
  ['partly-cloudy', 'partlycloudy'],
  ['partlycloudy', 'partlycloudy'],
  ['pouring', 'pouring'],
  ['rain', 'rainy'],
  ['rainy', 'rainy'],
  ['sleet', 'snowy-rainy'],
  ['snow', 'snowy'],
  ['snowy', 'snowy'],
  ['snowy-rainy', 'snowy-rainy'],
  ['sunny', 'sunny'],
  ['thunder', 'lightning'],
  ['thunderstorm', 'lightning-rainy'],
  ['wind', 'windy'],
  ['windy', 'windy'],
  ['windy-variant', 'windy-variant'],
]);

const WEATHER_LABELS = {
  'clear-night': 'Clear night',
  cloudy: 'Cloudy',
  exceptional: 'Exceptional weather',
  fog: 'Fog',
  hail: 'Hail',
  lightning: 'Lightning',
  'lightning-rainy': 'Lightning and rain',
  partlycloudy: 'Partly cloudy',
  pouring: 'Pouring rain',
  rainy: 'Rainy',
  snowy: 'Snowy',
  'snowy-rainy': 'Snow and rain',
  sunny: 'Sunny',
  windy: 'Windy',
  'windy-variant': 'Windy and cloudy',
  unknown: 'Unknown weather',
};

function createSvgNode(name, attributes = {}) {
  const element = document.createElementNS(SVG_NS, name);
  Object.entries(attributes).forEach(([key, value]) => {
    element.setAttribute(key, String(value));
  });
  return element;
}

function addPath(svg, d, className = '') {
  svg.appendChild(createSvgNode('path', { d, ...(className ? { class: className } : {}) }));
}

function addLine(svg, x1, y1, x2, y2, className = '') {
  svg.appendChild(
    createSvgNode('line', {
      x1,
      y1,
      x2,
      y2,
      ...(className ? { class: className } : {}),
    })
  );
}

function addCircle(svg, cx, cy, r, className = '') {
  svg.appendChild(
    createSvgNode('circle', {
      cx,
      cy,
      r,
      ...(className ? { class: className } : {}),
    })
  );
}

function drawSun(svg, { cx = 18, cy = 17, radius = 6, rays = true } = {}) {
  addCircle(svg, cx, cy, radius, 'weather-glyph-fill');
  if (!rays) return;

  [
    [cx, cy - 12, cx, cy - 9],
    [cx, cy + 9, cx, cy + 12],
    [cx - 12, cy, cx - 9, cy],
    [cx + 9, cy, cx + 12, cy],
    [cx - 8.5, cy - 8.5, cx - 6.4, cy - 6.4],
    [cx + 6.4, cy + 6.4, cx + 8.5, cy + 8.5],
    [cx + 6.4, cy - 6.4, cx + 8.5, cy - 8.5],
    [cx - 8.5, cy + 8.5, cx - 6.4, cy + 6.4],
  ].forEach((line) => addLine(svg, ...line, 'weather-glyph-ray'));
}

function drawCloud(svg, { compact = false } = {}) {
  addPath(
    svg,
    compact
      ? 'M14 32h20a7 7 0 0 0 .3-14 11 11 0 0 0-20.9-2.7A8.5 8.5 0 0 0 14 32Z'
      : 'M11.5 31.5h25a7.5 7.5 0 0 0 .4-15A12.5 12.5 0 0 0 13 13.2a9.2 9.2 0 0 0-1.5 18.3Z',
    'weather-glyph-cloud'
  );
}

function drawRain(svg, { heavy = false, mixed = false } = {}) {
  drawCloud(svg);
  const drops = heavy ? [12, 19, 26, 33, 40] : [16, 25, 34];
  drops.forEach((x, index) => {
    if (mixed && index === 1) return;
    addLine(svg, x, 36, x - (heavy ? 2 : 1.5), heavy ? 44 : 42, 'weather-glyph-precip');
  });
}

function drawSnowflake(svg, cx, cy, radius = 4) {
  addLine(svg, cx, cy - radius, cx, cy + radius, 'weather-glyph-precip');
  addLine(svg, cx - radius, cy, cx + radius, cy, 'weather-glyph-precip');
  addLine(
    svg,
    cx - radius * 0.72,
    cy - radius * 0.72,
    cx + radius * 0.72,
    cy + radius * 0.72,
    'weather-glyph-precip'
  );
  addLine(
    svg,
    cx + radius * 0.72,
    cy - radius * 0.72,
    cx - radius * 0.72,
    cy + radius * 0.72,
    'weather-glyph-precip'
  );
}

function drawLightning(svg, { rainy = false } = {}) {
  drawCloud(svg);
  addPath(svg, 'M27 33h-7l4 5h-4l7 8 3-10h-4Z', 'weather-glyph-bolt');
  if (rainy) {
    addLine(svg, 14, 36, 12.5, 43, 'weather-glyph-precip');
    addLine(svg, 38, 36, 36.5, 43, 'weather-glyph-precip');
  }
}

function drawWind(svg) {
  addPath(svg, 'M7 17h23c6 0 6-8 0-8-3.2 0-4.7 2-4.7 4', 'weather-glyph-wind');
  addPath(svg, 'M7 25h31c6 0 6 9 0 9-3.2 0-4.8-2-4.8-4', 'weather-glyph-wind');
  addPath(svg, 'M7 33h15', 'weather-glyph-wind');
}

function drawWeatherGlyph(svg, condition) {
  switch (condition) {
    case 'sunny':
      drawSun(svg, { cx: 24, cy: 24, radius: 7 });
      break;
    case 'clear-night':
      addPath(svg, 'M33 35A16 16 0 0 1 20 9a17 17 0 1 0 13 26Z', 'weather-glyph-fill');
      addCircle(svg, 35, 13, 1.5, 'weather-glyph-fill');
      addCircle(svg, 39, 21, 1, 'weather-glyph-fill');
      break;
    case 'partlycloudy':
      drawSun(svg, { cx: 17, cy: 16, radius: 5 });
      drawCloud(svg, { compact: true });
      break;
    case 'cloudy':
      drawCloud(svg);
      break;
    case 'rainy':
      drawRain(svg);
      break;
    case 'pouring':
      drawRain(svg, { heavy: true });
      break;
    case 'snowy':
      drawCloud(svg);
      drawSnowflake(svg, 17, 40, 4);
      drawSnowflake(svg, 32, 40, 4);
      break;
    case 'snowy-rainy':
      drawRain(svg, { mixed: true });
      drawSnowflake(svg, 25, 40, 4);
      break;
    case 'hail':
      drawCloud(svg);
      [16, 25, 34].forEach((x) => addCircle(svg, x, 40, 2, 'weather-glyph-hail'));
      break;
    case 'lightning':
      drawLightning(svg);
      break;
    case 'lightning-rainy':
      drawLightning(svg, { rainy: true });
      break;
    case 'fog':
      addPath(svg, 'M9 18h30M6 25h34M10 32h29M15 39h22', 'weather-glyph-fog');
      break;
    case 'windy':
      drawWind(svg);
      break;
    case 'windy-variant':
      drawCloud(svg, { compact: true });
      addPath(svg, 'M6 36h21M9 42h28', 'weather-glyph-wind');
      break;
    case 'exceptional':
      addPath(svg, 'M24 7 44 41H4L24 7Z', 'weather-glyph-alert');
      addLine(svg, 24, 18, 24, 30, 'weather-glyph-alert-mark');
      addCircle(svg, 24, 36, 1.4, 'weather-glyph-fill');
      break;
    default:
      addCircle(svg, 24, 24, 17, 'weather-glyph-unknown');
      addPath(svg, 'M18 19a6 6 0 1 1 8 5.7c-2 1-2 2.1-2 4.3', 'weather-glyph-unknown');
      addCircle(svg, 24, 35, 1.4, 'weather-glyph-fill');
  }
}

function normalizeWeatherCondition(condition) {
  const normalized = String(condition || '')
    .trim()
    .toLowerCase()
    .replace(/[\s_]+/g, '-');

  if (WEATHER_CONDITION_ALIASES.has(normalized)) {
    return WEATHER_CONDITION_ALIASES.get(normalized);
  }

  if (normalized.includes('thunder') || normalized.includes('storm')) {
    return normalized.includes('rain') ? 'lightning-rainy' : 'lightning';
  }
  if (normalized.includes('pour')) return 'pouring';
  if (normalized.includes('rain') && normalized.includes('snow')) return 'snowy-rainy';
  if (normalized.includes('rain')) return 'rainy';
  if (normalized.includes('snow') || normalized.includes('sleet')) return 'snowy';
  if (normalized.includes('fog') || normalized.includes('mist') || normalized.includes('haze')) {
    return 'fog';
  }
  if (normalized.includes('part') && normalized.includes('cloud')) return 'partlycloudy';
  if (normalized.includes('cloud')) return 'cloudy';
  if (normalized.includes('wind')) return 'windy';
  if (normalized.includes('night')) return 'clear-night';
  if (normalized.includes('sun') || normalized.includes('clear')) return 'sunny';
  return 'unknown';
}

function createWeatherIcon(condition, options = {}) {
  const normalizedCondition = normalizeWeatherCondition(condition);
  const { size = 40, className = '', decorative = true } = options;
  const svg = createSvgNode('svg', {
    width: size,
    height: size,
    viewBox: '0 0 48 48',
    class: `weather-glyph weather-glyph-${normalizedCondition} ${className}`.trim(),
    'data-weather-condition': normalizedCondition,
    focusable: 'false',
  });

  if (decorative) {
    svg.setAttribute('aria-hidden', 'true');
  } else {
    svg.setAttribute('role', 'img');
    svg.setAttribute('aria-label', WEATHER_LABELS[normalizedCondition]);
  }

  drawWeatherGlyph(svg, normalizedCondition);
  return svg;
}

function renderWeatherIcon(container, condition, options = {}) {
  if (!container) return null;
  const normalizedCondition = normalizeWeatherCondition(condition);
  const icon = createWeatherIcon(normalizedCondition, options);
  container.replaceChildren(icon);
  container.dataset.weatherCondition = normalizedCondition;
  return icon;
}

export { createWeatherIcon, normalizeWeatherCondition, renderWeatherIcon, WEATHER_LABELS };

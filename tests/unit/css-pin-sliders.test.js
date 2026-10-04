const fs = require('fs');
const path = require('path');
const { loadAppStylesheets, resolvedValue } = require('../helpers/css-cascade.js');

const css = fs
  .readFileSync(path.resolve(__dirname, '../../styles.css'), 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/\s+/g, ' ');

/** The declarations of the rule whose selector list contains `selector`, outside any media query. */
function ruleFor(selector) {
  const match = [...css.matchAll(/(?:^|[}\s])([^{}@]+)\{([^{}]*)\}/g)].find(([, selectors]) =>
    selectors
      .split(',')
      .map((part) => part.trim())
      .includes(selector)
  );
  expect({ selector, found: Boolean(match) }).toEqual({ selector, found: true });
  return match[2];
}

describe('pin sliders', () => {
  beforeAll(() => {
    loadAppStylesheets(document);
  });

  afterEach(() => {
    document.body.className = '';
    document.body.innerHTML = '';
  });

  // The climate, fan, cover and numeric pins used to carry the browser's own blue slider.
  it('draws the panel sliders themselves, in the pin tint, like the lamp slider', () => {
    const track = ruleFor('.desktop-pin-panel-slider::-webkit-slider-runnable-track');
    expect(track).toContain('var(--desktop-pin-tint-rgb, var(--accent-rgb))');
    expect(track).toContain('var(--range-progress, 0%)');
    expect(track).toContain('var(--slider-dir)');
    expect(ruleFor('.desktop-pin-panel-slider')).toContain('appearance: none');
    expect(ruleFor('.desktop-pin-panel-slider')).not.toContain('accent-color');
    // The lamp's thumb and focus ring are shared, not copied.
    for (const selector of [
      '.desktop-pin-panel-slider::-webkit-slider-thumb',
      '.desktop-pin-panel-slider::-webkit-slider-thumb:hover',
      '.desktop-pin-panel-slider:focus-visible',
    ]) {
      expect(() => ruleFor(selector)).not.toThrow();
      expect(ruleFor(selector)).toBe(ruleFor(selector.replace('panel', 'light')));
    }
  });

  it('is as tall as its thumb, and shrinks with the pin like the lamp slider', () => {
    render('', '<div class="desktop-pin-panel-control" data-layout="compact"></div>');
    const slider = document.createElement('input');
    slider.type = 'range';
    slider.className = 'desktop-pin-panel-slider';
    document.querySelector('.desktop-pin-panel-control').appendChild(slider);
    expect(resolvedValue(slider, 'height')).toBe('14px');
    expect(resolvedValue(slider, '--desktop-pin-slider-thumb-size')).toBe('14px');
    expect(resolvedValue(slider, '--desktop-pin-slider-track-size')).toBe('7px');

    document.querySelector('.desktop-pin-panel-control').dataset.layout = 'micro';
    expect(resolvedValue(slider, '--desktop-pin-slider-thumb-size')).toBe('12px');
    document.querySelector('.desktop-pin-panel-control').dataset.layout = 'spacious';
    expect(resolvedValue(slider, '--desktop-pin-slider-thumb-size')).toBe('16px');
  });

  it('keeps a visible grey track and an accent fill under the Readable preset', () => {
    const track = ruleFor(
      'body.high-contrast .desktop-pin-panel-slider::-webkit-slider-runnable-track'
    );
    expect(track).toContain('var(--accent) var(--range-progress, 0%)');
    expect(track).toContain('#8a8a8a var(--range-progress, 0%)');
    // The input itself stays clear: its track is the pseudo-element's.
    render('high-contrast opaque-panels', '<input type="range" class="desktop-pin-panel-slider">');
    expect(resolvedValue(document.querySelector('input'), 'background')).toBe('transparent');
  });
});

function render(bodyClass, html) {
  document.body.className = bodyClass;
  document.body.innerHTML = html;
}

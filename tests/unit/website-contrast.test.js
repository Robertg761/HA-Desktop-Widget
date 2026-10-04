/** @jest-environment node */
const fs = require('fs');
const path = require('path');

const css = fs.readFileSync(path.resolve(__dirname, '../../website/styles.css'), 'utf8');
const root = css.slice(css.indexOf(':root {'), css.indexOf('}', css.indexOf(':root {')));
const token = (name) => root.match(new RegExp(`--${name}:\\s*(#[0-9a-fA-F]{6})`))?.[1];

function luminance(hex) {
  const channel = (offset) => {
    const value = parseInt(hex.slice(offset, offset + 2), 16) / 255;
    return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(1) + 0.7152 * channel(3) + 0.0722 * channel(5);
}

function contrast(foreground, background) {
  const [lighter, darker] = [luminance(foreground), luminance(background)].sort((a, b) => b - a);
  return (lighter + 0.05) / (darker + 0.05);
}

describe('the website text colours', () => {
  // The small print carries requirements ("Needs Home Assistant 2026.7 or newer", "no Linux ARM
  // build"), so it has to be readable on every surface it sits on, not just the page.
  const surfaces = { page: token('bg'), card: token('bg-raised'), 'code block': '#0d1015' };

  it.each(['text', 'muted', 'faint'])(
    'keeps --%s at 4.5:1 on the page, cards and code blocks',
    (name) => {
      expect(token(name)).toBeDefined();
      for (const [surface, background] of Object.entries(surfaces)) {
        expect({ surface, enough: contrast(token(name), background) >= 4.5 }).toEqual({
          surface,
          enough: true,
        });
      }
    }
  );
});

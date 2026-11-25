/**
 * @jest-environment jsdom
 */

// Colour maths is pure: these tests, and every module that uses it, run against the real thing.
const colorMath = require('../../src/color-math.js');
const { getAccentThemes } = require('../../src/ui-utils.js');
const { SEASONAL_HOLIDAYS } = require('../../src/seasonal-calendar.js');

describe('colour maths', () => {
  describe('hex colours and colour temperature', () => {
    it('should convert six-digit hex colors to RGB channels', () => {
      expect(colorMath.hexToRgb('#1A2B3C')).toEqual({ r: 26, g: 43, b: 60 });
      expect(colorMath.hexToRgb('ffffff')).toEqual({ r: 255, g: 255, b: 255 });
    });

    it('should convert short hex colors to RGB channels', () => {
      expect(colorMath.hexToRgb('#0f8')).toEqual({ r: 0, g: 255, b: 136 });
    });

    it('should reject invalid hex colors', () => {
      expect(colorMath.hexToRgb('#12')).toBeNull();
      expect(colorMath.hexToRgb('#zzzzzz')).toBeNull();
      expect(colorMath.hexToRgb(null)).toBeNull();
    });

    it('should convert mired values to rounded Kelvin values', () => {
      expect(colorMath.miredsToKelvin(500)).toBe(2000);
      expect(colorMath.miredsToKelvin(153)).toBe(6536);
    });

    it('should reject invalid mired values', () => {
      expect(colorMath.miredsToKelvin(0)).toBeNull();
      expect(colorMath.miredsToKelvin(-100)).toBeNull();
      expect(colorMath.miredsToKelvin('not-a-number')).toBeNull();
    });

    it('normalizes a hex colour to six upper-case digits, or rejects it', () => {
      expect(colorMath.normalizeHexColor(' #abc ')).toBe('#AABBCC');
      expect(colorMath.normalizeHexColor('1a2b3c')).toBe('#1A2B3C');
      expect(colorMath.normalizeHexColor('#12345')).toBeNull();
      expect(colorMath.normalizeHexColor('#123456; color: red')).toBeNull();
      expect(colorMath.normalizeHexColor(null)).toBeNull();
    });

    it('mixes two colours and measures the WCAG contrast between them', () => {
      const black = { r: 0, g: 0, b: 0 };
      const white = { r: 255, g: 255, b: 255 };
      expect(colorMath.mixRgb(black, white, 0.5)).toEqual({ r: 128, g: 128, b: 128 });
      expect(colorMath.mixRgb(black, white, 0)).toEqual(black);
      expect(colorMath.contrastBetween(black, white)).toBeCloseTo(21, 5);
      expect(colorMath.contrastBetween(white, black)).toBeCloseTo(21, 5);
      expect(colorMath.contrastBetween(white, white)).toBe(1);
    });
  });

  describe('tile colours', () => {
    it('solves the accent values of a tile colour for both themes', () => {
      const style = colorMath.getTileColorStyle('#5f62ef');
      expect(style.color).toBe('#5F62EF');
      expect(style.tone).toBe('cool');
      expect(style.properties).toMatchObject({
        '--tile-accent': '#5F62EF',
        '--tile-accent-rgb': '95, 98, 239',
        '--tile-on-accent': '#ffffff',
        '--tile-accent-text-dark': colorMath.getAccentTextOnDark({ r: 95, g: 98, b: 239 }),
        '--tile-accent-text-light': colorMath.getAccentTextOnLight({ r: 95, g: 98, b: 239 }),
      });
      // Indigo is too dark to read as text on the dark tiles; the solved text colour is lifted.
      expect(style.properties['--tile-accent-text-dark']).not.toBe('rgb(95, 98, 239)');
    });

    it('marks a grey and a red or amber as the stylesheet treats such accents', () => {
      expect(colorMath.getTileColorStyle('#94a3b8').tone).toBe('neutral');
      expect(colorMath.getTileColorStyle('#f43f5e').tone).toBe('warm');
      expect(colorMath.getTileColorStyle('#f59e0b').tone).toBe('warm');
      expect(colorMath.getTileColorStyle('#10b981').tone).toBe('cool');
    });

    it('takes nothing that is not a hex colour', () => {
      expect(colorMath.getTileColorStyle('red')).toBeNull();
      expect(colorMath.getTileColorStyle('#12345')).toBeNull();
      expect(colorMath.getTileColorStyle('#123456; color: red')).toBeNull();
      expect(colorMath.getTileColorStyle(null)).toBeNull();
    });
  });

  describe('accent text colours', () => {
    const luminance = (r, g, b) => {
      const linear = (c) => {
        const v = c / 255;
        return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
      };
      return 0.2126 * linear(r) + 0.7152 * linear(g) + 0.0722 * linear(b);
    };
    const contrastOnLight = (rgbString) => {
      const [r, g, b] = rgbString.match(/\d+/g).map(Number);
      return (luminance(250, 250, 250) + 0.05) / (luminance(r, g, b) + 0.05);
    };

    it('puts dark text on light accents and white text on dark ones', () => {
      expect(colorMath.getReadableTextColor({ r: 100, g: 181, b: 246 })).toBe('#0a0c10');
      expect(colorMath.getReadableTextColor({ r: 250, g: 204, b: 21 })).toBe('#0a0c10');
      expect(colorMath.getReadableTextColor({ r: 30, g: 41, b: 120 })).toBe('#ffffff');
    });

    it('darkens any accent enough to read as text on the light theme', () => {
      [
        { r: 100, g: 181, b: 246 },
        { r: 34, g: 211, b: 238 },
        { r: 255, g: 235, b: 59 },
        { r: 148, g: 163, b: 184 },
      ].forEach((accent) => {
        expect(contrastOnLight(colorMath.getAccentTextOnLight(accent))).toBeGreaterThanOrEqual(4.8);
      });
      // An accent that already reads well is left alone.
      expect(colorMath.getAccentTextOnLight({ r: 30, g: 41, b: 120 })).toBe('rgb(30, 41, 120)');
    });

    const channels = (rgbString) => {
      const [r, g, b] = rgbString.match(/\d+/g).map(Number);
      return { r, g, b };
    };
    const contrast = (first, second) => {
      const [lighter, darker] = [
        luminance(first.r, first.g, first.b),
        luminance(second.r, second.g, second.b),
      ].sort((a, b) => b - a);
      return (lighter + 0.05) / (darker + 0.05);
    };
    const mixed = (base, other, amount) => ({
      r: base.r + (other.r - base.r) * amount,
      g: base.g + (other.g - base.g) * amount,
      b: base.b + (other.b - base.b) * amount,
    });
    const presets = () => getAccentThemes().map((theme) => colorMath.hexToRgb(theme.color));
    const seasonal = () =>
      SEASONAL_HOLIDAYS.map((holiday) => colorMath.hexToRgb(holiday.colors.accent));
    // Colours a user can pick: dark, saturated, and the extremes.
    const custom = () =>
      ['#ab1234', '#1a237e', '#000000', '#ffffff', '#ffff00'].map(colorMath.hexToRgb);

    // The lightest dark surface accent text sits on is a main view tile; the darkest light one is
    // the veiled panel. The accent's own tint (secondary buttons, the active tab, a lit tile) lies
    // on top of it.
    const DARK_TILE = { r: 44, g: 47, b: 54 };
    const LIGHT_PANEL = { r: 228, g: 228, b: 228 };

    it('lightens any accent enough to read as text on the dark theme tiles', () => {
      for (const accent of [...presets(), ...seasonal(), ...custom()]) {
        const text = channels(colorMath.getAccentTextOnDark(accent));
        expect(contrast(text, DARK_TILE)).toBeGreaterThanOrEqual(4.5);
        expect(contrast(text, mixed(DARK_TILE, accent, 0.18))).toBeGreaterThanOrEqual(4.5);
      }
    });

    it('leaves an accent that already reads on the dark tiles as it is', () => {
      expect(colorMath.getAccentTextOnDark({ r: 34, g: 211, b: 238 })).toBe('rgb(34, 211, 238)');
      // The raw indigo is 2.9:1 there, and the solved text is a lighter indigo, not white.
      const indigo = channels(colorMath.getAccentTextOnDark(colorMath.hexToRgb('#5f62ef')));
      expect(indigo.b).toBeGreaterThan(indigo.r);
      expect(indigo.r).toBeGreaterThan(95);
    });

    it('darkens any accent enough to read on the veiled light panel, tint included', () => {
      for (const accent of [...presets(), ...seasonal(), ...custom()]) {
        const text = channels(colorMath.getAccentTextOnLight(accent));
        expect(contrast(text, LIGHT_PANEL)).toBeGreaterThanOrEqual(4.5);
        expect(contrast(text, mixed(LIGHT_PANEL, accent, 0.14))).toBeGreaterThanOrEqual(4.5);
      }
    });

    it('keeps the white label of every preset at 4.5:1 or better', () => {
      for (const accent of presets()) {
        const label = colorMath.hexToRgb(colorMath.getReadableTextColor(accent));
        expect(contrast(label, accent)).toBeGreaterThanOrEqual(4.5);
      }
    });

    it('steps a hover fill the way that keeps its label readable', () => {
      const light = { r: 100, g: 181, b: 246 };
      const indigo = colorMath.hexToRgb('#5f62ef');
      const violet = colorMath.hexToRgb('#8b5cf6');
      const WHITE = '#ffffff';
      const BLACK = '#0a0c10';

      // A dark label on a light fill: lighter on dark, and darker on light only as far as it holds.
      expect(colorMath.getAccentHoverColor(light, BLACK, false).r).toBeGreaterThan(light.r);
      expect(colorMath.getAccentHoverColor(light, BLACK, true).r).toBeLessThan(light.r);
      // A white label on indigo would lose contrast on a lighter fill, so dark hovers darken it too.
      expect(colorMath.getAccentHoverColor(indigo, WHITE, false).b).toBeLessThan(indigo.b);

      for (const [accent, label, isLight] of [
        [light, BLACK, true],
        [light, BLACK, false],
        [indigo, WHITE, true],
        [indigo, WHITE, false],
        [violet, BLACK, true],
        [violet, BLACK, false],
        ...presets().map((rgb) => [rgb, colorMath.getReadableTextColor(rgb), true]),
        ...presets().map((rgb) => [rgb, colorMath.getReadableTextColor(rgb), false]),
      ]) {
        const hover = colorMath.getAccentHoverColor(accent, label, isLight);
        const labelRgb = colorMath.hexToRgb(label);
        expect(contrast(labelRgb, hover)).toBeGreaterThanOrEqual(
          Math.min(4.5, contrast(labelRgb, accent)) - 0.001
        );
      }
    });

    it('names the tone the stylesheet gives an accent', () => {
      expect(colorMath.getAccentTone(colorMath.hexToRgb('#94a3b8'))).toBe('neutral');
      expect(colorMath.getAccentTone(colorMath.hexToRgb('#f43f5e'))).toBe('warm');
      expect(colorMath.getAccentTone(colorMath.hexToRgb('#10b981'))).toBe('cool');
      // A grey has no hue, whatever its channels lean toward.
      expect(colorMath.getAccentTone(colorMath.hexToRgb('#8a7f7c'))).toBe('neutral');
    });
  });
});

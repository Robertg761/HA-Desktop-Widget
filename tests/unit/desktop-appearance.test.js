/** @jest-environment jsdom */
jest.mock('../../src/ui-utils.js', () => ({
  // The colour helpers are pure; the apply* calls are what the tests watch.
  ...(() => {
    const { contrastBetween, hexToRgb, mixRgb } = jest.requireActual('../../src/ui-utils.js');
    return { contrastBetween, hexToRgb, mixRgb };
  })(),
  applyTheme: jest.fn(),
  applyAccentTheme: jest.fn(),
  applyBackgroundTheme: jest.fn(),
  applyAccentThemeFromColor: jest.fn(),
  applyBackgroundThemeFromColor: jest.fn(),
  applyWindowEffects: jest.fn(),
  getSeasonalColors: jest.fn(() => null),
}));

let applyDesktopAppearance;
let theme;
let systemThemeChanged;
const palette = {
  mode: 'dark',
  background: '#112233',
  foreground: '#eeeeee',
  accent: '#ffaa00',
  border: '#cccccc',
  selection: '#445566',
};
beforeEach(() => {
  jest.resetModules();
  document.body.className = '';
  document.body.removeAttribute('style');
  document.documentElement.removeAttribute('style');
  window.matchMedia = jest.fn(() => ({
    addEventListener: (_event, callback) => {
      systemThemeChanged = callback;
    },
  }));
  ({ applyDesktopAppearance } = require('../../src/desktop-appearance.js'));
  theme = require('../../src/ui-utils.js');
});

test.each([
  { ui: {} },
  { ui: { followOmarchy: true }, desktopAppearance: null },
  { ui: { followOmarchy: false }, desktopAppearance: palette },
])(
  'leaves existing appearance and native dragging alone without an active Omarchy palette: %j',
  (config) => {
    document.body.style.setProperty('--text-primary', '#123456');
    document.documentElement.style.setProperty('--window-bg-rgb', '1, 2, 3');
    applyDesktopAppearance(config);
    expect(document.body.style.getPropertyValue('--text-primary')).toBe('#123456');
    expect(document.documentElement.style.getPropertyValue('--window-bg-rgb')).toBe('1, 2, 3');
    expect(document.body.classList.contains('layer-drag-enabled')).toBe(false);
    expect(theme.applyTheme).not.toHaveBeenCalled();
    expect(theme.applyAccentThemeFromColor).not.toHaveBeenCalled();
  }
);

test('only enables custom dragging when the main process grants that capability', () => {
  for (const capabilities of [
    { layerMode: true, canDrag: false },
    { layerMode: false },
    undefined,
  ]) {
    applyDesktopAppearance({ desktopCapabilities: capabilities });
    expect(document.body.classList.contains('layer-drag-enabled')).toBe(false);
  }
  applyDesktopAppearance({ desktopCapabilities: { layerMode: true, canDrag: true } });
  expect(document.body.classList.contains('layer-drag-enabled')).toBe(true);
});

test('marks a window the main process says is drawn on the CPU, for the seasonal art', () => {
  applyDesktopAppearance({ desktopCapabilities: { softwareRendering: true } });
  expect(document.body.classList.contains('software-rendering')).toBe(true);
  applyDesktopAppearance({ desktopCapabilities: { softwareRendering: false } });
  expect(document.body.classList.contains('software-rendering')).toBe(false);
  applyDesktopAppearance({});
  expect(document.body.classList.contains('software-rendering')).toBe(false);
});

test('removes its palette overrides when theme following is disabled', () => {
  applyDesktopAppearance({ ui: { followOmarchy: true }, desktopAppearance: palette });
  expect(document.body.style.getPropertyValue('--text-primary')).toBe('#eeeeee');
  applyDesktopAppearance({ ui: { followOmarchy: false }, desktopAppearance: palette });
  expect(document.body.style.getPropertyValue('--text-primary')).toBe('');
});

describe('the borders a followed palette draws', () => {
  // The palette's own border colour is a solid one (its foreground, for most themes), which drew
  // every field, swatch and divider as a bright outline beside cards with a faint glass edge.
  test('are hairlines in the palette foreground, as faint as the stock ones', () => {
    applyDesktopAppearance({ ui: { followOmarchy: true }, desktopAppearance: palette });
    const body = document.body.style;
    expect(body.getPropertyValue('--border-color')).toBe(
      'color-mix(in srgb, #eeeeee 10%, transparent)'
    );
    expect(body.getPropertyValue('--border-hover')).toBe(
      'color-mix(in srgb, #eeeeee 20%, transparent)'
    );
    // Not the opaque colour the palette named.
    expect(body.getPropertyValue('--border-color')).not.toContain(palette.border);
    expect(body.getPropertyValue('--selection-bg')).toBe(palette.selection);
  });

  test('follow a light palette in its own foreground', () => {
    applyDesktopAppearance({
      ui: { followOmarchy: true },
      desktopAppearance: {
        ...palette,
        mode: 'light',
        foreground: '#222222',
        background: '#fafafa',
      },
    });
    expect(document.body.style.getPropertyValue('--border-color')).toBe(
      'color-mix(in srgb, #222222 10%, transparent)'
    );
  });

  test('go back to the stylesheet when the palette is released', () => {
    applyDesktopAppearance({ ui: { followOmarchy: true }, desktopAppearance: palette });
    applyDesktopAppearance({ ui: { followOmarchy: false }, desktopAppearance: palette });
    for (const name of ['--border-color', '--border-hover', '--selection-bg']) {
      expect(document.body.style.getPropertyValue(name)).toBe('');
    }
  });
});

test('selected text in a field uses the palette selection colour', () => {
  const css = require('fs').readFileSync(
    require('path').join(__dirname, '../../styles.css'),
    'utf8'
  );
  expect(css).toMatch(
    /input::selection,\s*textarea::selection\s*\{\s*background:\s*var\(--selection-bg, rgba\(var\(--accent-rgb\), 0\.35\)\);/
  );
});

test('system theme changes preserve the selected accent and background in auto mode', () => {
  applyDesktopAppearance({ ui: { theme: 'auto', accent: 'rose', background: 'slate' } });
  systemThemeChanged();
  expect(theme.applyTheme).toHaveBeenCalledWith('auto');
  expect(theme.applyAccentTheme).toHaveBeenCalledWith('rose');
  expect(theme.applyBackgroundTheme).toHaveBeenCalledWith('slate');
});

test('system theme changes leave an explicit theme alone', () => {
  applyDesktopAppearance({ ui: { theme: 'light' } });
  systemThemeChanged();
  expect(theme.applyTheme).not.toHaveBeenCalled();
});

test('holiday colours win over the palette, which keeps its text colours', () => {
  const { reapplyDesktopAppearance } = require('../../src/desktop-appearance.js');
  const config = {
    ui: { followOmarchy: true, accent: 'rose', background: 'slate' },
    desktopAppearance: palette,
  };
  theme.getSeasonalColors.mockReturnValue({ accent: '#f97316', background: '#6d28d9' });
  applyDesktopAppearance(config);
  expect(theme.applyTheme).toHaveBeenCalledWith('dark');
  expect(theme.applyAccentTheme).toHaveBeenCalledWith('rose');
  expect(theme.applyBackgroundTheme).toHaveBeenCalledWith('slate');
  expect(theme.applyAccentThemeFromColor).not.toHaveBeenCalled();
  expect(document.documentElement.style.getPropertyValue('--window-bg-rgb')).toBe('');
  expect(document.body.style.getPropertyValue('--text-primary')).toBe('#eeeeee');

  // Once the holiday ends, re-applying the same config brings the palette back.
  theme.getSeasonalColors.mockReturnValue(null);
  reapplyDesktopAppearance();
  expect(theme.applyAccentThemeFromColor).toHaveBeenCalledWith('#ffaa00');
  expect(document.documentElement.style.getPropertyValue('--window-bg-rgb')).toBe('17, 34, 51');
});

test('redraws the window effects when the system theme flips under them', () => {
  // The glass alphas depend on the light or dark theme, so the flip has to be followed by them.
  const calls = [];
  theme.applyTheme.mockImplementation((mode) => calls.push(`theme:${mode}`));
  theme.applyWindowEffects.mockImplementation(() => calls.push('effects'));
  const config = { frostedGlass: true, ui: { theme: 'auto' } };
  applyDesktopAppearance(config);
  // The callers draw the effects after the palette; applying the appearance alone leaves them.
  expect(theme.applyWindowEffects).not.toHaveBeenCalled();

  systemThemeChanged();
  expect(calls).toEqual(['theme:auto', 'effects']);
  expect(theme.applyWindowEffects).toHaveBeenCalledWith(config);
});

test('leaves the window effects alone when the theme is not following the system', () => {
  applyDesktopAppearance({ ui: { theme: 'dark' } });
  systemThemeChanged();
  expect(theme.applyWindowEffects).not.toHaveBeenCalled();
});

describe('the quiet text tones of an Omarchy palette', () => {
  const { contrastBetween, hexToRgb, mixRgb } = jest.requireActual('../../src/ui-utils.js');
  // A mid-tone foreground is what the old flat tokens failed on: Tokyo Night, One Dark and the
  // light Catppuccin and Rose Pine themes, plus a plain dark and a plain light one.
  const palettes = {
    'tokyo-night': { mode: 'dark', foreground: '#a9b1d6', background: '#1a1b26' },
    'one-dark': { mode: 'dark', foreground: '#abb2bf', background: '#282c34' },
    'catppuccin-latte': { mode: 'light', foreground: '#4c4f69', background: '#eff1f5' },
    'rose-pine-dawn': { mode: 'light', foreground: '#575279', background: '#faf4ed' },
    'plain-dark': { mode: 'dark', foreground: '#f5f5f5', background: '#12161e' },
    'plain-light': { mode: 'light', foreground: '#1a1a1a', background: '#fafafa' },
  };
  const TONES = [
    '--text-secondary',
    '--text-tertiary',
    '--muted-text',
    '--palette-text-dim',
    '--palette-text-faint',
  ];
  const channels = (rgbString) => {
    const [r, g, b] = rgbString.match(/\d+/g).map(Number);
    return { r, g, b };
  };
  const surfaceOf = ({ mode, background }) =>
    mode === 'light'
      ? mixRgb(hexToRgb(background), { r: 0, g: 0, b: 0 }, 0.09)
      : mixRgb(hexToRgb(background), { r: 255, g: 255, b: 255 }, 0.13);

  test.each(Object.entries(palettes))('every tone reads on the tile (%s)', (_, palette) => {
    applyDesktopAppearance({
      ui: { followOmarchy: true },
      desktopAppearance: { ...palette, accent: '#ffaa00', border: '#cccccc', selection: '#445566' },
    });
    for (const name of TONES) {
      const tone = channels(document.body.style.getPropertyValue(name));
      const surface = surfaceOf(palette);
      const ratio = contrastBetween(tone, surface);
      // A foreground that cannot reach 4.5:1 on its own is used as it is; the others reach it.
      const foregroundRatio = contrastBetween(hexToRgb(palette.foreground), surface);
      expect({ name, ratio: ratio >= Math.min(4.5, foregroundRatio) - 0.01 }).toEqual({
        name,
        ratio: true,
      });
    }
  });

  test.each(Object.entries(palettes))(
    'keeps the order from primary to faint (%s)',
    (_, palette) => {
      applyDesktopAppearance({
        ui: { followOmarchy: true },
        desktopAppearance: {
          ...palette,
          accent: '#ffaa00',
          border: '#cccccc',
          selection: '#445566',
        },
      });
      const distance = (name) => {
        const tone = channels(document.body.style.getPropertyValue(name));
        const background = hexToRgb(palette.background);
        return Math.abs(tone.r - background.r) + Math.abs(tone.g - background.g);
      };
      const order = ['--text-secondary', '--text-tertiary', '--palette-text-faint'].map(distance);
      // Each is at least as far from the background (as strong) as the one after it.
      expect(order[0]).toBeGreaterThanOrEqual(order[1]);
      expect(order[1]).toBeGreaterThanOrEqual(order[2]);
      expect(document.body.style.getPropertyValue('--text-primary')).toBe(palette.foreground);
    }
  );

  test('gives every tone back when the palette is released', () => {
    applyDesktopAppearance({
      ui: { followOmarchy: true },
      desktopAppearance: {
        ...palettes['tokyo-night'],
        accent: '#ffaa00',
        border: '#ccc',
        selection: '#456',
      },
    });
    expect(document.body.style.getPropertyValue('--text-secondary')).toMatch(/^rgb\(/);
    applyDesktopAppearance({ ui: { followOmarchy: false } });
    for (const name of [...TONES, '--text-primary', '--text-color']) {
      expect(document.body.style.getPropertyValue(name)).toBe('');
    }
  });
});

import {
  applyAccentTheme,
  applyBackgroundTheme,
  applyAccentThemeFromColor,
  applyBackgroundThemeFromColor,
  applyTheme,
  applyWindowEffects,
  contrastBetween,
  getSeasonalColors,
  hexToRgb,
  mixRgb,
} from './ui-utils.js';

let currentConfig = null;
let paletteApplied = false;
// The palette's foreground is the primary text colour as it is.
const FOREGROUND_PROPERTIES = ['--text-color', '--text-primary'];
// The quieter text tones come from the foreground and background, so a palette that has only one
// text colour still has a hierarchy. Each starts at its share of the foreground (the rest being the
// background) and gets stronger until it reads. --palette-text-dim and --palette-text-faint are
// what --text-dim and --text-faint pick up when they are set (see styles.css).
const QUIET_TEXT_SHARES = {
  '--text-secondary': 0.8,
  '--text-tertiary': 0.72,
  '--muted-text': 0.7,
  '--palette-text-dim': 0.68,
  '--palette-text-faint': 0.62,
};
const MIN_TEXT_CONTRAST = 4.5;
// Borders in the stylesheet are hairlines: the text colour at 10% (20% on hover), white on dark and
// black on light. A palette's own border colour is a full-strength colour for terminal-style
// borders, which drew every field, swatch and divider as a bright outline beside cards that keep
// their faint glass edge. The same shares of the palette's foreground keep the weight.
const BORDER_SHARE = 10;
const BORDER_HOVER_SHARE = 20;
const paletteProperties = [
  ...FOREGROUND_PROPERTIES,
  ...Object.keys(QUIET_TEXT_SHARES),
  '--border-color',
  '--border-hover',
  '--selection-bg',
];

/**
 * The quiet text tones for a palette, each the weakest mix of its foreground and background that
 * still clears 4.5:1 on the surface it sits on: the main view's tile, which is the background
 * lifted a little in a dark palette and veiled a little in a light one. A foreground that cannot
 * reach 4.5:1 itself is used as it is.
 * @param {{mode: string, foreground: string, background: string}} palette
 * @returns {Record<string, string>} rgb() strings by property name; empty for unusable colours.
 */
function solveQuietText(palette) {
  const foreground = hexToRgb(palette.foreground);
  const background = hexToRgb(palette.background);
  if (!foreground || !background) return {};
  const surface =
    palette.mode === 'light'
      ? mixRgb(background, { r: 0, g: 0, b: 0 }, 0.09)
      : mixRgb(background, { r: 255, g: 255, b: 255 }, 0.13);
  const tones = {};
  for (const [name, nominal] of Object.entries(QUIET_TEXT_SHARES)) {
    let tone = foreground;
    for (let share = nominal; share <= 1.0001; share += 0.02) {
      tone = mixRgb(background, foreground, Math.min(1, share));
      if (contrastBetween(tone, surface) >= MIN_TEXT_CONTRAST) break;
    }
    tones[name] = `rgb(${tone.r}, ${tone.g}, ${tone.b})`;
  }
  return tones;
}

// Callers draw the window effects after this: the glass alphas depend on whether the light or the
// dark theme is showing, which a palette decides here.
export function applyDesktopAppearance(config) {
  currentConfig = config;
  const body = document.body;
  document.body.classList.toggle(
    'layer-drag-enabled',
    config.desktopCapabilities?.canDrag === true
  );
  // Drawn on the CPU: the seasonal art holds still (styles.css, src/seasonal-effects.js).
  document.body.classList.toggle(
    'software-rendering',
    config.desktopCapabilities?.softwareRendering === true
  );
  // Leave ordinary desktop styles alone until this module has applied a palette.
  if (paletteApplied) paletteProperties.forEach((name) => body.style.removeProperty(name));
  paletteApplied = false;
  if (!config.ui?.followOmarchy || !config.desktopAppearance) return;
  paletteApplied = true;
  const palette = config.desktopAppearance;
  applyTheme(palette.mode);
  if (getSeasonalColors()) {
    // Holiday colours win over the palette while a holiday lasts. The theme calls paint them in
    // the palette's light or dark mode; the palette still sets text, borders and selection.
    applyAccentTheme(config.ui?.accent || 'original');
    applyBackgroundTheme(config.ui?.background || 'original');
  } else {
    applyAccentThemeFromColor(palette.accent);
    applyBackgroundThemeFromColor(palette.background);
    const rgb = palette.background
      .slice(1)
      .match(/../g)
      .map((value) => parseInt(value, 16))
      .join(', ');
    document.documentElement.style.setProperty('--window-bg-rgb', rgb);
    body.style.setProperty('--frosted-bg-rgb', rgb);
  }
  for (const name of FOREGROUND_PROPERTIES) body.style.setProperty(name, palette.foreground);
  for (const [name, tone] of Object.entries(solveQuietText(palette))) {
    body.style.setProperty(name, tone);
  }
  body.style.setProperty(
    '--border-color',
    `color-mix(in srgb, ${palette.foreground} ${BORDER_SHARE}%, transparent)`
  );
  body.style.setProperty(
    '--border-hover',
    `color-mix(in srgb, ${palette.foreground} ${BORDER_HOVER_SHARE}%, transparent)`
  );
  body.style.setProperty('--selection-bg', palette.selection);
}

/** Re-apply the last config, for when something it depends on (the holiday colours) changes. */
export function reapplyDesktopAppearance() {
  if (currentConfig) applyDesktopAppearance(currentConfig);
}

// System auto mode should react immediately rather than waiting for a config save.
const query = window.matchMedia?.('(prefers-color-scheme: dark)');
query?.addEventListener?.('change', () => {
  if (currentConfig && (currentConfig.ui?.theme || 'auto') === 'auto') {
    applyTheme('auto');
    applyAccentTheme(currentConfig.ui?.accent || 'original');
    applyBackgroundTheme(currentConfig.ui?.background || 'original');
    applyDesktopAppearance(currentConfig);
    // The theme flipped under the saved window effects, whose alphas follow it.
    applyWindowEffects(currentConfig);
  }
});

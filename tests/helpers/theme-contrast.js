/**
 * WCAG contrast of the stylesheet's text tokens on its surfaces, for every theme and accent.
 *
 * Nothing is hard-coded: the app's own stylesheets are loaded into jsdom, the real
 * applyTheme/applyBackgroundTheme/applyAccentTheme functions run (they set the accent, on-accent
 * and accent-text tokens inline, as the renderer does), and tokens are resolved through the
 * cascade helper, so a token change in styles.css or ui-utils.js moves the numbers.
 *
 * Surfaces are the opaque colours text is actually drawn on, ignoring wallpaper show-through
 * (frosted glass cannot be measured statically): the window, the main view's panel (the window
 * with its veil, which is what the page tabs and section labels sit on), a Quick Access tile over
 * the window, a main view tile over the panel, a dialog pane over its backstop, and the accent
 * tint behind secondary buttons.
 */
const {
  contrastRatio,
  loadAppStylesheets,
  parseColor,
  resolvedValue,
} = require('./css-cascade.js');
const {
  applyAccentTheme,
  applyAccentThemeFromColor,
  applyBackgroundTheme,
  applyTheme,
  applyUiPreferences,
  getAccentThemes,
} = require('../../src/ui-utils.js');
const { SEASONAL_HOLIDAYS } = require('../../src/seasonal-calendar.js');

// WCAG 2.x: 4.5:1 for body text, 3:1 for large text and non-text parts of controls (focus rings).
const TEXT_MINIMUM = 4.5;
const NON_TEXT_MINIMUM = 3;

const SCOPES = {
  dark: { theme: 'dark', highContrast: false },
  light: { theme: 'light', highContrast: false },
  // The readable preset forces one dark palette and one accent whichever theme sits beneath it.
  'high-contrast': { theme: 'dark', highContrast: true },
  'high-contrast-light': { theme: 'light', highContrast: true },
};

// Colours a user can pick that the presets do not cover: the holiday accents, the extremes, and
// the dark and the saturated picks that fall short as text before they are solved.
const EXTRA_ACCENTS = [
  ...SEASONAL_HOLIDAYS.map((holiday) => holiday.colors.accent),
  '#ab1234',
  '#1a237e',
  '#000000',
  '#ffffff',
  '#ffff00',
  '#808080',
];

// Tokens whose value does not depend on the accent.
const TEXT_TOKENS = [
  '--text-color',
  '--text-primary',
  '--text-secondary',
  '--text-tertiary',
  '--muted-text',
  '--text-dim',
  '--text-faint',
];
// A status colour is a fill first and text second. Once a theme defines a --<name>-text variant
// for readable text, that is the token measured; until then the raw colour is.
const STATUS_TOKENS = ['--success', '--warning', '--danger', '--error'];
const SURFACES = ['window', 'panel', 'tile', 'dash tile', 'dialog'];

function resetDocument() {
  document.documentElement.removeAttribute('style');
  document.body.removeAttribute('style');
  document.body.className = '';
}

function textToken(name) {
  return resolvedValue(document.body, `${name}-text`) ? `${name}-text` : name;
}

function token(name) {
  const value = resolvedValue(document.body, name);
  if (!value) throw new Error(`${name} did not resolve; the contrast guard needs updating`);
  return value;
}

/** An opaque rgb() for `foreground` painted over the opaque `background`. */
function over(foreground, background) {
  const [r, g, b, alpha] = parseColor(foreground);
  const base = parseColor(background);
  const mixed = [r, g, b].map((channel, index) => channel * alpha + base[index] * (1 - alpha));
  return `rgb(${mixed.join(', ')})`;
}

function currentSurfaces(highContrast) {
  const window = `rgb(${token('--window-bg-rgb')})`;
  const tile = over(token('--tile-bg'), window);
  // The veil is black at --panel-veil of the full window opacity (see the solid panel rule). The
  // readable preset paints no veil, and its main view tiles are the plain tile.
  const panel = highContrast ? window : over(`rgba(0, 0, 0, ${token('--panel-veil')})`, window);
  const dashTile = highContrast ? tile : over(token('--dash-tile-bg'), panel);
  // A lit Quick Access tile: the accent's wash over the main view tile.
  const wash = parseFloat(token('--dash-tile-wash')) / 100;
  const [litR, litG, litB] = token('--accent-rgb')
    .split(',')
    .map((channel, index) => {
      const base = parseColor(dashTile)[index];
      return Number(channel) * wash + base * (1 - wash);
    });
  return {
    window,
    panel,
    tile,
    'dash tile': dashTile,
    dialog: over(token('--glass-elevated'), `rgb(${token('--modal-backstop-rgb')})`),
    // Behind a secondary button at rest.
    'accent tint': over(token('--accent-bg'), window),
    'lit tile': `rgb(${litR}, ${litG}, ${litB})`,
  };
}

/** `accent` is a preset id, or a #rrggbb colour applied the way a custom or holiday accent is. */
function applyScope({ theme, highContrast }, accent) {
  resetDocument();
  applyTheme(theme);
  applyUiPreferences({ highContrast });
  applyBackgroundTheme('original');
  if (accent.startsWith('#')) applyAccentThemeFromColor(accent);
  else applyAccentTheme(accent);
}

function measure(checks, key, foreground, background, minimum) {
  checks.push({ key, ratio: contrastRatio(foreground, background), minimum });
}

/** Every checked pair as {key, ratio, minimum}. Keys are what the baseline lists. */
function collectContrastChecks() {
  loadAppStylesheets(document);
  const accents = getAccentThemes();
  const checks = [];
  for (const [scope, config] of Object.entries(SCOPES)) {
    applyScope(config, accents[0].id);
    let surfaces = currentSurfaces(config.highContrast);
    for (const name of [...TEXT_TOKENS, ...STATUS_TOKENS.map(textToken)]) {
      for (const surface of SURFACES) {
        measure(
          checks,
          `${scope}|${name} on ${surface}`,
          token(name),
          surfaces[surface],
          TEXT_MINIMUM
        );
      }
    }

    // The high-contrast preset replaces the accent, so one is enough there.
    const accentIds = [...accents.map((accent) => accent.id), ...EXTRA_ACCENTS];
    for (const accent of config.highContrast ? accentIds.slice(0, 1) : accentIds) {
      applyScope(config, accent);
      surfaces = currentSurfaces(config.highContrast);
      const label = `${scope}|${accent}|`;
      for (const surface of [...SURFACES, 'accent tint']) {
        measure(
          checks,
          `${label}--accent-text on ${surface}`,
          token('--accent-text'),
          surfaces[surface],
          TEXT_MINIMUM
        );
      }
      // The lit tile's glyph is a graphic, not text.
      measure(
        checks,
        `${label}--accent-text on lit tile`,
        token('--accent-text'),
        surfaces['lit tile'],
        NON_TEXT_MINIMUM
      );
      measure(
        checks,
        `${label}--on-accent on --accent`,
        token('--on-accent'),
        token('--accent'),
        TEXT_MINIMUM
      );
      // The hover fill is a lighter or darker accent; the readable preset paints no hover fill.
      if (!config.highContrast) {
        measure(
          checks,
          `${label}--on-accent on --accent-hover`,
          token('--on-accent'),
          token('--accent-hover'),
          TEXT_MINIMUM
        );
      }
      for (const surface of ['window', 'tile', 'dash tile']) {
        measure(
          checks,
          `${label}--focus-ring on ${surface}`,
          token('--focus-ring'),
          surfaces[surface],
          NON_TEXT_MINIMUM
        );
      }
    }
  }
  resetDocument();
  return checks;
}

module.exports = {
  NON_TEXT_MINIMUM,
  SCOPES,
  TEXT_MINIMUM,
  applyScope,
  collectContrastChecks,
  currentSurfaces,
  over,
};

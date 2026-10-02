/**
 * WCAG contrast of the stylesheet's text tokens on its surfaces, for every theme and accent.
 *
 * Nothing is hard-coded: the app's own stylesheets are loaded into jsdom, the real
 * applyTheme/applyBackgroundTheme/applyAccentTheme functions run (they set the accent, on-accent
 * and accent-text tokens inline, as the renderer does), and tokens are resolved through the
 * cascade helper, so a token change in styles.css or ui-utils.js moves the numbers.
 *
 * Surfaces are the opaque colours text is actually drawn on, ignoring wallpaper show-through
 * (frosted glass cannot be measured statically): the window, a Quick Access tile over it, a dialog
 * pane over its backstop, and the accent tint behind secondary buttons.
 */
const {
  contrastRatio,
  loadAppStylesheets,
  parseColor,
  resolvedValue,
} = require('./css-cascade.js');
const {
  applyAccentTheme,
  applyBackgroundTheme,
  applyTheme,
  applyUiPreferences,
  getAccentThemes,
} = require('../../src/ui-utils.js');

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
const SURFACES = ['window', 'tile', 'dialog'];

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

function currentSurfaces() {
  const window = `rgb(${token('--window-bg-rgb')})`;
  return {
    window,
    tile: over(token('--tile-bg'), window),
    dialog: over(token('--glass-elevated'), `rgb(${token('--modal-backstop-rgb')})`),
    // Behind a secondary button at rest.
    'accent tint': over(token('--accent-bg'), window),
  };
}

function applyScope({ theme, highContrast }, accentId) {
  resetDocument();
  applyTheme(theme);
  applyUiPreferences({ highContrast });
  applyBackgroundTheme('original');
  applyAccentTheme(accentId);
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
    let surfaces = currentSurfaces();
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
    for (const accent of config.highContrast ? accents.slice(0, 1) : accents) {
      applyScope(config, accent.id);
      surfaces = currentSurfaces();
      const label = `${scope}|${accent.id}|`;
      for (const surface of [...SURFACES, 'accent tint']) {
        measure(
          checks,
          `${label}--accent-text on ${surface}`,
          token('--accent-text'),
          surfaces[surface],
          TEXT_MINIMUM
        );
      }
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
      for (const surface of ['window', 'tile']) {
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

module.exports = { NON_TEXT_MINIMUM, SCOPES, TEXT_MINIMUM, collectContrastChecks };

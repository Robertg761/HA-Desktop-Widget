/**
 * The Background setting tints the window in both themes. It writes the tinted colours as inline
 * styles on the root, so a rule that declares the same tokens on the body (as the light theme once
 * did) would shadow them and the light window stayed #fafafa whatever was chosen.
 */
const { loadAppStylesheets, resolvedValue } = require('../helpers/css-cascade.js');
const {
  applyBackgroundTheme,
  applyBackgroundThemeFromColor,
  applyTheme,
  getBackgroundThemes,
} = require('../../src/ui-utils.js');

const TINTED_TOKENS = [
  '--window-bg-rgb',
  '--bg-color',
  '--bg-primary',
  '--surface-1',
  '--surface-2',
  '--card-bg',
  '--glass-surface',
  '--glass-elevated',
  '--glass-overlay',
];

function reset(theme) {
  document.documentElement.removeAttribute('style');
  document.body.removeAttribute('style');
  document.body.className = '';
  applyTheme(theme);
}

function snapshot() {
  return TINTED_TOKENS.map((token) => resolvedValue(document.body, token)).join('|');
}

describe('the Background setting', () => {
  beforeAll(() => {
    loadAppStylesheets(document);
  });

  afterEach(() => {
    reset('dark');
    document.body.className = '';
  });

  it.each(['dark', 'light'])('tints every window and pane colour in the %s theme', (theme) => {
    reset(theme);
    applyBackgroundTheme('original');
    const original = snapshot();
    const backgrounds = getBackgroundThemes().filter((entry) => entry.id !== 'original');
    expect(backgrounds.length).toBeGreaterThanOrEqual(9);

    const seen = new Set([original]);
    for (const { id } of backgrounds) {
      applyBackgroundTheme(id);
      const tinted = snapshot();
      // Each preset gives its own window, and none of them is the untinted one.
      expect(seen.has(tinted)).toBe(false);
      seen.add(tinted);
    }
  });

  it('reaches the body in the light theme, where the window colour is read', () => {
    reset('light');
    applyBackgroundTheme('rose');
    const tint = document.documentElement.style.getPropertyValue('--window-bg-rgb');
    expect(tint).not.toBe('250, 250, 250');
    expect(resolvedValue(document.body, '--window-bg-rgb')).toBe(tint);
  });

  it('tints the light window for a custom colour and an Omarchy palette background', () => {
    reset('light');
    applyBackgroundThemeFromColor('#1e3a8a');
    const custom = resolvedValue(document.body, '--window-bg-rgb');
    expect(custom).not.toBe('250, 250, 250');
    // The palette also writes the exact colour straight to the root.
    document.documentElement.style.setProperty('--window-bg-rgb', '239, 241, 245');
    expect(resolvedValue(document.body, '--window-bg-rgb')).toBe('239, 241, 245');
  });

  it('keeps the light defaults before a background is applied', () => {
    reset('light');
    expect(resolvedValue(document.body, '--window-bg-rgb')).toBe('250, 250, 250');
    expect(resolvedValue(document.body, '--surface-2')).toBe('rgba(255, 255, 255, 0.85)');
  });

  it('leaves the frosted glass panes to their own alpha in the light theme', () => {
    reset('light');
    document.body.classList.add('frosted-glass');
    applyBackgroundTheme('rose');
    // Frosted panes take their colour from the body's --frosted-* channels, with their own alpha,
    // so a root declaration cannot have flattened them to the solid panel colour.
    expect(resolvedValue(document.body, '--bg-color')).toMatch(
      /^rgba\(\d+, \d+, \d+, 0\.[0-9]+\)$/
    );
    expect(resolvedValue(document.body, '--bg-color')).not.toBe(
      document.documentElement.style.getPropertyValue('--bg-color')
    );
  });
});

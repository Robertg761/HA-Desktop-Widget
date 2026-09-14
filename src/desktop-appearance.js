import {
  applyAccentTheme,
  applyBackgroundTheme,
  applyAccentThemeFromColor,
  applyBackgroundThemeFromColor,
  applyTheme,
} from './ui-utils.js';

let currentConfig = null;
let paletteApplied = false;
const paletteProperties = [
  '--text-color',
  '--text-primary',
  '--text-secondary',
  '--text-tertiary',
  '--muted-text',
  '--border-color',
  '--selection-bg',
];

export function applyDesktopAppearance(config) {
  currentConfig = config;
  const body = document.body;
  document.body.classList.toggle(
    'layer-drag-enabled',
    config.desktopCapabilities?.canDrag === true
  );
  // Leave ordinary desktop styles alone until this module has applied a palette.
  if (paletteApplied) paletteProperties.forEach((name) => body.style.removeProperty(name));
  paletteApplied = false;
  if (!config.ui?.followOmarchy || !config.desktopAppearance) return;
  paletteApplied = true;
  const palette = config.desktopAppearance;
  applyTheme(palette.mode);
  applyAccentThemeFromColor(palette.accent);
  applyBackgroundThemeFromColor(palette.background);
  const rgb = palette.background
    .slice(1)
    .match(/../g)
    .map((value) => parseInt(value, 16))
    .join(', ');
  document.documentElement.style.setProperty('--window-bg-rgb', rgb);
  body.style.setProperty('--frosted-bg-rgb', rgb);
  for (const name of paletteProperties.slice(0, 5))
    body.style.setProperty(name, palette.foreground);
  body.style.setProperty('--border-color', palette.border);
  body.style.setProperty('--selection-bg', palette.selection);
}

// System auto mode should react immediately rather than waiting for a config save.
const query = window.matchMedia?.('(prefers-color-scheme: dark)');
query?.addEventListener?.('change', () => {
  if (currentConfig && (currentConfig.ui?.theme || 'auto') === 'auto') {
    applyTheme('auto');
    applyAccentTheme(currentConfig.ui?.accent || 'original');
    applyBackgroundTheme(currentConfig.ui?.background || 'original');
    applyDesktopAppearance(currentConfig);
  }
});

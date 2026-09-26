/* global process */
const fs = require('fs');
const path = require('path');
const os = require('os');

// Omarchy 4 themes name the selection colour `selection`; Omarchy 3.3-3.8 themes only have
// `selection_background`. Both are read so either generation of theme gets its real selection.
function parseOmarchyColors(text, { lightModeMarker = false } = {}) {
  if (typeof text !== 'string' || text.length > 65536) return null;
  const colors = {};
  for (const line of text.split('\n')) {
    const match = line.match(/^\s*([a-z0-9_]+)\s*=\s*["'](#[0-9a-f]{6})["']\s*(?:#.*)?$/i);
    if (match) colors[match[1].toLowerCase()] = match[2].toLowerCase();
  }
  if (!colors.background || !colors.foreground || !colors.accent) return null;
  return {
    background: colors.background,
    foreground: colors.foreground,
    accent: colors.accent,
    selection: colors.selection || colors.selection_background || colors.accent,
    border: colors.light_foreground || colors.foreground,
    mode: resolveOmarchyMode(text, colors.background, lightModeMarker),
  };
}

// Same precedence as Omarchy's own omarchy-theme-color: the `mode` key, the legacy
// `theme_type` key, a `light.mode` file beside colors.toml, then background luminance.
function resolveOmarchyMode(text, background, lightModeMarker) {
  for (const key of ['mode', 'theme_type']) {
    const value = text.match(new RegExp(`^\\s*${key}\\s*=\\s*["'](dark|light)["']`, 'im'))?.[1];
    if (value) return value.toLowerCase();
  }
  if (lightModeMarker) return 'light';
  const [r, g, b] = background
    .slice(1)
    .match(/../g)
    .map((value) => parseInt(value, 16));
  return r + g + b > 382 ? 'light' : 'dark';
}

function createOmarchyThemeWatcher({
  home = os.homedir(),
  env = process.env,
  onChange = () => {},
} = {}) {
  // Omarchy 4 keeps the active theme under XDG state; Omarchy 3.3-3.8 kept it under config.
  const themeDirs = [
    path.join(env.XDG_STATE_HOME || path.join(home, '.local/state'), 'omarchy/current/theme'),
    path.join(env.XDG_CONFIG_HOME || path.join(home, '.config'), 'omarchy/current/theme'),
  ];
  const watchedFiles = themeDirs.flatMap((dir) => [
    path.join(dir, 'colors.toml'),
    path.join(dir, 'light.mode'),
  ]);
  let current = null;
  const refresh = () => {
    let next = null;
    for (const dir of themeDirs) {
      try {
        next = parseOmarchyColors(fs.readFileSync(path.join(dir, 'colors.toml'), 'utf8'), {
          lightModeMarker: fs.existsSync(path.join(dir, 'light.mode')),
        });
      } catch {
        /* theme absent */
      }
      if (next) break;
    }
    if (JSON.stringify(next) !== JSON.stringify(current)) {
      current = next;
      onChange(current);
    }
  };
  refresh();
  // Poll file metadata: survives atomic replacement of the entire theme directory.
  for (const file of watchedFiles)
    fs.watchFile(file, { interval: 1500, persistent: false }, refresh);
  return {
    get: () => current,
    stop: () => watchedFiles.forEach((file) => fs.unwatchFile(file, refresh)),
  };
}

module.exports = { parseOmarchyColors, createOmarchyThemeWatcher };

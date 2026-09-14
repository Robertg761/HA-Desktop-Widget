/* global process */
const fs = require('fs');
const path = require('path');
const os = require('os');

function parseOmarchyColors(text) {
  if (typeof text !== 'string' || text.length > 65536) return null;
  const colors = {};
  for (const line of text.split('\n')) {
    const match = line.match(/^\s*([a-z_]+)\s*=\s*["'](#[0-9a-f]{6})["']\s*(?:#.*)?$/i);
    if (match) colors[match[1].toLowerCase()] = match[2].toLowerCase();
  }
  if (!colors.background || !colors.foreground || !colors.accent) return null;
  const mode = text.match(/^\s*mode\s*=\s*["'](dark|light)["']/m)?.[1];
  return {
    background: colors.background,
    foreground: colors.foreground,
    accent: colors.accent,
    selection: colors.selection || colors.accent,
    border: colors.light_foreground || colors.foreground,
    mode: mode || (parseInt(colors.background.slice(1, 3), 16) > 150 ? 'light' : 'dark'),
  };
}

function createOmarchyThemeWatcher({
  home = os.homedir(),
  env = process.env,
  onChange = () => {},
} = {}) {
  const candidates = [
    path.join(
      env.XDG_STATE_HOME || path.join(home, '.local/state'),
      'omarchy/current/theme/colors.toml'
    ),
    path.join(
      env.XDG_CONFIG_HOME || path.join(home, '.config'),
      'omarchy/current/theme/colors.toml'
    ),
  ];
  let current = null;
  const refresh = () => {
    let next = null;
    for (const file of candidates) {
      try {
        next = parseOmarchyColors(fs.readFileSync(file, 'utf8'));
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
  for (const file of candidates) fs.watchFile(file, { interval: 1500, persistent: false }, refresh);
  return {
    get: () => current,
    stop: () => candidates.forEach((file) => fs.unwatchFile(file, refresh)),
  };
}

module.exports = { parseOmarchyColors, createOmarchyThemeWatcher };

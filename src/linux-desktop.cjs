/* global process */
const fs = require('fs');
const path = require('path');
const { appId: APP_ID } = require('../package.json');

// Portal app ids earlier releases registered. A Hyprland bind names the id
// directly (`global, ha_desktop_widget:popup-toggle`), so renaming it orphaned
// every existing bind without a word. The app keeps answering to these on
// Hyprland and tells the user what to change; see legacyPortalBindingNotice.
const LEGACY_PORTAL_APP_IDS = Object.freeze(['ha_desktop_widget']);

function getLaunchAction(argv = process.argv) {
  return argv.includes('--hide') ? 'hide' : argv.includes('--toggle') ? 'toggle' : 'show';
}

function hasIsolatedProfile(argv = process.argv) {
  return argv.some((arg) => /^--(?:user-data-dir|isolated-profile)(?:=|$)/.test(arg));
}

/**
 * Where Hyprland's request socket for this session would be. Hyprland >= 0.40 keeps its sockets
 * under XDG_RUNTIME_DIR; before that they were in /tmp.
 */
function getHyprlandSocketCandidates(env = process.env) {
  const signature = String(env?.HYPRLAND_INSTANCE_SIGNATURE || '').trim();
  if (!signature) return [];
  const runtimeDir = String(env?.XDG_RUNTIME_DIR || '').trim();
  const candidates = [path.join('/tmp', 'hypr', signature, '.socket.sock')];
  if (runtimeDir) candidates.unshift(path.join(runtimeDir, 'hypr', signature, '.socket.sock'));
  return candidates;
}

/**
 * Whether the Hyprland instance named by HYPRLAND_INSTANCE_SIGNATURE is really running. The
 * variable alone is not trusted: `systemctl --user import-environment` commonly leaks it into
 * later sessions on other compositors, so the socket it names has to exist.
 */
function hasLiveHyprlandInstance(env = process.env, exists = fs.existsSync) {
  return getHyprlandSocketCandidates(env).some((candidate) => {
    try {
      return !!exists(candidate);
    } catch {
      return false;
    }
  });
}

/**
 * Is this session Hyprland? XDG_CURRENT_DESKTOP says so on a normal login, but it can be
 * overridden (a custom session script, a launcher), and the layer-shell handoff already accepts the
 * instance signature, so a session that only the signature identifies would otherwise run as a
 * desktop layer with no placement, drag, blur control or shortcut panel.
 */
function isHyprland(env = process.env, exists = fs.existsSync) {
  const desktops = String(env.XDG_CURRENT_DESKTOP || '')
    .toLowerCase()
    .split(':');
  return desktops.includes('hyprland') || hasLiveHyprlandInstance(env, exists);
}

/**
 * Is this a GNOME session (X11 or Wayland)? GNOME has not drawn the legacy XEmbed tray since 3.26,
 * so without a StatusNotifier host (Ubuntu ships one; stock GNOME does not) there is no tray at all.
 */
function isGnome(env = process.env) {
  return String(env.XDG_CURRENT_DESKTOP || '')
    .toLowerCase()
    .split(':')
    .includes('gnome');
}

function isPortalBindingRegistered(binding) {
  return !!binding && (!!binding.trigger || binding.requiresCompositorBinding === true);
}

function hyprlandBinding(accelerator, id, appId = APP_ID, format = 'lua') {
  const keys = String(accelerator)
    .split('+')
    .map((key) => {
      const aliases = {
        Control: 'CTRL',
        Ctrl: 'CTRL',
        Alt: 'ALT',
        Shift: 'SHIFT',
        Super: 'SUPER',
        Meta: 'SUPER',
        CommandOrControl: 'CTRL',
      };
      const normalized = key.trim();
      const names = {
        Space: 'space',
        Esc: 'Escape',
        Enter: 'Return',
        Plus: 'plus',
        Minus: 'minus',
        PageUp: 'Prior',
        PageDown: 'Next',
        Backspace: 'BackSpace',
        Delete: 'Delete',
        MediaPlayPause: 'XF86AudioPlay',
        VolumeUp: 'XF86AudioRaiseVolume',
        VolumeDown: 'XF86AudioLowerVolume',
        VolumeMute: 'XF86AudioMute',
        ',': 'comma',
        '.': 'period',
        '/': 'slash',
        '\\': 'backslash',
        ';': 'semicolon',
        "'": 'apostrophe',
        '[': 'bracketleft',
        ']': 'bracketright',
        '`': 'grave',
        '=': 'equal',
        '-': 'minus',
        '!': 'exclam',
        '@': 'at',
        '#': 'numbersign',
        $: 'dollar',
        '%': 'percent',
        '^': 'asciicircum',
        '&': 'ampersand',
        '*': 'asterisk',
        '(': 'parenleft',
        ')': 'parenright',
        _: 'underscore',
        ':': 'colon',
        '"': 'quotedbl',
        '<': 'less',
        '>': 'greater',
        '?': 'question',
        '{': 'braceleft',
        '}': 'braceright',
        '~': 'asciitilde',
        '|': 'bar',
      };
      const extraModifiers = {
        Command: 'SUPER',
        Cmd: 'SUPER',
        Win: 'SUPER',
        Option: 'ALT',
        CmdOrCtrl: 'CTRL',
      };
      return aliases[normalized] || extraModifiers[normalized] || names[normalized] || normalized;
    });
  if (format === 'hyprlang') {
    const key = keys.at(-1);
    const modifiers = keys.slice(0, -1);
    // Hyprlang has unquoted fields: refuse delimiters, variables, and newlines.
    if (
      !/^[A-Za-z0-9_]+$/.test(key || '') ||
      modifiers.some((modifier) => !['CTRL', 'ALT', 'SHIFT', 'SUPER'].includes(modifier)) ||
      !/^[A-Za-z0-9_.:-]+$/.test(`${appId}:${id}`)
    )
      return '';
    return `bind = ${modifiers.join(' ')}, ${key}, global, ${appId}:${id}`;
  }
  // JSON string quoting is also valid for these ASCII Lua strings. Never emit
  // an entity ID, user key, or command as executable Lua.
  return `hl.bind(${JSON.stringify(keys.join(' + '))}, hl.dsp.global(${JSON.stringify(`${appId}:${id}`)}))`;
}

// One-line migration hint for a shortcut Hyprland delivered through a retired app id.
function legacyPortalBindingNotice({ legacyAppId, id, accelerator = '' } = {}) {
  const binding = accelerator ? hyprlandBinding(accelerator, id) : '';
  return (
    `Hyprland delivered "${id}" through the retired app id "${legacyAppId}". ` +
    `That target still works for now; update the bind to "${APP_ID}:${id}"` +
    (binding ? `, for example: ${binding}` : '.')
  );
}

module.exports = {
  APP_ID,
  LEGACY_PORTAL_APP_IDS,
  legacyPortalBindingNotice,
  getLaunchAction,
  getHyprlandSocketCandidates,
  hasIsolatedProfile,
  hasLiveHyprlandInstance,
  isGnome,
  isHyprland,
  isPortalBindingRegistered,
  hyprlandBinding,
};

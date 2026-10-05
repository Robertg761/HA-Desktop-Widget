/* global process */
const fs = require('fs');
const os = require('os');
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

// The name the Arch package puts on PATH. The .deb links the executable's own name
// (home-assistant-widget, from package.json), and an AppImage gets a link of this name (below).
const COMMAND_NAME = 'ha-desktop-widget';

/**
 * Where an AppImage's command lives: a link in the user's own folder of commands, which
 * ensureAppImageCommandLink (linux-desktop-entry.cjs) keeps pointed at the AppImage that last ran.
 * The AppImage's own file name carries its version ("HA Desktop Widget-4.0.0-linux-x64.AppImage"),
 * and an update installs the next build under its own name and deletes this one, so a key bound to
 * that path would stop working at the first update. A Linux path, whatever system builds it.
 * @param {string} [home]
 */
function getAppImageCommandLink(home = os.homedir()) {
  return path.posix.join(home, '.local', 'bin', COMMAND_NAME);
}

// A word for a shell (and for a compositor's exec line, which goes through one): quoted only when
// it needs to be, as a path with spaces does ("HA Desktop Widget-4.0.0-linux-x64.AppImage").
function shellWord(value) {
  const text = String(value);
  return /^[\w@%+=:,./-]+$/.test(text) ? text : `'${text.replace(/'/g, "'\\''")}'`;
}

// The arguments that pick this widget's profile, so a second launch reaches this instance and not
// the installed one: the single-instance lock lives in the profile.
function getProfileArgs(argv, isPackaged) {
  const args = argv.filter((arg) => arg.startsWith('--user-data-dir='));
  // A run from source with --dev uses a profile of its own beside the installed widget's.
  if (!isPackaged && argv.includes('--dev')) args.push('--dev');
  return args;
}

/**
 * The command a person binds to a key in their window manager to show or hide this widget, as they
 * would type it: `ha-desktop-widget --toggle` for the Arch package, `home-assistant-widget --toggle`
 * for the .deb, the link in ~/.local/bin by its full path for an AppImage (a compositor's PATH may
 * not have that folder), and the executable's path for anything else. A name on PATH, or the link,
 * is used only when it leads to this executable or AppImage; an AppImage without one gets its own
 * path, which lasts until an update renames the file.
 * @param {Object} [options]
 * @param {string[]} [options.argv] - This process's argv, for the profile it runs on.
 * @param {Object} [options.env]
 * @param {string} options.execPath - process.execPath.
 * @param {boolean} options.isPackaged - app.isPackaged.
 * @param {string} [options.appPath] - app.getAppPath(), which a run from source needs.
 * @param {string} [options.home]
 * @param {(file: string) => string} [options.realpath]
 * @returns {string}
 */
function getToggleCommand({
  argv = process.argv,
  env = process.env,
  execPath,
  isPackaged,
  appPath = '',
  home = os.homedir(),
  realpath = fs.realpathSync,
} = {}) {
  const resolve = (file) => {
    try {
      return realpath(file);
    } catch {
      return null;
    }
  };
  // APPIMAGE is set for this process by its AppImage runtime, which runs it from APPDIR. A widget
  // started from inside another AppImage (a terminal or an editor packaged as one) inherits that
  // app's APPIMAGE and APPDIR, and its executable is not in that APPDIR.
  const relative = env.APPDIR ? path.relative(env.APPDIR, execPath) : '';
  const fromThisAppImage =
    !!env.APPIMAGE &&
    (!env.APPDIR || (!!relative && !relative.startsWith('..') && !path.isAbsolute(relative)));
  let launch;
  if (fromThisAppImage) {
    const link = getAppImageCommandLink(home);
    const linked = resolve(link);
    launch = [shellWord(linked && linked === resolve(env.APPIMAGE) ? link : env.APPIMAGE)];
  } else if (!isPackaged) {
    launch = [shellWord(execPath), shellWord(appPath)];
  } else {
    const target = resolve(execPath);
    const dirs = String(env.PATH || '')
      .split(path.delimiter)
      .filter((dir) => path.isAbsolute(dir));
    const name = [COMMAND_NAME, path.basename(execPath)].find((candidate) =>
      dirs.some((dir) => target && resolve(path.join(dir, candidate)) === target)
    );
    launch = [name || shellWord(execPath)];
  }
  return [...launch, ...getProfileArgs(argv, isPackaged).map(shellWord), '--toggle'].join(' ');
}

module.exports = {
  APP_ID,
  LEGACY_PORTAL_APP_IDS,
  legacyPortalBindingNotice,
  getLaunchAction,
  getAppImageCommandLink,
  getHyprlandSocketCandidates,
  getToggleCommand,
  hasIsolatedProfile,
  hasLiveHyprlandInstance,
  isGnome,
  isHyprland,
  isPortalBindingRegistered,
  hyprlandBinding,
};

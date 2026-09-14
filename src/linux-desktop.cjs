/* global process */
const { appId: APP_ID } = require('../package.json');

function getLaunchAction(argv = process.argv) {
  return argv.includes('--hide') ? 'hide' : argv.includes('--toggle') ? 'toggle' : 'show';
}

function hasIsolatedProfile(argv = process.argv) {
  return argv.some((arg) => /^--(?:user-data-dir|isolated-profile)(?:=|$)/.test(arg));
}

function isHyprland(env = process.env) {
  return String(env.XDG_CURRENT_DESKTOP || '')
    .toLowerCase()
    .split(':')
    .includes('hyprland');
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

module.exports = {
  APP_ID,
  getLaunchAction,
  hasIsolatedProfile,
  isHyprland,
  isPortalBindingRegistered,
  hyprlandBinding,
};

/* global process */

/**
 * Keyboard accelerators: the one model behind both hotkey recorders and main's checks.
 *
 * A hotkey is stored as an Electron accelerator string ("Ctrl+Alt+K"), but the same chord has many
 * spellings: the entity recorder used to write Super and the popup recorder Command for the one
 * Meta key, so Command+K and Super+K were stored as two different hotkeys. Everything that has to
 * compare, validate, record or show a hotkey goes through this module, so those spellings meet
 * in one canonical form (modifiers in a fixed order, a lower-case key, CommandOrControl resolved
 * for the platform).
 */

// Dependency-free on purpose: main (CommonJS) and the Vite-built renderer both load this file, and
// source-level `require` calls are not rewritten by the renderer bundle.

const MODIFIER_ORDER = Object.freeze(['ctrl', 'alt', 'shift', 'meta']);

// Every spelling of a modifier that Electron, the platforms and our own earlier recorders use.
// CommandOrControl is the platform's primary key, resolved once the platform is known.
const MODIFIER_ALIASES = Object.freeze({
  ctrl: 'ctrl',
  control: 'ctrl',
  alt: 'alt',
  option: 'alt',
  shift: 'shift',
  meta: 'meta',
  super: 'meta',
  cmd: 'meta',
  command: 'meta',
  win: 'meta',
  windows: 'meta',
  commandorcontrol: 'primary',
  cmdorctrl: 'primary',
});

// Other names for the same key, so "Esc" and "Escape" or "Return" and "Enter" compare equal.
const KEY_ALIASES = Object.freeze({
  esc: 'escape',
  return: 'enter',
  del: 'delete',
  ins: 'insert',
  spacebar: 'space',
  arrowup: 'up',
  arrowdown: 'down',
  arrowleft: 'left',
  arrowright: 'right',
  pgup: 'pageup',
  pgdn: 'pagedown',
});

// What each key is called when shown to a person.
const KEY_DISPLAY_NAMES = Object.freeze({
  escape: 'Esc',
  pageup: 'PageUp',
  pagedown: 'PageDown',
  printscreen: 'PrintScreen',
  numadd: 'NumAdd',
  numsub: 'NumSub',
  nummult: 'NumMult',
  numdiv: 'NumDiv',
  numdec: 'NumDec',
});

// Physical keys that are not a letter, digit or function key, by KeyboardEvent.code. The names are
// the ones Electron's accelerators and uiohook understand. Punctuation is named by its position, so
// Shift+1 records as Shift+1 and not "!".
const NAMED_CODES = Object.freeze({
  Space: 'Space',
  Enter: 'Enter',
  Tab: 'Tab',
  Backspace: 'Backspace',
  Delete: 'Delete',
  Insert: 'Insert',
  Home: 'Home',
  End: 'End',
  PageUp: 'PageUp',
  PageDown: 'PageDown',
  ArrowUp: 'Up',
  ArrowDown: 'Down',
  ArrowLeft: 'Left',
  ArrowRight: 'Right',
  Escape: 'Esc',
  PrintScreen: 'PrintScreen',
  NumpadAdd: 'numadd',
  NumpadSubtract: 'numsub',
  NumpadMultiply: 'nummult',
  NumpadDivide: 'numdiv',
  NumpadDecimal: 'numdec',
  Backquote: '`',
  Minus: '-',
  Equal: '=',
  BracketLeft: '[',
  BracketRight: ']',
  Backslash: '\\',
  Semicolon: ';',
  Quote: "'",
  Comma: ',',
  Period: '.',
  Slash: '/',
});

// KeyboardEvent.key values for the modifier keys themselves.
const MODIFIER_KEY_NAMES = new Set(['Control', 'Shift', 'Alt', 'AltGraph', 'Meta', 'OS']);

// A combination that already belongs to the system or to every application. Registering one as a
// global hotkey would take it from them (Ctrl+C would stop copying everywhere). The Ctrl family
// stays reserved on every platform, because terminals and editors use it everywhere. Entries are
// compared as chords, so "Win+L" is the Meta key's L on Windows only. Linux has no list of its
// own on purpose: the compositor owns its Super bindings (Super+L locks one desktop and moves
// focus in another), and what a person bound there is theirs to give up.
const RESERVED_ACCELERATORS = Object.freeze({
  all: [
    'Ctrl+Alt+Del',
    'Alt+F4',
    'Ctrl+C',
    'Ctrl+V',
    'Ctrl+X',
    'Ctrl+Z',
    'Ctrl+A',
    'Ctrl+S',
    'Ctrl+O',
    'Ctrl+N',
    'Ctrl+W',
    'Ctrl+R',
    'Alt+Tab',
    'Ctrl+Tab',
    'Ctrl+Shift+Tab',
    'Alt+Shift+Tab',
  ],
  win32: ['Win+L', 'Win+R', 'Win+E', 'Win+D', 'Win+M', 'Win+Tab'],
  darwin: [
    'Cmd+Q',
    'Cmd+C',
    'Cmd+V',
    'Cmd+X',
    'Cmd+Z',
    'Cmd+A',
    'Cmd+S',
    'Cmd+O',
    'Cmd+N',
    'Cmd+R',
    'Cmd+W',
    'Cmd+H',
    'Cmd+M',
    'Cmd+Tab',
    'Cmd+Space',
    'Cmd+Shift+3',
    'Cmd+Shift+4',
    'Cmd+Shift+5',
    'Cmd+Alt+Esc',
  ],
});

// What the modifier keys are called on each platform's keyboard, as shown to a person.
const MODIFIER_LABELS = Object.freeze({
  darwin: { ctrl: 'Control', alt: 'Option', shift: 'Shift', meta: 'Cmd' },
  win32: { ctrl: 'Ctrl', alt: 'Alt', shift: 'Shift', meta: 'Win' },
  linux: { ctrl: 'Ctrl', alt: 'Alt', shift: 'Shift', meta: 'Super' },
});

function resolvePlatform(platform) {
  if (typeof platform === 'string' && platform) return platform;
  return typeof process !== 'undefined' && process.platform ? process.platform : 'linux';
}

// A platform with no table of its own (freebsd, a browser) is treated like Linux.
function labelsFor(platform) {
  return MODIFIER_LABELS[resolvePlatform(platform)] || MODIFIER_LABELS.linux;
}

function canonicalKey(token) {
  const lower = token.toLowerCase();
  return KEY_ALIASES[lower] || lower;
}

/**
 * Split an accelerator into its modifiers and its one key.
 *
 * `modifiers` is a sorted list of 'ctrl' | 'alt' | 'shift' | 'meta' with CommandOrControl resolved
 * for `platform`. `valid` is false for an empty string, an empty part ("Ctrl++K") or anything but
 * exactly one non-modifier key; `partial` marks modifiers with no key at all.
 */
function parseAccelerator(accelerator, platform) {
  const empty = { modifiers: [], key: '', valid: false, partial: false };
  if (typeof accelerator !== 'string' || !accelerator.trim()) return empty;
  const primary = resolvePlatform(platform) === 'darwin' ? 'meta' : 'ctrl';
  const modifiers = new Set();
  const keys = [];
  for (const rawPart of accelerator.split('+')) {
    const part = rawPart.trim();
    if (!part) return empty;
    const modifier = MODIFIER_ALIASES[part.toLowerCase()];
    if (modifier) modifiers.add(modifier === 'primary' ? primary : modifier);
    else keys.push(canonicalKey(part));
  }
  return {
    modifiers: MODIFIER_ORDER.filter((name) => modifiers.has(name)),
    key: keys.length === 1 ? keys[0] : '',
    valid: keys.length === 1,
    // Modifiers and no key yet: what the recorder shows while the keys are being pressed.
    partial: keys.length === 0 && modifiers.size > 0,
  };
}

/**
 * One spelling per chord: "Command+K", "Super+K" and "cmd+k" all become "meta+k" and CommandOrControl
 * becomes ctrl or meta by platform. Empty when the text is not a usable accelerator, so two broken
 * values never count as the same hotkey.
 */
function normalizeAccelerator(accelerator, platform) {
  const parsed = parseAccelerator(accelerator, platform);
  return parsed.valid ? [...parsed.modifiers, parsed.key].join('+') : '';
}

/** Whether two accelerators are the same physical chord, whatever their spelling. */
function acceleratorsConflict(first, second, platform) {
  const normalized = normalizeAccelerator(first, platform);
  return !!normalized && normalized === normalizeAccelerator(second, platform);
}

const reservedCache = new Map();

function reservedFor(platform) {
  const name = resolvePlatform(platform);
  if (!reservedCache.has(name)) {
    const list = [...RESERVED_ACCELERATORS.all, ...(RESERVED_ACCELERATORS[name] || [])];
    reservedCache.set(name, new Set(list.map((entry) => normalizeAccelerator(entry, name))));
  }
  return reservedCache.get(name);
}

/**
 * Whether an accelerator may become a global hotkey on `platform`.
 *
 * `reason` says why not: 'format' (not one key plus modifiers), 'modifier' (no Ctrl, Alt or Meta,
 * which would hijack typing: Shift+A is the letter A) or 'reserved' (a system or editing shortcut).
 */
function validateAccelerator(accelerator, platform) {
  const parsed = parseAccelerator(accelerator, platform);
  if (!parsed.valid || !parsed.key) return { valid: false, reason: 'format' };
  if (!parsed.modifiers.some((name) => name !== 'shift')) {
    return { valid: false, reason: 'modifier' };
  }
  if (reservedFor(platform).has(normalizeAccelerator(accelerator, platform))) {
    return { valid: false, reason: 'reserved' };
  }
  return { valid: true, reason: '' };
}

function displayKey(key) {
  if (KEY_DISPLAY_NAMES[key]) return KEY_DISPLAY_NAMES[key];
  if (/^f\d{1,2}$/.test(key)) return key.toUpperCase();
  if (/^num\d$/.test(key)) return `Num${key.slice(3)}`;
  if (key.length === 1) return key.toUpperCase();
  return key.charAt(0).toUpperCase() + key.slice(1);
}

/**
 * An accelerator as the keys are printed on `platform`'s keyboard: "Ctrl+Alt+Super+K" stored by
 * the recorder reads "Control+Option+Cmd+K" on a Mac and "Ctrl+Alt+Win+K" on Windows. Storage is
 * unchanged. Modifiers alone ("Ctrl+Shift", held before the key) read the same way; text that is
 * not an accelerator is returned as it is.
 */
function formatAccelerator(accelerator, platform) {
  const parsed = parseAccelerator(accelerator, platform);
  if (!parsed.valid && !parsed.partial) return typeof accelerator === 'string' ? accelerator : '';
  const labels = labelsFor(platform);
  const names = parsed.modifiers.map((name) => labels[name]);
  return (parsed.key ? [...names, displayKey(parsed.key)] : names).join('+');
}

/** "Ctrl/Alt/Win": the keys a hotkey can start from, for the recorder's hint. */
function formatRequiredModifiers(platform) {
  const labels = labelsFor(platform);
  return [labels.ctrl, labels.alt, labels.meta].join('/');
}

function keyFromCode(code) {
  if (/^Key[A-Z]$/.test(code)) return code.slice(3);
  if (/^Digit\d$/.test(code)) return code.slice(5);
  if (/^Numpad\d$/.test(code)) return `num${code.slice(6)}`;
  const functionKey = /^F(\d{1,2})$/.exec(code);
  if (functionKey && Number(functionKey[1]) >= 1 && Number(functionKey[1]) <= 24) return code;
  return NAMED_CODES[code] || '';
}

// Synthetic events and virtual keyboards can come without a code; their key name is all there is.
function keyFromKeyName(key) {
  if (typeof key !== 'string' || !key || MODIFIER_KEY_NAMES.has(key)) return '';
  if (key === ' ') return 'Space';
  if (key.length === 1) return key.toUpperCase();
  const code = Object.keys(NAMED_CODES).find((name) => name.toLowerCase() === key.toLowerCase());
  return code ? NAMED_CODES[code] : /^F\d{1,2}$/.test(key) ? key : '';
}

/**
 * The accelerator a keydown makes, by physical key: KeyboardEvent.code rather than .key, so Space,
 * the arrows and Shift+digit record as such, a Mac's Option+letter does not turn into a composed
 * glyph, and the key is the one uiohook (which reads keycodes) will see.
 *
 * Returns { accelerator, key, complete, needsModifier }. `accelerator` is what is held so far (the
 * modifiers alone while no key is down). `complete` is a chord that can be registered; with a key
 * but no Ctrl, Alt or Meta, `needsModifier` is true instead, because Shift+A is just typing a capital.
 * The Meta key is "Command" on a Mac and "Super" elsewhere.
 *
 * Known limit: a letter is named by where its key sits, which is right for uiohook but not for a
 * global shortcut on a layout that moves letters. On AZERTY the key printed A sits at KeyQ and
 * records as Q, while Electron registers an accelerator by the character the layout gives it. The
 * entity recorder could take letters and digits from event.key if that ever matters.
 */
function acceleratorFromKeyEvent(event, platform) {
  const parts = [];
  if (event?.ctrlKey) parts.push('Ctrl');
  if (event?.altKey) parts.push('Alt');
  if (event?.shiftKey) parts.push('Shift');
  if (event?.metaKey) parts.push(resolvePlatform(platform) === 'darwin' ? 'Command' : 'Super');
  const code = typeof event?.code === 'string' ? event.code : '';
  const key = code ? keyFromCode(code) : keyFromKeyName(event?.key);
  if (key) parts.push(key);
  const hasModifier = !!(event?.ctrlKey || event?.altKey || event?.metaKey);
  return {
    accelerator: parts.join('+'),
    key,
    complete: !!key && hasModifier,
    needsModifier: !!key && !hasModifier,
  };
}

// Canonical key -> UiohookKey property, for the keys that are not a letter, digit or function key.
const UIOHOOK_KEY_NAMES = Object.freeze({
  space: 'Space',
  enter: 'Enter',
  tab: 'Tab',
  backspace: 'Backspace',
  delete: 'Delete',
  insert: 'Insert',
  escape: 'Escape',
  home: 'Home',
  end: 'End',
  pageup: 'PageUp',
  pagedown: 'PageDown',
  up: 'ArrowUp',
  down: 'ArrowDown',
  left: 'ArrowLeft',
  right: 'ArrowRight',
  printscreen: 'PrintScreen',
  numadd: 'NumpadAdd',
  numsub: 'NumpadSubtract',
  nummult: 'NumpadMultiply',
  numdiv: 'NumpadDivide',
  numdec: 'NumpadDecimal',
  '`': 'Backquote',
  '-': 'Minus',
  '=': 'Equal',
  '[': 'BracketLeft',
  ']': 'BracketRight',
  '\\': 'Backslash',
  ';': 'Semicolon',
  "'": 'Quote',
  ',': 'Comma',
  '.': 'Period',
  '/': 'Slash',
});

/**
 * The key and modifiers of an accelerator in uiohook's terms: { keyName, ctrl, alt, shift, meta },
 * where `keyName` is a property of UiohookKey. Null when the accelerator has no key uiohook knows.
 */
function acceleratorToUiohookParts(accelerator, platform) {
  const parsed = parseAccelerator(accelerator, platform);
  if (!parsed.valid || !parsed.key) return null;
  const { key } = parsed;
  let keyName = UIOHOOK_KEY_NAMES[key] || '';
  if (!keyName && /^[a-z]$/.test(key)) keyName = key.toUpperCase();
  else if (!keyName && /^\d$/.test(key)) keyName = key;
  else if (!keyName && /^num\d$/.test(key)) keyName = `Numpad${key.slice(3)}`;
  else if (!keyName && /^f\d{1,2}$/.test(key) && Number(key.slice(1)) <= 24) {
    keyName = key.toUpperCase();
  }
  if (!keyName) return null;
  return {
    keyName,
    ctrl: parsed.modifiers.includes('ctrl'),
    alt: parsed.modifiers.includes('alt'),
    shift: parsed.modifiers.includes('shift'),
    meta: parsed.modifiers.includes('meta'),
  };
}

module.exports = {
  acceleratorFromKeyEvent,
  acceleratorToUiohookParts,
  acceleratorsConflict,
  formatAccelerator,
  formatRequiredModifiers,
  normalizeAccelerator,
  parseAccelerator,
  validateAccelerator,
};

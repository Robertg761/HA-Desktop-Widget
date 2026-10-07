/**
 * Which entities an entity hotkey can act on, and what it can do to each. A hotkey runs one of the
 * actions Settings offers for its domain (toggle, turn on, press, ...), and a toggle is the one a
 * tile's click runs (ui.js toggleEntity). On any other domain (a sensor, a camera, a thermostat, a
 * media player) the renderer has nothing to run, so a hotkey there would be a global shortcut that
 * does nothing. The Settings list, the tile menu and main all ask here, so they cannot drift apart.
 *
 * A lock's hotkey locks or unlocks, and has no toggle: a chord pressed by mistake, or while the
 * widget is hidden, must not open a door. An Unlock hotkey asks first, as a click on a locked tile
 * does, and brings the widget up to ask (ui.js executeHotkeyAction). A cover or a valve can toggle,
 * as its tile does, or only open or only close, so a garage door can have a hotkey that only shuts.
 */

// Dependency-free on purpose: main (CommonJS) and the Vite-built renderer both load this file.

// What a hotkey on each domain can run, the first being what a new hotkey runs. Settings names
// them (hotkeys.js getActionOptionsForDomain).
const ENTITY_HOTKEY_ACTIONS = Object.freeze({
  light: Object.freeze(['toggle', 'turn_on', 'turn_off', 'brightness_up', 'brightness_down']),
  switch: Object.freeze(['toggle', 'turn_on', 'turn_off']),
  scene: Object.freeze(['turn_on']),
  script: Object.freeze(['turn_on']),
  automation: Object.freeze(['trigger', 'toggle', 'turn_on', 'turn_off']),
  button: Object.freeze(['press']),
  input_button: Object.freeze(['press']),
  input_boolean: Object.freeze(['toggle', 'turn_on', 'turn_off']),
  fan: Object.freeze(['toggle', 'turn_on', 'turn_off', 'increase_speed', 'decrease_speed']),
  cover: Object.freeze(['toggle', 'open', 'close']),
  valve: Object.freeze(['toggle', 'open', 'close']),
  lock: Object.freeze(['lock', 'unlock']),
  humidifier: Object.freeze(['toggle', 'turn_on', 'turn_off']),
  siren: Object.freeze(['toggle', 'turn_on', 'turn_off']),
});

const ENTITY_HOTKEY_DOMAINS = Object.freeze(Object.keys(ENTITY_HOTKEY_ACTIONS));

function getDomain(entityId) {
  if (typeof entityId !== 'string') return '';
  const dot = entityId.indexOf('.');
  return dot > 0 ? entityId.slice(0, dot) : '';
}

/** True when `entityId` belongs to a domain an entity hotkey has an action for. */
function supportsEntityHotkey(entityId) {
  return ENTITY_HOTKEY_DOMAINS.includes(getDomain(entityId));
}

/**
 * What a hotkey on `entityId` runs: the action it was saved with, while its domain offers that,
 * otherwise the domain's first. Older versions saved a lock's hotkey as a toggle (the tile menu
 * did, and so did a bare accelerator), and a lock offers no toggle, so that hotkey locks.
 */
function resolveEntityHotkeyAction(entityId, action) {
  const actions = ENTITY_HOTKEY_ACTIONS[getDomain(entityId)];
  if (!actions) return typeof action === 'string' && action ? action : 'toggle';
  return actions.includes(action) ? action : actions[0];
}

/**
 * The configured entity hotkeys that can act, as [entityId, { hotkey, action }] pairs. A config
 * keeps each as an object or, from older versions, as the accelerator alone, which is a toggle
 * (resolveEntityHotkeyAction says what that runs on a domain without one). One an
 * earlier version let the tile menu save on a sensor or a camera never did anything, so it is left
 * out: it is not registered, and its chord is free for another entity or the popup.
 */
function liveEntityHotkeys(hotkeys) {
  if (!hotkeys || typeof hotkeys !== 'object') return [];
  return Object.entries(hotkeys).flatMap(([entityId, entry]) => {
    if (!supportsEntityHotkey(entityId)) return [];
    const { hotkey, action } =
      entry && typeof entry === 'object' ? entry : { hotkey: entry, action: 'toggle' };
    return typeof hotkey === 'string' && hotkey.trim() ? [[entityId, { hotkey, action }]] : [];
  });
}

module.exports = {
  ENTITY_HOTKEY_ACTIONS,
  ENTITY_HOTKEY_DOMAINS,
  supportsEntityHotkey,
  resolveEntityHotkeyAction,
  liveEntityHotkeys,
};

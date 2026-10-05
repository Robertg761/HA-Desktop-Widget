/**
 * Which entities an entity hotkey can act on. A hotkey runs one of the actions Settings offers for
 * its domain (toggle, turn on, press, ...), and a toggle is the one a tile's click runs
 * (ui.js toggleEntity). On any other domain (a sensor, a camera, a thermostat, a media player) the
 * renderer has nothing to run, so a hotkey there would be a global shortcut that does nothing. The
 * Settings list, the tile menu and main all ask here, so they cannot drift apart.
 *
 * A lock is on the list, as it has been since tile menus could add hotkeys: its hotkey locks and
 * unlocks without the question a click on the tile asks before unlocking, because it can fire while
 * the widget is hidden and nobody would see the question (ui.js confirmThenUnlock).
 */

// Dependency-free on purpose: main (CommonJS) and the Vite-built renderer both load this file.

const ENTITY_HOTKEY_DOMAINS = Object.freeze([
  'light',
  'switch',
  'scene',
  'script',
  'automation',
  'button',
  'input_button',
  'input_boolean',
  'fan',
  'cover',
  'valve',
  'lock',
  'humidifier',
  'siren',
]);

/** True when `entityId` belongs to a domain an entity hotkey has an action for. */
function supportsEntityHotkey(entityId) {
  if (typeof entityId !== 'string') return false;
  const dot = entityId.indexOf('.');
  return dot > 0 && ENTITY_HOTKEY_DOMAINS.includes(entityId.slice(0, dot));
}

/**
 * The configured entity hotkeys that can act, as [entityId, { hotkey, action }] pairs. A config
 * keeps each as an object or, from older versions, as the accelerator alone, which toggles. One an
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

module.exports = { ENTITY_HOTKEY_DOMAINS, supportsEntityHotkey, liveEntityHotkeys };

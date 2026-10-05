/**
 * Which entities an entity hotkey can act on. A hotkey runs one of the actions Settings offers for
 * its domain (toggle, turn on, press, ...); on any other domain the renderer has nothing to run, so
 * a hotkey there would be a global shortcut that does nothing. The Settings list, the tile menu and
 * main's own check all ask here, so they cannot drift apart.
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
]);

/** True when `entityId` belongs to a domain an entity hotkey has an action for. */
function supportsEntityHotkey(entityId) {
  if (typeof entityId !== 'string') return false;
  const dot = entityId.indexOf('.');
  return dot > 0 && ENTITY_HOTKEY_DOMAINS.includes(entityId.slice(0, dot));
}

module.exports = { ENTITY_HOTKEY_DOMAINS, supportsEntityHotkey };

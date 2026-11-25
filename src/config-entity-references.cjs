'use strict';

const { mapEntityIds } = require('../packages/widget-renderer/src/settings-fields.cjs');

/**
 * Replace every persisted reference to one Home Assistant entity ID.
 *
 * The input is treated as an immutable snapshot. This helper is intentionally
 * process-neutral so the Electron main process and browser preview can apply
 * the replacement to their latest authoritative config. Where entity IDs are
 * kept is the settings field registry's business, so every field it types as
 * holding them is covered.
 */
function replaceConfigEntityIdReferences(config, oldEntityId, newEntityId) {
  if (!config || typeof config !== 'object' || Array.isArray(config)) {
    return { config, changed: false };
  }
  if (
    typeof oldEntityId !== 'string' ||
    typeof newEntityId !== 'string' ||
    !oldEntityId ||
    !newEntityId ||
    oldEntityId === newEntityId
  ) {
    return { config, changed: false };
  }

  return mapEntityIds(config, (entityId) => (entityId === oldEntityId ? newEntityId : entityId));
}

module.exports = {
  replaceConfigEntityIdReferences,
};

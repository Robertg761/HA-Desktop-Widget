'use strict';

function replaceArrayEntityId(list, oldEntityId, newEntityId, { dedupe = false } = {}) {
  if (!Array.isArray(list)) return { value: list, changed: false };

  let changed = false;
  const replaced = list.map((item) => {
    const replacement = item === oldEntityId ? newEntityId : item;
    if (replacement !== item) changed = true;
    return replacement;
  });
  if (!changed) return { value: list, changed: false };
  if (!dedupe) return { value: replaced, changed: true };

  const seen = new Set();
  const value = replaced.filter((item) => {
    if (typeof item === 'string') {
      if (seen.has(item)) return false;
      seen.add(item);
    }
    return true;
  });
  return { value, changed: true };
}

function replaceObjectKey(input, oldEntityId, newEntityId) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    return { value: input, changed: false };
  }
  if (!Object.prototype.hasOwnProperty.call(input, oldEntityId)) {
    return { value: input, changed: false };
  }

  const value = {};
  Object.entries(input).forEach(([key, item]) => {
    if (key === oldEntityId) {
      // Preserve an already-configured destination rather than overwriting it
      // with the stale entry when both IDs exist.
      if (!Object.prototype.hasOwnProperty.call(input, newEntityId)) {
        value[newEntityId] = item;
      }
      return;
    }
    value[key] = item;
  });
  return { value, changed: true };
}

/**
 * Replace every persisted reference to one Home Assistant entity ID.
 *
 * The input is treated as an immutable snapshot. This helper is intentionally
 * process-neutral so the Electron main process and browser preview can apply
 * the replacement to their latest authoritative config.
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

  let changed = false;
  let nextConfig = config;
  const assign = (key, value) => {
    if (nextConfig === config) nextConfig = { ...config };
    nextConfig[key] = value;
    changed = true;
  };

  if (config.primaryMediaPlayer === oldEntityId) {
    assign('primaryMediaPlayer', newEntityId);
  }
  if (config.selectedWeatherEntity === oldEntityId) {
    assign('selectedWeatherEntity', newEntityId);
  }

  const favorites = replaceArrayEntityId(config.favoriteEntities, oldEntityId, newEntityId, {
    dedupe: true,
  });
  if (favorites.changed) assign('favoriteEntities', favorites.value);

  if (Array.isArray(config.customTabs)) {
    let customTabsChanged = false;
    const customTabs = config.customTabs.map((tab) => {
      if (!tab || typeof tab !== 'object' || Array.isArray(tab)) return tab;
      const entitySource = Array.isArray(tab.entityIds) ? tab.entityIds : tab.entities;
      const entities = replaceArrayEntityId(entitySource, oldEntityId, newEntityId, {
        dedupe: true,
      });
      if (!entities.changed) return tab;
      customTabsChanged = true;
      const nextTab = { ...tab, entityIds: entities.value };
      delete nextTab.entities;
      return nextTab;
    });
    if (customTabsChanged) assign('customTabs', customTabs);
  }

  if (Array.isArray(config.comparisonGraphs)) {
    let graphsChanged = false;
    const comparisonGraphs = config.comparisonGraphs.map((graph) => {
      if (!graph || typeof graph !== 'object' || Array.isArray(graph)) return graph;
      const entities = replaceArrayEntityId(graph.entityIds, oldEntityId, newEntityId, {
        dedupe: true,
      });
      if (!entities.changed) return graph;
      graphsChanged = true;
      return { ...graph, entityIds: entities.value };
    });
    if (graphsChanged) assign('comparisonGraphs', comparisonGraphs);
  }

  const primaryCards = replaceArrayEntityId(config.primaryCards, oldEntityId, newEntityId);
  if (primaryCards.changed) assign('primaryCards', primaryCards.value);

  for (const key of [
    'desktopPins',
    'customEntityNames',
    'customEntityIcons',
    'tileSpans',
    'quickAccessTileOptions',
  ]) {
    const replacement = replaceObjectKey(config[key], oldEntityId, newEntityId);
    if (replacement.changed) assign(key, replacement.value);
  }

  if (config.globalHotkeys && typeof config.globalHotkeys === 'object') {
    const hotkeys = replaceObjectKey(config.globalHotkeys.hotkeys, oldEntityId, newEntityId);
    if (hotkeys.changed) {
      assign('globalHotkeys', { ...config.globalHotkeys, hotkeys: hotkeys.value });
    }
  }

  if (config.entityAlerts && typeof config.entityAlerts === 'object') {
    const alerts = replaceObjectKey(config.entityAlerts.alerts, oldEntityId, newEntityId);
    if (alerts.changed) {
      assign('entityAlerts', { ...config.entityAlerts, alerts: alerts.value });
    }
  }

  return { config: nextConfig, changed };
}

module.exports = {
  replaceConfigEntityIdReferences,
};

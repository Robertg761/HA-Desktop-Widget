import { t } from './i18n.js';
import pageNames from '../../../src/page-names.cjs';

const { toStoredPages } = pageNames;

const DEFAULT_QUICK_ACCESS_TAB_ID = 'default';
const DEFAULT_QUICK_ACCESS_TAB_NAME = 'All';

function isObject(value) {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function normalizeEntityIds(value) {
  if (!Array.isArray(value)) return [];
  const seen = new Set();
  return value.reduce((acc, entityId) => {
    if (typeof entityId !== 'string') return acc;
    const trimmed = entityId.trim();
    if (!trimmed || seen.has(trimmed)) return acc;
    seen.add(trimmed);
    acc.push(trimmed);
    return acc;
  }, []);
}

function getFavoriteEntityUnion(tabs) {
  const seen = new Set();
  return tabs.reduce((acc, tab) => {
    normalizeEntityIds(tab?.entityIds).forEach((entityId) => {
      if (seen.has(entityId)) return;
      seen.add(entityId);
      acc.push(entityId);
    });
    return acc;
  }, []);
}

// Fallback names are only used for pages that have none, so they follow the active language.
function normalizeTabName(name, fallback = t(DEFAULT_QUICK_ACCESS_TAB_NAME)) {
  if (typeof name !== 'string') return fallback;
  const trimmed = name.trim();
  return trimmed || fallback;
}

function normalizeTabId(id, index) {
  if (typeof id !== 'string') return `${DEFAULT_QUICK_ACCESS_TAB_ID}-${index + 1}`;
  const trimmed = id.trim();
  return trimmed || `${DEFAULT_QUICK_ACCESS_TAB_ID}-${index + 1}`;
}

// Where each id's numbering got to in a set of used ids, so many pages sharing one id are
// numbered in a single pass instead of each counting up from 2 past all the earlier ones.
// Ids are only ever added to a set, so everything below the remembered number stays taken.
const nextSuffixes = new WeakMap();

function makeUniqueTabId(baseId, usedIds) {
  if (!nextSuffixes.has(usedIds)) nextSuffixes.set(usedIds, new Map());
  const suffixes = nextSuffixes.get(usedIds);
  let candidate = baseId;
  if (usedIds.has(candidate)) {
    let suffix = suffixes.get(baseId) || 2;
    candidate = `${baseId}-${suffix}`;
    while (usedIds.has(candidate)) {
      suffix += 1;
      candidate = `${baseId}-${suffix}`;
    }
    suffixes.set(baseId, suffix + 1);
  }
  usedIds.add(candidate);
  return candidate;
}

function normalizeExistingTabs(customTabs) {
  if (!Array.isArray(customTabs)) return [];
  const usedIds = new Set();
  return customTabs.reduce((acc, rawTab, index) => {
    if (!isObject(rawTab)) return acc;
    const baseId = normalizeTabId(rawTab.id, index);
    const id = makeUniqueTabId(baseId, usedIds);
    // A page without a name (or marked as showing the default one) is named for the language now
    // active. It is marked, so that it is stored unnamed and not in the language of the day.
    const isDefaultName = rawTab.nameIsDefault === true || !normalizeTabName(rawTab.name, '');
    const name = isDefaultName
      ? index === 0
        ? t(DEFAULT_QUICK_ACCESS_TAB_NAME)
        : t('View {{index}}', { index: index + 1 })
      : normalizeTabName(rawTab.name, '');
    const entityIds = normalizeEntityIds(
      Array.isArray(rawTab.entityIds) ? rawTab.entityIds : rawTab.entities
    );
    acc.push({ id, name, entityIds, ...(isDefaultName ? { nameIsDefault: true } : {}) });
    return acc;
  }, []);
}

function normalizeQuickAccessConfig(config, options = {}) {
  const source = isObject(config) ? config : {};
  let tabs = normalizeExistingTabs(source.customTabs);

  if (tabs.length === 0) {
    tabs = [
      {
        id: DEFAULT_QUICK_ACCESS_TAB_ID,
        name: t(DEFAULT_QUICK_ACCESS_TAB_NAME),
        nameIsDefault: true,
        entityIds: normalizeEntityIds(source.favoriteEntities),
      },
    ];
  }

  const activeTabId = tabs.some((tab) => tab.id === source.activeTabId)
    ? source.activeTabId
    : tabs[0].id;

  const normalizedConfig = {
    ...source,
    customTabs: tabs,
    activeTabId,
    favoriteEntities: getFavoriteEntityUnion(tabs),
  };

  if (options.withChanged) {
    const changed =
      JSON.stringify({
        customTabs: toStoredPages(source.customTabs),
        activeTabId: source.activeTabId,
        favoriteEntities: source.favoriteEntities,
      }) !==
      JSON.stringify({
        // As stored: a name filled in for the language only is no change to what is saved.
        customTabs: toStoredPages(normalizedConfig.customTabs),
        activeTabId: normalizedConfig.activeTabId,
        favoriteEntities: normalizedConfig.favoriteEntities,
      });
    return { config: normalizedConfig, changed };
  }

  return normalizedConfig;
}

function getActiveQuickAccessTab(config) {
  const normalized = normalizeQuickAccessConfig(config);
  return (
    normalized.customTabs.find((tab) => tab.id === normalized.activeTabId) ||
    normalized.customTabs[0]
  );
}

function addQuickAccessView(config, name, options = {}) {
  const normalized = normalizeQuickAccessConfig(config);
  const idFactory =
    typeof options.idFactory === 'function'
      ? options.idFactory
      : () => `view-${Date.now().toString(36)}`;
  const usedIds = new Set(normalized.customTabs.map((tab) => tab.id));
  const rawId = makeUniqueTabId(normalizeTabId(idFactory(), normalized.customTabs.length), usedIds);
  const nextTabs = [
    ...normalized.customTabs,
    {
      id: rawId,
      name: normalizeTabName(name, t('New View')),
      entityIds: [],
    },
  ];
  return normalizeQuickAccessConfig({
    ...normalized,
    customTabs: nextTabs,
    activeTabId: rawId,
  });
}

function renameQuickAccessView(config, tabId, name) {
  const normalized = normalizeQuickAccessConfig(config);
  const nextName = normalizeTabName(name, '');
  if (!nextName) return normalized;
  return normalizeQuickAccessConfig({
    ...normalized,
    customTabs: normalized.customTabs.map((tab) => {
      if (tab.id !== tabId) return tab;
      // The name shown for an unnamed page, typed back as it is, names nothing: the page stays
      // unnamed rather than keeping today's language for good.
      if (tab.nameIsDefault && tab.name === nextName) return tab;
      const { nameIsDefault: _unnamed, ...named } = tab;
      return { ...named, name: nextName };
    }),
  });
}

function deleteQuickAccessView(config, tabId) {
  const normalized = normalizeQuickAccessConfig(config);
  if (normalized.customTabs.length <= 1) return normalized;
  const nextTabs = normalized.customTabs.filter((tab) => tab.id !== tabId);
  if (nextTabs.length === normalized.customTabs.length) return normalized;
  // Deleting the page on screen moves to its neighbour (the next page, or the previous one when
  // it was last) instead of jumping back to the first page.
  const deletedIndex = normalized.customTabs.findIndex((tab) => tab.id === tabId);
  const activeTabId =
    normalized.activeTabId === tabId
      ? nextTabs[Math.min(deletedIndex, nextTabs.length - 1)].id
      : normalized.activeTabId;
  return normalizeQuickAccessConfig({
    ...normalized,
    customTabs: nextTabs,
    activeTabId,
  });
}

function setActiveQuickAccessView(config, tabId) {
  const normalized = normalizeQuickAccessConfig(config);
  if (!normalized.customTabs.some((tab) => tab.id === tabId)) return normalized;
  return normalizeQuickAccessConfig({
    ...normalized,
    activeTabId: tabId,
  });
}

function moveEntityToQuickAccessView(config, entityId, tabId) {
  const normalized = normalizeQuickAccessConfig(config);
  if (typeof entityId !== 'string' || !entityId.trim()) return normalized;
  const trimmedEntityId = entityId.trim();
  const targetExists = normalized.customTabs.some((tab) => tab.id === tabId);
  const nextTabs = normalized.customTabs.map((tab) => {
    const withoutEntity = tab.entityIds.filter((id) => id !== trimmedEntityId);
    if (targetExists && tab.id === tabId) {
      return {
        ...tab,
        entityIds: withoutEntity.includes(trimmedEntityId)
          ? withoutEntity
          : [...withoutEntity, trimmedEntityId],
      };
    }
    return { ...tab, entityIds: withoutEntity };
  });

  return normalizeQuickAccessConfig({
    ...normalized,
    customTabs: nextTabs,
  });
}

function removeEntityFromQuickAccessViews(config, entityId) {
  return moveEntityToQuickAccessView(config, entityId, null);
}

// Page-scoped add/remove. A duplicated page holds the same entities as its original, so adding or
// removing a tile on one page must leave every other page alone (unlike move, which is exclusive).
function addEntityToQuickAccessView(config, entityId, tabId) {
  const normalized = normalizeQuickAccessConfig(config);
  if (typeof entityId !== 'string' || !entityId.trim()) return normalized;
  const trimmedEntityId = entityId.trim();
  if (!normalized.customTabs.some((tab) => tab.id === tabId)) return normalized;
  return normalizeQuickAccessConfig({
    ...normalized,
    customTabs: normalized.customTabs.map((tab) =>
      tab.id === tabId && !tab.entityIds.includes(trimmedEntityId)
        ? { ...tab, entityIds: [...tab.entityIds, trimmedEntityId] }
        : tab
    ),
  });
}

function removeEntityFromQuickAccessView(config, entityId, tabId) {
  const normalized = normalizeQuickAccessConfig(config);
  if (typeof entityId !== 'string' || !entityId.trim()) return normalized;
  const trimmedEntityId = entityId.trim();
  return normalizeQuickAccessConfig({
    ...normalized,
    customTabs: normalized.customTabs.map((tab) =>
      tab.id === tabId
        ? { ...tab, entityIds: tab.entityIds.filter((id) => id !== trimmedEntityId) }
        : tab
    ),
  });
}

function reorderQuickAccessView(config, tabId, entityIds) {
  const normalized = normalizeQuickAccessConfig(config);
  const targetTab = normalized.customTabs.find((tab) => tab.id === tabId);
  if (!targetTab) return normalized;

  const currentIds = new Set(targetTab.entityIds);
  const ordered = normalizeEntityIds(entityIds).filter((entityId) => currentIds.has(entityId));
  const orderedSet = new Set(ordered);
  const remaining = targetTab.entityIds.filter((entityId) => !orderedSet.has(entityId));

  return normalizeQuickAccessConfig({
    ...normalized,
    customTabs: normalized.customTabs.map((tab) =>
      tab.id === tabId ? { ...tab, entityIds: [...ordered, ...remaining] } : tab
    ),
  });
}

export {
  DEFAULT_QUICK_ACCESS_TAB_ID,
  DEFAULT_QUICK_ACCESS_TAB_NAME,
  addEntityToQuickAccessView,
  addQuickAccessView,
  deleteQuickAccessView,
  getActiveQuickAccessTab,
  getFavoriteEntityUnion,
  moveEntityToQuickAccessView,
  normalizeQuickAccessConfig,
  removeEntityFromQuickAccessView,
  removeEntityFromQuickAccessViews,
  renameQuickAccessView,
  reorderQuickAccessView,
  setActiveQuickAccessView,
};

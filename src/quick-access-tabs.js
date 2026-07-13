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

function normalizeTabName(name, fallback = DEFAULT_QUICK_ACCESS_TAB_NAME) {
  if (typeof name !== 'string') return fallback;
  const trimmed = name.trim();
  return trimmed || fallback;
}

function normalizeTabId(id, index) {
  if (typeof id !== 'string') return `${DEFAULT_QUICK_ACCESS_TAB_ID}-${index + 1}`;
  const trimmed = id.trim();
  return trimmed || `${DEFAULT_QUICK_ACCESS_TAB_ID}-${index + 1}`;
}

function makeUniqueTabId(baseId, usedIds) {
  let candidate = baseId;
  let suffix = 2;
  while (usedIds.has(candidate)) {
    candidate = `${baseId}-${suffix}`;
    suffix += 1;
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
    const name = normalizeTabName(
      rawTab.name,
      index === 0 ? DEFAULT_QUICK_ACCESS_TAB_NAME : `View ${index + 1}`
    );
    const entityIds = normalizeEntityIds(
      Array.isArray(rawTab.entityIds) ? rawTab.entityIds : rawTab.entities
    );
    acc.push({ id, name, entityIds });
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
        name: DEFAULT_QUICK_ACCESS_TAB_NAME,
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
        customTabs: source.customTabs,
        activeTabId: source.activeTabId,
        favoriteEntities: source.favoriteEntities,
      }) !==
      JSON.stringify({
        customTabs: normalizedConfig.customTabs,
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
      name: normalizeTabName(name, 'New View'),
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
    customTabs: normalized.customTabs.map((tab) =>
      tab.id === tabId ? { ...tab, name: nextName } : tab
    ),
  });
}

function deleteQuickAccessView(config, tabId) {
  const normalized = normalizeQuickAccessConfig(config);
  if (normalized.customTabs.length <= 1) return normalized;
  const nextTabs = normalized.customTabs.filter((tab) => tab.id !== tabId);
  if (nextTabs.length === normalized.customTabs.length) return normalized;
  const activeTabId = normalized.activeTabId === tabId ? nextTabs[0].id : normalized.activeTabId;
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
  addQuickAccessView,
  deleteQuickAccessView,
  getActiveQuickAccessTab,
  getFavoriteEntityUnion,
  moveEntityToQuickAccessView,
  normalizeQuickAccessConfig,
  removeEntityFromQuickAccessViews,
  renameQuickAccessView,
  reorderQuickAccessView,
  setActiveQuickAccessView,
};

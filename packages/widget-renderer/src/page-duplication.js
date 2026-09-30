import { addQuickAccessView, normalizeQuickAccessConfig } from './quick-access-tabs.js';
import { normalizeComparisonGraphsConfig } from './comparison-graphs.js';
import { t } from './i18n.js';

function duplicateQuickAccessView(config, tabId, options = {}) {
  const source = normalizeComparisonGraphsConfig(normalizeQuickAccessConfig(config));
  const index = source.customTabs.findIndex((tab) => tab.id === tabId);
  if (index < 0) return source;
  const original = source.customTabs[index];
  const baseName = t('{{name}} copy', { name: original.name });
  const names = new Set(source.customTabs.map((tab) => tab.name));
  let name = baseName;
  for (let suffix = 2; names.has(name); suffix += 1) name = `${baseName} ${suffix}`;
  const next = addQuickAccessView(source, name, options);
  const copy = next.customTabs.pop();
  const graphs = new Map(source.comparisonGraphs.map((graph) => [graph.id, graph]));
  const usedIds = new Set(graphs.keys());
  copy.entityIds = original.entityIds.map((entityId) => {
    const graph = graphs.get(entityId);
    if (!graph) return entityId;
    const base = `${entityId}-copy`;
    let id = base;
    for (let suffix = 2; usedIds.has(id); suffix += 1) id = `${base}-${suffix}`;
    usedIds.add(id);
    next.comparisonGraphs.push({ ...graph, id, entityIds: [...graph.entityIds] });
    return id;
  });
  next.customTabs.splice(index + 1, 0, copy);
  return normalizeQuickAccessConfig(next);
}

export { duplicateQuickAccessView };

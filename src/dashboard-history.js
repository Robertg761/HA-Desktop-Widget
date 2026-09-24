// Only dashboard data belongs in these local backups, never connection credentials.
const FIELDS = [
  'customTabs',
  'favoriteEntities',
  'comparisonGraphs',
  'customEntityNames',
  'customEntityIcons',
  'quickAccessTileOptions',
  'tileSpans',
];
const LIMIT = 20;

function dashboardSnapshot(config) {
  return JSON.parse(
    JSON.stringify(
      Object.fromEntries(
        FIELDS.map((key) => [
          key,
          config?.[key] ??
            (['customTabs', 'favoriteEntities', 'comparisonGraphs'].includes(key) ? [] : {}),
        ])
      )
    )
  );
}

function historyKey(config) {
  try {
    const url = new URL(config?.homeAssistant?.url);
    return `dashboard-history:${url.origin}${url.pathname.replace(/\/+$/, '')}`;
  } catch {
    return 'dashboard-history:local';
  }
}

// The undo state is refreshed on every config update, so the parsed history is kept and only
// re-read when the stored text differs. Comparing the raw string is far cheaper than parsing and
// cloning up to LIMIT layouts each time.
let parsedHistory = null;

function readDashboardHistory(config) {
  try {
    const key = historyKey(config);
    const raw = localStorage.getItem(key) || '[]';
    if (parsedHistory && parsedHistory.key === key && parsedHistory.raw === raw) {
      return [...parsedHistory.entries];
    }
    const entries = JSON.parse(raw);
    const parsed = Array.isArray(entries)
      ? entries
          .filter((entry) => Number.isFinite(entry?.at) && Array.isArray(entry?.layout?.customTabs))
          .slice(0, LIMIT)
          .map((entry) => ({
            at: entry.at,
            layout: dashboardSnapshot(entry.layout),
            // The page on screen when the layout was saved, so a restore can return to it.
            ...(typeof entry.activeTabId === 'string' ? { activeTabId: entry.activeTabId } : {}),
            // Layouts replaced by Undo stay restorable but are skipped by the next Undo.
            ...(entry.undone === true ? { undone: true } : {}),
          }))
      : [];
    parsedHistory = { key, raw, entries: parsed };
    return [...parsed];
  } catch {
    return [];
  }
}

function rememberDashboard(previous, next) {
  const layout = dashboardSnapshot(previous);
  if (
    !Array.isArray(layout.customTabs) ||
    JSON.stringify(layout) === JSON.stringify(dashboardSnapshot(next))
  )
    return;
  const entries = readDashboardHistory(previous);
  const sameAsNewest = JSON.stringify(entries[0]?.layout) === JSON.stringify(layout);
  if (sameAsNewest && !entries[0].undone) return;
  const entry = { at: Date.now(), layout };
  if (typeof previous?.activeTabId === 'string') entry.activeTabId = previous.activeTabId;
  // Editing on from a layout that Undo set aside makes it an ordinary undo step again.
  writeDashboardHistory(previous, [entry, ...(sameAsNewest ? entries.slice(1) : entries)]);
}

function writeDashboardHistory(config, entries) {
  try {
    localStorage.setItem(historyKey(config), JSON.stringify(entries.slice(0, LIMIT)));
    window.dispatchEvent(new Event('dashboard-history-changed'));
  } catch {
    /* Recovery must not prevent ordinary configuration writes. */
  }
}

export { dashboardSnapshot, readDashboardHistory, rememberDashboard, writeDashboardHistory };

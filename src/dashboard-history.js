import pageNames from './page-names.cjs';

const { toStoredPages } = pageNames;

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
// Undo steps back through every saved change, one at a time.
const LIMIT = 20;
// Restore dashboard keeps a coarser list of its own, so a burst of small edits cannot push older
// layouts out of it: changes less than RESTORE_POINT_IDLE_MS apart are one burst. The layout from
// before a burst is kept as it starts, unless it is the newest restore point already, and the
// layout the burst leaves once the dashboard has been idle for RESTORE_POINT_IDLE_MS. Twenty is as
// many rows as the dialog listed when it read the Undo history, so the copy it starts from loses
// none of them, and the two lists together stay far inside the renderer's local storage.
const RESTORE_POINT_LIMIT = 20;
const RESTORE_POINT_IDLE_MS = 30 * 1000;
const HISTORY = 'dashboard-history';
const RESTORE_POINTS = 'dashboard-restore-points';

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

// A layout as the main process keeps it. A page nobody named is shown with the name of the language
// of the day ("Alle") in the layout on screen and kept without one by the main process, so layouts
// are compared as stored: that difference is not an edit and earns no restore point.
function storedLayout(layout) {
  return JSON.stringify({ ...layout, customTabs: toStoredPages(layout.customTabs) });
}

function sameLayout(a, b) {
  return storedLayout(a) === storedLayout(b);
}

function storageKey(list, config) {
  try {
    const url = new URL(config?.homeAssistant?.url);
    return `${list}:${url.origin}${url.pathname.replace(/\/+$/, '')}`;
  } catch {
    return `${list}:local`;
  }
}

// The undo state is refreshed on every config update, so each parsed list is kept and only re-read
// when the stored text differs. Comparing the raw string is far cheaper than parsing and cloning up
// to twenty layouts each time.
const parsedLists = new Map();

function readList(key, limit) {
  const raw = localStorage.getItem(key) || '[]';
  const cached = parsedLists.get(key);
  if (cached && cached.raw === raw) return [...cached.entries];
  const entries = JSON.parse(raw);
  const parsed = Array.isArray(entries)
    ? entries
        .filter((entry) => Number.isFinite(entry?.at) && Array.isArray(entry?.layout?.customTabs))
        .slice(0, limit)
        .map((entry) => ({
          at: entry.at,
          layout: dashboardSnapshot(entry.layout),
          // The page on screen when the layout was saved, so a restore can return to it.
          ...(typeof entry.activeTabId === 'string' ? { activeTabId: entry.activeTabId } : {}),
          // A layout replaced by Undo: Undo skips it next time, and Restore dashboard says so.
          ...(entry.undone === true ? { undone: true } : {}),
        }))
    : [];
  parsedLists.set(key, { raw, entries: parsed });
  return [...parsed];
}

function readDashboardHistory(config) {
  try {
    return readList(storageKey(HISTORY, config), LIMIT);
  } catch {
    return [];
  }
}

// Restore dashboard used to list the Undo history itself. The first time a server's restore points
// are needed after an upgrade they start as a copy of that history, so every layout the dialog
// listed is still there. Returns the copy, or null when the server already has restore points.
function seedRestorePoints(config, key) {
  if (localStorage.getItem(key) !== null) return null;
  const seeded = readDashboardHistory(config).slice(0, RESTORE_POINT_LIMIT);
  try {
    localStorage.setItem(key, JSON.stringify(seeded));
  } catch {
    /* Shown from the history again next time, until there is room to keep them. */
  }
  return seeded;
}

function readRestorePoints(config) {
  try {
    const key = storageKey(RESTORE_POINTS, config);
    return seedRestorePoints(config, key) ?? readList(key, RESTORE_POINT_LIMIT);
  } catch {
    return [];
  }
}

// The latest saved change: the server, when it was saved and the layout it left, which becomes a
// restore point once the dashboard has been idle (keepSettledLayout). The next change belongs to
// the same burst if it comes within RESTORE_POINT_IDLE_MS and starts from that layout.
// A layout changed in between without passing here (a sync, a settings import) starts a new burst,
// so that layout gets a restore point of its own once an edit replaces it, as it always did.
let latestChange = null;
let listeningForClose = false;

function newestIs(points, stored) {
  return !!points[0] && storedLayout(points[0].layout) === stored;
}

// Keeps the layout a burst of edits left as a restore point, dated when it was saved, unless it is
// the newest one already. That happens once the dashboard has been idle for RESTORE_POINT_IDLE_MS,
// when the app closes first, or when the next change shows the layout was replaced in between
// without passing here. A sync or an import that replaces it then cannot take it out of reach.
function keepSettledLayout(change) {
  if (!change || change.kept) return;
  change.kept = true;
  try {
    const points = readRestorePoints(change.config);
    if (newestIs(points, change.stored)) return;
    const point = { at: change.at, layout: change.layout };
    if (change.activeTabId) point.activeTabId = change.activeTabId;
    localStorage.setItem(
      change.key,
      JSON.stringify([point, ...points].slice(0, RESTORE_POINT_LIMIT))
    );
  } catch {
    /* Recovery must not prevent ordinary configuration writes. */
  }
}

function keepRestorePoint(previous, layout, next, { wholeLayout, undone }) {
  try {
    const key = storageKey(RESTORE_POINTS, previous);
    const now = Date.now();
    const replaced = storedLayout(layout);
    const latest = latestChange;
    const fromLatest = latest?.key === key && latest.stored === replaced;
    // Something else replaced the layout the latest change left (or this is another server): keep
    // that layout now, before this change takes the place of the latest one.
    if (!fromLatest) keepSettledLayout(latest);
    const sinceLatest = fromLatest ? now - latest.at : -1;
    const sameBurst = !wholeLayout && sinceLatest >= 0 && sinceLatest < RESTORE_POINT_IDLE_MS;
    const settled = dashboardSnapshot(next);
    const change = {
      // Only the server's address, to find its restore points.
      config: { homeAssistant: { url: previous?.homeAssistant?.url } },
      key,
      at: now,
      layout: settled,
      stored: storedLayout(settled),
    };
    if (typeof next?.activeTabId === 'string') change.activeTabId = next.activeTabId;
    latestChange = change;
    // A change that comes sooner takes this one's place as the latest and starts the wait again.
    setTimeout(() => latestChange === change && keepSettledLayout(change), RESTORE_POINT_IDLE_MS);
    if (!listeningForClose) {
      listeningForClose = true;
      window.addEventListener('pagehide', () => keepSettledLayout(latestChange));
    }
    const points = readRestorePoints(previous);
    if (sameBurst && points.length) return;
    if (newestIs(points, replaced)) {
      // Kept when the dashboard went idle. An Undo of it still says that it set this layout aside.
      if (undone && !points[0].undone) {
        localStorage.setItem(
          key,
          JSON.stringify([{ ...points[0], undone: true }, ...points.slice(1)])
        );
      }
      return;
    }
    const point = { at: now, layout };
    if (typeof previous?.activeTabId === 'string') point.activeTabId = previous.activeTabId;
    if (undone) point.undone = true;
    localStorage.setItem(key, JSON.stringify([point, ...points].slice(0, RESTORE_POINT_LIMIT)));
  } catch {
    /* Recovery must not prevent ordinary configuration writes. */
  }
}

// Keeps the layout a saved change replaced, as an Undo step and for Restore dashboard. Edits close
// together share one restore point. A change that puts a whole saved layout in place (a restore,
// an Undo, a profile from Home Assistant) is not part of a burst: the layout it replaced always
// gets a restore point of its own, and `undone` marks one that Undo replaced.
function rememberDashboard(previous, next, { wholeLayout = false, undone = false } = {}) {
  const layout = dashboardSnapshot(previous);
  if (!Array.isArray(layout.customTabs) || sameLayout(layout, dashboardSnapshot(next))) return;
  keepRestorePoint(previous, layout, next, { wholeLayout: wholeLayout || undone, undone });
  const entries = readDashboardHistory(previous);
  const sameAsNewest = !!entries[0] && sameLayout(entries[0].layout, layout);
  if (sameAsNewest && !entries[0].undone) return;
  const entry = { at: Date.now(), layout };
  if (typeof previous?.activeTabId === 'string') entry.activeTabId = previous.activeTabId;
  // Editing on from a layout that Undo set aside makes it an ordinary undo step again.
  writeDashboardHistory(previous, [entry, ...(sameAsNewest ? entries.slice(1) : entries)]);
}

function writeDashboardHistory(config, entries) {
  try {
    // The restore points start from the history as it was, so they are copied before it changes.
    seedRestorePoints(config, storageKey(RESTORE_POINTS, config));
    localStorage.setItem(storageKey(HISTORY, config), JSON.stringify(entries.slice(0, LIMIT)));
    window.dispatchEvent(new Event('dashboard-history-changed'));
  } catch {
    /* Recovery must not prevent ordinary configuration writes. */
  }
}

export {
  dashboardSnapshot,
  readDashboardHistory,
  readRestorePoints,
  rememberDashboard,
  writeDashboardHistory,
};

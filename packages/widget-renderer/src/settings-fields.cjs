'use strict';

// The settings field registry. Every setting that leaves this computer (a settings file, profile
// sync, a Home Assistant profile), holds entity ids, or has a default or a plain Settings control
// declares itself here once, and everything that needs to know a setting's shape reads it from
// here: the settings file, profile sync's section lists and type checks, Home Assistant profiles,
// entity renames and id repair, new-config defaults and the plain switches and lists in Settings.
// It is plain CommonJS with no dependencies, so the main process, the renderer and the Home
// Assistant panel preview all load the same copy.
//
// A field declares:
// - key: its place in the config, 'name' or 'ui.name'.
// - shape: what it holds (see below). Entity ids are typed as such, which is how renames find them.
// - sync: the profile sync section it travels in. Every shared ui key travels inside `ui`.
// - file: whether a settings file carries it. Every shared ui key travels inside `ui`.
// - haProfile: whether a Home Assistant profile carries it. Every shared ui key travels inside `ui`.
// - localOnly (ui keys): describes this machine or session, so it never leaves it.
// - default: the value an unset field reads as. A new config starts with it unless `seeded` is
//   false, in which case the field stays unset until someone changes it, and keeps following the
//   default until then.
// - control / preview: the element id of a plain switch or list in Settings that shows and edits
//   it, and whether changing that control previews the look straight away.

// A shape is one of:
// - a leaf type: 'string', 'text' (typed by a person, so cut to length rather than refused),
//   'boolean', 'number', 'entityId', 'span' (one to four grid columns), 'seconds' (alert delays),
//   'opacity', 'object' (any JSON object) or 'any'. A trailing '?' allows null; 'a|b' allows either.
// - oneOf(...choices), listOf(shape, options), mapOf(shape), entityMapOf(shape) (keyed by entity
//   id), or a plain object of named fields (a record).
// - looseInSync(shape): profile sync checks only that the value is a list or an object. What is
//   inside was never checked there, so a synced profile an earlier version accepted is not
//   refused now; the app normalizes it after a pull.
const LOOSE_IN_SYNC = Symbol('looseInSync');
const LEGACY_KEYS = Symbol('legacyKeys');
const oneOf = (...choices) => ({ oneOf: choices });
const listOf = (shape, { max = Infinity, unique = false, keep = [] } = {}) => ({
  list: shape,
  max,
  unique,
  keep,
});
const mapOf = (shape) => ({ map: shape });
const entityMapOf = (shape) => ({ map: shape, entityKeys: true });
const looseInSync = (shape) => ({ ...shape, [LOOSE_IN_SYNC]: true });
// A record whose field was stored under another name by an earlier version: { old: 'new' }.
const withLegacyKeys = (record, legacy) => ({ ...record, [LEGACY_KEYS]: legacy });

// What the app itself can produce, with room to spare: names are typed into one-line fields and
// entity ids are at most 255 characters. Text a person types is cut to this length instead of
// failing, so a name saved before its field was limited still exports and imports. Ids and map
// keys are never typed, so a long one is refused.
const MAX_TEXT_LENGTH = 256;
const MIN_OPACITY = 0.5;
const MAX_OPACITY = 1;
// A tile spans one to four grid columns.
const isTileSpan = (value) => Number.isInteger(value) && value >= 1 && value <= 4;
// Alert delays are whole seconds up to a day, as the alert editor enforces.
const isAlertSeconds = (value) => Number.isInteger(value) && value >= 0 && value <= 86400;

// `valid` is a check beyond the JSON type. When a config is exported, a value that fails it is
// repaired (`repair`) or left out rather than blocking the export; a file holding one is refused.
// `syncChecked` values are checked by profile sync too: a span outside one to four reads as damage.
const LEAVES = {
  string: { json: 'string' },
  entityId: { json: 'string' },
  text: { json: 'string' },
  boolean: { json: 'boolean' },
  number: { json: 'number' },
  span: { json: 'number', valid: isTileSpan, syncChecked: true },
  seconds: { json: 'number', valid: isAlertSeconds },
  opacity: {
    json: 'number',
    valid: (value) => value >= MIN_OPACITY && value <= MAX_OPACITY,
    repair: (value) => Math.min(MAX_OPACITY, Math.max(MIN_OPACITY, value)),
  },
  object: { json: 'object' },
  any: { json: null },
};

const SINGLE_ENTITY_ID = 'entityId?';
const ENTITY_LIST = listOf('entityId', { unique: true });
const PAGE = withLegacyKeys(
  { id: 'string', name: 'text', entityIds: ENTITY_LIST },
  {
    entities: 'entityIds',
  }
);
const GRAPH = { id: 'string', name: 'text', span: 'number', entityIds: ENTITY_LIST };
const TILE_OPTIONS = {
  valueSize: 'string',
  cameraPreviewRefresh: 'number|string',
  chartType: 'string',
  gaugeMin: 'number?',
  gaugeMax: 'number?',
  color: 'string',
};
const ALERT_RULE = {
  onStateChange: 'boolean',
  onSpecificState: 'boolean',
  targetState: 'text',
  onNumericThreshold: 'boolean',
  comparison: 'string',
  threshold: 'number?',
  durationSeconds: 'seconds',
  cooldownSeconds: 'seconds',
  // Left out of a rule saved before it existed, which then reads as on.
  notifyOnUnavailable: 'boolean',
  quietHours: { enabled: 'boolean', start: 'string', end: 'string' },
};
const SEASONAL = {
  enabled: 'boolean?',
  colors: 'boolean',
  holidays: mapOf('boolean'),
  show: 'string',
  showUntil: 'number',
};

// Fields go in the order profile sync writes them. Desktop pins, hotkeys and the open Quick Access
// page describe one machine, so they never sync. Always on top, hide on focus loss and the tray
// values do sync, as the scope descriptions in Settings say; Home Assistant profiles and settings
// files leave them out.
const FIELDS = [
  // Quick Access layout
  {
    key: 'favoriteEntities',
    shape: ENTITY_LIST,
    sync: 'quickAccessLayout',
    file: true,
    haProfile: true,
    default: [],
  },
  // Tray entries are normalized after a pull.
  {
    key: 'trayEntities',
    shape: looseInSync(entityMapOf('any')),
    sync: 'quickAccessLayout',
    default: {},
  },
  {
    key: 'customEntityNames',
    shape: entityMapOf('text'),
    sync: 'quickAccessLayout',
    file: true,
    haProfile: true,
  },
  {
    key: 'customEntityIcons',
    shape: entityMapOf('string'),
    sync: 'quickAccessLayout',
    file: true,
    haProfile: true,
    default: {},
  },
  {
    key: 'tileSpans',
    shape: entityMapOf('span'),
    sync: 'quickAccessLayout',
    file: true,
    haProfile: true,
  },
  {
    key: 'quickAccessTileOptions',
    shape: entityMapOf(looseInSync(TILE_OPTIONS)),
    sync: 'quickAccessLayout',
    file: true,
    haProfile: true,
    default: {},
  },
  // The two primary card slots hold an entity or one of the built-in cards.
  {
    key: 'primaryCards',
    shape: listOf('entityId', { max: 2, keep: ['weather', 'time', 'none'] }),
    sync: 'quickAccessLayout',
    file: true,
    haProfile: true,
    default: ['weather', 'time'],
  },
  {
    key: 'customTabs',
    shape: listOf(PAGE),
    sync: 'quickAccessLayout',
    file: true,
    haProfile: true,
    default: [],
  },
  {
    key: 'comparisonGraphs',
    shape: listOf(GRAPH),
    sync: 'quickAccessLayout',
    file: true,
    haProfile: true,
    default: [],
  },
  // Visual personalization
  { key: 'alwaysOnTop', shape: 'boolean', sync: 'visualPersonalization', default: true },
  { key: 'hideOnBlur', shape: 'boolean', sync: 'visualPersonalization', default: false },
  {
    key: 'opacity',
    shape: 'opacity',
    sync: 'visualPersonalization',
    file: true,
    haProfile: true,
    default: 0.95,
  },
  {
    key: 'frostedGlass',
    shape: 'boolean',
    sync: 'visualPersonalization',
    file: true,
    haProfile: true,
    default: true,
  },
  // Its shape is the shared ui keys below; the ui object is never cleared as a whole.
  { key: 'ui', sync: 'visualPersonalization', file: true, haProfile: true },
  // Automation alerts. persistentNotifications (desktop notifications for Home Assistant's own)
  // is absent until someone turns it off; absent means on.
  {
    key: 'entityAlerts',
    shape: {
      enabled: 'boolean',
      persistentNotifications: 'boolean',
      alerts: entityMapOf(looseInSync(ALERT_RULE)),
    },
    sync: 'automationAlerts',
    file: true,
    default: { enabled: false, alerts: {} },
  },
  // Connection and media preferences
  {
    key: 'selectedWeatherEntity',
    shape: SINGLE_ENTITY_ID,
    sync: 'connectionMediaPreferences',
    file: true,
    haProfile: true,
  },
  {
    key: 'primaryMediaPlayer',
    shape: SINGLE_ENTITY_ID,
    sync: 'connectionMediaPreferences',
    file: true,
    haProfile: true,
  },
  // This machine only
  { key: 'activeTabId', shape: 'string', haProfile: true, default: '' },
  { key: 'desktopPins', shape: entityMapOf('any'), default: {} },
  {
    key: 'globalHotkeys',
    shape: { enabled: 'boolean', hotkeys: entityMapOf('any') },
    default: { enabled: false, hotkeys: {} },
  },

  // Shared ui keys. Only their JSON types are checked by profile sync, never their values: a
  // later version may add a theme or a density, and its file must not read as damaged here.
  { key: 'ui.theme', shape: oneOf('auto', 'dark', 'light'), default: 'auto' },
  { key: 'ui.accent', shape: 'string', default: 'original' },
  { key: 'ui.background', shape: 'string', default: 'original' },
  { key: 'ui.language', shape: 'string', default: 'auto' },
  {
    key: 'ui.customColors',
    shape: looseInSync(listOf({ id: 'string', name: 'text', color: 'string' })),
    default: [],
  },
  {
    key: 'ui.density',
    shape: oneOf('comfortable', 'compact'),
    default: 'comfortable',
    control: 'density-select',
    preview: true,
  },
  // Unset follows the language's side, so it has no fixed default.
  { key: 'ui.desktopPinNameAlign', shape: oneOf('left', 'center', 'right') },
  // Opt-out: pins snap until someone turns it off.
  {
    key: 'ui.desktopPinSnap',
    shape: 'boolean',
    default: true,
    seeded: false,
    control: 'desktop-pin-snap',
  },
  // Opt-out: the Right now page is offered until someone turns it off.
  {
    key: 'ui.rightNowPage',
    shape: 'boolean',
    default: true,
    seeded: false,
    control: 'right-now-page',
  },
  // Opt-out rather than opt-in: the glow is how a tile shows it is on.
  {
    key: 'ui.activeTileGlow',
    shape: 'boolean',
    default: true,
    control: 'active-tile-glow',
    preview: true,
  },
  // Set together by the readable preset, and left unset until it is first used.
  { key: 'ui.highContrast', shape: 'boolean', default: false, seeded: false },
  { key: 'ui.opaquePanels', shape: 'boolean', default: false, seeded: false },
  // Kept as an alias of timeFormat for older synced profiles.
  { key: 'ui.use24HourClock', shape: 'boolean', default: false },
  { key: 'ui.timeFormat', shape: oneOf('system', '12-hour', '24-hour'), default: 'system' },
  // Matches the date card shown before date formats were configurable.
  {
    key: 'ui.dateFormat',
    shape: oneOf('system', 'weekday-short', 'long', 'numeric'),
    default: 'weekday-short',
  },
  { key: 'ui.weatherEffectsEnabled', shape: 'boolean', default: false },
  { key: 'ui.weatherOverride', shape: 'string', default: 'auto' },
  // Its default follows reduced motion and high contrast, so it has no fixed one.
  { key: 'ui.seasonal', shape: looseInSync(SEASONAL) },

  // ui keys that describe this machine or session rather than the shared look. Text size and
  // Omarchy theme following depend on this machine's display and desktop.
  { key: 'ui.personalizationSectionsCollapsed', shape: 'object', localOnly: true, default: {} },
  {
    key: 'ui.enableInteractionDebugLogs',
    shape: 'boolean',
    localOnly: true,
    default: false,
    control: 'enable-interaction-debug-logs',
  },
  { key: 'ui.scale', shape: 'number', localOnly: true, default: 1, seeded: false },
  // Only takes effect where an Omarchy palette exists.
  { key: 'ui.followOmarchy', shape: 'boolean', localOnly: true, default: true },
];

const FIELD_BY_KEY = new Map(FIELDS.map((field) => [field.key, field]));
const isUiKey = (key) => key.startsWith('ui.');
const uiName = (key) => key.slice('ui.'.length);
const TOP_FIELDS = FIELDS.filter((field) => !isUiKey(field.key));
const UI_FIELDS = FIELDS.filter((field) => isUiKey(field.key));
const SHARED_UI_FIELDS = UI_FIELDS.filter((field) => !field.localOnly);

/** The ui keys this version shares between computers, and the ones it keeps on this machine. */
const SHARED_UI_KEYS = Object.freeze(SHARED_UI_FIELDS.map((field) => uiName(field.key)));
const LOCAL_ONLY_UI_KEYS = Object.freeze(
  UI_FIELDS.filter((field) => field.localOnly).map((field) => uiName(field.key))
);
const UI_SHAPE = Object.fromEntries(
  SHARED_UI_FIELDS.map((field) => [uiName(field.key), field.shape])
);
const shapeOf = (field) => (field.key === 'ui' ? UI_SHAPE : field.shape);

/** The top-level fields each profile sync section carries, in the order they are written. */
const SYNC_SECTION_FIELDS = Object.freeze(
  TOP_FIELDS.reduce((sections, field) => {
    if (field.sync) sections[field.sync] = [...(sections[field.sync] || []), field.key];
    return sections;
  }, {})
);
/** The top-level fields a Home Assistant profile carries. */
const HA_PROFILE_FIELDS = Object.freeze(
  TOP_FIELDS.filter((field) => field.haProfile).map((field) => field.key)
);
const FILE_SHAPES = Object.fromEntries(
  TOP_FIELDS.filter((field) => field.file && field.key !== 'ui').map((field) => [
    field.key,
    field.shape,
  ])
);

/**
 * The plain Settings controls the registry binds: `path` is the field's key, `id` the control's
 * element id, and `preview` says whether changing it previews the look straight away.
 */
const SETTING_CONTROLS = Object.freeze(
  FIELDS.filter((field) => field.control).map((field) =>
    Object.freeze({ path: field.key, id: field.control, preview: field.preview === true })
  )
);

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
function jsonType(value) {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  if (typeof value === 'number') return Number.isFinite(value) ? 'number' : 'invalid';
  return typeof value;
}
function parseLeaf(shape) {
  return { names: shape.replace(/\?$/, '').split('|'), nullable: shape.endsWith('?') };
}
const clone = (value) => (value === undefined ? undefined : JSON.parse(JSON.stringify(value)));

// ---- Settings files ----

const DROP = Symbol('drop');
function invalidSetting() {
  return Object.assign(new Error('invalid_setting'), { code: 'invalid_setting' });
}
// Cuts at a character boundary: slicing between the halves of a surrogate pair leaves a broken one.
// A lone high surrogate at the cut point is dropped too, which is harmless.
function truncateText(value) {
  if (value.length <= MAX_TEXT_LENGTH) return value;
  const end = /[\uD800-\uDBFF]/.test(value[MAX_TEXT_LENGTH - 1])
    ? MAX_TEXT_LENGTH - 1
    : MAX_TEXT_LENGTH;
  return value.slice(0, end);
}

function projectLeaf(value, shape, repair) {
  const { names, nullable } = parseLeaf(shape);
  if (value === null && nullable) return null;
  const checked = names.length === 1 && LEAVES[names[0]].valid ? LEAVES[names[0]] : null;
  if (checked) {
    if (jsonType(value) === checked.json && checked.valid(value)) return value;
    if (!repair) throw invalidSetting();
    if (!checked.repair) return DROP;
    if (jsonType(value) === checked.json) return checked.repair(value);
    throw invalidSetting();
  }
  const name = names.find((candidate) => LEAVES[candidate].json === jsonType(value));
  if (!name) throw invalidSetting();
  if (name === 'text') return truncateText(value);
  if (typeof value === 'string' && value.length > MAX_TEXT_LENGTH) throw invalidSetting();
  return value;
}

function projectShape(value, shape, repair) {
  if (typeof shape === 'string') return projectLeaf(value, shape, repair);
  if (shape.oneOf) {
    if (shape.oneOf.includes(value)) return value;
    if (repair) return DROP;
    throw invalidSetting();
  }
  if (shape.list) {
    if (!Array.isArray(value)) throw invalidSetting();
    if (value.length > shape.max && !repair) throw invalidSetting();
    return value
      .slice(0, shape.max)
      .map((item) => projectShape(item, shape.list, repair))
      .filter((item) => item !== DROP);
  }
  if (!isObject(value)) throw invalidSetting();
  const entries = shape.map
    ? Object.entries(value)
    : Object.entries(value).filter(([key]) => Object.hasOwn(shape, key));
  return Object.fromEntries(
    entries
      .map(([key, entry]) => {
        if (key.length > MAX_TEXT_LENGTH) throw invalidSetting();
        return [key, projectShape(entry, shape.map || shape[key], repair)];
      })
      .filter(([, entry]) => entry !== DROP)
  );
}

// null marks a portable setting the exporting computer never set, so importing clears it and the
// destination falls back to the same default.
function projectClearable(value, shapes, repair) {
  if (!isObject(value)) throw invalidSetting();
  return Object.fromEntries(
    Object.entries(value)
      .filter(([key]) => Object.hasOwn(shapes, key))
      .map(([key, entry]) => {
        if (entry === null) return [key, null];
        const projected = projectShape(entry, shapes[key], repair);
        return [key, projected === DROP ? null : projected];
      })
  );
}

// A key holding undefined is a setting nobody set (the weather picker's Clear leaves one
// behind until restart), so it is left out rather than failing every export and import.
const withoutUndefined = (object) =>
  Object.fromEntries(Object.entries(object).filter(([, value]) => value !== undefined));
const cleared = (keys) => Object.fromEntries(keys.map((key) => [key, null]));

/**
 * The portable settings in `value`: only the fields a settings file carries, each in its shape.
 * Throws an error with code 'invalid_setting' when a field holds anything else, a list holds more
 * than it may, or a ui value is not one of its choices. The ui object can never be cleared as a
 * whole.
 *
 * With `fromConfig`, `value` is this app's own config being exported: every portable setting it
 * lacks comes out as null, and a value that drifted outside its limits (a span, an alert delay, an
 * opacity, a choice this version does not offer, more primary cards than slots) is clamped or left
 * out rather than failing the export.
 */
function projectPortableSettings(value, { fromConfig = false } = {}) {
  let source = value;
  if (fromConfig) {
    const { ui, ...config } = isObject(value) ? withoutUndefined(value) : {};
    source = {
      ...cleared(Object.keys(FILE_SHAPES)),
      ...config,
      ui: { ...cleared(SHARED_UI_KEYS), ...(isObject(ui) ? withoutUndefined(ui) : {}) },
    };
  }
  const settings = projectClearable(source, { ...FILE_SHAPES, ui: 'object' }, fromConfig);
  if (Object.hasOwn(settings, 'ui'))
    settings.ui = projectClearable(source.ui, UI_SHAPE, fromConfig);
  return settings;
}

// ---- Profile sync ----

function matchesSyncShape(value, shape) {
  if (typeof shape === 'string') {
    return parseLeaf(shape).names.some((name) => {
      const leaf = LEAVES[name];
      if (leaf.json === null) return true;
      return jsonType(value) === leaf.json && (!leaf.syncChecked || leaf.valid(value));
    });
  }
  if (shape.oneOf) return jsonType(value) === jsonType(shape.oneOf[0]);
  if (shape.list) {
    if (!Array.isArray(value)) return false;
    return !!shape[LOOSE_IN_SYNC] || value.every((item) => matchesSyncShape(item, shape.list));
  }
  if (!isObject(value)) return false;
  if (shape[LOOSE_IN_SYNC]) return true;
  if (shape.map) return Object.values(value).every((entry) => matchesSyncShape(entry, shape.map));
  // A field of a record may be left out (the receiving device fills in its default) or null
  // (cleared), but not hold another type.
  return Object.entries(shape).every(
    ([key, fieldShape]) =>
      !Object.hasOwn(value, key) || value[key] === null || matchesSyncShape(value[key], fieldShape)
  );
}

/**
 * Whether a synced top-level field's non-null value has the shape the app relies on. Only JSON
 * types are checked, never values (except a tile span's one to four columns), and ui keys this
 * version does not know pass, so a later version's file never reads as damaged.
 */
function hasSyncShape(key, value) {
  const field = FIELD_BY_KEY.get(key);
  if (!field?.sync) return false;
  return matchesSyncShape(value, shapeOf(field));
}

// ---- Entity ids ----

function holdsEntityIds(shape) {
  if (typeof shape === 'string') return parseLeaf(shape).names.includes('entityId');
  if (shape.oneOf) return false;
  if (shape.list) return holdsEntityIds(shape.list);
  if (shape.map) return !!shape.entityKeys || holdsEntityIds(shape.map);
  return Object.values(shape).some(holdsEntityIds);
}

function mapList(list, shape, mapId) {
  if (!Array.isArray(list)) return list;
  const seen = new Set();
  const next = [];
  list.forEach((item) => {
    const mapped = shape.keep.includes(item) ? item : mapShapeEntityIds(item, shape.list, mapId);
    if (shape.unique && typeof mapped === 'string') {
      if (seen.has(mapped)) return;
      seen.add(mapped);
    }
    next.push(mapped);
  });
  const same = next.length === list.length && next.every((item, index) => item === list[index]);
  return same ? list : next;
}

function mapMap(map, shape, mapId) {
  if (!isObject(map)) return map;
  const walkValues = holdsEntityIds(shape.map);
  let changed = false;
  const next = {};
  Object.entries(map).forEach(([key, entry]) => {
    const nextKey = shape.entityKeys ? mapId(key) : key;
    const nextEntry = walkValues ? mapShapeEntityIds(entry, shape.map, mapId) : entry;
    if (nextKey !== key || nextEntry !== entry) changed = true;
    // When two keys end up the same, the one that was already right keeps its value.
    if (Object.prototype.hasOwnProperty.call(next, nextKey) && nextKey !== key) return;
    next[nextKey] = nextEntry;
  });
  return changed ? next : map;
}

function mapRecord(record, shape, mapId) {
  if (!isObject(record)) return record;
  const legacy = Object.entries(shape[LEGACY_KEYS] || {});
  let next = record;
  Object.entries(shape).forEach(([key, fieldShape]) => {
    if (!holdsEntityIds(fieldShape)) return;
    // A value an earlier version stored under another name is read from there, and moves to its
    // current name once it changes.
    const legacyKey = legacy.find(
      ([oldKey, newKey]) => newKey === key && Object.hasOwn(record, oldKey)
    )?.[0];
    const fromLegacy = legacyKey && !Array.isArray(record[key]);
    const source = fromLegacy ? record[legacyKey] : record[key];
    const mapped = mapShapeEntityIds(source, fieldShape, mapId);
    if (mapped === source) return;
    if (next === record) next = { ...record };
    next[key] = mapped;
    if (legacyKey) delete next[legacyKey];
  });
  return next;
}

function mapShapeEntityIds(value, shape, mapId) {
  if (typeof shape === 'string') {
    return holdsEntityIds(shape) && typeof value === 'string' ? mapId(value) : value;
  }
  if (shape.oneOf) return value;
  if (shape.list) return mapList(value, shape, mapId);
  if (shape.map) return mapMap(value, shape, mapId);
  return mapRecord(value, shape, mapId);
}

/**
 * Passes every entity id the config holds through `mapId` (id => id), wherever it is: a single
 * id, a list of them, a map keyed by them, or inside pages, graphs, alerts and hotkeys. Lists of
 * ids keep one copy of each; a map whose keys end up the same keeps the entry whose key was
 * already right. The config is not changed: what changed is copied, and `changed` says whether
 * anything did.
 */
function mapEntityIds(config, mapId) {
  if (!isObject(config)) return { config, changed: false };
  let next = config;
  TOP_FIELDS.forEach((field) => {
    if (!field.shape || !holdsEntityIds(field.shape)) return;
    const mapped = mapShapeEntityIds(config[field.key], field.shape, mapId);
    if (mapped === config[field.key]) return;
    if (next === config) next = { ...config };
    next[field.key] = mapped;
  });
  return { config: next, changed: next !== config };
}

// ---- Defaults and plain controls ----

function readPath(config, key) {
  if (!isObject(config)) return undefined;
  if (!isUiKey(key)) return config[key];
  return isObject(config.ui) ? config.ui[uiName(key)] : undefined;
}
function hasPath(config, key) {
  if (!isUiKey(key)) return Object.hasOwn(config, key);
  return isObject(config.ui) && Object.hasOwn(config.ui, uiName(key));
}
function fieldFor(key) {
  const field = FIELD_BY_KEY.get(key);
  if (!field) throw new Error(`Unknown setting ${key}`);
  return field;
}
const holdsValue = (value, shape) =>
  value !== undefined &&
  value !== null &&
  (shape.oneOf ? shape.oneOf.includes(value) : matchesSyncShape(value, shape));

/** The settings a new config starts with: every field's default, except those left unset. */
function defaultSettings() {
  const settings = { ui: {} };
  FIELDS.forEach((field) => {
    if (field.default === undefined || field.seeded === false) return;
    if (isUiKey(field.key)) settings.ui[uiName(field.key)] = clone(field.default);
    else settings[field.key] = clone(field.default);
  });
  return settings;
}

/** What a setting reads as: its saved value when it has one of its shape, otherwise its default. */
function settingValue(config, key) {
  const field = fieldFor(key);
  const value = readPath(config, key);
  return holdsValue(value, field.shape) ? value : clone(field.default);
}

/**
 * Saves a value a control holds into `config` (changed in place, and returned). A value not of
 * the setting's shape saves its default. A setting a new config leaves unset stays unset while it
 * is at its default, so it keeps following the default until someone changes it.
 */
function storeSetting(config, key, value) {
  const field = fieldFor(key);
  const next = holdsValue(value, field.shape) ? value : clone(field.default);
  if (field.seeded === false && !hasPath(config, key) && next === field.default) return config;
  if (!isUiKey(key)) config[key] = next;
  else config.ui = { ...(isObject(config.ui) ? config.ui : {}), [uiName(key)]: next };
  return config;
}

module.exports = {
  SYNC_SECTION_FIELDS,
  HA_PROFILE_FIELDS,
  SHARED_UI_KEYS,
  LOCAL_ONLY_UI_KEYS,
  SETTING_CONTROLS,
  projectPortableSettings,
  hasSyncShape,
  mapEntityIds,
  defaultSettings,
  settingValue,
  storeSetting,
};

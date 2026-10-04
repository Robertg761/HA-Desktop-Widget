const { SYNC_SCOPE_SECTION_FIELDS, computeProfileHash } = require('../profile-sync-core.js');
const { Buffer } = require('buffer');

const SETTINGS_FILE_FORMAT = 'ha-desktop-widget-settings';
const SETTINGS_FILE_VERSION = 1;
// Earlier versions wrote settings files of up to 1 MB with no other limit on what they held, so a
// file that size is still read; what it holds is bounded field by field below.
const MAX_SETTINGS_FILE_BYTES = 1024 * 1024;
// A file written now is smaller. Imported settings are synced like any others, and the sync file
// is limited to 512 KB for everything it holds, indented more deeply and carrying a few sections
// a settings file does not. Half of that keeps what is exported small enough to sync.
const MAX_SETTINGS_EXPORT_BYTES = 256 * 1024;
// What the app itself can produce, with room to spare: names are typed into one-line fields and
// entity ids are at most 255 characters. Text a person types is cut to this length instead of
// failing, so a name saved before its field was limited still exports and imports. Ids and map
// keys are never typed, so a long one is refused.
const MAX_TEXT_LENGTH = 256;
// Pages, graphs, colors, favorites and per-entity settings have no limit in the app (lists and
// maps follow the entities Home Assistant has, thousands on a large installation), so the file
// has none either: a count limit could only reject a configuration the app made, and make Export
// and every Import preview fail with it. The size limits above bound what a file holds, and only
// a count the app itself enforces is checked, such as the two primary card slots.
const MAX_PRIMARY_CARDS = 2;
const MIN_OPACITY = 0.5;
const MAX_OPACITY = 1;
const mapOf = (schema) => ({ map: schema });
const listOf = (schema, max = Infinity) => ({ list: schema, max });
const oneOf = (...values) => ({ oneOf: values });
const stringList = listOf('string');
// Mirrors the renderer's entity-ID pattern in ha-protocol.cjs, which needs Electron to load.
const HA_ENTITY_ID_PATTERN = /^[a-z0-9_]+\.[a-z0-9_]+$/i;
// A tile spans one to four grid columns.
const isTileSpan = (value) => Number.isInteger(value) && value >= 1 && value <= 4;
// Alert delays are whole seconds up to a day, as the alert editor enforces.
const isAlertSeconds = (value) => Number.isInteger(value) && value >= 0 && value <= 86400;
// Every exported property is listed, including nested fields. Connection details,
// credentials, desktop pins, shortcuts, sync keys and machine preferences cannot ride along.
const SETTINGS_SCHEMA = {
  favoriteEntities: stringList,
  customTabs: listOf({ id: 'string', name: 'text', entityIds: stringList }),
  comparisonGraphs: listOf({ id: 'string', name: 'text', span: 'number', entityIds: stringList }),
  customEntityNames: mapOf('text'),
  customEntityIcons: mapOf('string'),
  tileSpans: mapOf('span'),
  quickAccessTileOptions: mapOf({
    valueSize: 'string',
    cameraPreviewRefresh: 'number|string',
    chartType: 'string',
    gaugeMin: 'number?',
    gaugeMax: 'number?',
  }),
  primaryCards: listOf('string', MAX_PRIMARY_CARDS),
  opacity: 'opacity',
  frostedGlass: 'boolean',
  selectedWeatherEntity: 'string?',
  primaryMediaPlayer: 'string?',
  entityAlerts: {
    enabled: 'boolean',
    persistentNotifications: 'boolean',
    alerts: mapOf({
      onStateChange: 'boolean',
      onSpecificState: 'boolean',
      targetState: 'text',
      onNumericThreshold: 'boolean',
      comparison: 'string',
      threshold: 'number?',
      durationSeconds: 'seconds',
      cooldownSeconds: 'seconds',
      quietHours: { enabled: 'boolean', start: 'string', end: 'string' },
    }),
  },
  ui: {
    theme: oneOf('auto', 'dark', 'light'),
    accent: 'string',
    background: 'string',
    language: 'string',
    customColors: listOf({ id: 'string', name: 'text', color: 'string' }),
    density: oneOf('comfortable', 'compact'),
    activeTileGlow: 'boolean',
    highContrast: 'boolean',
    opaquePanels: 'boolean',
    use24HourClock: 'boolean',
    timeFormat: oneOf('system', '12-hour', '24-hour'),
    dateFormat: oneOf('system', 'weekday-short', 'long', 'numeric'),
    weatherEffectsEnabled: 'boolean',
    weatherOverride: 'string',
    seasonal: {
      enabled: 'boolean?',
      colors: 'boolean',
      holidays: mapOf('boolean'),
      show: 'string',
      showUntil: 'number',
    },
  },
};

function fileError(code) {
  return Object.assign(new Error(code), { code });
}
function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
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
function project(value, schema) {
  if (typeof schema === 'string') {
    if (schema === 'text') {
      if (typeof value !== 'string') throw fileError('invalid_file');
      return truncateText(value);
    }
    // A tile spans one to four grid columns; anything else would be written straight to the grid.
    if (schema === 'span' || schema === 'seconds') {
      if (!(schema === 'span' ? isTileSpan : isAlertSeconds)(value))
        throw fileError('invalid_file');
      return value;
    }
    if (schema === 'opacity') {
      if (typeof value !== 'number' || !(value >= MIN_OPACITY && value <= MAX_OPACITY))
        throw fileError('invalid_file');
      return value;
    }
    if (value === null && schema.endsWith('?')) return null;
    const types = schema.replace(/\?$/, '').split('|');
    if (!types.includes(typeof value) || (typeof value === 'number' && !Number.isFinite(value)))
      throw fileError('invalid_file');
    if (typeof value === 'string' && value.length > MAX_TEXT_LENGTH)
      throw fileError('invalid_file');
    return value;
  }
  if (schema.oneOf) {
    if (!schema.oneOf.includes(value)) throw fileError('invalid_file');
    return value;
  }
  if (schema.list || Array.isArray(schema)) {
    const [entrySchema, max] = schema.list ? [schema.list, schema.max] : [schema[0], Infinity];
    if (!Array.isArray(value) || value.length > max) throw fileError('invalid_file');
    return value.map((entry) => project(entry, entrySchema));
  }
  if (!isObject(value)) throw fileError('invalid_file');
  const entries = schema.map
    ? Object.entries(value)
    : Object.entries(value).filter(([key]) => Object.hasOwn(schema, key));
  return Object.fromEntries(
    entries.map(([key, entry]) => {
      if (key.length > MAX_TEXT_LENGTH) throw fileError('invalid_file');
      return [key, project(entry, schema.map || schema[key])];
    })
  );
}
// null marks a portable setting the exporting computer never set, so importing clears it and the
// destination falls back to the same default. The ui object itself is never cleared as a whole.
function projectClearable(value, schema) {
  if (!isObject(value)) throw fileError('invalid_file');
  return Object.fromEntries(
    Object.entries(value)
      .filter(([key]) => Object.hasOwn(schema, key))
      .map(([key, entry]) => [key, entry === null ? null : project(entry, schema[key])])
  );
}
function projectSettings(value) {
  const settings = projectClearable(value, { ...SETTINGS_SCHEMA, ui: 'object' });
  if (Object.hasOwn(settings, 'ui')) settings.ui = projectClearable(value.ui, SETTINGS_SCHEMA.ui);
  return settings;
}
const cleared = (schema) => Object.fromEntries(Object.keys(schema).map((key) => [key, null]));
function assertSafeTree(value, depth = 0) {
  if (depth > 16) throw fileError('invalid_file');
  if (!value || typeof value !== 'object') return;
  for (const [key, child] of Object.entries(value)) {
    if (['__proto__', 'constructor', 'prototype'].includes(key)) throw fileError('invalid_file');
    assertSafeTree(child, depth + 1);
  }
}
// A key holding undefined is a setting nobody set (the weather picker's Clear leaves one
// behind until restart), so it is left out rather than failing every export and import.
const withoutUndefined = (object) =>
  Object.fromEntries(Object.entries(object).filter(([, value]) => value !== undefined));

// A saved choice this version does not offer (left by an older or newer one) is exported as
// unset instead of failing the export; an import still refuses it.
const withoutUnknownChoices = (ui) =>
  Object.fromEntries(
    Object.entries(ui).filter(([key, value]) => {
      const schema = SETTINGS_SCHEMA.ui[key];
      return !schema?.oneOf || schema.oneOf.includes(value);
    })
  );

function buildSettingsFile(config) {
  const source = isObject(config) ? withoutUndefined(config) : {};
  const settings = projectSettings({
    ...cleared(SETTINGS_SCHEMA),
    ...source,
    // Files with an invalid span or alert delay are rejected, but a stray one saved locally is
    // only left out rather than blocking export and every import preview. The same goes for
    // more primary cards than there are slots.
    ...(Array.isArray(source.primaryCards) && {
      primaryCards: source.primaryCards.slice(0, MAX_PRIMARY_CARDS),
    }),
    ...(Number.isFinite(source.opacity) && {
      opacity: Math.min(MAX_OPACITY, Math.max(MIN_OPACITY, source.opacity)),
    }),
    ...(isObject(source.tileSpans) && {
      tileSpans: Object.fromEntries(
        Object.entries(source.tileSpans).filter(([, span]) => isTileSpan(span))
      ),
    }),
    ...(isObject(source.entityAlerts) &&
      isObject(source.entityAlerts.alerts) && {
        entityAlerts: {
          ...source.entityAlerts,
          alerts: Object.fromEntries(
            Object.entries(source.entityAlerts.alerts).map(([id, alert]) => [
              id,
              isObject(alert)
                ? Object.fromEntries(
                    Object.entries(alert).filter(
                      ([key, value]) =>
                        !['durationSeconds', 'cooldownSeconds'].includes(key) ||
                        isAlertSeconds(value)
                    )
                  )
                : alert,
            ])
          ),
        },
      }),
    ui: {
      ...cleared(SETTINGS_SCHEMA.ui),
      ...withoutUnknownChoices(isObject(source.ui) ? withoutUndefined(source.ui) : {}),
    },
  });
  assertSafeTree(settings);
  return { format: SETTINGS_FILE_FORMAT, version: SETTINGS_FILE_VERSION, settings };
}
function serializeSettingsFile(config) {
  const content = `${JSON.stringify(buildSettingsFile(config), null, 2)}\n`;
  if (Buffer.byteLength(content, 'utf8') > MAX_SETTINGS_EXPORT_BYTES)
    throw fileError('export_too_large');
  return content;
}
function parseSettingsFile(content) {
  if (Buffer.byteLength(content, 'utf8') > MAX_SETTINGS_FILE_BYTES)
    throw fileError('file_too_large');
  let file;
  try {
    file = JSON.parse(content.replace(/^\uFEFF/, ''));
  } catch {
    throw fileError('invalid_file');
  }
  assertSafeTree(file);
  if (!isObject(file) || file.format !== SETTINGS_FILE_FORMAT) throw fileError('invalid_file');
  if (file.version !== SETTINGS_FILE_VERSION) throw fileError('unsupported_version');
  const settings = projectSettings(file.settings);
  if (!Object.keys(settings).length) throw fileError('invalid_file');
  return settings;
}
function settingsFileSections(settings) {
  return Object.fromEntries(
    Object.entries(SYNC_SCOPE_SECTION_FIELDS).flatMap(([key, fields]) => {
      const data = Object.fromEntries(
        fields
          .filter((field) => Object.hasOwn(settings, field))
          .map((field) => [field, settings[field]])
      );
      return Object.keys(data).length ? [[key, data]] : [];
    })
  );
}
function summarizeSettingsImport(settings, currentConfig) {
  const current = buildSettingsFile(currentConfig).settings;
  const sections = settingsFileSections(settings);
  const changedSections = Object.entries(sections)
    .filter(([, data]) =>
      Object.entries(data).some(([key, value]) => {
        const before = key === 'ui' ? { ...current.ui, ...value } : value;
        return computeProfileHash(before) !== computeProfileHash(current[key]);
      })
    )
    .map(([key]) => key);
  const pageNames = (settings.customTabs || []).map((tab) => tab.name || '');
  const entityIds = [
    ...new Set(
      [
        ...(settings.favoriteEntities || []),
        ...(settings.customTabs || []).flatMap((tab) => tab.entityIds || []),
        ...(settings.comparisonGraphs || []).flatMap((graph) => graph.entityIds || []),
        ...(settings.primaryCards || []),
        ...Object.keys(settings.entityAlerts?.alerts || {}),
        // Per-entity maps apply too, even for an entity that is on no page.
        ...Object.keys(settings.customEntityNames || {}),
        ...Object.keys(settings.customEntityIcons || {}),
        ...Object.keys(settings.tileSpans || {}),
        ...Object.keys(settings.quickAccessTileOptions || {}),
        settings.selectedWeatherEntity,
        settings.primaryMediaPlayer,
      ].filter((id) => typeof id === 'string' && HA_ENTITY_ID_PATTERN.test(id))
    ),
  ];
  return { changedSections, pageNames, entityIds };
}

module.exports = {
  MAX_SETTINGS_FILE_BYTES,
  MAX_SETTINGS_EXPORT_BYTES,
  buildSettingsFile,
  serializeSettingsFile,
  parseSettingsFile,
  settingsFileSections,
  summarizeSettingsImport,
};

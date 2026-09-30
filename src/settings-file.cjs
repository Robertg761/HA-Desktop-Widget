const { SYNC_SCOPE_SECTION_FIELDS, computeProfileHash } = require('../profile-sync-core.js');
const { Buffer } = require('buffer');

const SETTINGS_FILE_FORMAT = 'ha-desktop-widget-settings';
const SETTINGS_FILE_VERSION = 1;
const MAX_SETTINGS_FILE_BYTES = 1024 * 1024;
const mapOf = (schema) => ({ map: schema });
const stringList = ['string'];
// Every exported property is listed, including nested fields. Connection details,
// credentials, desktop pins, shortcuts, sync keys and machine preferences cannot ride along.
const SETTINGS_SCHEMA = {
  favoriteEntities: stringList,
  customTabs: [{ id: 'string', name: 'string', entityIds: stringList }],
  comparisonGraphs: [{ id: 'string', name: 'string', span: 'number', entityIds: stringList }],
  customEntityNames: mapOf('string'),
  customEntityIcons: mapOf('string'),
  tileSpans: mapOf('number'),
  quickAccessTileOptions: mapOf({
    valueSize: 'string',
    cameraPreviewRefresh: 'number|string',
    chartType: 'string',
    gaugeMin: 'number?',
    gaugeMax: 'number?',
  }),
  primaryCards: stringList,
  opacity: 'number',
  frostedGlass: 'boolean',
  selectedWeatherEntity: 'string?',
  primaryMediaPlayer: 'string?',
  entityAlerts: {
    enabled: 'boolean',
    alerts: mapOf({
      onStateChange: 'boolean',
      onSpecificState: 'boolean',
      targetState: 'string',
      onNumericThreshold: 'boolean',
      comparison: 'string',
      threshold: 'number?',
      durationSeconds: 'number',
      cooldownSeconds: 'number',
      quietHours: { enabled: 'boolean', start: 'string', end: 'string' },
    }),
  },
  ui: {
    theme: 'string',
    accent: 'string',
    background: 'string',
    language: 'string',
    customColors: [{ id: 'string', name: 'string', color: 'string' }],
    density: 'string',
    activeTileGlow: 'boolean',
    highContrast: 'boolean',
    opaquePanels: 'boolean',
    use24HourClock: 'boolean',
    timeFormat: 'string',
    dateFormat: 'string',
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
function project(value, schema) {
  if (typeof schema === 'string') {
    if (value === null && schema.endsWith('?')) return null;
    const types = schema.replace(/\?$/, '').split('|');
    if (!types.includes(typeof value) || (typeof value === 'number' && !Number.isFinite(value)))
      throw fileError('invalid_file');
    return value;
  }
  if (Array.isArray(schema)) {
    if (!Array.isArray(value)) throw fileError('invalid_file');
    return value.map((entry) => project(entry, schema[0]));
  }
  if (!isObject(value)) throw fileError('invalid_file');
  const entries = schema.map
    ? Object.entries(value)
    : Object.entries(value).filter(([key]) => Object.hasOwn(schema, key));
  return Object.fromEntries(
    entries.map(([key, entry]) => [key, project(entry, schema.map || schema[key])])
  );
}
function assertSafeTree(value, depth = 0) {
  if (depth > 16) throw fileError('invalid_file');
  if (!value || typeof value !== 'object') return;
  for (const [key, child] of Object.entries(value)) {
    if (['__proto__', 'constructor', 'prototype'].includes(key)) throw fileError('invalid_file');
    assertSafeTree(child, depth + 1);
  }
}
function buildSettingsFile(config) {
  const settings = project(config, SETTINGS_SCHEMA);
  assertSafeTree(settings);
  return { format: SETTINGS_FILE_FORMAT, version: SETTINGS_FILE_VERSION, settings };
}
function serializeSettingsFile(config) {
  const content = `${JSON.stringify(buildSettingsFile(config), null, 2)}\n`;
  if (Buffer.byteLength(content, 'utf8') > MAX_SETTINGS_FILE_BYTES)
    throw fileError('file_too_large');
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
  const settings = project(file.settings, SETTINGS_SCHEMA);
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
      ].filter((id) => typeof id === 'string' && /^[a-z_]+\.[a-zA-Z0-9_]+$/.test(id))
    ),
  ];
  return { changedSections, pageNames, entityIds };
}

module.exports = {
  MAX_SETTINGS_FILE_BYTES,
  buildSettingsFile,
  serializeSettingsFile,
  parseSettingsFile,
  settingsFileSections,
  summarizeSettingsImport,
};

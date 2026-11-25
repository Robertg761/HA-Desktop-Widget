const { computeProfileHash } = require('../profile-sync-core.js');
const {
  SYNC_SECTION_FIELDS,
  mapEntityIds,
  projectPortableSettings,
} = require('../packages/widget-renderer/src/settings-fields.cjs');
const { Buffer } = require('buffer');

const SETTINGS_FILE_FORMAT = 'ha-desktop-widget-settings';
const SETTINGS_FILE_VERSION = 1;
// Earlier versions wrote settings files of up to 1 MB with no other limit on what they held, so a
// file that size is still read; what it holds is bounded field by field by the settings field
// registry (packages/widget-renderer/src/settings-fields.cjs).
const MAX_SETTINGS_FILE_BYTES = 1024 * 1024;
// A file written now is smaller. Imported settings are synced like any others, and the sync file
// is limited to 512 KB for everything it holds, indented more deeply and carrying a few sections
// a settings file does not. Half of that keeps what is exported small enough to sync.
const MAX_SETTINGS_EXPORT_BYTES = 256 * 1024;
// Pages, graphs, colors, favorites and per-entity settings have no limit in the app (lists and
// maps follow the entities Home Assistant has, thousands on a large installation), so the file
// has none either: a count limit could only reject a configuration the app made, and make Export
// and every Import preview fail with it. The size limits above bound what a file holds, and only
// a count the app itself enforces is checked, such as the two primary card slots.
// Mirrors the renderer's entity-ID pattern in ha-protocol.cjs, which needs Electron to load.
const HA_ENTITY_ID_PATTERN = /^[a-z0-9_]+\.[a-z0-9_]+$/i;
function fileError(code) {
  return Object.assign(new Error(code), { code });
}
function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
function projectSettings(value, options) {
  try {
    return projectPortableSettings(value, options);
  } catch (error) {
    if (error?.code === 'invalid_setting') throw fileError('invalid_file');
    throw error;
  }
}
function assertSafeTree(value, depth = 0) {
  if (depth > 16) throw fileError('invalid_file');
  if (!value || typeof value !== 'object') return;
  for (const [key, child] of Object.entries(value)) {
    if (['__proto__', 'constructor', 'prototype'].includes(key)) throw fileError('invalid_file');
    assertSafeTree(child, depth + 1);
  }
}
// Only the registry's portable fields are exported, including nested fields. Connection details,
// credentials, desktop pins, shortcuts, sync keys and machine preferences cannot ride along.
// Files with an invalid span, alert delay or choice are rejected, but a stray one saved locally is
// only left out (a choice this version does not offer is exported as unset) rather than blocking
// export and every import preview. The same goes for more primary cards than there are slots.
function buildSettingsFile(config) {
  const settings = projectSettings(config, { fromConfig: true });
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
    Object.entries(SYNC_SECTION_FIELDS).flatMap(([key, fields]) => {
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
  // Per-entity maps count too, even for an entity that is on no page.
  const referenced = [];
  mapEntityIds(settings, (id) => {
    referenced.push(id);
    return id;
  });
  const entityIds = [
    ...new Set(referenced.filter((id) => typeof id === 'string' && HA_ENTITY_ID_PATTERN.test(id))),
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

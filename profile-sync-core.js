const nodeCrypto = require('crypto');
const { promisify } = require('util');

const scryptAsync = promisify(nodeCrypto.scrypt);

// Version 3 stores the profile as independent sections, each with its own
// timestamp, so two devices editing different sections both keep their edits.
// A reader accepts any file whose minReaderVersion it meets, which lets a later
// version add fields or sections without locking this one out.
const SYNC_SCHEMA_VERSION = 3;
const SYNC_MIN_READER_VERSION = 3;
const PROFILE_SYNC_SCOPE_PRESETS = new Set(['all', 'visual', 'quick_access', 'custom']);
// Desktop pins, hotkeys and the open Quick Access page describe one machine, so
// they never sync (matching Home Assistant profiles in profile-schema.js). Always on
// top, hide on focus loss and the tray values do sync, as the scope descriptions in
// Settings say; Home Assistant profiles and settings files leave them out.
const SYNC_SCOPE_SECTION_FIELDS = {
  quickAccessLayout: [
    'favoriteEntities',
    'trayEntities',
    'customEntityNames',
    'customEntityIcons',
    'tileSpans',
    'quickAccessTileOptions',
    'primaryCards',
    'customTabs',
    'comparisonGraphs',
  ],
  visualPersonalization: ['alwaysOnTop', 'hideOnBlur', 'opacity', 'frostedGlass', 'ui'],
  automationAlerts: ['entityAlerts'],
  connectionMediaPreferences: ['selectedWeatherEntity', 'primaryMediaPlayer'],
};
const SYNC_SCOPE_SECTION_KEYS = Object.keys(SYNC_SCOPE_SECTION_FIELDS);
// The JSON type each synced field must have. A section holding anything else in
// one of these is damaged, not applied: the rest of the app relies on these
// shapes. null is always allowed, since it clears the field.
const SYNC_FIELD_TYPES = {
  favoriteEntities: 'array',
  trayEntities: 'object',
  customEntityNames: 'object',
  customEntityIcons: 'object',
  tileSpans: 'object',
  quickAccessTileOptions: 'object',
  primaryCards: 'array',
  customTabs: 'array',
  comparisonGraphs: 'array',
  alwaysOnTop: 'boolean',
  hideOnBlur: 'boolean',
  opacity: 'number',
  frostedGlass: 'boolean',
  ui: 'object',
  entityAlerts: 'object',
  selectedWeatherEntity: 'string',
  primaryMediaPlayer: 'string',
};
// The JSON type of every item in a list, or every value in a map, that the app
// reads without guarding. Tray entries and the insides of tabs and graphs are
// normalized after a pull, and tile spans are read defensively.
const SYNC_FIELD_ITEM_TYPES = {
  favoriteEntities: 'string',
  customEntityNames: 'string',
  customEntityIcons: 'string',
  quickAccessTileOptions: 'object',
  primaryCards: 'string',
  customTabs: 'object',
  comparisonGraphs: 'object',
};
// Fields inside an object field that the app reads directly. Each may be left
// out (the receiving device fills in its default) but not hold another type;
// `items` is the type of every value in that nested map.
const SYNC_NESTED_FIELD_TYPES = {
  entityAlerts: {
    enabled: { type: 'boolean' },
    persistentNotifications: { type: 'boolean' },
    alerts: { type: 'object', items: 'object' },
  },
};

function hasItemsOfType(container, type) {
  return Object.values(container).every((item) => getJsonType(item) === type);
}

// What each item of a list holds, for the fields the app reads without checking. A field may be
// left out (the receiving device fills in its default) but not hold another type. `string[]` is
// a list of strings.
const SYNC_ITEM_FIELD_TYPES = {
  customTabs: { id: 'string', name: 'string', entityIds: 'string[]' },
  comparisonGraphs: { id: 'string', name: 'string', entityIds: 'string[]', span: 'number' },
};
// The types of the shared ui keys this version knows. Only types are checked, never values: a
// later version may add a theme or a density, and its file must not read as damaged here.
const SYNC_UI_FIELD_TYPES = {
  theme: 'string',
  accent: 'string',
  background: 'string',
  language: 'string',
  customColors: 'array',
  density: 'string',
  activeTileGlow: 'boolean',
  highContrast: 'boolean',
  opaquePanels: 'boolean',
  use24HourClock: 'boolean',
  timeFormat: 'string',
  dateFormat: 'string',
  weatherEffectsEnabled: 'boolean',
  weatherOverride: 'string',
  seasonal: 'object',
};

function matchesNestedType(value, type) {
  if (type === 'string[]') {
    return Array.isArray(value) && value.every((entry) => typeof entry === 'string');
  }
  return getJsonType(value) === type;
}

/** Whether every present field of an object has its declared type (null clears it). */
function hasFieldsOfType(object, fieldTypes) {
  return Object.entries(fieldTypes).every(([key, type]) => {
    if (!Object.prototype.hasOwnProperty.call(object, key) || object[key] === null) return true;
    return matchesNestedType(object[key], type);
  });
}

// A tile spans one to four grid columns.
const isTileSpan = (value) => Number.isInteger(value) && value >= 1 && value <= 4;

/** The checks below the top-level type and item type of a field. */
function hasValidNestedShape(field, value) {
  if (field === 'tileSpans') return Object.values(value).every(isTileSpan);
  if (SYNC_ITEM_FIELD_TYPES[field]) {
    return value.every((item) => hasFieldsOfType(item, SYNC_ITEM_FIELD_TYPES[field]));
  }
  if (field === 'ui') return hasFieldsOfType(value, SYNC_UI_FIELD_TYPES);
  return true;
}
// ui keys that describe this machine or session rather than the shared look.
// Keep in step with LOCAL_ONLY_UI_KEYS in packages/widget-renderer/src/profile-schema.js.
// Text size and Omarchy theme following depend on this machine's display and desktop.
const LOCAL_ONLY_UI_KEYS = new Set([
  'personalizationSectionsCollapsed',
  'enableInteractionDebugLogs',
  'scale',
  'followOmarchy',
]);

// ui keys this version reads and writes. Any other ui key came from a newer
// version, so the file's value is authoritative for it.
const KNOWN_UI_KEYS = new Set([
  'theme',
  'accent',
  'background',
  'language',
  'customColors',
  'density',
  'activeTileGlow',
  'highContrast',
  'opaquePanels',
  'use24HourClock',
  'timeFormat',
  'dateFormat',
  'weatherEffectsEnabled',
  'weatherOverride',
  'seasonal',
  ...LOCAL_ONLY_UI_KEYS,
]);

// Failures a person can act on carry a code, so the app can word them for the user
// instead of showing the technical message.
const SYNC_FILE_DAMAGED = 'SYNC_FILE_DAMAGED';
const SYNC_FILE_NEWER_VERSION = 'SYNC_FILE_NEWER_VERSION';

function createSyncFileError(message, code) {
  return Object.assign(new Error(message), { code });
}

/** Whether a read or decode failed because the file's own content is unusable. */
function isSyncFileDamagedError(error) {
  return error?.code === SYNC_FILE_DAMAGED;
}

function deepClone(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

function isObject(value) {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

// Mirrors what JSON.stringify keeps, so a hash of in-memory settings matches the
// same settings after a round trip through the sync file: object keys holding
// undefined are left out, and undefined array items become null.
function stableStringify(value) {
  if (Array.isArray(value)) {
    return `[${value.map((item) => (item === undefined ? 'null' : stableStringify(item))).join(',')}]`;
  }

  if (isObject(value)) {
    const keys = Object.keys(value)
      .filter((key) => value[key] !== undefined)
      .sort();
    const serialized = keys.map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`);
    return `{${serialized.join(',')}}`;
  }

  return JSON.stringify(value);
}

function normalizeScopePreset(value) {
  if (typeof value !== 'string') return 'all';
  const normalized = value.trim().toLowerCase();
  if (normalized === 'quickaccess') return 'quick_access';
  if (!PROFILE_SYNC_SCOPE_PRESETS.has(normalized)) return 'all';
  return normalized;
}

function buildAllScopeSections() {
  return SYNC_SCOPE_SECTION_KEYS.reduce((acc, key) => {
    acc[key] = true;
    return acc;
  }, {});
}

function resolveSectionsForPreset(preset, inputSections = {}) {
  if (preset === 'all') {
    return buildAllScopeSections();
  }

  if (preset === 'visual') {
    return {
      quickAccessLayout: false,
      visualPersonalization: true,
      automationAlerts: false,
      connectionMediaPreferences: false,
    };
  }

  if (preset === 'quick_access') {
    return {
      quickAccessLayout: true,
      visualPersonalization: false,
      automationAlerts: false,
      connectionMediaPreferences: false,
    };
  }

  const sections = {};
  SYNC_SCOPE_SECTION_KEYS.forEach((key) => {
    sections[key] = !!inputSections[key];
  });
  return sections;
}

function getDefaultSyncScope() {
  return {
    preset: 'all',
    sections: buildAllScopeSections(),
  };
}

function normalizeSyncScope(inputScope) {
  if (!isObject(inputScope)) {
    return getDefaultSyncScope();
  }

  const preset = normalizeScopePreset(inputScope.preset);
  const providedSections = isObject(inputScope.sections) ? inputScope.sections : {};

  return {
    preset,
    sections: resolveSectionsForPreset(preset, providedSections),
  };
}

function getScopeSectionKeys(scope) {
  const normalizedScope = normalizeSyncScope(scope);
  return SYNC_SCOPE_SECTION_KEYS.filter((key) => normalizedScope.sections[key]);
}

function getSyncedFieldsForScope(scope) {
  return getScopeSectionKeys(scope).flatMap((key) => SYNC_SCOPE_SECTION_FIELDS[key]);
}

function stripLocalOnlyUiKeys(ui) {
  if (!isObject(ui)) return deepClone(ui);
  return Object.fromEntries(
    Object.entries(ui)
      .filter(([key]) => !LOCAL_ONLY_UI_KEYS.has(key))
      .map(([key, value]) => [key, deepClone(value)])
  );
}

function projectField(source, field) {
  if (field === 'ui') return stripLocalOnlyUiKeys(source.ui);
  const value = deepClone(source[field]);
  // A span outside one to four reads as damage on the other side, so it is never written.
  if (field === 'tileSpans' && isObject(value)) {
    return Object.fromEntries(Object.entries(value).filter(([, span]) => isTileSpan(span)));
  }
  return value;
}

/**
 * Copies the given fields. An undefined value counts as unset, as it is once
 * written. With `markCleared`, unset fields are written as null so the other
 * side can tell a setting was cleared from one an older writer never sent.
 */
function projectFields(source, fields, { markCleared = false } = {}) {
  const projected = {};
  const safeSource = isObject(source) ? source : {};
  fields.forEach((field) => {
    const value = safeSource[field];
    if (Object.prototype.hasOwnProperty.call(safeSource, field) && value !== undefined) {
      projected[field] = value === null ? null : projectField(safeSource, field);
    } else if (markCleared) {
      projected[field] = null;
    }
  });
  return projected;
}

/**
 * The synced fields of a config under a scope. With `markCleared`, fields the
 * config lacks come out as null, so merging the result clears them too.
 */
function projectSyncProfile(config, syncScope = getDefaultSyncScope(), options = {}) {
  return projectFields(config, getSyncedFieldsForScope(syncScope), options);
}

function mergeFieldsIntoConfig(target, incoming, fields, { clearNullUiKeys = false } = {}) {
  fields.forEach((field) => {
    // An absent field was never sent (an older writer), so it stays as it is.
    if (!Object.prototype.hasOwnProperty.call(incoming, field)) return;
    if (incoming[field] === null) {
      // Null means the other side has the setting cleared. The ui object is
      // never cleared as a whole.
      if (field !== 'ui') delete target[field];
      return;
    }
    if (field === 'ui' && isObject(incoming.ui)) {
      // Keys the other device does not know about, and this machine's own ui
      // keys, stay as they are here.
      const localUi = isObject(target.ui) ? target.ui : {};
      const localOnly = Object.fromEntries(
        Object.entries(localUi).filter(([key]) => LOCAL_ONLY_UI_KEYS.has(key))
      );
      target.ui = { ...localUi, ...stripLocalOnlyUiKeys(incoming.ui), ...localOnly };
      // A null ui key means the other side has that setting reset to its default (a sync file
      // writes one for every shared key its device has not set; so does a settings file).
      // Only keys the incoming ui names are cleared. A key of a newer version that arrives as
      // null is left as sent, unless the caller asked for every null to clear.
      Object.entries(stripLocalOnlyUiKeys(incoming.ui)).forEach(([key, value]) => {
        if (value === null && (clearNullUiKeys || KNOWN_UI_KEYS.has(key))) delete target.ui[key];
      });
      return;
    }
    target[field] = deepClone(incoming[field]);
  });
  return target;
}

function mergeSyncedProfileIntoConfig(
  baseConfig,
  syncedProfile,
  syncScope = getDefaultSyncScope()
) {
  const target = isObject(baseConfig) ? deepClone(baseConfig) : {};
  const incoming = isObject(syncedProfile) ? syncedProfile : {};
  return mergeFieldsIntoConfig(target, incoming, getSyncedFieldsForScope(syncScope));
}

// The ui keys this version shares between computers.
const SHARED_UI_KEYS = [...KNOWN_UI_KEYS].filter((key) => !LOCAL_ONLY_UI_KEYS.has(key));

function projectSection(config, sectionKey) {
  const data = projectFields(config, SYNC_SCOPE_SECTION_FIELDS[sectionKey] || [], {
    markCleared: true,
  });
  // As a top-level field this device lacks is written as null, so is a shared ui key. Left out,
  // a reset (an import, a restored backup) would not reach the other computers, which keep
  // their value and push it straight back.
  if (isObject(data.ui)) {
    SHARED_UI_KEYS.forEach((key) => {
      if (!Object.prototype.hasOwnProperty.call(data.ui, key)) data.ui[key] = null;
    });
  }
  return data;
}

/**
 * Restoring a backup merges it, which keeps ui keys the backup lacks. Records the ui keys the
 * incoming sections would add as cleared, so restoring the backup removes them again.
 */
function markIncomingUiKeysCleared(backupSections, incomingSections) {
  const backupUi = backupSections?.visualPersonalization?.ui;
  const incomingUi = incomingSections?.visualPersonalization?.ui;
  if (!isObject(backupUi) || !isObject(incomingUi)) return backupSections;
  Object.keys(stripLocalOnlyUiKeys(incomingUi)).forEach((key) => {
    if (!Object.prototype.hasOwnProperty.call(backupUi, key)) backupUi[key] = null;
  });
  return backupSections;
}

/**
 * Keeps only what the incoming sections replace in a backup of them: their fields and, within ui,
 * their keys. A settings file carries part of a section, so a whole-section backup would also
 * hold settings the import never touched, and restoring it would undo later edits to those.
 */
function scopeBackupToIncoming(backupSections, incomingSections) {
  if (!isObject(incomingSections)) return backupSections;
  const scoped = {};
  Object.entries(backupSections || {}).forEach(([key, data]) => {
    const incoming = incomingSections[key];
    if (!isObject(incoming) || !isObject(data)) return;
    scoped[key] = Object.fromEntries(
      Object.entries(data)
        .filter(([field]) => Object.prototype.hasOwnProperty.call(incoming, field))
        .map(([field, value]) =>
          field === 'ui' && isObject(value) && isObject(incoming.ui)
            ? [
                field,
                Object.fromEntries(
                  Object.entries(value).filter(([uiKey]) =>
                    Object.prototype.hasOwnProperty.call(incoming.ui, uiKey)
                  )
                ),
              ]
            : [field, value]
        )
    );
  });
  return markIncomingUiKeysCleared(scoped, incomingSections);
}

function buildLocalSections(config, syncScope = getDefaultSyncScope()) {
  return getScopeSectionKeys(syncScope).reduce((acc, key) => {
    acc[key] = projectSection(config, key);
    return acc;
  }, {});
}

/**
 * Applies whole sections to a copy of the config. Only fields this version
 * knows are applied, so a section written by a newer version cannot plant
 * arbitrary keys in the config. With `clearNullUiKeys` (settings files and
 * their backups), a ui key the incoming data sets to null is cleared.
 */
function mergeSectionsIntoConfig(baseConfig, sectionData, options) {
  const target = isObject(baseConfig) ? deepClone(baseConfig) : {};
  Object.entries(isObject(sectionData) ? sectionData : {}).forEach(([key, data]) => {
    const fields = SYNC_SCOPE_SECTION_FIELDS[key];
    if (!fields || !isObject(data)) return;
    mergeFieldsIntoConfig(target, data, fields, options);
  });
  return target;
}

function computeProfileHash(profile) {
  const serialized = stableStringify(profile || {});
  return nodeCrypto.createHash('sha256').update(serialized).digest('hex');
}

/**
 * Hashes only the fields this version knows, so fields a newer version adds to a
 * section never make the two sides look different.
 */
function computeSectionHash(sectionKey, data) {
  const fields = SYNC_SCOPE_SECTION_FIELDS[sectionKey] || [];
  const projected = projectFields(data, fields, { markCleared: true });
  // ui keys this version doesn't own are the file's business (they ride along on
  // push), so a change to one alone must not look like an edit of the section.
  if (isObject(projected.ui)) {
    // A null key is the same as one left out: the file of a version that writes no null keys
    // must not read as a different section.
    projected.ui = Object.fromEntries(
      Object.entries(projected.ui).filter(
        ([key, value]) => KNOWN_UI_KEYS.has(key) && value !== null
      )
    );
  }
  return computeProfileHash({ section: sectionKey, data: projected });
}

function compareIsoTimestamps(a, b) {
  const aMs = Date.parse(a || 0) || 0;
  const bMs = Date.parse(b || 0) || 0;

  if (aMs === bMs) return 0;
  return aMs > bMs ? 1 : -1;
}

// How far ahead of this device's clock another device's edit time may be and still count as
// written. A clock running further ahead would otherwise win every conflict until real time
// caught up with it.
const SYNC_FUTURE_TOLERANCE_MS = 5 * 60 * 1000;

/**
 * An edit time as this device compares it: one more than five minutes ahead of `nowMs` counts
 * as five minutes ahead. Anything that is not a valid time comes back as it is.
 */
function clampFutureTimestamp(value, nowMs = Date.now()) {
  const ms = typeof value === 'string' ? Date.parse(value) : NaN;
  if (Number.isNaN(ms) || ms <= nowMs + SYNC_FUTURE_TOLERANCE_MS) return value;
  return new Date(nowMs + SYNC_FUTURE_TOLERANCE_MS).toISOString();
}

/**
 * Decides, section by section, which side each in-scope section should come from.
 *
 * `baseline` holds each section's hash as it stood after this device's last
 * successful sync. Against it, a section that changed on only one side flows to
 * the other with no clock involved. Only when both sides changed the same
 * section (or no baseline exists yet) do timestamps decide, and the losing side
 * is reported so it can be backed up.
 *
 * One exception: a file section that changed while this device's did not, but is older than
 * the version both sides agreed on (`agreedUpdatedAt`), is a stale copy of the file, not an
 * edit: a restored version, a device that was offline uploading its old copy, or the losing
 * side of a provider race. Pulling it would quietly undo an edit that had already synced, so
 * this device's section is written back instead, and the stale one is reported (`staleRemote`,
 * and in `discardsRemote` so it is backed up). An edit always carries a later time than the
 * version it replaced (see stampLocalSectionEdit in main.js), even from a device whose clock
 * is behind.
 *
 * @param {object} options
 * @param {string[]} options.sectionKeys in-scope sections on this device
 * @param {Object<string, object>} options.localSections section data from this device
 * @param {Object<string, {updatedAt: string, data: object}>} options.remoteSections decoded remote entries
 * @param {Object<string, string>} [options.baseline] section hashes at the last sync
 * @param {Object<string, {hash: string, updatedAt: string}>} [options.agreedUpdatedAt] the edit
 *   time of the version each baseline hash describes; ignored where the hash no longer matches
 * @param {Object<string, string>} [options.localUpdatedAt] when each local section last changed
 * @param {'auto'|'push'|'pull'} [options.direction] push and pull force every differing section
 * @param {string[]|null} [options.forceSections] limits a forced direction to these sections;
 *   the rest merge as in 'auto'
 * @param {number} [options.now] this device's clock, for edit times that lie in its future
 * @returns {{push: string[], pull: string[], unchanged: string[], discardsRemote: string[],
 *   discardsLocal: string[], staleRemote: string[], localHashes: Object<string, string>,
 *   remoteHashes: Object<string, string>}}
 */
function planSectionSync({
  sectionKeys,
  localSections = {},
  remoteSections = {},
  baseline = {},
  agreedUpdatedAt = {},
  localUpdatedAt = {},
  direction = 'auto',
  forceSections = null,
  now = Date.now(),
}) {
  const plan = {
    push: [],
    pull: [],
    unchanged: [],
    discardsRemote: [],
    discardsLocal: [],
    staleRemote: [],
    localHashes: {},
    remoteHashes: {},
  };
  const safeBaseline = isObject(baseline) ? baseline : {};
  const safeAgreed = isObject(agreedUpdatedAt) ? agreedUpdatedAt : {};

  sectionKeys.forEach((key) => {
    const localHash = computeSectionHash(key, localSections[key]);
    plan.localHashes[key] = localHash;
    const remoteEntry = isObject(remoteSections) ? remoteSections[key] : null;
    if (!isObject(remoteEntry)) {
      const pullOnly =
        direction === 'pull' && (!Array.isArray(forceSections) || forceSections.includes(key));
      (pullOnly ? plan.unchanged : plan.push).push(key);
      return;
    }

    const remoteHash = computeSectionHash(key, remoteEntry.data);
    plan.remoteHashes[key] = remoteHash;
    if (localHash === remoteHash) {
      plan.unchanged.push(key);
      return;
    }

    const base = typeof safeBaseline[key] === 'string' ? safeBaseline[key] : null;
    const localChanged = localHash !== base;
    const remoteChanged = remoteHash !== base;
    const forced =
      (direction === 'push' || direction === 'pull') &&
      (!Array.isArray(forceSections) || forceSections.includes(key));
    let winner;
    if (forced) {
      winner = direction;
    } else if (base && localChanged && !remoteChanged) {
      winner = 'push';
    } else if (base && remoteChanged && !localChanged) {
      // Two times from the file are compared as written: this device's clock plays no part.
      const agreed = safeAgreed[key];
      const agreedAt = isObject(agreed) && agreed.hash === base ? agreed.updatedAt : null;
      if (agreedAt && compareIsoTimestamps(remoteEntry.updatedAt, agreedAt) < 0) {
        winner = 'push';
        plan.staleRemote.push(key);
      } else {
        winner = 'pull';
      }
    } else {
      // Both sides changed this section, or there is no record of agreeing on
      // it. The newer edit wins; ties go to the file so every device converges.
      const remoteUpdatedAt = clampFutureTimestamp(remoteEntry.updatedAt, now);
      winner = compareIsoTimestamps(localUpdatedAt?.[key], remoteUpdatedAt) > 0 ? 'push' : 'pull';
    }

    if (winner === 'push') {
      plan.push.push(key);
      if (remoteChanged) plan.discardsRemote.push(key);
    } else {
      plan.pull.push(key);
      if (localChanged) plan.discardsLocal.push(key);
    }
  });

  return plan;
}

/**
 * Builds the entry written for a pushed section. Data fields and entry metadata
 * this version does not know (written by a newer version) are carried over from
 * the remote entry so pushing from here never deletes them.
 */
function buildPushedSectionEntry(sectionKey, localData, remoteEntry, { updatedAt, deviceId }) {
  const fields = new Set(SYNC_SCOPE_SECTION_FIELDS[sectionKey] || []);
  const carried = {};
  if (isObject(remoteEntry?.data)) {
    Object.entries(remoteEntry.data).forEach(([field, value]) => {
      if (!fields.has(field)) carried[field] = deepClone(value);
    });
  }
  // Entry-level metadata a newer version added rides along too.
  const entryExtras = {};
  if (isObject(remoteEntry)) {
    Object.entries(remoteEntry).forEach(([field, value]) => {
      if (!['updatedAt', 'updatedByDeviceId', 'data'].includes(field)) {
        entryExtras[field] = deepClone(value);
      }
    });
  }
  const data = { ...carried, ...deepClone(localData || {}) };
  // ui is a bag of settings: keys this version does not own come from a newer
  // one, whose value in the file wins even if this device pulled an older copy.
  // The other fields map entity ids, where a missing key is a deletion and must
  // stay deleted.
  if (isObject(remoteEntry?.data?.ui) && isObject(data.ui)) {
    Object.entries(remoteEntry.data.ui).forEach(([key, value]) => {
      if (!KNOWN_UI_KEYS.has(key)) data.ui[key] = deepClone(value);
    });
  }
  return {
    ...entryExtras,
    updatedAt: updatedAt || new Date().toISOString(),
    updatedByDeviceId: deviceId || 'unknown-device',
    data,
  };
}

async function encryptProfilePayload(profile, passphrase) {
  if (!passphrase || typeof passphrase !== 'string') {
    throw new Error('Passphrase is required for encryption');
  }

  const salt = nodeCrypto.randomBytes(16);
  const iv = nodeCrypto.randomBytes(12);
  const key = await scryptAsync(passphrase, salt, 32);
  const cipher = nodeCrypto.createCipheriv('aes-256-gcm', key, iv);
  const plaintext = Buffer.from(stableStringify(profile || {}), 'utf8');
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const authTag = cipher.getAuthTag();

  return {
    encrypted: true,
    algorithm: 'aes-256-gcm',
    kdf: 'scrypt',
    salt: salt.toString('base64'),
    iv: iv.toString('base64'),
    authTag: authTag.toString('base64'),
    ciphertext: ciphertext.toString('base64'),
  };
}

async function decryptProfilePayload(payload, passphrase) {
  if (!payload || payload.encrypted !== true) {
    return deepClone(payload);
  }

  if (!passphrase || typeof passphrase !== 'string') {
    throw new Error(
      'The sync file is encrypted. Turn on encryption and enter the passphrase your other devices use.'
    );
  }

  if (payload.algorithm !== 'aes-256-gcm' || payload.kdf !== 'scrypt') {
    throw new Error('Unsupported encrypted payload format');
  }

  const salt = Buffer.from(payload.salt || '', 'base64');
  const iv = Buffer.from(payload.iv || '', 'base64');
  const authTag = Buffer.from(payload.authTag || '', 'base64');
  const ciphertext = Buffer.from(payload.ciphertext || '', 'base64');
  // Fields of the wrong size cannot come from a wrong passphrase: the file itself is damaged.
  if (salt.length !== 16 || iv.length !== 12 || authTag.length !== 16) {
    throw createSyncFileError('The encrypted payload is damaged', SYNC_FILE_DAMAGED);
  }
  const key = await scryptAsync(passphrase, salt, 32);
  const decipher = nodeCrypto.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(authTag);

  let plaintext;
  try {
    plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
  } catch {
    throw new Error('The sync passphrase does not match the one used to encrypt the sync file.');
  }

  const parsed = JSON.parse(plaintext);
  if (!isObject(parsed)) {
    throw new Error('Decrypted profile payload is invalid');
  }

  return parsed;
}

function isEnvelopeEncrypted(envelope) {
  return isObject(envelope?.payload) && envelope.payload.encrypted === true;
}

function getLatestSectionTimestamp(sections) {
  let latest = null;
  Object.values(isObject(sections) ? sections : {}).forEach((entry) => {
    if (typeof entry?.updatedAt !== 'string') return;
    if (!latest || compareIsoTimestamps(entry.updatedAt, latest) > 0) latest = entry.updatedAt;
  });
  return latest;
}

const KNOWN_ENVELOPE_KEYS = new Set([
  'schemaVersion',
  'minReaderVersion',
  'updatedAt',
  'updatedByDeviceId',
  'payload',
]);

/**
 * Collects what a version-3-or-later file holds beyond what this version writes:
 * its version numbers, unknown top-level fields and unknown payload fields. A
 * rewrite passes them back to buildSyncEnvelope so a newer writer's additions
 * survive an older device's push.
 */
function extractEnvelopeExtensions(envelope, decodedPayload) {
  if (!isObject(envelope) || envelope.schemaVersion < 3) return null;
  const envelopeFields = {};
  Object.entries(envelope).forEach(([key, value]) => {
    if (!KNOWN_ENVELOPE_KEYS.has(key)) envelopeFields[key] = deepClone(value);
  });
  const payloadFields = {};
  Object.entries(isObject(decodedPayload) ? decodedPayload : {}).forEach(([key, value]) => {
    if (key !== 'sections') payloadFields[key] = deepClone(value);
  });
  return {
    schemaVersion: envelope.schemaVersion,
    minReaderVersion:
      typeof envelope.minReaderVersion === 'number' ? envelope.minReaderVersion : null,
    envelopeFields,
    payloadFields,
  };
}

async function buildSyncEnvelope({
  sections,
  updatedAt,
  updatedByDeviceId,
  encrypt = false,
  passphrase = '',
  extensions = null,
}) {
  if (!isObject(sections)) {
    throw new Error('Profile sections must be an object');
  }

  const payload = { ...deepClone(extensions?.payloadFields || {}), sections: deepClone(sections) };
  // Never label a file as older than the one it replaces: a newer writer set
  // these, and its readers rely on them.
  const schemaVersion = Math.max(SYNC_SCHEMA_VERSION, Number(extensions?.schemaVersion) || 0);
  const minReaderVersion = Math.max(
    SYNC_MIN_READER_VERSION,
    Number(extensions?.minReaderVersion) || 0
  );
  return {
    ...deepClone(extensions?.envelopeFields || {}),
    schemaVersion,
    minReaderVersion,
    updatedAt: updatedAt || getLatestSectionTimestamp(sections) || new Date().toISOString(),
    updatedByDeviceId: updatedByDeviceId || 'unknown-device',
    payload: encrypt ? await encryptProfilePayload(payload, passphrase) : payload,
  };
}

function validateEnvelopeShape(envelope) {
  if (!isObject(envelope)) {
    throw new Error('Sync file must contain an object');
  }

  if (typeof envelope.schemaVersion !== 'number') {
    throw new Error('Sync envelope is missing schemaVersion');
  }

  // A writer that says it needs a newer reader is believed whatever schema it
  // claims; without that field, the schema version is the requirement.
  const minReaderVersion =
    typeof envelope.minReaderVersion === 'number'
      ? envelope.minReaderVersion
      : envelope.schemaVersion;
  if (minReaderVersion > SYNC_SCHEMA_VERSION) {
    throw createSyncFileError(
      'The sync file was written by a newer version of HA Desktop Widget. Update this device to keep syncing.',
      SYNC_FILE_NEWER_VERSION
    );
  }
  if (envelope.schemaVersion === 2) {
    if (!isObject(envelope.syncScope)) {
      throw new Error('Sync envelope is missing syncScope');
    }
  }

  if (typeof envelope.updatedAt !== 'string' || Number.isNaN(Date.parse(envelope.updatedAt))) {
    throw new Error('Sync envelope has invalid updatedAt');
  }

  if (typeof envelope.updatedByDeviceId !== 'string' || !envelope.updatedByDeviceId.trim()) {
    throw new Error('Sync envelope has invalid updatedByDeviceId');
  }

  if (!Object.prototype.hasOwnProperty.call(envelope, 'payload')) {
    throw new Error('Sync envelope is missing payload');
  }

  return true;
}

function parseSyncEnvelope(rawText) {
  let parsed;
  try {
    parsed = JSON.parse(rawText);
  } catch {
    throw createSyncFileError('Sync file is not valid JSON', SYNC_FILE_DAMAGED);
  }

  try {
    validateEnvelopeShape(parsed);
  } catch (error) {
    // A newer writer's file is not damaged, and must never be replaced as if it were.
    if (error.code === SYNC_FILE_NEWER_VERSION) throw error;
    throw createSyncFileError(error.message, SYNC_FILE_DAMAGED);
  }
  return parsed;
}

function serializeSyncEnvelope(envelope) {
  validateEnvelopeShape(envelope);
  return `${JSON.stringify(envelope, null, 2)}\n`;
}

function getJsonType(value) {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  if (typeof value === 'number') return Number.isFinite(value) ? 'number' : 'invalid';
  return typeof value;
}

/**
 * Whether a known section's data has the shape this version applies: an object
 * whose synced fields each hold their expected JSON type (or null).
 */
function hasValidSectionFields(sectionKey, data) {
  if (!isObject(data) || !SYNC_SCOPE_SECTION_FIELDS[sectionKey]) return false;
  return SYNC_SCOPE_SECTION_FIELDS[sectionKey].every((field) => {
    if (!Object.prototype.hasOwnProperty.call(data, field)) return true;
    const value = data[field];
    const type = getJsonType(value);
    // null clears a field, except ui: that is never cleared as a whole, so a
    // null one could not be applied and would be pushed straight back.
    if (type === 'null') return field !== 'ui';
    if (type !== SYNC_FIELD_TYPES[field]) return false;
    if (SYNC_FIELD_ITEM_TYPES[field] && !hasItemsOfType(value, SYNC_FIELD_ITEM_TYPES[field])) {
      return false;
    }
    if (!hasValidNestedShape(field, value)) return false;
    return Object.entries(SYNC_NESTED_FIELD_TYPES[field] || {}).every(([key, expected]) => {
      if (!Object.prototype.hasOwnProperty.call(value, key)) return true;
      if (getJsonType(value[key]) !== expected.type) return false;
      return !expected.items || hasItemsOfType(value[key], expected.items);
    });
  });
}

/**
 * Moves sections of a converted version 1 or 2 file whose fields have the wrong
 * types out of `sections`, returning them as the damaged ones.
 */
function separateMalformedLegacySections(sections) {
  const malformed = {};
  Object.keys(sections).forEach((key) => {
    if (hasValidSectionFields(key, sections[key].data)) return;
    malformed[key] = sections[key];
    delete sections[key];
  });
  return malformed;
}

function isValidTimestamp(value) {
  return typeof value === 'string' && !Number.isNaN(Date.parse(value));
}

/**
 * A known section entry as the planner uses it, or null when it is damaged: no
 * data object, or no valid edit time. The writer is only informational, so a
 * missing one falls back to the file's.
 */
function normalizeSectionEntry(entry, fallbackDeviceId) {
  if (!isObject(entry) || !isObject(entry.data) || !isValidTimestamp(entry.updatedAt)) {
    return null;
  }
  const updatedByDeviceId =
    typeof entry.updatedByDeviceId === 'string' && entry.updatedByDeviceId.trim()
      ? entry.updatedByDeviceId
      : fallbackDeviceId;
  return { ...deepClone(entry), updatedByDeviceId };
}

/**
 * Converts a version 1 or 2 file (one flat profile) into sections, keeping only
 * the fields each section still syncs.
 */
function convertLegacyProfileToSections(envelope, profile) {
  const scope =
    envelope.schemaVersion >= 2 && isObject(envelope.syncScope)
      ? normalizeSyncScope(envelope.syncScope)
      : getDefaultSyncScope();
  const sections = {};
  getScopeSectionKeys(scope).forEach((key) => {
    // Fields the old file lacks stay absent: its writer may not have known them.
    const data = projectFields(profile, SYNC_SCOPE_SECTION_FIELDS[key]);
    if (Object.keys(data).length === 0) return;
    sections[key] = {
      updatedAt: envelope.updatedAt,
      updatedByDeviceId: envelope.updatedByDeviceId,
      data,
    };
  });
  return sections;
}

/**
 * Decodes a sync file into its sections. Sections this version does not know are
 * kept, untouched, so they can be written back unchanged, and `extensions` holds
 * the rest of what a newer writer added (see extractEnvelopeExtensions).
 *
 * @returns {Promise<{sections: Object<string, object>, legacy: boolean,
 *   malformed: Object<string, *>, extensions: object|null}>}
 */
async function decodeEnvelopeSections(envelope, passphrase) {
  validateEnvelopeShape(envelope);

  const decoded = isEnvelopeEncrypted(envelope)
    ? await decryptProfilePayload(envelope.payload, passphrase)
    : deepClone(envelope.payload);
  if (!isObject(decoded)) {
    throw createSyncFileError('Sync payload must be an object', SYNC_FILE_DAMAGED);
  }

  if (envelope.schemaVersion < 3) {
    const sections = convertLegacyProfileToSections(envelope, decoded);
    return {
      sections,
      legacy: true,
      malformed: separateMalformedLegacySections(sections),
      extensions: null,
    };
  }

  if (!isObject(decoded.sections)) {
    throw createSyncFileError('Sync payload is missing sections', SYNC_FILE_DAMAGED);
  }
  const sections = {};
  // Known sections that are damaged are reported, not dropped: treating them as
  // missing would let the next sync overwrite them without a backup.
  const malformed = {};
  Object.entries(decoded.sections).forEach(([key, entry]) => {
    // A section only a newer version knows is kept exactly as it is, metadata
    // included: its schema is not ours to fill in.
    if (!SYNC_SCOPE_SECTION_KEYS.includes(key)) {
      sections[key] = deepClone(entry);
      return;
    }
    // A known section's edit time decides conflicts, so one without a valid time
    // is damage rather than something to borrow the file's time for.
    const normalized = normalizeSectionEntry(entry, envelope.updatedByDeviceId);
    if (normalized && hasValidSectionFields(key, normalized.data)) sections[key] = normalized;
    else malformed[key] = deepClone(entry);
  });
  return {
    sections,
    legacy: false,
    malformed,
    extensions: extractEnvelopeExtensions(envelope, decoded),
  };
}

module.exports = {
  SYNC_SCHEMA_VERSION,
  SYNC_MIN_READER_VERSION,
  SYNC_SCOPE_SECTION_FIELDS,
  SYNC_SCOPE_SECTION_KEYS,
  LOCAL_ONLY_UI_KEYS,
  KNOWN_UI_KEYS,
  getDefaultSyncScope,
  normalizeSyncScope,
  getScopeSectionKeys,
  projectSyncProfile,
  mergeSyncedProfileIntoConfig,
  projectSection,
  buildLocalSections,
  markIncomingUiKeysCleared,
  scopeBackupToIncoming,
  mergeSectionsIntoConfig,
  computeProfileHash,
  computeSectionHash,
  compareIsoTimestamps,
  SYNC_FUTURE_TOLERANCE_MS,
  clampFutureTimestamp,
  planSectionSync,
  buildPushedSectionEntry,
  encryptProfilePayload,
  decryptProfilePayload,
  isEnvelopeEncrypted,
  isSyncFileDamagedError,
  buildSyncEnvelope,
  parseSyncEnvelope,
  serializeSyncEnvelope,
  decodeEnvelopeSections,
  hasValidSectionFields,
};

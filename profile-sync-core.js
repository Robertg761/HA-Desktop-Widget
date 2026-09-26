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
// they never sync (matching Home Assistant profiles in profile-schema.js).
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
// ui keys that describe this machine or session rather than the shared look.
// Keep in step with LOCAL_ONLY_UI_KEYS in packages/widget-renderer/src/profile-schema.js,
// plus the text size and Omarchy theme following, which depend on the display and desktop.
const LOCAL_ONLY_UI_KEYS = new Set([
  'personalizationSectionsCollapsed',
  'enableInteractionDebugLogs',
  'scale',
  'followOmarchy',
]);

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
  return field === 'ui' ? stripLocalOnlyUiKeys(source.ui) : deepClone(source[field]);
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

function projectSyncProfile(config, syncScope = getDefaultSyncScope()) {
  return projectFields(config, getSyncedFieldsForScope(syncScope));
}

function mergeFieldsIntoConfig(target, incoming, fields) {
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

function projectSection(config, sectionKey) {
  return projectFields(config, SYNC_SCOPE_SECTION_FIELDS[sectionKey] || [], {
    markCleared: true,
  });
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
 * arbitrary keys in the config.
 */
function mergeSectionsIntoConfig(baseConfig, sectionData) {
  const target = isObject(baseConfig) ? deepClone(baseConfig) : {};
  Object.entries(isObject(sectionData) ? sectionData : {}).forEach(([key, data]) => {
    const fields = SYNC_SCOPE_SECTION_FIELDS[key];
    if (!fields || !isObject(data)) return;
    mergeFieldsIntoConfig(target, data, fields);
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
  return computeProfileHash({
    section: sectionKey,
    data: projectFields(data, fields, { markCleared: true }),
  });
}

function compareIsoTimestamps(a, b) {
  const aMs = Date.parse(a || 0) || 0;
  const bMs = Date.parse(b || 0) || 0;

  if (aMs === bMs) return 0;
  return aMs > bMs ? 1 : -1;
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
 * @param {object} options
 * @param {string[]} options.sectionKeys in-scope sections on this device
 * @param {Object<string, object>} options.localSections section data from this device
 * @param {Object<string, {updatedAt: string, data: object}>} options.remoteSections decoded remote entries
 * @param {Object<string, string>} [options.baseline] section hashes at the last sync
 * @param {Object<string, string>} [options.localUpdatedAt] when each local section last changed
 * @param {'auto'|'push'|'pull'} [options.direction] push and pull force every differing section
 * @param {string[]|null} [options.forceSections] limits a forced direction to these sections;
 *   the rest merge as in 'auto'
 * @returns {{push: string[], pull: string[], unchanged: string[], discardsRemote: string[],
 *   discardsLocal: string[], localHashes: Object<string, string>, remoteHashes: Object<string, string>}}
 */
function planSectionSync({
  sectionKeys,
  localSections = {},
  remoteSections = {},
  baseline = {},
  localUpdatedAt = {},
  direction = 'auto',
  forceSections = null,
}) {
  const plan = {
    push: [],
    pull: [],
    unchanged: [],
    discardsRemote: [],
    discardsLocal: [],
    localHashes: {},
    remoteHashes: {},
  };
  const safeBaseline = isObject(baseline) ? baseline : {};

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
      winner = 'pull';
    } else {
      // Both sides changed this section, or there is no record of agreeing on
      // it. The newer edit wins; ties go to the file so every device converges.
      winner =
        compareIsoTimestamps(localUpdatedAt?.[key], remoteEntry.updatedAt) > 0 ? 'push' : 'pull';
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
  return {
    ...entryExtras,
    updatedAt: updatedAt || new Date().toISOString(),
    updatedByDeviceId: deviceId || 'unknown-device',
    data: { ...carried, ...deepClone(localData || {}) },
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

  if (envelope.schemaVersion > SYNC_SCHEMA_VERSION) {
    const minReaderVersion =
      typeof envelope.minReaderVersion === 'number'
        ? envelope.minReaderVersion
        : envelope.schemaVersion;
    if (minReaderVersion > SYNC_SCHEMA_VERSION) {
      throw new Error(
        'The sync file was written by a newer version of HA Desktop Widget. Update this device to keep syncing.'
      );
    }
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
    throw new Error('Sync file is not valid JSON');
  }

  validateEnvelopeShape(parsed);
  return parsed;
}

function serializeSyncEnvelope(envelope) {
  validateEnvelopeShape(envelope);
  return `${JSON.stringify(envelope, null, 2)}\n`;
}

function normalizeSectionEntry(entry, fallback) {
  if (!isObject(entry) || !isObject(entry.data)) return null;
  const updatedAt =
    typeof entry.updatedAt === 'string' && !Number.isNaN(Date.parse(entry.updatedAt))
      ? entry.updatedAt
      : fallback.updatedAt;
  const updatedByDeviceId =
    typeof entry.updatedByDeviceId === 'string' && entry.updatedByDeviceId.trim()
      ? entry.updatedByDeviceId
      : fallback.updatedByDeviceId;
  return { ...deepClone(entry), updatedAt, updatedByDeviceId };
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
 *   extensions: object|null}>}
 */
async function decodeEnvelopeSections(envelope, passphrase) {
  validateEnvelopeShape(envelope);

  const decoded = isEnvelopeEncrypted(envelope)
    ? await decryptProfilePayload(envelope.payload, passphrase)
    : deepClone(envelope.payload);
  if (!isObject(decoded)) {
    throw new Error('Sync payload must be an object');
  }

  if (envelope.schemaVersion < 3) {
    return {
      sections: convertLegacyProfileToSections(envelope, decoded),
      legacy: true,
      extensions: null,
    };
  }

  if (!isObject(decoded.sections)) {
    throw new Error('Sync payload is missing sections');
  }
  const fallback = {
    updatedAt: envelope.updatedAt,
    updatedByDeviceId: envelope.updatedByDeviceId,
  };
  const sections = {};
  Object.entries(decoded.sections).forEach(([key, entry]) => {
    const normalized = normalizeSectionEntry(entry, fallback);
    if (normalized) sections[key] = normalized;
  });
  return { sections, legacy: false, extensions: extractEnvelopeExtensions(envelope, decoded) };
}

module.exports = {
  SYNC_SCHEMA_VERSION,
  SYNC_MIN_READER_VERSION,
  SYNC_SCOPE_SECTION_FIELDS,
  SYNC_SCOPE_SECTION_KEYS,
  LOCAL_ONLY_UI_KEYS,
  getDefaultSyncScope,
  normalizeSyncScope,
  getScopeSectionKeys,
  projectSyncProfile,
  mergeSyncedProfileIntoConfig,
  projectSection,
  buildLocalSections,
  mergeSectionsIntoConfig,
  computeProfileHash,
  computeSectionHash,
  compareIsoTimestamps,
  planSectionSync,
  buildPushedSectionEntry,
  encryptProfilePayload,
  decryptProfilePayload,
  isEnvelopeEncrypted,
  buildSyncEnvelope,
  parseSyncEnvelope,
  serializeSyncEnvelope,
  decodeEnvelopeSections,
};

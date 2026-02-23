/* eslint-env node */
const nodeCrypto = require('crypto');

const SYNC_SCHEMA_VERSION = 1;

const SYNCED_TOP_LEVEL_FIELDS = [
  'alwaysOnTop',
  'opacity',
  'frostedGlass',
  'ui',
  'favoriteEntities',
  'customEntityNames',
  'customEntityIcons',
  'tileSpans',
  'primaryCards',
  'selectedWeatherEntity',
  'primaryMediaPlayer',
  'globalHotkeys',
  'entityAlerts',
  'popupHotkey',
  'popupHotkeyHideOnRelease',
  'popupHotkeyToggleMode',
  'customTabs',
];

function deepClone(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

function isObject(value) {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function stableStringify(value) {
  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(',')}]`;
  }

  if (isObject(value)) {
    const keys = Object.keys(value).sort();
    const serialized = keys.map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`);
    return `{${serialized.join(',')}}`;
  }

  return JSON.stringify(value);
}

function projectSyncProfile(config) {
  const source = isObject(config) ? config : {};
  const profile = {};

  if (isObject(source.homeAssistant)) {
    profile.homeAssistant = {
      url: source.homeAssistant.url || '',
    };
  }

  SYNCED_TOP_LEVEL_FIELDS.forEach((field) => {
    if (Object.prototype.hasOwnProperty.call(source, field)) {
      profile[field] = deepClone(source[field]);
    }
  });

  return profile;
}

function mergeSyncedProfileIntoConfig(baseConfig, syncedProfile) {
  const target = isObject(baseConfig) ? deepClone(baseConfig) : {};
  const incoming = isObject(syncedProfile) ? syncedProfile : {};

  if (isObject(incoming.homeAssistant)) {
    target.homeAssistant = target.homeAssistant || {};
    if (typeof incoming.homeAssistant.url === 'string') {
      target.homeAssistant.url = incoming.homeAssistant.url;
    }
  }

  SYNCED_TOP_LEVEL_FIELDS.forEach((field) => {
    if (Object.prototype.hasOwnProperty.call(incoming, field)) {
      target[field] = deepClone(incoming[field]);
    }
  });

  return target;
}

function computeProfileHash(profile) {
  const serialized = stableStringify(profile || {});
  return nodeCrypto.createHash('sha256').update(serialized).digest('hex');
}

function compareIsoTimestamps(a, b) {
  const aMs = Date.parse(a || 0) || 0;
  const bMs = Date.parse(b || 0) || 0;

  if (aMs === bMs) return 0;
  return aMs > bMs ? 1 : -1;
}

function encryptProfilePayload(profile, passphrase) {
  if (!passphrase || typeof passphrase !== 'string') {
    throw new Error('Passphrase is required for encryption');
  }

  const salt = nodeCrypto.randomBytes(16);
  const iv = nodeCrypto.randomBytes(12);
  const key = nodeCrypto.scryptSync(passphrase, salt, 32);
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

function decryptProfilePayload(payload, passphrase) {
  if (!payload || payload.encrypted !== true) {
    return deepClone(payload);
  }

  if (!passphrase || typeof passphrase !== 'string') {
    throw new Error('Passphrase is required to decrypt profile payload');
  }

  if (payload.algorithm !== 'aes-256-gcm' || payload.kdf !== 'scrypt') {
    throw new Error('Unsupported encrypted payload format');
  }

  const salt = Buffer.from(payload.salt || '', 'base64');
  const iv = Buffer.from(payload.iv || '', 'base64');
  const authTag = Buffer.from(payload.authTag || '', 'base64');
  const ciphertext = Buffer.from(payload.ciphertext || '', 'base64');
  const key = nodeCrypto.scryptSync(passphrase, salt, 32);
  const decipher = nodeCrypto.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(authTag);

  let plaintext;
  try {
    plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
  } catch {
    throw new Error('Failed to decrypt synced profile payload');
  }

  const parsed = JSON.parse(plaintext);
  if (!isObject(parsed)) {
    throw new Error('Decrypted profile payload is invalid');
  }

  return parsed;
}

function buildSyncEnvelope({ profile, updatedAt, updatedByDeviceId, encrypt = false, passphrase = '' }) {
  if (!isObject(profile)) {
    throw new Error('Profile payload must be an object');
  }

  const normalizedUpdatedAt = updatedAt || new Date().toISOString();

  return {
    schemaVersion: SYNC_SCHEMA_VERSION,
    updatedAt: normalizedUpdatedAt,
    updatedByDeviceId: updatedByDeviceId || 'unknown-device',
    payload: encrypt
      ? encryptProfilePayload(profile, passphrase)
      : deepClone(profile),
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
    throw new Error(`Unsupported sync schemaVersion ${envelope.schemaVersion}`);
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

function decodeEnvelopeProfile(envelope, passphrase) {
  validateEnvelopeShape(envelope);

  if (isObject(envelope.payload) && envelope.payload.encrypted === true) {
    return decryptProfilePayload(envelope.payload, passphrase);
  }

  if (!isObject(envelope.payload)) {
    throw new Error('Sync payload must be an object');
  }

  return deepClone(envelope.payload);
}

function chooseSyncDirection({ localUpdatedAt, remoteUpdatedAt, remoteExists }) {
  if (!remoteExists) {
    return 'push';
  }

  const timestampComparison = compareIsoTimestamps(localUpdatedAt, remoteUpdatedAt);
  if (timestampComparison === 0) {
    return 'none';
  }

  return timestampComparison > 0 ? 'push' : 'pull';
}

module.exports = {
  SYNC_SCHEMA_VERSION,
  projectSyncProfile,
  mergeSyncedProfileIntoConfig,
  computeProfileHash,
  compareIsoTimestamps,
  encryptProfilePayload,
  decryptProfilePayload,
  buildSyncEnvelope,
  parseSyncEnvelope,
  serializeSyncEnvelope,
  decodeEnvelopeProfile,
  chooseSyncDirection,
};

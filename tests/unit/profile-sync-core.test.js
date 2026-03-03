/**
 * @jest-environment node
 */

const {
  projectSyncProfile,
  mergeSyncedProfileIntoConfig,
  computeProfileHash,
  compareIsoTimestamps,
  getDefaultSyncScope,
  normalizeSyncScope,
  buildSyncEnvelope,
  parseSyncEnvelope,
  decodeEnvelopeProfile,
  extractSyncScopeFromEnvelope,
  chooseSyncDirection,
} = require('../../profile-sync-core.js');

describe('profile-sync-core', () => {
  test('should exclude local-only fields while syncing all sections by default', () => {
    const projected = projectSyncProfile({
      homeAssistant: { url: 'http://ha.local:8123', token: 'secret' },
      windowPosition: { x: 10, y: 12 },
      windowSize: { width: 300, height: 400 },
      alwaysOnTop: true,
      favoriteEntities: ['light.kitchen'],
      primaryMediaPlayer: 'media_player.office',
      profileSync: { enabled: true, syncScope: { preset: 'custom' } },
    });

    expect(projected.homeAssistant).toBeUndefined();
    expect(projected.windowPosition).toBeUndefined();
    expect(projected.windowSize).toBeUndefined();
    expect(projected.profileSync).toBeUndefined();
    expect(projected.favoriteEntities).toEqual(['light.kitchen']);
    expect(projected.primaryMediaPlayer).toBe('media_player.office');
  });

  test('should respect custom sync scope filtering', () => {
    const projected = projectSyncProfile(
      {
        favoriteEntities: ['light.kitchen'],
        ui: { theme: 'dark' },
        globalHotkeys: { enabled: true, hotkeys: {} },
        primaryMediaPlayer: 'media_player.office',
      },
      {
        preset: 'custom',
        sections: {
          quickAccessLayout: true,
          visualPersonalization: false,
          automationAlerts: false,
          connectionMediaPreferences: true,
        },
      }
    );

    expect(projected.favoriteEntities).toEqual(['light.kitchen']);
    expect(projected.primaryMediaPlayer).toBe('media_player.office');
    expect(projected.ui).toBeUndefined();
    expect(projected.globalHotkeys).toBeUndefined();
  });

  test('should preserve local-only fields and scope exclusions when merging synced profile', () => {
    const merged = mergeSyncedProfileIntoConfig(
      {
        homeAssistant: { url: 'http://old', token: 'keep-me' },
        windowPosition: { x: 1, y: 2 },
        alwaysOnTop: true,
        ui: { theme: 'dark' },
        favoriteEntities: ['light.local'],
      },
      {
        alwaysOnTop: false,
        ui: { theme: 'light' },
        favoriteEntities: ['light.remote'],
      },
      {
        preset: 'custom',
        sections: {
          quickAccessLayout: true,
          visualPersonalization: false,
          automationAlerts: false,
          connectionMediaPreferences: false,
        },
      }
    );

    expect(merged.homeAssistant.url).toBe('http://old');
    expect(merged.homeAssistant.token).toBe('keep-me');
    expect(merged.windowPosition).toEqual({ x: 1, y: 2 });
    expect(merged.alwaysOnTop).toBe(true);
    expect(merged.ui).toEqual({ theme: 'dark' });
    expect(merged.favoriteEntities).toEqual(['light.remote']);
  });

  test('should handle nullish and missing profile fields in projection and merge helpers', () => {
    expect(projectSyncProfile(null)).toEqual({});
    expect(projectSyncProfile(undefined)).toEqual({});

    const mergedFromNullProfile = mergeSyncedProfileIntoConfig(
      {
        homeAssistant: { url: 'http://local', token: 'local-token' },
        windowPosition: { x: 2, y: 3 },
        favoriteEntities: ['light.local'],
      },
      null
    );
    expect(mergedFromNullProfile.homeAssistant).toEqual({ url: 'http://local', token: 'local-token' });
    expect(mergedFromNullProfile.windowPosition).toEqual({ x: 2, y: 3 });
    expect(mergedFromNullProfile.favoriteEntities).toEqual(['light.local']);

    const mergedWithMissingSyncedFields = mergeSyncedProfileIntoConfig(
      {
        homeAssistant: { url: 'http://local' },
        favoriteEntities: ['light.local'],
        alwaysOnTop: true,
      },
      {
        favoriteEntities: ['light.remote'],
      }
    );
    expect(mergedWithMissingSyncedFields.homeAssistant).toEqual({ url: 'http://local' });
    expect(mergedWithMissingSyncedFields.favoriteEntities).toEqual(['light.remote']);
    expect(mergedWithMissingSyncedFields.alwaysOnTop).toBe(true);
  });

  test('should normalize scope defaults and extraction for undefined, missing, and empty sections', () => {
    expect(normalizeSyncScope(undefined)).toEqual(getDefaultSyncScope());
    expect(normalizeSyncScope({})).toEqual(getDefaultSyncScope());

    const customWithoutSections = normalizeSyncScope({ preset: 'custom' });
    expect(customWithoutSections).toEqual({
      preset: 'custom',
      sections: {
        quickAccessLayout: false,
        visualPersonalization: false,
        automationAlerts: false,
        connectionMediaPreferences: false,
      },
    });

    const envelopeWithEmptyScope = {
      schemaVersion: 2,
      updatedAt: '2026-02-23T08:00:00.000Z',
      updatedByDeviceId: 'device-a',
      syncScope: {},
      payload: {},
    };
    expect(extractSyncScopeFromEnvelope(envelopeWithEmptyScope)).toEqual(getDefaultSyncScope());

    const envelopeWithMissingCustomSections = {
      schemaVersion: 2,
      updatedAt: '2026-02-23T08:00:00.000Z',
      updatedByDeviceId: 'device-a',
      syncScope: { preset: 'custom' },
      payload: {},
    };
    expect(extractSyncScopeFromEnvelope(envelopeWithMissingCustomSections)).toEqual(customWithoutSections);
  });

  test('should produce a stable hash for semantically identical objects', () => {
    const hashA = computeProfileHash({ a: 1, b: { c: 2, d: 3 } });
    const hashB = computeProfileHash({ b: { d: 3, c: 2 }, a: 1 });
    expect(hashA).toBe(hashB);
  });

  test('should round-trip encrypted envelope with passphrase', () => {
    const profile = {
      favoriteEntities: ['light.office'],
    };
    const scope = normalizeSyncScope({
      preset: 'custom',
      sections: {
        quickAccessLayout: true,
        visualPersonalization: false,
        automationAlerts: false,
        connectionMediaPreferences: false,
      },
    });

    const envelope = buildSyncEnvelope({
      profile,
      updatedAt: '2026-02-23T08:00:00.000Z',
      updatedByDeviceId: 'device-a',
      syncScope: scope,
      encrypt: true,
      passphrase: 'strong-passphrase',
    });

    const serialized = JSON.stringify(envelope);
    const parsed = parseSyncEnvelope(serialized);
    const decoded = decodeEnvelopeProfile(parsed, 'strong-passphrase');
    const decodedScope = extractSyncScopeFromEnvelope(parsed);

    expect(decoded).toEqual(profile);
    expect(decodedScope).toEqual(scope);
  });

  test('should fail to decode encrypted envelope with wrong passphrase', () => {
    const envelope = buildSyncEnvelope({
      profile: { alwaysOnTop: true },
      updatedByDeviceId: 'device-a',
      encrypt: true,
      passphrase: 'correct-passphrase',
    });

    expect(() => decodeEnvelopeProfile(envelope, 'wrong-passphrase')).toThrow('Failed to decrypt synced profile payload');
  });

  test('should fail gracefully when parsing malformed JSON and invalid v1 envelopes', () => {
    expect(() => parseSyncEnvelope('{not-json')).toThrow('Sync file is not valid JSON');

    const missingUpdatedAt = JSON.stringify({
      schemaVersion: 1,
      updatedByDeviceId: 'legacy-device',
      payload: { alwaysOnTop: true },
    });
    expect(() => parseSyncEnvelope(missingUpdatedAt)).toThrow('Sync envelope has invalid updatedAt');

    const missingUpdatedByDeviceId = JSON.stringify({
      schemaVersion: 1,
      updatedAt: '2026-02-23T08:00:00.000Z',
      payload: { alwaysOnTop: true },
    });
    expect(() => parseSyncEnvelope(missingUpdatedByDeviceId)).toThrow('Sync envelope has invalid updatedByDeviceId');
  });

  test('should validate decode behavior for missing passphrase and invalid payload fields', () => {
    const encryptedEnvelope = buildSyncEnvelope({
      profile: { alwaysOnTop: true },
      updatedByDeviceId: 'device-a',
      encrypt: true,
      passphrase: 'correct-passphrase',
    });

    expect(() => decodeEnvelopeProfile(encryptedEnvelope)).toThrow('Passphrase is required to decrypt profile payload');
    expect(() => decodeEnvelopeProfile(encryptedEnvelope, '')).toThrow('Passphrase is required to decrypt profile payload');

    const envelopeWithEmptyPayload = {
      schemaVersion: 2,
      updatedAt: '2026-02-23T08:00:00.000Z',
      updatedByDeviceId: 'device-a',
      syncScope: getDefaultSyncScope(),
      payload: '',
    };
    expect(() => decodeEnvelopeProfile(envelopeWithEmptyPayload)).toThrow('Sync payload must be an object');

    const encryptedEnvelopeMissingCiphertext = JSON.parse(JSON.stringify(encryptedEnvelope));
    encryptedEnvelopeMissingCiphertext.payload.ciphertext = '';
    expect(() => decodeEnvelopeProfile(encryptedEnvelopeMissingCiphertext, 'correct-passphrase')).toThrow('Failed to decrypt synced profile payload');
  });

  test('should prefer newer side in timestamp comparison and choose direction', () => {
    expect(compareIsoTimestamps('2026-02-23T10:00:00.000Z', '2026-02-23T09:00:00.000Z')).toBe(1);
    expect(compareIsoTimestamps('2026-02-23T09:00:00.000Z', '2026-02-23T10:00:00.000Z')).toBe(-1);
    expect(compareIsoTimestamps('2026-02-23T10:00:00.000Z', '2026-02-23T10:00:00.000Z')).toBe(0);

    expect(chooseSyncDirection({ localUpdatedAt: '2026-02-23T10:00:00.000Z', remoteUpdatedAt: '2026-02-23T09:00:00.000Z', remoteExists: true })).toBe('push');
    expect(chooseSyncDirection({ localUpdatedAt: '2026-02-23T09:00:00.000Z', remoteUpdatedAt: '2026-02-23T10:00:00.000Z', remoteExists: true })).toBe('pull');
    expect(chooseSyncDirection({ localUpdatedAt: '2026-02-23T09:00:00.000Z', remoteUpdatedAt: null, remoteExists: false })).toBe('push');
  });

  test('should handle null, invalid, and empty timestamp inputs consistently', () => {
    expect(compareIsoTimestamps(null, null)).toBe(0);
    expect(compareIsoTimestamps('', '')).toBe(0);
    expect(compareIsoTimestamps('invalid', '2026-02-23T10:00:00.000Z')).toBe(-1);
    expect(compareIsoTimestamps('2026-02-23T10:00:00.000Z', 'invalid')).toBe(1);

    expect(chooseSyncDirection({ localUpdatedAt: 'invalid', remoteUpdatedAt: '2026-02-23T10:00:00.000Z', remoteExists: true })).toBe('pull');
    expect(chooseSyncDirection({ localUpdatedAt: '2026-02-23T10:00:00.000Z', remoteUpdatedAt: 'invalid', remoteExists: true })).toBe('push');
    expect(chooseSyncDirection({ localUpdatedAt: '', remoteUpdatedAt: null, remoteExists: true })).toBe('none');
    expect(chooseSyncDirection({ localUpdatedAt: null, remoteUpdatedAt: 'invalid', remoteExists: false })).toBe('push');
  });

  test('should parse v1 envelopes and default to all sync scope', () => {
    const legacyEnvelope = {
      schemaVersion: 1,
      updatedAt: '2026-02-23T08:00:00.000Z',
      updatedByDeviceId: 'legacy-device',
      payload: { alwaysOnTop: true, ui: { theme: 'dark' } },
    };

    const parsed = parseSyncEnvelope(JSON.stringify(legacyEnvelope));
    expect(decodeEnvelopeProfile(parsed)).toEqual(legacyEnvelope.payload);
    expect(extractSyncScopeFromEnvelope(parsed)).toEqual(getDefaultSyncScope());
  });
});

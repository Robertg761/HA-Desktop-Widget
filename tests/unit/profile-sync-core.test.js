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
  test('projectSyncProfile excludes local-only fields while syncing all sections by default', () => {
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

  test('projectSyncProfile respects custom sync scope filtering', () => {
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

  test('mergeSyncedProfileIntoConfig preserves local-only fields and scope exclusions', () => {
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

  test('computeProfileHash is stable for semantically identical objects', () => {
    const hashA = computeProfileHash({ a: 1, b: { c: 2, d: 3 } });
    const hashB = computeProfileHash({ b: { d: 3, c: 2 }, a: 1 });
    expect(hashA).toBe(hashB);
  });

  test('encrypted envelope can be round-tripped with passphrase', () => {
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

  test('encrypted envelope decode fails with wrong passphrase', () => {
    const envelope = buildSyncEnvelope({
      profile: { alwaysOnTop: true },
      updatedByDeviceId: 'device-a',
      encrypt: true,
      passphrase: 'correct-passphrase',
    });

    expect(() => decodeEnvelopeProfile(envelope, 'wrong-passphrase')).toThrow('Failed to decrypt synced profile payload');
  });

  test('compareIsoTimestamps and direction chooser prefer newer side', () => {
    expect(compareIsoTimestamps('2026-02-23T10:00:00.000Z', '2026-02-23T09:00:00.000Z')).toBe(1);
    expect(compareIsoTimestamps('2026-02-23T09:00:00.000Z', '2026-02-23T10:00:00.000Z')).toBe(-1);
    expect(compareIsoTimestamps('2026-02-23T10:00:00.000Z', '2026-02-23T10:00:00.000Z')).toBe(0);

    expect(chooseSyncDirection({ localUpdatedAt: '2026-02-23T10:00:00.000Z', remoteUpdatedAt: '2026-02-23T09:00:00.000Z', remoteExists: true })).toBe('push');
    expect(chooseSyncDirection({ localUpdatedAt: '2026-02-23T09:00:00.000Z', remoteUpdatedAt: '2026-02-23T10:00:00.000Z', remoteExists: true })).toBe('pull');
    expect(chooseSyncDirection({ localUpdatedAt: '2026-02-23T09:00:00.000Z', remoteUpdatedAt: null, remoteExists: false })).toBe('push');
  });

  test('v1 envelopes parse and default to all sync scope', () => {
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

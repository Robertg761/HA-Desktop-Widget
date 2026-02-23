/**
 * @jest-environment node
 */

const {
  projectSyncProfile,
  mergeSyncedProfileIntoConfig,
  computeProfileHash,
  compareIsoTimestamps,
  buildSyncEnvelope,
  parseSyncEnvelope,
  decodeEnvelopeProfile,
  chooseSyncDirection,
} = require('../../profile-sync-core.js');

describe('profile-sync-core', () => {
  test('projectSyncProfile excludes local-only fields', () => {
    const projected = projectSyncProfile({
      homeAssistant: {
        url: 'http://ha.local:8123',
        token: 'secret',
        tokenEncrypted: true,
      },
      windowPosition: { x: 10, y: 12 },
      windowSize: { width: 300, height: 400 },
      alwaysOnTop: true,
      favoriteEntities: ['light.kitchen'],
      profileSync: { enabled: true },
    });

    expect(projected.homeAssistant.url).toBe('http://ha.local:8123');
    expect(projected.homeAssistant.token).toBeUndefined();
    expect(projected.windowPosition).toBeUndefined();
    expect(projected.windowSize).toBeUndefined();
    expect(projected.profileSync).toBeUndefined();
    expect(projected.favoriteEntities).toEqual(['light.kitchen']);
  });

  test('mergeSyncedProfileIntoConfig preserves local-only fields', () => {
    const merged = mergeSyncedProfileIntoConfig(
      {
        homeAssistant: { url: 'http://old', token: 'keep-me' },
        windowPosition: { x: 1, y: 2 },
        alwaysOnTop: true,
      },
      {
        homeAssistant: { url: 'http://new' },
        alwaysOnTop: false,
      }
    );

    expect(merged.homeAssistant.url).toBe('http://new');
    expect(merged.homeAssistant.token).toBe('keep-me');
    expect(merged.windowPosition).toEqual({ x: 1, y: 2 });
    expect(merged.alwaysOnTop).toBe(false);
  });

  test('computeProfileHash is stable for semantically identical objects', () => {
    const hashA = computeProfileHash({ a: 1, b: { c: 2, d: 3 } });
    const hashB = computeProfileHash({ b: { d: 3, c: 2 }, a: 1 });
    expect(hashA).toBe(hashB);
  });

  test('encrypted envelope can be round-tripped with passphrase', () => {
    const profile = {
      homeAssistant: { url: 'http://ha.local:8123' },
      favoriteEntities: ['light.office'],
    };

    const envelope = buildSyncEnvelope({
      profile,
      updatedAt: '2026-02-23T08:00:00.000Z',
      updatedByDeviceId: 'device-a',
      encrypt: true,
      passphrase: 'strong-passphrase',
    });

    const serialized = JSON.stringify(envelope);
    const parsed = parseSyncEnvelope(serialized);
    const decoded = decodeEnvelopeProfile(parsed, 'strong-passphrase');

    expect(decoded).toEqual(profile);
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
});

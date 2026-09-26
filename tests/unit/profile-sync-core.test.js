/**
 * @jest-environment node
 */

const {
  SYNC_SCHEMA_VERSION,
  SYNC_SCOPE_SECTION_FIELDS,
  projectSyncProfile,
  mergeSyncedProfileIntoConfig,
  buildLocalSections,
  mergeSectionsIntoConfig,
  computeProfileHash,
  computeSectionHash,
  compareIsoTimestamps,
  getDefaultSyncScope,
  normalizeSyncScope,
  getScopeSectionKeys,
  planSectionSync,
  buildPushedSectionEntry,
  buildSyncEnvelope,
  parseSyncEnvelope,
  serializeSyncEnvelope,
  decodeEnvelopeSections,
  isEnvelopeEncrypted,
} = require('../../profile-sync-core.js');

const LAYOUT_ONLY = {
  preset: 'custom',
  sections: {
    quickAccessLayout: true,
    visualPersonalization: false,
    automationAlerts: false,
    connectionMediaPreferences: false,
  },
};

function hashesFor(sections) {
  return Object.fromEntries(
    Object.entries(sections).map(([key, data]) => [key, computeSectionHash(key, data)])
  );
}

describe('profile-sync-core', () => {
  describe('projection', () => {
    test('keeps credentials and machine-local settings out of every section', () => {
      const projected = projectSyncProfile({
        homeAssistant: { url: 'http://ha.local:8123', token: 'secret' },
        windowPosition: { x: 10, y: 12 },
        windowSize: { width: 300, height: 400 },
        alwaysOnTop: true,
        favoriteEntities: ['light.kitchen'],
        customTabs: [{ id: 'kitchen', name: 'Kitchen', entityIds: ['light.kitchen'] }],
        activeTabId: 'kitchen',
        desktopPins: { 'light.kitchen': { x: 10, y: 20, width: 176, height: 176 } },
        globalHotkeys: { enabled: true, hotkeys: { 'light.kitchen': 'Ctrl+K' } },
        popupHotkey: 'Ctrl+Space',
        popupHotkeyToggleMode: true,
        entityAlerts: { enabled: true, alerts: {} },
        quickAccessTileOptions: { 'sensor.office_temperature': { valueSize: 'extra-large' } },
        primaryMediaPlayer: 'media_player.office',
        profileSync: { enabled: true, syncScope: { preset: 'custom' } },
      });

      expect(projected.homeAssistant).toBeUndefined();
      expect(projected.windowPosition).toBeUndefined();
      expect(projected.windowSize).toBeUndefined();
      expect(projected.profileSync).toBeUndefined();
      expect(projected.activeTabId).toBeUndefined();
      expect(projected.desktopPins).toBeUndefined();
      expect(projected.globalHotkeys).toBeUndefined();
      expect(projected.popupHotkey).toBeUndefined();
      expect(projected.popupHotkeyToggleMode).toBeUndefined();
      expect(projected.favoriteEntities).toEqual(['light.kitchen']);
      expect(projected.entityAlerts).toEqual({ enabled: true, alerts: {} });
      expect(projected.quickAccessTileOptions).toEqual({
        'sensor.office_temperature': { valueSize: 'extra-large' },
      });
      expect(projected.primaryMediaPlayer).toBe('media_player.office');
    });

    test('syncs the shared look but not this machine’s ui preferences', () => {
      const projected = projectSyncProfile({
        ui: {
          theme: 'dark',
          accent: 'teal',
          scale: 1.3,
          followOmarchy: true,
          enableInteractionDebugLogs: true,
          personalizationSectionsCollapsed: { colors: true },
        },
      });
      expect(projected.ui).toEqual({ theme: 'dark', accent: 'teal' });
    });

    test('respects the device scope', () => {
      const projected = projectSyncProfile(
        { favoriteEntities: ['light.a'], ui: { theme: 'dark' }, hideOnBlur: true },
        LAYOUT_ONLY
      );
      expect(projected).toEqual({ favoriteEntities: ['light.a'] });
      expect(getScopeSectionKeys(LAYOUT_ONLY)).toEqual(['quickAccessLayout']);
    });

    test('handles missing configs', () => {
      expect(projectSyncProfile(null)).toEqual({});
      // Sections list every field, with unset ones as null.
      expect(buildLocalSections(undefined)).toEqual({
        quickAccessLayout: Object.fromEntries(
          SYNC_SCOPE_SECTION_FIELDS.quickAccessLayout.map((field) => [field, null])
        ),
        visualPersonalization: Object.fromEntries(
          SYNC_SCOPE_SECTION_FIELDS.visualPersonalization.map((field) => [field, null])
        ),
        automationAlerts: { entityAlerts: null },
        connectionMediaPreferences: { selectedWeatherEntity: null, primaryMediaPlayer: null },
      });
    });

    test('a null field clears the setting; an absent one leaves it alone', () => {
      const merged = mergeSectionsIntoConfig(
        { selectedWeatherEntity: 'weather.home', primaryMediaPlayer: 'media_player.tv', ui: {} },
        {
          connectionMediaPreferences: { selectedWeatherEntity: null },
          visualPersonalization: { ui: null },
        }
      );
      expect(merged).toEqual({ primaryMediaPlayer: 'media_player.tv', ui: {} });
    });
  });

  describe('merging into config', () => {
    test('keeps local-only fields, out-of-scope sections and this machine’s ui keys', () => {
      const merged = mergeSyncedProfileIntoConfig(
        {
          homeAssistant: { url: 'http://old', token: 'keep-me' },
          alwaysOnTop: true,
          activeTabId: 'local',
          desktopPins: { 'light.local': { x: 3, y: 4, width: 176, height: 176 } },
          ui: { theme: 'dark', scale: 1.5 },
          favoriteEntities: ['light.local'],
        },
        {
          alwaysOnTop: false,
          activeTabId: 'remote',
          desktopPins: { 'light.remote': { x: 30, y: 40, width: 352, height: 176 } },
          ui: { theme: 'light' },
          favoriteEntities: ['light.remote'],
        },
        LAYOUT_ONLY
      );

      expect(merged.homeAssistant).toEqual({ url: 'http://old', token: 'keep-me' });
      expect(merged.alwaysOnTop).toBe(true);
      expect(merged.activeTabId).toBe('local');
      expect(merged.desktopPins).toEqual({
        'light.local': { x: 3, y: 4, width: 176, height: 176 },
      });
      expect(merged.ui).toEqual({ theme: 'dark', scale: 1.5 });
      expect(merged.favoriteEntities).toEqual(['light.remote']);
    });

    test('a pulled ui never overwrites local-only keys or drops keys the other side lacks', () => {
      const merged = mergeSectionsIntoConfig(
        { ui: { theme: 'dark', scale: 1.3, highContrast: true, followOmarchy: true } },
        { visualPersonalization: { ui: { theme: 'light', scale: 1, followOmarchy: false } } }
      );
      expect(merged.ui).toEqual({
        theme: 'light',
        scale: 1.3,
        highContrast: true,
        followOmarchy: true,
      });
    });

    test('applies only fields this version knows', () => {
      const merged = mergeSectionsIntoConfig(
        { favoriteEntities: [] },
        {
          quickAccessLayout: { favoriteEntities: ['light.a'], futureField: 1, homeAssistant: {} },
          unknownSection: { anything: true },
        }
      );
      expect(merged).toEqual({ favoriteEntities: ['light.a'] });
    });

    test('syncs hide-on-blur with window preferences and keeps it when absent remotely', () => {
      expect(mergeSyncedProfileIntoConfig({ hideOnBlur: true }, {}).hideOnBlur).toBe(true);
      expect(
        mergeSyncedProfileIntoConfig({ hideOnBlur: true }, { hideOnBlur: false }).hideOnBlur
      ).toBe(false);
    });
  });

  describe('hashing', () => {
    test('is stable for semantically identical objects', () => {
      expect(computeProfileHash({ a: 1, b: { c: 2, d: 3 } })).toBe(
        computeProfileHash({ b: { d: 3, c: 2 }, a: 1 })
      );
    });

    test('treats undefined values as absent, as they are once written', () => {
      const cleared = { selectedWeatherEntity: undefined, primaryMediaPlayer: 'media_player.tv' };
      const roundTripped = JSON.parse(JSON.stringify(cleared));
      expect(computeSectionHash('connectionMediaPreferences', cleared)).toBe(
        computeSectionHash('connectionMediaPreferences', roundTripped)
      );
      expect(computeProfileHash({ list: [1, undefined] })).toBe(
        computeProfileHash({ list: [1, null] })
      );
    });

    test('a change only to a newer version’s ui setting is not an edit of the section', () => {
      const base = { opacity: 0.9, ui: { theme: 'dark', futureSetting: 'A' } };
      const plan = planSectionSync({
        sectionKeys: ['visualPersonalization'],
        // This device changed opacity; a newer writer changed only futureSetting.
        localSections: { visualPersonalization: { ...base, opacity: 0.5 } },
        remoteSections: {
          visualPersonalization: {
            updatedAt: '2030-01-01T00:00:00.000Z',
            data: { ...base, ui: { theme: 'dark', futureSetting: 'B' } },
          },
        },
        baseline: { visualPersonalization: computeSectionHash('visualPersonalization', base) },
        localUpdatedAt: { visualPersonalization: '2026-01-01T00:00:00.000Z' },
      });
      expect(plan.push).toEqual(['visualPersonalization']);
      expect(plan.discardsLocal).toEqual([]);
    });

    test('ignores fields a newer version added to a section', () => {
      expect(computeSectionHash('quickAccessLayout', { favoriteEntities: ['a'] })).toBe(
        computeSectionHash('quickAccessLayout', { favoriteEntities: ['a'], futureField: 2 })
      );
    });
  });

  describe('planSectionSync', () => {
    const keys = ['quickAccessLayout', 'visualPersonalization'];
    const base = {
      quickAccessLayout: { favoriteEntities: ['light.a'] },
      visualPersonalization: { opacity: 0.9 },
    };
    const remoteOf = (sections, updatedAt = '2026-01-01T00:00:00.000Z') =>
      Object.fromEntries(Object.entries(sections).map(([key, data]) => [key, { updatedAt, data }]));

    test('keeps edits made to different sections on two devices', () => {
      // This device changed opacity; the other device added a favorite.
      const plan = planSectionSync({
        sectionKeys: keys,
        localSections: { ...base, visualPersonalization: { opacity: 0.7 } },
        remoteSections: remoteOf({
          ...base,
          quickAccessLayout: { favoriteEntities: ['light.a', 'light.b'] },
        }),
        baseline: hashesFor(base),
      });
      expect(plan.push).toEqual(['visualPersonalization']);
      expect(plan.pull).toEqual(['quickAccessLayout']);
      expect(plan.discardsLocal).toEqual([]);
      expect(plan.discardsRemote).toEqual([]);
    });

    test('ignores clocks when only one side changed', () => {
      // This device's clock runs ahead, but it has not edited anything.
      const plan = planSectionSync({
        sectionKeys: keys,
        localSections: base,
        remoteSections: remoteOf(
          { ...base, visualPersonalization: { opacity: 0.6 } },
          '2020-01-01T00:00:00.000Z'
        ),
        baseline: hashesFor(base),
        localUpdatedAt: { visualPersonalization: '2030-01-01T00:00:00.000Z' },
      });
      expect(plan.pull).toEqual(['visualPersonalization']);
      expect(plan.push).toEqual([]);
    });

    test('lets the newer edit win when both sides changed the same section', () => {
      const localSections = { ...base, visualPersonalization: { opacity: 0.7 } };
      const remoteSections = remoteOf(
        { ...base, visualPersonalization: { opacity: 0.6 } },
        '2026-02-01T00:00:00.000Z'
      );
      const olderLocal = planSectionSync({
        sectionKeys: keys,
        localSections,
        remoteSections,
        baseline: hashesFor(base),
        localUpdatedAt: { visualPersonalization: '2026-01-15T00:00:00.000Z' },
      });
      expect(olderLocal.pull).toEqual(['visualPersonalization']);
      expect(olderLocal.discardsLocal).toEqual(['visualPersonalization']);

      const newerLocal = planSectionSync({
        sectionKeys: keys,
        localSections,
        remoteSections,
        baseline: hashesFor(base),
        localUpdatedAt: { visualPersonalization: '2026-03-01T00:00:00.000Z' },
      });
      expect(newerLocal.push).toEqual(['visualPersonalization']);
      expect(newerLocal.discardsRemote).toEqual(['visualPersonalization']);
    });

    test('treats a missing baseline as a conflict decided by time, remote winning ties', () => {
      const plan = planSectionSync({
        sectionKeys: ['visualPersonalization'],
        localSections: { visualPersonalization: { opacity: 0.7 } },
        remoteSections: remoteOf({ visualPersonalization: { opacity: 0.6 } }),
      });
      expect(plan.pull).toEqual(['visualPersonalization']);
      expect(plan.discardsLocal).toEqual(['visualPersonalization']);
    });

    test('pushes sections missing from the file and records matching ones as unchanged', () => {
      const plan = planSectionSync({
        sectionKeys: keys,
        localSections: base,
        remoteSections: remoteOf({ quickAccessLayout: base.quickAccessLayout }),
      });
      expect(plan.unchanged).toEqual(['quickAccessLayout']);
      expect(plan.push).toEqual(['visualPersonalization']);
    });

    test('forced directions override the merge and report what they discard', () => {
      const remoteSections = remoteOf({ ...base, visualPersonalization: { opacity: 0.6 } });
      const localSections = { ...base, visualPersonalization: { opacity: 0.7 } };
      const pushed = planSectionSync({
        sectionKeys: keys,
        localSections,
        remoteSections,
        baseline: hashesFor(base),
        direction: 'push',
      });
      expect(pushed.push).toEqual(['visualPersonalization']);
      expect(pushed.discardsRemote).toEqual(['visualPersonalization']);

      const pulled = planSectionSync({
        sectionKeys: keys,
        localSections,
        remoteSections: remoteOf({ visualPersonalization: { opacity: 0.6 } }),
        baseline: hashesFor(base),
        direction: 'pull',
      });
      expect(pulled.pull).toEqual(['visualPersonalization']);
      expect(pulled.unchanged).toEqual(['quickAccessLayout']);
      expect(pulled.discardsLocal).toEqual(['visualPersonalization']);
    });
  });

  test('a forced direction can be limited to some sections', () => {
    const base = { visualPersonalization: { opacity: 0.9 } };
    const plan = planSectionSync({
      sectionKeys: ['quickAccessLayout', 'visualPersonalization'],
      localSections: {
        quickAccessLayout: { favoriteEntities: ['light.local'] },
        visualPersonalization: { opacity: 0.5 },
      },
      remoteSections: {
        quickAccessLayout: {
          updatedAt: '2026-01-01T00:00:00.000Z',
          data: { favoriteEntities: ['light.remote'] },
        },
        visualPersonalization: { updatedAt: '2026-01-01T00:00:00.000Z', data: { opacity: 0.9 } },
      },
      baseline: hashesFor(base),
      direction: 'pull',
      forceSections: ['quickAccessLayout'],
    });
    // Only the named section is forced; the other still merges and keeps the local edit.
    expect(plan.pull).toEqual(['quickAccessLayout']);
    expect(plan.push).toEqual(['visualPersonalization']);

    const nothingForced = planSectionSync({
      sectionKeys: ['visualPersonalization'],
      localSections: { visualPersonalization: { opacity: 0.5 } },
      remoteSections: {
        visualPersonalization: { updatedAt: '2026-01-01T00:00:00.000Z', data: { opacity: 0.9 } },
      },
      baseline: hashesFor(base),
      direction: 'pull',
      forceSections: [],
    });
    expect(nothingForced.push).toEqual(['visualPersonalization']);
    expect(nothingForced.pull).toEqual([]);
  });

  test('pushed ui keeps settings only a newer version knows, but other maps stay as sent', () => {
    const entry = buildPushedSectionEntry(
      'visualPersonalization',
      { opacity: 0.5, ui: { theme: 'dark' } },
      {
        data: {
          opacity: 0.9,
          ui: { theme: 'light', futureSetting: true, scale: 2 },
        },
      },
      { updatedAt: '2026-01-01T00:00:00.000Z', deviceId: 'device-a' }
    );
    expect(entry.data.ui).toEqual({ theme: 'dark', futureSetting: true });

    // A newer key this device pulled earlier still follows the file.
    const again = buildPushedSectionEntry(
      'visualPersonalization',
      { ui: { theme: 'dark', futureSetting: 'old' } },
      { data: { ui: { theme: 'light', futureSetting: 'new' } } },
      { updatedAt: '2026-01-01T00:00:00.000Z', deviceId: 'device-a' }
    );
    expect(again.data.ui).toEqual({ theme: 'dark', futureSetting: 'new' });

    const layout = buildPushedSectionEntry(
      'quickAccessLayout',
      { customEntityNames: { 'light.a': 'A' } },
      { data: { customEntityNames: { 'light.a': 'A', 'light.deleted': 'Gone' } } },
      { updatedAt: '2026-01-01T00:00:00.000Z', deviceId: 'device-a' }
    );
    expect(layout.data.customEntityNames).toEqual({ 'light.a': 'A' });
  });

  test('pushed sections keep fields a newer version wrote', () => {
    const entry = buildPushedSectionEntry(
      'quickAccessLayout',
      { favoriteEntities: ['light.local'] },
      {
        updatedAt: '2025-01-01T00:00:00.000Z',
        updatedByDeviceId: 'device-b',
        futureEntryField: 'kept',
        data: { favoriteEntities: ['light.remote'], futureField: { a: 1 } },
      },
      { updatedAt: '2026-01-01T00:00:00.000Z', deviceId: 'device-a' }
    );
    expect(entry).toEqual({
      futureEntryField: 'kept',
      updatedAt: '2026-01-01T00:00:00.000Z',
      updatedByDeviceId: 'device-a',
      data: { favoriteEntities: ['light.local'], futureField: { a: 1 } },
    });
  });

  describe('envelopes', () => {
    const sections = {
      quickAccessLayout: {
        updatedAt: '2026-02-23T08:00:00.000Z',
        updatedByDeviceId: 'device-a',
        data: { favoriteEntities: ['light.office'] },
      },
      futureSection: {
        updatedAt: '2026-02-24T08:00:00.000Z',
        updatedByDeviceId: 'device-b',
        data: { something: true },
      },
    };

    test('round-trips plain sections, keeping unknown ones, and has no shared scope', async () => {
      const envelope = await buildSyncEnvelope({ sections, updatedByDeviceId: 'device-a' });
      expect(envelope.schemaVersion).toBe(SYNC_SCHEMA_VERSION);
      expect(envelope.minReaderVersion).toBe(3);
      expect(envelope.syncScope).toBeUndefined();
      expect(envelope.updatedAt).toBe('2026-02-24T08:00:00.000Z');

      const parsed = parseSyncEnvelope(serializeSyncEnvelope(envelope));
      const decoded = await decodeEnvelopeSections(parsed);
      expect(decoded.legacy).toBe(false);
      expect(decoded.sections).toEqual(sections);
    });

    test('round-trips encrypted sections and explains passphrase problems', async () => {
      const envelope = await buildSyncEnvelope({
        sections,
        updatedByDeviceId: 'device-a',
        encrypt: true,
        passphrase: 'strong-passphrase',
      });
      expect(isEnvelopeEncrypted(envelope)).toBe(true);
      expect(JSON.stringify(envelope)).not.toContain('light.office');

      const decoded = await decodeEnvelopeSections(envelope, 'strong-passphrase');
      expect(decoded.sections).toEqual(sections);

      await expect(decodeEnvelopeSections(envelope, 'wrong-passphrase')).rejects.toThrow(
        'The sync passphrase does not match the one used to encrypt the sync file.'
      );
      await expect(decodeEnvelopeSections(envelope, '')).rejects.toThrow(
        'The sync file is encrypted. Turn on encryption and enter the passphrase your other devices use.'
      );

      const tampered = JSON.parse(JSON.stringify(envelope));
      tampered.payload.ciphertext = '';
      await expect(decodeEnvelopeSections(tampered, 'strong-passphrase')).rejects.toThrow(
        'The sync passphrase does not match'
      );
    });

    test('reads files from newer versions that still allow this reader', async () => {
      const newer = {
        schemaVersion: SYNC_SCHEMA_VERSION + 1,
        minReaderVersion: SYNC_SCHEMA_VERSION,
        updatedAt: '2026-02-23T08:00:00.000Z',
        updatedByDeviceId: 'device-b',
        payload: { sections, extra: true },
      };
      const decoded = await decodeEnvelopeSections(parseSyncEnvelope(JSON.stringify(newer)));
      expect(decoded.sections.quickAccessLayout.data).toEqual({
        favoriteEntities: ['light.office'],
      });
    });

    test('writes back what a newer version added, inside the encryption too', async () => {
      const newer = await buildSyncEnvelope({
        sections,
        updatedByDeviceId: 'device-b',
        encrypt: true,
        passphrase: 'strong-passphrase',
        extensions: {
          schemaVersion: SYNC_SCHEMA_VERSION + 1,
          minReaderVersion: SYNC_SCHEMA_VERSION,
          envelopeFields: { hint: 'plain' },
          payloadFields: { secretExtra: 'kept' },
        },
      });
      const decoded = await decodeEnvelopeSections(newer, 'strong-passphrase');
      expect(decoded.extensions).toEqual({
        schemaVersion: SYNC_SCHEMA_VERSION + 1,
        minReaderVersion: SYNC_SCHEMA_VERSION,
        envelopeFields: { hint: 'plain' },
        payloadFields: { secretExtra: 'kept' },
      });

      const rewritten = await buildSyncEnvelope({
        sections: decoded.sections,
        updatedByDeviceId: 'device-a',
        encrypt: true,
        passphrase: 'strong-passphrase',
        extensions: decoded.extensions,
      });
      expect(rewritten.schemaVersion).toBe(SYNC_SCHEMA_VERSION + 1);
      expect(rewritten.minReaderVersion).toBe(SYNC_SCHEMA_VERSION);
      expect(rewritten.hint).toBe('plain');
      expect(JSON.stringify(rewritten)).not.toContain('secretExtra');
      const again = await decodeEnvelopeSections(rewritten, 'strong-passphrase');
      expect(again.extensions.payloadFields).toEqual({ secretExtra: 'kept' });
    });

    test('reports damaged known sections and keeps unknown ones as they are', async () => {
      const decoded = await decodeEnvelopeSections({
        schemaVersion: 3,
        minReaderVersion: 3,
        updatedAt: '2026-02-23T08:00:00.000Z',
        updatedByDeviceId: 'device-a',
        payload: {
          sections: {
            visualPersonalization: { updatedAt: '2026-02-23T08:00:00.000Z', data: 'garbage' },
            futureSection: 'opaque',
          },
        },
      });
      expect(decoded.malformed).toEqual({
        visualPersonalization: { updatedAt: '2026-02-23T08:00:00.000Z', data: 'garbage' },
      });
      expect(decoded.sections).toEqual({ futureSection: 'opaque' });
    });

    test('refuses files that require a newer reader', () => {
      const tooNew = JSON.stringify({
        schemaVersion: SYNC_SCHEMA_VERSION + 1,
        minReaderVersion: SYNC_SCHEMA_VERSION + 1,
        updatedAt: '2026-02-23T08:00:00.000Z',
        updatedByDeviceId: 'device-b',
        payload: {},
      });
      expect(() => parseSyncEnvelope(tooNew)).toThrow(
        'The sync file was written by a newer version of HA Desktop Widget.'
      );
    });

    test('rejects malformed files', async () => {
      expect(() => parseSyncEnvelope('{not-json')).toThrow('Sync file is not valid JSON');
      expect(() =>
        parseSyncEnvelope(JSON.stringify({ schemaVersion: 1, updatedByDeviceId: 'x', payload: {} }))
      ).toThrow('Sync envelope has invalid updatedAt');
      expect(() =>
        parseSyncEnvelope(
          JSON.stringify({ schemaVersion: 1, updatedAt: '2026-02-23T08:00:00.000Z', payload: {} })
        )
      ).toThrow('Sync envelope has invalid updatedByDeviceId');

      const noSections = {
        schemaVersion: 3,
        minReaderVersion: 3,
        updatedAt: '2026-02-23T08:00:00.000Z',
        updatedByDeviceId: 'device-a',
        payload: {},
      };
      await expect(decodeEnvelopeSections(noSections)).rejects.toThrow(
        'Sync payload is missing sections'
      );
      await expect(decodeEnvelopeSections({ ...noSections, payload: '' })).rejects.toThrow(
        'Sync payload must be an object'
      );
    });

    test('converts version 2 files to sections in their scope, dropping machine-local fields', async () => {
      const legacy = {
        schemaVersion: 2,
        updatedAt: '2026-02-23T08:00:00.000Z',
        updatedByDeviceId: 'legacy-device',
        syncScope: LAYOUT_ONLY,
        payload: {
          favoriteEntities: ['light.a'],
          activeTabId: 'tab',
          desktopPins: { 'light.a': { x: 1, y: 2 } },
          ui: { theme: 'dark' },
        },
      };
      const decoded = await decodeEnvelopeSections(parseSyncEnvelope(JSON.stringify(legacy)));
      expect(decoded.legacy).toBe(true);
      expect(decoded.sections).toEqual({
        quickAccessLayout: {
          updatedAt: '2026-02-23T08:00:00.000Z',
          updatedByDeviceId: 'legacy-device',
          data: { favoriteEntities: ['light.a'] },
        },
      });
    });

    test('converts version 1 files using every section', async () => {
      const decoded = await decodeEnvelopeSections({
        schemaVersion: 1,
        updatedAt: '2026-02-23T08:00:00.000Z',
        updatedByDeviceId: 'legacy-device',
        payload: { alwaysOnTop: true, ui: { theme: 'dark', scale: 2 } },
      });
      expect(Object.keys(decoded.sections)).toEqual(['visualPersonalization']);
      expect(decoded.sections.visualPersonalization.data).toEqual({
        alwaysOnTop: true,
        ui: { theme: 'dark' },
      });
    });
  });

  test('normalizes scope defaults', () => {
    expect(normalizeSyncScope(undefined)).toEqual(getDefaultSyncScope());
    expect(normalizeSyncScope({ preset: 'custom' })).toEqual({
      preset: 'custom',
      sections: {
        quickAccessLayout: false,
        visualPersonalization: false,
        automationAlerts: false,
        connectionMediaPreferences: false,
      },
    });
  });

  test('compares timestamps, treating invalid ones as oldest', () => {
    expect(compareIsoTimestamps('2026-02-23T10:00:00.000Z', '2026-02-23T09:00:00.000Z')).toBe(1);
    expect(compareIsoTimestamps('2026-02-23T09:00:00.000Z', '2026-02-23T10:00:00.000Z')).toBe(-1);
    expect(compareIsoTimestamps(null, '')).toBe(0);
    expect(compareIsoTimestamps('invalid', '2026-02-23T10:00:00.000Z')).toBe(-1);
  });
});

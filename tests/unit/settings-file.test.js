/** @jest-environment node */
const {
  buildLocalSections,
  buildSyncEnvelope,
  serializeSyncEnvelope,
} = require('../../profile-sync-core.js');
const {
  buildSettingsFile,
  serializeSettingsFile,
  parseSettingsFile,
  settingsFileSections,
  summarizeSettingsImport,
  MAX_SETTINGS_FILE_BYTES,
  MAX_SETTINGS_EXPORT_BYTES,
} = require('../../src/settings-file.cjs');

const config = {
  homeAssistant: { url: 'https://private.example', token: 'secret', refreshToken: 'secret' },
  profileSync: { enabled: true, passphrase: 'secret', cloudFilePath: '/private' },
  globalHotkeys: { enabled: true },
  desktopPins: { 'light.desk': { enabled: true } },
  activeTabId: 'home',
  alwaysOnTop: true,
  hideOnBlur: true,
  updates: { allowPrerelease: true },
  customTabs: [
    { id: 'home', name: 'Home', entityIds: ['light.desk', 'graph:temps'], token: 'secret' },
  ],
  favoriteEntities: ['light.desk', 'graph:temps'],
  comparisonGraphs: [{ id: 'graph:temps', name: 'Temps', span: 2, entityIds: ['sensor.temp'] }],
  opacity: 0.9,
  frostedGlass: true,
  quickAccessTileOptions: {
    'sensor.temp': { chartType: 'gauge', gaugeMin: null, gaugeMax: 30, passphrase: 'secret' },
  },
  customEntityNames: { 'light.desk': 'Desk' },
  entityAlerts: {
    enabled: true,
    alerts: {
      'sensor.temp': {
        onNumericThreshold: true,
        threshold: 25,
        comparison: 'above',
        durationSeconds: 10,
        cooldownSeconds: 30,
        quietHours: { enabled: true, start: '22:00', end: '07:00' },
      },
    },
  },
  ui: {
    theme: 'dark',
    scale: 1.3,
    followOmarchy: true,
    enableInteractionDebugLogs: true,
    language: 'de',
    token: 'secret',
    customColors: [{ id: 'custom', name: 'Ocean', color: '#123456', secret: 'secret' }],
    seasonal: { enabled: null, holidays: { halloween: false }, show: 'auto' },
  },
};
describe('portable settings files', () => {
  test('exports only portable fields and strips unknown nested values', () => {
    const content = serializeSettingsFile(config);
    expect(content).not.toMatch(
      /secret|private\.example|profileSync|desktopPins|Hotkeys|followOmarchy|scale|activeTabId|alwaysOnTop/
    );
    const settings = parseSettingsFile(content);
    expect(settings.customTabs[0]).toEqual({
      id: 'home',
      name: 'Home',
      entityIds: ['light.desk', 'graph:temps'],
    });
    expect(settings.entityAlerts).toEqual(config.entityAlerts);
    expect(settings.ui.customColors).toEqual([{ id: 'custom', name: 'Ocean', color: '#123456' }]);
    expect(settingsFileSections(settings).visualPersonalization).toEqual({
      opacity: 0.9,
      frostedGlass: true,
      ui: settings.ui,
    });
  });
  test.each([
    ['bad json', '{'],
    ['wrong format', JSON.stringify({ format: 'config', version: 1, settings: {} })],
    ['future version', JSON.stringify({ ...buildSettingsFile(config), version: 2 })],
    [
      'wrong field type',
      JSON.stringify({ ...buildSettingsFile(config), settings: { customTabs: 'bad' } }),
    ],
    [
      'wrong nested type',
      JSON.stringify({
        ...buildSettingsFile(config),
        settings: { ui: { customColors: [{ color: 7 }] } },
      }),
    ],
    ['empty payload', JSON.stringify({ ...buildSettingsFile(config), settings: {} })],
    [
      'prototype keys',
      '{"format":"ha-desktop-widget-settings","version":1,"settings":{"customEntityNames":{"__proto__":{}}}}',
    ],
    ['oversized payload', ' '.repeat(MAX_SETTINGS_FILE_BYTES + 1)],
  ])('rejects %s', (_label, content) => expect(() => parseSettingsFile(content)).toThrow());
  test('ignores injected local-only fields and reports changes without credentials', () => {
    const file = buildSettingsFile(config);
    file.settings.homeAssistant = { token: 'malicious' };
    file.settings.ui.scale = 9;
    const settings = parseSettingsFile(JSON.stringify(file));
    expect(settings.homeAssistant).toBeUndefined();
    expect(settings.ui.scale).toBeUndefined();
    expect(summarizeSettingsImport(settings, config)).toEqual({
      changedSections: [],
      pageNames: ['Home'],
      entityIds: ['light.desk', 'sensor.temp'],
    });
    expect(summarizeSettingsImport({ ui: { theme: 'light' } }, config).changedSections).toEqual([
      'visualPersonalization',
    ]);
    expect(summarizeSettingsImport({ ui: { theme: 'dark' } }, config).changedSections).toEqual([]);
  });
  test('previews entities referenced only by per-entity maps', () => {
    const { entityIds } = summarizeSettingsImport(
      {
        customEntityNames: { 'light.retired': 'Old lamp' },
        customEntityIcons: { 'switch.fan': 'mdi:fan' },
        tileSpans: { 'sensor.wide': 2, 'graph:abc': 2 },
        quickAccessTileOptions: { 'camera.door': { valueSize: 'large' } },
      },
      config
    );
    expect(entityIds).toEqual(['light.retired', 'switch.fan', 'sensor.wide', 'camera.door']);
  });
  test('previews entities whose domain contains a digit', () => {
    const { entityIds } = summarizeSettingsImport(
      { favoriteEntities: ['sensor.temp', 'ha_v2.thing', 'Light.Desk', 'graph:abc'] },
      config
    );
    expect(entityIds).toEqual(['sensor.temp', 'ha_v2.thing', 'Light.Desk']);
  });
  test('rejects tile spans outside one to four columns and keeps an unset one', () => {
    const fileWith = (tileSpans) => {
      const file = buildSettingsFile(config);
      file.settings.tileSpans = tileSpans;
      return JSON.stringify(file);
    };
    expect(parseSettingsFile(fileWith({ 'light.desk': 4, 'sensor.temp': 1 })).tileSpans).toEqual({
      'light.desk': 4,
      'sensor.temp': 1,
    });
    expect(parseSettingsFile(fileWith(null)).tileSpans).toBeNull();
    for (const bad of [10000, 0, 5, 1.5, -1, '2', null])
      expect(() => parseSettingsFile(fileWith({ 'light.desk': bad }))).toThrow(
        expect.objectContaining({ code: 'invalid_file' })
      );
  });
  test('importing restores settings the exporting computer never set to their defaults', () => {
    const { mergeSectionsIntoConfig } = require('../../profile-sync-core.js');
    const source = { ...config, ui: { theme: 'dark' } };
    delete source.selectedWeatherEntity;
    delete source.tileSpans;
    const settings = parseSettingsFile(serializeSettingsFile(source));
    expect(settings.selectedWeatherEntity).toBeNull();
    expect(settings.tileSpans).toBeNull();
    expect(settings.ui.highContrast).toBeNull();
    const destination = {
      ...config,
      selectedWeatherEntity: 'weather.other',
      tileSpans: { 'light.desk': 3 },
      ui: { theme: 'light', highContrast: true, scale: 1.25 },
    };
    const merged = mergeSectionsIntoConfig(destination, settingsFileSections(settings), {
      clearNullUiKeys: true,
    });
    expect(merged.selectedWeatherEntity).toBeUndefined();
    expect(merged.tileSpans).toBeUndefined();
    expect(merged.ui).toEqual({ theme: 'dark', scale: 1.25 });
  });
  test('restoring the pre-import backup undoes ui keys the import added', () => {
    const {
      buildLocalSections,
      markIncomingUiKeysCleared,
      mergeSectionsIntoConfig,
    } = require('../../profile-sync-core.js');
    const before = { ...config, ui: { theme: 'light', scale: 1.25 } };
    const incoming = settingsFileSections(
      parseSettingsFile(
        serializeSettingsFile({ ...config, ui: { theme: 'dark', highContrast: true, scale: 2 } })
      )
    );
    const backup = markIncomingUiKeysCleared(
      buildLocalSections(before, { preset: 'custom', sections: { visualPersonalization: true } }),
      incoming
    );
    const options = { clearNullUiKeys: true };
    const imported = mergeSectionsIntoConfig(before, incoming, options);
    expect(imported.ui).toEqual({ theme: 'dark', highContrast: true, scale: 1.25 });
    expect(mergeSectionsIntoConfig(imported, backup, options).ui).toEqual(before.ui);
  });
  test('restoring the pre-import backup leaves settings the import never touched', () => {
    const {
      buildLocalSections,
      scopeBackupToIncoming,
      mergeSectionsIntoConfig,
    } = require('../../profile-sync-core.js');
    const before = {
      ...config,
      alwaysOnTop: true,
      trayEntities: { 'light.desk': true },
      ui: { theme: 'light', personalizationSectionsCollapsed: { colors: true } },
    };
    const incoming = settingsFileSections(
      parseSettingsFile(serializeSettingsFile({ ...config, ui: { theme: 'dark' } }))
    );
    const backup = scopeBackupToIncoming(
      buildLocalSections(before, {
        preset: 'custom',
        sections: { quickAccessLayout: true, visualPersonalization: true },
      }),
      incoming
    );
    expect(backup.visualPersonalization).not.toHaveProperty('alwaysOnTop');
    expect(backup.quickAccessLayout).not.toHaveProperty('trayEntities');
    const options = { clearNullUiKeys: true };
    // After the import the user changes settings the file does not carry.
    const edited = {
      ...mergeSectionsIntoConfig(before, incoming, options),
      alwaysOnTop: false,
      trayEntities: {},
    };
    edited.ui = { ...edited.ui, personalizationSectionsCollapsed: {} };
    const restored = mergeSectionsIntoConfig(edited, backup, options);
    expect(restored.ui.theme).toBe('light');
    expect(restored.alwaysOnTop).toBe(false);
    expect(restored.trayEntities).toEqual({});
    expect(restored.ui.personalizationSectionsCollapsed).toEqual({});
  });
  test('rejects alert delays outside whole seconds up to a day', () => {
    const withCooldown = (cooldownSeconds) => {
      const file = buildSettingsFile(config);
      file.settings.entityAlerts = {
        enabled: true,
        alerts: { 'sensor.temp': { onStateChange: true, cooldownSeconds } },
      };
      return JSON.stringify(file);
    };
    expect(parseSettingsFile(withCooldown(86400)).entityAlerts.alerts['sensor.temp']).toEqual({
      onStateChange: true,
      cooldownSeconds: 86400,
    });
    for (const bad of [1e308, -1, 1.5]) {
      expect(() => parseSettingsFile(withCooldown(bad))).toThrow();
    }
    // A stray delay saved locally is left out of an export instead of blocking it.
    const exported = parseSettingsFile(
      serializeSettingsFile({
        ...config,
        entityAlerts: {
          enabled: true,
          alerts: { 'sensor.temp': { onStateChange: true, durationSeconds: 999999 } },
        },
      })
    );
    expect(exported.entityAlerts.alerts['sensor.temp']).toEqual({ onStateChange: true });
  });
  test('exports despite an out-of-range span saved locally, leaving that span out', () => {
    const settings = parseSettingsFile(
      serializeSettingsFile({ ...config, tileSpans: { 'light.desk': 2, 'sensor.temp': 9 } })
    );
    expect(settings.tileSpans).toEqual({ 'light.desk': 2 });
  });
  test('rejects a file that clears the whole ui object', () => {
    const file = buildSettingsFile(config);
    file.settings.ui = null;
    expect(() => parseSettingsFile(JSON.stringify(file))).toThrow();
  });
  test('round trips a saved profile with Unicode and a byte order mark', () => {
    const next = { ...config, customTabs: [{ id: 'home', name: '温度', entityIds: [] }] };
    expect(parseSettingsFile(`\uFEFF${serializeSettingsFile(next)}`).customTabs[0].name).toBe(
      '温度'
    );
  });

  describe('values the app never writes', () => {
    const importWith = (settings) =>
      parseSettingsFile(JSON.stringify({ ...buildSettingsFile(config), settings }));

    test('a setting left undefined in memory does not break export or import', () => {
      // The weather picker's Clear leaves selectedWeatherEntity undefined until the next restart.
      const live = {
        ...config,
        selectedWeatherEntity: undefined,
        ui: { ...config.ui, accent: undefined },
      };

      const file = buildSettingsFile(live);

      expect(file.settings.selectedWeatherEntity).toBeNull();
      expect(file.settings.ui.accent).toBeNull();
      expect(() => parseSettingsFile(serializeSettingsFile(live))).not.toThrow();
      expect(summarizeSettingsImport(importWith({ opacity: 0.8 }), live).changedSections).toEqual([
        'visualPersonalization',
      ]);
    });

    test.each([
      ['an opacity below the slider', { opacity: 0.2 }],
      ['an opacity above the slider', { opacity: 5 }],
      ['an unknown theme', { ui: { theme: 'purple' } }],
      ['an unknown density', { ui: { density: 'huge' } }],
      ['an unknown time format', { ui: { timeFormat: 'sundial' } }],
      ['an unknown date format', { ui: { dateFormat: 'tomorrow' } }],
      ['more primary cards than slots', { primaryCards: ['weather', 'time', 'extra'] }],
      [
        'a page id that is a wall of text',
        { customTabs: [{ id: 'x'.repeat(257), name: 'Home', entityIds: [] }] },
      ],
      ['an entity id that is a wall of text', { favoriteEntities: ['light.' + 'x'.repeat(300)] }],
      [
        'a key that is a wall of text',
        { customEntityNames: { ['light.' + 'x'.repeat(300)]: 'Name' } },
      ],
      [
        'more pages than anyone makes',
        {
          customTabs: Array.from({ length: 201 }, (_, index) => ({
            id: `t${index}`,
            name: 'Page',
            entityIds: [],
          })),
        },
      ],
      [
        'an endless entity list',
        { favoriteEntities: Array.from({ length: 2001 }, (_, i) => `light.l${i}`) },
      ],
    ])('rejects %s', (_label, settings) => {
      expect(() => importWith(settings)).toThrow(expect.objectContaining({ code: 'invalid_file' }));
    });

    test('exports a saved choice this version does not offer as unset, while import still refuses it', () => {
      const live = { ...config, ui: { ...config.ui, theme: 'sepia', density: 'spacious' } };

      const settings = parseSettingsFile(serializeSettingsFile(live));

      expect(settings.ui.theme).toBeNull();
      expect(settings.ui.density).toBeNull();
      expect(() => importWith({ ui: { theme: 'sepia' } })).toThrow(
        expect.objectContaining({ code: 'invalid_file' })
      );
    });

    test('accepts what the app itself writes at its limits', () => {
      expect(() =>
        importWith({
          opacity: 0.5,
          primaryCards: ['weather', 'time'],
          ui: { theme: 'auto', density: 'compact', timeFormat: '24-hour', dateFormat: 'numeric' },
          customTabs: [{ id: 'a', name: 'x'.repeat(256), entityIds: ['light.desk'] }],
        })
      ).not.toThrow();
    });

    test('exports stay possible when saved values drifted outside the limits', () => {
      const live = { ...config, primaryCards: ['a', 'b', 'c'], opacity: 0.2 };

      const settings = parseSettingsFile(serializeSettingsFile(live));

      expect(settings.primaryCards).toEqual(['a', 'b']);
      expect(settings.opacity).toBe(0.5);
    });

    describe('text a person typed that is longer than the fields allow today', () => {
      // A tile's display name, a graph name and an alert's target state had no length limit.
      const wall = 'n'.repeat(1000);
      const long = {
        ...config,
        customTabs: [{ id: 'home', name: wall, entityIds: ['light.desk'] }],
        comparisonGraphs: [{ id: 'graph:temps', name: wall, span: 2, entityIds: ['sensor.temp'] }],
        customEntityNames: { 'light.desk': wall, 'sensor.temp': 'Temperature' },
        entityAlerts: {
          enabled: true,
          alerts: { 'light.desk': { onSpecificState: true, targetState: wall } },
        },
        ui: { ...config.ui, customColors: [{ id: 'custom', name: wall, color: '#123456' }] },
      };

      test('is cut when the settings are exported, so the export still succeeds', () => {
        const settings = parseSettingsFile(serializeSettingsFile(long));

        expect(settings.customEntityNames['light.desk']).toBe('n'.repeat(256));
        expect(settings.customTabs[0].name).toBe('n'.repeat(256));
        expect(settings.comparisonGraphs[0].name).toBe('n'.repeat(256));
        expect(settings.entityAlerts.alerts['light.desk'].targetState).toBe('n'.repeat(256));
        expect(settings.ui.customColors[0].name).toBe('n'.repeat(256));
        // Everything beside it is untouched.
        expect(settings.customEntityNames['sensor.temp']).toBe('Temperature');
        expect(settings.customTabs[0].entityIds).toEqual(['light.desk']);
        expect(settings.comparisonGraphs[0]).toMatchObject({ id: 'graph:temps', span: 2 });
      });

      test('is cut when a file holding it is imported, so an older export still imports', () => {
        const settings = importWith({
          customEntityNames: { 'light.desk': wall },
          customTabs: [{ id: 'home', name: wall, entityIds: [] }],
        });

        expect(settings.customEntityNames['light.desk']).toBe('n'.repeat(256));
        expect(settings.customTabs[0].name).toBe('n'.repeat(256));
      });

      test('is not cut in the middle of a character made of two code units', () => {
        // The emoji would start at the last kept code unit and end past it.
        const cutName = (name) =>
          importWith({ customEntityNames: { 'light.desk': name } }).customEntityNames['light.desk'];

        expect(cutName(`${'a'.repeat(255)}😀😀`)).toBe('a'.repeat(255));
        expect(cutName(`${'a'.repeat(254)}😀😀`)).toBe(`${'a'.repeat(254)}😀`);
        expect(cutName('é'.repeat(300))).toBe('é'.repeat(256));
      });

      test('does not stop an import preview from comparing against the current settings', () => {
        const settings = importWith({ customEntityNames: { 'light.desk': 'Desk' } });

        expect(summarizeSettingsImport(settings, long).changedSections).toEqual([
          'quickAccessLayout',
        ]);
      });

      test('still has to be text', () => {
        expect(() => importWith({ customEntityNames: { 'light.desk': 12 } })).toThrow(
          expect.objectContaining({ code: 'invalid_file' })
        );
      });
    });
  });

  describe('file size limits', () => {
    // A dashboard with many pages: the ids follow the entities that exist, so the file grows
    // with them and nothing but the file's own size ever limited it.
    const pagesOf = (count, entitiesPerPage = 150) =>
      Array.from({ length: count }, (_, page) => ({
        id: `page-${page}`,
        name: `Page ${page}`,
        entityIds: Array.from(
          { length: entitiesPerPage },
          (_, entity) => `sensor.room_${page}_value_${entity}`
        ),
      }));
    const bytesOf = (content) => Buffer.byteLength(content, 'utf8');
    // The layout earlier versions wrote.
    const writtenByEarlierVersion = (settings) =>
      `${JSON.stringify({ format: 'ha-desktop-widget-settings', version: 1, settings }, null, 2)}\n`;
    const SYNC_FILE_LIMIT = 512 * 1024;

    test('still reads a settings file of about 600 KB, as earlier versions could export one', () => {
      const content = writtenByEarlierVersion({ customTabs: pagesOf(110), opacity: 0.9 });
      expect(bytesOf(content)).toBeGreaterThan(550 * 1024);
      expect(bytesOf(content)).toBeLessThan(650 * 1024);
      expect(bytesOf(content)).toBeGreaterThan(MAX_SETTINGS_EXPORT_BYTES);

      const settings = parseSettingsFile(content);
      expect(settings.customTabs).toHaveLength(110);
      expect(settings.customTabs[109].entityIds).toHaveLength(150);
      expect(summarizeSettingsImport(settings, config).pageNames).toHaveLength(110);
    });

    test('reads a file of exactly the limit earlier versions had and refuses one byte more', () => {
      expect(MAX_SETTINGS_FILE_BYTES).toBeGreaterThanOrEqual(1024 * 1024);
      const valid = writtenByEarlierVersion({ opacity: 0.9 });
      const paddedTo = (bytes) => valid + ' '.repeat(bytes - bytesOf(valid));

      expect(parseSettingsFile(paddedTo(MAX_SETTINGS_FILE_BYTES))).toEqual({ opacity: 0.9 });
      expect(() => parseSettingsFile(paddedTo(MAX_SETTINGS_FILE_BYTES + 1))).toThrow(
        expect.objectContaining({ code: 'file_too_large' })
      );
    });

    test('an export too large to sync once imported is refused with a code of its own', () => {
      const tooLarge = { ...config, customTabs: pagesOf(60) };
      expect(bytesOf(JSON.stringify(buildSettingsFile(tooLarge), null, 2))).toBeGreaterThan(
        MAX_SETTINGS_EXPORT_BYTES
      );
      expect(() => serializeSettingsFile(tooLarge)).toThrow(
        expect.objectContaining({ code: 'export_too_large' })
      );
      // The same pages are not wrong, only more than a new export carries: an older file with
      // them still imports.
      expect(
        parseSettingsFile(writtenByEarlierVersion({ customTabs: pagesOf(60) })).customTabs
      ).toHaveLength(60);
    });

    test('the largest export still imports and fits in a sync file, encrypted or not', async () => {
      const content = serializeSettingsFile({ ...config, customTabs: pagesOf(45) });
      expect(bytesOf(content)).toBeGreaterThan(MAX_SETTINGS_EXPORT_BYTES * 0.8);
      expect(bytesOf(content)).toBeLessThanOrEqual(MAX_SETTINGS_EXPORT_BYTES);

      const sections = buildLocalSections(parseSettingsFile(content));
      const plain = await buildSyncEnvelope({ sections, updatedByDeviceId: 'device' });
      const encrypted = await buildSyncEnvelope({
        sections,
        updatedByDeviceId: 'device',
        encrypt: true,
        passphrase: 'a long enough passphrase',
      });
      expect(bytesOf(serializeSyncEnvelope(plain))).toBeLessThan(SYNC_FILE_LIMIT);
      expect(bytesOf(serializeSyncEnvelope(encrypted))).toBeLessThan(SYNC_FILE_LIMIT);
    });
  });
});

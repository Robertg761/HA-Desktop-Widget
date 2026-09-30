/** @jest-environment node */
const {
  buildSettingsFile,
  serializeSettingsFile,
  parseSettingsFile,
  settingsFileSections,
  summarizeSettingsImport,
  MAX_SETTINGS_FILE_BYTES,
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
    const merged = mergeSectionsIntoConfig(destination, settingsFileSections(settings));
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
    const imported = mergeSectionsIntoConfig(before, incoming);
    expect(imported.ui).toEqual({ theme: 'dark', highContrast: true, scale: 1.25 });
    expect(mergeSectionsIntoConfig(imported, backup).ui).toEqual(before.ui);
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
});

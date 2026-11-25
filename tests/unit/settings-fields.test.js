/**
 * @jest-environment jsdom
 */
const fs = require('fs');
const path = require('path');
const {
  SYNC_SECTION_FIELDS,
  HA_PROFILE_FIELDS,
  SHARED_UI_KEYS,
  LOCAL_ONLY_UI_KEYS,
  SETTING_CONTROLS,
  projectPortableSettings,
  hasSyncShape,
  mapEntityIds,
  defaultSettings,
  settingValue,
  storeSetting,
} = require('../../packages/widget-renderer/src/settings-fields.cjs');
const {
  buildLocalSections,
  hasValidSectionFields,
  mergeSectionsIntoConfig,
} = require('../../profile-sync-core.js');
const {
  parseSettingsFile,
  serializeSettingsFile,
  settingsFileSections,
  summarizeSettingsImport,
} = require('../../src/settings-file.cjs');
const { buildProfileDocumentFromConfig } = require('../../src/profile-schema');
const { replaceConfigEntityIdReferences } = require('../../src/config-entity-references.cjs');
const utils = require('../../src/utils');

jest.mock('../../packages/widget-renderer/src/state', () => ({ CONFIG: null, STATES: {} }));

// One value per field, as the app saves it. Entity ids end in `.old` and nothing else does, so a
// rename of every `.old` id shows which fields hold them. A field added to the registry needs a
// value here (the first test says which).
const SAMPLES = {
  favoriteEntities: ['light.old', 'graph:temps'],
  trayEntities: { 'light.old': { order: 1 } },
  customEntityNames: { 'light.old': 'Desk lamp' },
  customEntityIcons: { 'light.old': 'mdi:lamp' },
  tileSpans: { 'light.old': 2 },
  quickAccessTileOptions: { 'light.old': { chartType: 'gauge', gaugeMin: null, gaugeMax: 30 } },
  primaryCards: ['weather', 'light.old'],
  customTabs: [{ id: 'home', name: 'Home', entityIds: ['light.old', 'graph:temps'] }],
  comparisonGraphs: [{ id: 'graph:temps', name: 'Temps', span: 2, entityIds: ['sensor.t_old'] }],
  alwaysOnTop: false,
  hideOnBlur: true,
  opacity: 0.8,
  frostedGlass: false,
  entityAlerts: {
    enabled: true,
    persistentNotifications: false,
    alerts: { 'light.old': { onStateChange: true, durationSeconds: 5 } },
  },
  selectedWeatherEntity: 'weather.old',
  primaryMediaPlayer: 'media_player.old',
  activeTabId: 'home',
  desktopPins: { 'light.old': { x: 1, y: 2, width: 168, height: 148 } },
  globalHotkeys: { enabled: true, hotkeys: { 'light.old': { hotkey: 'Ctrl+1' } } },
  'ui.theme': 'dark',
  'ui.accent': 'ocean',
  'ui.background': 'slate',
  'ui.language': 'de',
  'ui.customColors': [{ id: 'custom-1', name: 'Ocean', color: '#123456' }],
  'ui.density': 'compact',
  'ui.desktopPinNameAlign': 'center',
  'ui.desktopPinSnap': false,
  'ui.activeTileGlow': false,
  'ui.highContrast': true,
  'ui.opaquePanels': true,
  'ui.use24HourClock': true,
  'ui.timeFormat': '24-hour',
  'ui.dateFormat': 'long',
  'ui.weatherEffectsEnabled': true,
  'ui.weatherOverride': 'snow',
  'ui.seasonal': { enabled: true, colors: false, holidays: { halloween: false }, show: 'auto' },
  'ui.personalizationSectionsCollapsed': { colors: true },
  'ui.enableInteractionDebugLogs': true,
  'ui.scale': 1.3,
  'ui.followOmarchy': false,
};
// The test sample of `sensor.t_old` is an entity id too.
const renameOld = (id) => id.replace(/[._]old$/, (suffix) => `${suffix[0]}new`);
const holdsOldId = (value) => /[._]old"/.test(JSON.stringify(value));

const uiKey = (key) => (key.startsWith('ui.') ? key.slice(3) : null);
const configWith = (key, value) =>
  uiKey(key) ? { ui: { [uiKey(key)]: value } } : { [key]: value };
const readField = (config, key) => (uiKey(key) ? config?.ui?.[uiKey(key)] : config?.[key]);
// A value of a different JSON type than the sample, which profile sync must refuse.
const wrongType = (value) => (typeof value === 'string' ? 7 : 'wrong');

const SYNCED = Object.values(SYNC_SECTION_FIELDS).flat();
const sectionOf = (key) =>
  Object.keys(SYNC_SECTION_FIELDS).find((section) =>
    SYNC_SECTION_FIELDS[section].includes(uiKey(key) ? 'ui' : key)
  );
const SEEDED = defaultSettings();
const ALL_FIELDS = [
  ...new Set([
    ...SYNCED,
    ...HA_PROFILE_FIELDS,
    ...Object.keys(SEEDED),
    ...[...SHARED_UI_KEYS, ...LOCAL_ONLY_UI_KEYS].map((key) => `ui.${key}`),
  ]),
].filter((key) => key !== 'ui');

describe('the settings field registry', () => {
  test('has a sample for every field it declares', () => {
    expect(ALL_FIELDS.filter((key) => !(key in SAMPLES))).toEqual([]);
    expect(Object.keys(SAMPLES).filter((key) => !ALL_FIELDS.includes(key))).toEqual([]);
  });

  describe.each(ALL_FIELDS)('%s', (key) => {
    const sample = SAMPLES[key];
    const config = configWith(key, sample);
    const localUi = LOCAL_ONLY_UI_KEYS.includes(uiKey(key));
    const section = localUi ? undefined : sectionOf(key);

    test('travels in a settings file exactly when it syncs, and comes back unchanged', () => {
      const imported = parseSettingsFile(serializeSettingsFile(config));
      const carried = readField(imported, key) != null;
      if (carried) {
        expect(readField(imported, key)).toEqual(sample);
        // Importing applies a file through the sync sections, so a field it carries must sync.
        expect(section).toBeDefined();
        expect(settingsFileSections(imported)[section]).toBeDefined();
      }
      if (!section) expect(carried).toBe(false);
    });

    test('syncs in its section with its shape, and a value of another type reads as damage', () => {
      // The app's config always has a ui object, and a section never clears it.
      const sections = buildLocalSections({ ui: {}, ...config });
      if (!section) {
        Object.values(sections).forEach((data) => expect(readField(data, key)).toBeUndefined());
        return;
      }
      expect(readField(sections[section], key)).toEqual(sample);
      expect(hasValidSectionFields(section, sections[section])).toBe(true);
      expect(readField(mergeSectionsIntoConfig({}, sections), key)).toEqual(sample);
      expect(hasValidSectionFields(section, configWith(key, wrongType(sample)))).toBe(false);
    });

    test('goes to Home Assistant profiles exactly when the registry says so', () => {
      const document = buildProfileDocumentFromConfig(config);
      const expected = uiKey(key) ? !localUi : HA_PROFILE_FIELDS.includes(key);
      expect(readField(document, key) !== undefined).toBe(expected);
    });

    test('has every entity id it holds renamed, by each of the three renames', () => {
      const viaRegistry = mapEntityIds(config, renameOld);
      const viaRename = replaceConfigEntityIdReferences(config, 'light.old', 'light.new');
      const viaReconcile = utils.reconcileConfigEntityIds(config, {}, { 'light.old': 'light.new' });
      expect(viaRegistry.changed).toBe(holdsOldId(sample));
      expect(holdsOldId(viaRegistry.config)).toBe(false);
      expect(viaRegistry.config).toEqual(
        JSON.parse(JSON.stringify(config).replace(/([._])old"/g, '$1new"'))
      );
      // The config itself is left as it was.
      expect(readField(config, key)).toBe(sample);
      expect(JSON.stringify(viaRename.config)).not.toContain('light.old');
      expect(JSON.stringify(viaReconcile.config)).not.toContain('light.old');
      expect(viaRename.changed).toBe(JSON.stringify(sample).includes('light.old'));
      expect(viaReconcile.changed).toBe(JSON.stringify(sample).includes('light.old'));
    });

    test('reads as its default until set, and as its saved value once set', () => {
      if (key in SEEDED || (uiKey(key) && uiKey(key) in SEEDED.ui)) {
        expect(settingValue({}, key)).toEqual(readField(SEEDED, key));
      }
      expect(settingValue(config, key)).toEqual(sample);
    });
  });
});

describe('settings files', () => {
  const drifted = {
    tileSpans: { 'light.a': 2, 'light.b': 99, 'light.c': '3' },
    opacity: 3,
    primaryCards: ['weather', 'time', 'light.a'],
    entityAlerts: { alerts: { 'light.a': { durationSeconds: -1, cooldownSeconds: 30 } } },
    ui: { theme: 'a-theme-from-a-later-version', density: 'compact' },
  };

  test('an export repairs values that drifted outside their limits instead of failing', () => {
    const settings = projectPortableSettings(drifted, { fromConfig: true });
    expect(settings.tileSpans).toEqual({ 'light.a': 2 });
    expect(settings.opacity).toBe(1);
    expect(settings.primaryCards).toEqual(['weather', 'time']);
    expect(settings.entityAlerts.alerts['light.a']).toEqual({ cooldownSeconds: 30 });
    expect(settings.ui.theme).toBeNull();
    expect(settings.ui.density).toBe('compact');
    // What the config never set is exported as cleared.
    expect(settings.customEntityNames).toBeNull();
    expect(settings.ui.accent).toBeNull();
  });

  test('a file holding any of them is refused', () => {
    for (const [key, value] of Object.entries(drifted)) {
      expect(() => projectPortableSettings({ [key]: value })).toThrow(
        expect.objectContaining({ code: 'invalid_setting' })
      );
    }
  });

  test('the import preview lists every entity the file refers to, wherever it is kept', () => {
    const settings = Object.fromEntries(
      Object.entries(SAMPLES).filter(([key]) => !key.startsWith('ui.'))
    );
    expect(
      summarizeSettingsImport(parseSettingsFile(serializeSettingsFile(settings)), {}).entityIds
    ).toEqual(['light.old', 'sensor.t_old', 'weather.old', 'media_player.old']);
  });
});

describe('profile sync shapes', () => {
  test('the insides of tile options, alert rules, saved colors and seasonal themes are not checked', () => {
    expect(hasSyncShape('quickAccessTileOptions', { 'light.a': { gaugeMin: 'low' } })).toBe(true);
    expect(hasSyncShape('entityAlerts', { alerts: { 'light.a': { durationSeconds: 'x' } } })).toBe(
      true
    );
    expect(hasSyncShape('ui', { customColors: [7], seasonal: { show: 3 } })).toBe(true);
    expect(hasSyncShape('quickAccessTileOptions', { 'light.a': 'wide' })).toBe(false);
  });

  test('a field of a record may be left out or null, but not hold another type', () => {
    expect(hasSyncShape('entityAlerts', { enabled: null })).toBe(true);
    expect(hasSyncShape('entityAlerts', {})).toBe(true);
    expect(hasSyncShape('entityAlerts', { enabled: 'yes' })).toBe(false);
    expect(hasSyncShape('customTabs', [{ id: 'home', name: null }])).toBe(true);
    expect(hasSyncShape('customTabs', [null])).toBe(false);
  });

  test('only synced fields have a sync shape', () => {
    expect(hasSyncShape('desktopPins', {})).toBe(false);
    expect(hasSyncShape('notASetting', {})).toBe(false);
  });
});

describe('entity ids', () => {
  test('a list keeps one copy of each id and leaves the built-in cards alone', () => {
    const { config } = mapEntityIds(
      { favoriteEntities: ['light.a', 'light.b', 'light.a'], primaryCards: ['weather', 'light.a'] },
      (id) => (id === 'light.b' ? 'light.a' : id === 'weather' ? 'weather.x' : id)
    );
    expect(config.favoriteEntities).toEqual(['light.a']);
    expect(config.primaryCards).toEqual(['weather', 'light.a']);
  });

  test('when two keys end up the same, the one that was already right keeps its value', () => {
    const rename = (id) => (id === 'light.old' ? 'light.new' : id);
    expect(
      mapEntityIds({ customEntityNames: { 'light.old': 'Old', 'light.new': 'New' } }, rename).config
        .customEntityNames
    ).toEqual({ 'light.new': 'New' });
    expect(
      mapEntityIds({ customEntityNames: { 'light.new': 'New', 'light.old': 'Old' } }, rename).config
        .customEntityNames
    ).toEqual({ 'light.new': 'New' });
  });

  test('a page saved with its entities under their old name moves them once one is renamed', () => {
    const rename = (id) => (id === 'light.old' ? 'light.new' : id);
    const legacy = { customTabs: [{ id: 'home', entities: ['light.old'] }] };
    expect(mapEntityIds(legacy, rename).config.customTabs).toEqual([
      { id: 'home', entityIds: ['light.new'] },
    ]);
    const untouched = { customTabs: [{ id: 'home', entities: ['light.other'] }] };
    expect(mapEntityIds(untouched, rename)).toEqual({ config: untouched, changed: false });
  });

  test('values that are not what the field holds are left as they are', () => {
    const config = { customTabs: [null, 'page'], tileSpans: 'wide', selectedWeatherEntity: 7 };
    expect(mapEntityIds(config, () => 'light.x')).toEqual({ config, changed: false });
    expect(mapEntityIds(null, () => 'light.x')).toEqual({ config: null, changed: false });
  });
});

describe('defaults and controls', () => {
  test('a new config starts with every seeded default, and each call gets its own copy', () => {
    const first = defaultSettings();
    first.favoriteEntities.push('light.a');
    first.ui.customColors.push({});
    expect(defaultSettings().favoriteEntities).toEqual([]);
    expect(defaultSettings().ui.customColors).toEqual([]);
    expect(first.ui).not.toHaveProperty('desktopPinSnap');
  });

  test('a value not of the setting’s shape reads as the default', () => {
    expect(settingValue({ ui: { desktopPinSnap: 'no' } }, 'ui.desktopPinSnap')).toBe(true);
    expect(settingValue({ ui: { density: 'spacious' } }, 'ui.density')).toBe('comfortable');
    expect(settingValue(null, 'ui.activeTileGlow')).toBe(true);
    expect(() => settingValue({}, 'ui.notASetting')).toThrow('Unknown setting');
  });

  test('a setting a new config leaves unset stays unset until it is changed', () => {
    expect(storeSetting({ ui: {} }, 'ui.desktopPinSnap', true)).toEqual({ ui: {} });
    expect(storeSetting({ ui: {} }, 'ui.desktopPinSnap', false)).toEqual({
      ui: { desktopPinSnap: false },
    });
    // Once saved, it is saved whichever way it is turned.
    expect(storeSetting({ ui: { desktopPinSnap: false } }, 'ui.desktopPinSnap', true)).toEqual({
      ui: { desktopPinSnap: true },
    });
    // A seeded setting is always saved, and a value it does not offer saves its default.
    expect(storeSetting({}, 'ui.activeTileGlow', true)).toEqual({ ui: { activeTileGlow: true } });
    expect(storeSetting({ ui: {} }, 'ui.density', 'spacious')).toEqual({
      ui: { density: 'comfortable' },
    });
  });

  test('every bound control is in the Settings markup, as a switch or a list of its choices', () => {
    const page = new DOMParser().parseFromString(
      fs.readFileSync(path.resolve(__dirname, '../../index.html'), 'utf8'),
      'text/html'
    );
    expect(SETTING_CONTROLS.length).toBeGreaterThan(0);
    SETTING_CONTROLS.forEach(({ path: key, id }) => {
      const control = page.getElementById(id);
      expect(control).not.toBeNull();
      const value = settingValue({}, key);
      if (typeof value === 'boolean') expect(control.type).toBe('checkbox');
      else expect([...control.options].map((option) => option.value)).toContain(value);
    });
  });
});

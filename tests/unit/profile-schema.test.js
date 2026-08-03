/**
 * @jest-environment jsdom
 */

const {
  PROFILE_SCHEMA_VERSION,
  PROFILE_SECTION_KEYS,
  buildConfigPatchFromApplyPayload,
  normalizeProfileDocument,
} = require('../../src/profile-schema');

describe('normalizeProfileDocument', () => {
  test('rejects non-object documents', () => {
    expect(() => normalizeProfileDocument(null)).toThrow('must be an object');
    expect(() => normalizeProfileDocument(['ui'])).toThrow('must be an object');
  });

  test('keeps only sections the document mentions', () => {
    const normalized = normalizeProfileDocument({ opacity: 0.8 });
    expect(normalized).toEqual({ opacity: 0.8 });
    expect('ui' in normalized).toBe(false);
    expect('customTabs' in normalized).toBe(false);
  });

  test('drops local-only ui fields but keeps shared appearance', () => {
    const normalized = normalizeProfileDocument({
      ui: {
        theme: 'dark',
        accent: 'teal',
        personalizationSectionsCollapsed: { colors: true },
        enableInteractionDebugLogs: true,
      },
    });
    expect(normalized.ui).toEqual({ theme: 'dark', accent: 'teal' });
  });

  test('normalizes quick access tabs and derives favorites', () => {
    const normalized = normalizeProfileDocument({
      customTabs: [{ id: 'office', name: 'Office', entityIds: ['light.desk', 'switch.fan'] }],
      activeTabId: 'office',
    });
    expect(normalized.customTabs).toHaveLength(1);
    expect(normalized.activeTabId).toBe('office');
    expect(normalized.favoriteEntities).toEqual(
      expect.arrayContaining(['light.desk', 'switch.fan'])
    );
  });

  test('drops comparison graphs that no tab references', () => {
    const normalized = normalizeProfileDocument({
      customTabs: [{ id: 'office', name: 'Office', entityIds: ['graph:live'] }],
      comparisonGraphs: [
        { id: 'graph:live', name: 'Temps', span: 2, entityIds: ['sensor.office_temp'] },
        { id: 'graph:orphan', name: 'Unused', span: 2, entityIds: ['sensor.other'] },
      ],
    });
    expect(normalized.comparisonGraphs.map((graph) => graph.id)).toEqual(['graph:live']);
  });

  test('bounds primary cards, icon maps, tile options, opacity, and frosted glass', () => {
    const normalized = normalizeProfileDocument({
      primaryCards: ['weather', 'time', 'extra'],
      customEntityIcons: { 'light.desk': 'mdi:lamp', 'light.bad': 42, '': 'mdi:none' },
      quickAccessTileOptions: { 'light.desk': { size: 'wide' }, 'light.bad': 'nope' },
      opacity: 3,
      frostedGlass: 'yes',
    });
    expect(normalized.primaryCards).toEqual(['weather', 'time']);
    expect(normalized.customEntityIcons).toEqual({ 'light.desk': 'mdi:lamp' });
    expect(normalized.quickAccessTileOptions).toEqual({ 'light.desk': { size: 'wide' } });
    expect(normalized.opacity).toBe(1);
    expect(normalized.frostedGlass).toBe(false);

    expect(normalizeProfileDocument({ opacity: 0.1 }).opacity).toBe(0.5);
  });

  test('every normalized key is a declared profile section', () => {
    const normalized = normalizeProfileDocument({
      ui: { theme: 'dark' },
      primaryCards: ['weather'],
      favoriteEntities: ['light.desk'],
      customTabs: [],
      activeTabId: '',
      comparisonGraphs: [],
      quickAccessTileOptions: {},
      customEntityIcons: {},
      opacity: 0.9,
      frostedGlass: true,
      unknownSection: { evil: true },
    });
    for (const key of Object.keys(normalized)) {
      expect(PROFILE_SECTION_KEYS).toContain(key);
    }
    expect('unknownSection' in normalized).toBe(false);
  });
});

describe('buildConfigPatchFromApplyPayload', () => {
  const payload = (overrides = {}) => ({
    profile_id: 'profile-1',
    revision: 3,
    schema_version: PROFILE_SCHEMA_VERSION,
    profile: { ui: { theme: 'dark' }, opacity: 0.85 },
    ...overrides,
  });

  test('rejects unsupported schema versions and missing identity', () => {
    expect(() => buildConfigPatchFromApplyPayload(payload({ schema_version: 99 }))).toThrow(
      'Unsupported profile schema version 99'
    );
    expect(() => buildConfigPatchFromApplyPayload(payload({ profile_id: '' }))).toThrow(
      'profile identity'
    );
    expect(() => buildConfigPatchFromApplyPayload(payload({ revision: -1 }))).toThrow(
      'profile identity'
    );
  });

  test('merges the profile ui over current ui so local-only fields survive', () => {
    const patch = buildConfigPatchFromApplyPayload(payload(), {
      ui: {
        theme: 'auto',
        personalizationSectionsCollapsed: { colors: true },
        enableInteractionDebugLogs: true,
      },
    });
    expect(patch.ui).toEqual({
      theme: 'dark',
      personalizationSectionsCollapsed: { colors: true },
      enableInteractionDebugLogs: true,
    });
    expect(patch.opacity).toBe(0.85);
  });

  test('records the applied profile identity for drift reporting', () => {
    const patch = buildConfigPatchFromApplyPayload(payload());
    expect(patch.haProfile.activeProfileId).toBe('profile-1');
    expect(patch.haProfile.revision).toBe(3);
    expect(typeof patch.haProfile.appliedAt).toBe('string');
    expect(patch.haProfile.appliedAt).not.toBe('');
  });

  test('does not touch sections the profile omits', () => {
    const patch = buildConfigPatchFromApplyPayload(payload({ profile: { opacity: 0.7 } }), {
      ui: { theme: 'auto' },
    });
    expect('ui' in patch).toBe(false);
    expect('customTabs' in patch).toBe(false);
    expect('favoriteEntities' in patch).toBe(false);
    expect(patch.opacity).toBe(0.7);
  });
});

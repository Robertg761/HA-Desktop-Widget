/**
 * @jest-environment jsdom
 */

const i18n = require('../../packages/widget-renderer/src/i18n.js');
const {
  getActiveQuickAccessTab,
  normalizeQuickAccessConfig,
  renameQuickAccessView,
  addQuickAccessView,
} = require('../../src/quick-access-tabs.js');
const { toStoredPage, toStoredPages } = require('../../src/page-names.cjs');
const { duplicateQuickAccessView } = require('../../src/page-duplication.js');

const GERMAN = {
  All: 'Alle',
  'View {{index}}': 'Ansicht {{index}}',
  '{{name}} copy': '{{name}} Kopie',
};

function speak(locale) {
  i18n.setLocaleBootstrap({ activeLocale: locale, messages: locale === 'de' ? GERMAN : {} });
}

afterEach(() => speak('en'));

describe('pages nobody named', () => {
  it('are named in the language of the interface, and marked as unnamed', () => {
    speak('de');

    const config = normalizeQuickAccessConfig({
      customTabs: [
        { id: 'a', name: '', entityIds: [] },
        { id: 'b', entityIds: [] },
        { id: 'c', name: '  ', entityIds: [] },
      ],
    });

    expect(config.customTabs.map(({ name }) => name)).toEqual(['Alle', 'Ansicht 2', 'Ansicht 3']);
    expect(config.customTabs.every((tab) => tab.nameIsDefault === true)).toBe(true);
  });

  it('follow a change of language, because the name is not what is kept', () => {
    speak('de');
    const german = normalizeQuickAccessConfig({ favoriteEntities: ['light.a'] });
    expect(german.customTabs[0]).toMatchObject({ name: 'Alle', nameIsDefault: true });

    speak('en');
    // The same state, normalized again after the language changed.
    const english = normalizeQuickAccessConfig(german);

    expect(english.customTabs[0]).toMatchObject({ name: 'All', nameIsDefault: true });
    expect(getActiveQuickAccessTab(german).name).toBe('All');
  });

  it('are stored without a name, so a profile carries no language to other computers', () => {
    speak('de');
    const config = normalizeQuickAccessConfig({ favoriteEntities: ['light.a'] });

    expect(toStoredPages(config.customTabs)).toEqual([
      { id: 'default', name: '', entityIds: ['light.a'] },
    ]);
  });

  it('do not count as a change to what is stored, so the renderer does not write them back', () => {
    speak('de');
    const stored = {
      customTabs: [{ id: 'default', name: '', entityIds: ['light.a'] }],
      activeTabId: 'default',
      favoriteEntities: ['light.a'],
    };

    expect(normalizeQuickAccessConfig(stored, { withChanged: true }).changed).toBe(false);
    // A config with no pages at all is a change: the default page is made.
    expect(normalizeQuickAccessConfig({}, { withChanged: true }).changed).toBe(true);
    // A name missing altogether is stored as an empty one, once.
    expect(
      normalizeQuickAccessConfig(
        { ...stored, customTabs: [{ id: 'default', entityIds: ['light.a'] }] },
        { withChanged: true }
      ).changed
    ).toBe(true);
  });

  it('keep a name somebody typed, even one that matches the default of some language', () => {
    speak('de');

    const config = normalizeQuickAccessConfig({
      customTabs: [
        { id: 'a', name: 'All', entityIds: [] },
        { id: 'b', name: 'Alle', entityIds: [] },
      ],
    });

    expect(config.customTabs.map(({ name }) => name)).toEqual(['All', 'Alle']);
    expect(config.customTabs.some((tab) => tab.nameIsDefault)).toBe(false);
    expect(toStoredPages(config.customTabs)).toEqual(config.customTabs);
  });

  it('become named for good when renamed, and stay unnamed when "renamed" to the name they show', () => {
    speak('de');
    const base = normalizeQuickAccessConfig({ favoriteEntities: ['light.a'] });

    const same = renameQuickAccessView(base, 'default', 'Alle');
    expect(same.customTabs[0].nameIsDefault).toBe(true);

    const renamed = renameQuickAccessView(base, 'default', 'Wohnzimmer');
    expect(renamed.customTabs[0]).toEqual({
      id: 'default',
      name: 'Wohnzimmer',
      entityIds: ['light.a'],
    });
    speak('en');
    expect(normalizeQuickAccessConfig(renamed).customTabs[0].name).toBe('Wohnzimmer');
  });

  it('are not passed on to a page made from them', () => {
    speak('de');
    const base = normalizeQuickAccessConfig({ favoriteEntities: ['light.a'] });

    const duplicated = duplicateQuickAccessView(base, 'default', { idFactory: () => 'copy' });
    const added = addQuickAccessView(base, 'Küche', { idFactory: () => 'kitchen' });

    expect(duplicated.customTabs.map(({ name }) => name)).toEqual(['Alle', 'Alle Kopie']);
    expect(duplicated.customTabs[1].nameIsDefault).toBeUndefined();
    expect(added.customTabs[1]).toMatchObject({ name: 'Küche' });
    expect(added.customTabs[1].nameIsDefault).toBeUndefined();
  });
});

describe('toStoredPage', () => {
  it('leaves named pages, non-objects and the rest of the page alone', () => {
    expect(toStoredPage({ id: 'a', name: 'Kitchen', entityIds: ['x'], extra: 1 })).toEqual({
      id: 'a',
      name: 'Kitchen',
      entityIds: ['x'],
      extra: 1,
    });
    expect(toStoredPage(null)).toBeNull();
    expect(toStoredPages('not a list')).toBe('not a list');
  });
});

describe('the profile document sent to Home Assistant', () => {
  const {
    buildProfileDocumentFromConfig,
  } = require('../../packages/widget-renderer/src/profile-schema.js');

  it('leaves an unnamed page unnamed, so each desktop names it in its own language', () => {
    speak('de');

    const profile = buildProfileDocumentFromConfig({
      customTabs: [
        { id: 'default', name: '', entityIds: ['light.a'] },
        { id: 'kitchen', name: 'Küche', entityIds: [] },
      ],
      activeTabId: 'default',
    });

    expect(profile.customTabs).toEqual([
      { id: 'default', name: '', entityIds: ['light.a'] },
      { id: 'kitchen', name: 'Küche', entityIds: [] },
    ]);
  });

  it('is named by the desktop that applies it, in that desktop’s language', () => {
    const {
      buildConfigPatchFromApplyPayload,
    } = require('../../packages/widget-renderer/src/profile-schema.js');
    speak('de');
    const sent = buildProfileDocumentFromConfig({
      customTabs: [{ id: 'default', name: '', entityIds: ['light.a'] }],
      activeTabId: 'default',
    });

    speak('en');
    const patch = buildConfigPatchFromApplyPayload(
      { schema_version: 1, profile_id: 'home', revision: 1, profile: sent },
      {}
    );

    expect(patch.customTabs[0]).toMatchObject({ name: 'All', nameIsDefault: true });
  });
});

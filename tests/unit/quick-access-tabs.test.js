const {
  addEntityToQuickAccessView,
  addQuickAccessView,
  deleteQuickAccessView,
  moveEntityToQuickAccessView,
  normalizeQuickAccessConfig,
  removeEntityFromQuickAccessView,
  removeEntityFromQuickAccessViews,
  renameQuickAccessView,
  reorderQuickAccessView,
} = require('../../src/quick-access-tabs.js');

describe('quick-access-tabs helpers', () => {
  test('migrates favoriteEntities into a single default view', () => {
    const config = normalizeQuickAccessConfig({
      favoriteEntities: ['light.kitchen', '', 'switch.fan', 'light.kitchen'],
    });

    expect(config.customTabs).toEqual([
      {
        id: 'default',
        name: 'All',
        entityIds: ['light.kitchen', 'switch.fan'],
      },
    ]);
    expect(config.activeTabId).toBe('default');
    expect(config.favoriteEntities).toEqual(['light.kitchen', 'switch.fan']);
  });

  test('normalizes legacy customTabs and keeps favoriteEntities as the union', () => {
    const config = normalizeQuickAccessConfig({
      activeTabId: 'bedroom',
      favoriteEntities: ['light.old'],
      customTabs: [
        { id: 'lights', name: 'Lights', entities: ['light.kitchen', 'light.kitchen'] },
        { id: 'bedroom', name: 'Bedroom', entityIds: ['switch.fan'] },
      ],
    });

    expect(config.customTabs).toEqual([
      { id: 'lights', name: 'Lights', entityIds: ['light.kitchen'] },
      { id: 'bedroom', name: 'Bedroom', entityIds: ['switch.fan'] },
    ]);
    expect(config.activeTabId).toBe('bedroom');
    expect(config.favoriteEntities).toEqual(['light.kitchen', 'switch.fan']);
  });

  test('adds, renames, and deletes views without deleting the last view', () => {
    const base = normalizeQuickAccessConfig({
      favoriteEntities: ['light.kitchen'],
    });
    const added = addQuickAccessView(base, 'Bedroom', { idFactory: () => 'bedroom' });

    expect(added.activeTabId).toBe('bedroom');
    expect(added.customTabs.map((tab) => tab.name)).toEqual(['All', 'Bedroom']);

    const renamed = renameQuickAccessView(added, 'bedroom', 'Guest Room');
    expect(renamed.customTabs[1].name).toBe('Guest Room');

    const deleted = deleteQuickAccessView(renamed, 'bedroom');
    expect(deleted.customTabs).toEqual([
      { id: 'default', name: 'All', entityIds: ['light.kitchen'] },
    ]);
    expect(deleted.activeTabId).toBe('default');

    const deleteLast = deleteQuickAccessView(deleted, 'default');
    expect(deleteLast.customTabs).toEqual(deleted.customTabs);
    expect(deleteLast.favoriteEntities).toEqual(['light.kitchen']);
  });

  test('moves to a neighbouring page when the page on screen is deleted', () => {
    const config = normalizeQuickAccessConfig({
      activeTabId: 'kitchen',
      customTabs: [
        { id: 'default', name: 'All', entityIds: [] },
        { id: 'kitchen', name: 'Kitchen', entityIds: [] },
        { id: 'bedroom', name: 'Bedroom', entityIds: [] },
      ],
    });
    expect(deleteQuickAccessView(config, 'kitchen').activeTabId).toBe('bedroom');
    const onLast = { ...config, activeTabId: 'bedroom' };
    expect(deleteQuickAccessView(onLast, 'bedroom').activeTabId).toBe('kitchen');
    expect(deleteQuickAccessView(onLast, 'kitchen').activeTabId).toBe('bedroom');
  });

  test('moves an entity between views and removes it from all views', () => {
    const config = normalizeQuickAccessConfig({
      activeTabId: 'all',
      customTabs: [
        { id: 'all', name: 'All', entityIds: ['light.kitchen', 'switch.fan'] },
        { id: 'office', name: 'Office', entityIds: ['sensor.temp'] },
      ],
    });

    const moved = moveEntityToQuickAccessView(config, 'switch.fan', 'office');
    expect(moved.customTabs[0].entityIds).toEqual(['light.kitchen']);
    expect(moved.customTabs[1].entityIds).toEqual(['sensor.temp', 'switch.fan']);
    expect(moved.favoriteEntities).toEqual(['light.kitchen', 'sensor.temp', 'switch.fan']);

    const removed = removeEntityFromQuickAccessViews(moved, 'switch.fan');
    expect(removed.customTabs[1].entityIds).toEqual(['sensor.temp']);
    expect(removed.favoriteEntities).toEqual(['light.kitchen', 'sensor.temp']);
  });

  test('adds and removes an entity on one page without touching a page that shares it', () => {
    const config = normalizeQuickAccessConfig({
      activeTabId: 'copy',
      customTabs: [
        { id: 'home', name: 'Home', entityIds: ['light.kitchen', 'switch.fan'] },
        { id: 'copy', name: 'Home copy', entityIds: ['light.kitchen', 'switch.fan'] },
      ],
    });

    const removed = removeEntityFromQuickAccessView(config, 'light.kitchen', 'copy');
    expect(removed.customTabs[0].entityIds).toEqual(['light.kitchen', 'switch.fan']);
    expect(removed.customTabs[1].entityIds).toEqual(['switch.fan']);
    // Still on the original page, so it stays in the favorites union.
    expect(removed.favoriteEntities).toEqual(['light.kitchen', 'switch.fan']);

    const readded = addEntityToQuickAccessView(removed, 'light.kitchen', 'copy');
    expect(readded.customTabs[0].entityIds).toEqual(['light.kitchen', 'switch.fan']);
    expect(readded.customTabs[1].entityIds).toEqual(['switch.fan', 'light.kitchen']);
    expect(
      addEntityToQuickAccessView(readded, 'light.kitchen', 'copy').customTabs[1].entityIds
    ).toEqual(['switch.fan', 'light.kitchen']);

    const gone = removeEntityFromQuickAccessView(removed, 'light.kitchen', 'home');
    expect(gone.favoriteEntities).toEqual(['switch.fan']);
  });

  test('page-scoped add and remove ignore unknown pages and blank entity ids', () => {
    const config = normalizeQuickAccessConfig({
      customTabs: [{ id: 'home', name: 'Home', entityIds: ['light.kitchen'] }],
    });
    expect(addEntityToQuickAccessView(config, 'light.a', 'missing')).toEqual(config);
    expect(removeEntityFromQuickAccessView(config, 'light.kitchen', 'missing')).toEqual(config);
    expect(addEntityToQuickAccessView(config, '  ', 'home')).toEqual(config);
    expect(removeEntityFromQuickAccessView(config, '', 'home')).toEqual(config);
  });

  test('reorders only the requested view and preserves missing current entities', () => {
    const config = normalizeQuickAccessConfig({
      activeTabId: 'downstairs',
      customTabs: [
        { id: 'downstairs', name: 'Downstairs', entityIds: ['light.a', 'light.b', 'light.c'] },
        { id: 'upstairs', name: 'Upstairs', entityIds: ['light.d'] },
      ],
    });

    const reordered = reorderQuickAccessView(config, 'downstairs', ['light.c', 'light.a']);
    expect(reordered.customTabs[0].entityIds).toEqual(['light.c', 'light.a', 'light.b']);
    expect(reordered.customTabs[1].entityIds).toEqual(['light.d']);
    expect(reordered.favoriteEntities).toEqual(['light.c', 'light.a', 'light.b', 'light.d']);
  });

  test('numbers pages that share an id one after another without clashing with later ids', () => {
    const config = normalizeQuickAccessConfig({
      customTabs: [
        { id: 'page', name: 'A', entityIds: [] },
        { id: 'page', name: 'B', entityIds: [] },
        { id: 'page-2', name: 'C', entityIds: [] },
        { id: 'page', name: 'D', entityIds: [] },
        { id: 'page', name: 'E', entityIds: [] },
      ],
    });

    expect(config.customTabs.map((tab) => tab.id)).toEqual([
      'page',
      'page-2',
      'page-2-2',
      'page-3',
      'page-4',
    ]);
  });

  test('normalizes tens of thousands of pages sharing one id in a moment', () => {
    // A settings file can name any number of pages, and each repeat used to count up past all
    // the earlier ones, so a file of a few hundred kilobytes froze the window for many seconds.
    const customTabs = Array.from({ length: 20000 }, () => ({
      id: 'page',
      name: 'Page',
      entityIds: [],
    }));

    const started = Date.now();
    const config = normalizeQuickAccessConfig({ customTabs });

    expect(Date.now() - started).toBeLessThan(2000);
    expect(new Set(config.customTabs.map((tab) => tab.id)).size).toBe(20000);
    expect(config.customTabs[19999].id).toBe('page-20000');
  });
});

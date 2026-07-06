const {
  addQuickAccessView,
  deleteQuickAccessView,
  moveEntityToQuickAccessView,
  normalizeQuickAccessConfig,
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
    expect(added.customTabs.map(tab => tab.name)).toEqual(['All', 'Bedroom']);

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
});

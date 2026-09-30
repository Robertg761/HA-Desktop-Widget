const { duplicateQuickAccessView } = require('../../src/page-duplication.js');

describe('page duplication', () => {
  const base = {
    customTabs: [
      { id: 'home', name: 'Home', entityIds: ['light.kitchen', 'graph:temps', 'switch.fan'] },
      { id: 'bed', name: 'Bedroom', entityIds: [] },
    ],
    activeTabId: 'home',
    comparisonGraphs: [
      {
        id: 'graph:temps',
        name: 'Temperatures',
        span: 3,
        entityIds: ['sensor.indoor', 'sensor.outdoor'],
      },
    ],
    customEntityNames: { 'light.kitchen': 'Kitchen' },
    desktopPins: { 'light.kitchen': { enabled: true } },
  };
  test('inserts the copy beside the original and keeps tile order and entity preferences', () => {
    const next = duplicateQuickAccessView(base, 'home', { idFactory: () => 'new' });
    expect(next.customTabs.map((tab) => tab.id)).toEqual(['home', 'new', 'bed']);
    expect(next.activeTabId).toBe('new');
    expect(next.customTabs[1]).toEqual({
      id: 'new',
      name: 'Home copy',
      entityIds: ['light.kitchen', 'graph:temps-copy', 'switch.fan'],
    });
    expect(next.customEntityNames).toEqual(base.customEntityNames);
    expect(next.desktopPins).toEqual(base.desktopPins);
    expect(base.customTabs).toHaveLength(2);
    expect(base.comparisonGraphs).toHaveLength(1);
  });
  test('copies graphs independently and avoids ID and name collisions', () => {
    const first = duplicateQuickAccessView(base, 'home', { idFactory: () => 'home' });
    const next = duplicateQuickAccessView(first, 'home', { idFactory: () => 'home' });
    expect(next.customTabs[1].name).toBe('Home copy 2');
    expect(new Set(next.customTabs.map((tab) => tab.id)).size).toBe(4);
    expect(next.comparisonGraphs.map((graph) => graph.id)).toEqual([
      'graph:temps',
      'graph:temps-copy',
      'graph:temps-copy-2',
    ]);
    next.comparisonGraphs[1].entityIds.push('sensor.extra');
    expect(next.comparisonGraphs[0].entityIds).toHaveLength(2);
    expect(base.comparisonGraphs[0].entityIds).toHaveLength(2);
  });
  test('supports empty pages and ignores a missing page', () => {
    expect(duplicateQuickAccessView(base, 'bed').customTabs[2].entityIds).toEqual([]);
    expect(duplicateQuickAccessView(base, 'missing').customTabs).toEqual(base.customTabs);
  });
});

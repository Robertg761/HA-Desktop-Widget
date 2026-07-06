jest.mock('../../src/ui.js', () => ({
  openEntityDetailModal: jest.fn(),
  getEntityDomain: entityId => String(entityId || '').split('.')[0],
}));

const {
  rankCommandPaletteEntities,
  scoreCommandPaletteMatch,
} = require('../../src/command-palette.js');

describe('command palette fuzzy scoring', () => {
  it('scores exact, prefix, substring, and subsequence matches in descending tiers', () => {
    const exact = scoreCommandPaletteMatch('Kitchen Light', 'Kitchen Light');
    const prefix = scoreCommandPaletteMatch('Kitchen Light', 'Kitchen');
    const substring = scoreCommandPaletteMatch('Kitchen Light', 'Light');
    const subsequence = scoreCommandPaletteMatch('Kitchen Light', 'ktn');

    expect(exact).toBeGreaterThan(prefix);
    expect(prefix).toBeGreaterThan(substring);
    expect(substring).toBeGreaterThan(subsequence);
    expect(subsequence).toBeGreaterThan(0);
  });

  it('returns zero for no-match queries', () => {
    expect(scoreCommandPaletteMatch('Kitchen Light', 'garage')).toBe(0);
  });

  it('ranks entities by display name and entity id matches', () => {
    const entities = [
      { entity_id: 'sensor.outdoor_temperature', state: '22', attributes: { friendly_name: 'Outside Temp' } },
      { entity_id: 'light.kitchen', state: 'on', attributes: { friendly_name: 'Kitchen Light' } },
      { entity_id: 'switch.kettle', state: 'off', attributes: { friendly_name: 'Kettle' } },
    ];

    const ranked = rankCommandPaletteEntities(entities, 'kitchen', {
      getDisplayName: entity => entity.attributes.friendly_name,
    });

    expect(ranked.map(item => item.entity.entity_id)).toEqual(['light.kitchen']);
  });
});

const {
  getNextQuickAccessFocusIndex,
  matchesQuickAccessTileFilter,
} = require('../../src/quick-access-ui-helpers.js');

describe('quick access UI helpers', () => {
  describe('matchesQuickAccessTileFilter', () => {
    it('matches by display name or entity id case-insensitively', () => {
      const tile = { name: 'Kitchen Pendant', entityId: 'light.kitchen_pendant' };

      expect(matchesQuickAccessTileFilter(tile, 'pendant')).toBe(true);
      expect(matchesQuickAccessTileFilter(tile, 'LIGHT.KITCHEN')).toBe(true);
      expect(matchesQuickAccessTileFilter(tile, 'garage')).toBe(false);
    });

    it('treats blank filters as a match', () => {
      expect(matchesQuickAccessTileFilter({ name: 'Office', entityId: 'light.office' }, '   ')).toBe(true);
    });
  });

  describe('getNextQuickAccessFocusIndex', () => {
    it('moves horizontally and clamps at edges', () => {
      expect(getNextQuickAccessFocusIndex(0, 4, 'ArrowLeft', 2)).toBe(0);
      expect(getNextQuickAccessFocusIndex(0, 4, 'ArrowRight', 2)).toBe(1);
      expect(getNextQuickAccessFocusIndex(3, 4, 'ArrowRight', 2)).toBe(3);
    });

    it('moves vertically by grid column count', () => {
      expect(getNextQuickAccessFocusIndex(1, 6, 'ArrowDown', 3)).toBe(4);
      expect(getNextQuickAccessFocusIndex(4, 6, 'ArrowUp', 3)).toBe(1);
      expect(getNextQuickAccessFocusIndex(4, 6, 'ArrowDown', 3)).toBe(5);
    });

    it('supports Home and End', () => {
      expect(getNextQuickAccessFocusIndex(2, 5, 'Home', 3)).toBe(0);
      expect(getNextQuickAccessFocusIndex(2, 5, 'End', 3)).toBe(4);
    });
  });
});

/**
 * @jest-environment node
 */

const { shouldBlockConfigWrite } = require('../../src/config-write-guard.cjs');

describe('config write guard', () => {
  it('blocks only an explicitly unsafe load state', () => {
    expect(shouldBlockConfigWrite({ blockedReason: 'existing config could not be read' })).toBe(
      true
    );
    expect(shouldBlockConfigWrite({ blockedReason: '' })).toBe(false);
  });

  it('does not infer corruption from an intentional clear-to-default mutation', () => {
    expect(
      shouldBlockConfigWrite({
        blockedReason: '',
        existingConfig: { favoriteEntities: ['light.office'] },
        nextConfig: { favoriteEntities: [] },
      })
    ).toBe(false);
  });
});

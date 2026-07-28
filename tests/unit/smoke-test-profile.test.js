/**
 * @jest-environment node
 */

const {
  isSafeSmokeTestProfilePath,
  removeSmokeTestProfile,
} = require('../../src/smoke-test-profile.cjs');

describe('smoke-test profile cleanup', () => {
  it('allows only a direct temporary child with the smoke profile prefix', () => {
    expect(isSafeSmokeTestProfilePath('/tmp/ha-desktop-widget-smoke-a1b2c3', '/tmp')).toBe(true);
    expect(isSafeSmokeTestProfilePath('/tmp', '/tmp')).toBe(false);
    expect(isSafeSmokeTestProfilePath('/', '/tmp')).toBe(false);
    expect(isSafeSmokeTestProfilePath('/tmp/unrelated', '/tmp')).toBe(false);
    expect(isSafeSmokeTestProfilePath('/tmp/ha-desktop-widget-smoke-a1b2c3/nested', '/tmp')).toBe(
      false
    );
    expect(isSafeSmokeTestProfilePath('/var/tmp/ha-desktop-widget-smoke-a1b2c3', '/tmp')).toBe(
      false
    );
  });

  it('removes exactly the validated profile and refuses broad paths', () => {
    const fsModule = { rmSync: jest.fn() };

    expect(removeSmokeTestProfile('/tmp/ha-desktop-widget-smoke-a1b2c3', '/tmp', fsModule)).toEqual(
      { success: true }
    );
    expect(fsModule.rmSync).toHaveBeenCalledWith(
      '/tmp/ha-desktop-widget-smoke-a1b2c3',
      expect.objectContaining({ recursive: true, force: true })
    );

    fsModule.rmSync.mockClear();
    expect(removeSmokeTestProfile('/tmp', '/tmp', fsModule)).toEqual(
      expect.objectContaining({ success: false })
    );
    expect(fsModule.rmSync).not.toHaveBeenCalled();
  });

  it('reports filesystem cleanup failures without widening the target', () => {
    const fsModule = {
      rmSync: jest.fn(() => {
        throw new Error('profile is busy');
      }),
    };

    expect(removeSmokeTestProfile('/tmp/ha-desktop-widget-smoke-a1b2c3', '/tmp', fsModule)).toEqual(
      { success: false, error: 'profile is busy' }
    );
  });
});

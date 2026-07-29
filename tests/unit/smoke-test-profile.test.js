/**
 * @jest-environment node
 */

const path = require('path');

const {
  isSafeSmokeTestProfilePath,
  removeSmokeTestProfile,
} = require('../../src/smoke-test-profile.cjs');

// Build fixtures through path.resolve so expectations survive Windows drive-letter
// resolution (path.resolve('/tmp') === 'D:\\tmp' on CI runners).
const TEMP_ROOT = path.resolve('/tmp');
const PROFILE_PATH = path.join(TEMP_ROOT, 'ha-desktop-widget-smoke-a1b2c3');

describe('smoke-test profile cleanup', () => {
  it('allows only a direct temporary child with the smoke profile prefix', () => {
    expect(isSafeSmokeTestProfilePath(PROFILE_PATH, TEMP_ROOT)).toBe(true);
    expect(isSafeSmokeTestProfilePath(TEMP_ROOT, TEMP_ROOT)).toBe(false);
    expect(isSafeSmokeTestProfilePath(path.resolve('/'), TEMP_ROOT)).toBe(false);
    expect(isSafeSmokeTestProfilePath(path.join(TEMP_ROOT, 'unrelated'), TEMP_ROOT)).toBe(false);
    expect(isSafeSmokeTestProfilePath(path.join(PROFILE_PATH, 'nested'), TEMP_ROOT)).toBe(false);
    expect(
      isSafeSmokeTestProfilePath(path.resolve('/var/tmp/ha-desktop-widget-smoke-a1b2c3'), TEMP_ROOT)
    ).toBe(false);
  });

  it('removes exactly the validated profile and refuses broad paths', () => {
    const fsModule = { rmSync: jest.fn() };

    expect(removeSmokeTestProfile(PROFILE_PATH, TEMP_ROOT, fsModule)).toEqual({ success: true });
    expect(fsModule.rmSync).toHaveBeenCalledWith(
      PROFILE_PATH,
      expect.objectContaining({ recursive: true, force: true })
    );

    fsModule.rmSync.mockClear();
    expect(removeSmokeTestProfile(TEMP_ROOT, TEMP_ROOT, fsModule)).toEqual(
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

    expect(removeSmokeTestProfile(PROFILE_PATH, TEMP_ROOT, fsModule)).toEqual({
      success: false,
      error: 'profile is busy',
    });
  });
});

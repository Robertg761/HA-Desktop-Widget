/**
 * @jest-environment node
 */

const { isAccessibilityGranted } = require('../../src/macos-accessibility.cjs');

describe('macOS Accessibility permission for the popup hotkey', () => {
  const preferences = (trusted) => ({ isTrustedAccessibilityClient: jest.fn(() => trusted) });

  it('reports a denied permission on a Mac without raising the system prompt', () => {
    const systemPreferences = preferences(false);

    expect(isAccessibilityGranted({ platform: 'darwin', systemPreferences })).toBe(false);
    // A launch must not show the prompt again each time the permission is still missing.
    expect(systemPreferences.isTrustedAccessibilityClient).toHaveBeenCalledWith(false);
  });

  it('reports a granted permission', () => {
    expect(
      isAccessibilityGranted({ platform: 'darwin', systemPreferences: preferences(true) })
    ).toBe(true);
  });

  it('raises the prompt only when asked to, which is when the user sets a hotkey', () => {
    const systemPreferences = preferences(false);

    isAccessibilityGranted({ platform: 'darwin', systemPreferences, prompt: true });

    expect(systemPreferences.isTrustedAccessibilityClient).toHaveBeenCalledWith(true);
  });

  it.each(['win32', 'linux'])('needs no permission on %s and never asks the system', (platform) => {
    const systemPreferences = preferences(false);

    expect(isAccessibilityGranted({ platform, systemPreferences, prompt: true })).toBe(true);
    expect(systemPreferences.isTrustedAccessibilityClient).not.toHaveBeenCalled();
  });

  it('leaves the verdict to uiohook when the check is unavailable or fails', () => {
    expect(isAccessibilityGranted({ platform: 'darwin', systemPreferences: {} })).toBe(true);
    expect(isAccessibilityGranted({ platform: 'darwin' })).toBe(true);
    expect(
      isAccessibilityGranted({
        platform: 'darwin',
        systemPreferences: {
          isTrustedAccessibilityClient: () => {
            throw new Error('unavailable');
          },
        },
      })
    ).toBe(true);
  });
});

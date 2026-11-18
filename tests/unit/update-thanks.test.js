/**
 * @jest-environment jsdom
 */

// The one notice after an update: when it shows (the first start of a newer release, and only
// then) and what its buttons do.

const { createMockElectronAPI } = require('../mocks/electron.js');

window.electronAPI = createMockElectronAPI();
Object.defineProperty(window, 'matchMedia', {
  writable: true,
  configurable: true,
  value: jest.fn().mockImplementation((query) => ({ matches: false, media: query })),
});

const uiUtils = require('../../src/ui-utils.js');
const {
  LAST_RUN_VERSION_KEY,
  UPDATE_NOTICE_MS,
  isReleaseVersion,
  noteStartedVersion,
  releasePageUrl,
  showUpdateThanks,
} = require('../../src/update-thanks.js');

function memoryStorage(initial = {}) {
  const values = new Map(Object.entries(initial));
  return {
    getItem: (key) => (values.has(key) ? values.get(key) : null),
    setItem: (key, value) => values.set(key, String(value)),
    values,
  };
}

describe('noteStartedVersion', () => {
  it('says nothing on a new install, and notes the version for next time', () => {
    const storage = memoryStorage();
    expect(noteStartedVersion('4.3.0', { wasSetUp: false, storage })).toBe(false);
    expect(storage.values.get(LAST_RUN_VERSION_KEY)).toBe('4.3.0');
    expect(noteStartedVersion('4.3.0', { wasSetUp: true, storage })).toBe(false);
  });

  it('welcomes a set-up computer that ran a release from before the notice existed', () => {
    const storage = memoryStorage();
    expect(noteStartedVersion('4.3.0', { wasSetUp: true, storage })).toBe(true);
    // Once: the next start of the same version is quiet.
    expect(noteStartedVersion('4.3.0', { wasSetUp: true, storage })).toBe(false);
  });

  it('shows once on the first start of each newer release, betas included', () => {
    const storage = memoryStorage({ [LAST_RUN_VERSION_KEY]: '4.2.0' });
    expect(noteStartedVersion('4.3.0-beta.1', { storage })).toBe(true);
    expect(noteStartedVersion('4.3.0-beta.1', { storage })).toBe(false);
    expect(noteStartedVersion('4.3.0', { storage })).toBe(true);
    expect(noteStartedVersion('4.3.1', { storage })).toBe(true);
  });

  it('stays quiet after going back to an older version', () => {
    const storage = memoryStorage({ [LAST_RUN_VERSION_KEY]: '4.3.0' });
    expect(noteStartedVersion('4.2.0', { storage })).toBe(false);
    expect(storage.values.get(LAST_RUN_VERSION_KEY)).toBe('4.2.0');
  });

  it('ignores development builds, which have no release page', () => {
    const storage = memoryStorage({ [LAST_RUN_VERSION_KEY]: '4.2.0' });
    expect(noteStartedVersion('dev', { storage })).toBe(false);
    expect(noteStartedVersion('4.3.0-dev', { storage })).toBe(false);
    expect(storage.values.get(LAST_RUN_VERSION_KEY)).toBe('4.2.0');
    expect(isReleaseVersion('4.3.0')).toBe(true);
    expect(isReleaseVersion('4.3.0-beta.2')).toBe(true);
  });

  it('says nothing when the version cannot be noted, so it is not announced on every start', () => {
    const storage = {
      getItem: () => '4.2.0',
      setItem: () => {
        throw new Error('storage is full');
      },
    };
    expect(noteStartedVersion('4.3.0', { storage })).toBe(false);
    const unreadable = {
      getItem: () => {
        throw new Error('denied');
      },
      setItem: () => {
        throw new Error('denied');
      },
    };
    expect(noteStartedVersion('4.3.0', { wasSetUp: true, storage: unreadable })).toBe(false);
  });
});

describe('the after-update notice', () => {
  const container = () => document.getElementById('toast-container');

  beforeEach(() => {
    document.body.innerHTML = '<div id="toast-container" role="status"></div>';
    jest.useFakeTimers();
    uiUtils.__forceAnimatedModalTransitions(false);
  });

  afterEach(() => {
    jest.runOnlyPendingTimers();
    jest.useRealTimers();
  });

  function show() {
    const actions = { openExternal: jest.fn(), onSupport: jest.fn() };
    const toast = showUpdateThanks('4.3.0', actions);
    return { toast, ...actions };
  }

  it('names the version and asks gently, with What’s new and Support buttons', () => {
    const { toast } = show();
    expect(toast.querySelector('.toast-message').textContent).toBe('Updated to version 4.3.0');
    expect(toast.querySelector('.toast-detail').textContent).toBe(
      'Enjoying the widget? You can support its development.'
    );
    const buttons = [...toast.querySelectorAll('.toast-action')];
    expect(buttons.map((button) => button.textContent)).toEqual(["What's new", 'Support']);
    expect(buttons[1].querySelector('.toast-action-icon svg').dataset.icon).toBe('heart');
    // A toast with buttons can be closed from the keyboard as well.
    expect(toast.querySelector('.toast-close')).not.toBeNull();
  });

  it('opens the release notes and dismisses itself', () => {
    const { toast, openExternal, onSupport } = show();
    toast.querySelector('[data-action="whats-new"]').click();
    expect(openExternal).toHaveBeenCalledWith(releasePageUrl('4.3.0'));
    expect(releasePageUrl('4.3.0')).toBe(
      'https://github.com/Robertg761/HA-Desktop-Widget/releases/tag/v4.3.0'
    );
    expect(onSupport).not.toHaveBeenCalled();
    expect(toast.isConnected).toBe(false);
  });

  it('opens the support dialog and dismisses itself', () => {
    const { toast, openExternal, onSupport } = show();
    toast.querySelector('[data-action="support"]').click();
    expect(onSupport).toHaveBeenCalledTimes(1);
    expect(openExternal).not.toHaveBeenCalled();
    expect(toast.isConnected).toBe(false);
  });

  it('goes away by itself, so it never waits on the user', () => {
    const { toast } = show();
    jest.advanceTimersByTime(UPDATE_NOTICE_MS - 100);
    expect(toast.isConnected).toBe(true);
    jest.advanceTimersByTime(200);
    expect(container().querySelector('.toast')).toBeNull();
  });
});

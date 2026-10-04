/**
 * @jest-environment jsdom
 */

const {
  applyUpdateEvent,
  describeUpdateState,
  getUpdateState,
  reduceUpdateEvent,
  resetUpdateStatus,
  startUpdateStatus,
  subscribeToUpdateState,
} = require('../../src/update-status.js');

describe('update state', () => {
  afterEach(() => resetUpdateStatus());

  describe('reduceUpdateEvent', () => {
    const idle = { status: 'idle' };

    it('follows a self-updating build from check to install', () => {
      let state = reduceUpdateEvent(idle, { status: 'checking' });
      expect(state).toEqual({ status: 'checking' });

      state = reduceUpdateEvent(state, { status: 'available', info: { version: '4.0.1' } });
      expect(state).toEqual({ status: 'available', version: '4.0.1' });

      state = reduceUpdateEvent(state, { status: 'downloading', progress: { percent: 12.4 } });
      expect(state).toEqual({ status: 'downloading', version: '4.0.1', percent: 12 });

      state = reduceUpdateEvent(state, { status: 'downloaded', info: { version: '4.0.1' } });
      expect(state).toEqual({ status: 'downloaded', version: '4.0.1' });
    });

    it('leaves out the start and the failure of a check the app ran on its own', () => {
      const downloading = { status: 'downloading', version: '4.0.1', percent: 40 };
      const none = { status: 'none' };

      // Waking without a network must not leave "Could not reach GitHub" where nobody asked.
      expect(reduceUpdateEvent(none, { status: 'checking', background: true })).toBe(none);
      expect(reduceUpdateEvent(none, { status: 'error', error: 'offline', background: true })).toBe(
        none
      );
      // And a download in progress keeps its bar.
      expect(reduceUpdateEvent(downloading, { status: 'checking', background: true })).toBe(
        downloading
      );
      expect(reduceUpdateEvent(downloading, { status: 'error', background: true })).toBe(
        downloading
      );
    });

    it('still takes what a check the app ran on its own finds', () => {
      expect(
        reduceUpdateEvent(idle, {
          status: 'available',
          info: { version: '4.0.1' },
          background: true,
        })
      ).toEqual({ status: 'available', version: '4.0.1' });
      expect(reduceUpdateEvent(idle, { status: 'none', background: true })).toEqual({
        status: 'none',
      });
      // A failure that is not marked, such as a download failing later, is told.
      expect(reduceUpdateEvent(idle, { status: 'error', error: 'Disk full' })).toEqual({
        status: 'error',
        error: 'Disk full',
      });
    });

    it('keeps a progress figure inside 0 to 100, and ignores one that is not a number', () => {
      const downloading = (percent) =>
        reduceUpdateEvent(idle, { status: 'downloading', progress: { percent } }).percent;

      expect(downloading(140)).toBe(100);
      expect(downloading(-3)).toBe(0);
      expect(downloading('soon')).toBe(0);
      expect(downloading(undefined)).toBe(0);
    });

    it('carries the download link of a build that cannot update itself', () => {
      expect(
        reduceUpdateEvent(idle, {
          status: 'manual',
          message: 'Update v4.0.1 is available.',
          version: '4.0.1',
          downloadUrl: 'https://example.test/releases',
        })
      ).toEqual({
        status: 'manual',
        message: 'Update v4.0.1 is available.',
        version: '4.0.1',
        downloadUrl: 'https://example.test/releases',
      });
    });

    it('lets a later check wipe the link of an earlier one', () => {
      const manual = reduceUpdateEvent(idle, { status: 'manual', downloadUrl: 'https://x.test' });

      expect(reduceUpdateEvent(manual, { status: 'checking' })).toEqual({ status: 'checking' });
      expect(reduceUpdateEvent(manual, { status: 'none' }).downloadUrl).toBeUndefined();
    });

    it('keeps a downloaded update installable after the install failed', () => {
      const downloaded = { status: 'downloaded', version: '4.0.1' };

      expect(reduceUpdateEvent(downloaded, { status: 'install-failed', error: 'Busy' })).toEqual({
        status: 'downloaded',
        version: '4.0.1',
        installError: 'Busy',
      });
    });

    it('ignores what it does not understand', () => {
      const state = { status: 'none' };

      expect(reduceUpdateEvent(state, null)).toBe(state);
      expect(reduceUpdateEvent(state, {})).toBe(state);
      expect(reduceUpdateEvent(state, { status: 'something-new' })).toBe(state);
    });

    it('does not read the extra fields main may attach to an event', () => {
      expect(reduceUpdateEvent(idle, { status: 'checking', reveal: true })).toEqual({
        status: 'checking',
      });
    });
  });

  describe('describeUpdateState', () => {
    it('says the same thing in the same words as the old status line did', () => {
      expect(describeUpdateState({ status: 'idle' }).text).toBe('Ready to check for updates');
      expect(describeUpdateState({ status: 'checking' }).text).toBe('Checking for updates...');
      expect(describeUpdateState({ status: 'none' }).text).toBe('You are up to date!');
      expect(describeUpdateState({ status: 'available', version: '4.0.1' }).text).toBe(
        'Update available: v4.0.1'
      );
      expect(describeUpdateState({ status: 'downloading' }).text).toBe('Downloading update...');
      expect(describeUpdateState({ status: 'downloaded', version: '4.0.1' }).text).toBe(
        'Update v4.0.1 ready to install'
      );
      expect(describeUpdateState({ status: 'error', error: 'No network' }).text).toBe(
        'Error: No network'
      );
      expect(describeUpdateState({ status: 'error' }).text).toBe('Error: Unknown error');
      expect(describeUpdateState({ status: 'dev' }).text).toBe(
        'Auto-updates only work in packaged builds'
      );
    });

    it('colours the line by what was found', () => {
      const tone = (status) => describeUpdateState({ status }).tone;

      expect(tone('error')).toBe('error');
      expect(tone('check-failed')).toBe('error');
      expect(tone('none')).toBe('up-to-date');
      expect(tone('downloaded')).toBe('downloaded');
      expect(tone('available')).toBe('available');
      expect(tone('downloading')).toBe('downloading');
      expect(tone('manual')).toBe('manual');
      expect(tone('portable')).toBe('manual');
      expect(tone('idle')).toBe('idle');
      expect(tone('checking')).toBe('checking');
    });

    it('offers a button only for an update it can act on', () => {
      const label = (update) => describeUpdateState(update).installLabel;

      expect(label({ status: 'downloaded' })).toBe('Install update');
      expect(label({ status: 'manual', downloadUrl: 'https://x.test' })).toBe('Download Update');
      expect(label({ status: 'portable', downloadUrl: 'https://x.test' })).toBe(
        'Download Portable Update'
      );
      // A release with no link has nothing to open.
      expect(label({ status: 'manual' })).toBeNull();
      expect(label({ status: 'available' })).toBeNull();
      expect(label({ status: 'none' })).toBeNull();
      expect(label({ status: 'error' })).toBeNull();
    });

    it('shows the progress bar for a download only, and empty at its start', () => {
      const progress = (update) => describeUpdateState(update).progress;

      expect(progress({ status: 'available' })).toBe(0);
      expect(progress({ status: 'downloading', percent: 63 })).toBe(63);
      expect(progress({ status: 'checking' })).toBeNull();
      expect(progress({ status: 'downloaded' })).toBeNull();
      expect(progress({ status: 'none' })).toBeNull();
    });

    it('marks the states in which the check button must wait', () => {
      expect(describeUpdateState({ status: 'checking' }).busy).toBe(true);
      expect(describeUpdateState({ status: 'downloading' }).busy).toBe(true);
      expect(describeUpdateState({ status: 'available' }).busy).toBe(false);
      expect(describeUpdateState({ status: 'error' }).busy).toBe(false);
    });

    it('shows an install failure beside the button that can try again', () => {
      const description = describeUpdateState({
        status: 'downloaded',
        version: '4.0.1',
        installError: 'Busy',
      });

      expect(description.text).toBe('Error: Busy');
      expect(description.tone).toBe('error');
      expect(description.installLabel).toBe('Install update');
    });
  });

  describe('the shared state', () => {
    it('tells every listener, once per change, and stops when a listener leaves', () => {
      const first = jest.fn();
      const second = jest.fn();
      subscribeToUpdateState(first);
      const leave = subscribeToUpdateState(second);

      applyUpdateEvent({ status: 'checking' });
      leave();
      applyUpdateEvent({ status: 'none' });

      expect(first).toHaveBeenCalledTimes(2);
      expect(first).toHaveBeenLastCalledWith({ status: 'none' });
      expect(second).toHaveBeenCalledTimes(1);
    });

    it('keeps a listener that throws from stopping the others', () => {
      const consoleError = jest.spyOn(console, 'error').mockImplementation(() => {});
      const survivor = jest.fn();
      subscribeToUpdateState(() => {
        throw new Error('broken view');
      });
      subscribeToUpdateState(survivor);

      applyUpdateEvent({ status: 'none' });

      expect(survivor).toHaveBeenCalledTimes(1);
      consoleError.mockRestore();
    });

    it('does not tell anyone about an event that changes nothing', () => {
      const listener = jest.fn();
      subscribeToUpdateState(listener);

      applyUpdateEvent({ status: 'something-new' });
      applyUpdateEvent(null);

      expect(listener).not.toHaveBeenCalled();
    });
  });

  describe('hearing the main process', () => {
    const createApi = () => {
      let handler = null;
      const dispose = jest.fn();
      return {
        api: {
          onAutoUpdate: jest.fn((callback) => {
            handler = callback;
            return dispose;
          }),
        },
        send: (event) => handler(event),
        dispose,
      };
    };

    it('listens once, however many times it is started', () => {
      const { api } = createApi();

      startUpdateStatus(api);
      startUpdateStatus(api);

      expect(api.onAutoUpdate).toHaveBeenCalledTimes(1);
    });

    it('holds an update found before anything was open to show it', () => {
      const { api, send } = createApi();
      startUpdateStatus(api);

      send({ status: 'available', info: { version: '4.0.1' } });
      send({ status: 'downloaded', info: { version: '4.0.1' } });

      expect(getUpdateState()).toEqual({ status: 'downloaded', version: '4.0.1' });
    });

    it('hands each event on after the state has taken it', () => {
      const { api, send } = createApi();
      const seen = [];
      startUpdateStatus(api, (event) => seen.push([event.status, getUpdateState().status]));

      send({ status: 'checking', reveal: true });

      expect(seen).toEqual([['checking', 'checking']]);
    });

    it('survives an empty event and an API with nothing to listen to', () => {
      const { api, send } = createApi();
      startUpdateStatus(api);

      expect(() => send(null)).not.toThrow();
      expect(() => startUpdateStatus({}, jest.fn())).not.toThrow();
    });

    it('lets go of the subscription when reset', () => {
      const { api, dispose } = createApi();
      startUpdateStatus(api);

      resetUpdateStatus();

      expect(dispose).toHaveBeenCalledTimes(1);
      expect(getUpdateState()).toEqual({ status: 'idle' });
    });
  });
});

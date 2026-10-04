/**
 * @jest-environment node
 */

const v8 = require('v8');
const {
  CHECK_INTERVAL_MS,
  STARTUP_CHECK_DELAY_MS,
  UpdateCheckScheduler,
  createUpdateAnnouncer,
  summarizeUpdateCheck,
} = require('../../src/update-flow.cjs');

describe('summarizeUpdateCheck', () => {
  // What electron-updater hands back when a check finds an update: the download itself, a
  // Promise, rides along with a cancellation token.
  const rawResult = () => ({
    isUpdateAvailable: true,
    updateInfo: { version: '4.0.1', releaseDate: '2026-10-05', files: [{ url: 'a.exe' }] },
    versionInfo: { version: '4.0.1' },
    downloadPromise: Promise.resolve(['a.exe']),
    cancellationToken: { cancel() {} },
  });

  it('can be cloned across the context bridge, which the raw result cannot', () => {
    expect(() => v8.serialize(rawResult())).toThrow();
    expect(() => structuredClone(rawResult())).toThrow();

    const summary = summarizeUpdateCheck(rawResult());

    expect(structuredClone(summary)).toEqual({ status: 'checking', version: '4.0.1' });
    expect(JSON.parse(JSON.stringify(summary))).toEqual(summary);
  });

  it('names no version when the updater found none', () => {
    expect(summarizeUpdateCheck({ isUpdateAvailable: false })).toEqual({
      status: 'checking',
      version: null,
    });
    expect(summarizeUpdateCheck(null)).toEqual({ status: 'checking', version: null });
    expect(summarizeUpdateCheck({ updateInfo: { version: 4 } }).version).toBeNull();
  });
});

describe('UpdateCheckScheduler', () => {
  const HOUR = 60 * 60 * 1000;
  let clock;

  beforeEach(() => {
    jest.useFakeTimers();
    clock = 1_700_000_000_000;
  });

  afterEach(() => jest.useRealTimers());

  const create = (overrides = {}) => {
    const check = overrides.check || jest.fn().mockResolvedValue(undefined);
    const logger = { warn: jest.fn() };
    const scheduler = new UpdateCheckScheduler({
      check,
      logger,
      now: () => clock,
      ...overrides,
    });
    return { scheduler, check, logger };
  };
  const advance = async (ms) => {
    clock += ms;
    await jest.advanceTimersByTimeAsync(ms);
  };

  it('checks 30 seconds after launch, then every six hours', async () => {
    const { scheduler, check } = create();
    scheduler.start();

    await advance(STARTUP_CHECK_DELAY_MS - 1);
    expect(check).not.toHaveBeenCalled();
    await advance(1);
    expect(check).toHaveBeenCalledTimes(1);

    await advance(CHECK_INTERVAL_MS);
    expect(check).toHaveBeenCalledTimes(2);
    await advance(CHECK_INTERVAL_MS);
    expect(check).toHaveBeenCalledTimes(3);
    scheduler.stop();
  });

  it('uses the six hours and the 30 seconds the audit asked for', () => {
    expect(CHECK_INTERVAL_MS).toBe(6 * HOUR);
    expect(STARTUP_CHECK_DELAY_MS).toBe(30_000);
  });

  it('stops checking when stopped', async () => {
    const { scheduler, check } = create();
    scheduler.start();
    scheduler.stop();

    await advance(2 * CHECK_INTERVAL_MS);

    expect(check).not.toHaveBeenCalled();
  });

  it('starts only once', async () => {
    const { scheduler, check } = create();
    scheduler.start();
    scheduler.start();

    await advance(STARTUP_CHECK_DELAY_MS);

    expect(check).toHaveBeenCalledTimes(1);
    scheduler.stop();
  });

  it('keeps going after a check fails, and says so once per failure', async () => {
    const check = jest
      .fn()
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValue(undefined);
    const { scheduler, logger } = create({ check });
    scheduler.start();

    await advance(STARTUP_CHECK_DELAY_MS);
    await advance(CHECK_INTERVAL_MS);

    expect(check).toHaveBeenCalledTimes(2);
    expect(logger.warn).toHaveBeenCalledTimes(1);
    expect(logger.warn).toHaveBeenCalledWith('Scheduled update check failed:', 'offline');
    scheduler.stop();
  });

  it('does not start a second check while one is still running', async () => {
    let finish;
    const check = jest.fn(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        })
    );
    const { scheduler } = create({ check });

    const first = scheduler.runCheck();
    const second = await scheduler.runCheck();
    finish();
    await first;

    expect(second).toBe(false);
    expect(check).toHaveBeenCalledTimes(1);
  });

  describe('waking from suspend', () => {
    it('checks when a whole interval has passed since the last check', async () => {
      const { scheduler, check } = create();
      await scheduler.runCheck();
      clock += CHECK_INTERVAL_MS;

      await scheduler.handleResume();

      expect(check).toHaveBeenCalledTimes(2);
    });

    it('leaves a recent check alone', async () => {
      const { scheduler, check } = create();
      await scheduler.runCheck();
      clock += CHECK_INTERVAL_MS - 1;

      expect(await scheduler.handleResume()).toBe(false);

      expect(check).toHaveBeenCalledTimes(1);
    });

    it('checks when none has been made yet', async () => {
      const { scheduler, check } = create();

      await scheduler.handleResume();

      expect(check).toHaveBeenCalledTimes(1);
    });
  });
});

describe('createUpdateAnnouncer', () => {
  const setup = ({ supported = true, store = null } = {}) => {
    const shown = [];
    class FakeNotification {
      constructor(options) {
        this.options = options;
        this.handlers = {};
        shown.push(this);
      }
      static isSupported() {
        return supported;
      }
      on(event, handler) {
        this.handlers[event] = handler;
      }
      show() {
        this.shownAt = shown.length;
      }
    }
    const onClick = jest.fn();
    const translate = jest.fn((key, vars = {}) =>
      key.replace(/\{\{(\w+)\}\}/g, (_match, name) => vars[name])
    );
    const announcer = createUpdateAnnouncer({
      Notification: FakeNotification,
      translate,
      onClick,
      log: { warn: jest.fn() },
      store,
    });
    return { announcer, shown, onClick };
  };

  it('remembers the announced version across restarts', () => {
    let saved = null;
    const store = { read: () => saved, write: (version) => (saved = version) };

    expect(setup({ store }).announcer.announce({ status: 'manual', version: '4.0.1' })).toBe(true);
    expect(saved).toBe('4.0.1');

    // A new launch reads it back and stays quiet about the same version, but not a newer one.
    const relaunched = setup({ store });
    expect(relaunched.announcer.announce({ status: 'manual', version: '4.0.1' })).toBe(false);
    expect(relaunched.shown).toHaveLength(0);
    expect(relaunched.announcer.announce({ status: 'manual', version: '4.0.2' })).toBe(true);
    expect(saved).toBe('4.0.2');
  });

  it('still announces when the stored version cannot be read or written', () => {
    const store = {
      read: () => {
        throw new Error('ENOENT');
      },
      write: () => {
        throw new Error('EROFS');
      },
    };
    const { announcer, shown } = setup({ store });

    expect(announcer.announce({ status: 'manual', version: '4.0.1' })).toBe(true);
    expect(shown).toHaveLength(1);
  });

  it('tells once per version that a release is out', () => {
    const { announcer, shown } = setup();

    expect(announcer.announce({ status: 'manual', version: '4.0.1' })).toBe(true);
    expect(announcer.announce({ status: 'manual', version: '4.0.1' })).toBe(false);
    expect(announcer.announce({ status: 'manual', version: '4.0.2' })).toBe(true);

    expect(shown).toHaveLength(2);
    expect(shown[0].options).toEqual({
      title: 'A new version is available',
      body: 'Version 4.0.1 is available. Open Settings > Advanced to download it.',
    });
  });

  it('opens the update row when the notification is clicked', () => {
    const { announcer, shown, onClick } = setup();
    const result = { status: 'portable', version: '4.0.1' };
    announcer.announce(result);

    shown[0].handlers.click();

    expect(onClick).toHaveBeenCalledWith(result);
  });

  it('says nothing for a result with no version, or where notifications are unsupported', () => {
    const { announcer, shown } = setup();
    expect(announcer.announce({ status: 'manual' })).toBe(false);
    expect(announcer.announce(null)).toBe(false);
    expect(shown).toHaveLength(0);

    const unsupported = setup({ supported: false });
    expect(unsupported.announcer.announce({ status: 'manual', version: '4.0.1' })).toBe(false);
    expect(unsupported.shown).toHaveLength(0);
  });

  it('is not stopped by a notification that cannot be shown', () => {
    const log = { warn: jest.fn() };
    class Broken {
      static isSupported() {
        return true;
      }
      constructor() {
        throw new Error('no daemon');
      }
    }
    const announcer = createUpdateAnnouncer({
      Notification: Broken,
      translate: (key) => key,
      onClick: jest.fn(),
      log,
    });

    expect(announcer.announce({ status: 'manual', version: '4.0.1' })).toBe(false);
    expect(log.warn).toHaveBeenCalled();
  });
});

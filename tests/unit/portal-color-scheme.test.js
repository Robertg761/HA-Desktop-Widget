/**
 * @jest-environment node
 */

const { EventEmitter } = require('events');
const { MessageType, Variant } = require('dbus-next');

const {
  createPortalColorSchemeWatcher,
  parsePortalColorScheme,
} = require('../../src/portal-color-scheme.cjs');

const silentLog = { info() {}, debug() {}, warn() {}, error() {} };

// The portal's reply to Settings.ReadOne is a variant holding the uint32, and the deprecated
// Settings.Read wraps it in a second variant.
const oneVariant = (value) => new Variant('u', value);
const twoVariants = (value) => new Variant('v', new Variant('u', value));

class FakePortalBus extends EventEmitter {
  constructor({ readOne = () => oneVariant(1), read = () => twoVariants(1), neverReplies } = {}) {
    super();
    this.readOne = readOne;
    this.read = read;
    this.neverReplies = neverReplies;
    this.calls = [];
    this.disconnected = false;
  }

  call(message) {
    this.calls.push({
      destination: message.destination,
      path: message.path,
      interface: message.interface,
      member: message.member,
      signature: message.signature,
      body: message.body,
    });
    if (this.neverReplies) return new Promise(() => {});
    try {
      switch (message.member) {
        case 'AddMatch':
          return Promise.resolve({ body: [] });
        case 'ReadOne':
          return Promise.resolve({ body: [this.readOne()] });
        case 'Read':
          return Promise.resolve({ body: [this.read()] });
        default:
          return Promise.reject(new Error(`Unexpected member ${message.member}`));
      }
    } catch (error) {
      return Promise.reject(error);
    }
  }

  signal(namespace, key, value) {
    this.emit('message', {
      type: MessageType.SIGNAL,
      interface: 'org.freedesktop.portal.Settings',
      member: 'SettingChanged',
      body: [namespace, key, value],
    });
  }

  disconnect() {
    this.disconnected = true;
  }
}

function createWatcher(busOptions = {}, overrides = {}) {
  const bus = new FakePortalBus(busOptions);
  const onChange = jest.fn();
  const watcher = createPortalColorSchemeWatcher({
    log: silentLog,
    platform: 'linux',
    onChange,
    createBus: () => bus,
    ...overrides,
  });
  return { watcher, bus, onChange };
}

describe('parsePortalColorScheme', () => {
  it('reads the portal values: 1 is dark, 2 is light, anything else is no preference', () => {
    expect(parsePortalColorScheme(1)).toBe('dark');
    expect(parsePortalColorScheme(2)).toBe('light');
    expect(parsePortalColorScheme(0)).toBeNull();
    expect(parsePortalColorScheme(3)).toBeNull();
    expect(parsePortalColorScheme(undefined)).toBeNull();
    expect(parsePortalColorScheme(null)).toBeNull();
    expect(parsePortalColorScheme('dark')).toBeNull();
  });

  it('sees through the variants the portal wraps the value in', () => {
    expect(parsePortalColorScheme(oneVariant(1))).toBe('dark');
    expect(parsePortalColorScheme(twoVariants(2))).toBe('light');
  });
});

describe('the settings portal color scheme watcher', () => {
  it('subscribes to changes first and then reads the current scheme', async () => {
    const { watcher, bus, onChange } = createWatcher({ readOne: () => oneVariant(2) });
    expect(watcher.get()).toBeNull();
    await watcher.start();

    expect(bus.calls.map((call) => call.member)).toEqual(['AddMatch', 'ReadOne']);
    const [addMatch, readOne] = bus.calls;
    expect(addMatch).toMatchObject({
      destination: 'org.freedesktop.DBus',
      interface: 'org.freedesktop.DBus',
    });
    expect(addMatch.body[0]).toContain("sender='org.freedesktop.portal.Desktop'");
    expect(addMatch.body[0]).toContain("member='SettingChanged'");
    expect(addMatch.body[0]).toContain("arg0='org.freedesktop.appearance'");
    expect(readOne).toMatchObject({
      destination: 'org.freedesktop.portal.Desktop',
      path: '/org/freedesktop/portal/desktop',
      interface: 'org.freedesktop.portal.Settings',
      signature: 'ss',
      body: ['org.freedesktop.appearance', 'color-scheme'],
    });
    expect(watcher.get()).toBe('light');
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith('light');
  });

  it('follows the desktop when it switches scheme', async () => {
    const { watcher, bus, onChange } = createWatcher({ readOne: () => oneVariant(2) });
    await watcher.start();
    onChange.mockClear();

    bus.signal('org.freedesktop.appearance', 'color-scheme', oneVariant(1));
    expect(watcher.get()).toBe('dark');
    expect(onChange).toHaveBeenCalledWith('dark');

    // The same answer again is not a change.
    bus.signal('org.freedesktop.appearance', 'color-scheme', oneVariant(1));
    expect(onChange).toHaveBeenCalledTimes(1);

    bus.signal('org.freedesktop.appearance', 'color-scheme', oneVariant(0));
    expect(watcher.get()).toBeNull();
    expect(onChange).toHaveBeenLastCalledWith(null);
  });

  it('ignores other settings and anything that is not a SettingChanged signal', async () => {
    const { watcher, bus, onChange } = createWatcher({ readOne: () => oneVariant(2) });
    await watcher.start();
    onChange.mockClear();

    bus.signal('org.freedesktop.appearance', 'accent-color', oneVariant(1));
    bus.signal('org.gnome.desktop.interface', 'color-scheme', oneVariant(1));
    bus.emit('message', {
      type: MessageType.METHOD_CALL,
      interface: 'org.freedesktop.portal.Settings',
      member: 'SettingChanged',
      body: ['org.freedesktop.appearance', 'color-scheme', oneVariant(1)],
    });
    bus.emit('message', {
      type: MessageType.SIGNAL,
      interface: 'org.freedesktop.portal.Settings',
      member: 'Other',
      body: ['org.freedesktop.appearance', 'color-scheme', oneVariant(1)],
    });
    expect(watcher.get()).toBe('light');
    expect(onChange).not.toHaveBeenCalled();
  });

  it('falls back to the older Read call, whose reply holds a second variant', async () => {
    const { watcher, bus } = createWatcher({
      readOne: () => {
        throw new Error('No such method ReadOne');
      },
      read: () => twoVariants(1),
    });
    await watcher.start();
    expect(bus.calls.map((call) => call.member)).toEqual(['AddMatch', 'ReadOne', 'Read']);
    expect(watcher.get()).toBe('dark');
  });

  it('says nothing when the portal has no preference', async () => {
    const { watcher, onChange } = createWatcher({ readOne: () => oneVariant(0) });
    await watcher.start();
    expect(watcher.get()).toBeNull();
    expect(onChange).not.toHaveBeenCalled();
  });

  it('gives up quietly when there is no portal to ask', async () => {
    const { watcher, bus, onChange } = createWatcher({
      readOne: () => {
        throw new Error('ServiceUnknown');
      },
      read: () => {
        throw new Error('ServiceUnknown');
      },
    });
    await expect(watcher.start()).resolves.toBeUndefined();
    expect(watcher.get()).toBeNull();
    expect(onChange).not.toHaveBeenCalled();
    expect(bus.disconnected).toBe(true);
  });

  it('gives up when the portal does not answer in time', async () => {
    const { watcher, bus } = createWatcher({ neverReplies: true }, { callTimeoutMs: 10 });
    await expect(watcher.start()).resolves.toBeUndefined();
    expect(watcher.get()).toBeNull();
    expect(bus.disconnected).toBe(true);
  });

  it('survives a bus that cannot be opened', async () => {
    const log = { ...silentLog, debug: jest.fn() };
    const { watcher } = createWatcher(
      {},
      {
        log,
        createBus: () => {
          throw new Error('D-Bus session address is unavailable');
        },
      }
    );
    await expect(watcher.start()).resolves.toBeUndefined();
    expect(watcher.get()).toBeNull();
    expect(log.debug).toHaveBeenCalledWith(expect.stringContaining('address is unavailable'));
  });

  it('opens no session bus without an address, rather than guessing one', async () => {
    const log = { ...silentLog, debug: jest.fn() };
    const watcher = createPortalColorSchemeWatcher({ log, platform: 'linux', env: {} });
    await expect(watcher.start()).resolves.toBeUndefined();
    expect(watcher.get()).toBeNull();
    expect(log.debug).toHaveBeenCalledWith(expect.stringContaining('unavailable'));
  });

  it('handles a connection error instead of letting it crash the app', async () => {
    const { watcher, bus } = createWatcher({ readOne: () => oneVariant(1) });
    await watcher.start();
    expect(() => bus.emit('error', new Error('socket closed'))).not.toThrow();
    expect(bus.disconnected).toBe(true);
    // What it had learned is kept; only the live updates are gone.
    expect(watcher.get()).toBe('dark');
  });

  it('does not touch the bus on other platforms', async () => {
    for (const platform of ['win32', 'darwin']) {
      const createBus = jest.fn();
      const watcher = createPortalColorSchemeWatcher({ log: silentLog, platform, createBus });
      await watcher.start();
      expect(createBus).not.toHaveBeenCalled();
      expect(watcher.get()).toBeNull();
    }
  });

  it('connects once however often it is started', async () => {
    const createBus = jest.fn(() => new FakePortalBus());
    const watcher = createPortalColorSchemeWatcher({
      log: silentLog,
      platform: 'linux',
      createBus,
    });
    await Promise.all([watcher.start(), watcher.start()]);
    await watcher.start();
    expect(createBus).toHaveBeenCalledTimes(1);
  });

  it('disconnects when closed and stops reporting', async () => {
    const { watcher, bus, onChange } = createWatcher({ readOne: () => oneVariant(2) });
    await watcher.start();
    onChange.mockClear();

    watcher.close();
    expect(bus.disconnected).toBe(true);
    bus.signal('org.freedesktop.appearance', 'color-scheme', oneVariant(1));
    expect(onChange).not.toHaveBeenCalled();

    // A start after close does nothing.
    const createBus = jest.fn(() => new FakePortalBus());
    const late = createPortalColorSchemeWatcher({ log: silentLog, platform: 'linux', createBus });
    late.close();
    await late.start();
    expect(createBus).not.toHaveBeenCalled();
  });

  it('does not report a read that finishes after it was closed', async () => {
    const { watcher, onChange } = createWatcher({ readOne: () => oneVariant(1) });
    const started = watcher.start();
    watcher.close();
    await started;
    expect(watcher.get()).toBeNull();
    expect(onChange).not.toHaveBeenCalled();
  });

  it('keeps going when the change callback throws', async () => {
    const onChange = jest.fn(() => {
      throw new Error('renderer is gone');
    });
    const { watcher, bus } = createWatcher({ readOne: () => oneVariant(2) }, { onChange });
    await expect(watcher.start()).resolves.toBeUndefined();
    bus.signal('org.freedesktop.appearance', 'color-scheme', oneVariant(1));
    expect(watcher.get()).toBe('dark');
  });
});

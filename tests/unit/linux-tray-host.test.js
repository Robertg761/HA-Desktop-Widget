/** @jest-environment node */
const { EventEmitter } = require('events');
const {
  WATCHER_BUS_NAME,
  watchForStatusNotifierWatcher,
} = require('../../src/linux-tray-host.cjs');

const dbus = {
  MessageType: { SIGNAL: 4 },
  Message: function (fields) {
    Object.assign(this, fields);
  },
};

function createFakeBus({ watcherPresent, registeredItems }) {
  const bus = new EventEmitter();
  bus.calls = [];
  bus.disconnect = jest.fn();
  bus.call = jest.fn(async (message) => {
    bus.calls.push(message.member);
    if (message.member === 'NameHasOwner') return { body: [watcherPresent] };
    if (message.member === 'Get') {
      if (registeredItems === undefined) throw new Error('No such property');
      return { body: [{ signature: 'as', value: registeredItems }] };
    }
    return { body: [] };
  });
  return bus;
}

function ownerChanged(newOwner) {
  return {
    type: dbus.MessageType.SIGNAL,
    interface: 'org.freedesktop.DBus',
    member: 'NameOwnerChanged',
    body: [WATCHER_BUS_NAME, '', newOwner],
  };
}

const log = { info: jest.fn(), debug: jest.fn() };
const ownItemMarker = 'StatusNotifierItem-4242-';
const watch = (bus, onAppeared) =>
  watchForStatusNotifierWatcher({
    createBus: () => bus,
    dbus,
    log,
    onAppeared,
    ownItemMarker,
    delay: () => Promise.resolve(),
  });

test('does nothing when the tray icon registered with a running bar', async () => {
  const bus = createFakeBus({
    watcherPresent: true,
    registeredItems: ['org.kde.StatusNotifierItem-4242-1/StatusNotifierItem', ':1.9/other'],
  });
  const onAppeared = jest.fn();
  const handle = watch(bus, onAppeared);
  expect(await handle.ready).toBe(false);
  expect(bus.calls).toEqual(['AddMatch', 'NameHasOwner', 'Get']);
  expect(onAppeared).not.toHaveBeenCalled();
  expect(bus.disconnect).toHaveBeenCalled();
  bus.emit('message', ownerChanged(':1.42'));
  expect(onAppeared).not.toHaveBeenCalled();
});

test('reports a bar that starts after the widget exactly once', async () => {
  const bus = createFakeBus({ watcherPresent: false });
  const onAppeared = jest.fn();
  const handle = watch(bus, onAppeared);
  expect(await handle.ready).toBe(true);
  // A name being released is not a bar arriving.
  bus.emit('message', ownerChanged(''));
  expect(onAppeared).not.toHaveBeenCalled();
  bus.emit('message', ownerChanged(':1.42'));
  bus.emit('message', ownerChanged(':1.43'));
  expect(onAppeared).toHaveBeenCalledTimes(1);
  expect(bus.disconnect).toHaveBeenCalled();
});

test('stays quiet after being stopped or when the session bus is unavailable', async () => {
  const bus = createFakeBus({ watcherPresent: false });
  const onAppeared = jest.fn();
  const handle = watch(bus, onAppeared);
  await handle.ready;
  handle.stop();
  bus.emit('message', ownerChanged(':1.42'));
  expect(onAppeared).not.toHaveBeenCalled();

  const failed = watchForStatusNotifierWatcher({
    createBus: () => {
      throw new Error('D-Bus session address is unavailable');
    },
    dbus,
    log,
    onAppeared,
  });
  expect(await failed.ready).toBe(false);
});

test('a bus error ends the watch without throwing', async () => {
  const bus = createFakeBus({ watcherPresent: false });
  const onAppeared = jest.fn();
  const handle = watch(bus, onAppeared);
  await handle.ready;
  expect(() => bus.emit('error', new Error('socket closed'))).not.toThrow();
  bus.emit('message', ownerChanged(':1.42'));
  expect(onAppeared).not.toHaveBeenCalled();
});

test('recreates a tray icon that missed a bar appearing during startup', async () => {
  // The watcher arrived between the Tray's creation and this check, so Electron fell back
  // to XEmbed and our item is not among the registered ones.
  const bus = createFakeBus({ watcherPresent: true, registeredItems: [':1.9/other'] });
  const onAppeared = jest.fn();
  expect(await watch(bus, onAppeared).ready).toBe(false);
  expect(onAppeared).toHaveBeenCalledTimes(1);
  expect(bus.disconnect).toHaveBeenCalled();
});

test('leaves the tray alone when the watcher cannot list its items', async () => {
  const bus = createFakeBus({ watcherPresent: true });
  const onAppeared = jest.fn();
  await watch(bus, onAppeared).ready;
  expect(onAppeared).not.toHaveBeenCalled();
});

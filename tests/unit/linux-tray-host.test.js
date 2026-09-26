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

function createFakeBus({ watcherPresent }) {
  const bus = new EventEmitter();
  bus.calls = [];
  bus.disconnect = jest.fn();
  bus.call = jest.fn(async (message) => {
    bus.calls.push(message.member);
    if (message.member === 'NameHasOwner') return { body: [watcherPresent] };
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

test('does nothing when a bar already hosts tray icons', async () => {
  const bus = createFakeBus({ watcherPresent: true });
  const onAppeared = jest.fn();
  const watch = watchForStatusNotifierWatcher({ createBus: () => bus, dbus, log, onAppeared });
  expect(await watch.ready).toBe(false);
  expect(bus.calls).toEqual(['AddMatch', 'NameHasOwner']);
  expect(bus.disconnect).toHaveBeenCalled();
  bus.emit('message', ownerChanged(':1.42'));
  expect(onAppeared).not.toHaveBeenCalled();
});

test('reports a bar that starts after the widget exactly once', async () => {
  const bus = createFakeBus({ watcherPresent: false });
  const onAppeared = jest.fn();
  const watch = watchForStatusNotifierWatcher({ createBus: () => bus, dbus, log, onAppeared });
  expect(await watch.ready).toBe(true);
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
  const watch = watchForStatusNotifierWatcher({ createBus: () => bus, dbus, log, onAppeared });
  await watch.ready;
  watch.stop();
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
  const watch = watchForStatusNotifierWatcher({ createBus: () => bus, dbus, log, onAppeared });
  await watch.ready;
  expect(() => bus.emit('error', new Error('socket closed'))).not.toThrow();
  bus.emit('message', ownerChanged(':1.42'));
  expect(onAppeared).not.toHaveBeenCalled();
});

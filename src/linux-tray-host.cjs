/* global console, process, setTimeout */

const { getNetSessionBusAddress } = require('./portal-global-shortcuts.cjs');

// Chromium registers a Linux tray icon as a StatusNotifierItem only if a watcher owns this
// name when the Tray is created. Otherwise Electron falls back to an XEmbed icon, which no
// Wayland bar shows, and never tries again. At login the widget can start before the bar
// (waybar, or the Omarchy shell), leaving it without a tray icon for the whole session. Once
// registered, Chromium re-registers by itself when the bar restarts, so only a watcher that
// was missing at startup needs handling here.
const WATCHER_BUS_NAME = 'org.kde.StatusNotifierWatcher';
const DBUS_BUS_NAME = 'org.freedesktop.DBus';
const DBUS_OBJECT_PATH = '/org/freedesktop/DBus';
const DBUS_INTERFACE = 'org.freedesktop.DBus';
const WATCHER_OBJECT_PATH = '/StatusNotifierWatcher';
const PROPERTIES_INTERFACE = 'org.freedesktop.DBus.Properties';
// Chromium registers each tray icon under org.kde.StatusNotifierItem-<pid>-<n>.
const OWN_ITEM_MARKER = `StatusNotifierItem-${process.pid}-`;

/**
 * Call `onAppeared` once if the StatusNotifierWatcher is absent now and shows up later, or if it
 * is present but this process's tray icon never registered with it (the watcher appeared after
 * the Tray was created but before this check). Stops by itself once it has decided, or on bus
 * failure.
 * @returns {{ stop: () => void, ready: Promise<boolean> }} `ready` resolves to whether the
 *   watcher was missing (and is therefore being waited for).
 */
function watchForStatusNotifierWatcher({
  env = process.env,
  log = console,
  onAppeared = () => {},
  createBus = () => {
    const busAddress = getNetSessionBusAddress(env);
    if (!busAddress) throw new Error('D-Bus session address is unavailable');
    return require('dbus-next').sessionBus({ busAddress, negotiateUnixFd: false });
  },
  dbus = null,
  ownItemMarker = OWN_ITEM_MARKER,
  verifyDelayMs = 3000,
  delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
} = {}) {
  let bus = null;
  let stopped = false;
  let waiting = false;

  function stop() {
    if (stopped) return;
    stopped = true;
    try {
      bus?.disconnect?.();
    } catch {
      // best-effort cleanup
    }
    bus = null;
  }

  // true or false when the watcher lists its items, null when it cannot say.
  async function isOwnItemRegistered(dbusModule) {
    try {
      const reply = await bus.call(
        new dbusModule.Message({
          destination: WATCHER_BUS_NAME,
          path: WATCHER_OBJECT_PATH,
          interface: PROPERTIES_INTERFACE,
          member: 'Get',
          signature: 'ss',
          body: [WATCHER_BUS_NAME, 'RegisteredStatusNotifierItems'],
        })
      );
      const items = reply?.body?.[0]?.value ?? reply?.body?.[0];
      if (!Array.isArray(items)) return null;
      return items.some((item) => typeof item === 'string' && item.includes(ownItemMarker));
    } catch {
      return null;
    }
  }

  async function start() {
    const dbusModule = dbus || require('dbus-next');
    bus = createBus();
    bus.on('error', (error) => {
      log.debug?.(`Tray host watch: D-Bus connection lost: ${error?.message || error}`);
      stop();
    });
    bus.on('message', (message) => {
      if (stopped || !waiting || message.type !== dbusModule.MessageType.SIGNAL) return;
      if (
        message.interface === DBUS_INTERFACE &&
        message.member === 'NameOwnerChanged' &&
        message.body?.[0] === WATCHER_BUS_NAME &&
        message.body?.[2]
      ) {
        stop();
        onAppeared();
      }
    });
    const call = (fields) =>
      bus.call(
        new dbusModule.Message({
          destination: DBUS_BUS_NAME,
          path: DBUS_OBJECT_PATH,
          interface: DBUS_INTERFACE,
          ...fields,
        })
      );
    // Subscribe before asking, so a watcher that appears in between is not missed.
    await call({
      member: 'AddMatch',
      signature: 's',
      body: [
        `type='signal',sender='${DBUS_BUS_NAME}',interface='${DBUS_INTERFACE}',member='NameOwnerChanged',arg0='${WATCHER_BUS_NAME}'`,
      ],
    });
    const reply = await call({ member: 'NameHasOwner', signature: 's', body: [WATCHER_BUS_NAME] });
    if (stopped) return false;
    if (reply?.body?.[0] === true) {
      // Give Chromium time to register, then make sure it did; an XEmbed fallback never will.
      await delay(verifyDelayMs);
      if (stopped) return false;
      const registered = await isOwnItemRegistered(dbusModule);
      stop();
      if (registered === false) {
        log.info?.('The tray icon did not register with the StatusNotifier host; recreating it');
        onAppeared();
      }
      return false;
    }
    waiting = true;
    log.info?.('No StatusNotifier host yet; the tray icon will be recreated when one appears');
    return true;
  }

  const ready = start().catch((error) => {
    log.debug?.(`Tray host watch unavailable: ${error?.message || error}`);
    stop();
    return false;
  });
  return { stop, ready };
}

module.exports = { WATCHER_BUS_NAME, watchForStatusNotifierWatcher };

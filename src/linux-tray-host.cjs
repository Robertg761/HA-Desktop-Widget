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
// The object path Chromium exports each tray icon under, followed by its number.
const CHROMIUM_ITEM_PATH_PREFIX = '/org/chromium/StatusNotifierItem';

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
  ownPid = process.pid,
  // How many tray icons this process created: the main icon plus any live value icons. All of
  // them must be registered, since a bar can appear midway through creating them.
  getExpectedItemCount = () => 1,
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
  async function areOwnItemsRegistered(dbusModule) {
    let items;
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
      items = reply?.body?.[0]?.value ?? reply?.body?.[0];
    } catch {
      return null;
    }
    if (!Array.isArray(items)) return null;
    // Items are "<bus name>/<object path>". Older Chromium owns a well-known name carrying its
    // pid (org.kde.StatusNotifierItem-<pid>-<n>); current Chromium registers from its unique
    // connection name (":1.42/org/chromium/StatusNotifierItem/1"), so ask the bus who owns it.
    const ownNameMarker = `StatusNotifierItem-${ownPid}-`;
    const expected = Math.max(1, Number(getExpectedItemCount()) || 1);
    // Every icon of one process usually shares its connection, so ask about each owner once.
    const ownerPids = new Map();
    let owned = 0;
    let unattributable = 0;
    for (const item of items) {
      if (typeof item !== 'string' || !item) continue;
      const service = item.split('/')[0];
      // A bare object path names no owner. The spec has the watcher prefix the sender, but a
      // host that does not leaves nothing to attribute. One shaped like Chromium's item may be
      // this process's; any other bare path is some other app's.
      if (!service) {
        if (item.startsWith(CHROMIUM_ITEM_PATH_PREFIX)) unattributable += 1;
        continue;
      }
      if (service.includes(ownNameMarker)) {
        owned += 1;
      } else {
        if (!ownerPids.has(service)) {
          let pid = null;
          try {
            const reply = await bus.call(
              new dbusModule.Message({
                destination: DBUS_BUS_NAME,
                path: DBUS_OBJECT_PATH,
                interface: DBUS_INTERFACE,
                member: 'GetConnectionUnixProcessID',
                signature: 's',
                body: [service],
              })
            );
            pid = Number(reply?.body?.[0]);
          } catch {
            // The item's owner has left the bus, so it is not this running process.
          }
          ownerPids.set(service, pid);
        }
        if (ownerPids.get(service) === ownPid) owned += 1;
      }
      if (owned >= expected) return true;
    }
    // Rather than recreate icons that may be working, leave the tray alone when the ones not
    // found could all be registered under paths no one can attribute. Too few such paths
    // means at least one icon is certainly missing.
    return owned + unattributable >= expected ? null : false;
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
      const registered = await areOwnItemsRegistered(dbusModule);
      stop();
      if (registered === false) {
        log.info?.('Tray icons did not all register with the StatusNotifier host; recreating them');
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

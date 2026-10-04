/* global console, process, setTimeout, clearTimeout */

// The desktop's own light or dark preference, read from the XDG settings portal.
//
// The tray sits on the shell, so its icons have to follow the shell's colours, not the app's.
// Electron answers that only while nativeTheme.themeSource is 'system': once the app theme is set
// to Dark or Light, nativeTheme.shouldUseDarkColors and the page's prefers-color-scheme report
// the app's choice and the OS's is invisible from then on. The settings portal is where Chromium
// itself reads the preference on Linux, and nothing the app does to nativeTheme changes what it
// says. It is read once, and then kept current from the portal's SettingChanged signal.

const { getNetSessionBusAddress } = require('./portal-global-shortcuts.cjs');

const PORTAL_BUS_NAME = 'org.freedesktop.portal.Desktop';
const PORTAL_OBJECT_PATH = '/org/freedesktop/portal/desktop';
const SETTINGS_INTERFACE = 'org.freedesktop.portal.Settings';
const APPEARANCE_NAMESPACE = 'org.freedesktop.appearance';
const COLOR_SCHEME_KEY = 'color-scheme';
const DBUS_BUS_NAME = 'org.freedesktop.DBus';
const DBUS_OBJECT_PATH = '/org/freedesktop/DBus';
const DBUS_INTERFACE = 'org.freedesktop.DBus';
// The portal is started on demand by the first call, which can take a moment; past this there is
// no portal worth waiting for and the caller keeps the answer it already had.
const PORTAL_CALL_TIMEOUT_MS = 10000;

/** A D-Bus variant, however many variants deep the portal wrapped the value. */
function unwrapVariant(value) {
  let inner = value;
  while (inner && typeof inner === 'object' && 'signature' in inner && 'value' in inner) {
    inner = inner.value;
  }
  return inner;
}

/**
 * The portal's color-scheme value as the scheme the tray should draw for: 1 is dark and 2 is
 * light. 0 means the desktop has no preference, which says nothing either way.
 * @returns {'dark'|'light'|null}
 */
function parsePortalColorScheme(value) {
  const raw = Number(unwrapVariant(value));
  if (raw === 1) return 'dark';
  if (raw === 2) return 'light';
  return null;
}

function createPortalColorSchemeWatcher(options = {}) {
  const {
    log = console,
    env = process.env,
    platform = process.platform,
    // Called with the new scheme (or null) whenever the portal reports a different one.
    onChange = () => {},
    callTimeoutMs = PORTAL_CALL_TIMEOUT_MS,
    // Injectable for tests; defaults to a real session bus connection. usocket is avoided for the
    // same reason as in portal-global-shortcuts.cjs.
    createBus = () => {
      const busAddress = getNetSessionBusAddress(env);
      if (!busAddress) {
        throw new Error('D-Bus session address is unavailable');
      }
      return require('dbus-next').sessionBus({ busAddress, negotiateUnixFd: false });
    },
  } = options;

  let bus = null;
  let dbusModule = null;
  let scheme = null;
  let closed = false;

  function getDbus() {
    if (!dbusModule) dbusModule = require('dbus-next');
    return dbusModule;
  }

  function setScheme(next) {
    if (next === scheme) return;
    scheme = next;
    try {
      onChange(scheme);
    } catch (error) {
      log.warn?.(`Portal color scheme: change callback failed: ${error?.message || error}`);
    }
  }

  function dropBus(failedBus) {
    if (!failedBus || bus !== failedBus) return;
    bus = null;
    try {
      failedBus.disconnect?.();
    } catch {
      // best-effort cleanup
    }
  }

  function call(targetBus, fields) {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error(`${fields.member} call timed out`)),
        callTimeoutMs
      );
      timer.unref?.();
      const settle = (finish) => (value) => {
        clearTimeout(timer);
        finish(value);
      };
      try {
        targetBus.call(new (getDbus().Message)(fields)).then(settle(resolve), settle(reject));
      } catch (error) {
        settle(reject)(error);
      }
    });
  }

  function readSetting(targetBus, member) {
    return call(targetBus, {
      destination: PORTAL_BUS_NAME,
      path: PORTAL_OBJECT_PATH,
      interface: SETTINGS_INTERFACE,
      member,
      signature: 'ss',
      body: [APPEARANCE_NAMESPACE, COLOR_SCHEME_KEY],
    });
  }

  /** Connect, subscribe to changes, then read the current value. Never rejects. */
  async function start() {
    if (platform !== 'linux' || closed || bus) return;
    let nextBus = null;
    try {
      nextBus = createBus();
      bus = nextBus;
      // dbus-next reports a dropped connection as an 'error' event; with no listener that is an
      // uncaught exception, and a session-bus hiccup must not take the app down.
      nextBus.on('error', (error) => {
        log.debug?.(`Portal color scheme: D-Bus connection error: ${error?.message || error}`);
        dropBus(nextBus);
      });
      nextBus.on('message', (message) => {
        if (closed || bus !== nextBus || message.type !== getDbus().MessageType.SIGNAL) return;
        if (
          message.interface === SETTINGS_INTERFACE &&
          message.member === 'SettingChanged' &&
          message.body?.[0] === APPEARANCE_NAMESPACE &&
          message.body?.[1] === COLOR_SCHEME_KEY
        ) {
          setScheme(parsePortalColorScheme(message.body[2]));
        }
      });
      // Subscribe before reading, so a change in between cannot be missed. The sender is named
      // in the rule: the bus then delivers only what the portal itself sent.
      await call(nextBus, {
        destination: DBUS_BUS_NAME,
        path: DBUS_OBJECT_PATH,
        interface: DBUS_INTERFACE,
        member: 'AddMatch',
        signature: 's',
        body: [
          `type='signal',sender='${PORTAL_BUS_NAME}',interface='${SETTINGS_INTERFACE}',member='SettingChanged',arg0='${APPEARANCE_NAMESPACE}'`,
        ],
      });
      let reply;
      try {
        reply = await readSetting(nextBus, 'ReadOne');
      } catch (error) {
        // Portals older than version 2 only have the deprecated Read, which wraps the value in a
        // second variant. A portal that does not answer at all fails this call too.
        log.debug?.(`Portal color scheme: ReadOne failed, trying Read: ${error?.message || error}`);
        reply = await readSetting(nextBus, 'Read');
      }
      if (closed || bus !== nextBus) return;
      setScheme(parsePortalColorScheme(reply?.body?.[0]));
    } catch (error) {
      log.debug?.(`Portal color scheme unavailable: ${error?.message || error}`);
      dropBus(nextBus);
    }
  }

  function close() {
    closed = true;
    dropBus(bus);
  }

  return { start, close, get: () => scheme };
}

module.exports = {
  PORTAL_CALL_TIMEOUT_MS,
  createPortalColorSchemeWatcher,
  parsePortalColorScheme,
};

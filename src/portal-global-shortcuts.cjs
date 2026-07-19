/* global console, process, setTimeout, clearTimeout */

// XDG Desktop Portal GlobalShortcuts backend for Wayland sessions.
//
// Electron's globalShortcut silently does nothing under native Wayland: register()
// returns true but the compositor never delivers key events (electron/electron#38288,
// #51875 — Chromium skips the host Registry.Register call, so xdg-desktop-portal >= 1.21
// never engages the portal flow). This module talks to the portal directly over D-Bus:
// Registry.Register -> CreateSession -> BindShortcuts -> Activated signals. The
// compositor (KWin, Mutter) then owns the bindings and shows them in system settings.
//
// This is the crash-safe way to get global hotkeys on Wayland: unlike uiohook-napi (a
// native input hook that has caused Linux crashes), it is pure D-Bus and needs no special
// group membership. The trade-off is that bound shortcuts are visible in the compositor's
// shortcut settings.

const PORTAL_BUS_NAME = 'org.freedesktop.portal.Desktop';
const PORTAL_OBJECT_PATH = '/org/freedesktop/portal/desktop';
const GLOBAL_SHORTCUTS_INTERFACE = 'org.freedesktop.portal.GlobalShortcuts';
const REQUEST_INTERFACE = 'org.freedesktop.portal.Request';
const SESSION_INTERFACE = 'org.freedesktop.portal.Session';
const HOST_REGISTRY_INTERFACE = 'org.freedesktop.host.portal.Registry';
const DBUS_BUS_NAME = 'org.freedesktop.DBus';
const DBUS_OBJECT_PATH = '/org/freedesktop/DBus';
const DBUS_INTERFACE = 'org.freedesktop.DBus';
const PROPERTIES_INTERFACE = 'org.freedesktop.DBus.Properties';

const PORTAL_SHORTCUTS_BACKEND = 'portal';
const DEFAULT_PORTAL_APP_ID = 'ha_desktop_widget';
const CREATE_SESSION_TIMEOUT_MS = 30000;
// Binding may block on a compositor approval dialog the first time, so wait generously.
const BIND_SHORTCUTS_TIMEOUT_MS = 300000;

function isWaylandSession(env = process.env) {
  if (!env || typeof env !== 'object') return false;
  if (
    typeof env.XDG_SESSION_TYPE === 'string' &&
    env.XDG_SESSION_TYPE.toLowerCase() === 'wayland'
  ) {
    return true;
  }
  return typeof env.WAYLAND_DISPLAY === 'string' && env.WAYLAND_DISPLAY.trim() !== '';
}

// Electron accelerator key names -> XKB keysym names used by portal trigger descriptions.
const PORTAL_KEY_NAME_MAP = {
  space: 'space',
  spacebar: 'space',
  esc: 'Escape',
  escape: 'Escape',
  tab: 'Tab',
  backspace: 'BackSpace',
  delete: 'Delete',
  del: 'Delete',
  insert: 'Insert',
  return: 'Return',
  enter: 'Return',
  up: 'Up',
  down: 'Down',
  left: 'Left',
  right: 'Right',
  arrowup: 'Up',
  arrowdown: 'Down',
  arrowleft: 'Left',
  arrowright: 'Right',
  home: 'Home',
  end: 'End',
  pageup: 'Page_Up',
  pagedown: 'Page_Down',
  printscreen: 'Print',
  plus: 'plus',
  minus: 'minus',
  comma: 'comma',
  period: 'period',
  semicolon: 'semicolon',
  slash: 'slash',
  backslash: 'backslash',
  bracketleft: 'bracketleft',
  bracketright: 'bracketright',
  quote: 'apostrophe',
  backquote: 'grave',
  equal: 'equal',
};

const PORTAL_MODIFIER_MAP = {
  ctrl: 'CTRL',
  control: 'CTRL',
  commandorcontrol: 'CTRL',
  cmdorctrl: 'CTRL',
  alt: 'ALT',
  option: 'ALT',
  altgr: 'ALT',
  shift: 'SHIFT',
  meta: 'LOGO',
  cmd: 'LOGO',
  command: 'LOGO',
  super: 'LOGO',
  win: 'LOGO',
};

/**
 * Convert an Electron accelerator ("Alt+1", "CommandOrControl+Shift+Z") into a portal
 * preferred_trigger description ("ALT+1", "CTRL+SHIFT+z"). Returns null when the
 * accelerator has no non-modifier key. Unknown key names pass through unchanged — the
 * compositor's bind dialog lets the user pick a trigger if it cannot parse ours.
 */
function acceleratorToPortalTrigger(accelerator) {
  if (!accelerator || typeof accelerator !== 'string') return null;

  const modifiers = [];
  let key = '';
  for (const rawPart of accelerator.split('+')) {
    const part = rawPart.trim();
    if (!part) continue;
    const modifier = PORTAL_MODIFIER_MAP[part.toLowerCase()];
    if (modifier) {
      if (!modifiers.includes(modifier)) modifiers.push(modifier);
      continue;
    }
    key = part;
  }

  if (!key) return null;

  let portalKey;
  if (/^f\d{1,2}$/i.test(key)) {
    portalKey = key.toUpperCase();
  } else if (key.length === 1) {
    portalKey = /[a-z]/i.test(key) ? key.toLowerCase() : key;
  } else {
    portalKey = PORTAL_KEY_NAME_MAP[key.toLowerCase()] || key;
  }

  return [...modifiers, portalKey].join('+');
}

function createPortalGlobalShortcutsController(options = {}) {
  const {
    log = console,
    env = process.env,
    appId = DEFAULT_PORTAL_APP_ID,
    onActivated = () => {},
    // Injectable for tests; defaults to a real session bus connection.
    createBus = () => require('dbus-next').sessionBus(),
    createSessionTimeoutMs = CREATE_SESSION_TIMEOUT_MS,
    bindShortcutsTimeoutMs = BIND_SHORTCUTS_TIMEOUT_MS,
  } = options;

  let bus = null;
  let dbusModule = null;
  let registryRegistered = false;
  let sessionHandle = '';
  let activatedListenerInstalled = false;
  let availabilityPromise = null;
  let tokenCounter = 0;
  let closed = false;
  // Serializes syncShortcuts calls so a re-bind never races an in-flight bind.
  let syncQueue = Promise.resolve();

  function variantValue(value) {
    return value && typeof value === 'object' && 'value' in value ? value.value : value;
  }

  function nextToken() {
    tokenCounter += 1;
    return `hawidget_${tokenCounter}`;
  }

  function getDbus() {
    if (!dbusModule) dbusModule = require('dbus-next');
    return dbusModule;
  }

  async function ensureBus() {
    if (closed) throw new Error('Portal shortcuts controller is closed');
    if (bus) return bus;
    bus = createBus();
    // dbus-next forwards connection/stream failures as 'error' events on the bus; an
    // EventEmitter 'error' without a listener is an uncaught exception that would crash
    // the whole app on a session-bus hiccup (logout, portal restart, closed socket).
    bus.on('error', (error) => {
      log.warn?.(`Portal shortcuts: D-Bus connection error: ${error?.message || error}`);
    });
    // Any successful call completes the Hello handshake and populates bus.name.
    await busCall({
      destination: DBUS_BUS_NAME,
      path: DBUS_OBJECT_PATH,
      interface: DBUS_INTERFACE,
      member: 'GetId',
    });
    return bus;
  }

  function busCall(messageFields) {
    const dbus = getDbus();
    return bus.call(new dbus.Message(messageFields));
  }

  function addMatch(rule) {
    return busCall({
      destination: DBUS_BUS_NAME,
      path: DBUS_OBJECT_PATH,
      interface: DBUS_INTERFACE,
      member: 'AddMatch',
      signature: 's',
      body: [rule],
    });
  }

  function senderPathComponent() {
    return String(bus.name || '')
      .replace(/^:/, '')
      .replace(/\./g, '_');
  }

  async function ensureRegistryRegistration() {
    if (registryRegistered) return;
    registryRegistered = true;
    try {
      await busCall({
        destination: PORTAL_BUS_NAME,
        path: PORTAL_OBJECT_PATH,
        interface: HOST_REGISTRY_INTERFACE,
        member: 'Register',
        signature: 'sa{sv}',
        body: [appId, {}],
      });
      log.info?.(`Portal shortcuts: registered app id "${appId}" with host portal registry`);
    } catch (error) {
      // Non-fatal: the portal can still derive an app id from our systemd scope.
      log.debug?.(
        `Portal shortcuts: host registry registration failed (continuing): ${error?.message || error}`
      );
    }
  }

  /**
   * Call a portal method that answers through a org.freedesktop.portal.Request object,
   * resolving with the Response signal's { code, results }.
   */
  async function portalRequest({ member, signature, body, buildOptions, timeoutMs }) {
    const dbus = getDbus();
    const token = nextToken();
    const expectedRequestPath = `${PORTAL_OBJECT_PATH}/request/${senderPathComponent()}/${token}`;

    let settle;
    const responsePromise = new Promise((resolve) => {
      settle = resolve;
    });

    const watchedPaths = new Set([expectedRequestPath]);
    const onMessage = (message) => {
      if (
        message.type === dbus.MessageType.SIGNAL &&
        message.interface === REQUEST_INTERFACE &&
        message.member === 'Response' &&
        watchedPaths.has(message.path)
      ) {
        const [code, results] = message.body;
        settle({ code: Number(code), results: results || {} });
      }
    };

    // Subscribe before calling so a fast Response cannot be missed.
    await addMatch(
      `type='signal',interface='${REQUEST_INTERFACE}',member='Response',path='${expectedRequestPath}'`
    );
    bus.on('message', onMessage);

    try {
      const reply = await busCall({
        destination: PORTAL_BUS_NAME,
        path: PORTAL_OBJECT_PATH,
        interface: GLOBAL_SHORTCUTS_INTERFACE,
        member,
        signature,
        body: body(buildOptions(token)),
      });

      const actualRequestPath = reply.body?.[0];
      if (typeof actualRequestPath === 'string' && !watchedPaths.has(actualRequestPath)) {
        watchedPaths.add(actualRequestPath);
        await addMatch(
          `type='signal',interface='${REQUEST_INTERFACE}',member='Response',path='${actualRequestPath}'`
        );
      }

      let timeoutTimer;
      const timeout = new Promise((resolve) => {
        timeoutTimer = setTimeout(
          () => resolve({ code: -1, results: {}, timedOut: true }),
          timeoutMs
        );
        if (typeof timeoutTimer.unref === 'function') timeoutTimer.unref();
      });
      const response = await Promise.race([responsePromise, timeout]);
      clearTimeout(timeoutTimer);
      return response;
    } finally {
      bus.off('message', onMessage);
    }
  }

  async function ensureActivatedListener() {
    if (activatedListenerInstalled) return;
    const dbus = getDbus();
    await addMatch(
      `type='signal',interface='${GLOBAL_SHORTCUTS_INTERFACE}',member='Activated',path='${PORTAL_OBJECT_PATH}'`
    );
    bus.on('message', (message) => {
      if (
        message.type !== dbus.MessageType.SIGNAL ||
        message.interface !== GLOBAL_SHORTCUTS_INTERFACE ||
        message.member !== 'Activated'
      ) {
        return;
      }
      const [signalSessionHandle, shortcutId] = message.body;
      if (!sessionHandle || signalSessionHandle !== sessionHandle) return;
      try {
        onActivated(String(shortcutId));
      } catch (error) {
        log.error?.('Portal shortcuts: activation handler failed:', error);
      }
    });
    activatedListenerInstalled = true;
  }

  async function closeSession() {
    if (!sessionHandle) return;
    const staleHandle = sessionHandle;
    sessionHandle = '';
    try {
      await busCall({
        destination: PORTAL_BUS_NAME,
        path: staleHandle,
        interface: SESSION_INTERFACE,
        member: 'Close',
      });
    } catch (error) {
      log.debug?.(`Portal shortcuts: closing previous session failed: ${error?.message || error}`);
    }
  }

  async function isAvailable() {
    if (!isWaylandSession(env)) return false;
    if (!availabilityPromise) {
      availabilityPromise = (async () => {
        try {
          await ensureBus();
          const reply = await busCall({
            destination: PORTAL_BUS_NAME,
            path: PORTAL_OBJECT_PATH,
            interface: PROPERTIES_INTERFACE,
            member: 'Get',
            signature: 'ss',
            body: [GLOBAL_SHORTCUTS_INTERFACE, 'version'],
          });
          const version = Number(variantValue(reply.body?.[0])) || 0;
          log.info?.(`Portal shortcuts: GlobalShortcuts portal available (version ${version})`);
          return version >= 1;
        } catch (error) {
          log.info?.(
            `Portal shortcuts: GlobalShortcuts portal not available: ${error?.message || error}`
          );
          return false;
        }
      })();
    }
    return availabilityPromise;
  }

  async function doSyncShortcuts(shortcuts) {
    const dbus = getDbus();
    await ensureBus();
    await ensureRegistryRegistration();
    await ensureActivatedListener();
    await closeSession();

    if (!shortcuts.length) {
      return { success: true, backend: PORTAL_SHORTCUTS_BACKEND, bound: [] };
    }

    const createResponse = await portalRequest({
      member: 'CreateSession',
      signature: 'a{sv}',
      timeoutMs: createSessionTimeoutMs,
      buildOptions: (token) => ({
        handle_token: new dbus.Variant('s', token),
        session_handle_token: new dbus.Variant('s', nextToken()),
      }),
      body: (portalOptions) => [portalOptions],
    });

    if (createResponse.code !== 0) {
      const error = createResponse.timedOut
        ? 'timed out waiting for the portal session'
        : `portal refused to create a session (code ${createResponse.code})`;
      return { success: false, backend: PORTAL_SHORTCUTS_BACKEND, bound: [], error };
    }

    sessionHandle = String(variantValue(createResponse.results.session_handle) || '');
    if (!sessionHandle) {
      return {
        success: false,
        backend: PORTAL_SHORTCUTS_BACKEND,
        bound: [],
        error: 'portal did not return a session handle',
      };
    }

    const shortcutTuples = shortcuts.map(({ id, description, accelerator }) => {
      const properties = { description: new dbus.Variant('s', description || id) };
      const trigger = acceleratorToPortalTrigger(accelerator);
      if (trigger) properties.preferred_trigger = new dbus.Variant('s', trigger);
      return [id, properties];
    });

    log.info?.(
      `Portal shortcuts: binding ${shortcuts.length} shortcut(s) — the desktop may ask for approval once`
    );

    const bindResponse = await portalRequest({
      member: 'BindShortcuts',
      signature: 'oa(sa{sv})sa{sv}',
      timeoutMs: bindShortcutsTimeoutMs,
      buildOptions: (token) => ({ handle_token: new dbus.Variant('s', token) }),
      body: (portalOptions) => [sessionHandle, shortcutTuples, '', portalOptions],
    });

    if (bindResponse.code !== 0) {
      const error = bindResponse.timedOut
        ? 'timed out waiting for shortcut approval'
        : bindResponse.code === 1
          ? 'shortcut binding was cancelled'
          : `portal failed to bind shortcuts (code ${bindResponse.code})`;
      await closeSession();
      return { success: false, backend: PORTAL_SHORTCUTS_BACKEND, bound: [], error };
    }

    const boundEntries = variantValue(bindResponse.results.shortcuts) || [];
    const bound = boundEntries.map((entry) => {
      const [id, properties] = entry;
      return {
        id: String(id),
        trigger: String(variantValue(properties?.trigger_description) || ''),
      };
    });
    return { success: true, backend: PORTAL_SHORTCUTS_BACKEND, bound };
  }

  /**
   * Replace all portal-bound shortcuts with the given list.
   * shortcuts: [{ id, description, accelerator }]
   */
  function syncShortcuts(shortcuts = []) {
    const normalized = shortcuts.filter(
      (shortcut) => shortcut && typeof shortcut.id === 'string' && shortcut.id
    );
    syncQueue = syncQueue
      .catch(() => {})
      .then(() =>
        doSyncShortcuts(normalized).catch((error) => ({
          success: false,
          backend: PORTAL_SHORTCUTS_BACKEND,
          bound: [],
          error: error?.message || String(error),
        }))
      );
    return syncQueue;
  }

  // Opens the desktop's shortcut configuration UI for this session (portal v2+).
  async function configureShortcuts() {
    if (!sessionHandle) return false;
    try {
      await busCall({
        destination: PORTAL_BUS_NAME,
        path: PORTAL_OBJECT_PATH,
        interface: GLOBAL_SHORTCUTS_INTERFACE,
        member: 'ConfigureShortcuts',
        signature: 'osa{sv}',
        body: [sessionHandle, '', {}],
      });
      return true;
    } catch (error) {
      log.warn?.(`Portal shortcuts: ConfigureShortcuts failed: ${error?.message || error}`);
      return false;
    }
  }

  async function close() {
    if (closed) return;
    closed = true;
    try {
      if (bus) {
        await closeSession();
        bus.disconnect();
      }
    } catch (error) {
      log.debug?.(`Portal shortcuts: shutdown error: ${error?.message || error}`);
    } finally {
      bus = null;
    }
  }

  return {
    isAvailable,
    syncShortcuts,
    configureShortcuts,
    close,
    getSessionHandle: () => sessionHandle,
  };
}

module.exports = {
  PORTAL_SHORTCUTS_BACKEND,
  DEFAULT_PORTAL_APP_ID,
  acceleratorToPortalTrigger,
  createPortalGlobalShortcutsController,
  isWaylandSession,
};

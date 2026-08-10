/* global console, process, setTimeout, clearTimeout */

const fs = require('fs');
const os = require('os');
const path = require('path');

const { getNetSessionBusAddress } = require('./portal-global-shortcuts.cjs');

// Raising an already-mapped window is impossible from the client on native Wayland:
// moveTop() is X11-only, setAlwaysOnTop() is advisory at best, and focus() needs an
// xdg-activation token the compositor only grants around real user input into this
// client (the GlobalShortcuts portal's Activated signal carries no token, and Electron
// exposes no way to spend one anyway). KWin's scripting D-Bus interface is the
// supported escape hatch — the same one kdotool drives: load a one-shot script that
// assigns workspace.activeWindow, which KWin treats as a compositor-side activation
// and focuses + raises the window exactly where it is. No unmap, no re-placement, so
// the window keeps its position, unlike a hide()/show() remap. On compositors without
// that interface (Mutter, wlroots) the probe fails and every raise is a silent no-op.

const KWIN_BUS_NAME = 'org.kde.KWin';
const KWIN_SCRIPTING_PATH = '/Scripting';
const KWIN_SCRIPTING_INTERFACE = 'org.kde.kwin.Scripting';
const KWIN_SCRIPT_INTERFACE = 'org.kde.kwin.Script';
const DBUS_BUS_NAME = 'org.freedesktop.DBus';
const DBUS_OBJECT_PATH = '/org/freedesktop/DBus';
const DBUS_INTERFACE = 'org.freedesktop.DBus';
// KWin answers scripting calls in single-digit milliseconds; anything slower means a
// wedged compositor, and a hotkey raise that arrives seconds late only confuses.
const KWIN_CALL_TIMEOUT_MS = 3000;

// Plasma 6 exposes windowList()/activeWindow, Plasma 5 clientList()/activeClient.
// The window is matched by its exact caption: the main window and every desktop pin
// pin their titles precisely so compositor-side tooling can address them.
function buildRaiseScript(title) {
  return [
    '(function () {',
    `  var wanted = ${JSON.stringify(String(title))};`,
    '  var plasma6 = typeof workspace.windowList === "function";',
    '  var windows = plasma6 ? workspace.windowList() : workspace.clientList();',
    '  for (var i = 0; i < windows.length; i += 1) {',
    '    var candidate = windows[i];',
    '    if (!candidate || candidate.caption !== wanted) continue;',
    '    if (plasma6) {',
    '      workspace.activeWindow = candidate;',
    '    } else {',
    '      workspace.activeClient = candidate;',
    '    }',
    '    break;',
    '  }',
    '})();',
    '',
  ].join('\n');
}

function createKWinWindowRaiser(options = {}) {
  const {
    log = console,
    env = process.env,
    platform = process.platform,
    scriptDir = os.tmpdir(),
    writeFile = fs.promises.writeFile,
    callTimeoutMs = KWIN_CALL_TIMEOUT_MS,
    // Injectable for tests; defaults to a real session bus connection. usocket is
    // avoided for the same reason as in portal-global-shortcuts.cjs.
    createBus = () => {
      const busAddress = getNetSessionBusAddress(env);
      if (!busAddress) {
        throw new Error('D-Bus session address is unavailable');
      }
      return require('dbus-next').sessionBus({ busAddress, negotiateUnixFd: false });
    },
  } = options;

  // Per-process plugin name so two app instances (or a crashed predecessor's leftover
  // registration) can never fight over the same KWin script slot.
  const pluginName = `ha-widget-raise-${process.pid}`;
  const scriptFilePath = path.join(scriptDir, `${pluginName}.js`);

  let bus = null;
  let dbusModule = null;
  let kwinPresentPromise = null;
  // Whether this KWin wants Plasma 6 (/Scripting/Script<id>) or Plasma 5 (/<id>)
  // script object paths; discovered on the first successful run.
  let scriptObjectStyle = null;
  // Serializes raises so a double-press cannot interleave two load/run/unload cycles
  // on the same plugin name.
  let queue = Promise.resolve();

  function getDbus() {
    if (!dbusModule) dbusModule = require('dbus-next');
    return dbusModule;
  }

  function resetBus(failedBus, error) {
    if (!failedBus || bus !== failedBus) return;
    bus = null;
    kwinPresentPromise = null;
    try {
      failedBus.disconnect?.();
    } catch {
      // best-effort cleanup
    }
    if (error) {
      log.debug?.(`KWin raise: D-Bus connection lost: ${error?.message || error}`);
    }
  }

  function ensureBus() {
    if (bus) return bus;
    const nextBus = createBus();
    bus = nextBus;
    // An unhandled EventEmitter 'error' would crash the app on a session-bus hiccup.
    nextBus.on('error', (error) => resetBus(nextBus, error));
    return nextBus;
  }

  function withTimeout(promise, member) {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error(`KWin ${member} call timed out`)),
        callTimeoutMs
      );
      promise.then(
        (value) => {
          clearTimeout(timer);
          resolve(value);
        },
        (error) => {
          clearTimeout(timer);
          reject(error);
        }
      );
    });
  }

  function busCall(fields) {
    const dbus = getDbus();
    return withTimeout(ensureBus().call(new dbus.Message(fields)), fields.member);
  }

  /**
   * Whether a KWin that can be scripted is on the session bus. Probed once and
   * cached; a failed probe (no bus, no KWin) is retried on the next raise so a
   * compositor restart is picked up.
   */
  function isKWinPresent() {
    if (platform !== 'linux') return Promise.resolve(false);
    if (!kwinPresentPromise) {
      kwinPresentPromise = busCall({
        destination: DBUS_BUS_NAME,
        path: DBUS_OBJECT_PATH,
        interface: DBUS_INTERFACE,
        member: 'NameHasOwner',
        signature: 's',
        body: [KWIN_BUS_NAME],
      }).then(
        (reply) => reply?.body?.[0] === true,
        (error) => {
          kwinPresentPromise = null;
          log.debug?.(`KWin raise: availability probe failed: ${error?.message || error}`);
          return false;
        }
      );
    }
    return kwinPresentPromise;
  }

  function scriptingCall(member, signature, body) {
    return busCall({
      destination: KWIN_BUS_NAME,
      path: KWIN_SCRIPTING_PATH,
      interface: KWIN_SCRIPTING_INTERFACE,
      member,
      signature,
      body,
    });
  }

  async function unloadScript() {
    try {
      await scriptingCall('unloadScript', 's', [pluginName]);
    } catch {
      // Nothing was loaded, or KWin is going away; either way nothing to clean up.
    }
  }

  async function runLoadedScript(scriptId) {
    const styles = scriptObjectStyle ? [scriptObjectStyle] : ['plasma6', 'plasma5'];
    let lastError = null;
    for (const style of styles) {
      const objectPath =
        style === 'plasma6' ? `${KWIN_SCRIPTING_PATH}/Script${scriptId}` : `/${scriptId}`;
      try {
        await busCall({
          destination: KWIN_BUS_NAME,
          path: objectPath,
          interface: KWIN_SCRIPT_INTERFACE,
          member: 'run',
        });
        scriptObjectStyle = style;
        return;
      } catch (error) {
        lastError = error;
      }
    }
    throw lastError;
  }

  async function performRaise(title) {
    if (!(await isKWinPresent())) return false;
    await writeFile(scriptFilePath, buildRaiseScript(title), 'utf8');
    // A plugin left registered by an interrupted earlier raise blocks loadScript.
    await unloadScript();
    const loadReply = await scriptingCall('loadScript', 'ss', [scriptFilePath, pluginName]);
    const scriptId = Number(loadReply?.body?.[0]);
    if (!Number.isInteger(scriptId) || scriptId < 0) {
      throw new Error(`KWin loadScript returned ${loadReply?.body?.[0]}`);
    }
    try {
      await runLoadedScript(scriptId);
    } finally {
      await unloadScript();
    }
    return true;
  }

  /**
   * Ask KWin to activate (focus + raise, in place) the window with this exact title.
   * Resolves true when KWin ran the activation script, false when KWin is not
   * available or the raise failed; never rejects.
   */
  function raiseWindowByTitle(title) {
    const wantedTitle = typeof title === 'string' ? title : '';
    if (!wantedTitle) return Promise.resolve(false);
    const next = queue.then(
      () => performRaise(wantedTitle),
      () => performRaise(wantedTitle)
    );
    queue = next.then(
      () => undefined,
      () => undefined
    );
    return next.catch((error) => {
      log.warn?.(`KWin raise failed for "${wantedTitle}": ${error?.message || error}`);
      return false;
    });
  }

  function close() {
    const current = bus;
    bus = null;
    kwinPresentPromise = null;
    try {
      current?.disconnect?.();
    } catch {
      // best-effort cleanup
    }
  }

  return {
    raiseWindowByTitle,
    isKWinPresent,
    close,
    getPluginName: () => pluginName,
    getScriptFilePath: () => scriptFilePath,
  };
}

module.exports = {
  KWIN_CALL_TIMEOUT_MS,
  buildRaiseScript,
  createKWinWindowRaiser,
};

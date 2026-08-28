const path = require('path');
const {
  getExplicitOzonePlatform,
  getOzonePlatformArgvValue,
  isDisabledEnvFlag,
  isEnabledEnvFlag,
} = require('./platform.cjs');
const { CONFIG_FILE_NAME } = require('./config-write-guard.cjs');

/**
 * Wayland layer-shell relaunch policy for tiling compositors (issue #79).
 *
 * Tiling Wayland compositors (Hyprland, Sway, niri, river) render every floating
 * xdg-shell toplevel above every tiled window, unconditionally, so the widget acts
 * as a permanent overlay there and no client-side call can lower it — xdg-shell has
 * no "keep below" request. The fix is to be a wlr-layer-shell surface on the
 * `bottom` layer, which Electron cannot create itself. The bundled `windowtolayer`
 * helper (vendor/windowtolayer, see its PATCHES.md) closes the gap: it serves a
 * private Wayland socket, relays every connection to the real compositor, and
 * rewrites xdg-shell toplevels into anchored bottom-layer surfaces on the way
 * through. This module decides when to hand the process off to that helper and
 * builds the spawn for it; main.js performs the handoff before taking the
 * single-instance lock.
 */

// Force the mode on ('1') or off ('0') regardless of compositor detection.
const LAYER_SHELL_ENV_OVERRIDE = 'HA_WIDGET_LINUX_LAYER_SHELL';
// Set (via the helper's environment) on the relaunched child so it does not hand off again.
const LAYER_SHELL_CHILD_ENV = 'HA_WIDGET_LAYER_SHELL_CHILD';
// The compositor's real socket, preserved across the handoff: inside the child
// WAYLAND_DISPLAY points at the helper's private socket, which dies with the helper,
// so a restart must reconnect the next helper to the real compositor instead.
const LAYER_SHELL_UPSTREAM_DISPLAY_ENV = 'HA_WIDGET_LAYER_SHELL_UPSTREAM_DISPLAY';
// Absolute path to a windowtolayer binary to use instead of the bundled one.
const LAYER_SHELL_HELPER_PATH_ENV = 'HA_WIDGET_WINDOWTOLAYER';
// Placement overrides for users whose compositor rules or taste differ from the default.
const LAYER_SHELL_ANCHOR_ENV = 'HA_WIDGET_LAYER_SHELL_ANCHOR';
const LAYER_SHELL_MARGIN_ENV = 'HA_WIDGET_LAYER_SHELL_MARGIN';
const LAYER_SHELL_OUTPUT_ENV = 'HA_WIDGET_LAYER_SHELL_OUTPUT';
const LAYER_SHELL_LAYER_ENV = 'HA_WIDGET_LAYER_SHELL_LAYER';
// Opt-out for the Hyprland layer-move animation tweak (disableHyprlandLayerMoveAnimation).
const LAYER_SHELL_KEEP_ANIMATIONS_ENV = 'HA_WIDGET_LAYER_SHELL_KEEP_LAYER_ANIMATIONS';

// Name of the helper's private Wayland socket in XDG_RUNTIME_DIR. The pid suffix keeps
// concurrent instances (a dev run beside the installed widget, or an in-app restart
// racing the old helper's exit cleanup) from unlinking each other's socket; the helper
// still removes a stale socket of the same name before binding.
function layerShellSocketName(pid = process.pid) {
  return `ha-widget-layer-shell-${pid}`;
}

const DEFAULT_ANCHOR = 'bottom,right';
const DEFAULT_MARGIN = '20';
const DEFAULT_LAYER = 'bottom';
const DEFAULT_WINDOW_SIZE = { width: 500, height: 600 };
const VALID_ANCHOR_EDGES = new Set(['top', 'bottom', 'left', 'right']);
const VALID_LAYERS = new Set(['background', 'bottom']);

/**
 * Return the tiling compositor this session runs on, or null. Detection is deliberately
 * an allowlist of compositors whose floating-above-tiled stacking makes the widget a
 * permanent overlay AND which implement wlr-layer-shell. Stacking compositors that also
 * implement the protocol (KWin, and Mutter does not) stay on the XWayland/native paths:
 * there the widget behaves like a normal window and should keep doing so.
 */
function detectTilingLayerShellCompositor(env = process.env, { exists } = {}) {
  const probe = (candidate) => {
    try {
      return (exists || require('fs').existsSync)(candidate);
    } catch {
      return false;
    }
  };
  // The instance variables alone are not trusted: `systemctl --user
  // import-environment` commonly leaks them into later sessions on other
  // compositors, where they would cost a doomed helper spawn on every launch.
  // Require the socket each variable names to actually exist. A real session
  // whose socket moved is still caught by the XDG_CURRENT_DESKTOP fallback,
  // which login sessions set afresh.
  const runtimeDir = String(env?.XDG_RUNTIME_DIR || '').trim();
  const hyprlandSignature = String(env?.HYPRLAND_INSTANCE_SIGNATURE || '').trim();
  if (hyprlandSignature) {
    const socketCandidates = [path.join('/tmp', 'hypr', hyprlandSignature, '.socket.sock')];
    if (runtimeDir) {
      // Hyprland >= 0.40 puts its sockets under XDG_RUNTIME_DIR; before that, /tmp.
      socketCandidates.unshift(path.join(runtimeDir, 'hypr', hyprlandSignature, '.socket.sock'));
    }
    if (socketCandidates.some(probe)) return 'hyprland';
  }
  const swaySocket = String(env?.SWAYSOCK || '').trim();
  if (swaySocket && probe(swaySocket)) return 'sway';
  const niriSocket = String(env?.NIRI_SOCKET || '').trim();
  if (niriSocket && probe(niriSocket)) return 'niri';
  const desktop = String(env?.XDG_CURRENT_DESKTOP || '').toLowerCase();
  for (const name of ['hyprland', 'sway', 'niri', 'river']) {
    if (desktop.includes(name)) return name;
  }
  return null;
}

function isLayerShellChild(env = process.env) {
  return isEnabledEnvFlag(env?.[LAYER_SHELL_CHILD_ENV]);
}

/**
 * Decide whether this process should hand off to the layer-shell helper and exit.
 * Runs before the single-instance lock, so a positive answer costs one spawn and
 * nothing else. The relaunched child never answers yes again (child marker), and a
 * smoke test must measure the process it launched, not a grandchild, so it opts out.
 */
function shouldRelaunchIntoLayerShell({
  platform = process.platform,
  env = process.env,
  argv = process.argv,
  waylandSession = false,
  // When provided (a name or null), reuse the caller's detection result
  // instead of detecting again; undefined means "detect here".
  detectedCompositor = undefined,
  exists = undefined,
} = {}) {
  if (platform !== 'linux' || !waylandSession) return false;
  if (isLayerShellChild(env)) return false;
  if ((argv || []).includes('--smoke-test')) return false;
  // The isolated climate demo creates its throwaway temp profile before this
  // decision runs; a handoff would orphan that profile on every launch, and a
  // demo has no reason to exercise the helper. The overlay variant shares the
  // regular dev profile and is unaffected.
  if ((argv || []).includes('--demo-climate')) return false;
  if (isDisabledEnvFlag(env?.[LAYER_SHELL_ENV_OVERRIDE])) return false;
  // The helper proxies the compositor's socket and binds its own next to it; without
  // a real display to reach or a runtime dir to bind in, the handoff can only fail.
  // This holds even under the force-on override.
  if (!String(env?.WAYLAND_DISPLAY || '').trim()) return false;
  if (!String(env?.XDG_RUNTIME_DIR || '').trim()) return false;
  // An explicit X11 backend request (argv, hint argument, or Electron's hint env
  // variable) cannot become a layer surface; respect it.
  if (getExplicitOzonePlatform(env, argv) === 'x11') return false;
  if (isEnabledEnvFlag(env?.[LAYER_SHELL_ENV_OVERRIDE])) return true;
  const compositor =
    detectedCompositor !== undefined
      ? detectedCompositor
      : detectTilingLayerShellCompositor(env, { exists });
  return compositor !== null;
}

/**
 * Find the windowtolayer binary: explicit override, the packaged copy under
 * resources/helpers, or the in-repo cargo build for development runs. Returns null
 * when none exists so the caller can fall back to running as a normal window.
 */
function resolveLayerShellHelperPath({
  env = process.env,
  isPackaged = false,
  resourcesPath = process.resourcesPath,
  appDir = '',
  exists = require('fs').existsSync,
} = {}) {
  const override = String(env?.[LAYER_SHELL_HELPER_PATH_ENV] || '').trim();
  const candidates = [];
  if (override) candidates.push(override);
  if (isPackaged && resourcesPath) {
    candidates.push(path.join(resourcesPath, 'helpers', 'windowtolayer'));
  }
  if (appDir) {
    candidates.push(
      path.join(appDir, 'vendor', 'windowtolayer', 'target', 'release', 'windowtolayer')
    );
  }
  for (const candidate of candidates) {
    try {
      if (exists(candidate)) return candidate;
    } catch {
      /* unreadable candidate: keep looking */
    }
  }
  return null;
}

// `onInvalid(raw, fallback)` is called when a SET value is discarded, so the
// caller can log it — a silently replaced override is indistinguishable from a
// broken one. An unset/empty value falls back without being reported.
function normalizeAnchor(value, onInvalid) {
  const raw = String(value || '').trim();
  if (!raw) return DEFAULT_ANCHOR;
  const edges = raw
    .toLowerCase()
    .split(',')
    .map((edge) => edge.trim())
    .filter(Boolean);
  if (!edges.length || !edges.every((edge) => VALID_ANCHOR_EDGES.has(edge))) {
    onInvalid?.(raw, DEFAULT_ANCHOR);
    return DEFAULT_ANCHOR;
  }
  return [...new Set(edges)].join(',');
}

function normalizeMargin(value, onInvalid) {
  const raw = String(value || '').trim();
  if (!raw) return DEFAULT_MARGIN;
  const parts = raw.split(',').map((part) => part.trim());
  // The helper parses each part as an i32: negative margins are legitimate
  // (bleeding past an anchored edge), so only the shape is validated here.
  const isValid =
    (parts.length === 1 || parts.length === 4) && parts.every((part) => /^-?\d{1,5}$/.test(part));
  if (!isValid) {
    onInvalid?.(raw, DEFAULT_MARGIN);
    return DEFAULT_MARGIN;
  }
  return parts.join(',');
}

function normalizeWindowSize(windowSize) {
  const clamp = (value, fallback) => {
    if (typeof value !== 'number' || !Number.isFinite(value)) return fallback;
    // Guards against corrupt saved values, not against a real compositor limit:
    // layer-shell set_size is an unbounded u32. 16384 comfortably covers any
    // real multi-monitor span (an 8K display is 7680 wide).
    return Math.min(16384, Math.max(100, Math.round(value)));
  };
  return {
    width: clamp(windowSize?.width, DEFAULT_WINDOW_SIZE.width),
    height: clamp(windowSize?.height, DEFAULT_WINDOW_SIZE.height),
  };
}

/**
 * Best-effort read of the saved window size so the layer surface starts at the size
 * the widget will take anyway. Runs before loadConfig(), so it reads the file
 * directly; any failure falls back to the default and the helper tracks the real
 * window size afterwards regardless.
 */
function readInitialLayerShellWindowSize(
  userDataPath,
  { readFileSync = require('fs').readFileSync } = {}
) {
  try {
    const raw = readFileSync(path.join(userDataPath, CONFIG_FILE_NAME), 'utf8');
    return normalizeWindowSize(JSON.parse(raw)?.windowSize);
  } catch {
    return { ...DEFAULT_WINDOW_SIZE };
  }
}

/**
 * Best-effort read of the saved monitor choice (wl_output name, e.g. "DP-1")
 * for the same reason and with the same caveats as the window size above: the
 * handoff decision runs before loadConfig(). '' means "let the compositor
 * choose". The helper itself falls back to the compositor's choice when the
 * saved name no longer matches a monitor, so a stale value cannot break launch.
 */
function readInitialLayerShellOutputName(
  userDataPath,
  { readFileSync = require('fs').readFileSync } = {}
) {
  try {
    const raw = readFileSync(path.join(userDataPath, CONFIG_FILE_NAME), 'utf8');
    const name = JSON.parse(raw)?.layerShellOutputName;
    return typeof name === 'string' ? name.trim() : '';
  } catch {
    return '';
  }
}

/**
 * Copy the helper out of a type-2 AppImage's FUSE mount before spawning it. The
 * mount lives only as long as the runtime's direct child — this process, which
 * exits right after the handoff — while the helper must outlive it. A demand-paged
 * ELF whose backing mount disappeared dies with SIGBUS on its next cold page
 * fault, so the helper must run from a real filesystem. Returns the path to run
 * (the copy, or the original outside an AppImage or when copying fails).
 */
function materializeLayerShellHelper(
  helperPath,
  {
    env = process.env,
    targetDir = '',
    copyFileSync = require('fs').copyFileSync,
    mkdirSync = require('fs').mkdirSync,
    chmodSync = require('fs').chmodSync,
    renameSync = require('fs').renameSync,
    statSync = require('fs').statSync,
    pid = process.pid,
    onError = null,
  } = {}
) {
  if (!targetDir || !String(env?.APPIMAGE || '').trim()) return helperPath;
  const appDir = String(env?.APPDIR || '')
    .trim()
    .replace(/\/+$/, '');
  const insideMount =
    (appDir && (helperPath === appDir || helperPath.startsWith(`${appDir}/`))) ||
    helperPath.includes('/.mount_');
  if (!insideMount) return helperPath;
  try {
    mkdirSync(targetDir, { recursive: true });
    const target = path.join(targetDir, 'windowtolayer');
    // Skip the copy when an identical helper is already materialized (same size —
    // mtime is unusable because copyFileSync stamps the copy time, not the
    // source's). Saves rewriting a multi-MB binary on every launch.
    try {
      if (statSync(target).size === statSync(helperPath).size) return target;
    } catch {
      /* missing or unreadable target: fall through to copying */
    }
    // Stage under a temp name and rename over: overwriting a binary an earlier
    // instance is still executing fails with ETXTBSY, while rename is atomic.
    const staging = path.join(targetDir, `.windowtolayer.${pid}`);
    copyFileSync(helperPath, staging);
    chmodSync(staging, 0o755);
    renameSync(staging, target);
    return target;
  } catch (error) {
    onError?.(error);
    return helperPath;
  }
}

/**
 * Report whether `pid` is a live, running process. `process.kill(pid, 0)` is not
 * enough here: while this thread blocks in Atomics.wait, libuv never runs, so an
 * exited helper stays a zombie the whole time we poll — and signal 0 succeeds on
 * zombies. Read the process state from /proc instead (Linux-only, which is all
 * this module supports): 'Z' (zombie) and 'X' (dead) mean the helper is gone,
 * as does a missing /proc entry.
 */
function isProcessAlive(pid, { readFileSync = require('fs').readFileSync } = {}) {
  try {
    const stat = String(readFileSync(`/proc/${pid}/stat`, 'utf8'));
    // Field 3 (state) follows the comm field, which is in parentheses and may
    // itself contain ')' — parse from the LAST ')' to stay correct for any name.
    const state = stat
      .slice(stat.lastIndexOf(')') + 1)
      .trim()
      .charAt(0);
    return state !== 'Z' && state !== 'X';
  } catch {
    return false;
  }
}

/**
 * Block until the helper reports readiness, or report failure. spawn() is
 * asynchronous and the handoff exits this process in the same tick, so readiness
 * must be observed synchronously — hence Atomics.wait as the sleep.
 *
 * Readiness is the marker file the helper writes next to its socket after it has
 * bound, started listening, AND spawned its child — containing the helper's own
 * pid. Watching the socket path alone has two failure modes this closes: a stale
 * socket from a previous instance with the same app pid (pid reuse) would read as
 * instantly ready, and "socket exists" says nothing about whether the helper got
 * as far as accepting connections. The marker content must match the pid we
 * actually spawned. The helper preflights the compositor connection before
 * binding and exits nonzero when it cannot serve, so "helper died" is the
 * definitive failure signal and lets the caller fall back to running as a normal
 * floating window instead of exec'ing into a broken session.
 */
function waitForLayerShellHelperReady(
  helper,
  readyPath,
  {
    timeoutMs = 5000,
    pollIntervalMs = 50,
    readFileSync = require('fs').readFileSync,
    isAlive = isProcessAlive,
    now = Date.now,
  } = {}
) {
  if (!readyPath) return false;
  const deadline = now() + timeoutMs;
  const sleeper = new Int32Array(new SharedArrayBuffer(4));
  for (;;) {
    // pid is undefined when spawn() itself already failed.
    const pid = helper?.pid;
    if (!pid) return false;
    try {
      if (String(readFileSync(readyPath, 'utf8')).trim() === String(pid)) return true;
    } catch {
      /* marker not written yet: keep polling */
    }
    // A dead helper (preflight refused, missing interpreter, wrong architecture)
    // will never write the marker; stop waiting the moment it exits.
    if (!isAlive(pid)) return false;
    if (now() >= deadline) return false;
    Atomics.wait(sleeper, 0, 0, pollIntervalMs);
  }
}

/**
 * Path of the helper's control socket, derived from the child's environment.
 * The helper binds it next to its Wayland socket (`<socket>.ctl`), and sets the
 * child's WAYLAND_DISPLAY to that socket's name — so this must be read BEFORE
 * restoreLayerShellParentEnv() rewrites WAYLAND_DISPLAY back to the compositor's.
 */
function getLayerShellControlSocketPath(env = process.env) {
  if (!isLayerShellChild(env)) return null;
  const display = String(env?.WAYLAND_DISPLAY || '').trim();
  if (!display) return null;
  if (path.isAbsolute(display)) return `${display}.ctl`;
  const runtimeDir = String(env?.XDG_RUNTIME_DIR || '').trim();
  if (!runtimeDir) return null;
  return path.join(runtimeDir, `${display}.ctl`);
}

/**
 * Client for the helper's control socket: the popup hotkey's raise lever when the
 * widget is a layer surface. A bottom-layer surface ignores every window-level
 * raise (setAlwaysOnTop, moveTop, compositor scripting), so the helper instead
 * moves the surface itself to the overlay layer ("raise") and back ("restore").
 * One short-lived connection per command, fire-and-forget: a helper that is gone
 * must degrade the popup to a no-op, never break or block the show path.
 */
function createLayerShellRaiser({
  controlSocketPath,
  connect = require('net').createConnection,
  log = console,
} = {}) {
  if (!controlSocketPath) return null;
  const send = (command) => {
    try {
      const socket = connect({ path: controlSocketPath });
      socket.on('error', (error) => {
        log.debug?.(`Layer-shell ${command} failed:`, error?.message || error);
      });
      // A helper wedged after accept() would otherwise hold this socket open forever.
      socket.setTimeout?.(1000, () => socket.destroy());
      // end() buffers the data and the FIN until the connection completes.
      socket.end(`${command}\n`);
    } catch (error) {
      log.debug?.(`Layer-shell ${command} failed:`, error?.message || error);
    }
  };
  /**
   * Ask the helper for the session's monitors. Resolves to
   * [{ name, description }] in the compositor's order, or [] on any failure —
   * callers (the tray's monitor submenu) must treat "no answer" as "offer
   * nothing", same degrade-to-no-op contract as raise/restore. The generous
   * timeout covers the helper's fresh registry scan (itself capped at ~2s).
   */
  const listOutputs = ({ timeoutMs = 4000 } = {}) =>
    new Promise((resolve) => {
      let settled = false;
      const finish = (outputs) => {
        if (settled) return;
        settled = true;
        resolve(outputs);
      };
      try {
        const socket = connect({ path: controlSocketPath });
        const chunks = [];
        socket.on('error', (error) => {
          log.debug?.('Layer-shell outputs query failed:', error?.message || error);
          finish([]);
        });
        socket.setTimeout?.(timeoutMs, () => socket.destroy());
        socket.on('data', (chunk) => chunks.push(chunk));
        socket.on('close', () => {
          const outputs = [];
          for (const line of Buffer.concat(chunks).toString('utf8').split('\n')) {
            const [name = '', description = ''] = line.split('\t');
            if (name.trim()) outputs.push({ name: name.trim(), description: description.trim() });
          }
          finish(outputs);
        });
        // end() flushes the command and half-closes; the helper replies then closes.
        socket.end('outputs\n');
      } catch (error) {
        log.debug?.('Layer-shell outputs query failed:', error?.message || error);
        finish([]);
      }
    });
  return {
    raise: () => send('raise'),
    restore: () => send('restore'),
    listOutputs,
  };
}

/**
 * Disable Hyprland's layer-surface move animation: the `layers` animation node,
 * whose `layersIn`/`layersOut` children (the open/close fades) are separately
 * resolved and stay as configured. Dragging the widget works by committing new
 * layer-shell margins for every pointer step, and the helper measures each step
 * against where the surface actually is — when Hyprland glides the surface
 * toward each committed position instead of applying it, the measurements lag
 * the commits and the drag feedback loop overshoots, badly enough to throw the
 * widget across the screen. No per-surface rule covers geometry (`layerrule
 * no_anim` only affects open/close), so this is a global, best-effort tweak
 * applied once per child start. Both hyprctl syntaxes are issued because the
 * classic config parser and the Lua one each reject the other's command, and
 * each ignores the other's failure. Fire-and-forget: a missing or failing
 * hyprctl must never break startup — the drag just degrades on such setups.
 */
function disableHyprlandLayerMoveAnimation({
  env = process.env,
  execFile = require('child_process').execFile,
  log = console,
} = {}) {
  if (!String(env?.HYPRLAND_INSTANCE_SIGNATURE || '').trim()) return false;
  if (isEnabledEnvFlag(env?.[LAYER_SHELL_KEEP_ANIMATIONS_ENV])) return false;
  const attempts = [
    ['keyword', 'animation', 'layers,0,1,default'],
    ['eval', 'hl.animation({ leaf = "layers", enabled = false })'],
  ];
  for (const args of attempts) {
    try {
      execFile('hyprctl', args, { timeout: 3000 }, (error, stdout, stderr) => {
        const output = `${stdout || ''}${stderr || ''}`.trim();
        if (error || (output && output !== 'ok')) {
          log.debug?.(
            `hyprctl ${args[0]} layer-animation tweak: ${output || error?.message || error}`
          );
        }
      });
    } catch (error) {
      log.debug?.('hyprctl layer-animation tweak failed:', error?.message || error);
    }
  }
  return true;
}

/**
 * Undo the layer-shell child environment on `env` (in place) so a relaunch that
 * does NOT go back through the helper — autoUpdater.quitAndInstall() or
 * app.relaunch() — starts a fresh process that redetects the compositor and hands
 * off again. Without this the relaunched app inherits the child marker plus a
 * WAYLAND_DISPLAY naming the old helper's socket, which dies with this process.
 */
function restoreLayerShellParentEnv(env = process.env) {
  const upstream = String(env?.[LAYER_SHELL_UPSTREAM_DISPLAY_ENV] || '').trim();
  if (upstream) env.WAYLAND_DISPLAY = upstream;
  delete env[LAYER_SHELL_UPSTREAM_DISPLAY_ENV];
  delete env[LAYER_SHELL_CHILD_ENV];
  return env;
}

/**
 * Build the complete spawn for the helper: command, arguments (helper options, then
 * the app binary and its arguments), and environment. The helper serves the private
 * socket, launches the app with WAYLAND_DISPLAY pointing at it, and exits when the
 * app does. The child gets an explicit --ozone-platform=wayland because a layer
 * surface only exists on the native backend and the argument outranks every other
 * backend-selection rule, including the app's own XWayland forcing.
 *
 * `onInvalidOverride(envName, raw, fallback)` is reported once per placement
 * override that was set but discarded, so the spawner can log it.
 */
function buildLayerShellSpawnPlan({
  helperPath,
  execPath = process.execPath,
  argv = process.argv,
  env = process.env,
  windowSize = DEFAULT_WINDOW_SIZE,
  // Saved monitor choice (wl_output name) from config; '' lets the compositor
  // decide. The env override below wins over it, keeping the debugging knob.
  outputName = '',
  // Where the helper persists the margins when the widget is dragged; '' skips
  // the flag (old helpers, or callers that do not want drag persistence).
  positionFilePath = '',
  pid = process.pid,
  onInvalidOverride = null,
} = {}) {
  const size = normalizeWindowSize(windowSize);
  const layerRaw = String(env?.[LAYER_SHELL_LAYER_ENV] || '')
    .trim()
    .toLowerCase();
  if (layerRaw && !VALID_LAYERS.has(layerRaw)) {
    onInvalidOverride?.(LAYER_SHELL_LAYER_ENV, layerRaw, DEFAULT_LAYER);
  }
  const socketName = layerShellSocketName(pid);
  const runtimeDir = String(env?.XDG_RUNTIME_DIR || '').trim();
  const helperArgs = [
    '--listen-socket',
    socketName,
    '--layer',
    VALID_LAYERS.has(layerRaw) ? layerRaw : DEFAULT_LAYER,
    '--interactivity',
    'all',
    '--anchor',
    normalizeAnchor(env?.[LAYER_SHELL_ANCHOR_ENV], (raw, fallback) =>
      onInvalidOverride?.(LAYER_SHELL_ANCHOR_ENV, raw, fallback)
    ),
    '--size',
    `${size.width}x${size.height}`,
    '--margin',
    normalizeMargin(env?.[LAYER_SHELL_MARGIN_ENV], (raw, fallback) =>
      onInvalidOverride?.(LAYER_SHELL_MARGIN_ENV, raw, fallback)
    ),
    '--namespace',
    'ha-widget',
  ];
  const chosenOutput =
    String(env?.[LAYER_SHELL_OUTPUT_ENV] || '').trim() || String(outputName || '').trim();
  if (chosenOutput) helperArgs.push('--output-name', chosenOutput);

  // A dragged position overrides --margin inside the helper, so leave it out
  // whenever a placement env override is active: an explicit margin must win,
  // and margins saved under a different anchor would mean the wrong corner.
  const placementOverridden = Boolean(
    String(env?.[LAYER_SHELL_MARGIN_ENV] || '').trim() ||
    String(env?.[LAYER_SHELL_ANCHOR_ENV] || '').trim()
  );
  const positionPath = String(positionFilePath || '').trim();
  if (positionPath && !placementOverridden) helperArgs.push('--position-file', positionPath);

  const childArgv = (argv || []).slice(1).filter((arg) => typeof arg === 'string');
  if (!getOzonePlatformArgvValue(childArgv)) {
    childArgv.push('--ozone-platform=wayland');
  }

  // Inside an AppImage, execPath points into the runtime's FUSE mount, which is
  // unmounted the moment this process exits — the helper's child must launch the
  // AppImage itself so it gets a mount of its own. The runtime stays alive for as
  // long as the app runs, so the helper's child-exit detection still works.
  const appImagePath = String(env?.APPIMAGE || '').trim();
  const childCommand = appImagePath || execPath;

  // On a restart from inside a layer-shell child, WAYLAND_DISPLAY names the previous
  // helper's socket; the preserved upstream value reconnects to the real compositor.
  const upstreamDisplay = String(
    env?.[LAYER_SHELL_UPSTREAM_DISPLAY_ENV] || env?.WAYLAND_DISPLAY || ''
  ).trim();
  const spawnEnv = { ...env };
  if (upstreamDisplay) {
    spawnEnv.WAYLAND_DISPLAY = upstreamDisplay;
    spawnEnv[LAYER_SHELL_UPSTREAM_DISPLAY_ENV] = upstreamDisplay;
  }
  spawnEnv[LAYER_SHELL_CHILD_ENV] = '1';

  return {
    command: helperPath,
    args: [...helperArgs, childCommand, ...childArgv],
    env: spawnEnv,
    // Where the helper will bind. Null only without XDG_RUNTIME_DIR, in which
    // case the helper refuses to start anyway.
    socketPath: runtimeDir ? path.join(runtimeDir, socketName) : null,
    // The pid-stamped marker the helper writes once it is accepting connections;
    // the spawner polls this (not the socket) for readiness.
    readyPath: runtimeDir ? path.join(runtimeDir, `${socketName}.ready`) : null,
  };
}

module.exports = {
  DEFAULT_WINDOW_SIZE,
  LAYER_SHELL_ANCHOR_ENV,
  LAYER_SHELL_CHILD_ENV,
  LAYER_SHELL_ENV_OVERRIDE,
  LAYER_SHELL_HELPER_PATH_ENV,
  LAYER_SHELL_KEEP_ANIMATIONS_ENV,
  LAYER_SHELL_LAYER_ENV,
  LAYER_SHELL_MARGIN_ENV,
  LAYER_SHELL_OUTPUT_ENV,
  LAYER_SHELL_UPSTREAM_DISPLAY_ENV,
  buildLayerShellSpawnPlan,
  createLayerShellRaiser,
  detectTilingLayerShellCompositor,
  disableHyprlandLayerMoveAnimation,
  getLayerShellControlSocketPath,
  isLayerShellChild,
  isProcessAlive,
  layerShellSocketName,
  materializeLayerShellHelper,
  readInitialLayerShellOutputName,
  readInitialLayerShellWindowSize,
  resolveLayerShellHelperPath,
  restoreLayerShellParentEnv,
  shouldRelaunchIntoLayerShell,
  waitForLayerShellHelperReady,
};

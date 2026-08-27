const path = require('path');
const { getExplicitOzonePlatform, isDisabledEnvFlag, isEnabledEnvFlag } = require('./platform.cjs');

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
function detectTilingLayerShellCompositor(env = process.env) {
  if (String(env?.HYPRLAND_INSTANCE_SIGNATURE || '').trim()) return 'hyprland';
  if (String(env?.SWAYSOCK || '').trim()) return 'sway';
  if (String(env?.NIRI_SOCKET || '').trim()) return 'niri';
  const desktop = String(env?.XDG_CURRENT_DESKTOP || '').toLowerCase();
  for (const name of ['hyprland', 'sway', 'niri', 'river']) {
    if (desktop.includes(name)) return name;
  }
  return null;
}

function isLayerShellChild(env = process.env) {
  return isEnabledEnvFlag(env?.[LAYER_SHELL_CHILD_ENV]);
}

function getExplicitOzoneArgvPlatform(argv) {
  const args = Array.isArray(argv) ? argv : [];
  for (let index = args.length - 1; index >= 0; index -= 1) {
    const argument = args[index];
    if (typeof argument !== 'string') continue;
    if (argument.startsWith('--ozone-platform=')) {
      return argument.slice('--ozone-platform='.length).trim().toLowerCase();
    }
    if (argument === '--ozone-platform' && typeof args[index + 1] === 'string') {
      return args[index + 1].trim().toLowerCase();
    }
  }
  return '';
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
} = {}) {
  if (platform !== 'linux' || !waylandSession) return false;
  if (isLayerShellChild(env)) return false;
  if ((argv || []).includes('--smoke-test')) return false;
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
  return detectTilingLayerShellCompositor(env) !== null;
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

function normalizeAnchor(value) {
  const edges = String(value || '')
    .toLowerCase()
    .split(',')
    .map((edge) => edge.trim())
    .filter(Boolean);
  if (!edges.length || !edges.every((edge) => VALID_ANCHOR_EDGES.has(edge))) return DEFAULT_ANCHOR;
  return [...new Set(edges)].join(',');
}

function normalizeMargin(value) {
  const raw = String(value || '').trim();
  const parts = raw.split(',').map((part) => part.trim());
  const isValid =
    (parts.length === 1 || parts.length === 4) && parts.every((part) => /^\d{1,4}$/.test(part));
  return isValid ? parts.join(',') : DEFAULT_MARGIN;
}

function normalizeWindowSize(windowSize) {
  const clamp = (value, fallback) => {
    if (typeof value !== 'number' || !Number.isFinite(value)) return fallback;
    return Math.min(4096, Math.max(100, Math.round(value)));
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
    const raw = readFileSync(path.join(userDataPath, 'config.json'), 'utf8');
    return normalizeWindowSize(JSON.parse(raw)?.windowSize);
  } catch {
    return { ...DEFAULT_WINDOW_SIZE };
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
 * Block until the helper has bound its private socket, or report failure. spawn()
 * is asynchronous and the handoff exits this process in the same tick, so
 * readiness must be observed synchronously — hence Atomics.wait as the sleep. The
 * helper preflights the compositor connection (reachable, advertises
 * wlr-layer-shell) before binding and exits nonzero when it cannot serve, so
 * "helper died" is the definitive failure signal and lets the caller fall back to
 * running as a normal floating window instead of exec'ing into a broken session.
 */
function waitForLayerShellHelperReady(
  helper,
  socketPath,
  {
    timeoutMs = 5000,
    pollIntervalMs = 50,
    exists = require('fs').existsSync,
    signalProcess = (pid) => process.kill(pid, 0),
    now = Date.now,
  } = {}
) {
  if (!socketPath) return false;
  const deadline = now() + timeoutMs;
  const sleeper = new Int32Array(new SharedArrayBuffer(4));
  for (;;) {
    try {
      if (exists(socketPath)) return true;
    } catch {
      /* transient stat failure: keep polling */
    }
    // pid is undefined when spawn() already failed; a dead helper (preflight
    // refused, missing interpreter, wrong architecture) makes signal 0 throw.
    const pid = helper?.pid;
    if (!pid) return false;
    try {
      signalProcess(pid);
    } catch {
      return false;
    }
    if (now() >= deadline) return false;
    Atomics.wait(sleeper, 0, 0, pollIntervalMs);
  }
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
 */
function buildLayerShellSpawnPlan({
  helperPath,
  execPath = process.execPath,
  argv = process.argv,
  env = process.env,
  windowSize = DEFAULT_WINDOW_SIZE,
  pid = process.pid,
} = {}) {
  const size = normalizeWindowSize(windowSize);
  const layerRaw = String(env?.[LAYER_SHELL_LAYER_ENV] || '')
    .trim()
    .toLowerCase();
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
    normalizeAnchor(env?.[LAYER_SHELL_ANCHOR_ENV] || DEFAULT_ANCHOR),
    '--size',
    `${size.width}x${size.height}`,
    '--margin',
    normalizeMargin(env?.[LAYER_SHELL_MARGIN_ENV] || DEFAULT_MARGIN),
    '--namespace',
    'ha-widget',
  ];
  const outputName = String(env?.[LAYER_SHELL_OUTPUT_ENV] || '').trim();
  if (outputName) helperArgs.push('--output-name', outputName);

  const childArgv = (argv || []).slice(1).filter((arg) => typeof arg === 'string');
  if (!getExplicitOzoneArgvPlatform(childArgv)) {
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
    // Where the helper will bind; the spawner polls this for readiness. Null only
    // without XDG_RUNTIME_DIR, in which case the helper refuses to start anyway.
    socketPath: runtimeDir ? path.join(runtimeDir, socketName) : null,
  };
}

module.exports = {
  DEFAULT_WINDOW_SIZE,
  LAYER_SHELL_ANCHOR_ENV,
  LAYER_SHELL_CHILD_ENV,
  LAYER_SHELL_ENV_OVERRIDE,
  LAYER_SHELL_HELPER_PATH_ENV,
  LAYER_SHELL_LAYER_ENV,
  LAYER_SHELL_MARGIN_ENV,
  LAYER_SHELL_OUTPUT_ENV,
  LAYER_SHELL_UPSTREAM_DISPLAY_ENV,
  buildLayerShellSpawnPlan,
  detectTilingLayerShellCompositor,
  isLayerShellChild,
  layerShellSocketName,
  materializeLayerShellHelper,
  readInitialLayerShellWindowSize,
  resolveLayerShellHelperPath,
  restoreLayerShellParentEnv,
  shouldRelaunchIntoLayerShell,
  waitForLayerShellHelperReady,
};

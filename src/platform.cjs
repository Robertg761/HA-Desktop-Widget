const path = require('path');

function getAppIconPath(baseDir, platform = process.platform) {
  const iconFile = platform === 'win32' ? 'icon.ico' : 'icon.png';
  return path.join(baseDir, 'build', iconFile);
}

function supportsElectronLoginItems(platform = process.platform) {
  return platform === 'win32' || platform === 'darwin';
}

function isLinuxAppImage(env = process.env) {
  return Boolean(env && env.APPIMAGE);
}

function supportsAutoUpdater(platform = process.platform, env = process.env) {
  if (platform === 'linux') return isLinuxAppImage(env);
  // Current macOS artifacts are ad-hoc signed rather than Developer-ID signed/notarized.
  // Keep those builds on the explicit Releases download path until the release pipeline
  // can produce and smoke-test a trusted signature for Squirrel.Mac.
  if (platform === 'darwin') return false;
  return platform === 'win32';
}

function shouldUseTransparentWindow(platform = process.platform, env = process.env) {
  if (platform !== 'linux') return true;
  return isEnabledEnvFlag(env?.HA_WIDGET_LINUX_TRANSPARENT_WINDOW);
}

const NATIVE_WAYLAND_ENV_OVERRIDE = 'HA_WIDGET_LINUX_NATIVE_WAYLAND';

function isEnabledEnvFlag(value) {
  const normalized = String(value || '')
    .trim()
    .toLowerCase();
  return normalized === '1' || normalized === 'true' || normalized === 'yes';
}

function isDisabledEnvFlag(value) {
  const normalized = String(value || '')
    .trim()
    .toLowerCase();
  return normalized === '0' || normalized === 'false' || normalized === 'no';
}

const LINUX_PASSWORD_STORE_ENV_OVERRIDE = 'HA_WIDGET_LINUX_PASSWORD_STORE';

// Desktops Chromium's own table maps to a real OS keyring. Every one of these already ends up
// on libsecret or KWallet without our help, and KDE in particular must keep KWallet, so the
// backend choice on these stays Chromium's.
const DESKTOPS_WITH_CHROMIUM_KEYRING = new Set([
  'cinnamon',
  'deepin',
  'gnome',
  'kde',
  'pantheon',
  'ukui',
  'unity',
  'x-cinnamon',
]);

function hasChromiumKeyringDesktop(env = process.env) {
  // XDG_CURRENT_DESKTOP is a colon-separated list, and prefixed forms like "ubuntu:GNOME"
  // are normal, so this matches on any one entry rather than the whole string.
  const currentDesktops = String(env?.XDG_CURRENT_DESKTOP || '')
    .toLowerCase()
    .split(':');
  if (currentDesktops.some((desktop) => DESKTOPS_WITH_CHROMIUM_KEYRING.has(desktop.trim()))) {
    return true;
  }
  // Chromium falls back to DESKTOP_SESSION when XDG_CURRENT_DESKTOP says nothing useful, where
  // the values are session names ("gnome-xorg", "plasmawayland", "ubuntu") rather than tokens.
  const session = String(env?.DESKTOP_SESSION || '')
    .trim()
    .toLowerCase();
  if (!session) return false;
  return ['cinnamon', 'deepin', 'gnome', 'kde', 'pantheon', 'plasma', 'ubuntu', 'ukui'].some(
    (prefix) => session.startsWith(prefix)
  );
}

/**
 * Decide which Chromium `--password-store` backend to name on Linux ('' to leave it to Chromium).
 *
 * Chromium picks the keyring backend from the desktop environment, and its table only covers the
 * long-established desktops. On anything else -- wlroots compositors like Hyprland, Sway, river
 * and niri, but also XFCE, LXQt and bare window managers -- it falls through to the plaintext
 * `basic_text` backend, and safeStorage then reports encryption as unavailable. The widget
 * refuses to write a refresh token under that backend, so OAuth pairing failed outright with
 * "Secure credential storage is unavailable on this system" on machines whose Secret Service was
 * running and reachable the whole time, and long-lived tokens were silently dropped from the
 * saved config instead of being persisted.
 *
 * Naming the backend ourselves is the only way in: the switch has to be set before the app is
 * ready, long before safeStorage can be asked what it chose. Measured on a machine with no
 * reachable Secret Service, the libsecret backend fails to initialize and Chromium lands back on
 * `basic_text` -- the same place that machine already was, so naming it costs nothing when it
 * turns out there is no keyring to talk to.
 *
 * Set HA_WIDGET_LINUX_PASSWORD_STORE to another backend ('kwallet6', 'basic_text', ...) to name a
 * different one, or to 0/false/no to leave the choice to Chromium. Passing --password-store
 * yourself wins outright.
 */
function resolveLinuxPasswordStoreBackend({
  platform = process.platform,
  env = process.env,
  argv = process.argv,
} = {}) {
  if (platform !== 'linux') return '';
  // An explicit choice from the launcher or the user wins over ours.
  const hasExplicitArg = (argv || []).some(
    (arg) => typeof arg === 'string' && arg.startsWith('--password-store')
  );
  if (hasExplicitArg) return '';
  const override = String(env?.[LINUX_PASSWORD_STORE_ENV_OVERRIDE] || '').trim();
  if (override) return isDisabledEnvFlag(override) ? '' : override.toLowerCase();
  if (hasChromiumKeyringDesktop(env)) return '';
  return 'gnome-libsecret';
}

/**
 * Decide whether to run the widget through XWayland on a Wayland session.
 *
 * A Wayland compositor owns window placement: it ignores the position the widget asks
 * for and re-places the window every time it is mapped, so hiding the widget and showing
 * it again loses wherever the user put it, and window opacity is ignored as well. Under
 * XWayland the X11 semantics the widget is built on apply again. See
 * docs/linux-wayland-notes.md for the measurements behind this.
 *
 * Set HA_WIDGET_LINUX_NATIVE_WAYLAND=1, or pass --ozone-platform yourself, to opt out.
 * `previousAttemptFailed` carries the verdict from a machine where XWayland could not render,
 * so that machine stops paying for a doomed attempt on every start.
 */
function shouldForceX11OzonePlatform({
  platform = process.platform,
  env = process.env,
  argv = process.argv,
  waylandSession = false,
  previousAttemptFailed = false,
} = {}) {
  if (platform !== 'linux' || !waylandSession) return false;
  if (previousAttemptFailed) return false;
  if (isEnabledEnvFlag(env?.[NATIVE_WAYLAND_ENV_OVERRIDE])) return false;
  // Without XWayland there is no X11 display to fall back to, and forcing it would stop the
  // app from starting at all. Plasma can run without XWayland, so this is a real setup.
  if (!String(env?.DISPLAY || '').trim()) return false;
  // An explicit choice from the launcher or the user wins over ours.
  const hasExplicitOzoneArg = (argv || []).some(
    (arg) => typeof arg === 'string' && arg.startsWith('--ozone-platform')
  );
  if (hasExplicitOzoneArg) return false;
  const ozoneHint = String(env?.ELECTRON_OZONE_PLATFORM_HINT || '')
    .trim()
    .toLowerCase();
  if (ozoneHint === 'wayland') return false;
  return true;
}

/**
 * Return the value of an explicit `--ozone-platform` argument in argv ('' when
 * absent), deliberately ignoring `--ozone-platform-hint` and the hint env
 * variable. Callers that want the full precedence order across all backend
 * selection channels use getExplicitOzonePlatform instead.
 */
function getOzonePlatformArgvValue(argv) {
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

function getExplicitOzonePlatform(env = process.env, argv = process.argv) {
  const args = Array.isArray(argv) ? argv : [];
  for (let index = args.length - 1; index >= 0; index -= 1) {
    const argument = args[index];
    if (typeof argument !== 'string') continue;
    if (argument.startsWith('--ozone-platform=')) {
      return argument.slice('--ozone-platform='.length).trim().toLowerCase();
    }
    if (argument.startsWith('--ozone-platform-hint=')) {
      return argument.slice('--ozone-platform-hint='.length).trim().toLowerCase();
    }
    if (argument === '--ozone-platform' && typeof args[index + 1] === 'string') {
      return args[index + 1].trim().toLowerCase();
    }
    if (argument === '--ozone-platform-hint' && typeof args[index + 1] === 'string') {
      return args[index + 1].trim().toLowerCase();
    }
  }
  return String(env?.ELECTRON_OZONE_PLATFORM_HINT || '')
    .trim()
    .toLowerCase();
}

/**
 * Return whether Electron is effectively using native Wayland window semantics.
 *
 * Session variables alone are insufficient: an app launched from a Wayland
 * desktop may explicitly select the X11 Ozone backend. Command-line selection
 * takes precedence over ELECTRON_OZONE_PLATFORM_HINT, matching Chromium.
 */
function shouldUseCompositorOwnedPlacement({
  platform = process.platform,
  env = process.env,
  argv = process.argv,
  waylandSession = false,
  forcedX11Ozone = false,
} = {}) {
  if (platform !== 'linux' || !waylandSession || forcedX11Ozone) return false;
  const explicitPlatform = getExplicitOzonePlatform(env, argv);
  if (explicitPlatform === 'x11') return false;
  if (explicitPlatform === 'wayland') return true;
  return true;
}

/**
 * Return whether global hotkeys should route through the XDG GlobalShortcuts portal.
 *
 * Unlike window placement, this follows the session rather than the Ozone backend: the
 * compositor owns global shortcuts on any Wayland session, and under XWayland an XGrabKey
 * grab only fires while another X11 client has focus, so globalShortcut is not a full
 * substitute there either. Whether the portal actually exists on the compositor is the
 * portal controller's own availability check.
 */
function shouldUsePortalGlobalShortcuts({
  platform = process.platform,
  waylandSession = false,
} = {}) {
  return platform === 'linux' && waylandSession;
}

/**
 * Return whether the legacy globalShortcut / XGrabKey hotkey backends can register
 * at all when the GlobalShortcuts portal is unavailable.
 *
 * On a native-Wayland Electron session globalShortcut is a hard no-op with no
 * XGrabKey fallback; under forced XWayland the fallback exists but its grabs only
 * fire while an X11 client has focus. This intentionally re-states the native-Wayland
 * test from shouldUseCompositorOwnedPlacement instead of delegating to it: window
 * placement and hotkey-backend capability are different questions, and a future
 * change to placement policy must not silently flip hotkey availability.
 */
function hasGlobalShortcutFallback({
  platform = process.platform,
  env = process.env,
  argv = process.argv,
  waylandSession = false,
  forcedX11Ozone = false,
} = {}) {
  if (platform !== 'linux' || !waylandSession || forcedX11Ozone) return true;
  return getExplicitOzonePlatform(env, argv) === 'x11';
}

function getMainWindowVisualOptions({
  platform = process.platform,
  frostedGlass = false,
  transparencyOptions = {},
} = {}) {
  const options = {
    transparent: !!transparencyOptions.transparent,
    backgroundColor:
      transparencyOptions.backgroundColor ||
      (transparencyOptions.transparent ? '#00000000' : '#28282d'),
  };

  if (platform === 'win32') {
    options.thickFrame = true;
    if (frostedGlass) {
      options.backgroundMaterial = 'acrylic';
    }
  } else if (platform === 'darwin' && frostedGlass) {
    options.vibrancy = 'sidebar';
  } else if (platform === 'linux') {
    options.roundedCorners = false;
  }

  return options;
}

module.exports = {
  LINUX_PASSWORD_STORE_ENV_OVERRIDE,
  NATIVE_WAYLAND_ENV_OVERRIDE,
  getAppIconPath,
  getExplicitOzonePlatform,
  getOzonePlatformArgvValue,
  getMainWindowVisualOptions,
  hasGlobalShortcutFallback,
  isDisabledEnvFlag,
  isEnabledEnvFlag,
  isLinuxAppImage,
  resolveLinuxPasswordStoreBackend,
  shouldForceX11OzonePlatform,
  shouldUseCompositorOwnedPlacement,
  shouldUsePortalGlobalShortcuts,
  shouldUseTransparentWindow,
  supportsAutoUpdater,
  supportsElectronLoginItems,
};

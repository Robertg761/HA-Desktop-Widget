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
  const override = String(env?.HA_WIDGET_LINUX_TRANSPARENT_WINDOW || '')
    .trim()
    .toLowerCase();
  return override === '1' || override === 'true' || override === 'yes';
}

const NATIVE_WAYLAND_ENV_OVERRIDE = 'HA_WIDGET_LINUX_NATIVE_WAYLAND';

function isEnabledEnvFlag(value) {
  const normalized = String(value || '')
    .trim()
    .toLowerCase();
  return normalized === '1' || normalized === 'true' || normalized === 'yes';
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
  NATIVE_WAYLAND_ENV_OVERRIDE,
  getAppIconPath,
  getMainWindowVisualOptions,
  isLinuxAppImage,
  shouldForceX11OzonePlatform,
  shouldUseCompositorOwnedPlacement,
  shouldUseTransparentWindow,
  supportsAutoUpdater,
  supportsElectronLoginItems,
};

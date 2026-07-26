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
  return platform === 'win32' || platform === 'darwin';
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
  shouldUseTransparentWindow,
  supportsAutoUpdater,
  supportsElectronLoginItems,
};

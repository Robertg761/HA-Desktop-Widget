/**
 * Which kind of glass a window can draw.
 *
 * The main process asks it which Windows builds can blur behind the window, and the renderer asks
 * it what to paint, so the two never disagree about whether Frosted glass is on.
 */

// Electron applies backgroundMaterial only on Windows 11 22H2, which is build 22621. Windows 10
// and older Windows 11 builds ignore it, and the window stays a plain transparent tint.
const WINDOWS_ACRYLIC_MIN_BUILD = 22621;

/**
 * The build number out of an os.release() string such as "10.0.22631", or null when the string
 * does not carry one.
 */
function getWindowsBuildNumber(release) {
  const build = Number.parseInt(String(release || '').split('.')[2], 10);
  return Number.isFinite(build) ? build : null;
}

/**
 * Whether the OS can blur behind a transparent window. Only Windows needs asking: macOS vibrancy
 * is always there and Linux never uses native glass. A Windows release string that cannot be read
 * counts as supported, so a surprise there leaves the look the app already had.
 * @param {{platform?: string, release?: string}} [options]
 * @returns {boolean}
 */
function supportsNativeGlass({ platform, release } = {}) {
  if (platform !== 'win32') return true;
  const build = getWindowsBuildNumber(release);
  return build === null || build >= WINDOWS_ACRYLIC_MIN_BUILD;
}

/**
 * Whether Frosted glass can be drawn at all. Only an explicit `false` from the main process
 * withholds it, and only on Windows, so a renderer that never heard from the main process keeps
 * the glass it always had.
 * @param {{platform?: string|null, nativeGlassSupported?: boolean}} [options]
 * @returns {boolean}
 */
function isGlassAvailable({ platform, nativeGlassSupported } = {}) {
  return !(platform === 'win32' && nativeGlassSupported === false);
}

/**
 * What the window paints for the Frosted glass setting.
 *
 * - 'native': the OS blurs behind the window (Windows acrylic, macOS vibrancy).
 * - 'software': the page tints itself, because nothing can blur the desktop behind it (Linux).
 * - 'off': the solid panel, which is also what Windows without acrylic gets, so a saved
 *   "on" never leaves the widget as an unblurred tint over a sharp desktop.
 * @param {{platform?: string|null, frostedGlass?: boolean, nativeGlassSupported?: boolean}} [options]
 * @returns {'native'|'software'|'off'}
 */
function resolveGlassMode({ platform, frostedGlass, nativeGlassSupported } = {}) {
  if (!frostedGlass || !isGlassAvailable({ platform, nativeGlassSupported })) return 'off';
  return platform === 'win32' || platform === 'darwin' ? 'native' : 'software';
}

module.exports = {
  WINDOWS_ACRYLIC_MIN_BUILD,
  getWindowsBuildNumber,
  isGlassAvailable,
  resolveGlassMode,
  supportsNativeGlass,
};

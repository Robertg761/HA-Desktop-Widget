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
  getAppIconPath,
  getMainWindowVisualOptions,
  isLinuxAppImage,
  shouldUseTransparentWindow,
  supportsAutoUpdater,
  supportsElectronLoginItems,
};

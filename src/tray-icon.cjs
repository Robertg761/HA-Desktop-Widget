/* global console, process */

const fs = require('fs');
const path = require('path');
const { getTrayIconSizeForPlatform } = require('./tray-entities.cjs');

// The macOS menu bar tints a template image (black with alpha) for light, dark and highlighted
// menu bars, so it is drawn at the menu bar's own 22 pt and 44 px sizes and never resized.
const TRAY_TEMPLATE_NAME = 'trayTemplate.png';
const LINUX_TRAY_SCALE_FACTORS = Object.freeze([1, 2]);
const MAX_WINDOWS_TRAY_ICON_SIZE = 48;

/**
 * The pixel size of the notification-area icon at the display's scaling. Windows draws the small
 * icon at 16 px for 100%, 20 px for 125%, 24 px for 150% and 32 px for 200% and rescales any other
 * size it is given, which blurs it; a bitmap of exactly this size is shown as it is.
 */
function getWindowsTrayIconSize(scaleFactor = 1) {
  const scale = Number.isFinite(scaleFactor) && scaleFactor > 0 ? scaleFactor : 1;
  return Math.min(MAX_WINDOWS_TRAY_ICON_SIZE, Math.max(16, Math.round(16 * scale)));
}

/** Every existing file for these names, in the order they should be tried. */
function findIcons(names, searchRoots, exists) {
  const found = [];
  for (const name of names) {
    for (const root of searchRoots) {
      if (!root) continue;
      for (const candidate of [path.join(root, name), path.join(root, 'icons', name)]) {
        if (exists(candidate)) found.push(candidate);
      }
    }
  }
  return found;
}

/** The first of these files that decodes to an image. */
function loadFirstImage(nativeImage, candidates, log) {
  for (const candidate of candidates) {
    const image = loadImage(nativeImage, candidate, log);
    if (image) return image;
  }
  return null;
}

function loadImage(nativeImage, candidate, log) {
  try {
    const image = nativeImage.createFromPath(candidate);
    return image && !image.isEmpty() ? image : null;
  } catch (error) {
    log.warn?.('Failed to load tray icon', candidate, error.message);
    return null;
  }
}

/**
 * An image with a representation drawn at each scale factor, so a HiDPI bar shows true pixels
 * instead of a small bitmap stretched.
 */
function buildRepresentations(nativeImage, source, size, scaleFactors) {
  const image = nativeImage.createEmpty();
  for (const scaleFactor of scaleFactors) {
    const px = Math.round(size * scaleFactor);
    const resized = source.resize({ width: px, height: px, quality: 'best' });
    image.addRepresentation({ scaleFactor, dataURL: resized.toDataURL() });
  }
  return image;
}

/**
 * Load the application's tray icon from the artwork in `build/`.
 * - macOS: the monochrome template image, handed to the menu bar untouched and marked as a
 *   template. The full-colour icon is only a fallback for a package that lacks it.
 * - Windows: one bitmap at exactly the notification area's size for the display's scaling.
 * - Linux: the colour icon at 1x and 2x, which is what a StatusNotifier host asks for.
 * @returns {Electron.NativeImage|null} Null when no icon could be loaded.
 */
function loadTrayIcon({
  platform = process.platform,
  searchRoots = [],
  nativeImage,
  scaleFactor = 1,
  exists = fs.existsSync,
  log = console,
} = {}) {
  if (platform === 'darwin') {
    const template = loadFirstImage(
      nativeImage,
      findIcons([TRAY_TEMPLATE_NAME], searchRoots, exists),
      log
    );
    if (template) {
      template.setTemplateImage?.(true);
      return template;
    }
  }

  // The 847 px PNG is the master artwork; the .ico is only there if the PNG is not.
  const source = loadFirstImage(
    nativeImage,
    findIcons(['icon.png', 'icon.ico'], searchRoots, exists),
    log
  );
  if (!source) return null;

  if (platform === 'win32') {
    const size = getWindowsTrayIconSize(scaleFactor);
    return source.resize({ width: size, height: size, quality: 'best' });
  }
  return buildRepresentations(
    nativeImage,
    source,
    getTrayIconSizeForPlatform(platform),
    LINUX_TRAY_SCALE_FACTORS
  );
}

module.exports = {
  TRAY_TEMPLATE_NAME,
  getWindowsTrayIconSize,
  loadTrayIcon,
};

/* global Buffer, console, process */

const fs = require('fs');
const path = require('path');
const { getTrayIconSizeForPlatform } = require('./tray-entities.cjs');

// The macOS menu bar tints a template image (black with alpha) for light, dark and highlighted
// menu bars, so it is drawn at the menu bar's own 22 pt and 44 px sizes and never resized.
const TRAY_TEMPLATE_NAME = 'trayTemplate.png';
const WINDOWS_ICON_NAME = 'icon.ico';
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

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/**
 * The frames of an .ico file. Each is a PNG (the 256 px one) or a 32-bit bitmap, which is how
 * build/icon.ico stores the small sizes; a frame in any other encoding is left out.
 * @returns {{width: number, height: number, png?: Buffer, bitmap?: Buffer}[]}
 */
function readIcoFrames(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 6) return [];
  if (buffer.readUInt16LE(0) !== 0 || buffer.readUInt16LE(2) !== 1) return [];
  const frames = [];
  for (let index = 0; index < buffer.readUInt16LE(4); index++) {
    const entry = 6 + index * 16;
    if (entry + 16 > buffer.length) break;
    const size = buffer.readUInt32LE(entry + 8);
    const offset = buffer.readUInt32LE(entry + 12);
    if (size === 0 || offset + size > buffer.length) continue;
    const data = buffer.subarray(offset, offset + size);
    if (data.subarray(0, PNG_SIGNATURE.length).equals(PNG_SIGNATURE)) {
      // A PNG frame states its own size (width and height follow the signature and the IHDR tag).
      if (data.length >= 24) {
        frames.push({ width: data.readUInt32BE(16), height: data.readUInt32BE(20), png: data });
      }
      continue;
    }
    const width = data.length >= 16 ? data.readInt32LE(4) : 0;
    // A bitmap frame's height counts the (empty) mask under the colours, so it is double.
    const height = data.length >= 16 ? Math.abs(data.readInt32LE(8)) / 2 : 0;
    const headerSize = data.length >= 4 ? data.readUInt32LE(0) : 0;
    const bitCount = data.length >= 16 ? data.readUInt16LE(14) : 0;
    if (bitCount !== 32 || width <= 0 || height <= 0 || headerSize + width * height * 4 > size) {
      continue;
    }
    // Straight alpha, bottom-up rows, as a bitmap in a native image is premultiplied top-down.
    const bitmap = Buffer.alloc(width * height * 4);
    for (let row = 0; row < height; row++) {
      const from = headerSize + (height - 1 - row) * width * 4;
      for (let column = 0; column < width; column++) {
        const source = from + column * 4;
        const target = (row * width + column) * 4;
        const alpha = data[source + 3];
        for (let channel = 0; channel < 3; channel++) {
          bitmap[target + channel] = Math.round((data[source + channel] * alpha) / 255);
        }
        bitmap[target + 3] = alpha;
      }
    }
    frames.push({ width, height, bitmap });
  }
  return frames;
}

/**
 * The icon frame to draw at `size` px: the exact size when the file has it, else the next larger
 * one scaled down, else the largest there is.
 */
function pickIcoFrame(frames, size) {
  const square = frames.filter((frame) => frame.width === frame.height);
  const exact = square.find((frame) => frame.width === size);
  if (exact) return exact;
  const larger = square.filter((frame) => frame.width > size).sort((a, b) => a.width - b.width);
  if (larger.length) return larger[0];
  return square.sort((a, b) => b.width - a.width)[0] || null;
}

/**
 * The notification-area icon cut from the .ico's own frames. They are the tuned small sizes
 * (16 to 40 px) the executable and the shortcuts use; shrinking the 847 px artwork to 16, 20 or
 * 24 px in one step is softer.
 */
function loadIcoFrameImage(nativeImage, candidates, size, readFile, log) {
  for (const candidate of candidates) {
    try {
      const frame = pickIcoFrame(readIcoFrames(readFile(candidate)), size);
      if (!frame) continue;
      const image = frame.png
        ? nativeImage.createFromBuffer(frame.png)
        : nativeImage.createFromBitmap(frame.bitmap, { width: frame.width, height: frame.height });
      if (!image || image.isEmpty()) continue;
      return frame.width === size
        ? image
        : image.resize({ width: size, height: size, quality: 'best' });
    } catch (error) {
      log.warn?.('Failed to read tray icon frames', candidate, error.message);
    }
  }
  return null;
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
 * - Windows: one bitmap at exactly the notification area's size for the display's scaling, from
 *   the matching frame of build/icon.ico, or from the PNG artwork if the file has none.
 * - Linux: the colour icon at 1x and 2x, which is what a StatusNotifier host asks for.
 * @returns {Electron.NativeImage|null} Null when no icon could be loaded.
 */
function loadTrayIcon({
  platform = process.platform,
  searchRoots = [],
  nativeImage,
  scaleFactor = 1,
  exists = fs.existsSync,
  readFile = fs.readFileSync,
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

  if (platform === 'win32') {
    const framed = loadIcoFrameImage(
      nativeImage,
      findIcons([WINDOWS_ICON_NAME], searchRoots, exists),
      getWindowsTrayIconSize(scaleFactor),
      readFile,
      log
    );
    if (framed) return framed;
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
  pickIcoFrame,
  readIcoFrames,
};

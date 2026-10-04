'use strict';

const path = require('path');

/**
 * Show a file in the system's file manager, and say whether that worked.
 *
 * shell.showItemInFolder returns nothing, so on a Linux desktop without a file manager (a bare
 * tiling-window-manager session) the click looks like it did nothing and success is reported all
 * the same. shell.openPath reports its failure as text, so on Linux the folder is opened through it.
 * The file manager of Windows and macOS is part of the system, and showItemInFolder also selects
 * the file there.
 *
 * @param {{showItemInFolder: Function, openPath: Function}} shell - Electron's shell.
 * @param {string} filePath - The file to show.
 * @param {string} [platform] - process.platform.
 * @returns {Promise<{success: boolean, path: string, error?: string}>}
 */
async function revealFile(shell, filePath, platform = process.platform) {
  if (platform !== 'linux') {
    shell.showItemInFolder(filePath);
    return { success: true, path: filePath };
  }
  const failure = await shell.openPath(path.dirname(filePath));
  if (failure) return { success: false, path: filePath, error: String(failure) };
  return { success: true, path: filePath };
}

module.exports = { revealFile };

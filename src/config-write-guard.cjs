/* The config file's name inside the profile directory, defined once: main.js
 * and layer-shell.cjs both build paths from it. */
const CONFIG_FILE_NAME = 'config.json';

function shouldBlockConfigWrite({ blockedReason = '' } = {}) {
  return typeof blockedReason === 'string' && blockedReason.trim().length > 0;
}

module.exports = { CONFIG_FILE_NAME, shouldBlockConfigWrite };

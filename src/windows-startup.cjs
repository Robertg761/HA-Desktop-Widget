const path = require('path');

function stripSurroundingQuotes(value) {
  const text = String(value || '').trim();
  if (text.length >= 2 && text.startsWith('"') && text.endsWith('"')) {
    return text.slice(1, -1);
  }
  return text;
}

function quoteWindowsExecutablePath(executablePath) {
  const rawPath = stripSurroundingQuotes(executablePath);
  if (!rawPath) return '';
  return `"${rawPath}"`;
}

function normalizeWindowsExecutablePath(executablePath) {
  const rawPath = stripSurroundingQuotes(executablePath);
  if (!rawPath) return '';
  return path.win32.normalize(rawPath).toLowerCase();
}

function isEnabledLaunchItemForExecutable(item, executablePath) {
  if (!item || item.enabled === false) return false;
  return normalizeWindowsExecutablePath(item.path) === normalizeWindowsExecutablePath(executablePath);
}

function hasEnabledLaunchItemForExecutable(settings, executablePath) {
  if (!settings || !Array.isArray(settings.launchItems)) return false;
  return settings.launchItems.some((item) => isEnabledLaunchItemForExecutable(item, executablePath));
}

function isWindowsLoginItemEnabled(settings, executablePath) {
  if (!settings) return false;
  if (hasEnabledLaunchItemForExecutable(settings, executablePath)) return true;
  return Boolean(settings.openAtLogin && settings.executableWillLaunchAtLogin !== false);
}

function getWindowsStartupRegistryName(pkg = {}, fallbackName = '') {
  return pkg?.build?.appId || pkg?.appId || fallbackName || pkg?.name || 'HA Desktop Widget';
}

module.exports = {
  getWindowsStartupRegistryName,
  hasEnabledLaunchItemForExecutable,
  isWindowsLoginItemEnabled,
  normalizeWindowsExecutablePath,
  quoteWindowsExecutablePath,
  stripSurroundingQuotes,
};

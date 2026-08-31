const fs = require('fs');
const os = require('os');
const path = require('path');

function getXdgConfigHome(env = process.env) {
  const configured = env?.XDG_CONFIG_HOME;
  if (configured && String(configured).trim()) {
    return String(configured);
  }
  return path.join(os.homedir(), '.config');
}

function getLinuxAutostartDir(env = process.env) {
  return path.join(getXdgConfigHome(env), 'autostart');
}

function getLinuxStartupDesktopFileName(pkg = {}, fallbackName = '') {
  const rawName =
    pkg?.build?.appId || pkg?.appId || fallbackName || pkg?.name || 'ha-desktop-widget';
  const normalized = String(rawName)
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return `${normalized || 'ha-desktop-widget'}.desktop`;
}

function getLinuxAutostartFilePath(pkg = {}, fallbackName = '', env = process.env) {
  return path.join(getLinuxAutostartDir(env), getLinuxStartupDesktopFileName(pkg, fallbackName));
}

function escapeDesktopEntryText(value) {
  return String(value || '')
    .replace(/[\r\n]+/g, ' ')
    .trim();
}

function quoteDesktopExecArg(value) {
  const text = String(value || '');
  return `"${text.replace(/(["\\`$])/g, '\\$1')}"`;
}

function getLinuxStartupExecutablePath(app, env = process.env) {
  if (env?.APPIMAGE) {
    return String(env.APPIMAGE);
  }
  if (app && typeof app.getPath === 'function') {
    return app.getPath('exe');
  }
  return process.execPath;
}

function buildLinuxAutostartDesktopEntry({ appName, executablePath }) {
  const name = escapeDesktopEntryText(appName || 'HA Desktop Widget');
  const execPath = quoteDesktopExecArg(executablePath);

  return [
    '[Desktop Entry]',
    'Type=Application',
    'Version=1.0',
    `Name=${name}`,
    `Comment=Launch ${name} at login`,
    `Exec=${execPath}`,
    'Terminal=false',
    'X-GNOME-Autostart-enabled=true',
    '',
  ].join('\n');
}

// The autostart file is named after the app id, so its mere presence is the user's answer: they
// turned start-at-login on for this app. Which executable it happens to name is a separate
// question, deliberately not asked here -- see linuxAutostartEntryNeedsRepair.
function linuxAutostartEntryEnabled(content) {
  if (typeof content !== 'string' || !content.trim()) return false;
  if (/^Hidden\s*=\s*true\s*$/im.test(content)) return false;
  if (/^X-GNOME-Autostart-enabled\s*=\s*false\s*$/im.test(content)) return false;
  return /^Exec\s*=/im.test(content);
}

function linuxAutostartEntryMatches(content, executablePath) {
  if (!linuxAutostartEntryEnabled(content)) return false;

  const expectedExec = quoteDesktopExecArg(executablePath);
  return content.split(/\r?\n/).some((line) => line.trim() === `Exec=${expectedExec}`);
}

// An AppImage carries its version in its filename, so every update writes a new file and deletes
// the old one. An autostart entry written before that update still names the deleted path, which
// silently stops the widget from starting at login and -- because the recorded path no longer
// matches -- also made the setting read back as off. Both are repaired by rewriting the entry.
function linuxAutostartEntryNeedsRepair(content, executablePath) {
  return (
    linuxAutostartEntryEnabled(content) && !linuxAutostartEntryMatches(content, executablePath)
  );
}

function isLinuxLoginItemEnabled({
  pkg = {},
  appName = '',
  // Accepted for call-site symmetry with the setter; enablement deliberately does not depend on it.
  executablePath, // eslint-disable-line no-unused-vars
  env = process.env,
  fsModule = fs,
} = {}) {
  const autostartPath = getLinuxAutostartFilePath(pkg, appName, env);
  try {
    const content = fsModule.readFileSync(autostartPath, 'utf8');
    return linuxAutostartEntryEnabled(content);
  } catch (error) {
    if (error?.code !== 'ENOENT') {
      throw error;
    }
    return false;
  }
}

/**
 * Point an existing autostart entry back at the running executable.
 *
 * Only ever rewrites an entry the user already enabled: a missing file means start-at-login is
 * off and must stay off, and an entry that already names this executable is left untouched so
 * every launch does not rewrite the same bytes.
 */
function syncLinuxAutostartExecutablePath({
  pkg = {},
  appName = '',
  executablePath,
  env = process.env,
  fsModule = fs,
} = {}) {
  const autostartPath = getLinuxAutostartFilePath(pkg, appName, env);
  let content;
  try {
    content = fsModule.readFileSync(autostartPath, 'utf8');
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error;
    return { repaired: false, autostartPath, reason: 'absent' };
  }

  if (!linuxAutostartEntryEnabled(content)) {
    return { repaired: false, autostartPath, reason: 'disabled' };
  }
  if (!linuxAutostartEntryNeedsRepair(content, executablePath)) {
    return { repaired: false, autostartPath, reason: 'current' };
  }

  fsModule.writeFileSync(
    autostartPath,
    buildLinuxAutostartDesktopEntry({ appName, executablePath }),
    { encoding: 'utf8', mode: 0o644 }
  );
  return { repaired: true, autostartPath, reason: 'stale' };
}

function setLinuxLoginItemSettings(
  openAtLogin,
  { pkg = {}, appName = '', executablePath, env = process.env, fsModule = fs } = {}
) {
  const autostartDir = getLinuxAutostartDir(env);
  const autostartPath = getLinuxAutostartFilePath(pkg, appName, env);

  if (openAtLogin) {
    fsModule.mkdirSync(autostartDir, { recursive: true });
    fsModule.writeFileSync(
      autostartPath,
      buildLinuxAutostartDesktopEntry({ appName, executablePath }),
      { encoding: 'utf8', mode: 0o644 }
    );
    return { autostartPath };
  }

  try {
    fsModule.unlinkSync(autostartPath);
  } catch (error) {
    if (error?.code !== 'ENOENT') {
      throw error;
    }
  }

  return { autostartPath };
}

module.exports = {
  buildLinuxAutostartDesktopEntry,
  getLinuxAutostartDir,
  getLinuxAutostartFilePath,
  getLinuxStartupDesktopFileName,
  getLinuxStartupExecutablePath,
  isLinuxLoginItemEnabled,
  linuxAutostartEntryEnabled,
  linuxAutostartEntryMatches,
  linuxAutostartEntryNeedsRepair,
  quoteDesktopExecArg,
  setLinuxLoginItemSettings,
  syncLinuxAutostartExecutablePath,
};

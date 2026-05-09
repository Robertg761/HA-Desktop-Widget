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
  const rawName = pkg?.build?.appId || pkg?.appId || fallbackName || pkg?.name || 'ha-desktop-widget';
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

function linuxAutostartEntryMatches(content, executablePath) {
  if (typeof content !== 'string' || !content.trim()) return false;
  if (/^Hidden\s*=\s*true\s*$/im.test(content)) return false;
  if (/^X-GNOME-Autostart-enabled\s*=\s*false\s*$/im.test(content)) return false;

  const expectedExec = quoteDesktopExecArg(executablePath);
  return content
    .split(/\r?\n/)
    .some((line) => line.trim() === `Exec=${expectedExec}`);
}

function isLinuxLoginItemEnabled({ pkg = {}, appName = '', executablePath, env = process.env, fsModule = fs } = {}) {
  const autostartPath = getLinuxAutostartFilePath(pkg, appName, env);
  try {
    const content = fsModule.readFileSync(autostartPath, 'utf8');
    return linuxAutostartEntryMatches(content, executablePath);
  } catch (error) {
    if (error?.code !== 'ENOENT') {
      throw error;
    }
    return false;
  }
}

function setLinuxLoginItemSettings(openAtLogin, { pkg = {}, appName = '', executablePath, env = process.env, fsModule = fs } = {}) {
  const autostartDir = getLinuxAutostartDir(env);
  const autostartPath = getLinuxAutostartFilePath(pkg, appName, env);

  if (openAtLogin) {
    fsModule.mkdirSync(autostartDir, { recursive: true });
    fsModule.writeFileSync(
      autostartPath,
      buildLinuxAutostartDesktopEntry({ appName, executablePath }),
      { encoding: 'utf8', mode: 0o644 },
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
  linuxAutostartEntryMatches,
  quoteDesktopExecArg,
  setLinuxLoginItemSettings,
};

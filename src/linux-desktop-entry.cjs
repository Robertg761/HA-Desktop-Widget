/* global process */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { APP_ID } = require('./linux-desktop.cjs');
const { buildDesktopExecPrefix, parseDesktopExecCommand } = require('./linux-startup.cjs');

// AppImages need a desktop identity for the host portal registry. Package-owned
// entries and user launchers take precedence over this fallback.
function ensureAppImageDesktopEntry({
  env = process.env,
  home = os.homedir(),
  iconPath,
  fsModule = fs,
} = {}) {
  if (!env.APPIMAGE || !path.isAbsolute(env.APPIMAGE)) return false;
  const data = env.XDG_DATA_HOME || path.join(home, '.local/share');
  const name = `${APP_ID}.desktop`;
  const destination = path.join(data, 'applications', name);
  const systemEntries = String(env.XDG_DATA_DIRS || '/usr/local/share:/usr/share')
    .split(':')
    .filter(Boolean)
    .map((dir) => path.join(dir, 'applications', name));
  if (systemEntries.some((file) => fsModule.existsSync(file))) return false;
  let previous = null;
  if (fsModule.existsSync(destination)) {
    previous = fsModule.readFileSync(destination, 'utf8');
    if (!/^X-HA-Widget-Launcher=true$/m.test(previous)) return false;
    const command = parseDesktopExecCommand(previous);
    if (!command || fsModule.existsSync(command.executable)) return false;
    const updated = previous.replace(
      `Exec=${command.rawToken}`,
      () => `Exec=${buildDesktopExecPrefix(env.APPIMAGE)}`
    );
    fsModule.writeFileSync(destination, updated, { mode: 0o644 });
    return true;
  }
  const icon = path.join(data, 'icons', `${APP_ID}.png`);
  fsModule.mkdirSync(path.dirname(icon), { recursive: true });
  fsModule.copyFileSync(iconPath, icon);
  fsModule.mkdirSync(path.dirname(destination), { recursive: true });
  fsModule.writeFileSync(
    destination,
    `[Desktop Entry]\nType=Application\nName=HA Desktop Widget\nExec=${buildDesktopExecPrefix(env.APPIMAGE)} --show\nIcon=${icon}\nTerminal=false\nCategories=Utility;\nStartupWMClass=${APP_ID}\nX-HA-Widget-Launcher=true\n`,
    { flag: 'wx', mode: 0o644 }
  );
  return true;
}

module.exports = { ensureAppImageDesktopEntry };

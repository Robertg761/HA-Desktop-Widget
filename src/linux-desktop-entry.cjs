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
    const updated = previous
      .replace(`Exec=${command.rawToken}`, () => `Exec=${buildDesktopExecPrefix(env.APPIMAGE)}`)
      .replace(/^TryExec=.*$/m, () => `TryExec=${env.APPIMAGE}`);
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

const PRODUCT_NAME = 'HA Desktop Widget';
const LEGACY_LAUNCHER_NAME = /ha[-_]?desktop[-_]?widget|hadesktopwidget|home-assistant-widget/i;

// AppImage integration tools (AppImageLauncher, the old desktopintegration
// script) copy the AppImage's launcher into the user's menu under whatever
// name that build carried, and an in-app update then deletes the file the
// launcher names. GLib treats an entry whose executable is gone as absent, so
// the menu item silently does nothing and the user concludes the app is broken.
// Point such an entry at the running AppImage, mirroring the autostart repair.
// Deleting it would be wrong: the portal's host registry resolves a legacy app
// id through this very file, so the entry also keeps old Hyprland binds alive.
function repairStaleAppImageLaunchers({
  env = process.env,
  home = os.homedir(),
  fsModule = fs,
  onError = () => {},
} = {}) {
  const executable = env.APPIMAGE;
  if (!executable || !path.isAbsolute(executable)) return [];
  const data = env.XDG_DATA_HOME || path.join(home, '.local/share');
  const dir = path.join(data, 'applications');
  let names;
  try {
    names = fsModule.readdirSync(dir);
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error;
    return [];
  }
  const repaired = [];
  for (const name of names) {
    if (!name.endsWith('.desktop')) continue;
    if (!LEGACY_LAUNCHER_NAME.test(name)) continue;
    const file = path.join(dir, name);
    let content;
    try {
      content = fsModule.readFileSync(file, 'utf8');
    } catch {
      continue;
    }
    // Only launchers an integration tool generated for this app; a hand-written
    // entry under a similar name belongs to the user.
    if (!/^X-AppImage-Version=/m.test(content)) continue;
    if (!new RegExp(`^(?:Name|X-AppImage-Name)=${PRODUCT_NAME}$`, 'm').test(content)) continue;
    const command = parseDesktopExecCommand(content);
    if (!command || !path.isAbsolute(command.executable)) continue;
    if (fsModule.existsSync(command.executable)) continue;
    const updated = content
      .replace(`Exec=${command.rawToken}`, () => `Exec=${buildDesktopExecPrefix(executable)}`)
      .replace(/^TryExec=.*$/m, () => `TryExec=${executable}`);
    try {
      fsModule.writeFileSync(file, updated, { mode: 0o644 });
      repaired.push(file);
    } catch (error) {
      onError(file, error);
    }
  }
  return repaired;
}

module.exports = { ensureAppImageDesktopEntry, repairStaleAppImageLaunchers };

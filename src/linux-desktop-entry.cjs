/* global process */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { APP_ID } = require('./linux-desktop.cjs');
const { buildDesktopExecPrefix, parseDesktopExecCommand } = require('./linux-startup.cjs');

const APPARMOR_USERNS_RESTRICTION = '/proc/sys/kernel/apparmor_restrict_unprivileged_userns';

// Ubuntu 23.10 and later stop an unprivileged process from creating the user namespace Chromium's
// sandbox needs, and an AppImage (unlike the .deb, whose chrome-sandbox is setuid) cannot get
// around that, so it dies at start with "No usable sandbox". Whoever got it running did so with
// --no-sandbox, and a launcher written without it would die the same way next time.
function appArmorRestrictsUserNamespaces(fsModule = fs) {
  try {
    return String(fsModule.readFileSync(APPARMOR_USERNS_RESTRICTION, 'utf8')).trim() === '1';
  } catch {
    return false;
  }
}

// Swap the command of the launcher's Exec line, keeping the arguments it already has. The line is
// found by its start, the way parseDesktopExecCommand finds it: searching for the old command's
// text would also match inside a TryExec line that happens to be listed first, and leave the
// real Exec line unchanged.
function replaceExecCommand(content, command, token) {
  return content.replace(/^Exec=.*$/m, () => `Exec=${token}${command.suffix}`);
}

// The flag a launcher this process writes or repairs must carry: this process runs without the
// sandbox, on a system that blocks it, so a launcher without the flag would die the same way.
function sandboxFlagWhenBlocked(fsModule, sandboxDisabled) {
  return sandboxDisabled && appArmorRestrictsUserNamespaces(fsModule) ? ' --no-sandbox' : '';
}

function launcherHasSandboxFlag(command) {
  return /(?:^|\s)--no-sandbox(?:\s|$)/.test(command.suffix);
}

// AppImages need a desktop identity for the host portal registry. Package-owned
// entries and user launchers take precedence over this fallback.
function ensureAppImageDesktopEntry({
  env = process.env,
  home = os.homedir(),
  iconPath,
  fsModule = fs,
  // Whether this process runs without Chromium's sandbox, because it was started with --no-sandbox.
  sandboxDisabled = process.argv.includes('--no-sandbox'),
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
  const sandboxFlag = sandboxFlagWhenBlocked(fsModule, sandboxDisabled);
  if (fsModule.existsSync(destination)) {
    const previous = fsModule.readFileSync(destination, 'utf8');
    if (!/^X-HA-Widget-Launcher=true$/m.test(previous)) return false;
    const command = parseDesktopExecCommand(previous);
    if (!command) return false;
    const stale = !fsModule.existsSync(command.executable);
    // A launcher written before the system blocked the sandbox, or by a build that did not know
    // to keep the flag, dies the same way when it is opened from the menu. It is only fixed when
    // it starts this AppImage: one that names another executable is not ours to edit.
    const startsThisAppImage =
      stale || path.resolve(command.executable) === path.resolve(env.APPIMAGE);
    const needsSandboxFlag =
      sandboxFlag !== '' && startsThisAppImage && !launcherHasSandboxFlag(command);
    if (!stale && !needsSandboxFlag) return false;
    const token = stale ? buildDesktopExecPrefix(env.APPIMAGE) : command.rawToken;
    // The flag goes right after the command, ahead of the arguments the launcher already has.
    let updated = replaceExecCommand(
      previous,
      command,
      `${token}${needsSandboxFlag ? sandboxFlag : ''}`
    );
    if (stale) updated = updated.replace(/^TryExec=.*$/m, () => `TryExec=${env.APPIMAGE}`);
    fsModule.writeFileSync(destination, updated, { mode: 0o644 });
    return true;
  }
  const icon = path.join(data, 'icons', `${APP_ID}.png`);
  fsModule.mkdirSync(path.dirname(icon), { recursive: true });
  fsModule.copyFileSync(iconPath, icon);
  fsModule.mkdirSync(path.dirname(destination), { recursive: true });
  fsModule.writeFileSync(
    destination,
    `[Desktop Entry]\nType=Application\nName=HA Desktop Widget\nExec=${buildDesktopExecPrefix(env.APPIMAGE)}${sandboxFlag} --show\nIcon=${icon}\nTerminal=false\nCategories=Utility;\nStartupWMClass=${APP_ID}\nX-HA-Widget-Launcher=true\n`,
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
  // Whether this process runs without Chromium's sandbox, because it was started with --no-sandbox.
  sandboxDisabled = process.argv.includes('--no-sandbox'),
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
  const sandboxFlag = sandboxFlagWhenBlocked(fsModule, sandboxDisabled);
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
    // The launcher now starts this AppImage, so it gets what a launcher the widget wrote itself
    // gets. Repointed alone, it would still exit with "No usable sandbox" from the menu, even
    // though this run only started because the user passed the flag by hand.
    const needsSandboxFlag = sandboxFlag !== '' && !launcherHasSandboxFlag(command);
    const updated = replaceExecCommand(
      content,
      command,
      `${buildDesktopExecPrefix(executable)}${needsSandboxFlag ? sandboxFlag : ''}`
    ).replace(/^TryExec=.*$/m, () => `TryExec=${executable}`);
    try {
      fsModule.writeFileSync(file, updated, { mode: 0o644 });
      repaired.push(file);
    } catch (error) {
      onError(file, error);
    }
  }
  return repaired;
}

module.exports = {
  appArmorRestrictsUserNamespaces,
  ensureAppImageDesktopEntry,
  repairStaleAppImageLaunchers,
};

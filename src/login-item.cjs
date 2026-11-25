const path = require('path');
const {
  getLinuxStartupExecutablePath,
  isLinuxLoginItemEnabled,
  migrateLegacyLinuxAutostartEntry,
  setLinuxLoginItemSettings,
  syncLinuxAutostartExecutablePath,
} = require('./linux-startup.cjs');

/**
 * Start at login: whether the app launches when the user signs in.
 *
 * Each platform keeps the setting somewhere different -- a Run-key value Electron manages on
 * Windows, an XDG autostart .desktop file this app writes on Linux, and Electron's login item on
 * macOS -- so the work is done by one adapter per platform, chosen here from `platform`. Callers
 * only see the three methods below, whose results are the payloads of the get-login-item-settings
 * and set-login-item-settings IPC channels.
 *
 * @param {object} options
 * @param {Electron.App} options.app Electron's app: its login item calls and executable path.
 * @param {string} [options.platform] process.platform.
 * @param {object} [options.pkg] package.json, whose app id names the registration.
 * @param {string} [options.appName] The name the Linux autostart entry shows.
 * @param {NodeJS.ProcessEnv} [options.env]
 * @param {{debug: Function, info: Function, warn: Function, error: Function}} options.log
 * @param {() => boolean} [options.isPortableBuild] Whether this is a Windows portable build.
 * @param {boolean} [options.isolated] An isolated profile, which must never register itself.
 * @returns {{
 *   getSettings: () => {openAtLogin: boolean, supported: boolean, error?: string},
 *   setOpenAtLogin: (openAtLogin: unknown) =>
 *     {success: boolean, openAtLogin?: boolean, supported?: boolean, error?: string},
 *   repairOnStartup: () => void,
 * }}
 * getSettings and setOpenAtLogin never throw: a failure comes back as an error in the payload.
 * setOpenAtLogin reports the state read back after the change where the platform allows it.
 * repairOnStartup never throws either; it is the caller's to decide when it runs.
 */
function createLoginItem({
  app,
  platform = process.platform,
  pkg = {},
  appName = '',
  env = process.env,
  log,
  isPortableBuild = () => false,
  isolated = false,
}) {
  let adapter;
  if (platform === 'win32') adapter = createWindowsAdapter({ app, pkg, env, log, isPortableBuild });
  else if (platform === 'linux') adapter = createLinuxAdapter({ app, pkg, appName, env, log });
  else adapter = createElectronAdapter({ app, log });

  return {
    getSettings() {
      if (isolated) return { openAtLogin: false, supported: false };
      try {
        return { openAtLogin: adapter.isEnabled(), supported: true };
      } catch (error) {
        log.error('Failed to get login item settings:', error);
        return { openAtLogin: false, supported: false, error: error.message };
      }
    },

    setOpenAtLogin(openAtLogin) {
      if (isolated) {
        return {
          success: false,
          supported: false,
          error: 'Startup is disabled for an isolated profile',
        };
      }
      try {
        const requested = !!openAtLogin;
        const confirmed = adapter.set(requested);
        if (confirmed !== requested) {
          const error = `${adapter.label} startup setting did not persist as ${requested ? 'enabled' : 'disabled'}`;
          log.warn(error);
          return { success: false, error, openAtLogin: confirmed };
        }
        return { success: true, openAtLogin: confirmed, supported: true };
      } catch (error) {
        log.error('Failed to set login item settings:', error);
        return { success: false, error: error.message, supported: false };
      }
    },

    repairOnStartup() {
      if (isolated) return;
      adapter.repairOnStartup();
    },
  };
}

// macOS, and any other platform Electron's login item API covers.
function createElectronAdapter({ app, log }) {
  return {
    label: 'macOS',
    isEnabled() {
      const settings = app.getLoginItemSettings();
      log.debug('Login item settings:', settings);
      return Boolean(settings.openAtLogin);
    },
    // Not read back: on macOS 13 and later a new login item can be waiting on the user's approval
    // in System Settings, and a read straight after the change would call that a failure.
    set(openAtLogin) {
      const settings = { openAtLogin };
      log.info(`Setting app to ${openAtLogin ? 'start' : 'not start'}`, settings);
      app.setLoginItemSettings(settings);
      return openAtLogin;
    },
    repairOnStartup() {},
  };
}

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

// Electron splits an unquoted Run command at its first space, so a launch item whose path is only
// the start of the executable's path is not this app, and must not read as on.
function isWindowsLoginItemEnabled(settings, executablePath) {
  if (!settings) return false;
  const target = normalizeWindowsExecutablePath(executablePath);
  const launchItems = Array.isArray(settings.launchItems) ? settings.launchItems : [];
  if (
    launchItems.some(
      (item) =>
        item && item.enabled !== false && normalizeWindowsExecutablePath(item.path) === target
    )
  ) {
    return true;
  }
  return Boolean(settings.openAtLogin && settings.executableWillLaunchAtLogin !== false);
}

function getWindowsStartupRegistryName(pkg = {}, fallbackName = '') {
  return pkg?.build?.appId || pkg?.appId || fallbackName || pkg?.name || 'HA Desktop Widget';
}

function createWindowsAdapter({ app, pkg, env, log, isPortableBuild }) {
  // Portable builds run from a temporary extracted executable, so the launcher that survives a
  // reboot is PORTABLE_EXECUTABLE_FILE. Older builds wrote the path unquoted, which is why a
  // lookup can ask for the unquoted form.
  function getRegistrationTarget({ quotePath = true } = {}) {
    const portableExecutable = env?.PORTABLE_EXECUTABLE_FILE;
    const portableBuild = isPortableBuild();
    if (portableBuild && !portableExecutable) {
      log.warn(
        "Portable build detected but PORTABLE_EXECUTABLE_FILE is not set; startup registration will use app.getPath('exe') which may be an ephemeral path."
      );
    }
    const executablePath =
      portableBuild && portableExecutable ? portableExecutable : app.getPath('exe');
    return {
      path: quotePath ? quoteWindowsExecutablePath(executablePath) : executablePath,
      args: [],
      name: getWindowsStartupRegistryName(pkg, app.getName()),
      executablePath,
    };
  }

  const readSettings = (target) =>
    app.getLoginItemSettings({ path: target.path, args: target.args });

  return {
    label: 'Windows',
    isEnabled() {
      const target = getRegistrationTarget();
      const legacyTarget = getRegistrationTarget({ quotePath: false });
      const settings = readSettings(target);
      let openAtLogin = isWindowsLoginItemEnabled(settings, target.executablePath);
      let legacySettings = null;
      if (!openAtLogin && legacyTarget.path !== target.path) {
        legacySettings = readSettings(legacyTarget);
        openAtLogin = isWindowsLoginItemEnabled(legacySettings, target.executablePath);
      }
      log.debug('Login item settings:', { settings, legacySettings });
      return openAtLogin;
    },
    set(openAtLogin) {
      const target = getRegistrationTarget();
      const settings = {
        openAtLogin,
        path: target.path,
        args: target.args,
        name: target.name,
        // Keep Windows startup approval in sync with the toggle state.
        enabled: openAtLogin,
      };
      log.info(`Setting app to ${openAtLogin ? 'start' : 'not start'} with Windows`, settings);
      app.setLoginItemSettings(settings);
      const confirmed = readSettings(target);
      log.debug('Login item settings:', confirmed);
      return isWindowsLoginItemEnabled(confirmed, target.executablePath);
    },
    repairOnStartup() {},
  };
}

function createLinuxAdapter({ app, pkg, appName, env, log }) {
  const getOptions = () => ({
    pkg,
    appName,
    executablePath: getLinuxStartupExecutablePath(app, env),
    env,
  });

  return {
    label: 'Linux',
    isEnabled() {
      return isLinuxLoginItemEnabled(getOptions());
    },
    set(openAtLogin) {
      const options = getOptions();
      setLinuxLoginItemSettings(openAtLogin, options);
      return isLinuxLoginItemEnabled(options);
    },
    repairOnStartup() {
      const options = getOptions();
      try {
        // The autostart file is named after the app id, which package.json has not always
        // carried. An entry written before it was added sits under the older name where nothing
        // can see it, so the setting reads as off, ticking the box adds a second entry, and the
        // repair below never reaches it. Adopt it first, then repair whatever we now own.
        const { adopted, removedDuplicate, legacyPath } = migrateLegacyLinuxAutostartEntry(options);
        if (adopted) {
          log.info(
            `Adopted the start-at-login entry left behind under an older file name (${legacyPath})`
          );
        } else if (removedDuplicate) {
          log.info(
            `Removed a duplicate start-at-login entry left behind under an older file name (${legacyPath})`
          );
        }
      } catch (error) {
        log.warn('Could not migrate the Linux autostart entry:', error?.message || error);
      }
      try {
        const { repaired, autostartPath } = syncLinuxAutostartExecutablePath(options);
        if (repaired) {
          log.info(
            `Start-at-login pointed at an executable that no longer exists (likely a previous update); repointed ${autostartPath} at this build`
          );
        }
      } catch (error) {
        // Start-at-login is a convenience; a read-only or unwritable autostart directory must
        // never stop the widget from starting.
        log.warn('Could not refresh the Linux autostart entry:', error?.message || error);
      }
    },
  };
}

module.exports = { createLoginItem };

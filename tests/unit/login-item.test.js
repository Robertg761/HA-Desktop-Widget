/** @jest-environment node */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { createLoginItem } = require('../../src/login-item.cjs');
const { quoteDesktopExecArg } = require('../../src/linux-startup.cjs');

const APP_ID = 'com.github.robertg761.hadesktopwidget';

const fakeLog = () => ({ debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() });

describe('Start at login on Windows', () => {
  const exe =
    'C:\\Users\\rober\\AppData\\Local\\Programs\\HA Desktop Widget\\HA Desktop Widget.exe';

  // Electron's view of the Run key: a value is found by the command it was registered with, and
  // its launch item shows that command parsed the way Windows does, so an unquoted path with
  // spaces is cut at the first space.
  function fakeWindowsApp({ entries = [], keepsChanges = true } = {}) {
    const runKey = [...entries];
    const parse = (command) =>
      command.startsWith('"')
        ? { path: command.slice(1, command.indexOf('"', 1)), args: [] }
        : { path: command.split(' ')[0], args: command.split(' ').slice(1) };
    return {
      runKey,
      getName: () => 'HA Desktop Widget',
      getPath: jest.fn(() => exe),
      setLoginItemSettings: jest.fn((settings) => {
        if (!keepsChanges) return;
        runKey.splice(0, runKey.length, ...runKey.filter((entry) => entry.name !== settings.name));
        if (settings.openAtLogin) {
          runKey.push({ name: settings.name, command: settings.path, enabled: settings.enabled });
        }
      }),
      getLoginItemSettings: jest.fn((options) => {
        const found = runKey.filter((entry) => entry.command === options.path);
        return {
          openAtLogin: found.length > 0,
          executableWillLaunchAtLogin: found.some((entry) => entry.enabled !== false),
          launchItems: found.map((entry) => ({
            name: entry.name,
            ...parse(entry.command),
            enabled: entry.enabled !== false,
          })),
        };
      }),
    };
  }

  function windowsLoginItem(app, overrides = {}) {
    const log = fakeLog();
    const loginItem = createLoginItem({
      app,
      platform: 'win32',
      pkg: { name: 'home-assistant-widget', appId: APP_ID },
      env: {},
      log,
      ...overrides,
    });
    return { loginItem, log };
  }

  test('registers the quoted executable under the app id, and reads back as on', () => {
    const app = fakeWindowsApp();
    const { loginItem } = windowsLoginItem(app);

    expect(loginItem.setOpenAtLogin(true)).toEqual({
      success: true,
      openAtLogin: true,
      supported: true,
    });
    expect(app.setLoginItemSettings).toHaveBeenCalledWith({
      openAtLogin: true,
      path: `"${exe}"`,
      args: [],
      name: APP_ID,
      // Startup approval follows the toggle, so Task Manager agrees with Settings.
      enabled: true,
    });
    expect(loginItem.getSettings()).toEqual({ openAtLogin: true, supported: true });

    expect(loginItem.setOpenAtLogin(false)).toEqual({
      success: true,
      openAtLogin: false,
      supported: true,
    });
    expect(app.setLoginItemSettings).toHaveBeenLastCalledWith(
      expect.objectContaining({ openAtLogin: false, enabled: false })
    );
    expect(loginItem.getSettings()).toEqual({ openAtLogin: false, supported: true });
  });

  test('takes any truthy value from the renderer as on', () => {
    const app = fakeWindowsApp();
    const { loginItem } = windowsLoginItem(app);

    expect(loginItem.setOpenAtLogin('yes').openAtLogin).toBe(true);
    expect(loginItem.setOpenAtLogin(undefined).openAtLogin).toBe(false);
  });

  test('reports a change Windows did not keep, with the state it actually has', () => {
    const app = fakeWindowsApp({ keepsChanges: false });
    const { loginItem, log } = windowsLoginItem(app);

    expect(loginItem.setOpenAtLogin(true)).toEqual({
      success: false,
      error: 'Windows startup setting did not persist as enabled',
      openAtLogin: false,
    });
    expect(log.warn).toHaveBeenCalledWith('Windows startup setting did not persist as enabled');
  });

  test('reads an entry an older build registered without quotes as on', () => {
    const app = fakeWindowsApp({ entries: [{ name: APP_ID, command: exe, enabled: true }] });
    const { loginItem } = windowsLoginItem(app);

    expect(loginItem.getSettings()).toEqual({ openAtLogin: true, supported: true });
    expect(app.getLoginItemSettings).toHaveBeenCalledWith({ path: `"${exe}"`, args: [] });
    expect(app.getLoginItemSettings).toHaveBeenCalledWith({ path: exe, args: [] });
  });

  test('does not take a launch item Electron cut at a space for this app', () => {
    const app = fakeWindowsApp();
    app.getLoginItemSettings.mockReturnValue({
      openAtLogin: false,
      executableWillLaunchAtLogin: true,
      launchItems: [
        {
          name: APP_ID,
          path: 'C:\\Users\\rober\\AppData\\Local\\Programs\\HA',
          args: ['Desktop', 'Widget.exe'],
          enabled: true,
        },
      ],
    });
    const { loginItem } = windowsLoginItem(app);

    expect(loginItem.getSettings().openAtLogin).toBe(false);
  });

  test('matches a launch item to the executable whatever its case or quoting', () => {
    const app = fakeWindowsApp();
    app.getLoginItemSettings.mockReturnValue({
      openAtLogin: false,
      launchItems: [{ name: APP_ID, path: `"${exe.toUpperCase()}"`, args: [], enabled: true }],
    });
    const { loginItem } = windowsLoginItem(app);

    expect(loginItem.getSettings().openAtLogin).toBe(true);
  });

  test('reads an entry the user disabled in Task Manager as off', () => {
    const app = fakeWindowsApp({
      entries: [{ name: APP_ID, command: `"${exe}"`, enabled: false }],
    });
    const { loginItem } = windowsLoginItem(app);

    expect(loginItem.getSettings()).toEqual({ openAtLogin: false, supported: true });
  });

  test('registers the portable launcher rather than its temporary extracted copy', () => {
    const app = fakeWindowsApp();
    const { loginItem } = windowsLoginItem(app, {
      env: { PORTABLE_EXECUTABLE_FILE: 'D:\\Tools\\HA Desktop Widget.exe' },
      isPortableBuild: () => true,
    });

    expect(loginItem.setOpenAtLogin(true).success).toBe(true);
    expect(app.setLoginItemSettings).toHaveBeenCalledWith(
      expect.objectContaining({ path: '"D:\\Tools\\HA Desktop Widget.exe"' })
    );
    expect(app.getPath).not.toHaveBeenCalled();
  });

  test('warns when a portable build cannot name its launcher, and registers the running copy', () => {
    const app = fakeWindowsApp();
    const { loginItem, log } = windowsLoginItem(app, { isPortableBuild: () => true });

    loginItem.setOpenAtLogin(true);

    expect(log.warn).toHaveBeenCalledWith(expect.stringContaining('PORTABLE_EXECUTABLE_FILE'));
    expect(app.setLoginItemSettings).toHaveBeenCalledWith(
      expect.objectContaining({ path: `"${exe}"` })
    );
  });

  test('names the registration after the app when package.json has no app id', () => {
    const app = fakeWindowsApp();
    const { loginItem } = windowsLoginItem(app, { pkg: {} });

    loginItem.setOpenAtLogin(true);

    expect(app.setLoginItemSettings).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'HA Desktop Widget' })
    );
  });

  test('reports a failing Electron call in the payload instead of throwing', () => {
    const app = fakeWindowsApp();
    app.getLoginItemSettings.mockImplementation(() => {
      throw new Error('registry unavailable');
    });
    app.setLoginItemSettings.mockImplementation(() => {
      throw new Error('access denied');
    });
    const { loginItem, log } = windowsLoginItem(app);

    expect(loginItem.getSettings()).toEqual({
      openAtLogin: false,
      supported: false,
      error: 'registry unavailable',
    });
    expect(loginItem.setOpenAtLogin(true)).toEqual({
      success: false,
      error: 'access denied',
      supported: false,
    });
    expect(log.error).toHaveBeenCalledTimes(2);
  });

  test('has nothing to repair at startup', () => {
    const app = fakeWindowsApp();
    const { loginItem } = windowsLoginItem(app);

    loginItem.repairOnStartup();

    expect(app.getLoginItemSettings).not.toHaveBeenCalled();
    expect(app.setLoginItemSettings).not.toHaveBeenCalled();
  });
});

describe('Start at login on macOS', () => {
  function macLoginItem(openAtLogin = false) {
    const app = {
      getLoginItemSettings: jest.fn(() => ({ openAtLogin })),
      setLoginItemSettings: jest.fn(),
    };
    const log = fakeLog();
    return { app, log, loginItem: createLoginItem({ app, platform: 'darwin', log }) };
  }

  test("reads Electron's login item", () => {
    expect(macLoginItem(true).loginItem.getSettings()).toEqual({
      openAtLogin: true,
      supported: true,
    });
    expect(macLoginItem(false).loginItem.getSettings()).toEqual({
      openAtLogin: false,
      supported: true,
    });
  });

  // macOS can hold a new login item for the user's approval, so the request is the answer.
  test('reports the requested state without reading it back', () => {
    const { app, loginItem } = macLoginItem(false);

    expect(loginItem.setOpenAtLogin(true)).toEqual({
      success: true,
      openAtLogin: true,
      supported: true,
    });
    expect(app.setLoginItemSettings).toHaveBeenCalledWith({ openAtLogin: true });
    expect(app.getLoginItemSettings).not.toHaveBeenCalled();
  });

  test('has nothing to repair at startup', () => {
    const { app, loginItem } = macLoginItem();

    loginItem.repairOnStartup();

    expect(app.getLoginItemSettings).not.toHaveBeenCalled();
    expect(app.setLoginItemSettings).not.toHaveBeenCalled();
  });
});

describe('Start at login on Linux', () => {
  const pkg = { appId: APP_ID, name: 'home-assistant-widget' };
  const appName = 'HA Desktop Widget';
  const oldPath = '/home/user/Apps/HA-Desktop-Widget-3.9.1-linux-x86_64.AppImage';
  const newPath = '/home/user/Apps/HA-Desktop-Widget-3.10.0-linux-x86_64.AppImage';
  let root;
  let autostartDir;
  let entryPath;

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'ha-widget-login-item-'));
    autostartDir = path.join(root, 'autostart');
    entryPath = path.join(autostartDir, `${APP_ID}.desktop`);
  });
  afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

  // The running AppImage is the executable an entry should name; an update changes it.
  function linuxLoginItem({ executablePath = newPath, ...overrides } = {}) {
    const app = { getPath: jest.fn(() => '/tmp/.mount_HA/ha-desktop-widget') };
    const log = fakeLog();
    const loginItem = createLoginItem({
      app,
      platform: 'linux',
      pkg,
      appName,
      env: { XDG_CONFIG_HOME: root, APPIMAGE: executablePath },
      log,
      ...overrides,
    });
    return { app, log, loginItem };
  }

  const readEntry = () => fs.readFileSync(entryPath, 'utf8');
  const writeEntry = (file, content) => {
    fs.mkdirSync(autostartDir, { recursive: true });
    fs.writeFileSync(path.join(autostartDir, file), content, 'utf8');
  };

  test('writes an XDG autostart entry named after the app id, and removes it', () => {
    const { app, loginItem } = linuxLoginItem();

    expect(loginItem.setOpenAtLogin(true)).toEqual({
      success: true,
      openAtLogin: true,
      supported: true,
    });
    const entry = readEntry();
    expect(entry).toContain('[Desktop Entry]\nType=Application\n');
    expect(entry).toContain('Name=HA Desktop Widget\n');
    // The AppImage file, not its mount point, which is gone after this run.
    expect(entry).toContain(`Exec=${quoteDesktopExecArg(newPath)}\n`);
    expect(entry).toContain('X-GNOME-Autostart-enabled=true\n');
    expect(app.getPath).not.toHaveBeenCalled();
    expect(loginItem.getSettings()).toEqual({ openAtLogin: true, supported: true });

    expect(loginItem.setOpenAtLogin(false)).toEqual({
      success: true,
      openAtLogin: false,
      supported: true,
    });
    expect(fs.existsSync(entryPath)).toBe(false);
    expect(loginItem.getSettings()).toEqual({ openAtLogin: false, supported: true });
  });

  test('names the entry the way the packaged app names its desktop file', () => {
    const shipped = require('../../package.json');
    const builderConfig = fs.readFileSync(
      path.resolve(__dirname, '../../electron-builder.yml'),
      'utf8'
    );
    const { loginItem } = linuxLoginItem({ pkg: shipped });

    loginItem.setOpenAtLogin(true);

    expect(fs.readdirSync(autostartDir)).toEqual([shipped.desktopName]);
    expect(builderConfig).toContain(`appId: ${shipped.appId}`);
    expect(builderConfig).toContain('  syncDesktopName: true');
  });

  test('uses the executable path when the app is not an AppImage', () => {
    const { app, loginItem } = linuxLoginItem({ env: { XDG_CONFIG_HOME: root } });

    loginItem.setOpenAtLogin(true);

    expect(app.getPath).toHaveBeenCalledWith('exe');
    expect(readEntry()).toContain('Exec="/tmp/.mount_HA/ha-desktop-widget"\n');
  });

  test('quotes an executable path the desktop would otherwise expand', () => {
    const { loginItem } = linuxLoginItem({ executablePath: '/tmp/$APP`test`' });

    loginItem.setOpenAtLogin(true);

    expect(readEntry()).toContain('Exec="/tmp/\\\\$APP\\\\`test\\\\`"\n');
  });

  test('will not overwrite or delete an entry this app did not write', () => {
    const foreign = '[Desktop Entry]\nType=Application\nName=Mine\nExec=/usr/bin/true\n';
    writeEntry(`${APP_ID}.desktop`, foreign);
    const { loginItem } = linuxLoginItem();

    for (const openAtLogin of [true, false]) {
      expect(loginItem.setOpenAtLogin(openAtLogin)).toEqual({
        success: false,
        error: 'Startup entry is managed outside this app',
        supported: false,
      });
    }
    expect(readEntry()).toBe(foreign);
  });

  test('reports an autostart entry it cannot read', () => {
    fs.mkdirSync(entryPath, { recursive: true });
    const { loginItem, log } = linuxLoginItem();

    expect(loginItem.getSettings()).toEqual(
      expect.objectContaining({ openAtLogin: false, supported: false })
    );
    expect(log.error).toHaveBeenCalled();
  });

  test('respects an entry the desktop has disabled', () => {
    const { loginItem } = linuxLoginItem();
    for (const disabled of [
      `[Desktop Entry]\nExec="${oldPath}"\nHidden=true\nX-HA-Widget-Autostart=true\n`,
      `[Desktop Entry]\nExec="${oldPath}"\nX-GNOME-Autostart-enabled=false\nX-HA-Widget-Autostart=true\n`,
    ]) {
      writeEntry(`${APP_ID}.desktop`, disabled);

      expect(loginItem.getSettings().openAtLogin).toBe(false);
      loginItem.repairOnStartup();
      expect(readEntry()).toBe(disabled);
    }
  });

  describe('surviving an AppImage update', () => {
    // An update renames the AppImage and deletes the old file, so an entry written before it
    // names a path that is gone. The user never turned the setting off.
    test('reads an entry naming the deleted AppImage as on', () => {
      linuxLoginItem({ executablePath: oldPath }).loginItem.setOpenAtLogin(true);

      expect(linuxLoginItem().loginItem.getSettings().openAtLogin).toBe(true);
    });

    test('repoints the entry at the running AppImage at startup', () => {
      linuxLoginItem({ executablePath: oldPath }).loginItem.setOpenAtLogin(true);
      const { loginItem, log } = linuxLoginItem();

      loginItem.repairOnStartup();

      expect(readEntry()).toContain(`Exec=${quoteDesktopExecArg(newPath)}\n`);
      expect(readEntry()).not.toContain(oldPath);
      expect(log.info).toHaveBeenCalledWith(expect.stringContaining(`repointed ${entryPath}`));
    });

    test('leaves a current entry byte for byte', () => {
      const { loginItem, log } = linuxLoginItem();
      loginItem.setOpenAtLogin(true);
      const before = readEntry();

      loginItem.repairOnStartup();

      expect(readEntry()).toBe(before);
      expect(log.info).not.toHaveBeenCalled();
    });

    // Off must stay off: the repair never creates an entry.
    test('does not create an entry when start at login is off', () => {
      linuxLoginItem().loginItem.repairOnStartup();

      expect(fs.existsSync(entryPath)).toBe(false);
    });

    // Start at login is a convenience: an autostart entry it cannot get at must never stop the
    // widget from starting.
    test('logs an entry it cannot repair instead of throwing', () => {
      fs.mkdirSync(entryPath, { recursive: true });
      const { loginItem, log } = linuxLoginItem();

      expect(() => loginItem.repairOnStartup()).not.toThrow();
      expect(log.warn).toHaveBeenCalledWith(
        'Could not refresh the Linux autostart entry:',
        expect.any(String)
      );
    });
  });

  describe('an entry left under an older file name', () => {
    // package.json did not always carry appId, so older builds named the file after the app.
    // Those entries are invisible to the current name: unreadable, unrepairable, unremovable.
    const legacyName = 'home-assistant-widget.desktop';
    const legacyPath = () => path.join(autostartDir, legacyName);
    const legacyEntry = (execPath, extra = '') =>
      `[Desktop Entry]\nType=Application\nVersion=1.0\nName=home-assistant-widget\n` +
      `Comment=Launch home-assistant-widget at login\nExec="${execPath}"\nTerminal=false\n` +
      `X-GNOME-Autostart-enabled=true\n${extra}`;

    test('is adopted and repointed at the running AppImage at startup', () => {
      writeEntry(legacyName, legacyEntry(oldPath));
      const { loginItem, log } = linuxLoginItem();
      expect(loginItem.getSettings().openAtLogin).toBe(false);

      loginItem.repairOnStartup();

      expect(fs.existsSync(legacyPath())).toBe(false);
      expect(readEntry()).toContain(`Exec=${quoteDesktopExecArg(newPath)}`);
      expect(loginItem.getSettings().openAtLogin).toBe(true);
      expect(log.info).toHaveBeenCalledWith(expect.stringContaining('Adopted'));
    });

    test('is removed when the current name already has an entry, so login launches once', () => {
      writeEntry(legacyName, legacyEntry(oldPath));
      const { loginItem, log } = linuxLoginItem();
      loginItem.setOpenAtLogin(true);

      loginItem.repairOnStartup();

      expect(fs.readdirSync(autostartDir)).toEqual([`${APP_ID}.desktop`]);
      expect(log.info).toHaveBeenCalledWith(expect.stringContaining('Removed a duplicate'));
    });

    test('stays where it is when the user disabled it', () => {
      const disabled = legacyEntry(oldPath).replace(
        'X-GNOME-Autostart-enabled=true',
        'X-GNOME-Autostart-enabled=false'
      );
      writeEntry(legacyName, disabled);

      linuxLoginItem().loginItem.repairOnStartup();

      expect(fs.readFileSync(legacyPath(), 'utf8')).toBe(disabled);
      expect(fs.existsSync(entryPath)).toBe(false);
    });

    // Someone else's file that happens to share the name must never be adopted or deleted.
    test('is never touched when this app did not write it', () => {
      const foreign =
        '[Desktop Entry]\nType=Application\nName=Something else\nExec="/usr/bin/true"\n';
      writeEntry(legacyName, foreign);

      linuxLoginItem().loginItem.repairOnStartup();

      expect(fs.readFileSync(legacyPath(), 'utf8')).toBe(foreign);
      expect(fs.existsSync(entryPath)).toBe(false);
    });

    test('does not stop the repair of the current entry when it cannot be read', () => {
      fs.mkdirSync(legacyPath(), { recursive: true });
      linuxLoginItem({ executablePath: oldPath }).loginItem.setOpenAtLogin(true);
      const { loginItem, log } = linuxLoginItem();

      loginItem.repairOnStartup();

      expect(log.warn).toHaveBeenCalledWith(
        'Could not migrate the Linux autostart entry:',
        expect.any(String)
      );
      expect(readEntry()).toContain(`Exec=${quoteDesktopExecArg(newPath)}`);
    });
  });
});

describe('Start at login in an isolated profile', () => {
  // A throwaway profile must never register itself to start with the user's session.
  test.each(['win32', 'linux', 'darwin'])(
    'is unsupported and touches nothing on %s',
    (platform) => {
      const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ha-widget-login-item-'));
      const app = {
        getName: jest.fn(),
        getPath: jest.fn(() => '/opt/widget'),
        getLoginItemSettings: jest.fn(),
        setLoginItemSettings: jest.fn(),
      };
      const loginItem = createLoginItem({
        app,
        platform,
        pkg: { appId: APP_ID },
        appName: 'HA Desktop Widget',
        env: { XDG_CONFIG_HOME: root },
        log: fakeLog(),
        isolated: true,
      });

      try {
        expect(loginItem.getSettings()).toEqual({ openAtLogin: false, supported: false });
        expect(loginItem.setOpenAtLogin(true)).toEqual({
          success: false,
          supported: false,
          error: 'Startup is disabled for an isolated profile',
        });
        loginItem.repairOnStartup();

        Object.values(app).forEach((method) => expect(method).not.toHaveBeenCalled());
        expect(fs.readdirSync(root)).toEqual([]);
      } finally {
        fs.rmSync(root, { recursive: true, force: true });
      }
    }
  );
});

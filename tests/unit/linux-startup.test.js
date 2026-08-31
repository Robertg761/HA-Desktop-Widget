const fs = require('fs');
const os = require('os');
const path = require('path');
const {
  buildLinuxAutostartDesktopEntry,
  getLegacyLinuxAutostartFilePaths,
  getLinuxAutostartFilePath,
  getLinuxStartupDesktopFileName,
  getLinuxStartupExecutablePath,
  isGeneratedLinuxAutostartEntry,
  isLinuxLoginItemEnabled,
  linuxAutostartEntryNeedsRepair,
  migrateLegacyLinuxAutostartEntry,
  quoteDesktopExecArg,
  setLinuxLoginItemSettings,
  syncLinuxAutostartExecutablePath,
} = require('../../src/linux-startup.cjs');

describe('Linux startup helpers', () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ha-widget-linux-startup-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  test('uses a stable desktop file name from the Electron Builder app id', () => {
    expect(
      getLinuxStartupDesktopFileName(
        {
          name: 'home-assistant-widget',
          build: { appId: 'com.github.robertg761.hadesktopwidget' },
        },
        'Fallback'
      )
    ).toBe('com.github.robertg761.hadesktopwidget.desktop');
  });

  test('keeps the packaged Linux desktop identity aligned with autostart', () => {
    const pkg = require('../../package.json');
    const builderConfig = fs.readFileSync(
      path.resolve(__dirname, '../../electron-builder.yml'),
      'utf8'
    );

    expect(pkg.desktopName).toBe(`${pkg.appId}.desktop`);
    expect(builderConfig).toContain(`appId: ${pkg.appId}`);
    expect(builderConfig).toContain('  syncDesktopName: true');
  });

  test('quotes executable paths for XDG desktop Exec entries', () => {
    expect(quoteDesktopExecArg('/opt/HA Desktop Widget/ha-widget')).toBe(
      '"/opt/HA Desktop Widget/ha-widget"'
    );
    expect(quoteDesktopExecArg('/tmp/$APP`test`')).toBe('"/tmp/\\$APP\\`test\\`"');
  });

  test('builds an XDG autostart desktop entry', () => {
    const entry = buildLinuxAutostartDesktopEntry({
      appName: 'HA Desktop Widget',
      executablePath: '/opt/HA Desktop Widget/ha-widget',
    });

    expect(entry).toContain('[Desktop Entry]');
    expect(entry).toContain('Type=Application');
    expect(entry).toContain('Name=HA Desktop Widget');
    expect(entry).toContain('Exec="/opt/HA Desktop Widget/ha-widget"');
    expect(entry).toContain('X-GNOME-Autostart-enabled=true');
  });

  test('persists and removes Linux login autostart entries', () => {
    const env = { XDG_CONFIG_HOME: tmpDir };
    const pkg = { build: { appId: 'com.github.robertg761.hadesktopwidget' } };
    const executablePath = '/opt/HA Desktop Widget/ha-widget';
    const autostartPath = getLinuxAutostartFilePath(pkg, 'HA Desktop Widget', env);

    setLinuxLoginItemSettings(true, { pkg, appName: 'HA Desktop Widget', executablePath, env });

    expect(fs.existsSync(autostartPath)).toBe(true);
    expect(
      isLinuxLoginItemEnabled({ pkg, appName: 'HA Desktop Widget', executablePath, env })
    ).toBe(true);

    setLinuxLoginItemSettings(false, { pkg, appName: 'HA Desktop Widget', executablePath, env });

    expect(fs.existsSync(autostartPath)).toBe(false);
    expect(
      isLinuxLoginItemEnabled({ pkg, appName: 'HA Desktop Widget', executablePath, env })
    ).toBe(false);
  });

  describe('surviving an AppImage update', () => {
    const pkg = { build: { appId: 'com.github.robertg761.hadesktopwidget' } };
    const appName = 'HA Desktop Widget';
    const oldPath = '/home/user/Apps/HA-Desktop-Widget-3.9.1-linux-x86_64.AppImage';
    const newPath = '/home/user/Apps/HA-Desktop-Widget-3.10.0-linux-x86_64.AppImage';

    // The regression: an update renames the AppImage and deletes the old file, so an entry
    // written before it names a path that is gone. The user never turned the setting off.
    test('reports start-at-login as on even when the recorded path is stale', () => {
      const env = { XDG_CONFIG_HOME: tmpDir };
      setLinuxLoginItemSettings(true, { pkg, appName, executablePath: oldPath, env });

      expect(isLinuxLoginItemEnabled({ pkg, appName, executablePath: newPath, env })).toBe(true);
    });

    test('repoints a stale entry at the running executable', () => {
      const env = { XDG_CONFIG_HOME: tmpDir };
      const autostartPath = getLinuxAutostartFilePath(pkg, appName, env);
      setLinuxLoginItemSettings(true, { pkg, appName, executablePath: oldPath, env });

      const result = syncLinuxAutostartExecutablePath({
        pkg,
        appName,
        executablePath: newPath,
        env,
      });

      expect(result.repaired).toBe(true);
      expect(result.reason).toBe('stale');
      const content = fs.readFileSync(autostartPath, 'utf8');
      expect(content).toContain(`Exec=${quoteDesktopExecArg(newPath)}`);
      expect(content).not.toContain(oldPath);
    });

    test('leaves an already-current entry untouched', () => {
      const env = { XDG_CONFIG_HOME: tmpDir };
      const autostartPath = getLinuxAutostartFilePath(pkg, appName, env);
      setLinuxLoginItemSettings(true, { pkg, appName, executablePath: newPath, env });
      const before = fs.readFileSync(autostartPath, 'utf8');

      const result = syncLinuxAutostartExecutablePath({
        pkg,
        appName,
        executablePath: newPath,
        env,
      });

      expect(result.repaired).toBe(false);
      expect(result.reason).toBe('current');
      expect(fs.readFileSync(autostartPath, 'utf8')).toBe(before);
    });

    // Start-at-login being off must stay off; repair must never create an entry.
    test('does not create an entry when start-at-login was never enabled', () => {
      const env = { XDG_CONFIG_HOME: tmpDir };
      const autostartPath = getLinuxAutostartFilePath(pkg, appName, env);

      const result = syncLinuxAutostartExecutablePath({
        pkg,
        appName,
        executablePath: newPath,
        env,
      });

      expect(result.repaired).toBe(false);
      expect(result.reason).toBe('absent');
      expect(fs.existsSync(autostartPath)).toBe(false);
    });

    test('respects entries the desktop has explicitly disabled', () => {
      const env = { XDG_CONFIG_HOME: tmpDir };
      const autostartPath = getLinuxAutostartFilePath(pkg, appName, env);
      fs.mkdirSync(path.dirname(autostartPath), { recursive: true });

      for (const disabled of [
        `[Desktop Entry]\nExec="${oldPath}"\nHidden=true\n`,
        `[Desktop Entry]\nExec="${oldPath}"\nX-GNOME-Autostart-enabled=false\n`,
      ]) {
        fs.writeFileSync(autostartPath, disabled, 'utf8');

        expect(isLinuxLoginItemEnabled({ pkg, appName, executablePath: newPath, env })).toBe(false);
        const result = syncLinuxAutostartExecutablePath({
          pkg,
          appName,
          executablePath: newPath,
          env,
        });
        expect(result.repaired).toBe(false);
        expect(result.reason).toBe('disabled');
        expect(fs.readFileSync(autostartPath, 'utf8')).toBe(disabled);
      }
    });

    test('needs-repair is true only for an enabled entry naming another executable', () => {
      const enabledOld = `[Desktop Entry]\nExec="${oldPath}"\n`;
      expect(linuxAutostartEntryNeedsRepair(enabledOld, newPath)).toBe(true);
      expect(linuxAutostartEntryNeedsRepair(enabledOld, oldPath)).toBe(false);
      expect(linuxAutostartEntryNeedsRepair('', newPath)).toBe(false);
    });
  });

  describe('adopting entries left under an older file name', () => {
    // package.json did not always carry appId, so older builds named the file after the app.
    // Those entries are invisible to the current name: unreadable, unrepairable, unremovable.
    const pkg = { appId: 'com.github.robertg761.hadesktopwidget', name: 'home-assistant-widget' };
    const appName = 'home-assistant-widget';
    const deadPath = '/home/user/Apps/HA-Desktop-Widget-3.9.1-linux-x86_64.AppImage';
    const livePath = '/home/user/Apps/HA-Desktop-Widget-3.10.0-linux-x86_64.AppImage';
    const legacyName = 'home-assistant-widget.desktop';
    const currentName = 'com.github.robertg761.hadesktopwidget.desktop';

    const legacyEntry = (execPath, extra = '') =>
      `[Desktop Entry]\nType=Application\nVersion=1.0\nName=${appName}\n` +
      `Comment=Launch ${appName} at login\nExec="${execPath}"\nTerminal=false\n` +
      `X-GNOME-Autostart-enabled=true\n${extra}`;

    const writeLegacy = (dir, content) => {
      fs.mkdirSync(path.join(dir, 'autostart'), { recursive: true });
      fs.writeFileSync(path.join(dir, 'autostart', legacyName), content, 'utf8');
    };

    test('the current and legacy names really do differ', () => {
      expect(getLinuxStartupDesktopFileName(pkg, appName)).toBe(currentName);
      expect(getLegacyLinuxAutostartFilePaths(pkg, appName, { XDG_CONFIG_HOME: tmpDir })).toContain(
        path.join(tmpDir, 'autostart', legacyName)
      );
    });

    test('adopts a legacy entry and repoints it at the running executable', () => {
      const env = { XDG_CONFIG_HOME: tmpDir };
      writeLegacy(tmpDir, legacyEntry(deadPath));

      const result = migrateLegacyLinuxAutostartEntry({
        pkg,
        appName,
        executablePath: livePath,
        env,
      });

      expect(result.adopted).toBe(true);
      expect(fs.existsSync(path.join(tmpDir, 'autostart', legacyName))).toBe(false);
      const adopted = fs.readFileSync(path.join(tmpDir, 'autostart', currentName), 'utf8');
      expect(adopted).toContain(`Exec=${quoteDesktopExecArg(livePath)}`);
      // And the setting now reads as on, which it did not before adoption.
      expect(isLinuxLoginItemEnabled({ pkg, appName, executablePath: livePath, env })).toBe(true);
    });

    test('removes the leftover when both names exist, so login does not launch twice', () => {
      const env = { XDG_CONFIG_HOME: tmpDir };
      writeLegacy(tmpDir, legacyEntry(deadPath));
      setLinuxLoginItemSettings(true, { pkg, appName, executablePath: livePath, env });

      const result = migrateLegacyLinuxAutostartEntry({
        pkg,
        appName,
        executablePath: livePath,
        env,
      });

      expect(result.removedDuplicate).toBe(true);
      expect(result.adopted).toBe(false);
      expect(fs.existsSync(path.join(tmpDir, 'autostart', legacyName))).toBe(false);
      expect(fs.existsSync(path.join(tmpDir, 'autostart', currentName))).toBe(true);
    });

    test('leaves a legacy entry the user disabled exactly where it is', () => {
      const env = { XDG_CONFIG_HOME: tmpDir };
      const disabled = legacyEntry(deadPath).replace(
        'X-GNOME-Autostart-enabled=true',
        'X-GNOME-Autostart-enabled=false'
      );
      writeLegacy(tmpDir, disabled);

      const result = migrateLegacyLinuxAutostartEntry({
        pkg,
        appName,
        executablePath: livePath,
        env,
      });

      expect(result.adopted).toBe(false);
      expect(fs.readFileSync(path.join(tmpDir, 'autostart', legacyName), 'utf8')).toBe(disabled);
      expect(fs.existsSync(path.join(tmpDir, 'autostart', currentName))).toBe(false);
    });

    // Someone else's file that happens to share the name must never be adopted or deleted.
    test('never touches an entry this app did not write', () => {
      const env = { XDG_CONFIG_HOME: tmpDir };
      const foreign =
        '[Desktop Entry]\nType=Application\nName=Something else\nExec="/usr/bin/true"\n';
      writeLegacy(tmpDir, foreign);

      const result = migrateLegacyLinuxAutostartEntry({
        pkg,
        appName,
        executablePath: livePath,
        env,
      });

      expect(result.adopted).toBe(false);
      expect(result.removedDuplicate).toBe(false);
      expect(fs.readFileSync(path.join(tmpDir, 'autostart', legacyName), 'utf8')).toBe(foreign);
      expect(isGeneratedLinuxAutostartEntry(foreign)).toBe(false);
      expect(isGeneratedLinuxAutostartEntry(legacyEntry(deadPath))).toBe(true);
    });

    test('does nothing when there is no legacy entry', () => {
      const env = { XDG_CONFIG_HOME: tmpDir };
      const result = migrateLegacyLinuxAutostartEntry({
        pkg,
        appName,
        executablePath: livePath,
        env,
      });

      expect(result.adopted).toBe(false);
      expect(result.removedDuplicate).toBe(false);
      expect(fs.existsSync(path.join(tmpDir, 'autostart', currentName))).toBe(false);
    });
  });

  test('prefers APPIMAGE for packaged Linux startup registration', () => {
    const app = { getPath: jest.fn(() => '/tmp/.mount_App/ha-desktop-widget') };
    const env = { APPIMAGE: '/home/user/Applications/HA Desktop Widget.AppImage' };

    expect(getLinuxStartupExecutablePath(app, env)).toBe(
      '/home/user/Applications/HA Desktop Widget.AppImage'
    );
    expect(app.getPath).not.toHaveBeenCalled();
  });
});

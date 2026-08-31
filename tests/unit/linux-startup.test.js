const fs = require('fs');
const os = require('os');
const path = require('path');
const {
  buildLinuxAutostartDesktopEntry,
  getLinuxAutostartFilePath,
  getLinuxStartupDesktopFileName,
  getLinuxStartupExecutablePath,
  isLinuxLoginItemEnabled,
  linuxAutostartEntryNeedsRepair,
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

  test('prefers APPIMAGE for packaged Linux startup registration', () => {
    const app = { getPath: jest.fn(() => '/tmp/.mount_App/ha-desktop-widget') };
    const env = { APPIMAGE: '/home/user/Applications/HA Desktop Widget.AppImage' };

    expect(getLinuxStartupExecutablePath(app, env)).toBe(
      '/home/user/Applications/HA Desktop Widget.AppImage'
    );
    expect(app.getPath).not.toHaveBeenCalled();
  });
});

const fs = require('fs');
const os = require('os');
const path = require('path');
const {
  buildLinuxAutostartDesktopEntry,
  getLinuxAutostartFilePath,
  getLinuxStartupDesktopFileName,
  getLinuxStartupExecutablePath,
  isLinuxLoginItemEnabled,
  quoteDesktopExecArg,
  setLinuxLoginItemSettings,
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

  test('prefers APPIMAGE for packaged Linux startup registration', () => {
    const app = { getPath: jest.fn(() => '/tmp/.mount_App/ha-desktop-widget') };
    const env = { APPIMAGE: '/home/user/Applications/HA Desktop Widget.AppImage' };

    expect(getLinuxStartupExecutablePath(app, env)).toBe(
      '/home/user/Applications/HA Desktop Widget.AppImage'
    );
    expect(app.getPath).not.toHaveBeenCalled();
  });
});

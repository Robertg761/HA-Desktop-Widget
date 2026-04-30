const {
  getWindowsStartupRegistryName,
  hasEnabledLaunchItemForExecutable,
  isWindowsLoginItemEnabled,
  normalizeWindowsExecutablePath,
  quoteWindowsExecutablePath,
  stripSurroundingQuotes,
} = require('../../src/windows-startup.cjs');

describe('Windows startup helpers', () => {
  test('quotes executable paths for Windows Run commands', () => {
    expect(quoteWindowsExecutablePath('C:\\Apps\\HA Desktop Widget.exe')).toBe('"C:\\Apps\\HA Desktop Widget.exe"');
    expect(quoteWindowsExecutablePath('"C:\\Apps\\HA Desktop Widget.exe"')).toBe('"C:\\Apps\\HA Desktop Widget.exe"');
  });

  test('normalizes executable paths before comparing launch items', () => {
    expect(normalizeWindowsExecutablePath('"C:\\Apps\\HA Desktop Widget.exe"')).toBe('c:\\apps\\ha desktop widget.exe');
    expect(stripSurroundingQuotes('"C:\\Apps\\HA Desktop Widget.exe"')).toBe('C:\\Apps\\HA Desktop Widget.exe');
  });

  test('does not treat Electron-parsed unquoted paths with spaces as enabled', () => {
    const executablePath = 'C:\\Users\\rober\\AppData\\Local\\Programs\\home-assistant-widget\\HA Desktop Widget.exe';
    const settings = {
      openAtLogin: false,
      executableWillLaunchAtLogin: true,
      launchItems: [
        {
          name: 'com.github.robertg761.hadesktopwidget',
          path: 'C:\\Users\\rober\\AppData\\Local\\Programs\\home-assistant-widget\\HA',
          args: ['Desktop', 'Widget.exe'],
          enabled: true,
        },
      ],
    };

    expect(hasEnabledLaunchItemForExecutable(settings, executablePath)).toBe(false);
    expect(isWindowsLoginItemEnabled(settings, executablePath)).toBe(false);
  });

  test('recognizes a quoted Run command that resolves to the executable', () => {
    const executablePath = 'C:\\Users\\rober\\AppData\\Local\\Programs\\home-assistant-widget\\HA Desktop Widget.exe';
    const settings = {
      openAtLogin: false,
      executableWillLaunchAtLogin: true,
      launchItems: [
        {
          name: 'com.github.robertg761.hadesktopwidget',
          path: executablePath,
          args: [],
          enabled: true,
        },
      ],
    };

    expect(isWindowsLoginItemEnabled(settings, executablePath)).toBe(true);
  });

  test('uses the Electron Builder app id as the registry value name', () => {
    expect(getWindowsStartupRegistryName({
      name: 'home-assistant-widget',
      build: { appId: 'com.github.robertg761.hadesktopwidget' },
    }, 'Fallback')).toBe('com.github.robertg761.hadesktopwidget');
  });
});

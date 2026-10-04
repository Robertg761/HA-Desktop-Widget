/**
 * @jest-environment node
 */

const { EventEmitter } = require('events');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const mainSource = fs.readFileSync(path.resolve(__dirname, '../../main.js'), 'utf8');

function loadScheme({ platform, themeSource = 'system', dark = true, systemUiDark = true }) {
  const nativeTheme = Object.assign(new EventEmitter(), {
    themeSource,
    shouldUseDarkColors: dark,
    shouldUseDarkColorsForSystemIntegratedUI: systemUiDark,
  });
  // The settings portal's watcher, which main.js starts on Linux. `portal.report` stands in for
  // the desktop changing its colour scheme.
  const portal = {
    scheme: null,
    onChange: null,
    get: () => portal.scheme,
    start: jest.fn(),
    close: jest.fn(),
    report: (scheme) => {
      portal.scheme = scheme;
      portal.onChange?.(scheme);
    },
  };
  const context = {
    process: { platform },
    nativeTheme,
    pushConfigToRenderer: jest.fn(),
    log: { debug: jest.fn() },
    createPortalColorSchemeWatcher: jest.fn(({ onChange }) => {
      portal.onChange = onChange;
      return portal;
    }),
  };
  const start = mainSource.indexOf('let lastSystemColorScheme = null;');
  const end = mainSource.indexOf('function applyNativeThemeSource()', start);
  expect(start).toBeGreaterThan(-1);
  const watcherEnd = mainSource.indexOf(
    '\n}\n',
    mainSource.indexOf('function watchSystemColorScheme')
  );
  vm.runInNewContext(mainSource.slice(start, end), context);
  vm.runInNewContext(
    mainSource.slice(
      mainSource.indexOf('/** Tell the renderer when the OS changes its scheme'),
      watcherEnd + 3
    ),
    context
  );
  return { context, nativeTheme, portal };
}

describe('the OS color scheme the tray follows', () => {
  it('asks Windows for the taskbar scheme, which differs from the app scheme', () => {
    const { context } = loadScheme({
      platform: 'win32',
      themeSource: 'light',
      dark: false,
      systemUiDark: true,
    });
    expect(context.getSystemColorScheme()).toBe('dark');
  });

  it('remembers the scheme Linux had before the app pinned its own', () => {
    const { context, nativeTheme } = loadScheme({ platform: 'linux', dark: false });
    expect(context.getSystemColorScheme()).toBe('light');

    // The app theme is set to Dark: the native theme now reports that, not the panel.
    nativeTheme.themeSource = 'dark';
    nativeTheme.shouldUseDarkColors = true;
    expect(context.getSystemColorScheme()).toBe('light');
  });

  it('follows the OS again while the app theme is Auto', () => {
    const { context, nativeTheme } = loadScheme({ platform: 'linux', dark: false });
    context.getSystemColorScheme();
    nativeTheme.shouldUseDarkColors = true;
    expect(context.getSystemColorScheme()).toBe('dark');
  });

  it('says nothing when it was never able to see the OS scheme', () => {
    const { context } = loadScheme({ platform: 'linux', themeSource: 'dark' });
    expect(context.getSystemColorScheme()).toBeNull();
  });

  it('is part of what the renderer is told about this desktop', () => {
    expect(mainSource).toMatch(/systemColorScheme: getSystemColorScheme\(\),/);
  });

  describe('while the app theme is pinned to Dark or Light', () => {
    function pinnedOnLinux({ osDark = false, pinned = 'dark' } = {}) {
      const loaded = loadScheme({ platform: 'linux', dark: osDark });
      loaded.context.watchSystemColorScheme();
      // Reading the scheme before the source is pinned is what applyNativeThemeSource does.
      loaded.context.getSystemColorScheme();
      loaded.nativeTheme.themeSource = pinned;
      loaded.nativeTheme.shouldUseDarkColors = pinned === 'dark';
      return loaded;
    }

    it('keeps following the desktop, which the settings portal still reports', () => {
      const { context, portal } = pinnedOnLinux({ osDark: false });
      expect(context.getSystemColorScheme()).toBe('light');

      // The shell goes dark. nativeTheme only says what the app pinned, so the tray icons
      // used to keep the palette that suited the light shell.
      portal.report('dark');
      expect(context.getSystemColorScheme()).toBe('dark');
      portal.report('light');
      expect(context.getSystemColorScheme()).toBe('light');
    });

    it('tells the renderer when the desktop changes, so the tray icons are redrawn', () => {
      const { context, portal } = pinnedOnLinux({ osDark: false });
      portal.report('dark');
      expect(context.pushConfigToRenderer).toHaveBeenCalledTimes(1);
      // The app theme being pinned again, or the portal repeating itself, is not news.
      portal.report('dark');
      expect(context.pushConfigToRenderer).toHaveBeenCalledTimes(1);
      portal.report('light');
      expect(context.pushConfigToRenderer).toHaveBeenCalledTimes(2);
    });

    it('knows the desktop scheme even when the app was started with the theme already pinned', () => {
      const { context, portal } = loadScheme({ platform: 'linux', themeSource: 'light' });
      context.watchSystemColorScheme();
      expect(context.getSystemColorScheme()).toBeNull();
      portal.report('dark');
      expect(context.getSystemColorScheme()).toBe('dark');
      expect(context.pushConfigToRenderer).toHaveBeenCalledTimes(1);
    });

    it('keeps the remembered scheme when the portal has no preference to give', () => {
      const { context, portal } = pinnedOnLinux({ osDark: true });
      portal.report(null);
      expect(context.getSystemColorScheme()).toBe('dark');
    });
  });

  it('still takes the scheme from nativeTheme while the app theme is Auto', () => {
    const { context, nativeTheme, portal } = loadScheme({ platform: 'linux', dark: false });
    context.watchSystemColorScheme();
    // Chromium reads the same setting, so the two agree; the answer the page itself sees wins.
    portal.scheme = 'dark';
    expect(context.getSystemColorScheme()).toBe('light');
    nativeTheme.shouldUseDarkColors = true;
    expect(context.getSystemColorScheme()).toBe('dark');
  });

  it('reads the settings portal on Linux only, and starts it once', () => {
    const linux = loadScheme({ platform: 'linux' });
    linux.context.watchSystemColorScheme();
    expect(linux.context.createPortalColorSchemeWatcher).toHaveBeenCalledTimes(1);
    expect(linux.portal.start).toHaveBeenCalledTimes(1);

    for (const platform of ['win32', 'darwin']) {
      const other = loadScheme({ platform });
      other.context.watchSystemColorScheme();
      expect(other.context.createPortalColorSchemeWatcher).not.toHaveBeenCalled();
    }
  });

  it('tells the renderer only when the OS scheme really changed', () => {
    const { context, nativeTheme } = loadScheme({ platform: 'win32', systemUiDark: true });
    context.watchSystemColorScheme();

    // The app's own theme changing also raises 'updated'.
    nativeTheme.emit('updated');
    expect(context.pushConfigToRenderer).not.toHaveBeenCalled();

    nativeTheme.shouldUseDarkColorsForSystemIntegratedUI = false;
    nativeTheme.emit('updated');
    expect(context.pushConfigToRenderer).toHaveBeenCalledTimes(1);
    nativeTheme.emit('updated');
    expect(context.pushConfigToRenderer).toHaveBeenCalledTimes(1);
  });
});

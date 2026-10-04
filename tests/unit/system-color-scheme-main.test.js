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
  const context = {
    process: { platform },
    nativeTheme,
    pushConfigToRenderer: jest.fn(),
    log: { debug: jest.fn() },
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
  return { context, nativeTheme };
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

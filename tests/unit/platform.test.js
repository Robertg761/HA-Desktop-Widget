const path = require('path');
const {
  getAppIconPath,
  getMainWindowVisualOptions,
  isLinuxAppImage,
  shouldUseTransparentWindow,
  supportsAutoUpdater,
  supportsElectronLoginItems,
} = require('../../src/platform.cjs');

describe('platform helpers', () => {
  test('uses ico on Windows and png elsewhere for app window icons', () => {
    expect(getAppIconPath('/app', 'win32')).toBe(path.join('/app', 'build', 'icon.ico'));
    expect(getAppIconPath('/app', 'linux')).toBe(path.join('/app', 'build', 'icon.png'));
    expect(getAppIconPath('/app', 'darwin')).toBe(path.join('/app', 'build', 'icon.png'));
  });

  test('treats Electron login item APIs as Windows/macOS only', () => {
    expect(supportsElectronLoginItems('win32')).toBe(true);
    expect(supportsElectronLoginItems('darwin')).toBe(true);
    expect(supportsElectronLoginItems('linux')).toBe(false);
  });

  test('enables in-app auto-updates only for supported packaged Linux format', () => {
    expect(isLinuxAppImage({ APPIMAGE: '/apps/HA Desktop Widget.AppImage' })).toBe(true);
    expect(supportsAutoUpdater('linux', { APPIMAGE: '/apps/HA Desktop Widget.AppImage' })).toBe(true);
    expect(supportsAutoUpdater('linux', {})).toBe(false);
    expect(supportsAutoUpdater('win32', {})).toBe(true);
    expect(supportsAutoUpdater('darwin', {})).toBe(true);
  });

  test('uses opaque native windows on Linux unless explicitly overridden', () => {
    expect(shouldUseTransparentWindow('linux', {})).toBe(false);
    expect(shouldUseTransparentWindow('linux', { HA_WIDGET_LINUX_TRANSPARENT_WINDOW: '1' })).toBe(true);
    expect(shouldUseTransparentWindow('linux', { HA_WIDGET_LINUX_TRANSPARENT_WINDOW: 'true' })).toBe(true);
    expect(shouldUseTransparentWindow('win32', {})).toBe(true);
    expect(shouldUseTransparentWindow('darwin', {})).toBe(true);
  });

  test('uses an opaque resizable Windows window without frosted glass', () => {
    expect(getMainWindowVisualOptions({
      platform: 'win32',
      frostedGlass: false,
      transparencyOptions: { transparent: false, backgroundColor: '#28282d' },
    })).toEqual({
      transparent: false,
      backgroundColor: '#28282d',
      thickFrame: true,
    });
  });

  test('enables Windows acrylic only when frosted glass is enabled', () => {
    expect(getMainWindowVisualOptions({
      platform: 'win32',
      frostedGlass: true,
      transparencyOptions: { transparent: true, backgroundColor: '#00000000' },
    })).toEqual({
      transparent: true,
      backgroundColor: '#00000000',
      thickFrame: true,
      backgroundMaterial: 'acrylic',
    });
  });

  test('enables macOS vibrancy only when frosted glass is enabled', () => {
    expect(getMainWindowVisualOptions({
      platform: 'darwin',
      frostedGlass: true,
      transparencyOptions: { transparent: true, backgroundColor: '#00000000' },
    })).toEqual({
      transparent: true,
      backgroundColor: '#00000000',
      vibrancy: 'sidebar',
    });

    expect(getMainWindowVisualOptions({
      platform: 'darwin',
      frostedGlass: false,
      transparencyOptions: { transparent: true, backgroundColor: '#00000000' },
    })).toEqual({
      transparent: true,
      backgroundColor: '#00000000',
    });
  });

  test('leaves Linux visual options driven by transparency options', () => {
    expect(getMainWindowVisualOptions({
      platform: 'linux',
      frostedGlass: true,
      transparencyOptions: { transparent: false, backgroundColor: '#28282d' },
    })).toEqual({
      transparent: false,
      backgroundColor: '#28282d',
    });
  });
});

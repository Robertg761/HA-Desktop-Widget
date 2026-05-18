const path = require('path');
const {
  getAppIconPath,
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
});

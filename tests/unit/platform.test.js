const path = require('path');
const {
  getAppIconPath,
  getMainWindowVisualOptions,
  hasGlobalShortcutFallback,
  isLinuxAppImage,
  shouldForceX11OzonePlatform,
  shouldUseCompositorOwnedPlacement,
  shouldUsePortalGlobalShortcuts,
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
    expect(supportsAutoUpdater('linux', { APPIMAGE: '/apps/HA Desktop Widget.AppImage' })).toBe(
      true
    );
    expect(supportsAutoUpdater('linux', {})).toBe(false);
    expect(supportsAutoUpdater('win32', {})).toBe(true);
    expect(supportsAutoUpdater('darwin', {})).toBe(false);
  });

  test('uses opaque native windows on Linux unless explicitly overridden', () => {
    expect(shouldUseTransparentWindow('linux', {})).toBe(false);
    expect(shouldUseTransparentWindow('linux', { HA_WIDGET_LINUX_TRANSPARENT_WINDOW: '1' })).toBe(
      true
    );
    expect(
      shouldUseTransparentWindow('linux', { HA_WIDGET_LINUX_TRANSPARENT_WINDOW: 'true' })
    ).toBe(true);
    expect(shouldUseTransparentWindow('win32', {})).toBe(true);
    expect(shouldUseTransparentWindow('darwin', {})).toBe(true);
  });

  test('runs Linux Wayland sessions through XWayland so the widget can place itself', () => {
    const waylandEnv = { DISPLAY: ':0', WAYLAND_DISPLAY: 'wayland-0' };
    expect(
      shouldForceX11OzonePlatform({
        platform: 'linux',
        env: waylandEnv,
        argv: [],
        waylandSession: true,
      })
    ).toBe(true);
    // An X11 session already has the behavior we want.
    expect(
      shouldForceX11OzonePlatform({
        platform: 'linux',
        env: waylandEnv,
        argv: [],
        waylandSession: false,
      })
    ).toBe(false);
    expect(
      shouldForceX11OzonePlatform({
        platform: 'win32',
        env: waylandEnv,
        argv: [],
        waylandSession: true,
      })
    ).toBe(false);
    expect(
      shouldForceX11OzonePlatform({
        platform: 'darwin',
        env: waylandEnv,
        argv: [],
        waylandSession: true,
      })
    ).toBe(false);
  });

  test('stops retrying XWayland on a machine where it could not render', () => {
    expect(
      shouldForceX11OzonePlatform({
        platform: 'linux',
        env: { DISPLAY: ':0' },
        argv: [],
        waylandSession: true,
        previousAttemptFailed: true,
      })
    ).toBe(false);
  });

  test('stays on Wayland when XWayland is not running', () => {
    // Forcing x11 with no X display would stop the app from starting at all.
    expect(
      shouldForceX11OzonePlatform({
        platform: 'linux',
        env: { WAYLAND_DISPLAY: 'wayland-0' },
        argv: [],
        waylandSession: true,
      })
    ).toBe(false);
    expect(
      shouldForceX11OzonePlatform({
        platform: 'linux',
        env: { DISPLAY: '   ', WAYLAND_DISPLAY: 'wayland-0' },
        argv: [],
        waylandSession: true,
      })
    ).toBe(false);
  });

  test('leaves the Wayland backend alone when the user asked for it', () => {
    const base = { platform: 'linux', argv: [], waylandSession: true };
    const withDisplay = (extra) => ({ DISPLAY: ':0', ...extra });
    expect(
      shouldForceX11OzonePlatform({
        ...base,
        env: withDisplay({ HA_WIDGET_LINUX_NATIVE_WAYLAND: '1' }),
      })
    ).toBe(false);
    expect(
      shouldForceX11OzonePlatform({
        ...base,
        env: withDisplay({ HA_WIDGET_LINUX_NATIVE_WAYLAND: 'yes' }),
      })
    ).toBe(false);
    expect(
      shouldForceX11OzonePlatform({
        ...base,
        env: withDisplay({ ELECTRON_OZONE_PLATFORM_HINT: 'wayland' }),
      })
    ).toBe(false);
    expect(
      shouldForceX11OzonePlatform({
        ...base,
        env: withDisplay(),
        argv: ['electron', '--ozone-platform=wayland'],
      })
    ).toBe(false);
    // An unrelated value should not be mistaken for an opt-out.
    expect(
      shouldForceX11OzonePlatform({
        ...base,
        env: withDisplay({ HA_WIDGET_LINUX_NATIVE_WAYLAND: '0' }),
      })
    ).toBe(true);
  });

  test('derives compositor-owned placement from the effective Ozone backend', () => {
    const base = {
      platform: 'linux',
      env: { DISPLAY: ':0', WAYLAND_DISPLAY: 'wayland-0' },
      waylandSession: true,
      forcedX11Ozone: false,
    };
    expect(
      shouldUseCompositorOwnedPlacement({
        ...base,
        argv: ['electron', '--ozone-platform=x11'],
      })
    ).toBe(false);
    expect(
      shouldUseCompositorOwnedPlacement({
        ...base,
        argv: ['electron', '--ozone-platform', 'x11'],
      })
    ).toBe(false);
    expect(
      shouldUseCompositorOwnedPlacement({
        ...base,
        argv: ['electron', '--ozone-platform=wayland'],
      })
    ).toBe(true);
    expect(
      shouldUseCompositorOwnedPlacement({
        ...base,
        argv: ['electron', '--ozone-platform-hint=x11'],
      })
    ).toBe(false);
    expect(
      shouldUseCompositorOwnedPlacement({
        ...base,
        argv: ['electron', '--ozone-platform-hint=wayland'],
      })
    ).toBe(true);
    expect(
      shouldUseCompositorOwnedPlacement({
        ...base,
        env: { ...base.env, ELECTRON_OZONE_PLATFORM_HINT: 'x11' },
        argv: [],
      })
    ).toBe(false);
    expect(
      shouldUseCompositorOwnedPlacement({
        ...base,
        env: { ...base.env, ELECTRON_OZONE_PLATFORM_HINT: 'wayland' },
        argv: [],
      })
    ).toBe(true);
    expect(
      shouldUseCompositorOwnedPlacement({
        ...base,
        argv: [],
        forcedX11Ozone: true,
      })
    ).toBe(false);
  });

  test('routes Wayland-session hotkeys through the portal regardless of Ozone backend', () => {
    // The compositor owns global shortcuts on the whole session, so the forced-XWayland
    // default must not steer hotkeys away from the portal.
    expect(shouldUsePortalGlobalShortcuts({ platform: 'linux', waylandSession: true })).toBe(true);
    expect(shouldUsePortalGlobalShortcuts({ platform: 'linux', waylandSession: false })).toBe(
      false
    );
    expect(shouldUsePortalGlobalShortcuts({ platform: 'win32', waylandSession: true })).toBe(false);
    expect(shouldUsePortalGlobalShortcuts({ platform: 'darwin', waylandSession: true })).toBe(
      false
    );
  });

  test('offers the legacy globalShortcut fallback everywhere except native Wayland', () => {
    const base = { platform: 'linux', env: {}, argv: [], waylandSession: true };
    // Native Wayland: globalShortcut is a hard no-op, no XGrabKey fallback exists.
    expect(hasGlobalShortcutFallback(base)).toBe(false);
    expect(
      hasGlobalShortcutFallback({
        ...base,
        env: { ELECTRON_OZONE_PLATFORM_HINT: 'wayland' },
      })
    ).toBe(false);
    // Forced or explicit XWayland keeps the partial X-grab fallback.
    expect(hasGlobalShortcutFallback({ ...base, forcedX11Ozone: true })).toBe(true);
    expect(hasGlobalShortcutFallback({ ...base, argv: ['--ozone-platform=x11'] })).toBe(true);
    // X11 sessions and other platforms always have globalShortcut.
    expect(hasGlobalShortcutFallback({ ...base, waylandSession: false })).toBe(true);
    expect(hasGlobalShortcutFallback({ platform: 'win32', waylandSession: true })).toBe(true);
    expect(hasGlobalShortcutFallback({ platform: 'darwin' })).toBe(true);
  });

  test('keeps Windows transparent and resizable without frosted glass', () => {
    expect(
      getMainWindowVisualOptions({
        platform: 'win32',
        frostedGlass: false,
        transparencyOptions: { transparent: true, backgroundColor: '#00000000' },
      })
    ).toEqual({
      transparent: true,
      backgroundColor: '#00000000',
      thickFrame: true,
    });
  });

  test('enables Windows acrylic only when frosted glass is enabled', () => {
    expect(
      getMainWindowVisualOptions({
        platform: 'win32',
        frostedGlass: true,
        transparencyOptions: { transparent: true, backgroundColor: '#00000000' },
      })
    ).toEqual({
      transparent: true,
      backgroundColor: '#00000000',
      thickFrame: true,
      backgroundMaterial: 'acrylic',
    });
  });

  test('enables macOS vibrancy only when frosted glass is enabled', () => {
    expect(
      getMainWindowVisualOptions({
        platform: 'darwin',
        frostedGlass: true,
        transparencyOptions: { transparent: true, backgroundColor: '#00000000' },
      })
    ).toEqual({
      transparent: true,
      backgroundColor: '#00000000',
      vibrancy: 'sidebar',
    });

    expect(
      getMainWindowVisualOptions({
        platform: 'darwin',
        frostedGlass: false,
        transparencyOptions: { transparent: true, backgroundColor: '#00000000' },
      })
    ).toEqual({
      transparent: true,
      backgroundColor: '#00000000',
    });
  });

  test('leaves Linux visual options driven by transparency options', () => {
    expect(
      getMainWindowVisualOptions({
        platform: 'linux',
        frostedGlass: true,
        transparencyOptions: { transparent: false, backgroundColor: '#28282d' },
      })
    ).toEqual({
      transparent: false,
      backgroundColor: '#28282d',
      roundedCorners: false,
    });
  });
});

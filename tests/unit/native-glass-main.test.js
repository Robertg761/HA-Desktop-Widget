const fs = require('fs');
const path = require('path');
const vm = require('vm');

const source = fs.readFileSync(path.join(__dirname, '../../main.js'), 'utf8');

// The source from a function or handler's opening line to its closing brace at column 0.
function section(startMarker) {
  const start = source.indexOf(startMarker);
  expect(start).toBeGreaterThanOrEqual(0);
  return source.slice(start, source.indexOf('\n}', start));
}

// Windows 11 22H2+ (supported) and Windows 10 / Windows 11 before 22H2 (unsupported).
function runtime({ platform, nativeGlassSupported }) {
  const listeners = {};
  const targetWindow = {
    isDestroyed: () => false,
    setBackgroundMaterial: jest.fn(),
    setVibrancy: jest.fn(),
    setVisualEffectState: jest.fn(),
    setBackgroundColor: jest.fn(),
    on: jest.fn((name, handler) => {
      listeners[name] = handler;
    }),
  };
  const context = {
    process: { platform },
    NATIVE_GLASS_SUPPORTED: nativeGlassSupported,
    config: { frostedGlass: true },
    log: { warn: jest.fn() },
    getWindowTransparencyOptions: () => ({ transparent: true, backgroundColor: '#00000000' }),
    resolveFrostedGlassConfig: (currentConfig, override) =>
      typeof override === 'boolean' ? override : !!currentConfig?.frostedGlass,
    setTimeout: jest.fn(),
  };
  vm.createContext(context);
  vm.runInContext(
    source.slice(
      source.indexOf('function applyWindowEffectsToWindow('),
      source.indexOf('function applyDesktopPinWindowEffects(')
    ),
    context
  );
  return { context, targetWindow, listeners };
}

describe('Windows acrylic on the main process', () => {
  it('asks for acrylic on Windows 11 22H2 and later', () => {
    const { context, targetWindow } = runtime({ platform: 'win32', nativeGlassSupported: true });
    context.applyWindowEffectsToWindow(targetWindow, context.config);
    expect(targetWindow.setBackgroundMaterial).toHaveBeenLastCalledWith('acrylic');
    context.applyWindowEffectsToWindow(targetWindow, { frostedGlass: false });
    expect(targetWindow.setBackgroundMaterial).toHaveBeenLastCalledWith('none');
    // A desktop pin forces the material off whatever the setting says.
    context.applyWindowEffectsToWindow(targetWindow, context.config, false);
    expect(targetWindow.setBackgroundMaterial).toHaveBeenLastCalledWith('none');
  });

  it('never requests a background material on Windows that cannot draw it', () => {
    const { context, targetWindow } = runtime({ platform: 'win32', nativeGlassSupported: false });
    context.applyWindowEffectsToWindow(targetWindow, context.config);
    context.applyWindowEffectsToWindow(targetWindow, context.config, true);
    context.applyWindowEffectsToWindow(targetWindow, context.config, false);
    expect(targetWindow.setBackgroundMaterial).not.toHaveBeenCalled();
    // The window stays a clear transparent surface under the solid panel.
    expect(targetWindow.setBackgroundColor).toHaveBeenLastCalledWith('#00000000');
  });

  it('refreshes acrylic after focus changes only where acrylic exists', () => {
    const supported = runtime({ platform: 'win32', nativeGlassSupported: true });
    supported.context.wireWindowEffectsRefresh(
      supported.targetWindow,
      () => supported.context.config
    );
    expect(Object.keys(supported.listeners).sort()).toEqual(
      ['blur', 'enter-full-screen', 'focus', 'leave-full-screen', 'restore', 'show'].sort()
    );
    supported.listeners.focus();
    expect(supported.targetWindow.setBackgroundMaterial).toHaveBeenLastCalledWith('acrylic');

    const unsupported = runtime({ platform: 'win32', nativeGlassSupported: false });
    unsupported.context.wireWindowEffectsRefresh(
      unsupported.targetWindow,
      () => unsupported.context.config
    );
    expect(unsupported.targetWindow.on).not.toHaveBeenCalled();
  });

  it('leaves macOS vibrancy alone whatever the Windows capability says', () => {
    const { context, targetWindow } = runtime({ platform: 'darwin', nativeGlassSupported: true });
    context.applyWindowEffectsToWindow(targetWindow, context.config);
    expect(targetWindow.setVibrancy).toHaveBeenLastCalledWith('sidebar');
    expect(targetWindow.setVisualEffectState).toHaveBeenLastCalledWith('active');
    expect(targetWindow.setBackgroundMaterial).not.toHaveBeenCalled();
  });

  it('detects support once from the OS build and hands it to every window', () => {
    expect(source).toContain("const { supportsNativeGlass } = require('./src/window-glass.cjs');");
    expect(source).toMatch(
      /const NATIVE_GLASS_SUPPORTED = supportsNativeGlass\(\{\s*platform: process\.platform,\s*release: os\.release\(\),\s*\}\);/
    );
    // The main window's options, and every payload the renderer reads its capabilities from.
    // Keyed by site so a failure names the one that dropped the value.
    const passesSupport = (marker, pattern = /nativeGlassSupported: NATIVE_GLASS_SUPPORTED,/) =>
      pattern.test(section(marker));
    expect({
      createWindow: passesSupport(
        'function createWindow(',
        /nativeGlassSupported: NATIVE_GLASS_SUPPORTED,\s*transparencyOptions,/
      ),
      sanitizeConfigForRenderer: passesSupport('function sanitizeConfigForRenderer('),
      sendDesktopPinUpdate: passesSupport('function sendDesktopPinUpdate('),
      getDesktopPinBootstrap: passesSupport("ipcMain.handle('get-desktop-pin-bootstrap'"),
    }).toEqual({
      createWindow: true,
      sanitizeConfigForRenderer: true,
      sendDesktopPinUpdate: true,
      getDesktopPinBootstrap: true,
    });
    const pinCreation = source.slice(
      source.indexOf('function createDesktopPinWindow('),
      source.indexOf('const pinWindow = new BrowserWindow(')
    );
    expect(pinCreation).toContain(
      "if (NATIVE_GLASS_SUPPORTED) windowOptions.backgroundMaterial = 'acrylic';"
    );
  });
});

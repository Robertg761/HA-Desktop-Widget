const fs = require('fs');
const path = require('path');
const vm = require('vm');
const source = fs.readFileSync(path.join(__dirname, '../../main.js'), 'utf8');

function windowMock() {
  return { isDestroyed: () => false, setOpacity: jest.fn() };
}

function runtime(platform = 'darwin', opaquePanels = false) {
  const mainWindow = windowMock();
  const pin = windowMock();
  const handlers = {};
  const context = {
    process: { platform, env: {} },
    shouldUseTransparentWindow: () => false,
    OPAQUE_WINDOW_BACKGROUND_COLOR: '#12161e',
    config: { opacity: 0.5, ui: { opaquePanels } },
    mainWindow,
    desktopPinWindows: new Map([['light.test', pin]]),
    log: { warn: jest.fn() },
    applyAlwaysOnTopPreference: jest.fn(),
    applyFrostedGlass: jest.fn(),
    applyDesktopPinWindowEffects: jest.fn(),
    authorizeIpcSender: () => ({ type: 'main' }),
    serializeConfigMutationHandler: (handler) => handler,
    saveConfigDurably: jest.fn(async () => ({ success: true })),
    ipcMain: {
      handle: (name, handler) => {
        handlers[name] = handler;
      },
    },
  };
  vm.createContext(context);
  vm.runInContext(
    source.slice(
      source.indexOf('function getWindowTransparencyOptions('),
      source.indexOf('function refreshProfileSyncRuntimeTracking(')
    ),
    context
  );
  vm.runInContext(
    source.slice(
      source.indexOf('function applyMainWindowSettingSideEffects('),
      source.indexOf('function configSectionChanged(')
    ),
    context
  );
  vm.runInContext(
    source.slice(
      source.indexOf("ipcMain.handle(\n  'set-opacity'"),
      source.indexOf("ipcMain.handle(\n  'set-always-on-top'")
    ),
    context
  );
  return { context, mainWindow, pin, handlers };
}

it.each(['darwin', 'linux', 'win32'])(
  'keeps native windows opaque with the preset on %s and preserves the saved preference',
  (platform) => {
    const { context, mainWindow, pin } = runtime(platform, true);
    expect(context.applyWindowOpacityToAll(0.5)).toBe(0.5);
    expect(mainWindow.setOpacity).toHaveBeenLastCalledWith(1);
    expect(pin.setOpacity).toHaveBeenLastCalledWith(1);
    expect(context.config.opacity).toBe(0.5);
  }
);

it('reapplies native opacity when only the preset changes and restores the saved value', () => {
  const { context, mainWindow, pin } = runtime();
  const original = context.config;
  const enabled = { ...original, ui: { opaquePanels: true } };
  context.applyMainWindowSettingSideEffects(original, enabled);
  expect(mainWindow.setOpacity).toHaveBeenLastCalledWith(1);
  expect(pin.setOpacity).toHaveBeenLastCalledWith(1);
  context.applyMainWindowSettingSideEffects(enabled, original);
  expect(mainWindow.setOpacity).toHaveBeenLastCalledWith(0.5);
  expect(pin.setOpacity).toHaveBeenLastCalledWith(0.5);
});

it('keeps both widget and pins opaque through preview, save, and failed-save rollback', async () => {
  const { context, mainWindow, pin, handlers } = runtime('darwin', true);
  handlers['preview-window-effects']({}, { opacity: 0.7 });
  expect(context.config.opacity).toBe(0.5);
  expect(mainWindow.setOpacity).toHaveBeenLastCalledWith(1);
  expect(pin.setOpacity).toHaveBeenLastCalledWith(1);
  expect(await handlers['set-opacity']({}, 0.7)).toEqual({ success: true, opacity: 0.7 });
  expect(context.config.opacity).toBe(0.7);
  context.saveConfigDurably.mockResolvedValueOnce({ success: false, error: 'disk full' });
  expect((await handlers['set-opacity']({}, 0.9)).success).toBe(false);
  expect(context.config.opacity).toBe(0.7);
  expect(mainWindow.setOpacity).toHaveBeenLastCalledWith(1);
  expect(pin.setOpacity).toHaveBeenLastCalledWith(1);
  context.config.ui.opaquePanels = false;
  handlers['preview-window-effects']({}, { frostedGlass: false });
  expect(mainWindow.setOpacity).toHaveBeenLastCalledWith(0.7);
  expect(pin.setOpacity).toHaveBeenLastCalledWith(0.7);
});

it('routes every native opacity write through the shared policy, including pin creation and refresh', () => {
  expect(source.match(/\.setOpacity\(/g)).toHaveLength(1);
});

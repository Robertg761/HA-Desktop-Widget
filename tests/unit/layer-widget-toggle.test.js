const fs = require('fs');
const path = require('path');
const vm = require('vm');
const mainSource = fs.readFileSync(path.resolve(__dirname, '../../main.js'), 'utf8');

function loadShowRuntime({ layerMode, visible = true, elevated = false }) {
  const context = {
    isLayerShellChildProcess: layerMode,
    config: { windowSize: { width: 400, height: 600 } },
    DEFAULT_WINDOW_SIZE: { width: 400, height: 600 },
    log: { warn: jest.fn() },
    createWindow: jest.fn(),
    mainWindow: {
      isDestroyed: () => false,
      isVisible: () => visible,
      isFocused: () => false,
      setSize: jest.fn(),
    },
    popupWindowPresenter: {
      showAboveFullScreen: jest.fn(),
      releaseElevation: jest.fn(),
      isElevated: () => elevated,
    },
  };
  const start = mainSource.indexOf('function focusMainWindow');
  const end = mainSource.indexOf('/** Hide the widget to the tray', start);
  vm.runInNewContext(mainSource.slice(start, end), context);
  return context;
}

describe('showing the widget from the tray, launcher or --toggle', () => {
  it('keeps the one-off raise everywhere outside a desktop layer', () => {
    const runtime = loadShowRuntime({ layerMode: false });
    runtime.showMainWindowFromTray();
    expect(runtime.popupWindowPresenter.showAboveFullScreen).toHaveBeenCalledWith(
      runtime.mainWindow,
      { keepElevated: false }
    );
  });

  it('keeps a desktop-layer widget raised instead of flashing it', () => {
    const runtime = loadShowRuntime({ layerMode: true });
    runtime.showMainWindowFromTray();
    expect(runtime.popupWindowPresenter.showAboveFullScreen).toHaveBeenCalledWith(
      runtime.mainWindow,
      { keepElevated: true }
    );
  });

  it('leaves a click inside the widget as a one-off raise', () => {
    const runtime = loadShowRuntime({ layerMode: true });
    runtime.focusMainWindow();
    expect(runtime.popupWindowPresenter.showAboveFullScreen).toHaveBeenCalledWith(
      runtime.mainWindow,
      { keepElevated: false }
    );
  });

  it('raises a covered desktop-layer widget and lowers it on the next toggle', () => {
    const covered = loadShowRuntime({ layerMode: true, elevated: false });
    covered.toggleRaisedLayerWidget();
    expect(covered.popupWindowPresenter.showAboveFullScreen).toHaveBeenCalledTimes(1);
    expect(covered.popupWindowPresenter.releaseElevation).not.toHaveBeenCalled();

    const raised = loadShowRuntime({ layerMode: true, elevated: true });
    raised.toggleRaisedLayerWidget();
    expect(raised.popupWindowPresenter.releaseElevation).toHaveBeenCalledWith(raised.mainWindow);
    expect(raised.popupWindowPresenter.showAboveFullScreen).not.toHaveBeenCalled();
  });

  it('shows a hidden desktop-layer widget raised', () => {
    const runtime = loadShowRuntime({ layerMode: true, visible: false, elevated: false });
    runtime.toggleRaisedLayerWidget();
    expect(runtime.popupWindowPresenter.showAboveFullScreen).toHaveBeenCalledWith(
      runtime.mainWindow,
      { keepElevated: true }
    );
  });
});

/**
 * @jest-environment node
 */

const {
  POPUP_WINDOW_TOP_LEVEL,
  createPopupWindowPresenter,
} = require('../../src/popup-window-presenter.cjs');

const WORK_AREA = { x: 0, y: 0, width: 1920, height: 1040 };

function createWindowMock(overrides = {}) {
  const state = {
    bounds: { x: 300, y: 200, width: 480, height: 640 },
    visible: false,
  };
  const windowMock = {
    state,
    isDestroyed: jest.fn(() => false),
    isMinimized: jest.fn(() => false),
    isVisible: jest.fn(() => state.visible),
    isFocused: jest.fn(() => state.visible),
    isAlwaysOnTop: jest.fn(() => false),
    restore: jest.fn(),
    show: jest.fn(() => {
      state.visible = true;
    }),
    hide: jest.fn(() => {
      state.visible = false;
    }),
    focus: jest.fn(),
    moveTop: jest.fn(),
    setAlwaysOnTop: jest.fn(),
    setVisibleOnAllWorkspaces: jest.fn(),
    getBounds: jest.fn(() => ({ ...state.bounds })),
    setBounds: jest.fn((bounds) => {
      state.bounds = { ...state.bounds, ...bounds };
    }),
  };
  return Object.assign(windowMock, overrides);
}

function createPresenter(overrides = {}) {
  const config = overrides.config || {
    alwaysOnTop: false,
    windowPosition: { x: 300, y: 200 },
    windowSize: { width: 480, height: 640 },
  };
  const log = { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() };
  const presenter = createPopupWindowPresenter({
    platform: overrides.platform || 'win32',
    getConfig: () => config,
    getWorkAreas: overrides.getWorkAreas || (() => [WORK_AREA]),
    shouldReleaseElevationOnBlur: overrides.shouldReleaseElevationOnBlur || (() => false),
    requestCompositorRaise: overrides.requestCompositorRaise || null,
    log,
  });
  return { presenter, config, log };
}

describe('popup window presenter', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.clearAllTimers();
    jest.useRealTimers();
  });

  test('raises to the top level before showing so the first frame is above full-screen video', () => {
    const targetWindow = createWindowMock();
    const { presenter } = createPresenter();

    expect(presenter.showAboveFullScreen(targetWindow)).toBe(true);

    const raiseOrder = targetWindow.setAlwaysOnTop.mock.invocationCallOrder[0];
    const showOrder = targetWindow.show.mock.invocationCallOrder[0];
    expect(raiseOrder).toBeLessThan(showOrder);
    expect(targetWindow.setAlwaysOnTop).toHaveBeenCalledWith(true, POPUP_WINDOW_TOP_LEVEL);
    expect(presenter.isElevated()).toBe(true);
  });

  test('asks the compositor to raise on show and on each re-assert pass', () => {
    const targetWindow = createWindowMock();
    const requestCompositorRaise = jest.fn(() => Promise.resolve(true));
    const { presenter } = createPresenter({ requestCompositorRaise });

    presenter.showAboveFullScreen(targetWindow);
    expect(requestCompositorRaise).toHaveBeenCalledTimes(1);
    expect(requestCompositorRaise).toHaveBeenCalledWith(targetWindow);

    jest.runOnlyPendingTimers();
    expect(requestCompositorRaise).toHaveBeenCalledTimes(3);
  });

  test('a failing compositor raise never breaks the show path', () => {
    const targetWindow = createWindowMock();
    const rejected = jest.fn(() => Promise.reject(new Error('kwin gone')));
    const throwing = jest.fn(() => {
      throw new Error('kwin gone');
    });

    const { presenter } = createPresenter({ requestCompositorRaise: rejected });
    expect(presenter.showAboveFullScreen(targetWindow)).toBe(true);

    const { presenter: throwingPresenter } = createPresenter({
      requestCompositorRaise: throwing,
    });
    expect(throwingPresenter.showAboveFullScreen(createWindowMock())).toBe(true);
    expect(throwing).toHaveBeenCalled();
  });

  test('holds the raise across the re-assert passes while the window stays visible', () => {
    const targetWindow = createWindowMock();
    const { presenter } = createPresenter();

    presenter.showAboveFullScreen(targetWindow);
    jest.runOnlyPendingTimers();

    expect(targetWindow.moveTop.mock.calls.length).toBeGreaterThan(1);
    expect(targetWindow.setAlwaysOnTop.mock.calls.every((call) => call[0] === true)).toBe(true);
    expect(presenter.isElevated()).toBe(true);
  });

  test('stops re-asserting once the window is no longer visible', () => {
    const targetWindow = createWindowMock();
    const { presenter } = createPresenter();

    presenter.showAboveFullScreen(targetWindow);
    targetWindow.state.visible = false;
    const moveTopCalls = targetWindow.moveTop.mock.calls.length;

    jest.runOnlyPendingTimers();
    expect(targetWindow.moveTop.mock.calls.length).toBe(moveTopCalls);
  });

  test('restores the position the user last placed the window at', () => {
    const targetWindow = createWindowMock();
    targetWindow.show = jest.fn(() => {
      targetWindow.state.visible = true;
      // A compositor relocating the window on show is what moved the widget away from
      // where the user left it.
      targetWindow.state.bounds = { ...targetWindow.state.bounds, x: 0, y: 0 };
    });
    const { presenter } = createPresenter();

    presenter.showAboveFullScreen(targetWindow);

    expect(targetWindow.setBounds).toHaveBeenCalledWith({
      x: 300,
      y: 200,
      width: 480,
      height: 640,
    });
  });

  test('leaves the position alone when it already matches and when it is off-screen', () => {
    const onScreenWindow = createWindowMock();
    const { presenter } = createPresenter();
    presenter.showAboveFullScreen(onScreenWindow);
    expect(onScreenWindow.setBounds).not.toHaveBeenCalled();

    const offScreenWindow = createWindowMock();
    offScreenWindow.state.bounds = { x: 10, y: 10, width: 480, height: 640 };
    const { presenter: offScreenPresenter, log } = createPresenter({
      config: {
        alwaysOnTop: false,
        // A monitor that is no longer connected.
        windowPosition: { x: 4000, y: 1800 },
      },
    });
    offScreenPresenter.showAboveFullScreen(offScreenWindow);
    expect(offScreenWindow.setBounds).not.toHaveBeenCalled();
    expect(log.warn).toHaveBeenCalledWith(expect.stringContaining('off-screen'));
  });

  test('skips the position restore where the compositor owns placement', () => {
    const targetWindow = createWindowMock();
    targetWindow.show = jest.fn(() => {
      targetWindow.state.visible = true;
      targetWindow.state.bounds = { ...targetWindow.state.bounds, x: 960, y: 520 };
    });
    const presenter = createPopupWindowPresenter({
      platform: 'linux',
      getConfig: () => ({ alwaysOnTop: false, windowPosition: { x: 300, y: 200 } }),
      getWorkAreas: () => [WORK_AREA],
      supportsWindowPositioning: false,
      log: { debug: jest.fn(), warn: jest.fn() },
    });

    presenter.showAboveFullScreen(targetWindow);
    jest.runOnlyPendingTimers();

    // Wayland reports back whatever setBounds asked for, so calling it would only write
    // compositor-invented coordinates into the saved position.
    expect(targetWindow.setBounds).not.toHaveBeenCalled();
    expect(targetWindow.show).toHaveBeenCalledTimes(1);
  });

  test('hiding cancels pending raises and returns the window to the saved preference', () => {
    const targetWindow = createWindowMock();
    const { presenter, config } = createPresenter();
    config.alwaysOnTop = true;

    presenter.showAboveFullScreen(targetWindow);
    expect(presenter.hidePopup(targetWindow)).toBe(true);

    expect(targetWindow.setAlwaysOnTop).toHaveBeenLastCalledWith(true);
    const hideOrder = targetWindow.hide.mock.invocationCallOrder[0];
    const restoreOrder = targetWindow.setAlwaysOnTop.mock.invocationCallOrder.at(-1);
    expect(restoreOrder).toBeLessThan(hideOrder);
    expect(presenter.isElevated()).toBe(false);

    const showCalls = targetWindow.show.mock.calls.length;
    jest.runOnlyPendingTimers();
    expect(targetWindow.show.mock.calls.length).toBe(showCalls);
  });

  test('reads the always-on-top preference at release time, not at show time', () => {
    const targetWindow = createWindowMock();
    const { presenter, config } = createPresenter();

    presenter.showAboveFullScreen(targetWindow);
    config.alwaysOnTop = true; // User flips the preference while the popup is up.
    presenter.releaseElevation(targetWindow);

    expect(targetWindow.setAlwaysOnTop).toHaveBeenLastCalledWith(true);
  });

  test('a hide through another path ends the raise exactly once', () => {
    const targetWindow = createWindowMock();
    const { presenter } = createPresenter();

    presenter.showAboveFullScreen(targetWindow);
    targetWindow.hide();

    expect(presenter.handleWindowHidden(targetWindow)).toBe(true);
    expect(targetWindow.setAlwaysOnTop).toHaveBeenLastCalledWith(false);
    expect(presenter.handleWindowHidden(targetWindow)).toBe(false);
  });

  test('releases sticky elevation on a later blur without breaking full-screen activation', () => {
    const targetWindow = createWindowMock();
    const { presenter } = createPresenter({
      shouldReleaseElevationOnBlur: () => true,
    });

    presenter.showAboveFullScreen(targetWindow);
    // A compositor can bounce focus during show; the activation raise must survive it.
    expect(presenter.handleWindowBlur(targetWindow)).toBe(false);
    expect(presenter.isElevated()).toBe(true);

    jest.runOnlyPendingTimers();
    expect(presenter.handleWindowBlur(targetWindow)).toBe(true);
    expect(presenter.isElevated()).toBe(false);
    expect(targetWindow.setAlwaysOnTop).toHaveBeenLastCalledWith(false);
  });

  test('keeps hold-mode elevation until key release even after blur', () => {
    const targetWindow = createWindowMock();
    const { presenter } = createPresenter({
      shouldReleaseElevationOnBlur: () => false,
    });

    presenter.showAboveFullScreen(targetWindow);
    jest.runOnlyPendingTimers();

    expect(presenter.handleWindowBlur(targetWindow)).toBe(false);
    expect(presenter.isElevated()).toBe(true);
    expect(presenter.releaseElevation(targetWindow)).toBe(true);
  });

  test('keepElevated: false settles back to the preference after the raise passes', () => {
    const targetWindow = createWindowMock();
    const { presenter } = createPresenter();

    presenter.showAboveFullScreen(targetWindow, { keepElevated: false });
    expect(presenter.isElevated()).toBe(true);

    jest.runOnlyPendingTimers();
    expect(presenter.isElevated()).toBe(false);
    expect(targetWindow.setAlwaysOnTop).toHaveBeenLastCalledWith(false);
  });

  test('a one-off raise does not release a popup that must stay above full-screen content', () => {
    const targetWindow = createWindowMock();
    const { presenter } = createPresenter();

    presenter.showAboveFullScreen(targetWindow); // Popup hotkey: hold the raise.
    // A desktop pin asking to focus the widget while the popup is up must not schedule a release.
    presenter.showAboveFullScreen(targetWindow, { keepElevated: false });
    jest.runOnlyPendingTimers();

    expect(presenter.isElevated()).toBe(true);
    expect(targetWindow.setAlwaysOnTop).toHaveBeenLastCalledWith(true, POPUP_WINDOW_TOP_LEVEL);

    // Hiding still ends it, and a later one-off raise is free to release again.
    presenter.hidePopup(targetWindow);
    expect(presenter.isElevated()).toBe(false);
    presenter.showAboveFullScreen(targetWindow, { keepElevated: false });
    jest.runOnlyPendingTimers();
    expect(presenter.isElevated()).toBe(false);
  });

  test('lets the window onto full-screen spaces on macOS only', () => {
    const macWindow = createWindowMock();
    const { presenter: macPresenter } = createPresenter({ platform: 'darwin' });
    macPresenter.showAboveFullScreen(macWindow);
    expect(macWindow.setVisibleOnAllWorkspaces).toHaveBeenCalledWith(
      true,
      expect.objectContaining({ visibleOnFullScreen: true })
    );
    macPresenter.hidePopup(macWindow);
    expect(macWindow.setVisibleOnAllWorkspaces).toHaveBeenLastCalledWith(
      false,
      expect.objectContaining({ visibleOnFullScreen: false })
    );

    const linuxWindow = createWindowMock();
    const { presenter: linuxPresenter } = createPresenter({ platform: 'linux' });
    linuxPresenter.showAboveFullScreen(linuxWindow);
    expect(linuxWindow.setVisibleOnAllWorkspaces).not.toHaveBeenCalled();
  });

  test('falls back to a plain raise when the level argument is rejected', () => {
    const targetWindow = createWindowMock();
    targetWindow.setAlwaysOnTop = jest.fn((flag, level) => {
      if (level) throw new Error('unsupported level');
    });
    const { presenter, log } = createPresenter();

    presenter.showAboveFullScreen(targetWindow);

    expect(targetWindow.setAlwaysOnTop).toHaveBeenCalledWith(true);
    expect(log.warn).toHaveBeenCalled();
  });

  test('tolerates a destroyed window and windows missing optional APIs', () => {
    const destroyed = createWindowMock({ isDestroyed: jest.fn(() => true) });
    const { presenter } = createPresenter();
    expect(presenter.showAboveFullScreen(destroyed)).toBe(false);
    expect(destroyed.show).not.toHaveBeenCalled();
    expect(presenter.hidePopup(null)).toBe(false);

    const minimal = {
      isDestroyed: () => false,
      show: jest.fn(),
      hide: jest.fn(),
      setAlwaysOnTop: jest.fn(),
    };
    const { presenter: minimalPresenter } = createPresenter();
    expect(minimalPresenter.showAboveFullScreen(minimal)).toBe(true);
    expect(minimal.show).toHaveBeenCalledTimes(1);
    expect(minimalPresenter.hidePopup(minimal)).toBe(true);
  });
});

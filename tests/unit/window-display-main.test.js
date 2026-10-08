/** @jest-environment node */
const fs = require('fs');
const vm = require('vm');
const displayHelpers = require('../../src/window-display.cjs');
const source = fs.readFileSync(require.resolve('../../main.js'), 'utf8');
const primary = { id: 1, label: 'Laptop', workArea: { x: 0, y: 0, width: 1920, height: 1080 } };
const secondary = { id: 2, label: 'Desk', workArea: { x: 1920, y: 0, width: 1920, height: 1080 } };
function load({ supported = true, saved = true } = {}) {
  let displays = [primary, secondary];
  const context = {
    ...displayHelpers,
    process: { platform: 'linux' },
    config: { windowPosition: { x: 100, y: 100 }, windowSize: { width: 500, height: 600 } },
    usesCompositorOwnedPlacement: !supported,
    clampToMinimumWindowSize: ({ width, height }) => ({ width, height }),
    electronScreen: {
      getAllDisplays: () => displays,
      getPrimaryDisplay: () => primary,
      getDisplayMatching: (bounds) => (bounds.x >= 1920 ? secondary : primary),
    },
    mainWindow: {
      isDestroyed: () => false,
      getBounds: () => ({ x: 100, y: 100, width: 500, height: 600 }),
      setPosition: jest.fn(),
    },
    runSerializedConfigMutation: (fn) => Promise.resolve().then(fn),
    saveConfigDurably: jest.fn(async () => ({
      success: saved,
      error: saved ? undefined : 'disk full',
    })),
    saveConfig: jest.fn(),
    refreshTrayMenu: jest.fn(),
    pushConfigToRenderer: jest.fn(),
    windowStateSaveTimer: null,
    pendingWindowBounds: null,
    clearTimeout,
    log: { warn: jest.fn() },
  };
  const start = source.indexOf('function moveMainWindowToPosition(');
  const end = source.indexOf('// Save the monitor choice', start);
  if (start >= 0) vm.runInNewContext(source.slice(start, end), context);
  return {
    context,
    setDisplays: (value) => {
      displays = value;
    },
  };
}

test('tray selection saves before moving, and broadcasts the saved preference', async () => {
  const { context } = load();
  expect(typeof context.applyWindowDisplayChoice).toBe('function');
  await context.applyWindowDisplayChoice('2');
  expect(context.config.windowDisplay).toMatchObject({ id: '2', offset: { x: 100, y: 100 } });
  expect(context.config.windowPosition).toEqual({ x: 2020, y: 100 });
  expect(context.saveConfigDurably.mock.invocationCallOrder[0]).toBeLessThan(
    context.mainWindow.setPosition.mock.invocationCallOrder[0]
  );
  expect(context.mainWindow.setPosition).toHaveBeenCalledWith(2020, 100);
  expect(context.pushConfigToRenderer).toHaveBeenCalled();
});

test('a failed save leaves both the window and preference unchanged', async () => {
  const { context } = load({ saved: false });
  const before = JSON.stringify(context.config);
  expect(typeof context.applyWindowDisplayChoice).toBe('function');
  await context.applyWindowDisplayChoice('2');
  expect(JSON.stringify(context.config)).toBe(before);
  expect(context.mainWindow.setPosition).not.toHaveBeenCalled();
});

test('an unplugged selection and compositor-owned placement cannot be applied', async () => {
  for (const options of [{ supported: false }, {}]) {
    const { context, setDisplays } = load(options);
    if (options.supported !== false) setDisplays([primary]);
    expect(typeof context.applyWindowDisplayChoice).toBe('function');
    await context.applyWindowDisplayChoice('2');
    expect(context.saveConfigDurably).not.toHaveBeenCalled();
    expect(context.mainWindow.setPosition).not.toHaveBeenCalled();
  }
});

test('clearing a preference leaves the current window in place', async () => {
  const { context } = load();
  context.config.windowDisplay = { id: '2', label: 'Desk', offset: { x: 100, y: 100 } };
  expect(typeof context.applyWindowDisplayChoice).toBe('function');
  await context.applyWindowDisplayChoice('');
  expect(context.config.windowDisplay).toBeNull();
  expect(context.mainWindow.setPosition).not.toHaveBeenCalled();
});

test('moving to a differently scaled Windows display preserves the intended DIP size', async () => {
  const { context } = load();
  context.process = { platform: 'win32' };
  let bounds = { x: 100, y: 100, width: 500, height: 600 };
  context.mainWindow.getBounds = () => ({ ...bounds });
  // The first native move can apply WM_DPICHANGED using the source display's scale.
  context.mainWindow.setPosition.mockImplementation((x, y) => {
    bounds = { x, y, width: 750, height: 900 };
  });
  context.mainWindow.setBounds = jest.fn((next) => {
    bounds = { ...next };
  });

  await context.applyWindowDisplayChoice('2');

  expect(bounds).toEqual({ x: 2020, y: 100, width: 500, height: 600 });
  expect(context.config.windowSize).toEqual({ width: 500, height: 600 });
  expect(context.config.windowDisplay.offset).toEqual({ x: 100, y: 100 });
});

test('repeated Windows monitor choices do not accumulate fractional DPI rounding', async () => {
  const { context } = load();
  context.process = { platform: 'win32' };
  let bounds = { x: 100, y: 100, width: 500, height: 600 };
  context.mainWindow.getBounds = () => ({ ...bounds });
  context.mainWindow.setPosition.mockImplementation((x, y) => {
    bounds = { x, y, width: bounds.width * 1.5, height: bounds.height * 1.5 };
  });
  context.mainWindow.setBounds = jest.fn((next) => {
    bounds = { ...next, width: next.width + (next.x >= 1920 ? 1 : 0) };
  });

  for (const id of ['2', '1', '2', '1']) {
    await context.applyWindowDisplayChoice(id);
    expect(context.config.windowSize).toEqual({ width: 500, height: 600 });
    expect(bounds.width).toBe(id === '2' ? 501 : 500);
  }
});

test('a pending Windows user resize keeps its size even when only one DIP changed', async () => {
  const { context } = load();
  context.process = { platform: 'win32' };
  context.pendingWindowBounds = { x: 100, y: 100, width: 501, height: 600 };
  context.mainWindow.getBounds = () => ({ ...context.pendingWindowBounds });
  await context.applyWindowDisplayChoice('');
  expect(context.config.windowSize).toEqual({ width: 501, height: 600 });
});

test('Automatic durably keeps a drag that has not reached the bounds save timer yet', async () => {
  const { context } = load();
  context.config.windowDisplay = { id: '2', label: 'Desk', offset: { x: 100, y: 100 } };
  context.config.windowPosition = { x: 2020, y: 100 };
  context.pendingWindowBounds = { x: 120, y: 150, width: 550, height: 620 };
  context.mainWindow.getBounds = () => ({ ...context.pendingWindowBounds });
  await context.applyWindowDisplayChoice('');
  expect(context.config.windowPosition).toEqual({ x: 120, y: 150 });
  expect(context.config.windowSize).toEqual({ width: 550, height: 620 });
  expect(context.config.windowDisplay).toBeNull();
  expect(context.mainWindow.setPosition).not.toHaveBeenCalled();
});

test('a bounds save queued during a slow monitor save cannot undo the monitor choice', async () => {
  jest.useFakeTimers();
  try {
    const { context } = load();
    const queued = [];
    let moved;
    Object.assign(context, {
      displayChangeTimer: null,
      isLayerShellChildProcess: false,
      process: { platform: 'win32' },
      setTimeout,
      clearTimeout,
      mainWindowMatchesSavedBounds: () => false,
      onWindowBoundsChanged: (_window, handlers) => {
        moved = handlers.onMove;
      },
      runBackgroundConfigMutation: (callback) => queued.push(callback),
      saveConfig: jest.fn(),
    });
    const start = source.indexOf('function watchMainWindowBounds(');
    vm.runInNewContext(
      source.slice(start, source.indexOf('const DISPLAY_CHANGE_RECOVERY_DELAY_MS', start)),
      context
    );
    context.watchMainWindowBounds(context.mainWindow);
    moved();
    let finishSave;
    context.saveConfigDurably.mockImplementation(
      () =>
        new Promise((resolve) => {
          finishSave = resolve;
        })
    );
    const selection = context.applyWindowDisplayChoice('2');
    await Promise.resolve();
    jest.advanceTimersByTime(400);
    expect(queued).toHaveLength(1);
    finishSave({ success: true });
    await selection;
    queued[0]();
    expect(context.config.windowDisplay.id).toBe('2');
    expect(context.config.windowPosition).toEqual({ x: 2020, y: 100 });
  } finally {
    jest.useRealTimers();
  }
});

test('a queued one-DIP user resize survives a monitor choice ahead of its save', async () => {
  jest.useFakeTimers();
  try {
    const { context } = load();
    const queued = [];
    let resized;
    let bounds = { x: 100, y: 100, width: 501, height: 600 };
    Object.assign(context, {
      displayChangeTimer: null,
      isLayerShellChildProcess: false,
      process: { platform: 'win32' },
      setTimeout,
      clearTimeout,
      mainWindowMatchesSavedBounds: () => false,
      onWindowBoundsChanged: (_window, handlers) => {
        resized = handlers.onResize;
      },
      runBackgroundConfigMutation: (callback) => queued.push(callback),
      saveConfig: jest.fn(),
    });
    context.mainWindow.getBounds = () => ({ ...bounds });
    context.mainWindow.setPosition.mockImplementation((x, y) => {
      bounds = { ...bounds, x, y };
    });
    context.mainWindow.setBounds = jest.fn((next) => {
      bounds = { ...next };
    });
    const start = source.indexOf('function watchMainWindowBounds(');
    vm.runInNewContext(
      source.slice(start, source.indexOf('const DISPLAY_CHANGE_RECOVERY_DELAY_MS', start)),
      context
    );
    context.watchMainWindowBounds(context.mainWindow);
    let release;
    const blocked = new Promise((resolve) => {
      release = resolve;
    });
    context.runSerializedConfigMutation = (callback) => blocked.then(callback);
    const selection = context.applyWindowDisplayChoice('2');
    resized();
    jest.advanceTimersByTime(400);
    expect(queued).toHaveLength(1);

    release();
    await selection;
    queued[0]();

    expect(context.config.windowSize).toEqual({ width: 501, height: 600 });
    expect(bounds).toEqual({ x: 2020, y: 100, width: 501, height: 600 });
    expect(context.config.windowDisplay.id).toBe('2');
    expect(context.pendingWindowBounds).toBeNull();
  } finally {
    jest.useRealTimers();
  }
});

test.each([false, true])(
  'preserves a resize during the durable choice save (queued: %s)',
  async (queuedSave) => {
    jest.useFakeTimers();
    try {
      const { context } = load();
      let bounds = { x: 100, y: 100, width: 500, height: 600 };
      let resized, finishSave, persisted;
      const queued = [];
      Object.assign(context, {
        process: { platform: 'win32' },
        displayChangeTimer: null,
        isLayerShellChildProcess: false,
        setTimeout,
        clearTimeout,
        mainWindowMatchesSavedBounds: () => false,
        onWindowBoundsChanged: (_window, handlers) => {
          resized = handlers.onResize;
        },
        runBackgroundConfigMutation: (fn) => queued.push(fn),
        saveConfig: jest.fn(() => {
          persisted = JSON.parse(JSON.stringify(context.config));
        }),
      });
      context.mainWindow.getBounds = () => ({ ...bounds });
      context.mainWindow.setPosition.mockImplementation((x, y) => {
        bounds = { ...bounds, x, y };
      });
      context.mainWindow.setBounds = jest.fn((next) => {
        bounds = { ...next };
      });
      const start = source.indexOf('function watchMainWindowBounds(');
      vm.runInNewContext(
        source.slice(start, source.indexOf('const DISPLAY_CHANGE_RECOVERY_DELAY_MS', start)),
        context
      );
      context.watchMainWindowBounds(context.mainWindow);
      context.saveConfigDurably.mockImplementation(
        () =>
          new Promise((resolve) => {
            finishSave = resolve;
          })
      );
      const selection = context.applyWindowDisplayChoice('2');
      await Promise.resolve();
      bounds.width = 501;
      resized();
      if (queuedSave) jest.advanceTimersByTime(400);
      finishSave({ success: true });
      await selection;
      for (const fn of queued) fn();
      jest.advanceTimersByTime(400);

      expect(bounds).toEqual({ x: 2020, y: 100, width: 501, height: 600 });
      expect(persisted.windowSize).toEqual({ width: 501, height: 600 });
      expect(persisted.windowDisplay.id).toBe('2');
      expect(persisted.windowPosition).toEqual({ x: 2020, y: 100 });
    } finally {
      jest.useRealTimers();
    }
  }
);

test('dragging to another monitor refreshes the tray with the new preference', () => {
  jest.useFakeTimers();
  try {
    const { context } = load();
    context.config.windowDisplay = { id: '2', label: 'Desk', offset: { x: 100, y: 100 } };
    let moved;
    Object.assign(context, {
      displayChangeTimer: null,
      isLayerShellChildProcess: false,
      process: { platform: 'win32' },
      setTimeout,
      clearTimeout,
      mainWindowMatchesSavedBounds: () => false,
      onWindowBoundsChanged: (_window, handlers) => {
        moved = handlers.onMove;
      },
      runBackgroundConfigMutation: (callback) => callback(),
      saveConfig: jest.fn(),
    });
    let menuSelection;
    context.refreshTrayMenu.mockImplementation(() => {
      menuSelection = context.getWindowDisplaySettings().selectedId;
    });
    const start = source.indexOf('function watchMainWindowBounds(');
    vm.runInNewContext(
      source.slice(start, source.indexOf('const DISPLAY_CHANGE_RECOVERY_DELAY_MS', start)),
      context
    );
    context.watchMainWindowBounds(context.mainWindow);
    moved();
    jest.advanceTimersByTime(400);
    expect(menuSelection).toBe('1');
    expect(context.pushConfigToRenderer).toHaveBeenCalled();
  } finally {
    jest.useRealTimers();
  }
});

/**
 * @jest-environment node
 */

const fs = require('fs');
const path = require('path');

const { IPC_ROUTES, createIpcRoutes } = require('../../src/ipc-routes.cjs');
const { createElectronApi } = require('../../src/preload-api.cjs');

const CHANNELS = Object.keys(IPC_ROUTES);

// Who could call what before the route table, read off main.js's handlers: everything is the main
// window's alone except these, which a desktop pin may call too.
const PIN_CHANNELS = [
  'get-locale-bootstrap',
  'update-desktop-pin-bounds',
  'nudge-desktop-pin',
  'sync-desktop-pin-content-min-bounds',
  'get-desktop-pin-bootstrap',
  'request-desktop-pin-action',
  'begin-layer-drag',
  'end-layer-drag',
  'debug-log',
];

// The handlers that ran, sender check included, in the config mutation queue.
const CONFIG_QUEUE_CHANNELS = [
  'replace-config-entity-id',
  'update-config',
  'clear-token-reset-reason',
  'pin-entity-to-desktop',
  'update-desktop-pin-bounds',
  'nudge-desktop-pin',
  'sync-desktop-pin-content-min-bounds',
  'unpin-entity-from-desktop',
  'set-opacity',
  'set-always-on-top',
  'end-layer-drag',
  'apply-settings-import',
  'restore-profile-sync-backup',
  'set-profile-sync-passphrase',
  'clear-profile-sync-passphrase',
  'resolve-profile-sync-first-enable',
  'register-hotkey',
  'unregister-hotkey',
  'toggle-hotkeys',
  'set-entity-alert',
  'remove-entity-alert',
  'toggle-alerts',
  'set-persistent-notification-toasts',
  'register-popup-hotkey',
  'unregister-popup-hotkey',
];

// What a turned-away call answers, and whether it is logged, where that is not the usual
// { success: false, error: 'Unauthorized' } with a warning.
const UNUSUAL_REJECTIONS = {
  'begin-layer-drag': { response: { success: false }, logged: false },
  'end-layer-drag': { response: { success: false }, logged: false },
  'copy-profile-sync-file': {
    response: { ok: false, status: 'error', error: 'Unauthorized' },
    logged: true,
  },
  'start-card-donation': { response: { status: 'failed' }, logged: true },
};

function topFrame() {
  const frame = {};
  frame.top = frame;
  return frame;
}

function createWindow(id) {
  return { id, webContents: { id }, isDestroyed: () => false };
}

function destroy(window) {
  window.isDestroyed = () => true;
}

/**
 * The route table over a fake Electron: a main window, a desktop pin for light.office, and a
 * window with no role. Every channel's handler answers with what it was called with. The config
 * queue holds calls until `runQueued()`.
 */
function createRoutes({ roles: extraRoles = {} } = {}) {
  const registered = new Map();
  const ipcMain = { handle: jest.fn((channel, listener) => registered.set(channel, listener)) };
  const mainWindow = createWindow(1);
  const pinWindow = createWindow(2);
  const strayWindow = createWindow(3);
  const allWindows = [mainWindow, pinWindow, strayWindow];
  const BrowserWindow = {
    fromWebContents: (webContents) =>
      allWindows.find((window) => window.webContents === webContents) || null,
  };
  const desktopPinWindows = new Map([['light.office', pinWindow]]);
  const queued = [];
  const log = { warn: jest.fn() };
  const routes = createIpcRoutes({
    ipcMain,
    BrowserWindow,
    log,
    roles: {
      main: () => [{ window: mainWindow }],
      'desktop-pin': () =>
        [...desktopPinWindows].map(([entityId, window]) => ({ window, entityId })),
      ...extraRoles,
    },
    queues: {
      config:
        (run) =>
        (...args) =>
          new Promise((resolve) => queued.push(() => resolve(run(...args)))),
    },
  });
  const handlers = {};
  CHANNELS.forEach((channel) => {
    handlers[channel] = jest.fn((sender, ...args) => ({ handledBy: channel, sender, args }));
    routes.handle(channel, handlers[channel]);
  });

  const runQueued = () => queued.splice(0).forEach((run) => run());
  const invoke = async (channel, event, ...args) => {
    const pending = Promise.resolve(registered.get(channel)(event, ...args));
    runQueued();
    return pending;
  };
  const eventFrom = (window) => ({ sender: window.webContents, senderFrame: topFrame() });

  return {
    routes,
    ipcMain,
    registered,
    handlers,
    log,
    queued,
    runQueued,
    invoke,
    eventFrom,
    BrowserWindow,
    allWindows,
    mainWindow,
    pinWindow,
    strayWindow,
    desktopPinWindows,
  };
}

function expectRejected(world, channel, result) {
  const expected = UNUSUAL_REJECTIONS[channel] || {
    response: { success: false, error: 'Unauthorized' },
    logged: true,
  };
  expect(result).toEqual(expected.response);
  expect(world.handlers[channel]).not.toHaveBeenCalled();
  if (expected.logged) {
    expect(world.log.warn).toHaveBeenCalledWith(`Unauthorized IPC sender rejected for ${channel}`);
  } else {
    expect(world.log.warn).not.toHaveBeenCalled();
  }
}

describe('IPC route table', () => {
  test.each(CHANNELS)('%s lets in exactly the roles that could call it', async (channel) => {
    const world = createRoutes();

    const fromMain = await world.invoke(channel, world.eventFrom(world.mainWindow), 'arg');
    expect(fromMain).toEqual({
      handledBy: channel,
      sender: { role: 'main', window: world.mainWindow, webContents: world.mainWindow.webContents },
      args: ['arg'],
    });

    world.handlers[channel].mockClear();
    const fromPin = await world.invoke(channel, world.eventFrom(world.pinWindow), 'arg');
    if (PIN_CHANNELS.includes(channel)) {
      expect(fromPin).toEqual({
        handledBy: channel,
        sender: {
          role: 'desktop-pin',
          entityId: 'light.office',
          window: world.pinWindow,
          webContents: world.pinWindow.webContents,
        },
        args: ['arg'],
      });
    } else {
      expectRejected(world, channel, fromPin);
    }

    world.log.warn.mockClear();
    world.handlers[channel].mockClear();
    expectRejected(
      world,
      channel,
      await world.invoke(channel, world.eventFrom(world.strayWindow), 'arg')
    );
  });

  test('declares every channel the preload invokes, and no other', async () => {
    const invoked = new Set();
    const ipcRenderer = {
      invoke: jest.fn(async (channel) => {
        invoked.add(channel);
        return { success: true };
      }),
      on: jest.fn(),
      removeListener: jest.fn(),
    };
    const api = createElectronApi(ipcRenderer, 'linux');
    await Promise.all(
      Object.entries(api)
        .filter(([name, method]) => typeof method === 'function' && !/^on[A-Z]/.test(name))
        .map(([, method]) => Promise.resolve(method()).catch(() => {}))
    );
    expect([...invoked].sort()).toEqual([...CHANNELS].sort());
  });

  test('main.js gives every route exactly one handler', () => {
    const mainSource = fs.readFileSync(path.resolve(__dirname, '../../main.js'), 'utf8');
    const handled = [...mainSource.matchAll(/ipcRoutes\.handle\(\s*'([^']+)'/g)].map(
      ([, channel]) => channel
    );
    expect(handled.sort()).toEqual([...CHANNELS].sort());
    expect(mainSource).not.toMatch(/ipcMain\.(handle|on)\(/);
  });

  test('runs a queued channel in its queue and checks the sender when its turn comes', async () => {
    const world = createRoutes();
    CHANNELS.forEach((channel) => {
      world.registered.get(channel)(world.eventFrom(world.mainWindow));
      expect(world.queued.length > 0).toBe(CONFIG_QUEUE_CHANNELS.includes(channel));
      world.runQueued();
    });

    // A pin closed while its bounds update waited is turned away once the update's turn comes.
    world.handlers['update-desktop-pin-bounds'].mockClear();
    const pending = world.registered.get('update-desktop-pin-bounds')(
      world.eventFrom(world.pinWindow),
      'light.office'
    );
    destroy(world.pinWindow);
    world.runQueued();
    await expect(pending).resolves.toEqual({ success: false, error: 'Unauthorized' });
    expect(world.handlers['update-desktop-pin-bounds']).not.toHaveBeenCalled();
  });

  describe('turns away, on every channel', () => {
    test.each([
      ['a call with no sender', () => ({})],
      [
        'a subframe of the main window',
        (world) => ({
          sender: world.mainWindow.webContents,
          senderFrame: { top: topFrame() },
        }),
      ],
      [
        'a destroyed main window',
        (world) => {
          destroy(world.mainWindow);
          return world.eventFrom(world.mainWindow);
        },
      ],
      ['a page with no window', () => ({ sender: { id: 99 }, senderFrame: topFrame() })],
      [
        'a page in a window that is not its own',
        (world) => {
          world.BrowserWindow.fromWebContents = () => world.strayWindow;
          return world.eventFrom(world.mainWindow);
        },
      ],
      [
        'a closed pin no longer in the pin windows',
        (world) => {
          world.desktopPinWindows.clear();
          return world.eventFrom(world.pinWindow);
        },
      ],
    ])('%s', async (_label, makeEvent) => {
      for (const channel of CHANNELS) {
        const world = createRoutes();
        expectRejected(world, channel, await world.invoke(channel, makeEvent(world), 'arg'));
      }
    });

    test('a window whose role no channel lets in', async () => {
      let popupWindow;
      const world = createRoutes({
        roles: { 'alert-popup': () => (popupWindow ? [{ window: popupWindow }] : []) },
      });
      popupWindow = createWindow(4);
      world.allWindows.push(popupWindow);
      for (const channel of CHANNELS) {
        world.log.warn.mockClear();
        expectRejected(world, channel, await world.invoke(channel, world.eventFrom(popupWindow)));
      }
    });
  });

  test('a sender has the first role, in the order given, that lists its window', async () => {
    const world = createRoutes();
    world.desktopPinWindows.set('light.kitchen', world.mainWindow);
    const result = await world.invoke('debug-log', world.eventFrom(world.mainWindow));
    expect(result.sender.role).toBe('main');
  });

  test('a call answers a fresh rejection each time', async () => {
    const world = createRoutes();
    const first = await world.invoke('get-config', world.eventFrom(world.strayWindow));
    first.error = 'changed';
    expect(await world.invoke('get-config', world.eventFrom(world.strayWindow))).toEqual({
      success: false,
      error: 'Unauthorized',
    });
  });

  test('refuses a handler for a channel it does not declare, or a second one', () => {
    const world = createRoutes();
    expect(() => world.routes.handle('not-a-channel', jest.fn())).toThrow(
      'not-a-channel is not in the IPC route table'
    );
    expect(() => world.routes.handle('get-config', jest.fn())).toThrow(
      'get-config already has a handler'
    );
  });

  test('needs the windows of every role and every queue the table names', () => {
    const base = {
      ipcMain: { handle: jest.fn() },
      BrowserWindow: { fromWebContents: jest.fn() },
      log: { warn: jest.fn() },
    };
    expect(() =>
      createIpcRoutes({ ...base, roles: { main: () => [] }, queues: { config: (run) => run } })
    ).toThrow('No windows are given for role desktop-pin');
    expect(() =>
      createIpcRoutes({ ...base, roles: { main: () => [], 'desktop-pin': () => [] } })
    ).toThrow('No queue is given for config');
  });
});

// createRoutes() above builds its own role adapters; this runs the ones main.js really passes.
describe("main.js's route wiring", () => {
  function loadMainWiring() {
    const mainSource = fs.readFileSync(path.resolve(__dirname, '../../main.js'), 'utf8');
    const start = mainSource.indexOf('const ipcRoutes = createIpcRoutes({');
    const end = mainSource.indexOf('function normalizeIpcEntityIdForKey(', start);
    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);

    const registered = new Map();
    const mainWindow = createWindow(1);
    const pinWindow = createWindow(2);
    const strayWindow = createWindow(3);
    const allWindows = [mainWindow, pinWindow, strayWindow];
    const log = { warn: jest.fn() };
    const context = {
      createIpcRoutes,
      ipcMain: { handle: (channel, listener) => registered.set(channel, listener) },
      BrowserWindow: {
        fromWebContents: (webContents) =>
          allWindows.find((window) => window.webContents === webContents) || null,
      },
      log,
      mainWindow,
      desktopPinWindows: new Map([['light.office', pinWindow]]),
      serializeConfigMutationHandler: (run) => run,
    };
    const routes = require('vm').runInNewContext(
      `${mainSource.slice(start, end)}\nipcRoutes;`,
      context
    );
    routes.handle('get-desktop-pin-bootstrap', (sender) => sender);
    const invoke = (window) =>
      registered.get('get-desktop-pin-bootstrap')({
        sender: window.webContents,
        senderFrame: topFrame(),
      });
    return { invoke, log, mainWindow, pinWindow, strayWindow };
  }

  test('gives the main window, a desktop pin and its entity, and turns away other windows', () => {
    const world = loadMainWiring();

    expect(world.invoke(world.mainWindow)).toEqual({
      role: 'main',
      window: world.mainWindow,
      webContents: world.mainWindow.webContents,
    });
    expect(world.invoke(world.pinWindow)).toEqual({
      role: 'desktop-pin',
      entityId: 'light.office',
      window: world.pinWindow,
      webContents: world.pinWindow.webContents,
    });
    expect(world.invoke(world.strayWindow)).toEqual({ success: false, error: 'Unauthorized' });
    expect(world.log.warn).toHaveBeenCalledWith(
      'Unauthorized IPC sender rejected for get-desktop-pin-bootstrap'
    );
  });
});

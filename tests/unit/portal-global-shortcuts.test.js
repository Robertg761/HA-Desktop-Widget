const { EventEmitter } = require('events');
const { Variant, MessageType } = require('dbus-next');

const {
  PORTAL_SHORTCUTS_BACKEND,
  acceleratorToPortalTrigger,
  createPortalGlobalShortcutsController,
  isWaylandSession,
} = require('../../src/portal-global-shortcuts.cjs');

const REQUEST_INTERFACE = 'org.freedesktop.portal.Request';
const GLOBAL_SHORTCUTS_INTERFACE = 'org.freedesktop.portal.GlobalShortcuts';
const PORTAL_OBJECT_PATH = '/org/freedesktop/portal/desktop';
const SESSION_HANDLE = '/org/freedesktop/portal/desktop/session/1_99/hawidget_s1';

const silentLog = { info() {}, debug() {}, warn() {}, error() {} };
const waylandEnv = { XDG_SESSION_TYPE: 'wayland' };

class FakeBus extends EventEmitter {
  constructor({ version = 2, bindCode = 0 } = {}) {
    super();
    this.name = ':1.99';
    this.version = version;
    this.bindCode = bindCode;
    this.calls = [];
    this.lastBindShortcuts = null;
    this.disconnected = false;
  }

  requestPath(token) {
    return `${PORTAL_OBJECT_PATH}/request/1_99/${token}`;
  }

  emitResponse(path, code, results) {
    this.emit('message', {
      type: MessageType.SIGNAL,
      interface: REQUEST_INTERFACE,
      member: 'Response',
      path,
      body: [code, results],
    });
  }

  emitActivated(sessionHandle, shortcutId) {
    this.emit('message', {
      type: MessageType.SIGNAL,
      interface: GLOBAL_SHORTCUTS_INTERFACE,
      member: 'Activated',
      path: PORTAL_OBJECT_PATH,
      body: [sessionHandle, shortcutId, 0n, {}],
    });
  }

  call(message) {
    this.calls.push({ member: message.member, interface: message.interface, path: message.path });

    switch (message.member) {
      case 'GetId':
      case 'AddMatch':
      case 'Register':
      case 'Close':
        return Promise.resolve({ body: [] });
      case 'Get':
        return Promise.resolve({ body: [new Variant('u', this.version)] });
      case 'CreateSession': {
        const token = message.body[0].handle_token.value;
        const path = this.requestPath(token);
        setTimeout(() =>
          this.emitResponse(path, 0, { session_handle: new Variant('s', SESSION_HANDLE) })
        );
        return Promise.resolve({ body: [path] });
      }
      case 'BindShortcuts': {
        this.lastBindShortcuts = message.body;
        const token = message.body[3].handle_token.value;
        const path = this.requestPath(token);
        const shortcuts = message.body[1].map(([id, properties]) => [
          id,
          { trigger_description: new Variant('s', properties.preferred_trigger?.value || '') },
        ]);
        setTimeout(() =>
          this.emitResponse(path, this.bindCode, {
            shortcuts: new Variant('a(sa{sv})', shortcuts),
          })
        );
        return Promise.resolve({ body: [path] });
      }
      default:
        return Promise.reject(new Error(`Unexpected D-Bus call: ${message.member}`));
    }
  }

  disconnect() {
    this.disconnected = true;
  }
}

function createController(overrides = {}) {
  const bus = overrides.bus || new FakeBus(overrides.busOptions);
  const activations = [];
  const controller = createPortalGlobalShortcutsController({
    log: silentLog,
    env: waylandEnv,
    createBus: () => bus,
    onActivated: (shortcutId) => activations.push(shortcutId),
    ...overrides.options,
  });
  return { bus, controller, activations };
}

describe('isWaylandSession', () => {
  test('detects wayland via XDG_SESSION_TYPE', () => {
    expect(isWaylandSession({ XDG_SESSION_TYPE: 'wayland' })).toBe(true);
    expect(isWaylandSession({ XDG_SESSION_TYPE: 'Wayland' })).toBe(true);
  });

  test('detects wayland via WAYLAND_DISPLAY', () => {
    expect(isWaylandSession({ WAYLAND_DISPLAY: 'wayland-0' })).toBe(true);
  });

  test('rejects x11 and empty environments', () => {
    expect(isWaylandSession({ XDG_SESSION_TYPE: 'x11' })).toBe(false);
    expect(isWaylandSession({})).toBe(false);
    expect(isWaylandSession(null)).toBe(false);
  });
});

describe('acceleratorToPortalTrigger', () => {
  test.each([
    ['Alt+1', 'ALT+1'],
    ['Ctrl+Shift+Z', 'CTRL+SHIFT+z'],
    ['CommandOrControl+K', 'CTRL+k'],
    ['Super+Space', 'LOGO+space'],
    ['Meta+F5', 'LOGO+F5'],
    ['Ctrl+PageUp', 'CTRL+Page_Up'],
    ['Alt+Plus', 'ALT+plus'],
    ['F12', 'F12'],
  ])('converts %s to %s', (accelerator, expected) => {
    expect(acceleratorToPortalTrigger(accelerator)).toBe(expected);
  });

  test('rejects modifier-only and empty accelerators', () => {
    expect(acceleratorToPortalTrigger('Ctrl+Alt')).toBeNull();
    expect(acceleratorToPortalTrigger('')).toBeNull();
    expect(acceleratorToPortalTrigger(null)).toBeNull();
  });

  test('deduplicates modifiers', () => {
    expect(acceleratorToPortalTrigger('Ctrl+Control+X')).toBe('CTRL+x');
  });
});

describe('createPortalGlobalShortcutsController', () => {
  test('is unavailable outside Wayland sessions without touching the bus', async () => {
    const bus = new FakeBus();
    const controller = createPortalGlobalShortcutsController({
      log: silentLog,
      env: { XDG_SESSION_TYPE: 'x11' },
      createBus: () => bus,
    });
    await expect(controller.isAvailable()).resolves.toBe(false);
    expect(bus.calls).toHaveLength(0);
  });

  test('reports availability from the portal version property', async () => {
    const { controller } = createController();
    await expect(controller.isAvailable()).resolves.toBe(true);
  });

  test('binds shortcuts through the portal and reports triggers', async () => {
    const { bus, controller } = createController();

    const result = await controller.syncShortcuts([
      { id: 'entity.scene.bright', description: 'Turn on bright', accelerator: 'Alt+1' },
      { id: 'popup-toggle', description: 'Show the widget', accelerator: 'Ctrl+Shift+Z' },
    ]);

    expect(result).toEqual({
      success: true,
      backend: PORTAL_SHORTCUTS_BACKEND,
      bound: [
        { id: 'entity.scene.bright', trigger: 'ALT+1' },
        { id: 'popup-toggle', trigger: 'CTRL+SHIFT+z' },
      ],
    });
    expect(controller.getSessionHandle()).toBe(SESSION_HANDLE);

    const [boundSession, tuples, parentWindow] = bus.lastBindShortcuts;
    expect(boundSession).toBe(SESSION_HANDLE);
    expect(parentWindow).toBe('');
    expect(tuples[0][0]).toBe('entity.scene.bright');
    expect(tuples[0][1].preferred_trigger.value).toBe('ALT+1');
    expect(bus.calls.map((call) => call.member)).toContain('Register');
  });

  test('dispatches Activated signals for the bound session only', async () => {
    const { bus, controller, activations } = createController();
    await controller.syncShortcuts([
      { id: 'entity.scene.bright', description: 'Bright', accelerator: 'Alt+1' },
    ]);

    bus.emitActivated('/some/other/session', 'entity.scene.bright');
    bus.emitActivated(SESSION_HANDLE, 'entity.scene.bright');
    bus.emitActivated(SESSION_HANDLE, 'popup-toggle');

    expect(activations).toEqual(['entity.scene.bright', 'popup-toggle']);
  });

  test('reports cancellation when the user rejects the bind dialog', async () => {
    const { controller } = createController({ busOptions: { bindCode: 1 } });
    const result = await controller.syncShortcuts([
      { id: 'entity.scene.bright', description: 'Bright', accelerator: 'Alt+1' },
    ]);
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/cancelled/);
  });

  test('closes the previous session when rebinding and on empty sync', async () => {
    const { bus, controller } = createController();
    await controller.syncShortcuts([{ id: 'a', description: 'A', accelerator: 'Alt+1' }]);
    await controller.syncShortcuts([{ id: 'a', description: 'A', accelerator: 'Alt+2' }]);

    const closeCalls = bus.calls.filter((call) => call.member === 'Close');
    expect(closeCalls).toHaveLength(1);
    expect(closeCalls[0].path).toBe(SESSION_HANDLE);

    const emptyResult = await controller.syncShortcuts([]);
    expect(emptyResult).toEqual({ success: true, backend: PORTAL_SHORTCUTS_BACKEND, bound: [] });
    expect(bus.calls.filter((call) => call.member === 'Close')).toHaveLength(2);
    expect(controller.getSessionHandle()).toBe('');
  });

  test('attaches a bus error listener so D-Bus failures cannot crash the process', async () => {
    const { bus, controller } = createController();
    await controller.isAvailable();

    // An EventEmitter 'error' with no listener throws; this must be survivable.
    expect(bus.listenerCount('error')).toBeGreaterThanOrEqual(1);
    expect(() => bus.emit('error', new Error('socket closed'))).not.toThrow();
  });

  test('drops entries without ids and disconnects on close', async () => {
    const { bus, controller } = createController();
    const result = await controller.syncShortcuts([
      null,
      { description: 'missing id', accelerator: 'Alt+3' },
    ]);
    expect(result).toEqual({ success: true, backend: PORTAL_SHORTCUTS_BACKEND, bound: [] });

    await controller.close();
    expect(bus.disconnected).toBe(true);
    await expect(
      controller.syncShortcuts([{ id: 'a', description: 'A', accelerator: 'Alt+1' }])
    ).resolves.toMatchObject({ success: false });
  });
});

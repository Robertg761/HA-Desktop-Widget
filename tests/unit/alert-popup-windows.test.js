const { EventEmitter } = require('events');
const { createAlertPopupManager } = require('../../src/alert-popup-windows.cjs');
const { MAX_ALERT_POPUPS } = require('../../src/alert-popup.cjs');

function createFakeWindow() {
  const window = new EventEmitter();
  let destroyed = false;
  window.bounds = null;
  window.webContents = { send: jest.fn() };
  window.setBounds = jest.fn((bounds) => {
    window.bounds = bounds;
  });
  window.isDestroyed = () => destroyed;
  window.close = jest.fn(() => {
    destroyed = true;
    window.emit('closed');
  });
  return window;
}

const request = (entityId, extra = {}) => ({
  entityId,
  title: entityId,
  message: 'Now On',
  camera: '',
  actions: [],
  seconds: 30,
  ...extra,
});

function setup() {
  const windows = [];
  const forwardAction = jest.fn(() => Promise.resolve({ success: true }));
  const focusMain = jest.fn();
  const manager = createAlertPopupManager({
    createWindow: jest.fn(({ bounds }) => {
      const window = createFakeWindow();
      window.bounds = bounds;
      windows.push(window);
      return window;
    }),
    getWorkArea: () => ({ x: 0, y: 0, width: 1920, height: 1040 }),
    forwardAction,
    focusMain,
    log: { warn: jest.fn(), error: jest.fn() },
  });
  return { manager, windows, forwardAction, focusMain };
}

describe('pop-up alert cards on screen', () => {
  it('opens a window for a card, in the bottom-right corner', () => {
    const { manager, windows } = setup();
    const result = manager.show(request('binary_sensor.doorbell'));
    expect(result).toEqual({ success: true, id: 'alert-popup-1' });
    expect(windows).toHaveLength(1);
    expect(windows[0].bounds.x + windows[0].bounds.width).toBe(1920 - 16);
    expect(windows[0].bounds.y + windows[0].bounds.height).toBe(1040 - 16);
  });

  it('refuses a request it cannot make sense of', () => {
    const { manager, windows } = setup();
    expect(manager.show({ title: 'nothing' }).success).toBe(false);
    expect(windows).toHaveLength(0);
  });

  it('brings the open card of the same entity up to date rather than opening a second', () => {
    const { manager, windows } = setup();
    manager.show(request('binary_sensor.doorbell'));
    const again = manager.show(request('binary_sensor.doorbell', { message: 'Now Off' }));
    expect(again).toMatchObject({ success: true, id: 'alert-popup-1', replaced: true });
    expect(windows).toHaveLength(1);
    expect(windows[0].webContents.send).toHaveBeenCalledWith('alert-popup-update', {
      id: 'alert-popup-1',
      popup: expect.objectContaining({ message: 'Now Off' }),
    });
  });

  it('stacks cards upward and closes the oldest past the limit', () => {
    const { manager, windows } = setup();
    for (let index = 0; index <= MAX_ALERT_POPUPS; index += 1) {
      manager.show(request(`binary_sensor.sensor_${index}`));
    }
    expect(windows[0].close).toHaveBeenCalled();
    expect(manager.list()).toHaveLength(MAX_ALERT_POPUPS);
    const [top, middle, bottom] = manager.list().map((popup) => popup.window.bounds);
    expect(top.y).toBeLessThan(middle.y);
    expect(middle.y).toBeLessThan(bottom.y);
  });

  it('closes up the stack when a card in it goes', () => {
    const { manager, windows } = setup();
    manager.show(request('binary_sensor.a'));
    manager.show(request('binary_sensor.b'));
    const bottom = windows[1].bounds.y;
    windows[1].close();
    expect(manager.list()).toHaveLength(1);
    expect(windows[0].bounds.y).toBe(bottom);
  });

  it('knows its cards by their window contents', () => {
    const { manager, windows } = setup();
    manager.show(request('binary_sensor.a'));
    expect(manager.getBySender(windows[0].webContents).id).toBe('alert-popup-1');
    expect(manager.getBySender({})).toBe(null);
  });

  describe('what a card asks for', () => {
    const doorbell = request('binary_sensor.doorbell', {
      camera: 'camera.front_door',
      actions: [
        { entityId: 'lock.front_door', domain: 'lock', service: 'unlock', label: 'Unlock' },
      ],
    });

    it('calls the service its button was given, through the widget window', async () => {
      const { manager, windows, forwardAction } = setup();
      manager.show(doorbell);
      const popup = manager.getBySender(windows[0].webContents);
      await expect(manager.handleAction(popup, 0)).resolves.toEqual({ success: true });
      expect(forwardAction).toHaveBeenCalledWith(
        'lock.front_door',
        'service-call',
        { domain: 'lock', service: 'unlock', serviceData: {} },
        { awaitResponse: true }
      );
    });

    it('calls nothing for a button it was not given', async () => {
      const { manager, windows, forwardAction } = setup();
      manager.show(doorbell);
      const popup = manager.getBySender(windows[0].webContents);
      await expect(manager.handleAction(popup, 1)).resolves.toMatchObject({ success: false });
      await expect(manager.handleAction(popup, 'turn_on')).resolves.toMatchObject({
        success: false,
      });
      expect(forwardAction).not.toHaveBeenCalled();
    });

    it("opens the widget, or the camera's viewer in it", async () => {
      const { manager, windows, forwardAction, focusMain } = setup();
      manager.show(doorbell);
      const popup = manager.getBySender(windows[0].webContents);
      await manager.handleAction(popup, 'open');
      expect(focusMain).toHaveBeenCalledTimes(1);
      expect(forwardAction).not.toHaveBeenCalled();
      await manager.handleAction(popup, 'open', 'camera');
      expect(forwardAction).toHaveBeenCalledWith('camera.front_door', 'open-details', {});
    });

    it('closes the card when it is dismissed', async () => {
      const { manager, windows } = setup();
      manager.show(doorbell);
      await manager.handleAction(manager.getBySender(windows[0].webContents), 'dismiss');
      expect(windows[0].close).toHaveBeenCalled();
      expect(manager.list()).toHaveLength(0);
    });
  });

  it('closes every card at once, as the app quits', () => {
    const { manager, windows } = setup();
    manager.show(request('binary_sensor.a'));
    manager.show(request('binary_sensor.b'));
    manager.closeAll();
    expect(windows.every((window) => window.close.mock.calls.length === 1)).toBe(true);
    expect(manager.list()).toHaveLength(0);
  });

  it('says so when a window cannot be made', () => {
    const manager = createAlertPopupManager({
      createWindow: () => {
        throw new Error('no display');
      },
      getWorkArea: () => ({ x: 0, y: 0, width: 800, height: 600 }),
      forwardAction: jest.fn(),
      log: { warn: jest.fn(), error: jest.fn() },
    });
    expect(manager.show(request('binary_sensor.a')).success).toBe(false);
    expect(manager.list()).toHaveLength(0);
  });
});

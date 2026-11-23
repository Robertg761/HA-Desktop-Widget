/**
 * @jest-environment jsdom
 */

const { mountAlertPopup, initializeAlertPopup } = require('../../src/alert-popup-view.js');
const { setRendererHost } = require('../../packages/widget-renderer/src/host.js');
const { createElectronHost } = require('../../packages/widget-renderer/src/electron-host.js');

const doorbell = {
  entityId: 'binary_sensor.front_door_ding',
  title: 'Front Doorbell',
  message: 'Now On',
  icon: { entity_id: 'binary_sensor.front_door_ding', state: 'on', attributes: {} },
  camera: 'camera.front_door',
  actions: [
    {
      entityId: 'lock.front_door',
      domain: 'lock',
      service: 'unlock',
      label: 'Unlock',
      name: 'Front Door',
    },
  ],
  seconds: 30,
  at: new Date(2026, 10, 23, 16, 58).getTime(),
};

const flush = async () => {
  for (let index = 0; index < 5; index += 1) await Promise.resolve();
};

beforeAll(() => {
  setRendererHost(createElectronHost({}));
  window.matchMedia =
    window.matchMedia ||
    (() => ({ matches: true, addEventListener() {}, removeEventListener() {} }));
});

let container;
let card;
let send;

beforeEach(() => {
  jest.useFakeTimers({ doNotFake: ['setImmediate', 'nextTick'] });
  container = document.createElement('div');
  document.body.replaceChildren(container);
  send = jest.fn(() => Promise.resolve({ success: true }));
});

afterEach(() => {
  card?.dispose();
  card = null;
  jest.useRealTimers();
});

const mount = (popup = doorbell) => {
  card = mountAlertPopup(container, popup, { send });
  return card;
};

describe('a pop-up alert card', () => {
  it('shows the entity, what happened and when', () => {
    mount();
    expect(container.querySelector('.alert-popup-title').textContent).toBe('Front Doorbell');
    expect(container.querySelector('.alert-popup-message').textContent).toBe('Now On');
    expect(container.querySelector('.alert-popup-time').textContent).toMatch(/4:58|16:58/);
    expect(container.querySelector('.alert-popup').getAttribute('role')).toBe('alertdialog');
  });

  it("shows the camera through the app's own handler, live once the stream has a frame", () => {
    mount();
    const snapshot = container.querySelector('.alert-popup-camera-snapshot');
    const stream = container.querySelector('.alert-popup-camera-stream');
    expect(snapshot.getAttribute('src')).toMatch(/^ha:\/\/camera\/camera\.front_door\?/);
    expect(stream.getAttribute('src')).toMatch(/^ha:\/\/camera_stream\/camera\.front_door\?/);

    Object.defineProperty(stream, 'naturalWidth', { value: 640 });
    Object.defineProperty(stream, 'naturalHeight', { value: 360 });
    stream.onload();
    const frame = container.querySelector('.alert-popup-camera-frame');
    expect(frame.dataset.source).toBe('stream');
    expect(container.querySelector('.alert-popup-camera-badge').dataset.live).toBe('true');
  });

  it('refreshes snapshots when the camera has no stream to give', () => {
    mount();
    const snapshot = container.querySelector('.alert-popup-camera-snapshot');
    const stream = container.querySelector('.alert-popup-camera-stream');
    stream.onerror();
    expect(stream.hasAttribute('src')).toBe(false);
    const first = snapshot.getAttribute('src');
    jest.advanceTimersByTime(3000);
    expect(snapshot.getAttribute('src')).not.toBe(first);
  });

  it('has no camera when the rule has none', () => {
    mount({ ...doorbell, camera: '' });
    expect(container.querySelector('.alert-popup-camera').hidden).toBe(true);
    expect(container.querySelector('.alert-popup-camera-snapshot').hasAttribute('src')).toBe(false);
  });

  it('opens the camera viewer, or the widget', () => {
    mount();
    container.querySelector('.alert-popup-camera').click();
    expect(send).toHaveBeenCalledWith('open', 'camera');
    container.querySelector('.alert-popup-open').click();
    expect(send).toHaveBeenCalledWith('open');
  });

  it('carries out a button by its number and says it is done', async () => {
    mount();
    const button = container.querySelector('.alert-popup-action');
    expect(button.getAttribute('aria-label')).toBe('Unlock: Front Door');
    button.click();
    expect(send).toHaveBeenCalledWith(0);
    expect(button.disabled).toBe(true);
    await flush();
    expect(button.dataset.state).toBe('done');
    expect(button.textContent).toContain('Done');
    jest.advanceTimersByTime(2500);
    expect(button.disabled).toBe(false);
    expect(button.querySelector('.alert-popup-action-label').textContent).toBe('Unlock');
  });

  it('offers to try a button again when it failed', async () => {
    send.mockResolvedValueOnce({ success: false, error: { message: 'Lock is jammed' } });
    mount();
    const button = container.querySelector('.alert-popup-action');
    button.click();
    await flush();
    expect(button.dataset.state).toBe('error');
    expect(button.textContent).toContain('Retry');
    expect(button.title).toBe('Lock is jammed');
    expect(button.disabled).toBe(false);
  });

  it('counts down on its bar and leaves when the time is up', () => {
    mount();
    const bar = container.querySelector('.alert-popup-progress');
    expect(bar.classList.contains('is-running')).toBe(true);
    expect(bar.style.animationDuration).toBe('30s');
    jest.advanceTimersByTime(29000);
    expect(container.querySelector('.alert-popup').classList.contains('is-leaving')).toBe(false);
    jest.advanceTimersByTime(1000);
    expect(container.querySelector('.alert-popup').classList.contains('is-leaving')).toBe(true);
    jest.advanceTimersByTime(400);
    expect(send).toHaveBeenCalledWith('dismiss');
    expect(container.querySelector('.alert-popup-camera-stream').hasAttribute('src')).toBe(false);
  });

  it('keeps its whole time when the system cuts animations short', () => {
    // Reduced motion cuts every animation to nothing, so the bar's animation ends at once.
    mount();
    container.querySelector('.alert-popup-progress').dispatchEvent(new Event('animationend'));
    jest.advanceTimersByTime(1000);
    expect(container.querySelector('.alert-popup').classList.contains('is-leaving')).toBe(false);
    expect(send).not.toHaveBeenCalledWith('dismiss');
  });

  it('holds the countdown while it is pointed at or has the focus', () => {
    mount();
    const card = container.querySelector('.alert-popup');
    jest.advanceTimersByTime(20000);
    card.dispatchEvent(new Event('pointerenter'));
    jest.advanceTimersByTime(60000);
    expect(card.classList.contains('is-leaving')).toBe(false);
    card.dispatchEvent(new Event('pointerleave'));
    jest.advanceTimersByTime(9000);
    expect(card.classList.contains('is-leaving')).toBe(false);

    const button = container.querySelector('.alert-popup-action');
    button.focus();
    card.dispatchEvent(new FocusEvent('focusin'));
    jest.advanceTimersByTime(60000);
    expect(card.classList.contains('is-leaving')).toBe(false);
    button.blur();
    card.dispatchEvent(new FocusEvent('focusout'));
    jest.advanceTimersByTime(1000);
    expect(card.classList.contains('is-leaving')).toBe(true);
  });

  it('stays until it is closed when the rule says so', () => {
    mount({ ...doorbell, seconds: 0 });
    expect(container.querySelector('.alert-popup-progress').hidden).toBe(true);
    container.querySelector('.alert-popup-close').click();
    jest.advanceTimersByTime(400);
    expect(send).toHaveBeenCalledWith('dismiss');
  });

  it('closes with Escape', () => {
    mount();
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    jest.advanceTimersByTime(400);
    expect(send).toHaveBeenCalledWith('dismiss');
  });

  it('starts over when the same alert comes again', () => {
    const view = mount();
    container.querySelector('.alert-popup-close').click();
    view.update({ ...doorbell, message: 'Now Off', actions: [] });
    jest.advanceTimersByTime(400);
    expect(send).not.toHaveBeenCalledWith('dismiss');
    expect(container.querySelector('.alert-popup').classList.contains('is-leaving')).toBe(false);
    expect(container.querySelector('.alert-popup-message').textContent).toBe('Now Off');
    expect(container.querySelector('.alert-popup-actions').hidden).toBe(true);
  });
});

describe("the card window's start", () => {
  it('draws the card the main process gave it, in the widget theme', async () => {
    const applyAppearance = jest.fn();
    const electronAPI = {
      getAlertPopupBootstrap: jest.fn(() =>
        Promise.resolve({ id: 'alert-popup-1', popup: doorbell, config: { ui: { theme: 'dark' } } })
      ),
      alertPopupAction: jest.fn(() => Promise.resolve({ success: true })),
      onAlertPopupUpdate: jest.fn(),
    };
    card = await initializeAlertPopup({ electronAPI, applyAppearance });
    expect(document.body.classList.contains('alert-popup-mode')).toBe(true);
    expect(applyAppearance).toHaveBeenCalledWith({ ui: { theme: 'dark' } });
    expect(document.querySelector('.alert-popup-title').textContent).toBe('Front Doorbell');

    const [listener] = electronAPI.onAlertPopupUpdate.mock.calls[0];
    listener({ id: 'alert-popup-2', popup: { ...doorbell, title: 'Someone else' } });
    expect(document.querySelector('.alert-popup-title').textContent).toBe('Front Doorbell');
    listener({ id: 'alert-popup-1', popup: { ...doorbell, title: 'Back Doorbell' } });
    expect(document.querySelector('.alert-popup-title').textContent).toBe('Back Doorbell');
  });

  it('closes a card that has nothing to show', async () => {
    const electronAPI = {
      getAlertPopupBootstrap: jest.fn(() => Promise.resolve({ success: false })),
      alertPopupAction: jest.fn(() => Promise.resolve({ success: true })),
    };
    await expect(initializeAlertPopup({ electronAPI })).resolves.toBe(null);
    expect(electronAPI.alertPopupAction).toHaveBeenCalledWith('dismiss');
  });
});

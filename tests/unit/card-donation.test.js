/**
 * @jest-environment node
 */

const { EventEmitter } = require('events');
const { createCardDonationFlow } = require('../../src/card-donation.cjs');

const SERVICE = 'https://donate.hadesktopwidget.com';
const CHECKOUT_URL = 'https://checkout.stripe.com/c/pay/cs_test_1';

function createFakeBrowserWindow() {
  const windows = [];
  class FakeBrowserWindow extends EventEmitter {
    constructor(options) {
      super();
      this.options = options;
      this.destroyed = false;
      this.visible = false;
      this.webContents = new EventEmitter();
      this.webContents.session = {
        setPermissionRequestHandler: jest.fn((handler) => {
          this.permissionRequestHandler = handler;
        }),
        setPermissionCheckHandler: jest.fn((handler) => {
          this.permissionCheckHandler = handler;
        }),
      };
      this.webContents.setWindowOpenHandler = (handler) => {
        this.windowOpenHandler = handler;
      };
      this.loadURL = jest.fn(async () => {});
      windows.push(this);
    }

    isDestroyed() {
      return this.destroyed;
    }

    show() {
      this.visible = true;
    }

    focus() {}

    removeMenu() {}

    close() {
      if (this.destroyed) return;
      this.destroyed = true;
      this.emit('closed');
    }

    /** Fires a navigation event the way Electron would; returns whether it was stopped. */
    navigate(eventName, url, ...rest) {
      const event = { preventDefault: jest.fn() };
      this.webContents.emit(eventName, event, url, ...rest);
      return event.preventDefault.mock.calls.length > 0;
    }
  }
  return { FakeBrowserWindow, windows };
}

function setup({ fetchImpl } = {}) {
  const { FakeBrowserWindow, windows } = createFakeBrowserWindow();
  const openExternal = jest.fn(async () => {});
  const log = { warn: jest.fn() };
  const fetchMock =
    fetchImpl || jest.fn(async () => new Response(JSON.stringify({ url: CHECKOUT_URL })));
  const flow = createCardDonationFlow({
    BrowserWindow: FakeBrowserWindow,
    fetchImpl: fetchMock,
    openExternal,
    log,
  });
  return { flow, windows, openExternal, fetchMock, log };
}

const flushPromises = () => new Promise((resolve) => setImmediate(resolve));

describe('card donation flow', () => {
  test('opens Stripe checkout in a sandboxed window with no preload and its own session', async () => {
    const { flow, windows, fetchMock } = setup();
    const result = flow.start({ amount: 10, locale: 'de', windowOptions: { title: 'Donate' } });
    await flushPromises();

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(`${SERVICE}/v1/checkout`);
    expect(JSON.parse(init.body)).toEqual({ amount: 10, locale: 'de' });

    const [win] = windows;
    expect(win.options.title).toBe('Donate');
    expect(win.options.webPreferences).toEqual(
      expect.objectContaining({
        sandbox: true,
        contextIsolation: true,
        nodeIntegration: false,
        partition: 'donate-checkout',
      })
    );
    expect(win.options.webPreferences.preload).toBeUndefined();
    expect(win.loadURL).toHaveBeenCalledWith(CHECKOUT_URL);
    const permission = jest.fn();
    win.permissionRequestHandler(null, 'payment-handler', permission);
    expect(permission).toHaveBeenCalledWith(false);
    expect(win.permissionCheckHandler()).toBe(false);

    win.close();
    await expect(result).resolves.toEqual({ status: 'cancelled' });
  });

  test('closes the window and reports a paid donation when Stripe returns to the Worker', async () => {
    const { flow, windows } = setup();
    const result = flow.start({ amount: 5 });
    await flushPromises();
    const [win] = windows;

    expect(win.navigate('will-navigate', `${SERVICE}/v1/return?result=complete`)).toBe(true);
    await expect(result).resolves.toEqual({ status: 'complete' });
    expect(win.isDestroyed()).toBe(true);
    expect(flow.isBusy()).toBe(false);
  });

  test('reports a cancel from the return page, a server redirect included', async () => {
    const { flow, windows } = setup();
    const result = flow.start({ amount: 5 });
    await flushPromises();

    windows[0].navigate('will-redirect', `${SERVICE}/v1/return?result=cancelled`, false, true);
    await expect(result).resolves.toEqual({ status: 'cancelled' });
  });

  test('stays on Stripe pages, sends anything else to the browser, and leaves frames alone', async () => {
    const { flow, windows, openExternal } = setup();
    flow.start({ amount: 5 });
    await flushPromises();
    const [win] = windows;

    expect(win.navigate('will-navigate', 'https://checkout.stripe.com/c/pay/cs_test_2')).toBe(
      false
    );
    expect(win.navigate('will-navigate', 'https://example.com/phish')).toBe(true);
    expect(openExternal).toHaveBeenCalledWith('https://example.com/phish');
    expect(win.navigate('will-navigate', 'file:///etc/passwd')).toBe(true);
    expect(openExternal).toHaveBeenCalledTimes(1);
    // 3-D Secure passes through the card issuer's site inside a frame.
    expect(win.navigate('will-redirect', 'https://acs.bank.example/3ds', false, false)).toBe(false);
    // A look-alike of the return page on another host is just another outside page.
    expect(win.navigate('will-navigate', 'https://evil.example/v1/return?result=complete')).toBe(
      true
    );

    expect(win.windowOpenHandler({ url: 'https://stripe.com/legal' })).toEqual({ action: 'deny' });
    expect(openExternal).toHaveBeenLastCalledWith('https://stripe.com/legal');
    expect(win.isDestroyed()).toBe(false);
  });

  test('reports a checkout page that never loaded as a failure', async () => {
    const { flow, windows } = setup();
    const result = flow.start({ amount: 5 });
    await flushPromises();
    const [win] = windows;

    win.webContents.emit(
      'did-fail-load',
      {},
      -106,
      'ERR_INTERNET_DISCONNECTED',
      CHECKOUT_URL,
      true
    );
    await expect(result).resolves.toEqual({ status: 'failed' });
    expect(win.isDestroyed()).toBe(true);
  });

  test('keeps a loaded checkout open when a later load fails', async () => {
    const { flow, windows } = setup();
    flow.start({ amount: 5 });
    await flushPromises();
    const [win] = windows;

    win.webContents.emit('did-finish-load');
    win.webContents.emit(
      'did-fail-load',
      {},
      -106,
      'ERR_INTERNET_DISCONNECTED',
      CHECKOUT_URL,
      true
    );
    expect(win.isDestroyed()).toBe(false);
  });

  test('brings an open checkout forward instead of starting a second one', async () => {
    const { flow, windows, fetchMock } = setup();
    flow.start({ amount: 5 });
    await flushPromises();

    await expect(flow.start({ amount: 5 })).resolves.toEqual({ status: 'already-open' });
    expect(windows).toHaveLength(1);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  test('fails without a window when the service is down or answers with something else', async () => {
    const down = setup({ fetchImpl: jest.fn(async () => new Response(null, { status: 503 })) });
    await expect(down.flow.start({ amount: 5 })).resolves.toEqual(
      expect.objectContaining({ status: 'failed' })
    );
    expect(down.windows).toHaveLength(0);

    const elsewhere = setup({
      fetchImpl: jest.fn(
        async () => new Response(JSON.stringify({ url: 'https://evil.example/checkout' }))
      ),
    });
    await expect(elsewhere.flow.start({ amount: 5 })).resolves.toEqual(
      expect.objectContaining({ status: 'failed' })
    );
    expect(elsewhere.windows).toHaveLength(0);
    // The flow is free again for the next try.
    expect(elsewhere.flow.isBusy()).toBe(false);
  });

  test('refuses an amount outside $1 to $12,000 without calling the service', async () => {
    const { flow, fetchMock } = setup();
    for (const amount of [0, 12001, 2.5, '5', undefined]) {
      await expect(flow.start({ amount })).resolves.toEqual(
        expect.objectContaining({ status: 'failed' })
      );
    }
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

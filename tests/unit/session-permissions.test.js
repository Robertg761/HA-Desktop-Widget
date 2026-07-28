/**
 * @jest-environment node
 */

const path = require('path');
const { EventEmitter } = require('events');
const {
  createRendererPermissionPolicy,
  installSessionPermissionPolicy,
  isTrustedRendererUrl,
} = require('../../src/session-permissions.cjs');

const RENDERER_ENTRY_PATH = path.resolve(__dirname, '../../index.html');
const RENDERER_URL = new URL(`file://${RENDERER_ENTRY_PATH}`).toString();

function createWebContents(url = RENDERER_URL) {
  return {
    getURL: jest.fn(() => url),
    isDestroyed: jest.fn(() => false),
  };
}

function createPermissionRequest(overrides = {}) {
  const webContents = overrides.webContents || createWebContents();
  return {
    webContents,
    permission: 'notifications',
    requestingOrigin: 'file://',
    details: {
      isMainFrame: true,
      requestingUrl: `${RENDERER_URL}?desktopPin=light.kitchen`,
    },
    ...overrides,
  };
}

describe('renderer session permission policy', () => {
  test('recognizes only the local renderer entry path, allowing its query string', () => {
    expect(
      isTrustedRendererUrl(`${RENDERER_URL}?desktopPin=light.kitchen`, RENDERER_ENTRY_PATH)
    ).toBe(true);
    expect(isTrustedRendererUrl('https://example.com/index.html', RENDERER_ENTRY_PATH)).toBe(false);
    expect(
      isTrustedRendererUrl(new URL('../package.json', RENDERER_URL).toString(), RENDERER_ENTRY_PATH)
    ).toBe(false);
  });

  test('allows notifications only for a trusted top-level renderer or pin page', () => {
    const trustedWebContents = new Set();
    const webContents = createWebContents();
    trustedWebContents.add(webContents);
    const isAllowed = createRendererPermissionPolicy({
      rendererEntryPath: RENDERER_ENTRY_PATH,
      isTrustedWebContents: (candidate) => trustedWebContents.has(candidate),
    });

    expect(isAllowed(createPermissionRequest({ webContents }))).toBe(true);
    expect(
      isAllowed(
        createPermissionRequest({
          webContents,
          details: { isMainFrame: false, requestingUrl: RENDERER_URL },
        })
      )
    ).toBe(false);
    expect(
      isAllowed(createPermissionRequest({ webContents, requestingOrigin: 'https://example.com' }))
    ).toBe(false);
  });

  test.each(['media', 'display-capture', 'geolocation', 'hid', 'serial', 'usb', 'clipboard-read'])(
    'denies %s even to a trusted renderer',
    (permission) => {
      const webContents = createWebContents();
      const isAllowed = createRendererPermissionPolicy({
        rendererEntryPath: RENDERER_ENTRY_PATH,
        isTrustedWebContents: (candidate) => candidate === webContents,
      });

      expect(isAllowed(createPermissionRequest({ webContents, permission }))).toBe(false);
    }
  );

  test('rejects untrusted, destroyed, remote, and sibling-file renderers', () => {
    const trustedWebContents = createWebContents();
    const isAllowed = createRendererPermissionPolicy({
      rendererEntryPath: RENDERER_ENTRY_PATH,
      isTrustedWebContents: (candidate) => candidate === trustedWebContents,
    });

    expect(isAllowed(createPermissionRequest())).toBe(false);
    trustedWebContents.isDestroyed.mockReturnValueOnce(true);
    expect(isAllowed(createPermissionRequest({ webContents: trustedWebContents }))).toBe(false);
    trustedWebContents.getURL.mockReturnValueOnce('https://example.com');
    expect(isAllowed(createPermissionRequest({ webContents: trustedWebContents }))).toBe(false);
    expect(
      isAllowed(
        createPermissionRequest({
          webContents: trustedWebContents,
          details: {
            isMainFrame: true,
            requestingUrl: new URL('../package.json', RENDERER_URL).toString(),
          },
        })
      )
    ).toBe(false);
  });

  test('installs check/request handlers and rejects device chooser paths', () => {
    const targetSession = new EventEmitter();
    targetSession.setPermissionCheckHandler = jest.fn((handler) => {
      targetSession.permissionCheckHandler = handler;
    });
    targetSession.setPermissionRequestHandler = jest.fn((handler) => {
      targetSession.permissionRequestHandler = handler;
    });
    targetSession.setDevicePermissionHandler = jest.fn((handler) => {
      targetSession.devicePermissionHandler = handler;
    });
    targetSession.setDisplayMediaRequestHandler = jest.fn((handler) => {
      targetSession.displayMediaRequestHandler = handler;
    });
    const webContents = createWebContents();

    installSessionPermissionPolicy(targetSession, {
      rendererEntryPath: RENDERER_ENTRY_PATH,
      isTrustedWebContents: (candidate) => candidate === webContents,
    });

    expect(
      targetSession.permissionCheckHandler(webContents, 'notifications', 'file://', {
        isMainFrame: true,
        requestingUrl: RENDERER_URL,
      })
    ).toBe(true);
    const permissionCallback = jest.fn();
    targetSession.permissionRequestHandler(webContents, 'media', permissionCallback, {
      isMainFrame: true,
      requestingUrl: RENDERER_URL,
      mediaTypes: ['audio', 'video'],
    });
    expect(permissionCallback).toHaveBeenCalledWith(false);
    expect(targetSession.devicePermissionHandler({ deviceType: 'usb' })).toBe(false);

    const displayCallback = jest.fn();
    targetSession.displayMediaRequestHandler({}, displayCallback);
    expect(displayCallback).toHaveBeenCalledWith({});

    const preventDefault = jest.fn();
    const hidCallback = jest.fn();
    targetSession.emit('select-hid-device', { preventDefault }, {}, hidCallback);
    expect(preventDefault).toHaveBeenCalled();
    expect(hidCallback).toHaveBeenCalledWith();

    const serialCallback = jest.fn();
    targetSession.emit('select-serial-port', { preventDefault }, [], webContents, serialCallback);
    expect(serialCallback).toHaveBeenCalledWith('');

    const usbCallback = jest.fn();
    targetSession.emit('select-usb-device', { preventDefault }, {}, usbCallback);
    expect(usbCallback).toHaveBeenCalledWith();
  });
});

const path = require('path');
const { URL, fileURLToPath } = require('url');

const ALLOWED_RENDERER_PERMISSION = 'notifications';

function isTrustedRendererUrl(rawUrl, rendererEntryPath) {
  if (typeof rawUrl !== 'string' || !rawUrl || !rendererEntryPath) return false;

  try {
    const parsed = new URL(rawUrl);
    if (parsed.protocol !== 'file:') return false;
    return path.resolve(fileURLToPath(parsed)) === path.resolve(rendererEntryPath);
  } catch {
    return false;
  }
}

function isLocalFileOrigin(rawOrigin) {
  if (rawOrigin === undefined || rawOrigin === null || rawOrigin === '') return true;
  try {
    return new URL(rawOrigin).protocol === 'file:';
  } catch {
    return false;
  }
}

function createRendererPermissionPolicy(options = {}) {
  const { rendererEntryPath, isTrustedWebContents = () => false } = options;

  return ({
    webContents,
    permission,
    requestingOrigin = '',
    details = {},
    isPermissionCheck = false,
  } = {}) => {
    if (permission !== ALLOWED_RENDERER_PERMISSION) return false;
    if (details?.isMainFrame !== true) return false;

    if (webContents === null) {
      // Electron always supplies null WebContents for notification permission checks.
      // Only the check handler may rely solely on the validated frame/origin details.
      if (!isPermissionCheck) return false;
    } else {
      if (!webContents) return false;
      try {
        if (!isTrustedWebContents(webContents)) return false;
        if (webContents.isDestroyed?.()) return false;
        if (!isTrustedRendererUrl(webContents.getURL?.(), rendererEntryPath)) return false;
      } catch {
        return false;
      }
    }

    if (!isTrustedRendererUrl(details?.requestingUrl, rendererEntryPath)) return false;
    if (!isLocalFileOrigin(requestingOrigin)) return false;
    if (!isLocalFileOrigin(details?.embeddingOrigin)) return false;
    if (!isLocalFileOrigin(details?.securityOrigin)) return false;
    return true;
  };
}

function installSessionPermissionPolicy(targetSession, options = {}) {
  if (
    !targetSession ||
    typeof targetSession.setPermissionCheckHandler !== 'function' ||
    typeof targetSession.setPermissionRequestHandler !== 'function'
  ) {
    throw new TypeError('An Electron session with permission handlers is required');
  }

  const isAllowed = createRendererPermissionPolicy(options);

  targetSession.setPermissionCheckHandler((webContents, permission, requestingOrigin, details) =>
    isAllowed({
      webContents,
      permission,
      requestingOrigin,
      details,
      isPermissionCheck: true,
    })
  );
  targetSession.setPermissionRequestHandler((webContents, permission, callback, details) => {
    callback(
      isAllowed({
        webContents,
        permission,
        requestingOrigin: details?.securityOrigin || '',
        details,
      })
    );
  });

  // HID/serial/USB grants can be remembered independently of ordinary permission
  // prompts, so reject those checks explicitly as well.
  targetSession.setDevicePermissionHandler?.(() => false);

  // Screen capture has its own request hook. An empty stream selection rejects it.
  targetSession.setDisplayMediaRequestHandler?.((_request, callback) => callback({}));

  // Prevent Electron from opening or auto-selecting hardware chooser entries. None of
  // these capabilities are part of the widget's feature set.
  targetSession.on?.('select-hid-device', (event, _details, callback) => {
    event?.preventDefault?.();
    callback();
  });
  targetSession.on?.('select-serial-port', (event, _ports, _webContents, callback) => {
    event?.preventDefault?.();
    callback('');
  });
  targetSession.on?.('select-usb-device', (event, _details, callback) => {
    event?.preventDefault?.();
    callback();
  });

  return isAllowed;
}

module.exports = {
  ALLOWED_RENDERER_PERMISSION,
  createRendererPermissionPolicy,
  installSessionPermissionPolicy,
  isTrustedRendererUrl,
};

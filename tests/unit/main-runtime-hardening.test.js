const fs = require('fs');
const path = require('path');

const mainSource = fs.readFileSync(path.resolve(__dirname, '../../main.js'), 'utf8');
const preloadSource = fs.readFileSync(path.resolve(__dirname, '../../preload.js'), 'utf8');

describe('main-process runtime hardening', () => {
  it('denies renderer-created windows and routes http/https navigation externally', () => {
    expect(mainSource).toContain('function hardenRendererNavigation');
    expect(mainSource).toContain('setWindowOpenHandler');
    expect(mainSource).toContain("return { action: 'deny' }");
    expect(mainSource).toContain("webContents.on('will-navigate'");
    expect(mainSource).toContain('routeExternalHttpLink(url)');
    expect(mainSource).toContain('shell.openExternal');
  });

  it('exposes and handles a correlated desktop-pin action response channel', () => {
    expect(preloadSource).toContain('respondDesktopPinActionRequest');
    expect(preloadSource).toContain("ipcRenderer.invoke('desktop-pin-action-response'");
    expect(mainSource).toContain("ipcMain.handle('desktop-pin-action-response'");
    expect(mainSource).toContain('pendingDesktopPinActionRequests');
    expect(mainSource).toContain("awaitResponse: normalizedAction === 'service-call'");
  });

  it('limits media artwork proxy responses to image content within a bounded size', () => {
    expect(mainSource).toContain('MEDIA_ARTWORK_MAX_RESPONSE_BYTES');
    expect(mainSource).toContain('isPotentialMediaArtworkContentType');
    expect(mainSource).toContain('resolveMediaArtworkContentType');
    expect(mainSource).toContain('MEDIA_ARTWORK_TOO_LARGE');
    expect(mainSource).toContain('MEDIA_ARTWORK_UNSUPPORTED_TYPE');
    expect(mainSource).toContain("host === 'media_artwork'");
  });
});

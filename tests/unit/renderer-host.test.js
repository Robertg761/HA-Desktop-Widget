/**
 * @jest-environment jsdom
 */

describe('renderer host seam', () => {
  afterEach(() => {
    jest.resetModules();
    delete window.electronAPI;
  });

  test('an explicitly injected host wins over the ambient electronAPI', () => {
    const { setRendererHost, getRendererHost } = require('@hadw/renderer/host.js');
    const host = { capabilities: { isPreview: true } };
    window.electronAPI = { updateConfig: jest.fn() };
    setRendererHost(host);
    expect(getRendererHost()).toBe(host);
    setRendererHost(null);
    expect(getRendererHost()).not.toBe(host);
  });

  test('ambient fallback wraps the current window.electronAPI at call time', async () => {
    const { getRendererHost } = require('@hadw/renderer/host.js');
    const first = { updateConfig: jest.fn(async () => ({ success: true, config: {} })) };
    window.electronAPI = first;
    await getRendererHost().updateConfig({ opacity: 0.9 });
    expect(first.updateConfig).toHaveBeenCalledWith({ opacity: 0.9 });

    const second = { updateConfig: jest.fn(async () => ({ success: true, config: {} })) };
    window.electronAPI = second;
    await getRendererHost().updateConfig({ opacity: 0.8 });
    expect(second.updateConfig).toHaveBeenCalledWith({ opacity: 0.8 });
    expect(first.updateConfig).toHaveBeenCalledTimes(1);
  });

  test('null host is browser-safe and renders no desktop surface', async () => {
    const { getRendererHost } = require('@hadw/renderer/host.js');
    const host = getRendererHost();
    expect(host.capabilities.isElectron).toBe(false);
    expect(host.canPersistConfig).toBe(false);
    expect(host.showEntityContextMenu).toBeNull();
    expect(host.resolveMediaUrl({ kind: 'camera_snapshot', entityId: 'camera.x' })).toBe('');
    await expect(host.updateConfig({})).resolves.toEqual({ success: true });
    expect(host.onConfigUpdated(() => {})()).toBeUndefined();
  });

  test('electron host resolves media specs to the ha:// protocol', () => {
    const { createElectronHost } = require('@hadw/renderer/electron-host.js');
    const host = createElectronHost({ updateConfig: jest.fn() });
    expect(
      host.resolveMediaUrl({
        kind: 'camera_snapshot',
        entityId: 'camera.front door',
        preview: 3,
        cacheKey: 42,
      })
    ).toBe('ha://camera/camera.front%20door?preview=3&t=42');
    expect(host.resolveMediaUrl({ kind: 'camera_stream', entityId: 'camera.x', cacheKey: 7 })).toBe(
      'ha://camera_stream/camera.x?t=7'
    );
    expect(
      host.resolveMediaUrl({
        kind: 'camera_hls',
        path: '/api/hls/token/playlist.m3u8',
        search: '?a=1',
      })
    ).toBe('ha://hls/api/hls/token/playlist.m3u8?a=1');
    const artwork = host.resolveMediaUrl({
      kind: 'media_artwork',
      url: '/api/media_player_proxy/media_player.tv',
      cacheKey: 5,
    });
    expect(artwork.startsWith('ha://media_artwork/')).toBe(true);
    expect(artwork.endsWith('?t=5')).toBe(true);
    expect(host.resolveMediaUrl({ kind: 'unknown' })).toBe('');
    expect(host.canPersistConfig).toBe(true);
  });

  test('electron host forwards config and menu calls to the preload API', async () => {
    const { createElectronHost } = require('@hadw/renderer/electron-host.js');
    const api = {
      getConfig: jest.fn(async () => ({ opacity: 1 })),
      updateConfig: jest.fn(async () => ({ success: true })),
      onConfigUpdated: jest.fn(() => () => {}),
      debugLog: jest.fn(async () => {}),
      showEntityTileMenu: jest.fn(async () => {}),
    };
    const host = createElectronHost(api);
    expect(host.capabilities.isElectron).toBe(true);
    await host.getConfig();
    await host.updateConfig({ opacity: 0.7 });
    host.onConfigUpdated('cb');
    await host.debugLog({ event: 'x' });
    await host.showEntityContextMenu('light.desk', { supported: true });
    expect(api.getConfig).toHaveBeenCalled();
    expect(api.updateConfig).toHaveBeenCalledWith({ opacity: 0.7 });
    expect(api.onConfigUpdated).toHaveBeenCalledWith('cb');
    expect(api.debugLog).toHaveBeenCalledWith({ event: 'x' });
    expect(api.showEntityTileMenu).toHaveBeenCalledWith('light.desk', { supported: true });
  });
});

/**
 * RendererHost implementation backed by the Electron preload API.
 *
 * Media URLs resolve to the ha:// custom protocol served by the main
 * process, which owns Home Assistant authentication for camera and artwork
 * requests. Browser hosts resolve the same specs to Home Assistant's own
 * authenticated endpoints instead.
 */

import { base64Encode } from './utils.js';

function mediaQuery({ preview, cacheKey }) {
  const params = [];
  if (preview !== undefined) params.push(`preview=${encodeURIComponent(preview)}`);
  if (cacheKey !== undefined) params.push(`t=${encodeURIComponent(cacheKey)}`);
  return params.length ? `?${params.join('&')}` : '';
}

function createElectronHost(electronAPI) {
  return {
    capabilities: Object.freeze({
      isElectron: true,
      isPreview: false,
      supportsPins: true,
      supportsFrostedGlass: true,
      supportsDrag: true,
    }),
    canPersistConfig: typeof electronAPI.updateConfig === 'function',
    getConfig: () => electronAPI.getConfig(),
    updateConfig: (patch) => electronAPI.updateConfig(patch),
    onConfigUpdated: (callback) => electronAPI.onConfigUpdated(callback),
    debugLog: (...args) => electronAPI.debugLog?.(...args),
    showEntityContextMenu: (entityId, supportInfo) =>
      electronAPI.showEntityTileMenu(entityId, supportInfo),
    resolveMediaUrl(spec) {
      switch (spec?.kind) {
        case 'camera_snapshot':
          return `ha://camera/${encodeURIComponent(spec.entityId)}${mediaQuery(spec)}`;
        case 'camera_stream':
          return `ha://camera_stream/${encodeURIComponent(spec.entityId)}${mediaQuery(spec)}`;
        case 'camera_hls':
          return `ha://hls${spec.path}${spec.search || ''}`;
        case 'media_artwork':
          return `ha://media_artwork/${base64Encode(spec.url)}${mediaQuery(spec)}`;
        default:
          return '';
      }
    },
  };
}

export { createElectronHost };

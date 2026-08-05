/**
 * RendererHost: the seam between shared renderer code and its embedder.
 *
 * The Electron app injects a host wired to window.electronAPI; the Home
 * Assistant panel preview injects one wired to browser equivalents. Shared
 * modules must reach the desktop surface only through this interface —
 * never through window.electronAPI directly — so they stay browser-safe.
 */

import { createElectronHost } from './electron-host.js';

const NULL_CAPABILITIES = Object.freeze({
  isElectron: false,
  isPreview: true,
  supportsPins: false,
  supportsFrostedGlass: false,
  supportsDrag: false,
});

let activeHost = null;

/** A host that renders nothing desktop-specific; used by previews and tests. */
function createNullHost() {
  return {
    capabilities: NULL_CAPABILITIES,
    canPersistConfig: false,
    getConfig: async () => ({}),
    updateConfig: async () => ({ success: true }),
    replaceConfigEntityId: async () => ({ success: true }),
    onConfigUpdated: () => () => {},
    debugLog: () => {},
    showEntityContextMenu: null,
    resolveMediaUrl: () => '',
  };
}

function setRendererHost(host) {
  activeHost = host || null;
}

/**
 * Return the injected host. Without one, fall back to the ambient
 * window.electronAPI resolved at call time — this keeps the Electron app and
 * the existing test suites working before/without explicit injection.
 */
function getRendererHost() {
  if (activeHost) return activeHost;
  if (typeof window !== 'undefined' && window.electronAPI) {
    return createElectronHost(window.electronAPI);
  }
  return createNullHost();
}

export { createNullHost, getRendererHost, setRendererHost };

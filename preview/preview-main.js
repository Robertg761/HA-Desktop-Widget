/**
 * Home Assistant panel preview: the real desktop app on a virtual desktop.
 *
 * This page boots the widget's actual composition root (renderer.js) — so
 * every button, modal, and settings control is wired by the same code as the
 * desktop — against two thin virtual seams:
 *   - a virtual main process (window.electronAPI): config persists in memory
 *     and flows back through the app's own config-updated pipeline;
 *   - a virtual Home Assistant socket: authenticates instantly and answers
 *     bootstrap requests from states the parent panel provides.
 * Because only these seams are virtual, desktop app changes are reflected
 * here automatically on the next panel bundle build.
 */

import '@mdi/font/css/materialdesignicons.min.css';
import '../styles.css';
import Sortable from 'sortablejs';
import state from '@hadw/renderer/state.js';
import { buildProfileDocumentFromConfig } from '@hadw/renderer/profile-schema.js';
import websocket from '../src/websocket.js';
import * as ui from '../src/ui.js';
import configEntityReferences from '../src/config-entity-references.cjs';

const { replaceConfigEntityIdReferences } = configEntityReferences;

// --- virtual main process ---------------------------------------------------

let previewConfig = {
  homeAssistant: { url: 'http://preview.invalid:8123', token: 'preview', authMethod: 'token' },
  desktopCompanion: { desktopId: '' },
  globalHotkeys: { enabled: false, hotkeys: {} },
  entityAlerts: { enabled: false, alerts: {} },
  ui: {
    theme: 'auto',
    accent: 'original',
    background: 'original',
    language: 'auto',
    customColors: [],
    density: 'comfortable',
    activeTileGlow: true,
    use24HourClock: false,
    timeFormat: 'system',
    dateFormat: 'weekday-short',
    weatherEffectsEnabled: false,
    weatherOverride: 'auto',
  },
  primaryCards: ['weather', 'time'],
  favoriteEntities: [],
  customTabs: [],
  activeTabId: '',
  comparisonGraphs: [],
  desktopPins: {},
  customEntityIcons: {},
  quickAccessTileOptions: {},
  updates: { allowPrerelease: false },
  opacity: 0.95,
  frostedGlass: true,
};
let configRevision = 1;
const configListeners = new Set();
let notifyParent = () => {};
let suppressParentNotify = false;

function snapshotConfig() {
  return JSON.parse(JSON.stringify(previewConfig));
}

function currentDocument() {
  return buildProfileDocumentFromConfig(previewConfig);
}

async function virtualUpdateConfig(patch) {
  if (!patch || typeof patch !== 'object') return { success: false, error: 'Invalid config' };
  const cleaned = { ...patch };
  // Machine truths the virtual desktop owns.
  delete cleaned.configRevision;
  delete cleaned.developmentDemo;
  previewConfig = {
    ...previewConfig,
    ...cleaned,
    homeAssistant: previewConfig.homeAssistant,
    desktopCompanion: previewConfig.desktopCompanion,
    ui: { ...previewConfig.ui, ...(cleaned.ui || {}) },
    desktopPins: {},
  };
  configRevision += 1;
  const authoritative = { ...snapshotConfig(), configRevision };
  // The app's own pipeline (applyRendererConfig) re-themes from this event...
  for (const listener of [...configListeners]) {
    try {
      listener(authoritative);
    } catch (error) {
      console.warn('Preview config listener failed:', error?.message || error);
    }
  }
  // ...but tile re-renders flow through other desktop paths, so the virtual
  // desktop triggers the app's own render entry explicitly.
  for (const step of [
    () => ui.renderPrimaryCards(),
    () => ui.renderActiveTab(),
    () => ui.updateWeatherFromHA(),
    () => ui.updateTimeDisplay(),
    () => ui.updateMediaTile(),
  ]) {
    try {
      step();
    } catch (error) {
      console.warn('Preview render step failed:', error?.message || error);
    }
  }
  if (!suppressParentNotify) notifyParent();
  return { success: true, config: authoritative };
}

async function virtualReplaceConfigEntityId(oldEntityId, newEntityId) {
  const replacement = replaceConfigEntityIdReferences(previewConfig, oldEntityId, newEntityId);
  if (!replacement.changed) {
    return {
      success: true,
      changed: false,
      config: { ...snapshotConfig(), configRevision },
    };
  }
  const authoritative = await virtualUpdateConfig(replacement.config);
  return { success: true, changed: true, config: authoritative.config };
}

function installVirtualElectronApi() {
  const stubs = {
    platform: 'linux',
    getConfig: async () => ({ ...snapshotConfig(), configRevision }),
    updateConfig: virtualUpdateConfig,
    replaceConfigEntityId: virtualReplaceConfigEntityId,
    saveConfig: virtualUpdateConfig,
    onConfigUpdated: (callback) => {
      configListeners.add(callback);
      return () => configListeners.delete(callback);
    },
    signalRendererReady: async () => {},
    clearTokenResetReason: async () => {},
    getAppVersion: async () =>
      `${typeof __APP_VERSION__ === 'string' ? __APP_VERSION__ : 'dev'} (preview)`,
    getLoginItemSettings: async () => ({ openAtLogin: false }),
    setLoginItemSettings: async () => ({ success: true }),
    getWindowState: async () => ({ alwaysOnTop: false }),
    getProfileSyncStatus: async () => ({ enabled: false, provider: 'folder' }),
    getLocaleBootstrap: async () => null,
    getLocalePacks: async () => ({ packs: [] }),
    isPopupHotkeyAvailable: async () => false,
    getPopupHotkey: async () => '',
    validateHotkey: async () => ({ valid: false, error: 'Hotkeys are desktop-only' }),
    registerHotkeys: async () => ({ success: true, failed: [] }),
    getDesktopCompanionRegistration: async () => null,
    getDesktopCompanionState: async () => ({ visible: true, current_page: 'default' }),
    testHaConnection: async () => ({
      success: false,
      error: 'Connection settings live on the desktop',
    }),
    setOpacity: async () => {},
    previewWindowEffects: async () => {},
    setAlwaysOnTop: async () => {},
    debugLog: async () => {},
  };
  window.electronAPI = new Proxy(stubs, {
    get(target, prop) {
      if (prop in target) return target[prop];
      if (typeof prop === 'string' && prop.startsWith('on')) return () => () => {};
      return async () => ({ success: false, error: 'Not available in the preview' });
    },
  });
}

// --- virtual Home Assistant socket ------------------------------------------

function installVirtualSocket() {
  let connected = false;
  websocket.connect = () => {
    connected = true;
    websocket.ws = {
      readyState: typeof WebSocket !== 'undefined' ? WebSocket.OPEN : 1,
      send: (raw) => {
        try {
          const message = JSON.parse(raw);
          if (message.type === 'auth') {
            setTimeout(() => websocket.emit('message', { type: 'auth_ok' }), 0);
          }
        } catch {
          /* no-op */
        }
      },
      close: () => {},
    };
    setTimeout(() => websocket.emit('open'), 0);
  };
  websocket.isConnected = () => connected;
  websocket.close = () => {};
  let requestId = 1000;
  websocket.request = async (payload) => {
    const id = (requestId += 1);
    switch (payload?.type) {
      case 'get_states':
        return { id, success: true, result: Object.values(state.STATES || {}) };
      case 'get_services':
        return { id, success: true, result: {} };
      case 'get_config':
        return { id, success: true, result: { unit_system: { temperature: '°C' } } };
      case 'config/area_registry/list':
        return { id, success: true, result: [] };
      default:
        return { id, success: true, result: {} };
    }
  };
  websocket.subscribeMessage = () => () => {};
  websocket.callService = async () => ({ success: true, preview: true });
  websocket.callServiceWithResponse = async () => ({ success: true, response: {} });
}

// --- parent bridge ----------------------------------------------------------

async function applyProfile(profileDocument) {
  const document_ = profileDocument && typeof profileDocument === 'object' ? profileDocument : {};
  // Parent-initiated pushes are not user edits; don't echo them back.
  suppressParentNotify = true;
  try {
    return await virtualUpdateConfig({
      customTabs: [],
      activeTabId: '',
      favoriteEntities: [],
      comparisonGraphs: [],
      customEntityIcons: {},
      quickAccessTileOptions: {},
      ...document_,
    });
  } finally {
    suppressParentNotify = false;
  }
}

function setStates(entities) {
  state.setStates(entities && typeof entities === 'object' ? { ...entities } : {});
  suppressParentNotify = true;
  // Re-run the app's own render entry via a config echo (cheap, idempotent).
  void virtualUpdateConfig({}).finally(() => {
    suppressParentNotify = false;
  });
}

function setEntityState(entity) {
  if (!entity?.entity_id) return;
  state.setEntityState(entity);
  websocket.emit('message', {
    type: 'event',
    event: {
      event_type: 'state_changed',
      data: { entity_id: entity.entity_id, new_state: entity },
    },
  });
}

// --- WYSIWYG editing --------------------------------------------------------

const editState = { enabled: false, sortable: null, api: null };

function emitChange() {
  try {
    editState.api?.onDocumentChange?.(JSON.parse(JSON.stringify(currentDocument())));
  } catch (error) {
    console.warn('Preview change callback failed:', error?.message || error);
  }
}

function mutateActiveTab(mutate) {
  const document_ = currentDocument();
  const tab =
    (document_.customTabs || []).find((t) => t.id === document_.activeTabId) ||
    (document_.customTabs || [])[0];
  if (!tab) return false;
  mutate(tab, document_);
  void applyProfile(document_);
  return true;
}

function addEntity(entityId) {
  const cleanId = typeof entityId === 'string' ? entityId.trim().slice(0, 128) : '';
  if (!cleanId) return false;
  const added = mutateActiveTab((tab) => {
    if (!tab.entityIds.includes(cleanId)) tab.entityIds.push(cleanId);
  });
  if (added) return true;
  const document_ = currentDocument();
  document_.customTabs = [{ id: 'default', name: 'Home', entityIds: [cleanId] }];
  document_.activeTabId = 'default';
  void applyProfile(document_);
  return true;
}

function removeEntity(entityId) {
  return mutateActiveTab((tab) => {
    tab.entityIds = tab.entityIds.filter((id) => id !== entityId);
  });
}

function handleEditClick(event) {
  if (!editState.enabled) return;
  const tile = event.target.closest?.('.control-item');
  event.preventDefault();
  event.stopPropagation();
  if (!tile?.dataset.entityId) return;
  const rect = tile.getBoundingClientRect();
  if (event.clientX >= rect.right - 30 && event.clientY <= rect.top + 30) {
    removeEntity(tile.dataset.entityId);
  }
}

function setEditing(enabled) {
  const grid = document.getElementById('quick-controls');
  if (!grid) return false;
  editState.enabled = enabled === true;
  document.body.classList.toggle('hadw-editing', editState.enabled);
  if (editState.enabled && !editState.sortable) {
    editState.sortable = Sortable.create(grid, {
      animation: 120,
      onEnd: () => {
        const order = [...grid.querySelectorAll('.control-item[data-entity-id]')].map(
          (tile) => tile.dataset.entityId
        );
        mutateActiveTab((tab) => {
          tab.entityIds = order.filter((id) => tab.entityIds.includes(id));
        });
      },
    });
  } else if (!editState.enabled && editState.sortable) {
    editState.sortable.destroy();
    editState.sortable = null;
  }
  return editState.enabled;
}

const PREVIEW_STYLE = `
  /* Window chrome cannot act on an iframe; every settings tab stays 1:1. */
  .hadw-preview #minimize-btn, .hadw-preview #close-btn { display: none !important; }
  body.hadw-editing .control-item { cursor: grab; }
  body.hadw-editing .control-item::after {
    content: '\\2715'; position: absolute; top: 4px; right: 6px; width: 20px; height: 20px;
    display: flex; align-items: center; justify-content: center; font-size: 12px;
    border-radius: 50%; background: rgba(220, 60, 60, 0.85); color: #fff; z-index: 5;
  }
`;

function installPreviewApi() {
  const api = {
    ready: true,
    applyProfile,
    setStates,
    setEntityState,
    setEditing,
    addEntity,
    removeEntity,
    getDocument: currentDocument,
    onDocumentChange: null,
  };
  editState.api = api;
  notifyParent = emitChange;
  window.__hadwPreview = api;
  window.dispatchEvent(new CustomEvent('hadw-preview-ready'));
  return api;
}

function initPreview() {
  const style = document.createElement('style');
  style.textContent = PREVIEW_STYLE;
  document.head.appendChild(style);
  document.getElementById('quick-controls')?.addEventListener('click', handleEditClick, true);
  return installPreviewApi();
}

installVirtualElectronApi();
installVirtualSocket();

// Boot the real app. Its DOMContentLoaded handler wires every control exactly
// as on the desktop; module evaluation order guarantees our seams exist first.
import('../renderer.js')
  .then(() => {
    // The dynamic import can resolve after DOMContentLoaded already fired, in
    // which case the app's wiring listener would never run — replay it.
    if (document.readyState !== 'loading') {
      document.dispatchEvent(new Event('DOMContentLoaded', { bubbles: true }));
    }
    initPreview();
  })
  .catch((error) => {
    console.error('Preview failed to boot the renderer:', error);
    initPreview();
  });

export {
  applyProfile,
  currentDocument as getDocument,
  initPreview,
  installVirtualElectronApi,
  installVirtualSocket,
  setEntityState,
  setStates,
  virtualUpdateConfig,
};

/**
 * Bootstrap for the Home Assistant panel preview iframe.
 *
 * Runs the real widget renderer (ui.js and the shared @hadw/renderer modules)
 * against a profile document and entity states supplied by the parent panel.
 * The parent talks to `window.__hadwPreview`; this page never opens its own
 * Home Assistant connection and can never persist configuration.
 */

import '@mdi/font/css/materialdesignicons.min.css';
import '../styles.css';
import Sortable from 'sortablejs';
import state from '@hadw/renderer/state.js';
import { buildProfileDocumentFromConfig } from '@hadw/renderer/profile-schema.js';
import { setRendererHost } from '@hadw/renderer/host.js';
import { normalizeQuickAccessConfig } from '@hadw/renderer/quick-access-tabs.js';
import { normalizeComparisonGraphsConfig } from '@hadw/renderer/comparison-graphs.js';
import * as ui from '../src/ui.js';
import * as uiUtils from '../src/ui-utils.js';

const BASE_CONFIG = Object.freeze({
  homeAssistant: { url: '', token: '', authMethod: 'token' },
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
  opacity: 0.95,
  frostedGlass: true,
});

function createPreviewHost() {
  return {
    capabilities: Object.freeze({
      isElectron: false,
      isPreview: true,
      supportsPins: false,
      supportsFrostedGlass: false,
      supportsDrag: false,
    }),
    canPersistConfig: false,
    getConfig: async () => state.CONFIG,
    updateConfig: async () => ({ success: true, config: state.CONFIG }),
    onConfigUpdated: () => () => {},
    debugLog: () => {},
    showEntityContextMenu: null,
    resolveMediaUrl(spec) {
      // Same-origin Home Assistant URLs replace the desktop's ha:// protocol.
      if (spec?.kind === 'media_artwork') return spec.url || '';
      if (spec?.kind === 'camera_snapshot' || spec?.kind === 'camera_stream') {
        return state.STATES?.[spec.entityId]?.attributes?.entity_picture || '';
      }
      return '';
    },
  };
}

function buildPreviewConfig(profileDocument) {
  const document_ = profileDocument && typeof profileDocument === 'object' ? profileDocument : {};
  const merged = {
    ...BASE_CONFIG,
    ...document_,
    ui: { ...BASE_CONFIG.ui, ...(document_.ui || {}) },
    desktopPins: {},
  };
  return normalizeComparisonGraphsConfig(normalizeQuickAccessConfig(merged));
}

function renderAll() {
  const steps = [
    () => ui.renderPrimaryCards(),
    () => ui.renderActiveTab(),
    () => ui.updateWeatherFromHA(),
    () => ui.updateTimeDisplay(),
    () => ui.updateMediaTile(),
  ];
  for (const step of steps) {
    try {
      step();
    } catch (error) {
      console.warn('Preview render step failed:', error?.message || error);
    }
  }
}

function applyProfile(profileDocument) {
  const config = buildPreviewConfig(profileDocument);
  state.setConfig(config);
  try {
    uiUtils.applyTheme(config.ui?.theme || 'auto');
    uiUtils.setCustomThemes(config.ui?.customColors || []);
    uiUtils.applyAccentTheme(config.ui?.accent || 'original');
    uiUtils.applyBackgroundTheme(config.ui?.background || 'original');
    uiUtils.applyUiPreferences(config.ui || {});
    uiUtils.applyWindowEffects(config);
  } catch (error) {
    console.warn('Preview theme apply failed:', error?.message || error);
  }
  renderAll();
  return config;
}

function setStates(entities) {
  state.setStates(entities && typeof entities === 'object' ? entities : {});
  renderAll();
}

function setEntityState(entity) {
  if (!entity?.entity_id) return;
  state.setEntityState(entity);
  try {
    ui.updateEntityInUI(entity);
  } catch (error) {
    console.warn('Preview entity update failed:', error?.message || error);
  }
}

// --- WYSIWYG editing -------------------------------------------------------

const editState = { enabled: false, sortable: null, api: null };

function currentDocument() {
  return buildProfileDocumentFromConfig(state.CONFIG);
}

function emitChange() {
  const document_ = currentDocument();
  try {
    editState.api?.onDocumentChange?.(JSON.parse(JSON.stringify(document_)));
  } catch (error) {
    console.warn('Preview change callback failed:', error?.message || error);
  }
}

function activeTabOf(document_) {
  const tabs = Array.isArray(document_.customTabs) ? document_.customTabs : [];
  return tabs.find((tab) => tab.id === document_.activeTabId) || tabs[0] || null;
}

function mutateActiveTab(mutate) {
  const document_ = currentDocument();
  const tab = activeTabOf(document_);
  if (!tab) return false;
  mutate(tab, document_);
  applyProfile(document_);
  emitChange();
  return true;
}

function addEntity(entityId) {
  const cleanId = typeof entityId === 'string' ? entityId.trim().slice(0, 128) : '';
  if (!cleanId) return false;
  const added = mutateActiveTab((tab) => {
    if (!tab.entityIds.includes(cleanId)) tab.entityIds.push(cleanId);
  });
  if (added) return true;
  // A brand-new profile has no pages yet; start one with this entity.
  const document_ = currentDocument();
  document_.customTabs = [{ id: 'default', name: 'Home', entityIds: [cleanId] }];
  document_.activeTabId = 'default';
  applyProfile(document_);
  emitChange();
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
  // Block tile actions while editing; the top-right corner removes the tile.
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

const EDIT_STYLE = `
  body.hadw-editing .control-item { cursor: grab; }
  body.hadw-editing .control-item::after {
    content: '\\2715'; position: absolute; top: 4px; right: 6px; width: 20px; height: 20px;
    display: flex; align-items: center; justify-content: center; font-size: 12px;
    border-radius: 50%; background: rgba(220, 60, 60, 0.85); color: #fff; z-index: 5;
  }
`;

function initPreview() {
  setRendererHost(createPreviewHost());
  const style = document.createElement('style');
  style.textContent = EDIT_STYLE;
  document.head.appendChild(style);
  document.getElementById('quick-controls')?.addEventListener('click', handleEditClick, true);
  applyProfile({});
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
  window.__hadwPreview = api;
  window.dispatchEvent(new CustomEvent('hadw-preview-ready'));
  return api;
}

// In the built iframe page the skeleton is present when this module runs; the
// jsdom tests install the skeleton first and then call initPreview themselves.
if (typeof window !== 'undefined' && document.getElementById('quick-controls')) {
  initPreview();
}

export { applyProfile, buildPreviewConfig, createPreviewHost, initPreview, setStates };

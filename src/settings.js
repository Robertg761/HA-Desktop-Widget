const { ipcRenderer } = require('electron');
const state = require('./state.js');
const websocket = require('./websocket.js');
const { applyTheme, applyUiPreferences, trapFocus, releaseFocusTrap } = require('./ui-utils.js');
// Note: ui.js is not imported to prevent circular dependencies
// Functions like populateDomainFilters will be passed in from renderer.js if needed
const { toggleHotkeys } = require('./hotkeys.js');
const { toggleAlerts } = require('./alerts.js');

async function openSettings(uiHooks) {
  try {
    const modal = document.getElementById('settings-modal');
    if (!modal) return;

    // Populate fields
    const haUrl = document.getElementById('ha-url');
    const haToken = document.getElementById('ha-token');
    const updateInterval = document.getElementById('update-interval');
    const alwaysOnTop = document.getElementById('always-on-top');
    const opacitySlider = document.getElementById('opacity-slider');
    const opacityValue = document.getElementById('opacity-value');

    if (haUrl) haUrl.value = state.CONFIG.homeAssistant.url || '';
    if (haToken) haToken.value = state.CONFIG.homeAssistant.token || '';
    if (updateInterval) updateInterval.value = Math.max(1, Math.round((state.CONFIG.updateInterval || 5000) / 1000));
    if (alwaysOnTop) alwaysOnTop.checked = state.CONFIG.alwaysOnTop !== false;
    
    const safeOpacity = Math.max(0.2, Math.min(1, state.CONFIG.opacity || 0.95));
    if (opacitySlider) opacitySlider.value = safeOpacity;
    if (opacityValue) opacityValue.textContent = `${Math.round(safeOpacity * 100)}%`;

    const globalHotkeysEnabled = document.getElementById('global-hotkeys-enabled');
    if (globalHotkeysEnabled) {
      globalHotkeysEnabled.checked = !!(state.CONFIG.globalHotkeys && state.CONFIG.globalHotkeys.enabled);
      const hotkeysSection = document.getElementById('hotkeys-section');
      if (hotkeysSection) {
        hotkeysSection.style.display = globalHotkeysEnabled.checked ? 'block' : 'none';
      }
    }

    const entityAlertsEnabled = document.getElementById('entity-alerts-enabled');
    if (entityAlertsEnabled) {
      entityAlertsEnabled.checked = !!(state.CONFIG.entityAlerts && state.CONFIG.entityAlerts.enabled);
      const alertsSection = document.getElementById('alerts-section');
      if (alertsSection) {
        alertsSection.style.display = entityAlertsEnabled.checked ? 'block' : 'none';
      }
    }

    // Call UI hooks passed from renderer.js
    if (uiHooks) {
      uiHooks.populateDomainFilters();
      uiHooks.populateAreaFilter();
      uiHooks.setupEntitySearchInput('favorite-entities');
      uiHooks.setupEntitySearchInput('camera-entities', ['camera']);
      uiHooks.setupEntitySearchInput('motion-popup-cameras', ['camera']);
      uiHooks.initUpdateUI();
    }

    modal.classList.remove('hidden');
    modal.style.display = 'flex';
    trapFocus(modal);
  } catch (error) {
    console.error('Error opening settings:', error);
  }
}

function closeSettings() {
  try {
    const modal = document.getElementById('settings-modal');
    if (modal) {
      modal.classList.add('hidden');
      modal.style.display = 'none';
      releaseFocusTrap(modal);
    }
  } catch (error) {
    console.error('Error closing settings:', error);
  }
}

async function saveSettings() {
  try {
    const prevAlwaysOnTop = state.CONFIG.alwaysOnTop;

    const haUrl = document.getElementById('ha-url');
    const haToken = document.getElementById('ha-token');
    const updateInterval = document.getElementById('update-interval');
    const alwaysOnTop = document.getElementById('always-on-top');
    const opacitySlider = document.getElementById('opacity-slider');
    const globalHotkeysEnabled = document.getElementById('global-hotkeys-enabled');
    const entityAlertsEnabled = document.getElementById('entity-alerts-enabled');

    if (haUrl) state.CONFIG.homeAssistant.url = haUrl.value.trim();
    if (haToken) state.CONFIG.homeAssistant.token = haToken.value.trim();
    if (updateInterval) state.CONFIG.updateInterval = Math.max(1000, parseInt(updateInterval.value, 10) * 1000);
    if (alwaysOnTop) state.CONFIG.alwaysOnTop = alwaysOnTop.checked;
    if (opacitySlider) state.CONFIG.opacity = Math.max(0.2, Math.min(1, parseFloat(opacitySlider.value)));

    state.CONFIG.globalHotkeys = state.CONFIG.globalHotkeys || { enabled: false, hotkeys: {} };
    if (globalHotkeysEnabled) state.CONFIG.globalHotkeys.enabled = globalHotkeysEnabled.checked;

    state.CONFIG.entityAlerts = state.CONFIG.entityAlerts || { enabled: false, alerts: {} };
    if (entityAlertsEnabled) state.CONFIG.entityAlerts.enabled = entityAlertsEnabled.checked;

    const domainFilters = document.getElementById('domain-filters');
    if (domainFilters) {
      const checkboxes = domainFilters.querySelectorAll('input[type="checkbox"]');
      const newDomains = Array.from(checkboxes).filter(cb => cb.checked).map(cb => cb.value);
      const areaSelect = document.getElementById('area-select');
      const newAreas = areaSelect ? Array.from(areaSelect.selectedOptions).map(opt => opt.value) : [];
      state.setFilters({ ...state.FILTERS, domains: newDomains, areas: newAreas });
      state.CONFIG.filters = state.FILTERS;
    }

    await ipcRenderer.invoke('update-config', state.CONFIG);

    if (prevAlwaysOnTop !== state.CONFIG.alwaysOnTop) {
      const res = await ipcRenderer.invoke('set-always-on-top', state.CONFIG.alwaysOnTop);
      const windowState = await ipcRenderer.invoke('get-window-state');
      if (!res?.applied || windowState?.alwaysOnTop !== state.CONFIG.alwaysOnTop) {
        if (confirm('Changing "Always on top" may require a restart. Restart now?')) {
          await ipcRenderer.invoke('restart-app');
          return;
        }
      }
    }

    closeSettings();
    applyTheme(state.CONFIG.ui?.theme || 'auto');
    applyUiPreferences(state.CONFIG.ui || {});
    websocket.connect();
  } catch (error) {
    console.error('Failed to save config:', error);
  }
}

module.exports = {
    openSettings,
    closeSettings,
    saveSettings,
};

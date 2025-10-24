const { ipcRenderer } = require('electron');
const state = require('./state.js');
const websocket = require('./websocket.js');
const { applyTheme, applyUiPreferences, trapFocus, releaseFocusTrap } = require('./ui-utils.js');
// Note: ui.js is not imported to prevent circular dependencies
// Functions like populateDomainFilters will be passed in from renderer.js if needed

async function openSettings(uiHooks) {
  try {
    // Exit reorganize mode if active to prevent state conflicts
    if (uiHooks && uiHooks.exitReorganizeMode) {
      uiHooks.exitReorganizeMode();
    }
    
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

function openAlertsModal() {
  try {
    const modal = document.getElementById('alerts-modal');
    if (!modal) return;
    
    populateAlertsList();
    
    modal.classList.remove('hidden');
    modal.style.display = 'flex';
    trapFocus(modal);
  } catch (error) {
    console.error('Error opening alerts modal:', error);
  }
}

function closeAlertsModal() {
  try {
    const modal = document.getElementById('alerts-modal');
    if (modal) {
      modal.classList.add('hidden');
      modal.style.display = 'none';
      releaseFocusTrap(modal);
    }
  } catch (error) {
    console.error('Error closing alerts modal:', error);
  }
}

function populateAlertsList() {
  try {
    const alertsList = document.getElementById('alerts-list');
    if (!alertsList) return;
    
    alertsList.innerHTML = '';
    
    const alerts = state.CONFIG.entityAlerts?.alerts || {};
    const utils = require('./utils.js');
    
    // Show message if no alerts
    if (Object.keys(alerts).length === 0) {
      const noAlertsMsg = document.createElement('div');
      noAlertsMsg.className = 'no-alerts-message';
      noAlertsMsg.textContent = 'No alerts configured yet. Click the button below to add your first alert.';
      alertsList.appendChild(noAlertsMsg);
    }
    
    // Add existing alerts
    Object.keys(alerts).forEach(entityId => {
      const entity = state.STATES[entityId];
      if (!entity) return;
      
      const alertItem = document.createElement('div');
      alertItem.className = 'alert-item';
      
      const alertConfig = alerts[entityId];
      let alertType = alertConfig.onStateChange ? 'State Change' : 'Specific State';
      if (alertConfig.onSpecificState) {
        alertType += ` (${alertConfig.targetState})`;
      }
      
      alertItem.innerHTML = `
        <div class="alert-item-info">
          <span class="alert-icon">${utils.getEntityIcon(entity)}</span>
          <div class="alert-details">
            <span class="alert-name">${utils.getEntityDisplayName(entity)}</span>
            <span class="alert-type">${alertType}</span>
          </div>
        </div>
        <div class="alert-actions">
          <button class="btn btn-small btn-secondary edit-alert" data-entity="${entityId}">Edit</button>
          <button class="btn btn-small btn-danger remove-alert" data-entity="${entityId}">Remove</button>
        </div>
      `;
      
      alertsList.appendChild(alertItem);
    });
    
    // Add "Add new alert" button
    const addButton = document.createElement('button');
    addButton.className = 'btn btn-secondary btn-block add-alert-btn';
    addButton.textContent = '+ Add New Alert';
    addButton.onclick = () => openAlertConfigModal();
    alertsList.appendChild(addButton);
    
    // Wire up event handlers
    alertsList.querySelectorAll('.edit-alert').forEach(btn => {
      btn.onclick = () => openAlertConfigModal(btn.dataset.entity);
    });
    
    alertsList.querySelectorAll('.remove-alert').forEach(btn => {
      btn.onclick = () => removeAlert(btn.dataset.entity);
    });
    
    // Search functionality - always set up
    const searchInput = document.getElementById('alert-search');
    if (searchInput) {
      // Clear previous handler
      searchInput.oninput = null;
      searchInput.value = '';
      
      searchInput.oninput = (e) => {
        const query = e.target.value.toLowerCase();
        alertsList.querySelectorAll('.alert-item').forEach(item => {
          const name = item.querySelector('.alert-name')?.textContent.toLowerCase() || '';
          item.style.display = name.includes(query) ? 'flex' : 'none';
        });
        // Don't hide the add button or no alerts message
        const addBtn = alertsList.querySelector('.add-alert-btn');
        const noMsg = alertsList.querySelector('.no-alerts-message');
        if (addBtn) addBtn.style.display = 'block';
        if (noMsg) noMsg.style.display = 'block';
      };
    }
  } catch (error) {
    console.error('Error populating alerts list:', error);
  }
}

let currentAlertEntity = null;

function openAlertConfigModal(entityId = null) {
  try {
    const modal = document.getElementById('alert-config-modal');
    if (!modal) return;
    
    currentAlertEntity = entityId;
    
    const stateChangeRadio = modal.querySelector('input[value="state-change"]');
    const specificStateRadio = modal.querySelector('input[value="specific-state"]');
    const specificStateGroup = document.getElementById('specific-state-group');
    const targetStateInput = document.getElementById('target-state-input');
    const title = document.getElementById('alert-config-title');
    
    // If editing existing alert
    if (entityId) {
      const alertConfig = state.CONFIG.entityAlerts?.alerts[entityId];
      const entity = state.STATES[entityId];
      const utils = require('./utils.js');
      
      if (title) title.textContent = `Configure Alert - ${entity ? utils.getEntityDisplayName(entity) : entityId}`;
      
      if (alertConfig) {
        if (alertConfig.onStateChange) {
          if (stateChangeRadio) stateChangeRadio.checked = true;
          if (specificStateGroup) specificStateGroup.style.display = 'none';
        } else if (alertConfig.onSpecificState) {
          if (specificStateRadio) specificStateRadio.checked = true;
          if (specificStateGroup) specificStateGroup.style.display = 'block';
          if (targetStateInput) targetStateInput.value = alertConfig.targetState || '';
        }
      }
    } else {
      // New alert - show entity selector in the modal
      if (title) title.textContent = 'Configure Alert - Select Entity';
      
      // Create entity selector
      const modalBody = modal.querySelector('.modal-body');
      if (modalBody) {
        // Add entity selector as the first element
        let entitySelectGroup = modal.querySelector('.entity-select-group');
        if (!entitySelectGroup) {
          entitySelectGroup = document.createElement('div');
          entitySelectGroup.className = 'form-group entity-select-group';
          entitySelectGroup.innerHTML = `
            <label for="alert-entity-select">Select Entity:</label>
            <select id="alert-entity-select" class="form-control">
              <option value="">-- Choose an entity --</option>
            </select>
          `;
          modalBody.insertBefore(entitySelectGroup, modalBody.firstChild);
          
          // Populate with all entities
          const entitySelect = entitySelectGroup.querySelector('#alert-entity-select');
          const utils = require('./utils.js');
          
          Object.values(state.STATES)
            .filter(e => !e.entity_id.startsWith('sun.') && !e.entity_id.startsWith('zone.'))
            .sort((a, b) => utils.getEntityDisplayName(a).localeCompare(utils.getEntityDisplayName(b)))
            .forEach(entity => {
              const option = document.createElement('option');
              option.value = entity.entity_id;
              option.textContent = `${utils.getEntityIcon(entity)} ${utils.getEntityDisplayName(entity)}`;
              entitySelect.appendChild(option);
            });
          
          // Update currentAlertEntity when selection changes
          entitySelect.onchange = (e) => {
            currentAlertEntity = e.target.value;
          };
        }
      }
    }
    
    // Radio button handlers
    if (stateChangeRadio) {
      stateChangeRadio.onchange = () => {
        if (specificStateGroup) specificStateGroup.style.display = 'none';
      };
    }
    
    if (specificStateRadio) {
      specificStateRadio.onchange = () => {
        if (specificStateGroup) specificStateGroup.style.display = 'block';
      };
    }
    
    modal.classList.remove('hidden');
    modal.style.display = 'flex';
    trapFocus(modal);
  } catch (error) {
    console.error('Error opening alert config modal:', error);
  }
}

function closeAlertConfigModal() {
  try {
    const modal = document.getElementById('alert-config-modal');
    if (modal) {
      // Remove entity selector if it exists
      const entitySelectGroup = modal.querySelector('.entity-select-group');
      if (entitySelectGroup) {
        entitySelectGroup.remove();
      }
      
      modal.classList.add('hidden');
      modal.style.display = 'none';
      releaseFocusTrap(modal);
      currentAlertEntity = null;
    }
  } catch (error) {
    console.error('Error closing alert config modal:', error);
  }
}

async function saveAlert() {
  try {
    if (!currentAlertEntity) return;
    
    const modal = document.getElementById('alert-config-modal');
    const stateChangeRadio = modal.querySelector('input[value="state-change"]');
    const specificStateRadio = modal.querySelector('input[value="specific-state"]');
    const targetStateInput = document.getElementById('target-state-input');
    
    state.CONFIG.entityAlerts = state.CONFIG.entityAlerts || { enabled: false, alerts: {} };
    
    const alertConfig = {
      onStateChange: stateChangeRadio?.checked || false,
      onSpecificState: specificStateRadio?.checked || false,
      targetState: targetStateInput?.value.trim() || ''
    };
    
    state.CONFIG.entityAlerts.alerts[currentAlertEntity] = alertConfig;
    
    await ipcRenderer.invoke('update-config', state.CONFIG);
    
    closeAlertConfigModal();
    populateAlertsList();
    
    const { showToast } = require('./ui-utils.js');
    showToast('Alert saved successfully', 'success', 2000);
  } catch (error) {
    console.error('Error saving alert:', error);
    const { showToast } = require('./ui-utils.js');
    showToast('Error saving alert', 'error', 2000);
  }
}

async function removeAlert(entityId) {
  try {
    if (!confirm('Remove this alert?')) return;
    
    if (state.CONFIG.entityAlerts?.alerts[entityId]) {
      delete state.CONFIG.entityAlerts.alerts[entityId];
      await ipcRenderer.invoke('update-config', state.CONFIG);
      populateAlertsList();
      
      const { showToast } = require('./ui-utils.js');
      showToast('Alert removed', 'success', 2000);
    }
  } catch (error) {
    console.error('Error removing alert:', error);
    const { showToast } = require('./ui-utils.js');
    showToast('Error removing alert', 'error', 2000);
  }
}

module.exports = {
    openSettings,
    closeSettings,
    saveSettings,
    openAlertsModal,
    closeAlertsModal,
    openAlertConfigModal,
    closeAlertConfigModal,
    saveAlert,
};

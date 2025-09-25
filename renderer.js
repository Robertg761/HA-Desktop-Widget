// IMMEDIATE LOG - FIRST THING IN FILE
console.log('RENDERER.JS FILE IS BEING EXECUTED!');

console.log('=== RENDERER.JS LOADING ===');

// Load all required modules
console.log('Loading modules...');
try {
  const { ipcRenderer } = require('electron');
  console.log('ipcRenderer loaded');

  const state = require('./src/state.js');
  console.log('state loaded');

  const websocket = require('./src/websocket.js');
  console.log('websocket loaded');

  const hotkeys = require('./src/hotkeys.js');
  console.log('hotkeys loaded');

  const alerts = require('./src/alerts.js');
  console.log('alerts loaded');

  const ui = require('./src/ui.js');
  console.log('ui loaded');

  const settings = require('./src/settings.js');
  console.log('settings loaded');

  const uiUtils = require('./src/ui-utils.js');
  console.log('uiUtils loaded');
} catch (error) {
  console.error('Error loading modules:', error);
  console.error('Error stack:', error.stack);
}

console.log('All modules loaded successfully');

// Test if modules loaded correctly
console.log('Testing module functions:');
console.log('state.setConfig exists:', typeof state.setConfig === 'function');
console.log('websocket.connect exists:', typeof websocket.connect === 'function');
console.log('ui.renderActiveTab exists:', typeof ui.renderActiveTab === 'function');
console.log('uiUtils.showLoading exists:', typeof uiUtils.showLoading === 'function');

// --- WebSocket Event Handlers ---
websocket.on('open', () => {
  try {
    console.log('WebSocket connected - sending authentication');
    if (websocket.ws && websocket.ws.readyState === WebSocket.OPEN) {
      const authMessage = {
        type: 'auth',
        access_token: state.CONFIG.homeAssistant.token
      };
      console.log('Sending auth message:', authMessage);
      websocket.ws.send(JSON.stringify(authMessage));
    }
  } catch (error) {
    console.error('Error handling WebSocket open:', error);
  }
});

websocket.on('message', (msg) => {
  try {
    console.log('WebSocket message received:', msg.type, msg);
    if (msg.type === 'auth_ok') {
      console.log('WebSocket authenticated successfully');
      uiUtils.setStatus(true);
      websocket.request({ type: 'get_states' });
      websocket.request({ type: 'get_services' });
      websocket.request({ type: 'config/area_registry/list' });
      websocket.request({ type: 'subscribe_events', event_type: 'state_changed' });
    } else if (msg.type === 'auth_invalid') {
      console.error('Invalid authentication token');
      uiUtils.setStatus(false);
      uiUtils.showLoading(false);
    } else if (msg.type === 'event' && msg.event?.event_type === 'state_changed') {
      const entity = msg.event.data.new_state;
      if (entity) {
        state.setStates({ ...state.STATES, [entity.entity_id]: entity });
        ui.updateEntityInUI(entity);
        alerts.checkEntityAlerts(entity.entity_id, entity.state);
      }
    } else if (msg.type === 'result' && msg.result) {
      if (msg.id === 1) { // Corresponds to get_states
        const newStates = {};
        if (Array.isArray(msg.result)) {
          msg.result.forEach(entity => { newStates[entity.entity_id] = entity; });
          state.setStates(newStates);
          
          // This is the correct place to render and hide loading
          ui.renderActiveTab();
          uiUtils.showLoading(false);
          
          alerts.initializeEntityAlerts();
        }
      } else if (msg.id === 2) { // get_services
        state.setServices(msg.result);
      } else if (msg.id === 3) { // get_areas
          const newAreas = {};
          if (Array.isArray(msg.result)) {
            msg.result.forEach(area => { newAreas[area.area_id] = area; });
            state.setAreas(newAreas);
          }
      }
    }
  } catch (error) {
    console.error('Error handling WebSocket message:', error);
  }
});

websocket.on('close', () => {
  try {
    console.log('WebSocket disconnected');
    uiUtils.setStatus(false);
    uiUtils.showLoading(false); // Hide loading on failure
    setTimeout(() => websocket.connect(), 5000);
  } catch (error) {
    console.error('Error handling WebSocket close:', error);
  }
});

websocket.on('error', (error) => {
  try {
    console.error('WebSocket error:', error);
    uiUtils.setStatus(false);
    uiUtils.showLoading(false); // Hide loading on failure
    
    // Show the UI with setup message
    ui.renderActiveTab();
  } catch (err) {
    console.error('Error handling WebSocket error:', err);
  }
});

// A simple function to add a debug message to the screen
function visualLog(message, isError = false) {
  try {
    let debugPanel = document.getElementById('visual-debug-panel');
    if (!debugPanel) {
      debugPanel = document.createElement('div');
      debugPanel.id = 'visual-debug-panel';
      debugPanel.style.cssText = `
        position: fixed;
        bottom: 10px;
        left: 10px;
        right: 10px;
        background: rgba(0, 0, 0, 0.85);
        color: #fff;
        padding: 15px;
        border-radius: 8px;
        font-family: monospace;
        font-size: 14px;
        z-index: 10000;
        max-height: 50vh;
        overflow-y: auto;
        border: 1px solid #555;
      `;
      document.body.appendChild(debugPanel);
      
      const title = document.createElement('h4');
      title.textContent = 'Application Startup Log';
      title.style.cssText = 'margin: 0 0 10px; padding-bottom: 5px; border-bottom: 1px solid #444;';
      debugPanel.appendChild(title);
    }
    
    const logEntry = document.createElement('div');
    const timestamp = new Date().toLocaleTimeString();
    logEntry.textContent = `[${timestamp}] ${message}`;
    if (isError) {
      logEntry.style.color = '#ff8a8a';
      logEntry.style.fontWeight = 'bold';
    }
    
    debugPanel.appendChild(logEntry);
    debugPanel.scrollTop = debugPanel.scrollHeight;
  } catch (e) {
    // If this fails, we have no way to show visual logs.
  }
}

// --- Main Application Logic ---
async function init() {
  try {
    // Step 1: Hide spinner and show the log panel
    const loadingOverlay = document.getElementById('loading-overlay');
    if (loadingOverlay) loadingOverlay.classList.add('hidden');
    visualLog('Init function started.');

    // Step 2: Request configuration from main process
    visualLog('Requesting configuration...');
    const config = await ipcRenderer.invoke('get-config');
    if (!config || !config.homeAssistant) {
      visualLog('FATAL: Configuration is missing or invalid.', true);
      return;
    }
    visualLog('Configuration received successfully.');
    
    // Step 3: Set the configuration in the state module
    visualLog('Setting config in state module...');
    state.setConfig(config);
    visualLog(`HA URL: ${state.CONFIG.homeAssistant.url}`);
    
    // Step 4: Initialize other modules that depend on config
    visualLog('Initializing hotkeys...');
    hotkeys.initializeHotkeys();
    visualLog('Initializing alerts...');
    alerts.initializeEntityAlerts();
    
    // Step 5: Wire the UI events
    visualLog('Wiring UI elements...');
    wireUI();
    
    // Step 6: Attempt to connect
    visualLog('Connecting to WebSocket...');
    websocket.connect();
    
    visualLog('Initialization sequence complete. Waiting for connection...');
    
  } catch (error) {
    visualLog(`CRITICAL ERROR in init(): ${error.message}`, true);
    console.error('Initialization error:', error);
  }
}

function wireUI() {
  try {
    const settingsBtn = document.getElementById('settings-btn');
    if (settingsBtn) {
      settingsBtn.onclick = () => {
        settings.openSettings({
          populateDomainFilters: ui.populateDomainFilters,
          populateAreaFilter: ui.populateAreaFilter,
          setupEntitySearchInput: ui.setupEntitySearchInput,
          initUpdateUI: ui.initUpdateUI,
        });
      };
    }
    
    const closeSettingsBtn = document.getElementById('close-settings');
    if (closeSettingsBtn) closeSettingsBtn.onclick = settings.closeSettings;
    
    const saveSettingsBtn = document.getElementById('save-settings');
    if (saveSettingsBtn) saveSettingsBtn.onclick = settings.saveSettings;

    // Wire up essential UI buttons
    const closeBtn = document.getElementById('close-btn');
    if (closeBtn) {
      closeBtn.onclick = () => {
        ipcRenderer.invoke('quit-app');
      };
    }

    const minimizeBtn = document.getElementById('minimize-btn');
    if (minimizeBtn) {
      minimizeBtn.onclick = () => {
        ipcRenderer.invoke('minimize-window');
      };
    }

    // Wire up weather card long press
    const weatherCard = document.getElementById('weather-card');
    if (weatherCard) {
      let pressTimer = null;
      weatherCard.addEventListener('mousedown', () => {
        pressTimer = setTimeout(() => {
          // Open weather configuration
          console.log('Weather card long press detected');
        }, 500);
      });
      weatherCard.addEventListener('mouseup', () => {
        clearTimeout(pressTimer);
      });
      weatherCard.addEventListener('mouseleave', () => {
        clearTimeout(pressTimer);
      });
    }

  const globalHotkeysEnabled = document.getElementById('global-hotkeys-enabled');
  if (globalHotkeysEnabled) {
    globalHotkeysEnabled.onchange = (e) => {
      const hotkeysSection = document.getElementById('hotkeys-section');
      if (hotkeysSection) {
        hotkeysSection.style.display = e.target.checked ? 'block' : 'none';
      }
      hotkeys.toggleHotkeys(e.target.checked);
    };
  }

  const entityAlertsEnabled = document.getElementById('entity-alerts-enabled');
  if (entityAlertsEnabled) {
    entityAlertsEnabled.onchange = (e) => {
      const alertsSection = document.getElementById('alerts-section');
      if (alertsSection) {
        alertsSection.style.display = e.target.checked ? 'block' : 'none';
      }
      alerts.toggleAlerts(e.target.checked);
    };
  }

  document.querySelectorAll('.modal-tabs .tab-link').forEach(button => {
    button.addEventListener('click', () => {
      const tab = button.dataset.tab;
      document.querySelectorAll('.modal-tabs .tab-link').forEach(btn => btn.classList.remove('active'));
      button.classList.add('active');
      document.querySelectorAll('.modal-body .tab-content').forEach(content => content.classList.remove('active'));
      document.getElementById(`${tab}-tab`).classList.add('active');
      if (tab === 'hotkeys') {
        hotkeys.renderHotkeysTab();
      }
    });
  });

  const hotkeySearch = document.getElementById('hotkey-entity-search');
  if (hotkeySearch) {
    hotkeySearch.addEventListener('input', hotkeys.renderHotkeysTab);
  }

  const hotkeysList = document.getElementById('hotkeys-list');
  if (hotkeysList) {
    hotkeysList.addEventListener('click', async (e) => {
    const target = e.target;
    if (target.classList.contains('hotkey-input')) {
      const entityId = target.dataset.entityId;
      target.value = 'Recording...';
      const hotkey = await hotkeys.captureHotkey();
      if (hotkey) {
        const result = await ipcRenderer.invoke('register-hotkey', entityId, hotkey);
        if (result.success) {
          target.value = hotkey;
          state.CONFIG.globalHotkeys.hotkeys[entityId] = hotkey;
        } else {
          uiUtils.showToast(result.error, 'error');
          target.value = state.CONFIG.globalHotkeys?.hotkeys?.[entityId] || '';
        }
      } else {
        target.value = state.CONFIG.globalHotkeys?.hotkeys?.[entityId] || '';
      }
    } else if (target.classList.contains('btn-clear-hotkey')) {
      const input = target.previousElementSibling;
      const entityId = input.dataset.entityId;
      await ipcRenderer.invoke('unregister-hotkey', entityId);
      input.value = '';
      delete state.CONFIG.globalHotkeys.hotkeys[entityId];
    }
  });
  }
  } catch (error) {
    console.error('Error wiring UI:', error);
  }
}

window.addEventListener('DOMContentLoaded', () => {
  try {
    console.log('DOMContentLoaded fired, calling init()...');
    init();
  } catch (error) {
    console.error('Error in DOMContentLoaded handler:', error);
  }
});
// Load all required modules
const { ipcRenderer } = require('electron');
const log = require('electron-log');
const state = require('./src/state.js');
const websocket = require('./src/websocket.js');
const hotkeys = require('./src/hotkeys.js');
const alerts = require('./src/alerts.js');
const ui = require('./src/ui.js');
const settings = require('./src/settings.js');
const uiUtils = require('./src/ui-utils.js');

// --- Renderer Log Configuration ---
// This will catch any uncaught errors in your renderer process (the UI)
log.errorHandler.startCatching();

// Reduce console verbosity in DevTools; keep file logs detailed
if (log?.transports?.console) {
  log.transports.console.level = 'warn';
}

// Log renderer process startup
log.info('Renderer process started.');

// --- WebSocket Event Handlers ---
websocket.on('open', () => {
  try {
    log.debug('WebSocket connection opened');
    if (websocket.ws && websocket.ws.readyState === WebSocket.OPEN) {
      const authMessage = {
        type: 'auth',
        access_token: state.CONFIG.homeAssistant.token
      };
      websocket.ws.send(JSON.stringify(authMessage));
    }
  } catch (error) {
    log.error('Error handling WebSocket open:', error);
  }
});

// Track request IDs for proper result handling
let getStatesId, getServicesId, getAreasId;

// WebSocket reconnection constants and state
const BASE_RECONNECT_DELAY = 1000; // 1 second
const MAX_RECONNECT_DELAY = 30000; // 30 seconds
let reconnectAttempts = 0;

websocket.on('message', (msg) => {
  try {
    if (msg.type === 'auth_ok') {
      log.debug('WebSocket authentication successful');
      reconnectAttempts = 0; // Reset on successful connection
      uiUtils.setStatus(true);
      const statesReq = websocket.request({ type: 'get_states' });
      const servicesReq = websocket.request({ type: 'get_services' });
      const areasReq = websocket.request({ type: 'config/area_registry/list' });

      // Store IDs for matching results
      getStatesId = statesReq.id;
      getServicesId = servicesReq.id;
      getAreasId = areasReq.id;

      // Prevent unhandled rejections from surfacing as global errors
      statesReq.catch(() => {});
      servicesReq.catch(() => {});
      areasReq.catch(() => {});
      websocket.request({ type: 'subscribe_events', event_type: 'state_changed' });
    } else if (msg.type === 'auth_invalid') {
      log.error('[WS] Invalid authentication token');
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
      if (msg.id === getStatesId) { // get_states response
        const newStates = {};
        if (Array.isArray(msg.result)) {
          log.debug(`Successfully fetched ${msg.result.length} entities from Home Assistant`);
          msg.result.forEach(entity => { newStates[entity.entity_id] = entity; });
          state.setStates(newStates);
          
          // This is the correct place to render and hide loading
          ui.renderActiveTab();
          uiUtils.showLoading(false);
          
          alerts.initializeEntityAlerts();
        }
      } else if (msg.id === getServicesId) { // get_services response
        state.setServices(msg.result);
      } else if (msg.id === getAreasId) { // get_areas response
          const newAreas = {};
          if (Array.isArray(msg.result)) {
            msg.result.forEach(area => { newAreas[area.area_id] = area; });
            state.setAreas(newAreas);
          }
      }
    }
  } catch (error) {
    log.error('[WS] Error handling message:', error);
  }
});

websocket.on('close', () => {
  try {
    uiUtils.setStatus(false);
    uiUtils.showLoading(false);
    
    // Implement exponential backoff with jitter
    const delay = Math.min(
      BASE_RECONNECT_DELAY * Math.pow(2, reconnectAttempts),
      MAX_RECONNECT_DELAY
    );
    const jitter = Math.random() * 1000; // Add up to 1 second of jitter
    reconnectAttempts++;
    
    log.debug(`WebSocket closed. Reconnecting in ${Math.round((delay + jitter) / 1000)}s (attempt ${reconnectAttempts})`);
    setTimeout(() => websocket.connect(), delay + jitter);
  } catch (error) {
    log.error('Error handling WebSocket close:', error);
  }
});

websocket.on('error', (error) => {
  try {
    log.error('WebSocket error:', error);
    uiUtils.setStatus(false);
    uiUtils.showLoading(false); // Hide loading on failure
    
    // Show the UI with setup message
    ui.renderActiveTab();
  } catch (err) {
    log.error('Error handling WebSocket error:', err);
  }
});


// --- IPC Event Handlers ---
ipcRenderer.on('hotkey-triggered', (event, { entityId, action }) => {
  const entity = state.STATES[entityId];
  if (entity) {
    // Use the action sent from main.js, fallback to toggle if not provided
    const finalAction = action || 'toggle';
    ui.executeHotkeyAction(entity, finalAction);
  }
});
async function init() {
  try {
    log.info('Initializing application');
    uiUtils.showLoading(true);

    const config = await ipcRenderer.invoke('get-config');
    if (!config || !config.homeAssistant) {
      log.error('Configuration is missing or invalid');
      state.setConfig({
        homeAssistant: {
          url: '',
          token: 'YOUR_LONG_LIVED_ACCESS_TOKEN',
        },
        globalHotkeys: {
          enabled: false,
          hotkeys: {},
        },
        entityAlerts: {
          enabled: false,
          alerts: {},
        },
      });
      wireUI();
      uiUtils.showLoading(false);
      ui.renderActiveTab();
      return;
    }
    
    state.setConfig(config);
    wireUI();
    
    if (state.CONFIG.homeAssistant.token === 'YOUR_LONG_LIVED_ACCESS_TOKEN') {
      log.warn('[Init] Using default token. Please configure your Home Assistant token in settings.');
      uiUtils.showLoading(false);
      ui.renderActiveTab();
      return;
    }
    
    // Apply theme and UI preferences from saved config
    uiUtils.applyTheme(state.CONFIG.ui?.theme || 'auto');
    uiUtils.applyUiPreferences(state.CONFIG.ui || {});
    
    // Initialize time display
    ui.updateTimeDisplay();
    setInterval(() => ui.updateTimeDisplay(), 1000);
    
    // Initialize timer updates (every second)
    setInterval(() => ui.updateTimerDisplays(), 1000);
    
    hotkeys.initializeHotkeys();
    hotkeys.setupHotkeyEventListeners();
    alerts.initializeEntityAlerts();
    
    // Always hide loading and show UI
    uiUtils.showLoading(false);
    ui.renderActiveTab();
    
    // Connect to WebSocket in background
    log.info('Connecting to Home Assistant WebSocket');
    websocket.connect();
    
    // Backup timeout to ensure loading is hidden
    setTimeout(() => {
      uiUtils.showLoading(false);
    }, 5000);
    
  } catch (error) {
    log.error('Initialization error:', error);
    uiUtils.showLoading(false);
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
          exitReorganizeMode: () => {
            // Exit reorganize mode if active
            const container = document.getElementById('quick-controls');
            if (container && container.classList.contains('reorganize-mode')) {
              ui.toggleReorganizeMode();
            }
          },
        });
      };
    }
    
    const closeSettingsBtn = document.getElementById('close-settings');
    if (closeSettingsBtn) closeSettingsBtn.onclick = settings.closeSettings;
    
    const cancelSettingsBtn = document.getElementById('cancel-settings');
    if (cancelSettingsBtn) cancelSettingsBtn.onclick = settings.closeSettings;
    
    const saveSettingsBtn = document.getElementById('save-settings');
    if (saveSettingsBtn) saveSettingsBtn.onclick = settings.saveSettings;
    
    const viewLogsBtn = document.getElementById('view-logs-btn');
    if (viewLogsBtn) {
      viewLogsBtn.onclick = async () => {
        try {
          const result = await ipcRenderer.invoke('open-logs');
          if (result.success) {
            log.info('Log file opened successfully');
          } else {
            log.error('Failed to open log file:', result.error);
            uiUtils.showToast('Failed to open log file: ' + result.error, 'error');
          }
        } catch (error) {
          log.error('Error opening log file:', error);
          uiUtils.showToast('Error opening log file: ' + error.message, 'error');
        }
      };
    }
    
    // Opacity slider handler with real-time application
    // Scale: 1-100 where 1 = 50% opacity, 100 = 100% opacity
    const opacitySlider = document.getElementById('opacity-slider');
    const opacityValue = document.getElementById('opacity-value');
    if (opacitySlider && opacityValue) {
      opacitySlider.addEventListener('input', (e) => {
        const sliderValue = parseInt(e.target.value) || 90;
        // Convert slider value (1-100) to opacity (0.5-1.0)
        // Formula: opacity = 0.5 + (sliderValue - 1) * 0.5 / 99
        const opacity = 0.5 + ((sliderValue - 1) * 0.5) / 99;
        opacityValue.textContent = `${sliderValue}`;
        // Apply opacity in real-time
        ipcRenderer.invoke('set-opacity', opacity).catch(err => {
          log.error('Failed to set opacity:', err);
        });
      });
    }

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

    // Wire up Quick Access buttons
    const manageQuickControlsBtn = document.getElementById('manage-quick-controls-btn');
    if (manageQuickControlsBtn) {
      manageQuickControlsBtn.onclick = () => {
        ui.populateQuickControlsList();
        const modal = document.getElementById('quick-controls-modal');
        if (modal) {
          modal.classList.remove('hidden');
          modal.style.display = 'flex';
        }
      };
    }
    
    const closeQuickControlsBtn = document.getElementById('close-quick-controls');
    if (closeQuickControlsBtn) {
      closeQuickControlsBtn.onclick = () => {
        const modal = document.getElementById('quick-controls-modal');
        if (modal) {
          modal.classList.add('hidden');
          modal.style.display = 'none';
        }
      };
    }
    
    const reorganizeQuickControlsBtn = document.getElementById('reorganize-quick-controls-btn');
    if (reorganizeQuickControlsBtn) {
      reorganizeQuickControlsBtn.onclick = ui.toggleReorganizeMode;
    }
    
    // Wire up weather card long press
    const weatherCard = document.getElementById('weather-card');
    if (weatherCard) {
      let pressTimer = null;
      weatherCard.addEventListener('mousedown', () => {
        pressTimer = setTimeout(() => {
          const modal = document.getElementById('weather-config-modal');
          if (modal) {
            modal.classList.remove('hidden');
            modal.style.display = 'flex';
          }
        }, 500);
      });
      weatherCard.addEventListener('mouseup', () => {
        clearTimeout(pressTimer);
      });
      weatherCard.addEventListener('mouseleave', () => {
        clearTimeout(pressTimer);
      });
    }
    
    // Wire up alerts management
    const manageAlertsBtn = document.getElementById('manage-alerts-btn');
    if (manageAlertsBtn) {
      manageAlertsBtn.onclick = settings.openAlertsModal;
    }
    
    const closeAlertsBtn = document.getElementById('close-alerts');
    if (closeAlertsBtn) {
      closeAlertsBtn.onclick = settings.closeAlertsModal;
    }
    
    const closeAlertConfigBtn = document.getElementById('close-alert-config');
    if (closeAlertConfigBtn) {
      closeAlertConfigBtn.onclick = settings.closeAlertConfigModal;
    }
    
    const saveAlertBtn = document.getElementById('save-alert');
    if (saveAlertBtn) {
      saveAlertBtn.onclick = settings.saveAlert;
    }
    
    const cancelAlertBtn = document.getElementById('cancel-alert');
    if (cancelAlertBtn) {
      cancelAlertBtn.onclick = settings.closeAlertConfigModal;
    }
    
    const closeWeatherConfigBtn = document.getElementById('close-weather-config');
    if (closeWeatherConfigBtn) {
      closeWeatherConfigBtn.onclick = () => {
        const modal = document.getElementById('weather-config-modal');
        if (modal) {
          modal.classList.add('hidden');
          modal.style.display = 'none';
        }
      };
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

  // Add click handler to widget content to bring window to focus
  const widgetContent = document.querySelector('.widget-content');
  if (widgetContent) {
    widgetContent.addEventListener('mousedown', () => {
      // Request window focus when clicking on content
      ipcRenderer.invoke('focus-window').catch(err => {
        log.error('Failed to focus window:', err);
      });
    });
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
        const action = target.parentElement.querySelector('.hotkey-action-select').value;
        const result = await ipcRenderer.invoke('register-hotkey', entityId, hotkey, action);
        if (result.success) {
          target.value = hotkey;
          state.CONFIG.globalHotkeys.hotkeys[entityId] = { hotkey, action };
        } else {
          uiUtils.showToast(result.error, 'error');
          const currentConfig = state.CONFIG.globalHotkeys?.hotkeys?.[entityId];
          target.value = (typeof currentConfig === 'string') ? currentConfig : (currentConfig?.hotkey || '');
        }
      } else {
        const currentConfig = state.CONFIG.globalHotkeys?.hotkeys?.[entityId];
        target.value = (typeof currentConfig === 'string') ? currentConfig : (currentConfig?.hotkey || '');
      }
    } else if (target.classList.contains('btn-clear-hotkey')) {
      const container = target.parentElement;
      const input = container.querySelector('.hotkey-input');
      const entityId = input.dataset.entityId;
      await ipcRenderer.invoke('unregister-hotkey', entityId);
      input.value = '';
      delete state.CONFIG.globalHotkeys.hotkeys[entityId];
      hotkeys.renderHotkeysTab();
    }
  });
  }
  } catch (error) {
    log.error('Error wiring UI:', error);
  }
}

window.addEventListener('DOMContentLoaded', () => {
  try {
    init();
  } catch (error) {
    log.error('Error in DOMContentLoaded handler:', error);
  }
});

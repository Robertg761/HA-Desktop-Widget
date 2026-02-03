// Load all required modules (ES Modules)
import log from './src/logger.js';
import state from './src/state.js';
import websocket from './src/websocket.js';
import * as hotkeys from './src/hotkeys.js';
import * as alerts from './src/alerts.js';
import * as ui from './src/ui.js';
import * as settings from './src/settings.js';
import * as uiUtils from './src/ui-utils.js';
import { setIconContent } from './src/icons.js';
import { BASE_RECONNECT_DELAY_MS, MAX_RECONNECT_DELAY_MS } from './src/constants.js';
import Sortable from 'sortablejs';

// --- Renderer Log Configuration ---
log.errorHandler.startCatching();
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
let getStatesId, getServicesId, getAreasId, getConfigId;

// WebSocket reconnection state
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
      const configReq = websocket.request({ type: 'get_config' });

      // Store IDs for matching results
      getStatesId = statesReq.id;
      getServicesId = servicesReq.id;
      getAreasId = areasReq.id;
      getConfigId = configReq.id;

      log.debug(`Sent get_config request with ID: ${getConfigId}`);

      // Prevent unhandled rejections from surfacing as global errors
      statesReq.catch(() => { });
      servicesReq.catch(() => { });
      areasReq.catch(() => { });
      configReq.catch((err) => {
        log.error('get_config request failed:', err);
      });
      websocket.request({ type: 'subscribe_events', event_type: 'state_changed' });
    } else if (msg.type === 'auth_invalid') {
      log.error('[WS] Invalid authentication token');
      uiUtils.setStatus(false);
      uiUtils.showLoading(false);
      // Show clear error message to user
      uiUtils.showToast('Authentication failed. Please check your Home Assistant token in Settings.', 'error', 15000);
      // Render the UI so user can access settings
      ui.renderActiveTab();
    } else if (msg.type === 'event' && msg.event?.event_type === 'state_changed') {
      const entity = msg.event.data.new_state;
      if (entity) {
        state.setStates({ ...state.STATES, [entity.entity_id]: entity });
        ui.updateEntityInUI(entity);
        alerts.checkEntityAlerts(entity.entity_id, entity.state);
      }
    } else if (msg.type === 'result') {
      log.debug(`Received result for message ID: ${msg.id}`);
      if (msg.result) {
        if (msg.id === getStatesId) { // get_states response
          const newStates = {};
          if (Array.isArray(msg.result)) {
            log.debug(`Successfully fetched ${msg.result.length} entities from Home Assistant`);
            msg.result.forEach(entity => { newStates[entity.entity_id] = entity; });

            // Preserve only favorited entities from old states (in case they're temporarily unavailable during HA restart)
            // This prevents deleted entities from persisting indefinitely while still protecting favorites
            const favoriteEntityIds = state.CONFIG.favoriteEntities || [];
            const preservedFavorites = {};
            favoriteEntityIds.forEach(entityId => {
              if (state.STATES[entityId] && !newStates[entityId]) {
                preservedFavorites[entityId] = state.STATES[entityId];
              }
            });

            const mergedStates = { ...newStates, ...preservedFavorites };
            log.debug(`State update: ${Object.keys(newStates).length} from HA + ${Object.keys(preservedFavorites).length} preserved favorites = ${Object.keys(mergedStates).length} total`);
            state.setStates(mergedStates);

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
        } else if (msg.id === getConfigId) { // get_config response
          log.debug('Received config from Home Assistant:', JSON.stringify(msg.result, null, 2));
          if (msg.result && msg.result.unit_system) {
            log.debug('Unit system found:', JSON.stringify(msg.result.unit_system, null, 2));
            state.setUnitSystem(msg.result.unit_system);
            // Re-render weather card with correct units
            if (ui.updateWeatherFromHA) {
              ui.updateWeatherFromHA();
            }
          } else {
            log.warn('No unit_system found in config response');
          }
        } else {
          log.debug(`Unhandled result message ID: ${msg.id}`);
        }
      } else {
        log.debug(`Result message with no result data: ${msg.id}`);
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
      BASE_RECONNECT_DELAY_MS * Math.pow(2, reconnectAttempts),
      MAX_RECONNECT_DELAY_MS
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

    // Show user-friendly error message
    if (error.message.includes('default token')) {
      uiUtils.showToast('Please configure your Home Assistant token in Settings (gear icon).', 'error', 20000);
    } else if (error.message.includes('Invalid configuration')) {
      uiUtils.showToast('Please configure connection settings (gear icon).', 'error', 20000);
    } else if (!error.message.includes('auth_invalid')) {
      // Don't show toast for auth_invalid as it's already handled elsewhere
      uiUtils.showToast(`Connection error: ${error.message}`, 'error', 15000);
    }
  } catch (err) {
    log.error('Error handling WebSocket error:', err);
  }
});

websocket.on('showLoading', (show) => {
  try {
    uiUtils.showLoading(show);
  } catch (err) {
    log.error('Error handling showLoading event:', err);
  }
});


// --- IPC Event Handlers ---
window.electronAPI.onHotkeyTriggered(({ entityId, action }) => {
  const entity = state.STATES[entityId];
  if (entity) {
    // Use the action sent from main.js, fallback to toggle if not provided
    const finalAction = action || 'toggle';
    ui.executeHotkeyAction(entity, finalAction);
  }
});

// Listen for open-settings event from tray menu
window.electronAPI.onOpenSettings(() => {
  settings.openSettings({
    initUpdateUI: ui.initUpdateUI,
    exitReorganizeMode: () => {
      // Exit reorganize mode if active
      const container = document.getElementById('quick-controls');
      if (container && container.classList.contains('reorganize-mode')) {
        ui.toggleReorganizeMode();
      }
    },
  });
});

/**
 * Replace all emoji icons with SVG icons
 * This runs once on initialization to modernize the UI
 */
function replaceEmojiIcons() {
  try {
    log.info('Replacing emoji icons with SVG icons');

    // Header Controls
    const settingsBtn = document.getElementById('settings-btn');
    if (settingsBtn) setIconContent(settingsBtn, 'settings', { size: 18 });

    const minimizeBtn = document.getElementById('minimize-btn');
    if (minimizeBtn) setIconContent(minimizeBtn, 'minimize', { size: 18 });

    const closeBtn = document.getElementById('close-btn');
    if (closeBtn) setIconContent(closeBtn, 'close', { size: 18 });

    // Quick Access Controls
    const reorganizeBtn = document.getElementById('reorganize-quick-controls-btn');
    if (reorganizeBtn) setIconContent(reorganizeBtn, 'dragHandle', { size: 18 });

    const manageBtn = document.getElementById('manage-quick-controls-btn');
    if (manageBtn) setIconContent(manageBtn, 'add', { size: 18 });

    // Media Player Controls
    const mediaPrevBtn = document.getElementById('media-tile-prev');
    if (mediaPrevBtn) setIconContent(mediaPrevBtn, 'skipPrevious', { size: 20 });

    const mediaPlayBtn = document.getElementById('media-tile-play');
    if (mediaPlayBtn) setIconContent(mediaPlayBtn, 'play', { size: 30 });

    const mediaNextBtn = document.getElementById('media-tile-next');
    if (mediaNextBtn) setIconContent(mediaNextBtn, 'skipNext', { size: 20 });

    // Modal Close Buttons (with × emoji)
    const closeButtons = document.querySelectorAll('.close-btn');
    closeButtons.forEach(btn => {
      if (btn.textContent.includes('×')) {
        setIconContent(btn, 'close', { size: 20 });
      }
    });

    log.info('Successfully replaced emoji icons with SVG icons');
  } catch (error) {
    log.error('Error replacing emoji icons:', error);
  }
}

async function init() {
  try {
    log.info('Initializing application');
    uiUtils.showLoading(true);

    const config = await window.electronAPI.getConfig();
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
      replaceEmojiIcons();
      uiUtils.showLoading(false);
      ui.renderActiveTab();
      return;
    }

    state.setConfig(config);
    wireUI();
    replaceEmojiIcons();

    // Check if token was reset due to encryption issues
    if (state.CONFIG.tokenResetReason) {
      const reason = state.CONFIG.tokenResetReason;
      delete state.CONFIG.tokenResetReason; // Clear flag
      await window.electronAPI.updateConfig(state.CONFIG); // Save cleared flag

      let message = 'Your Home Assistant token needs to be re-entered. ';
      let detailMessage = '';
      if (reason === 'encryption_unavailable') {
        message += 'Token encryption is not available on this system.';
        detailMessage = 'Your encrypted token from a previous installation cannot be decrypted on this system. The encrypted token has been preserved in case you move back to a system with encryption support. Please re-enter your token in Settings to continue.';
      } else if (reason === 'decryption_failed') {
        message += 'The stored token could not be decrypted.';
        detailMessage = 'The encrypted token appears to be corrupted and cannot be decrypted. The encrypted token has been preserved for recovery attempts. Please re-enter your token in Settings to continue.';
      }

      log.warn('[Init] Token reset:', message);
      log.info('[Init]', detailMessage);

      // Show prominent warning message with extended duration
      uiUtils.showToast(message + ' Click the gear icon to open Settings.', 'warning', 20000);
    }

    if (state.CONFIG.homeAssistant.token === 'YOUR_LONG_LIVED_ACCESS_TOKEN') {
      log.warn('[Init] Using default token. Please configure your Home Assistant token in settings.');
      uiUtils.showLoading(false);
      ui.renderActiveTab();
      return;
    }

    // Apply theme and UI preferences from saved config
    uiUtils.applyTheme(state.CONFIG.ui?.theme || 'auto');
    uiUtils.applyAccentTheme(state.CONFIG.ui?.accent || 'sky');
    uiUtils.applyBackgroundTheme(state.CONFIG.ui?.background || 'slate');
    uiUtils.applyUiPreferences(state.CONFIG.ui || {});
    uiUtils.applyWindowEffects(state.CONFIG || {});

    // Initialize time display
    ui.updateTimeDisplay();
    setInterval(() => ui.updateTimeDisplay(), 1000);

    // Initialize timer updates (every second)
    setInterval(() => ui.updateTimerDisplays(), 1000);

    // Initialize media tile seek bar updates (every second)
    setInterval(() => {
      const primaryPlayer = state.CONFIG.primaryMediaPlayer;
      if (primaryPlayer && state.STATES[primaryPlayer]) {
        const entity = state.STATES[primaryPlayer];
        if (entity.state === 'playing') {
          ui.updateMediaSeekBar(entity);
        }
      }
    }, 1000);

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
          const result = await window.electronAPI.openLogs();
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

    // Opacity slider handler with real-time preview
    // Scale: 1-100 where 1 = 50% opacity, 100 = 100% opacity
    const opacitySlider = document.getElementById('opacity-slider');
    const opacityValue = document.getElementById('opacity-value');
    if (opacitySlider && opacityValue) {
      opacitySlider.addEventListener('input', (e) => {
        const sliderValue = parseInt(e.target.value) || 90;
        // Convert slider value (1-100) to opacity (0.5-1.0)
        // Formula: opacity = 0.5 + (sliderValue - 1) * 0.5 / 99
        opacityValue.textContent = `${sliderValue}`;
        // Apply preview without persisting
        if (settings.previewWindowEffects) {
          settings.previewWindowEffects();
        }
      });
    }

    const frostedGlassToggle = document.getElementById('frosted-glass');
    if (frostedGlassToggle) {
      frostedGlassToggle.addEventListener('change', () => {
        if (settings.previewWindowEffects) {
          settings.previewWindowEffects();
        }
      });
    }

    // Wire up essential UI buttons
    const closeBtn = document.getElementById('close-btn');
    if (closeBtn) {
      closeBtn.onclick = () => {
        window.electronAPI.quitApp();
      };
    }

    const minimizeBtn = document.getElementById('minimize-btn');
    if (minimizeBtn) {
      minimizeBtn.onclick = () => {
        window.electronAPI.minimizeWindow();
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
          uiUtils.trapFocus(modal); // Trap focus to manage keyboard navigation and focus
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
          uiUtils.releaseFocusTrap(); // Release focus trap and restore previous focus
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
            ui.populateWeatherEntitiesList();
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
    const closeAlertEntityPickerBtn = document.getElementById('close-alert-entity-picker');
    if (closeAlertEntityPickerBtn) {
      closeAlertEntityPickerBtn.onclick = settings.closeAlertEntityPicker;
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

    // Wire up media tile controls
    const mediaTilePlay = document.getElementById('media-tile-play');
    if (mediaTilePlay) {
      mediaTilePlay.onclick = () => {
        const primaryPlayer = state.CONFIG.primaryMediaPlayer;
        if (!primaryPlayer) return;
        const entity = state.STATES[primaryPlayer];
        if (!entity) return;
        const isPlaying = entity.state === 'playing';
        ui.callMediaTileService(isPlaying ? 'pause' : 'play');
      };
    }

    const mediaTilePrev = document.getElementById('media-tile-prev');
    if (mediaTilePrev) {
      mediaTilePrev.onclick = () => ui.callMediaTileService('previous');
    }

    const mediaTileNext = document.getElementById('media-tile-next');
    if (mediaTileNext) {
      mediaTileNext.onclick = () => ui.callMediaTileService('next');
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

    const clearWeatherBtn = document.getElementById('clear-weather');
    if (clearWeatherBtn) {
      clearWeatherBtn.onclick = async () => {
        try {
          // Clear the selected weather entity (revert to default)
          const updatedConfig = {
            ...state.CONFIG,
            selectedWeatherEntity: undefined
          };

          await window.electronAPI.updateConfig(updatedConfig);
          state.setConfig(updatedConfig);

          // Refresh weather display
          ui.updateWeatherFromHA();

          // Refresh the list
          ui.populateWeatherEntitiesList();

          uiUtils.showToast('Weather entity cleared (using first available)', 'success', 2000);
        } catch (error) {
          console.error('Error clearing weather entity:', error);
          uiUtils.showToast('Failed to clear weather entity', 'error', 3000);
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
        // Render inline alerts list when enabled
        if (e.target.checked) {
          settings.renderAlertsListInline();
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
        window.electronAPI.focusWindow().catch(err => {
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
            // Get selected action from custom dropdown
            const dropdown = target.parentElement.querySelector('.hotkey-action-dropdown');
            const selectedOption = dropdown?.querySelector('.custom-dropdown-option.selected');
            const action = selectedOption?.dataset?.value || 'toggle';
            const result = await window.electronAPI.registerHotkey(entityId, hotkey, action);
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
          await window.electronAPI.unregisterHotkey(entityId);
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

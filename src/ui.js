const state = require('./state.js');
const utils = require('./utils.js');
const websocket = require('./websocket.js');
const camera = require('./camera.js');
const uiUtils = require('./ui-utils.js');

let isReorganizeMode = false;
let draggedElement = null;
let dragOverElement = null;

function toggleReorganizeMode() {
  try {
    isReorganizeMode = !isReorganizeMode;
    const container = document.getElementById('quick-controls');
    const btn = document.getElementById('reorganize-quick-controls-btn');
    
    if (isReorganizeMode) {
      container.classList.add('reorganize-mode');
      if (btn) btn.textContent = '✓';
      if (btn) btn.title = 'Save & Exit Reorganize Mode';
      addDragAndDropListeners();
      addRemoveButtons();
      uiUtils.showToast('Reorganize mode enabled - Drag to reorder, click X to remove', 'info', 3000);
    } else {
      container.classList.remove('reorganize-mode');
      if (btn) btn.textContent = '⋮⋮';
      if (btn) btn.title = 'Reorganize Quick Access';
      saveQuickAccessOrder();
      removeRemoveButtons();
      removeDragAndDropListeners();
      uiUtils.showToast('Quick Access order saved', 'success', 2000);
    }
  } catch (error) {
    console.error('Error toggling reorganize mode:', error);
  }
}

function addRemoveButtons() {
  try {
    const controls = document.querySelectorAll('#quick-controls .control-item');
    controls.forEach(item => {
      addButtonsToElement(item);
    });
  } catch (error) {
    console.error('Error adding remove buttons:', error);
  }
}

function removeRemoveButtons() {
  try {
    document.querySelectorAll('#quick-controls .remove-btn').forEach(btn => btn.remove());
    document.querySelectorAll('#quick-controls .rename-btn').forEach(btn => btn.remove());
  } catch (error) {
    console.error('Error removing remove buttons:', error);
  }
}

function addButtonsToElement(item) {
  try {
    // Add rename button
    if (!item.querySelector('.rename-btn')) {
      const renameBtn = document.createElement('button');
      renameBtn.className = 'rename-btn';
      renameBtn.innerHTML = '✏️';
      renameBtn.title = 'Rename Entity';
      renameBtn.setAttribute('draggable', 'false');
      renameBtn.addEventListener('mousedown', (e) => {
        e.stopPropagation();
      }, true);
      renameBtn.addEventListener('dragstart', (e) => {
        e.preventDefault();
        e.stopPropagation();
        return false;
      }, true);
      renameBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        e.preventDefault();
        showRenameModal(item.dataset.entityId);
      }, true);
      item.appendChild(renameBtn);
    }
    
    // Add remove button
    if (!item.querySelector('.remove-btn')) {
      const removeBtn = document.createElement('button');
      removeBtn.className = 'remove-btn';
      removeBtn.innerHTML = '×';
      removeBtn.title = 'Remove from Quick Access';
      removeBtn.setAttribute('draggable', 'false');
      removeBtn.addEventListener('mousedown', (e) => {
        e.stopPropagation();
      }, true);
      removeBtn.addEventListener('dragstart', (e) => {
        e.preventDefault();
        e.stopPropagation();
        return false;
      }, true);
      removeBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        e.preventDefault();
        removeFromQuickAccess(item.dataset.entityId);
      }, true);
      item.appendChild(removeBtn);
    }
  } catch (error) {
    console.error('Error adding buttons to element:', error);
  }
}

function addDragListenersToElement(item) {
  try {
    item.draggable = true;
    item.addEventListener('dragstart', handleDragStart);
    item.addEventListener('dragend', handleDragEnd);
    item.addEventListener('dragover', handleDragOver);
    item.addEventListener('drop', handleDrop);
    item.addEventListener('dragenter', handleDragEnter);
    item.addEventListener('dragleave', handleDragLeave);
  } catch (error) {
    console.error('Error adding drag listeners to element:', error);
  }
}

function showRenameModal(entityId) {
  try {
    const entity = state.STATES[entityId];
    if (!entity) return;
    
    const currentName = state.CONFIG.customEntityNames?.[entityId] || entity.attributes?.friendly_name || entityId;
    
    const modal = document.createElement('div');
    modal.className = 'modal rename-modal';
    modal.innerHTML = `
      <div class="modal-content">
        <div class="modal-header">
          <h2>Rename Entity</h2>
          <button class="close-btn" onclick="this.closest('.modal').remove()">×</button>
        </div>
        <div class="modal-body">
          <div class="form-group">
            <label for="rename-input">Display Name:</label>
            <input type="text" id="rename-input" class="form-control" value="${currentName}" placeholder="Enter custom name">
          </div>
        </div>
        <div class="modal-footer">
          <button id="save-rename-btn" class="btn btn-primary">Save</button>
          <button id="reset-rename-btn" class="btn btn-secondary">Reset to Default</button>
          <button id="cancel-rename-btn" class="btn btn-secondary">Cancel</button>
        </div>
      </div>
    `;
    document.body.appendChild(modal);
    
    const input = modal.querySelector('#rename-input');
    const saveBtn = modal.querySelector('#save-rename-btn');
    const resetBtn = modal.querySelector('#reset-rename-btn');
    const cancelBtn = modal.querySelector('#cancel-rename-btn');
    
    if (input) input.focus();
    
    if (saveBtn) {
      saveBtn.onclick = async () => {
        const newName = input.value.trim();
        if (newName && newName !== currentName) {
          // Initialize customEntityNames if it doesn't exist
          if (!state.CONFIG.customEntityNames) {
            state.CONFIG.customEntityNames = {};
          }
          state.CONFIG.customEntityNames[entityId] = newName;
          
          const { ipcRenderer } = require('electron');
          await ipcRenderer.invoke('update-config', state.CONFIG);
          
          renderActiveTab();
          if (isReorganizeMode) {
            const container = document.getElementById('quick-controls');
            if (container) container.classList.add('reorganize-mode');
            addDragAndDropListeners();
            addRemoveButtons();
          }
          
          uiUtils.showToast(`Renamed to "${newName}"`, 'success', 2000);
        }
        modal.remove();
      };
    }
    
    if (resetBtn) {
      resetBtn.onclick = async () => {
        if (state.CONFIG.customEntityNames && state.CONFIG.customEntityNames[entityId]) {
          delete state.CONFIG.customEntityNames[entityId];
          
          const { ipcRenderer } = require('electron');
          await ipcRenderer.invoke('update-config', state.CONFIG);
          
          renderActiveTab();
          if (isReorganizeMode) {
            const container = document.getElementById('quick-controls');
            if (container) container.classList.add('reorganize-mode');
            addDragAndDropListeners();
            addRemoveButtons();
          }
          
          uiUtils.showToast('Reset to default name', 'info', 2000);
        }
        modal.remove();
      };
    }
    
    if (cancelBtn) {
      cancelBtn.onclick = () => modal.remove();
    }
    
    modal.onclick = (e) => { if (e.target === modal) modal.remove(); };
  } catch (error) {
    console.error('Error showing rename modal:', error);
  }
}

function removeFromQuickAccess(entityId) {
  try {
    if (!confirm(`Remove ${entityId} from Quick Access?`)) return;
    
    const favorites = state.CONFIG.favoriteEntities || [];
    const newFavorites = favorites.filter(id => id !== entityId);
    state.CONFIG.favoriteEntities = newFavorites;
    
    // Save to config
    const { ipcRenderer } = require('electron');
    ipcRenderer.invoke('update-config', state.CONFIG);
    
    // Re-render
    renderQuickControls();
    if (isReorganizeMode) {
      const container = document.getElementById('quick-controls');
      container.classList.add('reorganize-mode');
      addDragAndDropListeners();
      addRemoveButtons();
    }
    
    uiUtils.showToast('Entity removed from Quick Access', 'success', 2000);
  } catch (error) {
    console.error('Error removing from quick access:', error);
  }
}

function saveQuickAccessOrder() {
  try {
    const container = document.getElementById('quick-controls');
    if (!container) return;
    
    const items = container.querySelectorAll('.control-item');
    const newOrder = Array.from(items).map(item => item.dataset.entityId);
    
    state.CONFIG.favoriteEntities = newOrder;
    
    // Save to config
    const { ipcRenderer } = require('electron');
    ipcRenderer.invoke('update-config', state.CONFIG);
  } catch (error) {
    console.error('Error saving quick access order:', error);
  }
}

// --- Core UI Rendering ---
function renderActiveTab() {
  try {
    renderQuickControls();
    renderCameras();
    updateWeatherFromHA();
    if (Object.keys(state.STATES).length === 0) {
      showNoConnectionMessage();
    }
  } catch (error) {
    console.error('[UI] Error rendering active tab:', error);
  }
}

function updateEntityInUI(entity) {
  try {
    if (!entity) return;
    
    // Update weather card if this is a weather entity
    if (entity.entity_id.startsWith('weather.')) {
      updateWeatherFromHA();
    }
    
    const items = document.querySelectorAll(`.control-item[data-entity-id="${entity.entity_id}"]`);
    items.forEach(item => {
      const newControl = createControlElement(entity);
      // Preserve reorganize-mode classes if active
      if (item.classList.contains('reorganize-mode')) {
        newControl.classList.add('reorganize-mode');
      }
      item.replaceWith(newControl);
      
      // If in reorganize mode, add buttons and drag listeners to the newly created element
      if (isReorganizeMode) {
        addButtonsToElement(newControl);
        addDragListenersToElement(newControl);
      }
    });
  } catch (error) {
    console.error('Error updating entity in UI:', error);
  }
}

// --- Quick Controls ---
function renderQuickControls() {
  try {
    const container = document.getElementById('quick-controls');
    if (!container) {
      console.error('[UI] Quick controls container not found');
      return;
    }
    
    container.innerHTML = '';
    
    // Get favorite entities for quick access
    const favorites = state.CONFIG.favoriteEntities || [];
    const entities = Object.values(state.STATES).filter(e => favorites.includes(e.entity_id));
    
    // Sort entities by the order they appear in CONFIG.favoriteEntities (user's custom order)
    entities
      .sort((a, b) => {
        const indexA = favorites.indexOf(a.entity_id);
        const indexB = favorites.indexOf(b.entity_id);
        return indexA - indexB;
      })
      .slice(0, 12)
      .forEach(entity => {
        const control = createControlElement(entity);
        container.appendChild(control);
      });

    if (isReorganizeMode) {
      container.classList.add('reorganize-mode');
      addDragAndDropListeners();
      addRemoveButtons();
    }
  } catch (error) {
    console.error('[UI] Error rendering quick controls:', error, error.stack);
  }
}

function createControlElement(entity) {
  try {
    const div = document.createElement('div');
    div.className = 'control-item';
    div.dataset.entityId = entity.entity_id;

    // Check if sensor is a timer (has finishes_at, end_time, finish_time, or duration attribute)
    // Google Kitchen Timer and other timer sensors might use different attribute names or have timestamp as state
    const hasTimerAttributes = entity.attributes && (
      entity.attributes.finishes_at || 
      entity.attributes.end_time || 
      entity.attributes.finish_time ||
      entity.attributes.duration
    );
    
    // Check if entity ID contains "timer" or if state is a valid future timestamp
    const hasTimerInName = entity.entity_id.toLowerCase().includes('timer');
    let stateIsTimestamp = false;
    if (entity.state && entity.state !== 'unavailable' && entity.state !== 'unknown') {
      // Only treat as timestamp if it looks like a proper ISO 8601 date/time string
      // Require at least a date format (YYYY-MM-DD) or full ISO format (YYYY-MM-DDTHH:mm:ss)
      // This prevents numeric values like "150" (watts) or "2025" (years only) from being parsed
      const iso8601Pattern = /^\d{4}-\d{2}-\d{2}([T ]\d{2}:\d{2}(:\d{2})?)?/;
      const looksLikeTimestamp = iso8601Pattern.test(entity.state);
      if (looksLikeTimestamp) {
        const stateTime = new Date(entity.state).getTime();
        if (!isNaN(stateTime) && stateTime > Date.now()) {
          stateIsTimestamp = true;
        }
      }
    }
    
    const isTimerSensor = entity.entity_id.startsWith('sensor.') && (hasTimerAttributes || hasTimerInName || stateIsTimestamp);
    const isTimer = entity.entity_id.startsWith('timer.') || isTimerSensor;

    // Handle different entity types (matching main branch)
    if (entity.entity_id.startsWith('camera.')) {
      div.onclick = () => {
        if (!isReorganizeMode) camera.openCamera(entity.entity_id);
      };
      div.title = `Click to view ${utils.getEntityDisplayName(entity)}`;
    } else if (entity.entity_id.startsWith('sensor.') && !isTimerSensor) {
      div.onclick = () => {
        if (!isReorganizeMode) showSensorDetails(entity);
      };
      div.title = `${utils.getEntityDisplayName(entity)}: ${utils.getEntityDisplayState(entity)}`;
    } else if (isTimer) {
      div.onclick = () => {
        if (!isReorganizeMode) toggleEntity(entity);
      };
      div.title = `Click to toggle ${utils.getEntityDisplayName(entity)}`;
    } else if (entity.entity_id.startsWith('light.')) {
      setupLightControls(div, entity);
      div.title = `Click to toggle, hold for brightness control`;
    } else if (entity.entity_id.startsWith('media_player.')) {
      setupMediaPlayerControls(div, entity);
      div.title = `Media player controls`;
    } else {
      div.onclick = () => {
        if (!isReorganizeMode) toggleEntity(entity);
      };
      div.title = `Click to toggle ${utils.getEntityDisplayName(entity)}`;
    }
    
    const icon = utils.getEntityIcon(entity);
    const name = utils.getEntityDisplayName(entity);
    const state = utils.getEntityDisplayState(entity);
    
    let stateDisplay = '';
    if (entity.entity_id.startsWith('sensor.') && !isTimerSensor) {
      stateDisplay = `<div class="control-state">${state}</div>`;
    } else if (isTimer) {
      const timerDisplay = utils.getTimerDisplay ? utils.getTimerDisplay(entity) : state;
      stateDisplay = `<div class="control-state timer-countdown">${timerDisplay}</div>`;
    } else if (entity.entity_id.startsWith('light.') && entity.state === 'on' && entity.attributes.brightness) {
      const brightness = Math.round((entity.attributes.brightness / 255) * 100);
      stateDisplay = `<div class="control-state">${brightness}%</div>`;
    } else if (entity.entity_id.startsWith('light.') && entity.state !== 'on') {
      stateDisplay = `<div class="control-state">Off</div>`;
    } else if (entity.entity_id.startsWith('climate.')) {
      const temp = entity.attributes.current_temperature || entity.attributes.temperature;
      if (temp) stateDisplay = `<div class="control-state">${temp}°</div>`;
    } else if (entity.entity_id.startsWith('media_player.')) {
      // Media player state will be handled in setupMediaPlayerControls
      stateDisplay = '';
    }

    // Special layout for timer entities (no icon, larger timer display)
    if (isTimer) {
      div.innerHTML = `
        <div class="control-info timer-layout">
          <div class="control-name">${name}</div>
          ${stateDisplay}
        </div>
      `;
      div.classList.add('timer-entity');
      div.setAttribute('data-state', entity.state);
    } else if (entity.entity_id.startsWith('media_player.')) {
      // Media player layout will be handled in setupMediaPlayerControls
      div.innerHTML = `
        <div class="control-icon">${icon}</div>
        <div class="control-info">
          <div class="control-name">${name}</div>
          ${stateDisplay}
        </div>
      `;
      div.classList.add('media-player-entity');
    } else {
      div.innerHTML = `
        <div class="control-icon">${icon}</div>
        <div class="control-info">
          <div class="control-name">${name}</div>
          ${stateDisplay}
        </div>
      `;
    }
    
    return div;
  } catch (error) {
    console.error('Error creating control element:', error);
    return document.createElement('div');
  }
}

function showSensorDetails(entity) {
  try {
    uiUtils.showToast(`${utils.getEntityDisplayName(entity)}: ${utils.getEntityDisplayState(entity)}`, 'info', 3000);
  } catch (error) {
    console.error('Error showing sensor details:', error);
  }
}

function setupLightControls(div, entity) {
  try {
    let pressTimer = null;
    let longPressTriggered = false;

    const startPress = (_e) => {
      if (isReorganizeMode) {
        // In reorganize mode, don't handle mousedown - let drag work
        return;
      }
      longPressTriggered = false;
      pressTimer = setTimeout(() => {
        longPressTriggered = true;
        showBrightnessSlider(entity);
      }, 500);
    };

    const cancelPress = () => clearTimeout(pressTimer);

    div.addEventListener('mousedown', startPress);
    div.addEventListener('mouseup', cancelPress);
    div.addEventListener('mouseleave', cancelPress);
    div.addEventListener('click', (e) => {
      if (isReorganizeMode || longPressTriggered) {
        e.preventDefault();
        e.stopPropagation();
        return;
      }
      toggleEntity(entity);
    });
  } catch (error) {
    console.error('Error setting up light controls:', error);
  }
}

function setupMediaPlayerControls(div, entity) {
  try {
    if (!div || !entity) return;
    
    // Get media info
    const mediaTitle = entity.attributes?.media_title || '';
    const mediaArtist = entity.attributes?.media_artist || '';
    const mediaAlbum = entity.attributes?.media_album_name || '';
    const isPlaying = entity.state === 'playing';
    const isOff = entity.state === 'off' || entity.state === 'idle';
    
    // Create media info display
    let mediaInfo = '';
    if (mediaTitle) {
      mediaInfo = `<div class="media-info">
        <div class="media-title">${mediaTitle}</div>
        ${mediaArtist ? `<div class="media-artist">${mediaArtist}</div>` : ''}
        ${mediaAlbum ? `<div class="media-album">${mediaAlbum}</div>` : ''}
      </div>`;
    } else if (isOff) {
      mediaInfo = '<div class="media-info"><div class="media-title">No media</div></div>';
    } else {
      mediaInfo = '<div class="media-info"><div class="media-title">Ready</div></div>';
    }
    
    // Create control buttons
    const controls = `
      <div class="media-controls">
        <button class="media-btn prev-btn" title="Previous track" data-action="previous_track">⏮️</button>
        <button class="media-btn play-pause-btn" title="${isPlaying ? 'Pause' : 'Play'}" data-action="${isPlaying ? 'pause' : 'play'}">
          ${isPlaying ? '⏸️' : '▶️'}
        </button>
        <button class="media-btn next-btn" title="Next track" data-action="next_track">⏭️</button>
      </div>
    `;
    
    // Update the control info section
    const controlInfo = div.querySelector('.control-info');
    if (controlInfo) {
      controlInfo.innerHTML = `
        <div class="control-name">${utils.getEntityDisplayName(entity)}</div>
        ${mediaInfo}
        ${controls}
      `;
    }
    
    // Add click handlers for media controls
    div.addEventListener('click', (e) => {
      if (isReorganizeMode) return;
      
      const button = e.target.closest('.media-btn');
      if (button) {
        e.preventDefault();
        e.stopPropagation();
        
        const action = button.dataset.action;
        callMediaPlayerService(entity.entity_id, action);
      }
    });
    
    // Update data attributes for styling
    div.setAttribute('data-state', entity.state);
    div.setAttribute('data-media-playing', isPlaying ? 'true' : 'false');
    
  } catch (error) {
    console.error('Error setting up media player controls:', error);
  }
}

function callMediaPlayerService(entityId, action) {
  try {
    const websocket = require('./websocket.js');
    
    switch (action) {
      case 'play':
        websocket.callService('media_player', 'media_play', { entity_id: entityId });
        break;
      case 'pause':
        websocket.callService('media_player', 'media_pause', { entity_id: entityId });
        break;
      case 'next_track':
        websocket.callService('media_player', 'media_next_track', { entity_id: entityId });
        break;
      case 'previous_track':
        websocket.callService('media_player', 'media_previous_track', { entity_id: entityId });
        break;
      default:
        console.warn('Unknown media player action:', action);
    }
  } catch (error) {
    console.error('Error calling media player service:', error);
  }
}

function toggleEntity(entity) {
    try {
        const domain = entity.entity_id.split('.')[0];
        let service;
        let service_data = { entity_id: entity.entity_id };

        switch(domain) {
            case 'light':
            case 'switch':
            case 'fan':
            case 'input_boolean':
                service = 'toggle';
                break;
            case 'lock':
                service = entity.state === 'locked' ? 'unlock' : 'lock';
                break;
            case 'cover':
                service = entity.state === 'open' ? 'close_cover' : 'open_cover';
                break;
            case 'scene':
            case 'script':
                service = 'turn_on';
                break;
            default:
                // No toggle action for this domain
                return;
        }
        websocket.callService(domain === 'light' ? 'homeassistant' : domain, service, service_data);
    } catch (error) {
        console.error('Error toggling entity:', error);
    }
}

function executeHotkeyAction(entity, action) {
  try {
    const domain = entity.entity_id.split('.')[0];
    const currentBrightness = entity.attributes?.brightness || 0;
    
    switch (action) {
      case 'toggle':
        toggleEntity(entity);
        break;
      case 'turn_on':
        websocket.callService(domain, 'turn_on', { entity_id: entity.entity_id });
        break;
      case 'turn_off':
        websocket.callService(domain, 'turn_off', { entity_id: entity.entity_id });
        break;
      case 'brightness_up':
        // Increase brightness by 20% (51 units out of 255)
        if (domain === 'light') {
          const newBrightness = Math.min(255, currentBrightness + 51);
          websocket.callService('light', 'turn_on', { 
            entity_id: entity.entity_id,
            brightness: newBrightness
          });
        }
        break;
      case 'brightness_down':
        // Decrease brightness by 20% (51 units out of 255)
        if (domain === 'light') {
          const newBrightness = Math.max(0, currentBrightness - 51);
          websocket.callService('light', 'turn_on', { 
            entity_id: entity.entity_id,
            brightness: newBrightness
          });
        }
        break;
      case 'trigger':
        // For automations
        if (domain === 'automation') {
          websocket.callService('automation', 'trigger', { entity_id: entity.entity_id });
        }
        break;
      case 'increase_speed':
        // For fans - increase percentage by 33%
        if (domain === 'fan') {
          const currentPercentage = entity.attributes?.percentage || 0;
          const newPercentage = Math.min(100, currentPercentage + 33);
          websocket.callService('fan', 'set_percentage', { 
            entity_id: entity.entity_id,
            percentage: newPercentage
          });
        }
        break;
      case 'decrease_speed':
        // For fans - decrease percentage by 33%
        if (domain === 'fan') {
          const currentPercentage = entity.attributes?.percentage || 0;
          const newPercentage = Math.max(0, currentPercentage - 33);
          websocket.callService('fan', 'set_percentage', { 
            entity_id: entity.entity_id,
            percentage: newPercentage
          });
        }
        break;
      default:
        // Default to toggle for backward compatibility
        toggleEntity(entity);
    }
  } catch (error) {
    console.error(`Error executing hotkey action '${action}' for entity ${entity.entity_id}:`, error);
  }
}
function renderCameras() {
  try {
    const container = document.getElementById('cameras-container');
    const section = document.getElementById('cameras-section');
    if (!container || !section) return;
    
    const cameras = Object.values(state.STATES).filter(e => e.entity_id.startsWith('camera.'));
    
    if (cameras.length === 0) {
      section.style.display = 'none';
      return;
    }
    
    section.style.display = 'block';
    container.innerHTML = '';
    
    cameras.slice(0, 4).forEach(cameraEntity => {
      const card = createCameraCard(cameraEntity);
      container.appendChild(card);
    });
  } catch (error) {
    console.error('Error rendering cameras:', error);
  }
}

function createCameraCard(cameraEntity) {
  try {
    const div = document.createElement('div');
    div.className = 'camera-card';
    const name = utils.getEntityDisplayName(cameraEntity);
    
    div.innerHTML = `
      <div class="camera-header">
        <div class="camera-name">${name}</div>
      </div>
      <div class="camera-embed">
        <img class="camera-img" alt="${name}" src="ha://camera/${cameraEntity.entity_id}?t=${Date.now()}">
      </div>
    `;
    return div;
  } catch (error) {
    console.error('Error creating camera card:', error);
    return document.createElement('div');
  }
}

// --- Weather ---
function updateWeatherFromHA() {
  try {
    const weatherEntity = state.STATES[state.CONFIG.selectedWeatherEntity] || Object.values(state.STATES).find(e => e.entity_id.startsWith('weather.'));
    if (!weatherEntity) return;

    const tempEl = document.getElementById('weather-temp');
    const conditionEl = document.getElementById('weather-condition');
    const humidityEl = document.getElementById('weather-humidity');
    const windEl = document.getElementById('weather-wind');
    const iconEl = document.getElementById('weather-icon');

    if (tempEl) tempEl.textContent = `${Math.round(weatherEntity.attributes.temperature || 0)}°`;
    if (conditionEl) conditionEl.textContent = weatherEntity.state || '--';
    if (humidityEl) humidityEl.textContent = `${weatherEntity.attributes.humidity || 0}%`;
    if (windEl) windEl.textContent = `${weatherEntity.attributes.wind_speed || 0} km/h`;
    
    // Update weather icon based on current condition
    if (iconEl) {
      const condition = weatherEntity.state?.toLowerCase() || '';
      let icon = '🌤️'; // default
      let classes = 'weather-icon';
      
      if (condition.includes('sunny') || condition === 'clear') {
        icon = '☀️';
        classes += ' sunny';
      } else if (condition.includes('partly') || condition.includes('cloudy')) {
        icon = '⛅';
        classes += ' cloudy';
      } else if (condition.includes('rain') || condition.includes('rainy')) {
        icon = '🌧️';
        classes += ' rain';
      } else if (condition.includes('snow') || condition.includes('snowy')) {
        icon = '❄️';
        classes += ' snow';
      } else if (condition.includes('storm') || condition.includes('thunder') || condition.includes('lightning')) {
        icon = '⛈️';
        classes += ' storm';
      } else if (condition.includes('fog') || condition.includes('mist') || condition.includes('haze')) {
        icon = '🌫️';
      } else if (condition.includes('wind')) {
        icon = '💨';
        classes += ' wind';
      } else if (condition.includes('cloud')) {
        icon = '☁️';
        classes += ' cloudy';
      } else if (condition.includes('night') || condition.includes('clear-night')) {
        icon = '🌙';
      }
      
      iconEl.textContent = icon;
      iconEl.className = classes;
    }
  } catch (error) {
    console.error('Error updating weather:', error);
  }
}

// --- Misc UI ---
function showNoConnectionMessage() {
  try {
    const container = document.getElementById('quick-controls');
    if (container) {
      // Check if configuration needs setup
      if (!state.CONFIG ||
          !state.CONFIG.homeAssistant ||
          state.CONFIG.homeAssistant.token === 'YOUR_LONG_LIVED_ACCESS_TOKEN') {
        container.innerHTML = `
          <div class="status-message">
            <h3>⚙️ Setup Required</h3>
            <p>Your Home Assistant connection needs to be configured.</p>
            <p>Click the settings button (⚙️) in the top right to:</p>
            <ul style="margin: 10px 0; padding-left: 20px;">
              <li>Set your Home Assistant URL</li>
              <li>Add your Long-Lived Access Token</li>
            </ul>
            <p><strong>Status:</strong> Configuration incomplete</p>
          </div>`;
      } else {
        container.innerHTML = `
          <div class="status-message">
            <h3>🔄 Connecting to Home Assistant</h3>
            <p>Attempting to connect to: ${state.CONFIG.homeAssistant.url}</p>
            <p><strong>Status:</strong> Connecting...</p>
            <p style="margin-top: 10px; font-size: 12px; opacity: 0.8;">
              If this persists, check your Home Assistant URL and token in settings.
            </p>
          </div>`;
      }
    }
  } catch (error) {
    console.error('Error showing no connection message:', error);
  }
}

function updateTimeDisplay() {
  try {
    const now = new Date();
    const timeEl = document.getElementById('current-time');
    const dateEl = document.getElementById('current-date');
    
    if (timeEl) timeEl.textContent = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    if (dateEl) dateEl.textContent = now.toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' });
  } catch (error) {
    console.error('Error updating time display:', error);
  }
}

function updateTimerDisplays() {
  try {
    // Find all timer entities AND sensor entities with timer attributes in Quick Access
    const timerElements = document.querySelectorAll('.control-item.timer-entity');
    
    timerElements.forEach(timerEl => {
      const entityId = timerEl.dataset.entityId;
      const entity = state.STATES[entityId];
      
      if (!entity) return;
      
      // Handle timer.* entities
      if (entityId.startsWith('timer.')) {
        if (entity.state !== 'active') return;
        
        // Calculate remaining time
        const finishesAt = entity.attributes?.finishes_at;
        if (!finishesAt) return;
        
        const endTime = new Date(finishesAt).getTime();
        const now = Date.now();
        const remaining = Math.max(0, Math.floor((endTime - now) / 1000));
        
        // Format as mm:ss or hh:mm:ss
        const hours = Math.floor(remaining / 3600);
        const minutes = Math.floor((remaining % 3600) / 60);
        const seconds = remaining % 60;
        
        let display;
        if (hours > 0) {
          display = `${hours}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
        } else {
          display = `${minutes}:${String(seconds).padStart(2, '0')}`;
        }
        
        // Update the countdown display
        const countdownEl = timerEl.querySelector('.timer-countdown');
        if (countdownEl && countdownEl.textContent !== display) {
          countdownEl.textContent = display;
        }
      }
      // Handle sensor.* entities that are timers (like Google Kitchen Timer)
      else if (entityId.startsWith('sensor.')) {
        // Check for various timer end time attributes
        let finishesAt = entity.attributes?.finishes_at || 
                         entity.attributes?.end_time || 
                         entity.attributes?.finish_time;
        
        // If no attribute, check if state is a timestamp (Google Kitchen Timer uses state as timestamp)
        if (!finishesAt && entity.state && entity.state !== 'unavailable' && entity.state !== 'unknown') {
          // Only treat as timestamp if it looks like a proper ISO 8601 date/time string
          // Require at least a date format (YYYY-MM-DD) or full ISO format (YYYY-MM-DDTHH:mm:ss)
          // This prevents numeric values like "150" (watts) or "2025" (years only) from being parsed
          const iso8601Pattern = /^\d{4}-\d{2}-\d{2}([T ]\d{2}:\d{2}(:\d{2})?)?/;
          const looksLikeTimestamp = iso8601Pattern.test(entity.state);
          if (looksLikeTimestamp) {
            const stateTime = new Date(entity.state).getTime();
            if (!isNaN(stateTime)) {
              finishesAt = entity.state;
            }
          }
        }
        
        if (!finishesAt) return;
        
        // Check if timer is active (finishes_at is in the future)
        const endTime = new Date(finishesAt).getTime();
        const now = Date.now();
        
        if (endTime <= now) {
          // Timer finished
          const countdownEl = timerEl.querySelector('.timer-countdown');
          if (countdownEl) {
            countdownEl.textContent = 'Finished';
          }
          return;
        }
        
        const remaining = Math.max(0, Math.floor((endTime - now) / 1000));
        
        // Format as mm:ss or hh:mm:ss
        const hours = Math.floor(remaining / 3600);
        const minutes = Math.floor((remaining % 3600) / 60);
        const seconds = remaining % 60;
        
        let display;
        if (hours > 0) {
          display = `${hours}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
        } else {
          display = `${minutes}:${String(seconds).padStart(2, '0')}`;
        }
        
        // Update the countdown display
        const countdownEl = timerEl.querySelector('.timer-countdown');
        if (countdownEl && countdownEl.textContent !== display) {
          countdownEl.textContent = display;
        }
      }
    });
  } catch {
    // Silent fail - timers will just show static state from entity updates
  }
}

function showBrightnessSlider(light) {
  try {
    const name = utils.getEntityDisplayName(light);
    const currentBrightness = light.state === 'on' && light.attributes.brightness ? Math.round((light.attributes.brightness / 255) * 100) : 0;

    const modal = document.createElement('div');
    modal.className = 'modal brightness-modal';
    modal.innerHTML = `
      <div class="modal-content brightness-modal-content">
        <div class="modal-header">
          <h2>${name}</h2>
          <button class="close-btn" id="brightness-close" title="Close">×</button>
        </div>
        <div class="modal-body">
          <div class="brightness-content">
            <div class="brightness-icon-wrapper">
              <div class="brightness-icon" id="brightness-icon">💡</div>
            </div>
            <div class="brightness-value-large" id="brightness-value-large">${currentBrightness}%</div>
            <div class="brightness-label">Brightness</div>
            <div class="brightness-slider-wrapper">
              <input 
                type="range" 
                min="0" 
                max="100" 
                value="${currentBrightness}" 
                id="brightness-slider" 
                class="brightness-slider" 
                aria-label="Brightness" 
                orient="vertical" 
              />
            </div>
            <div class="brightness-presets">
              <button class="brightness-preset-btn" data-preset="25">25%</button>
              <button class="brightness-preset-btn" data-preset="50">50%</button>
              <button class="brightness-preset-btn" data-preset="75">75%</button>
              <button class="brightness-preset-btn" data-preset="100">100%</button>
            </div>
          </div>
        </div>
        <div class="modal-footer">
          <button class="btn btn-secondary" id="brightness-cancel">Close</button>
          <button class="btn btn-primary" id="turn-off-btn">Turn Off</button>
        </div>
      </div>
    `;
    document.body.appendChild(modal);

    const slider = modal.querySelector('#brightness-slider');
    const valueLarge = modal.querySelector('#brightness-value-large');
    const icon = modal.querySelector('#brightness-icon');
    const closeBtn = modal.querySelector('#brightness-close');
    const cancelBtn = modal.querySelector('#brightness-cancel');
    const turnOffBtn = modal.querySelector('#turn-off-btn');
    const presetButtons = modal.querySelectorAll('.brightness-preset-btn');

    // Track current light state
    let lightIsOn = light.state === 'on';

    // Update turn off/on button text
    const updateTurnButton = () => {
      if (turnOffBtn) {
        turnOffBtn.textContent = lightIsOn ? 'Turn Off' : 'Turn On';
      }
    };
    updateTurnButton();

    // Close handlers
    const closeModal = () => {
      modal.classList.add('modal-closing');
      setTimeout(() => modal.remove(), 200);
    };
    if (closeBtn) closeBtn.onclick = closeModal;
    if (cancelBtn) cancelBtn.onclick = closeModal;
    modal.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeModal(); });

    // Animate in
    setTimeout(() => modal.classList.add('modal-open'), 10);

    // Keep focus within modal (basic)
    setTimeout(() => {
      const focusable = modal.querySelector('.brightness-slider') || closeBtn || cancelBtn;
      if (focusable && focusable.focus) focusable.focus();
    }, 0);

    // Update icon and accent based on brightness
    const updateIconAndAccent = (value) => {
      if (!icon) return;
      if (value === 0) {
        icon.textContent = '💤';
        icon.className = 'brightness-icon brightness-off';
      } else if (value <= 25) {
        icon.textContent = '🌑';
        icon.className = 'brightness-icon brightness-low';
      } else if (value <= 50) {
        icon.textContent = '🌓';
        icon.className = 'brightness-icon brightness-mid';
      } else if (value <= 75) {
        icon.textContent = '🌕';
        icon.className = 'brightness-icon brightness-high';
      } else {
        icon.textContent = '☀️';
        icon.className = 'brightness-icon brightness-max';
      }
    };

    // Slider behavior with debounce
    if (slider) {
      let debounceTimer;
      const applyValue = (value) => {
        if (valueLarge) valueLarge.textContent = `${value}%`;
        updateIconAndAccent(value);
        clearTimeout(debounceTimer);
        debounceTimer = setTimeout(() => {
          const brightness = Math.round((value / 100) * 255);
          if (brightness > 0) {
            websocket.callService('light', 'turn_on', { entity_id: light.entity_id, brightness });
          } else {
            websocket.callService('light', 'turn_off', { entity_id: light.entity_id });
          }
        }, 120);
      };
      slider.addEventListener('input', (e) => {
        const value = parseInt(e.target.value, 10) || 0;
        applyValue(value);
      });
      // Initialize icon/accent
      updateIconAndAccent(currentBrightness);
    }

    // Presets
    presetButtons.forEach(btn => {
      btn.addEventListener('click', () => {
        const preset = parseInt(btn.getAttribute('data-preset'), 10) || 0;
        const sliderEl = modal.querySelector('#brightness-slider');
        if (sliderEl) {
          sliderEl.value = String(preset);
          sliderEl.dispatchEvent(new Event('input', { bubbles: true }));
        }
      });
    });

    // Turn off/on button
    if (turnOffBtn) {
      turnOffBtn.onclick = () => {
        if (lightIsOn) {
          websocket.callService('light', 'turn_off', { entity_id: light.entity_id });
          lightIsOn = false;
          if (slider) slider.value = '0';
          if (valueLarge) valueLarge.textContent = '0%';
          updateIconAndAccent(0);
        } else {
          // Turn on to last brightness or 100%
          const brightness = currentBrightness > 0 ? Math.round((currentBrightness / 100) * 255) : 255;
          websocket.callService('light', 'turn_on', { entity_id: light.entity_id, brightness });
          lightIsOn = true;
          const targetValue = currentBrightness > 0 ? currentBrightness : 100;
          if (slider) slider.value = String(targetValue);
          if (valueLarge) valueLarge.textContent = `${targetValue}%`;
          updateIconAndAccent(targetValue);
        }
        updateTurnButton();
      };
    }

    // Close on backdrop click only when clicking the overlay
    modal.onclick = (e) => { if (e.target === modal) closeModal(); };
  } catch (error) {
    console.error('Error showing brightness slider:', error);
  }
}

function populateDomainFilters() {
    try {
        const container = document.getElementById('filter-domains');
        if (!container) return;
        const allDomains = [...new Set(Object.values(state.STATES).map(e => e.entity_id.split('.')[0]))].sort();
        container.innerHTML = allDomains.map(domain => `
            <label>
                <input type="checkbox" value="${domain}" ${state.FILTERS.domains.includes(domain) ? 'checked' : ''}>
                ${domain}
            </label>
        `).join('');
    } catch (error) {
        console.error('Error populating domain filters:', error);
    }
}

function populateAreaFilter() {
    try {
        const select = document.getElementById('filter-areas');
        if (!select) return;
        select.innerHTML = Object.values(state.AREAS).map(area => `
            <option value="${area.area_id}" ${state.FILTERS.areas.includes(area.area_id) ? 'selected' : ''}>
                ${area.name}
            </option>
        `).join('');
    } catch (error) {
        console.error('Error populating area filter:', error);
    }
}

function setupEntitySearchInput(inputId, _allowedDomains = null) {
    try {
        const input = document.getElementById(inputId);
        if (!input) return;
        
        input.addEventListener('input', (e) => {
            const query = e.target.value.toLowerCase();
            const container = document.getElementById(inputId.replace('-search', '-list')) || 
                            document.getElementById(inputId.replace('-search', '-entities-list'));
            if (!container) return;
            
            const items = container.querySelectorAll('.entity-item, .hotkey-item, .alert-item');
            items.forEach(item => {
                const text = item.textContent.toLowerCase();
                const matches = text.includes(query);
                item.style.display = matches ? 'block' : 'none';
            });
        });
    } catch (error) {
        console.error('Error setting up entity search input:', error);
    }
}

function populateQuickControlsList() {
    try {
        const list = document.getElementById('quick-controls-list');
        const searchInput = document.getElementById('quick-controls-search');
        if (!list) return;
        
        const renderList = () => {
            const filter = searchInput ? searchInput.value.toLowerCase() : '';
            const favorites = state.CONFIG.favoriteEntities || [];
            
            // Score and filter entities
            const scoredEntities = Object.values(state.STATES)
                .filter(e => !e.entity_id.startsWith('sun.') && !e.entity_id.startsWith('zone.'))
                .map(entity => {
                    if (!filter) {
                        return { entity, score: 1 };
                    }
                    // Search both display name and entity ID
                    const nameScore = utils.getSearchScore(utils.getEntityDisplayName(entity), filter);
                    const idScore = utils.getSearchScore(entity.entity_id, filter);
                    return { entity, score: nameScore + idScore };
                })
                .filter(item => item.score > 0)
                .sort((a, b) => {
                    // Sort by score first, then alphabetically
                    if (b.score !== a.score) {
                        return b.score - a.score;
                    }
                    return utils.getEntityDisplayName(a.entity).localeCompare(utils.getEntityDisplayName(b.entity));
                });
            
            list.innerHTML = '';
            
            scoredEntities.forEach(({ entity }) => {
                const item = document.createElement('div');
                item.className = 'entity-item';
                
                const isFavorite = favorites.includes(entity.entity_id);
                
                item.innerHTML = `
                    <div class="entity-item-main">
                        <span class="entity-icon">${utils.getEntityIcon(entity)}</span>
                        <div class="entity-item-info">
                            <span class="entity-name">${utils.getEntityDisplayName(entity)}</span>
                            <span class="entity-id" title="${entity.entity_id}">${entity.entity_id}</span>
                        </div>
                    </div>
                    <button class="entity-selector-btn ${isFavorite ? 'remove' : 'add'}" data-entity-id="${entity.entity_id}">
                        ${isFavorite ? 'Remove' : 'Add'}
                    </button>
                `;
                
                const button = item.querySelector('button');
                button.onclick = () => toggleQuickAccess(entity.entity_id);
                
                list.appendChild(item);
            });
        };
        
        // Initial render
        renderList();
        
        // Set up search with proper scoring
        if (searchInput) {
            searchInput.value = '';
            searchInput.oninput = () => renderList();
        }
    } catch (error) {
        console.error('Error populating quick controls list:', error);
    }
}

function toggleQuickAccess(entityId) {
    try {
        const { ipcRenderer } = require('electron');
        const favorites = state.CONFIG.favoriteEntities || [];
        
        if (favorites.includes(entityId)) {
            // Remove from favorites
            state.CONFIG.favoriteEntities = favorites.filter(id => id !== entityId);
        } else {
            // Add to favorites
            state.CONFIG.favoriteEntities = [...favorites, entityId];
        }
        
        // Save and update UI
        ipcRenderer.invoke('update-config', state.CONFIG);
        renderQuickControls();
        populateQuickControlsList();
    } catch (error) {
        console.error('Error toggling quick access:', error);
    }
}

function initUpdateUI() {
    try {
        const { ipcRenderer } = require('electron');
        const { version } = require('../package.json');
        
        // Set current version
        const currentVersionEl = document.getElementById('current-version');
        if (currentVersionEl) {
            currentVersionEl.textContent = `v${version}`;
        }
        
        // Wire up check for updates button
        const checkUpdatesBtn = document.getElementById('check-updates-btn');
        const updateStatusText = document.getElementById('update-status-text');
        const installUpdateBtn = document.getElementById('install-update-btn');
        const updateProgress = document.getElementById('update-progress');
        const progressFill = document.getElementById('progress-fill');
        const progressText = document.getElementById('progress-text');
        
        // Enable the check button
        if (checkUpdatesBtn) {
            checkUpdatesBtn.disabled = false;
            checkUpdatesBtn.onclick = async () => {
                // Disable button and show checking status
                if (checkUpdatesBtn) checkUpdatesBtn.disabled = true;
                if (updateStatusText) updateStatusText.textContent = 'Checking for updates...';
                
                try {
                    const result = await ipcRenderer.invoke('check-for-updates');
                    if (result.status === 'dev') {
                        // In development mode, auto-updater doesn't work
                        if (updateStatusText) updateStatusText.textContent = 'Auto-updates only work in packaged builds';
                        if (checkUpdatesBtn) checkUpdatesBtn.disabled = false;
                    }
                    // In packaged mode, the auto-update events will update the UI
                    // The button will be re-enabled by the event handlers
                } catch (error) {
                    console.error('Error checking for updates:', error);
                    if (updateStatusText) updateStatusText.textContent = 'Error checking for updates';
                    if (checkUpdatesBtn) checkUpdatesBtn.disabled = false;
                }
            };
        }
        
        // Wire up install button
        if (installUpdateBtn) {
            installUpdateBtn.onclick = () => {
                ipcRenderer.invoke('quit-and-install');
            };
        }
        
        // Listen for auto-update events from main process
        ipcRenderer.on('auto-update', (event, data) => {
            try {
                if (!data) return;
                
                switch (data.status) {
                    case 'checking':
                        if (updateStatusText) updateStatusText.textContent = 'Checking for updates...';
                        if (checkUpdatesBtn) checkUpdatesBtn.disabled = true;
                        if (installUpdateBtn) installUpdateBtn.classList.add('hidden');
                        if (updateProgress) updateProgress.classList.add('hidden');
                        break;
                        
                    case 'available':
                        if (updateStatusText) {
                            const version = data.info?.version || 'unknown';
                            updateStatusText.textContent = `Update available: v${version}`;
                        }
                        if (checkUpdatesBtn) checkUpdatesBtn.disabled = false;
                        if (updateProgress) updateProgress.classList.remove('hidden');
                        break;
                        
                    case 'none':
                        if (updateStatusText) updateStatusText.textContent = 'You are up to date!';
                        if (checkUpdatesBtn) checkUpdatesBtn.disabled = false;
                        if (installUpdateBtn) installUpdateBtn.classList.add('hidden');
                        if (updateProgress) updateProgress.classList.add('hidden');
                        break;
                        
                    case 'downloading':
                        if (updateStatusText) updateStatusText.textContent = 'Downloading update...';
                        if (checkUpdatesBtn) checkUpdatesBtn.disabled = true;
                        if (updateProgress) updateProgress.classList.remove('hidden');
                        if (data.progress) {
                            const percent = Math.round(data.progress.percent);
                            if (progressFill) progressFill.style.width = `${percent}%`;
                            if (progressText) progressText.textContent = `${percent}%`;
                        }
                        break;
                        
                    case 'downloaded':
                        if (updateStatusText) {
                            const version = data.info?.version || 'unknown';
                            updateStatusText.textContent = `Update v${version} ready to install`;
                        }
                        if (checkUpdatesBtn) checkUpdatesBtn.disabled = false;
                        if (installUpdateBtn) installUpdateBtn.classList.remove('hidden');
                        if (updateProgress) updateProgress.classList.add('hidden');
                        break;
                        
                    case 'error':
                        if (updateStatusText) {
                            updateStatusText.textContent = `Error: ${data.error || 'Unknown error'}`;
                        }
                        if (checkUpdatesBtn) checkUpdatesBtn.disabled = false;
                        if (installUpdateBtn) installUpdateBtn.classList.add('hidden');
                        if (updateProgress) updateProgress.classList.add('hidden');
                        break;
                }
            } catch (error) {
                console.error('Error handling auto-update event:', error);
            }
        });
        
        // Initialize with ready status
        if (updateStatusText) updateStatusText.textContent = 'Ready to check for updates';
        
    } catch (error) {
        console.error('Error initializing update UI:', error);
    }
}

function _getDragAfterElement(container, y) {
    const draggableElements = [...container.querySelectorAll('.control-item:not(.dragging)')];
    
    return draggableElements.reduce((closest, child) => {
        const box = child.getBoundingClientRect();
        const offset = y - box.top - box.height / 2;
        
        if (offset < 0 && offset > closest.offset) {
            return { offset: offset, element: child };
        } else {
            return closest;
        }
    }, { offset: Number.NEGATIVE_INFINITY }).element;
}

function handleDragStart(e) {
    // Don't allow drag to start if clicking on rename or remove buttons
    if (e.target.classList.contains('rename-btn') || 
        e.target.classList.contains('remove-btn') ||
        e.target.closest('.rename-btn') || 
        e.target.closest('.remove-btn')) {
        e.preventDefault();
        return false;
    }
    
    draggedElement = e.currentTarget;
    e.currentTarget.classList.add('dragging');
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/html', e.currentTarget.outerHTML);
}

function handleDragEnd(e) {
    const item = e.currentTarget;
    item.classList.remove('dragging');
    
    // Force animation restart by temporarily removing and re-adding it
    // This prevents the jarring jump when animation restarts from 0%
    item.style.animation = 'none';
    
    // Use requestAnimationFrame to ensure the style change takes effect
    requestAnimationFrame(() => {
        requestAnimationFrame(() => {
            item.style.animation = '';
        });
    });
    
    draggedElement = null;
    
    // Clean up drag-over classes
    const controlItems = document.querySelectorAll('#quick-controls .control-item');
    controlItems.forEach(i => {
        i.classList.remove('drag-over');
    });
}

function handleDragOver(e) {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
}

function handleDragEnter(e) {
    e.preventDefault();
    if (e.currentTarget !== draggedElement && e.currentTarget.classList.contains('control-item')) {
        e.currentTarget.classList.add('drag-over');
        dragOverElement = e.currentTarget;
    }
}

function handleDragLeave(e) {
    if (e.currentTarget.classList.contains('control-item')) {
        e.currentTarget.classList.remove('drag-over');
    }
}

function handleDrop(e) {
    e.preventDefault();
    
    if (draggedElement && dragOverElement && draggedElement !== dragOverElement) {
        const controlsGrid = document.getElementById('quick-controls');
        const draggedIndex = Array.from(controlsGrid.children).indexOf(draggedElement);
        const targetIndex = Array.from(controlsGrid.children).indexOf(dragOverElement);
        
        // Reorder the elements
        if (draggedIndex < targetIndex) {
            controlsGrid.insertBefore(draggedElement, dragOverElement.nextSibling);
        } else {
            controlsGrid.insertBefore(draggedElement, dragOverElement);
        }
    }
    
    dragOverElement = null;
}

function setupDragAndDrop() {
    // This function is called on init - drag-and-drop is actually set up when entering reorganize mode
}

function addDragAndDropListeners() {
    try {
        const items = document.querySelectorAll('#quick-controls .control-item');
        
        items.forEach(item => {
            addDragListenersToElement(item);
        });
    } catch (error) {
        console.error('Error adding drag and drop listeners:', error);
    }
}

function removeDragAndDropListeners() {
    try {
        const items = document.querySelectorAll('#quick-controls .control-item');
        items.forEach(item => {
            item.draggable = false;
            item.removeEventListener('dragstart', handleDragStart);
            item.removeEventListener('dragend', handleDragEnd);
            item.removeEventListener('dragover', handleDragOver);
            item.removeEventListener('drop', handleDrop);
            item.removeEventListener('dragenter', handleDragEnter);
            item.removeEventListener('dragleave', handleDragLeave);
        });
    } catch (error) {
        console.error('Error removing drag and drop listeners:', error);
    }
}


module.exports = {
  renderActiveTab,
  updateEntityInUI,
  updateWeatherFromHA,
  populateAreaFilter,
  populateDomainFilters,
  setupEntitySearchInput,
  initUpdateUI,
  updateTimeDisplay,
  updateTimerDisplays,
  setupDragAndDrop,
  toggleReorganizeMode,
  populateQuickControlsList,
  executeHotkeyAction,
};

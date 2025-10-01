const { ipcRenderer } = require('electron');
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
      // Add rename button
      if (!item.querySelector('.rename-btn')) {
        const renameBtn = document.createElement('button');
        renameBtn.className = 'rename-btn';
        renameBtn.innerHTML = '✏️';
        renameBtn.title = 'Rename Entity';
        renameBtn.onclick = (e) => {
          e.stopPropagation();
          showRenameModal(item.dataset.entityId);
        };
        item.appendChild(renameBtn);
      }
      
      // Add remove button
      if (!item.querySelector('.remove-btn')) {
        const removeBtn = document.createElement('button');
        removeBtn.className = 'remove-btn';
        removeBtn.innerHTML = '×';
        removeBtn.title = 'Remove from Quick Access';
        removeBtn.onclick = (e) => {
          e.stopPropagation();
          removeFromQuickAccess(item.dataset.entityId);
        };
        item.appendChild(removeBtn);
      }
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

    // Handle different entity types (matching main branch)
    if (entity.entity_id.startsWith('camera.')) {
      div.onclick = () => {
        if (!isReorganizeMode) camera.openCamera(entity.entity_id);
      };
      div.title = `Click to view ${utils.getEntityDisplayName(entity)}`;
    } else if (entity.entity_id.startsWith('sensor.')) {
      div.onclick = () => {
        if (!isReorganizeMode) showSensorDetails(entity);
      };
      div.title = `${utils.getEntityDisplayName(entity)}: ${utils.getEntityDisplayState(entity)}`;
    } else if (entity.entity_id.startsWith('timer.')) {
      div.onclick = () => {
        if (!isReorganizeMode) toggleEntity(entity);
      };
      div.title = `Click to toggle ${utils.getEntityDisplayName(entity)}`;
    } else if (entity.entity_id.startsWith('light.')) {
      setupLightControls(div, entity);
      div.title = `Click to toggle, hold for brightness control`;
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
    if (entity.entity_id.startsWith('sensor.')) {
      stateDisplay = `<div class="control-state">${state}</div>`;
    } else if (entity.entity_id.startsWith('timer.')) {
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
    }

    // Special layout for timer entities (no icon, larger timer display)
    if (entity.entity_id.startsWith('timer.')) {
      div.innerHTML = `
        <div class="control-info timer-layout">
          <div class="control-name">${name}</div>
          ${stateDisplay}
        </div>
      `;
      div.classList.add('timer-entity');
      div.setAttribute('data-state', entity.state);
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

    const startPress = (e) => {
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

// --- Cameras ---
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
    // Find all timer entities in Quick Access
    const timerElements = document.querySelectorAll('.control-item[data-entity-id^="timer."]');
    
    timerElements.forEach(timerEl => {
      const entityId = timerEl.dataset.entityId;
      const entity = state.STATES[entityId];
      
      if (!entity || entity.state !== 'active') return;
      
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
    });
  } catch (error) {
    // Silent fail - timers will just show static state from entity updates
  }
}

function showBrightnessSlider(light) {
  try {
    const currentBrightness = light.state === 'on' && light.attributes.brightness ? Math.round((light.attributes.brightness / 255) * 100) : 0;
    const modal = document.createElement('div');
    modal.className = 'modal brightness-modal';
    modal.innerHTML = `
      <div class="modal-content">
        <h2>${utils.getEntityDisplayName(light)}</h2>
        <div class="brightness-slider-container">
          <input type="range" min="0" max="100" value="${currentBrightness}" id="brightness-slider">
          <div class="brightness-value" id="brightness-value">${currentBrightness}%</div>
        </div>
        <button id="turn-off-btn">Turn Off</button>
      </div>
    `;
    document.body.appendChild(modal);

    const slider = modal.querySelector('#brightness-slider');
    const valueDisplay = modal.querySelector('#brightness-value');
    if (slider) {
      let debounceTimer;
      slider.addEventListener('input', (e) => {
        const value = parseInt(e.target.value);
        if (valueDisplay) valueDisplay.textContent = `${value}%`;
        
        clearTimeout(debounceTimer);
        debounceTimer = setTimeout(() => {
          const brightness = Math.round((value / 100) * 255);
          if (brightness > 0) {
            websocket.callService('light', 'turn_on', { entity_id: light.entity_id, brightness });
          } else {
            websocket.callService('light', 'turn_off', { entity_id: light.entity_id });
          }
        }, 100);
      });
    }

    const turnOffBtn = modal.querySelector('#turn-off-btn');
    if (turnOffBtn) {
      turnOffBtn.onclick = () => {
        websocket.callService('light', 'turn_off', { entity_id: light.entity_id });
        modal.remove();
      };
    }

    modal.onclick = (e) => { if (e.target === modal) modal.remove(); };
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

function setupEntitySearchInput(inputId, allowedDomains = null) {
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

function initUpdateUI() {
    try {
        // Initialize UI update mechanisms
        updateTimeDisplay();
        setInterval(updateTimeDisplay, 1000);
        
        // Setup drag and drop for reorganize mode
        setupDragAndDrop();
    } catch (error) {
        console.error('Error initializing UI updates:', error);
    }
}

function getDragAfterElement(container, y) {
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
    const animationName = window.getComputedStyle(item).animationName;
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
            item.draggable = true;
            item.addEventListener('dragstart', handleDragStart);
            item.addEventListener('dragend', handleDragEnd);
            item.addEventListener('dragover', handleDragOver);
            item.addEventListener('drop', handleDrop);
            item.addEventListener('dragenter', handleDragEnter);
            item.addEventListener('dragleave', handleDragLeave);
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
};

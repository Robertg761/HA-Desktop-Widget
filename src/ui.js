const { ipcRenderer } = require('electron');
const state = require('./state.js');
const utils = require('./utils.js');
const websocket = require('./websocket.js');
const camera = require('./camera.js');
const uiUtils = require('./ui-utils.js');

let isReorganizeMode = false;
let draggedElement = null;
let dragOverElement = null;

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
    console.error('Error rendering active tab:', error);
  }
}

function updateEntityInUI(entity) {
  try {
    if (!entity) return;
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
    if (!container) return;
    container.innerHTML = '';
    const favorites = state.CONFIG.favoriteEntities || [];
    const entities = favorites.map(id => state.STATES[id]).filter(Boolean);
    
    entities.forEach(entity => {
      const control = createControlElement(entity);
      container.appendChild(control);
    });

    if (isReorganizeMode) {
      container.classList.add('reorganize-mode');
      addDragAndDropListeners();
    }
  } catch (error) {
    console.error('Error rendering quick controls:', error);
  }
}

function createControlElement(entity) {
  try {
    const div = document.createElement('div');
    div.className = 'control-item';
    div.dataset.entityId = entity.entity_id;

    if (entity.entity_id.startsWith('light.')) {
      setupLightControls(div, entity);
    } else {
      div.onclick = (e) => {
        if (!isReorganizeMode) toggleEntity(entity);
      };
    }
    
    const icon = utils.getEntityIcon(entity);
    const name = utils.getEntityDisplayName(entity);
    let stateDisplay = '';

    if (entity.entity_id.startsWith('light.') && entity.state === 'on' && entity.attributes.brightness) {
      const brightness = Math.round((entity.attributes.brightness / 255) * 100);
      stateDisplay = `<div class="control-state">${brightness}%</div>`;
    } else if (entity.entity_id.startsWith('climate.')) {
      const temp = entity.attributes.current_temperature || entity.attributes.temperature;
      if (temp) stateDisplay = `<div class="control-state">${temp}°</div>`;
    } else if (entity.state === 'on' || entity.state === 'off') {
       stateDisplay = `<div class="control-state">${entity.state.charAt(0).toUpperCase() + entity.state.slice(1)}</div>`;
    }

    div.innerHTML = `
      <div class="control-icon">${icon}</div>
      <div class="control-info">
        <div class="control-name">${name}</div>
        ${stateDisplay}
      </div>
    `;
    return div;
  } catch (error) {
    console.error('Error creating control element:', error);
    return document.createElement('div');
  }
}

function setupLightControls(div, entity) {
  try {
    let pressTimer = null;
    let longPressTriggered = false;

    const startPress = () => {
      if (isReorganizeMode) return;
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
                console.log(`No toggle action for domain: ${domain}`);
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

    if (tempEl) tempEl.textContent = `${Math.round(weatherEntity.attributes.temperature || 0)}°`;
    if (conditionEl) conditionEl.textContent = weatherEntity.state || '--';
    if (humidityEl) humidityEl.textContent = `${weatherEntity.attributes.humidity || 0}%`;
    if (windEl) windEl.textContent = `${weatherEntity.attributes.wind_speed || 0} km/h`;
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

function showBrightnessSlider(light) {
  try {
    const currentBrightness = light.state === 'on' && light.attributes.brightness ? Math.round((light.attributes.brightness / 255) * 100) : 0;
    const modal = document.createElement('div');
    modal.className = 'modal brightness-modal';
    modal.innerHTML = `
      <div class="modal-content">
        <h2>${utils.getEntityDisplayName(light)}</h2>
        <input type="range" min="0" max="100" value="${currentBrightness}" id="brightness-slider">
        <button id="turn-off-btn">Turn Off</button>
      </div>
    `;
    document.body.appendChild(modal);

    const slider = modal.querySelector('#brightness-slider');
    if (slider) {
      let debounceTimer;
      slider.addEventListener('input', (e) => {
        clearTimeout(debounceTimer);
        debounceTimer = setTimeout(() => {
          const brightness = Math.round((parseInt(e.target.value) / 100) * 255);
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

function setupDragAndDrop() {
    try {
        // Basic drag and drop setup for reorganize mode
        const container = document.getElementById('quick-controls');
        if (!container) return;
        
        container.addEventListener('dragstart', (e) => {
            if (e.target.classList.contains('control-item')) {
                draggedElement = e.target;
                e.target.style.opacity = '0.5';
            }
        });
        
        container.addEventListener('dragend', (e) => {
            if (e.target.classList.contains('control-item')) {
                e.target.style.opacity = '';
                draggedElement = null;
            }
        });
        
        container.addEventListener('dragover', (e) => {
            e.preventDefault();
            dragOverElement = e.target.closest('.control-item');
        });
        
        container.addEventListener('drop', (e) => {
            e.preventDefault();
            if (draggedElement && dragOverElement && draggedElement !== dragOverElement) {
                const parent = dragOverElement.parentNode;
                const nextSibling = dragOverElement.nextSibling;
                parent.insertBefore(draggedElement, nextSibling);
            }
        });
    } catch (error) {
        console.error('Error setting up drag and drop:', error);
    }
}

function addDragAndDropListeners() {
    try {
        // Add drag and drop listeners when reorganize mode is active
        const container = document.getElementById('quick-controls');
        if (!container) return;
        
        container.querySelectorAll('.control-item').forEach(item => {
            item.draggable = true;
        });
    } catch (error) {
        console.error('Error adding drag and drop listeners:', error);
    }
}


module.exports = {
  renderActiveTab,
  updateEntityInUI,
  handleMotionEvent: () => {},
  updateWeatherFromHA,
  restartTimerUpdates: () => {},
  populateAreaFilter,
  populateServiceExplorer: () => {},
  populateDomainFilters,
  setupEntitySearchInput,
  initUpdateUI,
  updateTimeDisplay,
  updateWeatherDisplay: () => {},
  setupWeatherCardLongPress: () => {},
  setupDragAndDrop,
  addDragAndDropListeners,
};

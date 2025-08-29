const { ipcRenderer } = require('electron');
const axios = require('axios');
const Chart = require('chart.js/auto');
require('chartjs-adapter-date-fns');
const { shouldIgnoreShortcut } = require('./keyboard');

let CONFIG = null;
let WS = null;
let STATES = {};
let SERVICES = {};
let AREAS = {};
let HISTORY_CHART = null;
let CAMERA_REFRESH_INTERVAL = null;
let DASHBOARD_LAYOUT = [];
let EDIT_MODE = false;
let FILTERS = {
  domains: ['light', 'switch', 'sensor', 'climate', 'media_player', 'scene', 'automation', 'camera'],
  areas: [],
  favorites: [],
  hidden: []
};
let THEME_MEDIA_QUERY = null;

// WebSocket connection for real-time updates
function connectWebSocket() {
  if (!CONFIG || !CONFIG.homeAssistant.url || !CONFIG.homeAssistant.token) {
    console.error('Invalid configuration for WebSocket');
    setStatus(false);
    return;
  }
  
  // Close existing connection if any
  if (WS) {
    WS.close();
    WS = null;
  }
  
  const wsUrl = CONFIG.homeAssistant.url.replace(/^http/, 'ws') + '/api/websocket';
  
  try {
    WS = new WebSocket(wsUrl);
  } catch (error) {
    console.error('Failed to create WebSocket:', error);
    setStatus(false);
    return;
  }
  
  let authId = 1;
  
  WS.onopen = () => {
    console.log('WebSocket connected');
  };
  
  WS.onmessage = (event) => {
    try {
      const msg = JSON.parse(event.data);
      
      if (msg.type === 'auth_required') {
        WS.send(JSON.stringify({
          type: 'auth',
          access_token: CONFIG.homeAssistant.token
        }));
      } else if (msg.type === 'auth_ok') {
        console.log('WebSocket authenticated');
        setStatus(true);
        
        // Subscribe to state changes
        WS.send(JSON.stringify({
          id: authId++,
          type: 'subscribe_events',
          event_type: 'state_changed'
        }));
        
        // Get initial states
        WS.send(JSON.stringify({
          id: authId++,
          type: 'get_states'
        }));
        
        // Get services
        WS.send(JSON.stringify({
          id: authId++,
          type: 'get_services'
        }));
        
        // Get areas
        WS.send(JSON.stringify({
          id: authId++,
          type: 'config/area_registry/list'
        }));
      } else if (msg.type === 'auth_invalid') {
        console.error('Invalid authentication token');
        setStatus(false);
      } else if (msg.type === 'event' && msg.event && msg.event.event_type === 'state_changed') {
        const entity = msg.event.data.new_state;
        if (entity) {
          STATES[entity.entity_id] = entity;
          updateEntityInUI(entity);
        }
      } else if (msg.type === 'result' && msg.result) {
        if (Array.isArray(msg.result) && msg.result.length > 0) {
          // Check if it's states or areas
          if (msg.result[0].entity_id) {
            // Initial states
            msg.result.forEach(entity => {
              STATES[entity.entity_id] = entity;
            });
            renderActiveTab();
          } else if (msg.result[0].area_id) {
            // Areas
            msg.result.forEach(area => {
              AREAS[area.area_id] = area;
            });
            populateAreaFilter();
          }
        } else if (typeof msg.result === 'object' && !Array.isArray(msg.result)) {
          // Services
          SERVICES = msg.result;
          populateServiceExplorer();
        }
      }
    } catch (error) {
      console.error('Error processing WebSocket message:', error);
    }
  };
  
  WS.onerror = (error) => {
    console.error('WebSocket error:', error);
    setStatus(false);
  };
  
  WS.onclose = () => {
    console.log('WebSocket disconnected');
    setStatus(false);
    WS = null;
    // Reconnect after 5 seconds
    setTimeout(connectWebSocket, 5000);
  };
}

function setStatus(connected) {
  const status = document.getElementById('connection-status');
  if (status) {
    status.textContent = connected ? '● Connected' : '● Disconnected';
    status.style.color = connected ? '#81c995' : '#f28b82';
  }
}

function setLastUpdate() {
  const el = document.getElementById('last-update');
  if (el) {
    const now = new Date();
    el.textContent = now.toLocaleTimeString();
  }
}

function showLoading(show) {
  const overlay = document.getElementById('loading-overlay');
  if (!overlay) return;
  overlay.classList.toggle('hidden', !show);
}

// Enhanced entity card with more controls (minimal display)
function createEntityCard(entity, options = {}) {
  if (!entity) return null;
  
  const card = document.createElement('div');
  card.className = 'entity-card';
  card.dataset.entityId = entity.entity_id;
  
  // Make draggable in edit mode
  if (EDIT_MODE) {
    card.draggable = true;
    card.classList.add('draggable');
    card.ondragstart = (e) => {
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', entity.entity_id);
      card.classList.add('dragging');
    };
    card.ondragend = () => {
      card.classList.remove('dragging');
    };
  }

  const left = document.createElement('div');
  left.style.flex = '1';
  
  const name = document.createElement('div');
  name.className = 'entity-name';
  const titleText = document.createElement('span');
  titleText.textContent = entity.attributes.friendly_name || entity.entity_id;
  name.appendChild(titleText);

  // Small state badge
  const domain = entity.entity_id.split('.')[0];
  const badge = document.createElement('span');
  badge.className = 'badge';
  badge.title = '';
  if (domain === 'light' || domain === 'switch' || domain === 'input_boolean') {
    const isOn = entity.state === 'on';
    badge.classList.add(isOn ? 'on' : 'off');
    badge.textContent = isOn ? '●' : '○';
    badge.title = isOn ? 'On' : 'Off';
    name.appendChild(badge);
  } else if (domain === 'media_player') {
    const st = entity.state;
    if (st === 'playing') { badge.classList.add('playing'); badge.textContent = '▶'; badge.title = 'Playing'; name.appendChild(badge); }
    else if (st === 'paused') { badge.classList.add('paused'); badge.textContent = '⏸'; badge.title = 'Paused'; name.appendChild(badge); }
    else { badge.classList.add('idle'); badge.textContent = '■'; badge.title = 'Idle'; name.appendChild(badge); }
  } else if (domain === 'automation') {
    const enabled = entity.state === 'on';
    badge.classList.add(enabled ? 'enabled' : 'disabled');
    badge.textContent = enabled ? '⚙️' : '⛔';
    badge.title = enabled ? 'Enabled' : 'Disabled';
    name.appendChild(badge);
  } else if (domain === 'climate') {
    const action = (entity.attributes?.hvac_action || entity.attributes?.hvac_mode || '').toLowerCase();
    if (action.includes('heat')) { badge.classList.add('heating'); badge.textContent = '🔥'; badge.title = 'Heating'; name.appendChild(badge); }
    else if (action.includes('cool')) { badge.classList.add('cooling'); badge.textContent = '❄️'; badge.title = 'Cooling'; name.appendChild(badge); }
    else { badge.classList.add('idle'); badge.textContent = '⏸'; badge.title = 'Idle'; name.appendChild(badge); }
  } else if (domain === 'lock') {
    const locked = entity.state === 'locked';
    badge.classList.add(locked ? 'locked' : 'unlocked');
    badge.textContent = locked ? '🔒' : '🔓';
    badge.title = locked ? 'Locked' : 'Unlocked';
    name.appendChild(badge);
  } else if (domain === 'cover') {
    const st = entity.state;
    if (st === 'open' || st === 'opening') { badge.classList.add(st === 'opening' ? 'opening' : 'open'); badge.textContent = st === 'opening' ? '⬆︎' : '⬆︎'; badge.title = st; name.appendChild(badge); }
    else if (st === 'closed' || st === 'closing') { badge.classList.add(st === 'closing' ? 'closing' : 'closed'); badge.textContent = st === 'closing' ? '⬇︎' : '⬇︎'; badge.title = st; name.appendChild(badge); }
  } else if (domain === 'binary_sensor') {
    const on = entity.state === 'on';
    badge.classList.add(on ? 'alert' : 'off');
    badge.textContent = on ? '●' : '○';
    badge.title = on ? 'Detected' : 'Clear';
    name.appendChild(badge);
  } else if (domain === 'person' || domain === 'device_tracker') {
    const home = entity.state === 'home';
    badge.classList.add(home ? 'home' : 'away');
    badge.textContent = home ? '🏠' : '🧭';
    badge.title = home ? 'Home' : (entity.state || 'Away');
    name.appendChild(badge);
  } else if (domain === 'alarm_control_panel') {
    const st = entity.state;
    if (st && st.startsWith('armed')) { badge.classList.add('armed'); badge.textContent = '🛡️'; badge.title = st.replace('_', ' '); name.appendChild(badge); }
    else if (st === 'disarmed') { badge.classList.add('disarmed'); badge.textContent = '🔓'; badge.title = 'Disarmed'; name.appendChild(badge); }
    else if (st === 'triggered') { badge.classList.add('alert'); badge.textContent = '🚨'; badge.title = 'Triggered'; name.appendChild(badge); }
  } else if (domain === 'fan') {
    const on = entity.state === 'on';
    badge.classList.add(on ? 'on' : 'off');
    badge.textContent = on ? '🌀' : '○';
    badge.title = on ? 'On' : 'Off';
    name.appendChild(badge);
  } else if (domain === 'vacuum') {
    const st = (entity.state || '').toLowerCase();
    if (st.includes('dock')) { badge.classList.add('docked'); badge.textContent = '⚓'; badge.title = 'Docked'; name.appendChild(badge); }
    else if (st.includes('clean')) { badge.classList.add('cleaning'); badge.textContent = '🧹'; badge.title = 'Cleaning'; name.appendChild(badge); }
    else if (st.includes('pause')) { badge.classList.add('paused'); badge.textContent = '⏸'; badge.title = 'Paused'; name.appendChild(badge); }
  }
  left.appendChild(name);

  // Minimal state line: only for sensors and climate
  if (domain === 'sensor') {
    const state = document.createElement('div');
    state.className = 'entity-state big';
    const val = parseFloat(entity.state);
    const stateVal = isNaN(val) ? entity.state : (Math.abs(val) >= 10 ? val.toFixed(0) : val.toFixed(1));
    const unit = entity.attributes?.unit_of_measurement ? ` ${entity.attributes.unit_of_measurement}` : '';
    state.textContent = `${stateVal}${unit}`;
    left.appendChild(state);
  } else if (domain === 'climate') {
    const state = document.createElement('div');
    state.className = 'entity-state big';
    const temp = entity.attributes?.current_temperature ?? entity.attributes?.temperature;
    if (temp !== undefined && temp !== null) {
      state.textContent = `${Math.round(temp)}°`;
      left.appendChild(state);
    }
  }

  const right = document.createElement('div');
  right.className = 'controls';
  right.style.display = 'flex';
  right.style.gap = '8px';
  right.style.alignItems = 'center';

  // Add controls based on entity type
  if (domain === 'light') {
    const btn = document.createElement('button');
    btn.className = 'btn btn-secondary';
    btn.textContent = entity.state === 'on' ? 'Turn off' : 'Turn on';
    btn.onclick = () => toggleEntity(entity.entity_id);
    right.appendChild(btn);

    if (entity.state === 'on' && entity.attributes && entity.attributes.brightness !== undefined) {
      const slider = document.createElement('input');
      slider.type = 'range';
      slider.min = 0;
      slider.max = 255;
      slider.value = entity.attributes.brightness || 0;
      slider.style.width = '100px';
      slider.onchange = () => setBrightness(entity.entity_id, slider.value);
      right.appendChild(slider);
    }
  } else if (domain === 'switch' || domain === 'input_boolean') {
    const btn = document.createElement('button');
    btn.className = 'btn btn-secondary';
    btn.textContent = entity.state === 'on' ? 'Turn off' : 'Turn on';
    btn.onclick = () => toggleEntity(entity.entity_id);
    right.appendChild(btn);
  } else if (domain === 'scene') {
    const btn = document.createElement('button');
    btn.className = 'btn btn-primary';
    btn.textContent = 'Activate';
    btn.onclick = () => activateScene(entity.entity_id);
    right.appendChild(btn);
  } else if (domain === 'automation') {
    const btn = document.createElement('button');
    btn.className = 'btn btn-secondary';
    btn.textContent = entity.state === 'on' ? 'Disable' : 'Enable';
    btn.onclick = () => toggleEntity(entity.entity_id);
    right.appendChild(btn);

    const triggerBtn = document.createElement('button');
    triggerBtn.className = 'btn btn-primary';
    triggerBtn.textContent = 'Trigger';
    triggerBtn.onclick = () => triggerAutomation(entity.entity_id);
    right.appendChild(triggerBtn);
  } else if (domain === 'climate') {
    const controls = document.createElement('div');
    controls.className = 'climate-controls';
    controls.style.display = 'flex';
    controls.style.gap = '6px';

    // Temperature controls
    const tempDown = document.createElement('button');
    tempDown.className = 'btn btn-secondary';
    tempDown.textContent = '-';
    tempDown.onclick = () => adjustClimateTemp(entity.entity_id, -1);

    const tempUp = document.createElement('button');
    tempUp.className = 'btn btn-secondary';
    tempUp.textContent = '+';
    tempUp.onclick = () => adjustClimateTemp(entity.entity_id, 1);

    controls.appendChild(tempDown);
    controls.appendChild(tempUp);
    right.appendChild(controls);
  } else if (domain === 'media_player') {
    right.appendChild(createMediaControls(entity));
  }
  
  // Add remove button in edit mode
  if (EDIT_MODE) {
    const removeBtn = document.createElement('button');
    removeBtn.className = 'btn btn-danger';
    removeBtn.textContent = '×';
    removeBtn.style.marginLeft = '10px';
    removeBtn.onclick = () => removeFromDashboard(entity.entity_id);
    right.appendChild(removeBtn);
  }

  card.appendChild(left);
  card.appendChild(right);

  return card;
}

function createMediaControls(entity) {
  const controls = document.createElement('div');
  controls.className = 'media-controls';
  
  if (entity.state !== 'unavailable' && entity.state !== 'unknown') {
    // Play/Pause
    const playPause = document.createElement('button');
    playPause.className = 'btn btn-secondary';
    playPause.textContent = entity.state === 'playing' ? '⏸' : '▶';
    playPause.onclick = () => callService('media_player', entity.state === 'playing' ? 'media_pause' : 'media_play', { entity_id: entity.entity_id });
    controls.appendChild(playPause);
    
    // Volume
    if (entity.attributes && entity.attributes.volume_level !== undefined) {
      const volumeRow = document.createElement('div');
      volumeRow.className = 'volume-row';
      
      const volumeSlider = document.createElement('input');
      volumeSlider.type = 'range';
      volumeSlider.min = 0;
      volumeSlider.max = 1;
      volumeSlider.step = 0.05;
      volumeSlider.value = entity.attributes.volume_level || 0;
      volumeSlider.style.width = '80px';
      volumeSlider.onchange = () => callService('media_player', 'volume_set', { 
        entity_id: entity.entity_id, 
        volume_level: parseFloat(volumeSlider.value) 
      });
      
      volumeRow.appendChild(volumeSlider);
      controls.appendChild(volumeRow);
    }
  }
  
  return controls;
}

function createCameraCard(entityId) {
  const entity = STATES[entityId];
  if (!entity && !entityId.startsWith('camera.')) return null;
  
  const card = document.createElement('div');
  card.className = 'camera';
  
  const header = document.createElement('div');
  header.className = 'camera-header';
  
  const name = document.createElement('span');
  name.textContent = entity ? (entity.attributes.friendly_name || entityId) : entityId;
  
  const refreshBtn = document.createElement('button');
  refreshBtn.className = 'btn btn-secondary';
  refreshBtn.textContent = '🔄';
  refreshBtn.onclick = () => refreshCamera(entityId);
  
  header.appendChild(name);
  header.appendChild(refreshBtn);
  
  const img = document.createElement('img');
  img.className = 'camera-img';
  img.src = `ha://camera/${entityId}?t=${Date.now()}`;
  img.alt = entity ? (entity.attributes.friendly_name || entityId) : entityId;
  img.onerror = () => {
    img.style.display = 'none';
    const existingError = card.querySelector('.camera-error');
    if (!existingError) {
      const errorMsg = document.createElement('div');
      errorMsg.className = 'camera-error';
      errorMsg.textContent = 'Camera feed unavailable';
      errorMsg.style.padding = '20px';
      errorMsg.style.textAlign = 'center';
      errorMsg.style.color = '#9aa0a6';
      card.appendChild(errorMsg);
    }
  };
  
  card.appendChild(header);
  card.appendChild(img);
  
  return card;
}

function refreshCamera(entityId) {
  const img = document.querySelector(`.camera img[alt*=\"${entityId.split('.')[1]}\"]`);
  if (img) {
    img.src = `ha://camera/${entityId}?t=${Date.now()}`;
  }
}

// Service calls
async function callService(domain, service, data = {}) {
  if (!WS || WS.readyState !== WebSocket.OPEN) {
    console.error('WebSocket not connected');
    return;
  }
  
  try {
    WS.send(JSON.stringify({
      id: Date.now(),
      type: 'call_service',
      domain,
      service,
      service_data: data
    }));
  } catch (error) {
    console.error('Failed to call service:', error);
  }
}

function toggleEntity(entityId) {
  const domain = entityId.split('.')[0];
  const entity = STATES[entityId];
  if (!entity) return;
  
  const service = entity.state === 'on' ? 'turn_off' : 'turn_on';
  callService(domain, service, { entity_id: entityId });
}

function setBrightness(entityId, brightness) {
  callService('light', 'turn_on', { 
    entity_id: entityId, 
    brightness: parseInt(brightness) 
  });
}

function activateScene(entityId) {
  callService('scene', 'turn_on', { entity_id: entityId });
}

function triggerAutomation(entityId) {
  callService('automation', 'trigger', { entity_id: entityId });
}

function adjustClimateTemp(entityId, delta) {
  const entity = STATES[entityId];
  if (!entity || !entity.attributes) return;
  
  const currentTemp = entity.attributes.temperature || 20;
  const newTemp = currentTemp + delta;
  
  callService('climate', 'set_temperature', {
    entity_id: entityId,
    temperature: newTemp
  });
}

// Dashboard customization
function enableEditMode() {
  EDIT_MODE = true;
  document.body.classList.add('edit-mode');
  renderDashboard();
  
  // Add entity selector
  showEntitySelector();
}

function disableEditMode() {
  EDIT_MODE = false;
  document.body.classList.remove('edit-mode');
  hideEntitySelector();
  saveDashboardLayout();
  renderDashboard();
}

function showEntitySelector() {
  let selector = document.getElementById('entity-selector');
  if (!selector) {
    selector = document.createElement('div');
    selector.id = 'entity-selector';
    selector.className = 'entity-selector';
    selector.innerHTML = `
      <h3>Add Entities</h3>
      <input type="text" id="entity-search-add" placeholder="Search entities...">
      <div id="available-entities"></div>
      <button class="btn btn-primary" onclick="disableEditMode()">Done Editing</button>
    `;
    document.body.appendChild(selector);
  }
  
  selector.style.display = 'block';
  
  const searchInput = document.getElementById('entity-search-add');
  const container = document.getElementById('available-entities');
  
  const renderAvailable = (filter = '') => {
    container.innerHTML = '';
    const available = Object.keys(STATES)
      .filter(id => !DASHBOARD_LAYOUT.includes(id))
      .filter(id => id.toLowerCase().includes(filter.toLowerCase()))
      .slice(0, 50);
    
    available.forEach(entityId => {
      const entity = STATES[entityId];
      const item = document.createElement('div');
      item.className = 'entity-item';
      item.innerHTML = `
        <span>${entity.attributes.friendly_name || entityId}</span>
        <button class="btn btn-primary" onclick="addToDashboard('${entityId}')">+</button>
      `;
      container.appendChild(item);
    });
  };
  
  searchInput.oninput = () => renderAvailable(searchInput.value);
  renderAvailable();
}

function hideEntitySelector() {
  const selector = document.getElementById('entity-selector');
  if (selector) {
    selector.style.display = 'none';
  }
}

window.addToDashboard = function(entityId) {
  if (!DASHBOARD_LAYOUT.includes(entityId)) {
    DASHBOARD_LAYOUT.push(entityId);
    renderDashboard();
    showEntitySelector(); // Refresh available list
  }
};

window.removeFromDashboard = function(entityId) {
  const index = DASHBOARD_LAYOUT.indexOf(entityId);
  if (index > -1) {
    DASHBOARD_LAYOUT.splice(index, 1);
    renderDashboard();
    showEntitySelector(); // Refresh available list
  }
};

window.disableEditMode = disableEditMode;

function saveDashboardLayout() {
  CONFIG.dashboardLayout = DASHBOARD_LAYOUT;
  ipcRenderer.invoke('update-config', CONFIG);
}

function setupDragAndDrop() {
  const container = document.getElementById('dashboard-custom');
  if (!container) return;
  
  container.ondragover = (e) => {
    e.preventDefault();
    const dragging = document.querySelector('.dragging');
    const afterElement = getDragAfterElement(container, e.clientY);
    if (afterElement == null) {
      container.appendChild(dragging);
    } else {
      container.insertBefore(dragging, afterElement);
    }
  };
  
  container.ondrop = (e) => {
    e.preventDefault();
    // Update layout order
    const cards = container.querySelectorAll('.entity-card');
    DASHBOARD_LAYOUT = Array.from(cards).map(card => card.dataset.entityId);
    saveDashboardLayout();
  };
}

function getDragAfterElement(container, y) {
  const draggableElements = [...container.querySelectorAll('.entity-card:not(.dragging)')];
  
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

// Filter modal
function showFilterModal() {
  let modal = document.getElementById('filter-modal');
  if (!modal) {
    modal = document.createElement('div');
    modal.id = 'filter-modal';
    modal.className = 'modal';
    modal.setAttribute('role', 'dialog');
    modal.setAttribute('aria-modal', 'true');
    modal.innerHTML = `
      <div class="modal-content modal-scrollable" role="document">
        <h2 id="filter-title">Filter Entities</h2>
        <div class="filter-section">
          <h3>Entity Types</h3>
          <div id="filter-domains" class="checkbox-grid"></div>
        </div>
        <div class="filter-section">
          <h3>Areas</h3>
          <select id="filter-areas" multiple size="6"></select>
          <small>Hold Ctrl to select multiple</small>
        </div>
        <div class="filter-section">
          <h3>Hidden Entities</h3>
          <input type="text" id="hidden-entities" placeholder="entity_id, entity_id">
        </div>
        <div class="modal-buttons">
          <button class="btn btn-primary" onclick="applyFilters()">Apply</button>
          <button class="btn btn-secondary" onclick="closeFilterModal()">Cancel</button>
        </div>
      </div>
    `;
    document.body.appendChild(modal);
  }
  
  // Populate filters
  populateFilterDomains();
  populateFilterAreas();
  
  const hiddenInput = document.getElementById('hidden-entities');
  if (hiddenInput) {
    hiddenInput.value = (FILTERS.hidden || []).join(', ');
  }
  
  modal.style.display = 'grid';
  trapFocus(modal);
}

window.applyFilters = function() {
  // Update domain filters
  const checkboxes = document.querySelectorAll('#filter-domains input[type="checkbox"]');
  FILTERS.domains = Array.from(checkboxes)
    .filter(cb => cb.checked)
    .map(cb => cb.value);
  
  // Update area filters
  const areaSelect = document.getElementById('filter-areas');
  if (areaSelect) {
    FILTERS.areas = Array.from(areaSelect.selectedOptions).map(opt => opt.value);
  }
  
  // Update hidden entities
  const hiddenInput = document.getElementById('hidden-entities');
  if (hiddenInput) {
    FILTERS.hidden = hiddenInput.value.split(',').map(s => s.trim()).filter(Boolean);
  }
  
  CONFIG.filters = FILTERS;
  ipcRenderer.invoke('update-config', CONFIG);
  
  closeFilterModal();
  renderActiveTab();
};

window.closeFilterModal = function() {
  const modal = document.getElementById('filter-modal');
  if (modal) {
    modal.style.display = 'none';
    releaseFocusTrap(modal);
  }
};

function populateFilterDomains() {
  const container = document.getElementById('filter-domains');
  if (!container) return;
  
  container.innerHTML = '';
  const allDomains = [...new Set(Object.keys(STATES).map(id => id.split('.')[0]))].sort();
  
  allDomains.forEach(domain => {
    const label = document.createElement('label');
    label.style.display = 'flex';
    label.style.alignItems = 'center';
    label.style.gap = '4px';
    
    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.value = domain;
    checkbox.checked = FILTERS.domains.includes(domain);
    
    label.appendChild(checkbox);
    label.appendChild(document.createTextNode(domain));
    container.appendChild(label);
  });
}

function populateFilterAreas() {
  const select = document.getElementById('filter-areas');
  if (!select) return;
  
  select.innerHTML = '';
  Object.values(AREAS).forEach(area => {
    const option = document.createElement('option');
    option.value = area.area_id;
    option.textContent = area.name;
    option.selected = FILTERS.areas.includes(area.area_id);
    select.appendChild(option);
  });
}

// Weather widget
function renderWeather() {
  console.log('Rendering weather tab, STATES count:', Object.keys(STATES).length);
  const container = document.getElementById('weather-container');
  if (!container) {
    console.error('Weather container not found');
    return;
  }
  
  container.innerHTML = '';
  
  // Check if STATES is populated
  if (Object.keys(STATES).length === 0) {
    container.innerHTML = '<p style="text-align: center; padding: 20px;">Loading entities...</p>';
    return;
  }
  
  // Find weather entities
  const weatherEntities = Object.values(STATES).filter(e => e.entity_id.startsWith('weather.'));
  
  console.log('Found weather entities:', weatherEntities.length);
  
  if (weatherEntities.length === 0) {
    container.innerHTML = '<p style="padding: 10px; text-align: center;">No weather entities found</p>';
    return;
  }
  
  weatherEntities.forEach(entity => {
    if (!entity.attributes) return;
    
    const widget = document.createElement('div');
    widget.className = 'weather-widget';
    
    const temp = entity.attributes.temperature !== undefined ? `${entity.attributes.temperature}°` : '--°';
    const humidity = entity.attributes.humidity !== undefined ? `${entity.attributes.humidity}%` : '--';
    const pressure = entity.attributes.pressure !== undefined ? `${entity.attributes.pressure} hPa` : '--';
    const windSpeed = entity.attributes.wind_speed !== undefined ? `${entity.attributes.wind_speed} km/h` : '--';
    
    widget.innerHTML = `
      <h4>${entity.attributes.friendly_name || entity.entity_id}</h4>
      <div class="weather-current">
        <span class="weather-temp">${temp}</span>
        <span class="weather-state">${entity.state}</span>
      </div>
      <div class="weather-details">
        <div>Humidity: ${humidity}</div>
        <div>Pressure: ${pressure}</div>
        <div>Wind: ${windSpeed}</div>
      </div>
      <div class="weather-forecast">
        ${(entity.attributes.forecast || []).slice(0, 5).map(day => {
          const date = new Date(day.datetime);
          const dayName = isNaN(date) ? 'N/A' : date.toLocaleDateString('en', { weekday: 'short' });
          const dayTemp = day.temperature !== undefined ? `${day.temperature}°` : '--°';
          return `
            <div class="forecast-day">
              <div>${dayName}</div>
              <div>${dayTemp}</div>
              <div>${day.condition || ''}</div>
            </div>
          `;
        }).join('')}
      </div>
    `;
    container.appendChild(widget);
  });
}

// History graphs
async function renderHistory() {
  const canvas = document.getElementById('history-chart');
  if (!canvas || !CONFIG) return;
  
  // Get sensor entities for graphing
  const sensors = Object.values(STATES)
    .filter(e => e.entity_id.startsWith('sensor.') && e.attributes && e.attributes.unit_of_measurement)
    .slice(0, 5); // Limit to 5 sensors for clarity
  
  if (sensors.length === 0) {
    const container = canvas.parentElement;
    if (container) {
      canvas.style.display = 'none';
      const existingMsg = container.querySelector('p');
      if (!existingMsg) {
        const msg = document.createElement('p');
        msg.textContent = 'No sensors with numerical values found';
        msg.style.textAlign = 'center';
        msg.style.padding = '20px';
        container.appendChild(msg);
      }
    }
    return;
  }
  
  canvas.style.display = 'block';
  
  try {
    // Fetch history for each sensor
    const responses = await Promise.all(sensors.map(sensor => 
      axios.get(`${CONFIG.homeAssistant.url}/api/history/period?filter_entity_id=${sensor.entity_id}`, {
        headers: { Authorization: `Bearer ${CONFIG.homeAssistant.token}` }
      }).catch(err => {
        console.error(`Failed to fetch history for ${sensor.entity_id}:`, err);
        return { data: [[]] };
      })
    ));
    
    const datasets = responses.map((res, i) => {
      const sensor = sensors[i];
      const history = res.data && res.data[0] ? res.data[0] : [];
      
      return {
        label: sensor.attributes.friendly_name || sensor.entity_id,
        data: history.map(point => ({
          x: new Date(point.last_changed),
          y: parseFloat(point.state) || 0
        })).filter(point => !isNaN(point.y)),
        borderColor: `hsl(${i * 60}, 70%, 60%)`,
        backgroundColor: `hsla(${i * 60}, 70%, 60%, 0.1)`,
        tension: 0.1
      };
    }).filter(dataset => dataset.data.length > 0);
    
    if (datasets.length === 0) {
      canvas.style.display = 'none';
      return;
    }
    
  if (HISTORY_CHART) {
    try {
      HISTORY_CHART.destroy();
      HISTORY_CHART = null;
    } catch (e) {
      console.error('Error destroying chart:', e);
      HISTORY_CHART = null;
    }
  }
    
    HISTORY_CHART = new Chart(canvas, {
      type: 'line',
      data: { datasets },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        scales: {
          x: {
            type: 'time',
            time: {
              displayFormats: {
                hour: 'HH:mm'
              }
            }
          }
        },
        plugins: {
          legend: {
            labels: {
              color: '#e8eaed'
            }
          }
        }
      }
    });
  } catch (error) {
    console.error('Error rendering history:', error);
  }
}

// Service explorer
function populateServiceExplorer() {
  const domainSelect = document.getElementById('service-domain');
  const serviceSelect = document.getElementById('service-name');
  
  if (!domainSelect || !serviceSelect) return;
  
  domainSelect.innerHTML = '<option value="">Select domain...</option>';
  Object.keys(SERVICES).sort().forEach(domain => {
    const option = document.createElement('option');
    option.value = domain;
    option.textContent = domain;
    domainSelect.appendChild(option);
  });
  
  domainSelect.onchange = () => {
    const domain = domainSelect.value;
    serviceSelect.innerHTML = '<option value="">Select service...</option>';
    
    if (domain && SERVICES[domain]) {
      Object.keys(SERVICES[domain]).sort().forEach(service => {
        const option = document.createElement('option');
        option.value = service;
        option.textContent = service;
        serviceSelect.appendChild(option);
      });
    }
  };
  
  const runBtn = document.getElementById('run-service');
  if (runBtn) {
    runBtn.onclick = () => {
      const domain = domainSelect.value;
      const service = serviceSelect.value;
      const entityInput = document.getElementById('service-entity');
      const dataInput = document.getElementById('service-data');
      const resultSpan = document.getElementById('service-result');
      
      if (!domain || !service) {
        if (resultSpan) resultSpan.textContent = 'Select domain and service';
        return;
      }
      
      let serviceData = {};
      try {
        if (dataInput && dataInput.value.trim()) {
          serviceData = JSON.parse(dataInput.value);
        }
      } catch (e) {
        if (resultSpan) resultSpan.textContent = 'Invalid JSON';
        return;
      }
      
      if (entityInput && entityInput.value.trim()) {
        serviceData.entity_id = entityInput.value.trim();
      }
      
      callService(domain, service, serviceData);
      if (resultSpan) {
        resultSpan.textContent = '✓ Service called';
        setTimeout(() => { resultSpan.textContent = ''; }, 3000);
      }
    };
  }
}

// Entity inspector
function populateEntityInspector() {
  const searchInput = document.getElementById('entity-search');
  const listContainer = document.getElementById('entity-list');
  
  if (!searchInput || !listContainer) return;
  
  const renderList = (filter = '') => {
    listContainer.innerHTML = '';
    const filtered = Object.values(STATES)
      .filter(e => e.entity_id.toLowerCase().includes(filter.toLowerCase()))
      .slice(0, 50);
    
    filtered.forEach(entity => {
      const card = createEntityCard(entity);
      if (card) listContainer.appendChild(card);
    });
  };
  
  searchInput.oninput = () => renderList(searchInput.value);
  renderList();
}

// Tab navigation
function setupTabs() {
  const tabs = document.querySelectorAll('.tab-btn');
  const contents = document.querySelectorAll('.tab-content');
  
  tabs.forEach(tab => {
    tab.onclick = () => {
      // Stop camera refresh if running
      if (CAMERA_REFRESH_INTERVAL) {
        clearInterval(CAMERA_REFRESH_INTERVAL);
        CAMERA_REFRESH_INTERVAL = null;
      }
      // Deactivate all tabs and contents
      tabs.forEach(t => t.classList.remove('active'));
      contents.forEach(c => {
        c.classList.remove('active');
        c.classList.remove('hidden'); // ensure no hidden leftover
      });
      
      // Activate clicked tab and its content
      tabs.forEach(t => t.setAttribute('aria-selected', 'false'));
      tab.classList.add('active');
      tab.setAttribute('aria-selected', 'true');
      const content = document.getElementById(`${tab.dataset.tab}-tab`);
      if (content) {
        content.classList.remove('hidden');
        content.classList.add('active');
        renderActiveTab();
        // Move focus to the active panel for accessibility
        content.focus();
      }
      // Ensure the active tab is visible in the scrollable nav
      try { tab.scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'nearest' }); } catch (_) {}
    };
  });

  // Keyboard navigation for tabs
  const tabNav = document.querySelector('.tab-navigation');
  if (tabNav) {
    tabNav.addEventListener('keydown', (e) => {
      const currentIndex = Array.from(tabs).findIndex(t => t === document.activeElement);
      let targetIndex = currentIndex;
      if (e.key === 'ArrowRight') { e.preventDefault(); targetIndex = (currentIndex + 1) % tabs.length; }
      else if (e.key === 'ArrowLeft') { e.preventDefault(); targetIndex = (currentIndex - 1 + tabs.length) % tabs.length; }
      else if (e.key === 'Home') { e.preventDefault(); targetIndex = 0; }
      else if (e.key === 'End') { e.preventDefault(); targetIndex = tabs.length - 1; }
      else return;
      tabs[targetIndex].focus();
      tabs[targetIndex].click();
    });

    // Translate vertical mouse wheel to horizontal scroll for easier navigation
    tabNav.addEventListener('wheel', (e) => {
      if (Math.abs(e.deltaY) > Math.abs(e.deltaX)) {
        tabNav.scrollLeft += e.deltaY;
        e.preventDefault();
      }
    }, { passive: false });
  }

  // Scroll buttons
  const leftBtn = document.getElementById('tab-scroll-left');
  const rightBtn = document.getElementById('tab-scroll-right');
  function updateScrollButtons() {
    if (!tabNav) return;
    const maxScroll = tabNav.scrollWidth - tabNav.clientWidth;
    const atStart = tabNav.scrollLeft <= 2;
    const atEnd = tabNav.scrollLeft >= maxScroll - 2;
    if (leftBtn) leftBtn.disabled = atStart;
    if (rightBtn) rightBtn.disabled = atEnd;
  }
  if (leftBtn && rightBtn && tabNav) {
    leftBtn.onclick = () => { tabNav.scrollBy({ left: -160, behavior: 'smooth' }); };
    rightBtn.onclick = () => { tabNav.scrollBy({ left: 160, behavior: 'smooth' }); };
    tabNav.addEventListener('scroll', updateScrollButtons);
    window.addEventListener('resize', updateScrollButtons);
    updateScrollButtons();
  }

  // Ctrl+Tab and Ctrl+Shift+Tab to cycle tabs
  document.addEventListener('keydown', (e) => {
    if (e.ctrlKey && e.key === 'Tab') {
      e.preventDefault();
      const arr = Array.from(tabs);
      const current = arr.findIndex(t => t.classList.contains('active'));
      let next = current + (e.shiftKey ? -1 : 1);
      if (next < 0) next = arr.length - 1;
      if (next >= arr.length) next = 0;
      arr[next].focus();
      arr[next].click();
    }
  });
}

function renderActiveTab() {
  const activeTab = document.querySelector('.tab-btn.active');
  if (!activeTab) return;
  
  switch (activeTab.dataset.tab) {
    case 'dashboard':
      renderDashboard();
      break;
    case 'scenes':
      renderScenes();
      break;
    case 'automations':
      renderAutomations();
      break;
    case 'media':
      renderMediaPlayers();
      break;
    case 'cameras':
      renderCameras();
      break;
    case 'weather':
      renderWeather();
      break;
    case 'history':
      renderHistory();
      break;
    case 'services':
      populateServiceExplorer();
      populateEntityInspector();
      break;
  }
  setLastUpdate();
}

// Render functions for each tab
function renderDashboard() {
  // Check if we have a custom dashboard layout
  if (DASHBOARD_LAYOUT && DASHBOARD_LAYOUT.length > 0) {
    const container = document.getElementById('dashboard-custom');
    if (!container) {
      // Create custom dashboard container
      const dashboardTab = document.getElementById('dashboard-tab');
      dashboardTab.innerHTML = `
        <div class="section">
          <h3 class="section-title">
            My Dashboard
            <button class="btn btn-secondary" style="float: right;" onclick="enableEditMode()">Edit</button>
          </h3>
          <div id="dashboard-custom" class="entity-list"></div>
        </div>
      `;
    }
    
    const customContainer = document.getElementById('dashboard-custom');
    customContainer.innerHTML = '';
    
    DASHBOARD_LAYOUT.forEach(entityId => {
      const entity = STATES[entityId];
      if (entity && !FILTERS.hidden.includes(entityId)) {
        const card = createEntityCard(entity);
        if (card) customContainer.appendChild(card);
      }
    });
    
    setupDragAndDrop();
  } else {
    // Default dashboard
    const dashboardTab = document.getElementById('dashboard-tab');
    let favoritesHTML = '';
    const favs = (CONFIG.favoriteEntities || []).filter(id => STATES[id]);
    if (favs.length > 0) {
      favoritesHTML = `
      <div class="section">
        <h3 class="section-title">Favorites</h3>
        <div id="favorites-list" class="entity-list"></div>
      </div>`;
    }
    dashboardTab.innerHTML = `
      <div class="section">
        <h3 class="section-title">
          Dashboard
          <button class="btn btn-secondary" style="float: right;" onclick="enableEditMode()">Customize</button>
        </h3>
        <p style="text-align: center; padding: 20px;">
          Click "Customize" to create your personalized dashboard
        </p>
      </div>
      ${favoritesHTML}
    `;
    
    if (favs.length > 0) {
      const favList = document.getElementById('favorites-list');
      favs.forEach(id => {
        const e = STATES[id];
        const card = createEntityCard(e);
        if (card) favList.appendChild(card);
      });
    }
  }
}

function renderScenes() {
  console.log('Rendering scenes tab, STATES count:', Object.keys(STATES).length);
  const container = document.getElementById('scenes-container');
  if (!container) {
    console.error('Scenes container not found');
    return;
  }
  
  container.innerHTML = '';
  
  // Check if STATES is populated
  if (Object.keys(STATES).length === 0) {
    container.innerHTML = '<p style="text-align: center; padding: 20px;">Loading entities...</p>';
    return;
  }
  
  const scenes = Object.values(STATES)
    .filter(e => e.entity_id.startsWith('scene.'))
    .filter(e => !FILTERS.hidden.includes(e.entity_id));
  
  console.log('Found scenes:', scenes.length);
  
  if (scenes.length === 0) {
    container.innerHTML = '<p style="text-align: center; padding: 20px;">No scenes found</p>';
    return;
  }
  
  scenes.forEach(scene => {
    const card = createEntityCard(scene);
    if (card) container.appendChild(card);
  });
}

function renderAutomations() {
  console.log('Rendering automations tab, STATES count:', Object.keys(STATES).length);
  const container = document.getElementById('automations-container');
  if (!container) {
    console.error('Automations container not found');
    return;
  }
  
  container.innerHTML = '';
  
  // Check if STATES is populated
  if (Object.keys(STATES).length === 0) {
    container.innerHTML = '<p style="text-align: center; padding: 20px;">Loading entities...</p>';
    return;
  }
  
  const automations = Object.values(STATES)
    .filter(e => e.entity_id.startsWith('automation.'))
    .filter(e => !FILTERS.hidden.includes(e.entity_id));
  
  console.log('Found automations:', automations.length);
  
  if (automations.length === 0) {
    container.innerHTML = '<p style="text-align: center; padding: 20px;">No automations found</p>';
    return;
  }
  
  automations.forEach(automation => {
    const card = createEntityCard(automation);
    if (card) container.appendChild(card);
  });
}

function renderMediaPlayers() {
  console.log('Rendering media tab, STATES count:', Object.keys(STATES).length);
  const container = document.getElementById('media-players-container');
  if (!container) {
    console.error('Media players container not found');
    return;
  }
  
  container.innerHTML = '';
  
  // Check if STATES is populated
  if (Object.keys(STATES).length === 0) {
    container.innerHTML = '<p style="text-align: center; padding: 20px;">Loading entities...</p>';
    return;
  }
  
  const players = Object.values(STATES)
    .filter(e => e.entity_id.startsWith('media_player.'))
    .filter(e => !FILTERS.hidden.includes(e.entity_id));
  
  console.log('Found media players:', players.length);
  
  if (players.length === 0) {
    container.innerHTML = '<p style="text-align: center; padding: 20px;">No media players found</p>';
    return;
  }
  
  players.forEach(player => {
    const card = createEntityCard(player);
    if (card) container.appendChild(card);
  });
}

function renderCameras() {
  const container = document.getElementById('cameras-container');
  if (!container) return;
  
  container.innerHTML = '';
  
  // Clear existing interval
  if (CAMERA_REFRESH_INTERVAL) {
    clearInterval(CAMERA_REFRESH_INTERVAL);
    CAMERA_REFRESH_INTERVAL = null;
  }
  
  // Get camera entities from config or auto-detect
  let cameraIds = [];
  
  if (CONFIG.cameraEntities && CONFIG.cameraEntities.length > 0) {
    cameraIds = CONFIG.cameraEntities;
  } else {
    cameraIds = Object.keys(STATES).filter(id => id.startsWith('camera.'));
  }
  
  cameraIds = cameraIds.filter(id => !FILTERS.hidden.includes(id));
  
  if (cameraIds.length === 0) {
    container.innerHTML = '<p style="text-align: center; padding: 20px;">No cameras found</p>';
    return;
  }
  
  cameraIds.forEach(entityId => {
    const card = createCameraCard(entityId);
    if (card) container.appendChild(card);
  });
  
  // Auto-refresh cameras every 10 seconds
  CAMERA_REFRESH_INTERVAL = setInterval(() => {
    cameraIds.forEach(refreshCamera);
  }, 10000);
}

function updateEntityInUI(entity) {
  if (!entity) return;
  
  // Update entity card if it exists
  const cards = document.querySelectorAll(`.entity-card[data-entity-id="${entity.entity_id}"]`);
  cards.forEach(card => {
    const newCard = createEntityCard(entity);
    if (newCard) card.replaceWith(newCard);
  });
  setLastUpdate();
}

// Filter and area management
function populateAreaFilter() {
  const select = document.getElementById('area-select');
  if (!select) return;
  
  const currentValues = Array.from(select.selectedOptions).map(opt => opt.value);
  
  select.innerHTML = '';
  Object.values(AREAS).forEach(area => {
    const option = document.createElement('option');
    option.value = area.area_id;
    option.textContent = area.name;
    option.selected = currentValues.includes(area.area_id);
    select.appendChild(option);
  });
}

function populateDomainFilters() {
  const container = document.getElementById('domain-filters');
  if (!container) return;
  
  container.innerHTML = '';
  const allDomains = [...new Set(Object.keys(STATES).map(id => id.split('.')[0]))].sort();
  
  allDomains.forEach(domain => {
    const label = document.createElement('label');
    label.style.display = 'flex';
    label.style.alignItems = 'center';
    label.style.gap = '4px';
    
    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.value = domain;
    checkbox.checked = FILTERS.domains.includes(domain);
    
    label.appendChild(checkbox);
    label.appendChild(document.createTextNode(domain));
    container.appendChild(label);
  });
}

// Settings management
async function openSettings() {
  const modal = document.getElementById('settings-modal');
  if (!modal) return;
  
  const urlInput = document.getElementById('ha-url');
  const tokenInput = document.getElementById('ha-token');
  const intervalInput = document.getElementById('update-interval');
  const alwaysOnTop = document.getElementById('always-on-top');
  const favoritesInput = document.getElementById('favorite-entities');
  const camerasInput = document.getElementById('camera-entities');
  const showDetails = document.getElementById('show-details');
  const themeSelect = document.getElementById('theme-select');
  const highContrast = document.getElementById('high-contrast');
  const opaquePanels = document.getElementById('opaque-panels');
  const opacitySlider = document.getElementById('opacity-slider');
  const opacityValue = document.getElementById('opacity-value');

  if (urlInput) urlInput.value = CONFIG.homeAssistant.url || '';
  if (tokenInput) tokenInput.value = CONFIG.homeAssistant.token || '';
  if (intervalInput) intervalInput.value = Math.max(1, Math.round((CONFIG.updateInterval || 5000) / 1000));
  if (alwaysOnTop) alwaysOnTop.checked = CONFIG.alwaysOnTop !== false;
  if (favoritesInput) favoritesInput.value = (CONFIG.favoriteEntities || []).join(', ');
  if (camerasInput) camerasInput.value = (CONFIG.cameraEntities || []).join(', ');
  if (opacitySlider) {
    opacitySlider.value = CONFIG.opacity || 0.95;
    if (opacityValue) opacityValue.textContent = `${Math.round((CONFIG.opacity || 0.95) * 100)}%`;
  }

  if (showDetails) {
    showDetails.checked = !!(CONFIG.ui && CONFIG.ui.showDetails);
  }
  if (themeSelect) {
    themeSelect.value = (CONFIG.ui && CONFIG.ui.theme) || 'auto';
  }
  if (highContrast) {
    highContrast.checked = !!(CONFIG.ui && CONFIG.ui.highContrast);
  }
  if (opaquePanels) {
    opaquePanels.checked = !!(CONFIG.ui && CONFIG.ui.opaquePanels);
  }
  const densitySelect = document.getElementById('density-select');
  if (densitySelect) {
    densitySelect.value = (CONFIG.ui && CONFIG.ui.density) || 'comfortable';
  }

  populateDomainFilters();
  populateAreaFilter();

  modal.classList.remove('hidden');
  modal.style.display = 'grid';
  trapFocus(modal);
}

function closeSettings() {
  const modal = document.getElementById('settings-modal');
  if (modal) {
    modal.classList.add('hidden');
    modal.style.display = 'none';
    releaseFocusTrap(modal);
  }
}

async function saveSettings() {
  const urlInput = document.getElementById('ha-url');
  const tokenInput = document.getElementById('ha-token');
  const intervalInput = document.getElementById('update-interval');
  const alwaysOnTop = document.getElementById('always-on-top');
  const favoritesInput = document.getElementById('favorite-entities');
  const camerasInput = document.getElementById('camera-entities');
  const showDetails = document.getElementById('show-details');
  const themeSelect = document.getElementById('theme-select');
  const highContrast = document.getElementById('high-contrast');
  const opaquePanels = document.getElementById('opaque-panels');
  const densitySelect = document.getElementById('density-select');
  
  if (urlInput) CONFIG.homeAssistant.url = urlInput.value.trim();
  if (tokenInput) CONFIG.homeAssistant.token = tokenInput.value.trim();
  if (intervalInput) CONFIG.updateInterval = Math.max(1000, parseInt(intervalInput.value, 10) * 1000);
  if (alwaysOnTop) CONFIG.alwaysOnTop = alwaysOnTop.checked;
  if (favoritesInput) CONFIG.favoriteEntities = favoritesInput.value.split(',').map(s => s.trim()).filter(Boolean);
  if (camerasInput) CONFIG.cameraEntities = camerasInput.value.split(',').map(s => s.trim()).filter(Boolean);

  // UI preferences
  CONFIG.ui = CONFIG.ui || {};
  if (showDetails) CONFIG.ui.showDetails = !!showDetails.checked;
  if (themeSelect) CONFIG.ui.theme = themeSelect.value || 'auto';
  if (highContrast) CONFIG.ui.highContrast = !!highContrast.checked;
  if (opaquePanels) CONFIG.ui.opaquePanels = !!opaquePanels.checked;
  if (densitySelect) CONFIG.ui.density = densitySelect.value || 'comfortable';
  
  // Update domain filters
  const checkboxes = document.querySelectorAll('#domain-filters input[type="checkbox"]');
  FILTERS.domains = Array.from(checkboxes)
    .filter(cb => cb.checked)
    .map(cb => cb.value);
  
  // Update area filters
  const areaSelect = document.getElementById('area-select');
  if (areaSelect) {
    FILTERS.areas = Array.from(areaSelect.selectedOptions).map(opt => opt.value);
  }
  
  CONFIG.filters = FILTERS;
  
  try {
    await ipcRenderer.invoke('update-config', CONFIG);
    closeSettings();
    
    // Apply UI changes
    applyTheme(CONFIG.ui?.theme || 'auto');
    applyUiPreferences(CONFIG.ui || {});
    
    // Reconnect WebSocket with new config
    connectWebSocket();
  } catch (error) {
    console.error('Failed to save config:', error);
  }
}

// Wire up UI controls
function wireUI() {
  const settingsBtn = document.getElementById('settings-btn');
  if (settingsBtn) settingsBtn.onclick = openSettings;
  
  const filterBtn = document.getElementById('filter-btn');
  if (filterBtn) filterBtn.onclick = showFilterModal;
  
  const layoutBtn = document.getElementById('layout-btn');
  if (layoutBtn) layoutBtn.onclick = enableEditMode;
  
  const refreshBtn = document.getElementById('refresh-btn');
  if (refreshBtn) refreshBtn.onclick = renderActiveTab;
  
  const closeBtn = document.getElementById('close-btn');
  if (closeBtn) closeBtn.onclick = () => window.close();
  
  const minimizeBtn = document.getElementById('minimize-btn');
  if (minimizeBtn) {
    minimizeBtn.onclick = () => {
      ipcRenderer.invoke('minimize-window');
    };
  }

  const opacitySlider = document.getElementById('opacity-slider');
  const opacityValue = document.getElementById('opacity-value');
  if (opacitySlider && opacityValue) {
    opacitySlider.oninput = () => {
      const v = parseFloat(opacitySlider.value);
      opacityValue.textContent = `${Math.round(v * 100)}%`;
      ipcRenderer.invoke('set-opacity', v);
    };
  }
  
  const saveSettingsBtn = document.getElementById('save-settings');
  if (saveSettingsBtn) saveSettingsBtn.onclick = saveSettings;
  
  const cancelSettingsBtn = document.getElementById('cancel-settings');
  if (cancelSettingsBtn) cancelSettingsBtn.onclick = closeSettings;
  
  setupTabs();
}

function showToast(message, type = 'success', timeout = 2000) {
  const container = document.getElementById('toast-container');
  if (!container) return;
  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  toast.textContent = message;
  container.appendChild(toast);
  setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transition = 'opacity 0.3s';
    setTimeout(() => container.removeChild(toast), 300);
  }, timeout);
}

function applyTheme(mode = 'auto') {
  const body = document.body;
  body.classList.remove('theme-dark', 'theme-light');
  if (mode === 'dark') {
    body.classList.add('theme-dark');
  } else if (mode === 'light') {
    body.classList.add('theme-light');
  } else {
    const prefersDark = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
    body.classList.add(prefersDark ? 'theme-dark' : 'theme-light');
  }
}

function applyUiPreferences(ui = {}) {
  const body = document.body;
  body.classList.toggle('high-contrast', !!ui.highContrast);
  body.classList.toggle('opaque-panels', !!ui.opaquePanels);
  body.classList.toggle('density-compact', (ui.density || 'comfortable') === 'compact');
}

// Focus trap for modals
let lastFocusedElement = null;
const focusTrapHandlers = new WeakMap();

function trapFocus(modal) {
  lastFocusedElement = document.activeElement;
  const focusable = modal.querySelectorAll('a[href], button, textarea, input, select, [tabindex]:not([tabindex="-1"])');
  const first = focusable[0];
  const last = focusable[focusable.length - 1];
  const handler = (e) => {
    if (e.key !== 'Tab') return;
    if (focusable.length === 0) return;
    if (e.shiftKey) {
      if (document.activeElement === first) { e.preventDefault(); last.focus(); }
    } else {
      if (document.activeElement === last) { e.preventDefault(); first.focus(); }
    }
  };
  modal.addEventListener('keydown', handler);
  focusTrapHandlers.set(modal, handler);
  setTimeout(() => first?.focus(), 0);
}
function releaseFocusTrap(modal) {
  const handler = focusTrapHandlers.get(modal);
  if (handler) modal.removeEventListener('keydown', handler);
  focusTrapHandlers.delete(modal);
  if (lastFocusedElement && lastFocusedElement.focus) {
    setTimeout(() => lastFocusedElement.focus(), 0);
  }
}

// Initialize
async function init() {
  try {
    showLoading(true);
    CONFIG = await ipcRenderer.invoke('get-config');
    
    if (!CONFIG) {
      console.error('Failed to load configuration');
      showLoading(false);
      return;
    }
    
    if (CONFIG.filters) {
      FILTERS = { ...FILTERS, ...CONFIG.filters };
    }
    
    if (CONFIG.dashboardLayout) {
      DASHBOARD_LAYOUT = CONFIG.dashboardLayout;
    }
    
    // Apply theme
    applyTheme((CONFIG.ui && CONFIG.ui.theme) || 'auto');
    applyUiPreferences(CONFIG.ui || {});
    if (window.matchMedia) {
      THEME_MEDIA_QUERY = window.matchMedia('(prefers-color-scheme: dark)');
      THEME_MEDIA_QUERY.addEventListener('change', () => {
        if (((CONFIG.ui && CONFIG.ui.theme) || 'auto') === 'auto') {
          applyTheme('auto');
        }
      });
    }

    wireUI();
    connectWebSocket();

    // Global modal close handlers
    document.addEventListener('click', (e) => {
      if (e.target.classList && e.target.classList.contains('modal')) {
        if (e.target.id === 'settings-modal') closeSettings();
        if (e.target.id === 'filter-modal') window.closeFilterModal?.();
      }
    });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      closeSettings();
      window.closeFilterModal?.();
    }
  });
  
  // Global Ctrl+Tab guard & handler
  document.addEventListener('keydown', (e) => {
    if (!(e.ctrlKey && e.key === 'Tab')) return;
    const target = e.target;
    if (shouldIgnoreShortcut(target)) { return; }
    e.preventDefault();
    const tabs = Array.from(document.querySelectorAll('.tab-btn'));
    const current = tabs.findIndex(t => t.classList.contains('active'));
    let next = current + (e.shiftKey ? -1 : 1);
    if (next < 0) next = tabs.length - 1;
    if (next >= tabs.length) next = 0;
    tabs[next].focus();
    tabs[next].click();
  });
    
    // Initial render after a short delay to ensure DOM is ready
    setTimeout(() => {
      renderActiveTab();
      showLoading(false);
    }, 100);
  } catch (error) {
    console.error('Initialization error:', error);
    showLoading(false);
  }
}

// Auto-update notifications from main
ipcRenderer.on('auto-update', (_e, payload) => {
  const st = payload?.status;
  if (st === 'checking') showToast('Checking for updates...', 'success', 1200);
  else if (st === 'available') showToast('Update available. Downloading...', 'success', 2500);
  else if (st === 'none') showToast('You are up to date.', 'success', 2000);
  else if (st === 'downloading') {
    // Optionally show progress every few seconds (skip to avoid spam)
  } else if (st === 'downloaded') {
    showToast('Update ready. It will install on quit.', 'success', 4000);
  } else if (st === 'error') {
    showToast('Update error. See logs for details.', 'error', 3000);
  }
});

// Open settings from tray
ipcRenderer.on('open-settings', () => {
  openSettings();
});

window.addEventListener('DOMContentLoaded', init);

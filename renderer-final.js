const { ipcRenderer } = require('electron');
const axios = require('axios');
const Chart = require('chart.js/auto');
let __chartDateAdapterLoaded = false;
try {
  require('chartjs-adapter-date-fns');
  __chartDateAdapterLoaded = true;
} catch (e) {
  console.warn('Chart.js date adapter not loaded:', e?.message || e);
}
let Hls = null;
try {
  Hls = require('hls.js');
} catch (e) {
  console.warn('hls.js not available:', e?.message || e);
}
const { shouldIgnoreShortcut } = require('./keyboard');

let CONFIG = null;
let WS = null;
const PENDING_WS = new Map();
let WS_ID = 1000;
let STATES = {};
let SERVICES = {};
let AREAS = {};
let HISTORY_CHART = null;
let CAMERA_REFRESH_INTERVAL = null;
let LIVE_CAMERAS = new Set();
const LIVE_SNAPSHOT_INTERVALS = new Map();
const ACTIVE_HLS = new Map();
let TAB_LAYOUTS = {};
let DRAG_PLACEHOLDER = null;
let EDIT_SNAPSHOT_LAYOUTS = {};
// Motion popup state
const DASHBOARD_CAMERA_EXPANDED = new Set();
const TIMER_MAP = new Map();
let TIMER_TICK = null;

// Timer sensor tracking for real-time countdown
const TIMER_SENSOR_MAP = new Map();
let TIMER_SENSOR_TICK = null;
let TIMER_SENSOR_SYNC_TICK = null;
// Motion popup state
let MOTION_POPUP = null;
let MOTION_POPUP_TIMER = null;
let MOTION_POPUP_CAMERA = null;
const MOTION_LAST_TRIGGER = new Map();
let EDIT_MODE_TAB_ID = null;
let FILTERS = {
  domains: ['light', 'switch', 'sensor', 'climate', 'media_player', 'scene', 'automation', 'camera'],
  areas: [],
  favorites: [],
  hidden: []
};
let THEME_MEDIA_QUERY = null;

// Window function definitions (moved here to avoid hoisting issues)
window.addToDashboard = function(entityId, tabId) {
  if (!CONFIG.favoriteEntities) CONFIG.favoriteEntities = [];
  if (!CONFIG.favoriteEntities.includes(entityId)) {
    CONFIG.favoriteEntities.push(entityId);
    ipcRenderer.invoke('update-config', CONFIG);
    renderActiveTab();
    if (isReorganizeMode) {
      const controlsGrid = document.getElementById('quick-controls');
      if (controlsGrid) controlsGrid.classList.add('reorganize-mode');
      addDragAndDropListeners();
    }
    showToast(`Added ${entityId} to dashboard`, 'success');
    // Refresh the entity selector if it's open
    if (!document.getElementById('entity-selector').classList.contains('hidden')) {
      loadEntitySelector();
    }
  }
};

window.removeFromDashboard = function(entityId, tabId) {
  if (CONFIG.favoriteEntities) {
    const index = CONFIG.favoriteEntities.indexOf(entityId);
    if (index > -1) {
      CONFIG.favoriteEntities.splice(index, 1);
      ipcRenderer.invoke('update-config', CONFIG);
      renderActiveTab();
      showToast(`Removed ${entityId} from dashboard`, 'info');
      // Refresh the entity selector if it's open
      if (!document.getElementById('entity-selector').classList.contains('hidden')) {
        loadEntitySelector();
      }
    }
  }
};

window.addToQuickControls = async function(entityId) {
  if (!CONFIG.favoriteEntities) CONFIG.favoriteEntities = [];
  if (!CONFIG.favoriteEntities.includes(entityId)) {
    CONFIG.favoriteEntities.push(entityId);
    
    // Immediately update the button state
    updateQuickControlButton(entityId, true);
    
    await ipcRenderer.invoke('update-config', CONFIG);
    
    // Immediately refresh the UI
    renderActiveTab();
    
    // Re-add drag and drop listeners if in reorganize mode
    if (isReorganizeMode) {
      addDragAndDropListeners();
    }
    
    // Refresh the quick controls selector if it's open
    if (!document.getElementById('quick-controls-modal').classList.contains('hidden')) {
      // Preserve current search term
      const searchInput = document.getElementById('quick-controls-search');
      const currentSearch = searchInput ? searchInput.value : '';
      
      // Force reload the entire modal to update button states
      loadQuickControlsSelector();
      
      // Restore search term if there was one
      if (searchInput && currentSearch) {
        searchInput.value = currentSearch;
        searchInput.dispatchEvent(new Event('input'));
      }
    }
    
    showToast(`Added ${entityId} to quick access`, 'success');
  }
};

window.removeFromQuickControls = async function(entityId) {
  if (CONFIG.favoriteEntities) {
    const index = CONFIG.favoriteEntities.indexOf(entityId);
    if (index > -1) {
      CONFIG.favoriteEntities.splice(index, 1);
      
      // Immediately update the button state
      updateQuickControlButton(entityId, false);
      
      await ipcRenderer.invoke('update-config', CONFIG);
      
      // Immediately refresh the UI
      renderActiveTab();
      // If still in reorganize mode, keep it active after re-render
      if (isReorganizeMode) {
        const controlsGrid = document.getElementById('quick-controls');
        if (controlsGrid) controlsGrid.classList.add('reorganize-mode');
        addDragAndDropListeners();
      }
      
      // Re-add drag and drop listeners if in reorganize mode
      if (isReorganizeMode) {
        addDragAndDropListeners();
      }
      
      // Refresh the quick controls selector if it's open
      if (!document.getElementById('quick-controls-modal').classList.contains('hidden')) {
        // Preserve current search term
        const searchInput = document.getElementById('quick-controls-search');
        const currentSearch = searchInput ? searchInput.value : '';
        
        // Force reload the entire modal to update button states
        loadQuickControlsSelector();
        
        // Restore search term if there was one
        if (searchInput && currentSearch) {
          searchInput.value = currentSearch;
          searchInput.dispatchEvent(new Event('input'));
        }
      }
      
      showToast(`Removed ${entityId} from quick access`, 'info');
    }
  }
};

// Function to immediately update a quick control button state
function updateQuickControlButton(entityId, isAdded) {
  // Find the button for this entity in the quick controls modal
  const container = document.getElementById('quick-controls-list');
  if (!container) return;
  
  const item = container.querySelector(`[data-entity-id="${entityId}"]`);
  if (!item) return;
  
  const actionsDiv = item.querySelector('.entity-selector-actions');
  if (!actionsDiv) return;
  
  // Update the button
  if (isAdded) {
    // Change to Remove button
    actionsDiv.innerHTML = `<button class="entity-selector-btn remove" onclick="removeFromQuickControls('${entityId}')">Remove</button>`;
  } else {
    // Change to Add button
    actionsDiv.innerHTML = `<button class="entity-selector-btn add" onclick="addToQuickControls('${entityId}')">Add</button>`;
  }
}

// Reorganize mode functionality
let isReorganizeMode = false;
let draggedElement = null;
let dragOverElement = null;

function toggleReorganizeMode() {
  isReorganizeMode = !isReorganizeMode;
  const reorganizeBtn = document.getElementById('reorganize-quick-controls-btn');
  const controlsGrid = document.getElementById('quick-controls');
  
  if (isReorganizeMode) {
    // Enter reorganize mode
    reorganizeBtn.classList.add('active');
    controlsGrid.classList.add('reorganize-mode');
    showToast('Reorganize mode: Drag and drop to reorder', 'info');
    
    // Add drag and drop event listeners to all control items
    addDragAndDropListeners();
  } else {
    // Exit reorganize mode
    reorganizeBtn.classList.remove('active');
    controlsGrid.classList.remove('reorganize-mode');
    showToast('Reorganize mode disabled', 'info');
    
    // Remove drag and drop event listeners
    removeDragAndDropListeners();
  }
}

function addDragAndDropListeners() {
  const controlItems = document.querySelectorAll('#quick-controls .control-item');
  controlItems.forEach(item => {
    item.draggable = true;
    item.addEventListener('dragstart', handleDragStart);
    item.addEventListener('dragend', handleDragEnd);
    item.addEventListener('dragover', handleDragOver);
    item.addEventListener('drop', handleDrop);
    item.addEventListener('dragenter', handleDragEnter);
    item.addEventListener('dragleave', handleDragLeave);
    
    // Add remove button if not already present
    if (!item.querySelector('.remove-btn')) {
      const removeBtn = document.createElement('button');
      removeBtn.className = 'remove-btn';
      removeBtn.innerHTML = '×';
      removeBtn.title = 'Remove from Quick Access';
      removeBtn.onclick = (e) => {
        e.stopPropagation();
        const entityId = item.dataset.entityId;
        if (entityId) {
          removeFromQuickControls(entityId);
        }
      };
      item.appendChild(removeBtn);
    }
    
    // Add rename button if not already present
    if (!item.querySelector('.rename-btn')) {
      const renameBtn = document.createElement('button');
      renameBtn.className = 'rename-btn';
      renameBtn.innerHTML = '✏️';
      renameBtn.title = 'Rename entity';
      renameBtn.onclick = (e) => {
        e.stopPropagation();
        const entityId = item.dataset.entityId;
        if (entityId) {
          openRenameModal(entityId);
        }
      };
      item.appendChild(renameBtn);
    }
  });
}

function removeDragAndDropListeners() {
  const controlItems = document.querySelectorAll('#quick-controls .control-item');
  controlItems.forEach(item => {
    item.draggable = false;
    item.removeEventListener('dragstart', handleDragStart);
    item.removeEventListener('dragend', handleDragEnd);
    item.removeEventListener('dragover', handleDragOver);
    item.removeEventListener('drop', handleDrop);
    item.removeEventListener('dragenter', handleDragEnter);
    item.removeEventListener('dragleave', handleDragLeave);
    item.classList.remove('dragging', 'drag-over');
    
    // Remove remove and rename buttons
    const removeBtn = item.querySelector('.remove-btn');
    if (removeBtn) {
      removeBtn.remove();
    }
    const renameBtn = item.querySelector('.rename-btn');
    if (renameBtn) {
      renameBtn.remove();
    }
  });
}

function openRenameModal(entityId) {
  const entity = STATES[entityId];
  if (!entity) return;
  
  const currentName = getEntityDisplayName(entity);
  
  // Create modal
  const modal = document.createElement('div');
  modal.className = 'modal rename-modal';
  modal.innerHTML = `
    <div class="modal-content">
      <h3>Rename Entity</h3>
      <p>Entity: <code>${entityId}</code></p>
      <div class="form-group">
        <label for="rename-input">Display Name:</label>
        <input type="text" id="rename-input" value="${currentName}" maxlength="50" placeholder="Enter custom name">
      </div>
      <div class="modal-actions">
        <button id="rename-save" class="btn btn-primary">Save</button>
        <button id="rename-cancel" class="btn btn-secondary">Cancel</button>
        <button id="rename-reset" class="btn btn-secondary">Reset to Default</button>
      </div>
    </div>
  `;
  
  document.body.appendChild(modal);
  
  // Focus input and select text
  const input = modal.querySelector('#rename-input');
  input.focus();
  input.select();
  
  // Event handlers
  modal.querySelector('#rename-save').onclick = () => {
    const newName = input.value.trim();
    if (newName && newName !== currentName) {
      saveCustomEntityName(entityId, newName);
    }
    modal.remove();
  };
  
  modal.querySelector('#rename-cancel').onclick = () => {
    modal.remove();
  };
  
  modal.querySelector('#rename-reset').onclick = () => {
    resetCustomEntityName(entityId);
    modal.remove();
  };
  
  // Close on escape
  const handleKeydown = (e) => {
    if (e.key === 'Escape') {
      modal.remove();
      document.removeEventListener('keydown', handleKeydown);
    } else if (e.key === 'Enter') {
      const newName = input.value.trim();
      if (newName && newName !== currentName) {
        saveCustomEntityName(entityId, newName);
      }
      modal.remove();
      document.removeEventListener('keydown', handleKeydown);
    }
  };
  document.addEventListener('keydown', handleKeydown);
  
  // Close on backdrop click
  modal.onclick = (e) => {
    if (e.target === modal) {
      modal.remove();
      document.removeEventListener('keydown', handleKeydown);
    }
  };
}

async function saveCustomEntityName(entityId, customName) {
  if (!CONFIG.customEntityNames) {
    CONFIG.customEntityNames = {};
  }
  CONFIG.customEntityNames[entityId] = customName;
  
  await ipcRenderer.invoke('update-config', CONFIG);
  
  // Refresh the UI to show the new name
  renderActiveTab();
  
  // Re-add drag and drop listeners if in reorganize mode
  if (isReorganizeMode) {
    addDragAndDropListeners();
  }
  
  showToast(`Renamed ${entityId} to "${customName}"`, 'success');
}

async function resetCustomEntityName(entityId) {
  if (CONFIG.customEntityNames && CONFIG.customEntityNames[entityId]) {
    delete CONFIG.customEntityNames[entityId];
    
    await ipcRenderer.invoke('update-config', CONFIG);
    
    // Refresh the UI to show the default name
    renderActiveTab();
    
    // Re-add drag and drop listeners if in reorganize mode
    if (isReorganizeMode) {
      addDragAndDropListeners();
    }
    
    showToast(`Reset ${entityId} to default name`, 'info');
  }
}

function handleDragStart(e) {
  draggedElement = e.target;
  e.target.classList.add('dragging');
  e.dataTransfer.effectAllowed = 'move';
  e.dataTransfer.setData('text/html', e.target.outerHTML);
}

function handleDragEnd(e) {
  e.target.classList.remove('dragging');
  draggedElement = null;
  
  // Clean up drag-over classes
  const controlItems = document.querySelectorAll('#quick-controls .control-item');
  controlItems.forEach(item => {
    item.classList.remove('drag-over');
  });
}

function handleDragOver(e) {
  e.preventDefault();
  e.dataTransfer.dropEffect = 'move';
}

function handleDragEnter(e) {
  e.preventDefault();
  if (e.target !== draggedElement && e.target.classList.contains('control-item')) {
    e.target.classList.add('drag-over');
    dragOverElement = e.target;
  }
}

function handleDragLeave(e) {
  if (e.target.classList.contains('control-item')) {
    e.target.classList.remove('drag-over');
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
    
    // Save the new order
    saveQuickAccessOrder();
    
    // Show success feedback
    showToast('Quick Access reordered', 'success');
  }
  
  e.target.classList.remove('drag-over');
  dragOverElement = null;
}

function saveQuickAccessOrder() {
  if (!CONFIG.favoriteEntities) return;
  
  const controlsGrid = document.getElementById('quick-controls');
  const newOrder = [];
  
  // Get the new order from the DOM
  const controlItems = controlsGrid.querySelectorAll('.control-item');
  controlItems.forEach(item => {
    const entityId = item.dataset.entityId;
    if (entityId && CONFIG.favoriteEntities.includes(entityId)) {
      newOrder.push(entityId);
    }
  });
  
  // Update the configuration with the new order
  CONFIG.favoriteEntities = newOrder;
  ipcRenderer.invoke('update-config', CONFIG);
}

window.disableEditMode = disableEditMode;

window.closeFilterModal = function() {
  const modal = document.getElementById('filter-modal');
  if (modal) {
    modal.style.display = 'none';
    releaseFocusTrap(modal);
  }
};

window.applyFilters = function() {
  const checkboxes = document.querySelectorAll('#filter-domains input[type="checkbox"]');
  FILTERS.domains = Array.from(checkboxes)
    .filter(cb => cb.checked)
    .map(cb => cb.value);

  const areaSelect = document.getElementById('filter-areas');
  if (areaSelect) {
    FILTERS.areas = Array.from(areaSelect.selectedOptions).map(opt => opt.value);
  }

  const hiddenInput = document.getElementById('hidden-entities');
  if (hiddenInput) {
    FILTERS.hidden = hiddenInput.value.split(',').map(s => s.trim()).filter(Boolean);
  }

  CONFIG.filters = FILTERS;
  ipcRenderer.invoke('update-config', CONFIG);

  window.closeFilterModal();
  renderActiveTab();
};

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

      // Resolve any pending request promises first
      if (msg.type === 'result' && PENDING_WS.has(msg.id)) {
        const pending = PENDING_WS.get(msg.id);
        PENDING_WS.delete(msg.id);
        pending.resolve(msg);
        return;
      }

      if (msg.type === 'auth_required') {
        WS.send(JSON.stringify({
          type: 'auth',
          access_token: CONFIG.homeAssistant.token
        }));
      } else if (msg.type === 'auth_ok') {
        console.log('WebSocket authenticated successfully');
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
        const oldEntity = msg.event.data.old_state;
        if (entity) {
          console.log(`State changed: ${entity.entity_id} from ${oldEntity?.state} to ${entity.state}`);
          STATES[entity.entity_id] = entity;
          updateEntityInUI(entity);
          handleMotionEvent(entity, oldEntity);
          
          // Check for entity alerts
          checkEntityAlerts(entity.entity_id, entity.state);
          
          // Update weather if this is a weather entity change
          if (entity.entity_id.startsWith('weather.')) {
            updateWeatherFromHA();
          }
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
            // Update weather after states are loaded
            updateWeatherFromHA();
            // Initialize entity alerts after states are loaded
            initializeEntityAlerts();
            // Restart timer updates after states are loaded
            setTimeout(restartTimerUpdates, 100);
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
    // Clean up all timer updates
    if (TIMER_TICK) {
      clearInterval(TIMER_TICK);
      TIMER_TICK = null;
    }
    if (TIMER_SENSOR_TICK) {
      clearInterval(TIMER_SENSOR_TICK);
      TIMER_SENSOR_TICK = null;
    }
    if (TIMER_SENSOR_SYNC_TICK) {
      clearInterval(TIMER_SENSOR_SYNC_TICK);
      TIMER_SENSOR_SYNC_TICK = null;
    }
    TIMER_MAP.clear();
    TIMER_SENSOR_MAP.clear();
    // Reconnect after 5 seconds
    setTimeout(connectWebSocket, 5000);
  };
}

function setStatus(connected) {
  const status = document.getElementById('connection-status');
  if (status) {
    status.className = connected ? 'connection-indicator connected' : 'connection-indicator';
    // Clear any text content - we only want the dot
    status.innerHTML = '';
  }
}

function restartTimerUpdates() {
  // Restart timer entity updates
  const timerElements = document.querySelectorAll('.control-item[data-entity-id^="timer."] .control-state');
  timerElements.forEach(el => {
    const entityId = el.closest('.control-item').dataset.entityId;
    const entity = STATES[entityId];
    if (entity && entity.state === 'active') {
      updateTimerCountdown(entity, el);
    }
  });
  
  // Restart timer sensor updates
  const sensorElements = document.querySelectorAll('.control-item[data-entity-id^="sensor."] .control-state');
  sensorElements.forEach(el => {
    const entityId = el.closest('.control-item').dataset.entityId;
    const entity = STATES[entityId];
    if (entity && isTimerSensor(entity)) {
      // Re-trigger the timer sensor update
      formatTimerSensorValue(entity, el);
    }
  });
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
  if (options?.context) card.dataset.context = options.context;

  const isEditMode = EDIT_MODE_TAB_ID === options.tabId;

  // Make draggable in edit mode
  if (isEditMode) {
    card.draggable = true;
    card.classList.add('draggable');
    card.ondragstart = (e) => {
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', entity.entity_id);
      card.classList.add('dragging');
    };
    card.ondragend = () => {
      card.classList.remove('dragging');
      try { if (DRAG_PLACEHOLDER && DRAG_PLACEHOLDER.parentNode) DRAG_PLACEHOLDER.remove(); } catch (_error) {
        // Ignore errors when removing drag placeholder
      }
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
  } else if (domain === 'timer') {
    const state = document.createElement('div');
    state.className = 'entity-state big';
    left.appendChild(state);
    updateTimerCountdown(entity, state);
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

  // Camera entity specialized layout for dashboard
  if (domain === 'camera' && options?.context === 'dashboard') {
    card.classList.add('camera-card');

    // Controls
    const expandBtn = document.createElement('button');
    expandBtn.className = 'btn btn-secondary';
    const expanded = DASHBOARD_CAMERA_EXPANDED.has(entity.entity_id);
    expandBtn.textContent = expanded ? 'Collapse' : 'Expand';
    expandBtn.title = expanded ? 'Collapse camera' : 'Expand camera';

    const liveBtn = document.createElement('button');
    liveBtn.className = 'btn btn-secondary';
    liveBtn.textContent = LIVE_CAMERAS.has(entity.entity_id) ? '⏹ Stop' : '▶ Live';
    liveBtn.title = LIVE_CAMERAS.has(entity.entity_id) ? 'Stop live view' : 'Play live view';

    // Header row (name + buttons)
    const headerRow = document.createElement('div');
    headerRow.className = 'camera-card-header';
    headerRow.appendChild(left);
    // Only show Live button when expanded
    if (expanded) right.appendChild(liveBtn);
    right.appendChild(expandBtn);
    if (isEditMode) {
      const removeBtn = document.createElement('button');
      removeBtn.className = 'btn btn-danger';
      removeBtn.textContent = '×';
      removeBtn.setAttribute('aria-label', 'Remove card');
      removeBtn.title = 'Remove from dashboard';
      removeBtn.onclick = () => window.removeFromDashboard(entity.entity_id, options.tabId);
      right.appendChild(removeBtn);
    }
    headerRow.appendChild(right);

    // Embed area below header
    const embed = document.createElement('div');
    embed.className = 'camera-embed';
    if (!expanded) embed.classList.add('collapsed');
    embed.style.display = expanded ? 'block' : 'none';

    const img = document.createElement('img');
    img.className = 'camera-img';
    img.alt = entity.attributes?.friendly_name || entity.entity_id;
    img.src = `ha://camera/${entity.entity_id}?t=${Date.now()}`;
    img.onerror = () => { img.style.display = 'none'; };
    const liveBadge = document.createElement('span');
    liveBadge.className = 'camera-live-badge hidden';
    liveBadge.textContent = 'LIVE';
    const loading = document.createElement('div');
    loading.className = 'camera-loading';
    loading.innerHTML = '<div class="spinner"></div>';
    embed.appendChild(img);
    embed.appendChild(liveBadge);
    embed.appendChild(loading);

    expandBtn.onclick = async () => {
      const nowExpanded = embed.classList.contains('collapsed');
      if (nowExpanded) {
        embed.classList.remove('collapsed');
        embed.style.display = 'block';
        DASHBOARD_CAMERA_EXPANDED.add(entity.entity_id);
        // Show live button when expanded
        if (!right.contains(liveBtn)) {
          right.insertBefore(liveBtn, expandBtn);
        }
      } else {
        // Collapse: hide embed and hide live button; stop stream if running
        embed.classList.add('collapsed');
        embed.style.display = 'none';
        DASHBOARD_CAMERA_EXPANDED.delete(entity.entity_id);
        if (LIVE_CAMERAS.has(entity.entity_id)) {
          LIVE_CAMERAS.delete(entity.entity_id);
          clearSnapshotLive(entity.entity_id);
          stopHlsStream(entity.entity_id, embed);
          liveBtn.textContent = '▶ Live';
          liveBtn.title = 'Play live view';
          liveBadge.classList.add('hidden');
          loading.classList.remove('show');
          img.style.display = 'block';
          img.src = `ha://camera/${entity.entity_id}?t=${Date.now()}`;
        }
        if (right.contains(liveBtn)) right.removeChild(liveBtn);
      }
      expandBtn.textContent = embed.classList.contains('collapsed') ? 'Expand' : 'Collapse';
      expandBtn.title = embed.classList.contains('collapsed') ? 'Expand camera' : 'Collapse camera';
    };

    liveBtn.onclick = async () => {
      if (LIVE_CAMERAS.has(entity.entity_id)) {
        LIVE_CAMERAS.delete(entity.entity_id);
        clearSnapshotLive(entity.entity_id);
        stopHlsStream(entity.entity_id, embed);
        liveBtn.textContent = '▶ Live';
        liveBtn.title = 'Play live view';
        liveBadge.classList.add('hidden');
        loading.classList.remove('show');
        img.style.display = 'block';
        img.src = `ha://camera/${entity.entity_id}?t=${Date.now()}`;
      } else {
        LIVE_CAMERAS.add(entity.entity_id);
        liveBtn.textContent = '⏹ Stop';
        liveBtn.title = 'Stop live view';
        liveBadge.classList.remove('hidden');
        loading.classList.add('show');
        clearSnapshotLive(entity.entity_id);
        // Try HLS; fallback to MJPEG
        const ok = await startHlsStream(entity.entity_id, embed, img);
        loading.classList.remove('show');
        if (!ok) {
          img.src = `ha://camera_stream/${entity.entity_id}?t=${Date.now()}`;
        }
      }
    };

    card.appendChild(headerRow);
    card.appendChild(embed);
    return card;
  }

  if (isEditMode) {
    const removeBtn = document.createElement('button');
    removeBtn.className = 'btn btn-danger';
    removeBtn.textContent = '×';
    removeBtn.setAttribute('aria-label', 'Remove card');
    removeBtn.title = 'Remove from dashboard';
    removeBtn.style.marginLeft = '10px';
    removeBtn.onclick = () => window.removeFromDashboard(entity.entity_id, options.tabId);
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
  card.dataset.entityId = entityId;

  const header = document.createElement('div');
  header.className = 'camera-header';

  const name = document.createElement('span');
  name.textContent = entity ? (entity.attributes.friendly_name || entityId) : entityId;

  const refreshBtn = document.createElement('button');
  refreshBtn.className = 'btn btn-secondary';
  refreshBtn.title = 'Refresh snapshot';
  refreshBtn.textContent = '🔄';
  refreshBtn.onclick = () => refreshCamera(entityId);

  const liveBtn = document.createElement('button');
  liveBtn.className = 'btn btn-secondary';
  liveBtn.title = 'Play live view';
  liveBtn.textContent = LIVE_CAMERAS.has(entityId) ? '⏹ Stop' : '▶ Live';
  liveBtn.onclick = () => toggleCameraLive(entityId, liveBtn);

  header.appendChild(name);
  header.appendChild(refreshBtn);
  header.appendChild(liveBtn);

  const img = document.createElement('img');
  img.className = 'camera-img';
  img.src = LIVE_CAMERAS.has(entityId) ? `ha://camera_stream/${entityId}?t=${Date.now()}` : `ha://camera/${entityId}?t=${Date.now()}`;
  img.alt = entity ? (entity.attributes.friendly_name || entityId) : entityId;
  img.onerror = () => {
    // If stream fails, fallback to snapshot live loop
    if (img.src.includes('camera_stream/')) {
      startSnapshotLive(entityId, img);
      return;
    }
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
  if (LIVE_CAMERAS.has(entityId)) return; // don't refresh while streaming
  const img = document.querySelector(`.camera img[alt*="${entityId.split('.')[1]}"]`);
  if (img) {
    img.src = `ha://camera/${entityId}?t=${Date.now()}`;
  }
}

function wsRequest(payload) {
  return new Promise((resolve, reject) => {
    if (!WS || WS.readyState !== WebSocket.OPEN) {
      reject(new Error('WebSocket not connected'));
      return;
    }
    const id = WS_ID++;
    const msg = { id, ...payload };
    PENDING_WS.set(id, { resolve, reject });
    try {
      WS.send(JSON.stringify(msg));
    } catch (e) {
      PENDING_WS.delete(id);
      reject(e);
      return;
    }
    setTimeout(() => {
      if (PENDING_WS.has(id)) {
        PENDING_WS.delete(id);
        reject(new Error('WebSocket request timeout'));
      }
    }, 15000);
  });
}

async function getHlsStreamUrl(entityId) {
  try {
    const res = await wsRequest({ type: 'camera/stream', entity_id: entityId, format: 'hls' });
    if (res && res.success && res.result && (res.result.url || res.result)) {
      const rawUrl = typeof res.result === 'string' ? res.result : res.result.url;
      const abs = new URL(rawUrl, (CONFIG && CONFIG.homeAssistant && CONFIG.homeAssistant.url) || '');
      // Proxy through ha://hls to keep Authorization header handling in main
      return `ha://hls${abs.pathname}${abs.search || ''}`;
    }
  } catch (e) {
    console.warn('HLS stream request failed:', e?.message || e);
  }
  return null;
}

async function startHlsStream(entityId, card, img) {
  const hlsUrl = await getHlsStreamUrl(entityId);
  if (!hlsUrl) return false;

  let video = card.querySelector('video.camera-video');
  if (!video) {
    video = document.createElement('video');
    video.className = 'camera-video';
    video.muted = true; // avoid autoplay issues
    video.playsInline = true;
    video.autoplay = true;
    video.controls = false;
    card.appendChild(video);
  }
  img.style.display = 'none';
  video.style.display = 'block';

  // Clean up any existing HLS instance
  const existing = ACTIVE_HLS.get(entityId);
  if (existing) {
    try { existing.hls?.destroy(); } catch (_error) {
      // Ignore errors when destroying HLS instance
    }
    try { existing.video.pause(); existing.video.removeAttribute('src'); existing.video.load(); } catch (_error) {
      // Ignore errors when resetting video element
    }
    ACTIVE_HLS.delete(entityId);
  }

  if (Hls && Hls.isSupported()) {
    const hls = new Hls({ lowLatencyMode: true, backBufferLength: 90 });
    hls.loadSource(hlsUrl);
    hls.attachMedia(video);
    hls.on(Hls.Events.ERROR, (_evt, data) => {
      console.warn('HLS error', data?.details || data);
      if (data?.fatal) {
        try { hls.destroy(); } catch (_error) {
          // Ignore errors when destroying HLS instance
        }
        ACTIVE_HLS.delete(entityId);
        // Fallback to MJPEG if fatal error
        video.style.display = 'none';
        img.style.display = 'block';
        img.src = `ha://camera_stream/${entityId}?t=${Date.now()}`;
      }
    });
    ACTIVE_HLS.set(entityId, { hls, video });
    return true;
  } else if (video.canPlayType('application/vnd.apple.mpegurl')) {
    // Safari
    video.src = hlsUrl;
    ACTIVE_HLS.set(entityId, { hls: null, video });
    return true;
  }
  return false;
}

function stopHlsStream(entityId, card) {
  const active = ACTIVE_HLS.get(entityId);
  if (active) {
    try { active.hls?.destroy(); } catch (_error) {
      // Ignore errors when destroying HLS instance
    }
    try { active.video.pause(); active.video.removeAttribute('src'); active.video.load(); } catch (_error) {
      // Ignore errors when resetting video element
    }
    try { active.video.remove(); } catch (_error) {
      // Ignore errors when removing video element
    }
    ACTIVE_HLS.delete(entityId);
    const img = card?.querySelector('.camera-img');
    if (img) { img.style.display = 'block'; }
    return true;
  }
  return false;
}

async function toggleCameraLive(entityId, btn) {
  const card = btn.closest('.camera');
  const img = card?.querySelector('.camera-img');
  if (!img) return;
  if (LIVE_CAMERAS.has(entityId)) {
    // Stop live (HLS or MJPEG or snapshot loop)
    LIVE_CAMERAS.delete(entityId);
    clearSnapshotLive(entityId);
    stopHlsStream(entityId, card);
    btn.textContent = '▶ Live';
    btn.title = 'Play live view';
    img.src = `ha://camera/${entityId}?t=${Date.now()}`;
  } else {
    LIVE_CAMERAS.add(entityId);
    btn.textContent = '⏹ Stop';
    btn.title = 'Stop live view';
    clearSnapshotLive(entityId);
    // Prefer HLS if available; fallback to MJPEG, then snapshot loop
    const hlsStarted = await startHlsStream(entityId, card, img);
    if (!hlsStarted) {
      img.src = `ha://camera_stream/${entityId}?t=${Date.now()}`;
    }
  }
}

function startSnapshotLive(entityId, imgEl) {
  // Fallback live by rapidly refreshing snapshots
  clearSnapshotLive(entityId);
  const interval = setInterval(() => {
    if (!LIVE_CAMERAS.has(entityId)) { clearSnapshotLive(entityId); return; }
    imgEl.src = `ha://camera/${entityId}?t=${Date.now()}`;
  }, 800);
  LIVE_SNAPSHOT_INTERVALS.set(entityId, interval);
}

function clearSnapshotLive(entityId) {
  const h = LIVE_SNAPSHOT_INTERVALS.get(entityId);
  if (h) {
    clearInterval(h);
    LIVE_SNAPSHOT_INTERVALS.delete(entityId);
  }
}

function stopAllCameraStreams() {
  LIVE_CAMERAS.clear();
  LIVE_SNAPSHOT_INTERVALS.forEach((h) => clearInterval(h));
  LIVE_SNAPSHOT_INTERVALS.clear();
  // Stop all HLS instances and remove videos
  document.querySelectorAll('#cameras-tab .camera').forEach(card => {
    const entityId = card.getAttribute('data-entity-id');
    stopHlsStream(entityId, card);
  });
  document.querySelectorAll('#cameras-tab .camera-img').forEach(img => {
    // Clearing src stops MJPEG stream
    img.src = '';
    img.style.display = 'block';
  });
}

// Service calls
// Removed duplicate callService function - using the enhanced version below

// Removed old toggleEntity function - using enhanced version below

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
function enableEditMode(tabId) {
  if (EDIT_MODE_TAB_ID && EDIT_MODE_TAB_ID !== tabId) {
    disableEditMode(true); // Save changes on the other tab
  }
  const layout = TAB_LAYOUTS[tabId] || [];
  EDIT_SNAPSHOT_LAYOUTS[tabId] = [...layout];
  EDIT_MODE_TAB_ID = tabId;
  document.body.classList.add('edit-mode');
  renderActiveTab();
}

function disableEditMode(save = true) {
  const tabId = EDIT_MODE_TAB_ID;
  if (!tabId) return;

  if (!save && EDIT_SNAPSHOT_LAYOUTS[tabId]) {
    TAB_LAYOUTS[tabId] = [...EDIT_SNAPSHOT_LAYOUTS[tabId]];
  }
  delete EDIT_SNAPSHOT_LAYOUTS[tabId];
  EDIT_MODE_TAB_ID = null;

  document.body.classList.remove('edit-mode');
  hideEntitySelector();

  if (save) {
    saveTabLayouts();
  }
  renderActiveTab();
}

function openEntityDrawer(tabId) {
  showEntitySelector(tabId);
  const selector = document.getElementById('entity-selector');
  if (selector) {
    selector.classList.remove('closed');
    selector.style.display = 'block';
    const dash = document.querySelector('.dashboard-container');
    if (dash) dash.classList.add('with-entity-drawer');
  }
}
function closeEntityDrawer() {
  const selector = document.getElementById('entity-selector');
  if (selector) {
    selector.classList.add('closed');
    const dash = document.querySelector('.dashboard-container');
    if (dash) dash.classList.remove('with-entity-drawer');
  }
}
window.openAddDrawer = openEntityDrawer;

function showEntitySelector(tabId) {
  let selector = document.getElementById('entity-selector');
  if (!selector) {
    selector = document.createElement('div');
    selector.id = 'entity-selector';
    selector.className = 'entity-selector docked closed';
    selector.innerHTML = `
      <div class="drawer-actions">
        <h3 class="drag-handle">Add Entities</h3>
        <button id="entity-drawer-close" class="btn btn-secondary" title="Close">×</button>
      </div>
      <input type="text" id="entity-search-add" placeholder="Search entities...">
      <div id="available-entities"></div>
    `;
    document.body.appendChild(selector);
    selector.querySelector('#entity-drawer-close').onclick = closeEntityDrawer;
  }

  selector.dataset.tabId = tabId;
  selector.style.display = 'block';

  const searchInput = document.getElementById('entity-search-add');
  const container = document.getElementById('available-entities');
  const layout = TAB_LAYOUTS[tabId] || [];

  const renderAvailable = (filter = '') => {
    container.innerHTML = '';
    const f = (filter || '').toLowerCase();
    const available = Object.keys(STATES)
      .filter(id => !layout.includes(id))
      .filter(id => {
        const e = STATES[id];
        const idMatch = id.toLowerCase().includes(f);
        const nameMatch = ((e?.attributes?.friendly_name || '').toLowerCase()).includes(f);
        return idMatch || nameMatch;
      })
      .slice(0, 50);

    available.forEach(entityId => {
      const entity = STATES[entityId];
      const item = document.createElement('div');
      item.className = 'entity-item';
      item.innerHTML = `
        <span>${entity.attributes.friendly_name || entityId}</span>
        <button class="btn btn-primary" onclick="addToDashboard('${entityId}', '${tabId}')">+</button>
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

function saveTabLayouts() {
  CONFIG.tabLayouts = TAB_LAYOUTS;
  ipcRenderer.invoke('update-config', CONFIG);
}

function setupDragAndDrop(tabId, container) {
  if (!container) return;

  if (!DRAG_PLACEHOLDER) {
    DRAG_PLACEHOLDER = document.createElement('div');
    DRAG_PLACEHOLDER.className = 'drop-placeholder';
  }

  container.ondragover = (e) => {
    e.preventDefault();
    const dragging = document.querySelector('.entity-card.dragging');
    if (!dragging) return;
    const afterElement = getDragAfterElement(container, e.clientX, e.clientY);
    if (!DRAG_PLACEHOLDER.parentNode) {
      container.appendChild(DRAG_PLACEHOLDER);
    }
    if (afterElement == null) {
      container.appendChild(DRAG_PLACEHOLDER);
    } else {
      container.insertBefore(DRAG_PLACEHOLDER, afterElement);
    }
  };

  container.ondrop = (e) => {
    e.preventDefault();
    const dragging = document.querySelector('.entity-card.dragging');
    if (dragging && DRAG_PLACEHOLDER && DRAG_PLACEHOLDER.parentNode === container) {
      container.insertBefore(dragging, DRAG_PLACEHOLDER);
    }
    if (DRAG_PLACEHOLDER && DRAG_PLACEHOLDER.parentNode) {
      DRAG_PLACEHOLDER.remove();
    }
    const cards = container.querySelectorAll('.entity-card');
    TAB_LAYOUTS[tabId] = Array.from(cards).map(card => card.dataset.entityId);
  };
}


function getDragAfterElement(container, x, y) {
  const draggableElements = [...container.querySelectorAll('.entity-card:not(.dragging)')];
  const result = draggableElements.reduce((closest, child) => {
    const box = child.getBoundingClientRect();
    const centerY = box.top + box.height / 2;
    const centerX = box.left + box.width / 2;
    const offsetY = y - centerY;
    const dist = Math.hypot(centerX - x, centerY - y);
    if (offsetY < 0 && dist < closest.dist) {
      return { dist, element: child };
    }
    return closest;
  }, { dist: Number.POSITIVE_INFINITY, element: null });
  return result.element;
}

function renderSkeletonCards(container, count = 4) {
  try {
    for (let i = 0; i < count; i++) {
      const sk = document.createElement('div');
      sk.className = 'entity-card';
      const left = document.createElement('div');
      left.style.flex = '1';
      const line1 = document.createElement('div'); line1.className = 'skeleton'; line1.style.height = '14px'; line1.style.width = `${60 + Math.round(Math.random()*30)}%`;
      const line2 = document.createElement('div'); line2.className = 'skeleton'; line2.style.height = '10px'; line2.style.width = `${30 + Math.round(Math.random()*40)}%`; line2.style.marginTop = '8px';
      left.appendChild(line1); left.appendChild(line2);
      const right = document.createElement('div'); right.style.width = '80px'; right.style.height = '28px'; right.className = 'skeleton';
      sk.appendChild(left); sk.appendChild(right);
      container.appendChild(sk);
    }
  } catch (_error) {
    // Ignore errors when rendering skeleton cards
}
}
function _renderSkeletonWeather(container, count = 2) {
  try {
    for (let i = 0; i < count; i++) {
      const w = document.createElement('div');
      w.className = 'weather-widget skeleton';
      w.style.height = '120px';
      container.appendChild(w);
    }
  } catch (_error) {
    // Ignore errors when rendering skeleton weather
  }
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

  populateFilterDomains();
  populateFilterAreas();

  const hiddenInput = document.getElementById('hidden-entities');
  if (hiddenInput) {
    hiddenInput.value = (FILTERS.hidden || []).join(', ');
  }

  modal.style.display = 'grid';
  trapFocus(modal);
}

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
  const container = document.getElementById('weather-container');
  if (!container) return;

  container.innerHTML = '';

  if (Object.keys(STATES).length === 0) {
    renderSkeletonCards(container, 4);
    return;
  }

  const weatherEntities = Object.values(STATES).filter(e => e.entity_id.startsWith('weather.'));

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

  const sensors = Object.values(STATES)
    .filter(e => e.entity_id.startsWith('sensor.') && e.attributes && e.attributes.unit_of_measurement)
    .slice(0, 5);

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
      } catch (_error) {
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
    const f = (filter || '').toLowerCase().trim();
    
    if (!f) {
      // Show all entities if no filter
      const allEntities = Object.values(STATES).slice(0, 50);
      allEntities.forEach(entity => {
        const card = createEntityCard(entity);
        if (card) listContainer.appendChild(card);
      });
      return;
    }
    
    // Score and filter entities
    const scoredEntities = Object.values(STATES)
      .map(entity => {
        const name = getEntityDisplayName(entity);
        const type = getEntityTypeDescription(entity);
        const entityId = entity.entity_id;
        
        const nameScore = getSearchScore(name, f);
        const typeScore = getSearchScore(type, f);
        const entityIdScore = getSearchScore(entityId, f);
        const maxScore = Math.max(nameScore, typeScore, entityIdScore);
        
        return { entity, score: maxScore };
      })
      .filter(({ score }) => score > 0) // Only include items with matches
      .sort((a, b) => b.score - a.score) // Sort by score (highest first)
      .slice(0, 50); // Limit to 50 results

    scoredEntities.forEach(({ entity }) => {
      const card = createEntityCard(entity);
      if (card) listContainer.appendChild(card);
    });
  };

  searchInput.oninput = () => renderList(searchInput.value);
  renderList();
}

// Tab navigation
const ALL_TABS = [
  'dashboard', 'scenes', 'automations', 'media',
  'cameras', 'weather', 'history', 'services'
];

function setupTabs() {
  const tabContainer = document.querySelector('.tab-navigation');
  if (!tabContainer) return;

  if (!CONFIG.visibleTabs || !Array.isArray(CONFIG.visibleTabs)) {
    CONFIG.visibleTabs = [...ALL_TABS];
  }

  renderTabs();

  const tabNav = document.querySelector('.tab-navigation');
  if (tabNav) {
    tabNav.addEventListener('keydown', (e) => {
      const tabs = document.querySelectorAll('.tab-btn');
      const currentIndex = Array.from(tabs).findIndex(t => t === document.activeElement);
      let targetIndex = currentIndex;
      if (e.key === 'ArrowRight') { e.preventDefault(); targetIndex = (currentIndex + 1) % tabs.length; }
      else if (e.key === 'ArrowLeft') { e.preventDefault(); targetIndex = (currentIndex - 1 + tabs.length) % tabs.length; }
      else if (e.key === 'Home') { e.preventDefault(); targetIndex = 0; }
      else if (e.key === 'End') { e.preventDefault(); targetIndex = tabs.length - 1; }
      else return;
      if (tabs[targetIndex]) {
        tabs[targetIndex].focus();
        tabs[targetIndex].click();
      }
    });

    tabNav.addEventListener('wheel', (e) => {
      if (Math.abs(e.deltaY) > Math.abs(e.deltaX)) {
        tabNav.scrollLeft += e.deltaY;
        e.preventDefault();
      }
    }, { passive: false });
  
  
  let draggedTab = null;

  tabNav.addEventListener('dragstart', (e) => {
    const target = e.target.closest('.tab-btn');
    if (target) {
      draggedTab = target;
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', target.dataset.tab);
      setTimeout(() => {
        target.classList.add('dragging');
      }, 0);
    }
  });

  tabNav.addEventListener('dragend', () => {
    if (draggedTab) {
      draggedTab.classList.remove('dragging');
      draggedTab = null;
      const newOrder = Array.from(tabNav.querySelectorAll('.tab-btn')).map(tab => tab.dataset.tab);
      CONFIG.visibleTabs = newOrder;
      ipcRenderer.invoke('update-config', CONFIG);
    }
  });

  tabNav.addEventListener('dragover', (e) => {
    e.preventDefault();
    const target = e.target.closest('.tab-btn');
    if (target && draggedTab && target !== draggedTab) {
      const rect = target.getBoundingClientRect();
      const isAfter = (e.clientX - rect.left) > (rect.width / 2);
      if (isAfter) {
        target.parentNode.insertBefore(draggedTab, target.nextSibling);
      } else {
        target.parentNode.insertBefore(draggedTab, target);
      }
    }
  });
  }

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
    setTimeout(updateScrollButtons, 100);
  }

  document.addEventListener('keydown', (e) => {
    if (e.ctrlKey && e.key === 'Tab') {
      e.preventDefault();
      const tabs = Array.from(document.querySelectorAll('.tab-btn'));
      const current = tabs.findIndex(t => t.classList.contains('active'));
      let next = current + (e.shiftKey ? -1 : 1);
      if (next < 0) next = tabs.length - 1;
      if (next >= tabs.length) next = 0;
      if (tabs[next]) {
        tabs[next].focus();
        tabs[next].click();
      }
    }
  });
}

function renderTabs() {
  const tabContainer = document.querySelector('.tab-navigation');
  if (!tabContainer) return;

  const activeTabId = document.querySelector('.tab-btn.active')?.dataset.tab || CONFIG.visibleTabs[0] || 'dashboard';
  tabContainer.innerHTML = '';

  CONFIG.visibleTabs.forEach(tabId => {
    const isCustom = tabId.startsWith('custom-');
    const tabName = isCustom
      ? (CONFIG.customTabs[tabId]?.name || 'Custom Tab')
      : (tabId.charAt(0).toUpperCase() + tabId.slice(1));

    const tab = document.createElement('button');
    tab.id = `tab-${tabId}`;
    tab.className = 'tab-btn';
    tab.dataset.tab = tabId;
    tab.setAttribute('role', 'tab');
    tab.setAttribute('aria-controls', `${tabId}-tab`);
    tab.textContent = tabName;
    tab.draggable = true;

    tab.onclick = () => {
      if (CAMERA_REFRESH_INTERVAL) {
        clearInterval(CAMERA_REFRESH_INTERVAL);
        CAMERA_REFRESH_INTERVAL = null;
      }
      const prevActive = document.querySelector('.tab-btn.active');
      if (prevActive && prevActive.dataset.tab === 'cameras') {
        stopAllCameraStreams();
      }

      document.querySelectorAll('.tab-btn').forEach(t => {
        t.classList.remove('active');
        t.setAttribute('aria-selected', 'false');
      });
      document.querySelectorAll('.tab-content').forEach(c => {
        c.classList.remove('active');
      });

      tab.classList.add('active');
      tab.setAttribute('aria-selected', 'true');
      const content = document.getElementById(`${tab.dataset.tab}-tab`);
      if (content) {
        content.classList.add('active');
        renderActiveTab();
        content.focus();
      }
      try { tab.scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'nearest' }); } catch (_error) {
        // Ignore errors when scrolling tab into view
      }
    };

    tabContainer.appendChild(tab);
  });

  let tabToActivate = tabContainer.querySelector(`.tab-btn[data-tab="${activeTabId}"]`);
  if (!tabToActivate && tabContainer.firstChild) {
    tabToActivate = tabContainer.firstChild;
  }
  if (tabToActivate) {
    tabToActivate.classList.add('active');
    tabToActivate.setAttribute('aria-selected', 'true');
    const content = document.getElementById(`${tabToActivate.dataset.tab}-tab`);
    if (content) {
      content.classList.add('active');
    }
  }
  renderActiveTab();
}

function openManageTabsModal() {
  const modal = document.getElementById('manage-tabs-modal');
  if (!modal) return;

  const list = document.getElementById('manage-tabs-list');
  list.innerHTML = '';

  CONFIG.visibleTabs.forEach(tabId => {
    const isCustom = tabId.startsWith('custom-');
    const tabName = isCustom
      ? (CONFIG.customTabs[tabId]?.name || 'Custom Tab')
      : (tabId.charAt(0).toUpperCase() + tabId.slice(1));

    const item = document.createElement('div');
    item.className = 'manage-tab-item';
    item.dataset.tabId = tabId;
    item.draggable = true;
    item.innerHTML = `<span>${tabName}</span>`;

    const buttons = document.createElement('div');
    buttons.style.display = 'flex';
    buttons.style.gap = '8px';

    if (isCustom) {
      const renameBtn = document.createElement('button');
      renameBtn.className = 'btn btn-secondary';
      renameBtn.textContent = 'Rename';
      renameBtn.onclick = () => renameTab(tabId);
      buttons.appendChild(renameBtn);
    }

    const removeBtn = document.createElement('button');
    removeBtn.className = 'btn btn-danger';
    removeBtn.textContent = 'Delete';
    removeBtn.onclick = () => {
      removeTab(tabId);
      openManageTabsModal(); // Refresh the modal
    };
    buttons.appendChild(removeBtn);

    item.appendChild(buttons);
    list.appendChild(item);
  });

  let draggedTab = null;

  list.addEventListener('dragstart', (e) => {
    const target = e.target.closest('.manage-tab-item');
    if (target) {
      draggedTab = target;
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', target.dataset.tabId);
      setTimeout(() => {
        target.classList.add('dragging');
      }, 0);
    }
  });

  list.addEventListener('dragend', () => {
    if (draggedTab) {
      draggedTab.classList.remove('dragging');
      draggedTab = null;
      const newOrder = Array.from(list.querySelectorAll('.manage-tab-item')).map(item => item.dataset.tabId);
      CONFIG.visibleTabs = newOrder;
      ipcRenderer.invoke('update-config', CONFIG);
      renderTabs();
    }
  });

  list.addEventListener('dragover', (e) => {
    e.preventDefault();
    const target = e.target.closest('.manage-tab-item');
    if (target && draggedTab && target !== draggedTab) {
      const rect = target.getBoundingClientRect();
      const isAfter = (e.clientY - rect.top) > (rect.height / 2);
      if (isAfter) {
        target.parentNode.insertBefore(draggedTab, target.nextSibling);
      } else {
        target.parentNode.insertBefore(draggedTab, target);
      }
    }
  });

  modal.classList.remove('hidden');
}

function openEntitySelector() {
  const modal = document.getElementById('entity-selector');
  if (modal) {
    modal.classList.remove('hidden');
    loadEntitySelector();
  }
}

function openQuickControlsModal() {
  const modal = document.getElementById('quick-controls-modal');
  if (modal) {
    modal.classList.remove('hidden');
    loadQuickControlsSelector();
  }
}

// Advanced search scoring function
function getSearchScore(text, searchTerm) {
  if (!text || !searchTerm) return 0;
  
  const textLower = text.toLowerCase();
  const searchLower = searchTerm.toLowerCase();
  
  // Exact match gets highest score
  if (textLower === searchLower) return 1000;
  
  // Starts with search term gets high score
  if (textLower.startsWith(searchLower)) return 900;
  
  // Check for whole word matches first (most important)
  const words = textLower.split(/\s+/);
  for (const word of words) {
    // Exact word match gets highest score
    if (word === searchLower) return 950;
    // Word starts with search term gets high score
    if (word.startsWith(searchLower)) return 850;
  }
  
  // Check for word contains (but not at start) - lower score
  for (const word of words) {
    if (word.includes(searchLower) && !word.startsWith(searchLower)) {
      return 750;
    }
  }
  
  // General substring match gets medium score
  if (textLower.includes(searchLower)) return 600;
  
  // Fuzzy match gets lower score
  let textIndex = 0;
  let fuzzyScore = 0;
  for (let i = 0; i < searchLower.length; i++) {
    const char = searchLower[i];
    const foundIndex = textLower.indexOf(char, textIndex);
    if (foundIndex === -1) return 0; // No fuzzy match possible
    fuzzyScore += (foundIndex - textIndex) * 10; // Penalty for gaps
    textIndex = foundIndex + 1;
  }
  
  return Math.max(0, 400 - fuzzyScore);
}

function loadEntitySelector() {
  const container = document.getElementById('available-entities-list');
  if (!container || !STATES || Object.keys(STATES).length === 0) {
    container.innerHTML = '<div class="no-entities">No entities loaded from Home Assistant. Make sure you\'re connected.</div>';
    return;
  }

  // Get current dashboard entities
  const dashboardEntities = new Set();
  if (CONFIG.favoriteEntities) {
    CONFIG.favoriteEntities.forEach(id => dashboardEntities.add(id));
  }

  // Filter and sort entities
  const availableEntities = Object.values(STATES)
    .filter(entity => {
      // Skip hidden entities
      if (CONFIG.hiddenEntities && CONFIG.hiddenEntities.includes(entity.entity_id)) {
        return false;
      }
      // Skip system entities
      if (entity.entity_id.startsWith('sun.') || 
          entity.entity_id.startsWith('zone.') ||
          entity.entity_id.startsWith('person.') ||
          entity.entity_id.startsWith('device_tracker.')) {
        return false;
      }
      return true;
    })
    .sort((a, b) => {
      // Sort by domain, then by name
      const domainA = a.entity_id.split('.')[0];
      const domainB = b.entity_id.split('.')[0];
      if (domainA !== domainB) {
        return domainA.localeCompare(domainB);
      }
      return getEntityDisplayName(a).localeCompare(getEntityDisplayName(b));
    });

  // Render entity list
  container.innerHTML = availableEntities.map(entity => {
    const isOnDashboard = dashboardEntities.has(entity.entity_id);
    const icon = getEntityIcon(entity);
    const name = getEntityDisplayName(entity);
    const state = getEntityDisplayState(entity);
    const type = getEntityTypeDescription(entity);
    
    return `
      <div class="entity-selector-item" data-entity-id="${entity.entity_id}">
        <div class="entity-selector-info">
          <span class="entity-selector-icon">${icon}</span>
          <div class="entity-selector-details">
            <div class="entity-selector-name">${name}</div>
            <div class="entity-selector-meta">
              <span class="entity-selector-type">${type}</span>
              <span class="entity-selector-state">${state}</span>
            </div>
          </div>
        </div>
        <div class="entity-selector-actions">
          ${isOnDashboard 
            ? `<button class="entity-selector-btn remove" onclick="removeFromDashboard('${entity.entity_id}')">Remove</button>`
            : `<button class="entity-selector-btn add" onclick="addToDashboard('${entity.entity_id}')">Add</button>`
          }
        </div>
      </div>
    `;
  }).join('');

  // Add search functionality with improved matching and sorting
  const searchInput = document.getElementById('entity-search');
  if (searchInput) {
    searchInput.oninput = (e) => {
      const searchTerm = e.target.value.toLowerCase().trim();
      
      if (!searchTerm) {
        // Show all items if search is empty
        const items = container.querySelectorAll('.entity-selector-item');
        items.forEach(item => item.style.display = 'flex');
        return;
      }
      
      // Get all items and score them
      const items = Array.from(container.querySelectorAll('.entity-selector-item'));
      const scoredItems = items.map(item => {
        const name = item.querySelector('.entity-selector-name').textContent;
        const state = item.querySelector('.entity-selector-state').textContent;
        const type = item.querySelector('.entity-selector-type').textContent;
        const entityId = item.dataset.entityId || '';
        
        const nameScore = getSearchScore(name, searchTerm);
        const stateScore = getSearchScore(state, searchTerm);
        const typeScore = getSearchScore(type, searchTerm);
        const entityIdScore = getSearchScore(entityId, searchTerm);
        const maxScore = Math.max(nameScore, stateScore, typeScore, entityIdScore);
        
        return { item, score: maxScore };
      }).filter(({ score }) => score > 0); // Only include items with matches
      
      // Sort by score (highest first)
      scoredItems.sort((a, b) => b.score - a.score);
      
      
      // Hide all items first
      items.forEach(item => item.style.display = 'none');
      
      // Show and reorder matched items
      scoredItems.forEach(({ item }) => {
        item.style.display = 'flex';
        container.appendChild(item); // Move to end (top of visible list)
      });
    };
  }
}

function loadQuickControlsSelector() {
  const container = document.getElementById('quick-controls-list');
  if (!container || !STATES || Object.keys(STATES).length === 0) {
    container.innerHTML = '<div class="no-entities">No entities loaded from Home Assistant. Make sure you\'re connected.</div>';
    return;
  }

  // Get current quick control entities
  const quickControlEntities = new Set();
  if (CONFIG.favoriteEntities) {
    CONFIG.favoriteEntities.forEach(id => quickControlEntities.add(id));
  }

  // Show all entities for quick access (no restrictions)
  const availableEntities = Object.values(STATES)
    .filter(entity => {
      // Skip hidden entities
      if (CONFIG.hiddenEntities && CONFIG.hiddenEntities.includes(entity.entity_id)) {
        return false;
      }
      // Skip system entities
      if (entity.entity_id.startsWith('sun.') || 
          entity.entity_id.startsWith('zone.') ||
          entity.entity_id.startsWith('person.') ||
          entity.entity_id.startsWith('device_tracker.')) {
        return false;
      }
      return true;
    })
    .sort((a, b) => {
      const domainA = a.entity_id.split('.')[0];
      const domainB = b.entity_id.split('.')[0];
      if (domainA !== domainB) {
        return domainA.localeCompare(domainB);
      }
      return getEntityDisplayName(a).localeCompare(getEntityDisplayName(b));
    });

  // Render entity list
  container.innerHTML = availableEntities.map(entity => {
    const isQuickControl = quickControlEntities.has(entity.entity_id);
    const icon = getEntityIcon(entity);
    const name = getEntityDisplayName(entity);
    const state = getEntityDisplayState(entity);
    const type = getEntityTypeDescription(entity);
    
    return `
      <div class="entity-selector-item" data-entity-id="${entity.entity_id}">
        <div class="entity-selector-info">
          <span class="entity-selector-icon">${icon}</span>
          <div class="entity-selector-details">
            <div class="entity-selector-name">${name}</div>
            <div class="entity-selector-meta">
              <span class="entity-selector-type">${type}</span>
              <span class="entity-selector-state">${state}</span>
            </div>
          </div>
        </div>
        <div class="entity-selector-actions">
          ${isQuickControl 
            ? `<button class="entity-selector-btn remove" onclick="removeFromQuickControls('${entity.entity_id}')">Remove</button>`
            : `<button class="entity-selector-btn add" onclick="addToQuickControls('${entity.entity_id}')">Add</button>`
          }
        </div>
      </div>
    `;
  }).join('');

  // Add search functionality with improved matching and sorting
  const searchInput = document.getElementById('quick-controls-search');
  if (searchInput) {
    searchInput.oninput = (e) => {
      const searchTerm = e.target.value.toLowerCase().trim();
      
      if (!searchTerm) {
        // Show all items if search is empty
        const items = container.querySelectorAll('.entity-selector-item');
        items.forEach(item => item.style.display = 'flex');
        return;
      }
      
      // Get all items and score them
      const items = Array.from(container.querySelectorAll('.entity-selector-item'));
      const scoredItems = items.map(item => {
        const name = item.querySelector('.entity-selector-name').textContent;
        const state = item.querySelector('.entity-selector-state').textContent;
        const type = item.querySelector('.entity-selector-type').textContent;
        const entityId = item.dataset.entityId || '';
        
        const nameScore = getSearchScore(name, searchTerm);
        const stateScore = getSearchScore(state, searchTerm);
        const typeScore = getSearchScore(type, searchTerm);
        const entityIdScore = getSearchScore(entityId, searchTerm);
        const maxScore = Math.max(nameScore, stateScore, typeScore, entityIdScore);
        
        return { item, score: maxScore };
      }).filter(({ score }) => score > 0); // Only include items with matches
      
      // Sort by score (highest first)
      scoredItems.sort((a, b) => b.score - a.score);
      
      
      // Hide all items first
      items.forEach(item => item.style.display = 'none');
      
      // Show and reorder matched items
      scoredItems.forEach(({ item }) => {
        item.style.display = 'flex';
        container.appendChild(item); // Move to end (top of visible list)
      });
    };
  }
}

function renameTab(tabId) {
  const newName = prompt('Enter new tab name:', CONFIG.customTabs[tabId]?.name || '');
  if (newName && newName.trim()) {
    CONFIG.customTabs[tabId].name = newName.trim();
    ipcRenderer.invoke('update-config', CONFIG);
    renderTabs();
    openManageTabsModal(); // Refresh the modal
  }
}

function _addTab(tabId) {
  if (!CONFIG.visibleTabs.includes(tabId)) {
    CONFIG.visibleTabs.push(tabId);
    ipcRenderer.invoke('update-config', CONFIG);
    renderTabs();
  }
}

function addCustomTab(tabName) {
  const safeId = tabName.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '');
  const tabId = `custom-${safeId}`;

  if (CONFIG.visibleTabs.includes(tabId)) {
    showToast(`Tab "${tabName}" already exists.`, 'error');
    return;
  }

  if (!CONFIG.customTabs) CONFIG.customTabs = {};
  if (!TAB_LAYOUTS) TAB_LAYOUTS = {};
  CONFIG.customTabs[tabId] = { name: tabName };
  TAB_LAYOUTS[tabId] = [];
  CONFIG.tabLayouts = TAB_LAYOUTS;

  CONFIG.visibleTabs.push(tabId);

  const newTabContent = document.createElement('div');
  newTabContent.id = `${tabId}-tab`;
  newTabContent.className = 'tab-content';
  newTabContent.setAttribute('role', 'tabpanel');
  newTabContent.innerHTML = '';
  document.querySelector('.dashboard-container').appendChild(newTabContent);

  ipcRenderer.invoke('update-config', CONFIG);
  renderTabs();

  const newTabButton = document.querySelector(`.tab-btn[data-tab="${tabId}"]`);
  if (newTabButton) {
    newTabButton.click();
  }
}

function removeTab(tabId) {
  if (CONFIG.visibleTabs.length <= 1) {
    console.warn("Cannot remove the last tab.");
    return;
  }
  CONFIG.visibleTabs = CONFIG.visibleTabs.filter(t => t !== tabId);

  const isCustom = tabId.startsWith('custom-');
  if (isCustom) {
    delete CONFIG.customTabs[tabId];
    delete TAB_LAYOUTS[tabId];
    CONFIG.tabLayouts = TAB_LAYOUTS;
    const content = document.getElementById(`${tabId}-tab`);
    if (content) content.remove();
  }

  ipcRenderer.invoke('update-config', CONFIG);
  renderTabs();
}


function renderActiveTab() {
  // For new single-view design, render everything in one view
  renderSingleView();
}

function renderSingleView() {
  // Render quick access (main focus)
  renderQuickControls();
  
  // Hide entities section by default - users can search for entities when needed
  const entitiesSection = document.querySelector('.entities-section');
  if (entitiesSection) {
    entitiesSection.classList.add('hidden');
  }
  
  // Render cameras if any
  renderCameras();
  
  // Update weather if available
  updateWeatherFromHA();
  
  // If no entities are loaded, show a message
  if (Object.keys(STATES).length === 0) {
    showNoConnectionMessage();
  }
}

function showNoConnectionMessage() {
  const container = document.getElementById('entities-container');
  if (!container) return;

  container.innerHTML = `
    <div class="entity-card" style="text-align: center; padding: 20px;">
      <div class="entity-info">
        <div class="entity-name">Not Connected to Home Assistant</div>
        <div class="entity-state">Click ⚙️ to configure connection</div>
      </div>
    </div>
  `;
}

function renderQuickControls() {
  const container = document.getElementById('quick-controls');
  if (!container) return;
  
  container.innerHTML = '';
  
  // Get favorite entities for quick access
  const favorites = CONFIG.favoriteEntities || [];
  const entities = Object.values(STATES).filter(e => favorites.includes(e.entity_id));
  
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

  // If reorganize mode is active, ensure the grid remains in that state
  if (isReorganizeMode) {
    const controlsGrid = document.getElementById('quick-controls');
    if (controlsGrid) controlsGrid.classList.add('reorganize-mode');
    // Re-attach drag/drop and ensure remove buttons are present after re-render
    addDragAndDropListeners();
  }
}

function createControlElement(entity) {
  const div = document.createElement('div');
  div.className = 'control-item';
  div.dataset.entityId = entity.entity_id;
  
  // Handle different entity types appropriately
  if (entity.entity_id.startsWith('camera.')) {
    div.onclick = () => {
      if (!isReorganizeMode) {
        openCamera(entity.entity_id);
      }
    };
    div.title = `Click to view ${getEntityDisplayName(entity)}`;
  } else if (entity.entity_id.startsWith('sensor.')) {
    // Sensors are read-only, show current value
    div.onclick = () => {
      if (!isReorganizeMode) {
        showSensorDetails(entity);
      }
    };
    div.title = `${getEntityDisplayName(entity)}: ${getEntityDisplayState(entity)}`;
  } else if (entity.entity_id.startsWith('timer.')) {
    // Timers: click to toggle (start/pause/cancel)
    div.onclick = () => {
      if (!isReorganizeMode) {
        toggleEntity(entity);
      }
    };
    div.title = `Click to toggle ${getEntityDisplayName(entity)}`;
  } else if (entity.entity_id.startsWith('light.')) {
    // Lights: click to toggle, long-press for brightness slider
    div.title = `Click to toggle, hold for brightness control`;

    let pressTimer = null;
    let longPressTriggered = false;

    const startPress = () => {
      // Don't start long-press if in reorganize mode
      if (isReorganizeMode) {
        return;
      }
      
      longPressTriggered = false;
      clearTimeout(pressTimer);
      pressTimer = setTimeout(() => {
        longPressTriggered = true;
        showBrightnessSlider(entity);
      }, 500); // 500ms for long press
    };

    const cancelPress = () => {
      clearTimeout(pressTimer);
    };

    // Mouse events
    div.addEventListener('mousedown', startPress);
    div.addEventListener('mouseup', cancelPress);
    div.addEventListener('mouseleave', cancelPress);

    // Touch events (basic support)
    div.addEventListener('touchstart', startPress, { passive: true });
    div.addEventListener('touchend', cancelPress);
    div.addEventListener('touchcancel', cancelPress);

    // Click handler with long-press guard
    div.addEventListener('click', (e) => {
      // Don't toggle if in reorganize mode
      if (isReorganizeMode) {
        e.preventDefault();
        e.stopPropagation();
        return;
      }
      
      if (longPressTriggered) {
        // Suppress toggle if long-press already opened the slider
        longPressTriggered = false;
        e.preventDefault();
        e.stopPropagation();
        return;
      }
      toggleEntity(entity);
    });

    // Prevent context menu on long press
    div.addEventListener('contextmenu', (e) => {
      e.preventDefault();
    });
  } else {
    div.onclick = () => {
      if (!isReorganizeMode) {
        toggleEntity(entity);
      }
    };
    div.title = `Click to toggle ${getEntityDisplayName(entity)}`;
  }
  
  const icon = getEntityIcon(entity);
  const name = getEntityDisplayName(entity);
  const state = getEntityDisplayState(entity);
  
  // Create more informative display
  let stateDisplay = '';
  if (entity.entity_id.startsWith('sensor.')) {
    stateDisplay = `<div class="control-state">${state}</div>`;
  } else if (entity.entity_id.startsWith('timer.')) {
    // Timer entities get special treatment - no icon, just countdown
    const timerDisplay = getTimerDisplay(entity);
    stateDisplay = `<div class="control-state timer-countdown">${timerDisplay}</div>`;
  } else if (entity.entity_id.startsWith('light.') && entity.state === 'on' && entity.attributes.brightness) {
    const brightness = Math.round((entity.attributes.brightness / 255) * 100);
    stateDisplay = `<div class="control-state">${brightness}%</div>`;
  } else if (entity.entity_id.startsWith('light.') && entity.state !== 'on') {
    // Show explicit Off when the light is off
    stateDisplay = `<div class="control-state">Off</div>`;
  } else if (entity.entity_id.startsWith('climate.')) {
    const temp = entity.attributes.current_temperature || entity.attributes.temperature;
    if (temp) {
      stateDisplay = `<div class="control-state">${temp}°</div>`;
    }
  }
  
  // Special layout for timer entities - no icon, larger timer display
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
  
  // Start live countdowns on initial render so values don't get stuck
  if (entity.entity_id.startsWith('timer.')) {
    const stateEl = div.querySelector('.control-state');
    if (stateEl) {
      updateTimerCountdown(entity, stateEl);
    }
  } else if (entity.entity_id.startsWith('sensor.') && isTimerSensor(entity)) {
    let stateEl = div.querySelector('.control-state');
    const infoEl = div.querySelector('.control-info');
    if (!stateEl && infoEl) {
      stateEl = document.createElement('div');
      stateEl.className = 'control-state';
      infoEl.appendChild(stateEl);
    }
    if (stateEl) {
      stateEl.textContent = formatTimerSensorValue(entity, stateEl);
    }
  }
  
  // All entities look the same - no special active styling
  
  return div;
}

// Fetch a camera snapshot using Authorization header and set it into an <img>
async function fetchCameraSnapshot(entityId, imgEl) {
  if (!CONFIG || !CONFIG.homeAssistant?.url || !CONFIG.homeAssistant?.token) {
    throw new Error('HA config missing');
  }
  const url = `${CONFIG.homeAssistant.url}/api/camera_proxy/${entityId}?t=${Date.now()}`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${CONFIG.homeAssistant.token}` } });
  if (!res.ok) throw new Error(`Snapshot fetch failed (${res.status})`);
  const blob = await res.blob();
  const objUrl = URL.createObjectURL(blob);
  imgEl.onload = () => {
    try { URL.revokeObjectURL(objUrl); } catch (_e) {}
  };
  imgEl.src = objUrl;
}

function renderEntities() {
  const container = document.getElementById('entities-container');
  if (!container) return;
  
  container.innerHTML = '';
  
  // Get filtered entities
  const filteredEntities = getFilteredEntities();
  
  filteredEntities.slice(0, 20).forEach(entity => {
    const card = createEntityCard(entity);
    container.appendChild(card);
  });
}

function createEntityCard(entity) {
  const div = document.createElement('div');
  div.className = 'entity-card';
  
  const name = getEntityDisplayName(entity);
  const state = getEntityDisplayState(entity);
  const icon = getEntityIcon(entity);
  
  div.innerHTML = `
    <div class="entity-info">
      <div class="entity-name">${name}</div>
      <div class="entity-state">${state}</div>
    </div>
    <div class="entity-control">
      ${createEntityControl(entity)}
    </div>
  `;
  
  return div;
}

function createEntityControl(entity) {
  if (entity.attributes.unit_of_measurement) {
    return `<span class="entity-value">${entity.state}${entity.attributes.unit_of_measurement}</span>`;
  } else if (['light', 'switch', 'fan', 'lock', 'cover'].includes(entity.entity_id.split('.')[0])) {
    const isActive = ['on', 'open', 'unlocked'].includes(entity.state);
    return `<div class="entity-toggle ${isActive ? 'active' : ''}" onclick="event.stopPropagation(); toggleEntity('${entity.entity_id}')"></div>`;
  } else {
    return `<span class="entity-value">${entity.state}</span>`;
  }
}

function renderCameras() {
  const container = document.getElementById('cameras-container');
  const section = document.getElementById('cameras-section');
  if (!container || !section) return;
  
  const cameras = Object.values(STATES).filter(e => e.entity_id.startsWith('camera.'));
  
  if (cameras.length === 0) {
    section.style.display = 'none';
    return;
  }
  
  section.style.display = 'block';
  container.innerHTML = '';
  
  cameras.slice(0, 4).forEach(camera => {
    const card = createCameraCard(camera);
    container.appendChild(card);
  });
}

function createCameraCard(camera) {
  const div = document.createElement('div');
  div.className = 'camera-card';
  
  const name = getEntityDisplayName(camera);
  
  div.innerHTML = `
    <div class="camera-header">
      <div class="camera-name">${name}</div>
      <div class="camera-controls">
        <button class="camera-btn" onclick="openCamera('${camera.entity_id}')" title="Open camera">🔗</button>
        <button class="camera-btn" onclick="refreshCamera('${camera.entity_id}')" title="Refresh snapshot">🔄</button>
      </div>
    </div>
    <div class="camera-embed">
      <img class="camera-img" alt="${name}">
      <div style="display: none;">Camera unavailable</div>
    </div>
  `;
  // Load snapshot using ha:// protocol (handled by main process)
  const imgEl = div.querySelector('.camera-img');
  if (imgEl) {
    imgEl.src = `ha://camera/${camera.entity_id}?t=${Date.now()}`;
    imgEl.onerror = () => {
      imgEl.style.display = 'none';
      const fallback = imgEl.nextElementSibling;
      if (fallback) fallback.style.display = 'flex';
    };
  }
  
  return div;
}

function updateWeatherFromHA() {
  const tempEl = document.getElementById('weather-temp');
  const conditionEl = document.getElementById('weather-condition');
  const humidityEl = document.getElementById('weather-humidity');
  const windEl = document.getElementById('weather-wind');
  const iconEl = document.getElementById('weather-icon');
  
  // Use selected weather entity if available, otherwise use first available
  let weather = null;
  if (CONFIG.selectedWeatherEntity && STATES[CONFIG.selectedWeatherEntity]) {
    weather = STATES[CONFIG.selectedWeatherEntity];
    console.log('Using selected weather entity:', CONFIG.selectedWeatherEntity);
  } else {
    const weatherEntities = Object.values(STATES).filter(e => e.entity_id.startsWith('weather.'));
    if (weatherEntities.length > 0) {
      weather = weatherEntities[0];
      console.log('Using first available weather entity:', weather.entity_id);
      
      // Auto-select the first weather entity if none is selected
      if (!CONFIG.selectedWeatherEntity) {
        CONFIG.selectedWeatherEntity = weather.entity_id;
        ipcRenderer.invoke('update-config', CONFIG);
        console.log('Auto-selected weather entity:', weather.entity_id);
      }
    }
    if (CONFIG.selectedWeatherEntity && !STATES[CONFIG.selectedWeatherEntity]) {
      console.log('Selected weather entity not found in states:', CONFIG.selectedWeatherEntity);
    }
  }
  
  if (!weather) {
    console.log('No weather entity found');
    if (tempEl) tempEl.textContent = '--°C';
    if (conditionEl) conditionEl.textContent = '--';
    if (humidityEl) humidityEl.textContent = '--%';
    if (windEl) windEl.textContent = '-- km/h';
    if (iconEl) iconEl.textContent = '🌤️';
    return;
  }
  
  console.log('Weather data:', {
    entity_id: weather.entity_id,
    state: weather.state,
    attributes: weather.attributes
  });
  
  // Update temperature
  if (tempEl && weather.attributes.temperature) {
    tempEl.textContent = `${Math.round(weather.attributes.temperature)}°C`;
  }
  
  // Update condition
  if (conditionEl) {
    if (weather.attributes.condition) {
      conditionEl.textContent = weather.attributes.condition;
    } else {
      // Fallback to state if condition is not available
      conditionEl.textContent = weather.state || '--';
    }
  }
  
  // Update humidity
  if (humidityEl && weather.attributes.humidity) {
    humidityEl.textContent = `${Math.round(weather.attributes.humidity)}%`;
  }
  
  // Update wind
  if (windEl) {
    let windText = '--';
    if (weather.attributes.wind_speed) {
      const speed = Math.round(weather.attributes.wind_speed);
      const direction = weather.attributes.wind_bearing;
      if (direction !== undefined) {
        const directionText = getWindDirection(direction);
        windText = `${speed} km/h ${directionText}`;
      } else {
        windText = `${speed} km/h`;
      }
    }
    windEl.textContent = windText;
  }
  
  // Update weather icon
  if (iconEl) {
    // Try to get condition from attributes first, then fall back to state
    const condition = weather.attributes.condition || weather.state;
    const temperature = weather.attributes.temperature;
    
    const icon = getWeatherIcon(condition, temperature);
    iconEl.textContent = icon.emoji;
    
    // Remove all animation classes first
    iconEl.classList.remove('animated', 'rain', 'snow', 'wind', 'sun', 'storm', 'cloud', 'fog');
    
    // Remove any existing rain droplets
    const existingDroplets = iconEl.querySelectorAll('.rain-droplet');
    existingDroplets.forEach(droplet => droplet.remove());
    
    // Add specific animation for certain conditions
    if (icon.animation) {
      iconEl.classList.add(icon.animation);
      
      // Add third rain droplet for rain animation
      if (icon.animation === 'rain') {
        const droplet = document.createElement('span');
        droplet.className = 'rain-droplet';
        droplet.textContent = '💧';
        iconEl.appendChild(droplet);
      }
    }
  }
}

function getWindDirection(bearing) {
  const directions = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'];
  const index = Math.round(bearing / 22.5) % 16;
  return directions[index];
}

function getWeatherIcon(condition, temperature) {
  if (!condition) {
    return { emoji: '🌤️', animation: null };
  }
  
  const conditionLower = condition.toLowerCase();
  const temp = temperature || 20;
  
  // Animated conditions - expanded matching
  if (conditionLower.includes('rain') || conditionLower.includes('drizzle') || 
      conditionLower.includes('shower') || conditionLower.includes('precipitation') ||
      conditionLower.includes('wet') || conditionLower.includes('damp')) {
    return { emoji: '🌧️', animation: 'rain' };
  }
  if (conditionLower.includes('storm') || conditionLower.includes('thunder') || 
      conditionLower.includes('lightning') || conditionLower.includes('thunderstorm') ||
      conditionLower.includes('severe') || conditionLower.includes('tornado')) {
    return { emoji: '⛈️', animation: 'storm' };
  }
  if (conditionLower.includes('snow') || conditionLower.includes('blizzard') || 
      conditionLower.includes('sleet') || conditionLower.includes('flurries') ||
      conditionLower.includes('winter') || conditionLower.includes('freezing')) {
    return { emoji: '❄️', animation: 'snow' };
  }
  if (conditionLower.includes('wind') || conditionLower.includes('breezy') || 
      conditionLower.includes('gusty') || conditionLower.includes('windy') ||
      conditionLower.includes('gale') || conditionLower.includes('hurricane')) {
    return { emoji: '💨', animation: 'wind' };
  }
  
  // Static conditions - expanded matching
  if (conditionLower.includes('clear') || conditionLower.includes('sunny') || 
      conditionLower.includes('fair') || conditionLower.includes('sunshine') ||
      conditionLower.includes('bright') || conditionLower.includes('hot')) {
    const icon = temp > 25 ? '☀️' : '🌤️';
    const animation = temp > 25 ? 'sun' : null;
    return { emoji: icon, animation: animation };
  }
  if (conditionLower.includes('cloud') || conditionLower.includes('overcast') || 
      conditionLower.includes('cloudy') || conditionLower.includes('clouds') ||
      conditionLower.includes('grey') || conditionLower.includes('gray') ||
      conditionLower.includes('dull') || conditionLower.includes('gloomy')) {
    return { emoji: '☁️', animation: 'cloud' };
  }
  if (conditionLower.includes('partly') || conditionLower.includes('scattered') || 
      conditionLower.includes('broken') || conditionLower.includes('variable') ||
      conditionLower.includes('mixed')) {
    return { emoji: '⛅', animation: 'cloud' };
  }
  if (conditionLower.includes('fog') || conditionLower.includes('mist') || 
      conditionLower.includes('haze') || conditionLower.includes('dust') || 
      conditionLower.includes('smoke') || conditionLower.includes('smog') ||
      conditionLower.includes('humid') || conditionLower.includes('damp')) {
    return { emoji: '🌫️', animation: 'fog' };
  }
  
  // Default based on temperature
  if (temp < 0) {
    return { emoji: '❄️', animation: 'snow' };
  }
  if (temp < 10) {
    return { emoji: '🌨️', animation: null };
  }
  if (temp > 30) {
    return { emoji: '🌡️', animation: null };
  }
  
  return { emoji: '🌤️', animation: null };
}

// Helper functions for entity display
function getEntityIcon(entity) {
  const domain = entity.entity_id.split('.')[0];
  const iconMap = {
    'light': '💡',
    'switch': '🔌',
    'fan': '🌀',
    'lock': '🔒',
    'cover': '🪟',
    'camera': '📹',
    'sensor': '📊',
    'binary_sensor': '📡',
    'climate': '🌡️',
    'media_player': '🎵',
    'scene': '🎨',
    'automation': '⚙️',
    'script': '📜',
    'weather': '🌤️',
    'person': '👤',
    'device_tracker': '📱'
  };
  return iconMap[domain] || '📋';
}

function getEntityTypeDescription(entity) {
  const domain = entity.entity_id.split('.')[0];
  const typeMap = {
    'light': 'Light',
    'switch': 'Switch',
    'fan': 'Fan',
    'lock': 'Lock',
    'cover': 'Cover',
    'camera': 'Camera',
    'sensor': 'Sensor',
    'binary_sensor': 'Binary Sensor',
    'climate': 'Climate',
    'media_player': 'Media Player',
    'scene': 'Scene',
    'automation': 'Automation',
    'script': 'Script',
    'weather': 'Weather',
    'person': 'Person',
    'device_tracker': 'Device Tracker',
    'input_boolean': 'Input Boolean',
    'input_number': 'Input Number',
    'input_select': 'Input Select',
    'input_text': 'Input Text',
    'input_datetime': 'Input Datetime',
    'timer': 'Timer',
    'alarm_control_panel': 'Alarm Control Panel',
    'vacuum': 'Vacuum',
    'water_heater': 'Water Heater',
    'humidifier': 'Humidifier',
    'button': 'Button',
    'number': 'Number',
    'select': 'Select',
    'text': 'Text',
    'datetime': 'Datetime',
    'date': 'Date',
    'time': 'Time',
    'tag': 'Tag',
    'counter': 'Counter',
    'calendar': 'Calendar',
    'todo': 'Todo',
    'update': 'Update',
    'group': 'Group',
    'sun': 'Sun',
    'zone': 'Zone',
    'proximity': 'Proximity',
    'conversation': 'Conversation',
    'tts': 'Text-to-Speech',
    'notify': 'Notification',
    'persistent_notification': 'Persistent Notification',
    'system_log': 'System Log',
    'logbook': 'Logbook',
    'history': 'History',
    'recorder': 'Recorder',
    'config': 'Configuration',
    'auth': 'Authentication',
    'onboarding': 'Onboarding',
    'supervisor': 'Supervisor',
    'hassio': 'Home Assistant OS',
    'homeassistant': 'Home Assistant Core',
    'frontend': 'Frontend',
    'api': 'API',
    'websocket_api': 'WebSocket API',
    'http': 'HTTP',
    'stream': 'Stream',
    'image': 'Image',
    'image_processing': 'Image Processing',
    'face_recognition': 'Face Recognition',
    'object_detection': 'Object Detection',
    'person': 'Person',
    'device_automation': 'Device Automation',
    'device_trigger': 'Device Trigger',
    'device_condition': 'Device Condition',
    'device_action': 'Device Action',
    'blueprint': 'Blueprint',
    'template': 'Template',
    'python_script': 'Python Script',
    'shell_command': 'Shell Command',
    'rest_command': 'REST Command',
    'command_line': 'Command Line',
    'local_file': 'Local File',
    'file': 'File',
    'folder': 'Folder',
    'folder_watcher': 'Folder Watcher',
    'ftp': 'FTP',
    'sftp': 'SFTP',
    'smb': 'SMB',
    'nfs': 'NFS',
    'webdav': 'WebDAV',
    'dropbox': 'Dropbox',
    'onedrive': 'OneDrive',
    'google_drive': 'Google Drive',
    'icloud': 'iCloud',
    'microsoft_graph': 'Microsoft Graph',
    'google': 'Google',
    'google_assistant': 'Google Assistant',
    'alexa': 'Alexa',
    'siri': 'Siri',
    'cortana': 'Cortana',
    'spotify': 'Spotify',
    'youtube': 'YouTube',
    'netflix': 'Netflix',
    'plex': 'Plex',
    'emby': 'Emby',
    'jellyfin': 'Jellyfin',
    'kodi': 'Kodi',
    'vlc': 'VLC',
    'mpd': 'Music Player Daemon',
    'squeezebox': 'Squeezebox',
    'sonos': 'Sonos',
    'bose': 'Bose',
    'harman_kardon': 'Harman Kardon',
    'denon': 'Denon',
    'marantz': 'Marantz',
    'onkyo': 'Onkyo',
    'pioneer': 'Pioneer',
    'yamaha': 'Yamaha',
    'samsungtv': 'Samsung TV',
    'lg_netcast': 'LG NetCast',
    'lg_smart': 'LG Smart TV',
    'roku': 'Roku',
    'firetv': 'Fire TV',
    'androidtv': 'Android TV',
    'appletv': 'Apple TV',
    'chromecast': 'Chromecast',
    'dlna_dmr': 'DLNA DMR',
    'upnp': 'UPnP',
    'airplay': 'AirPlay',
    'bluetooth': 'Bluetooth',
    'zigbee': 'Zigbee',
    'zwave': 'Z-Wave',
    'thread': 'Thread',
    'matter': 'Matter',
    'homekit': 'HomeKit',
    'homekit_controller': 'HomeKit Controller',
    'homekit_bridge': 'HomeKit Bridge',
    'homekit_accessory': 'HomeKit Accessory',
    'mqtt': 'MQTT',
    'modbus': 'Modbus',
    'knx': 'KNX',
    'opcua': 'OPC UA',
    'bacnet': 'BACnet',
    'lora': 'LoRa',
    'sigfox': 'Sigfox',
    'nb_iot': 'NB-IoT',
    'lte_m': 'LTE-M',
    'wifi': 'WiFi',
    'ethernet': 'Ethernet',
    'usb': 'USB',
    'serial': 'Serial',
    'gpio': 'GPIO',
    'i2c': 'I2C',
    'spi': 'SPI',
    'uart': 'UART',
    'can': 'CAN',
    'rs485': 'RS485',
    'rs232': 'RS232',
    'dmx': 'DMX',
    'artnet': 'ArtNet',
    'sACN': 'sACN',
    'dali': 'DALI',
    'lutron': 'Lutron',
    'lutron_caseta': 'Lutron Caseta',
    'lutron_ra2': 'Lutron RA2',
    'lutron_ra2_select': 'Lutron RA2 Select',
    'lutron_grafik_eye': 'Lutron Grafik Eye',
    'lutron_homeworks': 'Lutron HomeWorks',
    'lutron_radiora2': 'Lutron RadioRA2',
    'lutron_seeTouch': 'Lutron seeTouch',
    'lutron_seeTouch_keypad': 'Lutron seeTouch Keypad',
    'lutron_seeTouch_tabletop': 'Lutron seeTouch Tabletop',
    'lutron_seeTouch_wall': 'Lutron seeTouch Wall',
    'lutron_seeTouch_hybrid': 'Lutron seeTouch Hybrid',
    'lutron_seeTouch_hybrid_keypad': 'Lutron seeTouch Hybrid Keypad',
    'lutron_seeTouch_hybrid_tabletop': 'Lutron seeTouch Hybrid Tabletop',
    'lutron_seeTouch_hybrid_wall': 'Lutron seeTouch Hybrid Wall',
    'lutron_seeTouch_hybrid_hybrid': 'Lutron seeTouch Hybrid Hybrid',
    'lutron_seeTouch_hybrid_hybrid_keypad': 'Lutron seeTouch Hybrid Hybrid Keypad',
    'lutron_seeTouch_hybrid_hybrid_tabletop': 'Lutron seeTouch Hybrid Hybrid Tabletop',
    'lutron_seeTouch_hybrid_hybrid_wall': 'Lutron seeTouch Hybrid Hybrid Wall',
    'lutron_seeTouch_hybrid_hybrid_hybrid': 'Lutron seeTouch Hybrid Hybrid Hybrid',
    'lutron_seeTouch_hybrid_hybrid_hybrid_keypad': 'Lutron seeTouch Hybrid Hybrid Hybrid Keypad',
    'lutron_seeTouch_hybrid_hybrid_hybrid_tabletop': 'Lutron seeTouch Hybrid Hybrid Hybrid Tabletop',
    'lutron_seeTouch_hybrid_hybrid_hybrid_wall': 'Lutron seeTouch Hybrid Hybrid Hybrid Wall'
  };
  return typeMap[domain] || domain.charAt(0).toUpperCase() + domain.slice(1).replace(/_/g, ' ');
}

function getEntityDisplayName(entity) {
  // Check for custom display name first
  if (CONFIG.customEntityNames && CONFIG.customEntityNames[entity.entity_id]) {
    return CONFIG.customEntityNames[entity.entity_id];
  }
  return entity.attributes.friendly_name || entity.entity_id.split('.')[1].replace(/_/g, ' ');
}

function isTimerSensor(entity) {
  try {
    // Check if this sensor represents timer information
    const name = entity.entity_id.toLowerCase();
    const friendlyName = (entity.attributes?.friendly_name || '').toLowerCase();
    const deviceClass = entity.attributes?.device_class;
    
    return (
      name.includes('timer') ||
      friendlyName.includes('timer') ||
      deviceClass === 'duration' ||
      (entity.attributes?.unit_of_measurement === 'min' || 
       entity.attributes?.unit_of_measurement === 's' ||
       entity.attributes?.unit_of_measurement === 'h')
    );
  } catch (error) {
    console.error('Error in isTimerSensor:', error, entity);
    return false;
  }
}

function formatTimerSensorValue(entity, element = null) {
  try {
    const state = entity.state;
    
    // Handle unknown/unavailable states
    if (state === 'unknown' || state === 'unavailable') {
      return 'N/A';
    }
    
    // Parse the timestamp to get remaining time
    let remainingSeconds = 0;
    
    if (typeof state === 'string') {
      try {
        // Parse the timestamp (e.g., "2025-09-15T16:45:42-02:30")
        const endTime = new Date(state);
        const now = new Date();
        remainingSeconds = Math.max(0, Math.floor((endTime - now) / 1000));
      } catch (e) {
        // If parsing fails, return raw state
        return state;
      }
    }
    
    // If we have a valid remaining time and an element, start local countdown
    if (remainingSeconds > 0 && element) {
      const startTime = Date.now();
      const endTime = startTime + (remainingSeconds * 1000);
      
      TIMER_SENSOR_MAP.set(entity.entity_id, {
        element,
        endTime,
        startTime,
        originalValue: state,
        lastSync: startTime
      });
      
      startTimerSensorUpdates();
      startTimerSensorSync();
      
      // Return the formatted initial time
      return formatDuration(remainingSeconds * 1000);
    }
    
    // Return the formatted time (no real-time updates if no element)
    if (remainingSeconds > 0) {
      return formatDuration(remainingSeconds * 1000);
    }
    
    // If no valid time found, return the raw state
    return state;
  } catch (error) {
    console.error('Error in formatTimerSensorValue:', error, entity);
    return entity.state || 'Error';
  }
}

function getEntityDisplayState(entity) {
  const domain = entity.entity_id.split('.')[0];
  const state = entity.state;
  
  if (domain === 'sensor' && isTimerSensor(entity)) {
    // For timer sensors, just return the raw state initially
    // Real-time countdown will be handled in updateEntityInUI when the element is available
    return state;
  } else if (domain === 'sensor' && entity.attributes.unit_of_measurement) {
    return `${state} ${entity.attributes.unit_of_measurement}`;
  } else if (['light', 'switch', 'fan'].includes(domain)) {
    return state === 'on' ? 'On' : 'Off';
  } else if (domain === 'lock') {
    return state === 'locked' ? 'Locked' : 'Unlocked';
  } else if (domain === 'cover') {
    return state === 'open' ? 'Open' : 'Closed';
  } else if (domain === 'binary_sensor') {
    return state === 'on' ? 'Detected' : 'Clear';
  } else {
    return state;
  }
}

function getFilteredEntities() {
  let entities = Object.values(STATES);
  
  // Apply domain filters
  if (FILTERS.domains && FILTERS.domains.length > 0) {
    entities = entities.filter(e => FILTERS.domains.includes(e.entity_id.split('.')[0]));
  }
  
  // Apply area filters
  if (FILTERS.areas && FILTERS.areas.length > 0) {
    entities = entities.filter(e => {
      const areaId = e.attributes.area_id;
      return !areaId || FILTERS.areas.includes(areaId);
    });
  }
  
  // Apply hidden entities filter
  if (FILTERS.hidden && FILTERS.hidden.length > 0) {
    entities = entities.filter(e => !FILTERS.hidden.includes(e.entity_id));
  }
  
  // Sort by domain, then by name
  entities.sort((a, b) => {
    const domainA = a.entity_id.split('.')[0];
    const domainB = b.entity_id.split('.')[0];
    if (domainA !== domainB) {
      return domainA.localeCompare(domainB);
    }
    return getEntityDisplayName(a).localeCompare(getEntityDisplayName(b));
  });
  
  return entities;
}

function toggleEntity(entity) {
  if (typeof entity === 'string') {
    entity = STATES[entity];
  }
  if (!entity) {
    console.error('Entity not found:', entity);
    return;
  }
  
  const domain = entity.entity_id.split('.')[0];
  console.log(`Toggling ${entity.entity_id} (${domain}), current state: ${entity.state}`);
  
  if (domain === 'light') {
    // Simple on/off regardless of brightness; restore last state when turning on
    // Optimistic UI update for snappy feedback
    const newState = entity.state === 'on' ? 'off' : 'on';
    STATES[entity.entity_id] = { ...entity, state: newState };
    updateEntityInUI(STATES[entity.entity_id]);
    console.log(`Calling homeassistant.toggle for ${entity.entity_id}`);
    callService('homeassistant', 'toggle', { entity_id: entity.entity_id });
  } else if (['switch', 'fan'].includes(domain)) {
    const service = entity.state === 'on' ? 'turn_off' : 'turn_on';
    console.log(`Calling ${domain}.${service} for ${entity.entity_id}`);
    callService(domain, service, { entity_id: entity.entity_id });
  } else if (domain === 'lock') {
    const service = entity.state === 'locked' ? 'unlock' : 'lock';
    console.log(`Calling ${domain}.${service} for ${entity.entity_id}`);
    callService(domain, service, { entity_id: entity.entity_id });
  } else if (domain === 'cover') {
    const service = entity.state === 'open' ? 'close_cover' : 'open_cover';
    console.log(`Calling ${domain}.${service} for ${entity.entity_id}`);
    callService(domain, service, { entity_id: entity.entity_id });
  } else if (domain === 'scene') {
    // Activate scene
    console.log(`Activating scene ${entity.entity_id}`);
    callService(domain, 'turn_on', { entity_id: entity.entity_id });
  } else if (domain === 'script') {
    // Trigger script
    console.log(`Triggering script ${entity.entity_id}`);
    callService(domain, 'turn_on', { entity_id: entity.entity_id });
  } else if (domain === 'climate') {
    // Toggle climate on/off
    const service = entity.state === 'on' ? 'turn_off' : 'turn_on';
    console.log(`Calling ${domain}.${service} for ${entity.entity_id}`);
    callService(domain, service, { entity_id: entity.entity_id });
  } else if (domain === 'media_player') {
    // Toggle media player play/pause
    const service = entity.state === 'playing' ? 'media_pause' : 'media_play';
    console.log(`Calling ${domain}.${service} for ${entity.entity_id}`);
    callService(domain, service, { entity_id: entity.entity_id });
  } else if (domain === 'timer') {
    // Timer controls: start/pause/cancel based on current state
    let service;
    if (entity.state === 'idle') {
      service = 'start';
    } else if (entity.state === 'active') {
      service = 'pause';
    } else if (entity.state === 'paused') {
      service = 'start';
    } else {
      service = 'cancel';
    }
    console.log(`Calling ${domain}.${service} for ${entity.entity_id}`);
    callService(domain, service, { entity_id: entity.entity_id });
  } else {
    console.log(`No toggle action defined for domain: ${domain}`);
  }
}

// Use WebSocket for service calls (better for real-time updates)
function callService(domain, service, data = {}) {
  if (!WS || WS.readyState !== WebSocket.OPEN) {
    console.error('WebSocket not connected, falling back to HTTP');
    // Fallback to HTTP if WebSocket is not available
    if (!CONFIG || !CONFIG.homeAssistant.url || !CONFIG.homeAssistant.token) {
      console.error('Home Assistant not configured');
      return;
    }
    
    const url = `${CONFIG.homeAssistant.url}/api/services/${domain}/${service}`;
    const headers = {
      'Authorization': `Bearer ${CONFIG.homeAssistant.token}`,
      'Content-Type': 'application/json'
    };
    
    fetch(url, {
      method: 'POST',
      headers: headers,
      body: JSON.stringify(data)
    }).catch(error => {
      console.error('Service call failed:', error);
    });
    return;
  }

  try {
    const id = Date.now();
    WS.send(JSON.stringify({
      id: id,
      type: 'call_service',
      domain: domain,
      service: service,
      service_data: data
    }));
    console.log(`Service call: ${domain}.${service}`, data);
  } catch (error) {
    console.error('Failed to call service via WebSocket:', error);
  }
}

function openCamera(cameraId) {
  if (!CONFIG || !CONFIG.homeAssistant.url) {
    console.error('Home Assistant not configured');
    return;
  }
  
  const camera = STATES[cameraId];
  if (!camera) {
    console.error('Camera not found:', cameraId);
    return;
  }
  
  console.log(`Opening camera: ${cameraId}, state: ${camera.state}`);
  
  // Create a camera popup modal
  const modal = document.createElement('div');
  modal.className = 'modal camera-modal';
  modal.innerHTML = `
    <div class="modal-content camera-content">
      <div class="modal-header">
        <h2>${getEntityDisplayName(camera)}</h2>
        <button class="close-btn" onclick="this.closest('.modal').remove()">×</button>
      </div>
      <div class="modal-body">
        <div style="position: relative;">
          <img alt="${getEntityDisplayName(camera)}" class="camera-stream camera-img">
          <div class="camera-loading" id="camera-loading">
            <div class="spinner"></div>
            Loading live stream...
          </div>
        </div>
        <div style="margin-top: 12px; display:flex; gap:8px;">
          <button class="btn btn-secondary" id="snapshot-btn">Snapshot</button>
          <button class="btn btn-primary" id="live-btn">Live</button>
        </div>
        <div class="camera-info">
          <p><strong>Status:</strong> ${camera.state}</p>
          <p><strong>Last Updated:</strong> ${new Date(camera.last_updated).toLocaleString()}</p>
        </div>
      </div>
    </div>
  `;
  
  document.body.appendChild(modal);
  
  const img = modal.querySelector('.camera-stream');
  const snapshotBtn = modal.querySelector('#snapshot-btn');
  const liveBtn = modal.querySelector('#live-btn');
  const modalBody = modal.querySelector('.modal-body');
  const loadingEl = modal.querySelector('#camera-loading');
  let isLive = false;

  const showLoading = (show) => {
    if (loadingEl) {
      loadingEl.classList.toggle('show', show);
    }
  };

  const stopLive = () => {
    showLoading(false);
    // Stop HLS if running
    stopHlsStream(cameraId, modalBody);
    // Stop MJPEG by clearing src
    if (img) {
      const isMjpeg = img.src && img.src.includes('camera_stream/');
      if (isMjpeg) {
        try { img.src = ''; } catch (_e) {}
      }
      img.style.display = 'block';
    }
    isLive = false;
    if (liveBtn) { liveBtn.textContent = 'Live'; }
  };

  const loadSnapshot = async () => {
    stopLive();
    // Use ha:// protocol for snapshot (handled by main process)
    img.src = `ha://camera/${cameraId}?t=${Date.now()}`;
  };

  const startLive = async () => {
    stopLive();
    showLoading(true);
    
    // Try HLS first
    const hlsStarted = await startHlsStream(cameraId, modalBody, img);
    if (!hlsStarted) {
      // Fallback to MJPEG stream using ha:// protocol
      img.style.display = 'block';
      img.src = `ha://camera_stream/${cameraId}?t=${Date.now()}`;
      
      // Hide loading when MJPEG starts
      img.onload = () => showLoading(false);
      img.onerror = () => showLoading(false);
    } else {
      // Hide loading when HLS starts
      showLoading(false);
    }
    
    isLive = true;
    if (liveBtn) { liveBtn.textContent = 'Stop'; }
  };

  snapshotBtn.addEventListener('click', loadSnapshot);
  liveBtn.addEventListener('click', () => {
    if (isLive) {
      stopLive();
      loadSnapshot();
    } else {
      startLive();
    }
  });

  // default to snapshot
  loadSnapshot();
  
  // Clean up when modal is closed
  modal.addEventListener('click', (e) => {
    if (e.target === modal) {
      clearInterval(refreshInterval);
      modal.remove();
    }
  });
  
  const closeBtn = modal.querySelector('.close-btn');
  closeBtn.addEventListener('click', () => {
    stopLive();
    modal.remove();
  });
}

function showSensorDetails(sensor) {
  const modal = document.createElement('div');
  modal.className = 'modal sensor-modal';
  modal.innerHTML = `
    <div class="modal-content">
      <div class="modal-header">
        <h2>${getEntityDisplayName(sensor)}</h2>
        <button class="close-btn" onclick="this.closest('.modal').remove()">×</button>
      </div>
      <div class="modal-body">
        <div class="sensor-details">
          <div class="sensor-value">
            <span class="value">${getEntityDisplayState(sensor)}</span>
            <span class="unit">${sensor.attributes.unit_of_measurement || ''}</span>
          </div>
          <div class="sensor-info">
            <p><strong>State:</strong> ${sensor.state}</p>
            <p><strong>Last Updated:</strong> ${new Date(sensor.last_updated).toLocaleString()}</p>
            ${sensor.attributes.device_class ? `<p><strong>Type:</strong> ${sensor.attributes.device_class}</p>` : ''}
          </div>
        </div>
      </div>
    </div>
  `;
  
  document.body.appendChild(modal);
  
  // Auto-refresh sensor data every 10 seconds
  const refreshInterval = setInterval(() => {
    const updatedSensor = STATES[sensor.entity_id];
    if (updatedSensor) {
      const valueEl = modal.querySelector('.value');
      const stateEl = modal.querySelector('.sensor-info p:first-child');
      const timeEl = modal.querySelector('.sensor-info p:nth-child(2)');
      
      if (valueEl) valueEl.textContent = getEntityDisplayState(updatedSensor);
      if (stateEl) stateEl.innerHTML = `<strong>State:</strong> ${updatedSensor.state}`;
      if (timeEl) timeEl.innerHTML = `<strong>Last Updated:</strong> ${new Date(updatedSensor.last_updated).toLocaleString()}`;
    }
  }, 10000);
  
  // Clean up when modal is closed
  modal.addEventListener('click', (e) => {
    if (e.target === modal) {
      clearInterval(refreshInterval);
      modal.remove();
    }
  });
  
  const closeBtn = modal.querySelector('.close-btn');
  closeBtn.addEventListener('click', () => {
    clearInterval(refreshInterval);
    modal.remove();
  });
}

function showBrightnessSlider(light) {
  if (!light || !light.entity_id.startsWith('light.')) return;
  
  // Get the current light state from STATES to ensure we have the latest data
  const currentLight = STATES[light.entity_id];
  if (!currentLight) return;
  
  const currentBrightness = currentLight.state === 'on' && currentLight.attributes.brightness 
    ? Math.round((currentLight.attributes.brightness / 255) * 100) 
    : (currentLight.state === 'on' ? 100 : 0); // If light is on but no brightness attribute, assume 100%
  
  // Create modal for brightness control
  const modal = document.createElement('div');
  modal.className = 'modal brightness-modal';
  modal.innerHTML = `
    <div class="modal-content">
      <div class="modal-header">
        <h2>${getEntityDisplayName(currentLight)}</h2>
        <button class="close-btn" onclick="this.closest('.modal').remove()">×</button>
      </div>
      <div class="modal-body">
        <div class="brightness-content">
          <div class="brightness-label">Brightness</div>
          <div class="brightness-slider-container">
            <input type="range" 
                   class="brightness-slider" 
                   min="0" 
                   max="100" 
                   value="${currentBrightness}"
                   id="brightness-slider">
            <div class="brightness-value" id="brightness-value">${currentBrightness}%</div>
          </div>
          <div class="brightness-controls">
            <button class="brightness-btn" id="turn-off-btn">Turn Off</button>
            <button class="brightness-btn" id="turn-on-btn">Turn On</button>
          </div>
        </div>
      </div>
    </div>
  `;
  
  document.body.appendChild(modal);
  
  const slider = modal.querySelector('#brightness-slider');
  const valueDisplay = modal.querySelector('#brightness-value');
  const turnOffBtn = modal.querySelector('#turn-off-btn');
  const turnOnBtn = modal.querySelector('#turn-on-btn');
  
  // Update brightness value display
  const updateBrightnessDisplay = (value) => {
    valueDisplay.textContent = `${value}%`;
  };
  
  // Handle slider changes with debouncing for better performance
  let sliderTimeout = null;
  slider.addEventListener('input', (e) => {
    const value = parseInt(e.target.value);
    updateBrightnessDisplay(value);
    
    // Clear previous timeout
    if (sliderTimeout) {
      clearTimeout(sliderTimeout);
    }
    
    // Debounce the service call to avoid too many requests
    sliderTimeout = setTimeout(() => {
      if (value === 0) {
        // Turn off the light
        callService('light', 'turn_off', { entity_id: light.entity_id });
      } else {
        // Set brightness
        const brightness = Math.round((value / 100) * 255);
        callService('light', 'turn_on', { 
          entity_id: light.entity_id,
          brightness: brightness
        });
      }
    }, 100); // 100ms debounce
  });
  
  // Handle turn off button
  turnOffBtn.addEventListener('click', () => {
    slider.value = 0;
    updateBrightnessDisplay(0);
    callService('light', 'turn_off', { entity_id: light.entity_id });
  });
  
  // Handle turn on button
  turnOnBtn.addEventListener('click', () => {
    // Turn on to 50% brightness (or use last known brightness if available)
    const lastBrightness = light.attributes.brightness ? Math.round((light.attributes.brightness / 255) * 100) : 50;
    const value = lastBrightness > 0 ? lastBrightness : 50;
    slider.value = value;
    updateBrightnessDisplay(value);
    const brightness = Math.round((value / 100) * 255);
    callService('light', 'turn_on', { 
      entity_id: light.entity_id,
      brightness: brightness
    });
  });
  
  // Clean up when modal is closed
  modal.addEventListener('click', (e) => {
    if (e.target === modal) {
      if (sliderTimeout) clearTimeout(sliderTimeout);
      modal.remove();
    }
  });
  
  const closeBtn = modal.querySelector('.close-btn');
  closeBtn.addEventListener('click', () => {
    if (sliderTimeout) clearTimeout(sliderTimeout);
    modal.remove();
  });
}

function renderActiveTab() {
  // For new single-view design, render everything in one view
  renderSingleView();
}

// Render functions for each tab
function renderDashboardLayout(tabId, container) {
  const layout = TAB_LAYOUTS[tabId] || [];
  const isEditMode = EDIT_MODE_TAB_ID === tabId;
  const tabName = (tabId === 'dashboard')
    ? 'Dashboard'
    : (CONFIG.customTabs[tabId]?.name || 'Custom Tab');

  const toolbarHTML = isEditMode
    ? `
      <button class="btn btn-primary" onclick="disableEditMode(true)">Save changes</button>
      <button class="btn btn-secondary" onclick="disableEditMode(false)">Discard</button>
      <button class="btn btn-secondary" onclick="openEntityDrawer('${tabId}')">+ Add</button>
    `
    : `<button class="btn btn-secondary" onclick="enableEditMode('${tabId}')">Customize</button>`;

  if (layout.length > 0 || isEditMode) {
    container.innerHTML = `
      <div class="section">
        <div class="section-header">
          <h3 class="section-title">${tabName}</h3>
        </div>
        <div class="section-toolbar">${toolbarHTML}</div>
        <div id="${tabId}-grid" class="entity-grid"></div>
      </div>
    `;
    const grid = document.getElementById(`${tabId}-grid`);
    layout.forEach(entityId => {
      const entity = STATES[entityId];
      if (entity && !FILTERS.hidden.includes(entityId)) {
        const card = createEntityCard(entity, { context: 'dashboard', tabId });
        if (card) grid.appendChild(card);
      }
    });
    if (isEditMode) {
      setupDragAndDrop(tabId, grid);
    }
  } else {
    container.innerHTML = `
      <div class="section">
        <div class="section-header">
          <h3 class="section-title">${tabName}</h3>
        </div>
        <div class="section-toolbar">${toolbarHTML}</div>
        <p style="text-align: center; padding: 20px;">
          Click "Customize" to create your personalized dashboard
        </p>
      </div>
    `;
  }
}

function renderScenes() {
  const container = document.getElementById('scenes-container');
  if (!container) return;

  container.innerHTML = '';

  if (Object.keys(STATES).length === 0) {
    renderSkeletonCards(container, 4);
    return;
  }

  const scenes = Object.values(STATES)
    .filter(e => e.entity_id.startsWith('scene.'))
    .filter(e => !FILTERS.hidden.includes(e.entity_id));

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
  const container = document.getElementById('automations-container');
  if (!container) return;

  container.innerHTML = '';

  if (Object.keys(STATES).length === 0) {
    renderSkeletonCards(container, 4);
    return;
  }

  const automations = Object.values(STATES)
    .filter(e => e.entity_id.startsWith('automation.'))
    .filter(e => !FILTERS.hidden.includes(e.entity_id));

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
  const container = document.getElementById('media-players-container');
  if (!container) return;

  container.innerHTML = '';

  if (Object.keys(STATES).length === 0) {
    renderSkeletonCards(container, 4);
    return;
  }

  const players = Object.values(STATES)
    .filter(e => e.entity_id.startsWith('media_player.'))
    .filter(e => !FILTERS.hidden.includes(e.entity_id));

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
  hideMotionPopup(true);

  container.innerHTML = '';

  if (CAMERA_REFRESH_INTERVAL) {
    clearInterval(CAMERA_REFRESH_INTERVAL);
    CAMERA_REFRESH_INTERVAL = null;
  }

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

  CAMERA_REFRESH_INTERVAL = setInterval(() => {
    cameraIds.forEach(id => { if (!LIVE_CAMERAS.has(id)) refreshCamera(id); });
  }, 10000);
}

function updateEntityInUI(entity) {
  if (!entity) return;

  // Update entity cards
  const cards = document.querySelectorAll(`.entity-card[data-entity-id="${entity.entity_id}"]`);
  cards.forEach(card => {
    const isDashboard = card.dataset.context === 'dashboard';
    const isCamera = entity.entity_id.startsWith('camera.');
    if (isDashboard && isCamera && LIVE_CAMERAS.has(entity.entity_id)) {
      return;
    }
    const grid = card.closest('.entity-grid');
    const tabId = grid ? grid.id.replace('-grid', '') : EDIT_MODE_TAB_ID;
    const newCard = createEntityCard(entity, { context: card.dataset.context, tabId });
    if (newCard) card.replaceWith(newCard);
  });

  // Update control items
  const controlItems = document.querySelectorAll(`.control-item[data-entity-id="${entity.entity_id}"]`);
  controlItems.forEach(item => {
    let stateEl = item.querySelector('.control-state');
    const infoEl = item.querySelector('.control-info');

    if (entity.entity_id.startsWith('sensor.')) {
      // Ensure element exists
      if (!stateEl && infoEl) {
        stateEl = document.createElement('div');
        stateEl.className = 'control-state';
        infoEl.appendChild(stateEl);
      }
      if (stateEl) {
        if (isTimerSensor(entity)) {
          // For timer sensors, pass the element for real-time updates
          stateEl.textContent = formatTimerSensorValue(entity, stateEl);
        } else {
          stateEl.textContent = getEntityDisplayState(entity);
        }
      }
    } else if (entity.entity_id.startsWith('light.')) {
      if (entity.state === 'on' && entity.attributes && typeof entity.attributes.brightness === 'number') {
        const brightness = Math.round((entity.attributes.brightness / 255) * 100);
        if (!stateEl && infoEl) {
          stateEl = document.createElement('div');
          stateEl.className = 'control-state';
          infoEl.appendChild(stateEl);
        }
        if (stateEl) stateEl.textContent = `${brightness}%`;
      } else {
        // Show explicit Off when the light is off
        if (!stateEl && infoEl) {
          stateEl = document.createElement('div');
          stateEl.className = 'control-state';
          infoEl.appendChild(stateEl);
        }
        if (stateEl) stateEl.textContent = 'Off';
      }
    } else if (entity.entity_id.startsWith('climate.')) {
      const temp = entity.attributes.current_temperature || entity.attributes.temperature;
      if (temp != null) {
        if (!stateEl && infoEl) {
          stateEl = document.createElement('div');
          stateEl.className = 'control-state';
          infoEl.appendChild(stateEl);
        }
        if (stateEl) stateEl.textContent = `${temp}°`;
      } else if (stateEl) {
        stateEl.remove();
      }
    } else if (entity.entity_id.startsWith('timer.')) {
      // Timer entities need special handling for countdown updates
      if (!stateEl && infoEl) {
        stateEl = document.createElement('div');
        stateEl.className = 'control-state timer-countdown';
        infoEl.appendChild(stateEl);
      }
      if (stateEl) {
        const timerDisplay = getTimerDisplay(entity);
        stateEl.textContent = timerDisplay;
        
        // Update data-state attribute for CSS styling
        item.setAttribute('data-state', entity.state);
        
        // Start countdown updates for active timers
        if (entity.state === 'active') {
          updateTimerCountdown(entity, stateEl);
        }
      }
    }

    // Update active state
    const isActive = entity.state === 'on' || 
                     entity.state === 'open' || 
                     entity.state === 'unlocked' ||
                     entity.state === 'playing' ||
                     entity.state === 'active';
    // All entities use the same styling - no special treatment for any entity type
    
    // Update tooltip
    if (entity.entity_id.startsWith('sensor.')) {
      item.title = `${getEntityDisplayName(entity)}: ${getEntityDisplayState(entity)}`;
    } else if (entity.entity_id.startsWith('light.')) {
      item.title = 'Click to toggle, hold for brightness control';
    } else {
      item.title = `Click to toggle ${getEntityDisplayName(entity)}`;
    }
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
  const motionEnabled = document.getElementById('motion-popup-enabled');
  const motionCams = document.getElementById('motion-popup-cameras');
  const motionAutoHide = document.getElementById('motion-popup-autohide');
  const motionCooldown = document.getElementById('motion-popup-cooldown');
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
  const mp = CONFIG.motionPopup || {};
  if (motionEnabled) motionEnabled.checked = !!mp.enabled;
  if (motionCams) motionCams.value = (mp.cameras || []).join(', ');
  if (motionAutoHide) motionAutoHide.value = Math.max(3, Math.min(120, parseInt(mp.autoHideSeconds || 12, 10)));
  if (motionCooldown) motionCooldown.value = Math.max(0, Math.min(600, parseInt(mp.cooldownSeconds || 30, 10)));
  if (opacitySlider) {
    // Ensure opacity is within safe range (20% to 100%)
    const safeOpacity = Math.max(0.2, Math.min(1, CONFIG.opacity || 0.95));
    CONFIG.opacity = safeOpacity; // Update config to safe value
    opacitySlider.value = safeOpacity;
    if (opacityValue) opacityValue.textContent = `${Math.round(safeOpacity * 100)}%`;
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

  // Load hotkeys and alerts settings
  const globalHotkeysEnabled = document.getElementById('global-hotkeys-enabled');
  const hotkeysSection = document.getElementById('hotkeys-section');
  if (globalHotkeysEnabled && hotkeysSection) {
    globalHotkeysEnabled.checked = !!(CONFIG.globalHotkeys && CONFIG.globalHotkeys.enabled);
    hotkeysSection.style.display = globalHotkeysEnabled.checked ? 'block' : 'none';
  }

  const entityAlertsEnabled = document.getElementById('entity-alerts-enabled');
  const alertsSection = document.getElementById('alerts-section');
  if (entityAlertsEnabled && alertsSection) {
    entityAlertsEnabled.checked = !!(CONFIG.entityAlerts && CONFIG.entityAlerts.enabled);
    alertsSection.style.display = entityAlertsEnabled.checked ? 'block' : 'none';
  }

  populateDomainFilters();
  populateAreaFilter();

  setupEntitySearchInput('favorite-entities');
  setupEntitySearchInput('camera-entities', ['camera']);
  setupEntitySearchInput('motion-popup-cameras', ['camera']);

  // Initialize update UI
  initUpdateUI();

  modal.classList.remove('hidden');
  modal.style.display = 'flex';
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
  const prevAlwaysOnTop = CONFIG.alwaysOnTop;
  const favoritesInput = document.getElementById('favorite-entities');
  const camerasInput = document.getElementById('camera-entities');
  const motionEnabled = document.getElementById('motion-popup-enabled');
  const motionCams = document.getElementById('motion-popup-cameras');
  const motionAutoHide = document.getElementById('motion-popup-autohide');
  const motionCooldown = document.getElementById('motion-popup-cooldown');
  const showDetails = document.getElementById('show-details');
  const themeSelect = document.getElementById('theme-select');
  const highContrast = document.getElementById('high-contrast');
  const opaquePanels = document.getElementById('opaque-panels');
  const densitySelect = document.getElementById('density-select');
  const opacitySlider = document.getElementById('opacity-slider');

  if (urlInput) CONFIG.homeAssistant.url = urlInput.value.trim();
  if (tokenInput) CONFIG.homeAssistant.token = tokenInput.value.trim();
  if (intervalInput) CONFIG.updateInterval = Math.max(1000, parseInt(intervalInput.value, 10) * 1000);
  if (alwaysOnTop) CONFIG.alwaysOnTop = alwaysOnTop.checked;
  if (opacitySlider) CONFIG.opacity = Math.max(0.2, Math.min(1, parseFloat(opacitySlider.value)));
  if (favoritesInput) CONFIG.favoriteEntities = favoritesInput.value.split(',').map(s => s.trim()).filter(Boolean);
  if (camerasInput) CONFIG.cameraEntities = camerasInput.value.split(',').map(s => s.trim()).filter(Boolean);

  CONFIG.motionPopup = CONFIG.motionPopup || {};
  if (motionEnabled) CONFIG.motionPopup.enabled = !!motionEnabled.checked;
  if (motionCams) CONFIG.motionPopup.cameras = motionCams.value.split(',').map(s => s.trim()).filter(Boolean);
  if (motionAutoHide) CONFIG.motionPopup.autoHideSeconds = Math.max(3, Math.min(120, parseInt(motionAutoHide.value || 12, 10)));
  if (motionCooldown) CONFIG.motionPopup.cooldownSeconds = Math.max(0, Math.min(600, parseInt(motionCooldown.value || 30, 10)));

  CONFIG.ui = CONFIG.ui || {};
  if (showDetails) CONFIG.ui.showDetails = !!showDetails.checked;
  if (themeSelect) CONFIG.ui.theme = themeSelect.value || 'auto';
  if (highContrast) CONFIG.ui.highContrast = !!highContrast.checked;
  if (opaquePanels) CONFIG.ui.opaquePanels = !!opaquePanels.checked;
  if (densitySelect) CONFIG.ui.density = densitySelect.value || 'comfortable';

  // Save hotkeys and alerts settings
  const globalHotkeysEnabled = document.getElementById('global-hotkeys-enabled');
  if (globalHotkeysEnabled) {
    CONFIG.globalHotkeys = CONFIG.globalHotkeys || { enabled: false, hotkeys: {} };
    CONFIG.globalHotkeys.enabled = globalHotkeysEnabled.checked;
  }

  const entityAlertsEnabled = document.getElementById('entity-alerts-enabled');
  if (entityAlertsEnabled) {
    CONFIG.entityAlerts = CONFIG.entityAlerts || { enabled: false, alerts: {} };
    CONFIG.entityAlerts.enabled = entityAlertsEnabled.checked;
  }

  const checkboxes = document.querySelectorAll('#domain-filters input[type="checkbox"]');
  FILTERS.domains = Array.from(checkboxes)
    .filter(cb => cb.checked)
    .map(cb => cb.value);

  const areaSelect = document.getElementById('area-select');
  if (areaSelect) {
    FILTERS.areas = Array.from(areaSelect.selectedOptions).map(opt => opt.value);
  }

  CONFIG.filters = FILTERS;

  try {
    await ipcRenderer.invoke('update-config', CONFIG);

    if (prevAlwaysOnTop !== CONFIG.alwaysOnTop) {
      try {
        const res = await ipcRenderer.invoke('set-always-on-top', CONFIG.alwaysOnTop);
        const state = await ipcRenderer.invoke('get-window-state');
        if (!res?.applied || state?.alwaysOnTop !== CONFIG.alwaysOnTop) {
          if (confirm('Changing "Always on top" may require a restart. Restart now?')) {
            await ipcRenderer.invoke('restart-app');
            return;
          }
        }
      } catch (_error) {
        // Ignore errors when setting always on top
      }
    }

    closeSettings();

    applyTheme(CONFIG.ui?.theme || 'auto');
    applyUiPreferences(CONFIG.ui || {});

    connectWebSocket();
  } catch (error) {
    console.error('Failed to save config:', error);
  }
}

function wireUI() {
  const settingsBtn = document.getElementById('settings-btn');
  if (settingsBtn) settingsBtn.onclick = openSettings;
  
  const closeSettingsBtn = document.getElementById('close-settings');
  if (closeSettingsBtn) closeSettingsBtn.onclick = closeSettings;
  
  const reorganizeBtn = document.getElementById('reorganize-quick-controls-btn');
  if (reorganizeBtn) reorganizeBtn.onclick = toggleReorganizeMode;

  // Add entities button removed from header - functionality moved to Quick Access section

  const closeEntitySelectorBtn = document.getElementById('close-entity-selector');
  if (closeEntitySelectorBtn) closeEntitySelectorBtn.onclick = () => {
    document.getElementById('entity-selector').classList.add('hidden');
  };

  const manageQuickControlsBtn = document.getElementById('manage-quick-controls-btn');
  if (manageQuickControlsBtn) manageQuickControlsBtn.onclick = openQuickControlsModal;

  const closeQuickControlsBtn = document.getElementById('close-quick-controls');
  if (closeQuickControlsBtn) closeQuickControlsBtn.onclick = () => {
    // Clear search term when closing
    const searchInput = document.getElementById('quick-controls-search');
    if (searchInput) {
      searchInput.value = '';
      // Trigger search to show all items again
      searchInput.dispatchEvent(new Event('input'));
    }
    document.getElementById('quick-controls-modal').classList.add('hidden');
  };
  
  // Weather configuration
  const closeWeatherConfig = document.getElementById('close-weather-config');
  if (closeWeatherConfig) closeWeatherConfig.onclick = () => {
    document.getElementById('weather-config-modal').classList.add('hidden');
  };
  
  const clearWeather = document.getElementById('clear-weather');
  if (clearWeather) clearWeather.onclick = clearWeatherEntity;

  const filterBtn = document.getElementById('filter-btn');
  if (filterBtn) filterBtn.onclick = showFilterModal;

  const layoutBtn = document.getElementById('layout-btn');
  if (layoutBtn) layoutBtn.onclick = () => {
    const activeTab = document.querySelector('.tab-btn.active');
    if (activeTab) enableEditMode(activeTab.dataset.tab);
  };

  const manageTabsBtn = document.getElementById('manage-tabs-btn');
  if (manageTabsBtn) manageTabsBtn.onclick = openManageTabsModal;

  const refreshBtn = document.getElementById('refresh-btn');
  if (refreshBtn) refreshBtn.onclick = renderActiveTab;

  const closeBtn = document.getElementById('close-btn');
  if (closeBtn) closeBtn.onclick = () => {
    // Properly quit the application instead of just closing the window
    ipcRenderer.invoke('quit-app');
  };

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

  // Update UI event handlers
  const checkUpdatesBtn = document.getElementById('check-updates-btn');
  if (checkUpdatesBtn) {
    checkUpdatesBtn.onclick = checkForUpdates;
  }

  const installUpdateBtn = document.getElementById('install-update-btn');
  if (installUpdateBtn) {
    installUpdateBtn.onclick = installUpdate;
  }

  const addTabBtn = document.getElementById('add-tab-btn');
  if (addTabBtn) {
    addTabBtn.onclick = () => {
      const input = document.getElementById('new-tab-name');
      if (input && input.value.trim()) {
        addCustomTab(input.value.trim());
        input.value = '';
        openManageTabsModal(); // Refresh the modal
      }
    };
  }

  const closeManageTabsModalBtn = document.getElementById('close-manage-tabs-modal');
  if (closeManageTabsModalBtn) {
    closeManageTabsModalBtn.onclick = () => {
      document.getElementById('manage-tabs-modal').classList.add('hidden');
    };
  }

  // Global Hotkeys UI handlers
  const globalHotkeysEnabled = document.getElementById('global-hotkeys-enabled');
  const hotkeysSection = document.getElementById('hotkeys-section');
  if (globalHotkeysEnabled && hotkeysSection) {
    globalHotkeysEnabled.onchange = (e) => {
      const enabled = e.target.checked;
      hotkeysSection.style.display = enabled ? 'block' : 'none';
      toggleHotkeys(enabled);
    };
  }

  const manageHotkeysBtn = document.getElementById('manage-hotkeys-btn');
  if (manageHotkeysBtn) manageHotkeysBtn.onclick = openHotkeysModal;

  const closeHotkeysBtn = document.getElementById('close-hotkeys');
  if (closeHotkeysBtn) closeHotkeysBtn.onclick = closeHotkeysModal;

  // Entity Alerts UI handlers
  const entityAlertsEnabled = document.getElementById('entity-alerts-enabled');
  const alertsSection = document.getElementById('alerts-section');
  if (entityAlertsEnabled && alertsSection) {
    entityAlertsEnabled.onchange = (e) => {
      const enabled = e.target.checked;
      alertsSection.style.display = enabled ? 'block' : 'none';
      toggleAlerts(enabled);
    };
  }

  const manageAlertsBtn = document.getElementById('manage-alerts-btn');
  if (manageAlertsBtn) manageAlertsBtn.onclick = openAlertsModal;

  const closeAlertsBtn = document.getElementById('close-alerts');
  if (closeAlertsBtn) closeAlertsBtn.onclick = closeAlertsModal;

  // Hotkey config modal handlers
  const closeHotkeyConfigBtn = document.getElementById('close-hotkey-config');
  if (closeHotkeyConfigBtn) closeHotkeyConfigBtn.onclick = closeHotkeyConfigModal;

  const cancelHotkeyBtn = document.getElementById('cancel-hotkey');
  if (cancelHotkeyBtn) cancelHotkeyBtn.onclick = closeHotkeyConfigModal;

  const saveHotkeyBtn = document.getElementById('save-hotkey');
  if (saveHotkeyBtn) saveHotkeyBtn.onclick = saveHotkey;

  // Alert config modal handlers
  const closeAlertConfigBtn = document.getElementById('close-alert-config');
  if (closeAlertConfigBtn) closeAlertConfigBtn.onclick = closeAlertConfigModal;

  const cancelAlertBtn = document.getElementById('cancel-alert');
  if (cancelAlertBtn) cancelAlertBtn.onclick = closeAlertConfigModal;

  const saveAlertBtn = document.getElementById('save-alert');
  if (saveAlertBtn) saveAlertBtn.onclick = saveAlert;

  // Alert type radio button handlers
  const alertTypeRadios = document.querySelectorAll('input[name="alert-type"]');
  alertTypeRadios.forEach(radio => {
    radio.addEventListener('change', (e) => {
      const specificStateGroup = document.getElementById('specific-state-group');
      if (specificStateGroup) {
        specificStateGroup.style.display = e.target.value === 'specific-state' ? 'block' : 'none';
      }
    });
  });


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

async function init() {
  try {
    showLoading(true);
    
    // Initialize new UI structure
    initializeNewUI();
    
    // Test if UI elements exist
    console.log('UI elements check:', {
      statusCard: !!document.getElementById('connection-status'),
      timeCard: !!document.getElementById('current-time'),
      weatherCard: !!document.getElementById('weather-temp'),
      quickControls: !!document.getElementById('quick-controls'),
      entitiesContainer: !!document.getElementById('entities-container')
    });
    
    CONFIG = await ipcRenderer.invoke('get-config');
    console.log('CONFIG loaded:', CONFIG);
    console.log('Selected weather entity:', CONFIG.selectedWeatherEntity);
    
    // Initialize hotkeys and alerts
    initializeHotkeysAndAlerts();
    requestNotificationPermission();
    
    // Update weather immediately after config is loaded
    updateWeatherFromHA();
    
    // Retry weather update after a short delay in case states aren't loaded yet
    setTimeout(() => {
      console.log('Retrying weather update after delay...');
      updateWeatherFromHA();
    }, 2000);

    if (!CONFIG) {
      console.error('Failed to load configuration');
      showLoading(false);
      return;
    }

    if (CONFIG.filters) {
      FILTERS = { ...FILTERS, ...CONFIG.filters };
    }

    if (CONFIG.tabLayouts) {
        TAB_LAYOUTS = CONFIG.tabLayouts;
    } else if (CONFIG.dashboardLayout) { // Backwards compatibility
        TAB_LAYOUTS = { dashboard: CONFIG.dashboardLayout };
        CONFIG.tabLayouts = TAB_LAYOUTS;
        delete CONFIG.dashboardLayout;
    } else {
        TAB_LAYOUTS = { dashboard: [] };
    }
    if (!CONFIG.customTabs) {
        CONFIG.customTabs = {};
    }

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
    
    // Try to connect to Home Assistant
    try {
    connectWebSocket();
    } catch (error) {
      console.error('Failed to connect to Home Assistant:', error);
      setStatus(false);
    }
    
    // Always hide loading screen after initialization
    showLoading(false);
    
    // Render the UI even if HA connection fails
    renderActiveTab();
    
    // Set a timeout to hide loading screen after 5 seconds as backup
    setTimeout(() => {
      showLoading(false);
    }, 5000);

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

    setTimeout(() => {
      renderActiveTab();
      showLoading(false);
    }, 100);
  } catch (error) {
    console.error('Initialization error:', error);
    showLoading(false);
  }
}

// Update UI state management
let updateState = {
  status: 'idle',
  progress: 0,
  version: null,
  availableVersion: null
};

// Compatibility layer for new UI structure
function initializeNewUI() {
  // Initialize connection indicator as clean dot
  const connectionIndicator = document.getElementById('connection-status');
  if (connectionIndicator) {
    connectionIndicator.innerHTML = ''; // Keep it clean - just the dot
    connectionIndicator.className = 'connection-indicator'; // Start as disconnected
  }
  
  // Initialize time display
  updateTimeDisplay();
  setInterval(updateTimeDisplay, 1000);
  
  // Initialize weather display
  updateWeatherDisplay();
  
  // Add long-press functionality to weather card
  setupWeatherCardLongPress();

  // Try to update weather immediately if config is available
  if (CONFIG && CONFIG.selectedWeatherEntity) {
    updateWeatherFromHA();
  }
  
  // Set up periodic weather updates every 5 minutes to ensure icon changes
  setInterval(updateWeatherFromHA, 5 * 60 * 1000);
}

function updateTimeDisplay() {
  const now = new Date();
  const timeStr = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  const dateStr = now.toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' });
  
  const timeEl = document.getElementById('current-time');
  const dateEl = document.getElementById('current-date');
  
  if (timeEl) timeEl.textContent = timeStr;
  if (dateEl) dateEl.textContent = dateStr;
}

function updateWeatherDisplay() {
  // This will be populated when we get weather data from Home Assistant
  const tempEl = document.getElementById('weather-temp');
  const conditionEl = document.getElementById('weather-condition');
  const humidityEl = document.getElementById('weather-humidity');
  const windEl = document.getElementById('weather-wind');
  const iconEl = document.getElementById('weather-icon');
  
  if (tempEl) tempEl.textContent = '--°C';
  if (conditionEl) conditionEl.textContent = '--';
  if (humidityEl) humidityEl.textContent = '--%';
  if (windEl) windEl.textContent = '-- km/h';
  if (iconEl) iconEl.textContent = '🌤️';
}

function setupWeatherCardLongPress() {
  const weatherCard = document.getElementById('weather-card');
  if (!weatherCard) return;
  
  let longPressTimer = null;
  let longPressTriggered = false;
  
  weatherCard.addEventListener('mousedown', (e) => {
    longPressTimer = setTimeout(() => {
      longPressTriggered = true;
      openWeatherConfig();
    }, 500); // 500ms long press
  });
  
  weatherCard.addEventListener('mouseup', () => {
    clearTimeout(longPressTimer);
    longPressTimer = null;
  });
  
  weatherCard.addEventListener('mouseleave', () => {
    clearTimeout(longPressTimer);
    longPressTimer = null;
  });
}

function openWeatherConfig() {
  const modal = document.getElementById('weather-config-modal');
  if (!modal) return;
  
  modal.classList.remove('hidden');
  loadWeatherEntities();
  updateCurrentWeatherInfo();
}

function loadWeatherEntities() {
  const container = document.getElementById('weather-entities-list');
  if (!container) return;
  
  container.innerHTML = '';
  
  const weatherEntities = Object.values(STATES).filter(e => e.entity_id.startsWith('weather.'));
  
  if (weatherEntities.length === 0) {
    container.innerHTML = '<div class="no-entities">No weather entities found in Home Assistant</div>';
    return;
  }
  
  weatherEntities.forEach(entity => {
    const item = document.createElement('div');
    item.className = 'entity-selector-item';
    item.innerHTML = `
      <div class="entity-selector-info">
        <span class="entity-selector-icon">🌤️</span>
        <div class="entity-selector-details">
          <div class="entity-selector-name">${entity.attributes?.friendly_name || entity.entity_id}</div>
          <div class="entity-selector-state">${entity.state}</div>
        </div>
      </div>
      <div class="entity-selector-actions">
        <button class="entity-selector-btn add" onclick="selectWeatherEntity('${entity.entity_id}')">
          Select
        </button>
      </div>
    `;
    container.appendChild(item);
  });
}

function updateCurrentWeatherInfo() {
  const nameEl = document.getElementById('current-weather-name');
  if (!nameEl) return;
  
  const currentWeather = CONFIG.selectedWeatherEntity;
  if (currentWeather && STATES[currentWeather]) {
    const entity = STATES[currentWeather];
    nameEl.textContent = entity.attributes?.friendly_name || entity.entity_id;
  } else {
    nameEl.textContent = 'None selected';
  }
}

function selectWeatherEntity(entityId) {
  CONFIG.selectedWeatherEntity = entityId;
  ipcRenderer.invoke('update-config', CONFIG);
  updateCurrentWeatherInfo();
  updateWeatherFromHA();
  showToast('Weather entity selected successfully!');
}

function clearWeatherEntity() {
  CONFIG.selectedWeatherEntity = null;
  ipcRenderer.invoke('update-config', CONFIG);
  updateCurrentWeatherInfo();
  updateWeatherFromHA();
  showToast('Weather entity cleared');
}

// Update UI elements
function updateUpdateUI() {
  const statusEl = document.getElementById('update-status');
  const statusTextEl = document.getElementById('update-status-text');
  const checkBtn = document.getElementById('check-updates-btn');
  const installBtn = document.getElementById('install-update-btn');
  const progressEl = document.getElementById('update-progress');
  const progressFill = document.getElementById('progress-fill');
  const progressText = document.getElementById('progress-text');
  const checkText = document.getElementById('check-updates-text');
  const installText = document.getElementById('install-update-text');

  if (!statusEl || !statusTextEl || !checkBtn || !installBtn) return;

  // Update status display
  statusEl.className = `update-status ${updateState.status}`;
  
  switch (updateState.status) {
    case 'checking':
      statusTextEl.textContent = 'Checking for updates...';
      checkBtn.disabled = true;
      checkText.textContent = 'Checking...';
      installBtn.classList.add('hidden');
      progressEl.classList.add('hidden');
      break;
      
    case 'available':
      statusTextEl.textContent = `Update available: v${updateState.availableVersion}`;
      checkBtn.disabled = false;
      checkText.textContent = 'Check for Updates';
      installBtn.classList.remove('hidden');
      installText.textContent = 'Download & Install';
      progressEl.classList.add('hidden');
      break;
      
    case 'downloading':
      statusTextEl.textContent = 'Downloading update...';
      checkBtn.disabled = true;
      checkText.textContent = 'Downloading...';
      installBtn.classList.add('hidden');
      progressEl.classList.remove('hidden');
      progressFill.style.width = `${updateState.progress}%`;
      progressText.textContent = `${Math.round(updateState.progress)}%`;
      break;
      
    case 'downloaded':
      statusTextEl.textContent = 'Update ready to install';
      checkBtn.disabled = false;
      checkText.textContent = 'Check for Updates';
      installBtn.classList.remove('hidden');
      installText.textContent = 'Install & Restart';
      progressEl.classList.add('hidden');
      break;
      
    case 'up-to-date':
      statusTextEl.textContent = 'You are up to date';
      checkBtn.disabled = false;
      checkText.textContent = 'Check for Updates';
      installBtn.classList.add('hidden');
      progressEl.classList.add('hidden');
      break;
      
    case 'error':
      statusTextEl.textContent = `Update error: ${updateState.error || 'Unknown error'}`;
      checkBtn.disabled = false;
      checkText.textContent = 'Check for Updates';
      installBtn.classList.add('hidden');
      progressEl.classList.add('hidden');
      break;
      
    default:
      statusTextEl.textContent = 'Ready to check for updates';
      checkBtn.disabled = false;
      checkText.textContent = 'Check for Updates';
      installBtn.classList.add('hidden');
      progressEl.classList.add('hidden');
  }
}

// Initialize update UI
async function initUpdateUI() {
  try {
    const version = await ipcRenderer.invoke('get-app-version');
    updateState.version = version;
    
    const versionEl = document.getElementById('current-version');
    if (versionEl) {
      versionEl.textContent = `v${version}`;
    }
    
    updateUpdateUI();
  } catch (error) {
    console.error('Failed to get app version:', error);
  }
}

// Manual update check
async function checkForUpdates() {
  try {
    updateState.status = 'checking';
    updateUpdateUI();
    
    const result = await ipcRenderer.invoke('check-for-updates');
    
    if (result.status === 'dev') {
      updateState.status = 'up-to-date';
      updateState.error = 'Development mode - updates not available';
    } else if (result.status === 'error') {
      updateState.status = 'error';
      updateState.error = result.error;
    }
    
    updateUpdateUI();
  } catch (error) {
    updateState.status = 'error';
    updateState.error = error.message;
    updateUpdateUI();
  }
}

// Install update
async function installUpdate() {
  try {
    await ipcRenderer.invoke('quit-and-install');
  } catch (error) {
    updateState.status = 'error';
    updateState.error = error.message;
    updateUpdateUI();
  }
}

ipcRenderer.on('auto-update', (_e, payload) => {
  const st = payload?.status;
  
  // Update internal state
  switch (st) {
    case 'checking':
      updateState.status = 'checking';
      break;
    case 'available':
      updateState.status = 'available';
      updateState.availableVersion = payload.info?.version;
      break;
    case 'none':
      updateState.status = 'up-to-date';
      break;
    case 'downloading':
      updateState.status = 'downloading';
      updateState.progress = payload.progress?.percent || 0;
      break;
    case 'downloaded':
      updateState.status = 'downloaded';
      break;
    case 'error':
      updateState.status = 'error';
      updateState.error = payload.error;
      break;
  }
  
  // Update UI
  updateUpdateUI();
  
  // Show toast notifications
  if (st === 'checking') showToast('Checking for updates...', 'success', 1200);
  else if (st === 'available') showToast('Update available. Downloading...', 'success', 2500);
  else if (st === 'none') showToast('You are up to date.', 'success', 2000);
  else if (st === 'downloaded') showToast('Update ready. Click "Install & Restart" to update.', 'success', 4000);
  else if (st === 'error') showToast('Update error. See logs for details.', 'error', 3000);
});

ipcRenderer.on('open-settings', () => {
  openSettings();
});

window.addEventListener('DOMContentLoaded', init);

function setupEntitySearchInput(inputId, allowedDomains = null) {
  const input = document.getElementById(inputId);
  if (!input) return;
  let box = input.parentElement.querySelector('.entity-suggestions');
  if (!box) {
    box = document.createElement('div');
    box.className = 'entity-suggestions';
    input.parentElement.appendChild(box);
  }
  const closeBox = () => { box.classList.remove('open'); box.innerHTML = ''; };
  const parseList = () => input.value.split(',').map(s => s.trim()).filter(Boolean);
  const setList = (list) => { input.value = Array.from(new Set(list)).join(', '); };

  const build = (q) => {
    const query = (q || '').toLowerCase();
    const items = Object.keys(STATES).filter(id => {
      if (allowedDomains && allowedDomains.length) {
        const dom = id.split('.')[0];
        if (!allowedDomains.includes(dom)) return false;
      }
      if (!query) return true;
      const e = STATES[id];
      const name = (e?.attributes?.friendly_name || '').toLowerCase();
      return id.toLowerCase().includes(query) || name.includes(query);
    }).slice(0, 50);

    box.innerHTML = '';
    items.forEach(id => {
      const e = STATES[id];
      const item = document.createElement('div');
      item.className = 'entity-suggestion-item';
      const name = document.createElement('span');
      name.className = 'entity-suggestion-name';
      name.textContent = e?.attributes?.friendly_name || id;
      const sid = document.createElement('span');
      sid.className = 'entity-suggestion-id';
      sid.textContent = id;
      item.appendChild(name);
      item.appendChild(sid);
      item.onclick = () => {
        const list = parseList();
        if (!list.includes(id)) list.push(id);
        setList(list);
        closeBox();
      };
      box.appendChild(item);
    });
    box.classList.toggle('open', items.length > 0);
  };

  input.addEventListener('input', () => {
    const raw = input.value;
    const last = raw.split(',').pop().trim();
    build(last);
  });
  input.addEventListener('focus', () => { build(''); });
  input.addEventListener('blur', () => setTimeout(closeBox, 150));
}

function formatDuration(ms) {
  if (ms < 0) ms = 0;
  const s = Math.floor(ms / 1000);
  const hh = Math.floor(s / 3600);
  const mm = Math.floor((s % 3600) / 60);
  const ss = s % 60;
  if (hh > 0) return `${hh}:${String(mm).padStart(2,'0')}:${String(ss).padStart(2,'0')}`;
  return `${mm}:${String(ss).padStart(2,'0')}`;
}

function getTimerDisplay(entity) {
  if (entity.state === 'active') {
    const end = getTimerEnd(entity);
    if (end) {
      const remaining = end - Date.now();
      if (remaining > 0) {
        return formatDuration(remaining);
      } else {
        return '0:00';
      }
    } else {
      return 'running';
    }
  } else if (entity.state === 'paused') {
    const remaining = entity.attributes?.remaining;
    if (remaining) {
      return remaining;
    } else {
      return 'paused';
    }
  } else if (entity.state === 'idle') {
    const duration = entity.attributes?.duration;
    if (duration) {
      return duration;
    } else {
      return 'idle';
    }
  } else {
    return entity.state || 'unknown';
  }
}

function startTimerSensorUpdates() {
  if (!TIMER_SENSOR_TICK) {
    TIMER_SENSOR_TICK = setInterval(() => {
      const now = Date.now();
      for (const [entityId, timerData] of Array.from(TIMER_SENSOR_MAP.entries())) {
        const { element, endTime } = timerData;
        const remaining = endTime - now;
        if (remaining <= 0) {
          element.textContent = '0:00';
          TIMER_SENSOR_MAP.delete(entityId);
        } else {
          element.textContent = formatDuration(remaining);
        }
      }
      if (TIMER_SENSOR_MAP.size === 0) {
        clearInterval(TIMER_SENSOR_TICK);
        TIMER_SENSOR_TICK = null;
      }
    }, 1000);
  }
}

function startTimerSensorSync() {
  if (!TIMER_SENSOR_SYNC_TICK) {
    TIMER_SENSOR_SYNC_TICK = setInterval(() => {
      // Sync with Home Assistant every 15 seconds
      for (const [entityId, timerData] of Array.from(TIMER_SENSOR_MAP.entries())) {
        const entity = STATES[entityId];
        if (entity) {
          // Update the timer with fresh data from Home Assistant
          const newValue = formatTimerSensorValue(entity, timerData.element);
          timerData.lastSync = Date.now();
        }
      }
    }, 15000); // 15 seconds
  }
}

function getTimerEnd(entity) {
  const fin = entity.attributes?.finishes_at;
  if (fin) {
    const t = new Date(fin).getTime();
    if (!isNaN(t)) return t;
  }
  const rem = entity.attributes?.remaining;
  if (rem) {
    const parts = rem.split(':').map(n => parseInt(n, 10));
    if (parts.length === 3 && parts.every(x => !isNaN(x))) {
      const ms = ((parts[0]*3600)+(parts[1]*60)+parts[2]) * 1000;
      return Date.now() + ms;
    }
  }
  return null;
}

function updateTimerCountdown(entity, el) {
  if (!el) return;
  if (entity.state !== 'active') {
    el.textContent = entity.state || '';
    TIMER_MAP.delete(entity.entity_id);
    if (TIMER_MAP.size === 0 && TIMER_TICK) { clearInterval(TIMER_TICK); TIMER_TICK = null; }
    return;
  }
  const end = getTimerEnd(entity);
  if (!end) { el.textContent = 'running'; return; }
  TIMER_MAP.set(entity.entity_id, { el, end });
  el.textContent = formatDuration(end - Date.now());
  if (!TIMER_TICK) {
    TIMER_TICK = setInterval(() => {
      const now = Date.now();
      for (const [id, rec] of Array.from(TIMER_MAP.entries())) {
        const left = rec.end - now;
        if (left <= 0) {
          rec.el.textContent = '0:00';
          TIMER_MAP.delete(id);
        } else {
          rec.el.textContent = formatDuration(left);
        }
      }
      if (TIMER_MAP.size === 0) { clearInterval(TIMER_TICK); TIMER_TICK = null; }
    }, 1000);
  }
}

function handleMotionEvent(newState, _oldState) {
  try {
    const mp = CONFIG?.motionPopup || {};
    if (!mp.enabled) return;
    if (!newState || newState.entity_id?.startsWith('binary_sensor.') !== true) return;
    if (newState.state !== 'on') return;
    const dc = (newState.attributes?.device_class || '').toLowerCase();
    if (dc !== 'motion' && dc !== 'occupancy' && dc !== 'moving') return;
    const selectedCams = (mp.cameras || []).filter(id => id.startsWith('camera.'));
    if (selectedCams.length === 0) return;

    const motionId = newState.entity_id;
    const motionName = (newState.attributes?.friendly_name || '').toLowerCase();

    let matchCam = null;
    for (const camId of selectedCams) {
      const slug = camId.split('.')[1];
      const camName = (STATES?.[camId]?.attributes?.friendly_name || camId).toLowerCase();
      if (motionId.includes(slug) || motionName.includes(slug) || motionName.includes(camName) || camName.includes(motionName)) {
        matchCam = camId;
        break;
      }
    }
    if (!matchCam) {
      return;
    }

    const cooldownMs = Math.max(0, (mp.cooldownSeconds || 30) * 1000);
    const last = MOTION_LAST_TRIGGER.get(matchCam) || 0;
    const now = Date.now();
    if (now - last < cooldownMs) return;
    MOTION_LAST_TRIGGER.set(matchCam, now);

    showMotionPopup(matchCam);
  } catch (e) {
    console.warn('handleMotionEvent error:', e?.message || e);
  }
}

async function showMotionPopup(cameraId) {
  try {
    const mp = CONFIG?.motionPopup || {};
    if (!MOTION_POPUP) {
      MOTION_POPUP = document.createElement('div');
      MOTION_POPUP.id = 'motion-popup';
      MOTION_POPUP.className = 'motion-popup';
      MOTION_POPUP.innerHTML = `
        <div class="motion-popup-header">
          <span class="motion-popup-title"></span>
          <button class="motion-popup-close" title="Close">✕</button>
        </div>
        <div class="motion-popup-body"></div>
      `;
      document.body.appendChild(MOTION_POPUP);
      MOTION_POPUP.querySelector('.motion-popup-close').onclick = () => hideMotionPopup();
      MOTION_POPUP.addEventListener('mouseenter', () => { if (MOTION_POPUP_TIMER) { clearTimeout(MOTION_POPUP_TIMER); MOTION_POPUP_TIMER = null; } });
      MOTION_POPUP.addEventListener('mouseleave', () => {
        const ms = Math.max(3000, (mp.autoHideSeconds || 12) * 1000);
        if (MOTION_POPUP_TIMER) clearTimeout(MOTION_POPUP_TIMER);
        MOTION_POPUP_TIMER = setTimeout(() => hideMotionPopup(), ms);
      });
    }

    const title = MOTION_POPUP.querySelector('.motion-popup-title');
    const body = MOTION_POPUP.querySelector('.motion-popup-body');

    if (MOTION_POPUP_CAMERA && MOTION_POPUP_CAMERA !== cameraId) {
      stopHlsStream(MOTION_POPUP_CAMERA, body);
      try { body.innerHTML = ''; } catch (_error) {
        // Ignore errors when clearing motion popup body
      }
    }

    MOTION_POPUP_CAMERA = cameraId;
    title.textContent = (STATES?.[cameraId]?.attributes?.friendly_name || cameraId) + ' — Motion detected';

    let img = body.querySelector('img.camera-img');
    if (!img) {
      img = document.createElement('img');
      img.className = 'camera-img';
      body.appendChild(img);
    }

    const hlsStarted = await startHlsStream(cameraId, body, img);
    if (!hlsStarted) {
      img.src = `ha://camera_stream/${cameraId}?t=${Date.now()}`;
      img.style.display = 'block';
    }

    MOTION_POPUP.style.display = 'block';

    if (MOTION_POPUP_TIMER) { clearTimeout(MOTION_POPUP_TIMER); MOTION_POPUP_TIMER = null; }
    const ms = Math.max(3000, (mp.autoHideSeconds || 12) * 1000);
    MOTION_POPUP_TIMER = setTimeout(() => hideMotionPopup(), ms);
  } catch (e) {
    console.warn('showMotionPopup error:', e?.message || e);
  }
}

function hideMotionPopup(silent = false) {
  try {
    if (!MOTION_POPUP) return;
    if (MOTION_POPUP_TIMER) { clearTimeout(MOTION_POPUP_TIMER); MOTION_POPUP_TIMER = null; }
    const body = MOTION_POPUP.querySelector('.motion-popup-body');
    if (MOTION_POPUP_CAMERA) {
      stopHlsStream(MOTION_POPUP_CAMERA, body);
      const img = body.querySelector('img.camera-img');
      if (img) { img.src = ''; }
    }
    MOTION_POPUP.style.display = 'none';
    if (!silent) {
      MOTION_POPUP_CAMERA = null;
    }
  } catch (e) {
    console.warn('hideMotionPopup error:', e?.message || e);
  }
}

// Global Hotkey Management
let globalHotkeys = {};
let entityAlerts = {};

// Initialize hotkeys and alerts from config
function initializeHotkeysAndAlerts() {
  if (CONFIG.globalHotkeys) {
    globalHotkeys = CONFIG.globalHotkeys;
  }
  if (CONFIG.entityAlerts) {
    entityAlerts = CONFIG.entityAlerts;
  }
}

// Handle hotkey triggers from main process
ipcRenderer.on('hotkey-triggered', (event, { entityId, hotkey }) => {
  console.log(`Hotkey triggered: ${hotkey} for entity: ${entityId}`);
  
  const entity = STATES[entityId];
  if (entity) {
    // Show visual feedback
    showToast(`Hotkey: ${hotkey}`, 'info', 1000);
    
    // Toggle the entity
    toggleEntity(entity);
  } else {
    showToast(`Entity not found: ${entityId}`, 'error', 2000);
  }
});

// Hotkey management functions
async function registerHotkey(entityId, hotkey) {
  try {
    const result = await ipcRenderer.invoke('register-hotkey', entityId, hotkey);
    if (result.success) {
      showToast(`Hotkey registered: ${hotkey}`, 'success', 2000);
      return true;
    } else {
      showToast(`Failed to register hotkey: ${result.error}`, 'error', 3000);
      return false;
    }
  } catch (error) {
    console.error('Error registering hotkey:', error);
    showToast('Error registering hotkey', 'error', 2000);
    return false;
  }
}

async function unregisterHotkey(entityId) {
  try {
    const result = await ipcRenderer.invoke('unregister-hotkey', entityId);
    if (result.success) {
      showToast('Hotkey removed', 'success', 1500);
      return true;
    }
  } catch (error) {
    console.error('Error unregistering hotkey:', error);
    showToast('Error removing hotkey', 'error', 2000);
  }
  return false;
}

async function toggleHotkeys(enabled) {
  try {
    const result = await ipcRenderer.invoke('toggle-hotkeys', enabled);
    if (result.success) {
      globalHotkeys.enabled = enabled;
      showToast(`Global hotkeys ${enabled ? 'enabled' : 'disabled'}`, 'success', 2000);
      return true;
    }
  } catch (error) {
    console.error('Error toggling hotkeys:', error);
    showToast('Error toggling hotkeys', 'error', 2000);
  }
  return false;
}

async function validateHotkey(hotkey) {
  try {
    const result = await ipcRenderer.invoke('validate-hotkey', hotkey);
    return result.valid;
  } catch (error) {
    console.error('Error validating hotkey:', error);
    return false;
  }
}

// Entity Alert Management
let alertStates = {}; // Track previous states for comparison

function initializeEntityAlerts() {
  if (!entityAlerts.enabled) return;
  
  // Initialize alert states
  Object.keys(entityAlerts.alerts).forEach(entityId => {
    if (STATES[entityId]) {
      alertStates[entityId] = STATES[entityId].state;
    }
  });
}

function checkEntityAlerts(entityId, newState) {
  if (!entityAlerts.enabled || !entityAlerts.alerts[entityId]) return;
  
  const alertConfig = entityAlerts.alerts[entityId];
  const previousState = alertStates[entityId];
  
  // Update stored state
  alertStates[entityId] = newState;
  
  // Check if we should trigger an alert
  let shouldAlert = false;
  let alertMessage = '';
  
  if (alertConfig.onStateChange && previousState !== newState) {
    shouldAlert = true;
    alertMessage = `${getEntityDisplayName(STATES[entityId])} changed from ${previousState} to ${newState}`;
  } else if (alertConfig.onSpecificState && alertConfig.targetState === newState) {
    shouldAlert = true;
    alertMessage = `${getEntityDisplayName(STATES[entityId])} is now ${newState}`;
  }
  
  if (shouldAlert) {
    showEntityAlert(alertMessage, entityId, newState);
  }
}

function showEntityAlert(message, entityId, state) {
  // Show desktop notification
  if (Notification.permission === 'granted') {
    new Notification('Home Assistant Alert', {
      body: message,
      icon: getEntityIcon(STATES[entityId]),
      tag: `ha-alert-${entityId}`,
      requireInteraction: false
    });
  }
  
  // Show toast notification
  showToast(message, 'info', 4000);
}

// Alert management functions
async function setEntityAlert(entityId, alertConfig) {
  try {
    const result = await ipcRenderer.invoke('set-entity-alert', entityId, alertConfig);
    if (result.success) {
      entityAlerts.alerts[entityId] = alertConfig;
      showToast('Alert configured', 'success', 2000);
      return true;
    }
  } catch (error) {
    console.error('Error setting entity alert:', error);
    showToast('Error configuring alert', 'error', 2000);
  }
  return false;
}

async function removeEntityAlert(entityId) {
  try {
    const result = await ipcRenderer.invoke('remove-entity-alert', entityId);
    if (result.success) {
      delete entityAlerts.alerts[entityId];
      delete alertStates[entityId];
      showToast('Alert removed', 'success', 1500);
      return true;
    }
  } catch (error) {
    console.error('Error removing entity alert:', error);
    showToast('Error removing alert', 'error', 2000);
  }
  return false;
}

async function toggleAlerts(enabled) {
  try {
    const result = await ipcRenderer.invoke('toggle-alerts', enabled);
    if (result.success) {
      entityAlerts.enabled = enabled;
      showToast(`Entity alerts ${enabled ? 'enabled' : 'disabled'}`, 'success', 2000);
      return true;
    }
  } catch (error) {
    console.error('Error toggling alerts:', error);
    showToast('Error toggling alerts', 'error', 2000);
  }
  return false;
}

// Request notification permission
function requestNotificationPermission() {
  if (Notification.permission === 'default') {
    Notification.requestPermission().then(permission => {
      if (permission === 'granted') {
        showToast('Notifications enabled', 'success', 2000);
      } else {
        showToast('Notifications disabled', 'warning', 2000);
      }
    });
  }
}

// UI Management Functions
function openHotkeysModal() {
  const modal = document.getElementById('hotkeys-modal');
  if (modal) {
    modal.classList.remove('hidden');
    loadHotkeysList();
    setupFocusTrap(modal);
  }
}

function closeHotkeysModal() {
  const modal = document.getElementById('hotkeys-modal');
  if (modal) {
    modal.classList.add('hidden');
    releaseFocusTrap(modal);
  }
}

function openAlertsModal() {
  const modal = document.getElementById('alerts-modal');
  if (modal) {
    modal.classList.remove('hidden');
    loadAlertsList();
    setupFocusTrap(modal);
  }
}

function closeAlertsModal() {
  const modal = document.getElementById('alerts-modal');
  if (modal) {
    modal.classList.add('hidden');
    releaseFocusTrap(modal);
  }
}

function loadHotkeysList() {
  const container = document.getElementById('hotkeys-list');
  if (!container || !STATES || Object.keys(STATES).length === 0) {
    container.innerHTML = '<div class="no-hotkeys">No entities loaded from Home Assistant. Make sure you\'re connected.</div>';
    return;
  }

  // Get entities that can be controlled
  const controllableEntities = Object.values(STATES)
    .filter(entity => {
      const domain = entity.entity_id.split('.')[0];
      return ['light', 'switch', 'fan', 'lock', 'cover', 'scene', 'automation', 'script', 'input_boolean'].includes(domain);
    })
    .sort((a, b) => {
      const domainA = a.entity_id.split('.')[0];
      const domainB = b.entity_id.split('.')[0];
      if (domainA !== domainB) {
        return domainA.localeCompare(domainB);
      }
      return getEntityDisplayName(a).localeCompare(getEntityDisplayName(b));
    });

  container.innerHTML = controllableEntities.map(entity => {
    const icon = getEntityIcon(entity);
    const name = getEntityDisplayName(entity);
    const type = getEntityTypeDescription(entity);
    const currentHotkey = globalHotkeys.hotkeys?.[entity.entity_id] || '';
    
    return `
      <div class="hotkey-item" data-entity-id="${entity.entity_id}">
        <div class="hotkey-info">
          <span class="hotkey-icon">${icon}</span>
          <div class="hotkey-details">
            <div class="hotkey-name">${name}</div>
            <div class="hotkey-meta">
              <span class="hotkey-type">${type}</span>
              <span class="hotkey-combination">${currentHotkey || 'No hotkey'}</span>
            </div>
          </div>
        </div>
        <div class="hotkey-actions">
          ${currentHotkey 
            ? `<button class="hotkey-btn danger" onclick="removeHotkey('${entity.entity_id}')">Remove</button>`
            : `<button class="hotkey-btn primary" onclick="addHotkey('${entity.entity_id}')">Add</button>`
          }
        </div>
      </div>
    `;
  }).join('');

  // Add search functionality (only if not already added)
  const searchInput = document.getElementById('hotkey-search');
  if (searchInput && !searchInput.hasAttribute('data-search-initialized')) {
    searchInput.setAttribute('data-search-initialized', 'true');
    searchInput.oninput = (e) => {
      const searchTerm = e.target.value.toLowerCase().trim();
      
      if (!searchTerm) {
        // Show all items if search is empty
        const items = container.querySelectorAll('.hotkey-item');
        const existingItems = document.querySelectorAll('.existing-hotkey-item');
        items.forEach(item => item.style.display = 'flex');
        existingItems.forEach(item => item.style.display = 'flex');
        return;
      }
      
      // Search in both lists
      const items = Array.from(container.querySelectorAll('.hotkey-item'));
      const existingItems = Array.from(document.querySelectorAll('.existing-hotkey-item'));
      
      // Search in main hotkeys list
      const scoredItems = items.map(item => {
        const name = item.querySelector('.hotkey-name').textContent;
        const type = item.querySelector('.hotkey-type').textContent;
        const combination = item.querySelector('.hotkey-combination').textContent;
        const entityId = item.dataset.entityId || '';
        
        const nameScore = getSearchScore(name, searchTerm);
        const typeScore = getSearchScore(type, searchTerm);
        const combinationScore = getSearchScore(combination, searchTerm);
        const entityIdScore = getSearchScore(entityId, searchTerm);
        const maxScore = Math.max(nameScore, typeScore, combinationScore, entityIdScore);
        
        return { item, score: maxScore };
      }).filter(({ score }) => score > 0);
      
      // Search in existing hotkeys list
      const scoredExistingItems = existingItems.map(item => {
        const name = item.querySelector('.existing-hotkey-name').textContent;
        const type = item.querySelector('.existing-hotkey-type').textContent;
        const combination = item.querySelector('.existing-hotkey-combination').textContent;
        const entityId = item.dataset.entityId || '';
        
        const nameScore = getSearchScore(name, searchTerm);
        const typeScore = getSearchScore(type, searchTerm);
        const combinationScore = getSearchScore(combination, searchTerm);
        const entityIdScore = getSearchScore(entityId, searchTerm);
        const maxScore = Math.max(nameScore, typeScore, combinationScore, entityIdScore);
        
        return { item, score: maxScore };
      }).filter(({ score }) => score > 0);
      
      // Sort by score (highest first)
      scoredItems.sort((a, b) => b.score - a.score);
      scoredExistingItems.sort((a, b) => b.score - a.score);
      
      // Hide all items first
      items.forEach(item => item.style.display = 'none');
      existingItems.forEach(item => item.style.display = 'none');
      
      // Show and reorder matched items
      scoredItems.forEach(({ item }) => {
        item.style.display = 'flex';
        container.appendChild(item);
      });
      
      scoredExistingItems.forEach(({ item }) => {
        item.style.display = 'flex';
        document.getElementById('existing-hotkeys-list').appendChild(item);
      });
    };
  }

  // Load existing hotkeys
  loadExistingHotkeysList();
}

function loadExistingHotkeysList() {
  const container = document.getElementById('existing-hotkeys-list');
  if (!container || !CONFIG.globalHotkeys.hotkeys || Object.keys(CONFIG.globalHotkeys.hotkeys).length === 0) {
    container.innerHTML = '<div class="no-existing-hotkeys">No hotkeys configured</div>';
    return;
  }

  const existingHotkeys = Object.entries(CONFIG.globalHotkeys.hotkeys).map(([entityId, hotkey]) => {
    const entity = STATES[entityId];
    if (!entity || !hotkey) return null; // Skip if entity no longer exists or no hotkey

    const name = getEntityDisplayName(entity);
    const type = getEntityTypeDescription(entity);

    return `
      <div class="existing-hotkey-item" data-entity-id="${entityId}">
        <div class="existing-hotkey-info">
          <div class="existing-hotkey-name">${name}</div>
          <div class="existing-hotkey-details">
            <span class="existing-hotkey-type">${type}</span>
            <span class="existing-hotkey-combination">${hotkey}</span>
          </div>
        </div>
        <div class="existing-hotkey-actions">
          <button class="existing-hotkey-btn edit" onclick="editHotkey('${entityId}')">Edit</button>
          <button class="existing-hotkey-btn remove" onclick="removeHotkey('${entityId}')">Remove</button>
        </div>
      </div>
    `;
  }).filter(Boolean).join('');

  if (existingHotkeys) {
    container.innerHTML = existingHotkeys;
  } else {
    container.innerHTML = '<div class="no-existing-hotkeys">No hotkeys configured</div>';
  }
}

function loadAlertsList() {
  const container = document.getElementById('alerts-list');
  if (!container || !STATES || Object.keys(STATES).length === 0) {
    container.innerHTML = '<div class="no-alerts">No entities loaded from Home Assistant. Make sure you\'re connected.</div>';
    return;
  }

  // Get all entities
  const allEntities = Object.values(STATES)
    .sort((a, b) => {
      const domainA = a.entity_id.split('.')[0];
      const domainB = b.entity_id.split('.')[0];
      if (domainA !== domainB) {
        return domainA.localeCompare(domainB);
      }
      return getEntityDisplayName(a).localeCompare(getEntityDisplayName(b));
    });

  container.innerHTML = allEntities.map(entity => {
    const icon = getEntityIcon(entity);
    const name = getEntityDisplayName(entity);
    const type = getEntityTypeDescription(entity);
    const currentAlert = entityAlerts.alerts?.[entity.entity_id];
    const hasAlert = currentAlert && (currentAlert.onStateChange || currentAlert.onSpecificState);
    
    return `
      <div class="alert-item" data-entity-id="${entity.entity_id}">
        <div class="alert-info">
          <span class="alert-icon">${icon}</span>
          <div class="alert-details">
            <div class="alert-name">${name}</div>
            <div class="alert-meta">
              <span class="alert-type">${type}</span>
              <span class="alert-config">${hasAlert ? 'Alert configured' : 'No alert'}</span>
            </div>
          </div>
        </div>
        <div class="alert-actions">
          ${hasAlert 
            ? `<button class="alert-btn danger" onclick="removeAlert('${entity.entity_id}')">Remove</button>`
            : `<button class="alert-btn primary" onclick="addAlert('${entity.entity_id}')">Add</button>`
          }
        </div>
      </div>
    `;
  }).join('');

  // Add search functionality (only if not already added)
  const searchInput = document.getElementById('alert-search');
  if (searchInput && !searchInput.hasAttribute('data-search-initialized')) {
    searchInput.setAttribute('data-search-initialized', 'true');
    searchInput.oninput = (e) => {
      const searchTerm = e.target.value.toLowerCase().trim();
      
      if (!searchTerm) {
        // Show all items if search is empty
        const items = container.querySelectorAll('.alert-item');
        const existingItems = document.querySelectorAll('.existing-alert-item');
        items.forEach(item => item.style.display = 'flex');
        existingItems.forEach(item => item.style.display = 'flex');
        return;
      }
      
      // Search in both lists
      const items = Array.from(container.querySelectorAll('.alert-item'));
      const existingItems = Array.from(document.querySelectorAll('.existing-alert-item'));
      
      // Search in main alerts list
      const scoredItems = items.map(item => {
        const name = item.querySelector('.alert-name').textContent;
        const type = item.querySelector('.alert-type').textContent;
        const config = item.querySelector('.alert-config').textContent;
        const entityId = item.dataset.entityId || '';
        
        const nameScore = getSearchScore(name, searchTerm);
        const typeScore = getSearchScore(type, searchTerm);
        const configScore = getSearchScore(config, searchTerm);
        const entityIdScore = getSearchScore(entityId, searchTerm);
        const maxScore = Math.max(nameScore, typeScore, configScore, entityIdScore);
        
        return { item, score: maxScore };
      }).filter(({ score }) => score > 0);
      
      // Search in existing alerts list
      const scoredExistingItems = existingItems.map(item => {
        const name = item.querySelector('.existing-alert-name').textContent;
        const type = item.querySelector('.existing-alert-type').textContent;
        const config = item.querySelector('.existing-alert-config').textContent;
        const entityId = item.dataset.entityId || '';
        
        const nameScore = getSearchScore(name, searchTerm);
        const typeScore = getSearchScore(type, searchTerm);
        const configScore = getSearchScore(config, searchTerm);
        const entityIdScore = getSearchScore(entityId, searchTerm);
        const maxScore = Math.max(nameScore, typeScore, configScore, entityIdScore);
        
        return { item, score: maxScore };
      }).filter(({ score }) => score > 0);
      
      // Sort by score (highest first)
      scoredItems.sort((a, b) => b.score - a.score);
      scoredExistingItems.sort((a, b) => b.score - a.score);
      
      // Hide all items first
      items.forEach(item => item.style.display = 'none');
      existingItems.forEach(item => item.style.display = 'none');
      
      // Show and reorder matched items
      scoredItems.forEach(({ item }) => {
        item.style.display = 'flex';
        container.appendChild(item);
      });
      
      scoredExistingItems.forEach(({ item }) => {
        item.style.display = 'flex';
        document.getElementById('existing-alerts-list').appendChild(item);
      });
    };
  }

  // Load existing alerts
  loadExistingAlertsList();
}

function loadExistingAlertsList() {
  const container = document.getElementById('existing-alerts-list');
  if (!container || !CONFIG.entityAlerts.alerts || Object.keys(CONFIG.entityAlerts.alerts).length === 0) {
    container.innerHTML = '<div class="no-existing-alerts">No alerts configured</div>';
    return;
  }

  const existingAlerts = Object.entries(CONFIG.entityAlerts.alerts).map(([entityId, alertConfig]) => {
    const entity = STATES[entityId];
    if (!entity) return null; // Skip if entity no longer exists

    const name = getEntityDisplayName(entity);
    const type = getEntityTypeDescription(entity);
    const icon = getEntityIcon(entity);

    // Determine alert type and configuration text
    let alertTypeText, alertConfigText;
    if (alertConfig.onStateChange) {
      alertTypeText = 'State Change';
      alertConfigText = 'Any state change';
    } else if (alertConfig.onSpecificState) {
      alertTypeText = 'Specific State';
      alertConfigText = `When state = "${alertConfig.targetState}"`;
    } else {
      alertTypeText = 'Unknown';
      alertConfigText = 'Unknown configuration';
    }

    return `
      <div class="existing-alert-item" data-entity-id="${entityId}">
        <div class="existing-alert-info">
          <div class="existing-alert-name">${name}</div>
          <div class="existing-alert-details">
            <span class="existing-alert-type">${alertTypeText}</span>
            <span class="existing-alert-config">${alertConfigText}</span>
          </div>
        </div>
        <div class="existing-alert-actions">
          <button class="existing-alert-btn edit" onclick="editAlert('${entityId}')">Edit</button>
          <button class="existing-alert-btn remove" onclick="removeAlert('${entityId}')">Remove</button>
        </div>
      </div>
    `;
  }).filter(Boolean).join('');

  if (existingAlerts) {
    container.innerHTML = existingAlerts;
  } else {
    container.innerHTML = '<div class="no-existing-alerts">No alerts configured</div>';
  }
}

// Hotkey management UI functions
let currentHotkeyEntityId = null;

async function addHotkey(entityId) {
  currentHotkeyEntityId = entityId;
  openHotkeyConfigModal();
}

async function removeHotkey(entityId) {
  const success = await unregisterHotkey(entityId);
  if (success) {
    loadHotkeysList(); // Refresh the list
  }
}

async function editHotkey(entityId) {
  currentHotkeyEntityId = entityId;
  const currentHotkey = CONFIG.globalHotkeys.hotkeys[entityId];
  
  if (!currentHotkey) {
    showToast('Hotkey configuration not found', 'error', 2000);
    return;
  }
  
  openHotkeyConfigModal();
  
  // Pre-populate the form with existing hotkey and set up key capture
  const button = document.getElementById('hotkey-input');
  if (button) {
    button.textContent = currentHotkey;
    setupHotkeyCapture(button);
  }
}

function openHotkeyConfigModal() {
  const modal = document.getElementById('hotkey-config-modal');
  if (modal) {
    modal.classList.remove('hidden');
    setupFocusTrap(modal);
    
    // Clear the button and set up key capture
    const button = document.getElementById('hotkey-input');
    if (button) {
      button.textContent = 'Click to set hotkey';
      setupHotkeyCapture(button);
      button.focus();
    }
  }
}

function setupHotkeyCapture(button) {
  let isCapturing = false;
  let currentCombination = '';

  // Teardown any prior handlers
  if (button._hotkeyHandlers) {
    const h = button._hotkeyHandlers;
    document.removeEventListener('keydown', h.docKeyDown, true);
    button.removeEventListener('click', h.click);
    button._hotkeyHandlers = undefined;
  }

  function startCapture() {
    isCapturing = true;
    currentCombination = '';
    button.textContent = 'Press any key combination...';
    button.classList.add('is-capturing');
  }

  function stopCapture() {
    isCapturing = false;
    button.classList.remove('is-capturing');
    if (!currentCombination) {
      button.textContent = 'Click to set hotkey';
    }
  }

  function docKeyDown(e) {
    if (!isCapturing) return;

    e.preventDefault();
    e.stopPropagation();

    // Handle special keys
    if (e.key === 'Escape') {
      button.textContent = 'Click to set hotkey';
      stopCapture();
      return;
    }

    // Build the combination from the current event
    const parts = [];
    if (e.ctrlKey) parts.push('Ctrl');
    if (e.altKey) parts.push('Alt');
    if (e.shiftKey) parts.push('Shift');
    if (e.metaKey) parts.push('Win');

    // Add the main key (normalize it)
    let mainKey = e.key;
    if (mainKey === ' ') mainKey = 'Space';
    else if (mainKey === 'Escape') mainKey = 'Esc';
    else if (mainKey.startsWith('Arrow')) mainKey = mainKey.replace('Arrow', '');
    else if (mainKey.length === 1) mainKey = mainKey.toUpperCase();
    else if (mainKey === 'Meta') return; // Skip meta key itself
    else if (mainKey === 'Control') return; // Skip control key itself
    else if (mainKey === 'Alt') return; // Skip alt key itself
    else if (mainKey === 'Shift') return; // Skip shift key itself

    if (mainKey && !parts.includes(mainKey)) {
      parts.push(mainKey);
    }

    currentCombination = parts.join('+');
    button.textContent = currentCombination;

    // Stop capture after a short delay to allow for key combinations
    setTimeout(() => {
      if (isCapturing && currentCombination) {
        stopCapture();
      }
    }, 100);
  }

  function onClick() {
    if (isCapturing) {
      stopCapture();
    } else {
      startCapture();
    }
  }

  document.addEventListener('keydown', docKeyDown, true);
  button.addEventListener('click', onClick);

  button._hotkeyHandlers = { docKeyDown, click: onClick };
}

function closeHotkeyConfigModal() {
  const modal = document.getElementById('hotkey-config-modal');
  if (modal) {
    // Teardown capture listeners if present
    const button = document.getElementById('hotkey-input');
    if (button && button._hotkeyHandlers) {
      const h = button._hotkeyHandlers;
      document.removeEventListener('keydown', h.docKeyDown, true);
      button.removeEventListener('click', h.click);
      button._hotkeyHandlers = undefined;
      
      // Also reset button state
      button.classList.remove('is-capturing');
      button.textContent = 'Click to set hotkey';
    }

    modal.classList.add('hidden');
    releaseFocusTrap(modal);
    currentHotkeyEntityId = null;
  }
}

async function saveHotkey() {
  const button = document.getElementById('hotkey-input');
  if (!button || !currentHotkeyEntityId) return;
  
  const hotkey = button.textContent.trim();
  if (!hotkey || hotkey === 'Click to set hotkey' || hotkey === 'Recording...') {
    showToast('Please record a hotkey combination', 'error', 2000);
    return;
  }
  
  // A valid hotkey must have at least one non-modifier key.
  const keys = hotkey.split('+');
  const modifiers = ['Control', 'Alt', 'Shift', 'Meta', 'Win', 'AltGraph'];
  const hasNonModifier = keys.some(key => !modifiers.includes(key));
  if (!hasNonModifier && keys.length > 0) {
      showToast('Hotkey must include a non-modifier key (e.g., A-Z, 0-9)', 'error', 3000);
      return;
  }
  
  const success = await registerHotkey(currentHotkeyEntityId, hotkey);
  if (success) {
    closeHotkeyConfigModal();
    loadHotkeysList(); // Refresh the list
  }
}

// Alert management UI functions
let currentAlertEntityId = null;

async function addAlert(entityId) {
  currentAlertEntityId = entityId;
  openAlertConfigModal();
}

async function removeAlert(entityId) {
  const success = await removeEntityAlert(entityId);
  if (success) {
    loadAlertsList(); // Refresh the list
  }
}

async function editAlert(entityId) {
  currentAlertEntityId = entityId;
  const alertConfig = CONFIG.entityAlerts.alerts[entityId];
  
  if (!alertConfig) {
    showToast('Alert configuration not found', 'error', 2000);
    return;
  }
  
  openAlertConfigModal();
  
  // Pre-populate the form with existing configuration
  const stateChangeRadio = document.querySelector('input[name="alert-type"][value="state-change"]');
  const specificStateRadio = document.querySelector('input[name="alert-type"][value="specific-state"]');
  const specificStateGroup = document.getElementById('specific-state-group');
  const targetStateInput = document.getElementById('target-state-input');
  
  if (alertConfig.onStateChange) {
    if (stateChangeRadio) stateChangeRadio.checked = true;
    if (specificStateGroup) specificStateGroup.style.display = 'none';
  } else if (alertConfig.onSpecificState) {
    if (specificStateRadio) specificStateRadio.checked = true;
    if (specificStateGroup) specificStateGroup.style.display = 'block';
    if (targetStateInput) targetStateInput.value = alertConfig.targetState || '';
  }
}

function openAlertConfigModal() {
  const modal = document.getElementById('alert-config-modal');
  if (modal) {
    modal.classList.remove('hidden');
    setupFocusTrap(modal);
    
    // Reset form
    const stateChangeRadio = document.querySelector('input[name="alert-type"][value="state-change"]');
    const specificStateGroup = document.getElementById('specific-state-group');
    const targetStateInput = document.getElementById('target-state-input');
    
    if (stateChangeRadio) stateChangeRadio.checked = true;
    if (specificStateGroup) specificStateGroup.style.display = 'none';
    if (targetStateInput) targetStateInput.value = '';
  }
}

function closeAlertConfigModal() {
  const modal = document.getElementById('alert-config-modal');
  if (modal) {
    modal.classList.add('hidden');
    releaseFocusTrap(modal);
    currentAlertEntityId = null;
  }
}

async function saveAlert() {
  if (!currentAlertEntityId) return;
  
  const alertType = document.querySelector('input[name="alert-type"]:checked')?.value;
  const targetStateInput = document.getElementById('target-state-input');
  
  let alertConfig;
  if (alertType === 'state-change') {
    alertConfig = { onStateChange: true };
  } else if (alertType === 'specific-state') {
    const targetState = targetStateInput?.value.trim();
    if (!targetState) {
      showToast('Please enter a target state', 'error', 2000);
      return;
    }
    alertConfig = { onSpecificState: true, targetState: targetState };
  }
  
  const success = await setEntityAlert(currentAlertEntityId, alertConfig);
  if (success) {
    closeAlertConfigModal();
    loadAlertsList(); // Refresh the list
  }
}


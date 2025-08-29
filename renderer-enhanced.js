const { ipcRenderer } = require('electron');
const axios = require('axios');
const Chart = require('chart.js/auto');

let CONFIG = null;
let WS = null;
let STATES = {};
let SERVICES = {};
let AREAS = {};
let HISTORY_CHART = null;
let FILTERS = {
  domains: ['light', 'switch', 'sensor', 'climate', 'media_player', 'scene', 'automation', 'camera'],
  areas: [],
  favorites: []
};

// WebSocket connection for real-time updates
function connectWebSocket() {
  if (!CONFIG) return;
  
  const wsUrl = CONFIG.homeAssistant.url.replace('http', 'ws') + '/api/websocket';
  WS = new WebSocket(wsUrl);
  
  let authId = 1;
  
  WS.onopen = () => {
    console.log('WebSocket connected');
  };
  
  WS.onmessage = (event) => {
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
    } else if (msg.type === 'event' && msg.event.event_type === 'state_changed') {
      const entity = msg.event.data.new_state;
      if (entity) {
        STATES[entity.entity_id] = entity;
        updateEntityInUI(entity);
      }
    } else if (msg.type === 'result' && msg.result) {
      if (Array.isArray(msg.result)) {
        // Initial states
        msg.result.forEach(entity => {
          STATES[entity.entity_id] = entity;
        });
        renderAllTabs();
      } else if (msg.result.light || msg.result.switch_) {
        // Services
        SERVICES = msg.result;
        populateServiceExplorer();
      } else if (msg.result[0] && msg.result[0].area_id) {
        // Areas
        msg.result.forEach(area => {
          AREAS[area.area_id] = area;
        });
        populateAreaFilter();
      }
    }
  };
  
  WS.onerror = (error) => {
    console.error('WebSocket error:', error);
    setStatus(false);
  };
  
  WS.onclose = () => {
    console.log('WebSocket disconnected');
    setStatus(false);
    // Reconnect after 5 seconds
    setTimeout(connectWebSocket, 5000);
  };
}

function setStatus(connected) {
  const status = document.getElementById('connection-status');
  status.textContent = connected ? '● Connected' : '● Disconnected';
  status.style.color = connected ? '#81c995' : '#f28b82';
}

function setLastUpdate() {
  const el = document.getElementById('last-update');
  const now = new Date();
  el.textContent = now.toLocaleTimeString();
}

function showLoading(show) {
  const overlay = document.getElementById('loading-overlay');
  if (!overlay) return;
  overlay.classList.toggle('hidden', !show);
}

// Enhanced entity card with more controls
function createEntityCard(entity, options = {}) {
  const card = document.createElement('div');
  card.className = 'entity-card';
  card.dataset.entityId = entity.entity_id;

  const left = document.createElement('div');
  const name = document.createElement('div');
  name.className = 'entity-name';
  name.textContent = entity.attributes.friendly_name || entity.entity_id;
  
  const state = document.createElement('div');
  state.className = 'entity-state';
  
  // Format state based on entity type
  const domain = entity.entity_id.split('.')[0];
  let stateText = entity.state;
  
  if (entity.attributes.unit_of_measurement) {
    stateText += ` ${entity.attributes.unit_of_measurement}`;
  } else if (domain === 'climate') {
    stateText = `${entity.attributes.temperature || '--'}°`;
    if (entity.attributes.current_temperature) {
      stateText += ` (Current: ${entity.attributes.current_temperature}°)`;
    }
  } else if (domain === 'media_player') {
    if (entity.attributes.media_title) {
      stateText = entity.attributes.media_title;
    }
  }
  
  state.textContent = stateText;
  left.appendChild(name);
  left.appendChild(state);

  const right = document.createElement('div');
  right.className = 'controls';

  // Add controls based on entity type
  if (domain === 'light') {
    const btn = document.createElement('button');
    btn.className = 'btn btn-secondary';
    btn.textContent = entity.state === 'on' ? 'Turn off' : 'Turn on';
    btn.onclick = () => toggleEntity(entity.entity_id);
    right.appendChild(btn);
    
    if (entity.state === 'on' && entity.attributes.brightness !== undefined) {
      const slider = document.createElement('input');
      slider.type = 'range';
      slider.min = 0;
      slider.max = 255;
      slider.value = entity.attributes.brightness;
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
    if (entity.attributes.volume_level !== undefined) {
      const volumeRow = document.createElement('div');
      volumeRow.className = 'volume-row';
      
      const volumeSlider = document.createElement('input');
      volumeSlider.type = 'range';
      volumeSlider.min = 0;
      volumeSlider.max = 1;
      volumeSlider.step = 0.05;
      volumeSlider.value = entity.attributes.volume_level;
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
  if (!entity) return null;
  
  const card = document.createElement('div');
  card.className = 'camera';
  
  const header = document.createElement('div');
  header.className = 'camera-header';
  
  const name = document.createElement('span');
  name.textContent = entity.attributes.friendly_name || entityId;
  
  const refreshBtn = document.createElement('button');
  refreshBtn.className = 'btn btn-secondary';
  refreshBtn.textContent = '🔄';
  refreshBtn.onclick = () => refreshCamera(entityId);
  
  header.appendChild(name);
  header.appendChild(refreshBtn);
  
  const img = document.createElement('img');
  img.className = 'camera-img';
  img.src = `${CONFIG.homeAssistant.url}/api/camera_proxy/${entityId}?token=${CONFIG.homeAssistant.token}&t=${Date.now()}`;
  img.alt = entity.attributes.friendly_name || entityId;
  
  card.appendChild(header);
  card.appendChild(img);
  
  return card;
}

function refreshCamera(entityId) {
  const img = document.querySelector(`.camera img[alt*="${entityId}"]`);
  if (img) {
    img.src = `${CONFIG.homeAssistant.url}/api/camera_proxy/${entityId}?token=${CONFIG.homeAssistant.token}&t=${Date.now()}`;
  }
}

// Service calls
async function callService(domain, service, data = {}) {
  if (WS && WS.readyState === WebSocket.OPEN) {
    WS.send(JSON.stringify({
      id: Date.now(),
      type: 'call_service',
      domain,
      service,
      service_data: data
    }));
  }
}

function toggleEntity(entityId) {
  const domain = entityId.split('.')[0];
  const service = STATES[entityId]?.state === 'on' ? 'turn_off' : 'turn_on';
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
  if (!entity) return;
  
  const currentTemp = entity.attributes.temperature || 20;
  const newTemp = currentTemp + delta;
  
  callService('climate', 'set_temperature', {
    entity_id: entityId,
    temperature: newTemp
  });
}

// Weather widget
function renderWeather() {
  const container = document.getElementById('weather-container');
  if (!container) return;
  
  container.innerHTML = '';
  
  // Find weather entities
  const weatherEntities = Object.values(STATES).filter(e => e.entity_id.startsWith('weather.'));
  
  if (weatherEntities.length === 0) {
    container.innerHTML = '<p>No weather entities found</p>';
    return;
  }
  
  weatherEntities.forEach(entity => {
    const widget = document.createElement('div');
    widget.className = 'weather-widget';
    widget.innerHTML = `
      <h4>${entity.attributes.friendly_name || entity.entity_id}</h4>
      <div class="weather-current">
        <span class="weather-temp">${entity.attributes.temperature}°</span>
        <span class="weather-state">${entity.state}</span>
      </div>
      <div class="weather-details">
        <div>Humidity: ${entity.attributes.humidity}%</div>
        <div>Pressure: ${entity.attributes.pressure} hPa</div>
        <div>Wind: ${entity.attributes.wind_speed} km/h</div>
      </div>
      <div class="weather-forecast">
        ${(entity.attributes.forecast || []).slice(0, 5).map(day => `
          <div class="forecast-day">
            <div>${new Date(day.datetime).toLocaleDateString('en', { weekday: 'short' })}</div>
            <div>${day.temperature}°</div>
            <div>${day.condition}</div>
          </div>
        `).join('')}
      </div>
    `;
    container.appendChild(widget);
  });
}

// History graphs
function renderHistory() {
  const canvas = document.getElementById('history-chart');
  if (!canvas) return;
  
  // Get sensor entities for graphing
  const sensors = Object.values(STATES)
    .filter(e => e.entity_id.startsWith('sensor.') && e.attributes.unit_of_measurement)
    .slice(0, 5); // Limit to 5 sensors for clarity
  
  if (sensors.length === 0) return;
  
  // Fetch history for each sensor
  Promise.all(sensors.map(sensor => 
    axios.get(`${CONFIG.homeAssistant.url}/api/history/period?filter_entity_id=${sensor.entity_id}`, {
      headers: { Authorization: `Bearer ${CONFIG.homeAssistant.token}` }
    })
  )).then(responses => {
    const datasets = responses.map((res, i) => {
      const sensor = sensors[i];
      const history = res.data[0] || [];
      
      return {
        label: sensor.attributes.friendly_name || sensor.entity_id,
        data: history.map(point => ({
          x: new Date(point.last_changed),
          y: parseFloat(point.state) || 0
        })),
        borderColor: `hsl(${i * 60}, 70%, 60%)`,
        backgroundColor: `hsla(${i * 60}, 70%, 60%, 0.1)`,
        tension: 0.1
      };
    });
    
    if (HISTORY_CHART) {
      HISTORY_CHART.destroy();
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
        }
      }
    });
  });
}

// Service explorer
function populateServiceExplorer() {
  const domainSelect = document.getElementById('service-domain');
  const serviceSelect = document.getElementById('service-name');
  
  if (!domainSelect || !serviceSelect) return;
  
  domainSelect.innerHTML = '<option value="">Select domain...</option>';
  Object.keys(SERVICES).forEach(domain => {
    const option = document.createElement('option');
    option.value = domain;
    option.textContent = domain;
    domainSelect.appendChild(option);
  });
  
  domainSelect.onchange = () => {
    const domain = domainSelect.value;
    serviceSelect.innerHTML = '<option value="">Select service...</option>';
    
    if (domain && SERVICES[domain]) {
      Object.keys(SERVICES[domain]).forEach(service => {
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
        resultSpan.textContent = 'Select domain and service';
        return;
      }
      
      let serviceData = {};
      try {
        if (dataInput.value) {
          serviceData = JSON.parse(dataInput.value);
        }
      } catch (e) {
        resultSpan.textContent = 'Invalid JSON';
        return;
      }
      
      if (entityInput.value) {
        serviceData.entity_id = entityInput.value;
      }
      
      callService(domain, service, serviceData);
      resultSpan.textContent = '✓ Service called';
      setTimeout(() => { resultSpan.textContent = ''; }, 3000);
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
      .filter(e => e.entity_id.includes(filter.toLowerCase()))
      .slice(0, 50);
    
    filtered.forEach(entity => {
      const card = createEntityCard(entity);
      listContainer.appendChild(card);
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
      tabs.forEach(t => t.classList.remove('active'));
      contents.forEach(c => c.classList.remove('active'));
      
      tab.classList.add('active');
      const content = document.getElementById(`${tab.dataset.tab}-tab`);
      if (content) {
        content.classList.add('active');
        
        // Render specific tab content
        switch (tab.dataset.tab) {
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
            populateEntityInspector();
            break;
        }
      }
    };
  });
}

// Render functions for each tab
function renderDashboard() {
  const domains = {
    'lights-container': ['light', 'switch'],
    'sensors-container': ['sensor'],
    'climate-container': ['climate'],
    'media-container': ['media_player']
  };
  
  Object.entries(domains).forEach(([containerId, domainList]) => {
    const container = document.getElementById(containerId);
    if (!container) return;
    
    container.innerHTML = '';
    const entities = Object.values(STATES)
      .filter(e => domainList.some(d => e.entity_id.startsWith(d + '.')))
      .filter(e => FILTERS.domains.includes(e.entity_id.split('.')[0]))
      .slice(0, 10);
    
    entities.forEach(entity => {
      container.appendChild(createEntityCard(entity));
    });
  });
}

function renderScenes() {
  const container = document.getElementById('scenes-container');
  if (!container) return;
  
  container.innerHTML = '';
  const scenes = Object.values(STATES)
    .filter(e => e.entity_id.startsWith('scene.'));
  
  scenes.forEach(scene => {
    container.appendChild(createEntityCard(scene));
  });
}

function renderAutomations() {
  const container = document.getElementById('automations-container');
  if (!container) return;
  
  container.innerHTML = '';
  const automations = Object.values(STATES)
    .filter(e => e.entity_id.startsWith('automation.'));
  
  automations.forEach(automation => {
    container.appendChild(createEntityCard(automation));
  });
}

function renderMediaPlayers() {
  const container = document.getElementById('media-players-container');
  if (!container) return;
  
  container.innerHTML = '';
  const players = Object.values(STATES)
    .filter(e => e.entity_id.startsWith('media_player.'));
  
  players.forEach(player => {
    container.appendChild(createEntityCard(player));
  });
}

function renderCameras() {
  const container = document.getElementById('cameras-container');
  if (!container) return;
  
  container.innerHTML = '';
  
  // Get camera entities from config or auto-detect
  const cameraIds = CONFIG.cameraEntities || 
    Object.keys(STATES).filter(id => id.startsWith('camera.'));
  
  cameraIds.forEach(entityId => {
    const card = createCameraCard(entityId);
    if (card) container.appendChild(card);
  });
  
  // Auto-refresh cameras every 10 seconds
  setInterval(() => {
    cameraIds.forEach(refreshCamera);
  }, 10000);
}

function renderAllTabs() {
  renderDashboard();
  setLastUpdate();
}

function updateEntityInUI(entity) {
  // Update entity card if it exists
  const card = document.querySelector(`.entity-card[data-entity-id="${entity.entity_id}"]`);
  if (card) {
    const newCard = createEntityCard(entity);
    card.replaceWith(newCard);
  }
  setLastUpdate();
}

// Filter and area management
function populateAreaFilter() {
  const select = document.getElementById('area-select');
  if (!select) return;
  
  select.innerHTML = '';
  Object.values(AREAS).forEach(area => {
    const option = document.createElement('option');
    option.value = area.area_id;
    option.textContent = area.name;
    select.appendChild(option);
  });
}

function populateDomainFilters() {
  const container = document.getElementById('domain-filters');
  if (!container) return;
  
  const allDomains = [...new Set(Object.keys(STATES).map(id => id.split('.')[0]))];
  
  allDomains.forEach(domain => {
    const label = document.createElement('label');
    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.value = domain;
    checkbox.checked = FILTERS.domains.includes(domain);
    
    label.appendChild(checkbox);
    label.appendChild(document.createTextNode(' ' + domain));
    container.appendChild(label);
  });
}

// Settings management
async function openSettings() {
  const modal = document.getElementById('settings-modal');
  const urlInput = document.getElementById('ha-url');
  const tokenInput = document.getElementById('ha-token');
  const intervalInput = document.getElementById('update-interval');
  const alwaysOnTop = document.getElementById('always-on-top');
  const favoritesInput = document.getElementById('favorite-entities');
  const camerasInput = document.getElementById('camera-entities');

  urlInput.value = CONFIG.homeAssistant.url;
  tokenInput.value = CONFIG.homeAssistant.token;
  intervalInput.value = Math.max(1, Math.round(CONFIG.updateInterval / 1000));
  alwaysOnTop.checked = CONFIG.alwaysOnTop;
  favoritesInput.value = (CONFIG.favoriteEntities || []).join(', ');
  camerasInput.value = (CONFIG.cameraEntities || []).join(', ');

  populateDomainFilters();
  populateAreaFilter();

  modal.classList.remove('hidden');

  document.getElementById('cancel-settings').onclick = () => modal.classList.add('hidden');
  document.getElementById('save-settings').onclick = async () => {
    CONFIG.homeAssistant.url = urlInput.value.trim();
    CONFIG.homeAssistant.token = tokenInput.value.trim();
    CONFIG.updateInterval = Math.max(1000, parseInt(intervalInput.value, 10) * 1000);
    CONFIG.alwaysOnTop = !!alwaysOnTop.checked;
    CONFIG.favoriteEntities = favoritesInput.value.split(',').map(s => s.trim()).filter(Boolean);
    CONFIG.cameraEntities = camerasInput.value.split(',').map(s => s.trim()).filter(Boolean);
    
    // Update domain filters
    const checkboxes = document.querySelectorAll('#domain-filters input[type="checkbox"]');
    FILTERS.domains = Array.from(checkboxes)
      .filter(cb => cb.checked)
      .map(cb => cb.value);
    
    // Update area filters
    const areaSelect = document.getElementById('area-select');
    FILTERS.areas = Array.from(areaSelect.selectedOptions).map(opt => opt.value);
    
    CONFIG.filters = FILTERS;
    
    await ipcRenderer.invoke('update-config', CONFIG);
    modal.classList.add('hidden');
    
    // Reconnect WebSocket with new config
    if (WS) WS.close();
    connectWebSocket();
  };
}

// Wire up UI controls
function wireUI() {
  document.getElementById('settings-btn').onclick = openSettings;
  document.getElementById('refresh-btn').onclick = renderAllTabs;
  document.getElementById('close-btn').onclick = () => window.close();
  document.getElementById('minimize-btn').onclick = () => {
    // Not directly available in renderer; could use IPC if needed
    require('electron').remote?.getCurrentWindow()?.minimize?.();
  };

  const opacitySlider = document.getElementById('opacity-slider');
  const opacityValue = document.getElementById('opacity-value');
  if (opacitySlider) {
    opacitySlider.oninput = () => {
      const v = parseFloat(opacitySlider.value);
      opacityValue.textContent = `${Math.round(v * 100)}%`;
      ipcRenderer.invoke('set-opacity', v);
    };
  }
  
  setupTabs();
}

// Initialize
async function init() {
  showLoading(true);
  CONFIG = await ipcRenderer.invoke('get-config');
  
  if (CONFIG.filters) {
    FILTERS = CONFIG.filters;
  }
  
  wireUI();
  connectWebSocket();
  showLoading(false);
}

window.addEventListener('DOMContentLoaded', init);

const { ipcRenderer } = require('electron');
const axios = require('axios');
const Chart = require('chart.js/auto');

let CONFIG = null;
let WS = null;
let STATES = {};
let SERVICES = {};
let AREAS = {};
let HISTORY_CHART = null;
let CAMERA_REFRESH_INTERVAL = null;
let FILTERS = {
  domains: ['light', 'switch', 'sensor', 'climate', 'media_player', 'scene', 'automation', 'camera'],
  areas: [],
  favorites: []
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
            renderAllTabs();
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

// Enhanced entity card with more controls
function createEntityCard(entity, options = {}) {
  if (!entity) return null;
  
  const card = document.createElement('div');
  card.className = 'entity-card';
  card.dataset.entityId = entity.entity_id;

  const left = document.createElement('div');
  left.style.flex = '1';
  
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
  } else if (domain === 'climate' && entity.attributes.temperature !== undefined) {
    stateText = `${entity.attributes.temperature}°`;
    if (entity.attributes.current_temperature !== undefined) {
      stateText += ` (Current: ${entity.attributes.current_temperature}°)`;
    }
  } else if (domain === 'media_player' && entity.attributes.media_title) {
    stateText = entity.attributes.media_title;
  }
  
  state.textContent = stateText;
  left.appendChild(name);
  left.appendChild(state);

  const right = document.createElement('div');
  right.className = 'controls';
  right.style.display = 'flex';
  right.style.gap = '6px';
  right.style.alignItems = 'center';

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
  img.src = `${CONFIG.homeAssistant.url}/api/camera_proxy/${entityId}?token=${CONFIG.homeAssistant.token}&t=${Date.now()}`;
  img.alt = entity ? (entity.attributes.friendly_name || entityId) : entityId;
  img.onerror = () => {
    img.style.display = 'none';
    const errorMsg = document.createElement('div');
    errorMsg.textContent = 'Camera feed unavailable';
    errorMsg.style.padding = '20px';
    errorMsg.style.textAlign = 'center';
    card.appendChild(errorMsg);
  };
  
  card.appendChild(header);
  card.appendChild(img);
  
  return card;
}

function refreshCamera(entityId) {
  const img = document.querySelector(`.camera img[alt*="${entityId.split('.')[1]}"]`);
  if (img) {
    img.src = `${CONFIG.homeAssistant.url}/api/camera_proxy/${entityId}?token=${CONFIG.homeAssistant.token}&t=${Date.now()}`;
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

// Weather widget
function renderWeather() {
  const container = document.getElementById('weather-container');
  if (!container) return;
  
  container.innerHTML = '';
  
  // Find weather entities
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
  
  // Get sensor entities for graphing
  const sensors = Object.values(STATES)
    .filter(e => e.entity_id.startsWith('sensor.') && e.attributes && e.attributes.unit_of_measurement)
    .slice(0, 5); // Limit to 5 sensors for clarity
  
  if (sensors.length === 0) {
    const container = canvas.parentElement;
    if (container) {
      canvas.style.display = 'none';
      const msg = document.createElement('p');
      msg.textContent = 'No sensors with numerical values found';
      msg.style.textAlign = 'center';
      msg.style.padding = '20px';
      container.appendChild(msg);
    }
    return;
  }
  
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
      tabs.forEach(t => t.classList.remove('active'));
      contents.forEach(c => c.classList.remove('active'));
      
      tab.classList.add('active');
      const content = document.getElementById(`${tab.dataset.tab}-tab`);
      if (content) {
        content.classList.add('active');
        
        // Render specific tab content
        switch (tab.dataset.tab) {
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
      const card = createEntityCard(entity);
      if (card) container.appendChild(card);
    });
    
    if (entities.length === 0) {
      const msg = document.createElement('p');
      msg.textContent = `No ${domainList.join('/')} entities found`;
      msg.style.padding = '10px';
      msg.style.textAlign = 'center';
      msg.style.opacity = '0.6';
      container.appendChild(msg);
    }
  });
}

function renderScenes() {
  const container = document.getElementById('scenes-container');
  if (!container) return;
  
  container.innerHTML = '';
  const scenes = Object.values(STATES)
    .filter(e => e.entity_id.startsWith('scene.'));
  
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
  const automations = Object.values(STATES)
    .filter(e => e.entity_id.startsWith('automation.'));
  
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
  const players = Object.values(STATES)
    .filter(e => e.entity_id.startsWith('media_player.'));
  
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

function renderAllTabs() {
  // Only render the active tab
  const activeTab = document.querySelector('.tab-btn.active');
  if (activeTab) {
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
  } else {
    renderDashboard();
  }
  setLastUpdate();
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

  populateDomainFilters();
  populateAreaFilter();

  modal.classList.remove('hidden');

  const cancelBtn = document.getElementById('cancel-settings');
  if (cancelBtn) {
    cancelBtn.onclick = () => modal.classList.add('hidden');
  }
  
  const saveBtn = document.getElementById('save-settings');
  if (saveBtn) {
    saveBtn.onclick = async () => {
      if (urlInput) CONFIG.homeAssistant.url = urlInput.value.trim();
      if (tokenInput) CONFIG.homeAssistant.token = tokenInput.value.trim();
      if (intervalInput) CONFIG.updateInterval = Math.max(1000, parseInt(intervalInput.value, 10) * 1000);
      if (alwaysOnTop) CONFIG.alwaysOnTop = alwaysOnTop.checked;
      if (favoritesInput) CONFIG.favoriteEntities = favoritesInput.value.split(',').map(s => s.trim()).filter(Boolean);
      if (camerasInput) CONFIG.cameraEntities = camerasInput.value.split(',').map(s => s.trim()).filter(Boolean);
      
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
        modal.classList.add('hidden');
        
        // Reconnect WebSocket with new config
        connectWebSocket();
      } catch (error) {
        console.error('Failed to save config:', error);
      }
    };
  }
}

// Wire up UI controls
function wireUI() {
  const settingsBtn = document.getElementById('settings-btn');
  if (settingsBtn) settingsBtn.onclick = openSettings;
  
  const refreshBtn = document.getElementById('refresh-btn');
  if (refreshBtn) refreshBtn.onclick = renderAllTabs;
  
  const closeBtn = document.getElementById('close-btn');
  if (closeBtn) closeBtn.onclick = () => window.close();
  
  const minimizeBtn = document.getElementById('minimize-btn');
  if (minimizeBtn) {
    minimizeBtn.onclick = () => {
      // Send message to main process to minimize
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
  
  setupTabs();
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
    
    wireUI();
    connectWebSocket();
    
    // Initial render after a short delay to ensure DOM is ready
    setTimeout(() => {
      renderAllTabs();
      showLoading(false);
    }, 100);
  } catch (error) {
    console.error('Initialization error:', error);
    showLoading(false);
  }
}

window.addEventListener('DOMContentLoaded', init);

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
let DASHBOARD_LAYOUT = [];
let DRAG_PLACEHOLDER = null;
let EDIT_SNAPSHOT_LAYOUT = null;
// Dashboard camera state and timers
const DASHBOARD_CAMERA_EXPANDED = new Set();
const TIMER_MAP = new Map();
let TIMER_TICK = null;
// Motion popup state
let MOTION_POPUP = null;
let MOTION_POPUP_TIMER = null;
let MOTION_POPUP_CAMERA = null;
const MOTION_LAST_TRIGGER = new Map();
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
        const oldEntity = msg.event.data.old_state;
        if (entity) {
          STATES[entity.entity_id] = entity;
          updateEntityInUI(entity);
          handleMotionEvent(entity, oldEntity);
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
  if (options?.context) card.dataset.context = options.context;
  
  
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
      try { if (DRAG_PLACEHOLDER && DRAG_PLACEHOLDER.parentNode) DRAG_PLACEHOLDER.remove(); } catch (_) {}
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
    if (EDIT_MODE) {
      const removeBtn = document.createElement('button');
      removeBtn.className = 'btn btn-danger';
      removeBtn.textContent = '×';
      removeBtn.setAttribute('aria-label', 'Remove card');
      removeBtn.title = 'Remove from dashboard';
      removeBtn.onclick = () => removeFromDashboard(entity.entity_id);
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

  if (EDIT_MODE) {
    const removeBtn = document.createElement('button');
    removeBtn.className = 'btn btn-danger';
    removeBtn.textContent = '×';
    removeBtn.setAttribute('aria-label', 'Remove card');
    removeBtn.title = 'Remove from dashboard';
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
    try { existing.hls?.destroy(); } catch (_) {}
    try { existing.video.pause(); existing.video.removeAttribute('src'); existing.video.load(); } catch (_) {}
    ACTIVE_HLS.delete(entityId);
  }

  if (Hls && Hls.isSupported()) {
    const hls = new Hls({ lowLatencyMode: true, backBufferLength: 90 });
    hls.loadSource(hlsUrl);
    hls.attachMedia(video);
    hls.on(Hls.Events.ERROR, (_evt, data) => {
      console.warn('HLS error', data?.details || data);
      if (data?.fatal) {
        try { hls.destroy(); } catch (_) {}
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
    try { active.hls?.destroy(); } catch (_) {}
    try { active.video.pause(); active.video.removeAttribute('src'); active.video.load(); } catch (_) {}
    try { active.video.remove(); } catch (_) {}
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
  // Snapshot current layout so we can discard if needed
  EDIT_SNAPSHOT_LAYOUT = Array.isArray(DASHBOARD_LAYOUT) ? [...DASHBOARD_LAYOUT] : [];
  EDIT_MODE = true;
  document.body.classList.add('edit-mode');
  renderDashboard();
  // Do NOT auto-open the entity selector; user will click +Add
}

function disableEditMode(save = true) {
  // If discarding, revert to snapshot
  if (!save && Array.isArray(EDIT_SNAPSHOT_LAYOUT)) {
    DASHBOARD_LAYOUT = [...EDIT_SNAPSHOT_LAYOUT];
  }
  EDIT_SNAPSHOT_LAYOUT = null;
  EDIT_MODE = false;
  document.body.classList.remove('edit-mode');
  // Close entity drawer and cleanup
  try {
    const selector = document.getElementById('entity-selector');
    if (selector) {
      selector.classList.add('closed');
      selector.style.display = 'none';
    }
    const dash = document.querySelector('.dashboard-container');
    if (dash) dash.classList.remove('with-entity-drawer');
    const toggle = document.getElementById('entity-drawer-toggle');
    if (toggle) toggle.remove();
  } catch (_) {}
  hideEntitySelector();
  if (save) {
    saveDashboardLayout();
  }
  renderDashboard();
}

function openEntityDrawer() {
  // Ensure selector exists, then open it
  showEntitySelector();
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

function showEntitySelector() {
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

    // Close button for drawer
    const closeBtn = selector.querySelector('#entity-drawer-close');
    if (closeBtn) closeBtn.onclick = closeEntityDrawer;

    // Make selector draggable via header
    const handle = selector.querySelector('.drag-handle');
    let dragging = false, startX = 0, startY = 0, startLeft = 0, startTop = 0;
    const onMove = (e) => {
      if (!dragging) return;
      const dx = e.clientX - startX;
      const dy = e.clientY - startY;
      const nextLeft = Math.max(0, Math.min(window.innerWidth - selector.offsetWidth, startLeft + dx));
      const nextTop = Math.max(0, Math.min(window.innerHeight - selector.offsetHeight, startTop + dy));
      selector.style.left = `${nextLeft}px`;
      selector.style.top = `${nextTop}px`;
      selector.style.right = 'auto';
    };
    const onUp = () => { dragging = false; document.removeEventListener('mousemove', onMove); document.removeEventListener('mouseup', onUp); };
    handle.addEventListener('mousedown', (e) => {
      dragging = true;
      startX = e.clientX; startY = e.clientY;
      const rect = selector.getBoundingClientRect();
      startLeft = rect.left; startTop = rect.top;
      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', onUp);
    });
  }
  
  // Keep it in the DOM but don't auto-open; caller will open it
  selector.style.display = 'block';
  
  const searchInput = document.getElementById('entity-search-add');
  const container = document.getElementById('available-entities');
  
  const renderAvailable = (filter = '') => {
    container.innerHTML = '';
    const f = (filter || '').toLowerCase();
    const available = Object.keys(STATES)
      .filter(id => !DASHBOARD_LAYOUT.includes(id))
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
window.saveEdit = function() { disableEditMode(true); };
window.discardEdit = function() { disableEditMode(false); };

function saveDashboardLayout() {
  CONFIG.dashboardLayout = DASHBOARD_LAYOUT;
  ipcRenderer.invoke('update-config', CONFIG);
}

function setupDragAndDrop() {
  const container = document.getElementById('dashboard-custom');
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
    // Update layout order (do not persist until user clicks Save)
    const cards = container.querySelectorAll('.entity-card');
    DASHBOARD_LAYOUT = Array.from(cards).map(card => card.dataset.entityId);
  };
}


function getDragAfterElement(container, x, y) {
  const draggableElements = [...container.querySelectorAll('.entity-card:not(.dragging)')];
  // Find the closest element below the pointer (by center) in a wrapped grid
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
  } catch (_) {}
}
function renderSkeletonWeather(container, count = 2) {
  try {
    for (let i = 0; i < count; i++) {
      const w = document.createElement('div');
      w.className = 'weather-widget skeleton';
      w.style.height = '120px';
      container.appendChild(w);
    }
  } catch (_) {}
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
    container.innerHTML = '';
    renderSkeletonCards(container, 4);
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
    const f = (filter || '').toLowerCase();
    const filtered = Object.values(STATES)
      .filter(e => {
        const idMatch = e.entity_id.toLowerCase().includes(f);
        const name = (e.attributes?.friendly_name || '').toLowerCase();
        const nameMatch = name.includes(f);
        return idMatch || nameMatch;
      })
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
      const prevActive = document.querySelector('.tab-btn.active');
      if (prevActive && prevActive.dataset.tab === 'cameras') {
        stopAllCameraStreams();
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
  const dashboardTab = document.getElementById('dashboard-tab');
  const toolbarHTML = EDIT_MODE
    ? `
      <button class="btn btn-primary" onclick="saveEdit()">Save changes</button>
      <button class="btn btn-secondary" onclick="discardEdit()">Discard</button>
      <button class="btn btn-secondary" onclick="openAddDrawer()">+ Add</button>
    `
    : `<button class="btn btn-secondary" onclick="enableEditMode()">Edit</button>`;

  // If we have a custom layout OR we are in edit mode (even with empty layout), render the custom dashboard shell
  if ((DASHBOARD_LAYOUT && DASHBOARD_LAYOUT.length > 0) || EDIT_MODE) {
    const container = document.getElementById('dashboard-custom');
    if (!container) {
      dashboardTab.innerHTML = `
        <div class="section">
          <div class="section-header">
            <h3 class="section-title">My Dashboard</h3>
          </div>
          <div class="section-toolbar">${toolbarHTML}</div>
          <div id="dashboard-custom" class="entity-grid"></div>
        </div>
      `;
    } else {
      // If container exists, update toolbar in place when toggling modes
      const toolbar = container.parentElement.querySelector('.section-toolbar');
      if (toolbar) toolbar.innerHTML = toolbarHTML;
    }

    const customContainer = document.getElementById('dashboard-custom');
    customContainer.classList.add('entity-grid');
    customContainer.innerHTML = '';

    DASHBOARD_LAYOUT.forEach(entityId => {
      const entity = STATES[entityId];
      if (entity && !FILTERS.hidden.includes(entityId)) {
        const card = createEntityCard(entity, { context: 'dashboard' });
        if (card) {
          card.classList.add('enter');
          customContainer.appendChild(card);
          requestAnimationFrame(() => {
            card.classList.add('enter-active');
            const onEnd = () => { card.classList.remove('enter', 'enter-active'); card.removeEventListener('transitionend', onEnd); };
            card.addEventListener('transitionend', onEnd);
          });
        }
      }
    });

    setupDragAndDrop();
  } else {
    // Default dashboard (not in edit mode and no custom layout)
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
        <div class="section-header">
          <h3 class="section-title">Dashboard</h3>
        </div>
        <div class="section-toolbar">
          <button class="btn btn-secondary" onclick="enableEditMode()">Customize</button>
        </div>
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
        const card = createEntityCard(e, { context: 'dashboard' });
        if (card) {
          card.classList.add('enter');
          favList.appendChild(card);
          requestAnimationFrame(() => {
            card.classList.add('enter-active');
            const onEnd = () => { card.classList.remove('enter', 'enter-active'); card.removeEventListener('transitionend', onEnd); };
            card.addEventListener('transitionend', onEnd);
          });
        }
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
    container.innerHTML = '';
    renderSkeletonCards(container, 4);
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
    container.innerHTML = '';
    renderSkeletonCards(container, 4);
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
    container.innerHTML = '';
    renderSkeletonCards(container, 4);
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
  // Hide motion popup when entering cameras, but leave user control if they want to keep it
  hideMotionPopup(true);
  
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
  
  // Auto-refresh cameras every 10 seconds (snapshots only)
  CAMERA_REFRESH_INTERVAL = setInterval(() => {
    cameraIds.forEach(id => { if (!LIVE_CAMERAS.has(id)) refreshCamera(id); });
  }, 10000);
}

function updateEntityInUI(entity) {
  if (!entity) return;
  
  // Update entity card if it exists
  const cards = document.querySelectorAll(`.entity-card[data-entity-id="${entity.entity_id}"]`);
  cards.forEach(card => {
    // Preserve dashboard camera cards while live to avoid tearing down streams/UI
    const isDashboard = card.dataset.context === 'dashboard' || !!card.closest('#dashboard-custom');
    const isCamera = entity.entity_id.startsWith('camera.');
    if (isDashboard && isCamera) {
      if (LIVE_CAMERAS.has(entity.entity_id)) {
        return; // don't touch while streaming
      }
    }
    const ctx = card.dataset.context || (card.closest('#dashboard-custom') ? 'dashboard' : null);
    const newCard = ctx ? createEntityCard(entity, { context: ctx }) : createEntityCard(entity);
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

  // Searchable entity inputs
  setupEntitySearchInput('favorite-entities');
  setupEntitySearchInput('camera-entities', ['camera']);
  setupEntitySearchInput('motion-popup-cameras', ['camera']);

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
  
  if (urlInput) CONFIG.homeAssistant.url = urlInput.value.trim();
  if (tokenInput) CONFIG.homeAssistant.token = tokenInput.value.trim();
  if (intervalInput) CONFIG.updateInterval = Math.max(1000, parseInt(intervalInput.value, 10) * 1000);
  if (alwaysOnTop) CONFIG.alwaysOnTop = alwaysOnTop.checked;
  if (favoritesInput) CONFIG.favoriteEntities = favoritesInput.value.split(',').map(s => s.trim()).filter(Boolean);
  if (camerasInput) CONFIG.cameraEntities = camerasInput.value.split(',').map(s => s.trim()).filter(Boolean);

  // Motion popup config
  CONFIG.motionPopup = CONFIG.motionPopup || {};
  if (motionEnabled) CONFIG.motionPopup.enabled = !!motionEnabled.checked;
  if (motionCams) CONFIG.motionPopup.cameras = motionCams.value.split(',').map(s => s.trim()).filter(Boolean);
  if (motionAutoHide) CONFIG.motionPopup.autoHideSeconds = Math.max(3, Math.min(120, parseInt(motionAutoHide.value || 12, 10)));
  if (motionCooldown) CONFIG.motionPopup.cooldownSeconds = Math.max(0, Math.min(600, parseInt(motionCooldown.value || 30, 10)));

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

    // Apply Always on Top immediately if changed
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
      } catch (_) {}
    }

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


// Entity suggestion helpers for settings
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

// Timer countdown support
function formatDuration(ms) {
  if (ms < 0) ms = 0;
  const s = Math.floor(ms / 1000);
  const hh = Math.floor(s / 3600);
  const mm = Math.floor((s % 3600) / 60);
  const ss = s % 60;
  if (hh > 0) return `${hh}:${String(mm).padStart(2,'0')}:${String(ss).padStart(2,'0')}`;
  return `${mm}:${String(ss).padStart(2,'0')}`;
}

function getTimerEnd(entity) {
  const fin = entity.attributes?.finishes_at;
  if (fin) {
    const t = new Date(fin).getTime();
    if (!isNaN(t)) return t;
  }
  const rem = entity.attributes?.remaining;
  if (rem) {
    // HH:MM:SS
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

// Motion detection handling and popup UI
function handleMotionEvent(newState, oldState) {
  try {
    const mp = CONFIG?.motionPopup || {};
    if (!mp.enabled) return;
    if (!newState || newState.entity_id?.startsWith('binary_sensor.') !== true) return;
    if (newState.state !== 'on') return;
    const dc = (newState.attributes?.device_class || '').toLowerCase();
    if (dc !== 'motion' && dc !== 'occupancy' && dc !== 'moving') return;
    const selectedCams = (mp.cameras || []).filter(id => id.startsWith('camera.'));
    if (selectedCams.length === 0) return;

    // Heuristic match: link motion sensor to camera by slug or friendly name overlap
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
      // If no heuristic match, bail out quietly
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

    // If switching camera, stop existing stream and clear body
    if (MOTION_POPUP_CAMERA && MOTION_POPUP_CAMERA !== cameraId) {
      stopHlsStream(MOTION_POPUP_CAMERA, body);
      try { body.innerHTML = ''; } catch (_) {}
    }

    MOTION_POPUP_CAMERA = cameraId;
    title.textContent = (STATES?.[cameraId]?.attributes?.friendly_name || cameraId) + ' — Motion detected';

    // Ensure we have an image element for MJPEG fallback
    let img = body.querySelector('img.camera-img');
    if (!img) {
      img = document.createElement('img');
      img.className = 'camera-img';
      body.appendChild(img);
    }

    // Start HLS within popup body (works like a "card")
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
      // Clear MJPEG
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

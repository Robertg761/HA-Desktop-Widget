const { ipcRenderer } = require('electron');
const axios = require('axios');

let CONFIG = null;
let API = null;

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

function entityCard(entity) {
  const card = document.createElement('div');
  card.className = 'entity-card';

  const left = document.createElement('div');
  const name = document.createElement('div');
  name.className = 'entity-name';
  name.textContent = entity.attributes.friendly_name || entity.entity_id;
  const state = document.createElement('div');
  state.className = 'entity-state';
  state.textContent = `${entity.state} ${entity.attributes.unit_of_measurement || ''}`.trim();
  left.appendChild(name);
  left.appendChild(state);

  const right = document.createElement('div');
  right.className = 'toggle';

  // If it's a light or switch, add a toggle
  if (entity.entity_id.startsWith('light.') || entity.entity_id.startsWith('switch.')) {
    const btn = document.createElement('button');
    btn.className = 'btn btn-secondary';
    btn.textContent = entity.state === 'on' ? 'Turn off' : 'Turn on';
    btn.onclick = async () => {
      try {
        btn.disabled = true;
        await callService(entity.entity_id.startsWith('light.') ? 'light' : 'switch', entity.state === 'on' ? 'turn_off' : 'turn_on', { entity_id: entity.entity_id });
        await refreshEntities();
      } catch (e) {
        console.error(e);
      } finally {
        btn.disabled = false;
      }
    };
    right.appendChild(btn);
  }

  card.appendChild(left);
  card.appendChild(right);

  return card;
}

async function callService(domain, service, data) {
  if (!CONFIG) throw new Error('Config not loaded');
  const url = `${CONFIG.homeAssistant.url}/api/services/${domain}/${service}`;
  await axios.post(url, data, {
    headers: { Authorization: `Bearer ${CONFIG.homeAssistant.token}` }
  });
}

async function fetchStates() {
  if (!CONFIG) throw new Error('Config not loaded');
  const url = `${CONFIG.homeAssistant.url}/api/states`;
  const { data } = await axios.get(url, {
    headers: { Authorization: `Bearer ${CONFIG.homeAssistant.token}` }
  });
  return data;
}

function renderEntities(states) {
  const lights = states.filter(s => s.entity_id.startsWith('light.'));
  const switches = states.filter(s => s.entity_id.startsWith('switch.'));
  const sensors = states.filter(s => s.entity_id.startsWith('sensor.'));
  const climates = states.filter(s => s.entity_id.startsWith('climate.'));
  const media = states.filter(s => s.entity_id.startsWith('media_player.'));

  const lightsContainer = document.getElementById('lights-container');
  const sensorsContainer = document.getElementById('sensors-container');
  const climateContainer = document.getElementById('climate-container');
  const mediaContainer = document.getElementById('media-container');

  // Clear
  ;[lightsContainer, sensorsContainer, climateContainer, mediaContainer].forEach(el => el.innerHTML = '');

  [...lights, ...switches].forEach(e => lightsContainer.appendChild(entityCard(e)));
  sensors.slice(0, 10).forEach(e => sensorsContainer.appendChild(entityCard(e)));
  climates.forEach(e => climateContainer.appendChild(entityCard(e)));
  media.forEach(e => mediaContainer.appendChild(entityCard(e)));
}

async function refreshEntities() {
  try {
    const states = await fetchStates();
    renderEntities(states);
    setLastUpdate();
    setStatus(true);
  } catch (e) {
    console.error('Failed to refresh entities', e);
    setStatus(false);
  }
}

function wireUI() {
  document.getElementById('settings-btn').onclick = openSettings;
  document.getElementById('refresh-btn').onclick = refreshEntities;
  document.getElementById('close-btn').onclick = () => window.close();
  document.getElementById('minimize-btn').onclick = () => {
    // Not directly available in renderer; could use IPC if needed
    require('electron').remote?.getCurrentWindow()?.minimize?.();
  };

  const opacitySlider = document.getElementById('opacity-slider');
  const opacityValue = document.getElementById('opacity-value');
  opacitySlider.oninput = () => {
    const v = parseFloat(opacitySlider.value);
    opacityValue.textContent = `${Math.round(v * 100)}%`;
    ipcRenderer.invoke('set-opacity', v);
  };
}

async function openSettings() {
  const modal = document.getElementById('settings-modal');
  const urlInput = document.getElementById('ha-url');
  const tokenInput = document.getElementById('ha-token');
  const intervalInput = document.getElementById('update-interval');
  const alwaysOnTop = document.getElementById('always-on-top');

  urlInput.value = CONFIG.homeAssistant.url;
  tokenInput.value = CONFIG.homeAssistant.token;
  intervalInput.value = Math.max(1, Math.round(CONFIG.updateInterval / 1000));
  alwaysOnTop.checked = CONFIG.alwaysOnTop;

  modal.classList.remove('hidden');

  document.getElementById('cancel-settings').onclick = () => modal.classList.add('hidden');
  document.getElementById('save-settings').onclick = async () => {
    CONFIG.homeAssistant.url = urlInput.value.trim();
    CONFIG.homeAssistant.token = tokenInput.value.trim();
    CONFIG.updateInterval = Math.max(1000, parseInt(intervalInput.value, 10) * 1000);
    CONFIG.alwaysOnTop = !!alwaysOnTop.checked;
    await ipcRenderer.invoke('update-config', CONFIG);
    modal.classList.add('hidden');
    setupPolling();
    refreshEntities();
  };
}

let pollTimer = null;
function setupPolling() {
  if (pollTimer) clearInterval(pollTimer);
  pollTimer = setInterval(refreshEntities, CONFIG.updateInterval);
}

async function init() {
  showLoading(true);
  CONFIG = await ipcRenderer.invoke('get-config');
  wireUI();
  setupPolling();
  await refreshEntities();
  showLoading(false);
}

window.addEventListener('DOMContentLoaded', init);


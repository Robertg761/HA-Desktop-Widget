/**
 * @jest-environment jsdom
 */

const nodeUtil = require('util');
const { createMockElectronAPI, resetMockElectronAPI } = require('../mocks/electron.js');
global.TextEncoder = global.TextEncoder || nodeUtil.TextEncoder;
global.TextDecoder = global.TextDecoder || nodeUtil.TextDecoder;

// Setup mocks BEFORE loading modules
const mockElectronAPI = createMockElectronAPI();
window.electronAPI = mockElectronAPI;

// Mock dependencies
jest.mock('../../src/camera.js', () => ({
  CAMERA_PREVIEW_REFRESH_OPTIONS: [
    { value: 'off', label: 'Static icon (Default)', intervalMs: 0 },
    { value: 'live', label: 'Live stream while visible (Higher usage)', intervalMs: 0 },
    { value: '30s', label: 'Snapshot every 30 seconds (Efficient)', intervalMs: 30000 },
    { value: '10s', label: 'Snapshot every 10 seconds', intervalMs: 10000 },
    { value: '5s', label: 'Snapshot every 5 seconds (Frequent)', intervalMs: 5000 },
  ],
  disposeCameraPreview: jest.fn(),
  mountCameraPreview: jest.fn(),
  normalizeCameraPreviewRefresh: jest.fn((value) =>
    ['off', 'live', '30s', '10s', '5s'].includes(
      String(value || '')
        .trim()
        .toLowerCase()
    )
      ? String(value).trim().toLowerCase()
      : 'off'
  ),
  openCamera: jest.fn(),
  pruneCameraPreviews: jest.fn(),
  refreshCameraPreview: jest.fn(),
}));

jest.mock('../../src/ui-utils.js', () => {
  const releaseFocusTrap = jest.fn();
  return {
    showToast: jest.fn(),
    showConfirm: jest.fn().mockResolvedValue(false),
    showLoading: jest.fn(),
    setStatus: jest.fn(),
    trapFocus: jest.fn(),
    releaseFocusTrap,
    // Mirrors the real shared modal helper, which settles synchronously under NODE_ENV=test.
    closeModal: jest.fn((modal, { remove = false, releaseFocus = false, onClosed } = {}) => {
      if (modal) {
        modal.classList.remove('modal-closing');
        if (remove) {
          modal.remove();
        } else {
          modal.classList.add('hidden');
          if (modal.style.display) modal.style.display = 'none';
        }
        if (releaseFocus) releaseFocusTrap(modal);
        onClosed?.();
      }
      return Promise.resolve();
    }),
    openModal: jest.fn((modal, { display = 'flex' } = {}) => {
      if (!modal) return;
      modal.classList.remove('modal-closing');
      modal.classList.remove('hidden');
      if (display) modal.style.display = display;
      else modal.style.removeProperty('display');
    }),
    applyTheme: jest.fn(),
    applyUiPreferences: jest.fn(),
    hexToRgb: jest.fn((hex) => {
      if (!hex || typeof hex !== 'string') return null;
      const normalized = hex.replace('#', '').trim();
      if (![3, 6].includes(normalized.length) || !/^[0-9a-fA-F]+$/.test(normalized)) return null;
      const value =
        normalized.length === 3
          ? normalized
              .split('')
              .map((ch) => ch + ch)
              .join('')
          : normalized;
      return {
        r: Number.parseInt(value.slice(0, 2), 16),
        g: Number.parseInt(value.slice(2, 4), 16),
        b: Number.parseInt(value.slice(4, 6), 16),
      };
    }),
    miredsToKelvin: jest.fn((mireds) => {
      const value = Number(mireds);
      return Number.isFinite(value) && value > 0 ? Math.round(1000000 / value) : null;
    }),
    hasSupportedFeature: jest.fn((supportedFeatures, featureFlag) => {
      const features = Number(supportedFeatures);
      const flag = Number(featureFlag);
      return (
        Number.isFinite(features) && Number.isFinite(flag) && flag > 0 && (features & flag) === flag
      );
    }),
  };
});

jest.mock('../../src/icons.js', () => ({
  setIconContent: jest.fn(),
  applyCloseButtonIcons: jest.fn(),
}));

jest.mock('../../src/weather-icons.js', () => ({
  normalizeWeatherCondition: jest.requireActual('../../src/weather-icons.js')
    .normalizeWeatherCondition,
  WEATHER_LABELS: jest.requireActual('../../src/weather-icons.js').WEATHER_LABELS,
  renderWeatherIcon: jest.fn((element, condition) => {
    element.replaceChildren();
    element.dataset.weatherCondition = condition;
  }),
}));

jest.mock('sortablejs', () => ({
  create: jest.fn(() => ({
    destroy: jest.fn(),
  })),
}));

// Mock WebSocket callService method
const mockCallService = jest.fn().mockResolvedValue({});
const mockCallServiceWithResponse = jest.fn().mockResolvedValue({});
const mockRequest = jest.fn().mockResolvedValue({});

jest.mock('../../src/websocket.js', () => ({
  callService: mockCallService,
  callServiceWithResponse: mockCallServiceWithResponse,
  isConnected: jest.fn(() => true),
  on: jest.fn(),
  emit: jest.fn(),
  request: mockRequest,
}));

// Import modules after mocks
const ui = require('../../src/ui.js');
const state = require('../../src/state.js').default;
const { sampleConfig } = require('../fixtures/ha-data.js');
const i18n = require('../../src/i18n.js');

const entity = (entity_id, value, attributes = {}) => ({ entity_id, state: value, attributes });
const renderTiles = (states) => {
  const ids = states.map((item) => item.entity_id);
  state.setConfig({
    ...state.CONFIG,
    customTabs: [{ id: 'i18n', name: 'i18n', entityIds: ids }],
    activeTabId: 'i18n',
    favoriteEntities: ids,
  });
  state.setStates(Object.fromEntries(states.map((item) => [item.entity_id, item])));
  ui.renderActiveTab();
};
const tile = (entityId) => document.querySelector(`#quick-controls [data-entity-id="${entityId}"]`);
const text = (selector) => document.querySelector(selector)?.textContent.trim();
const attr = (selector, name) => document.querySelector(selector)?.getAttribute(name);
const useGerman = (messages) => i18n.setLocaleBootstrap({ activeLocale: 'de', messages });

describe('ui.js translations and number formatting', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.spyOn(console, 'warn').mockImplementation(() => {});
    jest.spyOn(console, 'error').mockImplementation(() => {});
    jest.clearAllMocks();
    resetMockElectronAPI();
    i18n.setLocaleBootstrap({ activeLocale: 'en', messages: {} });
    document.body.innerHTML = `<div class="status-grid"><div id="weather-card"></div><div id="time-card"></div></div>
      <div id="quick-controls"></div><div id="desktop-pin-content"></div><div id="desktop-pin-empty"></div>`;
    state.setConfig({
      ...sampleConfig,
      ui: { theme: 'dark' },
      favoriteEntities: [],
      customTabs: [],
      primaryCards: ['none', 'none'],
    });
    state.setStates({});
    state.setServices({});
    state.setUnitSystem({ temperature: '°C' });
    mockCallService.mockReset().mockResolvedValue({ success: true });
  });
  afterEach(() => {
    document.querySelectorAll('.modal .close-btn').forEach((button) => button.click());
    i18n.setLocaleBootstrap({ activeLocale: 'en', messages: {} });
    jest.clearAllTimers();
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  it('translates the light dialog', () => {
    useGerman({
      Brightness: 'Helligkeit',
      Close: 'Schließen',
      'Turn Off': 'Ausschalten',
      'Color Temperature': 'Farbtemperatur',
      'Color temperature: Warm': 'Warm DE',
    });
    const light = entity('light.desk', 'on', {
      brightness: 128,
      supported_color_modes: ['color_temp'],
      min_color_temp_kelvin: 2000,
      max_color_temp_kelvin: 6500,
    });
    state.setStates({ [light.entity_id]: light });
    ui.openEntityDetailModal(light);
    expect(text('.brightness-label')).toBe('Helligkeit');
    expect(attr('#brightness-slider', 'aria-label')).toBe('Helligkeit');
    expect(text('#turn-off-btn')).toBe('Ausschalten');
    expect(text('#brightness-cancel')).toBe('Schließen');
    expect(attr('#brightness-close', 'aria-label')).toBe('Schließen');
    expect(text('.brightness-control-heading span')).toBe('Farbtemperatur');
    expect(text('.brightness-slider-labels span')).toBe('Warm DE');
  });

  it('shows language-pack markup in the light dialog labels as text', () => {
    useGerman({ Brightness: '<b>Helligkeit</b>' });
    const light = entity('light.desk', 'on', { brightness: 128 });
    state.setStates({ [light.entity_id]: light });
    ui.openEntityDetailModal(light);
    expect(document.querySelector('.brightness-label b')).toBeNull();
    expect(text('.brightness-label')).toBe('<b>Helligkeit</b>');
    document.querySelector('#brightness-close').click();
  });

  it('keeps colour-temperature Cool apart from the HVAC Cool mode', () => {
    const light = entity('light.desk', 'on', {
      brightness: 128,
      supported_color_modes: ['color_temp'],
      min_color_temp_kelvin: 2000,
      max_color_temp_kelvin: 6500,
    });
    const climate = entity('climate.hvac', 'cool', {
      current_temperature: 22,
      temperature: 21,
      min_temp: 7,
      max_temp: 35,
      supported_features: 1,
      hvac_modes: ['cool', 'off'],
    });
    state.setStates({ [light.entity_id]: light, [climate.entity_id]: climate });
    const lightEnds = () =>
      [...document.querySelectorAll('.brightness-slider-labels span')].map((node) =>
        node.textContent.trim()
      );

    useGerman({ 'Color temperature: Cool': 'Kalt', Cool: 'Kühlen' });
    ui.openEntityDetailModal(light);
    expect(lightEnds()).toEqual(['Warm', 'Kalt']);
    document.querySelector('#brightness-close').click();
    ui.openEntityDetailModal(climate);
    expect(text('.climate-mode-label')).toBe('Kühlen');
    document.querySelector('#climate-close').click();

    i18n.setLocaleBootstrap({ activeLocale: 'en', messages: {} });
    ui.openEntityDetailModal(light);
    expect(lightEnds()).toEqual(['Warm', 'Cool']);
  });

  it('names the translated entity type in toggle desktop pin titles', () => {
    useGerman({
      'Compact {{domain}} controls': 'Kompakte {{domain}}-Steuerung',
      'Domain: Switch': 'Schalter',
    });
    const plug = entity('switch.plug', 'on');
    state.setStates({ [plug.entity_id]: plug });
    ui.renderDesktopPinnedTile(plug.entity_id, plug);
    expect(document.querySelector('#desktop-pin-content .desktop-pin-toggle-control').title).toBe(
      'Kompakte Schalter-Steuerung'
    );
  });

  it('translates the cover dialog actions and labels', () => {
    useGerman({
      Open: 'Öffnen',
      Close: 'Schließen',
      Stop: 'Stopp',
      Position: 'Position DE',
      Closed: 'Geschlossen',
    });
    const cover = entity('cover.window', 'open', { current_position: 40, supported_features: 15 });
    state.setStates({ [cover.entity_id]: cover });
    ui.openEntityDetailModal(cover);
    const actions = [...document.querySelectorAll('.cover-action-label')].map((node) =>
      node.textContent.trim()
    );
    expect(actions).toEqual(['Schließen', 'Stopp', 'Öffnen']);
    expect(text('.cover-position-label')).toBe('Position DE');
    expect(text('.cover-slider-labels span')).toBe('Geschlossen');
    expect(text('#cover-cancel')).toBe('Schließen');
  });

  it('translates the media dialog, including the footer Close button', () => {
    useGerman({
      Close: 'Schließen',
      Volume: 'Lautstärke',
      Mute: 'Stummschalten',
      'Previous track': 'Vorheriger Titel',
      'Next track': 'Nächster Titel',
    });
    const player = entity('media_player.den', 'playing', {
      supported_features: 119695 + 16 + 32,
      media_title: 'Song',
      volume_level: 0.4,
      is_volume_muted: false,
    });
    state.setStates({ [player.entity_id]: player });
    ui.openEntityDetailModal(player);
    expect(text('#media-close-footer')).toBe('Schließen');
    expect(attr('#media-close', 'aria-label')).toBe('Schließen');
    expect(text('.media-volume-label')).toBe('Lautstärke');
    expect(text('#media-mute-toggle')).toBe('Stummschalten');
    expect(attr('.media-detail-prev-btn', 'aria-label')).toBe('Vorheriger Titel');
    expect(attr('.media-detail-next-btn', 'aria-label')).toBe('Nächster Titel');
  });

  it('translates climate dialog labels and formats temperatures for the locale', () => {
    useGerman({
      Current: 'Aktuell',
      Target: 'Ziel',
      Mode: 'Modus',
      Heat: 'Heizen',
      Close: 'Schließen',
    });
    const climate = entity('climate.hvac', 'heat', {
      current_temperature: 22.4,
      temperature: 21.5,
      min_temp: 7,
      max_temp: 35,
      target_temp_step: 0.5,
      supported_features: 1,
      hvac_modes: ['heat', 'off'],
    });
    state.setStates({ [climate.entity_id]: climate });
    ui.openEntityDetailModal(climate);
    const labels = [...document.querySelectorAll('.climate-temp-label')].map((node) =>
      node.textContent.trim()
    );
    expect(labels).toEqual(['Aktuell', 'Ziel']);
    expect(text('.climate-modes-label')).toBe('Modus');
    expect(text('#climate-target-value')).toBe('21,5°C');
    expect(text('.climate-current-temp .climate-temp-value')).toBe('22,4°C');
    // The slider itself keeps the machine value Home Assistant expects.
    expect(document.querySelector('#climate-slider').value).toBe('21.5');
    const modeLabels = [...document.querySelectorAll('.climate-mode-label')].map((node) =>
      node.textContent.trim()
    );
    expect(modeLabels).toEqual(['Heizen', 'Off']);
    expect(text('#climate-cancel')).toBe('Schließen');
  });

  it('pluralizes the to-do tile count', () => {
    useGerman({ '1 active': '1 offen', '{{count}} active': '{{count}} offen' });
    renderTiles([entity('todo.one', '1'), entity('todo.many', '3')]);
    expect(tile('todo.one').querySelector('.todo-active-count').textContent).toBe('1 offen');
    expect(tile('todo.many').querySelector('.todo-active-count').textContent).toBe('3 offen');
  });

  it('formats numeric sensor tiles for the active locale', () => {
    useGerman({});
    renderTiles([
      entity('sensor.room', '15.62', { unit_of_measurement: '°C', device_class: 'temperature' }),
    ]);
    expect(tile('sensor.room').querySelector('.control-sensor-value').textContent).toBe('15,6');
    i18n.setLocaleBootstrap({ activeLocale: 'en', messages: {} });
    ui.renderActiveTab();
    expect(tile('sensor.room').querySelector('.control-sensor-value').textContent).toBe('15.6');
  });

  it('groups measurements but not unitless sensor numbers like years', () => {
    renderTiles([
      entity('sensor.energy', '12345.5', { unit_of_measurement: 'kWh' }),
      entity('sensor.build_year', '2026', {}),
    ]);
    const value = (id) => tile(id).querySelector('.control-sensor-value').textContent;
    expect(value('sensor.energy')).toBe('12,345.5');
    expect(value('sensor.build_year')).toBe('2026');
  });

  it('translates the light tile Off state and the Quick Access pin toggle', () => {
    useGerman({ Off: 'Aus', Pin: 'Anheften', 'Pin to desktop': 'Auf dem Desktop anheften' });
    renderTiles([entity('light.desk', 'off', { supported_color_modes: ['brightness'] })]);
    expect(tile('light.desk').querySelector('.control-state').textContent).toBe('Aus');
    ui.toggleReorganizeMode();
    const toggle = tile('light.desk').querySelector('.desktop-pin-quick-toggle');
    expect(toggle.textContent).toBe('Anheften');
    expect(toggle.title).toBe('Auf dem Desktop anheften');
    ui.toggleReorganizeMode();
  });

  it('translates desktop pin climate labels at render time', () => {
    useGerman({
      Current: 'Aktuell',
      Target: 'Ziel',
      Heat: 'Heizen',
      '{{mode}} mode': 'Modus {{mode}}',
      'Set mode to {{mode}}': 'Modus auf {{mode}} setzen',
    });
    const climate = entity('climate.hvac', 'heat', {
      current_temperature: 22.4,
      temperature: 21.5,
      min_temp: 7,
      max_temp: 35,
      target_temp_step: 0.5,
      supported_features: 1,
      hvac_modes: ['heat', 'off'],
    });
    state.setStates({ [climate.entity_id]: climate });
    ui.renderDesktopPinnedTile(climate.entity_id, climate);
    const root = document.querySelector('#desktop-pin-content .desktop-pin-climate-control');
    const statLabels = [...root.querySelectorAll('.desktop-pin-panel-stat-label')].map((node) =>
      node.textContent.trim()
    );
    expect(statLabels).toEqual(['Aktuell', 'Ziel']);
    expect(root.querySelector('.desktop-pin-climate-target-value').textContent).toBe('21,5°C');
    expect(root.querySelector('.desktop-pin-panel-status').textContent).toBe('Modus Heizen');
    const heatButton = root.querySelector('.desktop-pin-climate-mode[data-action="heat"]');
    expect(heatButton.getAttribute('aria-label')).toBe('Modus auf Heizen setzen');
    expect(heatButton.textContent.trim()).toBe('Heizen');
  });
  it('rebuilds a desktop pin in the new language after a language change', () => {
    const cover = entity('cover.hall', 'open', { current_position: 40, supported_features: 15 });
    state.setStates({ [cover.entity_id]: cover });
    i18n.setLocaleBootstrap({ activeLocale: 'en', messages: {} });
    ui.renderDesktopPinnedTile(cover.entity_id, cover);
    const actions = () =>
      [...document.querySelectorAll('#desktop-pin-content .desktop-pin-cover-action')].map(
        (button) => button.textContent
      );
    expect(actions()).toEqual(['Close', 'Stop', 'Open']);

    useGerman({ Close: 'Schließen', Stop: 'Stopp', Open: 'Öffnen' });
    ui.renderDesktopPinnedTile(cover.entity_id, cover);
    expect(actions()).toEqual(['Schließen', 'Stopp', 'Öffnen']);
  });

  it('names the weather condition on a weather desktop pin', () => {
    useGerman({ Rainy: 'Regnerisch' });
    const weather = entity('weather.home', 'rainy', { temperature: 12.5, humidity: 80 });
    state.setStates({ [weather.entity_id]: weather });
    ui.renderDesktopPinnedTile(weather.entity_id, weather);
    const status = () =>
      document.querySelector('#desktop-pin-content .desktop-pin-panel-status').textContent;
    expect(status()).toBe('Regnerisch');
    ui.renderDesktopPinnedTile(weather.entity_id, { ...weather, state: 'rainy' });
    expect(status()).toBe('Regnerisch');
  });
});

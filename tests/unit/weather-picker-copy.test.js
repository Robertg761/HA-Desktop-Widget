/**
 * @jest-environment jsdom
 */

const { createMockElectronAPI } = require('../mocks/electron.js');

window.electronAPI = createMockElectronAPI();

jest.mock('../../src/camera.js', () => ({
  CAMERA_PREVIEW_REFRESH_OPTIONS: [],
  disposeCameraPreview: jest.fn(),
  mountCameraPreview: jest.fn(),
  normalizeCameraPreviewRefresh: jest.fn(() => 'off'),
  openCamera: jest.fn(),
  pruneCameraPreviews: jest.fn(),
  refreshCameraPreview: jest.fn(),
}));
jest.mock('../../src/icons.js', () => ({
  setIconContent: jest.fn(),
  applyCloseButtonIcons: jest.fn(),
}));
jest.mock('sortablejs', () => ({ create: jest.fn(() => ({ destroy: jest.fn() })) }));
jest.mock('../../src/ui-utils.js', () => ({
  showToast: jest.fn(),
  showConfirm: jest.fn().mockResolvedValue(false),
  showLoading: jest.fn(),
  setStatus: jest.fn(),
  applyTheme: jest.fn(),
  applyUiPreferences: jest.fn(),
  hexToRgb: jest.fn(() => null),
  miredsToKelvin: jest.fn(() => null),
  hasSupportedFeature: jest.fn(() => false),
  ...require('../helpers/ui-utils-dialogs').realDialogHelpers(),
}));
jest.mock('../../src/websocket.js', () => ({
  isConnected: jest.fn(() => true),
  callService: jest.fn().mockResolvedValue({}),
  request: jest.fn().mockResolvedValue({ result: {} }),
  on: jest.fn(),
  emit: jest.fn(),
}));

const i18n = require('../../src/i18n.js');
const ui = require('../../src/ui.js');
const state = require('../../src/state.js').default;
const websocket = require('../../src/websocket.js');

const weather = (id, name) => ({
  entity_id: id,
  state: 'sunny',
  attributes: { friendly_name: name },
});

describe('the weather picker', () => {
  beforeEach(() => {
    document.body.innerHTML = `
      <div id="weather-entities-list"></div>
      <span id="current-weather-name" data-i18n="None selected">None selected</span>
      <button id="clear-weather" type="button">Clear</button>`;
    state.setConfig({ homeAssistant: { url: 'http://ha.local', token: 'x' }, ui: {} });
    websocket.isConnected.mockReturnValue(true);
  });

  afterEach(() => i18n.setLocaleBootstrap({ activeLocale: 'en', messages: {} }));

  const name = () => document.getElementById('current-weather-name');
  const clear = () => document.getElementById('clear-weather');

  it('translates "None selected" with the rest of the dialog', () => {
    i18n.setLocaleBootstrap({
      activeLocale: 'de',
      messages: { 'None selected': 'Nichts ausgewählt' },
    });

    i18n.translateDocument(document);

    expect(name().textContent).toBe('Nichts ausgewählt');
  });

  it('says "None available" rather than "None selected" when Home Assistant has no weather', () => {
    state.setStates({});

    ui.populateWeatherEntitiesList();

    expect(name().textContent).toBe('None available');
    expect(name().dataset.state).toBe('none');
  });

  it('blames the connection only when the widget is not connected', () => {
    state.setStates({});

    ui.populateWeatherEntitiesList();
    expect(document.querySelector('.no-entities-message').textContent).toBe(
      'Home Assistant has no weather entities. Add a weather integration, then reopen this list.'
    );

    websocket.isConnected.mockReturnValue(false);
    ui.populateWeatherEntitiesList();
    expect(document.querySelector('.no-entities-message').textContent).toBe(
      "No weather entities available. Make sure you're connected to Home Assistant."
    );
  });

  it('names the chosen entity once, without repeating that it is selected', () => {
    // "Home ✓ (selected)" under a row already badged "✓ Selected" and a label saying "current".
    state.setStates({ 'weather.home': weather('weather.home', 'Home') });
    state.setConfig({ ...state.CONFIG, selectedWeatherEntity: 'weather.home' });

    ui.populateWeatherEntitiesList();

    expect(name().textContent).toBe('Home');
    expect(name().dataset.state).toBe('selected');
  });

  it('offers Clear only while an entity is chosen, without taking it out of the tab order', () => {
    state.setStates({ 'weather.home': weather('weather.home', 'Home') });

    ui.populateWeatherEntitiesList();
    expect(clear().getAttribute('aria-disabled')).toBe('true');
    expect(clear().disabled).toBe(false);

    state.setConfig({ ...state.CONFIG, selectedWeatherEntity: 'weather.home' });
    ui.populateWeatherEntitiesList();
    expect(clear().getAttribute('aria-disabled')).toBe('false');
  });

  it('keeps Clear in step when there are no weather entities at all', () => {
    state.setStates({});
    state.setConfig({ ...state.CONFIG, selectedWeatherEntity: 'weather.gone' });

    ui.populateWeatherEntitiesList();

    // The chosen entity is gone but still chosen, so it can still be cleared.
    expect(clear().getAttribute('aria-disabled')).toBe('false');
  });

  it('is a listbox the arrow keys walk, as one tab stop', () => {
    state.setStates({
      'weather.a': weather('weather.a', 'Alpha'),
      'weather.b': weather('weather.b', 'Beta'),
    });

    ui.populateWeatherEntitiesList();

    const options = [...document.querySelectorAll('#weather-entities-list [role="option"]')];
    expect(options.map((option) => option.tabIndex)).toEqual([0, -1]);
    options[0].focus();
    options[0].dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
    expect(document.activeElement).toBe(options[1]);
  });
});

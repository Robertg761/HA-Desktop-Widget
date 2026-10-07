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
    { value: 'off', label: 'Static icon (default)', intervalMs: 0 },
    { value: 'live', label: 'Live stream while visible (higher usage)', intervalMs: 0 },
    { value: '30s', label: 'Snapshot every 30 seconds (efficient)', intervalMs: 30000 },
    { value: '10s', label: 'Snapshot every 10 seconds', intervalMs: 10000 },
    { value: '5s', label: 'Snapshot every 5 seconds (frequent)', intervalMs: 5000 },
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
  return {
    showToast: jest.fn(),
    showConfirm: jest.fn().mockResolvedValue(false),
    showLoading: jest.fn(),
    setStatus: jest.fn(),
    ...require('../helpers/ui-utils-dialogs').realDialogHelpers(),
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
const uiUtils = require('../../src/ui-utils.js');
const { sampleConfig } = require('../fixtures/ha-data.js');

const entity = (entity_id, value, attributes = {}) => ({ entity_id, state: value, attributes });
const inputValue = (selector, value, root = document) => {
  const input = root.querySelector(selector);
  input.value = String(value);
  input.dispatchEvent(new Event('input', { bubbles: true }));
  return input;
};
const rangeClimate = () =>
  entity('climate.range', 'heat_cool', {
    current_temperature: 21,
    temperature: null,
    target_temp_low: 19,
    target_temp_high: 24,
    min_temp: 7,
    max_temp: 35,
    target_temp_step: 0.5,
    supported_features: 3,
    hvac_modes: ['heat', 'cool', 'heat_cool', 'off'],
  });

// Exercise actual DOM controls and outgoing services, including failures and rapid actions.
describe('User-facing audit regressions', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.spyOn(console, 'warn').mockImplementation(() => {});
    jest.spyOn(console, 'error').mockImplementation(() => {});
    jest.clearAllMocks();
    resetMockElectronAPI();
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
    state.setUnitSystem({ temperature: '°C' });
    mockCallService.mockReset().mockResolvedValue({ success: true });
    mockCallServiceWithResponse.mockReset().mockResolvedValue({});
    mockRequest.mockReset().mockResolvedValue({});
  });
  afterEach(() => {
    document.querySelector('#climate-close')?.click();
    jest.clearAllTimers();
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  describe('a pinned lock', () => {
    const pinLock = (value = 'locked') => {
      const lock = entity('lock.pin_door', value, { friendly_name: 'Back door' });
      state.setStates({ [lock.entity_id]: lock });
      ui.renderDesktopPinnedTile(lock.entity_id, lock);
      return document.querySelector('.desktop-pin-toggle-action');
    };
    const label = (button) => button.querySelector('.desktop-pin-panel-button-label').textContent;

    it('unlocks on the second press, not the first', async () => {
      const button = pinLock();
      expect(label(button)).toBe('Unlock');
      button.click();
      await jest.advanceTimersByTimeAsync(0);
      expect(mockCallService).not.toHaveBeenCalled();
      expect(label(button)).toBe('Confirm');
      expect(button.getAttribute('aria-label')).toBe('Confirm: Unlock Back door');
      button.click();
      await jest.advanceTimersByTimeAsync(0);
      expect(mockCallService).toHaveBeenCalledWith('lock', 'unlock', {
        entity_id: 'lock.pin_door',
      });
      expect(label(button)).toBe('Unlock');
    });

    it('goes back to Unlock when the second press does not come', async () => {
      const button = pinLock();
      button.click();
      await jest.advanceTimersByTimeAsync(4100);
      expect(label(button)).toBe('Unlock');
      expect(button.getAttribute('aria-label')).toBe('Unlock Back door');
      button.click();
      await jest.advanceTimersByTimeAsync(0);
      // That was a first press again.
      expect(mockCallService).not.toHaveBeenCalled();
    });

    it('keeps asking while the lock reports the same state, and stops when it changes', () => {
      const button = pinLock();
      button.click();
      const lock = entity('lock.pin_door', 'locked', { friendly_name: 'Back door' });
      ui.renderDesktopPinnedTile(lock.entity_id, lock);
      expect(label(button)).toBe('Confirm');
      const unlocked = { ...lock, state: 'unlocked' };
      state.setStates({ [lock.entity_id]: unlocked });
      ui.renderDesktopPinnedTile(lock.entity_id, unlocked);
      expect(label(button)).toBe('Lock');
    });

    it('locks in one press', async () => {
      const button = pinLock('unlocked');
      button.click();
      await jest.advanceTimersByTimeAsync(0);
      expect(mockCallService).toHaveBeenCalledWith('lock', 'lock', { entity_id: 'lock.pin_door' });
    });
  });

  it.each(['on', 'off'])('runs the automation Toggle hotkey while %s', (value) => {
    ui.executeHotkeyAction(entity('automation.audit', value), 'toggle');
    expect(mockCallService.mock.calls).toEqual([
      ['automation', 'toggle', { entity_id: 'automation.audit' }],
    ]);
  });

  it.each(['stop_cover', 'open_cover', 'close_cover'])(
    'cancels queued movement before %s',
    async (action) => {
      ui.openEntityDetailModal(
        entity('cover.audit', 'open', { current_position: 40, supported_features: 15 })
      );
      inputValue('#cover-slider', 80);
      document.querySelector(`[data-action="${action}"]`).click();
      await jest.advanceTimersByTimeAsync(400);
      expect(mockCallService.mock.calls.map((call) => call[1])).toEqual([action]);
    }
  );

  it('does not roll back a newer cover action when an earlier command fails', async () => {
    let rejectEarlier;
    mockCallService.mockImplementationOnce(
      () =>
        new Promise((_, reject) => {
          rejectEarlier = reject;
        })
    );
    ui.openEntityDetailModal(
      entity('cover.audit', 'open', { current_position: 40, supported_features: 15 })
    );
    inputValue('#cover-slider', 80);
    await jest.advanceTimersByTimeAsync(300);
    document.querySelector('[data-action="close_cover"]').click();
    await jest.advanceTimersByTimeAsync(0);
    rejectEarlier(new Error('Earlier movement failed'));
    await jest.advanceTimersByTimeAsync(0);
    expect(document.querySelector('#cover-position-value').textContent).toBe('0%');
  });

  it('writes the optimistic 0% and 100% the way the next state sync does', async () => {
    const i18n = require('../../src/i18n.js');
    i18n.setLocaleBootstrap({
      languageSetting: 'de',
      requestedLocale: 'de',
      activeLocale: 'de',
      messages: {},
    });
    try {
      // German puts a no-break space before the percent sign, so "0%" would flip to "0 %" later.
      const percent = (value) => `${value}\u00a0%`;
      ui.openEntityDetailModal(
        entity('cover.audit', 'open', { current_position: 40, supported_features: 15 })
      );
      document.querySelector('[data-action="open_cover"]').click();
      expect(document.querySelector('#cover-position-value').textContent).toBe(percent(100));
      document.querySelector('[data-action="close_cover"]').click();
      expect(document.querySelector('#cover-position-value').textContent).toBe(percent(0));
      await jest.advanceTimersByTimeAsync(400);

      ui.openEntityDetailModal(
        entity('light.audit', 'on', { brightness: 128, supported_color_modes: ['brightness'] })
      );
      document.querySelector('#turn-off-btn').click();
      expect(document.querySelector('#brightness-value-large').textContent).toBe(percent(0));
      await jest.advanceTimersByTimeAsync(400);
    } finally {
      i18n.setLocaleBootstrap({ activeLocale: 'en', languageSetting: 'en', messages: {} });
    }
  });

  it.each([
    ['#brightness-slider', 80],
    ['#light-color-temp-slider', 4000],
    ['#light-color-picker', '#ff0000'],
  ])('cancels %s changes before turning off', async (selector, value) => {
    ui.openEntityDetailModal(
      entity('light.audit', 'on', {
        brightness: 128,
        supported_color_modes: ['rgb', 'color_temp'],
        min_color_temp_kelvin: 2000,
        max_color_temp_kelvin: 6500,
      })
    );
    inputValue(selector, value);
    document.querySelector('#turn-off-btn').click();
    await jest.advanceTimersByTimeAsync(400);
    expect(mockCallService.mock.calls).toEqual([
      ['light', 'turn_off', { entity_id: 'light.audit' }],
    ]);
    expect(document.querySelector('#turn-off-btn').textContent).toBe('Turn on');
  });

  it('keeps the light off when an earlier brightness request rejects late', async () => {
    let rejectEarlier;
    mockCallService.mockImplementationOnce(
      () =>
        new Promise((_, reject) => {
          rejectEarlier = reject;
        })
    );
    ui.openEntityDetailModal(
      entity('light.audit', 'on', { brightness: 128, supported_color_modes: ['brightness'] })
    );
    inputValue('#brightness-slider', 80);
    await jest.advanceTimersByTimeAsync(120);
    document.querySelector('#turn-off-btn').click();
    await jest.advanceTimersByTimeAsync(0);
    rejectEarlier(new Error('Earlier brightness failed'));
    await jest.advanceTimersByTimeAsync(0);
    expect(document.querySelector('#brightness-value-large').textContent).toBe('0%');
    expect(document.querySelector('#turn-off-btn').textContent).toBe('Turn on');
  });

  it('offers only on/off controls for a binary light and sends no brightness', async () => {
    ui.openEntityDetailModal(
      entity('light.binary', 'on', { supported_color_modes: ['onoff'], supported_features: 0 })
    );
    expect(document.querySelector('#brightness-slider')).toBeNull();
    expect(document.querySelector('.brightness-preset-btn')).toBeNull();
    expect(document.querySelector('#brightness-value-large').textContent).toBe('On');
    document.querySelector('#turn-off-btn').click();
    await jest.advanceTimersByTimeAsync(0);
    expect(document.querySelector('#brightness-value-large').textContent).toBe('Off');
    document.querySelector('#turn-off-btn').click();
    await jest.advanceTimersByTimeAsync(0);
    expect(mockCallService.mock.calls).toEqual([
      ['light', 'turn_off', { entity_id: 'light.binary' }],
      ['light', 'turn_on', { entity_id: 'light.binary' }],
    ]);
  });

  it('renders and updates all sixteen entities and reaches the last tile by keyboard', () => {
    const ids = Array.from({ length: 16 }, (_, i) => `switch.audit_${i}`);
    state.setConfig({
      ...state.CONFIG,
      customTabs: [{ id: 'audit', name: 'Audit', entityIds: ids }],
      activeTabId: 'audit',
      favoriteEntities: ids,
    });
    state.setStates(Object.fromEntries(ids.map((id) => [id, entity(id, 'off')])));
    ui.renderActiveTab();
    const tiles = document.querySelectorAll('#quick-controls .control-item');
    expect(tiles).toHaveLength(16);
    expect(ui.isEntityVisible(ids[15])).toBe(true);
    tiles[0].focus();
    tiles[0].dispatchEvent(new KeyboardEvent('keydown', { key: 'End', bubbles: true }));
    expect(document.activeElement.dataset.entityId).toBe(ids[15]);
    const updated = entity(ids[15], 'on');
    state.setEntityState(updated);
    ui.updateEntityInUI(updated);
    expect(document.querySelector(`[data-entity-id="${ids[15]}"]`).dataset.active).toBe('true');
  });

  it.each(['Enter', ' '])('operates a primary switch with %s', async (key) => {
    const switchEntity = entity(`switch.keyboard_${key === 'Enter' ? 'enter' : 'space'}`, 'off');
    state.setConfig({ ...state.CONFIG, primaryCards: [switchEntity.entity_id, 'none'] });
    state.setStates({ [switchEntity.entity_id]: switchEntity });
    ui.renderPrimaryCards();
    const card = document.querySelector('[data-primary-card="true"]');
    expect(card.getAttribute('role')).toBe('button');
    expect(card.tabIndex).toBe(0);
    card.focus();
    expect(document.activeElement).toBe(card);
    card.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }));
    await jest.advanceTimersByTimeAsync(0);
    expect(mockCallService).toHaveBeenCalledWith('switch', 'turn_on', {
      entity_id: switchEntity.entity_id,
    });
  });

  it('opens primary light details with Shift+Enter without toggling', () => {
    const light = entity('light.keyboard', 'on', { brightness: 128 });
    state.setConfig({ ...state.CONFIG, primaryCards: [light.entity_id, 'none'] });
    state.setStates({ [light.entity_id]: light });
    ui.renderPrimaryCards();
    document
      .querySelector('[data-primary-card="true"]')
      .dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', shiftKey: true, bubbles: true }));
    expect(document.querySelector('#brightness-slider')).not.toBeNull();
    expect(mockCallService).not.toHaveBeenCalled();
  });

  it('never unlocks a primary lock card with Shift+Enter', async () => {
    const lock = entity('lock.front_door', 'locked');
    state.setConfig({ ...state.CONFIG, primaryCards: [lock.entity_id, 'none'] });
    state.setStates({ [lock.entity_id]: lock });
    ui.renderPrimaryCards();
    const card = document.querySelector('[data-primary-card="true"]');
    expect(card.getAttribute('aria-keyshortcuts')).toBe('Enter Space');
    card.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Enter', shiftKey: true, bubbles: true })
    );
    await jest.advanceTimersByTimeAsync(0);
    expect(mockCallService).not.toHaveBeenCalled();
  });

  it.each([
    ['lock.front_door', 'locked'],
    ['alarm_control_panel.home', 'armed_away'],
  ])('never toggles %s from a plain command palette result', async (entityId, entityState) => {
    const target = entity(entityId, entityState);
    state.setStates({ [entityId]: target });
    ui.openEntityDetailModal(target, { source: 'command-palette' });
    await jest.advanceTimersByTimeAsync(0);
    expect(mockCallService).not.toHaveBeenCalled();
  });

  it.each([
    ['switch.outlet', 'off'],
    ['input_boolean.guest_mode', 'on'],
  ])(
    'says what %s is now, and changes nothing, when the palette lists a command for it',
    async (entityId, entityState) => {
      const target = entity(entityId, entityState);
      state.setStates({ [entityId]: target });
      ui.openEntityDetailModal(target, { source: 'command-palette', hasCommand: true });
      await jest.advanceTimersByTimeAsync(0);
      // Enter on a search result is not a command, so no machine switches; the row beside it
      // ("Turn on ...") is what acts.
      expect(mockCallService).not.toHaveBeenCalled();
      expect(uiUtils.showToast).toHaveBeenCalledWith(expect.stringContaining(': '), 'info', 3000);
    }
  );

  it.each([
    ['button.restart', 'unknown', ['button', 'press']],
    ['input_button.doorbell', 'unknown', ['input_button', 'press']],
    ['timer.laundry', 'idle', ['timer', 'start']],
    ['automation.lights', 'on', ['automation', 'toggle']],
  ])(
    'still runs the action of %s, which the palette lists no command for',
    async (entityId, entityState, [domain, service]) => {
      const target = entity(entityId, entityState);
      state.setStates({ [entityId]: target });
      ui.openEntityDetailModal(target, { source: 'command-palette', hasCommand: false });
      await jest.advanceTimersByTimeAsync(0);
      // Nothing else in the palette reaches these, so the result is their command.
      expect(mockCallService).toHaveBeenCalledWith(domain, service, { entity_id: entityId });
      expect(uiUtils.showToast).not.toHaveBeenCalledWith(
        expect.stringContaining(': '),
        'info',
        3000
      );
    }
  );

  it('still runs the primary action when something other than the palette asks for it', async () => {
    const outlet = entity('switch.outlet', 'off');
    state.setStates({ [outlet.entity_id]: outlet });
    ui.openEntityDetailModal(outlet, { source: 'omarchy-bar' });
    await jest.advanceTimersByTimeAsync(0);
    expect(mockCallService).toHaveBeenCalled();
  });

  // The palette and the dashboard together: whether Enter on a result closes (hasEntityAction),
  // what it then does for a kind of device the palette has commands for (hasCommand), and what it
  // remembers, with nothing in between mocked. The palette keeps its dialog between opens, and the
  // body is rebuilt for every test here, so each test loads its own copy of the modules.
  describe('Enter on an entity result in the command palette', () => {
    const originalRequestAnimationFrame = global.requestAnimationFrame;
    const originalScrollIntoView = HTMLElement.prototype.scrollIntoView;
    let palette;
    let paletteState;
    let paletteToast;

    beforeEach(() => {
      global.requestAnimationFrame = (callback) => callback();
      HTMLElement.prototype.scrollIntoView = jest.fn();
      localStorage.clear();
      jest.isolateModules(() => {
        palette = require('../../src/command-palette.js');
        paletteToast = require('../../src/ui-utils.js').showToast;
        paletteState = require('../../src/state.js').default;
        paletteState.setConfig({
          ...sampleConfig,
          ui: { theme: 'dark' },
          favoriteEntities: [],
          customTabs: [],
          primaryCards: ['none', 'none'],
        });
        paletteState.setServices({ switch: { turn_on: {}, turn_off: {} } });
        paletteState.setStates({
          'switch.kettle': entity('switch.kettle', 'off', { friendly_name: 'Kettle' }),
          'switch.offline': entity('switch.offline', 'unavailable', {
            friendly_name: 'Offline plug',
          }),
          'switch.heater': entity('switch.heater', 'unknown', { friendly_name: 'Heater' }),
          'button.doorbell': entity('button.doorbell', 'unknown', { friendly_name: 'Doorbell' }),
          'sun.sun': entity('sun.sun', 'above_horizon', { friendly_name: 'Sun' }),
        });
      });
    });
    afterEach(() => {
      global.requestAnimationFrame = originalRequestAnimationFrame;
      HTMLElement.prototype.scrollIntoView = originalScrollIntoView;
    });

    const overlay = () => document.querySelector('.command-palette-overlay');
    const search = (query) => {
      palette.openCommandPalette();
      const input = document.querySelector('.command-palette-input');
      input.value = query;
      input.dispatchEvent(new Event('input'));
      return input;
    };
    const pressEnter = (input) =>
      input.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true })
      );
    const rowNames = () =>
      [...document.querySelectorAll('.command-palette-result-name')].map(
        (name) => name.textContent
      );

    it('says what a device with palette commands is now, and switches nothing', async () => {
      const input = search('Kettle');
      // The result for the device ranks above its Turn on row, which is what would act.
      expect(rowNames()).toEqual(['Kettle', 'Turn on Kettle']);
      pressEnter(input);
      await jest.advanceTimersByTimeAsync(0);

      expect(mockCallService).not.toHaveBeenCalled();
      expect(paletteToast).toHaveBeenCalledWith('Kettle: Off', 'info', 3000);
      expect(overlay().classList).toContain('hidden');
      // Looked up, so an empty search starts from it next time.
      palette.openCommandPalette();
      expect(rowNames()[0]).toBe('Kettle');
    });

    it.each([
      ['with the services loaded', true],
      ['before Home Assistant has sent its services', false],
    ])(
      'says what a switch whose state is unknown is, and switches nothing, %s',
      async (_when, servicesLoaded) => {
        if (!servicesLoaded) paletteState.setServices({});
        const input = search('Heater');
        // No Turn on or Turn off is listed for a state the palette cannot tell.
        expect(rowNames()).toEqual(['Heater']);
        pressEnter(input);
        await jest.advanceTimersByTimeAsync(0);

        expect(mockCallService).not.toHaveBeenCalled();
        expect(paletteToast).toHaveBeenCalledWith('Heater: Unknown', 'info', 3000);
        expect(overlay().classList).toContain('hidden');
      }
    );

    it('says what a switch is, and switches nothing, before Home Assistant has sent its services', async () => {
      paletteState.setServices({});
      const input = search('Kettle');
      expect(rowNames()).toEqual(['Kettle']);
      pressEnter(input);
      await jest.advanceTimersByTimeAsync(0);

      expect(mockCallService).not.toHaveBeenCalled();
      expect(paletteToast).toHaveBeenCalledWith('Kettle: Off', 'info', 3000);
    });

    it('still presses a button, which no palette command reaches', async () => {
      pressEnter(search('Doorbell'));
      await jest.advanceTimersByTimeAsync(0);

      expect(mockCallService).toHaveBeenCalledWith('button', 'press', {
        entity_id: 'button.doorbell',
      });
      expect(paletteToast).not.toHaveBeenCalledWith(expect.stringContaining(': '), 'info', 3000);
      expect(overlay().classList).toContain('hidden');
    });

    it.each([
      ['Sun', 'with nothing to open or run'],
      ['Offline plug', 'that is unavailable'],
    ])('stays open and says so for %s, %s', async (name) => {
      pressEnter(search(name));
      await jest.advanceTimersByTimeAsync(0);

      expect(mockCallService).not.toHaveBeenCalled();
      expect(paletteToast).not.toHaveBeenCalled();
      expect(overlay().classList).not.toContain('hidden');
      expect(document.querySelector('.command-palette-hint').textContent).toBe(
        `No command is available for ${name}.`
      );
      // Nothing happened, so nothing is remembered as used.
      expect(Object.values(localStorage)).toEqual([]);
    });
  });

  it('only advertises and runs Shift+Enter on Quick Access tiles with controls', async () => {
    const ids = ['lock.back_door', 'light.hall'];
    state.setConfig({
      ...state.CONFIG,
      customTabs: [{ id: 'keys', name: 'Keys', entityIds: ids }],
      activeTabId: 'keys',
      favoriteEntities: ids,
    });
    state.setStates({
      [ids[0]]: entity(ids[0], 'locked'),
      [ids[1]]: entity(ids[1], 'on', { brightness: 128 }),
    });
    ui.renderActiveTab();
    const lockTile = document.querySelector(`[data-entity-id="${ids[0]}"]`);
    const lightTile = document.querySelector(`[data-entity-id="${ids[1]}"]`);
    expect(lockTile.getAttribute('aria-keyshortcuts')).toBe('Enter Space');
    expect(lockTile.querySelector('.tile-details-button')).toBeNull();
    expect(lightTile.querySelector('.tile-primary-button').getAttribute('aria-keyshortcuts')).toBe(
      'Enter Space Shift+Enter'
    );

    lockTile.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Enter', shiftKey: true, bubbles: true })
    );
    await jest.advanceTimersByTimeAsync(0);
    expect(mockCallService).not.toHaveBeenCalled();

    lightTile
      .querySelector('.tile-primary-button')
      .dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', shiftKey: true, bubbles: true }));
    expect(document.querySelector('#brightness-slider')).not.toBeNull();
    expect(mockCallService).not.toHaveBeenCalled();
  });

  it.each([
    ['°F', {}, '74°F'],
    ['°C', {}, '74°C'],
    ['°F', { temperature_unit: '°C' }, '74°C'],
  ])('resolves climate units from %s and entity overrides', (unit, attributes, expected) => {
    state.setUnitSystem({ temperature: unit });
    ui.openEntityDetailModal(
      entity('climate.units', 'heat', {
        temperature: 74,
        current_temperature: 72,
        min_temp: 45,
        max_temp: 95,
        ...attributes,
      })
    );
    expect(document.querySelector('#climate-target-value').textContent).toBe(expected);
  });

  it.each([
    ['°F', '74°F'],
    ['°C', '74°C'],
    [undefined, '74°'],
  ])('prints the unit system the pin was given (%s) on a thermostat pin', (unit, expected) => {
    // Thermostats carry no unit attribute of their own, so the pin relies on Home Assistant's.
    state.setUnitSystem(unit ? { temperature: unit } : {});
    const climate = entity('climate.pin_units', 'heat', {
      temperature: 74,
      current_temperature: 72,
      min_temp: 45,
      max_temp: 95,
      supported_features: 1,
      hvac_modes: ['heat', 'off'],
    });
    state.setStates({ [climate.entity_id]: climate });
    ui.renderDesktopPinnedTile(climate.entity_id, climate);

    const root = document.querySelector('.desktop-pin-climate-control');
    expect(root.querySelector('.desktop-pin-climate-target-value').textContent).toBe(expected);
    expect(root.querySelector('.desktop-pin-climate-current-value').textContent).toBe(
      expected.replace('74', '72')
    );
  });

  it('edits both thermostat bounds in one range service call', async () => {
    ui.openEntityDetailModal(rangeClimate());
    expect(document.querySelector('#climate-slider')).toBeNull();
    inputValue('[data-climate-range="low"]', 20);
    inputValue('[data-climate-range="high"]', 25);
    expect(document.querySelector('#climate-target-value').textContent).toBe('20–25°C');
    await jest.advanceTimersByTimeAsync(300);
    expect(mockCallService.mock.calls).toEqual([
      [
        'climate',
        'set_temperature',
        { entity_id: 'climate.range', target_temp_low: 20, target_temp_high: 25 },
      ],
    ]);
  });

  it('prevents crossed thermostat bounds and restores both after rejection', async () => {
    mockCallService.mockRejectedValueOnce(new Error('Range rejected'));
    ui.openEntityDetailModal(rangeClimate());
    const low = inputValue('[data-climate-range="low"]', 30);
    expect(Number(low.value)).toBeLessThanOrEqual(24);
    await jest.advanceTimersByTimeAsync(300);
    expect(document.querySelector('[data-climate-range="low"]').value).toBe('19');
    expect(document.querySelector('[data-climate-range="high"]').value).toBe('24');
    expect(document.querySelector('#climate-target-value').textContent).toBe('19–24°C');
    expect(uiUtils.showToast).toHaveBeenCalled();
  });

  it('switches an open dialog from a single target to a range on a live mode update', () => {
    const heat = {
      ...rangeClimate(),
      state: 'heat',
      attributes: { ...rangeClimate().attributes, temperature: 21 },
    };
    state.setStates({ [heat.entity_id]: heat });
    ui.openEntityDetailModal(heat);
    expect(document.querySelector('#climate-slider')).not.toBeNull();
    const range = rangeClimate();
    state.setEntityState(range);
    ui.updateEntityInUI(range);
    expect(document.querySelectorAll('.climate-modal')).toHaveLength(1);
    expect(document.querySelector('#climate-slider')).toBeNull();
    expect(document.querySelectorAll('[data-climate-range]')).toHaveLength(2);
  });

  it('says each thermostat bound with its unit to a screen reader, in the dialog and the pin', () => {
    // A bare "21" for the heating and cooling targets, where the single target says "21 °C".
    ui.openEntityDetailModal(rangeClimate());
    const valueText = (root, bound) =>
      root.querySelector(`[data-climate-range="${bound}"]`).getAttribute('aria-valuetext');
    expect(valueText(document, 'low')).toBe('19°C');
    expect(valueText(document, 'high')).toBe('24°C');
    inputValue('[data-climate-range="low"]', 20.5);
    expect(valueText(document, 'low')).toBe('20.5°C');
    document.querySelector('#climate-close').click();

    const climate = rangeClimate();
    state.setStates({ [climate.entity_id]: climate });
    ui.renderDesktopPinnedTile(climate.entity_id, climate);
    const pin = document.querySelector('.desktop-pin-climate-control');
    expect(valueText(pin, 'low')).toBe('19°C');
    expect(valueText(pin, 'high')).toBe('24°C');
  });

  it('cancels pending range changes when the dialog closes', async () => {
    ui.openEntityDetailModal(rangeClimate());
    inputValue('[data-climate-range="low"]', 20);
    document.querySelector('#climate-close').click();
    await jest.advanceTimersByTimeAsync(400);
    expect(mockCallService).not.toHaveBeenCalled();
  });

  it('provides range controls in a desktop pin and keeps draft values across live updates', async () => {
    const climate = rangeClimate();
    state.setStates({ [climate.entity_id]: climate });
    ui.renderDesktopPinnedTile(climate.entity_id, climate);
    const root = document.querySelector('.desktop-pin-climate-control');
    expect(root).not.toBeNull();
    inputValue('[data-climate-range="low"]', 20, root);
    ui.updateEntityInUI({
      ...climate,
      attributes: { ...climate.attributes, current_temperature: 22 },
    });
    // A range pin prints its range in the header, beside the name.
    expect(root.querySelector('.desktop-pin-climate-kpi').textContent).toBe('20–24°C');
    await jest.advanceTimersByTimeAsync(300);
    expect(mockCallService).toHaveBeenCalledWith('climate', 'set_temperature', {
      entity_id: climate.entity_id,
      target_temp_low: 20,
      target_temp_high: 24,
    });
  });

  it('shows a to-do load error and retries without claiming the list is empty', async () => {
    mockCallServiceWithResponse.mockRejectedValueOnce(new Error('Offline')).mockResolvedValueOnce({
      'todo.retry': { items: [{ uid: 'one', summary: 'Milk', status: 'needs_action' }] },
    });
    ui.openEntityDetailModal(entity('todo.retry', '4'));
    await jest.advanceTimersByTimeAsync(0);
    const list = document.querySelector('.todo-detail-list-container');
    expect(list.textContent).toContain('Unable to load items');
    expect(list.textContent).not.toContain('No active items');
    list.querySelector('button').click();
    await jest.advanceTimersByTimeAsync(0);
    expect(list.textContent).toContain('Milk');
    expect(list.querySelector('[role="alert"]')).toBeNull();
  });

  it('keeps focus in the to-do dialog after Retry and after ticking an item', async () => {
    mockCallServiceWithResponse
      .mockRejectedValueOnce(new Error('Offline'))
      .mockResolvedValueOnce({
        'todo.focus': {
          items: [
            { uid: 'one', summary: 'Milk', status: 'needs_action' },
            { uid: 'two', summary: 'Eggs', status: 'needs_action' },
          ],
        },
      })
      .mockResolvedValueOnce({
        'todo.focus': {
          items: [
            { uid: 'one', summary: 'Milk', status: 'needs_action' },
            { uid: 'two', summary: 'Eggs', status: 'completed' },
          ],
        },
      });
    ui.openEntityDetailModal(entity('todo.focus', '2', { supported_features: 5 }));
    await jest.advanceTimersByTimeAsync(0);
    const list = document.querySelector('.todo-detail-list-container');
    const retry = list.querySelector('button');
    retry.focus();
    retry.click();
    await jest.advanceTimersByTimeAsync(0);
    expect(document.activeElement).toBe(list.querySelector('input[data-uid="one"]'));

    const eggs = list.querySelector('input[data-uid="two"]');
    eggs.focus();
    eggs.click();
    await jest.advanceTimersByTimeAsync(0);
    expect(mockCallService).toHaveBeenCalledWith('todo', 'update_item', {
      entity_id: 'todo.focus',
      item: 'two',
      status: 'completed',
    });
    const refreshed = list.querySelector('input[data-uid="two"]');
    expect(refreshed).not.toBe(eggs);
    expect(refreshed.checked).toBe(true);
    expect(document.activeElement).toBe(refreshed);
  });

  it('keeps focus on the picked weather entity after the list is rebuilt', async () => {
    document.body.insertAdjacentHTML(
      'beforeend',
      '<div id="weather-entities-list"></div><span id="current-weather-name"></span>'
    );
    state.setStates({
      'weather.home': entity('weather.home', 'sunny'),
      'weather.work': entity('weather.work', 'rainy'),
    });
    ui.populateWeatherEntitiesList();
    const list = document.getElementById('weather-entities-list');
    const findWork = () =>
      [...list.querySelectorAll('.entity-item')].find((item) =>
        item.textContent.includes('weather.work')
      );
    const work = findWork();
    work.focus();
    work.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    await jest.advanceTimersByTimeAsync(0);
    const rebuilt = findWork();
    expect(rebuilt).not.toBe(work);
    expect(rebuilt.getAttribute('aria-selected')).toBe('true');
    expect(document.activeElement).toBe(rebuilt);
  });

  it('does not repeat a successful add when only the subsequent refresh fails', async () => {
    mockCallServiceWithResponse
      .mockResolvedValueOnce({ 'todo.add': { items: [] } })
      .mockRejectedValueOnce(new Error('Refresh failed'))
      .mockResolvedValueOnce({
        'todo.add': { items: [{ uid: 'one', summary: 'Milk', status: 'needs_action' }] },
      });
    ui.openEntityDetailModal(entity('todo.add', '0', { supported_features: 5 }));
    await jest.advanceTimersByTimeAsync(0);
    const form = document.querySelector('.todo-add-form');
    form.querySelector('input').value = 'Milk';
    form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    await jest.advanceTimersByTimeAsync(0);
    expect(document.querySelector('.todo-detail-list-container').textContent).toContain(
      'Unable to load items'
    );
    document.querySelector('.todo-detail-list-container button').click();
    await jest.advanceTimersByTimeAsync(0);
    expect(mockCallService.mock.calls).toEqual([
      ['todo', 'add_item', { entity_id: 'todo.add', item: 'Milk' }],
    ]);
    expect(document.querySelector('.todo-detail-list-container').textContent).toContain('Milk');
  });

  // The agenda says the day the way the tiles do (Today, Tomorrow, Thu, Oct 12), not as an all-numeric
  // date, so these read the same whatever day the tests run on.
  it.each([
    ['2026-09-08', '2026-09-09', 'Today · All day'],
    ['2026-09-09', '2026-09-10', 'Tomorrow · All day'],
    ['2026-09-10', '2026-09-11', 'Thu · All day'],
    [{ date: '2026-09-10' }, { date: '2026-09-13' }, 'Thu – Sat · All day'],
    ['2026-03-08', '2026-03-10', 'Mar 8 – Mar 9 · All day'],
  ])('preserves all-day calendar dates and the exclusive end', async (start, end, expected) => {
    jest.setSystemTime(new Date(2026, 8, 8, 9, 0));
    mockCallServiceWithResponse.mockResolvedValue({
      'calendar.dates': { events: [{ summary: 'All day', start, end }] },
    });
    ui.openEntityDetailModal(entity('calendar.dates', 'on'));
    await jest.advanceTimersByTimeAsync(0);
    expect(document.querySelector('.calendar-event-time').textContent).toBe(expected);
  });
  it.each([
    ['2026-09-22T14:00:00', '2026-09-22T15:00:00', 'Today 2:00 PM – 3:00 PM'],
    ['2026-09-23T08:00:00', '2026-09-23T09:00:00', 'Tomorrow 8:00 AM – 9:00 AM'],
    ['2026-09-24T14:30:45', '2026-09-24T15:15:00', 'Thu 2:30 PM – 3:15 PM'],
    ['2026-09-24T22:00:00', '2026-09-25T01:30:00', 'Thu 10:00 PM – Fri 1:30 AM'],
    ['2026-10-12T10:00:00', '2026-10-12T11:00:00', 'Oct 12, 10:00 AM – 11:00 AM'],
  ])(
    'shows timed calendar events in minutes, with one day label per day',
    async (start, end, expected) => {
      jest.setSystemTime(new Date(2026, 8, 22, 9, 0));
      mockCallServiceWithResponse.mockResolvedValue({
        'calendar.times': { events: [{ summary: 'Meeting', start, end }] },
      });
      ui.openEntityDetailModal(entity('calendar.times', 'on'));
      await jest.advanceTimersByTimeAsync(0);
      expect(document.querySelector('.calendar-event-time').textContent).toBe(expected);
    }
  );

  // A pin control is built once and reused for every later update, so its buttons must act on the
  // entity Home Assistant reports now, not the one the control was created with.
  describe('desktop pin select and number buttons', () => {
    const pushUpdate = (updated) => {
      state.setEntityState(updated);
      ui.renderDesktopPinnedTile(updated.entity_id, updated);
    };

    it('keeps stepping through a select pin as its state updates', async () => {
      const select = entity('input_select.pin_mode', 'A', { options: ['A', 'B', 'C', 'D'] });
      state.setStates({ [select.entity_id]: select });
      ui.renderDesktopPinnedTile(select.entity_id, select);
      const next = () => document.querySelector('.desktop-pin-enum-step[data-action="next"]');

      next().click();
      await jest.advanceTimersByTimeAsync(200);
      pushUpdate({ ...select, state: 'B' });
      await jest.advanceTimersByTimeAsync(600);
      next().click();
      await jest.advanceTimersByTimeAsync(200);

      expect(mockCallService.mock.calls.map((call) => call[2].option)).toEqual(['B', 'C']);
    });

    it('steps back from the current option, not the one the pin was built with', async () => {
      const select = entity('input_select.pin_back', 'A', { options: ['A', 'B', 'C'] });
      state.setStates({ [select.entity_id]: select });
      ui.renderDesktopPinnedTile(select.entity_id, select);
      pushUpdate({ ...select, state: 'C' });

      document.querySelector('.desktop-pin-enum-step[data-action="previous"]').click();
      await jest.advanceTimersByTimeAsync(200);

      expect(mockCallService.mock.calls.map((call) => call[2].option)).toEqual(['B']);
    });

    it('keeps stepping an unbounded number pin as its state updates', async () => {
      const number = entity('input_number.pin_count', '5', { step: 2 });
      state.setStates({ [number.entity_id]: number });
      ui.renderDesktopPinnedTile(number.entity_id, number);
      const step = (action) =>
        document.querySelector(`.desktop-pin-numeric-step[data-action="${action}"]`);

      step('increase').click();
      await jest.advanceTimersByTimeAsync(200);
      pushUpdate({ ...number, state: '7' });
      await jest.advanceTimersByTimeAsync(600);
      step('increase').click();
      await jest.advanceTimersByTimeAsync(200);
      step('decrease').click();
      await jest.advanceTimersByTimeAsync(600);

      expect(mockCallService.mock.calls.map((call) => call[2].value)).toEqual([7, 9, 7]);
    });

    it('draws the decrease button with a real minus sign', () => {
      const number = entity('input_number.pin_minus', '5', { step: 1 });
      state.setStates({ [number.entity_id]: number });
      ui.renderDesktopPinnedTile(number.entity_id, number);

      expect(
        document
          .querySelector('.desktop-pin-numeric-step[data-action="decrease"]')
          .textContent.trim()
      ).toBe('\u2212');
    });
  });

  describe('desktop pin controls after a failed command', () => {
    it('restores the light preset to the real brightness', async () => {
      const light = entity('light.pin_fail', 'on', {
        brightness: 128,
        supported_color_modes: ['brightness'],
      });
      state.setStates({ [light.entity_id]: light });
      ui.renderDesktopPinnedTile(light.entity_id, light);
      const root = document.querySelector('.desktop-pin-light-control');
      mockCallService.mockRejectedValueOnce(new Error('Light rejected'));

      document.querySelector('.desktop-pin-light-preset[data-brightness="75"]').click();
      expect(root.querySelector('.desktop-pin-light-meter-value').textContent).toBe('75%');
      await jest.advanceTimersByTimeAsync(300);

      expect(root.querySelector('.desktop-pin-light-meter-value').textContent).toBe('50%');
      expect(root.querySelector('.desktop-pin-light-slider').value).toBe('50');
      expect(uiUtils.showToast).toHaveBeenCalled();
    });

    it('restores the cover to its real position', async () => {
      const cover = entity('cover.pin_fail', 'closed', {
        current_position: 0,
        supported_features: 15,
      });
      state.setStates({ [cover.entity_id]: cover });
      ui.renderDesktopPinnedTile(cover.entity_id, cover);
      const root = document.querySelector('.desktop-pin-cover-control');
      mockCallService.mockRejectedValueOnce(new Error('Cover rejected'));

      document.querySelector('.desktop-pin-cover-action[data-action="open_cover"]').click();
      expect(root.querySelector('.desktop-pin-cover-slider').value).toBe('100');
      await jest.advanceTimersByTimeAsync(50);

      expect(root.querySelector('.desktop-pin-cover-slider').value).toBe('0');
      expect(root.dataset.state).toBe('closed');
    });

    it('restores the thermostat mode to the real mode', async () => {
      const climate = entity('climate.pin_fail', 'heat', {
        current_temperature: 21,
        temperature: 22,
        min_temp: 7,
        max_temp: 35,
        target_temp_step: 0.5,
        supported_features: 1,
        hvac_modes: ['heat', 'cool', 'off'],
      });
      state.setStates({ [climate.entity_id]: climate });
      ui.renderDesktopPinnedTile(climate.entity_id, climate);
      const root = document.querySelector('.desktop-pin-climate-control');
      mockCallService.mockRejectedValueOnce(new Error('Mode rejected'));
      const activeMode = () =>
        root.querySelector(
          '.desktop-pin-climate-mode[aria-pressed="true"], .desktop-pin-climate-mode[data-active="true"]'
        )?.dataset.mode;
      expect(activeMode()).toBe('heat');

      root.querySelector('.desktop-pin-climate-mode[data-mode="cool"]').click();
      await jest.advanceTimersByTimeAsync(50);

      expect(activeMode()).toBe('heat');
    });

    it('restores a number pin to its real value', async () => {
      const number = entity('input_number.pin_fail', '5', { step: 1 });
      state.setStates({ [number.entity_id]: number });
      ui.renderDesktopPinnedTile(number.entity_id, number);
      const root = document.querySelector('.desktop-pin-numeric-control');
      mockCallService.mockRejectedValueOnce(new Error('Number rejected'));

      root.querySelector('.desktop-pin-numeric-step[data-action="increase"]').click();
      expect(root.querySelector('.desktop-pin-panel-value').textContent).toBe('6');
      await jest.advanceTimersByTimeAsync(200);

      expect(root.querySelector('.desktop-pin-panel-value').textContent).toBe('5');
    });
  });

  describe('media tile text tooltips', () => {
    const mediaPlayer = (attributes) => entity('media_player.tile_text', 'playing', attributes);
    const renderTile = (player) => {
      state.setConfig({ ...state.CONFIG, favoriteEntities: [player.entity_id] });
      state.setStates({ [player.entity_id]: player });
      ui.renderActiveTab();
      return document.querySelector(`[data-entity-id="${player.entity_id}"]`);
    };
    const longTitle = 'A very long track title that cannot possibly fit inside the tile pill';

    it('gives the title and artist the full text as a tooltip', () => {
      const tile = renderTile(
        mediaPlayer({
          media_title: longTitle,
          media_artist: 'The Artist & Co',
          friendly_name: 'TV',
        })
      );

      expect(tile.querySelector('.media-title').title).toBe(longTitle);
      expect(tile.querySelector('.media-artist').title).toBe('The Artist & Co');
      expect(tile.querySelector('.media-artist').textContent).toBe('The Artist & Co');
    });

    it('shows the album, with its tooltip, when there is no artist', () => {
      const tile = renderTile(
        mediaPlayer({ media_title: 'Song', media_album_name: 'The "Album"', friendly_name: 'TV' })
      );

      expect(tile.querySelector('.media-album').title).toBe('The "Album"');
    });

    it('keeps the tooltips current when the track changes', () => {
      const player = mediaPlayer({
        media_title: 'First',
        media_artist: 'One',
        friendly_name: 'TV',
      });
      renderTile(player);

      const next = mediaPlayer({
        media_title: longTitle,
        media_artist: 'Two',
        friendly_name: 'TV',
      });
      state.setEntityState(next);
      ui.updateEntityInUI(next);

      const tile = document.querySelector(`[data-entity-id="${player.entity_id}"]`);
      expect(tile.querySelector('.media-title').title).toBe(longTitle);
      expect(tile.querySelector('.media-title').textContent).toBe(longTitle);
      expect(tile.querySelector('.media-artist').title).toBe('Two');
    });
  });

  it('cancels pending movement when Stop is pressed on a desktop pin', async () => {
    const cover = entity('cover.pin_stop', 'open', {
      current_position: 40,
      supported_features: 15,
    });
    state.setStates({ [cover.entity_id]: cover });
    ui.renderDesktopPinnedTile(cover.entity_id, cover);
    inputValue('.desktop-pin-cover-slider', 80);
    document.querySelector('.desktop-pin-cover-action[data-action="stop_cover"]').click();
    await jest.advanceTimersByTimeAsync(400);
    expect(mockCallService.mock.calls).toEqual([
      ['cover', 'stop_cover', { entity_id: cover.entity_id }],
    ]);
  });
  it('cancels pending brightness when a desktop pin light is switched off', async () => {
    const light = entity('light.pin_stop', 'on', {
      brightness: 128,
      supported_color_modes: ['brightness'],
    });
    state.setStates({ [light.entity_id]: light });
    ui.renderDesktopPinnedTile(light.entity_id, light);
    inputValue('.desktop-pin-light-slider', 80);
    document.querySelector('.desktop-pin-light-power').click();
    await jest.advanceTimersByTimeAsync(400);
    expect(mockCallService.mock.calls).toEqual([
      ['light', 'turn_off', { entity_id: light.entity_id }],
    ]);
  });
  it.each(['Enter', ' '])(
    'retains primary-card focus and activates once with %s after a state change',
    (key) => {
      const light = entity('light.primary_focus', 'off', { brightness: 128 });
      state.setConfig({ ...state.CONFIG, primaryCards: [light.entity_id, 'none'] });
      state.setStates({ [light.entity_id]: light });
      ui.renderPrimaryCards();
      const primary = document.querySelector('[data-primary-card="true"] .tile-primary-button');
      primary.focus();
      expect(document.activeElement).toBe(primary);
      const updated = { ...light, state: 'on' };
      state.setEntityState(updated);
      ui.updateEntityInUI(updated);
      const focused = document.activeElement;
      expect(focused.classList.contains('tile-primary-button')).toBe(true);
      expect(focused.closest('[data-primary-card="true"]').dataset.entityId).toBe(light.entity_id);
      expect(focused.tabIndex).toBe(0);
      {
        mockCallService.mockClear();
        const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true });
        focused.dispatchEvent(event);
        expect(event.defaultPrevented).toBe(true); // Suppress the native click: exactly one activation.
        expect(mockCallService).toHaveBeenCalledTimes(1);
        expect(mockCallService.mock.calls[0][2].entity_id).toBe(light.entity_id);
      }
    }
  );
});

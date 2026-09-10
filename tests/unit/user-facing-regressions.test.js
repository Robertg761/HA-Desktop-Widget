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
    expect(document.querySelector('#turn-off-btn').textContent).toBe('Turn On');
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
    expect(document.querySelector('#turn-off-btn').textContent).toBe('Turn On');
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
    expect(root.querySelector('.desktop-pin-climate-target-value').textContent).toBe('20–24°C');
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

  it('does not repeat a successful add when only the subsequent refresh fails', async () => {
    mockCallServiceWithResponse
      .mockResolvedValueOnce({ 'todo.add': { items: [] } })
      .mockRejectedValueOnce(new Error('Refresh failed'))
      .mockResolvedValueOnce({
        'todo.add': { items: [{ uid: 'one', summary: 'Milk', status: 'needs_action' }] },
      });
    ui.openEntityDetailModal(entity('todo.add', '0'));
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

  it.each([
    ['2026-09-10', '2026-09-11', '9/10/2026 · All day'],
    [{ date: '2026-09-10' }, { date: '2026-09-13' }, '9/10/2026 - 9/12/2026 · All day'],
    ['2026-03-08', '2026-03-10', '3/8/2026 - 3/9/2026 · All day'],
  ])('preserves all-day calendar dates and the exclusive end', async (start, end, expected) => {
    mockCallServiceWithResponse.mockResolvedValue({
      'calendar.dates': { events: [{ summary: 'All day', start, end }] },
    });
    ui.openEntityDetailModal(entity('calendar.dates', 'on'));
    await jest.advanceTimersByTimeAsync(0);
    expect(document.querySelector('.calendar-event-time').textContent).toBe(expected);
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
  it('retains primary-card keyboard focus when a light changes state', () => {
    const light = entity('light.primary_focus', 'off', { brightness: 128 });
    state.setConfig({ ...state.CONFIG, primaryCards: [light.entity_id, 'none'] });
    state.setStates({ [light.entity_id]: light });
    ui.renderPrimaryCards();
    document.querySelector('[data-primary-card="true"]').focus();
    const updated = { ...light, state: 'on' };
    state.setEntityState(updated);
    ui.updateEntityInUI(updated);
    expect(document.activeElement.dataset.entityId).toBe(light.entity_id);
    expect(document.activeElement.tabIndex).toBe(0);
  });
});

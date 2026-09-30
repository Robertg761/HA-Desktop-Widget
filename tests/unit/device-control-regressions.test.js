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
const { sampleConfig } = require('../fixtures/ha-data.js');
const i18n = require('../../src/i18n.js');
const entity = (entity_id, value, attributes = {}) => ({ entity_id, state: value, attributes });
const renderTiles = (states) => {
  const ids = states.map((item) => item.entity_id);
  state.setConfig({
    ...state.CONFIG,
    customTabs: [{ id: 'polish', name: 'Polish', entityIds: ids }],
    activeTabId: 'polish',
    favoriteEntities: ids,
  });
  state.setStates(Object.fromEntries(states.map((item) => [item.entity_id, item])));
  ui.renderActiveTab();
};
const tile = (entityId) => document.querySelector(`#quick-controls [data-entity-id="${entityId}"]`);
const liveUpdate = (next) => {
  state.setEntityState(next);
  ui.updateEntityInUI(next);
};

describe('device control and live data regressions', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.clearAllMocks();
    resetMockElectronAPI();
    i18n.setLocaleBootstrap({ activeLocale: 'en-US', messages: {} });
    state.setConfig({
      ...sampleConfig,
      ui: { theme: 'dark' },
      primaryCards: ['none', 'none'],
      customTabs: [],
      favoriteEntities: [],
    });
    state.setStates({});
    ui.ensureEntityCacheScope({ force: true });
    mockCallService.mockResolvedValue({ success: true });
    mockCallServiceWithResponse.mockResolvedValue({
      success: true,
      result: {
        response: {
          'todo.readonly': {
            items: [{ uid: 'one', summary: 'Read only', status: 'needs_action' }],
          },
        },
      },
    });
    document.body.innerHTML = '<div id="quick-controls"></div>';
  });
  afterEach(() => {
    document.querySelectorAll('.modal .close-btn').forEach((button) => button.click());
    jest.clearAllTimers();
    jest.useRealTimers();
  });
  test('media detail disables all controls when player becomes unavailable', () => {
    const player = entity('media_player.audit', 'playing', {
      supported_features: 16445,
      volume_level: 0.5,
    });
    state.setEntityState(player);
    ui.openEntityControls(player);
    jest.advanceTimersByTime(20);
    state.setEntityState({ ...player, state: 'unavailable' });
    const modal = document.querySelector('.media-modal');
    expect(
      [...modal.querySelectorAll('.modal-body input,.modal-body button')].filter((e) => !e.disabled)
    ).toHaveLength(0);
  });
  test.each(['number', 'input_number'])(
    '%s opens bounds-aware controls and sends a numeric zero',
    async (domain) => {
      const helper = entity(`${domain}.audit`, '3', { min: 0, max: 10, step: 1 });
      state.setServices({ [domain]: { set_value: {} } });
      renderTiles([helper]);
      tile(helper.entity_id).click();
      const input = document.querySelector('.helper-controls-modal input');
      expect(input.min).toBe('0');
      expect(input.max).toBe('10');
      input.value = '0';
      document
        .querySelector('.helper-controls-modal form')
        .dispatchEvent(new Event('submit', { cancelable: true }));
      expect(mockCallService).toHaveBeenCalledWith(domain, 'set_value', {
        entity_id: helper.entity_id,
        value: 0,
      });
      await Promise.resolve();
      liveUpdate({ ...helper, state: 'unavailable' });
      expect(input.disabled).toBe(true);
    }
  );
  test.each(['select', 'input_select'])(
    '%s controls reject a removed option and follow live options',
    (domain) => {
      const helper = entity(`${domain}.audit`, 'Auto', { options: ['Auto', 'Quiet'] });
      state.setServices({ [domain]: { select_option: {} } });
      renderTiles([helper]);
      tile(helper.entity_id).click();
      const input = document.querySelector('.helper-controls-modal select');
      input.value = 'Quiet';
      document
        .querySelector('.helper-controls-modal form')
        .dispatchEvent(new Event('submit', { cancelable: true }));
      expect(mockCallService).toHaveBeenCalledWith(domain, 'select_option', {
        entity_id: helper.entity_id,
        option: 'Quiet',
      });
      liveUpdate({ ...helper, attributes: { options: ['Auto'] } });
      expect([...input.options].map((option) => option.value)).toEqual(['Auto']);
    }
  );
  test('vacuum exposes only entity-supported services and stops accepting actions while unavailable', () => {
    const robot = entity('vacuum.audit', 'docked', { supported_features: 8192 });
    state.setServices({ vacuum: { start: {}, pause: {}, return_to_base: {} } });
    renderTiles([robot]);
    tile(robot.entity_id).click();
    const body = document.querySelector('.helper-controls-modal .modal-body');
    expect([...body.querySelectorAll('button')].map((button) => button.textContent)).toEqual([
      'Start',
    ]);
    const oldButton = body.querySelector('button');
    liveUpdate({ ...robot, state: 'unavailable' });
    oldButton.click();
    expect(mockCallService).not.toHaveBeenCalled();
    expect(body.querySelector('button').disabled).toBe(true);
  });
  test('unsupported tiles keep a read-only role and truthful tooltip after a live update', () => {
    const item = entity('binary_sensor.audit', 'off');
    renderTiles([item]);
    expect(tile(item.entity_id).getAttribute('role')).toBe('group');
    expect(tile(item.entity_id).title).not.toMatch(/toggle/);
    expect(tile(item.entity_id).hasAttribute('aria-keyshortcuts')).toBe(false);
    liveUpdate({ ...item, state: 'on' });
    tile(item.entity_id).click();
    expect(tile(item.entity_id).title).not.toMatch(/toggle/);
    expect(mockCallService).not.toHaveBeenCalled();
  });
  test('tile state is included in its accessible description and stays current', () => {
    const light = entity('light.audit', 'off');
    renderTiles([light]);
    const target = tile(light.entity_id).querySelector('.tile-primary-button');
    const readout = document.getElementById(target.getAttribute('aria-describedby'));
    expect(readout.textContent).toBe('Off');
    liveUpdate({ ...light, state: 'on' });
    // The update may replace the tile, so read the description from the tile now on screen.
    const current = tile(light.entity_id).querySelector('.tile-primary-button');
    expect(document.getElementById(current.getAttribute('aria-describedby')).textContent).toBe(
      'On'
    );
  });
  test('a primary card and a tile for the same entity describe themselves with their own readout', () => {
    const light = entity('light.audit', 'off');
    document.body.innerHTML +=
      '<div class="status-grid"><div id="weather-card"></div><div id="time-card"></div></div>';
    renderTiles([light]);
    state.setConfig({ ...state.CONFIG, primaryCards: [light.entity_id, 'none'] });
    ui.renderPrimaryCards();
    const controls = [
      ...document.querySelectorAll(`.control-item[data-entity-id="${light.entity_id}"]`),
    ];
    expect(controls).toHaveLength(2);
    const readoutIds = controls.map((control) => {
      const target = control.querySelector('.tile-primary-button') || control;
      const id = target.getAttribute('aria-describedby');
      expect(control.querySelector(`[id="${id}"]`)).not.toBeNull();
      return id;
    });
    expect(new Set(readoutIds).size).toBe(2);
    expect(document.querySelectorAll(`[id="${readoutIds[0]}"]`)).toHaveLength(1);
  });
  test('calendar explains the date window and retries after an error', async () => {
    const calendar = entity('calendar.audit', 'off');
    state.setEntityState(calendar);
    mockCallServiceWithResponse
      .mockRejectedValueOnce(new Error('Offline'))
      .mockResolvedValueOnce({ 'calendar.audit': { events: [] } });
    ui.openEntityControls(calendar);
    await Promise.resolve();
    await Promise.resolve();
    const body = document.querySelector('.calendar-modal .modal-body');
    expect(body.textContent).toContain('next 7 days');
    expect(body.querySelector('button').textContent).toBe('Retry');
    body.querySelector('button').click();
    await Promise.resolve();
    await Promise.resolve();
    expect(mockCallServiceWithResponse).toHaveBeenCalledTimes(2);
    expect(body.textContent).toContain('No upcoming events');
    expect(body.querySelector('button').textContent).toBe('Refresh');
  });
  test('large entity picker renders 50 rows at a time and searches across all pages', () => {
    document.body.innerHTML +=
      '<input id="quick-controls-search"><div id="quick-controls-list"></div>';
    state.setStates(
      Object.fromEntries(
        Array.from({ length: 5000 }, (_, index) => {
          const id = `sensor.audit_${String(index).padStart(4, '0')}`;
          return [id, entity(id, '1')];
        })
      )
    );
    ui.populateQuickControlsList();
    expect(document.querySelectorAll('#quick-controls-list .entity-item')).toHaveLength(50);
    document.querySelector('#quick-controls-pagination button:last-child').click();
    expect(document.querySelector('#quick-controls-list .entity-id').textContent).toBe(
      'sensor.audit_0050'
    );
    const search = document.getElementById('quick-controls-search');
    search.value = 'audit_4999';
    search.dispatchEvent(new Event('input'));
    jest.advanceTimersByTime(150);
    expect(document.querySelectorAll('#quick-controls-list .entity-item')).toHaveLength(1);
    expect(document.querySelector('#quick-controls-list .entity-id').textContent).toBe(
      'sensor.audit_4999'
    );
  });
  test('alarm prompt cancels on Escape and clears its secret field', async () => {
    const pending = ui.requestAlarmCode(
      entity('alarm_control_panel.audit', 'armed_home', { code_format: 'number' })
    );
    const modal = document.querySelector('.alarm-code-modal');
    const input = modal.querySelector('input');
    input.value = '1234';
    modal.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(await pending).toBeNull();
    expect(input.value).toBe('');
  });
  test('alarm prompt requires numeric code when specified and returns it only on submit', async () => {
    const pending = ui.requestAlarmCode(
      entity('alarm_control_panel.audit', 'disarmed', { code_format: 'number' })
    );
    const modal = document.querySelector('.alarm-code-modal');
    const input = modal.querySelector('input');
    input.value = 'bad';
    expect(input.checkValidity()).toBe(false);
    input.value = '0123';
    modal.querySelector('form').dispatchEvent(new Event('submit', { cancelable: true }));
    expect(await pending).toBe('0123');
    expect(input.value).toBe('');
  });
  test('primary media refuses commands for a player with no supported playback features', () => {
    const player = entity('media_player.audit', 'idle', { supported_features: 0 });
    state.setEntityState(player);
    state.setConfig({ ...state.CONFIG, primaryMediaPlayer: player.entity_id });
    ui.callMediaTileService('next');
    expect(mockCallService).not.toHaveBeenCalled();
  });
  test('primary media refuses commands for unavailable player', () => {
    const player = entity('media_player.audit', 'unavailable', { supported_features: 16433 });
    state.setEntityState(player);
    state.setConfig({ ...state.CONFIG, primaryMediaPlayer: player.entity_id });
    ui.callMediaTileService('play');
    expect(mockCallService).not.toHaveBeenCalled();
  });
  test('read-only todo does not expose add-item mutation', async () => {
    const list = entity('todo.readonly', '1', { supported_features: 0 });
    state.setEntityState(list);
    ui.openEntityControls(list);
    await Promise.resolve();
    await Promise.resolve();
    const form = document.querySelector('.todo-add-form');
    form.querySelector('input').value = 'Should not add';
    form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    expect(mockCallService).not.toHaveBeenCalled();
  });
  test('todo count follows live HA state even during item cache TTL', async () => {
    const list = entity('todo.auditcount', '1', {});
    mockCallServiceWithResponse.mockResolvedValue({
      'todo.auditcount': { items: [{ uid: 'a', summary: 'A', status: 'needs_action' }] },
    });
    renderTiles([list]);
    for (let i = 0; i < 12; i++) await Promise.resolve();
    liveUpdate({ ...list, state: '3' });
    expect(tile(list.entity_id).querySelector('.todo-active-count').textContent).toContain('3');
  });
  test('switching HA server refetches history for the same entity id', async () => {
    const sensor = entity('sensor.auditcross', '21', {
      unit_of_measurement: '°C',
      state_class: 'measurement',
    });
    mockRequest.mockResolvedValue({
      success: true,
      result: { 'sensor.auditcross': [{ state: '19', last_changed: new Date().toISOString() }] },
    });
    renderTiles([sensor]);
    for (let i = 0; i < 12; i++) await Promise.resolve();
    const before = mockRequest.mock.calls.length;
    expect(before).toBeGreaterThan(0);
    state.setConfig({
      ...state.CONFIG,
      homeAssistant: { url: 'http://different-server:8123', token: 'other' },
    });
    renderTiles([{ ...sensor, state: '31' }]);
    for (let i = 0; i < 12; i++) await Promise.resolve();
    expect(mockRequest.mock.calls.length).toBeGreaterThan(before);
  });
  test('sensor detail updates its current readout on state change', () => {
    const sensor = entity('sensor.auditdetail', '21', {
      unit_of_measurement: '°C',
      state_class: 'measurement',
    });
    state.setEntityState(sensor);
    ui.openEntityControls(sensor);
    state.setEntityState({ ...sensor, state: '24' });
    expect(document.querySelector('.sensor-detail-value').textContent).toContain('24');
  });
  test('climate tile reports current zero degrees rather than the target', () => {
    const climate = entity('climate.auditzero', 'heat', {
      current_temperature: 0,
      temperature: 22,
    });
    state.setEntityState(climate);
    expect(ui.describeQuickAccessTile(climate.entity_id).value).toBe('0°');
  });
  test('unavailable fan tile refuses its primary toggle', () => {
    const fan = entity('fan.auditunavailable', 'unavailable', {
      supported_features: 1,
      percentage: 50,
    });
    renderTiles([fan]);
    tile(fan.entity_id).click();
    expect(mockCallService).not.toHaveBeenCalled();
  });

  const flush = async () => {
    for (let i = 0; i < 20; i += 1) await Promise.resolve();
  };

  test('media recovery keeps unsupported track controls disabled', () => {
    const player = entity('media_player.recovery', 'playing', {
      supported_features: 16445,
      volume_level: 0.5,
    });
    state.setEntityState(player);
    ui.openEntityControls(player);
    state.setEntityState({ ...player, state: 'unavailable' });
    state.setEntityState({ ...player, state: 'paused', attributes: { supported_features: 16384 } });
    const modal = document.querySelector('.media-modal');
    expect(modal.querySelector('.dialog-unavailable-note')).toBeNull();
    expect(modal.querySelector('.media-detail-play-btn').disabled).toBe(false);
    expect(modal.querySelector('.media-detail-next-btn').disabled).toBe(true);
    expect(modal.querySelector('#media-volume-slider').disabled).toBe(true);
  });

  test('primary media buttons follow live playback capabilities', () => {
    document.body.insertAdjacentHTML(
      'beforeend',
      '<div id="media-tile"><button id="media-tile-play"></button><button id="media-tile-prev"></button><button id="media-tile-next"></button></div>'
    );
    const player = entity('media_player.card', 'paused', { supported_features: 16384 });
    state.setEntityState(player);
    state.setConfig({ ...state.CONFIG, primaryMediaPlayer: player.entity_id });
    ui.updateMediaTile();
    expect(document.getElementById('media-tile-play').disabled).toBe(false);
    expect(document.getElementById('media-tile-next').disabled).toBe(true);
    state.setEntityState({ ...player, state: 'unavailable' });
    ui.updateMediaTile();
    expect(document.getElementById('media-tile-play').disabled).toBe(true);
  });

  test('to-do add and completion capabilities change independently and recover after unavailable', async () => {
    const list = entity('todo.capabilities', '1', { supported_features: 4 });
    mockCallServiceWithResponse.mockResolvedValue({
      [list.entity_id]: { items: [{ uid: 'one', summary: 'Milk', status: 'needs_action' }] },
    });
    state.setEntityState(list);
    ui.openEntityControls(list);
    await flush();
    const modal = document.querySelector('.todo-modal');
    const add = modal.querySelector('.todo-add-form input');
    const checkbox = () => modal.querySelector('input[type="checkbox"]');
    expect(add.disabled).toBe(true);
    expect(checkbox().disabled).toBe(false);
    state.setEntityState({ ...list, state: 'unavailable' });
    expect(add.disabled).toBe(true);
    expect(checkbox().disabled).toBe(true);
    state.setEntityState({ ...list, attributes: { supported_features: 1 } });
    await flush();
    expect(add.disabled).toBe(false);
    expect(checkbox().disabled).toBe(true);
  });

  test('unavailable hotkeys do not submit direct or queued service calls', () => {
    const fan = entity('fan.hotkey', 'unavailable', { supported_features: 1 });
    state.setEntityState(fan);
    for (const action of ['toggle', 'turn_on', 'increase_speed'])
      ui.executeHotkeyAction(fan, action);
    expect(mockCallService).not.toHaveBeenCalled();
  });

  test('late old-server to-do responses do not replace the new server cache', async () => {
    let release;
    const list = entity('todo.cross', 'unknown');
    mockCallServiceWithResponse
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            release = resolve;
          })
      )
      .mockResolvedValue({
        [list.entity_id]: { items: [{ uid: 'new', summary: 'New', status: 'needs_action' }] },
      });
    renderTiles([list]);
    state.setConfig({ ...state.CONFIG, homeAssistant: { url: 'http://new-server', token: 'new' } });
    renderTiles([list]);
    await flush();
    release({
      [list.entity_id]: {
        items: [
          { uid: 'old1', status: 'needs_action' },
          { uid: 'old2', status: 'needs_action' },
        ],
      },
    });
    await flush();
    expect(tile(list.entity_id).querySelector('.todo-active-count').textContent).toBe('1 active');
    expect(mockCallServiceWithResponse).toHaveBeenCalledTimes(2);
  });

  test('OAuth access-token refresh retains cache scope while account changes reset it', () => {
    state.setConfig({
      ...state.CONFIG,
      homeAssistant: {
        url: 'http://ha',
        authMethod: 'oauth',
        oauthAuthorizationId: 'account-1',
        token: 'first',
      },
    });
    const original = ui.ensureEntityCacheScope();
    state.setConfig({
      ...state.CONFIG,
      homeAssistant: { ...state.CONFIG.homeAssistant, token: 'refreshed' },
    });
    expect(ui.ensureEntityCacheScope()).toBe(original);
    state.setConfig({
      ...state.CONFIG,
      homeAssistant: { ...state.CONFIG.homeAssistant, oauthAuthorizationId: 'account-2' },
    });
    expect(ui.ensureEntityCacheScope()).toBeGreaterThan(original);
  });

  test('sensor summary follows units and availability and unsubscribes on close', () => {
    const sensor = entity('sensor.live', '21', {
      unit_of_measurement: '°C',
      state_class: 'measurement',
    });
    state.setEntityState(sensor);
    ui.openEntityControls(sensor);
    const modal = document.querySelector('.sensor-detail-modal');
    state.setEntityState({
      ...sensor,
      state: '0',
      attributes: { ...sensor.attributes, unit_of_measurement: '°F' },
    });
    expect(modal.querySelector('.sensor-detail-unit').textContent).toBe('°F');
    state.setEntityState({ ...sensor, state: 'unavailable' });
    expect(modal.querySelector('.sensor-detail-value').textContent).toBe('Unavailable');
    modal.querySelector('.close-btn').click();
    state.setEntityState({ ...sensor, state: '42' });
    expect(modal.querySelector('.sensor-detail-value').textContent).toBe('Unavailable');
  });

  test.each([
    [0, 22, '0°'],
    [-5, 22, '-5°'],
    [null, 0, '0°'],
    [null, null, 'Heating'],
  ])('climate current %s and target %s display %s', (current, target, expected) => {
    const climate = entity('climate.reading', 'heat', {
      current_temperature: current,
      temperature: target,
    });
    state.setEntityState(climate);
    expect(ui.describeQuickAccessTile(climate.entity_id).value).toBe(expected);
  });
});

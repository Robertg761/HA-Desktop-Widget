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
  describe('where focus starts in the helper, to-do and calendar dialogs', () => {
    // Keyboard users used to land on the header's Close button and had to Tab past it before they
    // could type or pick a value.
    const settle = async () => {
      await Promise.resolve();
      await Promise.resolve();
      jest.advanceTimersByTime(1);
    };

    test('a number helper starts on its value field', async () => {
      const helper = entity('input_number.audit', '3', { min: 0, max: 10, step: 1 });
      state.setServices({ input_number: { set_value: {} } });
      state.setEntityState(helper);
      ui.openEntityControls(helper);
      await settle();

      expect(document.activeElement).toBe(document.querySelector('.helper-controls-modal input'));
    });

    test('a select helper starts on its list', async () => {
      const helper = entity('input_select.audit', 'Auto', { options: ['Auto', 'Quiet'] });
      state.setServices({ input_select: { select_option: {} } });
      state.setEntityState(helper);
      ui.openEntityControls(helper);
      await settle();

      expect(document.activeElement).toBe(document.querySelector('.helper-controls-modal select'));
    });

    test('a vacuum starts on its first action', async () => {
      const robot = entity('vacuum.audit', 'docked', { supported_features: 8192 });
      state.setServices({ vacuum: { start: {}, pause: {}, return_to_base: {} } });
      state.setEntityState(robot);
      ui.openEntityControls(robot);
      await settle();

      expect(document.activeElement).toBe(
        document.querySelector('.helper-controls-modal .entity-detail-actions button')
      );
    });

    test('a writable to-do list starts on the add field', async () => {
      const list = entity('todo.audit', '1', { supported_features: 5 });
      mockCallServiceWithResponse.mockResolvedValue({ 'todo.audit': { items: [] } });
      ui.openEntityControls(list);
      await settle();

      expect(document.activeElement).toBe(document.querySelector('.todo-add-form input'));
    });

    test('a calendar starts on Refresh', async () => {
      const calendar = entity('calendar.audit', 'off');
      mockCallServiceWithResponse.mockResolvedValue({ 'calendar.audit': { events: [] } });
      ui.openEntityControls(calendar);
      await settle();

      expect(document.activeElement.textContent).toBe('Refresh');
      expect(document.activeElement.closest('.calendar-modal')).not.toBeNull();
    });
  });
  test('vacuum exposes only entity-supported services and stops accepting actions while unavailable', () => {
    const robot = entity('vacuum.audit', 'docked', { supported_features: 8192 });
    state.setServices({ vacuum: { start: {}, pause: {}, return_to_base: {} } });
    renderTiles([robot]);
    tile(robot.entity_id).click();
    // The actions sit in the dialog's footer, which is where a toast docks.
    const actions = document.querySelector('.helper-controls-modal .modal-footer');
    expect([...actions.querySelectorAll('button')].map((button) => button.textContent)).toEqual([
      'Start',
    ]);
    const oldButton = actions.querySelector('button');
    liveUpdate({ ...robot, state: 'unavailable' });
    oldButton.click();
    expect(mockCallService).not.toHaveBeenCalled();
    expect(actions.querySelector('button').disabled).toBe(true);
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
  // A tile stops a long name at two lines, so the tooltip is where the whole name can be read.
  test.each([
    ['light.audit_long', 'brightness'],
    ['climate.audit_long', 'temperature'],
    ['fan.audit_long', 'speed'],
    ['cover.audit_long', 'position'],
  ])(
    'the %s tile names itself in front of its instruction, and keeps it after an update',
    (id, control) => {
      const longName =
        'Upstairs hallway ceiling light above the stairs next to the master bedroom door';
      const item = {
        ...entity(id, id.startsWith('climate') ? 'heat' : 'on'),
        attributes: { friendly_name: longName },
      };
      renderTiles([item]);
      expect(tile(id).title).toBe(`${longName}: Click to toggle, hold for ${control} control`);
      liveUpdate({ ...item, attributes: { ...item.attributes, friendly_name: `${longName} 2` } });
      expect(tile(id).title).toContain(`${longName} 2: Click to toggle`);
    }
  );
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
  test.each([
    ['script.audit_idle', 'off', 'on', 'Active'],
    ['scene.audit_idle', '2026-01-01T00:00:00+00:00', 'unavailable', 'Unavailable'],
  ])('%s gains an accessible description when a state line appears later', (id, from, to, text) => {
    const item = entity(id, from);
    renderTiles([item]);
    const before = tile(id);
    expect(before.querySelector('.control-state')).toBeNull();
    liveUpdate({ ...item, state: to });
    const current = tile(id);
    const readout = current.querySelector('.control-state');
    expect(readout.textContent).toBe(text);
    const described = current.querySelector('.tile-primary-button') || current;
    expect(document.getElementById(described.getAttribute('aria-describedby'))).toBe(readout);
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
  test('a primary light card carries the light state its warm icon and glow key on', () => {
    const light = entity('light.audit', 'on', { brightness: 200 });
    document.body.innerHTML +=
      '<div class="status-grid"><div id="weather-card"></div><div id="time-card"></div></div>';
    state.setStates({ [light.entity_id]: light });
    state.setConfig({ ...state.CONFIG, primaryCards: [light.entity_id, 'none'] });
    ui.renderPrimaryCards();

    const card = document.querySelector('.primary-light-card');
    expect(card.dataset.state).toBe('on');

    // The card outlives the control inside it, so a live change has to move the attribute too.
    liveUpdate({ ...light, state: 'off', attributes: {} });
    expect(card.dataset.state).toBe('off');
    liveUpdate({ ...light, state: 'on' });
    expect(card.dataset.state).toBe('on');
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
  test('alarm prompt starts keyboard focus in the code field', () => {
    void ui.requestAlarmCode(entity('alarm_control_panel.audit', 'armed_home', {}));
    const modal = document.querySelector('.alarm-code-modal');
    jest.advanceTimersByTime(1);
    expect(document.activeElement).toBe(modal.querySelector('input'));
    modal.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
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
  test('media detail shows controls a player gains while the dialog is open', () => {
    const player = entity('media_player.audit', 'unavailable', { supported_features: 0 });
    state.setEntityState(player);
    ui.openEntityControls(player);
    jest.advanceTimersByTime(20);
    expect(document.querySelector('.media-modal .media-detail-play-btn')).toBeNull();
    state.setEntityState(
      entity('media_player.audit', 'paused', { supported_features: 16445, volume_level: 0.5 })
    );
    const modals = document.querySelectorAll('.media-modal');
    expect(modals).toHaveLength(1);
    const modal = modals[0];
    expect(modal.querySelector('.media-detail-play-btn').disabled).toBe(false);
    expect(modal.querySelector('#media-volume-slider').disabled).toBe(false);
    modal.querySelector('.media-detail-play-btn').click();
    expect(mockCallService).toHaveBeenCalledTimes(1);
  });
  test('media detail keeps the keyboard where it was, and its way back to the opener, when it gains controls', () => {
    document.body.insertAdjacentHTML('beforeend', '<button id="tile-opener">Player</button>');
    const opener = document.getElementById('tile-opener');
    const player = entity('media_player.audit', 'paused', {
      supported_features: 16445,
      volume_level: 0.5,
    });
    state.setServices({ media_player: { media_seek: {} } });
    state.setEntityState(player);
    opener.focus();
    ui.openEntityControls(player);
    jest.advanceTimersByTime(20);
    const first = document.querySelector('.media-modal');
    document.querySelector('#media-volume-slider').focus();
    expect(document.activeElement.id).toBe('media-volume-slider');

    // The player gains seeking, so the dialog is rebuilt with its seek buttons.
    state.setEntityState(
      entity('media_player.audit', 'paused', {
        supported_features: 16445 | 2,
        volume_level: 0.5,
        media_position: 5,
        media_duration: 200,
      })
    );
    jest.advanceTimersByTime(0);

    const modals = document.querySelectorAll('.media-modal');
    expect(modals).toHaveLength(1);
    expect(modals[0]).not.toBe(first);
    expect(modals[0].classList.contains('modal-rebuilt')).toBe(true);
    expect(document.activeElement.id).toBe('media-volume-slider');

    document.activeElement.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })
    );
    jest.advanceTimersByTime(400);
    expect(document.querySelector('.media-modal')).toBeNull();
    expect(document.activeElement).toBe(opener);
  });
  test('unknown state blocks stale climate readings but not a never-pressed button', () => {
    const { getClimateTileTemperature } = require('../../src/entity-control-policy.js');
    const thermostat = entity('climate.audit', 'heat', { current_temperature: 21 });
    expect(getClimateTileTemperature(thermostat)).toBe(21);
    expect(getClimateTileTemperature({ ...thermostat, state: 'unknown' })).toBeNull();

    const button = entity('button.audit', 'unknown');
    state.setServices({ button: { press: {} } });
    renderTiles([button]);
    tile(button.entity_id).click();
    expect(mockCallService).toHaveBeenCalledWith('button', 'press', { entity_id: 'button.audit' });
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
  test('sensor detail shows unavailable once Home Assistant deletes the entity', () => {
    const sensor = entity('sensor.deleted', '21.5', { unit_of_measurement: '°C' });
    state.setEntityState(sensor);
    ui.openEntityControls(sensor);
    const modal = document.querySelector('.sensor-detail-modal');
    const value = modal.querySelector('.sensor-detail-value');
    expect(value.textContent).toContain('21.5');
    expect(modal.classList.contains('entity-unavailable')).toBe(false);
    state.deleteEntityState(sensor.entity_id);
    expect(value.textContent).not.toContain('21.5');
    expect(value.textContent).toMatch(/unavailable/i);
    expect(modal.classList.contains('entity-unavailable')).toBe(true);
  });
  test('todo dialog stops writing once Home Assistant deletes the entity', async () => {
    const list = entity('todo.deleted', '1', { supported_features: 5 });
    mockCallServiceWithResponse.mockResolvedValue({
      [list.entity_id]: { items: [{ uid: 'one', summary: 'Milk', status: 'needs_action' }] },
    });
    state.setEntityState(list);
    ui.openEntityControls(list);
    await flush();
    const modal = document.querySelector('.todo-modal');
    expect(modal.querySelector('.todo-add-form input').disabled).toBe(false);
    state.deleteEntityState(list.entity_id);
    expect(modal.querySelector('.todo-add-form input').disabled).toBe(true);
    expect(modal.querySelector('input[type="checkbox"]').disabled).toBe(true);
    const form = modal.querySelector('.todo-add-form');
    form.querySelector('input').value = 'Ghost';
    form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    expect(mockCallService).not.toHaveBeenCalled();
  });
  test('todo dialog keeps a deleted list disabled when a pending read resolves later', async () => {
    const list = entity('todo.pending', '1', { supported_features: 5 });
    let resolveItems;
    mockCallServiceWithResponse.mockReturnValue(
      new Promise((resolve) => {
        resolveItems = resolve;
      })
    );
    state.setEntityState(list);
    ui.openEntityControls(list);
    await flush();
    const modal = document.querySelector('.todo-modal');
    state.deleteEntityState(list.entity_id);
    resolveItems({
      [list.entity_id]: { items: [{ uid: 'one', summary: 'Milk', status: 'needs_action' }] },
    });
    await flush();
    const checkbox = modal.querySelector('input[type="checkbox"]');
    expect(checkbox.disabled).toBe(true);
    checkbox.checked = true;
    checkbox.dispatchEvent(new Event('change', { bubbles: true }));
    await flush();
    expect(mockCallService).not.toHaveBeenCalled();
  });
  test('media detail shows unavailable once Home Assistant deletes the player', () => {
    const player = entity('media_player.deleted', 'playing', {
      supported_features: 16445,
      volume_level: 0.5,
      media_title: 'Old Song',
      media_artist: 'Old Artist',
    });
    state.setEntityState(player);
    ui.openEntityControls(player);
    jest.advanceTimersByTime(20);
    const modal = document.querySelector('.media-modal');
    expect(modal.querySelector('.media-detail-title').textContent).toBe('Old Song');
    state.deleteEntityState(player.entity_id);
    expect(document.querySelectorAll('.media-modal')).toHaveLength(1);
    expect(document.querySelector('.media-modal')).toBe(modal);
    expect(modal.querySelector('.media-detail-title').textContent).not.toContain('Old Song');
    expect(modal.classList.contains('entity-unavailable')).toBe(true);
    expect(
      [...modal.querySelectorAll('.modal-body input,.modal-body button')].filter((e) => !e.disabled)
    ).toHaveLength(0);
    modal.querySelector('.media-detail-play-btn').click();
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
    expect(ui.describeQuickAccessTile(climate.entity_id).value).toBe('0°C');
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

  test.each([
    [
      'light',
      entity('light.switch', 'on', { brightness: 128, supported_color_modes: ['brightness'] }),
      '.brightness-modal',
    ],
    [
      'climate',
      entity('climate.switch', 'heat', {
        temperature: 20,
        min_temp: 7,
        max_temp: 30,
        hvac_modes: ['off', 'heat'],
        supported_features: 1,
      }),
      '.climate-modal',
    ],
    ['fan', entity('fan.switch', 'on', { percentage: 50, supported_features: 1 }), '.fan-modal'],
    [
      'cover',
      entity('cover.switch', 'open', { current_position: 40, supported_features: 4 }),
      '.cover-modal',
    ],
  ])('a server change closes an open %s control dialog', (_domain, item, selector) => {
    state.setEntityState(item);
    ui.openEntityControls(item);
    jest.advanceTimersByTime(20);
    expect(document.querySelector(selector)).not.toBeNull();
    state.setConfig({ ...state.CONFIG, homeAssistant: { url: 'http://new-server', token: 'new' } });
    ui.ensureEntityCacheScope();
    jest.advanceTimersByTime(500);
    expect(document.querySelector(selector)).toBeNull();
    // Closing runs the dialog's own cleanup, so nothing is sent to the new server.
    expect(mockCallService).not.toHaveBeenCalled();
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
    [0, 22, '0°C'],
    [-5, 22, '-5°C'],
    [null, 0, '0°C'],
    [null, null, 'Heating'],
  ])('climate current %s and target %s display %s', (current, target, expected) => {
    const climate = entity('climate.reading', 'heat', {
      current_temperature: current,
      temperature: target,
    });
    state.setEntityState(climate);
    expect(ui.describeQuickAccessTile(climate.entity_id).value).toBe(expected);
  });
  describe('dialogs built from the shared control classes', () => {
    const classesOf = (element) => [...element.classList];

    test('the helper dialog names its field, says what it accepts, and gives it the form-group, button and lead classes', () => {
      const helper = entity('input_number.audit', '3', {
        friendly_name: 'Thermostat offset',
        min: 0,
        max: 10,
        step: 1,
      });
      state.setServices({ input_number: { set_value: {} } });
      renderTiles([helper]);
      tile(helper.entity_id).click();

      const modal = document.querySelector('.helper-controls-modal');
      const input = modal.querySelector('input');
      expect(input.closest('.form-group')).not.toBeNull();
      // The title is the entity's name already, so the field is named without a second label.
      expect(modal.querySelector('label')).toBeNull();
      expect(input.getAttribute('aria-label')).toBe('Thermostat offset');
      const hint = document.getElementById(input.getAttribute('aria-describedby'));
      expect(hint.classList.contains('form-help')).toBe(true);
      expect(hint.textContent).toBe('Range 0 to 10, step 1');
      const readout = modal.querySelector('.modal-lead');
      expect(readout.getAttribute('role')).toBe('status');
      expect(readout.classList.contains('helper-controls-readout')).toBe(true);
      const apply = modal.querySelector('.modal-footer.entity-detail-actions button');
      expect(classesOf(apply)).toEqual(['btn', 'btn-primary']);
    });

    test('a vacuum has one main action and quieter ones beside it', () => {
      const robot = entity('vacuum.audit', 'docked', { supported_features: 8192 | 4 | 8 });
      state.setServices({ vacuum: { start: {}, pause: {}, stop: {} } });
      renderTiles([robot]);
      tile(robot.entity_id).click();

      const buttons = [...document.querySelectorAll('.helper-controls-modal button')].filter(
        (button) => !button.classList.contains('close-btn')
      );
      expect(buttons.map((button) => classesOf(button).join(' '))).toEqual([
        'btn btn-primary',
        'btn btn-secondary',
        'btn btn-secondary',
      ]);
    });

    test('the alarm prompt labels its field and submits with a real button', () => {
      void ui.requestAlarmCode(entity('alarm_control_panel.audit', 'armed_home', {}));
      const modal = document.querySelector('.alarm-code-modal');
      const input = modal.querySelector('input');

      expect(modal.querySelector('label').htmlFor).toBe(input.id);
      expect(input.closest('.form-group')).not.toBeNull();
      const submit = modal.querySelector('button[type="submit"]');
      expect(classesOf(submit)).toEqual(['btn', 'btn-primary']);
      modal.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    });

    test('the calendar keeps its refresh in a toolbar with the date window', async () => {
      const calendar = entity('calendar.audit', 'off');
      state.setEntityState(calendar);
      mockCallServiceWithResponse.mockResolvedValue({ 'calendar.audit': { events: [] } });
      ui.openEntityControls(calendar);
      await Promise.resolve();
      await Promise.resolve();

      const toolbar = document.querySelector('.calendar-modal .calendar-toolbar');
      expect(toolbar.querySelector('.modal-lead').textContent).toContain('next 7 days');
      expect(classesOf(toolbar.querySelector('button'))).toEqual([
        'btn',
        'btn-secondary',
        'btn-sm',
      ]);
    });

    test('the Manage Quick Access pager is made of compact secondary buttons', () => {
      document.body.innerHTML += `<div id="quick-controls-modal"><div id="quick-controls-target-hint"></div>
        <input id="quick-controls-search"><div id="quick-controls-list"></div></div>`;
      state.setStates(
        Object.fromEntries(
          Array.from({ length: 60 }, (_, index) => {
            const id = `sensor.pager_${index}`;
            return [id, entity(id, String(index))];
          })
        )
      );
      ui.populateQuickControlsList();

      const pager = document.getElementById('quick-controls-pagination');
      const [previous, next] = pager.querySelectorAll('button');
      expect(classesOf(previous)).toEqual(['btn', 'btn-secondary', 'btn-sm']);
      expect(classesOf(next)).toEqual(['btn', 'btn-secondary', 'btn-sm']);
      expect(pager.querySelector('.entity-selector-pagination-status').textContent).toBe(
        'Page 1 of 2 · 60 entities'
      );
    });

    test('the media dialog keeps one Mute label, flips aria-pressed, and says how far a seek jumps', () => {
      state.setServices({
        media_player: { media_seek: {}, volume_mute: {}, media_play_pause: {} },
      });
      const player = entity('media_player.audit', 'playing', {
        supported_features: 2 | 4 | 8 | 16384,
        volume_level: 0.5,
        is_volume_muted: false,
        media_duration: 300,
        media_position: 30,
      });
      state.setEntityState(player);
      ui.openEntityControls(player);
      jest.advanceTimersByTime(20);

      const mute = document.querySelector('.media-modal #media-mute-toggle');
      expect(mute.textContent).toBe('Mute');
      expect(mute.getAttribute('aria-pressed')).toBe('false');
      mute.click();
      expect(mute.textContent).toBe('Mute');
      expect(mute.getAttribute('aria-pressed')).toBe('true');
      expect(mute.classList.contains('active')).toBe(true);

      const seek = [...document.querySelectorAll('.media-modal .media-detail-seek-btn')];
      expect(seek.map((button) => button.textContent)).toEqual(['\u221210s', '+10s']);
    });
  });
});

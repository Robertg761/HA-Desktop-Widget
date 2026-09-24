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
const i18n = require('../../src/i18n.js');
const Sortable = require('sortablejs');
const { mountSensorHistoryDetail } = require('../../src/sensor-history-detail.js');

const styles = require('fs').readFileSync(
  require('path').resolve(__dirname, '../../styles.css'),
  'utf8'
);
const entity = (entity_id, value, attributes = {}) => ({ entity_id, state: value, attributes });
const inputValue = (selector, value, root = document) => {
  const input = root.querySelector(selector);
  input.value = String(value);
  input.dispatchEvent(new Event('input', { bubbles: true }));
  return input;
};
const pendingCall = () => {
  const call = {};
  mockCallService.mockImplementationOnce(
    () =>
      new Promise((resolve, reject) => {
        call.resolve = resolve;
        call.reject = reject;
      })
  );
  return call;
};
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

describe('tile and device dialog polish', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.spyOn(console, 'warn').mockImplementation(() => {});
    jest.spyOn(console, 'error').mockImplementation(() => {});
    jest.clearAllMocks();
    resetMockElectronAPI();
    i18n.setLocaleBootstrap({ activeLocale: 'en-US', messages: {} });
    document.body.innerHTML = `<div class="status-grid"><div id="weather-card"></div><div id="time-card"></div></div>
      <div id="quick-controls"></div>`;
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
    jest.clearAllTimers();
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  describe('calendar tile', () => {
    it('shows All day for an all-day event reported with a midnight start time', () => {
      renderTiles([
        entity('calendar.trips', 'off', {
          message: 'Vacation',
          start_time: '2026-09-24 00:00:00',
          all_day: true,
        }),
      ]);
      expect(tile('calendar.trips').querySelector('.calendar-next-event').textContent).toBe(
        'Vacation · All day'
      );
    });

    it.each([
      ['Asia/Tokyo', '2026-09-23 20:00:00', '2026-09-23T11:00:00Z'],
      // Just after the spring-forward change, the new offset applies.
      ['America/New_York', '2026-03-08 03:30:00', '2026-03-08T07:30:00Z'],
      ['America/New_York', '2026-03-07 23:30:00', '2026-03-08T04:30:00Z'],
    ])(
      "reads start times in Home Assistant's time zone (%s %s)",
      (timeZone, startTime, instant) => {
        state.setTimeZone(timeZone);
        try {
          renderTiles([
            entity('calendar.work', 'on', { message: 'Standup', start_time: startTime }),
          ]);
          const expected = new Date(instant).toLocaleTimeString('en-US', {
            hour: 'numeric',
            minute: '2-digit',
          });
          expect(tile('calendar.work').querySelector('.calendar-next-event').textContent).toBe(
            `Standup · ${expected}`
          );
        } finally {
          state.setTimeZone(null);
        }
      }
    );

    it('shows timed events without seconds in the active locale', () => {
      const start = '2026-09-23 20:23:50';
      renderTiles([entity('calendar.work', 'on', { message: 'Standup', start_time: start })]);
      const expected = new Date(start).toLocaleTimeString('en-US', {
        hour: 'numeric',
        minute: '2-digit',
      });
      const text = tile('calendar.work').querySelector('.calendar-next-event').textContent;
      expect(text).toBe(`Standup · ${expected}`);
      expect(text).not.toMatch(/\d:\d{2}:\d{2}/);
    });
  });

  it('relabels tile and primary card Controls buttons after a language change', () => {
    const labels = () =>
      [
        ...document.querySelectorAll('#quick-controls .tile-details-button'),
        document.querySelector('#weather-card .tile-details-button'),
      ].map((button) => button?.textContent);
    i18n.setLocaleBootstrap({ activeLocale: 'de', messages: { Controls: 'Steuerung' } });
    state.setConfig({ ...state.CONFIG, primaryCards: ['light.desk', 'none'] });
    renderTiles([entity('light.desk', 'off'), entity('media_player.den', 'off')]);
    expect(labels()).toEqual(['Steuerung', 'Steuerung', 'Steuerung']);
    i18n.setLocaleBootstrap({ activeLocale: 'en', messages: {} });
    ui.renderActiveTab();
    expect(labels()).toEqual(['Controls', 'Controls', 'Controls']);
  });

  it('lets keyboard users reach the weather card, and only the weather card', () => {
    const card = document.getElementById('weather-card');
    state.setConfig({ ...state.CONFIG, primaryCards: ['weather', 'none'] });
    renderTiles([]);
    expect(card.tabIndex).toBe(0);
    expect(card.getAttribute('role')).toBe('button');
    expect(card.getAttribute('aria-haspopup')).toBe('dialog');

    state.setConfig({ ...state.CONFIG, primaryCards: ['light.desk', 'none'] });
    renderTiles([entity('light.desk', 'off')]);
    expect(card.hasAttribute('tabindex')).toBe(false);
    expect(card.hasAttribute('role')).toBe(false);
  });

  it('shows each weather entity with its condition icon in the picker', () => {
    document.body.insertAdjacentHTML('beforeend', '<div id="weather-entities-list"></div>');
    state.setStates({
      'weather.home': entity('weather.home', 'rainy'),
      'weather.cabin': entity('weather.cabin', 'sunny'),
    });
    ui.populateWeatherEntitiesList();
    const icons = [...document.querySelectorAll('#weather-entities-list .entity-icon')];
    expect(icons.map((icon) => icon.textContent)).not.toContain('❓');
    // The weather icon renderer is stubbed here; it records the condition it drew.
    expect(icons.map((icon) => icon.dataset.weatherCondition)).toEqual(['sunny', 'rainy']);
  });

  describe('device tile state line', () => {
    it.each([
      [
        entity('cover.window', 'open', { current_position: 50, supported_features: 15 }),
        'Open 50%',
      ],
      [entity('cover.garage', 'closed', { supported_features: 3 }), 'Closed'],
      [entity('lock.front', 'locked'), 'Locked'],
      [entity('fan.ceiling', 'on', { percentage: 67, supported_features: 1 }), 'On 67%'],
      [entity('fan.basic', 'off', { supported_features: 0 }), 'Off'],
      [entity('light.onoff', 'on', { supported_color_modes: ['onoff'] }), 'On'],
    ])('shows the state of %o', (device, expected) => {
      renderTiles([device]);
      expect(tile(device.entity_id).querySelector('.control-state').textContent).toBe(expected);
    });

    it('follows live updates and translates the state', () => {
      renderTiles([entity('lock.front', 'locked'), entity('cover.window', 'closed')]);
      i18n.setLocaleBootstrap({ activeLocale: 'de', messages: { Unlocked: 'Entriegelt' } });
      liveUpdate(entity('lock.front', 'unlocked'));
      liveUpdate(entity('cover.window', 'opening', { current_position: 30 }));
      expect(tile('lock.front').querySelector('.control-state').textContent).toBe('Entriegelt');
      expect(tile('cover.window').querySelector('.control-state').textContent).toBe('Opening 30%');
    });
  });

  it('keeps compact media artwork square', () => {
    const rule = styles.match(
      /body\.density-compact #quick-controls \.media-player-entity \.control-icon\.has-artwork \{([^}]*)\}/
    );
    expect(rule).not.toBeNull();
    const width = rule[1].match(/width:\s*([^;]+);/)?.[1];
    const height = rule[1].match(/height:\s*([^;]+);/)?.[1];
    expect(width).toBeTruthy();
    expect(width).toBe(height);
  });

  describe('reorganize mode', () => {
    beforeEach(() => {
      renderTiles([entity('switch.a', 'off'), entity('switch.b', 'off')]);
    });
    afterEach(() => {
      if (document.querySelector('#quick-controls.reorganize-mode')) ui.toggleReorganizeMode();
    });
    const savedToasts = () =>
      uiUtils.showToast.mock.calls.filter(([message]) => message === 'Quick Access order saved');

    it('does not save or announce an unchanged order', () => {
      ui.toggleReorganizeMode();
      const setConfig = jest.spyOn(state, 'setConfig');
      ui.toggleReorganizeMode();
      expect(savedToasts()).toHaveLength(0);
      expect(setConfig).not.toHaveBeenCalled();
    });

    it('announces an order that was changed by dragging', () => {
      ui.toggleReorganizeMode();
      const container = document.getElementById('quick-controls');
      const moved = tile('switch.b');
      container.prepend(moved);
      Sortable.create.mock.calls.at(-1)[1].onEnd({ item: moved });
      ui.toggleReorganizeMode();
      expect(state.CONFIG.customTabs[0].entityIds).toEqual(['switch.b', 'switch.a']);
      expect(savedToasts()).toHaveLength(1);
    });
  });

  it('does not let an older failed fan request undo newer feedback', async () => {
    const earlier = pendingCall();
    const later = pendingCall();
    ui.openEntityDetailModal(
      entity('fan.ceiling', 'on', { percentage: 40, supported_features: 1 })
    );
    inputValue('#fan-slider', 80);
    await jest.advanceTimersByTimeAsync(200);
    inputValue('#fan-slider', 30);
    await jest.advanceTimersByTimeAsync(200);
    earlier.reject(new Error('Earlier speed failed'));
    await jest.advanceTimersByTimeAsync(0);
    expect(document.querySelector('#fan-slider').value).toBe('30');
    expect(document.querySelector('#fan-speed-value').textContent).toBe('30%');
    later.resolve({ success: true });
    await jest.advanceTimersByTimeAsync(0);
    expect(document.querySelector('#fan-speed-value').textContent).toBe('30%');
  });

  describe('sensor history period failures', () => {
    it('hides the previous chart and dates on failure and restores them on retry', async () => {
      const modal = document.createElement('div');
      document.body.append(modal);
      const request = jest
        .fn()
        .mockResolvedValueOnce({ result: [{ value: 1, timestamp: Date.now() - 1000 }] })
        .mockRejectedValueOnce(new Error('offline'))
        .mockResolvedValueOnce({ result: [{ value: 2, timestamp: Date.now() - 1000 }] });
      const render = jest.fn((frame) => {
        frame.textContent = 'chart';
      });
      mountSensorHistoryDetail({
        body: modal,
        modal,
        entity: { entity_id: 'sensor.test', attributes: {} },
        websocket: { request },
        normalize: (response) => response.result,
        render,
      });
      await jest.advanceTimersByTimeAsync(0);
      const frame = modal.querySelector('.sensor-detail-sparkline');
      const dates = modal.querySelectorAll('.sensor-history-summary')[1];
      expect(frame.hidden).toBe(false);
      expect(dates.textContent).not.toBe('');
      // Hours and minutes only.
      expect(dates.textContent).not.toMatch(/\d:\d{2}:\d{2}/);

      const period = modal.querySelector('select');
      period.value = '1';
      period.dispatchEvent(new Event('change'));
      await jest.advanceTimersByTimeAsync(0);
      expect(frame.hidden).toBe(true);
      expect(dates.textContent).toBe('');

      modal.querySelector('button').click();
      await jest.advanceTimersByTimeAsync(0);
      expect(frame.hidden).toBe(false);
      expect(dates.textContent).not.toBe('');
      expect(render).toHaveBeenCalledTimes(2);
      modal.remove();
    });
  });

  describe('media dialog', () => {
    const player = (supported_features, attributes = {}) =>
      entity('media_player.walkman', 'playing', {
        supported_features,
        media_position: 30,
        media_duration: 200,
        volume_level: 0.4,
        ...attributes,
      });
    beforeEach(() => state.setServices({ media_player: { media_seek: {} } }));

    it('hides seek buttons when the player lacks the seek feature', () => {
      const walkman = player(914877);
      state.setStates({ [walkman.entity_id]: walkman });
      ui.openEntityDetailModal(walkman);
      expect(document.querySelector('.media-detail-seek-btn')).toBeNull();
    });

    it('offers seek buttons when the player supports seeking', () => {
      const livingRoom = player(119695);
      state.setStates({ [livingRoom.entity_id]: livingRoom });
      ui.openEntityDetailModal(livingRoom);
      expect(document.querySelectorAll('.media-detail-seek-btn')).toHaveLength(2);
    });

    it('does not show 0% volume for a player that was turned off', () => {
      const livingRoom = player(119695);
      state.setStates({ [livingRoom.entity_id]: livingRoom });
      ui.openEntityDetailModal(livingRoom);
      expect(document.querySelector('#media-volume-value').textContent).toBe('40%');
      state.setEntityState(entity('media_player.walkman', 'off', { supported_features: 119695 }));
      expect(document.querySelector('#media-volume-value').textContent).toBe('—');
    });
  });

  describe('light dialog', () => {
    const light = (value, attributes = {}) =>
      entity('light.desk', value, { supported_color_modes: ['brightness'], ...attributes });

    it('follows an external turn-off', () => {
      state.setStates({ 'light.desk': light('on', { brightness: 255 }) });
      ui.openEntityDetailModal(light('on', { brightness: 255 }));
      expect(document.querySelector('#brightness-value-large').textContent).toBe('100%');
      state.setEntityState(light('off'));
      expect(document.querySelector('#brightness-value-large').textContent).toBe('0%');
      expect(document.querySelector('#brightness-slider').value).toBe('0');
      expect(document.querySelector('#turn-off-btn').textContent).toBe('Turn On');
      state.setEntityState(light('on', { brightness: 64 }));
      expect(document.querySelector('#brightness-value-large').textContent).toBe('25%');
      expect(document.querySelector('#turn-off-btn').textContent).toBe('Turn Off');
    });

    it('does not overwrite a focused slider or a pending brightness change', async () => {
      state.setStates({ 'light.desk': light('on', { brightness: 255 }) });
      ui.openEntityDetailModal(light('on', { brightness: 255 }));
      const slider = inputValue('#brightness-slider', 80);
      state.setEntityState(light('on', { brightness: 26 }));
      expect(slider.value).toBe('80');
      await jest.advanceTimersByTimeAsync(200);
      slider.focus();
      state.setEntityState(light('on', { brightness: 26 }));
      expect(slider.value).toBe('80');
      expect(document.querySelector('#brightness-value-large').textContent).toBe('80%');
      slider.blur();
      expect(slider.value).toBe('10');
      expect(document.querySelector('#brightness-value-large').textContent).toBe('10%');
    });

    it('applies a light state Home Assistant pushed while a command was in flight', async () => {
      const call = pendingCall();
      state.setStates({ 'light.desk': light('off') });
      ui.openEntityDetailModal(light('off'));
      document.querySelector('#turn-off-btn').click();
      state.setEntityState(light('on', { brightness: 128 }));
      expect(document.querySelector('#brightness-value-large').textContent).toBe('100%');
      call.resolve({ success: true });
      await jest.advanceTimersByTimeAsync(0);
      expect(document.querySelector('#brightness-value-large').textContent).toBe('50%');
      expect(document.querySelector('#turn-off-btn').textContent).toBe('Turn Off');
    });

    it('turns back on at the brightness last chosen in the dialog', async () => {
      state.setStates({ 'light.desk': light('on', { brightness: 255 }) });
      ui.openEntityDetailModal(light('on', { brightness: 255 }));
      inputValue('#brightness-slider', 50);
      await jest.advanceTimersByTimeAsync(200);
      document.querySelector('#turn-off-btn').click();
      await jest.advanceTimersByTimeAsync(0);
      document.querySelector('#turn-off-btn').click();
      await jest.advanceTimersByTimeAsync(0);
      expect(document.querySelector('#brightness-value-large').textContent).toBe('50%');
      expect(document.querySelector('#brightness-slider').value).toBe('50');
      // Like Home Assistant's own toggle: the light restores its level itself.
      expect(mockCallService.mock.calls.at(-1)).toEqual([
        'light',
        'turn_on',
        { entity_id: 'light.desk' },
      ]);
    });
  });

  describe('cover dialog', () => {
    it('follows the position Home Assistant reports after Stop', async () => {
      const cover = entity('cover.window', 'open', {
        current_position: 50,
        supported_features: 15,
      });
      state.setStates({ [cover.entity_id]: cover });
      ui.openEntityDetailModal(cover);
      document.querySelector('[data-action="close_cover"]').click();
      await jest.advanceTimersByTimeAsync(0);
      document.querySelector('[data-action="stop_cover"]').click();
      await jest.advanceTimersByTimeAsync(0);
      expect(document.querySelector('#cover-position-value').textContent).toBe('0%');
      state.setEntityState(
        entity('cover.window', 'open', { current_position: 50, supported_features: 15 })
      );
      expect(document.querySelector('#cover-position-value').textContent).toBe('50%');
      expect(document.querySelector('#cover-slider').value).toBe('50');
    });

    it('applies a state Home Assistant pushed while a command was in flight', async () => {
      const call = pendingCall();
      const garage = entity('cover.garage', 'closed', { supported_features: 3 });
      state.setStates({ [garage.entity_id]: garage });
      ui.openEntityDetailModal(garage);
      document.querySelector('[data-action="open_cover"]').click();
      state.setEntityState(entity('cover.garage', 'open', { supported_features: 3 }));
      expect(document.querySelector('#cover-position-value').textContent).toBe('Closed');
      call.resolve({ success: true });
      await jest.advanceTimersByTimeAsync(0);
      expect(document.querySelector('#cover-position-value').textContent).toBe('Open');
    });

    it('shows a capitalized, live state for a cover without position', async () => {
      const garage = entity('cover.garage', 'closed', { supported_features: 3 });
      state.setStates({ [garage.entity_id]: garage });
      ui.openEntityDetailModal(garage);
      expect(document.querySelector('#cover-position-value').textContent).toBe('Closed');
      document.querySelector('[data-action="open_cover"]').click();
      await jest.advanceTimersByTimeAsync(0);
      state.setEntityState(entity('cover.garage', 'open', { supported_features: 3 }));
      expect(document.querySelector('#cover-position-value').textContent).toBe('Open');
    });
  });

  it('applies a fan state Home Assistant pushed while a command was in flight', async () => {
    const call = pendingCall();
    const fan = entity('fan.ceiling', 'on', { percentage: 33, supported_features: 1 });
    state.setStates({ [fan.entity_id]: fan });
    ui.openEntityDetailModal(fan);
    inputValue('#fan-slider', 70);
    await jest.advanceTimersByTimeAsync(200);
    state.setEntityState(entity('fan.ceiling', 'on', { percentage: 67, supported_features: 1 }));
    expect(document.querySelector('#fan-speed-value').textContent).toBe('70%');
    call.resolve({ success: true });
    await jest.advanceTimersByTimeAsync(0);
    expect(document.querySelector('#fan-speed-value').textContent).toBe('67%');
  });

  describe('live device dialogs', () => {
    // Every dialog subscribes to its entity while open and must let go once closed.
    const trackSubscriptions = () => {
      const subscribe = state.subscribeEntity;
      const unsubscribes = [];
      jest.spyOn(state, 'subscribeEntity').mockImplementation((entityId, listener) => {
        const unsubscribe = jest.fn(subscribe(entityId, listener));
        unsubscribes.push(unsubscribe);
        return unsubscribe;
      });
      return unsubscribes;
    };

    it('updates the light dialog on state changes and stops after close', () => {
      const unsubscribes = trackSubscriptions();
      const light = (brightness) =>
        entity('light.desk', 'on', { brightness, supported_color_modes: ['brightness'] });
      state.setStates({ 'light.desk': light(128) });
      ui.openEntityDetailModal(light(128));
      const value = document.querySelector('#brightness-value-large');
      expect(value.textContent).toBe('50%');

      state.setEntityState(light(255));
      expect(value.textContent).toBe('100%');
      expect(document.querySelector('#brightness-slider').value).toBe('100');

      document.querySelector('#brightness-close').click();
      jest.runOnlyPendingTimers();
      expect(unsubscribes).toHaveLength(1);
      expect(unsubscribes[0]).toHaveBeenCalled();
      state.setEntityState(light(26));
      expect(value.textContent).toBe('100%');
    });

    it('updates the cover dialog on state changes and stops after close', () => {
      const unsubscribes = trackSubscriptions();
      const cover = (position) =>
        entity('cover.blind', 'open', { current_position: position, supported_features: 15 });
      state.setStates({ 'cover.blind': cover(40) });
      ui.openEntityDetailModal(cover(40));
      const value = document.querySelector('#cover-position-value');
      expect(value.textContent).toBe('40%');

      state.setEntityState(cover(75));
      expect(value.textContent).toBe('75%');
      expect(document.querySelector('#cover-slider').value).toBe('75');

      document.querySelector('#cover-close').click();
      jest.runOnlyPendingTimers();
      expect(unsubscribes).toHaveLength(1);
      expect(unsubscribes[0]).toHaveBeenCalled();
      state.setEntityState(cover(10));
      expect(value.textContent).toBe('75%');
    });

    it('updates the fan dialog on state changes and stops after close', () => {
      const unsubscribes = trackSubscriptions();
      const fan = (percentage) =>
        entity('fan.ceiling', 'on', { percentage, supported_features: 1 });
      state.setStates({ 'fan.ceiling': fan(33) });
      ui.openEntityDetailModal(fan(33));
      const value = document.querySelector('#fan-speed-value');

      state.setEntityState(fan(67));
      expect(value.textContent).toBe('67%');

      document.querySelector('#fan-close').click();
      jest.runOnlyPendingTimers();
      expect(unsubscribes).toHaveLength(1);
      expect(unsubscribes[0]).toHaveBeenCalled();
      state.setEntityState(fan(100));
      expect(value.textContent).toBe('67%');
    });
  });

  it('follows fan speed changes made outside the dialog', () => {
    const fan = entity('fan.ceiling', 'on', { percentage: 33, supported_features: 1 });
    state.setStates({ [fan.entity_id]: fan });
    ui.openEntityDetailModal(fan);
    state.setEntityState(entity('fan.ceiling', 'on', { percentage: 67, supported_features: 1 }));
    expect(document.querySelector('#fan-speed-value').textContent).toBe('67%');
    state.setEntityState(entity('fan.ceiling', 'off', { percentage: 0, supported_features: 1 }));
    expect(document.querySelector('#fan-slider').value).toBe('0');
  });

  describe('climate dialog', () => {
    const climate = (attributes = {}, value = 'heat') =>
      entity('climate.hvac', value, {
        current_temperature: 22,
        temperature: 21.5,
        min_temp: 7,
        max_temp: 35,
        target_temp_step: 0.5,
        supported_features: 1,
        hvac_modes: ['heat', 'off'],
        ...attributes,
      });

    it('moves the single target slider when Home Assistant changes it', () => {
      state.setStates({ 'climate.hvac': climate() });
      ui.openEntityDetailModal(climate());
      liveUpdate(climate({ temperature: 24, current_temperature: 23 }));
      expect(document.querySelector('#climate-slider').value).toBe('24');
      expect(document.querySelector('#climate-target-value').textContent).toBe('24°C');
      expect(document.querySelector('.climate-current-temp .climate-temp-value').textContent).toBe(
        '23°C'
      );
    });

    it('applies a target Home Assistant pushed while the change was in flight', async () => {
      const call = pendingCall();
      state.setStates({ 'climate.hvac': climate() });
      ui.openEntityDetailModal(climate());
      inputValue('#climate-slider', 25);
      await jest.advanceTimersByTimeAsync(300);
      liveUpdate(climate({ temperature: 24 }));
      expect(document.querySelector('#climate-slider').value).toBe('25');
      call.resolve({ success: true });
      await jest.advanceTimersByTimeAsync(0);
      expect(document.querySelector('#climate-slider').value).toBe('24');
    });

    it('keeps a pending target while Home Assistant reports the old one', () => {
      state.setStates({ 'climate.hvac': climate() });
      ui.openEntityDetailModal(climate());
      inputValue('#climate-slider', 25);
      liveUpdate(climate({ temperature: 21.5 }));
      expect(document.querySelector('#climate-slider').value).toBe('25');
    });

    it('gives both heat/cool sliders the full entity scale with labels', () => {
      const range = climate(
        {
          temperature: null,
          target_temp_low: 21,
          target_temp_high: 24,
          supported_features: 2,
          hvac_modes: ['heat_cool', 'off'],
        },
        'heat_cool'
      );
      state.setStates({ [range.entity_id]: range });
      ui.openEntityDetailModal(range);
      const low = document.querySelector('[data-climate-range="low"]');
      const high = document.querySelector('[data-climate-range="high"]');
      [low, high].forEach((input) => {
        expect([input.min, input.max]).toEqual(['7', '35']);
        expect(input.closest('label').querySelector('.climate-slider-labels').textContent).toMatch(
          /7°C\s+35°C/
        );
      });
      inputValue('[data-climate-range="low"]', 30);
      expect(low.value).toBe('24');
      expect(high.value).toBe('24');
    });

    describe('heat/cool targets during live updates', () => {
      const range = (low, high) =>
        climate(
          {
            temperature: null,
            target_temp_low: low,
            target_temp_high: high,
            supported_features: 2,
            hvac_modes: ['heat_cool', 'off'],
          },
          'heat_cool'
        );
      const open = () => {
        state.setStates({ 'climate.hvac': range(21, 24) });
        ui.openEntityDetailModal(range(21, 24));
        return {
          low: document.querySelector('[data-climate-range="low"]'),
          high: document.querySelector('[data-climate-range="high"]'),
        };
      };

      it('leaves the focused target alone and catches it up on blur', () => {
        const { low, high } = open();
        low.focus();
        liveUpdate(range(19, 26));
        expect(low.value).toBe('21');
        expect(high.value).toBe('26');

        low.blur();
        expect(low.value).toBe('19');
      });

      it('leaves the dragged target alone and catches it up when released', () => {
        const { low, high } = open();
        high.dispatchEvent(new Event('pointerdown', { bubbles: true }));
        liveUpdate(range(20, 27));
        expect(high.value).toBe('24');
        expect(low.value).toBe('20');

        high.dispatchEvent(new Event('pointerup', { bubbles: true }));
        expect(high.value).toBe('27');
      });

      it('keeps a keyboard change and follows Home Assistant once the user moves on', async () => {
        const { low } = open();
        low.focus();
        inputValue('[data-climate-range="low"]', 22);
        await jest.advanceTimersByTimeAsync(300);
        liveUpdate(range(22, 24));
        // Another client changes it while the user is still on the slider.
        liveUpdate(range(18, 24));
        expect(low.value).toBe('22');
        low.blur();
        expect(low.value).toBe('18');
      });
    });
  });
});

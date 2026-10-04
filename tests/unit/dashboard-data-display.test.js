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
  getWeatherConditionLabel: jest.requireActual('../../src/weather-icons.js')
    .getWeatherConditionLabel,
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
const uiUtils = require('../../src/ui-utils.js');
const { sampleConfig } = require('../fixtures/ha-data.js');
const i18n = require('../../src/i18n.js');

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

const flush = async () => {
  await jest.advanceTimersByTimeAsync(0);
};

describe('dashboard data display', () => {
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
    uiUtils.showConfirm.mockReset().mockResolvedValue(false);
  });
  afterEach(() => {
    ui.exitReorganizeMode();
    document.querySelectorAll('.modal .close-btn').forEach((button) => button.click());
    jest.clearAllTimers();
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  describe('locks and alarm panels', () => {
    it.each([
      ['lock.door', 'locked', undefined, null],
      ['lock.door', 'unlocked', 'true', 'warning'],
      ['lock.door', 'jammed', 'true', 'warning'],
      ['alarm_control_panel.home', 'disarmed', undefined, null],
      ['alarm_control_panel.home', 'armed_away', 'true', null],
      ['alarm_control_panel.home', 'triggered', 'true', 'danger'],
    ])(
      'lights %s when %s, and asks for attention for the states that need it',
      (id, value, active, attention) => {
        renderTiles([entity(id, value)]);
        expect(tile(id).dataset.active).toBe(active);
        expect(tile(id).dataset.attention).toBe(attention || undefined);
      }
    );

    it('follows a lock that jams, and clears when it recovers', () => {
      const lock = entity('lock.door', 'locked');
      renderTiles([lock]);
      liveUpdate({ ...lock, state: 'jammed' });
      expect(tile('lock.door').dataset.attention).toBe('warning');
      liveUpdate({ ...lock, state: 'locked' });
      expect(tile('lock.door').dataset.attention).toBeUndefined();
      expect(tile('lock.door').dataset.active).toBeUndefined();
    });

    it('draws the icon of what the lock is doing, and a jammed one as such', () => {
      const iconOf = (value) => {
        renderTiles([entity('lock.door', value)]);
        return tile('lock.door').querySelector('.entity-line-icon').dataset.icon;
      };
      expect(iconOf('locked')).toBe('lock');
      expect(iconOf('unlocked')).toBe('lock-open');
      expect(iconOf('jammed')).toBe('lock-alert');
    });

    it('answers a click on an alarm panel with where to arm it, and marks it as pressable', () => {
      renderTiles([
        entity('alarm_control_panel.home', 'armed_home', { friendly_name: 'Home alarm' }),
      ]);
      const panel = tile('alarm_control_panel.home');
      expect(panel.dataset.readonly).toBeUndefined();
      expect(panel.getAttribute('role')).toBe('button');
      expect(panel.title).toBe('Use the command palette to control Home alarm');
      panel.click();
      expect(uiUtils.showToast).toHaveBeenCalledWith(
        'Use the command palette to control Home alarm',
        'info',
        4000
      );
      expect(mockCallService).not.toHaveBeenCalled();
    });

    it('marks the tiles that do nothing as read-only, and no others', () => {
      renderTiles([
        entity('person.alex', 'home'),
        entity('binary_sensor.door', 'off'),
        entity('light.lamp', 'on'),
        entity('lock.door', 'locked'),
      ]);
      expect(tile('person.alex').dataset.readonly).toBe('true');
      expect(tile('binary_sensor.door').dataset.readonly).toBe('true');
      expect(tile('light.lamp').dataset.readonly).toBeUndefined();
      expect(tile('lock.door').dataset.readonly).toBeUndefined();
    });

    describe('valves, humidifiers and sirens', () => {
      it.each([
        ['siren.hall', 'off', ['siren', 'turn_on']],
        ['siren.hall', 'on', ['siren', 'turn_off']],
        ['humidifier.bedroom', 'off', ['humidifier', 'turn_on']],
        ['humidifier.bedroom', 'on', ['humidifier', 'turn_off']],
        ['valve.garden', 'closed', ['valve', 'open_valve']],
        ['valve.garden', 'open', ['valve', 'close_valve']],
        ['valve.garden', 'opening', ['valve', 'close_valve']],
      ])('toggles %s when %s from its tile', async (id, value, [domain, service]) => {
        renderTiles([entity(id, value)]);
        expect(tile(id).dataset.readonly).toBeUndefined();
        tile(id).click();
        await flush();
        expect(mockCallService).toHaveBeenCalledWith(domain, service, { entity_id: id });
      });

      it('lights a valve that is open, and a siren or humidifier that is on', () => {
        renderTiles([
          entity('valve.open', 'open'),
          entity('valve.shut', 'closed'),
          entity('siren.on', 'on'),
          entity('humidifier.off', 'off'),
        ]);
        expect(tile('valve.open').dataset.active).toBe('true');
        expect(tile('valve.shut').dataset.active).toBeUndefined();
        expect(tile('siren.on').dataset.active).toBe('true');
        expect(tile('humidifier.off').dataset.active).toBeUndefined();
      });

      it('leaves a valve alone that cannot move the way the toggle would send it', async () => {
        // ValveEntityFeature: OPEN is 1, CLOSE is 2.
        renderTiles([
          entity('valve.open_only', 'open', { supported_features: 1 }),
          entity('valve.close_only', 'closed', { supported_features: 2 }),
          entity('valve.both', 'closed', { supported_features: 3 }),
        ]);
        tile('valve.open_only').click();
        tile('valve.close_only').click();
        await flush();
        expect(mockCallService).not.toHaveBeenCalled();
        tile('valve.both').click();
        await flush();
        expect(mockCallService).toHaveBeenCalledWith('valve', 'open_valve', {
          entity_id: 'valve.both',
        });
      });

      it('is what a toggle hotkey does to them too', async () => {
        ui.executeHotkeyAction(entity('siren.hall', 'off'), 'toggle');
        ui.executeHotkeyAction(entity('valve.garden', 'open'), 'toggle');
        await flush();
        expect(mockCallService.mock.calls).toEqual([
          ['siren', 'turn_on', { entity_id: 'siren.hall' }],
          ['valve', 'close_valve', { entity_id: 'valve.garden' }],
        ]);
      });
    });

    describe('unlocking from a tile', () => {
      const lock = (value) => entity('lock.door', value, { friendly_name: 'Back door' });

      it('asks before it unlocks, and unlocks when told to', async () => {
        renderTiles([lock('locked')]);
        uiUtils.showConfirm.mockResolvedValueOnce(true);
        tile('lock.door').click();
        await flush();
        expect(uiUtils.showConfirm).toHaveBeenCalledWith('Unlock Back door', 'Are you sure?', {
          confirmText: 'Unlock',
          confirmClass: 'btn-primary',
        });
        expect(mockCallService).toHaveBeenCalledWith('lock', 'unlock', { entity_id: 'lock.door' });
      });

      it('leaves the door locked when the question is declined', async () => {
        renderTiles([lock('locked')]);
        tile('lock.door').click();
        await flush();
        expect(uiUtils.showConfirm).toHaveBeenCalled();
        expect(mockCallService).not.toHaveBeenCalled();
      });

      it('does not unlock for an answer that comes after the lock changed on its own', async () => {
        renderTiles([lock('locked')]);
        uiUtils.showConfirm.mockImplementationOnce(async () => {
          liveUpdate(lock('unlocked'));
          return true;
        });
        tile('lock.door').click();
        await flush();
        expect(mockCallService).not.toHaveBeenCalled();
      });

      it('locks in one click, without asking', async () => {
        renderTiles([lock('unlocked')]);
        tile('lock.door').click();
        await flush();
        expect(uiUtils.showConfirm).not.toHaveBeenCalled();
        expect(mockCallService).toHaveBeenCalledWith('lock', 'lock', { entity_id: 'lock.door' });
      });

      it('does not ask of a hotkey, which can fire while the widget is hidden', async () => {
        renderTiles([lock('locked')]);
        ui.executeHotkeyAction(lock('locked'), 'toggle');
        await flush();
        expect(uiUtils.showConfirm).not.toHaveBeenCalled();
        expect(mockCallService).toHaveBeenCalledWith('lock', 'unlock', { entity_id: 'lock.door' });
      });

      it('tells the Omarchy bar that a locked door answers with a dialog, so the widget comes up', () => {
        state.setStates({ 'lock.door': lock('locked') });
        expect(ui.describeQuickAccessTile('lock.door').action).toBe('dialog');
        state.setStates({ 'lock.door': lock('unlocked') });
        expect(ui.describeQuickAccessTile('lock.door').action).toBe('toggle');
      });
    });
  });

  describe('scenes, scripts and buttons', () => {
    it('tells a screen reader a scene ran, since its pulse is motion that reduced-motion drops', async () => {
      renderTiles([entity('scene.movie', 'unknown', { friendly_name: 'Movie time' })]);
      tile('scene.movie').click();
      await flush();
      expect(mockCallService).toHaveBeenCalledWith('scene', 'turn_on', {
        entity_id: 'scene.movie',
      });
      const announcer = document.getElementById('quick-access-announcer');
      expect(announcer.getAttribute('role')).toBe('status');
      expect(announcer.textContent).toBe('Activated Movie time');
    });

    it('does not announce a scene Home Assistant refused', async () => {
      mockCallService.mockRejectedValueOnce(new Error('Service failed'));
      renderTiles([entity('scene.movie', 'unknown', { friendly_name: 'Movie time' })]);
      tile('scene.movie').click();
      await flush();
      expect(document.getElementById('quick-access-announcer')).toBeNull();
    });
  });

  describe('the weather card', () => {
    const weatherCard = () => {
      document.getElementById('weather-card').innerHTML = `
        <div id="weather-icon"></div><div id="weather-temp"></div>
        <div id="weather-condition"></div><div id="weather-humidity"></div>
        <div id="weather-wind"></div>`;
    };
    const readout = () => ({
      temp: document.getElementById('weather-temp').textContent,
      condition: document.getElementById('weather-condition').textContent,
      humidity: document.getElementById('weather-humidity').textContent,
      wind: document.getElementById('weather-wind').textContent,
    });
    const showWeather = (weather) => {
      weatherCard();
      state.setConfig({ ...state.CONFIG, selectedWeatherEntity: 'weather.home' });
      state.setStates({ 'weather.home': weather });
      ui.updateWeatherFromHA();
    };

    it('shows what Home Assistant reported', () => {
      showWeather(
        entity('weather.home', 'cloudy', {
          temperature: 4.4,
          humidity: 81,
          wind_speed: 12,
          wind_speed_unit: 'km/h',
        })
      );
      expect(readout()).toEqual({
        temp: '4°C',
        condition: 'Cloudy',
        humidity: '81%',
        wind: '12\u00a0km/h',
      });
    });

    it('shows no readings, and says so, for an entity that is unavailable', () => {
      showWeather(entity('weather.home', 'unavailable', {}));
      expect(readout()).toEqual({
        temp: '--°',
        condition: 'Unavailable',
        humidity: '--',
        wind: '--',
      });
    });

    it('does not make up the readings an integration leaves out', () => {
      showWeather(entity('weather.home', 'sunny', { temperature: 0, wind_speed: 0 }));
      // A real zero is a reading; a missing humidity is not.
      expect(readout()).toEqual({
        temp: '0°C',
        condition: 'Sunny',
        humidity: '--',
        wind: '0\u00a0km/h',
      });
    });

    it('says an unknown state in the language, not as the raw word', () => {
      showWeather(entity('weather.home', 'unknown', {}));
      expect(readout().condition).toBe('Unknown');
    });

    it('draws no sun for a clear night, an offline entity or a state it does not know', () => {
      expect(ui.getWeatherEffectForState('clear-night')).toBeNull();
      expect(ui.getWeatherEffectForState('unavailable')).toBeNull();
      expect(ui.getWeatherEffectForState('unknown')).toBeNull();
      expect(ui.getWeatherEffectForState('something-new')).toBeNull();
      expect(ui.getWeatherEffectForState('sunny')).toBe('sunny');
      expect(ui.getWeatherEffectForState('snowy-rainy')).toBe('snowy');
    });
  });

  describe('the primary media card', () => {
    const cardMarkup = `
      <div class="media-tile" id="media-tile">
        <div class="media-tile-artwork" id="media-tile-artwork"></div>
        <div class="media-tile-content">
          <div class="media-tile-info">
            <div id="media-tile-title"></div><div id="media-tile-artist"></div>
          </div>
          <div class="media-tile-seek">
            <div id="media-tile-time-current"></div>
            <div class="media-tile-seek-bar"><div id="media-tile-seek-fill"></div></div>
            <div id="media-tile-time-total"></div>
          </div>
          <div class="media-tile-controls">
            <button id="media-tile-prev"></button><button id="media-tile-play"></button>
            <button id="media-tile-next"></button>
          </div>
        </div>
      </div>`;
    const show = (player) => {
      document.body.insertAdjacentHTML('beforeend', cardMarkup);
      state.setConfig({ ...state.CONFIG, primaryMediaPlayer: player.entity_id });
      state.setStates({ [player.entity_id]: player });
      ui.updateMediaTile();
    };
    const title = () => document.getElementById('media-tile-title').textContent;

    it.each([
      ['unavailable', 'Unavailable'],
      ['unknown', 'Unknown'],
      ['off', 'No media playing'],
      ['idle', 'No media playing'],
      ['playing', 'Playing'],
      ['paused', 'Paused'],
      ['on', 'Ready'],
    ])('says what a %s player is doing when it has no title: %s', (value, expected) => {
      show(entity('media_player.den', value));
      expect(title()).toBe(expected);
    });

    it('hides the seek row for a player with no length, and keeps its place', () => {
      show(entity('media_player.radio', 'playing', { media_title: 'Radio 4' }));
      const seek = document.querySelector('.media-tile-seek');
      expect(seek.dataset.empty).toBe('true');
      expect(document.getElementById('media-tile-time-total').textContent).toBe('--:--');
      state.setEntityState(
        entity('media_player.radio', 'playing', {
          media_title: 'Film',
          media_duration: 5400,
          media_position: 60,
        })
      );
      ui.updateMediaTile();
      expect(seek.dataset.empty).toBe('false');
      expect(document.getElementById('media-tile-time-total').textContent).toBe('1:30:00');
    });

    it('does not fetch the track id as if it were a picture', () => {
      show(
        entity('media_player.den', 'playing', {
          media_title: 'Song',
          media_content_id: 'spotify:track:abc',
        })
      );
      expect(document.querySelector('#media-tile-artwork img')).toBeNull();
    });

    it('keeps the picture it drew when the cache bucket rolls over', () => {
      const player = entity('media_player.den', 'playing', {
        media_title: 'Song',
        entity_picture: '/api/media_player_proxy/media_player.den?token=a',
        volume_level: 0.2,
      });
      show(player);
      const img = document.querySelector('#media-tile-artwork img');
      expect(img).not.toBeNull();
      // Half a minute later the proxy URL carries a new bucket; the next volume change must not
      // blank the art by drawing it again.
      jest.advanceTimersByTime(31000);
      state.setEntityState({ ...player, attributes: { ...player.attributes, volume_level: 0.3 } });
      ui.updateMediaTile();
      expect(document.querySelector('#media-tile-artwork img')).toBe(img);
      // A new track has a new picture.
      state.setEntityState({
        ...player,
        attributes: { ...player.attributes, entity_picture: '/api/media_player_proxy/x?token=b' },
      });
      ui.updateMediaTile();
      expect(document.querySelector('#media-tile-artwork img')).not.toBe(img);
    });

    describe('when its picture fails to load', () => {
      const playerWith = (picture, attributes = {}) =>
        entity('media_player.den', 'playing', {
          media_title: 'Song',
          entity_picture: `/api/media_player_proxy/media_player.den?token=${picture}`,
          volume_level: 0.2,
          ...attributes,
        });
      const artworkImage = () => document.querySelector('#media-tile-artwork img');
      const update = (player) => {
        state.setEntityState(player);
        ui.updateMediaTile();
      };
      const fail = (img) => img.dispatchEvent(new Event('error'));

      it('shows the placeholder and asks again after the retry delay, whatever else changes', () => {
        const player = playerWith('retry-a');
        show(player);
        fail(artworkImage());
        expect(artworkImage()).toBeNull();
        expect(document.querySelector('.media-tile-artwork-placeholder')).not.toBeNull();

        // Volume and position updates do not ask again inside the delay...
        update(playerWith('retry-a', { volume_level: 0.3 }));
        expect(artworkImage()).toBeNull();

        // ...but the first one after it does, though the title and state are the same.
        jest.advanceTimersByTime(31000);
        update(playerWith('retry-a', { volume_level: 0.4 }));
        expect(artworkImage()).not.toBeNull();
        expect(document.querySelector('.media-tile-artwork-placeholder')).toBeNull();
      });

      it('leaves the newer picture alone when an older one fails late', () => {
        show(playerWith('late-a'));
        const older = artworkImage();
        update(playerWith('late-b'));
        const newer = artworkImage();
        expect(newer).not.toBe(older);

        const uncaught = jest.fn();
        window.addEventListener('error', uncaught);
        fail(older);
        window.removeEventListener('error', uncaught);

        expect(uncaught).not.toHaveBeenCalled();
        expect(artworkImage()).toBe(newer);
        update(playerWith('late-b', { volume_level: 0.5 }));
        expect(artworkImage()).toBe(newer);
      });
    });

    it('opens the player dialog from its title and from its artwork', () => {
      show(entity('media_player.den', 'playing', { media_title: 'Song', friendly_name: 'Den' }));
      const info = document.querySelector('.media-tile-info');
      expect(info.getAttribute('role')).toBe('button');
      // Named by the title and artist it shows, which an aria-label would replace; what it does is
      // its description.
      expect(info.hasAttribute('aria-label')).toBe(false);
      expect(document.getElementById(info.getAttribute('aria-describedby')).textContent).toBe(
        'Controls for Den'
      );
      info.click();
      expect(document.querySelectorAll('.media-modal')).toHaveLength(1);
      document.querySelector('.media-modal .close-btn').click();
      document.querySelector('.media-tile-artwork').click();
      expect(document.querySelectorAll('.media-modal')).toHaveLength(1);
    });

    it('opens the dialog from the keyboard too', () => {
      show(entity('media_player.den', 'playing', { media_title: 'Song' }));
      document
        .querySelector('.media-tile-info')
        .dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
      expect(document.querySelectorAll('.media-modal')).toHaveLength(1);
    });
  });

  describe('sparklines', () => {
    const sensor = entity('sensor.office_temp', '21.4', {
      friendly_name: 'Office temp',
      unit_of_measurement: '°C',
      device_class: 'temperature',
      state_class: 'measurement',
    });

    it('draws a sensor that has not changed all day as a flat line, not a dot', async () => {
      mockRequest.mockResolvedValue({
        result: { 'sensor.office_temp': [{ s: '21.4', lu: Date.now() / 1000 - 3600 }] },
      });
      renderTiles([sensor]);
      await flush();
      const svg = tile('sensor.office_temp').querySelector('.control-sensor-sparkline-svg');
      expect(svg).not.toBeNull();
      expect(svg.querySelector('circle')).toBeNull();
      const points = svg
        .querySelector('polyline')
        .getAttribute('points')
        .split(' ')
        .map((point) => point.split(',').map(Number));
      expect(points).toHaveLength(2);
      expect(points[0][1]).toBe(points[1][1]);
      expect(points[1][0]).toBeGreaterThan(points[0][0]);
      expect(svg.querySelector('polyline').getAttribute('stroke-width')).toBe('2');
    });

    // The cache outlives a test, so each of these has a sensor of its own.
    const reading = (entityId, value, changedMinutesAgo = 0) => ({
      ...entity(entityId, value, { unit_of_measurement: '°C', state_class: 'measurement' }),
      last_changed: new Date(Date.now() - changedMinutesAgo * 60000).toISOString(),
    });
    const linePoints = (entityId) =>
      tile(entityId)
        .querySelector('.control-sensor-sparkline-svg polyline')
        .getAttribute('points')
        .split(' ')
        .map((point) => point.split(',').map(Number));

    it('draws a sensor with nothing recorded from its reading the first time, not the second', async () => {
      mockRequest.mockResolvedValue({ result: {} });
      renderTiles([reading('sensor.attic_temp', '17.2')]);
      await flush();
      expect(
        tile('sensor.attic_temp').querySelector('.control-sensor-sparkline-svg')
      ).not.toBeNull();
    });

    it('keeps the line a reading drew while the history that came back has nothing in it', async () => {
      let answer;
      mockRequest.mockImplementation(
        () =>
          new Promise((resolve) => {
            answer = resolve;
          })
      );
      renderTiles([reading('sensor.hall_temp', '19.5')]);
      // Drawn again before the answer comes back, which puts the reading into the series.
      ui.renderActiveTab();
      expect(
        tile('sensor.hall_temp').querySelector('.control-sensor-sparkline-svg')
      ).not.toBeNull();
      answer({ result: {} });
      await flush();
      expect(
        tile('sensor.hall_temp').querySelector('.control-sensor-sparkline-svg')
      ).not.toBeNull();
    });

    it('keeps a reading that is newer than the last row the history came back with', async () => {
      let answer;
      mockRequest.mockImplementation(
        () =>
          new Promise((resolve) => {
            answer = resolve;
          })
      );
      renderTiles([reading('sensor.porch_temp', '20', 90)]);
      liveUpdate(reading('sensor.porch_temp', '24', 1));
      answer({ result: { 'sensor.porch_temp': [{ s: '20', lu: Date.now() / 1000 - 90 * 60 }] } });
      await flush();
      const [first, ...rest] = linePoints('sensor.porch_temp');
      const last = rest[rest.length - 1];
      // The line climbs from the recorded 20 to the live 24 (the y axis points down).
      expect(last[1]).toBeLessThan(first[1]);
    });

    it('does not draw a reading twice when the history already holds it', async () => {
      mockRequest.mockResolvedValue({
        result: {
          'sensor.shed_temp': [
            { s: '20', lu: Date.now() / 1000 - 3600 },
            { s: '22', lu: Date.now() / 1000 - 60 },
          ],
        },
      });
      renderTiles([reading('sensor.shed_temp', '22', 1)]);
      await flush();
      expect(linePoints('sensor.shed_temp')).toHaveLength(2);
    });

    it('keeps the line one width however the viewBox is stretched', () => {
      const ruleFor = (selector) =>
        styles
          .split('}')
          .find((block) => block.includes(selector) && block.includes('non-scaling-stroke'));
      expect(ruleFor('.control-sensor-sparkline-svg polyline')).toContain('stroke-width: 1.5px');
      expect(ruleFor('.sensor-detail-sparkline-svg polyline')).toContain('stroke-width: 1.5px');
    });
  });

  describe('removing a tile in edit mode', () => {
    const removeFirstTile = async () => {
      ui.toggleReorganizeMode();
      document.querySelector('#quick-controls .control-item .remove-btn').click();
      await flush();
    };

    it('says a graph tile removes the graph, as the editor does, not its internal id', async () => {
      state.setConfig({
        ...state.CONFIG,
        comparisonGraphs: [
          { id: 'graph:lq9x3k7a', name: 'Temperatures', span: 2, entityIds: ['sensor.a'] },
        ],
        customTabs: [{ id: 'default', name: 'All', entityIds: ['graph:lq9x3k7a'] }],
        activeTabId: 'default',
        favoriteEntities: ['graph:lq9x3k7a'],
      });
      state.setStates({ 'sensor.a': entity('sensor.a', '1', { unit_of_measurement: '°C' }) });
      ui.renderActiveTab();
      await removeFirstTile();
      expect(uiUtils.showConfirm).toHaveBeenCalledWith(
        'Delete graph',
        'This removes the graph and its tile.',
        { confirmText: 'Delete', confirmClass: 'btn-danger' }
      );
    });

    it("names a tile the way it shows itself: with its custom name, not the entity's", async () => {
      state.setConfig({
        ...state.CONFIG,
        customEntityNames: { 'light.lamp': 'Reading light' },
      });
      renderTiles([entity('light.lamp', 'on', { friendly_name: 'Hue lamp 3' })]);
      await removeFirstTile();
      expect(uiUtils.showConfirm).toHaveBeenCalledWith(
        'Remove from Quick Access',
        // The page it is taken off, since the same entity on another page stays.
        'Remove "Reading light" from "Polish"?',
        { confirmText: 'Remove', confirmClass: 'btn-danger' }
      );
    });

    it('names a missing entity by its custom name, not by its id', async () => {
      state.setConfig({
        ...state.CONFIG,
        customEntityNames: { 'light.gone': 'Porch light' },
        customTabs: [{ id: 'default', name: 'All', entityIds: ['light.gone'] }],
        activeTabId: 'default',
        favoriteEntities: ['light.gone'],
      });
      // Home Assistant has reported its entities, and this is not one of them.
      state.setStates({ 'light.other': entity('light.other', 'off') });
      ui.renderActiveTab();
      await removeFirstTile();
      expect(uiUtils.showConfirm.mock.calls[0][1]).toBe('Remove "Porch light" from "All"?');
    });
  });

  describe('the comparison graph editor', () => {
    const sensors = ['a', 'b', 'c', 'd'].map((letter) =>
      entity(`sensor.${letter}`, '20', {
        friendly_name: `Sensor ${letter.toUpperCase()}`,
        unit_of_measurement: '°C',
        state_class: 'measurement',
      })
    );
    const openEditor = (entityIds) => {
      mockElectronAPI.updateConfig.mockImplementation(async (patch) => ({
        ...state.CONFIG,
        ...patch,
      }));
      state.setConfig({
        ...state.CONFIG,
        comparisonGraphs: [{ id: 'graph:g', name: 'Graph', span: 2, entityIds }],
        customTabs: [{ id: 'default', name: 'All', entityIds: ['graph:g'] }],
        activeTabId: 'default',
        favoriteEntities: ['graph:g'],
      });
      state.setStates(Object.fromEntries(sensors.map((item) => [item.entity_id, item])));
      ui.renderActiveTab();
      ui.toggleReorganizeMode();
      document.querySelector('#quick-controls .rename-btn').click();
      return document.querySelector('.comparison-graph-modal');
    };
    const names = (modal) =>
      [...modal.querySelectorAll('.entity-item .entity-name')].map((node) => node.textContent);

    it('leaves a row where it is when it is added or removed, and marks the sensors in the graph', async () => {
      const modal = openEditor(['sensor.b']);
      // What the graph had when the editor opened leads; the rest follow.
      expect(names(modal)).toEqual(['Sensor B', 'Sensor A', 'Sensor C', 'Sensor D']);
      const rowOf = (name) =>
        [...modal.querySelectorAll('.entity-item')].find(
          (row) => row.querySelector('.entity-name').textContent === name
        );

      rowOf('Sensor C').querySelector('button').click();
      await flush();
      expect(names(modal)).toEqual(['Sensor B', 'Sensor A', 'Sensor C', 'Sensor D']);
      const added = rowOf('Sensor C');
      expect(added.classList.contains('selected')).toBe(true);
      expect(added.querySelector('button').textContent).toBe('Remove');
      // It carries the colour of its line, the second one.
      expect(added.querySelector('.comparison-graph-swatch').style.background).toBe(
        'var(--chart-series-2)'
      );
      expect(rowOf('Sensor A').classList.contains('selected')).toBe(false);

      added.querySelector('button').click();
      await flush();
      expect(names(modal)).toEqual(['Sensor B', 'Sensor A', 'Sensor C', 'Sensor D']);
      expect(rowOf('Sensor C').classList.contains('selected')).toBe(false);
      expect(rowOf('Sensor C').querySelector('.comparison-graph-swatch')).toBeNull();
    });
  });

  describe('the cover dialog', () => {
    const cover = (value, attributes = {}) =>
      entity('cover.garage', value, { supported_features: 11, ...attributes });
    const open = (item) => {
      state.setStates({ [item.entity_id]: item });
      ui.openEntityControls(item);
      return document.querySelector('.cover-modal');
    };
    const overlay = () => document.getElementById('cover-overlay').style.height;

    it.each([
      ['open', '0%'],
      ['closed', '100%'],
      ['opening', '50%'],
      ['closing', '50%'],
    ])('draws a cover with no position from its state: %s', (value, expected) => {
      open(cover(value));
      expect(overlay()).toBe(expected);
    });

    it('draws a cover that has a position from the position', () => {
      open(cover('open', { current_position: 30, supported_features: 15 }));
      expect(overlay()).toBe('70%');
    });

    it('follows the state of a cover with no position, and moves its picture when told to open', async () => {
      open(cover('closed'));
      expect(overlay()).toBe('100%');
      document.querySelector('[data-action="open_cover"]').click();
      expect(overlay()).toBe('0%');
      // Home Assistant's answer to the command, then its states; a state pushed under a command
      // that is still pending is held until the command settles.
      await flush();
      state.setEntityState(cover('closed'));
      expect(overlay()).toBe('100%');
      state.setEntityState(cover('open'));
      expect(overlay()).toBe('0%');
    });

    it('stops with a square, not the bars of pause', () => {
      open(cover('open'));
      const stop = document.querySelector('[data-action="stop_cover"] .entity-line-icon');
      expect(stop.dataset.icon).toBe('square');
    });

    it('shows the position the cover settled on after a drag, though the slider keeps focus', async () => {
      open(cover('open', { current_position: 50, supported_features: 15 }));
      const slider = document.getElementById('cover-slider');
      slider.dispatchEvent(new Event('pointerdown'));
      inputValue('#cover-slider', 63);
      slider.dispatchEvent(new Event('pointerup'));
      await jest.advanceTimersByTimeAsync(400);
      state.setEntityState(cover('open', { current_position: 67, supported_features: 15 }));
      expect(slider.value).toBe('67');
      expect(document.getElementById('cover-position-value').textContent).toBe('67%');
      expect(slider.getAttribute('aria-valuetext')).toBe('67%');
    });

    it('rebuilds with its controls when a cover that was unavailable comes back', () => {
      const modal = open(entity('cover.garage', 'unavailable'));
      expect(modal.querySelector('#cover-slider')).toBeNull();
      state.setEntityState(cover('open', { current_position: 40, supported_features: 15 }));
      const rebuilt = document.querySelector('.cover-modal');
      expect(rebuilt.querySelector('#cover-slider').value).toBe('40');
      expect(document.querySelectorAll('.cover-modal')).toHaveLength(1);
    });

    it('goes unavailable when Home Assistant deletes the cover', () => {
      const modal = open(cover('open'));
      state.deleteEntityState('cover.garage');
      expect(modal.classList.contains('entity-unavailable')).toBe(true);
      expect(modal.querySelector('[data-action="open_cover"]').disabled).toBe(true);
    });
  });

  describe('the light dialog', () => {
    const light = (value, attributes = {}) =>
      entity('light.desk', value, { supported_color_modes: ['brightness'], ...attributes });
    const open = (item) => {
      state.setStates({ [item.entity_id]: item });
      ui.openEntityControls(item);
      return document.querySelector('.brightness-modal');
    };

    it('reads the dimmest a light can be as 1%, with its bulb lit', () => {
      const modal = open(light('on', { brightness: 1 }));
      expect(modal.querySelector('#brightness-value-large').textContent).toBe('1%');
      expect(modal.querySelector('#brightness-slider').value).toBe('1');
      expect(modal.querySelector('#brightness-icon .entity-line-icon').dataset.icon).toBe(
        'lightbulb'
      );
    });

    it('says the percentage to a screen reader, not the bare number', () => {
      const modal = open(light('on', { brightness: 128 }));
      const slider = modal.querySelector('#brightness-slider');
      expect(slider.getAttribute('aria-valuetext')).toBe('50%');
      expect(slider.hasAttribute('orient')).toBe(false);
      inputValue('#brightness-slider', 80);
      expect(slider.getAttribute('aria-valuetext')).toBe('80%');
    });

    it('rebuilds with its controls when a light that was unavailable comes back', () => {
      const modal = open(entity('light.desk', 'unavailable'));
      expect(modal.querySelector('#brightness-slider')).toBeNull();
      state.setEntityState(light('on', { brightness: 128 }));
      expect(document.querySelectorAll('.brightness-modal')).toHaveLength(1);
      expect(document.querySelector('#brightness-slider').value).toBe('50');
    });

    it('goes unavailable when Home Assistant deletes the light', () => {
      const modal = open(light('on', { brightness: 128 }));
      state.deleteEntityState('light.desk');
      expect(modal.classList.contains('entity-unavailable')).toBe(true);
      expect(modal.querySelector('#brightness-slider').disabled).toBe(true);
    });

    it('does not show a made-up colour temperature for a light in colour mode', () => {
      const rgb = light('on', {
        brightness: 128,
        supported_color_modes: ['color_temp', 'rgb'],
        color_mode: 'rgb',
        rgb_color: [255, 120, 40],
        min_color_temp_kelvin: 2000,
        max_color_temp_kelvin: 6500,
      });
      const modal = open(rgb);
      expect(modal.querySelector('#light-color-temp-value').textContent).toBe('—');
      expect(modal.querySelector('#light-color-temp-slider').classList.contains('is-unset')).toBe(
        true
      );
      // Moving it is the first reading it has.
      inputValue('#light-color-temp-slider', 3000);
      expect(modal.querySelector('#light-color-temp-value').textContent).toBe('3,000\u00a0K');
      expect(modal.querySelector('#light-color-temp-slider').classList.contains('is-unset')).toBe(
        false
      );
    });

    it('writes the colour temperature in the language and says it to a screen reader', () => {
      const lamp = light('on', {
        supported_color_modes: ['color_temp'],
        color_temp_kelvin: 3200,
        min_color_temp_kelvin: 2000,
        max_color_temp_kelvin: 6500,
      });
      const modal = open(lamp);
      const slider = modal.querySelector('#light-color-temp-slider');
      const readout = modal.querySelector('#light-color-temp-value');
      // A unit never wraps onto its own line, so the gap is a no-break space.
      expect(readout.textContent).toBe('3,200\u00a0K');
      expect(slider.getAttribute('aria-valuetext')).toBe('3,200\u00a0K');
      inputValue('#light-color-temp-slider', 4500);
      expect(readout.textContent).toBe('4,500\u00a0K');
      expect(slider.getAttribute('aria-valuetext')).toBe('4,500\u00a0K');

      // The same light in German: the thousands separator and the digits are the language's.
      document.querySelector('.brightness-modal')?.remove();
      i18n.setLocaleBootstrap({
        languageSetting: 'de',
        requestedLocale: 'de',
        activeLocale: 'de',
        messages: {},
      });
      const german = open(lamp);
      expect(german.querySelector('#light-color-temp-value').textContent).toMatch(
        /^3\.200[\u00a0\u202f]K$/
      );
      expect(
        german.querySelector('#light-color-temp-slider').getAttribute('aria-valuetext')
      ).toMatch(/^3\.200[\u00a0\u202f]K$/);
    });

    it('keeps the slider as it was for a live reading that is not a temperature', () => {
      const modal = open(
        light('on', {
          supported_color_modes: ['color_temp'],
          color_temp_kelvin: 3200,
          min_color_temp_kelvin: 2000,
          max_color_temp_kelvin: 6500,
        })
      );
      const slider = modal.querySelector('#light-color-temp-slider');
      // A light that reports a zero (or any reading that is not above zero) says nothing; the
      // slider and its readout keep the last real value, not "null".
      state.setEntityState(
        light('on', {
          supported_color_modes: ['color_temp'],
          color_temp_kelvin: 0,
          min_color_temp_kelvin: 2000,
          max_color_temp_kelvin: 6500,
        })
      );
      expect(slider.value).toBe('3200');
      expect(modal.querySelector('#light-color-temp-value').textContent).toBe('3,200\u00a0K');
      expect(slider.classList.contains('is-unset')).toBe(false);
      state.setEntityState(
        light('on', {
          supported_color_modes: ['color_temp'],
          color_temp_kelvin: 4100,
          min_color_temp_kelvin: 2000,
          max_color_temp_kelvin: 6500,
        })
      );
      expect(slider.value).toBe('4100');
      expect(modal.querySelector('#light-color-temp-value').textContent).toBe('4,100\u00a0K');
    });

    it('still shows a real colour temperature', () => {
      const modal = open(
        light('on', {
          supported_color_modes: ['color_temp'],
          color_temp_kelvin: 3200,
          min_color_temp_kelvin: 2000,
          max_color_temp_kelvin: 6500,
        })
      );
      expect(modal.querySelector('#light-color-temp-value').textContent).toBe('3,200\u00a0K');
    });
  });

  describe('the fan dialog', () => {
    const fan = (value, attributes = {}) =>
      entity('fan.office', value, { supported_features: 1, ...attributes });
    const open = (item) => {
      state.setStates({ [item.entity_id]: item });
      ui.openEntityControls(item);
      return document.querySelector('.fan-modal');
    };

    it('counts the speeds a fan has when it reports a step, and sends percents the fan accepts', async () => {
      const modal = open(fan('on', { percentage: 67, percentage_step: 33.333333 }));
      const slider = modal.querySelector('#fan-slider');
      expect(slider.max).toBe('3');
      expect(slider.value).toBe('2');
      expect(
        [...modal.querySelectorAll('.fan-preset-btn')].map((button) => [
          button.textContent,
          button.dataset.speed,
        ])
      ).toEqual([
        ['Off', '0'],
        ['Low', '33'],
        ['Medium', '67'],
        ['High', '100'],
      ]);
      inputValue('#fan-slider', 3);
      await jest.advanceTimersByTimeAsync(300);
      expect(mockCallService).toHaveBeenCalledWith('fan', 'set_percentage', {
        entity_id: 'fan.office',
        percentage: 100,
      });
      expect(modal.querySelector('#fan-speed-value').textContent).toBe('100%');
      expect(slider.getAttribute('aria-valuetext')).toBe('100%');
    });

    it('keeps whole percents for a fan whose step is a percent', () => {
      const modal = open(fan('on', { percentage: 40, percentage_step: 1 }));
      const slider = modal.querySelector('#fan-slider');
      expect(slider.max).toBe('100');
      expect(slider.value).toBe('40');
      expect(
        [...modal.querySelectorAll('.fan-preset-btn')].map((button) => button.dataset.speed)
      ).toEqual(['0', '33', '66', '100']);
    });

    it('shows the speed the fan settled on after a drag, though the slider keeps focus', async () => {
      const modal = open(fan('on', { percentage: 33, percentage_step: 33.333333 }));
      const slider = modal.querySelector('#fan-slider');
      slider.dispatchEvent(new Event('pointerdown'));
      inputValue('#fan-slider', 2);
      slider.dispatchEvent(new Event('pointerup'));
      await jest.advanceTimersByTimeAsync(300);
      state.setEntityState(fan('on', { percentage: 67, percentage_step: 33.333333 }));
      expect(slider.value).toBe('2');
      state.setEntityState(fan('on', { percentage: 100, percentage_step: 33.333333 }));
      expect(slider.value).toBe('3');
      expect(modal.querySelector('#fan-speed-value').textContent).toBe('100%');
    });

    it('rebuilds with its slider when the fan reports its speeds late', () => {
      const modal = open(entity('fan.office', 'on', { supported_features: 0 }));
      expect(modal.querySelector('#fan-slider')).toBeNull();
      state.setEntityState(fan('on', { percentage: 50 }));
      expect(document.querySelectorAll('.fan-modal')).toHaveLength(1);
      expect(document.querySelector('#fan-slider').value).toBe('50');
    });
  });

  describe('the climate dialog', () => {
    const climate = (value, attributes = {}) =>
      entity('climate.hall', value, {
        current_temperature: 20,
        temperature: 21,
        hvac_modes: ['off', 'auto', 'heat_cool'],
        min_temp: 7,
        max_temp: 30,
        supported_features: 1,
        ...attributes,
      });
    const open = (item) => {
      state.setStates({ [item.entity_id]: item });
      ui.openEntityControls(item);
      return document.querySelector('.climate-modal');
    };

    it('tells Heat/Cool from Auto by its icon', () => {
      const modal = open(climate('auto'));
      const icon = (mode) =>
        modal.querySelector(`.climate-mode-btn[data-mode="${mode}"] .entity-line-icon`).dataset
          .icon;
      expect(icon('auto')).toBe('refresh-cw');
      expect(icon('heat_cool')).not.toBe(icon('auto'));
    });

    it('says the temperature with its unit to a screen reader', () => {
      const modal = open(climate('heat', { temperature_unit: '°C' }));
      const slider = modal.querySelector('#climate-slider');
      expect(slider.getAttribute('aria-valuetext')).toBe('21°C');
      inputValue('#climate-slider', 22.5);
      expect(slider.getAttribute('aria-valuetext')).toBe('22.5°C');
    });

    it('follows the entity when Home Assistant deletes it, which a state event never says', () => {
      const modal = open(climate('heat'));
      state.deleteEntityState('climate.hall');
      expect(modal.classList.contains('entity-unavailable')).toBe(true);
      expect(modal.querySelector('#climate-slider').disabled).toBe(true);
    });

    it('updates the humidity it shows', () => {
      const modal = open(climate('heat', { current_humidity: 40 }));
      expect(modal.querySelector('#climate-humidity-value').textContent).toBe('40%');
      state.setEntityState(climate('heat', { current_humidity: 55 }));
      expect(modal.querySelector('#climate-humidity-value').textContent).toBe('55%');
    });

    it('does not say an unavailable thermostat advertises no controls', () => {
      const modal = open(entity('climate.hall', 'unavailable'));
      expect(modal.classList.contains('entity-unavailable')).toBe(true);
      expect(modal.querySelector('.climate-controls-unavailable')).toBeNull();
    });

    it('still says it for a thermostat that is up and offers nothing', () => {
      const modal = open(entity('climate.hall', 'off', { supported_features: 0 }));
      const note = modal.querySelector('.climate-controls-unavailable');
      expect(note).not.toBeNull();
      // The same class the unavailable dialog hides, so the paragraph is also styled.
      expect(note.classList.contains('control-capability-note')).toBe(true);
    });
  });

  describe('the sensor dialog', () => {
    it('opens the history of a number sensor that dropped out, which is when it is wanted', () => {
      const pool = entity('sensor.pool', 'unknown', {
        friendly_name: 'Pool temperature',
        unit_of_measurement: '°C',
        state_class: 'measurement',
      });
      state.setStates({ 'sensor.pool': pool });
      ui.openEntityControls(pool);
      const modal = document.querySelector('.sensor-detail-modal');
      expect(modal).not.toBeNull();
      expect(modal.querySelector('.sensor-history-controls')).not.toBeNull();
      expect(modal.classList.contains('entity-unavailable')).toBe(false);
      // Its history controls stay usable once it is marked unavailable, as the sensor is.
      state.setEntityState({ ...pool, state: 'unavailable' });
      expect(modal.classList.contains('entity-unavailable')).toBe(true);
      expect(modal.querySelector('.sensor-history-controls select').disabled).toBe(false);
      expect(modal.querySelector('.sensor-history-controls button').disabled).toBe(false);
    });

    it('keeps the toast for a text sensor with nothing to chart', () => {
      const text = entity('sensor.phase', 'unknown', { friendly_name: 'Moon phase' });
      state.setStates({ 'sensor.phase': text });
      ui.openEntityControls(text);
      expect(document.querySelector('.sensor-detail-modal')).toBeNull();
      expect(uiUtils.showToast).toHaveBeenCalledWith('Moon phase: Unknown', 'info', 3000);
    });

    it('does not read every reading out: its value is spoken at most once in a few seconds', async () => {
      const power = entity('sensor.power', '100', {
        friendly_name: 'Power',
        unit_of_measurement: 'W',
      });
      state.setStates({ 'sensor.power': power });
      ui.openEntityControls(power);
      const modal = document.querySelector('.sensor-detail-modal');
      const readout = modal.querySelector('.sensor-detail-readout');
      expect(readout.getAttribute('aria-live')).toBeNull();
      expect(readout.hasAttribute('aria-label')).toBe(false);
      const spoken = modal.querySelector('.sensor-detail-summary [role="status"]');
      await jest.advanceTimersByTimeAsync(0);
      expect(spoken.textContent).toBe('100\u00a0W');
      for (let watts = 101; watts <= 110; watts += 1) {
        state.setEntityState({ ...power, state: String(watts) });
        await jest.advanceTimersByTimeAsync(500);
      }
      expect(modal.querySelector('.sensor-detail-value').textContent).toBe('110');
      expect(spoken.textContent).not.toBe('110\u00a0W');
      await jest.advanceTimersByTimeAsync(9000);
      expect(spoken.textContent).toBe('110\u00a0W');
    });
  });

  describe('Tile Settings', () => {
    const openSettings = (item) => {
      state.setStates({ [item.entity_id]: item });
      renderTiles([item]);
      ui.toggleReorganizeMode();
      tile(item.entity_id).querySelector('.rename-btn').click();
      return document.querySelector('.rename-modal');
    };

    it('keeps the chart and gauge options for a number sensor that dropped out', () => {
      const modal = openSettings(
        entity('sensor.pool', 'unknown', {
          friendly_name: 'Pool',
          unit_of_measurement: '°C',
          state_class: 'measurement',
        })
      );
      expect(modal.querySelector('#tile-chart-type-select')).not.toBeNull();
    });

    it('keeps them for a sensor with a gauge saved, even with nothing else to go by', () => {
      state.setConfig({
        ...state.CONFIG,
        quickAccessTileOptions: {
          'sensor.pool': { chartType: 'gauge', gaugeMin: 0, gaugeMax: 40 },
        },
      });
      const modal = openSettings(entity('sensor.pool', 'unavailable', { friendly_name: 'Pool' }));
      expect(modal.querySelector('#tile-chart-type-select')).not.toBeNull();
    });

    it('does not offer them for a text sensor', () => {
      const modal = openSettings(entity('sensor.phase', 'unknown', { friendly_name: 'Moon' }));
      expect(modal.querySelector('#tile-chart-type-select')).toBeNull();
    });

    it('asks before Reset to Default drops the tile settings, and leaves them if declined', async () => {
      state.setConfig({
        ...state.CONFIG,
        customEntityNames: { 'sensor.pool': 'Pool' },
      });
      mockElectronAPI.updateConfig.mockImplementation(async (patch) => ({
        ...state.CONFIG,
        ...patch,
      }));
      const modal = openSettings(
        entity('sensor.pool', '21', {
          friendly_name: 'Pool temperature',
          unit_of_measurement: '°C',
        })
      );
      await flush();
      expect(
        [...modal.querySelectorAll('.modal-footer button')].map((button) => button.id)
      ).toEqual(['reset-rename-btn', 'cancel-rename-btn', 'save-rename-btn']);
      modal.querySelector('#reset-rename-btn').click();
      await flush();
      expect(uiUtils.showConfirm).toHaveBeenCalledWith(
        'Reset tile settings to defaults',
        'Are you sure?',
        { confirmText: 'Reset', confirmClass: 'btn-danger' }
      );
      expect(state.CONFIG.customEntityNames['sensor.pool']).toBe('Pool');
      expect(document.querySelector('.rename-modal')).toBe(modal);
    });
  });

  describe('the helper dialog', () => {
    const open = (item, services = {}) => {
      state.setServices(services);
      state.setStates({ [item.entity_id]: item });
      ui.openEntityControls(item);
      return document.querySelector('.helper-controls-modal');
    };

    it("lists the user's own options as written, and the ones that are states by their names", () => {
      const modal = open(
        entity('input_select.mode', 'home', {
          options: ['home', 'not_home', 'Movie night', 'eco boost'],
        }),
        { input_select: { select_option: {} } }
      );
      expect(
        [...modal.querySelectorAll('select option')].map((option) => [option.value, option.text])
      ).toEqual([
        ['home', 'Home'],
        ['not_home', 'Away'],
        ['Movie night', 'Movie night'],
        ['eco boost', 'eco boost'],
      ]);
    });

    it('draws the number once: the field says it, and the readout is only spoken', () => {
      const modal = open(entity('input_number.offset', '1.5', { min: -5, max: 5, step: 0.5 }), {
        input_number: { set_value: {} },
      });
      const readout = modal.querySelector('.helper-controls-readout');
      expect(modal.querySelector('input').value).toBe('1.5');
      expect(readout.textContent).toBe('1.5');
      expect(readout.classList.contains('sr-only')).toBe(true);
      expect(readout.getAttribute('role')).toBe('status');
    });

    it('draws the readout when it adds the unit, and for a helper with no field', () => {
      const withUnit = open(
        entity('input_number.offset', '1.5', {
          unit_of_measurement: '°C',
          min: -5,
          max: 5,
          step: 0.5,
        }),
        { input_number: { set_value: {} } }
      );
      const unitReadout = withUnit.querySelector('.helper-controls-readout');
      expect(unitReadout.classList.contains('sr-only')).toBe(false);
      expect(unitReadout.textContent).toBe('1.5°C');
      document.body.innerHTML = '';
      const vacuum = open(entity('vacuum.robot', 'docked'), { vacuum: { start: {} } });
      expect(vacuum.querySelector('.helper-controls-readout').classList.contains('sr-only')).toBe(
        false
      );
    });

    it('says why a value is refused, in the field, and sends nothing', () => {
      const modal = open(entity('input_number.offset', '1', { min: 0, max: 5, step: 1 }), {
        input_number: { set_value: {} },
      });
      const input = modal.querySelector('input');
      input.value = '9';
      const report = jest.spyOn(input, 'reportValidity').mockReturnValue(false);
      modal.querySelector('.modal-footer button').click();
      expect(report).toHaveBeenCalled();
      expect(uiUtils.showToast).not.toHaveBeenCalledWith('Invalid value', 'error');
      expect(mockCallService).not.toHaveBeenCalled();
    });

    it('names what went wrong when Home Assistant refuses', async () => {
      mockCallService.mockRejectedValueOnce(new Error('Value out of range'));
      const modal = open(
        entity('input_number.offset', '1', { friendly_name: 'Offset', min: 0, max: 5, step: 1 }),
        { input_number: { set_value: {} } }
      );
      modal.querySelector('input').value = '3';
      modal.querySelector('.modal-footer button').click();
      await flush();
      expect(uiUtils.showToast).toHaveBeenCalledWith(
        expect.stringContaining('Value out of range'),
        'error',
        4000
      );
    });
  });

  describe('the calendar dialog', () => {
    const openCalendar = async (events) => {
      mockCallServiceWithResponse.mockResolvedValue({ 'calendar.family': { events } });
      const calendar = entity('calendar.family', 'off', { friendly_name: 'Family' });
      state.setStates({ 'calendar.family': calendar });
      ui.openEntityControls(calendar);
      await flush();
      return document.querySelector('.calendar-modal');
    };
    const at = (hours) => new Date(Date.now() + hours * 3600000).toISOString();

    it('lists the events as a list, and announces the load without reading the agenda again', async () => {
      const modal = await openCalendar([
        { summary: 'Dentist', start: at(26), end: at(27), location: 'Riverside Dental' },
        { summary: 'Parents evening', start: at(74), end: at(76) },
      ]);
      const list = modal.querySelector('.calendar-events-list');
      expect(list.getAttribute('role')).toBe('list');
      expect([...list.children].map((row) => row.getAttribute('role'))).toEqual([
        'listitem',
        'listitem',
      ]);
      expect(list.hasAttribute('aria-live')).toBe(false);
      const status = modal.querySelector('[role="status"]');
      expect(status.textContent).toBe('Upcoming events for the next 7 days');
    });

    it('shows where an event is, when Home Assistant says', async () => {
      const modal = await openCalendar([
        {
          summary: 'Dentist',
          start: at(26),
          end: at(27),
          location: ' Riverside Dental, Mill Lane ',
        },
        { summary: 'Parents evening', start: at(74), end: at(76) },
      ]);
      const rows = modal.querySelectorAll('.calendar-event-row');
      expect(rows[0].querySelector('.calendar-event-location').textContent).toBe(
        'Riverside Dental, Mill Lane'
      );
      expect(rows[0].querySelector('.calendar-event-location .entity-line-icon').dataset.icon).toBe(
        'map-pin'
      );
      expect(rows[1].querySelector('.calendar-event-location')).toBeNull();
    });

    it('is not a list while it says there is nothing, or that it could not load', async () => {
      const modal = await openCalendar([]);
      const list = modal.querySelector('.calendar-events-list');
      expect(list.hasAttribute('role')).toBe(false);
      expect(modal.querySelector('[role="status"]').textContent).toBe('No upcoming events');
    });
  });

  describe('opening the same entity twice', () => {
    it('brings the open dialog forward instead of stacking an identical second one', () => {
      const lamp = entity('light.desk', 'on', {
        brightness: 128,
        supported_color_modes: ['brightness'],
      });
      state.setStates({ 'light.desk': lamp });
      ui.openEntityControls(lamp);
      ui.openEntityControls(lamp);
      expect(document.querySelectorAll('.brightness-modal')).toHaveLength(1);
      expect(document.querySelectorAll('#brightness-slider')).toHaveLength(1);
    });

    // A dialog that follows live state is rebuilt in place when its entity gains a control; the
    // rebuilt one is still the open dialog, so asking for the entity again must not stack another.
    it.each([
      [
        'light',
        '.brightness-modal',
        entity('light.desk', 'unavailable'),
        entity('light.desk', 'on', { supported_color_modes: ['brightness'], brightness: 128 }),
      ],
      [
        'cover',
        '.cover-modal',
        entity('cover.garage', 'unavailable'),
        entity('cover.garage', 'open', { current_position: 40, supported_features: 15 }),
      ],
      [
        'fan',
        '.fan-modal',
        entity('fan.office', 'on', { supported_features: 0 }),
        entity('fan.office', 'on', { supported_features: 1, percentage: 50 }),
      ],
      [
        'climate',
        '.climate-modal',
        entity('climate.hall', 'auto', {
          temperature: 21,
          hvac_modes: ['off', 'auto'],
          min_temp: 7,
          max_temp: 30,
          supported_features: 1,
        }),
        entity('climate.hall', 'auto', {
          temperature: 21,
          current_humidity: 40,
          hvac_modes: ['off', 'auto'],
          min_temp: 7,
          max_temp: 30,
          supported_features: 1,
        }),
      ],
      [
        'media player',
        '.media-modal',
        entity('media_player.den', 'playing', { friendly_name: 'Den', supported_features: 0 }),
        entity('media_player.den', 'playing', { friendly_name: 'Den', supported_features: 152463 }),
      ],
    ])(
      'finds the %s dialog again after it was rebuilt in place',
      (_name, selector, before, after) => {
        state.setStates({ [before.entity_id]: before });
        ui.openEntityControls(before);
        const opened = document.querySelector(selector);
        state.setEntityState(after);
        const rebuilt = document.querySelector(selector);
        expect(rebuilt).not.toBe(opened);
        expect(rebuilt.dataset.dialogEntityId).toBe(before.entity_id);

        ui.openEntityControls(after);

        expect(document.querySelectorAll(selector)).toHaveLength(1);
        expect(document.querySelectorAll('.modal')).toHaveLength(1);
      }
    );

    it('still opens a different entity beside it', () => {
      const lamp = entity('light.desk', 'on', { supported_color_modes: ['brightness'] });
      const fan = entity('fan.office', 'on', { supported_features: 1 });
      state.setStates({ 'light.desk': lamp, 'fan.office': fan });
      ui.openEntityControls(lamp);
      ui.openEntityControls(fan);
      expect(document.querySelectorAll('.brightness-modal')).toHaveLength(1);
      expect(document.querySelectorAll('.fan-modal')).toHaveLength(1);
    });
  });

  describe('the media dialog', () => {
    const title = 'Artist - Song (Remastered 2011) [Official Video] with a very long name indeed';
    const open = (attributes = {}) => {
      const player = entity('media_player.den', 'playing', {
        friendly_name: 'Den',
        media_title: title,
        media_artist: 'Some Very Long Artist Name feat. Another',
        supported_features: 152463,
        ...attributes,
      });
      state.setStates({ 'media_player.den': player });
      ui.openEntityControls(player);
      return document.querySelector('.media-modal');
    };

    it('carries the whole title and artist in a tooltip, and wraps them instead of cutting them', () => {
      const modal = open();
      const heading = modal.querySelector('.media-detail-title');
      expect(heading.textContent).toBe(title);
      expect(heading.title).toBe(title);
      expect(modal.querySelector('.media-detail-artist').title).toBe(
        'Some Very Long Artist Name feat. Another'
      );
      const rule = styles.split('}').find((block) => block.includes('.media-detail-title {'));
      expect(rule).toContain('-webkit-line-clamp: 3');
      expect(rule).not.toContain('white-space: nowrap');
    });

    it('says where it is playing, and shows the picture the player advertises', () => {
      const modal = open({
        app_name: 'Netflix',
        entity_picture: '/api/media_player_proxy/media_player.den?token=a',
      });
      expect(modal.querySelector('.media-detail-caption').textContent).toBe('Playing · Netflix');
      expect(modal.querySelector('.media-detail-artwork').hidden).toBe(false);
      expect(modal.querySelector('.media-detail-artwork img')).not.toBeNull();
    });

    it('keeps the newer picture when an older one fails after it was replaced', () => {
      const attributes = (token) => ({
        entity_picture: `/api/media_player_proxy/media_player.den?token=${token}`,
      });
      const modal = open(attributes('a'));
      const box = modal.querySelector('.media-detail-artwork');
      const older = box.querySelector('img');
      state.setEntityState(
        entity('media_player.den', 'playing', {
          friendly_name: 'Den',
          media_title: title,
          supported_features: 152463,
          ...attributes('b'),
        })
      );
      const newer = box.querySelector('img');
      expect(newer).not.toBe(older);

      older.dispatchEvent(new Event('error'));

      expect(box.querySelector('img')).toBe(newer);
      expect(box.hidden).toBe(false);
      // The picture that is on show failing still clears it.
      newer.dispatchEvent(new Event('error'));
      expect(box.querySelector('img')).toBeNull();
      expect(box.hidden).toBe(true);
    });

    describe('setting the volume', () => {
      const player = (attributes = {}) =>
        entity('media_player.den', 'playing', {
          friendly_name: 'Den',
          media_title: title,
          supported_features: 152463,
          volume_level: 0.5,
          ...attributes,
        });
      // The arrow keys change a range input without ever pressing it, so no pointer event is sent.
      const keyboardStep = (slider, value) => {
        slider.value = String(value);
        slider.dispatchEvent(new Event('input', { bubbles: true }));
      };

      it('keeps a volume set with the arrow keys while the player has not answered yet', async () => {
        let answer;
        mockCallService.mockImplementation(
          () =>
            new Promise((resolve) => {
              answer = resolve;
            })
        );
        const modal = open({ volume_level: 0.5 });
        const slider = modal.querySelector('#media-volume-slider');
        const readout = modal.querySelector('#media-volume-value');
        keyboardStep(slider, 60);

        // A position update inside the 150 ms debounce still carries the old volume.
        state.setEntityState(player({ media_position: 12 }));
        expect(slider.value).toBe('60');
        expect(readout.textContent).toBe('60%');

        await jest.advanceTimersByTimeAsync(150);
        expect(mockCallService).toHaveBeenCalledWith('media_player', 'volume_set', {
          entity_id: 'media_player.den',
          volume_level: 0.6,
        });
        // And so does one while the command is on its way.
        state.setEntityState(player({ media_position: 13 }));
        expect(slider.value).toBe('60');

        // The player settles on the new volume; the reply then changes nothing.
        state.setEntityState(player({ volume_level: 0.6 }));
        answer({ success: true });
        await jest.advanceTimersByTimeAsync(0);
        expect(slider.value).toBe('60');

        // After that the dialog follows the player again, from any other client too.
        state.setEntityState(player({ volume_level: 0.3 }));
        expect(slider.value).toBe('30');
        expect(readout.textContent).toBe('30%');
      });

      it('shows what the player reported meanwhile once the command is answered', async () => {
        let answer;
        mockCallService.mockImplementation(
          () =>
            new Promise((resolve) => {
              answer = resolve;
            })
        );
        const modal = open({ volume_level: 0.5 });
        const slider = modal.querySelector('#media-volume-slider');
        keyboardStep(slider, 60);
        await jest.advanceTimersByTimeAsync(150);

        // Someone else turned it down while this command was pending.
        state.setEntityState(player({ volume_level: 0.2 }));
        expect(slider.value).toBe('60');
        answer({ success: true });
        await jest.advanceTimersByTimeAsync(0);

        expect(slider.value).toBe('20');
      });

      it('goes back to the volume the player has when the command fails', async () => {
        mockCallService.mockRejectedValue(new Error('refused'));
        const modal = open({ volume_level: 0.5 });
        const slider = modal.querySelector('#media-volume-slider');
        keyboardStep(slider, 60);
        await jest.advanceTimersByTimeAsync(150);
        await jest.advanceTimersByTimeAsync(0);

        expect(slider.value).toBe('50');
        expect(modal.querySelector('#media-volume-value').textContent).toBe('50%');
      });
    });

    it('draws no picture from a track id', () => {
      const modal = open({ media_content_id: 'spotify:track:abc' });
      expect(modal.querySelector('.media-detail-artwork').hidden).toBe(true);
    });

    it('names its progress bar for a screen reader, which cannot seek in it', () => {
      const modal = open({ media_duration: 200, media_position: 50 });
      const bar = modal.querySelector('.media-progress-track');
      expect(bar.getAttribute('role')).toBe('progressbar');
      expect(bar.getAttribute('aria-valuenow')).toBe('25');
      expect(document.getElementById(bar.getAttribute('aria-labelledby')).textContent).toBe(
        'Position'
      );
    });

    it('shows the volume the player settled on after a drag, though the slider keeps focus', () => {
      const modal = open({ volume_level: 0.4 });
      const slider = modal.querySelector('#media-volume-slider');
      slider.dispatchEvent(new Event('pointerdown'));
      state.setEntityState(
        entity('media_player.den', 'playing', {
          friendly_name: 'Den',
          media_title: title,
          supported_features: 152463,
          volume_level: 0.5,
        })
      );
      expect(slider.value).toBe('40');
      slider.dispatchEvent(new Event('pointerup'));
      expect(slider.value).toBe('50');
      expect(modal.querySelector('#media-volume-value').textContent).toBe('50%');
      expect(slider.getAttribute('aria-valuetext')).toBe('50%');
    });
  });

  describe('Quick Access media tiles', () => {
    const player = (value, attributes = {}) =>
      entity('media_player.den', value, { friendly_name: 'Den', ...attributes });
    const lineOf = () => tile('media_player.den').querySelector('.media-title').textContent;

    it.each([
      ['unavailable', 'Unavailable'],
      ['unknown', 'Unknown'],
      ['off', 'No media'],
      ['standby', 'No media'],
      ['playing', 'Playing'],
      ['paused', 'Paused'],
      ['on', 'Ready'],
    ])('says what a %s player is doing when it has no title: %s', (value, expected) => {
      renderTiles([player(value)]);
      expect(lineOf()).toBe(expected);
    });

    it('shows the title when there is one, whatever the state', () => {
      renderTiles([player('playing', { media_title: 'Song', media_artist: 'Band' })]);
      expect(lineOf()).toBe('Song');
    });

    it('keeps its picture when the cache bucket rolls over', () => {
      const attributes = {
        media_title: 'Song',
        entity_picture: '/api/media_player_proxy/a?token=1',
      };
      renderTiles([player('playing', attributes)]);
      const img = tile('media_player.den').querySelector('.media-player-artwork');
      expect(img).not.toBeNull();
      jest.advanceTimersByTime(31000);
      liveUpdate(player('playing', { ...attributes, volume_level: 0.3 }));
      expect(tile('media_player.den').querySelector('.media-player-artwork')).toBe(img);
    });

    it('draws no picture for a player that is unavailable, or from a track id', () => {
      renderTiles([
        player('unavailable', { media_title: 'Song', entity_picture: '/api/media_player_proxy/a' }),
      ]);
      expect(tile('media_player.den').querySelector('.media-player-artwork')).toBeNull();
      renderTiles([
        player('playing', { media_title: 'Song', media_content_id: 'spotify:track:abc' }),
      ]);
      expect(tile('media_player.den').querySelector('.media-player-artwork')).toBeNull();
    });
  });
});

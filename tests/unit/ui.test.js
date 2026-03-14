/**
 * @jest-environment jsdom
 */

const fs = require('fs');
const path = require('path');
const { createMockElectronAPI, resetMockElectronAPI, getMockConfig } = require('../mocks/electron.js');
const desktopPinStyles = fs.readFileSync(path.resolve(__dirname, '../../styles.css'), 'utf8');

// Setup mocks BEFORE loading modules
const mockElectronAPI = createMockElectronAPI();
window.electronAPI = mockElectronAPI;

// Mock dependencies
jest.mock('../../src/camera.js', () => ({
  openCamera: jest.fn()
}));

jest.mock('../../src/ui-utils.js', () => ({
  showToast: jest.fn(),
  showConfirm: jest.fn().mockResolvedValue(false),
  showLoading: jest.fn(),
  setStatus: jest.fn(),
  applyTheme: jest.fn(),
  applyUiPreferences: jest.fn()
}));

jest.mock('../../src/icons.js', () => ({
  setIconContent: jest.fn()
}));

jest.mock('sortablejs', () => ({
  create: jest.fn(() => ({
    destroy: jest.fn()
  }))
}));

// Mock WebSocket callService method
const mockCallService = jest.fn().mockResolvedValue({});

jest.mock('../../src/websocket.js', () => ({
  callService: mockCallService,
  on: jest.fn(),
  emit: jest.fn()
}));

// Import modules after mocks
const ui = require('../../src/ui.js');
const state = require('../../src/state.js').default;
const uiUtils = require('../../src/ui-utils.js');
const camera = require('../../src/camera.js');
const {
  sampleConfig,
  sampleStates,
  sampleServices,
  sampleAreas,
  sampleUnitSystemMetric: sampleUnitSystem,
  sampleWebSocketMessages: wsMessages
} = require('../fixtures/ha-data.js');

describe('UI Rendering - Selective Business Logic Tests (ui.js)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    resetMockElectronAPI();
    document.head.innerHTML = `<style>${desktopPinStyles}</style>`;
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 168 });
    Object.defineProperty(window, 'innerHeight', { configurable: true, value: 148 });

    // Reset WebSocket mock
    mockCallService.mockClear();
    mockCallService.mockResolvedValue({ ...wsMessages.callServiceResponse });

    // Create comprehensive DOM structure
    document.body.innerHTML = `
      <div id="quick-controls"></div>
      <div class="desktop-pin-shell">
        <div id="desktop-pin-content" class="desktop-pin-content"></div>
        <div id="desktop-pin-empty" class="desktop-pin-empty hidden">
          <div id="desktop-pin-empty-kicker"></div>
          <div id="desktop-pin-empty-title"></div>
          <div id="desktop-pin-empty-copy"></div>
          <div id="desktop-pin-empty-actions" class="desktop-pin-empty-actions hidden">
            <button id="desktop-pin-focus-btn" type="button"></button>
          </div>
        </div>
      </div>
      <div id="desktop-pin-entity-label"></div>
      <button id="desktop-pin-open-btn" type="button"></button>
      <button id="desktop-pin-unpin-btn" type="button"></button>

      <div id="weather-card">
        <div id="weather-icon"></div>
        <div id="weather-temp"></div>
        <div id="weather-condition"></div>
        <div id="weather-humidity"></div>
        <div id="weather-wind"></div>
      </div>

      <div id="media-tile" style="display: none;">
        <div id="media-tile-artwork">
          <div class="media-tile-artwork-placeholder"></div>
        </div>
        <div id="media-tile-title"></div>
        <div id="media-tile-artist"></div>
        <div id="media-tile-seek-fill"></div>
        <div id="media-tile-time-current"></div>
        <div id="media-tile-time-total"></div>
        <button id="media-tile-play"></button>
        <button id="media-tile-prev"></button>
        <button id="media-tile-next"></button>
      </div>

      <div id="current-time"></div>
      <div id="current-date"></div>

      <button id="reorganize-quick-controls-btn"></button>
    `;

    // Reset state
    const config = {
      ...getMockConfig(),
      ...sampleConfig,
      ui: { ...sampleConfig.ui }
    };
    config.favoriteEntities = [];
    config.selectedWeatherEntity = null;
    config.primaryMediaPlayer = sampleConfig.primaryMediaPlayer || 'media_player.spotify';
    state.setConfig(config);
    state.setStates({});
    state.setServices({ ...sampleServices });
    state.setAreas({ ...sampleAreas });
    state.setUnitSystem({ ...sampleUnitSystem });
  });

  // ==============================================================================
  // GROUP 1: Service Routing & Entity Controls (14 tests)
  // Note: toggleEntity is not exported, tested indirectly through executeHotkeyAction
  // ==============================================================================

  afterEach(() => {
    const quickControls = document.getElementById('quick-controls');
    if (quickControls?.classList.contains('reorganize-mode')) {
      ui.toggleReorganizeMode();
    }
  });

  describe('executeHotkeyAction', () => {
    beforeEach(() => {
      jest.useFakeTimers();
    });

    afterEach(() => {
      jest.useRealTimers();
    });

    const flushAsync = async () => {
      await Promise.resolve();
      jest.advanceTimersByTime(0);
      await Promise.resolve();
    };
    const getBedroomLightOnState = () => ({
      ...sampleStates['light.bedroom'],
      state: 'on',
      attributes: {
        ...sampleStates['light.bedroom'].attributes,
        friendly_name: 'Bedroom Light',
        brightness: 200
      }
    });
    const getBedroomLightOffState = () => ({
      ...sampleStates['light.bedroom'],
      state: 'off',
      attributes: {
        ...sampleStates['light.bedroom'].attributes,
        friendly_name: 'Bedroom Light',
        brightness: 0
      }
    });

    it('should execute toggle action', () => {
      const entity = {
        entity_id: 'light.bedroom',
        state: 'on'
      };

      ui.executeHotkeyAction(entity, 'toggle');

      expect(mockCallService).toHaveBeenCalledWith(
        'light',
        'turn_off',
        { entity_id: 'light.bedroom' }
      );
    });

    it('should execute turn_on action', () => {
      const entity = {
        entity_id: 'switch.fan',
        state: 'off'
      };

      ui.executeHotkeyAction(entity, 'turn_on');

      expect(mockCallService).toHaveBeenCalledWith(
        'switch',
        'turn_on',
        { entity_id: 'switch.fan' }
      );
    });

    it('should execute turn_off action', () => {
      const entity = {
        entity_id: 'switch.fan',
        state: 'on'
      };

      ui.executeHotkeyAction(entity, 'turn_off');

      expect(mockCallService).toHaveBeenCalledWith(
        'switch',
        'turn_off',
        { entity_id: 'switch.fan' }
      );
    });

    it('should increase brightness by 51 (20%)', () => {
      const entity = {
        entity_id: 'light.bedroom',
        state: 'on',
        attributes: { brightness: 100 }
      };

      ui.executeHotkeyAction(entity, 'brightness_up');

      expect(mockCallService).toHaveBeenCalledWith(
        'light',
        'turn_on',
        {
          entity_id: 'light.bedroom',
          brightness: 151
        }
      );
    });

    it('should clamp brightness to 255 max', () => {
      const entity = {
        entity_id: 'light.bedroom',
        state: 'on',
        attributes: { brightness: 220 }
      };

      ui.executeHotkeyAction(entity, 'brightness_up');

      expect(mockCallService).toHaveBeenCalledWith(
        'light',
        'turn_on',
        {
          entity_id: 'light.bedroom',
          brightness: 255
        }
      );
    });

    it('should decrease brightness by 51 (20%)', () => {
      const entity = {
        entity_id: 'light.bedroom',
        state: 'on',
        attributes: { brightness: 200 }
      };

      ui.executeHotkeyAction(entity, 'brightness_down');

      expect(mockCallService).toHaveBeenCalledWith(
        'light',
        'turn_on',
        {
          entity_id: 'light.bedroom',
          brightness: 149
        }
      );
    });

    it('should clamp brightness to 0 min', () => {
      const entity = {
        entity_id: 'light.bedroom',
        state: 'on',
        attributes: { brightness: 30 }
      };

      ui.executeHotkeyAction(entity, 'brightness_down');

      expect(mockCallService).toHaveBeenCalledWith(
        'light',
        'turn_on',
        {
          entity_id: 'light.bedroom',
          brightness: 0
        }
      );
    });

    it('should handle missing brightness attribute', () => {
      const entity = {
        entity_id: 'light.bedroom',
        state: 'on',
        attributes: {}
      };

      ui.executeHotkeyAction(entity, 'brightness_up');

      expect(mockCallService).toHaveBeenCalledWith(
        'light',
        'turn_on',
        {
          entity_id: 'light.bedroom',
          brightness: 51 // 0 + 51
        }
      );
    });

    it('should increase fan speed by 33%', () => {
      const entity = {
        entity_id: 'fan.bedroom',
        state: 'on',
        attributes: { percentage: 50 }
      };

      ui.executeHotkeyAction(entity, 'increase_speed');

      expect(mockCallService).toHaveBeenCalledWith(
        'fan',
        'set_percentage',
        {
          entity_id: 'fan.bedroom',
          percentage: 83
        }
      );
    });

    it('should clamp fan speed to 100 max', () => {
      const entity = {
        entity_id: 'fan.bedroom',
        state: 'on',
        attributes: { percentage: 80 }
      };

      ui.executeHotkeyAction(entity, 'increase_speed');

      expect(mockCallService).toHaveBeenCalledWith(
        'fan',
        'set_percentage',
        {
          entity_id: 'fan.bedroom',
          percentage: 100
        }
      );
    });

    it('should decrease fan speed by 33%', () => {
      const entity = {
        entity_id: 'fan.bedroom',
        state: 'on',
        attributes: { percentage: 66 }
      };

      ui.executeHotkeyAction(entity, 'decrease_speed');

      expect(mockCallService).toHaveBeenCalledWith(
        'fan',
        'set_percentage',
        {
          entity_id: 'fan.bedroom',
          percentage: 33
        }
      );
    });

    it('should trigger automation', () => {
      const entity = {
        entity_id: 'automation.morning_routine',
        state: 'on'
      };

      ui.executeHotkeyAction(entity, 'trigger');

      expect(mockCallService).toHaveBeenCalledWith(
        'automation',
        'trigger',
        { entity_id: 'automation.morning_routine' }
      );
    });

    it('should default to toggle for unknown action', () => {
      const entity = {
        entity_id: 'light.bedroom',
        state: 'on',
        attributes: { friendly_name: 'Bedroom Light' }
      };

      ui.executeHotkeyAction(entity, 'unknown_action');

      expect(mockCallService).toHaveBeenCalledWith(
        'light',
        'turn_off',
        { entity_id: 'light.bedroom' }
      );
    });

    it('should coalesce rapid toggles while a request is in-flight and apply final state', async () => {
      let resolveFirstCall;
      mockCallService
        .mockImplementationOnce(() => new Promise(resolve => { resolveFirstCall = resolve; }))
        .mockResolvedValue({ ...wsMessages.callServiceResponse });

      const entity = getBedroomLightOnState();

      ui.executeHotkeyAction(entity, 'toggle'); // on -> off (in-flight)
      ui.executeHotkeyAction(entity, 'toggle'); // off -> on (queued)

      expect(mockCallService).toHaveBeenCalledTimes(1);
      expect(mockCallService).toHaveBeenNthCalledWith(1, 'light', 'turn_off', { entity_id: 'light.bedroom' });

      resolveFirstCall({});
      await flushAsync();
      await flushAsync();

      expect(mockCallService).toHaveBeenCalledTimes(2);
      expect(mockCallService).toHaveBeenNthCalledWith(2, 'light', 'turn_on', { entity_id: 'light.bedroom' });
    });

    it('should keep second toggle queued when state_changed arrives before first call settles', async () => {
      let resolveFirstCall;
      mockCallService
        .mockImplementationOnce(() => new Promise(resolve => { resolveFirstCall = resolve; }))
        .mockResolvedValue({ ...wsMessages.callServiceResponse });

      state.setStates({
        'light.bedroom': getBedroomLightOnState()
      });

      ui.executeHotkeyAction(state.STATES['light.bedroom'], 'toggle'); // on -> off (in-flight)
      expect(mockCallService).toHaveBeenCalledTimes(1);
      expect(mockCallService).toHaveBeenNthCalledWith(1, 'light', 'turn_off', { entity_id: 'light.bedroom' });

      // Mirror renderer flow: first commit websocket event into state, then update UI.
      const serverOffState = getBedroomLightOffState();
      state.setEntityState(serverOffState);
      ui.updateEntityInUI(serverOffState);

      // Second toggle should queue while the first request is still unresolved.
      ui.executeHotkeyAction(state.STATES['light.bedroom'], 'toggle'); // off -> on (queued)
      expect(mockCallService).toHaveBeenCalledTimes(1);

      resolveFirstCall({});
      await flushAsync();
      await flushAsync();

      expect(mockCallService).toHaveBeenCalledTimes(2);
      expect(mockCallService).toHaveBeenNthCalledWith(2, 'light', 'turn_on', { entity_id: 'light.bedroom' });
    });

    it('should send only the final intent when rapid taps end on original state', async () => {
      let resolveFirstCall;
      mockCallService
        .mockImplementationOnce(() => new Promise(resolve => { resolveFirstCall = resolve; }))
        .mockResolvedValue({ ...wsMessages.callServiceResponse });

      const entity = getBedroomLightOnState();

      ui.executeHotkeyAction(entity, 'toggle'); // on -> off
      ui.executeHotkeyAction(entity, 'toggle'); // off -> on
      ui.executeHotkeyAction(entity, 'toggle'); // on -> off (final)

      expect(mockCallService).toHaveBeenCalledTimes(1);
      expect(mockCallService).toHaveBeenNthCalledWith(1, 'light', 'turn_off', { entity_id: 'light.bedroom' });

      resolveFirstCall({});
      await flushAsync();
      await flushAsync();

      // Final desired state equals first request, so no extra call is needed.
      expect(mockCallService).toHaveBeenCalledTimes(1);
    });

    it('should apply optimistic UI immediately and keep desired state during conflicting server updates', async () => {
      state.setConfig({
        ...sampleConfig,
        ui: { ...sampleConfig.ui },
        favoriteEntities: ['light.bedroom']
      });
      state.setStates({
        'light.bedroom': getBedroomLightOnState()
      });
      ui.renderActiveTab();

      let resolveFirstCall;
      mockCallService.mockImplementationOnce(() => new Promise(resolve => { resolveFirstCall = resolve; }));

      ui.executeHotkeyAction(state.STATES['light.bedroom'], 'toggle');

      const optimisticTile = document.querySelector('.control-item[data-entity-id="light.bedroom"] .control-state');
      expect(optimisticTile).toBeTruthy();
      expect(optimisticTile.textContent).toBe('Off');

      ui.updateEntityInUI(getBedroomLightOnState());
      const stillOptimisticTile = document.querySelector('.control-item[data-entity-id="light.bedroom"] .control-state');
      expect(stillOptimisticTile.textContent).toBe('Off');

      ui.updateEntityInUI(getBedroomLightOffState());
      const reconciledTile = document.querySelector('.control-item[data-entity-id="light.bedroom"] .control-state');
      expect(reconciledTile.textContent).toBe('Off');

      resolveFirstCall({});
      await flushAsync();
    });

    it('should revert optimistic state when service call fails', async () => {
      state.setConfig({
        ...sampleConfig,
        ui: { ...sampleConfig.ui },
        favoriteEntities: ['light.bedroom']
      });
      state.setStates({
        'light.bedroom': getBedroomLightOnState()
      });
      ui.renderActiveTab();

      mockCallService.mockRejectedValueOnce(new Error('network timeout'));

      ui.executeHotkeyAction(state.STATES['light.bedroom'], 'toggle');
      await flushAsync();
      await flushAsync();

      const tileState = document.querySelector('.control-item[data-entity-id="light.bedroom"] .control-state');
      expect(tileState).toBeTruthy();
      expect(tileState.textContent).toContain('%');
      expect(uiUtils.showToast).toHaveBeenCalledWith(
        expect.stringContaining('Failed to control'),
        'error',
        4000
      );
    });
  });

  describe('callMediaTileService', () => {
    it('should call media_play service', () => {
      ui.callMediaTileService('play');

      expect(mockCallService).toHaveBeenCalledWith(
        'media_player',
        'media_play',
        { entity_id: 'media_player.spotify' }
      );
    });

    it('should call media_pause service', () => {
      ui.callMediaTileService('pause');

      expect(mockCallService).toHaveBeenCalledWith(
        'media_player',
        'media_pause',
        { entity_id: 'media_player.spotify' }
      );
    });

    it('should call media_next_track service', () => {
      ui.callMediaTileService('next');

      expect(mockCallService).toHaveBeenCalledWith(
        'media_player',
        'media_next_track',
        { entity_id: 'media_player.spotify' }
      );
    });

    it('should call media_previous_track service', () => {
      // Action is 'previous', not 'prev'
      ui.callMediaTileService('previous');

      expect(mockCallService).toHaveBeenCalledWith(
        'media_player',
        'media_previous_track',
        { entity_id: 'media_player.spotify' }
      );
    });
  });

  // ==============================================================================
  // GROUP 2: Config Management (2 tests)
  // Note: toggleQuickAccess, saveQuickAccessOrder, removeFromQuickAccess not exported
  // ==============================================================================

  describe('selectWeatherEntity', () => {
    it('should update config with selected weather entity', async () => {
      await ui.selectWeatherEntity('weather.home');

      expect(mockElectronAPI.updateConfig).toHaveBeenCalledWith(
        expect.objectContaining({
          selectedWeatherEntity: 'weather.home'
        })
      );
    });

    it('should show success toast when entity exists', async () => {
      // Entity must exist in STATES for toast to show
      state.setStates({
        'weather.home': {
          entity_id: 'weather.home',
          state: 'sunny',
          attributes: { friendly_name: 'Home Weather' }
        }
      });

      await ui.selectWeatherEntity('weather.home');

      expect(uiUtils.showToast).toHaveBeenCalledWith(
        expect.stringContaining('Home Weather'),
        'success',
        2000
      );
    });
  });

  // ==============================================================================
  // GROUP 3: Data Transformation (15 tests)
  // ==============================================================================

  describe('updateWeatherFromHA', () => {
    beforeEach(() => {
      state.setStates({
        'weather.home': {
          entity_id: 'weather.home',
          state: 'sunny',
          attributes: {
            friendly_name: 'Home Weather',
            temperature: 22,
            humidity: 65,
            wind_speed: 5.5,
            wind_speed_unit: 'm/s'
          }
        }
      });
    });

    it('should update temperature display', () => {
      ui.updateWeatherFromHA();

      const tempEl = document.getElementById('weather-temp');
      expect(tempEl.textContent).toContain('22');
    });

    it('should update condition display', () => {
      ui.updateWeatherFromHA();

      const conditionEl = document.getElementById('weather-condition');
      expect(conditionEl.textContent).toBe('sunny');
    });

    it('should update humidity display', () => {
      ui.updateWeatherFromHA();

      const humidityEl = document.getElementById('weather-humidity');
      expect(humidityEl.textContent).toBe('65%');
    });

    it('should convert wind speed from m/s to km/h when no entity unit', () => {
      // Remove wind_speed_unit from entity to trigger conversion
      state.setStates({
        'weather.home': {
          entity_id: 'weather.home',
          state: 'sunny',
          attributes: {
            friendly_name: 'Home Weather',
            temperature: 22,
            humidity: 65,
            wind_speed: 5.5
            // No wind_speed_unit - will use UNIT_SYSTEM and convert
          }
        }
      });

      // Set UNIT_SYSTEM to metric (default)
      state.setUnitSystem({ wind_speed: 'm/s' });

      ui.updateWeatherFromHA();

      const windEl = document.getElementById('weather-wind');
      // 5.5 m/s * 3.6 = 19.8, rounded = 20
      expect(windEl.textContent).toContain('20');
      expect(windEl.textContent).toContain('km/h');
    });

    it('should use entity wind_speed_unit when available', () => {
      state.setStates({
        'weather.home': {
          entity_id: 'weather.home',
          state: 'sunny',
          attributes: {
            temperature: 22,
            humidity: 65,
            wind_speed: 10,
            wind_speed_unit: 'mph'
          }
        }
      });

      ui.updateWeatherFromHA();

      const windEl = document.getElementById('weather-wind');
      expect(windEl.textContent).toContain('10');
      expect(windEl.textContent).toContain('mph');
    });

    it('should set sunny icon for clear/sunny conditions', () => {
      state.setStates({
        'weather.home': {
          entity_id: 'weather.home',
          state: 'sunny',
          attributes: { temperature: 22, humidity: 65, wind_speed: 5 }
        }
      });

      ui.updateWeatherFromHA();

      const iconEl = document.getElementById('weather-icon');
      expect(iconEl.textContent).toBe('☀️');
    });

    it('should set rainy icon for rainy/pouring conditions', () => {
      state.setStates({
        'weather.home': {
          entity_id: 'weather.home',
          state: 'rainy',
          attributes: { temperature: 18, humidity: 85, wind_speed: 8 }
        }
      });

      ui.updateWeatherFromHA();

      const iconEl = document.getElementById('weather-icon');
      expect(iconEl.textContent).toBe('🌧️');
    });

    it('should set snowy icon for snowy conditions', () => {
      state.setStates({
        'weather.home': {
          entity_id: 'weather.home',
          state: 'snowy',
          attributes: { temperature: -2, humidity: 75, wind_speed: 10 }
        }
      });

      ui.updateWeatherFromHA();

      const iconEl = document.getElementById('weather-icon');
      expect(iconEl.textContent).toBe('❄️');
    });

    it('should use selected weather entity when configured', () => {
      const config = state.CONFIG;
      config.selectedWeatherEntity = 'weather.home';
      state.setConfig(config);

      state.setStates({
        'weather.home': {
          entity_id: 'weather.home',
          state: 'sunny',
          attributes: { temperature: 22, humidity: 65, wind_speed: 5 }
        },
        'weather.forecast': {
          entity_id: 'weather.forecast',
          state: 'cloudy',
          attributes: { temperature: 18, humidity: 70, wind_speed: 3 }
        }
      });

      ui.updateWeatherFromHA();

      const conditionEl = document.getElementById('weather-condition');
      expect(conditionEl.textContent).toBe('sunny');
    });

    it('should fallback to alphabetically first weather entity', () => {
      const config = state.CONFIG;
      config.selectedWeatherEntity = null;
      state.setConfig(config);

      state.setStates({
        'weather.forecast': {
          entity_id: 'weather.forecast',
          state: 'cloudy',
          attributes: { temperature: 18, humidity: 70, wind_speed: 3 }
        },
        'weather.home': {
          entity_id: 'weather.home',
          state: 'sunny',
          attributes: { temperature: 22, humidity: 65, wind_speed: 5 }
        }
      });

      ui.updateWeatherFromHA();

      // Should use weather.forecast (alphabetically first)
      const conditionEl = document.getElementById('weather-condition');
      expect(conditionEl.textContent).toBe('cloudy');
    });

    it('keeps weather visibility target aligned with displayed fallback entity', () => {
      const config = state.CONFIG;
      config.selectedWeatherEntity = null;
      config.primaryCards = ['weather', 'time'];
      state.setConfig(config);

      // Insert weather entities in reverse display-name order.
      state.setStates({
        'weather.zeta': {
          entity_id: 'weather.zeta',
          state: 'sunny',
          attributes: { friendly_name: 'Zeta Weather', temperature: 28, humidity: 45, wind_speed: 2 }
        },
        'weather.alpha': {
          entity_id: 'weather.alpha',
          state: 'cloudy',
          attributes: { friendly_name: 'Alpha Weather', temperature: 19, humidity: 60, wind_speed: 4 }
        }
      });

      ui.renderActiveTab();

      const conditionEl = document.getElementById('weather-condition');
      expect(conditionEl.textContent).toBe('cloudy');
      expect(ui.isEntityVisible('weather.alpha')).toBe(true);
      expect(ui.isEntityVisible('weather.zeta')).toBe(false);
    });

    it('should handle missing weather entity gracefully', () => {
      state.setStates({});

      expect(() => {
        ui.updateWeatherFromHA();
      }).not.toThrow();
    });
  });

  describe('updateMediaSeekBar', () => {
    const createMediaEntityFromFixture = (attributeOverrides = {}, options = {}) => {
      const fallbackEntityId = sampleConfig.primaryMediaPlayer || 'media_player.spotify';
      const selectedEntityId = options.entity_id || options.entityId || fallbackEntityId;
      const baseEntity = sampleStates[selectedEntityId] || sampleStates[fallbackEntityId] || sampleStates['media_player.spotify'];
      const baseAttributes = { ...(baseEntity.attributes || {}) };

      // Keep edge-case expectations deterministic by avoiding elapsed-time adjustment.
      delete baseAttributes.media_position_updated_at;

      return {
        ...baseEntity,
        entity_id: options.entity_id || options.entityId || baseEntity.entity_id,
        state: options.state || 'paused',
        attributes: options.withoutAttributes
          ? undefined
          : {
            ...baseAttributes,
            ...attributeOverrides
          }
      };
    };

    it('should calculate progress percentage', () => {
      const entity = {
        entity_id: 'media_player.spotify',
        state: 'playing',
        attributes: {
          media_position: 120,
          media_duration: 300
        }
      };

      ui.updateMediaSeekBar(entity);

      const seekFill = document.getElementById('media-tile-seek-fill');
      expect(seekFill.style.width).toBe('40%'); // 120/300 = 0.4
    });

    it('should format current time as mm:ss', () => {
      const entity = {
        entity_id: 'media_player.spotify',
        state: 'playing',
        attributes: {
          media_position: 125,
          media_duration: 300
        }
      };

      ui.updateMediaSeekBar(entity);

      const currentTime = document.getElementById('media-tile-time-current');
      expect(currentTime.textContent).toBe('2:05');
    });

    it('should format total time as mm:ss', () => {
      const entity = {
        entity_id: 'media_player.spotify',
        state: 'playing',
        attributes: {
          media_position: 60,
          media_duration: 245
        }
      };

      ui.updateMediaSeekBar(entity);

      const totalTime = document.getElementById('media-tile-time-total');
      expect(totalTime.textContent).toBe('4:05');
    });

    it('should handle missing duration gracefully', () => {
      const entity = {
        entity_id: 'media_player.spotify',
        state: 'playing',
        attributes: {
          media_position: 60
        }
      };

      expect(() => {
        ui.updateMediaSeekBar(entity);
      }).not.toThrow();

      const seekFill = document.getElementById('media-tile-seek-fill');
      expect(seekFill.style.width).toBe('0%');
    });

    it('should handle NaN values gracefully', () => {
      const entity = {
        entity_id: 'media_player.spotify',
        state: 'playing',
        attributes: {
          media_position: 'invalid',
          media_duration: 'invalid'
        }
      };

      expect(() => {
        ui.updateMediaSeekBar(entity);
      }).not.toThrow();
    });

    /**
     * Ensures missing timeline values always fall back to 0:00 and 0% seek width.
     */
    it.each([
      ['null', null, null],
      ['undefined', undefined, undefined],
      ['empty string', '', '']
    ])(
      'should fallback to zeroed timeline when position/duration are %s',
      (_label, mediaPosition, mediaDuration) => {
        const entity = createMediaEntityFromFixture(
          {
            media_position: mediaPosition,
            media_duration: mediaDuration
          },
          {
            entity_id: 'media_player.spotify',
            state: 'playing'
          }
        );

        ui.updateMediaSeekBar(entity);

        const currentTime = document.getElementById('media-tile-time-current');
        const totalTime = document.getElementById('media-tile-time-total');
        const seekFill = document.getElementById('media-tile-seek-fill');

        expect(currentTime.textContent).toBe('0:00');
        expect(totalTime.textContent).toBe('0:00');
        expect(seekFill.style.width).toBe('0%');
      }
    );

    it.each([
      ['null', null],
      ['undefined', undefined],
      ['empty string', '']
    ])('should handle %s media position/duration values from fixture entities', (_label, value) => {
      const entity = createMediaEntityFromFixture({
        media_position: value,
        media_duration: value
      });

      expect(() => {
        ui.updateMediaSeekBar(entity);
      }).not.toThrow();

      const currentTime = document.getElementById('media-tile-time-current');
      const totalTime = document.getElementById('media-tile-time-total');
      const seekFill = document.getElementById('media-tile-seek-fill');
      expect(currentTime.textContent).toBe('0:00');
      expect(totalTime.textContent).toBe('0:00');
      expect(seekFill.style.width).toBe('0%');
    });

    it('should handle missing media attributes object from fixture entities', () => {
      const entity = createMediaEntityFromFixture({}, { withoutAttributes: true });

      expect(() => {
        ui.updateMediaSeekBar(entity);
      }).not.toThrow();

      const currentTime = document.getElementById('media-tile-time-current');
      const totalTime = document.getElementById('media-tile-time-total');
      const seekFill = document.getElementById('media-tile-seek-fill');
      expect(currentTime.textContent).toBe('0:00');
      expect(totalTime.textContent).toBe('0:00');
      expect(seekFill.style.width).toBe('0%');
    });

    /**
     * Verifies parsed current time is preserved even when duration is unavailable.
     */
    it.each([
      ['null', null],
      ['undefined', undefined],
      ['empty string', '']
    ])(
      'should show parsed current time and zero total when duration is %s',
      (_label, mediaDuration) => {
        const entity = createMediaEntityFromFixture(
          {
            media_position: '65:30',
            media_duration: mediaDuration
          },
          {
            entity_id: 'media_player.spotify',
            state: 'playing'
          }
        );

        ui.updateMediaSeekBar(entity);

        const currentTime = document.getElementById('media-tile-time-current');
        const totalTime = document.getElementById('media-tile-time-total');
        const seekFill = document.getElementById('media-tile-seek-fill');

        expect(currentTime.textContent).toBe('1:05:30');
        expect(totalTime.textContent).toBe('0:00');
        expect(seekFill.style.width).toBe('0%');
      }
    );


    it('should keep advancing current time when duration is unavailable', () => {
      const nowSpy = jest.spyOn(Date, 'now').mockReturnValue(1700000000000);
      try {
        const entity = {
          entity_id: 'media_player.spotify',
          state: 'playing',
          attributes: {
            media_position: 60,
            media_position_updated_at: '2023-11-14T22:13:10.000Z'
          }
        };

        ui.updateMediaSeekBar(entity);

        const currentTime = document.getElementById('media-tile-time-current');
        const totalTime = document.getElementById('media-tile-time-total');
        const seekFill = document.getElementById('media-tile-seek-fill');
        expect(currentTime.textContent).toBe('1:10');
        expect(totalTime.textContent).toBe('0:00');
        expect(seekFill.style.width).toBe('0%');
      } finally {
        nowSpy.mockRestore();
      }
    });

    it('should ignore future media_position_updated_at timestamps', () => {
      const nowSpy = jest.spyOn(Date, 'now').mockReturnValue(1700000000000);
      try {
        const entity = {
          entity_id: 'media_player.spotify',
          state: 'playing',
          attributes: {
            media_position: 90,
            media_duration: 300,
            media_position_updated_at: '2023-11-14T22:13:30.000Z'
          }
        };

        ui.updateMediaSeekBar(entity);

        const currentTime = document.getElementById('media-tile-time-current');
        const seekFill = document.getElementById('media-tile-seek-fill');
        expect(currentTime.textContent).toBe('1:30');
        expect(parseFloat(seekFill.style.width)).toBeCloseTo(30, 5);
      } finally {
        nowSpy.mockRestore();
      }
    });

    it('should parse time-formatted position and duration values', () => {
      const entity = {
        entity_id: 'media_player.spotify',
        state: 'playing',
        attributes: {
          media_position: '0:02:05',
          media_duration: '1:05:00'
        }
      };

      ui.updateMediaSeekBar(entity);

      const currentTime = document.getElementById('media-tile-time-current');
      const totalTime = document.getElementById('media-tile-time-total');
      const seekFill = document.getElementById('media-tile-seek-fill');
      expect(currentTime.textContent).toBe('2:05');
      expect(totalTime.textContent).toBe('1:05:00');
      expect(parseFloat(seekFill.style.width)).toBeCloseTo(3.205, 2);
    });
  });

  // ==============================================================================
  // GROUP 4: Rendering Functions (1 test)
  // Note: renderQuickControls, createControlElement, createUnavailableElement not exported
  // Testing renderActiveTab which orchestrates rendering
  // ==============================================================================

  describe('renderActiveTab', () => {
    it('should not throw errors when called', () => {
      const config = state.CONFIG;
      config.favoriteEntities = [];
      state.setConfig(config);
      state.setStates({});

      expect(() => {
        ui.renderActiveTab();
      }).not.toThrow();
    });

    it('should render an icon for timer entities in quick access', () => {
      const config = state.CONFIG;
      config.favoriteEntities = ['timer.kitchen'];
      config.customEntityIcons = { 'timer.kitchen': '🔥' };
      state.setConfig(config);

      state.setStates({
        'timer.kitchen': {
          entity_id: 'timer.kitchen',
          state: 'active',
          attributes: {
            friendly_name: 'Kitchen Timer',
            remaining: '0:10:00'
          }
        }
      });

      ui.renderActiveTab();

      const timerTile = document.querySelector('.control-item.timer-entity[data-entity-id="timer.kitchen"]');
      expect(timerTile).toBeTruthy();
      const timerIcon = timerTile.querySelector('.control-icon.timer-icon');
      expect(timerIcon).toBeTruthy();
      expect(timerIcon.textContent).toContain('🔥');
    });

    it('re-renders climate tiles when temperature attributes change', () => {
      const config = state.CONFIG;
      config.favoriteEntities = ['climate.living_room'];
      state.setConfig(config);

      state.setStates({
        'climate.living_room': {
          entity_id: 'climate.living_room',
          state: 'heat',
          attributes: {
            friendly_name: 'Living Room',
            current_temperature: 70,
            temperature: 72
          }
        }
      });

      ui.renderActiveTab();

      let climateState = document.querySelector('.control-item[data-entity-id="climate.living_room"] .control-state');
      expect(climateState).toBeTruthy();
      expect(climateState.textContent).toContain('70');

      state.setStates({
        'climate.living_room': {
          entity_id: 'climate.living_room',
          state: 'heat',
          attributes: {
            friendly_name: 'Living Room',
            current_temperature: 71,
            temperature: 72
          }
        }
      });

      ui.renderActiveTab();

      climateState = document.querySelector('.control-item[data-entity-id="climate.living_room"] .control-state');
      expect(climateState).toBeTruthy();
      expect(climateState.textContent).toContain('71');
    });

    it('updates timer tick targets when a visible sensor becomes timer-like', () => {
      const config = state.CONFIG;
      config.favoriteEntities = ['sensor.kitchen_status'];
      state.setConfig(config);

      state.setStates({
        'sensor.kitchen_status': {
          entity_id: 'sensor.kitchen_status',
          state: 'idle',
          attributes: {
            friendly_name: 'Kitchen Status'
          }
        }
      });

      ui.renderActiveTab();
      expect(ui.getTickTargets().hasVisibleTimers).toBe(false);

      const finishesAt = new Date(Date.now() + 60_000).toISOString();
      const timerLikeEntity = {
        entity_id: 'sensor.kitchen_status',
        state: 'active',
        attributes: {
          friendly_name: 'Kitchen Status',
          finishes_at: finishesAt
        }
      };

      state.setEntityState(timerLikeEntity);
      ui.updateEntityInUI(timerLikeEntity);

      expect(ui.getTickTargets().hasVisibleTimers).toBe(true);
    });

    it('shows the pin button only in reorganize mode and pins directly from the tile', async () => {
      const config = {
        ...state.CONFIG,
        favoriteEntities: ['light.bedroom'],
        desktopPins: {}
      };
      state.setConfig(config);
      state.setStates({
        'light.bedroom': {
          entity_id: 'light.bedroom',
          state: 'off',
          attributes: {
            friendly_name: 'Bedroom Light'
          }
        }
      });

      ui.renderActiveTab();

      expect(document.querySelector('.control-item[data-entity-id="light.bedroom"] .desktop-pin-quick-toggle')).toBeNull();

      ui.toggleReorganizeMode();
      expect(mockElectronAPI.setDesktopPinEditMode).toHaveBeenCalledWith(true);

      const pinButton = document.querySelector('.control-item[data-entity-id="light.bedroom"] .desktop-pin-quick-toggle');
      expect(pinButton).toBeTruthy();
      expect(pinButton.textContent).toBe('Pin');

      pinButton.click();
      await Promise.resolve();
      await Promise.resolve();

      expect(mockElectronAPI.pinEntityToDesktop).toHaveBeenCalledWith('light.bedroom');
      expect(state.CONFIG.desktopPins).toEqual(expect.objectContaining({
        'light.bedroom': expect.any(Object)
      }));
    });

    it('shows pinned state in reorganize mode and allows unpinning directly', async () => {
      const config = {
        ...state.CONFIG,
        favoriteEntities: ['light.bedroom'],
        desktopPins: {
          'light.bedroom': { x: 10, y: 20, width: 168, height: 148 }
        }
      };
      state.setConfig(config);
      state.setStates({
        'light.bedroom': {
          entity_id: 'light.bedroom',
          state: 'on',
          attributes: {
            friendly_name: 'Bedroom Light',
            brightness: 180
          }
        }
      });

      ui.renderActiveTab();

      expect(document.querySelector('.control-item[data-entity-id="light.bedroom"] .desktop-pin-quick-toggle')).toBeNull();

      ui.toggleReorganizeMode();
      expect(mockElectronAPI.setDesktopPinEditMode).toHaveBeenCalledWith(true);

      const pinButton = document.querySelector('.control-item[data-entity-id="light.bedroom"] .desktop-pin-quick-toggle');
      expect(pinButton).toBeTruthy();
      expect(pinButton.textContent).toBe('Pinned');

      pinButton.click();
      await Promise.resolve();
      await Promise.resolve();

      expect(mockElectronAPI.unpinEntityFromDesktop).toHaveBeenCalledWith('light.bedroom');
      expect(state.CONFIG.desktopPins?.['light.bedroom']).toBeUndefined();

      ui.toggleReorganizeMode();
      expect(mockElectronAPI.setDesktopPinEditMode).toHaveBeenLastCalledWith(false);
    });

    const setDesktopPinViewport = (width, height) => {
      Object.defineProperty(window, 'innerWidth', { configurable: true, value: width });
      Object.defineProperty(window, 'innerHeight', { configurable: true, value: height });
    };

    it('keeps Focus Main available while waiting for the first live update', () => {
      ui.renderDesktopPinnedTile('light.bedroom', null, { hasSnapshot: false });

      const emptyState = document.getElementById('desktop-pin-empty');
      const content = document.getElementById('desktop-pin-content');
      const openBtn = document.getElementById('desktop-pin-open-btn');
      const focusBtn = document.getElementById('desktop-pin-focus-btn');
      const focusActions = document.getElementById('desktop-pin-empty-actions');

      expect(emptyState?.dataset.state).toBe('waiting');
      expect(emptyState?.classList.contains('hidden')).toBe(false);
      expect(content?.classList.contains('hidden')).toBe(true);
      expect(content?.getAttribute('aria-hidden')).toBe('true');
      expect(document.getElementById('desktop-pin-empty-title')?.textContent).toBe('Waiting for first live update');
      expect(openBtn?.disabled).toBe(true);
      expect(openBtn?.getAttribute('aria-disabled')).toBe('true');
      expect(openBtn?.title).toBe('Open becomes available when this tile has live data');
      expect(focusActions?.classList.contains('hidden')).toBe(false);
      expect(focusBtn?.disabled).toBe(false);
      expect(focusBtn?.getAttribute('aria-disabled')).toBe('false');
    });

    it('enables Open and removes Focus Main for a live pinned entity', () => {
      state.setStates({
        'light.bedroom': {
          ...sampleStates['light.bedroom'],
          state: 'on',
          attributes: {
            ...sampleStates['light.bedroom'].attributes,
            friendly_name: 'Bedroom Light',
            brightness: 180
          }
        }
      });

      ui.renderDesktopPinnedTile('light.bedroom', state.STATES['light.bedroom']);

      const emptyState = document.getElementById('desktop-pin-empty');
      const content = document.getElementById('desktop-pin-content');
      const openBtn = document.getElementById('desktop-pin-open-btn');
      const focusBtn = document.getElementById('desktop-pin-focus-btn');
      const focusActions = document.getElementById('desktop-pin-empty-actions');

      expect(emptyState?.classList.contains('hidden')).toBe(true);
      expect(content?.classList.contains('hidden')).toBe(false);
      expect(content?.getAttribute('aria-hidden')).toBe(null);
      expect(document.querySelector('#desktop-pin-content .desktop-pin-light-control')).toBeTruthy();
      expect(openBtn?.disabled).toBe(false);
      expect(openBtn?.getAttribute('aria-disabled')).toBe('false');
      expect(openBtn?.title).toBe('Open in main widget');
      expect(focusActions?.classList.contains('hidden')).toBe(true);
      expect(focusBtn?.disabled).toBe(true);
      expect(focusBtn?.getAttribute('aria-disabled')).toBe('true');
    });

    it('shows the missing-entity fallback after a snapshot with the right copy and disabled Open button', () => {
      ui.renderDesktopPinnedTile('light.bedroom', null, { hasSnapshot: true });

      const emptyState = document.getElementById('desktop-pin-empty');
      const openBtn = document.getElementById('desktop-pin-open-btn');
      const focusBtn = document.getElementById('desktop-pin-focus-btn');
      const focusActions = document.getElementById('desktop-pin-empty-actions');

      expect(emptyState?.dataset.state).toBe('missing');
      expect(document.getElementById('desktop-pin-empty-kicker')?.textContent).toBe('Missing entity');
      expect(document.getElementById('desktop-pin-empty-title')?.textContent).toBe('Pinned entity not found');
      expect(document.getElementById('desktop-pin-empty-copy')?.textContent).toBe('This tile could not find its entity in the latest Home Assistant data. It may have been renamed, removed, or is no longer exposed.');
      expect(openBtn?.disabled).toBe(true);
      expect(openBtn?.getAttribute('aria-disabled')).toBe('true');
      expect(focusActions?.classList.contains('hidden')).toBe(false);
      expect(focusBtn?.disabled).toBe(false);
      expect(focusBtn?.getAttribute('aria-disabled')).toBe('false');
    });

    it('shows the unavailable fallback with the same focus/open behavior as other non-live states', () => {
      state.setStates({
        'light.bedroom': {
          ...sampleStates['light.bedroom'],
          state: 'unavailable',
          attributes: {
            ...sampleStates['light.bedroom'].attributes,
            friendly_name: 'Bedroom Light'
          }
        }
      });

      ui.renderDesktopPinnedTile('light.bedroom', state.STATES['light.bedroom'], { hasSnapshot: true });

      const emptyState = document.getElementById('desktop-pin-empty');
      const content = document.getElementById('desktop-pin-content');
      const openBtn = document.getElementById('desktop-pin-open-btn');
      const focusBtn = document.getElementById('desktop-pin-focus-btn');
      const focusActions = document.getElementById('desktop-pin-empty-actions');

      expect(emptyState?.dataset.state).toBe('unavailable');
      expect(content?.classList.contains('hidden')).toBe(true);
      expect(document.getElementById('desktop-pin-empty-kicker')?.textContent).toBe('Unavailable');
      expect(document.getElementById('desktop-pin-empty-title')?.textContent).toBe('Bedroom Light is unavailable');
      expect(document.getElementById('desktop-pin-empty-copy')?.textContent).toBe('Latest Home Assistant data reports this entity as unavailable right now.');
      expect(openBtn?.disabled).toBe(true);
      expect(openBtn?.getAttribute('aria-disabled')).toBe('true');
      expect(focusActions?.classList.contains('hidden')).toBe(false);
      expect(focusBtn?.disabled).toBe(false);
      expect(focusBtn?.getAttribute('aria-disabled')).toBe('false');
    });

    it.each([
      ['waiting', null, { hasSnapshot: false }],
      ['missing', null, { hasSnapshot: true }],
      ['unavailable', {
        ...sampleStates['light.bedroom'],
        state: 'unavailable'
      }, { hasSnapshot: true }]
    ])('removes live content from layout for the %s fallback at minimum tile bounds', (expectedState, entity, options) => {
      setDesktopPinViewport(140, 110);

      ui.renderDesktopPinnedTile('light.bedroom', entity, options);

      const content = document.getElementById('desktop-pin-content');
      const emptyState = document.getElementById('desktop-pin-empty');
      const contentStyles = window.getComputedStyle(content);
      const emptyStyles = window.getComputedStyle(emptyState);

      expect(emptyState?.dataset.state).toBe(expectedState);
      expect(content?.classList.contains('hidden')).toBe(true);
      expect(content?.getAttribute('aria-hidden')).toBe('true');
      expect(contentStyles.display).toBe('none');
      expect(emptyStyles.flexGrow).toBe('1');
      expect(emptyStyles.minHeight).toMatch(/^0(?:px)?$/);
    });

    it('restores live content to layout again when real data returns at minimum tile bounds', () => {
      setDesktopPinViewport(140, 110);

      ui.renderDesktopPinnedTile('light.bedroom', null, { hasSnapshot: false });

      state.setStates({
        'light.bedroom': {
          ...sampleStates['light.bedroom'],
          state: 'on',
          attributes: {
            ...sampleStates['light.bedroom'].attributes,
            friendly_name: 'Bedroom Light',
            brightness: 160
          }
        }
      });

      ui.renderDesktopPinnedTile('light.bedroom', state.STATES['light.bedroom']);

      const content = document.getElementById('desktop-pin-content');
      const emptyState = document.getElementById('desktop-pin-empty');

      expect(content?.classList.contains('hidden')).toBe(false);
      expect(content?.hasAttribute('aria-hidden')).toBe(false);
      expect(window.getComputedStyle(content).display).toBe('flex');
      expect(emptyState?.classList.contains('hidden')).toBe(true);
      expect(document.querySelector('#desktop-pin-content .desktop-pin-light-control')).toBeTruthy();
    });

    it('shows a disconnected fallback when a connection issue is present', () => {
      state.setStates({
        'light.bedroom': {
          ...sampleStates['light.bedroom']
        }
      });

      ui.renderDesktopPinnedTile('light.bedroom', state.STATES['light.bedroom'], {
        hasSnapshot: true,
        connectionIssue: 'Unable to reach Home Assistant. Check your network or Home Assistant URL.'
      });

      const content = document.getElementById('desktop-pin-content');
      const emptyState = document.getElementById('desktop-pin-empty');
      const openBtn = document.getElementById('desktop-pin-open-btn');
      const focusBtn = document.getElementById('desktop-pin-focus-btn');
      const focusActions = document.getElementById('desktop-pin-empty-actions');

      expect(emptyState?.dataset.state).toBe('disconnected');
      expect(emptyState?.classList.contains('hidden')).toBe(false);
      expect(content?.classList.contains('hidden')).toBe(true);
      expect(content?.getAttribute('aria-hidden')).toBe('true');
      expect(document.getElementById('desktop-pin-empty-title')?.textContent).toBe('Home Assistant unavailable');
      expect(document.getElementById('desktop-pin-empty-copy')?.textContent).toBe('Unable to reach Home Assistant. Check your network or Home Assistant URL.');
      expect(content?.childElementCount).toBe(0);
      expect(openBtn?.disabled).toBe(true);
      expect(openBtn?.getAttribute('aria-disabled')).toBe('true');
      expect(focusActions?.classList.contains('hidden')).toBe(false);
      expect(focusBtn?.disabled).toBe(false);
      expect(focusBtn?.getAttribute('aria-disabled')).toBe('false');
    });

    it('renders compact desktop light controls with inline presets', async () => {
      jest.useFakeTimers();

      state.setStates({
        'light.bedroom': {
          entity_id: 'light.bedroom',
          state: 'on',
          attributes: {
            friendly_name: 'Bedroom Light',
            brightness: 128
          }
        }
      });

      ui.renderDesktopPinnedTile('light.bedroom', state.STATES['light.bedroom']);

      const control = document.querySelector('#desktop-pin-content .desktop-pin-light-control');
      expect(control).toBeTruthy();
      expect(control.querySelector('.desktop-pin-light-slider')).toBeTruthy();
      expect(control.querySelector('.desktop-pin-light-preset[data-brightness="70"]')).toBeTruthy();

      control.querySelector('.desktop-pin-light-preset[data-brightness="70"]').click();
      jest.advanceTimersByTime(120);
      await Promise.resolve();

      expect(mockCallService).toHaveBeenCalledWith('light', 'turn_on', {
        entity_id: 'light.bedroom',
        brightness_pct: 70
      });

      jest.useRealTimers();
    });

    it('keeps desktop light slider value stable during rerenders while dragging', () => {
      state.setStates({
        'light.bedroom': {
          entity_id: 'light.bedroom',
          state: 'on',
          attributes: {
            friendly_name: 'Bedroom Light',
            brightness: 128
          }
        }
      });

      ui.renderDesktopPinnedTile('light.bedroom', state.STATES['light.bedroom']);

      const slider = document.querySelector('#desktop-pin-content .desktop-pin-light-slider');
      expect(slider).toBeTruthy();

      slider.dispatchEvent(new Event('pointerdown', { bubbles: true }));
      slider.value = '82';
      slider.dispatchEvent(new Event('input', { bubbles: true }));

      ui.renderDesktopPinnedTile('light.bedroom', {
        entity_id: 'light.bedroom',
        state: 'on',
        attributes: {
          friendly_name: 'Bedroom Light',
          brightness: 128
        }
      });

      const rerenderedSlider = document.querySelector('#desktop-pin-content .desktop-pin-light-slider');
      expect(rerenderedSlider.value).toBe('82');
    });

    it('renders compact climate controls and sends hvac mode changes', () => {
      state.setStates({
        'climate.thermostat': {
          ...sampleStates['climate.thermostat']
        }
      });

      ui.renderDesktopPinnedTile('climate.thermostat', state.STATES['climate.thermostat']);

      const control = document.querySelector('#desktop-pin-content .desktop-pin-climate-control');
      expect(control).toBeTruthy();
      expect(control.querySelector('.desktop-pin-climate-slider')).toBeTruthy();

      control.querySelector('.desktop-pin-climate-mode[data-action="cool"]').click();

      expect(mockCallService).toHaveBeenCalledWith('climate', 'set_hvac_mode', {
        entity_id: 'climate.thermostat',
        hvac_mode: 'cool'
      });
    });

    it('renders compact fan controls and sends preset percentages', async () => {
      jest.useFakeTimers();

      state.setStates({
        'fan.office': {
          entity_id: 'fan.office',
          state: 'on',
          attributes: {
            friendly_name: 'Office Fan',
            percentage: 33
          }
        }
      });

      ui.renderDesktopPinnedTile('fan.office', state.STATES['fan.office']);

      const control = document.querySelector('#desktop-pin-content .desktop-pin-fan-control');
      expect(control).toBeTruthy();
      expect(control.querySelector('.desktop-pin-fan-slider')).toBeTruthy();

      control.querySelector('.desktop-pin-fan-preset[data-speed="66"]').click();
      jest.advanceTimersByTime(140);
      await Promise.resolve();

      expect(mockCallService).toHaveBeenCalledWith('fan', 'set_percentage', {
        entity_id: 'fan.office',
        percentage: 66
      });

      jest.useRealTimers();
    });

    it('renders compact cover controls and sends cover actions', () => {
      state.setStates({
        'cover.blinds': {
          entity_id: 'cover.blinds',
          state: 'open',
          attributes: {
            friendly_name: 'Living Room Blinds',
            current_position: 55
          }
        }
      });

      ui.renderDesktopPinnedTile('cover.blinds', state.STATES['cover.blinds']);

      const control = document.querySelector('#desktop-pin-content .desktop-pin-cover-control');
      expect(control).toBeTruthy();

      control.querySelector('.desktop-pin-cover-action[data-action="close_cover"]').click();

      expect(mockCallService).toHaveBeenCalledWith('cover', 'close_cover', {
        entity_id: 'cover.blinds'
      });
    });

    it('renders compact media controls and routes play pause actions', () => {
      state.setStates({
        'media_player.spotify': {
          ...sampleStates['media_player.spotify']
        }
      });

      ui.renderDesktopPinnedTile('media_player.spotify', state.STATES['media_player.spotify']);

      const control = document.querySelector('#desktop-pin-content .desktop-pin-media-control');
      expect(control).toBeTruthy();

      control.querySelector('.desktop-pin-media-play').click();

      expect(mockCallService).toHaveBeenCalledWith('media_player', 'media_pause', {
        entity_id: 'media_player.spotify'
      });
    });

    it('renders scene desktop tiles with a centered name and triggers on tile click', () => {
      state.setStates({
        'scene.red_blue': {
          entity_id: 'scene.red_blue',
          state: 'scening',
          attributes: {
            friendly_name: 'Red & Blue'
          }
        }
      });

      ui.renderDesktopPinnedTile('scene.red_blue', state.STATES['scene.red_blue']);

      const control = document.querySelector('#desktop-pin-content .desktop-pin-scene-control');
      expect(control).toBeTruthy();
      expect(control.querySelector('.desktop-pin-scene-name')?.textContent).toBe('Red & Blue');
      expect(control.textContent).not.toContain('Ready');
      expect(control.textContent).not.toContain('Run');

      control.click();

      expect(mockCallService).toHaveBeenCalledWith('scene', 'turn_on', {
        entity_id: 'scene.red_blue'
      });
    });

    it('keeps pinned scene tiles interactive when Home Assistant reports an unknown state', () => {
      state.setStates({
        'scene.red_blue': {
          entity_id: 'scene.red_blue',
          state: 'unknown',
          attributes: {
            friendly_name: 'Red & Blue'
          }
        }
      });

      ui.renderDesktopPinnedTile('scene.red_blue', state.STATES['scene.red_blue']);

      const control = document.querySelector('#desktop-pin-content .desktop-pin-scene-control');
      expect(control).toBeTruthy();
      expect(document.getElementById('desktop-pin-empty')?.classList.contains('hidden')).toBe(true);
      expect(document.querySelector('#desktop-pin-empty[data-state=\"unavailable\"]')).toBeNull();

      control.click();

      expect(mockCallService).toHaveBeenCalledWith('scene', 'turn_on', {
        entity_id: 'scene.red_blue'
      });
    });

    it('renders script desktop tiles with the centered action layout and keeps Open available', () => {
      state.setStates({
        'script.goodnight': {
          entity_id: 'script.goodnight',
          state: 'off',
          attributes: {
            friendly_name: 'Goodnight'
          }
        }
      });

      ui.renderDesktopPinnedTile('script.goodnight', state.STATES['script.goodnight']);

      const control = document.querySelector('#desktop-pin-content .desktop-pin-scene-control');
      const openBtn = document.getElementById('desktop-pin-open-btn');
      const focusBtn = document.getElementById('desktop-pin-focus-btn');
      const focusActions = document.getElementById('desktop-pin-empty-actions');

      expect(control).toBeTruthy();
      expect(control?.dataset.domain).toBe('script');
      expect(control?.querySelector('.desktop-pin-scene-name')?.textContent).toBe('Goodnight');
      expect(document.getElementById('desktop-pin-empty')?.classList.contains('hidden')).toBe(true);
      expect(openBtn?.disabled).toBe(false);
      expect(openBtn?.getAttribute('aria-disabled')).toBe('false');
      expect(focusActions?.classList.contains('hidden')).toBe(true);
      expect(focusBtn?.disabled).toBe(true);

      control.click();

      expect(mockCallService).toHaveBeenCalledWith('script', 'turn_on', {
        entity_id: 'script.goodnight'
      });
    });
  });

  describe('handleDesktopPinActionRequest', () => {
    it('does not toggle unsupported entities for open-details requests', () => {
      state.setStates({
        'lock.front_door': {
          entity_id: 'lock.front_door',
          state: 'locked',
          attributes: {
            friendly_name: 'Front Door'
          }
        }
      });

      ui.handleDesktopPinActionRequest({
        entityId: 'lock.front_door',
        action: 'open-details'
      });

      expect(mockCallService).not.toHaveBeenCalled();
      expect(camera.openCamera).not.toHaveBeenCalled();
    });
  });

  // ==============================================================================
  // Module Exports
  // ==============================================================================

  describe('Module exports', () => {
    it('should export all public API functions', () => {
      expect(typeof ui.renderActiveTab).toBe('function');
      expect(typeof ui.updateEntityInUI).toBe('function');
      expect(typeof ui.updateWeatherFromHA).toBe('function');
      expect(typeof ui.populateWeatherEntitiesList).toBe('function');
      expect(typeof ui.selectWeatherEntity).toBe('function');
      expect(typeof ui.initUpdateUI).toBe('function');
      expect(typeof ui.updateTimeDisplay).toBe('function');
      expect(typeof ui.updateTimerDisplays).toBe('function');
      expect(typeof ui.toggleReorganizeMode).toBe('function');
      expect(typeof ui.populateQuickControlsList).toBe('function');
      expect(typeof ui.executeHotkeyAction).toBe('function');
      expect(typeof ui.updateMediaTile).toBe('function');
      expect(typeof ui.updateMediaSeekBar).toBe('function');
      expect(typeof ui.callMediaTileService).toBe('function');
    });
  });
});

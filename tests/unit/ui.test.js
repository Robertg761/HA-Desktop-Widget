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
const desktopPinSupport = require('../../src/desktop-pin-support.cjs');
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
    jest.useRealTimers();
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

      expect(mockElectronAPI.pinEntityToDesktop).toHaveBeenCalledWith('light.bedroom', expect.objectContaining({
        entityId: 'light.bedroom',
        family: 'light',
        supported: true,
      }));
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

    it('disables the reorganize-mode pin button for unsupported domains', () => {
      state.setConfig({
        ...state.CONFIG,
        favoriteEntities: ['calendar.family'],
        desktopPins: {}
      });
      state.setStates({
        'calendar.family': {
          entity_id: 'calendar.family',
          state: 'on',
          attributes: {
            friendly_name: 'Family Calendar'
          }
        }
      });

      ui.renderActiveTab();
      ui.toggleReorganizeMode();

      const pinButton = document.querySelector('.control-item[data-entity-id="calendar.family"] .desktop-pin-quick-toggle');
      expect(pinButton).toBeTruthy();
      expect(pinButton.textContent).toBe('Unsupported');
      expect(pinButton.disabled).toBe(true);
      expect(pinButton.title).toContain('does not have a desktop-pin profile yet');
    });

    it('resolves desktop-pin support families through the shared profile helper', () => {
      const cases = [
        { entity: sampleStates['button.refresh_router'], family: 'action', supported: true },
        { entity: sampleStates['number.water_heater_target'], family: 'numeric', supported: true },
        { entity: sampleStates['select.air_purifier_mode'], family: 'enum', supported: true },
        { entity: sampleStates['person.robert'], family: 'presence', supported: true },
        { entity: sampleStates['weather.home'], family: 'weather', supported: true },
        { entity: sampleStates['vacuum.roomba'], family: 'vacuum', supported: true },
        { entity: { entity_id: 'calendar.family', state: 'on', attributes: { friendly_name: 'Family Calendar' } }, family: 'unsupported', supported: false },
      ];

      cases.forEach(({ entity, family, supported }) => {
        expect(desktopPinSupport.resolveDesktopPinProfile(entity)).toEqual(expect.objectContaining({
          entityId: entity.entity_id,
          family,
          supported,
        }));
      });
    });

    const setDesktopPinViewport = (width, height) => {
      Object.defineProperty(window, 'innerWidth', { configurable: true, value: width });
      Object.defineProperty(window, 'innerHeight', { configurable: true, value: height });
    };

    const flushDesktopPinSceneMinSync = async () => {
      await Promise.resolve();
      jest.advanceTimersByTime(20);
      await Promise.resolve();
      jest.advanceTimersByTime(20);
      await Promise.resolve();
    };

    it('keeps Focus Main available while waiting for the first live update', () => {
      ui.renderDesktopPinnedTile('light.bedroom', null, { hasSnapshot: false });

      const emptyState = document.getElementById('desktop-pin-empty');
      const content = document.getElementById('desktop-pin-content');
      const focusBtn = document.getElementById('desktop-pin-focus-btn');
      const focusActions = document.getElementById('desktop-pin-empty-actions');

      expect(emptyState?.dataset.state).toBe('waiting');
      expect(emptyState?.classList.contains('hidden')).toBe(false);
      expect(content?.classList.contains('hidden')).toBe(true);
      expect(content?.getAttribute('aria-hidden')).toBe('true');
      expect(document.getElementById('desktop-pin-empty-title')?.textContent).toBe('Waiting for first live update');
      expect(focusActions?.classList.contains('hidden')).toBe(false);
      expect(focusBtn?.disabled).toBe(false);
      expect(focusBtn?.getAttribute('aria-disabled')).toBe('false');
    });

    it('removes Focus Main for a live pinned entity', () => {
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
      const focusBtn = document.getElementById('desktop-pin-focus-btn');
      const focusActions = document.getElementById('desktop-pin-empty-actions');

      expect(emptyState?.classList.contains('hidden')).toBe(true);
      expect(content?.classList.contains('hidden')).toBe(false);
      expect(content?.getAttribute('aria-hidden')).toBe(null);
      expect(document.querySelector('#desktop-pin-content .desktop-pin-light-control')).toBeTruthy();
      expect(focusActions?.classList.contains('hidden')).toBe(true);
      expect(focusBtn?.disabled).toBe(true);
      expect(focusBtn?.getAttribute('aria-disabled')).toBe('true');
    });

    it('shows the missing-entity fallback after a snapshot with the right copy', () => {
      ui.renderDesktopPinnedTile('light.bedroom', null, { hasSnapshot: true });

      const emptyState = document.getElementById('desktop-pin-empty');
      const focusBtn = document.getElementById('desktop-pin-focus-btn');
      const focusActions = document.getElementById('desktop-pin-empty-actions');

      expect(emptyState?.dataset.state).toBe('missing');
      expect(document.getElementById('desktop-pin-empty-kicker')?.textContent).toBe('Missing entity');
      expect(document.getElementById('desktop-pin-empty-title')?.textContent).toBe('Pinned entity not found');
      expect(document.getElementById('desktop-pin-empty-copy')?.textContent).toBe('This tile could not find its entity in the latest Home Assistant data. It may have been renamed, removed, or is no longer exposed.');
      expect(focusActions?.classList.contains('hidden')).toBe(false);
      expect(focusBtn?.disabled).toBe(false);
      expect(focusBtn?.getAttribute('aria-disabled')).toBe('false');
    });

    it('shows the unavailable fallback with the same focus behavior as other non-live states', () => {
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
      const focusBtn = document.getElementById('desktop-pin-focus-btn');
      const focusActions = document.getElementById('desktop-pin-empty-actions');

      expect(emptyState?.dataset.state).toBe('unavailable');
      expect(content?.classList.contains('hidden')).toBe(true);
      expect(document.getElementById('desktop-pin-empty-kicker')?.textContent).toBe('Unavailable');
      expect(document.getElementById('desktop-pin-empty-title')?.textContent).toBe('Bedroom Light is unavailable');
      expect(document.getElementById('desktop-pin-empty-copy')?.textContent).toBe('Latest Home Assistant data reports this entity as unavailable right now.');
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
      const focusBtn = document.getElementById('desktop-pin-focus-btn');
      const focusActions = document.getElementById('desktop-pin-empty-actions');

      expect(emptyState?.dataset.state).toBe('disconnected');
      expect(emptyState?.classList.contains('hidden')).toBe(false);
      expect(content?.classList.contains('hidden')).toBe(true);
      expect(content?.getAttribute('aria-hidden')).toBe('true');
      expect(document.getElementById('desktop-pin-empty-title')?.textContent).toBe('Home Assistant unavailable');
      expect(document.getElementById('desktop-pin-empty-copy')?.textContent).toBe('Unable to reach Home Assistant. Check your network or Home Assistant URL.');
      expect(content?.childElementCount).toBe(0);
      expect(focusActions?.classList.contains('hidden')).toBe(false);
      expect(focusBtn?.disabled).toBe(false);
      expect(focusBtn?.getAttribute('aria-disabled')).toBe('false');
    });

    it('keeps dense tiles in compact mode when only one axis clears the old promotion threshold', () => {
      setDesktopPinViewport(260, 148);
      state.setStates({
        'climate.thermostat': {
          ...sampleStates['climate.thermostat']
        }
      });

      ui.renderDesktopPinnedTile('climate.thermostat', state.STATES['climate.thermostat']);

      const control = document.querySelector('#desktop-pin-content .desktop-pin-climate-control');
      expect(control).toBeTruthy();
      expect(control?.dataset.layout).toBe('compact');
    });

    it('allows wide media tiles to promote once width clears the media override floor', () => {
      setDesktopPinViewport(260, 148);
      state.setStates({
        'media_player.spotify': {
          ...sampleStates['media_player.spotify']
        }
      });

      ui.renderDesktopPinnedTile('media_player.spotify', state.STATES['media_player.spotify']);

      const control = document.querySelector('#desktop-pin-content .desktop-pin-media-control');
      expect(control).toBeTruthy();
      expect(control?.dataset.layout).toBe('balanced');
    });

    it('keeps the default wide media pin in roomy mode without promoting shallow dense tiles the same way', () => {
      setDesktopPinViewport(328, 156);
      state.setStates({
        'media_player.spotify': {
          ...sampleStates['media_player.spotify']
        }
      });

      ui.renderDesktopPinnedTile('media_player.spotify', state.STATES['media_player.spotify']);

      const control = document.querySelector('#desktop-pin-content .desktop-pin-media-control');
      expect(control).toBeTruthy();
      expect(control?.dataset.layout).toBe('roomy');
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
      expect(control.querySelector('.desktop-pin-light-preset[data-brightness="75"]')).toBeTruthy();

      control.querySelector('.desktop-pin-light-preset[data-brightness="75"]').click();
      jest.advanceTimersByTime(120);
      await Promise.resolve();

      expect(mockCallService).toHaveBeenCalledWith('light', 'turn_on', {
        entity_id: 'light.bedroom',
        brightness_pct: 75
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

    it('toggles desktop light tiles when clicking the non-control surface', () => {
      state.setStates({
        'light.living_room': {
          entity_id: 'light.living_room',
          state: 'on',
          attributes: {
            friendly_name: 'Living Room Light',
            brightness: 140
          }
        }
      });

      ui.renderDesktopPinnedTile('light.living_room', state.STATES['light.living_room']);

      const control = document.querySelector('#desktop-pin-content .desktop-pin-light-control');
      const name = control?.querySelector('.desktop-pin-light-name');

      expect(control).toBeTruthy();
      expect(name).toBeTruthy();

      name.click();

      expect(mockCallService).toHaveBeenCalledWith('light', 'turn_off', {
        entity_id: 'light.living_room'
      });
    });

    it('keeps desktop pin optimistic light toggles in place without dropping focus', async () => {
      state.setStates({
        'light.office': {
          entity_id: 'light.office',
          state: 'on',
          attributes: {
            friendly_name: 'Office Light',
            brightness: 180
          }
        }
      });

      ui.renderDesktopPinnedTile('light.office', state.STATES['light.office'], { hasSnapshot: true });

      const originalControl = document.querySelector('#desktop-pin-content .desktop-pin-light-control');
      const originalPowerButton = originalControl?.querySelector('.desktop-pin-light-power');

      expect(originalControl).toBeTruthy();
      expect(originalPowerButton).toBeTruthy();

      originalPowerButton.focus();
      expect(document.activeElement).toBe(originalPowerButton);

      originalPowerButton.click();
      await Promise.resolve();

      const updatedControl = document.querySelector('#desktop-pin-content .desktop-pin-light-control');
      const updatedPowerButton = updatedControl?.querySelector('.desktop-pin-light-power');

      expect(updatedControl).toBe(originalControl);
      expect(updatedPowerButton).toBe(originalPowerButton);
      expect(document.activeElement).toBe(updatedPowerButton);
      expect(updatedControl?.dataset.state).toBe('off');
      expect(updatedPowerButton?.textContent).toBe('Off');
      expect(updatedPowerButton?.getAttribute('aria-pressed')).toBe('false');
      expect(mockCallService).toHaveBeenCalledWith('light', 'turn_off', {
        entity_id: 'light.office'
      });
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

    it('collapses climate desktop pins into the Stage 4 tight variant near the minimum size', () => {
      setDesktopPinViewport(168, 148);
      state.setStates({
        'climate.thermostat': {
          ...sampleStates['climate.thermostat']
        }
      });

      ui.renderDesktopPinnedTile('climate.thermostat', state.STATES['climate.thermostat']);

      const control = document.querySelector('#desktop-pin-content .desktop-pin-climate-control');
      expect(control).toBeTruthy();
      expect(control?.dataset.layout).toBe('compact');
      expect(control?.dataset.denseVariant).toBe('tight');
      expect(control?.querySelector('.desktop-pin-climate-summary')).toBeNull();
      expect(control?.querySelector('.desktop-pin-climate-inline-copy')?.textContent).toContain('Now 21');
      expect(control?.querySelectorAll('.desktop-pin-climate-mode')).toHaveLength(3);
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

    it('collapses fan desktop pins into the Stage 4 tight variant near the minimum size', () => {
      setDesktopPinViewport(168, 148);
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
      expect(control?.dataset.denseVariant).toBe('tight');
      expect(control?.querySelector('.desktop-pin-fan-kpi')).toBeNull();
      expect(control?.querySelectorAll('.desktop-pin-fan-preset')).toHaveLength(3);
      expect(control?.querySelector('.desktop-pin-fan-preset[data-speed="33"]')).toBeNull();
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

    it('collapses cover desktop pins into the Stage 4 tight variant near the minimum size', () => {
      setDesktopPinViewport(168, 148);
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
      expect(control?.dataset.denseVariant).toBe('tight');
      expect(control?.querySelector('.desktop-pin-cover-visual')).toBeNull();
      expect(control?.querySelector('.desktop-pin-cover-slider')).toBeTruthy();
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

    it('collapses media desktop pins into the Stage 4 tight variant at the minimum wide size', () => {
      setDesktopPinViewport(260, 148);
      state.setStates({
        'media_player.spotify': {
          ...sampleStates['media_player.spotify']
        }
      });

      ui.renderDesktopPinnedTile('media_player.spotify', state.STATES['media_player.spotify']);

      const control = document.querySelector('#desktop-pin-content .desktop-pin-media-control');
      expect(control).toBeTruthy();
      expect(control?.dataset.layout).toBe('balanced');
      expect(control?.dataset.denseVariant).toBe('tight');
      expect(control?.querySelector('.desktop-pin-media-artist')).toBeNull();
      expect(control?.querySelectorAll('.desktop-pin-media-action')).toHaveLength(3);
    });

    it('replaces dense desktop pin markup when the viewport crosses the Stage 4 tight threshold', () => {
      setDesktopPinViewport(195, 160);
      state.setStates({
        'climate.thermostat': {
          ...sampleStates['climate.thermostat']
        }
      });

      ui.renderDesktopPinnedTile('climate.thermostat', state.STATES['climate.thermostat']);

      const originalControl = document.querySelector('#desktop-pin-content .desktop-pin-climate-control');
      expect(originalControl).toBeTruthy();
      expect(originalControl?.dataset.layout).toBe('balanced');
      expect(originalControl?.dataset.denseVariant).toBe('standard');
      expect(originalControl?.querySelector('.desktop-pin-climate-summary')).toBeTruthy();

      setDesktopPinViewport(168, 148);
      ui.renderDesktopPinnedTile('climate.thermostat', state.STATES['climate.thermostat']);

      const rerenderedControl = document.querySelector('#desktop-pin-content .desktop-pin-climate-control');
      expect(rerenderedControl).toBeTruthy();
      expect(rerenderedControl).not.toBe(originalControl);
      expect(rerenderedControl?.dataset.layout).toBe('compact');
      expect(rerenderedControl?.dataset.denseVariant).toBe('tight');
      expect(rerenderedControl?.querySelector('.desktop-pin-climate-summary')).toBeNull();
      expect(rerenderedControl?.querySelector('.desktop-pin-climate-inline-copy')).toBeTruthy();
    });

    it('renders scene desktop tiles with a centered name, syncs the minimum floor, and triggers on tile click', async () => {
      jest.useFakeTimers();
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
      await flushDesktopPinSceneMinSync();

      const control = document.querySelector('#desktop-pin-content .desktop-pin-scene-control');
      expect(control).toBeTruthy();
      expect(control.querySelector('.desktop-pin-scene-name')?.textContent).toBe('Red & Blue');
      expect(control.textContent).not.toContain('Ready');
      expect(control.textContent).not.toContain('Run');
      expect(control?.dataset.layout).toBe('compact');
      expect(mockElectronAPI.syncDesktopPinContentMinBounds).toHaveBeenCalledWith('scene.red_blue', {
        width: 97,
        height: 83,
      });

      control.click();

      expect(mockCallService).toHaveBeenCalledWith('scene', 'turn_on', {
        entity_id: 'scene.red_blue'
      });
      jest.useRealTimers();
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
      expect(document.querySelector('#desktop-pin-empty[data-state="unavailable"]')).toBeNull();

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
      const focusBtn = document.getElementById('desktop-pin-focus-btn');
      const focusActions = document.getElementById('desktop-pin-empty-actions');

      expect(control).toBeTruthy();
      expect(control?.dataset.domain).toBe('script');
      expect(control?.querySelector('.desktop-pin-scene-name')?.textContent).toBe('Goodnight');
      expect(document.getElementById('desktop-pin-empty')?.classList.contains('hidden')).toBe(true);
      expect(focusActions?.classList.contains('hidden')).toBe(true);
      expect(focusBtn?.disabled).toBe(true);

      control.click();

      expect(mockCallService).toHaveBeenCalledWith('script', 'turn_on', {
        entity_id: 'script.goodnight'
      });
    });

    it.each([
      {
        entityId: 'automation.morning_routine',
        entity: {
          entity_id: 'automation.morning_routine',
          state: 'on',
          attributes: { friendly_name: 'Morning Routine' }
        },
        expectedLabel: 'Trigger',
        expectedService: 'trigger',
      },
      {
        entityId: 'button.refresh_router',
        entity: sampleStates['button.refresh_router'],
        expectedLabel: 'Press',
        expectedService: 'press',
      }
    ])('renders $entityId desktop action tiles and triggers the primary service', ({ entityId, entity, expectedLabel, expectedService }) => {
      state.setStates({ [entityId]: entity });

      ui.renderDesktopPinnedTile(entityId, state.STATES[entityId], { hasSnapshot: true });

      const control = document.querySelector('#desktop-pin-content .desktop-pin-action-control');
      expect(control).toBeTruthy();
      expect(control?.querySelector('.desktop-pin-panel-value')?.textContent).toBe(expectedLabel);

      control.querySelector('.desktop-pin-action-primary').click();

      expect(mockCallService).toHaveBeenCalledWith(entityId.split('.')[0], expectedService, {
        entity_id: entityId
      });
    });

    it('renders numeric desktop tiles with a slider when bounds are available', async () => {
      jest.useFakeTimers();
      const entity = {
        ...sampleStates['number.water_heater_target'],
        entity_id: 'number.water_heater_target_slider',
      };
      state.setStates({
        'number.water_heater_target_slider': entity
      });

      ui.renderDesktopPinnedTile('number.water_heater_target_slider', state.STATES['number.water_heater_target_slider'], { hasSnapshot: true });

      const control = document.querySelector('#desktop-pin-content .desktop-pin-numeric-control');
      const slider = control?.querySelector('.desktop-pin-numeric-slider');
      expect(control).toBeTruthy();
      expect(slider).toBeTruthy();

      slider.value = '52';
      slider.dispatchEvent(new Event('input', { bubbles: true }));
      slider.dispatchEvent(new Event('change', { bubbles: true }));
      jest.advanceTimersByTime(160);
      await Promise.resolve();

      expect(mockCallService).toHaveBeenCalledWith('number', 'set_value', {
        entity_id: 'number.water_heater_target_slider',
        value: 52
      });
      jest.useRealTimers();
    });

    it('renders input_number desktop tiles with +/- controls when bounds are missing', async () => {
      jest.useFakeTimers();
      state.setStates({
        'input_number.night_brightness': sampleStates['input_number.night_brightness']
      });

      ui.renderDesktopPinnedTile('input_number.night_brightness', state.STATES['input_number.night_brightness'], { hasSnapshot: true });

      const control = document.querySelector('#desktop-pin-content .desktop-pin-numeric-control');
      expect(control).toBeTruthy();
      expect(control?.querySelector('.desktop-pin-numeric-slider')).toBeNull();

      control.querySelector('.desktop-pin-numeric-step[data-action="increase"]').click();
      jest.advanceTimersByTime(160);
      await Promise.resolve();

      expect(mockCallService).toHaveBeenCalledWith('input_number', 'set_value', {
        entity_id: 'input_number.night_brightness',
        value: 3
      });
      jest.useRealTimers();
    });

    it.each([
      {
        entityId: 'select.air_purifier_mode',
        expectedService: 'select_next',
        expectedPayload: { entity_id: 'select.air_purifier_mode' },
      },
      {
        entityId: 'input_select.bedtime_scene',
        expectedService: 'select_option',
        expectedPayload: { entity_id: 'input_select.bedtime_scene', option: 'Relax' },
      }
    ])('renders $entityId desktop enum tiles and advances options', async ({ entityId, expectedService, expectedPayload }) => {
      jest.useFakeTimers();
      const baseEntity = sampleStates[entityId];
      const nextServices = {
        ...sampleServices,
        input_select: {
          ...(sampleServices.input_select || {}),
        }
      };
      if (entityId === 'input_select.bedtime_scene') {
        delete nextServices.input_select.select_next;
      }

      state.setServices(nextServices);
      state.setStates({ [entityId]: baseEntity });

      ui.renderDesktopPinnedTile(entityId, state.STATES[entityId], { hasSnapshot: true });

      const control = document.querySelector('#desktop-pin-content .desktop-pin-enum-control');
      expect(control).toBeTruthy();

      control.querySelector('.desktop-pin-enum-step[data-action="next"]').click();
      jest.advanceTimersByTime(140);
      await Promise.resolve();

      expect(mockCallService).toHaveBeenCalledWith(entityId.split('.')[0], expectedService, expectedPayload);
      jest.useRealTimers();
    });

    it.each([
      {
        entityId: 'person.robert',
        selector: '.desktop-pin-presence-control',
      },
      {
        entityId: 'device_tracker.robert_phone',
        selector: '.desktop-pin-presence-control',
      },
      {
        entityId: 'weather.home',
        selector: '.desktop-pin-weather-control',
      }
    ])('renders $entityId informational desktop tiles with Focus Main', ({ entityId, selector }) => {
      state.setStates({ [entityId]: sampleStates[entityId] });

      ui.renderDesktopPinnedTile(entityId, state.STATES[entityId], { hasSnapshot: true });

      const control = document.querySelector(`#desktop-pin-content ${selector}`);
      const focusButton = control?.querySelector('.desktop-pin-panel-button');
      expect(control).toBeTruthy();
      expect(focusButton).toBeTruthy();

      focusButton.click();

      expect(mockElectronAPI.requestDesktopPinAction).toHaveBeenCalledWith(entityId, 'focus-main');
    });

    it('renders vacuum desktop tiles with state-driven actions', () => {
      state.setStates({
        'vacuum.roomba': sampleStates['vacuum.roomba']
      });

      ui.renderDesktopPinnedTile('vacuum.roomba', state.STATES['vacuum.roomba'], { hasSnapshot: true });

      let control = document.querySelector('#desktop-pin-content .desktop-pin-vacuum-control');
      expect(control).toBeTruthy();

      control.querySelector('.desktop-pin-vacuum-action[data-action="primary"]').click();
      expect(mockCallService).toHaveBeenCalledWith('vacuum', 'start', {
        entity_id: 'vacuum.roomba'
      });

      mockCallService.mockClear();
      state.setStates({
        'vacuum.roomba': {
          ...sampleStates['vacuum.roomba'],
          state: 'cleaning'
        }
      });

      ui.renderDesktopPinnedTile('vacuum.roomba', state.STATES['vacuum.roomba'], { hasSnapshot: true });
      control = document.querySelector('#desktop-pin-content .desktop-pin-vacuum-control');
      control.querySelector('.desktop-pin-vacuum-action[data-action="primary"]').click();
      control.querySelector('.desktop-pin-vacuum-action[data-action="secondary"]').click();

      expect(mockCallService).toHaveBeenNthCalledWith(1, 'vacuum', 'pause', {
        entity_id: 'vacuum.roomba'
      });
      expect(mockCallService).toHaveBeenNthCalledWith(2, 'vacuum', 'return_to_base', {
        entity_id: 'vacuum.roomba'
      });
    });

    it('keeps scenes and scripts on micro layout at the minimum floor without using nano', async () => {
      jest.useFakeTimers();
      setDesktopPinViewport(97, 83);
      state.setStates({
        'scene.relax': {
          entity_id: 'scene.relax',
          state: 'scening',
          attributes: {
            friendly_name: 'Relax'
          }
        },
        'script.goodnight': {
          entity_id: 'script.goodnight',
          state: 'off',
          attributes: {
            friendly_name: 'Goodnight'
          }
        }
      });

      ui.renderDesktopPinnedTile('scene.relax', state.STATES['scene.relax']);
      await flushDesktopPinSceneMinSync();
      let control = document.querySelector('#desktop-pin-content .desktop-pin-scene-control');
      expect(control?.dataset.domain).toBe('scene');
      expect(control?.dataset.layout).toBe('micro');
      expect(mockElectronAPI.syncDesktopPinContentMinBounds).toHaveBeenCalledWith('scene.relax', {
        width: 97,
        height: 83,
      });

      mockElectronAPI.syncDesktopPinContentMinBounds.mockClear();
      ui.renderDesktopPinnedTile('script.goodnight', state.STATES['script.goodnight']);
      control = document.querySelector('#desktop-pin-content .desktop-pin-scene-control');
      expect(control?.dataset.domain).toBe('script');
      expect(control?.dataset.layout).toBe('micro');
      expect(mockElectronAPI.syncDesktopPinContentMinBounds).not.toHaveBeenCalled();
      jest.useRealTimers();
    });

    it('grows the synced scene minimum width-first and then height for long names', async () => {
      jest.useFakeTimers();
      setDesktopPinViewport(97, 83);
      state.setStates({
        'scene.movie_night_everywhere': {
          entity_id: 'scene.movie_night_everywhere',
          state: 'scening',
          attributes: {
            friendly_name: 'Movie Night In The Living Room And Dining Area'
          }
        }
      });

      ui.renderDesktopPinnedTile('scene.movie_night_everywhere', state.STATES['scene.movie_night_everywhere']);
      await flushDesktopPinSceneMinSync();

      expect(mockElectronAPI.syncDesktopPinContentMinBounds).toHaveBeenCalled();
      const [, minBounds] = mockElectronAPI.syncDesktopPinContentMinBounds.mock.calls.at(-1);
      expect(minBounds.width).toBeGreaterThanOrEqual(97);
      expect(minBounds.width).toBeLessThanOrEqual(168);
      expect(minBounds.height).toBeGreaterThanOrEqual(83);
      expect(minBounds.width === 168 || minBounds.height === 83).toBe(true);
      jest.useRealTimers();
    });

    it('recalculates the synced scene minimum when the friendly name gets longer', async () => {
      jest.useFakeTimers();
      setDesktopPinViewport(97, 83);
      state.setStates({
        'scene.calm_evening': {
          entity_id: 'scene.calm_evening',
          state: 'scening',
          attributes: {
            friendly_name: 'Relax'
          }
        }
      });

      ui.renderDesktopPinnedTile('scene.calm_evening', state.STATES['scene.calm_evening']);
      await flushDesktopPinSceneMinSync();
      const [, initialMinBounds] = mockElectronAPI.syncDesktopPinContentMinBounds.mock.calls.at(-1);

      mockElectronAPI.syncDesktopPinContentMinBounds.mockClear();
      state.setStates({
        'scene.calm_evening': {
          entity_id: 'scene.calm_evening',
          state: 'scening',
          attributes: {
            friendly_name: 'Relax Through The Entire Upstairs Bedroom Hallway And Guest Room Entryway Before Bedtime'
          }
        }
      });

      ui.renderDesktopPinnedTile('scene.calm_evening', state.STATES['scene.calm_evening']);
      await flushDesktopPinSceneMinSync();

      expect(mockElectronAPI.syncDesktopPinContentMinBounds).toHaveBeenCalled();
      const [, updatedMinBounds] = mockElectronAPI.syncDesktopPinContentMinBounds.mock.calls.at(-1);
      expect(updatedMinBounds.width >= initialMinBounds.width).toBe(true);
      expect(updatedMinBounds.height >= initialMinBounds.height).toBe(true);
      jest.useRealTimers();
    });

    it.each([
      {
        label: 'scene',
        entityId: 'scene.red_blue',
        initial: {
          entity_id: 'scene.red_blue',
          state: 'scening',
          attributes: {
            friendly_name: 'Red & Blue'
          }
        },
        updated: {
          entity_id: 'scene.red_blue',
          state: 'scening',
          attributes: {
            friendly_name: 'Movie Time'
          }
        },
        selector: '.desktop-pin-scene-control',
        assertUpdated: (control) => {
          expect(control?.querySelector('.desktop-pin-scene-name')?.textContent).toBe('Movie Time');
        }
      },
      {
        label: 'toggle',
        entityId: 'switch.bedroom',
        initial: {
          ...sampleStates['switch.bedroom']
        },
        updated: {
          ...sampleStates['switch.bedroom'],
          state: 'off'
        },
        selector: '.desktop-pin-toggle-control',
        assertUpdated: (control) => {
          expect(control?.dataset.state).toBe('off');
          expect(control?.querySelector('.desktop-pin-panel-status')?.textContent).toBe('Off');
          expect(control?.querySelector('.desktop-pin-toggle-action')?.textContent).toBe('Off');
          expect(control?.querySelector('.desktop-pin-toggle-action')?.getAttribute('aria-pressed')).toBe('false');
        }
      },
      {
        label: 'camera',
        entityId: 'camera.front_door',
        initial: {
          ...sampleStates['camera.front_door']
        },
        updated: {
          ...sampleStates['camera.front_door'],
          state: 'streaming'
        },
        selector: '.desktop-pin-camera-control',
        assertUpdated: (control) => {
          expect(control?.dataset.state).toBe('streaming');
          expect(control?.querySelector('.desktop-pin-panel-status')?.textContent).toBe('Streaming');
        }
      },
      {
        label: 'sensor',
        entityId: 'sensor.temperature',
        initial: {
          ...sampleStates['sensor.temperature']
        },
        updated: {
          ...sampleStates['sensor.temperature'],
          state: '23.1'
        },
        selector: '.desktop-pin-sensor-control',
        assertUpdated: (control) => {
          expect(control?.querySelector('.desktop-pin-panel-value')?.textContent).toBe('23.1 °C');
        }
      },
      {
        label: 'binary sensor',
        entityId: 'binary_sensor.motion',
        initial: {
          ...sampleStates['binary_sensor.motion']
        },
        updated: {
          ...sampleStates['binary_sensor.motion'],
          state: 'on'
        },
        selector: '.desktop-pin-sensor-control',
        assertUpdated: (control) => {
          expect(control?.dataset.state).toBe('on');
          expect(control?.querySelector('.desktop-pin-panel-kpi')?.textContent).toBe('on');
          expect(control?.querySelector('.desktop-pin-panel-value')?.textContent).toBe('Detected');
        }
      },
      {
        label: 'timer',
        entityId: 'timer.kitchen',
        initial: {
          entity_id: 'timer.kitchen',
          state: 'active',
          attributes: {
            friendly_name: 'Kitchen Timer',
            remaining: '00:05:00'
          }
        },
        updated: {
          entity_id: 'timer.kitchen',
          state: 'paused',
          attributes: {
            friendly_name: 'Kitchen Timer',
            remaining: '00:02:30'
          }
        },
        selector: '.desktop-pin-timer-control',
        assertUpdated: (control) => {
          expect(control?.dataset.state).toBe('paused');
          expect(control?.querySelector('.desktop-pin-panel-kpi')?.textContent).toBe('paused');
          expect(control?.querySelector('.desktop-pin-panel-value')?.textContent).toBe('⏸ 00:02');
        }
      },
      {
        label: 'action',
        entityId: 'button.refresh_router',
        initial: {
          ...sampleStates['button.refresh_router']
        },
        updated: {
          ...sampleStates['button.refresh_router'],
          attributes: {
            friendly_name: 'Restart Router'
          }
        },
        selector: '.desktop-pin-action-control',
        assertUpdated: (control) => {
          expect(control?.querySelector('.desktop-pin-panel-name')?.textContent).toBe('Restart Router');
          expect(control?.querySelector('.desktop-pin-panel-value')?.textContent).toBe('Press');
        }
      },
      {
        label: 'numeric',
        entityId: 'number.pool_target',
        initial: {
          ...sampleStates['number.water_heater_target'],
          entity_id: 'number.pool_target',
        },
        updated: {
          ...sampleStates['number.water_heater_target'],
          entity_id: 'number.pool_target',
          state: '50'
        },
        selector: '.desktop-pin-numeric-control',
        assertUpdated: (control) => {
          expect(control?.querySelector('.desktop-pin-panel-value')?.textContent).toBe('50 °C');
        }
      },
      {
        label: 'enum',
        entityId: 'select.air_purifier_mode',
        initial: {
          ...sampleStates['select.air_purifier_mode']
        },
        updated: {
          ...sampleStates['select.air_purifier_mode'],
          state: 'boost'
        },
        selector: '.desktop-pin-enum-control',
        assertUpdated: (control) => {
          expect(control?.querySelector('.desktop-pin-panel-value')?.textContent).toBe('boost');
        }
      },
      {
        label: 'presence',
        entityId: 'person.robert',
        initial: {
          ...sampleStates['person.robert']
        },
        updated: {
          ...sampleStates['person.robert'],
          state: 'not_home'
        },
        selector: '.desktop-pin-presence-control',
        assertUpdated: (control) => {
          expect(control?.dataset.state).toBe('not_home');
          expect(control?.querySelector('.desktop-pin-panel-value')?.textContent).toBe('Not_home');
        }
      },
      {
        label: 'weather',
        entityId: 'weather.home',
        initial: {
          ...sampleStates['weather.home']
        },
        updated: {
          ...sampleStates['weather.home'],
          state: 'cloudy',
          attributes: {
            ...sampleStates['weather.home'].attributes,
            temperature: 19
          }
        },
        selector: '.desktop-pin-weather-control',
        assertUpdated: (control) => {
          expect(control?.dataset.state).toBe('cloudy');
          expect(control?.querySelector('.desktop-pin-panel-value')?.textContent).toBe('19°C');
        }
      },
      {
        label: 'vacuum',
        entityId: 'vacuum.roomba',
        initial: {
          entity_id: 'vacuum.roomba',
          state: 'docked',
          attributes: {
            friendly_name: 'Robot Vacuum'
          }
        },
        updated: {
          entity_id: 'vacuum.roomba',
          state: 'cleaning',
          attributes: {
            friendly_name: 'Robot Vacuum'
          }
        },
        selector: '.desktop-pin-vacuum-control',
        assertUpdated: (control) => {
          expect(control?.dataset.state).toBe('cleaning');
          expect(control?.querySelector('.desktop-pin-panel-value')?.textContent).toBe('Cleaning');
        }
      }
    ])('updates $label desktop pins in place when live data changes', ({ entityId, initial, updated, selector, assertUpdated }) => {
      state.setStates({
        [entityId]: initial
      });

      ui.renderDesktopPinnedTile(entityId, state.STATES[entityId], { hasSnapshot: true });

      const originalControl = document.querySelector(`#desktop-pin-content ${selector}`);
      expect(originalControl).toBeTruthy();

      state.setStates({
        [entityId]: updated
      });

      ui.renderDesktopPinnedTile(entityId, state.STATES[entityId], { hasSnapshot: true });

      const updatedControl = document.querySelector(`#desktop-pin-content ${selector}`);
      expect(updatedControl).toBe(originalControl);
      assertUpdated(updatedControl);
    });

    it('updates script desktop pin layout in place after resize', () => {
      setDesktopPinViewport(96, 82);
      state.setStates({
        'script.goodnight': {
          entity_id: 'script.goodnight',
          state: 'off',
          attributes: {
            friendly_name: 'Goodnight'
          }
        }
      });

      ui.renderDesktopPinnedTile('script.goodnight', state.STATES['script.goodnight'], { hasSnapshot: true });

      const originalControl = document.querySelector('#desktop-pin-content .desktop-pin-scene-control');
      expect(originalControl).toBeTruthy();
      expect(originalControl?.dataset.layout).toBe('micro');

      setDesktopPinViewport(168, 148);
      ui.renderDesktopPinnedTile('script.goodnight', state.STATES['script.goodnight'], { hasSnapshot: true });

      const updatedControl = document.querySelector('#desktop-pin-content .desktop-pin-scene-control');
      expect(updatedControl).toBe(originalControl);
      expect(updatedControl?.dataset.layout).toBe('compact');
    });

    it('keeps desktop pin control focus and slider state stable during updateEntityInUI refreshes', () => {
      state.setStates({
        'climate.thermostat': {
          ...sampleStates['climate.thermostat']
        }
      });

      ui.renderDesktopPinnedTile('climate.thermostat', state.STATES['climate.thermostat'], { hasSnapshot: true });

      const originalControl = document.querySelector('#desktop-pin-content .desktop-pin-climate-control');
      const originalSlider = originalControl?.querySelector('.desktop-pin-climate-slider');
      const originalCoolButton = originalControl?.querySelector('.desktop-pin-climate-mode[data-action="cool"]');

      expect(originalControl).toBeTruthy();
      expect(originalSlider).toBeTruthy();
      expect(originalCoolButton).toBeTruthy();

      originalSlider.dispatchEvent(new Event('pointerdown', { bubbles: true }));
      originalSlider.value = '25.5';
      originalSlider.dispatchEvent(new Event('input', { bubbles: true }));
      originalCoolButton.focus();
      expect(document.activeElement).toBe(originalCoolButton);

      const refreshedEntity = {
        ...sampleStates['climate.thermostat'],
        state: 'cool',
        attributes: {
          ...sampleStates['climate.thermostat'].attributes,
          current_temperature: 22,
          temperature: 23
        }
      };

      state.setStates({
        'climate.thermostat': refreshedEntity
      });
      ui.updateEntityInUI(refreshedEntity);

      const updatedControl = document.querySelector('#desktop-pin-content .desktop-pin-climate-control');
      const updatedSlider = updatedControl?.querySelector('.desktop-pin-climate-slider');
      const updatedCoolButton = updatedControl?.querySelector('.desktop-pin-climate-mode[data-action="cool"]');

      expect(updatedControl).toBe(originalControl);
      expect(updatedSlider).toBe(originalSlider);
      expect(updatedCoolButton).toBe(originalCoolButton);
      expect(updatedSlider?.value).toBe('25.5');
      expect(updatedControl?.dataset.state).toBe('cool');
      expect(updatedCoolButton?.getAttribute('aria-pressed')).toBe('true');
      expect(document.activeElement).toBe(updatedCoolButton);
    });

    it('keeps desktop pin fallback transitions correct when a live tile becomes unavailable and then recovers', () => {
      state.setStates({
        'sensor.temperature': {
          ...sampleStates['sensor.temperature']
        }
      });

      ui.renderDesktopPinnedTile('sensor.temperature', state.STATES['sensor.temperature'], { hasSnapshot: true });

      const firstControl = document.querySelector('#desktop-pin-content .desktop-pin-sensor-control');
      expect(firstControl).toBeTruthy();

      state.setStates({
        'sensor.temperature': {
          ...sampleStates['sensor.temperature'],
          state: 'unavailable'
        }
      });

      ui.renderDesktopPinnedTile('sensor.temperature', state.STATES['sensor.temperature'], { hasSnapshot: true });

      expect(document.getElementById('desktop-pin-empty')?.dataset.state).toBe('unavailable');
      expect(document.getElementById('desktop-pin-content')?.classList.contains('hidden')).toBe(true);
      expect(document.querySelector('#desktop-pin-content .desktop-pin-sensor-control')).toBeNull();

      state.setStates({
        'sensor.temperature': {
          ...sampleStates['sensor.temperature'],
          state: '24.0'
        }
      });

      ui.renderDesktopPinnedTile('sensor.temperature', state.STATES['sensor.temperature'], { hasSnapshot: true });

      const recoveredControl = document.querySelector('#desktop-pin-content .desktop-pin-sensor-control');
      expect(recoveredControl).toBeTruthy();
      expect(recoveredControl).not.toBe(firstControl);
      expect(document.getElementById('desktop-pin-empty')?.classList.contains('hidden')).toBe(true);
      expect(document.getElementById('desktop-pin-content')?.classList.contains('hidden')).toBe(false);
      expect(recoveredControl?.querySelector('.desktop-pin-panel-value')?.textContent).toBe('24.0 °C');
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

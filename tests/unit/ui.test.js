/**
 * @jest-environment jsdom
 */

const { createMockElectronAPI, resetMockElectronAPI, getMockConfig } = require('../mocks/electron.js');

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

jest.mock('sortablejs', () => jest.fn().mockImplementation(() => ({
  destroy: jest.fn()
})));

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
const { sampleConfig, sampleStates } = require('../fixtures/ha-data.js');

describe('UI Rendering - Selective Business Logic Tests (ui.js)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    resetMockElectronAPI();

    // Reset WebSocket mock
    mockCallService.mockClear();
    mockCallService.mockResolvedValue({});

    // Create comprehensive DOM structure
    document.body.innerHTML = `
      <div id="quick-controls"></div>

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
    const config = getMockConfig();
    config.favoriteEntities = [];
    config.selectedWeatherEntity = null;
    config.primaryMediaPlayer = 'media_player.spotify';
    state.setConfig(config);
    state.setStates({});
    state.setServices({});
    state.setAreas({});
  });

  // ==============================================================================
  // GROUP 1: Service Routing & Entity Controls (14 tests)
  // Note: toggleEntity is not exported, tested indirectly through executeHotkeyAction
  // ==============================================================================

  describe('executeHotkeyAction', () => {
    it('should execute toggle action', () => {
      const entity = {
        entity_id: 'light.bedroom',
        state: 'on'
      };

      ui.executeHotkeyAction(entity, 'toggle');

      expect(mockCallService).toHaveBeenCalledWith(
        'light',
        'toggle',
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
        'toggle',
        { entity_id: 'light.bedroom' }
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

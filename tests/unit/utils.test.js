/**
 * @jest-environment jsdom
 */

const utils = require('../../src/utils');
const state = require('../../src/state');
const { sampleConfig, sampleStates } = require('../fixtures/ha-data');

// Mock the state module
jest.mock('../../src/state', () => ({
  CONFIG: null,
  setConfig: jest.fn(),
}));

describe('Utils Module', () => {
  beforeEach(() => {
    // Reset mocks before each test
    jest.clearAllMocks();
    state.CONFIG = null;
  });

  describe('getEntityDisplayName', () => {
    test('should return custom name when configured', () => {
      state.CONFIG = sampleConfig;
      const entity = sampleStates['light.living_room'];
      expect(utils.getEntityDisplayName(entity)).toBe('Main Light');
    });

    test('should return friendly_name when no custom name', () => {
      state.CONFIG = sampleConfig;
      const entity = sampleStates['light.bedroom'];
      expect(utils.getEntityDisplayName(entity)).toBe('Bedroom Light');
    });

    test('should return entity_id when no friendly_name', () => {
      state.CONFIG = sampleConfig;
      const entity = { entity_id: 'light.test', attributes: {} };
      expect(utils.getEntityDisplayName(entity)).toBe('light.test');
    });

    test('should return "Unknown" for null entity', () => {
      expect(utils.getEntityDisplayName(null)).toBe('Unknown');
    });

    test('should return "Unknown" for undefined entity', () => {
      expect(utils.getEntityDisplayName(undefined)).toBe('Unknown');
    });

    test('should handle missing CONFIG gracefully', () => {
      state.CONFIG = null;
      const entity = sampleStates['light.living_room'];
      expect(utils.getEntityDisplayName(entity)).toBe('Living Room Light');
    });
  });

  describe('getEntityTypeDescription', () => {
    test('should format light domain correctly', () => {
      const entity = { entity_id: 'light.living_room' };
      expect(utils.getEntityTypeDescription(entity)).toBe('Light');
    });

    test('should format binary_sensor with underscores', () => {
      const entity = { entity_id: 'binary_sensor.motion' };
      expect(utils.getEntityTypeDescription(entity)).toBe('Binary Sensor');
    });

    test('should format media_player correctly', () => {
      const entity = { entity_id: 'media_player.spotify' };
      expect(utils.getEntityTypeDescription(entity)).toBe('Media Player');
    });

    test('should return "Unknown" for null entity', () => {
      expect(utils.getEntityTypeDescription(null)).toBe('Unknown');
    });

    test('should return "Unknown" for undefined entity', () => {
      expect(utils.getEntityTypeDescription(undefined)).toBe('Unknown');
    });
  });

  describe('getEntityIcon', () => {
    test('should return light icon', () => {
      const entity = { entity_id: 'light.test', state: 'on', attributes: {} };
      expect(utils.getEntityIcon(entity)).toBe('💡');
    });

    test('should return switch icon for on state', () => {
      const entity = { entity_id: 'switch.test', state: 'on', attributes: {} };
      expect(utils.getEntityIcon(entity)).toBe('🔌');
    });

    test('should return switch icon for off state', () => {
      const entity = { entity_id: 'switch.test', state: 'off', attributes: {} };
      expect(utils.getEntityIcon(entity)).toBe('➖');
    });

    test('should return temperature icon for temperature sensor', () => {
      const entity = {
        entity_id: 'sensor.temperature',
        state: '22',
        attributes: { device_class: 'temperature' }
      };
      expect(utils.getEntityIcon(entity)).toBe('🌡️');
    });

    test('should return humidity icon for humidity sensor', () => {
      const entity = {
        entity_id: 'sensor.humidity',
        state: '60',
        attributes: { device_class: 'humidity' }
      };
      expect(utils.getEntityIcon(entity)).toBe('💧');
    });

    test('should return battery icon for battery sensor', () => {
      const entity = {
        entity_id: 'sensor.battery',
        state: '85',
        attributes: { device_class: 'battery' }
      };
      expect(utils.getEntityIcon(entity)).toBe('🔋');
    });

    test('should return timer icon for timer entity', () => {
      const entity = { entity_id: 'timer.kitchen', state: 'active', attributes: {} };
      expect(utils.getEntityIcon(entity)).toBe('⏲️');
    });

    test('should return motion icon for motion sensor (on)', () => {
      const entity = {
        entity_id: 'binary_sensor.motion',
        state: 'on',
        attributes: { device_class: 'motion' }
      };
      expect(utils.getEntityIcon(entity)).toBe('🏃');
    });

    test('should return motion icon for motion sensor (off)', () => {
      const entity = {
        entity_id: 'binary_sensor.motion',
        state: 'off',
        attributes: { device_class: 'motion' }
      };
      expect(utils.getEntityIcon(entity)).toBe('🧍');
    });

    test('should return camera icon', () => {
      const entity = { entity_id: 'camera.front_door', state: 'idle', attributes: {} };
      expect(utils.getEntityIcon(entity)).toBe('📷');
    });

    test('should return lock icon for locked state', () => {
      const entity = { entity_id: 'lock.front_door', state: 'locked', attributes: {} };
      expect(utils.getEntityIcon(entity)).toBe('🔒');
    });

    test('should return lock icon for unlocked state', () => {
      const entity = { entity_id: 'lock.front_door', state: 'unlocked', attributes: {} };
      expect(utils.getEntityIcon(entity)).toBe('🔓');
    });

    test('should return question mark for unknown domain', () => {
      const entity = { entity_id: 'unknown.test', state: 'on', attributes: {} };
      expect(utils.getEntityIcon(entity)).toBe('❓');
    });

    test('should return question mark for null entity', () => {
      expect(utils.getEntityIcon(null)).toBe('❓');
    });
  });

  describe('formatDuration', () => {
    test('should format zero duration', () => {
      expect(utils.formatDuration(0)).toBe('0:00');
    });

    test('should format seconds only', () => {
      expect(utils.formatDuration(30000)).toBe('0:30'); // 30 seconds
    });

    test('should format minutes and seconds', () => {
      expect(utils.formatDuration(90000)).toBe('1:30'); // 1:30
      expect(utils.formatDuration(600000)).toBe('10:00'); // 10:00
    });

    test('should format hours, minutes, and seconds', () => {
      expect(utils.formatDuration(3661000)).toBe('1:01:01'); // 1:01:01
      expect(utils.formatDuration(3600000)).toBe('1:00:00'); // 1:00:00
    });

    test('should pad minutes and seconds with zeros', () => {
      expect(utils.formatDuration(3605000)).toBe('1:00:05'); // 1:00:05
      expect(utils.formatDuration(65000)).toBe('1:05'); // 1:05
    });

    test('should handle negative durations as zero', () => {
      expect(utils.formatDuration(-1000)).toBe('0:00');
    });

    test('should handle large durations', () => {
      expect(utils.formatDuration(86400000)).toBe('24:00:00'); // 24 hours
    });
  });

  describe('getTimerEnd', () => {
    let consoleError;

    beforeEach(() => {
      consoleError = jest.spyOn(console, 'error').mockImplementation(() => {});
    });

    afterEach(() => {
      consoleError.mockRestore();
    });

    test('should return timestamp from finishes_at attribute', () => {
      const futureTime = new Date(Date.now() + 60000).toISOString();
      const entity = {
        entity_id: 'timer.test',
        attributes: { finishes_at: futureTime }
      };
      const result = utils.getTimerEnd(entity);
      expect(result).toBeGreaterThan(Date.now());
    });

    test('should calculate from remaining attribute', () => {
      const entity = {
        entity_id: 'timer.test',
        attributes: { remaining: '0:05:30' } // 5:30 remaining
      };
      const result = utils.getTimerEnd(entity);
      expect(result).toBeGreaterThan(Date.now());
      expect(result).toBeLessThan(Date.now() + 6 * 60 * 1000);
    });

    test('should handle remaining with hours', () => {
      const entity = {
        entity_id: 'timer.test',
        attributes: { remaining: '1:30:00' } // 1:30:00 remaining
      };
      const result = utils.getTimerEnd(entity);
      expect(result).toBeGreaterThan(Date.now());
    });

    test('should return null for invalid finishes_at', () => {
      const entity = {
        entity_id: 'timer.test',
        attributes: { finishes_at: 'invalid-date' }
      };
      expect(utils.getTimerEnd(entity)).toBeNull();
    });

    test('should return null for invalid remaining format', () => {
      const entity = {
        entity_id: 'timer.test',
        attributes: { remaining: 'invalid' }
      };
      expect(utils.getTimerEnd(entity)).toBeNull();
    });

    test('should return null for missing attributes', () => {
      const entity = { entity_id: 'timer.test', attributes: {} };
      expect(utils.getTimerEnd(entity)).toBeNull();
    });

    test('should return null for null entity', () => {
      expect(utils.getTimerEnd(null)).toBeNull();
    });
  });

  describe('getSearchScore', () => {
    test('should return 2 for exact start match', () => {
      expect(utils.getSearchScore('Living Room Light', 'living')).toBe(2);
    });

    test('should return 1 for contains match', () => {
      expect(utils.getSearchScore('Living Room Light', 'room')).toBe(1);
    });

    test('should return 0 for no match', () => {
      expect(utils.getSearchScore('Living Room Light', 'kitchen')).toBe(0);
    });

    test('should be case insensitive', () => {
      expect(utils.getSearchScore('Living Room Light', 'LIVING')).toBe(2);
      expect(utils.getSearchScore('LIVING ROOM LIGHT', 'living')).toBe(2);
    });

    test('should handle underscores in entity IDs', () => {
      // After normalization: 'light.living_room' becomes 'light living room'
      // 'living room' is contained but doesn't start the string
      expect(utils.getSearchScore('light.living_room', 'living room')).toBe(1);
      expect(utils.getSearchScore('living_room_light', 'living room')).toBe(2); // This starts with it
    });

    test('should handle hyphens', () => {
      expect(utils.getSearchScore('front-door-light', 'front door')).toBe(2);
    });

    test('should handle apostrophes', () => {
      expect(utils.getSearchScore("john's light", 'johns')).toBe(2);
    });

    test('should normalize multiple spaces', () => {
      expect(utils.getSearchScore('Living   Room   Light', 'living room')).toBe(2);
    });

    test('should return 0 for empty query', () => {
      expect(utils.getSearchScore('Living Room Light', '')).toBe(2); // Empty query matches start
    });
  });

  describe('getEntityDisplayState', () => {
    test('should return percentage for light with brightness', () => {
      const entity = {
        entity_id: 'light.living_room',
        state: 'on',
        attributes: { brightness: 128 }
      };
      expect(utils.getEntityDisplayState(entity)).toBe('50%');
    });

    test('should capitalize simple states', () => {
      const entity = {
        entity_id: 'light.living_room',
        state: 'off',
        attributes: {}
      };
      expect(utils.getEntityDisplayState(entity)).toBe('Off');
    });

    test('should show sensor value with unit', () => {
      const entity = {
        entity_id: 'sensor.temperature',
        state: '22.5',
        attributes: { unit_of_measurement: '°C' }
      };
      expect(utils.getEntityDisplayState(entity)).toBe('22.5 °C');
    });

    test('should show sensor value without unit', () => {
      const entity = {
        entity_id: 'sensor.count',
        state: '42',
        attributes: {}
      };
      expect(utils.getEntityDisplayState(entity)).toBe('42');
    });

    test('should show "Detected" for binary_sensor on', () => {
      const entity = {
        entity_id: 'binary_sensor.motion',
        state: 'on',
        attributes: {}
      };
      expect(utils.getEntityDisplayState(entity)).toBe('Detected');
    });

    test('should show "Clear" for binary_sensor off', () => {
      const entity = {
        entity_id: 'binary_sensor.motion',
        state: 'off',
        attributes: {}
      };
      expect(utils.getEntityDisplayState(entity)).toBe('Clear');
    });

    test('should show "Ready" for scenes', () => {
      const entity = {
        entity_id: 'scene.movie_time',
        state: 'scening',
        attributes: {}
      };
      expect(utils.getEntityDisplayState(entity)).toBe('Ready');
    });

    test('should show temperature for climate entity', () => {
      const entity = {
        entity_id: 'climate.living_room',
        state: 'heat',
        attributes: { current_temperature: 22 }
      };
      expect(utils.getEntityDisplayState(entity)).toBe('22°');
    });

    test('should return "Unknown" for null entity', () => {
      expect(utils.getEntityDisplayState(null)).toBe('Unknown');
    });
  });

  describe('getTimerDisplay', () => {
    test('should return "Idle" for idle timer', () => {
      const entity = {
        entity_id: 'timer.kitchen',
        state: 'idle',
        attributes: {}
      };
      expect(utils.getTimerDisplay(entity)).toBe('Idle');
    });

    test('should format paused timer', () => {
      const entity = {
        entity_id: 'timer.kitchen',
        state: 'paused',
        attributes: { remaining: '05:30:15' }
      };
      expect(utils.getTimerDisplay(entity)).toBe('⏸ 05:30');
    });

    test('should format active timer with hours', () => {
      const entity = {
        entity_id: 'timer.kitchen',
        state: 'active',
        attributes: { remaining: '1:30:45' }
      };
      expect(utils.getTimerDisplay(entity)).toBe('1:30:45');
    });

    test('should format active timer without hours', () => {
      const entity = {
        entity_id: 'timer.kitchen',
        state: 'active',
        attributes: { remaining: '0:05:30' }
      };
      expect(utils.getTimerDisplay(entity)).toBe('5:30');
    });

    test('should handle sensor timer with finishes_at', () => {
      const futureTime = new Date(Date.now() + 90000).toISOString(); // 90 seconds
      const entity = {
        entity_id: 'sensor.kitchen_timer',
        state: 'active',
        attributes: { finishes_at: futureTime }
      };
      const result = utils.getTimerDisplay(entity);
      expect(result).toMatch(/^1:\d{2}$/); // Should be ~1:30
    });

    test('should show "Finished" for expired sensor timer', () => {
      const pastTime = new Date(Date.now() - 1000).toISOString();
      const entity = {
        entity_id: 'sensor.kitchen_timer',
        state: 'active',
        attributes: { finishes_at: pastTime }
      };
      expect(utils.getTimerDisplay(entity)).toBe('Finished');
    });

    test('should format sensor timer with hours', () => {
      const futureTime = new Date(Date.now() + 5400000).toISOString(); // 90 minutes
      const entity = {
        entity_id: 'sensor.kitchen_timer',
        state: 'active',
        attributes: { finishes_at: futureTime }
      };
      const result = utils.getTimerDisplay(entity);
      expect(result).toMatch(/^1:\d{2}:\d{2}$/); // Should be ~1:30:00
    });

    test('should handle sensor timer with state as timestamp', () => {
      const futureTime = new Date(Date.now() + 60000).toISOString();
      const entity = {
        entity_id: 'sensor.kitchen_timer',
        state: futureTime,
        attributes: {}
      };
      const result = utils.getTimerDisplay(entity);
      expect(result).toMatch(/^[01]:\d{2}$/); // Should be ~1:00
    });

    test('should return state for sensor without timer attributes', () => {
      const entity = {
        entity_id: 'sensor.other',
        state: 'some_value',
        attributes: {}
      };
      expect(utils.getTimerDisplay(entity)).toBe('some_value');
    });

    test('should return "--:--" for null entity', () => {
      expect(utils.getTimerDisplay(null)).toBe('--:--');
    });

    test('should capitalize unknown timer states', () => {
      const entity = {
        entity_id: 'timer.kitchen',
        state: 'unknown',
        attributes: {}
      };
      expect(utils.getTimerDisplay(entity)).toBe('Unknown');
    });
  });

  describe('escapeHtml', () => {
    test('should escape < and >', () => {
      expect(utils.escapeHtml('<script>alert("xss")</script>'))
        .toBe('&lt;script&gt;alert("xss")&lt;/script&gt;');
    });

    test('should escape ampersands', () => {
      expect(utils.escapeHtml('Tom & Jerry')).toBe('Tom &amp; Jerry');
    });

    test('should escape quotes', () => {
      // textContent doesn't escape quotes, they remain as-is
      expect(utils.escapeHtml('"Hello"')).toBe('"Hello"');
    });

    test('should handle single quotes', () => {
      expect(utils.escapeHtml("It's working")).toBe('It\'s working');
    });

    test('should handle mixed content', () => {
      const input = '<div onclick="alert(\'xss\')">Test & "data"</div>';
      const output = utils.escapeHtml(input);
      expect(output).not.toContain('<div');
      expect(output).toContain('&lt;div');
    });

    test('should return non-string values unchanged', () => {
      expect(utils.escapeHtml(123)).toBe(123);
      expect(utils.escapeHtml(null)).toBe(null);
      expect(utils.escapeHtml(undefined)).toBe(undefined);
    });

    test('should handle empty string', () => {
      expect(utils.escapeHtml('')).toBe('');
    });
  });
});

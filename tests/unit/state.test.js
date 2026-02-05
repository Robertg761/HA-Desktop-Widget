/**
 * @jest-environment jsdom
 */

const state = require('../../src/state').default;

describe('State Module', () => {
  describe('Initial State', () => {
    test('CONFIG should be null initially', () => {
      expect(state.CONFIG).toBeNull();
    });

    test('WS should be null initially', () => {
      expect(state.WS).toBeNull();
    });

    test('STATES should be empty object initially', () => {
      expect(state.STATES).toEqual({});
    });

    test('SERVICES should be empty object initially', () => {
      expect(state.SERVICES).toEqual({});
    });

    test('AREAS should be empty object initially', () => {
      expect(state.AREAS).toEqual({});
    });

    test('UNIT_SYSTEM should have metric defaults', () => {
      expect(state.UNIT_SYSTEM).toEqual({
        temperature: '°C',
        length: 'km',
        wind_speed: 'm/s',
        pressure: 'hPa',
        precipitation: 'mm',
        volume: 'L',
        mass: 'kg'
      });
    });

    test('ACTIVE_HLS should be a Map', () => {
      expect(state.ACTIVE_HLS).toBeInstanceOf(Map);
    });
  });

  describe('Setter Functions', () => {
    describe('setConfig', () => {
      test('should update CONFIG', () => {
        const testConfig = { url: 'http://test.local', token: 'test-token' };
        state.setConfig(testConfig);
        expect(state.CONFIG).toEqual(testConfig);
      });

      test('should handle null config', () => {
        state.setConfig(null);
        expect(state.CONFIG).toBeNull();
      });
    });

    describe('setWs', () => {
      test('should update WS', () => {
        const mockWs = { readyState: 1 };
        state.setWs(mockWs);
        expect(state.WS).toEqual(mockWs);
      });

      test('should handle null WebSocket', () => {
        state.setWs(null);
        expect(state.WS).toBeNull();
      });
    });

    describe('setStates', () => {
      test('should update STATES', () => {
        const testStates = {
          'light.living_room': { state: 'on', attributes: {} },
          'sensor.temperature': { state: '22.5', attributes: { unit_of_measurement: '°C' } }
        };
        state.setStates(testStates);
        expect(state.STATES).toEqual(testStates);
      });

      test('should replace entire STATES object', () => {
        state.setStates({ 'light.kitchen': { state: 'off' } });
        expect(state.STATES).toEqual({ 'light.kitchen': { state: 'off' } });
        expect(state.STATES['light.living_room']).toBeUndefined();
      });
    });

    describe('setServices', () => {
      test('should update SERVICES', () => {
        const testServices = {
          light: { turn_on: {}, turn_off: {} },
          switch: { turn_on: {}, turn_off: {} }
        };
        state.setServices(testServices);
        expect(state.SERVICES).toEqual(testServices);
      });
    });

    describe('setAreas', () => {
      test('should update AREAS', () => {
        const testAreas = {
          'area.living_room': { name: 'Living Room' },
          'area.kitchen': { name: 'Kitchen' }
        };
        state.setAreas(testAreas);
        expect(state.AREAS).toEqual(testAreas);
      });
    });

    describe('setUnitSystem', () => {
      test('should update UNIT_SYSTEM', () => {
        const imperialUnits = {
          temperature: '°F',
          length: 'mi',
          wind_speed: 'mph',
          pressure: 'inHg',
          precipitation: 'in',
          volume: 'gal',
          mass: 'lb'
        };
        state.setUnitSystem(imperialUnits);
        expect(state.UNIT_SYSTEM).toEqual(imperialUnits);
      });
    });
  });

  describe('Direct Exports (Mutable)', () => {
    test('ACTIVE_HLS Map should be directly mutable', () => {
      state.ACTIVE_HLS.set('camera.test', {});
      expect(state.ACTIVE_HLS.has('camera.test')).toBe(true);
      state.ACTIVE_HLS.delete('camera.test');
    });
  });

  describe('Getter Consistency', () => {
    test('getters should return updated values after setters', () => {
      const testConfig = { test: 'value' };
      state.setConfig(testConfig);
      expect(state.CONFIG).toBe(testConfig);

      const testStates = { 'light.test': { state: 'on' } };
      state.setStates(testStates);
      expect(state.STATES).toBe(testStates);

      const testServices = { light: {} };
      state.setServices(testServices);
      expect(state.SERVICES).toBe(testServices);
    });

    test('multiple getter accesses should return same reference', () => {
      const testConfig = { url: 'test' };
      state.setConfig(testConfig);
      const ref1 = state.CONFIG;
      const ref2 = state.CONFIG;
      expect(ref1).toBe(ref2);
    });
  });
});

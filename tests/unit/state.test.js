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

    test('FILTERS should have default domain list', () => {
      expect(state.FILTERS).toEqual({
        domains: ['light', 'switch', 'sensor', 'climate', 'media_player', 'scene', 'automation', 'camera'],
        areas: [],
        favorites: [],
        hidden: []
      });
    });

    test('EDIT_MODE_TAB_ID should be null initially', () => {
      expect(state.EDIT_MODE_TAB_ID).toBeNull();
    });

    test('TAB_LAYOUTS should be empty object initially', () => {
      expect(state.TAB_LAYOUTS).toEqual({});
    });

    test('PENDING_WS should be a Map', () => {
      expect(state.PENDING_WS).toBeInstanceOf(Map);
    });

    test('TIMER_MAP should be a Map', () => {
      expect(state.TIMER_MAP).toBeInstanceOf(Map);
    });

    test('LIVE_CAMERAS should be a Set', () => {
      expect(state.LIVE_CAMERAS).toBeInstanceOf(Set);
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

    describe('setTimerTick', () => {
      test('should update TIMER_TICK', () => {
        const testInterval = 123;
        state.setTimerTick(testInterval);
        expect(state.TIMER_TICK).toBe(testInterval);
      });

      test('should handle null interval', () => {
        state.setTimerTick(null);
        expect(state.TIMER_TICK).toBeNull();
      });
    });

    describe('setTimerSensorTick', () => {
      test('should update TIMER_SENSOR_TICK', () => {
        const testInterval = 456;
        state.setTimerSensorTick(testInterval);
        expect(state.TIMER_SENSOR_TICK).toBe(testInterval);
      });
    });

    describe('setTimerSensorSyncTick', () => {
      test('should update TIMER_SENSOR_SYNC_TICK', () => {
        const testInterval = 789;
        state.setTimerSensorSyncTick(testInterval);
        expect(state.TIMER_SENSOR_SYNC_TICK).toBe(testInterval);
      });
    });

    describe('setMotionPopup', () => {
      test('should update MOTION_POPUP', () => {
        const mockElement = document.createElement('div');
        state.setMotionPopup(mockElement);
        expect(state.MOTION_POPUP).toBe(mockElement);
      });
    });

    describe('setMotionPopupTimer', () => {
      test('should update MOTION_POPUP_TIMER', () => {
        const testTimer = 999;
        state.setMotionPopupTimer(testTimer);
        expect(state.MOTION_POPUP_TIMER).toBe(testTimer);
      });
    });

    describe('setMotionPopupCamera', () => {
      test('should update MOTION_POPUP_CAMERA', () => {
        const testCamera = 'camera.front_door';
        state.setMotionPopupCamera(testCamera);
        expect(state.MOTION_POPUP_CAMERA).toBe(testCamera);
      });
    });

    describe('setEditModeTabId', () => {
      test('should update EDIT_MODE_TAB_ID', () => {
        const testTabId = 'custom-tab-1';
        state.setEditModeTabId(testTabId);
        expect(state.EDIT_MODE_TAB_ID).toBe(testTabId);
      });

      test('should handle null tab ID', () => {
        state.setEditModeTabId(null);
        expect(state.EDIT_MODE_TAB_ID).toBeNull();
      });
    });

    describe('setFilters', () => {
      test('should update FILTERS', () => {
        const testFilters = {
          domains: ['light', 'switch'],
          areas: ['living_room'],
          favorites: ['light.kitchen'],
          hidden: ['sensor.debug']
        };
        state.setFilters(testFilters);
        expect(state.FILTERS).toEqual(testFilters);
      });
    });

    describe('setThemeMediaQuery', () => {
      test('should update THEME_MEDIA_QUERY', () => {
        const mockQuery = { matches: true };
        state.setThemeMediaQuery(mockQuery);
        expect(state.THEME_MEDIA_QUERY).toEqual(mockQuery);
      });
    });

    describe('setDragPlaceholder', () => {
      test('should update DRAG_PLACEHOLDER', () => {
        const mockElement = document.createElement('div');
        state.setDragPlaceholder(mockElement);
        expect(state.DRAG_PLACEHOLDER).toBe(mockElement);
      });
    });

    describe('setEditSnapshotLayouts', () => {
      test('should update EDIT_SNAPSHOT_LAYOUTS', () => {
        const testLayouts = {
          'tab-1': [{ type: 'light', id: 'light.living_room' }],
          'tab-2': [{ type: 'switch', id: 'switch.fan' }]
        };
        state.setEditSnapshotLayouts(testLayouts);
        expect(state.EDIT_SNAPSHOT_LAYOUTS).toEqual(testLayouts);
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
    test('PENDING_WS Map should be directly mutable', () => {
      state.PENDING_WS.set('test-key', 'test-value');
      expect(state.PENDING_WS.get('test-key')).toBe('test-value');
      state.PENDING_WS.delete('test-key');
    });

    test('LIVE_CAMERAS Set should be directly mutable', () => {
      state.LIVE_CAMERAS.add('camera.front_door');
      expect(state.LIVE_CAMERAS.has('camera.front_door')).toBe(true);
      state.LIVE_CAMERAS.delete('camera.front_door');
    });

    test('TIMER_MAP Map should be directly mutable', () => {
      state.TIMER_MAP.set('timer.test', 12345);
      expect(state.TIMER_MAP.get('timer.test')).toBe(12345);
      state.TIMER_MAP.delete('timer.test');
    });

    test('TIMER_SENSOR_MAP Map should be directly mutable', () => {
      state.TIMER_SENSOR_MAP.set('sensor.countdown', { end: 12345 });
      expect(state.TIMER_SENSOR_MAP.get('sensor.countdown')).toEqual({ end: 12345 });
      state.TIMER_SENSOR_MAP.delete('sensor.countdown');
    });

    test('DASHBOARD_CAMERA_EXPANDED Set should be directly mutable', () => {
      state.DASHBOARD_CAMERA_EXPANDED.add('camera.backyard');
      expect(state.DASHBOARD_CAMERA_EXPANDED.has('camera.backyard')).toBe(true);
      state.DASHBOARD_CAMERA_EXPANDED.delete('camera.backyard');
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

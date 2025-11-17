/**
 * Test Setup Sanity Check
 *
 * This test verifies that the Jest test environment is properly configured
 * and that all mock utilities and fixtures can be imported successfully.
 */

const { createMockElectronAPI, resetMockElectronAPI, getMockConfig } = require('../mocks/electron');
const { createMockWebSocketManager, MockWebSocket } = require('../mocks/websocket');
const {
  sampleConfig,
  sampleStates,
  sampleServices,
  sampleAreas,
  sampleUnitSystemMetric,
  sampleWebSocketMessages
} = require('../fixtures/ha-data');

describe('Test Environment Setup', () => {
  describe('Jest Configuration', () => {
    it('should be running in jsdom environment', () => {
      expect(typeof window).toBe('object');
      expect(typeof document).toBe('object');
      expect(typeof navigator).toBe('object');
    });

    it('should support basic assertions', () => {
      expect(1 + 1).toBe(2);
      expect('test').toBe('test');
      expect(true).toBeTruthy();
      expect(false).toBeFalsy();
      expect(null).toBeNull();
      expect(undefined).toBeUndefined();
    });

    it('should support object equality', () => {
      const obj1 = { a: 1, b: 2 };
      const obj2 = { a: 1, b: 2 };
      expect(obj1).toEqual(obj2);
      expect(obj1).not.toBe(obj2); // Different references
    });

    it('should support async/await', async () => {
      const promise = Promise.resolve('success');
      const result = await promise;
      expect(result).toBe('success');
    });
  });

  describe('Mock Utilities', () => {
    describe('Electron Mock', () => {
      let electronAPI;

      beforeEach(() => {
        electronAPI = createMockElectronAPI();
        resetMockElectronAPI();
      });

      it('should create mock electronAPI object', () => {
        expect(electronAPI).toBeDefined();
        expect(typeof electronAPI.getConfig).toBe('function');
        expect(typeof electronAPI.updateConfig).toBe('function');
        expect(typeof electronAPI.saveConfig).toBe('function');
      });

      it('should have all config operations', () => {
        expect(electronAPI.getConfig).toBeDefined();
        expect(electronAPI.updateConfig).toBeDefined();
        expect(electronAPI.saveConfig).toBeDefined();
      });

      it('should have all window operations', () => {
        expect(electronAPI.setOpacity).toBeDefined();
        expect(electronAPI.setAlwaysOnTop).toBeDefined();
        expect(electronAPI.getWindowState).toBeDefined();
        expect(electronAPI.minimizeWindow).toBeDefined();
        expect(electronAPI.focusWindow).toBeDefined();
        expect(electronAPI.restartApp).toBeDefined();
        expect(electronAPI.quitApp).toBeDefined();
      });

      it('should have all hotkey operations', () => {
        expect(electronAPI.registerHotkey).toBeDefined();
        expect(electronAPI.unregisterHotkey).toBeDefined();
        expect(electronAPI.registerHotkeys).toBeDefined();
        expect(electronAPI.toggleHotkeys).toBeDefined();
        expect(electronAPI.validateHotkey).toBeDefined();
        expect(electronAPI.registerPopupHotkey).toBeDefined();
        expect(electronAPI.unregisterPopupHotkey).toBeDefined();
        expect(electronAPI.getPopupHotkey).toBeDefined();
        expect(electronAPI.isPopupHotkeyAvailable).toBeDefined();
      });

      it('should have all alert operations', () => {
        expect(electronAPI.setEntityAlert).toBeDefined();
        expect(electronAPI.removeEntityAlert).toBeDefined();
        expect(electronAPI.toggleAlerts).toBeDefined();
      });

      it('should have all update operations', () => {
        expect(electronAPI.checkForUpdates).toBeDefined();
        expect(electronAPI.quitAndInstall).toBeDefined();
      });

      it('should have all utility operations', () => {
        expect(electronAPI.getAppVersion).toBeDefined();
        expect(electronAPI.openLogs).toBeDefined();
      });

      it('should have all event listeners', () => {
        expect(electronAPI.onHotkeyTriggered).toBeDefined();
        expect(electronAPI.onHotkeyRegistrationFailed).toBeDefined();
        expect(electronAPI.onAutoUpdate).toBeDefined();
        expect(electronAPI.onOpenSettings).toBeDefined();
      });

      it('should return promises from all methods', async () => {
        const configPromise = electronAPI.getConfig();
        expect(configPromise).toBeInstanceOf(Promise);
        const config = await configPromise;
        expect(config).toBeDefined();
      });

      it('should provide getMockConfig helper', () => {
        const config = getMockConfig();
        expect(config).toBeDefined();
        expect(config.homeAssistant).toBeDefined();
        expect(config.homeAssistant.url).toBe('http://homeassistant.local:8123');
      });
    });

    describe('WebSocket Mock', () => {
      it('should create mock WebSocket manager', () => {
        const ws = createMockWebSocketManager();
        expect(ws).toBeDefined();
        expect(typeof ws.connect).toBe('function');
        expect(typeof ws.close).toBe('function');
        expect(typeof ws.send).toBe('function');
        expect(typeof ws.request).toBe('function');
        expect(typeof ws.callService).toBe('function');
      });

      it('should support EventEmitter', () => {
        const ws = createMockWebSocketManager();
        expect(typeof ws.on).toBe('function');
        expect(typeof ws.emit).toBe('function');
        expect(typeof ws.removeListener).toBe('function');
      });

      it('should create mock WebSocket class', () => {
        const ws = new MockWebSocket('ws://test');
        expect(ws).toBeDefined();
        expect(ws.url).toBe('ws://test');
        expect(ws.readyState).toBeDefined();
      });

      it('should have WebSocket ready states', () => {
        expect(MockWebSocket.CONNECTING).toBe(0);
        expect(MockWebSocket.OPEN).toBe(1);
        expect(MockWebSocket.CLOSING).toBe(2);
        expect(MockWebSocket.CLOSED).toBe(3);
      });
    });
  });

  describe('Fixtures', () => {
    it('should load sample config', () => {
      expect(sampleConfig).toBeDefined();
      expect(sampleConfig.homeAssistant).toBeDefined();
      expect(sampleConfig.homeAssistant.url).toBeTruthy();
      expect(sampleConfig.favoriteEntities).toBeInstanceOf(Array);
    });

    it('should load sample states', () => {
      expect(sampleStates).toBeDefined();
      expect(Object.keys(sampleStates).length).toBeGreaterThan(0);
      expect(sampleStates['light.living_room']).toBeDefined();
      expect(sampleStates['light.living_room'].state).toBeDefined();
    });

    it('should load sample services', () => {
      expect(sampleServices).toBeDefined();
      expect(sampleServices.light).toBeDefined();
      expect(sampleServices.light.turn_on).toBeDefined();
      expect(sampleServices.light.turn_off).toBeDefined();
    });

    it('should load sample areas', () => {
      expect(sampleAreas).toBeDefined();
      expect(Object.keys(sampleAreas).length).toBeGreaterThan(0);
      expect(sampleAreas['living_room']).toBeDefined();
      expect(sampleAreas['living_room'].name).toBe('Living Room');
    });

    it('should load sample unit system', () => {
      expect(sampleUnitSystemMetric).toBeDefined();
      expect(sampleUnitSystemMetric.temperature).toBeDefined();
      expect(sampleUnitSystemMetric.wind_speed).toBeDefined();
    });

    it('should load sample WebSocket messages', () => {
      expect(sampleWebSocketMessages).toBeDefined();
      expect(sampleWebSocketMessages.authOk).toBeDefined();
      expect(sampleWebSocketMessages.getStatesRequest).toBeDefined();
      expect(sampleWebSocketMessages.stateChangedEvent).toBeDefined();
    });

    it('should have valid entity structures', () => {
      const entity = sampleStates['light.living_room'];
      expect(entity.entity_id).toBe('light.living_room');
      expect(entity.state).toBeDefined();
      expect(entity.attributes).toBeDefined();
      expect(entity.last_changed).toBeDefined();
      expect(entity.last_updated).toBeDefined();
      expect(entity.context).toBeDefined();
    });
  });
});

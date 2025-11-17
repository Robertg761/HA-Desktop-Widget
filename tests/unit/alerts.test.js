/**
 * @jest-environment jsdom
 */

const { createMockElectronAPI, resetMockElectronAPI, getMockConfig } = require('../mocks/electron.js');
const { sampleStates } = require('../fixtures/ha-data.js');

// Create mock electronAPI instance
let mockElectronAPI;

// Mock dependencies
jest.mock('../../src/ui-utils.js', () => ({
  showToast: jest.fn()
}));

jest.mock('../../src/utils.js', () => ({
  getEntityDisplayName: jest.fn((entity) => {
    if (!entity) return 'Unknown Entity';
    return entity.attributes?.friendly_name || entity.entity_id;
  }),
  getEntityIcon: jest.fn((entity) => {
    if (!entity) return '❓';
    if (entity.entity_id.startsWith('light.')) return '💡';
    if (entity.entity_id.startsWith('switch.')) return '🔌';
    if (entity.entity_id.startsWith('sensor.')) return '📊';
    return '❓';
  })
}));

// Mock state module
const mockState = {
  CONFIG: null,
  STATES: {}
};

jest.mock('../../src/state.js', () => ({
  get CONFIG() { return mockState.CONFIG; },
  get STATES() { return mockState.STATES; }
}));

// Setup global mocks
beforeAll(() => {
  // Create electronAPI instance
  mockElectronAPI = createMockElectronAPI();

  // Set electronAPI on window object (jsdom)
  window.electronAPI = mockElectronAPI;

  // Mock Notification API
  global.Notification = class MockNotification {
    constructor(title, options) {
      MockNotification.lastNotification = { title, options };
    }

    static requestPermission() {
      return Promise.resolve(MockNotification.permission);
    }
  };
  global.Notification.permission = 'granted';
  global.Notification.lastNotification = null;
});

// Reset state before each test
beforeEach(() => {
  jest.clearAllMocks();
  resetMockElectronAPI();

  // Reset mock state
  mockState.CONFIG = null;
  mockState.STATES = {};
  global.Notification.lastNotification = null;
  global.Notification.permission = 'granted';
});

describe('alerts module', () => {
  // Require modules once
  const alerts = require('../../src/alerts.js');
  const showToast = require('../../src/ui-utils.js').showToast;

  describe('initializeEntityAlerts', () => {
    it('should load alert configuration from state.CONFIG', () => {
      mockState.CONFIG = getMockConfig();
      mockState.CONFIG.entityAlerts = {
        enabled: true,
        alerts: {
          'light.living_room': {
            onStateChange: true
          }
        }
      };
      mockState.STATES = sampleStates;

      expect(() => alerts.initializeEntityAlerts()).not.toThrow();
    });

    it('should initialize alert states for existing entities', () => {
      mockState.CONFIG = getMockConfig();
      mockState.CONFIG.entityAlerts = {
        enabled: true,
        alerts: {
          'light.living_room': { onStateChange: true },
          'switch.bedroom': { onStateChange: true }
        }
      };
      mockState.STATES = sampleStates;

      alerts.initializeEntityAlerts();

      // Should not throw when checking alerts later
      expect(() => alerts.checkEntityAlerts('light.living_room', 'on')).not.toThrow();
    });

    it('should handle missing entityAlerts config gracefully', () => {
      mockState.CONFIG = getMockConfig();
      mockState.CONFIG.entityAlerts = undefined;

      expect(() => alerts.initializeEntityAlerts()).not.toThrow();
    });

    it('should skip initialization when alerts are disabled', () => {
      mockState.CONFIG = getMockConfig();
      mockState.CONFIG.entityAlerts = {
        enabled: false,
        alerts: {
          'light.living_room': { onStateChange: true }
        }
      };

      alerts.initializeEntityAlerts();
      // Should not set up any alert states when disabled
    });

    it('should handle entities that do not exist in STATES', () => {
      mockState.CONFIG = getMockConfig();
      mockState.CONFIG.entityAlerts = {
        enabled: true,
        alerts: {
          'light.nonexistent': { onStateChange: true }
        }
      };
      mockState.STATES = {};

      expect(() => alerts.initializeEntityAlerts()).not.toThrow();
    });
  });

  describe('checkEntityAlerts', () => {
    beforeEach(() => {
      mockState.CONFIG = getMockConfig();
      mockState.CONFIG.entityAlerts = {
        enabled: true,
        alerts: {}
      };
      mockState.STATES = sampleStates;
    });

    describe('onStateChange alerts', () => {
      it('should trigger alert when state changes', () => {
        mockState.CONFIG.entityAlerts.alerts['light.living_room'] = {
          onStateChange: true
        };
        alerts.initializeEntityAlerts(); // Initial state from sampleStates is 'on'

        // Change to 'off' to trigger alert (from 'on' to 'off')
        alerts.checkEntityAlerts('light.living_room', 'off');

        expect(showToast).toHaveBeenCalledWith(
          expect.stringContaining('Living Room Light'),
          'info',
          4000
        );
        expect(global.Notification.lastNotification).toBeTruthy();
      });

      it('should not trigger alert when state remains the same', () => {
        mockState.CONFIG.entityAlerts.alerts['light.living_room'] = {
          onStateChange: true
        };
        alerts.initializeEntityAlerts(); // Initial state from sampleStates is 'on'

        // First call with same state as initial - should not trigger
        alerts.checkEntityAlerts('light.living_room', 'on');

        expect(showToast).not.toHaveBeenCalled();
        expect(global.Notification.lastNotification).toBeNull();
      });

      it('should include previous and new states in alert message', () => {
        mockState.CONFIG.entityAlerts.alerts['light.living_room'] = {
          onStateChange: true
        };
        alerts.initializeEntityAlerts();

        // Establish previous state
        alerts.checkEntityAlerts('light.living_room', 'off');
        jest.clearAllMocks();

        // Trigger state change
        alerts.checkEntityAlerts('light.living_room', 'on');

        expect(showToast).toHaveBeenCalledWith(
          expect.stringContaining('from off to on'),
          'info',
          4000
        );
      });
    });

    describe('onSpecificState alerts', () => {
      it('should trigger alert when state matches target state', () => {
        mockState.CONFIG.entityAlerts.alerts['light.living_room'] = {
          onSpecificState: true,
          targetState: 'on'
        };
        alerts.initializeEntityAlerts();

        alerts.checkEntityAlerts('light.living_room', 'on');

        expect(showToast).toHaveBeenCalledWith(
          expect.stringContaining('is now on'),
          'info',
          4000
        );
        expect(global.Notification.lastNotification).toBeTruthy();
      });

      it('should not trigger alert when state does not match target', () => {
        mockState.CONFIG.entityAlerts.alerts['light.living_room'] = {
          onSpecificState: true,
          targetState: 'on'
        };
        alerts.initializeEntityAlerts();

        alerts.checkEntityAlerts('light.living_room', 'off');

        expect(showToast).not.toHaveBeenCalled();
        expect(global.Notification.lastNotification).toBeNull();
      });

      it('should trigger alert every time target state is reached', () => {
        mockState.CONFIG.entityAlerts.alerts['light.living_room'] = {
          onSpecificState: true,
          targetState: 'on'
        };
        alerts.initializeEntityAlerts();

        // First trigger
        alerts.checkEntityAlerts('light.living_room', 'on');
        expect(showToast).toHaveBeenCalledTimes(1);

        jest.clearAllMocks();

        // Second trigger (should still alert)
        alerts.checkEntityAlerts('light.living_room', 'on');
        expect(showToast).toHaveBeenCalledTimes(1);
      });
    });

    describe('alert behavior when disabled', () => {
      it('should not trigger alerts when globally disabled', () => {
        mockState.CONFIG.entityAlerts.enabled = false;
        mockState.CONFIG.entityAlerts.alerts['light.living_room'] = {
          onStateChange: true
        };
        alerts.initializeEntityAlerts();

        alerts.checkEntityAlerts('light.living_room', 'on');

        expect(showToast).not.toHaveBeenCalled();
        expect(global.Notification.lastNotification).toBeNull();
      });

      it('should not trigger alerts for entities without alert config', () => {
        alerts.initializeEntityAlerts();

        alerts.checkEntityAlerts('light.living_room', 'on');

        expect(showToast).not.toHaveBeenCalled();
        expect(global.Notification.lastNotification).toBeNull();
      });
    });

    describe('error handling', () => {
      it('should handle missing entity gracefully', () => {
        mockState.CONFIG.entityAlerts.alerts['light.nonexistent'] = {
          onStateChange: true
        };
        alerts.initializeEntityAlerts();

        expect(() => alerts.checkEntityAlerts('light.nonexistent', 'on')).not.toThrow();
      });

      it('should handle null/undefined states gracefully', () => {
        mockState.CONFIG.entityAlerts.alerts['light.living_room'] = {
          onStateChange: true
        };
        alerts.initializeEntityAlerts();

        expect(() => alerts.checkEntityAlerts('light.living_room', null)).not.toThrow();
        expect(() => alerts.checkEntityAlerts('light.living_room', undefined)).not.toThrow();
      });

      it('should catch and log errors during alert check', () => {
        const consoleError = jest.spyOn(console, 'error').mockImplementation();
        const { getEntityDisplayName } = require('../../src/utils.js');

        mockState.CONFIG.entityAlerts.alerts['light.living_room'] = {
          onStateChange: true
        };
        alerts.initializeEntityAlerts();

        // Mock getEntityDisplayName to throw error after initialization
        getEntityDisplayName.mockImplementationOnce(() => {
          throw new Error('Test error');
        });

        // Trigger state change to invoke getEntityDisplayName
        expect(() => alerts.checkEntityAlerts('light.living_room', 'off')).not.toThrow();
        expect(consoleError).toHaveBeenCalledWith('Error checking entity alerts:', expect.any(Error));

        consoleError.mockRestore();
      });
    });
  });

  describe('showEntityAlert (via notification tests)', () => {
    beforeEach(() => {
      mockState.CONFIG = getMockConfig();
      mockState.CONFIG.entityAlerts = {
        enabled: true,
        alerts: {
          'light.living_room': { onStateChange: true }
        }
      };
      mockState.STATES = sampleStates;
      alerts.initializeEntityAlerts();
    });

    it('should show browser notification when permission granted', () => {
      global.Notification.permission = 'granted';

      // Trigger state change (from 'on' to 'off')
      alerts.checkEntityAlerts('light.living_room', 'off');

      expect(global.Notification.lastNotification).toBeTruthy();
      expect(global.Notification.lastNotification.title).toBe('Home Assistant Alert');
      expect(global.Notification.lastNotification.options.body).toContain('Living Room Light');
      expect(global.Notification.lastNotification.options.tag).toBe('ha-alert-light.living_room');
    });

    it('should include entity icon in notification', () => {
      global.Notification.permission = 'granted';

      // Trigger state change (from 'on' to 'off')
      alerts.checkEntityAlerts('light.living_room', 'off');

      expect(global.Notification.lastNotification.options.icon).toBe('💡');
    });

    it('should show toast notification regardless of permission', () => {
      global.Notification.permission = 'denied';

      // Trigger state change (from 'on' to 'off')
      alerts.checkEntityAlerts('light.living_room', 'off');

      expect(showToast).toHaveBeenCalledWith(
        expect.any(String),
        'info',
        4000
      );
    });

    it('should use unknown icon for missing entity', () => {
      global.Notification.permission = 'granted';

      // Don't initialize alerts, so no previous state exists
      // This will trigger alert on first state change
      alerts.checkEntityAlerts('light.living_room', 'off');

      // Now remove entity and trigger again
      mockState.STATES = {};
      alerts.checkEntityAlerts('light.living_room', 'on');

      expect(global.Notification.lastNotification).toBeTruthy();
      expect(global.Notification.lastNotification.options.icon).toBe('❓');
    });

    it('should handle notification errors gracefully', () => {
      const consoleError = jest.spyOn(console, 'error').mockImplementation();
      global.Notification = class {
        constructor() {
          throw new Error('Notification error');
        }
      };
      global.Notification.permission = 'granted';

      // Trigger state change (from 'on' to 'off')
      expect(() => alerts.checkEntityAlerts('light.living_room', 'off')).not.toThrow();
      expect(consoleError).toHaveBeenCalledWith('Error showing entity alert:', expect.any(Error));

      consoleError.mockRestore();
    });
  });

  describe('toggleAlerts', () => {
    beforeEach(() => {
      mockState.CONFIG = getMockConfig();
      mockState.CONFIG.entityAlerts = {
        enabled: false,
        alerts: {}
      };
    });

    it('should enable alerts via IPC', async () => {
      mockElectronAPI.toggleAlerts.mockResolvedValue({ success: true });

      const result = await alerts.toggleAlerts(true);

      expect(result).toBe(true);
      expect(mockElectronAPI.toggleAlerts).toHaveBeenCalledWith(true);
      expect(showToast).toHaveBeenCalledWith('Entity alerts enabled', 'success', 2000);
    });

    it('should disable alerts via IPC', async () => {
      mockElectronAPI.toggleAlerts.mockResolvedValue({ success: true });

      const result = await alerts.toggleAlerts(false);

      expect(result).toBe(true);
      expect(mockElectronAPI.toggleAlerts).toHaveBeenCalledWith(false);
      expect(showToast).toHaveBeenCalledWith('Entity alerts disabled', 'success', 2000);
    });

    it('should handle IPC failure', async () => {
      mockElectronAPI.toggleAlerts.mockResolvedValue({ success: false });

      const result = await alerts.toggleAlerts(true);

      expect(result).toBe(false);
    });

    it('should handle IPC errors', async () => {
      const consoleError = jest.spyOn(console, 'error').mockImplementation();
      mockElectronAPI.toggleAlerts.mockRejectedValue(new Error('IPC error'));

      const result = await alerts.toggleAlerts(true);

      expect(result).toBe(false);
      expect(showToast).toHaveBeenCalledWith('Error toggling alerts', 'error', 2000);
      expect(consoleError).toHaveBeenCalled();

      consoleError.mockRestore();
    });
  });

  describe('requestNotificationPermission', () => {
    it('should request permission when permission is default', async () => {
      global.Notification.permission = 'default';
      const requestPermission = jest.fn().mockResolvedValue('granted');
      global.Notification.requestPermission = requestPermission;

      alerts.requestNotificationPermission();

      expect(requestPermission).toHaveBeenCalled();

      // Wait for promise to resolve
      await new Promise(resolve => setTimeout(resolve, 0));

      expect(showToast).toHaveBeenCalledWith('Notifications enabled', 'success', 2000);
    });

    it('should show warning when permission denied', async () => {
      global.Notification.permission = 'default';
      const requestPermission = jest.fn().mockResolvedValue('denied');
      global.Notification.requestPermission = requestPermission;

      alerts.requestNotificationPermission();

      // Wait for promise to resolve
      await new Promise(resolve => setTimeout(resolve, 0));

      expect(showToast).toHaveBeenCalledWith('Notifications disabled', 'warning', 2000);
    });

    it('should not request permission when already granted', () => {
      global.Notification.permission = 'granted';
      const requestPermission = jest.fn();
      global.Notification.requestPermission = requestPermission;

      alerts.requestNotificationPermission();

      expect(requestPermission).not.toHaveBeenCalled();
    });

    it('should not request permission when already denied', () => {
      global.Notification.permission = 'denied';
      const requestPermission = jest.fn();
      global.Notification.requestPermission = requestPermission;

      alerts.requestNotificationPermission();

      expect(requestPermission).not.toHaveBeenCalled();
    });

    it('should handle permission request errors gracefully', () => {
      const consoleError = jest.spyOn(console, 'error').mockImplementation();
      global.Notification.requestPermission = () => {
        throw new Error('Permission error');
      };
      global.Notification.permission = 'default';

      expect(() => alerts.requestNotificationPermission()).not.toThrow();
      expect(consoleError).toHaveBeenCalledWith('Error requesting notification permission:', expect.any(Error));

      consoleError.mockRestore();
    });
  });

  describe('module exports', () => {
    it('should export all required functions', () => {
      expect(typeof alerts.initializeEntityAlerts).toBe('function');
      expect(typeof alerts.checkEntityAlerts).toBe('function');
      expect(typeof alerts.toggleAlerts).toBe('function');
      expect(typeof alerts.requestNotificationPermission).toBe('function');
    });
  });
});

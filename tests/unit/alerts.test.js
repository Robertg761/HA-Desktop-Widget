/**
 * @jest-environment jsdom
 */

const {
  createMockElectronAPI,
  resetMockElectronAPI,
  getMockConfig,
} = require('../mocks/electron.js');
const { sampleStates } = require('../fixtures/ha-data.js');

// Create mock electronAPI instance
let mockElectronAPI;

// Mock dependencies
jest.mock('../../src/ui-utils.js', () => ({
  showToast: jest.fn(),
}));

jest.mock('../../src/utils.js', () => ({
  ...jest.requireActual('../../src/utils.js'),
  getStateDisplayLabel: jest.fn((rawState) => rawState),
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
  }),
}));

// Mock state module
const mockState = {
  CONFIG: null,
  STATES: {},
};

jest.mock('../../src/state.js', () => ({
  get CONFIG() {
    return mockState.CONFIG;
  },
  get STATES() {
    return mockState.STATES;
  },
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
      MockNotification.lastNotification = { title, options, instance: this };
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
  // jsdom has no canvas and reports every getContext call as an error; without one a notification
  // simply carries the app icon.
  jest.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
});

afterEach(() => jest.restoreAllMocks());

describe('the Specific State field in the alert dialog', () => {
  const fs = require('fs');
  const path = require('path');
  const html = fs.readFileSync(path.resolve(__dirname, '../../index.html'), 'utf8');
  const doc = new DOMParser().parseFromString(html, 'text/html');

  it("offers a list of the entity's states, filled in by the dialog", () => {
    const input = doc.getElementById('target-state-input');
    expect(input.getAttribute('list')).toBe('target-state-options');
    expect(doc.getElementById('target-state-options').tagName).toBe('DATALIST');
  });

  it('says to use the state Home Assistant reports, with an example', () => {
    const help = (input) => input.closest('.form-group').querySelector('.form-help');
    const text = help(doc.getElementById('target-state-input')).textContent.replace(/\s+/g, ' ');
    expect(text.trim()).toBe(
      'Use the state Home Assistant reports, such as not_home. Pick one from the list or type it.'
    );
    expect(help(doc.getElementById('target-state-input')).dataset.i18n).toBe(
      'Use the state Home Assistant reports, such as not_home. Pick one from the list or type it.'
    );
  });
});

describe('alerts module', () => {
  // Require modules once
  const alerts = require('../../src/alerts.js');
  const showToast = require('../../src/ui-utils.js').showToast;

  beforeEach(() => alerts.resetEntityAlerts());

  describe('configuration refresh during alerts', () => {
    beforeEach(() => {
      jest.useFakeTimers();
      mockState.CONFIG = {
        homeAssistant: { url: 'http://first-server', token: 'token' },
        entityAlerts: {
          enabled: true,
          alerts: {
            'sensor.temperature': {
              onNumericThreshold: true,
              threshold: 25,
              durationSeconds: 10,
              cooldownSeconds: 60,
            },
          },
        },
      };
      mockState.STATES = { 'sensor.temperature': { entity_id: 'sensor.temperature', state: '24' } };
      alerts.initializeEntityAlerts();
    });
    afterEach(() => {
      alerts.resetEntityAlerts();
      jest.useRealTimers();
    });
    const reading = (value) => {
      mockState.STATES['sensor.temperature'].state = value;
      alerts.checkEntityAlerts('sensor.temperature', value);
    };

    it('preserves a sustained alert across unrelated saves and changes to other rules', () => {
      reading('26');
      jest.advanceTimersByTime(9000);
      mockState.CONFIG.activeTabId = 'another-page';
      mockState.CONFIG.entityAlerts.alerts['light.other'] = { onStateChange: true };
      alerts.initializeEntityAlerts();
      jest.advanceTimersByTime(1000);
      expect(showToast).toHaveBeenCalledTimes(1);
    });

    it('preserves cooldown and duplicate suppression across config refreshes', () => {
      reading('26');
      jest.advanceTimersByTime(10000);
      alerts.initializeEntityAlerts();
      reading('27');
      jest.advanceTimersByTime(10000);
      expect(showToast).toHaveBeenCalledTimes(1);
      reading('24');
      reading('26');
      jest.advanceTimersByTime(10000);
      expect(showToast).toHaveBeenCalledTimes(1);
      jest.advanceTimersByTime(60000);
      reading('24');
      reading('26');
      jest.advanceTimersByTime(10000);
      expect(showToast).toHaveBeenCalledTimes(2);
    });

    it('keeps cooldowns and notified conditions across reconnects to the same server', () => {
      reading('26');
      jest.advanceTimersByTime(10000);
      expect(showToast).toHaveBeenCalledTimes(1);
      for (let attempt = 0; attempt < 3; attempt += 1) {
        alerts.suspendEntityAlerts();
        alerts.initializeEntityAlerts();
        reading('27');
        jest.advanceTimersByTime(10000);
      }
      expect(showToast).toHaveBeenCalledTimes(1);
      alerts.suspendEntityAlerts();
      alerts.initializeEntityAlerts();
      reading('24');
      reading('26');
      jest.advanceTimersByTime(10000);
      expect(showToast).toHaveBeenCalledTimes(1);
      jest.advanceTimersByTime(60000);
      reading('24');
      reading('26');
      jest.advanceTimersByTime(10000);
      expect(showToast).toHaveBeenCalledTimes(2);
    });

    it('releases a notified threshold match when the reconnect snapshot is below it', () => {
      reading('26');
      jest.advanceTimersByTime(10000);
      expect(showToast).toHaveBeenCalledTimes(1);
      alerts.suspendEntityAlerts();
      jest.advanceTimersByTime(60000);
      mockState.STATES['sensor.temperature'].state = '24';
      alerts.initializeEntityAlerts();
      reading('26');
      jest.advanceTimersByTime(10000);
      expect(showToast).toHaveBeenCalledTimes(2);
    });

    it('uses the reconnect snapshot as the baseline for later state-change alerts', () => {
      mockState.CONFIG.entityAlerts.alerts['sensor.temperature'] = { onStateChange: true };
      alerts.initializeEntityAlerts();
      alerts.suspendEntityAlerts();
      mockState.STATES['sensor.temperature'].state = '26';
      alerts.initializeEntityAlerts();
      reading('26');
      expect(showToast).not.toHaveBeenCalled();
      reading('27');
      expect(showToast).toHaveBeenCalledTimes(1);
    });

    it('re-arms an interrupted duration timer from the reconnect snapshot', () => {
      reading('26');
      jest.advanceTimersByTime(5000);
      alerts.suspendEntityAlerts();
      jest.advanceTimersByTime(60000);
      expect(showToast).not.toHaveBeenCalled();
      // The snapshot still reads 26 and no state_changed event follows.
      alerts.initializeEntityAlerts();
      jest.advanceTimersByTime(9000);
      expect(showToast).not.toHaveBeenCalled();
      jest.advanceTimersByTime(1000);
      expect(showToast).toHaveBeenCalledTimes(1);
    });

    it('does not re-arm when the reconnect snapshot no longer matches', () => {
      reading('26');
      jest.advanceTimersByTime(5000);
      alerts.suspendEntityAlerts();
      mockState.STATES['sensor.temperature'].state = '24';
      alerts.initializeEntityAlerts();
      jest.advanceTimersByTime(20000);
      expect(showToast).not.toHaveBeenCalled();
      reading('26');
      jest.advanceTimersByTime(10000);
      expect(showToast).toHaveBeenCalledTimes(1);
    });

    describe('with Home Assistant authorization', () => {
      const useOAuth = (accessToken, authorizationId = 'authorization-1') => {
        mockState.CONFIG.homeAssistant = {
          url: 'http://first-server',
          token: accessToken,
          authMethod: 'oauth',
          oauthStatus: 'connected',
          oauthAuthorizationId: authorizationId,
        };
      };
      beforeEach(() => {
        useOAuth('access-token-1');
        alerts.resetEntityAlerts();
        alerts.initializeEntityAlerts();
      });

      it('keeps a pending sustained alert when the access token is refreshed', () => {
        reading('26');
        jest.advanceTimersByTime(9000);
        useOAuth('access-token-2');
        alerts.initializeEntityAlerts();
        jest.advanceTimersByTime(1000);
        expect(showToast).toHaveBeenCalledTimes(1);
      });

      it('keeps cooldowns across access token refreshes', () => {
        reading('26');
        jest.advanceTimersByTime(10000);
        expect(showToast).toHaveBeenCalledTimes(1);
        useOAuth('access-token-2');
        alerts.initializeEntityAlerts();
        reading('24');
        reading('26');
        jest.advanceTimersByTime(10000);
        expect(showToast).toHaveBeenCalledTimes(1);
      });

      it('starts over for a new authorization', () => {
        reading('26');
        jest.advanceTimersByTime(9000);
        useOAuth('access-token-2', 'authorization-2');
        alerts.initializeEntityAlerts();
        jest.advanceTimersByTime(1000);
        expect(showToast).not.toHaveBeenCalled();
      });
    });

    it.each(['rule', 'disabled', 'server', 'disconnect'])(
      'cancels pending alerts on %s changes',
      (change) => {
        reading('26');
        jest.advanceTimersByTime(9000);
        if (change === 'rule')
          mockState.CONFIG.entityAlerts.alerts['sensor.temperature'].threshold = 30;
        if (change === 'disabled') mockState.CONFIG.entityAlerts.enabled = false;
        if (change === 'server') mockState.CONFIG.homeAssistant.url = 'http://second-server';
        if (change === 'disconnect') alerts.suspendEntityAlerts();
        else alerts.initializeEntityAlerts();
        jest.advanceTimersByTime(1000);
        expect(showToast).not.toHaveBeenCalled();
        if (change === 'rule') {
          reading('31');
          jest.advanceTimersByTime(10000);
          expect(showToast).toHaveBeenCalledTimes(1);
        }
      }
    );
  });

  describe('initializeEntityAlerts', () => {
    it('should load alert configuration from state.CONFIG', () => {
      mockState.CONFIG = getMockConfig();
      mockState.CONFIG.entityAlerts = {
        enabled: true,
        alerts: {
          'light.living_room': {
            onStateChange: true,
          },
        },
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
          'switch.bedroom': { onStateChange: true },
        },
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
          'light.living_room': { onStateChange: true },
        },
      };

      alerts.initializeEntityAlerts();
      // Should not set up any alert states when disabled
    });

    it('should handle entities that do not exist in STATES', () => {
      mockState.CONFIG = getMockConfig();
      mockState.CONFIG.entityAlerts = {
        enabled: true,
        alerts: {
          'light.nonexistent': { onStateChange: true },
        },
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
        alerts: {},
      };
      mockState.STATES = sampleStates;
    });

    describe('onStateChange alerts', () => {
      it('should trigger alert when state changes', () => {
        mockState.CONFIG.entityAlerts.alerts['light.living_room'] = {
          onStateChange: true,
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
          onStateChange: true,
        };
        alerts.initializeEntityAlerts(); // Initial state from sampleStates is 'on'

        // First call with same state as initial - should not trigger
        alerts.checkEntityAlerts('light.living_room', 'on');

        expect(showToast).not.toHaveBeenCalled();
        expect(global.Notification.lastNotification).toBeNull();
      });

      it('should include previous and new states in alert message', () => {
        mockState.CONFIG.entityAlerts.alerts['light.living_room'] = {
          onStateChange: true,
        };
        alerts.initializeEntityAlerts();

        // Establish previous state
        alerts.checkEntityAlerts('light.living_room', 'off');
        jest.clearAllMocks();

        // Trigger state change
        alerts.checkEntityAlerts('light.living_room', 'on');

        expect(showToast).toHaveBeenCalledWith(
          expect.stringContaining('from Off to On'),
          'info',
          4000
        );
      });
    });

    describe('onStateChange alerts for an entity that goes unavailable', () => {
      const { UNAVAILABLE_GRACE_MS } = require('../../src/alert-rules.js');
      beforeEach(() => jest.useFakeTimers());
      afterEach(() => {
        alerts.resetEntityAlerts();
        jest.useRealTimers();
      });

      it('tells about it after the grace period when the rule has no setting for it', () => {
        // A rule saved before the setting existed.
        mockState.CONFIG.entityAlerts.alerts['light.living_room'] = { onStateChange: true };
        alerts.initializeEntityAlerts();

        alerts.checkEntityAlerts('light.living_room', 'unavailable');
        jest.advanceTimersByTime(UNAVAILABLE_GRACE_MS - 1);
        expect(showToast).not.toHaveBeenCalled();
        jest.advanceTimersByTime(1);

        expect(showToast).toHaveBeenCalledWith(
          'Living Room Light changed from On to Unavailable',
          'info',
          4000
        );
        expect(global.Notification.lastNotification.options.body).toBe(
          'Living Room Light changed from On to Unavailable'
        );
      });

      it('says nothing about it when the rule turns that off, but still about other changes', () => {
        mockState.CONFIG.entityAlerts.alerts['light.living_room'] = {
          onStateChange: true,
          notifyOnUnavailable: false,
        };
        alerts.initializeEntityAlerts();

        alerts.checkEntityAlerts('light.living_room', 'unavailable');
        alerts.checkEntityAlerts('light.living_room', 'unknown');
        jest.advanceTimersByTime(60 * 60 * 1000);
        alerts.checkEntityAlerts('light.living_room', 'on');
        expect(showToast).not.toHaveBeenCalled();

        alerts.checkEntityAlerts('light.living_room', 'off');
        expect(showToast).toHaveBeenCalledTimes(1);
        expect(showToast).toHaveBeenCalledWith(
          expect.stringContaining('from On to Off'),
          'info',
          4000
        );
      });

      it('does not notify for a blip that comes back within the grace period', () => {
        mockState.CONFIG.entityAlerts.alerts['light.living_room'] = { onStateChange: true };
        alerts.initializeEntityAlerts();

        alerts.checkEntityAlerts('light.living_room', 'unavailable');
        jest.advanceTimersByTime(UNAVAILABLE_GRACE_MS - 1);
        alerts.checkEntityAlerts('light.living_room', 'on');
        jest.advanceTimersByTime(60 * 60 * 1000);

        expect(showToast).not.toHaveBeenCalled();
        expect(global.Notification.lastNotification).toBeNull();
      });
    });

    describe('alert messages read like the tiles', () => {
      it('rounds a numeric reading to its sensor precision and adds its unit', () => {
        mockState.STATES['sensor.load'] = {
          entity_id: 'sensor.load',
          state: '0.7160215353965759',
          attributes: { friendly_name: 'Load', unit_of_measurement: 'kW' },
        };
        mockState.CONFIG.entityAlerts.alerts['sensor.load'] = {
          onNumericThreshold: true,
          threshold: 0.5,
        };
        alerts.initializeEntityAlerts();

        alerts.checkEntityAlerts('sensor.load', '0.7160215353965759');
        expect(showToast).toHaveBeenLastCalledWith('Load is now 0.72\u00a0kW', 'info', 4000);

        mockState.STATES['sensor.garage'] = {
          entity_id: 'sensor.garage',
          state: '31.43',
          attributes: {
            friendly_name: 'Garage temperature',
            unit_of_measurement: '°C',
            device_class: 'temperature',
          },
        };
        mockState.CONFIG.entityAlerts.alerts['sensor.garage'] = {
          onNumericThreshold: true,
          threshold: 30,
        };
        alerts.initializeEntityAlerts();
        alerts.checkEntityAlerts('sensor.garage', '31.43');
        expect(showToast).toHaveBeenLastCalledWith(
          'Garage temperature is now 31.4°C',
          'info',
          4000
        );
      });

      it('uses device class words and names for states that used to show raw', () => {
        mockState.STATES['binary_sensor.door'] = {
          entity_id: 'binary_sensor.door',
          state: 'on',
          attributes: { friendly_name: 'Front door', device_class: 'door' },
        };
        mockState.STATES['sun.sun'] = {
          entity_id: 'sun.sun',
          state: 'below_horizon',
          attributes: { friendly_name: 'Sun' },
        };
        mockState.CONFIG.entityAlerts.alerts['binary_sensor.door'] = { onStateChange: true };
        mockState.CONFIG.entityAlerts.alerts['sun.sun'] = { onStateChange: true };
        alerts.initializeEntityAlerts();

        alerts.checkEntityAlerts('binary_sensor.door', 'off');
        alerts.checkEntityAlerts('binary_sensor.door', 'on');
        expect(showToast).toHaveBeenLastCalledWith(
          'Front door changed from Closed to Open',
          'info',
          4000
        );
        alerts.checkEntityAlerts('sun.sun', 'above_horizon');
        alerts.checkEntityAlerts('sun.sun', 'below_horizon');
        expect(showToast).toHaveBeenLastCalledWith(
          'Sun changed from Above horizon to Below horizon',
          'info',
          4000
        );
      });

      it('does not turn a light alert into its brightness', () => {
        mockState.STATES['light.lamp'] = {
          entity_id: 'light.lamp',
          state: 'on',
          attributes: { friendly_name: 'Lamp', brightness: 128 },
        };
        mockState.CONFIG.entityAlerts.alerts['light.lamp'] = { onStateChange: true };
        alerts.initializeEntityAlerts();
        alerts.checkEntityAlerts('light.lamp', 'off');
        alerts.checkEntityAlerts('light.lamp', 'on');
        expect(showToast).toHaveBeenLastCalledWith('Lamp changed from Off to On', 'info', 4000);
      });
    });

    describe('translated alert messages', () => {
      const i18n = require('../../src/i18n.js');
      afterEach(() => i18n.setLocaleBootstrap({ activeLocale: 'en', messages: {} }));

      it('uses the active language for the message, entity states and numeric values', () => {
        i18n.setLocaleBootstrap({
          activeLocale: 'de',
          messages: {
            '{{name}} changed from {{previousState}} to {{newState}}':
              '{{name}} wechselte von {{previousState}} zu {{newState}}',
            '{{name}} is now {{newState}}': '{{name}} ist jetzt {{newState}}',
            On: 'An',
            Off: 'Aus',
            'Home Assistant Alert': 'Home Assistant-Warnung',
          },
        });
        mockState.CONFIG.entityAlerts.alerts['light.living_room'] = { onStateChange: true };
        mockState.CONFIG.entityAlerts.alerts['sensor.temperature'] = {
          onNumericThreshold: true,
          threshold: 20,
        };
        alerts.initializeEntityAlerts();

        alerts.checkEntityAlerts('light.living_room', 'off');
        expect(showToast).toHaveBeenLastCalledWith(
          'Living Room Light wechselte von An zu Aus',
          'info',
          4000
        );
        expect(global.Notification.lastNotification.title).toBe('Home Assistant-Warnung');

        alerts.checkEntityAlerts('sensor.temperature', '21.5');
        expect(showToast).toHaveBeenLastCalledWith(
          expect.stringMatching(/ist jetzt 21,5\u00a0°C$/),
          'info',
          4000
        );
      });
    });

    describe('onSpecificState alerts', () => {
      it('should trigger alert when state matches target state', () => {
        mockState.CONFIG.entityAlerts.alerts['light.living_room'] = {
          onSpecificState: true,
          targetState: 'on',
        };
        alerts.initializeEntityAlerts();

        alerts.checkEntityAlerts('light.living_room', 'on');

        expect(showToast).toHaveBeenCalledWith(expect.stringContaining('is now On'), 'info', 4000);
        expect(global.Notification.lastNotification).toBeTruthy();
      });

      it('should not trigger alert when state does not match target', () => {
        mockState.CONFIG.entityAlerts.alerts['light.living_room'] = {
          onSpecificState: true,
          targetState: 'on',
        };
        alerts.initializeEntityAlerts();

        alerts.checkEntityAlerts('light.living_room', 'off');

        expect(showToast).not.toHaveBeenCalled();
        expect(global.Notification.lastNotification).toBeNull();
      });

      it('suppresses repeated matching updates and alerts when the target is reached again', () => {
        mockState.CONFIG.entityAlerts.alerts['light.living_room'] = {
          onSpecificState: true,
          targetState: 'on',
        };
        alerts.initializeEntityAlerts();

        // First trigger
        alerts.checkEntityAlerts('light.living_room', 'on');
        expect(showToast).toHaveBeenCalledTimes(1);

        jest.clearAllMocks();

        // Attribute-only updates must not repeat a notification.
        alerts.checkEntityAlerts('light.living_room', 'on');
        expect(showToast).not.toHaveBeenCalled();
        alerts.checkEntityAlerts('light.living_room', 'off');
        alerts.checkEntityAlerts('light.living_room', 'on');
        expect(showToast).toHaveBeenCalledTimes(1);
      });
    });

    describe('alert behavior when disabled', () => {
      it('should not trigger alerts when globally disabled', () => {
        mockState.CONFIG.entityAlerts.enabled = false;
        mockState.CONFIG.entityAlerts.alerts['light.living_room'] = {
          onStateChange: true,
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
          onStateChange: true,
        };
        alerts.initializeEntityAlerts();

        expect(() => alerts.checkEntityAlerts('light.nonexistent', 'on')).not.toThrow();
      });

      it('should handle null/undefined states gracefully', () => {
        mockState.CONFIG.entityAlerts.alerts['light.living_room'] = {
          onStateChange: true,
        };
        alerts.initializeEntityAlerts();

        expect(() => alerts.checkEntityAlerts('light.living_room', null)).not.toThrow();
        expect(() => alerts.checkEntityAlerts('light.living_room', undefined)).not.toThrow();
      });

      it('should catch and log errors during alert check', () => {
        const consoleError = jest.spyOn(console, 'error').mockImplementation();
        const { getEntityDisplayName } = require('../../src/utils.js');

        mockState.CONFIG.entityAlerts.alerts['light.living_room'] = {
          onStateChange: true,
        };
        alerts.initializeEntityAlerts();

        // Mock getEntityDisplayName to throw error after initialization
        getEntityDisplayName.mockImplementationOnce(() => {
          throw new Error('Test error');
        });

        // Trigger state change to invoke getEntityDisplayName
        expect(() => alerts.checkEntityAlerts('light.living_room', 'off')).not.toThrow();
        expect(consoleError).toHaveBeenCalledWith(
          'Error checking entity alerts:',
          expect.any(Error)
        );

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
          'light.living_room': { onStateChange: true },
        },
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

    it('opens the widget when the notification is clicked', () => {
      alerts.checkEntityAlerts('light.living_room', 'off');
      global.Notification.lastNotification.instance.onclick();
      expect(mockElectronAPI.showWindow).toHaveBeenCalledTimes(1);
    });

    describe("the notification's icon", () => {
      // A notification icon is a URL, so the entity's glyph has to be drawn to an image; jsdom has
      // no canvas, so a small one stands in.
      let context;
      let getContext;
      const fakeContext = (drawn = true) => ({
        font: '',
        fillStyle: '',
        textAlign: '',
        textBaseline: '',
        fillText: jest.fn(),
        beginPath: jest.fn(),
        arc: jest.fn(),
        fill: jest.fn(),
        drawImage: jest.fn(),
        getImageData: jest.fn(() => ({
          data: new Uint8ClampedArray(drawn ? [255, 255, 255, 255] : [0, 0, 0, 0]),
        })),
      });

      beforeEach(() => {
        global.Notification.permission = 'granted';
        context = fakeContext();
        getContext = jest
          .spyOn(HTMLCanvasElement.prototype, 'getContext')
          .mockImplementation(() => context);
        jest
          .spyOn(HTMLCanvasElement.prototype, 'toDataURL')
          .mockReturnValue('data:image/png;base64,AAAA');
      });

      it('is a drawn image, not the glyph itself, which is not a URL and showed nothing', () => {
        alerts.checkEntityAlerts('light.living_room', 'off');

        const { icon } = global.Notification.lastNotification.options;
        expect(icon).toBe('data:image/png;base64,AAAA');
        expect(icon).not.toBe('💡');
        expect(context.fillText).toHaveBeenCalledWith('💡', expect.any(Number), expect.any(Number));
        // The MDI font comes first, as it does for the icons in the window.
        expect(context.font).toContain('"Material Design Icons"');
        expect(context.font).toContain('Emoji');
      });

      it('is left out, so the app icon shows, when the glyph drew nothing', () => {
        context = fakeContext(false);

        alerts.checkEntityAlerts('light.living_room', 'off');

        expect(global.Notification.lastNotification.options).not.toHaveProperty('icon');
      });

      it('is left out when there is no canvas to draw on', () => {
        getContext.mockImplementation(() => null);

        alerts.checkEntityAlerts('light.living_room', 'off');

        expect(global.Notification.lastNotification.options).not.toHaveProperty('icon');
      });

      it('is left out when drawing fails', () => {
        context.fillText.mockImplementation(() => {
          throw new Error('font error');
        });

        alerts.checkEntityAlerts('light.living_room', 'off');

        expect(global.Notification.lastNotification).toBeTruthy();
        expect(global.Notification.lastNotification.options).not.toHaveProperty('icon');
      });

      describe('for a Material Design Icons code point', () => {
        // Home Assistant's own icons: a private-use character that only the MDI web font draws.
        const mdiGlyph = '\u{F0335}';
        const flush = () => new Promise((resolve) => setTimeout(resolve, 0));
        let loaded;
        let fonts;

        beforeEach(() => {
          loaded = false;
          fonts = {
            check: jest.fn(() => loaded),
            load: jest.fn(() => {
              loaded = true;
              return Promise.resolve([]);
            }),
          };
          Object.defineProperty(document, 'fonts', { configurable: true, value: fonts });
        });
        afterEach(() => {
          delete document.fonts;
        });
        const alertWith = (glyph = mdiGlyph) => {
          require('../../src/utils.js').getEntityIcon.mockReturnValueOnce(glyph);
          alerts.checkEntityAlerts('light.living_room', 'off');
        };

        it('waits for the font before drawing, so the first alert is not a fallback box', async () => {
          alertWith();

          // The canvas has not been touched, and the toast does not wait for the font.
          expect(global.Notification.lastNotification).toBeNull();
          expect(context.fillText).not.toHaveBeenCalled();
          expect(showToast).toHaveBeenCalledWith(expect.any(String), 'info', 4000);
          expect(fonts.load).toHaveBeenCalledWith('16px "Material Design Icons"', mdiGlyph);

          await flush();

          expect(context.fillText).toHaveBeenCalledWith(
            mdiGlyph,
            expect.any(Number),
            expect.any(Number)
          );
          expect(global.Notification.lastNotification.options.icon).toBe(
            'data:image/png;base64,AAAA'
          );
        });

        it('draws at once when the font is already loaded', () => {
          loaded = true;

          alertWith();

          expect(fonts.load).not.toHaveBeenCalled();
          expect(global.Notification.lastNotification.options.icon).toBe(
            'data:image/png;base64,AAAA'
          );
        });

        it('keeps the app icon, and still notifies, when the font fails to load', async () => {
          fonts.load.mockImplementation(() => Promise.reject(new Error('NetworkError')));

          alertWith();
          await flush();

          expect(context.fillText).not.toHaveBeenCalled();
          expect(global.Notification.lastNotification).toBeTruthy();
          expect(global.Notification.lastNotification.options).not.toHaveProperty('icon');
        });

        it('keeps the app icon when the font still is not usable after loading', async () => {
          fonts.load.mockImplementation(() => Promise.resolve([]));

          alertWith();
          await flush();

          expect(context.fillText).not.toHaveBeenCalled();
          expect(global.Notification.lastNotification.options).not.toHaveProperty('icon');
        });

        it('keeps the app icon where the page cannot say whether the font is loaded', () => {
          delete document.fonts;

          alertWith();

          expect(context.fillText).not.toHaveBeenCalled();
          expect(global.Notification.lastNotification.options).not.toHaveProperty('icon');
        });

        it('does not ask about the font for an emoji', () => {
          alertWith('💡');

          expect(fonts.check).not.toHaveBeenCalled();
          expect(global.Notification.lastNotification.options.icon).toBe(
            'data:image/png;base64,AAAA'
          );
        });
      });

      it('is never anything but a data URL or absent', () => {
        for (const url of [undefined, null, '', 'not a url']) {
          HTMLCanvasElement.prototype.toDataURL.mockReturnValue(url);
          alerts.resetEntityAlerts();
          alerts.initializeEntityAlerts();
          alerts.checkEntityAlerts('light.living_room', 'off');
          const options = global.Notification.lastNotification.options;
          expect(options.icon === undefined || options.icon.startsWith('data:')).toBe(true);
        }
      });
    });

    it('should show toast notification regardless of permission', () => {
      global.Notification.permission = 'denied';

      // Trigger state change (from 'on' to 'off')
      alerts.checkEntityAlerts('light.living_room', 'off');

      expect(showToast).toHaveBeenCalledWith(expect.any(String), 'info', 4000);
    });

    it('should keep the app icon for an entity that is gone', () => {
      global.Notification.permission = 'granted';

      // Don't initialize alerts, so no previous state exists
      // This will trigger alert on first state change
      alerts.checkEntityAlerts('light.living_room', 'off');

      // Now remove entity and trigger again
      mockState.STATES = {};
      alerts.checkEntityAlerts('light.living_room', 'on');

      expect(global.Notification.lastNotification).toBeTruthy();
      expect(global.Notification.lastNotification.options).not.toHaveProperty('icon');
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
        alerts: {},
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
      mockElectronAPI.toggleAlerts.mockResolvedValue({
        success: false,
        error: 'Config is read-only',
      });

      const result = await alerts.toggleAlerts(true);

      expect(result).toBe(false);
      expect(showToast).toHaveBeenCalledWith('Config is read-only', 'error', 3000);
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
      await new Promise((resolve) => setTimeout(resolve, 0));

      expect(showToast).toHaveBeenCalledWith('Notifications enabled', 'success', 2000);
    });

    it('should show warning when permission denied', async () => {
      global.Notification.permission = 'default';
      const requestPermission = jest.fn().mockResolvedValue('denied');
      global.Notification.requestPermission = requestPermission;

      alerts.requestNotificationPermission();

      // Wait for promise to resolve
      await new Promise((resolve) => setTimeout(resolve, 0));

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
      expect(consoleError).toHaveBeenCalledWith(
        'Error requesting notification permission:',
        expect.any(Error)
      );

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

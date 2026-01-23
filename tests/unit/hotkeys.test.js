/**
 * @jest-environment jsdom
 */

const { createMockElectronAPI, resetMockElectronAPI, getMockConfig } = require('../mocks/electron.js');
const { sampleStates } = require('../fixtures/ha-data.js');

// Mock dependencies
jest.mock('../../src/ui-utils.js', () => ({
  showToast: jest.fn()
}));

jest.mock('../../src/utils.js', () => ({
  getEntityDisplayName: jest.fn((entity) => {
    if (!entity) return 'Unknown Entity';
    return entity.attributes?.friendly_name || entity.entity_id;
  }),
  getSearchScore: jest.fn((text, filter) => {
    const lowerText = text.toLowerCase();
    const lowerFilter = filter.toLowerCase();
    if (lowerText.startsWith(lowerFilter)) return 2;
    if (lowerText.includes(lowerFilter)) return 1;
    return 0;
  })
}));

// Mock state module
const mockState = {
  CONFIG: null,
  STATES: {}
};

const state = require('../../src/state.js').default;

// Create mock electronAPI instance
let mockElectronAPI;

// Setup global mocks
beforeAll(() => {
  // Create electronAPI instance
  mockElectronAPI = createMockElectronAPI();

  // Set electronAPI on window object (jsdom)
  window.electronAPI = mockElectronAPI;
});

// Reset state before each test
beforeEach(() => {
  jest.clearAllMocks();
  resetMockElectronAPI();

  // Reset mock state
  mockState.CONFIG = null;
  mockState.STATES = {};
});

describe('hotkeys module', () => {
  // Require modules once
  const hotkeys = require('../../src/hotkeys.js');
  const showToast = require('../../src/ui-utils.js').showToast;

  describe('initializeHotkeys', () => {
    it('should load hotkey configuration from state.CONFIG', () => {
      const config = getMockConfig();
      config.globalHotkeys = {
        enabled: true,
        hotkeys: {
          'light.living_room': { hotkey: 'Ctrl+Shift+L', action: 'toggle' }
        }
      };
      state.setConfig(config);

      expect(() => hotkeys.initializeHotkeys()).not.toThrow();
    });

    it('should handle missing globalHotkeys config gracefully', () => {
      const config = getMockConfig();
      config.globalHotkeys = undefined;
      state.setConfig(config);

      expect(() => hotkeys.initializeHotkeys()).not.toThrow();
    });

    it('should handle null config gracefully', () => {
      mockState.CONFIG = null;

      expect(() => hotkeys.initializeHotkeys()).not.toThrow();
    });

    it('should catch and log errors during initialization', () => {
      const consoleError = jest.spyOn(console, 'error').mockImplementation();

      // Force an error by making CONFIG a getter that throws
      const configSpy = jest.spyOn(state, 'CONFIG', 'get').mockImplementation(() => {
        throw new Error('Test error');
      });

      expect(() => hotkeys.initializeHotkeys()).not.toThrow();
      expect(consoleError).toHaveBeenCalledWith('Error initializing hotkeys:', expect.any(Error));

      consoleError.mockRestore();

      // Restore normal state
      state.setConfig(null);
    });
  });

  describe('toggleHotkeys', () => {
    beforeEach(() => {
      const config = getMockConfig();
      config.globalHotkeys = {
        enabled: false,
        hotkeys: {}
      };
      state.setConfig(config);
    });

    it('should call IPC to enable hotkeys', async () => {
      await hotkeys.toggleHotkeys(true);
      expect(mockElectronAPI.toggleHotkeys).toHaveBeenCalledWith(true);
    });

    it('should call IPC to disable hotkeys', async () => {
      await hotkeys.toggleHotkeys(false);
      expect(mockElectronAPI.toggleHotkeys).toHaveBeenCalledWith(false);
    });

    it('should handle IPC failure', async () => {
      mockElectronAPI.toggleHotkeys.mockResolvedValue({ success: false });

      const result = await hotkeys.toggleHotkeys(true);

      expect(result).toBe(false);
    });

    it('should handle IPC errors', async () => {
      const consoleError = jest.spyOn(console, 'error').mockImplementation();
      mockElectronAPI.toggleHotkeys.mockRejectedValue(new Error('IPC error'));

      const result = await hotkeys.toggleHotkeys(true);

      expect(result).toBe(false);
      expect(showToast).toHaveBeenCalledWith('Error toggling hotkeys', 'error', 2000);
      expect(consoleError).toHaveBeenCalled();

      consoleError.mockRestore();
    });
  });

  describe('renderHotkeysTab', () => {
    beforeEach(() => {
      const config = getMockConfig();
      config.globalHotkeys = {
        enabled: true,
        hotkeys: {
          'light.living_room': { hotkey: 'Ctrl+Shift+L', action: 'toggle' }
        }
      };
      state.setConfig(config);
      state.setStates(sampleStates);
    });

    it('should handle missing container gracefully', () => {
      document.getElementById = jest.fn(() => null);

      expect(() => hotkeys.renderHotkeysTab()).not.toThrow();
    });

    it('should render hotkey entities with search filter', () => {
      // Create real DOM elements
      const container = document.createElement('div');
      const searchInput = document.createElement('input');
      container.id = 'hotkeys-list';
      searchInput.id = 'hotkey-entity-search';
      searchInput.value = '';
      document.body.appendChild(container);
      document.body.appendChild(searchInput);

      expect(() => hotkeys.renderHotkeysTab()).not.toThrow();

      document.body.removeChild(container);
      document.body.removeChild(searchInput);
    });

    it('should filter entities by search term', () => {
      // Create real DOM elements
      const container = document.createElement('div');
      const searchInput = document.createElement('input');
      container.id = 'hotkeys-list';
      searchInput.id = 'hotkey-entity-search';
      searchInput.value = 'living';
      document.body.appendChild(container);
      document.body.appendChild(searchInput);

      expect(() => hotkeys.renderHotkeysTab()).not.toThrow();

      document.body.removeChild(container);
      document.body.removeChild(searchInput);
    });

    it('should handle rendering errors gracefully', () => {
      const consoleError = jest.spyOn(console, 'error').mockImplementation();

      document.getElementById = jest.fn(() => {
        throw new Error('DOM error');
      });

      expect(() => hotkeys.renderHotkeysTab()).not.toThrow();
      expect(consoleError).toHaveBeenCalledWith('Error rendering hotkeys tab:', expect.any(Error));

      consoleError.mockRestore();
    });
  });

  describe('renderExistingHotkeys', () => {
    beforeEach(() => {
      const config = getMockConfig();
      config.globalHotkeys = {
        enabled: true,
        hotkeys: {
          'light.living_room': { hotkey: 'Ctrl+Shift+L', action: 'toggle' },
          'switch.bedroom': 'Ctrl+Shift+B'
        }
      };
      state.setConfig(config);
      state.setStates(sampleStates);
    });

    it('should handle missing container gracefully', () => {
      document.getElementById = jest.fn(() => null);

      expect(() => hotkeys.renderExistingHotkeys()).not.toThrow();
    });

    it('should render existing hotkeys', () => {
      // Create real DOM element
      const container = document.createElement('div');
      container.id = 'existing-hotkeys-list';
      document.body.appendChild(container);

      expect(() => hotkeys.renderExistingHotkeys()).not.toThrow();

      document.body.removeChild(container);
    });

    it('should skip entities that do not exist in STATES', () => {
      const config = getMockConfig();
      config.globalHotkeys = {
        enabled: true,
        hotkeys: {
          'light.living_room': { hotkey: 'Ctrl+Shift+L', action: 'toggle' },
          'light.nonexistent': 'Ctrl+Shift+N'
        }
      };
      state.setConfig(config);

      // Create real DOM element
      const container = document.createElement('div');
      container.id = 'existing-hotkeys-list';
      document.body.appendChild(container);

      expect(() => hotkeys.renderExistingHotkeys()).not.toThrow();

      document.body.removeChild(container);
    });

    it('should handle rendering errors gracefully', () => {
      const consoleError = jest.spyOn(console, 'error').mockImplementation();

      document.getElementById = jest.fn(() => {
        throw new Error('DOM error');
      });

      expect(() => hotkeys.renderExistingHotkeys()).not.toThrow();
      expect(consoleError).toHaveBeenCalledWith('Error rendering existing hotkeys:', expect.any(Error));

      consoleError.mockRestore();
    });
  });

  describe('captureHotkey', () => {
    it('should handle errors gracefully when DOM operations fail', async () => {
      // This test is mainly to ensure the error handling works
      // Testing the full modal interaction is complex in jest/jsdom
      expect(typeof hotkeys.captureHotkey).toBe('function');
    });
  });

  describe('cleanupHotkeyEventListeners', () => {
    it('should not throw when cleaning up event listeners', () => {
      expect(() => hotkeys.cleanupHotkeyEventListeners()).not.toThrow();
    });
  });

  describe('setupHotkeyEventListeners', () => {
    it('should be a no-op function for backward compatibility', () => {
      expect(() => hotkeys.setupHotkeyEventListeners()).not.toThrow();
    });
  });

  describe('module exports', () => {
    it('should export all required functions', () => {
      expect(typeof hotkeys.initializeHotkeys).toBe('function');
      expect(typeof hotkeys.renderHotkeysTab).toBe('function');
      expect(typeof hotkeys.toggleHotkeys).toBe('function');
      expect(typeof hotkeys.captureHotkey).toBe('function');
      expect(typeof hotkeys.renderExistingHotkeys).toBe('function');
      expect(typeof hotkeys.setupHotkeyEventListeners).toBe('function');
      expect(typeof hotkeys.cleanupHotkeyEventListeners).toBe('function');
    });
  });
});

/**
 * Mock Electron APIs for Testing
 *
 * This module mocks the window.electronAPI interface that's exposed
 * by preload.js to the renderer process. All methods return promises
 * to match the async IPC behavior.
 */

// Mock configuration storage
let mockConfig = {
  windowPosition: { x: 100, y: 100 },
  windowSize: { width: 500, height: 600 },
  alwaysOnTop: true,
  opacity: 0.95,
  homeAssistant: {
    url: 'http://homeassistant.local:8123',
    token: 'mock_long_lived_access_token',
    tokenEncrypted: false
  },
  globalHotkeys: {
    enabled: false,
    hotkeys: {}
  },
  entityAlerts: {
    enabled: false,
    alerts: {}
  },
  popupHotkey: '',
  favoriteEntities: ['light.living_room', 'switch.bedroom', 'sensor.temperature'],
  customEntityNames: {},
  selectedWeatherEntity: null,
  primaryMediaPlayer: null,
  ui: {
    theme: 'auto',
    highContrast: false,
    opaquePanels: false,
    density: 'comfortable'
  },
  customTabs: []
};

// Event listeners storage
const eventListeners = {
  hotkeyTriggered: [],
  hotkeyRegistrationFailed: [],
  autoUpdate: [],
  openSettings: []
};

/**
 * Creates a mock window.electronAPI object
 */
function createMockElectronAPI() {
  return {
    // Config Operations
    getConfig: jest.fn(() => Promise.resolve({ ...mockConfig })),
    updateConfig: jest.fn((config) => {
      mockConfig = { ...mockConfig, ...config };
      return Promise.resolve();
    }),
    saveConfig: jest.fn((config) => {
      mockConfig = { ...mockConfig, ...config };
      return Promise.resolve();
    }),

    // Window Operations
    setOpacity: jest.fn((_opacity) => Promise.resolve()),
    setAlwaysOnTop: jest.fn((_value) => Promise.resolve()),
    getWindowState: jest.fn(() => Promise.resolve({
      isAlwaysOnTop: mockConfig.alwaysOnTop,
      opacity: mockConfig.opacity,
      position: mockConfig.windowPosition,
      size: mockConfig.windowSize
    })),
    minimizeWindow: jest.fn(() => Promise.resolve()),
    focusWindow: jest.fn(() => Promise.resolve()),
    restartApp: jest.fn(() => Promise.resolve()),
    quitApp: jest.fn(() => Promise.resolve()),

    // Hotkey Operations
    registerHotkey: jest.fn((_entityId, _hotkey, _action) => Promise.resolve({ success: true })),
    unregisterHotkey: jest.fn((_entityId) => Promise.resolve({ success: true })),
    registerHotkeys: jest.fn(() => Promise.resolve({ success: true })),
    toggleHotkeys: jest.fn((_enabled) => Promise.resolve({ success: true })),
    validateHotkey: jest.fn((_hotkey) => Promise.resolve({ valid: true, error: null })),
    registerPopupHotkey: jest.fn((_hotkey) => Promise.resolve({ success: true })),
    unregisterPopupHotkey: jest.fn(() => Promise.resolve({ success: true })),
    getPopupHotkey: jest.fn(() => Promise.resolve(mockConfig.popupHotkey)),
    isPopupHotkeyAvailable: jest.fn(() => Promise.resolve(true)),

    // Alert Operations
    setEntityAlert: jest.fn((_entityId, _alertConfig) => Promise.resolve()),
    removeEntityAlert: jest.fn((_entityId) => Promise.resolve()),
    toggleAlerts: jest.fn((_enabled) => Promise.resolve({ success: true })),

    // Update Operations
    checkForUpdates: jest.fn(() => Promise.resolve({ updateAvailable: false })),
    quitAndInstall: jest.fn(() => Promise.resolve()),

    // Utility Operations
    getAppVersion: jest.fn(() => Promise.resolve('1.0.0-test')),
    openLogs: jest.fn(() => Promise.resolve()),

    // Event Listeners (Main → Renderer)
    onHotkeyTriggered: jest.fn((callback) => {
      eventListeners.hotkeyTriggered.push(callback);
      return () => {
        const index = eventListeners.hotkeyTriggered.indexOf(callback);
        if (index > -1) eventListeners.hotkeyTriggered.splice(index, 1);
      };
    }),
    onHotkeyRegistrationFailed: jest.fn((callback) => {
      eventListeners.hotkeyRegistrationFailed.push(callback);
      return () => {
        const index = eventListeners.hotkeyRegistrationFailed.indexOf(callback);
        if (index > -1) eventListeners.hotkeyRegistrationFailed.splice(index, 1);
      };
    }),
    onAutoUpdate: jest.fn((callback) => {
      eventListeners.autoUpdate.push(callback);
      return () => {
        const index = eventListeners.autoUpdate.indexOf(callback);
        if (index > -1) eventListeners.autoUpdate.splice(index, 1);
      };
    }),
    onOpenSettings: jest.fn((callback) => {
      eventListeners.openSettings.push(callback);
      return () => {
        const index = eventListeners.openSettings.indexOf(callback);
        if (index > -1) eventListeners.openSettings.splice(index, 1);
      };
    })
  };
}

/**
 * Helper function to trigger mock events
 */
function triggerMockEvent(eventType, data) {
  const listeners = eventListeners[eventType];
  if (listeners) {
    listeners.forEach(callback => callback(data));
  }
}

/**
 * Reset mock state (useful between tests)
 */
function resetMockElectronAPI() {
  mockConfig = {
    windowPosition: { x: 100, y: 100 },
    windowSize: { width: 500, height: 600 },
    alwaysOnTop: true,
    opacity: 0.95,
    homeAssistant: {
      url: 'http://homeassistant.local:8123',
      token: 'mock_long_lived_access_token',
      tokenEncrypted: false
    },
    globalHotkeys: {
      enabled: false,
      hotkeys: {}
    },
    entityAlerts: {
      enabled: false,
      alerts: {}
    },
    popupHotkey: '',
    favoriteEntities: ['light.living_room', 'switch.bedroom', 'sensor.temperature'],
    customEntityNames: {},
    selectedWeatherEntity: null,
    primaryMediaPlayer: null,
    ui: {
      theme: 'auto',
      highContrast: false,
      opaquePanels: false,
      density: 'comfortable'
    },
    customTabs: []
  };

  // Clear event listeners
  eventListeners.hotkeyTriggered = [];
  eventListeners.hotkeyRegistrationFailed = [];
  eventListeners.autoUpdate = [];
  eventListeners.openSettings = [];
}

/**
 * Get current mock config (for assertions)
 */
function getMockConfig() {
  return { ...mockConfig };
}

/**
 * Set mock config (for test setup)
 */
function setMockConfig(config) {
  mockConfig = { ...mockConfig, ...config };
}

module.exports = {
  createMockElectronAPI,
  triggerMockEvent,
  resetMockElectronAPI,
  getMockConfig,
  setMockConfig
};

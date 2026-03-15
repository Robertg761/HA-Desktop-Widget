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
  desktopPins: {},
  customEntityNames: {},
  customEntityIcons: {},
  selectedWeatherEntity: null,
  primaryMediaPlayer: null,
  ui: {
    theme: 'auto',
    highContrast: false,
    opaquePanels: false,
    density: 'comfortable',
    customColors: [],
    personalizationSectionsCollapsed: {},
    enableInteractionDebugLogs: false
  },
  customTabs: [],
  profileSync: {
    enabled: false,
    provider: 'cloudFile',
    cloudFilePath: '',
    syncScope: {
      preset: 'all',
      sections: {
        quickAccessLayout: true,
        visualPersonalization: true,
        automationAlerts: true,
        connectionMediaPreferences: true
      }
    },
    intervalMinutes: 5,
    encryptionEnabled: false,
    rememberPassphrase: false,
    passphraseEncrypted: false,
    lastSyncAt: null,
    lastSyncStatus: 'idle',
    lastSyncError: '',
    deviceId: 'test-device-1'
  }
};

// Event listeners storage
const eventListeners = {
  hotkeyTriggered: [],
  hotkeyRegistrationFailed: [],
  autoUpdate: [],
  openSettings: [],
  profileSyncStatus: [],
  configUpdated: [],
  desktopPinUpdate: [],
  desktopPinActionRequested: []
};

/**
 * Creates a mock window.electronAPI object
 */
function createMockElectronAPI() {
  const chooseProfileSyncFolder = jest.fn((provider = 'cloudFile') => Promise.resolve({
    canceled: false,
    folderPath: '/tmp/profile-sync',
    filePath: '/tmp/profile-sync/ha-widget-profile-sync.json',
    provider
  }));
  const copyProfileSyncFile = jest.fn((_fromPath, _toPath, _overwrite = false) => Promise.resolve({
    ok: true,
    status: 'copied',
    copied: true,
    overwritten: false
  }));

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
    chooseProfileSyncFolder,
    copyProfileSyncFile,
    chooseProfileSyncFile: chooseProfileSyncFolder,
    getProfileSyncStatus: jest.fn(() => Promise.resolve({
      enabled: !!mockConfig.profileSync?.enabled,
      provider: mockConfig.profileSync?.provider || 'cloudFile',
      cloudFilePath: mockConfig.profileSync?.cloudFilePath || '',
      syncScope: mockConfig.profileSync?.syncScope || {
        preset: 'all',
        sections: {
          quickAccessLayout: true,
          visualPersonalization: true,
          automationAlerts: true,
          connectionMediaPreferences: true
        }
      },
      intervalMinutes: mockConfig.profileSync?.intervalMinutes || 5,
      encryptionEnabled: !!mockConfig.profileSync?.encryptionEnabled,
      rememberPassphrase: !!mockConfig.profileSync?.rememberPassphrase,
      passphraseEncrypted: !!mockConfig.profileSync?.passphraseEncrypted,
      passphraseStored: false,
      passphraseWarning: '',
      lastSyncAt: mockConfig.profileSync?.lastSyncAt || null,
      lastSyncStatus: mockConfig.profileSync?.lastSyncStatus || 'idle',
      lastSyncError: mockConfig.profileSync?.lastSyncError || '',
      inFlight: false,
      needsResolution: false
    })),
    runProfileSync: jest.fn((_direction) => Promise.resolve({ ok: true, action: 'none' })),
    setProfileSyncPassphrase: jest.fn((_passphrase, _remember) => Promise.resolve({ success: true })),
    clearProfileSyncPassphrase: jest.fn(() => Promise.resolve({ success: true })),
    resolveProfileSyncFirstEnable: jest.fn((_choice) => Promise.resolve({ success: true })),

    // Window Operations
    setOpacity: jest.fn((_opacity) => Promise.resolve()),
    setAlwaysOnTop: jest.fn((_value) => Promise.resolve()),
    getLoginItemSettings: jest.fn(() => Promise.resolve({ openAtLogin: false })),
    setLoginItemSettings: jest.fn((openAtLogin) => Promise.resolve({ success: true, openAtLogin: !!openAtLogin })),
    getWindowState: jest.fn(() => Promise.resolve({
      isAlwaysOnTop: mockConfig.alwaysOnTop,
      opacity: mockConfig.opacity,
      position: mockConfig.windowPosition,
      size: mockConfig.windowSize
    })),
    minimizeWindow: jest.fn(() => Promise.resolve()),
    focusWindow: jest.fn(() => Promise.resolve()),
    focusDesktopPin: jest.fn((_entityId) => Promise.resolve({ focused: true, exists: true })),
    pinEntityToDesktop: jest.fn((_entityId) => Promise.resolve({
      success: true,
      focused: false,
      pinBounds: { x: 10, y: 20, width: 168, height: 148 }
    })),
    unpinEntityFromDesktop: jest.fn((_entityId) => Promise.resolve({ success: true })),
    setDesktopPinEditMode: jest.fn((_enabled) => Promise.resolve({ success: true, enabled: !!_enabled })),
    updateDesktopPinBounds: jest.fn((_entityId, bounds) => Promise.resolve({ success: true, pinBounds: bounds })),
    syncDesktopPinContentMinBounds: jest.fn((_entityId, minBounds) => Promise.resolve({ success: true, minBounds, pinBounds: { x: 10, y: 20, width: minBounds?.width || 168, height: minBounds?.height || 148 } })),
    getDesktopPinBootstrap: jest.fn((_entityId) => Promise.resolve(null)),
    publishHaSnapshot: jest.fn((_states) => Promise.resolve()),
    publishHaEntityUpdate: jest.fn((_entity) => Promise.resolve()),
    requestDesktopPinAction: jest.fn((_entityId, _action, _payload) => Promise.resolve({ success: true })),
    showEntityTileMenu: jest.fn((_entityId) => Promise.resolve({ shown: true })),
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
    openExternal: jest.fn(() => Promise.resolve({ success: true })),
    debugLog: jest.fn(() => Promise.resolve({ success: true })),

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
    }),
    onProfileSyncStatus: jest.fn((callback) => {
      eventListeners.profileSyncStatus.push(callback);
      return () => {
        const index = eventListeners.profileSyncStatus.indexOf(callback);
        if (index > -1) eventListeners.profileSyncStatus.splice(index, 1);
      };
    }),
    onConfigUpdated: jest.fn((callback) => {
      eventListeners.configUpdated.push(callback);
      return () => {
        const index = eventListeners.configUpdated.indexOf(callback);
        if (index > -1) eventListeners.configUpdated.splice(index, 1);
      };
    }),
    onDesktopPinUpdate: jest.fn((callback) => {
      eventListeners.desktopPinUpdate.push(callback);
      return () => {
        const index = eventListeners.desktopPinUpdate.indexOf(callback);
        if (index > -1) eventListeners.desktopPinUpdate.splice(index, 1);
      };
    }),
    onDesktopPinActionRequested: jest.fn((callback) => {
      eventListeners.desktopPinActionRequested.push(callback);
      return () => {
        const index = eventListeners.desktopPinActionRequested.indexOf(callback);
        if (index > -1) eventListeners.desktopPinActionRequested.splice(index, 1);
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
    desktopPins: {},
    customEntityNames: {},
    customEntityIcons: {},
    selectedWeatherEntity: null,
    primaryMediaPlayer: null,
    ui: {
      theme: 'auto',
      highContrast: false,
      opaquePanels: false,
      density: 'comfortable',
      customColors: [],
      personalizationSectionsCollapsed: {},
      enableInteractionDebugLogs: false
    },
    customTabs: [],
    profileSync: {
      enabled: false,
      provider: 'cloudFile',
      cloudFilePath: '',
      syncScope: {
        preset: 'all',
        sections: {
          quickAccessLayout: true,
          visualPersonalization: true,
          automationAlerts: true,
          connectionMediaPreferences: true
        }
      },
      intervalMinutes: 5,
      encryptionEnabled: false,
      rememberPassphrase: false,
      passphraseEncrypted: false,
      lastSyncAt: null,
      lastSyncStatus: 'idle',
      lastSyncError: '',
      deviceId: 'test-device-1'
    }
  };

  // Clear event listeners
  eventListeners.hotkeyTriggered = [];
  eventListeners.hotkeyRegistrationFailed = [];
  eventListeners.autoUpdate = [];
  eventListeners.openSettings = [];
  eventListeners.profileSyncStatus = [];
  eventListeners.configUpdated = [];
  eventListeners.desktopPinUpdate = [];
  eventListeners.desktopPinActionRequested = [];
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

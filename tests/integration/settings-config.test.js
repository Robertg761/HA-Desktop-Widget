/**
 * @jest-environment jsdom
 */

const { createMockElectronAPI, resetMockElectronAPI, getMockConfig } = require('../mocks/electron.js');
const { sampleStates, sampleConfig: _sampleConfig } = require('../fixtures/ha-data.js');

// Mock dependencies that settings.js requires
const mockWebsocket = {
  connect: jest.fn()
};

const mockUiUtils = {
  applyTheme: jest.fn(),
  applyAccentTheme: jest.fn(),
  applyBackgroundTheme: jest.fn(),
  applyUiPreferences: jest.fn(),
  applyWindowEffects: jest.fn(),
  getAccentThemes: jest.fn(() => ([
    {
      id: 'original',
      name: 'Original',
      color: '#64b5f6',
      description: 'Mock theme',
      rgb: '100, 181, 246'
    },
    {
      id: 'slate',
      name: 'Slate',
      color: '#94a3b8',
      description: 'Mock theme',
      rgb: '148, 163, 184'
    },
    {
      id: 'rose',
      name: 'Rose',
      color: '#f43f5e',
      description: 'Mock theme',
      rgb: '244, 63, 94'
    },
  ])),
  trapFocus: jest.fn(),
  releaseFocusTrap: jest.fn(),
  showToast: jest.fn(),
  showConfirm: jest.fn().mockResolvedValue(true)
};

const mockHotkeys = {
  cleanupHotkeyEventListeners: jest.fn()
};

const mockUI = {
  updateMediaTile: jest.fn()
};

// Mock all dependencies before requiring settings.js
jest.mock('../../src/websocket.js', () => mockWebsocket);
jest.mock('../../src/ui-utils.js', () => mockUiUtils);
jest.mock('../../src/hotkeys.js', () => mockHotkeys);
jest.mock('../../src/ui.js', () => mockUI, { virtual: true });

// Setup mock electronAPI
let mockElectronAPI;

beforeAll(() => {
  mockElectronAPI = createMockElectronAPI();
  window.electronAPI = mockElectronAPI;

  // Mock window.confirm for jsdom
  window.confirm = jest.fn().mockReturnValue(false); // Default to false (don't restart)
});

beforeEach(() => {
  jest.clearAllMocks();
  resetMockElectronAPI();

  // Clear any existing DOM
  document.body.innerHTML = '';

  // Create the settings modal DOM structure
  createSettingsModalDOM();

  // Reset state module
  const state = require('../../src/state.js').default;
  const testConfig = getMockConfig();
  testConfig.homeAssistant = {
    url: 'http://homeassistant.local:8123',
    token: 'test-token-123'
  };
  testConfig.opacity = 0.95;
  testConfig.alwaysOnTop = true;
  testConfig.globalHotkeys = { enabled: true, hotkeys: {} };
  testConfig.entityAlerts = { enabled: false, alerts: {} };
  testConfig.primaryMediaPlayer = null;
  testConfig.ui = { theme: 'auto', highContrast: false, opaquePanels: false, density: 'comfortable' };
  state.setConfig(testConfig);

  // Mock states with media players
  const mockStates = {
    ...sampleStates,
    'media_player.spotify': {
      entity_id: 'media_player.spotify',
      state: 'playing',
      attributes: { friendly_name: 'Spotify' }
    },
    'media_player.bedroom_speaker': {
      entity_id: 'media_player.bedroom_speaker',
      state: 'idle',
      attributes: { friendly_name: 'Bedroom Speaker' }
    }
  };
  state.setStates(mockStates);
});

afterEach(() => {
  // Clean up DOM
  document.body.innerHTML = '';
});

/**
 * Helper function to create the settings modal DOM structure
 */
function createSettingsModalDOM() {
  const modal = document.createElement('div');
  modal.id = 'settings-modal';
  modal.className = 'hidden';
  modal.style.display = 'none';

  modal.innerHTML = `
    <div class="modal-content">
      <h2>Settings</h2>

      <label for="ha-url">Home Assistant URL</label>
      <input type="text" id="ha-url" />

      <label for="ha-token">Access Token</label>
      <input type="password" id="ha-token" />

      <label for="always-on-top">
        <input type="checkbox" id="always-on-top" />
        Always on Top
      </label>

      <label for="opacity-slider">Opacity</label>
      <input type="range" id="opacity-slider" min="1" max="100" />
      <span id="opacity-value">90</span>

      <label for="global-hotkeys-enabled">
        <input type="checkbox" id="global-hotkeys-enabled" />
        Enable Global Hotkeys
      </label>
      <div id="hotkeys-section" style="display: none;"></div>

      <label for="entity-alerts-enabled">
        <input type="checkbox" id="entity-alerts-enabled" />
        Enable Entity Alerts
      </label>
      <div id="alerts-section" style="display: none;">
        <div id="inline-alerts-list"></div>
      </div>

      <label>Primary Media Player</label>
      <div id="primary-media-player-dropdown" class="custom-dropdown">
        <div id="primary-media-player-trigger">
          <span class="custom-dropdown-value">None</span>
        </div>
        <div id="primary-media-player-menu" class="custom-dropdown-menu"></div>
      </div>

      <div id="popup-hotkey-container">
        <input type="text" id="popup-hotkey-input" />
        <button id="popup-hotkey-set-btn">Set Hotkey</button>
        <button id="popup-hotkey-clear-btn" style="display: none;">Clear</button>
      </div>

      <button id="save-settings-btn">Save</button>
      <button id="close-settings-btn">Cancel</button>
    </div>
  `;

  document.body.appendChild(modal);
}

describe('Settings + Config Integration', () => {
  const settings = require('../../src/settings.js');
  const state = require('../../src/state.js').default;

  describe('Settings Open/Close Flow', () => {
    test('opening settings populates fields from config', async () => {
      const mockUiHooks = {
        exitReorganizeMode: jest.fn(),
        initUpdateUI: jest.fn()
      };

      await settings.openSettings(mockUiHooks);

      const modal = document.getElementById('settings-modal');
      const haUrl = document.getElementById('ha-url');
      const haToken = document.getElementById('ha-token');
      const alwaysOnTop = document.getElementById('always-on-top');
      const opacitySlider = document.getElementById('opacity-slider');

      expect(modal.classList.contains('hidden')).toBe(false);
      expect(modal.style.display).toBe('flex');
      expect(haUrl.value).toBe('http://homeassistant.local:8123');
      expect(haToken.value).toBe('test-token-123');
      expect(alwaysOnTop.checked).toBe(true);
      expect(parseInt(opacitySlider.value)).toBeGreaterThan(0);

      expect(mockUiUtils.trapFocus).toHaveBeenCalledWith(modal);
      expect(mockUiHooks.initUpdateUI).toHaveBeenCalled();
    });

    test('closing settings cleans up modal and focus trap', () => {
      // First open settings
      settings.openSettings();

      const modal = document.getElementById('settings-modal');
      modal.classList.remove('hidden');
      modal.style.display = 'flex';

      // Close settings
      settings.closeSettings();

      expect(modal.classList.contains('hidden')).toBe(true);
      expect(modal.style.display).toBe('none');
      expect(mockUiUtils.releaseFocusTrap).toHaveBeenCalledWith(modal);
      expect(mockHotkeys.cleanupHotkeyEventListeners).toHaveBeenCalled();
    });

    test('opening settings exits reorganize mode', async () => {
      const mockUiHooks = {
        exitReorganizeMode: jest.fn(),
        initUpdateUI: jest.fn()
      };

      await settings.openSettings(mockUiHooks);

      expect(mockUiHooks.exitReorganizeMode).toHaveBeenCalled();
    });
  });

  describe('Config Save Flow', () => {
    test('save valid settings updates config and IPC', async () => {
      // Open settings first
      await settings.openSettings();

      // Modify fields
      document.getElementById('ha-url').value = 'https://new-ha.example.com';
      document.getElementById('ha-token').value = 'new-token-456';
      document.getElementById('always-on-top').checked = false;
      document.getElementById('opacity-slider').value = '75';

      // Save settings
      await settings.saveSettings();

      // Verify config updated
      expect(state.CONFIG.homeAssistant.url).toBe('https://new-ha.example.com');
      expect(state.CONFIG.homeAssistant.token).toBe('new-token-456');
      expect(state.CONFIG.alwaysOnTop).toBe(false);
      expect(state.CONFIG.opacity).toBeCloseTo(0.87, 2); // slider 75 → opacity

      // Verify IPC calls
      expect(window.electronAPI.updateConfig).toHaveBeenCalledWith(state.CONFIG);
      expect(window.electronAPI.setOpacity).toHaveBeenCalledWith(expect.any(Number));

      // Verify modal closed
      const modal = document.getElementById('settings-modal');
      expect(modal.classList.contains('hidden')).toBe(true);

      // Verify theme applied
      expect(mockUiUtils.applyTheme).toHaveBeenCalled();
      expect(mockUiUtils.applyUiPreferences).toHaveBeenCalled();
    });

    test('URL validation prevents invalid save', async () => {
      await settings.openSettings();

      // Set invalid URL (no protocol)
      document.getElementById('ha-url').value = 'homeassistant.local:8123';

      await settings.saveSettings();

      // Verify error toast shown
      expect(mockUiUtils.showToast).toHaveBeenCalledWith(
        expect.stringContaining('http://'),
        'error',
        expect.any(Number)
      );

      // Verify config NOT updated
      expect(state.CONFIG.homeAssistant.url).toBe('http://homeassistant.local:8123'); // Original value
      expect(window.electronAPI.updateConfig).not.toHaveBeenCalled();

      // Verify modal still open
      const modal = document.getElementById('settings-modal');
      expect(modal.classList.contains('hidden')).toBe(false);
    });

    test('empty URL validation', async () => {
      await settings.openSettings();

      // Clear URL field
      document.getElementById('ha-url').value = '   ';

      await settings.saveSettings();

      // Verify error toast
      expect(mockUiUtils.showToast).toHaveBeenCalledWith(
        expect.stringContaining('empty'),
        'error',
        expect.any(Number)
      );

      // Verify config NOT updated
      expect(window.electronAPI.updateConfig).not.toHaveBeenCalled();
    });

    test('opacity conversion and application', async () => {
      await settings.openSettings();

      // Set opacity slider to specific values and verify conversion
      const testCases = [
        { slider: 1, expected: 0.5 },    // Minimum
        { slider: 50, expected: 0.747 },  // Middle
        { slider: 100, expected: 1.0 }   // Maximum
      ];

      for (const testCase of testCases) {
        jest.clearAllMocks();

        document.getElementById('opacity-slider').value = testCase.slider.toString();

        await settings.saveSettings();

        expect(state.CONFIG.opacity).toBeCloseTo(testCase.expected, 2);
        expect(window.electronAPI.setOpacity).toHaveBeenCalledWith(
          expect.closeTo(testCase.expected, 2)
        );
      }
    });
  });

  describe('WebSocket Reconnection Trigger', () => {
    test('connection settings change triggers reconnect', async () => {
      await settings.openSettings();

      // Change HA URL
      document.getElementById('ha-url').value = 'https://different-ha.com';

      await settings.saveSettings();

      // Verify websocket.connect() was called
      expect(mockWebsocket.connect).toHaveBeenCalled();
    });

    test('non-connection settings do not trigger reconnect', async () => {
      await settings.openSettings();

      // Change only opacity (non-connection setting)
      document.getElementById('opacity-slider').value = '80';

      await settings.saveSettings();

      // Verify websocket.connect() was NOT called
      expect(mockWebsocket.connect).not.toHaveBeenCalled();
    });
  });

  describe('Settings Coordination', () => {
    test('media player selection updates immediately', async () => {
      await settings.openSettings();

      // Simulate selecting a media player
      const menu = document.getElementById('primary-media-player-menu');
      expect(menu.innerHTML).toContain('Spotify'); // Verify dropdown populated

      // Find the Spotify option and mark it as selected
      const options = menu.querySelectorAll('.custom-dropdown-option');

      // First remove 'selected' class from all options
      options.forEach(opt => opt.classList.remove('selected'));

      // Then add 'selected' class to the Spotify option
      const spotifyOption = Array.from(options).find(opt =>
        opt.getAttribute('data-value') === 'media_player.spotify'
      );

      expect(spotifyOption).toBeDefined();
      spotifyOption.classList.add('selected'); // Simulate selection

      await settings.saveSettings();

      // Verify config updated
      expect(state.CONFIG.primaryMediaPlayer).toBe('media_player.spotify');

      // Verify updateMediaTile was called
      expect(mockUI.updateMediaTile).toHaveBeenCalled();
    });

    test('theme and UI preferences applied immediately', async () => {
      // Set a specific theme in config
      const testConfig = state.CONFIG;
      testConfig.ui = { theme: 'dark', highContrast: true };
      state.setConfig(testConfig);

      await settings.openSettings();
      await settings.saveSettings();

      // Verify theme and UI preferences applied
      expect(mockUiUtils.applyTheme).toHaveBeenCalledWith('dark');
      expect(mockUiUtils.applyUiPreferences).toHaveBeenCalledWith(
        expect.objectContaining({ highContrast: true })
      );
    });
  });
});

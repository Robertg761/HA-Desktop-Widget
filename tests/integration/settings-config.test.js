/**
 * @jest-environment jsdom
 */

const { createMockElectronAPI, resetMockElectronAPI, getMockConfig } = require('../mocks/electron.js');
const { sampleStates, sampleConfig: _sampleConfig } = require('../fixtures/ha-data.js');

// Mock dependencies that settings.js requires
const mockWebsocket = {
  connect: jest.fn()
};

const BASE_THEMES = [
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
];
let mockCustomThemes = [];

function normalizeHex(hex) {
  if (!hex || typeof hex !== 'string') return null;
  const raw = hex.trim().replace('#', '');
  if (![3, 6].includes(raw.length) || !/^[0-9a-fA-F]+$/.test(raw)) return null;
  const value = raw.length === 3 ? raw.split('').map(ch => ch + ch).join('') : raw;
  return `#${value.toUpperCase()}`;
}

function hexToRgbString(hex) {
  const normalized = normalizeHex(hex);
  if (!normalized) return null;
  const value = normalized.slice(1);
  return `${Number.parseInt(value.slice(0, 2), 16)}, ${Number.parseInt(value.slice(2, 4), 16)}, ${Number.parseInt(value.slice(4, 6), 16)}`;
}

const mockUiUtils = {
  applyTheme: jest.fn(),
  applyAccentTheme: jest.fn(),
  applyAccentThemeFromColor: jest.fn(),
  applyBackgroundTheme: jest.fn(),
  applyBackgroundThemeFromColor: jest.fn(),
  applyUiPreferences: jest.fn(),
  applyWindowEffects: jest.fn(),
  setCustomThemes: jest.fn((customColors = []) => {
    mockCustomThemes = (Array.isArray(customColors) ? customColors : []).map(entry => ({
      ...entry,
      color: normalizeHex(entry.color),
      description: 'Saved custom color',
      rgb: hexToRgbString(entry.color),
      isCustom: true,
    })).filter(entry => entry.color && entry.rgb);
  }),
  getAccentThemes: jest.fn(() => ([...BASE_THEMES, ...mockCustomThemes])),
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
  mockCustomThemes = [];

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
  testConfig.ui = {
    theme: 'auto',
    highContrast: false,
    opaquePanels: false,
    density: 'comfortable',
    customColors: [],
    personalizationSectionsCollapsed: {}
  };
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

      <div id="personalization-tab" class="tab-content">
        <div id="color-themes-section" class="personalization-section collapsed">
          <button type="button" id="color-themes-toggle" class="section-toggle" aria-expanded="false">
            Color Themes
          </button>
          <div class="section-body">
            <select id="color-target-select">
              <option value="accent">Accent Color</option>
              <option value="background">Background Color</option>
            </select>
            <label id="theme-options-label">Color Options</label>
            <div id="theme-options"></div>
            <div id="theme-current-selection"></div>
            <input id="custom-color-picker" type="color" value="#64B5F6" />
            <input id="custom-color-r" type="number" min="0" max="255" step="1" />
            <input id="custom-color-g" type="number" min="0" max="255" step="1" />
            <input id="custom-color-b" type="number" min="0" max="255" step="1" />
            <input id="custom-color-hex" type="text" />
            <button type="button" id="save-custom-color-btn">Save Custom Color</button>
            <div id="custom-theme-management" class="hidden">
              <input id="custom-color-name-input" type="text" />
              <button type="button" id="rename-custom-color-btn">Rename</button>
              <button type="button" id="remove-custom-color-btn">Remove</button>
            </div>
          </div>
        </div>
        <div id="window-effects-section" class="personalization-section collapsed">
          <button type="button" id="window-effects-toggle" class="section-toggle" aria-expanded="false">
            Window Effects
          </button>
          <div class="section-body">
            <input type="checkbox" id="frosted-glass" />
          </div>
        </div>
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

    test('opening settings restores personalization section collapse states from config', async () => {
      state.CONFIG.ui.personalizationSectionsCollapsed = {
        'color-themes-section': true,
        'window-effects-section': false
      };

      await settings.openSettings();

      const colorThemesSection = document.getElementById('color-themes-section');
      const colorThemesToggle = document.getElementById('color-themes-toggle');
      const windowEffectsSection = document.getElementById('window-effects-section');
      const windowEffectsToggle = document.getElementById('window-effects-toggle');

      expect(colorThemesSection.classList.contains('collapsed')).toBe(true);
      expect(colorThemesToggle.getAttribute('aria-expanded')).toBe('false');
      expect(windowEffectsSection.classList.contains('collapsed')).toBe(false);
      expect(windowEffectsToggle.getAttribute('aria-expanded')).toBe('true');
    });

    test('toggling personalization sections persists collapse state', async () => {
      await settings.openSettings();

      const windowEffectsSection = document.getElementById('window-effects-section');
      const windowEffectsToggle = document.getElementById('window-effects-toggle');

      windowEffectsToggle.click();

      expect(windowEffectsSection.classList.contains('collapsed')).toBe(false);
      expect(state.CONFIG.ui.personalizationSectionsCollapsed['window-effects-section']).toBe(false);
      expect(window.electronAPI.updateConfig).toHaveBeenCalledWith(
        expect.objectContaining({
          ui: expect.objectContaining({
            personalizationSectionsCollapsed: expect.objectContaining({
              'window-effects-section': false
            })
          })
        })
      );
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

  describe('Custom Color Palette', () => {
    test('opens with saved custom colors appended after built-ins', async () => {
      state.CONFIG.ui.customColors = [
        {
          id: 'custom-ocean',
          name: 'Ocean',
          color: '#336699',
          createdAt: '2026-01-01T00:00:00.000Z',
          updatedAt: '2026-01-01T00:00:00.000Z'
        }
      ];

      await settings.openSettings();

      const options = Array.from(document.querySelectorAll('.color-theme-option'));
      expect(options).toHaveLength(4);
      expect(options[0].dataset.theme).toBe('original');
      expect(options[3].dataset.theme).toBe('custom-ocean');
    });

    test('custom editor previews accent and background live', async () => {
      await settings.openSettings();

      const hexInput = document.getElementById('custom-color-hex');
      const targetSelect = document.getElementById('color-target-select');

      hexInput.value = '#123456';
      hexInput.dispatchEvent(new Event('input', { bubbles: true }));
      expect(mockUiUtils.applyAccentThemeFromColor).toHaveBeenCalledWith('#123456');

      targetSelect.value = 'background';
      targetSelect.dispatchEvent(new Event('change', { bubbles: true }));

      hexInput.value = '#ABCDEF';
      hexInput.dispatchEvent(new Event('input', { bubbles: true }));
      expect(mockUiUtils.applyBackgroundThemeFromColor).toHaveBeenCalledWith('#ABCDEF');
    });

    test('saving a custom color persists it in config', async () => {
      await settings.openSettings();

      const hexInput = document.getElementById('custom-color-hex');
      const saveCustomBtn = document.getElementById('save-custom-color-btn');

      hexInput.value = '#112233';
      hexInput.dispatchEvent(new Event('input', { bubbles: true }));
      saveCustomBtn.click();

      await settings.saveSettings();

      expect(state.CONFIG.ui.customColors).toHaveLength(1);
      expect(state.CONFIG.ui.customColors[0]).toEqual(expect.objectContaining({
        color: '#112233',
        name: 'Custom #112233'
      }));
    });

    test('duplicate custom color save selects existing without creating extra entries', async () => {
      await settings.openSettings();

      const hexInput = document.getElementById('custom-color-hex');
      const saveCustomBtn = document.getElementById('save-custom-color-btn');

      hexInput.value = '#445566';
      hexInput.dispatchEvent(new Event('input', { bubbles: true }));
      saveCustomBtn.click();
      saveCustomBtn.click();

      const customOptions = document.querySelectorAll('.color-theme-option[data-custom-theme="true"]');
      expect(customOptions).toHaveLength(1);
      expect(mockUiUtils.showToast).toHaveBeenCalledWith(
        expect.stringContaining('already saved'),
        'info',
        expect.any(Number)
      );
    });

    test('rename and remove custom colors update pending state and fallback selection', async () => {
      await settings.openSettings();

      const hexInput = document.getElementById('custom-color-hex');
      const saveCustomBtn = document.getElementById('save-custom-color-btn');
      const renameInput = document.getElementById('custom-color-name-input');
      const renameBtn = document.getElementById('rename-custom-color-btn');

      hexInput.value = '#778899';
      hexInput.dispatchEvent(new Event('input', { bubbles: true }));
      saveCustomBtn.click();

      renameInput.value = 'My Slate';
      renameBtn.click();

      await settings.saveSettings();
      expect(state.CONFIG.ui.customColors[0].name).toBe('My Slate');

      await settings.openSettings();
      const removeButton = document.getElementById('remove-custom-color-btn');
      removeButton.click();

      const customOptions = document.querySelectorAll('.color-theme-option[data-custom-theme="true"]');
      expect(customOptions).toHaveLength(0);

      const selected = document.querySelector('.color-theme-option.selected');
      expect(selected?.dataset.theme).toBe('original');
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

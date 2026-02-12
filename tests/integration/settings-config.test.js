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
  updateMediaTile: jest.fn(),
  renderPrimaryCards: jest.fn(),
  renderActiveTab: jest.fn()
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
  testConfig.customEntityIcons = {};
  testConfig.ui = {
    theme: 'auto',
    highContrast: false,
    opaquePanels: false,
    density: 'comfortable',
    customColors: [],
    personalizationSectionsCollapsed: {},
    enableInteractionDebugLogs: false
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
      <label for="enable-interaction-debug-logs">
        <input type="checkbox" id="enable-interaction-debug-logs" />
        Enable interaction diagnostics logs
      </label>

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
            <div id="custom-editor-save-lock-hint" class="hidden"></div>
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
        <div id="primary-cards-section" class="personalization-section collapsed">
          <button type="button" id="primary-cards-toggle" class="section-toggle" aria-expanded="false">
            Primary Cards
          </button>
          <div class="section-body">
            <div id="primary-card-1-current"></div>
            <div id="primary-card-2-current"></div>
            <button type="button" id="primary-cards-reset">Reset</button>
            <input type="text" id="primary-cards-search" />
            <div id="primary-cards-list"></div>
          </div>
        </div>
        <div id="custom-entity-icons-section" class="personalization-section collapsed">
          <button type="button" id="custom-entity-icons-toggle" class="section-toggle" aria-expanded="false">
            Custom Entity Icons
          </button>
          <div class="section-body">
            <input type="text" id="custom-entity-icons-search" />
            <button type="button" id="custom-entity-icons-reset-all">Reset all custom icons</button>
            <div id="custom-entity-icons-list"></div>
            <div id="custom-entity-icons-summary"></div>
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

      <button id="save-settings">Save</button>
      <button id="cancel-settings">Cancel</button>
    </div>
  `;

  document.body.appendChild(modal);
}

describe('Settings + Config Integration', () => {
  const settings = require('../../src/settings.js');
  const state = require('../../src/state.js').default;
  const openSettingsWithCustomIconsExpanded = async (uiHooks = undefined) => {
    const config = state.CONFIG;
    config.ui = config.ui || {};
    config.ui.personalizationSectionsCollapsed = {
      ...(config.ui.personalizationSectionsCollapsed || {}),
      'custom-entity-icons-section': false
    };
    state.setConfig(config);

    await settings.openSettings(uiHooks);
    const customIconsToggle = document.getElementById('custom-entity-icons-toggle');
    if (customIconsToggle && customIconsToggle.getAttribute('aria-expanded') !== 'true') {
      customIconsToggle.click();
    }
  };

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

    test('opening settings restores collapsed states and ignores expanded persisted values', async () => {
      state.CONFIG.ui.personalizationSectionsCollapsed = {
        'color-themes-section': true,
        'window-effects-section': false,
        'custom-entity-icons-section': true
      };

      await settings.openSettings();

      const colorThemesSection = document.getElementById('color-themes-section');
      const colorThemesToggle = document.getElementById('color-themes-toggle');
      const windowEffectsSection = document.getElementById('window-effects-section');
      const windowEffectsToggle = document.getElementById('window-effects-toggle');
      const customIconsSection = document.getElementById('custom-entity-icons-section');
      const customIconsToggle = document.getElementById('custom-entity-icons-toggle');

      expect(colorThemesSection.classList.contains('collapsed')).toBe(true);
      expect(colorThemesToggle.getAttribute('aria-expanded')).toBe('false');
      expect(windowEffectsSection.classList.contains('collapsed')).toBe(true);
      expect(windowEffectsToggle.getAttribute('aria-expanded')).toBe('false');
      expect(customIconsSection.classList.contains('collapsed')).toBe(true);
      expect(customIconsToggle.getAttribute('aria-expanded')).toBe('false');
    });

    test('toggling personalization sections persists collapse state', async () => {
      jest.useFakeTimers();
      try {
        await settings.openSettings();

        const windowEffectsSection = document.getElementById('window-effects-section');
        const windowEffectsToggle = document.getElementById('window-effects-toggle');

        // Expanding from default state should not persist (expanded is not stored).
        windowEffectsToggle.click();

        expect(windowEffectsSection.classList.contains('collapsed')).toBe(false);
        expect(state.CONFIG.ui.personalizationSectionsCollapsed).not.toHaveProperty('window-effects-section');
        expect(window.electronAPI.updateConfig).not.toHaveBeenCalled();

        // Collapse should persist as an explicit saved state.
        windowEffectsToggle.click();
        expect(windowEffectsSection.classList.contains('collapsed')).toBe(true);
        expect(state.CONFIG.ui.personalizationSectionsCollapsed['window-effects-section']).toBe(true);

        jest.advanceTimersByTime(260);
        await Promise.resolve();

        expect(window.electronAPI.updateConfig).toHaveBeenCalledWith(
          expect.objectContaining({
            ui: expect.objectContaining({
              personalizationSectionsCollapsed: expect.objectContaining({
                'window-effects-section': true
              })
            })
          })
        );
      } finally {
        jest.useRealTimers();
      }
    });

    test('debounced persistence writes latest section snapshot across different sections', async () => {
      jest.useFakeTimers();
      try {
        await settings.openSettings();
        window.electronAPI.updateConfig.mockClear();

        const windowEffectsToggle = document.getElementById('window-effects-toggle');
        const colorThemesToggle = document.getElementById('color-themes-toggle');

        // Collapse window effects at t=0 (first timer scheduled for t=250ms).
        windowEffectsToggle.click();
        windowEffectsToggle.click();

        // Collapse color themes before the first timer fires.
        jest.advanceTimersByTime(150);
        colorThemesToggle.click();
        colorThemesToggle.click();

        // First timer should persist the latest combined snapshot.
        jest.advanceTimersByTime(110);
        await Promise.resolve();

        expect(window.electronAPI.updateConfig).toHaveBeenCalledTimes(1);
        expect(window.electronAPI.updateConfig).toHaveBeenCalledWith(
          expect.objectContaining({
            ui: expect.objectContaining({
              personalizationSectionsCollapsed: expect.objectContaining({
                'window-effects-section': true,
                'color-themes-section': true
              })
            })
          })
        );
      } finally {
        jest.useRealTimers();
      }
    });

    test('lazy-hydrates heavy personalization lists when sections are expanded', async () => {
      await settings.openSettings();

      // Collapsed sections should not eagerly render heavy lists.
      expect(document.querySelector('[data-primary-assign]')).toBeNull();
      expect(document.querySelector('[data-custom-icon-input]')).toBeNull();

      const primaryCardsToggle = document.getElementById('primary-cards-toggle');
      const customIconsToggle = document.getElementById('custom-entity-icons-toggle');
      primaryCardsToggle.click();
      customIconsToggle.click();

      expect(document.querySelector('[data-primary-assign]')).toBeTruthy();
      expect(document.querySelector('[data-custom-icon-input]')).toBeTruthy();
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

    test('loads and saves interaction diagnostics flag from advanced settings', async () => {
      state.CONFIG.ui.enableInteractionDebugLogs = true;
      await settings.openSettings();

      const debugToggle = document.getElementById('enable-interaction-debug-logs');
      expect(debugToggle).toBeTruthy();
      expect(debugToggle.checked).toBe(true);

      debugToggle.checked = false;
      await settings.saveSettings();

      expect(state.CONFIG.ui.enableInteractionDebugLogs).toBe(false);
      expect(window.electronAPI.updateConfig).toHaveBeenCalledWith(
        expect.objectContaining({
          ui: expect.objectContaining({
            enableInteractionDebugLogs: false
          })
        })
      );
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
      await openSettingsWithCustomIconsExpanded();

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
      await openSettingsWithCustomIconsExpanded();

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

  describe('Custom Entity Icons', () => {
    test('should apply icon changes as draft state until main Save', async () => {
      // Arrange
      await openSettingsWithCustomIconsExpanded();
      const iconInput = document.querySelector('[data-custom-icon-input="light.living_room"]');
      const applyBtn = document.querySelector('[data-custom-icon-apply="light.living_room"]');
      expect(iconInput).toBeTruthy();
      expect(applyBtn).toBeTruthy();

      // Act
      iconInput.value = '🔥';
      applyBtn.click();

      // Assert
      const refreshedApplyBtn = document.querySelector('[data-custom-icon-apply="light.living_room"]');
      const row = refreshedApplyBtn.closest('.custom-entity-icon-item');
      const preview = row.querySelector('.custom-entity-icon-preview');
      const actionBadge = row.querySelector('.custom-entity-icon-action-badge');
      expect(preview.textContent).toBe('🔥');
      expect(actionBadge.textContent).toContain('Applied (unsaved)');
      expect(mockUiUtils.showToast).toHaveBeenCalledWith(
        expect.stringContaining('Icon applied'),
        'success',
        expect.any(Number)
      );
      expect(state.CONFIG.customEntityIcons).toEqual({});
      expect(window.electronAPI.updateConfig).not.toHaveBeenCalled();
    });

    test('should show the full emoji catalog in the picker', async () => {
      // Arrange
      await openSettingsWithCustomIconsExpanded();
      const chooseBtn = document.querySelector('[data-custom-icon-picker-toggle="light.living_room"]');
      expect(chooseBtn).toBeTruthy();

      // Act
      chooseBtn.click();

      // Assert
      const allChoices = document.querySelectorAll('[data-custom-icon-choice-entity="light.living_room"]');
      expect(allChoices.length).toBeGreaterThan(1000);
    });

    test('should open picker with all icons when icon input is focused', async () => {
      // Arrange
      await openSettingsWithCustomIconsExpanded();
      const iconInput = document.querySelector('[data-custom-icon-input="light.living_room"]');
      expect(iconInput).toBeTruthy();

      // Act
      iconInput.dispatchEvent(new Event('focusin', { bubbles: true }));

      // Assert
      const picker = document.querySelector('[data-custom-icon-picker="light.living_room"]');
      const pickerMeta = picker.querySelector('.custom-entity-icon-picker-meta');
      const list = document.getElementById('custom-entity-icons-list');
      expect(picker).toBeTruthy();
      expect(pickerMeta.textContent).toContain('Showing all');
      expect(list.classList.contains('custom-entity-icons-list-expanded')).toBe(true);
    });

    test('should close picker when focus leaves the icon input row', async () => {
      // Arrange
      await openSettingsWithCustomIconsExpanded();
      const iconInput = document.querySelector('[data-custom-icon-input="light.living_room"]');
      const saveBtn = document.getElementById('save-settings');
      expect(iconInput).toBeTruthy();
      expect(saveBtn).toBeTruthy();
      iconInput.dispatchEvent(new Event('focusin', { bubbles: true }));
      expect(document.querySelector('[data-custom-icon-picker="light.living_room"]')).toBeTruthy();

      jest.useFakeTimers();
      try {
        // Act
        iconInput.dispatchEvent(new Event('focusout', { bubbles: true }));
        saveBtn.focus();
        jest.runOnlyPendingTimers();

        // Assert
        expect(document.querySelector('[data-custom-icon-picker="light.living_room"]')).toBeFalsy();
      } finally {
        jest.useRealTimers();
      }
    });

    test('should use row input as icon search for picker selection', async () => {
      // Arrange
      await openSettingsWithCustomIconsExpanded();
      const iconInput = document.querySelector('[data-custom-icon-input="light.living_room"]');
      expect(iconInput).toBeTruthy();

      // Act
      iconInput.value = 'timer';
      iconInput.dispatchEvent(new Event('input', { bubbles: true }));
      const picker = document.querySelector('[data-custom-icon-picker="light.living_room"]');
      expect(picker).toBeTruthy();
      const iconChoiceBtn = document.querySelector('[data-custom-icon-choice="⏲️"][data-custom-icon-choice-entity="light.living_room"]');
      expect(iconChoiceBtn).toBeTruthy();
      iconChoiceBtn.click();

      // Assert
      const refreshedApplyBtn = document.querySelector('[data-custom-icon-apply="light.living_room"]');
      const row = refreshedApplyBtn.closest('.custom-entity-icon-item');
      const preview = row.querySelector('.custom-entity-icon-preview');
      expect(preview.textContent).toBe('⏲️');
      expect(state.CONFIG.customEntityIcons).toEqual({});
    });

    test('should match natural language keywords like tree', async () => {
      // Arrange
      await openSettingsWithCustomIconsExpanded();
      const iconInput = document.querySelector('[data-custom-icon-input="light.living_room"]');
      expect(iconInput).toBeTruthy();

      // Act
      iconInput.value = 'tree';
      iconInput.dispatchEvent(new Event('input', { bubbles: true }));

      // Assert
      const treeChoice = document.querySelector('[data-custom-icon-choice="🌲"][data-custom-icon-choice-entity="light.living_room"]');
      expect(treeChoice).toBeTruthy();
    });

    test('should match animal keywords like rat and mouse', async () => {
      // Arrange
      await openSettingsWithCustomIconsExpanded();
      const iconInput = document.querySelector('[data-custom-icon-input="light.living_room"]');
      expect(iconInput).toBeTruthy();

      // Act
      iconInput.value = 'rat';
      iconInput.dispatchEvent(new Event('input', { bubbles: true }));

      // Assert
      const ratChoice = document.querySelector('[data-custom-icon-choice="🐀"][data-custom-icon-choice-entity="light.living_room"]');
      expect(ratChoice).toBeTruthy();
      const ratSummary = document.querySelector('[data-custom-icon-picker="light.living_room"] .custom-entity-icon-picker-meta');
      expect(ratSummary).toBeTruthy();
      expect(ratSummary.textContent).toMatch(/Showing \d+ of \d+ icons for "rat"\./);
      const [, ratShown, ratTotal] = ratSummary.textContent.match(/Showing (\d+) of (\d+) icons for "rat"\./) || [];
      expect(Number(ratShown)).toBeLessThan(Number(ratTotal));

      // Act
      iconInput.value = 'mouse';
      iconInput.dispatchEvent(new Event('input', { bubbles: true }));

      // Assert
      const mouseChoice = document.querySelector('[data-custom-icon-choice="🐭"][data-custom-icon-choice-entity="light.living_room"]');
      expect(mouseChoice).toBeTruthy();
    });

    test('should match related category terms like mice to mouse icons', async () => {
      // Arrange
      await openSettingsWithCustomIconsExpanded();
      const iconInput = document.querySelector('[data-custom-icon-input="light.living_room"]');
      expect(iconInput).toBeTruthy();

      // Act
      iconInput.value = 'mice';
      iconInput.dispatchEvent(new Event('input', { bubbles: true }));

      // Assert
      const mouseChoice = document.querySelector('[data-custom-icon-choice="🐭"][data-custom-icon-choice-entity="light.living_room"]');
      expect(mouseChoice).toBeTruthy();
    });

    test('should allow choosing icons from picker instead of manual typing', async () => {
      // Arrange
      await openSettingsWithCustomIconsExpanded();
      const chooseBtn = document.querySelector('[data-custom-icon-picker-toggle="light.living_room"]');
      expect(chooseBtn).toBeTruthy();

      // Act
      chooseBtn.click();
      const iconChoiceBtn = document.querySelector('[data-custom-icon-choice="⭐"][data-custom-icon-choice-entity="light.living_room"]');
      expect(iconChoiceBtn).toBeTruthy();
      iconChoiceBtn.click();

      // Assert
      const refreshedApplyBtn = document.querySelector('[data-custom-icon-apply="light.living_room"]');
      const row = refreshedApplyBtn.closest('.custom-entity-icon-item');
      const preview = row.querySelector('.custom-entity-icon-preview');
      expect(preview.textContent).toBe('⭐');
      expect(state.CONFIG.customEntityIcons).toEqual({});
    });

    test('should reject invalid icon values that are not a single grapheme', async () => {
      // Arrange
      await openSettingsWithCustomIconsExpanded();
      const iconInput = document.querySelector('[data-custom-icon-input="light.living_room"]');
      const applyBtn = document.querySelector('[data-custom-icon-apply="light.living_room"]');
      expect(iconInput).toBeTruthy();
      expect(applyBtn).toBeTruthy();

      // Act
      iconInput.value = 'AB';
      applyBtn.click();

      // Assert
      expect(mockUiUtils.showToast).toHaveBeenCalledWith(
        expect.stringContaining('single emoji or glyph'),
        'error',
        expect.any(Number)
      );
      const refreshedApplyBtn = document.querySelector('[data-custom-icon-apply="light.living_room"]');
      const row = refreshedApplyBtn.closest('.custom-entity-icon-item');
      const preview = row.querySelector('.custom-entity-icon-preview');
      expect(preview.textContent).toBe('💡');
    });

    test('should persist custom entity icons on main Save and re-render active tab', async () => {
      // Arrange
      await openSettingsWithCustomIconsExpanded({
        initUpdateUI: jest.fn(),
        renderActiveTab: mockUI.renderActiveTab,
        updateMediaTile: mockUI.updateMediaTile,
        renderPrimaryCards: mockUI.renderPrimaryCards,
      });
      const iconInput = document.querySelector('[data-custom-icon-input="light.living_room"]');
      const applyBtn = document.querySelector('[data-custom-icon-apply="light.living_room"]');
      expect(iconInput).toBeTruthy();
      expect(applyBtn).toBeTruthy();
      iconInput.value = '🔥';
      applyBtn.click();

      // Act
      await settings.saveSettings();

      // Assert
      expect(state.CONFIG.customEntityIcons).toEqual(
        expect.objectContaining({
          'light.living_room': '🔥'
        })
      );
      expect(window.electronAPI.updateConfig).toHaveBeenCalledWith(
        expect.objectContaining({
          customEntityIcons: expect.objectContaining({
            'light.living_room': '🔥'
          })
        })
      );
      expect(mockUI.renderActiveTab).toHaveBeenCalled();
    });

    test('should support per-entity reset and reset-all actions', async () => {
      // Arrange
      state.CONFIG.customEntityIcons = {
        'light.living_room': '🔥',
        'switch.bedroom': '⚡'
      };
      await openSettingsWithCustomIconsExpanded();
      const resetSingleBtn = document.querySelector('[data-custom-icon-reset="light.living_room"]');
      const resetAllBtn = document.getElementById('custom-entity-icons-reset-all');
      expect(resetSingleBtn).toBeTruthy();
      expect(resetAllBtn).toBeTruthy();

      // Act
      resetSingleBtn.click();

      // Assert
      const roomInputAfterReset = document.querySelector('[data-custom-icon-input="light.living_room"]');
      const summaryAfterSingleReset = document.getElementById('custom-entity-icons-summary');
      expect(roomInputAfterReset.value).toBe('');
      expect(summaryAfterSingleReset.textContent).toContain('1 custom icon');

      // Act
      resetAllBtn.click();

      // Assert
      const summaryAfterResetAll = document.getElementById('custom-entity-icons-summary');
      expect(summaryAfterResetAll.textContent).toContain('No custom icons configured');
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
    test('should open with saved custom colors appended after built-ins', async () => {
      // Arrange
      state.CONFIG.ui.customColors = [
        {
          id: 'custom-ocean',
          name: 'Ocean',
          color: '#336699',
          createdAt: '2026-01-01T00:00:00.000Z',
          updatedAt: '2026-01-01T00:00:00.000Z'
        }
      ];

      // Act
      await settings.openSettings();

      // Assert
      const options = Array.from(document.querySelectorAll('.color-theme-option'));
      expect(options).toHaveLength(4);
      expect(options[0].dataset.theme).toBe('original');
      expect(options[3].dataset.theme).toBe('custom-ocean');
    });

    test('should preview accent and background live from custom editor', async () => {
      // Arrange
      await settings.openSettings();
      const hexInput = document.getElementById('custom-color-hex');
      const targetSelect = document.getElementById('color-target-select');

      // Act
      hexInput.value = '#123456';
      hexInput.dispatchEvent(new Event('input', { bubbles: true }));

      targetSelect.value = 'background';
      targetSelect.dispatchEvent(new Event('change', { bubbles: true }));

      hexInput.value = '#ABCDEF';
      hexInput.dispatchEvent(new Event('input', { bubbles: true }));

      // Assert
      expect(mockUiUtils.applyAccentThemeFromColor).toHaveBeenCalledWith('#123456');
      expect(mockUiUtils.applyBackgroundThemeFromColor).toHaveBeenCalledWith('#ABCDEF');
    });

    test('should disable main settings save while custom editor is active', async () => {
      // Arrange
      await settings.openSettings();
      const mainSave = document.getElementById('save-settings');
      const lockHint = document.getElementById('custom-editor-save-lock-hint');
      const hexInput = document.getElementById('custom-color-hex');

      // Act
      hexInput.focus();

      // Assert
      expect(mainSave.disabled).toBe(true);
      expect(lockHint.classList.contains('hidden')).toBe(false);
    });

    test('should unlock main settings save when focus moves outside custom editor', async () => {
      // Arrange
      await settings.openSettings();
      const mainSave = document.getElementById('save-settings');
      const lockHint = document.getElementById('custom-editor-save-lock-hint');
      const hexInput = document.getElementById('custom-color-hex');
      const haUrl = document.getElementById('ha-url');
      hexInput.focus();
      expect(mainSave.disabled).toBe(true);

      // Act
      haUrl.focus();
      await new Promise(resolve => setTimeout(resolve, 0));

      // Assert
      expect(mainSave.disabled).toBe(false);
      expect(lockHint.classList.contains('hidden')).toBe(true);
    });

    test('should unlock main settings save when Save Custom Color is clicked', async () => {
      // Arrange
      await settings.openSettings();
      const mainSave = document.getElementById('save-settings');
      const hexInput = document.getElementById('custom-color-hex');
      const saveCustomBtn = document.getElementById('save-custom-color-btn');
      hexInput.focus();
      expect(mainSave.disabled).toBe(true);

      // Act
      hexInput.value = '#88AA11';
      hexInput.dispatchEvent(new Event('input', { bubbles: true }));
      saveCustomBtn.click();

      // Assert
      expect(mainSave.disabled).toBe(false);
    });

    test('should unlock main settings save when rename and remove actions run', async () => {
      // Arrange
      await settings.openSettings();
      const mainSave = document.getElementById('save-settings');
      const hexInput = document.getElementById('custom-color-hex');
      const saveCustomBtn = document.getElementById('save-custom-color-btn');
      const renameInput = document.getElementById('custom-color-name-input');
      const renameBtn = document.getElementById('rename-custom-color-btn');
      const removeBtn = document.getElementById('remove-custom-color-btn');

      hexInput.value = '#9A7722';
      hexInput.dispatchEvent(new Event('input', { bubbles: true }));
      saveCustomBtn.click();

      // Act
      renameInput.focus();
      renameInput.value = 'Renamed Custom';
      renameBtn.click();

      removeBtn.focus();
      removeBtn.click();

      // Assert
      expect(mainSave.disabled).toBe(false);
    });

    test('should reset main save lock state when settings closes', async () => {
      // Arrange
      await settings.openSettings();
      const mainSave = document.getElementById('save-settings');
      const hexInput = document.getElementById('custom-color-hex');
      const lockHint = document.getElementById('custom-editor-save-lock-hint');
      hexInput.focus();
      expect(mainSave.disabled).toBe(true);

      // Act
      settings.closeSettings();
      await settings.openSettings();

      // Assert
      expect(mainSave.disabled).toBe(false);
      expect(lockHint.classList.contains('hidden')).toBe(true);
    });

    test('should persist a saved custom color in config', async () => {
      // Arrange
      await settings.openSettings();
      const hexInput = document.getElementById('custom-color-hex');
      const saveCustomBtn = document.getElementById('save-custom-color-btn');

      // Act
      hexInput.value = '#112233';
      hexInput.dispatchEvent(new Event('input', { bubbles: true }));
      saveCustomBtn.click();
      await settings.saveSettings();

      // Assert
      expect(state.CONFIG.ui.customColors).toHaveLength(1);
      expect(state.CONFIG.ui.customColors[0]).toEqual(expect.objectContaining({
        color: '#112233',
        name: 'Custom #112233'
      }));
    });

    test('should prompt for unsaved custom color draft and save when confirmed', async () => {
      // Arrange
      mockUiUtils.showConfirm.mockResolvedValueOnce(true);
      await settings.openSettings();
      const hexInput = document.getElementById('custom-color-hex');

      // Act
      hexInput.value = '#13579B';
      hexInput.dispatchEvent(new Event('input', { bubbles: true }));
      await settings.saveSettings();

      // Assert
      expect(mockUiUtils.showConfirm).toHaveBeenCalledWith(
        expect.stringContaining('Unsaved Custom Color Changes'),
        expect.stringContaining('unsaved custom color edits'),
        expect.objectContaining({
          confirmText: 'Save and Continue',
          cancelText: 'Continue Without Saving'
        })
      );
      expect(state.CONFIG.ui.customColors).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ color: '#13579B' })
        ])
      );
    });

    test('should prompt for unsaved custom color draft and continue without saving when declined', async () => {
      // Arrange
      mockUiUtils.showConfirm.mockResolvedValueOnce(false);
      await settings.openSettings();
      const hexInput = document.getElementById('custom-color-hex');

      // Act
      hexInput.value = '#2468AC';
      hexInput.dispatchEvent(new Event('input', { bubbles: true }));
      await settings.saveSettings();

      // Assert
      expect(mockUiUtils.showConfirm).toHaveBeenCalled();
      expect(state.CONFIG.ui.customColors).toHaveLength(0);
    });

    test('should select existing custom color without duplicates when saving same color twice', async () => {
      // Arrange
      await settings.openSettings();
      const hexInput = document.getElementById('custom-color-hex');
      const saveCustomBtn = document.getElementById('save-custom-color-btn');

      // Act
      hexInput.value = '#445566';
      hexInput.dispatchEvent(new Event('input', { bubbles: true }));
      saveCustomBtn.click();
      saveCustomBtn.click();

      // Assert
      const customOptions = document.querySelectorAll('.color-theme-option[data-custom-theme="true"]');
      expect(customOptions).toHaveLength(1);
      expect(mockUiUtils.showToast).toHaveBeenCalledWith(
        expect.stringContaining('already saved'),
        'info',
        expect.any(Number)
      );
    });

    test('should rename and remove custom colors while applying fallback selection', async () => {
      // Arrange
      await settings.openSettings();
      const hexInput = document.getElementById('custom-color-hex');
      const saveCustomBtn = document.getElementById('save-custom-color-btn');
      const renameInput = document.getElementById('custom-color-name-input');
      const renameBtn = document.getElementById('rename-custom-color-btn');

      hexInput.value = '#778899';
      hexInput.dispatchEvent(new Event('input', { bubbles: true }));
      saveCustomBtn.click();

      // Act
      renameInput.value = 'My Slate';
      renameBtn.click();
      await settings.saveSettings();

      // Assert
      expect(state.CONFIG.ui.customColors[0].name).toBe('My Slate');

      // Act
      await settings.openSettings();
      const removeButton = document.getElementById('remove-custom-color-btn');
      removeButton.click();

      // Assert
      const customOptions = document.querySelectorAll('.color-theme-option[data-custom-theme="true"]');
      expect(customOptions).toHaveLength(0);

      const selected = document.querySelector('.color-theme-option.selected');
      expect(selected?.dataset.theme).toBe('original');
    });
  });

  describe('Settings Coordination', () => {
    test('media player selection updates immediately', async () => {
      await settings.openSettings({
        initUpdateUI: jest.fn(),
        renderActiveTab: mockUI.renderActiveTab,
        updateMediaTile: mockUI.updateMediaTile,
        renderPrimaryCards: mockUI.renderPrimaryCards,
      });

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

      // Verify active tab re-render was triggered
      expect(mockUI.renderActiveTab).toHaveBeenCalled();
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

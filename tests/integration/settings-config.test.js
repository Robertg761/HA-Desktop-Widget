/**
 * @jest-environment jsdom
 */

const {
  createMockElectronAPI,
  resetMockElectronAPI,
  getMockConfig,
} = require('../mocks/electron.js');
const { sampleStates, sampleConfig } = require('../fixtures/ha-data.js');
const windowGlass = require('../../src/window-glass.cjs');

// Mock dependencies that settings.js requires
const mockWebsocket = {
  connect: jest.fn(),
};

const BASE_THEMES = [
  {
    id: 'original',
    name: 'Original',
    color: '#64b5f6',
    description: 'Mock theme',
    rgb: '100, 181, 246',
  },
  {
    id: 'slate',
    name: 'Slate',
    color: '#94a3b8',
    description: 'Mock theme',
    rgb: '148, 163, 184',
  },
  {
    id: 'rose',
    name: 'Rose',
    color: '#f43f5e',
    description: 'Mock theme',
    rgb: '244, 63, 94',
  },
];
let mockCustomThemes = [];

function normalizeHex(hex) {
  if (!hex || typeof hex !== 'string') return null;
  const raw = hex.trim().replace('#', '');
  if (![3, 6].includes(raw.length) || !/^[0-9a-fA-F]+$/.test(raw)) return null;
  const value =
    raw.length === 3
      ? raw
          .split('')
          .map((ch) => ch + ch)
          .join('')
      : raw;
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
  suspendSeasonalColors: jest.fn(),
  applyWindowEffects: jest.fn(),
  // Answers from the real helper, as the renderer's does, so the config settings.js hands over
  // decides the result. The test platform is not Windows, so it is pinned to the case under test.
  isFrostedGlassAvailable: jest.fn((config) =>
    windowGlass.isGlassAvailable({
      platform: 'win32',
      nativeGlassSupported: config?.desktopCapabilities?.nativeGlassSupported,
    })
  ),
  setCustomThemes: jest.fn((customColors = []) => {
    mockCustomThemes = (Array.isArray(customColors) ? customColors : [])
      .map((entry) => ({
        ...entry,
        color: normalizeHex(entry.color),
        description: 'Saved custom color',
        rgb: hexToRgbString(entry.color),
        isCustom: true,
      }))
      .filter((entry) => entry.color && entry.rgb);
  }),
  getAccentThemes: jest.fn(() => [...BASE_THEMES, ...mockCustomThemes]),
  // The window a Background choice gives: the untinted base for null, a tinted one otherwise.
  getBackgroundWindowColor: jest.fn((color = null) => (color === null ? '#12161e' : '#222c3c')),
  // The real dialog layer: class-based visibility plus the inline display, the focus trap and
  // Escape, so these tests see what a person opening and closing Settings gets.
  ...require('../helpers/ui-utils-dialogs').realDialogHelpers(),
  showToast: jest.fn(),
  showConfirm: jest.fn().mockResolvedValue(true),
  copyTextToClipboard: jest.fn().mockResolvedValue(true),
};

const mockHotkeys = {
  cleanupHotkeyEventListeners: jest.fn(),
};

const mockUI = {
  restoreDashboard: jest.fn(),
  updateMediaTile: jest.fn(),
  renderPrimaryCards: jest.fn(),
  renderActiveTab: jest.fn(),
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
  mockElectronAPI.platform = 'test';
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
    token: 'test-token-123',
  };
  testConfig.opacity = 0.95;
  testConfig.alwaysOnTop = true;
  testConfig.globalHotkeys = { enabled: true, hotkeys: {} };
  testConfig.entityAlerts = { enabled: false, alerts: {} };
  testConfig.primaryMediaPlayer = null;
  testConfig.customEntityIcons = {};
  testConfig.updates = { allowPrerelease: false };
  testConfig.ui = {
    theme: 'auto',
    highContrast: false,
    opaquePanels: false,
    density: 'comfortable',
    customColors: [],
    personalizationSectionsCollapsed: {},
    enableInteractionDebugLogs: false,
  };
  state.setConfig(testConfig);

  // Mock states with media players
  const mockStates = {
    ...sampleStates,
    'media_player.spotify': {
      entity_id: 'media_player.spotify',
      state: 'playing',
      attributes: { friendly_name: 'Spotify' },
    },
    'media_player.bedroom_speaker': {
      entity_id: 'media_player.bedroom_speaker',
      state: 'idle',
      attributes: { friendly_name: 'Bedroom Speaker' },
    },
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

      <div id="ha-oauth-status" class="hidden"></div>
      <p id="secure-storage-notice" class="hidden">No keyring</p>
      <button type="button" id="connect-ha-oauth-btn">Connect with Home Assistant</button>
      <button type="button" id="disconnect-ha-oauth-btn" class="hidden">Disconnect</button>
      <button type="button" id="cancel-ha-oauth-btn" class="hidden">Cancel</button>
      <details id="legacy-ha-token-settings">
      <label for="ha-token">Access Token</label>
      <input type="password" id="ha-token" />
      <button type="button" id="test-ha-connection-btn">Test legacy token</button>
      <div id="test-ha-connection-status" class="hidden"></div>
      </details>

      <label for="weather-entity-select">Weather source</label>
      <select id="weather-entity-select"></select>
      <div id="weather-entity-help"></div>

      <label for="always-on-top">
        <input type="checkbox" id="always-on-top" />
        <input type="checkbox" id="hide-on-blur" />
        Always on Top
      </label>

      <label for="start-with-windows">
        <input type="checkbox" id="start-with-windows" />
        Start at login
      </label>

      <label for="allow-prerelease-updates">
        <input type="checkbox" id="allow-prerelease-updates" />
        Receive beta updates
      </label>

      <label for="language-select">Language Mode</label>
      <select id="language-select">
        <option value="auto">Auto (System Default)</option>
        <option value="en">English</option>
      </select>
      <div id="language-select-help">Download a language pack below to enable it in the selector.</div>
      <div id="language-current-summary"></div>
      <div id="language-system-summary"></div>
      <div id="language-fallback-summary" class="hidden"></div>
      <div id="language-pack-status" class="hidden"></div>
      <div id="language-packs-list"></div>

      <label for="opacity-slider">Opacity</label>
      <input type="range" id="opacity-slider" min="1" max="100" />
      <span id="opacity-value">90</span>

      <section id="colors-section" data-readable-overrides></section>
      <select id="ui-scale-select"><option value="1">100%</option><option value="1.5">150%</option></select>
      <input type="checkbox" id="readable-preset" />
      <label for="density-select">Layout density</label>
      <select id="density-select">
        <option value="comfortable">Comfortable</option>
        <option value="compact">Compact</option>
      </select>

      <label for="active-tile-glow">
        <input type="checkbox" id="active-tile-glow" />
        Glow tiles that are on
      </label>

      <section id="seasonal-settings">
        <input type="checkbox" id="seasonal-enabled" />
        <p id="seasonal-status"></p>
        <div class="seasonal-option"><input type="checkbox" id="seasonal-colors" /></div>
        <div class="seasonal-option">
          <select id="seasonal-show">
            <option value="auto">By date</option>
            <option value="halloween">Halloween</option>
            <option value="christmas">Christmas</option>
          </select>
        </div>
        <fieldset class="seasonal-option">
          <input type="checkbox" data-holiday="halloween" />
          <span data-holiday-dates="halloween"></span>
          <input type="checkbox" data-holiday="christmas" />
          <span data-holiday-dates="christmas"></span>
        </fieldset>
      </section>

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
      <label for="profile-sync-enabled">
        <input type="checkbox" id="profile-sync-enabled" />
        Enable Profile Sync
      </label>
      <div id="profile-sync-settings" class="hidden">
        <select id="profile-sync-provider">
          <option value="cloudFile">Cloud Folder File</option>
          <option value="googleDrive">Google Drive</option>
          <option value="icloudDrive">iCloud Drive</option>
          <option value="syncthing">Syncthing</option>
        </select>
        <input type="text" id="profile-sync-folder-path" />
        <button type="button" id="profile-sync-choose-folder">Choose Folder</button>
        <select id="profile-sync-scope-preset">
          <option value="all">All Syncable Settings</option>
          <option value="visual">Visual</option>
          <option value="quick_access">Quick Access</option>
          <option value="custom">Custom</option>
        </select>
        <div id="profile-sync-scope-advanced" class="hidden">
          <label><input type="checkbox" id="profile-sync-scope-quick-access-layout" /></label>
          <label><input type="checkbox" id="profile-sync-scope-visual-personalization" /></label>
          <label><input type="checkbox" id="profile-sync-scope-automation-alerts" /></label>
          <label><input type="checkbox" id="profile-sync-scope-connection-media-preferences" /></label>
        </div>
        <button type="button" id="profile-sync-help-btn">Need Help?</button>
        <select id="profile-sync-interval">
          <option value="1">1</option>
          <option value="5" selected>5</option>
          <option value="15">15</option>
          <option value="30">30</option>
          <option value="60">60</option>
        </select>
        <label for="profile-sync-encryption-enabled">
          <input type="checkbox" id="profile-sync-encryption-enabled" />
          Encrypt
        </label>
        <div id="profile-sync-passphrase-group" class="hidden">
          <input type="password" id="profile-sync-passphrase" />
          <button type="button" id="profile-sync-passphrase-reveal" aria-pressed="false">Show passphrase</button>
          <div id="profile-sync-passphrase-confirm-group" class="hidden">
            <input type="password" id="profile-sync-passphrase-confirm" />
          </div>
          <button type="button" id="profile-sync-cancel-encryption-change" class="hidden">Cancel change</button>
          <label for="profile-sync-remember-passphrase">
            <input type="checkbox" id="profile-sync-remember-passphrase" />
            Remember
          </label>
          <button type="button" id="profile-sync-clear-passphrase">Clear Saved Passphrase</button>
        </div>
        <button type="button" id="profile-sync-now">Sync now</button>
        <button type="button" id="profile-sync-pull-now">Sync Down</button>
        <button type="button" id="profile-sync-push-now">Sync Up</button>
        <select id="profile-sync-backup-select"></select>
        <button type="button" id="profile-sync-restore-backup">Restore</button>
        <p id="profile-sync-backup-detail" class="hidden"></p>
        <div id="profile-sync-resolution" class="hidden">
          <p id="profile-sync-resolution-text"></p>
          <button type="button" id="profile-sync-resolve-upload">Keep Local</button>
          <button type="button" id="profile-sync-resolve-remote">Use Remote</button>
          <button type="button" id="profile-sync-resolve-cancel">Cancel</button>
        </div>
        <div id="profile-sync-status"></div>
        <div id="profile-sync-error" class="is-clamped"></div>
        <button type="button" id="profile-sync-error-toggle" class="hidden" aria-expanded="false">Details</button>
      </div>

      <div id="personalization-tab" class="tab-content">
        <div id="theme-mode-control" role="radiogroup">
          <button type="button" data-theme-mode="auto">Auto</button>
          <button type="button" data-theme-mode="dark">Dark</button>
          <button type="button" data-theme-mode="light">Light</button>
        </div>
        <div id="color-themes-section" class="personalization-section collapsed">
          <button type="button" id="color-themes-toggle" class="section-toggle" aria-expanded="false">
            Color Themes
          </button>
          <div class="section-body">
            <select id="color-target-select">
              <option value="accent">Accent Color</option>
              <option value="background">Background Color</option>
            </select>
            <label id="theme-options-label">Accent colors</label>
            <div id="theme-options"></div>
            <div id="theme-current-selection"></div>
            <input id="custom-color-picker" type="color" value="#64B5F6" />
            <input id="custom-color-r" type="number" min="0" max="255" step="1" />
            <input id="custom-color-g" type="number" min="0" max="255" step="1" />
            <input id="custom-color-b" type="number" min="0" max="255" step="1" />
            <input id="custom-color-hex" type="text" aria-describedby="custom-color-hex-error" />
            <button type="button" id="save-custom-color-btn">Save Custom Color</button>
            <div id="custom-color-hex-error" class="hidden"></div>
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
            <div id="frosted-glass-warning" class="hidden"></div>
            <input type="checkbox" id="weather-effects-enabled" />
            <div id="weather-effects-warning" class="hidden"></div>
            <div id="weather-override-group" style="display: none;">
              <select id="weather-override-select">
                <option value="auto">Auto</option>
                <option value="rainy">Rainy</option>
              </select>
            </div>
          </div>
        </div>
        <section class="settings-group">
          <div class="primary-card-actions" data-primary-card="0">
            <button type="button" data-primary-card="0" data-primary-value="weather">Weather</button>
            <button type="button" data-primary-card="0" data-primary-value="time">Time</button>
            <button type="button" data-primary-card="0" data-primary-value="none">Hide</button>
          </div>
          <div id="primary-cards-section" class="personalization-section collapsed">
            <button type="button" id="primary-cards-toggle" class="section-toggle" aria-expanded="false">
              Primary Cards
            </button>
            <div class="section-body">
              <div id="primary-card-1-current"></div>
              <div id="primary-card-2-current"></div>
              <button type="button" id="primary-cards-reset">Reset</button>
              <select id="time-format">
                <option value="system">System default</option>
                <option value="12-hour">12-hour</option>
                <option value="24-hour">24-hour</option>
              </select>
              <select id="date-format">
                <option value="system">System default</option>
                <option value="weekday-short">Weekday, short date</option>
                <option value="long">Long date</option>
                <option value="numeric">Numeric date</option>
              </select>
              <input type="text" id="primary-cards-search" />
              <div id="primary-cards-list"></div>
            </div>
          </div>
        </section>
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

      <label for="primary-media-player">Primary Media Player</label>
      <select id="primary-media-player"></select>

      <div id="popup-hotkey-container">
        <label id="popup-hotkey-mode-label">Popup hotkey</label>
        <p id="popup-hotkey-help-text"></p>
        <p id="popup-hotkey-platform-notice" hidden></p>
        <input type="text" id="popup-hotkey-input" />
        <button id="popup-hotkey-set-btn">Set hotkey</button>
        <button id="popup-hotkey-clear-btn" style="display: none;">Clear</button>
        <button class="preset-hotkey-btn" data-hotkey="Ctrl+Shift+F12">Ctrl+Shift+F12</button>
        <label id="popup-hotkey-toggle-mode-label">
          <input type="checkbox" id="popup-hotkey-toggle-mode" />
          Press to toggle
        </label>
        <label id="popup-hotkey-hide-on-release-label">
          <input type="checkbox" id="popup-hotkey-hide-on-release" />
          Hide on release
        </label>
      </div>

      <button id="save-settings">Save</button>
      <button id="cancel-settings">Cancel</button>
    </div>
  `;

  document.body.appendChild(modal);
}

describe('Settings + Config Integration', () => {
  const settings = require('../../src/settings.js');
  const connectionStatus = require('../../src/connection-status.js');
  const state = require('../../src/state.js').default;
  const profileSyncFixture = JSON.parse(JSON.stringify(sampleConfig.profileSync));
  const waitForLanguagePackRefresh = async () => {
    await settings.waitForLanguagePackRefresh();
    await Promise.resolve();
  };
  const buildProfileSync = (overrides = {}) => {
    const next = {
      ...profileSyncFixture,
      ...overrides,
      syncScope: {
        ...profileSyncFixture.syncScope,
        sections: {
          ...profileSyncFixture.syncScope.sections,
        },
      },
    };
    if (overrides.syncScope) {
      next.syncScope = {
        ...profileSyncFixture.syncScope,
        ...overrides.syncScope,
        sections: {
          ...profileSyncFixture.syncScope.sections,
          ...(overrides.syncScope.sections || {}),
        },
      };
    }
    return next;
  };
  const buildProfileSyncStatus = (overrides = {}) => ({
    ...buildProfileSync({
      cloudFilePath: '',
      lastSyncAt: null,
      lastSyncStatus: 'idle',
      lastSyncError: '',
    }),
    passphraseEncrypted: false,
    passphraseStored: false,
    passphraseActive: false,
    needsResolution: false,
    inFlight: false,
    ...overrides,
    syncScope: overrides.syncScope
      ? {
          ...profileSyncFixture.syncScope,
          ...overrides.syncScope,
          sections: {
            ...profileSyncFixture.syncScope.sections,
            ...(overrides.syncScope.sections || {}),
          },
        }
      : buildProfileSync().syncScope,
  });
  /** Gives the open Settings window a saved, running sync, so a manual sync can start. */
  const enableSavedProfileSync = (overrides = {}) => {
    const running = {
      enabled: true,
      provider: 'cloudFile',
      cloudFilePath: '/tmp/shared-folder/ha-widget-profile-sync.json',
      ...overrides,
    };
    state.CONFIG.profileSync = buildProfileSync(running);
    mockElectronAPI.getProfileSyncStatus.mockResolvedValueOnce(buildProfileSyncStatus(running));
  };
  const openSettingsWithCustomIconsExpanded = async (uiHooks = undefined) => {
    const config = state.CONFIG;
    config.ui = config.ui || {};
    config.ui.personalizationSectionsCollapsed = {
      ...(config.ui.personalizationSectionsCollapsed || {}),
      'custom-entity-icons-section': false,
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
        initUpdateUI: jest.fn(),
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

      // Settings is a dialog, named by its heading, and focus lands inside it and not on Close.
      expect(modal.getAttribute('role')).toBe('dialog');
      expect(modal.getAttribute('aria-modal')).toBe('true');
      expect(document.getElementById(modal.getAttribute('aria-labelledby')).textContent).toBe(
        'Settings'
      );
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(document.activeElement.id).not.toBe('close-settings');
      expect(modal.contains(document.activeElement)).toBe(true);
      expect(mockUiHooks.initUpdateUI).toHaveBeenCalled();
    });

    test('says in a title why layer mode turns the on top and hide on blur switches off', async () => {
      const reason = 'Desktop layer mode keeps the widget behind normal windows.';
      const alwaysOnTop = document.getElementById('always-on-top');
      const hideOnBlur = document.getElementById('hide-on-blur');
      state.CONFIG.desktopCapabilities = { layerMode: false };
      await settings.openSettings();
      expect([alwaysOnTop.title, hideOnBlur.title]).toEqual(['', '']);
      settings.closeSettings();

      state.CONFIG.desktopCapabilities = { layerMode: true };
      await settings.openSettings();
      expect([alwaysOnTop.disabled, hideOnBlur.disabled]).toEqual([true, true]);
      expect([alwaysOnTop.title, hideOnBlur.title]).toEqual([reason, reason]);
      settings.closeSettings();

      // And the reason goes again once the switches are usable.
      state.CONFIG.desktopCapabilities = { layerMode: false };
      await settings.openSettings();
      expect([alwaysOnTop.title, hideOnBlur.title]).toEqual(['', '']);
    });

    test('closing Settings after an import keeps the imported window effects', async () => {
      window.electronAPI.previewWindowEffects = jest.fn().mockResolvedValue(undefined);
      window.electronAPI.previewSettingsImport = jest.fn().mockResolvedValue({
        success: true,
        canceled: false,
        id: 'import-1',
        fileName: 'settings.json',
        changedSections: ['visualPersonalization'],
        pageNames: [],
        entityIds: [],
      });
      window.electronAPI.applySettingsImport = jest.fn().mockResolvedValue({
        success: true,
        config: { ...state.CONFIG, opacity: 0.6, frostedGlass: false },
      });
      mockUiUtils.showConfirm.mockResolvedValueOnce(true);
      document
        .getElementById('settings-modal')
        .insertAdjacentHTML(
          'beforeend',
          '<button id="export-settings-file"></button><button id="import-settings-file"></button>'
        );
      await settings.openSettings();
      document.getElementById('import-settings-file').click();
      for (let i = 0; i < 10; i += 1) await Promise.resolve();
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(window.electronAPI.applySettingsImport).toHaveBeenCalledWith('import-1');
      expect(window.electronAPI.previewWindowEffects).toHaveBeenLastCalledWith({
        opacity: 0.6,
        frostedGlass: false,
      });
    });

    test('hide on focus loss defaults off and persists both checkbox values', async () => {
      await settings.openSettings();
      const checkbox = document.getElementById('hide-on-blur');
      expect(checkbox.checked).toBe(false);
      checkbox.checked = true;
      await settings.saveSettings();
      expect(window.electronAPI.updateConfig).toHaveBeenLastCalledWith(
        expect.objectContaining({ hideOnBlur: true })
      );
      expect(state.CONFIG.hideOnBlur).toBe(true);
      await settings.openSettings();
      expect(checkbox.checked).toBe(true);
      checkbox.checked = false;
      await settings.saveSettings();
      expect(state.CONFIG.hideOnBlur).toBe(false);
    });

    test('keeps settings another computer changed while the form was open', async () => {
      // Main always sends these filled in with their defaults.
      state.setConfig({
        ...state.CONFIG,
        hideOnBlur: false,
        ui: { ...state.CONFIG.ui, accent: 'original' },
      });
      await settings.openSettings();
      expect(document.getElementById('always-on-top').checked).toBe(true);
      document.getElementById('always-on-top').checked = false;
      // A profile sync pull lands while Settings is open.
      state.setConfig({
        ...state.CONFIG,
        hideOnBlur: true,
        ui: { ...state.CONFIG.ui, accent: 'teal' },
      });

      await settings.saveSettings();

      expect(window.electronAPI.updateConfig).toHaveBeenLastCalledWith(
        expect.objectContaining({
          // Changed here by the user.
          alwaysOnTop: false,
          // Changed on the other computer, untouched in the form.
          hideOnBlur: true,
          ui: expect.objectContaining({ accent: 'teal' }),
        })
      );
    });

    test('keeps a setting the user deliberately set back to its original value', async () => {
      state.setConfig({ ...state.CONFIG, hideOnBlur: false });
      await settings.openSettings();
      const hideOnBlur = document.getElementById('hide-on-blur');
      // Another computer turns it on while the form is open...
      state.setConfig({ ...state.CONFIG, hideOnBlur: true });
      // ...and the user switches it on and back off again here.
      hideOnBlur.click();
      hideOnBlur.click();
      expect(hideOnBlur.checked).toBe(false);

      await settings.saveSettings();

      expect(window.electronAPI.updateConfig).toHaveBeenLastCalledWith(
        expect.objectContaining({
          hideOnBlur: false,
          // So main's stale-echo guard keeps it too.
          profileSyncTouchedKeys: expect.arrayContaining(['hideOnBlur']),
        })
      );
    });

    test('picking the accent or theme already chosen does not count as an edit', async () => {
      state.setConfig({
        ...state.CONFIG,
        ui: { ...state.CONFIG.ui, accent: 'original', theme: 'dark' },
      });
      await settings.openSettings();
      document.querySelector('#theme-options [data-theme="original"]').click();
      document.querySelector('#theme-mode-control [data-theme-mode="dark"]').click();
      // A profile sync pull lands before Save.
      state.setConfig({
        ...state.CONFIG,
        ui: { ...state.CONFIG.ui, accent: 'teal', theme: 'light' },
      });

      await settings.saveSettings();

      const saved = window.electronAPI.updateConfig.mock.calls.at(-1)[0];
      expect(saved.ui).toEqual(expect.objectContaining({ accent: 'teal', theme: 'light' }));
      expect(saved.profileSyncTouchedKeys || []).not.toContain('ui.accent');
      expect(saved.profileSyncTouchedKeys || []).not.toContain('ui.theme');
    });

    test('opening a picker without changing it does not count as an edit', async () => {
      state.setConfig({ ...state.CONFIG, ui: { ...state.CONFIG.ui, density: 'comfortable' } });
      await settings.openSettings();
      // Opening and closing the select changes nothing.
      document.getElementById('density-select').click();
      state.setConfig({ ...state.CONFIG, ui: { ...state.CONFIG.ui, density: 'compact' } });

      await settings.saveSettings();

      expect(window.electronAPI.updateConfig).toHaveBeenLastCalledWith(
        expect.objectContaining({ ui: expect.objectContaining({ density: 'compact' }) })
      );
    });

    test('OAuth settings hide the access token and preserve authorization on unrelated saves', async () => {
      state.CONFIG.homeAssistant = {
        url: 'https://ha.example.test',
        token: 'short-lived-access-token',
        authMethod: 'oauth',
        oauthStatus: 'connected',
      };

      await settings.openSettings();

      const tokenInput = document.getElementById('ha-token');
      expect(tokenInput.value).toBe('');
      expect(tokenInput.disabled).toBe(true);
      expect(document.getElementById('disconnect-ha-oauth-btn').classList).not.toContain('hidden');
      expect(document.getElementById('ha-oauth-status').textContent).toBe(
        'Connected with Home Assistant authorization.'
      );

      document.getElementById('always-on-top').checked = false;
      await settings.saveSettings();

      expect(window.electronAPI.updateConfig).toHaveBeenCalledWith(
        expect.objectContaining({
          homeAssistant: expect.objectContaining({
            authMethod: 'oauth',
            token: 'short-lived-access-token',
          }),
        })
      );
    });

    test('open Settings follows the authorization when Home Assistant revokes it', async () => {
      state.CONFIG.homeAssistant = {
        url: 'https://ha.example.test',
        token: 'short-lived-access-token',
        authMethod: 'oauth',
        oauthStatus: 'connected',
      };
      await settings.openSettings();
      const status = document.getElementById('ha-oauth-status');
      expect(status.textContent).toBe('Connected with Home Assistant authorization.');
      const legacySettings = document.getElementById('legacy-ha-token-settings');
      legacySettings.open = true;
      settings.refreshHomeAssistantAuthStatus();
      expect(legacySettings.open).toBe(true);

      state.CONFIG.homeAssistant = {
        ...state.CONFIG.homeAssistant,
        token: 'YOUR_LONG_LIVED_ACCESS_TOKEN',
        oauthStatus: 'reauth_required',
      };
      settings.refreshHomeAssistantAuthStatus();

      expect(status.textContent).toBe(
        'Home Assistant no longer accepts the authorization for this app. It may have expired or been revoked. Reconnect with Home Assistant to continue.'
      );
      expect(document.getElementById('connect-ha-oauth-btn').textContent).toBe(
        'Reconnect with Home Assistant'
      );
    });

    test('offers Retry, not a new sign-in, while Home Assistant is only offline', async () => {
      state.CONFIG.homeAssistant = {
        url: 'https://ha.example.test',
        token: 'YOUR_LONG_LIVED_ACCESS_TOKEN',
        authMethod: 'oauth',
        oauthStatus: 'offline',
        oauthLastError: 'connect ECONNREFUSED',
        oauthLastErrorCode: 'OAUTH_TOKEN_NETWORK',
      };
      await settings.openSettings();
      const button = document.getElementById('connect-ha-oauth-btn');
      const status = document.getElementById('ha-oauth-status');
      expect(button.textContent).toBe('Retry');
      expect(status.textContent).toBe(
        'Home Assistant is offline. Authorization will retry automatically.'
      );

      mockElectronAPI.refreshHomeAssistantOAuth.mockResolvedValueOnce({
        success: true,
        oauthStatus: 'offline',
      });
      button.click();
      await Promise.resolve();
      await Promise.resolve();
      expect(mockElectronAPI.refreshHomeAssistantOAuth).toHaveBeenCalledTimes(1);
      expect(mockElectronAPI.startHomeAssistantOAuth).not.toHaveBeenCalled();
      expect(button.textContent).toBe('Retry');

      // Another server typed into the URL field needs a new authorization.
      const url = document.getElementById('ha-url');
      url.value = 'https://other.example.test';
      url.dispatchEvent(new Event('input'));
      expect(button.textContent).toBe('Reconnect with Home Assistant');
      expect(button.classList).not.toContain('hidden');

      // A working authorization for this server needs no new sign-in.
      url.value = 'https://ha.example.test';
      state.CONFIG.homeAssistant = {
        ...state.CONFIG.homeAssistant,
        token: 'short-lived-access-token',
        oauthStatus: 'connected',
      };
      settings.refreshHomeAssistantAuthStatus();
      expect(button.classList).toContain('hidden');
    });

    test('connect button delegates OAuth pairing to the main process', async () => {
      await settings.openSettings();
      document.getElementById('ha-url').value = 'https://ha.example.test';
      mockElectronAPI.startHomeAssistantOAuth.mockResolvedValueOnce({
        success: true,
        config: {
          ...state.CONFIG,
          homeAssistant: {
            url: 'https://ha.example.test',
            token: 'short-lived-access-token',
            authMethod: 'oauth',
            oauthStatus: 'connected',
          },
        },
      });

      document.getElementById('connect-ha-oauth-btn').click();
      await Promise.resolve();
      await Promise.resolve();

      expect(mockElectronAPI.startHomeAssistantOAuth).toHaveBeenCalledWith(
        'https://ha.example.test'
      );
      expect(state.CONFIG.homeAssistant.authMethod).toBe('oauth');
      expect(document.getElementById('ha-token').disabled).toBe(true);
    });

    test('cancel button abandons an in-flight OAuth pairing and clears the busy state', async () => {
      await settings.openSettings();
      document.getElementById('ha-url').value = 'https://ha.example.test';

      let rejectPairing;
      mockElectronAPI.startHomeAssistantOAuth.mockImplementationOnce(
        () =>
          new Promise((_resolve, reject) => {
            rejectPairing = reject;
          })
      );

      const cancelButton = document.getElementById('cancel-ha-oauth-btn');
      const status = document.getElementById('ha-oauth-status');
      expect(cancelButton.classList.contains('hidden')).toBe(true);

      document.getElementById('connect-ha-oauth-btn').click();
      await Promise.resolve();

      expect(cancelButton.classList.contains('hidden')).toBe(false);
      expect(cancelButton.disabled).toBe(false);
      expect(document.getElementById('connect-ha-oauth-btn').disabled).toBe(true);
      expect(status.dataset.busy).toBe('true');
      expect(status.querySelectorAll('.connection-progress')).toHaveLength(1);
      expect(status.textContent).toBe('Waiting for you to approve in your browser...');

      cancelButton.click();
      await Promise.resolve();
      expect(mockElectronAPI.cancelHomeAssistantOAuth).toHaveBeenCalled();

      const cancellation = new Error('Home Assistant authorization was canceled');
      cancellation.result = { success: false, code: 'OAUTH_AUTHORIZATION_CANCELED' };
      rejectPairing(cancellation);
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();

      expect(cancelButton.classList.contains('hidden')).toBe(true);
      expect(document.getElementById('connect-ha-oauth-btn').disabled).toBe(false);
      expect(status.dataset.busy).toBeUndefined();
      expect(status.querySelector('.connection-progress')).toBeNull();
      expect(status.textContent).toBe('Home Assistant authorization canceled');
    });

    test('explains an unreachable URL before any browser opens', async () => {
      await settings.openSettings();
      document.getElementById('ha-url').value = 'http://127.0.0.1:1';
      mockElectronAPI.startHomeAssistantOAuth.mockResolvedValueOnce({
        success: false,
        code: 'OAUTH_SERVER_UNREACHABLE',
        error: 'Could not reach Home Assistant at that URL',
      });

      document.getElementById('connect-ha-oauth-btn').click();
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();

      expect(document.getElementById('ha-oauth-status').textContent).toBe(
        'Could not reach Home Assistant at that URL.'
      );
      expect(document.getElementById('connect-ha-oauth-btn').disabled).toBe(false);
    });

    test('shows a known pairing failure in its own words, not the main-process text', async () => {
      await settings.openSettings();
      document.getElementById('ha-url').value = 'https://ha.example.test';
      mockElectronAPI.startHomeAssistantOAuth.mockResolvedValueOnce({
        success: false,
        code: 'OAUTH_STATE_MISMATCH',
        error: 'Home Assistant returned an invalid OAuth state',
      });

      document.getElementById('connect-ha-oauth-btn').click();
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();

      expect(document.getElementById('ha-oauth-status').textContent).toBe(
        'Home Assistant sent back an authorization that does not match this request. Try again.'
      );
    });

    test('reports a network failure while refreshing as Home Assistant being offline', async () => {
      state.CONFIG.homeAssistant = {
        url: 'https://ha.example.test',
        token: 'YOUR_LONG_LIVED_ACCESS_TOKEN',
        authMethod: 'oauth',
        oauthStatus: 'offline',
        oauthLastError: 'connect ECONNREFUSED 127.0.0.1:8123',
        oauthLastErrorCode: 'OAUTH_TOKEN_NETWORK',
      };
      await settings.openSettings();

      expect(document.getElementById('ha-oauth-status').textContent).toBe(
        'Home Assistant is offline. Authorization will retry automatically.'
      );
    });

    test('explains an unconfirmed revocation after disconnecting without main-process text', async () => {
      state.CONFIG.homeAssistant = {
        url: 'https://ha.example.test',
        token: 'short-lived-access-token',
        authMethod: 'oauth',
        oauthStatus: 'connected',
      };
      mockElectronAPI.disconnectHomeAssistantOAuth = jest.fn().mockResolvedValue({
        success: true,
        config: {
          ...state.CONFIG,
          homeAssistant: {
            url: 'https://ha.example.test',
            token: 'YOUR_LONG_LIVED_ACCESS_TOKEN',
            authMethod: 'token',
          },
        },
        revokedRemotely: false,
        warning: 'Home Assistant did not confirm token revocation',
      });
      await settings.openSettings();

      document.getElementById('disconnect-ha-oauth-btn').click();
      for (let i = 0; i < 5; i += 1) await Promise.resolve();

      expect(mockUiUtils.showToast).toHaveBeenCalledWith(
        'Disconnected. Home Assistant did not confirm that it revoked the authorization, so you can remove it from your Home Assistant profile.',
        'warning',
        5000
      );
    });

    test('reports a pairing canceled through the preload bridge as canceled', async () => {
      await settings.openSettings();
      document.getElementById('ha-url').value = 'https://ha.example.test';
      mockElectronAPI.startHomeAssistantOAuth.mockResolvedValueOnce({
        success: false,
        code: 'OAUTH_AUTHORIZATION_CANCELED',
        error: 'Home Assistant authorization was canceled',
      });

      document.getElementById('connect-ha-oauth-btn').click();
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();

      const status = document.getElementById('ha-oauth-status');
      expect(status.textContent).toBe('Home Assistant authorization canceled');
    });

    test('the waiting indicator is not duplicated across status updates', async () => {
      await settings.openSettings();
      const status = document.getElementById('ha-oauth-status');

      connectionStatus.setConnectionStatusBusy(status, true);
      connectionStatus.renderConnectionStatus(status, 'Waiting one', 'pending');
      connectionStatus.renderConnectionStatus(status, 'Waiting two', 'pending');

      expect(status.querySelectorAll('.connection-progress')).toHaveLength(1);
      expect(status.textContent).toBe('Waiting two');
      // The track must trail the message so it reads as a footer, not a bullet.
      expect(status.lastElementChild.className).toBe('connection-progress');

      connectionStatus.renderConnectionStatus(status, '', '');
      // Emptied, not removed: a live region that stays in the page announces the next message.
      expect(status.classList.contains('hidden')).toBe(false);
      expect(status.classList.contains('connection-status-empty')).toBe(true);
      expect(status.querySelector('.connection-progress')).toBeNull();
    });

    test('keeps the status line in the page and raises an error as an alert', async () => {
      await settings.openSettings();
      const status = document.getElementById('ha-oauth-status');

      connectionStatus.renderConnectionStatus(status, 'Could not reach Home Assistant.', 'error');
      expect(status.getAttribute('role')).toBe('alert');
      // An explicit aria-live outranks the role's own, so the two have to agree.
      expect(status.getAttribute('aria-live')).toBe('assertive');
      expect(status.classList.contains('connection-status-empty')).toBe(false);

      connectionStatus.renderConnectionStatus(status, 'Connected.', 'success');
      expect(status.getAttribute('role')).toBe('status');
      expect(status.getAttribute('aria-live')).toBe('polite');
    });

    test('discovers available weather entities and selects the saved source', async () => {
      state.CONFIG.selectedWeatherEntity = 'weather.home';
      state.setStates({
        'weather.home': {
          entity_id: 'weather.home',
          state: 'sunny',
          attributes: { friendly_name: 'Home Weather' },
        },
        'weather.backup': {
          entity_id: 'weather.backup',
          state: 'cloudy',
          attributes: { friendly_name: 'Backup Weather' },
        },
        'weather.offline': {
          entity_id: 'weather.offline',
          state: 'unavailable',
          attributes: { friendly_name: 'Offline Weather' },
        },
      });

      await settings.openSettings();

      const select = document.getElementById('weather-entity-select');
      expect(select.value).toBe('weather.home');
      expect([...select.options].map((option) => option.value)).toEqual([
        '',
        'weather.backup',
        'weather.home',
      ]);
      expect(document.getElementById('weather-entity-help').textContent).toContain('weather card');
    });

    test('persists a weather source chosen in Settings', async () => {
      state.CONFIG.selectedWeatherEntity = null;
      state.setStates({
        'weather.home': {
          entity_id: 'weather.home',
          state: 'sunny',
          attributes: { friendly_name: 'Home Weather' },
        },
        'weather.backup': {
          entity_id: 'weather.backup',
          state: 'cloudy',
          attributes: { friendly_name: 'Backup Weather' },
        },
      });

      await settings.openSettings();
      document.getElementById('weather-entity-select').value = 'weather.backup';

      await settings.saveSettings();

      expect(state.CONFIG.selectedWeatherEntity).toBe('weather.backup');
      expect(window.electronAPI.updateConfig).toHaveBeenCalledWith(
        expect.objectContaining({ selectedWeatherEntity: 'weather.backup' })
      );
    });

    test('retains an unavailable saved weather source while the widget falls back automatically', async () => {
      state.CONFIG.selectedWeatherEntity = 'weather.home';
      state.setStates({
        'weather.home': {
          entity_id: 'weather.home',
          state: 'unavailable',
          attributes: { friendly_name: 'Home Weather' },
        },
        'weather.backup': {
          entity_id: 'weather.backup',
          state: 'cloudy',
          attributes: { friendly_name: 'Backup Weather' },
        },
      });

      await settings.openSettings();

      const select = document.getElementById('weather-entity-select');
      expect(select.value).toBe('weather.home');
      expect(select.selectedOptions[0].disabled).toBe(true);
      expect(select.selectedOptions[0].textContent).toContain('Unavailable saved source');
      expect(document.getElementById('weather-entity-help').textContent).toContain(
        'using the first available source'
      );

      await settings.saveSettings();

      expect(state.CONFIG.selectedWeatherEntity).toBe('weather.home');
    });

    test('Linux popup hotkeys expose stable press behavior and disable release-only controls', async () => {
      mockElectronAPI.platform = 'linux';

      await settings.openSettings();
      await Promise.resolve();
      await Promise.resolve();

      expect(document.getElementById('popup-hotkey-mode-label').textContent).toBe('Popup hotkey');
      expect(document.getElementById('popup-hotkey-platform-notice').hidden).toBe(false);
      expect(document.getElementById('popup-hotkey-platform-notice').textContent).toContain(
        'Linux uses the desktop shortcut service'
      );
      expect(document.getElementById('popup-hotkey-hide-on-release').disabled).toBe(true);
      expect(document.getElementById('popup-hotkey-toggle-mode').disabled).toBe(false);

      document.querySelector('[data-hotkey="Ctrl+Shift+F12"]').click();
      await Promise.resolve();
      await Promise.resolve();

      expect(mockElectronAPI.registerPopupHotkey).toHaveBeenCalledWith('Ctrl+Shift+F12');
      expect(document.getElementById('popup-hotkey-input').value).toBe('Ctrl+Shift+F12');
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
      expect(mockHotkeys.cleanupHotkeyEventListeners).toHaveBeenCalled();
    });

    test('opening settings exits reorganize mode', async () => {
      const mockUiHooks = {
        exitReorganizeMode: jest.fn(),
        initUpdateUI: jest.fn(),
      };

      await settings.openSettings(mockUiHooks);

      expect(mockUiHooks.exitReorganizeMode).toHaveBeenCalled();
    });

    test('opening settings restores collapsed states and ignores expanded persisted values', async () => {
      state.CONFIG.ui.personalizationSectionsCollapsed = {
        'color-themes-section': true,
        'window-effects-section': false,
        'custom-entity-icons-section': true,
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
        expect(state.CONFIG.ui.personalizationSectionsCollapsed).not.toHaveProperty(
          'window-effects-section'
        );
        expect(window.electronAPI.updateConfig).not.toHaveBeenCalled();

        // Collapse should persist as an explicit saved state.
        windowEffectsToggle.click();
        expect(windowEffectsSection.classList.contains('collapsed')).toBe(true);
        expect(state.CONFIG.ui.personalizationSectionsCollapsed['window-effects-section']).toBe(
          true
        );

        jest.advanceTimersByTime(260);
        await Promise.resolve();

        expect(window.electronAPI.updateConfig).toHaveBeenCalledWith(
          expect.objectContaining({
            ui: expect.objectContaining({
              personalizationSectionsCollapsed: expect.objectContaining({
                'window-effects-section': true,
              }),
            }),
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
                'color-themes-section': true,
              }),
            }),
          })
        );
      } finally {
        jest.useRealTimers();
      }
    });

    test('preserves assignment focus and paginates and debounces primary-card search', async () => {
      const entities = Object.fromEntries(
        Array.from({ length: 121 }, (_, index) => {
          const entity_id = `sensor.test_${String(index).padStart(3, '0')}`;
          return [
            entity_id,
            {
              entity_id,
              state: '1',
              attributes: { friendly_name: `Test ${String(index).padStart(3, '0')}` },
            },
          ];
        })
      );
      state.setStates(entities);
      await settings.openSettings();
      document.getElementById('primary-cards-toggle').click();
      const list = document.getElementById('primary-cards-list');
      expect(list.querySelectorAll('.entity-item')).toHaveLength(50);
      const assign = list.querySelector('[data-primary-assign="0"]');
      assign.focus();
      assign.click();
      expect(document.activeElement.dataset.entityId).toBe(assign.dataset.entityId);
      expect(document.activeElement.getAttribute('aria-disabled')).toBe('true');
      const next = list.querySelector('[data-primary-page="next"]');
      next.focus();
      next.click();
      expect(document.activeElement.dataset.primaryPage).toBe('next');
      expect(list.querySelector('[data-primary-assign]').dataset.entityId).toBe('sensor.test_050');
      expect(list.querySelector('[role="status"]').textContent).toBe('Page 2 / 3');
      list.querySelector('[data-primary-page="next"]').click();
      expect(list.querySelectorAll('.entity-item')).toHaveLength(21);
      expect(list.querySelector('[data-primary-page="next"]').getAttribute('aria-disabled')).toBe(
        'true'
      );
      jest.useFakeTimers();
      try {
        const search = document.getElementById('primary-cards-search');
        search.value = 'Test 000';
        search.dispatchEvent(new Event('input'));
        jest.advanceTimersByTime(100);
        expect(list.querySelectorAll('.entity-item')).toHaveLength(21);
        search.value = 'Test 120';
        search.dispatchEvent(new Event('input'));
        jest.advanceTimersByTime(150);
        expect(list.querySelector('[data-primary-assign]').dataset.entityId).toBe(
          'sensor.test_120'
        );
      } finally {
        settings.closeSettings();
        jest.clearAllTimers();
        jest.useRealTimers();
      }
    });

    test('groups the two Set Card buttons of a row under the name of its entity', async () => {
      state.setStates({
        'sensor.kitchen_temp': {
          entity_id: 'sensor.kitchen_temp',
          state: '20',
          attributes: { friendly_name: 'Kitchen temperature' },
        },
        'sensor.hall_temp': {
          entity_id: 'sensor.hall_temp',
          state: '19',
          attributes: { friendly_name: 'Hall temperature' },
        },
      });
      await settings.openSettings();
      document.getElementById('primary-cards-toggle').click();

      const groups = [
        ...document.querySelectorAll(
          '#primary-cards-list .primary-cards-list-actions[role="group"]'
        ),
      ];

      expect(groups.map((group) => group.getAttribute('aria-label')).sort()).toEqual([
        'Hall temperature',
        'Kitchen temperature',
      ]);
      expect(groups.every((group) => group.querySelectorAll('button').length === 2)).toBe(true);
      settings.closeSettings();
    });

    test('starts each primary-card page at its top but keeps the scroll position on assignment', async () => {
      const entities = Object.fromEntries(
        Array.from({ length: 121 }, (_, index) => {
          const entity_id = `sensor.test_${String(index).padStart(3, '0')}`;
          return [entity_id, { entity_id, state: '1', attributes: {} }];
        })
      );
      state.setStates(entities);
      await settings.openSettings();
      document.getElementById('primary-cards-toggle').click();
      const list = document.getElementById('primary-cards-list');
      // jsdom does not lay out, so give the list a scroll position it keeps.
      let scrollTop = 0;
      Object.defineProperty(list, 'scrollTop', {
        configurable: true,
        get: () => scrollTop,
        set: (value) => {
          scrollTop = value;
        },
      });

      try {
        list.scrollTop = 400;
        const assign = list.querySelector('[data-primary-assign="0"]');
        assign.focus();
        assign.click();
        expect(list.scrollTop).toBe(400);

        list.scrollTop = 900;
        const next = list.querySelector('[data-primary-page="next"]');
        next.focus();
        next.click();
        expect(list.querySelector('[role="status"]').textContent).toBe('Page 2 / 3');
        expect(list.scrollTop).toBe(0);
        expect(document.activeElement.dataset.primaryPage).toBe('next');

        list.scrollTop = 900;
        list.querySelector('[data-primary-page="previous"]').click();
        expect(list.querySelector('[role="status"]').textContent).toBe('Page 1 / 3');
        expect(list.scrollTop).toBe(0);
      } finally {
        settings.closeSettings();
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

  describe('Desktop Pins', () => {
    test('save keeps the live desktop pins, including changes made while settings is open', async () => {
      state.CONFIG.desktopPins = {
        'light.living_room': { x: 10, y: 20, width: 176, height: 176 },
        'switch.bedroom': { x: 40, y: 60, width: 176, height: 176 },
      };

      await settings.openSettings();

      // Pins are managed from the tiles and the pin windows, not from Settings.
      state.setConfig({
        ...state.CONFIG,
        desktopPins: {
          'light.living_room': { x: 240, y: 160, width: 188, height: 152 },
        },
      });

      await settings.saveSettings();

      expect(window.electronAPI.updateConfig).toHaveBeenCalledWith(
        expect.objectContaining({
          desktopPins: {
            'light.living_room': { x: 240, y: 160, width: 188, height: 152 },
          },
        })
      );
    });
  });

  describe('Primary card choices', () => {
    test('a Card 1 choice outside the collapsible picker still applies and saves', async () => {
      await settings.openSettings();
      document.querySelector('[data-primary-card="0"][data-primary-value="time"]').click();
      await settings.saveSettings();
      expect(state.CONFIG.primaryCards[0]).toBe('time');
    });

    test('exposes the chosen source as pressed and keeps "(default)" with its own card', async () => {
      await settings.openSettings();
      const button = (card, value) =>
        document.querySelector(`[data-primary-card="${card}"][data-primary-value="${value}"]`);

      expect(button(0, 'weather').getAttribute('aria-pressed')).toBe('true');
      expect(button(0, 'time').getAttribute('aria-pressed')).toBe('false');
      expect(document.getElementById('primary-card-1-current').textContent).toBe(
        'Weather (default)'
      );

      button(0, 'time').click();
      expect(button(0, 'time').getAttribute('aria-pressed')).toBe('true');
      expect(button(0, 'weather').getAttribute('aria-pressed')).toBe('false');
      // Time is Card 2's default, not Card 1's, so after the swap Card 1 no longer claims it.
      expect(document.getElementById('primary-card-1-current').textContent).toBe('Time');
    });
  });

  describe('Theme mode control', () => {
    const checkedMode = () =>
      document.querySelector('#theme-mode-control [aria-checked="true"]')?.dataset.themeMode;

    test('reflects the saved theme when settings open', async () => {
      state.CONFIG.ui = { ...(state.CONFIG.ui || {}), theme: 'light' };
      await settings.openSettings();
      expect(checkedMode()).toBe('light');
      settings.closeSettings();
    });

    test('treats a missing or unknown theme as Auto', async () => {
      state.CONFIG.ui = { ...(state.CONFIG.ui || {}), theme: 'sepia' };
      await settings.openSettings();
      expect(checkedMode()).toBe('auto');
      settings.closeSettings();
    });

    test('previews a mode live and saves it', async () => {
      state.CONFIG.ui = { ...(state.CONFIG.ui || {}), theme: 'dark' };
      await settings.openSettings();
      mockUiUtils.applyTheme.mockClear();

      document.querySelector('#theme-mode-control [data-theme-mode="light"]').click();
      expect(mockUiUtils.applyTheme).toHaveBeenCalledWith('light');
      expect(checkedMode()).toBe('light');

      await settings.saveSettings();
      expect(state.CONFIG.ui.theme).toBe('light');
    });

    test('closing without saving restores the saved mode', async () => {
      state.CONFIG.ui = { ...(state.CONFIG.ui || {}), theme: 'dark' };
      await settings.openSettings();
      document.querySelector('#theme-mode-control [data-theme-mode="light"]').click();
      mockUiUtils.applyTheme.mockClear();

      settings.closeSettings();
      expect(mockUiUtils.applyTheme).toHaveBeenCalledWith('dark');
      expect(state.CONFIG.ui.theme).toBe('dark');
    });

    test('arrow keys move the selection', async () => {
      state.CONFIG.ui = { ...(state.CONFIG.ui || {}), theme: 'auto' };
      await settings.openSettings();
      document
        .querySelector('#theme-mode-control [data-theme-mode="auto"]')
        .dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
      expect(checkedMode()).toBe('dark');
      settings.closeSettings();
    });

    test('in right-to-left text the arrow that points at a neighbour moves there', async () => {
      state.CONFIG.ui = { ...(state.CONFIG.ui || {}), theme: 'dark' };
      await settings.openSettings();
      const control = document.getElementById('theme-mode-control');
      const press = (mode, key) =>
        control
          .querySelector(`[data-theme-mode="${mode}"]`)
          .dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }));
      // The segments run Auto, Dark, Light from the right, so Light is the one on the left.
      control.style.direction = 'rtl';

      press('dark', 'ArrowLeft');
      expect(checkedMode()).toBe('light');
      press('light', 'ArrowRight');
      expect(checkedMode()).toBe('dark');
      press('dark', 'ArrowRight');
      expect(checkedMode()).toBe('auto');
      // The vertical arrows and Home and End do not depend on the direction.
      press('auto', 'ArrowDown');
      expect(checkedMode()).toBe('dark');
      press('dark', 'End');
      expect(checkedMode()).toBe('light');
      settings.closeSettings();
    });

    test('leaves an arrow with a modifier to the browser', async () => {
      state.CONFIG.ui = { ...(state.CONFIG.ui || {}), theme: 'auto' };
      await settings.openSettings();
      const event = new KeyboardEvent('keydown', {
        key: 'ArrowRight',
        altKey: true,
        bubbles: true,
        cancelable: true,
      });
      document.querySelector('#theme-mode-control [data-theme-mode="auto"]').dispatchEvent(event);

      expect(event.defaultPrevented).toBe(false);
      expect(checkedMode()).toBe('auto');
      settings.closeSettings();
    });
  });

  describe('Background swatches', () => {
    const openBackgroundSwatches = async () => {
      await settings.openSettings();
      const target = document.getElementById('color-target-select');
      target.value = 'background';
      target.dispatchEvent(new Event('change'));
      return [...document.querySelectorAll('#theme-options .color-theme-option')];
    };

    test('draw the window a choice gives, with the choice as a dot', async () => {
      const swatches = await openBackgroundSwatches();
      const original = swatches.find((option) => option.dataset.theme === 'original');
      const rose = swatches.find((option) => option.dataset.theme === 'rose');

      // The untinted base is the window colour itself, with no dot to show for it.
      expect(original.dataset.backgroundSwatch).toBe('base');
      expect(original.style.getPropertyValue('--swatch-window')).toBe('#12161e');
      expect(original.style.getPropertyValue('--swatch')).toBe('#12161e');
      // Any other choice shows the tinted window, and its own colour for the dot.
      expect(rose.dataset.backgroundSwatch).toBe('tinted');
      expect(rose.style.getPropertyValue('--swatch-window')).toBe('#222c3c');
      expect(rose.style.getPropertyValue('--swatch').toLowerCase()).toBe('#f43f5e');
      settings.closeSettings();
    });

    test('call the untinted base neutral in either theme', async () => {
      const swatches = await openBackgroundSwatches();
      const original = swatches.find((option) => option.dataset.theme === 'original');
      expect(original.getAttribute('aria-label')).toContain('Original base (no tint)');
      expect(original.getAttribute('aria-label')).not.toContain('dark');
      settings.closeSettings();
    });

    test('are drawn again in the new theme when the mode changes', async () => {
      await openBackgroundSwatches();
      mockUiUtils.getBackgroundWindowColor.mockClear();
      document.querySelector('#theme-mode-control [data-theme-mode="light"]').click();
      expect(mockUiUtils.getBackgroundWindowColor).toHaveBeenCalled();
      settings.closeSettings();
    });
  });

  describe('Config Save Flow', () => {
    test('saving without moving the opacity slider keeps the stored opacity', async () => {
      state.CONFIG.opacity = 0.95;
      const consoleError = jest.spyOn(console, 'error').mockImplementation(() => {});
      await settings.openSettings();
      expect(consoleError).not.toHaveBeenCalled();
      consoleError.mockRestore();
      expect(document.getElementById('opacity-slider').value).toBe('90');

      await settings.saveSettings();
      expect(state.CONFIG.opacity).toBe(0.95);
      await settings.saveSettings();
      expect(state.CONFIG.opacity).toBe(0.95);

      document.getElementById('opacity-slider').value = '91';
      await settings.saveSettings();
      expect(state.CONFIG.opacity).toBeCloseTo(0.9545, 4);
    });

    test('the opacity readout is a percentage of the opacity, not the slider position', async () => {
      state.CONFIG.opacity = 0.95;
      await settings.openSettings();
      const readout = document.getElementById('opacity-value');
      // Position 90 stands for the stored 95%, and the ends of the slider for 50% and 100%.
      expect(readout.textContent).toBe('95%');

      const slider = document.getElementById('opacity-slider');
      slider.value = '1';
      settings.updateOpacityReadout();
      expect(readout.textContent).toBe('50%');
      slider.value = '100';
      settings.updateOpacityReadout();
      expect(readout.textContent).toBe('100%');
      settings.closeSettings();
    });

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
            enableInteractionDebugLogs: false,
          }),
        })
      );
    });

    test('loads and saves beta update opt-in from update settings', async () => {
      state.CONFIG.updates = { allowPrerelease: true };
      await settings.openSettings();

      const prereleaseToggle = document.getElementById('allow-prerelease-updates');
      expect(prereleaseToggle).toBeTruthy();
      expect(prereleaseToggle.checked).toBe(true);

      prereleaseToggle.checked = false;
      await settings.saveSettings();

      expect(state.CONFIG.updates.allowPrerelease).toBe(false);
      expect(window.electronAPI.updateConfig).toHaveBeenCalledWith(
        expect.objectContaining({
          updates: expect.objectContaining({
            allowPrerelease: false,
          }),
        })
      );
    });

    test('migrates the legacy 24-hour preference and saves explicit time and date formats', async () => {
      state.CONFIG.ui.use24HourClock = true;
      await settings.openSettings();

      const timeFormat = document.getElementById('time-format');
      const dateFormat = document.getElementById('date-format');
      expect(timeFormat).toBeTruthy();
      expect(timeFormat.value).toBe('24-hour');
      expect(dateFormat.value).toBe('weekday-short');

      timeFormat.value = '12-hour';
      dateFormat.value = 'long';
      await settings.saveSettings();

      expect(state.CONFIG.ui.use24HourClock).toBe(false);
      expect(state.CONFIG.ui.timeFormat).toBe('12-hour');
      expect(state.CONFIG.ui.dateFormat).toBe('long');
      expect(window.electronAPI.updateConfig).toHaveBeenCalledWith(
        expect.objectContaining({
          ui: expect.objectContaining({
            timeFormat: '12-hour',
            dateFormat: 'long',
            use24HourClock: false,
          }),
        })
      );
    });

    test('leaves a profile that never chose 24-hour on the locale default', async () => {
      // `false` was the shipped default, not a preference: before time formats were
      // configurable it meant "no hour12 option", i.e. whatever the locale does. Migrating
      // it to '12-hour' would flip 14:30 to 2:30 PM for every user on a 24-hour locale.
      state.CONFIG.ui.use24HourClock = false;
      await settings.openSettings();

      expect(document.getElementById('time-format').value).toBe('system');
    });

    test('downloadable languages stay disabled in the selector until installed', async () => {
      window.electronAPI.getLocalePacks.mockResolvedValue([
        {
          locale: 'es',
          displayName: 'Español',
          englishName: 'Spanish',
          version: '1.0.0',
          latestVersion: '1.0.0',
          installed: false,
          updateAvailable: false,
        },
        {
          locale: 'fr',
          displayName: 'Français',
          englishName: 'French',
          version: '1.0.0',
          latestVersion: '1.0.0',
          installed: true,
          updateAvailable: false,
        },
      ]);

      await settings.openSettings();
      await waitForLanguagePackRefresh();

      const languageSelect = document.getElementById('language-select');
      const spanishOption = Array.from(languageSelect.options).find(
        (option) => option.value === 'es'
      );
      const frenchOption = Array.from(languageSelect.options).find(
        (option) => option.value === 'fr'
      );

      expect(document.getElementById('language-select-help').textContent).toBe(
        'Download a language pack below to enable it in the selector.'
      );
      expect(spanishOption).toBeTruthy();
      expect(spanishOption.disabled).toBe(true);
      expect(spanishOption.textContent).toContain('Not downloaded');
      expect(frenchOption).toBeTruthy();
      expect(frenchOption.disabled).toBe(false);
      // The pack list says the same thing, in the same words, and marks each name's language.
      const rows = [...document.querySelectorAll('#language-packs-list .language-pack-row')];
      const rowFor = (name) => rows.find((row) => row.textContent.includes(name));
      expect(rowFor('Español').querySelector('.language-pack-meta').textContent).toBe(
        'Not downloaded • v1.0.0'
      );
      expect(rowFor('Français').querySelector('.language-pack-meta').textContent).toContain(
        'Installed'
      );
      expect(rowFor('Español').querySelector('.language-pack-name').lang).toBe('es');
      expect(spanishOption.lang).toBe('es');
      expect(document.body.textContent).not.toContain('Download first');
    });

    test('changing the language selector persists immediately without waiting for Save', async () => {
      state.CONFIG.ui.language = 'fr';
      window.electronAPI.getLocalePacks.mockResolvedValue([
        {
          locale: 'fr',
          displayName: 'Français',
          englishName: 'French',
          version: '1.0.0',
          latestVersion: '1.0.0',
          installed: true,
          updateAvailable: false,
        },
      ]);

      await settings.openSettings();
      await waitForLanguagePackRefresh();

      const languageSelect = document.getElementById('language-select');
      languageSelect.value = 'en';
      languageSelect.dispatchEvent(new Event('change'));

      await Promise.resolve();
      await Promise.resolve();

      expect(window.electronAPI.updateConfig).toHaveBeenCalledWith(
        expect.objectContaining({
          ui: expect.objectContaining({
            language: 'en',
          }),
        })
      );
      expect(state.CONFIG.ui.language).toBe('en');
    });

    test('keeps the language selector usable while saves run one after another', async () => {
      state.CONFIG.ui.language = 'auto';
      window.electronAPI.getLocalePacks.mockResolvedValue([
        { locale: 'fr', displayName: 'Français', version: '1.0.0', installed: true },
      ]);
      await settings.openSettings();
      await waitForLanguagePackRefresh();
      let finishFirstSave;
      window.electronAPI.updateConfig.mockClear();
      window.electronAPI.updateConfig
        .mockImplementationOnce(
          (patch) =>
            new Promise((resolve) => {
              finishFirstSave = () => resolve({ ...state.CONFIG, ui: patch.ui });
            })
        )
        .mockImplementationOnce(async (patch) => ({ ...state.CONFIG, ui: patch.ui }));

      const languageSelect = document.getElementById('language-select');
      languageSelect.focus();
      languageSelect.value = 'en';
      const firstSave = languageSelect.onchange();
      await Promise.resolve();
      expect(languageSelect.disabled).toBe(false);
      expect(document.activeElement).toBe(languageSelect);

      // Two more arrow presses while the first save is still running: only the last one is saved.
      languageSelect.value = 'auto';
      languageSelect.onchange();
      languageSelect.value = 'fr';
      const lastSave = languageSelect.onchange();
      expect(window.electronAPI.updateConfig).toHaveBeenCalledTimes(1);
      finishFirstSave();
      await firstSave;
      await lastSave;

      expect(window.electronAPI.updateConfig).toHaveBeenCalledTimes(2);
      expect(window.electronAPI.updateConfig).toHaveBeenLastCalledWith(
        expect.objectContaining({ ui: expect.objectContaining({ language: 'fr' }) })
      );
      expect(state.CONFIG.ui.language).toBe('fr');
      expect(document.activeElement).toBe(languageSelect);
    });

    test('language pack load failures surface an error while still showing installed packs', async () => {
      const installedPacks = [
        {
          locale: 'fr',
          displayName: 'Français',
          englishName: 'French',
          version: '1.0.0',
          latestVersion: '1.0.0',
          installed: true,
          updateAvailable: false,
        },
      ];
      window.electronAPI.getLocalePacks.mockResolvedValueOnce({
        error: 'manifest_unavailable',
        installedPacks,
      });

      await settings.openSettings();
      await waitForLanguagePackRefresh();

      expect(document.getElementById('language-pack-status').textContent).toBe(
        'Unable to load language packs right now.'
      );
      expect(document.getElementById('language-pack-status').classList.contains('hidden')).toBe(
        false
      );
      expect(document.getElementById('language-packs-list').textContent).toContain('Français');
      expect(document.getElementById('language-packs-list').textContent).toContain('Installed');
      expect(document.querySelector('#language-select option[value="fr"]').disabled).toBe(false);
      expect(document.querySelector('[data-locale-action="remove"]').dataset.locale).toBe('fr');
    });

    test('names the language on every language pack button', async () => {
      window.electronAPI.getLocalePacks.mockResolvedValueOnce([
        { locale: 'fr', displayName: 'Français', version: '1.0.0', installed: false },
        {
          locale: 'es',
          displayName: 'Español',
          version: '1.0.0',
          latestVersion: '1.1.0',
          installed: true,
        },
      ]);
      await settings.openSettings();
      await waitForLanguagePackRefresh();
      const labels = [...document.querySelectorAll('#language-packs-list button')].map((button) =>
        button.getAttribute('aria-label')
      );
      expect(labels).toEqual(['Download Français', 'Update Español', 'Remove Español']);
    });

    test('a failed manifest fetch is distinct from an empty catalog and recovers on reopen', async () => {
      window.electronAPI.getLocalePacks.mockResolvedValueOnce({
        error: 'manifest_unavailable',
        installedPacks: [],
      });
      await settings.openSettings();
      await waitForLanguagePackRefresh();
      const list = document.getElementById('language-packs-list');
      const status = document.getElementById('language-pack-status');
      expect(status.textContent).toBe('Unable to load language packs right now.');
      expect(status.classList.contains('hidden')).toBe(false);
      // The error is shown once, in the status line, not repeated in the list (#94).
      expect(list.textContent).toBe('');

      window.electronAPI.getLocalePacks.mockResolvedValueOnce([]);
      await settings.openSettings();
      await waitForLanguagePackRefresh();
      expect(list.textContent).toBe('No downloadable language packs are currently available.');
      expect(status.classList.contains('hidden')).toBe(true);
      expect(window.electronAPI.getLocalePacks).toHaveBeenLastCalledWith(true);
    });

    test('removal refresh handles an offline catalog without retaining the removed pack', async () => {
      window.electronAPI.getLocalePacks.mockResolvedValueOnce([
        { locale: 'fr', displayName: 'Français', installed: true, version: '1.0.0' },
      ]);
      await settings.openSettings();
      await waitForLanguagePackRefresh();
      const list = document.getElementById('language-packs-list');
      const button = list.querySelector('[data-locale-action="remove"]');
      window.electronAPI.getLocalePacks.mockResolvedValueOnce({
        error: 'manifest_unavailable',
        installedPacks: [],
      });
      window.electronAPI.getLocalePacks.mockClear();
      await list.onclick({ target: button });
      expect(window.electronAPI.removeLocalePack).toHaveBeenCalledWith('fr');
      expect(window.electronAPI.getLocalePacks).toHaveBeenCalledTimes(1);
      expect(document.getElementById('language-pack-status').textContent).toBe(
        'Unable to load language packs right now.'
      );
      expect(list.textContent).toBe('');
      expect(list.querySelector('[data-locale-action="remove"]')).toBeNull();
    });

    test.each(['resolve', 'reject'])(
      'ignores an older failed refresh after retry succeeds: %s',
      async (outcome) => {
        let resolveOld;
        let rejectOld;
        window.electronAPI.getLocalePacks.mockReturnValueOnce(
          new Promise((resolve, reject) => {
            resolveOld = resolve;
            rejectOld = reject;
          })
        );
        await settings.openSettings();
        const oldRefresh = settings.waitForLanguagePackRefresh();
        window.electronAPI.getLocalePacks.mockResolvedValueOnce([
          { locale: 'fr', displayName: 'Français', installed: true, version: '1.0.0' },
        ]);
        await settings.openSettings();
        await waitForLanguagePackRefresh();
        if (outcome === 'resolve') {
          resolveOld({ error: 'manifest_unavailable', installedPacks: [] });
        } else {
          rejectOld(new Error('IPC timeout'));
        }
        await oldRefresh;
        expect(document.getElementById('language-packs-list').textContent).toContain('Français');
        expect(document.getElementById('language-pack-status').classList.contains('hidden')).toBe(
          true
        );
      }
    );

    test('an older catalog cannot restore a removed language after a newer offline refresh', async () => {
      let resolveOld;
      window.electronAPI.getLocalePacks.mockReturnValueOnce(
        new Promise((resolve) => {
          resolveOld = resolve;
        })
      );
      await settings.openSettings();
      const oldRefresh = settings.waitForLanguagePackRefresh();
      window.electronAPI.getLocalePacks.mockResolvedValueOnce({
        error: 'manifest_unavailable',
        installedPacks: [],
      });
      await settings.openSettings();
      await waitForLanguagePackRefresh();
      resolveOld([{ locale: 'fr', displayName: 'Français', installed: true, version: '1.0.0' }]);
      await oldRefresh;
      expect(document.getElementById('language-pack-status').textContent).toBe(
        'Unable to load language packs right now.'
      );
      expect(document.getElementById('language-packs-list').textContent).toBe('');
      expect(document.querySelector('#language-select option[value="fr"]')).toBeNull();
    });

    describe('language pack actions', () => {
      const { setLocaleBootstrap } = require('../../src/i18n.js');
      const frenchPack = (installed) => ({
        locale: 'fr',
        displayName: 'Français',
        englishName: 'French',
        version: '1.0.0',
        latestVersion: '1.0.0',
        installed,
        updateAvailable: false,
      });
      const spanishPack = { ...frenchPack(true), locale: 'es', displayName: 'Español' };
      const openWithLocaleHooks = async () => {
        const hooks = {
          initUpdateUI: jest.fn(),
          // Mirrors the renderer: reload the bootstrap, which falls back to English once the
          // selected pack is gone.
          refreshLocale: jest.fn(async () => {
            setLocaleBootstrap({ activeLocale: 'en', requestedLocale: 'fr', messages: {} });
          }),
        };
        await settings.openSettings(hooks);
        await waitForLanguagePackRefresh();
        return hooks;
      };

      afterEach(() => {
        setLocaleBootstrap({ activeLocale: 'en', requestedLocale: 'en', messages: {} });
      });

      test('removing the language in use falls back to English immediately', async () => {
        state.CONFIG.ui.language = 'fr';
        setLocaleBootstrap({ activeLocale: 'fr', requestedLocale: 'fr', messages: {} });
        window.electronAPI.getLocalePacks.mockResolvedValueOnce([frenchPack(true)]);
        const hooks = await openWithLocaleHooks();

        const list = document.getElementById('language-packs-list');
        window.electronAPI.getLocalePacks.mockResolvedValueOnce([frenchPack(false)]);
        await list.onclick({ target: list.querySelector('[data-locale-action="remove"]') });

        expect(hooks.refreshLocale).toHaveBeenCalledTimes(1);
        // Same state as a restart without the pack: English, the selection kept, and the notice.
        expect(document.getElementById('language-select').value).toBe('fr');
        expect(
          document.getElementById('language-fallback-summary').classList.contains('hidden')
        ).toBe(false);
      });

      test('removing a language that is not in use leaves the interface alone', async () => {
        setLocaleBootstrap({ activeLocale: 'fr', requestedLocale: 'fr', messages: {} });
        window.electronAPI.getLocalePacks.mockResolvedValueOnce([frenchPack(true), spanishPack]);
        const hooks = await openWithLocaleHooks();

        const list = document.getElementById('language-packs-list');
        await list.onclick({ target: list.querySelector('[data-locale="es"]') });

        expect(window.electronAPI.removeLocalePack).toHaveBeenCalledWith('es');
        expect(hooks.refreshLocale).not.toHaveBeenCalled();
      });

      test.each([
        ['download', false, 'remove'],
        ['remove', true, 'download'],
      ])(
        'keeps keyboard focus on the row after %s',
        async (action, installedBefore, nextAction) => {
          window.electronAPI.getLocalePacks.mockResolvedValueOnce([
            spanishPack,
            frenchPack(installedBefore),
          ]);
          await openWithLocaleHooks();
          const list = document.getElementById('language-packs-list');
          const button = list.querySelector(`[data-locale="fr"][data-locale-action="${action}"]`);
          button.focus();

          window.electronAPI.getLocalePacks.mockResolvedValueOnce([
            spanishPack,
            frenchPack(!installedBefore),
          ]);
          await list.onclick({ target: button });

          expect(button.isConnected).toBe(false);
          expect(document.activeElement.dataset.locale).toBe('fr');
          expect(document.activeElement.dataset.localeAction).toBe(nextAction);
        }
      );
    });

    test('an IPC rejection still displays a language pack error', async () => {
      window.electronAPI.getLocalePacks.mockRejectedValueOnce(new Error('IPC failed'));
      await settings.openSettings();
      await waitForLanguagePackRefresh();
      expect(document.getElementById('language-pack-status').textContent).toBe(
        'Unable to load language packs right now.'
      );
      expect(document.getElementById('language-packs-list').textContent).toBe('');
    });

    test('Start at login is written only when a supported checkbox changed', async () => {
      await settings.openSettings();
      await settings.saveSettings();
      expect(window.electronAPI.setLoginItemSettings).not.toHaveBeenCalled();

      await settings.openSettings();
      document.getElementById('start-with-windows').checked = true;
      await settings.saveSettings();
      expect(window.electronAPI.setLoginItemSettings).toHaveBeenCalledWith(true);
    });

    test('an isolated profile saves without touching or warning about Start at login', async () => {
      // What main reports for --user-data-dir / --isolated-profile runs.
      window.electronAPI.getLoginItemSettings.mockResolvedValueOnce({
        openAtLogin: false,
        supported: false,
      });
      await settings.openSettings();
      expect(document.getElementById('start-with-windows').disabled).toBe(true);

      await settings.saveSettings();

      expect(window.electronAPI.setLoginItemSettings).not.toHaveBeenCalled();
      expect(mockUiUtils.showToast).not.toHaveBeenCalledWith(
        'Failed to update Start at login setting',
        expect.anything(),
        expect.anything()
      );
    });

    test.each([
      [null, true],
      [{ accent: '#ff0000' }, false],
    ])(
      'Follow Omarchy theme is only offered where Omarchy is detected (%p)',
      async (desktopAppearance, hidden) => {
        document
          .querySelector('#settings-modal .modal-content')
          .insertAdjacentHTML(
            'afterbegin',
            '<div id="follow-omarchy-group"><input id="follow-omarchy" type="checkbox" /></div>'
          );
        state.CONFIG.desktopAppearance = desktopAppearance;
        await settings.openSettings();
        expect(document.getElementById('follow-omarchy-group').classList.contains('hidden')).toBe(
          hidden
        );
        expect(document.getElementById('follow-omarchy').disabled).toBe(hidden);
      }
    );

    test('saving unrelated settings preserves the placeholder token when the token field is blank', async () => {
      state.CONFIG.homeAssistant.token = 'YOUR_LONG_LIVED_ACCESS_TOKEN';
      state.CONFIG.tokenResetReason = 'decryption_failed';

      await settings.openSettings();

      expect(document.getElementById('ha-token').value).toBe('');

      document.getElementById('always-on-top').checked = false;
      await settings.saveSettings();

      expect(state.CONFIG.homeAssistant.token).toBe('YOUR_LONG_LIVED_ACCESS_TOKEN');
      expect(state.CONFIG.tokenResetReason).toBe('decryption_failed');
      expect(window.electronAPI.updateConfig).toHaveBeenCalledWith(
        expect.objectContaining({
          homeAssistant: expect.objectContaining({
            token: 'YOUR_LONG_LIVED_ACCESS_TOKEN',
          }),
        })
      );
    });

    test('entering a replacement token clears tokenResetReason during save', async () => {
      state.CONFIG.homeAssistant.token = 'YOUR_LONG_LIVED_ACCESS_TOKEN';
      state.CONFIG.tokenResetReason = 'decryption_failed';

      await settings.openSettings();

      document.getElementById('ha-token').value = 'replacement-token-789';
      await settings.saveSettings();

      expect(state.CONFIG.homeAssistant.token).toBe('replacement-token-789');
      expect(state.CONFIG.tokenResetReason).toBeUndefined();
      expect(window.electronAPI.updateConfig).toHaveBeenCalledWith(
        expect.objectContaining({
          homeAssistant: expect.objectContaining({
            token: 'replacement-token-789',
          }),
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

    test('late validation failure leaves live config and OS settings unchanged', async () => {
      await settings.openSettings();

      const originalConfig = JSON.parse(JSON.stringify(state.CONFIG));
      document.getElementById('ha-url').value = 'https://new-ha.example.com';
      document.getElementById('always-on-top').checked = false;
      document.getElementById('hide-on-blur').checked = true;
      document.getElementById('start-with-windows').checked = true;
      document.getElementById('profile-sync-enabled').checked = true;
      document.getElementById('profile-sync-folder-path').value = '';

      await settings.saveSettings();

      expect(state.CONFIG).toEqual(originalConfig);
      expect(window.electronAPI.updateConfig).not.toHaveBeenCalled();
      expect(window.electronAPI.setLoginItemSettings).not.toHaveBeenCalled();
      expect(window.electronAPI.setOpacity).not.toHaveBeenCalled();
      expect(mockUiUtils.showToast).toHaveBeenCalledWith(
        'Choose a sync folder before enabling profile sync.',
        'error',
        3200
      );
    });

    test('persistence failure does not publish the staged config or apply side effects', async () => {
      await settings.openSettings();

      const originalConfig = JSON.parse(JSON.stringify(state.CONFIG));
      document.getElementById('ha-url').value = 'https://new-ha.example.com';
      document.getElementById('always-on-top').checked = false;
      document.getElementById('hide-on-blur').checked = true;
      document.getElementById('start-with-windows').checked = true;
      window.electronAPI.updateConfig.mockRejectedValueOnce(new Error('disk unavailable'));

      await settings.saveSettings();

      expect(state.CONFIG).toEqual(originalConfig);
      expect(window.electronAPI.setLoginItemSettings).not.toHaveBeenCalled();
      expect(window.electronAPI.setOpacity).not.toHaveBeenCalled();
      expect(mockUiUtils.showToast).toHaveBeenCalledWith(
        'Settings could not be saved. No configuration changes were applied.',
        'error',
        4000
      );
      expect(document.getElementById('settings-modal').classList.contains('hidden')).toBe(false);
    });

    test('opacity conversion and application', async () => {
      await openSettingsWithCustomIconsExpanded();

      // Set opacity slider to specific values and verify conversion
      const testCases = [
        { slider: 1, expected: 0.5 }, // Minimum
        { slider: 50, expected: 0.747 }, // Middle
        { slider: 100, expected: 1.0 }, // Maximum
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

    test('disables weather effects control and warning when frosted glass is off', async () => {
      state.CONFIG.frostedGlass = false;
      state.CONFIG.ui.weatherEffectsEnabled = true;

      await settings.openSettings();

      const weatherEffects = document.getElementById('weather-effects-enabled');
      const warning = document.getElementById('weather-effects-warning');
      expect(weatherEffects.checked).toBe(false);
      expect(weatherEffects.disabled).toBe(true);
      expect(warning.classList.contains('hidden')).toBe(false);
      expect(warning.textContent).toContain('Frosted glass');
    });

    test('does not save weather effects enabled unless frosted glass is enabled', async () => {
      await settings.openSettings();

      document.getElementById('frosted-glass').checked = false;
      document.getElementById('weather-effects-enabled').checked = true;

      await settings.saveSettings();

      expect(state.CONFIG.frostedGlass).toBe(false);
      expect(state.CONFIG.ui.weatherEffectsEnabled).toBe(false);
    });

    test('allows weather effects when frosted glass is enabled', async () => {
      state.CONFIG.frostedGlass = true;

      await settings.openSettings();

      document.getElementById('frosted-glass').checked = true;
      document.getElementById('weather-effects-enabled').checked = true;

      await settings.saveSettings();

      expect(state.CONFIG.frostedGlass).toBe(true);
      expect(state.CONFIG.ui.weatherEffectsEnabled).toBe(true);
    });
  });

  describe('Frosted glass on Windows without acrylic', () => {
    const unavailable = { nativeGlassSupported: false };

    beforeEach(() => {
      state.CONFIG.desktopCapabilities = unavailable;
      state.CONFIG.frostedGlass = true;
      state.CONFIG.ui.weatherEffectsEnabled = true;
    });

    test('shows the control off and locked with the reason', async () => {
      await settings.openSettings();

      expect(mockUiUtils.isFrostedGlassAvailable).toHaveBeenCalledWith(state.CONFIG);

      const frostedGlass = document.getElementById('frosted-glass');
      const warning = document.getElementById('frosted-glass-warning');
      expect(frostedGlass.checked).toBe(false);
      expect(frostedGlass.disabled).toBe(true);
      expect(frostedGlass.title).toBe('Needs Windows 11 version 22H2 or later.');
      expect(warning.classList.contains('hidden')).toBe(false);
      expect(warning.textContent).toBe('Needs Windows 11 version 22H2 or later.');
    });

    test('explains weather effects with the same reason rather than asking for glass', async () => {
      await settings.openSettings();

      const weatherEffects = document.getElementById('weather-effects-enabled');
      const warning = document.getElementById('weather-effects-warning');
      expect(weatherEffects.checked).toBe(false);
      expect(weatherEffects.disabled).toBe(true);
      expect(warning.classList.contains('hidden')).toBe(false);
      expect(warning.textContent).toBe('Needs Windows 11 version 22H2 or later.');
    });

    test('keeps the saved choices when Settings is saved, so an upgrade brings them back', async () => {
      await settings.openSettings();

      await settings.saveSettings();

      expect(state.CONFIG.frostedGlass).toBe(true);
      expect(state.CONFIG.ui.weatherEffectsEnabled).toBe(true);
    });

    test('previews and restores effects with the capabilities, so the solid panel is drawn', async () => {
      await settings.openSettings();
      mockUiUtils.applyWindowEffects.mockClear();

      settings.previewWindowEffects();
      await new Promise((resolve) => setTimeout(resolve, 50));

      expect(mockUiUtils.applyWindowEffects).toHaveBeenCalledWith(
        expect.objectContaining({ frostedGlass: false, desktopCapabilities: unavailable })
      );

      mockUiUtils.applyWindowEffects.mockClear();
      settings.closeSettings();

      expect(mockUiUtils.applyWindowEffects).toHaveBeenCalledWith(
        expect.objectContaining({ frostedGlass: true, desktopCapabilities: unavailable })
      );
    });

    test('leaves the control usable where the window can draw frosted glass', async () => {
      state.CONFIG.desktopCapabilities = { nativeGlassSupported: true };

      await settings.openSettings();

      const frostedGlass = document.getElementById('frosted-glass');
      expect(frostedGlass.checked).toBe(true);
      expect(frostedGlass.disabled).toBe(false);
      expect(frostedGlass.title).toBe('');
      expect(document.getElementById('frosted-glass-warning').classList.contains('hidden')).toBe(
        true
      );
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
      const refreshedApplyBtn = document.querySelector(
        '[data-custom-icon-apply="light.living_room"]'
      );
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

    test('should show the first icons and ask for a query to narrow the rest', async () => {
      // Arrange
      await openSettingsWithCustomIconsExpanded();
      const chooseBtn = document.querySelector(
        '[data-custom-icon-picker-toggle="light.living_room"]'
      );
      expect(chooseBtn).toBeTruthy();

      // Act
      chooseBtn.click();

      // Assert: nearly four thousand buttons are slow to build and a mile to scroll
      const picker = document.querySelector('[data-custom-icon-picker="light.living_room"]');
      const allChoices = picker.querySelectorAll('.custom-entity-icon-choice');
      expect(allChoices).toHaveLength(120);
      const summary = picker.querySelector('.custom-entity-icon-picker-meta');
      expect(summary.textContent).toMatch(
        /^Showing the first 120 of 3\d{3} icons\. Type to narrow them\.$/
      );
      // The count is announced as it narrows.
      expect(summary.getAttribute('aria-live')).toBe('polite');
    });

    test('should make the icon grid one Tab stop that the arrow keys move through', async () => {
      await openSettingsWithCustomIconsExpanded();
      document.querySelector('[data-custom-icon-picker-toggle="light.living_room"]').click();
      const grid = document.querySelector('.custom-entity-icon-picker-grid');
      const choices = [...grid.querySelectorAll('.custom-entity-icon-choice')];
      const press = (target, key) => {
        const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true });
        target.dispatchEvent(event);
        return event;
      };

      // A listbox needs option children; these are buttons in a group.
      expect(grid.getAttribute('role')).toBe('group');
      expect(choices.filter((choice) => choice.tabIndex === 0)).toEqual([choices[0]]);

      choices[0].focus();
      expect(press(choices[0], 'ArrowRight').defaultPrevented).toBe(true);
      expect(document.activeElement).toBe(choices[1]);
      expect(choices.filter((choice) => choice.tabIndex === 0)).toEqual([choices[1]]);
      press(choices[1], 'End');
      expect(document.activeElement).toBe(choices.at(-1));
      press(choices.at(-1), 'Home');
      expect(document.activeElement).toBe(choices[0]);
      press(choices[0], 'ArrowLeft');
      expect(document.activeElement).toBe(choices[0]);
    });

    test('should not open the picker just because its field was focused', async () => {
      // Arrange
      await openSettingsWithCustomIconsExpanded();
      const iconInput = document.querySelector('[data-custom-icon-input="light.living_room"]');
      expect(iconInput).toBeTruthy();

      // Act: tabbing down the list used to open a four-thousand-button grid on every row
      iconInput.focus();
      iconInput.dispatchEvent(new Event('focusin', { bubbles: true }));

      // Assert
      expect(document.querySelector('[data-custom-icon-picker="light.living_room"]')).toBeNull();
    });

    test('should open the picker when a query is typed, and close it with Escape without leaving Settings', async () => {
      // Arrange
      await openSettingsWithCustomIconsExpanded();
      const iconInput = document.querySelector('[data-custom-icon-input="light.living_room"]');
      iconInput.focus();
      iconInput.value = 'star';
      iconInput.dispatchEvent(new Event('input', { bubbles: true }));
      expect(document.querySelector('[data-custom-icon-picker="light.living_room"]')).toBeTruthy();
      const pageEscape = jest.fn();
      document.addEventListener('keydown', pageEscape);

      // Act
      const escape = new KeyboardEvent('keydown', {
        key: 'Escape',
        bubbles: true,
        cancelable: true,
      });
      document.querySelector('[data-custom-icon-input="light.living_room"]').dispatchEvent(escape);

      // Assert: the grid closes, Settings and its unsaved edits stay, focus stays in the field
      expect(escape.defaultPrevented).toBe(true);
      expect(pageEscape).not.toHaveBeenCalled();
      document.removeEventListener('keydown', pageEscape);
      expect(document.querySelector('[data-custom-icon-picker="light.living_room"]')).toBeNull();
      expect(document.getElementById('settings-modal').classList.contains('hidden')).toBe(false);
      expect(document.activeElement).toBe(
        document.querySelector('[data-custom-icon-input="light.living_room"]')
      );
    });

    test('should close picker when focus leaves the icon input row', async () => {
      // Arrange
      await openSettingsWithCustomIconsExpanded();
      const iconInput = document.querySelector('[data-custom-icon-input="light.living_room"]');
      const saveBtn = document.getElementById('save-settings');
      expect(iconInput).toBeTruthy();
      expect(saveBtn).toBeTruthy();
      document.querySelector('[data-custom-icon-picker-toggle="light.living_room"]').click();
      expect(document.querySelector('[data-custom-icon-picker="light.living_room"]')).toBeTruthy();

      jest.useFakeTimers();
      try {
        // Act
        document
          .querySelector('[data-custom-icon-input="light.living_room"]')
          .dispatchEvent(new Event('focusout', { bubbles: true }));
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
      const iconChoiceBtn = document.querySelector(
        '[data-custom-icon-choice="⏲️"][data-custom-icon-choice-entity="light.living_room"]'
      );
      expect(iconChoiceBtn).toBeTruthy();
      iconChoiceBtn.click();

      // Assert
      const refreshedApplyBtn = document.querySelector(
        '[data-custom-icon-apply="light.living_room"]'
      );
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
      const treeChoice = document.querySelector(
        '[data-custom-icon-choice="🌲"][data-custom-icon-choice-entity="light.living_room"]'
      );
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
      const ratChoice = document.querySelector(
        '[data-custom-icon-choice="🐀"][data-custom-icon-choice-entity="light.living_room"]'
      );
      expect(ratChoice).toBeTruthy();
      const ratSummary = document.querySelector(
        '[data-custom-icon-picker="light.living_room"] .custom-entity-icon-picker-meta'
      );
      expect(ratSummary).toBeTruthy();
      expect(ratSummary.textContent).toMatch(/Showing \d+ of \d+ icons for "rat"\./);
      const [, ratShown, ratTotal] =
        ratSummary.textContent.match(/Showing (\d+) of (\d+) icons for "rat"\./) || [];
      expect(Number(ratShown)).toBeLessThan(Number(ratTotal));

      // Act
      iconInput.value = 'mouse';
      iconInput.dispatchEvent(new Event('input', { bubbles: true }));

      // Assert
      const mouseChoice = document.querySelector(
        '[data-custom-icon-choice="🐭"][data-custom-icon-choice-entity="light.living_room"]'
      );
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
      const mouseChoice = document.querySelector(
        '[data-custom-icon-choice="🐭"][data-custom-icon-choice-entity="light.living_room"]'
      );
      expect(mouseChoice).toBeTruthy();
    });

    test('should allow choosing icons from picker instead of manual typing', async () => {
      // Arrange
      await openSettingsWithCustomIconsExpanded();
      const chooseBtn = document.querySelector(
        '[data-custom-icon-picker-toggle="light.living_room"]'
      );
      expect(chooseBtn).toBeTruthy();

      // Act
      chooseBtn.click();
      const iconInput = document.querySelector('[data-custom-icon-input="light.living_room"]');
      iconInput.value = 'star';
      iconInput.dispatchEvent(new Event('input', { bubbles: true }));
      const iconChoiceBtn = document.querySelector(
        '[data-custom-icon-choice="⭐"][data-custom-icon-choice-entity="light.living_room"]'
      );
      expect(iconChoiceBtn).toBeTruthy();
      iconChoiceBtn.click();

      // Assert
      const refreshedApplyBtn = document.querySelector(
        '[data-custom-icon-apply="light.living_room"]'
      );
      const row = refreshedApplyBtn.closest('.custom-entity-icon-item');
      const preview = row.querySelector('.custom-entity-icon-preview');
      expect(preview.textContent).toBe('⭐');
      expect(state.CONFIG.customEntityIcons).toEqual({});
      // The grid closed with the choice, and the keyboard goes on from the row's field.
      expect(document.activeElement).toBe(
        document.querySelector('[data-custom-icon-input="light.living_room"]')
      );
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
      const refreshedApplyBtn = document.querySelector(
        '[data-custom-icon-apply="light.living_room"]'
      );
      const row = refreshedApplyBtn.closest('.custom-entity-icon-item');
      const preview = row.querySelector('.custom-entity-icon-preview');
      // No custom icon was applied, so the preview shows the tile's default line icon.
      expect(preview.textContent).toBe('');
      expect(preview.querySelector('svg.entity-line-icon').dataset.icon).toBe('lightbulb');
    });

    test('saving Settings preserves icons restored from dashboard history', async () => {
      const { rememberDashboard } = require('../../src/dashboard-history.js');
      const { showDashboardHistory } = require('../../src/dashboard-tools.js');
      localStorage.clear();
      state.CONFIG.customEntityIcons = { 'light.living_room': '🔥' };
      const restoredIcons = { 'light.living_room': '⭐' };
      rememberDashboard({ ...state.CONFIG, customEntityIcons: restoredIcons }, state.CONFIG);
      await openSettingsWithCustomIconsExpanded();
      mockUI.restoreDashboard.mockImplementationOnce(async (layout) => {
        state.setConfig({ ...state.CONFIG, ...layout });
      });
      showDashboardHistory();
      await document.querySelector('.dashboard-restore-entry').onclick();
      expect(document.querySelector('[data-custom-icon-input="light.living_room"]').value).toBe(
        '⭐'
      );
      await settings.saveSettings();
      expect(state.CONFIG.customEntityIcons).toEqual(restoredIcons);
      localStorage.clear();
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
          'light.living_room': '🔥',
        })
      );
      expect(window.electronAPI.updateConfig).toHaveBeenCalledWith(
        expect.objectContaining({
          customEntityIcons: expect.objectContaining({
            'light.living_room': '🔥',
          }),
        })
      );
      expect(mockUI.renderActiveTab).toHaveBeenCalled();
    });

    test('should support per-entity reset and reset-all actions', async () => {
      // Arrange
      state.CONFIG.customEntityIcons = {
        'light.living_room': '🔥',
        'switch.bedroom': '⚡',
      };
      await openSettingsWithCustomIconsExpanded();
      const resetSingleBtn = document.querySelector('[data-custom-icon-reset="light.living_room"]');
      const resetAllBtn = document.getElementById('custom-entity-icons-reset-all');
      expect(resetSingleBtn).toBeTruthy();
      expect(resetAllBtn).toBeTruthy();

      // Act
      resetSingleBtn.click();

      // Assert
      const roomInputAfterReset = document.querySelector(
        '[data-custom-icon-input="light.living_room"]'
      );
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
    describe('in Arabic', () => {
      const i18n = require('../../src/i18n.js');
      const ARABIC = {
        'Accent: {{accent}} • Background: {{background}}':
          'التمييز: {{accent}} • الخلفية: {{background}}',
        'Custom {{color}}': '{{color}} مخصص',
      };

      afterEach(() => {
        i18n.setLocaleBootstrap({ activeLocale: 'en', messages: {} });
      });

      const openWithCustomAccent = async (name) => {
        state.CONFIG.ui.customColors = [
          { id: 'custom-ab34cd', name, color: '#AB34CD', createdAt: 'x', updatedAt: 'x' },
        ];
        state.CONFIG.ui.accent = 'custom-ab34cd';
        await settings.openSettings();
      };

      test('keeps the hex code of a custom colour in one piece in the summary line', async () => {
        i18n.setLocaleBootstrap({ activeLocale: 'ar', messages: ARABIC });
        await openWithCustomAccent('#AB34CD مخصص');

        // Between an Arabic word and Latin letters a lone '#' would land on the wrong side.
        expect(document.getElementById('theme-current-selection').textContent).toContain(
          '\u2066#AB34CD\u2069 مخصص'
        );
      });

      test('does not change the name itself, which the rename field shows and compares', async () => {
        i18n.setLocaleBootstrap({ activeLocale: 'ar', messages: ARABIC });
        await openWithCustomAccent('#AB34CD مخصص');

        const option = document.querySelector('.color-theme-option[data-theme="custom-ab34cd"]');
        expect(option.getAttribute('aria-label')).toContain('\u2066#AB34CD\u2069');
        expect(document.getElementById('custom-color-name-input').value).not.toMatch(
          /[\u2066\u2069]/
        );
      });

      test('leaves a name the person typed alone', async () => {
        i18n.setLocaleBootstrap({ activeLocale: 'ar', messages: ARABIC });
        await openWithCustomAccent('Ocean');

        expect(document.getElementById('theme-current-selection').textContent).toContain('Ocean');
        expect(document.getElementById('theme-current-selection').textContent).not.toMatch(
          /[\u2066\u2069]/
        );
      });

      test('adds nothing in a left-to-right language', async () => {
        await openWithCustomAccent('Custom #AB34CD');

        expect(document.getElementById('theme-current-selection').textContent).toContain(
          'Custom #AB34CD'
        );
        expect(document.getElementById('theme-current-selection').textContent).not.toMatch(
          /[\u2066\u2069]/
        );
      });
    });

    test('should open with saved custom colors appended after built-ins', async () => {
      // Arrange
      state.CONFIG.ui.customColors = [
        {
          id: 'custom-ocean',
          name: 'Ocean',
          color: '#336699',
          createdAt: '2026-01-01T00:00:00.000Z',
          updatedAt: '2026-01-01T00:00:00.000Z',
        },
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

    test('should keep a channel value as typed and carry it into the hex field and preview', async () => {
      // Arrange
      await settings.openSettings();
      const redInput = document.getElementById('custom-color-r');
      const hexInput = document.getElementById('custom-color-hex');
      const blueInput = document.getElementById('custom-color-b');
      hexInput.value = '#64B5F6';
      hexInput.dispatchEvent(new Event('input', { bubbles: true }));

      // Act
      redInput.focus();
      redInput.value = '200';
      redInput.dispatchEvent(new Event('input', { bubbles: true }));

      // Assert
      expect(redInput.value).toBe('200');
      expect(hexInput.value).toBe('#C8B5F6');
      expect(document.getElementById('custom-color-picker').value).toBe('#c8b5f6');
      expect(blueInput.value).toBe('246');
      expect(mockUiUtils.applyAccentThemeFromColor).toHaveBeenLastCalledWith('#C8B5F6');
    });

    test('should clamp a channel above 255 when it loses focus', async () => {
      // Arrange
      await settings.openSettings();
      const greenInput = document.getElementById('custom-color-g');
      const hexInput = document.getElementById('custom-color-hex');
      hexInput.value = '#112233';
      hexInput.dispatchEvent(new Event('input', { bubbles: true }));

      // Act
      greenInput.focus();
      greenInput.value = '999';
      greenInput.dispatchEvent(new Event('input', { bubbles: true }));
      greenInput.blur();

      // Assert
      expect(greenInput.value).toBe('255');
      expect(hexInput.value).toBe('#11FF33');
    });

    test('should accept a 6-digit hex typed one key at a time', async () => {
      // Arrange
      await settings.openSettings();
      const hexInput = document.getElementById('custom-color-hex');
      hexInput.focus();
      hexInput.value = '';

      // Act: a user appends each key to whatever the field currently holds.
      for (const key of '#1E88E5') {
        hexInput.value += key;
        hexInput.dispatchEvent(new Event('input', { bubbles: true }));
      }

      // Assert
      expect(hexInput.value).toBe('#1E88E5');
      expect(document.getElementById('custom-color-r').value).toBe('30');
      expect(mockUiUtils.applyAccentThemeFromColor).toHaveBeenLastCalledWith('#1E88E5');
      expect(mockUiUtils.applyAccentThemeFromColor).not.toHaveBeenCalledWith('#11EE88');
    });

    test('should expand a 3-digit hex shorthand and preview it when the field loses focus', async () => {
      // Arrange
      await settings.openSettings();
      const hexInput = document.getElementById('custom-color-hex');
      hexInput.focus();

      // Act
      hexInput.value = '#1e8';
      hexInput.dispatchEvent(new Event('input', { bubbles: true }));
      expect(mockUiUtils.applyAccentThemeFromColor).not.toHaveBeenCalled();
      hexInput.blur();

      // Assert
      expect(hexInput.value).toBe('#11EE88');
      expect(mockUiUtils.applyAccentThemeFromColor).toHaveBeenCalledWith('#11EE88');
    });

    test('should not count tabbing through the hex field as a colour edit', async () => {
      // Arrange
      await settings.openSettings();
      const hexInput = document.getElementById('custom-color-hex');

      // Act
      hexInput.focus();
      hexInput.blur();

      // Assert
      expect(mockUiUtils.applyAccentThemeFromColor).not.toHaveBeenCalled();
    });

    test('should flag an invalid hex and refuse to save the previous colour instead', async () => {
      // Arrange
      await settings.openSettings();
      const hexInput = document.getElementById('custom-color-hex');
      const hexError = document.getElementById('custom-color-hex-error');
      const saveCustomBtn = document.getElementById('save-custom-color-btn');
      mockUiUtils.showToast.mockClear();

      // Act: clicking Save moves focus off the hex field first, then clicks.
      hexInput.focus();
      hexInput.value = '#12ab9z';
      hexInput.dispatchEvent(new Event('input', { bubbles: true }));
      saveCustomBtn.focus();
      saveCustomBtn.click();

      // Assert
      expect(hexInput.value).toBe('#12ab9z');
      expect(hexInput.getAttribute('aria-invalid')).toBe('true');
      expect(hexError.classList.contains('hidden')).toBe(false);
      expect(document.activeElement).toBe(hexInput);
      expect(
        document.querySelectorAll('.color-theme-option[data-custom-theme="true"]')
      ).toHaveLength(0);
      expect(mockUiUtils.showToast).toHaveBeenCalledWith(
        expect.stringContaining('valid color'),
        'warning',
        expect.any(Number)
      );
      expect(mockUiUtils.showToast).not.toHaveBeenCalledWith(
        expect.stringContaining('Custom color saved'),
        expect.anything(),
        expect.anything()
      );
    });

    test('should clear the invalid hex flag as soon as the field is edited', async () => {
      // Arrange
      await settings.openSettings();
      const hexInput = document.getElementById('custom-color-hex');
      const hexError = document.getElementById('custom-color-hex-error');
      document.getElementById('save-custom-color-btn').click();
      hexInput.value = '#zzz';
      document.getElementById('save-custom-color-btn').click();
      expect(hexInput.getAttribute('aria-invalid')).toBe('true');

      // Act
      hexInput.value = '#12ab9';
      hexInput.dispatchEvent(new Event('input', { bubbles: true }));

      // Assert
      expect(hexInput.hasAttribute('aria-invalid')).toBe(false);
      expect(hexError.classList.contains('hidden')).toBe(true);
    });

    test('should save the custom color when Enter is pressed in the hex field', async () => {
      // Arrange
      await settings.openSettings();
      const hexInput = document.getElementById('custom-color-hex');
      hexInput.focus();
      hexInput.value = '#336699';
      hexInput.dispatchEvent(new Event('input', { bubbles: true }));

      // Act
      hexInput.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));

      // Assert
      expect(
        document.querySelectorAll('.color-theme-option[data-custom-theme="true"]')
      ).toHaveLength(1);
    });

    test('should not save the custom color when Enter commits an IME composition', async () => {
      // Arrange
      await settings.openSettings();
      const hexInput = document.getElementById('custom-color-hex');
      hexInput.focus();
      hexInput.value = '#336699';
      hexInput.dispatchEvent(new Event('input', { bubbles: true }));

      // Act
      const enter = new KeyboardEvent('keydown', {
        key: 'Enter',
        isComposing: true,
        bubbles: true,
        cancelable: true,
      });
      hexInput.dispatchEvent(enter);

      // Assert
      expect(enter.defaultPrevented).toBe(false);
      expect(
        document.querySelectorAll('.color-theme-option[data-custom-theme="true"]')
      ).toHaveLength(0);
    });

    test('should keep main settings save available while custom editor is active', async () => {
      // Arrange
      await settings.openSettings();
      const mainSave = document.getElementById('save-settings');
      const hexInput = document.getElementById('custom-color-hex');

      // Act
      hexInput.focus();
      hexInput.value = '#13579B';
      hexInput.dispatchEvent(new Event('input', { bubbles: true }));

      // Assert: a Save that went disabled when a field took focus swallowed a quick first click.
      // The unsaved colour is dealt with when Save is clicked, by the prompt.
      expect(mainSave.disabled).toBe(false);
      expect(mainSave.hasAttribute('aria-disabled')).toBe(false);
      expect(document.getElementById('custom-editor-save-lock-hint')).toBeNull();
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
      expect(state.CONFIG.ui.customColors[0]).toEqual(
        expect.objectContaining({
          color: '#112233',
          name: 'Custom #112233',
        })
      );
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

      // Assert: three ways out, and the safe one (save the colour) is where focus starts
      expect(mockUiUtils.showConfirm).toHaveBeenCalledWith(
        expect.stringContaining('Unsaved Custom Color Changes'),
        expect.stringContaining('unsaved custom color edits'),
        expect.objectContaining({
          confirmText: 'Save and Continue',
          alternateText: 'Discard color edits',
          cancelText: 'Keep editing',
          confirmFirst: true,
        })
      );
      expect(state.CONFIG.ui.customColors).toEqual(
        expect.arrayContaining([expect.objectContaining({ color: '#13579B' })])
      );
    });

    test('should drop the unsaved custom color draft and save the rest when it is discarded', async () => {
      // Arrange
      mockUiUtils.showConfirm.mockResolvedValueOnce('alternate');
      await settings.openSettings();
      const hexInput = document.getElementById('custom-color-hex');

      // Act
      hexInput.value = '#2468AC';
      hexInput.dispatchEvent(new Event('input', { bubbles: true }));
      await settings.saveSettings();

      // Assert
      expect(mockUiUtils.showConfirm).toHaveBeenCalled();
      expect(state.CONFIG.ui.customColors).toHaveLength(0);
      expect(mockElectronAPI.updateConfig).toHaveBeenCalled();
    });

    test('should keep Settings open with the draft when the prompt is dismissed or cancelled', async () => {
      // Arrange: Escape, a click outside and Cancel all resolve false
      mockUiUtils.showConfirm.mockResolvedValueOnce(false);
      await settings.openSettings();
      const hexInput = document.getElementById('custom-color-hex');
      hexInput.value = '#2468AC';
      hexInput.dispatchEvent(new Event('input', { bubbles: true }));
      mockElectronAPI.updateConfig.mockClear();

      // Act
      await settings.saveSettings();

      // Assert: nothing was saved, the form is still open and the draft is still in the field
      expect(mockUiUtils.showConfirm).toHaveBeenCalled();
      expect(mockElectronAPI.updateConfig).not.toHaveBeenCalled();
      expect(document.getElementById('settings-modal').classList.contains('hidden')).toBe(false);
      expect(hexInput.value).toBe('#2468AC');
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
      const customOptions = document.querySelectorAll(
        '.color-theme-option[data-custom-theme="true"]'
      );
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
      await new Promise((resolve) => setTimeout(resolve, 0));

      // Assert
      expect(mockUiUtils.showConfirm).toHaveBeenLastCalledWith(
        'Remove Custom Color',
        'Remove "My Slate" from your custom colors?',
        expect.objectContaining({ confirmClass: 'btn-danger' })
      );
      const customOptions = document.querySelectorAll(
        '.color-theme-option[data-custom-theme="true"]'
      );
      expect(customOptions).toHaveLength(0);

      const selected = document.querySelector('.color-theme-option.selected');
      expect(selected?.dataset.theme).toBe('original');
    });
  });

  describe('Custom Color removal', () => {
    test('keeps the colour when the confirmation is declined', async () => {
      await settings.openSettings();
      const hexInput = document.getElementById('custom-color-hex');
      hexInput.value = '#778899';
      hexInput.dispatchEvent(new Event('input', { bubbles: true }));
      document.getElementById('save-custom-color-btn').click();

      mockUiUtils.showConfirm.mockResolvedValueOnce(false);
      document.getElementById('remove-custom-color-btn').click();
      await new Promise((resolve) => setTimeout(resolve, 0));

      expect(
        document.querySelectorAll('.color-theme-option[data-custom-theme="true"]')
      ).toHaveLength(1);
      expect(mockUiUtils.showToast).not.toHaveBeenCalledWith(
        'Custom color removed.',
        'success',
        expect.any(Number)
      );
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

      // Pick a media player in the select
      const select = document.getElementById('primary-media-player');
      expect(select.innerHTML).toContain('Spotify'); // Verify the select is populated
      expect(select.options[0].value).toBe('');

      select.value = 'media_player.spotify';
      select.dispatchEvent(new Event('change'));

      await settings.saveSettings();

      // Verify config updated
      expect(state.CONFIG.primaryMediaPlayer).toBe('media_player.spotify');

      // Verify active tab re-render was triggered
      expect(mockUI.renderActiveTab).toHaveBeenCalled();
    });

    test('keeps a configured media player that Home Assistant is not reporting', async () => {
      state.CONFIG.primaryMediaPlayer = 'media_player.gone';
      await settings.openSettings();

      const select = document.getElementById('primary-media-player');
      expect(select.value).toBe('media_player.gone');
      expect(select.selectedOptions[0].textContent).toContain('media_player.gone');

      await settings.saveSettings();
      expect(state.CONFIG.primaryMediaPlayer).toBe('media_player.gone');
    });

    test('clears the media player when None is chosen', async () => {
      state.CONFIG.primaryMediaPlayer = 'media_player.spotify';
      await settings.openSettings();
      const select = document.getElementById('primary-media-player');
      expect(select.value).toBe('media_player.spotify');

      select.value = '';
      select.dispatchEvent(new Event('change'));
      await settings.saveSettings();

      expect(state.CONFIG.primaryMediaPlayer).toBeNull();
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

    test('previews appearance choices live and persists them only on Save', async () => {
      await settings.openSettings();
      const scale = document.getElementById('ui-scale-select');
      const preset = document.getElementById('readable-preset');
      const densitySelect = document.getElementById('density-select');
      const activeTileGlow = document.getElementById('active-tile-glow');
      // Defaults on: a config that predates the setting still gets the glow.
      expect(activeTileGlow.checked).toBe(true);

      scale.value = '1.5';
      scale.dispatchEvent(new Event('change'));
      preset.checked = true;
      preset.dispatchEvent(new Event('change'));
      densitySelect.value = 'compact';
      densitySelect.dispatchEvent(new Event('change'));
      activeTileGlow.checked = false;
      activeTileGlow.dispatchEvent(new Event('change'));
      await Promise.resolve();

      expect(mockUiUtils.applyUiPreferences).toHaveBeenLastCalledWith(
        expect.objectContaining({
          scale: 1.5,
          highContrast: true,
          opaquePanels: true,
          density: 'compact',
          activeTileGlow: false,
        })
      );
      expect(window.electronAPI.updateConfig).not.toHaveBeenCalled();
      expect(state.CONFIG.ui).toEqual(
        expect.objectContaining({
          highContrast: false,
          opaquePanels: false,
          density: 'comfortable',
        })
      );

      await settings.saveSettings();

      expect(window.electronAPI.updateConfig).toHaveBeenCalledWith(
        expect.objectContaining({
          ui: expect.objectContaining({
            scale: 1.5,
            highContrast: true,
            opaquePanels: true,
            density: 'compact',
            activeTileGlow: false,
          }),
        })
      );
      expect(state.CONFIG.ui).toEqual(
        expect.objectContaining({ scale: 1.5, density: 'compact', activeTileGlow: false })
      );

      await settings.openSettings();
      expect(scale.value).toBe('1.5');
      expect(preset.checked).toBe(true);
      expect(densitySelect.value).toBe('compact');
      expect(activeTileGlow.checked).toBe(false);
    });

    test('cancel reverts previewed appearance choices without saving them', async () => {
      state.CONFIG.ui.density = 'compact';
      await settings.openSettings();
      const scale = document.getElementById('ui-scale-select');
      const densitySelect = document.getElementById('density-select');
      scale.value = '1.3';
      scale.dispatchEvent(new Event('change'));
      densitySelect.value = 'comfortable';
      densitySelect.dispatchEvent(new Event('change'));

      settings.closeSettings();

      expect(window.electronAPI.updateConfig).not.toHaveBeenCalled();
      expect(state.CONFIG.ui.density).toBe('compact');
      expect(state.CONFIG.ui.scale).toBeUndefined();
      expect(mockUiUtils.applyUiPreferences).toHaveBeenLastCalledWith(
        expect.objectContaining({ density: 'compact' })
      );
      expect(mockUiUtils.applyUiPreferences.mock.lastCall[0].scale).toBeUndefined();
    });

    test('dims the rows the Readable preset replaces while it is on', async () => {
      await settings.openSettings();
      const colors = document.getElementById('colors-section');
      const preset = document.getElementById('readable-preset');
      expect(colors.classList.contains('is-overridden')).toBe(false);

      preset.checked = true;
      preset.dispatchEvent(new Event('change'));
      expect(colors.classList.contains('is-overridden')).toBe(true);

      preset.checked = false;
      preset.dispatchEvent(new Event('change'));
      expect(colors.classList.contains('is-overridden')).toBe(false);
    });

    test('opens with those rows dimmed when the preset is already saved on', async () => {
      state.CONFIG.ui.highContrast = true;
      state.CONFIG.ui.opaquePanels = true;
      await settings.openSettings();
      expect(document.getElementById('colors-section').classList.contains('is-overridden')).toBe(
        true
      );
    });

    test('leaves those rows alone when only one of the preset flags is saved', async () => {
      state.CONFIG.ui.highContrast = true;
      state.CONFIG.ui.opaquePanels = false;
      await settings.openSettings();
      expect(document.getElementById('readable-preset').checked).toBe(false);
      expect(document.getElementById('colors-section').classList.contains('is-overridden')).toBe(
        false
      );
    });

    test('saving unrelated settings keeps split contrast flags the preset does not represent', async () => {
      state.CONFIG.ui.highContrast = true;
      state.CONFIG.ui.opaquePanels = false;
      await settings.openSettings();
      expect(document.getElementById('readable-preset').checked).toBe(false);

      await settings.saveSettings();

      expect(state.CONFIG.ui).toEqual(
        expect.objectContaining({ highContrast: true, opaquePanels: false })
      );
    });

    test('a config echo keeps unsaved previews on screen while settings is open', async () => {
      await settings.openSettings();
      const densitySelect = document.getElementById('density-select');
      densitySelect.value = 'compact';
      densitySelect.dispatchEvent(new Event('change'));
      mockUiUtils.applyUiPreferences.mockClear();

      // The renderer re-applies the saved appearance for every config echo, then asks Settings
      // to restore its previews.
      settings.reapplySettingsPreviews();
      expect(mockUiUtils.applyUiPreferences).toHaveBeenLastCalledWith(
        expect.objectContaining({ density: 'compact' })
      );

      settings.closeSettings();
      mockUiUtils.applyUiPreferences.mockClear();
      settings.reapplySettingsPreviews();
      expect(mockUiUtils.applyUiPreferences).not.toHaveBeenCalled();
    });
  });

  describe('Seasonal themes', () => {
    const change = (element) => element.dispatchEvent(new Event('change', { bubbles: true }));

    test('an untouched switch follows the default and is not saved as a choice', async () => {
      await settings.openSettings();
      const enabled = document.getElementById('seasonal-enabled');
      expect(enabled.checked).toBe(true);
      expect(document.getElementById('seasonal-colors').checked).toBe(true);
      expect(document.getElementById('seasonal-show').value).toBe('auto');
      expect(document.querySelector('[data-holiday-dates="halloween"]').textContent).not.toBe('');

      await settings.saveSettings();

      expect(state.CONFIG.ui.seasonal).toEqual({ colors: true, holidays: {}, show: 'auto' });
    });

    test('previews choices live and saves them, including holidays switched off', async () => {
      await settings.openSettings();
      const colors = document.getElementById('seasonal-colors');
      const show = document.getElementById('seasonal-show');
      const christmas = document.querySelector('input[data-holiday="christmas"]');
      colors.checked = false;
      change(colors);
      show.value = 'halloween';
      change(show);
      christmas.checked = false;
      change(christmas);

      expect(mockUiUtils.applyUiPreferences).toHaveBeenLastCalledWith(
        expect.objectContaining({
          seasonal: {
            colors: false,
            holidays: { christmas: false },
            show: 'halloween',
            showUntil: expect.any(Number),
          },
        })
      );
      // Picking a holiday shows it for a day.
      const previewUntil = mockUiUtils.applyUiPreferences.mock.lastCall[0].seasonal.showUntil;
      expect(previewUntil - Date.now()).toBeGreaterThan(23 * 60 * 60 * 1000);
      expect(document.getElementById('seasonal-status').textContent).toMatch(
        /^Showing Halloween until .+\.$/
      );
      expect(window.electronAPI.updateConfig).not.toHaveBeenCalled();

      await settings.saveSettings();

      // The day counts from Save.
      expect(state.CONFIG.ui.seasonal).toEqual({
        colors: false,
        holidays: { christmas: false },
        show: 'halloween',
        showUntil: expect.any(Number),
      });
      const { showUntil } = state.CONFIG.ui.seasonal;
      expect(showUntil).toBeGreaterThanOrEqual(previewUntil);
      await settings.openSettings();
      expect(colors.checked).toBe(false);
      expect(show.value).toBe('halloween');
      expect(christmas.checked).toBe(false);

      // Saving again keeps the pick's original end time rather than extending it.
      await settings.saveSettings();
      expect(state.CONFIG.ui.seasonal.showUntil).toBe(showUntil);
    });

    test('a colour pick shows through holiday colours until a seasonal control is touched', async () => {
      await settings.openSettings();
      mockUiUtils.suspendSeasonalColors.mockClear();
      document.querySelector('#theme-options [data-theme="rose"]').click();
      expect(mockUiUtils.suspendSeasonalColors).toHaveBeenLastCalledWith(true);
      expect(mockUiUtils.applyAccentTheme).toHaveBeenLastCalledWith('rose');

      const colors = document.getElementById('seasonal-colors');
      colors.checked = false;
      change(colors);
      expect(mockUiUtils.suspendSeasonalColors).toHaveBeenLastCalledWith(false);

      mockUiUtils.suspendSeasonalColors.mockClear();
      settings.closeSettings();
      expect(mockUiUtils.suspendSeasonalColors).toHaveBeenCalledWith(false);
    });

    test('saves the switch once the user flips it, and greys out the options', async () => {
      await settings.openSettings();
      const enabled = document.getElementById('seasonal-enabled');
      enabled.checked = false;
      change(enabled);

      expect(document.getElementById('seasonal-colors').disabled).toBe(true);
      expect(document.getElementById('seasonal-status').classList.contains('hidden')).toBe(true);

      await settings.saveSettings();
      expect(state.CONFIG.ui.seasonal.enabled).toBe(false);
    });

    test('turns the default off along with the high contrast preset', async () => {
      await settings.openSettings();
      const preset = document.getElementById('readable-preset');
      preset.checked = true;
      change(preset);

      expect(document.getElementById('seasonal-enabled').checked).toBe(false);
      await settings.saveSettings();
      expect(state.CONFIG.ui.seasonal.enabled).toBeUndefined();
    });

    test('cancel puts the saved seasonal settings back', async () => {
      state.CONFIG.ui.seasonal = { show: 'christmas' };
      await settings.openSettings();
      const show = document.getElementById('seasonal-show');
      show.value = 'auto';
      change(show);

      settings.closeSettings();

      expect(mockUiUtils.applyUiPreferences).toHaveBeenLastCalledWith(
        expect.objectContaining({ seasonal: { show: 'christmas' } })
      );
    });
  });

  describe('the keyring notice', () => {
    const notice = () => document.getElementById('secure-storage-notice');
    const openWithIntegration = async (info) => {
      window.electronAPI.getDesktopIntegration = jest.fn().mockResolvedValue(info);
      await settings.openSettings();
      await new Promise((resolve) => setTimeout(resolve, 0));
    };

    afterEach(() => {
      delete window.electronAPI.getDesktopIntegration;
    });

    test('shows in General while a Linux session has no unlocked keyring', async () => {
      await openWithIntegration({ platform: 'linux', secureStorageAvailable: false });
      expect(notice().classList.contains('hidden')).toBe(false);
    });

    test.each([
      ['a keyring is running', { platform: 'linux', secureStorageAvailable: true }],
      ['another system', { platform: 'win32', secureStorageAvailable: false }],
      ['the status is unknown', {}],
    ])('stays hidden when %s', async (_label, info) => {
      await openWithIntegration(info);
      expect(notice().classList.contains('hidden')).toBe(true);
    });

    test('goes away once the keyring is there on the next open', async () => {
      await openWithIntegration({ platform: 'linux', secureStorageAvailable: false });
      settings.closeSettings();
      await openWithIntegration({ platform: 'linux', secureStorageAvailable: true });
      expect(notice().classList.contains('hidden')).toBe(true);
    });
  });

  describe('Desktop integration controls', () => {
    beforeEach(() => {
      document.body.insertAdjacentHTML(
        'beforeend',
        `
        <div id="desktop-integration" hidden>
          <select id="desktop-bindings-format"><option value="lua">Lua</option><option value="hyprlang">Hyprlang</option></select>
          <textarea id="desktop-bindings"></textarea>
          <button id="desktop-bindings-copy"></button>
          <button id="desktop-integration-refresh"></button>
          <p id="desktop-integration-status"></p>
          <p id="desktop-integration-legacy" hidden></p>
        </div>`
      );
      mockUiUtils.copyTextToClipboard.mockClear();
    });

    afterEach(() => {
      delete window.electronAPI.getDesktopIntegration;
    });

    test.each([{ hyprland: false }, null])(
      'keeps refresh and copy working after detection returns %p',
      async (initialInfo) => {
        const info = {
          hyprland: true,
          shortcuts: [{ binding: 'lua binding', legacyBinding: 'legacy binding' }],
          lastActivation: { id: 'popup', at: '12:00' },
          legacyActivation: { notice: 'Replace the old binding' },
        };
        window.electronAPI.getDesktopIntegration = jest
          .fn()
          .mockResolvedValueOnce(initialInfo)
          .mockResolvedValue(info);
        await settings.initializePopupHotkey();
        const panel = document.getElementById('desktop-integration');
        const refresh = document.getElementById('desktop-integration-refresh');
        const copy = document.getElementById('desktop-bindings-copy');
        const output = document.getElementById('desktop-bindings');
        expect(panel.hidden).toBe(true);
        expect(typeof refresh.onclick).toBe('function');
        output.value = 'displayed bindings';
        copy.click();
        expect(mockUiUtils.copyTextToClipboard).toHaveBeenCalledWith('displayed bindings');

        await refresh.onclick();
        expect(panel.hidden).toBe(false);
        expect(output.value).toBe('lua binding');
        expect(document.getElementById('desktop-integration-status').textContent).toBe(
          'Last shortcut received: popup at 12:00'
        );
        expect(document.getElementById('desktop-integration-legacy').hidden).toBe(false);
        const format = document.getElementById('desktop-bindings-format');
        format.value = 'hyprlang';
        format.dispatchEvent(new Event('change'));
        await refresh.onclick();
        copy.click();
        expect(mockUiUtils.copyTextToClipboard).toHaveBeenLastCalledWith('legacy binding');
        expect(mockUiUtils.copyTextToClipboard).toHaveBeenCalledTimes(2);
        expect(window.electronAPI.getDesktopIntegration).toHaveBeenCalledTimes(3);

        window.electronAPI.getDesktopIntegration.mockResolvedValueOnce({ hyprland: false });
        await refresh.onclick();
        expect(panel.hidden).toBe(true);
        await refresh.onclick();
        expect(panel.hidden).toBe(false);
        expect(output.value).toBe('legacy binding');
      }
    );

    test('binds controls while desktop detection is still pending', async () => {
      let resolveInfo;
      window.electronAPI.getDesktopIntegration = jest.fn().mockReturnValue(
        new Promise((resolve) => {
          resolveInfo = resolve;
        })
      );
      const initialization = settings.initializePopupHotkey();
      await Promise.resolve();
      const refreshHandler = document.getElementById('desktop-integration-refresh').onclick;
      const copyHandler = document.getElementById('desktop-bindings-copy').onclick;
      resolveInfo({ hyprland: false });
      await initialization;
      expect(typeof refreshHandler).toBe('function');
      expect(typeof copyHandler).toBe('function');
    });

    test('confirms a copy and falls back to manual selection when copying fails', async () => {
      window.electronAPI.getDesktopIntegration = jest.fn().mockResolvedValue({
        hyprland: true,
        shortcuts: [{ binding: 'lua binding' }],
      });
      await settings.initializePopupHotkey();
      const copy = document.getElementById('desktop-bindings-copy');
      const output = document.getElementById('desktop-bindings');

      mockUiUtils.showToast.mockClear();
      await copy.onclick();
      expect(mockUiUtils.copyTextToClipboard).toHaveBeenCalledWith('lua binding');
      expect(mockUiUtils.showToast).toHaveBeenCalledWith('Bindings copied', 'success');
      expect(document.activeElement).not.toBe(output);

      mockUiUtils.copyTextToClipboard.mockResolvedValueOnce(false);
      await copy.onclick();
      expect(document.activeElement).toBe(output);
      expect(output.selectionStart).toBe(0);
      expect(output.selectionEnd).toBe('lua binding'.length);
      expect(mockUiUtils.showToast).toHaveBeenLastCalledWith(
        'Select and copy the bindings manually.',
        'info'
      );
    });
  });

  describe('Profile Sync Settings', () => {
    test('copies the selected Hyprland format and keeps it selected after refresh', async () => {
      document.body.insertAdjacentHTML(
        'beforeend',
        `
        <div id="desktop-integration" hidden>
          <select id="desktop-bindings-format"><option value="lua">Lua</option><option value="hyprlang">Hyprlang</option></select>
          <textarea id="desktop-bindings"></textarea>
          <button id="desktop-bindings-copy"></button>
          <button id="desktop-integration-refresh"></button>
          <p id="desktop-integration-status"></p>
        </div>`
      );
      window.electronAPI.getDesktopIntegration = jest.fn().mockResolvedValue({
        hyprland: true,
        shortcuts: [{ binding: 'lua binding', legacyBinding: 'legacy binding' }],
      });
      mockUiUtils.copyTextToClipboard.mockClear();
      await settings.initializePopupHotkey();
      const format = document.getElementById('desktop-bindings-format');
      const output = document.getElementById('desktop-bindings');
      expect(output.value).toBe('lua binding');
      format.value = 'hyprlang';
      format.dispatchEvent(new Event('change'));
      expect(output.value).toBe('legacy binding');
      document.getElementById('desktop-bindings-copy').click();
      expect(mockUiUtils.copyTextToClipboard).toHaveBeenCalledWith('legacy binding');
      await document.getElementById('desktop-integration-refresh').onclick();
      expect(output.value).toBe('legacy binding');
      delete window.electronAPI.getDesktopIntegration;
    });

    test('handles a sync status event before renderer configuration has loaded', () => {
      const config = state.CONFIG;
      const status = buildProfileSyncStatus({ enabled: true });
      state.setConfig(null);

      expect(() => settings.handleProfileSyncStatusUpdate(status)).not.toThrow();
      expect(state.CONFIG).toBeNull();

      state.setConfig(config);
      settings.handleProfileSyncStatusUpdate(status);
      expect(document.getElementById('profile-sync-status').textContent).toContain(
        'Not synced yet.'
      );
    });

    test('should hydrate profile sync controls and status', async () => {
      const config = state.CONFIG;
      config.profileSync = buildProfileSync({
        enabled: true,
        provider: 'googleDrive',
        cloudFilePath: '/tmp/shared-folder/ha-widget-profile-sync.json',
        syncScope: {
          preset: 'visual',
          sections: {
            quickAccessLayout: false,
            visualPersonalization: true,
            automationAlerts: false,
            connectionMediaPreferences: false,
          },
        },
        intervalMinutes: 15,
        encryptionEnabled: true,
        rememberPassphrase: true,
      });
      state.setConfig(config);

      mockElectronAPI.getProfileSyncStatus.mockResolvedValueOnce(
        buildProfileSyncStatus({
          enabled: true,
          provider: 'googleDrive',
          cloudFilePath: '/tmp/shared-folder/ha-widget-profile-sync.json',
          syncScope: {
            preset: 'visual',
            sections: {
              quickAccessLayout: false,
              visualPersonalization: true,
              automationAlerts: false,
              connectionMediaPreferences: false,
            },
          },
          intervalMinutes: 15,
          encryptionEnabled: true,
          rememberPassphrase: true,
          passphraseEncrypted: true,
          passphraseStored: true,
          lastSyncAt: '2026-02-23T10:00:00.000Z',
          lastSuccessfulSyncAt: '2026-02-23T10:00:00.000Z',
          lastRemoteUpdatedAt: '2026-02-23T09:00:00.000Z',
          lastRemoteUpdatedByThisDevice: false,
          lastSyncStatus: 'success',
          lastSyncError: '',
          needsResolution: false,
          inFlight: false,
        })
      );

      await settings.openSettings();

      expect(document.getElementById('profile-sync-enabled').checked).toBe(true);
      expect(document.getElementById('profile-sync-provider').value).toBe('googleDrive');
      expect(document.getElementById('profile-sync-folder-path').value).toBe('/tmp/shared-folder');
      expect(document.getElementById('profile-sync-scope-preset').value).toBe('visual');
      expect(document.getElementById('profile-sync-interval').value).toBe('15');
      expect(document.getElementById('profile-sync-settings').classList.contains('hidden')).toBe(
        false
      );
      const statusText = document.getElementById('profile-sync-status').textContent;
      expect(statusText).toContain('Up to date. Last synced');
      expect(statusText).toContain('Another computer last changed the sync file');
      expect(
        document.getElementById('profile-sync-clear-passphrase').classList.contains('hidden')
      ).toBe(false);
    });

    test('should derive root folder when sync file is at POSIX root', async () => {
      const config = state.CONFIG;
      config.profileSync = buildProfileSync({
        enabled: true,
        provider: 'cloudFile',
        cloudFilePath: '/ha-widget-profile-sync.json',
      });
      state.setConfig(config);
      mockElectronAPI.getProfileSyncStatus.mockResolvedValueOnce(
        buildProfileSyncStatus({
          enabled: true,
          provider: 'cloudFile',
          cloudFilePath: '/ha-widget-profile-sync.json',
        })
      );

      await settings.openSettings();

      expect(document.getElementById('profile-sync-folder-path').value).toBe('/');
    });

    test('should derive drive root folder when sync file is at Windows root', async () => {
      const config = state.CONFIG;
      config.profileSync = buildProfileSync({
        enabled: true,
        provider: 'cloudFile',
        cloudFilePath: 'C:\\ha-widget-profile-sync.json',
      });
      state.setConfig(config);
      mockElectronAPI.getProfileSyncStatus.mockResolvedValueOnce(
        buildProfileSyncStatus({
          enabled: true,
          provider: 'cloudFile',
          cloudFilePath: 'C:\\ha-widget-profile-sync.json',
        })
      );

      await settings.openSettings();

      expect(document.getElementById('profile-sync-folder-path').value).toBe('C:\\');
    });

    test('should persist profile sync config and passphrase', async () => {
      mockElectronAPI.setProfileSyncPassphrase.mockResolvedValueOnce({
        success: true,
        remembered: true,
        encrypted: true,
      });

      await settings.openSettings();

      document.getElementById('profile-sync-enabled').checked = true;
      document.getElementById('profile-sync-provider').value = 'icloudDrive';
      document.getElementById('profile-sync-folder-path').value = '/tmp/shared-folder';
      document.getElementById('profile-sync-interval').value = '5';
      document.getElementById('profile-sync-encryption-enabled').checked = true;
      document.getElementById('profile-sync-passphrase').value = 'abcd1234';
      document.getElementById('profile-sync-remember-passphrase').checked = true;
      document.getElementById('profile-sync-scope-preset').value = 'custom';
      document.getElementById('profile-sync-scope-preset').dispatchEvent(new Event('change'));
      document.getElementById('profile-sync-scope-quick-access-layout').checked = true;
      document.getElementById('profile-sync-scope-visual-personalization').checked = false;
      document.getElementById('profile-sync-scope-automation-alerts').checked = false;
      document.getElementById('profile-sync-scope-connection-media-preferences').checked = true;

      await settings.saveSettings();

      expect(state.CONFIG.profileSync).toEqual(
        expect.objectContaining({
          enabled: true,
          provider: 'icloudDrive',
          cloudFilePath: '/tmp/shared-folder/ha-widget-profile-sync.json',
          syncScope: {
            preset: 'custom',
            sections: {
              quickAccessLayout: true,
              visualPersonalization: false,
              automationAlerts: false,
              connectionMediaPreferences: true,
            },
          },
          intervalMinutes: 5,
          encryptionEnabled: true,
          rememberPassphrase: true,
        })
      );
      expect(mockElectronAPI.setProfileSyncPassphrase).toHaveBeenCalledWith('abcd1234', true, true);
    });

    test('should persist the passphrase after saving encrypted sync config', async () => {
      mockElectronAPI.setProfileSyncPassphrase.mockResolvedValueOnce({
        success: true,
        remembered: true,
        encrypted: true,
      });

      await settings.openSettings();

      document.getElementById('profile-sync-enabled').checked = true;
      document.getElementById('profile-sync-folder-path').value = '/tmp/shared-folder';
      document.getElementById('profile-sync-encryption-enabled').checked = true;
      document.getElementById('profile-sync-passphrase').value = 'persist-first';
      document.getElementById('profile-sync-remember-passphrase').checked = true;

      await settings.saveSettings();

      // The config is persisted before the keychain write so a failed save can never
      // overwrite a previously stored secret.
      expect(mockElectronAPI.updateConfig.mock.invocationCallOrder[0]).toBeLessThan(
        mockElectronAPI.setProfileSyncPassphrase.mock.invocationCallOrder[0]
      );
      expect(state.CONFIG.profileSync).toEqual(
        expect.objectContaining({
          rememberPassphrase: true,
          passphraseEncrypted: true,
        })
      );
    });

    test('does not store the passphrase when config persistence fails', async () => {
      await settings.openSettings();

      window.electronAPI.updateConfig.mockRejectedValueOnce(new Error('disk unavailable'));

      document.getElementById('profile-sync-enabled').checked = true;
      document.getElementById('profile-sync-provider').value = 'icloudDrive';
      document.getElementById('profile-sync-folder-path').value = '/tmp/shared-folder';
      document.getElementById('profile-sync-interval').value = '5';
      document.getElementById('profile-sync-encryption-enabled').checked = true;
      document.getElementById('profile-sync-passphrase').value = 'abcd1234';
      document.getElementById('profile-sync-remember-passphrase').checked = true;

      await settings.saveSettings();

      // The old secret must never be overwritten when the settings did not persist.
      expect(mockElectronAPI.setProfileSyncPassphrase).not.toHaveBeenCalled();
      expect(mockUiUtils.showToast).toHaveBeenCalledWith(
        'Settings could not be saved. No configuration changes were applied.',
        'error',
        4000
      );
    });

    test('saves settings but warns when the passphrase cannot be stored', async () => {
      await settings.openSettings();

      mockElectronAPI.setProfileSyncPassphrase.mockResolvedValueOnce({
        success: false,
        error: 'Passphrase persistence failed',
      });

      document.getElementById('profile-sync-enabled').checked = true;
      document.getElementById('profile-sync-provider').value = 'icloudDrive';
      document.getElementById('profile-sync-folder-path').value = '/tmp/shared-folder';
      document.getElementById('profile-sync-interval').value = '5';
      document.getElementById('profile-sync-encryption-enabled').checked = true;
      document.getElementById('profile-sync-passphrase').value = 'abcd1234';
      document.getElementById('profile-sync-remember-passphrase').checked = true;

      await settings.saveSettings();

      expect(mockElectronAPI.setProfileSyncPassphrase).toHaveBeenCalledWith('abcd1234', true, true);
      // The settings themselves are still persisted even though the secret failed.
      expect(mockElectronAPI.updateConfig).toHaveBeenCalled();
      expect(state.CONFIG.profileSync).toEqual(
        expect.objectContaining({
          enabled: true,
          encryptionEnabled: true,
          cloudFilePath: '/tmp/shared-folder/ha-widget-profile-sync.json',
        })
      );
      expect(mockUiUtils.showToast).toHaveBeenCalledWith(
        'Passphrase persistence failed',
        'warning',
        5000
      );
    });

    test('should fall back to session-only passphrase storage when remember is unavailable', async () => {
      mockElectronAPI.setProfileSyncPassphrase.mockResolvedValueOnce({
        success: true,
        remembered: false,
        encrypted: false,
      });

      await settings.openSettings();

      document.getElementById('profile-sync-enabled').checked = true;
      document.getElementById('profile-sync-folder-path').value = '/tmp/shared-folder';
      document.getElementById('profile-sync-encryption-enabled').checked = true;
      document.getElementById('profile-sync-passphrase').value = 'session-only';
      document.getElementById('profile-sync-remember-passphrase').checked = true;

      await settings.saveSettings();

      expect(state.CONFIG.profileSync).toEqual(
        expect.objectContaining({
          rememberPassphrase: false,
          passphraseEncrypted: false,
        })
      );
    });

    test('should keep profile sync path valid when folder is root', async () => {
      await settings.openSettings();

      document.getElementById('profile-sync-enabled').checked = true;
      document.getElementById('profile-sync-provider').value = 'cloudFile';
      document.getElementById('profile-sync-folder-path').value = '/';
      document.getElementById('profile-sync-interval').value = '5';
      document.getElementById('profile-sync-encryption-enabled').checked = false;

      await settings.saveSettings();

      expect(state.CONFIG.profileSync.cloudFilePath).toBe('/ha-widget-profile-sync.json');
    });

    test('should coerce profile sync interval to a positive integer', async () => {
      await settings.openSettings();

      document.getElementById('profile-sync-enabled').checked = true;
      document.getElementById('profile-sync-provider').value = 'cloudFile';
      document.getElementById('profile-sync-folder-path').value = '/tmp/shared-folder';
      document.getElementById('profile-sync-interval').value = '0';
      document.getElementById('profile-sync-encryption-enabled').checked = false;

      await settings.saveSettings();

      expect(state.CONFIG.profileSync.intervalMinutes).toBe(5);
    });

    test('should keep windows drive root valid when building sync path', async () => {
      await settings.openSettings();

      document.getElementById('profile-sync-enabled').checked = true;
      document.getElementById('profile-sync-provider').value = 'cloudFile';
      document.getElementById('profile-sync-folder-path').value = 'C:\\';
      document.getElementById('profile-sync-interval').value = '5';
      document.getElementById('profile-sync-encryption-enabled').checked = false;

      await settings.saveSettings();

      expect(state.CONFIG.profileSync.cloudFilePath).toBe('C:\\ha-widget-profile-sync.json');
    });

    test('should keep session passphrase when disabling remember with a new typed passphrase', async () => {
      const config = state.CONFIG;
      config.profileSync = buildProfileSync({
        enabled: true,
        provider: 'cloudFile',
        cloudFilePath: '/tmp/shared-folder/ha-widget-profile-sync.json',
        encryptionEnabled: true,
        rememberPassphrase: true,
      });
      state.setConfig(config);

      mockElectronAPI.getProfileSyncStatus.mockResolvedValueOnce(
        buildProfileSyncStatus({
          enabled: true,
          provider: 'cloudFile',
          cloudFilePath: '/tmp/shared-folder/ha-widget-profile-sync.json',
          encryptionEnabled: true,
          rememberPassphrase: true,
          passphraseStored: true,
        })
      );

      await settings.openSettings();

      document.getElementById('profile-sync-enabled').checked = true;
      document.getElementById('profile-sync-provider').value = 'cloudFile';
      document.getElementById('profile-sync-folder-path').value = '/tmp/shared-folder';
      document.getElementById('profile-sync-interval').value = '5';
      document.getElementById('profile-sync-encryption-enabled').checked = true;
      document.getElementById('profile-sync-passphrase').value = 'abcd1234';
      document.getElementById('profile-sync-remember-passphrase').checked = false;

      await settings.saveSettings();

      expect(mockElectronAPI.setProfileSyncPassphrase).toHaveBeenCalledWith(
        'abcd1234',
        false,
        true
      );
      expect(mockElectronAPI.clearProfileSyncPassphrase).not.toHaveBeenCalled();
    });

    test('should submit the disabled encryption mode with the current remote passphrase', async () => {
      const config = state.CONFIG;
      config.profileSync = buildProfileSync({
        enabled: true,
        provider: 'cloudFile',
        cloudFilePath: '/tmp/shared-folder/ha-widget-profile-sync.json',
        encryptionEnabled: true,
        rememberPassphrase: false,
      });
      state.setConfig(config);

      mockElectronAPI.getProfileSyncStatus.mockResolvedValueOnce(
        buildProfileSyncStatus({
          enabled: true,
          provider: 'cloudFile',
          cloudFilePath: '/tmp/shared-folder/ha-widget-profile-sync.json',
          encryptionEnabled: true,
          rememberPassphrase: false,
          passphraseStored: false,
        })
      );
      mockElectronAPI.setProfileSyncPassphrase.mockResolvedValueOnce({
        success: true,
        remembered: false,
        encrypted: false,
      });

      await settings.openSettings();

      document.getElementById('profile-sync-encryption-enabled').checked = false;
      document.getElementById('profile-sync-passphrase').value = 'current-key';

      await settings.saveSettings();

      expect(mockElectronAPI.setProfileSyncPassphrase).toHaveBeenCalledWith(
        'current-key',
        false,
        false
      );
    });

    test('should forward selected provider when choosing sync folder', async () => {
      await settings.openSettings();

      document.getElementById('profile-sync-provider').value = 'syncthing';
      document.getElementById('profile-sync-choose-folder').click();
      await Promise.resolve();

      expect(mockElectronAPI.chooseProfileSyncFolder).toHaveBeenCalledWith('syncthing', '');
    });

    test('opens the folder chooser where the form already points', async () => {
      await settings.openSettings();

      document.getElementById('profile-sync-folder-path').value = '/tmp/typed-folder';
      document.getElementById('profile-sync-choose-folder').click();
      await Promise.resolve();

      expect(mockElectronAPI.chooseProfileSyncFolder).toHaveBeenCalledWith(
        'cloudFile',
        '/tmp/typed-folder'
      );
    });

    test('asks before Sync Up replaces the sync file', async () => {
      enableSavedProfileSync();
      await settings.openSettings();
      mockElectronAPI.runProfileSync = jest.fn().mockResolvedValue({ ok: true });
      mockUiUtils.showConfirm.mockResolvedValueOnce(false);

      document.getElementById('profile-sync-push-now').click();
      await new Promise((resolve) => setTimeout(resolve, 0));

      expect(mockUiUtils.showConfirm).toHaveBeenCalledWith(
        'Sync Up',
        expect.stringContaining('Replace the sync file'),
        expect.objectContaining({ confirmText: 'Sync Up' })
      );
      expect(mockElectronAPI.runProfileSync).not.toHaveBeenCalled();

      document.getElementById('profile-sync-now').click();
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(mockElectronAPI.runProfileSync).toHaveBeenCalledWith('auto');
    });

    test('names the differing sections in the first-sync choice', () => {
      settings.handleProfileSyncStatusUpdate(
        buildProfileSyncStatus({
          enabled: true,
          needsResolution: true,
          conflictSections: ['quickAccessLayout', 'visualPersonalization'],
        })
      );
      expect(document.getElementById('profile-sync-resolution').classList).not.toContain('hidden');
      expect(document.getElementById('profile-sync-resolution-text').textContent).toContain(
        'different settings for Quick Access and layout, Appearance'
      );
      expect(document.getElementById('profile-sync-status').textContent).toBe(
        'Waiting for your choice below.'
      );
    });

    test('offers only Keep Local when the conflicting sections are damaged', () => {
      settings.handleProfileSyncStatusUpdate(
        buildProfileSyncStatus({
          enabled: true,
          needsResolution: true,
          conflictSections: ['visualPersonalization'],
          damagedConflictSections: ['visualPersonalization'],
        })
      );
      expect(document.getElementById('profile-sync-resolution-text').textContent).toContain(
        "The sync file's Appearance settings are damaged."
      );
      expect(document.getElementById('profile-sync-resolve-remote').classList).toContain('hidden');
    });

    test('lists sync backups and restores the chosen one', async () => {
      mockElectronAPI.listProfileSyncBackups = jest.fn().mockResolvedValue({
        success: true,
        backups: [
          {
            id: 'remote-profile-1771840800000.json',
            kind: 'remote',
            createdAt: '2026-02-23T10:00:00.000Z',
            sections: ['visualPersonalization'],
          },
        ],
      });
      mockElectronAPI.restoreProfileSyncBackup = jest.fn().mockResolvedValue({
        success: true,
        restored: ['visualPersonalization'],
        config: { ...state.CONFIG, opacity: 0.6 },
      });
      await settings.openSettings();
      await new Promise((resolve) => setTimeout(resolve, 0));

      const select = document.getElementById('profile-sync-backup-select');
      expect(select.disabled).toBe(false);
      expect(select.options[0].textContent).toContain('Sync file, before an upload');
      expect(select.options[0].title).toBe('Contains: Appearance');

      document.getElementById('profile-sync-restore-backup').click();
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(mockElectronAPI.restoreProfileSyncBackup).toHaveBeenCalledWith(
        'remote-profile-1771840800000.json'
      );
      expect(state.CONFIG.opacity).toBe(0.6);
    });

    test('tells apart why each backup was taken, and what it holds', async () => {
      mockElectronAPI.listProfileSyncBackups = jest.fn().mockResolvedValue({
        success: true,
        backups: [
          {
            id: 'local-profile-3.json',
            kind: 'local',
            reason: 'import',
            createdAt: '2026-02-23T12:00:00.000Z',
            sections: ['visualPersonalization', 'quickAccessLayout'],
          },
          {
            id: 'local-profile-2.json',
            kind: 'local',
            reason: 'restore',
            createdAt: '2026-02-23T11:00:00.000Z',
            sections: ['automationAlerts'],
          },
          {
            id: 'local-profile-1.json',
            kind: 'local',
            reason: 'pull',
            createdAt: '2026-02-23T10:00:00.000Z',
            sections: ['visualPersonalization'],
          },
        ],
      });
      await settings.openSettings();
      await new Promise((resolve) => setTimeout(resolve, 0));

      const select = document.getElementById('profile-sync-backup-select');
      const labels = [...select.options].map((option) => option.textContent);
      expect(labels[0]).toContain('This computer, before an import');
      expect(labels[1]).toContain('This computer, before a restore');
      expect(labels[2]).toContain('This computer, before a sync');
      // The sections are the part that tells similar entries apart and the part a closed
      // select cuts off, so they are in the tooltip and on the line under the list.
      expect(select.options[0].title).toBe('Contains: Appearance, Quick Access and layout');
      const detail = document.getElementById('profile-sync-backup-detail');
      expect(detail.textContent).toBe('Contains: Appearance, Quick Access and layout');
      expect(detail.classList.contains('hidden')).toBe(false);

      select.value = 'local-profile-2.json';
      select.dispatchEvent(new Event('change'));
      expect(detail.textContent).toBe('Contains: Alerts');
    });

    test('the restore confirmation names the backup it applies', async () => {
      mockElectronAPI.listProfileSyncBackups = jest.fn().mockResolvedValue({
        success: true,
        backups: [
          {
            id: 'local-profile-1.json',
            kind: 'local',
            reason: 'pull',
            createdAt: '2026-02-23T10:00:00.000Z',
            sections: ['visualPersonalization'],
          },
        ],
      });
      mockElectronAPI.restoreProfileSyncBackup = jest.fn().mockResolvedValue({ success: true });
      await settings.openSettings();
      await new Promise((resolve) => setTimeout(resolve, 0));
      mockUiUtils.showConfirm.mockClear();

      document.getElementById('profile-sync-restore-backup').click();
      await new Promise((resolve) => setTimeout(resolve, 0));

      expect(mockUiUtils.showConfirm.mock.calls[0][0]).toMatch(/^Restore the backup from .*2026/);
    });

    test('shows the whole folder as a tooltip and opens the chooser from the field', async () => {
      const longFolder = '/Users/someone/Library/Mobile Documents/com~apple~CloudDocs/Widget/Sync';
      state.CONFIG.profileSync = buildProfileSync({
        enabled: true,
        cloudFilePath: `${longFolder}/ha-widget-profile-sync.json`,
      });
      mockElectronAPI.getProfileSyncStatus.mockResolvedValueOnce(
        buildProfileSyncStatus({
          enabled: true,
          cloudFilePath: `${longFolder}/ha-widget-profile-sync.json`,
        })
      );
      await settings.openSettings();

      const field = document.getElementById('profile-sync-folder-path');
      expect(field.value).toBe(longFolder);
      expect(field.title).toBe(longFolder);

      field.click();
      await Promise.resolve();
      expect(mockElectronAPI.chooseProfileSyncFolder).toHaveBeenCalledWith('cloudFile', longFolder);
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(field.title).toBe('/tmp/profile-sync');
    });

    test('describes a restore according to the active sync scope', async () => {
      mockElectronAPI.listProfileSyncBackups = jest.fn().mockResolvedValue({
        success: true,
        backups: [
          {
            id: 'local-profile-1771840800000.json',
            kind: 'local',
            createdAt: '2026-02-23T10:00:00.000Z',
            sections: ['visualPersonalization'],
          },
        ],
      });
      mockElectronAPI.restoreProfileSyncBackup = jest.fn().mockResolvedValue({ success: true });
      await settings.openSettings();
      await new Promise((resolve) => setTimeout(resolve, 0));
      const confirmText = async (profileSync) => {
        state.CONFIG.profileSync = { ...state.CONFIG.profileSync, ...profileSync };
        mockUiUtils.showConfirm.mockClear();
        document.getElementById('profile-sync-restore-backup').click();
        await new Promise((resolve) => setTimeout(resolve, 0));
        return mockUiUtils.showConfirm.mock.calls[0][1];
      };
      const all = { preset: 'all' };
      const partial = { preset: 'visual' };
      const off = await confirmText({ enabled: false, syncScope: all });
      expect(off).toContain('backed up first.');
      expect(off).not.toContain('sync to your other computers');
      expect(await confirmText({ enabled: true, syncScope: partial })).toContain(
        'restored settings in your sync scope then sync'
      );
      expect(await confirmText({ enabled: true, syncScope: all })).toContain(
        'the restored ones then sync to your other computers'
      );
    });

    test('should open profile sync instructions from need help button', async () => {
      await settings.openSettings();

      document.getElementById('profile-sync-help-btn').click();
      await Promise.resolve();

      expect(mockElectronAPI.openExternal).toHaveBeenCalledWith(
        'https://github.com/Robertg761/HA-Desktop-Widget#profile-sync'
      );
    });

    test('should persist syncthing provider selection', async () => {
      await settings.openSettings();

      document.getElementById('profile-sync-enabled').checked = true;
      document.getElementById('profile-sync-provider').value = 'syncthing';
      document.getElementById('profile-sync-folder-path').value = '/tmp/syncthing-folder';
      document.getElementById('profile-sync-interval').value = '5';
      document.getElementById('profile-sync-encryption-enabled').checked = false;

      await settings.saveSettings();

      expect(state.CONFIG.profileSync).toEqual(
        expect.objectContaining({
          enabled: true,
          provider: 'syncthing',
          cloudFilePath: '/tmp/syncthing-folder/ha-widget-profile-sync.json',
          intervalMinutes: 5,
          encryptionEnabled: false,
        })
      );
    });

    test('should coerce invalid sync intervals back to the default', async () => {
      await settings.openSettings();

      document.getElementById('profile-sync-enabled').checked = true;
      document.getElementById('profile-sync-folder-path').value = '/tmp/shared-folder';
      document.getElementById('profile-sync-interval').value = '-10';
      document.getElementById('profile-sync-encryption-enabled').checked = false;

      await settings.saveSettings();

      expect(state.CONFIG.profileSync.intervalMinutes).toBe(5);
    });

    test('should use status cloud file path when config path is empty', async () => {
      const config = state.CONFIG;
      config.profileSync = buildProfileSync({
        enabled: true,
        provider: 'cloudFile',
        cloudFilePath: '',
        intervalMinutes: 5,
        encryptionEnabled: false,
        rememberPassphrase: false,
      });
      state.setConfig(config);
      mockElectronAPI.getProfileSyncStatus.mockResolvedValueOnce(
        buildProfileSyncStatus({
          enabled: true,
          provider: 'cloudFile',
          cloudFilePath: '/tmp/default-sync/ha-widget-profile-sync.json',
          intervalMinutes: 5,
          encryptionEnabled: false,
          rememberPassphrase: false,
          passphraseEncrypted: false,
          passphraseStored: false,
          lastSyncAt: null,
          lastSyncStatus: 'idle',
          lastSyncError: '',
          needsResolution: false,
          inFlight: false,
        })
      );

      await settings.openSettings();

      expect(document.getElementById('profile-sync-folder-path').value).toBe('/tmp/default-sync');
    });

    test('should preserve root folders when building the sync file path', async () => {
      await settings.openSettings();

      document.getElementById('profile-sync-enabled').checked = true;
      document.getElementById('profile-sync-folder-path').value = '/';
      document.getElementById('profile-sync-encryption-enabled').checked = false;

      await settings.saveSettings();

      expect(state.CONFIG.profileSync.cloudFilePath).toBe('/ha-widget-profile-sync.json');
    });

    test('should keep current path without copying when folder change is canceled', async () => {
      const config = state.CONFIG;
      config.profileSync = buildProfileSync({
        ...config.profileSync,
        enabled: true,
        cloudFilePath: '/tmp/old-sync/ha-widget-profile-sync.json',
        intervalMinutes: 5,
        encryptionEnabled: false,
      });
      state.setConfig(config);
      mockUiUtils.showConfirm.mockResolvedValueOnce(false);

      await settings.openSettings();
      document.getElementById('profile-sync-enabled').checked = true;
      document.getElementById('profile-sync-folder-path').value = '/tmp/new-sync';
      document.getElementById('profile-sync-encryption-enabled').checked = false;
      await settings.saveSettings();

      expect(state.CONFIG.profileSync.cloudFilePath).toBe(
        '/tmp/old-sync/ha-widget-profile-sync.json'
      );
      expect(mockElectronAPI.copyProfileSyncFile).not.toHaveBeenCalled();
    });

    test('should copy sync file when user confirms folder change', async () => {
      const config = state.CONFIG;
      config.profileSync = buildProfileSync({
        ...config.profileSync,
        enabled: true,
        cloudFilePath: '/tmp/old-sync/ha-widget-profile-sync.json',
        intervalMinutes: 5,
        encryptionEnabled: false,
      });
      state.setConfig(config);
      mockUiUtils.showConfirm.mockResolvedValueOnce(true);
      mockElectronAPI.copyProfileSyncFile.mockResolvedValueOnce({
        ok: true,
        status: 'copied',
        copied: true,
      });

      await settings.openSettings();
      document.getElementById('profile-sync-enabled').checked = true;
      document.getElementById('profile-sync-folder-path').value = '/tmp/new-sync';
      document.getElementById('profile-sync-encryption-enabled').checked = false;
      await settings.saveSettings();

      expect(mockElectronAPI.copyProfileSyncFile).toHaveBeenCalledWith(
        '/tmp/old-sync/ha-widget-profile-sync.json',
        '/tmp/new-sync/ha-widget-profile-sync.json'
      );
      expect(state.CONFIG.profileSync.cloudFilePath).toBe(
        '/tmp/new-sync/ha-widget-profile-sync.json'
      );
    });

    test('switches to the sync file already in the new folder instead of overwriting it', async () => {
      const config = state.CONFIG;
      config.profileSync = buildProfileSync({
        ...config.profileSync,
        enabled: true,
        cloudFilePath: '/tmp/old-sync/ha-widget-profile-sync.json',
        intervalMinutes: 5,
        encryptionEnabled: false,
      });
      state.setConfig(config);
      mockUiUtils.showConfirm.mockResolvedValueOnce(true).mockResolvedValueOnce(true);
      mockElectronAPI.copyProfileSyncFile.mockResolvedValueOnce({
        ok: false,
        status: 'destination_exists',
      });

      await settings.openSettings();
      document.getElementById('profile-sync-enabled').checked = true;
      document.getElementById('profile-sync-folder-path').value = '/tmp/new-sync';
      document.getElementById('profile-sync-encryption-enabled').checked = false;
      await settings.saveSettings();

      // The file in the new folder is never replaced, so the copy is not retried.
      expect(mockElectronAPI.copyProfileSyncFile).toHaveBeenCalledTimes(1);
      expect(mockUiUtils.showConfirm).toHaveBeenLastCalledWith(
        'Sync File Already Exists',
        expect.stringContaining('/tmp/new-sync already has a sync file'),
        expect.objectContaining({ confirmText: 'Use That File', cancelText: 'Keep Current' })
      );
      expect(state.CONFIG.profileSync.cloudFilePath).toBe(
        '/tmp/new-sync/ha-widget-profile-sync.json'
      );
      expect(mockUiUtils.showToast).not.toHaveBeenCalledWith(
        expect.anything(),
        'error',
        expect.anything()
      );
    });

    test('keeps the current folder when the file in the new folder is declined', async () => {
      const config = state.CONFIG;
      config.profileSync = buildProfileSync({
        ...config.profileSync,
        enabled: true,
        cloudFilePath: '/tmp/old-sync/ha-widget-profile-sync.json',
        intervalMinutes: 5,
        encryptionEnabled: false,
      });
      state.setConfig(config);
      mockUiUtils.showConfirm.mockResolvedValueOnce(true).mockResolvedValueOnce(false);
      mockElectronAPI.copyProfileSyncFile.mockResolvedValueOnce({
        ok: false,
        status: 'destination_exists',
      });

      await settings.openSettings();
      document.getElementById('profile-sync-enabled').checked = true;
      document.getElementById('profile-sync-folder-path').value = '/tmp/new-sync';
      document.getElementById('profile-sync-encryption-enabled').checked = false;
      await settings.saveSettings();

      expect(state.CONFIG.profileSync.cloudFilePath).toBe(
        '/tmp/old-sync/ha-widget-profile-sync.json'
      );
      expect(mockUiUtils.showToast).toHaveBeenCalledWith(
        'Kept the current sync folder: /tmp/old-sync',
        'info',
        expect.any(Number)
      );
    });

    test('names both folders when asking to move the sync file, and keeping is not a warning', async () => {
      const config = state.CONFIG;
      config.profileSync = buildProfileSync({
        ...config.profileSync,
        enabled: true,
        cloudFilePath: '/tmp/old-sync/ha-widget-profile-sync.json',
        intervalMinutes: 5,
        encryptionEnabled: false,
      });
      state.setConfig(config);
      mockUiUtils.showConfirm.mockResolvedValueOnce(false);

      await settings.openSettings();
      document.getElementById('profile-sync-enabled').checked = true;
      document.getElementById('profile-sync-folder-path').value = '/tmp/new-sync';
      document.getElementById('profile-sync-encryption-enabled').checked = false;
      await settings.saveSettings();

      expect(mockUiUtils.showConfirm).toHaveBeenCalledWith(
        'Sync Folder Changed',
        'Copy the existing sync data file from /tmp/old-sync into /tmp/new-sync and switch sync there?',
        expect.objectContaining({ confirmText: 'Copy & Switch', cancelText: 'Keep Current' })
      );
      expect(mockUiUtils.showToast).toHaveBeenCalledWith(
        'Kept the current sync folder: /tmp/old-sync',
        'info',
        expect.any(Number)
      );
      expect(mockUiUtils.showToast).not.toHaveBeenCalledWith(
        expect.stringContaining('Kept the current'),
        'warning',
        expect.anything()
      );
    });

    test('turning sync on for the first time is not a folder change', async () => {
      // Main reports no folder while sync has never been pointed at one.
      state.CONFIG.profileSync = buildProfileSync({
        enabled: false,
        cloudFilePath: '',
        encryptionEnabled: false,
      });

      await settings.openSettings();
      expect(document.getElementById('profile-sync-folder-path').value).toBe('');
      document.getElementById('profile-sync-enabled').checked = true;
      document.getElementById('profile-sync-folder-path').value = '/tmp/shared-folder';
      document.getElementById('profile-sync-encryption-enabled').checked = false;
      await settings.saveSettings();

      expect(mockUiUtils.showConfirm).not.toHaveBeenCalled();
      expect(mockElectronAPI.copyProfileSyncFile).not.toHaveBeenCalled();
      expect(state.CONFIG.profileSync.cloudFilePath).toBe(
        '/tmp/shared-folder/ha-widget-profile-sync.json'
      );
    });

    test('re-enabling sync in another folder after turning it off is not a folder change either', async () => {
      state.CONFIG.profileSync = buildProfileSync({
        enabled: false,
        cloudFilePath: '/tmp/old-sync/ha-widget-profile-sync.json',
      });

      await settings.openSettings();
      document.getElementById('profile-sync-enabled').checked = true;
      document.getElementById('profile-sync-folder-path').value = '/tmp/new-sync';
      document.getElementById('profile-sync-encryption-enabled').checked = false;
      await settings.saveSettings();

      expect(mockUiUtils.showConfirm).not.toHaveBeenCalled();
      expect(state.CONFIG.profileSync.cloudFilePath).toBe(
        '/tmp/new-sync/ha-widget-profile-sync.json'
      );
    });

    test('sync that is already on without a folder does not block an unrelated save', async () => {
      // Enabled before this fix without picking a folder: it runs on its private file, and main
      // reports no folder for it.
      state.CONFIG.profileSync = buildProfileSync({ enabled: true, cloudFilePath: '' });
      mockElectronAPI.getProfileSyncStatus.mockResolvedValueOnce(
        buildProfileSyncStatus({ enabled: true, cloudFilePath: '' })
      );

      await settings.openSettings();
      expect(document.getElementById('profile-sync-folder-path').value).toBe('');
      await settings.saveSettings();

      expect(mockUiUtils.showToast).not.toHaveBeenCalledWith(
        'Choose a sync folder before enabling profile sync.',
        'error',
        expect.any(Number)
      );
      expect(mockElectronAPI.updateConfig).toHaveBeenCalled();
    });

    test('asks for a folder when sync is turned on without choosing one', async () => {
      state.CONFIG.profileSync = buildProfileSync({ enabled: false, cloudFilePath: '' });

      await settings.openSettings();
      document.getElementById('profile-sync-enabled').checked = true;
      await settings.saveSettings();

      expect(mockUiUtils.showToast).toHaveBeenCalledWith(
        'Choose a sync folder before enabling profile sync.',
        'error',
        expect.any(Number)
      );
      expect(mockElectronAPI.updateConfig).not.toHaveBeenCalled();
    });

    test('a passphrase that is too short stops the save before anything is persisted', async () => {
      state.CONFIG.profileSync = buildProfileSync({ enabled: false, cloudFilePath: '' });

      await settings.openSettings();
      document.getElementById('profile-sync-enabled').checked = true;
      document.getElementById('profile-sync-folder-path').value = '/tmp/shared-folder';
      document.getElementById('profile-sync-encryption-enabled').checked = true;
      document.getElementById('profile-sync-passphrase').value = 'short';
      await settings.saveSettings();

      expect(mockUiUtils.showToast).toHaveBeenCalledWith(
        'Passphrase must be at least 8 characters long',
        'error',
        expect.any(Number)
      );
      expect(mockElectronAPI.updateConfig).not.toHaveBeenCalled();
      expect(mockElectronAPI.setProfileSyncPassphrase).not.toHaveBeenCalled();
      expect(document.activeElement).toBe(document.getElementById('profile-sync-passphrase'));
    });

    test('says what each first-sync choice did', async () => {
      const toastFor = async (choice) => {
        mockUiUtils.showToast.mockClear();
        await settings.openSettings();
        document.getElementById(`profile-sync-resolve-${choice}`).click();
        await new Promise((resolve) => setTimeout(resolve, 0));
        return mockUiUtils.showToast.mock.calls.at(-1);
      };

      expect(await toastFor('cancel')).toEqual([
        'Profile sync turned off. No settings were changed.',
        'success',
        expect.any(Number),
      ]);
      expect(await toastFor('upload')).toEqual([
        'This computer’s settings were uploaded to the sync file.',
        'success',
        expect.any(Number),
      ]);
      expect(await toastFor('remote')).toEqual([
        'Settings downloaded from the sync file.',
        'success',
        expect.any(Number),
      ]);
    });
  });

  describe('Profile sync state in Settings', () => {
    const flush = () => new Promise((resolve) => setTimeout(resolve, 0));
    const lastToast = () => mockUiUtils.showToast.mock.calls.at(-1);
    const openWithRunningSync = async (statusOverrides = {}, savedOverrides = {}) => {
      enableSavedProfileSync(savedOverrides);
      mockElectronAPI.getProfileSyncStatus.mockReset();
      mockElectronAPI.getProfileSyncStatus.mockResolvedValue(
        buildProfileSyncStatus({
          enabled: true,
          provider: 'cloudFile',
          cloudFilePath: '/tmp/shared-folder/ha-widget-profile-sync.json',
          ...statusOverrides,
        })
      );
      await settings.openSettings();
    };
    afterEach(() => {
      mockElectronAPI.getProfileSyncStatus.mockReset();
      mockElectronAPI.getProfileSyncStatus.mockImplementation(() =>
        Promise.resolve(buildProfileSyncStatus({ enabled: false }))
      );
    });

    describe('manual sync buttons', () => {
      test('are answered before any confirmation when sync is not saved yet', async () => {
        await settings.openSettings();
        mockElectronAPI.runProfileSync = jest.fn().mockResolvedValue({ ok: true });
        document.getElementById('profile-sync-enabled').checked = true;
        document.getElementById('profile-sync-folder-path').value = '/tmp/shared-folder';

        for (const id of ['profile-sync-now', 'profile-sync-push-now', 'profile-sync-pull-now']) {
          mockUiUtils.showToast.mockClear();
          document.getElementById(id).click();
          await flush();
          expect(lastToast()).toEqual([
            'Save your settings first to start syncing.',
            'warning',
            expect.any(Number),
          ]);
        }
        expect(mockUiUtils.showConfirm).not.toHaveBeenCalled();
        expect(mockElectronAPI.runProfileSync).not.toHaveBeenCalled();
      });

      test('are answered when a folder or switch changed in the form after saving', async () => {
        await openWithRunningSync();
        mockElectronAPI.runProfileSync = jest.fn().mockResolvedValue({ ok: true });
        document.getElementById('profile-sync-folder-path').value = '/tmp/another-folder';

        document.getElementById('profile-sync-now').click();
        await flush();

        expect(lastToast()[0]).toBe('Save your settings first to start syncing.');
        expect(mockElectronAPI.runProfileSync).not.toHaveBeenCalled();
      });

      describe('when the encryption choice or passphrase in the form is not saved yet', () => {
        // Sync runs against what is saved, so Sync Up would publish in the old mode while the
        // form shows another, and Sync Down would read the file with the old passphrase.
        const syncButtons = ['profile-sync-now', 'profile-sync-push-now', 'profile-sync-pull-now'];
        const expectEveryButtonAskedToSave = async () => {
          mockElectronAPI.runProfileSync = jest.fn().mockResolvedValue({ ok: true });
          for (const id of syncButtons) {
            mockUiUtils.showToast.mockClear();
            document.getElementById(id).click();
            await flush();
            expect(lastToast()).toEqual([
              'Save your settings first to start syncing.',
              'warning',
              expect.any(Number),
            ]);
          }
          expect(mockUiUtils.showConfirm).not.toHaveBeenCalled();
          expect(mockElectronAPI.runProfileSync).not.toHaveBeenCalled();
        };

        test('turning encryption on is answered, not synced in plain text', async () => {
          await openWithRunningSync();
          expect(document.getElementById('profile-sync-encryption-enabled').checked).toBe(false);

          document.getElementById('profile-sync-encryption-enabled').click();

          await expectEveryButtonAskedToSave();
        });

        test('turning encryption off is answered, not synced with the old passphrase', async () => {
          await openWithRunningSync(
            { encryptionEnabled: true, passphraseStored: true },
            { encryptionEnabled: true }
          );
          expect(document.getElementById('profile-sync-encryption-enabled').checked).toBe(true);

          document.getElementById('profile-sync-encryption-enabled').click();

          await expectEveryButtonAskedToSave();
        });

        test('a passphrase typed over the saved one is answered', async () => {
          await openWithRunningSync(
            { encryptionEnabled: true, passphraseStored: true },
            { encryptionEnabled: true }
          );
          const field = document.getElementById('profile-sync-passphrase');
          field.value = 'a new passphrase';
          field.dispatchEvent(new Event('input'));

          await expectEveryButtonAskedToSave();
        });

        test('an unchanged form and a passphrase field left blank still sync', async () => {
          await openWithRunningSync(
            { encryptionEnabled: true, passphraseStored: true },
            { encryptionEnabled: true }
          );
          mockElectronAPI.runProfileSync = jest.fn().mockResolvedValue({ ok: true });
          document.getElementById('profile-sync-passphrase').value = '   ';

          document.getElementById('profile-sync-now').click();
          await flush();

          expect(mockElectronAPI.runProfileSync).toHaveBeenCalledWith('auto');
        });

        test('a waiting encryption change is compared as the form draws it', async () => {
          // The checkbox shows the change that was asked for, so leaving it alone is not an edit
          // (sync then says the change comes first) and turning it back is.
          await openWithRunningSync(
            { encryptionChangePending: true },
            { encryptionChangePending: true }
          );
          expect(document.getElementById('profile-sync-encryption-enabled').checked).toBe(true);
          mockElectronAPI.runProfileSync = jest.fn();

          document.getElementById('profile-sync-now').click();
          await flush();
          expect(lastToast()[0]).toBe('Finish or cancel the pending encryption change first.');

          document.getElementById('profile-sync-encryption-enabled').click();
          await expectEveryButtonAskedToSave();
        });
      });

      test('say a pending choice or encryption change comes first, not that sync failed', async () => {
        await openWithRunningSync({ needsResolution: true });
        mockElectronAPI.runProfileSync = jest.fn();
        document.getElementById('profile-sync-now').click();
        await flush();
        expect(lastToast()).toEqual([
          'Resolve first-time sync conflict before syncing.',
          'warning',
          expect.any(Number),
        ]);

        await openWithRunningSync({ encryptionChangePending: true });
        document.getElementById('profile-sync-now').click();
        await flush();
        expect(lastToast()).toEqual([
          'Finish or cancel the pending encryption change first.',
          'warning',
          expect.any(Number),
        ]);
        expect(mockElectronAPI.runProfileSync).not.toHaveBeenCalled();
      });

      test.each([
        ['in_flight', 'A sync is already running. Try again in a moment.', 'info'],
        ['disabled', 'Save your settings first to start syncing.', 'warning'],
        [
          'encryption_change_pending',
          'Finish or cancel the pending encryption change first.',
          'warning',
        ],
        ['rewrite_pending', 'Finish or cancel the pending encryption change first.', 'warning'],
      ])('a run main declined as %s is not a red failure', async (reason, text, type) => {
        await openWithRunningSync();
        mockElectronAPI.runProfileSync = jest.fn().mockResolvedValue({ ok: false, reason });
        document.getElementById('profile-sync-now').click();
        await flush();
        expect(lastToast()).toEqual([text, type, expect.any(Number)]);
      });

      test('a real failure still shows its message as an error', async () => {
        await openWithRunningSync();
        mockElectronAPI.runProfileSync = jest
          .fn()
          .mockResolvedValue({ ok: false, error: 'The sync file is damaged.' });
        document.getElementById('profile-sync-now').click();
        await flush();
        expect(lastToast()).toEqual(['The sync file is damaged.', 'error', expect.any(Number)]);
      });

      test('Sync Down says so when nothing was downloaded', async () => {
        await openWithRunningSync();
        mockUiUtils.showConfirm.mockResolvedValue(true);

        mockElectronAPI.runProfileSync = jest.fn().mockResolvedValue({
          ok: true,
          action: 'none',
          status: buildProfileSyncStatus({ enabled: true, lastRemoteUpdatedAt: null }),
        });
        document.getElementById('profile-sync-pull-now').click();
        await flush();
        expect(lastToast()).toEqual(['No sync file found yet.', 'info', expect.any(Number)]);

        mockElectronAPI.runProfileSync = jest.fn().mockResolvedValue({
          ok: true,
          action: 'none',
          status: buildProfileSyncStatus({
            enabled: true,
            lastRemoteUpdatedAt: '2026-10-01T08:00:00.000Z',
          }),
        });
        document.getElementById('profile-sync-pull-now').click();
        await flush();
        expect(lastToast()).toEqual([
          'This computer already matches the sync file.',
          'info',
          expect.any(Number),
        ]);
      });

      test('are disabled while a run is in flight', async () => {
        await openWithRunningSync({ inFlight: true });
        for (const id of ['profile-sync-now', 'profile-sync-push-now', 'profile-sync-pull-now']) {
          expect(document.getElementById(id).disabled).toBe(true);
        }
        settings.handleProfileSyncStatusUpdate(
          buildProfileSyncStatus({ enabled: true, inFlight: false })
        );
        expect(document.getElementById('profile-sync-now').disabled).toBe(false);
      });
    });

    describe('settings pulled while the window is open', () => {
      const pulledConfig = () => ({
        ...JSON.parse(JSON.stringify(state.CONFIG)),
        opacity: 0.6,
      });

      test('Sync Down rebuilds the form, so Save does not write the old values back', async () => {
        await openWithRunningSync();
        mockUiUtils.showConfirm.mockResolvedValue(true);
        const before = document.getElementById('opacity-slider').value;
        mockElectronAPI.runProfileSync = jest.fn().mockResolvedValue({
          ok: true,
          action: 'pull',
          config: pulledConfig(),
          status: buildProfileSyncStatus({ enabled: true }),
        });

        document.getElementById('profile-sync-pull-now').click();
        await flush();
        await flush();

        expect(state.CONFIG.opacity).toBe(0.6);
        expect(document.getElementById('opacity-slider').value).not.toBe(before);

        mockElectronAPI.updateConfig.mockClear();
        await settings.saveSettings();
        expect(mockElectronAPI.updateConfig.mock.calls[0][0].opacity).toBe(0.6);
      });

      test('says when unsaved edits were discarded by the pull', async () => {
        await openWithRunningSync();
        mockUiUtils.showConfirm.mockResolvedValue(true);
        const opacity = document.getElementById('opacity-slider');
        opacity.value = '70';
        opacity.dispatchEvent(new Event('input', { bubbles: true }));
        mockElectronAPI.runProfileSync = jest.fn().mockResolvedValue({
          ok: true,
          action: 'pull',
          config: pulledConfig(),
          status: buildProfileSyncStatus({ enabled: true }),
        });

        document.getElementById('profile-sync-pull-now').click();
        await flush();
        await flush();

        expect(lastToast()).toEqual([
          'Synced settings were applied. Unsaved changes in this window were discarded.',
          'warning',
          expect.any(Number),
        ]);
      });

      test('restoring a backup rebuilds the form too', async () => {
        mockElectronAPI.listProfileSyncBackups = jest.fn().mockResolvedValue({
          success: true,
          backups: [
            {
              id: 'local-profile-1771840800000.json',
              kind: 'local',
              createdAt: '2026-02-23T10:00:00.000Z',
              sections: ['visualPersonalization'],
            },
          ],
        });
        mockElectronAPI.restoreProfileSyncBackup = jest
          .fn()
          .mockResolvedValue({ success: true, config: pulledConfig() });
        await openWithRunningSync();
        await flush();
        const before = document.getElementById('opacity-slider').value;

        document.getElementById('profile-sync-restore-backup').click();
        await flush();
        await flush();

        expect(document.getElementById('opacity-slider').value).not.toBe(before);
        expect(lastToast()[0]).toBe('Backup restored.');
      });

      test('Use Remote rebuilds the form with the file’s settings', async () => {
        await openWithRunningSync({
          needsResolution: true,
          conflictSections: ['visualPersonalization'],
        });
        const before = document.getElementById('opacity-slider').value;
        mockElectronAPI.resolveProfileSyncFirstEnable = jest.fn().mockResolvedValue({
          success: true,
          config: pulledConfig(),
          status: buildProfileSyncStatus({ enabled: true }),
        });

        document.getElementById('profile-sync-resolve-remote').click();
        await flush();
        await flush();

        expect(document.getElementById('opacity-slider').value).not.toBe(before);
        expect(lastToast()[0]).toBe('Settings downloaded from the sync file.');
      });
    });

    describe('an encryption change that is waiting', () => {
      test('is drawn as asked for, with a way to give it up', async () => {
        await openWithRunningSync(
          { encryptionEnabled: false, encryptionChangePending: true },
          { encryptionEnabled: false, encryptionChangePending: true }
        );

        expect(document.getElementById('profile-sync-encryption-enabled').checked).toBe(true);
        expect(
          document.getElementById('profile-sync-passphrase-group').classList.contains('hidden')
        ).toBe(false);
        expect(
          document
            .getElementById('profile-sync-cancel-encryption-change')
            .classList.contains('hidden')
        ).toBe(false);
        expect(document.getElementById('profile-sync-error').textContent).toContain(
          'Encryption is not on yet.'
        );
        expect(document.getElementById('profile-sync-error').textContent).toContain(
          'press Cancel change'
        );
      });

      test('saving with the switch as drawn finishes the change instead of cancelling it', async () => {
        await openWithRunningSync(
          { encryptionEnabled: false, encryptionChangePending: true },
          { encryptionEnabled: false, encryptionChangePending: true }
        );
        mockElectronAPI.setProfileSyncPassphrase.mockResolvedValueOnce({
          success: true,
          remembered: false,
          encrypted: false,
        });
        document.getElementById('profile-sync-passphrase').value = 'long enough';
        document.getElementById('profile-sync-passphrase-confirm').value = 'long enough';

        await settings.saveSettings();

        expect(mockElectronAPI.setProfileSyncPassphrase).toHaveBeenCalledWith(
          'long enough',
          false,
          true
        );
      });

      test('Cancel change asks main to keep the mode already in force, and says so', async () => {
        await openWithRunningSync(
          { encryptionEnabled: false, encryptionChangePending: true },
          { encryptionEnabled: false, encryptionChangePending: true }
        );
        const settled = { ...state.CONFIG.profileSync, encryptionChangePending: null };
        mockElectronAPI.setProfileSyncPassphrase.mockResolvedValueOnce({
          success: true,
          config: { ...state.CONFIG, profileSync: settled },
          status: buildProfileSyncStatus({
            enabled: true,
            encryptionEnabled: false,
            encryptionChangePending: null,
          }),
        });

        document.getElementById('profile-sync-cancel-encryption-change').click();
        await flush();

        expect(mockElectronAPI.setProfileSyncPassphrase).toHaveBeenCalledWith('', false, false);
        expect(lastToast()).toEqual(['Encryption change canceled.', 'info', expect.any(Number)]);
        expect(document.getElementById('profile-sync-encryption-enabled').checked).toBe(false);
        expect(
          document
            .getElementById('profile-sync-cancel-encryption-change')
            .classList.contains('hidden')
        ).toBe(true);
      });
    });

    describe('the passphrase fields', () => {
      const choosePassphraseFor = async (statusOverrides) => {
        await openWithRunningSync(statusOverrides);
        const switchEl = document.getElementById('profile-sync-encryption-enabled');
        switchEl.checked = true;
        switchEl.dispatchEvent(new Event('change'));
      };
      const confirmGroupHidden = () =>
        document
          .getElementById('profile-sync-passphrase-confirm-group')
          .classList.contains('hidden');

      test('ask for the passphrase twice while one is being chosen', async () => {
        await choosePassphraseFor({ remoteEncrypted: false });
        expect(confirmGroupHidden()).toBe(false);

        document.getElementById('profile-sync-passphrase').value = 'long enough';
        document.getElementById('profile-sync-passphrase-confirm').value = 'long enough!';
        mockElectronAPI.updateConfig.mockClear();
        await settings.saveSettings();

        expect(lastToast()).toEqual(['The passphrases do not match.', 'error', expect.any(Number)]);
        expect(mockElectronAPI.updateConfig).not.toHaveBeenCalled();
        expect(document.activeElement).toBe(
          document.getElementById('profile-sync-passphrase-confirm')
        );
      });

      test('ask only once when joining a file that is already encrypted', async () => {
        await choosePassphraseFor({ remoteEncrypted: true });
        expect(confirmGroupHidden()).toBe(true);
      });

      test('ask only once while a passphrase is already saved and nothing new is typed, and say so', async () => {
        await choosePassphraseFor({ remoteEncrypted: false, passphraseStored: true });
        expect(confirmGroupHidden()).toBe(true);
        expect(document.getElementById('profile-sync-passphrase').placeholder).toBe(
          'Saved on this device. Type a new one to change it.'
        );
      });

      test('ask twice once a new passphrase is typed over a saved one, for it re-encrypts the file', async () => {
        await choosePassphraseFor({ remoteEncrypted: true, passphraseStored: true });
        const input = document.getElementById('profile-sync-passphrase');

        input.value = 'a different one';
        input.dispatchEvent(new Event('input'));
        expect(confirmGroupHidden()).toBe(false);

        input.value = '';
        input.dispatchEvent(new Event('input'));
        expect(confirmGroupHidden()).toBe(true);

        input.value = 'a different one';
        input.dispatchEvent(new Event('input'));
        document.getElementById('profile-sync-passphrase-confirm').value = 'a different on';
        mockElectronAPI.updateConfig.mockClear();
        await settings.saveSettings();

        expect(lastToast()).toEqual(['The passphrases do not match.', 'error', expect.any(Number)]);
        expect(mockElectronAPI.updateConfig).not.toHaveBeenCalled();
      });

      test('ask twice once a new passphrase is typed over one kept only for this session', async () => {
        // Main rewrites the file under the new key here too, so a typo would lock it.
        await choosePassphraseFor({
          remoteEncrypted: true,
          passphraseStored: false,
          passphraseActive: true,
        });
        const input = document.getElementById('profile-sync-passphrase');
        expect(confirmGroupHidden()).toBe(true);
        expect(input.placeholder).toBe('Enter passphrase (min 8 chars)');

        input.value = 'a different one';
        input.dispatchEvent(new Event('input'));
        expect(confirmGroupHidden()).toBe(false);

        document.getElementById('profile-sync-passphrase-confirm').value = 'a different on';
        mockElectronAPI.updateConfig.mockClear();
        await settings.saveSettings();

        expect(lastToast()).toEqual(['The passphrases do not match.', 'error', expect.any(Number)]);
        expect(mockElectronAPI.updateConfig).not.toHaveBeenCalled();

        input.value = '';
        input.dispatchEvent(new Event('input'));
        expect(confirmGroupHidden()).toBe(true);
      });

      test('can be shown and hidden', async () => {
        await choosePassphraseFor({ remoteEncrypted: false });
        const reveal = document.getElementById('profile-sync-passphrase-reveal');
        const input = document.getElementById('profile-sync-passphrase');

        reveal.click();
        expect(input.type).toBe('text');
        expect(document.getElementById('profile-sync-passphrase-confirm').type).toBe('text');
        // The label stays: aria-pressed alone says which way the button is set.
        expect(reveal.getAttribute('aria-pressed')).toBe('true');
        expect(reveal.textContent).toBe('Show passphrase');

        reveal.click();
        expect(input.type).toBe('password');
        expect(reveal.getAttribute('aria-pressed')).toBe('false');
        expect(reveal.textContent).toBe('Show passphrase');
      });

      test('disabling encryption needs no passphrase when the file is already plain text', async () => {
        await openWithRunningSync(
          { encryptionEnabled: true, remoteEncrypted: false },
          { encryptionEnabled: true }
        );
        document.getElementById('profile-sync-encryption-enabled').checked = false;
        mockElectronAPI.setProfileSyncPassphrase.mockResolvedValueOnce({ success: true });

        await settings.saveSettings();

        expect(mockElectronAPI.setProfileSyncPassphrase).toHaveBeenCalledWith('', false, false);
      });

      test('disabling encryption still needs the passphrase while the file is encrypted', async () => {
        await openWithRunningSync(
          { encryptionEnabled: true, remoteEncrypted: true },
          { encryptionEnabled: true }
        );
        document.getElementById('profile-sync-encryption-enabled').checked = false;
        mockElectronAPI.updateConfig.mockClear();

        await settings.saveSettings();

        expect(lastToast()[0]).toBe(
          'Enter the current remote passphrase before disabling encrypted sync.'
        );
        expect(mockElectronAPI.updateConfig).not.toHaveBeenCalled();
      });

      test('clearing the saved passphrase warns that syncing pauses', async () => {
        await openWithRunningSync({ encryptionEnabled: true, passphraseStored: true });
        document.getElementById('profile-sync-clear-passphrase').click();
        await flush();

        expect(mockUiUtils.showConfirm).toHaveBeenCalledWith(
          'Clear Saved Passphrase',
          'Remove the saved sync passphrase from this device? Syncing stays paused until you enter it again.',
          expect.anything()
        );
      });
    });

    describe('the status line', () => {
      const errorToggle = () => document.getElementById('profile-sync-error-toggle');
      const errorLine = () => document.getElementById('profile-sync-error');
      const fitsOnTwoLines = (fits) => {
        // jsdom has no layout, so say what the browser would measure.
        Object.defineProperty(errorLine(), 'scrollHeight', {
          configurable: true,
          value: fits ? 34 : 90,
        });
        Object.defineProperty(errorLine(), 'clientHeight', { configurable: true, value: 34 });
      };
      const failedSync = (lastSyncError) =>
        buildProfileSyncStatus({ enabled: true, lastSyncStatus: 'error', lastSyncError });

      test('marks a run in progress without changing the line', async () => {
        await openWithRunningSync({ inFlight: true });
        const status = document.getElementById('profile-sync-status');
        expect(status.dataset.busy).toBe('true');
        expect(status.textContent).toBe('Sync in progress...');

        settings.handleProfileSyncStatusUpdate(
          buildProfileSyncStatus({ enabled: true, inFlight: false })
        );
        expect(status.dataset.busy).toBe('false');
      });

      test('keeps the error where it is, and offers Details only for text that does not fit', async () => {
        await openWithRunningSync();
        fitsOnTwoLines(true);
        settings.handleProfileSyncStatusUpdate(failedSync('The sync file is in use.'));
        expect(errorLine().textContent).toBe('The sync file is in use.');
        expect(errorLine().classList.contains('hidden')).toBe(false);
        expect(errorToggle().classList.contains('hidden')).toBe(true);

        fitsOnTwoLines(false);
        settings.handleProfileSyncStatusUpdate(failedSync('A much longer explanation. '.repeat(8)));
        expect(errorToggle().classList.contains('hidden')).toBe(false);
        expect(errorLine().classList.contains('is-clamped')).toBe(true);
        expect(errorToggle().getAttribute('aria-expanded')).toBe('false');
      });

      test('opens the whole error on Details, and keeps it open for the same text', async () => {
        await openWithRunningSync();
        fitsOnTwoLines(false);
        const status = failedSync('A much longer explanation. '.repeat(8));
        settings.handleProfileSyncStatusUpdate(status);

        errorToggle().click();
        expect(errorLine().classList.contains('is-clamped')).toBe(false);
        expect(errorToggle().getAttribute('aria-expanded')).toBe('true');

        // Open, the text fits itself, but the way back to two lines stays.
        fitsOnTwoLines(true);
        settings.handleProfileSyncStatusUpdate(status);
        expect(errorLine().classList.contains('is-clamped')).toBe(false);
        expect(errorToggle().classList.contains('hidden')).toBe(false);

        // Another error starts closed again.
        settings.handleProfileSyncStatusUpdate(failedSync('Something else went wrong. '.repeat(8)));
        expect(errorLine().classList.contains('is-clamped')).toBe(true);
        expect(errorToggle().getAttribute('aria-expanded')).toBe('false');
      });
    });

    describe('a sync that needs the person', () => {
      test('keeps Settings open on Advanced when a first-sync choice is waiting', async () => {
        state.CONFIG.profileSync = buildProfileSync({ enabled: false, cloudFilePath: '' });
        mockElectronAPI.getProfileSyncStatus.mockReset();
        mockElectronAPI.getProfileSyncStatus.mockResolvedValue(
          buildProfileSyncStatus({
            enabled: true,
            needsResolution: true,
            conflictSections: ['visualPersonalization'],
          })
        );
        await settings.openSettings();
        const advancedTab = document.createElement('button');
        advancedTab.className = 'tab-link';
        advancedTab.dataset.tab = 'advanced';
        const tabs = document.createElement('div');
        tabs.className = 'modal-tabs';
        tabs.appendChild(advancedTab);
        document.getElementById('settings-modal').appendChild(tabs);
        const openedTab = jest.fn();
        advancedTab.addEventListener('click', openedTab);
        document.getElementById('profile-sync-enabled').checked = true;
        document.getElementById('profile-sync-folder-path').value = '/tmp/shared-folder';
        document.getElementById('profile-sync-encryption-enabled').checked = false;
        const modal = document.getElementById('settings-modal');

        await settings.saveSettings();

        expect(modal.classList.contains('hidden')).toBe(false);
        expect(openedTab).toHaveBeenCalled();
        expect(lastToast()).toEqual([
          'Waiting for your choice below.',
          'warning',
          expect.any(Number),
        ]);
      });

      test('closes as usual when nothing waits on the person', async () => {
        await settings.openSettings();
        await settings.saveSettings();
        expect(document.getElementById('settings-modal').classList.contains('hidden')).toBe(true);
      });

      test('closes as usual for an unrelated change while a first-sync choice stays postponed', async () => {
        await openWithRunningSync({ needsResolution: true });
        mockUiUtils.showToast.mockClear();

        await settings.saveSettings();

        expect(document.getElementById('settings-modal').classList.contains('hidden')).toBe(true);
        expect(mockUiUtils.showToast).not.toHaveBeenCalledWith(
          'Waiting for your choice below.',
          expect.anything(),
          expect.anything()
        );
      });

      test('closes as usual when the folder switch that would have changed the sync is declined', async () => {
        await openWithRunningSync({ needsResolution: true });
        document.getElementById('profile-sync-folder-path').value = '/tmp/another-folder';
        mockUiUtils.showConfirm.mockResolvedValueOnce(false);

        await settings.saveSettings();

        expect(document.getElementById('settings-modal').classList.contains('hidden')).toBe(true);
      });

      test('comes back to a postponed first-sync choice when the save changes the sync', async () => {
        await openWithRunningSync({ needsResolution: true });
        document.getElementById('profile-sync-folder-path').value = '/tmp/another-folder';
        mockUiUtils.showConfirm.mockResolvedValueOnce(true);

        await settings.saveSettings();

        expect(document.getElementById('settings-modal').classList.contains('hidden')).toBe(false);
        expect(lastToast()).toEqual([
          'Waiting for your choice below.',
          'warning',
          expect.any(Number),
        ]);
      });

      test.each([
        [
          'a long refusal time to be read',
          'Secure system storage is unavailable, and changing the encryption of an existing sync file needs it. On Linux, start and unlock a keyring such as GNOME Keyring or KWallet, then restart the widget.',
          10000,
        ],
        ['a short refusal the usual time', 'That passphrase does not unlock the sync file.', 5000],
      ])('gives %s', async (_label, reason, timeout) => {
        await settings.openSettings();
        document.getElementById('profile-sync-enabled').checked = true;
        document.getElementById('profile-sync-folder-path').value = '/tmp/shared-folder';
        document.getElementById('profile-sync-encryption-enabled').checked = true;
        document.getElementById('profile-sync-passphrase').value = 'long enough';
        document.getElementById('profile-sync-passphrase-confirm').value = 'long enough';
        mockElectronAPI.setProfileSyncPassphrase.mockResolvedValueOnce({
          success: false,
          error: reason,
        });

        await settings.saveSettings();

        expect(lastToast()).toEqual([reason, 'warning', timeout]);
      });

      test('keeps Settings open when the passphrase was refused', async () => {
        await settings.openSettings();
        document.getElementById('profile-sync-enabled').checked = true;
        document.getElementById('profile-sync-folder-path').value = '/tmp/shared-folder';
        document.getElementById('profile-sync-encryption-enabled').checked = true;
        document.getElementById('profile-sync-passphrase').value = 'long enough';
        document.getElementById('profile-sync-passphrase-confirm').value = 'long enough';
        mockElectronAPI.setProfileSyncPassphrase.mockResolvedValueOnce({
          success: false,
          error: 'That passphrase does not unlock the sync file.',
        });

        await settings.saveSettings();

        expect(document.getElementById('settings-modal').classList.contains('hidden')).toBe(false);
      });

      test.each([
        [{ enabled: true, needsResolution: true }, true],
        [{ enabled: true, lastSyncStatus: 'error' }, true],
        [{ enabled: true, encryptionChangePending: false }, true],
        [{ enabled: true, rewriteRecoveryRequired: true }, true],
        [{ enabled: true, lastSyncStatus: 'success' }, false],
        [{ enabled: true, encryptionChangePending: null }, false],
        [{ enabled: false, lastSyncStatus: 'error' }, false],
      ])('profileSyncNeedsAttention(%j) is %s', (status, expected) => {
        expect(settings.profileSyncNeedsAttention(status)).toBe(expected);
      });
    });
  });

  describe('Alert Config Dialog', () => {
    beforeEach(() => {
      document.body.insertAdjacentHTML(
        'beforeend',
        `<div id="alert-config-modal" class="modal hidden" style="display: none">
          <div class="modal-content">
            <div class="modal-header"><h2 id="alert-config-title">Configure Alert</h2></div>
            <div class="modal-body">
              <div class="form-group">
                <div class="alert-type-options">
                  <input type="radio" name="alert-type" value="state-change" checked />
                  <input type="radio" name="alert-type" value="specific-state" />
                </div>
              </div>
              <div class="form-group" id="specific-state-group" style="display: none">
                <input type="text" id="target-state-input" />
              </div>
            </div>
          </div>
        </div>`
      );
      mockUiUtils.showToast.mockClear();
      mockElectronAPI.updateConfig.mockClear();
    });

    test('renders the alert type label as text, never as markup', () => {
      document.body.insertAdjacentHTML('beforeend', '<div id="inline-alerts-list"></div>');
      state.CONFIG.entityAlerts = {
        enabled: true,
        alerts: {
          'light.living_room': {
            onSpecificState: true,
            targetState: '<img src=x onerror="window.pwned = true">',
          },
        },
      };
      settings.renderAlertsListInline();
      const label = document.querySelector('#inline-alerts-list .alert-type');
      expect(label.textContent).toContain('<img src=x onerror="window.pwned = true">');
      expect(document.querySelector('#inline-alerts-list img')).toBeNull();
      document.getElementById('inline-alerts-list').remove();
    });

    describe('what the alert lists and the dialog say about numbers and buttons', () => {
      const temperatureAlert = (extra = {}) => ({
        onNumericThreshold: true,
        comparison: 'above',
        threshold: 25,
        ...extra,
      });
      const renderRow = (entityId, alert) => {
        document.body.insertAdjacentHTML('beforeend', '<div id="inline-alerts-list"></div>');
        state.STATES[entityId] = state.STATES[entityId] || {
          entity_id: entityId,
          state: '21.5',
          attributes: { friendly_name: 'Office temperature', unit_of_measurement: '°C' },
        };
        state.CONFIG.entityAlerts = { enabled: true, alerts: { [entityId]: alert } };
        settings.renderAlertsListInline();
        return document.querySelector('#inline-alerts-list .alert-item');
      };
      afterEach(() => document.getElementById('inline-alerts-list')?.remove());

      test('a threshold rule reads "Above 25 °C", with the entity unit', () => {
        const row = renderRow('sensor.office_temperature', temperatureAlert());
        expect(row.querySelector('.alert-type').textContent).toBe('Above 25 °C');
      });

      test('a below rule, and a unitless sensor, read without a dangling "threshold"', () => {
        state.STATES['sensor.counter'] = {
          entity_id: 'sensor.counter',
          state: '4',
          attributes: { friendly_name: 'Counter' },
        };
        const row = renderRow('sensor.counter', temperatureAlert({ comparison: 'below' }));
        expect(row.querySelector('.alert-type').textContent).toBe('Below 25');
        delete state.STATES['sensor.counter'];
      });

      test('a rule for one state names it in a sentence', () => {
        const row = renderRow('sensor.office_temperature', {
          onSpecificState: true,
          targetState: 'unavailable',
        });
        expect(row.querySelector('.alert-type').textContent).toBe('When state is unavailable');
      });

      test('Edit and Remove are grouped under the name of the entity they are for', () => {
        const row = renderRow('sensor.office_temperature', temperatureAlert());
        const group = row.querySelector('.alert-actions');
        expect(group.getAttribute('role')).toBe('group');
        expect(group.getAttribute('aria-label')).toBe(row.querySelector('.alert-name').textContent);
        expect(group.getAttribute('aria-label')).not.toBe('');
      });

      test('the dialog says what the duration and the cooldown mean, and what 0 does', () => {
        settings.openAlertConfigModal('sensor.office_temperature');

        const help = (id) => document.getElementById(`${id}-help`);
        expect(help('alert-duration').textContent).toBe(
          'Only notify if the condition lasts this long. 0 = immediately.'
        );
        expect(help('alert-cooldown').textContent).toBe(
          'Wait at least this long between notifications. 0 = no limit.'
        );
        for (const id of ['alert-duration', 'alert-cooldown', 'alert-threshold']) {
          const input = document.getElementById(id);
          expect(input.getAttribute('aria-describedby')).toBe(`${id}-help`);
          // The name stays the label's own words; the help is only the description.
          expect(document.getElementById(input.getAttribute('aria-labelledby')).textContent).toBe(
            input.closest('label').querySelector('[data-alert-label-key]').textContent
          );
        }
      });

      test('the threshold shows the current reading in the sensor unit', () => {
        state.STATES['sensor.office_temperature'] = {
          entity_id: 'sensor.office_temperature',
          state: '21.5',
          attributes: { friendly_name: 'Office temperature', unit_of_measurement: '°C' },
        };

        settings.openAlertConfigModal('sensor.office_temperature');

        expect(document.getElementById('alert-threshold-help').textContent).toBe(
          'Currently 21.5 °C'
        );
      });

      test('a sensor with no number yet still names the unit, and one without either says nothing', () => {
        state.STATES['sensor.office_temperature'] = {
          entity_id: 'sensor.office_temperature',
          state: 'unavailable',
          attributes: { friendly_name: 'Office temperature', unit_of_measurement: '°C' },
        };
        settings.openAlertConfigModal('sensor.office_temperature');
        expect(document.getElementById('alert-threshold-help').textContent).toBe('In °C');

        state.STATES['sensor.office_temperature'].attributes = {};
        settings.openAlertConfigModal('sensor.office_temperature');
        expect(document.getElementById('alert-threshold-help').textContent).toBe('');
      });
    });

    test('quiet hour times follow the quiet hours toggle', () => {
      settings.openAlertConfigModal('sensor.office_temperature');

      const toggle = document.getElementById('alert-quiet-enabled');
      const start = document.getElementById('alert-quiet-start');
      const end = document.getElementById('alert-quiet-end');
      expect(toggle.checked).toBe(false);
      expect(start.disabled).toBe(true);
      expect(end.disabled).toBe(true);

      toggle.checked = true;
      toggle.dispatchEvent(new Event('change'));
      expect(start.disabled).toBe(false);
      expect(end.disabled).toBe(false);
    });

    test('saves on Enter in a single-line field, but not on a switch', async () => {
      settings.openAlertConfigModal('sensor.office_temperature');
      const modal = document.getElementById('alert-config-modal');
      const duration = document.getElementById('alert-duration');
      const press = (target) => {
        const event = new KeyboardEvent('keydown', {
          key: 'Enter',
          bubbles: true,
          cancelable: true,
        });
        target.dispatchEvent(event);
        return event;
      };

      // A bad value reaches saveAlert's own validation, which proves Enter ran the save.
      duration.value = '90000';
      expect(press(duration).defaultPrevented).toBe(true);
      await Promise.resolve();
      expect(mockUiUtils.showToast).toHaveBeenCalledWith(
        'Enter a whole number of seconds from 0 to 86400.',
        'error'
      );

      mockUiUtils.showToast.mockClear();
      expect(press(document.getElementById('alert-quiet-enabled')).defaultPrevented).toBe(false);
      expect(mockUiUtils.showToast).not.toHaveBeenCalled();

      // Opening again must not stack a second listener.
      settings.openAlertConfigModal('sensor.office_temperature');
      document.getElementById('alert-duration').value = '90000';
      press(document.getElementById('alert-duration'));
      await Promise.resolve();
      expect(mockUiUtils.showToast).toHaveBeenCalledTimes(1);
      expect(modal.getAttribute('role')).toBe('dialog');
    });

    test('rejects out-of-range durations with a toast instead of a native bubble', async () => {
      settings.openAlertConfigModal('sensor.office_temperature');
      const duration = document.getElementById('alert-duration');
      duration.value = '90000';

      await settings.saveAlert();

      expect(mockUiUtils.showToast).toHaveBeenCalledWith(
        'Enter a whole number of seconds from 0 to 86400.',
        'error'
      );
      expect(document.activeElement).toBe(duration);
      expect(mockElectronAPI.updateConfig).not.toHaveBeenCalled();
    });
  });

  describe('Keyboard and focus in Settings', () => {
    const press = (target, key, init = {}) => {
      const event = new KeyboardEvent('keydown', {
        key,
        bubbles: true,
        cancelable: true,
        ...init,
      });
      target.dispatchEvent(event);
      return event;
    };
    const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

    describe('the dialog itself', () => {
      test('closes on Escape like Cancel, but not on a click that misses a control', async () => {
        await settings.openSettings();
        const modal = document.getElementById('settings-modal');

        modal.click();
        expect(modal.classList.contains('hidden')).toBe(false);

        expect(press(document.getElementById('ha-url'), 'Escape').defaultPrevented).toBe(true);
        expect(modal.classList.contains('hidden')).toBe(true);
      });

      test('leaves Escape to a control that used it, such as an open dropdown or picker', async () => {
        await settings.openSettings();
        const modal = document.getElementById('settings-modal');
        const field = document.getElementById('ha-url');
        field.addEventListener('keydown', (event) => event.preventDefault());

        press(field, 'Escape');

        expect(modal.classList.contains('hidden')).toBe(false);
      });

      test('collapsed sections are inert, so Tab and screen readers skip what is not shown', async () => {
        await settings.openSettings();
        const section = document.getElementById('color-themes-section');
        const body = section.querySelector('.section-body');

        expect(section.classList.contains('collapsed')).toBe(true);
        expect(body.inert).toBe(true);

        document.getElementById('color-themes-toggle').click();
        expect(section.classList.contains('collapsed')).toBe(false);
        expect(body.inert).toBe(false);

        document.getElementById('color-themes-toggle').click();
        expect(body.inert).toBe(true);
      });
    });

    describe('the colour swatches', () => {
      const swatches = () => [...document.querySelectorAll('#theme-options .color-theme-option')];

      test('are one Tab stop, on the chosen swatch', async () => {
        await settings.openSettings();

        const stops = swatches().filter((swatch) => swatch.tabIndex === 0);
        expect(swatches().length).toBeGreaterThan(2);
        expect(stops).toHaveLength(1);
        expect(stops[0].getAttribute('aria-checked')).toBe('true');
      });

      test('answer the arrows, Home and End by choosing and focusing the neighbour', async () => {
        await settings.openSettings();
        const [first, second] = swatches();
        first.focus();

        expect(press(first, 'ArrowRight').defaultPrevented).toBe(true);
        expect(document.activeElement).toBe(second);
        expect(second.getAttribute('aria-checked')).toBe('true');
        expect(first.getAttribute('aria-checked')).toBe('false');
        expect(second.tabIndex).toBe(0);
        expect(first.tabIndex).toBe(-1);

        press(second, 'End');
        expect(document.activeElement).toBe(swatches().at(-1));
        press(swatches().at(-1), 'Home');
        expect(document.activeElement).toBe(swatches()[0]);
        // Along the row the arrows wrap, and the vertical ones do the same.
        press(swatches()[0], 'ArrowLeft');
        expect(document.activeElement).toBe(swatches().at(-1));
        press(swatches().at(-1), 'ArrowDown');
        expect(document.activeElement).toBe(swatches()[0]);
      });

      test('leave a key with a modifier alone, so shortcuts keep working', async () => {
        await settings.openSettings();
        const [first] = swatches();
        first.focus();

        expect(press(first, 'ArrowRight', { ctrlKey: true }).defaultPrevented).toBe(false);
        expect(document.activeElement).toBe(first);
      });
    });

    describe('the popup hotkey recorder', () => {
      // A recording left on would listen on the document for every test after it.
      afterEach(() => settings.closeSettings());
      const recorder = () => ({
        input: document.getElementById('popup-hotkey-input'),
        setBtn: document.getElementById('popup-hotkey-set-btn'),
        clearBtn: document.getElementById('popup-hotkey-clear-btn'),
        preset: document.querySelector('.preset-hotkey-btn'),
      });
      const open = async () => {
        mockElectronAPI.isPopupHotkeyAvailable.mockResolvedValue(true);
        await settings.openSettings();
        // The card wires itself up a moment after the dialog opens.
        await tick();
        await tick();
        const parts = recorder();
        parts.setBtn.click();
        return parts;
      };

      test('says how to stop, and keeps the footer Cancel from being the only one', async () => {
        const { input, setBtn, preset } = await open();

        expect(input.value).toBe('Press keys... (Esc to cancel)');
        // The footer's Cancel throws away the whole form; this one only ends the recording.
        expect(setBtn.textContent).toBe('Stop recording');
        expect(preset.disabled).toBe(true);
      });

      test('Escape ends the recording instead of being offered as the hotkey', async () => {
        const { input, setBtn, preset } = await open();
        mockElectronAPI.registerPopupHotkey.mockClear();
        mockUiUtils.showToast.mockClear();

        const event = press(document.body, 'Escape');
        await tick();

        expect(event.defaultPrevented).toBe(true);
        expect(mockElectronAPI.registerPopupHotkey).not.toHaveBeenCalled();
        expect(mockUiUtils.showToast).not.toHaveBeenCalled();
        expect(setBtn.textContent).toBe('Set hotkey');
        expect(preset.disabled).toBe(false);
        expect(input.value).toBe(state.CONFIG.popupHotkey || '');
        // And Settings is still open: the key was the recorder's.
        expect(document.getElementById('settings-modal').classList.contains('hidden')).toBe(false);
      });

      test('Tab leaves the field and ends the recording, and is not swallowed', async () => {
        const { setBtn } = await open();

        const event = press(recorder().input, 'Tab');

        expect(event.defaultPrevented).toBe(false);
        expect(setBtn.textContent).toBe('Set hotkey');
      });

      test('stops listening when Settings closes, so the next key anywhere is not swallowed or registered', async () => {
        await open();
        mockElectronAPI.registerPopupHotkey.mockClear();

        settings.closeSettings();
        const event = press(document.body, 'k', { ctrlKey: true });
        await tick();

        expect(event.defaultPrevented).toBe(false);
        expect(mockElectronAPI.registerPopupHotkey).not.toHaveBeenCalled();
      });

      test('stops when the field loses focus to the page, or the window loses focus', async () => {
        const first = await open();
        first.input.dispatchEvent(new FocusEvent('blur', { relatedTarget: null }));
        expect(first.setBtn.textContent).toBe('Set hotkey');

        const second = recorder();
        second.setBtn.click();
        expect(second.setBtn.textContent).toBe('Stop recording');
        window.dispatchEvent(new Event('blur'));
        expect(second.setBtn.textContent).toBe('Set hotkey');
      });

      test('pressing Stop recording ends it once, and does not start another', async () => {
        const { input, setBtn } = await open();

        // The button takes focus from the field first, then its click arrives.
        input.dispatchEvent(new FocusEvent('blur', { relatedTarget: setBtn }));
        expect(setBtn.textContent).toBe('Stop recording');
        setBtn.click();

        expect(setBtn.textContent).toBe('Set hotkey');
        expect(input.value).toBe(state.CONFIG.popupHotkey || '');
      });

      test('a suggestion chip or Clear ends a recording that is somehow still on', async () => {
        const parts = await open();
        parts.preset.disabled = false;
        mockElectronAPI.registerPopupHotkey.mockResolvedValue({ success: true });

        parts.preset.click();
        await tick();

        expect(parts.setBtn.textContent).toBe('Set hotkey');
        expect(mockElectronAPI.registerPopupHotkey).toHaveBeenCalledWith(
          parts.preset.dataset.hotkey
        );
        const event = press(document.body, 'k', { ctrlKey: true });
        expect(event.defaultPrevented).toBe(false);
      });
    });

    describe('switches that disable themselves while they save', () => {
      test('keep keyboard focus through a change, instead of dropping it to the page', async () => {
        mockElectronAPI.isPopupHotkeyAvailable.mockResolvedValue(true);
        await settings.openSettings();
        await tick();
        await tick();
        const toggle = document.getElementById('popup-hotkey-toggle-mode');
        toggle.focus();
        let release;
        mockElectronAPI.updateConfig.mockImplementationOnce(
          () =>
            new Promise((resolve) => {
              release = () => resolve({ ...state.CONFIG, popupHotkeyToggleMode: true });
            })
        );

        toggle.checked = true;
        toggle.dispatchEvent(new Event('change', { bubbles: true }));
        expect(toggle.disabled).toBe(true);
        // The browser blurs a control the moment it is disabled.
        toggle.blur();
        release();
        await tick();
        await tick();

        expect(toggle.disabled).toBe(false);
        expect(document.activeElement).toBe(toggle);
      });
    });

    describe('the alerts list', () => {
      beforeEach(() => {
        document.body.insertAdjacentHTML(
          'beforeend',
          `<div id="alert-config-modal" class="modal hidden" style="display: none">
            <div class="modal-content">
              <div class="modal-header"><h2 id="alert-config-title">Configure Alert</h2></div>
              <div class="modal-body">
                <div class="form-group"><div class="alert-type-options">
                  <input type="radio" name="alert-type" value="state-change" checked />
                  <input type="radio" name="alert-type" value="specific-state" />
                </div></div>
                <div class="form-group" id="specific-state-group" style="display: none">
                  <input type="text" id="target-state-input" />
                </div>
              </div>
            </div>
          </div>
          <div id="alert-entity-picker-modal" class="modal hidden" style="display: none">
            <div class="modal-content">
              <div class="modal-header"><h2>Add Alert</h2></div>
              <div class="modal-body">
                <input id="alert-entity-picker-search" />
                <div id="alert-entity-picker-list"></div>
              </div>
            </div>
          </div>`
        );
        state.CONFIG.entityAlerts = {
          enabled: true,
          alerts: {
            'light.living_room': { onStateChange: true, targetState: '' },
            'switch.kitchen': { onStateChange: true, targetState: '' },
          },
        };
        state.setStates({
          ...state.STATES,
          'switch.kitchen': {
            entity_id: 'switch.kitchen',
            state: 'off',
            attributes: { friendly_name: 'Kitchen' },
          },
        });
        document.getElementById('alerts-section').style.display = 'block';
        settings.renderAlertsListInline();
      });

      test('opens its dialogs from the list and closes them with Escape or the backdrop', async () => {
        const edit = document.querySelector('.edit-alert[data-entity="light.living_room"]');
        edit.focus();
        edit.click();
        await tick();
        const config = document.getElementById('alert-config-modal');
        expect(config.getAttribute('role')).toBe('dialog');
        expect(config.classList.contains('hidden')).toBe(false);

        press(document.activeElement, 'Escape');
        expect(config.classList.contains('hidden')).toBe(true);
        await tick();
        expect(document.activeElement).toBe(edit);

        document.querySelector('.add-alert-btn').click();
        const picker = document.getElementById('alert-entity-picker-modal');
        expect(picker.classList.contains('hidden')).toBe(false);
        picker.click();
        expect(picker.classList.contains('hidden')).toBe(true);
      });

      test('names the picker buttons for the entity they add an alert to', () => {
        document.querySelector('.add-alert-btn').click();

        const add = document.querySelector(
          '#alert-entity-picker-list .entity-selector-btn[data-entity-id="switch.kitchen"]'
        );
        expect(add.getAttribute('aria-label')).toBe('Edit alert for Kitchen');
        const names = [
          ...document.querySelectorAll('#alert-entity-picker-list .entity-selector-btn'),
        ].map((button) => button.getAttribute('aria-label'));
        expect(new Set(names).size).toBe(names.length);
        for (const button of document.querySelectorAll(
          '#alert-entity-picker-list .entity-selector-btn'
        )) {
          // The visible "Add alert" or "Edit alert" starts the name, so voice control can say it.
          expect(button.getAttribute('aria-label').startsWith(button.textContent.trim())).toBe(
            true
          );
        }
      });

      test('starts the picker on its search field, not on Close', async () => {
        document.querySelector('.add-alert-btn').click();
        await tick();

        expect(document.activeElement.id).toBe('alert-entity-picker-search');
      });

      test('gives focus back to the Edit button that was rebuilt while the dialog was open', async () => {
        const edit = document.querySelector('.edit-alert[data-entity="light.living_room"]');
        edit.focus();
        edit.click();
        await tick();

        // Saving rebuilds the whole list, replacing every button in it.
        settings.renderAlertsListInline();
        settings.closeAlertConfigModal();
        await tick();

        const rebuilt = document.querySelector('.edit-alert[data-entity="light.living_room"]');
        expect(rebuilt).not.toBe(edit);
        expect(document.activeElement).toBe(rebuilt);
      });

      test('puts focus on the Add button when the alert it was removing is gone', async () => {
        const remove = document.querySelector('.remove-alert[data-entity="switch.kitchen"]');
        remove.focus();
        mockUiUtils.showConfirm.mockResolvedValueOnce(true);
        mockElectronAPI.updateConfig.mockImplementationOnce(async (next) => next);

        remove.click();
        await tick();
        await tick();

        // The Remove button went with the row, so the confirmation is told where focus goes instead.
        const [, , options] = mockUiUtils.showConfirm.mock.calls.at(-1);
        expect(document.querySelector('.remove-alert[data-entity="switch.kitchen"]')).toBeNull();
        expect(options.focusFallback()).toBe(document.querySelector('.add-alert-btn'));
      });
    });
  });

  describe('Support Development dialog', () => {
    afterEach(() => {
      document.getElementById('donate-modal')?.remove();
      document.getElementById('open-donate-modal-btn')?.remove();
    });

    test('says a bad amount under the field, marks the field, and clears it when the amount changes', async () => {
      document.body.insertAdjacentHTML(
        'beforeend',
        `<button id="open-donate-modal-btn" type="button"></button>
        <div id="donate-modal" class="modal hidden">
          <div class="modal-content">
            <div class="modal-header"><h2>Support</h2></div>
            <div class="modal-body">
              <p id="donate-intro">Thank you</p>
              <input name="donate-frequency" type="radio" value="one-time" checked />
              <button type="button" class="donate-amount-chip selected" data-amount="5" aria-pressed="true">$5</button>
              <input id="donate-custom-amount" type="number" min="1" max="12000" step="1" />
              <p id="donate-amount-error" role="alert" hidden></p>
            </div>
            <div class="modal-footer"><button id="donate-continue-btn" type="button">Continue</button></div>
          </div>
        </div>`
      );
      mockElectronAPI.openExternal = jest.fn().mockResolvedValue({ success: true });
      await settings.openSettings();
      document.getElementById('open-donate-modal-btn').click();
      // The dialog takes its own focus first; then the person works in it.
      await new Promise((resolve) => setTimeout(resolve, 0));
      const modal = document.getElementById('donate-modal');
      const amount = document.getElementById('donate-custom-amount');
      const error = document.getElementById('donate-amount-error');
      mockUiUtils.showToast.mockClear();

      expect(modal.getAttribute('aria-describedby')).toBe('donate-intro');
      amount.value = '0.5';
      document.getElementById('donate-continue-btn').click();
      await new Promise((resolve) => setTimeout(resolve, 0));

      // A persistent message tied to the field, not a toast that lands on the help text.
      expect(error.hidden).toBe(false);
      expect(error.textContent).toBe('Please enter a whole dollar amount between $1 and $12,000.');
      expect(amount.getAttribute('aria-invalid')).toBe('true');
      expect(amount.getAttribute('aria-describedby')).toBe('donate-amount-error');
      expect(document.activeElement).toBe(amount);
      expect(mockUiUtils.showToast).not.toHaveBeenCalled();
      expect(mockElectronAPI.openExternal).not.toHaveBeenCalled();

      amount.value = '10';
      amount.dispatchEvent(new Event('input', { bubbles: true }));
      expect(error.hidden).toBe(true);
      expect(amount.hasAttribute('aria-invalid')).toBe(false);
      expect(amount.hasAttribute('aria-describedby')).toBe(false);
    });

    test('continues on Enter in the custom amount field', async () => {
      document.body.insertAdjacentHTML(
        'beforeend',
        `<button id="open-donate-modal-btn" type="button"></button>
        <div id="donate-modal" class="modal hidden">
          <input name="donate-frequency" type="radio" value="one-time" checked />
          <input id="donate-custom-amount" type="number" min="1" max="12000" step="1" />
          <button id="donate-continue-btn" type="button">Continue</button>
        </div>`
      );
      mockElectronAPI.openExternal = jest.fn().mockResolvedValue({ success: true });
      await settings.openSettings();
      document.getElementById('open-donate-modal-btn').click();

      const amount = document.getElementById('donate-custom-amount');
      amount.value = '25';
      const enter = new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true });
      amount.dispatchEvent(enter);
      await new Promise((resolve) => setTimeout(resolve, 0));

      expect(enter.defaultPrevented).toBe(true);
      expect(mockElectronAPI.openExternal).toHaveBeenCalledWith(
        expect.stringContaining('amount=25')
      );
    });
  });

  describe('Settings translations', () => {
    const i18n = require('../../src/i18n.js');
    const GERMAN = {
      'Set Card {{index}}': 'Karte {{index}} setzen',
      'Card {{index}} ✓': 'Karte {{index}} ✓',
      'Weather (default)': 'Wetter (Standard)',
      'Time (default)': 'Uhrzeit (Standard)',
      'Not synced yet.': 'Noch nicht synchronisiert.',
      never: 'nie',
      '1 custom icon configured.': '1 eigenes Symbol festgelegt.',
      '{{count}} custom icons configured.': '{{count}} eigene Symbole festgelegt.',
      'All custom icons cleared. Click Save to persist changes.':
        'Alle eigenen Symbole entfernt. Zum Übernehmen Speichern klicken.',
      'Remove Alert': 'Warnung entfernen',
      'Remove alert for "{{name}}"?': 'Warnung für „{{name}}“ entfernen?',
      Remove: 'Entfernen',
      'Profile sync upload complete.': 'Profil-Upload abgeschlossen.',
      'Accent colors': 'Akzentfarben',
    };

    beforeEach(() => {
      i18n.setLocaleBootstrap({ activeLocale: 'de', messages: GERMAN });
    });

    afterEach(() => {
      i18n.setLocaleBootstrap({ activeLocale: 'en', messages: {} });
    });

    test('renders the Primary Cards picker and summary in the active language', async () => {
      await settings.openSettings();
      const toggle = document.getElementById('primary-cards-toggle');
      if (toggle.getAttribute('aria-expanded') !== 'true') toggle.click();

      expect(document.getElementById('primary-card-1-current').textContent).toBe(
        'Wetter (Standard)'
      );
      expect(document.getElementById('primary-card-2-current').textContent).toBe(
        'Uhrzeit (Standard)'
      );
      const assignButtons = [
        ...document.querySelectorAll('#primary-cards-list [data-primary-assign]'),
      ].map((button) => button.textContent);
      expect(assignButtons).toContain('Karte 1 setzen');
      expect(assignButtons).toContain('Karte 2 setzen');
      expect(assignButtons.some((label) => label.includes('Set Card'))).toBe(false);

      document.querySelector('#primary-cards-list [data-primary-assign="0"]').click();
      const cardOneLabels = [
        ...document.querySelectorAll('#primary-cards-list [data-primary-assign="0"]'),
      ].map((button) => button.textContent);
      expect(cardOneLabels).toContain('Karte 1 ✓');
      expect(document.getElementById('theme-options-label').textContent).toBe('Akzentfarben');
    });

    test('re-renders script-written Settings text when the language changes while open', async () => {
      i18n.setLocaleBootstrap({ activeLocale: 'en', messages: {} });
      state.CONFIG.customEntityIcons = { 'light.living_room': '💡', 'light.bedroom': '🛏️' };
      mockElectronAPI.getProfileSyncStatus.mockResolvedValueOnce(
        buildProfileSyncStatus({ enabled: true, lastSyncStatus: 'success', lastSyncAt: null })
      );
      await settings.openSettings();
      const status = document.getElementById('profile-sync-status');
      const summary = document.getElementById('custom-entity-icons-summary');
      expect(status.textContent).toBe('Not synced yet.');
      expect(summary.textContent).toBe('2 custom icons configured.');

      i18n.setLocaleBootstrap({ activeLocale: 'de', messages: GERMAN });
      // The locale observer runs as a microtask after <html lang> changes.
      await Promise.resolve();

      expect(status.textContent).toBe('Noch nicht synchronisiert.');
      expect(summary.textContent).toBe('2 eigene Symbole festgelegt.');
      expect(document.getElementById('primary-card-1-current').textContent).toBe(
        'Wetter (Standard)'
      );
    });

    test('relabels the media player options, the unavailable one included, when the language changes while open', async () => {
      i18n.setLocaleBootstrap({ activeLocale: 'en', messages: {} });
      state.CONFIG.primaryMediaPlayer = 'media_player.gone';
      await settings.openSettings();
      const select = document.getElementById('primary-media-player');
      expect(select.selectedOptions[0].textContent).toBe('Unavailable: media_player.gone');

      i18n.setLocaleBootstrap({
        activeLocale: 'de',
        messages: {
          'None (Hide Media Tile)': 'Keine (Medienkachel ausblenden)',
          'Unavailable: {{entityId}}': 'Nicht verfügbar: {{entityId}}',
        },
      });
      await Promise.resolve();

      expect(select.value).toBe('media_player.gone');
      expect(select.selectedOptions[0].textContent).toBe('Nicht verfügbar: media_player.gone');
      expect(select.options[0].textContent).toBe('Keine (Medienkachel ausblenden)');
    });

    test('translates the layer mode reasons when the language changes while open', async () => {
      i18n.setLocaleBootstrap({ activeLocale: 'en', messages: {} });
      state.CONFIG.desktopCapabilities = { layerMode: true };
      await settings.openSettings();
      const hideOnBlur = document.getElementById('hide-on-blur');
      expect(hideOnBlur.title).toBe('Desktop layer mode keeps the widget behind normal windows.');

      i18n.setLocaleBootstrap({
        activeLocale: 'de',
        messages: {
          'Desktop layer mode keeps the widget behind normal windows.':
            'Der Desktop-Layer-Modus hält das Widget hinter normalen Fenstern.',
        },
      });
      await Promise.resolve();

      expect(hideOnBlur.title).toBe(
        'Der Desktop-Layer-Modus hält das Widget hinter normalen Fenstern.'
      );
      expect(document.getElementById('always-on-top').title).toBe(hideOnBlur.title);
    });

    test('keeps an unsaved media player choice when the language changes while open', async () => {
      i18n.setLocaleBootstrap({ activeLocale: 'en', messages: {} });
      await settings.openSettings();
      const select = document.getElementById('primary-media-player');
      select.value = 'media_player.spotify';
      select.dispatchEvent(new Event('change'));

      i18n.setLocaleBootstrap({ activeLocale: 'de', messages: GERMAN });
      await Promise.resolve();

      expect(select.value).toBe('media_player.spotify');
    });

    test('keeps an unsaved media player choice that Home Assistant stops reporting before the language changes', async () => {
      i18n.setLocaleBootstrap({ activeLocale: 'en', messages: {} });
      state.CONFIG.primaryMediaPlayer = 'media_player.bedroom_speaker';
      await settings.openSettings();
      const select = document.getElementById('primary-media-player');
      select.value = 'media_player.spotify';
      select.dispatchEvent(new Event('change'));
      delete state.STATES['media_player.spotify'];

      i18n.setLocaleBootstrap({
        activeLocale: 'de',
        messages: { 'Unavailable: {{entityId}}': 'Nicht verfügbar: {{entityId}}' },
      });
      await Promise.resolve();

      expect(select.value).toBe('media_player.spotify');
      expect(select.selectedOptions[0].textContent).toBe('Nicht verfügbar: media_player.spotify');

      await settings.saveSettings();
      expect(state.CONFIG.primaryMediaPlayer).toBe('media_player.spotify');
    });

    test('keeps the saved player that has gone offered while another is picked, through a language change', async () => {
      i18n.setLocaleBootstrap({ activeLocale: 'en', messages: {} });
      state.CONFIG.primaryMediaPlayer = 'media_player.gone';
      await settings.openSettings();
      const select = document.getElementById('primary-media-player');
      select.value = 'media_player.spotify';
      select.dispatchEvent(new Event('change'));

      i18n.setLocaleBootstrap({ activeLocale: 'de', messages: GERMAN });
      await Promise.resolve();

      expect(select.value).toBe('media_player.spotify');
      // Going back to the saved one is still possible.
      expect([...select.options].map((option) => option.value)).toContain('media_player.gone');
    });

    test('asks the update UI to re-render its status line after a language change', async () => {
      i18n.setLocaleBootstrap({ activeLocale: 'en', messages: {} });
      const relocalizeUpdateStatus = jest.fn();
      await settings.openSettings({ initUpdateUI: jest.fn(), relocalizeUpdateStatus });
      relocalizeUpdateStatus.mockClear();
      i18n.setLocaleBootstrap({ activeLocale: 'de', messages: GERMAN });
      await Promise.resolve();
      expect(relocalizeUpdateStatus).toHaveBeenCalled();
    });

    test('translates the profile sync status line', () => {
      settings.handleProfileSyncStatusUpdate(
        buildProfileSyncStatus({ enabled: true, lastSyncStatus: 'success', lastSyncAt: null })
      );
      expect(document.getElementById('profile-sync-status').textContent).toBe(
        'Noch nicht synchronisiert.'
      );
    });

    test('uses singular and plural custom icon counts', async () => {
      state.CONFIG.customEntityIcons = { 'light.living_room': '💡' };
      await settings.openSettings();
      const summary = document.getElementById('custom-entity-icons-summary');
      expect(summary.textContent).toBe('1 eigenes Symbol festgelegt.');

      settings.closeSettings();
      state.CONFIG.customEntityIcons = { 'light.living_room': '💡', 'light.bedroom': '🛏️' };
      await settings.openSettings();
      expect(summary.textContent).toBe('2 eigene Symbole festgelegt.');
    });

    test('passes translated text to toasts and confirmations', async () => {
      await openSettingsWithCustomIconsExpanded();
      document.getElementById('custom-entity-icons-reset-all').click();
      expect(mockUiUtils.showToast).toHaveBeenCalledWith(
        'Alle eigenen Symbole entfernt. Zum Übernehmen Speichern klicken.',
        'info',
        2400
      );

      mockUiUtils.showConfirm.mockResolvedValueOnce(false);
      state.CONFIG.entityAlerts = {
        enabled: true,
        alerts: { 'light.living_room': { onStateChange: true } },
      };
      const alertsList = document.getElementById('inline-alerts-list');
      settings.renderAlertsListInline();
      alertsList.querySelector('.remove-alert').click();
      await Promise.resolve();
      expect(mockUiUtils.showConfirm).toHaveBeenCalledWith(
        'Warnung entfernen',
        'Warnung für „Living Room Light“ entfernen?',
        expect.objectContaining({ confirmText: 'Entfernen' })
      );
      expect(alertsList.querySelector('.remove-alert').textContent).toBe('Entfernen');

      mockElectronAPI.runProfileSync = jest.fn().mockResolvedValue({ ok: true });
      enableSavedProfileSync();
      await settings.openSettings();
      document.getElementById('profile-sync-push-now').click();
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(mockUiUtils.showToast).toHaveBeenCalledWith(
        'Profil-Upload abgeschlossen.',
        'success',
        2200
      );
    });
  });
});

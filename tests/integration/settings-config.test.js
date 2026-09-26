/**
 * @jest-environment jsdom
 */

const {
  createMockElectronAPI,
  resetMockElectronAPI,
  getMockConfig,
} = require('../mocks/electron.js');
const { sampleStates, sampleConfig } = require('../fixtures/ha-data.js');

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
  applyWindowEffects: jest.fn(),
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
  trapFocus: jest.fn(),
  releaseFocusTrap: jest.fn(),
  // Mirrors the real shared modal helpers: class-based visibility plus the inline display the
  // legacy call sites still assert on.
  closeModal: jest.fn((modal, { releaseFocus = false } = {}) => {
    if (modal) {
      modal.classList.remove('modal-closing');
      modal.classList.add('hidden');
      if (modal.style.display) modal.style.display = 'none';
      if (releaseFocus) mockUiUtils.releaseFocusTrap(modal);
    }
    return Promise.resolve();
  }),
  openModal: jest.fn((modal, { display = 'flex' } = {}) => {
    if (!modal) return;
    modal.classList.remove('modal-closing');
    modal.classList.remove('hidden');
    if (display) modal.style.display = display;
    else modal.style.removeProperty('display');
  }),
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
        <div id="profile-sync-resolution" class="hidden">
          <p id="profile-sync-resolution-text"></p>
          <button type="button" id="profile-sync-resolve-upload">Keep Local</button>
          <button type="button" id="profile-sync-resolve-remote">Use Remote</button>
          <button type="button" id="profile-sync-resolve-cancel">Cancel</button>
        </div>
        <div id="profile-sync-status"></div>
        <div id="profile-sync-error" class="hidden"></div>
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

      <label>Primary Media Player</label>
      <div id="primary-media-player-dropdown" class="custom-dropdown">
        <div id="primary-media-player-trigger">
          <span class="custom-dropdown-value">None</span>
        </div>
        <div id="primary-media-player-menu" class="custom-dropdown-menu"></div>
      </div>

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

      expect(mockUiUtils.trapFocus).toHaveBeenCalledWith(modal);
      expect(mockUiHooks.initUpdateUI).toHaveBeenCalled();
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
      expect(status.textContent).toBe('Opening Home Assistant for authorization...');

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
      expect(status.classList.contains('hidden')).toBe(true);
      expect(status.querySelector('.connection-progress')).toBeNull();
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
      expect(mockUiUtils.releaseFocusTrap).toHaveBeenCalledWith(modal);
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
      expect(spanishOption.textContent).toContain('Download first');
      expect(frenchOption).toBeTruthy();
      expect(frenchOption.disabled).toBe(false);
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

    test('should show the full emoji catalog in the picker', async () => {
      // Arrange
      await openSettingsWithCustomIconsExpanded();
      const chooseBtn = document.querySelector(
        '[data-custom-icon-picker-toggle="light.living_room"]'
      );
      expect(chooseBtn).toBeTruthy();

      // Act
      chooseBtn.click();

      // Assert
      const allChoices = document.querySelectorAll(
        '[data-custom-icon-choice-entity="light.living_room"]'
      );
      const renderedIcons = new Set(
        Array.from(allChoices, (choice) => choice.dataset.customIconChoice)
      );
      expect(allChoices.length).toBeGreaterThanOrEqual(3953);
      ['1️⃣', '🇨🇦', '🏳️‍🌈', '👨‍👩‍👧‍👦', '👩🏽‍💻', '🫷🏽'].forEach((emoji) => {
        expect(renderedIcons).toContain(emoji);
      });
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
      await new Promise((resolve) => setTimeout(resolve, 0));

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

      // Assert
      expect(mockUiUtils.showConfirm).toHaveBeenCalledWith(
        expect.stringContaining('Unsaved Custom Color Changes'),
        expect.stringContaining('unsaved custom color edits'),
        expect.objectContaining({
          confirmText: 'Save and Continue',
          cancelText: 'Continue Without Saving',
        })
      );
      expect(state.CONFIG.ui.customColors).toEqual(
        expect.arrayContaining([expect.objectContaining({ color: '#13579B' })])
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

      // Assert
      const customOptions = document.querySelectorAll(
        '.color-theme-option[data-custom-theme="true"]'
      );
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
      options.forEach((opt) => opt.classList.remove('selected'));

      // Then add 'selected' class to the Spotify option
      const spotifyOption = Array.from(options).find(
        (opt) => opt.getAttribute('data-value') === 'media_player.spotify'
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

      expect(mockElectronAPI.chooseProfileSyncFolder).toHaveBeenCalledWith('syncthing');
    });

    test('asks before Sync Up replaces the sync file', async () => {
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
      expect(select.options[0].textContent).toContain('the sync file’s Appearance');

      document.getElementById('profile-sync-restore-backup').click();
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(mockElectronAPI.restoreProfileSyncBackup).toHaveBeenCalledWith(
        'remote-profile-1771840800000.json'
      );
      expect(state.CONFIG.opacity).toBe(0.6);
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
        overwritten: false,
      });

      await settings.openSettings();
      document.getElementById('profile-sync-enabled').checked = true;
      document.getElementById('profile-sync-folder-path').value = '/tmp/new-sync';
      document.getElementById('profile-sync-encryption-enabled').checked = false;
      await settings.saveSettings();

      expect(mockElectronAPI.copyProfileSyncFile).toHaveBeenCalledWith(
        '/tmp/old-sync/ha-widget-profile-sync.json',
        '/tmp/new-sync/ha-widget-profile-sync.json',
        false
      );
      expect(state.CONFIG.profileSync.cloudFilePath).toBe(
        '/tmp/new-sync/ha-widget-profile-sync.json'
      );
    });

    test('should prompt overwrite when destination exists on folder change', async () => {
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
      mockElectronAPI.copyProfileSyncFile
        .mockResolvedValueOnce({ ok: false, status: 'destination_exists' })
        .mockResolvedValueOnce({ ok: true, status: 'copied', copied: true, overwritten: true });

      await settings.openSettings();
      document.getElementById('profile-sync-enabled').checked = true;
      document.getElementById('profile-sync-folder-path').value = '/tmp/new-sync';
      document.getElementById('profile-sync-encryption-enabled').checked = false;
      await settings.saveSettings();

      expect(mockElectronAPI.copyProfileSyncFile).toHaveBeenNthCalledWith(
        1,
        '/tmp/old-sync/ha-widget-profile-sync.json',
        '/tmp/new-sync/ha-widget-profile-sync.json',
        false
      );
      expect(mockElectronAPI.copyProfileSyncFile).toHaveBeenNthCalledWith(
        2,
        '/tmp/old-sync/ha-widget-profile-sync.json',
        '/tmp/new-sync/ha-widget-profile-sync.json',
        true
      );
      expect(state.CONFIG.profileSync.cloudFilePath).toBe(
        '/tmp/new-sync/ha-widget-profile-sync.json'
      );
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

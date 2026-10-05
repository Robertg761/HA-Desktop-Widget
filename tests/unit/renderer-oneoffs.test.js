/**
 * @jest-environment jsdom
 */

// Small renderer.js behaviours that need the whole renderer loaded: what a Home Assistant profile
// leaves behind, and the weather picker's Clear button.

const EventEmitter = require('events');
const { createMockElectronAPI, resetMockElectronAPI } = require('../mocks/electron.js');
const { createRendererLifetime, warmUpRenderer } = require('../helpers/renderer-harness');

describe('Renderer one-off behaviours', () => {
  // Stops what each test's renderer started (its timers and window and document listeners), so it
  // does not act on the next test's page. See tests/helpers/renderer-harness.js.
  const lifetime = createRendererLifetime();
  let mockElectronAPI;
  let mockState;
  let mockUiUtils;
  let mockUi;
  let companionOptions;

  const baseConfig = (overrides = {}) => ({
    homeAssistant: { url: 'http://ha.local:8123', token: 'valid-token' },
    favoriteEntities: [],
    customTabs: [{ id: 'home', name: 'Home', entityIds: ['light.desk'] }],
    activeTabId: 'home',
    entityAlerts: { enabled: false, alerts: {} },
    globalHotkeys: { enabled: false, hotkeys: {} },
    ui: { theme: 'auto', enableInteractionDebugLogs: false },
    ...overrides,
  });

  const flushAsync = async () => {
    for (let index = 0; index < 8; index += 1) await Promise.resolve();
    await new Promise((resolve) => setTimeout(resolve, 0));
  };

  const loadRenderer = async ({ config = baseConfig(), bodyHtml = '' } = {}) => {
    jest.resetModules();
    lifetime.start();
    resetMockElectronAPI();
    localStorage.clear();
    document.body.innerHTML = `<main class="widget-content"></main>${bodyHtml}`;
    document.body.className = '';
    window.history.replaceState({}, '', 'http://localhost/');

    mockElectronAPI = createMockElectronAPI();
    mockElectronAPI.getConfig.mockResolvedValue(config);
    window.electronAPI = mockElectronAPI;

    mockState = {
      CONFIG: {},
      STATES: {},
      setConfig(nextConfig) {
        this.CONFIG = nextConfig;
      },
      setStates(nextStates) {
        this.STATES = nextStates;
      },
      setEntityState(entity) {
        this.STATES[entity.entity_id] = entity;
      },
      deleteEntityState(entityId) {
        return delete this.STATES[entityId];
      },
      setServices: jest.fn(),
      setAreas: jest.fn(),
      setUnitSystem: jest.fn(),
    };
    const websocket = new EventEmitter();
    websocket.connect = jest.fn();
    websocket.request = jest.fn(() => ({ id: 1, catch: jest.fn() }));
    websocket.callService = jest.fn();
    websocket.close = jest.fn();
    websocket.ws = null;

    jest.doMock('../../src/logger.js', () => ({
      __esModule: true,
      default: {
        errorHandler: { startCatching: jest.fn() },
        transports: { console: {} },
        info: jest.fn(),
        debug: jest.fn(),
        warn: jest.fn(),
        error: jest.fn(),
      },
    }));
    jest.doMock('../../src/state.js', () => ({ __esModule: true, default: mockState }));
    jest.doMock('../../src/websocket.js', () => ({ __esModule: true, default: websocket }));
    jest.doMock('../../src/hotkeys.js', () => ({
      __esModule: true,
      initializeHotkeys: jest.fn(),
      setupHotkeyEventListeners: jest.fn(),
      renderHotkeysTab: jest.fn(),
    }));
    jest.doMock('../../src/alerts.js', () => ({
      __esModule: true,
      initializeEntityAlerts: jest.fn(),
      checkEntityAlerts: jest.fn(),
    }));
    jest.doMock('../../src/notifications.js', () => ({
      __esModule: true,
      initializePersistentNotifications: jest.fn(),
    }));
    jest.doMock('../../src/desktop-companion-client.js', () => ({
      __esModule: true,
      DesktopCompanionClient: jest.fn(function DesktopCompanionClient(options) {
        companionOptions = options;
        this.start = jest.fn();
        this.stop = jest.fn();
        this.reportState = jest.fn();
        this.reportConfigSnapshot = jest.fn();
      }),
    }));
    mockUi = {
      initUpdateUI: jest.fn(),
      renderActiveTab: jest.fn(),
      ensureEntityCacheScope: jest.fn(),
      updateMediaTile: jest.fn(),
      renderPrimaryCards: jest.fn(),
      toggleReorganizeMode: jest.fn(),
      populateQuickControlsList: jest.fn(),
      isEntityVisible: jest.fn(() => false),
      updateEntityInUI: jest.fn(),
      updateWeatherFromHA: jest.fn(),
      populateWeatherEntitiesList: jest.fn(),
      selectWeatherEntity: jest.fn(),
      updateTimeDisplay: jest.fn(),
      updateTimerDisplays: jest.fn(),
      updateMediaSeekBar: jest.fn(),
      refreshVisibleEntityCache: jest.fn(),
      executeHotkeyAction: jest.fn(),
      handleDesktopPinActionRequest: jest.fn(),
      callMediaTileService: jest.fn(),
      getTickTargets: jest.fn(() => ({ hasVisibleTimers: false })),
      switchQuickAccessPage: jest.fn(),
      showAddPageModal: jest.fn(),
    };
    jest.doMock('../../src/ui.js', () => mockUi);
    jest.doMock('../../src/settings.js', () => ({
      __esModule: true,
      openSettings: jest.fn(),
      closeSettings: jest.fn(),
      saveSettings: jest.fn(),
      renderAlertsListInline: jest.fn(),
      reapplySettingsPreviews: jest.fn(),
      handleProfileSyncStatusUpdate: jest.fn(),
      profileSyncNeedsAttention: jest.fn(() => false),
    }));
    mockUiUtils = {
      __esModule: true,
      showLoading: jest.fn(),
      showToast: jest.fn(),
      setStatus: jest.fn(),
      initializeConnectionStatusTooltip: jest.fn(),
      applyTheme: jest.fn(),
      setCustomThemes: jest.fn(),
      applyAccentTheme: jest.fn(),
      applyBackgroundTheme: jest.fn(),
      applyUiPreferences: jest.fn(),
      suspendSeasonalColors: jest.fn(),
      applyWindowEffects: jest.fn(),
      ...require('../helpers/ui-utils-dialogs').realDialogHelpers(),
    };
    jest.doMock('../../src/ui-utils.js', () => mockUiUtils);
    jest.doMock('../../src/utils.js', () => ({
      getEntityDisplayName: (entity) => entity.attributes?.friendly_name || entity.entity_id,
      __esModule: true,
      reconcileConfigEntityIds: jest.fn((nextConfig) => ({ changed: false, config: nextConfig })),
      resolveEntityId: jest.fn((entityId) => entityId),
    }));
    jest.doMock('../../src/i18n.js', () => ({
      __esModule: true,
      setLocaleBootstrap: jest.fn(),
      t: jest.fn((key) => key),
      translateDocument: jest.fn(),
    }));
    jest.doMock('../../src/icons.js', () => ({
      __esModule: true,
      setIconContent: jest.fn(),
      applyCloseButtonIcons: jest.fn(),
    }));
    jest.doMock('../../src/constants.js', () => ({
      __esModule: true,
      BASE_RECONNECT_DELAY_MS: 1000,
      MAX_RECONNECT_DELAY_MS: 8000,
    }));

    require('../../renderer.js');
    window.dispatchEvent(new Event('DOMContentLoaded'));
    await flushAsync();
  };

  const cleanup = () => {
    lifetime.stop();
    jest.resetModules();
    delete window.electronAPI;
    document.body.innerHTML = '';
    localStorage.clear();
  };

  warmUpRenderer(loadRenderer, cleanup);
  afterEach(cleanup);

  describe('apply_profile from Home Assistant', () => {
    const profilePayload = (customTabs) => ({
      schema_version: 1,
      profile_id: 'profile-1',
      revision: 3,
      profile: { customTabs, activeTabId: customTabs[0].id },
    });

    it('keeps the layout it replaces so Undo can bring it back', async () => {
      const { readDashboardHistory } = require('../../src/dashboard-history.js');
      await loadRenderer();
      expect(companionOptions).toBeDefined();
      const replaced = baseConfig();
      const applied = [{ id: 'kitchen', name: 'Kitchen', entityIds: ['light.kitchen'] }];
      mockElectronAPI.updateConfig.mockImplementation(async (patch) => ({
        ...replaced,
        ...patch,
        success: true,
      }));

      const result = await companionOptions.executeCommand({
        action: 'apply_profile',
        payload: profilePayload(applied),
      });

      expect(result).toMatchObject({ active_profile_id: 'profile-1', profile_revision: 3 });
      const history = readDashboardHistory(replaced);
      expect(history).toHaveLength(1);
      expect(history[0].layout.customTabs).toEqual(replaced.customTabs);
      expect(history[0].activeTabId).toBe('home');
    });

    it('keeps the layout it replaces as a restore point of its own, even just after an edit', async () => {
      await loadRenderer();
      // The renderer's own copy, which knows the burst of edits in progress.
      const { rememberDashboard, readRestorePoints } = require('../../src/dashboard-history.js');
      // Edits less than 30 s apart share a restore point. Only Date is faked.
      jest.useFakeTimers({
        now: new Date('2030-01-01T10:00:00Z'),
        doNotFake: [
          'nextTick',
          'setImmediate',
          'clearImmediate',
          'setTimeout',
          'clearTimeout',
          'setInterval',
          'clearInterval',
          'queueMicrotask',
          'requestAnimationFrame',
          'cancelAnimationFrame',
          'requestIdleCallback',
          'cancelIdleCallback',
          'performance',
          'hrtime',
        ],
      });
      try {
        // An edit a moment ago left the layout on screen.
        const replaced = JSON.parse(JSON.stringify(mockState.CONFIG));
        rememberDashboard(
          { ...replaced, customTabs: [{ id: 'home', name: 'Home', entityIds: [] }] },
          replaced
        );
        mockElectronAPI.updateConfig.mockImplementation(async (patch) => ({
          ...replaced,
          ...patch,
          success: true,
        }));
        jest.setSystemTime(Date.now() + 5000);

        await companionOptions.executeCommand({
          action: 'apply_profile',
          payload: profilePayload([{ id: 'kitchen', name: 'Kitchen', entityIds: [] }]),
        });

        expect(
          readRestorePoints(replaced).map((point) => point.layout.customTabs[0].entityIds)
        ).toEqual([['light.desk'], []]);
      } finally {
        jest.useRealTimers();
      }
    });

    it('remembers the layout even when the save reports no config back', async () => {
      const { readDashboardHistory } = require('../../src/dashboard-history.js');
      await loadRenderer();
      mockElectronAPI.updateConfig.mockResolvedValue({ success: true });

      await companionOptions.executeCommand({
        action: 'apply_profile',
        payload: profilePayload([{ id: 'kitchen', name: 'Kitchen', entityIds: [] }]),
      });

      const history = readDashboardHistory(baseConfig());
      expect(history).toHaveLength(1);
      expect(history[0].layout.customTabs[0].id).toBe('home');
    });

    it('adds nothing when the profile changes no page, and nothing when the save fails', async () => {
      const { readDashboardHistory } = require('../../src/dashboard-history.js');
      await loadRenderer();
      mockElectronAPI.updateConfig.mockResolvedValue({ success: true });
      await companionOptions.executeCommand({
        action: 'apply_profile',
        payload: profilePayload(baseConfig().customTabs),
      });
      expect(readDashboardHistory(baseConfig())).toHaveLength(0);

      mockElectronAPI.updateConfig.mockResolvedValue({ success: false, error: 'disk full' });
      await expect(
        companionOptions.executeCommand({
          action: 'apply_profile',
          payload: profilePayload([{ id: 'kitchen', name: 'Kitchen', entityIds: [] }]),
        })
      ).rejects.toThrow('disk full');
      expect(readDashboardHistory(baseConfig())).toHaveLength(0);
    });
  });

  describe('weather picker Clear', () => {
    const weatherModal = `
      <div id="weather-config-modal" class="modal hidden">
        <button id="clear-weather" type="button">Clear</button>
      </div>`;

    it('does nothing while no weather entity is picked', async () => {
      await loadRenderer({ bodyHtml: weatherModal });
      mockElectronAPI.updateConfig.mockClear();

      document.getElementById('clear-weather').click();
      await flushAsync();

      expect(mockElectronAPI.updateConfig).not.toHaveBeenCalled();
      expect(mockUiUtils.showToast).not.toHaveBeenCalledWith(
        'Weather entity cleared (using first available)',
        expect.anything(),
        expect.anything()
      );
    });

    it('clears a picked weather entity and says so', async () => {
      await loadRenderer({
        config: baseConfig({ selectedWeatherEntity: 'weather.cabin' }),
        bodyHtml: weatherModal,
      });
      mockElectronAPI.updateConfig.mockClear();
      mockElectronAPI.updateConfig.mockResolvedValue(baseConfig({ selectedWeatherEntity: null }));

      document.getElementById('clear-weather').click();
      await flushAsync();

      expect(mockElectronAPI.updateConfig).toHaveBeenCalledWith({ selectedWeatherEntity: null });
      expect(mockUi.populateWeatherEntitiesList).toHaveBeenCalled();
      expect(mockUiUtils.showToast).toHaveBeenCalledWith(
        'Weather entity cleared (using first available)',
        'success',
        2000
      );
    });
  });
});

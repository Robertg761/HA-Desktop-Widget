/**
 * @jest-environment jsdom
 */

const EventEmitter = require('events');
const {
  createMockElectronAPI,
  resetMockElectronAPI,
  triggerMockEvent,
} = require('../mocks/electron.js');

describe('Renderer Home Assistant connection lifecycle', () => {
  let mockElectronAPI;
  let mockState;
  let mockWebsocket;
  let mockUiUtils;
  let mockAlerts;
  let mockLog;
  let mockUi;

  const baseConfig = () => ({
    favoriteEntities: [],
    entityAlerts: { enabled: false, alerts: {} },
    globalHotkeys: { enabled: false, hotkeys: {} },
    ui: { theme: 'auto', enableInteractionDebugLogs: false },
  });

  const oauthConfig = (overrides = {}) => ({
    ...baseConfig(),
    homeAssistant: {
      url: 'http://ha.local:8123',
      token: 'access-token-1',
      authMethod: 'oauth',
      oauthStatus: 'connected',
      oauthAuthorizationId: 'authorization-1',
      ...overrides,
    },
  });

  const tokenConfig = () => ({
    ...baseConfig(),
    homeAssistant: { url: 'http://ha.local:8123', token: 'legacy-token', authMethod: 'token' },
  });

  const flushAsync = async () => {
    for (let index = 0; index < 8; index += 1) {
      await Promise.resolve();
    }
    await new Promise((resolve) => setTimeout(resolve, 0));
  };

  const panelText = () => document.getElementById('widget-state-panel')?.textContent || '';

  const findButton = (label) =>
    Array.from(document.querySelectorAll('button')).find(
      (candidate) => candidate.textContent === label
    );

  const connectSuccessfully = () => {
    let requestId = 10;
    mockWebsocket.request.mockImplementation(() => {
      const request = new Promise(() => {});
      request.id = requestId++;
      return request;
    });
    mockWebsocket.emit('message', { type: 'auth_ok' });
    mockWebsocket.emit('message', { type: 'result', id: 10, success: true, result: [] });
    mockWebsocket.connected = true;
  };

  const loadRenderer = async ({ config = oauthConfig(), configureApi } = {}) => {
    jest.resetModules();
    resetMockElectronAPI();
    document.body.innerHTML =
      '<main class="widget-content"><div id="quick-controls"></div></main>' +
      '<div id="settings-modal" class="hidden"></div>';
    document.body.className = '';
    window.history.replaceState({}, '', 'http://localhost/');

    mockElectronAPI = createMockElectronAPI();
    mockElectronAPI.getConfig.mockResolvedValue(config);
    mockElectronAPI.publishHaConnectionState = jest.fn().mockResolvedValue({ success: true });
    configureApi?.(mockElectronAPI);
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

    mockWebsocket = new EventEmitter();
    mockWebsocket.connected = false;
    mockWebsocket.connect = jest.fn(() => {
      mockWebsocket.connected = false;
    });
    mockWebsocket.isConnected = jest.fn(() => mockWebsocket.connected);
    mockWebsocket.request = jest.fn(() => ({ id: 1, catch: jest.fn() }));
    mockWebsocket.callService = jest.fn();
    mockWebsocket.close = jest.fn(() => {
      mockWebsocket.connected = false;
    });
    mockWebsocket.ws = null;

    mockLog = {
      errorHandler: { startCatching: jest.fn() },
      transports: { console: {} },
      info: jest.fn(),
      debug: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
    };
    jest.doMock('../../src/logger.js', () => ({ __esModule: true, default: mockLog }));
    jest.doMock('../../src/state.js', () => ({ __esModule: true, default: mockState }));
    jest.doMock('../../src/websocket.js', () => ({ __esModule: true, default: mockWebsocket }));
    jest.doMock('../../src/hotkeys.js', () => ({
      __esModule: true,
      initializeHotkeys: jest.fn(),
      setupHotkeyEventListeners: jest.fn(),
      renderHotkeysTab: jest.fn(),
      assignHotkeyToEntity: jest.fn(),
      toggleHotkeys: jest.fn(),
      captureHotkey: jest.fn(),
      cleanupHotkeyEventListeners: jest.fn(),
    }));
    mockAlerts = {
      __esModule: true,
      initializeEntityAlerts: jest.fn(),
      suspendEntityAlerts: jest.fn(),
      resetEntityAlerts: jest.fn(),
      checkEntityAlerts: jest.fn(),
      toggleAlerts: jest.fn(),
    };
    jest.doMock('../../src/alerts.js', () => mockAlerts);
    jest.doMock('../../src/notifications.js', () => ({
      __esModule: true,
      initializePersistentNotifications: jest.fn(),
    }));
    mockUi = {
      initUpdateUI: jest.fn(),
      renderActiveTab: jest.fn(),
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
      openSettings: jest.fn(() => {
        document.getElementById('settings-modal')?.classList.remove('hidden');
      }),
      closeSettings: jest.fn(),
      saveSettings: jest.fn(),
      renderAlertsListInline: jest.fn(),
    }));
    mockUiUtils = {
      __esModule: true,
      showLoading: jest.fn(),
      showToast: jest.fn(() => ({ dismiss: jest.fn() })),
      setStatus: jest.fn(),
      initializeConnectionStatusTooltip: jest.fn(),
      applyTheme: jest.fn(),
      setCustomThemes: jest.fn(),
      applyAccentTheme: jest.fn(),
      applyBackgroundTheme: jest.fn(),
      applyUiPreferences: jest.fn(),
      applyWindowEffects: jest.fn(),
    };
    jest.doMock('../../src/ui-utils.js', () => mockUiUtils);
    jest.doMock('../../src/utils.js', () => ({
      __esModule: true,
      reconcileConfigEntityIds: jest.fn((nextConfig) => ({ changed: false, config: nextConfig })),
      resolveEntityId: jest.fn((entityId) => entityId),
    }));
    jest.doMock('../../src/i18n.js', () => ({
      __esModule: true,
      setLocaleBootstrap: jest.fn(),
      t: jest.fn((key, vars = {}) =>
        String(key).replace(/\{\{(\w+)\}\}/g, (_match, name) =>
          Object.prototype.hasOwnProperty.call(vars, name) ? String(vars[name]) : `{{${name}}}`
        )
      ),
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

  afterEach(() => {
    jest.useRealTimers();
    jest.resetModules();
    delete window.electronAPI;
    document.body.innerHTML = '';
  });

  describe('OAuth access token refresh', () => {
    it('keeps a healthy socket when only the access token rotates', async () => {
      await loadRenderer();
      expect(mockWebsocket.connect).toHaveBeenCalledTimes(1);
      connectSuccessfully();

      triggerMockEvent('configUpdated', oauthConfig({ token: 'access-token-2' }));
      await flushAsync();

      expect(mockWebsocket.close).not.toHaveBeenCalled();
      expect(mockWebsocket.connect).toHaveBeenCalledTimes(1);
    });

    it('reconnects a socket that is down as soon as a new access token arrives', async () => {
      await loadRenderer();
      connectSuccessfully();
      mockWebsocket.connected = false;
      mockWebsocket.emit('close', { intentional: false });

      triggerMockEvent('configUpdated', oauthConfig({ token: 'access-token-2' }));
      await flushAsync();

      expect(mockWebsocket.connect).toHaveBeenCalledTimes(2);
    });

    it('treats a new authorization as a new connection', async () => {
      await loadRenderer();
      connectSuccessfully();

      triggerMockEvent(
        'configUpdated',
        oauthConfig({ token: 'access-token-2', oauthAuthorizationId: 'authorization-2' })
      );
      await flushAsync();

      expect(mockWebsocket.close).toHaveBeenCalled();
      expect(mockWebsocket.connect).toHaveBeenCalledTimes(2);
    });

    it('still reconnects when a legacy token changes', async () => {
      await loadRenderer({ config: tokenConfig() });
      connectSuccessfully();
      const nextConfig = tokenConfig();
      nextConfig.homeAssistant.token = 'another-legacy-token';

      triggerMockEvent('configUpdated', nextConfig);
      await flushAsync();

      expect(mockWebsocket.close).toHaveBeenCalled();
      expect(mockWebsocket.connect).toHaveBeenCalledTimes(2);
    });
  });
});

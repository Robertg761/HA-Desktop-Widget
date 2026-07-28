/**
 * @jest-environment jsdom
 */

const EventEmitter = require('events');
const {
  createMockElectronAPI,
  resetMockElectronAPI,
  triggerMockEvent,
} = require('../mocks/electron.js');

describe('Renderer first-run connection verification', () => {
  let mockElectronAPI;
  let mockState;
  let mockWebsocket;

  const unconfiguredConfig = () => ({
    homeAssistant: {
      url: '',
      token: 'YOUR_LONG_LIVED_ACCESS_TOKEN',
    },
    favoriteEntities: [],
    entityAlerts: {
      enabled: false,
      alerts: {},
    },
    globalHotkeys: {
      enabled: false,
      hotkeys: {},
    },
    ui: {
      theme: 'auto',
      enableInteractionDebugLogs: false,
    },
  });

  const flushAsync = async () => {
    for (let index = 0; index < 8; index += 1) {
      await Promise.resolve();
    }
    await new Promise((resolve) => setTimeout(resolve, 0));
  };

  const clickButton = async (label) => {
    const button = Array.from(document.querySelectorAll('button')).find(
      (candidate) => candidate.textContent === label
    );
    expect(button).toBeTruthy();
    button.click();
    await flushAsync();
    return button;
  };

  const enterInput = (selector, value) => {
    const input = document.querySelector(selector);
    expect(input).toBeTruthy();
    input.value = value;
    input.dispatchEvent(new Event('input', { bubbles: true }));
  };

  const reachConnectionTestStep = async ({ url, token }) => {
    await clickButton('Next');
    enterInput('#first-run-ha-url', url);
    await clickButton('Next');
    await clickButton('Next');
    enterInput('#first-run-ha-token', token);
    await clickButton('Next');
  };

  const loadRenderer = async () => {
    jest.resetModules();
    resetMockElectronAPI();
    document.body.innerHTML = '<main class="widget-content"></main>';
    document.body.className = '';
    window.history.replaceState({}, '', 'http://localhost/');

    mockElectronAPI = createMockElectronAPI();
    mockElectronAPI.getConfig.mockResolvedValue(unconfiguredConfig());
    mockElectronAPI.testHaConnection = jest.fn();
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
    mockWebsocket.connect = jest.fn();
    mockWebsocket.request = jest.fn(() => ({ id: 1, catch: jest.fn() }));
    mockWebsocket.callService = jest.fn();
    mockWebsocket.close = jest.fn();
    mockWebsocket.ws = null;

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
    jest.doMock('../../src/websocket.js', () => ({ __esModule: true, default: mockWebsocket }));
    jest.doMock('../../src/hotkeys.js', () => ({
      __esModule: true,
      initializeHotkeys: jest.fn(),
      setupHotkeyEventListeners: jest.fn(),
      renderHotkeysTab: jest.fn(),
      assignHotkeyToEntity: jest.fn(),
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
    jest.doMock('../../src/ui.js', () => ({
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
    }));
    jest.doMock('../../src/settings.js', () => ({
      __esModule: true,
      openSettings: jest.fn(),
      closeSettings: jest.fn(),
      saveSettings: jest.fn(),
      renderAlertsListInline: jest.fn(),
    }));
    jest.doMock('../../src/ui-utils.js', () => ({
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
      applyWindowEffects: jest.fn(),
    }));
    jest.doMock('../../src/utils.js', () => ({
      __esModule: true,
      reconcileConfigEntityIds: jest.fn((config) => ({ changed: false, config })),
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
    jest.resetModules();
    delete window.electronAPI;
    document.body.innerHTML = '';
  });

  it('retests after credentials change and saves only the newly verified pair', async () => {
    await loadRenderer();
    mockElectronAPI.updateConfig.mockClear();
    mockElectronAPI.testHaConnection.mockResolvedValue({ success: true });
    await reachConnectionTestStep({
      url: 'http://ha-one.local:8123',
      token: 'token-one',
    });

    await clickButton('Test connection');
    await clickButton('Next');
    await clickButton('Back');
    await clickButton('Back');
    enterInput('#first-run-ha-token', 'token-two');
    await clickButton('Next');
    await clickButton('Next');
    await clickButton('Finish');

    expect(mockElectronAPI.testHaConnection).toHaveBeenNthCalledWith(
      1,
      'http://ha-one.local:8123',
      'token-one'
    );
    expect(mockElectronAPI.testHaConnection).toHaveBeenNthCalledWith(
      2,
      'http://ha-one.local:8123',
      'token-two'
    );
    expect(mockElectronAPI.updateConfig).toHaveBeenLastCalledWith(
      expect.objectContaining({
        homeAssistant: expect.objectContaining({
          url: 'http://ha-one.local:8123',
          token: 'token-two',
        }),
      })
    );
  });

  it('ignores a stale in-flight result after the token changes', async () => {
    await loadRenderer();
    mockElectronAPI.updateConfig.mockClear();
    let resolveOldTest;
    const oldTest = new Promise((resolve) => {
      resolveOldTest = resolve;
    });
    mockElectronAPI.testHaConnection
      .mockImplementationOnce(() => oldTest)
      .mockResolvedValueOnce({ success: true });

    await reachConnectionTestStep({
      url: 'http://ha.local:8123',
      token: 'old-token',
    });
    document.querySelector('.first-run-test-row button').click();
    await flushAsync();

    await clickButton('Back');
    enterInput('#first-run-ha-token', 'new-token');
    await clickButton('Next');
    await clickButton('Test connection');
    resolveOldTest({ success: false, code: 'auth-failed' });
    await flushAsync();

    expect(document.querySelector('.first-run-status').textContent).toBe(
      'Connection test succeeded. Home Assistant is reachable.'
    );
    await clickButton('Next');
    await clickButton('Finish');
    expect(mockElectronAPI.testHaConnection).toHaveBeenCalledTimes(2);
    expect(mockElectronAPI.updateConfig).toHaveBeenLastCalledWith(
      expect.objectContaining({
        homeAssistant: expect.objectContaining({ token: 'new-token' }),
      })
    );
  });

  it('coalesces duplicate Finish clicks while verification is pending', async () => {
    await loadRenderer();
    mockElectronAPI.updateConfig.mockClear();
    let resolveTest;
    mockElectronAPI.testHaConnection.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveTest = resolve;
        })
    );
    await reachConnectionTestStep({
      url: 'http://ha.local:8123',
      token: 'only-token',
    });
    await clickButton('Next');

    const finishButton = Array.from(document.querySelectorAll('button')).find(
      (button) => button.textContent === 'Finish'
    );
    finishButton.click();
    finishButton.click();
    await flushAsync();

    expect(mockElectronAPI.testHaConnection).toHaveBeenCalledTimes(1);
    expect(mockElectronAPI.updateConfig).not.toHaveBeenCalled();

    resolveTest({ success: true });
    await flushAsync();

    expect(mockElectronAPI.updateConfig).toHaveBeenCalledTimes(1);
  });

  it('starts the configured runtime once when saving also broadcasts config-updated', async () => {
    await loadRenderer();
    mockElectronAPI.testHaConnection.mockResolvedValue({ success: true });
    mockElectronAPI.updateConfig.mockImplementationOnce(async (nextConfig) => {
      triggerMockEvent('configUpdated', nextConfig);
      await Promise.resolve();
      return nextConfig;
    });
    await reachConnectionTestStep({
      url: 'http://ha.local:8123',
      token: 'verified-token',
    });

    await clickButton('Test connection');
    await clickButton('Next');
    await clickButton('Finish');
    await flushAsync();

    expect(mockElectronAPI.updateConfig).toHaveBeenCalled();
    expect(mockWebsocket.connect).toHaveBeenCalledTimes(1);
  });
});

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
  let mockUiUtils;
  let mockHotkeys;
  let mockAlerts;

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

  const loadRenderer = async ({
    config = unconfiguredConfig(),
    configureApi,
    bodyHtml = '<main class="widget-content"></main>',
  } = {}) => {
    jest.resetModules();
    resetMockElectronAPI();
    document.body.innerHTML = bodyHtml;
    document.body.className = '';
    window.history.replaceState({}, '', 'http://localhost/');

    mockElectronAPI = createMockElectronAPI();
    mockElectronAPI.getConfig.mockResolvedValue(config);
    mockElectronAPI.testHaConnection = jest.fn();
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
    mockHotkeys = {
      __esModule: true,
      initializeHotkeys: jest.fn(),
      setupHotkeyEventListeners: jest.fn(),
      renderHotkeysTab: jest.fn(),
      assignHotkeyToEntity: jest.fn(),
      toggleHotkeys: jest.fn(),
      captureHotkey: jest.fn(),
    };
    jest.doMock('../../src/hotkeys.js', () => mockHotkeys);
    mockAlerts = {
      __esModule: true,
      initializeEntityAlerts: jest.fn(),
      checkEntityAlerts: jest.fn(),
      toggleAlerts: jest.fn(),
    };
    jest.doMock('../../src/alerts.js', () => mockAlerts);
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
      applyWindowEffects: jest.fn(),
    };
    jest.doMock('../../src/ui-utils.js', () => mockUiUtils);
    jest.doMock('../../src/utils.js', () => ({
      __esModule: true,
      reconcileConfigEntityIds: jest.fn((config) => ({ changed: false, config })),
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

  it('signals readiness through preload only after renderer configuration initializes', async () => {
    await loadRenderer();

    expect(mockElectronAPI.signalRendererReady).toHaveBeenCalledTimes(1);
    expect(mockElectronAPI.getConfig.mock.invocationCallOrder[0]).toBeLessThan(
      mockElectronAPI.signalRendererReady.mock.invocationCallOrder[0]
    );
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

  it('keeps onboarding open and shows the persistence error when Finish cannot save', async () => {
    await loadRenderer();
    mockElectronAPI.testHaConnection.mockResolvedValue({ success: true });
    mockElectronAPI.updateConfig.mockRejectedValueOnce(new Error('disk unavailable'));
    await reachConnectionTestStep({
      url: 'http://ha.local:8123',
      token: 'verified-token',
    });

    await clickButton('Test connection');
    await clickButton('Next');
    await clickButton('Finish');

    const wizard = document.getElementById('first-run-onboarding');
    const status = document.querySelector('.first-run-status');
    expect(wizard.classList).not.toContain('hidden');
    expect(status.dataset.status).toBe('error');
    expect(status.textContent).toContain('disk unavailable');
    expect(mockUiUtils.showToast).toHaveBeenCalledWith(
      expect.stringContaining('disk unavailable'),
      'error',
      6000
    );
    expect(mockWebsocket.connect).not.toHaveBeenCalled();
    expect(mockState.CONFIG.homeAssistant.token).toBe('YOUR_LONG_LIVED_ACCESS_TOKEN');
  });

  it('shows one runtime-only recovery warning with the quarantined config path', async () => {
    await loadRenderer({
      config: {
        ...unconfiguredConfig(),
        configRecovery: {
          recovered: true,
          backupPath: '/tmp/config.corrupt.2026-07-27.json',
          error: '',
        },
      },
    });

    expect(mockUiUtils.showToast).toHaveBeenCalledWith(
      expect.stringContaining('/tmp/config.corrupt.2026-07-27.json'),
      'warning',
      20000
    );
    expect(mockState.CONFIG).not.toHaveProperty('configRecovery');

    triggerMockEvent('configUpdated', {
      ...mockState.CONFIG,
      configRecovery: {
        recovered: true,
        backupPath: '/tmp/config.corrupt.2026-07-27.json',
      },
    });
    await flushAsync();
    expect(mockState.CONFIG).not.toHaveProperty('configRecovery');
    expect(mockUiUtils.showToast).toHaveBeenCalledTimes(1);
  });

  it('shows and strips token persistence warnings delivered after a save', async () => {
    await loadRenderer();
    mockUiUtils.showToast.mockClear();

    triggerMockEvent('configPersistenceWarning', [{ code: 'home_assistant_token_not_persisted' }]);
    await flushAsync();

    expect(mockUiUtils.showToast).toHaveBeenCalledWith(
      expect.stringContaining('Token encryption is not available'),
      'warning',
      20000
    );
    expect(mockState.CONFIG).not.toHaveProperty('persistenceWarnings');
  });

  it('continues startup but reports when token recovery acknowledgement is not persisted', async () => {
    await loadRenderer({
      config: {
        ...unconfiguredConfig(),
        tokenResetReason: 'decryption_failed',
      },
      configureApi(api) {
        api.clearTokenResetReason.mockRejectedValueOnce(new Error('config is read-only'));
      },
    });

    expect(mockUiUtils.showToast).toHaveBeenCalledWith(
      expect.stringContaining('config is read-only'),
      'error',
      10000
    );
    expect(mockUiUtils.showToast).toHaveBeenCalledWith(
      expect.stringContaining('needs to be re-entered'),
      'warning',
      20000
    );
    expect(mockElectronAPI.signalRendererReady).toHaveBeenCalledTimes(1);
  });

  it('reverts hotkey and alert controls when their main-process mutations fail', async () => {
    await loadRenderer({
      bodyHtml: `
        <main class="widget-content"></main>
        <input id="global-hotkeys-enabled" type="checkbox">
        <section id="hotkeys-section" style="display: none"></section>
        <input id="entity-alerts-enabled" type="checkbox">
        <section id="alerts-section" style="display: none"></section>
      `,
    });
    mockHotkeys.toggleHotkeys.mockResolvedValue(false);
    mockAlerts.toggleAlerts.mockResolvedValue(false);

    const hotkeyToggle = document.getElementById('global-hotkeys-enabled');
    hotkeyToggle.checked = true;
    hotkeyToggle.dispatchEvent(new Event('change'));
    const alertToggle = document.getElementById('entity-alerts-enabled');
    alertToggle.checked = true;
    alertToggle.dispatchEvent(new Event('change'));
    await flushAsync();

    expect(hotkeyToggle.checked).toBe(false);
    expect(hotkeyToggle.disabled).toBe(false);
    expect(document.getElementById('hotkeys-section').style.display).toBe('none');
    expect(alertToggle.checked).toBe(false);
    expect(alertToggle.disabled).toBe(false);
    expect(document.getElementById('alerts-section').style.display).toBe('none');
  });

  it('keeps a hotkey visible and authoritative when clearing it fails', async () => {
    const config = unconfiguredConfig();
    config.globalHotkeys.hotkeys['light.office'] = {
      hotkey: 'Ctrl+Shift+L',
      action: 'toggle',
    };
    await loadRenderer({
      config,
      bodyHtml: `
        <main class="widget-content"></main>
        <div id="hotkeys-list">
          <div>
            <input class="hotkey-input" data-entity-id="light.office" value="Ctrl+Shift+L">
            <button class="btn-clear-hotkey">Clear</button>
          </div>
        </div>
      `,
      configureApi(api) {
        api.unregisterHotkey.mockResolvedValueOnce({
          success: false,
          error: 'Portal removal failed',
        });
      },
    });

    document.querySelector('.btn-clear-hotkey').click();
    await flushAsync();

    expect(document.querySelector('.hotkey-input').value).toBe('Ctrl+Shift+L');
    expect(mockState.CONFIG.globalHotkeys.hotkeys['light.office']).toEqual({
      hotkey: 'Ctrl+Shift+L',
      action: 'toggle',
    });
    expect(mockHotkeys.renderHotkeysTab).not.toHaveBeenCalled();
    expect(mockUiUtils.showToast).toHaveBeenCalledWith('Portal removal failed', 'error', 3000);
  });

  it('closes the WebSocket through its lifecycle manager when the browser goes offline', async () => {
    await loadRenderer();
    const rawSocketClose = jest.fn();
    mockWebsocket.ws = {
      readyState: WebSocket.OPEN,
      close: rawSocketClose,
    };
    mockWebsocket.close.mockClear();

    window.dispatchEvent(new Event('offline'));

    expect(mockWebsocket.close).toHaveBeenCalledTimes(1);
    expect(rawSocketClose).not.toHaveBeenCalled();
  });
});

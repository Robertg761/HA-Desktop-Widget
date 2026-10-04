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
      '<div id="settings-modal" class="hidden"><input id="ha-url" value="" /></div>' +
      '<div id="widget-state-live" role="status"></div>';
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
      mockWebsocket.ws = {};
    });
    mockWebsocket.isConnected = jest.fn(() => mockWebsocket.connected);
    mockWebsocket.request = jest.fn(() => ({ id: 1, catch: jest.fn() }));
    mockWebsocket.callService = jest.fn();
    mockWebsocket.close = jest.fn(() => {
      mockWebsocket.connected = false;
      mockWebsocket.ws = null;
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
      openSettings: jest.fn(() => {
        document.getElementById('settings-modal')?.classList.remove('hidden');
      }),
      closeSettings: jest.fn(),
      saveSettings: jest.fn(),
      renderAlertsListInline: jest.fn(),
      refreshHomeAssistantAuthStatus: jest.fn(),
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
      dismissToast: jest.fn(),
      dismissToasts: jest.fn(),
      ...require('../helpers/ui-utils-dialogs').realDialogHelpers(),
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

  describe('rejected or expired Home Assistant authorization', () => {
    const reauthConfig = () =>
      oauthConfig({
        token: 'YOUR_LONG_LIVED_ACCESS_TOKEN',
        oauthStatus: 'reauth_required',
        oauthAuthorizationId: undefined,
      });

    it('refreshes the authorization instead of blaming a token when Home Assistant rejects it', async () => {
      await loadRenderer({
        configureApi(api) {
          api.refreshHomeAssistantOAuth.mockImplementation(async () => {
            // Main's config broadcast arrives as its own IPC event, after the call was made.
            await Promise.resolve();
            triggerMockEvent('configUpdated', oauthConfig({ token: 'access-token-2' }));
            return { success: true, oauthStatus: 'connected' };
          });
        },
      });
      connectSuccessfully();
      mockWebsocket.connected = false;

      mockWebsocket.emit('message', { type: 'auth_invalid' });
      expect(panelText()).toContain('Refreshing Home Assistant authorization...');
      await flushAsync();

      expect(mockElectronAPI.refreshHomeAssistantOAuth).toHaveBeenCalledTimes(1);
      expect(mockWebsocket.connect).toHaveBeenCalledTimes(2);
      expect(JSON.stringify(mockUiUtils.showToast.mock.calls)).not.toMatch(/token/i);
    });

    it('asks to reconnect when Home Assistant revoked the authorization', async () => {
      Element.prototype.scrollIntoView = jest.fn();
      await loadRenderer({
        configureApi(api) {
          api.refreshHomeAssistantOAuth.mockImplementation(async () => {
            triggerMockEvent('configUpdated', reauthConfig());
            return { success: true, oauthStatus: 'reauth_required' };
          });
        },
      });
      connectSuccessfully();
      mockWebsocket.connected = false;

      mockWebsocket.emit('message', { type: 'auth_invalid' });
      await flushAsync();

      expect(panelText()).toContain('Home Assistant authorization expired');
      expect(panelText()).not.toMatch(/token/i);
      expect(Element.prototype.scrollIntoView).not.toHaveBeenCalled();
      expect(mockUiUtils.setStatus).toHaveBeenLastCalledWith(
        false,
        'Home Assistant authorization expired. Reconnect with Home Assistant in Settings.'
      );
      expect(mockElectronAPI.publishHaConnectionState).toHaveBeenLastCalledWith('auth-failed');
      expect(document.getElementById('first-run-onboarding')).toBeNull();
      expect(require('../../src/settings.js').refreshHomeAssistantAuthStatus).toHaveBeenCalled();

      // Like main, broadcast the new authorization before answering the pairing request.
      mockElectronAPI.startHomeAssistantOAuth.mockImplementation(async () => {
        const nextConfig = oauthConfig({ oauthAuthorizationId: 'authorization-2' });
        triggerMockEvent('configUpdated', nextConfig);
        return { success: true, config: nextConfig };
      });
      findButton('Reconnect with Home Assistant').click();
      await flushAsync();
      expect(mockElectronAPI.startHomeAssistantOAuth).toHaveBeenCalledWith('http://ha.local:8123');
      expect(mockWebsocket.connect).toHaveBeenCalledTimes(2);
      expect(panelText()).not.toContain('authorization expired');
    });

    it('does not loop when Home Assistant also rejects the refreshed token', async () => {
      await loadRenderer({
        configureApi(api) {
          api.refreshHomeAssistantOAuth.mockImplementation(async () => {
            triggerMockEvent('configUpdated', oauthConfig({ token: 'access-token-2' }));
            return { success: true, oauthStatus: 'connected' };
          });
        },
      });
      mockWebsocket.emit('message', { type: 'auth_invalid' });
      await flushAsync();
      mockWebsocket.emit('message', { type: 'auth_invalid' });
      await flushAsync();

      expect(mockElectronAPI.refreshHomeAssistantOAuth).toHaveBeenCalledTimes(1);
      expect(panelText()).toContain('Home Assistant rejected the authorization for this app.');
      expect(findButton('Reconnect with Home Assistant')).toBeTruthy();
      expect(panelText()).not.toMatch(/token/i);

      findButton('Retry').click();
      mockWebsocket.emit('message', { type: 'auth_invalid' });
      await flushAsync();
      expect(mockElectronAPI.refreshHomeAssistantOAuth).toHaveBeenCalledTimes(2);
    });

    it('keeps the token wording and no refresh for legacy token users', async () => {
      await loadRenderer({ config: tokenConfig() });
      mockWebsocket.emit('message', { type: 'auth_invalid' });
      await flushAsync();

      expect(mockElectronAPI.refreshHomeAssistantOAuth).not.toHaveBeenCalled();
      expect(panelText()).toContain(
        'Authentication failed. Please check your Home Assistant token in Settings.'
      );
    });

    it('opens on a reconnect prompt, not the welcome wizard, after a revoke while closed', async () => {
      await loadRenderer({ config: reauthConfig() });

      expect(document.getElementById('first-run-onboarding')).toBeNull();
      expect(panelText()).toContain('Home Assistant authorization expired');
      expect(findButton('Reconnect with Home Assistant')).toBeTruthy();
      expect(mockWebsocket.connect).not.toHaveBeenCalled();

      let finishPairing;
      mockElectronAPI.startHomeAssistantOAuth.mockImplementation(
        () =>
          new Promise((resolve) => {
            finishPairing = resolve;
          })
      );
      findButton('Reconnect with Home Assistant').click();
      await flushAsync();
      expect(panelText()).toContain('Opening Home Assistant for authorization...');
      findButton('Cancel').click();
      expect(mockElectronAPI.cancelHomeAssistantOAuth).toHaveBeenCalled();

      finishPairing({ success: true, config: oauthConfig({ oauthAuthorizationId: 'auth-2' }) });
      await flushAsync();
      expect(mockWebsocket.connect).toHaveBeenCalledTimes(1);
      expect(document.getElementById('first-run-onboarding')).toBeNull();
    });

    it('explains an unreachable server in the reconnect prompt', async () => {
      await loadRenderer({ config: reauthConfig() });
      // The shape main returns through the preload bridge.
      mockElectronAPI.startHomeAssistantOAuth.mockResolvedValue({
        success: false,
        code: 'OAUTH_SERVER_UNREACHABLE',
        error: 'Could not reach Home Assistant at that URL',
      });

      findButton('Reconnect with Home Assistant').click();
      await flushAsync();

      expect(panelText()).toContain('Could not reach Home Assistant at that URL.');
      expect(findButton('Reconnect with Home Assistant')).toBeTruthy();
      // An unreachable server is an outcome to report, not a fault in the widget.
      const logged = (spy) =>
        spy.mock.calls.some(
          ([label]) => label === 'Failed to reconnect Home Assistant authorization:'
        );
      expect(logged(mockLog.warn)).toBe(true);
      expect(logged(mockLog.error)).toBe(false);
    });

    it('records an authorization that could not be restored at launch in diagnostics', async () => {
      await loadRenderer({
        config: oauthConfig({
          token: 'YOUR_LONG_LIVED_ACCESS_TOKEN',
          oauthStatus: 'offline',
          oauthAuthorizationId: undefined,
          oauthLastErrorCode: 'OAUTH_TOKEN_NETWORK',
          oauthLastError: 'connect ECONNREFUSED',
        }),
      });
      const { diagnosticsReport } = require('../../src/dashboard-tools.js');
      expect(diagnosticsReport().recentIssues).toEqual([
        expect.objectContaining({ reason: 'authorization_unavailable', recoveredAt: null }),
      ]);
    });

    it('shows a configured but unreachable server as disconnected, not as setup', async () => {
      await loadRenderer({
        config: oauthConfig({
          token: 'YOUR_LONG_LIVED_ACCESS_TOKEN',
          oauthStatus: 'offline',
          oauthAuthorizationId: undefined,
        }),
      });

      expect(document.getElementById('first-run-onboarding')).toBeNull();
      expect(panelText()).toContain('Home Assistant is disconnected');
      expect(panelText()).toContain(
        'Home Assistant is offline. Authorization will retry automatically.'
      );
      findButton('Retry').click();
      await flushAsync();
      expect(mockElectronAPI.refreshHomeAssistantOAuth).toHaveBeenCalledTimes(1);
    });
  });

  describe('a saved authorization this system cannot read', () => {
    it('asks to reconnect and explains why instead of retrying forever', async () => {
      await loadRenderer({
        config: oauthConfig({
          token: 'YOUR_LONG_LIVED_ACCESS_TOKEN',
          oauthStatus: 'reauth_required',
          oauthAuthorizationId: undefined,
          oauthLastError: 'Saved Home Assistant authorization could not be decrypted',
          oauthLastErrorCode: 'OAUTH_STORE_DECRYPT',
        }),
      });
      const message =
        'The saved Home Assistant authorization could not be read. Reconnect with Home Assistant.';
      expect(panelText()).toContain(message);
      expect(panelText()).not.toContain('offline');
      expect(findButton('Reconnect with Home Assistant')).toBeTruthy();
      expect(mockUiUtils.setStatus).toHaveBeenLastCalledWith(false, message);
    });

    it('explains a refresh failure that is not an outage in the offline panel', async () => {
      await loadRenderer({
        config: oauthConfig({
          token: 'YOUR_LONG_LIVED_ACCESS_TOKEN',
          oauthStatus: 'offline',
          oauthAuthorizationId: undefined,
          oauthLastError: 'bad response',
          oauthLastErrorCode: 'OAUTH_TOKEN_RESPONSE',
        }),
      });
      expect(panelText()).toContain(
        'Home Assistant could not complete the authorization. Try again.'
      );
      expect(panelText()).not.toContain('Authorization will retry automatically');
    });
  });

  describe('reconnect requests without a usable authorization', () => {
    const tokenToasts = () =>
      mockUiUtils.showToast.mock.calls.filter(([message]) => /token/i.test(String(message)));

    it('keeps the reconnect prompt when main asks to reconnect after sleep', async () => {
      await loadRenderer({
        config: oauthConfig({
          token: 'YOUR_LONG_LIVED_ACCESS_TOKEN',
          oauthStatus: 'reauth_required',
          oauthAuthorizationId: undefined,
        }),
      });
      triggerMockEvent('trayEntitiesRefreshNeeded', { reconnect: true });
      await flushAsync();

      expect(mockWebsocket.connect).not.toHaveBeenCalled();
      expect(tokenToasts()).toEqual([]);
      expect(panelText()).toContain('Home Assistant authorization expired');
      expect(mockUiUtils.setStatus).toHaveBeenLastCalledWith(
        false,
        'Home Assistant authorization expired. Reconnect with Home Assistant in Settings.'
      );
    });

    it('keeps the offline authorization state when the network comes back', async () => {
      await loadRenderer({
        config: oauthConfig({
          token: 'YOUR_LONG_LIVED_ACCESS_TOKEN',
          oauthStatus: 'offline',
          oauthAuthorizationId: undefined,
        }),
      });
      window.dispatchEvent(new Event('offline'));
      window.dispatchEvent(new Event('online'));
      await flushAsync();

      expect(mockWebsocket.connect).not.toHaveBeenCalled();
      expect(tokenToasts()).toEqual([]);
      expect(panelText()).toContain(
        'Home Assistant is offline. Authorization will retry automatically.'
      );
      expect(mockUiUtils.setStatus).toHaveBeenLastCalledWith(
        false,
        'Home Assistant is offline. Authorization will retry automatically.'
      );
    });
  });

  describe('first-run wizard for an existing dashboard', () => {
    it('skips choosing rooms and devices when pages already exist', async () => {
      await loadRenderer({
        config: {
          ...baseConfig(),
          homeAssistant: { url: '', token: 'YOUR_LONG_LIVED_ACCESS_TOKEN' },
          customTabs: [{ id: 'kitchen', name: 'Kitchen', entityIds: ['light.kitchen'] }],
          activeTabId: 'kitchen',
        },
      });
      expect(document.getElementById('first-run-onboarding').classList).not.toContain('hidden');
      findButton('Next').click();
      await flushAsync();
      const input = document.getElementById('first-run-ha-url');
      input.value = 'http://ha.local:8123';
      input.dispatchEvent(new Event('input', { bubbles: true }));
      findButton('Next').click();
      await flushAsync();
      findButton('Connect').click();
      await flushAsync();

      expect(mockElectronAPI.startHomeAssistantOAuth).toHaveBeenCalledWith('http://ha.local:8123');
      expect(document.getElementById('first-run-onboarding').classList).toContain('hidden');
      expect(findButton('Choose rooms and devices')).toBeUndefined();
      expect(mockWebsocket.connect).toHaveBeenCalledTimes(1);
    });
  });

  describe('leaving the wizard during authorization', () => {
    it('cancels the waiting pairing and carries its URL into Settings', async () => {
      await loadRenderer({
        config: {
          ...baseConfig(),
          homeAssistant: { url: '', token: 'YOUR_LONG_LIVED_ACCESS_TOKEN' },
        },
      });
      let rejectPairing;
      mockElectronAPI.startHomeAssistantOAuth.mockImplementation(
        () =>
          new Promise((_resolve, reject) => {
            rejectPairing = reject;
          })
      );
      mockElectronAPI.cancelHomeAssistantOAuth.mockImplementation(async () => {
        const error = new Error('Home Assistant authorization was canceled');
        error.result = { success: false, code: 'OAUTH_AUTHORIZATION_CANCELED' };
        rejectPairing(error);
        return { success: true, canceled: true };
      });
      findButton('Next').click();
      await flushAsync();
      const input = document.getElementById('first-run-ha-url');
      input.value = 'ha.local:8123';
      input.dispatchEvent(new Event('input', { bubbles: true }));
      findButton('Next').click();
      await flushAsync();
      findButton('Connect').click();
      await flushAsync();

      findButton('Full Settings').click();
      await flushAsync();

      expect(mockElectronAPI.cancelHomeAssistantOAuth).toHaveBeenCalledTimes(1);
      expect(document.getElementById('settings-modal').classList).not.toContain('hidden');
      expect(document.getElementById('ha-url').value).toBe('http://ha.local:8123');
      expect(mockUiUtils.showToast).not.toHaveBeenCalled();
    });
  });

  describe('pending duration alerts when the connection is closed on purpose', () => {
    // websocket.close() never emits "close", so alerts have to be told. Otherwise "front door open
    // for 10 minutes" keeps counting through an outage and notifies about a door that has closed.
    it('are suspended when the browser reports the network is offline', async () => {
      await loadRenderer({ config: tokenConfig() });
      connectSuccessfully();
      mockAlerts.suspendEntityAlerts.mockClear();

      window.dispatchEvent(new Event('offline'));

      expect(mockWebsocket.close).toHaveBeenCalledTimes(1);
      expect(mockAlerts.suspendEntityAlerts).toHaveBeenCalledTimes(1);
      // Suspended before the socket goes, so no timer can fire between the two.
      expect(mockAlerts.suspendEntityAlerts.mock.invocationCallOrder[0]).toBeLessThan(
        mockWebsocket.close.mock.invocationCallOrder[0]
      );
    });

    it('are suspended when Home Assistant rejects the token', async () => {
      await loadRenderer({ config: tokenConfig() });
      connectSuccessfully();
      mockAlerts.suspendEntityAlerts.mockClear();

      mockWebsocket.emit('message', { type: 'auth_invalid' });

      expect(mockWebsocket.close).toHaveBeenCalled();
      expect(mockAlerts.suspendEntityAlerts).toHaveBeenCalled();
    });

    it('are suspended when the connection is replaced after the server address changes', async () => {
      await loadRenderer({ config: tokenConfig() });
      connectSuccessfully();
      mockAlerts.suspendEntityAlerts.mockClear();
      mockWebsocket.close.mockClear();

      triggerMockEvent('configUpdated', {
        ...tokenConfig(),
        homeAssistant: { url: 'http://other.local:8123', token: 'legacy-token' },
      });
      await flushAsync();

      expect(mockWebsocket.close).toHaveBeenCalled();
      expect(mockAlerts.suspendEntityAlerts).toHaveBeenCalled();
    });

    it('are suspended when the socket drops by itself, as before', async () => {
      await loadRenderer({ config: tokenConfig() });
      connectSuccessfully();
      mockAlerts.suspendEntityAlerts.mockClear();

      mockWebsocket.emit('close', { intentional: false });

      expect(mockAlerts.suspendEntityAlerts).toHaveBeenCalledTimes(1);
    });
  });

  describe('an outage', () => {
    const failAttempt = () => {
      mockWebsocket.emit('error', new Error('Could not establish WebSocket connection'));
      mockWebsocket.emit('close', { intentional: false });
    };
    const unreachableToasts = () =>
      mockUiUtils.showToast.mock.calls.filter(([message]) =>
        message.startsWith('Unable to reach Home Assistant')
      );

    it('says the failure in the connection panel, and logs it once, however many retries it takes', async () => {
      await loadRenderer({ config: tokenConfig() });
      // A retry roughly every minute for seven minutes.
      const now = jest.spyOn(Date, 'now');
      for (let attempt = 0; attempt < 7; attempt += 1) {
        now.mockReturnValue(1_000_000 + attempt * 61_000);
        failAttempt();
      }
      now.mockRestore();

      // The panel is on screen with Retry and Open Settings; a toast on the same spot would cover
      // them and swallow the first click, so the reason is in the panel's copy instead.
      expect(unreachableToasts()).toHaveLength(0);
      expect(document.querySelector('#widget-state-panel .widget-state-copy').textContent).toMatch(
        /^Unable to reach Home Assistant/
      );
      expect(
        mockLog.error.mock.calls.filter(([label]) => label === 'WebSocket error:')
      ).toHaveLength(1);
      expect(mockLog.debug).toHaveBeenCalledWith(
        'WebSocket error (still retrying):',
        'Could not establish WebSocket connection'
      );
    });

    it('toasts the failure once per outage where there is no connection panel to say it', async () => {
      await loadRenderer({ config: tokenConfig() });
      const now = jest.spyOn(Date, 'now');
      for (let attempt = 0; attempt < 7; attempt += 1) {
        now.mockReturnValue(1_000_000 + attempt * 61_000);
        document.body.classList.remove('widget-state-active');
        failAttempt();
      }
      now.mockRestore();

      expect(unreachableToasts()).toHaveLength(1);
      expect(mockUiUtils.showToast).toHaveBeenCalledWith(
        expect.stringMatching(/^Unable to reach Home Assistant/),
        'error',
        15000,
        { source: 'connection' }
      );

      connectSuccessfully();
      document.body.classList.remove('widget-state-active');
      failAttempt();
      expect(unreachableToasts()).toHaveLength(2);
    });

    it('takes the connection toasts down when Settings opens so the Save button is reachable', async () => {
      await loadRenderer({ config: tokenConfig() });
      failAttempt();

      findButton('Open Settings').click();

      expect(mockUiUtils.dismissToasts).toHaveBeenCalledWith('connection');
      expect(mockUiUtils.dismissToasts).toHaveBeenCalledWith('startup-warning');
      expect(document.getElementById('settings-modal').classList).not.toContain('hidden');
    });

    it('takes the connection toasts down once the connection is back, so none outlives the recovery', async () => {
      await loadRenderer({ config: tokenConfig() });
      failAttempt();
      mockUiUtils.dismissToasts.mockClear();

      connectSuccessfully();

      expect(mockUiUtils.dismissToasts).toHaveBeenCalledWith('connection');
      expect(mockUiUtils.dismissToasts).not.toHaveBeenCalledWith('startup-warning');
    });

    it('says an authentication failure once, however many times Home Assistant rejects the token', async () => {
      await loadRenderer({ config: tokenConfig() });
      for (let attempt = 0; attempt < 3; attempt += 1) {
        document.body.classList.remove('widget-state-active');
        mockWebsocket.emit('message', { type: 'auth_invalid' });
      }

      expect(
        mockUiUtils.showToast.mock.calls.filter(([message]) =>
          /authentication failed/i.test(message)
        )
      ).toHaveLength(1);
    });

    it('keeps one panel, and the keyboard on Retry, however often the retries redraw it', async () => {
      await loadRenderer({ config: tokenConfig() });
      failAttempt();
      const panel = document.getElementById('widget-state-panel');
      const retry = findButton('Retry');
      retry.focus();

      // Each attempt reports connecting, then the error, then the close.
      for (let attempt = 0; attempt < 4; attempt += 1) {
        mockWebsocket.emit('connect-attempt');
        failAttempt();
      }

      expect(document.getElementById('widget-state-panel')).toBe(panel);
      expect(document.querySelectorAll('#widget-state-panel')).toHaveLength(1);
      expect(findButton('Retry')).toBe(retry);
      expect(document.activeElement).toBe(retry);
    });

    it('announces a problem once, not on every retry, through one live region', async () => {
      await loadRenderer({ config: tokenConfig() });
      const live = document.getElementById('widget-state-live');
      const changes = [];
      new MutationObserver(() => changes.push(live.textContent)).observe(live, {
        childList: true,
        characterData: true,
        subtree: true,
      });
      const settleAnnouncement = () => new Promise((resolve) => setTimeout(resolve, 80));

      failAttempt();
      await settleAnnouncement();
      expect(live.textContent).toMatch(/^Home Assistant is disconnected\. Unable to reach/);
      const announcements = changes.filter(Boolean).length;
      expect(announcements).toBe(1);
      expect(document.getElementById('widget-state-panel').getAttribute('role')).toBeNull();

      for (let attempt = 0; attempt < 3; attempt += 1) {
        mockWebsocket.emit('connect-attempt');
        failAttempt();
      }
      await settleAnnouncement();
      expect(changes.filter(Boolean)).toHaveLength(announcements);
    });

    // The panel used to be appended below every tile and scrolled into view, which threw the
    // dashboard to the bottom at each restart of Home Assistant.
    it('puts the panel above Quick Access and leaves the scroll where it was', async () => {
      await loadRenderer({ config: tokenConfig() });
      const content = document.querySelector('.widget-content');
      content.insertAdjacentHTML('beforeend', '<section class="controls-section"></section>');
      const scrollIntoView = jest.fn();
      Element.prototype.scrollIntoView = scrollIntoView;

      failAttempt();

      const panel = document.getElementById('widget-state-panel');
      expect(panel.nextElementSibling).toBe(content.querySelector('.controls-section'));
      expect(scrollIntoView).not.toHaveBeenCalled();
      delete Element.prototype.scrollIntoView;
    });

    it('dims the tiles while Home Assistant cannot be reached', async () => {
      await loadRenderer({ config: tokenConfig() });
      failAttempt();
      expect(document.body.classList).toContain('ha-offline');

      connectSuccessfully();
      await flushAsync();
      expect(document.body.classList).not.toContain('ha-offline');
    });

    // Every retry reports a connection attempt, and login is followed by a wait for the state
    // snapshot; the tiles are as stale then as after the failure, so they must not flash bright.
    it('keeps the tiles dimmed through each retry and until the states arrive', async () => {
      await loadRenderer({ config: tokenConfig() });
      failAttempt();
      mockWebsocket.emit('connect-attempt');
      expect(document.body.classList).toContain('ha-offline');
      failAttempt();
      expect(document.body.classList).toContain('ha-offline');

      mockWebsocket.emit('connect-attempt');
      mockWebsocket.emit('message', { type: 'auth_ok' });
      expect(document.body.classList).toContain('ha-offline');

      connectSuccessfully();
      await flushAsync();
      expect(document.body.classList).not.toContain('ha-offline');
    });

    it('leaves the scroll alone for an empty page too, and ends the page with its panel', async () => {
      await loadRenderer({ config: tokenConfig() });
      const content = document.querySelector('.widget-content');
      content.insertAdjacentHTML('beforeend', '<section class="controls-section"></section>');
      const scrollIntoView = jest.fn();
      Element.prototype.scrollIntoView = scrollIntoView;

      connectSuccessfully();
      await flushAsync();

      const panel = document.getElementById('widget-state-panel');
      expect(panel.textContent).toContain('No Quick Access entities yet');
      expect(content.lastElementChild).toBe(panel);
      expect(scrollIntoView).not.toHaveBeenCalled();
      delete Element.prototype.scrollIntoView;
    });

    it('shows one connection state instead of a placeholder beside the panel', async () => {
      const styles = require('fs').readFileSync(
        require('path').resolve(__dirname, '../../styles.css'),
        'utf8'
      );
      expect(styles).toMatch(
        /body\.widget-state-active #quick-controls \.status-message \{\s*display: none;/
      );
      await loadRenderer({ config: tokenConfig() });
      failAttempt();
      expect(document.body.classList).toContain('widget-state-active');
    });
  });

  describe('the Home Assistant unit system', () => {
    // connectSuccessfully() numbers the four requests it sends 10-13: states, services, areas, config.
    const GET_CONFIG_ID = 13;

    it('is relayed to main for the desktop pin windows once the config arrives', async () => {
      await loadRenderer({ config: tokenConfig() });
      mockState.setTimeZone = jest.fn();
      connectSuccessfully();

      mockWebsocket.emit('message', {
        type: 'result',
        id: GET_CONFIG_ID,
        success: true,
        result: { unit_system: { temperature: '°F', wind_speed: 'mph' } },
      });

      expect(mockState.setUnitSystem).toHaveBeenCalledWith({
        temperature: '°F',
        wind_speed: 'mph',
      });
      expect(mockElectronAPI.publishHaUnitSystem).toHaveBeenCalledWith({
        temperature: '°F',
        wind_speed: 'mph',
      });
    });

    it('is not relayed when the config response has none', async () => {
      await loadRenderer({ config: tokenConfig() });
      mockState.setTimeZone = jest.fn();
      connectSuccessfully();

      mockWebsocket.emit('message', {
        type: 'result',
        id: GET_CONFIG_ID,
        success: true,
        result: { time_zone: 'America/Halifax' },
      });

      expect(mockElectronAPI.publishHaUnitSystem).not.toHaveBeenCalled();
    });
  });

  describe('connection indicator language', () => {
    it('rewrites the indicator label in the new language after a language change', async () => {
      await loadRenderer({ config: tokenConfig() });
      connectSuccessfully();
      expect(mockUiUtils.setStatus).toHaveBeenLastCalledWith(true, 'Real-time updates active.');

      const i18n = require('../../src/i18n.js');
      i18n.t.mockImplementation((key) => `[de] ${key}`);
      mockElectronAPI.getLocaleBootstrap.mockResolvedValue({ activeLocale: 'de', messages: {} });
      triggerMockEvent('configUpdated', { ...tokenConfig(), ui: { language: 'de' } });
      await flushAsync();

      expect(mockUiUtils.setStatus).toHaveBeenLastCalledWith(
        true,
        '[de] Real-time updates active.'
      );
    });
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

    it('skips the appearance pass when only the access token rotates', async () => {
      await loadRenderer();
      connectSuccessfully();
      const appearanceCalls = () =>
        ['applyTheme', 'applyAccentTheme', 'applyUiPreferences', 'applyWindowEffects'].map(
          (name) => mockUiUtils[name].mock.calls.length
        );
      const before = appearanceCalls();

      triggerMockEvent(
        'configUpdated',
        oauthConfig({ token: 'access-token-2', oauthExpiresAt: Date.now() + 30 * 60_000 })
      );
      await flushAsync();
      expect(appearanceCalls()).toEqual(before);

      // A real appearance change in the same kind of echo still repaints.
      triggerMockEvent('configUpdated', {
        ...oauthConfig({ token: 'access-token-3' }),
        ui: { theme: 'light' },
      });
      await flushAsync();
      expect(mockUiUtils.applyTheme).toHaveBeenLastCalledWith('light');
      expect(mockUiUtils.applyWindowEffects.mock.calls.length).toBe(before[3] + 1);
    });

    it('reconnects a socket that is down as soon as a new access token arrives', async () => {
      await loadRenderer();
      connectSuccessfully();
      mockWebsocket.connected = false;
      mockWebsocket.ws = null;
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

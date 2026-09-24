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
      '<div id="settings-modal" class="hidden"><input id="ha-url" value="" /></div>';
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
      closeModal: (...args) => jest.requireActual('../../src/ui-utils.js').closeModal(...args),
      trapFocus: jest.fn((...args) =>
        jest.requireActual('../../src/ui-utils.js').trapFocus(...args)
      ),
      releaseFocusTrap: jest.fn((...args) =>
        jest.requireActual('../../src/ui-utils.js').releaseFocusTrap(...args)
      ),
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
      expect(Element.prototype.scrollIntoView).toHaveBeenCalledWith({ block: 'nearest' });
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

  describe('an outage', () => {
    const failAttempt = () => {
      mockWebsocket.emit('error', new Error('Could not establish WebSocket connection'));
      mockWebsocket.emit('close', { intentional: false });
    };
    const unreachableToasts = () =>
      mockUiUtils.showToast.mock.calls.filter(([message]) =>
        message.startsWith('Unable to reach Home Assistant')
      );

    it('toasts and logs the failure once, however many retries it takes', async () => {
      await loadRenderer({ config: tokenConfig() });
      // A retry roughly every minute for seven minutes.
      const now = jest.spyOn(Date, 'now');
      for (let attempt = 0; attempt < 7; attempt += 1) {
        now.mockReturnValue(1_000_000 + attempt * 61_000);
        failAttempt();
      }
      now.mockRestore();

      expect(unreachableToasts()).toHaveLength(1);
      expect(
        mockLog.error.mock.calls.filter(([label]) => label === 'WebSocket error:')
      ).toHaveLength(1);
      expect(mockLog.debug).toHaveBeenCalledWith(
        'WebSocket error (still retrying):',
        'Could not establish WebSocket connection'
      );

      connectSuccessfully();
      failAttempt();
      expect(unreachableToasts()).toHaveLength(2);
    });

    it('clears its toast when Settings opens so the Save button is reachable', async () => {
      await loadRenderer({ config: tokenConfig() });
      failAttempt();
      const toast = mockUiUtils.showToast.mock.results.at(-1).value;

      findButton('Open Settings').click();

      expect(mockUiUtils.dismissToast).toHaveBeenCalledWith(toast);
      expect(document.getElementById('settings-modal').classList).not.toContain('hidden');
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

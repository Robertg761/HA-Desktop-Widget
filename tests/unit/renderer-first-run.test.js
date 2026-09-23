/**
 * @jest-environment jsdom
 */

const EventEmitter = require('events');
const fs = require('fs');
const path = require('path');
const {
  createMockElectronAPI,
  resetMockElectronAPI,
  triggerMockEvent,
} = require('../mocks/electron.js');

describe('Renderer first-run Home Assistant authorization', () => {
  let mockElectronAPI;
  let mockState;
  let mockWebsocket;
  let mockUiUtils;
  let mockHotkeys;
  let mockAlerts;
  let mockSettings;

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

  const reachAuthorizationStep = async (url) => {
    await clickButton('Next');
    enterInput('#first-run-ha-url', url);
    await clickButton('Next');
  };

  const oauthConfig = (url = 'http://ha.local:8123') => ({
    ...unconfiguredConfig(),
    homeAssistant: {
      url,
      token: 'short-lived-oauth-access-token',
      authMethod: 'oauth',
      oauthStatus: 'connected',
    },
  });

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
      cleanupHotkeyEventListeners: jest.fn(),
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
      switchQuickAccessPage: jest.fn(),
      showAddPageModal: jest.fn(),
    }));
    mockSettings = {
      __esModule: true,
      openSettings: jest.fn(() => {
        document.getElementById('settings-modal')?.classList.remove('hidden');
      }),
      closeSettings: jest.fn(() => jest.requireActual('../../src/settings.js').closeSettings()),
      saveSettings: jest.fn(),
      renderAlertsListInline: jest.fn(),
      reapplySettingsPreviews: jest.fn(),
    };
    jest.doMock('../../src/settings.js', () => mockSettings);
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

  it('uses a four-step browser authorization flow without asking for a token', async () => {
    await loadRenderer();

    expect(document.querySelector('.first-run-step-label').textContent).toBe('Step 1 of 4');
    expect(document.querySelector('input[type="password"]')).toBeNull();
    expect(document.getElementById('first-run-onboarding').textContent).not.toContain(
      'Long-Lived Access Token'
    );

    await reachAuthorizationStep('http://ha-one.local:8123');

    expect(document.querySelector('.first-run-step-label').textContent).toBe('Step 3 of 4');
    expect(document.querySelector('input[type="password"]')).toBeNull();
    expect(document.getElementById('first-run-onboarding').textContent).toContain(
      'Authorize in Home Assistant'
    );
  });

  const settingsNavigationHtml = () => {
    const page = new DOMParser().parseFromString(
      fs.readFileSync(path.join(__dirname, '../../index.html'), 'utf8'),
      'text/html'
    );
    return `
      <header>${page.getElementById('close-btn').outerHTML}</header>
      <main class="widget-content"></main>
      <div id="settings-modal" class="modal hidden">
        ${page.getElementById('close-settings').outerHTML}
        ${page.getElementById('cancel-settings').outerHTML}
      </div>`;
  };

  it.each(['close-settings', 'cancel-settings'])(
    'returns to the same onboarding step and URL through %s on repeated Settings visits',
    async (closeId) => {
      await loadRenderer({ bodyHtml: settingsNavigationHtml() });
      await clickButton('Next');
      enterInput('#first-run-ha-url', 'http://draft.local:8123');
      const stepLabel = document.querySelector('.first-run-step-label').textContent;
      const wizard = document.getElementById('first-run-onboarding');
      const modal = document.getElementById('settings-modal');

      for (let visit = 0; visit < 2; visit += 1) {
        await clickButton('Full Settings');
        expect(wizard.classList.contains('hidden')).toBe(true);
        expect(modal.classList.contains('hidden')).toBe(false);
        document.getElementById(closeId).click();
        await flushAsync();

        expect(modal.classList.contains('hidden')).toBe(true);
        expect(wizard.classList.contains('hidden')).toBe(false);
        expect(document.querySelector('.first-run-step-label').textContent).toBe(stepLabel);
        expect(document.getElementById('first-run-ha-url').value).toBe('http://draft.local:8123');
        expect(mockElectronAPI.quitApp).not.toHaveBeenCalled();
      }
      expect(mockSettings.closeSettings).toHaveBeenCalledTimes(2);

      // Once Settings has closed, an explicit app quit still works.
      document.getElementById('close-btn').click();
      expect(mockElectronAPI.quitApp).toHaveBeenCalledTimes(1);
    }
  );

  it('closes Settings with Escape like Cancel, but lets an open dropdown take Escape first', async () => {
    await loadRenderer({
      bodyHtml: settingsNavigationHtml().replace(
        '<div id="settings-modal" class="modal hidden">',
        `<div id="settings-modal" class="modal hidden">
          <div class="custom-dropdown open"><button class="custom-dropdown-trigger">Player</button></div>`
      ),
    });
    await clickButton('Full Settings');
    const modal = document.getElementById('settings-modal');
    const trigger = modal.querySelector('.custom-dropdown-trigger');
    trigger.addEventListener('keydown', () => trigger.parentElement.classList.remove('open'));
    const escape = (target) =>
      target.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })
      );

    escape(trigger);
    expect(mockSettings.closeSettings).not.toHaveBeenCalled();
    escape(document.getElementById('cancel-settings'));
    expect(mockSettings.closeSettings).toHaveBeenCalledTimes(1);
    await flushAsync();
    expect(modal.classList.contains('hidden')).toBe(true);
  });

  it.each(['quick-controls-modal', 'weather-config-modal'])(
    'closes %s with Escape without also leaving reorganize mode',
    async (id) => {
      const page = new DOMParser().parseFromString(
        fs.readFileSync(path.join(__dirname, '../../index.html'), 'utf8'),
        'text/html'
      );
      await loadRenderer({
        bodyHtml: `<main class="widget-content"></main>${page.getElementById(id).outerHTML}`,
      });
      const modal = document.getElementById(id);
      modal.classList.remove('hidden');
      const pageEscape = jest.fn();
      document.addEventListener('keydown', pageEscape);
      modal
        .querySelector('.close-btn')
        .dispatchEvent(
          new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })
        );
      await flushAsync();
      expect(modal.classList.contains('hidden')).toBe(true);
      expect(pageEscape).not.toHaveBeenCalled();
      document.removeEventListener('keydown', pageEscape);
    }
  );

  it('moves focus into each wizard step and traps Tab inside the wizard', async () => {
    await loadRenderer({ bodyHtml: settingsNavigationHtml() });
    const wizard = document.getElementById('first-run-onboarding');
    expect(document.activeElement).toBe(wizard.querySelector('.first-run-title'));
    expect(mockUiUtils.trapFocus).toHaveBeenCalledWith(wizard, { initialFocus: false });

    await clickButton('Next');
    expect(document.activeElement).toBe(document.getElementById('first-run-ha-url'));
    enterInput('#first-run-ha-url', 'http://ha.local:8123');
    await clickButton('Next');
    expect(document.activeElement.textContent).toBe('Authorize in Home Assistant');

    const buttons = Array.from(wizard.querySelectorAll('button:not(:disabled)'));
    const last = buttons[buttons.length - 1];
    last.focus();
    const tab = new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true });
    last.dispatchEvent(tab);
    expect(tab.defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(buttons[0]);

    // Focus that fell to <body> goes back into the wizard, not to the header behind it.
    document.activeElement.blur();
    document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true }));
    document.getElementById('close-btn').focus();
    await flushAsync();
    expect(wizard.contains(document.activeElement)).toBe(true);
  });

  it.each(['', 'ftp://ha.local'])(
    'keeps the URL step and explains the problem when Next gets %p',
    async (url) => {
      await loadRenderer();
      await clickButton('Next');
      enterInput('#first-run-ha-url', url);
      await clickButton('Next');
      expect(document.querySelector('.first-run-step-label').textContent).toBe('Step 2 of 4');
      expect(document.querySelector('.first-run-status').textContent).toContain(
        'Enter a valid Home Assistant URL before connecting.'
      );
      expect(document.activeElement).toBe(document.getElementById('first-run-ha-url'));
    }
  );

  it('treats Enter in the URL field as Next', async () => {
    await loadRenderer();
    await clickButton('Next');
    enterInput('#first-run-ha-url', 'http://ha.local:8123');
    const enter = new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true });
    document.getElementById('first-run-ha-url').dispatchEvent(enter);
    await flushAsync();
    expect(enter.defaultPrevented).toBe(true);
    expect(document.querySelector('.first-run-step-label').textContent).toBe('Step 3 of 4');
  });

  it('does not quit on repeated close clicks during the Settings exit animation', async () => {
    await loadRenderer({ bodyHtml: settingsNavigationHtml() });
    await reachAuthorizationStep('http://draft.local:8123');
    const stepLabel = document.querySelector('.first-run-step-label').textContent;
    await clickButton('Full Settings');
    const modal = document.getElementById('settings-modal');
    mockSettings.closeSettings.mockImplementation(() => modal.classList.add('modal-closing'));

    document.getElementById('close-settings').click();
    await flushAsync();
    document.getElementById('close-settings').click();
    expect(mockElectronAPI.quitApp).not.toHaveBeenCalled();
    expect(document.getElementById('first-run-onboarding').classList.contains('hidden')).toBe(true);

    modal.classList.remove('modal-closing');
    modal.classList.add('hidden');
    await flushAsync();
    expect(document.getElementById('first-run-onboarding').classList.contains('hidden')).toBe(
      false
    );
    expect(document.querySelector('.first-run-step-label').textContent).toBe(stepLabel);
  });

  it('preserves the onboarding step and draft URL when settings changes echo back', async () => {
    await loadRenderer({ bodyHtml: settingsNavigationHtml() });
    await clickButton('Next');
    enterInput('#first-run-ha-url', 'http://draft.local:8123');
    const stepLabel = document.querySelector('.first-run-step-label').textContent;
    await clickButton('Full Settings');

    triggerMockEvent('configUpdated', {
      ...unconfiguredConfig(),
      ui: { ...unconfiguredConfig().ui, theme: 'dark' },
    });
    await flushAsync();
    expect(document.getElementById('first-run-onboarding').classList.contains('hidden')).toBe(true);
    document.getElementById('close-settings').click();
    await flushAsync();
    expect(document.getElementById('first-run-onboarding').classList.contains('hidden')).toBe(
      false
    );
    expect(document.querySelector('.first-run-step-label').textContent).toBe(stepLabel);
    expect(document.getElementById('first-run-ha-url').value).toBe('http://draft.local:8123');
    expect(mockElectronAPI.quitApp).not.toHaveBeenCalled();
  });

  it('distinguishes Quit from the Settings Close action', async () => {
    await loadRenderer({ bodyHtml: settingsNavigationHtml() });
    expect(document.querySelector('button[aria-label="Close"]').id).toBe('close-settings');
    expect(document.getElementById('close-btn').getAttribute('data-i18n-aria-label')).toBe('Quit');
    expect(document.getElementById('close-btn').title).toBe('Quit');
  });

  it.each(['close-settings', 'cancel-settings'])(
    'does not revive onboarding after a connection is saved and Settings closes through %s',
    async (closeId) => {
      await loadRenderer({ bodyHtml: settingsNavigationHtml() });
      await clickButton('Full Settings');
      mockState.setConfig(oauthConfig());
      document.getElementById(closeId).click();
      await flushAsync();

      expect(document.getElementById('first-run-onboarding').classList.contains('hidden')).toBe(
        true
      );
      expect(mockElectronAPI.quitApp).not.toHaveBeenCalled();
      document.getElementById('close-btn').click();
      expect(mockElectronAPI.quitApp).toHaveBeenCalledTimes(1);
    }
  );

  it('preserves the explicit Quit action even during a Settings detour', async () => {
    await loadRenderer({ bodyHtml: settingsNavigationHtml() });
    await clickButton('Full Settings');
    document.getElementById('close-btn').click();
    expect(mockElectronAPI.quitApp).toHaveBeenCalledTimes(1);
    expect(mockSettings.closeSettings).not.toHaveBeenCalled();
  });

  it('preserves the app quit action for configured users', async () => {
    await loadRenderer({ config: oauthConfig(), bodyHtml: settingsNavigationHtml() });
    mockSettings.openSettings();
    document.getElementById('close-btn').click();
    expect(mockElectronAPI.quitApp).toHaveBeenCalledTimes(1);
    expect(mockSettings.closeSettings).not.toHaveBeenCalled();
  });

  it('starts fresh installs with an empty URL and the Home Assistant 2026.8 address hint', async () => {
    await loadRenderer();

    await clickButton('Next');
    const input = document.getElementById('first-run-ha-url');

    expect(input.value).toBe('');
    expect(input.placeholder).toBe('http://homeassistant.local');
  });

  it('authorizes a fresh Home Assistant 2026.8 install without adding the legacy port', async () => {
    await loadRenderer({
      configureApi(api) {
        api.startHomeAssistantOAuth.mockResolvedValueOnce({
          success: true,
          config: oauthConfig('http://homeassistant.local'),
        });
      },
    });

    await reachAuthorizationStep('homeassistant.local');
    await clickButton('Connect');

    expect(mockElectronAPI.startHomeAssistantOAuth).toHaveBeenCalledWith(
      'http://homeassistant.local'
    );
  });

  it('authorizes the normalized URL and starts the configured runtime', async () => {
    await loadRenderer({
      configureApi(api) {
        api.startHomeAssistantOAuth.mockResolvedValueOnce({
          success: true,
          config: oauthConfig('http://ha.local:8123'),
        });
      },
    });
    await reachAuthorizationStep('ha.local:8123/path');
    await clickButton('Connect');

    expect(mockElectronAPI.startHomeAssistantOAuth).toHaveBeenCalledWith('http://ha.local:8123');
    expect(mockElectronAPI.testHaConnection).not.toHaveBeenCalled();
    expect(mockState.CONFIG.homeAssistant.authMethod).toBe('oauth');
    expect(document.getElementById('first-run-onboarding').classList).not.toContain('hidden');
    expect(document.querySelector('.first-run-step-label').textContent).toBe('Step 4 of 4');
    expect(mockWebsocket.connect).toHaveBeenCalledTimes(1);
    await clickButton('Skip for now');
    expect(document.getElementById('first-run-onboarding').classList).toContain('hidden');
  });

  it('opens the shared starter builder after authorization', async () => {
    await loadRenderer({
      configureApi(api) {
        api.startHomeAssistantOAuth.mockResolvedValueOnce({ config: oauthConfig() });
      },
    });
    await reachAuthorizationStep('ha.local:8123');
    await clickButton('Connect');
    await clickButton('Choose rooms and devices');
    expect(require('../../src/ui.js').showAddPageModal).toHaveBeenCalledWith({ starter: true });
    expect(document.getElementById('first-run-onboarding').classList).toContain('hidden');
  });

  it('offers the starter builder on a connected empty dashboard without onboarding existing users', async () => {
    await loadRenderer({ config: oauthConfig() });
    expect(document.getElementById('first-run-onboarding')).toBeNull();
    let nextRequestId = 123;
    mockWebsocket.request.mockImplementation(({ type }) => {
      const id = nextRequestId++;
      const result =
        type === 'get_states' || type === 'config/area_registry/list'
          ? []
          : type === 'get_services' || type === 'get_config'
            ? {}
            : null;
      return Object.assign(Promise.resolve({ type: 'result', id, success: true, result }), { id });
    });
    mockWebsocket.emit('message', { type: 'auth_ok' });
    mockWebsocket.emit('message', { type: 'result', id: 123, success: true, result: [] });
    await flushAsync();
    await clickButton('Choose rooms and devices');
    expect(require('../../src/ui.js').showAddPageModal).toHaveBeenCalledWith({ starter: true });
  });

  it('coalesces duplicate Connect clicks while browser authorization is pending', async () => {
    await loadRenderer();
    let resolveAuthorization;
    mockElectronAPI.startHomeAssistantOAuth.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveAuthorization = resolve;
        })
    );
    await reachAuthorizationStep('http://ha.local:8123');

    const connectButton = Array.from(document.querySelectorAll('button')).find(
      (button) => button.textContent === 'Connect'
    );
    connectButton.click();
    connectButton.click();
    await flushAsync();

    expect(mockElectronAPI.startHomeAssistantOAuth).toHaveBeenCalledTimes(1);
    expect(mockWebsocket.connect).not.toHaveBeenCalled();

    resolveAuthorization({ success: true, config: oauthConfig() });
    await flushAsync();

    expect(mockWebsocket.connect).toHaveBeenCalledTimes(1);
  });

  it('refreshes Undo when a config broadcast switches Home Assistant servers', async () => {
    localStorage.clear();
    try {
      await loadRenderer({
        config: oauthConfig('http://server-a:8123'),
        bodyHtml:
          '<main class="widget-content"><button id="undo-dashboard-btn" disabled>Undo</button></main>',
      });
      const { rememberDashboard } = require('../../src/dashboard-history.js');
      const nextConfig = oauthConfig('http://server-b:8123');
      nextConfig.customTabs = [{ id: 'one', name: 'One', entityIds: [] }];
      rememberDashboard(nextConfig, {
        ...nextConfig,
        customTabs: [{ id: 'two', name: 'Two', entityIds: [] }],
      });
      const undo = document.getElementById('undo-dashboard-btn');
      expect(undo.disabled).toBe(true);
      triggerMockEvent('configUpdated', nextConfig);
      await flushAsync();
      expect(undo.disabled).toBe(false);
      triggerMockEvent('configUpdated', oauthConfig('http://server-a:8123'));
      await flushAsync();
      expect(undo.disabled).toBe(true);
    } finally {
      localStorage.clear();
    }
  });

  it('restores unsaved Settings previews after a config echo re-applies the saved appearance', async () => {
    await loadRenderer({ config: oauthConfig() });
    mockUiUtils.applyUiPreferences.mockClear();
    mockSettings.reapplySettingsPreviews.mockClear();

    triggerMockEvent('configUpdated', { ...oauthConfig(), ui: { density: 'compact' } });
    await flushAsync();

    expect(mockSettings.reapplySettingsPreviews).toHaveBeenCalledTimes(1);
    expect(mockUiUtils.applyUiPreferences.mock.invocationCallOrder[0]).toBeLessThan(
      mockSettings.reapplySettingsPreviews.mock.invocationCallOrder[0]
    );
  });

  it('gives Settings a hook that reloads the interface language', async () => {
    await loadRenderer({ config: oauthConfig() });
    triggerMockEvent('openSettings');
    const hooks = mockSettings.openSettings.mock.calls[0][0];
    const { setLocaleBootstrap, translateDocument } = require('../../src/i18n.js');
    const { renderActiveTab } = require('../../src/ui.js');
    mockElectronAPI.getLocaleBootstrap.mockClear();
    setLocaleBootstrap.mockClear();
    renderActiveTab.mockClear();

    await hooks.refreshLocale();

    expect(mockElectronAPI.getLocaleBootstrap).toHaveBeenCalledTimes(1);
    expect(setLocaleBootstrap).toHaveBeenCalledTimes(1);
    expect(translateDocument).toHaveBeenCalledWith(document);
    expect(renderActiveTab).toHaveBeenCalled();
  });

  it('starts the runtime once when OAuth completion also broadcasts config-updated', async () => {
    await loadRenderer();
    mockElectronAPI.startHomeAssistantOAuth.mockImplementationOnce(async () => {
      const nextConfig = oauthConfig();
      triggerMockEvent('configUpdated', nextConfig);
      await Promise.resolve();
      return { success: true, config: nextConfig };
    });
    await reachAuthorizationStep('http://ha.local:8123');

    await clickButton('Connect');
    await flushAsync();

    expect(mockElectronAPI.startHomeAssistantOAuth).toHaveBeenCalled();
    expect(mockWebsocket.connect).toHaveBeenCalledTimes(1);
  });

  it('keeps onboarding open and shows the pairing error when authorization fails', async () => {
    await loadRenderer();
    mockElectronAPI.startHomeAssistantOAuth.mockRejectedValueOnce(
      new Error('authorization denied')
    );
    await reachAuthorizationStep('http://ha.local:8123');

    await clickButton('Connect');

    const wizard = document.getElementById('first-run-onboarding');
    const status = document.querySelector('.first-run-status');
    expect(wizard.classList).not.toContain('hidden');
    expect(status.dataset.status).toBe('error');
    expect(status.textContent).toContain('authorization denied');
    expect(mockUiUtils.showToast).toHaveBeenCalledWith(
      expect.stringContaining('authorization denied'),
      'error',
      6000
    );
    expect(mockWebsocket.connect).not.toHaveBeenCalled();
    expect(mockState.CONFIG.homeAssistant.token).toBe('YOUR_LONG_LIVED_ACCESS_TOKEN');
  });

  it('keeps the pairing message and busy button when stepping back mid-authorization', async () => {
    let releasePairing;
    await loadRenderer({
      configureApi(api) {
        api.startHomeAssistantOAuth.mockImplementationOnce(
          () =>
            new Promise((resolve) => {
              releasePairing = resolve;
            })
        );
      },
    });
    await reachAuthorizationStep('http://ha.local:8123');
    await clickButton('Connect');

    // Authorization runs for minutes in the browser. Leaving the step used to wipe the only
    // sign it was running, stranding a disabled button with nothing to explain it.
    await clickButton('Back');

    const status = document.querySelector('.first-run-status');
    expect(status.textContent).toContain('Opening Home Assistant for authorization');
    expect(status.dataset.status).toBe('pending');
    const next = Array.from(document.querySelectorAll('button')).find(
      (candidate) => candidate.textContent === 'Next'
    );
    expect(next.disabled).toBe(true);
    expect(next.getAttribute('aria-busy')).toBe('true');

    releasePairing?.({ success: true, config: oauthConfig() });
    await flushAsync();
  });

  it('cancels the pairing when the user steps back out of authorization', async () => {
    await loadRenderer({
      configureApi(api) {
        api.startHomeAssistantOAuth.mockImplementationOnce(() => new Promise(() => {}));
      },
    });
    await reachAuthorizationStep('http://ha.local:8123');
    await clickButton('Connect');

    await clickButton('Back');

    // Otherwise the loopback listener stays open and the next attempt is refused.
    expect(mockElectronAPI.cancelHomeAssistantOAuth).toHaveBeenCalled();
  });

  it('reports a cancelled pairing as cancelled rather than as a failure', async () => {
    let rejectPairing;
    await loadRenderer({
      configureApi(api) {
        api.startHomeAssistantOAuth.mockImplementationOnce(
          () =>
            new Promise((resolve, reject) => {
              rejectPairing = reject;
            })
        );
      },
    });
    await reachAuthorizationStep('http://ha.local:8123');
    await clickButton('Connect');

    await clickButton('Back');
    rejectPairing?.(new Error('Home Assistant authorization was cancelled'));
    await flushAsync();

    const status = document.querySelector('.first-run-status');
    expect(status.dataset.status).not.toBe('error');
    expect(mockUiUtils.showToast).not.toHaveBeenCalled();
  });

  it('recovers the Connect button when preparing the request throws', async () => {
    // normalizeBaseUrl used to run outside the try, so a throw there skipped the finally and
    // left the button disabled with the in-progress guard set -- every later click ignored
    // until the app restarted. It only throws for this sentinel so rendering stays unaffected,
    // and only on its second check: the first is the URL step's own validation.
    const actualConnection = jest.requireActual('../../src/connection.js');
    let sentinelChecks = 0;
    jest.doMock('../../src/connection.js', () => ({
      __esModule: true,
      ...actualConnection,
      normalizeBaseUrl: (value) => {
        if (value === 'http://boom.local' && ++sentinelChecks === 2) {
          throw new Error('exploded before dispatch');
        }
        return actualConnection.normalizeBaseUrl(value);
      },
    }));

    await loadRenderer();
    await reachAuthorizationStep('http://boom.local');

    await clickButton('Connect');

    const connect = Array.from(document.querySelectorAll('button')).find(
      (candidate) => candidate.textContent === 'Connect'
    );
    expect(connect.disabled).toBe(false);
    expect(mockElectronAPI.startHomeAssistantOAuth).not.toHaveBeenCalled();

    // And the guard no longer swallows the retry: clicking again reaches the main process.
    mockElectronAPI.startHomeAssistantOAuth.mockResolvedValueOnce({
      success: true,
      config: oauthConfig(),
    });
    await clickButton('Connect');
    expect(mockElectronAPI.startHomeAssistantOAuth).toHaveBeenCalledTimes(1);

    jest.dontMock('../../src/connection.js');
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

  it('publishes stale status until a fresh snapshot arrives, and preserves actionable auth failure', async () => {
    await loadRenderer({
      config: { ...oauthConfig(), desktopPins: { 'light.office': {} } },
      configureApi(api) {
        api.publishHaConnectionState = jest.fn().mockResolvedValue({ success: true });
      },
    });
    let requestId = 10;
    mockWebsocket.request.mockImplementation(() => {
      const request = new Promise(() => {});
      request.id = requestId++;
      return request;
    });
    mockWebsocket.emit('message', { type: 'auth_ok' });
    expect(mockElectronAPI.publishHaConnectionState).toHaveBeenLastCalledWith('connecting');
    expect(document.getElementById('widget-state-panel').textContent).toContain('Waiting for live');
    mockWebsocket.emit('message', { type: 'result', id: 10, success: true, result: [] });
    expect(mockElectronAPI.publishHaConnectionState).toHaveBeenLastCalledWith('connected');
    expect(mockElectronAPI.publishHaSnapshot).toHaveBeenCalled();
    expect(mockElectronAPI.publishHaSnapshot.mock.invocationCallOrder.at(-1)).toBeLessThan(
      mockElectronAPI.publishHaConnectionState.mock.invocationCallOrder.at(-1)
    );
    mockWebsocket.emit('message', { type: 'auth_invalid' });
    expect(mockWebsocket.close).toHaveBeenCalled();
    mockWebsocket.emit('close', { intentional: false });
    expect(mockElectronAPI.publishHaConnectionState).toHaveBeenLastCalledWith('auth-failed');
    expect(document.getElementById('widget-state-panel').textContent).toContain(
      'Authentication failed'
    );
    expect(document.getElementById('widget-state-panel').textContent).toContain('Open Settings');
  });

  it.each(['rejected', 'invalid'])('recovers when the initial snapshot is %s', async (failure) => {
    await loadRenderer({ config: oauthConfig() });
    const socket = {};
    mockWebsocket.ws = socket;
    mockWebsocket.failConnection = jest.fn();
    let failSnapshot;
    const snapshot = new Promise((resolve, reject) => {
      failSnapshot = () =>
        failure === 'rejected' ? reject(new Error('timeout')) : resolve({ success: false });
    });
    snapshot.id = 10;
    mockWebsocket.request.mockReturnValueOnce(snapshot);
    mockWebsocket.emit('message', { type: 'auth_ok' });
    failSnapshot();
    await flushAsync();
    expect(mockWebsocket.failConnection).toHaveBeenCalledWith(socket);
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
  it('explains the desktop layer and verifies a new popup activation during setup', async () => {
    const info = { hyprland: true, layerMode: true, lastActivation: null };
    await loadRenderer({
      configureApi(api) {
        api.getDesktopIntegration = jest.fn(async () => info);
      },
    });
    expect(document.getElementById('first-run-desktop-help').textContent).toContain(
      'underneath normal windows'
    );
    await clickButton('Check popup shortcut');
    expect(document.getElementById('first-run-desktop-help').textContent).toContain(
      'No popup shortcut received yet'
    );
    info.lastActivation = { id: 'popup-toggle', at: '2026-09-16T12:00:00Z' };
    await clickButton('Check popup shortcut');
    expect(document.getElementById('first-run-desktop-help').textContent).toContain(
      'Popup shortcut received.'
    );
    await clickButton('Next');
    expect(document.getElementById('first-run-desktop-help')).toBeNull();
  });
});

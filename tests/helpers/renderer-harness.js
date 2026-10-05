/**
 * Boots renderer.js in jsdom against a mocked websocket, state and electron bridge, for tests of
 * what the main window says and does (the connection panel, toasts, language changes).
 *
 * The mocks match the ones tests/unit/renderer-connection.test.js builds inline. A test file calls
 * `load()` per test and gets the mocks back to drive and inspect:
 *
 *   const harness = createRendererHarness();
 *   const { websocket, electronAPI } = await harness.load({ config });
 *   websocket.emit('error', new Error('...'));
 *
 * Call `harness.cleanup()` in afterEach. It also stops the renderer the test booted; see
 * createRendererLifetime.
 */
const EventEmitter = require('events');
const {
  createMockElectronAPI,
  resetMockElectronAPI,
  triggerMockEvent,
} = require('../mocks/electron.js');

const baseConfig = () => ({
  favoriteEntities: [],
  entityAlerts: { enabled: false, alerts: {} },
  globalHotkeys: { enabled: false, hotkeys: {} },
  ui: { theme: 'auto', enableInteractionDebugLogs: false },
});

const tokenConfig = (overrides = {}) => ({
  ...baseConfig(),
  homeAssistant: {
    url: 'http://ha.local:8123',
    token: 'legacy-token',
    authMethod: 'token',
    ...overrides,
  },
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

const flushAsync = async () => {
  for (let index = 0; index < 8; index += 1) {
    await Promise.resolve();
  }
  await new Promise((resolve) => setTimeout(resolve, 0));
};

// Every load() boots a fresh renderer.js into the same jsdom window, and a renderer has no way to
// be shut down. The timers and window/document listeners started while a test's renderer is loaded
// are recorded here so cleanup() can stop them. Left running, they act on the next test's page: a
// reconnect timer from one test's failed attempt fires during the next test and redraws its
// connection panel from the old renderer's config.
function createRendererLifetime() {
  let stops = [];

  // Replaces target[name] until stop(), putting back exactly what was there before.
  const replace = (target, name, makeReplacement) => {
    const original = target[name];
    if (typeof original !== 'function') return;
    const hadOwn = Object.prototype.hasOwnProperty.call(target, name);
    const replacement = makeReplacement(original);
    target[name] = replacement;
    stops.push(() => {
      if (target[name] !== replacement) return;
      if (hadOwn) target[name] = original;
      else delete target[name];
    });
  };

  // A one-shot timer forgets its id once it has run; a repeating one stays until stop().
  const trackTimer = (setName, clearName, { repeats = false } = {}) => {
    const clear = window[clearName];
    const pending = new Set();
    replace(
      window,
      setName,
      (set) =>
        function trackedTimer(callback, ...rest) {
          if (typeof callback !== 'function') return set.call(window, callback, ...rest);
          const id = set.call(
            window,
            (...args) => {
              if (!repeats) pending.delete(id);
              callback(...args);
            },
            ...rest
          );
          pending.add(id);
          return id;
        }
    );
    stops.push(() => {
      pending.forEach((id) => clear.call(window, id));
      pending.clear();
    });
  };

  const trackListeners = (target) => {
    const added = [];
    replace(
      target,
      'addEventListener',
      (add) =>
        function trackedAddEventListener(type, listener, options) {
          added.push({ type, listener, options });
          return add.call(this, type, listener, options);
        }
    );
    stops.push(() => {
      added.forEach(({ type, listener, options }) =>
        target.removeEventListener(type, listener, options)
      );
    });
  };

  return {
    start() {
      this.stop();
      trackTimer('setTimeout', 'clearTimeout');
      trackTimer('setInterval', 'clearInterval', { repeats: true });
      trackTimer('requestAnimationFrame', 'cancelAnimationFrame');
      trackListeners(window);
      trackListeners(document);
    },
    stop() {
      // Undone last-first, so a property replaced twice ends up as it was before start().
      const current = stops;
      stops = [];
      current.reverse().forEach((stop) => stop());
    },
  };
}

function createRendererHarness() {
  const lifetime = createRendererLifetime();
  const harness = {
    baseConfig,
    tokenConfig,
    oauthConfig,
    flushAsync,
    triggerMockEvent,
    panelText: () => document.getElementById('widget-state-panel')?.textContent || '',
    findButton: (label) =>
      Array.from(document.querySelectorAll('button')).find(
        (candidate) => candidate.textContent === label
      ),

    /**
     * @param {Object} [options]
     * @param {Object} [options.config] - What getConfig resolves with.
     * @param {Function} [options.configureApi] - Adjust the electron bridge before the renderer loads.
     * @param {Object} [options.messages] - Translations t() should answer with.
     * @param {Object} [options.ui] - Extra members for the mocked src/ui.js.
     * @param {Object} [options.uiUtils] - Extra members for the mocked src/ui-utils.js.
     * @param {string} [options.bodyHtml] - Extra markup in the document body.
     * @param {Object} [options.constants] - Values that replace the mocked src/constants.js ones.
     */
    async load({
      config = oauthConfig(),
      configureApi,
      messages = {},
      ui = {},
      uiUtils = {},
      bodyHtml = '',
      constants = {},
    } = {}) {
      lifetime.stop();
      jest.resetModules();
      resetMockElectronAPI();
      lifetime.start();
      document.body.innerHTML =
        '<main class="widget-content"><div id="quick-controls"></div></main>' +
        '<div id="settings-modal" class="hidden"><input id="ha-url" value="" /></div>' +
        '<div id="widget-state-live" role="status"></div>' +
        bodyHtml;
      document.body.className = '';
      window.history.replaceState({}, '', 'http://localhost/');

      const electronAPI = createMockElectronAPI();
      electronAPI.getConfig.mockResolvedValue(config);
      electronAPI.publishHaConnectionState = jest.fn().mockResolvedValue({ success: true });
      configureApi?.(electronAPI);
      window.electronAPI = electronAPI;

      const state = {
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
      websocket.connected = false;
      websocket.connect = jest.fn(() => {
        websocket.connected = false;
        websocket.ws = {};
      });
      websocket.isConnected = jest.fn(() => websocket.connected);
      websocket.request = jest.fn(() => ({ id: 1, catch: jest.fn() }));
      websocket.callService = jest.fn();
      websocket.close = jest.fn(() => {
        websocket.connected = false;
        websocket.ws = null;
      });
      websocket.ws = null;

      const log = {
        errorHandler: { startCatching: jest.fn() },
        transports: { console: {} },
        info: jest.fn(),
        debug: jest.fn(),
        warn: jest.fn(),
        error: jest.fn(),
      };
      jest.doMock('../../src/logger.js', () => ({ __esModule: true, default: log }));
      jest.doMock('../../src/state.js', () => ({ __esModule: true, default: state }));
      jest.doMock('../../src/websocket.js', () => ({ __esModule: true, default: websocket }));
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
      jest.doMock('../../src/alerts.js', () => ({
        __esModule: true,
        initializeEntityAlerts: jest.fn(),
        suspendEntityAlerts: jest.fn(),
        resetEntityAlerts: jest.fn(),
        checkEntityAlerts: jest.fn(),
        toggleAlerts: jest.fn(),
      }));
      jest.doMock('../../src/notifications.js', () => ({
        __esModule: true,
        initializePersistentNotifications: jest.fn(),
      }));
      const mockUi = {
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
        ...ui,
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
      const mockUiUtils = {
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
        copyTextToClipboard: jest.fn(async () => true),
        ...require('./ui-utils-dialogs').realDialogHelpers(),
        ...uiUtils,
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
          String(messages[key] ?? key).replace(/\{\{(\w+)\}\}/g, (_match, name) =>
            Object.prototype.hasOwnProperty.call(vars, name) ? String(vars[name]) : `{{${name}}}`
          )
        ),
        translateDocument: jest.fn(),
        formatTime: jest.fn(
          (date) => `${date.getHours()}:${String(date.getMinutes()).padStart(2, '0')}`
        ),
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
        ...constants,
      }));

      // The renderer tells main it is ready when init() is done; until then the panel, the toasts
      // and the status are still being drawn. If init() fails instead, the renderer logs why.
      // The bridge is wrapped, not given a new implementation, so whatever configureApi set up for
      // it still answers, a one-off answer included, and the call is still seen.
      const initDone = new Promise((resolve, reject) => {
        const signalReady = electronAPI.signalRendererReady;
        if (typeof signalReady === 'function') {
          electronAPI.signalRendererReady = jest.fn((...args) => {
            resolve();
            return signalReady(...args);
          });
        }
        log.error.mockImplementation((message, error) => {
          if (message === 'Error in DOMContentLoaded handler:') reject(error);
        });
      });

      require('../../renderer.js');
      window.dispatchEvent(new Event('DOMContentLoaded'));
      await initDone;
      await flushAsync();
      Object.assign(harness, {
        electronAPI,
        websocket,
        state,
        log,
        ui: mockUi,
        uiUtils: mockUiUtils,
      });
      return harness;
    },

    cleanup() {
      jest.useRealTimers();
      lifetime.stop();
      jest.resetModules();
      delete window.electronAPI;
      document.body.innerHTML = '';
    },
  };
  return harness;
}

module.exports = { createRendererHarness, tokenConfig, oauthConfig, baseConfig, flushAsync };

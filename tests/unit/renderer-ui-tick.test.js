/**
 * @jest-environment jsdom
 */

const EventEmitter = require('events');
const { createMockElectronAPI, resetMockElectronAPI } = require('../mocks/electron.js');

describe('Renderer UI tick scheduler', () => {
  let mockUi;
  let mockWebsocket;

  const flushPromises = async () => {
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  };

  const loadRenderer = async ({
    hidden = false,
    focused = false,
    tickTargets = {
      timeVisible: true,
      hasVisibleTimers: true,
      mediaEntity: { entity_id: 'media_player.office', state: 'playing' },
    },
  } = {}) => {
    jest.resetModules();
    resetMockElectronAPI();
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-07-06T12:00:00.000Z'));

    Object.defineProperty(document, 'hidden', {
      configurable: true,
      value: hidden,
    });
    Object.defineProperty(document, 'hasFocus', {
      configurable: true,
      value: jest.fn(() => focused),
    });

    document.body.innerHTML = '<main class="widget-content"></main>';
    window.history.replaceState({}, '', 'http://localhost/');
    window.electronAPI = createMockElectronAPI();

    const mockLogger = {
      errorHandler: { startCatching: jest.fn() },
      transports: { console: {} },
      info: jest.fn(),
      debug: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
    };

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
      showWeatherDetails: jest.fn(),
      updateTimeDisplay: jest.fn(),
      updateTimerDisplays: jest.fn(),
      updateMediaSeekBar: jest.fn(),
      refreshVisibleEntityCache: jest.fn(),
      executeHotkeyAction: jest.fn(),
      handleDesktopPinActionRequest: jest.fn(),
      callMediaTileService: jest.fn(),
      getTickTargets: jest.fn(() => tickTargets),
    };

    mockWebsocket = new EventEmitter();
    mockWebsocket.connect = jest.fn();
    mockWebsocket.request = jest.fn(() => ({ id: 1, catch: jest.fn() }));
    mockWebsocket.callService = jest.fn();
    mockWebsocket.close = jest.fn();
    mockWebsocket.ws = null;

    jest.doMock('../../src/logger.js', () => ({ __esModule: true, default: mockLogger }));
    jest.doMock('../../src/state.js', () => ({
      __esModule: true,
      default: {
        CONFIG: {},
        STATES: {},
        setConfig(nextConfig) {
          this.CONFIG = nextConfig;
        },
        setStates(nextStates) {
          this.STATES = nextStates;
        },
        setEntityState(entity) {
          this.STATES = {
            ...(this.STATES || {}),
            [entity.entity_id]: entity,
          };
        },
        setServices: jest.fn(),
        setAreas: jest.fn(),
        setUnitSystem: jest.fn(),
      },
    }));
    jest.doMock('../../src/websocket.js', () => ({ __esModule: true, default: mockWebsocket }));
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
    jest.doMock('../../src/ui.js', () => mockUi);
    jest.doMock('../../src/settings.js', () => ({
      __esModule: true,
      openSettings: jest.fn(),
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
    await flushPromises();
  };

  afterEach(() => {
    jest.clearAllTimers();
    jest.useRealTimers();
    jest.resetModules();
    delete window.electronAPI;
  });

  it('runs visible dashboard ticks when the window is visible but unfocused', async () => {
    await loadRenderer({ hidden: false, focused: false });

    expect(mockUi.updateTimeDisplay).toHaveBeenCalledTimes(1);
    expect(mockUi.updateTimerDisplays).toHaveBeenCalledTimes(1);
    expect(mockUi.updateMediaSeekBar).toHaveBeenCalledWith(expect.objectContaining({
      entity_id: 'media_player.office',
    }));

    jest.advanceTimersByTime(1000);

    expect(mockUi.updateTimeDisplay).toHaveBeenCalledTimes(2);
    expect(mockUi.updateTimerDisplays).toHaveBeenCalledTimes(2);
    expect(mockUi.updateMediaSeekBar).toHaveBeenCalledTimes(2);
  });

  it('uses minute cadence when only the clock needs ticking', async () => {
    await loadRenderer({
      hidden: false,
      focused: false,
      tickTargets: {
        timeVisible: true,
        hasVisibleTimers: false,
        mediaEntity: null,
      },
    });

    expect(mockUi.updateTimeDisplay).toHaveBeenCalledTimes(1);

    jest.advanceTimersByTime(1000);

    expect(mockUi.updateTimeDisplay).toHaveBeenCalledTimes(1);

    jest.advanceTimersByTime(59050);

    expect(mockUi.updateTimeDisplay).toHaveBeenCalledTimes(2);
    expect(mockUi.updateTimerDisplays).not.toHaveBeenCalled();
    expect(mockUi.updateMediaSeekBar).not.toHaveBeenCalled();
  });

  it('polls idle dashboards at a low frequency when nothing needs ticking', async () => {
    await loadRenderer({
      hidden: false,
      focused: false,
      tickTargets: {
        timeVisible: false,
        hasVisibleTimers: false,
        mediaEntity: null,
      },
    });

    expect(mockUi.getTickTargets).toHaveBeenCalledTimes(1);
    expect(mockUi.updateTimeDisplay).not.toHaveBeenCalled();
    expect(mockUi.updateTimerDisplays).not.toHaveBeenCalled();
    expect(mockUi.updateMediaSeekBar).not.toHaveBeenCalled();

    jest.advanceTimersByTime(1000);
    expect(mockUi.getTickTargets).toHaveBeenCalledTimes(1);

    jest.advanceTimersByTime(14000);
    expect(mockUi.getTickTargets).toHaveBeenCalledTimes(2);
  });

  it('still pauses dashboard ticks while the document is hidden', async () => {
    await loadRenderer({ hidden: true, focused: false });

    expect(mockUi.updateTimeDisplay).not.toHaveBeenCalled();
    expect(mockUi.updateTimerDisplays).not.toHaveBeenCalled();
    expect(mockUi.updateMediaSeekBar).not.toHaveBeenCalled();

    jest.advanceTimersByTime(1000);

    expect(mockUi.updateTimeDisplay).not.toHaveBeenCalled();
    expect(mockUi.updateTimerDisplays).not.toHaveBeenCalled();
    expect(mockUi.updateMediaSeekBar).not.toHaveBeenCalled();
  });
});

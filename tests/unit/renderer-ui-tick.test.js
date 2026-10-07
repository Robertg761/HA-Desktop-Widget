/**
 * @jest-environment jsdom
 */

const EventEmitter = require('events');
const { createMockElectronAPI, resetMockElectronAPI } = require('../mocks/electron.js');
const { createRendererLifetime, warmUpRenderer } = require('../helpers/renderer-harness');

describe('Renderer UI tick scheduler', () => {
  // Stops what each test's renderer started (its timers and window and document listeners), so it
  // does not act on the next test's page. See tests/helpers/renderer-harness.js.
  const lifetime = createRendererLifetime();
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
    lifetime.start();
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
      isolateLtr: jest.fn((text) => String(text ?? '')),
      formatNumber: jest.fn((value) => String(value)),
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
    await flushPromises();
  };

  const cleanup = () => {
    jest.clearAllTimers();
    jest.useRealTimers();
    lifetime.stop();
    jest.resetModules();
    delete window.electronAPI;
  };

  warmUpRenderer(loadRenderer, cleanup);
  afterEach(cleanup);

  it('runs visible dashboard ticks when the window is visible but unfocused', async () => {
    await loadRenderer({ hidden: false, focused: false });

    expect(mockUi.updateTimeDisplay).toHaveBeenCalledTimes(1);
    expect(mockUi.updateTimerDisplays).toHaveBeenCalledTimes(1);
    expect(mockUi.updateMediaSeekBar).toHaveBeenCalledWith(
      expect.objectContaining({
        entity_id: 'media_player.office',
      })
    );

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

  describe('when a live update changes whether a visible entity counts down', () => {
    const sensor = { entity_id: 'sensor.oven', state: 'idle', attributes: {} };
    // A live update, flushed (the next frame, or the 250 ms fallback) and handed to the tile code,
    // plus the zero-delay tick the renderer may have queued for it.
    const sensorUpdate = (attributes = {}, state = 'idle') => {
      mockWebsocket.emit('message', {
        type: 'event',
        event: {
          event_type: 'state_changed',
          data: {
            entity_id: sensor.entity_id,
            old_state: sensor,
            new_state: { ...sensor, state, attributes },
          },
        },
      });
      jest.advanceTimersByTime(300);
      expect(mockUi.updateEntityInUI).toHaveBeenCalledTimes(1);
    };

    // What ui.updateEntityInUI does for a visible entity: re-read whether any of them is a timer.
    const showsCountdown = (targets, hasVisibleTimers) => {
      mockUi.isEntityVisible.mockReturnValue(true);
      mockUi.updateEntityInUI.mockImplementation(() => {
        targets.hasVisibleTimers = hasVisibleTimers;
      });
    };

    it('ticks a sensor that gained a finish time at once, not at the idle poll', async () => {
      const targets = { timeVisible: false, hasVisibleTimers: false, mediaEntity: null };
      await loadRenderer({ hidden: false, focused: true, tickTargets: targets });
      showsCountdown(targets, true);
      expect(mockUi.updateTimerDisplays).not.toHaveBeenCalled();

      // Well inside the 15 s idle poll.
      sensorUpdate({ finishes_at: '2026-07-06T12:05:00.000Z' });

      expect(mockUi.updateTimerDisplays).toHaveBeenCalledTimes(1);
      jest.advanceTimersByTime(1000);
      expect(mockUi.updateTimerDisplays).toHaveBeenCalledTimes(2);
    });

    it('ticks a clock card out of its minute cadence when a visible sensor becomes a timer', async () => {
      const targets = { timeVisible: true, hasVisibleTimers: false, mediaEntity: null };
      await loadRenderer({ hidden: false, focused: true, tickTargets: targets });
      showsCountdown(targets, true);

      sensorUpdate({ end_time: '2026-07-06T12:05:00.000Z' });

      expect(mockUi.updateTimerDisplays).toHaveBeenCalledTimes(1);
    });

    it('looks at the tick again when the last visible countdown stops being one', async () => {
      const targets = { timeVisible: true, hasVisibleTimers: true, mediaEntity: null };
      await loadRenderer({ hidden: false, focused: true, tickTargets: targets });
      showsCountdown(targets, false);
      expect(mockUi.updateTimeDisplay).toHaveBeenCalledTimes(1);

      sensorUpdate({});

      // The extra tick reschedules at the clock's minute cadence instead of one second later.
      expect(mockUi.updateTimeDisplay).toHaveBeenCalledTimes(2);
      jest.advanceTimersByTime(5000);
      expect(mockUi.updateTimeDisplay).toHaveBeenCalledTimes(2);
    });

    it('leaves the tick alone for a change that is not about timers', async () => {
      const targets = { timeVisible: true, hasVisibleTimers: false, mediaEntity: null };
      await loadRenderer({ hidden: false, focused: true, tickTargets: targets });
      showsCountdown(targets, false);
      expect(mockUi.updateTimeDisplay).toHaveBeenCalledTimes(1);

      sensorUpdate({ unit_of_measurement: 'C' }, '180');

      expect(mockUi.updateTimeDisplay).toHaveBeenCalledTimes(1);
      expect(mockUi.updateTimerDisplays).not.toHaveBeenCalled();
    });
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

  // Every test boots its own renderer into the same window. One left running ticked its own
  // dashboard whenever the next test's page was shown again.
  it('stops the renderer of an earlier test, which no longer ticks when the page shows again', async () => {
    await loadRenderer({ hidden: false, focused: false });
    const earlierUi = mockUi;
    cleanup();

    await loadRenderer({ hidden: false, focused: false });
    earlierUi.getTickTargets.mockClear();
    mockUi.getTickTargets.mockClear();
    document.dispatchEvent(new Event('visibilitychange'));

    expect(earlierUi.getTickTargets).not.toHaveBeenCalled();
    expect(mockUi.getTickTargets).toHaveBeenCalled();
  });
});

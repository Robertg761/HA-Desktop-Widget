/**
 * @jest-environment jsdom
 */

const EventEmitter = require('events');
const { createMockElectronAPI, resetMockElectronAPI } = require('../mocks/electron.js');

describe('Renderer desktop pin waiting escape hatch', () => {
  let mockElectronAPI;
  let mockLogger;
  let mockUi;
  let mockUiUtils;
  let mockWebsocket;

  const flushAsync = async () => {
    await Promise.resolve();
    await new Promise((resolve) => setTimeout(resolve, 0));
  };

  const setDesktopPinDom = () => {
    document.body.innerHTML = `
      <div id="desktop-pin-content"></div>
      <div id="desktop-pin-empty" class="hidden">
        <div id="desktop-pin-empty-kicker"></div>
        <div id="desktop-pin-empty-title"></div>
        <div id="desktop-pin-empty-copy"></div>
      <div id="desktop-pin-empty-actions" class="hidden">
          <button id="desktop-pin-focus-btn" type="button">Focus Main</button>
        </div>
      </div>
    `;
  };

  const createUiMock = () => ({
    initUpdateUI: jest.fn(),
    renderActiveTab: jest.fn(() => {
      document.body.dataset.renderedMode = 'main';
      document.getElementById('desktop-pin-empty-actions')?.classList.add('hidden');
      const focusBtn = document.getElementById('desktop-pin-focus-btn');
      if (focusBtn) focusBtn.disabled = true;
    }),
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
    startTimeTicker: jest.fn(),
    stopTimeTicker: jest.fn(),
    updateTimerDisplays: jest.fn(),
    getTickTargets: jest.fn(() => ({ hasVisibleTimers: false })),
    refreshVisibleEntityCache: jest.fn(),
    executeHotkeyAction: jest.fn(),
    handleDesktopPinActionRequest: jest.fn(),
    updateMediaSeekBar: jest.fn(),
    callMediaTileService: jest.fn(),
    renderDesktopPinnedTile: jest.fn((_entityId, entity, options = {}) => {
      document.body.dataset.renderedMode = 'desktop-pin';
      const emptyState = document.getElementById('desktop-pin-empty');
      const title = document.getElementById('desktop-pin-empty-title');
      const copy = document.getElementById('desktop-pin-empty-copy');
      const focusActions = document.getElementById('desktop-pin-empty-actions');
      const focusBtn = document.getElementById('desktop-pin-focus-btn');
      const hasConnectionIssue = !!options.connectionIssue;
      const normalizedState = typeof entity?.state === 'string' ? entity.state.trim().toLowerCase() : '';
      const entityDomain = typeof entity?.entity_id === 'string'
        ? entity.entity_id.split('.')[0]
        : (typeof _entityId === 'string' ? _entityId.split('.')[0] : '');
      const showWaitingState = !entity && !hasConnectionIssue;
      const showMissingState = !entity && !!options.hasSnapshot && !hasConnectionIssue;
      const showUnavailableState = !!entity && (
        normalizedState === 'unavailable'
        || (normalizedState === 'unknown' && entityDomain !== 'scene' && entityDomain !== 'script')
      );
      const showFallbackState = hasConnectionIssue || showWaitingState || showUnavailableState;

      if (emptyState) {
        emptyState.classList.toggle('hidden', !showFallbackState);
        emptyState.dataset.state = hasConnectionIssue
          ? 'disconnected'
          : (showUnavailableState ? 'unavailable' : (showMissingState ? 'missing' : (showWaitingState ? 'waiting' : 'ready')));
      }
      if (title) {
        title.textContent = hasConnectionIssue
          ? 'Home Assistant unavailable'
          : (showUnavailableState
              ? 'Bedroom Light is unavailable'
              : (showMissingState ? 'Pinned entity not found' : (showWaitingState ? 'Waiting for first live update' : 'Ready')));
      }
      if (copy) {
        copy.textContent = hasConnectionIssue
          ? options.connectionIssue
          : (showUnavailableState
              ? 'Latest Home Assistant data reports this entity as unavailable right now.'
              : (showMissingState
                  ? 'This tile could not find its entity in the latest Home Assistant data. It may have been renamed, removed, or is no longer exposed.'
                  : (showWaitingState ? 'Waiting for live Home Assistant data...' : 'Live data available.')));
      }
      if (focusActions) {
        focusActions.classList.toggle('hidden', !showFallbackState);
      }
      if (focusBtn) {
        focusBtn.disabled = !showFallbackState;
      }
    }),
  });

  const loadRenderer = async ({ bootstrapOverrides = {} } = {}) => {
    jest.resetModules();
    setDesktopPinDom();

    resetMockElectronAPI();
    mockElectronAPI = createMockElectronAPI();
    mockElectronAPI.getDesktopPinBootstrap.mockResolvedValue({
      config: {
        homeAssistant: {
          url: 'http://homeassistant.local:8123',
          token: 'mock_long_lived_access_token',
        },
      },
      entity: null,
      hasSnapshot: false,
      ...bootstrapOverrides,
    });
    window.electronAPI = mockElectronAPI;

    mockLogger = {
      errorHandler: { startCatching: jest.fn() },
      transports: { console: {} },
      info: jest.fn(),
      debug: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
    };
    mockUi = createUiMock();
    mockUiUtils = {
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
    jest.doMock('../../src/hotkeys.js', () => ({ __esModule: true, renderHotkeysTab: jest.fn() }));
    jest.doMock('../../src/alerts.js', () => ({
      __esModule: true,
      checkEntityAlerts: jest.fn(),
      initializeEntityAlerts: jest.fn(),
    }));
    jest.doMock('../../src/ui.js', () => mockUi);
    jest.doMock('../../src/settings.js', () => ({
      __esModule: true,
      openSettings: jest.fn(),
    }));
    jest.doMock('../../src/ui-utils.js', () => mockUiUtils);
    jest.doMock('../../src/utils.js', () => ({
      __esModule: true,
      reconcileConfigEntityIds: jest.fn((config) => ({ changed: false, config })),
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

    window.history.replaceState({}, '', 'http://localhost/?mode=desktop-pin&entityId=light.bedroom');
    require('../../renderer.js');
    window.dispatchEvent(new Event('DOMContentLoaded'));
    await flushAsync();
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('keeps Focus Main visible and wired during a cold desktop-pin start', async () => {
    await loadRenderer();

    const focusActions = document.getElementById('desktop-pin-empty-actions');
    const focusBtn = document.getElementById('desktop-pin-focus-btn');

    expect(mockUi.renderDesktopPinnedTile).toHaveBeenCalledWith('light.bedroom', null, {
      hasSnapshot: false,
      connectionIssue: '',
    });
    expect(document.body.dataset.renderedMode).toBe('desktop-pin');
    expect(focusActions?.classList.contains('hidden')).toBe(false);
    expect(focusBtn?.disabled).toBe(false);

    focusBtn.click();

    expect(mockElectronAPI.requestDesktopPinAction).toHaveBeenCalledWith('light.bedroom', 'focus-main');
  });

  it('hides Focus Main once live entity data is available', async () => {
    await loadRenderer({
      bootstrapOverrides: {
        entity: {
          entity_id: 'light.bedroom',
          state: 'on',
          attributes: {
            friendly_name: 'Bedroom Light',
          },
        },
        hasSnapshot: true,
      },
    });

    const emptyState = document.getElementById('desktop-pin-empty');
    const focusActions = document.getElementById('desktop-pin-empty-actions');
    const focusBtn = document.getElementById('desktop-pin-focus-btn');

    expect(document.body.dataset.renderedMode).toBe('desktop-pin');
    expect(emptyState?.classList.contains('hidden')).toBe(true);
    expect(focusActions?.classList.contains('hidden')).toBe(true);
    expect(focusBtn?.disabled).toBe(true);
  });

  it('shows the missing-entity fallback after a snapshot no longer includes the pin target', async () => {
    await loadRenderer({
      bootstrapOverrides: {
        entity: null,
        hasSnapshot: true,
      },
    });

    const emptyState = document.getElementById('desktop-pin-empty');
    const title = document.getElementById('desktop-pin-empty-title');
    const copy = document.getElementById('desktop-pin-empty-copy');
    const focusActions = document.getElementById('desktop-pin-empty-actions');
    const focusBtn = document.getElementById('desktop-pin-focus-btn');

    expect(emptyState?.dataset.state).toBe('missing');
    expect(title?.textContent).toBe('Pinned entity not found');
    expect(copy?.textContent).toBe('This tile could not find its entity in the latest Home Assistant data. It may have been renamed, removed, or is no longer exposed.');
    expect(focusActions?.classList.contains('hidden')).toBe(false);
    expect(focusBtn?.disabled).toBe(false);

    focusBtn.click();

    expect(mockElectronAPI.requestDesktopPinAction).toHaveBeenCalledWith('light.bedroom', 'focus-main');
  });

  it('keeps unavailable entities on the fallback surface with Focus Main available', async () => {
    await loadRenderer({
      bootstrapOverrides: {
        entity: {
          entity_id: 'light.bedroom',
          state: 'unavailable',
          attributes: {
            friendly_name: 'Bedroom Light',
          },
        },
        hasSnapshot: true,
      },
    });

    const emptyState = document.getElementById('desktop-pin-empty');
    const title = document.getElementById('desktop-pin-empty-title');
    const copy = document.getElementById('desktop-pin-empty-copy');
    const focusActions = document.getElementById('desktop-pin-empty-actions');
    const focusBtn = document.getElementById('desktop-pin-focus-btn');

    expect(emptyState?.dataset.state).toBe('unavailable');
    expect(title?.textContent).toBe('Bedroom Light is unavailable');
    expect(copy?.textContent).toBe('Latest Home Assistant data reports this entity as unavailable right now.');
    expect(focusActions?.classList.contains('hidden')).toBe(false);
    expect(focusBtn?.disabled).toBe(false);
  });

  it('shows a disconnected fallback after a cold-start connection failure', async () => {
    await loadRenderer();

    mockWebsocket.emit('error', new Error('Could not establish WebSocket connection'));
    await flushAsync();

    const focusActions = document.getElementById('desktop-pin-empty-actions');
    const focusBtn = document.getElementById('desktop-pin-focus-btn');
    const emptyState = document.getElementById('desktop-pin-empty');
    const copy = document.getElementById('desktop-pin-empty-copy');

    expect(mockUi.renderDesktopPinnedTile).toHaveBeenCalledTimes(2);
    expect(mockUi.renderActiveTab).not.toHaveBeenCalled();
    expect(document.body.dataset.renderedMode).toBe('desktop-pin');
    expect(emptyState?.dataset.state).toBe('disconnected');
    expect(copy?.textContent).toBe('Unable to reach Home Assistant. Check your network or Home Assistant URL.');
    expect(focusActions?.classList.contains('hidden')).toBe(false);
    expect(focusBtn?.disabled).toBe(false);

    focusBtn.click();

    expect(mockElectronAPI.requestDesktopPinAction).toHaveBeenCalledWith('light.bedroom', 'focus-main');
  });

  it('replaces cached live controls with the disconnected fallback after a connection failure', async () => {
    await loadRenderer({
      bootstrapOverrides: {
        entity: {
          entity_id: 'light.bedroom',
          state: 'on',
          attributes: {
            friendly_name: 'Bedroom Light',
          },
        },
        hasSnapshot: true,
      },
    });

    mockWebsocket.emit('error', new Error('Could not establish WebSocket connection'));
    await flushAsync();

    const emptyState = document.getElementById('desktop-pin-empty');
    const title = document.getElementById('desktop-pin-empty-title');
    const copy = document.getElementById('desktop-pin-empty-copy');
    const focusActions = document.getElementById('desktop-pin-empty-actions');
    const focusBtn = document.getElementById('desktop-pin-focus-btn');

    expect(mockUi.renderDesktopPinnedTile).toHaveBeenLastCalledWith('light.bedroom', expect.objectContaining({
      entity_id: 'light.bedroom',
    }), {
      hasSnapshot: true,
      connectionIssue: 'Unable to reach Home Assistant. Check your network or Home Assistant URL.',
    });
    expect(emptyState?.dataset.state).toBe('disconnected');
    expect(title?.textContent).toBe('Home Assistant unavailable');
    expect(copy?.textContent).toBe('Unable to reach Home Assistant. Check your network or Home Assistant URL.');
    expect(focusActions?.classList.contains('hidden')).toBe(false);
    expect(focusBtn?.disabled).toBe(false);
  });
});

/**
 * @jest-environment jsdom
 */

const EventEmitter = require('events');
const { createMockElectronAPI, resetMockElectronAPI } = require('../mocks/electron.js');

describe('Renderer stale favorite state handling', () => {
  const STALE_PRESERVE_MS = 15 * 60 * 1000;
  const favoriteEntity = {
    entity_id: 'light.favorite',
    state: 'on',
    attributes: { friendly_name: 'Favorite Light' },
  };
  const otherEntity = {
    entity_id: 'sensor.present',
    state: '72',
    attributes: { friendly_name: 'Present Sensor' },
  };

  let mockElectronAPI;
  let mockState;
  let mockWebsocket;
  let requestLog;
  let now;
  let dateNowSpy;

  const flushPromises = async () => {
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  };

  const createConfig = () => ({
    homeAssistant: {
      url: 'http://homeassistant.local:8123',
      token: 'valid-token',
    },
    favoriteEntities: [favoriteEntity.entity_id],
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

  const loadRenderer = async () => {
    jest.resetModules();
    resetMockElectronAPI();
    jest.useFakeTimers();

    now = 1_700_000_000_000;
    dateNowSpy = jest.spyOn(Date, 'now').mockImplementation(() => now);

    document.body.innerHTML = '<main class="widget-content"></main>';
    window.history.replaceState({}, '', 'http://localhost/');

    mockElectronAPI = createMockElectronAPI();
    mockElectronAPI.getConfig.mockResolvedValue(createConfig());
    window.electronAPI = mockElectronAPI;

    mockState = {
      CONFIG: {},
      STATES: {},
      setConfig(nextConfig) {
        this.CONFIG = nextConfig;
      },
      setStates: jest.fn(function setStates(nextStates) {
        this.STATES = nextStates;
      }),
      setEntityState(entity) {
        this.STATES = {
          ...(this.STATES || {}),
          [entity.entity_id]: entity,
        };
      },
      setServices: jest.fn(),
      setAreas: jest.fn(),
      setUnitSystem: jest.fn(),
    };

    requestLog = [];
    let requestId = 0;
    mockWebsocket = new EventEmitter();
    mockWebsocket.connect = jest.fn();
    mockWebsocket.request = jest.fn((payload) => {
      const request = {
        id: ++requestId,
        catch: jest.fn(),
      };
      requestLog.push({ payload, request });
      return request;
    });
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
    await flushPromises();
  };

  const latestRequestId = (type) => {
    for (let index = requestLog.length - 1; index >= 0; index -= 1) {
      if (requestLog[index].payload.type === type) {
        return requestLog[index].request.id;
      }
    }
    throw new Error(`No ${type} request found`);
  };

  const receiveStates = (entities) => {
    mockWebsocket.emit('message', { type: 'auth_ok' });
    mockWebsocket.emit('message', {
      id: latestRequestId('get_states'),
      type: 'result',
      success: true,
      result: entities,
    });
  };

  afterEach(() => {
    jest.clearAllTimers();
    jest.useRealTimers();
    dateNowSpy?.mockRestore();
    jest.resetModules();
    delete window.electronAPI;
  });

  it('preserves a missing favorite during the stale grace window', async () => {
    await loadRenderer();

    receiveStates([favoriteEntity, otherEntity]);
    now += 60 * 1000;
    receiveStates([otherEntity]);

    expect(mockState.STATES).toEqual({
      [favoriteEntity.entity_id]: favoriteEntity,
      [otherEntity.entity_id]: otherEntity,
    });
    expect(mockElectronAPI.publishHaSnapshot).toHaveBeenLastCalledWith(
      expect.objectContaining({
        [favoriteEntity.entity_id]: favoriteEntity,
      })
    );
  });

  it('drops a missing favorite after the stale grace window expires', async () => {
    await loadRenderer();

    receiveStates([favoriteEntity, otherEntity]);
    now += 60 * 1000;
    receiveStates([otherEntity]);
    now += STALE_PRESERVE_MS + 1;
    receiveStates([otherEntity]);

    expect(mockState.STATES).toEqual({
      [otherEntity.entity_id]: otherEntity,
    });
    expect(mockElectronAPI.publishHaSnapshot).toHaveBeenLastCalledWith({
      [otherEntity.entity_id]: otherEntity,
    });
  });

  it('resets stale tracking when Home Assistant returns the favorite again', async () => {
    await loadRenderer();

    receiveStates([favoriteEntity, otherEntity]);
    now += 60 * 1000;
    receiveStates([otherEntity]);
    now += STALE_PRESERVE_MS + 1;
    receiveStates([favoriteEntity, otherEntity]);
    now += 60 * 1000;
    receiveStates([otherEntity]);

    expect(mockState.STATES).toEqual({
      [favoriteEntity.entity_id]: favoriteEntity,
      [otherEntity.entity_id]: otherEntity,
    });
  });
});

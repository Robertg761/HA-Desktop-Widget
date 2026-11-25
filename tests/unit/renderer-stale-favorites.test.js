/**
 * @jest-environment jsdom
 */

const EventEmitter = require('events');
const {
  createMockElectronAPI,
  resetMockElectronAPI,
  triggerMockEvent,
} = require('../mocks/electron.js');
const { createRendererLifetime, warmUpRenderer } = require('../helpers/renderer-harness');

describe('Renderer stale favorite state handling', () => {
  // Stops what each test's renderer started (its timers and window and document listeners), so it
  // does not act on the next test's page. See tests/helpers/renderer-harness.js.
  const lifetime = createRendererLifetime();
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
  let mockAlerts;
  let mockUi;
  let mockUtils;
  let mockLog;
  let requestLog;
  let now;
  let dateNowSpy;

  const flushPromises = async () => {
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  };

  const createConfig = (overrides = {}) => ({
    homeAssistant: {
      url: 'http://homeassistant.local:8123',
      token: 'valid-token',
    },
    favoriteEntities: [favoriteEntity.entity_id],
    // Publishing entity state to the main process only happens for desktop pin windows,
    // so the baseline config pins an entity to keep the publish pipeline active.
    desktopPins: {
      [favoriteEntity.entity_id]: { x: 24, y: 24, width: 220, height: 140 },
    },
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
    ...overrides,
  });

  const loadRenderer = async (config = createConfig()) => {
    jest.resetModules();
    lifetime.start();
    resetMockElectronAPI();
    jest.useFakeTimers();

    now = 1_700_000_000_000;
    dateNowSpy = jest.spyOn(Date, 'now').mockImplementation(() => now);

    document.body.innerHTML = '<main class="widget-content"></main>';
    window.history.replaceState({}, '', 'http://localhost/');

    mockElectronAPI = createMockElectronAPI();
    mockElectronAPI.getConfig.mockResolvedValue(config);
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
      deleteEntityState(entityId) {
        if (!Object.prototype.hasOwnProperty.call(this.STATES, entityId)) return false;
        delete this.STATES[entityId];
        return true;
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
      // Mirrors WebSocketManager.request(): a promise carrying the request id that resolves with
      // the `result` message — including `success: false` answers, which never reject.
      const id = ++requestId;
      let settle;
      const request = new Promise((resolve) => {
        settle = resolve;
      });
      request.id = id;
      requestLog.push({ payload, request, resolveWith: (result) => settle({ id, ...result }) });
      return request;
    });
    mockWebsocket.callService = jest.fn();
    mockWebsocket.close = jest.fn();
    mockWebsocket.ws = null;

    mockLog = {
      errorHandler: { startCatching: jest.fn() },
      transports: { console: {} },
      info: jest.fn(),
      debug: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
    };
    jest.doMock('../../src/logger.js', () => ({
      __esModule: true,
      default: mockLog,
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
    mockAlerts = {
      __esModule: true,
      initializeEntityAlerts: jest.fn(),
      checkEntityAlerts: jest.fn(),
    };
    jest.doMock('../../src/alerts.js', () => mockAlerts);
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
    };
    jest.doMock('../../src/ui.js', () => mockUi);
    jest.doMock('../../src/settings.js', () => ({
      __esModule: true,
      openSettings: jest.fn(),
      closeSettings: jest.fn(),
      saveSettings: jest.fn(),
      renderAlertsListInline: jest.fn(),
    }));
    jest.doMock('../../src/dialogs.js', () => ({ __esModule: true, showToast: jest.fn() }));
    jest.doMock('../../src/ui-utils.js', () => ({
      __esModule: true,
      showLoading: jest.fn(),
      setStatus: jest.fn(),
      initializeConnectionStatusTooltip: jest.fn(),
      applyTheme: jest.fn(),
      setCustomThemes: jest.fn(),
      applyAccentTheme: jest.fn(),
      applyBackgroundTheme: jest.fn(),
      applyUiPreferences: jest.fn(),
      applyWindowEffects: jest.fn(),
    }));
    mockUtils = {
      __esModule: true,
      reconcileConfigEntityIds: jest.fn((config) => ({ changed: false, config })),
      resolveEntityId: jest.fn((entityId) => entityId),
    };
    jest.doMock('../../src/utils.js', () => mockUtils);
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

  const cleanup = () => {
    jest.clearAllTimers();
    jest.useRealTimers();
    dateNowSpy?.mockRestore();
    lifetime.stop();
    jest.resetModules();
    delete window.electronAPI;
  };

  warmUpRenderer(() => loadRenderer(), cleanup);
  afterEach(cleanup);

  // When a kept favorite is marked unavailable is the session's (tests/unit/ha-session.test.js);
  // what the widget does with that mark is wired here.
  describe('a favorite kept through a reconnect that Home Assistant does not report', () => {
    it('reaches the pins as unavailable but not the alert rules, since Home Assistant never reported an outage', async () => {
      await loadRenderer();
      receiveStates([favoriteEntity, otherEntity]);
      now += 60 * 1000;
      receiveStates([otherEntity]);
      mockElectronAPI.publishHaEntityUpdate.mockClear();
      mockAlerts.checkEntityAlerts.mockClear();

      await jest.advanceTimersByTimeAsync(61 * 1000);
      expect(mockState.STATES[favoriteEntity.entity_id].state).toBe('unavailable');
      expect(mockElectronAPI.publishHaEntityUpdate).toHaveBeenCalledWith(
        expect.objectContaining({ entity_id: favoriteEntity.entity_id, state: 'unavailable' })
      );
      expect(mockAlerts.checkEntityAlerts).not.toHaveBeenCalled();

      // What Home Assistant reports after that is news again, whatever it is.
      mockWebsocket.emit('message', {
        type: 'event',
        event: {
          event_type: 'state_changed',
          data: {
            entity_id: favoriteEntity.entity_id,
            new_state: { ...favoriteEntity, state: 'off' },
          },
        },
      });
      await jest.advanceTimersByTimeAsync(20);
      expect(mockAlerts.checkEntityAlerts).toHaveBeenCalledWith(favoriteEntity.entity_id, 'off');
    });
  });

  it('removes a deleted favorite immediately and republishes an authoritative snapshot', async () => {
    await loadRenderer();
    receiveStates([favoriteEntity, otherEntity]);
    mockElectronAPI.publishHaSnapshot.mockClear();
    mockElectronAPI.publishHaEntityUpdate.mockClear();
    mockUi.renderActiveTab.mockClear();
    mockUi.isEntityVisible.mockImplementation((id) => id === favoriteEntity.entity_id);

    mockWebsocket.emit('message', {
      type: 'event',
      event: {
        event_type: 'state_changed',
        data: {
          entity_id: favoriteEntity.entity_id,
          old_state: favoriteEntity,
          new_state: null,
        },
      },
    });
    await jest.advanceTimersByTimeAsync(20);

    expect(mockState.STATES).toEqual({
      [otherEntity.entity_id]: otherEntity,
    });
    expect(mockElectronAPI.publishHaEntityUpdate).not.toHaveBeenCalled();
    // The favorite is the pinned entity, so main's cache loses it and holds nothing else.
    expect(mockElectronAPI.publishHaSnapshot).toHaveBeenCalledWith({});
    expect(mockUi.renderActiveTab).toHaveBeenCalled();
  });

  it('does not publish entity state to main while no desktop pins are configured', async () => {
    await loadRenderer(createConfig({ desktopPins: {} }));

    receiveStates([favoriteEntity, otherEntity]);
    expect(mockElectronAPI.publishHaSnapshot).not.toHaveBeenCalled();

    mockWebsocket.emit('message', {
      type: 'event',
      event: {
        event_type: 'state_changed',
        data: {
          entity_id: otherEntity.entity_id,
          old_state: otherEntity,
          new_state: { ...otherEntity, state: '73' },
        },
      },
    });
    await jest.advanceTimersByTimeAsync(20);

    expect(mockElectronAPI.publishHaEntityUpdate).not.toHaveBeenCalled();

    mockWebsocket.emit('message', {
      type: 'event',
      event: {
        event_type: 'state_changed',
        data: {
          entity_id: favoriteEntity.entity_id,
          old_state: favoriteEntity,
          new_state: null,
        },
      },
    });
    await jest.advanceTimersByTimeAsync(20);

    expect(mockElectronAPI.publishHaSnapshot).not.toHaveBeenCalled();
  });

  it('publishes a full snapshot when the first desktop pin arrives through a config update', async () => {
    await loadRenderer(createConfig({ desktopPins: {} }));
    receiveStates([favoriteEntity, otherEntity]);
    expect(mockElectronAPI.publishHaSnapshot).not.toHaveBeenCalled();

    triggerMockEvent('configUpdated', createConfig());
    await flushPromises();

    expect(mockElectronAPI.publishHaSnapshot).toHaveBeenCalledWith({
      [favoriteEntity.entity_id]: favoriteEntity,
    });

    mockWebsocket.emit('message', {
      type: 'event',
      event: {
        event_type: 'state_changed',
        data: {
          entity_id: favoriteEntity.entity_id,
          old_state: favoriteEntity,
          new_state: { ...favoriteEntity, state: 'off' },
        },
      },
    });
    await jest.advanceTimersByTimeAsync(20);

    expect(mockElectronAPI.publishHaEntityUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ entity_id: favoriteEntity.entity_id, state: 'off' })
    );
  });

  it('stops publishing entity state after the last desktop pin is removed', async () => {
    await loadRenderer();
    receiveStates([favoriteEntity, otherEntity]);
    expect(mockElectronAPI.publishHaSnapshot).toHaveBeenCalled();

    triggerMockEvent('configUpdated', createConfig({ desktopPins: {} }));
    await flushPromises();
    mockElectronAPI.publishHaSnapshot.mockClear();
    mockElectronAPI.publishHaEntityUpdate.mockClear();

    mockWebsocket.emit('message', {
      type: 'event',
      event: {
        event_type: 'state_changed',
        data: {
          entity_id: otherEntity.entity_id,
          old_state: otherEntity,
          new_state: { ...otherEntity, state: '73' },
        },
      },
    });
    await jest.advanceTimersByTimeAsync(20);

    expect(mockElectronAPI.publishHaEntityUpdate).not.toHaveBeenCalled();
    expect(mockElectronAPI.publishHaSnapshot).not.toHaveBeenCalled();
  });

  it('republishes a snapshot when main reports a pin booted against an empty cache', async () => {
    await loadRenderer();
    receiveStates([favoriteEntity, otherEntity]);
    // Settle the get_states publish first: a request arriving while it is still in
    // flight is deliberately answered by that in-flight publish instead of a new one.
    await flushPromises();
    mockElectronAPI.publishHaSnapshot.mockClear();

    // An unpin-then-repin whose config broadcasts coalesced in the preload echo buffer
    // never shows this renderer an empty-pin config, so only the main-process request
    // can trigger the republish.
    triggerMockEvent('desktopPinSnapshotNeeded');
    await flushPromises();

    expect(mockElectronAPI.publishHaSnapshot).toHaveBeenCalledWith({
      [favoriteEntity.entity_id]: favoriteEntity,
    });
  });

  it('coalesces snapshot requests onto a publish already in flight', async () => {
    await loadRenderer();
    receiveStates([favoriteEntity, otherEntity]);
    // Several pin windows bootstrapping in one burst each make main request a
    // snapshot; while the get_states publish is unresolved they must all ride on it.
    triggerMockEvent('desktopPinSnapshotNeeded');
    triggerMockEvent('desktopPinSnapshotNeeded');
    await flushPromises();

    expect(mockElectronAPI.publishHaSnapshot).toHaveBeenCalledTimes(1);
  });

  it('re-publishes when a coalesced request joined a publish that main discarded', async () => {
    await loadRenderer();
    // Main discards a publish that raced the last unpin; a request that joined that
    // in-flight publish still owes main a snapshot.
    mockElectronAPI.publishHaSnapshot.mockImplementationOnce(() =>
      Promise.resolve({ success: true, count: 0, discarded: true })
    );
    receiveStates([favoriteEntity, otherEntity]);
    triggerMockEvent('desktopPinSnapshotNeeded');
    // The join-verify-republish chain is deeper than one flush (catch + finally +
    // joiner hops before the retry even starts).
    await flushPromises();
    await flushPromises();

    expect(mockElectronAPI.publishHaSnapshot).toHaveBeenCalledTimes(2);
    expect(mockElectronAPI.publishHaSnapshot).toHaveBeenLastCalledWith({
      [favoriteEntity.entity_id]: favoriteEntity,
    });
  });

  const stateChanged = (entity, newState) => ({
    type: 'event',
    event: {
      event_type: 'state_changed',
      data: { entity_id: entity.entity_id, old_state: entity, new_state: newState },
    },
  });

  describe('what main is sent for the desktop pins', () => {
    it('is the pinned entities only, however many entities change', async () => {
      await loadRenderer();
      receiveStates([favoriteEntity, otherEntity]);
      await flushPromises();
      mockElectronAPI.publishHaEntityUpdate.mockClear();

      mockWebsocket.emit('message', stateChanged(otherEntity, { ...otherEntity, state: '73' }));
      mockWebsocket.emit(
        'message',
        stateChanged(favoriteEntity, { ...favoriteEntity, state: 'off' })
      );
      await jest.advanceTimersByTimeAsync(20);

      expect(mockElectronAPI.publishHaEntityUpdate).toHaveBeenCalledTimes(1);
      expect(mockElectronAPI.publishHaEntityUpdate).toHaveBeenCalledWith(
        expect.objectContaining({ entity_id: favoriteEntity.entity_id, state: 'off' })
      );
    });

    it('includes a pin added next to one that was already published', async () => {
      await loadRenderer();
      receiveStates([favoriteEntity, otherEntity]);
      await flushPromises();
      mockElectronAPI.publishHaSnapshot.mockClear();

      triggerMockEvent(
        'configUpdated',
        createConfig({
          desktopPins: {
            [favoriteEntity.entity_id]: { x: 24, y: 24, width: 220, height: 140 },
            [otherEntity.entity_id]: { x: 300, y: 24, width: 220, height: 140 },
          },
        })
      );
      await flushPromises();

      expect(mockElectronAPI.publishHaSnapshot).toHaveBeenCalledTimes(1);
      expect(mockElectronAPI.publishHaSnapshot).toHaveBeenCalledWith({
        [favoriteEntity.entity_id]: favoriteEntity,
        [otherEntity.entity_id]: otherEntity,
      });
    });

    it('is not asked for again when a config echo changes no pin', async () => {
      await loadRenderer();
      receiveStates([favoriteEntity, otherEntity]);
      await flushPromises();
      mockElectronAPI.publishHaSnapshot.mockClear();

      triggerMockEvent('configUpdated', createConfig());
      await flushPromises();

      expect(mockElectronAPI.publishHaSnapshot).not.toHaveBeenCalled();
    });

    it('keeps a removed entity that was not pinned out of main and out of the redraw', async () => {
      await loadRenderer();
      receiveStates([favoriteEntity, otherEntity]);
      await flushPromises();
      mockElectronAPI.publishHaSnapshot.mockClear();
      mockUi.renderActiveTab.mockClear();

      mockWebsocket.emit('message', stateChanged(otherEntity, null));
      await jest.advanceTimersByTimeAsync(20);

      expect(mockState.STATES).toEqual({ [favoriteEntity.entity_id]: favoriteEntity });
      expect(mockElectronAPI.publishHaSnapshot).not.toHaveBeenCalled();
      // Nothing on the page showed it, so there is nothing to redraw.
      expect(mockUi.renderActiveTab).not.toHaveBeenCalled();
    });

    it('redraws once for a burst of removals that include one on the page', async () => {
      await loadRenderer();
      receiveStates([favoriteEntity, otherEntity]);
      await flushPromises();
      mockUi.renderActiveTab.mockClear();
      mockUi.isEntityVisible.mockImplementation((id) => id === otherEntity.entity_id);

      mockWebsocket.emit('message', stateChanged(otherEntity, null));
      mockWebsocket.emit('message', stateChanged(favoriteEntity, null));
      await jest.advanceTimersByTimeAsync(20);

      expect(mockUi.renderActiveTab).toHaveBeenCalledTimes(1);
    });
  });

  it('ignores a snapshot request before entity states have arrived', async () => {
    await loadRenderer();

    triggerMockEvent('desktopPinSnapshotNeeded');
    await flushPromises();

    expect(mockElectronAPI.publishHaSnapshot).not.toHaveBeenCalled();
  });

  it('ignores a snapshot request when no desktop pins are configured', async () => {
    await loadRenderer(createConfig({ desktopPins: {} }));
    receiveStates([favoriteEntity, otherEntity]);

    triggerMockEvent('desktopPinSnapshotNeeded');
    await flushPromises();

    expect(mockElectronAPI.publishHaSnapshot).not.toHaveBeenCalled();
  });

  it('reinitializes entity alerts when a running renderer receives updated config', async () => {
    await loadRenderer();
    mockAlerts.initializeEntityAlerts.mockClear();
    const nextConfig = {
      ...createConfig(),
      entityAlerts: {
        enabled: true,
        alerts: {
          'sensor.present': { condition: 'above', value: 75 },
        },
      },
    };

    triggerMockEvent('configUpdated', nextConfig);
    await flushPromises();

    expect(mockState.CONFIG.entityAlerts).toEqual(nextConfig.entityAlerts);
    expect(mockAlerts.initializeEntityAlerts).toHaveBeenCalledTimes(1);
  });

  it('persists exact entity-registry rename mappings', async () => {
    await loadRenderer();
    const renamedConfig = {
      ...createConfig(),
      favoriteEntities: ['light.favorite_renamed'],
    };
    mockElectronAPI.replaceConfigEntityId.mockResolvedValueOnce({
      success: true,
      changed: true,
      config: renamedConfig,
    });

    mockWebsocket.emit('message', {
      type: 'event',
      event: {
        event_type: 'entity_registry_updated',
        data: {
          action: 'update',
          old_entity_id: 'light.favorite',
          entity_id: 'light.favorite_renamed',
          changes: { entity_id: 'light.favorite' },
        },
      },
    });
    await flushPromises();

    expect(mockElectronAPI.replaceConfigEntityId).toHaveBeenCalledWith(
      'light.favorite',
      'light.favorite_renamed'
    );
    expect(mockState.CONFIG.favoriteEntities).toEqual(['light.favorite_renamed']);
    expect(mockUi.renderActiveTab).toHaveBeenCalled();
  });
});

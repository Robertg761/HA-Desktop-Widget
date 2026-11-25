import log from './logger.js';
import state from './state.js';
import { WS_INITIAL_STATES_TIMEOUT_MS } from './constants.js';

// WebSocket.OPEN. Read as a number: the session runs without a DOM in tests, and the panel
// preview's virtual socket reports the same value.
const SOCKET_OPEN = 1;
// How long a favorite that a reconnect left out of get_states is kept at all.
const FAVORITE_STALE_ENTITY_PRESERVE_MS = 15 * 60 * 1000;
// How long a favorite that a reconnect left out of get_states keeps showing its last state as if
// it were live. After this it shows as unavailable until Home Assistant reports it again.
const FAVORITE_STALE_LIVE_MS = 60 * 1000;
// First snapshots in a row that ran out of time. Each one gives the next twice as long (up to
// four times the first wait): a server that answers the login but needs longer than that to send
// every entity would otherwise be asked again, from the start, forever.
const MAX_SNAPSHOT_TIMEOUT_GROWTH = 4;
const STATE_CHANGED_HIDDEN_FLUSH_DELAY_MS = 50;
// A frame callback is skipped while the window is hidden, minimised or covered, and the window can
// go hidden after the callback was requested; this timer is what flushes then.
const STATE_CHANGED_FRAME_FALLBACK_MS = 250;

/**
 * The renderer's Home Assistant session: everything the widget says to Home Assistant over the
 * transport, and what it makes of the answers.
 *
 * It logs in when the socket opens; after the login it subscribes to state changes, then asks for
 * the snapshot of states, the services, the areas and Home Assistant's config, and matches each
 * answer to its request. State changes older than the snapshot on its way are dropped. A favorite
 * that a reconnect's snapshot leaves out keeps its last state for a while, and shows as
 * unavailable when Home Assistant has still not reported it a minute later. Everything it learns
 * is written to the state store (src/state.js) as it arrives.
 *
 * Every entity change then reaches the rest of the renderer through one feed, `subscribe()`,
 * batched to one delivery per frame. A frame callback never runs for a hidden window, so a timer
 * stands in for it: the feed keeps flowing while the window sits in the tray.
 *
 * @param {Object} options
 * @param {Object} options.transport - The socket to Home Assistant: src/websocket.js, or the panel
 *   preview's virtual one. The session listens to its `open` and `message` events and uses its
 *   `ws`, `request()` and `failConnection()`; connecting, closing and reconnecting stay with the
 *   caller.
 * @param {Function} [options.debug] - Called with (event, details) for the interaction debug log.
 */
export function createHaSession({ transport, debug = () => {} }) {
  const lifecycleListeners = new Map();
  const batchedListeners = new Set();
  const immediateListeners = new Set();
  const pendingChanges = new Map();
  // Favorites kept through a reconnect that left them out, by entity id.
  const keptFavorites = new Map();
  let keptFavoriteTimerId = null;
  let pendingFrameId = null;
  let pendingTimerId = null;
  let snapshotTimeoutsInARow = 0;
  // True from a login until that connection's get_states result arrives. State changes received in
  // between happened before Home Assistant took the snapshot, which already includes them.
  let awaitingStatesSnapshot = false;
  let getStatesId;
  let getServicesId;
  let getAreasId;
  let getConfigId;

  // A lifecycle listener's failure is the session's failure: it stops the handling of that message,
  // as it did when these reactions were written inline.
  function emit(event, payload) {
    Array.from(lifecycleListeners.get(event) || []).forEach((listener) => listener(payload));
  }

  // --- the change feed ---

  function cancelScheduledFlush() {
    if (pendingFrameId != null) {
      globalThis.cancelAnimationFrame?.(pendingFrameId);
      pendingFrameId = null;
    }
    if (pendingTimerId != null) {
      clearTimeout(pendingTimerId);
      pendingTimerId = null;
    }
  }

  function flushChanges() {
    cancelScheduledFlush();
    const changes = Array.from(pendingChanges.values());
    pendingChanges.clear();
    // One consumer that throws does not keep the rest from hearing the batch.
    Array.from(batchedListeners).forEach((listener) => {
      try {
        listener(changes);
      } catch (error) {
        log.error('Error handling Home Assistant state changes:', error);
      }
    });
  }

  // Chromium does not run animation frames for a window that is hidden or covered. A frame
  // requested just before the window went to the tray never fires, and with only that frame to
  // wait for, the flush stayed "pending" and every later change waited on it: alerts, pins and the
  // Omarchy bar stopped until the window was shown. A timer is armed beside the frame, and
  // whichever runs first cancels the other.
  function scheduleFlush() {
    if (pendingFrameId != null || pendingTimerId != null) return;
    const canUseFrame =
      typeof globalThis.requestAnimationFrame === 'function' && !globalThis.document?.hidden;
    if (canUseFrame) {
      pendingFrameId = globalThis.requestAnimationFrame(flushChanges);
    }
    pendingTimerId = setTimeout(
      flushChanges,
      canUseFrame ? STATE_CHANGED_FRAME_FALLBACK_MS : STATE_CHANGED_HIDDEN_FLUSH_DELAY_MS
    );
  }

  function applyChange(entityId, entity, local) {
    if (entity) {
      state.setEntityState(entity);
    } else {
      state.deleteEntityState(entityId);
    }
    // Home Assistant has spoken for it, so a reconnect that leaves it out again starts a new
    // omission with a fresh grace. The check below only looks a minute after a reconnect, which a
    // connection that keeps dropping never reaches, and the 15 minutes would run on from the first
    // omission.
    if (!local) keptFavorites.delete(entityId);
    const change = { entityId, entity, local };
    Array.from(immediateListeners).forEach((listener) => {
      try {
        listener([change]);
      } catch (error) {
        log.error('Error handling a Home Assistant state change:', error);
      }
    });
    pendingChanges.set(entityId, change);
    scheduleFlush();
  }

  function receiveEntityState(entity, { local = false } = {}) {
    if (!entity?.entity_id) return;
    applyChange(entity.entity_id, entity, local);
  }

  function receiveEntityRemoval(entityId) {
    const normalizedEntityId = typeof entityId === 'string' ? entityId.trim() : '';
    if (!normalizedEntityId) return;
    applyChange(normalizedEntityId, null, false);
  }

  // --- favorites kept through a reconnect ---

  // A favorite that is kept through a reconnect shows its last state, so that a Home Assistant
  // restart does not flash every tile to Unavailable while its integration loads. One that Home
  // Assistant has still not reported a minute later was probably removed or renamed while this
  // computer was offline, and a tile that says "On, 50%" for it is wrong. It becomes unavailable,
  // through the feed like any state change, so tiles, pins and the tray agree. It is marked
  // `local`: Home Assistant never reported an outage, and a State Change alert that tells about
  // devices going unavailable would otherwise announce every entity that was deleted while the
  // app was away.
  function scheduleKeptFavoriteCheck() {
    clearTimeout(keptFavoriteTimerId);
    keptFavoriteTimerId = null;
    if (!keptFavorites.size) return;
    keptFavoriteTimerId = setTimeout(markKeptFavoritesUnavailable, FAVORITE_STALE_LIVE_MS);
  }

  function markKeptFavoritesUnavailable() {
    keptFavoriteTimerId = null;
    keptFavorites.forEach((record, entityId) => {
      const entity = state.STATES?.[entityId];
      // Any change since the reconnect replaced the object: Home Assistant has spoken for it, so
      // there is nothing left to track.
      if (!entity || entity !== record.entity) {
        keptFavorites.delete(entityId);
        return;
      }
      if (entity.state === 'unavailable') return;
      record.entity = { ...entity, state: 'unavailable' };
      receiveEntityState(record.entity, { local: true });
    });
  }

  function reconcileKeptFavorites(newStates) {
    const oldStates = state.STATES || {};
    const favoriteEntityIds = [
      ...new Set(
        Array.isArray(state.CONFIG?.favoriteEntities)
          ? state.CONFIG.favoriteEntities.filter(
              (entityId) => typeof entityId === 'string' && entityId
            )
          : []
      ),
    ];
    const favoriteEntityIdSet = new Set(favoriteEntityIds);

    Array.from(keptFavorites.keys()).forEach((entityId) => {
      if (!favoriteEntityIdSet.has(entityId) || newStates[entityId] || !oldStates[entityId]) {
        keptFavorites.delete(entityId);
      }
    });

    const preservedFavorites = {};
    const droppedStaleFavorites = [];
    const now = Date.now();

    favoriteEntityIds.forEach((entityId) => {
      if (newStates[entityId] || !oldStates[entityId]) {
        keptFavorites.delete(entityId);
        return;
      }

      const previousRecord = keptFavorites.get(entityId);
      const missingSince = previousRecord?.missingSince || now;
      const staleAgeMs = Math.max(0, now - missingSince);

      if (staleAgeMs <= FAVORITE_STALE_ENTITY_PRESERVE_MS) {
        preservedFavorites[entityId] = oldStates[entityId];
        keptFavorites.set(entityId, {
          missingSince,
          lastPreservedAt: now,
          entity: oldStates[entityId],
        });
        return;
      }

      droppedStaleFavorites.push(entityId);
      keptFavorites.delete(entityId);
    });

    scheduleKeptFavoriteCheck();

    return {
      favoriteCount: favoriteEntityIds.length,
      preservedFavorites,
      droppedStaleFavorites,
    };
  }

  // --- the protocol ---

  function logIn() {
    const socket = transport.ws;
    if (!socket || socket.readyState !== SOCKET_OPEN) return;
    socket.send(JSON.stringify({ type: 'auth', access_token: state.CONFIG.homeAssistant.token }));
  }

  function bootstrap() {
    // Subscribe before asking for the snapshot. Home Assistant answers each message in turn, so
    // asking for the states first left a gap between the two in which a change was neither in
    // the snapshot nor sent as an event, and its tile kept the old state until the next change.
    // Every reconnect (each wake from sleep) opened that gap.
    awaitingStatesSnapshot = true;
    transport.request({ type: 'subscribe_events', event_type: 'state_changed' }).catch((error) => {
      log.warn('State change subscription request failed:', error);
    });
    // The first snapshot is the one request that can legitimately take a long time. Giving up
    // at the usual 15 s tore the socket down and asked Home Assistant to serialise every entity
    // again, so a large instance never finished loading.
    const statesReq = transport.request(
      { type: 'get_states' },
      {
        timeoutMs:
          WS_INITIAL_STATES_TIMEOUT_MS *
          Math.min(2 ** snapshotTimeoutsInARow, MAX_SNAPSHOT_TIMEOUT_GROWTH),
      }
    );
    const servicesReq = transport.request({ type: 'get_services' });
    const areasReq = transport.request({ type: 'config/area_registry/list' });
    const configReq = transport.request({ type: 'get_config' });

    getStatesId = statesReq.id;
    getServicesId = servicesReq.id;
    getAreasId = areasReq.id;
    getConfigId = configReq.id;

    log.debug(`Sent get_config request with ID: ${getConfigId}`);
    debug('ws.auth_ok', { getStatesId, getServicesId, getAreasId, getConfigId });

    // Prevent unhandled rejections from surfacing as global errors
    const snapshotSocket = transport.ws;
    statesReq
      .then((response) => {
        if (!response.success || !Array.isArray(response.result)) {
          transport.failConnection(snapshotSocket);
        }
      })
      .catch((error) => {
        // Home Assistant answered the login, so it is running and the address is right; it is
        // the states that are slow. The close says so in its own words, not as a server that is
        // down.
        if (error?.code !== 'timeout') {
          transport.failConnection(snapshotSocket);
          return;
        }
        snapshotTimeoutsInARow += 1;
        transport.failConnection(snapshotSocket, 'snapshot-timeout');
      });
    servicesReq.catch(() => {});
    areasReq.catch(() => {});
    configReq.catch((err) => {
      log.error('get_config request failed:', err);
    });
    transport
      .request({ type: 'subscribe_events', event_type: 'entity_registry_updated' })
      .then((response) => {
        // Home Assistant answers an unauthorized subscription with a `success: false` result
        // rather than dropping the connection, so the failure arrives here and not in catch().
        // Home Assistant limits this event to administrators. Non-admin users can repair
        // an unavailable Quick Access tile through the explicit replacement picker.
        if (response?.success === false) {
          log.info(
            'Automatic entity rename tracking is unavailable for this account:',
            response.error || response
          );
        }
      })
      .catch((error) => {
        log.info('Automatic entity rename tracking is unavailable for this account:', error);
      });
  }

  function receiveSnapshot(entities) {
    const newStates = {};
    log.debug(`Successfully fetched ${entities.length} entities from Home Assistant`);
    entities.forEach((entity) => {
      newStates[entity.entity_id] = entity;
    });

    const { favoriteCount, preservedFavorites, droppedStaleFavorites } =
      reconcileKeptFavorites(newStates);

    const mergedStates = { ...newStates, ...preservedFavorites };
    log.debug(
      `State update: ${Object.keys(newStates).length} from HA + ${Object.keys(preservedFavorites).length} preserved favorites - ${droppedStaleFavorites.length} stale favorites = ${Object.keys(mergedStates).length} total`
    );
    debug('ws.get_states.received', {
      fetchedEntities: Object.keys(newStates).length,
      preservedFavorites: Object.keys(preservedFavorites),
      droppedStaleFavorites,
      mergedTotal: Object.keys(mergedStates).length,
      favoriteCount,
    });
    state.setStates(mergedStates);
    snapshotTimeoutsInARow = 0;
    emit('snapshot', { entityIds: Object.keys(newStates) });
  }

  function receiveHomeAssistantConfig(result) {
    log.debug('Received config from Home Assistant:', JSON.stringify(result, null, 2));
    const previousTimeZone = state.TIME_ZONE;
    state.setTimeZone(result?.time_zone);
    const unitSystem = result?.unit_system || null;
    if (unitSystem) {
      log.debug('Unit system found:', JSON.stringify(unitSystem, null, 2));
      state.setUnitSystem(unitSystem);
    } else {
      log.warn('No unit_system found in config response');
    }
    emit('ha-config', { timeZoneChanged: state.TIME_ZONE !== previousTimeZone, unitSystem });
  }

  function receiveResult(msg) {
    log.debug(`Received result for message ID: ${msg.id}`);
    if (!msg.result) {
      log.debug(`Result message with no result data: ${msg.id}`);
      return;
    }
    if (msg.id === getStatesId) {
      awaitingStatesSnapshot = false;
      if (Array.isArray(msg.result)) receiveSnapshot(msg.result);
    } else if (msg.id === getServicesId) {
      state.setServices(msg.result);
    } else if (msg.id === getAreasId) {
      if (Array.isArray(msg.result)) {
        const newAreas = {};
        msg.result.forEach((area) => {
          newAreas[area.area_id] = area;
        });
        state.setAreas(newAreas);
      }
    } else if (msg.id === getConfigId) {
      receiveHomeAssistantConfig(msg.result);
    } else {
      log.debug(`Unhandled result message ID: ${msg.id}`);
    }
  }

  function receiveEntityRegistryUpdate(data) {
    // A renamed entity's omission from a snapshot is explained; it is not a favorite to keep.
    const oldEntityId = typeof data?.old_entity_id === 'string' ? data.old_entity_id.trim() : '';
    if (data?.action === 'update' && oldEntityId && oldEntityId !== data.entity_id) {
      keptFavorites.delete(oldEntityId);
    }
    emit('entity-registry-updated', data);
  }

  transport.on('open', () => {
    try {
      log.debug('WebSocket connection opened');
      logIn();
    } catch (error) {
      log.error('Error handling WebSocket open:', error);
    }
  });

  transport.on('message', (msg) => {
    try {
      if (msg.type === 'auth_ok') {
        log.debug('WebSocket authentication successful');
        emit('authenticated');
        bootstrap();
      } else if (msg.type === 'auth_invalid') {
        emit('auth-rejected');
      } else if (msg.type === 'event' && msg.event?.event_type === 'entity_registry_updated') {
        receiveEntityRegistryUpdate(msg.event.data);
      } else if (msg.type === 'event' && msg.event?.event_type === 'state_changed') {
        // Older than the snapshot on its way: queued, it would be drawn over the newer state.
        if (awaitingStatesSnapshot) return;
        const entity = msg.event.data?.new_state;
        if (entity) {
          receiveEntityState(entity);
        } else {
          receiveEntityRemoval(msg.event.data?.entity_id || msg.event.data?.old_state?.entity_id);
        }
      } else if (msg.type === 'result') {
        receiveResult(msg);
      }
    } catch (error) {
      log.error('[WS] Error handling message:', error);
    }
  });

  return {
    /**
     * The change feed. The listener is called with a list of `{ entityId, entity, local }`: the
     * entity's new state, or `null` when Home Assistant removed it, and `local` when the widget
     * derived the state itself rather than heard it from Home Assistant (a kept favorite marked
     * unavailable). The store already holds every change in the list.
     *
     * Changes are batched: one call per frame, at most one entry per entity (its latest change, in
     * the order the entities first changed), and listeners are called in the order they
     * subscribed. While the window is hidden the batch follows within 50 ms instead of waiting for
     * a frame that never comes. A listener that throws is logged and the others still hear it.
     *
     * With `immediate`, the listener hears each change on its own as it is applied, before the
     * batch, for a consumer that must not wait on the renderer's timers at all. A full snapshot is
     * not a change; it is announced by the `snapshot` event.
     *
     * @param {Function} listener
     * @param {Object} [options]
     * @param {boolean} [options.immediate]
     * @returns {Function} Stops the listener.
     */
    subscribe(listener, { immediate = false } = {}) {
      const listeners = immediate ? immediateListeners : batchedListeners;
      listeners.add(listener);
      return () => listeners.delete(listener);
    },

    /**
     * Lifecycle events, each after the store holds what it reports:
     * - `authenticated`: Home Assistant accepted the login; the snapshot has not been asked for.
     * - `auth-rejected`: Home Assistant rejected the access token.
     * - `snapshot` ({ entityIds }): a connection's states arrived and replaced the store's;
     *   `entityIds` are the entities Home Assistant sent, without the favorites kept for it.
     * - `ha-config` ({ timeZoneChanged, unitSystem }): Home Assistant's config arrived.
     * - `entity-registry-updated` (data): an entity registry event, as Home Assistant sent it.
     *
     * @param {string} event
     * @param {Function} listener
     * @returns {Function} Stops the listener.
     */
    on(event, listener) {
      if (!lifecycleListeners.has(event)) lifecycleListeners.set(event, new Set());
      lifecycleListeners.get(event).add(listener);
      return () => lifecycleListeners.get(event)?.delete(listener);
    },

    /**
     * Applies a state from a stand-in for Home Assistant (the development climate demo) as if
     * Home Assistant had reported it: the store, then the feed.
     *
     * @param {Object} entity
     */
    receiveEntityState(entity) {
      receiveEntityState(entity);
    },
  };
}

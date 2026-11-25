/**
 * @jest-environment node
 */

// The Home Assistant session, driven through a fake transport with no DOM: what it says to Home
// Assistant, what it writes to the state store, and what its change feed and events report.

const EventEmitter = require('events');

const FAVORITE = 'light.favorite';
const favoriteEntity = { entity_id: FAVORITE, state: 'on', attributes: {} };
const otherEntity = { entity_id: 'sensor.present', state: '72', attributes: {} };
const STALE_PRESERVE_MS = 15 * 60 * 1000;

// Stands in for src/websocket.js: an open socket, and requests that resolve when the test answers
// them the way Home Assistant does (a result message, then the request's promise).
function createFakeTransport() {
  const transport = new EventEmitter();
  transport.sent = [];
  transport.ws = { readyState: 1, send: (raw) => transport.sent.push(JSON.parse(raw)) };
  transport.requests = [];
  let nextId = 1;
  transport.request = jest.fn((payload, options) => {
    const id = nextId++;
    const request = { id, payload, options };
    const promise = new Promise((resolve, reject) => {
      Object.assign(request, { resolve, reject });
    });
    promise.id = id;
    transport.requests.push(request);
    return promise;
  });
  transport.failConnection = jest.fn();
  transport.latest = (type) => transport.requests.filter((r) => r.payload.type === type).at(-1);
  transport.answer = (type, result, { success = true } = {}) => {
    const request = transport.latest(type);
    const message = { id: request.id, type: 'result', success, result };
    transport.emit('message', message);
    request.resolve(message);
  };
  transport.event = (event) => transport.emit('message', { type: 'event', event });
  transport.stateChanged = (entityId, newState, oldState) =>
    transport.event({
      event_type: 'state_changed',
      data: { entity_id: entityId, new_state: newState, old_state: oldState },
    });
  transport.logIn = () => transport.emit('message', { type: 'auth_ok' });
  transport.connect = (entities) => {
    transport.logIn();
    transport.answer('get_states', entities);
  };
  return transport;
}

const settle = async () => {
  for (let index = 0; index < 5; index += 1) await Promise.resolve();
};

describe('Home Assistant session', () => {
  let state;
  let log;
  let debug;
  let transport;
  let session;
  let batches;

  const start = () => {
    session = require('../../src/ha-session.js').createHaSession({ transport, debug });
    batches = [];
    session.subscribe((changes) => batches.push(changes));
    return session;
  };

  beforeEach(() => {
    jest.resetModules();
    jest.useFakeTimers({ now: 1_700_000_000_000 });
    log = { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() };
    jest.doMock('../../src/logger.js', () => ({ __esModule: true, default: log }));
    state = require('../../src/state.js').default;
    state.setConfig({
      homeAssistant: { url: 'http://ha.local:8123', token: 'token-1' },
      favoriteEntities: [FAVORITE],
    });
    debug = jest.fn();
    transport = createFakeTransport();
  });

  afterEach(() => {
    jest.useRealTimers();
    delete globalThis.requestAnimationFrame;
    delete globalThis.cancelAnimationFrame;
    delete globalThis.document;
  });

  describe('logging in', () => {
    it('sends the saved access token when the socket opens', () => {
      start();
      transport.emit('open');
      expect(transport.sent).toEqual([{ type: 'auth', access_token: 'token-1' }]);
    });

    it('sends nothing on a socket that is not open', () => {
      start();
      transport.ws.readyState = 0;
      transport.emit('open');
      expect(transport.sent).toEqual([]);
    });

    it('announces an accepted login before asking for anything', () => {
      start();
      const requestsAtLogin = [];
      session.on('authenticated', () => requestsAtLogin.push(transport.request.mock.calls.length));
      transport.logIn();
      expect(requestsAtLogin).toEqual([0]);
    });

    it('announces a rejected token', () => {
      start();
      const rejected = jest.fn();
      session.on('auth-rejected', rejected);
      transport.emit('message', { type: 'auth_invalid' });
      expect(rejected).toHaveBeenCalledTimes(1);
      expect(transport.request).not.toHaveBeenCalled();
    });
  });

  describe('after the login', () => {
    it('subscribes to state changes before asking for the snapshot, so none falls between the two', () => {
      start();
      transport.logIn();
      expect(transport.requests.map(({ payload }) => payload)).toEqual([
        { type: 'subscribe_events', event_type: 'state_changed' },
        { type: 'get_states' },
        { type: 'get_services' },
        { type: 'config/area_registry/list' },
        { type: 'get_config' },
        { type: 'subscribe_events', event_type: 'entity_registry_updated' },
      ]);
      expect(debug).toHaveBeenCalledWith(
        'ws.auth_ok',
        expect.objectContaining({ getStatesId: transport.latest('get_states').id })
      );
    });

    it('gives the snapshot far longer than a usual request, so a large instance is not torn down', () => {
      start();
      transport.logIn();
      expect(transport.latest('get_states').options).toEqual({ timeoutMs: 90000 });
      transport.requests
        .filter(({ payload }) => payload.type !== 'get_states')
        .forEach(({ options }) => expect(options).toBeUndefined());
    });

    it('stores the services, the areas by id, and Home Assistant time zone and units', () => {
      start();
      const configs = [];
      session.on('ha-config', (config) => configs.push(config));
      transport.logIn();
      transport.answer('get_services', { light: { turn_on: {} } });
      transport.answer('config/area_registry/list', [{ area_id: 'kitchen', name: 'Kitchen' }]);
      const units = { temperature: '°F', wind_speed: 'mph' };
      transport.answer('get_config', { time_zone: 'America/Halifax', unit_system: units });

      expect(state.SERVICES).toEqual({ light: { turn_on: {} } });
      expect(state.AREAS).toEqual({ kitchen: { area_id: 'kitchen', name: 'Kitchen' } });
      expect(state.TIME_ZONE).toBe('America/Halifax');
      expect(state.UNIT_SYSTEM).toEqual(units);
      expect(configs).toEqual([{ timeZoneChanged: true, unitSystem: units }]);

      // The next connection's config, in the same zone and with no unit system.
      transport.logIn();
      transport.answer('get_config', { time_zone: 'America/Halifax' });
      expect(configs[1]).toEqual({ timeZoneChanged: false, unitSystem: null });
      expect(state.UNIT_SYSTEM).toEqual(units);
    });

    it('takes an answer to an earlier connection for no answer at all', () => {
      start();
      const snapshots = jest.fn();
      session.on('snapshot', snapshots);
      transport.logIn();
      const earlier = transport.latest('get_states');
      transport.logIn();

      transport.emit('message', {
        id: earlier.id,
        type: 'result',
        success: true,
        result: [otherEntity],
      });

      expect(snapshots).not.toHaveBeenCalled();
      expect(state.STATES).toEqual({});
    });

    it('says when Home Assistant does not let this account follow entity renames', async () => {
      start();
      transport.logIn();
      transport.latest('subscribe_events').resolve({
        type: 'result',
        success: false,
        error: { code: 'unauthorized', message: 'Unauthorized' },
      });
      await settle();

      expect(log.info).toHaveBeenCalledWith(
        'Automatic entity rename tracking is unavailable for this account:',
        expect.objectContaining({ code: 'unauthorized' })
      );
    });

    it('passes entity registry updates on as Home Assistant sent them', () => {
      start();
      const updates = jest.fn();
      session.on('entity-registry-updated', updates);
      const data = { action: 'update', old_entity_id: 'light.a', entity_id: 'light.b' };
      transport.event({ event_type: 'entity_registry_updated', data });
      expect(updates).toHaveBeenCalledWith(data);
    });
  });

  describe('the snapshot', () => {
    it('replaces the store and announces which entities Home Assistant sent', () => {
      start();
      const snapshots = jest.fn();
      session.on('snapshot', snapshots);
      transport.connect([favoriteEntity, otherEntity]);

      expect(state.STATES).toEqual({
        [FAVORITE]: favoriteEntity,
        [otherEntity.entity_id]: otherEntity,
      });
      expect(snapshots).toHaveBeenCalledWith({ entityIds: [FAVORITE, otherEntity.entity_id] });
      // A snapshot is announced, not fed through as changes.
      jest.advanceTimersByTime(1000);
      expect(batches).toEqual([]);
    });

    it('wins over a change that arrived before it, which it already includes', () => {
      start();
      transport.logIn();
      transport.stateChanged('light.desk', { entity_id: 'light.desk', state: 'off' });
      transport.answer('get_states', [{ entity_id: 'light.desk', state: 'on' }]);
      jest.advanceTimersByTime(1000);

      expect(state.STATES['light.desk'].state).toBe('on');
      expect(batches).toEqual([]);

      // A change after the snapshot is newer than it.
      transport.stateChanged('light.desk', { entity_id: 'light.desk', state: 'off' });
      expect(state.STATES['light.desk'].state).toBe('off');
    });

    it('fails the connection when Home Assistant answers without states', async () => {
      start();
      transport.logIn();
      const socket = transport.ws;
      transport.answer('get_states', null, { success: false });
      await settle();
      expect(transport.failConnection).toHaveBeenCalledWith(socket);
    });

    it('waits twice as long after each timeout, up to four times the first wait, until the states arrive', async () => {
      start();
      for (let attempt = 0; attempt < 4; attempt += 1) {
        transport.logIn();
        transport
          .latest('get_states')
          .reject(Object.assign(new Error('WebSocket request timeout'), { code: 'timeout' }));
        await settle();
      }
      const timeouts = () =>
        transport.requests
          .filter(({ payload }) => payload.type === 'get_states')
          .map(({ options }) => options.timeoutMs);

      expect(timeouts()).toEqual([90000, 180000, 360000, 360000]);
      expect(transport.failConnection).toHaveBeenCalledTimes(4);
      // Said as slow states, not as a server that is down.
      expect(transport.failConnection).toHaveBeenLastCalledWith(transport.ws, 'snapshot-timeout');

      transport.connect([otherEntity]);
      transport.logIn();
      expect(timeouts().at(-1)).toBe(90000);
    });

    it('fails a connection whose snapshot request fails for another reason as an outage', async () => {
      start();
      transport.logIn();
      transport.latest('get_states').reject(new Error('WebSocket connection closed'));
      await settle();
      expect(transport.failConnection).toHaveBeenCalledWith(transport.ws);
    });
  });

  describe('the change feed', () => {
    it('applies each change to the store at once and delivers one batch, latest change per entity', () => {
      start();
      transport.connect([favoriteEntity, otherEntity]);
      const off = { ...favoriteEntity, state: 'off' };
      const on = { ...favoriteEntity, state: 'on', attributes: { brightness: 9 } };
      const warmer = { ...otherEntity, state: '73' };

      transport.stateChanged(FAVORITE, off);
      expect(state.STATES[FAVORITE]).toBe(off);
      transport.stateChanged(otherEntity.entity_id, warmer);
      transport.stateChanged(FAVORITE, on);
      expect(batches).toEqual([]);

      jest.advanceTimersByTime(50);
      expect(batches).toEqual([
        [
          { entityId: FAVORITE, entity: on, local: false },
          { entityId: otherEntity.entity_id, entity: warmer, local: false },
        ],
      ]);
    });

    it('delivers a removed entity as null, by its id or its old state', () => {
      start();
      transport.connect([favoriteEntity, otherEntity]);
      transport.stateChanged(FAVORITE, null, favoriteEntity);
      transport.event({
        event_type: 'state_changed',
        data: { new_state: null, old_state: otherEntity },
      });
      jest.advanceTimersByTime(50);

      expect(state.STATES).toEqual({});
      expect(batches).toEqual([
        [
          { entityId: FAVORITE, entity: null, local: false },
          { entityId: otherEntity.entity_id, entity: null, local: false },
        ],
      ]);
    });

    it('calls listeners in the order they subscribed, and one that throws does not stop the rest', () => {
      start();
      const heard = [];
      session.subscribe(() => {
        heard.push('first');
        throw new Error('broken consumer');
      });
      session.subscribe(() => heard.push('second'));
      transport.connect([otherEntity]);
      transport.stateChanged(otherEntity.entity_id, { ...otherEntity, state: '73' });
      jest.advanceTimersByTime(50);

      expect(heard).toEqual(['first', 'second']);
      expect(batches).toHaveLength(1);
      expect(log.error).toHaveBeenCalledWith(
        'Error handling Home Assistant state changes:',
        expect.any(Error)
      );
    });

    it('lets an immediate listener hear each change as it is applied, before the batch', () => {
      start();
      const immediate = [];
      session.subscribe((changes) => immediate.push(changes), { immediate: true });
      transport.connect([otherEntity]);
      const first = { ...otherEntity, state: '73' };
      const second = { ...otherEntity, state: '74' };
      transport.stateChanged(otherEntity.entity_id, first);
      transport.stateChanged(otherEntity.entity_id, second);

      expect(immediate).toEqual([
        [{ entityId: otherEntity.entity_id, entity: first, local: false }],
        [{ entityId: otherEntity.entity_id, entity: second, local: false }],
      ]);
      expect(batches).toEqual([]);
    });

    it('stops delivering to a listener that unsubscribed', () => {
      start();
      const listener = jest.fn();
      const stop = session.subscribe(listener);
      const stopImmediate = session.subscribe(listener, { immediate: true });
      stop();
      stopImmediate();
      transport.connect([otherEntity]);
      transport.stateChanged(otherEntity.entity_id, { ...otherEntity, state: '73' });
      jest.advanceTimersByTime(1000);
      expect(listener).not.toHaveBeenCalled();
    });

    it('feeds a state from a stand-in for Home Assistant like one Home Assistant sent', () => {
      start();
      const demo = { entity_id: 'climate.demo', state: 'heat' };
      session.receiveEntityState(demo);
      expect(state.STATES['climate.demo']).toBe(demo);
      jest.advanceTimersByTime(50);
      expect(batches).toEqual([[{ entityId: 'climate.demo', entity: demo, local: false }]]);
    });

    describe('frames', () => {
      const showWindow = () => {
        globalThis.document = { hidden: false };
      };

      it('still flushes when the window hides after the animation frame was requested', () => {
        start();
        transport.connect([favoriteEntity]);
        showWindow();
        // Chromium does not run frames for a hidden window: this one is requested and never fires.
        globalThis.requestAnimationFrame = jest.fn(() => 42);
        globalThis.cancelAnimationFrame = jest.fn();

        transport.stateChanged(FAVORITE, { ...favoriteEntity, state: 'off' });
        expect(globalThis.requestAnimationFrame).toHaveBeenCalledTimes(1);
        globalThis.document.hidden = true;
        jest.advanceTimersByTime(300);

        expect(batches).toHaveLength(1);
        expect(globalThis.cancelAnimationFrame).toHaveBeenCalledWith(42);

        // And the flush is not left pending: the next change gets through too.
        transport.stateChanged(FAVORITE, { ...favoriteEntity, state: 'on' });
        jest.advanceTimersByTime(100);
        expect(batches).toHaveLength(2);
      });

      it('flushes once when the frame and the timer both could run', () => {
        start();
        transport.connect([favoriteEntity]);
        showWindow();
        globalThis.requestAnimationFrame = jest.fn((callback) => setTimeout(callback, 16));
        globalThis.cancelAnimationFrame = jest.fn();

        transport.stateChanged(FAVORITE, { ...favoriteEntity, state: 'off' });
        jest.advanceTimersByTime(16);
        expect(batches).toHaveLength(1);
        jest.advanceTimersByTime(1000);
        expect(batches).toHaveLength(1);
      });

      it('does not wait for a frame while the window is hidden', () => {
        start();
        transport.connect([favoriteEntity]);
        globalThis.document = { hidden: true };
        globalThis.requestAnimationFrame = jest.fn(() => 7);

        transport.stateChanged(FAVORITE, { ...favoriteEntity, state: 'off' });
        expect(globalThis.requestAnimationFrame).not.toHaveBeenCalled();
        jest.advanceTimersByTime(49);
        expect(batches).toHaveLength(0);
        jest.advanceTimersByTime(1);
        expect(batches).toHaveLength(1);
      });
    });
  });

  describe('a favorite that a reconnect leaves out', () => {
    const kept = () => state.STATES[FAVORITE];
    const later = (ms) => jest.setSystemTime(Date.now() + ms);

    it('keeps its last state for a reconnect, but not a non-favorite', () => {
      start();
      transport.connect([favoriteEntity, otherEntity]);
      later(60 * 1000);
      transport.connect([]);
      expect(state.STATES).toEqual({ [FAVORITE]: favoriteEntity });
    });

    it('is dropped at a reconnect once it has been missing for 15 minutes', () => {
      start();
      transport.connect([favoriteEntity, otherEntity]);
      later(60 * 1000);
      transport.connect([otherEntity]);
      later(STALE_PRESERVE_MS + 1);
      transport.connect([otherEntity]);
      expect(state.STATES).toEqual({ [otherEntity.entity_id]: otherEntity });
      expect(debug).toHaveBeenLastCalledWith(
        'ws.get_states.received',
        expect.objectContaining({ droppedStaleFavorites: [FAVORITE] })
      );
    });

    it('is tracked afresh once Home Assistant returns it', () => {
      start();
      transport.connect([favoriteEntity, otherEntity]);
      later(60 * 1000);
      transport.connect([otherEntity]);
      later(STALE_PRESERVE_MS + 1);
      transport.connect([favoriteEntity, otherEntity]);
      later(60 * 1000);
      transport.connect([otherEntity]);
      expect(kept()).toEqual(favoriteEntity);
    });

    it('shows as unavailable once the minute of grace has passed, as a state the widget set', () => {
      start();
      transport.connect([favoriteEntity, otherEntity]);
      transport.connect([otherEntity]);

      // Still its last state while integrations load after a Home Assistant restart.
      jest.advanceTimersByTime(59 * 1000);
      expect(kept().state).toBe('on');

      jest.advanceTimersByTime(2 * 1000);
      const unavailable = { ...favoriteEntity, state: 'unavailable' };
      expect(kept()).toEqual(unavailable);
      // Home Assistant never reported an outage, so it is marked as the widget's own.
      expect(batches).toEqual([[{ entityId: FAVORITE, entity: unavailable, local: true }]]);
    });

    it('is left alone when Home Assistant reports it within the grace', () => {
      start();
      transport.connect([favoriteEntity, otherEntity]);
      transport.connect([otherEntity]);
      const reported = { ...favoriteEntity, state: 'off' };
      transport.stateChanged(FAVORITE, reported);
      jest.advanceTimersByTime(5 * 60 * 1000);
      expect(kept()).toEqual(reported);
    });

    it('gets a fresh grace at a later reconnect once Home Assistant has reported it', () => {
      start();
      transport.connect([favoriteEntity, otherEntity]);
      transport.connect([otherEntity]);
      const reported = { ...favoriteEntity, state: 'off' };
      transport.stateChanged(FAVORITE, reported);
      // A connection that keeps dropping reconnects before the minute is up, so the check that
      // looks at the record never gets to run between two reconnects.
      jest.advanceTimersByTime(1000);
      later(STALE_PRESERVE_MS + 1);
      transport.connect([otherEntity]);
      expect(kept()).toEqual(reported);
    });

    it('stops being tracked when its state was replaced by anything else before the check', () => {
      start();
      transport.connect([favoriteEntity, otherEntity]);
      transport.connect([otherEntity]);
      // Not a state change from Home Assistant (a seek the widget applied to the player, say).
      const replaced = { ...favoriteEntity, state: 'off' };
      state.setEntityState(replaced);
      jest.advanceTimersByTime(61 * 1000);
      expect(kept()).toEqual(replaced);

      later(STALE_PRESERVE_MS + 1);
      transport.connect([otherEntity]);
      expect(kept()).toEqual(replaced);
    });

    it('does not take the unavailable it set itself for news from Home Assistant', () => {
      start();
      transport.connect([favoriteEntity, otherEntity]);
      later(60 * 1000);
      transport.connect([otherEntity]);
      jest.advanceTimersByTime(61 * 1000);
      expect(kept().state).toBe('unavailable');

      // Still never reported, so the 15 minutes run from the first omission.
      later(STALE_PRESERVE_MS);
      transport.connect([otherEntity]);
      expect(state.STATES).toEqual({ [otherEntity.entity_id]: otherEntity });
    });

    it('starts the minute again at the next reconnect', () => {
      start();
      transport.connect([favoriteEntity, otherEntity]);
      transport.connect([otherEntity]);
      jest.advanceTimersByTime(40 * 1000);
      transport.connect([otherEntity]);

      jest.advanceTimersByTime(40 * 1000);
      expect(kept().state).toBe('on');
      jest.advanceTimersByTime(21 * 1000);
      expect(kept().state).toBe('unavailable');
    });

    it('stays unavailable through a later reconnect, until the grace for dropping it ends', () => {
      start();
      transport.connect([favoriteEntity, otherEntity]);
      transport.connect([otherEntity]);
      jest.advanceTimersByTime(61 * 1000);

      transport.connect([otherEntity]);
      expect(kept().state).toBe('unavailable');

      later(STALE_PRESERVE_MS);
      transport.connect([otherEntity]);
      expect(kept()).toBeUndefined();
    });

    it('is not kept once Home Assistant removed it', () => {
      start();
      transport.connect([favoriteEntity, otherEntity]);
      transport.stateChanged(FAVORITE, null, favoriteEntity);
      expect(kept()).toBeUndefined();
      transport.connect([otherEntity]);
      expect(kept()).toBeUndefined();
    });

    it('is not marked unavailable once Home Assistant says it was renamed', () => {
      start();
      transport.connect([favoriteEntity, otherEntity]);
      transport.connect([otherEntity]);
      transport.event({
        event_type: 'entity_registry_updated',
        data: { action: 'update', old_entity_id: FAVORITE, entity_id: 'light.renamed' },
      });
      jest.advanceTimersByTime(61 * 1000);
      expect(kept()).toEqual(favoriteEntity);
      expect(batches).toEqual([]);
    });
  });
});

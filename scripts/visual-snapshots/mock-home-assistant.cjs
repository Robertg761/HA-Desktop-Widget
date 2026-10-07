/**
 * A tiny stand-in for Home Assistant, just enough for the widget to connect and render.
 *
 * It speaks the WebSocket API's auth handshake and answers every request from a fixture: states
 * for get_states, services for get_services (the command palette only offers commands for
 * services that exist), empty lists and objects for registries, null for subscriptions; the few
 * services that return data answer from `serviceResponses`. History is empty unless `histories`
 * returns rows for an entity, and a subscription starts with the events `subscriptionEvents`
 * lists for it (the persistent notifications that exist when the app subscribes). A scene that
 * needs events later than that, without them showing in every scene, sends them with
 * `server.pushEvents(subscriptionType, events)` to the subscriptions that are open. A scene can
 * also change what the home holds while the app runs (`server.changeStates`), which reaches the
 * app the way Home Assistant's own changes do, as state_changed events to the subscriptions that
 * asked for them.
 * The WebSocket framing is done by hand (text frames, ping, close) so the snapshot job needs no
 * dependency beyond Node itself. Test-only; never shipped.
 */

const nodeCrypto = require('crypto');
const http = require('http');

const HA_VERSION = '2026.9.0';
const WS_GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';

function encodeFrame(text) {
  const payload = Buffer.from(text, 'utf8');
  const length = payload.length;
  let header;
  if (length < 126) {
    header = Buffer.from([0x81, length]);
  } else if (length < 65536) {
    header = Buffer.alloc(4);
    header[0] = 0x81;
    header[1] = 126;
    header.writeUInt16BE(length, 2);
  } else {
    header = Buffer.alloc(10);
    header[0] = 0x81;
    header[1] = 127;
    header.writeBigUInt64BE(BigInt(length), 2);
  }
  return Buffer.concat([header, payload]);
}

/** Pull complete client frames off the buffer; returns [frames, remainder]. */
function decodeFrames(buffer) {
  const frames = [];
  let offset = 0;
  while (buffer.length - offset >= 2) {
    const opcode = buffer[offset] & 0x0f;
    const masked = (buffer[offset + 1] & 0x80) !== 0;
    let length = buffer[offset + 1] & 0x7f;
    let cursor = offset + 2;
    if (length === 126) {
      if (buffer.length - cursor < 2) break;
      length = buffer.readUInt16BE(cursor);
      cursor += 2;
    } else if (length === 127) {
      if (buffer.length - cursor < 8) break;
      length = Number(buffer.readBigUInt64BE(cursor));
      cursor += 8;
    }
    const maskLength = masked ? 4 : 0;
    if (buffer.length - cursor < maskLength + length) break;
    const mask = masked ? buffer.subarray(cursor, cursor + 4) : null;
    cursor += maskLength;
    const payload = Buffer.from(buffer.subarray(cursor, cursor + length));
    if (mask) for (let i = 0; i < payload.length; i += 1) payload[i] ^= mask[i % 4];
    frames.push({ opcode, payload });
    offset = cursor + length;
  }
  return [frames, buffer.subarray(offset)];
}

function resultFor(message, { states, services, serviceResponses, histories }) {
  switch (message.type) {
    case 'history/history_during_period': {
      // Home Assistant's minimal response: rows of {s: state, lu: last_updated in seconds}, keyed by
      // entity, and only for entities that recorded something.
      const rows = (message.entity_ids || [])
        .map((entityId) => [entityId, histories?.(entityId, message) || []])
        .filter(([, entityRows]) => entityRows.length);
      return Object.fromEntries(rows);
    }
    case 'call_service': {
      // A service that returns data (todo.get_items, calendar.get_events) answers from the
      // fixture; every other call just succeeds.
      const respond = message.return_response
        ? serviceResponses?.[`${message.domain}.${message.service}`]
        : null;
      if (!respond) return null;
      return {
        context: { id: 'mock', parent_id: null, user_id: null },
        response: respond(message),
      };
    }
    case 'get_states':
      return states;
    case 'get_config':
      return {
        location_name: 'Home',
        version: HA_VERSION,
        time_zone: 'UTC',
        components: [],
        unit_system: {
          length: 'km',
          mass: 'kg',
          temperature: '°C',
          volume: 'L',
          pressure: 'hPa',
          wind_speed: 'km/h',
        },
      };
    case 'get_services':
      return services;
    case 'auth/current_user':
      return { id: 'snapshot', name: 'Snapshot', is_owner: true, is_admin: true };
    case 'config/entity_registry/list_for_display':
      return { entity_categories: {}, entities: [] };
    default:
      if (message.type.endsWith('/list')) return [];
      if (message.type.startsWith('history/') || message.type.startsWith('recorder/')) return {};
      return null;
  }
}

/**
 * Adds, replaces and removes entities in the list get_states answers from, and says what changed.
 * @param {Array} states - The mock's entity states; changed in place.
 * @param {{add?: Array, remove?: string[]}} changes - Entities to add (or replace) and entity ids to remove.
 * @returns {Array<{entityId: string, oldState: Object|null, newState: Object|null}>}
 */
function applyStateChanges(states, { add = [], remove = [] } = {}) {
  const changes = [];
  for (const entityId of remove) {
    const index = states.findIndex((entity) => entity.entity_id === entityId);
    if (index === -1) continue;
    const [oldState] = states.splice(index, 1);
    changes.push({ entityId, oldState, newState: null });
  }
  for (const newState of add) {
    const index = states.findIndex((entity) => entity.entity_id === newState.entity_id);
    const oldState = index === -1 ? null : states[index];
    if (index === -1) states.push(newState);
    else states[index] = newState;
    changes.push({ entityId: newState.entity_id, oldState, newState });
  }
  return changes;
}

/** The event Home Assistant sends to a state_changed subscription for one change. */
function stateChangedMessage(subscriptionId, { entityId, oldState, newState }) {
  return {
    id: subscriptionId,
    type: 'event',
    event: {
      event_type: 'state_changed',
      data: { entity_id: entityId, old_state: oldState, new_state: newState },
      origin: 'LOCAL',
      time_fired: new Date().toISOString(),
      context: { id: 'mock', parent_id: null, user_id: null },
    },
  };
}

// A service call aimed at an entity the scene wants to fail, in either place Home Assistant takes it.
function isRefusedCall(message, failingEntities) {
  if (message.type !== 'call_service' || !failingEntities.length) return false;
  const target = message.service_data?.entity_id ?? message.target?.entity_id;
  return [target].flat().some((entityId) => failingEntities.includes(entityId));
}

function startMockHomeAssistant({
  port = 0,
  token,
  states,
  services = {},
  serviceResponses = {},
  histories = null,
  subscriptionEvents = null,
  failingEntities = [],
}) {
  const server = http.createServer((request, response) => {
    // The widget asks for this before it opens a browser to sign in. Left unanswered, a first-run
    // authorization waits, as it does while the browser is open, until it is cancelled or the
    // widget stops waiting for an answer; closeAllConnections ends it with the server.
    if (request.url?.startsWith('/auth/providers')) return;
    // A saved authorization is traded here for a token as the widget starts. Left unanswered, the
    // widget stays on its restoring panel until it stops waiting (15 s).
    if (request.url?.startsWith('/auth/token')) return;
    response.writeHead(404, { 'content-type': 'application/json' });
    response.end('{"message":"Not found"}');
  });

  // Upgraded WebSocket sockets are not tracked by server.closeAllConnections(), so do it here.
  const sockets = new Set();
  const closeAllConnections = server.closeAllConnections?.bind(server);
  server.closeAllConnections = () => {
    closeAllConnections?.();
    sockets.forEach((socket) => socket.destroy());
    sockets.clear();
  };

  // The subscriptions the app has open, by socket: the request they were made with (its type, and
  // the event type of a subscribe_events) and how to reach them. Every way of sending the app
  // events later looks them up here.
  const subscriptions = new Map();
  const eachSubscription = (matches, callback) => {
    for (const open of subscriptions.values()) {
      for (const subscription of open) if (matches(subscription)) callback(subscription);
    }
  };
  server.pushEvents = (type, events) => {
    eachSubscription(
      (subscription) => subscription.type === type,
      ({ id, send }) => events.forEach((event) => send({ id, type: 'event', event }))
    );
  };

  // An outage needs the server to stay away, not only to drop the sockets: the app reconnects within
  // a second and would be back before a screenshot.
  let refusing = false;
  server.refuseConnections = (refuse) => {
    refusing = refuse;
    if (refuse) server.closeAllConnections();
  };

  /**
   * Changes what the home holds while the app runs: the entities in `add` appear (or are
   * replaced) and those in `remove` (entity ids) go, and every state_changed subscription is told
   * as it would be by Home Assistant. A later get_states, such as after a reconnect, answers with
   * the new list.
   */
  server.changeStates = (changes) => {
    for (const change of applyStateChanges(states, changes)) {
      eachSubscription(
        (subscription) =>
          subscription.type === 'subscribe_events' && subscription.eventType === 'state_changed',
        ({ id, send }) => send(stateChangedMessage(id, change))
      );
    }
  };

  server.on('upgrade', (request, socket) => {
    sockets.add(socket);
    subscriptions.set(socket, []);
    socket.on('close', () => {
      sockets.delete(socket);
      subscriptions.delete(socket);
    });
    if (refusing || request.url !== '/api/websocket') {
      socket.destroy();
      return;
    }
    const accept = nodeCrypto
      .createHash('sha1')
      .update(request.headers['sec-websocket-key'] + WS_GUID)
      .digest('base64');
    socket.write(
      'HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n' +
        `Sec-WebSocket-Accept: ${accept}\r\n\r\n`
    );
    const send = (value) => socket.write(encodeFrame(JSON.stringify(value)));
    send({ type: 'auth_required', ha_version: HA_VERSION });

    let pending = Buffer.alloc(0);
    socket.on('data', (chunk) => {
      const [frames, rest] = decodeFrames(Buffer.concat([pending, chunk]));
      pending = rest;
      for (const { opcode, payload } of frames) {
        if (opcode === 0x8) {
          socket.end(Buffer.from([0x88, 0]));
          return;
        }
        if (opcode === 0x9) {
          socket.write(Buffer.concat([Buffer.from([0x8a, payload.length]), payload]));
          continue;
        }
        if (opcode !== 0x1) continue;
        let message;
        try {
          message = JSON.parse(payload.toString('utf8'));
        } catch {
          continue;
        }
        for (const item of Array.isArray(message) ? message : [message]) {
          if (item.type === 'auth') {
            send(
              item.access_token === token
                ? { type: 'auth_ok', ha_version: HA_VERSION }
                : { type: 'auth_invalid', message: 'Invalid access token' }
            );
          } else if (item.type === 'ping') {
            send({ id: item.id, type: 'pong' });
          } else if (typeof item.id === 'number' && isRefusedCall(item, failingEntities)) {
            // A reason as long as a real one, so the toast that reports it wraps at the default
            // width, as the toast layout scenes need it to.
            send({
              id: item.id,
              type: 'result',
              success: false,
              error: {
                code: 'unknown_error',
                message:
                  'The device did not respond. Check that it is powered on and connected to Home Assistant.',
              },
            });
          } else if (typeof item.id === 'number') {
            send({
              id: item.id,
              type: 'result',
              success: true,
              result: resultFor(item, { states, services, serviceResponses, histories }),
            });
            // What a subscription starts with, sent under the subscription's own id.
            for (const event of subscriptionEvents?.(item) || []) {
              send({ id: item.id, type: 'event', event });
            }
            if (item.type === 'unsubscribe_events') {
              subscriptions.set(
                socket,
                (subscriptions.get(socket) || []).filter(({ id }) => id !== item.subscription)
              );
            } else if (/subscribe/.test(item.type)) {
              subscriptions
                .get(socket)
                ?.push({ id: item.id, type: item.type, eventType: item.event_type, send });
            }
          }
        }
      }
    });
    socket.on('error', () => {});
  });

  return new Promise((resolve) => {
    server.listen(port, '127.0.0.1', () => resolve(server));
  });
}

module.exports = {
  startMockHomeAssistant,
  applyStateChanges,
  decodeFrames,
  encodeFrame,
  isRefusedCall,
  resultFor,
  stateChangedMessage,
};

/**
 * A tiny stand-in for Home Assistant, just enough for the widget to connect and render.
 *
 * It speaks the WebSocket API's auth handshake and answers every request from a fixture: states
 * for get_states, empty lists and objects for registries and history, null for subscriptions.
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

function resultFor(message, states) {
  switch (message.type) {
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
      return {};
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

function startMockHomeAssistant({ port = 0, token, states }) {
  const server = http.createServer((request, response) => {
    response.writeHead(404, { 'content-type': 'application/json' });
    response.end('{"message":"Not found"}');
  });

  server.on('upgrade', (request, socket) => {
    if (request.url !== '/api/websocket') {
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
          } else if (typeof item.id === 'number') {
            send({ id: item.id, type: 'result', success: true, result: resultFor(item, states) });
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

module.exports = { startMockHomeAssistant, encodeFrame, decodeFrames };

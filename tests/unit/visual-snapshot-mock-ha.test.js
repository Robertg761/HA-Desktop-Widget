/**
 * @jest-environment node
 */

const net = require('net');
const {
  applyStateChanges,
  decodeFrames,
  encodeFrame,
  isRefusedCall,
  resultFor,
  startMockHomeAssistant,
  stateChangedMessage,
} = require('../../scripts/visual-snapshots/mock-home-assistant.cjs');
const { buildServiceResponses } = require('../../scripts/visual-snapshots/fixture.cjs');

function maskedClientFrame(text) {
  const payload = Buffer.from(text, 'utf8');
  const mask = Buffer.from([1, 2, 3, 4]);
  const header =
    payload.length < 126
      ? Buffer.from([0x81, 0x80 | payload.length])
      : Buffer.from([0x81, 0x80 | 126, payload.length >> 8, payload.length & 0xff]);
  const body = Buffer.from(payload.map((byte, index) => byte ^ mask[index % 4]));
  return Buffer.concat([header, mask, body]);
}

describe('visual snapshot mock Home Assistant framing', () => {
  test('decodes masked client frames, including extended lengths and split chunks', () => {
    const short = maskedClientFrame('{"type":"auth"}');
    const long = maskedClientFrame(JSON.stringify({ type: 'get_states', pad: 'x'.repeat(300) }));
    const joined = Buffer.concat([short, long]);

    const [firstPass, rest] = decodeFrames(joined.subarray(0, short.length + 10));
    expect(firstPass.map((frame) => frame.payload.toString())).toEqual(['{"type":"auth"}']);
    expect(rest.length).toBe(10);

    const [secondPass, remainder] = decodeFrames(
      Buffer.concat([rest, joined.subarray(short.length + 10)])
    );
    expect(JSON.parse(secondPass[0].payload.toString()).type).toBe('get_states');
    expect(remainder.length).toBe(0);
  });

  test('encodes server text frames with the right length header', () => {
    expect([...encodeFrame('hi').subarray(0, 2)]).toEqual([0x81, 2]);
    const medium = encodeFrame('x'.repeat(200));
    expect(medium[1]).toBe(126);
    expect(medium.readUInt16BE(2)).toBe(200);
    const large = encodeFrame('x'.repeat(70000));
    expect(large[1]).toBe(127);
    expect(Number(large.readBigUInt64BE(2))).toBe(70000);
  });
});

describe('visual snapshot mock Home Assistant service responses', () => {
  const context = { states: [], services: {}, serviceResponses: buildServiceResponses() };
  const call = (domain, service, extra = {}) => ({
    type: 'call_service',
    domain,
    service,
    service_data: { entity_id: `${domain}.sample` },
    ...extra,
  });

  test('answers the services that return data with the entity keyed response', () => {
    const todo = resultFor(call('todo', 'get_items', { return_response: true }), context);
    expect(Object.keys(todo.response)).toEqual(['todo.sample']);
    expect(todo.response['todo.sample'].items.length).toBeGreaterThan(1);

    const calendar = resultFor(call('calendar', 'get_events', { return_response: true }), context);
    expect(calendar.response['calendar.sample'].events[0]).toHaveProperty('summary');
  });

  test('just succeeds for every other call, or when no response was asked for', () => {
    expect(resultFor(call('todo', 'get_items'), context)).toBeNull();
    expect(resultFor(call('light', 'turn_on', { return_response: true }), context)).toBeNull();
  });
});

describe('visual snapshot mock Home Assistant refused calls', () => {
  const failing = ['light.unreachable'];

  test('refuses a service call aimed at a failing entity, in either place Home Assistant takes it', () => {
    expect(
      isRefusedCall(
        { type: 'call_service', service_data: { entity_id: 'light.unreachable' } },
        failing
      )
    ).toBe(true);
    expect(
      isRefusedCall(
        { type: 'call_service', target: { entity_id: ['light.office', 'light.unreachable'] } },
        failing
      )
    ).toBe(true);
  });

  test('lets every other call through', () => {
    expect(
      isRefusedCall({ type: 'call_service', service_data: { entity_id: 'light.office' } }, failing)
    ).toBe(false);
    expect(isRefusedCall({ type: 'get_states' }, failing)).toBe(false);
    expect(
      isRefusedCall({ type: 'call_service', service_data: { entity_id: 'light.unreachable' } }, [])
    ).toBe(false);
    expect(isRefusedCall({ type: 'call_service' }, failing)).toBe(false);
  });
});

describe('visual snapshot mock Home Assistant state changes', () => {
  const entity = (entityId, state = 'on') => ({ entity_id: entityId, state, attributes: {} });

  test('adds, replaces and removes entities in place and reports each change', () => {
    const states = [entity('light.one'), entity('light.two')];

    expect(
      applyStateChanges(states, {
        add: [entity('light.three'), entity('light.one', 'off')],
        remove: ['light.two', 'light.missing'],
      })
    ).toEqual([
      { entityId: 'light.two', oldState: entity('light.two'), newState: null },
      { entityId: 'light.three', oldState: null, newState: entity('light.three') },
      {
        entityId: 'light.one',
        oldState: entity('light.one'),
        newState: entity('light.one', 'off'),
      },
    ]);
    expect(states.map((item) => `${item.entity_id}:${item.state}`)).toEqual([
      'light.one:off',
      'light.three:on',
    ]);
  });

  test('words a change as the state_changed event the app listens for', () => {
    const message = stateChangedMessage(7, {
      entityId: 'light.new',
      oldState: null,
      newState: entity('light.new'),
    });

    expect(message).toMatchObject({
      id: 7,
      type: 'event',
      event: {
        event_type: 'state_changed',
        data: { entity_id: 'light.new', old_state: null, new_state: entity('light.new') },
      },
    });
  });

  describe('over a connection', () => {
    let server;

    beforeEach(async () => {
      server = await startMockHomeAssistant({ token: 'secret', states: [entity('light.one')] });
    });

    afterEach(async () => {
      server.closeAllConnections();
      await new Promise((resolve) => server.close(resolve));
    });

    // A bare WebSocket client: upgrade, then masked frames out and plain frames in.
    function connect() {
      return new Promise((resolve) => {
        const socket = net.connect(server.address().port, '127.0.0.1');
        const messages = [];
        const waiting = [];
        let buffer = Buffer.alloc(0);
        let upgraded = false;
        socket.on('connect', () => {
          socket.write(
            'GET /api/websocket HTTP/1.1\r\nHost: 127.0.0.1\r\nUpgrade: websocket\r\n' +
              'Connection: Upgrade\r\nSec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\n' +
              'Sec-WebSocket-Version: 13\r\n\r\n'
          );
        });
        socket.on('data', (chunk) => {
          buffer = Buffer.concat([buffer, chunk]);
          if (!upgraded) {
            const end = buffer.indexOf('\r\n\r\n');
            if (end === -1) return;
            buffer = buffer.subarray(end + 4);
            upgraded = true;
          }
          const [frames, rest] = decodeFrames(buffer);
          buffer = rest;
          for (const frame of frames) {
            const message = JSON.parse(frame.payload.toString());
            if (waiting.length) waiting.shift()(message);
            else messages.push(message);
          }
        });
        const client = {
          send: (message) => socket.write(maskedClientFrame(JSON.stringify(message))),
          next: () =>
            new Promise((done) => {
              if (messages.length) done(messages.shift());
              else waiting.push(done);
            }),
          close: () => socket.destroy(),
        };
        client.next().then(async (greeting) => {
          expect(greeting.type).toBe('auth_required');
          client.send({ type: 'auth', access_token: 'secret' });
          expect((await client.next()).type).toBe('auth_ok');
          resolve(client);
        });
      });
    }

    test('tells a client that subscribed about an entity that arrives and one that goes', async () => {
      const client = await connect();
      client.send({ id: 1, type: 'subscribe_events', event_type: 'state_changed' });
      expect((await client.next()).type).toBe('result');

      server.changeStates({ add: [entity('light.landing')] });
      const arrived = await client.next();
      expect(arrived.id).toBe(1);
      expect(arrived.event.data).toMatchObject({
        entity_id: 'light.landing',
        old_state: null,
        new_state: { entity_id: 'light.landing' },
      });
      client.send({ id: 2, type: 'get_states' });
      expect((await client.next()).result.map((item) => item.entity_id)).toEqual([
        'light.one',
        'light.landing',
      ]);

      server.changeStates({ remove: ['light.landing'] });
      expect((await client.next()).event.data).toMatchObject({
        entity_id: 'light.landing',
        new_state: null,
      });
      client.send({ id: 3, type: 'get_states' });
      expect((await client.next()).result.map((item) => item.entity_id)).toEqual(['light.one']);
      client.close();
    });

    test('says nothing to a client that did not subscribe', async () => {
      const client = await connect();
      server.changeStates({ add: [entity('light.landing')] });
      client.send({ id: 1, type: 'ping' });
      // The pong is the first thing to arrive: no event was queued ahead of it.
      expect(await client.next()).toMatchObject({ id: 1, type: 'pong' });
      client.close();
    });
  });
});

/**
 * @jest-environment node
 */

const http = require('http');
const {
  decodeFrames,
  encodeFrame,
  isRefusedCall,
  resultFor,
  startMockHomeAssistant,
} = require('../../scripts/visual-snapshots/mock-home-assistant.cjs');
const {
  buildHistories,
  buildServiceResponses,
  buildSubscriptionEvents,
} = require('../../scripts/visual-snapshots/fixture.cjs');

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

describe('visual snapshot mock Home Assistant history and subscriptions', () => {
  const now = new Date('2026-10-04T12:00:00Z');
  const history = (entityIds, histories = buildHistories(now)) =>
    resultFor(
      { type: 'history/history_during_period', entity_ids: entityIds },
      { states: [], services: {}, serviceResponses: {}, histories }
    );

  test('answers a history request with rows only for the sensors that recorded something', () => {
    const result = history(['sensor.graph_living_temp', 'sensor.office_temp']);
    expect(Object.keys(result)).toEqual(['sensor.graph_living_temp']);
    const rows = result['sensor.graph_living_temp'];
    // A reading every half hour for a day, oldest first, in Home Assistant's minimal format.
    expect(rows).toHaveLength(49);
    expect(rows[0].lu).toBeLessThan(rows.at(-1).lu);
    expect(rows.at(-1).lu).toBe(now.getTime() / 1000);
    expect(Number.isFinite(Number(rows[0].s))).toBe(true);
  });

  test('leaves history empty when nothing is given, as before', () => {
    expect(history(['sensor.graph_living_temp'], null)).toEqual({});
  });

  test('has the persistent notifications a subscription starts with, with Markdown in them', () => {
    const events = buildSubscriptionEvents(now)({ type: 'persistent_notification/subscribe' });
    expect(events).toHaveLength(1);
    expect(events[0].type).toBe('current');
    const messages = Object.values(events[0].notifications).map((entry) => entry.message);
    expect(messages.some((message) => /\[[^\]]+\]\(\/config\/[a-z]+\)/.test(message))).toBe(true);
    expect(messages.some((message) => message.includes('**'))).toBe(true);
    expect(buildSubscriptionEvents(now)({ type: 'subscribe_events' })).toEqual([]);
  });
});

describe('visual snapshot mock Home Assistant pushed events', () => {
  // A client as small as the mock needs: the upgrade handshake, then masked text frames out and
  // the server's frames in.
  function connect(port) {
    return new Promise((resolve, reject) => {
      const request = http.request({
        port,
        host: '127.0.0.1',
        path: '/api/websocket',
        headers: {
          Connection: 'Upgrade',
          Upgrade: 'websocket',
          'Sec-WebSocket-Version': '13',
          'Sec-WebSocket-Key': Buffer.from('0123456789abcdef').toString('base64'),
        },
      });
      request.on('upgrade', (response, socket) => {
        const received = [];
        let pending = Buffer.alloc(0);
        socket.on('data', (chunk) => {
          const [frames, rest] = decodeFrames(Buffer.concat([pending, chunk]));
          pending = rest;
          frames.forEach(({ payload }) => received.push(JSON.parse(payload.toString('utf8'))));
        });
        resolve({
          received,
          socket,
          send: (value) => socket.write(maskedClientFrame(JSON.stringify(value))),
        });
      });
      request.on('error', reject);
      request.end();
    });
  }
  const until = async (condition) => {
    for (let attempt = 0; attempt < 100 && !condition(); attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
  };

  test('sends events to the subscriptions that are open, and only to the type asked for', async () => {
    const server = await startMockHomeAssistant({ token: 'token', states: [] });
    const client = await connect(server.address().port);
    try {
      client.send({ type: 'auth', access_token: 'token' });
      client.send({ id: 1, type: 'persistent_notification/subscribe' });
      client.send({ id: 2, type: 'subscribe_events' });
      await until(() => client.received.some((message) => message.id === 2));
      // Nothing is sent when the subscription opens: the bell stays out of every scene.
      expect(client.received.filter((message) => message.type === 'event')).toEqual([]);

      server.pushEvents('persistent_notification/subscribe', [
        { type: 'current', notifications: { a: { notification_id: 'a' } } },
      ]);
      await until(() => client.received.some((message) => message.type === 'event'));
      expect(client.received.filter((message) => message.type === 'event')).toEqual([
        {
          id: 1,
          type: 'event',
          event: { type: 'current', notifications: { a: { notification_id: 'a' } } },
        },
      ]);
    } finally {
      client.socket.destroy();
      server.closeAllConnections();
      await new Promise((resolve) => server.close(resolve));
    }
  });
});

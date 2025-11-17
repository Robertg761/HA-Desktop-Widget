/**
 * @jest-environment jsdom
 */

const { sampleStates, sampleServices: _sampleServices, sampleAreas: _sampleAreas, sampleUnitSystemMetric } = require('../fixtures/ha-data.js');
const { getMockConfig } = require('../mocks/electron.js');

// Mock electron-log
jest.mock('electron-log', () => ({
  debug: jest.fn(),
  error: jest.fn(),
  warn: jest.fn(),
  info: jest.fn()
}));

// Mock WebSocket class with synchronous connection for testing
class MockWebSocket {
  constructor(url) {
    this.url = url;
    this.readyState = MockWebSocket.OPEN; // Start as OPEN for simplicity
    this.onopen = null;
    this.onclose = null;
    this.onerror = null;
    this.onmessage = null;
    this._messageQueue = [];

    MockWebSocket.lastInstance = this;

    // Trigger onopen synchronously
    setTimeout(() => {
      if (this.onopen) {
        this.onopen();
      }
    }, 0);
  }

  send(data) {
    if (this.readyState !== MockWebSocket.OPEN) {
      throw new Error('WebSocket is not open');
    }
    this._messageQueue.push(JSON.parse(data));
  }

  close() {
    this.readyState = MockWebSocket.CLOSED;
    if (this.onclose) {
      this.onclose();
    }
  }

  simulateMessage(message) {
    if (this.onmessage) {
      this.onmessage({ data: JSON.stringify(message) });
    }
  }

  getSentMessages() {
    return this._messageQueue;
  }

  clearMessages() {
    this._messageQueue = [];
  }
}

MockWebSocket.CONNECTING = 0;
MockWebSocket.OPEN = 1;
MockWebSocket.CLOSING = 2;
MockWebSocket.CLOSED = 3;
MockWebSocket.lastInstance = null;

global.WebSocket = MockWebSocket;

describe('WebSocket + State Integration', () => {
  let websocket;
  let state;

  beforeEach(() => {
    jest.clearAllMocks();
    MockWebSocket.lastInstance = null;

    jest.resetModules();

    state = require('../../src/state.js');
    websocket = require('../../src/websocket.js');

    const config = getMockConfig();
    config.homeAssistant = {
      url: 'http://homeassistant.local:8123',
      token: 'valid-token-123'
    };
    config.updateInterval = 5000;
    state.setConfig(config);
  });

  afterEach(() => {
    if (websocket && websocket.ws) {
      websocket.close();
    }
    if (websocket) {
      websocket.removeAllListeners();
    }
  });

  describe('Initial Connection Flow', () => {
    test('complete connection and data fetch', async () => {
      const openPromise = new Promise(resolve => websocket.on('open', resolve));

      websocket.connect();
      await openPromise;

      const ws = MockWebSocket.lastInstance;
      expect(ws).toBeDefined();
      expect(ws.url).toBe('ws://homeassistant.local:8123/api/websocket');

      const statesRequest = websocket.request({ type: 'get_states' });

      await new Promise(resolve => setTimeout(resolve, 0));

      const statesMsg = ws.getSentMessages().find(m => m.type === 'get_states');
      expect(statesMsg).toBeDefined();
      expect(statesMsg.id).toBeGreaterThan(0);

      ws.simulateMessage({
        id: statesMsg.id,
        type: 'result',
        success: true,
        result: Object.values(sampleStates)
      });

      const statesResult = await statesRequest;
      expect(statesResult.success).toBe(true);
      expect(statesResult.result).toEqual(Object.values(sampleStates));
    });

    test('authentication failure handling', async () => {
      const errorPromise = new Promise(resolve => websocket.on('error', resolve));

      const config = state.CONFIG;
      config.homeAssistant.token = 'YOUR_LONG_LIVED_ACCESS_TOKEN';
      state.setConfig(config);

      websocket.connect();

      const error = await errorPromise;
      expect(error.message).toContain('default token');
      expect(MockWebSocket.lastInstance).toBeNull();
    });

    test('concurrent request handling', async () => {
      const openPromise = new Promise(resolve => websocket.on('open', resolve));

      websocket.connect();
      await openPromise;

      const ws = MockWebSocket.lastInstance;

      const req1 = websocket.request({ type: 'get_states' });
      const req2 = websocket.request({ type: 'get_services' });
      const req3 = websocket.request({ type: 'get_config' });

      await new Promise(resolve => setTimeout(resolve, 0));

      const sentMessages = ws.getSentMessages();
      const statesMsg = sentMessages.find(m => m.type === 'get_states');
      const servicesMsg = sentMessages.find(m => m.type === 'get_services');
      const configMsg = sentMessages.find(m => m.type === 'get_config');

      expect(statesMsg).toBeDefined();
      expect(servicesMsg).toBeDefined();
      expect(configMsg).toBeDefined();

      const ids = [statesMsg.id, servicesMsg.id, configMsg.id];
      expect(new Set(ids).size).toBe(3);

      ws.simulateMessage({ id: statesMsg.id, type: 'result', success: true, result: [] });
      ws.simulateMessage({ id: servicesMsg.id, type: 'result', success: true, result: {} });
      ws.simulateMessage({ id: configMsg.id, type: 'result', success: true, result: { unit_system: sampleUnitSystemMetric } });

      const [res1, res2, res3] = await Promise.all([req1, req2, req3]);
      expect(res1.success).toBe(true);
      expect(res2.success).toBe(true);
      expect(res3.success).toBe(true);
    });
  });

  describe('State Management', () => {
    test('entity state merging', () => {
      state.setStates(sampleStates);
      const initialCount = Object.keys(state.STATES).length;

      const newEntity = {
        'sensor.new_sensor': {
          entity_id: 'sensor.new_sensor',
          state: '42',
          attributes: { unit_of_measurement: 'units' }
        }
      };

      state.setStates({ ...state.STATES, ...newEntity });

      expect(Object.keys(state.STATES).length).toBe(initialCount + 1);
      expect(state.STATES['sensor.new_sensor']).toBeDefined();
      expect(state.STATES['light.living_room']).toBeDefined();
    });

    test('state updates via WebSocket events', async () => {
      const openPromise = new Promise(resolve => websocket.on('open', resolve));

      websocket.connect();
      await openPromise;

      const ws = MockWebSocket.lastInstance;
      state.setStates(sampleStates);

      let receivedMessage = null;
      websocket.once('message', msg => {
        receivedMessage = msg;
      });

      const updatedEntity = {
        entity_id: 'light.living_room',
        state: 'on',
        attributes: { friendly_name: 'Living Room Light', brightness: 200 }
      };

      ws.simulateMessage({
        type: 'event',
        event: {
          event_type: 'state_changed',
          data: { entity_id: 'light.living_room', new_state: updatedEntity }
        }
      });

      await new Promise(resolve => setTimeout(resolve, 0));

      expect(receivedMessage).not.toBeNull();
      expect(receivedMessage.type).toBe('event');
    });
  });

  describe('Service Calls', () => {
    test('service call with success response', async () => {
      const openPromise = new Promise(resolve => websocket.on('open', resolve));

      websocket.connect();
      await openPromise;

      const ws = MockWebSocket.lastInstance;

      const servicePromise = websocket.callService('light', 'turn_on', {
        entity_id: 'light.living_room',
        brightness: 255
      });

      await new Promise(resolve => setTimeout(resolve, 0));

      const sentMessages = ws.getSentMessages();
      const serviceMsg = sentMessages.find(m => m.type === 'call_service');

      expect(serviceMsg).toBeDefined();
      expect(serviceMsg.domain).toBe('light');
      expect(serviceMsg.service).toBe('turn_on');
      expect(serviceMsg.service_data.entity_id).toBe('light.living_room');

      ws.simulateMessage({
        id: serviceMsg.id,
        type: 'result',
        success: true,
        result: {}
      });

      const result = await servicePromise;
      expect(result.success).toBe(true);
    });

    test('service call with error response', async () => {
      const openPromise = new Promise(resolve => websocket.on('open', resolve));

      websocket.connect();
      await openPromise;

      const ws = MockWebSocket.lastInstance;

      const servicePromise = websocket.callService('light', 'turn_on', {
        entity_id: 'light.nonexistent'
      });

      await new Promise(resolve => setTimeout(resolve, 0));

      const sentMessages = ws.getSentMessages();
      const serviceMsg = sentMessages.find(m => m.type === 'call_service');

      ws.simulateMessage({
        id: serviceMsg.id,
        type: 'result',
        success: false,
        error: { code: 'not_found', message: 'Entity not found' }
      });

      const result = await servicePromise;
      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
    });

    test('multiple concurrent service calls', async () => {
      const openPromise = new Promise(resolve => websocket.on('open', resolve));

      websocket.connect();
      await openPromise;

      const ws = MockWebSocket.lastInstance;

      const call1 = websocket.callService('light', 'turn_on', { entity_id: 'light.living_room' });
      const call2 = websocket.callService('switch', 'turn_off', { entity_id: 'switch.fan' });
      const call3 = websocket.callService('climate', 'set_temperature', { entity_id: 'climate.thermostat', temperature: 22 });

      await new Promise(resolve => setTimeout(resolve, 0));

      const sentMessages = ws.getSentMessages();
      const serviceMsgs = sentMessages.filter(m => m.type === 'call_service');

      expect(serviceMsgs.length).toBe(3);

      const ids = serviceMsgs.map(m => m.id);
      expect(new Set(ids).size).toBe(3);

      serviceMsgs.forEach(msg => {
        ws.simulateMessage({
          id: msg.id,
          type: 'result',
          success: true,
          result: {}
        });
      });

      const results = await Promise.all([call1, call2, call3]);
      results.forEach(result => {
        expect(result.success).toBe(true);
      });
    });
  });

  describe('Reconnection', () => {
    test('automatic reconnection creates new WebSocket', async () => {
      const openPromise = new Promise(resolve => websocket.on('open', resolve));

      websocket.connect();
      await openPromise;

      const ws1 = MockWebSocket.lastInstance;
      expect(ws1).toBeDefined();

      const closePromise = new Promise(resolve => websocket.on('close', resolve));
      ws1.close();
      await closePromise;

      const reopenPromise = new Promise(resolve => websocket.on('open', resolve));
      websocket.connect();
      await reopenPromise;

      const ws2 = MockWebSocket.lastInstance;
      expect(ws2).toBeDefined();
      expect(ws2).not.toBe(ws1);
    });

    test('state preserved during reconnection', async () => {
      state.setStates(sampleStates);
      const initialStatesCount = Object.keys(state.STATES).length;

      const openPromise = new Promise(resolve => websocket.on('open', resolve));

      websocket.connect();
      await openPromise;

      const ws = MockWebSocket.lastInstance;

      const closePromise = new Promise(resolve => websocket.on('close', resolve));
      ws.close();
      await closePromise;

      expect(Object.keys(state.STATES).length).toBe(initialStatesCount);

      const reopenPromise = new Promise(resolve => websocket.on('open', resolve));
      websocket.connect();
      await reopenPromise;

      expect(Object.keys(state.STATES).length).toBe(initialStatesCount);
    });
  });
});

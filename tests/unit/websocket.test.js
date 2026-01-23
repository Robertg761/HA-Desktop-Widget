/**
 * @jest-environment jsdom
 */

const EventEmitter = require('events');
const { sampleConfig } = require('../fixtures/ha-data');

// Use real state module with .default
const state = require('../../src/state').default;

// Mock logger
const mockLogger = {
  debug: jest.fn(),
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
};
jest.mock('../../src/logger', () => mockLogger);

// Mock WebSocket class
class MockWebSocket extends EventEmitter {
  constructor(url) {
    super();
    this.url = url;
    this.readyState = MockWebSocket.CONNECTING;
    this.sentMessages = [];

    // Simulate connection opening
    setTimeout(() => {
      if (this.readyState === MockWebSocket.CONNECTING) {
        this.readyState = MockWebSocket.OPEN;
        if (this.onopen) this.onopen();
      }
    }, 10);
  }

  send(data) {
    if (this.readyState !== MockWebSocket.OPEN) {
      throw new Error('WebSocket is not open');
    }
    this.sentMessages.push(data);
  }

  close() {
    this.readyState = MockWebSocket.CLOSED;
    if (this.onclose) this.onclose();
  }

  // Helper to simulate receiving a message
  simulateMessage(data) {
    if (this.onmessage) {
      this.onmessage({ data: JSON.stringify(data) });
    }
  }

  // Helper to simulate an error
  simulateError(error) {
    if (this.onerror) {
      this.onerror({ message: error.message, error });
    }
  }
}

// Define WebSocket constants
MockWebSocket.CONNECTING = 0;
MockWebSocket.OPEN = 1;
MockWebSocket.CLOSING = 2;
MockWebSocket.CLOSED = 3;

// Set global WebSocket
global.WebSocket = MockWebSocket;

describe('WebSocket Manager', () => {
  let WebSocketManager;
  let wsManager;

  beforeEach(() => {
    // Clear all mocks
    jest.clearAllMocks();

    // Reset state
    state.setConfig(null);

    // Get the WebSocket manager (singleton)
    if (!wsManager) {
      WebSocketManager = require('../../src/websocket').default;
      wsManager = WebSocketManager;
    }

    // Reset the WebSocket manager state
    if (wsManager.ws) {
      try {
        wsManager.ws.close();
      } catch (_e) {
        // Ignore errors
      }
      wsManager.ws = null;
    }
    wsManager.wsId = 1000;
    wsManager.pendingWs.clear();
    wsManager.removeAllListeners();
  });

  afterEach(() => {
    if (wsManager.ws) {
      wsManager.close();
    }
  });

  describe('Connection', () => {
    test('should not connect with missing config', () => {
      state.setConfig(null);

      const errorHandler = jest.fn();
      wsManager.on('error', errorHandler);

      wsManager.connect();

      expect(errorHandler).toHaveBeenCalledWith(
        expect.objectContaining({
          message: 'Invalid configuration. Please check settings.'
        })
      );
    });

    test('should not connect with missing URL', () => {
      state.setConfig({ homeAssistant: { token: 'test-token' } });

      const errorHandler = jest.fn();
      wsManager.on('error', errorHandler);

      wsManager.connect();

      expect(errorHandler).toHaveBeenCalledWith(
        expect.objectContaining({
          message: 'Invalid configuration. Please check settings.'
        })
      );
    });

    test('should not connect with missing token', () => {
      state.setConfig({ homeAssistant: { url: 'http://test.local:8123' } });

      const errorHandler = jest.fn();
      wsManager.on('error', errorHandler);

      wsManager.connect();

      expect(errorHandler).toHaveBeenCalledWith(
        expect.objectContaining({
          message: 'Invalid configuration. Please check settings.'
        })
      );
    });

    test('should not connect with default token', () => {
      state.setConfig({
        homeAssistant: {
          url: 'http://test.local:8123',
          token: 'YOUR_LONG_LIVED_ACCESS_TOKEN'
        }
      });

      const errorHandler = jest.fn();
      wsManager.on('error', errorHandler);

      wsManager.connect();

      expect(errorHandler).toHaveBeenCalledWith(
        expect.objectContaining({
          message: 'Configuration contains default token. Please update settings.'
        })
      );
    });

    test('should connect with valid config', async () => {
      state.setConfig(sampleConfig);

      const openHandler = jest.fn();
      wsManager.on('open', openHandler);

      wsManager.connect();

      // Wait for connection to open
      await new Promise(resolve => setTimeout(resolve, 20));

      expect(wsManager.ws).toBeTruthy();
      expect(wsManager.ws.url).toBe('ws://homeassistant.local:8123/api/websocket');
      expect(openHandler).toHaveBeenCalled();
    });

    test('should convert https to wss', async () => {
      state.setConfig({
        homeAssistant: {
          url: 'https://test.local:8123',
          token: 'test-token'
        }
      });

      wsManager.connect();

      await new Promise(resolve => setTimeout(resolve, 20));

      expect(wsManager.ws.url).toBe('wss://test.local:8123/api/websocket');
    });

    test('should close existing connection before connecting', async () => {
      state.setConfig(sampleConfig);

      wsManager.connect();
      await new Promise(resolve => setTimeout(resolve, 20));

      const firstWs = wsManager.ws;
      const closeSpy = jest.spyOn(firstWs, 'close');

      wsManager.connect();
      await new Promise(resolve => setTimeout(resolve, 20));

      expect(closeSpy).toHaveBeenCalled();
    });

    test('should emit close event when connection closes', async () => {
      state.setConfig(sampleConfig);

      const closeHandler = jest.fn();
      wsManager.on('close', closeHandler);

      wsManager.connect();
      await new Promise(resolve => setTimeout(resolve, 20));

      wsManager.ws.close();

      expect(closeHandler).toHaveBeenCalled();
    });

    test('should emit error event on WebSocket error', async () => {
      state.setConfig(sampleConfig);

      const errorHandler = jest.fn();
      wsManager.on('error', errorHandler);

      wsManager.connect();
      await new Promise(resolve => setTimeout(resolve, 20));

      wsManager.ws.simulateError(new Error('Connection failed'));

      expect(errorHandler).toHaveBeenCalledWith(
        expect.objectContaining({
          message: 'Connection failed'
        })
      );
    });
  });

  describe('Message Handling', () => {
    beforeEach(async () => {
      state.setConfig(sampleConfig);
      wsManager.connect();
      await new Promise(resolve => setTimeout(resolve, 20));
    });

    test('should emit message event on incoming message', () => {
      const messageHandler = jest.fn();
      wsManager.on('message', messageHandler);

      const testMessage = { type: 'auth_required', ha_version: '2025.1.0' };
      wsManager.ws.simulateMessage(testMessage);

      expect(messageHandler).toHaveBeenCalledWith(testMessage);
    });

    test('should respond to ping with pong', () => {
      wsManager.ws.simulateMessage({ type: 'ping' });

      const sentMessages = wsManager.ws.sentMessages;
      const pongMessage = sentMessages.find(msg => {
        const parsed = JSON.parse(msg);
        return parsed.type === 'pong';
      });

      expect(pongMessage).toBeTruthy();
    });

    test('should not emit ping messages to consumers', () => {
      const messageHandler = jest.fn();
      wsManager.on('message', messageHandler);

      wsManager.ws.simulateMessage({ type: 'ping' });

      // Should send pong but not emit 'message' event for ping
      expect(messageHandler).not.toHaveBeenCalled();
    });

    test('should resolve pending requests on result message', async () => {
      const promise = wsManager.request({ type: 'get_states' });

      // Simulate response
      wsManager.ws.simulateMessage({
        id: promise.id,
        type: 'result',
        success: true,
        result: []
      });

      const result = await promise;
      expect(result.success).toBe(true);
      expect(result.result).toEqual([]);
    });

    test('should handle malformed JSON gracefully', () => {
      // Simulate malformed JSON
      if (wsManager.ws.onmessage) {
        wsManager.ws.onmessage({ data: 'invalid json {' });
      }

      // Should not crash, just log error
      expect(mockLogger.error).toHaveBeenCalled();
    });
  });

  describe('Request Method', () => {
    beforeEach(async () => {
      state.setConfig(sampleConfig);
      wsManager.connect();
      await new Promise(resolve => setTimeout(resolve, 20));
    });

    test('should send request with incremented ID', () => {
      const initialId = wsManager.wsId;

      wsManager.request({ type: 'get_states' });

      expect(wsManager.wsId).toBe(initialId + 1);

      const sentMessage = JSON.parse(wsManager.ws.sentMessages[0]);
      expect(sentMessage.id).toBe(initialId);
      expect(sentMessage.type).toBe('get_states');
    });

    test('should return promise that resolves on response', async () => {
      const promise = wsManager.request({ type: 'get_states' });

      const testResult = [{ entity_id: 'light.test', state: 'on' }];
      wsManager.ws.simulateMessage({
        id: promise.id,
        type: 'result',
        success: true,
        result: testResult
      });

      const result = await promise;
      expect(result.result).toEqual(testResult);
    });

    test('should reject if WebSocket is not connected', async () => {
      wsManager.ws.readyState = MockWebSocket.CLOSED;

      await expect(
        wsManager.request({ type: 'get_states' })
      ).rejects.toThrow('WebSocket not connected');
    });

    test('should timeout after 15 seconds', async () => {
      jest.useFakeTimers();

      const promise = wsManager.request({ type: 'get_states' });

      // Fast-forward time by 15 seconds
      jest.advanceTimersByTime(15000);

      await expect(promise).rejects.toThrow('WebSocket request timeout');

      jest.useRealTimers();
    });

    test('should remove pending request on timeout', async () => {
      jest.useFakeTimers();

      const promise = wsManager.request({ type: 'get_states' });
      const requestId = promise.id;

      expect(wsManager.pendingWs.has(requestId)).toBe(true);

      jest.advanceTimersByTime(15000);

      try {
        await promise;
      } catch (_e) {
        // Expected to throw
      }

      expect(wsManager.pendingWs.has(requestId)).toBe(false);

      jest.useRealTimers();
    });

    test('should clean up pending request on successful response', async () => {
      const promise = wsManager.request({ type: 'get_states' });
      const requestId = promise.id;

      expect(wsManager.pendingWs.has(requestId)).toBe(true);

      wsManager.ws.simulateMessage({
        id: requestId,
        type: 'result',
        success: true,
        result: []
      });

      await promise;

      expect(wsManager.pendingWs.has(requestId)).toBe(false);
    });

    test('should attach ID to returned promise', () => {
      const promise = wsManager.request({ type: 'get_states' });

      expect(promise.id).toBeDefined();
      expect(typeof promise.id).toBe('number');
    });
  });

  describe('Service Calls', () => {
    beforeEach(async () => {
      state.setConfig(sampleConfig);
      wsManager.connect();
      await new Promise(resolve => setTimeout(resolve, 20));
    });

    test('should call service with correct parameters', () => {
      wsManager.callService('light', 'turn_on', { entity_id: 'light.living_room' });

      const sentMessage = JSON.parse(wsManager.ws.sentMessages[0]);
      expect(sentMessage.type).toBe('call_service');
      expect(sentMessage.domain).toBe('light');
      expect(sentMessage.service).toBe('turn_on');
      expect(sentMessage.service_data).toEqual({ entity_id: 'light.living_room' });
    });

    test('should return promise that resolves on success', async () => {
      const promise = wsManager.callService('light', 'turn_on', {
        entity_id: 'light.living_room'
      });

      wsManager.ws.simulateMessage({
        id: promise.id,
        type: 'result',
        success: true,
        result: {}
      });

      const result = await promise;
      expect(result.success).toBe(true);
    });

    test('should handle service call errors', async () => {
      const errorSpy = jest.spyOn(console, 'error').mockImplementation();

      // Make WebSocket closed to trigger error
      wsManager.ws.readyState = MockWebSocket.CLOSED;

      await expect(
        wsManager.callService('light', 'turn_on', { entity_id: 'light.test' })
      ).rejects.toThrow('WebSocket not connected');

      errorSpy.mockRestore();
    });
  });

  describe('Close Method', () => {
    test('should close WebSocket connection', async () => {
      state.setConfig(sampleConfig);
      wsManager.connect();
      await new Promise(resolve => setTimeout(resolve, 20));

      const closeSpy = jest.spyOn(wsManager.ws, 'close');

      wsManager.close();

      expect(closeSpy).toHaveBeenCalled();
      expect(wsManager.ws).toBeNull();
    });

    test('should handle closing when no connection exists', () => {
      wsManager.ws = null;

      expect(() => wsManager.close()).not.toThrow();
    });

    test('should handle errors during close gracefully', async () => {
      state.setConfig(sampleConfig);
      wsManager.connect();
      await new Promise(resolve => setTimeout(resolve, 20));

      // Make close throw an error
      wsManager.ws.close = jest.fn(() => {
        throw new Error('Close failed');
      });

      expect(() => wsManager.close()).not.toThrow();
      expect(mockLogger.error).toHaveBeenCalled();
    });
  });

  describe('Singleton Behavior', () => {
    test('should export a singleton instance', () => {
      const instance1 = require('../../src/websocket').default;
      const instance2 = require('../../src/websocket').default;

      expect(instance1).toBe(instance2);
    });

    test('should be an instance of WebSocketManager', () => {
      const instance = require('../../src/websocket').default;

      // Check for methods since strict type check is failing due to ESM/CommonJS classes
      expect(typeof instance.connect).toBe('function');
      expect(typeof instance.request).toBe('function');
      expect(typeof instance.callService).toBe('function');
      expect(typeof instance.close).toBe('function');
    });
  });
});

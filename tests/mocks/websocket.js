/**
 * Mock WebSocket Manager for Testing
 *
 * This module mocks the WebSocketManager class from src/websocket.js.
 * It extends EventEmitter to simulate WebSocket events and provides
 * methods to simulate Home Assistant responses.
 */

const EventEmitter = require('events');

/**
 * Mock WebSocket Manager Class
 */
class MockWebSocketManager extends EventEmitter {
  constructor() {
    super();
    this.ws = null;
    this.url = null;
    this.token = null;
    this.messageId = 1000;
    this.pendingRequests = new Map();
    this.isConnected = false;
    this.isAuthenticated = false;
    this.subscriptions = new Map();

    // Mock responses storage
    this.mockResponses = new Map();
    this.autoRespond = true;
  }

  /**
   * Connect to Home Assistant (mocked)
   */
  connect(url, token) {
    this.url = url;
    this.token = token;
    this.isConnected = true;
    this.isAuthenticated = false;

    // Simulate connection delay
    setTimeout(() => {
      this.emit('open');
      this.emit('status', 'connected');
    }, 10);

    return this;
  }

  /**
   * Close connection (mocked)
   */
  close() {
    this.isConnected = false;
    this.isAuthenticated = false;
    this.pendingRequests.clear();
    this.emit('close');
    this.emit('status', 'disconnected');
  }

  /**
   * Send a message (mocked)
   */
  send(data) {
    if (!this.isConnected) {
      throw new Error('WebSocket is not connected');
    }

    const message = typeof data === 'string' ? JSON.parse(data) : data;

    // Handle auth message
    if (message.type === 'auth') {
      setTimeout(() => {
        if (this.token === 'invalid_token') {
          this.simulateMessage({ type: 'auth_invalid', message: 'Invalid access token' });
        } else {
          this.isAuthenticated = true;
          this.simulateMessage({ type: 'auth_ok', ha_version: '2025.1.0' });
        }
      }, 10);
      return;
    }

    // Handle other messages with auto-respond
    if (this.autoRespond && message.id) {
      setTimeout(() => {
        const mockResponse = this.mockResponses.get(message.type);
        if (mockResponse) {
          this.simulateMessage({
            id: message.id,
            type: 'result',
            success: true,
            result: typeof mockResponse === 'function' ? mockResponse(message) : mockResponse
          });
        }
      }, 10);
    }
  }

  /**
   * Send a request and wait for response (mocked)
   */
  request(payload) {
    return new Promise((resolve, reject) => {
      if (!this.isConnected) {
        reject(new Error('WebSocket is not connected'));
        return;
      }

      const id = this.messageId++;
      const message = { id, ...payload };

      // Store pending request
      const timeout = setTimeout(() => {
        this.pendingRequests.delete(id);
        reject(new Error('Request timeout'));
      }, 15000);

      this.pendingRequests.set(id, { resolve, reject, timeout });

      // Send message
      this.send(message);
    });
  }

  /**
   * Call a Home Assistant service (mocked)
   */
  callService(domain, service, serviceData = {}) {
    return this.request({
      type: 'call_service',
      domain,
      service,
      service_data: serviceData
    });
  }

  /**
   * Subscribe to events (mocked)
   */
  subscribeEvents(eventType) {
    return this.request({
      type: 'subscribe_events',
      event_type: eventType
    }).then((result) => {
      // Store subscription ID
      this.subscriptions.set(eventType, result.id);
      return result;
    });
  }

  /**
   * Simulate receiving a message from Home Assistant
   */
  simulateMessage(message) {
    // Handle response to pending request
    if (message.id && this.pendingRequests.has(message.id)) {
      const request = this.pendingRequests.get(message.id);
      clearTimeout(request.timeout);
      this.pendingRequests.delete(message.id);

      if (message.success === false) {
        request.reject(new Error(message.error?.message || 'Request failed'));
      } else {
        request.resolve(message.result);
      }
    }

    // Emit message event
    this.emit('message', message);
  }

  /**
   * Simulate an event (like state_changed)
   */
  simulateEvent(eventType, eventData) {
    const subscriptionId = this.subscriptions.get(eventType);
    if (subscriptionId) {
      this.simulateMessage({
        id: subscriptionId,
        type: 'event',
        event: {
          event_type: eventType,
          data: eventData,
          origin: 'LOCAL',
          time_fired: new Date().toISOString(),
          context: { id: 'mock_context_id', parent_id: null, user_id: null }
        }
      });
    }
  }

  /**
   * Simulate a state_changed event
   */
  simulateStateChange(entityId, newState, oldState = null) {
    this.simulateEvent('state_changed', {
      entity_id: entityId,
      new_state: newState,
      old_state: oldState
    });
  }

  /**
   * Simulate an error
   */
  simulateError(error) {
    this.emit('error', error);
  }

  /**
   * Set a mock response for a specific message type
   */
  setMockResponse(messageType, response) {
    this.mockResponses.set(messageType, response);
  }

  /**
   * Clear all mock responses
   */
  clearMockResponses() {
    this.mockResponses.clear();
  }

  /**
   * Reset the mock to initial state
   */
  reset() {
    this.removeAllListeners();
    this.ws = null;
    this.url = null;
    this.token = null;
    this.messageId = 1000;
    this.pendingRequests.clear();
    this.isConnected = false;
    this.isAuthenticated = false;
    this.subscriptions.clear();
    this.mockResponses.clear();
    this.autoRespond = true;
  }
}

/**
 * Create a mock WebSocket Manager instance
 */
function createMockWebSocketManager() {
  return new MockWebSocketManager();
}

/**
 * Mock WebSocket class (for low-level WebSocket testing)
 */
class MockWebSocket {
  constructor(url) {
    this.url = url;
    this.readyState = MockWebSocket.CONNECTING;
    this.onopen = null;
    this.onmessage = null;
    this.onerror = null;
    this.onclose = null;

    // Auto-open after a delay
    setTimeout(() => {
      this.readyState = MockWebSocket.OPEN;
      if (this.onopen) this.onopen({ type: 'open' });
    }, 10);
  }

  send(_data) {
    if (this.readyState !== MockWebSocket.OPEN) {
      throw new Error('WebSocket is not open');
    }
  }

  close(code, reason) {
    this.readyState = MockWebSocket.CLOSING;
    setTimeout(() => {
      this.readyState = MockWebSocket.CLOSED;
      if (this.onclose) this.onclose({ type: 'close', code, reason });
    }, 10);
  }

  // Simulate receiving a message
  simulateMessage(data) {
    if (this.onmessage) {
      this.onmessage({ type: 'message', data: JSON.stringify(data) });
    }
  }

  // Simulate an error
  simulateError(error) {
    if (this.onerror) {
      this.onerror({ type: 'error', error });
    }
  }
}

// WebSocket ready states
MockWebSocket.CONNECTING = 0;
MockWebSocket.OPEN = 1;
MockWebSocket.CLOSING = 2;
MockWebSocket.CLOSED = 3;

module.exports = {
  MockWebSocketManager,
  createMockWebSocketManager,
  MockWebSocket
};

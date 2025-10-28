const { EventEmitter } = require('events');
const log = require('electron-log');
const state = require('./state.js');

class WebSocketManager extends EventEmitter {
  constructor() {
    super();
    this.ws = null;
    this.wsId = 1000;
    this.pendingWs = new Map();
  }

  connect() {
    log.debug('Attempting to connect to Home Assistant WebSocket');
    if (!state.CONFIG || !state.CONFIG.homeAssistant || !state.CONFIG.homeAssistant.url || !state.CONFIG.homeAssistant.token) {
      log.error('Invalid configuration for WebSocket');
      this.emit('status', false);
      this.emit('error', new Error('Invalid configuration. Please check settings.'));
      return;
    }

    if (state.CONFIG.homeAssistant.token === 'YOUR_LONG_LIVED_ACCESS_TOKEN') {
      log.error('Configuration contains default token');
      this.emit('status', false);
      this.emit('error', new Error('Configuration contains default token. Please update settings.'));
      return;
    }

    if (this.ws) {
      this.ws.close();
    }

    try {
      const wsUrl = state.CONFIG.homeAssistant.url.replace(/^http/, 'ws') + '/api/websocket';
      log.debug(`Connecting to WebSocket URL: ${wsUrl}`);
      this.ws = new WebSocket(wsUrl);

      this.ws.onopen = () => {
        log.debug('WebSocket connection established');
        this.emit('open');
      };
      
      this.ws.onmessage = (event) => {
        this.handleMessage(event);
      };
      
      this.ws.onerror = (event) => {
        const message = (event && event.message) || (event && event.error && event.error.message) || 'Unknown WebSocket error';
        log.error('WebSocket error:', message);
        this.emit('error', new Error(message));
      };
      
      this.ws.onclose = (_event) => {
        log.debug('WebSocket connection closed');
        this.emit('close');
      };
    } catch (error) {
      log.error('Failed to create WebSocket connection:', error);
      this.emit('error', error);
    }
  }

  handleMessage(event) {
    try {
      const msg = JSON.parse(event.data);
      // Respond to HA application-level heartbeat to keep the connection alive
      if (msg && msg.type === 'ping' && this.ws && this.ws.readyState === WebSocket.OPEN) {
        try {
          this.ws.send(JSON.stringify({ type: 'pong' }));
        } catch (e) {
          log.warn('Failed to send pong to Home Assistant:', e);
        }
        return; // don't emit ping to consumers
      }
      this.emit('message', msg);

      if (msg.type === 'result' && this.pendingWs.has(msg.id)) {
        const pending = this.pendingWs.get(msg.id);
        this.pendingWs.delete(msg.id);
        pending.resolve(msg);
      }
    } catch (error) {
      log.error('Error processing WebSocket message:', error);
    }
  }

  request(payload) {
    const id = this.wsId++;
    const promise = new Promise((resolve, reject) => {
      try {
        if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
          return reject(new Error('WebSocket not connected'));
        }
        const msg = { id, ...payload };
        this.pendingWs.set(id, { resolve, reject });
        try {
          this.ws.send(JSON.stringify(msg));
        } catch (e) {
          this.pendingWs.delete(id);
          return reject(e);
        }
        setTimeout(() => {
          if (this.pendingWs.has(id)) {
            this.pendingWs.delete(id);
            // Reject without emitting a global error to avoid log spam for optional calls
            reject(new Error('WebSocket request timeout'));
          }
        }, 15000);
      } catch (error) {
        log.error('Error making WebSocket request:', error);
        reject(error);
      }
    });
    // Attach the ID to the promise for tracking
    promise.id = id;
    return promise;
  }

  close() {
    try {
      if (this.ws) {
        this.ws.close();
        this.ws = null;
      }
    } catch (error) {
      log.error('Error closing WebSocket:', error);
    }
  }

  callService(domain, service, serviceData) {
    try {
      return this.request({
        type: 'call_service',
        domain,
        service,
        service_data: serviceData,
      });
    } catch (error) {
      log.error('Error calling service:', error);
      return Promise.reject(error);
    }
  }
}

module.exports = new WebSocketManager();

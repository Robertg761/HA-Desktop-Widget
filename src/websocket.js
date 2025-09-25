const { EventEmitter } = require('events');
const state = require('./state.js');

class WebSocketManager extends EventEmitter {
  constructor() {
    super();
    this.ws = null;
    this.wsId = 1000;
    this.pendingWs = new Map();
  }

  connect() {
    console.log('WebSocket connect called');
    console.log('Current CONFIG:', JSON.stringify(state.CONFIG?.homeAssistant, null, 2));
    
    if (!state.CONFIG || !state.CONFIG.homeAssistant || !state.CONFIG.homeAssistant.url || !state.CONFIG.homeAssistant.token) {
      console.error('Invalid configuration for WebSocket');
      console.error('URL:', state.CONFIG?.homeAssistant?.url);
      console.error('Token:', state.CONFIG?.homeAssistant?.token ? 'Present' : 'Missing');
      this.emit('status', false);
      this.emit('error', new Error('Invalid configuration. Please check settings.'));
      return;
    }

    // Check for default/placeholder values
    if (state.CONFIG.homeAssistant.token === 'YOUR_LONG_LIVED_ACCESS_TOKEN') {
      console.error('Configuration contains default token. Please update your Home Assistant token in settings.');
      console.error('Current URL:', state.CONFIG.homeAssistant.url);
      console.error('Token is still the default placeholder');
      this.emit('status', false);
      this.emit('error', new Error('Configuration contains default token. Please update settings.'));
      return;
    }

    if (this.ws) {
      this.ws.close();
    }

    try {
      const wsUrl = state.CONFIG.homeAssistant.url.replace(/^http/, 'ws') + '/api/websocket';
      console.log('Connecting to WebSocket:', wsUrl);
      this.ws = new WebSocket(wsUrl);

      this.ws.onopen = () => {
        console.log('WebSocket opened successfully');
        this.emit('open');
      };
      
      this.ws.onmessage = (event) => {
        console.log('WebSocket message received:', event.data);
        this.handleMessage(event);
      };
      
      this.ws.onerror = (error) => {
        console.error('WebSocket error:', error);
        this.emit('error', error);
      };
      
      this.ws.onclose = (event) => {
        console.log('WebSocket closed:', event.code, event.reason);
        this.emit('close');
      };
    } catch (error) {
      console.error('Failed to create WebSocket connection:', error);
      this.emit('error', error);
    }
  }

  handleMessage(event) {
    try {
      const msg = JSON.parse(event.data);
      this.emit('message', msg);

      if (msg.type === 'result' && this.pendingWs.has(msg.id)) {
        const pending = this.pendingWs.get(msg.id);
        this.pendingWs.delete(msg.id);
        pending.resolve(msg);
      }
    } catch (error) {
      console.error('Error processing WebSocket message:', error);
    }
  }

  request(payload) {
    return new Promise((resolve, reject) => {
      try {
        if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
          return reject(new Error('WebSocket not connected'));
        }
        const id = this.wsId++;
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
            reject(new Error('WebSocket request timeout'));
          }
        }, 15000);
      } catch (error) {
        console.error('Error making WebSocket request:', error);
        reject(error);
      }
    });
  }

  close() {
    try {
      if (this.ws) {
        this.ws.close();
        this.ws = null;
      }
    } catch (error) {
      console.error('Error closing WebSocket:', error);
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
      console.error('Error calling service:', error);
      return Promise.reject(error);
    }
  }
}

module.exports = new WebSocketManager();

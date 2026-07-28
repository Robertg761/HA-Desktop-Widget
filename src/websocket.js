import { EventEmitter } from 'events';
import log from './logger.js';
import state from './state.js';
import { WS_REQUEST_TIMEOUT_MS, WS_INITIAL_ID } from './constants.js';

function getWebSocketErrorMessage(event) {
  const explicitMessage =
    (typeof event?.message === 'string' && event.message.trim()) ||
    (typeof event?.error?.message === 'string' && event.error.message.trim()) ||
    (typeof event?.reason === 'string' && event.reason.trim());

  if (explicitMessage) return explicitMessage;

  const readyState = event?.target?.readyState;
  if (readyState === WebSocket.CONNECTING) {
    return 'Could not establish WebSocket connection';
  }

  return 'WebSocket connection failed';
}

function getDesktopPinServiceProxyContext(serviceData = {}) {
  if (typeof window === 'undefined') return null;
  if (!window?.electronAPI?.requestDesktopPinAction) return null;

  const params = new URLSearchParams(window.location?.search || '');
  if (params.get('mode') !== 'desktop-pin') return null;

  const requestedEntityId =
    typeof serviceData?.entity_id === 'string' ? serviceData.entity_id.trim() : '';
  const fallbackEntityId = (params.get('entityId') || '').trim();
  const entityId = requestedEntityId || fallbackEntityId;

  if (!entityId) return null;
  return { entityId };
}

function throwForFailedServiceResponse(response, fallbackMessage) {
  if (response && response.success === false) {
    const details = response.error || {};
    const message = details.message || fallbackMessage;
    const serviceError = new Error(message);
    if (details.code) serviceError.code = details.code;
    serviceError.details = details;
    throw serviceError;
  }

  return response;
}

class WebSocketManager extends EventEmitter {
  constructor() {
    super();
    this.ws = null;
    this.wsId = WS_INITIAL_ID;
    this.pendingWs = new Map();
    this.messageSubscriptions = new Map();
    this.messageSubscriptionHandlers = new Map();
    this.nextMessageSubscriptionKey = 1;
    this.isAuthenticated = false;
  }

  clearPendingRequest(id) {
    const pending = this.pendingWs.get(id);
    if (!pending) return null;
    this.pendingWs.delete(id);
    if (pending.timeoutId != null) {
      clearTimeout(pending.timeoutId);
    }
    return pending;
  }

  rejectPendingRequestsForSocket(socket, error = new Error('WebSocket connection closed')) {
    this.pendingWs.forEach((pending, id) => {
      if (pending.socket !== socket) return;
      this.clearPendingRequest(id)?.reject(error);
    });
  }

  resetMessageSubscriptionState() {
    this.messageSubscriptionHandlers.clear();
    this.messageSubscriptions.forEach((subscription) => {
      subscription.subscriptionId = null;
      subscription.subscribeRequestId = null;
    });
  }

  connect() {
    log.debug('Attempting to connect to Home Assistant WebSocket');
    this.emit('connect-attempt');
    if (
      !state.CONFIG ||
      !state.CONFIG.homeAssistant ||
      !state.CONFIG.homeAssistant.url ||
      !state.CONFIG.homeAssistant.token
    ) {
      log.error('Invalid configuration for WebSocket');
      this.emit('status', false);
      this.emit('error', new Error('Invalid configuration. Please check settings.'));
      this.emit('showLoading', false);
      return;
    }

    if (state.CONFIG.homeAssistant.token === 'YOUR_LONG_LIVED_ACCESS_TOKEN') {
      log.error('Configuration contains default token');
      this.emit('status', false);
      this.emit(
        'error',
        new Error('Configuration contains default token. Please update settings.')
      );
      this.emit('showLoading', false);
      return;
    }

    if (this.ws) {
      // Mark existing socket as intentional close before replacing it.
      const previousWs = this.ws;
      previousWs.__intentionalClose = true;
      this.rejectPendingRequestsForSocket(previousWs, new Error('WebSocket connection replaced'));
      this.resetMessageSubscriptionState();
      try {
        previousWs.close();
      } catch (error) {
        log.warn('Failed to close superseded WebSocket connection:', error);
        if (this.ws === previousWs) {
          this.ws = null;
        }
      }
    }

    try {
      const haUrl = state.CONFIG.homeAssistant.url.trim().replace(/\/+$/, '');
      const wsUrl = haUrl.replace(/^http/, 'ws') + '/api/websocket';
      log.debug(`Connecting to WebSocket URL: ${wsUrl}`);
      const ws = new WebSocket(wsUrl);
      ws.__intentionalClose = false;
      this.ws = ws;
      this.isAuthenticated = false;

      ws.onopen = () => {
        if (this.ws !== ws) return;
        log.debug('WebSocket connection established');
        this.emit('open');
      };

      ws.onmessage = (event) => {
        if (this.ws !== ws) return;
        this.handleMessage(event, ws);
      };

      ws.onerror = (event) => {
        if (this.ws !== ws) return;
        const message = getWebSocketErrorMessage(event);
        log.error('WebSocket error:', message);
        this.emit('error', new Error(message));
      };

      ws.onclose = (_event) => {
        const intentional = ws.__intentionalClose === true;
        this.rejectPendingRequestsForSocket(ws);
        if (this.ws !== ws) {
          log.debug('Ignoring close event from superseded WebSocket connection');
          return;
        }
        this.ws = null;
        this.isAuthenticated = false;
        this.resetMessageSubscriptionState();
        log.debug('WebSocket connection closed');
        this.emit('close', { intentional });
      };
    } catch (error) {
      log.error('Failed to create WebSocket connection:', error);
      this.emit('error', error);
    }
  }

  handleMessage(event, sourceSocket = this.ws) {
    if (!sourceSocket || sourceSocket !== this.ws) return;
    try {
      const msg = JSON.parse(event.data);
      // Respond to HA application-level heartbeat to keep the connection alive
      if (msg && msg.type === 'ping' && sourceSocket.readyState === WebSocket.OPEN) {
        try {
          sourceSocket.send(JSON.stringify({ type: 'pong' }));
        } catch (e) {
          log.warn('Failed to send pong to Home Assistant:', e);
        }
        return; // don't emit ping to consumers
      }
      if (msg.type === 'auth_ok') {
        this.isAuthenticated = true;
      } else if (msg.type === 'auth_invalid') {
        this.isAuthenticated = false;
      }
      this.emit('message', msg);

      if (msg.type === 'result' && this.pendingWs.has(msg.id)) {
        const pending = this.pendingWs.get(msg.id);
        if (pending.socket === sourceSocket) {
          this.clearPendingRequest(msg.id)?.resolve(msg);
        }
      }
      if (msg.type === 'event' && this.messageSubscriptionHandlers.has(msg.id)) {
        const subscription = this.messageSubscriptionHandlers.get(msg.id);
        try {
          subscription.onEvent(msg.event, msg);
        } catch (callbackError) {
          log.error('Error handling WebSocket subscription event:', callbackError);
        }
      }
      if (msg.type === 'auth_ok') {
        this.resubscribeMessages();
      }
    } catch (error) {
      log.error('Error processing WebSocket message:', error);
    }
  }

  /**
   * Whether the socket is open and authenticated, i.e. whether request() can succeed.
   * Callers that fire optional requests during startup can use this to skip a request that would
   * only be rejected, instead of logging an error for a perfectly normal not-connected-yet state.
   *
   * @returns {boolean}
   */
  isConnected() {
    return !!this.ws && this.ws.readyState === WebSocket.OPEN && !!this.isAuthenticated;
  }

  request(payload) {
    const id = this.wsId++;
    const promise = new Promise((resolve, reject) => {
      try {
        const socket = this.ws;
        if (!socket || socket.readyState !== WebSocket.OPEN) {
          return reject(new Error('WebSocket not connected'));
        }
        const msg = { id, ...payload };
        const pending = {
          resolve,
          reject,
          socket,
          timeoutId: null,
        };
        this.pendingWs.set(id, pending);
        pending.timeoutId = setTimeout(() => {
          const timedOut = this.clearPendingRequest(id);
          if (!timedOut) return;
          // Reject without emitting a global error to avoid log spam for optional calls
          timedOut.reject(new Error('WebSocket request timeout'));
        }, WS_REQUEST_TIMEOUT_MS);
        try {
          socket.send(JSON.stringify(msg));
        } catch (e) {
          this.clearPendingRequest(id);
          return reject(e);
        }
      } catch (error) {
        log.error('Error making WebSocket request:', error);
        reject(error);
      }
    });
    // Attach the ID to the promise for tracking
    promise.id = id;
    return promise;
  }

  sendMessageSubscription(subscription) {
    if (!subscription?.active) return;
    if (subscription.subscriptionId || subscription.subscribeRequestId) return;
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN || !this.isAuthenticated) return;

    const requestPromise = this.request(subscription.payload);
    subscription.subscribeRequestId = requestPromise.id;
    requestPromise
      .then((response) => {
        if (subscription.subscribeRequestId !== response.id) return;
        subscription.subscribeRequestId = null;
        if (!response.success) {
          log.warn('WebSocket subscription request was not successful:', response);
          return;
        }

        if (!subscription.active) {
          this.sendMessageUnsubscribe(response.id);
          return;
        }

        subscription.subscriptionId = response.id;
        this.messageSubscriptionHandlers.set(response.id, subscription);
      })
      .catch((error) => {
        if (subscription.subscribeRequestId === requestPromise.id) {
          subscription.subscribeRequestId = null;
        }
        if (subscription.active) {
          log.warn('WebSocket subscription request failed:', error);
        }
      });
  }

  sendMessageUnsubscribe(subscriptionId) {
    if (!subscriptionId) return;
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN || !this.isAuthenticated) return;
    this.request({
      type: 'unsubscribe_events',
      subscription: subscriptionId,
    }).catch((error) => {
      log.warn('WebSocket unsubscribe request failed:', error);
    });
  }

  resubscribeMessages() {
    this.messageSubscriptions.forEach((subscription) => {
      if (!subscription.active) return;
      this.sendMessageSubscription(subscription);
    });
  }

  subscribeMessage(payload, onEvent) {
    if (!payload || typeof payload.type !== 'string') {
      throw new Error('WebSocket subscription payload requires a type');
    }
    if (typeof onEvent !== 'function') {
      throw new Error('WebSocket subscription requires an event handler');
    }

    const key = this.nextMessageSubscriptionKey++;
    const subscription = {
      key,
      payload: { ...payload },
      onEvent,
      subscriptionId: null,
      subscribeRequestId: null,
      active: true,
    };
    this.messageSubscriptions.set(key, subscription);
    this.sendMessageSubscription(subscription);

    return () => {
      const current = this.messageSubscriptions.get(key);
      if (!current) return;

      current.active = false;
      this.messageSubscriptions.delete(key);

      if (current.subscriptionId) {
        this.messageSubscriptionHandlers.delete(current.subscriptionId);
        this.sendMessageUnsubscribe(current.subscriptionId);
      }
      current.subscriptionId = null;
      // Keep an in-flight subscribe request identifiable until it settles. Its
      // success handler will see active=false and immediately unsubscribe the
      // server-side subscription instead of leaking it for this socket's life.
      // Socket resets still clear the ID because their pending request is rejected.
    };
  }

  close() {
    const closingWs = this.ws;
    if (closingWs) {
      closingWs.__intentionalClose = true;
      this.rejectPendingRequestsForSocket(closingWs);
      try {
        closingWs.close();
      } catch (error) {
        log.error('Error closing WebSocket:', error);
      }
      if (this.ws === closingWs) {
        this.ws = null;
      }
    }
    this.isAuthenticated = false;
    this.resetMessageSubscriptionState();
  }

  callService(domain, service, serviceData, options = {}) {
    try {
      const shouldReturnResponse = options?.returnResponse === true;
      const proxyContext = getDesktopPinServiceProxyContext(serviceData);
      if ((!this.ws || this.ws.readyState !== WebSocket.OPEN) && proxyContext) {
        const proxiedPromise = window.electronAPI
          .requestDesktopPinAction(proxyContext.entityId, 'service-call', {
            domain,
            service,
            serviceData: serviceData || {},
            ...(shouldReturnResponse ? { returnResponse: true } : {}),
          })
          .then((response) => {
            if (
              response &&
              response.forwarded === true &&
              response.success !== false &&
              !Object.prototype.hasOwnProperty.call(response, 'result')
            ) {
              throw new Error(`${domain}.${service} was forwarded without a service result`);
            }
            const checkedResponse = throwForFailedServiceResponse(
              response,
              `${domain}.${service} failed`
            );
            if (!shouldReturnResponse) return checkedResponse;
            return (
              checkedResponse?.result?.response ??
              checkedResponse?.response ??
              checkedResponse?.result ??
              checkedResponse
            );
          });
        proxiedPromise.id = null;
        return proxiedPromise;
      }

      const payload = {
        type: 'call_service',
        domain,
        service,
        service_data: serviceData,
      };
      if (shouldReturnResponse) payload.return_response = true;

      const requestPromise = this.request(payload);

      const servicePromise = requestPromise.then((response) => {
        const checkedResponse = throwForFailedServiceResponse(
          response,
          `${domain}.${service} failed`
        );
        if (!shouldReturnResponse) return checkedResponse;
        return (
          checkedResponse?.result?.response ??
          checkedResponse?.response ??
          checkedResponse?.result ??
          checkedResponse
        );
      });

      // Preserve request ID for tests and callers that correlate responses
      servicePromise.id = requestPromise.id;
      return servicePromise;
    } catch (error) {
      log.error('Error calling service:', error);
      return Promise.reject(error);
    }
  }

  callServiceWithResponse(domain, service, serviceData) {
    return this.callService(domain, service, serviceData, { returnResponse: true });
  }
}

// Create singleton instance
const websocket = new WebSocketManager();
export default websocket;

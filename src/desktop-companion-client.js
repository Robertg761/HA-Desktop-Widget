import log from './logger.js';

const PROTOCOL_VERSION = 1;
const HEARTBEAT_INTERVAL_MS = 60 * 1000;
const MAX_COMMAND_HISTORY = 100;
const ALLOWED_ACTIONS = new Set(['show', 'hide', 'toggle', 'switch_page']);

function boundedString(value, maximum = 128) {
  return typeof value === 'string' ? value.trim().slice(0, maximum) : '';
}

function normalizeState(value) {
  const state = {};
  if (typeof value?.visible === 'boolean') state.visible = value.visible;
  const currentPage = boundedString(value?.current_page ?? value?.currentPage);
  if (currentPage) state.current_page = currentPage;
  return state;
}

function assertSuccessfulResponse(response, fallbackMessage) {
  if (response?.success === false) {
    const error = new Error(response?.error?.message || fallbackMessage);
    error.code = response?.error?.code || 'desktop_companion_request_failed';
    throw error;
  }
  return response?.result;
}

class DesktopCompanionClient {
  constructor({
    websocket,
    getRegistration,
    getState,
    executeCommand,
    heartbeatIntervalMs = HEARTBEAT_INTERVAL_MS,
    logger = log,
  }) {
    this.websocket = websocket;
    this.getRegistration = getRegistration;
    this.getState = getState;
    this.executeCommand = executeCommand;
    this.heartbeatIntervalMs = heartbeatIntervalMs;
    this.log = logger;
    this.started = false;
    this.generation = 0;
    this.unsubscribeCommands = null;
    this.heartbeatTimer = null;
    this.commandResults = new Map();
    this._handleSocketMessage = (message) => {
      if (message?.type === 'auth_ok') void this.initializeSession();
      if (message?.type === 'auth_invalid') this.resetSession();
    };
    this._handleSocketClose = () => this.resetSession();
  }

  start() {
    if (this.started) return;
    this.started = true;
    this.websocket.on('message', this._handleSocketMessage);
    this.websocket.on('close', this._handleSocketClose);
    if (this.websocket.isConnected?.()) void this.initializeSession();
  }

  stop() {
    if (!this.started) return;
    this.started = false;
    this.websocket.removeListener('message', this._handleSocketMessage);
    this.websocket.removeListener('close', this._handleSocketClose);
    this.resetSession();
  }

  resetSession() {
    this.generation += 1;
    if (this.unsubscribeCommands) {
      this.unsubscribeCommands();
      this.unsubscribeCommands = null;
    }
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }

  async initializeSession() {
    if (!this.started || !this.websocket.isConnected?.()) return false;
    const generation = ++this.generation;
    if (this.unsubscribeCommands) {
      this.unsubscribeCommands();
      this.unsubscribeCommands = null;
    }
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }

    try {
      const registration = await this.getRegistration();
      if (!registration?.desktop_id) return false;

      const infoResult = assertSuccessfulResponse(
        await this.websocket.request({ type: 'ha_desktop_widget/get_info' }),
        'HA Desktop Widget integration is unavailable'
      );
      if (Number(infoResult?.protocol_version) !== PROTOCOL_VERSION) {
        throw new Error(
          `Unsupported HA Desktop Widget protocol ${infoResult?.protocol_version ?? 'unknown'}`
        );
      }

      assertSuccessfulResponse(
        await this.websocket.request({
          type: 'ha_desktop_widget/register_device',
          ...registration,
          protocol_version: PROTOCOL_VERSION,
        }),
        'Desktop registration failed'
      );
      if (!this.started || generation !== this.generation) return false;

      this.unsubscribeCommands = this.websocket.subscribeMessage(
        {
          type: 'ha_desktop_widget/subscribe_commands',
          desktop_id: registration.desktop_id,
        },
        (command) => void this.handleCommand(registration.desktop_id, command)
      );
      await this.reportState(registration.desktop_id);
      this.heartbeatTimer = setInterval(() => {
        void this.reportState(registration.desktop_id);
      }, this.heartbeatIntervalMs);
      this.log.info('Registered this desktop with HA Desktop Widget Companion');
      return true;
    } catch (error) {
      if (this.started && generation === this.generation) {
        this.log.warn('HA Desktop Widget Companion session failed:', error?.message || error);
      }
      return false;
    }
  }

  async reportState(desktopId = null, explicitState = null) {
    if (!this.started || !this.websocket.isConnected?.()) return false;
    const registration = desktopId ? null : await this.getRegistration();
    const resolvedDesktopId = boundedString(desktopId || registration?.desktop_id);
    if (!resolvedDesktopId) return false;
    try {
      const state = normalizeState(explicitState || (await this.getState()));
      assertSuccessfulResponse(
        await this.websocket.request({
          type: 'ha_desktop_widget/report_state',
          desktop_id: resolvedDesktopId,
          state,
        }),
        'Desktop state report failed'
      );
      return true;
    } catch (error) {
      this.log.warn('Failed to report desktop companion state:', error?.message || error);
      return false;
    }
  }

  rememberCommandResult(commandId, result) {
    this.commandResults.set(commandId, result);
    while (this.commandResults.size > MAX_COMMAND_HISTORY) {
      this.commandResults.delete(this.commandResults.keys().next().value);
    }
  }

  async acknowledge(desktopId, commandId, result) {
    const payload = {
      type: 'ha_desktop_widget/ack_command',
      desktop_id: desktopId,
      command_id: commandId,
      status: result.status,
    };
    if (result.error) payload.error = boundedString(result.error, 512);
    if (result.state) payload.state = normalizeState(result.state);
    try {
      assertSuccessfulResponse(
        await this.websocket.request(payload),
        'Desktop command acknowledgement failed'
      );
    } catch (error) {
      this.log.warn('Failed to acknowledge desktop companion command:', error?.message || error);
    }
  }

  async handleCommand(desktopId, command) {
    const commandId = boundedString(command?.command_id, 64);
    const action = boundedString(command?.action, 64);
    if (!commandId) return;

    const previousResult = this.commandResults.get(commandId);
    if (previousResult) {
      await this.acknowledge(desktopId, commandId, previousResult);
      return;
    }

    let result;
    const expiresAt = Date.parse(command?.expires_at || '');
    if (!Number.isFinite(expiresAt) || expiresAt <= Date.now()) {
      result = { status: 'failed', error: 'Command expired before it reached the desktop' };
    } else if (Number(command?.protocol_version) !== PROTOCOL_VERSION) {
      result = { status: 'failed', error: 'Unsupported desktop command protocol' };
    } else if (!ALLOWED_ACTIONS.has(action)) {
      result = { status: 'failed', error: 'Unsupported desktop command action' };
    } else {
      try {
        const state = normalizeState(
          await this.executeCommand({ action, payload: command?.payload || {} })
        );
        result = { status: 'completed', state };
      } catch (error) {
        result = {
          status: 'failed',
          error: boundedString(error?.message || 'Desktop command failed', 512),
        };
      }
    }

    this.rememberCommandResult(commandId, result);
    await this.acknowledge(desktopId, commandId, result);
  }
}

export {
  ALLOWED_ACTIONS,
  DesktopCompanionClient,
  HEARTBEAT_INTERVAL_MS,
  PROTOCOL_VERSION,
  normalizeState,
};

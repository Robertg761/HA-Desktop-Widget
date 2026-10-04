import log from './logger.js';

const PROTOCOL_VERSION = 1;
const HEARTBEAT_INTERVAL_MS = 60 * 1000;
const MAX_COMMAND_HISTORY = 100;
// A command carries the time Home Assistant gave it up at, and this computer reads its own clock
// against it. A clock that runs ahead (an unsynchronised VM, a dual-boot RTC offset) would refuse
// every command, so a command is still run this long after its time. A command that waited
// minutes for a desktop that was offline is still left out. The price is that a show, hide or
// apply_profile Home Assistant already gave up on can still run for these two minutes.
const COMMAND_CLOCK_SKEW_MS = 2 * 60 * 1000;
const ALLOWED_ACTIONS = new Set(['show', 'hide', 'toggle', 'switch_page', 'apply_profile']);
const SESSION_ENDED_RESULT = Object.freeze({
  status: 'failed',
  error: 'Companion session ended before command execution',
});

function boundedString(value, maximum = 128) {
  return typeof value === 'string' ? value.trim().slice(0, maximum) : '';
}

function normalizeState(value) {
  const state = {};
  if (typeof value?.visible === 'boolean') state.visible = value.visible;
  const currentPage = boundedString(value?.current_page ?? value?.currentPage);
  if (currentPage) state.current_page = currentPage;
  const activeProfileId = boundedString(value?.active_profile_id ?? value?.activeProfileId, 64);
  if (activeProfileId) state.active_profile_id = activeProfileId;
  const profileRevision = Number(value?.profile_revision ?? value?.profileRevision);
  if (Number.isInteger(profileRevision) && profileRevision >= 0) {
    state.profile_revision = profileRevision;
  }
  for (const key of ['window_width', 'window_height']) {
    const size = Number(value?.[key]);
    if (Number.isInteger(size) && size >= 100 && size <= 10000) state[key] = size;
  }
  return state;
}

// Home Assistant answers commands from an integration that is not installed with unknown_command.
function isUnknownCommand(error) {
  return error?.code === 'unknown_command';
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
    getConfigDocument = null,
    executeCommand,
    heartbeatIntervalMs = HEARTBEAT_INTERVAL_MS,
    logger = log,
  }) {
    this.websocket = websocket;
    this.getRegistration = getRegistration;
    this.getState = getState;
    this.getConfigDocument = getConfigDocument;
    this.lastConfigSnapshot = null;
    this.executeCommand = executeCommand;
    this.heartbeatIntervalMs = heartbeatIntervalMs;
    this.log = logger;
    this.started = false;
    // Set when Home Assistant does not know the companion commands; cleared on each new session so
    // an integration installed or updated in the meantime is picked up after a reconnect.
    this.integrationMissing = false;
    this.snapshotUnsupported = false;
    this.generation = 0;
    this.unsubscribeCommands = null;
    this.heartbeatTimer = null;
    this.commandResults = new Map();
    this.pendingCommands = new Map();
    this.commandQueue = Promise.resolve();
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
    // Commands still waiting for their turn belong to the ended session. Forget them so a
    // redelivery in the next session runs fresh; the queue tail stays so a command that is
    // already executing still finishes before the next session's commands start.
    this.pendingCommands.clear();
    this.lastConfigSnapshot = null;
    if (this.unsubscribeCommands) {
      this.unsubscribeCommands();
      this.unsubscribeCommands = null;
    }
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }

  isCurrentSession(generation) {
    return this.started && generation === this.generation && this.websocket.isConnected?.();
  }

  // Without the optional integration every report is refused. Say so once, then stop asking.
  noteIntegrationMissing() {
    if (this.integrationMissing) return;
    this.integrationMissing = true;
    this.log.info(
      'HA Desktop Widget Companion integration is not installed in Home Assistant; companion updates are off for this connection.'
    );
  }

  async initializeSession() {
    if (!this.started || !this.websocket.isConnected?.()) return false;
    const generation = ++this.generation;
    // A replacement socket can authenticate without a close event, so this is also a new session.
    this.pendingCommands.clear();
    this.lastConfigSnapshot = null;
    this.integrationMissing = false;
    this.snapshotUnsupported = false;
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
      if (!this.isCurrentSession(generation) || !registration?.desktop_id) return false;

      const infoResult = assertSuccessfulResponse(
        await this.websocket.request({ type: 'ha_desktop_widget/get_info' }),
        'HA Desktop Widget integration is unavailable'
      );
      if (!this.isCurrentSession(generation)) return false;
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
      if (!this.isCurrentSession(generation)) return false;

      this.unsubscribeCommands = this.websocket.subscribeMessage(
        {
          type: 'ha_desktop_widget/subscribe_commands',
          desktop_id: registration.desktop_id,
        },
        (command) =>
          this.isCurrentSession(generation)
            ? this.handleCommand(registration.desktop_id, command)
            : Promise.resolve()
      );
      await this.reportState(registration.desktop_id);
      if (!this.isCurrentSession(generation)) return false;
      await this.reportConfigSnapshot(registration.desktop_id);
      if (!this.isCurrentSession(generation)) return false;
      this.heartbeatTimer = setInterval(() => {
        void this.reportState(registration.desktop_id);
        void this.reportConfigSnapshot(registration.desktop_id);
      }, this.heartbeatIntervalMs);
      this.log.info('Registered this desktop with HA Desktop Widget Companion');
      return true;
    } catch (error) {
      if (this.started && generation === this.generation) {
        if (isUnknownCommand(error)) this.noteIntegrationMissing();
        else this.log.warn('HA Desktop Widget Companion session failed:', error?.message || error);
      }
      return false;
    }
  }

  async reportState(desktopId = null, explicitState = null) {
    if (!this.started || this.integrationMissing || !this.websocket.isConnected?.()) return false;
    const generation = this.generation;
    const registration = desktopId ? null : await this.getRegistration();
    const resolvedDesktopId = boundedString(desktopId || registration?.desktop_id);
    if (!this.isCurrentSession(generation) || !resolvedDesktopId) return false;
    try {
      const state = normalizeState(explicitState || (await this.getState()));
      if (!this.isCurrentSession(generation)) return false;
      assertSuccessfulResponse(
        await this.websocket.request({
          type: 'ha_desktop_widget/report_state',
          desktop_id: resolvedDesktopId,
          state,
        }),
        'Desktop state report failed'
      );
      return this.isCurrentSession(generation);
    } catch (error) {
      if (!this.isCurrentSession(generation)) return false;
      if (isUnknownCommand(error)) this.noteIntegrationMissing();
      else this.log.warn('Failed to report desktop companion state:', error?.message || error);
      return false;
    }
  }

  async reportConfigSnapshot(desktopId = null) {
    if (!this.started || this.integrationMissing || this.snapshotUnsupported) return false;
    if (!this.websocket.isConnected?.()) return false;
    if (typeof this.getConfigDocument !== 'function') return false;
    const generation = this.generation;
    const registration = desktopId ? null : await this.getRegistration();
    const resolvedDesktopId = boundedString(desktopId || registration?.desktop_id);
    if (!this.isCurrentSession(generation) || !resolvedDesktopId) return false;
    try {
      const document = await this.getConfigDocument();
      if (!this.isCurrentSession(generation) || !document || typeof document !== 'object')
        return false;
      const serialized = JSON.stringify(document);
      if (serialized === this.lastConfigSnapshot) return true;
      assertSuccessfulResponse(
        await this.websocket.request({
          type: 'ha_desktop_widget/put_config_snapshot',
          desktop_id: resolvedDesktopId,
          document,
        }),
        'Desktop layout snapshot failed'
      );
      if (!this.isCurrentSession(generation)) return false;
      this.lastConfigSnapshot = serialized;
      return true;
    } catch (error) {
      if (!this.isCurrentSession(generation)) return false;
      // Older companion integrations do not know this command; stay quiet after the first
      // refusal instead of warning on every heartbeat and layout change.
      if (isUnknownCommand(error)) {
        this.snapshotUnsupported = true;
        this.log.info('The HA Desktop Widget Companion integration does not store layouts.');
        return false;
      }
      this.lastConfigSnapshot = 'unsupported';
      this.log.warn('Desktop layout snapshot was not accepted:', error?.message || error);
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
    if (!commandId) return;
    const key = JSON.stringify([desktopId, commandId]);
    const generation = this.generation;
    const previousResult = this.commandResults.get(key);
    if (previousResult) {
      await this.acknowledge(desktopId, commandId, previousResult);
      return;
    }

    let pending = this.pendingCommands.get(key);
    if (!pending) {
      // Serialize distinct commands so page/profile/visibility changes retain delivery order.
      // The result is cached inside the chain, before the queue advances, so a redelivery queued
      // behind a command that was already running when its session ended reuses that result.
      pending = this.commandQueue.then(async () => {
        if (generation !== this.generation) return SESSION_ENDED_RESULT;
        const cached = this.commandResults.get(key);
        if (cached) return cached;
        const executed = await this.executeReceivedCommand(command);
        this.rememberCommandResult(key, executed);
        return executed;
      });
      this.pendingCommands.set(key, pending);
      this.commandQueue = pending.then(
        () => undefined,
        () => undefined
      );
    }
    const result = await pending;
    if (this.pendingCommands.get(key) === pending) this.pendingCommands.delete(key);
    if (generation === this.generation) await this.acknowledge(desktopId, commandId, result);
  }

  async executeReceivedCommand(command) {
    const action = boundedString(command?.action, 64);

    let result;
    const expiresAt = Date.parse(command?.expires_at || '');
    if (!Number.isFinite(expiresAt) || expiresAt + COMMAND_CLOCK_SKEW_MS <= Date.now()) {
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

    return result;
  }
}

export {
  ALLOWED_ACTIONS,
  COMMAND_CLOCK_SKEW_MS,
  DesktopCompanionClient,
  HEARTBEAT_INTERVAL_MS,
  PROTOCOL_VERSION,
  normalizeState,
};

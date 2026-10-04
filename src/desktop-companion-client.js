import log from './logger.js';

const PROTOCOL_VERSION = 1;
const HEARTBEAT_INTERVAL_MS = 60 * 1000;
// A session that fails to start is tried again after these waits, the last one repeating. Home
// Assistant answers unknown_command for a while after a restart, before a custom integration has
// registered its commands, and without a retry the desktop stayed unregistered until the socket
// dropped again.
const SESSION_RETRY_DELAYS_MS = Object.freeze([15 * 1000, 60 * 1000, 5 * 60 * 1000]);
// Most people never install the integration, and for them Home Assistant answers unknown_command
// however long it waits. Once the waits above have run out, such a session is looked at this
// rarely: it only has to catch an integration installed while the app runs.
const INTEGRATION_MISSING_RETRY_MS = 30 * 60 * 1000;
// After Home Assistant refuses a layout, the next try waits this long, doubling, up to the cap.
const SNAPSHOT_REJECTION_BACKOFF_MS = 2 * 60 * 1000;
const SNAPSHOT_REJECTION_MAX_BACKOFF_MS = 30 * 60 * 1000;
const MAX_COMMAND_HISTORY = 100;
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
    sessionRetryDelaysMs = SESSION_RETRY_DELAYS_MS,
    integrationMissingRetryMs = INTEGRATION_MISSING_RETRY_MS,
    logger = log,
  }) {
    this.websocket = websocket;
    this.getRegistration = getRegistration;
    this.getState = getState;
    this.getConfigDocument = getConfigDocument;
    this.lastConfigSnapshot = null;
    this.executeCommand = executeCommand;
    this.heartbeatIntervalMs = heartbeatIntervalMs;
    this.sessionRetryDelaysMs = sessionRetryDelaysMs;
    this.integrationMissingRetryMs = integrationMissingRetryMs;
    this.log = logger;
    this.started = false;
    // Set when Home Assistant does not know the companion commands; cleared on each new session so
    // an integration installed or updated in the meantime is picked up after a reconnect.
    this.integrationMissing = false;
    // Said once per connection: a session retried every few minutes would repeat it.
    this.integrationMissingLogged = false;
    this.snapshotUnsupported = false;
    // The layout Home Assistant refused, so it is not uploaded again every heartbeat while it is
    // unchanged, and how many refusals in a row there were.
    this.rejectedConfigSnapshot = null;
    this.snapshotRejections = 0;
    this.snapshotRetryAt = 0;
    this.sessionRetryTimer = null;
    this.sessionRetryAttempt = 0;
    this.lastSessionFailure = '';
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
    this.clearSessionRetry();
    this.sessionRetryAttempt = 0;
    this.integrationMissingLogged = false;
    this.lastSessionFailure = '';
    if (this.unsubscribeCommands) {
      this.unsubscribeCommands();
      this.unsubscribeCommands = null;
    }
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }

  clearSessionRetry() {
    if (this.sessionRetryTimer) {
      clearTimeout(this.sessionRetryTimer);
      this.sessionRetryTimer = null;
    }
  }

  // Tries the session again after a wait that grows to a few minutes. Tied to the session that
  // failed: a socket that closed or authenticated again in the meantime starts its own.
  scheduleSessionRetry(generation, { integrationMissing = false } = {}) {
    if (!this.started || generation !== this.generation) return;
    this.clearSessionRetry();
    const delays = this.sessionRetryDelaysMs;
    // The integration may still be loading, so it gets the same short waits as any other failure
    // first; a session that stays "unknown command" past them is retried far less often.
    const delay =
      integrationMissing && this.sessionRetryAttempt >= delays.length
        ? this.integrationMissingRetryMs
        : delays[Math.min(this.sessionRetryAttempt, delays.length - 1)];
    this.sessionRetryAttempt += 1;
    this.sessionRetryTimer = setTimeout(() => {
      this.sessionRetryTimer = null;
      if (generation === this.generation) void this.initializeSession({ retry: true });
    }, delay);
  }

  isCurrentSession(generation) {
    return this.started && generation === this.generation && this.websocket.isConnected?.();
  }

  // Without the optional integration every report is refused. Say so once, then stop asking.
  noteIntegrationMissing() {
    this.integrationMissing = true;
    if (this.integrationMissingLogged) return;
    this.integrationMissingLogged = true;
    this.log.info(
      'HA Desktop Widget Companion integration is not installed in Home Assistant; companion updates are off for this connection.'
    );
  }

  async initializeSession({ retry = false } = {}) {
    if (!this.started || !this.websocket.isConnected?.()) return false;
    const generation = ++this.generation;
    this.clearSessionRetry();
    if (!retry) {
      // A connection of its own, not a retry of one that failed: start the waits and the
      // once-per-connection notices over.
      this.sessionRetryAttempt = 0;
      this.integrationMissingLogged = false;
      this.lastSessionFailure = '';
    }
    // A replacement socket can authenticate without a close event, so this is also a new session.
    this.pendingCommands.clear();
    this.lastConfigSnapshot = null;
    this.rejectedConfigSnapshot = null;
    this.snapshotRejections = 0;
    this.snapshotRetryAt = 0;
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
        // Home Assistant stopped knowing the commands mid-session (the integration was reloaded):
        // register again rather than staying silent until the socket drops.
        if (this.integrationMissing) {
          void this.initializeSession({ retry: true });
          return;
        }
        void this.reportState(registration.desktop_id);
        void this.reportConfigSnapshot(registration.desktop_id);
      }, this.heartbeatIntervalMs);
      this.sessionRetryAttempt = 0;
      this.lastSessionFailure = '';
      this.log.info('Registered this desktop with HA Desktop Widget Companion');
      return true;
    } catch (error) {
      if (this.started && generation === this.generation) {
        const integrationMissing = isUnknownCommand(error);
        if (integrationMissing) {
          this.noteIntegrationMissing();
        } else {
          // The same refusal on every retry would fill the log; say it again only if it changes.
          const reason = String(error?.message || error);
          if (reason !== this.lastSessionFailure) {
            this.log.warn('HA Desktop Widget Companion session failed:', reason);
          }
          this.lastSessionFailure = reason;
        }
        this.scheduleSessionRetry(generation, { integrationMissing });
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
    let serialized = null;
    try {
      const document = await this.getConfigDocument();
      if (!this.isCurrentSession(generation) || !document || typeof document !== 'object')
        return false;
      serialized = JSON.stringify(document);
      if (serialized === this.lastConfigSnapshot) return true;
      // Home Assistant refused exactly this layout (too large, or a schema it does not accept), and
      // sending it again could not change the answer. A changed layout is tried again, but not
      // before the wait after the last refusal is over.
      if (serialized === this.rejectedConfigSnapshot) return false;
      if (this.snapshotRejections > 0 && Date.now() < this.snapshotRetryAt) return false;
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
      this.rejectedConfigSnapshot = null;
      this.snapshotRejections = 0;
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
      this.snapshotRejections += 1;
      this.snapshotRetryAt =
        Date.now() +
        Math.min(
          SNAPSHOT_REJECTION_BACKOFF_MS * 2 ** (this.snapshotRejections - 1),
          SNAPSHOT_REJECTION_MAX_BACKOFF_MS
        );
      this.rejectedConfigSnapshot = serialized;
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

    return result;
  }
}

export {
  ALLOWED_ACTIONS,
  DesktopCompanionClient,
  HEARTBEAT_INTERVAL_MS,
  PROTOCOL_VERSION,
  normalizeState,
};

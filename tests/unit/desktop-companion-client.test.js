/**
 * @jest-environment jsdom
 */

const EventEmitter = require('events');

const mockLogger = {
  debug: jest.fn(),
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
};
jest.mock('../../src/logger', () => mockLogger);

const { DesktopCompanionClient, PROTOCOL_VERSION } = require('../../src/desktop-companion-client');

class FakeWebSocket extends EventEmitter {
  constructor() {
    super();
    this.connected = true;
    this.requests = [];
    this.commandHandler = null;
    this.unsubscribe = jest.fn();
  }

  isConnected() {
    return this.connected;
  }

  async request(message) {
    this.requests.push(message);
    if (message.type === 'ha_desktop_widget/get_info') {
      return { success: true, result: { protocol_version: PROTOCOL_VERSION } };
    }
    return { success: true, result: {} };
  }

  subscribeMessage(message, handler) {
    this.requests.push(message);
    this.commandHandler = handler;
    return this.unsubscribe;
  }
}

function createClient(overrides = {}) {
  const websocket = overrides.websocket || new FakeWebSocket();
  const executeCommand =
    overrides.executeCommand || jest.fn(async () => ({ visible: true, current_page: 'lighting' }));
  const client = new DesktopCompanionClient({
    websocket,
    getRegistration: jest.fn(async () => ({
      desktop_id: 'desktop-1',
      name: 'HA Desktop Widget',
      platform: 'linux',
      architecture: 'x64',
      app_version: '3.8.0',
      capabilities: ['visibility', 'switch_page'],
    })),
    getState:
      overrides.getState || jest.fn(async () => ({ visible: true, current_page: 'default' })),
    executeCommand,
    heartbeatIntervalMs: 60_000,
    logger: mockLogger,
  });
  return { client, executeCommand, websocket };
}

describe('DesktopCompanionClient', () => {
  afterEach(() => {
    jest.clearAllMocks();
    jest.useRealTimers();
  });

  const command = (id, action = 'toggle') => ({
    command_id: id,
    action,
    protocol_version: PROTOCOL_VERSION,
    expires_at: new Date(Date.now() + 30_000).toISOString(),
  });
  const flush = async () => {
    for (let i = 0; i < 20; i += 1) await Promise.resolve();
  };

  test('concurrent duplicate delivery executes once and acknowledges each delivery', async () => {
    let release;
    const executeCommand = jest.fn(
      () =>
        new Promise((resolve) => {
          release = resolve;
        })
    );
    const { client, websocket } = createClient({ executeCommand });
    const first = client.handleCommand('desktop-1', command('duplicate'));
    const second = client.handleCommand('desktop-1', command('duplicate'));
    await flush();
    expect(executeCommand).toHaveBeenCalledTimes(1);
    release({ visible: true });
    await Promise.all([first, second]);
    const acknowledgements = websocket.requests.filter((r) => r.type.endsWith('/ack_command'));
    expect(acknowledgements).toHaveLength(2);
    expect(acknowledgements[0]).toEqual(acknowledgements[1]);
  });

  test('distinct commands execute in delivery order', async () => {
    let release;
    const executeCommand = jest
      .fn()
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            release = resolve;
          })
      )
      .mockResolvedValue({ visible: false });
    const { client } = createClient({ executeCommand });
    const first = client.handleCommand('desktop-1', command('first', 'show'));
    const second = client.handleCommand('desktop-1', command('second', 'hide'));
    await flush();
    expect(executeCommand).toHaveBeenCalledTimes(1);
    release({ visible: true });
    await Promise.all([first, second]);
    expect(executeCommand.mock.calls.map(([value]) => value.action)).toEqual(['show', 'hide']);
  });

  describe('session reset with queued commands', () => {
    const ackFor = (websocket, id) =>
      websocket.requests.filter((r) => r.type.endsWith('/ack_command') && r.command_id === id);

    async function resetWithRunningAndQueued({
      start = false,
      restart = (client) => client.resetSession(),
    } = {}) {
      const releases = [];
      const executeCommand = jest.fn(
        () =>
          new Promise((resolve) => {
            releases.push(resolve);
          })
      );
      const { client, websocket } = createClient({ executeCommand });
      if (start) {
        client.start();
        await flush();
      }
      const running = client.handleCommand('desktop-1', command('running', 'show'));
      const queued = client.handleCommand('desktop-1', command('queued', 'hide'));
      await flush();
      expect(executeCommand).toHaveBeenCalledTimes(1);
      await restart(client, websocket);
      return { client, websocket, executeCommand, releases, running, queued };
    }

    test('redelivering a queued command in the next session executes it fresh', async () => {
      const { client, websocket, executeCommand, releases, running, queued } =
        await resetWithRunningAndQueued();
      const redelivered = client.handleCommand('desktop-1', command('queued', 'hide'));
      await flush();
      // The command from the ended session is still running, so nothing else may start yet.
      expect(executeCommand).toHaveBeenCalledTimes(1);
      releases[0]({ visible: true });
      await flush();
      expect(executeCommand).toHaveBeenCalledTimes(2);
      releases[1]({ visible: false });
      await Promise.all([running, queued, redelivered]);
      expect(executeCommand.mock.calls.map(([value]) => value.action)).toEqual(['show', 'hide']);
      const acks = ackFor(websocket, 'queued');
      expect(acks).toHaveLength(1);
      expect(acks[0].status).toBe('completed');
      expect(ackFor(websocket, 'running')).toHaveLength(0);
    });

    test('a replacement socket that authenticates without closing also starts fresh', async () => {
      const { client, websocket, executeCommand, releases, running, queued } =
        await resetWithRunningAndQueued({
          start: true,
          restart: async (_client, socket) => {
            socket.emit('message', { type: 'auth_ok' });
            await flush();
          },
        });
      const redelivered = client.handleCommand('desktop-1', command('queued', 'hide'));
      releases[0]({ visible: true });
      await flush();
      expect(executeCommand).toHaveBeenCalledTimes(2);
      releases[1]({ visible: false });
      await Promise.all([running, queued, redelivered]);
      expect(ackFor(websocket, 'queued').map((ack) => ack.status)).toEqual(['completed']);
    });

    test('a running command redelivered in the next session executes once', async () => {
      const { client, websocket, executeCommand, releases, running, queued } =
        await resetWithRunningAndQueued();
      const redelivered = client.handleCommand('desktop-1', command('running', 'show'));
      await flush();
      expect(executeCommand).toHaveBeenCalledTimes(1);
      releases[0]({ visible: true, current_page: 'real' });
      await Promise.all([running, queued, redelivered]);
      expect(executeCommand).toHaveBeenCalledTimes(1);
      const acks = ackFor(websocket, 'running');
      expect(acks).toHaveLength(1);
      expect(acks[0].status).toBe('completed');
      expect(acks[0].state.current_page).toBe('real');
    });

    test('a command dropped by a session reset is not cached for later redelivery', async () => {
      const { client, websocket, executeCommand, releases, running, queued } =
        await resetWithRunningAndQueued();
      releases[0]({ visible: true });
      await Promise.all([running, queued]);
      expect(executeCommand).toHaveBeenCalledTimes(1);
      expect(client.commandResults.size).toBe(1);
      expect(ackFor(websocket, 'queued')).toHaveLength(0);

      const redelivered = client.handleCommand('desktop-1', command('queued', 'hide'));
      await flush();
      expect(executeCommand).toHaveBeenCalledTimes(2);
      releases[1]({ visible: false });
      await redelivered;
      expect(ackFor(websocket, 'queued').map((ack) => ack.status)).toEqual(['completed']);
    });
  });

  test.each(['get_info', 'register_device', 'report_state', 'put_config_snapshot'])(
    'stop during %s leaves no subscription or heartbeat',
    async (stage) => {
      const { client, websocket } = createClient();
      client.getConfigDocument = async () => ({ ui: { theme: 'dark' } });
      let release;
      const answer = websocket.request.bind(websocket);
      websocket.request = (message) =>
        message.type === `ha_desktop_widget/${stage}`
          ? new Promise((resolve) => {
              release = resolve;
            })
          : answer(message);
      client.started = true;
      const initializing = client.initializeSession();
      await flush();
      expect(release).toEqual(expect.any(Function));
      client.stop();
      release({ success: true, result: { protocol_version: PROTOCOL_VERSION } });
      expect(await initializing).toBe(false);
      expect(client.heartbeatTimer).toBeNull();
      expect(client.unsubscribeCommands).toBeNull();
      expect(client.lastConfigSnapshot).toBeNull();
    }
  );

  test('each new session republishes an unchanged layout', async () => {
    const { client, websocket } = createClient();
    client.getConfigDocument = async () => ({ ui: { theme: 'dark' } });
    client.started = true;
    await client.initializeSession();
    client.resetSession();
    await client.initializeSession();
    client.stop();
    expect(websocket.requests.filter((r) => r.type.endsWith('/put_config_snapshot'))).toHaveLength(
      2
    );
  });

  test('registers, subscribes, and reports state for an authenticated session', async () => {
    const { client, websocket } = createClient();
    client.start();
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(websocket.requests).toEqual(
      expect.arrayContaining([
        { type: 'ha_desktop_widget/get_info' },
        expect.objectContaining({
          type: 'ha_desktop_widget/register_device',
          desktop_id: 'desktop-1',
          protocol_version: PROTOCOL_VERSION,
        }),
        {
          type: 'ha_desktop_widget/subscribe_commands',
          desktop_id: 'desktop-1',
        },
        expect.objectContaining({
          type: 'ha_desktop_widget/report_state',
          desktop_id: 'desktop-1',
          state: { visible: true, current_page: 'default' },
        }),
      ])
    );
    client.stop();
    expect(websocket.unsubscribe).toHaveBeenCalledTimes(1);
  });

  test('executes and acknowledges a valid command exactly once', async () => {
    const { client, executeCommand, websocket } = createClient();
    client.start();
    await new Promise((resolve) => setTimeout(resolve, 0));
    const command = {
      protocol_version: PROTOCOL_VERSION,
      command_id: 'command-1',
      action: 'switch_page',
      payload: { page_id: 'lighting' },
      expires_at: new Date(Date.now() + 30_000).toISOString(),
    };

    await websocket.commandHandler(command);
    await websocket.commandHandler(command);

    expect(executeCommand).toHaveBeenCalledTimes(1);
    expect(executeCommand).toHaveBeenCalledWith({
      action: 'switch_page',
      payload: { page_id: 'lighting' },
    });
    const acknowledgements = websocket.requests.filter(
      (request) => request.type === 'ha_desktop_widget/ack_command'
    );
    expect(acknowledgements).toHaveLength(2);
    expect(acknowledgements[0]).toMatchObject({
      desktop_id: 'desktop-1',
      command_id: 'command-1',
      status: 'completed',
      state: { visible: true, current_page: 'lighting' },
    });
    client.stop();
  });

  test.each([
    [
      'expired',
      {
        protocol_version: PROTOCOL_VERSION,
        action: 'show',
        expires_at: new Date(Date.now() - 1000).toISOString(),
      },
      'expired',
    ],
    [
      'protocol mismatch',
      {
        protocol_version: PROTOCOL_VERSION + 1,
        action: 'show',
        expires_at: new Date(Date.now() + 30_000).toISOString(),
      },
      'protocol',
    ],
    [
      'unsupported action',
      {
        protocol_version: PROTOCOL_VERSION,
        action: 'run_shell_command',
        expires_at: new Date(Date.now() + 30_000).toISOString(),
      },
      'action',
    ],
  ])('rejects an %s command without executing it', async (_label, command, errorFragment) => {
    const { client, executeCommand, websocket } = createClient();
    client.start();
    await new Promise((resolve) => setTimeout(resolve, 0));

    await websocket.commandHandler({ command_id: `command-${errorFragment}`, ...command });

    expect(executeCommand).not.toHaveBeenCalled();
    expect(websocket.requests).toContainEqual(
      expect.objectContaining({
        type: 'ha_desktop_widget/ack_command',
        status: 'failed',
        error: expect.stringMatching(new RegExp(errorFragment, 'i')),
      })
    );
    client.stop();
  });

  test('executes apply_profile and acknowledges with the applied profile identity', async () => {
    const { buildConfigPatchFromApplyPayload } = require('../../src/profile-schema');
    const updateConfig = jest.fn(async () => ({ success: true }));
    // Mirrors the renderer's apply_profile branch: build the patch, persist it,
    // and acknowledge with the profile identity for drift reporting.
    const executeCommand = jest.fn(async ({ payload }) => {
      const patch = buildConfigPatchFromApplyPayload(payload, { ui: { theme: 'auto' } });
      await updateConfig(patch);
      return {
        visible: true,
        current_page: 'default',
        active_profile_id: patch.haProfile.activeProfileId,
        profile_revision: patch.haProfile.revision,
      };
    });
    const { client, websocket } = createClient({ executeCommand });
    client.start();
    await new Promise((resolve) => setTimeout(resolve, 0));

    await websocket.commandHandler({
      protocol_version: PROTOCOL_VERSION,
      command_id: 'command-apply',
      action: 'apply_profile',
      payload: {
        profile_id: 'profile-1',
        revision: 4,
        schema_version: 1,
        profile: { ui: { theme: 'dark' }, opacity: 0.8 },
      },
      expires_at: new Date(Date.now() + 30_000).toISOString(),
    });
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(updateConfig).toHaveBeenCalledWith(
      expect.objectContaining({
        ui: { theme: 'dark' },
        opacity: 0.8,
        haProfile: expect.objectContaining({ activeProfileId: 'profile-1', revision: 4 }),
      })
    );
    expect(websocket.requests).toContainEqual(
      expect.objectContaining({
        type: 'ha_desktop_widget/ack_command',
        command_id: 'command-apply',
        status: 'completed',
        state: {
          visible: true,
          current_page: 'default',
          active_profile_id: 'profile-1',
          profile_revision: 4,
        },
      })
    );
    client.stop();
  });

  test('acknowledges a failed apply_profile when the schema version is unsupported', async () => {
    const { buildConfigPatchFromApplyPayload } = require('../../src/profile-schema');
    const executeCommand = jest.fn(async ({ payload }) => {
      buildConfigPatchFromApplyPayload(payload, {});
      return {};
    });
    const { client, websocket } = createClient({ executeCommand });
    client.start();
    await new Promise((resolve) => setTimeout(resolve, 0));

    await websocket.commandHandler({
      protocol_version: PROTOCOL_VERSION,
      command_id: 'command-apply-bad',
      action: 'apply_profile',
      payload: { profile_id: 'profile-1', revision: 1, schema_version: 99, profile: {} },
      expires_at: new Date(Date.now() + 30_000).toISOString(),
    });
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(websocket.requests).toContainEqual(
      expect.objectContaining({
        type: 'ha_desktop_widget/ack_command',
        command_id: 'command-apply-bad',
        status: 'failed',
        error: expect.stringMatching(/schema version/i),
      })
    );
    client.stop();
  });

  test('reports profile identity fields through state normalization', async () => {
    const { client, websocket } = createClient({
      getState: jest.fn(async () => ({
        visible: true,
        current_page: 'default',
        active_profile_id: 'profile-1',
        profile_revision: 2,
        unexpected: 'dropped',
      })),
    });
    client.start();
    await new Promise((resolve) => setTimeout(resolve, 0));

    const report = websocket.requests.find(
      (request) => request.type === 'ha_desktop_widget/report_state'
    );
    expect(report.state).toEqual({
      visible: true,
      current_page: 'default',
      active_profile_id: 'profile-1',
      profile_revision: 2,
    });
    client.stop();
  });

  test('reports the layout snapshot once per unique document', async () => {
    const websocket = new FakeWebSocket();
    const getConfigDocument = jest.fn(async () => ({ ui: { theme: 'dark' } }));
    const client = new DesktopCompanionClient({
      websocket,
      getRegistration: jest.fn(async () => ({ desktop_id: 'desktop-1', name: 'X' })),
      getState: jest.fn(async () => ({ visible: true })),
      getConfigDocument,
      executeCommand: jest.fn(),
      heartbeatIntervalMs: 60_000,
      logger: mockLogger,
    });
    client.start();
    await new Promise((resolve) => setTimeout(resolve, 0));

    const snapshots = () =>
      websocket.requests.filter((r) => r.type === 'ha_desktop_widget/put_config_snapshot');
    expect(snapshots()).toHaveLength(1);
    expect(snapshots()[0].document).toEqual({ ui: { theme: 'dark' } });

    await client.reportConfigSnapshot();
    expect(snapshots()).toHaveLength(1);

    getConfigDocument.mockResolvedValue({ ui: { theme: 'light' } });
    await client.reportConfigSnapshot();
    expect(snapshots()).toHaveLength(2);
    client.stop();
  });

  const unknownCommand = {
    success: false,
    error: { code: 'unknown_command', message: 'Unknown command.' },
  };
  const clientWithUnknownCommands = (unknownTypes) => {
    const websocket = new FakeWebSocket();
    const answer = websocket.request.bind(websocket);
    websocket.request = async (message) =>
      unknownTypes.includes(message.type)
        ? (websocket.requests.push(message), unknownCommand)
        : answer(message);
    let layout = 0;
    const client = new DesktopCompanionClient({
      websocket,
      getRegistration: jest.fn(async () => ({ desktop_id: 'desktop-1', name: 'X' })),
      getState: jest.fn(async () => ({ visible: true })),
      // Every call is a new layout, like a dashboard edit.
      getConfigDocument: jest.fn(async () => ({ layout: (layout += 1) })),
      executeCommand: jest.fn(),
      heartbeatIntervalMs: 60_000,
      logger: mockLogger,
    });
    return { client, websocket };
  };

  test('goes quiet for the session when Home Assistant lacks the companion integration', async () => {
    const { client, websocket } = clientWithUnknownCommands([
      'ha_desktop_widget/get_info',
      'ha_desktop_widget/report_state',
      'ha_desktop_widget/put_config_snapshot',
    ]);
    client.start();
    await new Promise((resolve) => setTimeout(resolve, 0));
    for (let i = 0; i < 3; i += 1) {
      await client.reportState();
      await client.reportConfigSnapshot();
    }
    expect(mockLogger.warn).not.toHaveBeenCalled();
    expect(mockLogger.info).toHaveBeenCalledTimes(1);
    expect(websocket.requests.map((request) => request.type)).toEqual([
      'ha_desktop_widget/get_info',
    ]);

    // A new connection checks again, in case the integration was installed meanwhile.
    websocket.emit('message', { type: 'auth_ok' });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(websocket.requests.map((request) => request.type)).toEqual([
      'ha_desktop_widget/get_info',
      'ha_desktop_widget/get_info',
    ]);
    expect(mockLogger.warn).not.toHaveBeenCalled();
    client.stop();
  });

  test('keeps reporting state to an older integration that cannot store layouts', async () => {
    const { client, websocket } = clientWithUnknownCommands([
      'ha_desktop_widget/put_config_snapshot',
    ]);
    client.start();
    await new Promise((resolve) => setTimeout(resolve, 0));
    await client.reportConfigSnapshot();
    await client.reportConfigSnapshot();
    expect(await client.reportState()).toBe(true);
    const count = (type) => websocket.requests.filter((request) => request.type === type).length;
    expect(count('ha_desktop_widget/put_config_snapshot')).toBe(1);
    expect(count('ha_desktop_widget/report_state')).toBe(2);
    expect(mockLogger.warn).not.toHaveBeenCalled();
    client.stop();
  });

  test('resets subscriptions and heartbeat state on socket close', async () => {
    jest.useFakeTimers();
    const { client, websocket } = createClient();
    client.start();
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();

    websocket.emit('close');

    expect(websocket.unsubscribe).toHaveBeenCalledTimes(1);
    expect(client.heartbeatTimer).toBeNull();
    client.stop();
  });
});

describe('DesktopCompanionClient session retries', () => {
  const unknownCommand = () =>
    Object.assign(new Error('Unknown command.'), { code: 'unknown_command' });
  const flush = async () => {
    for (let i = 0; i < 30; i += 1) await Promise.resolve();
  };

  // A fake socket whose get_info fails the given number of times before it answers.
  function createFlakyClient(failures, failWith = unknownCommand) {
    const websocket = new FakeWebSocket();
    let remaining = failures;
    const answer = websocket.request.bind(websocket);
    websocket.request = async (message) => {
      if (message.type === 'ha_desktop_widget/get_info' && remaining > 0) {
        remaining -= 1;
        websocket.requests.push(message);
        return {
          success: false,
          error: { code: failWith().code, message: failWith().message },
        };
      }
      return answer(message);
    };
    const { client } = createClient({ websocket });
    return { client, websocket };
  }

  const registrations = (websocket) =>
    websocket.requests.filter((request) => request.type.endsWith('/register_device'));
  const infoRequests = (websocket) =>
    websocket.requests.filter((request) => request.type.endsWith('/get_info'));

  afterEach(() => {
    jest.clearAllMocks();
    jest.useRealTimers();
  });

  test('registers on a later try when Home Assistant did not know the commands yet', async () => {
    jest.useFakeTimers();
    const { client, websocket } = createFlakyClient(1);
    client.start();
    await flush();
    expect(infoRequests(websocket)).toHaveLength(1);
    expect(registrations(websocket)).toHaveLength(0);

    await jest.advanceTimersByTimeAsync(14_999);
    expect(infoRequests(websocket)).toHaveLength(1);
    await jest.advanceTimersByTimeAsync(1);
    await flush();

    expect(infoRequests(websocket)).toHaveLength(2);
    expect(registrations(websocket)).toHaveLength(1);
    expect(client.heartbeatTimer).not.toBeNull();
    client.stop();
  });

  test('waits longer after each failure, up to five minutes', async () => {
    jest.useFakeTimers();
    const { client, websocket } = createFlakyClient(Infinity);
    client.start();
    await flush();

    const waits = [];
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const before = infoRequests(websocket).length;
      let waited = 0;
      while (infoRequests(websocket).length === before && waited < 10 * 60_000) {
        await jest.advanceTimersByTimeAsync(1000);
        waited += 1000;
      }
      waits.push(waited);
    }

    expect(waits).toEqual([15_000, 60_000, 300_000, 300_000, 300_000]);
    client.stop();
  });

  test('says the integration is missing once, not on every retry', async () => {
    jest.useFakeTimers();
    const { client } = createFlakyClient(Infinity);
    client.start();
    await flush();
    await jest.advanceTimersByTimeAsync(15_000 + 60_000 + 300_000);
    await flush();

    const notices = mockLogger.info.mock.calls.filter(([message]) =>
      String(message).includes('integration is not installed')
    );
    expect(notices).toHaveLength(1);
    client.stop();
  });

  test('says an unchanged failure once, and a different one when it changes', async () => {
    jest.useFakeTimers();
    let message = 'Unsupported protocol';
    const { client } = createFlakyClient(Infinity, () => ({ code: 'other', message }));
    client.start();
    await flush();
    await jest.advanceTimersByTimeAsync(15_000);
    await flush();
    const warnings = () =>
      mockLogger.warn.mock.calls.filter(([text]) => String(text).includes('session failed'));
    expect(warnings()).toHaveLength(1);

    message = 'Something else';
    await jest.advanceTimersByTimeAsync(60_000);
    await flush();
    expect(warnings()).toHaveLength(2);
    client.stop();
  });

  test('a socket that closes cancels the retry, and the next connection starts the waits over', async () => {
    jest.useFakeTimers();
    const { client, websocket } = createFlakyClient(Infinity);
    client.start();
    await flush();
    await jest.advanceTimersByTimeAsync(15_000);
    await flush();
    expect(infoRequests(websocket)).toHaveLength(2);

    websocket.emit('close', { intentional: false });
    expect(client.sessionRetryTimer).toBeNull();
    await jest.advanceTimersByTimeAsync(10 * 60_000);
    expect(infoRequests(websocket)).toHaveLength(2);

    websocket.emit('message', { type: 'auth_ok' });
    await flush();
    expect(infoRequests(websocket)).toHaveLength(3);
    await jest.advanceTimersByTimeAsync(15_000);
    await flush();
    expect(infoRequests(websocket)).toHaveLength(4);
    client.stop();
  });

  test('stop cancels a pending retry', async () => {
    jest.useFakeTimers();
    const { client, websocket } = createFlakyClient(Infinity);
    client.start();
    await flush();
    client.stop();

    await jest.advanceTimersByTimeAsync(10 * 60_000);

    expect(infoRequests(websocket)).toHaveLength(1);
  });

  test('registers again at the next heartbeat when the commands disappear mid-session', async () => {
    jest.useFakeTimers();
    const { client, websocket } = createClient();
    const answer = websocket.request.bind(websocket);
    let missing = false;
    websocket.request = async (message) => {
      if (missing && message.type === 'ha_desktop_widget/report_state') {
        return { success: false, error: { code: 'unknown_command', message: 'Unknown command.' } };
      }
      return answer(message);
    };
    client.start();
    await flush();
    expect(registrations(websocket)).toHaveLength(1);

    missing = true;
    await jest.advanceTimersByTimeAsync(60_000);
    await flush();
    expect(client.integrationMissing).toBe(true);

    missing = false;
    await jest.advanceTimersByTimeAsync(60_000);
    await flush();

    expect(registrations(websocket)).toHaveLength(2);
    expect(client.integrationMissing).toBe(false);
    client.stop();
  });
});

describe('DesktopCompanionClient rejected layouts', () => {
  const flush = async () => {
    for (let i = 0; i < 30; i += 1) await Promise.resolve();
  };
  const snapshots = (websocket) =>
    websocket.requests.filter((request) => request.type.endsWith('/put_config_snapshot'));

  function createRefusingClient(document) {
    const websocket = new FakeWebSocket();
    const answer = websocket.request.bind(websocket);
    websocket.request = async (message) => {
      if (message.type === 'ha_desktop_widget/put_config_snapshot') {
        websocket.requests.push(message);
        return { success: false, error: { code: 'invalid_format', message: 'Layout too large' } };
      }
      return answer(message);
    };
    const { client } = createClient({ websocket });
    client.getConfigDocument = async () => document.current;
    return { client, websocket };
  }

  afterEach(() => {
    jest.clearAllMocks();
    jest.useRealTimers();
  });

  test('a refused layout is not uploaded again at every heartbeat', async () => {
    jest.useFakeTimers();
    const document = { current: { pages: ['a'] } };
    const { client, websocket } = createRefusingClient(document);
    client.start();
    await flush();
    expect(snapshots(websocket)).toHaveLength(1);

    await jest.advanceTimersByTimeAsync(10 * 60_000);
    await flush();

    expect(snapshots(websocket)).toHaveLength(1);
    expect(
      mockLogger.warn.mock.calls.filter(([text]) => String(text).includes('not accepted'))
    ).toHaveLength(1);
    client.stop();
  });

  test('a changed layout is tried again once the wait after the refusal is over', async () => {
    jest.useFakeTimers();
    const document = { current: { pages: ['a'] } };
    const { client, websocket } = createRefusingClient(document);
    client.start();
    await flush();
    expect(snapshots(websocket)).toHaveLength(1);

    document.current = { pages: ['a', 'b'] };
    await jest.advanceTimersByTimeAsync(60_000); // the heartbeat, inside the first wait
    await flush();
    expect(snapshots(websocket)).toHaveLength(1);

    await jest.advanceTimersByTimeAsync(60_000);
    await flush();
    expect(snapshots(websocket)).toHaveLength(2);
    client.stop();
  });

  test('a new session sends the layout again, since the integration may have changed', async () => {
    jest.useFakeTimers();
    const document = { current: { pages: ['a'] } };
    const { client, websocket } = createRefusingClient(document);
    client.start();
    await flush();
    expect(snapshots(websocket)).toHaveLength(1);

    websocket.emit('message', { type: 'auth_ok' });
    await flush();

    expect(snapshots(websocket)).toHaveLength(2);
    client.stop();
  });
});

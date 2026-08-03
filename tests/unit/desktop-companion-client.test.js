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

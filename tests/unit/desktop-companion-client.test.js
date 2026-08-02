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
    getState: jest.fn(async () => ({ visible: true, current_page: 'default' })),
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

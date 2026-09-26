const fs = require('fs');
const path = require('path');
const vm = require('vm');

const mainSource = fs.readFileSync(path.resolve(__dirname, '../../main.js'), 'utf8');

function extractBlock(startMarker, endMarker = '\n}\n') {
  const start = mainSource.indexOf(startMarker);
  expect(start).toBeGreaterThan(-1);
  const end = mainSource.indexOf(endMarker, start);
  expect(end).toBeGreaterThan(start);
  return mainSource.slice(start, end + endMarker.length);
}

const flushAsync = async () => {
  for (let index = 0; index < 8; index += 1) await Promise.resolve();
};

describe('main-process Home Assistant authorization recovery', () => {
  const staleSource = extractBlock('function isHomeAssistantOAuthSessionStale');

  function createContext(homeAssistant, now = 1_000_000) {
    const events = [];
    const handlers = {};
    const context = {
      config: { homeAssistant },
      Date: { now: () => now },
      HOME_ASSISTANT_OAUTH_REFRESH_SKEW_MS: 5 * 60 * 1000,
      powerMonitor: { on: (event, handler) => (handlers[event] = handler) },
      ipcMain: { handle: (channel, handler) => (handlers[channel] = handler) },
      requestOpportunisticProfileSync: jest.fn(),
      invalidateHaConnectionState: jest.fn(),
      scheduleHomeAssistantOAuthRefresh: jest.fn(),
      runSerializedConfigMutation: (task) => Promise.resolve().then(task),
      refreshHomeAssistantOAuthSession: jest.fn(async () => {
        events.push('refresh');
        context.config.homeAssistant = {
          ...context.config.homeAssistant,
          oauthStatus: 'connected',
        };
      }),
      authorizeIpcSender: () => ({ type: 'main' }),
      rejectUnauthorizedIpc: jest.fn(),
      mainWindow: {
        isDestroyed: () => false,
        webContents: { send: (channel, payload) => events.push([channel, payload]) },
      },
      log: { warn: jest.fn() },
    };
    vm.runInNewContext(
      `${staleSource}\n${extractBlock('function setupProfileSyncWakeTriggers')}\n` +
        'setupProfileSyncWakeTriggers();\n' +
        extractBlock("ipcMain.handle('refresh-home-assistant-oauth'", '\n});\n'),
      context
    );
    return { context, events, handlers };
  }

  it('refreshes an expired access token after sleep before reconnecting', async () => {
    const { context, events, handlers } = createContext({
      authMethod: 'oauth',
      oauthStatus: 'connected',
      oauthExpiresAt: 1_000_000 - 60_000,
    });
    handlers.resume();
    expect(events).toEqual([]);
    await flushAsync();
    expect(context.refreshHomeAssistantOAuthSession).toHaveBeenCalledTimes(1);
    expect(events).toEqual(['refresh', ['tray-entities-refresh-needed', { reconnect: true }]]);
  });

  it('reconnects at once and re-arms the refresh timer when the token is still fresh', () => {
    const { context, events, handlers } = createContext({
      authMethod: 'oauth',
      oauthStatus: 'connected',
      oauthExpiresAt: 1_000_000 + 20 * 60_000,
    });
    handlers.resume();
    expect(context.refreshHomeAssistantOAuthSession).not.toHaveBeenCalled();
    expect(context.scheduleHomeAssistantOAuthRefresh).toHaveBeenCalledWith(1_000_000 + 20 * 60_000);
    expect(events).toEqual([['tray-entities-refresh-needed', { reconnect: true }]]);
  });

  it('leaves an expired authorization waiting for the user after sleep', () => {
    const { context, events, handlers } = createContext({
      authMethod: 'oauth',
      oauthStatus: 'reauth_required',
      oauthExpiresAt: 1_000_000 + 20 * 60_000,
    });
    handlers.resume();
    expect(context.refreshHomeAssistantOAuthSession).not.toHaveBeenCalled();
    expect(context.scheduleHomeAssistantOAuthRefresh).not.toHaveBeenCalled();
    // Reconnecting would only fail on the placeholder token and bury the reconnect prompt.
    expect(events).toEqual([]);
  });

  it('does not reconnect after sleep when the refresh finds the authorization revoked', async () => {
    const { context, events, handlers } = createContext({
      authMethod: 'oauth',
      oauthStatus: 'connected',
      oauthExpiresAt: 1_000_000 - 60_000,
    });
    context.refreshHomeAssistantOAuthSession.mockImplementation(async () => {
      events.push('refresh');
      context.config.homeAssistant = {
        ...context.config.homeAssistant,
        oauthStatus: 'reauth_required',
      };
    });
    handlers.resume();
    await flushAsync();
    expect(events).toEqual(['refresh']);
  });

  it.each([
    [
      'an invalid grant',
      () =>
        Promise.reject(Object.assign(new Error('invalid_grant'), { code: 'OAUTH_INVALID_GRANT' })),
    ],
    ['missing saved credentials', () => Promise.resolve(null)],
    ...[
      'OAUTH_STORE_READ',
      'OAUTH_STORE_INVALID',
      'OAUTH_STORE_DECRYPT',
      'OAUTH_SECURE_STORAGE_UNAVAILABLE',
    ].map((code) => [
      `an unreadable saved authorization (${code})`,
      () => Promise.reject(Object.assign(new Error('unreadable'), { code })),
    ]),
  ])('requires reauthorization after %s and stops retrying', async (_label, refresh) => {
    const context = {
      config: {
        homeAssistant: {
          authMethod: 'oauth',
          oauthStatus: 'connected',
          token: 'access',
          oauthAuthorizationId: 'authorization-1',
          oauthExpiresAt: 123,
        },
      },
      HOME_ASSISTANT_TOKEN_PLACEHOLDER: 'YOUR_LONG_LIVED_ACCESS_TOKEN',
      HOME_ASSISTANT_OAUTH_RETRY_MS: 60_000,
      getHomeAssistantOAuthClient: () => ({ refresh }),
      applyHomeAssistantOAuthSession: jest.fn(),
      clearHomeAssistantOAuthRefreshTimer: jest.fn(),
      scheduleHomeAssistantOAuthRefresh: jest.fn(),
      pushConfigToRenderer: jest.fn(),
      broadcastDesktopPinConfigUpdate: jest.fn(),
    };
    vm.runInNewContext(
      `const process = { platform: 'linux' };\n` +
        extractBlock('function describeLinuxKeyringOAuthError') +
        extractBlock('async function refreshHomeAssistantOAuthSession'),
      context
    );
    await vm.runInNewContext('refreshHomeAssistantOAuthSession()', context);

    expect(context.config.homeAssistant.oauthStatus).toBe('reauth_required');
    // Linux reports an unusable keyring separately so the renderer can offer a restart.
    const code = context.config.homeAssistant.oauthLastErrorCode;
    if (_label.includes('OAUTH_STORE_DECRYPT') || _label.includes('SECURE_STORAGE')) {
      expect(code).toBe('OAUTH_KEYRING_UNAVAILABLE');
    } else {
      expect(code).not.toBe('OAUTH_KEYRING_UNAVAILABLE');
    }
    expect(context.config.homeAssistant.token).toBe('YOUR_LONG_LIVED_ACCESS_TOKEN');
    expect(context.config.homeAssistant.oauthExpiresAt).toBeUndefined();
    expect(context.config.homeAssistant.oauthAuthorizationId).toBeUndefined();
    expect(context.scheduleHomeAssistantOAuthRefresh).not.toHaveBeenCalled();
    expect(context.clearHomeAssistantOAuthRefreshTimer).toHaveBeenCalled();
    expect(context.broadcastDesktopPinConfigUpdate).toHaveBeenCalled();
  });

  it('keeps the failure code for the renderer when a refresh fails while offline', async () => {
    const context = {
      config: { homeAssistant: { authMethod: 'oauth', oauthStatus: 'connected' } },
      HOME_ASSISTANT_OAUTH_RETRY_MS: 60_000,
      getHomeAssistantOAuthClient: () => ({
        refresh: () =>
          Promise.reject(
            Object.assign(new Error('connect ECONNREFUSED 127.0.0.1:8123'), {
              code: 'OAUTH_TOKEN_NETWORK',
            })
          ),
      }),
      scheduleHomeAssistantOAuthRefresh: jest.fn(),
      pushConfigToRenderer: jest.fn(),
      broadcastDesktopPinConfigUpdate: jest.fn(),
    };
    vm.runInNewContext(
      `const process = { platform: 'linux' };\n` +
        extractBlock('function describeLinuxKeyringOAuthError') +
        extractBlock('async function refreshHomeAssistantOAuthSession'),
      context
    );
    await vm.runInNewContext('refreshHomeAssistantOAuthSession()', context);

    expect(context.config.homeAssistant).toMatchObject({
      oauthStatus: 'offline',
      oauthLastError: 'connect ECONNREFUSED 127.0.0.1:8123',
      oauthLastErrorCode: 'OAUTH_TOKEN_NETWORK',
    });
    expect(context.scheduleHomeAssistantOAuthRefresh).toHaveBeenCalledWith(null, 60_000);
  });

  it('never saves the runtime authorization error fields', () => {
    const saveSource = mainSource.slice(
      mainSource.indexOf('const configToSave = JSON.parse(JSON.stringify(config));'),
      mainSource.indexOf('if (preserveRecoveryToken) {')
    );
    expect(saveSource).toContain('delete configToSave.homeAssistant.oauthLastError;');
    expect(saveSource).toContain('delete configToSave.homeAssistant.oauthLastErrorCode;');
  });

  it('refreshes on request when Home Assistant rejects the access token', async () => {
    const { context, handlers } = createContext({ authMethod: 'oauth', oauthStatus: 'connected' });
    await expect(handlers['refresh-home-assistant-oauth']({})).resolves.toEqual({
      success: true,
      oauthStatus: 'connected',
    });
    expect(context.refreshHomeAssistantOAuthSession).toHaveBeenCalledTimes(1);
  });

  it('does not refresh an authorization that is already known to be revoked', async () => {
    const { context, handlers } = createContext({
      authMethod: 'oauth',
      oauthStatus: 'reauth_required',
    });
    await expect(handlers['refresh-home-assistant-oauth']({})).resolves.toEqual({
      success: true,
      oauthStatus: 'reauth_required',
    });
    expect(context.refreshHomeAssistantOAuthSession).not.toHaveBeenCalled();
  });

  describe('credential store failures on Linux', () => {
    const context = {};
    vm.runInNewContext(extractBlock('function describeLinuxKeyringOAuthError'), context);
    const describeCode = context.describeLinuxKeyringOAuthError;

    it('reports an unavailable or unreadable Linux keyring as a keyring problem', () => {
      expect(describeCode('OAUTH_SECURE_STORAGE_UNAVAILABLE', 'linux')).toBe(
        'OAUTH_KEYRING_UNAVAILABLE'
      );
      expect(describeCode('OAUTH_STORE_DECRYPT', 'linux')).toBe('OAUTH_KEYRING_UNAVAILABLE');
      expect(describeCode('OAUTH_INVALID_GRANT', 'linux')).toBe('OAUTH_INVALID_GRANT');
    });

    it('keeps the original codes on Windows and macOS', () => {
      expect(describeCode('OAUTH_SECURE_STORAGE_UNAVAILABLE', 'win32')).toBe(
        'OAUTH_SECURE_STORAGE_UNAVAILABLE'
      );
      expect(describeCode('OAUTH_STORE_DECRYPT', 'darwin')).toBe('OAUTH_STORE_DECRYPT');
      expect(describeCode(undefined, 'linux')).toBe('');
    });
  });
});

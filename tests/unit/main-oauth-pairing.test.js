/** @jest-environment node */
const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');
const vm = require('vm');
const { HomeAssistantOAuthClient } = require('../../src/ha-oauth.cjs');
const { createSerializedTaskRunner } = require('../../src/serialized-task-runner.cjs');

const source = fs.readFileSync(path.resolve(__dirname, '../../main.js'), 'utf8');
const pairingSource = source.slice(
  source.indexOf('async function applyHomeAssistantOAuthSession('),
  source.indexOf('// Home Assistant rejected the current access token')
);
const deferred = () => {
  let resolve;
  const promise = new Promise((done) => {
    resolve = done;
  });
  return { promise, resolve };
};
const tokenResponse = (token) => ({
  status: 200,
  body: JSON.stringify({ access_token: token, refresh_token: token, expires_in: 1800 }),
});

async function approveInBrowser(rawUrl) {
  const url = new URL(rawUrl);
  const callback = new URL(url.searchParams.get('redirect_uri'));
  callback.searchParams.set('state', url.searchParams.get('state'));
  callback.searchParams.set('code', 'synthetic-code');
  await new Promise((resolve, reject) => {
    http
      .get(callback, { agent: false }, (response) => {
        response.resume();
        response.on('end', resolve);
      })
      .on('error', reject);
  });
}

describe('OAuth pairing commit', () => {
  let directory;
  beforeEach(() => {
    directory = fs.mkdtempSync(path.join(os.tmpdir(), 'oauth-commit-'));
  });
  afterEach(() => {
    fs.rmSync(directory, { recursive: true, force: true });
  });

  function setup({
    postForm = async () => tokenResponse('new-token'),
    mutate = createSerializedTaskRunner(),
  } = {}) {
    const client = new HomeAssistantOAuthClient({
      userDataPath: directory,
      platform: 'linux',
      safeStorage: { encryptString: (s) => Buffer.from(s), decryptString: (b) => b.toString() },
      isSecureStorageAvailable: () => true,
      openExternal: approveInBrowser,
      postForm,
    });
    const handlers = {};
    const context = vm.createContext({
      process,
      config: {
        homeAssistant: { url: 'http://previous.test', token: 'previous', authMethod: 'token' },
      },
      ipcMain: {
        handle: (name, handler) => {
          handlers[name] = handler;
        },
      },
      authorizeIpcSender: () => ({ type: 'main' }),
      rejectUnauthorizedIpc: jest.fn(),
      windowAutoHide: { suspend: () => () => {} },
      getHomeAssistantOAuthClient: () => client,
      runSerializedConfigMutation: mutate,
      ensureDesktopCompanionIdentity: () => {},
      preservedEncryptedTokenForRecovery: null,
      saveConfigDurably: jest.fn(async () => ({ success: true })),
      scheduleHomeAssistantOAuthRefresh: jest.fn(),
      clearHomeAssistantOAuthRefreshTimer: jest.fn(),
      pushConfigToRenderer: jest.fn(),
      broadcastDesktopPinConfigUpdate: jest.fn(),
      sanitizeConfigForRenderer: (config) => config,
      showMainWindowFromTray: () => {},
      log: { warn: () => {} },
    });
    vm.runInContext(pairingSource, context);
    return { client, context, pair: (url) => handlers['start-home-assistant-oauth']({}, url) };
  }

  test('cancel during token exchange cannot overwrite a newer completed login', async () => {
    const started = deferred();
    const reply = deferred();
    const { client, context, pair } = setup({
      postForm: async (url) => {
        if (url.startsWith('http://old.test')) {
          started.resolve();
          return reply.promise;
        }
        return tokenResponse('replacement');
      },
    });
    const old = pair('http://old.test');
    await started.promise;
    expect(client.cancelPairing()).toBe(true);
    expect(await pair('http://new.test')).toMatchObject({ success: true });
    reply.resolve(tokenResponse('canceled'));
    expect(await old).toMatchObject({ success: false, code: 'OAUTH_AUTHORIZATION_CANCELED' });
    expect(client.readCredentials()).toMatchObject({
      baseUrl: 'http://new.test',
      refreshToken: 'replacement',
    });
    expect(client.publicSession().baseUrl).toBe('http://new.test');
    expect(context.config.homeAssistant.url).toBe('http://new.test');
  });

  test('cancel while queued commits neither credentials nor configuration', async () => {
    const queued = deferred();
    const release = deferred();
    const { client, context, pair } = setup({
      mutate: async (task) => {
        queued.resolve();
        await release.promise;
        return task();
      },
    });
    const result = pair('http://new.test');
    await queued.promise;
    const canceled = client.cancelPairing();
    release.resolve();
    const response = await result;
    expect(canceled).toBe(true);
    expect(response).toMatchObject({ success: false, code: 'OAUTH_AUTHORIZATION_CANCELED' });
    expect(client.readCredentials()).toBeNull();
    expect(client.publicSession()).toBeNull();
    expect(context.config.homeAssistant.url).toBe('http://previous.test');
    expect(context.saveConfigDurably).not.toHaveBeenCalled();
  });

  test('a rejected mutation queue leaves saved authorization untouched', async () => {
    const { client, context, pair } = setup({
      mutate: async () => {
        throw new Error('Application is shutting down');
      },
    });
    expect(await pair('http://new.test')).toMatchObject({ success: false });
    expect(client.readCredentials()).toBeNull();
    expect(context.config.homeAssistant.url).toBe('http://previous.test');
  });

  test('cancel reports false once the durable commit has started', async () => {
    const saving = deferred();
    const saved = deferred();
    const { client, context, pair } = setup();
    context.saveConfigDurably.mockImplementation(async () => {
      saving.resolve();
      await saved.promise;
      return { success: true };
    });
    const pending = pair('http://new.test');
    await saving.promise;
    const canceled = client.cancelPairing();
    saved.resolve();
    expect(await pending).toMatchObject({ success: true });
    expect(canceled).toBe(false);
    expect(client.readCredentials().baseUrl).toBe('http://new.test');
  });

  test('failed config persistence preserves previous credential bytes and session for restore', async () => {
    const { client, context, pair } = setup();
    expect(await pair('http://old.test')).toMatchObject({ success: true });
    const previousConfig = context.config;
    const previousSession = client.publicSession();
    const previousCredentials = fs.readFileSync(client.credentialsPath);
    context.saveConfigDurably.mockResolvedValue({ success: false, error: 'EACCES' });
    expect(await pair('http://new.test')).toMatchObject({ success: false });
    expect(context.config).toBe(previousConfig);
    expect(fs.readFileSync(client.credentialsPath)).toEqual(previousCredentials);
    expect(client.publicSession()).toEqual(previousSession);
    await vm.runInContext('restoreHomeAssistantOAuthSession()', context);
    expect(context.config.homeAssistant.url).toBe('http://old.test');
  });

  test('failed first-login persistence removes the new authorization', async () => {
    const { client, context, pair } = setup();
    context.saveConfigDurably.mockResolvedValue({ success: false, error: 'EACCES' });
    expect(await pair('http://new.test')).toMatchObject({ success: false });
    expect(client.readCredentials()).toBeNull();
    expect(client.publicSession()).toBeNull();
    expect(context.config.homeAssistant.url).toBe('http://previous.test');
  });

  test('a thrown persistence failure restores the prior configuration and credentials', async () => {
    const { client, context, pair } = setup();
    expect(await pair('http://old.test')).toMatchObject({ success: true });
    const previousConfig = context.config;
    const previousCredentials = fs.readFileSync(client.credentialsPath);
    context.saveConfigDurably.mockRejectedValue(new Error('disk failure'));
    expect(await pair('http://new.test')).toMatchObject({ success: false });
    expect(context.config).toBe(previousConfig);
    expect(fs.readFileSync(client.credentialsPath)).toEqual(previousCredentials);
    expect(client.publicSession().baseUrl).toBe('http://old.test');
  });

  test('credential write failure leaves the prior login and config untouched', async () => {
    const { client, context, pair } = setup();
    expect(await pair('http://old.test')).toMatchObject({ success: true });
    const previousConfig = context.config;
    const previousCredentials = fs.readFileSync(client.credentialsPath);
    const saveCount = context.saveConfigDurably.mock.calls.length;
    const rename = jest.spyOn(fs, 'renameSync').mockImplementationOnce(() => {
      throw Object.assign(new Error('EACCES'), { code: 'EACCES' });
    });
    try {
      expect(await pair('http://new.test')).toMatchObject({
        success: false,
        code: 'OAUTH_STORE_WRITE',
      });
      expect(context.config).toBe(previousConfig);
      expect(fs.readFileSync(client.credentialsPath)).toEqual(previousCredentials);
      expect(client.publicSession().baseUrl).toBe('http://old.test');
      expect(context.saveConfigDurably).toHaveBeenCalledTimes(saveCount);
    } finally {
      rename.mockRestore();
    }
  });

  test('rollback completes before a queued replacement authorization commits', async () => {
    const queued = deferred();
    const saving = deferred();
    const failedSave = deferred();
    const serial = createSerializedTaskRunner();
    let commits = 0;
    const { client, context, pair } = setup({
      mutate: (task) => {
        commits += 1;
        if (commits === 3) queued.resolve();
        return serial(task);
      },
    });
    expect(await pair('http://old.test')).toMatchObject({ success: true });
    context.saveConfigDurably.mockImplementationOnce(async () => {
      saving.resolve();
      await failedSave.promise;
      return { success: false, error: 'EACCES' };
    });
    const failed = pair('http://failed.test');
    await saving.promise;
    const replacement = pair('http://replacement.test');
    await queued.promise;
    failedSave.resolve();
    expect(await failed).toMatchObject({ success: false });
    expect(await replacement).toMatchObject({ success: true });
    expect(client.readCredentials().baseUrl).toBe('http://replacement.test');
    expect(client.publicSession().baseUrl).toBe('http://replacement.test');
    expect(context.config.homeAssistant.url).toBe('http://replacement.test');
  });

  test('notification failure after a durable save retains the committed authorization', async () => {
    const { client, context, pair } = setup();
    context.pushConfigToRenderer.mockImplementation(() => {
      throw new Error('WebContents destroyed');
    });
    expect(await pair('http://new.test')).toMatchObject({ success: true });
    expect(context.saveConfigDurably).toHaveBeenCalledTimes(1);
    expect(context.config.homeAssistant.url).toBe('http://new.test');
    expect(client.readCredentials().baseUrl).toBe('http://new.test');
    expect(client.publicSession().baseUrl).toBe('http://new.test');
    expect(context.broadcastDesktopPinConfigUpdate).toHaveBeenCalledTimes(1);
  });

  test('failed persistence retains the encrypted-token recovery copy', async () => {
    const { context, pair } = setup();
    context.preservedEncryptedTokenForRecovery = 'previous-encrypted-token';
    context.saveConfigDurably.mockResolvedValue({ success: false, error: 'EACCES' });
    expect(await pair('http://new.test')).toMatchObject({ success: false });
    expect(context.preservedEncryptedTokenForRecovery).toBe('previous-encrypted-token');
  });

  test('successful pairing saves credentials and configuration through the queue', async () => {
    const { client, context, pair } = setup();
    expect(await pair('http://new.test')).toMatchObject({ success: true });
    expect(context.config.homeAssistant.url).toBe('http://new.test');
    expect(client.readCredentials().baseUrl).toBe('http://new.test');
    expect(client.cancelPairing()).toBe(false);
  });
});

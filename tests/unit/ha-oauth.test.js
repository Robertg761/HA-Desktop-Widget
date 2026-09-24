/**
 * @jest-environment node
 */

const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');

const {
  OAUTH_CREDENTIALS_FILE,
  HomeAssistantOAuthClient,
  authorizeWithLoopback,
  buildAuthorizationUrl,
  isLoopbackOAuthClient,
  normalizeHomeAssistantBaseUrl,
  parseTokenResponse,
  probeHomeAssistantWithElectronNet,
} = require('../../src/ha-oauth.cjs');

function createTemporaryDirectory() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'ha-widget-oauth-'));
}

function createSafeStorage() {
  return {
    encryptString: jest.fn((value) => Buffer.from(`encrypted:${value}`, 'utf8')),
    decryptString: jest.fn((value) => value.toString('utf8').replace(/^encrypted:/, '')),
  };
}

function requestCallback(url) {
  return new Promise((resolve, reject) => {
    http
      .get(url, (response) => {
        response.resume();
        response.on('end', () => resolve(response.statusCode));
      })
      .on('error', reject);
  });
}

function requestCallbackPage(url) {
  return new Promise((resolve, reject) => {
    http
      .get(url, (response) => {
        let body = '';
        response.setEncoding('utf8');
        response.on('data', (chunk) => {
          body += chunk;
        });
        response.on('end', () => resolve({ statusCode: response.statusCode, body }));
      })
      .on('error', reject);
  });
}

describe('Home Assistant OAuth', () => {
  const temporaryDirectories = [];

  afterEach(() => {
    for (const directory of temporaryDirectories.splice(0)) {
      fs.rmSync(directory, { recursive: true, force: true });
    }
  });

  test('normalizes Home Assistant URLs without accepting credentials or foreign schemes', () => {
    expect(normalizeHomeAssistantBaseUrl(' homeassistant.local:8123/path ')).toBe(
      'http://homeassistant.local:8123'
    );
    expect(normalizeHomeAssistantBaseUrl('https://ha.example.test/')).toBe(
      'https://ha.example.test'
    );
    expect(normalizeHomeAssistantBaseUrl('javascript:alert(1)')).toBeNull();
    expect(normalizeHomeAssistantBaseUrl('http://user:secret@ha.local')).toBeNull();
  });

  test('builds an authorization URL with an exact loopback client and state', () => {
    const clientId = 'http://127.0.0.1:40123/';
    const redirectUri = 'http://127.0.0.1:40123/oauth/callback';
    const authorizationUrl = new URL(
      buildAuthorizationUrl('https://ha.example.test', clientId, redirectUri, 'expected-state')
    );

    expect(isLoopbackOAuthClient(clientId, redirectUri)).toBe(true);
    expect(isLoopbackOAuthClient(clientId, 'http://127.0.0.1:40124/oauth/callback')).toBe(false);
    expect(authorizationUrl.origin).toBe('https://ha.example.test');
    expect(authorizationUrl.pathname).toBe('/auth/authorize');
    expect(authorizationUrl.searchParams.get('client_id')).toBe(clientId);
    expect(authorizationUrl.searchParams.get('redirect_uri')).toBe(redirectUri);
    expect(authorizationUrl.searchParams.get('state')).toBe('expected-state');
  });

  test('accepts a single valid loopback callback and exchanges its code', async () => {
    const exchangeCode = jest.fn(async ({ code, clientId, redirectUri }) => ({
      code,
      clientId,
      redirectUri,
    }));
    let callbackStatus;

    const result = await authorizeWithLoopback({
      baseUrl: 'https://ha.example.test/',
      timeoutMs: 2000,
      openExternal: async (rawAuthorizationUrl) => {
        const authorizationUrl = new URL(rawAuthorizationUrl);
        const callbackUrl = new URL(authorizationUrl.searchParams.get('redirect_uri'));
        callbackUrl.searchParams.set('code', 'one-time-code');
        callbackUrl.searchParams.set('state', authorizationUrl.searchParams.get('state'));
        callbackStatus = await requestCallback(callbackUrl);
      },
      exchangeCode,
    });

    expect(callbackStatus).toBe(200);
    expect(result.code).toBe('one-time-code');
    expect(result.clientId).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/$/);
    expect(result.redirectUri).toBe(`${result.clientId.replace(/\/$/, '')}/oauth/callback`);
    expect(exchangeCode).toHaveBeenCalledTimes(1);
  });

  test('rejects a callback whose state does not match', async () => {
    await expect(
      authorizeWithLoopback({
        baseUrl: 'http://ha.local:8123',
        timeoutMs: 2000,
        openExternal: async (rawAuthorizationUrl) => {
          const authorizationUrl = new URL(rawAuthorizationUrl);
          const callbackUrl = new URL(authorizationUrl.searchParams.get('redirect_uri'));
          callbackUrl.searchParams.set('code', 'stolen-code');
          callbackUrl.searchParams.set('state', 'wrong-state');
          await requestCallback(callbackUrl);
        },
        exchangeCode: jest.fn(),
      })
    ).rejects.toMatchObject({ code: 'OAUTH_STATE_MISMATCH' });
  });

  test('shows the browser callback pages in the app language, escaped', async () => {
    const catalog = {
      'HA Desktop Widget connected': 'HA Desktop Widget verbunden',
      'You can close this browser tab and return to the desktop app.':
        'Du kannst diesen Tab schließen & zur <App> zurückkehren.',
    };
    let page;

    await authorizeWithLoopback({
      baseUrl: 'https://ha.example.test/',
      timeoutMs: 2000,
      translate: (key) => catalog[key] || key,
      openExternal: async (rawAuthorizationUrl) => {
        const authorizationUrl = new URL(rawAuthorizationUrl);
        const callbackUrl = new URL(authorizationUrl.searchParams.get('redirect_uri'));
        callbackUrl.searchParams.set('code', 'one-time-code');
        callbackUrl.searchParams.set('state', authorizationUrl.searchParams.get('state'));
        page = await requestCallbackPage(callbackUrl);
      },
      exchangeCode: jest.fn(async () => ({})),
    });

    expect(page.statusCode).toBe(200);
    expect(page.body).toContain('<title>HA Desktop Widget verbunden</title>');
    expect(page.body).toContain(
      '<p>Du kannst diesen Tab schließen &amp; zur &lt;App&gt; zurückkehren.</p>'
    );
  });

  test('passes the client translator to the pairing callback pages', async () => {
    const userDataPath = createTemporaryDirectory();
    temporaryDirectories.push(userDataPath);
    let page;
    const client = new HomeAssistantOAuthClient({
      safeStorage: createSafeStorage(),
      platform: 'linux',
      userDataPath,
      openExternal: async (rawAuthorizationUrl) => {
        const authorizationUrl = new URL(rawAuthorizationUrl);
        const callbackUrl = new URL(authorizationUrl.searchParams.get('redirect_uri'));
        callbackUrl.searchParams.set('code', 'stolen-code');
        callbackUrl.searchParams.set('state', 'wrong-state');
        page = await requestCallbackPage(callbackUrl);
      },
      postForm: jest.fn(),
      isSecureStorageAvailable: () => true,
      translate: (key) => ({ 'Authorization rejected': 'Autorisierung abgelehnt' })[key] || key,
    });

    await expect(client.pair('http://ha.local:8123')).rejects.toMatchObject({
      code: 'OAUTH_STATE_MISMATCH',
    });
    expect(page.statusCode).toBe(400);
    expect(page.body).toContain('<h1>Autorisierung abgelehnt</h1>');
  });

  test('abandons a pairing attempt and releases the loopback port when cancelled', async () => {
    const controller = new AbortController();
    const exchangeCode = jest.fn();
    let callbackOrigin;

    await expect(
      authorizeWithLoopback({
        baseUrl: 'http://ha.local:8123',
        signal: controller.signal,
        timeoutMs: 20000,
        openExternal: async (rawAuthorizationUrl) => {
          const authorizationUrl = new URL(rawAuthorizationUrl);
          callbackOrigin = new URL(authorizationUrl.searchParams.get('redirect_uri')).origin;
          controller.abort();
        },
        exchangeCode,
      })
    ).rejects.toMatchObject({ code: 'OAUTH_AUTHORIZATION_CANCELED' });

    expect(exchangeCode).not.toHaveBeenCalled();
    await expect(requestCallback(`${callbackOrigin}/oauth/callback`)).rejects.toMatchObject({
      code: 'ECONNREFUSED',
    });
  });

  test('rejects immediately when pairing starts with an already-cancelled signal', async () => {
    const controller = new AbortController();
    controller.abort();
    const openExternal = jest.fn();

    await expect(
      authorizeWithLoopback({
        baseUrl: 'http://ha.local:8123',
        signal: controller.signal,
        openExternal,
        exchangeCode: jest.fn(),
      })
    ).rejects.toMatchObject({ code: 'OAUTH_AUTHORIZATION_CANCELED' });
    expect(openExternal).not.toHaveBeenCalled();
  });

  test('cancelPairing only reports work when a pairing attempt is in flight', async () => {
    const userDataPath = createTemporaryDirectory();
    temporaryDirectories.push(userDataPath);
    let releaseBrowser;
    const browserOpened = new Promise((resolve) => {
      releaseBrowser = resolve;
    });
    const client = new HomeAssistantOAuthClient({
      safeStorage: createSafeStorage(),
      platform: 'linux',
      userDataPath,
      openExternal: jest.fn(async () => {
        releaseBrowser();
      }),
      postForm: jest.fn(),
      isSecureStorageAvailable: () => true,
    });

    expect(client.cancelPairing()).toBe(false);

    const pairing = client.pair('http://ha.local:8123');
    pairing.catch(() => {});
    await browserOpened;

    expect(client.cancelPairing()).toBe(true);
    expect(client.cancelPairing()).toBe(false);
    await expect(pairing).rejects.toMatchObject({ code: 'OAUTH_AUTHORIZATION_CANCELED' });
    expect(client.cancelPairing()).toBe(false);
  });

  test('pairing with another URL replaces the waiting pairing instead of joining it', async () => {
    const userDataPath = createTemporaryDirectory();
    temporaryDirectories.push(userDataPath);
    const openedUrls = [];
    const client = new HomeAssistantOAuthClient({
      safeStorage: createSafeStorage(),
      platform: 'linux',
      userDataPath,
      openExternal: jest.fn(async (url) => {
        openedUrls.push(new URL(url).origin);
      }),
      postForm: jest.fn(),
      isSecureStorageAvailable: () => true,
    });
    const waitForBrowser = async (count) => {
      for (let attempt = 0; attempt < 50 && openedUrls.length < count; attempt += 1) {
        await new Promise((resolve) => setTimeout(resolve, 5));
      }
    };

    const first = client.pair('http://old.local:8123');
    first.catch(() => {});
    await waitForBrowser(1);
    const joined = client.pair('old.local:8123');
    joined.catch(() => {});
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(openedUrls).toEqual(['http://old.local:8123']);

    const second = client.pair('http://new.local:8123');
    second.catch(() => {});
    await expect(first).rejects.toMatchObject({ code: 'OAUTH_AUTHORIZATION_CANCELED' });
    await expect(joined).rejects.toMatchObject({ code: 'OAUTH_AUTHORIZATION_CANCELED' });
    await waitForBrowser(2);
    expect(openedUrls).toEqual(['http://old.local:8123', 'http://new.local:8123']);
    expect(client.pairingBaseUrl).toBe('http://new.local:8123');

    expect(client.cancelPairing()).toBe(true);
    await expect(second).rejects.toMatchObject({ code: 'OAUTH_AUTHORIZATION_CANCELED' });
    expect(client.pairingPromise).toBeNull();
  });

  test('does not open a browser for a server that cannot be reached', async () => {
    const userDataPath = createTemporaryDirectory();
    temporaryDirectories.push(userDataPath);
    const openExternal = jest.fn();
    const probeServer = jest.fn(async () => {
      const error = new Error('Could not reach Home Assistant at that URL');
      error.code = 'OAUTH_SERVER_UNREACHABLE';
      throw error;
    });
    const client = new HomeAssistantOAuthClient({
      safeStorage: createSafeStorage(),
      platform: 'linux',
      userDataPath,
      openExternal,
      postForm: jest.fn(),
      probeServer,
      isSecureStorageAvailable: () => true,
    });

    await expect(client.pair('127.0.0.1:1')).rejects.toMatchObject({
      code: 'OAUTH_SERVER_UNREACHABLE',
    });
    expect(probeServer).toHaveBeenCalledWith('http://127.0.0.1:1', expect.any(AbortSignal));
    expect(openExternal).not.toHaveBeenCalled();
  });

  describe('server probe', () => {
    const createNet = (behaviour) => {
      const request = new (require('events').EventEmitter)();
      request.setHeader = jest.fn();
      request.abort = jest.fn();
      request.end = jest.fn(() => behaviour(request));
      return { net: { request: jest.fn(() => request) }, request };
    };

    test('accepts any HTTP answer from the server', async () => {
      const { net, request } = createNet((req) => req.emit('response', { statusCode: 404 }));
      await expect(
        probeHomeAssistantWithElectronNet(net, 'http://ha.local:8123')
      ).resolves.toBeUndefined();
      expect(net.request).toHaveBeenCalledWith(
        expect.objectContaining({ method: 'GET', url: 'http://ha.local:8123/auth/providers' })
      );
      expect(request.abort).toHaveBeenCalled();
    });

    test('reports a connection failure as an unreachable server', async () => {
      const { net } = createNet((req) =>
        req.emit('error', new Error('net::ERR_NAME_NOT_RESOLVED'))
      );
      await expect(
        probeHomeAssistantWithElectronNet(net, 'http://homeassistant.invalid:8123')
      ).rejects.toMatchObject({ code: 'OAUTH_SERVER_UNREACHABLE' });
    });

    test('gives up on a server that never answers', async () => {
      const { net, request } = createNet(() => {});
      await expect(
        probeHomeAssistantWithElectronNet(net, 'http://10.255.255.1:8123', { timeoutMs: 10 })
      ).rejects.toMatchObject({ code: 'OAUTH_SERVER_UNREACHABLE' });
      expect(request.abort).toHaveBeenCalled();
    });

    test('stops when the pairing is canceled', async () => {
      const { net, request } = createNet(() => {});
      const controller = new AbortController();
      const probe = probeHomeAssistantWithElectronNet(net, 'http://ha.local:8123', {
        signal: controller.signal,
      });
      controller.abort();
      await expect(probe).rejects.toMatchObject({ code: 'OAUTH_AUTHORIZATION_CANCELED' });
      expect(request.abort).toHaveBeenCalled();
    });
  });

  test('validates successful and rejected token responses', () => {
    expect(
      parseTokenResponse(
        {
          status: 200,
          body: JSON.stringify({
            access_token: 'access',
            refresh_token: 'refresh',
            expires_in: 1800,
          }),
        },
        { requireRefreshToken: true }
      )
    ).toEqual({ accessToken: 'access', refreshToken: 'refresh', expiresIn: 1800 });

    expect(() =>
      parseTokenResponse({ status: 400, body: JSON.stringify({ error: 'invalid_grant' }) })
    ).toThrow(expect.objectContaining({ code: 'OAUTH_INVALID_GRANT' }));
    expect(() =>
      parseTokenResponse({ status: 200, body: JSON.stringify({ access_token: 'access' }) })
    ).toThrow(expect.objectContaining({ code: 'OAUTH_TOKEN_RESPONSE' }));
  });

  test('stores only an encrypted refresh token and restores an in-memory access token', async () => {
    const userDataPath = createTemporaryDirectory();
    temporaryDirectories.push(userDataPath);
    const safeStorage = createSafeStorage();
    const postForm = jest.fn(async (_url, fields) => ({
      status: 200,
      body: JSON.stringify({
        access_token: `access-for-${fields.refresh_token}`,
        expires_in: 1800,
      }),
    }));
    const client = new HomeAssistantOAuthClient({
      safeStorage,
      platform: 'linux',
      userDataPath,
      openExternal: jest.fn(),
      postForm,
      isSecureStorageAvailable: () => true,
      now: () => 1000,
    });

    client.writeCredentials({
      baseUrl: 'https://ha.example.test',
      clientId: 'http://127.0.0.1:40123/',
      redirectUri: 'http://127.0.0.1:40123/oauth/callback',
      refreshToken: 'refresh-secret',
    });

    const credentialsBody = fs.readFileSync(
      path.join(userDataPath, OAUTH_CREDENTIALS_FILE),
      'utf8'
    );
    expect(credentialsBody).not.toContain('refresh-secret');
    expect(credentialsBody).not.toContain('access-for-');
    if (process.platform !== 'win32') {
      expect(fs.statSync(path.join(userDataPath, OAUTH_CREDENTIALS_FILE)).mode & 0o777).toBe(0o600);
    }

    const restored = await client.restore();
    expect(restored).toEqual({
      baseUrl: 'https://ha.example.test',
      accessToken: 'access-for-refresh-secret',
      expiresAt: 1801000,
      authorizationId: expect.stringMatching(/^[0-9a-f]{16}$/),
    });
    expect(restored.authorizationId).not.toContain('refresh-secret');
    expect(postForm).toHaveBeenCalledWith('https://ha.example.test/auth/token', {
      grant_type: 'refresh_token',
      refresh_token: 'refresh-secret',
      client_id: 'http://127.0.0.1:40123/',
    });
  });

  test('keeps one authorization id while the access token rotates', async () => {
    const userDataPath = createTemporaryDirectory();
    temporaryDirectories.push(userDataPath);
    let issued = 0;
    const client = new HomeAssistantOAuthClient({
      safeStorage: createSafeStorage(),
      platform: 'linux',
      userDataPath,
      openExternal: jest.fn(),
      postForm: jest.fn(async () => ({
        status: 200,
        body: JSON.stringify({ access_token: `access-${(issued += 1)}`, expires_in: 1800 }),
      })),
      isSecureStorageAvailable: () => true,
    });
    const credentials = {
      baseUrl: 'https://ha.example.test',
      clientId: 'http://127.0.0.1:40123/',
      redirectUri: 'http://127.0.0.1:40123/oauth/callback',
      refreshToken: 'refresh-one',
    };
    client.writeCredentials(credentials);

    const first = await client.restore();
    const second = await client.refresh();
    expect(second.accessToken).not.toBe(first.accessToken);
    expect(second.authorizationId).toBe(first.authorizationId);

    client.writeCredentials({ ...credentials, refreshToken: 'refresh-two' });
    const reauthorized = await client.refresh();
    expect(reauthorized.authorizationId).not.toBe(first.authorizationId);
  });

  test('refuses to read or write OAuth credentials without secure storage', () => {
    const userDataPath = createTemporaryDirectory();
    temporaryDirectories.push(userDataPath);
    const client = new HomeAssistantOAuthClient({
      safeStorage: createSafeStorage(),
      platform: 'linux',
      userDataPath,
      openExternal: jest.fn(),
      postForm: jest.fn(),
      isSecureStorageAvailable: () => false,
    });

    expect(() => client.readCredentials()).toThrow(
      expect.objectContaining({ code: 'OAUTH_SECURE_STORAGE_UNAVAILABLE' })
    );
    expect(() =>
      client.writeCredentials({
        baseUrl: 'https://ha.example.test',
        refreshToken: 'secret',
      })
    ).toThrow(expect.objectContaining({ code: 'OAUTH_SECURE_STORAGE_UNAVAILABLE' }));
  });

  test('clears an invalid refresh grant and revokes locally even when Home Assistant is offline', async () => {
    const userDataPath = createTemporaryDirectory();
    temporaryDirectories.push(userDataPath);
    const client = new HomeAssistantOAuthClient({
      safeStorage: createSafeStorage(),
      platform: 'linux',
      userDataPath,
      openExternal: jest.fn(),
      postForm: jest.fn(async () => ({
        status: 400,
        body: JSON.stringify({ error: 'invalid_grant' }),
      })),
      isSecureStorageAvailable: () => true,
    });
    client.writeCredentials({
      baseUrl: 'https://ha.example.test',
      clientId: 'http://127.0.0.1:40123/',
      redirectUri: 'http://127.0.0.1:40123/oauth/callback',
      refreshToken: 'expired-refresh',
    });

    await expect(client.restore()).rejects.toMatchObject({ code: 'OAUTH_INVALID_GRANT' });
    expect(fs.existsSync(path.join(userDataPath, OAUTH_CREDENTIALS_FILE))).toBe(false);

    client.writeCredentials({
      baseUrl: 'https://ha.example.test',
      clientId: 'http://127.0.0.1:40123/',
      redirectUri: 'http://127.0.0.1:40123/oauth/callback',
      refreshToken: 'another-refresh',
    });
    client.postForm = jest.fn(async () => {
      throw new Error('offline');
    });
    await expect(client.revoke()).resolves.toMatchObject({
      success: true,
      revokedRemotely: false,
    });
    expect(fs.existsSync(path.join(userDataPath, OAUTH_CREDENTIALS_FILE))).toBe(false);
  });
});

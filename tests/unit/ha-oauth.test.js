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

    await expect(client.restore()).resolves.toEqual({
      baseUrl: 'https://ha.example.test',
      accessToken: 'access-for-refresh-secret',
      expiresAt: 1801000,
    });
    expect(postForm).toHaveBeenCalledWith('https://ha.example.test/auth/token', {
      grant_type: 'refresh_token',
      refresh_token: 'refresh-secret',
      client_id: 'http://127.0.0.1:40123/',
    });
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

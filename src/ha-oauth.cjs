const fs = require('fs');
const http = require('http');
const path = require('path');
const nodeCrypto = require('crypto');

const OAUTH_CREDENTIALS_VERSION = 1;
const OAUTH_CREDENTIALS_FILE = 'home-assistant-oauth.json';
const OAUTH_CALLBACK_PATH = '/oauth/callback';
const OAUTH_PAIRING_TIMEOUT_MS = 5 * 60 * 1000;
const OAUTH_HTTP_TIMEOUT_MS = 15 * 1000;
const OAUTH_MAX_RESPONSE_BYTES = 64 * 1024;

function createOAuthError(message, code, status = 0) {
  const error = new Error(message);
  error.code = code;
  if (status) error.status = status;
  return error;
}

function normalizeHomeAssistantBaseUrl(rawUrl) {
  const trimmed = typeof rawUrl === 'string' ? rawUrl.trim() : '';
  if (!trimmed) return null;
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed) && !/^https?:\/\//i.test(trimmed)) {
    return null;
  }
  const withProtocol = /^https?:\/\//i.test(trimmed) ? trimmed : `http://${trimmed}`;
  try {
    const parsed = new URL(withProtocol);
    if (!['http:', 'https:'].includes(parsed.protocol) || !parsed.hostname) return null;
    if (parsed.username || parsed.password) return null;
    return parsed.origin.replace(/\/+$/, '');
  } catch {
    return null;
  }
}

function isLoopbackOAuthClient(clientId, redirectUri) {
  try {
    const client = new URL(clientId);
    const redirect = new URL(redirectUri);
    const loopbackHosts = new Set(['127.0.0.1', '[::1]', 'localhost']);
    return (
      client.protocol === 'http:' &&
      loopbackHosts.has(client.hostname) &&
      client.origin === redirect.origin &&
      redirect.pathname === OAUTH_CALLBACK_PATH
    );
  } catch {
    return false;
  }
}

function buildAuthorizationUrl(baseUrl, clientId, redirectUri, state) {
  const authorizeUrl = new URL('/auth/authorize', `${baseUrl}/`);
  authorizeUrl.searchParams.set('client_id', clientId);
  authorizeUrl.searchParams.set('redirect_uri', redirectUri);
  authorizeUrl.searchParams.set('state', state);
  return authorizeUrl.toString();
}

function statesMatch(expected, received) {
  if (typeof expected !== 'string' || typeof received !== 'string') return false;
  const expectedBuffer = Buffer.from(expected);
  const receivedBuffer = Buffer.from(received);
  return (
    expectedBuffer.length === receivedBuffer.length &&
    nodeCrypto.timingSafeEqual(expectedBuffer, receivedBuffer)
  );
}

function sendCallbackPage(response, statusCode, title, message) {
  const body = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'"><title>${title}</title></head><body style="font-family:system-ui,sans-serif;max-width:36rem;margin:4rem auto;padding:0 1rem"><h1>${title}</h1><p>${message}</p></body></html>`;
  response.writeHead(statusCode, {
    'Content-Type': 'text/html; charset=utf-8',
    'Cache-Control': 'no-store',
    'Content-Length': Buffer.byteLength(body),
    'X-Content-Type-Options': 'nosniff',
  });
  response.end(body);
}

async function authorizeWithLoopback({
  baseUrl,
  openExternal,
  exchangeCode,
  timeoutMs = OAUTH_PAIRING_TIMEOUT_MS,
  createServer = http.createServer,
  randomBytes = nodeCrypto.randomBytes,
}) {
  const normalizedBaseUrl = normalizeHomeAssistantBaseUrl(baseUrl);
  if (!normalizedBaseUrl) {
    throw createOAuthError('Enter a valid Home Assistant URL', 'OAUTH_INVALID_URL');
  }
  if (typeof openExternal !== 'function' || typeof exchangeCode !== 'function') {
    throw new TypeError('OAuth browser and token exchange callbacks are required');
  }

  const state = randomBytes(32).toString('base64url');
  let settleCallback;
  let rejectCallback;
  let settled = false;
  const callbackPromise = new Promise((resolve, reject) => {
    settleCallback = resolve;
    rejectCallback = reject;
  });
  // Register a handler immediately so a fast callback cannot surface as an
  // unhandled rejection while the operating system is still opening a browser.
  callbackPromise.catch(() => {});

  const server = createServer((request, response) => {
    const requestUrl = new URL(request.url || '/', 'http://127.0.0.1');
    if (request.method !== 'GET' || requestUrl.pathname !== OAUTH_CALLBACK_PATH) {
      response.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      response.end('Not found');
      return;
    }
    if (settled) {
      sendCallbackPage(response, 409, 'Authorization already handled', 'Return to the app.');
      return;
    }

    settled = true;
    const returnedState = requestUrl.searchParams.get('state') || '';
    if (!statesMatch(state, returnedState)) {
      sendCallbackPage(
        response,
        400,
        'Authorization rejected',
        'The authorization state did not match. Return to the app and try again.'
      );
      rejectCallback(
        createOAuthError('Home Assistant returned an invalid OAuth state', 'OAUTH_STATE_MISMATCH')
      );
      return;
    }

    const oauthError = (
      requestUrl.searchParams.get('error_description') ||
      requestUrl.searchParams.get('error') ||
      ''
    )
      .trim()
      .slice(0, 512);
    if (oauthError) {
      sendCallbackPage(response, 400, 'Authorization declined', 'Return to the app to try again.');
      rejectCallback(createOAuthError(oauthError, 'OAUTH_AUTHORIZATION_DECLINED'));
      return;
    }

    const code = (requestUrl.searchParams.get('code') || '').trim();
    if (!code || code.length > 4096) {
      sendCallbackPage(
        response,
        400,
        'Authorization incomplete',
        'Home Assistant did not return a valid authorization code.'
      );
      rejectCallback(
        createOAuthError(
          'Home Assistant did not return an authorization code',
          'OAUTH_CODE_MISSING'
        )
      );
      return;
    }

    sendCallbackPage(
      response,
      200,
      'HA Desktop Widget connected',
      'You can close this browser tab and return to the desktop app.'
    );
    settleCallback(code);
  });

  await new Promise((resolve, reject) => {
    const onError = (error) => reject(error);
    server.once('error', onError);
    server.listen(0, '127.0.0.1', () => {
      server.removeListener('error', onError);
      resolve();
    });
  });

  const address = server.address();
  if (!address || typeof address === 'string') {
    server.close();
    throw createOAuthError('Could not open a local OAuth callback', 'OAUTH_CALLBACK_FAILED');
  }
  const callbackOrigin = `http://127.0.0.1:${address.port}`;
  const clientId = `${callbackOrigin}/`;
  const redirectUri = `${callbackOrigin}${OAUTH_CALLBACK_PATH}`;
  const authorizationUrl = buildAuthorizationUrl(normalizedBaseUrl, clientId, redirectUri, state);

  const timeoutId = setTimeout(() => {
    if (settled) return;
    settled = true;
    rejectCallback(
      createOAuthError('Home Assistant authorization timed out', 'OAUTH_AUTHORIZATION_TIMEOUT')
    );
  }, timeoutMs);
  timeoutId.unref?.();

  try {
    await openExternal(authorizationUrl);
    const code = await callbackPromise;
    return await exchangeCode({
      baseUrl: normalizedBaseUrl,
      clientId,
      redirectUri,
      code,
    });
  } finally {
    clearTimeout(timeoutId);
    await new Promise((resolve) => server.close(() => resolve()));
  }
}

function requestFormWithElectronNet(electronNet, url, fields, timeoutMs = OAUTH_HTTP_TIMEOUT_MS) {
  return new Promise((resolve, reject) => {
    const body = new URLSearchParams(fields).toString();
    let completed = false;
    const request = electronNet.request({ method: 'POST', url, redirect: 'follow' });
    const finish = (error, result) => {
      if (completed) return;
      completed = true;
      clearTimeout(timeoutId);
      if (error) reject(error);
      else resolve(result);
    };
    const timeoutId = setTimeout(() => {
      try {
        request.abort();
      } catch {
        // The request may already have completed.
      }
      finish(createOAuthError('Home Assistant token request timed out', 'OAUTH_TOKEN_TIMEOUT'));
    }, timeoutMs);
    timeoutId.unref?.();

    request.setHeader('Content-Type', 'application/x-www-form-urlencoded;charset=UTF-8');
    request.setHeader('Accept', 'application/json');
    request.on('response', (response) => {
      const chunks = [];
      let receivedBytes = 0;
      response.on('data', (chunk) => {
        if (completed) return;
        const buffer = Buffer.from(chunk);
        receivedBytes += buffer.length;
        if (receivedBytes > OAUTH_MAX_RESPONSE_BYTES) {
          try {
            request.abort();
          } catch {
            // The request may already have completed.
          }
          finish(
            createOAuthError('Home Assistant token response was too large', 'OAUTH_TOKEN_RESPONSE')
          );
          return;
        }
        chunks.push(buffer);
      });
      response.on('end', () => {
        finish(null, {
          status: Number(response.statusCode || 0),
          body: Buffer.concat(chunks).toString('utf8'),
        });
      });
    });
    request.on('error', (error) => {
      finish(
        createOAuthError(
          error?.message || 'Home Assistant token request failed',
          'OAUTH_TOKEN_NETWORK'
        )
      );
    });
    try {
      request.write(body);
      request.end();
    } catch (error) {
      finish(createOAuthError(error?.message || String(error), 'OAUTH_TOKEN_NETWORK'));
    }
  });
}

function parseTokenResponse(response, { requireRefreshToken = false } = {}) {
  let parsed;
  try {
    parsed = JSON.parse(response?.body || '{}');
  } catch {
    throw createOAuthError(
      'Home Assistant returned an invalid token response',
      'OAUTH_TOKEN_RESPONSE'
    );
  }
  const status = Number(response?.status || 0);
  if (status < 200 || status >= 300) {
    const description = String(parsed?.error_description || parsed?.error || '')
      .trim()
      .slice(0, 512);
    const code = status === 400 ? 'OAUTH_INVALID_GRANT' : 'OAUTH_TOKEN_EXCHANGE_FAILED';
    throw createOAuthError(
      description || 'Home Assistant rejected the token request',
      code,
      status
    );
  }
  const accessToken = typeof parsed.access_token === 'string' ? parsed.access_token.trim() : '';
  const refreshToken = typeof parsed.refresh_token === 'string' ? parsed.refresh_token.trim() : '';
  const expiresIn = Number(parsed.expires_in);
  if (!accessToken || !Number.isFinite(expiresIn) || expiresIn <= 0) {
    throw createOAuthError(
      'Home Assistant returned an incomplete token response',
      'OAUTH_TOKEN_RESPONSE'
    );
  }
  if (requireRefreshToken && !refreshToken) {
    throw createOAuthError('Home Assistant did not return a refresh token', 'OAUTH_TOKEN_RESPONSE');
  }
  return { accessToken, refreshToken, expiresIn };
}

class HomeAssistantOAuthClient {
  constructor({
    safeStorage,
    platform,
    userDataPath,
    openExternal,
    postForm,
    isSecureStorageAvailable,
    now = Date.now,
    log = console,
  }) {
    this.safeStorage = safeStorage;
    this.platform = platform;
    this.userDataPath = userDataPath;
    this.openExternal = openExternal;
    this.postForm = postForm;
    this.isSecureStorageAvailable = isSecureStorageAvailable;
    this.now = now;
    this.log = log;
    this.credentialsPath = path.join(userDataPath, OAUTH_CREDENTIALS_FILE);
    this.session = null;
    this.refreshPromise = null;
    this.pairingPromise = null;
  }

  assertSecureStorage() {
    if (!this.isSecureStorageAvailable(this.safeStorage, this.platform)) {
      throw createOAuthError(
        'Secure credential storage is unavailable on this system',
        'OAUTH_SECURE_STORAGE_UNAVAILABLE'
      );
    }
  }

  readCredentials() {
    this.assertSecureStorage();
    let stored;
    try {
      stored = JSON.parse(fs.readFileSync(this.credentialsPath, 'utf8'));
    } catch (error) {
      if (error?.code === 'ENOENT') return null;
      throw createOAuthError(
        'Saved Home Assistant authorization is unreadable',
        'OAUTH_STORE_READ'
      );
    }
    const baseUrl = normalizeHomeAssistantBaseUrl(stored?.baseUrl);
    if (
      stored?.version !== OAUTH_CREDENTIALS_VERSION ||
      !baseUrl ||
      !isLoopbackOAuthClient(stored.clientId, stored.redirectUri) ||
      typeof stored.refreshTokenEncrypted !== 'string' ||
      !stored.refreshTokenEncrypted
    ) {
      throw createOAuthError(
        'Saved Home Assistant authorization is invalid',
        'OAUTH_STORE_INVALID'
      );
    }
    try {
      const refreshToken = this.safeStorage.decryptString(
        Buffer.from(stored.refreshTokenEncrypted, 'base64')
      );
      if (!refreshToken) throw new Error('empty refresh token');
      return {
        baseUrl,
        clientId: stored.clientId,
        redirectUri: stored.redirectUri,
        refreshToken,
      };
    } catch {
      throw createOAuthError(
        'Saved Home Assistant authorization could not be decrypted',
        'OAUTH_STORE_DECRYPT'
      );
    }
  }

  writeCredentials(credentials) {
    this.assertSecureStorage();
    const encrypted = this.safeStorage.encryptString(credentials.refreshToken).toString('base64');
    const payload = JSON.stringify(
      {
        version: OAUTH_CREDENTIALS_VERSION,
        baseUrl: credentials.baseUrl,
        clientId: credentials.clientId,
        redirectUri: credentials.redirectUri,
        refreshTokenEncrypted: encrypted,
      },
      null,
      2
    );
    fs.mkdirSync(this.userDataPath, { recursive: true });
    const temporaryPath = `${this.credentialsPath}.${nodeCrypto.randomBytes(8).toString('hex')}.tmp`;
    try {
      fs.writeFileSync(temporaryPath, payload, { encoding: 'utf8', mode: 0o600 });
      fs.renameSync(temporaryPath, this.credentialsPath);
      try {
        fs.chmodSync(this.credentialsPath, 0o600);
      } catch {
        // Windows does not apply POSIX file modes.
      }
    } catch (error) {
      try {
        fs.unlinkSync(temporaryPath);
      } catch {
        // Best-effort cleanup only.
      }
      throw createOAuthError(
        error?.message || 'Could not store Home Assistant authorization',
        'OAUTH_STORE_WRITE'
      );
    }
  }

  clearCredentials() {
    this.session = null;
    try {
      fs.unlinkSync(this.credentialsPath);
    } catch (error) {
      if (error?.code !== 'ENOENT') {
        throw createOAuthError(
          error?.message || 'Could not clear Home Assistant authorization',
          'OAUTH_STORE_CLEAR'
        );
      }
    }
  }

  createSession(credentials, tokens) {
    this.session = {
      baseUrl: credentials.baseUrl,
      clientId: credentials.clientId,
      redirectUri: credentials.redirectUri,
      refreshToken: credentials.refreshToken,
      accessToken: tokens.accessToken,
      expiresAt: this.now() + tokens.expiresIn * 1000,
    };
    return this.publicSession();
  }

  publicSession() {
    if (!this.session) return null;
    return {
      baseUrl: this.session.baseUrl,
      accessToken: this.session.accessToken,
      expiresAt: this.session.expiresAt,
    };
  }

  async pair(baseUrl) {
    if (this.pairingPromise) return this.pairingPromise;
    this.assertSecureStorage();
    this.pairingPromise = authorizeWithLoopback({
      baseUrl,
      openExternal: this.openExternal,
      exchangeCode: async ({ baseUrl: resolvedBaseUrl, clientId, redirectUri, code }) => {
        const response = await this.postForm(`${resolvedBaseUrl}/auth/token`, {
          grant_type: 'authorization_code',
          code,
          client_id: clientId,
        });
        const tokens = parseTokenResponse(response, { requireRefreshToken: true });
        const credentials = {
          baseUrl: resolvedBaseUrl,
          clientId,
          redirectUri,
          refreshToken: tokens.refreshToken,
        };
        this.writeCredentials(credentials);
        return this.createSession(credentials, tokens);
      },
    });
    try {
      return await this.pairingPromise;
    } finally {
      this.pairingPromise = null;
    }
  }

  async restore() {
    const credentials = this.readCredentials();
    if (!credentials) return null;
    return this.refresh(credentials);
  }

  async refresh(credentials = null) {
    if (this.refreshPromise) return this.refreshPromise;
    const resolvedCredentials = credentials || this.readCredentials();
    if (!resolvedCredentials) return null;
    this.refreshPromise = (async () => {
      try {
        const response = await this.postForm(`${resolvedCredentials.baseUrl}/auth/token`, {
          grant_type: 'refresh_token',
          refresh_token: resolvedCredentials.refreshToken,
          client_id: resolvedCredentials.clientId,
        });
        const tokens = parseTokenResponse(response);
        return this.createSession(resolvedCredentials, tokens);
      } catch (error) {
        if (error?.code === 'OAUTH_INVALID_GRANT') {
          this.clearCredentials();
        }
        throw error;
      }
    })();
    try {
      return await this.refreshPromise;
    } finally {
      this.refreshPromise = null;
    }
  }

  async revoke() {
    let credentials = null;
    try {
      credentials = this.readCredentials();
    } catch (error) {
      this.log.warn?.('Saved Home Assistant OAuth credentials could not be read for revocation');
      this.clearCredentials();
      return { success: true, revokedRemotely: false, warning: error?.message || String(error) };
    }
    let revokedRemotely = false;
    let warning = '';
    if (credentials) {
      try {
        const response = await this.postForm(`${credentials.baseUrl}/auth/revoke`, {
          token: credentials.refreshToken,
        });
        revokedRemotely = Number(response?.status || 0) === 200;
        if (!revokedRemotely) warning = 'Home Assistant did not confirm token revocation';
      } catch (error) {
        warning = error?.message || 'Home Assistant could not be reached for token revocation';
      }
    }
    this.clearCredentials();
    return { success: true, revokedRemotely, ...(warning ? { warning } : {}) };
  }
}

module.exports = {
  OAUTH_CALLBACK_PATH,
  OAUTH_CREDENTIALS_FILE,
  HomeAssistantOAuthClient,
  authorizeWithLoopback,
  buildAuthorizationUrl,
  isLoopbackOAuthClient,
  normalizeHomeAssistantBaseUrl,
  parseTokenResponse,
  requestFormWithElectronNet,
};

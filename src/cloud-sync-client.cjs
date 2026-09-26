const fs = require('fs');
const http = require('http');
const path = require('path');
const nodeCrypto = require('crypto');
const { OAUTH_CALLBACK_PATH, sendCallbackPage, statesMatch } = require('./ha-oauth.cjs');

// The hosted sync service this build talks to. Empty keeps the Cloud option
// hidden; set it (or HA_WIDGET_CLOUD_SYNC_URL) once the service is deployed.
const DEFAULT_CLOUD_SYNC_SERVICE_URL = '';
const CLOUD_SYNC_CREDENTIALS_VERSION = 1;
const CLOUD_SYNC_CREDENTIALS_FILE = 'cloud-sync-account.json';
const CLOUD_SYNC_SIGN_IN_TIMEOUT_MS = 5 * 60 * 1000;
const CLOUD_SYNC_REQUEST_TIMEOUT_MS = 20 * 1000;
// A little over the service's 512 KB profile limit, for headers and errors.
const CLOUD_SYNC_MAX_RESPONSE_BYTES = 600 * 1024;
const CLOUD_SYNC_PROVIDERS = new Set(['google', 'github']);

function createCloudSyncError(message, code, status = 0) {
  const error = new Error(message);
  error.code = code;
  if (status) error.status = status;
  return error;
}

/**
 * Accepts an https service address, or plain http on this machine for local
 * development, and reduces it to its origin.
 */
function normalizeCloudSyncServiceUrl(value) {
  const trimmed = typeof value === 'string' ? value.trim() : '';
  if (!trimmed) return '';
  try {
    const url = new URL(trimmed);
    const local = ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname);
    if (url.protocol !== 'https:' && !(url.protocol === 'http:' && local)) return '';
    if (url.username || url.password) return '';
    return url.origin;
  } catch {
    return '';
  }
}

function resolveCloudSyncServiceUrl(env = process.env) {
  return normalizeCloudSyncServiceUrl(
    env.HA_WIDGET_CLOUD_SYNC_URL || DEFAULT_CLOUD_SYNC_SERVICE_URL
  );
}

function parseEtagRevision(value) {
  const match = /^(?:W\/)?"(\d{1,15})"$/.exec(String(value || '').trim());
  return match ? Number(match[1]) : null;
}

/**
 * Waits for the browser to return to a one-shot loopback address, as the
 * service's sign-in hands its one-time code to the app there.
 */
function listenForLoopbackCallback({
  signal,
  timeoutMs,
  createServer,
  translate: t,
  expectedState,
}) {
  let settle;
  let fail;
  let settled = false;
  const result = new Promise((resolve, reject) => {
    settle = resolve;
    fail = reject;
  });
  result.catch(() => {});
  const finish = (callback, value) => {
    if (settled) return;
    settled = true;
    callback(value);
  };
  const onAbort = () =>
    finish(fail, createCloudSyncError('Sign-in was canceled', 'CLOUD_SYNC_SIGN_IN_CANCELED'));
  signal?.addEventListener('abort', onAbort, { once: true });

  const server = createServer((request, response) => {
    const url = new URL(request.url || '/', 'http://127.0.0.1');
    if (request.method !== 'GET' || url.pathname !== OAUTH_CALLBACK_PATH) {
      response.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      response.end('Not found');
      return;
    }
    if (settled) {
      sendCallbackPage(response, 409, t('Sign-in already handled'), t('Return to the app.'));
      return;
    }
    if (!statesMatch(expectedState, url.searchParams.get('state') || '')) {
      sendCallbackPage(
        response,
        400,
        t('Sign-in rejected'),
        t('The sign-in did not match this app. Return to the app and try again.')
      );
      finish(fail, createCloudSyncError('Sign-in state did not match', 'CLOUD_SYNC_STATE'));
      return;
    }
    const error = url.searchParams.get('error');
    const code = url.searchParams.get('code') || '';
    if (error || !code || code.length > 256) {
      sendCallbackPage(
        response,
        400,
        t('Sign-in not completed'),
        t('Return to the app to try again.')
      );
      finish(
        fail,
        createCloudSyncError(
          error === 'access_denied' ? 'Sign-in was declined' : 'Sign-in did not complete',
          error === 'access_denied' ? 'CLOUD_SYNC_SIGN_IN_DECLINED' : 'CLOUD_SYNC_SIGN_IN_FAILED'
        )
      );
      return;
    }
    sendCallbackPage(
      response,
      200,
      t('Signed in to Cloud Sync'),
      t('You can close this browser tab and return to the desktop app.')
    );
    finish(settle, code);
  });

  const listening = new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      server.removeListener('error', reject);
      resolve();
    });
  });
  const timeoutId = setTimeout(
    () => finish(fail, createCloudSyncError('Sign-in timed out', 'CLOUD_SYNC_SIGN_IN_TIMEOUT')),
    timeoutMs
  );
  timeoutId.unref?.();

  return {
    listening,
    result,
    redirectUri: () => `http://127.0.0.1:${server.address().port}${OAUTH_CALLBACK_PATH}`,
    close: async () => {
      clearTimeout(timeoutId);
      signal?.removeEventListener('abort', onAbort);
      server.closeAllConnections?.();
      await new Promise((resolve) => server.close(() => resolve()));
    },
  };
}

/**
 * The desktop side of Cloud Sync: signing in through the browser, keeping the
 * session token in secure storage, and reading and writing the synced profile.
 */
class CloudSyncClient {
  constructor({
    serviceUrl,
    safeStorage,
    platform,
    userDataPath,
    openExternal,
    fetchImpl,
    isSecureStorageAvailable,
    deviceName = '',
    translate = (text) => text,
    createServer = http.createServer,
    randomBytes = nodeCrypto.randomBytes,
    signInTimeoutMs = CLOUD_SYNC_SIGN_IN_TIMEOUT_MS,
    requestTimeoutMs = CLOUD_SYNC_REQUEST_TIMEOUT_MS,
  }) {
    this.serviceUrl = normalizeCloudSyncServiceUrl(serviceUrl);
    this.safeStorage = safeStorage;
    this.platform = platform;
    this.userDataPath = userDataPath;
    this.openExternal = openExternal;
    this.fetchImpl = fetchImpl;
    this.isSecureStorageAvailable = isSecureStorageAvailable;
    this.deviceName = String(deviceName || '').slice(0, 64);
    this.translate = translate;
    this.createServer = createServer;
    this.randomBytes = randomBytes;
    this.signInTimeoutMs = signInTimeoutMs;
    this.requestTimeoutMs = requestTimeoutMs;
    this.credentialsPath = path.join(userDataPath, CLOUD_SYNC_CREDENTIALS_FILE);
    this.signInController = null;
  }

  isAvailable() {
    return !!this.serviceUrl;
  }

  assertAvailable() {
    if (!this.isAvailable()) {
      throw createCloudSyncError(
        'Cloud Sync is not available in this build',
        'CLOUD_SYNC_UNAVAILABLE'
      );
    }
  }

  assertSecureStorage() {
    if (!this.isSecureStorageAvailable(this.safeStorage, this.platform)) {
      throw createCloudSyncError(
        'Secure credential storage is unavailable on this system',
        'CLOUD_SYNC_SECURE_STORAGE_UNAVAILABLE'
      );
    }
  }

  readStoredCredentials() {
    let stored;
    try {
      stored = JSON.parse(fs.readFileSync(this.credentialsPath, 'utf8'));
    } catch {
      return null;
    }
    if (
      stored?.version !== CLOUD_SYNC_CREDENTIALS_VERSION ||
      stored.serviceUrl !== this.serviceUrl ||
      typeof stored.tokenEncrypted !== 'string' ||
      !stored.tokenEncrypted
    ) {
      return null;
    }
    return stored;
  }

  /** The signed-in account as last seen, without a network request. */
  getStoredAccount() {
    if (!this.isAvailable()) return null;
    const stored = this.readStoredCredentials();
    return stored ? { email: stored.email || '', provider: stored.provider || '' } : null;
  }

  readToken() {
    this.assertAvailable();
    const stored = this.readStoredCredentials();
    if (!stored) {
      throw createCloudSyncError('Sign in to Cloud Sync to keep syncing', 'CLOUD_SYNC_SIGNED_OUT');
    }
    this.assertSecureStorage();
    try {
      const token = this.safeStorage.decryptString(Buffer.from(stored.tokenEncrypted, 'base64'));
      if (!token) throw new Error('empty token');
      return token;
    } catch {
      throw createCloudSyncError(
        'The saved Cloud Sync sign-in could not be read. Sign in again.',
        'CLOUD_SYNC_SIGNED_OUT'
      );
    }
  }

  writeCredentials({ token, email, provider }) {
    this.assertSecureStorage();
    const payload = JSON.stringify(
      {
        version: CLOUD_SYNC_CREDENTIALS_VERSION,
        serviceUrl: this.serviceUrl,
        email: email || '',
        provider,
        tokenEncrypted: this.safeStorage.encryptString(token).toString('base64'),
      },
      null,
      2
    );
    fs.mkdirSync(this.userDataPath, { recursive: true });
    const temporaryPath = `${this.credentialsPath}.${this.randomBytes(8).toString('hex')}.tmp`;
    try {
      fs.writeFileSync(temporaryPath, payload, { encoding: 'utf8', mode: 0o600 });
      fs.renameSync(temporaryPath, this.credentialsPath);
    } catch (error) {
      try {
        fs.unlinkSync(temporaryPath);
      } catch {
        // Best-effort cleanup only.
      }
      throw error;
    }
  }

  clearCredentials() {
    try {
      fs.unlinkSync(this.credentialsPath);
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error;
    }
  }

  async request(pathname, { method = 'GET', token = null, body, headers = {} } = {}) {
    this.assertAvailable();
    const init = {
      method,
      headers: { Accept: 'application/json', ...headers },
      signal: AbortSignal.timeout(this.requestTimeoutMs),
      redirect: 'error',
    };
    if (token) init.headers.Authorization = `Bearer ${token}`;
    if (body !== undefined) {
      init.body = typeof body === 'string' ? body : JSON.stringify(body);
      init.headers['Content-Type'] = 'application/json';
    }
    let response;
    try {
      response = await this.fetchImpl(`${this.serviceUrl}${pathname}`, init);
    } catch (error) {
      throw createCloudSyncError(
        'Cloud Sync could not be reached. Check your connection.',
        error?.name === 'TimeoutError' ? 'CLOUD_SYNC_TIMEOUT' : 'CLOUD_SYNC_NETWORK'
      );
    }
    const text = await response.text();
    if (Buffer.byteLength(text, 'utf8') > CLOUD_SYNC_MAX_RESPONSE_BYTES) {
      throw createCloudSyncError(
        'Cloud Sync sent an unexpectedly large reply',
        'CLOUD_SYNC_RESPONSE'
      );
    }
    return { status: response.status, headers: response.headers, text };
  }

  /**
   * An authenticated request. An expired or revoked session clears the saved
   * sign-in, so the app shows the signed-out state instead of retrying forever.
   */
  async authedRequest(pathname, options = {}) {
    const response = await this.request(pathname, { ...options, token: this.readToken() });
    if (response.status === 401) {
      this.clearCredentials();
      throw createCloudSyncError(
        'Sign in to Cloud Sync again to keep syncing',
        'CLOUD_SYNC_SIGNED_OUT',
        401
      );
    }
    return response;
  }

  static parseJson(response) {
    try {
      return JSON.parse(response.text || '{}');
    } catch {
      return {};
    }
  }

  static failure(response, fallback) {
    const body = CloudSyncClient.parseJson(response);
    return createCloudSyncError(
      typeof body.message === 'string' && body.message ? body.message : fallback,
      typeof body.error === 'string'
        ? `CLOUD_SYNC_${body.error.toUpperCase()}`
        : 'CLOUD_SYNC_ERROR',
      response.status
    );
  }

  async getServiceConfig() {
    const response = await this.request('/v1/config');
    if (response.status !== 200)
      throw CloudSyncClient.failure(response, 'Cloud Sync is unavailable');
    const body = CloudSyncClient.parseJson(response);
    return {
      providers: (Array.isArray(body.providers) ? body.providers : []).filter((provider) =>
        CLOUD_SYNC_PROVIDERS.has(provider)
      ),
      billingAvailable: body.billingAvailable === true,
    };
  }

  /**
   * Signs in through the browser: the service redirects back to a one-shot
   * loopback address with a one-time code, which is redeemed with this
   * sign-in's PKCE verifier for a session token.
   */
  async signIn(provider) {
    this.assertAvailable();
    if (!CLOUD_SYNC_PROVIDERS.has(provider)) {
      throw createCloudSyncError('Unsupported sign-in method', 'CLOUD_SYNC_PROVIDER');
    }
    this.assertSecureStorage();
    this.cancelSignIn();
    const controller = new AbortController();
    this.signInController = controller;
    const verifier = this.randomBytes(32).toString('base64url');
    const challenge = nodeCrypto.createHash('sha256').update(verifier).digest('base64url');
    const state = this.randomBytes(32).toString('base64url');
    const callback = listenForLoopbackCallback({
      signal: controller.signal,
      timeoutMs: this.signInTimeoutMs,
      createServer: this.createServer,
      translate: this.translate,
      expectedState: state,
    });
    try {
      await callback.listening;
      const redirectUri = callback.redirectUri();
      const startUrl = new URL(`${this.serviceUrl}/v1/auth/start`);
      startUrl.search = new URLSearchParams({
        provider,
        redirect_uri: redirectUri,
        state,
        code_challenge: challenge,
        code_challenge_method: 'S256',
      }).toString();
      await this.openExternal(startUrl.toString());
      const code = await callback.result;
      const response = await this.request('/v1/auth/token', {
        method: 'POST',
        body: {
          code,
          code_verifier: verifier,
          redirect_uri: redirectUri,
          device_name: this.deviceName,
        },
      });
      const body = CloudSyncClient.parseJson(response);
      if (response.status !== 200 || typeof body.token !== 'string' || !body.token) {
        throw CloudSyncClient.failure(response, 'Sign-in could not be completed');
      }
      const email = typeof body.user?.email === 'string' ? body.user.email : '';
      this.writeCredentials({ token: body.token, email, provider });
      return { email, provider };
    } finally {
      if (this.signInController === controller) this.signInController = null;
      await callback.close();
    }
  }

  cancelSignIn() {
    this.signInController?.abort();
    this.signInController = null;
  }

  /** Ends the session on the service when it can, and always forgets it here. */
  async signOut() {
    try {
      const stored = this.readStoredCredentials();
      if (stored)
        await this.request('/v1/auth/signout', { method: 'POST', token: this.readToken() });
    } catch {
      // Signing out locally must work offline too.
    } finally {
      this.clearCredentials();
    }
  }

  async getAccount() {
    const response = await this.authedRequest('/v1/account');
    if (response.status !== 200)
      throw CloudSyncClient.failure(response, 'Account details are unavailable');
    const body = CloudSyncClient.parseJson(response);
    const entitlement = body.entitlement || {};
    return {
      email: typeof body.user?.email === 'string' ? body.user.email : '',
      providers: Array.isArray(body.providers) ? body.providers : [],
      billingAvailable: body.billingAvailable === true,
      entitled: entitlement.entitled === true,
      entitlementReason: typeof entitlement.reason === 'string' ? entitlement.reason : 'none',
      subscriptionStatus: entitlement.subscriptionStatus || null,
      currentPeriodEnd: Number(entitlement.currentPeriodEnd) || null,
      trialEndsAt: Number(entitlement.trialEndsAt) || null,
      hasBillingAccount: entitlement.hasBillingAccount === true,
    };
  }

  /** @returns {Promise<{exists: boolean, text: string|null, revision: number|null}>} */
  async readProfile() {
    const response = await this.authedRequest('/v1/profile');
    if (response.status === 404) return { exists: false, text: null, revision: null };
    if (response.status !== 200)
      throw CloudSyncClient.failure(response, 'Synced settings could not be read');
    const revision = parseEtagRevision(response.headers.get('ETag'));
    if (revision === null) {
      throw createCloudSyncError(
        'Cloud Sync sent a reply without a revision',
        'CLOUD_SYNC_RESPONSE'
      );
    }
    return { exists: true, text: response.text, revision };
  }

  /**
   * Writes the profile only if it is still at `expectedRevision` (null: only if
   * none exists yet). A lost race is reported, never resolved by overwriting.
   */
  async writeProfile(serialized, expectedRevision) {
    const headers =
      expectedRevision === null
        ? { 'If-None-Match': '*' }
        : { 'If-Match': `"${expectedRevision}"` };
    const response = await this.authedRequest('/v1/profile', {
      method: 'PUT',
      body: serialized,
      headers,
    });
    if (response.status === 412) {
      throw createCloudSyncError(
        'The synced settings changed on another device',
        'CLOUD_SYNC_CONFLICT',
        412
      );
    }
    if (response.status !== 200)
      throw CloudSyncClient.failure(response, 'Synced settings could not be saved');
    return { revision: parseEtagRevision(response.headers.get('ETag')) };
  }

  /** Opens checkout for a new subscriber, or the billing portal for an existing one. */
  async openBilling() {
    const account = await this.getAccount();
    const pathname = account.hasBillingAccount ? '/v1/billing/portal' : '/v1/billing/checkout';
    const response = await this.authedRequest(pathname, { method: 'POST' });
    const body = CloudSyncClient.parseJson(response);
    if (response.status !== 200 || typeof body.url !== 'string' || !/^https:\/\//.test(body.url)) {
      throw CloudSyncClient.failure(response, 'The subscription page could not be opened');
    }
    await this.openExternal(body.url);
    return { opened: account.hasBillingAccount ? 'portal' : 'checkout' };
  }

  async deleteAccount() {
    const response = await this.authedRequest('/v1/account', { method: 'DELETE' });
    if (response.status !== 200)
      throw CloudSyncClient.failure(response, 'The account could not be deleted');
    this.clearCredentials();
  }
}

module.exports = {
  CLOUD_SYNC_CREDENTIALS_FILE,
  CloudSyncClient,
  normalizeCloudSyncServiceUrl,
  parseEtagRevision,
  resolveCloudSyncServiceUrl,
};

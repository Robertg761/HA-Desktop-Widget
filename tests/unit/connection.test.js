const {
  classifyConnectionError,
  getConnectionIdentity,
  isConfigured,
  normalizeBaseUrl,
  startHomeAssistantPairing,
} = require('../../src/connection');

describe('connection helpers', () => {
  describe('normalizeBaseUrl', () => {
    test('normalizes http and https origins', () => {
      expect(normalizeBaseUrl('http://homeassistant.local:8123/')).toBe(
        'http://homeassistant.local:8123'
      );
      expect(normalizeBaseUrl('https://ha.example.com/profile')).toBe('https://ha.example.com');
    });

    test('adds http when the protocol is omitted', () => {
      expect(normalizeBaseUrl('homeassistant.local')).toBe('http://homeassistant.local');
      expect(normalizeBaseUrl('homeassistant.local:8123')).toBe('http://homeassistant.local:8123');
    });

    test('rejects invalid or unsupported URLs', () => {
      expect(normalizeBaseUrl('')).toBeNull();
      expect(normalizeBaseUrl('file:///tmp/home-assistant')).toBeNull();
      expect(normalizeBaseUrl('YOUR_HOME_ASSISTANT_URL')).toBeNull();
    });

    test('keeps IP addresses, IPv6 and underscore host names', () => {
      expect(normalizeBaseUrl('192.168.1.20:8123')).toBe('http://192.168.1.20:8123');
      expect(normalizeBaseUrl('http://[fd00::20]:8123')).toBe('http://[fd00::20]:8123');
      expect(normalizeBaseUrl('http://home_assistant:8123')).toBe('http://home_assistant:8123');
    });

    // The renderer's Chromium URL parser accepts these by percent-encoding the host.
    test.each([
      ['garbage not a url', 'garbage%20not%20a%20url'],
      ['http://ha local:8123', 'ha%20local'],
      ['http://ha<x>:8123', 'ha%3Cx%3E'],
    ])('rejects %p even when the URL parser encodes its host', (input, encodedHost) => {
      const RealURL = global.URL;
      global.URL = class ChromiumLikeURL {
        constructor() {
          this.protocol = 'http:';
          this.hostname = encodedHost;
          this.origin = `http://${encodedHost}:8123`;
        }
      };
      try {
        expect(normalizeBaseUrl(input)).toBeNull();
      } finally {
        global.URL = RealURL;
      }
    });
  });

  describe('isConfigured', () => {
    test('requires a valid URL and non-placeholder token', () => {
      expect(
        isConfigured({
          homeAssistant: {
            url: 'http://homeassistant.local:8123',
            token: 'real-token',
          },
        })
      ).toBe(true);

      expect(
        isConfigured({
          homeAssistant: {
            url: 'http://homeassistant.local:8123',
            token: 'YOUR_LONG_LIVED_ACCESS_TOKEN',
          },
        })
      ).toBe(false);

      expect(
        isConfigured({
          homeAssistant: {
            url: '',
            token: 'real-token',
          },
        })
      ).toBe(false);
    });
  });

  describe('getConnectionIdentity', () => {
    const oauth = (token, oauthAuthorizationId, url = 'http://ha.local:8123') => ({
      homeAssistant: { url, token, authMethod: 'oauth', oauthAuthorizationId },
    });

    test('ignores OAuth access token rotation within one authorization', () => {
      expect(getConnectionIdentity(oauth('access-1', 'auth-1'))).toBe(
        getConnectionIdentity(oauth('access-2', 'auth-1'))
      );
    });

    test('changes with the server, the authorization, or a legacy token', () => {
      const identity = getConnectionIdentity(oauth('access-1', 'auth-1'));
      expect(getConnectionIdentity(oauth('access-1', 'auth-2'))).not.toBe(identity);
      expect(getConnectionIdentity(oauth('access-1', 'auth-1', 'http://other:8123'))).not.toBe(
        identity
      );
      expect(
        getConnectionIdentity({ homeAssistant: { url: 'http://ha.local:8123', token: 'a' } })
      ).not.toBe(
        getConnectionIdentity({ homeAssistant: { url: 'http://ha.local:8123', token: 'b' } })
      );
    });
  });

  describe('startHomeAssistantPairing', () => {
    test('re-attaches the failure code on the renderer side of the bridge', async () => {
      const api = {
        startHomeAssistantOAuth: jest.fn(async () => ({
          success: false,
          code: 'OAUTH_AUTHORIZATION_CANCELED',
          error: 'Home Assistant authorization was canceled',
        })),
      };
      await expect(startHomeAssistantPairing(api, 'http://ha.local:8123')).rejects.toMatchObject({
        message: 'Home Assistant authorization was canceled',
        result: { code: 'OAUTH_AUTHORIZATION_CANCELED' },
      });
    });

    test('returns a successful pairing', async () => {
      const result = { success: true, config: { homeAssistant: {} } };
      const api = { startHomeAssistantOAuth: jest.fn(async () => result) };
      await expect(startHomeAssistantPairing(api, 'http://ha.local:8123')).resolves.toBe(result);
      expect(api.startHomeAssistantOAuth).toHaveBeenCalledWith('http://ha.local:8123');
    });
  });

  describe('classifyConnectionError', () => {
    test('classifies invalid URL, auth, and unreachable failures', () => {
      expect(classifyConnectionError({ code: 'invalid-url' })).toBe('invalid-url');
      expect(classifyConnectionError({ status: 401 })).toBe('auth-failed');
      expect(classifyConnectionError({ status: 403 })).toBe('auth-failed');
      expect(classifyConnectionError({ code: 'ETIMEDOUT' })).toBe('unreachable');
      expect(classifyConnectionError(new Error('Network request failed'))).toBe('unreachable');
    });
  });
});

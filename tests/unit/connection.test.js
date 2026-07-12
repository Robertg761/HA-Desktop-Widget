const { classifyConnectionError, isConfigured, normalizeBaseUrl } = require('../../src/connection');

describe('connection helpers', () => {
  describe('normalizeBaseUrl', () => {
    test('normalizes http and https origins', () => {
      expect(normalizeBaseUrl('http://homeassistant.local:8123/')).toBe(
        'http://homeassistant.local:8123'
      );
      expect(normalizeBaseUrl('https://ha.example.com/profile')).toBe('https://ha.example.com');
    });

    test('adds http when the protocol is omitted', () => {
      expect(normalizeBaseUrl('homeassistant.local:8123')).toBe('http://homeassistant.local:8123');
    });

    test('rejects invalid or unsupported URLs', () => {
      expect(normalizeBaseUrl('')).toBeNull();
      expect(normalizeBaseUrl('file:///tmp/home-assistant')).toBeNull();
      expect(normalizeBaseUrl('YOUR_HOME_ASSISTANT_URL')).toBeNull();
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

/**
 * @jest-environment node
 */

const {
  createDesktopPinConnectionState,
  createDesktopPinRendererConfig,
  normalizeDesktopPinActionRequest,
} = require('../../src/desktop-pin-ipc.cjs');

describe('desktop pin IPC helpers', () => {
  it('returns only visual config and never exposes credentials or sync data', () => {
    const source = {
      homeAssistant: {
        url: 'https://ha.example.test',
        token: 'decrypted-secret',
        tokenEncrypted: true,
      },
      ui: { theme: 'dark', customColors: [{ name: 'Night' }] },
      opacity: 0.85,
      frostedGlass: true,
      customEntityNames: { 'light.office': 'Desk Light' },
      customEntityIcons: { 'light.office': '💡' },
      profileSync: { cloudFilePath: '/Users/example/Private/sync.json' },
      globalHotkeys: { enabled: true },
      entityAlerts: { enabled: true },
    };

    const result = createDesktopPinRendererConfig(source);

    expect(result).toEqual({
      homeAssistant: { url: 'https://ha.example.test' },
      ui: { theme: 'dark', customColors: [{ name: 'Night' }] },
      opacity: 0.85,
      frostedGlass: true,
      customEntityNames: { 'light.office': 'Desk Light' },
      customEntityIcons: { 'light.office': '💡' },
    });
    expect(JSON.stringify(result)).not.toContain('decrypted-secret');
    expect(JSON.stringify(result)).not.toContain('sync.json');
    expect(source.homeAssistant.token).toBe('decrypted-secret');
  });

  it('reports connection readiness without returning credential values', () => {
    expect(
      createDesktopPinConnectionState({
        homeAssistant: { url: 'https://ha.example.test', token: 'secret' },
      })
    ).toEqual({ hasUrl: true, hasToken: true, secureStoragePending: false });
    expect(
      createDesktopPinConnectionState(
        {
          homeAssistant: {
            url: 'HOME_ASSISTANT_URL',
            token: 'YOUR_LONG_LIVED_ACCESS_TOKEN',
          },
        },
        { secureStoragePending: true }
      )
    ).toEqual({ hasUrl: false, hasToken: false, secureStoragePending: true });
  });

  it('allows only focus and entity-scoped service calls from a pin', () => {
    expect(normalizeDesktopPinActionRequest('light.office', 'focus-main')).toEqual({
      success: true,
      entityId: 'light.office',
      action: 'focus-main',
      payload: {},
    });

    expect(
      normalizeDesktopPinActionRequest('light.office', 'service-call', {
        domain: 'light',
        service: 'turn_on',
        serviceData: {
          entity_id: 'light.other',
          target: { entity_id: 'light.other' },
          brightness: 120,
        },
      })
    ).toEqual({
      success: true,
      entityId: 'light.office',
      action: 'service-call',
      payload: {
        domain: 'light',
        service: 'turn_on',
        serviceData: {
          entity_id: 'light.office',
          brightness: 120,
        },
      },
    });
  });

  it('rejects arbitrary actions, cross-domain services, and invalid service names', () => {
    expect(normalizeDesktopPinActionRequest('light.office', 'open-external')).toEqual({
      success: false,
      error: 'Unauthorized desktop pin action',
    });
    expect(
      normalizeDesktopPinActionRequest('light.office', 'service-call', {
        domain: 'homeassistant',
        service: 'restart',
      })
    ).toEqual({ success: false, error: 'Invalid desktop pin service request' });
    expect(
      normalizeDesktopPinActionRequest('light.office', 'service-call', {
        domain: 'light',
        service: '../turn_on',
      })
    ).toEqual({ success: false, error: 'Invalid desktop pin service request' });
  });
});

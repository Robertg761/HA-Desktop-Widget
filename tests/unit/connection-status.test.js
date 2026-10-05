/**
 * @jest-environment jsdom
 */
const fs = require('fs');
const path = require('path');

// Marks every translated string so a message that bypassed t() stands out.
jest.mock('../../src/i18n.js', () => ({
  __esModule: true,
  t: jest.fn((key, vars = {}) =>
    `[fr] ${key}`.replace(/\{\{(\w+)\}\}/g, (_, name) => String(vars[name] ?? ''))
  ),
}));

const {
  describeHomeAssistantOAuthError,
  describeHomeAssistantOAuthFailure,
  describeHomeAssistantOAuthReauthReason,
  describeHomeAssistantOAuthRefreshError,
  renderConnectionStatus,
} = require('../../src/connection-status.js');

// Every failure code src/ha-oauth.cjs can hand to the renderer.
const OAUTH_CODES = [
  ...new Set(
    fs
      .readFileSync(path.resolve(__dirname, '../../src/ha-oauth.cjs'), 'utf8')
      .match(/'OAUTH_[A-Z_]+'/g)
      .map((code) => code.slice(1, -1))
  ),
];

describe('Home Assistant authorization failure messages', () => {
  it('finds the failure codes in the OAuth client', () => {
    expect(OAUTH_CODES).toEqual(
      expect.arrayContaining([
        'OAUTH_AUTHORIZATION_CANCELED',
        'OAUTH_AUTHORIZATION_TIMEOUT',
        'OAUTH_STATE_MISMATCH',
        'OAUTH_INVALID_GRANT',
        'OAUTH_SECURE_STORAGE_UNAVAILABLE',
        'OAUTH_SERVER_UNREACHABLE',
      ])
    );
  });

  it.each(OAUTH_CODES)('translates %s instead of showing main-process text', (code) => {
    const message = describeHomeAssistantOAuthFailure({
      message: 'English text from the main process',
      result: { success: false, code, error: 'English text from the main process' },
    });

    expect(message).toMatch(/^\[fr\] /);
    expect(message).not.toContain('English text from the main process');
    expect(describeHomeAssistantOAuthError(code)).toBe(message);
  });

  it('keeps the detail in a translated sentence for an unknown failure', () => {
    expect(
      describeHomeAssistantOAuthFailure({
        message: 'socket hang up',
        result: { success: false, code: 'OAUTH_PAIRING_FAILED', error: 'socket hang up' },
      })
    ).toBe('[fr] Could not connect to Home Assistant. socket hang up');
    expect(describeHomeAssistantOAuthFailure(new Error(''))).toBe(
      '[fr] Could not connect to Home Assistant. [fr] Unknown error'
    );
  });

  describe('refresh failures', () => {
    it.each(['OAUTH_TOKEN_NETWORK', 'OAUTH_TOKEN_TIMEOUT', 'OAUTH_TOKEN_EXCHANGE_FAILED'])(
      'reports %s as Home Assistant being offline',
      (code) => {
        expect(
          describeHomeAssistantOAuthRefreshError({
            oauthLastError: 'connect ECONNREFUSED 127.0.0.1:8123',
            oauthLastErrorCode: code,
          })
        ).toBe('[fr] Home Assistant is offline. Authorization will retry automatically.');
      }
    );

    it('explains an unreadable saved authorization', () => {
      expect(
        describeHomeAssistantOAuthRefreshError({
          oauthLastError: 'Saved Home Assistant authorization could not be decrypted',
          oauthLastErrorCode: 'OAUTH_STORE_DECRYPT',
        })
      ).toBe(
        '[fr] The saved Home Assistant authorization could not be read. Reconnect with Home Assistant.'
      );
    });

    it('explains a reconnect needed for an unreadable authorization, not a revoked one', () => {
      expect(
        describeHomeAssistantOAuthReauthReason({ oauthLastErrorCode: 'OAUTH_STORE_INVALID' })
      ).toBe(
        '[fr] The saved Home Assistant authorization could not be read. Reconnect with Home Assistant.'
      );
      expect(
        describeHomeAssistantOAuthReauthReason({ oauthLastErrorCode: 'OAUTH_INVALID_GRANT' })
      ).toBe('');
      expect(describeHomeAssistantOAuthReauthReason({})).toBe('');
    });

    it('asks for an unlocked keyring and a restart when the Linux keyring is unavailable', () => {
      const keyringMessage =
        '[fr] Your system keyring is locked or not running, so the saved Home Assistant authorization cannot be read. Unlock the keyring, then restart the widget.';
      expect(
        describeHomeAssistantOAuthReauthReason({ oauthLastErrorCode: 'OAUTH_KEYRING_UNAVAILABLE' })
      ).toBe(keyringMessage);
      expect(
        describeHomeAssistantOAuthFailure({ result: { code: 'OAUTH_KEYRING_UNAVAILABLE' } })
      ).toBe(keyringMessage);
    });

    it('says a new authorization cannot be saved when pairing finds no unlocked keyring', () => {
      expect(
        describeHomeAssistantOAuthFailure({ result: { code: 'OAUTH_KEYRING_CANNOT_SAVE' } })
      ).toBe(
        '[fr] Your system keyring is locked or not running, so the authorization cannot be saved. Unlock the keyring, then restart the widget.'
      );
    });

    it('wraps an uncoded failure in a translated sentence', () => {
      expect(describeHomeAssistantOAuthRefreshError({ oauthLastError: 'EPERM' })).toBe(
        '[fr] Could not connect to Home Assistant. EPERM'
      );
      expect(describeHomeAssistantOAuthRefreshError({})).toBe(
        '[fr] Home Assistant is offline. Authorization will retry automatically.'
      );
    });
  });
});

describe('connection status live region', () => {
  const makeStatus = () => {
    // The markup gives these lines role="status" and nothing else.
    document.body.innerHTML = '<div id="status" role="status"></div>';
    return document.getElementById('status');
  };

  it('announces an error assertively and everything else politely', () => {
    const status = makeStatus();

    renderConnectionStatus(status, 'Could not reach Home Assistant.', 'error');
    expect(status.getAttribute('role')).toBe('alert');
    expect(status.getAttribute('aria-live')).toBe('assertive');

    renderConnectionStatus(status, 'Connected.', 'success');
    expect(status.getAttribute('role')).toBe('status');
    expect(status.getAttribute('aria-live')).toBe('polite');

    renderConnectionStatus(status, 'Waiting for Home Assistant...', 'pending');
    expect(status.getAttribute('role')).toBe('status');
    expect(status.getAttribute('aria-live')).toBe('polite');
  });

  it('does not leave a stale politeness behind when an error is cleared', () => {
    const status = makeStatus();
    renderConnectionStatus(status, 'Could not reach Home Assistant.', 'error');
    renderConnectionStatus(status, '', '');

    expect(status.getAttribute('role')).toBe('status');
    expect(status.getAttribute('aria-live')).toBe('polite');
    expect(status.textContent).toBe('');
  });

  it('is not pinned to polite by the markup that hosts it', () => {
    const html = fs.readFileSync(path.resolve(__dirname, '../../index.html'), 'utf8');
    for (const id of ['ha-oauth-status', 'test-ha-connection-status']) {
      const element = html.match(new RegExp(`<div[^>]*id="${id}"[^>]*>`))[0];
      expect(element).toContain('role="status"');
      expect(element).not.toContain('aria-live');
    }
  });
});

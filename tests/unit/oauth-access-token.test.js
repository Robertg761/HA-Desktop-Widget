const {
  OAUTH_ACCESS_TOKEN_EXPIRY_MARGIN_MS,
  isOAuthAccessTokenExpired,
} = require('../../src/oauth-access-token.cjs');

describe('isOAuthAccessTokenExpired', () => {
  const now = 1_000_000_000_000;
  const oauth = (oauthExpiresAt) => ({
    homeAssistant: { authMethod: 'oauth', token: 'access-token', oauthExpiresAt },
  });

  it('counts a token past its expiry, or about to reach it, as expired', () => {
    expect(isOAuthAccessTokenExpired(oauth(now - 1), now)).toBe(true);
    expect(isOAuthAccessTokenExpired(oauth(now + OAUTH_ACCESS_TOKEN_EXPIRY_MARGIN_MS), now)).toBe(
      true
    );
    expect(
      isOAuthAccessTokenExpired(oauth(now + OAUTH_ACCESS_TOKEN_EXPIRY_MARGIN_MS + 1), now)
    ).toBe(false);
  });

  it('never counts a legacy token or an unknown expiry as expired', () => {
    expect(
      isOAuthAccessTokenExpired(
        { homeAssistant: { authMethod: 'token', oauthExpiresAt: now - 1 } },
        now
      )
    ).toBe(false);
    expect(isOAuthAccessTokenExpired(oauth(undefined), now)).toBe(false);
    expect(isOAuthAccessTokenExpired(oauth('soon'), now)).toBe(false);
    expect(isOAuthAccessTokenExpired(null, now)).toBe(false);
  });
});

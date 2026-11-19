/**
 * @jest-environment jsdom
 */

// The after-update notice appears once the dashboard first starts, also when that start comes
// after init: a browser sign-in is still being restored when init runs, and the dashboard starts
// from the config update that brings the token.

const { triggerMockEvent } = require('../mocks/electron.js');
const { createRendererHarness, warmUpRenderer } = require('../helpers/renderer-harness');

const NOTICE_WAIT_MS = 2800;
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

describe('the after-update notice at startup', () => {
  const harness = createRendererHarness();
  const { oauthConfig, tokenConfig, flushAsync } = harness;

  beforeAll(() => {
    global.__APP_VERSION__ = '4.3.0';
  });
  afterAll(() => {
    delete global.__APP_VERSION__;
  });
  beforeEach(() => {
    localStorage.clear();
    localStorage.setItem('ha-widget:last-run-version', '4.2.0');
  });

  warmUpRenderer(
    () => harness.load({ config: tokenConfig() }),
    () => harness.cleanup()
  );
  afterEach(() => harness.cleanup());

  const noticeCalls = () =>
    harness.uiUtils.showToast.mock.calls.filter(
      ([message]) => message === 'Updated to version 4.3.0'
    );

  it('shows on a token start', async () => {
    await harness.load({ config: tokenConfig() });
    await flushAsync();
    await wait(NOTICE_WAIT_MS);
    expect(noticeCalls()).toHaveLength(1);
    expect(localStorage.getItem('ha-widget:last-run-version')).toBe('4.3.0');
  });

  it('shows on a browser sign-in start, once the restored token arrives', async () => {
    await harness.load({
      config: oauthConfig({ token: 'YOUR_LONG_LIVED_ACCESS_TOKEN', oauthStatus: 'restoring' }),
    });
    await flushAsync();
    await wait(NOTICE_WAIT_MS);
    // Nothing yet: the dashboard has not started.
    expect(noticeCalls()).toHaveLength(0);

    triggerMockEvent('configUpdated', oauthConfig());
    await flushAsync();
    await wait(NOTICE_WAIT_MS);
    expect(noticeCalls()).toHaveLength(1);

    // A later token refresh does not bring it back.
    triggerMockEvent('configUpdated', oauthConfig({ token: 'access-token-2' }));
    await flushAsync();
    await wait(NOTICE_WAIT_MS);
    expect(noticeCalls()).toHaveLength(1);
  }, 15000);

  it('stays quiet on a start that is not the first of this version', async () => {
    localStorage.setItem('ha-widget:last-run-version', '4.3.0');
    await harness.load({ config: tokenConfig() });
    await flushAsync();
    await wait(NOTICE_WAIT_MS);
    expect(noticeCalls()).toHaveLength(0);
  });
});

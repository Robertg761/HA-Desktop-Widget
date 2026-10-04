/**
 * @jest-environment jsdom
 */

const { createRendererHarness } = require('../helpers/renderer-harness');

describe('the connection panel on the dashboard', () => {
  const harness = createRendererHarness();
  const title = () => document.querySelector('.widget-state-title')?.textContent;
  const copy = () => document.querySelector('.widget-state-copy')?.textContent;

  afterEach(() => harness.cleanup());

  // The "Retrying..." moment is 700 ms of real time; wait for what follows it, not for a fixed time.
  const until = async (done, timeoutMs = 3000) => {
    const deadline = Date.now() + timeoutMs;
    while (!done() && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    return !!done();
  };
  const retryOver = () =>
    !document.querySelector('.widget-state-copy + .widget-state-details .connection-progress') &&
    !harness.findButton('Retrying...');

  const failAttempt = (error = new Error('Could not establish WebSocket connection')) => {
    harness.websocket.emit('error', error);
    harness.websocket.emit('close', { intentional: false });
  };

  describe('while connecting', () => {
    it('does not say the same sentence as its title and its paragraph', async () => {
      await harness.load({ config: harness.tokenConfig() });

      harness.websocket.emit('connect-attempt');

      expect(title()).toBe('Connecting to Home Assistant...');
      expect(copy()).toBe('Waiting for live Home Assistant data...');
      expect(title()).not.toBe(copy());
    });

    it('names the server, and shows the shared waiting bar with aria-busy', async () => {
      await harness.load({ config: harness.tokenConfig() });

      harness.websocket.emit('connect-attempt');

      const panel = document.getElementById('widget-state-panel');
      expect(panel.querySelector('.widget-state-host').textContent).toBe('ha.local:8123');
      expect(panel.querySelector('.widget-state-host').dir).toBe('ltr');
      expect(panel.querySelector('.connection-progress')).not.toBeNull();
      expect(panel.getAttribute('aria-busy')).toBe('true');
    });

    it('does not carry the last failure into the next attempt', async () => {
      await harness.load({ config: harness.tokenConfig() });
      failAttempt();
      expect(copy()).toContain('Unable to reach Home Assistant');

      harness.websocket.emit('connect-attempt');

      expect(copy()).toBe('Waiting for live Home Assistant data...');
      expect(document.getElementById('widget-state-panel').textContent).not.toContain(
        'Unable to reach'
      );
    });

    it('stops showing the bar and busy state once the attempt fails', async () => {
      await harness.load({ config: harness.tokenConfig() });
      harness.websocket.emit('connect-attempt');
      failAttempt();

      const panel = document.getElementById('widget-state-panel');
      expect(panel.querySelector('.connection-progress')).toBeNull();
      expect(panel.hasAttribute('aria-busy')).toBe(false);
    });
  });

  describe('after a failed attempt', () => {
    it('keeps the specific reason instead of the generic close message', async () => {
      await harness.load({ config: harness.tokenConfig() });
      harness.websocket.emit('connect-attempt');

      failAttempt();

      expect(title()).toBe('Home Assistant is disconnected');
      expect(copy()).toBe(
        'Unable to reach Home Assistant. Check your network or Home Assistant URL.'
      );
      expect(document.querySelector('.widget-state-host').textContent).toBe('ha.local:8123');
    });

    it('says what a host that never answers means, which arrives as a close alone', async () => {
      await harness.load({ config: harness.tokenConfig() });
      harness.websocket.emit('connect-attempt');

      harness.websocket.emit('close', { intentional: false, reason: 'timeout' });

      expect(copy()).toBe(
        'Home Assistant did not answer. Check that it is running and that the URL is correct.'
      );
      expect(harness.uiUtils.setStatus).toHaveBeenLastCalledWith(
        false,
        'Home Assistant did not answer. Check that it is running and that the URL is correct.'
      );
    });

    it('still reports a plain close as a disconnect that retries', async () => {
      await harness.load({ config: harness.tokenConfig() });
      harness.websocket.emit('connect-attempt');

      harness.websocket.emit('close', { intentional: false });

      expect(copy()).toBe('Disconnected from Home Assistant. Retrying automatically.');
    });

    it('does not repeat "Authentication failed" under the title Authentication failed', async () => {
      await harness.load({ config: harness.tokenConfig() });
      harness.websocket.emit('connect-attempt');
      harness.websocket.emit('message', { type: 'auth_invalid' });

      expect(title()).toBe('Authentication failed');
      expect(copy()).not.toMatch(/^Authentication failed/);
      expect(copy().length).toBeGreaterThan(0);
    });
  });

  describe('Retry', () => {
    const retry = () => harness.findButton('Retry') || harness.findButton('Retrying...');

    it('says it is retrying, even when the port refuses at once, and then says the retry failed', async () => {
      await harness.load({ config: harness.tokenConfig() });
      failAttempt();
      expect(retry().textContent).toBe('Retry');
      expect(document.querySelector('.widget-state-note')).toBeNull();
      const connectsBefore = harness.websocket.connect.mock.calls.length;

      retry().click();
      // The connection is refused within the same tick.
      harness.websocket.emit('connect-attempt');
      failAttempt();

      expect(harness.websocket.connect.mock.calls.length).toBe(connectsBefore + 1);
      expect(title()).toBe('Connecting to Home Assistant...');
      const button = harness.findButton('Retrying...');
      expect(button).toBeTruthy();
      expect(button.getAttribute('aria-disabled')).toBe('true');
      expect(button.disabled).toBe(false);

      // Clicking while it says "Retrying..." does not start another attempt.
      button.click();
      expect(harness.websocket.connect.mock.calls.length).toBe(connectsBefore + 1);

      await until(retryOver);

      expect(title()).toBe('Home Assistant is disconnected');
      expect(harness.findButton('Retry').getAttribute('aria-disabled')).toBeNull();
      expect(document.querySelector('.widget-state-note').textContent).toMatch(
        /^Still can't reach Home Assistant \(tried \d{1,2}:\d{2}\)\.$/
      );
    });

    it('keeps the keyboard on the Retry button through its label changes', async () => {
      await harness.load({ config: harness.tokenConfig() });
      failAttempt();
      const button = retry();
      button.focus();

      button.click();
      harness.websocket.emit('connect-attempt');
      failAttempt();
      expect(document.activeElement.textContent).toBe('Retrying...');

      await until(retryOver);
      expect(document.activeElement.textContent).toBe('Retry');
    });

    it('announces how the retry went, once', async () => {
      await harness.load({ config: harness.tokenConfig() });
      failAttempt();
      retry().click();
      harness.websocket.emit('connect-attempt');
      failAttempt();
      await until(retryOver);
      await new Promise((resolve) => setTimeout(resolve, 80));

      expect(document.getElementById('widget-state-live').textContent).toMatch(
        /^Still can't reach Home Assistant/
      );
    });

    it('forgets the failed retry once the connection is back', async () => {
      await harness.load({ config: harness.tokenConfig() });
      failAttempt();
      retry().click();
      harness.websocket.emit('connect-attempt');
      failAttempt();
      await until(retryOver);
      expect(document.querySelector('.widget-state-note')).not.toBeNull();

      let requestId = 10;
      harness.websocket.request.mockImplementation(() => {
        const request = new Promise(() => {});
        request.id = requestId++;
        return request;
      });
      harness.websocket.emit('message', { type: 'auth_ok' });
      harness.websocket.emit('message', { type: 'result', id: 10, success: true, result: [] });
      await harness.flushAsync();
      // Connected, with nothing on the page yet: the connection panel is gone.
      expect(title()).toBe('No Quick Access entities yet');

      failAttempt();
      expect(document.querySelector('.widget-state-note')).toBeNull();
    });
  });

  describe('reconnecting a revoked authorization', () => {
    it('waits for the answer in the browser, with the waiting bar', async () => {
      await harness.load({
        config: harness.oauthConfig({
          token: 'YOUR_LONG_LIVED_ACCESS_TOKEN',
          oauthStatus: 'reauth_required',
          oauthAuthorizationId: undefined,
        }),
        configureApi(api) {
          api.startHomeAssistantOAuth.mockReturnValue(new Promise(() => {}));
        },
      });

      // The panel is drawn once the first connection state is known, a little after init is done.
      // A busy machine (CI on Windows ARM, a full test run) can take several seconds to get there.
      const drawn = await until(() => harness.findButton('Reconnect with Home Assistant'), 15000);
      if (!drawn) {
        throw new Error(
          `The Reconnect button never appeared; the panel says: ${document.getElementById('widget-state-panel')?.textContent}`
        );
      }
      harness.findButton('Reconnect with Home Assistant').click();
      await harness.flushAsync();

      expect(copy()).toBe('Waiting for you to approve in your browser...');
      const panel = document.getElementById('widget-state-panel');
      expect(panel.querySelector('.connection-progress')).not.toBeNull();
      expect(panel.getAttribute('aria-busy')).toBe('true');
    }, 30000);
  });
});

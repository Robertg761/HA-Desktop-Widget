/* global AbortSignal */

'use strict';

const { URL } = require('url');

/**
 * Card donations without a browser. The donations Worker (services/donations) creates a Stripe
 * Checkout session, and Stripe's hosted checkout page opens in a window of the app's own. That
 * window is a plain web page: no preload, sandboxed, in a throwaway session that grants no
 * permissions, so Stripe's scripts never run next to the Home Assistant connection. Card details
 * go from that page to Stripe and nowhere else.
 *
 * When checkout finishes or is cancelled, Stripe sends the window to the Worker's /v1/return
 * page. The window closes on that navigation instead of loading it, and start() resolves with
 * { status: 'complete' } or { status: 'cancelled' }. Closing the window is a cancel too.
 */

const DONATION_SERVICE_URL = 'https://donate.hadesktopwidget.com';
const CHECKOUT_PARTITION = 'donate-checkout';
const REQUEST_TIMEOUT_MS = 15000;
const MIN_AMOUNT = 1;
const MAX_AMOUNT = 12000;
// Chromium's code for a navigation that was stopped, which is what preventDefault on the
// return page navigation reports.
const ERR_ABORTED = -3;

function parseUrl(rawUrl) {
  try {
    return new URL(rawUrl);
  } catch {
    return null;
  }
}

function isStripePage(rawUrl) {
  const url = parseUrl(rawUrl);
  return (
    url?.protocol === 'https:' &&
    (url.hostname === 'stripe.com' || url.hostname.endsWith('.stripe.com'))
  );
}

function isCheckoutUrl(rawUrl) {
  const url = parseUrl(rawUrl);
  return url?.protocol === 'https:' && url.hostname === 'checkout.stripe.com';
}

function createCardDonationFlow({
  BrowserWindow,
  fetchImpl,
  openExternal,
  serviceUrl = DONATION_SERVICE_URL,
  log,
}) {
  const serviceOrigin = new URL(serviceUrl).origin;
  let checkoutWindow = null;

  /** 'complete' or 'cancelled' for the Worker's return page, otherwise null. */
  function returnResult(rawUrl) {
    const url = parseUrl(rawUrl);
    if (!url || url.origin !== serviceOrigin || url.pathname !== '/v1/return') return null;
    return url.searchParams.get('result') === 'complete' ? 'complete' : 'cancelled';
  }

  function openOutside(rawUrl) {
    const url = parseUrl(rawUrl);
    if (url?.protocol !== 'https:' && url?.protocol !== 'http:') return;
    Promise.resolve(openExternal(url.toString())).catch((error) => {
      log.warn('Failed to open a checkout link:', error?.message || error);
    });
  }

  async function requestCheckoutUrl(amount, locale) {
    const response = await fetchImpl(`${serviceOrigin}/v1/checkout`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ amount, locale }),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    if (!response.ok) {
      throw new Error(`Donation service answered with status code ${response.status}`);
    }
    const { url } = await response.json();
    if (!isCheckoutUrl(url)) throw new Error('Donation service did not return a checkout page');
    return url;
  }

  function showCheckout(checkoutUrl, windowOptions = {}) {
    return new Promise((resolve) => {
      const win = new BrowserWindow({
        width: 520,
        height: 760,
        minWidth: 380,
        minHeight: 520,
        autoHideMenuBar: true,
        backgroundColor: '#ffffff',
        show: false,
        ...windowOptions,
        webPreferences: {
          sandbox: true,
          contextIsolation: true,
          nodeIntegration: false,
          webSecurity: true,
          spellcheck: false,
          // Not "persist:": Stripe's cookies go when the app quits.
          partition: CHECKOUT_PARTITION,
        },
      });
      checkoutWindow = win;
      const { webContents } = win;
      let settled = false;
      let loaded = false;

      const finish = (status) => {
        if (settled) return;
        settled = true;
        resolve({ status });
        if (!win.isDestroyed()) win.close();
      };

      webContents.session.setPermissionRequestHandler((_contents, _permission, callback) =>
        callback(false)
      );
      webContents.session.setPermissionCheckHandler(() => false);
      win.removeMenu?.();
      // Stripe's page title names the business; the window keeps saying what it is for.
      win.on('page-title-updated', (event) => event.preventDefault());
      win.once('ready-to-show', () => {
        if (win.isDestroyed()) return;
        win.show();
        win.focus();
      });
      win.on('closed', () => {
        if (checkoutWindow === win) checkoutWindow = null;
        finish('cancelled');
      });

      // Links Stripe opens in a new tab (terms, privacy) go to the browser.
      webContents.setWindowOpenHandler(({ url }) => {
        openOutside(url);
        return { action: 'deny' };
      });
      const guardNavigation = (event, url) => {
        const result = returnResult(url);
        if (result) {
          event.preventDefault();
          finish(result);
          return;
        }
        if (isStripePage(url)) return;
        event.preventDefault();
        openOutside(url);
      };
      webContents.on('will-navigate', guardNavigation);
      // Redirects inside frames are left alone: card verification (3-D Secure) runs in a frame
      // that passes through the card issuer's own site.
      webContents.on('will-redirect', (event, url, _isInPlace, isMainFrame) => {
        if ((event?.isMainFrame ?? isMainFrame) === false) return;
        guardNavigation(event, url);
      });
      webContents.on('did-finish-load', () => {
        loaded = true;
      });
      // A checkout page that never loaded leaves a blank window; say so instead. Once it has
      // loaded, a failure is left for the page to show, since a payment may be under way.
      webContents.on(
        'did-fail-load',
        (_event, errorCode, errorDescription, _validatedUrl, isMainFrame) => {
          if (loaded || !isMainFrame || errorCode === ERR_ABORTED) return;
          log.warn('Checkout page failed to load:', errorDescription || errorCode);
          finish('failed');
        }
      );

      win.loadURL(checkoutUrl).catch(() => {
        // did-fail-load has the details; a stopped navigation rejects here too.
      });
    });
  }

  /** Brings an open checkout window forward; false when there is none. */
  function focus() {
    if (!checkoutWindow || checkoutWindow.isDestroyed()) return false;
    if (checkoutWindow.isMinimized?.()) checkoutWindow.restore();
    checkoutWindow.show();
    checkoutWindow.focus();
    return true;
  }

  let pendingRequest = false;

  /** Resolves with { status: 'complete' | 'cancelled' | 'failed' | 'already-open' }. */
  async function start({ amount, locale, windowOptions } = {}) {
    if (!Number.isInteger(amount) || amount < MIN_AMOUNT || amount > MAX_AMOUNT) {
      return { status: 'failed', error: 'Invalid amount' };
    }
    if (pendingRequest || focus()) return { status: 'already-open' };
    pendingRequest = true;
    let checkoutUrl;
    try {
      checkoutUrl = await requestCheckoutUrl(amount, locale);
    } catch (error) {
      log.warn('Could not start card checkout:', error?.message || error);
      return { status: 'failed', error: error?.message || String(error) };
    } finally {
      pendingRequest = false;
    }
    return showCheckout(checkoutUrl, windowOptions);
  }

  return {
    isBusy: () => pendingRequest || (!!checkoutWindow && !checkoutWindow.isDestroyed()),
    focus,
    start,
  };
}

module.exports = {
  DONATION_SERVICE_URL,
  createCardDonationFlow,
};

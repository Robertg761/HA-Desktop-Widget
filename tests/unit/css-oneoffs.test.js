/**
 * @jest-environment jsdom
 */

// Stylesheet one-offs from the 4.0 frontend audit: each describe block pins one rule that was
// wrong, in the cascade the app really paints it in.

const fs = require('fs');
const path = require('path');
const { loadAppStylesheets, resolvedValue, splitTopLevel } = require('../helpers/css-cascade.js');

const STYLESHEET = path.resolve(__dirname, '../../styles.css');

function render(html, { bodyClass = '', dir = 'ltr' } = {}) {
  document.documentElement.setAttribute('dir', dir);
  document.body.className = bodyClass;
  document.body.innerHTML = html;
}

/** The style rules inside every @media block whose query contains `query`, as `{ selectors, style }`. */
function rulesInMedia(query) {
  const found = [];
  for (const sheet of document.styleSheets) {
    for (const rule of sheet.cssRules) {
      if (!rule.media || !rule.media.mediaText.includes(query)) continue;
      for (const inner of rule.cssRules) {
        if (inner.selectorText) {
          found.push({ selectors: splitTopLevel(inner.selectorText), style: inner.style });
        }
      }
    }
  }
  return found;
}

describe('stylesheet one-offs', () => {
  beforeAll(() => {
    loadAppStylesheets(document);
  });

  afterEach(() => {
    document.documentElement.removeAttribute('dir');
    document.body.className = '';
    document.body.innerHTML = '';
  });

  describe('reduced motion keeps the waiting indicators moving', () => {
    // The blanket "no animation" rule gives every animation 0.01ms and one iteration. A spinner or a
    // progress bar frozen that way reads as a stalled app, and the bar as a finished one.
    const INDICATORS = [
      ['the loading ring', '<div class="spinner"></div>', '.spinner'],
      [
        'the camera spinner',
        '<div class="camera-loading show"><div class="spinner"></div></div>',
        '.spinner',
      ],
      [
        'the connecting icon',
        '<div class="status-message is-connecting"><div class="status-message-icon"><svg></svg></div></div>',
        'svg',
      ],
      [
        'the waiting bar',
        '<div class="connection-progress"><div class="connection-progress-bar"></div></div>',
        '.connection-progress-bar',
      ],
    ];

    it.each(INDICATORS)('%s still runs when the OS asks for less motion', (_, html, selector) => {
      render(html);
      const element = document.querySelector(selector);
      expect(resolvedValue(element, 'animation-duration', { reducedMotion: true })).not.toBe(
        '0.01ms'
      );
      expect(resolvedValue(element, 'animation-iteration-count', { reducedMotion: true })).toBe(
        'infinite'
      );
    });

    it('still stops other animations', () => {
      render('<div class="toast success">Saved</div>');
      const toast = document.querySelector('.toast');
      expect(resolvedValue(toast, 'animation-duration', { reducedMotion: true })).toBe('0.01ms');
      expect(resolvedValue(toast, 'animation-iteration-count', { reducedMotion: true })).toBe('1');
    });

    it.each([
      "[aria-busy='true']::after",
      "#settings-modal .profile-sync-status[data-busy='true']::before",
    ])('exempts the pseudo-element spinner %s', (selector) => {
      // The cascade helper cannot match pseudo-elements, so read the rule.
      const rule = rulesInMedia('prefers-reduced-motion: reduce').find((entry) =>
        entry.selectors.includes(selector)
      );
      expect(rule).toBeDefined();
      expect(rule.style.getPropertyValue('animation-iteration-count')).toBe('infinite');
      expect(rule.style.getPropertyPriority('animation-iteration-count')).toBe('important');
      expect(rule.style.getPropertyPriority('animation-duration')).toBe('important');
    });
  });
});

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

  describe('the generic alert box', () => {
    it.each(['error', 'warning'])('does not restyle a %s toast', (kind) => {
      // The toast sets role=alert so it is announced at once; the box meant for inline error text
      // came later with the same specificity and replaced its padding (8px, against the 12px 16px
      // of a success toast), added a top margin and bolded the text.
      render(`<div class="toast ${kind}" role="alert">Could not run command.</div>`);
      const toast = document.querySelector('.toast');
      expect(resolvedValue(toast, 'padding')).toBe('0.75rem 1rem');
      expect(resolvedValue(toast, 'font-weight')).toBeNull();
      expect(resolvedValue(toast, 'margin-top')).toBeNull();
    });

    it('still boxes inline error text', () => {
      render('<p role="alert">Unable to load items</p>');
      const message = document.querySelector('[role="alert"]');
      expect(resolvedValue(message, 'padding')).toBe('0.5rem');
      expect(resolvedValue(message, 'border')).toBe(
        `1px solid ${resolvedValue(message, '--error')}`
      );
    });
  });

  describe('calendar event text can be copied', () => {
    it.each([
      'calendar-event-summary',
      'calendar-event-time',
      'calendar-event-location',
      'calendar-event-description',
    ])('selects .%s although the window does not', (name) => {
      render(
        `<div class="calendar-event-row"><div class="${name}">Join https://meet.example</div></div>`
      );
      expect(resolvedValue(document.querySelector(`.${name}`), 'user-select')).toBe('text');
    });
  });

  describe('the media tile progress bar', () => {
    // It shows the position and does nothing else (seeking is the dialog's), so it must not grow or
    // grow a scrub knob under the pointer as if it could be dragged.
    it('keeps its height under the pointer', () => {
      render('<div class="media-tile"><div class="media-tile-seek-bar" data-hover></div></div>');
      expect(resolvedValue(document.querySelector('.media-tile-seek-bar'), 'height')).toBe('3px');
    });

    it('draws no scrub knob', () => {
      expect(fs.readFileSync(STYLESHEET, 'utf8')).not.toMatch(/media-tile-seek-fill::after/);
    });
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

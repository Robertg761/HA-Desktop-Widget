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

  describe('the Settings page chrome', () => {
    const page = (extra = '') => `
      <div id="settings-modal" class="modal"><div class="modal-body">
        <div class="form-group settings-search-box">
          <label for="settings-search">Search settings</label>
          <input id="settings-search" type="search" />
          <p id="settings-search-status" class="form-help" role="status"></p>
        </div>
        <header class="settings-page-header"><h3>General</h3></header>
        <section class="settings-group">
          <div class="settings-group-caption-row">
            <h4 class="settings-group-caption">Primary Cards</h4>
            <button class="btn btn-link btn-sm" type="button">Reset</button>
          </div>
          <div class="settings-group-body">${extra}</div>
        </section>
      </div></div>`;

    it('keeps the 16px under the search box that the form-group rules used to zero', () => {
      render(page());
      expect(resolvedValue(document.querySelector('.settings-search-box'), 'margin-bottom')).toBe(
        '16px'
      );
    });

    it('reads the search label out and does not draw it', () => {
      render(page());
      const label = document.querySelector('.settings-search-box > label');
      expect(resolvedValue(label, 'position')).toBe('absolute');
      expect(resolvedValue(label, 'width')).toBe('1px');
      expect(resolvedValue(label, 'overflow')).toBe('hidden');
      // The field starts where the label would have, without the gap that sat under it.
      expect(resolvedValue(document.querySelector('#settings-search'), 'margin-top')).toBe('0');
    });

    it('starts the page title, the captions and the Reset link at the cards edge', () => {
      render(page());
      expect(resolvedValue(document.querySelector('.settings-page-header'), 'margin')).toBe(
        '0 0 18px'
      );
      expect(resolvedValue(document.querySelector('.settings-group-caption-row'), 'margin')).toBe(
        '0 0 7px'
      );
      // Its padded box overhangs the edge by its own padding, so its text ends there.
      expect(
        resolvedValue(
          document.querySelector('.settings-group-caption-row .btn-link'),
          'margin-inline-end'
        )
      ).toBe('-6px');
    });

    it('sizes a search result like the labels it points to', () => {
      render(
        '<div id="settings-modal"><button class="btn btn-secondary settings-search-result"><span>Title</span><small>General</small></button></div>'
      );
      expect(resolvedValue(document.querySelector('.settings-search-result'), 'font-size')).toBe(
        '0.875rem'
      );
      expect(
        resolvedValue(document.querySelector('.settings-search-result small'), 'font-size')
      ).toBe('0.75rem');
    });
  });

  describe('Settings rows', () => {
    it('gives the Connect row its 12px of padding, away from the divider above it', () => {
      render(`<div id="settings-modal"><div class="settings-group-body">
        <div class="form-group"><input /></div>
        <div class="connection-test-row"><button class="btn btn-primary">Connect</button></div>
      </div></div>`);
      const row = document.querySelector('.connection-test-row');
      expect(resolvedValue(row, 'padding')).toBe('12px 0');
      expect(resolvedValue(row, 'margin-top')).toBe('0');
    });

    it('keeps the Test connection button off the token field above it', () => {
      render(`<div id="settings-modal"><div class="settings-group-body"><details open class="settings-details settings-disclosure">
        <summary>Legacy access token</summary>
        <div class="settings-details-body">
          <div class="form-group"><input /></div>
          <div class="connection-test-row"><button class="btn">Test</button></div>
        </div></details></div></div>`);
      expect(resolvedValue(document.querySelector('.connection-test-row'), 'margin-top')).toBe(
        '10px'
      );
    });

    it('makes the Reset link at least 24px tall', () => {
      render('<div id="settings-modal"><button class="btn btn-link btn-sm">Reset</button></div>');
      expect(resolvedValue(document.querySelector('.btn-link'), 'min-height')).toBe('24px');
    });
  });

  describe('Settings and Support spacing', () => {
    it('leaves no margin under a Settings help line, so the last line sits level with its siblings', () => {
      render(
        '<div id="settings-modal"><div class="setting-text"><p class="help-text">Takes effect.</p><p class="form-help">More.</p></div></div>'
      );
      for (const help of document.querySelectorAll('#settings-modal p')) {
        expect(resolvedValue(help, 'margin-bottom')).toBe('0');
      }
    });

    it('keeps the base help text margin outside Settings', () => {
      render('<p class="help-text">Elsewhere</p>');
      expect(resolvedValue(document.querySelector('.help-text'), 'margin')).toBe('4px 0 8px 0');
    });

    it('sets the Support intro 16px above the frequency control', () => {
      render(
        '<div class="modal"><div class="modal-content donate-modal-content"><div class="modal-body"><p id="donate-intro" class="help-text">Thanks</p><div class="form-group"></div></div></div></div>'
      );
      expect(resolvedValue(document.querySelector('#donate-intro'), 'margin-bottom')).toBe('1rem');
    });

    it('keeps the holiday list a row of its pane, with the 12px of padding every row has', () => {
      render(
        '<div id="settings-modal"><div class="settings-group-body"><fieldset class="seasonal-holiday-list"><legend>Holidays</legend></fieldset></div></div>'
      );
      expect(resolvedValue(document.querySelector('.seasonal-holiday-list'), 'padding')).toBe(
        '12px 0'
      );
    });

    it('does not inset the alerts list from the card by padding of its own', () => {
      render('<div class="inline-alerts-container"></div>');
      expect(resolvedValue(document.querySelector('.inline-alerts-container'), 'padding')).toBe(
        '0'
      );
    });
  });

  describe('Settings at larger text sizes', () => {
    it('fills the window, with no margin of scrim around it', () => {
      render('<div id="settings-modal" class="modal"><div class="modal-content"></div></div>', {
        bodyClass: 'large-interface',
      });
      const content = document.querySelector('.modal-content');
      expect(resolvedValue(content, 'max-width')).toBe('100vw');
      expect(resolvedValue(content, 'max-height')).toBe('100vh');
    });

    it('still leaves the other dialogs their margin', () => {
      render('<div class="modal"><div class="modal-content"></div></div>', {
        bodyClass: 'large-interface',
      });
      expect(resolvedValue(document.querySelector('.modal-content'), 'max-width')).toBe(
        'calc(100vw - 16px)'
      );
    });
  });

  describe('Settings controls', () => {
    it('sets a language pack name in the 14px of the disclosure that lists it', () => {
      render('<div id="settings-modal"><div class="language-pack-name">Deutsch</div></div>');
      expect(resolvedValue(document.querySelector('.language-pack-name'), 'font-size')).toBe(
        '0.875rem'
      );
    });

    it('draws the legacy token disclosure like the other disclosures', () => {
      render(`<div id="settings-modal"><details id="legacy-ha-token-settings" class="settings-details settings-disclosure"><summary>Legacy access token</summary></details>
        <details class="settings-details settings-disclosure"><summary>Offline language packs</summary></details></div>`);
      const [legacy, other] = [...document.querySelectorAll('summary')];
      expect(resolvedValue(legacy, 'font-size')).toBe(resolvedValue(other, 'font-size'));
    });

    it('sizes the section toggle chevron to the details chevron beside it', () => {
      render(
        '<div id="settings-modal"><div class="settings-disclosure-section"><button class="section-toggle"><svg class="section-toggle-icon"></svg></button></div></div>'
      );
      const icon = document.querySelector('.section-toggle-icon');
      expect(resolvedValue(icon, 'font-size')).toBe('1.375rem');
      expect(resolvedValue(icon, 'margin-inline-end')).toBe('-5px');
    });

    it('lays the ten accent presets out as two rows of five', () => {
      render(
        '<div id="settings-modal"><div id="theme-options" class="accent-theme-grid"></div></div>'
      );
      expect(
        resolvedValue(document.querySelector('.accent-theme-grid'), 'grid-template-columns')
      ).toBe('repeat(5, minmax(0, 52px))');
    });

    it('offers Save Custom Color as the secondary action beside the page Save', () => {
      const html = fs.readFileSync(path.resolve(__dirname, '../../index.html'), 'utf8');
      const button = html.match(/<button[^>]*id="save-custom-color-btn"[^>]*>/s)[0];
      expect(button).toMatch(/class="btn btn-secondary"/);
      expect(button).not.toMatch(/btn-primary/);
    });

    it('closes the bracket after an inline code chip without a gap, and shows the chip on light', () => {
      render('<p class="form-help">Press <code>Ctrl+Shift+A</code>)</p>', {
        bodyClass: 'theme-light',
      });
      const chip = document.querySelector('code');
      expect(resolvedValue(chip, 'padding')).toBe('0 3px');
      expect(resolvedValue(chip, 'background')).not.toBe(resolvedValue(chip, '--surface-2'));
    });
  });

  describe('dialogs', () => {
    // A dialog that shows a thing's details or a short form: it was 420 to 460px in the default
    // window, depending on which cap its own rule lost to.
    it.each([
      [
        'entity detail',
        '<div class="modal"><div class="modal-content entity-detail-modal-content"></div></div>',
      ],
      ['media player', '<div class="modal media-modal"><div class="modal-content"></div></div>'],
      [
        'Support',
        '<div class="modal"><div class="modal-content donate-modal-content"></div></div>',
      ],
      [
        'diagnostics',
        '<div class="modal dashboard-tools-modal"><div class="modal-content"></div></div>',
      ],
      ['Add page', '<div class="modal add-page-modal"><div class="modal-content"></div></div>'],
    ])('gives the %s dialog the shared detail width', (_, html) => {
      render(html);
      const content = document.querySelector('.modal-content');
      const width = resolvedValue(content, '--dialog-width');
      expect(width).toBe('min(450px, 90vw)');
      expect(resolvedValue(content, 'width')).toBe(width);
      expect(resolvedValue(content, 'max-width')).toBe(width);
    });

    it('pads the diagnostics and Add page bodies by the 16px the header and footer use', () => {
      render(
        '<div class="modal dashboard-tools-modal"><div class="modal-content"><div class="modal-body"></div></div></div>',
        {}
      );
      expect(resolvedValue(document.querySelector('.modal-body'), 'padding')).toBe('1rem');
    });

    it('closes a dialog with its body padding, not with the last field and the padding', () => {
      render(
        '<div class="modal"><div class="modal-content"><div class="modal-body"><div class="form-group" id="first"></div><div class="form-group" id="last"></div></div></div></div>'
      );
      expect(resolvedValue(document.querySelector('#first'), 'margin-bottom')).toBe('1rem');
      expect(resolvedValue(document.querySelector('#last'), 'margin-bottom')).toBe('0');
    });

    it('sets the to-do and calendar rows below the dialog title', () => {
      render(
        '<div class="modal"><div class="modal-content"><div class="modal-body"><div class="todo-items-list"><div class="todo-item-row"><span class="todo-item-summary">Milk</span></div></div><div class="calendar-events-list"><div class="calendar-event-row"><div class="calendar-event-summary">Dentist</div></div></div><p class="entity-detail-empty">Loading</p></div></div></div>'
      );
      for (const selector of [
        '.todo-item-summary',
        '.calendar-event-summary',
        '.entity-detail-empty',
      ]) {
        expect(resolvedValue(document.querySelector(selector), 'font-size')).toBe('0.875rem');
      }
    });

    it('sets the Add page preview in the form’s 12px, not the dialog’s 16px', () => {
      render(
        '<div class="room-dashboard-preview"><p>Page preview: 2 entities</p><div class="room-preview-tile">Lamp</div></div>'
      );
      expect(
        resolvedValue(document.querySelector('.room-dashboard-preview > p'), 'font-size')
      ).toBe('0.75rem');
      expect(resolvedValue(document.querySelector('.room-preview-tile'), 'font-size')).toBe(
        '0.75rem'
      );
    });
  });

  describe('pop-up controls and tiles', () => {
    it('draws the weather details icons at 14px, at full strength, with a 2-unit stroke', () => {
      render(
        '<div class="weather-detail"><span class="detail-icon"><svg class="entity-line-icon"></svg></span></div>'
      );
      expect(resolvedValue(document.querySelector('.detail-icon'), 'font-size')).toBe('0.875rem');
      expect(resolvedValue(document.querySelector('.detail-icon'), 'opacity')).toBeNull();
      expect(resolvedValue(document.querySelector('.entity-line-icon'), 'stroke-width')).toBe('2');
    });

    it('accents the value in a heading, and not a heading that is all label', () => {
      render(
        '<div class="brightness-control-heading" id="two"><span>Color Temperature</span><span id="value">4250K</span></div><div class="brightness-control-heading" id="one"><span id="label">Color</span></div>'
      );
      const accent = resolvedValue(document.querySelector('#value'), 'color');
      expect(accent).toBe(resolvedValue(document.querySelector('#value'), '--accent-text'));
      expect(resolvedValue(document.querySelector('#label'), 'color')).not.toBe(accent);
    });

    it.each(['climate', 'fan', 'cover'])(
      'sets the %s slider in the dialog’s own padding, level with the chips around it',
      (name) => {
        render(`<div class="${name}-slider-wrapper"></div>`);
        expect(resolvedValue(document.querySelector(`.${name}-slider-wrapper`), 'padding')).toBe(
          '0.75rem 0'
        );
      }
    );

    it('draws a colour swatch as a circle, not as wide as its grid column', () => {
      render(
        '<div class="light-color-swatches"><button class="light-color-swatch"></button></div>'
      );
      const swatch = document.querySelector('.light-color-swatch');
      expect(resolvedValue(swatch, 'width')).toBe('28px');
      expect(resolvedValue(swatch, 'height')).toBe('28px');
      expect(resolvedValue(swatch, 'justify-self')).toBe('center');
    });

    it('lays the climate fan and preset options out on the same grid as the modes', () => {
      render(
        '<div class="climate-mode-buttons" id="modes"></div><div class="climate-option-buttons" id="fans"><button class="climate-fan-mode-btn"></button></div>'
      );
      const modes = document.querySelector('#modes');
      const fans = document.querySelector('#fans');
      expect(resolvedValue(fans, 'display')).toBe('grid');
      expect(resolvedValue(fans, 'grid-template-columns')).toBe(
        resolvedValue(modes, 'grid-template-columns')
      );
      // A lone last chip no longer stretches across the whole row.
      expect(resolvedValue(document.querySelector('.climate-fan-mode-btn'), 'flex')).toBeNull();
    });

    it('sets the mode labels in the weight of the chips beside them', () => {
      render(
        '<span class="climate-mode-label">Heat Cool</span><button class="climate-fan-mode-btn">Auto</button>'
      );
      expect(resolvedValue(document.querySelector('.climate-mode-label'), 'font-weight')).toBe(
        '600'
      );
    });

    it('gives Add and Remove one width, so a column of them has a straight left edge', () => {
      render('<button class="entity-selector-btn add">Add</button>');
      const button = document.querySelector('.entity-selector-btn');
      expect(resolvedValue(button, 'min-width')).toBe('6.5em');
      expect(resolvedValue(button, 'text-align')).toBe('center');
    });

    it('dims an unavailable primary card the way an unavailable tile is dimmed', () => {
      render(
        '<div class="status-card primary-entity-card"><div class="control-item" data-unavailable="true"><div class="control-icon"></div><div class="control-name">Bedroom fan</div><div class="control-state">Unavailable</div></div></div>'
      );
      const name = document.querySelector('.control-name');
      expect(resolvedValue(name, 'color')).toBe(resolvedValue(name, '--text-dim'));
      expect(resolvedValue(document.querySelector('.control-state'), 'color')).toBe(
        resolvedValue(name, '--text-faint')
      );
      // A primary card has no edge of its own to dash.
      expect(resolvedValue(document.querySelector('.control-item'), 'border-style')).not.toBe(
        'dashed'
      );
    });

    it('hides the cover position caption when the cover is unavailable', () => {
      const rule = fs
        .readFileSync(STYLESHEET, 'utf8')
        .match(/\.modal\.entity-unavailable\s+:is\(([^)]*)\)\s*\{\s*display: none/s);
      expect(rule[1]).toContain('.cover-position-label');
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

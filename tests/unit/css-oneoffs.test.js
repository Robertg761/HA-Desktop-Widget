/**
 * @jest-environment jsdom
 */

// Stylesheet one-offs from the 4.0 frontend audit: each describe block pins one rule that was
// wrong, in the cascade the app really paints it in.

const fs = require('fs');
const path = require('path');
const {
  cascadedDeclaration,
  loadAppStylesheets,
  resolvedValue,
  splitTopLevel,
} = require('../helpers/css-cascade.js');

const STYLESHEET = path.resolve(__dirname, '../../styles.css');

function render(html, { bodyClass = '', dir = 'ltr', platform = '' } = {}) {
  document.documentElement.setAttribute('dir', dir);
  document.body.className = bodyClass;
  // applyWindowEffects sets this from the host's platform; a page without one is a plain browser.
  if (platform) document.body.dataset.platform = platform;
  else delete document.body.dataset.platform;
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

/** The width the stylesheet gives every scrollbar, from its page-wide `::-webkit-scrollbar` rule. */
function pageScrollbarWidth() {
  for (const sheet of document.styleSheets) {
    for (const rule of sheet.cssRules) {
      if (rule.selectorText === '::-webkit-scrollbar') return rule.style.width;
    }
  }
  return null;
}

describe('stylesheet one-offs', () => {
  beforeAll(() => {
    loadAppStylesheets(document);
  });

  afterEach(() => {
    document.documentElement.removeAttribute('dir');
    document.body.className = '';
    delete document.body.dataset.platform;
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

    it('boxes a list that failed to load, which asks for it', () => {
      render('<p class="entity-detail-error" role="alert">Unable to load items</p>');
      const message = document.querySelector('[role="alert"]');
      expect(resolvedValue(message, 'padding')).toBe('0.5rem');
      expect(resolvedValue(message, 'border')).toBe(
        `1px solid ${resolvedValue(message, '--error')}`
      );
    });

    // Said under the field, in red: announced as an alert or not, an inline error is the same red
    // line. The box turned up only with role="alert", which a field error gets when it is raised
    // while the field has focus, so one error looked two ways.
    it.each([
      ['the Support amount', '<p class="form-help donate-amount-error" role="alert">Too much</p>'],
      [
        'the Add page name',
        '<div class="add-page-modal"><p class="form-help add-page-name-error" role="alert">Enter page name</p></div>',
      ],
      [
        'a Settings field',
        '<div id="settings-modal"><p class="form-help form-error field-error" role="alert">Invalid URL</p></div>',
      ],
      [
        'a failed connection test',
        '<div class="connection-test-status" data-status="error" role="alert">Could not connect</div>',
      ],
      [
        'the first-run wizard',
        '<div class="first-run-status" data-status="error" role="alert">Enter a valid URL</div>',
      ],
    ])('leaves the error for %s as red text, alert or not', (_name, html) => {
      render(html);
      const message = document.querySelector('[role="alert"]');
      const plain = { padding: null, border: null, background: null };
      const box = Object.fromEntries(
        Object.keys(plain).map((property) => [property, resolvedValue(message, property)])
      );
      // The same element without the role looks the same.
      message.removeAttribute('role');
      const without = Object.fromEntries(
        Object.keys(plain).map((property) => [property, resolvedValue(message, property)])
      );
      message.setAttribute('role', 'alert');

      expect(box).toEqual(without);
      expect(resolvedValue(message, 'background')).toBeNull();
      expect(cascadedDeclaration(message, 'color').value).toBe('var(--error-text)');
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

  describe('a hotkey field that records', () => {
    // Its value is an instruction, not a hotkey, so it is set as text: the monospace stack that suits
    // 'Ctrl+Shift+K' falls to a mismatched face for the same words in Arabic, Hindi and Chinese.
    it.each([
      ['the popup hotkey field', '<input id="popup-hotkey-input" data-recording="true" />'],
      ['an entity hotkey field', '<input class="hotkey-input" data-recording="true" />'],
    ])('sets %s in the text face while it listens', (_, html) => {
      render(html);
      const field = document.querySelector('input');
      expect(resolvedValue(field, 'font-family')).toBe(resolvedValue(field, '--font-sans'));
      expect(resolvedValue(field, 'letter-spacing')).toBe('0');
    });

    it('keeps a saved hotkey in the code face', () => {
      render('<input class="hotkey-input" value="Ctrl+Shift+K" />');
      const field = document.querySelector('input');
      expect(resolvedValue(field, 'font-family')).toBe(resolvedValue(field, '--font-mono'));
    });
  });

  describe('touch targets on a coarse pointer', () => {
    // The dialog recipe's 34px button and 28px close button have the same weight as the 44px
    // minimum and came later in the file, so they used to win on a touch screen.
    it.each([
      ['.btn', 'min-height'],
      ['.close-btn', 'min-height'],
      ['.close-btn', 'min-width'],
    ])('gives %s a 44px %s', (selector, property) => {
      render(`<div class="modal"><button class="${selector.slice(1)}">x</button></div>`);
      const element = document.querySelector(selector);
      expect(resolvedValue(element, property, { pointer: 'coarse' })).toBe('44px');
      expect(resolvedValue(element, property, { pointer: 'fine' })).not.toBe('44px');
    });

    // Each of these has a rule of its own for its size, and each of those rules outweighs a bare
    // `.btn` or `.close-btn`, wherever in the file the touch block sits.
    const CONTEXTS = [
      [
        'a compact pager button',
        '<div class="primary-cards-list-actions primary-cards-pagination"><button class="btn btn-secondary btn-sm">x</button></div>',
      ],
      [
        'a compact button in the primary card chooser',
        '<div class="primary-card-actions segmented-control"><button class="btn btn-secondary btn-sm">x</button></div>',
      ],
      [
        'a compact button for a custom icon',
        '<div class="custom-entity-icon-actions"><button class="btn btn-secondary btn-sm">x</button></div>',
      ],
      [
        'the Save and Cancel buttons of Settings',
        '<div id="settings-modal" class="modal"><div class="modal-footer"><button class="btn btn-primary">x</button></div></div>',
      ],
      [
        'a link button in Settings',
        '<div id="settings-modal" class="modal"><button class="btn btn-link btn-sm">x</button></div>',
      ],
      [
        'a hotkey preset in Settings',
        '<div id="settings-modal" class="modal"><button class="btn btn-secondary btn-sm preset-hotkey-btn">x</button></div>',
      ],
      [
        'the Cancel button of a confirmation',
        '<div class="modal-content confirm-modal-content"><div class="modal-footer"><button class="btn btn-secondary">x</button></div></div>',
      ],
      [
        'an option of a segmented control such as the Settings mode switch',
        '<div class="segmented-control"><button class="segmented-option">x</button></div>',
      ],
      [
        'a transport button of the media player',
        '<div class="media-detail-controls"><button class="btn media-detail-seek-btn">x</button></div>',
      ],
      [
        'the close button of Settings',
        '<div id="settings-modal" class="modal"><div class="modal-header"><button class="close-btn">x</button></div></div>',
      ],
    ];
    const px = (value) => Number.parseFloat(value);

    it.each(CONTEXTS)('keeps %s at least 44px tall and wide', (_name, html) => {
      render(html);
      const button = document.querySelector('button');
      for (const property of ['min-height', 'min-width']) {
        const touch = resolvedValue(button, property, { pointer: 'coarse' });
        expect(px(touch)).toBeGreaterThanOrEqual(44);
      }
    });

    it('leaves a mouse the compact sizes', () => {
      render(CONTEXTS[0][1]);
      const button = document.querySelector('button');
      expect(resolvedValue(button, 'min-height', { pointer: 'fine' })).toBe('28px');
    });

    it.each([
      ['.update-actions', 'min-width', '100px'],
      ['.confirm-modal-content', 'min-width', '88px'],
    ])('does not shrink the wider buttons of %s', (container, property, wanted) => {
      // The touch minimum is a floor. A rule that forced 44px onto min-width would take these
      // dialog buttons down from the width their labels were given.
      render(`<div class="${container.slice(1)}"><button class="btn">x</button></div>`);
      const button = document.querySelector('button');
      expect(resolvedValue(button, property, { pointer: 'coarse' })).toBe(wanted);
    });

    it('gives the micro pin’s presets the 24px every other preset has', () => {
      render(
        '<div class="desktop-pin-light-control" data-layout="micro"><button class="desktop-pin-light-preset">25</button></div>'
      );
      expect(resolvedValue(document.querySelector('.desktop-pin-light-preset'), 'min-height')).toBe(
        '24px'
      );
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
      // The old rule zeroed the longhand, which the shorthand above does not show.
      expect(resolvedValue(row, 'padding-top')).not.toBe('0');
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

    // At a fixed 220px beside its button, French cut the hint to "Choisissez un dossier
    // synchronis...". Until a folder is chosen the field is as wide as its hint, so where the two do
    // not fit one row the button goes under it; a chosen folder keeps the field as it was.
    it('sizes the empty sync folder field to its hint', () => {
      render(`<div id="settings-modal"><div class="form-group"><div class="profile-sync-file-row">
        <input id="profile-sync-folder-path" type="text" class="form-control" readonly
          placeholder="Choisissez un dossier synchronisé...">
        <button type="button" class="btn btn-secondary">Choisir un dossier...</button>
      </div></div></div>`);
      const field = document.getElementById('profile-sync-folder-path');
      expect(resolvedValue(field, 'field-sizing')).toBe('content');
      expect(resolvedValue(field, 'width')).toBe('auto');
      expect(resolvedValue(field, 'flex-basis')).toBe('auto');

      // jsdom cannot tell when a field has text, so the selector that keeps this to the empty
      // field is read from the stylesheet.
      expect(fs.readFileSync(STYLESHEET, 'utf8')).toMatch(
        /\.profile-sync-file-row > input\[readonly\]:placeholder-shown \{[^}]*field-sizing: content;/
      );
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
      // The tile pop-ups were 360px (light, fan, cover) and 400px (climate) beside the 450px
      // media and detail dialogs, so opening one tile after another changed the width each time.
      ...['brightness', 'fan', 'cover', 'climate'].map((name) => [
        `${name} pop-up`,
        `<div class="modal ${name}-modal"><div class="modal-content ${name}-modal-content"></div></div>`,
      ]),
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

    // A body that scrolls kept its scrollbar inside the right padding, so its right margin was 9px
    // wider than its left, and its content moved sideways when a filter made it start or stop
    // scrolling. The scrollbar's room is kept either way, and the end padding gives it back.
    it.each([
      ['a pop-up', '<div class="modal"><div class="modal-content"><div class="modal-body">'],
      [
        'a confirmation',
        '<div class="modal"><div class="modal-content confirm-modal-content"><div class="modal-body">',
      ],
      [
        'Add page',
        '<div class="modal add-page-modal"><div class="modal-content"><div class="modal-body">',
      ],
      [
        'diagnostics',
        '<div class="modal dashboard-tools-modal"><div class="modal-content"><div class="modal-body">',
      ],
    ])('keeps the scrollbar’s room in %s body, and gives it back at the end', (_, html) => {
      render(`${html}</div></div></div>`);
      const body = document.querySelector('.modal-body');
      const inset = resolvedValue(body, '--modal-body-inset');
      const scrollbar = resolvedValue(body, '--modal-scrollbar-size');

      expect(resolvedValue(body, 'scrollbar-gutter')).toBe('stable');
      expect(resolvedValue(body, 'padding')).toBe(inset);
      expect(resolvedValue(body, 'padding-inline-end')).toBe(`calc(${inset} - ${scrollbar})`);
      // The room kept is the scrollbar the body draws.
      const bar = [...document.styleSheets]
        .flatMap((sheet) => [...sheet.cssRules])
        .find((rule) => rule.selectorText === '.modal-body::-webkit-scrollbar');
      expect(bar.style.width).toBe('var(--modal-scrollbar-size)');
    });

    it('lets the sticky to-do field reach the scrollbar’s room, and no further', () => {
      render(
        '<div class="modal"><div class="modal-content"><div class="modal-body"><form class="todo-add-form"></form></div></div></div>'
      );
      const form = document.querySelector('.todo-add-form');
      const inset = resolvedValue(form, '--modal-body-inset');
      const scrollbar = resolvedValue(form, '--modal-scrollbar-size');

      expect(resolvedValue(form, 'margin-inline').replace(/\s+/g, ' ')).toBe(
        `calc(-1 * ${inset}) calc(${scrollbar} - ${inset})`
      );
      // Its field ends where the rest of the body's content does.
      expect(resolvedValue(form, 'padding-inline-end')).toBe(
        resolvedValue(form.parentElement, 'padding-inline-end')
      );
    });

    // An on/off fan or light, or a cover that cannot be moved from here, hides every child of its
    // content block while it is unavailable; the empty block's padding stood as 75px of nothing
    // between the note and the footer. jsdom cannot match :has() inside :not(), so this reads the
    // rule; the popup-fan-unavailable snapshot checks the layout in Chromium.
    it('takes away a pop-up content block that has nothing left to operate while unavailable', () => {
      const rule = [...document.styleSheets]
        .flatMap((sheet) => [...sheet.cssRules])
        .find((candidate) => /:not\(:has\(input, button, select\)\)/.test(candidate.selectorText));
      const selector = rule.selectorText.replace(/\s+/g, ' ');

      expect(selector).toContain('.modal.entity-unavailable');
      ['.brightness-content', '.fan-content', '.cover-content'].forEach((block) =>
        expect(selector).toContain(block)
      );
      // The climate block keeps its readings, which are not controls.
      expect(selector).not.toContain('.climate-content');
      expect(rule.style.display).toBe('none');
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
        '<div class="brightness-control-heading" id="two"><span>Color temperature</span><span id="value">4250K</span></div><div class="brightness-control-heading" id="one"><span id="label">Color</span></div>'
      );
      const accent = resolvedValue(document.querySelector('#value'), 'color');
      expect(accent).toBe(resolvedValue(document.querySelector('#value'), '--accent-text'));
      expect(resolvedValue(document.querySelector('#label'), 'color')).not.toBe(accent);
    });

    it.each(['climate', 'fan', 'cover'])(
      'sets the %s slider in the dialog’s own padding, level with the chips around it',
      (name) => {
        render(`<div class="${name}-slider-wrapper"></div>`);
        const wrapper = document.querySelector(`.${name}-slider-wrapper`);
        expect(resolvedValue(wrapper, 'padding-inline')).toBe('0');
        // The 12px above and below stay.
        expect(resolvedValue(wrapper, 'padding')).toBe('0.75rem');
      }
    );

    it('draws a colour swatch as a circle, not as wide as its grid column', () => {
      render(
        '<div class="light-color-swatches"><button class="light-color-swatch"></button></div>'
      );
      const swatch = document.querySelector('.light-color-swatch');
      // Up to 28px, and smaller in a narrow column, but always as tall as it is wide.
      expect(resolvedValue(swatch, 'width')).toBe('min(28px, 100%)');
      expect(resolvedValue(swatch, 'height')).toBe('auto');
      expect(resolvedValue(swatch, 'aspect-ratio')).toBe('1');
      expect(resolvedValue(swatch, 'justify-self')).toBe('center');
    });

    describe('the light pop-up’s colour row', () => {
      const row = () => {
        render(
          '<div class="brightness-color-row"><input type="color" class="light-color-picker"><div class="light-color-swatches"><button class="light-color-swatch"></button></div></div>'
        );
        return {
          row: document.querySelector('.brightness-color-row'),
          picker: document.querySelector('.light-color-picker'),
          swatches: document.querySelector('.light-color-swatches'),
        };
      };
      const px = (value) => parseFloat(value) * (String(value).endsWith('rem') ? 16 : 1);

      // A 44x36 well with Chromium's square, bevelled swatch in it stood beside six 28px circles.
      it('sets the custom colour in a 32px well, a little larger than the swatches, filled by the colour', () => {
        const { picker } = row();
        expect(resolvedValue(picker, 'width')).toBe('32px');
        expect(resolvedValue(picker, 'height')).toBe('32px');

        const rules = [...document.styleSheets].flatMap((sheet) => [...sheet.cssRules]);
        const pseudo = (name) =>
          rules.find((rule) => rule.selectorText === `.light-color-picker::-webkit-color-${name}`);
        expect(pseudo('swatch-wrapper').style.padding).toMatch(/^0(px)?$/);
        expect(pseudo('swatch').style.border).toMatch(/^0(px)?$/);
        expect(pseudo('swatch').style.getPropertyValue('border-radius')).toBe(
          'calc(var(--radius-md) - 4px)'
        );
      });

      // An auto-fit grid took five columns in a narrow dialog and left the sixth swatch alone on a
      // second row. Six stay in one row and shrink; only a row too narrow even for 24px swatches
      // goes to two rows of three, never five and one.
      it('keeps six swatches in a row, and goes to two rows of three only when they cannot fit', () => {
        const { row: container, picker, swatches } = row();
        const columns = (width) =>
          resolvedValue(swatches, 'grid-template-columns', { container: { width } });

        expect(resolvedValue(container, 'container-type')).toBe('inline-size');
        expect(columns(400)).toBe('repeat(6, minmax(24px, 1fr))');
        expect(columns(220)).toBe('repeat(6, minmax(24px, 1fr))');
        expect(columns(219)).toBe('repeat(3, minmax(24px, 1fr))');

        // The switch is where six 24px swatches and their gaps no longer fit beside the picker.
        const gap = px(resolvedValue(swatches, 'gap'));
        const needed =
          px(resolvedValue(picker, 'width')) +
          px(resolvedValue(container, 'gap')) +
          6 * 24 +
          5 * gap;
        expect(needed).toBeCloseTo(220, 0);
      });
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

    // The dialog holds four 80px chips a row, so five left a heat pump's fan-only mode alone on
    // the second row, six put two under four, and nine one under eight. jsdom cannot match
    // :has(> ...), so the rule is picked as the browser picks it: the last one naming the count.
    it.each([
      [4, 'repeat(2, minmax(0, 1fr))'],
      [5, 'repeat(3, minmax(0, 1fr))'],
      [6, 'repeat(3, minmax(0, 1fr))'],
      [9, 'repeat(3, minmax(0, 1fr))'],
      [7, undefined],
      [8, undefined],
    ])('lays %i climate chips out in full rows', (count, columns) => {
      const counted = `:has(> :nth-child(${count}):last-child)`;
      const rules = [...document.styleSheets]
        .flatMap((sheet) => [...sheet.cssRules])
        .filter((rule) =>
          ['.climate-mode-buttons', '.climate-option-buttons'].every((grid) =>
            rule.selectorText
              ?.split(/,\s*(?=:is\()/)
              .some((selector) => selector.includes(grid) && selector.endsWith(counted))
          )
        );
      expect(rules.at(-1)?.style.getPropertyValue('grid-template-columns') || undefined).toBe(
        columns
      );
    });

    // Three chips a row in a narrow window are about 72px wide. With 8px at each side "Heat/Cool"
    // (58px) wrapped after its slash; with 4px only longer combined modes wrap.
    it('leaves a climate chip label 4px at its sides', () => {
      render(
        '<div class="climate-mode-buttons"><button class="climate-mode-btn"></button></div><div class="climate-option-buttons"><button class="climate-fan-mode-btn"></button><button class="climate-preset-mode-btn"></button></div>'
      );
      for (const chip of document.querySelectorAll('button')) {
        expect(resolvedValue(chip, 'padding')).toBe('0.5rem 0.25rem');
      }
    });

    it('sets the mode labels in the weight of the chips beside them', () => {
      render(
        '<span class="climate-mode-label">Heat Cool</span><button class="climate-fan-mode-btn">Auto</button>'
      );
      expect(resolvedValue(document.querySelector('.climate-mode-label'), 'font-weight')).toBe(
        '600'
      );
    });

    it.each([
      [
        'Manage Quick Access',
        '<div id="quick-controls-modal" class="modal"><button class="entity-selector-btn add">Add</button></div>',
      ],
      [
        'the comparison graph editor',
        '<div class="modal comparison-graph-modal"><button class="entity-selector-btn add">Add</button></div>',
      ],
    ])(
      'gives Add and Remove one width in %s, so their column has a straight left edge',
      (_, html) => {
        render(html);
        const button = document.querySelector('.entity-selector-btn');
        expect(resolvedValue(button, 'min-width')).toBe('6em');
        expect(resolvedValue(button, 'text-align')).toBe('center');
      }
    );

    it('leaves the one-word buttons of other lists their own width', () => {
      render(
        '<div id="entity-repair-modal" class="modal"><button class="entity-selector-btn add">Use</button></div>'
      );
      expect(resolvedValue(document.querySelector('.entity-selector-btn'), 'min-width')).toBe(
        'fit-content'
      );
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

    it.each([
      ['the cover position caption', '.cover-position-label', 'cover-modal', 'cover-content'],
      ['the fan icon circle', '.fan-icon-wrapper', 'fan-modal', 'fan-content'],
      [
        'the light icon circle',
        '.brightness-icon-wrapper',
        'brightness-modal',
        'brightness-content',
      ],
      ['the cover graphic', '.cover-visual', 'cover-modal', 'cover-content'],
    ])('hides %s when the entity is unavailable', (_, selector, modalClass, contentClass) => {
      // The note says why, so a caption over nothing or a lone icon over a gap only looks unfinished.
      const markup = (state) =>
        `<div class="modal ${modalClass} ${state}"><div class="modal-content"><div class="modal-body"><div class="${contentClass}"><div class="${selector.slice(1)}"></div></div></div></div></div>`;
      render(markup('entity-unavailable'));
      expect(resolvedValue(document.querySelector(selector), 'display')).toBe('none');
      render(markup(''));
      expect(resolvedValue(document.querySelector(selector), 'display')).not.toBe('none');
    });
  });

  describe('the timer tint', () => {
    const timer = (state) => `<div class="timer-entity" data-state="${state}"></div>`;
    const tint = (state, accent) => {
      render(timer(state));
      if (accent) document.body.dataset.accent = accent;
      return resolvedValue(document.querySelector('.timer-entity'), '--timer-rgb');
    };

    afterEach(() => {
      delete document.body.dataset.accent;
    });

    it('is green while running and amber while paused', () => {
      expect(tint('active', 'original')).toBe('129, 199, 132');
      expect(tint('paused', 'original')).toBe('255, 183, 77');
    });

    it('leaves the green to the lit tiles under the Emerald accent', () => {
      expect(tint('active', 'emerald')).toBe('77, 208, 225');
      // Paused is still amber there: nothing else is.
      expect(tint('paused', 'emerald')).toBe('255, 183, 77');
    });

    it('leaves the amber to the lit tiles under the Amber accent', () => {
      expect(tint('paused', 'amber')).toBe('176, 190, 197');
      expect(tint('active', 'amber')).toBe('129, 199, 132');
    });
  });

  describe('the main window layout', () => {
    const page = '<div class="widget-header"></div><div class="widget-content"></div>';

    it('shares the window between the header and the content instead of subtracting a constant', () => {
      render(page);
      const content = document.querySelector('.widget-content');
      expect(resolvedValue(document.body, 'display')).toBe('flex');
      expect(resolvedValue(document.body, 'flex-direction')).toBe('column');
      expect(resolvedValue(document.body, 'height')).toBe('100vh');
      expect(resolvedValue(content, 'flex')).toBe('1 1 auto');
      expect(resolvedValue(content, 'min-height')).toBe('0');
      // The old 100vh - 40px under a header that is 41px made the page one pixel too tall.
      expect(resolvedValue(content, 'height')).toBeNull();
    });

    it('leaves a pinned widget window alone', () => {
      render(page, { bodyClass: 'desktop-pin-mode' });
      expect(resolvedValue(document.body, 'display')).not.toBe('flex');
    });

    it('keeps the scrollbar gutter always, so a page that scrolls is as wide as one that does not', () => {
      render(page);
      const content = document.querySelector('.widget-content');
      expect(resolvedValue(content, 'scrollbar-gutter')).toBe('stable');
      // The gutter is 9px, so the end padding is 14 - 9: the margins are level when nothing scrolls.
      expect(resolvedValue(content, '--content-gutter')).toBe('9px');
      expect(resolvedValue(content, 'padding-inline-end')).toBe('max(0px, calc(14px - 9px))');
    });

    it.each([
      [419, 'max(0px, calc(10px - 9px))'],
      [359, 'max(0px, calc(8px - 9px))'],
    ])('gives the gutter back from the narrower padding at %ipx', (width, padding) => {
      render(page);
      expect(
        resolvedValue(document.querySelector('.widget-content'), 'padding-inline-end', {
          viewport: { width, height: 600 },
        })
      ).toBe(padding);
    });

    it.each(['win32', 'linux', 'darwin'])(
      'gives the gutter back on %s, with no platform asking for less',
      (platform) => {
        // macOS included: it is not an overlay-scrollbar platform here (see the next test), so the
        // gutter is reserved there as much as on Windows, and the end padding must give it back.
        render(page, { platform });
        const content = document.querySelector('.widget-content');
        expect(resolvedValue(content, '--content-gutter')).toBe('9px');
        expect(resolvedValue(content, 'padding-inline-end')).toBe('max(0px, calc(14px - 9px))');
      }
    );

    it('reserves the width of the scrollbar the page draws, which is a classic one on every platform', () => {
      // Styling ::-webkit-scrollbar turns off the overlay scrollbars macOS would draw, as does the
      // standard scrollbar-width on the element: either would leave the gutter empty on macOS and
      // the end padding 9px short of the start. The macOS captures of the visual snapshot job show
      // both margins at 14px with the gutter given back unconditionally.
      render(page);
      const content = document.querySelector('.widget-content');
      expect(pageScrollbarWidth()).toBe('9px');
      expect(resolvedValue(content, '--content-gutter')).toBe(pageScrollbarWidth());
      expect(resolvedValue(content, 'scrollbar-width')).toBeNull();
    });

    it('holds no gutter in forced colours, where the system draws a scrollbar of its own width', () => {
      render(page);
      const content = document.querySelector('.widget-content');
      expect(resolvedValue(content, 'scrollbar-gutter', { forcedColors: true })).toBe('auto');
      expect(resolvedValue(content, 'padding-inline-end', { forcedColors: true })).toBe(
        'max(0px, calc(14px - 0px))'
      );
    });
  });

  describe('the first-run wizard', () => {
    const step = (content) =>
      `<div class="first-run-panel"><div class="first-run-content">${content}</div><div class="first-run-status connection-status-empty" role="status"></div></div>`;

    it.each([
      ['the URL step', '<label class="first-run-label">Home Assistant URL</label><input />'],
      [
        'the Authorize step',
        '<p class="first-run-security-note">Your password never enters this app.</p>',
      ],
    ])('keeps room for a one-line status on %s, even when it is empty', (_, content) => {
      render(step(content));
      const status = document.querySelector('.first-run-status');
      expect(resolvedValue(status, 'position')).toBe('static');
      expect(resolvedValue(status, 'min-height')).toBe('1.4em');
    });

    it('keeps the same room once it has a one-line message', () => {
      render(step('<label class="first-run-label">Home Assistant URL</label>'));
      const status = document.querySelector('.first-run-status');
      status.classList.remove('connection-status-empty');
      expect(resolvedValue(status, 'min-height')).toBe('1.4em');
    });

    // In the minimum window step 3's note was cut off above a blank band where the empty line sat:
    // the card fills the window there, so the line held the buttons nowhere.
    it('gives the empty line’s room to the text first in a short window', () => {
      render(step('<p class="first-run-security-note">Your password never enters this app.</p>'));
      const status = document.querySelector('.first-run-status');
      const short = { viewport: { width: 320, height: 360 } };

      expect(resolvedValue(status, 'flex', short)).toBe('0 1000 auto');
      expect(resolvedValue(status, 'min-height', short)).toBe('0');
      // Its gap is part of its height, so that yields too; where the card fits, the room is the same.
      expect(resolvedValue(status, 'margin-top', short)).toBe('0');
      expect(resolvedValue(status, 'height', short)).toBe('calc(1.4em + 0.5rem)');
      // A message keeps its lines.
      status.classList.remove('connection-status-empty');
      expect(resolvedValue(status, 'flex', short)).toBe('none');
      expect(resolvedValue(status, 'min-height', short)).toBe('1.4em');
    });

    it('leaves the welcome step, which has no status line to show, as it was', () => {
      render(step('<p class="first-run-copy">Connect your server.</p>'));
      const status = document.querySelector('.first-run-status');
      expect(resolvedValue(status, 'position')).toBe('absolute');
      expect(resolvedValue(status, 'min-height')).toBeNull();
    });

    // When the whole card scrolled, a short window put step 3's Back and Connect below its fold.
    it('scrolls the step’s text in a short window, and keeps the buttons in view', () => {
      render(
        `<div class="first-run-panel"><div class="first-run-content"></div>
          <div class="first-run-status" role="status"></div><div class="first-run-actions"></div></div>`
      );
      const card = document.querySelector('.first-run-panel');
      const text = document.querySelector('.first-run-content');
      const short = { viewport: { width: 320, height: 360 } };

      expect(resolvedValue(card, 'display', short)).toBe('flex');
      expect(resolvedValue(card, 'flex-direction', short)).toBe('column');
      expect(resolvedValue(text, 'overflow-y', short)).toBe('auto');
      expect(resolvedValue(text, 'min-height', short)).toBe('0');
      expect(resolvedValue(text, 'flex', short)).toBe('0 1 auto');
      for (const kept of ['.first-run-status', '.first-run-actions']) {
        expect(resolvedValue(document.querySelector(kept), 'flex', short)).toBe('none');
      }
      // A window with room for every step lays the card out as before.
      expect(resolvedValue(card, 'display')).toBeNull();
      expect(resolvedValue(text, 'overflow-y')).toBeNull();
    });
  });

  describe('entity pick lists', () => {
    it('keeps the Manage Quick Access dialog one height whatever a search leaves in it', () => {
      render(
        '<div id="quick-controls-modal" class="modal"><div class="modal-content"></div></div>'
      );
      expect(resolvedValue(document.querySelector('.modal-content'), 'height')).toBe(
        'min(620px, calc(100dvh - 1.5rem))'
      );
    });

    it('centres the no-match message in the list it fills', () => {
      render(
        '<div class="modal-body"><div class="entity-selector-list"><p class="entity-selector-empty">No matching entities</p></div></div>'
      );
      const empty = document.querySelector('.entity-selector-empty');
      expect(resolvedValue(empty, 'display')).toBe('grid');
      expect(resolvedValue(empty, 'place-items')).toBe('center');
      expect(resolvedValue(empty, 'min-height')).toBe('100%');
    });

    it('lets the graph editor wrap the sensor line instead of cutting its id off', () => {
      render(
        '<div class="modal comparison-graph-modal"><div class="entity-item"><div class="entity-item-info"><span class="entity-id">Outside temperature · weather.home</span></div></div></div>'
      );
      const id = document.querySelector('.entity-id');
      expect(resolvedValue(id, 'white-space')).toBe('normal');
      expect(resolvedValue(id, 'overflow-wrap')).toBe('anywhere');
      // Other lists keep their one line and ellipsis.
      render('<div class="entity-item"><span class="entity-id">sensor.office_temp</span></div>');
      expect(resolvedValue(document.querySelector('.entity-id'), 'white-space')).toBe('nowrap');
    });

    it('does not stretch a message that shares the list with rows', () => {
      render(
        '<div class="entity-selector-list"><div class="entity-item"></div><p class="entity-selector-empty">x</p></div>'
      );
      expect(resolvedValue(document.querySelector('.entity-selector-empty'), 'display')).not.toBe(
        'grid'
      );
    });
  });

  describe('the connection colours', () => {
    it('gives the header dot and the diagnostics dot the same two colours, in both themes', () => {
      for (const bodyClass of ['', 'theme-light']) {
        render(
          '<div class="connection-indicator connected" id="up"></div><div class="connection-indicator" id="down"></div>',
          {
            bodyClass,
          }
        );
        for (const [id, token] of [
          ['up', '--connection-ok'],
          ['down', '--connection-bad'],
        ]) {
          const dot = document.getElementById(id);
          expect(resolvedValue(dot, '--indicator-color')).toBe(resolvedValue(dot, token));
        }
      }
    });

    it('picks darker colours on the light header, where the pastel ones are 1.7:1', () => {
      render('<div class="connection-indicator connected"></div>', { bodyClass: 'theme-light' });
      expect(
        resolvedValue(document.querySelector('.connection-indicator'), '--connection-ok')
      ).toBe('#15803d');
    });

    it('draws the diagnostics dot from the same tokens, not from the accent', () => {
      const css = fs.readFileSync(path.resolve(__dirname, '../../dashboard-workflows.css'), 'utf8');
      const dot = css.match(/\.diagnostics-status::before\s*\{[^}]*\}/s)[0];
      const connected = css.match(
        /\.diagnostics-status\[data-connected='true'\]::before\s*\{[^}]*\}/s
      )[0];
      expect(dot).toContain('var(--connection-bad)');
      expect(connected).toContain('var(--connection-ok)');
      expect(dot + connected).not.toContain('--accent');
    });

    it('hides the report’s bright resize grip', () => {
      const css = fs.readFileSync(path.resolve(__dirname, '../../dashboard-workflows.css'), 'utf8');
      expect(css).toMatch(/\.diagnostics-report::-webkit-resizer\s*\{\s*background: transparent;/);
    });
  });

  describe('the alert dialog’s labels', () => {
    const dialog = `<div class="modal" id="alert-config-modal"><div class="modal-body">
      <div class="form-group alert-advanced-options">
        <label id="field"><span>Threshold</span><input type="number" /></label>
        <label id="switch" class="workflow-checkbox"><span>Enable quiet hours</span><input type="checkbox" /></label>
        <div class="form-group" id="target"><label id="state">Target state</label></div>
      </div>
      <div class="sensor-history-controls"><label id="history">Period</label></div>
    </div></div>`;

    it('takes the shared form label colour, like the entity picker’s labels', () => {
      render(dialog);
      const shared = resolvedValue(document.body, '--text-primary');
      expect(resolvedValue(document.querySelector('#field'), 'color')).toBe(shared);
      expect(resolvedValue(document.querySelector('#state'), 'color')).toBe(shared);
    });

    it('sets a switch row a step larger than the fields under it, on purpose', () => {
      render(dialog);
      expect(resolvedValue(document.querySelector('#switch'), 'font-size')).toBe('0.875rem');
      expect(resolvedValue(document.querySelector('#field'), 'font-size')).toBe('0.75rem');
    });

    it('leaves the history dialog’s labels in the secondary colour', () => {
      render(dialog);
      expect(resolvedValue(document.querySelector('#history'), 'color')).toBe(
        resolvedValue(document.body, '--text-secondary')
      );
    });
  });

  describe('the hotkey capture dialog', () => {
    it('keeps the preview strip one line tall before and after the first key', () => {
      render(
        '<div class="hotkey-capture-modal"><div class="modal-content"><div id="hotkey-preview" class="hotkey-preview-box"></div></div></div>'
      );
      const box = document.querySelector('#hotkey-preview');
      // One 18px line at 1.5, the 24px of padding and the 2px of border.
      expect(resolvedValue(box, 'min-height')).toBe('calc(1.125rem * 1.5 + 26px)');
      expect(resolvedValue(box, 'line-height')).toBe('1.5');
      expect(resolvedValue(box, 'display')).toBe('grid');
    });

    it('shows a quiet ellipsis in the empty strip instead of a missing field', () => {
      const css = fs.readFileSync(STYLESHEET, 'utf8');
      // The empty alternative after the slash keeps the dots out of what a screen reader announces.
      expect(css).toMatch(/\.hotkey-preview-box:empty::before\s*\{\s*content: '\\2026' \/ '';/);
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

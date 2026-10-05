/**
 * @jest-environment jsdom
 */

const fs = require('fs');
const path = require('path');
const { loadAppStylesheets, resolvedValue } = require('../helpers/css-cascade.js');
const { renderNotificationMarkdown } = require('../../src/notification-markdown.js');

const stylesheet = fs.readFileSync(path.resolve(__dirname, '../../styles.css'), 'utf8');

function render(html, { dir = 'ltr', lang = 'en', bodyClass = '' } = {}) {
  document.documentElement.setAttribute('dir', dir);
  document.documentElement.setAttribute('lang', lang);
  document.body.className = bodyClass;
  document.body.innerHTML = html;
}

describe('right-to-left and script-aware typography', () => {
  beforeAll(() => {
    loadAppStylesheets(document);
  });

  afterEach(() => {
    document.documentElement.removeAttribute('dir');
    document.documentElement.removeAttribute('lang');
    document.body.className = '';
    document.body.innerHTML = '';
  });

  describe('text that carries its own direction', () => {
    // Names, states and messages written by Home Assistant (or by the user) are cut at their end and
    // keep their punctuation, whatever script they are in.
    const AUTHORED = [
      [
        '.command-palette-result-state',
        '<span class="command-palette-result-state">21.4 °C</span>',
      ],
      ['.command-palette-result-name', '<span class="command-palette-result-name">Office</span>'],
      ['.persistent-notification-title', '<div class="persistent-notification-title">Door.</div>'],
      ['.persistent-notification-message', '<div class="persistent-notification-message">x.</div>'],
      ['.modal-header h2', '<div class="modal-header"><h2>Upstairs hallway light</h2></div>'],
      ['.toast-message', '<div class="toast toast-message">Could not save.</div>'],
      ['.media-tile-artist', '<div class="media-tile-artist">Artist</div>'],
      ['.media-tile-title', '<div class="media-tile-title">Title</div>'],
      ['.media-artist', '<div class="media-artist">Artist</div>'],
      ['.media-album', '<div class="media-album">Album</div>'],
      ['.entity-item .entity-name', '<div class="entity-item"><b class="entity-name">A</b></div>'],
      ['.entity-item .entity-id', '<div class="entity-item"><b class="entity-id">a.b</b></div>'],
      ['.hotkey-item .entity-name', '<div class="hotkey-item"><b class="entity-name">A</b></div>'],
      ['.quick-access-tab-label', '<span class="quick-access-tab-label">Kitchen</span>'],
      ['.todo-item-summary', '<span class="todo-item-summary">Milk</span>'],
      ['.calendar-event-summary', '<span class="calendar-event-summary">Dentist</span>'],
      // The tile's line is a row of pieces, so the event's title and its day and time each carry
      // their own direction; the row itself has no text of its own to read.
      [
        '.calendar-next-event-title',
        '<div class="calendar-next-event"><span class="calendar-next-event-title">Dentist</span></div>',
      ],
      [
        '.calendar-next-event-when',
        '<div class="calendar-next-event"><span class="calendar-next-event-when">Tomorrow 8:22 AM</span></div>',
      ],
      ['.desktop-pin-light-name', '<div class="desktop-pin-light-name">Lamp</div>'],
      ['.desktop-pin-panel-name', '<div class="desktop-pin-panel-name">Weather</div>'],
      ['.desktop-pin-media-title', '<div class="desktop-pin-media-title">Song</div>'],
      ['.desktop-pin-media-artist', '<div class="desktop-pin-media-artist">Band</div>'],
    ];

    it.each(AUTHORED)(
      'takes the direction of its own text in right-to-left (%s)',
      (selector, html) => {
        render(html, { dir: 'rtl', lang: 'ar' });
        expect(resolvedValue(document.querySelector(selector), 'unicode-bidi')).toBe('plaintext');
      }
    );

    it('gives every block of a notification message the direction of its own text', () => {
      // The message is drawn from Markdown as paragraphs, list items, quotes and code, and
      // unicode-bidi is not inherited: a block left to the page's direction moves the "2" of "2
      // issues need attention:" to the far end and the colon to the front.
      render('<div class="persistent-notification-message"></div>', { dir: 'rtl', lang: 'ar' });
      const message = document.querySelector('.persistent-notification-message');
      renderNotificationMarkdown(
        message,
        '**2 issues need attention.** Open [Repairs](/config/repairs) to fix them:\n\n' +
          '- The `backup` integration has no recent backup\n- Update available\n\n' +
          '> Quoted.\n\n```\ncode\n```\n\nSee https://www.home-assistant.io/docs for help.'
      );
      const blocks = message.querySelectorAll('p, li, blockquote, pre');
      expect([...blocks].map((block) => block.tagName)).toEqual([
        'P',
        'LI',
        'LI',
        'BLOCKQUOTE',
        'PRE',
        'P',
      ]);
      for (const block of blocks) {
        expect(resolvedValue(block, 'unicode-bidi')).toBe('plaintext');
      }
    });

    it('leaves a left-to-right page alone', () => {
      render('<span class="command-palette-result-state">21.4 °C</span>');
      expect(
        resolvedValue(document.querySelector('.command-palette-result-state'), 'unicode-bidi')
      ).toBeNull();
    });

    it('starts the names that fill a row at the reading edge, as an Arabic name does', () => {
      // Chromium drops text-align: match-parent, so the edge is written out.
      for (const [selector, html] of [
        [
          '.command-palette-result-name',
          '<span class="command-palette-result-name">Office fan</span>',
        ],
        [
          '.entity-item .entity-name',
          '<div class="entity-item"><b class="entity-name">Alex</b></div>',
        ],
        [
          '.persistent-notification-message',
          '<div class="persistent-notification-message">Door.</div>',
        ],
        ['.media-tile-artist', '<div class="media-tile-artist">M83</div>'],
      ]) {
        render(html, { dir: 'rtl', lang: 'ar' });
        expect(resolvedValue(document.querySelector(selector), 'text-align')).toBe('right');
      }
      expect(stylesheet.replace(/\/\*[\s\S]*?\*\//g, '')).not.toMatch(/match-parent/);
    });

    it('sits the names that are cut after two lines at the reading edge by their width, not their alignment', () => {
      // Chromium draws a line-clamp ellipsis outside the box when right-aligned text ends short, so
      // these names are not aligned: the box is as wide as the text and starts at the edge.
      for (const [selector, html] of [
        ['.desktop-pin-light-name', '<div class="desktop-pin-light-name">Lamp</div>'],
        ['.desktop-pin-panel-name', '<div class="desktop-pin-panel-name">Weather</div>'],
        ['.desktop-pin-media-title', '<div class="desktop-pin-media-title">Song</div>'],
        ['.desktop-pin-media-artist', '<div class="desktop-pin-media-artist">Band</div>'],
      ]) {
        render(html);
        expect(resolvedValue(document.querySelector(selector), 'width')).toBeNull();
        render(html, { dir: 'rtl', lang: 'ar' });
        const name = document.querySelector(selector);
        expect(resolvedValue(name, 'width')).toBe('fit-content');
        expect(resolvedValue(name, 'max-width')).toBe('100%');
        expect(resolvedValue(name, 'text-align')).not.toBe('right');
      }
      render('<div class="hotkey-item"><span class="entity-name">Lamp</span></div>', {
        dir: 'rtl',
        lang: 'ar',
      });
      const hotkeyName = document.querySelector('.entity-name');
      expect(resolvedValue(hotkeyName, 'flex-basis')).toBe('auto');
      expect(resolvedValue(hotkeyName, 'flex-grow')).toBe('0');
      expect(resolvedValue(hotkeyName, 'text-align')).not.toBe('right');
    });

    it('keeps centred names centred', () => {
      render('<div class="media-artist">Artist</div><div class="control-name">Name</div>', {
        dir: 'rtl',
        lang: 'ar',
      });
      expect(resolvedValue(document.querySelector('.media-artist'), 'text-align')).toBe('center');
      expect(resolvedValue(document.querySelector('.control-name'), 'text-align')).not.toBe(
        'right'
      );
    });
  });

  describe('technical fields', () => {
    const FIELDS = [
      '<input id="ha-url">',
      '<input id="custom-color-hex">',
      '<textarea id="desktop-bindings"></textarea>',
      '<textarea class="diagnostics-report"></textarea>',
    ];
    // They show a shortcut or a translated sentence, whichever the field holds.
    const HOTKEY_FIELDS = ['<input id="popup-hotkey-input">', '<input class="hotkey-input">'];

    it.each(FIELDS)('reads left to right in an Arabic page (%s)', (html) => {
      render(html, { dir: 'rtl', lang: 'ar' });
      expect(resolvedValue(document.querySelector('input, textarea'), 'direction')).toBe('ltr');
    });

    it.each(HOTKEY_FIELDS)(
      'reads its own text, not a fixed direction, in an Arabic page (%s)',
      (html) => {
        // The popup field holds "Press keys... (Esc to cancel)" in Arabic while it records, which
        // a forced left-to-right direction would put the dots and the bracket on the wrong side of.
        // A recorded shortcut is left to right by its own letters under plaintext.
        render(html.replace('<input', '<input value="اضغط المفاتيح... (Esc للإلغاء)"'), {
          dir: 'rtl',
          lang: 'ar',
        });
        const field = document.querySelector('input');
        expect(resolvedValue(field, 'unicode-bidi')).toBe('plaintext');
        expect(resolvedValue(field, 'direction')).not.toBe('ltr');
      }
    );

    it('reads the hint of a hotkey field from its text too', () => {
      // A placeholder ignores the field's unicode-bidi in Chromium, so its own rule carries it; the
      // pseudo-element is not in jsdom's reach, so the rule is read from the stylesheet.
      expect(stylesheet).toMatch(
        /\[dir='rtl'\] :is\(#popup-hotkey-input, \.hotkey-input\)::placeholder \{\s*unicode-bidi: plaintext;/
      );
    });

    it('keeps the hotkey fields centred, as they were', () => {
      render('<input class="hotkey-input">', { dir: 'rtl', lang: 'ar' });
      expect(resolvedValue(document.querySelector('input'), 'text-align')).toBe('center');
    });

    it('does not touch the fields of a left-to-right page', () => {
      render([...FIELDS, ...HOTKEY_FIELDS].join(''));
      for (const element of document.querySelectorAll('input, textarea')) {
        expect(resolvedValue(element, 'direction')).toBeNull();
        expect(resolvedValue(element, 'unicode-bidi')).toBeNull();
      }
    });

    it('keeps the token and folder fields right to left while their translated hint shows', () => {
      // Only a field with text in it is left to right: an Arabic hint ending in "..." would put the
      // dots at the wrong end. jsdom cannot tell when a field has text, so the selector that says
      // so is read from the stylesheet, and the empty field is checked here.
      expect(stylesheet).toMatch(
        /:is\(#ha-token, #profile-sync-folder-path\):not\(:placeholder-shown\)/
      );
      render(
        `<input id="ha-token" type="password" placeholder="رمز">
         <input id="profile-sync-folder-path" placeholder="اختر مجلدا...">`,
        { dir: 'rtl', lang: 'ar' }
      );
      for (const field of document.querySelectorAll('input')) {
        expect(resolvedValue(field, 'direction')).toBeNull();
      }
    });
  });

  describe('mirrored drawing', () => {
    it('puts the hero pane hairline on the side of the first card', () => {
      const markup =
        '<div class="status-grid"><div class="status-card"></div><div class="status-card"></div></div>';
      render(markup);
      const second = () => document.querySelectorAll('.status-card')[1];
      expect(resolvedValue(second(), 'box-shadow')).toMatch(/^inset calc\(1px \* 1\) 0 0/);
      render(markup, { dir: 'rtl', lang: 'ar' });
      expect(resolvedValue(second(), 'box-shadow')).toMatch(/^inset calc\(1px \* -1\) 0 0/);
    });

    it('moves the settings rail divider with the reading direction', () => {
      render('<div id="settings-modal"><div class="modal-tabs"></div></div>', {
        dir: 'rtl',
        lang: 'ar',
      });
      const rail = document.querySelector('.modal-tabs');
      expect(resolvedValue(rail, 'border-inline-end')).toMatch(/^1px solid/);
      expect(resolvedValue(rail, 'border-right')).toBeNull();
    });

    it('slides a switch knob towards the end of the track on either side', () => {
      // The knob is a pseudo-element, which the cascade helper cannot read, so read the rules.
      for (const rule of [
        /\.form-group input\[type='checkbox'\]::after \{[^}]*inset-inline-start: 2px/,
        /\.form-group input\[type='checkbox'\]:checked::after \{[^}]*translateX\(calc\(18px \* var\(--inline-sign\)\)\)/,
        /\.rename-modal\) \.form-group input\[type='checkbox'\]::after \{[^}]*inset-inline-start: 3px/,
        /input\[type='checkbox'\]:checked::after \{[^}]*translateX\(calc\(16px \* var\(--inline-sign\)\)\)/,
      ]) {
        expect(stylesheet).toMatch(rule);
      }
      render('<div class="form-group"><input type="checkbox"></div>');
      expect(resolvedValue(document.querySelector('input'), '--inline-sign')).toBe('1');
      render('<div class="form-group"><input type="checkbox"></div>', { dir: 'rtl', lang: 'ar' });
      expect(resolvedValue(document.querySelector('input'), '--inline-sign')).toBe('-1');
    });

    it('does not flip a whole checkbox, so a native one in a pick list is not mirrored', () => {
      render(
        `<div class="form-group room-dashboard"><div class="room-entity-list">
           <label><input type="checkbox"></label></div></div>`,
        { dir: 'rtl', lang: 'ar' }
      );
      const checkbox = document.querySelector('.room-entity-list input');
      expect(resolvedValue(checkbox, 'transform')).toBeNull();
      expect(stylesheet).not.toMatch(/\[dir='rtl'\] \.form-group input\[type='checkbox'\]/);
    });

    it('fills every slider track towards the end its thumb moves to', () => {
      const classes = [
        'brightness-slider',
        'light-color-temp-slider',
        'fan-slider',
        'cover-slider',
        'climate-slider',
        'media-volume-slider',
      ];
      const markup = classes.map((name) => `<input type="range" class="${name}">`).join('');
      render(markup);
      for (const slider of document.querySelectorAll('input')) {
        expect(resolvedValue(slider, 'background')).toMatch(/^linear-gradient\(\s*to right,/);
      }
      render(markup, { dir: 'rtl', lang: 'ar' });
      for (const slider of document.querySelectorAll('input')) {
        expect(resolvedValue(slider, 'background')).toMatch(/^linear-gradient\(\s*to left,/);
      }
    });

    it('brightens a growing bar at the end it grows towards', () => {
      const markup = `<div class="progress-fill"></div>
        <div class="desktop-pin-timer-progress-fill"></div>`;
      render(markup);
      for (const bar of document.querySelectorAll('div')) {
        expect(resolvedValue(bar, 'background')).toMatch(/^linear-gradient\(\s*to right,/);
      }
      render(markup, { dir: 'rtl', lang: 'ar' });
      for (const bar of document.querySelectorAll('div')) {
        expect(resolvedValue(bar, 'background')).toMatch(/^linear-gradient\(\s*to left,/);
      }
    });

    it('anchors the pin light fill to the side the mirrored slider starts on', () => {
      expect(stylesheet).toMatch(
        /\.desktop-pin-light-brightness-fill \{[^}]*inset-inline-start: 0;/
      );
      render('<div class="desktop-pin-light-brightness-fill"></div>', { dir: 'rtl', lang: 'ar' });
      expect(
        resolvedValue(document.querySelector('.desktop-pin-light-brightness-fill'), 'background')
      ).toMatch(/^linear-gradient\(\s*270deg,/);
    });

    it('sweeps the connection bar from a left-to-right track in every language', () => {
      render(
        '<div class="connection-progress"><span class="connection-progress-bar"></span></div>',
        {
          dir: 'rtl',
          lang: 'ar',
        }
      );
      expect(resolvedValue(document.querySelector('.connection-progress'), 'direction')).toBe(
        'ltr'
      );
    });

    it('turns the undo arrows and the closed disclosure chevrons the way the page reads', () => {
      const markup = `<button id="undo-dashboard-btn"><svg></svg></button>
        <span class="dashboard-restore-arrow"><svg></svg></span>
        <div id="settings-modal"><div class="settings-disclosure-section collapsed">
          <button class="section-toggle"><svg class="section-toggle-icon"></svg></button></div></div>`;
      render(markup);
      const flipped = () => ({
        undo: resolvedValue(document.querySelector('#undo-dashboard-btn svg'), 'transform'),
        restore: resolvedValue(document.querySelector('.dashboard-restore-arrow svg'), 'transform'),
        chevron: resolvedValue(document.querySelector('.section-toggle-icon'), 'transform'),
      });
      expect(flipped()).toEqual({ undo: null, restore: null, chevron: 'none' });
      render(markup, { dir: 'rtl', lang: 'ar' });
      expect(flipped()).toEqual({
        undo: 'scaleX(-1)',
        restore: 'scaleX(-1)',
        chevron: 'scaleX(-1)',
      });
      // An open section points down in either direction.
      document.querySelector('.settings-disclosure-section').classList.remove('collapsed');
      expect(flipped().chevron).toBe('rotate(90deg)');
      // The <details> chevron is a pseudo-element: it turns by 135 degrees while closed.
      expect(stylesheet).toMatch(
        /\[dir='rtl'\] #settings-modal \.settings-disclosure:not\(\[open\]\) > summary::after \{\s*transform: rotate\(135deg\)/
      );
      expect(stylesheet).not.toMatch(/\.settings-details:not\(\[open\]\) > summary::before \{/);
    });
  });

  describe('scripts that tracking and capitals do not suit', () => {
    const LABELS = `<div class="settings-group-caption">Window</div>
      <div class="status-card time-card"><div class="date-display">Sunday</div></div>
      <nav class="quick-access-tabs"><a class="tab-link">Kitchen</a></nav>
      <div class="desktop-pin-light-status">On</div>
      <div class="status-card time-card"><div id="current-time" class="time-display">5 pm</div></div>`;

    it('keeps tracked upper-case labels in Latin-script languages', () => {
      for (const lang of ['en', 'de', 'es', 'fr']) {
        render(LABELS, { lang });
        const caption = document.querySelector('.settings-group-caption');
        expect(resolvedValue(caption, 'letter-spacing')).not.toBe('normal');
        expect(resolvedValue(caption, 'text-transform')).toBe('uppercase');
        expect(resolvedValue(document.querySelector('.date-display'), 'letter-spacing')).toBe(
          '0.08em'
        );
      }
    });

    it.each(['ar', 'hi', 'zh', 'ja', 'ar-EG', 'hi-IN'])(
      'sets labels untracked and as written in %s',
      (lang) => {
        render(LABELS, { lang, dir: lang.startsWith('ar') ? 'rtl' : 'ltr' });
        for (const selector of [
          '.settings-group-caption',
          '.date-display',
          '.tab-link',
          '.desktop-pin-light-status',
          '.time-display',
        ]) {
          const element = document.querySelector(selector);
          expect({ selector, value: resolvedValue(element, 'letter-spacing') }).toEqual({
            selector,
            value: 'normal',
          });
          expect(resolvedValue(element, 'text-transform')).toBe('none');
        }
      }
    );

    it('also covers the pseudo-elements, which carry some of the tracked labels', () => {
      expect(stylesheet).toMatch(
        /:is\(:lang\(ar\), :lang\(fa\), :lang\(ur\), :lang\(hi\), :lang\(mr\), :lang\(ne\), :lang\(zh\), :lang\(ja\)\)\s+\*::before,[\s\S]*?\*::after \{\s*letter-spacing: normal !important;\s*text-transform: none !important;/
      );
    });

    it('does not use a :lang() list, which Chromium does not read', () => {
      // `:lang(ar, hi)` drops the whole rule in Chromium (checked in 150, Electron 43, where
      // CSS.supports('selector(:lang(ar, hi))') is false); each language needs its own :lang().
      expect(stylesheet).not.toMatch(/:lang\([^)]*,/);
    });

    it('gives tight lines of text that is clipped to its box room in these scripts', () => {
      const lines = (lang) => {
        render(
          '<div class="control-name">n</div><div class="control-state">s</div><div class="entity-name">e</div>',
          { lang, dir: lang === 'ar' ? 'rtl' : 'ltr' }
        );
        return [...document.querySelectorAll('div')].map((element) =>
          resolvedValue(element, 'line-height')
        );
      };
      expect(lines('en')).toEqual(['1.2', '1.2', '1.2']);
      expect(lines('ar')).toEqual(['1.4', '1.4', '1.4']);
      expect(lines('hi')).toEqual(['1.4', '1.4', '1.4']);
      expect(lines('zh')).toEqual(['1.4', '1.4', '1.4']);
    });
  });

  describe('lines that clip descenders', () => {
    const em = (value) => parseFloat(value);

    it('gives the clock a clipping box with room for an AM/PM marker, at the same layout height', () => {
      render('<div class="status-card time-card"><div class="time-display">5 pm</div></div>');
      const clock = document.querySelector('.time-display');
      const padding = resolvedValue(clock, 'padding');
      expect(padding).toBe('0.2em 4px');
      expect(em(resolvedValue(clock, 'margin-block'))).toBe(-em(padding));
      expect(resolvedValue(clock, 'overflow')).toBe('hidden');
    });

    it('lets a grouped number keep the tail of its comma', () => {
      render(
        `<div id="quick-controls"><div class="control-item sensor-numeric-entity">
           <span class="control-sensor-value">1,234</span></div></div>`
      );
      const value = document.querySelector('.control-sensor-value');
      expect(em(resolvedValue(value, 'padding-block'))).toBeGreaterThan(0);
      expect(em(resolvedValue(value, 'margin-block'))).toBe(
        -em(resolvedValue(value, 'padding-block'))
      );
    });
  });

  describe('Edit colors for cards', () => {
    it('starts the copy at the same edge and line of both cards, and draws no glow around the active one', () => {
      render(
        `<div class="color-target-option active"><span class="color-target-copy">
           <span class="color-target-name">Accent</span><span class="color-target-note">n</span>
         </span></div>`
      );
      const card = document.querySelector('.color-target-option');
      expect(resolvedValue(card, 'align-items')).toBe('flex-start');
      expect(resolvedValue(card, 'text-align')).toBe('start');
      expect(resolvedValue(document.querySelector('.color-target-copy'), 'align-items')).toBe(
        'flex-start'
      );
      expect(resolvedValue(document.querySelector('.color-target-note'), 'text-wrap')).toBe(
        'balance'
      );
      expect(resolvedValue(card, 'box-shadow')).not.toMatch(/28px/);
    });
  });
});

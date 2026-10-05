const fs = require('fs');
const path = require('path');
const {
  cascadedDeclaration,
  contrastRatio,
  loadAppStylesheets,
  resolvedValue,
} = require('../helpers/css-cascade.js');

const read = (file) => fs.readFileSync(path.resolve(__dirname, '../..', file), 'utf8');

function render(bodyClass, html) {
  document.body.className = bodyClass;
  document.body.innerHTML = html;
}

describe('the control recipe', () => {
  beforeAll(() => {
    loadAppStylesheets(document);
  });

  afterEach(() => {
    document.body.className = '';
    document.body.innerHTML = '';
  });

  // Cancel, Close and Reset sit beside the action a dialog is for, so they are drawn quieter than
  // the accent secondary recipe. The rule used to find them by an id containing "cancel" or
  // "close", which left every Cancel built without one (the alarm code's, the hotkey recorder's)
  // in accent blue beside the primary button.
  describe('neutral buttons', () => {
    const colours = (button) => ({
      color: resolvedValue(button, 'color'),
      background: resolvedValue(button, 'background'),
    });

    it('draws a neutral button in the quiet recipe, with or without an id', () => {
      render(
        '',
        `<button class="btn btn-secondary btn-neutral">Cancel</button>
         <button id="cover-cancel" class="btn btn-secondary btn-neutral">Close</button>
         <button class="btn btn-secondary">Retry</button>`
      );
      const [plain, named, accent] = document.querySelectorAll('button');

      expect(colours(plain)).toEqual(colours(named));
      expect(cascadedDeclaration(plain, 'background').value).toBe('transparent');
      expect(cascadedDeclaration(plain, 'color').value).toBe('var(--text-secondary)');
      expect(cascadedDeclaration(accent, 'color').value).toBe('var(--accent-text)');
    });

    it('goes by the class, not by what the id happens to contain', () => {
      render('', '<button id="close-cancel-thing" class="btn btn-secondary">Retry</button>');

      expect(cascadedDeclaration(document.querySelector('button'), 'color').value).toBe(
        'var(--accent-text)'
      );
      expect(read('styles.css')).not.toMatch(/\[id\*=/);
    });

    // The connection panel's own neutral is solid: the dialogs' transparent one reads as disabled
    // on its red error tint. The Cancel shown while browser authorization waits is marked neutral
    // and must look like the panel's other second actions, not like a dialog's.
    it.each(['background', 'color', 'border-color'])(
      'keeps a neutral button in the connection panel in the panel’s %s',
      (property) => {
        render(
          '',
          `<div class="widget-state-panel widget-state-error"><div class="widget-state-actions">
            <button class="btn btn-secondary btn-neutral">Cancel</button>
            <button class="btn btn-secondary">Open Settings</button>
          </div></div>`
        );
        const [cancel, settings] = document.querySelectorAll('button');

        expect(cascadedDeclaration(cancel, property).value).toBe(
          cascadedDeclaration(settings, property).value
        );
        cancel.dataset.hover = '';
        settings.dataset.hover = '';
        expect(cascadedDeclaration(cancel, property).value).toBe(
          cascadedDeclaration(settings, property).value
        );
      }
    );

    it("marks every Cancel and Close in the window's markup as neutral", () => {
      document.body.innerHTML = read('index.html').replace(
        /^[\s\S]*?<body[^>]*>|<\/body>[\s\S]*$/g,
        ''
      );
      const ways = [...document.querySelectorAll('button.btn-secondary')].filter((button) =>
        /^(Cancel|Close)\b/.test(button.dataset.i18n || '')
      );

      expect(ways.length).toBeGreaterThanOrEqual(7);
      ways.forEach((button) => expect(button.classList.contains('btn-neutral')).toBe(true));
    });
  });

  describe('fonts', () => {
    // Buttons and fields otherwise draw in the browser's control font (Arial on Linux).
    it.each(['button', 'input', 'select', 'textarea'])(
      'makes a bare %s inherit the page font',
      (tag) => {
        render('', `<${tag}></${tag}>`);

        expect(cascadedDeclaration(document.querySelector(tag), 'font-family').value).toBe(
          'inherit'
        );
      }
    );

    it('lets a component name its own face over the inherited one', () => {
      render('', '<input class="hotkey-input" readonly><div class="modal-body"></div>');

      expect(resolvedValue(document.querySelector('.hotkey-input'), 'font-family')).toMatch(
        /ui-monospace|monospace/
      );
    });
  });

  describe('buttons', () => {
    const button = (classes, wrapper = '') =>
      `${wrapper}<button class="${classes}"></button>${wrapper ? '</div>' : ''}`;

    it('makes .btn-sm smaller than .btn, wherever the two are declared', () => {
      render('', button('btn') + button('btn btn-sm'));
      const [regular, compact] = document.querySelectorAll('button');

      expect(resolvedValue(regular, 'min-height')).toBe('34px');
      expect(resolvedValue(compact, 'min-height')).toBe('28px');
      expect(resolvedValue(compact, 'font-size')).toBe('0.75rem');
    });

    it('has one name for the compact button', () => {
      for (const file of ['index.html', 'styles.css', 'src/settings.js', 'src/ui.js']) {
        expect({ file, uses: /btn-small/.test(read(file)) }).toEqual({ file, uses: false });
      }
    });

    it('tints a destructive button red, and keeps the confirmation dialog solid', () => {
      render(
        '',
        `${button('btn btn-danger')}
        <div class="confirm-modal-content">${button('btn btn-danger')}</div>`
      );
      const [plain, confirm] = document.querySelectorAll('button');

      expect(resolvedValue(plain, 'background')).toBe('rgba(239, 83, 80, 0.14)');
      expect(resolvedValue(confirm, 'background')).toBe('rgba(211, 47, 47, 0.95)');
      expect(resolvedValue(confirm, 'color')).toBe('white');
    });

    it('takes the error text token, which reads on the light panel', () => {
      render('theme-light', button('btn btn-danger'));

      const color = resolvedValue(document.querySelector('button'), 'color');
      expect(color).toBe(resolvedValue(document.body, '--error-text'));
      expect(contrastRatio(color, '#e3e3e3')).toBeGreaterThanOrEqual(4.5);
    });

    it('sizes the confirmation buttons like the dialogs', () => {
      render(
        '',
        `<div class="confirm-modal-content"><div class="modal-body"></div>
        <div class="modal-footer">${button('btn btn-primary')}</div></div>`
      );
      const confirmButton = document.querySelector('button');

      expect(resolvedValue(confirmButton, 'min-height')).toBe('34px');
      expect(resolvedValue(confirmButton, 'padding')).not.toMatch(/24px|1\.5rem/);
      expect(resolvedValue(document.querySelector('.modal-body'), 'padding')).toBe('1rem');
    });
  });

  describe('disabled controls', () => {
    const switchRow = (attributes) =>
      `<div id="settings-modal"><div class="form-group setting-row">
        <div class="setting-text"><label for="s">Always on top</label><p class="form-help">Help</p></div>
        <input type="checkbox" id="s" ${attributes}></div></div>`;

    it('lets a switch that explains itself in a title show it, and ignores the rest', () => {
      render(
        '',
        `<input type="checkbox" disabled title="Desktop layer mode keeps the widget behind normal windows.">
        <input type="checkbox" disabled>
        <input type="checkbox" disabled title="">
        <button disabled title="Play"></button>
        <div role="button" aria-disabled="true" title="Why"></div>`
      );
      const [titled, bare, emptyTitle, button, custom] = document.body.children;

      expect(resolvedValue(titled, 'pointer-events')).toBe('auto');
      expect(resolvedValue(titled, 'cursor')).toBe('not-allowed');
      expect(resolvedValue(bare, 'pointer-events')).toBe('none');
      // An empty title is how settings.js clears the text once the control is usable again.
      expect(resolvedValue(emptyTitle, 'pointer-events')).toBe('none');
      // A button's title is its plain name: hovering a disabled one would light it up like a live one.
      expect(resolvedValue(button, 'pointer-events')).toBe('none');
      expect(resolvedValue(custom, 'pointer-events')).toBe('none');
    });

    it('draws a disabled switch the same under the pointer as at rest', () => {
      render('', switchRow('disabled title="Why" data-hover'));
      const hovered = document.querySelector('input');
      const hoveredLook = ['background', 'border-color', 'cursor'].map((property) =>
        resolvedValue(hovered, property)
      );
      hovered.removeAttribute('data-hover');

      expect(
        ['background', 'border-color', 'cursor'].map((property) => resolvedValue(hovered, property))
      ).toEqual(hoveredLook);
      expect(hoveredLook[2]).toBe('not-allowed');
    });

    it('dims the help under a disabled switch with the rest of its row', () => {
      render('', switchRow('disabled'));
      const help = document.querySelector('.form-help');
      expect(resolvedValue(help, 'opacity')).toBe('0.6');

      document.querySelector('input').removeAttribute('disabled');
      expect(resolvedValue(help, 'opacity')).not.toBe('0.6');
    });
  });

  describe('fields', () => {
    it('styles an input in a dialog that has no form group', () => {
      render('', '<div class="modal-body"><input class="form-control" type="number"></div>');
      const input = document.querySelector('input');

      expect(resolvedValue(input, 'border')).toBe(
        '1px solid var(--control-border)'.replace(
          /var\(--control-border\)/,
          resolvedValue(input, '--control-border')
        )
      );
      expect(resolvedValue(input, 'border-radius')).toBe('0.5rem');
      expect(resolvedValue(input, 'min-height')).toBe('36px');
    });

    it('leaves an input outside a dialog alone', () => {
      render('', '<input type="text">');

      expect(resolvedValue(document.querySelector('input'), 'border')).toBeNull();
    });

    // The Hotkeys page lists its rows beside the search field's form group, not inside one: a
    // .form-group field would take the shared padding and height over a plain class.
    it.each([
      ['a dialog body', '<div class="modal-body">%</div>'],
      [
        'the Hotkeys page',
        `<div id="settings-modal"><div class="modal-body"><div id="hotkeys-list-container">
          <div class="form-group"><input type="text"></div>
          <div id="hotkeys-list"><div class="hotkey-item"><div class="hotkey-input-container">%</div></div></div>
        </div></div></div>`,
      ],
    ])('lets a field with its own class keep its own look in %s', (_, wrapper) => {
      render('', wrapper.replace('%', '<input class="hotkey-input" readonly>'));
      const field = document.querySelector('.hotkey-input');

      expect(resolvedValue(field, 'padding')).toBe('6px 10px');
      expect(resolvedValue(field, 'min-height')).toBe('32px');
    });

    it('draws a native select like the text field beside it, with the thin chevron', () => {
      render(
        '',
        `<div class="modal-body"><div class="form-group"><select></select>
        <input type="text"></div></div>`
      );
      const select = document.querySelector('select');
      const field = document.querySelector('input');

      expect(resolvedValue(select, 'appearance')).toBe('none');
      expect(resolvedValue(select, 'background-image')).toMatch(/^url\("data:image\/svg\+xml/);
      expect(resolvedValue(select, 'min-height')).toBe(resolvedValue(field, 'min-height'));
      expect(resolvedValue(select, 'background')).toBe(resolvedValue(field, 'background'));
    });

    it('sizes the hotkey action select for its row and keeps the chevron clear of the text', () => {
      render(
        '',
        `<div id="settings-modal"><div class="hotkey-input-container">
          <input class="hotkey-input" readonly>
          <select class="hotkey-action-select"></select>
        </div></div>`
      );
      const select = document.querySelector('select');
      const field = document.querySelector('input');

      expect(resolvedValue(select, 'width')).toBe('120px');
      expect(resolvedValue(select, 'min-height')).toBe(resolvedValue(field, 'min-height'));
      expect(resolvedValue(select, 'background-size')).toBe('12px 12px');
      expect(resolvedValue(select, 'background-position')).toBe('right 8px center');
      // Same fill and edge as every other select: the row only sets its size.
      expect(resolvedValue(select, 'background-image')).toMatch(/^url\("data:image\/svg\+xml/);
    });

    it('leaves a select native under the readable preset, which repaints fields itself', () => {
      render('high-contrast opaque-panels', '<div class="modal-body"><select></select></div>');

      expect(resolvedValue(document.querySelector('select'), 'appearance')).toBeNull();
    });

    it('mirrors the chevron in right-to-left', () => {
      render('', '<div class="modal-body"><select></select></div>');
      const select = document.querySelector('select');

      expect(resolvedValue(select, 'background-position')).toBe('right 12px center');
      document.documentElement.setAttribute('dir', 'rtl');
      expect(resolvedValue(select, 'background-position')).toBe('left 12px center');
      document.documentElement.removeAttribute('dir');
    });

    it('keeps the chevron clear of a compact select in a Settings row', () => {
      render(
        '',
        `<div id="settings-modal"><div class="setting-row form-group"><select></select></div></div>`
      );
      const select = document.querySelector('select');

      expect(resolvedValue(select, 'padding-inline-end')).toBe('36px');
      expect(resolvedValue(select, 'padding-block')).toBe('7px');
      expect(resolvedValue(select, 'padding-inline-start')).toBe('10px');
    });

    it('gives the first-run wizard the same fields as the dialogs', () => {
      render('', '<div class="first-run-content"><input type="text"></div>');
      const input = document.querySelector('input');

      expect(resolvedValue(input, 'background')).toBe(resolvedValue(document.body, '--tile-bg'));
      expect(resolvedValue(input, '--surface')).toBeNull();
    });
  });

  describe('switches', () => {
    it.each([
      ['Settings', 'settings-modal'],
      ['the alert dialog', 'alert-config-modal'],
    ])('draws the same switch in %s', (_, id) => {
      render(
        '',
        `<div id="${id}"><div class="form-group"><label><input type="checkbox"></label></div></div>`
      );
      const toggle = document.querySelector('input');

      expect(resolvedValue(toggle, 'width')).toBe('38px');
      expect(resolvedValue(toggle, 'height')).toBe('22px');
    });

    it('keeps a gap behind a switch that leads its text, and none behind one that trails it', () => {
      render(
        '',
        `<div class="modal rename-modal"><div class="form-group"><label><input type="checkbox"><span>Tray</span></label></div></div>
        <div id="alert-config-modal"><div class="form-group"><label><span>Quiet hours</span><input type="checkbox"></label></div></div>`
      );
      const [leading, trailing] = document.querySelectorAll('input');

      expect(resolvedValue(leading, 'margin-inline-end')).toBe('10px');
      expect(resolvedValue(trailing, 'margin-inline-end')).toBe('0');
    });

    it('draws it in Tile Settings, and leaves the Add Page room list alone', () => {
      render(
        '',
        `<div class="modal rename-modal"><div class="form-group"><label><input type="checkbox"></label></div></div>
        <div class="add-page-modal"><div class="form-group"><label><input type="checkbox"></label></div></div>`
      );
      const [tileSettings, rooms] = document.querySelectorAll('input');

      expect(resolvedValue(tileSettings, 'height')).toBe('22px');
      expect(resolvedValue(rooms, 'height')).not.toBe('22px');
    });
  });

  describe('sliders', () => {
    const SLIDERS = [
      'brightness-slider',
      'light-color-temp-slider',
      'fan-slider',
      'cover-slider',
      'climate-slider',
      'media-volume-slider',
    ];

    it.each(SLIDERS)('gives .%s the slim track', (name) => {
      render('', `<input type="range" class="${name}">`);

      expect(resolvedValue(document.querySelector('input'), 'height')).toBe('6px');
    });

    it.each(['fan-slider', 'cover-slider', 'climate-slider'])(
      'keeps the track of .%s the same while it is hovered',
      (name) => {
        render('', `<input type="range" class="${name}">`);
        const slider = document.querySelector('input');
        const resting = resolvedValue(slider, 'background');

        slider.setAttribute('data-hover', '');

        expect(resolvedValue(slider, 'background')).toBe(resting);
      }
    );

    it('keeps the thumb white while it is hovered', () => {
      // The thumb is a pseudo-element, so read its rules from the stylesheet text.
      const css = read('styles.css');
      for (const name of ['climate', 'fan', 'cover']) {
        const hover = css.match(
          new RegExp(`\\.${name}-slider::-webkit-slider-thumb:hover \\{[^}]*\\}`, 'g')
        );
        expect((hover || []).filter((rule) => /background:/.test(rule))).toEqual([]);
      }
      expect(css).toMatch(/\.media-volume-slider::-webkit-slider-thumb \{/);
    });

    it('fills a track the other way round in right-to-left', () => {
      render('', '<input type="range" class="media-volume-slider">');
      const slider = document.querySelector('input');
      const direction = (rtl) => {
        document.documentElement.dir = rtl ? 'rtl' : 'ltr';
        if (rtl) document.documentElement.setAttribute('dir', 'rtl');
        return resolvedValue(slider, 'background');
      };

      expect(direction(false)).toMatch(/^linear-gradient\(to right,/);
      expect(direction(true)).toMatch(/^linear-gradient\(to left,/);
      document.documentElement.removeAttribute('dir');
    });
  });

  describe('chips', () => {
    it('sizes the fan presets like the brightness presets', () => {
      render(
        '',
        '<button class="brightness-preset-btn"></button><button class="fan-preset-btn"></button>'
      );
      const [brightness, fan] = document.querySelectorAll('button');

      for (const property of ['height', 'flex', 'min-width', 'font-size', 'font-weight']) {
        expect(resolvedValue(fan, property)).toBe(resolvedValue(brightness, property));
      }
    });
  });

  describe('markup', () => {
    const html = read('index.html');

    it('gives every button in the page a type', () => {
      const untyped = (html.match(/<button\b[^>]*>/g) || []).filter(
        (tag) => !/\btype\s*=/.test(tag)
      );

      expect(untyped).toEqual([]);
    });

    it('hides the weather canvas from assistive technology', () => {
      expect(html).toMatch(/<canvas id="weather-effects-canvas" aria-hidden="true">/);
    });

    it.each([
      'settings-search',
      'ha-url',
      'custom-color-hex',
      'hotkey-entity-search',
      'quick-controls-search',
      'alert-entity-picker-search',
      'target-state-input',
    ])('turns spell checking off in #%s', (id) => {
      const tag = html.match(new RegExp(`<input\\b[^>]*\\bid="${id}"[^>]*>`));

      expect(tag[0]).toMatch(/spellcheck="false"/);
    });

    it('names the search fields and lists the placeholder alone left unnamed', () => {
      for (const id of [
        'hotkey-entity-search',
        'quick-controls-search',
        'alert-entity-picker-search',
      ]) {
        const tag = html.match(new RegExp(`<input\\b[^>]*\\bid="${id}"[^>]*>`))[0];
        expect(tag).toMatch(/aria-label="Search entities"/);
        expect(tag).toMatch(/data-i18n-aria-label="Search entities"/);
      }
      for (const id of ['primary-cards-list', 'custom-entity-icons-list']) {
        expect(html).toMatch(new RegExp(`id="${id}"[^>]*aria-labelledby="${id}-label"`));
        expect(html).toMatch(new RegExp(`id="${id}-label"`));
      }
    });

    it('names the weather readouts, the theme colours and the Reset button', () => {
      expect(html).toMatch(/class="weather-detail"\s+role="group"\s+aria-label="Humidity"/);
      expect(html).toMatch(/class="weather-detail"\s+role="group"\s+aria-label="Wind"/);
      // A title would repeat the name and cover the card's own long-press hint while hovering.
      expect(html).not.toMatch(/class="weather-detail"[^>]*\btitle=/);
      expect(html).toMatch(/id="theme-options"[^>]*aria-labelledby="theme-options-label"/s);
      expect(html).not.toMatch(/aria-label="Theme colors"/);
      expect(html).toMatch(/id="primary-cards-reset"\s+aria-describedby="primary-cards-title"/);
    });

    it('lets the visible label name each colour channel', () => {
      for (const channel of ['Red', 'Green', 'Blue']) {
        expect(html).not.toMatch(new RegExp(`aria-label="${channel} channel"`));
      }
    });

    it('groups the primary card buttons under their card name', () => {
      expect(html).toMatch(
        /data-primary-card="0"\s+role="group"\s+aria-labelledby="primary-card-1-label"/
      );
      expect(html).toMatch(
        /data-primary-card="1"\s+role="group"\s+aria-labelledby="primary-card-2-label"/
      );
    });
  });
});

const fs = require('fs');
const path = require('path');
const {
  cascadedDeclaration,
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

    it('steps the destructive text down to read on the light panel', () => {
      render('theme-light', button('btn btn-danger'));

      expect(resolvedValue(document.querySelector('button'), 'color')).toBe('#c62828');
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
    it('lets one that explains itself in a title show it, and ignores the rest', () => {
      render(
        '',
        `<button disabled title="Desktop layer mode keeps the widget behind normal windows."></button>
        <button disabled></button>
        <button disabled title=""></button>
        <input type="checkbox" disabled title="Why">
        <div role="button" aria-disabled="true" title="Why"></div>`
      );
      const [titled, bare, emptyTitle, checkbox, custom] = document.body.children;

      expect(resolvedValue(titled, 'pointer-events')).toBe('auto');
      expect(resolvedValue(checkbox, 'pointer-events')).toBe('auto');
      expect(resolvedValue(bare, 'pointer-events')).toBe('none');
      // An empty title is how settings.js clears the text once the control is usable again.
      expect(resolvedValue(emptyTitle, 'pointer-events')).toBe('none');
      expect(resolvedValue(custom, 'pointer-events')).toBe('none');
      expect(resolvedValue(titled, 'cursor')).toBe('not-allowed');
    });
  });

  describe('fields', () => {
    it('styles an input in a dialog that has no form group', () => {
      render('', '<div class="modal-body"><input class="form-control" type="number"></div>');
      const input = document.querySelector('input');

      expect(resolvedValue(input, 'border')).toBe(
        '1px solid var(--border-color)'.replace(
          /var\(--border-color\)/,
          resolvedValue(input, '--border-color')
        )
      );
      expect(resolvedValue(input, 'border-radius')).toBe('0.5rem');
      expect(resolvedValue(input, 'min-height')).toBe('36px');
    });

    it('leaves an input outside a dialog alone', () => {
      render('', '<input type="text">');

      expect(resolvedValue(document.querySelector('input'), 'border')).toBeNull();
    });

    it('lets a field with its own class keep its own look', () => {
      render('', '<div class="modal-body"><input class="hotkey-input" readonly></div>');

      expect(resolvedValue(document.querySelector('input'), 'padding')).toBe('6px 10px');
      expect(resolvedValue(document.querySelector('input'), 'min-height')).toBe('32px');
    });

    it('draws a native select like the custom dropdown trigger', () => {
      render(
        '',
        `<div class="modal-body"><div class="form-group"><select></select></div>
        <button class="custom-dropdown-trigger"></button></div>`
      );
      const select = document.querySelector('select');
      const trigger = document.querySelector('.custom-dropdown-trigger');

      expect(resolvedValue(select, 'appearance')).toBe('none');
      expect(resolvedValue(select, 'background-image')).toMatch(/^url\("data:image\/svg\+xml/);
      expect(resolvedValue(select, 'min-height')).toBe(resolvedValue(trigger, 'min-height'));
      expect(resolvedValue(select, 'background')).toBe(resolvedValue(trigger, 'background'));
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

    it('hides the weather canvas and the dropdown arrow from assistive technology', () => {
      expect(html).toMatch(/<canvas id="weather-effects-canvas" aria-hidden="true">/);
      expect(read('src/hotkeys.js')).toMatch(/class="custom-dropdown-arrow" aria-hidden="true"/);
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

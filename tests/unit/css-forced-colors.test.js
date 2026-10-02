const fs = require('fs');
const path = require('path');
const { loadAppStylesheets, resolvedValue } = require('../helpers/css-cascade.js');

const FORCED = { forcedColors: true };
const STYLES = fs.readFileSync(path.resolve(__dirname, '../../styles.css'), 'utf8');

function render(bodyClass, html) {
  document.body.className = bodyClass;
  document.body.innerHTML = html;
}

/** The text between the braces of every `@media (forced-colors: active)` block in the stylesheet. */
function forcedColorsCss() {
  const blocks = [];
  const opener = '@media (forced-colors: active) {';
  let from = STYLES.indexOf(opener);
  while (from !== -1) {
    let depth = 1;
    let index = from + opener.length;
    while (depth > 0) {
      if (STYLES[index] === '{') depth += 1;
      if (STYLES[index] === '}') depth -= 1;
      index += 1;
    }
    blocks.push(STYLES.slice(from + opener.length, index - 1));
    from = STYLES.indexOf(opener, index);
  }
  return blocks.join('\n');
}

/** The declarations of the forced-colours rules whose selector text contains `selector`. */
function forcedRule(selector) {
  const css = forcedColorsCss()
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\s+/g, ' ');
  const matches = [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].filter(([, selectors]) =>
    selectors.includes(selector)
  );
  expect({ selector, found: matches.length > 0 }).toEqual({ selector, found: true });
  return matches.map(([, , declarations]) => declarations).join(' ');
}

describe('forced colours (Windows High Contrast and other contrast themes)', () => {
  beforeAll(() => {
    loadAppStylesheets(document);
  });

  afterEach(() => {
    document.body.className = '';
    document.body.innerHTML = '';
  });

  describe('selected and active states', () => {
    // Each of these shows its state with an accent fill, which forced colours replace with Canvas.
    const SELECTED = {
      'HVAC mode': '<button class="climate-mode-btn active">Heat</button>',
      'fan mode': '<button class="climate-fan-mode-btn active">Low</button>',
      'preset mode': '<button class="climate-preset-mode-btn active">Eco</button>',
      'mute toggle': '<button class="media-mute-toggle active">Muted</button>',
      'donate amount': '<button class="donate-amount-chip selected">$5</button>',
      'dropdown option': '<div class="custom-dropdown-option selected">Option</div>',
      'segmented option': '<button class="segmented-option active">Dark</button>',
      'Settings rail tab': '<button class="tab-link active">Appearance</button>',
      'running timer': '<div class="control-item timer-entity" data-state="active"></div>',
      'pin power button': '<button class="desktop-pin-light-power" data-active="true"></button>',
      'pin panel button': '<button class="desktop-pin-panel-button" data-active="true"></button>',
      'lit tile':
        '<div id="quick-controls"><div class="control-item" data-active="true"></div></div>',
    };

    it.each(Object.entries(SELECTED))('outlines the selected %s in Highlight', (_, html) => {
      render('', html);
      const element = document.body.querySelector(
        'button, div.custom-dropdown-option, .control-item'
      );
      expect(resolvedValue(element, 'outline', FORCED)).toBe('2px solid Highlight');
      expect(resolvedValue(element, 'outline-offset', FORCED)).toBe('-2px');
      expect(resolvedValue(element, 'outline')).not.toBe('2px solid Highlight');
    });

    it('draws a paused timer with a dashed outline so it differs from a running one', () => {
      render('', '<div class="control-item timer-entity" data-state="paused"></div>');
      const timer = document.querySelector('.timer-entity');
      expect(resolvedValue(timer, 'outline', FORCED)).toBe('2px dashed Highlight');
    });

    it('lets each tab ring itself instead of ringing the sliding pill as well', () => {
      render(
        '',
        `<div class="quick-access-tabs has-sliding-indicator">
          <span class="sliding-indicator"></span>
          <div class="quick-access-tab active"><button class="tab-link active">Home</button></div>
        </div>`
      );
      expect(resolvedValue(document.querySelector('.sliding-indicator'), 'display', FORCED)).toBe(
        'none'
      );
      // The wrapper's 4px corners did not match the button's, which left notches in the ring.
      expect(resolvedValue(document.querySelector('.quick-access-tab'), 'outline', FORCED)).toBe(
        null
      );
      expect(resolvedValue(document.querySelector('.tab-link'), 'outline', FORCED)).toBe(
        '2px solid Highlight'
      );
    });

    it('rings the whole chip of the active page while the tabs are being edited', () => {
      render(
        '',
        `<div class="quick-access-tabs reorganize">
          <div class="quick-access-tab active"><button class="tab-link active">Home</button></div>
        </div>`
      );
      expect(resolvedValue(document.querySelector('.quick-access-tab'), 'outline', FORCED)).toBe(
        '2px solid Highlight'
      );
    });
  });

  describe('range sliders', () => {
    const SLIDERS = [
      'brightness-slider',
      'fan-slider',
      'cover-slider',
      'climate-slider',
      'light-color-temp-slider',
      'media-volume-slider',
    ];

    it.each(SLIDERS)('draws the %s track in ButtonText instead of a gradient', (name) => {
      render('', `<input type="range" class="${name}">`);
      expect(resolvedValue(document.querySelector('input'), 'background', FORCED)).toBe(
        'ButtonText'
      );
      expect(resolvedValue(document.querySelector('input'), 'background')).toMatch(/gradient/);
    });

    it('draws every thumb as a Highlight disc with an edge', () => {
      const rule = forcedRule('::-webkit-slider-thumb');
      const css = forcedColorsCss();
      for (const name of SLIDERS) {
        expect(css).toMatch(new RegExp(`\\.${name}[^{}]*\\)::-webkit-slider-thumb`));
      }
      expect(rule).toContain('background: Highlight');
      expect(rule).toContain('border: 2px solid ButtonText');
      expect(forcedRule('.desktop-pin-light-slider::-webkit-slider-thumb')).toContain(
        'background: Highlight'
      );
      expect(forcedRule('.desktop-pin-light-slider::-webkit-slider-runnable-track')).toContain(
        'border: 1px solid ButtonText'
      );
    });

    it('keeps the track system-coloured when the Readable preset is on as well', () => {
      render('high-contrast', '<input type="range" class="brightness-slider">');
      expect(resolvedValue(document.querySelector('input'), 'background', FORCED)).toBe(
        'ButtonText'
      );
    });
  });

  describe('colour swatches', () => {
    it.each(['light-color-swatch', 'color-target-swatch', 'accent-theme-swatch'])(
      'keeps the colour of a %s and gives it an edge',
      (name) => {
        render('', `<span class="${name}"></span>`);
        const swatch = document.querySelector('span');
        expect(resolvedValue(swatch, 'forced-color-adjust', FORCED)).toBe('none');
        expect(resolvedValue(swatch, 'border', FORCED)).toBe('1px solid CanvasText');
      }
    );

    it('outlines the picked accent and the focused light colour', () => {
      render(
        '',
        `<button class="theme-option selected"></button>
        <button class="color-target-option active"></button>
        <button class="light-color-swatch" data-focus-visible></button>`
      );
      for (const element of document.querySelectorAll('button')) {
        expect(resolvedValue(element, 'outline', FORCED)).toBe('3px solid Highlight');
      }
    });
  });

  describe('fills that are the only mark of a state', () => {
    it('draws the connection dot as a ring when disconnected and solid when connected', () => {
      render(
        '',
        `<div id="off" class="connection-indicator"></div>
        <div id="on" class="connection-indicator connected"></div>`
      );
      const off = document.getElementById('off');
      const on = document.getElementById('on');
      expect(resolvedValue(off, 'border', FORCED)).toBe('2px solid ButtonText');
      expect(resolvedValue(off, 'background', FORCED)).not.toBe('Highlight');
      expect(resolvedValue(on, 'background', FORCED)).toBe('Highlight');
    });

    it.each([
      'media-tile-seek-fill',
      'media-progress-fill',
      'progress-fill',
      'connection-progress-bar',
      'desktop-pin-panel-progress-fill',
      'desktop-pin-timer-progress-fill',
      'desktop-pin-light-brightness-fill',
    ])('fills %s with Highlight', (name) => {
      render('', `<div class="${name}"></div>`);
      expect(resolvedValue(document.querySelector('div'), 'background', FORCED)).toBe('Highlight');
    });

    it('gives the seek bar an outline to fill', () => {
      render('', '<div class="media-tile-seek-bar"></div>');
      const bar = document.querySelector('.media-tile-seek-bar');
      expect(resolvedValue(bar, 'border', FORCED)).toBe('1px solid ButtonText');
      expect(resolvedValue(bar, 'height', FORCED)).toBe('6px');
    });

    it('turns the hero pane divider, an inset shadow, into a border', () => {
      render(
        '',
        `<div class="status-grid">
          <div class="status-card"></div><div class="status-card" id="second"></div>
        </div>`
      );
      const second = document.getElementById('second');
      expect(resolvedValue(second, 'box-shadow')).toMatch(/inset/);
      expect(resolvedValue(second, 'box-shadow', FORCED)).toBe('none');
      expect(resolvedValue(second, 'border-inline-start', FORCED)).toBe('1px solid CanvasText');
    });

    it('draws the weather glyph as an outline in the text colour', () => {
      const rule = forcedRule('.weather-glyph *');
      expect(rule).toContain('stroke: CanvasText');
      expect(rule).toContain('fill: none');
      expect(forcedRule('.weather-glyph .weather-glyph-fill')).toContain('fill: CanvasText');
    });

    it('makes the window one solid Canvas pane', () => {
      render('', '');
      expect(resolvedValue(document.documentElement, 'background', FORCED)).toBe('Canvas');
      expect(resolvedValue(document.documentElement, 'background')).toBe('transparent');
    });

    it('leaves a desktop pin window see-through at its corners', () => {
      render('desktop-pin-mode', '<div class="desktop-pin-shell"></div>');
      expect(resolvedValue(document.documentElement, 'background', FORCED)).toBe('transparent');
    });
  });

    // Only the body carries desktop-pin-mode (renderer.js sets it there), so the rule has to look
    // down from <html>; a pin is a transparent window around a rounded shell.
  describe('buttons and fields', () => {
    it('tells the primary action from the others by its edge', () => {
      render(
        '',
        `<button class="btn btn-primary" id="save">Save</button>
        <button class="btn btn-secondary" id="cancel">Cancel</button>`
      );
      expect(resolvedValue(document.getElementById('save'), 'border', FORCED)).toBe(
        '2px solid Highlight'
      );
      expect(resolvedValue(document.getElementById('cancel'), 'border', FORCED)).not.toBe(
        '2px solid Highlight'
      );
    });

    it.each([
      [
        'a settings text field',
        '<div id="settings-modal"><input type="text" data-focus-visible></div>',
      ],
      ['a settings select', '<div id="settings-modal"><select data-focus-visible></select></div>'],
      [
        'a form field',
        '<div class="form-group"><input type="text" data-focus data-focus-visible></div>',
      ],
      [
        'the custom colour hex field',
        '<input id="custom-color-hex" type="text" data-focus data-focus-visible>',
      ],
      ['a hotkey field', '<input class="hotkey-input" type="text" data-focus data-focus-visible>'],
      ['an alert field', '<input class="alert-input" type="text" data-focus data-focus-visible>'],
      [
        'a dropdown trigger',
        '<button class="custom-dropdown-trigger" data-focus data-focus-visible></button>',
      ],
    ])('keeps a focus outline on %s', (_, html) => {
      render('', html);
      const element = document.querySelector('input, select, button');
      expect(resolvedValue(element, 'outline', FORCED)).toBe('2px solid Highlight');
    });

    it('does not dim disabled controls twice', () => {
      render(
        '',
        `<button disabled>Undo</button>
        <button aria-disabled="true">Next</button>
        <div class="segmented-control is-disabled"></div>`
      );
      for (const element of document.querySelectorAll('button, .segmented-control')) {
        expect(resolvedValue(element, 'opacity')).not.toBe('1');
        expect(resolvedValue(element, 'opacity', FORCED)).toBe('1');
      }
    });

    it('gives the scrollbar thumb a system colour and a Canvas gap', () => {
      const rule = forcedRule('::-webkit-scrollbar-thumb');
      expect(rule).toContain('background: ButtonText');
      expect(rule).toContain('border: 3px solid Canvas');
    });
  });

  it('recolours the active Settings rail icon, which keeps a colour written on the icon itself', () => {
    const rule = forcedRule('#settings-modal .tab-link.active .tab-link-icon');
    expect(rule).toContain('color: ButtonText');
    expect(rule).toContain('filter: none');
  });
});

const fs = require('fs');
const path = require('path');
const {
  cascadedDeclaration,
  compareSpecificity,
  loadAppStylesheets,
  resolvedValue,
} = require('../helpers/css-cascade.js');

const FORCED = { forcedColors: true };
const STYLES = fs.readFileSync(path.resolve(__dirname, '../../styles.css'), 'utf8');

// The Readable preset as the app turns it on: its own class and the opaque panels it comes with.
const READABLE = 'high-contrast opaque-panels';

function render(bodyClass, html) {
  document.body.className = bodyClass;
  document.body.innerHTML = html;
}

// jsdom does not expand `border: 2px solid Highlight` into the colour it sets, and the cascade
// helper reads each property on its own, so the colour of a border or an outline is whichever of
// the longhand and the shorthand would win in the browser.
const SHORTHAND_OF = { 'border-color': 'border', 'outline-color': 'outline' };
const NOT_A_COLOUR =
  /^(?:thin|medium|thick|[\d.]+[a-z]*|none|hidden|dotted|dashed|solid|double|groove|ridge|inset|outset)$/i;

function outranks(candidate, winner) {
  if (candidate.important !== winner.important) return candidate.important;
  const bySpecificity = compareSpecificity(candidate.specificity, winner.specificity);
  return bySpecificity === 0 ? candidate.order >= winner.order : bySpecificity > 0;
}

function resolvedColour(element, property, options) {
  const shorthand = SHORTHAND_OF[property];
  if (!shorthand) return resolvedValue(element, property, options);
  const longhand = cascadedDeclaration(element, property, options);
  const whole = cascadedDeclaration(element, shorthand, options);
  if (!whole || (longhand && outranks(longhand, whole))) return longhand?.value ?? null;
  return whole.value.split(/\s+/).find((token) => !NOT_A_COLOUR.test(token)) ?? 'currentcolor';
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
      'segmented option': '<button class="segmented-option active">Dark</button>',
      'Settings rail tab': '<button class="tab-link active">Appearance</button>',
      'running timer': '<div class="control-item timer-entity" data-state="active"></div>',
      'light pin power button':
        '<button class="desktop-pin-power desktop-pin-light-power" data-active="true"></button>',
      'fan pin power button':
        '<button class="desktop-pin-power desktop-pin-fan-power" data-active="true"></button>',
      'pin panel button': '<button class="desktop-pin-panel-button" data-active="true"></button>',
      'lit tile':
        '<div id="quick-controls"><div class="control-item" data-active="true"></div></div>',
    };

    it.each(Object.entries(SELECTED))('outlines the selected %s in Highlight', (_, html) => {
      render('', html);
      const element = document.body.querySelector('button, .control-item');
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
      // The link inside it would draw a second box around the page name, by outline and by its
      // transparent border, which forced colours redraw in ButtonText.
      const link = document.querySelector('.tab-link');
      expect(resolvedValue(link, 'outline', FORCED)).toBe('none');
      expect(resolvedValue(link, 'border-color', FORCED)).toBe('Canvas');
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

    // The light theme's stronger tracks and edges are for the colour themes; forced colours draw
    // the ButtonText bar, and a light rule that outranked it left a thumb floating on nothing.
    it.each(SLIDERS.filter((name) => name !== 'light-color-temp-slider'))(
      'draws the %s track in ButtonText in the light theme too',
      (name) => {
        render('theme-light', `<input type="range" class="${name}">`);
        const slider = document.querySelector('input');
        expect(resolvedValue(slider, 'background', FORCED)).toBe('ButtonText');
        expect(resolvedValue(slider, 'background')).toMatch(/gradient/);
      }
    );

    it.each(['', 'theme-light'])(
      'draws the Window opacity range as a ButtonText bar with a Highlight thumb (%s)',
      (bodyClass) => {
        render(
          bodyClass,
          `<div id="settings-modal"><div class="setting-slider"><input type="range" id="opacity-slider"></div></div>`
        );
        const slider = document.querySelector('input');
        expect(resolvedValue(slider, 'background', FORCED)).toBe('ButtonText');
        // The colour themes draw the same rail as the dialog sliders.
        expect(resolvedValue(slider, 'background')).toMatch(/gradient/);
        expect(
          forcedRule("#settings-modal .setting-slider input[type='range']::-webkit-slider-thumb")
        ).toContain('background: Highlight');
      }
    );

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

    it('draws the other pins sliders as a Highlight fill in an edged track', () => {
      render('', '<input type="range" class="desktop-pin-panel-slider">');
      const track = forcedRule('.desktop-pin-panel-slider::-webkit-slider-runnable-track');
      expect(track).toContain('Highlight var(--range-progress, 0%)');
      expect(track).toContain('border: 1px solid ButtonText');
      expect(forcedRule('.desktop-pin-panel-slider::-webkit-slider-thumb')).toContain(
        'background: Highlight'
      );
      // Forced colours drop a background image from a slider unless it opts out, which left
      // these tracks without their fill.
      expect(resolvedValue(document.querySelector('input'), 'forced-color-adjust', FORCED)).toBe(
        'none'
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

    // Only the body carries desktop-pin-mode (renderer.js sets it there), so the rule has to look
    // down from <html>; a pin is a transparent window around a rounded shell.
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

  describe('buttons and fields', () => {
    it('tells the primary action from the others by its edge', () => {
      render(
        '',
        `<button class="btn btn-primary" id="save">Save</button>
        <button class="btn btn-secondary btn-neutral" id="cancel">Cancel</button>`
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
        'a hotkey action select',
        '<div id="settings-modal"><select class="hotkey-action-select" data-focus-visible></select></div>',
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

  // Forced colours throw away the Readable preset's palette, yet a rule they discard still outranks
  // a lower one that names a system colour. Each case is a property the forced-colours rules set to
  // a system colour; turning the preset on must not change it.
  describe('with the Readable preset on as well', () => {
    const PRIMARY = '<button class="btn btn-primary">Save</button>';
    const EDIT_MODE_TAB = `<div class="quick-access-tabs reorganize">
      <div class="quick-access-tab active"><button class="tab-link active">Home</button></div>
    </div>`;
    const CASES = [
      ['primary action', PRIMARY, 'button', 'border-color', 'Highlight'],
      [
        'primary action that is aria-disabled',
        '<button class="btn btn-primary" aria-disabled="true">Card 1</button>',
        'button',
        'border-color',
        'Highlight',
      ],
      [
        'button that is only aria-disabled',
        '<button class="btn btn-secondary" aria-disabled="true">Next</button>',
        'button',
        'color',
        'GrayText',
      ],
      ['active page link in edit mode', EDIT_MODE_TAB, '.tab-link', 'border-color', 'Canvas'],
      [
        'active page in edit mode',
        EDIT_MODE_TAB,
        '.quick-access-tab',
        'outline-color',
        'Highlight',
      ],
      [
        'selected segmented option',
        '<div class="segmented-control"><button class="segmented-option active">Dark</button></div>',
        'button',
        'outline-color',
        'Highlight',
      ],
      [
        'selected HVAC mode',
        '<button class="climate-mode-btn active">Heat</button>',
        'button',
        'outline-color',
        'Highlight',
      ],
      [
        'selected donate amount',
        '<button class="donate-amount-chip selected">$5</button>',
        'button',
        'outline-color',
        'Highlight',
      ],
      // Chromium draws the preset's white ring as Highlight on a field anyway; the rule should not
      // depend on that.
      [
        'focused text field',
        '<div class="form-group"><input type="text" data-focus-visible></div>',
        'input',
        'outline-color',
        'Highlight',
      ],
      // These opt out of forced colours, so a colour written in the stylesheet is drawn as it is:
      // a white ring would vanish on a light contrast theme.
      [
        'focused switch',
        '<div class="form-group"><input type="checkbox" data-focus-visible></div>',
        'input',
        'outline-color',
        'Highlight',
      ],
      [
        'focused light colour swatch',
        '<button class="light-color-swatch" data-focus-visible></button>',
        'button',
        'outline-color',
        'Highlight',
      ],
      [
        'range slider track',
        '<input type="range" class="brightness-slider">',
        'input',
        'background',
        'ButtonText',
      ],
    ];

    it.each(CASES)(
      'keeps the %s as the forced-colours rules draw it',
      (_, html, target, property, expected) => {
        render('', html);
        const element = document.querySelector(target);
        expect(resolvedColour(element, property, FORCED)).toBe(expected);
        document.body.className = READABLE;
        expect(resolvedColour(element, property, FORCED)).toBe(expected);
      }
    );

    it('tells the primary action from the others by a Highlight edge', () => {
      render(
        READABLE,
        `${PRIMARY}<button class="btn btn-secondary btn-neutral" id="cancel">Cancel</button>`
      );
      const [primary, secondary] = document.querySelectorAll('button');
      expect(resolvedColour(primary, 'border-color', FORCED)).toBe('Highlight');
      expect(resolvedColour(secondary, 'border-color', FORCED)).not.toBe('Highlight');
    });

    it('leaves the Readable palette alone when forced colours are off', () => {
      render(READABLE, `${PRIMARY}<button class="btn btn-secondary">Cancel</button>`);
      const [primary, secondary] = document.querySelectorAll('button');
      expect(resolvedValue(primary, 'background')).toBe('#8ed1ff');
      expect(resolvedColour(primary, 'border-color')).toBe('#fff');
      expect(resolvedValue(secondary, 'background')).toBe('#202020');
      expect(resolvedValue(secondary, 'border-color')).toBe('#aaa');
    });
  });

  it('recolours the active Settings rail icon, which keeps a colour written on the icon itself', () => {
    const rule = forcedRule('#settings-modal .tab-link.active .tab-link-icon');
    expect(rule).toContain('color: ButtonText');
    expect(rule).toContain('filter: none');
  });
});

const {
  contrastRatio,
  loadAppStylesheets,
  parseColor,
  resolvedValue,
  splitTopLevel,
} = require('../helpers/css-cascade.js');

// Each case is a body class list; the readable preset forces its dark palette in either theme.
const THEMES = {
  dark: '',
  light: 'theme-light',
  'frosted dark': 'frosted-glass',
  'frosted light': 'theme-light frosted-glass',
  'readable dark': 'high-contrast opaque-panels',
  'readable light': 'theme-light high-contrast opaque-panels',
};
const THEME_CASES = Object.entries(THEMES);

function render(bodyClass, html) {
  document.body.className = bodyClass;
  document.body.innerHTML = html;
}

function isOpaque(color) {
  return parseColor(color)?.[3] === 1;
}

describe('stylesheet cascade regressions', () => {
  beforeAll(() => {
    loadAppStylesheets(document);
  });

  afterEach(() => {
    document.body.className = '';
    document.body.innerHTML = '';
  });

  describe('tile keyboard focus ring', () => {
    // The tile clips its overflow, so a ring drawn outside the full-tile button is invisible.
    it.each(THEME_CASES)(
      'draws the ring inside Quick Access and primary cards (%s)',
      (_, theme) => {
        render(
          theme,
          `<div id="quick-controls">
          <div class="control-item" role="group">
            <button class="tile-primary-button" tabindex="0" data-focus-visible></button>
          </div>
        </div>
        <div class="status-card primary-entity-card">
          <div class="control-item" data-primary-card="true">
            <button class="tile-primary-button" tabindex="0" data-focus-visible></button>
          </div>
        </div>`
        );

        for (const button of document.querySelectorAll('.tile-primary-button')) {
          expect(resolvedValue(button, 'outline-offset')).toBe('-3px');
          expect(resolvedValue(button, 'outline')).toMatch(/^\d+px solid /);
        }
      }
    );
  });

  describe('Quick Access page tab strip', () => {
    const strip = (barClass = '', otherPage = '') => `
      <div class="section-header quick-access-header">
        <div id="quick-access-tabs" class="quick-access-tabs ${barClass}">
          <div class="quick-access-tab-scroll">
            <div class="quick-access-tab active">
              <button class="tab-link quick-access-tab-link active" tabindex="0" data-focus-visible>
                <span class="quick-access-tab-label">Home</span>
              </button>
              <button class="qa-tab-btn qa-tab-rename" data-focus-visible></button>
              <button class="qa-tab-btn qa-tab-delete"></button>
            </div>${otherPage}
          </div>
        </div>
        <button class="qa-tab-add" data-focus-visible><span>Add page</span></button>
        <div class="section-buttons"></div>
      </div>`;

    // The pages scroll inside the bar; the bar is the pill, so it keeps its shape.
    it('scrolls the pages in the strip, without a scrollbar, and not the bar itself', () => {
      render('', strip());
      const scroller = document.querySelector('.quick-access-tab-scroll');
      const bar = document.getElementById('quick-access-tabs');

      expect(resolvedValue(scroller, 'overflow-x')).toBe('auto');
      expect(resolvedValue(scroller, 'scrollbar-width')).toBe('none');
      expect(resolvedValue(bar, 'overflow-x')).toBeNull();
      expect(resolvedValue(bar, 'overflow-y')).toBeNull();
    });

    it('does not squeeze a page to make room, since the strip scrolls', () => {
      render('', strip());
      expect(resolvedValue(document.querySelector('.quick-access-tab'), 'flex')).toBe('0 0 auto');
    });

    // The strip clips whatever is outside a page, and the global focus rule would put it there.
    it.each(THEME_CASES)(
      'draws the focus ring inside the pages and their buttons (%s)',
      (_, theme) => {
        render(theme, strip());

        for (const control of document.querySelectorAll(
          '.quick-access-tab-scroll [data-focus-visible]'
        )) {
          expect(resolvedValue(control, 'outline-offset')).toBe('-2px');
          // The readable preset draws a thicker ring of its own, in the same place.
          expect(resolvedValue(control, 'outline')).toMatch(/^[23]px solid /);
          expect(resolvedValue(control, 'box-shadow')).toBe('none');
        }
      }
    );

    it('fades the edge that clips pages', () => {
      render('', strip());
      const scroller = document.querySelector('.quick-access-tab-scroll');
      expect(resolvedValue(scroller, 'mask-image')).toBeNull();
      scroller.dataset.overflow = 'right';
      expect(resolvedValue(scroller, 'mask-image')).toMatch(/linear-gradient\(to right/);
      scroller.dataset.overflow = 'both';
      expect(resolvedValue(scroller, 'mask-image')).toMatch(/transparent/);
    });

    it('lets the rename field stand alone, without the page buttons or highlight behind it', () => {
      render('reorganize', strip('reorganize'));
      const page = document.querySelector('.quick-access-tab');
      const button = page.querySelector('.qa-tab-rename');
      expect(resolvedValue(button, 'display')).not.toBe('none');
      expect(resolvedValue(page, 'box-shadow')).not.toBe('none');

      page.insertAdjacentHTML('afterbegin', '<input class="qa-tab-rename-input" type="text">');
      expect(resolvedValue(button, 'display')).toBe('none');
      expect(resolvedValue(page, 'box-shadow')).toBe('none');
      expect(resolvedValue(page, 'background')).toBe('none');
    });

    it('is as tall editing as it is as the pill, so the grid does not move', () => {
      render('reorganize', strip('reorganize'));
      expect(resolvedValue(document.getElementById('quick-access-tabs'), 'min-height')).toBe(
        '32px'
      );
      expect(resolvedValue(document.querySelector('.quick-access-tab'), 'min-height')).toBe('28px');
      expect(resolvedValue(document.querySelector('.qa-tab-add'), 'min-height')).toBe('28px');
    });

    it('lines up with the cards and tiles, and keeps Add page in the header beside the strip', () => {
      render('reorganize', strip('reorganize'));
      const header = document.querySelector('.quick-access-header');
      expect(resolvedValue(header, 'padding-inline')).toBe('0');
      expect(resolvedValue(document.getElementById('quick-access-tabs'), 'flex')).toBe('0 1 auto');
      expect(resolvedValue(document.querySelector('.qa-tab-add'), 'flex')).toBe('0 0 auto');
    });

    it('gives the page buttons targets of at least 24px, and the delete button some room', () => {
      render('reorganize', strip('reorganize'));
      const rename = document.querySelector('.qa-tab-rename');
      expect(resolvedValue(rename, 'width')).toBe('24px');
      expect(resolvedValue(rename, 'height')).toBe('24px');
      expect(resolvedValue(document.querySelector('.qa-tab-delete'), 'margin-inline-start')).toBe(
        '0.25rem'
      );
    });

    it('cuts a long page name short rather than letting it fill the strip', () => {
      render('', strip());
      const link = document.querySelector('.quick-access-tab-link');
      const label = document.querySelector('.quick-access-tab-label');
      expect(resolvedValue(link, 'max-width')).toBe('34ch');
      expect(resolvedValue(label, 'text-overflow')).toBe('ellipsis');
      expect(resolvedValue(label, 'overflow')).toBe('hidden');
      render('reorganize', strip('reorganize'));
      expect(resolvedValue(document.querySelector('.quick-access-tab-link'), 'max-width')).toBe(
        '28ch'
      );
    });

    it('keeps a page and its buttons inside the strip, clear of the fades', () => {
      const other = `<div class="quick-access-tab"><button class="tab-link"></button></div>`;
      render('reorganize', strip('reorganize', other));
      const tab = document.querySelector('.quick-access-tab');
      // A page wider than the strip would have its last button under the fade or out of reach, so
      // the name gives way: the page is capped, its link may shrink, its buttons may not.
      expect(resolvedValue(tab, 'max-width')).toMatch(/^calc\(100% - 2 \* \d+px\)$/);
      const link = document.querySelector('.quick-access-tab-link');
      expect(resolvedValue(link, 'min-width')).toBe('0');
      expect(resolvedValue(link, 'flex-shrink')).toBe('1');
      expect(resolvedValue(document.querySelector('.qa-tab-rename'), 'flex')).toBe('none');
    });

    // The strip is as wide as its pages, so a lone page that gave up the width of the fades would
    // be trimmed for nothing: its name would shrink to nothing in the default one-page dashboard.
    it('lets a lone page use the whole strip, since there is nothing to scroll to', () => {
      render('reorganize', strip('reorganize'));
      expect(resolvedValue(document.querySelector('.quick-access-tab'), 'max-width')).toBe('100%');
    });

    it('gives up the words of Add page in a narrow window, and keeps them otherwise', () => {
      render('reorganize', strip('reorganize'));
      const label = document.querySelector('.qa-tab-add span');
      expect(resolvedValue(label, 'display')).toBeNull();
      expect(resolvedValue(label, 'display', { viewport: { width: 360, height: 600 } })).toBe(
        'none'
      );
    });
  });

  describe('edit mode on the Quick Access grid', () => {
    const tiles = () => `
      <div id="quick-controls" class="controls-grid reorganize-mode">
        <div class="control-item" data-entity-id="light.a"></div>
        <div class="control-item comparison-graph-tile" data-entity-id="graph:g"></div>
      </div>`;

    it('does not pack the grid densely, which would part the picture from the saved order', () => {
      render('', tiles());
      expect(resolvedValue(document.getElementById('quick-controls'), 'grid-auto-flow')).toBeNull();
    });

    it('makes room for the buttons above the content of a compact tile', () => {
      render('density-compact', tiles());
      const tile = document.querySelector('[data-entity-id="light.a"]');
      const grid = document.getElementById('quick-controls');
      expect(resolvedValue(grid, '--qa-tile-height')).toBe('96px');
      expect(resolvedValue(tile, 'padding-top')).toBe('32px');

      render('density-compact', tiles().replace(' reorganize-mode', ''));
      expect(resolvedValue(document.getElementById('quick-controls'), '--qa-tile-height')).toBe(
        '78px'
      );
    });

    it('hides the corner labels the buttons would cover', () => {
      render(
        '',
        `<div class="reorganize-mode"><div class="control-item">
          <span class="camera-tile-preview-badge"></span><span class="comparison-graph-range"></span>
        </div></div>`
      );
      for (const label of document.querySelectorAll('.control-item span')) {
        expect(resolvedValue(label, 'visibility')).toBe('hidden');
      }
    });

    it('shrinks the buttons to fit the 82px tiles of a narrow window', () => {
      const markup = `<div class="reorganize-mode"><div class="control-item">
        <button class="rename-btn"></button><button class="remove-btn"></button>
        <button class="desktop-pin-quick-toggle"></button>
      </div></div>`;
      render('', markup);
      const rename = document.querySelector('.rename-btn');
      expect(resolvedValue(rename, 'width')).toBe('24px');
      const narrow = { viewport: { width: 340, height: 600 } };
      for (const button of document.querySelectorAll('.control-item button')) {
        expect(resolvedValue(button, 'width', narrow)).toBe('20px');
      }
      // Centre to centre they stay 24px apart: 6px in, 20px wide, then 30px from the far edge.
      expect(resolvedValue(rename, 'inset-inline-end', narrow)).toBe('30px');
      expect(resolvedValue(document.querySelector('.remove-btn'), 'inset-inline-end', narrow)).toBe(
        '6px'
      );
    });

    it('lets a touch or pen drag follow the pointer, and tilts the native drag image', () => {
      render(
        '',
        `<div class="reorganize-mode">
          <div class="control-item sortable-drag sortable-fallback"></div>
          <div class="control-item sortable-drag"></div>
        </div>`
      );
      const [clone, native] = document.querySelectorAll('.control-item');
      // The settle that eases tiles into place would make the clone trail behind the pointer.
      expect(resolvedValue(clone, 'transition')).toBe('none');
      // The clone is positioned with an inline transform, which a transform rule would replace.
      expect(resolvedValue(clone, 'transform')).toBeNull();
      // The individual properties apply outside that transform, so a lift or tilt on the clone
      // would scale and turn the finger's offset: the clone would drift away from the finger.
      expect(resolvedValue(clone, 'scale')).toBe('none');
      expect(resolvedValue(clone, 'rotate')).toBe('none');
      expect(resolvedValue(native, 'scale')).toBe('1.05');
      expect(resolvedValue(native, 'rotate')).toBe('2deg');
    });
  });

  describe('keyboard focus rings the global rule drew wrongly', () => {
    // The global ring sits 2px outside the control with a glow. Wherever the control is clipped by a
    // scrolling or overflow-hidden parent, or another rule removes the outline, that left a focused
    // control looking like an unfocused one (or like a rendering glitch).
    it('draws the weather card ring inside the card, where the hero pane cannot clip it', () => {
      render(
        '',
        `<div class="status-grid"><div id="weather-card" class="status-card weather-card" tabindex="0" data-focus-visible></div><div id="time-card" class="status-card"></div></div>`
      );
      const card = document.getElementById('weather-card');

      expect(resolvedValue(card, 'outline-offset')).toBe('-4px');
      expect(resolvedValue(card, 'outline')).toMatch(/^[23]px solid /);
      expect(resolvedValue(card, 'box-shadow')).toBe('none');
    });

    it('keeps the divider between the two cards when the second one has the ring', () => {
      render(
        '',
        `<div class="status-grid"><div class="status-card"></div><div id="time-card" class="status-card" tabindex="0" data-focus-visible></div></div>`
      );

      expect(resolvedValue(document.getElementById('time-card'), 'box-shadow')).toMatch(
        /^inset calc\(1px \* 1\) 0 0 /
      );
    });

    it('still draws it outside in the single-card layout, where nothing clips it', () => {
      render(
        '',
        `<div class="status-grid single-card"><div id="weather-card" class="status-card" tabindex="0" data-focus-visible></div></div>`
      );

      expect(resolvedValue(document.getElementById('weather-card'), 'outline-offset')).toBe('2px');
    });

    it('draws a picker option inside the scrolling list, on the hover tint', () => {
      render(
        '',
        `<div class="entity-selector-list"><div id="option" class="entity-item" role="option" tabindex="0" data-focus-visible></div></div>`
      );
      const option = document.getElementById('option');

      expect(resolvedValue(option, 'outline-offset')).toBe('-2px');
      expect(resolvedValue(option, 'box-shadow')).toBe('none');
      // The hover fill, rather than the plain row's transparent one.
      expect(resolvedValue(option, 'background')).toBe('rgba(255, 255, 255, 0.075)');
    });

    it('draws the Settings window opacity slider ring, which the field rules had removed', () => {
      render(
        '',
        `<div id="settings-modal"><div class="form-group setting-slider"><input id="opacity-slider" type="range" data-focus-visible></div></div>`
      );
      const slider = document.getElementById('opacity-slider');

      expect(resolvedValue(slider, 'outline')).toMatch(/^2px solid /);
      expect(resolvedValue(slider, 'outline-offset')).toBe('4px');
    });

    it('rounds the ring of a Settings disclosure summary and keeps it inside the pane', () => {
      render(
        '',
        `<div id="settings-modal"><details class="settings-details settings-disclosure"><summary data-focus-visible>More</summary></details></div>`
      );
      const summary = document.querySelector('summary');

      expect(resolvedValue(summary, 'border-radius')).not.toBe('0');
      expect(resolvedValue(summary, 'outline-offset')).toBe('-2px');
    });

    it('lets Tab scroll a Settings control clear of the floating Save and Cancel pill', () => {
      render('', '<div id="settings-modal"><div class="modal-body"></div></div>');

      expect(resolvedValue(document.querySelector('.modal-body'), 'scroll-padding-block-end')).toBe(
        '80px'
      );
    });

    it('does not draw the global field ring around the command palette search, whose row has it', () => {
      render(
        '',
        `<div class="command-palette-search"><input class="command-palette-input" data-focus-visible></div>`
      );
      const input = document.querySelector('input');

      expect(resolvedValue(input, 'outline')).toBe('0');
      expect(resolvedValue(input, 'box-shadow')).toBe('none');
    });

    it('tints a palette row under a resting pointer more lightly than the highlighted one', () => {
      render(
        '',
        `<div class="command-palette-result" id="hover" data-hover></div>
        <div class="command-palette-result highlighted" id="highlighted"></div>`
      );
      const hover = resolvedValue(document.getElementById('hover'), 'background');
      const highlighted = resolvedValue(document.getElementById('highlighted'), 'background');

      expect(hover).toContain('0.07');
      expect(highlighted).toContain('0.14');
      // The strong tint's accent border is not applied to a hover.
      expect(resolvedValue(document.getElementById('hover'), 'border-color')).not.toBe(
        resolvedValue(document.getElementById('highlighted'), 'border-color')
      );
    });
  });

  describe('collapsed Settings disclosures', () => {
    it('are hidden to focus once collapsed, and visible while open', () => {
      render(
        '',
        `<div id="settings-modal"><section class="personalization-section settings-disclosure-section collapsed"><div id="closed" class="section-body"></div></section>
        <section class="personalization-section settings-disclosure-section"><div id="open" class="section-body"></div></section></div>`
      );

      expect(resolvedValue(document.getElementById('closed'), 'visibility')).toBe('hidden');
      expect(resolvedValue(document.getElementById('open'), 'visibility')).toBeNull();
    });

    it('leave room beside an open body for the focus glow of a full-width field', () => {
      render(
        '',
        `<div id="settings-modal"><section class="personalization-section settings-disclosure-section"><div id="open" class="section-body"></div></section></div>`
      );
      const body = document.getElementById('open');

      expect(resolvedValue(body, 'padding-inline')).toBe('4px');
      expect(resolvedValue(body, 'margin-inline')).toBe('-4px');
      expect(resolvedValue(body, 'will-change')).toBeNull();
    });
  });

  describe('the first-run wizard', () => {
    it('starts below the header, so the window buttons and drag area keep working', () => {
      render('first-run-active', '<div class="first-run-onboarding"></div>');
      const overlay = document.querySelector('.first-run-onboarding');

      // 40px until the renderer measures the header and says otherwise.
      expect(resolvedValue(overlay, 'inset')).toBe('40px 0 0');
    });

    it('hides the gear while it is up, since Settings would open out of sight underneath', () => {
      render('first-run-active', '<button id="settings-btn"></button>');

      expect(resolvedValue(document.getElementById('settings-btn'), 'visibility')).toBe('hidden');
    });
  });

  describe('a dialog heading that takes focus on open', () => {
    // It is where a screen reader starts, not a control: the default ring would box its glyphs.
    it('draws no ring, while a control in the same header still does', () => {
      render(
        '',
        `<div class="modal"><div class="modal-header">
          <h2 id="heading" tabindex="-1" data-focus-visible>Living room</h2>
          <button id="close" class="close-btn" data-focus-visible>x</button>
        </div></div>`
      );

      expect(resolvedValue(document.getElementById('heading'), 'outline')).toBe('none');
      expect(resolvedValue(document.getElementById('close'), 'outline')).not.toBe('none');
    });
  });

  describe('a dialog rebuilt in place', () => {
    it('does not replay the entrance, but still leaves with the exit animation', () => {
      render(
        '',
        `<div id="rebuilt" class="modal climate-modal modal-rebuilt"><div class="modal-content"></div></div>
        <div id="leaving" class="modal modal-rebuilt modal-closing"><div class="modal-content"></div></div>`
      );

      expect(resolvedValue(document.getElementById('rebuilt'), 'animation')).toBe('none');
      expect(resolvedValue(document.getElementById('leaving'), 'animation')).toContain(
        'modalFadeOut'
      );
    });
  });

  describe('toasts', () => {
    // Anchored at left: 50% the stack could only grow into the right half of the window, so at the
    // default size every toast wrapped at half its width.
    it('spans the window and centres its toasts, instead of shrinking to half of it', () => {
      render('', '<div class="toast-container"><div class="toast info"></div></div>');
      const stack = document.querySelector('.toast-container');

      expect(resolvedValue(stack, 'left')).toBe('0');
      expect(resolvedValue(stack, 'right')).toBe('0');
      expect(resolvedValue(stack, 'padding-inline')).toBe('0.75rem');
      expect(resolvedValue(stack, 'transform')).toBeNull();
      expect(resolvedValue(stack, 'align-items')).toBe('center');
      expect(resolvedValue(document.querySelector('.toast'), 'max-width')).toBe('min(420px, 100%)');
    });

    it('puts the icon against the first line of a toast that wraps', () => {
      render('', '<div class="toast-container"><div class="toast error"></div></div>');

      expect(resolvedValue(document.querySelector('.toast'), 'align-items')).toBe('flex-start');
    });

    it.each(['rose', 'amber', 'emerald'])(
      'draws an information toast in its own blue, whatever the %s accent',
      (accent) => {
        render(
          `accent-${accent}`,
          '<div class="toast info"><span class="toast-icon"></span></div>'
        );
        document.body.style.setProperty('--accent-rgb', '244, 63, 94');

        const toast = document.querySelector('.toast');
        expect(resolvedValue(toast, 'border-color')).toBe('rgba(100, 181, 246, 0.5)');
        expect(resolvedValue(toast.querySelector('.toast-icon'), 'color')).toBe('#64b5f6');
      }
    );

    it('keeps a notice that asks nothing out of the way of a drag', () => {
      render('', '<div class="toast toast-passive"></div>');

      expect(resolvedValue(document.querySelector('.toast'), 'pointer-events')).toBe('none');
    });
  });

  describe('the confirmation dialog buttons', () => {
    // Save, Discard and Keep editing do not fit in a row in a 400px dialog, a 340px window or a
    // wordy language; the shared button clips its label to one line, so the row has to wrap.
    it('wraps three buttons onto a second row instead of cutting their labels', () => {
      render(
        '',
        `<div class="confirm-modal-content">
          <div class="modal-footer">
            <button class="btn btn-secondary btn-neutral" id="confirm-cancel-btn">Keep editing</button>
            <button class="btn btn-secondary" id="confirm-alternate-btn">Discard color edits</button>
            <button class="btn btn-primary" id="confirm-ok-btn">Save and Continue</button>
          </div>
        </div>`
      );

      const footer = document.querySelector('.modal-footer');
      expect(resolvedValue(footer, 'flex-wrap')).toBe('wrap');
      expect(resolvedValue(footer, 'justify-content')).toBe('flex-end');
      for (const button of document.querySelectorAll('.btn')) {
        // A label longer than the dialog wraps inside its button rather than being clipped.
        expect(resolvedValue(button, 'white-space')).toBe('normal');
        expect(resolvedValue(button, 'max-width')).toBe('100%');
      }
    });
  });

  describe('a button the markup hides', () => {
    // The shared button sets display, which beats the hidden attribute, so the confirmation
    // dialog showed an empty third button between Cancel and the action whenever it asked two.
    it('stays out of the row', () => {
      render('', '<div class="modal-footer"><button class="btn" id="alt" hidden></button></div>');

      expect(resolvedValue(document.getElementById('alt'), 'display')).toBe('none');
    });
  });

  describe('the to-do add field', () => {
    // The field scrolled away with the first rows of a long list. A sticky box is held at the
    // scroll container's content edge, so it needs the container's padding as a negative top.
    it('stays at the top of the scrolling body, reaching its edges', () => {
      render('', '<div class="modal-body"><form class="todo-add-form"></form></div>');

      const form = document.querySelector('.todo-add-form');
      const inset = resolvedValue(document.querySelector('.modal-body'), 'padding');
      expect(resolvedValue(form, 'position')).toBe('sticky');
      // Held at the content edge, so the body's own padding is taken back: negative top and margins,
      // and the same amount as padding on the field itself, which leaves the layout at rest as it was.
      // At the end the body keeps the scrollbar's room out of its padding, so less is taken back.
      const scrollbar = resolvedValue(form, '--modal-scrollbar-size');
      expect(resolvedValue(form, 'top')).toBe(`calc(-1 * ${inset})`);
      expect(resolvedValue(form, 'margin')).toBe(`calc(-1 * ${inset}) 0 0`);
      expect(resolvedValue(form, 'margin-inline').replace(/\s+/g, ' ')).toBe(
        `calc(-1 * ${inset}) calc(${scrollbar} - ${inset})`
      );
      expect(resolvedValue(form, 'padding')).toBe(`${inset} ${inset} 14px`);
      expect(resolvedValue(form, 'padding-inline-end')).toBe(`calc(${inset} - ${scrollbar})`);
    });

    // A window under 480px high gives a dialog body 12px of padding instead of 16px. An add field that
    // still took back 16px reached 4px past each edge of the body, which then scrolled sideways.
    it('takes back exactly the padding the body has in a short window', () => {
      const short = { viewport: { width: 500, height: 420 } };
      render('', '<div class="modal-body"><form class="todo-add-form"></form></div>');

      const body = document.querySelector('.modal-body');
      const form = document.querySelector('.todo-add-form');
      expect(resolvedValue(body, 'padding')).toBe('1rem');
      expect(resolvedValue(body, 'padding', short)).toBe('0.75rem');
      const inline = (options) =>
        resolvedValue(form, 'margin-inline', options).replace(/\s+/g, ' ');
      expect(inline()).toBe('calc(-1 * 1rem) calc(9px - 1rem)');
      expect(inline(short)).toBe('calc(-1 * 0.75rem) calc(9px - 0.75rem)');
      expect(resolvedValue(form, 'margin', short)).toBe('calc(-1 * 0.75rem) 0 0');
      expect(resolvedValue(form, 'top', short)).toBe('calc(-1 * 0.75rem)');
    });
  });

  describe('dialog stacking', () => {
    // Dialogs are stacked by the order they were opened, not by where their elements happen to sit
    // in the document: openDialog() gives each one a --dialog-depth, and the tier is lifted by it, so
    // the confirmation over the graph editor, or either over Settings, is always the one on top.
    it.each(['modal', 'camera-expanded-preview'])(
      'lifts a .%s by its dialog depth',
      (className) => {
        render(
          '',
          `<div id="under" class="${className}"></div>
        <div id="over" class="${className}" style="--dialog-depth: 2"></div>`
        );

        expect(resolvedValue(document.getElementById('under'), 'z-index')).toBe('calc(1300 + 0)');
        expect(resolvedValue(document.getElementById('over'), 'z-index')).toBe('calc(1300 + 2)');
      }
    );
  });

  describe('custom colour hex field', () => {
    const field = (attributes = '') =>
      `<div id="settings-modal"><input id="custom-color-hex" type="text" ${attributes}></div>`;

    // The settings modal paints the focus border on text inputs; the rejected-value border has to
    // beat it, because the field keeps focus when Save rejects the value.
    it('stays red while focused once its value has been rejected', () => {
      render('', field('aria-invalid="true" data-focus-visible'));

      expect(resolvedValue(document.getElementById('custom-color-hex'), 'border-color')).toBe(
        '#ef5350'
      );
    });

    it('keeps the normal focus border while the value is acceptable', () => {
      render('', field('data-focus-visible'));

      expect(resolvedValue(document.getElementById('custom-color-hex'), 'border-color')).not.toBe(
        '#ef5350'
      );
    });
  });

  describe('media tile text', () => {
    // Hovering used to slide every line sideways out of its pill, whether or not it overflowed.
    it('keeps its lines in place and ellipsized while the tile is hovered', () => {
      render(
        '',
        `<div class="control-item media-player-entity" data-hover>
          <div class="control-info"><div class="media-info">
            <div class="media-title">Title</div>
            <div class="media-artist">Artist</div>
            <div class="media-album">Album</div>
          </div></div>
        </div>`
      );

      for (const line of document.querySelectorAll('.media-info > *')) {
        expect(resolvedValue(line, 'animation')).toBeNull();
        expect(resolvedValue(line, 'overflow')).toBe('hidden');
        expect(resolvedValue(line, 'text-overflow')).toBe('ellipsis');
      }
    });

    // The track is a button now, so the card opens the player's controls from the keyboard. The
    // grid placement written for a div has to keep working on it at every window width.
    describe('the track button', () => {
      const markup = `<div class="media-tile">
        <div class="media-tile-content">
          <button type="button" class="media-tile-info">
            <span class="media-tile-title">A very long title</span>
            <span class="media-tile-artist">An artist</span>
          </button>
          <div class="media-tile-seek"></div>
          <div class="media-tile-controls"></div>
        </div>
      </div>`;

      it.each([
        [500, '1', 'auto'],
        [420, '1 / -1', 'auto'],
        [360, '1', 'auto'],
        [340, '1', 'auto'],
      ])('takes its place in the grid at %ipx', (width, column, row) => {
        render('', markup);
        const info = document.querySelector('.media-tile-info');
        const options = { viewport: { width, height: 600 } };

        expect(resolvedValue(info, 'grid-column', options)).toBe(column);
        // Only the narrowest layout stacks the rows, so the other widths leave the row to the grid
        expect(resolvedValue(info, 'grid-row', options)).toBe(width <= 360 ? row : null);
      });

      it('is drawn as text, with the title and the artist cut off by an ellipsis', () => {
        render('', markup);
        const info = document.querySelector('.media-tile-info');

        expect(resolvedValue(info, 'border-top-width')).toBeNull();
        expect(resolvedValue(info, 'border')).toBe('0');
        expect(resolvedValue(info, 'background')).toBe('transparent');
        expect(resolvedValue(info, 'text-align')).toBe('start');
        for (const line of info.children) {
          expect(resolvedValue(line, 'white-space')).toBe('nowrap');
          expect(resolvedValue(line, 'overflow')).toBe('hidden');
          expect(resolvedValue(line, 'text-overflow')).toBe('ellipsis');
        }
      });
    });

    it('has no marquee animation left in the stylesheets', () => {
      const css = require('fs').readFileSync(
        require('path').resolve(__dirname, '../../styles.css'),
        'utf8'
      );

      expect(css).not.toContain('marquee-scroll');
    });
  });

  describe('camera viewer frame', () => {
    // A frame whose track follows its content grows to a 4:3 or portrait picture's own height and
    // then crops it, so the track has to be sized by the 16:9 frame instead.
    it('sizes its grid track by the frame and lets the feed shrink to it', () => {
      render(
        '',
        `<div class="modal camera-modal"><div class="camera-viewer">
          <img class="camera-stream camera-img"><video class="camera-video"></video>
        </div></div>`
      );

      const viewer = document.querySelector('.camera-viewer');
      expect(resolvedValue(viewer, 'grid-template')).toBe('minmax(0, 1fr) / minmax(0, 1fr)');
      for (const feed of document.querySelectorAll('.camera-viewer > *')) {
        expect(resolvedValue(feed, 'height')).toBe('100%');
        expect(resolvedValue(feed, 'object-fit')).toBe('contain');
        expect(resolvedValue(feed, 'min-height')).toBe('0');
        expect(resolvedValue(feed, 'min-width')).toBe('0');
      }
    });
  });

  describe('single-action primary card focus ring', () => {
    // Lock, switch and scene cards focus the tile itself; the card clips anything outside it.
    it.each(THEME_CASES)('draws the ring inside the card (%s)', (_, theme) => {
      render(
        theme,
        `<div class="status-card primary-entity-card">
          <div class="control-item" role="button" tabindex="0" data-primary-card="true"
            data-focus-visible></div>
        </div>`
      );
      const tileElement = document.querySelector('.control-item');
      expect(resolvedValue(tileElement, 'outline-offset')).toBe('-3px');
      expect(resolvedValue(tileElement, 'outline')).toMatch(/^\d+px solid /);
    });
  });

  describe('keyboard focus ring colour', () => {
    const uiUtils = require('../../src/ui-utils.js');
    const focusMarkup = `
      <div id="quick-controls"><div class="control-item">
        <button class="tile-primary-button" tabindex="0" data-focus-visible></button>
      </div></div>
      <div class="status-card primary-entity-card"><div class="control-item" data-primary-card="true">
        <button class="tile-primary-button" tabindex="0" data-focus-visible></button>
      </div></div>
      <div class="control-item" role="button" tabindex="0" data-focus-visible></div>
      <button class="btn btn-secondary" data-focus-visible>Save</button>
      <button class="close-btn" data-focus-visible></button>
      <a href="#" data-focus-visible>Link</a>
      <div class="media-detail-controls"><button class="btn" data-focus-visible></button></div>
      <div class="form-group"><input type="text" data-focus data-focus-visible></div>`;
    // Outlines carry the ring; text fields show focus through their border instead.
    const ringColor = (element) =>
      element.matches('input')
        ? resolvedValue(element, 'border-color')
        : resolvedValue(element, 'outline').replace(/^\S+\s+\S+\s+/, '');

    afterEach(() => {
      document.documentElement.removeAttribute('style');
    });

    it.each([
      ...uiUtils.getAccentThemes().map((theme) => [theme.id, theme.color]),
      ['custom white', '#ffffff'],
    ])('reaches 3:1 on light surfaces with the %s accent', (_, accent) => {
      render(THEMES.light, focusMarkup);
      uiUtils.applyAccentThemeFromColor(accent);
      const surfaces = ['#ffffff', `rgb(${resolvedValue(document.body, '--window-bg-rgb')})`];

      for (const element of document.querySelectorAll('[data-focus-visible]')) {
        const color = ringColor(element);
        for (const surface of surfaces) {
          expect({
            element: element.className,
            contrast: contrastRatio(color, surface) >= 3,
          }).toEqual({ element: element.className, contrast: true });
        }
      }
    });

    it('keeps the accent itself in the dark theme and white under the readable preset', () => {
      render(THEMES.dark, focusMarkup);
      uiUtils.applyAccentThemeFromColor('#64b5f6');
      for (const element of document.querySelectorAll('[data-focus-visible]')) {
        expect(parseColor(ringColor(element))).toEqual(parseColor('#64b5f6'));
      }

      // The preset draws a white outline on everything, text fields included.
      document.body.className = THEMES['readable light'];
      for (const element of document.querySelectorAll('[data-focus-visible]')) {
        const outline = resolvedValue(element, 'outline').replace(/^\S+\s+\S+\s+/, '');
        expect(parseColor(outline)).toEqual([255, 255, 255, 1]);
      }
    });
  });

  describe('controls that turned their focus outline off', () => {
    const uiUtils = require('../../src/ui-utils.js');
    // Each of these once replaced the ring with a faint translucent border or glow (or nothing).
    const controlMarkup = `
      <div class="command-palette-panel">
        <input class="command-palette-input" data-focus>
        <div class="command-palette-results">
          <button class="command-palette-result highlighted"></button>
          <button class="command-palette-result" data-focus-visible></button>
        </div>
      </div>
      <button class="command-palette-close" data-focus-visible></button>
      <div class="reorganize-mode"><div class="control-item">
        <button class="desktop-pin-quick-toggle" data-focus-visible>Pin</button>
      </div></div>
      <input class="qa-tab-rename-input" type="text" data-focus data-focus-visible>
      <div class="add-page-modal"><button class="qa-add-chip" data-focus-visible></button></div>
      <div class="form-group"><input type="checkbox" data-focus data-focus-visible></div>
      <button class="desktop-pin-light-power" data-focus-visible></button>
      <input class="desktop-pin-light-slider" type="range" data-focus data-focus-visible>
      <button class="desktop-pin-light-preset" data-focus-visible></button>
      <button class="desktop-pin-panel-button" data-focus-visible></button>`;
    const cameraMarkup = `
      <div class="camera-expanded-preview"><div class="camera-expanded-preview-footer">
        <button class="camera-expanded-preview-close" data-focus-visible></button>
        <button class="camera-expanded-preview-reconnect" data-focus-visible></button>
      </div></div>`;
    const ring = (element) => {
      const [width, style, ...color] = (resolvedValue(element, 'outline') || '').split(/\s+/);
      return { width: parseFloat(width), style, color: color.join(' ') };
    };
    const rows = () =>
      [...document.querySelectorAll('.command-palette-result, [data-focus-visible]')].filter(
        (element, index, all) => all.indexOf(element) === index
      );

    afterEach(() => {
      document.documentElement.removeAttribute('style');
    });

    it.each([
      ...uiUtils.getAccentThemes().map((theme) => [theme.id, theme.color]),
      ['custom white', '#ffffff'],
    ])('draws a solid 3:1 ring in the light theme with the %s accent', (_, accent) => {
      render(THEMES.light, controlMarkup + cameraMarkup);
      uiUtils.applyAccentThemeFromColor(accent);
      const lightSurfaces = ['#ffffff', `rgb(${resolvedValue(document.body, '--window-bg-rgb')})`];
      // The camera viewer stays dark in every theme.
      const cameraSurface = 'rgb(13, 18, 25)';

      for (const element of rows()) {
        const { width, style, color } = ring(element);
        const surfaces = element.closest('.camera-expanded-preview')
          ? [cameraSurface]
          : lightSurfaces;
        for (const surface of surfaces) {
          expect({
            element: element.className || element.type,
            ring: width >= 2 && style === 'solid' && contrastRatio(color, surface) >= 3,
          }).toEqual({ element: element.className || element.type, ring: true });
        }
      }
    });

    it('uses the accent in the dark theme and white under the readable preset', () => {
      render(THEMES.dark, controlMarkup + cameraMarkup);
      uiUtils.applyAccentThemeFromColor('#64b5f6');
      for (const element of rows()) {
        const { width, style, color } = ring(element);
        expect({
          element: element.className || element.type,
          width,
          style,
          color: parseColor(color),
        }).toEqual({
          element: element.className || element.type,
          width: 2,
          style: 'solid',
          color: parseColor('#64b5f6'),
        });
      }

      document.body.className = THEMES['readable light'];
      for (const element of document.querySelectorAll('[data-focus-visible]')) {
        expect(parseColor(ring(element).color)).toEqual([255, 255, 255, 1]);
      }
    });

    it.each(THEME_CASES)('keeps the Pin label readable on its dark pill (%s)', (_, theme) => {
      render(
        theme,
        `<div class="reorganize-mode"><div class="control-item">
          <button class="desktop-pin-quick-toggle">Pin</button>
          <button class="desktop-pin-quick-toggle" data-hover>Pin</button>
          <button class="desktop-pin-quick-toggle" data-focus-visible>Pin</button>
        </div></div>`
      );
      for (const toggle of document.querySelectorAll('.desktop-pin-quick-toggle')) {
        const pill = resolvedValue(toggle, 'background');
        expect(contrastRatio(resolvedValue(toggle, 'color'), pill)).toBeGreaterThanOrEqual(4.5);
      }
    });

    it('rings the highlighted palette row only while the search field has focus', () => {
      const palette = (inputState) => `
        <div class="command-palette-panel">
          <input class="command-palette-input" ${inputState}>
          <button class="command-palette-close" data-focus-visible></button>
          <div class="command-palette-results">
            <button class="command-palette-result highlighted"></button>
            <button class="command-palette-result" data-hover></button>
          </div>
        </div>`;
      render(THEMES.dark, palette('data-focus'));
      const [highlighted, hovered] = document.querySelectorAll('.command-palette-result');
      expect(ring(highlighted).style).toBe('solid');
      expect(ring(hovered).style).not.toBe('solid');

      // Tabbing on to the close button leaves one ring, on the button.
      render(THEMES.dark, palette(''));
      expect(ring(document.querySelector('.command-palette-result.highlighted')).style).not.toBe(
        'solid'
      );
    });
  });

  describe('hidden rows in workflow pick lists', () => {
    it('hides checkbox rows in the advanced alert options', () => {
      render(
        '',
        `<div class="alert-advanced-options form-group">
          <label class="workflow-checkbox" hidden>Quiet hours<input type="checkbox"></label>
        </div>`
      );

      expect(resolvedValue(document.querySelector('label'), 'display')).toBe('none');
    });
  });

  describe('primary cards pager', () => {
    const pagerMarkup = `
      <div id="settings-modal">
        <div id="primary-cards-list" class="entity-selector-list">
          <div class="entity-item"></div>
          <div class="primary-cards-list-actions primary-cards-pagination"></div>
        </div>
      </div>`;

    it.each(THEME_CASES)('paints the sticky bar opaque in the list colour (%s)', (_, theme) => {
      render(theme, pagerMarkup);
      const list = document.getElementById('primary-cards-list');
      const background = resolvedValue(
        list.querySelector('.primary-cards-pagination'),
        'background'
      );
      const layers = splitTopLevel(background);

      expect(isOpaque(layers.at(-1))).toBe(true);
      expect(background).toContain(resolvedValue(list, 'background'));
    });

    it('keeps keyboard-focused rows clear of the sticky bar', () => {
      render('', pagerMarkup);
      const list = document.getElementById('primary-cards-list');

      // The bar is about 38px tall (28px buttons, padding and border) plus a focus ring.
      expect(parseFloat(resolvedValue(list, 'scroll-padding-bottom'))).toBeGreaterThanOrEqual(44);
    });
  });

  describe('desktop pin connection issue', () => {
    const emptyMarkup = `
      <div class="desktop-pin-shell">
        <div id="desktop-pin-empty" class="desktop-pin-empty" data-state="disconnected">
          <div class="desktop-pin-empty-kicker">Connection issue</div>
          <div class="desktop-pin-empty-title">Home Assistant unavailable</div>
          <div class="desktop-pin-empty-copy">Disconnected. Retrying automatically.</div>
          <div class="desktop-pin-empty-actions">
            <button class="control-btn desktop-pin-action desktop-pin-empty-action">Focus Main</button>
          </div>
        </div>
      </div>`;
    const part = (name) => document.querySelector(`.desktop-pin-empty-${name}`);

    it('sizes the Focus Main button to its label instead of the 24px icon-button circle', () => {
      render('desktop-pin-mode', emptyMarkup);
      const button = part('action');

      expect(resolvedValue(button, 'width')).toBe('auto');
      expect(resolvedValue(button, 'height')).toBe('auto');
      expect(resolvedValue(button, 'white-space')).toBe('nowrap');
      // Anything that still overflows is cut at the bottom, never above the top edge.
      expect(resolvedValue(document.getElementById('desktop-pin-empty'), 'justify-content')).toBe(
        'safe center'
      );
    });

    it.each([
      [
        { width: 168, height: 148 },
        { kicker: true, copyLines: '3' },
      ],
      [
        { width: 156, height: 122 },
        { kicker: false, copyLines: '2' },
      ],
      [
        { width: 140, height: 110 },
        { kicker: false, copyLines: '1' },
      ],
      [
        { width: 97, height: 83 },
        { kicker: false, copyLines: null },
      ],
    ])('drops lower-priority lines to fit a %o pin', (viewport, expected) => {
      render('desktop-pin-mode', emptyMarkup);
      const options = { viewport };

      expect(resolvedValue(part('kicker'), 'display', options) !== 'none').toBe(expected.kicker);
      if (expected.copyLines) {
        expect(resolvedValue(part('copy'), '-webkit-line-clamp', options)).toBe(expected.copyLines);
      } else {
        expect(resolvedValue(part('copy'), 'display', options)).toBe('none');
      }
      expect(resolvedValue(part('actions'), 'display', options)).toBe('flex');
    });
  });

  describe('switch desktop pin state', () => {
    const toPx = (length) => parseFloat(length) * (String(length).endsWith('rem') ? 16 : 1);
    const renderSwitchPin = (layout) =>
      render(
        'desktop-pin-mode',
        `<div class="desktop-pin-shell"><div class="desktop-pin-content">
          <div class="control-item desktop-pin-control desktop-pin-panel-control desktop-pin-toggle-control"
            data-layout="${layout}">
            <div class="desktop-pin-panel-shell">
              <div class="desktop-pin-panel-body desktop-pin-toggle-body">
                <div class="desktop-pin-panel-meter">
                  <div class="desktop-pin-panel-glyph"></div>
                  <div class="desktop-pin-panel-kpi">Off</div>
                </div>
              </div>
            </div>
          </div>
        </div></div>`
      );

    // At the 156x122 minimum the middle panel is about 40px tall (measured in a real pin window).
    it.each(['compact', 'micro'])('fits the glyph and state in a 156x122 %s pin', (layout) => {
      renderSwitchPin(layout);
      const options = { viewport: { width: 156, height: 122 } };
      const meter = document.querySelector('.desktop-pin-panel-meter');
      const glyph = toPx(
        resolvedValue(document.querySelector('.desktop-pin-panel-glyph'), 'height', options)
      );
      const padding = toPx(resolvedValue(meter, 'padding', options).split(/\s+/)[0]);
      // The state's line box: at least 14px type at line-height 0.95.
      const state = 14 * 0.95;
      const gap = toPx(resolvedValue(meter, 'gap', options));
      const sideBySide = resolvedValue(meter, 'grid-auto-flow', options) === 'column';
      const content = sideBySide ? Math.max(glyph, state) : glyph + gap + state;

      expect(content + 2 * padding + 2).toBeLessThanOrEqual(40);
    });

    it('keeps the glyph above the state in the default 168x148 pin', () => {
      renderSwitchPin('compact');
      const meter = document.querySelector('.desktop-pin-panel-meter');
      expect(
        resolvedValue(meter, 'grid-auto-flow', { viewport: { width: 168, height: 148 } })
      ).not.toBe('column');
    });
  });

  describe('desktop pin corners', () => {
    const toPx = (length) => parseFloat(length) * (String(length).endsWith('rem') ? 16 : 1);

    it.each([
      { width: 168, height: 148 },
      { width: 156, height: 122 },
      { width: 260, height: 148 },
    ])('keeps the top-right value inside the rounded %o pin window', (viewport) => {
      render(
        'desktop-pin-mode',
        `<div class="desktop-pin-shell"><div class="desktop-pin-content">
          <div class="control-item desktop-pin-control desktop-pin-panel-control desktop-pin-toggle-control"
            data-layout="compact">
            <div class="desktop-pin-panel-shell">
              <div class="desktop-pin-panel-topline">
                <div class="desktop-pin-panel-meta"><div class="desktop-pin-panel-name">Outlet</div></div>
                <div class="desktop-pin-panel-kpi">Off</div>
              </div>
            </div>
          </div>
        </div></div>`
      );
      const options = { viewport };
      const radius = toPx(
        resolvedValue(document.querySelector('.desktop-pin-shell'), 'clip-path', options).match(
          /round\s+([\d.]+px)/
        )[1]
      );
      const control = document.querySelector('.desktop-pin-panel-control');
      const padding = toPx(resolvedValue(control, 'padding', options));
      const margin = toPx(
        resolvedValue(
          document.querySelector('.desktop-pin-panel-kpi'),
          'margin-inline-end',
          options
        ) || '0px'
      );
      // The value's top-right corner, measured from the centre of the window's corner arc.
      const dx = radius - padding - margin;
      const dy = radius - padding;

      expect(dx <= 0 || dx * dx + dy * dy <= radius * radius).toBe(true);
    });
  });

  describe('desktop pin baseline (168x148)', () => {
    const viewport = { width: 168, height: 148 };
    const options = { viewport };
    const toPx = (length) => parseFloat(length) * (String(length).endsWith('rem') ? 16 : 1);
    const panel = (family, extra = '') =>
      `<div class="desktop-pin-shell"><div class="desktop-pin-content">
        <div class="control-item desktop-pin-control desktop-pin-panel-control desktop-pin-${family}-control"
          data-layout="compact" ${extra}>
          <div class="desktop-pin-panel-shell">
            <div class="desktop-pin-panel-topline"><div class="desktop-pin-panel-meta">
              <div class="desktop-pin-panel-name">Name</div>
              <div class="desktop-pin-panel-status">State</div>
            </div></div>
            <div class="desktop-pin-panel-body">
              <div class="desktop-pin-panel-meter"><div class="desktop-pin-panel-glyph"></div>
                <div class="desktop-pin-panel-value">1</div></div>
              <div class="desktop-pin-panel-actions">
                <button class="desktop-pin-panel-button" data-active="true">
                  <span class="desktop-pin-panel-button-label">Go</span></button>
                <button class="desktop-pin-power desktop-pin-fan-power"></button>
              </div>
            </div>
          </div>
        </div></div></div>`;

    it.each(['weather', 'enum', 'sensor', 'climate'])(
      'draws a %s pin with the tight spacing, not the roomy one the tile rules left it',
      (family) => {
        render('desktop-pin-mode', panel(family));
        const control = document.querySelector('.desktop-pin-panel-control');
        expect(resolvedValue(control, '--desktop-pin-panel-pad', options)).toBe('8px');
        expect(resolvedValue(control, '--desktop-pin-panel-gap', options)).toBe('6px');
        expect(resolvedValue(control, 'padding', options)).toBe('8px');
        expect(
          resolvedValue(document.querySelector('.desktop-pin-panel-meter'), 'min-height', options)
        ).toBe('34px');
      }
    );

    it('insets a light pin like the others instead of keeping the narrow-window padding', () => {
      render(
        'desktop-pin-mode',
        `<div class="desktop-pin-shell"><div class="desktop-pin-content">
          <div class="control-item desktop-pin-control desktop-pin-light-control" data-layout="compact">
            <div class="desktop-pin-light-shell"></div>
          </div></div></div>`
      );
      const light = document.querySelector('.desktop-pin-light-control');
      expect(resolvedValue(light, 'padding', options)).toBe('0');
      expect(resolvedValue(light, '--desktop-pin-panel-pad', options)).toBe('8px');
      expect(
        resolvedValue(document.querySelector('.desktop-pin-light-shell'), 'padding', options)
      ).toBe('8px');
    });

    it('never sets pin text below 9px, apart from the micro layout', () => {
      render(
        'desktop-pin-mode',
        `<div class="desktop-pin-shell">
          <div class="control-item desktop-pin-control desktop-pin-panel-control" data-layout="compact">
            <div class="desktop-pin-panel-status"></div><div class="desktop-pin-panel-stat-label"></div>
            <div class="desktop-pin-panel-slider-label"></div><div class="desktop-pin-panel-caption"></div>
            <div class="desktop-pin-light-brightness-label"></div><div class="desktop-pin-light-status"></div>
          </div>
        </div>`
      );
      for (const name of [
        'desktop-pin-panel-status',
        'desktop-pin-panel-stat-label',
        'desktop-pin-panel-slider-label',
        'desktop-pin-panel-caption',
        'desktop-pin-light-brightness-label',
        'desktop-pin-light-status',
      ]) {
        const size = resolvedValue(document.querySelector(`.${name}`), 'font-size', options);
        expect({ name, px: toPx(size) }).toEqual({ name, px: 9 });
      }
    });

    it('lets only the light and scene pins show a hand over their whole surface', () => {
      render(
        'desktop-pin-mode',
        `<div class="control-item desktop-pin-control desktop-pin-sensor-control"></div>
        <div class="control-item desktop-pin-control desktop-pin-light-control"></div>
        <div class="control-item desktop-pin-control desktop-pin-scene-control"></div>`
      );
      const cursor = (name) =>
        resolvedValue(document.querySelector(`.desktop-pin-${name}-control`), 'cursor', options);
      expect(cursor('sensor')).toBe('default');
      expect(cursor('light')).toBe('pointer');
      expect(cursor('scene')).toBe('pointer');
    });

    it('draws the power button as a round icon button, 24px in a default pin', () => {
      render('desktop-pin-mode', panel('fan'));
      const power = document.querySelector('.desktop-pin-power');
      expect(resolvedValue(power, 'width', options)).toBe('24px');
      expect(resolvedValue(power, 'height', options)).toBe('24px');
      expect(resolvedValue(power, 'border-radius', options)).toBe('9999px');
      expect(resolvedValue(power, 'padding', options)).toBe('0');
    });

    it('draws a power button that is on with a heavier ring, a cue that survives forced colours', () => {
      render(
        'desktop-pin-mode',
        `<button class="desktop-pin-power" data-active="true"></button>
        <button class="desktop-pin-power" data-active="false"></button>`
      );
      const [on, off] = document.querySelectorAll('.desktop-pin-power');
      expect(resolvedValue(on, 'border-width', options)).toBe('2px');
      expect(resolvedValue(off, 'border', options)).toMatch(/^1px solid /);
    });

    it('sets a word tightly only as much as a number, and keeps digit tracking for numbers', () => {
      render(
        'desktop-pin-mode',
        `<div class="control-item desktop-pin-control desktop-pin-vacuum-control">
          <div class="desktop-pin-panel-value">Docked</div></div>
        <div class="control-item desktop-pin-control desktop-pin-numeric-control">
          <div class="desktop-pin-panel-value">1.5 °C</div></div>`
      );
      const [word, number] = [...document.querySelectorAll('.desktop-pin-panel-value')];
      expect(resolvedValue(word, 'letter-spacing', options)).toBe('-0.01em');
      expect(resolvedValue(number, 'letter-spacing', options)).toBe('-0.04em');
    });

    it('puts a header value on the name baseline', () => {
      render(
        'desktop-pin-mode',
        `<div class="desktop-pin-panel-topline"><div class="desktop-pin-panel-meta"></div>
          <div class="desktop-pin-panel-kpi">40%</div></div>`
      );
      expect(resolvedValue(document.querySelector('.desktop-pin-panel-meta'), 'align-self')).toBe(
        'baseline'
      );
      expect(resolvedValue(document.querySelector('.desktop-pin-panel-kpi'), 'align-self')).toBe(
        'baseline'
      );
    });

    it('steps the header in while a pin is edited, clear of the corner marks', () => {
      const header = `<div class="desktop-pin-panel-topline"></div><div class="desktop-pin-light-topline"></div>`;
      render('desktop-pin-mode', header);
      for (const node of document.querySelectorAll('[class$="topline"]')) {
        expect(resolvedValue(node, 'padding-inline-start', options)).not.toBe('6px');
      }
      render('desktop-pin-mode desktop-pin-edit-mode', header);
      for (const node of document.querySelectorAll('[class$="topline"]')) {
        expect(resolvedValue(node, 'padding-inline-start', options)).toBe('6px');
      }
    });

    it('takes a lamp that is off out of amber', () => {
      render(
        'desktop-pin-mode',
        `<div class="control-item desktop-pin-control desktop-pin-light-control" data-state="off"></div>
        <div class="control-item desktop-pin-control desktop-pin-light-control" data-state="on"></div>`
      );
      const [off, on] = document.querySelectorAll('.desktop-pin-light-control');
      expect(resolvedValue(off, '--desktop-pin-tint-rgb', options)).toBe('130, 150, 176');
      expect(resolvedValue(on, '--desktop-pin-tint-rgb', options)).toBe('255, 203, 104');
    });

    it('stacks the panel body as a column and keeps one row of equal buttons', () => {
      render('desktop-pin-mode', panel('enum'));
      expect(
        resolvedValue(document.querySelector('.desktop-pin-panel-body'), 'display', options)
      ).toBe('flex');
      const actions = document.querySelector('.desktop-pin-panel-actions');
      expect(resolvedValue(actions, 'grid-auto-flow', options)).toBe('column');
      expect(resolvedValue(actions, 'grid-auto-columns', options)).toBe('minmax(0, 1fr)');
    });

    it('marks the active button with a stronger edge and label, not only a tint', () => {
      render('desktop-pin-mode', panel('climate'));
      const button = document.querySelector('.desktop-pin-panel-button');
      expect(resolvedValue(button, 'border-color', options)).toMatch(/, 0\.6\)$/);
      expect(
        contrastRatio(resolvedValue(button, 'color', options), 'rgb(18, 22, 30)')
      ).toBeGreaterThan(12);
    });

    it('shrinks a toast to the window and draws it dark', () => {
      render(
        'desktop-pin-mode',
        `<div class="toast-container"><div class="toast error"></div></div>`
      );
      const toast = document.querySelector('.toast');
      expect(resolvedValue(toast, 'min-width', options)).toBe('0');
      expect(resolvedValue(toast, 'max-width', options)).toBe('100%');
      // The container spans the window, so the toast fits whatever the pin's size.
      const container = document.querySelector('.toast-container');
      expect(resolvedValue(container, 'left', options)).toBe('0');
      expect(resolvedValue(container, 'right', options)).toBe('0');
      expect(resolvedValue(container, 'width', options)).toBeNull();
    });

    it('keeps the glass rim the same in the light theme', () => {
      const rim = (theme) => {
        render(`desktop-pin-mode ${theme}`, `<div class="desktop-pin-shell"></div>`);
        const shell = document.querySelector('.desktop-pin-shell');
        return [
          resolvedValue(shell, '--desktop-pin-shell-highlight', options),
          resolvedValue(shell, '--desktop-pin-shell-edge', options),
          resolvedValue(shell, 'box-shadow', options),
        ];
      };
      expect(rim('theme-light')).toEqual(rim(''));
      expect(rim('')[2]).toContain('inset 0 0 0 1px rgba(255, 255, 255, 0.06)');
    });

    it('does not force a 140x122 minimum on a pin at an enlarged interface', () => {
      render(
        'desktop-pin-mode large-interface',
        `<div class="desktop-pin-shell"><div class="desktop-pin-content"></div></div>`
      );
      const content = document.querySelector('.desktop-pin-content');
      expect(resolvedValue(content, 'min-width', options)).not.toBe('140px');
      expect(resolvedValue(content, 'min-height', options)).not.toBe('122px');
    });
  });

  describe('desktop pins larger than the default and in their other states', () => {
    const panel = (family, layout, attributes = '') =>
      `<div class="desktop-pin-shell"><div class="desktop-pin-content">
        <div class="control-item desktop-pin-control desktop-pin-panel-control desktop-pin-${family}-control"
          data-layout="${layout}" ${attributes}>
          <div class="desktop-pin-panel-shell"><div class="desktop-pin-panel-body">
            <div class="desktop-pin-weather-stats"><div class="desktop-pin-panel-stat">
              <div class="desktop-pin-panel-stat-label">12 km/h</div></div></div>
            <div class="desktop-pin-panel-actions">
              <button class="desktop-pin-panel-button"><span class="desktop-pin-panel-button-label">Cool</span></button>
            </div>
          </div></div>
        </div></div></div>`;

    // 195x160 up to 259x189 is the balanced layout. It brings back a fourth mode or speed, so its
    // buttons need the default pin's spacing; capitals ran them to "C...". Sentence case is now
    // every pin button's own, so no rule here has to turn capitals off.
    it.each([
      ['climate', { width: 200, height: 170 }],
      ['fan', { width: 240, height: 180 }],
      ['cover', { width: 259, height: 189 }],
    ])('keeps a balanced %s pin to the default pin spacing and buttons', (family, viewport) => {
      render('desktop-pin-mode', panel(family, 'balanced'));
      const options = { viewport };
      const control = document.querySelector('.desktop-pin-panel-control');
      const button = document.querySelector('.desktop-pin-panel-button');
      expect(resolvedValue(control, '--desktop-pin-panel-pad', options)).toBe('8px');
      expect(resolvedValue(control, '--desktop-pin-panel-gap', options)).toBe('6px');
      expect(resolvedValue(button, 'text-transform', options) ?? 'none').toBe('none');
      expect(resolvedValue(button, 'min-height', options)).toBe('24px');
      expect(resolvedValue(button, 'letter-spacing', options)).toBe('0');
      // The row gives a long label ("Kühlen") the room a short one ("Aus") leaves.
      expect(
        resolvedValue(document.querySelector('.desktop-pin-panel-actions'), 'display', options)
      ).toBe('flex');
    });

    it('leaves a balanced media pin its roomier spacing, since no row of it grows', () => {
      // A media pin is balanced only from 285px wide, and nothing of it ran off the tile there.
      render('desktop-pin-mode', panel('media', 'balanced', 'data-dense-variant="standard"'));
      const options = { viewport: { width: 300, height: 170 } };
      const button = document.querySelector('.desktop-pin-panel-button');
      expect(
        resolvedValue(
          document.querySelector('.desktop-pin-panel-control'),
          '--desktop-pin-panel-pad',
          options
        )
      ).toBe('12px');
      expect(resolvedValue(button, 'min-height', options)).not.toBe('24px');
      // Its buttons are in sentence case all the same, like every pin's: a media pin said PLAY
      // beside pins that say Play.
      expect(resolvedValue(button, 'text-transform', options) ?? 'none').toBe('none');
      // The tight media pin, narrower, keeps the default pin's spacing.
      render('desktop-pin-mode', panel('media', 'balanced', 'data-dense-variant="tight"'));
      expect(
        resolvedValue(document.querySelector('.desktop-pin-panel-button'), 'min-height', options)
      ).toBe('24px');
    });

    it.each(['compact', 'balanced', 'roomy'])(
      'keeps the case of a weather reading in a %s pin ("km/h", never "KM/H")',
      (layout) => {
        render('desktop-pin-mode', panel('weather', layout));
        expect(
          resolvedValue(document.querySelector('.desktop-pin-panel-stat-label'), 'text-transform')
        ).toBe('none');
      }
    );

    it.each([
      ['heat', '255, 132, 96'],
      ['cool', '3, 169, 244'],
      ['heat_cool', '0, 150, 136'],
      ['auto', '0, 150, 136'],
      ['off', '130, 150, 176'],
      ['dry', '130, 150, 176'],
      ['fan_only', '130, 150, 176'],
    ])('tints a climate pin in %s mode %s', (mode, tint) => {
      render('desktop-pin-mode', panel('climate', 'compact', `data-state="${mode}"`));
      expect(
        resolvedValue(
          document.querySelector('.desktop-pin-panel-control'),
          '--desktop-pin-tint-rgb'
        )
      ).toBe(tint);
    });

    it('takes an automation that is switched off out of its tint, like a switch', () => {
      render('desktop-pin-mode', panel('action', 'compact', 'data-state="off"'));
      expect(
        resolvedValue(
          document.querySelector('.desktop-pin-panel-control'),
          '--desktop-pin-tint-rgb'
        )
      ).toBe('130, 150, 176');
    });

    it.each([
      ['dark', 'high-contrast opaque-panels'],
      ['light', 'theme-light high-contrast opaque-panels'],
      ['opaque panels alone', 'opaque-panels'],
    ])(
      'leaves the window around a pin clear under the Readable preset (%s), not a square plate',
      (_, preset) => {
        render(`desktop-pin-mode ${preset}`, '<div class="desktop-pin-shell"></div>');
        expect(resolvedValue(document.body, 'background')).toBe('transparent');
        // The rounded shell is what the preset makes solid.
        expect(resolvedValue(document.querySelector('.desktop-pin-shell'), 'background')).not.toBe(
          'transparent'
        );

        render(preset, '');
        expect(resolvedValue(document.body, 'background')).not.toBe('transparent');
      }
    );

    it('gives a light preset chip its whole width, so "100%" clears an outline', () => {
      render(
        'desktop-pin-mode high-contrast opaque-panels',
        `<div class="control-item desktop-pin-control desktop-pin-light-control" data-layout="compact">
          <button class="desktop-pin-light-preset">100%</button></div>`
      );
      const chip = document.querySelector('.desktop-pin-light-preset');
      expect(resolvedValue(chip, 'padding-inline')).toBe('0');
      expect(resolvedValue(chip, 'letter-spacing')).toBe('0');
    });

    it.each(THEME_CASES)('marks the lamp preset at the current level (%s)', (_, theme) => {
      render(
        `desktop-pin-mode ${theme}`,
        `<div class="control-item desktop-pin-control desktop-pin-light-control" data-layout="compact">
          <button class="desktop-pin-light-preset" data-active="true">75%</button>
          <button class="desktop-pin-light-preset" data-active="false">100%</button></div>`
      );
      const [on, off] = document.querySelectorAll('.desktop-pin-light-preset');
      expect(resolvedValue(on, 'border-color')).not.toBe(resolvedValue(off, 'border-color'));
    });

    it('marks the lamp preset at the current level under forced colours', () => {
      render(
        'desktop-pin-mode',
        `<button class="desktop-pin-light-preset" data-active="true">75%</button>`
      );
      expect(
        resolvedValue(document.querySelector('.desktop-pin-light-preset'), 'outline', {
          forcedColors: true,
        })
      ).toBe('2px solid Highlight');
    });

    it('fills the body of an on/off lamp with its state, lit by the lamp', () => {
      render(
        'desktop-pin-mode',
        `<div class="control-item desktop-pin-control desktop-pin-light-control" data-layout="compact"
          data-can-set-brightness="false" data-state="on">
          <div class="desktop-pin-light-shell">
            <div class="desktop-pin-light-topline"></div>
            <div class="desktop-pin-panel-meter desktop-pin-light-state">
              <div class="desktop-pin-light-state-value">On</div></div>
          </div></div>`
      );
      // Two rows: no empty third one adding a gap under the meter.
      expect(
        resolvedValue(document.querySelector('.desktop-pin-light-shell'), 'grid-template-rows')
      ).toBe('auto minmax(0, 1fr)');
      const meter = document.querySelector('.desktop-pin-light-state');
      expect(resolvedValue(meter, 'border-radius')).toBe('12px');
      // Its glow is the lamp's level: full while it is on, none while it is off.
      document
        .querySelector('.desktop-pin-light-control')
        .style.setProperty('--desktop-pin-light-level', '1');
      expect(resolvedValue(meter, '--desktop-pin-progress')).toBe('1');
    });

    // The cascade helper does not match pseudo-elements, so these read the corner rules themselves.
    const pseudoRule = (selector) => {
      let found = null;
      const visit = (rules) => {
        for (const rule of rules) {
          if (rule.cssRules && !rule.selectorText) visit(rule.cssRules);
          else if (rule.selectorText?.replace(/\s+/g, ' ') === selector) found = rule;
        }
      };
      for (const sheet of document.styleSheets) visit(sheet.cssRules);
      return found;
    };

    it.each([
      ['top', 'left'],
      ['top', 'right'],
      ['bottom', 'left'],
      ['bottom', 'right'],
    ])('draws the %s-%s resize mark as a ring inside the rounded corner', (vertical, side) => {
      const rule = pseudoRule(`.desktop-pin-resize-handle-${vertical}-${side}::before`);
      // A triangle filling the corner box was clipped by the window's rounded corner to a sliver.
      expect(rule.style.getPropertyValue('clip-path')).toBe('');
      expect(rule.style.getPropertyValue(`border-${vertical}-${side}-radius`)).toBe('100%');
      expect(rule.style.getPropertyValue(`border-${vertical}-width`)).toBe('3px');
      expect(rule.style.getPropertyValue(`border-${side}-width`)).toBe('3px');
      expect(rule.style.getPropertyValue(vertical)).toBe('var(--desktop-pin-resize-mark-inset)');
      expect(rule.style.getPropertyValue(side)).toBe('var(--desktop-pin-resize-mark-inset)');
    });

    it('keeps the whole resize mark inside the window corner at every handle size', () => {
      render('desktop-pin-mode', '<div class="desktop-pin-shell"></div>');
      const corner = parseFloat(
        resolvedValue(document.querySelector('.desktop-pin-shell'), 'clip-path').match(
          /round\s+([\d.]+)px/
        )[1]
      );
      const handle = pseudoRule('.desktop-pin-resize-handle').style;
      const [smallest, largest] = handle
        .getPropertyValue('--desktop-pin-resize-handle-size')
        .match(/clamp\(([\d.]+)px,.*,\s*([\d.]+)px\)/)
        .slice(1)
        .map(Number);
      // calc(a + (b - size) / k): how far in the mark sits for a handle of a given size.
      const [a, b, k] = handle
        .getPropertyValue('--desktop-pin-resize-mark-inset')
        .match(
          /^calc\(([\d.]+)px \+ \(([\d.]+)px - var\(--desktop-pin-resize-handle-size\)\) \/ ([\d.]+)\)$/
        )
        .slice(1)
        .map(Number);
      const insetFor = (size) => a + (b - size) / k;
      const before = pseudoRule('.desktop-pin-resize-handle::before').style;
      // The border counts in the size, so the ring's outer edge spans exactly inset to size.
      expect(before.getPropertyValue('box-sizing')).toBe('border-box');
      expect(before.getPropertyValue('width')).toBe(
        'calc(var(--desktop-pin-resize-handle-size) - var(--desktop-pin-resize-mark-inset))'
      );
      const ring = parseFloat(
        pseudoRule('.desktop-pin-resize-handle-top-left::before').style.getPropertyValue(
          'border-top-width'
        )
      );
      // The 8px around the pin's buttons, which the ring should not cross where the corner allows.
      const contentPad = 8;
      for (let size = smallest; size <= largest; size += 1) {
        // The ring's outer edge is a quarter circle about (size, size), from the window's corner.
        const inset = insetFor(size);
        const radius = size - inset;
        for (let degrees = 0; degrees <= 90; degrees += 5) {
          const angle = (degrees * Math.PI) / 180;
          const x = size - radius * Math.cos(angle);
          const y = size - radius * Math.sin(angle);
          // Inside the window's rounded corner: within `corner` of the arc's centre.
          expect(Math.hypot(corner - x, corner - y)).toBeLessThanOrEqual(corner + 1e-9);
        }
      }
      // A full-size handle's ring shares the corner's centre, so it runs a steady band just inside
      // the window's edge, outside the content's padding along both sides.
      expect(largest).toBe(corner);
      expect(insetFor(largest) + ring).toBeLessThan(contentPad);
    });

    it('keeps the dark weather palette on a pin in the light theme, where pins stay dark glass', () => {
      const cloud = (bodyClass) => {
        render(
          bodyClass,
          '<div class="desktop-pin-panel-glyph weather-icon weather-icon-cloudy"></div>'
        );
        return resolvedValue(document.querySelector('.weather-icon'), '--weather-cloud-fill');
      };
      expect(cloud('desktop-pin-mode theme-light')).toBe(cloud('desktop-pin-mode'));
      expect(cloud('theme-light')).not.toBe(cloud(''));
      render('desktop-pin-mode', '<div class="desktop-pin-panel-glyph weather-icon"></div>');
      expect(
        resolvedValue(document.querySelector('.weather-icon'), 'width', {
          viewport: { width: 168, height: 148 },
        })
      ).toBe('28px');
    });
  });

  describe('desktop pin text', () => {
    const TEXT_CLASSES = [
      'desktop-pin-panel-name',
      'desktop-pin-panel-status',
      'desktop-pin-panel-caption',
      'desktop-pin-panel-value',
      'desktop-pin-panel-button',
      'desktop-pin-light-name',
      'desktop-pin-light-status',
      'desktop-pin-light-power',
      'desktop-pin-light-meter-value',
      'desktop-pin-light-state-value',
      'desktop-pin-light-preset',
      'desktop-pin-media-title',
      'desktop-pin-media-artist',
      'desktop-pin-scene-name',
    ];
    const TIMER_TEXT_CLASSES = [
      'desktop-pin-timer-badge',
      'desktop-pin-timer-endsat',
      'desktop-pin-timer-readout',
    ];

    it.each(THEME_CASES)('stays readable on the pin window background (%s)', (_, theme) => {
      render(
        `desktop-pin-mode ${theme}`,
        `<div class="desktop-pin-shell"><div class="desktop-pin-content">
          <div class="control-item desktop-pin-control desktop-pin-panel-control">
            ${TEXT_CLASSES.map((name) => `<div class="${name}"></div>`).join('')}
          </div>
          <div class="control-item desktop-pin-control desktop-pin-panel-control desktop-pin-timer-control"
            data-layout="micro" data-urgent="true">
            ${TIMER_TEXT_CLASSES.map((name) => `<div class="${name}"></div>`).join('')}
          </div>
        </div></div>`
      );
      const windowBackground = `rgb(${resolvedValue(document.body, '--window-bg-rgb')})`;

      for (const name of [...TEXT_CLASSES, ...TIMER_TEXT_CLASSES]) {
        const color = resolvedValue(document.querySelector(`.${name}`), 'color');
        expect({ name, contrast: contrastRatio(color, windowBackground) >= 4.5 }).toEqual({
          name,
          contrast: true,
        });
      }
    });
  });

  describe('readable preset', () => {
    const readableThemes = [THEMES['readable dark'], THEMES['readable light']];

    it.each(readableThemes)('keeps the settings title readable (%s)', (theme) => {
      render(
        theme,
        `<div id="settings-modal" class="modal"><div class="modal-content">
          <div class="modal-header"><h2>Settings</h2></div>
        </div></div>`
      );
      const header = document.querySelector('.modal-header');
      const background = resolvedValue(header, 'background');

      expect(isOpaque(background)).toBe(true);
      expect(
        contrastRatio(resolvedValue(header.querySelector('h2'), 'color'), background)
      ).toBeGreaterThanOrEqual(7);
    });

    it.each(readableThemes)('draws slider tracks that stand out from the panels (%s)', (theme) => {
      render(
        theme,
        `<input type="range" class="brightness-slider">
        <input type="range" class="media-volume-slider">
        <input type="range" class="climate-slider">
        <input type="range" class="light-color-temp-slider">`
      );
      const panel = resolvedValue(document.body, '--bg-primary');

      // The track is the accent up to the thumb and grey beyond it (see src/range-progress.js).
      for (const slider of document.querySelectorAll('input:not(.light-color-temp-slider)')) {
        slider.style.setProperty('--range-progress', '40%');
        const track = resolvedValue(slider, 'background')
          .replace(/\s+/g, ' ')
          .match(/^linear-gradient\( ?to right, (#\w+) 40%, (#\w+) 40% ?\)$/);
        expect(track).not.toBeNull();
        expect(contrastRatio(track[1], panel)).toBeGreaterThanOrEqual(3);
        expect(contrastRatio(track[2], panel)).toBeGreaterThanOrEqual(3);
        expect(track[1]).not.toBe(track[2]);
      }
      // The colour temperature scale keeps its warm-to-cool gradient.
      expect(
        resolvedValue(document.querySelector('.light-color-temp-slider'), 'background')
      ).toMatch(/^linear-gradient\(to right, #ffb45f/);
    });

    it('leaves transparent tile buttons alone', () => {
      render(
        THEMES['readable light'],
        `<div class="control-item"><button class="tile-primary-button"></button></div>`
      );

      expect(resolvedValue(document.querySelector('button'), 'background')).toBe('transparent');
    });

    // The transport buttons are round chips now, so they take the readable fill like every other
    // button instead of staying bare glyphs.
    it.each(readableThemes)('draws the media transport as readable buttons (%s)', (theme) => {
      render(
        theme,
        `<div class="media-detail-controls"><button class="btn"></button>
        <button class="btn play-pause-btn"></button></div>`
      );

      for (const button of document.querySelectorAll('button')) {
        expect(isOpaque(resolvedValue(button, 'background'))).toBe(true);
      }
    });
  });

  describe('media dialog transport row', () => {
    it('shrinks to fit the dialog at 150% interface scale', () => {
      render(
        'large-interface',
        `<div class="media-detail-controls">
          <button class="btn media-detail-prev-btn"></button>
          <button class="btn media-detail-seek-btn"></button>
          <button class="btn play-pause-btn media-detail-play-btn"></button>
          <button class="btn media-detail-seek-btn"></button>
          <button class="btn media-detail-next-btn"></button>
        </div>`
      );
      const row = document.querySelector('.media-detail-controls');
      const buttons = [...row.children];
      // A 500px window at 150% is 333 CSS px wide; its media dialog row measures 262px.
      const viewportWidth = 333;
      const rowWidth = 262;
      const gap = resolvedValue(row, 'gap').match(/^min\((\d+)px, (\d+)vw\)$/);
      const minimumGap = Math.min(Number(gap[1]), (Number(gap[2]) / 100) * viewportWidth);
      const minimumButtons = buttons.reduce(
        (total, button) => total + parseFloat(resolvedValue(button, 'min-width')),
        0
      );

      for (const button of buttons) expect(resolvedValue(button, 'flex')).toBe('0 1 auto');
      expect(minimumButtons + minimumGap * (buttons.length - 1)).toBeLessThanOrEqual(rowWidth);
    });
  });

  describe('media dialog seek chips', () => {
    it('grow into pills for a unit longer than a letter, as in "−10 Sek."', () => {
      render(
        '',
        `<div class="media-detail-controls">
          <button class="btn media-detail-seek-btn">\u221210 Sek.</button>
          <button class="btn media-detail-prev-btn"></button>
        </div>`
      );
      const [seek, previous] = document.querySelectorAll('button');

      expect(resolvedValue(seek, 'width')).toBe('auto');
      expect(resolvedValue(seek, 'min-width')).toBe('44px');
      expect(resolvedValue(previous, 'width')).toBe('44px');
    });
  });

  describe('longer translations fit their controls', () => {
    it.each(['cover', 'climate', 'fan'])(
      'sizes the smallest %s pin buttons to their labels, in sentence case',
      (family) => {
        render(
          '',
          `<div class="desktop-pin-panel-control desktop-pin-${family}-control" data-dense-variant="tight" data-layout="compact">
          <div class="desktop-pin-panel-actions">
            <button class="desktop-pin-panel-button"><span class="desktop-pin-panel-button-label">Schließen</span></button>
          </div>
        </div>`
        );
        expect(resolvedValue(document.querySelector('.desktop-pin-panel-actions'), 'display')).toBe(
          'flex'
        );
        const button = document.querySelector('.desktop-pin-panel-button');
        expect(resolvedValue(button, 'flex')).toBe('1 1 auto');
        expect(resolvedValue(button, 'min-width')).toBe('0');
        // Sentence case is every pin button's own; nothing turns it to capitals here.
        expect(resolvedValue(button, 'text-transform') ?? 'none').toBe('none');
        // The label span cuts what the button cannot hold.
        expect(
          resolvedValue(document.querySelector('.desktop-pin-panel-button-label'), 'text-overflow')
        ).toBe('ellipsis');
      }
    );

    it('keeps reorganize-mode pin badges clear of the rename and remove buttons', () => {
      render(
        '',
        `<div id="quick-controls" class="reorganize-mode"><div class="control-item">
          <button class="desktop-pin-quick-toggle" aria-label="Nicht unterstützt"></button>
          <button class="rename-btn"></button><button class="remove-btn"></button>
        </div></div>`
      );
      const badge = document.querySelector('.desktop-pin-quick-toggle');
      // The badge is a 24px pin icon, so no translation can grow it into the rename (24px at
      // 38px from the end) and remove (24px at 8px) buttons.
      expect(resolvedValue(badge, 'width')).toBe('24px');
      expect(resolvedValue(badge, 'height')).toBe('24px');
      expect(resolvedValue(badge, 'padding')).toBe('0');
    });

    it('gives the popup hotkey field a row of its own and the command palette pill one line', () => {
      render(
        '',
        `<div class="popup-hotkey-config"><input id="popup-hotkey-input"></div>
        <span class="command-palette-result-domain">Geräte-Tracker</span>`
      );
      expect(resolvedValue(document.getElementById('popup-hotkey-input'), 'flex')).toBe('1 1 100%');
      expect(
        resolvedValue(document.querySelector('.command-palette-result-domain'), 'white-space')
      ).toBe('nowrap');
    });
  });

  // layoutToasts takes the stack back to where it rests and measures it there at once. Reduced motion
  // gives every transition 0.01ms instead of none, which still starts one, so the stack was measured
  // where it had been moved to and left over the connection panel it was lifted clear of.
  describe('toast stack', () => {
    it('is placed, not moved, so it can be measured where it rests', () => {
      render('', '<div id="toast-container" class="toast-container"></div>');
      const stack = document.getElementById('toast-container');

      expect(resolvedValue(stack, 'transition', { reducedMotion: true })).toBe('none');
      expect(resolvedValue(stack, 'transition')).toBe('none');
    });
  });

  describe('right-to-left languages', () => {
    beforeEach(() => {
      document.documentElement.dir = 'rtl';
    });
    afterEach(() => {
      document.documentElement.removeAttribute('dir');
    });

    it('lets numbers with units and entity names keep their own direction', () => {
      render(
        '',
        `<div class="weather-temp">-24°C</div><span class="detail-value">8 km/h</span>
        <div class="control-name">Outlet 1</div><div class="control-state">مفتوح 50%</div>
        <div class="climate-temp-value-large">21–24°C</div>
        <div class="desktop-pin-panel-kpi">21–24°C</div>
        <span class="desktop-pin-panel-slider-label">5.0 °C</span>
        <div class="control-state control-sensor-readout"><span>15,6</span><span>°C</span></div>`
      );
      for (const selector of [
        '.weather-temp',
        '.detail-value',
        '.control-name',
        '.control-state',
        '.climate-temp-value-large',
        '.desktop-pin-panel-kpi',
        // A range end ("5.0 °C") ends in a Latin letter: without its own direction it printed "C° 5.0".
        '.desktop-pin-panel-slider-label',
      ]) {
        expect(resolvedValue(document.querySelector(selector), 'unicode-bidi')).toBe('plaintext');
      }
      expect(resolvedValue(document.querySelector('.control-sensor-readout'), 'direction')).toBe(
        'ltr'
      );
    });

    it('does not mirror media transport controls', () => {
      render(
        '',
        `<div class="media-detail-controls"><button class="btn media-detail-seek-btn">-10</button></div>
        <div class="media-tile-controls"></div>`
      );
      expect(resolvedValue(document.querySelector('.media-detail-controls'), 'direction')).toBe(
        'ltr'
      );
      expect(resolvedValue(document.querySelector('.media-tile-controls'), 'direction')).toBe(
        'ltr'
      );
    });

    it('puts the switch gap on the label side', () => {
      render(
        '',
        `<div class="form-group"><label><input type="checkbox" checked><span>Label</span></label></div>`
      );
      const toggle = document.querySelector('input');
      expect(resolvedValue(toggle, 'margin-inline-end')).toMatch(/^[\d.]+(rem|px)$/);
      expect(resolvedValue(toggle, 'margin-right')).toBeFalsy();
    });
  });
});

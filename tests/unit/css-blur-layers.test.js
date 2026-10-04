const fs = require('fs');
const path = require('path');
const { loadAppStylesheets, resolvedValue } = require('../helpers/css-cascade.js');

function render(bodyClass, html) {
  document.body.className = bodyClass;
  document.body.innerHTML = html;
}

const blurOf = (element) => resolvedValue(element, 'backdrop-filter');
const isNone = (value) => value === null || value === 'none';

const DIALOG = `
  <div class="modal" id="dialog">
    <div class="modal-content" id="panel">
      <div class="modal-header"><button class="close-btn" id="close"></button></div>
      <div class="modal-body"><button class="btn btn-secondary" id="button"></button></div>
    </div>
  </div>`;

describe('how many blur passes a dialog costs', () => {
  beforeAll(() => {
    loadAppStylesheets(document);
  });

  afterEach(() => {
    document.body.className = '';
    document.body.innerHTML = '';
  });

  describe('in Linux performance mode (also Windows without frosted glass)', () => {
    it('blurs the backdrop once, at the radius every other platform gives it', () => {
      render('linux-performance-mode', DIALOG);

      expect(blurOf(document.getElementById('dialog'))).toBe('blur(8px)');
    });

    it('does not blur again inside it: the panel could only blur the flat scrim', () => {
      render('linux-performance-mode', DIALOG);

      for (const id of ['panel', 'close', 'button']) {
        expect(isNone(blurOf(document.getElementById(id)))).toBe(true);
      }
    });

    it("gives the hotkey recorder's scrim the same blur as every other dialog", () => {
      render('linux-performance-mode', '<div class="hotkey-capture-modal" id="scrim"></div>');

      expect(blurOf(document.getElementById('scrim'))).toBe('blur(8px)');
    });

    it('still strips the blur from the palette, toasts and the main view', () => {
      render(
        'linux-performance-mode',
        `<div class="command-palette-overlay" id="overlay"><div class="command-palette-panel" id="palette"></div></div>
         <div class="toast" id="toast"></div>
         <div class="control-item" id="tile"></div>`
      );

      for (const id of ['overlay', 'palette', 'toast', 'tile']) {
        expect(isNone(blurOf(document.getElementById(id)))).toBe(true);
      }
    });

    it("holds the playing button's glow still instead of repainting a filter every frame", () => {
      render(
        'linux-performance-mode',
        `<button class="play-pause-btn playing" id="playing"></button>
         <div class="media-player-entity" data-media-playing="true"><button class="play-pause-btn" id="card"></button></div>`
      );

      for (const id of ['playing', 'card']) {
        expect(resolvedValue(document.getElementById(id), 'animation')).toBe('none');
      }
      expect(resolvedValue(document.getElementById('playing'), 'filter')).toMatch(/drop-shadow/);
    });

    it("lets the playing button's glow pulse everywhere else", () => {
      render('', '<button class="play-pause-btn playing" id="playing"></button>');

      expect(resolvedValue(document.getElementById('playing'), 'animation')).toMatch(/iconGlow/);
    });
  });

  describe('outside performance mode', () => {
    it('leaves the dialog recipe as it was', () => {
      render('', DIALOG);

      expect(blurOf(document.getElementById('dialog'))).toBe('blur(8px)');
      expect(blurOf(document.getElementById('panel'))).toMatch(/^blur\(24px\)/);
    });
  });

  describe('the Settings dialog', () => {
    const SETTINGS = `
      <div class="modal" id="settings-modal">
        <div class="modal-content">
          <div class="modal-header" id="header"></div>
          <div class="modal-tabs" id="rail"></div>
          <div class="modal-body"></div>
        </div>
      </div>`;

    it.each(['', 'theme-light', 'frosted-glass', 'linux-performance-mode'])(
      'draws its header and its rail without a blur of their own (%s)',
      (theme) => {
        render(theme, SETTINGS);

        // They sit inside the dialog's blurred pane: a blur of their own smeared the holiday art
        // behind them and cut it at the divider.
        expect(isNone(blurOf(document.getElementById('header')))).toBe(true);
        expect(isNone(blurOf(document.getElementById('rail')))).toBe(true);
      }
    );
  });

  describe('holiday art in the Settings dialog', () => {
    // The cascade helper does not match pseudo-elements, so this reads the stylesheet itself.
    const css = fs.readFileSync(path.resolve(__dirname, '../../styles.css'), 'utf8');

    it('hangs from the header line instead of lying behind the Close button', () => {
      // Without the header's blur the corner art is crisp. A grid-placed absolute box is
      // positioned in its grid area, so the body cell's top corner is under the header.
      expect(css).toMatch(
        /body\[data-season\] #settings-modal \.modal-content::before\s*\{\s*grid-area:\s*body;\s*\}/
      );
      expect(css).toMatch(/#settings-modal \.modal-content \{[^}]*grid-template:[^;]*'nav body'/);
    });
  });

  describe('edit mode', () => {
    it('draws the pin, rename and remove chips as plain near-opaque circles', () => {
      render(
        '',
        `<div id="quick-controls" class="reorganize-mode"><div class="control-item">
          <button class="remove-btn" id="remove"></button>
          <button class="rename-btn" id="rename"></button>
          <button class="desktop-pin-quick-toggle" id="pin"></button>
        </div></div>`
      );

      for (const id of ['remove', 'rename', 'pin']) {
        expect(isNone(blurOf(document.getElementById(id)))).toBe(true);
      }
    });
  });
});

describe('dialog and tooltip motion', () => {
  beforeAll(() => {
    loadAppStylesheets(document);
  });

  afterEach(() => {
    document.body.className = '';
    document.body.innerHTML = '';
  });

  it("fades the hotkey recorder's scrim in like every other dialog", () => {
    render('', '<div class="hotkey-capture-modal" id="scrim"></div>');

    expect(resolvedValue(document.getElementById('scrim'), 'animation')).toMatch(/^modalFadeIn /);
    // And the same entrance as a .modal, so the two do not differ.
    render('', '<div class="modal" id="dialog"></div>');
    expect(resolvedValue(document.getElementById('dialog'), 'animation')).toMatch(/^modalFadeIn /);
  });

  it('moves the colour swatch tooltip only by fading and lifting, not from the window corner', () => {
    render('', '<div class="theme-tooltip-flyout" id="tip"></div>');

    const transition = resolvedValue(document.getElementById('tip'), 'transition');

    expect(transition).toMatch(/opacity/);
    expect(transition).toMatch(/transform/);
    // The tooltip is placed with top and left; animating them flew it in from (0, 0).
    expect(transition).not.toMatch(/\ball\b|\btop\b|\bleft\b/);
  });
});

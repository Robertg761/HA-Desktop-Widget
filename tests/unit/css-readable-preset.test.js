const {
  cascadedDeclaration,
  contrastRatio,
  loadAppStylesheets,
  parseColor,
  resolvedValue,
} = require('../helpers/css-cascade.js');

function render(bodyClass, html) {
  document.body.className = bodyClass;
  document.body.innerHTML = html;
}

describe('the Readable preset', () => {
  beforeAll(() => {
    loadAppStylesheets(document);
  });

  afterEach(() => {
    document.body.className = '';
    document.body.innerHTML = '';
  });

  // The theme class never carries light into the preset (applyTheme leaves theme-dark), but a
  // light class that reaches the body some other way must not paint a light scrim or panel.
  it.each([
    ['dark', 'high-contrast opaque-panels'],
    ['light', 'theme-light high-contrast opaque-panels'],
  ])('draws dialog edges and the backdrop from its own tokens (%s)', (_, bodyClass) => {
    render(bodyClass, '<div class="modal"></div>');
    expect(resolvedValue(document.body, '--dialog-border')).toBe('#aaa');
    expect(resolvedValue(document.body, '--dialog-scrim')).toBe('rgba(8, 10, 14, 0.7)');
    expect(parseColor(resolvedValue(document.body, '--window-highlight'))[3]).toBeLessThan(0.2);
    expect(resolvedValue(document.body, 'color-scheme')).toBe('dark');
  });

  it.each([
    ['dark', 'high-contrast opaque-panels'],
    ['opaque panels alone', 'opaque-panels'],
  ])('paints toasts, menus and the command palette opaque (%s)', (_, bodyClass) => {
    render(bodyClass, '<div class="toast"></div>');
    expect(parseColor(resolvedValue(document.body, '--dialog-bg'))[3]).toBe(1);
    expect(parseColor(resolvedValue(document.querySelector('.toast'), 'background'))[3]).toBe(1);
  });

  // A warm chosen or holiday accent halves a lit tile's wash so it is never stronger than a tile
  // that needs attention. The preset draws its own blue accent instead, which no one takes for an
  // alarm, and with Christmas a lit tile's wash was half as strong for nothing.
  it('keeps the whole lit wash under a warm accent', () => {
    const wash = (bodyClass, warm) => {
      render(bodyClass, '');
      if (warm) document.body.dataset.accentWarm = 'true';
      else delete document.body.dataset.accentWarm;
      return resolvedValue(document.body, '--dash-tile-wash');
    };
    try {
      // Without the preset a warm accent takes the lighter wash.
      expect(wash('', true)).toBe(resolvedValue(document.body, '--dash-tile-wash-warm'));
      expect(wash('', true)).not.toBe(wash('', false));
      expect(wash('high-contrast opaque-panels', true)).toBe(
        wash('high-contrast opaque-panels', false)
      );
    } finally {
      delete document.body.dataset.accentWarm;
    }
  });

  // The light, fan, cover, climate and media pop-ups open with focus on their heading. The preset's
  // ring is !important, so it boxed the title of every pop-up like a field.
  it('draws no focus ring around a pop-up heading that took focus as the pop-up opened', () => {
    render(
      'high-contrast opaque-panels',
      `<div class="modal"><div class="modal-header">
        <h2 tabindex="-1" data-focus-visible>Desk lamp</h2>
        <button class="close-btn" data-focus-visible></button>
      </div></div>`
    );
    expect(resolvedValue(document.querySelector('h2'), 'outline')).toBe('none');
    // A control in the same header keeps the preset's ring.
    expect(resolvedValue(document.querySelector('.close-btn'), 'outline')).toBe('3px solid #fff');
  });

  // The media card's track is a button drawn as text. The preset's grey button fill made it a
  // square slab behind the title, flush against the words.
  it('keeps the media card track drawn as text, at rest and under the pointer', () => {
    render(
      'high-contrast opaque-panels',
      `<div class="media-tile"><button class="media-tile-info" id="media-tile-info"></button>
        <button class="media-tile-btn"></button></div>`
    );
    const track = document.querySelector('.media-tile-info');
    expect(resolvedValue(track, 'background')).toBe('transparent');
    track.setAttribute('data-hover', '');
    expect(resolvedValue(track, 'background')).toBe('transparent');
    // The card's other buttons keep the preset's fill.
    expect(resolvedValue(document.querySelector('.media-tile-btn'), 'background')).toBe('#202020');
  });

  it('leaves them translucent for the glass themes', () => {
    render('', '<div class="toast"></div>');
    expect(resolvedValue(document.body, '--dialog-bg')).toContain('transparent');
  });

  it('marks the selected theme mode, which the grey button fill used to flatten', () => {
    render(
      'high-contrast',
      `<div class="segmented-control">
        <button class="segmented-option active">Dark</button>
        <button class="segmented-option">Light</button>
      </div>`
    );
    const [selected, other] = document.querySelectorAll('.segmented-option');
    expect(resolvedValue(selected, 'background')).toBe('#8ed1ff');
    expect(resolvedValue(other, 'background')).toBe('#202020');
  });

  it.each([
    '<button class="climate-mode-btn active"></button>',
    '<button class="climate-fan-mode-btn active"></button>',
    '<button class="climate-preset-mode-btn active"></button>',
    '<button class="media-mute-toggle active"></button>',
    '<button class="donate-amount-chip selected"></button>',
    // The lamp and fan pop-ups' current preset looked like the others.
    '<button class="brightness-preset-btn active"></button>',
    '<button class="fan-preset-btn active"></button>',
  ])('keeps an accent edge on a selected chip: %s', (html) => {
    render('high-contrast opaque-panels', html);
    const chip = document.querySelector('button');
    expect(resolvedValue(chip, 'border-color')).toBe('#8ed1ff');
    chip.className = chip.className.replace(/ ?(active|selected)/, '');
    expect(resolvedValue(chip, 'border-color')).toBe('#aaa');
  });

  it.each([
    '<button class="theme-option selected"></button>',
    '<button class="color-target-option active"></button>',
    '<button class="section-btn reorganize-active"></button>',
    '<button class="desktop-pin-panel-button" data-active="true"></button>',
    '<button class="desktop-pin-power desktop-pin-light-power" data-active="true"></button>',
  ])('keeps an accent edge on the selected or on button: %s', (html) => {
    render('high-contrast opaque-panels', html);
    const button = document.querySelector('button');
    expect(resolvedValue(button, 'border-color')).toBe('#8ed1ff');
    expect(resolvedValue(button, 'box-shadow')).toBe('inset 0 0 0 2px #8ed1ff');
    button.removeAttribute('data-active');
    button.className = button.className.replace(/ ?(active|selected|reorganize-active)/, '');
    expect(resolvedValue(button, 'border-color')).toBe('#aaa');
  });

  // The grey fill is !important and used to hide each button's own hover colour.
  it('lightens a hovered button and leaves the primary action, disabled buttons and tabs alone', () => {
    render(
      'high-contrast opaque-panels',
      `<div id="settings-modal">
        <button class="btn btn-secondary" data-hover>Cancel</button>
        <button class="btn btn-primary" data-hover>Save</button>
        <button class="btn btn-secondary" data-hover disabled>Off</button>
        <button class="btn btn-secondary" data-hover aria-disabled="true">Unavailable</button>
        <button class="tab-link" data-hover>Tab</button>
        <select data-hover></select>
      </div>
      <div class="control-item"><button class="tile-primary-button" data-hover></button></div>`
    );
    const [cancel, primary, disabled, ariaDisabled, tab, tile] =
      document.querySelectorAll('button');
    expect(resolvedValue(cancel, 'background')).toBe('#333');
    expect(resolvedValue(cancel, 'border-color')).toBe('#fff');
    expect(resolvedValue(document.querySelector('select'), 'background')).toBe('#333');
    expect(resolvedValue(primary, 'background')).toBe('#8ed1ff');
    expect(resolvedValue(disabled, 'background')).toBe('#202020');
    expect(resolvedValue(ariaDisabled, 'background')).toBe('#202020');
    expect(cascadedDeclaration(tab, 'background').important).toBe(false);
    // The tile's overlay button covers the whole tile, so a fill would hide the tile's text.
    expect(resolvedValue(tile, 'background')).toBe('transparent');
  });

  it('gives the icon buttons that draw no edge of their own one', () => {
    render(
      'high-contrast opaque-panels',
      '<button class="media-tile-btn"></button><button class="section-btn"></button>'
    );
    for (const button of document.querySelectorAll('button')) {
      expect(resolvedValue(button, 'border')).toBe('1px solid #aaa');
      expect(resolvedValue(button, 'border-color')).toBe('#aaa');
    }
  });

  it('tells an on switch from an off one by its track', () => {
    render(
      'high-contrast opaque-panels',
      `<div id="settings-modal"><div class="form-group">
        <input type="checkbox" checked><input type="checkbox">
      </div></div>`
    );
    const [on, off] = document.querySelectorAll('input');
    expect(resolvedValue(on, 'background')).toBe('#8ed1ff');
    expect(resolvedValue(off, 'background')).toBe('#202020');
    expect(contrastRatio(resolvedValue(on, 'background'), '#202020')).toBeGreaterThanOrEqual(3);
    expect(resolvedValue(on, 'border-color')).toBe('#fff');
  });

  describe('lit tiles and timers', () => {
    const TILES = `<div id="quick-controls">
      <div class="control-item" data-active="true" id="lit"></div>
      <div class="control-item" id="idle"></div>
      <div class="control-item timer-entity" data-state="active" id="running"></div>
      <div class="control-item timer-entity" data-state="paused" id="paused"></div>
    </div>`;

    it('draws an accent edge two pixels wide on an on tile and not on an idle one', () => {
      render('active-tile-glow high-contrast opaque-panels', TILES);
      const lit = document.querySelector('#lit');
      expect(resolvedValue(lit, 'border-color')).toBe('#8ed1ff');
      expect(resolvedValue(lit, 'outline')).toBe('2px solid #8ed1ff');
      expect(resolvedValue(lit, 'outline-offset')).toBe('-2px');
      expect(resolvedValue(document.querySelector('#idle'), 'outline')).toBeNull();
    });

    it('draws a running timer solid and a paused one dashed in the timer colours', () => {
      render('high-contrast opaque-panels', TILES);
      const [running, paused] = ['#running', '#paused'].map((id) => document.querySelector(id));
      expect(resolvedValue(running, 'outline')).toBe('2px solid rgb(129, 199, 132)');
      expect(resolvedValue(paused, 'outline')).toBe('2px dashed rgb(255, 183, 77)');
      expect(resolvedValue(running, 'border-color')).toBe('rgb(129, 199, 132)');
    });

    it('keeps the focus ring on a lit tile or timer that holds keyboard focus itself', () => {
      render('active-tile-glow high-contrast opaque-panels', TILES);
      for (const id of ['#lit', '#running', '#paused']) {
        document.querySelector(id).setAttribute('data-focus-visible', '');
      }
      const [lit, running, paused] = ['#lit', '#running', '#paused'].map((id) =>
        document.querySelector(id)
      );
      for (const tile of [lit, running, paused]) {
        expect(resolvedValue(tile, 'outline')).toBe('3px solid #fff');
        expect(resolvedValue(tile, 'outline-offset')).toBe('2px');
      }
      // The on state stays readable from the edge and the fill while the outline is the ring.
      expect(resolvedValue(lit, 'border-color')).toBe('#8ed1ff');
      expect(resolvedValue(running, 'border-color')).toBe('rgb(129, 199, 132)');
    });

    it('leaves the tiles to forced colours, which outline them in Highlight', () => {
      render('active-tile-glow high-contrast opaque-panels', TILES);
      const lit = document.querySelector('#lit');
      expect(resolvedValue(lit, 'outline', { forcedColors: true })).toBe('2px solid Highlight');
    });
  });

  // The rows the preset replaces are dimmed, and the preset promises 7:1 for text.
  it('dims the rows it replaces without taking their text under 7:1', () => {
    render(
      'high-contrast opaque-panels',
      '<div id="settings-modal"><div class="settings-group is-overridden"></div></div>'
    );
    const opacity = Number(resolvedValue(document.querySelector('.is-overridden'), 'opacity'));
    expect(opacity).toBeLessThan(1);
    for (const token of [
      '--text-primary',
      '--text-secondary',
      '--text-tertiary',
      '--text-dim',
      '--text-faint',
      '--muted-text',
    ]) {
      const [r, g, b] = parseColor(resolvedValue(document.body, token));
      for (const surface of ['--bg-primary', '--bg-elevated']) {
        const dimmed = `rgba(${r}, ${g}, ${b}, ${opacity})`;
        const ratio = contrastRatio(dimmed, resolvedValue(document.body, surface));
        expect({ token, surface, enough: ratio >= 7 }).toEqual({ token, surface, enough: true });
      }
    }
  });

  it('gives the active Settings page a 2px accent edge on the sliding pill', () => {
    render(
      'high-contrast',
      `<div id="settings-modal"><div class="modal-tabs has-sliding-indicator">
        <span class="sliding-indicator"></span><button class="tab-link active"></button>
      </div></div>`
    );
    const pill = document.querySelector('.sliding-indicator');
    expect(resolvedValue(pill, 'box-shadow')).toBe(
      'inset 0 0 0 2px var(--accent)'.replace('var(--accent)', '#8ed1ff')
    );
  });
});

const { loadAppStylesheets, parseColor, resolvedValue } = require('../helpers/css-cascade.js');

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
  ])('keeps an accent edge on a selected chip: %s', (html) => {
    render('high-contrast opaque-panels', html);
    const chip = document.querySelector('button');
    expect(resolvedValue(chip, 'border-color')).toBe('#8ed1ff');
    chip.className = chip.className.replace(/ ?(active|selected)/, '');
    expect(resolvedValue(chip, 'border-color')).toBe('#aaa');
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

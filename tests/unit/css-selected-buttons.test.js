const { contrastRatio, loadAppStylesheets, resolvedValue } = require('../helpers/css-cascade.js');

const THEMES = {
  dark: '',
  light: 'theme-light',
  'frosted dark': 'frosted-glass',
  'frosted light': 'theme-light frosted-glass',
  'readable dark': 'high-contrast opaque-panels',
  'readable light': 'theme-light high-contrast opaque-panels',
};
const READABLE_THEMES = Object.entries(THEMES).filter(([name]) => name.startsWith('readable'));

const PICKER_ROW = `
  <div id="settings-modal"><div class="personalization-section" id="primary-cards-section">
    <div class="primary-cards-list-actions">
      <button class="btn btn-primary btn-sm" data-primary-assign="0" aria-disabled="true">Card 1 ✓</button>
      <button class="btn btn-secondary btn-sm" data-primary-assign="1">Set Card 2</button>
    </div>
    <div class="primary-cards-list-actions primary-cards-pagination">
      <button class="btn btn-secondary btn-sm" data-primary-page="previous" aria-disabled="true">Previous</button>
    </div>
  </div></div>`;

function render(bodyClass, html) {
  document.body.className = bodyClass;
  document.body.innerHTML = html;
}

describe('selected and text-like buttons', () => {
  beforeAll(() => {
    loadAppStylesheets(document);
  });

  afterEach(() => {
    document.body.className = '';
    document.body.innerHTML = '';
  });

  it.each(Object.entries(THEMES))(
    'keeps the picked Primary Cards button at full strength and dims only unavailable ones (%s)',
    (_, theme) => {
      render(theme, PICKER_ROW);
      const [selected, other] = document.querySelectorAll('[data-primary-assign]');
      expect(resolvedValue(selected, 'opacity')).toBe('1');
      expect(resolvedValue(other, 'opacity')).toBeNull();
      expect(resolvedValue(document.querySelector('[data-primary-page]'), 'opacity')).toBe('0.7');
    }
  );

  it.each(READABLE_THEMES)(
    'fills the selected button so it stands out from unselected ones (%s)',
    (_, theme) => {
      render(theme, PICKER_ROW);
      const [selected, other] = document.querySelectorAll('[data-primary-assign]');
      const selectedFill = resolvedValue(selected, 'background');
      expect(selectedFill).toBe('#8ed1ff');
      expect(resolvedValue(other, 'background')).toBe('#202020');
      expect(contrastRatio(resolvedValue(selected, 'color'), selectedFill)).toBeGreaterThanOrEqual(
        7
      );
      expect(contrastRatio(selectedFill, '#202020')).toBeGreaterThanOrEqual(3);
    }
  );

  it.each(READABLE_THEMES)(
    'leaves section headers and tabs unfilled with visible focus and hover (%s)',
    (_, theme) => {
      render(
        theme,
        `<div id="settings-modal">
          <nav><button class="tab-link active">Personalization</button>
            <button class="tab-link" data-hover>Hotkeys</button>
            <button class="tab-link" data-focus-visible>Alerts</button></nav>
          <div class="personalization-section">
            <button class="section-toggle" data-focus-visible>Color Themes</button>
          </div>
        </div>
        <div class="quick-access-tabs"><button class="tab-link active">Kitchen</button></div>`
      );
      const toggle = document.querySelector('.section-toggle');
      expect(resolvedValue(toggle, 'background')).toBe('transparent');
      expect(resolvedValue(toggle, 'outline')).toMatch(/^3px solid #fff/);

      const [active, hovered, focused] = document.querySelectorAll('#settings-modal .tab-link');
      expect(resolvedValue(focused, 'background')).toBe('none');
      expect(resolvedValue(focused, 'outline')).toMatch(/^3px solid #fff/);
      expect(resolvedValue(hovered, 'border-color')).toBe('#fff');
      expect(resolvedValue(active, 'border-color')).toBe('#8ed1ff');
      expect(
        resolvedValue(document.querySelector('.quick-access-tabs .tab-link'), 'border-color')
      ).toBe('#8ed1ff');
    }
  );
});

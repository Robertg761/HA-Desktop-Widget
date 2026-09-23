const {
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

  describe('hidden rows in workflow pick lists', () => {
    it('hides device rows filtered out by the starter search', () => {
      render(
        '',
        `<div class="form-group room-dashboard">
          <div class="room-entity-list">
            <label hidden><input type="checkbox" value="light.desk">Desk</label>
            <label><input type="checkbox" value="sensor.temp">Temperature</label>
          </div>
        </div>`
      );

      const [hidden, shown] = document.querySelectorAll('.room-entity-list > label');
      expect(resolvedValue(hidden, 'display')).toBe('none');
      expect(resolvedValue(shown, 'display')).toBe('flex');
    });

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
});

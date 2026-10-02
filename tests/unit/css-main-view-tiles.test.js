const {
  cascadedDeclaration,
  loadAppStylesheets,
  parseColor,
  resolvedValue,
} = require('../helpers/css-cascade.js');

// Each case is a body class list. Dark solid is a Windows panel without acrylic; frosted is
// Windows 11 acrylic, macOS vibrancy and the Linux tint.
const MODES = {
  'dark solid': '',
  'light solid': 'theme-light',
  'dark glass': 'frosted-glass',
  'light glass': 'theme-light frosted-glass',
};
const MODE_CASES = Object.entries(MODES);

const MAIN_VIEW_MARKUP = `
  <div class="widget-header"><div class="drag-area"></div></div>
  <div class="widget-content">
    <div class="status-grid">
      <div class="status-card weather-card"></div>
      <div class="status-card time-card"></div>
    </div>
    <div class="media-tile"><div class="media-tile-seek-bar"></div></div>
    <div class="quick-access-tabs"></div>
    <div id="quick-controls"><div class="control-item"><span class="control-state"></span></div></div>
  </div>
  <div id="settings-modal"><div class="modal-content"><div class="settings-card"></div></div></div>`;

const MAIN_VIEW_TILES = [
  '.status-grid',
  '.status-card',
  '.media-tile',
  '#quick-controls .control-item',
];

function render(bodyClass, html = MAIN_VIEW_MARKUP) {
  document.body.className = bodyClass;
  document.body.innerHTML = html;
}

/** How opaque a --tile-bg value is: an rgba() alpha or the last mix percentage over transparent. */
function opacityOf(value) {
  const mixed = value.match(/(\d+)%,\s*transparent\s*\)$/);
  return mixed ? Number(mixed[1]) / 100 : parseColor(value)[3];
}

describe('main view tiles', () => {
  beforeAll(() => {
    loadAppStylesheets(document);
  });

  afterEach(() => {
    document.body.className = '';
    document.body.removeAttribute('style');
    document.body.removeAttribute('data-season');
    document.body.innerHTML = '';
  });

  describe('fill and edge', () => {
    it.each(MODE_CASES)('read as blocks apart from the panel (%s)', (_, bodyClass) => {
      render(bodyClass);
      const dark = !bodyClass.includes('theme-light');
      // The soft values the header, Settings and dialogs keep.
      const soft = resolvedValue(document.body, '--tile-bg');

      for (const selector of MAIN_VIEW_TILES) {
        const element = document.querySelector(selector);
        const fill = resolvedValue(element, '--tile-bg');
        expect(fill).toBe(resolvedValue(document.body, '--dash-tile-bg'));
        expect(fill).not.toBe(soft);
        // A wash of a few percent is what disappeared into the panel.
        expect(opacityOf(fill)).toBeGreaterThanOrEqual(0.85);
        expect(resolvedValue(element, '--tile-bg-hover')).toBe(
          resolvedValue(document.body, '--dash-tile-bg-hover')
        );
        const edge = parseColor(resolvedValue(element, '--tile-border'));
        expect(edge[3]).toBeGreaterThanOrEqual(dark ? 0.18 : 0.26);
        expect(parseColor(resolvedValue(element, '--tile-border-hover'))[3]).toBeGreaterThan(
          edge[3]
        );
      }
    });

    it('keeps the glass tile as opaque as the solid one on a dark panel', () => {
      render('frosted-glass');
      expect(opacityOf(resolvedValue(document.querySelector('.status-card'), '--tile-bg'))).toBe(
        0.94
      );
    });

    it('gives the tab pill the same edge as the tiles it sits above', () => {
      render('');
      expect(resolvedValue(document.querySelector('.quick-access-tabs'), '--tile-border')).toBe(
        resolvedValue(document.querySelector('.status-card'), '--tile-border')
      );
    });

    it.each(MODE_CASES)(
      'leave the header, Settings and dialogs on the soft values (%s)',
      (_, bodyClass) => {
        render(bodyClass);
        for (const token of [
          '--tile-bg',
          '--tile-bg-hover',
          '--tile-border',
          '--tile-border-hover',
        ]) {
          const soft = resolvedValue(document.body, token);
          for (const selector of [
            '.widget-header',
            '.settings-card',
            '#settings-modal .modal-content',
          ]) {
            expect(resolvedValue(document.querySelector(selector), token)).toBe(soft);
          }
        }
      }
    );

    it.each([
      ['dark', 'high-contrast'],
      ['light', 'theme-light high-contrast'],
      ['readable', 'high-contrast opaque-panels'],
    ])('keep the readable preset its own tile tokens (%s)', (_, bodyClass) => {
      render(bodyClass);
      for (const selector of MAIN_VIEW_TILES) {
        const element = document.querySelector(selector);
        expect(resolvedValue(element, '--tile-bg')).toBe('#202020');
        expect(resolvedValue(element, '--tile-border')).toBe('#aaa');
      }
    });
  });

  describe('tile states', () => {
    const statesMarkup = `<div id="quick-controls">
      <div class="control-item" data-active="true"></div>
      <div class="control-item timer-entity" data-state="active"></div>
    </div>`;

    it.each(MODE_CASES)(
      'lay an active tile and a running timer on the tile fill, not on the panel (%s)',
      (_, bodyClass) => {
        render(`active-tile-glow ${bodyClass}`, statesMarkup);
        const [active, timer] = document.querySelectorAll('.control-item');
        const fill = resolvedValue(active, '--tile-bg');

        expect(fill).toBe(resolvedValue(document.body, '--dash-tile-bg'));
        expect(resolvedValue(active, 'background-color')).toContain(fill);
        expect(resolvedValue(timer, 'background-color')).toContain(fill);
      }
    );

    it('keeps the readable preset active tile and timer as they were', () => {
      render('high-contrast active-tile-glow', statesMarkup);
      const [active, timer] = document.querySelectorAll('.control-item');

      expect(resolvedValue(active, 'background-color')).toMatch(/, 0\.26\)$/);
      expect(resolvedValue(timer, 'background-color')).toMatch(/, 0\.12\)$/);
    });
  });

  describe('opaque panels', () => {
    it.each([
      ['dark', 'opaque-panels'],
      ['light', 'theme-light opaque-panels'],
    ])('lift the tiles off the panel they used to match (%s)', (_, bodyClass) => {
      render(bodyClass);
      const panel = resolvedValue(document.body, '--bg-primary');

      for (const selector of ['.status-card', '.media-tile', '#quick-controls .control-item']) {
        const declaration = cascadedDeclaration(document.querySelector(selector), 'background');
        expect(declaration.important).toBe(true);
        expect(declaration.value).toMatch(
          /^color-mix\(in srgb, var\(--bg-primary\), white \d+%\)$/
        );
      }
      expect(panel).toBeTruthy();
    });
  });
});

describe('panel veil', () => {
  beforeAll(() => {
    loadAppStylesheets(document);
  });

  afterEach(() => {
    document.body.className = '';
    document.body.removeAttribute('style');
    document.body.removeAttribute('data-season');
    document.body.innerHTML = '';
  });

  it.each([
    ['dark solid', '', '0.3'],
    ['light solid', 'theme-light', '0.09'],
    ['dark glass', 'frosted-glass', '0.06'],
    ['light glass', 'theme-light frosted-glass', '0.05'],
  ])('is set for each theme and glass mode (%s)', (_, bodyClass, strength) => {
    render(bodyClass);
    expect(resolvedValue(document.body, '--panel-veil')).toBe(strength);
  });

  it('fades with the window opacity, so a lower opacity still gets more transparent', () => {
    render('');
    document.body.style.setProperty('--window-bg-alpha', '0.5');
    expect(resolvedValue(document.body, '--panel-veil-color')).toBe(
      'rgba(0, 0, 0, calc(0.3 * 0.5))'
    );
  });

  it.each([
    ['the readable preset', 'high-contrast'],
    ['opaque panels', 'opaque-panels'],
    ['a pinned desktop tile', 'desktop-pin-mode'],
  ])('is not painted for %s', (_, bodyClass) => {
    render(bodyClass);
    expect(resolvedValue(document.body, '--panel-veil-layer')).toBe('none');
  });

  it('is a layer for an ordinary window', () => {
    render('');
    expect(resolvedValue(document.body, '--panel-veil-layer')).toMatch(/^linear-gradient\(/);
  });

  it('is painted over the solid panel by the header and content', () => {
    render('');
    for (const selector of ['.widget-header', '.widget-content']) {
      const declaration = cascadedDeclaration(document.querySelector(selector), 'background');
      expect(declaration.value).toMatch(/^var\(--panel-veil-layer\),\s+rgba\(/);
      expect(declaration.important).toBe(true);
    }
    expect(cascadedDeclaration(document.body, 'background').value).not.toContain('--panel-veil');
  });

  it('is painted over glass by the header and content, never the body', () => {
    for (const bodyClass of [
      'frosted-glass',
      'native-glass frosted-glass',
      'software-glass frosted-glass',
    ]) {
      render(bodyClass);
      for (const selector of ['.widget-header', '.widget-content']) {
        expect(cascadedDeclaration(document.querySelector(selector), 'background').value).toBe(
          'var(--panel-veil-layer)'
        );
      }
      // Dialogs show the body through their own glass, so it must stay as it was.
      expect(cascadedDeclaration(document.body, 'background').value).not.toContain('--panel-veil');
    }
  });

  it('goes on the body once during a holiday, when the header and content are transparent', () => {
    render('');
    document.body.setAttribute('data-season', 'christmas');

    expect(cascadedDeclaration(document.body, 'background').value).toMatch(
      /^var\(--panel-veil-layer\),\s+rgba\(/
    );
    for (const selector of ['.widget-header', '.widget-content']) {
      expect(cascadedDeclaration(document.querySelector(selector), 'background').value).toBe(
        'transparent'
      );
    }
  });
});

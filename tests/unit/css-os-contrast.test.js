const fs = require('fs');
const path = require('path');
const { contrastRatio, loadAppStylesheets, resolvedValue } = require('../helpers/css-cascade.js');

const STYLES = fs.readFileSync(path.resolve(__dirname, '../../styles.css'), 'utf8');

function render(bodyClass, html) {
  document.body.className = bodyClass;
  document.body.innerHTML = html;
}

describe('the OS contrast preference', () => {
  beforeAll(() => {
    loadAppStylesheets(document);
  });

  afterEach(() => {
    document.body.className = '';
    document.body.innerHTML = '';
  });

  it('asks for "more", the value the media query knows, and not "high"', () => {
    expect(STYLES).not.toMatch(/prefers-contrast:\s*high/);
    expect(STYLES).toMatch(/@media \(prefers-contrast: more\)/);
  });

  it('leaves the borders to forced colours when a contrast theme reports it too', () => {
    render('', '<div id="quick-controls"><div class="control-item"></div></div>');
    const both = { prefersContrast: 'more', forcedColors: true };
    expect(resolvedValue(document.body, '--border-color', both)).not.toBe(
      'rgba(255, 255, 255, 0.4)'
    );
    expect(resolvedValue(document.querySelector('.control-item'), 'border-width', both)).toBeNull();
  });

  it.each([
    ['dark', '', 'rgba(255, 255, 255, 0.4)'],
    ['light', 'theme-light', 'rgba(0, 0, 0, 0.5)'],
  ])('strengthens the %s theme borders, tiles included', (_, bodyClass, border) => {
    render(bodyClass, '<div id="quick-controls"><div class="control-item"></div></div>');
    const more = { prefersContrast: 'more' };
    expect(resolvedValue(document.body, '--border-color')).not.toBe(border);
    expect(resolvedValue(document.body, '--border-color', more)).toBe(border);
    expect(resolvedValue(document.body, '--tile-border', more)).toBe(border);
    expect(resolvedValue(document.querySelector('.control-item'), 'border-width', more)).toBe(
      '2px'
    );
  });
});

describe('scrollbar thumbs', () => {
  beforeAll(() => {
    loadAppStylesheets(document);
  });

  afterEach(() => {
    document.body.className = '';
    document.body.innerHTML = '';
  });

  // A hairline border colour was about 1.3:1 against the panel, the only cue that more is below.
  it.each([
    ['dark', ''],
    ['light', 'theme-light'],
  ])('draw in the text colour and reach 3:1 against the %s window', (_, bodyClass) => {
    render(bodyClass, '');
    const window = `rgb(${resolvedValue(document.body, '--window-bg-rgb')})`;
    expect(
      contrastRatio(resolvedValue(document.body, '--scrollbar-thumb'), window)
    ).toBeGreaterThan(3);
    expect(
      contrastRatio(resolvedValue(document.body, '--scrollbar-thumb-hover'), window)
    ).toBeGreaterThan(contrastRatio(resolvedValue(document.body, '--scrollbar-thumb'), window));
  });

  it('use that colour on every custom scrollbar', () => {
    for (const selector of [
      '::-webkit-scrollbar-thumb',
      '.modal-body::-webkit-scrollbar-thumb',
      '.custom-dropdown-menu::-webkit-scrollbar-thumb',
    ]) {
      const rule = STYLES.match(
        new RegExp(`\\n${selector.replace(/[.:]/g, '\\$&')} \\{([^}]*)\\}`)
      );
      expect(rule && rule[1]).toContain('background: var(--scrollbar-thumb)');
    }
  });
});

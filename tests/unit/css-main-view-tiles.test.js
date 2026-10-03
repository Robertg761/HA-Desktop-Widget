const {
  cascadedDeclaration,
  contrastRatio,
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

/**
 * A main view tile's fill is its --dash-tile-* token mixed with transparent by the share it keeps
 * at the current Window opacity. This splits the two: { fill, keep } with keep as a percentage.
 */
function splitKeep(value, backgroundAlpha = 1) {
  const match = value.match(
    /^color-mix\(in srgb, (.+) min\(100%, calc\((\d+)% \+ (\d+)% \* ([\d.]+)\)\), transparent\)$/s
  );
  expect(match).not.toBeNull();
  const [, fill, base, slope, alpha] = match;
  // The alpha in the value is whatever --window-bg-alpha the element resolved.
  expect(Number(alpha)).toBe(backgroundAlpha);
  return { fill, keep: Math.min(100, Number(base) + Number(slope) * Number(alpha)) };
}

/** Sets the alpha the Window opacity slider writes on the body (1 is a fully opaque window). */
function setBackgroundAlpha(alpha) {
  document.body.style.setProperty('--window-bg-alpha', String(alpha));
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
        const { fill, keep } = splitKeep(resolvedValue(element, '--tile-bg'));
        expect(fill).toBe(resolvedValue(document.body, '--dash-tile-bg'));
        expect(fill).not.toBe(soft);
        // A wash of a few percent is what disappeared into the panel.
        expect(opacityOf(fill)).toBeGreaterThanOrEqual(0.85);
        // At full opacity the tile keeps all of it.
        expect(keep).toBe(100);
        expect(splitKeep(resolvedValue(element, '--tile-bg-hover')).fill).toBe(
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
      const { fill } = splitKeep(
        resolvedValue(document.querySelector('.status-card'), '--tile-bg')
      );
      expect(opacityOf(fill)).toBe(0.94);
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

        expect(splitKeep(fill).fill).toBe(resolvedValue(document.body, '--dash-tile-bg'));
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

  describe('window opacity', () => {
    // The Window opacity slider writes --window-bg-alpha on the body: 1 at 100%, 0.878 at the 95%
    // the previews use, 0.761 at 90%, 0.185 at 60% and 0.08 at 50%.
    it.each(MODE_CASES)('keep the whole fill from about 90% up (%s)', (_, bodyClass) => {
      render(bodyClass);
      const card = document.querySelector('.status-card');
      for (const alpha of [1, 0.878, 0.761]) {
        setBackgroundAlpha(alpha);
        expect(splitKeep(resolvedValue(card, '--tile-bg'), alpha).keep).toBe(100);
        expect(splitKeep(resolvedValue(card, '--tile-bg-hover'), alpha).keep).toBe(100);
      }
    });

    it('thins the fill as the window gets more see-through, but never below about 80% of it', () => {
      render('frosted-glass');
      const card = document.querySelector('.status-card');
      const keeps = [0.541, 0.347, 0.185, 0.08].map((alpha) => {
        setBackgroundAlpha(alpha);
        return splitKeep(resolvedValue(card, '--tile-bg'), alpha).keep;
      });

      keeps.forEach((keep, index) => {
        expect(keep).toBeLessThan(index === 0 ? 100 : keeps[index - 1]);
        expect(keep).toBeGreaterThanOrEqual(78);
      });
      // At 60% a dark glass tile (94% opaque) is still about 79% opaque.
      expect(keeps[2]).toBeGreaterThan(80);
      expect(keeps[2]).toBeLessThan(90);
    });

    it.each(MODE_CASES)('leave the edge as it is while the fill thins (%s)', (_, bodyClass) => {
      render(bodyClass);
      const card = document.querySelector('.status-card');
      const edge = resolvedValue(card, '--tile-border');
      const hoverEdge = resolvedValue(card, '--tile-border-hover');

      setBackgroundAlpha(0.185);

      expect(resolvedValue(card, '--tile-border')).toBe(edge);
      expect(resolvedValue(card, '--tile-border-hover')).toBe(hoverEdge);
    });

    it('thins the pane of an unavailable tile on dark glass with the others', () => {
      render(
        'frosted-glass',
        '<div id="quick-controls"><div class="control-item" data-unavailable="true"></div></div>'
      );
      const tile = document.querySelector('.control-item');

      // Prettier wraps the long value, so compare it without the line breaks.
      expect(cascadedDeclaration(tile, 'background').value.replace(/\s+/g, ' ')).toBe(
        'color-mix( in srgb, rgba(var(--window-bg-rgb), 0.9) var(--dash-tile-keep), transparent )'
      );
    });

    it('does not reach Settings, dialogs or the header', () => {
      render('frosted-glass');
      setBackgroundAlpha(0.185);
      for (const selector of [
        '.widget-header',
        '.settings-card',
        '#settings-modal .modal-content',
      ]) {
        expect(resolvedValue(document.querySelector(selector), '--tile-bg')).toBe(
          resolvedValue(document.body, '--tile-bg')
        );
      }
    });
  });

  describe('unavailable tiles', () => {
    const unavailableMarkup = `<div id="quick-controls">
      <div class="control-item" data-unavailable="true"></div>
      <div class="control-item media-player-entity" data-unavailable="true"></div>
      <div class="control-item media-player-entity"></div>
    </div>`;

    it('leave an unavailable media player clear on the dark solid panel, like the others', () => {
      render('', unavailableMarkup);
      const [plain, unavailablePlayer, player] = document.querySelectorAll('.control-item');

      // The media player's fill is for a media player that is there.
      expect(cascadedDeclaration(player, 'background-color').value).toBe('var(--tile-bg)');
      expect(cascadedDeclaration(unavailablePlayer, 'background-color')?.value).not.toBe(
        'var(--tile-bg)'
      );
      expect(cascadedDeclaration(unavailablePlayer, 'background').value).toBe(
        cascadedDeclaration(plain, 'background').value
      );
      expect(cascadedDeclaration(plain, 'background').value).toBe('transparent');
    });

    it.each(['theme-light', 'frosted-glass', 'theme-light frosted-glass'])(
      'give an unavailable media player the pane of the other unavailable tiles (%s)',
      (bodyClass) => {
        render(bodyClass, unavailableMarkup);
        const [plain, unavailablePlayer] = document.querySelectorAll('.control-item');

        expect(cascadedDeclaration(unavailablePlayer, 'background').value).toBe(
          cascadedDeclaration(plain, 'background').value
        );
      }
    );
  });

  describe('text on the light tiles', () => {
    const textMarkup = `
      <div class="widget-header"><div class="drag-area"></div></div>
      <div class="widget-content">
        <div class="status-grid">
          <div class="status-card weather-card"><div class="weather-condition"></div></div>
          <div class="status-card time-card"><div class="date-display"></div></div>
        </div>
        <div class="media-tile"><span class="media-tile-time"></span></div>
        <div id="quick-controls"><div class="control-item"><span class="control-state"></span></div></div>
      </div>
      <div id="settings-modal"><div class="modal-content"><div class="settings-card"></div></div></div>
      <div class="desktop-pin-shell"><div class="desktop-pin-content"><div class="control-item"></div></div></div>`;

    // An 88% white pane over a dark photo is never darker than this.
    const WORST_PANE = '#e0e0e0';
    const TEXT_TOKENS = ['--text-dim', '--text-faint', '--muted-text'];

    it.each(['theme-light', 'theme-light frosted-glass'])(
      'are darkened to 4.5:1 or better on the pane (%s)',
      (bodyClass) => {
        render(bodyClass, textMarkup);
        const tile = document.querySelector('.status-card');

        for (const token of TEXT_TOKENS) {
          expect(resolvedValue(tile, token)).not.toBe(resolvedValue(document.body, token));
          expect(contrastRatio(resolvedValue(tile, token), WORST_PANE)).toBeGreaterThanOrEqual(4.5);
        }
        // The media timestamps read --muted-text from the media card, the tiles from their own.
        for (const selector of ['.media-tile', '#quick-controls .control-item']) {
          for (const token of TEXT_TOKENS) {
            expect(resolvedValue(document.querySelector(selector), token)).toBe(
              resolvedValue(tile, token)
            );
          }
        }
        expect(
          contrastRatio(resolvedValue(document.querySelector('.date-display'), 'color'), WORST_PANE)
        ).toBeGreaterThanOrEqual(4.5);
        const condition = document.querySelector('.weather-condition');
        expect(resolvedValue(condition, 'color')).toBe(resolvedValue(tile, '--text-dim'));
        expect(contrastRatio(resolvedValue(condition, 'color'), WORST_PANE)).toBeGreaterThanOrEqual(
          4.5
        );
      }
    );

    it.each(['theme-light', 'theme-light frosted-glass'])(
      'leave the header, Settings, dialogs and a pinned tile on their own (%s)',
      (bodyClass) => {
        render(bodyClass, textMarkup);
        for (const selector of [
          '.widget-header',
          '.settings-card',
          '#settings-modal .modal-content',
          '.desktop-pin-content .control-item',
        ]) {
          for (const token of TEXT_TOKENS) {
            expect(resolvedValue(document.querySelector(selector), token)).toBe(
              resolvedValue(document.body, token)
            );
          }
        }
      }
    );

    it.each([
      ['dark', ''],
      ['dark glass', 'frosted-glass'],
      ['the light readable preset', 'theme-light high-contrast'],
    ])('stay as they were on %s', (_, bodyClass) => {
      render(bodyClass, textMarkup);
      const tile = document.querySelector('.status-card');
      for (const token of TEXT_TOKENS) {
        expect(resolvedValue(tile, token)).toBe(resolvedValue(document.body, token));
      }
      expect(resolvedValue(document.querySelector('.date-display'), 'color')).toBe(
        bodyClass.includes('theme-light')
          ? 'color-mix(in srgb, var(--accent) 72%, #000)'.replace(
              'var(--accent)',
              resolvedValue(document.body, '--accent')
            )
          : resolvedValue(document.body, '--accent-text')
      );
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

    // A primary card holds its entity's tile, which fills the card. The card paints the lift, so
    // the tile has to stay clear or it covers it (every .control-item gets the panel colour).
    const PRIMARY_CARDS_MARKUP = `
      <div class="widget-content">
        <div class="status-grid">
          <div class="status-card primary-entity-card" data-state="on">
            <div class="control-item" data-primary-card="true"><span class="control-name"></span></div>
          </div>
          <div class="status-card primary-entity-card primary-light-card" data-state="off">
            <div class="control-item" data-primary-card="true"></div>
          </div>
          <div class="status-card primary-entity-card">
            <div class="control-item unavailable-entity" data-primary-card="true"></div>
          </div>
        </div>
        <div class="media-tile"></div>
        <div id="quick-controls"><div class="control-item"></div></div>
      </div>`;

    it.each([
      ['dark', 'opaque-panels'],
      ['light', 'theme-light opaque-panels'],
      ['readable', 'high-contrast opaque-panels'],
    ])('let the lifted primary card show through its entity tile (%s)', (_, bodyClass) => {
      render(bodyClass, PRIMARY_CARDS_MARKUP);

      const cards = document.querySelectorAll('.status-card');
      expect(cards).toHaveLength(3);
      for (const card of cards) {
        const tile = card.querySelector('.control-item');
        const declaration = cascadedDeclaration(tile, 'background');

        expect(declaration.value).toBe('transparent');
        expect(declaration.important).toBe(true);
        // The card underneath is what paints, so there is still a surface to show.
        expect(cascadedDeclaration(card, 'background').important).toBe(true);
      }
    });

    it('lets no tile nested in a lifted surface cover it, and still lifts the tiles that are not', () => {
      render('opaque-panels', PRIMARY_CARDS_MARKUP);
      const surfaces = '.status-card, .media-tile, #quick-controls .control-item';

      for (const tile of document.querySelectorAll('.control-item')) {
        const nested = tile.parentElement.closest(surfaces) !== null;
        const value = cascadedDeclaration(tile, 'background').value;

        if (nested) {
          expect(value).toBe('transparent');
        } else {
          expect(value).toMatch(/^color-mix\(in srgb, var\(--bg-primary\), white \d+%\)$/);
        }
      }
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

  it('is not painted when Windows forces colours, which keeps gradients over Canvas', () => {
    const veilRules = [];
    const visit = (rules) => {
      for (const rule of rules) {
        if (rule.media && rule.media.mediaText === '(forced-colors: active)') {
          for (const inner of rule.cssRules) {
            if (
              inner.selectorText === 'body' &&
              inner.style.getPropertyValue('--panel-veil-layer')
            ) {
              veilRules.push(inner.style.getPropertyValue('--panel-veil-layer').trim());
            }
          }
        }
      }
    };
    for (const sheet of document.styleSheets) visit(sheet.cssRules);

    // Every copy of the stylesheet the suite has loaded says the same thing.
    expect(veilRules.length).toBeGreaterThan(0);
    expect(new Set(veilRules)).toEqual(new Set(['none']));
  });

  it('is a layer for an ordinary window', () => {
    render('');
    expect(resolvedValue(document.body, '--panel-veil-layer')).toMatch(/^linear-gradient\(/);
  });

  it('is painted over the solid panel by the header and content', () => {
    render('');
    for (const selector of ['.widget-header', '.widget-content']) {
      const declaration = cascadedDeclaration(document.querySelector(selector), 'background-image');
      expect(declaration.value).toBe('var(--panel-veil-layer)');
      expect(declaration.important).toBe(true);
    }
    expect(cascadedDeclaration(document.body, 'background-image')).toBeNull();
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

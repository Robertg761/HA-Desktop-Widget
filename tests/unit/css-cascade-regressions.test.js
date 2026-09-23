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

      for (const slider of document.querySelectorAll('input:not(.light-color-temp-slider)')) {
        expect(contrastRatio(resolvedValue(slider, 'background'), panel)).toBeGreaterThanOrEqual(3);
      }
      // The colour temperature scale keeps its warm-to-cool gradient.
      expect(
        resolvedValue(document.querySelector('.light-color-temp-slider'), 'background')
      ).toMatch(/^linear-gradient\(to right, #ffb45f/);
    });

    it('leaves transparent tile and transport buttons alone', () => {
      render(
        THEMES['readable light'],
        `<div class="control-item"><button class="tile-primary-button"></button></div>
        <div class="media-detail-controls"><button class="btn"></button></div>`
      );

      for (const button of document.querySelectorAll('button')) {
        expect(resolvedValue(button, 'background')).toBe('transparent');
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
});

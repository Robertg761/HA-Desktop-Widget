/**
 * Rule-level text contrast: the colour a text rule actually resolves to, on the surface the markup
 * puts it on, in every theme and for several accents. The ratchet in theme-contrast.test.js covers
 * the tokens; this covers the rules that use them (and the ones that once bypassed them).
 */
const {
  contrastRatio,
  loadAppStylesheets,
  parseColor,
  resolvedValue,
} = require('../helpers/css-cascade.js');
const { applyWindowEffects } = require('../../src/ui-utils.js');
const {
  NON_TEXT_MINIMUM,
  SCOPES,
  TEXT_MINIMUM,
  applyScope,
  currentSurfaces,
  over,
} = require('../helpers/theme-contrast.js');

// Both themes, the Readable preset over either, and four accents that cover the light, the dark,
// the saturated and the neutral end of the presets.
const THEME_SCOPES = Object.entries(SCOPES);
const ACCENTS = ['original', 'indigo', 'rose', 'aqua', 'slate'];

function render(html) {
  document.body.innerHTML = html;
}

function colorOf(element) {
  return resolvedValue(element, 'color');
}

describe('text contrast of the rules', () => {
  beforeAll(() => {
    loadAppStylesheets(document);
  });

  afterEach(() => {
    document.body.innerHTML = '';
  });

  describe('status text', () => {
    const markup = `
      <div id="settings-modal"><div class="modal-content">
        <div class="connection-test-status" data-status="success"></div>
        <div class="connection-test-status" data-status="error"></div>
        <div class="form-help form-warning"></div>
        <div class="form-help form-error"></div>
        <div class="profile-sync-error"></div>
      </div></div>
      <div class="first-run-onboarding">
        <div class="first-run-status" data-status="success"></div>
        <div class="first-run-status" data-status="error"></div>
      </div>
      <div class="widget-state-panel" role="alert"></div>
      <div class="add-page-modal"><div class="add-page-name-error"></div></div>
      <div class="control-item unavailable-entity"><span class="unavailable-icon"></span></div>`;

    it.each(THEME_SCOPES)('reads on the pane it sits on (%s)', (_, config) => {
      applyScope(config, 'original');
      render(markup);
      const surfaces = currentSurfaces(config.highContrast);
      const results = [];
      for (const element of document.querySelectorAll(
        '.connection-test-status, .form-warning, .form-error, .profile-sync-error, .first-run-status, [role=alert], .add-page-name-error'
      )) {
        // Settings text sits on the dialog; the first-run wizard and the state panel on the window.
        const surface = element.closest('#settings-modal') ? surfaces.dialog : surfaces.window;
        results.push([
          element.className + (element.dataset.status ? `[${element.dataset.status}]` : ''),
          contrastRatio(colorOf(element), surface) >= TEXT_MINIMUM,
        ]);
      }
      expect(results.filter(([, enough]) => !enough)).toEqual([]);
      expect(results.length).toBeGreaterThanOrEqual(9);
    });

    it.each(THEME_SCOPES)('keeps the removed entity name and hint readable (%s)', (_, config) => {
      applyScope(config, 'original');
      render(`<div id="quick-controls"><div class="control-item unavailable-entity">
        <div class="control-icon unavailable-icon"></div>
        <div class="control-info"><div class="control-name"></div>
        <div class="control-state unavailable-state"></div></div></div></div>`);
      const surfaces = currentSurfaces(config.highContrast);
      const tile = document.querySelector('.control-item');
      for (const selector of ['.control-name', '.unavailable-state']) {
        const color = colorOf(document.querySelector(selector));
        expect(contrastRatio(color, surfaces['dash tile'])).toBeGreaterThanOrEqual(TEXT_MINIMUM);
      }
      // No stacked fades: the tile and its name are not dimmed by opacity.
      expect(resolvedValue(tile, 'opacity')).toBeNull();
      expect(resolvedValue(document.querySelector('.control-name'), 'opacity')).toBeNull();
      // The hint is the quietest of the three lines, as it is on every other unavailable tile.
      expect(document.querySelector('.unavailable-state')).not.toBeNull();
    });
  });

  describe('accent text', () => {
    const markup = `
      <div class="status-grid"><div class="status-card time-card">
        <div class="date-display"></div></div></div>
      <div id="settings-modal"><div class="modal-content">
        <button class="btn btn-secondary" id="test-connection"></button>
        <div class="segmented-control"><button class="btn btn-secondary btn-sm"></button></div>
        <button class="btn btn-secondary" id="cancel-x"></button>
      </div></div>
      <div id="quick-controls"><div class="control-item" data-active="true">
        <div class="control-icon"></div></div></div>`;

    describe.each(['dark', 'light'])('in the %s theme', (scope) => {
      it.each(ACCENTS)('keeps the date and the secondary buttons readable with %s', (accent) => {
        applyScope(SCOPES[scope], accent);
        render(markup);
        const surfaces = currentSurfaces(false);

        const date = document.querySelector('.date-display');
        expect(contrastRatio(colorOf(date), surfaces['dash tile'])).toBeGreaterThanOrEqual(
          TEXT_MINIMUM
        );
        for (const button of document.querySelectorAll('#settings-modal .btn-secondary')) {
          if (button.id === 'cancel-x') continue;
          // The label is drawn on the button's own tint over the dialog.
          const fill = resolvedValue(button, 'background');
          const [r, g, b, a] = parseColor(fill);
          const [dr, dg, db] = parseColor(surfaces.dialog);
          const tinted = `rgb(${r * a + dr * (1 - a)}, ${g * a + dg * (1 - a)}, ${b * a + db * (1 - a)})`;
          expect(contrastRatio(colorOf(button), tinted)).toBeGreaterThanOrEqual(TEXT_MINIMUM);
        }
      });

      it.each(ACCENTS)('draws the lit tile icon at 3:1 with %s', (accent) => {
        applyScope(SCOPES[scope], accent);
        document.body.classList.add('active-tile-glow');
        render(markup);
        const surfaces = currentSurfaces(false);
        const icon = document.querySelector('#quick-controls .control-icon');
        expect(contrastRatio(colorOf(icon), surfaces['lit tile'])).toBeGreaterThanOrEqual(
          NON_TEXT_MINIMUM
        );
      });
    });

    it.each(['dark', 'light'])('draws a lit icon in the text colour for slate (%s)', (scope) => {
      applyScope(SCOPES[scope], 'slate');
      document.body.classList.add('active-tile-glow');
      render(markup);
      const icon = document.querySelector('#quick-controls .control-icon');
      expect(document.body.dataset.accentNeutral).toBe('true');
      // The slate accent text is dimmer than an idle icon; the text colour is not.
      expect(colorOf(icon)).toBe(resolvedValue(document.body, '--text-primary'));
      // Other accents keep the accent on a lit icon.
      applyScope(SCOPES[scope], 'indigo');
      document.body.classList.add('active-tile-glow');
      render(markup);
      expect(colorOf(document.querySelector('#quick-controls .control-icon'))).toBe(
        resolvedValue(document.body, '--accent-text')
      );
    });

    it('lets the segmented control keep its own colour in the light theme', () => {
      applyScope(SCOPES.light, 'original');
      render(markup);
      const inSegment = document.querySelector('.segmented-control .btn');
      const plain = document.querySelector('#test-connection');
      // The 72% accent mix this once forced on every secondary button turned the segments blue and
      // took their hover colour. The segments are neutral, as they are in the dark theme, and a
      // plain secondary button takes the shared accent text.
      expect(colorOf(inSegment)).toBe(
        `color-mix(in srgb, ${resolvedValue(document.body, '--text-primary')} 65%, transparent)`
      );
      expect(colorOf(plain)).toBe(resolvedValue(document.body, '--accent-text'));
    });
  });

  describe('disabled holiday rows', () => {
    const markup = `<div id="settings-modal"><div id="seasonal-settings">
      <div class="form-group setting-row seasonal-option is-disabled">
        <label>Holiday colours <input type="checkbox" disabled></label>
        <select disabled></select>
        <p class="form-help">Dec 1 to Dec 31</p>
      </div></div></div>`;

    it('dim once, so the switch, the select and the dates are not dimmed again', () => {
      applyScope(SCOPES.dark, 'original');
      render(markup);
      const opacity = (selector) => resolvedValue(document.querySelector(selector), 'opacity');
      // The row carries the dimming. The global rules for a disabled control (0.5) and for a row
      // with a disabled switch (0.6 on its help) would otherwise stack on it.
      expect(opacity('.seasonal-option')).toBe('0.6');
      expect(opacity('input')).toBe('1');
      expect(opacity('select')).toBe('1');
      expect(opacity('.form-help')).toBe('1');
    });

    it.each(['high-contrast', 'opaque-panels'])(
      'hold the readable preset to a light dim (%s)',
      (cls) => {
        applyScope(SCOPES.dark, 'original');
        document.body.classList.add(cls);
        render(markup);
        expect(resolvedValue(document.querySelector('.seasonal-option'), 'opacity')).toBe('0.85');
      }
    );
  });

  describe('colour swatches', () => {
    const swatches = `<div id="theme-options">
      <button class="theme-option" data-background-swatch="base"><span class="accent-theme-swatch"></span></button>
      <button class="theme-option selected" data-background-swatch="base"><span class="accent-theme-swatch"></span></button>
    </div><div class="theme-tooltip-flyout"></div>`;

    it.each(['dark', 'light'])(
      'mark the chosen swatch in the text colour, whatever its own colour is (%s)',
      (scope) => {
        applyScope(SCOPES[scope], 'original');
        render(swatches);
        const [plain, chosen] = document.querySelectorAll('.theme-option');
        const text = resolvedValue(document.body, '--text-primary');
        expect(resolvedValue(chosen, 'border-color')).toBe(text);
        expect(resolvedValue(chosen, 'box-shadow')).toContain(text);
        // No coloured glow under a swatch: the shadow of an unchosen one is plain.
        expect(resolvedValue(plain, 'border-color')).not.toBe(text);
        expect(resolvedValue(chosen, 'box-shadow')).not.toContain('--swatch-rgb');
      }
    );

    it('draws a background swatch from the window colour it was given', () => {
      applyScope(SCOPES.light, 'original');
      render(
        `<button class="theme-option" data-background-swatch="tinted" style="--swatch-window: #f1edfa; --swatch: #8b5cf6">
          <span class="accent-theme-swatch"></span></button>`
      );
      expect(resolvedValue(document.querySelector('.accent-theme-swatch'), 'background')).toBe(
        '#f1edfa'
      );
    });

    it('draws the swatch tooltip on the dialog panel, so Linux shows no wallpaper through it', () => {
      applyScope(SCOPES.light, 'original');
      render(swatches);
      const tooltip = document.querySelector('.theme-tooltip-flyout');
      expect(resolvedValue(tooltip, 'background')).toContain(
        resolvedValue(document.body, '--dialog-bg')
      );
    });
  });

  describe('a tile that needs attention', () => {
    const markup = (attention) => `<div id="quick-controls">
      <div class="control-item" data-attention="${attention}" data-active="true">
        <div class="control-icon"></div>
        <div class="control-info"><div class="control-name"></div>
        <div class="control-state"></div></div></div></div>`;

    // The state line is written in the status colour on the tile's wash of it, and the badge is a
    // disc of that colour with the mark cut out to the wash, so one ratio covers both.
    describe.each(THEME_SCOPES)('in %s', (_, config) => {
      it.each(['warning', 'danger'])('keeps a %s state line at 4.5:1 on its wash', (attention) => {
        applyScope(config, 'amber');
        document.body.classList.add('active-tile-glow');
        render(markup(attention));
        const surfaces = currentSurfaces(config.highContrast);
        const tile = document.querySelector('.control-item');
        const colour = resolvedValue(tile, '--attention-color');
        const wash = parseFloat(resolvedValue(tile, '--dash-attention-wash')) / 100;
        const [r, g, b] = parseColor(colour);
        const washed = over(`rgba(${r}, ${g}, ${b}, ${wash})`, surfaces['dash tile']);
        expect(colorOf(document.querySelector('.control-state'))).toBe(colour);
        expect(contrastRatio(colour, washed)).toBeGreaterThanOrEqual(TEXT_MINIMUM);
      });
    });
  });

  describe("a sensor tile's trend line", () => {
    const markup = `<div id="quick-controls"><div class="control-item sensor-numeric-entity">
      <div class="control-sensor-sparkline"></div></div></div>`;

    // The line is the tile's only picture of change; drawn as half the raw accent it was 1.5:1
    // with Indigo and Rose on the dark tile.
    describe.each(['dark', 'light', 'high-contrast'])('in the %s theme', (scope) => {
      it.each(ACCENTS)('is a 3:1 graphic on its tile with %s', (accent) => {
        applyScope(SCOPES[scope], accent);
        render(markup);
        const surfaces = currentSurfaces(SCOPES[scope].highContrast);
        const line = document.querySelector('.control-sensor-sparkline');
        const opacity = Number(resolvedValue(line, 'opacity') ?? 1);
        const [r, g, b, alpha] = parseColor(colorOf(line));
        expect(
          contrastRatio(`rgba(${r}, ${g}, ${b}, ${alpha * opacity})`, surfaces['dash tile'])
        ).toBeGreaterThanOrEqual(NON_TEXT_MINIMUM);
      });
    });
  });

  describe('unavailable tiles', () => {
    const markup = `<div id="quick-controls"><div class="control-item" data-unavailable="true">
      <div class="control-info"><div class="control-name"></div>
      <div class="control-state"></div></div></div></div>`;

    it.each(THEME_SCOPES)(
      'keep the name and the state at 4.5:1 on their own pane (%s)',
      (_, config) => {
        applyScope(config, 'original');
        // At full window opacity, where the tile keeps its whole fill (the cascade has no calc()).
        document.body.style.setProperty('--dash-tile-keep', '100%');
        render(markup);
        const surfaces = currentSurfaces(config.highContrast);
        const tile = document.querySelector('.control-item');
        // The tile is a translucent pane (or clear) over the panel; measure on what it composes to.
        const fill = resolvedValue(tile, 'background');
        const pane = parseColor(fill)?.[3] > 0 ? over(fill, surfaces.panel) : surfaces.panel;
        for (const selector of ['.control-name', '.control-state']) {
          const color = colorOf(document.querySelector(selector));
          expect({ selector, ratio: contrastRatio(color, pane) >= TEXT_MINIMUM }).toEqual({
            selector,
            ratio: true,
          });
        }
      }
    );
  });

  describe('the Settings panel where blur does not render', () => {
    // The body each platform and Frosted glass choice gets, from the real applyWindowEffects.
    const withoutAcrylic = { nativeGlassSupported: false };
    const BODIES = {
      'Linux without Frosted glass': ['linux', false],
      'Linux with Frosted glass': ['linux', true],
      'Windows 11 22H2 acrylic': ['win32', true],
      'Windows without Frosted glass': ['win32', false],
      'Windows before 11 22H2': ['win32', true, withoutAcrylic],
      'macOS vibrancy': ['darwin', true],
      'macOS without Frosted glass': ['darwin', false],
    };
    const settingsAlphas = (label) => {
      const [platform, frostedGlass, desktopCapabilities] = BODIES[label];
      window.electronAPI = { platform };
      applyWindowEffects({ opacity: 0.8, frostedGlass, desktopCapabilities });
      return [
        Number(resolvedValue(document.body, '--settings-modal-bg-alpha')),
        Number(resolvedValue(document.body, '--settings-modal-panel-alpha')),
      ];
    };

    afterEach(() => {
      delete window.electronAPI;
      delete document.body.dataset.platform;
    });

    it.each(['dark', 'light'])('is nearly opaque on Linux, with or without glass (%s)', (scope) => {
      for (const label of ['Linux without Frosted glass', 'Linux with Frosted glass']) {
        applyScope(SCOPES[scope], 'original');
        expect({ label, alphas: settingsAlphas(label) }).toEqual({ label, alphas: [0.96, 0.96] });
      }
    });

    it.each(['dark', 'light'])(
      'keeps the translucent panel on Windows and macOS, with glass or without (%s)',
      (scope) => {
        const kept = [];
        for (const label of Object.keys(BODIES).filter((name) => !name.startsWith('Linux'))) {
          applyScope(SCOPES[scope], 'original');
          const [background, panel] = settingsAlphas(label);
          kept.push({ label, translucent: background < 0.9 && panel < 0.95 });
        }
        expect(kept.filter(({ translucent }) => !translucent)).toEqual([]);
        expect(kept).toHaveLength(5);
      }
    );
  });

  describe('the window controls on the Linux tint', () => {
    const header = `<div class="widget-header"><div class="header-controls">
      <button class="control-btn notification-bell-btn"></button>
      <button class="control-btn" id="settings-btn"></button>
      <button class="control-btn" id="close-btn"></button></div></div>`;
    // The light tint over a dark wallpaper with no blur from the compositor, the usual Omarchy
    // case, at the default opacity.
    const tintOverDarkWallpaper = () => {
      window.electronAPI = { platform: 'linux' };
      applyWindowEffects({ opacity: 0.95, frostedGlass: true });
      const alpha = resolvedValue(document.body, '--software-acrylic-bg-alpha');
      return over(
        `rgba(${resolvedValue(document.body, '--window-bg-rgb')}, ${alpha})`,
        'rgb(0, 0, 0)'
      );
    };
    const inkOf = (button) => {
      const [r, g, b, alpha] = parseColor(colorOf(button));
      return `rgba(${r}, ${g}, ${b}, ${alpha * Number(resolvedValue(button, 'opacity') ?? 1)})`;
    };

    afterEach(() => {
      delete window.electronAPI;
      delete document.body.dataset.platform;
    });

    it('are 3:1 graphics in the light theme, where their dimmed ink was 2.4:1', () => {
      applyScope(SCOPES.light, 'original');
      render(header);
      const tint = tintOverDarkWallpaper();
      expect(document.body.classList.contains('software-glass')).toBe(true);
      for (const id of ['settings-btn', 'close-btn']) {
        const ratio = contrastRatio(inkOf(document.getElementById(id)), tint);
        expect({ id, ratio: ratio >= NON_TEXT_MINIMUM }).toEqual({ id, ratio: true });
      }
    });

    it('leave the bell its accent, and the solid light panel its quieter controls', () => {
      applyScope(SCOPES.light, 'original');
      render(header);
      tintOverDarkWallpaper();
      expect(colorOf(document.querySelector('.notification-bell-btn'))).toBe(
        resolvedValue(document.body, '--accent-text')
      );
      applyScope(SCOPES.light, 'original');
      render(header);
      expect(resolvedValue(document.getElementById('close-btn'), 'opacity')).toBe('0.8');
    });
  });

  describe('a pin in the light theme', () => {
    it('keeps the dark dialog its light text is drawn for', () => {
      applyScope(SCOPES.light, 'original');
      document.body.classList.add('desktop-pin-mode');
      const text = resolvedValue(document.body, '--text-primary');
      const results = ['--dialog-bg', '--dialog-bg-solid'].map((name) => {
        const fill = resolvedValue(document.body, name);
        // --dialog-bg is 96% opaque; measure it over the pin's own window colour.
        const pane = over(fill, `rgb(${resolvedValue(document.body, '--window-bg-rgb')})`);
        return { name, ratio: contrastRatio(text, pane) >= TEXT_MINIMUM };
      });
      expect(results.filter(({ ratio }) => !ratio)).toEqual([]);
    });
  });

  describe('field placeholders', () => {
    // The cascade helper does not resolve pseudo-elements, so read the rule itself.
    const placeholderRules = () =>
      [...document.styleSheets]
        .flatMap((sheet) => [...sheet.cssRules])
        .filter((rule) => rule.selectorText?.includes('::placeholder'));

    it('themes the placeholder of a field in any dialog, the hotkey rows included', () => {
      // A hotkey row's "None" is a placeholder in an input that is not in a .form-group. It once
      // took the browser's grey (3.7:1); the field recipe's :where(.modal-body, ...) selector
      // reaches it, and sets the tertiary text colour, which the ratchet holds to 4.5:1.
      const rule = placeholderRules().find((entry) => entry.selectorText.includes('.modal-body'));
      expect(rule).toBeDefined();
      expect(rule.style.getPropertyValue('color')).toBe('var(--text-tertiary)');
      document.body.innerHTML =
        '<div id="settings-modal"><div class="modal-body"><input class="hotkey-input" placeholder="None"></div></div>';
      const input = document.querySelector('.hotkey-input');
      expect(input.closest('.modal-body')).not.toBeNull();
      expect(
        input.matches(
          'input:not([type="checkbox"], [type="radio"], [type="range"], [type="color"])'
        )
      ).toBe(true);
    });
  });

  describe('the dividers between Settings rows', () => {
    const rows = `<div id="settings-modal"><div class="settings-group-body">
      <div class="form-group" id="a">first</div>
      <div class="form-group hidden" id="skipped-by-class">hidden</div>
      <div class="form-group" id="b">second</div>
      <div class="form-group" id="skipped-by-style" style="display: none">hidden</div>
      <div class="form-group" id="c">third</div>
      <div class="form-group" id="skipped-last" style="display: none">hidden at the end</div>
    </div></div>`;
    const border = (id, side) =>
      resolvedValue(document.getElementById(id), `border-${side}`) ??
      resolvedValue(document.getElementById(id), 'border-' + side + '-width');

    it('draw one hairline above each visible row that follows another, and none below', () => {
      applyScope(SCOPES.dark, 'original');
      render(rows);
      // The first visible row has no divider against the pane's own edge.
      expect(border('a', 'top')).toBeNull();
      // Hidden rows between visible ones do not leave a gap in the dividers.
      expect(border('b', 'top')).toMatch(/^1px solid /);
      expect(border('c', 'top')).toMatch(/^1px solid /);
      // The last visible row ends on the pane's border, whether or not a hidden row follows it.
      for (const id of ['a', 'b', 'c']) expect(border(id, 'bottom')).toBeNull();
    });

    it('does not draw a hairline above a hidden row, or count it as the last row', () => {
      applyScope(SCOPES.dark, 'original');
      render(rows);
      for (const id of ['skipped-by-class', 'skipped-by-style', 'skipped-last']) {
        expect(resolvedValue(document.getElementById(id), 'display')).toBe('none');
      }
    });

    it('leave the legacy section dividers to the shared rule', () => {
      applyScope(SCOPES.light, 'original');
      render(
        `<div id="settings-modal"><div class="settings-group-body">
          <div class="form-group language-section" id="language">language</div>
          <details class="settings-details" id="details"><summary>Legacy</summary></details>
          <div class="form-group update-section" id="update">update</div>
        </div></div>`
      );
      // Each used to carry its own, brighter top border and margin, so the first row of a pane got a
      // second line under the pane's rounded edge. Now a row has the shared hairline or none.
      expect(border('language', 'top')).toBeNull();
      const shared = resolvedValue(document.getElementById('details'), 'border-top');
      expect(shared).toMatch(/^1px solid /);
      expect(border('update', 'top')).toBe(shared);
    });
  });
});

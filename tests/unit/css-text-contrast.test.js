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
const {
  NON_TEXT_MINIMUM,
  SCOPES,
  TEXT_MINIMUM,
  applyScope,
  currentSurfaces,
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
        <div class="update-status available"></div>
        <div class="update-status downloading"></div>
        <div class="update-status downloaded"></div>
        <div class="update-status error"></div>
        <div class="update-status up-to-date"></div>
        <div class="update-status checking"></div>
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
        '.connection-test-status, .form-warning, .form-error, .profile-sync-error, .update-status, .first-run-status, [role=alert], .add-page-name-error'
      )) {
        // Settings text sits on the dialog; the first-run wizard and the state panel on the window.
        const surface = element.closest('#settings-modal') ? surfaces.dialog : surfaces.window;
        results.push([
          element.className + (element.dataset.status ? `[${element.dataset.status}]` : ''),
          contrastRatio(colorOf(element), surface) >= TEXT_MINIMUM,
        ]);
      }
      expect(results.filter(([, enough]) => !enough)).toEqual([]);
      expect(results.length).toBeGreaterThan(10);
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
});

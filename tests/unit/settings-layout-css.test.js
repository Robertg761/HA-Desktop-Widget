/**
 * @jest-environment jsdom
 */

// Settings and dialog layout rules from the 4.0 re-audit, each pinned in the cascade the app really
// paints it in.

const { loadAppStylesheets, resolvedValue } = require('../helpers/css-cascade.js');

function render(html, { bodyClass = '' } = {}) {
  document.body.className = bodyClass;
  document.body.innerHTML = html;
}

describe('Settings layout', () => {
  beforeAll(() => {
    loadAppStylesheets(document);
  });

  afterEach(() => {
    document.body.className = '';
    document.body.innerHTML = '';
  });

  describe('an alert row', () => {
    // A missing entity shows its raw id, which has nowhere to break. Nothing in the row could shrink
    // below it, so Edit and Remove were pushed out of the card.
    const ROW = `
      <div id="settings-modal"><div id="inline-alerts-list">
        <div class="alert-item">
          <div class="alert-item-info">
            <span class="alert-icon"></span>
            <div class="alert-details">
              <span class="alert-name">sensor.living_room_north_wall_temperature_sensor_behind_tv</span>
              <span class="alert-type">When state is unavailable</span>
            </div>
          </div>
          <div class="alert-actions"><button class="btn btn-sm">Edit</button></div>
        </div>
      </div></div>`;

    it('breaks a long name anywhere instead of keeping it whole', () => {
      render(ROW);
      expect(resolvedValue(document.querySelector('.alert-name'), 'overflow-wrap')).toBe(
        'anywhere'
      );
      for (const selector of ['.alert-item-info', '.alert-details']) {
        expect(resolvedValue(document.querySelector(selector), 'min-width')).toBe('0');
      }
    });

    it('keeps its buttons whole, dropping them under the name when it needs the room', () => {
      render(ROW);
      expect(resolvedValue(document.querySelector('.alert-actions'), 'flex')).toBe('none');
      expect(resolvedValue(document.querySelector('.alert-item'), 'flex-wrap')).toBe('wrap');
    });

    it('has no margin under the name, which sits in a line with its chips', () => {
      render(ROW);
      expect(resolvedValue(document.querySelector('.alert-name'), 'margin-bottom')).toBeNull();
    });
  });
  describe('the Settings entity lists', () => {
    // At 150% text the window is 400px tall, and a 400px list inside the scrolling page showed one
    // row between two scrollbars.
    it.each(['primary-cards-list', 'custom-entity-icons-list'])(
      'caps #%s by the window as well as at 400px',
      (id) => {
        render(
          `<div id="settings-modal"><div id="${id}" class="entity-selector-list"></div></div>`
        );
        expect(resolvedValue(document.getElementById(id), 'max-height')).toBe('min(400px, 55vh)');
      }
    );

    it('caps the hotkey list at 60% of the window', () => {
      render('<div id="settings-modal"><div id="hotkeys-list"></div></div>');
      expect(resolvedValue(document.getElementById('hotkeys-list'), 'max-height')).toBe(
        'min(max(40vh, 20rem), 60vh)'
      );
    });

    it('still lets the icon list grow while an icon grid is open in it', () => {
      render(
        '<div id="settings-modal"><div id="custom-entity-icons-list" class="entity-selector-list custom-entity-icons-list-expanded"></div></div>'
      );
      expect(resolvedValue(document.getElementById('custom-entity-icons-list'), 'max-height')).toBe(
        'none'
      );
    });
  });
  describe('a Settings row select', () => {
    // At a fixed 13.5rem the sync scope read "Tous les paramètres synchr..." in French.
    it('is at least the common width, and wider when its choices need it', () => {
      render(
        '<div id="settings-modal"><div class="form-group setting-row"><select><option>Tous les paramètres synchronisables</option></select></div></div>'
      );
      const select = document.querySelector('select');
      expect(resolvedValue(select, 'width')).toBe('auto');
      expect(resolvedValue(select, 'min-width')).toBe('min(13.5rem, 100%)');
      expect(resolvedValue(select, 'max-width')).toBe('100%');
    });
  });
  describe('the Settings search box', () => {
    const BOX =
      '<div id="settings-modal" class="modal"><div class="modal-body"><div class="form-group settings-search-box"><input id="settings-search" /></div></div></div>';

    it('stays at the top of a long list of results, as a solid band across the page', () => {
      render(BOX);
      document.getElementById('settings-modal').classList.add('settings-searching');
      const box = document.querySelector('.settings-search-box');
      expect(resolvedValue(box, 'position')).toBe('sticky');
      expect(resolvedValue(box, 'top')).toBe('-18px');
      // The dialog's own colour, solid: the lighter panel colour in the column alone was a slab
      // floating in the see-through panel, and a see-through band left ghost text in the field.
      expect(resolvedValue(box, 'background')).toBe('rgb(17, 21, 28)');
      // Out to the scroller's edges, over the page's 18px padding and the 9px by the scrollbar.
      expect(resolvedValue(box, 'max-width')).toBe('none');
      expect(resolvedValue(box, 'margin-inline')).toBe('-18px -9px');
      expect(
        resolvedValue(document.querySelector('.modal-body'), 'scroll-padding-block-start')
      ).toBe('6.5rem');
    });

    it('scrolls away with a page, as before', () => {
      render(BOX);
      expect(resolvedValue(document.querySelector('.settings-search-box'), 'position')).toBeNull();
    });
  });
  describe('Show passphrase', () => {
    // The label stays put while the passphrase shows, so the button has to look pressed: it was
    // pixel for pixel the same either way.
    const button = (pressed) => {
      render(
        `<div id="settings-modal"><button type="button" id="profile-sync-passphrase-reveal" class="btn btn-secondary" aria-pressed="${pressed}"><svg class="passphrase-reveal-icon-hidden"></svg><svg class="passphrase-reveal-icon-shown"></svg><span>Show passphrase</span></button></div>`
      );
      const reveal = document.getElementById('profile-sync-passphrase-reveal');
      return {
        background: resolvedValue(reveal, 'background'),
        border: resolvedValue(reveal, 'border-color'),
        ring: resolvedValue(reveal, 'box-shadow'),
        hiddenEye: resolvedValue(reveal.querySelector('.passphrase-reveal-icon-hidden'), 'display'),
        openEye: resolvedValue(reveal.querySelector('.passphrase-reveal-icon-shown'), 'display'),
      };
    };

    it('looks pressed while the passphrase is shown, with no ring like a focus ring', () => {
      const pressed = button(true);
      const plain = button(false);
      expect(pressed.background).not.toBe(plain.background);
      expect(pressed.border).not.toBe(plain.border);
      // An accent ring inside the edge read as a second focus ring beside the focused field.
      expect(pressed.ring || '').not.toMatch(/inset/);
    });

    it('shows an open eye while the passphrase is shown, and a crossed-out one while hidden', () => {
      expect(button(true)).toMatchObject({ hiddenEye: 'none', openEye: null });
      expect(button(false)).toMatchObject({ hiddenEye: null, openEye: 'none' });
    });

    it('keeps the pressed look in forced colours and high contrast', () => {
      render(
        '<div id="settings-modal"><button id="profile-sync-passphrase-reveal" class="btn btn-secondary" aria-pressed="true"></button></div>',
        { bodyClass: 'high-contrast' }
      );
      const reveal = document.getElementById('profile-sync-passphrase-reveal');
      expect(resolvedValue(reveal, 'outline', { forcedColors: true })).toBe('2px solid Highlight');
      expect(resolvedValue(reveal, 'box-shadow', { forcedColors: false })).toMatch(
        /^inset 0 0 0 2px /
      );
    });
  });
  describe('the donation frequency', () => {
    // A square ring round the round radio ran into its "One-time" label.
    it('rings the whole option for keyboard focus, not the radio', () => {
      render(
        '<div class="donate-frequency"><label class="donate-frequency-option"><input type="radio" data-focus-visible checked /><span>One-time</span></label></div>'
      );
      const radio = document.querySelector('input');
      expect(resolvedValue(radio, 'outline')).toBe('none');
      const rule = [...document.styleSheets]
        .flatMap((sheet) => [...sheet.cssRules])
        .find(
          (cssRule) => cssRule.selectorText === '.donate-frequency-option:has(input:focus-visible)'
        );
      expect(rule?.style.outline).toBe('2px solid var(--focus-ring)');
    });
  });
  describe('the hotkey fields', () => {
    const placeholderRule = (selector) =>
      [...document.styleSheets]
        .flatMap((sheet) => [...sheet.cssRules])
        .find(
          (rule) =>
            rule.selectorText?.endsWith('::placeholder') &&
            rule.selectorText.includes(selector) &&
            rule.style.getPropertyValue('font-family')
        );

    // An entity row's "None" is a hint, like the popup hotkey's "Not set": in the code face it was
    // spaced out, and Arabic, Hindi and Chinese fell to a fallback font.
    it.each(['#popup-hotkey-input', '.hotkey-input'])('sets the %s hint as text', (selector) => {
      const rule = placeholderRule(selector);
      expect(rule?.style.getPropertyValue('font-family')).toBe('var(--font-sans)');
      expect(rule?.style.getPropertyValue('letter-spacing')).toBe('0');
    });
  });

  describe('the hotkey recorder', () => {
    const CARD = `
      <div class="hotkey-capture-modal"><div class="modal-content">
        <p>Press the desired key combination...</p>
        <div id="hotkey-preview" class="hotkey-preview-box"></div>
        <p><small>Press Esc to cancel.</small></p>
        <button type="button" class="btn btn-secondary hotkey-capture-cancel">Cancel</button>
      </div></div>`;

    it('sets Cancel apart from the note above it, at the size of a dialog button', () => {
      render(CARD);
      const cancel = document.querySelector('.hotkey-capture-cancel');
      expect(resolvedValue(cancel, 'align-self')).toBe('center');
      expect(resolvedValue(cancel, 'margin-top')).toBe('0.75rem');
    });

    it('writes the Escape note small and dim', () => {
      render(CARD);
      const note = document.querySelector('small');
      expect(resolvedValue(note, 'font-size')).toBe(resolvedValue(note, '--font-size-sm'));
      expect(resolvedValue(note, 'color')).toBe(resolvedValue(note, '--text-dim'));
    });
  });
  describe('desktop pin buttons', () => {
    // Sentence case was kept for compact and micro pins only, so a roomy media pin said PLAY in
    // tracked capitals beside pins that say Play.
    it.each([
      ['a roomy media pin', 'roomy', 'desktop-pin-panel-button desktop-pin-media-play'],
      ['a balanced pin', 'balanced', 'desktop-pin-panel-button'],
      ['a compact pin', 'compact', 'desktop-pin-panel-button'],
      ['a micro pin', 'micro', 'desktop-pin-panel-button'],
    ])('writes %s button in sentence case with light tracking', (_label, layout, className) => {
      render(
        `<div class="desktop-pin-panel-control desktop-pin-media-control" data-layout="${layout}"><button class="${className}">Play</button></div>`,
        { bodyClass: 'desktop-pin-mode' }
      );
      const button = document.querySelector('button');
      expect(resolvedValue(button, 'text-transform') ?? 'none').toBe('none');
      expect(resolvedValue(button, 'letter-spacing')).toBe('0.02em');
    });
  });
  describe('a Settings field error', () => {
    // Inserted after the field's row, the error was a row of its own: 24px under the field with a
    // hairline between them.
    it("stays in its field's row, with the next row's hairline under it", () => {
      render(`
        <div id="settings-modal"><div class="settings-group-body">
          <div class="form-group"><label for="ha-url">Home Assistant URL</label><input id="ha-url" /></div>
          <p class="form-help form-error field-error" id="ha-url-error">Invalid URL: missing hostname</p>
          <p class="form-help">Browser authorization is recommended.</p>
        </div></div>`);
      const error = document.getElementById('ha-url-error');
      expect(resolvedValue(error, 'border-top')).toBe('none');
      expect(resolvedValue(error, 'padding-top')).toBe('0');
      expect(resolvedValue(error, 'margin-top')).toBe('-6px');
      expect(resolvedValue(error.nextElementSibling, 'border-top')).toMatch(/^1px solid /);
    });
  });
});

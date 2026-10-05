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

    it('stays at the top of a long list of results, over an opaque panel', () => {
      render(BOX);
      document.getElementById('settings-modal').classList.add('settings-searching');
      const box = document.querySelector('.settings-search-box');
      expect(resolvedValue(box, 'position')).toBe('sticky');
      expect(resolvedValue(box, 'top')).toBe('-18px');
      expect(resolvedValue(box, 'background')).toBe('rgb(24, 28, 37)');
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
        `<div id="settings-modal"><button type="button" id="profile-sync-passphrase-reveal" class="btn btn-secondary" aria-pressed="${pressed}">Show passphrase</button></div>`
      );
      const reveal = document.getElementById('profile-sync-passphrase-reveal');
      return ['background', 'border-color', 'box-shadow'].map((property) =>
        resolvedValue(reveal, property)
      );
    };

    it('looks pressed while the passphrase is shown', () => {
      const [background, border, ring] = button(true);
      const [plainBackground, plainBorder] = button(false);
      expect(background).not.toBe(plainBackground);
      expect(border).not.toBe(plainBorder);
      expect(ring).toMatch(/^inset 0 0 0 1px /);
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
});

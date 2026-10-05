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
});

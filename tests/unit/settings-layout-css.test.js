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
});

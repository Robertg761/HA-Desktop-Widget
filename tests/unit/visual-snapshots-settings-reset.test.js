/**
 * @jest-environment jsdom
 */

const fs = require('fs');
const path = require('path');

const { RESET_SETTINGS_VIEW } = require('../../scripts/visual-snapshots/fixture.cjs');

// Settings reopens on the page it was closed on, and with its scroll position. The runner puts it
// back after every scene, so a scene that opens Settings without picking a page sees the first one.
describe('the snapshot runner putting Settings back between scenes', () => {
  let tabClicks;

  beforeEach(() => {
    tabClicks = [];
    document.body.innerHTML = `
      <div id="settings-modal" class="modal hidden">
        <div class="modal-content">
          <div class="modal-tabs">
            <button class="tab-link active" data-tab="general"></button>
            <button class="tab-link" data-tab="hotkeys"></button>
          </div>
          <div class="modal-body"></div>
        </div>
      </div>`;
    document.querySelectorAll('.tab-link').forEach((button) =>
      // The app's own handler moves the active class; this stands in for it.
      button.addEventListener('click', () => {
        tabClicks.push(button.dataset.tab);
        document.querySelectorAll('.tab-link').forEach((other) => {
          other.classList.toggle('active', other === button);
        });
      })
    );
  });

  it('returns to the General page, at the top', () => {
    document.querySelector('[data-tab="hotkeys"]').click();
    // jsdom does no layout, so scrollTop only holds what is assigned to it.
    document.querySelector('.modal-body').scrollTop = 480;
    tabClicks = [];

    window.eval(RESET_SETTINGS_VIEW);

    expect(tabClicks).toEqual(['general']);
    expect(document.querySelector('.tab-link.active').dataset.tab).toBe('general');
    expect(document.querySelector('.modal-body').scrollTop).toBe(0);
  });

  it('does nothing before Settings has ever been built', () => {
    document.body.innerHTML = '';

    expect(() => window.eval(RESET_SETTINGS_VIEW)).not.toThrow();
  });

  it('targets a page that exists in the real Settings markup', () => {
    const html = fs.readFileSync(path.join(__dirname, '../../index.html'), 'utf8');
    const doc = new DOMParser().parseFromString(html, 'text/html');

    expect(doc.querySelector('#settings-modal .tab-link[data-tab="general"]')).not.toBeNull();
    expect(doc.querySelector('#settings-modal .modal-body')).not.toBeNull();
  });

  it('is run by the runner while Settings is still open, as a closed one ignores scroll', () => {
    const source = fs.readFileSync(
      path.join(__dirname, '../../scripts/visual-snapshots/run.cjs'),
      'utf8'
    );
    const restore = source.slice(source.indexOf('async function restore()'));
    const reset = restore.indexOf('cdp.evaluate(RESET_SETTINGS_VIEW)');

    expect(reset).toBeGreaterThan(-1);
    expect(reset).toBeLessThan(restore.indexOf('await closeDialogs();'));
  });
});

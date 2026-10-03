const fs = require('fs');
const path = require('path');
const { loadAppStylesheets, resolvedValue } = require('../helpers/css-cascade.js');

const DEFAULT = { viewport: { width: 500, height: 600 } };
const NARROW = { viewport: { width: 340, height: 600 } };
const SHORT = { viewport: { width: 340, height: 400 } };

function render(bodyClass, html) {
  document.body.className = bodyClass;
  document.body.innerHTML = html;
}

// What a dialog, a row or a tile must do so a long label, a narrow window or enlarged text cannot
// push something out of its box. Each case is one of the shared rules; the visual snapshot scenes
// named layout-* show them at the sizes and in the languages they were written for.
describe('shared layout rules for narrow windows and long labels', () => {
  beforeAll(() => {
    loadAppStylesheets(document);
  });

  afterEach(() => {
    document.body.className = '';
    document.body.innerHTML = '';
  });

  describe('dialogs', () => {
    const dialog = (modalClass = '', contentClass = '') => `
      <div class="modal ${modalClass}">
        <div class="modal-content ${contentClass}">
          <div class="modal-header"><h2>Title</h2><button class="close-btn"></button></div>
          <div class="modal-body"></div>
          <div class="modal-footer"></div>
        </div>
      </div>`;

    it('is a column capped at the window, with the body as the one scroller', () => {
      render('', dialog());
      const content = document.querySelector('.modal-content');
      expect(resolvedValue(content, 'display')).toBe('flex');
      expect(resolvedValue(content, 'flex-direction')).toBe('column');
      expect(resolvedValue(content, 'max-height')).toBe('calc(100dvh - 1.5rem)');
      const body = document.querySelector('.modal-body');
      expect(resolvedValue(body, 'flex')).toBe('1 1 auto');
      expect(resolvedValue(body, 'min-height')).toBe('0');
      expect(resolvedValue(body, 'overflow-y')).toBe('auto');
      // The 60vh cap made every dialog scroll in the default window.
      expect(resolvedValue(body, 'max-height')).toBeNull();
    });

    it.each([
      ['brightness-modal', 'brightness-modal-content'],
      ['climate-modal', 'climate-modal-content'],
      ['fan-modal', 'fan-modal-content'],
      ['cover-modal', 'cover-modal-content'],
    ])('lets the %s fill the same cap', (modalClass, contentClass) => {
      render('', dialog(modalClass, contentClass));
      const content = document.querySelector('.modal-content');
      expect(resolvedValue(content, 'max-height')).toBe('calc(100dvh - 1.5rem)');
      expect(resolvedValue(document.querySelector('.modal-body'), 'max-height')).toBeNull();
    });

    it('keeps a long title clear of the close button', () => {
      render('', dialog());
      const title = document.querySelector('.modal-header h2');
      expect(resolvedValue(title, 'min-width')).toBe('0');
      expect(resolvedValue(title, 'overflow-wrap')).toBe('anywhere');
      expect(resolvedValue(title, '-webkit-line-clamp')).toBe('2');
      expect(resolvedValue(document.querySelector('.modal-header'), 'gap')).not.toBeNull();
      expect(resolvedValue(document.querySelector('.modal-header .close-btn'), 'flex')).toBe(
        'none'
      );
    });

    it('lets the confirmation shrink with a window narrower than it', () => {
      render('', dialog('', 'confirm-modal-content'));
      const content = document.querySelector('.modal-content');
      expect(resolvedValue(content, 'min-width')).not.toBe('320px');
      expect(resolvedValue(content, 'width')).toBe('min(400px, calc(100vw - 24px))');
    });

    it('wraps a long button label instead of cutting it off', () => {
      render('', `${dialog()}<button class="btn"></button>`);
      const inDialog = document.querySelector('.modal-footer');
      inDialog.innerHTML = '<button class="btn"></button>';
      expect(resolvedValue(inDialog.firstElementChild, 'white-space')).toBe('normal');
    });

    it('stacks a list dialog so only the list scrolls', () => {
      render(
        '',
        `<div class="modal"><div class="modal-content"><div class="modal-body">
          <div class="form-group"><input /></div>
          <div class="form-group"><div class="entity-selector-list"></div></div>
        </div></div></div>`
      );
      const body = document.querySelector('.modal-body');
      expect(resolvedValue(body, 'display')).toBe('flex');
      expect(resolvedValue(body, 'flex-direction')).toBe('column');
      const list = document.querySelector('.entity-selector-list');
      expect(resolvedValue(list, 'max-height')).toBe('none');
      expect(resolvedValue(list.parentElement, 'min-height')).toBe('0');
    });

    it('leaves the lists inside Settings pages with their own cap', () => {
      render(
        '',
        `<div id="settings-modal" class="modal"><div class="modal-content"><div class="modal-body">
          <div class="tab-content"><div class="form-group"><div class="entity-selector-list"></div></div></div>
        </div></div></div>`
      );
      expect(resolvedValue(document.querySelector('.entity-selector-list'), 'max-height')).toBe(
        '400px'
      );
    });
  });

  describe('the header and the window', () => {
    it('lets the title shrink before the buttons leave the window', () => {
      render(
        '',
        '<div class="widget-header"><div class="drag-area"><span class="widget-title">T</span></div><div class="header-controls"></div></div>'
      );
      expect(resolvedValue(document.querySelector('.drag-area'), 'min-width')).toBe('0');
      expect(resolvedValue(document.querySelector('.widget-title'), 'min-width')).toBe('0');
      expect(resolvedValue(document.querySelector('.header-controls'), 'flex')).toBe('none');
    });
  });

  describe('Settings rows', () => {
    const row = `<div class="settings-group-body"><div class="form-group setting-row">
      <div class="setting-text"><label>Label</label></div><select></select></div>
      <div class="form-group setting-row setting-row-stacked"><div class="setting-text"></div></div></div>`;

    it('wraps a control under a label that would otherwise be squeezed', () => {
      render('', `<div id="settings-modal">${row}</div>`);
      const [plain, stacked] = document.querySelectorAll('.setting-row');
      expect(resolvedValue(plain, 'flex-wrap')).toBe('wrap');
      expect(resolvedValue(plain.querySelector('.setting-text'), 'flex')).toBe('1 1 9rem');
      expect(resolvedValue(plain.querySelector('select'), 'max-width')).toBe('100%');
      // A stacked row is a column, where the 9rem would be a height.
      expect(resolvedValue(stacked, 'flex-wrap')).toBe('nowrap');
      expect(resolvedValue(stacked.querySelector('.setting-text'), 'flex')).toBe('none');
    });

    it('stacks the colour cards when the pane is narrow, and keeps them in their borders', () => {
      render(
        '',
        '<div class="color-target-control"><button class="color-target-option"><span class="color-target-copy"><span class="color-target-name">Background</span></span></button></div>'
      );
      expect(
        resolvedValue(document.querySelector('.color-target-control'), 'grid-template-columns')
      ).toBe('repeat(auto-fit, minmax(min(150px, 100%), 1fr))');
      expect(resolvedValue(document.querySelector('.color-target-option'), 'min-width')).toBe('0');
      expect(resolvedValue(document.querySelector('.color-target-name'), 'overflow-wrap')).toBe(
        'anywhere'
      );
    });

    it('reserves the scrollbar gutter and caps the column so pages line up', () => {
      render(
        '',
        '<div id="settings-modal"><div class="modal-content"><div class="modal-body"><div class="tab-content"></div></div></div></div>'
      );
      const body = document.querySelector('.modal-body');
      expect(resolvedValue(body, 'scrollbar-gutter')).toBe('stable');
      const page = document.querySelector('.tab-content');
      expect(resolvedValue(page, 'max-width')).toBe('680px');
      expect(resolvedValue(page, 'margin-inline')).toBe('auto');
    });

    it('lays hotkey rows out in two tiers with a clear button that keeps its place', () => {
      render(
        '',
        `<div class="hotkey-item"><span class="entity-name">Name</span>
          <div class="hotkey-input-container"><input class="hotkey-input" placeholder="None" />
          <button class="btn-clear-hotkey"></button></div></div>`
      );
      expect(resolvedValue(document.querySelector('.hotkey-item .entity-name'), 'flex')).toBe(
        '1 1 100%'
      );
      expect(
        resolvedValue(document.querySelector('.hotkey-item .entity-name'), '-webkit-line-clamp')
      ).toBe('2');
      expect(resolvedValue(document.querySelector('.hotkey-input-container'), 'flex-wrap')).toBe(
        'wrap'
      );
      // Hidden, not removed: removing it moved the row's controls as a hotkey was set.
      expect(resolvedValue(document.querySelector('.btn-clear-hotkey'), 'visibility')).toBe(
        'hidden'
      );
    });

    it('wraps list row actions under the name', () => {
      render('', '<div class="entity-item"><div class="entity-item-main"></div></div>');
      expect(resolvedValue(document.querySelector('.entity-item'), 'flex-wrap')).toBe('wrap');
      expect(resolvedValue(document.querySelector('.entity-item-main'), 'flex')).toBe('1 1 9rem');
    });
  });

  describe('tiles', () => {
    const tile = (extra = '') => `<div id="quick-controls"><div class="control-item ${extra}">
      <div class="control-icon"></div><div class="control-info"><div class="control-name">n</div><div class="control-state">s</div></div></div></div>`;

    it('clamps a long name to two lines, one in compact density, and the state to one', () => {
      render('', tile());
      const name = document.querySelector('.control-name');
      expect(resolvedValue(name, '-webkit-line-clamp')).toBe('2');
      expect(resolvedValue(document.querySelector('.control-item'), 'justify-content')).toBe(
        'safe center'
      );
      expect(resolvedValue(document.querySelector('.control-state'), 'white-space')).toBe('nowrap');
      render('density-compact', tile());
      expect(resolvedValue(document.querySelector('.control-name'), '-webkit-line-clamp')).toBe(
        '1'
      );
    });

    it('does not clamp a comparison graph or media tile name', () => {
      render('', tile('media-player-entity'));
      expect(
        resolvedValue(document.querySelector('.control-name'), '-webkit-line-clamp')
      ).toBeNull();
    });

    it('keeps the name larger than the state line in a narrow window', () => {
      render('', tile());
      const name = document.querySelector('.control-name');
      const state = document.querySelector('.control-state');
      expect(resolvedValue(name, 'font-size', DEFAULT)).not.toBeNull();
      expect(resolvedValue(name, 'font-size', NARROW)).toBe(
        resolvedValue(name, 'font-size', DEFAULT)
      );
      expect(resolvedValue(state, 'font-size', NARROW)).toBe(
        resolvedValue(state, 'font-size', DEFAULT)
      );
    });

    it('keeps the weather and clock side by side at enlarged text only', () => {
      render('', '<div class="status-grid"></div>');
      const grid = document.querySelector('.status-grid');
      expect(resolvedValue(grid, 'grid-template-columns', NARROW)).toBe('1fr');
      render('large-interface', '<div class="status-grid"></div>');
      expect(
        resolvedValue(document.querySelector('.status-grid'), 'grid-template-columns', NARROW)
      ).toBe('1fr 1fr');
    });

    it('trims the hero cards in a window that is narrow and short', () => {
      render('', '<div class="status-card weather-card"></div>');
      const card = document.querySelector('.status-card');
      expect(resolvedValue(card, 'min-height', SHORT)).toBe('0');
      expect(resolvedValue(card, 'padding', SHORT)).toBe('10px');
      expect(resolvedValue(card, 'min-height', DEFAULT)).toBe('104px');
    });

    it('gives the media tile the padding and gap it has at the default size when narrow', () => {
      render('', '<div class="media-tile"></div>');
      const media = document.querySelector('.media-tile');
      expect(resolvedValue(media, 'padding', DEFAULT)).not.toBeNull();
      expect(resolvedValue(media, 'padding', NARROW)).toBe(
        resolvedValue(media, 'padding', DEFAULT)
      );
    });

    it('draws the seek times at their own width', () => {
      render('', '<div class="media-tile-seek"><span class="media-tile-time">1:12:30</span></div>');
      const time = document.querySelector('.media-tile-time');
      expect(resolvedValue(time, 'flex')).toBe('none');
      expect(resolvedValue(time, 'white-space')).toBe('nowrap');
      expect(resolvedValue(document.querySelector('.media-tile-seek'), 'max-width')).toBeNull();
    });
  });

  describe('toasts, the palette and pop-ups', () => {
    it('spans the window so a toast can be as wide as it wants', () => {
      render('', '<div class="toast-container"><div class="toast"></div></div>');
      const container = document.querySelector('.toast-container');
      expect(resolvedValue(container, 'left')).toBe('0');
      expect(resolvedValue(container, 'right')).toBe('0');
      expect(resolvedValue(container, 'transform')).toBeNull();
      expect(resolvedValue(document.querySelector('.toast'), 'max-width')).toBe('min(420px, 100%)');
    });

    it('gives a palette name a floor and lets the type pill give way', () => {
      render(
        '',
        '<button class="command-palette-result"><span class="command-palette-result-domain"></span></button>'
      );
      expect(
        resolvedValue(document.querySelector('.command-palette-result'), 'grid-template-columns')
      ).toBe('30px minmax(140px, 1fr) minmax(0, auto)');
      const pill = document.querySelector('.command-palette-result-domain');
      expect(resolvedValue(pill, 'flex')).toBe('0 1 auto');
      expect(resolvedValue(pill, 'display', DEFAULT)).toBeNull();
      expect(resolvedValue(pill, 'display', { viewport: { width: 400, height: 600 } })).toBe(
        'none'
      );
    });

    it('keeps the climate target on one line and the colour picker its size', () => {
      render(
        '',
        '<div class="climate-temp-display is-range"><div class="climate-target-temp"><div class="climate-temp-value-large"></div></div></div><input class="light-color-picker" />'
      );
      const value = document.querySelector('.climate-temp-value-large');
      expect(resolvedValue(value, 'white-space')).toBe('nowrap');
      expect(
        resolvedValue(document.querySelector('.climate-temp-display'), 'grid-template-columns')
      ).toBe('auto minmax(0, 1fr)');
      expect(resolvedValue(document.querySelector('.light-color-picker'), 'flex')).toBe('0 0 44px');
    });

    it('sizes the clock to its card instead of ending it with an ellipsis', () => {
      render('', '<div class="status-card time-card"><div class="time-display"></div></div>');
      expect(resolvedValue(document.querySelector('.time-card'), 'container-type')).toBe(
        'inline-size'
      );
      expect(resolvedValue(document.querySelector('.time-display'), 'font-size')).toContain('cqi');
    });
  });

  describe('main.js', () => {
    const main = fs.readFileSync(path.resolve(__dirname, '../../main.js'), 'utf8');

    it('opens the main window with a minimum size that follows the text size', () => {
      expect(main).toMatch(/minWidth: minimumSize\.width,\s*minHeight: minimumSize\.height,/);
      expect(main).toMatch(/previousConfig\?\.ui\?\.scale !== nextConfig\?\.ui\?\.scale/);
      expect(main).toContain('mainWindow.setMinimumSize(minimumSize.width, minimumSize.height)');
    });
  });
});

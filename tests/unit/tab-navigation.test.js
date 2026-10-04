/**
 * @jest-environment jsdom
 */

const fs = require('fs');
const path = require('path');
const {
  bindTabListKeyboard,
  bindTabListOrientation,
  bindTabTooltips,
  getNextTabIndex,
  getTextDirection,
  syncRovingTabIndex,
} = require('../../src/tab-navigation.js');

describe('tab navigation', () => {
  describe('getNextTabIndex', () => {
    it('moves along a horizontal list with the left and right arrows, wrapping at the ends', () => {
      expect(getNextTabIndex(1, 4, 'ArrowRight')).toBe(2);
      expect(getNextTabIndex(1, 4, 'ArrowLeft')).toBe(0);
      expect(getNextTabIndex(3, 4, 'ArrowRight')).toBe(0);
      expect(getNextTabIndex(0, 4, 'ArrowLeft')).toBe(3);
    });

    it('swaps the arrows in right-to-left text, so each still points where it moves', () => {
      expect(getNextTabIndex(1, 4, 'ArrowLeft', { direction: 'rtl' })).toBe(2);
      expect(getNextTabIndex(1, 4, 'ArrowRight', { direction: 'rtl' })).toBe(0);
      expect(getNextTabIndex(0, 4, 'ArrowRight', { direction: 'rtl' })).toBe(3);
    });

    it('goes to the first and last tab with Home and End', () => {
      expect(getNextTabIndex(2, 4, 'Home')).toBe(0);
      expect(getNextTabIndex(1, 4, 'End')).toBe(3);
    });

    it('answers only the arrows of its orientation', () => {
      expect(getNextTabIndex(1, 4, 'ArrowDown')).toBe(-1);
      expect(getNextTabIndex(1, 4, 'ArrowDown', { orientation: 'vertical' })).toBe(2);
      expect(getNextTabIndex(1, 4, 'ArrowUp', { orientation: 'vertical' })).toBe(0);
      expect(getNextTabIndex(1, 4, 'ArrowRight', { orientation: 'vertical' })).toBe(-1);
      // A list that can lay out either way answers both pairs; text direction only affects one.
      expect(getNextTabIndex(1, 4, 'ArrowDown', { orientation: 'both', direction: 'rtl' })).toBe(2);
      expect(getNextTabIndex(1, 4, 'ArrowLeft', { orientation: 'both', direction: 'rtl' })).toBe(2);
    });

    it('ignores other keys and empty lists, and treats a missing current tab as the first', () => {
      expect(getNextTabIndex(1, 4, 'a')).toBe(-1);
      expect(getNextTabIndex(0, 0, 'ArrowRight')).toBe(-1);
      expect(getNextTabIndex(-1, 4, 'ArrowRight')).toBe(1);
      expect(getNextTabIndex(undefined, 4, 'ArrowLeft')).toBe(3);
    });
  });

  describe('syncRovingTabIndex', () => {
    it('leaves the selected tab as the only Tab stop', () => {
      document.body.innerHTML = '<button></button><button></button><button></button>';
      const tabs = [...document.querySelectorAll('button')];
      syncRovingTabIndex(tabs, tabs[1]);
      expect(tabs.map((tab) => tab.tabIndex)).toEqual([-1, 0, -1]);
    });

    it('falls back to the first tab when none is selected', () => {
      document.body.innerHTML = '<button></button><button></button>';
      const tabs = [...document.querySelectorAll('button')];
      syncRovingTabIndex(tabs, undefined);
      expect(tabs.map((tab) => tab.tabIndex)).toEqual([0, -1]);
    });
  });

  describe('bindTabListKeyboard', () => {
    let tablist;
    let clicked;

    beforeEach(() => {
      document.body.innerHTML = `
        <div id="list" role="tablist">
          <button class="tab" data-tab="a">A</button>
          <button class="tab" data-tab="b">B</button>
          <button class="tab" data-tab="c">C</button>
          <button class="other">Not a tab</button>
        </div>`;
      tablist = document.getElementById('list');
      clicked = [];
      tablist
        .querySelectorAll('.tab')
        .forEach((tab) => tab.addEventListener('click', () => clicked.push(tab.dataset.tab)));
    });

    const press = (target, key, init = {}) => {
      const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...init });
      target.dispatchEvent(event);
      return event;
    };

    it('focuses and selects the tab an arrow key leads to', () => {
      bindTabListKeyboard(tablist, '.tab');
      const [a, b, c] = tablist.querySelectorAll('.tab');
      a.focus();

      const event = press(a, 'ArrowRight');
      expect(event.defaultPrevented).toBe(true);
      expect(document.activeElement).toBe(b);
      expect(clicked).toEqual(['b']);

      press(b, 'End');
      expect(document.activeElement).toBe(c);
      press(c, 'ArrowRight');
      expect(document.activeElement).toBe(a);
      expect(clicked).toEqual(['b', 'c', 'a']);
    });

    it('follows the text direction of the list', () => {
      bindTabListKeyboard(tablist, '.tab');
      tablist.style.direction = 'rtl';
      expect(getTextDirection(tablist)).toBe('rtl');
      const [a, b] = tablist.querySelectorAll('.tab');
      a.focus();
      press(a, 'ArrowLeft');
      expect(document.activeElement).toBe(b);
    });

    it('leaves the keys alone while the list is not a tablist', () => {
      bindTabListKeyboard(tablist, '.tab');
      const [a] = tablist.querySelectorAll('.tab');
      a.focus();

      tablist.setAttribute('role', 'group');
      expect(press(a, 'ArrowRight').defaultPrevented).toBe(false);
      expect(press(a, 'End').defaultPrevented).toBe(false);
      expect(clicked).toEqual([]);

      tablist.setAttribute('role', 'tablist');
      expect(press(a, 'ArrowRight').defaultPrevented).toBe(true);
      expect(clicked).toEqual(['b']);
    });

    it('leaves keys with modifiers, other keys and other buttons alone', () => {
      bindTabListKeyboard(tablist, '.tab');
      const [a] = tablist.querySelectorAll('.tab');
      const other = tablist.querySelector('.other');
      a.focus();

      expect(press(a, 'ArrowRight', { altKey: true }).defaultPrevented).toBe(false);
      expect(press(a, 'ArrowRight', { ctrlKey: true }).defaultPrevented).toBe(false);
      expect(press(a, 'ArrowDown').defaultPrevented).toBe(false);
      other.focus();
      expect(press(other, 'ArrowRight').defaultPrevented).toBe(false);
      expect(clicked).toEqual([]);
    });
  });
});

describe('bindTabListOrientation', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('follows the layout of the list as the window is resized', () => {
    document.body.innerHTML = '<div id="rail" role="tablist" aria-orientation="vertical"></div>';
    const rail = document.getElementById('rail');
    let flexDirection = 'column';
    jest
      .spyOn(window, 'getComputedStyle')
      .mockImplementation(() => ({ flexDirection, direction: 'ltr' }));

    bindTabListOrientation(rail);
    expect(rail.getAttribute('aria-orientation')).toBe('vertical');

    flexDirection = 'row';
    window.dispatchEvent(new Event('resize'));
    expect(rail.getAttribute('aria-orientation')).toBe('horizontal');

    flexDirection = 'column';
    window.dispatchEvent(new Event('resize'));
    expect(rail.getAttribute('aria-orientation')).toBe('vertical');
  });
});

describe('bindTabTooltips', () => {
  let rail;
  let host;
  const bubble = () => host.querySelector('.tab-tooltip');

  beforeEach(() => {
    document.body.innerHTML = `
      <div class="modal-content" id="host">
        <div role="tablist" aria-orientation="vertical" id="rail">
          <button role="tab" class="tab-link" id="t1"><span class="tab-link-label"> General </span></button>
          <button role="tab" class="tab-link" id="t2"><span class="tab-link-label">Appearance</span></button>
          <button role="tab" class="tab-link" id="t3"><span class="tab-link-icon"></span></button>
        </div>
      </div>`;
    rail = document.getElementById('rail');
    host = document.getElementById('host');
    bindTabTooltips(rail, '.tab-link');
  });

  it('names the tab under the pointer, beside the rail, and hides it when the pointer leaves', () => {
    const tab = document.getElementById('t2');
    tab.dispatchEvent(new Event('pointerover', { bubbles: true }));
    expect(bubble().textContent).toBe('Appearance');
    expect(bubble().classList.contains('visible')).toBe(true);
    // It labels a control that already has its name, so a screen reader would hear it twice.
    expect(bubble().getAttribute('aria-hidden')).toBe('true');

    tab.dispatchEvent(new Event('pointerout', { bubbles: true }));
    expect(bubble().classList.contains('visible')).toBe(false);
  });

  it('shows the label on keyboard focus too, and trims the text', () => {
    document.getElementById('t1').dispatchEvent(new Event('focusin', { bubbles: true }));
    expect(bubble().textContent).toBe('General');
    rail.dispatchEvent(new Event('focusout'));
    expect(bubble().classList.contains('visible')).toBe(false);
  });

  it('hides when a page is chosen or the rail scrolls, since the tab has moved off its label', () => {
    for (const eventName of ['click', 'scroll']) {
      document.getElementById('t1').dispatchEvent(new Event('focusin', { bubbles: true }));
      expect(bubble().classList.contains('visible')).toBe(true);
      rail.dispatchEvent(new Event(eventName));
      expect(bubble().classList.contains('visible')).toBe(false);
    }
  });

  it('says nothing for a tab with no label, and creates one bubble however often it is shown', () => {
    document.getElementById('t3').dispatchEvent(new Event('pointerover', { bubbles: true }));
    expect(bubble()).toBeNull();
    for (const id of ['t1', 't2', 't1']) {
      document.getElementById(id).dispatchEvent(new Event('pointerover', { bubbles: true }));
    }
    expect(host.querySelectorAll('.tab-tooltip')).toHaveLength(1);
  });

  it('binds a list once', () => {
    bindTabTooltips(rail, '.tab-link');
    document.getElementById('t1').dispatchEvent(new Event('pointerover', { bubbles: true }));
    expect(host.querySelectorAll('.tab-tooltip')).toHaveLength(1);
  });
});

describe('Settings rail markup', () => {
  const html = fs.readFileSync(path.resolve(__dirname, '../../index.html'), 'utf8');
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const tabs = [...doc.querySelectorAll('#settings-modal .modal-tabs [role="tab"]')];

  it('wires every tab to its panel and back', () => {
    expect(tabs).toHaveLength(6);
    for (const tab of tabs) {
      const panel = doc.getElementById(tab.getAttribute('aria-controls'));
      expect(panel).not.toBeNull();
      expect(panel.getAttribute('role')).toBe('tabpanel');
      expect(panel.getAttribute('aria-labelledby')).toBe(tab.id);
      expect(panel.id).toBe(`${tab.dataset.tab}-tab`);
    }
  });

  it('makes only the selected tab a Tab stop', () => {
    const stops = tabs.filter((tab) => tab.getAttribute('tabindex') !== '-1');
    expect(stops).toHaveLength(1);
    expect(stops[0].getAttribute('aria-selected')).toBe('true');
  });
});

/**
 * @jest-environment jsdom
 */

const fs = require('fs');
const path = require('path');
const {
  bindTabListKeyboard,
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
        <div id="list">
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

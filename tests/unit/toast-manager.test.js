/**
 * @jest-environment jsdom
 */

// One manager owns the toast stack: what stays and for how long, what is announced, what the stack
// keeps clear of, and what happens when there are too many or the same one twice.

const { createMockElectronAPI } = require('../mocks/electron.js');

window.electronAPI = createMockElectronAPI();
Object.defineProperty(window, 'matchMedia', {
  writable: true,
  configurable: true,
  value: jest.fn().mockImplementation((query) => ({ matches: false, media: query })),
});

const uiUtils = require('../../src/ui-utils.js');

const container = () => document.getElementById('toast-container');
const toasts = () => [...container().querySelectorAll('.toast')];
const messages = () => toasts().map((toast) => toast.querySelector('.toast-message').textContent);
const setRect = (element, rect) => {
  element.getClientRects = () => [{}];
  element.getBoundingClientRect = () => ({ left: 0, right: 100, ...rect });
};

beforeEach(() => {
  document.body.className = '';
  document.body.innerHTML = '<div id="toast-container" role="status"></div>';
  jest.useFakeTimers();
  // The exit animation is skipped under NODE_ENV=test; the timers are what these tests are about.
  uiUtils.__forceAnimatedModalTransitions(false);
});

afterEach(() => {
  jest.runOnlyPendingTimers();
  jest.useRealTimers();
});

describe('what stays on screen, and for how long', () => {
  it('lets a success or an info toast go after its timeout', () => {
    uiUtils.showToast('Saved', 'success', 2000);
    uiUtils.showToast('FYI', 'info', 3000);

    jest.advanceTimersByTime(2100);
    expect(messages()).toEqual(['FYI']);
    jest.advanceTimersByTime(1000);
    expect(messages()).toEqual([]);
  });

  it('keeps an error until it is dismissed, whatever timeout the caller gave', () => {
    const toast = uiUtils.showToast('Failed to toggle Bed Light', 'error', 2000);

    jest.advanceTimersByTime(10 * 60 * 1000);

    expect(toast.isConnected).toBe(true);
  });

  it('lets an error in a pin window go after a reading time, as a 168px pin cannot hold it', () => {
    document.body.classList.add('desktop-pin-mode');
    const toast = uiUtils.showToast('Failed to toggle Bed Light', 'error', 2000);

    // The same floor as a warning, so the sentence can be read first.
    jest.advanceTimersByTime(5900);
    expect(toast.isConnected).toBe(true);
    jest.advanceTimersByTime(200 + 300);
    expect(toast.isConnected).toBe(false);
  });

  it('still holds a pin error while it is under the pointer, then resumes its clock', () => {
    document.body.classList.add('desktop-pin-mode');
    const toast = uiUtils.showToast('Could not run command', 'error', 2000);

    toast.dispatchEvent(new Event('pointerenter'));
    jest.advanceTimersByTime(60 * 1000);
    expect(toast.isConnected).toBe(true);

    toast.dispatchEvent(new Event('pointerleave'));
    jest.advanceTimersByTime(5900);
    expect(toast.isConnected).toBe(true);
    jest.advanceTimersByTime(200 + 300);
    expect(toast.isConnected).toBe(false);
  });

  it('refreshes the clock of a repeated pin error instead of stacking it', () => {
    document.body.classList.add('desktop-pin-mode');
    const first = uiUtils.showToast('Failed to toggle Bed Light', 'error', 2000);
    jest.advanceTimersByTime(4000);
    const again = uiUtils.showToast('Failed to toggle Bed Light', 'error', 2000);

    expect(again).toBe(first);
    jest.advanceTimersByTime(4000);
    expect(first.isConnected).toBe(true);
    jest.advanceTimersByTime(2100 + 300);
    expect(first.isConnected).toBe(false);
  });

  it('keeps a warning long enough to read, in proportion to its length', () => {
    uiUtils.showToast('Short', 'warning', 1000);
    const long = 'x'.repeat(300);
    uiUtils.showToast(long, 'warning', 1000);

    jest.advanceTimersByTime(5900);
    expect(messages()).toHaveLength(2);
    jest.advanceTimersByTime(200);
    // The short one is gone after the 6 s floor; the long one needs 1.5 s plus 55 ms a character.
    expect(messages()).toEqual([long]);
    jest.advanceTimersByTime(1500 + 55 * 300);
    expect(messages()).toEqual([]);
  });

  it('treats an unknown type as information', () => {
    const toast = uiUtils.showToast('Hello', 'surprise', 1000);

    expect(toast.className).toBe('toast info');
  });
});

describe('what is announced', () => {
  it('raises errors and warnings as alerts, and leaves the rest to the polite container', () => {
    // Three at a time is all the stack holds.
    uiUtils.showToast('Broken', 'error');
    uiUtils.showToast('Careful', 'warning');
    uiUtils.showToast('Done', 'success');
    expect(toasts().map((toast) => toast.getAttribute('role'))).toEqual(['alert', 'alert', null]);

    uiUtils.dismissToast(toasts()[0]);
    uiUtils.dismissToast(toasts()[0]);
    jest.advanceTimersByTime(300);
    uiUtils.showToast('FYI', 'info');
    expect(toasts().map((toast) => toast.getAttribute('role'))).toEqual([null, null]);
    expect(container().getAttribute('role')).toBe('status');
  });

  it('draws the status icon from the line icon set, aria-hidden', () => {
    const icon = (type) => {
      document.body.innerHTML = '<div id="toast-container" role="status"></div>';
      return uiUtils.showToast(`A ${type}`, type).querySelector('.toast-icon');
    };

    const icons = ['success', 'error', 'warning', 'info'].map(icon);

    expect(icons.map((node) => node.querySelector('svg').dataset.icon)).toEqual([
      'circle-check',
      'circle-x',
      'triangle-alert',
      'info',
    ]);
    icons.forEach((node) => expect(node.getAttribute('aria-hidden')).toBe('true'));
  });
});

describe('dismissing', () => {
  it('has a close button on errors and warnings, for the pointer, that is not a second Tab stop', () => {
    const error = uiUtils.showToast('Broken', 'error');
    const info = uiUtils.showToast('FYI', 'info');

    const close = error.querySelector('.toast-close');
    expect(close.getAttribute('aria-label')).toBe('Close');
    expect(close.tabIndex).toBe(-1);
    expect(info.querySelector('.toast-close')).toBeNull();

    close.click();
    jest.advanceTimersByTime(300);
    expect(error.isConnected).toBe(false);
  });

  it('is dismissed from the keyboard with Enter, Space or Escape on the toast', () => {
    const [enter, space, escape] = ['a', 'b', 'c'].map((name) => uiUtils.showToast(name, 'error'));
    const press = (toast, name) =>
      toast.dispatchEvent(new KeyboardEvent('keydown', { key: name, bubbles: true }));

    expect(enter.tabIndex).toBe(0);
    press(enter, 'Enter');
    press(space, ' ');
    press(escape, 'Escape');
    jest.advanceTimersByTime(300);

    expect(toasts()).toHaveLength(0);
  });

  it('hands focus back to where it was when the focused toast goes', () => {
    document.body.insertAdjacentHTML('beforeend', '<button id="work">Work</button>');
    const work = document.getElementById('work');
    work.focus();
    const toast = uiUtils.showToast('Broken', 'error');

    // Tab to the toast (focus comes from the control the user was on), then dismiss it.
    toast.dispatchEvent(new FocusEvent('focusin', { bubbles: true, relatedTarget: work }));
    toast.focus();
    uiUtils.dismissToast(toast);

    expect(document.activeElement).toBe(work);
  });

  it('is dismissed newest first by Escape when no dialog is open, but not while typing', () => {
    document.body.insertAdjacentHTML('beforeend', '<input id="field">');
    uiUtils.showToast('older', 'error');
    uiUtils.showToast('newer', 'error');
    const escape = (target) => {
      const event = new KeyboardEvent('keydown', {
        key: 'Escape',
        bubbles: true,
        cancelable: true,
      });
      target.dispatchEvent(event);
      return event;
    };

    escape(document.getElementById('field'));
    expect(messages()).toEqual(['older', 'newer']);

    expect(escape(document.body).defaultPrevented).toBe(true);
    jest.advanceTimersByTime(300);
    expect(messages()).toEqual(['older']);
  });

  it('leaves Escape to an open dialog, which closes before any toast does', () => {
    const modal = document.createElement('div');
    modal.className = 'modal';
    modal.innerHTML = '<div class="modal-content"><button id="in">in</button></div>';
    document.body.appendChild(modal);
    const dismiss = jest.fn();
    uiUtils.openDialog(modal, { dismiss });
    uiUtils.showToast('stays', 'error');

    document.body.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })
    );

    expect(dismiss).toHaveBeenCalledTimes(1);
    expect(messages()).toEqual(['stays']);
  });

  it('can take down every toast a caller tagged, and none of the others', () => {
    uiUtils.showToast('offline', 'error', 1000, { source: 'connection' });
    uiUtils.showToast('keyring', 'warning', 1000, { source: 'startup-warning' });
    uiUtils.showToast('still offline', 'error', 1000, { source: 'connection' });

    uiUtils.dismissToasts('connection');
    jest.advanceTimersByTime(300);

    expect(messages()).toEqual(['keyring']);
  });
});

describe('looking at a toast', () => {
  it('stops the clock while the pointer is on it, then gives it a moment more', () => {
    const toast = uiUtils.showToast('Reading this', 'info', 2000);

    jest.advanceTimersByTime(1500);
    toast.dispatchEvent(new Event('pointerenter'));
    jest.advanceTimersByTime(60000);
    expect(toast.isConnected).toBe(true);

    toast.dispatchEvent(new Event('pointerleave'));
    // 500 ms were left, which is less than the moment it is given to see it go.
    jest.advanceTimersByTime(1400);
    expect(toast.isConnected).toBe(true);
    jest.advanceTimersByTime(200);
    expect(toast.isConnected).toBe(false);
  });

  it('stops the clock while it has keyboard focus, and not while only one of the two holds it', () => {
    const toast = uiUtils.showToast('Reading this', 'info', 2000);

    toast.dispatchEvent(new Event('pointerenter'));
    toast.dispatchEvent(new FocusEvent('focusin', { bubbles: true }));
    toast.dispatchEvent(new Event('pointerleave'));
    jest.advanceTimersByTime(60000);
    expect(toast.isConnected).toBe(true);

    toast.dispatchEvent(new FocusEvent('focusout', { bubbles: true }));
    jest.advanceTimersByTime(2000);
    expect(toast.isConnected).toBe(false);
  });

  it('keeps a notice that asks nothing out of the pointer and the Tab order', () => {
    const toast = uiUtils.showToast('Reorganize mode on', 'info', 3000, { passive: true });

    expect(toast.classList.contains('toast-passive')).toBe(true);
    expect(toast.hasAttribute('tabindex')).toBe(false);
    toast.click();
    expect(toast.classList.contains('toast-closing')).toBe(false);
    jest.advanceTimersByTime(3100);
    expect(toast.isConnected).toBe(false);
  });
});

describe('the same toast twice, and too many', () => {
  it('folds an identical toast into the one showing and restarts its clock', () => {
    const first = uiUtils.showToast('Failed to toggle', 'warning', 1000);
    jest.advanceTimersByTime(4000);

    const second = uiUtils.showToast('Failed to toggle', 'warning', 1000);

    expect(second).toBe(first);
    expect(toasts()).toHaveLength(1);
    // A fresh clock: it has the full 6 s again, not the 2 s that were left.
    jest.advanceTimersByTime(5000);
    expect(first.isConnected).toBe(true);
  });

  it('does not fold a toast of another kind with the same words', () => {
    uiUtils.showToast('Done', 'success');
    uiUtils.showToast('Done', 'error');

    expect(toasts()).toHaveLength(2);
  });

  it('keeps at most three, letting go of the oldest first', () => {
    ['one', 'two', 'three', 'four', 'five'].forEach((name) =>
      uiUtils.showToast(name, 'info', 9999)
    );
    jest.advanceTimersByTime(300);

    expect(messages()).toEqual(['three', 'four', 'five']);
  });

  it('lets go of a success before an error that may not have been read', () => {
    uiUtils.showToast('error one', 'error');
    uiUtils.showToast('saved', 'success', 9999);
    uiUtils.showToast('error two', 'error');
    uiUtils.showToast('error three', 'error');
    jest.advanceTimersByTime(300);

    expect(messages()).toEqual(['error one', 'error two', 'error three']);
  });

  it('holds one toast at a time in a pin window, which is 168px tall', () => {
    document.body.classList.add('desktop-pin-mode');
    uiUtils.showToast('one', 'info', 9999);
    uiUtils.showToast('two', 'info', 9999);
    jest.advanceTimersByTime(300);

    expect(messages()).toEqual(['two']);
  });
});

describe('keeping clear of what the toast belongs to', () => {
  const footer = (top) => {
    const modal = document.createElement('div');
    modal.className = 'modal';
    modal.innerHTML =
      '<div class="modal-content"><div class="modal-footer"><button>Save</button></div></div>';
    document.body.appendChild(modal);
    setRect(modal.querySelector('.modal-footer'), { top, bottom: top + 40 });
    return modal;
  };

  it('stacks above an open dialog footer, even for a toast that was already showing', () => {
    uiUtils.showToast('Already up', 'error');
    expect(container().style.bottom).toBe('');

    const modal = footer(window.innerHeight - 60);
    uiUtils.openDialog(modal);

    // The dialog opening is what lifts the stack: nothing new was shown.
    expect(container().style.bottom).toBe('68px');
  });

  it('comes back down when the dialog closes, whether or not another toast is shown', async () => {
    const modal = footer(window.innerHeight - 60);
    uiUtils.openDialog(modal);
    uiUtils.showToast('Over the dialog', 'error');
    expect(container().style.bottom).toBe('68px');

    await uiUtils.closeDialog(modal);

    expect(container().style.bottom).toBe('');
  });

  it('follows a dialog that changes size, on resize', () => {
    const modal = footer(window.innerHeight - 60);
    uiUtils.openDialog(modal);
    uiUtils.showToast('Over the dialog', 'error');

    setRect(modal.querySelector('.modal-footer'), {
      top: window.innerHeight - 120,
      bottom: window.innerHeight - 80,
    });
    window.dispatchEvent(new Event('resize'));

    expect(container().style.bottom).toBe('128px');
  });

  it('ignores the footer of a dialog that is closing', () => {
    const modal = footer(window.innerHeight - 60);
    modal.classList.add('modal-closing');
    uiUtils.showToast('After it', 'error');

    expect(container().style.bottom).toBe('');
  });

  it('stays above the first-run wizard buttons and the connection panel buttons', () => {
    document.body.insertAdjacentHTML(
      'beforeend',
      '<div class="first-run-onboarding"><div class="first-run-actions"></div></div>'
    );
    setRect(document.querySelector('.first-run-actions'), {
      top: window.innerHeight - 90,
      bottom: window.innerHeight - 50,
    });
    uiUtils.showToast('Over the wizard', 'error');
    expect(container().style.bottom).toBe('98px');

    document.querySelector('.first-run-onboarding').remove();
    document.body.insertAdjacentHTML(
      'beforeend',
      '<div class="widget-state-panel"><div class="widget-state-actions"></div></div>'
    );
    setRect(document.querySelector('.widget-state-actions'), {
      top: window.innerHeight - 140,
      bottom: window.innerHeight - 100,
    });
    uiUtils.showToast('Over the panel', 'error');
    expect(container().style.bottom).toBe('148px');
  });

  it('leaves a surface that has scrolled out of view alone', () => {
    document.body.insertAdjacentHTML(
      'beforeend',
      '<div class="widget-state-panel"><div class="widget-state-actions"></div></div>'
    );
    setRect(document.querySelector('.widget-state-actions'), {
      top: window.innerHeight + 200,
      bottom: window.innerHeight + 240,
    });
    uiUtils.showToast('Nothing to cover', 'error');

    expect(container().style.bottom).toBe('');
  });

  it('prefers the dialog over what is behind it', () => {
    document.body.insertAdjacentHTML(
      'beforeend',
      '<div class="widget-state-panel"><div class="widget-state-actions"></div></div>'
    );
    setRect(document.querySelector('.widget-state-actions'), {
      top: window.innerHeight - 140,
      bottom: window.innerHeight - 100,
    });
    const modal = footer(window.innerHeight - 60);
    uiUtils.openDialog(modal);
    uiUtils.showToast('Over the dialog', 'error');

    expect(container().style.bottom).toBe('68px');
  });
});

describe('without a toast container', () => {
  it('returns nothing and throws nothing', () => {
    document.body.innerHTML = '';

    expect(uiUtils.showToast('Nowhere', 'error')).toBeUndefined();
    expect(() => uiUtils.layoutToasts()).not.toThrow();
  });
});

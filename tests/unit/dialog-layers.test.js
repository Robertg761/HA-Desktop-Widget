/**
 * @jest-environment jsdom
 */

// Every dialog opens through openDialog() and closes through closeDialog(); this is the contract
// they share: role and name, focus in and back out, which dialog Escape, Enter and the backdrop act
// on, and stacking. Each dialog's own keyboard test lives with the dialog.

const { createMockElectronAPI } = require('../mocks/electron.js');

window.electronAPI = createMockElectronAPI();
Object.defineProperty(window, 'matchMedia', {
  writable: true,
  configurable: true,
  value: jest.fn().mockImplementation((query) => ({ matches: false, media: query })),
});

const uiUtils = require('../../src/ui-utils.js');

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));
const key = (target, name, init = {}) => {
  const event = new KeyboardEvent('keydown', {
    key: name,
    bubbles: true,
    cancelable: true,
    ...init,
  });
  target.dispatchEvent(event);
  return event;
};

function dialog(id, body = '<input id="field"><button id="action">Do</button>', extra = '') {
  const modal = document.createElement('div');
  modal.id = id;
  modal.className = 'modal';
  modal.innerHTML = `
    <div class="modal-content">
      <div class="modal-header"><h2>Title of ${id}</h2><button class="close-btn">x</button></div>
      <div class="modal-body">${body}</div>
      ${extra}
    </div>`;
  document.body.appendChild(modal);
  return modal;
}

afterEach(async () => {
  // Nothing may stay open into the next test: the layers are module state.
  document.querySelectorAll('.modal').forEach((modal) => {
    uiUtils.releaseFocusTrap(modal, { restoreFocus: false });
    modal.remove();
  });
  document.body.innerHTML = '';
  await tick();
});

describe('opening a dialog', () => {
  it('gives it a role, makes it modal and names it by its heading', () => {
    const modal = dialog('a');
    uiUtils.openDialog(modal);

    expect(modal.getAttribute('role')).toBe('dialog');
    expect(modal.getAttribute('aria-modal')).toBe('true');
    const name = document.getElementById(modal.getAttribute('aria-labelledby'));
    expect(name.textContent).toBe('Title of a');
    expect(modal.classList.contains('hidden')).toBe(false);
  });

  it('uses an alertdialog for a question that must be answered, with its text as the description', () => {
    const modal = dialog('confirm', '<p id="msg">Delete it?</p><button id="no">No</button>');
    uiUtils.openDialog(modal, { alert: true, describedBy: 'msg' });

    expect(modal.getAttribute('role')).toBe('alertdialog');
    expect(modal.getAttribute('aria-describedby')).toBe('msg');
  });

  it('names a dialog without a heading by the label it is given, and replaces a stale name', () => {
    const modal = dialog('b');
    modal.setAttribute('aria-labelledby', 'gone');
    uiUtils.openDialog(modal, { label: 'Camera preview' });

    expect(modal.getAttribute('aria-label')).toBe('Camera preview');
    expect(modal.hasAttribute('aria-labelledby')).toBe(false);
  });

  it('names it by a heading that points at nothing useful no more: it finds the real one', () => {
    const modal = dialog('c');
    modal.setAttribute('aria-labelledby', 'a-container-that-does-not-exist');
    uiUtils.openDialog(modal);

    expect(document.getElementById(modal.getAttribute('aria-labelledby')).tagName).toBe('H2');
  });

  it('puts focus on the first control that is not in the header', async () => {
    const modal = dialog('d');
    uiUtils.openDialog(modal);
    await tick();

    expect(document.activeElement.id).toBe('field');
  });

  it('falls back to the header button only when it is all there is', async () => {
    const modal = dialog('e', '<p>Nothing to press.</p>');
    uiUtils.openDialog(modal);
    await tick();

    expect(document.activeElement.classList.contains('close-btn')).toBe(true);
  });

  it('prefers a control marked data-initial-focus, then the one it is told to', async () => {
    const marked = dialog('f', '<input id="a"><button id="b" data-initial-focus>b</button>');
    uiUtils.openDialog(marked);
    await tick();
    expect(document.activeElement.id).toBe('b');

    const asked = dialog('g', '<input id="a"><button id="b" data-initial-focus>b</button>');
    uiUtils.openDialog(asked, { initialFocus: '#a' });
    await tick();
    expect(document.activeElement.id).toBe('a');
  });

  it('accepts an element or a function, and skips one that is disabled', async () => {
    const modal = dialog('h', '<input id="a" disabled><input id="b"><input id="c">');
    uiUtils.openDialog(modal, { initialFocus: () => modal.querySelector('#a') });
    await tick();
    // The requested field cannot take focus, so the first usable control does.
    expect(document.activeElement.id).toBe('b');
  });

  it('leaves focus to the caller when asked', async () => {
    document.body.insertAdjacentHTML('beforeend', '<button id="opener">Open</button>');
    document.getElementById('opener').focus();
    const modal = dialog('i');
    uiUtils.openDialog(modal, { initialFocus: false });
    await tick();

    expect(document.activeElement.id).toBe('opener');
  });

  it('selects a name that is already in the field, so typing replaces it', async () => {
    const modal = dialog('j', '<input id="name" type="text" value="Kitchen">');
    uiUtils.openDialog(modal, { initialFocus: '#name' });
    await tick();
    const input = document.getElementById('name');

    expect(document.activeElement).toBe(input);
    expect([input.selectionStart, input.selectionEnd]).toEqual([0, 7]);
  });

  it('does not take the opener from a dialog that is shown again while it is open', async () => {
    document.body.insertAdjacentHTML('beforeend', '<button id="opener">Open</button>');
    const opener = document.getElementById('opener');
    opener.focus();
    const modal = dialog('k');
    uiUtils.openDialog(modal);
    await tick();
    // A second long press on the weather card opens the picker again.
    uiUtils.openDialog(modal);
    await tick();
    await uiUtils.closeDialog(modal);
    await tick();

    expect(document.activeElement).toBe(opener);
  });
});

describe('Tab inside a dialog', () => {
  it('wraps from the last control to the first, and back, over controls that are not tab stops', async () => {
    const modal = dialog(
      'tabs',
      '<button id="first">1</button><button id="skipped" tabindex="-1">2</button><button id="last">3</button>'
    );
    uiUtils.openDialog(modal, { initialFocus: '#first' });
    await tick();
    const close = modal.querySelector('.close-btn');

    // The header's Close is the first stop in the DOM; the roving-tabindex control is not one.
    document.getElementById('last').focus();
    expect(key(document.getElementById('last'), 'Tab').defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(close);

    expect(key(close, 'Tab', { shiftKey: true }).defaultPrevented).toBe(true);
    expect(document.activeElement.id).toBe('last');
  });
});

describe('Escape, Enter and the backdrop', () => {
  it('Escape dismisses the dialog and goes no further', async () => {
    const dismiss = jest.fn();
    const modal = dialog('esc');
    uiUtils.openDialog(modal, { dismiss });
    await tick();
    const pageEscape = jest.fn();
    document.addEventListener('keydown', pageEscape);

    const event = key(document.activeElement, 'Escape');

    expect(dismiss).toHaveBeenCalledWith('escape');
    expect(event.defaultPrevented).toBe(true);
    expect(pageEscape).not.toHaveBeenCalled();
    document.removeEventListener('keydown', pageEscape);
  });

  it('closes by default when nothing else is asked of it', async () => {
    const modal = dialog('default');
    uiUtils.openDialog(modal);
    await tick();

    key(document.activeElement, 'Escape');

    expect(modal.classList.contains('hidden')).toBe(true);
  });

  it('acts on the top dialog only, so a confirmation over Settings is the only one that closes', async () => {
    const settings = dialog('settings');
    const confirmation = dialog('confirm');
    const dismissSettings = jest.fn();
    const dismissConfirm = jest.fn();
    uiUtils.openDialog(settings, { dismiss: dismissSettings });
    uiUtils.openDialog(confirmation, { dismiss: dismissConfirm });
    await tick();

    key(document.activeElement, 'Escape');
    // Focus on <body> after a click on the dialog's text or a disabled control: the same dialog.
    document.activeElement.blur();
    key(document.body, 'Escape');

    expect(dismissConfirm).toHaveBeenCalledTimes(2);
    expect(dismissSettings).not.toHaveBeenCalled();
  });

  it('hands Escape back to the dialog underneath once the top one is gone', async () => {
    const lower = dialog('lower');
    const upper = dialog('upper');
    const dismissLower = jest.fn();
    uiUtils.openDialog(lower, { dismiss: dismissLower });
    uiUtils.openDialog(upper);
    await tick();
    key(document.activeElement, 'Escape');
    await tick();

    key(document.body, 'Escape');

    expect(upper.classList.contains('hidden')).toBe(true);
    expect(dismissLower).toHaveBeenCalledTimes(1);
  });

  it('leaves a key a control inside the dialog already used to that control', async () => {
    const dismiss = jest.fn();
    const modal = dialog('claimed', '<input id="search">');
    uiUtils.openDialog(modal, { dismiss, initialFocus: '#search' });
    await tick();
    // A search field that clears itself on Escape, or a picker that closes first.
    document.getElementById('search').addEventListener('keydown', (event) => {
      if (event.key === 'Escape') event.preventDefault();
    });

    key(document.getElementById('search'), 'Escape');

    expect(dismiss).not.toHaveBeenCalled();
  });

  it('ignores Escape that ends an IME composition', async () => {
    const dismiss = jest.fn();
    uiUtils.openDialog(dialog('ime'), { dismiss });
    await tick();

    key(document.activeElement, 'Escape', { isComposing: true });

    expect(dismiss).not.toHaveBeenCalled();
  });

  it('cannot be dismissed when it asks for an answer', async () => {
    const modal = dialog('wizard');
    uiUtils.openDialog(modal, { dismiss: null });
    await tick();

    const event = key(document.activeElement, 'Escape');
    modal.click();

    expect(event.defaultPrevented).toBe(false);
    expect(modal.classList.contains('hidden')).toBe(false);
  });

  it('runs the default action on Enter in a field, but not on a button, a link or a select', async () => {
    const onEnter = jest.fn();
    const modal = dialog(
      'enter',
      '<input id="field"><button id="button">b</button><select id="select"></select><textarea id="area"></textarea>'
    );
    uiUtils.openDialog(modal, { onEnter, initialFocus: '#field' });
    await tick();

    expect(key(document.getElementById('field'), 'Enter').defaultPrevented).toBe(true);
    expect(onEnter).toHaveBeenCalledTimes(1);
    key(document.getElementById('button'), 'Enter');
    key(document.getElementById('select'), 'Enter');
    key(document.getElementById('area'), 'Enter');
    expect(onEnter).toHaveBeenCalledTimes(1);
  });

  it('does not repeat Enter while the key that opened the dialog is held', async () => {
    const onEnter = jest.fn();
    uiUtils.openDialog(dialog('hold'), { onEnter });
    await tick();

    key(document.body, 'Enter', { repeat: true });

    expect(onEnter).not.toHaveBeenCalled();
  });

  it('dismisses on a click on the backdrop, not on a click inside', async () => {
    const dismiss = jest.fn();
    const modal = dialog('backdrop');
    uiUtils.openDialog(modal, { dismiss });
    await tick();

    modal.querySelector('.modal-body').click();
    expect(dismiss).not.toHaveBeenCalled();
    modal.click();
    expect(dismiss).toHaveBeenCalledWith('backdrop');
  });

  it('does not dismiss when a press began inside and ended on the backdrop (a drag out of a field)', async () => {
    const dismiss = jest.fn();
    const modal = dialog('drag');
    uiUtils.openDialog(modal, { dismiss });
    await tick();

    modal.querySelector('#field').dispatchEvent(new MouseEvent('pointerdown', { bubbles: true }));
    modal.click();
    expect(dismiss).not.toHaveBeenCalled();

    // The next, real click on the backdrop does.
    modal.click();
    expect(dismiss).toHaveBeenCalledTimes(1);
  });

  it('can leave the backdrop alone, for a form too large to lose to a stray click', async () => {
    const dismiss = jest.fn();
    const modal = dialog('settings');
    uiUtils.openDialog(modal, { dismiss, dismissOnBackdrop: false });
    await tick();

    modal.click();
    key(document.activeElement, 'Escape');

    expect(dismiss).toHaveBeenCalledTimes(1);
    expect(dismiss).toHaveBeenCalledWith('escape');
  });

  it('knows whether a dialog is open, so the dashboard behind can keep its own Escape', async () => {
    expect(uiUtils.hasOpenDialog()).toBe(false);
    const modal = dialog('open');
    uiUtils.openDialog(modal);
    expect(uiUtils.hasOpenDialog()).toBe(true);
    await uiUtils.closeDialog(modal);
    expect(uiUtils.hasOpenDialog()).toBe(false);
  });
});

describe('stacking', () => {
  it('lifts each dialog opened over another by one step, and starts again from the bottom', async () => {
    const first = dialog('first');
    const second = dialog('second');
    const third = dialog('third');
    const depth = (modal) => modal.style.getPropertyValue('--dialog-depth');

    uiUtils.openDialog(first);
    uiUtils.openDialog(second);
    uiUtils.openDialog(third);
    expect([depth(first), depth(second), depth(third)]).toEqual(['0', '1', '2']);

    await uiUtils.closeDialog(second);
    // A dialog opened now is above the ones still showing, whatever its place in the document.
    uiUtils.openDialog(second);
    expect(depth(second)).toBe('3');

    await uiUtils.closeDialog(third);
    await uiUtils.closeDialog(second);
    await uiUtils.closeDialog(first);
    expect(depth(first)).toBe('');
  });
});

describe('returning focus', () => {
  const open = (id = 'x', options = {}) => {
    const modal = dialog(id);
    uiUtils.openDialog(modal, options);
    return modal;
  };

  it('gives focus back to the control that opened the dialog', async () => {
    document.body.insertAdjacentHTML('beforeend', '<button id="opener">Open</button>');
    document.getElementById('opener').focus();
    const modal = open();
    await tick();

    await uiUtils.closeDialog(modal);
    await tick();

    expect(document.activeElement.id).toBe('opener');
  });

  it('finds an opener that was rebuilt meanwhile by its id or its focus key', async () => {
    document.body.insertAdjacentHTML(
      'beforeend',
      '<div id="list"><button data-focus-key="alert-edit:sensor.a">Edit</button></div>'
    );
    document.querySelector('[data-focus-key]').focus();
    const modal = open();
    await tick();

    // The list is rebuilt under the dialog (a save re-renders it).
    document.getElementById('list').innerHTML =
      '<button data-focus-key="alert-edit:sensor.a">Edit again</button>';
    await uiUtils.closeDialog(modal);
    await tick();

    expect(document.activeElement.textContent).toBe('Edit again');
  });

  it('uses the fallback when the opener is gone for good, or hidden', async () => {
    document.body.insertAdjacentHTML(
      'beforeend',
      '<button id="opener">Open</button><button id="elsewhere">Elsewhere</button>'
    );
    document.getElementById('opener').focus();
    const modal = open('fallback', { focusFallback: '#elsewhere' });
    await tick();

    document.getElementById('opener').remove();
    await uiUtils.closeDialog(modal);
    await tick();

    expect(document.activeElement.id).toBe('elsewhere');
  });

  it('does not take focus from a dialog that opened straight after this one closed', async () => {
    document.body.insertAdjacentHTML('beforeend', '<button id="opener">Open</button>');
    document.getElementById('opener').focus();
    const picker = open('picker');
    await tick();

    const closing = uiUtils.closeDialog(picker);
    // The pick opens the next dialog, which takes its first field before the close has finished.
    const next = open('next');
    await closing;
    await tick();

    expect(next.contains(document.activeElement)).toBe(true);
  });

  it('lets the caller move focus itself', async () => {
    document.body.insertAdjacentHTML(
      'beforeend',
      '<button id="opener">Open</button><button id="chosen">Chosen</button>'
    );
    document.getElementById('opener').focus();
    const modal = open();
    await tick();

    await uiUtils.closeDialog(modal, { restoreFocus: false });
    document.getElementById('chosen').focus();
    await tick();

    expect(document.activeElement.id).toBe('chosen');
  });

  it('removes a dialog built for one use, once it has gone', async () => {
    const modal = open('built');
    const onClosed = jest.fn();

    await uiUtils.closeDialog(modal, { remove: true, onClosed });

    expect(modal.isConnected).toBe(false);
    expect(onClosed).toHaveBeenCalledTimes(1);
  });

  it('hands a replaced dialog place and opener to its replacement', async () => {
    document.body.insertAdjacentHTML('beforeend', '<button id="opener">Open</button>');
    const opener = document.getElementById('opener');
    opener.focus();
    const under = open('under');
    const old = open('old');
    await tick();
    const depth = old.style.getPropertyValue('--dialog-depth');

    // A thermostat gains a control while its pop-up is open, so the pop-up is rebuilt.
    const rebuilt = dialog('rebuilt');
    uiUtils.openDialog(rebuilt, { replaces: old, initialFocus: '#action' });
    old.remove();
    await tick();

    expect(rebuilt.classList.contains('modal-rebuilt')).toBe(true);
    expect(rebuilt.style.getPropertyValue('--dialog-depth')).toBe(depth);
    expect(document.activeElement.id).toBe('action');
    expect(under.isConnected).toBe(true);

    // Escape still lands on the opener of the first dialog, not on a control that went away.
    await uiUtils.closeDialog(rebuilt, { remove: true });
    await uiUtils.closeDialog(under);
    await tick();
    expect(document.activeElement).toBe(opener);
  });
});

describe('render helpers that keep the keyboard in place', () => {
  it('keeps focus on the same control when a list is rebuilt around it', () => {
    document.body.innerHTML =
      '<div id="list"><button data-focus-key="a">A</button><button data-focus-key="b">B</button></div>';
    const list = document.getElementById('list');
    list.querySelector('[data-focus-key="b"]').focus();

    uiUtils.renderKeepingFocus(list, () => {
      list.innerHTML =
        '<button data-focus-key="a">A</button><button data-focus-key="b">B again</button>';
    });

    expect(document.activeElement.textContent).toBe('B again');
  });

  it('falls back, then to the control now in the same place, when the focused one is gone', () => {
    document.body.innerHTML =
      '<input id="search"><div id="list"><button data-focus-key="a">A</button><button data-focus-key="b">B</button><button data-focus-key="c">C</button></div>';
    const list = document.getElementById('list');
    list.querySelector('[data-focus-key="b"]').focus();

    uiUtils.renderKeepingFocus(
      list,
      () => {
        list.innerHTML =
          '<button data-focus-key="a">A</button><button data-focus-key="c">C</button>';
      },
      { fallback: '#search' }
    );
    expect(document.activeElement.id).toBe('search');

    list.querySelector('[data-focus-key="c"]').focus();
    uiUtils.renderKeepingFocus(list, () => {
      list.innerHTML = '<button data-focus-key="a">A</button>';
    });
    // Deleting the last row lands on its neighbour.
    expect(document.activeElement.textContent).toBe('A');
  });

  it('does nothing about focus that was never in the list', () => {
    document.body.innerHTML = '<button id="outside">out</button><div id="list"></div>';
    document.getElementById('outside').focus();
    const list = document.getElementById('list');

    const result = uiUtils.renderKeepingFocus(list, () => 'rendered');

    expect(result).toBe('rendered');
    expect(document.activeElement.id).toBe('outside');
  });

  it('gives focus back to a control that was disabled while something saved', () => {
    document.body.innerHTML = '<button id="save">Save</button><button id="other">Other</button>';
    const save = document.getElementById('save');
    save.focus();

    const reenable = uiUtils.disableControlsKeepingFocus([save, document.getElementById('other')]);
    expect(save.disabled).toBe(true);
    // Disabling the focused control drops the browser's focus to <body>.
    save.blur();
    reenable();

    expect(save.disabled).toBe(false);
    expect(document.activeElement).toBe(save);
  });

  it('leaves focus alone if the user moved on while the controls were disabled', () => {
    document.body.innerHTML = '<button id="save">Save</button><input id="elsewhere">';
    document.getElementById('save').focus();
    const reenable = uiUtils.disableControlsKeepingFocus([document.getElementById('save')]);
    document.getElementById('elsewhere').focus();

    reenable();

    expect(document.activeElement.id).toBe('elsewhere');
  });
});

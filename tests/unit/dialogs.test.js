/**
 * @jest-environment jsdom
 */

// Dialogs, the confirmation dialog and toasts, at the module's interface. The dialog stack's own
// contract (stacking, Escape, Enter, the backdrop) is in dialog-layers.test.js and the toast
// stack's in toast-manager.test.js.

// The reduced-motion check reads matchMedia, which jsdom does not have.
Object.defineProperty(window, 'matchMedia', {
  writable: true,
  configurable: true,
  value: jest.fn().mockImplementation((query) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: jest.fn(),
    removeListener: jest.fn(),
    addEventListener: jest.fn(),
    removeEventListener: jest.fn(),
    dispatchEvent: jest.fn(),
  })),
});

const dialogs = require('../../src/dialogs.js');

beforeEach(() => {
  jest.clearAllMocks();
  document.body.innerHTML = '';
  jest.clearAllTimers();
});

describe('Dialogs and toasts', () => {
  describe('showToast', () => {
    let toastContainer;

    beforeEach(() => {
      // Create toast container
      toastContainer = document.createElement('div');
      toastContainer.id = 'toast-container';
      document.body.appendChild(toastContainer);

      // The exit animation is skipped under NODE_ENV=test, so opt back into it to keep asserting
      // on `.toast-closing` and the fallback timer.
      dialogs.__forceAnimatedModalTransitions(true);
      jest.useFakeTimers();
    });

    afterEach(() => {
      jest.runOnlyPendingTimers();
      jest.useRealTimers();
      dialogs.__forceAnimatedModalTransitions(false);
    });

    it('stacks toasts above an open dialog footer and back at the bottom once it closes', () => {
      const modal = document.createElement('div');
      modal.className = 'modal';
      modal.innerHTML = '<div class="modal-content"><div class="modal-footer"></div></div>';
      document.body.appendChild(modal);
      const footer = modal.querySelector('.modal-footer');
      footer.getClientRects = () => [{}];
      footer.getBoundingClientRect = () => ({
        top: window.innerHeight - 60,
        bottom: window.innerHeight - 16,
      });
      // Where one toast rests, 20px above the bottom: over the footer.
      toastContainer.getBoundingClientRect = () => ({
        top: window.innerHeight - 80,
        bottom: window.innerHeight - 20,
      });

      dialogs.showToast('Failed to control Bed Light', 'error', 2000);
      expect(toastContainer.style.bottom).toBe('68px');

      modal.classList.add('hidden');
      dialogs.showToast('Saved', 'success', 2000);
      expect(toastContainer.style.bottom).toBe('');
      modal.remove();
    });

    it('should display toast with message', () => {
      dialogs.showToast('Test message', 'success', 2000);

      const toast = toastContainer.querySelector('.toast');
      expect(toast).toBeTruthy();
      expect(toast.textContent).toBe('Test message');
    });

    it('shows the same message once while it is still up', () => {
      const first = dialogs.showToast('Your token was not saved', 'warning', 2000);
      const second = dialogs.showToast('Your token was not saved', 'warning', 2000);

      expect(second).toBe(first);
      expect(toastContainer.querySelectorAll('.toast')).toHaveLength(1);

      // A different message, or the same text as another kind of toast, is its own toast.
      dialogs.showToast('Your token was not saved', 'error', 2000);
      dialogs.showToast('Something else', 'warning', 2000);
      expect(toastContainer.querySelectorAll('.toast')).toHaveLength(3);
    });

    it('should apply success type class', () => {
      dialogs.showToast('Success', 'success', 2000);

      const toast = toastContainer.querySelector('.toast');
      expect(toast.classList.contains('success')).toBe(true);
    });

    it('should apply error type class', () => {
      dialogs.showToast('Error', 'error', 2000);

      const toast = toastContainer.querySelector('.toast');
      expect(toast.classList.contains('error')).toBe(true);
    });

    it('should apply warning type class', () => {
      dialogs.showToast('Warning', 'warning', 2000);

      const toast = toastContainer.querySelector('.toast');
      expect(toast.classList.contains('warning')).toBe(true);
    });

    it('should apply info type class', () => {
      dialogs.showToast('Info', 'info', 2000);

      const toast = toastContainer.querySelector('.toast');
      expect(toast.classList.contains('info')).toBe(true);
    });

    it('should default to success type', () => {
      dialogs.showToast('Default', undefined, 2000);

      const toast = toastContainer.querySelector('.toast');
      expect(toast.classList.contains('success')).toBe(true);
    });

    it('should auto-dismiss toast after timeout', () => {
      dialogs.showToast('Timeout test', 'success', 2000);

      expect(toastContainer.children.length).toBe(1);

      // Fast-forward timeout
      jest.advanceTimersByTime(2000);

      const toast = toastContainer.querySelector('.toast');
      expect(toast.classList.contains('toast-closing')).toBe(true);

      // Fast-forward fade-out animation
      jest.advanceTimersByTime(300);

      expect(toastContainer.children.length).toBe(0);
    });

    it('should lead with an aria-hidden status icon matching the type', () => {
      dialogs.showToast('Saved', 'success', 2000);

      const toast = toastContainer.querySelector('.toast');
      const icon = toast.firstElementChild;
      expect(icon.classList.contains('toast-icon')).toBe(true);
      expect(icon.getAttribute('aria-hidden')).toBe('true');
      expect(icon.querySelector('svg')).toBeTruthy();
      expect(icon.querySelector('svg').dataset.icon).toBe('circle-check');
    });

    it('should use the error icon for error toasts', () => {
      dialogs.showToast('Broken', 'error', 2000);

      const icon = toastContainer.querySelector('.toast .toast-icon svg');
      expect(icon.dataset.icon).toBe('circle-x');
    });

    it('should dismiss a toast when it is clicked', () => {
      dialogs.showToast('Click me', 'info', 5000);

      const toast = toastContainer.querySelector('.toast');
      toast.click();
      expect(toast.classList.contains('toast-closing')).toBe(true);

      jest.advanceTimersByTime(300);
      expect(toastContainer.children.length).toBe(0);
    });

    it('should take focus with Tab on its close button and be dismissed from the keyboard', () => {
      dialogs.showToast('Press a key', 'warning', 20000);
      const toast = toastContainer.querySelector('.toast');
      const close = toast.querySelector('.toast-close');
      expect(close.tabIndex).toBe(0);

      close.dispatchEvent(new KeyboardEvent('keydown', { key: 'a', bubbles: true }));
      expect(toast.classList.contains('toast-closing')).toBe(false);

      close.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      expect(toast.classList.contains('toast-closing')).toBe(true);
      jest.advanceTimersByTime(300);
      expect(toastContainer.children.length).toBe(0);
    });

    it('should dismiss a toast when its close button is pressed', () => {
      dialogs.showToast('Press a key', 'error', 20000);
      const toast = toastContainer.querySelector('.toast');

      // Enter and Space on a button are its click.
      toast.querySelector('.toast-close').click();

      expect(toast.classList.contains('toast-closing')).toBe(true);
    });

    it('should not remove a clicked toast twice when its timeout also fires', () => {
      dialogs.showToast('Click me', 'info', 1000);

      const toast = toastContainer.querySelector('.toast');
      toast.click();
      jest.advanceTimersByTime(300);
      expect(toastContainer.children.length).toBe(0);

      expect(() => jest.advanceTimersByTime(2000)).not.toThrow();
      expect(toastContainer.children.length).toBe(0);
    });

    it('should allow multiple toasts to stack', () => {
      dialogs.showToast('Toast 1', 'success', 2000);
      dialogs.showToast('Toast 2', 'error', 2000);
      dialogs.showToast('Toast 3', 'warning', 2000);

      expect(toastContainer.children.length).toBe(3);
      expect(toastContainer.children[0].textContent).toBe('Toast 1');
      expect(toastContainer.children[1].textContent).toBe('Toast 2');
      expect(toastContainer.children[2].textContent).toBe('Toast 3');
    });

    it('should handle missing toast container gracefully', () => {
      document.body.removeChild(toastContainer);

      expect(() => {
        dialogs.showToast('Test', 'success', 2000);
      }).not.toThrow();
    });

    it('should handle errors during toast creation', () => {
      const consoleError = jest.spyOn(console, 'error').mockImplementation();

      // Make appendChild throw an error
      toastContainer.appendChild = jest.fn(() => {
        throw new Error('DOM error');
      });

      dialogs.showToast('Test', 'success', 2000);

      expect(consoleError).toHaveBeenCalledWith('Error showing toast:', expect.any(Error));

      consoleError.mockRestore();
    });
  });

  describe('focus trap', () => {
    let modal;

    beforeEach(() => {
      modal = document.createElement('div');
      modal.innerHTML = `
        <button id="first">First</button>
        <input id="middle" type="text" />
        <button id="last">Last</button>
      `;
      document.body.appendChild(modal);

      jest.useFakeTimers();
    });

    afterEach(() => {
      jest.runOnlyPendingTimers();
      jest.useRealTimers();
      if (modal.parentNode) {
        document.body.removeChild(modal);
      }
    });

    it('should focus first focusable element', () => {
      const firstButton = modal.querySelector('#first');
      const focusSpy = jest.spyOn(firstButton, 'focus');

      dialogs.openDialog(modal);

      // Fast-forward setTimeout
      jest.advanceTimersByTime(0);

      expect(focusSpy).toHaveBeenCalled();

      focusSpy.mockRestore();
    });

    it('should trap Tab key at last element', () => {
      const lastButton = modal.querySelector('#last');

      dialogs.openDialog(modal);

      // Simulate focus on last element
      lastButton.focus();

      // Simulate Tab key
      const tabEvent = new KeyboardEvent('keydown', { key: 'Tab', bubbles: true });
      const preventDefaultSpy = jest.spyOn(tabEvent, 'preventDefault');

      modal.dispatchEvent(tabEvent);

      expect(preventDefaultSpy).toHaveBeenCalled();

      preventDefaultSpy.mockRestore();
    });

    it('should trap Shift+Tab key at first element', () => {
      const firstButton = modal.querySelector('#first');

      dialogs.openDialog(modal);

      // Simulate focus on first element
      firstButton.focus();

      // Simulate Shift+Tab key
      const shiftTabEvent = new KeyboardEvent('keydown', {
        key: 'Tab',
        shiftKey: true,
        bubbles: true,
      });
      const preventDefaultSpy = jest.spyOn(shiftTabEvent, 'preventDefault');

      modal.dispatchEvent(shiftTabEvent);

      expect(preventDefaultSpy).toHaveBeenCalled();

      preventDefaultSpy.mockRestore();
    });

    it('should ignore non-Tab keys', () => {
      dialogs.openDialog(modal);

      const enterEvent = new KeyboardEvent('keydown', { key: 'Enter', bubbles: true });
      const preventDefaultSpy = jest.spyOn(enterEvent, 'preventDefault');

      modal.dispatchEvent(enterEvent);

      expect(preventDefaultSpy).not.toHaveBeenCalled();

      preventDefaultSpy.mockRestore();
    });

    it('should handle modal with no focusable elements', () => {
      modal.innerHTML = '<div>No focusable elements</div>';

      expect(() => {
        dialogs.openDialog(modal);
      }).not.toThrow();
    });

    it('wraps Tab using the controls present when Tab is pressed', () => {
      dialogs.openDialog(modal);
      const added = document.createElement('button');
      modal.appendChild(added);
      modal.querySelector('#last').disabled = true;
      added.focus();
      const tab = new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true });
      added.dispatchEvent(tab);
      expect(tab.defaultPrevented).toBe(true);
      expect(document.activeElement).toBe(modal.querySelector('#first'));
    });

    it('focuses the requested element, or nothing, instead of the first control', () => {
      const middle = modal.querySelector('#middle');
      dialogs.openDialog(modal, { initialFocus: middle });
      jest.advanceTimersByTime(0);
      expect(document.activeElement).toBe(middle);

      dialogs.closeDialog(modal);
      middle.blur();
      dialogs.openDialog(modal, { initialFocus: false });
      jest.advanceTimersByTime(0);
      expect(document.activeElement).toBe(document.body);
      dialogs.releaseFocusTrap(modal);
    });

    it('keeps Tab and Escape working after focus has fallen back to the page', () => {
      const behind = document.createElement('button');
      document.body.prepend(behind);
      modal.classList.add('modal');
      const onEscape = jest.fn();
      dialogs.openDialog(modal, { dismiss: onEscape });
      jest.advanceTimersByTime(0);
      // The focused control was disabled or re-rendered: the browser moves focus to <body>.
      document.activeElement.blur();

      // The browser's own Tab then lands on the page behind the dialog.
      document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true }));
      behind.focus();
      jest.advanceTimersByTime(0);
      expect(document.activeElement).toBe(modal.querySelector('#first'));

      document.activeElement.blur();
      document.body.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Tab', shiftKey: true, bubbles: true })
      );
      jest.advanceTimersByTime(0);
      expect(document.activeElement).toBe(modal.querySelector('#last'));

      // After a click on the dialog's text, Tab continues from there inside the dialog.
      document.activeElement.blur();
      document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true }));
      modal.querySelector('#middle').focus();
      jest.advanceTimersByTime(0);
      expect(document.activeElement).toBe(modal.querySelector('#middle'));

      document.activeElement.blur();
      const pageEscape = jest.fn();
      document.addEventListener('keydown', pageEscape);
      document.body.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })
      );
      expect(onEscape).toHaveBeenCalledWith('escape');
      // The dialog used the key, so the page behind does not handle it as well.
      expect(pageEscape).not.toHaveBeenCalled();
      document.removeEventListener('keydown', pageEscape);

      // Once the dialog is hidden, keys on the page are left alone.
      modal.classList.add('hidden');
      document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true }));
      behind.focus();
      jest.advanceTimersByTime(0);
      expect(document.activeElement).toBe(behind);
      dialogs.releaseFocusTrap(modal);
      behind.remove();
    });
  });

  describe('releaseFocusTrap', () => {
    let modal;

    beforeEach(() => {
      modal = document.createElement('div');
      modal.innerHTML = `
        <button id="first">First</button>
        <button id="last">Last</button>
      `;
      document.body.appendChild(modal);

      jest.useFakeTimers();
    });

    afterEach(() => {
      jest.runOnlyPendingTimers();
      jest.useRealTimers();
      if (modal.parentNode) {
        document.body.removeChild(modal);
      }
    });

    it('should remove event listener', () => {
      dialogs.openDialog(modal);

      const removeEventListenerSpy = jest.spyOn(modal, 'removeEventListener');

      dialogs.releaseFocusTrap(modal);

      expect(removeEventListenerSpy).toHaveBeenCalledWith('keydown', expect.any(Function));

      removeEventListenerSpy.mockRestore();
    });

    it('releases the most recent connected focus trap when no modal is supplied', () => {
      dialogs.openDialog(modal);
      const removeEventListenerSpy = jest.spyOn(modal, 'removeEventListener');

      dialogs.releaseFocusTrap();

      expect(removeEventListenerSpy).toHaveBeenCalledWith('keydown', expect.any(Function));
      removeEventListenerSpy.mockRestore();
    });

    it('should restore focus to last focused element', () => {
      const externalButton = document.createElement('button');
      externalButton.id = 'external';
      document.body.appendChild(externalButton);

      const focusSpy = jest.spyOn(externalButton, 'focus');

      externalButton.focus();
      dialogs.openDialog(modal);
      dialogs.releaseFocusTrap(modal);

      // Fast-forward setTimeout
      jest.advanceTimersByTime(0);

      expect(focusSpy).toHaveBeenCalled();

      focusSpy.mockRestore();
      document.body.removeChild(externalButton);
    });

    it('leaves focus to the caller when asked not to restore it', () => {
      const externalButton = document.createElement('button');
      document.body.appendChild(externalButton);
      externalButton.focus();
      dialogs.openDialog(modal);
      jest.advanceTimersByTime(0);
      const focusSpy = jest.spyOn(externalButton, 'focus');

      modal.querySelector('#first').blur();
      dialogs.releaseFocusTrap(modal, { restoreFocus: false });
      jest.advanceTimersByTime(0);

      expect(focusSpy).not.toHaveBeenCalled();
      focusSpy.mockRestore();
      externalButton.remove();
    });

    it('leaves a Tab the dialog already handled alone', () => {
      dialogs.openDialog(modal);
      const last = modal.querySelector('#last');
      last.focus();
      // The dialog's own Tab order moved focus and claimed the key.
      modal.addEventListener('keydown', (event) => event.preventDefault(), {
        capture: true,
        once: true,
      });
      const tab = new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true });
      last.dispatchEvent(tab);
      expect(document.activeElement).toBe(last);
      dialogs.releaseFocusTrap(modal);
    });

    it('does not steal focus back when another dialog has already claimed it', () => {
      const externalButton = document.createElement('button');
      externalButton.id = 'external';
      document.body.appendChild(externalButton);
      const nextDialogField = document.createElement('input');
      document.body.appendChild(nextDialogField);

      externalButton.focus();
      dialogs.openDialog(modal);
      jest.advanceTimersByTime(0);

      const focusSpy = jest.spyOn(externalButton, 'focus');
      dialogs.releaseFocusTrap(modal);
      // The close handler opened a replacement dialog, which focused its own first field before
      // the deferred release ran.
      nextDialogField.focus();
      jest.advanceTimersByTime(0);

      expect(focusSpy).not.toHaveBeenCalled();
      expect(document.activeElement).toBe(nextDialogField);

      focusSpy.mockRestore();
      document.body.removeChild(externalButton);
      document.body.removeChild(nextDialogField);
    });

    it('returns focus to the rebuilt tile when the opener was replaced', () => {
      document.body.insertAdjacentHTML(
        'beforeend',
        `<div id="quick-controls"><div class="control-item" data-entity-id="light.hall">
          <button class="tile-primary-button">Hall</button>
          <button class="tile-details-button">Controls</button></div></div>`
      );
      const grid = document.getElementById('quick-controls');
      grid.querySelector('.tile-details-button').focus();
      dialogs.openDialog(modal);
      jest.advanceTimersByTime(0);

      // The entity changed while the dialog was open, so the tile was rebuilt.
      grid.replaceChildren(grid.firstElementChild.cloneNode(true));
      modal.remove();
      dialogs.releaseFocusTrap(modal);
      jest.advanceTimersByTime(0);

      expect(document.activeElement).toBe(grid.querySelector('.tile-details-button'));
      grid.remove();
    });

    it('should handle modal without active trap', () => {
      expect(() => {
        dialogs.releaseFocusTrap(modal);
      }).not.toThrow();
    });

    it('should handle null modal gracefully', () => {
      // Should not throw when called with null
      expect(() => {
        dialogs.releaseFocusTrap(null);
      }).not.toThrow();
    });
  });

  describe('showConfirm', () => {
    let modal, titleEl, messageEl, okBtn, cancelBtn;

    beforeEach(() => {
      // Create confirm modal structure
      modal = document.createElement('div');
      modal.id = 'confirm-modal';
      modal.classList.add('hidden');
      modal.style.display = 'none';

      const modalContent = document.createElement('div');
      modalContent.className = 'modal-content';

      titleEl = document.createElement('h2');
      titleEl.id = 'confirm-title';

      messageEl = document.createElement('p');
      messageEl.id = 'confirm-message';

      cancelBtn = document.createElement('button');
      cancelBtn.id = 'confirm-cancel-btn';

      okBtn = document.createElement('button');
      okBtn.id = 'confirm-ok-btn';

      modalContent.appendChild(titleEl);
      modalContent.appendChild(messageEl);
      modalContent.appendChild(cancelBtn);
      modalContent.appendChild(okBtn);
      modal.appendChild(modalContent);

      document.body.appendChild(modal);
    });

    it('should display modal with title and message', async () => {
      const promise = dialogs.showConfirm(
        'Delete Item',
        'Are you sure you want to delete this item?'
      );

      expect(titleEl.textContent).toBe('Delete Item');
      expect(messageEl.textContent).toBe('Are you sure you want to delete this item?');
      expect(modal.classList.contains('hidden')).toBe(false);
      expect(modal.style.display).toBe('flex');

      // Clean up
      cancelBtn.click();
      await promise;
    });

    it('should return true when OK button clicked', async () => {
      const promise = dialogs.showConfirm('Confirm', 'Continue?');

      okBtn.click();

      const result = await promise;
      expect(result).toBe(true);
    });

    it('should return false when Cancel button clicked', async () => {
      const promise = dialogs.showConfirm('Confirm', 'Continue?');

      cancelBtn.click();

      const result = await promise;
      expect(result).toBe(false);
    });

    it('should return true when Enter is pressed outside a button, if the safe answer is yes', async () => {
      const promise = dialogs.showConfirm('Save', 'Save it?', { confirmFirst: true });

      const enterEvent = new KeyboardEvent('keydown', { key: 'Enter', bubbles: true });
      document.dispatchEvent(enterEvent);

      const result = await promise;
      expect(result).toBe(true);
    });

    it('should not let a stray Enter confirm a question that starts on Cancel', async () => {
      const promise = dialogs.showConfirm('Delete', 'Delete this?');
      let settled = false;
      promise.then(() => {
        settled = true;
      });

      // Focus has left the buttons (a click on the message text), and Enter lands on the body.
      document.activeElement?.blur?.();
      const enterEvent = new KeyboardEvent('keydown', { key: 'Enter', bubbles: true });
      document.body.dispatchEvent(enterEvent);
      await Promise.resolve();

      expect(settled).toBe(false);
      expect(enterEvent.defaultPrevented).toBe(false);
      cancelBtn.click();
      expect(await promise).toBe(false);
    });

    it('should leave Enter on the focused Cancel button to that button so it cancels', async () => {
      const promise = dialogs.showConfirm('Delete', 'Delete this?');

      // The browser turns Enter on a button into a click; jsdom does not, so dispatch both.
      cancelBtn.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
      cancelBtn.click();

      expect(await promise).toBe(false);
    });

    it('should leave Enter on the focused Confirm button to that button so it confirms', async () => {
      const promise = dialogs.showConfirm('Delete', 'Delete this?');

      okBtn.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
      okBtn.click();

      expect(await promise).toBe(true);
    });

    it('should ignore a held-down Enter key repeating into the dialog', async () => {
      const promise = dialogs.showConfirm('Delete', 'Delete this?');

      document.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Enter', repeat: true, bubbles: true })
      );
      cancelBtn.click();

      expect(await promise).toBe(false);
    });

    it('should return false when Escape key pressed', async () => {
      const promise = dialogs.showConfirm('Confirm', 'Continue?');

      const escapeEvent = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true });
      document.dispatchEvent(escapeEvent);

      const result = await promise;
      expect(result).toBe(false);
    });

    it('should return false when clicking backdrop', async () => {
      const promise = dialogs.showConfirm('Confirm', 'Continue?');

      // Click on modal itself (backdrop)
      const clickEvent = new MouseEvent('click', { bubbles: true });
      Object.defineProperty(clickEvent, 'target', { value: modal, enumerable: true });
      modal.dispatchEvent(clickEvent);

      const result = await promise;
      expect(result).toBe(false);
    });

    it('should not close when clicking modal content', async () => {
      const promise = dialogs.showConfirm('Confirm', 'Continue?');

      // Click on modal content (not backdrop)
      const modalContent = modal.querySelector('.modal-content');
      const clickEvent = new MouseEvent('click', { bubbles: true });
      Object.defineProperty(clickEvent, 'target', { value: modalContent, enumerable: true });
      modal.dispatchEvent(clickEvent);

      // Modal should still be open
      expect(modal.classList.contains('hidden')).toBe(false);

      // Clean up
      cancelBtn.click();
      await promise;
    });

    it('should apply custom button text', async () => {
      const promise = dialogs.showConfirm('Delete', 'Delete this?', {
        confirmText: 'Delete',
        cancelText: 'Keep',
      });

      expect(okBtn.textContent).toBe('Delete');
      expect(cancelBtn.textContent).toBe('Keep');

      // Clean up
      cancelBtn.click();
      await promise;
    });

    it('should apply custom button class', async () => {
      const promise = dialogs.showConfirm('Warning', 'Continue?', {
        confirmClass: 'btn-warning',
      });

      expect(okBtn.className).toContain('btn-warning');

      // Clean up
      cancelBtn.click();
      await promise;
    });

    it('should default to danger class for confirm button', async () => {
      const promise = dialogs.showConfirm('Confirm', 'Continue?');

      expect(okBtn.className).toContain('btn-danger');

      // Clean up
      cancelBtn.click();
      await promise;
    });

    it('should hide modal after confirmation', async () => {
      const promise = dialogs.showConfirm('Confirm', 'Continue?');

      okBtn.click();

      await promise;

      expect(modal.classList.contains('hidden')).toBe(true);
      expect(modal.style.display).toBe('none');
    });

    it('is an alert dialog named by its title and described by its message', async () => {
      const promise = dialogs.showConfirm('Delete page', 'This removes the page.');

      expect(modal.getAttribute('role')).toBe('alertdialog');
      expect(modal.getAttribute('aria-modal')).toBe('true');
      expect(modal.getAttribute('aria-describedby')).toBe('confirm-message');
      expect(document.getElementById(modal.getAttribute('aria-labelledby'))).toBe(titleEl);

      cancelBtn.click();
      await promise;
    });

    it('starts on Cancel, so a stray Enter or Space declines, unless the safe answer is yes', async () => {
      jest.useFakeTimers();
      try {
        const declining = dialogs.showConfirm('Delete', 'Delete this?');
        jest.advanceTimersByTime(0);
        expect(document.activeElement).toBe(cancelBtn);
        cancelBtn.click();
        await declining;

        const saving = dialogs.showConfirm('Save', 'Save it?', { confirmFirst: true });
        jest.advanceTimersByTime(0);
        expect(document.activeElement).toBe(okBtn);
        okBtn.click();
        await saving;
      } finally {
        jest.useRealTimers();
      }
    });

    it('offers a third choice for a question with two ways forward and a way back', async () => {
      const alternateBtn = document.createElement('button');
      alternateBtn.id = 'confirm-alternate-btn';
      alternateBtn.hidden = true;
      modal.querySelector('.modal-content').insertBefore(alternateBtn, okBtn);

      const plain = dialogs.showConfirm('Delete', 'Delete this?');
      expect(alternateBtn.hidden).toBe(true);
      cancelBtn.click();
      await plain;

      const promise = dialogs.showConfirm('Unsaved', 'Save the colour first?', {
        confirmText: 'Save and continue',
        alternateText: 'Discard edits',
        cancelText: 'Keep editing',
      });
      expect(alternateBtn.hidden).toBe(false);
      expect(alternateBtn.textContent).toBe('Discard edits');
      alternateBtn.click();
      expect(await promise).toBe('alternate');

      // Escape and a click outside go back, the way Cancel does: never to "discard".
      const escaped = dialogs.showConfirm('Unsaved', 'Save the colour first?', {
        alternateText: 'Discard edits',
      });
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      expect(await escaped).toBe(false);
    });

    it('closes over a dialog below it and leaves that dialog open', async () => {
      const settings = document.createElement('div');
      settings.className = 'modal';
      settings.innerHTML = '<div class="modal-content"><button id="in-settings">x</button></div>';
      document.body.appendChild(settings);
      const dismissSettings = jest.fn();
      dialogs.openDialog(settings, { dismiss: dismissSettings });

      const promise = dialogs.showConfirm('Discard', 'Discard everything?');
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));

      expect(await promise).toBe(false);
      expect(dismissSettings).not.toHaveBeenCalled();
      expect(settings.classList.contains('hidden')).toBe(false);
      dialogs.releaseFocusTrap(settings, { restoreFocus: false });
    });

    it('should handle missing modal elements gracefully', async () => {
      const consoleError = jest.spyOn(console, 'error').mockImplementation();
      document.body.removeChild(modal);

      const result = await dialogs.showConfirm('Test', 'Message');

      expect(result).toBe(false);
      consoleError.mockRestore();
    });

    it('should handle errors during modal display', async () => {
      const consoleError = jest.spyOn(console, 'error').mockImplementation();

      // Remove required elements to cause error
      document.body.removeChild(modal);

      const result = await dialogs.showConfirm('Test', 'Message');

      expect(consoleError).toHaveBeenCalledWith('Confirm modal elements not found');
      expect(result).toBe(false);

      consoleError.mockRestore();
    });
  });

  describe('animated close and reopen', () => {
    const createModal = () => {
      const modal = document.createElement('div');
      modal.className = 'modal';
      modal.innerHTML = '<div class="modal-content"><button class="field">Field</button></div>';
      document.body.appendChild(modal);
      modal.style.display = 'flex';
      return modal;
    };

    const endExitAnimation = (modal) => {
      modal.dispatchEvent(new Event('animationend'));
    };

    beforeEach(() => {
      // NODE_ENV=test normally settles every close synchronously, which would skip the entire
      // animated branch these tests exist to cover.
      dialogs.__forceAnimatedModalTransitions(true);
      jest.useFakeTimers();
    });

    afterEach(() => {
      jest.runOnlyPendingTimers();
      jest.useRealTimers();
      dialogs.__forceAnimatedModalTransitions(false);
    });

    it('hides the modal only once the exit animation ends', async () => {
      const modal = createModal();
      const onClosed = jest.fn();

      const closed = dialogs.closeDialog(modal, { onClosed });

      expect(modal.classList.contains('modal-closing')).toBe(true);
      expect(modal.classList.contains('hidden')).toBe(false);
      expect(onClosed).not.toHaveBeenCalled();

      endExitAnimation(modal);
      await closed;

      expect(modal.classList.contains('modal-closing')).toBe(false);
      expect(modal.classList.contains('hidden')).toBe(true);
      expect(modal.style.display).toBe('none');
      expect(onClosed).toHaveBeenCalledTimes(1);
    });

    it('hides the modal on the fallback timer when animationend never arrives', async () => {
      const modal = createModal();
      const onClosed = jest.fn();

      const closed = dialogs.closeDialog(modal, { onClosed });

      jest.advanceTimersByTime(299);
      expect(modal.classList.contains('hidden')).toBe(false);
      expect(onClosed).not.toHaveBeenCalled();

      jest.advanceTimersByTime(1);
      await closed;

      expect(modal.classList.contains('hidden')).toBe(true);
      expect(onClosed).toHaveBeenCalledTimes(1);
    });

    it('keeps a modal re-opened mid-close visible when the stale animation settles', async () => {
      const modal = createModal();
      const onClosed = jest.fn();

      const closed = dialogs.closeDialog(modal, { onClosed });
      dialogs.openDialog(modal);
      await closed;

      expect(modal.classList.contains('modal-closing')).toBe(false);
      expect(modal.classList.contains('hidden')).toBe(false);

      endExitAnimation(modal);
      jest.advanceTimersByTime(300);

      expect(modal.classList.contains('hidden')).toBe(false);
      expect(modal.style.display).toBe('flex');
      expect(onClosed).not.toHaveBeenCalled();
    });

    it('abandons the close when the exit class is cleared without reopening the dialog', async () => {
      const modal = createModal();
      const onClosed = jest.fn();

      const closed = dialogs.closeDialog(modal, { onClosed });
      modal.classList.remove('modal-closing');

      endExitAnimation(modal);
      await closed;

      expect(modal.classList.contains('hidden')).toBe(false);
      expect(modal.style.display).toBe('flex');
      expect(onClosed).not.toHaveBeenCalled();
    });

    it('disarms the first close so a close/open/close within the fallback window completes its own close', async () => {
      const modal = createModal();
      const firstOnClosed = jest.fn();
      const secondOnClosed = jest.fn();

      const firstClose = dialogs.closeDialog(modal, { onClosed: firstOnClosed });
      jest.advanceTimersByTime(100);
      dialogs.openDialog(modal);
      await firstClose;

      const secondClose = dialogs.closeDialog(modal, { onClosed: secondOnClosed });
      // The first close's fallback timer is due right here; it must no longer be armed.
      jest.advanceTimersByTime(200);
      expect(modal.classList.contains('hidden')).toBe(false);
      expect(firstOnClosed).not.toHaveBeenCalled();
      expect(secondOnClosed).not.toHaveBeenCalled();

      jest.advanceTimersByTime(100);
      await secondClose;

      expect(modal.classList.contains('hidden')).toBe(true);
      expect(secondOnClosed).toHaveBeenCalledTimes(1);
      expect(firstOnClosed).not.toHaveBeenCalled();
    });

    it('lets a second close supersede an in-flight one and run its own options', async () => {
      const modal = createModal();
      const firstOnClosed = jest.fn();
      const secondOnClosed = jest.fn();

      const firstClose = dialogs.closeDialog(modal, { onClosed: firstOnClosed });
      const secondClose = dialogs.closeDialog(modal, { remove: true, onClosed: secondOnClosed });

      endExitAnimation(modal);
      await Promise.all([firstClose, secondClose]);

      expect(secondOnClosed).toHaveBeenCalledTimes(1);
      expect(firstOnClosed).not.toHaveBeenCalled();
      expect(modal.isConnected).toBe(false);
    });

    it('releases the focus trap only after the exit animation ends', async () => {
      const opener = document.createElement('button');
      document.body.appendChild(opener);
      opener.focus();

      const modal = createModal();
      dialogs.openDialog(modal);
      jest.advanceTimersByTime(0);

      const closed = dialogs.closeDialog(modal, { remove: true });
      expect(document.activeElement).toBe(modal.querySelector('.field'));

      endExitAnimation(modal);
      await closed;
      jest.advanceTimersByTime(0);

      expect(document.activeElement).toBe(opener);
    });
  });
});

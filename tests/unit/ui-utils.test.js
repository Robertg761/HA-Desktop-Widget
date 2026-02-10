/**
 * @jest-environment jsdom
 */

const { createMockElectronAPI, resetMockElectronAPI } = require('../mocks/electron.js');

// Create mock electronAPI instance BEFORE loading ui-utils
// This is needed because ui-utils.js calls window.electronAPI.onHotkeyRegistrationFailed at module load time
const mockElectronAPI = createMockElectronAPI();
window.electronAPI = mockElectronAPI;

// Mock matchMedia for theme detection
Object.defineProperty(window, 'matchMedia', {
  writable: true,
  value: jest.fn().mockImplementation(query => ({
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

// Now load the module
const uiUtils = require('../../src/ui-utils.js');

beforeEach(() => {
  jest.clearAllMocks();
  resetMockElectronAPI();

  // Clear document body
  document.body.innerHTML = '';

  // Reset timers
  jest.clearAllTimers();
});

describe('UI Utilities', () => {

  describe('showToast', () => {
    let toastContainer;

    beforeEach(() => {
      // Create toast container
      toastContainer = document.createElement('div');
      toastContainer.id = 'toast-container';
      document.body.appendChild(toastContainer);

      jest.useFakeTimers();
    });

    afterEach(() => {
      jest.runOnlyPendingTimers();
      jest.useRealTimers();
    });

    it('should display toast with message', () => {
      uiUtils.showToast('Test message', 'success', 2000);

      const toast = toastContainer.querySelector('.toast');
      expect(toast).toBeTruthy();
      expect(toast.textContent).toBe('Test message');
    });

    it('should apply success type class', () => {
      uiUtils.showToast('Success', 'success', 2000);

      const toast = toastContainer.querySelector('.toast');
      expect(toast.classList.contains('success')).toBe(true);
    });

    it('should apply error type class', () => {
      uiUtils.showToast('Error', 'error', 2000);

      const toast = toastContainer.querySelector('.toast');
      expect(toast.classList.contains('error')).toBe(true);
    });

    it('should apply warning type class', () => {
      uiUtils.showToast('Warning', 'warning', 2000);

      const toast = toastContainer.querySelector('.toast');
      expect(toast.classList.contains('warning')).toBe(true);
    });

    it('should apply info type class', () => {
      uiUtils.showToast('Info', 'info', 2000);

      const toast = toastContainer.querySelector('.toast');
      expect(toast.classList.contains('info')).toBe(true);
    });

    it('should default to success type', () => {
      uiUtils.showToast('Default', undefined, 2000);

      const toast = toastContainer.querySelector('.toast');
      expect(toast.classList.contains('success')).toBe(true);
    });

    it('should auto-dismiss toast after timeout', () => {
      uiUtils.showToast('Timeout test', 'success', 2000);

      expect(toastContainer.children.length).toBe(1);

      // Fast-forward timeout
      jest.advanceTimersByTime(2000);

      const toast = toastContainer.querySelector('.toast');
      expect(toast.style.opacity).toBe('0');

      // Fast-forward fade-out animation
      jest.advanceTimersByTime(300);

      expect(toastContainer.children.length).toBe(0);
    });

    it('should allow multiple toasts to stack', () => {
      uiUtils.showToast('Toast 1', 'success', 2000);
      uiUtils.showToast('Toast 2', 'error', 2000);
      uiUtils.showToast('Toast 3', 'warning', 2000);

      expect(toastContainer.children.length).toBe(3);
      expect(toastContainer.children[0].textContent).toBe('Toast 1');
      expect(toastContainer.children[1].textContent).toBe('Toast 2');
      expect(toastContainer.children[2].textContent).toBe('Toast 3');
    });

    it('should handle missing toast container gracefully', () => {
      document.body.removeChild(toastContainer);

      expect(() => {
        uiUtils.showToast('Test', 'success', 2000);
      }).not.toThrow();
    });

    it('should handle errors during toast creation', () => {
      const consoleError = jest.spyOn(console, 'error').mockImplementation();

      // Make appendChild throw an error
      toastContainer.appendChild = jest.fn(() => {
        throw new Error('DOM error');
      });

      uiUtils.showToast('Test', 'success', 2000);

      expect(consoleError).toHaveBeenCalledWith('Error showing toast:', expect.any(Error));

      consoleError.mockRestore();
    });
  });

  describe('applyTheme', () => {
    it('should apply dark theme', () => {
      uiUtils.applyTheme('dark');

      expect(document.body.classList.contains('theme-dark')).toBe(true);
      expect(document.body.classList.contains('theme-light')).toBe(false);
    });

    it('should apply light theme', () => {
      uiUtils.applyTheme('light');

      expect(document.body.classList.contains('theme-light')).toBe(true);
      expect(document.body.classList.contains('theme-dark')).toBe(false);
    });

    it('should detect dark system preference in auto mode', () => {
      window.matchMedia = jest.fn().mockImplementation(query => ({
        matches: query === '(prefers-color-scheme: dark)',
        media: query,
        onchange: null,
        addListener: jest.fn(),
        removeListener: jest.fn(),
        addEventListener: jest.fn(),
        removeEventListener: jest.fn(),
        dispatchEvent: jest.fn(),
      }));

      uiUtils.applyTheme('auto');

      expect(document.body.classList.contains('theme-dark')).toBe(true);
      expect(document.body.classList.contains('theme-light')).toBe(false);
    });

    it('should detect light system preference in auto mode', () => {
      window.matchMedia = jest.fn().mockImplementation(query => ({
        matches: false,
        media: query,
        onchange: null,
        addListener: jest.fn(),
        removeListener: jest.fn(),
        addEventListener: jest.fn(),
        removeEventListener: jest.fn(),
        dispatchEvent: jest.fn(),
      }));

      uiUtils.applyTheme('auto');

      expect(document.body.classList.contains('theme-light')).toBe(true);
      expect(document.body.classList.contains('theme-dark')).toBe(false);
    });

    it('should remove old theme class when switching', () => {
      document.body.classList.add('theme-dark');

      uiUtils.applyTheme('light');

      expect(document.body.classList.contains('theme-dark')).toBe(false);
      expect(document.body.classList.contains('theme-light')).toBe(true);
    });

    it('should default to auto mode', () => {
      uiUtils.applyTheme();

      const hasTheme = document.body.classList.contains('theme-dark') ||
                       document.body.classList.contains('theme-light');
      expect(hasTheme).toBe(true);
    });

    it('should handle missing matchMedia gracefully', () => {
      const originalMatchMedia = window.matchMedia;
      delete window.matchMedia;

      expect(() => {
        uiUtils.applyTheme('auto');
      }).not.toThrow();

      window.matchMedia = originalMatchMedia;
    });

    it('should handle errors during theme application', () => {
      const consoleError = jest.spyOn(console, 'error').mockImplementation();

      // Save original classList
      const originalClassList = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(document.body), 'classList');

      // Make classList operations throw
      Object.defineProperty(document.body, 'classList', {
        get: () => {
          throw new Error('DOM error');
        },
        configurable: true
      });

      uiUtils.applyTheme('dark');

      expect(consoleError).toHaveBeenCalledWith('Error applying theme:', expect.any(Error));

      // Restore original classList
      if (originalClassList) {
        Object.defineProperty(document.body, 'classList', originalClassList);
      } else {
        delete document.body.classList;
      }

      consoleError.mockRestore();
    });
  });

  describe('applyUiPreferences', () => {
    it('should apply high contrast mode', () => {
      uiUtils.applyUiPreferences({ highContrast: true });

      expect(document.body.classList.contains('high-contrast')).toBe(true);
    });

    it('should remove high contrast mode when false', () => {
      document.body.classList.add('high-contrast');

      uiUtils.applyUiPreferences({ highContrast: false });

      expect(document.body.classList.contains('high-contrast')).toBe(false);
    });

    it('should apply opaque panels mode', () => {
      uiUtils.applyUiPreferences({ opaquePanels: true });

      expect(document.body.classList.contains('opaque-panels')).toBe(true);
    });

    it('should remove opaque panels mode when false', () => {
      document.body.classList.add('opaque-panels');

      uiUtils.applyUiPreferences({ opaquePanels: false });

      expect(document.body.classList.contains('opaque-panels')).toBe(false);
    });

    it('should apply compact density', () => {
      uiUtils.applyUiPreferences({ density: 'compact' });

      expect(document.body.classList.contains('density-compact')).toBe(true);
    });

    it('should remove compact density for comfortable mode', () => {
      document.body.classList.add('density-compact');

      uiUtils.applyUiPreferences({ density: 'comfortable' });

      expect(document.body.classList.contains('density-compact')).toBe(false);
    });

    it('should default to comfortable density', () => {
      document.body.classList.add('density-compact');

      uiUtils.applyUiPreferences({});

      expect(document.body.classList.contains('density-compact')).toBe(false);
    });

    it('should apply multiple preferences simultaneously', () => {
      uiUtils.applyUiPreferences({
        highContrast: true,
        opaquePanels: true,
        density: 'compact'
      });

      expect(document.body.classList.contains('high-contrast')).toBe(true);
      expect(document.body.classList.contains('opaque-panels')).toBe(true);
      expect(document.body.classList.contains('density-compact')).toBe(true);
    });

    it('should handle undefined preferences object', () => {
      expect(() => {
        uiUtils.applyUiPreferences();
      }).not.toThrow();
    });

    it('should handle errors during UI preferences application', () => {
      const consoleError = jest.spyOn(console, 'error').mockImplementation();

      // Save original classList
      const originalClassList = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(document.body), 'classList');

      Object.defineProperty(document.body, 'classList', {
        get: () => {
          throw new Error('DOM error');
        },
        configurable: true
      });

      uiUtils.applyUiPreferences({ highContrast: true });

      expect(consoleError).toHaveBeenCalledWith('Error applying UI preferences:', expect.any(Error));

      // Restore original classList
      if (originalClassList) {
        Object.defineProperty(document.body, 'classList', originalClassList);
      } else {
        delete document.body.classList;
      }

      consoleError.mockRestore();
    });
  });

  describe('trapFocus', () => {
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

      uiUtils.trapFocus(modal);

      // Fast-forward setTimeout
      jest.advanceTimersByTime(0);

      expect(focusSpy).toHaveBeenCalled();

      focusSpy.mockRestore();
    });

    it('should trap Tab key at last element', () => {
      const lastButton = modal.querySelector('#last');

      uiUtils.trapFocus(modal);

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

      uiUtils.trapFocus(modal);

      // Simulate focus on first element
      firstButton.focus();

      // Simulate Shift+Tab key
      const shiftTabEvent = new KeyboardEvent('keydown', {
        key: 'Tab',
        shiftKey: true,
        bubbles: true
      });
      const preventDefaultSpy = jest.spyOn(shiftTabEvent, 'preventDefault');

      modal.dispatchEvent(shiftTabEvent);

      expect(preventDefaultSpy).toHaveBeenCalled();

      preventDefaultSpy.mockRestore();
    });

    it('should ignore non-Tab keys', () => {
      uiUtils.trapFocus(modal);

      const enterEvent = new KeyboardEvent('keydown', { key: 'Enter', bubbles: true });
      const preventDefaultSpy = jest.spyOn(enterEvent, 'preventDefault');

      modal.dispatchEvent(enterEvent);

      expect(preventDefaultSpy).not.toHaveBeenCalled();

      preventDefaultSpy.mockRestore();
    });

    it('should handle modal with no focusable elements', () => {
      modal.innerHTML = '<div>No focusable elements</div>';

      expect(() => {
        uiUtils.trapFocus(modal);
      }).not.toThrow();
    });

    it('should store last focused element', () => {
      const externalButton = document.createElement('button');
      externalButton.id = 'external';
      document.body.appendChild(externalButton);

      externalButton.focus();

      uiUtils.trapFocus(modal);

      // The last focused element should be stored
      // We can verify this by calling releaseFocusTrap later

      document.body.removeChild(externalButton);
    });

    it('should handle errors during focus trap', () => {
      const consoleError = jest.spyOn(console, 'error').mockImplementation();

      // Create a modal that will cause an error
      const badModal = null;

      uiUtils.trapFocus(badModal);

      expect(consoleError).toHaveBeenCalledWith('Error trapping focus:', expect.any(Error));

      consoleError.mockRestore();
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
      uiUtils.trapFocus(modal);

      const removeEventListenerSpy = jest.spyOn(modal, 'removeEventListener');

      uiUtils.releaseFocusTrap(modal);

      expect(removeEventListenerSpy).toHaveBeenCalledWith('keydown', expect.any(Function));

      removeEventListenerSpy.mockRestore();
    });

    it('should restore focus to last focused element', () => {
      const externalButton = document.createElement('button');
      externalButton.id = 'external';
      document.body.appendChild(externalButton);

      const focusSpy = jest.spyOn(externalButton, 'focus');

      externalButton.focus();
      uiUtils.trapFocus(modal);
      uiUtils.releaseFocusTrap(modal);

      // Fast-forward setTimeout
      jest.advanceTimersByTime(0);

      expect(focusSpy).toHaveBeenCalled();

      focusSpy.mockRestore();
      document.body.removeChild(externalButton);
    });

    it('should handle modal without active trap', () => {
      expect(() => {
        uiUtils.releaseFocusTrap(modal);
      }).not.toThrow();
    });

    it('should handle null modal gracefully', () => {
      // Should not throw when called with null
      expect(() => {
        uiUtils.releaseFocusTrap(null);
      }).not.toThrow();
    });
  });

  describe('showLoading', () => {
    let loadingOverlay;

    beforeEach(() => {
      loadingOverlay = document.createElement('div');
      loadingOverlay.id = 'loading-overlay';
      loadingOverlay.classList.add('hidden');
      document.body.appendChild(loadingOverlay);
    });

    it('should show loading overlay when true', () => {
      uiUtils.showLoading(true);

      expect(loadingOverlay.classList.contains('hidden')).toBe(false);
    });

    it('should hide loading overlay when false', () => {
      loadingOverlay.classList.remove('hidden');

      uiUtils.showLoading(false);

      expect(loadingOverlay.classList.contains('hidden')).toBe(true);
    });

    it('should toggle loading state multiple times', () => {
      uiUtils.showLoading(true);
      expect(loadingOverlay.classList.contains('hidden')).toBe(false);

      uiUtils.showLoading(false);
      expect(loadingOverlay.classList.contains('hidden')).toBe(true);

      uiUtils.showLoading(true);
      expect(loadingOverlay.classList.contains('hidden')).toBe(false);
    });

    it('should handle missing loading overlay gracefully', () => {
      document.body.removeChild(loadingOverlay);

      expect(() => {
        uiUtils.showLoading(true);
      }).not.toThrow();
    });

    it('should handle errors during loading state change', () => {
      const consoleError = jest.spyOn(console, 'error').mockImplementation();

      // Save original classList
      const originalClassList = Object.getOwnPropertyDescriptor(loadingOverlay, 'classList') ||
                                Object.getOwnPropertyDescriptor(Object.getPrototypeOf(loadingOverlay), 'classList');

      Object.defineProperty(loadingOverlay, 'classList', {
        get: () => {
          throw new Error('DOM error');
        },
        configurable: true
      });

      uiUtils.showLoading(true);

      expect(consoleError).toHaveBeenCalledWith('Error showing loading:', expect.any(Error));

      // Restore original classList
      if (originalClassList) {
        Object.defineProperty(loadingOverlay, 'classList', originalClassList);
      } else {
        delete loadingOverlay.classList;
      }

      consoleError.mockRestore();
    });
  });

  describe('setStatus', () => {
    let statusIndicator;

    beforeEach(() => {
      statusIndicator = document.createElement('div');
      statusIndicator.id = 'connection-status';
      document.body.appendChild(statusIndicator);
    });

    it('should set connected status', () => {
      uiUtils.setStatus(true);

      expect(statusIndicator.classList.contains('connection-indicator')).toBe(true);
      expect(statusIndicator.classList.contains('connected')).toBe(true);
      expect(statusIndicator.title).toBe('Connected to Home Assistant');
    });

    it('should set disconnected status', () => {
      statusIndicator.classList.add('connected');

      uiUtils.setStatus(false);

      expect(statusIndicator.classList.contains('connection-indicator')).toBe(true);
      expect(statusIndicator.classList.contains('connected')).toBe(false);
      expect(statusIndicator.title).toBe('Disconnected from Home Assistant');
    });

    it('should clear innerHTML', () => {
      statusIndicator.innerHTML = '<span>Old content</span>';

      uiUtils.setStatus(true);

      expect(statusIndicator.innerHTML).toBe('');
    });

    it('should toggle status multiple times', () => {
      uiUtils.setStatus(true);
      expect(statusIndicator.classList.contains('connected')).toBe(true);

      uiUtils.setStatus(false);
      expect(statusIndicator.classList.contains('connected')).toBe(false);

      uiUtils.setStatus(true);
      expect(statusIndicator.classList.contains('connected')).toBe(true);
    });

    it('should handle missing status indicator gracefully', () => {
      document.body.removeChild(statusIndicator);

      expect(() => {
        uiUtils.setStatus(true);
      }).not.toThrow();
    });

    it('should handle errors during status update', () => {
      const consoleError = jest.spyOn(console, 'error').mockImplementation();

      // Save original className descriptor
      const originalClassName = Object.getOwnPropertyDescriptor(statusIndicator, 'className') ||
                               Object.getOwnPropertyDescriptor(Object.getPrototypeOf(statusIndicator), 'className');

      Object.defineProperty(statusIndicator, 'className', {
        set: () => {
          throw new Error('DOM error');
        },
        get: () => '',
        configurable: true
      });

      uiUtils.setStatus(true);

      expect(consoleError).toHaveBeenCalledWith('Error setting status:', expect.any(Error));

      // Restore original className
      if (originalClassName) {
        Object.defineProperty(statusIndicator, 'className', originalClassName);
      } else {
        delete statusIndicator.className;
      }

      consoleError.mockRestore();
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
      const promise = uiUtils.showConfirm('Delete Item', 'Are you sure you want to delete this item?');

      expect(titleEl.textContent).toBe('Delete Item');
      expect(messageEl.textContent).toBe('Are you sure you want to delete this item?');
      expect(modal.classList.contains('hidden')).toBe(false);
      expect(modal.style.display).toBe('flex');

      // Clean up
      cancelBtn.click();
      await promise;
    });

    it('should return true when OK button clicked', async () => {
      const promise = uiUtils.showConfirm('Confirm', 'Continue?');

      okBtn.click();

      const result = await promise;
      expect(result).toBe(true);
    });

    it('should return false when Cancel button clicked', async () => {
      const promise = uiUtils.showConfirm('Confirm', 'Continue?');

      cancelBtn.click();

      const result = await promise;
      expect(result).toBe(false);
    });

    it('should return true when Enter key pressed', async () => {
      const promise = uiUtils.showConfirm('Confirm', 'Continue?');

      const enterEvent = new KeyboardEvent('keydown', { key: 'Enter', bubbles: true });
      document.dispatchEvent(enterEvent);

      const result = await promise;
      expect(result).toBe(true);
    });

    it('should return false when Escape key pressed', async () => {
      const promise = uiUtils.showConfirm('Confirm', 'Continue?');

      const escapeEvent = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true });
      document.dispatchEvent(escapeEvent);

      const result = await promise;
      expect(result).toBe(false);
    });

    it('should return false when clicking backdrop', async () => {
      const promise = uiUtils.showConfirm('Confirm', 'Continue?');

      // Click on modal itself (backdrop)
      const clickEvent = new MouseEvent('click', { bubbles: true });
      Object.defineProperty(clickEvent, 'target', { value: modal, enumerable: true });
      modal.dispatchEvent(clickEvent);

      const result = await promise;
      expect(result).toBe(false);
    });

    it('should not close when clicking modal content', async () => {
      const promise = uiUtils.showConfirm('Confirm', 'Continue?');

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
      const promise = uiUtils.showConfirm('Delete', 'Delete this?', {
        confirmText: 'Delete',
        cancelText: 'Keep'
      });

      expect(okBtn.textContent).toBe('Delete');
      expect(cancelBtn.textContent).toBe('Keep');

      // Clean up
      cancelBtn.click();
      await promise;
    });

    it('should apply custom button class', async () => {
      const promise = uiUtils.showConfirm('Warning', 'Continue?', {
        confirmClass: 'btn-warning'
      });

      expect(okBtn.className).toContain('btn-warning');

      // Clean up
      cancelBtn.click();
      await promise;
    });

    it('should default to danger class for confirm button', async () => {
      const promise = uiUtils.showConfirm('Confirm', 'Continue?');

      expect(okBtn.className).toContain('btn-danger');

      // Clean up
      cancelBtn.click();
      await promise;
    });

    it('should hide modal after confirmation', async () => {
      const promise = uiUtils.showConfirm('Confirm', 'Continue?');

      okBtn.click();

      await promise;

      expect(modal.classList.contains('hidden')).toBe(true);
      expect(modal.style.display).toBe('none');
    });

    it('should handle missing modal elements gracefully', async () => {
      const consoleError = jest.spyOn(console, 'error').mockImplementation();
      document.body.removeChild(modal);

      const result = await uiUtils.showConfirm('Test', 'Message');

      expect(result).toBe(false);
      consoleError.mockRestore();
    });

    it('should handle errors during modal display', async () => {
      const consoleError = jest.spyOn(console, 'error').mockImplementation();

      // Remove required elements to cause error
      document.body.removeChild(modal);

      const result = await uiUtils.showConfirm('Test', 'Message');

      expect(consoleError).toHaveBeenCalledWith('Confirm modal elements not found');
      expect(result).toBe(false);

      consoleError.mockRestore();
    });
  });

  describe('custom theme utilities', () => {
    beforeEach(() => {
      uiUtils.setCustomThemes([]);
      document.body.innerHTML = '';
      document.body.dataset.accent = '';
      document.body.dataset.background = '';
    });

    it('appends custom themes after built-in themes', () => {
      uiUtils.setCustomThemes([
        {
          id: 'custom-ocean',
          name: 'Ocean',
          color: '#336699',
          createdAt: '2026-01-01T00:00:00.000Z',
          updatedAt: '2026-01-01T00:00:00.000Z'
        }
      ]);

      const themes = uiUtils.getAccentThemes();
      expect(themes[0].id).toBe('original');
      expect(themes[themes.length - 1]).toEqual(expect.objectContaining({
        id: 'custom-ocean',
        name: 'Ocean',
        color: '#336699',
        isCustom: true
      }));
    });

    it('filters invalid and duplicate custom colors by normalized hex', () => {
      uiUtils.setCustomThemes([
        { id: 'bad', name: 'Invalid', color: '#GGHHII' },
        { id: 'one', name: 'One', color: '#123456' },
        { id: 'dup', name: 'Duplicate', color: '#123456' },
      ]);

      const customThemes = uiUtils.getAccentThemes().filter(theme => theme.isCustom);
      expect(customThemes).toHaveLength(1);
      expect(customThemes[0]).toEqual(expect.objectContaining({
        id: 'one',
        color: '#123456'
      }));
    });

    it('applies a registered custom accent theme', () => {
      uiUtils.setCustomThemes([
        { id: 'custom-night', name: 'Night', color: '#224466' },
      ]);

      uiUtils.applyAccentTheme('custom-night');

      expect(document.documentElement.style.getPropertyValue('--accent')).toBe('#224466');
      expect(document.body.dataset.accent).toBe('custom-night');
    });

    it('applies unsaved accent/background preview colors from hex', () => {
      const accentApplied = uiUtils.applyAccentThemeFromColor('#ABCDEF');
      const backgroundApplied = uiUtils.applyBackgroundThemeFromColor('#445566');

      expect(accentApplied).toBe(true);
      expect(backgroundApplied).toBe(true);
      expect(document.body.dataset.accent).toBe('custom-preview');
      expect(document.body.dataset.background).toBe('custom-preview');
      expect(document.documentElement.style.getPropertyValue('--accent')).toBe('#ABCDEF');
      expect(document.body.style.getPropertyValue('--frosted-bg-rgb')).toMatch(/\d+,\s\d+,\s\d+/);
    });
  });

  describe('Module exports', () => {
    it('should export all required functions', () => {
      expect(typeof uiUtils.showToast).toBe('function');
      expect(typeof uiUtils.applyTheme).toBe('function');
      expect(typeof uiUtils.setCustomThemes).toBe('function');
      expect(typeof uiUtils.applyAccentTheme).toBe('function');
      expect(typeof uiUtils.applyAccentThemeFromColor).toBe('function');
      expect(typeof uiUtils.applyBackgroundTheme).toBe('function');
      expect(typeof uiUtils.applyBackgroundThemeFromColor).toBe('function');
      expect(typeof uiUtils.getAccentThemes).toBe('function');
      expect(typeof uiUtils.getBackgroundThemes).toBe('function');
      expect(typeof uiUtils.applyUiPreferences).toBe('function');
      expect(typeof uiUtils.trapFocus).toBe('function');
      expect(typeof uiUtils.releaseFocusTrap).toBe('function');
      expect(typeof uiUtils.showLoading).toBe('function');
      expect(typeof uiUtils.setStatus).toBe('function');
      expect(typeof uiUtils.showConfirm).toBe('function');
    });
  });
});

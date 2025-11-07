let lastFocusedElement = null;
const focusTrapHandlers = new WeakMap();

function showToast(message, type = 'success', timeout = 2000) {
  try {
    const container = document.getElementById('toast-container');
    if (!container) return;
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    toast.textContent = message;
    container.appendChild(toast);
    setTimeout(() => {
      toast.style.opacity = '0';
      toast.style.transition = 'opacity 0.3s';
      setTimeout(() => container.removeChild(toast), 300);
    }, timeout);
  } catch (error) {
    console.error('Error showing toast:', error);
  }
}

function applyTheme(mode = 'auto') {
  try {
    const body = document.body;
    body.classList.remove('theme-dark', 'theme-light');
    if (mode === 'dark') {
      body.classList.add('theme-dark');
    } else if (mode === 'light') {
      body.classList.add('theme-light');
    } else {
      const prefersDark = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
      body.classList.add(prefersDark ? 'theme-dark' : 'theme-light');
    }
  } catch (error) {
    console.error('Error applying theme:', error);
  }
}

function applyUiPreferences(ui = {}) {
  try {
    const body = document.body;
    body.classList.toggle('high-contrast', !!ui.highContrast);
    body.classList.toggle('opaque-panels', !!ui.opaquePanels);
    body.classList.toggle('density-compact', (ui.density || 'comfortable') === 'compact');
  } catch (error) {
    console.error('Error applying UI preferences:', error);
  }
}

function trapFocus(modal) {
  try {
    lastFocusedElement = document.activeElement;
    const focusable = modal.querySelectorAll('a[href], button, textarea, input, select, [tabindex]:not([tabindex="-1"])');
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    const handler = (e) => {
      if (e.key !== 'Tab') return;
      if (focusable.length === 0) return;
      if (e.shiftKey) {
        if (document.activeElement === first) { e.preventDefault(); last.focus(); }
      } else {
        if (document.activeElement === last) { e.preventDefault(); first.focus(); }
      }
    };
    modal.addEventListener('keydown', handler);
    focusTrapHandlers.set(modal, handler);
    setTimeout(() => first?.focus(), 0);
  } catch (error) {
    console.error('Error trapping focus:', error);
  }
}

function releaseFocusTrap(modal) {
  try {
    const handler = focusTrapHandlers.get(modal);
    if (handler) modal.removeEventListener('keydown', handler);
    focusTrapHandlers.delete(modal);
    if (lastFocusedElement && lastFocusedElement.focus) {
      setTimeout(() => lastFocusedElement.focus(), 0);
    }
  } catch (error) {
    console.error('Error releasing focus trap:', error);
  }
}

function showLoading(show) {
  try {
    const overlay = document.getElementById('loading-overlay');
    if (!overlay) return;
    overlay.classList.toggle('hidden', !show);
  } catch (error) {
    console.error('Error showing loading:', error);
  }
}

function setStatus(connected) {
  try {
    const status = document.getElementById('connection-status');
    if (status) {
      status.className = connected ? 'connection-indicator connected' : 'connection-indicator';
      status.innerHTML = '';
      status.title = connected ? 'Connected to Home Assistant' : 'Disconnected from Home Assistant';
    }
  } catch (error) {
    console.error('Error setting status:', error);
  }
}

window.electronAPI.onHotkeyRegistrationFailed(({ hotkey }) => {
  showToast(`Hotkey "${hotkey}" is already in use by another application.`, 'error', 5000);
});

function showConfirm(title, message, options = {}) {
  return new Promise((resolve) => {
    try {
      const modal = document.getElementById('confirm-modal');
      const titleEl = document.getElementById('confirm-title');
      const messageEl = document.getElementById('confirm-message');
      const cancelBtn = document.getElementById('confirm-cancel-btn');
      const okBtn = document.getElementById('confirm-ok-btn');

      if (!modal || !titleEl || !messageEl || !cancelBtn || !okBtn) {
        console.error('Confirm modal elements not found');
        resolve(false);
        return;
      }

      // Set content
      titleEl.textContent = title || 'Confirm Action';
      messageEl.textContent = message || 'Are you sure?';
      okBtn.textContent = options.confirmText || 'Confirm';
      cancelBtn.textContent = options.cancelText || 'Cancel';

      // Configure buttons
      okBtn.className = `btn ${options.confirmClass || 'btn-danger'}`;

      // Handle confirmation
      const handleConfirm = () => {
        cleanup();
        resolve(true);
      };

      const handleCancel = () => {
        cleanup();
        resolve(false);
      };

      const handleKeydown = (e) => {
        if (e.key === 'Escape') {
          handleCancel();
        } else if (e.key === 'Enter') {
          handleConfirm();
        }
      };

      const cleanup = () => {
        modal.classList.add('hidden');
        modal.style.display = 'none';
        okBtn.removeEventListener('click', handleConfirm);
        cancelBtn.removeEventListener('click', handleCancel);
        modal.removeEventListener('click', handleBackdropClick);
        document.removeEventListener('keydown', handleKeydown);
        releaseFocusTrap(modal);
      };

      const handleBackdropClick = (e) => {
        if (e.target === modal) {
          handleCancel();
        }
      };

      // Wire up events
      okBtn.addEventListener('click', handleConfirm);
      cancelBtn.addEventListener('click', handleCancel);
      modal.addEventListener('click', handleBackdropClick);
      document.addEventListener('keydown', handleKeydown);

      // Show modal
      modal.classList.remove('hidden');
      modal.style.display = 'flex';
      trapFocus(modal);
    } catch (error) {
      console.error('Error showing confirm dialog:', error);
      resolve(false);
    }
  });
}

module.exports = {
  showToast,
  applyTheme,
  applyUiPreferences,
  trapFocus,
  releaseFocusTrap,
  showLoading,
  setStatus,
  showConfirm,
};

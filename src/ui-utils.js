let lastFocusedElement = null;
const focusTrapHandlers = new WeakMap();
let cachedPlatform = null;
const DEFAULT_FROSTED_STRENGTH = 60;
const DEFAULT_FROSTED_TINT = 60;

function getPlatform() {
  if (cachedPlatform) return cachedPlatform;
  const platform = window?.electronAPI?.platform;
  if (platform) {
    cachedPlatform = platform;
    return cachedPlatform;
  }
  return null;
}

function isNativeGlassPlatform() {
  const platform = getPlatform();
  return platform === 'win32' || platform === 'darwin';
}

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

/**
 * Applies frosted glass window effects to the application.
 * 
 * This function implements a multi-layer glassmorphism approach:
 * 1. Sets CSS custom properties for blur strength and opacity values
 * 2. Toggles the 'frosted-glass' class on the body element
 * 3. CSS handles the actual rendering (backdrop-filter, transparency)
 * 
 * The effect requires:
 * - HTML element to be transparent (set in CSS)
 * - Body to have backdrop-filter when frosted-glass class is present
 * - Content containers to have semi-transparent backgrounds
 * 
 * @param {Object} config - Configuration object
 * @param {boolean} config.frostedGlass - Whether to enable frosted glass
 */
function applyWindowEffects(config = {}) {
  try {
    const body = document.body;
    const enabled = !!config.frostedGlass;

    if (!enabled) {
      // Remove frosted glass class first
      body.classList.remove('frosted-glass');
      body.classList.remove('native-glass');
      
      // Then clear all custom properties
      body.style.removeProperty('--frosted-blur');
      body.style.removeProperty('--frosted-bg-alpha');
      body.style.removeProperty('--frosted-elevated-alpha');
      body.style.removeProperty('--frosted-surface-alpha');
      body.style.removeProperty('--frosted-surface-hover-alpha');
      body.style.removeProperty('--frosted-card-alpha');
      body.style.removeProperty('--frosted-glass-alpha');
      body.style.removeProperty('--frosted-glass-elevated-alpha');
      body.style.removeProperty('--frosted-glass-overlay-alpha');
      return;
    }

    const strength = DEFAULT_FROSTED_STRENGTH;
    const tint = DEFAULT_FROSTED_TINT / 100;
    
    // Linear interpolation helper
    const lerp = (min, max, value) => min + (max - min) * value;

    // Calculate blur amount based on strength (0px to 42px range)
    const blur = lerp(0, 42, strength / 100);

    // Calculate alpha values based on tint
    // Lower tint = more transparent, higher tint = more opaque
    const bgAlpha = lerp(0.25, 0.75, tint);
    const elevatedAlpha = lerp(0.3, 0.8, tint);
    const surfaceAlpha = lerp(0.25, 0.75, tint);
    const surfaceHoverAlpha = lerp(0.35, 0.85, tint);
    const cardAlpha = lerp(0.2, 0.65, tint);
    const glassAlpha = lerp(0.2, 0.6, tint);
    const glassElevatedAlpha = lerp(0.25, 0.7, tint);
    const glassOverlayAlpha = lerp(0.3, 0.85, tint);

    /* 
     * CRITICAL: Set CSS custom properties BEFORE adding the class.
     * This ensures the browser has the values ready when it processes
     * the class change, preventing flash of unstyled content.
     */
    body.style.setProperty('--frosted-blur', `${blur.toFixed(1)}px`);
    body.style.setProperty('--frosted-bg-alpha', bgAlpha.toFixed(3));
    body.style.setProperty('--frosted-elevated-alpha', elevatedAlpha.toFixed(3));
    body.style.setProperty('--frosted-surface-alpha', surfaceAlpha.toFixed(3));
    body.style.setProperty('--frosted-surface-hover-alpha', surfaceHoverAlpha.toFixed(3));
    body.style.setProperty('--frosted-card-alpha', cardAlpha.toFixed(3));
    body.style.setProperty('--frosted-glass-alpha', glassAlpha.toFixed(3));
    body.style.setProperty('--frosted-glass-elevated-alpha', glassElevatedAlpha.toFixed(3));
    body.style.setProperty('--frosted-glass-overlay-alpha', glassOverlayAlpha.toFixed(3));
    
    // Now add the frosted-glass class
    body.classList.add('frosted-glass');
    body.classList.toggle('native-glass', isNativeGlassPlatform());
  } catch (error) {
    console.error('Error applying window effects:', error);
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

export {
  showToast,
  applyTheme,
  applyUiPreferences,
  applyWindowEffects,
  trapFocus,
  releaseFocusTrap,
  showLoading,
  setStatus,
  showConfirm,
};

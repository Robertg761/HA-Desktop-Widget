let lastFocusedElement = null;
const focusTrapHandlers = new WeakMap();
let cachedPlatform = null;
const DEFAULT_FROSTED_STRENGTH = 60;
const DEFAULT_FROSTED_TINT = 60;
const ACCENT_THEMES = [
  { id: 'original', name: 'Original', color: '#64b5f6', description: 'The classic dark look' },
  { id: 'indigo', name: 'Indigo', color: '#6366f1', description: 'Focused and modern' },
  { id: 'violet', name: 'Violet', color: '#8b5cf6', description: 'Creative and bold' },
  { id: 'rose', name: 'Rose', color: '#f43f5e', description: 'Vivid and energetic' },
  { id: 'coral', name: 'Coral', color: '#f97316', description: 'Warm and upbeat' },
  { id: 'amber', name: 'Amber', color: '#f59e0b', description: 'Golden and friendly' },
  { id: 'emerald', name: 'Emerald', color: '#10b981', description: 'Fresh and balanced' },
  { id: 'teal', name: 'Teal', color: '#14b8a6', description: 'Calm and refined' },
  { id: 'aqua', name: 'Aqua', color: '#22d3ee', description: 'Light and airy' },
  { id: 'slate', name: 'Slate', color: '#94a3b8', description: 'Neutral and understated' },
];
const ACCENT_THEME_MAP = ACCENT_THEMES.reduce((acc, theme) => {
  acc[theme.id] = theme;
  return acc;
}, {});

const BACKGROUND_BASES = {
  dark: {
    bgColor: { r: 40, g: 40, b: 45, a: 0.8 },
    bgElevated: { r: 30, g: 30, b: 35, a: 0.9 },
    bgPrimary: { r: 20, g: 20, b: 25, a: 0.95 },
    bgSecondary: { r: 30, g: 30, b: 35, a: 0.9 },
    bgTertiary: { r: 40, g: 40, b: 45, a: 0.85 },
    surface1: { r: 25, g: 25, b: 30, a: 0.8 },
    surface2: { r: 35, g: 35, b: 40, a: 0.85 },
    surface3: { r: 45, g: 45, b: 50, a: 0.9 },
    surfaceHover: { r: 50, g: 50, b: 55, a: 0.95 },
    cardBg: { r: 30, g: 30, b: 35, a: 0.7 },
    glassSurface: { r: 30, g: 30, b: 35, a: 0.7 },
    glassElevated: { r: 40, g: 40, b: 45, a: 0.8 },
    glassOverlay: { r: 20, g: 20, b: 25, a: 0.85 },
    loadingOverlay: { r: 20, g: 20, b: 25, a: 0.7 },
  },
  light: {
    bgColor: { r: 250, g: 250, b: 250, a: 0.8 },
    bgElevated: { r: 255, g: 255, b: 255, a: 0.9 },
    bgPrimary: { r: 245, g: 245, b: 250, a: 0.95 },
    bgSecondary: { r: 255, g: 255, b: 255, a: 0.9 },
    bgTertiary: { r: 240, g: 240, b: 245, a: 0.85 },
    surface1: { r: 250, g: 250, b: 255, a: 0.8 },
    surface2: { r: 255, g: 255, b: 255, a: 0.85 },
    surface3: { r: 255, g: 255, b: 255, a: 0.9 },
    surfaceHover: { r: 240, g: 240, b: 245, a: 0.95 },
    cardBg: { r: 255, g: 255, b: 255, a: 0.7 },
    glassSurface: { r: 255, g: 255, b: 255, a: 0.7 },
    glassElevated: { r: 250, g: 250, b: 250, a: 0.8 },
    glassOverlay: { r: 245, g: 245, b: 250, a: 0.85 },
    loadingOverlay: { r: 245, g: 245, b: 250, a: 0.7 },
  },
};

function hexToRgb(hex) {
  if (!hex || typeof hex !== 'string') return null;
  const normalized = hex.replace('#', '').trim();
  if (![3, 6].includes(normalized.length)) return null;
  const value = normalized.length === 3
    ? normalized.split('').map(ch => ch + ch).join('')
    : normalized;
  const r = Number.parseInt(value.slice(0, 2), 16);
  const g = Number.parseInt(value.slice(2, 4), 16);
  const b = Number.parseInt(value.slice(4, 6), 16);
  if (Number.isNaN(r) || Number.isNaN(g) || Number.isNaN(b)) return null;
  return { r, g, b };
}

function mixRgb(base, mixin, amount) {
  const mix = (channel) => Math.round(base[channel] + (mixin[channel] - base[channel]) * amount);
  return {
    r: mix('r'),
    g: mix('g'),
    b: mix('b'),
  };
}

function getAccentThemes() {
  return ACCENT_THEMES.map(theme => {
    const rgb = hexToRgb(theme.color);
    return {
      ...theme,
      rgb: rgb ? `${rgb.r}, ${rgb.g}, ${rgb.b}` : null,
    };
  });
}

function getBackgroundThemes() {
  return getAccentThemes();
}

function resolveAccentThemeId(accentKey) {
  if (accentKey && ACCENT_THEME_MAP[accentKey]) return accentKey;
  if (accentKey === 'sky' && ACCENT_THEME_MAP.original) return 'original';
  return ACCENT_THEME_MAP.original ? 'original' : (ACCENT_THEMES[0]?.id || 'original');
}

function resolveBackgroundThemeId(backgroundKey) {
  if (backgroundKey && ACCENT_THEME_MAP[backgroundKey]) return backgroundKey;
  if (backgroundKey === 'sky' && ACCENT_THEME_MAP.original) return 'original';
  return ACCENT_THEME_MAP.original ? 'original' : (ACCENT_THEMES[0]?.id || 'original');
}

function applyAccentTheme(accentKey) {
  try {
    const resolvedKey = resolveAccentThemeId(accentKey);
    const theme = ACCENT_THEME_MAP[resolvedKey];
    if (!theme) return;

    const rgb = hexToRgb(theme.color);
    if (!rgb) return;

    const root = document.documentElement;
    if (!root) return;

    const isLightTheme = document.body?.classList.contains('theme-light');
    const hoverMix = isLightTheme ? 0.18 : 0.22;
    const hoverRgb = mixRgb(rgb, isLightTheme ? { r: 0, g: 0, b: 0 } : { r: 255, g: 255, b: 255 }, hoverMix);
    const accentBgAlpha = isLightTheme ? 0.12 : 0.18;
    const glowAlpha = isLightTheme ? 0.22 : 0.35;
    const focusAlpha = isLightTheme ? 0.18 : 0.25;

    root.style.setProperty('--accent', theme.color);
    root.style.setProperty('--accent-rgb', `${rgb.r}, ${rgb.g}, ${rgb.b}`);
    root.style.setProperty('--accent-hover', `rgb(${hoverRgb.r}, ${hoverRgb.g}, ${hoverRgb.b})`);
    root.style.setProperty('--primary', theme.color);
    root.style.setProperty('--primary-hover', `rgb(${hoverRgb.r}, ${hoverRgb.g}, ${hoverRgb.b})`);
    root.style.setProperty('--accent-bg', `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, ${accentBgAlpha})`);
    root.style.setProperty('--border-focus', `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, 0.5)`);
    root.style.setProperty('--glow-accent', `0 0 20px rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, ${glowAlpha})`);
    root.style.setProperty('--glow-focus', `0 0 0 3px rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, ${focusAlpha})`);

    if (document.body) {
      document.body.dataset.accent = resolvedKey;
    }
  } catch (error) {
    console.error('Error applying accent theme:', error);
  }
}

function applyBackgroundTheme(backgroundKey) {
  try {
    const resolvedKey = resolveBackgroundThemeId(backgroundKey);
    const theme = ACCENT_THEME_MAP[resolvedKey];
    if (!theme) return;

    const rgb = hexToRgb(theme.color);
    if (!rgb) return;

    const root = document.documentElement;
    const body = document.body;
    if (!root || !body) return;

    const isLightTheme = body.classList.contains('theme-light');
    const base = isLightTheme ? BACKGROUND_BASES.light : BACKGROUND_BASES.dark;
    const tintAmount = resolvedKey === 'original' ? 0 : (isLightTheme ? 0.08 : 0.12);
    const tint = (baseRgb) => mixRgb(baseRgb, rgb, tintAmount);
    const setRgbaVar = (name, baseEntry) => {
      const tinted = tint(baseEntry);
      root.style.setProperty(name, `rgba(${tinted.r}, ${tinted.g}, ${tinted.b}, ${baseEntry.a})`);
      return tinted;
    };

    const bgColor = setRgbaVar('--bg-color', base.bgColor);
    const bgElevated = setRgbaVar('--bg-elevated', base.bgElevated);
    setRgbaVar('--bg-primary', base.bgPrimary);
    setRgbaVar('--bg-secondary', base.bgSecondary);
    const bgTertiary = setRgbaVar('--bg-tertiary', base.bgTertiary);
    const surface1 = setRgbaVar('--surface-1', base.surface1);
    setRgbaVar('--surface-2', base.surface2);
    setRgbaVar('--surface-3', base.surface3);
    const surfaceHover = setRgbaVar('--surface-hover', base.surfaceHover);
    const cardBg = setRgbaVar('--card-bg', base.cardBg);
    const glassSurface = setRgbaVar('--glass-surface', base.glassSurface);
    const glassElevated = setRgbaVar('--glass-elevated', base.glassElevated);
    const glassOverlay = setRgbaVar('--glass-overlay', base.glassOverlay);

    const setBodyRgb = (name, value) => {
      body.style.setProperty(name, `${value.r}, ${value.g}, ${value.b}`);
    };

    setBodyRgb('--frosted-bg-rgb', bgColor);
    setBodyRgb('--frosted-elevated-rgb', bgElevated);
    setBodyRgb('--frosted-tertiary-rgb', bgTertiary);
    setBodyRgb('--frosted-surface-rgb', surface1);
    setBodyRgb('--frosted-surface-hover-rgb', surfaceHover);
    setBodyRgb('--frosted-card-rgb', cardBg);
    setBodyRgb('--frosted-glass-rgb', glassSurface);
    setBodyRgb('--frosted-glass-elevated-rgb', glassElevated);
    setBodyRgb('--frosted-glass-overlay-rgb', glassOverlay);

    const loadingOverlay = tint(base.loadingOverlay);
    setBodyRgb('--loading-overlay-rgb', loadingOverlay);

    body.dataset.background = resolvedKey;
  } catch (error) {
    console.error('Error applying background theme:', error);
  }
}

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
  applyAccentTheme,
  applyBackgroundTheme,
  getAccentThemes,
  getBackgroundThemes,
  applyUiPreferences,
  applyWindowEffects,
  trapFocus,
  releaseFocusTrap,
  showLoading,
  setStatus,
  showConfirm,
};

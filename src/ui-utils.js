/* global process */
import { t } from './i18n.js';
import { setIconContent } from './icons.js';

const focusTrapHandlers = new WeakMap();
const focusTrapPreviousFocus = new WeakMap();
const activeFocusTrapModals = new Set();
// One entry per modal that is currently animating out, so a later close (or a re-open) can take
// the in-flight timer and listener away from the call that installed them.
const pendingModalCloses = new WeakMap();
const DEFAULT_FROSTED_STRENGTH = 60;
const DEFAULT_FROSTED_TINT = 60;
const MIN_BACKGROUND_OPACITY = 0.08;
const BACKGROUND_OPACITY_CURVE = 1.35;
const CUSTOM_THEME_ID_PREFIX = 'custom-';
// The shared modal exit animation runs for var(--duration-base) (200ms); the fallback timer only
// exists for hosts that never deliver `animationend` (reduced-motion overrides, background tabs,
// jsdom).
const MODAL_EXIT_FALLBACK_MS = 300;
const TOAST_EXIT_FALLBACK_MS = 300;
const TOAST_ICON_NAMES = {
  success: 'checkCircle',
  error: 'error',
  warning: 'warning',
  info: 'info',
};
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
const BUILTIN_ACCENT_THEME_MAP = ACCENT_THEMES.reduce((acc, theme) => {
  acc[theme.id] = theme;
  return acc;
}, {});
let CUSTOM_THEMES = [];
let connectionStatusTooltip = null;
let connectionStatusTooltipTarget = null;
let connectionStatusTooltipPinned = false;
let connectionStatusTooltipHandlers = null;
let connectionStatusDocumentHandlersBound = false;
let connectionStatusBoundElement = null;

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

/**
 * Convert a hex color string into an object containing numeric RGB channels.
 * @param {string} hex - Hex color in 3- or 6-digit form, with or without a leading `#` (e.g. `#abc`, `abc`, `#aabbcc`, `aabbcc`).
 * @returns {{r: number, g: number, b: number} | null} The RGB components if `hex` is valid, or `null` for invalid input.
 */
function hexToRgb(hex) {
  if (!hex || typeof hex !== 'string') return null;
  const normalized = hex.replace('#', '').trim();
  if (![3, 6].includes(normalized.length)) return null;
  if (!/^[0-9a-fA-F]+$/.test(normalized)) return null;
  const value =
    normalized.length === 3
      ? normalized
          .split('')
          .map((ch) => ch + ch)
          .join('')
      : normalized;
  const r = Number.parseInt(value.slice(0, 2), 16);
  const g = Number.parseInt(value.slice(2, 4), 16);
  const b = Number.parseInt(value.slice(4, 6), 16);
  if (Number.isNaN(r) || Number.isNaN(g) || Number.isNaN(b)) return null;
  return { r, g, b };
}

function miredsToKelvin(mireds) {
  const value = Number(mireds);
  if (!Number.isFinite(value) || value <= 0) return null;
  return Math.round(1000000 / value);
}

function hasSupportedFeature(supportedFeatures, featureFlag) {
  const features = Number(supportedFeatures);
  const flag = Number(featureFlag);
  if (!Number.isFinite(features) || !Number.isFinite(flag) || flag <= 0) return false;
  return (features & flag) === flag;
}

/**
 * Interpolate two RGB colors by a given fraction.
 *
 * @param {{r:number, g:number, b:number}} base - Source RGB color used when `amount` is 0.
 * @param {{r:number, g:number, b:number}} mixin - Target RGB color used when `amount` is 1.
 * @param {number} amount - Interpolation factor between 0 and 1 where 0 returns `base` and 1 returns `mixin`.
 * @returns {{r:number, g:number, b:number}} The resulting RGB color channels, each linearly interpolated and rounded to the nearest integer.
 */
function mixRgb(base, mixin, amount) {
  const mix = (channel) => Math.round(base[channel] + (mixin[channel] - base[channel]) * amount);
  return {
    r: mix('r'),
    g: mix('g'),
    b: mix('b'),
  };
}

function mapWindowOpacityToBackgroundAlpha(opacity) {
  const normalized = (opacity - 0.5) / 0.5;
  const curvedOpacity = Math.pow(Math.max(0, Math.min(1, normalized)), BACKGROUND_OPACITY_CURVE);
  return MIN_BACKGROUND_OPACITY + curvedOpacity * (1 - MIN_BACKGROUND_OPACITY);
}

/**
 * Normalize a hex color string into uppercase 6-digit form (e.g. `#AABBCC`).
 * @param {string} hex - Candidate color string.
 * @returns {string|null} Normalized hex value or null when invalid.
 */
function normalizeHexColor(hex) {
  if (!hex || typeof hex !== 'string') return null;
  const trimmed = hex.trim();
  if (!trimmed) return null;
  const normalized = trimmed.startsWith('#') ? trimmed.slice(1) : trimmed;
  if (![3, 6].includes(normalized.length) || !/^[0-9a-fA-F]+$/.test(normalized)) return null;
  const sixDigit =
    normalized.length === 3
      ? normalized
          .split('')
          .map((ch) => ch + ch)
          .join('')
      : normalized;
  return `#${sixDigit.toUpperCase()}`;
}

/**
 * Convert a color theme to include its RGB string representation.
 * @param {Object} theme - Theme object containing a `color` field.
 * @returns {Object} Theme with `rgb` field added.
 */
function toThemeWithRgb(theme) {
  const normalizedColor = normalizeHexColor(theme?.color);
  const rgb = hexToRgb(normalizedColor);
  return {
    ...theme,
    color: normalizedColor || theme?.color,
    rgb: rgb ? `${rgb.r}, ${rgb.g}, ${rgb.b}` : null,
  };
}

/**
 * Get all theme definitions in render order: built-ins first, then custom themes.
 * @returns {Array<Object>} Combined theme list.
 */
function getAllThemes() {
  return [...ACCENT_THEMES, ...CUSTOM_THEMES];
}

/**
 * Build a map of all theme IDs to theme definitions.
 * @returns {Object<string, Object>} Theme map keyed by ID.
 */
function getThemeMap() {
  return getAllThemes().reduce((acc, theme) => {
    acc[theme.id] = theme;
    return acc;
  }, {});
}

/**
 * Register runtime custom themes from persisted user config.
 * @param {Array<{id?: string, name?: string, color?: string, createdAt?: string, updatedAt?: string}>} customColors - Stored custom color entries.
 */
function setCustomThemes(customColors = []) {
  if (!Array.isArray(customColors)) {
    CUSTOM_THEMES = [];
    return;
  }

  const seenThemeIds = new Set(Object.keys(BUILTIN_ACCENT_THEME_MAP));
  const seenColors = new Set();
  const nowIso = new Date().toISOString();
  const nextCustomThemes = [];

  customColors.forEach((entry, index) => {
    if (!entry || typeof entry !== 'object') return;
    const color = normalizeHexColor(entry.color);
    if (!color || seenColors.has(color)) return;

    const providedId = typeof entry.id === 'string' ? entry.id.trim() : '';
    let id = providedId;
    if (!id || seenThemeIds.has(id)) {
      id = `${CUSTOM_THEME_ID_PREFIX}${color.slice(1).toLowerCase()}`;
    }
    while (seenThemeIds.has(id)) {
      id = `${CUSTOM_THEME_ID_PREFIX}${color.slice(1).toLowerCase()}-${index + 1}`;
    }

    const name =
      typeof entry.name === 'string' && entry.name.trim() ? entry.name.trim() : `Custom ${color}`;
    const createdAt =
      typeof entry.createdAt === 'string' && entry.createdAt.trim() ? entry.createdAt : nowIso;
    const updatedAt =
      typeof entry.updatedAt === 'string' && entry.updatedAt.trim() ? entry.updatedAt : createdAt;

    nextCustomThemes.push({
      id,
      name,
      color,
      description: 'Saved custom color',
      isCustom: true,
      createdAt,
      updatedAt,
    });

    seenThemeIds.add(id);
    seenColors.add(color);
  });

  CUSTOM_THEMES = nextCustomThemes;
}

/**
 * Produce the list of accent themes augmented with an `rgb` string when the theme color is a valid hex.
 * @returns {Array<{id: string, name: string, color: string, description?: string, rgb: string|null}>} An array of accent theme objects; each includes original theme properties and an `rgb` string in the form `"r, g, b"` when `color` could be parsed, or `null` otherwise.
 */
function getAccentThemes() {
  return getAllThemes().map(toThemeWithRgb);
}

/**
 * Provide the list of available background themes with RGB color strings.
 *
 * Each theme object includes `id`, `name`, `color`, and `description`. When the theme's hex color is valid,
 * an `rgb` string in the form "r, g, b" is included.
 * @returns {Array<Object>} An array of theme objects with optional `rgb` string.
 */
function getBackgroundThemes() {
  return getAccentThemes();
}

/**
 * Resolve an accent theme key to a valid theme id.
 *
 * @param {string} accentKey - Requested accent key; may be undefined or invalid.
 * @returns {string} The resolved accent theme id: `accentKey` if it exists in the map; if `accentKey` is `'sky'` and `'original'` exists, returns `'original'`; otherwise returns `'original'` if available, or the first defined theme id, or `'original'` as a final fallback.
 */
function resolveAccentThemeId(accentKey) {
  const themeMap = getThemeMap();
  const allThemes = getAllThemes();
  if (accentKey && themeMap[accentKey]) return accentKey;
  if (accentKey === 'sky' && themeMap.original) return 'original';
  return themeMap.original ? 'original' : allThemes[0]?.id || 'original';
}

/**
 * Resolve a valid background theme id from a provided key.
 *
 * @param {string} backgroundKey - Candidate background key (may be undefined or invalid).
 * @returns {string} The resolved theme id: the provided key if it exists in ACCENT_THEME_MAP; if the key is `'sky'` and `'original'` exists, `'original'` is returned; otherwise `'original'` if available, or the first accent theme id, or `'original'` as a final fallback.
 */
function resolveBackgroundThemeId(backgroundKey) {
  const themeMap = getThemeMap();
  const allThemes = getAllThemes();
  if (backgroundKey && themeMap[backgroundKey]) return backgroundKey;
  if (backgroundKey === 'sky' && themeMap.original) return 'original';
  return themeMap.original ? 'original' : allThemes[0]?.id || 'original';
}

function applyAccentColor(color, accentId = 'custom-preview') {
  const normalizedColor = normalizeHexColor(color);
  const rgb = hexToRgb(normalizedColor);
  if (!normalizedColor || !rgb) return false;

  const root = document.documentElement;
  if (!root) return false;

  const isLightTheme = document.body?.classList.contains('theme-light');
  const hoverMix = isLightTheme ? 0.18 : 0.22;
  const hoverRgb = mixRgb(
    rgb,
    isLightTheme ? { r: 0, g: 0, b: 0 } : { r: 255, g: 255, b: 255 },
    hoverMix
  );
  const accentBgAlpha = isLightTheme ? 0.12 : 0.18;
  const glowAlpha = isLightTheme ? 0.22 : 0.35;
  const focusAlpha = isLightTheme ? 0.18 : 0.25;

  root.style.setProperty('--accent', normalizedColor);
  root.style.setProperty('--accent-rgb', `${rgb.r}, ${rgb.g}, ${rgb.b}`);
  root.style.setProperty('--accent-hover', `rgb(${hoverRgb.r}, ${hoverRgb.g}, ${hoverRgb.b})`);
  root.style.setProperty('--primary', normalizedColor);
  root.style.setProperty('--primary-hover', `rgb(${hoverRgb.r}, ${hoverRgb.g}, ${hoverRgb.b})`);
  root.style.setProperty('--accent-bg', `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, ${accentBgAlpha})`);
  root.style.setProperty('--border-focus', `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, 0.5)`);
  root.style.setProperty(
    '--glow-accent',
    `0 0 20px rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, ${glowAlpha})`
  );
  root.style.setProperty(
    '--glow-focus',
    `0 0 0 3px rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, ${focusAlpha})`
  );

  if (document.body) {
    document.body.dataset.accent = accentId;
  }

  return true;
}

/**
 * Apply the chosen accent theme to the document by updating CSS custom properties and the body's data-accent attribute.
 *
 * Sets a set of CSS variables (accent color, RGB components, hover/primary variants, accent background, focus/border and glow styles) derived from the resolved theme and the current light/dark mode. If the accent key cannot be resolved or required DOM elements are unavailable, the function performs no action.
 * @param {string} accentKey - Accent theme identifier or alias to apply.
 */
function applyAccentTheme(accentKey) {
  try {
    const resolvedKey = resolveAccentThemeId(accentKey);
    const theme = getThemeMap()[resolvedKey];
    if (!theme) return;
    applyAccentColor(theme.color, resolvedKey);
  } catch (error) {
    console.error('Error applying accent theme:', error);
  }
}

/**
 * Apply an unsaved accent preview color from hex input.
 * @param {string} hex - Hex color string.
 * @returns {boolean} True when preview was applied.
 */
function applyAccentThemeFromColor(hex) {
  try {
    return applyAccentColor(hex, 'custom-preview');
  } catch (error) {
    console.error('Error applying accent preview color:', error);
    return false;
  }
}

function applyBackgroundColor(
  color,
  backgroundId = 'custom-preview',
  { disableTint = false } = {}
) {
  const normalizedColor = normalizeHexColor(color);
  const rgb = hexToRgb(normalizedColor);
  if (!normalizedColor || !rgb) return false;

  const root = document.documentElement;
  const body = document.body;
  if (!root || !body) return false;

  const isLightTheme = body.classList.contains('theme-light');
  const base = isLightTheme ? BACKGROUND_BASES.light : BACKGROUND_BASES.dark;
  const tintAmount = disableTint ? 0 : isLightTheme ? 0.08 : 0.12;
  const tint = (baseRgb) => mixRgb(baseRgb, rgb, tintAmount);
  const setRgbaVar = (name, baseEntry) => {
    const tinted = tint(baseEntry);
    root.style.setProperty(name, `rgba(${tinted.r}, ${tinted.g}, ${tinted.b}, ${baseEntry.a})`);
    return tinted;
  };

  const bgColor = setRgbaVar('--bg-color', base.bgColor);
  root.style.setProperty('--window-bg-rgb', `${bgColor.r}, ${bgColor.g}, ${bgColor.b}`);
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

  body.dataset.background = backgroundId;

  return true;
}

/**
 * Apply a named background theme by updating CSS custom properties and the document body dataset.
 *
 * Resolves the provided background key to a concrete theme, computes tinted RGBA values appropriate
 * for the current light/dark mode, sets a collection of `--bg-*`, `--surface-*`, `--glass-*` CSS
 * variables on `:root` and corresponding RGB variables on `document.body`, and stores the resolved
 * theme id in `body.dataset.background`. If the key cannot be resolved or required DOM elements are
 * unavailable, the function performs no changes.
 *
 * @param {string} backgroundKey - Theme identifier or alias to apply; if omitted or unresolvable, no changes are made.
 */
function applyBackgroundTheme(backgroundKey) {
  try {
    const resolvedKey = resolveBackgroundThemeId(backgroundKey);
    const theme = getThemeMap()[resolvedKey];
    if (!theme) return;
    applyBackgroundColor(theme.color, resolvedKey, { disableTint: resolvedKey === 'original' });
  } catch (error) {
    console.error('Error applying background theme:', error);
  }
}

/**
 * Apply an unsaved background preview color from hex input.
 * @param {string} hex - Hex color string.
 * @returns {boolean} True when preview was applied.
 */
function applyBackgroundThemeFromColor(hex) {
  try {
    return applyBackgroundColor(hex, 'custom-preview');
  } catch (error) {
    console.error('Error applying background preview color:', error);
    return false;
  }
}

/**
 * Get the application's runtime platform identifier and cache it for subsequent calls.
 * @returns {string|null} The platform identifier (e.g. 'win32', 'darwin') if available, `null` otherwise.
 */
function getPlatform() {
  return window?.electronAPI?.platform || null;
}

function isLightThemeActive() {
  return document.body?.classList.contains('theme-light');
}

/**
 * Report whether the host asked for reduced motion.
 *
 * Exit animations are skipped entirely when this is true so dialogs and toasts disappear at once
 * instead of easing out.
 * @returns {boolean} True when `prefers-reduced-motion: reduce` matches.
 */
function prefersReducedMotion() {
  try {
    return !!window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches;
  } catch {
    return false;
  }
}

/**
 * Detect the Jest environment, where CSS animations never run and close paths must settle
 * synchronously for assertions made straight after a click.
 * @returns {boolean} True when running under `NODE_ENV=test`.
 */
function isTestEnvironment() {
  return typeof process !== 'undefined' && !!process.env && process.env.NODE_ENV === 'test';
}

// Set by the test hook below so the animated close/open branch — the one that never runs under
// `NODE_ENV=test` — can still be exercised by unit tests.
let forceAnimatedModalTransitions = false;

/**
 * Test hook: force the animated exit paths (modals and toasts) even under `NODE_ENV=test`.
 *
 * Without this the `isTestEnvironment()` short-circuit settles every close synchronously, leaving
 * the `.modal-closing` animation, its fallback timer and the overlapping-call handling untested.
 * @param {boolean} [enabled=true] - True to animate, false to restore the synchronous test path.
 * @returns {void}
 */
function __forceAnimatedModalTransitions(enabled = true) {
  forceAnimatedModalTransitions = !!enabled;
}

/**
 * Decide whether animations should be skipped and the transition settled synchronously.
 * @returns {boolean} True when the caller should short-circuit straight to the end state.
 */
function shouldSkipExitAnimation() {
  if (forceAnimatedModalTransitions) return false;
  return isTestEnvironment() || prefersReducedMotion();
}

/**
 * Run the shared exit animation for a modal and then hide or remove it.
 *
 * Every modal animates open through `modalSlideIn`; without this helper the close paths flip
 * `.hidden` (a `display: none !important` rule) and the dialog snaps shut. The `.modal-closing`
 * class drives the paired fade/slide-out, and the modal is only hidden once that animation ends
 * (or the fallback timer fires). Reduced-motion hosts and tests skip the animation entirely.
 *
 * Only one close can be in flight per element: a second call supersedes the first, taking over its
 * timer, listener and awaiting callers so the earlier request can never complete this one early
 * (which would drop this call's `onClosed`) and no `await` is left hanging.
 *
 * @param {HTMLElement} modal - The modal overlay element (the `.modal` container, not its content).
 * @param {Object} [options] - Close behaviour.
 * @param {boolean} [options.remove=false] - Remove the modal from the DOM instead of hiding it with `.hidden`.
 * @param {boolean} [options.releaseFocus=false] - Release the modal's focus trap once it is hidden.
 * @param {Function} [options.onClosed] - Callback invoked after the modal is hidden or removed.
 * @returns {Promise<void>} Resolves once the modal has been hidden or removed.
 */
function closeModal(modal, { remove = false, releaseFocus = false, onClosed = null } = {}) {
  return new Promise((resolve) => {
    if (!modal || typeof modal.classList?.add !== 'function') {
      resolve();
      return;
    }

    const content = modal.querySelector?.('.modal-content') || null;
    // Callers awaiting this close, plus any inherited from a close this one supersedes.
    const waiters = [resolve];
    let settled = false;
    let animating = false;
    let fallbackTimer = null;

    const handleAnimationEnd = (event) => {
      if (event.target !== modal && event.target !== content) return;
      finish();
    };

    function detach() {
      if (fallbackTimer) {
        clearTimeout(fallbackTimer);
        fallbackTimer = null;
      }
      modal.removeEventListener?.('animationend', handleAnimationEnd);
      if (pendingModalCloses.get(modal) === pendingClose) pendingModalCloses.delete(modal);
    }

    function settleWaiters() {
      waiters.splice(0, waiters.length).forEach((notify) => notify());
    }

    // Stop this close without completing it, handing its awaiting callers to whoever took over.
    const pendingClose = {
      supersede() {
        if (settled) return [];
        settled = true;
        detach();
        return waiters.splice(0, waiters.length);
      },
    };

    function finish() {
      if (settled) return;
      settled = true;
      detach();
      // `openModal` disarms this close outright, but anything that reveals the dialog by clearing
      // `.modal-closing` directly still has to be honoured: without this check the pending close
      // would hide the dialog the user just asked for.
      if (animating && !modal.classList.contains('modal-closing')) {
        settleWaiters();
        return;
      }
      try {
        modal.classList.remove('modal-closing');
        if (remove) {
          modal.remove();
        } else {
          modal.classList.add('hidden');
          // Only modals opened by writing an inline display get one written back, so class-only
          // visibility toggles are not silently pinned shut by a stale inline style.
          if (modal.style?.display) modal.style.display = 'none';
        }
        if (releaseFocus) releaseFocusTrap(modal);
        onClosed?.();
      } catch (error) {
        console.error('Error closing modal:', error);
      }
      settleWaiters();
    }

    const superseded = pendingModalCloses.get(modal);
    if (superseded) waiters.push(...superseded.supersede());

    if (shouldSkipExitAnimation()) {
      finish();
      return;
    }

    animating = true;
    pendingModalCloses.set(modal, pendingClose);
    modal.addEventListener?.('animationend', handleAnimationEnd);
    modal.classList.add('modal-closing');
    fallbackTimer = setTimeout(finish, MODAL_EXIT_FALLBACK_MS);
  });
}

/**
 * Reveal a modal, cancelling any exit animation still in flight.
 *
 * Pairs with {@link closeModal}: a pending close is disarmed outright (its fallback timer would
 * otherwise outlive the re-open and could complete a *later* close ahead of time), and clearing
 * `.modal-closing` restores the entry animation.
 *
 * @param {HTMLElement} modal - The modal overlay element.
 * @param {Object} [options] - Open behaviour.
 * @param {string|null} [options.display='flex'] - Inline display to write, or null to leave visibility to CSS.
 */
function openModal(modal, { display = 'flex' } = {}) {
  if (!modal || typeof modal.classList?.remove !== 'function') return;
  const pendingClose = pendingModalCloses.get(modal);
  // No close is coming, so the abandoned callers settle here rather than waiting forever.
  if (pendingClose) pendingClose.supersede().forEach((notify) => notify());
  modal.classList.remove('modal-closing');
  modal.classList.remove('hidden');
  if (display) {
    modal.style.display = display;
  } else {
    modal.style?.removeProperty?.('display');
  }
}

/**
 * Play the toast exit animation and then detach the toast.
 *
 * Safe to call repeatedly: the first call marks the toast as dismissing so the auto-dismiss timer
 * and a user click cannot double-remove it.
 * @param {HTMLElement} toast - The toast element to dismiss.
 */
function dismissToast(toast) {
  if (!toast || toast.dataset?.dismissing === 'true') return;
  if (toast.dataset) toast.dataset.dismissing = 'true';

  let settled = false;
  let fallbackTimer = null;

  const handleAnimationEnd = (event) => {
    if (event.target !== toast) return;
    finish();
  };

  function finish() {
    if (settled) return;
    settled = true;
    if (fallbackTimer) clearTimeout(fallbackTimer);
    toast.removeEventListener?.('animationend', handleAnimationEnd);
    toast.remove();
  }

  if (shouldSkipExitAnimation()) {
    finish();
    return;
  }

  toast.addEventListener?.('animationend', handleAnimationEnd);
  toast.classList.add('toast-closing');
  fallbackTimer = setTimeout(finish, TOAST_EXIT_FALLBACK_MS);
}

/**
 * Display a transient toast notification in the element with id "toast-container".
 *
 * The toast leads with a status icon matching its type, is dismissible by clicking it, and exits
 * through the shared `.toast-closing` animation.
 *
 * @param {string} message - Text to show inside the toast.
 * @param {string} [type='success'] - Visual variant/class to apply ('success', 'error', 'warning' or 'info').
 * @param {number} [timeout=2000] - Time in milliseconds before the toast begins animating out.
 * @returns {HTMLElement|undefined} The toast element, or undefined when it could not be shown.
 */
function showToast(message, type = 'success', timeout = 2000) {
  try {
    const container = document.getElementById('toast-container');
    if (!container) return undefined;
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;

    const icon = document.createElement('span');
    icon.className = 'toast-icon';
    icon.setAttribute('aria-hidden', 'true');
    setIconContent(icon, TOAST_ICON_NAMES[type] || TOAST_ICON_NAMES.info, { size: 16 });
    toast.appendChild(icon);

    const text = document.createElement('span');
    text.className = 'toast-message';
    text.textContent = message;
    toast.appendChild(text);

    // A toast that outlasts its usefulness should be dismissible rather than merely waited out.
    toast.addEventListener('click', () => dismissToast(toast));

    container.appendChild(toast);
    setTimeout(() => dismissToast(toast), timeout);
    return toast;
  } catch (error) {
    console.error('Error showing toast:', error);
    return undefined;
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
      const prefersDark =
        window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
      body.classList.add(prefersDark ? 'theme-dark' : 'theme-light');
    }
  } catch (error) {
    console.error('Error applying theme:', error);
  }
}

/**
 * Apply user interface preference flags as CSS classes on the document body.
 *
 * Sets or removes classes to reflect high-contrast mode, opaque panel rendering,
 * and compact density so CSS can adapt the UI accordingly.
 *
 * @param {Object} ui - UI preferences.
 * @param {boolean} [ui.highContrast] - Enable high-contrast styles when true.
 * @param {boolean} [ui.opaquePanels] - Render panels as opaque when true.
 * @param {string} [ui.density] - Layout density; use 'compact' to enable compact spacing.
 */
function applyUiPreferences(ui = {}) {
  try {
    const body = document.body;
    body.classList.toggle('high-contrast', !!ui.highContrast);
    body.classList.toggle('opaque-panels', !!ui.opaquePanels);
    body.classList.toggle('density-compact', (ui.density || 'comfortable') === 'compact');
    // Opt-out rather than opt-in: the glow is how a tile shows it is on.
    body.classList.toggle('active-tile-glow', ui.activeTileGlow !== false);
  } catch (error) {
    console.error('Error applying UI preferences:', error);
  }
}

/**
 * Configure and apply frosted-glass (glassmorphism) window visual effects by setting CSS custom properties and body classes.
 *
 * When `config.frostedGlass` is true, this function sets CSS variables that control blur and multiple layer opacities and then adds the `frosted-glass` class (and `native-glass` on supported platforms). When false, it removes those classes and clears the related CSS custom properties.
 *
 * @param {Object} [config={}] - Configuration options.
 * @param {boolean} [config.frostedGlass=false] - Enable or disable the frosted glass effect.
 */
function applyWindowEffects(config = {}) {
  try {
    const body = document.body;
    const enabled = !!config.frostedGlass;
    const platform = getPlatform();
    // Disable CSS backdrop filters for low-cost/no-glass rendering while keeping
    // opacity on CSS background surfaces (Linux default, Windows without frosted glass).
    const linuxPerformanceMode = platform === 'linux' || (platform === 'win32' && !enabled);
    const opacity = Math.max(0.5, Math.min(1, Number(config.opacity) || 1));
    const backgroundAlpha = mapWindowOpacityToBackgroundAlpha(opacity);

    body.classList.toggle('linux-performance-mode', linuxPerformanceMode);
    body.style.setProperty('--window-opacity', opacity.toFixed(3));
    body.style.setProperty('--window-bg-alpha', backgroundAlpha.toFixed(3));
    body.style.setProperty('--desktop-pin-window-opacity', backgroundAlpha.toFixed(3));

    if (!enabled) {
      // Remove frosted glass class first
      body.classList.remove('frosted-glass');
      body.classList.remove('native-glass');
      body.classList.remove('software-glass');

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
      body.style.removeProperty('--software-acrylic-bg-alpha');
      body.style.removeProperty('--software-acrylic-highlight-alpha');
      body.style.removeProperty('--software-acrylic-noise-alpha');
      body.style.removeProperty('--software-acrylic-shadow-alpha');
      return;
    }

    const strength = DEFAULT_FROSTED_STRENGTH;
    const tint = DEFAULT_FROSTED_TINT / 100;
    const nativeGlass = platform === 'win32' || platform === 'darwin';
    const lightTheme = isLightThemeActive();

    // Linear interpolation helper
    const lerp = (min, max, value) => min + (max - min) * value;

    // Calculate blur amount based on strength (0px to 42px range)
    const blur = lerp(0, 42, strength / 100);

    // Calculate alpha values based on tint
    // Lower tint = more transparent, higher tint = more opaque
    const softwareGlassScale = 0.32 + backgroundAlpha * 0.68;
    const glassScale = nativeGlass ? backgroundAlpha : softwareGlassScale;
    const softwareFloorBias = lightTheme ? 1.15 : 1;
    const scaleAlpha = (value, softwareFloor = 0) => {
      const scaled = value * glassScale;
      return nativeGlass ? scaled : Math.max(softwareFloor * softwareFloorBias, scaled);
    };
    const bgAlpha = scaleAlpha(lerp(0.25, 0.75, tint), 0.18);
    const elevatedAlpha = scaleAlpha(lerp(0.3, 0.8, tint), 0.22);
    const surfaceAlpha = scaleAlpha(lerp(0.25, 0.75, tint), 0.2);
    const surfaceHoverAlpha = scaleAlpha(lerp(0.35, 0.85, tint), 0.28);
    const cardAlpha = scaleAlpha(lerp(0.2, 0.65, tint), 0.16);
    const glassAlpha = scaleAlpha(lerp(0.2, 0.6, tint), 0.16);
    const glassElevatedAlpha = scaleAlpha(lerp(0.25, 0.7, tint), 0.22);
    const glassOverlayAlpha = scaleAlpha(lerp(0.3, 0.85, tint), 0.22);
    const softwareBodyAlpha = lightTheme
      ? Math.max(0.22, Math.min(0.78, 0.18 + backgroundAlpha * 0.6))
      : Math.max(0.16, Math.min(0.76, 0.14 + backgroundAlpha * 0.62));
    const softwareEffectScale = 0.45 + backgroundAlpha * 0.55;
    const softwareHighlightAlpha = (lightTheme ? 0.16 : 0.08) * softwareEffectScale;
    const softwareNoiseAlpha = (lightTheme ? 0.08 : 0.055) * softwareEffectScale;
    const softwareShadowAlpha = (lightTheme ? 0.035 : 0.08) * softwareEffectScale;

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
    body.style.setProperty('--software-acrylic-bg-alpha', softwareBodyAlpha.toFixed(3));
    body.style.setProperty('--software-acrylic-highlight-alpha', softwareHighlightAlpha.toFixed(3));
    body.style.setProperty('--software-acrylic-noise-alpha', softwareNoiseAlpha.toFixed(3));
    body.style.setProperty('--software-acrylic-shadow-alpha', softwareShadowAlpha.toFixed(3));

    // Now add the frosted-glass class
    body.classList.add('frosted-glass');
    body.classList.toggle('native-glass', nativeGlass);
    body.classList.toggle('software-glass', !nativeGlass);
  } catch (error) {
    console.error('Error applying window effects:', error);
  }
}

/**
 * Activate a focus trap inside a modal element so keyboard Tab navigation cycles within it.
 *
 * Attaches a keydown handler to the provided modal that confines Tab (and Shift+Tab) focus movement to the modal's focusable descendants, sets focus to the first focusable element, and records the previously focused element for later restoration. The handler is stored in the module-level `focusTrapHandlers` WeakMap keyed by the modal.
 * @param {HTMLElement} modal - The modal container element within which focus should be trapped.
 */
function trapFocus(modal) {
  try {
    const existingHandler = focusTrapHandlers.get(modal);
    if (existingHandler) {
      modal.removeEventListener('keydown', existingHandler);
    }
    focusTrapPreviousFocus.set(modal, document.activeElement);
    const focusable = modal.querySelectorAll(
      'a[href], button, textarea, input, select, [tabindex]:not([tabindex="-1"])'
    );
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    const handler = (e) => {
      if (e.key !== 'Tab') return;
      if (focusable.length === 0) return;
      if (e.shiftKey) {
        if (document.activeElement === first) {
          e.preventDefault();
          last.focus();
        }
      } else {
        if (document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    modal.addEventListener('keydown', handler);
    focusTrapHandlers.set(modal, handler);
    activeFocusTrapModals.delete(modal);
    activeFocusTrapModals.add(modal);
    setTimeout(() => first?.focus(), 0);
  } catch (error) {
    console.error('Error trapping focus:', error);
  }
}

/**
 * Decide whether a modal being released still owns the focus it is about to hand back.
 *
 * {@link closeModal} defers the release until the exit animation ends, so a handler that closes one
 * dialog in order to open another (entity picker -> alert config) will already have focused the new
 * dialog's first field by the time the release runs. Restoring the old focus there would drop the
 * caret behind an open `aria-modal` dialog, so only restore when nothing else has claimed focus:
 * either it sits on `document.body` (the browser's landing spot once a focused element is hidden or
 * detached) or it is still inside the modal being released.
 *
 * @param {HTMLElement} modal - The modal whose focus trap is being released.
 * @returns {boolean} True when the previously focused element should be refocused.
 */
function canRestorePreviousFocus(modal) {
  try {
    const active = document.activeElement;
    if (!active || active === document.body) return true;
    return !!modal?.contains?.(active);
  } catch {
    return true;
  }
}

function releaseFocusTrap(modal) {
  try {
    let targetModal = modal;
    if (!targetModal) {
      const activeModals = Array.from(activeFocusTrapModals);
      for (let index = activeModals.length - 1; index >= 0; index -= 1) {
        const candidate = activeModals[index];
        if (!candidate?.isConnected) {
          activeFocusTrapModals.delete(candidate);
          continue;
        }
        targetModal = candidate;
        break;
      }
    }
    if (!targetModal) return;

    const handler = focusTrapHandlers.get(targetModal);
    if (handler) targetModal.removeEventListener('keydown', handler);
    focusTrapHandlers.delete(targetModal);
    activeFocusTrapModals.delete(targetModal);

    const previousFocus = focusTrapPreviousFocus.get(targetModal);
    focusTrapPreviousFocus.delete(targetModal);
    if (previousFocus?.isConnected && previousFocus.focus) {
      setTimeout(() => {
        if (!previousFocus.isConnected) return;
        if (!canRestorePreviousFocus(targetModal)) return;
        previousFocus.focus();
      }, 0);
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

function ensureConnectionStatusTooltip() {
  if (connectionStatusTooltip && document.body?.contains(connectionStatusTooltip)) {
    return connectionStatusTooltip;
  }

  if (connectionStatusTooltip && !document.body?.contains(connectionStatusTooltip)) {
    connectionStatusTooltip = null;
    connectionStatusTooltipTarget = null;
    connectionStatusTooltipPinned = false;
  }

  const tooltip = document.createElement('div');
  tooltip.id = 'connection-status-tooltip';
  tooltip.className = 'connection-status-tooltip';
  tooltip.setAttribute('role', 'tooltip');
  tooltip.setAttribute('aria-hidden', 'true');
  tooltip.innerHTML = `
    <span class="connection-status-tooltip-title"></span>
    <span class="connection-status-tooltip-detail"></span>
  `;
  document.body.appendChild(tooltip);
  connectionStatusTooltip = tooltip;
  return tooltip;
}

function getConnectionStatusSummary(connected) {
  return connected ? t('Connected to Home Assistant') : t('Disconnected from Home Assistant');
}

function getConnectionStatusDetail(statusElement) {
  const explicitDetail = statusElement?.dataset?.statusDetail?.trim();
  if (explicitDetail) return explicitDetail;
  const summary = statusElement?.dataset?.statusSummary || '';
  if (summary === t('Connected to Home Assistant')) return t('Real-time updates active.');
  return t('Disconnected from Home Assistant. Retrying automatically.');
}

function positionConnectionStatusTooltip(target) {
  if (!connectionStatusTooltip || !target) return;
  const rect = target.getBoundingClientRect();
  const tooltipRect = connectionStatusTooltip.getBoundingClientRect();
  const padding = 12;
  const preferredTop = rect.top - tooltipRect.height - 10;
  const placeBelow = preferredTop < padding;
  const top = placeBelow ? rect.bottom + 10 : preferredTop;
  let left = rect.left + rect.width / 2 - tooltipRect.width / 2;
  left = Math.max(padding, Math.min(left, window.innerWidth - tooltipRect.width - padding));
  connectionStatusTooltip.style.top = `${top}px`;
  connectionStatusTooltip.style.left = `${left}px`;
  connectionStatusTooltip.dataset.placement = placeBelow ? 'bottom' : 'top';
}

function showConnectionStatusTooltip(target, { pinned = false } = {}) {
  if (!target) return;
  const tooltip = ensureConnectionStatusTooltip();
  const titleEl = tooltip.querySelector('.connection-status-tooltip-title');
  const detailEl = tooltip.querySelector('.connection-status-tooltip-detail');
  const summary =
    target.dataset.statusSummary || target.title || t('Disconnected from Home Assistant');
  const detail = getConnectionStatusDetail(target);
  if (titleEl) titleEl.textContent = summary;
  if (detailEl) detailEl.textContent = detail;
  connectionStatusTooltipTarget = target;
  if (pinned) connectionStatusTooltipPinned = true;
  target.setAttribute('aria-describedby', tooltip.id);
  target.setAttribute('aria-expanded', 'true');
  tooltip.classList.add('visible');
  tooltip.setAttribute('aria-hidden', 'false');
  positionConnectionStatusTooltip(target);
}

function hideConnectionStatusTooltip({ force = false } = {}) {
  if (!connectionStatusTooltip) return;
  if (connectionStatusTooltipPinned && !force) return;
  if (connectionStatusTooltipTarget) {
    connectionStatusTooltipTarget.removeAttribute('aria-describedby');
    connectionStatusTooltipTarget.setAttribute('aria-expanded', 'false');
  }
  connectionStatusTooltipTarget = null;
  connectionStatusTooltipPinned = false;
  connectionStatusTooltip.classList.remove('visible');
  connectionStatusTooltip.setAttribute('aria-hidden', 'true');
}

function bindConnectionStatusHandlers(status) {
  if (!status) return;
  if (connectionStatusBoundElement === status) return;

  if (connectionStatusBoundElement && connectionStatusTooltipHandlers) {
    connectionStatusBoundElement.removeEventListener(
      'mouseenter',
      connectionStatusTooltipHandlers.onMouseEnter
    );
    connectionStatusBoundElement.removeEventListener(
      'mouseleave',
      connectionStatusTooltipHandlers.onMouseLeave
    );
    connectionStatusBoundElement.removeEventListener(
      'focus',
      connectionStatusTooltipHandlers.onFocus
    );
    connectionStatusBoundElement.removeEventListener(
      'blur',
      connectionStatusTooltipHandlers.onBlur
    );
    connectionStatusBoundElement.removeEventListener(
      'click',
      connectionStatusTooltipHandlers.onClick
    );
    connectionStatusBoundElement.removeEventListener(
      'keydown',
      connectionStatusTooltipHandlers.onKeyDown
    );
  }

  const onMouseEnter = () => showConnectionStatusTooltip(status);
  const onMouseLeave = () => hideConnectionStatusTooltip();
  const onFocus = () => showConnectionStatusTooltip(status);
  const onBlur = () => hideConnectionStatusTooltip();
  const onClick = (event) => {
    event.preventDefault();
    event.stopPropagation();
    if (connectionStatusTooltipTarget === status && connectionStatusTooltipPinned) {
      hideConnectionStatusTooltip({ force: true });
      return;
    }
    showConnectionStatusTooltip(status, { pinned: true });
  };
  const onKeyDown = (event) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      if (connectionStatusTooltipTarget === status && connectionStatusTooltipPinned) {
        hideConnectionStatusTooltip({ force: true });
      } else {
        showConnectionStatusTooltip(status, { pinned: true });
      }
    } else if (event.key === 'Escape') {
      hideConnectionStatusTooltip({ force: true });
    }
  };

  connectionStatusTooltipHandlers = {
    onMouseEnter,
    onMouseLeave,
    onFocus,
    onBlur,
    onClick,
    onKeyDown,
  };
  connectionStatusBoundElement = status;

  status.addEventListener('mouseenter', onMouseEnter);
  status.addEventListener('mouseleave', onMouseLeave);
  status.addEventListener('focus', onFocus);
  status.addEventListener('blur', onBlur);
  status.addEventListener('click', onClick);
  status.addEventListener('keydown', onKeyDown);

  if (!connectionStatusDocumentHandlersBound) {
    document.addEventListener('click', (event) => {
      if (!connectionStatusTooltip || !connectionStatusTooltip.classList.contains('visible'))
        return;
      const clickedInsideStatus =
        connectionStatusBoundElement && connectionStatusBoundElement.contains(event.target);
      const clickedInsideTooltip = connectionStatusTooltip.contains(event.target);
      if (clickedInsideStatus || clickedInsideTooltip) return;
      hideConnectionStatusTooltip({ force: true });
    });
    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') {
        hideConnectionStatusTooltip({ force: true });
      }
    });
    window.addEventListener('resize', () => {
      if (!connectionStatusTooltipTarget) return;
      positionConnectionStatusTooltip(connectionStatusTooltipTarget);
    });
    connectionStatusDocumentHandlersBound = true;
  }
}

function initializeConnectionStatusTooltip() {
  try {
    const status = document.getElementById('connection-status');
    if (!status) return;
    ensureConnectionStatusTooltip();
    status.setAttribute('tabindex', '0');
    status.setAttribute('role', 'button');
    status.setAttribute('aria-haspopup', 'true');
    if (!status.hasAttribute('aria-expanded')) {
      status.setAttribute('aria-expanded', 'false');
    }
    bindConnectionStatusHandlers(status);
  } catch (error) {
    console.error('Error initializing connection status tooltip:', error);
  }
}

function setStatus(connected, detailMessage = '') {
  try {
    const status = document.getElementById('connection-status');
    if (status) {
      status.className = connected ? 'connection-indicator connected' : 'connection-indicator';
      status.innerHTML = '';
      const summary = getConnectionStatusSummary(connected);
      const normalizedDetail = typeof detailMessage === 'string' ? detailMessage.trim() : '';
      status.dataset.statusSummary = summary;
      status.dataset.statusDetail = normalizedDetail;

      if (normalizedDetail) {
        status.title = `${summary}: ${normalizedDetail}`;
        status.setAttribute('aria-label', `${summary}. ${normalizedDetail}`);
      } else {
        status.title = summary;
        status.setAttribute('aria-label', summary);
      }

      if (
        connectionStatusTooltipTarget === status &&
        connectionStatusTooltip?.classList?.contains('visible')
      ) {
        showConnectionStatusTooltip(status, { pinned: connectionStatusTooltipPinned });
      }
    }
  } catch (error) {
    console.error('Error setting status:', error);
  }
}

// Hotkeys are desktop-only; browser hosts (the HA panel preview) have no
// electronAPI, so this module-load hook must stay optional.
window.electronAPI?.onHotkeyRegistrationFailed?.(({ hotkey }) => {
  showToast(
    t('Hotkey "{{hotkey}}" is already in use by another application.', { hotkey }),
    'error',
    5000
  );
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
      titleEl.textContent = title || t('Confirm Action');
      messageEl.textContent = message || t('Are you sure?');
      okBtn.textContent = options.confirmText || t('Confirm');
      cancelBtn.textContent = options.cancelText || t('Cancel');

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
        okBtn.removeEventListener('click', handleConfirm);
        cancelBtn.removeEventListener('click', handleCancel);
        modal.removeEventListener('click', handleBackdropClick);
        document.removeEventListener('keydown', handleKeydown);

        void closeModal(modal, { releaseFocus: true });
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
      openModal(modal);
      trapFocus(modal);
    } catch (error) {
      console.error('Error showing confirm dialog:', error);
      resolve(false);
    }
  });
}

export {
  showToast,
  dismissToast,
  closeModal,
  openModal,
  applyTheme,
  setCustomThemes,
  applyAccentTheme,
  applyAccentThemeFromColor,
  applyBackgroundTheme,
  applyBackgroundThemeFromColor,
  getAccentThemes,
  getBackgroundThemes,
  applyUiPreferences,
  applyWindowEffects,
  trapFocus,
  releaseFocusTrap,
  showLoading,
  initializeConnectionStatusTooltip,
  setStatus,
  showConfirm,
  hexToRgb,
  miredsToKelvin,
  hasSupportedFeature,
  __forceAnimatedModalTransitions,
};

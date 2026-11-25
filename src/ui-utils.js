/**
 * The window's own look and chrome: the theme (light or dark, accent and background colours, the
 * holiday colours, frosted glass, interface preferences), the connection dot and its tooltip, and
 * the loading overlay. The colour maths behind the theme is in color-math.js; dialogs and toasts
 * are in dialogs.js.
 */
import { t } from './i18n.js';
import { stripSummaryPrefix } from './connection-status.js';
import windowGlass from './window-glass.cjs';
import {
  getAccentHoverColor,
  getAccentTextOnDark,
  getAccentTextOnLight,
  getAccentTone,
  getReadableTextColor,
  hexToRgb,
  mixRgb,
  normalizeHexColor,
} from './color-math.js';
import { showToast } from './dialogs.js';

const DEFAULT_FROSTED_STRENGTH = 60;
const DEFAULT_FROSTED_TINT = 60;
const MIN_BACKGROUND_OPACITY = 0.08;
// How much of a Background colour is mixed into the window's own: a hint, not a repaint.
const BACKGROUND_TINT = { dark: 0.12, light: 0.08 };
const BACKGROUND_OPACITY_CURVE = 1.35;
const CUSTOM_THEME_ID_PREFIX = 'custom-';
const ACCENT_THEMES = [
  { id: 'original', name: 'Original', color: '#64b5f6', description: 'The classic dark look' },
  // Nudged from #6366f1, whose white label was 4.47:1, just under the 4.5:1 AA floor.
  { id: 'indigo', name: 'Indigo', color: '#5f62ef', description: 'Focused and modern' },
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
// Holiday colours from the seasonal themes. They stand in for the saved accent and background
// without replacing them, so the user's own choice comes back when the holiday ends.
let seasonalColors = null;
// While Settings previews a colour the user just picked, holiday colours step aside so the pick
// shows. They stay recorded and come back when Settings resumes them.
let seasonalColorsSuspended = false;
// The theme keys last applied, so a change of holiday can repaint with them. Null when the colour
// came in raw (the Omarchy palette or a Settings draft), which seasonal colours leave alone.
let lastAccentKey = null;
let lastBackgroundKey = null;
// The raw colours behind those nulls, so a change of the theme class (the Readable preset paints
// dark over a light theme) can work their tints out again for the theme that is showing.
let lastAccentColor = null;
let lastBackgroundColor = null;
// Whether the chosen theme is the light one, or null before one was applied. Kept apart from the
// body class because the Readable preset paints its own dark palette over whichever it is.
let chosenThemeIsLight = null;
let uiPreferencesObserver = null;
let connectionStatusTooltip = null;
let connectionStatusTooltipTarget = null;
let connectionStatusTooltipPinned = false;
let connectionStatusTooltipHandlers = null;
let connectionStatusDocumentHandlersBound = false;
let connectionStatusBoundElement = null;
// Set when the window loses focus while the dot has it: Chromium focuses the dot again when the
// window comes back, and that focus is the window reopening, not the user asking about the link.
let connectionStatusFocusReturnsWithWindow = false;

const BACKGROUND_BASES = {
  // A cool slate rather than neutral grey, so the window reads as tinted glass. Kept in step with
  // the :root defaults in styles.css.
  dark: {
    bgColor: { r: 18, g: 22, b: 30, a: 0.8 },
    bgElevated: { r: 24, g: 28, b: 37, a: 0.9 },
    bgPrimary: { r: 13, g: 16, b: 22, a: 0.95 },
    surface1: { r: 20, g: 24, b: 32, a: 0.8 },
    surface2: { r: 28, g: 33, b: 42, a: 0.85 },
    surface3: { r: 36, g: 41, b: 51, a: 0.9 },
    surfaceHover: { r: 42, g: 47, b: 58, a: 0.95 },
    cardBg: { r: 24, g: 28, b: 37, a: 0.7 },
    glassSurface: { r: 24, g: 28, b: 37, a: 0.7 },
    glassElevated: { r: 30, g: 35, b: 45, a: 0.8 },
    glassOverlay: { r: 13, g: 16, b: 22, a: 0.85 },
    loadingOverlay: { r: 13, g: 16, b: 22, a: 0.7 },
  },
  light: {
    bgColor: { r: 250, g: 250, b: 250, a: 0.8 },
    bgElevated: { r: 255, g: 255, b: 255, a: 0.9 },
    bgPrimary: { r: 245, g: 245, b: 250, a: 0.95 },
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

function mapWindowOpacityToBackgroundAlpha(opacity) {
  const normalized = (opacity - 0.5) / 0.5;
  const curvedOpacity = Math.pow(Math.max(0, Math.min(1, normalized)), BACKGROUND_OPACITY_CURVE);
  return MIN_BACKGROUND_OPACITY + curvedOpacity * (1 - MIN_BACKGROUND_OPACITY);
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

    const hasName = typeof entry.name === 'string' && !!entry.name.trim();
    const name = hasName ? entry.name.trim() : `Custom ${color}`;
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
      hasDefaultName: !hasName,
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
  return getAllThemes().map((theme) => toThemeWithRgb(localizeTheme(theme)));
}

// Theme names and descriptions are stored in English and translated whenever the list is read,
// so a language change applies to them too. Names the user gave a custom color stay as typed.
function localizeTheme(theme) {
  if (!theme.isCustom) {
    return { ...theme, name: t(theme.name), description: t(theme.description) };
  }
  return {
    ...theme,
    name: theme.hasDefaultName ? t('Custom {{color}}', { color: theme.color }) : theme.name,
    description: t(theme.description),
  };
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
  const onAccent = getReadableTextColor(rgb);
  const hoverRgb = getAccentHoverColor(rgb, onAccent, isLightTheme);
  const accentBgAlpha = isLightTheme ? 0.12 : 0.18;
  const glowAlpha = isLightTheme ? 0.22 : 0.35;
  const focusAlpha = isLightTheme ? 0.18 : 0.25;

  root.style.setProperty('--accent', normalizedColor);
  root.style.setProperty('--accent-rgb', `${rgb.r}, ${rgb.g}, ${rgb.b}`);
  root.style.setProperty('--accent-hover', `rgb(${hoverRgb.r}, ${hoverRgb.g}, ${hoverRgb.b})`);
  root.style.setProperty('--on-accent', onAccent);
  // Both themes get a solved text colour; the stylesheet picks the one for the theme.
  root.style.setProperty('--accent-text-light', getAccentTextOnLight(rgb));
  root.style.setProperty('--accent-text-light-hover', getAccentTextOnLight(rgb, 6.5));
  root.style.setProperty('--accent-text-dark', getAccentTextOnDark(rgb));
  root.style.setProperty('--accent-text-dark-hover', getAccentTextOnDark(rgb, 6.5));
  // A focus ring is a graphic, so 3:1 is enough; most accents keep their own colour for it.
  root.style.setProperty('--accent-ring-dark', getAccentTextOnDark(rgb, 3.2));
  root.style.setProperty('--accent-bg', `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, ${accentBgAlpha})`);
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
    // A grey-ish accent (slate, a custom grey) has no hue to tell a lit tile's icon from an idle
    // one, so the stylesheet draws lit icons in the text colour for it.
    const tone = getAccentTone(rgb);
    if (tone === 'neutral') document.body.dataset.accentNeutral = 'true';
    else delete document.body.dataset.accentNeutral;
    // A tile lit in an orange, a red or a gold looks like one that needs attention, so the
    // stylesheet gives it a lighter wash with such an accent.
    if (tone === 'warm') document.body.dataset.accentWarm = 'true';
    else delete document.body.dataset.accentWarm;
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
    lastAccentKey = accentKey ?? '';
    if (seasonalColors && !seasonalColorsSuspended) {
      applyAccentColor(seasonalColors.accent, 'seasonal');
      return;
    }
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
    lastAccentKey = null;
    lastAccentColor = hex;
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
  const tintAmount = disableTint ? 0 : isLightTheme ? BACKGROUND_TINT.light : BACKGROUND_TINT.dark;
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
  setBodyRgb('--frosted-surface-rgb', surface1);
  setBodyRgb('--frosted-surface-hover-rgb', surfaceHover);
  setBodyRgb('--frosted-card-rgb', cardBg);
  setBodyRgb('--frosted-glass-rgb', glassSurface);
  setBodyRgb('--frosted-glass-elevated-rgb', glassElevated);
  setBodyRgb('--frosted-glass-overlay-rgb', glassOverlay);

  const loadingOverlay = tint(base.loadingOverlay);
  setBodyRgb('--loading-overlay-rgb', loadingOverlay);

  body.dataset.background = backgroundId;
  // The colour itself, for the Background chip in Settings to show next to the tinted window.
  if (disableTint) root.style.removeProperty('--background-pick');
  else root.style.setProperty('--background-pick', normalizedColor);

  return true;
}

/**
 * The window colour a Background choice gives in the theme that is showing: the theme's own base
 * with the colour mixed in as lightly as applyBackgroundColor mixes it. The colour picker draws
 * its swatches with this, so a swatch shows the window it makes and not the full-strength colour.
 * @param {string|null} color - The Background colour, or null for the untinted base.
 * @returns {string|null} '#rrggbb', or null for a colour that cannot be read.
 */
function getBackgroundWindowColor(color = null) {
  const isLightTheme = document.body?.classList.contains('theme-light');
  const { bgColor } = isLightTheme ? BACKGROUND_BASES.light : BACKGROUND_BASES.dark;
  const rgb = color === null ? null : hexToRgb(normalizeHexColor(color));
  if (color !== null && !rgb) return null;
  const tint = rgb ? (isLightTheme ? BACKGROUND_TINT.light : BACKGROUND_TINT.dark) : 0;
  const mixed = mixRgb(bgColor, rgb || bgColor, tint);
  return `#${[mixed.r, mixed.g, mixed.b].map((c) => c.toString(16).padStart(2, '0')).join('')}`;
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
    lastBackgroundKey = backgroundKey ?? '';
    if (seasonalColors && !seasonalColorsSuspended) {
      applyBackgroundColor(seasonalColors.background, 'seasonal');
      return;
    }
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
    lastBackgroundKey = null;
    lastBackgroundColor = hex;
    return applyBackgroundColor(hex, 'custom-preview');
  } catch (error) {
    console.error('Error applying background preview color:', error);
    return false;
  }
}

/**
 * Show holiday colours in place of the saved accent and background, or pass null to go back.
 * Repaints straight away unless the current colours came in raw; the Omarchy palette repaints
 * itself through desktop-appearance.js, and a Settings draft is left alone.
 * @param {{accent: string, background: string} | null} colors
 * @returns {boolean} True when the holiday colours changed.
 */
function setSeasonalColors(colors) {
  const next = colors?.accent && colors?.background ? { ...colors } : null;
  if (next?.accent === seasonalColors?.accent && next?.background === seasonalColors?.background) {
    return false;
  }
  seasonalColors = next;
  if (lastAccentKey !== null) applyAccentTheme(lastAccentKey);
  if (lastBackgroundKey !== null) applyBackgroundTheme(lastBackgroundKey);
  return true;
}

/**
 * Let Settings show a colour the user is picking even while a holiday's colours are on, or bring
 * the holiday colours back. Repaints either way.
 * @param {boolean} suspended
 */
function suspendSeasonalColors(suspended) {
  const next = !!suspended;
  if (next === seasonalColorsSuspended) return;
  seasonalColorsSuspended = next;
  if (!seasonalColors) return;
  if (lastAccentKey !== null) applyAccentTheme(lastAccentKey);
  if (lastBackgroundKey !== null) applyBackgroundTheme(lastBackgroundKey);
}

function getSeasonalColors() {
  return seasonalColors ? { ...seasonalColors } : null;
}

/**
 * Register one callback that runs after every applyUiPreferences call, with the same `ui`.
 * The seasonal themes use it so Settings previews and saves reach them without extra wiring.
 * @param {((ui: object) => void) | null} observer
 */
function setUiPreferencesObserver(observer) {
  uiPreferencesObserver = typeof observer === 'function' ? observer : null;
}

/**
 * Get the application's runtime platform identifier and cache it for subsequent calls.
 * @returns {string|null} The platform identifier (e.g. 'win32', 'darwin') if available, `null` otherwise.
 */
function getPlatform() {
  return window?.electronAPI?.platform || null;
}

/**
 * Whether this window can draw Frosted glass. Windows before 11 22H2 cannot blur behind the
 * window, so the setting stays saved but the widget draws the solid panel there.
 * @param {Object} [config] - App config, which carries the main process's desktopCapabilities.
 * @returns {boolean}
 */
function isFrostedGlassAvailable(config) {
  return windowGlass.isGlassAvailable({
    platform: getPlatform(),
    nativeGlassSupported: config?.desktopCapabilities?.nativeGlassSupported,
  });
}

function isLightThemeActive() {
  return document.body?.classList.contains('theme-light');
}
/**
 * Put the theme class on the body: the chosen theme, except that the Readable preset is always
 * dark. Saying so on the body (rather than leaving theme-light beside the preset's dark palette)
 * keeps every light-only rule, light-tuned colour and canvas decoration out of it.
 */
function syncThemeClass() {
  if (chosenThemeIsLight === null) return;
  const body = document.body;
  const light = chosenThemeIsLight && !body.classList.contains('high-contrast');
  body.classList.toggle('theme-light', light);
  body.classList.toggle('theme-dark', !light);
}

function applyTheme(mode = 'auto') {
  try {
    if (mode === 'dark') {
      chosenThemeIsLight = false;
    } else if (mode === 'light') {
      chosenThemeIsLight = true;
    } else {
      const prefersDark =
        window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
      chosenThemeIsLight = !prefersDark;
    }
    syncThemeClass();
  } catch (error) {
    console.error('Error applying theme:', error);
  }
}

// The sides a desktop pin's name can be put on. They are the screen's sides, not the text's, so
// Right means the right in Arabic too.
const DESKTOP_PIN_NAME_ALIGNMENTS = ['left', 'center', 'right'];

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
 * @param {string} [ui.desktopPinNameAlign] - Where desktop pin names sit: 'left', 'center' or
 *   'right'. Unset, they start where the language's text starts.
 */
function applyUiPreferences(ui = {}) {
  try {
    const body = document.body;
    const scale = [1, 1.15, 1.3, 1.5].includes(Number(ui.scale)) ? Number(ui.scale) : 1;
    if (window.electronAPI?.setUiScale) window.electronAPI.setUiScale(scale);
    else document.documentElement.style.zoom = String(scale);
    body.classList.toggle('large-interface', scale > 1);
    const wasLight = body.classList.contains('theme-light');
    body.classList.toggle('high-contrast', !!ui.highContrast);
    syncThemeClass();
    if (body.classList.contains('theme-light') !== wasLight) {
      // The accent and background tints are worked out per theme, so they follow the change. A
      // colour that came in raw (the Omarchy palette, a Settings draft) is worked out again too.
      if (lastAccentKey !== null) applyAccentTheme(lastAccentKey);
      else if (lastAccentColor !== null) applyAccentThemeFromColor(lastAccentColor);
      if (lastBackgroundKey !== null) applyBackgroundTheme(lastBackgroundKey);
      else if (lastBackgroundColor !== null) applyBackgroundThemeFromColor(lastBackgroundColor);
    }
    body.classList.toggle('opaque-panels', !!ui.opaquePanels);
    body.classList.toggle('density-compact', (ui.density || 'comfortable') === 'compact');
    // Opt-out rather than opt-in: the glow is how a tile shows it is on.
    body.classList.toggle('active-tile-glow', ui.activeTileGlow !== false);
    if (DESKTOP_PIN_NAME_ALIGNMENTS.includes(ui.desktopPinNameAlign)) {
      body.dataset.pinNameAlign = ui.desktopPinNameAlign;
    } else {
      delete body.dataset.pinNameAlign;
    }
  } catch (error) {
    console.error('Error applying UI preferences:', error);
  }
  try {
    uiPreferencesObserver?.(ui);
  } catch (error) {
    console.error('Error applying seasonal theme:', error);
  }
}

/**
 * Configure and apply frosted-glass (glassmorphism) window visual effects by setting CSS custom properties and body classes.
 *
 * When `config.frostedGlass` is true, this function sets CSS variables that control blur and multiple layer opacities and then adds the `frosted-glass` class (and `native-glass` on supported platforms). When false, it removes those classes and clears the related CSS custom properties. Windows before 11 22H2 cannot blur behind the window, so there it draws what the setting being off draws.
 *
 * @param {Object} [config={}] - Configuration options.
 * @param {boolean} [config.frostedGlass=false] - Enable or disable the frosted glass effect.
 * @param {Object} [config.desktopCapabilities] - What the main process says this window can do.
 */
function applyWindowEffects(config = {}) {
  try {
    const body = document.body;
    const platform = getPlatform();
    const glassMode = windowGlass.resolveGlassMode({
      platform,
      frostedGlass: !!config.frostedGlass,
      nativeGlassSupported: config.desktopCapabilities?.nativeGlassSupported,
    });
    const enabled = glassMode !== 'off';
    // Disable CSS backdrop filters for low-cost/no-glass rendering while keeping
    // opacity on CSS background surfaces (Linux default, Windows without frosted glass).
    const linuxPerformanceMode = platform === 'linux' || (platform === 'win32' && !enabled);
    const opacity = Math.max(0.5, Math.min(1, Number(config.opacity) || 1));
    const backgroundAlpha = mapWindowOpacityToBackgroundAlpha(opacity);

    body.classList.toggle('linux-performance-mode', linuxPerformanceMode);
    // linux-performance-mode is also what Windows draws without acrylic, so a rule meant for Linux
    // alone cannot key on it. An attribute rather than a class keeps the body's class list, which
    // the glass tests pin per platform, as it was.
    if (platform) body.dataset.platform = platform;
    else delete body.dataset.platform;
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
    const nativeGlass = glassMode === 'native';
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

// The detail line under the summary. A detail that opens by repeating the summary ("Disconnected
// from Home Assistant. Retrying automatically.") is cut to what it adds, so the tooltip and the
// accessible name do not say it twice.
function getConnectionStatusDetail(statusElement) {
  const connected = !!statusElement?.classList?.contains('connected');
  const summary = getConnectionStatusSummary(connected);
  const explicitDetail = statusElement?.dataset?.statusDetail?.trim();
  if (explicitDetail) return stripSummaryPrefix(summary, explicitDetail);
  if (connected) return t('Real-time updates active.');
  return stripSummaryPrefix(
    summary,
    t('Disconnected from Home Assistant. Retrying automatically.')
  );
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
  // Keeping the tooltip inside the window moves it off the dot, so the arrow slides to stay under
  // it, short of the rounded corners.
  const arrowInset = 14;
  const arrowX = Math.max(
    arrowInset,
    Math.min(tooltipRect.width - arrowInset, rect.left + rect.width / 2 - left)
  );
  connectionStatusTooltip.style.setProperty('--arrow-x', `${arrowX}px`);
}

function showConnectionStatusTooltip(target, { pinned = false } = {}) {
  if (!target) return;
  const tooltip = ensureConnectionStatusTooltip();
  const titleEl = tooltip.querySelector('.connection-status-tooltip-title');
  const detailEl = tooltip.querySelector('.connection-status-tooltip-detail');
  // Built from the connection state each time, so the tooltip follows a language change.
  const summary = target.dataset.statusSummary
    ? getConnectionStatusSummary(target.classList.contains('connected'))
    : target.title || t('Disconnected from Home Assistant');
  const detail = getConnectionStatusDetail(target);
  if (titleEl) titleEl.textContent = summary;
  if (detailEl) detailEl.textContent = detail;
  connectionStatusTooltipTarget = target;
  if (pinned) connectionStatusTooltipPinned = true;
  target.setAttribute('aria-describedby', tooltip.id);
  tooltip.classList.add('visible');
  tooltip.setAttribute('aria-hidden', 'false');
  positionConnectionStatusTooltip(target);
}

function hideConnectionStatusTooltip({ force = false } = {}) {
  if (!connectionStatusTooltip) return;
  if (connectionStatusTooltipPinned && !force) return;
  if (connectionStatusTooltipTarget) {
    connectionStatusTooltipTarget.removeAttribute('aria-describedby');
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
  const onFocus = () => {
    if (connectionStatusFocusReturnsWithWindow) {
      connectionStatusFocusReturnsWithWindow = false;
      return;
    }
    // A click focuses the dot as well, and the click handler decides what that does. Only focus
    // from the keyboard opens the tooltip here.
    if (!status.matches(':focus-visible')) return;
    showConnectionStatusTooltip(status);
  };
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
    // Hiding the widget closes the tooltip, pinned or not, so it is not over the dashboard the
    // next time the widget opens (issue #214).
    window.addEventListener('blur', (event) => {
      if (event.target !== window) return;
      connectionStatusFocusReturnsWithWindow =
        !!connectionStatusBoundElement && document.activeElement === connectionStatusBoundElement;
      hideConnectionStatusTooltip({ force: true });
    });
    window.addEventListener('focus', (event) => {
      if (event.target !== window) return;
      // The dot's own focus event comes in the same task, before or after this one; past it, the
      // flag would swallow the next time the user tabs to the dot.
      setTimeout(() => {
        connectionStatusFocusReturnsWithWindow = false;
      }, 0);
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
    // No aria-haspopup or aria-expanded: what opens is a tooltip (role=tooltip), which repeats the
    // label the dot already has and is tied to it by aria-describedby. Announced as a menu button,
    // it promised a menu that never came.
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
      // Read out as "summary. what it adds", so a detail that begins with the summary is cut.
      const addedDetail = stripSummaryPrefix(summary, normalizedDetail);

      // No title attribute: the dot has its own tooltip, and Chromium's native one would come up
      // after it with the same words.
      if (addedDetail) {
        status.setAttribute('aria-label', `${summary}. ${addedDetail}`);
      } else {
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
    t('Hotkey “{{hotkey}}” is already in use by another application.', { hotkey }),
    'error',
    5000
  );
});

/**
 * Copy text through the main process, since the renderer's own clipboard permission is denied.
 * @param {string} text - Text to place on the system clipboard.
 * @returns {Promise<boolean>} True once the text is on the clipboard; false when copying failed.
 */
async function copyTextToClipboard(text) {
  try {
    await window.electronAPI.writeClipboardText(String(text ?? ''));
    return true;
  } catch {
    return false;
  }
}

export {
  copyTextToClipboard,
  applyTheme,
  setCustomThemes,
  applyAccentTheme,
  applyAccentThemeFromColor,
  applyBackgroundTheme,
  applyBackgroundThemeFromColor,
  getAccentThemes,
  getBackgroundThemes,
  getBackgroundWindowColor,
  applyUiPreferences,
  setSeasonalColors,
  suspendSeasonalColors,
  getSeasonalColors,
  setUiPreferencesObserver,
  applyWindowEffects,
  isFrostedGlassAvailable,
  showLoading,
  initializeConnectionStatusTooltip,
  setStatus,
};

/* global process */
import { t } from './i18n.js';
import { setIconContent } from './icons.js';
import { setLineIconContent } from './entity-icons.js';
import { prefersReducedMotion } from './motion.js';
import windowGlass from './window-glass.cjs';

const focusTrapHandlers = new WeakMap();
// Where focus returns when a trapped modal is released: the control that opened it, as found
// again if it is rebuilt (tile, focus key), and a last resort.
const focusTrapOpeners = new WeakMap();
const activeFocusTrapModals = new Set();
// What each open dialog does on Escape, Enter and a backdrop click; see openDialog().
const dialogLayers = new WeakMap();
// One entry per modal that is currently animating out, so a later close (or a re-open) can take
// the in-flight timer and listener away from the call that installed them.
const pendingModalCloses = new WeakMap();
const DEFAULT_FROSTED_STRENGTH = 60;
const DEFAULT_FROSTED_TINT = 60;
const MIN_BACKGROUND_OPACITY = 0.08;
// How much of a Background colour is mixed into the window's own: a hint, not a repaint.
const BACKGROUND_TINT = { dark: 0.12, light: 0.08 };
const BACKGROUND_OPACITY_CURVE = 1.35;
const CUSTOM_THEME_ID_PREFIX = 'custom-';
// The shared modal exit animation runs for var(--duration-base) (200ms); the fallback timer only
// exists for hosts that never deliver `animationend` (reduced-motion overrides, background tabs,
// jsdom).
const MODAL_EXIT_FALLBACK_MS = 300;
const TOAST_EXIT_FALLBACK_MS = 300;
const TOAST_ICON_NAMES = {
  success: 'circle-check',
  error: 'circle-x',
  warning: 'triangle-alert',
  info: 'info',
};
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

const BACKGROUND_BASES = {
  // A cool slate rather than neutral grey, so the window reads as tinted glass. Kept in step with
  // the :root defaults in styles.css.
  dark: {
    bgColor: { r: 18, g: 22, b: 30, a: 0.8 },
    bgElevated: { r: 24, g: 28, b: 37, a: 0.9 },
    bgPrimary: { r: 13, g: 16, b: 22, a: 0.95 },
    bgSecondary: { r: 24, g: 28, b: 37, a: 0.9 },
    bgTertiary: { r: 30, g: 35, b: 45, a: 0.85 },
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

function linearChannel(channel) {
  const value = channel / 255;
  return value <= 0.03928 ? value / 12.92 : Math.pow((value + 0.055) / 1.055, 2.4);
}

/** WCAG relative luminance of an {r, g, b} colour. */
function relativeLuminance({ r, g, b }) {
  return 0.2126 * linearChannel(r) + 0.7152 * linearChannel(g) + 0.0722 * linearChannel(b);
}

/** WCAG contrast ratio between two {r, g, b} colours. */
function contrastBetween(first, second) {
  const [lighter, darker] = [relativeLuminance(first), relativeLuminance(second)].sort(
    (a, b) => b - a
  );
  return (lighter + 0.05) / (darker + 0.05);
}

const WHITE = { r: 255, g: 255, b: 255 };
const BLACK = { r: 0, g: 0, b: 0 };
// The two surfaces accent text has to clear, as the stylesheet paints them. In the dark theme it is
// the lightest of them, a main view tile (the panel lifted for the V2 look); in the light theme the
// darkest, the panel with its grey veil. Text sits on those with the accent's own tint behind it (a
// secondary button, the active page tab, a lit tile), so the tint is mixed in as well.
const ACCENT_TEXT_SURFACES = {
  dark: { surface: { r: 44, g: 47, b: 54 }, tint: 0.18 },
  light: { surface: { r: 228, g: 228, b: 228 }, tint: 0.14 },
};

const rgbString = ({ r, g, b }) => `rgb(${r}, ${g}, ${b})`;
// Below this spread between the strongest and weakest channel an accent reads as grey (slate is
// 0.14, the most muted of the other presets 0.56).
const NEUTRAL_ACCENT_CHROMA = 0.25;

/**
 * Text colour for content drawn on top of a colour: near-black or white, whichever contrasts
 * more (WCAG relative luminance), so a dark custom accent still gets readable button labels.
 * @param {{r:number, g:number, b:number}} rgb - Background colour.
 * @returns {string} '#0a0c10' or '#ffffff'.
 */
function getReadableTextColor(rgb) {
  const luminance = relativeLuminance(rgb);
  // Contrast with white is 1.05 / (L + 0.05); with #0a0c10 (L ≈ 0.0037) it is (L + 0.05) / 0.0537.
  return 1.05 / (luminance + 0.05) > (luminance + 0.05) / 0.0537 ? '#ffffff' : '#0a0c10';
}

/**
 * The accent moved toward `target` just far enough to reach `minContrast` on the surface the theme
 * paints behind accent text, bare and with the accent's own tint on it. An accent that already
 * reads well comes back unchanged.
 */
function solveAccentText(rgb, { surface, tint }, target, minContrast) {
  const tinted = mixRgb(surface, rgb, tint);
  let color = rgb;
  for (let amount = 0; amount <= 1; amount += 0.02) {
    color = mixRgb(rgb, target, amount);
    // The plain surface counts too: a near-black accent's tint is darker than the surface itself.
    if (Math.min(contrastBetween(color, surface), contrastBetween(color, tinted)) >= minContrast) {
      break;
    }
  }
  return rgbString(color);
}

/**
 * The accent darkened just enough to read as text on the light theme's panes (at least
 * `minContrast` on the veiled panel under the accent's tint, which is the darkest place text
 * sits), so pale accents like aqua or yellow still work for links and secondary buttons. Returns an
 * rgb() string.
 * @param {{r:number, g:number, b:number}} rgb - Accent colour.
 * @param {number} [minContrast=4.8]
 */
function getAccentTextOnLight(rgb, minContrast = 4.8) {
  return solveAccentText(rgb, ACCENT_TEXT_SURFACES.light, BLACK, minContrast);
}

/**
 * The accent lightened just enough to read as text on the dark theme's tiles and panes (at least
 * `minContrast` on a main view tile under the accent's tint). Indigo, violet, rose, the holiday
 * reds and any dark custom colour fall short as they are; the default blue is left alone.
 * Returns an rgb() string.
 * @param {{r:number, g:number, b:number}} rgb - Accent colour.
 * @param {number} [minContrast=4.6]
 */
function getAccentTextOnDark(rgb, minContrast = 4.6) {
  return solveAccentText(rgb, ACCENT_TEXT_SURFACES.dark, WHITE, minContrast);
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

/**
 * The fill a primary button takes on hover: the accent stepped toward white in the dark theme and
 * toward black in the light one. The label colour was picked for the accent at rest, so the step
 * must not take it below 4.5:1 (or below what it had at rest): an accent whose label is white
 * steps the other way, in the dark theme too (so Indigo hovers darker there), since a lighter
 * fill only costs it contrast, and any other step is shortened until the label holds.
 * @param {{r:number, g:number, b:number}} rgb - Accent colour.
 * @param {string} onAccent - The label colour picked for the accent, '#0a0c10' or '#ffffff'.
 * @param {boolean} isLightTheme
 * @returns {{r:number, g:number, b:number}}
 */
function getAccentHoverColor(rgb, onAccent, isLightTheme) {
  const label = hexToRgb(onAccent);
  const toward = isLightTheme || onAccent === '#ffffff' ? BLACK : WHITE;
  const floor = Math.min(4.5, contrastBetween(label, rgb));
  let hover = rgb;
  for (let mix = isLightTheme ? 0.18 : 0.22; mix > 0; mix -= 0.02) {
    hover = mixRgb(rgb, toward, mix);
    if (contrastBetween(label, hover) >= floor) return hover;
  }
  return rgb;
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
    const chroma = (Math.max(rgb.r, rgb.g, rgb.b) - Math.min(rgb.r, rgb.g, rgb.b)) / 255;
    if (chroma < NEUTRAL_ACCENT_CHROMA) document.body.dataset.accentNeutral = 'true';
    else delete document.body.dataset.accentNeutral;
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
 * @param {boolean} [options.restoreFocus=true] - With `releaseFocus`, hand focus back to the opener.
 * @param {boolean} [options.animate=true] - False to hide at once, for overlays with no exit animation.
 * @param {Function} [options.onClosed] - Callback invoked after the modal is hidden or removed.
 * @returns {Promise<void>} Resolves once the modal has been hidden or removed.
 */
function closeModal(
  modal,
  {
    remove = false,
    releaseFocus = false,
    restoreFocus = true,
    animate = true,
    onClosed = null,
  } = {}
) {
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
        // A close with no exit animation (reduced motion, or an overlay that has none) hands focus
        // back at once; one that waited for its animation does so a tick later.
        if (releaseFocus) releaseFocusTrap(modal, { restoreFocus, restoreNow: !animating });
        onClosed?.();
      } catch (error) {
        console.error('Error closing modal:', error);
      }
      settleWaiters();
    }

    const superseded = pendingModalCloses.get(modal);
    if (superseded) waiters.push(...superseded.supersede());

    if (!animate || shouldSkipExitAnimation()) {
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

// ---------------------------------------------------------------------------------------------
// Toasts. One manager owns the stack: it keeps the container clear of the buttons of whatever
// raised them, folds repeats into one toast, caps the stack, keeps problems on screen until they
// are read, and pauses the clock while a toast is being looked at.
// ---------------------------------------------------------------------------------------------

const TOAST_FOOTER_GAP_PX = 8;
const TOAST_LIMIT = 3;
// A pin window is 168px tall, so one toast at a time is all it can hold. For the same reason an
// error there does not wait to be dismissed: it would sit over the pin's tile until someone clicked
// it, and a pin on the desktop layer may never get the keyboard focus that closes it. It lives as
// long as a warning does, with the same pause while it is being read.
const TOAST_PIN_LIMIT = 1;
// Warnings are read, not glanced at: long enough for the sentence at a reading pace.
const TOAST_MIN_WARNING_MS = 6000;
const TOAST_MS_PER_CHARACTER = 55;
// After the pointer leaves or focus moves on, the toast stays long enough to see it go.
const TOAST_RESUME_MIN_MS = 1500;
const TOAST_TYPES = new Set(['success', 'error', 'warning', 'info']);

// Where a toast must not sit: the controls its surface is waiting on. Dialogs come first, because
// anything behind an open dialog is covered by its backdrop and no longer matters.
const TOAST_DIALOG_AVOID_SELECTOR = '.modal:not(.hidden):not(.modal-closing) .modal-footer';
const TOAST_SURFACE_AVOID_SELECTOR = [
  '.first-run-onboarding:not(.hidden) .first-run-actions',
  '.widget-state-panel .widget-state-actions',
].join(', ');

// While one of these is on screen Escape is not for the toasts: it ends a mode.
const TOAST_ESCAPE_YIELD_SELECTOR = '#quick-controls.reorganize-mode';

// Timing per toast: how long is left, whether the pointer or focus is on it, and the live timer.
const toastTiming = new WeakMap();

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
  const timing = toastTiming.get(toast);
  clearTimeout(timing?.timer);
  toastTiming.delete(toast);
  // A toast that had keyboard focus hands it back to where the user was, not to <body>.
  if (timing?.returnTo?.isConnected && toast.contains(document.activeElement)) {
    timing.returnTo.focus({ preventScroll: true });
  }

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
    layoutToasts();
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
 * Dismiss every toast that was shown with the given `source`.
 * @param {string} source - The tag passed to {@link showToast}.
 */
function dismissToasts(source) {
  const container = document.getElementById('toast-container');
  getLiveToasts(container)
    .filter((toast) => toast.dataset.source === source)
    .forEach(dismissToast);
}

function getLiveToasts(container) {
  return Array.from(container?.querySelectorAll?.('.toast') || []).filter(
    (toast) => toast.dataset?.dismissing !== 'true'
  );
}

function scheduleToastDismiss(toast, delay) {
  const timing = toastTiming.get(toast);
  if (!timing) return;
  clearTimeout(timing.timer);
  timing.timer = null;
  timing.remaining = delay;
  timing.startedAt = Date.now();
  if (!timing.paused && Number.isFinite(delay)) {
    timing.timer = setTimeout(() => dismissToast(toast), delay);
  }
}

function setToastPaused(toast, paused) {
  const timing = toastTiming.get(toast);
  if (!timing || timing.paused === paused) return;
  timing.paused = paused;
  if (paused) {
    clearTimeout(timing.timer);
    timing.timer = null;
    if (Number.isFinite(timing.remaining)) {
      timing.remaining = Math.max(0, timing.remaining - (Date.now() - timing.startedAt));
    }
    return;
  }
  if (Number.isFinite(timing.remaining)) {
    scheduleToastDismiss(toast, Math.max(timing.remaining, TOAST_RESUME_MIN_MS));
  }
}

function isPinWindow() {
  return !!document.body?.classList.contains('desktop-pin-mode');
}

// How long a toast stays when nobody is reading it. Problems wait to be dismissed: an error that
// vanishes after two seconds is an error the user may never learn about, and it is announced as an
// alert for the same reason. A pin window cannot hold one that long (see TOAST_PIN_LIMIT).
function getToastLifetime(type, message, timeout, inPin = false) {
  if (type === 'error' && !inPin) return Infinity;
  if (type === 'warning' || type === 'error') {
    return Math.max(timeout, TOAST_MIN_WARNING_MS, 1500 + TOAST_MS_PER_CHARACTER * message.length);
  }
  return timeout;
}

/**
 * Keep the toast stack clear of the controls its surface is waiting on.
 *
 * Toasts sit at the bottom of the window, which is also where a dialog keeps its footer buttons
 * (Close, Save, Turn On), where the first-run wizard keeps Next, and where the connection panel
 * keeps Retry. The stack is lifted above whichever of those is showing. It is recomputed whenever
 * one of them opens or closes, as well as when a toast is added, so a stack that was already up
 * does not end up covering a footer that appeared afterwards, or float where one used to be.
 */
function layoutToasts() {
  if (typeof document === 'undefined') return;
  const container = document.getElementById('toast-container');
  if (!container) return;
  if (!container.querySelector('.toast')) {
    container.style.removeProperty('bottom');
    return;
  }
  const tops = (selector) =>
    Array.from(document.querySelectorAll(selector))
      .filter((element) => element.getClientRects().length > 0)
      .map((element) => element.getBoundingClientRect())
      // A surface scrolled out of view has nothing for a toast to cover.
      .filter((rect) => rect.bottom > 0 && rect.top < window.innerHeight)
      .map((rect) => rect.top);
  let avoid = tops(TOAST_DIALOG_AVOID_SELECTOR);
  if (!avoid.length && !document.querySelector('.modal:not(.hidden):not(.modal-closing)')) {
    avoid = tops(TOAST_SURFACE_AVOID_SELECTOR);
  }
  if (!avoid.length) {
    container.style.removeProperty('bottom');
    return;
  }
  const bottom = Math.max(0, window.innerHeight - Math.min(...avoid)) + TOAST_FOOTER_GAP_PX;
  container.style.bottom = `${Math.round(bottom)}px`;
}

let toastLayoutWired = false;
function wireToastLayout() {
  if (toastLayoutWired || typeof window === 'undefined') return;
  toastLayoutWired = true;
  installDialogKeyRouter();
  window.addEventListener('resize', layoutToasts);
  // The wizard, the connection panel and the like announce themselves with a class on <body>.
  if (typeof MutationObserver === 'function' && document.body) {
    new MutationObserver(layoutToasts).observe(document.body, {
      attributes: true,
      attributeFilter: ['class'],
    });
  }
}

// A dialog is often filled in after it opens: createEntityDetailModal hands its caller an open,
// empty dialog, and the caller builds the body and sometimes the footer. A stack that was already
// up would stay docked where the footer was going to be, over buttons that did not exist when it
// was placed. So while a dialog is open, whatever is added to or taken out of it re-docks the stack.
const dialogLayoutWatchers = new WeakMap();

function watchDialogLayout(modal) {
  if (dialogLayoutWatchers.has(modal) || typeof MutationObserver !== 'function') return;
  const observer = new MutationObserver(() => layoutToasts());
  observer.observe(modal, { childList: true, subtree: true });
  dialogLayoutWatchers.set(modal, observer);
}

function unwatchDialogLayout(modal) {
  dialogLayoutWatchers.get(modal)?.disconnect();
  dialogLayoutWatchers.delete(modal);
}

// With no dialog open, Escape sends away the newest toast. Errors stay until dismissed, and
// reaching one by Tab means walking the whole page first.
function dismissNewestToastForEscape(event) {
  // Reorganizing Quick Access ends on Escape (its notice says "Esc to finish"), and that mode's
  // handler can sit before or after this one on the document. A toast that took the key first,
  // the notice itself included, would make the shortcut need a second press. This is only reached
  // with no dialog open and the key not used yet, the two tests the mode applies before it takes
  // the key, so yielding here never leaves Escape with nobody to answer it.
  if (document.querySelector(TOAST_ESCAPE_YIELD_SELECTOR)) return;
  const container = document.getElementById('toast-container');
  const newest = getLiveToasts(container).pop();
  if (!newest) return;
  // Typing in a field is not a request to clear the notice.
  if (event.target?.closest?.('input, textarea, select, [contenteditable="true"]')) return;
  event.preventDefault();
  dismissToast(newest);
}

/**
 * Display a toast notification in the element with id "toast-container".
 *
 * The toast leads with a status icon matching its type and exits through the shared
 * `.toast-closing` animation. Errors and warnings are announced as alerts and carry a close
 * button; errors stay until dismissed (in a pin window, as long as a warning) and warnings stay
 * long enough to read. Every toast pauses while the pointer or keyboard focus is on it, is
 * dismissed by click or from the keyboard (Enter, Space or Escape), and is folded into an
 * identical toast already showing. At most three stay on screen at once (one in a pin window).
 *
 * @param {string} message - Text to show inside the toast.
 * @param {string} [type='success'] - Visual variant/class to apply ('success', 'error', 'warning' or 'info').
 * @param {number} [timeout=2000] - Time in milliseconds before a success or info toast begins animating out.
 * @param {Object} [options] - Extra behaviour.
 * @param {boolean} [options.passive=false] - A notice that asks nothing of the user: it ignores the pointer, so it never swallows a drag aimed at what is under it, and cannot take focus.
 * @param {string} [options.source] - Tags the toast so its caller can take it down later with {@link dismissToasts}, without keeping hold of the element.
 * @returns {HTMLElement|undefined} The toast element, or undefined when it could not be shown.
 */
function showToast(
  message,
  type = 'success',
  timeout = 2000,
  { passive = false, source = '' } = {}
) {
  try {
    const container = document.getElementById('toast-container');
    if (!container) return undefined;
    wireToastLayout();
    const kind = TOAST_TYPES.has(type) ? type : 'info';
    const text = String(message ?? '');
    const inPin = isPinWindow();
    const lifetime = getToastLifetime(kind, text, timeout, inPin);

    // The same message twice at once is one problem reported twice: the first stays, with a fresh
    // clock, instead of a second toast joining the stack.
    const showing = getLiveToasts(container).find(
      (existing) =>
        existing.classList.contains(kind) &&
        existing.querySelector('.toast-message')?.textContent === text
    );
    if (showing) {
      scheduleToastDismiss(showing, lifetime);
      layoutToasts();
      return showing;
    }

    // A full stack makes room by letting go of the oldest notice, an error last: it is the one
    // the user has not necessarily seen.
    const limit = inPin ? TOAST_PIN_LIMIT : TOAST_LIMIT;
    let live = getLiveToasts(container);
    while (live.length >= limit) {
      const evicted = live.find((existing) => !existing.classList.contains('error')) || live[0];
      dismissToast(evicted);
      live = live.filter((existing) => existing !== evicted);
    }

    const toast = document.createElement('div');
    toast.className = `toast ${kind}`;
    if (source) toast.dataset.source = source;
    // The container is a polite live region for the quiet kinds; a problem is interrupting.
    if (kind === 'error' || kind === 'warning') toast.setAttribute('role', 'alert');

    const icon = document.createElement('span');
    icon.className = 'toast-icon';
    icon.setAttribute('aria-hidden', 'true');
    setLineIconContent(icon, TOAST_ICON_NAMES[kind]);
    toast.appendChild(icon);

    const body = document.createElement('span');
    body.className = 'toast-message';
    body.textContent = text;
    toast.appendChild(body);

    toastTiming.set(toast, { remaining: lifetime, startedAt: Date.now(), timer: null });

    if (passive) {
      toast.classList.add('toast-passive');
    } else {
      // Dismissible by click, and from the keyboard: it takes focus with Tab, and Enter, Space or
      // Escape closes it.
      toast.tabIndex = 0;
      toast.addEventListener('click', () => dismissToast(toast));
      toast.addEventListener('keydown', (event) => {
        if (event.key !== 'Enter' && event.key !== ' ' && event.key !== 'Escape') return;
        event.preventDefault();
        dismissToast(toast);
      });
      if (kind === 'error' || kind === 'warning') {
        // For the pointer: the toast itself is the keyboard's one stop, so this stays out of Tab.
        const close = document.createElement('button');
        close.type = 'button';
        close.className = 'toast-close';
        close.tabIndex = -1;
        close.setAttribute('aria-label', t('Close'));
        setIconContent(close, 'close', { size: 14 });
        toast.appendChild(close);
      }
      // Reading takes longer than the clock allows for: hold it while it is under the pointer
      // or focused, then give it a moment more.
      const hold = { hovered: false, focused: false };
      const update = () => setToastPaused(toast, hold.hovered || hold.focused);
      toast.addEventListener('pointerenter', () => {
        hold.hovered = true;
        update();
      });
      toast.addEventListener('pointerleave', () => {
        hold.hovered = false;
        update();
      });
      toast.addEventListener('focusin', (event) => {
        const timing = toastTiming.get(toast);
        if (timing && event.relatedTarget && !toast.contains(event.relatedTarget)) {
          timing.returnTo = event.relatedTarget;
        }
        hold.focused = true;
        update();
      });
      toast.addEventListener('focusout', () => {
        hold.focused = false;
        update();
      });
    }

    container.appendChild(toast);
    scheduleToastDismiss(toast, lifetime);
    layoutToasts();
    return toast;
  } catch (error) {
    console.error('Error showing toast:', error);
    return undefined;
  }
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

const FOCUSABLE_SELECTOR =
  'a[href], button, textarea, input, select, [tabindex]:not([tabindex="-1"])';

// Read at key time rather than when the trap starts: dialogs add, remove and disable controls
// while open, and a stale list lets Tab walk out of the dialog.
function getFocusableElements(modal) {
  return Array.from(modal?.querySelectorAll?.(FOCUSABLE_SELECTOR) || []).filter(
    (element) =>
      !element.disabled &&
      !element.closest('[hidden], .hidden') &&
      element.checkVisibility?.() !== false
  );
}

function isFocusTrapModalShown(modal) {
  if (!modal?.isConnected || modal.hidden) return false;
  if (modal.classList.contains('hidden') || modal.classList.contains('modal-closing')) return false;
  return modal.style?.display !== 'none';
}

function getTopFocusTrapModal() {
  const modals = Array.from(activeFocusTrapModals);
  for (let index = modals.length - 1; index >= 0; index -= 1) {
    if (isFocusTrapModalShown(modals[index])) return modals[index];
  }
  return null;
}

/**
 * Whether a dialog is open. While one is, Escape and Enter belong to it and not to the dashboard
 * behind it (leaving Reorganize mode, for one).
 * @returns {boolean}
 */
function hasOpenDialog() {
  return getTopFocusTrapModal() !== null;
}

/**
 * Keep Tab and Escape working in an open dialog after focus has fallen back to `<body>`.
 *
 * A dialog's keydown listeners only hear keys while focus is inside it, and the browser drops
 * focus to `<body>` whenever the focused control is disabled or re-rendered. Tab then walks the
 * page behind an `aria-modal` dialog. This brings Tab back into the top dialog. Dialogs opened
 * with {@link openDialog} get Escape from the document-level router, wherever focus is; any
 * other trapped modal still has Escape replayed inside it so its own handler closes it.
 * @param {KeyboardEvent} event - A keydown event seen on the window before any other listener.
 */
let replayingEscape = false;
function handleKeydownWithoutFocus(event) {
  if (replayingEscape || (event.key !== 'Tab' && event.key !== 'Escape')) return;
  const active = document.activeElement;
  if (active && active !== document.body && active !== document.documentElement) return;
  const modal = getTopFocusTrapModal();
  if (!modal) return;
  if (event.key === 'Tab') {
    // Let the browser move focus first: after a click on the dialog's text it continues from that
    // spot. Only bring focus back if it went to the page behind the dialog.
    const backwards = event.shiftKey;
    setTimeout(() => {
      if (!isFocusTrapModalShown(modal) || modal.contains(document.activeElement)) return;
      const focusable = getFocusableElements(modal);
      (backwards ? focusable[focusable.length - 1] : focusable[0])?.focus();
    }, 0);
    return;
  }
  if (dialogLayers.has(modal)) return;
  event.preventDefault();
  event.stopImmediatePropagation();
  replayingEscape = true;
  try {
    (modal.querySelector('.modal-content') || modal).dispatchEvent(
      new KeyboardEvent('keydown', {
        key: 'Escape',
        code: 'Escape',
        bubbles: true,
        cancelable: true,
      })
    );
  } finally {
    replayingEscape = false;
  }
}

let keydownWithoutFocusInstalled = false;
function installKeydownWithoutFocusHandler() {
  if (keydownWithoutFocusInstalled || typeof window === 'undefined') return;
  keydownWithoutFocusInstalled = true;
  window.addEventListener('keydown', handleKeydownWithoutFocus, true);
}

// Entity tiles are rebuilt when their entity changes, so a dialog opened from a tile may close
// after the tile it would return focus to has been replaced. Remember enough to find the new one.
function describeTileFocusTarget(element) {
  const tile = element?.closest?.('[data-entity-id]');
  if (!tile) return null;
  return {
    entityId: tile.dataset.entityId,
    scopeId: tile.parentElement?.closest('[id]')?.id || null,
    className: element === tile ? null : element.classList?.[0] || null,
  };
}

function findTileFocusTarget(descriptor) {
  if (!descriptor) return null;
  const scope = (descriptor.scopeId && document.getElementById(descriptor.scopeId)) || document;
  const tile = Array.from(scope.querySelectorAll('[data-entity-id]')).find(
    (candidate) => candidate.dataset.entityId === descriptor.entityId
  );
  if (!tile) return null;
  return (descriptor.className && tile.getElementsByClassName(descriptor.className)[0]) || tile;
}

// Lists inside and behind a dialog are rebuilt while it is open, so the control that opened it may
// be replaced by an equivalent one. A rebuilt control keeps its id, or carries `data-focus-key`
// when it has none (several rows share one button class), and that says which one it was.
function describeFocusKey(element) {
  if (!element || element === document.body) return null;
  const key = element.dataset?.focusKey || null;
  const id = element.id || null;
  return key || id ? { key, id } : null;
}

/**
 * Find the control carrying a `data-focus-key`.
 * @param {string} key - The key a rebuilt list gave the control.
 * @param {ParentNode} [scope=document] - Where to look.
 * @returns {HTMLElement|null}
 */
function findFocusKey(key, scope = document) {
  if (!key) return null;
  return (
    Array.from(scope.querySelectorAll('[data-focus-key]')).find(
      (candidate) => candidate.dataset.focusKey === key
    ) || null
  );
}

function findFocusKeyTarget(descriptor, scope = document) {
  if (!descriptor) return null;
  return (
    findFocusKey(descriptor.key, scope) || document.getElementById(descriptor.id || '') || null
  );
}

/**
 * Run a render that rebuilds part of the page and keep the keyboard where it was.
 *
 * Replacing the focused control sends focus to `<body>`, so the next Tab starts from the top of
 * the page. When focus was inside `container`, the equivalent control (same id or
 * `data-focus-key`) takes it back after `render`; failing that the `fallback`, then the control now
 * at the same position, so deleting a row lands on its neighbour.
 *
 * @param {HTMLElement|null} container - The element whose children `render` rebuilds.
 * @param {Function} render - Rebuilds the container; its return value is passed through.
 * @param {Object} [options] - Focus behaviour.
 * @param {HTMLElement|string|Function} [options.fallback] - Element, selector or callback used when the
 *   focused control no longer exists.
 * @returns {*} Whatever `render` returned.
 */
function renderKeepingFocus(container, render, { fallback = null } = {}) {
  const active = document.activeElement;
  const hadFocus = !!container && !!active && active !== container && container.contains(active);
  if (!hadFocus) return render();
  const descriptor = describeFocusKey(active);
  const position = getFocusableElements(container).indexOf(active);
  const result = render();
  const now = document.activeElement;
  if (now && now !== document.body && now.isConnected) return result;
  // A control that came back hidden (a Clear button with nothing left to clear) cannot take focus.
  let target = findFocusKeyTarget(descriptor, container);
  if (target?.checkVisibility?.() === false) target = null;
  if (!target && fallback) {
    const resolved = typeof fallback === 'function' ? fallback() : fallback;
    target = typeof resolved === 'string' ? document.querySelector(resolved) : resolved;
  }
  if (!target) {
    const remaining = getFocusableElements(container);
    target = remaining[Math.min(Math.max(position, 0), remaining.length - 1)] || null;
  }
  target?.focus?.({ preventScroll: true });
  return result;
}

/**
 * Disable controls while something is saved, and hand keyboard focus back when they are enabled
 * again. The browser drops focus to `<body>` when the focused control becomes disabled and does not
 * restore it on re-enable, so a keyboard user loses their place after every save.
 * @param {Iterable<HTMLElement|null>} controls - The controls to disable; nulls are skipped.
 * @returns {Function} Re-enables them and restores focus if the page was left with none.
 */
function disableControlsKeepingFocus(controls) {
  const list = Array.from(controls).filter(Boolean);
  const focused = document.activeElement;
  const hadFocus = list.includes(focused);
  list.forEach((control) => {
    control.disabled = true;
  });
  return () => {
    list.forEach((control) => {
      control.disabled = false;
    });
    const active = document.activeElement;
    if (hadFocus && focused.isConnected && (!active || active === document.body)) {
      focused.focus({ preventScroll: true });
    }
  };
}

/**
 * Pick the control a dialog should focus when it opens: the one the caller asked for, one marked
 * `data-initial-focus`, or else the first control that is not in the header. The header's Close
 * button comes first in the DOM, and landing there means a stray Enter or Space dismisses the
 * dialog and the user has to Tab before they can type.
 * @param {HTMLElement} modal - The dialog overlay.
 * @param {HTMLElement|string|Function|undefined} initialFocus - Element, selector inside the dialog,
 *   or a callback returning one.
 * @returns {HTMLElement|null}
 */
function resolveInitialFocus(modal, initialFocus) {
  const requested =
    typeof initialFocus === 'function'
      ? initialFocus(modal)
      : typeof initialFocus === 'string'
        ? modal.querySelector(initialFocus)
        : initialFocus;
  if (requested && requested.isConnected !== false && !requested.disabled) return requested;
  const marked = modal.querySelector('[data-initial-focus]:not(:disabled)');
  if (marked) return marked;
  const focusable = getFocusableElements(modal);
  return focusable.find((element) => !element.closest('.modal-header')) || focusable[0] || null;
}

// A text field that opens with a value in it (a name being edited) starts selected, so typing
// replaces the name instead of landing in front of it.
function focusInitialControl(control) {
  if (!control) return;
  control.focus();
  if (control.matches?.('input:not([type]), input[type="text"], input[type="search"]')) {
    if (control.value) control.select?.();
  }
}

/**
 * Activate a focus trap inside a modal element so keyboard Tab navigation cycles within it.
 *
 * Attaches a keydown handler to the provided modal that confines Tab (and Shift+Tab) focus movement to the modal's focusable descendants, sets focus to the first meaningful control, and records the previously focused element for later restoration. The handler is stored in the module-level `focusTrapHandlers` WeakMap keyed by the modal.
 * Dialogs go through {@link openDialog}, which wraps this; call it directly only for overlays that manage their own visibility.
 * @param {HTMLElement} modal - The modal container element within which focus should be trapped.
 * @param {Object} [options] - Trap behaviour.
 * @param {HTMLElement|string|Function|false} [options.initialFocus] - Element (or selector, or callback returning one) to focus instead of the first control outside the header, or false to leave focus where the caller puts it.
 * @param {HTMLElement|string|Function} [options.focusFallback] - Where focus goes on release when the opener has been replaced and cannot be found again.
 * @param {Object} [options.opener] - The opener record of a dialog this one replaces (internal).
 */
function trapFocus(modal, { initialFocus, focusFallback = null, opener = null } = {}) {
  try {
    const existingHandler = focusTrapHandlers.get(modal);
    if (existingHandler) {
      modal.removeEventListener('keydown', existingHandler);
    }
    // A dialog that replaces another takes over the first one's opener, so Escape still lands
    // where the user started and not on a control inside the dialog that went away.
    focusTrapOpeners.set(
      modal,
      opener || {
        element: document.activeElement,
        tile: describeTileFocusTarget(document.activeElement),
        key: describeFocusKey(document.activeElement),
        fallback: focusFallback,
      }
    );
    const handler = (e) => {
      // Overlays with their own Tab order (camera preview, command palette) already moved focus.
      if (e.key !== 'Tab' || e.defaultPrevented) return;
      const focusable = getFocusableElements(modal);
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
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
    installKeydownWithoutFocusHandler();
    if (initialFocus !== false) {
      // Resolved when the timer fires, not now: callers add content in the tick after opening.
      setTimeout(() => {
        if (!modal.isConnected) return;
        focusInitialControl(resolveInitialFocus(modal, initialFocus));
      }, 0);
    }
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

/**
 * Release a focus trap started by {@link trapFocus} and hand focus back to where it was.
 *
 * The opener is found again if it was rebuilt meanwhile: by its id or `data-focus-key`, as the
 * Quick Access tile it belonged to, or failing both through the `focusFallback` given to the trap.
 * @param {HTMLElement} [modal] - The modal to release; the top trapped modal when omitted.
 * @param {Object} [options] - Release behaviour.
 * @param {boolean} [options.restoreFocus=true] - False when the caller moves focus itself.
 * @param {boolean} [options.restoreNow=false] - Hand focus back before returning, and not only on
 *   the next tick. For a dialog that closes at once, because the next thing the caller does may
 *   open another dialog, which then records the control that has focus as the one to return to.
 */
function releaseFocusTrap(modal, { restoreFocus = true, restoreNow = false } = {}) {
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
    dialogLayers.delete(targetModal);
    unwatchDialogLayout(targetModal);
    targetModal.style?.removeProperty('--dialog-depth');

    const {
      element: previousFocus,
      tile: previousTile,
      key: previousKey,
      fallback,
    } = focusTrapOpeners.get(targetModal) || {};
    focusTrapOpeners.delete(targetModal);
    if (restoreFocus && (previousFocus?.focus || fallback)) {
      const restore = () => {
        // The opener can have been replaced, or can sit in a dialog that has closed since.
        const usable = (element) => !!element?.isConnected && element.checkVisibility?.() !== false;
        const resolveFallback = () => {
          const resolved = typeof fallback === 'function' ? fallback() : fallback;
          return typeof resolved === 'string' ? document.querySelector(resolved) : resolved;
        };
        const target = [
          previousFocus === document.body ? null : previousFocus,
          findFocusKeyTarget(previousKey),
          findTileFocusTarget(previousTile),
          fallback ? resolveFallback() : null,
        ].find(usable);
        if (!target) return;
        if (!canRestorePreviousFocus(targetModal)) return;
        target.focus();
      };
      // On the next tick, once whatever closed this dialog has finished with focus; or now as well
      // for a dialog that closed at once (the palette running a command that opens a pop-up), so
      // the pop-up finds focus back on the tile and returns there in turn.
      if (restoreNow) restore();
      setTimeout(restore, 0);
    }
  } catch (error) {
    console.error('Error releasing focus trap:', error);
  }
}

// ---------------------------------------------------------------------------------------------
// Dialog layers. Every dialog opens and closes through openDialog()/closeDialog(), which own the
// parts that must agree between dialogs: the ARIA role and name, the focus trap, where focus lands
// and returns to, which dialog Escape/Enter/backdrop act on, and stacking.
// ---------------------------------------------------------------------------------------------

let dialogLabelCounter = 0;

function ensureElementId(element, prefix) {
  if (!element.id) {
    dialogLabelCounter += 1;
    element.id = `${prefix}-${dialogLabelCounter}`;
  }
  return element.id;
}

function labelDialog(modal, { label, labelledBy }) {
  const requested =
    typeof labelledBy === 'string' ? document.getElementById(labelledBy) : labelledBy;
  if (requested) {
    modal.setAttribute('aria-labelledby', ensureElementId(requested, 'dialog-title'));
    return;
  }
  if (label) {
    modal.setAttribute('aria-label', label);
    modal.removeAttribute('aria-labelledby');
    return;
  }
  // A name that points at nothing (or at a whole content container) names nothing useful.
  const existing = modal.getAttribute('aria-labelledby');
  if (existing && document.getElementById(existing)) return;
  if (modal.getAttribute('aria-label')) return;
  const heading =
    modal.querySelector('.modal-header h1, .modal-header h2, .modal-header h3') ||
    modal.querySelector('h1, h2, h3');
  if (heading) modal.setAttribute('aria-labelledby', ensureElementId(heading, 'dialog-title'));
}

function describeDialog(modal, describedBy) {
  if (!describedBy) return;
  const ids = (Array.isArray(describedBy) ? describedBy : [describedBy])
    .map((node) => (typeof node === 'string' ? node : node && ensureElementId(node, 'dialog-desc')))
    .filter(Boolean);
  if (ids.length) modal.setAttribute('aria-describedby', ids.join(' '));
}

// Presses that start on the dialog and end on the backdrop (selecting text, dragging a slider
// past the edge) are not clicks on the backdrop, and must not dismiss it.
const dialogBackdropWired = new WeakSet();
function wireDialogBackdrop(modal) {
  if (dialogBackdropWired.has(modal)) return;
  dialogBackdropWired.add(modal);
  let pressStartedInside = false;
  modal.addEventListener('pointerdown', (event) => {
    pressStartedInside = event.target !== modal;
  });
  modal.addEventListener('click', (event) => {
    const startedInside = pressStartedInside;
    pressStartedInside = false;
    if (event.target !== modal || startedInside) return;
    const layer = dialogLayers.get(modal);
    if (!layer?.dismiss || !layer.dismissOnBackdrop || getTopFocusTrapModal() !== modal) return;
    void layer.dismiss('backdrop');
  });
}

// Keys that a control activates itself, so Enter there is that control's click and not the
// dialog's default action.
const ENTER_NATIVE_SELECTOR =
  'button, a[href], summary, select, textarea, [role="button"], [role="option"], [role="tab"], ' +
  'input[type="button"], input[type="submit"], input[type="checkbox"], input[type="radio"]';

/**
 * Send Escape and Enter to the top dialog, and only to it.
 *
 * One document-level listener instead of one per dialog, so a dialog that opens over another
 * (a confirmation over Settings) is the only one that hears the key, wherever focus happens to
 * be, and the dashboard behind never sees an Escape a dialog used. It runs after the controls
 * inside the dialog, so a dropdown, field or picker that handled the key itself (and called
 * preventDefault) keeps it.
 * @param {KeyboardEvent} event
 */
function routeDialogKeydown(event) {
  // An IME's last key can arrive after the composition has ended with isComposing already false;
  // keyCode 229 still marks it.
  if (event.defaultPrevented || event.isComposing || event.keyCode === 229) return;
  if (event.key !== 'Escape' && event.key !== 'Enter') return;
  const modal = getTopFocusTrapModal();
  const layer = modal && dialogLayers.get(modal);
  if (!layer) {
    if (!modal && event.key === 'Escape') dismissNewestToastForEscape(event);
    return;
  }
  // The key that opened this dialog is still on its way up to the document: it was meant for what
  // raised the dialog, so it must not answer the dialog that just appeared.
  if (event === layer.openingEvent) return;
  if (event.key === 'Escape') {
    if (!layer.dismiss) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    void layer.dismiss('escape');
    return;
  }
  if (!layer.onEnter || event.repeat || event.target?.closest?.(ENTER_NATIVE_SELECTOR)) return;
  event.preventDefault();
  void layer.onEnter(event);
}

let dialogKeyRouterInstalled = false;
function installDialogKeyRouter() {
  if (dialogKeyRouterInstalled || typeof document === 'undefined') return;
  dialogKeyRouterInstalled = true;
  document.addEventListener('keydown', routeDialogKeydown);
}

/**
 * Open a dialog: reveal it, give it its role, name and description, trap focus in it, move focus
 * to its first meaningful control, and make it the layer Escape, Enter and the backdrop act on.
 *
 * Opening over another dialog stacks above it, and closing returns focus to whatever opened it
 * (or `focusFallback` when that was rebuilt meanwhile). Pair with {@link closeDialog}.
 *
 * @param {HTMLElement} modal - The dialog overlay element (the `.modal` container).
 * @param {Object} [options] - Dialog behaviour.
 * @param {string|null} [options.display='flex'] - Inline display to write, or null to leave visibility to CSS.
 * @param {boolean} [options.alert=false] - Use role="alertdialog": a confirmation or error the user must answer.
 * @param {string} [options.label] - Accessible name when the dialog has no visible heading to point at.
 * @param {string|HTMLElement} [options.labelledBy] - Heading (or its id) that names the dialog; defaults to the first heading in the header.
 * @param {string|HTMLElement|Array} [options.describedBy] - Text (or its id) that describes the dialog, read after the name.
 * @param {HTMLElement|string|Function|false} [options.initialFocus] - First control to focus; defaults to the first one outside the header, or false to leave focus to the caller.
 * @param {HTMLElement|string|Function} [options.focusFallback] - Where focus returns if the opener was rebuilt and cannot be found.
 * @param {Function|null} [options.dismiss] - Called with 'escape' or 'backdrop' when the user dismisses this dialog; defaults to {@link closeDialog}. Null makes it undismissable.
 * @param {boolean} [options.dismissOnBackdrop=true] - False when only Escape and the buttons close it.
 * @param {Function} [options.onEnter] - Called when Enter is pressed outside a button or link, to run the dialog's default action.
 * @param {HTMLElement} [options.replaces] - A dialog being rebuilt in place (a pop-up that gains controls while open). The new one takes its place in the stack and its opener, skips the entry animation, and the caller removes the old element.
 */
function openDialog(modal, options = {}) {
  if (!modal || typeof modal.classList?.remove !== 'function') return;
  const {
    display = 'flex',
    alert = false,
    label,
    labelledBy,
    describedBy,
    initialFocus,
    focusFallback = null,
    dismissOnBackdrop = true,
    onEnter = null,
    replaces = null,
  } = options;
  const dismiss = 'dismiss' in options ? options.dismiss : () => closeDialog(modal);

  modal.setAttribute('role', alert ? 'alertdialog' : 'dialog');
  modal.setAttribute('aria-modal', 'true');
  labelDialog(modal, { label, labelledBy });
  describeDialog(modal, describedBy);

  const alreadyOpen = dialogLayers.has(modal) && isFocusTrapModalShown(modal);
  // The pop-up the user is looking at is rebuilt rather than opened: no second entrance, and the
  // old one's place in the stack and its opener carry over before it is released.
  const inheritedOpener = replaces ? focusTrapOpeners.get(replaces) : null;
  const inheritedDepth = replaces ? replaces.style.getPropertyValue('--dialog-depth') : '';
  if (replaces) {
    modal.classList.add('modal-rebuilt');
    releaseFocusTrap(replaces, { restoreFocus: false });
  }
  openModal(modal, { display });
  // A dialog raised from a keydown handler (Enter on a row, Escape on a field) is opened while that
  // very event is still being dispatched, so the router would otherwise hand it to the new dialog.
  const openingEvent = typeof window !== 'undefined' ? window.event : null;
  dialogLayers.set(modal, {
    dismiss,
    dismissOnBackdrop,
    onEnter,
    openingEvent: openingEvent?.type === 'keydown' ? openingEvent : null,
  });
  wireDialogBackdrop(modal);
  installDialogKeyRouter();

  if (alreadyOpen) {
    // Re-opened while showing (a second long-press): keep the opener it will return focus to. A
    // caller that took focus for itself (initialFocus: false) keeps it.
    if (initialFocus !== false) focusInitialControl(resolveInitialFocus(modal, initialFocus));
  } else {
    // Each dialog opened over another sits one step higher, so the newest is always on top
    // whatever order the elements happen to be in the document.
    const depth = Array.from(activeFocusTrapModals).reduce((highest, other) => {
      if (other === modal || !isFocusTrapModalShown(other)) return highest;
      return Math.max(highest, Number(other.style.getPropertyValue('--dialog-depth') || 0) + 1);
    }, 0);
    modal.style.setProperty('--dialog-depth', inheritedDepth || String(depth));
    trapFocus(modal, { initialFocus, focusFallback, opener: inheritedOpener });
  }
  watchDialogLayout(modal);
  layoutToasts();
}

/**
 * Close a dialog opened with {@link openDialog}: play the exit animation, release the focus trap
 * and return focus to the opener, then re-dock the toasts it was holding up.
 * @param {HTMLElement} modal - The dialog overlay element.
 * @param {Object} [options] - Close behaviour.
 * @param {boolean} [options.remove=false] - Remove the element instead of hiding it (dialogs built per open).
 * @param {boolean} [options.restoreFocus=true] - False when the caller moves focus itself.
 * @param {boolean} [options.animate=true] - False to hide at once, for overlays with no exit animation.
 * @param {Function} [options.onClosed] - Callback invoked after the dialog is hidden or removed.
 * @returns {Promise<void>} Resolves once the dialog has been hidden or removed.
 */
function closeDialog(
  modal,
  { remove = false, restoreFocus = true, animate = true, onClosed = null } = {}
) {
  const closed = closeModal(modal, {
    remove,
    releaseFocus: true,
    restoreFocus,
    animate,
    onClosed: () => {
      layoutToasts();
      onClosed?.();
    },
  });
  // The exit class is already on, so the footer being animated away no longer holds toasts up.
  layoutToasts();
  return closed;
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
  if (statusElement?.classList?.contains('connected')) return t('Real-time updates active.');
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

/**
 * Ask the user to confirm something, in the shared confirmation dialog.
 *
 * Focus starts on Cancel, so a stray Enter or Space declines. Enter elsewhere in the dialog
 * confirms; Escape and a click outside decline.
 *
 * @param {string} title - Dialog title.
 * @param {string|Node} message - What is being asked; also the dialog's accessible description. Text
 *   is shown as it is, with line breaks kept; a node (a fragment of rows, say) is shown as built, for
 *   a question with facts to read and one thing to heed.
 * @param {Object} [options] - Wording and behaviour.
 * @param {string} [options.confirmText] - Label of the confirm button.
 * @param {string} [options.cancelText] - Label of the cancel button.
 * @param {string} [options.confirmClass='btn-danger'] - Style class of the confirm button.
 * @param {string} [options.alternateText] - Adds a third choice with this label, for questions with
 *   two ways forward and a way back (save, discard, keep editing).
 * @param {string} [options.alternateClass='btn-secondary'] - Style class of the third button.
 * @param {boolean} [options.confirmFirst=false] - Start on the confirm button, for a question whose
 *   safe answer is yes. Only then does Enter outside a button confirm; otherwise it does just what
 *   the focused button does.
 * @param {HTMLElement|string|Function} [options.focusFallback] - Where focus goes afterwards if the
 *   control that raised the question is replaced meanwhile.
 * @returns {Promise<boolean|string>} True for confirm; false for cancel, Escape or a click outside;
 *   'alternate' for the third button.
 */
function showConfirm(title, message, options = {}) {
  return new Promise((resolve) => {
    try {
      const modal = document.getElementById('confirm-modal');
      const titleEl = document.getElementById('confirm-title');
      const messageEl = document.getElementById('confirm-message');
      const cancelBtn = document.getElementById('confirm-cancel-btn');
      const okBtn = document.getElementById('confirm-ok-btn');
      const alternateBtn = document.getElementById('confirm-alternate-btn');

      if (!modal || !titleEl || !messageEl || !cancelBtn || !okBtn) {
        console.error('Confirm modal elements not found');
        resolve(false);
        return;
      }

      // Set content
      titleEl.textContent = title || t('Confirm Action');
      if (message && typeof message === 'object' && typeof message.nodeType === 'number') {
        messageEl.replaceChildren(message);
      } else {
        messageEl.textContent = message || t('Are you sure?');
      }
      okBtn.textContent = options.confirmText || t('Confirm');
      cancelBtn.textContent = options.cancelText || t('Cancel');

      // Configure buttons
      okBtn.className = `btn ${options.confirmClass || 'btn-danger'}`;
      if (alternateBtn) {
        alternateBtn.hidden = !options.alternateText;
        alternateBtn.textContent = options.alternateText || '';
        alternateBtn.className = `btn ${options.alternateClass || 'btn-secondary'}`;
      }

      const settle = (result) => {
        cleanup();
        resolve(result);
      };
      const handleConfirm = () => settle(true);
      const handleCancel = () => settle(false);
      const handleAlternate = () => settle('alternate');

      const cleanup = () => {
        okBtn.removeEventListener('click', handleConfirm);
        cancelBtn.removeEventListener('click', handleCancel);
        alternateBtn?.removeEventListener('click', handleAlternate);
        void closeDialog(modal);
      };

      // Wire up events
      okBtn.addEventListener('click', handleConfirm);
      cancelBtn.addEventListener('click', handleCancel);
      alternateBtn?.addEventListener('click', handleAlternate);

      // Show modal. Enter on a focused button is that button's own click, so the dialog's Enter
      // (confirm) only applies elsewhere, and not while the key that opened it is held down. It
      // applies only to a question whose safe answer is yes: one that starts on Cancel is asking
      // about something that cannot be undone, and an Enter that lands on the message text (after
      // a click there) must not be the one that runs it.
      openDialog(modal, {
        alert: true,
        describedBy: messageEl,
        initialFocus: options.confirmFirst ? okBtn : cancelBtn,
        focusFallback: options.focusFallback,
        dismiss: handleCancel,
        onEnter: options.confirmFirst ? handleConfirm : null,
      });
    } catch (error) {
      console.error('Error showing confirm dialog:', error);
      resolve(false);
    }
  });
}

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
  showToast,
  copyTextToClipboard,
  dismissToast,
  dismissToasts,
  layoutToasts,
  closeModal,
  openModal,
  openDialog,
  closeDialog,
  hasOpenDialog,
  renderKeepingFocus,
  disableControlsKeepingFocus,
  findFocusKey,
  applyTheme,
  setCustomThemes,
  applyAccentTheme,
  applyAccentThemeFromColor,
  applyBackgroundTheme,
  applyBackgroundThemeFromColor,
  getAccentThemes,
  getBackgroundThemes,
  applyUiPreferences,
  setSeasonalColors,
  suspendSeasonalColors,
  getSeasonalColors,
  setUiPreferencesObserver,
  applyWindowEffects,
  isFrostedGlassAvailable,
  trapFocus,
  releaseFocusTrap,
  showLoading,
  initializeConnectionStatusTooltip,
  setStatus,
  showConfirm,
  hexToRgb,
  mixRgb,
  contrastBetween,
  getAccentHoverColor,
  getBackgroundWindowColor,
  getAccentTextOnDark,
  getAccentTextOnLight,
  getReadableTextColor,
  miredsToKelvin,
  hasSupportedFeature,
  __forceAnimatedModalTransitions,
};

/**
 * Colour maths: parsing hex colours, mixing them, WCAG contrast, and the accent colours the theme
 * and the tiles derive from a chosen colour (its label, hover fill, text and tone). Pure and
 * DOM-free, so callers and tests use it as it is and never need to replace it.
 */

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

/** A colour temperature in mireds as Kelvin, or null for anything but a positive number. */
function miredsToKelvin(mireds) {
  const value = Number(mireds);
  if (!Number.isFinite(value) || value <= 0) return null;
  return Math.round(1000000 / value);
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
// The hues of the alarm red and the warning amber of a tile that needs attention, and how close an
// accent's hue can come to one before a tile lit in it reads as that state. The red reaches further
// toward pink: Valentine's #ec4899, 34 degrees from it, lit an armed alarm a stronger pink-red than
// one that went off.
const ATTENTION_HUES = [
  { hue: 4, reach: 40 },
  { hue: 36, reach: 30 },
];

/** The hue of an {r, g, b} colour in degrees, 0 to 360 (0 for a grey). */
function hueOf({ r, g, b }) {
  const max = Math.max(r, g, b);
  const spread = max - Math.min(r, g, b);
  if (spread === 0) return 0;
  let sector;
  if (max === r) sector = (g - b) / spread;
  else if (max === g) sector = (b - r) / spread + 2;
  else sector = (r - g) / spread + 4;
  return (sector * 60 + 360) % 360;
}

/** Whether an accent's hue is close to the red or the amber of a tile that needs attention. */
function isWarmAccent(rgb) {
  const hue = hueOf(rgb);
  return ATTENTION_HUES.some((attention) => {
    const distance = Math.abs(hue - attention.hue) % 360;
    return Math.min(distance, 360 - distance) <= attention.reach;
  });
}

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
  for (let mix = isLightTheme ? 0.18 : 0.22; mix > 0; mix -= 0.02) {
    const hover = mixRgb(rgb, toward, mix);
    if (contrastBetween(label, hover) >= floor) return hover;
  }
  return rgb;
}

/**
 * How the stylesheet treats an accent: 'neutral' for a grey-ish one, which has no hue to tell a lit
 * tile's icon from an idle one; 'warm' for an orange, a red or a gold, which lit looks like a tile
 * that needs attention; 'cool' for the rest.
 * @param {{r:number, g:number, b:number}} rgb - Accent colour.
 * @returns {'neutral'|'warm'|'cool'}
 */
function getAccentTone(rgb) {
  const chroma = (Math.max(rgb.r, rgb.g, rgb.b) - Math.min(rgb.r, rgb.g, rgb.b)) / 255;
  if (chroma < NEUTRAL_ACCENT_CHROMA) return 'neutral';
  return isWarmAccent(rgb) ? 'warm' : 'cool';
}

/**
 * What a Quick Access tile needs to wear its own colour: the accent values applyAccentColor works
 * out for the window, solved for this colour and for both themes, as `--tile-*` custom properties.
 * The stylesheet maps them onto the tile's `--accent` family (picking the theme's text and hover
 * colours, and leaving them out under the Readable preset), so the tile's lit wash, its icon and
 * the controls inside it take the colour with the same contrast the accent gets.
 * @param {string} color - A hex colour.
 * @returns {{color: string, tone: 'neutral'|'warm'|'cool', properties: Object<string, string>}|null}
 *   Null for anything that is not a hex colour.
 */
function getTileColorStyle(color) {
  const normalizedColor = normalizeHexColor(color);
  const rgb = hexToRgb(normalizedColor);
  if (!normalizedColor || !rgb) return null;
  const onAccent = getReadableTextColor(rgb);
  const hoverDark = getAccentHoverColor(rgb, onAccent, false);
  const hoverLight = getAccentHoverColor(rgb, onAccent, true);
  return {
    color: normalizedColor,
    tone: getAccentTone(rgb),
    properties: {
      '--tile-accent': normalizedColor,
      '--tile-accent-rgb': `${rgb.r}, ${rgb.g}, ${rgb.b}`,
      '--tile-on-accent': onAccent,
      '--tile-accent-hover-dark': rgbString(hoverDark),
      '--tile-accent-hover-light': rgbString(hoverLight),
      '--tile-accent-text-dark': getAccentTextOnDark(rgb),
      '--tile-accent-text-dark-hover': getAccentTextOnDark(rgb, 6.5),
      '--tile-accent-text-light': getAccentTextOnLight(rgb),
      '--tile-accent-text-light-hover': getAccentTextOnLight(rgb, 6.5),
      '--tile-accent-ring-dark': getAccentTextOnDark(rgb, 3.2),
    },
  };
}

export {
  hexToRgb,
  normalizeHexColor,
  mixRgb,
  contrastBetween,
  getReadableTextColor,
  getAccentTextOnLight,
  getAccentTextOnDark,
  getAccentHoverColor,
  getAccentTone,
  getTileColorStyle,
  miredsToKelvin,
};

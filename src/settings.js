import state from './state.js';
import websocket from './websocket.js';
import {
  applyTheme,
  applyAccentTheme,
  applyAccentThemeFromColor,
  applyBackgroundTheme,
  applyBackgroundThemeFromColor,
  getAccentThemes,
  setCustomThemes,
  applyUiPreferences,
  applyWindowEffects,
  trapFocus,
  releaseFocusTrap,
  showToast,
  showConfirm,
} from './ui-utils.js';
import { cleanupHotkeyEventListeners } from './hotkeys.js';
import * as utils from './utils.js';
import {
  PRIMARY_CARD_DEFAULTS,
  PRIMARY_CARD_NONE,
  normalizePrimaryCards,
} from './primary-cards.js';
// Note: ui.js is imported dynamically to prevent circular dependencies

let previewState = null;
let previewRaf = null;
let previewAccent = null;
let pendingAccent = null;
let previewBackground = null;
let pendingBackground = null;
const COLOR_TARGETS = {
  accent: 'accent',
  background: 'background',
};
let activeColorTarget = COLOR_TARGETS.accent;
let themeTooltip = null;
let themeTooltipScrollBound = false;
let pendingPrimaryCards = null;
let pendingCustomColors = [];
let activeCustomManagementThemeId = null;
let isSyncingCustomColorEditor = false;
let lastValidCustomColorHex = '#64B5F6';
let hasDraftColorPreview = false;
const PERSONALIZATION_SECTION_STATE_KEY = 'personalizationSectionsCollapsed';
const CUSTOM_THEME_ID_PREFIX = 'custom-';

function normalizeHexColor(hex) {
  if (!hex || typeof hex !== 'string') return null;
  const normalized = hex.trim().replace('#', '');
  if (![3, 6].includes(normalized.length)) return null;
  if (!/^[0-9a-fA-F]+$/.test(normalized)) return null;
  const sixDigit = normalized.length === 3
    ? normalized.split('').map(ch => ch + ch).join('')
    : normalized;
  return `#${sixDigit.toUpperCase()}`;
}

function hexToRgb(hex) {
  const normalized = normalizeHexColor(hex);
  if (!normalized) return null;
  const value = normalized.slice(1);
  return {
    r: Number.parseInt(value.slice(0, 2), 16),
    g: Number.parseInt(value.slice(2, 4), 16),
    b: Number.parseInt(value.slice(4, 6), 16),
  };
}

function clampRgbChannel(value) {
  if (!Number.isFinite(value)) return null;
  return Math.max(0, Math.min(255, Math.round(value)));
}

function rgbToHex(r, g, b) {
  const channels = [r, g, b].map(value => clampRgbChannel(value));
  if (channels.some(channel => channel === null)) return null;
  const [safeR, safeG, safeB] = channels;
  return `#${safeR.toString(16).padStart(2, '0')}${safeG.toString(16).padStart(2, '0')}${safeB.toString(16).padStart(2, '0')}`.toUpperCase();
}

function buildCustomColorId(seed = '') {
  const cleanedSeed = String(seed || 'color').replace(/[^a-zA-Z0-9]+/g, '').toLowerCase();
  const suffix = Math.random().toString(36).slice(2, 8);
  return `${CUSTOM_THEME_ID_PREFIX}${cleanedSeed || 'color'}-${suffix}`;
}

function normalizeCustomColorList(customColors) {
  if (!Array.isArray(customColors)) return [];

  const seenIds = new Set();
  const seenColors = new Set();

  return customColors.reduce((acc, entry, index) => {
    if (!entry || typeof entry !== 'object') return acc;
    const color = normalizeHexColor(entry.color);
    if (!color || seenColors.has(color)) return acc;

    const providedId = typeof entry.id === 'string' ? entry.id.trim() : '';
    let id = providedId || buildCustomColorId(color.slice(1));
    while (!id || seenIds.has(id)) {
      id = buildCustomColorId(`${color.slice(1)}${index}`);
    }

    const createdAt = (typeof entry.createdAt === 'string' && entry.createdAt.trim())
      ? entry.createdAt
      : new Date().toISOString();
    const updatedAt = (typeof entry.updatedAt === 'string' && entry.updatedAt.trim())
      ? entry.updatedAt
      : createdAt;
    const name = (typeof entry.name === 'string' && entry.name.trim())
      ? entry.name.trim()
      : `Custom ${color}`;

    seenIds.add(id);
    seenColors.add(color);
    acc.push({
      id,
      name,
      color,
      createdAt,
      updatedAt,
    });
    return acc;
  }, []);
}

function getSavedCustomColors() {
  return normalizeCustomColorList(state.CONFIG?.ui?.customColors);
}

function setPendingCustomColorList(customColors) {
  pendingCustomColors = normalizeCustomColorList(customColors);
  setCustomThemes(pendingCustomColors);
}

function getCustomColorsForSave() {
  return pendingCustomColors.map(color => ({
    id: color.id,
    name: color.name,
    color: color.color,
    createdAt: color.createdAt,
    updatedAt: color.updatedAt,
  }));
}

function getThemeById(themeId) {
  if (!themeId) return null;
  return getAccentThemes().find(theme => theme.id === themeId) || null;
}

function getCustomColorEditorElements() {
  return {
    picker: document.getElementById('custom-color-picker'),
    rInput: document.getElementById('custom-color-r'),
    gInput: document.getElementById('custom-color-g'),
    bInput: document.getElementById('custom-color-b'),
    hexInput: document.getElementById('custom-color-hex'),
    saveBtn: document.getElementById('save-custom-color-btn'),
    managementRow: document.getElementById('custom-theme-management'),
    nameInput: document.getElementById('custom-color-name-input'),
    renameBtn: document.getElementById('rename-custom-color-btn'),
    removeBtn: document.getElementById('remove-custom-color-btn'),
  };
}

function setCustomColorEditorValues(hex) {
  const normalized = normalizeHexColor(hex);
  if (!normalized) return;
  const rgb = hexToRgb(normalized);
  if (!rgb) return;

  const { picker, rInput, gInput, bInput, hexInput } = getCustomColorEditorElements();
  isSyncingCustomColorEditor = true;
  if (picker) picker.value = normalized.toLowerCase();
  if (rInput) rInput.value = `${rgb.r}`;
  if (gInput) gInput.value = `${rgb.g}`;
  if (bInput) bInput.value = `${rgb.b}`;
  if (hexInput) hexInput.value = normalized;
  isSyncingCustomColorEditor = false;
  lastValidCustomColorHex = normalized;
}

function getCustomColorHexFromEditor() {
  const { rInput, gInput, bInput, hexInput } = getCustomColorEditorElements();
  const fromHexInput = normalizeHexColor(hexInput?.value);
  if (fromHexInput) return fromHexInput;

  const parseChannel = (input) => {
    if (!input) return null;
    const raw = (input.value || '').trim();
    if (!raw) return null;
    const parsed = Number.parseInt(raw, 10);
    if (Number.isNaN(parsed)) return null;
    return clampRgbChannel(parsed);
  };

  const r = parseChannel(rInput);
  const g = parseChannel(gInput);
  const b = parseChannel(bInput);
  if (r === null || g === null || b === null) return null;
  return rgbToHex(r, g, b);
}

function applyCustomColorPreview(hex) {
  const normalized = normalizeHexColor(hex);
  if (!normalized) return;
  hasDraftColorPreview = true;

  if (activeColorTarget === COLOR_TARGETS.background) {
    applyBackgroundThemeFromColor(normalized);
  } else {
    applyAccentThemeFromColor(normalized);
  }
}

function getSelectedThemeForActiveTarget() {
  return getThemeById(getPendingTheme(activeColorTarget));
}

function updateCustomThemeManagementUI(theme = null) {
  const selectedTheme = theme || getSelectedThemeForActiveTarget();
  const isCustomTheme = !!selectedTheme?.isCustom;
  const { managementRow, nameInput, renameBtn, removeBtn } = getCustomColorEditorElements();

  if (managementRow) {
    managementRow.classList.toggle('hidden', !isCustomTheme);
  }
  if (renameBtn) renameBtn.disabled = !isCustomTheme;
  if (removeBtn) removeBtn.disabled = !isCustomTheme;

  if (!isCustomTheme) {
    activeCustomManagementThemeId = null;
    if (nameInput) nameInput.value = '';
    return;
  }

  if (nameInput && activeCustomManagementThemeId !== selectedTheme.id) {
    nameInput.value = selectedTheme.name || '';
  }
  activeCustomManagementThemeId = selectedTheme.id;
}

function syncCustomColorEditorFromSelectedTheme() {
  const selectedTheme = getSelectedThemeForActiveTarget();
  const selectedHex = normalizeHexColor(selectedTheme?.color);
  if (selectedHex) {
    setCustomColorEditorValues(selectedHex);
  } else {
    setCustomColorEditorValues(lastValidCustomColorHex);
  }
  updateCustomThemeManagementUI(selectedTheme);
}

function selectThemeForActiveTarget(themeId) {
  if (activeColorTarget === COLOR_TARGETS.background) {
    selectBackgroundTheme(themeId, { preview: true });
  } else {
    selectAccentTheme(themeId, { preview: true });
  }
}

function saveCustomColorFromEditor() {
  const color = getCustomColorHexFromEditor();
  if (!color) {
    showToast('Enter a valid color before saving.', 'warning', 2500);
    return;
  }

  const existing = pendingCustomColors.find(entry => entry.color === color);
  if (existing) {
    selectThemeForActiveTarget(existing.id);
    renderColorThemeOptions();
    showToast('Color already saved. Selected existing custom color.', 'info', 2200);
    return;
  }

  const timestamp = new Date().toISOString();
  const customColor = {
    id: buildCustomColorId(color.slice(1)),
    name: `Custom ${color}`,
    color,
    createdAt: timestamp,
    updatedAt: timestamp,
  };

  pendingCustomColors = [...pendingCustomColors, customColor];
  setCustomThemes(pendingCustomColors);
  selectThemeForActiveTarget(customColor.id);
  renderColorThemeOptions();
  showToast('Custom color saved.', 'success', 2000);
}

function renameSelectedCustomColor() {
  const selectedTheme = getSelectedThemeForActiveTarget();
  if (!selectedTheme?.isCustom) return;

  const { nameInput } = getCustomColorEditorElements();
  if (!nameInput) return;

  const nextName = (nameInput.value || '').trim();
  if (!nextName) {
    nameInput.value = selectedTheme.name || '';
    return;
  }

  pendingCustomColors = pendingCustomColors.map(entry => {
    if (entry.id !== selectedTheme.id) return entry;
    return {
      ...entry,
      name: nextName,
      updatedAt: new Date().toISOString(),
    };
  });

  setCustomThemes(pendingCustomColors);
  renderColorThemeOptions();
  showToast('Custom color renamed.', 'success', 1800);
}

function removeSelectedCustomColor() {
  const selectedTheme = getSelectedThemeForActiveTarget();
  if (!selectedTheme?.isCustom) return;

  pendingCustomColors = pendingCustomColors.filter(entry => entry.id !== selectedTheme.id);
  setCustomThemes(pendingCustomColors);

  if (pendingAccent === selectedTheme.id) {
    pendingAccent = resolveThemeId(null);
    applyAccentTheme(pendingAccent);
  }
  if (pendingBackground === selectedTheme.id) {
    pendingBackground = resolveThemeId(null, { preferSlate: true });
    applyBackgroundTheme(pendingBackground);
  }

  renderColorThemeOptions();
  showToast('Custom color removed.', 'success', 1800);
}

function initCustomColorEditor() {
  const { picker, rInput, gInput, bInput, hexInput, saveBtn, nameInput, renameBtn, removeBtn } = getCustomColorEditorElements();

  if (picker) {
    picker.oninput = () => {
      if (isSyncingCustomColorEditor) return;
      const normalized = normalizeHexColor(picker.value);
      if (!normalized) return;
      setCustomColorEditorValues(normalized);
      applyCustomColorPreview(normalized);
    };
  }

  const handleRgbInput = () => {
    if (isSyncingCustomColorEditor) return;
    const color = getCustomColorHexFromEditor();
    if (!color) return;
    setCustomColorEditorValues(color);
    applyCustomColorPreview(color);
  };

  [rInput, gInput, bInput].forEach(input => {
    if (!input) return;
    input.oninput = handleRgbInput;
    input.onblur = () => {
      const parsed = Number.parseInt(input.value, 10);
      if (Number.isNaN(parsed)) {
        setCustomColorEditorValues(lastValidCustomColorHex);
        return;
      }
      input.value = `${clampRgbChannel(parsed)}`;
      handleRgbInput();
    };
  });

  if (hexInput) {
    hexInput.oninput = () => {
      if (isSyncingCustomColorEditor) return;
      const normalized = normalizeHexColor(hexInput.value);
      if (!normalized) return;
      setCustomColorEditorValues(normalized);
      applyCustomColorPreview(normalized);
    };
    hexInput.onblur = () => {
      const normalized = normalizeHexColor(hexInput.value);
      if (!normalized) {
        setCustomColorEditorValues(lastValidCustomColorHex);
        return;
      }
      setCustomColorEditorValues(normalized);
    };
  }

  if (saveBtn) {
    saveBtn.onclick = saveCustomColorFromEditor;
  }

  if (renameBtn) {
    renameBtn.onclick = renameSelectedCustomColor;
  }

  if (nameInput) {
    nameInput.onkeydown = (event) => {
      if (event.key !== 'Enter') return;
      event.preventDefault();
      renameSelectedCustomColor();
    };
  }

  if (removeBtn) {
    removeBtn.onclick = removeSelectedCustomColor;
  }

  syncCustomColorEditorFromSelectedTheme();
}


/**
 * Resolve a valid accent theme id from a candidate, with optional preference for the 'slate' theme.
 *
 * If the provided `themeId` is a known theme id it is returned. If `themeId` is `'sky'`, it maps to
 * the `'original'` theme when available. When `preferSlate` is true the function prefers `'slate'`,
 * then `'original'`, then the first available theme; otherwise it prefers `'original'` then the
 * first available theme. Always falls back to `'original'` if no themes are available.
 * @param {string|undefined|null} themeId - Candidate theme id to validate or resolve.
 * @param {{preferSlate?: boolean}=} options - Resolution options.
 * @param {boolean} [options.preferSlate=false] - When true prefer the `slate` theme over `original`.
 * @return {string} The resolved valid theme id.
 */
function resolveThemeId(themeId, { preferSlate = false } = {}) {
  const themes = getAccentThemes();
  const validIds = new Set(themes.map(theme => theme.id));
  if (themeId && validIds.has(themeId)) return themeId;
  if (themeId === 'sky') {
    const original = themes.find(theme => theme.id === 'original')?.id;
    if (original) return original;
  }
  if (preferSlate) {
    return themes.find(theme => theme.id === 'slate')?.id || themes.find(theme => theme.id === 'original')?.id || themes[0]?.id || 'original';
  }
  return themes.find(theme => theme.id === 'original')?.id || themes[0]?.id || 'original';
}

/**
 * Get the current accent theme id from the configuration or a resolved default.
 * @returns {string} The configured accent theme id, or the resolved fallback theme id.
 */
function getCurrentAccentTheme() {
  const fallback = resolveThemeId(null);
  return state.CONFIG?.ui?.accent || fallback;
}

/**
 * Determine the current background theme ID, falling back to a preferred default.
 * @returns {string} The background theme id from configuration, or a resolved default if not set.
 */
function getCurrentBackgroundTheme() {
  const fallback = resolveThemeId(null, { preferSlate: true });
  return state.CONFIG?.ui?.background || fallback;
}

/**
 * Get the currently pending theme id for the specified color target, or the active theme id if none is pending.
 * @param {string} target - Color target, either COLOR_TARGETS.accent or COLOR_TARGETS.background.
 * @returns {string} The pending theme id for the target, or the current theme id if no pending selection exists.
 */
function getPendingTheme(target) {
  if (target === COLOR_TARGETS.background) {
    return pendingBackground || getCurrentBackgroundTheme();
  }
  return pendingAccent || getCurrentAccentTheme();
}

/**
 * Selects an accent theme as the pending choice and updates the UI accordingly.
 *
 * Sets the pending accent theme to the resolved theme for `accentKey`, optionally applies it as a live preview, and refreshes theme selection visuals and the summary text.
 *
 * @param {string} accentKey - Identifier or key of the accent theme to select.
 * @param {{preview?: boolean}} [options] - Selection options.
 * @param {boolean} [options.preview=true] - If `true`, apply the selected accent immediately as a live preview.
 */
function selectAccentTheme(accentKey, { preview = true } = {}) {
  const resolvedAccent = resolveThemeId(accentKey);
  pendingAccent = resolvedAccent;
  hasDraftColorPreview = false;
  if (preview) {
    applyAccentTheme(resolvedAccent);
  }
  if (activeColorTarget === COLOR_TARGETS.accent) {
    updateThemeSelectionUI();
    syncCustomColorEditorFromSelectedTheme();
  }
  updateThemeSummary();
}

/**
 * Selects a background color theme and updates the pending state and UI.
 *
 * Sets the pending background theme, optionally applies it as a live preview, and refreshes
 * the theme selection UI and summary text.
 *
 * @param {string} backgroundKey - The identifier of the background theme to select.
 * @param {Object} [options] - Optional settings.
 * @param {boolean} [options.preview=true] - If true, apply the selected background as a live preview.
 */
function selectBackgroundTheme(backgroundKey, { preview = true } = {}) {
  const resolvedBackground = resolveThemeId(backgroundKey, { preferSlate: true });
  pendingBackground = resolvedBackground;
  hasDraftColorPreview = false;
  if (preview) {
    applyBackgroundTheme(resolvedBackground);
  }
  if (activeColorTarget === COLOR_TARGETS.background) {
    updateThemeSelectionUI();
    syncCustomColorEditorFromSelectedTheme();
  }
  updateThemeSummary();
}

/**
 * Update the visual selection and ARIA state of theme option buttons to match the pending theme for the active color target.
 *
 * Finds elements with the `color-theme-option` class and toggles their `selected` class and `aria-checked` attribute based on the currently pending theme.
 */
function updateThemeSelectionUI() {
  const selectedTheme = getPendingTheme(activeColorTarget);
  const options = document.querySelectorAll('.color-theme-option');
  options.forEach(option => {
    const isSelected = option.dataset.theme === selectedTheme;
    option.classList.toggle('selected', isSelected);
    option.setAttribute('aria-checked', isSelected ? 'true' : 'false');
  });
}

/**
 * Update the theme options label to indicate whether Accent or Background colors are active.
 *
 * Sets the element with id "theme-options-label" to "Color Options (Accent)" or
 * "Color Options (Background)" based on the current active color target. Does nothing if the label element is not present.
 */
function updateThemeOptionsLabel() {
  const label = document.getElementById('theme-options-label');
  if (!label) return;
  const labelTarget = activeColorTarget === COLOR_TARGETS.background ? 'Background' : 'Accent';
  label.textContent = `Color Options (${labelTarget})`;
}

/**
 * Update the visible summary text to show the current accent and background theme names.
 *
 * Looks up the pending accent and background theme ids, uses their display names when available,
 * and sets the textContent of the element with id "theme-current-selection". If a theme id
 * cannot be resolved, the name "Custom" is used as a fallback.
 */
function updateThemeSummary() {
  const summary = document.getElementById('theme-current-selection');
  if (!summary) return;
  const themes = getAccentThemes();
  const accentName = themes.find(theme => theme.id === getPendingTheme(COLOR_TARGETS.accent))?.name || 'Custom';
  const backgroundName = themes.find(theme => theme.id === getPendingTheme(COLOR_TARGETS.background))?.name || 'Custom';
  summary.textContent = `Accent: ${accentName} • Background: ${backgroundName}`;
}

/**
 * Set which color target (accent or background) is active for the theme options UI.
 * @param {string} target - Desired color target; expected values are `"accent"` or `"background"`. Any other value selects `"accent"`. 
 */
function setActiveColorTarget(target) {
  activeColorTarget = target === COLOR_TARGETS.background ? COLOR_TARGETS.background : COLOR_TARGETS.accent;
  renderColorThemeOptions();
}

/**
 * Create and initialize the theme tooltip flyout and return its DOM element.
 *
 * If the tooltip already exists this returns the existing element. When first created,
 * the tooltip is appended to document.body and a scroll listener is bound to the
 * settings modal body to hide the tooltip on scroll.
 *
 * @returns {HTMLElement} The tooltip DOM element used for theme previews.
 */
function ensureThemeTooltip() {
  if (themeTooltip) return themeTooltip;
  const tooltip = document.createElement('div');
  tooltip.id = 'theme-tooltip-flyout';
  tooltip.className = 'theme-tooltip-flyout';
  tooltip.setAttribute('role', 'tooltip');
  tooltip.setAttribute('aria-hidden', 'true');
  tooltip.innerHTML = `
    <span class="theme-tooltip-name"></span>
    <span class="theme-tooltip-note"></span>
  `;
  document.body.appendChild(tooltip);
  themeTooltip = tooltip;

  if (!themeTooltipScrollBound) {
    const modalBody = document.querySelector('#settings-modal .modal-body');
    if (modalBody) {
      modalBody.addEventListener('scroll', hideThemeTooltip, { passive: true });
      themeTooltipScrollBound = true;
    }
  }

  return tooltip;
}

/**
 * Position the theme tooltip relative to a target element.
 *
 * Computes whether the tooltip should be placed above or below the target based on available space,
 * clamps horizontal placement within the viewport with a padding margin, sets the tooltip's `top`
 * and `left` CSS properties, and records the chosen placement in `dataset.placement`.
 * @param {Element} target - The DOM element to anchor the tooltip to.
 */
function positionThemeTooltip(target) {
  if (!themeTooltip || !target) return;
  const rect = target.getBoundingClientRect();
  const tooltipRect = themeTooltip.getBoundingClientRect();
  const padding = 12;
  const preferredTop = rect.top - tooltipRect.height - 12;
  const placeBelow = preferredTop < padding;
  const top = placeBelow ? rect.bottom + 12 : preferredTop;
  let left = rect.left + rect.width / 2 - tooltipRect.width / 2;
  left = Math.max(padding, Math.min(left, window.innerWidth - tooltipRect.width - padding));
  themeTooltip.style.top = `${top}px`;
  themeTooltip.style.left = `${left}px`;
  themeTooltip.dataset.placement = placeBelow ? 'bottom' : 'top';
}

/**
 * Display the theme tooltip populated with the given title and note.
 *
 * If a target element is provided, the tooltip will copy its `--swatch` and
 * `--swatch-rgb` CSS custom properties when present and will be positioned
 * relative to the target.
 *
 * @param {HTMLElement|null} target - Element the tooltip should reference/anchor to, or `null` to show without swatch/anchor.
 * @param {string} name - Title text to display in the tooltip.
 * @param {string} note - Supplemental note text to display in the tooltip.
 */
function showThemeTooltip(target, name, note) {
  const tooltip = ensureThemeTooltip();
  const nameEl = tooltip.querySelector('.theme-tooltip-name');
  const noteEl = tooltip.querySelector('.theme-tooltip-note');
  if (nameEl) nameEl.textContent = name;
  if (noteEl) noteEl.textContent = note;
  if (target) {
    const computed = window.getComputedStyle(target);
    const swatch = computed.getPropertyValue('--swatch').trim();
    const swatchRgb = computed.getPropertyValue('--swatch-rgb').trim();
    if (swatch) {
      tooltip.style.setProperty('--swatch', swatch);
    }
    if (swatchRgb) {
      tooltip.style.setProperty('--swatch-rgb', swatchRgb);
    }
  }
  tooltip.classList.add('visible');
  tooltip.setAttribute('aria-hidden', 'false');
  positionThemeTooltip(target);
}

/**
 * Hide the theme tooltip and update its accessibility state.
 *
 * If a tooltip exists, it will be hidden from view and marked with `aria-hidden="true"` for assistive technologies.
 */
function hideThemeTooltip() {
  if (!themeTooltip) return;
  themeTooltip.classList.remove('visible');
  themeTooltip.setAttribute('aria-hidden', 'true');
}

/**
 * Apply the pending background theme if present, otherwise apply the currently selected background theme.
 */
function refreshBackgroundTheme() {
  applyBackgroundTheme(pendingBackground || getCurrentBackgroundTheme());
}

/**
 * Render interactive color theme option buttons for the currently active color target.
 *
 * Clears and populates the #theme-options container with a button for each available theme.
 * Each option includes a visual swatch, appropriate ARIA attributes, and event listeners to:
 * - apply the theme as a pending preview when clicked,
 * - show and position a tooltip on hover/focus/mousemove,
 * - hide the tooltip on blur/leave.
 *
 * Does nothing if the theme options container is not present in the DOM. Updates the theme
 * options label and the summary text after rendering.
 */
function renderColorThemeOptions() {
  const container = document.getElementById('theme-options');
  if (!container) return;

  container.innerHTML = '';
  const themes = getAccentThemes();
  const selectedTheme = getPendingTheme(activeColorTarget);

  themes.forEach(theme => {
    const option = document.createElement('button');
    option.type = 'button';
    option.className = 'theme-option color-theme-option';
    option.dataset.theme = theme.id;
    option.dataset.customTheme = theme.isCustom ? 'true' : 'false';
    const isOriginalTheme = theme.id === 'original';
    const isBackgroundTarget = activeColorTarget === COLOR_TARGETS.background;
    const tooltipName = theme.name;
    const tooltipDescription = isOriginalTheme
      ? (isBackgroundTarget ? 'Original dark base (no tint)' : 'Original accent blue')
      : (theme.description || (theme.isCustom ? 'Saved custom color' : 'Theme color'));
    option.setAttribute('role', 'radio');
    option.setAttribute('aria-label', `${tooltipName}. ${tooltipDescription}`);
    option.setAttribute('aria-checked', theme.id === selectedTheme ? 'true' : 'false');
    if (theme.id === selectedTheme) {
      option.classList.add('selected');
    }

    if (isOriginalTheme && isBackgroundTarget) {
      const isLightTheme = document.body?.classList.contains('theme-light');
      const swatchRgb = isLightTheme ? '250, 250, 250' : '40, 40, 45';
      const swatchHex = isLightTheme ? '#fafafa' : '#28282d';
      option.style.setProperty('--swatch', swatchHex);
      option.style.setProperty('--swatch-rgb', swatchRgb);
    } else {
      if (theme.color) {
        option.style.setProperty('--swatch', theme.color);
      }
      if (theme.rgb) {
        option.style.setProperty('--swatch-rgb', theme.rgb);
      }
    }

    const swatch = document.createElement('span');
    swatch.className = 'accent-theme-swatch';
    option.appendChild(swatch);

    option.addEventListener('click', () => {
      if (activeColorTarget === COLOR_TARGETS.background) {
        selectBackgroundTheme(theme.id, { preview: true });
      } else {
        selectAccentTheme(theme.id, { preview: true });
      }
    });
    option.addEventListener('mouseenter', () => {
      showThemeTooltip(option, tooltipName, tooltipDescription);
    });
    option.addEventListener('mouseleave', hideThemeTooltip);
    option.addEventListener('focus', () => {
      showThemeTooltip(option, tooltipName, tooltipDescription);
    });
    option.addEventListener('blur', hideThemeTooltip);
    option.addEventListener('mousemove', () => {
      positionThemeTooltip(option);
    });

    container.appendChild(option);
  });

  updateThemeOptionsLabel();
  updateThemeSummary();
  syncCustomColorEditorFromSelectedTheme();
  syncPersonalizationSectionHeight(document.getElementById('color-themes-section'));
}

/**
 * Initialize the "color-target-select" dropdown and bind its change handler to update the active color target.
 *
 * Sets the select's value to the current activeColorTarget and calls setActiveColorTarget when the user changes selection.
 */
function initColorTargetSelect() {
  const select = document.getElementById('color-target-select');
  if (!select) return;
  select.value = activeColorTarget;
  select.onchange = (e) => {
    setActiveColorTarget(e.target.value);
  };
}

function getSavedPersonalizationSectionStates() {
  const savedStates = state.CONFIG?.ui?.[PERSONALIZATION_SECTION_STATE_KEY];
  if (!savedStates || typeof savedStates !== 'object') return {};
  return savedStates;
}

function applyPersonalizationSectionState(section, toggle, isCollapsed) {
  section.classList.toggle('collapsed', isCollapsed);
  toggle.setAttribute('aria-expanded', isCollapsed ? 'false' : 'true');
}

function persistPersonalizationSectionState(sectionId, isCollapsed) {
  if (!sectionId || !state.CONFIG) return;

  state.CONFIG.ui = state.CONFIG.ui || {};
  const currentStates = getSavedPersonalizationSectionStates();
  if (currentStates[sectionId] === isCollapsed) return;

  const nextStates = {
    ...currentStates,
    [sectionId]: isCollapsed,
  };

  state.CONFIG.ui[PERSONALIZATION_SECTION_STATE_KEY] = nextStates;

  if (!window?.electronAPI?.updateConfig) return;
  window.electronAPI.updateConfig({
    ui: {
      ...state.CONFIG.ui,
      [PERSONALIZATION_SECTION_STATE_KEY]: nextStates,
    },
  }).catch(error => {
    console.error('Failed to persist personalization section state:', error);
  });
}

/**
 * Initialize the color themes section toggle: ensure the section is expanded and wire the toggle button to collapse/expand it.
 *
 * If the section or toggle elements are not present in the DOM, the function no-ops.
 */
function initColorThemeSectionToggle() {
  const sections = document.querySelectorAll('.personalization-section');
  if (!sections.length) return;
  const savedSectionStates = getSavedPersonalizationSectionStates();

  sections.forEach(section => {
    const toggle = section.querySelector('.section-toggle');
    if (!toggle) return;

    const hasSavedState = Object.prototype.hasOwnProperty.call(savedSectionStates, section.id);
    const isCollapsed = hasSavedState ? !!savedSectionStates[section.id] : section.classList.contains('collapsed');
    applyPersonalizationSectionState(section, toggle, isCollapsed);
    syncPersonalizationSectionHeight(section);

    toggle.onclick = () => {
      syncPersonalizationSectionHeight(section);
      const nextCollapsed = !section.classList.contains('collapsed');
      applyPersonalizationSectionState(section, toggle, nextCollapsed);
      persistPersonalizationSectionState(section.id, nextCollapsed);
    };
  });
}

function syncPersonalizationSectionHeight(section) {
  if (!section) return;
  const body = section.querySelector('.section-body');
  if (!body) return;
  const height = body.scrollHeight;
  if (!height) return;
  const nextValue = `${height}px`;
  if (section.style.getPropertyValue('--section-body-height') !== nextValue) {
    section.style.setProperty('--section-body-height', nextValue);
  }
}

function schedulePersonalizationSectionHeightSync(sourceEl) {
  const section = sourceEl?.closest?.('.personalization-section');
  if (!section) return;
  requestAnimationFrame(() => {
    syncPersonalizationSectionHeight(section);
  });
}

function getPendingPrimaryCards() {
  return normalizePrimaryCards(pendingPrimaryCards || state.CONFIG?.primaryCards);
}

function getPrimaryCardEntityOptions(filter = '') {
  const normalizedFilter = filter.toLowerCase();
  return Object.values(state.STATES || {})
    .filter(entity => !entity.entity_id.startsWith('sun.') && !entity.entity_id.startsWith('zone.'))
    .map(entity => {
      if (!normalizedFilter) return { entity, score: 1 };
      const nameScore = utils.getSearchScore(utils.getEntityDisplayName(entity), normalizedFilter);
      const idScore = utils.getSearchScore(entity.entity_id, normalizedFilter);
      return { entity, score: nameScore + idScore };
    })
    .filter(item => item.score > 0)
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      return utils.getEntityDisplayName(a.entity).localeCompare(utils.getEntityDisplayName(b.entity));
    });
}

function getPrimaryCardDisplay(selection) {
  if (selection === PRIMARY_CARD_NONE) return 'Hidden';
  if (selection === 'weather') return 'Weather (default)';
  if (selection === 'time') return 'Time (default)';
  const entity = state.STATES?.[selection];
  if (entity) return `${utils.getEntityDisplayName(entity)} (${selection})`;
  return `Unavailable: ${selection}`;
}

function updatePrimaryCardSummary() {
  const selections = getPendingPrimaryCards();
  const cardOne = document.getElementById('primary-card-1-current');
  const cardTwo = document.getElementById('primary-card-2-current');
  if (cardOne) cardOne.textContent = getPrimaryCardDisplay(selections[0]);
  if (cardTwo) cardTwo.textContent = getPrimaryCardDisplay(selections[1]);
}

function updatePrimaryCardActionButtons() {
  const selections = getPendingPrimaryCards();
  document.querySelectorAll('[data-primary-card][data-primary-value]').forEach(btn => {
    const cardIndex = Number(btn.dataset.primaryCard);
    const value = btn.dataset.primaryValue;
    const isActive = selections[cardIndex] === value;
    btn.classList.toggle('btn-primary', isActive);
    btn.classList.toggle('btn-secondary', !isActive);
  });
}

function renderPrimaryCardsEntityList() {
  const list = document.getElementById('primary-cards-list');
  const searchInput = document.getElementById('primary-cards-search');
  if (!list || !searchInput) return;

  const filter = searchInput.value || '';
  const selections = getPendingPrimaryCards();
  const scoredEntities = getPrimaryCardEntityOptions(filter);

  list.innerHTML = '';

  if (!scoredEntities.length) {
    list.innerHTML = '<div class="no-entities-message">No matching entities found.</div>';
    return;
  }

  scoredEntities.forEach(({ entity }) => {
    const item = document.createElement('div');
    item.className = 'entity-item';

    const icon = utils.escapeHtml(utils.getEntityIcon(entity));
    const displayName = utils.escapeHtml(utils.getEntityDisplayName(entity));
    const entityId = utils.escapeHtml(entity.entity_id);

    const isCardOne = selections[0] === entity.entity_id;
    const isCardTwo = selections[1] === entity.entity_id;

    const cardOneLabel = isCardOne ? 'Card 1 ✓' : 'Set Card 1';
    const cardTwoLabel = isCardTwo ? 'Card 2 ✓' : 'Set Card 2';
    const cardOneClass = isCardOne ? 'btn btn-primary btn-sm' : 'btn btn-secondary btn-sm';
    const cardTwoClass = isCardTwo ? 'btn btn-primary btn-sm' : 'btn btn-secondary btn-sm';
    const cardOneDisabled = isCardOne ? 'disabled' : '';
    const cardTwoDisabled = isCardTwo ? 'disabled' : '';

    item.innerHTML = `
      <div class="entity-item-main">
        <span class="entity-icon">${icon}</span>
        <div class="entity-item-info">
          <span class="entity-name">${displayName}</span>
          <span class="entity-id" title="${entityId}">${entityId}</span>
        </div>
      </div>
      <div class="primary-cards-list-actions">
        <button class="${cardOneClass}" type="button" data-primary-assign="0" data-entity-id="${entityId}" ${cardOneDisabled}>${cardOneLabel}</button>
        <button class="${cardTwoClass}" type="button" data-primary-assign="1" data-entity-id="${entityId}" ${cardTwoDisabled}>${cardTwoLabel}</button>
      </div>
    `;

    list.appendChild(item);
  });

  syncPersonalizationSectionHeight(document.getElementById('primary-cards-section'));
}

function setPendingPrimaryCards(value) {
  pendingPrimaryCards = normalizePrimaryCards(value);
  updatePrimaryCardSummary();
  updatePrimaryCardActionButtons();
  renderPrimaryCardsEntityList();
}

function initPrimaryCardsUI() {
  const section = document.getElementById('primary-cards-section');
  if (!section || section.dataset.initialized) return;

  const resetBtn = document.getElementById('primary-cards-reset');
  if (resetBtn) {
    resetBtn.addEventListener('click', () => {
      setPendingPrimaryCards(PRIMARY_CARD_DEFAULTS);
    });
  }

  section.addEventListener('click', (event) => {
    const actionBtn = event.target.closest('[data-primary-card][data-primary-value]');
    if (actionBtn) {
      const cardIndex = Number(actionBtn.dataset.primaryCard);
      const value = actionBtn.dataset.primaryValue;
      const selections = getPendingPrimaryCards();
      selections[cardIndex] = value;
      setPendingPrimaryCards(selections);
      return;
    }

    const assignBtn = event.target.closest('[data-primary-assign][data-entity-id]');
    if (assignBtn) {
      const cardIndex = Number(assignBtn.dataset.primaryAssign);
      const entityId = assignBtn.dataset.entityId;
      const selections = getPendingPrimaryCards();
      selections[cardIndex] = entityId;
      setPendingPrimaryCards(selections);
    }
  });

  const searchInput = document.getElementById('primary-cards-search');
  if (searchInput) {
    searchInput.addEventListener('input', renderPrimaryCardsEntityList);
  }

  section.dataset.initialized = 'true';
}

/**
 * Read preview controls from the DOM and derive window effect values.
 *
 * Reads the #opacity-slider and #frosted-glass inputs; if either is missing, returns `null`.
 * Maps the slider (1–100, default 90) to an opacity value in the range 0.5–1.0 and reads the frosted glass checkbox state.
 * @returns {{opacity: number, frostedGlass: boolean} | null} An object with `opacity` (0.5–1.0) and `frostedGlass` boolean, or `null` if required inputs are not present.
 */
function getPreviewValuesFromInputs() {
  const opacitySlider = document.getElementById('opacity-slider');
  const frostedGlass = document.getElementById('frosted-glass');
  if (!opacitySlider || !frostedGlass) return null;

  const sliderValue = parseInt(opacitySlider.value, 10) || 90;
  const opacity = 0.5 + ((sliderValue - 1) * 0.5) / 99;
  const frostedGlassEnabled = !!frostedGlass.checked;

  return {
    opacity,
    frostedGlass: frostedGlassEnabled,
  };
}

/**
 * Apply the current preview window effect settings from the UI and request a native preview.
 *
 * Reads preview controls, re-applies the background preview, applies the window effects in-page, and, if present, asks the Electron API to show a native preview. Errors during application or the native preview request are logged to the console.
 */
function previewWindowEffectsNow() {
  try {
    const values = getPreviewValuesFromInputs();
    if (!values) return;

    refreshBackgroundTheme();
    applyWindowEffects(values);

    if (window?.electronAPI?.previewWindowEffects) {
      window.electronAPI.previewWindowEffects({
        opacity: values.opacity,
        frostedGlass: values.frostedGlass,
      }).catch(err => {
        console.error('Failed to preview window effects:', err);
      });
    }
  } catch (error) {
    console.error('Error applying preview window effects:', error);
  }
}

/**
 * Schedule an update to the window preview effects, coalescing multiple calls into a single animation frame.
 *
 * If `requestAnimationFrame` is not available, performs the update immediately. Additional calls while an update is already scheduled have no effect.
 */
function previewWindowEffects() {
  if (previewRaf) return;
  if (typeof requestAnimationFrame !== 'function') {
    previewWindowEffectsNow();
    return;
  }
  previewRaf = requestAnimationFrame(() => {
    previewRaf = null;
    previewWindowEffectsNow();
  });
}

/**
 * Cancel any pending window-effects preview and clear its scheduled handle.
 *
 * This stops a previously scheduled animation-frame preview (if any) and resets the internal RAF handle.
 */
function cancelPreviewWindowEffects() {
  if (!previewRaf || typeof cancelAnimationFrame !== 'function') return;
  cancelAnimationFrame(previewRaf);
  previewRaf = null;
}

/**
 * Restore the window's visual effects from the saved preview state.
 *
 * If no preview state is available this function is a no-op. When a preview
 * exists it cancels any pending preview updates, re-applies the current
 * background theme, applies the saved window effect values (opacity and
 * frosted-glass) and requests the native/Electron layer to apply the same
 * preview. Errors are logged to the console.
 */
function restorePreviewWindowEffects() {
  if (!previewState) return;

  try {
    cancelPreviewWindowEffects();
    refreshBackgroundTheme();
    applyWindowEffects(previewState);
    if (window?.electronAPI?.previewWindowEffects) {
      window.electronAPI.previewWindowEffects({
        opacity: previewState.opacity,
        frostedGlass: previewState.frostedGlass,
      }).catch(err => {
        console.error('Failed to restore preview window effects:', err);
      });
    }
  } catch (error) {
    console.error('Error restoring preview window effects:', error);
  }
}

/**
 * Validate Home Assistant URL format
 * @param {string} url - The URL to validate
 * @returns {object} - { valid: boolean, error: string|null, url: string }
 */
function validateHomeAssistantUrl(url) {
  if (!url || url.trim() === '') {
    return { valid: false, error: 'Home Assistant URL cannot be empty', url: null };
  }

  const trimmedUrl = url.trim();

  // Check if URL starts with http:// or https://
  if (!trimmedUrl.startsWith('http://') && !trimmedUrl.startsWith('https://')) {
    return { valid: false, error: 'URL must start with http:// or https://', url: null };
  }

  // Try to parse as URL
  try {
    const urlObj = new URL(trimmedUrl);

    // Validate it has a hostname
    if (!urlObj.hostname) {
      return { valid: false, error: 'Invalid URL: missing hostname', url: null };
    }

    // Remove trailing slash for consistency
    const normalizedUrl = trimmedUrl.replace(/\/$/, '');

    return { valid: true, error: null, url: normalizedUrl };
  } catch {
    return { valid: false, error: 'Invalid URL format', url: null };
  }
}

/**
 * Open and initialize the settings modal, populate controls from persisted config, initialize theme and preview state, and trap focus.
 *
 * Populates Home Assistant fields, window and visual-effect controls, start-on-login, hotkeys, alerts, media player selection, and color theme previews; initializes related UI components, renders theme options, and shows the modal.
 *
 * @param {Object} [uiHooks] - Optional UI hook callbacks provided by the renderer.
 * @param {Function} [uiHooks.exitReorganizeMode] - Called to exit any active reorganize mode before opening settings.
 * @param {Function} [uiHooks.showToast] - Called to display transient messages (signature: (message, type, durationMs) => void).
 * @param {Function} [uiHooks.initUpdateUI] - Called after DOM fields are populated so the renderer can perform any additional UI initialization.
 */
async function openSettings(uiHooks) {
  try {
    // Exit reorganize mode if active to prevent state conflicts
    if (uiHooks && uiHooks.exitReorganizeMode) {
      uiHooks.exitReorganizeMode();
    }

    const modal = document.getElementById('settings-modal');
    if (!modal) return;

    // Populate fields
    const haUrl = document.getElementById('ha-url');
    const haToken = document.getElementById('ha-token');
    const alwaysOnTop = document.getElementById('always-on-top');
    const opacitySlider = document.getElementById('opacity-slider');
    const opacityValue = document.getElementById('opacity-value');
    const frostedGlass = document.getElementById('frosted-glass');
    if (haUrl) haUrl.value = state.CONFIG.homeAssistant.url || '';
    if (haToken) {
      const tokenValue = state.CONFIG.homeAssistant.token || '';
      // Don't display default token - show empty field instead to prompt user to enter real token
      haToken.value = tokenValue === 'YOUR_LONG_LIVED_ACCESS_TOKEN' ? '' : tokenValue;

      // Show warning if token was reset due to decryption failure
      if (state.CONFIG.tokenResetReason) {
        let warningMessage = 'Your access token needs to be re-entered. ';
        if (state.CONFIG.tokenResetReason === 'encryption_unavailable') {
          warningMessage += 'Encryption is not available on this system.';
        } else if (state.CONFIG.tokenResetReason === 'decryption_failed') {
          warningMessage += 'Token decryption failed.';
        }
        uiHooks.showToast(warningMessage, 'warning', 10000);
      }
    }
    if (alwaysOnTop) alwaysOnTop.checked = state.CONFIG.alwaysOnTop !== false;
    if (frostedGlass) frostedGlass.checked = !!state.CONFIG.frostedGlass;

    // Initialize "Start with Windows" checkbox
    const startWithWindows = document.getElementById('start-with-windows');
    if (startWithWindows) {
      try {
        const loginSettings = await window.electronAPI.getLoginItemSettings();
        startWithWindows.checked = loginSettings.openAtLogin || false;
      } catch (error) {
        console.error('Failed to get login item settings:', error);
        startWithWindows.checked = false;
      }
    }

    // Convert stored opacity (0.5-1.0) to slider scale (1-100)
    const storedOpacity = Math.max(0.5, Math.min(1, state.CONFIG.opacity || 0.95));
    // Formula: scale = 1 + (opacity - 0.5) * 198
    const sliderScale = Math.round(1 + ((storedOpacity - 0.5) * 198));
    if (opacitySlider) opacitySlider.value = sliderScale;
    if (opacityValue) opacityValue.textContent = `${sliderScale}`;

    previewState = {
      opacity: storedOpacity,
      frostedGlass: !!state.CONFIG.frostedGlass,
    };
    hasDraftColorPreview = false;

    state.CONFIG.ui = state.CONFIG.ui || {};
    setPendingCustomColorList(state.CONFIG.ui.customColors || []);

    const currentAccent = getCurrentAccentTheme();
    previewAccent = currentAccent;
    pendingAccent = currentAccent;
    selectAccentTheme(currentAccent, { preview: false });
    const currentBackground = getCurrentBackgroundTheme();
    previewBackground = currentBackground;
    pendingBackground = currentBackground;
    selectBackgroundTheme(currentBackground, { preview: false });
    activeColorTarget = COLOR_TARGETS.accent;
    renderColorThemeOptions();
    initColorTargetSelect();
    initCustomColorEditor();
    initColorThemeSectionToggle();

    const globalHotkeysEnabled = document.getElementById('global-hotkeys-enabled');
    if (globalHotkeysEnabled) {
      globalHotkeysEnabled.checked = !!(state.CONFIG.globalHotkeys && state.CONFIG.globalHotkeys.enabled);
      const hotkeysSection = document.getElementById('hotkeys-section');
      if (hotkeysSection) {
        hotkeysSection.style.display = globalHotkeysEnabled.checked ? 'block' : 'none';
      }
    }

    const entityAlertsEnabled = document.getElementById('entity-alerts-enabled');
    if (entityAlertsEnabled) {
      entityAlertsEnabled.checked = !!(state.CONFIG.entityAlerts && state.CONFIG.entityAlerts.enabled);
      const alertsSection = document.getElementById('alerts-section');
      if (alertsSection) {
        alertsSection.style.display = entityAlertsEnabled.checked ? 'block' : 'none';
      }
      // Render inline alerts list if alerts are enabled
      if (entityAlertsEnabled.checked) {
        renderAlertsListInline();
      }
    }

    // Call UI hooks passed from renderer.js
    if (uiHooks) {
      uiHooks.initUpdateUI();
    }

    // Populate media player dropdown after UI hooks (when states are loaded)
    populateMediaPlayerDropdown();
    initPrimaryCardsUI();
    const primarySearch = document.getElementById('primary-cards-search');
    if (primarySearch) primarySearch.value = '';
    setPendingPrimaryCards(state.CONFIG?.primaryCards || PRIMARY_CARD_DEFAULTS);

    // Initialize popup hotkey UI
    initializePopupHotkey();

    modal.classList.remove('hidden');
    modal.style.display = 'flex';
    trapFocus(modal);
  } catch (error) {
    console.error('Error opening settings:', error);
  }
}

/**
 * Close the settings modal and revert any in-progress previews and UI changes.
 *
 * Restores window effect previews and theme previews that were active while the settings modal was open, clears pending preview state, hides the theme tooltip, removes hotkey listeners, and hides/releases the settings modal's focus trap.
 */
function closeSettings() {
  try {
    cancelPreviewWindowEffects();
    if (previewState) {
      restorePreviewWindowEffects();
      previewState = null;
    }
    if (hasDraftColorPreview) {
      if (previewAccent) applyAccentTheme(previewAccent);
      if (previewBackground) applyBackgroundTheme(previewBackground);
    }
    if (previewAccent && pendingAccent && previewAccent !== pendingAccent) {
      applyAccentTheme(previewAccent);
    }
    previewAccent = null;
    pendingAccent = null;
    if (previewBackground && pendingBackground && previewBackground !== pendingBackground) {
      applyBackgroundTheme(previewBackground);
    }
    previewBackground = null;
    pendingBackground = null;
    pendingPrimaryCards = null;
    pendingCustomColors = [];
    activeCustomManagementThemeId = null;
    hasDraftColorPreview = false;
    setCustomThemes(getSavedCustomColors());
    hideThemeTooltip();

    // Clean up hotkey event listeners to prevent memory leaks
    cleanupHotkeyEventListeners();

    const modal = document.getElementById('settings-modal');
    if (modal) {
      modal.classList.add('hidden');
      modal.style.display = 'none';
      releaseFocusTrap(modal);
    }
  } catch (error) {
    console.error('Error closing settings:', error);
  }
}

/**
 * Persist current settings from the settings UI, apply them to the app, and update related subsystems.
 *
 * Reads and validates form fields (including Home Assistant URL and token), persists the resulting configuration,
 * applies UI and window-effect changes (opacity, themes, frosted glass, always-on-top), updates platform-specific
 * settings (Start with Windows, global hotkeys, entity alerts, primary media player), refreshes the media tile,
 * and reconnects to Home Assistant only if connection settings changed. May prompt the user to restart the app when
 * toggling Always on Top. Errors are logged and reported via toasts where validation fails.
 */
async function saveSettings() {
  try {
    const prevAlwaysOnTop = state.CONFIG.alwaysOnTop;

    // Store previous HA connection settings to detect if reconnect is needed
    const prevHaUrl = state.CONFIG.homeAssistant?.url;
    const prevHaToken = state.CONFIG.homeAssistant?.token;

    const haUrl = document.getElementById('ha-url');
    const haToken = document.getElementById('ha-token');
    const alwaysOnTop = document.getElementById('always-on-top');
    const opacitySlider = document.getElementById('opacity-slider');
    const frostedGlass = document.getElementById('frosted-glass');
    const globalHotkeysEnabled = document.getElementById('global-hotkeys-enabled');
    const entityAlertsEnabled = document.getElementById('entity-alerts-enabled');

    // Validate and save Home Assistant URL
    if (haUrl && haUrl.value.trim()) {
      const validation = validateHomeAssistantUrl(haUrl.value);
      if (!validation.valid) {
        showToast(validation.error, 'error', 4000);
        return; // Don't save if URL is invalid
      }
      state.CONFIG.homeAssistant.url = validation.url;
    } else if (haUrl && !haUrl.value.trim()) {
      showToast('Home Assistant URL cannot be empty', 'error', 3000);
      return;
    }

    if (haToken) {
      state.CONFIG.homeAssistant.token = haToken.value.trim();
      // Clear tokenResetReason when user enters a new token
      if (state.CONFIG.tokenResetReason) {
        delete state.CONFIG.tokenResetReason;
      }
    }
    if (alwaysOnTop) state.CONFIG.alwaysOnTop = alwaysOnTop.checked;
    if (frostedGlass) state.CONFIG.frostedGlass = frostedGlass.checked;
    delete state.CONFIG.frostedGlassStrength;
    delete state.CONFIG.frostedGlassTint;
    state.CONFIG.ui = state.CONFIG.ui || {};
    state.CONFIG.ui.accent = pendingAccent || getCurrentAccentTheme();
    state.CONFIG.ui.background = pendingBackground || getCurrentBackgroundTheme();
    state.CONFIG.ui.customColors = getCustomColorsForSave();
    setCustomThemes(state.CONFIG.ui.customColors);

    // Save "Start with Windows" setting
    const startWithWindows = document.getElementById('start-with-windows');
    if (startWithWindows) {
      try {
        const result = await window.electronAPI.setLoginItemSettings(startWithWindows.checked);
        if (!result.success) {
          console.error('Failed to set login item settings:', result.error);
          showToast('Failed to update Start with Windows setting', 'warning', 3000);
        }
      } catch (error) {
        console.error('Failed to set login item settings:', error);
      }
    }

    // Convert slider scale (1-100) to opacity (0.5-1.0)
    if (opacitySlider) {
      const sliderValue = parseInt(opacitySlider.value) || 90;
      state.CONFIG.opacity = 0.5 + ((sliderValue - 1) * 0.5) / 99;
    }

    state.CONFIG.globalHotkeys = state.CONFIG.globalHotkeys || { enabled: false, hotkeys: {} };
    if (globalHotkeysEnabled) state.CONFIG.globalHotkeys.enabled = globalHotkeysEnabled.checked;

    state.CONFIG.entityAlerts = state.CONFIG.entityAlerts || { enabled: false, alerts: {} };
    if (entityAlertsEnabled) state.CONFIG.entityAlerts.enabled = entityAlertsEnabled.checked;

    // Save primary media player selection from custom dropdown
    // Read directly from DOM to avoid using global state variable
    const selectedOption = document.querySelector('#primary-media-player-menu .custom-dropdown-option.selected');
    const selectedValue = selectedOption ? selectedOption.getAttribute('data-value') : '';
    state.CONFIG.primaryMediaPlayer = selectedValue || null;

    state.CONFIG.primaryCards = getPendingPrimaryCards();


    await window.electronAPI.updateConfig(state.CONFIG);

    // Apply opacity immediately
    if (opacitySlider) {
      await window.electronAPI.setOpacity(state.CONFIG.opacity);
    }

    if (prevAlwaysOnTop !== state.CONFIG.alwaysOnTop) {
      const res = await window.electronAPI.setAlwaysOnTop(state.CONFIG.alwaysOnTop);
      const windowState = await window.electronAPI.getWindowState();
      if (!res?.applied || windowState?.alwaysOnTop !== state.CONFIG.alwaysOnTop) {
        if (confirm('Changing "Always on top" may require a restart. Restart now?')) {
          // Force window to regain focus after confirm dialog (Windows focus bug workaround)
          await window.electronAPI.focusWindow().catch(err => console.error('Failed to refocus window:', err));
          await window.electronAPI.restartApp();
          return;
        }
        // Force window to regain focus even if user cancelled (Windows focus bug workaround)
        await window.electronAPI.focusWindow().catch(err => console.error('Failed to refocus window:', err));
      }
    }

    previewState = null;
    previewAccent = null;
    pendingAccent = null;
    previewBackground = null;
    pendingBackground = null;
    hasDraftColorPreview = false;
    closeSettings();
    applyTheme(state.CONFIG.ui?.theme || 'auto');
    applyAccentTheme(state.CONFIG.ui?.accent || getCurrentAccentTheme());
    applyBackgroundTheme(state.CONFIG.ui?.background || getCurrentBackgroundTheme());
    applyUiPreferences(state.CONFIG.ui || {});
    applyWindowEffects(state.CONFIG || {});

    // Update media tile to reflect new selection
    // Dynamic import to avoid circular dependency
    const ui = await import('./ui.js');
    if (ui.updateMediaTile) {
      ui.updateMediaTile();
    }
    if (ui.renderPrimaryCards) {
      ui.renderPrimaryCards();
    }

    // Only reconnect WebSocket if HA connection settings actually changed
    const haSettingsChanged =
      prevHaUrl !== state.CONFIG.homeAssistant.url ||
      prevHaToken !== state.CONFIG.homeAssistant.token;

    if (haSettingsChanged) {
      websocket.connect();
    }
  } catch (error) {
    console.error('Failed to save config:', error);
  }
}


function renderAlertsListInline() {
  try {
    const alertsList = document.getElementById('inline-alerts-list');
    if (!alertsList) return;

    alertsList.innerHTML = '';

    const alerts = state.CONFIG.entityAlerts?.alerts || {};
    // utils already imported at top

    // Show message if no alerts
    if (Object.keys(alerts).length === 0) {
      const noAlertsMsg = document.createElement('div');
      noAlertsMsg.className = 'no-alerts-message';
      noAlertsMsg.textContent = 'No alerts configured yet. Click the button below to add your first alert.';
      noAlertsMsg.style.padding = '20px';
      noAlertsMsg.style.textAlign = 'center';
      noAlertsMsg.style.color = 'var(--text-muted)';
      alertsList.appendChild(noAlertsMsg);
    }

    // Add existing alerts
    Object.keys(alerts).forEach(entityId => {
      const entity = state.STATES[entityId];
      if (!entity) return;

      const alertItem = document.createElement('div');
      alertItem.className = 'alert-item';

      const alertConfig = alerts[entityId];
      let alertType = alertConfig.onStateChange ? 'State Change' : 'Specific State';
      if (alertConfig.onSpecificState) {
        alertType += ` (${utils.escapeHtml(alertConfig.targetState)})`;
      }

      alertItem.innerHTML = `
        <div class="alert-item-info">
          <span class="alert-icon">${utils.escapeHtml(utils.getEntityIcon(entity))}</span>
          <div class="alert-details">
            <span class="alert-name">${utils.escapeHtml(utils.getEntityDisplayName(entity))}</span>
            <span class="alert-type">${alertType}</span>
          </div>
        </div>
        <div class="alert-actions">
          <button class="btn btn-small btn-secondary edit-alert" data-entity="${utils.escapeHtml(entityId)}">Edit</button>
          <button class="btn btn-small btn-danger remove-alert" data-entity="${utils.escapeHtml(entityId)}">Remove</button>
        </div>
      `;

      alertsList.appendChild(alertItem);
    });

    // Add "Add new alert" button
    const addButton = document.createElement('button');
    addButton.className = 'btn btn-secondary btn-block add-alert-btn';
    addButton.textContent = '+ Add New Alert';
    addButton.onclick = () => openAlertEntityPicker();
    addButton.style.marginTop = '10px';
    alertsList.appendChild(addButton);

    // Wire up event handlers
    alertsList.querySelectorAll('.edit-alert').forEach(btn => {
      btn.onclick = () => openAlertConfigModal(btn.dataset.entity);
    });

    alertsList.querySelectorAll('.remove-alert').forEach(btn => {
      btn.onclick = () => removeAlert(btn.dataset.entity);
    });
  } catch (error) {
    console.error('Error rendering alerts list inline:', error);
  }
}

function openAlertEntityPicker() {
  try {
    populateAlertEntityPicker();
    const modal = document.getElementById('alert-entity-picker-modal');
    if (modal) {
      modal.classList.remove('hidden');
      modal.style.display = 'flex';
      trapFocus(modal);
    }
  } catch (error) {
    console.error('Error opening alert entity picker:', error);
  }
}

function closeAlertEntityPicker() {
  try {
    const modal = document.getElementById('alert-entity-picker-modal');
    if (modal) {
      modal.classList.add('hidden');
      modal.style.display = 'none';
      releaseFocusTrap(modal);
    }
  } catch (error) {
    console.error('Error closing alert entity picker:', error);
  }
}

function populateAlertEntityPicker() {
  try {
    const list = document.getElementById('alert-entity-picker-list');
    if (!list) return;

    // utils already imported at top
    const alerts = state.CONFIG.entityAlerts?.alerts || {};
    const entities = Object.values(state.STATES || {})
      .filter(e => !e.entity_id.startsWith('sun.') && !e.entity_id.startsWith('zone.'))
      .sort((a, b) => utils.getEntityDisplayName(a).localeCompare(utils.getEntityDisplayName(b)));

    list.innerHTML = '';

    if (entities.length === 0) {
      list.innerHTML = '<div class="no-entities-message">No entities available. Make sure you\'re connected to Home Assistant.</div>';
      return;
    }

    entities.forEach(entity => {
      const entityId = entity.entity_id;
      const hasAlert = !!alerts[entityId];

      const item = document.createElement('div');
      item.className = 'entity-item';

      const icon = utils.getEntityIcon(entity);
      const displayName = utils.getEntityDisplayName(entity);

      item.innerHTML = `
        <div class="entity-item-main">
          <span class="entity-icon">${utils.escapeHtml(icon)}</span>
          <div class="entity-item-info">
            <span class="entity-name">${utils.escapeHtml(displayName)}</span>
            <span class="entity-id">${utils.escapeHtml(entityId)}</span>
          </div>
        </div>
        <button class="entity-selector-btn ${hasAlert ? 'edit' : 'add'}" data-entity-id="${utils.escapeHtml(entityId)}">
          ${hasAlert ? '⚙️ Edit Alert' : '+ Add Alert'}
        </button>
      `;

      // Add badge if alert exists
      if (hasAlert) {
        const badge = document.createElement('span');
        badge.className = 'alert-badge';
        badge.textContent = '🔔';
        badge.title = 'Alert configured';
        badge.style.marginLeft = '8px';
        badge.style.fontSize = '14px';
        item.querySelector('.entity-item-main').appendChild(badge);
      }

      list.appendChild(item);
    });

    // Wire up click handlers
    list.querySelectorAll('.entity-selector-btn').forEach(btn => {
      btn.onclick = () => {
        const entityId = btn.dataset.entityId;
        closeAlertEntityPicker();
        openAlertConfigModal(entityId);
      };
    });

    // Search functionality
    const searchInput = document.getElementById('alert-entity-picker-search');
    if (searchInput) {
      searchInput.oninput = null;
      searchInput.value = '';

      searchInput.oninput = (e) => {
        const query = e.target.value.toLowerCase().trim();
        if (!query) {
          // Show all items if search is empty
          list.querySelectorAll('.entity-item').forEach(item => {
            item.style.display = 'flex';
          });
          return;
        }

        // Score each item and show/hide based on score
        list.querySelectorAll('.entity-item').forEach(item => {
          const name = item.querySelector('.entity-name')?.textContent || '';
          const id = item.querySelector('.entity-id')?.textContent || '';

          // Calculate separate scores for name and ID, then add them
          const nameScore = utils.getSearchScore(name, query);
          const idScore = utils.getSearchScore(id, query);
          const totalScore = nameScore + idScore;

          item.style.display = totalScore > 0 ? 'flex' : 'none';
        });
      };
    }
  } catch (error) {
    console.error('Error populating alert entity picker:', error);
  }
}

let currentAlertEntity = null;

function openAlertConfigModal(entityId) {
  try {
    if (!entityId) {
      console.error('openAlertConfigModal requires entityId');
      return;
    }

    const modal = document.getElementById('alert-config-modal');
    if (!modal) return;

    currentAlertEntity = entityId;

    const stateChangeRadio = modal.querySelector('input[value="state-change"]');
    const specificStateRadio = modal.querySelector('input[value="specific-state"]');
    const specificStateGroup = document.getElementById('specific-state-group');
    const targetStateInput = document.getElementById('target-state-input');
    const title = document.getElementById('alert-config-title');

    const alertConfig = state.CONFIG.entityAlerts?.alerts[entityId];
    const entity = state.STATES[entityId];
    // utils already imported at top

    if (title) title.textContent = `Configure Alert - ${entity ? utils.getEntityDisplayName(entity) : entityId}`;

    // Load existing alert config or set defaults
    if (alertConfig) {
      if (alertConfig.onStateChange) {
        if (stateChangeRadio) stateChangeRadio.checked = true;
        if (specificStateGroup) specificStateGroup.style.display = 'none';
      } else if (alertConfig.onSpecificState) {
        if (specificStateRadio) specificStateRadio.checked = true;
        if (specificStateGroup) specificStateGroup.style.display = 'block';
        if (targetStateInput) targetStateInput.value = alertConfig.targetState || '';
      }
    } else {
      // New alert - set defaults
      if (stateChangeRadio) stateChangeRadio.checked = true;
      if (specificStateGroup) specificStateGroup.style.display = 'none';
      if (targetStateInput) targetStateInput.value = '';
    }

    // Radio button handlers
    if (stateChangeRadio) {
      stateChangeRadio.onchange = () => {
        if (specificStateGroup) specificStateGroup.style.display = 'none';
      };
    }

    if (specificStateRadio) {
      specificStateRadio.onchange = () => {
        if (specificStateGroup) specificStateGroup.style.display = 'block';
      };
    }

    modal.classList.remove('hidden');
    modal.style.display = 'flex';
    trapFocus(modal);
  } catch (error) {
    console.error('Error opening alert config modal:', error);
  }
}

function closeAlertConfigModal() {
  try {
    const modal = document.getElementById('alert-config-modal');
    if (modal) {
      modal.classList.add('hidden');
      modal.style.display = 'none';
      releaseFocusTrap(modal);
      currentAlertEntity = null;
    }
  } catch (error) {
    console.error('Error closing alert config modal:', error);
  }
}

async function saveAlert() {
  try {
    if (!currentAlertEntity) return;

    const modal = document.getElementById('alert-config-modal');
    const stateChangeRadio = modal.querySelector('input[value="state-change"]');
    const specificStateRadio = modal.querySelector('input[value="specific-state"]');
    const targetStateInput = document.getElementById('target-state-input');

    state.CONFIG.entityAlerts = state.CONFIG.entityAlerts || { enabled: false, alerts: {} };

    const alertConfig = {
      onStateChange: stateChangeRadio?.checked || false,
      onSpecificState: specificStateRadio?.checked || false,
      targetState: targetStateInput?.value.trim() || ''
    };

    state.CONFIG.entityAlerts.alerts[currentAlertEntity] = alertConfig;

    await window.electronAPI.updateConfig(state.CONFIG);

    closeAlertConfigModal();
    renderAlertsListInline();

    // showToast already imported at top
    showToast('Alert saved successfully', 'success', 2000);
  } catch (error) {
    console.error('Error saving alert:', error);
    // showToast already imported at top
    showToast('Error saving alert', 'error', 2000);
  }
}

async function removeAlert(entityId) {
  try {
    const entity = state.STATES[entityId];
    // utils already imported at top
    // showToast, showConfirm, utils already imported at top
    const entityName = entity ? utils.getEntityDisplayName(entity) : entityId;

    const confirmed = await showConfirm(
      'Remove Alert',
      `Remove alert for "${entityName}"?`,
      { confirmText: 'Remove', confirmClass: 'btn-danger' }
    );

    if (!confirmed) return;

    if (state.CONFIG.entityAlerts?.alerts[entityId]) {
      delete state.CONFIG.entityAlerts.alerts[entityId];
      await window.electronAPI.updateConfig(state.CONFIG);
      renderAlertsListInline();

      showToast('Alert removed', 'success', 2000);
    }
  } catch (error) {
    console.error('Error removing alert:', error);
    // showToast already imported at top
    showToast('Error removing alert', 'error', 2000);
  }
}

// Custom Dropdown Management
function initCustomDropdown() {
  try {
    const dropdown = document.getElementById('primary-media-player-dropdown');
    const trigger = document.getElementById('primary-media-player-trigger');
    const menu = document.getElementById('primary-media-player-menu');

    if (!dropdown || !trigger || !menu) {
      console.warn('Custom dropdown elements not found');
      return;
    }

    // Toggle dropdown
    trigger.addEventListener('click', (e) => {
      e.stopPropagation();
      const isOpen = dropdown.classList.contains('open');

      if (isOpen) {
        closeCustomDropdown();
      } else {
        dropdown.classList.add('open');
        trigger.setAttribute('aria-expanded', 'true');
        schedulePersonalizationSectionHeightSync(dropdown);
      }
    });

    // Close dropdown when clicking outside
    document.addEventListener('click', (e) => {
      if (!dropdown.contains(e.target)) {
        closeCustomDropdown();
      }
    });

    // Handle keyboard navigation
    trigger.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        const isOpen = dropdown.classList.toggle('open');
        trigger.setAttribute('aria-expanded', isOpen ? 'true' : 'false');
        schedulePersonalizationSectionHeightSync(dropdown);
      } else if (e.key === 'Escape') {
        closeCustomDropdown();
      }
    });

    // Option selection handled in populateMediaPlayerDropdown
  } catch (error) {
    console.error('Error initializing custom dropdown:', error);
  }
}

function closeCustomDropdown() {
  const dropdown = document.getElementById('primary-media-player-dropdown');
  const trigger = document.getElementById('primary-media-player-trigger');

  if (dropdown) {
    dropdown.classList.remove('open');
    schedulePersonalizationSectionHeightSync(dropdown);
  }
  if (trigger) {
    trigger.setAttribute('aria-expanded', 'false');
  }
}

function setCustomDropdownValue(value, displayText) {
  // Update displayed value
  const valueSpan = document.querySelector('.custom-dropdown-value');
  if (valueSpan) {
    valueSpan.textContent = displayText;
  }

  // Update selected state on options (the DOM itself stores the selection state)
  const options = document.querySelectorAll('.custom-dropdown-option');
  options.forEach(opt => {
    if (opt.getAttribute('data-value') === value) {
      opt.classList.add('selected');
    } else {
      opt.classList.remove('selected');
    }
  });
}

function populateMediaPlayerDropdown() {
  try {
    const menu = document.getElementById('primary-media-player-menu');
    if (!menu) {
      console.warn('Media player dropdown menu not found');
      return;
    }

    // Clear existing options
    menu.innerHTML = '';

    // Add "None" option
    const noneOption = document.createElement('div');
    noneOption.className = 'custom-dropdown-option';
    noneOption.setAttribute('role', 'option');
    noneOption.setAttribute('data-value', '');
    noneOption.textContent = 'None (Hide Media Tile)';
    menu.appendChild(noneOption);

    // Get all media player entities
    const mediaPlayers = Object.values(state.STATES || {})
      .filter(entity => entity.entity_id.startsWith('media_player.'))
      .sort((a, b) => {
        // utils already imported at top
        const nameA = utils.getEntityDisplayName(a).toLowerCase();
        const nameB = utils.getEntityDisplayName(b).toLowerCase();
        return nameA.localeCompare(nameB);
      });

    // Populate dropdown
    mediaPlayers.forEach(entity => {
      const option = document.createElement('div');
      option.className = 'custom-dropdown-option';
      option.setAttribute('role', 'option');
      option.setAttribute('data-value', entity.entity_id);
      // utils already imported at top
      option.textContent = utils.getEntityDisplayName(entity);
      menu.appendChild(option);
    });

    // Add click handlers to all options
    const options = menu.querySelectorAll('.custom-dropdown-option');
    options.forEach(option => {
      option.addEventListener('click', () => {
        const value = option.getAttribute('data-value');
        const displayText = option.textContent;
        setCustomDropdownValue(value, displayText);
        closeCustomDropdown();
      });
    });

    // Set current selection
    const currentValue = state.CONFIG.primaryMediaPlayer || '';
    const selectedOption = Array.from(options).find(opt => opt.getAttribute('data-value') === currentValue);
    const displayText = selectedOption ? selectedOption.textContent : 'None (Hide Media Tile)';
    setCustomDropdownValue(currentValue, displayText);

    // Initialize dropdown behavior (only once)
    if (!menu.dataset.initialized) {
      initCustomDropdown();
      menu.dataset.initialized = 'true';
    }
  } catch (error) {
    console.error('Error populating media player dropdown:', error);
  }
}

// Popup Hotkey Management
let isCapturingPopupHotkey = false;

async function initializePopupHotkey() {
  try {
    // Check if popup hotkey feature is available
    const isAvailable = await window.electronAPI.isPopupHotkeyAvailable();

    const input = document.getElementById('popup-hotkey-input');
    const setBtn = document.getElementById('popup-hotkey-set-btn');
    const clearBtn = document.getElementById('popup-hotkey-clear-btn');
    const container = document.getElementById('popup-hotkey-container');

    if (!input || !setBtn || !clearBtn) return;

    // If not available, disable the UI and show a message
    if (!isAvailable) {
      input.disabled = true;
      input.value = '';
      input.placeholder = 'Not available on this platform';
      setBtn.disabled = true;
      clearBtn.disabled = true;
      clearBtn.style.display = 'none';

      // Add a notice message if not already present
      if (container && !container.querySelector('.unavailable-notice')) {
        const notice = document.createElement('p');
        notice.className = 'unavailable-notice';
        notice.style.color = '#888';
        notice.style.fontSize = '12px';
        notice.style.marginTop = '8px';
        notice.textContent = 'Popup hotkey feature is not available on this platform.';
        container.appendChild(notice);
      }
      return;
    }

    // Load current popup hotkey
    const currentHotkey = state.CONFIG.popupHotkey || '';
    if (currentHotkey) {
      input.value = currentHotkey;
      input.placeholder = currentHotkey;
      clearBtn.style.display = 'inline-block';
    }

    // Initialize "Toggle mode" checkbox and "Hide on release" checkbox with mutual exclusivity
    const toggleModeCheckbox = document.getElementById('popup-hotkey-toggle-mode');
    const toggleModeLabel = document.getElementById('popup-hotkey-toggle-mode-label');
    const hideOnReleaseCheckbox = document.getElementById('popup-hotkey-hide-on-release');
    const hideOnReleaseLabel = document.getElementById('popup-hotkey-hide-on-release-label');

    // Helper function to update disabled states
    const updateMutualExclusivity = () => {
      if (toggleModeCheckbox && hideOnReleaseCheckbox) {
        // When toggle mode is enabled, disable hide-on-release
        hideOnReleaseCheckbox.disabled = toggleModeCheckbox.checked;
        if (hideOnReleaseLabel) {
          hideOnReleaseLabel.classList.toggle('disabled', toggleModeCheckbox.checked);
        }

        // When hide-on-release is enabled, disable toggle mode
        toggleModeCheckbox.disabled = hideOnReleaseCheckbox.checked;
        if (toggleModeLabel) {
          toggleModeLabel.classList.toggle('disabled', hideOnReleaseCheckbox.checked);
        }
      }
    };

    if (toggleModeCheckbox) {
      toggleModeCheckbox.checked = !!state.CONFIG.popupHotkeyToggleMode;

      toggleModeCheckbox.onchange = async () => {
        state.CONFIG.popupHotkeyToggleMode = toggleModeCheckbox.checked;
        updateMutualExclusivity();

        try {
          await window.electronAPI.updateConfig(state.CONFIG);
          // Re-register hotkey to apply new mode
          if (state.CONFIG.popupHotkey) {
            await window.electronAPI.registerPopupHotkey(state.CONFIG.popupHotkey);
          }
          // showToast already imported at top
          showToast(
            toggleModeCheckbox.checked
              ? 'Toggle mode enabled: tap to show/hide'
              : 'Hold mode enabled: hold to show, release to restore',
            'success',
            2000
          );
        } catch (error) {
          console.error('Failed to save popup hotkey toggle mode setting:', error);
        }
      };
    }

    if (hideOnReleaseCheckbox) {
      hideOnReleaseCheckbox.checked = !!state.CONFIG.popupHotkeyHideOnRelease;

      hideOnReleaseCheckbox.onchange = async () => {
        state.CONFIG.popupHotkeyHideOnRelease = hideOnReleaseCheckbox.checked;
        updateMutualExclusivity();

        try {
          await window.electronAPI.updateConfig(state.CONFIG);
          // showToast already imported at top
          showToast(
            hideOnReleaseCheckbox.checked
              ? 'Window will hide when popup hotkey is released'
              : 'Window will stay visible when popup hotkey is released',
            'success',
            2000
          );
        } catch (error) {
          console.error('Failed to save popup hotkey setting:', error);
        }
      };
    }

    // Set initial mutual exclusivity state
    updateMutualExclusivity();

    // Set hotkey button
    setBtn.onclick = () => {
      if (isCapturingPopupHotkey) {
        stopCapturingPopupHotkey();
        return;
      }
      startCapturingPopupHotkey();
    };

    // Clear button
    clearBtn.onclick = async () => {
      try {
        const result = await window.electronAPI.unregisterPopupHotkey();
        if (result.success) {
          input.value = '';
          input.placeholder = 'Not set (click Set Hotkey)';
          clearBtn.style.display = 'none';
          state.CONFIG.popupHotkey = '';
          // showToast already imported at top
          showToast('Popup hotkey cleared', 'success');
        }
      } catch (error) {
        console.error('Failed to clear popup hotkey:', error);
        // showToast already imported at top
        showToast('Failed to clear popup hotkey', 'error');
      }
    };

    // Preset hotkey buttons
    const presetButtons = document.querySelectorAll('.preset-hotkey-btn');
    presetButtons.forEach(btn => {
      btn.onclick = async () => {
        const hotkey = btn.dataset.hotkey;
        try {
          const result = await window.electronAPI.registerPopupHotkey(hotkey);
          if (result.success) {
            input.value = hotkey;
            input.placeholder = hotkey;
            clearBtn.style.display = 'inline-block';
            state.CONFIG.popupHotkey = hotkey;
            // showToast already imported at top
            showToast(`Popup hotkey set to ${hotkey}`, 'success');
          } else {
            // showToast already imported at top
            showToast(result.error || 'Failed to set popup hotkey', 'error');
          }
        } catch (error) {
          console.error('Failed to set preset hotkey:', error);
          // showToast already imported at top
          showToast('Failed to set popup hotkey', 'error');
        }
      };
    });
  } catch (error) {
    console.error('Error initializing popup hotkey:', error);
  }
}

function startCapturingPopupHotkey() {
  isCapturingPopupHotkey = true;
  const input = document.getElementById('popup-hotkey-input');
  const setBtn = document.getElementById('popup-hotkey-set-btn');

  if (input) {
    input.value = 'Press keys...';
    input.focus();
  }
  if (setBtn) {
    setBtn.textContent = 'Cancel';
    setBtn.classList.add('btn-danger');
    setBtn.classList.remove('btn-secondary');
  }

  // Capture keydown event
  const captureHandler = async (e) => {
    e.preventDefault();
    e.stopPropagation();

    // Ignore pure modifier keys - wait for a main key to be pressed
    if (['Control', 'Alt', 'Shift', 'Meta'].includes(e.key)) {
      return; // Don't process until user presses a non-modifier key
    }

    // Build hotkey string
    const parts = [];
    if (e.ctrlKey) parts.push('Ctrl');
    if (e.altKey) parts.push('Alt');
    if (e.shiftKey) parts.push('Shift');
    if (e.metaKey) parts.push('Command');

    // Add the main key
    let mainKeyAdded = false;
    if (e.key && e.key.length === 1) {
      parts.push(e.key.toUpperCase());
      mainKeyAdded = true;
    } else if (e.key === ' ') {
      parts.push('Space');
      mainKeyAdded = true;
    } else if (e.key && !['Control', 'Alt', 'Shift', 'Meta'].includes(e.key)) {
      parts.push(e.key);
      mainKeyAdded = true;
    }

    // Only proceed if we have a main key (not just modifiers)
    if (mainKeyAdded && parts.length > 0) {
      const hotkey = parts.join('+');

      try {
        const result = await window.electronAPI.registerPopupHotkey(hotkey);
        if (result.success) {
          if (input) {
            input.value = hotkey;
            input.placeholder = hotkey;
          }
          const clearBtn = document.getElementById('popup-hotkey-clear-btn');
          if (clearBtn) clearBtn.style.display = 'inline-block';
          state.CONFIG.popupHotkey = hotkey;
          // showToast already imported at top
          showToast(`Popup hotkey set to ${hotkey}`, 'success');
        } else {
          // showToast already imported at top
          showToast(result.error || 'Failed to set popup hotkey', 'error');
          if (input) input.value = state.CONFIG.popupHotkey || '';
        }
      } catch (error) {
        console.error('Failed to register popup hotkey:', error);
        // showToast already imported at top
        showToast('Failed to register popup hotkey', 'error');
        if (input) input.value = state.CONFIG.popupHotkey || '';
      }

      stopCapturingPopupHotkey();
    }
  };

  // Store handler for cleanup
  input._captureHandler = captureHandler;
  document.addEventListener('keydown', captureHandler, true);
}

function stopCapturingPopupHotkey() {
  isCapturingPopupHotkey = false;
  const input = document.getElementById('popup-hotkey-input');
  const setBtn = document.getElementById('popup-hotkey-set-btn');

  if (input) {
    input.value = state.CONFIG.popupHotkey || '';
    input.placeholder = state.CONFIG.popupHotkey || 'Not set (click Set Hotkey)';
    input.blur();

    if (input._captureHandler) {
      document.removeEventListener('keydown', input._captureHandler, true);
      input._captureHandler = null;
    }
  }

  if (setBtn) {
    setBtn.textContent = 'Set Hotkey';
    setBtn.classList.remove('btn-danger');
    setBtn.classList.add('btn-secondary');
  }
}

export {
  openSettings,
  closeSettings,
  saveSettings,
  previewWindowEffects,
  renderAlertsListInline,
  openAlertEntityPicker,
  closeAlertEntityPicker,
  openAlertConfigModal,
  closeAlertConfigModal,
  saveAlert,
  initializePopupHotkey,
};

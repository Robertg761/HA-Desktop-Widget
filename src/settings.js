import state from './state.js';
import websocket from './websocket.js';
import {
  applyTheme,
  applyAccentTheme,
  applyBackgroundTheme,
  getAccentThemes,
  applyUiPreferences,
  applyWindowEffects,
  trapFocus,
  releaseFocusTrap,
  showToast,
  showConfirm,
} from './ui-utils.js';
import { cleanupHotkeyEventListeners } from './hotkeys.js';
import * as utils from './utils.js';
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

function resolveThemeId(themeId, { preferSlate = false } = {}) {
  const themes = getAccentThemes();
  const validIds = new Set(themes.map(theme => theme.id));
  if (themeId && validIds.has(themeId)) return themeId;
  if (preferSlate) {
    return themes.find(theme => theme.id === 'slate')?.id || themes.find(theme => theme.id === 'original')?.id || themes[0]?.id || 'sky';
  }
  return themes.find(theme => theme.id === 'original')?.id || themes[0]?.id || 'sky';
}

function getCurrentAccentTheme() {
  const fallback = resolveThemeId(null);
  return state.CONFIG?.ui?.accent || fallback;
}

function getCurrentBackgroundTheme() {
  const fallback = resolveThemeId(null, { preferSlate: true });
  return state.CONFIG?.ui?.background || fallback;
}

function getPendingTheme(target) {
  if (target === COLOR_TARGETS.background) {
    return pendingBackground || getCurrentBackgroundTheme();
  }
  return pendingAccent || getCurrentAccentTheme();
}

function selectAccentTheme(accentKey, { preview = true } = {}) {
  const resolvedAccent = resolveThemeId(accentKey);
  pendingAccent = resolvedAccent;
  if (preview) {
    applyAccentTheme(resolvedAccent);
  }
  if (activeColorTarget === COLOR_TARGETS.accent) {
    updateThemeSelectionUI();
  }
  updateThemeSummary();
}

function selectBackgroundTheme(backgroundKey, { preview = true } = {}) {
  const resolvedBackground = resolveThemeId(backgroundKey, { preferSlate: true });
  pendingBackground = resolvedBackground;
  if (preview) {
    applyBackgroundTheme(resolvedBackground);
  }
  if (activeColorTarget === COLOR_TARGETS.background) {
    updateThemeSelectionUI();
  }
  updateThemeSummary();
}

function updateThemeSelectionUI() {
  const selectedTheme = getPendingTheme(activeColorTarget);
  const options = document.querySelectorAll('.color-theme-option');
  options.forEach(option => {
    const isSelected = option.dataset.theme === selectedTheme;
    option.classList.toggle('selected', isSelected);
    option.setAttribute('aria-checked', isSelected ? 'true' : 'false');
  });
}

function updateThemeOptionsLabel() {
  const label = document.getElementById('theme-options-label');
  if (!label) return;
  const labelTarget = activeColorTarget === COLOR_TARGETS.background ? 'Background' : 'Accent';
  label.textContent = `Color Options (${labelTarget})`;
}

function updateThemeSummary() {
  const summary = document.getElementById('theme-current-selection');
  if (!summary) return;
  const themes = getAccentThemes();
  const accentName = themes.find(theme => theme.id === getPendingTheme(COLOR_TARGETS.accent))?.name || 'Custom';
  const backgroundName = themes.find(theme => theme.id === getPendingTheme(COLOR_TARGETS.background))?.name || 'Custom';
  summary.textContent = `Accent: ${accentName} • Background: ${backgroundName}`;
}

function setActiveColorTarget(target) {
  activeColorTarget = target === COLOR_TARGETS.background ? COLOR_TARGETS.background : COLOR_TARGETS.accent;
  renderColorThemeOptions();
}

function refreshBackgroundTheme() {
  applyBackgroundTheme(pendingBackground || getCurrentBackgroundTheme());
}

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
    const isOriginalTheme = theme.id === 'original';
    const isBackgroundTarget = activeColorTarget === COLOR_TARGETS.background;
    const tooltipName = theme.name;
    const tooltipDescription = isOriginalTheme
      ? (isBackgroundTarget ? 'Original dark base (no tint)' : 'Original accent blue')
      : theme.description;
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

    const tooltip = document.createElement('span');
    tooltip.className = 'theme-tooltip';

    const tooltipNameEl = document.createElement('span');
    tooltipNameEl.className = 'theme-tooltip-name';
    tooltipNameEl.textContent = tooltipName;

    const tooltipNote = document.createElement('span');
    tooltipNote.className = 'theme-tooltip-note';
    tooltipNote.textContent = tooltipDescription;

    tooltip.appendChild(tooltipNameEl);
    tooltip.appendChild(tooltipNote);
    option.appendChild(tooltip);

    option.addEventListener('click', () => {
      if (activeColorTarget === COLOR_TARGETS.background) {
        selectBackgroundTheme(theme.id, { preview: true });
      } else {
        selectAccentTheme(theme.id, { preview: true });
      }
    });

    container.appendChild(option);
  });

  updateThemeOptionsLabel();
  updateThemeSummary();
}

function initColorTargetSelect() {
  const select = document.getElementById('color-target-select');
  if (!select) return;
  select.value = activeColorTarget;
  select.onchange = (e) => {
    setActiveColorTarget(e.target.value);
  };
}

function initColorThemeSectionToggle() {
  const section = document.getElementById('color-themes-section');
  const toggle = document.getElementById('color-themes-toggle');
  if (!section || !toggle) return;

  section.classList.remove('collapsed');
  toggle.setAttribute('aria-expanded', 'true');

  toggle.onclick = () => {
    const isCollapsed = section.classList.toggle('collapsed');
    toggle.setAttribute('aria-expanded', isCollapsed ? 'false' : 'true');
  };
}

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

function cancelPreviewWindowEffects() {
  if (!previewRaf || typeof cancelAnimationFrame !== 'function') return;
  cancelAnimationFrame(previewRaf);
  previewRaf = null;
}

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
    const updateInterval = document.getElementById('update-interval');
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
    if (updateInterval) updateInterval.value = Math.max(1, Math.round((state.CONFIG.updateInterval || 5000) / 1000));
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

    // Initialize popup hotkey UI
    initializePopupHotkey();

    modal.classList.remove('hidden');
    modal.style.display = 'flex';
    trapFocus(modal);
  } catch (error) {
    console.error('Error opening settings:', error);
  }
}

function closeSettings() {
  try {
    cancelPreviewWindowEffects();
    if (previewState) {
      restorePreviewWindowEffects();
      previewState = null;
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

async function saveSettings() {
  try {
    const prevAlwaysOnTop = state.CONFIG.alwaysOnTop;

    // Store previous HA connection settings to detect if reconnect is needed
    const prevHaUrl = state.CONFIG.homeAssistant?.url;
    const prevHaToken = state.CONFIG.homeAssistant?.token;
    const prevUpdateInterval = state.CONFIG.updateInterval;

    const haUrl = document.getElementById('ha-url');
    const haToken = document.getElementById('ha-token');
    const updateInterval = document.getElementById('update-interval');
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
    if (updateInterval) state.CONFIG.updateInterval = Math.max(1000, parseInt(updateInterval.value, 10) * 1000);
    if (alwaysOnTop) state.CONFIG.alwaysOnTop = alwaysOnTop.checked;
    if (frostedGlass) state.CONFIG.frostedGlass = frostedGlass.checked;
    delete state.CONFIG.frostedGlassStrength;
    delete state.CONFIG.frostedGlassTint;
    state.CONFIG.ui = state.CONFIG.ui || {};
    state.CONFIG.ui.accent = pendingAccent || getCurrentAccentTheme();
    state.CONFIG.ui.background = pendingBackground || getCurrentBackgroundTheme();

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

    const domainFilters = document.getElementById('domain-filters');
    if (domainFilters) {
      const checkboxes = domainFilters.querySelectorAll('input[type="checkbox"]');
      const newDomains = Array.from(checkboxes).filter(cb => cb.checked).map(cb => cb.value);
      const areaSelect = document.getElementById('area-select');
      const newAreas = areaSelect ? Array.from(areaSelect.selectedOptions).map(opt => opt.value) : [];
      state.setFilters({ ...state.FILTERS, domains: newDomains, areas: newAreas });
      state.CONFIG.filters = state.FILTERS;
    }

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

    // Only reconnect WebSocket if HA connection settings actually changed
    const haSettingsChanged =
      prevHaUrl !== state.CONFIG.homeAssistant.url ||
      prevHaToken !== state.CONFIG.homeAssistant.token ||
      prevUpdateInterval !== state.CONFIG.updateInterval;

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
        dropdown.classList.toggle('open');
        trigger.setAttribute('aria-expanded', dropdown.classList.contains('open') ? 'true' : 'false');
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

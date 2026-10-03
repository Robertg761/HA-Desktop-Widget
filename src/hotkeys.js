import state from './state.js';
import { closeModal, showToast, trapFocus } from './ui-utils.js';
import { getEntityDisplayName, getSearchScore } from './utils.js';
import { t } from './i18n.js';

let globalHotkeys = {};
const HOTKEY_SUPPORTED_DOMAINS = new Set([
  'light',
  'switch',
  'scene',
  'script',
  'automation',
  'button',
  'input_button',
  'input_boolean',
  'fan',
]);

// Helper function to escape HTML
function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

function escapeHtmlAttribute(text) {
  return String(escapeHtml(String(text ?? '')))
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function initializeHotkeys() {
  try {
    if (state.CONFIG && state.CONFIG.globalHotkeys) {
      globalHotkeys = state.CONFIG.globalHotkeys;
    }
  } catch (error) {
    console.error('Error initializing hotkeys:', error);
  }
}

// Labels are translated here because the options are rebuilt on every render.
function getActionOptionsForDomain(domain) {
  const options = {
    light: [
      { value: 'toggle', label: t('Toggle') },
      { value: 'turn_on', label: t('Turn On') },
      { value: 'turn_off', label: t('Turn Off') },
      { value: 'brightness_up', label: t('Brightness Up') },
      { value: 'brightness_down', label: t('Brightness Down') },
    ],
    switch: [
      { value: 'toggle', label: t('Toggle') },
      { value: 'turn_on', label: t('Turn On') },
      { value: 'turn_off', label: t('Turn Off') },
    ],
    scene: [{ value: 'turn_on', label: t('Activate') }],
    script: [{ value: 'turn_on', label: t('Run') }],
    automation: [
      { value: 'trigger', label: t('Trigger') },
      { value: 'toggle', label: t('Toggle') },
      { value: 'turn_on', label: t('Enable') },
      { value: 'turn_off', label: t('Disable') },
    ],
    button: [{ value: 'press', label: t('Press') }],
    input_button: [{ value: 'press', label: t('Press') }],
    input_boolean: [
      { value: 'toggle', label: t('Toggle') },
      { value: 'turn_on', label: t('Turn On') },
      { value: 'turn_off', label: t('Turn Off') },
    ],
    fan: [
      { value: 'toggle', label: t('Toggle') },
      { value: 'turn_on', label: t('Turn On') },
      { value: 'turn_off', label: t('Turn Off') },
      { value: 'increase_speed', label: t('Increase Speed') },
      { value: 'decrease_speed', label: t('Decrease Speed') },
    ],
  };

  return options[domain] || options.switch;
}

// The action is a native select, like every other choice in Settings: it brings the keyboard model
// and the screen reader roles, and its list opens over the page instead of pushing the rows below.
function createActionSelectHTML(options, selectedAction, entityId) {
  const optionsHTML = options
    .map(
      (opt) =>
        `<option value="${escapeHtmlAttribute(opt.value)}"${opt.value === selectedAction ? ' selected' : ''}>${escapeHtml(opt.label)}</option>`
    )
    .join('');
  return `<select class="hotkey-action-select" data-entity-id="${escapeHtmlAttribute(entityId)}" aria-label="${escapeHtmlAttribute(t('Hotkey action'))}">${optionsHTML}</select>`;
}

function renderHotkeysTab() {
  try {
    const container = document.getElementById('hotkeys-list');
    if (!container) return;

    const filter = document.getElementById('hotkey-entity-search').value.toLowerCase();
    const hotkeyEntities = Object.values(state.STATES)
      .filter((e) => HOTKEY_SUPPORTED_DOMAINS.has(e.entity_id.split('.')[0]))
      .map((entity) => {
        const score = filter
          ? getSearchScore(getEntityDisplayName(entity), filter) +
            getSearchScore(entity.entity_id, filter)
          : 1;
        return { entity, score };
      })
      .filter((item) => item.score > 0)
      .sort((a, b) => b.score - a.score);

    container.innerHTML = '';
    hotkeyEntities.forEach(({ entity }) => {
      const hotkeyConfig = state.CONFIG.globalHotkeys?.hotkeys?.[entity.entity_id] || {};
      const hotkey = typeof hotkeyConfig === 'string' ? hotkeyConfig : hotkeyConfig.hotkey;
      const action =
        typeof hotkeyConfig === 'object' && hotkeyConfig.action ? hotkeyConfig.action : 'toggle';
      const domain = entity.entity_id.split('.')[0];

      // Get action options based on entity type
      const actionOptions = getActionOptionsForDomain(domain);
      const actionSelectHTML = createActionSelectHTML(actionOptions, action, entity.entity_id);

      const item = document.createElement('div');
      item.className = 'hotkey-item';
      const displayName = escapeHtml(getEntityDisplayName(entity));
      const escapedHotkey = escapeHtmlAttribute(hotkey || '');
      const escapedEntityId = escapeHtmlAttribute(entity.entity_id);
      item.innerHTML = `
                <span class="entity-name">${displayName}</span>
                <div class="hotkey-input-container">
                    <input type="text" readonly role="button" aria-label="${escapeHtmlAttribute(t('Hotkey for {{name}}', { name: getEntityDisplayName(entity) }))}" aria-keyshortcuts="Enter Space" class="hotkey-input" value="${escapedHotkey}" placeholder="${escapeHtmlAttribute(t('None'))}" data-entity-id="${escapedEntityId}">
                    ${actionSelectHTML}
                    <button type="button" class="btn-clear-hotkey" title="${escapeHtmlAttribute(t('Clear hotkey'))}" aria-label="${escapeHtmlAttribute(t('Clear hotkey'))}">&times;</button>
                </div>
            `;
      container.appendChild(item);
    });

    // Set up event listeners after rendering
    setupHotkeyEventListenersInternal();
  } catch (error) {
    console.error('Error rendering hotkeys tab:', error);
  }
}

function getDefaultActionForEntity(entity) {
  const domain = entity?.entity_id?.split('.')?.[0] || '';
  const options = getActionOptionsForDomain(domain);
  return options[0]?.value || 'toggle';
}

async function assignHotkeyToEntity(entityId, options = {}) {
  try {
    const entity = state.STATES?.[entityId];
    if (!entity) {
      showToast(t('Entity not found'), 'error', 2500);
      return { success: false, error: t('Entity not found') };
    }

    if (!state.CONFIG.globalHotkeys) {
      state.CONFIG.globalHotkeys = { enabled: false, hotkeys: {} };
    }
    if (!state.CONFIG.globalHotkeys.hotkeys) {
      state.CONFIG.globalHotkeys.hotkeys = {};
    }

    const currentConfig = state.CONFIG.globalHotkeys.hotkeys[entityId];
    const currentAction =
      typeof currentConfig === 'object' && currentConfig?.action ? currentConfig.action : null;
    const action = options.action || currentAction || getDefaultActionForEntity(entity);
    const origin = document.activeElement;
    const openedFromField = !!origin?.classList?.contains('hotkey-input');
    const hotkey = await captureHotkey();

    if (!hotkey) {
      return { success: false, canceled: true };
    }

    const result = await window.electronAPI.registerHotkey(entityId, hotkey, action);
    if (result?.success) {
      state.CONFIG.globalHotkeys.hotkeys[entityId] = { hotkey, action };
      renderHotkeysTab();
      // The re-render replaces the field that opened the recorder, so refocus its replacement.
      if (openedFromField && !origin.isConnected) {
        const inputs = document.querySelectorAll('#hotkeys-list .hotkey-input');
        Array.from(inputs)
          .find((input) => input.dataset.entityId === entityId)
          ?.focus();
      }
      showToast(
        t('Hotkey set for {{name}}', { name: getEntityDisplayName(entity) }),
        'success',
        2200
      );
      return { success: true, hotkey, action };
    }

    const error = result?.error || t('Failed to set hotkey');
    showToast(error, 'error', 3000);
    return { success: false, error };
  } catch (error) {
    console.error('Error assigning hotkey to entity:', error);
    showToast(t('Failed to set hotkey'), 'error', 3000);
    return { success: false, error };
  }
}

async function toggleHotkeys(enabled) {
  try {
    const result = await window.electronAPI.toggleHotkeys(enabled);
    if (result.success) {
      if (state.CONFIG.globalHotkeys) {
        state.CONFIG.globalHotkeys.enabled = enabled;
      }
      globalHotkeys.enabled = enabled;
      showToast(
        enabled ? t('Global hotkeys enabled') : t('Global hotkeys disabled'),
        'success',
        2000
      );
      if (result.warning) {
        showToast(result.warning, 'warning', 4000);
      }
      return true;
    }
    showToast(result?.error || t('Error toggling hotkeys'), 'error', 3000);
  } catch (error) {
    console.error('Error toggling hotkeys:', error);
    showToast(t('Error toggling hotkeys'), 'error', 2000);
  }
  return false;
}

function getAcceleratorString(e) {
  const parts = [];
  if (e.ctrlKey) parts.push('Ctrl');
  if (e.altKey) parts.push('Alt');
  if (e.shiftKey) parts.push('Shift');
  if (e.metaKey) parts.push('Super');

  const keyMap = {
    ArrowUp: 'Up',
    ArrowDown: 'Down',
    ArrowLeft: 'Left',
    ArrowRight: 'Right',
    Space: 'Space',
    Enter: 'Enter',
    Escape: 'Esc',
    Tab: 'Tab',
    Home: 'Home',
    End: 'End',
    PageUp: 'PageUp',
    PageDown: 'PageDown',
    Delete: 'Delete',
    Insert: 'Insert',
  };

  const code = e.code;
  let key = '';

  if (keyMap[code]) {
    key = keyMap[code];
  } else if (code.startsWith('Key')) {
    key = code.substring(3);
  } else if (code.startsWith('Digit')) {
    key = code.substring(5);
  } else if (code.startsWith('Numpad')) {
    key = 'num' + code.substring(6);
  } else if (code.startsWith('F') && !isNaN(parseInt(code.substring(1)))) {
    key = code;
  } else {
    const keyIdentifier = e.key.toUpperCase();
    if (
      keyIdentifier.length === 1 &&
      !['CONTROL', 'ALT', 'SHIFT', 'META'].includes(keyIdentifier)
    ) {
      key = keyIdentifier;
    }
  }

  const isModifier = ['Control', 'Shift', 'Alt', 'Meta'].includes(e.key);
  if (!isModifier && key) {
    parts.push(key);
  }

  return parts.join('+');
}

function captureHotkey() {
  return new Promise((resolve) => {
    try {
      const modal = document.createElement('div');
      modal.className = 'hotkey-capture-modal';
      modal.setAttribute('role', 'dialog');
      modal.setAttribute('aria-modal', 'true');
      modal.setAttribute('aria-label', t('Press the desired key combination...'));
      // Nothing inside is focusable, so the dialog itself takes focus while it records.
      modal.tabIndex = -1;
      modal.innerHTML = `
                <div class="modal-content">
                    <p>${escapeHtml(t('Press the desired key combination...'))}</p>
                    <div id="hotkey-preview" class="hotkey-preview-box" role="status"></div>
                    <p><small>${escapeHtml(t('Press Esc to cancel.'))}</small></p>
                </div>
            `;
      document.body.appendChild(modal);
      // Registered as the top dialog so Escape pressed with focus on <body> reaches this overlay
      // rather than closing the dialog underneath it (Settings).
      // The trap remembers the control that opened this and hands focus back when it closes; key
      // capture listens on the document, so it still sees keys while the dialog has focus.
      trapFocus(modal, { initialFocus: false });
      modal.focus();
      // Scoped rather than by id: the overlay now animates out, so a previous capture's node can
      // still be in the document when the next one opens.
      const previewBox = modal.querySelector('#hotkey-preview');

      const onKeyDown = (e) => {
        e.preventDefault();
        e.stopPropagation();

        if (e.key === 'Escape') {
          cleanup();
          resolve(null);
          return;
        }

        const accelerator = getAcceleratorString(e);
        const isModifier = ['Control', 'Shift', 'Alt', 'Meta'].includes(e.key);

        if (!isModifier) {
          // Check if at least one modifier is held
          if (accelerator.includes('+')) {
            previewBox.textContent = accelerator;
            cleanup();
            resolve(accelerator);
          } else {
            // Show feedback that a modifier is required
            previewBox.textContent = t('{{hotkey}} (add Ctrl/Alt/Shift)', { hotkey: accelerator });
          }
        } else {
          // Just show the modifiers being pressed
          previewBox.textContent = accelerator;
        }
      };

      let cleanedUp = false;
      // Both exit paths (a captured combination and Escape) funnel through here, so the overlay
      // animates out through the shared close and is only detached once.
      const cleanup = () => {
        if (cleanedUp) return;
        cleanedUp = true;
        document.removeEventListener('keydown', onKeyDown, true);
        void closeModal(modal, { remove: true, releaseFocus: true });
      };

      document.addEventListener('keydown', onKeyDown, true);
    } catch (error) {
      console.error('Error capturing hotkey:', error);
      resolve(null);
    }
  });
}

function renderExistingHotkeys() {
  try {
    const container = document.getElementById('existing-hotkeys-list');
    if (!container) return;

    container.innerHTML = '';
    const hotkeys = state.CONFIG.globalHotkeys?.hotkeys || {};

    Object.entries(hotkeys).forEach(([entityId, hotkey]) => {
      const entity = state.STATES[entityId];
      if (!entity) return;

      const item = document.createElement('div');
      item.className = 'existing-hotkey-item';
      const displayName = escapeHtml(getEntityDisplayName(entity));
      const hotkeyDisplay =
        typeof hotkey === 'string' ? escapeHtml(hotkey) : escapeHtml(hotkey.hotkey || '');
      const escapedEntityId = escapeHtmlAttribute(entityId);
      item.innerHTML = `
                <span class="entity-name">${displayName}</span>
                <span class="hotkey-display">${hotkeyDisplay}</span>
                <button class="btn-remove-hotkey" data-entity-id="${escapedEntityId}">${escapeHtml(t('Remove'))}</button>
            `;
      container.appendChild(item);
    });
  } catch (error) {
    console.error('Error rendering existing hotkeys:', error);
  }
}

// Flag to track if listeners have been set up
let listenersSetUp = false;
// Store the reference to the change handler for cleanup
let containerChangeHandler = null;
let activeContainer = null;

function setupHotkeyEventListenersInternal() {
  try {
    // Prevent duplicate event listeners
    if (listenersSetUp) return;

    const container = document.getElementById('hotkeys-list');
    if (!container) return;
    activeContainer = container;

    // A new action picked in a row's select is saved and registered straight away.
    containerChangeHandler = async (e) => {
      const select = e.target.closest?.('.hotkey-action-select');
      if (!select) return;
      const entityId = select.dataset.entityId;
      const action = select.value;
      const actionLabel = select.selectedOptions[0]?.textContent || action;

      // Save to config
      const hotkeyConfig = state.CONFIG.globalHotkeys.hotkeys[entityId];
      if (hotkeyConfig) {
        const previousConfig = JSON.parse(JSON.stringify(state.CONFIG));
        // The rollback below may be sent after a profile sync pull has landed, so
        // it names the revision it was taken at and main keeps the pulled values.
        const previousRevision = window.electronAPI.getConfigRevision?.();
        if (Number.isFinite(previousRevision)) previousConfig.configRevision = previousRevision;
        const nextConfig = JSON.parse(JSON.stringify(state.CONFIG));
        const nextHotkeyConfig = nextConfig.globalHotkeys.hotkeys[entityId];
        nextConfig.globalHotkeys.hotkeys[entityId] =
          typeof nextHotkeyConfig === 'string'
            ? { hotkey: nextHotkeyConfig, action }
            : { ...nextHotkeyConfig, action };
        let updatePersisted = false;

        try {
          const updatedConfig = await window.electronAPI.updateConfig(nextConfig);
          if (!updatedConfig?.homeAssistant) {
            throw new Error(updatedConfig?.error || t('Failed to save hotkey action'));
          }
          state.setConfig(updatedConfig);
          updatePersisted = true;

          const registrationResult = await window.electronAPI.registerHotkeys();
          if (registrationResult?.success === false) {
            throw new Error(
              registrationResult.error || t('Failed to activate the updated hotkey action')
            );
          }

          showToast(t('Action updated to: {{action}}', { action: actionLabel }), 'success', 2000);
        } catch (error) {
          let failureMessage = error?.message || t('Failed to update hotkey action');
          if (updatePersisted) {
            try {
              const restoredConfig = await window.electronAPI.updateConfig(previousConfig);
              if (!restoredConfig?.homeAssistant) {
                throw new Error(restoredConfig?.error || t('Failed to restore hotkey action'));
              }
              state.setConfig(restoredConfig);
              const rollbackRegistration = await window.electronAPI.registerHotkeys();
              if (rollbackRegistration?.success === false) {
                throw new Error(
                  rollbackRegistration.error ||
                    t('The previous hotkey action was restored, but its runtime binding was not')
                );
              }
            } catch (rollbackError) {
              failureMessage = `${failureMessage}. ${rollbackError?.message || t('Rollback failed')}`;
            }
          }
          renderHotkeysTab();
          showToast(failureMessage, 'error', 4000);
        }
      }
    };
    container.addEventListener('change', containerChangeHandler);

    listenersSetUp = true;
  } catch (error) {
    console.error('Error setting up hotkey event listeners:', error);
  }
}

// Cleanup function to remove event listeners
function cleanupHotkeyEventListeners() {
  try {
    if (activeContainer && containerChangeHandler) {
      activeContainer.removeEventListener('change', containerChangeHandler);
    }
    containerChangeHandler = null;
    activeContainer = null;
    listenersSetUp = false;
  } catch (error) {
    console.error('Error cleaning up hotkey event listeners:', error);
  }
}

// Public function that can be called from outside
function setupHotkeyEventListeners() {
  // This is now a no-op since listeners are set up during rendering
  // Keeping it for backward compatibility
}

export {
  initializeHotkeys,
  renderHotkeysTab,
  toggleHotkeys,
  captureHotkey,
  renderExistingHotkeys,
  assignHotkeyToEntity,
  setupHotkeyEventListeners,
  cleanupHotkeyEventListeners,
};

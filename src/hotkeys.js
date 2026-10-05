import state from './state.js';
import { closeDialog, openDialog, renderKeepingFocus, showToast } from './ui-utils.js';
import { getEntityDisplayName, getSearchScore } from './utils.js';
import { lineIconMarkup } from './entity-icons.js';
import { getLocaleState, t } from './i18n.js';
import accelerators from './accelerators.cjs';
import entityHotkeys from './entity-hotkeys.cjs';
import { paginate, renderListPager } from './list-pager.js';

let globalHotkeys = {};
// The action picked on a row that has no hotkey yet. The list is rebuilt on every search keystroke
// and tab switch, and recording reads the action from the row, so without this the choice would
// be forgotten before the hotkey is recorded.
const pendingActions = new Map();
// Set while a recorder is open for the Settings list, so a second click on the field does not
// open another one.
let recordingEntityId = null;

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

const getPlatform = () => window.electronAPI?.platform;

// Both recorders (this dialog and the popup hotkey field in Settings) build their accelerators
// here, from the physical key, and show them as the keys are printed on this platform's keyboard.
function recordKeyEvent(event) {
  return accelerators.acceleratorFromKeyEvent(event, getPlatform());
}

function formatHotkey(accelerator) {
  return accelerators.formatAccelerator(accelerator, getPlatform());
}

// What a recorder says while the chord is not complete yet: the keys held so far, and for a key with
// nothing but Shift behind it what to add.
function describeRecording(recorded) {
  const held = formatHotkey(recorded.accelerator);
  if (!recorded.needsModifier) return held;
  return t('{{hotkey}} (add {{modifiers}})', {
    hotkey: held,
    modifiers: accelerators.formatRequiredModifiers(getPlatform()),
  });
}

// The text for a refused hotkey. Main names a clash by entity id, which means little; the renderer
// knows the name the row shows.
function describeHotkeyFailure(result, fallback) {
  const conflictId = result?.conflictEntityId;
  if (!conflictId) return result?.error || fallback;
  const entity = state.STATES?.[conflictId] || { entity_id: conflictId, attributes: {} };
  return t('Hotkey already assigned to {{entity}}', { entity: getEntityDisplayName(entity) });
}

// Brings the row that already holds a hotkey into view and marks it for a moment, the way a search
// result marks its setting, since the toast naming it is gone before anyone has found it in a list
// of hundreds.
function flashHotkeyRow(entityId) {
  const field = Array.from(document.querySelectorAll('#hotkeys-list .hotkey-input')).find(
    (input) => input.dataset.entityId === entityId
  );
  const row = field?.closest('.hotkey-item');
  if (!row) return;
  row.scrollIntoView?.({ block: 'nearest' });
  row.classList.add('settings-search-target');
  setTimeout(() => row.classList.remove('settings-search-target'), 1800);
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
function createActionSelectHTML(options, selectedAction, entityId, name) {
  const optionsHTML = options
    .map(
      (opt) =>
        `<option value="${escapeHtmlAttribute(opt.value)}"${opt.value === selectedAction ? ' selected' : ''}>${escapeHtml(opt.label)}</option>`
    )
    .join('');
  return `<select class="hotkey-action-select" data-entity-id="${escapeHtmlAttribute(entityId)}" data-focus-key="hotkey-action:${escapeHtmlAttribute(entityId)}" aria-label="${escapeHtmlAttribute(t('Hotkey action for {{name}}', { name }))}">${optionsHTML}</select>`;
}

// The list is one page of rows, and typing in the search waits for a pause: building a row for
// every entity that can take a hotkey on each keystroke took about a second in a large home.
let hotkeyListPage = 0;
let hotkeyListFilter = '';
let hotkeySearchTimer;

function scheduleHotkeysTabRender() {
  clearTimeout(hotkeySearchTimer);
  hotkeySearchTimer = setTimeout(renderHotkeysTab, 150);
}

function renderHotkeysTab() {
  try {
    const container = document.getElementById('hotkeys-list');
    if (!container) return;

    const filter = document.getElementById('hotkey-entity-search').value.toLowerCase();
    const locale = getLocaleState().activeLocale || undefined;
    // A new query starts at its first page.
    if (filter !== hotkeyListFilter) hotkeyListPage = 0;
    hotkeyListFilter = filter;
    const hotkeyEntities = Object.values(state.STATES)
      .filter((e) => entityHotkeys.supportsEntityHotkey(e.entity_id))
      .map((entity) => {
        const score = filter
          ? getSearchScore(getEntityDisplayName(entity), filter) +
            getSearchScore(entity.entity_id, filter)
          : 1;
        return { entity, score, name: getEntityDisplayName(entity) };
      })
      .filter((item) => item.score > 0)
      // Home Assistant's own order is arbitrary; name order is how the other pickers list entities.
      .sort((a, b) => b.score - a.score || a.name.localeCompare(b.name, locale));

    // The list is rebuilt after a failed action change or a cleared hotkey; the keyboard stays on the
    // same row's control (the keys below say which), not on <body> with Tab starting over.
    const shown = paginate(hotkeyEntities, hotkeyListPage);
    hotkeyListPage = shown.page;
    renderKeepingFocus(container, () => {
      container.innerHTML = '';
      if (!hotkeyEntities.length) {
        // An empty box reads as a broken list: say whether nothing matched or nothing has loaded.
        const empty = document.createElement('div');
        empty.className = 'hotkeys-empty';
        empty.setAttribute('role', 'status');
        empty.textContent = Object.keys(state.STATES).length
          ? t('No matching entities')
          : t('Connect to Home Assistant to assign hotkeys');
        container.appendChild(empty);
        return;
      }
      // One description for every field, so each says how to start recording without repeating it.
      const recordHint = document.createElement('span');
      recordHint.id = 'hotkey-record-hint';
      recordHint.className = 'sr-only';
      recordHint.textContent = t('Press Enter or Space to record a hotkey');
      container.appendChild(recordHint);
      shown.items.forEach(({ entity, name }) => {
        const hotkeyConfig = state.CONFIG.globalHotkeys?.hotkeys?.[entity.entity_id] || {};
        const hotkey = typeof hotkeyConfig === 'string' ? hotkeyConfig : hotkeyConfig.hotkey;
        const action =
          typeof hotkeyConfig === 'object' && hotkeyConfig.action
            ? hotkeyConfig.action
            : pendingActions.get(entity.entity_id) || 'toggle';
        const domain = entity.entity_id.split('.')[0];

        // Get action options based on entity type
        const actionOptions = getActionOptionsForDomain(domain);
        const actionSelectHTML = createActionSelectHTML(
          actionOptions,
          action,
          entity.entity_id,
          name
        );

        const item = document.createElement('div');
        item.className = 'hotkey-item';
        const displayName = escapeHtml(name);
        const escapedHotkey = escapeHtmlAttribute(hotkey ? formatHotkey(hotkey) : '');
        const escapedEntityId = escapeHtmlAttribute(entity.entity_id);
        // A read-only field, not a button: as a textbox it reads out the hotkey it holds, and the
        // hint says Enter and Space start a recording.
        item.innerHTML = `
                <span class="entity-name">${displayName}</span>
                <div class="hotkey-input-container">
                    <input type="text" readonly aria-label="${escapeHtmlAttribute(t('Hotkey for {{name}}', { name }))}" aria-describedby="hotkey-record-hint" aria-keyshortcuts="Enter Space" class="hotkey-input" value="${escapedHotkey}" placeholder="${escapeHtmlAttribute(t('None'))}" data-entity-id="${escapedEntityId}" data-focus-key="hotkey-input:${escapedEntityId}">
                    ${actionSelectHTML}
                    <button type="button" class="btn-clear-hotkey" title="${escapeHtmlAttribute(t('Clear hotkey'))}" aria-label="${escapeHtmlAttribute(t('Clear hotkey for {{name}}', { name }))}" data-focus-key="hotkey-clear:${escapedEntityId}">${lineIconMarkup('x')}</button>
                </div>
            `;
        container.appendChild(item);
      });
      renderListPager(container, {
        page: shown.page,
        pageCount: shown.pageCount,
        onChange: (page) => {
          hotkeyListPage = page;
          renderHotkeysTab();
        },
      });
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
  if (recordingEntityId) return { success: false, canceled: true };
  try {
    const entity = state.STATES?.[entityId];
    if (!entity) {
      showToast(t('Entity not found'), 'error', 2500);
      return { success: false, error: t('Entity not found') };
    }
    // Main refuses it too; saying so here spares recording a hotkey that cannot be kept.
    if (!entityHotkeys.supportsEntityHotkey(entityId)) {
      const error = t('Hotkeys cannot control this kind of entity');
      showToast(error, 'error', 3000);
      return { success: false, error };
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
    const action =
      options.action ||
      pendingActions.get(entityId) ||
      currentAction ||
      getDefaultActionForEntity(entity);
    const origin = document.activeElement;
    const openedFromField = !!origin?.classList?.contains('hotkey-input');
    const hotkey = await recordWithField(entityId, openedFromField ? origin : null);

    if (!hotkey) {
      return { success: false, canceled: true };
    }

    const result = await window.electronAPI.registerHotkey(entityId, hotkey, action);
    if (result?.success) {
      state.CONFIG.globalHotkeys.hotkeys[entityId] = { hotkey, action };
      pendingActions.delete(entityId);
      renderHotkeysTab();
      // The re-render replaces the field that opened the recorder, so refocus its replacement.
      if (openedFromField && !origin.isConnected) {
        const inputs = document.querySelectorAll('#hotkeys-list .hotkey-input');
        Array.from(inputs)
          .find((input) => input.dataset.entityId === entityId)
          ?.focus();
      }
      // A saved hotkey is only registered while the switch is on, and the switch is off until the
      // user turns it on. Saying "set" then would promise a shortcut that does nothing.
      if (!state.CONFIG.globalHotkeys.enabled) {
        showToast(
          t('Hotkey saved. Turn on Entity hotkeys in Settings > Hotkeys to use it.'),
          'warning',
          5000
        );
      } else if (result.requiresCompositorBinding) {
        // On Hyprland the shortcut is only a target until its bind is copied into the Hyprland
        // config, so say that instead of promising the key works (the popup hotkey does the same).
        showToast(
          t('Shortcut target registered. Copy its binding from the Hyprland shortcuts panel.'),
          'success',
          5000
        );
      } else {
        showToast(
          t('Hotkey set for {{name}}', { name: getEntityDisplayName(entity) }),
          'success',
          2200
        );
      }
      return { success: true, hotkey, action };
    }

    const error = describeHotkeyFailure(result, t('Failed to set hotkey'));
    showToast(error, 'error', 3000);
    if (result?.conflictEntityId) flashHotkeyRow(result.conflictEntityId);
    return { success: false, error };
  } catch (error) {
    console.error('Error assigning hotkey to entity:', error);
    showToast(t('Failed to set hotkey'), 'error', 3000);
    return { success: false, error };
  }
}

/**
 * Removes an entity's hotkey, for the Clear button of its Settings row and the tile menu's Remove
 * Hotkey. Says in a toast why it failed, or what main could not re-register after it. Returns true
 * when the hotkey is gone.
 */
async function clearEntityHotkey(entityId) {
  try {
    const result = await window.electronAPI.unregisterHotkey(entityId);
    if (result?.success !== true) {
      throw new Error(result?.error || t('Failed to clear hotkey'));
    }
    if (state.CONFIG.globalHotkeys?.hotkeys) delete state.CONFIG.globalHotkeys.hotkeys[entityId];
    renderHotkeysTab();
    if (result.warning) showToast(result.warning, 'warning', 4000);
    return true;
  } catch (error) {
    console.error('Failed to clear entity hotkey:', error);
    showToast(error?.message || t('Failed to clear hotkey'), 'error', 3000);
    return false;
  }
}

// The tile menu's Remove Hotkey. Nothing on the tile shows a hotkey, so a toast says it is gone.
async function removeEntityHotkey(entityId) {
  if (!(await clearEntityHotkey(entityId))) return false;
  const entity = state.STATES?.[entityId] || { entity_id: entityId, attributes: {} };
  showToast(
    t('Hotkey removed for {{name}}', { name: getEntityDisplayName(entity) }),
    'success',
    2200
  );
  return true;
}

// Runs the recorder for an entity. When it was opened from a Settings row, that row's field says
// "Recording..." behind the dialog, and the Clear button beside it steps aside, until the recorder
// is done.
async function recordWithField(entityId, field) {
  recordingEntityId = entityId;
  if (field) {
    field.dataset.recording = 'true';
    field.setAttribute('aria-busy', 'true');
    field.value = t('Recording...');
  }
  try {
    return await captureHotkey();
  } finally {
    recordingEntityId = null;
    if (field) {
      delete field.dataset.recording;
      field.removeAttribute('aria-busy');
      const configured = state.CONFIG.globalHotkeys?.hotkeys?.[entityId];
      const hotkey = typeof configured === 'string' ? configured : configured?.hotkey;
      field.value = hotkey ? formatHotkey(hotkey) : '';
    }
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
      // The switch is labelled "Entity hotkeys", and the popup hotkey is not part of it.
      showToast(
        enabled ? t('Entity hotkeys enabled') : t('Entity hotkeys disabled'),
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

function captureHotkey() {
  return new Promise((resolve) => {
    try {
      const modal = document.createElement('div');
      modal.className = 'hotkey-capture-modal';
      modal.setAttribute('aria-label', t('Press the desired key combination...'));
      // The dialog itself takes focus while it records: every key is the recording's, so a
      // focused button could not be pressed from the keyboard anyway.
      modal.tabIndex = -1;
      // Cancel is for the pointer and touch; Escape does it from the keyboard.
      modal.innerHTML = `
                <div class="modal-content">
                    <p>${escapeHtml(t('Press the desired key combination...'))}</p>
                    <div id="hotkey-preview" class="hotkey-preview-box" role="status"></div>
                    <p><small>${escapeHtml(t('Press Esc to cancel.'))}</small></p>
                    <button type="button" class="btn btn-secondary hotkey-capture-cancel" tabindex="-1">${escapeHtml(t('Cancel'))}</button>
                </div>
            `;
      document.body.appendChild(modal);
      // A dialog layer, so Escape with focus on <body> reaches this overlay rather than closing
      // the dialog underneath it (Settings), and focus returns to the control that opened it.
      // Key capture listens on the document, so it still sees keys while the dialog has focus.
      openDialog(modal, {
        display: null,
        initialFocus: false,
        dismiss: () => {
          cleanup();
          resolve(null);
        },
      });
      modal.focus();
      modal.querySelector('.hotkey-capture-cancel')?.addEventListener('click', () => {
        cleanup();
        resolve(null);
      });
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

        const recorded = recordKeyEvent(e);
        previewBox.textContent = describeRecording(recorded);
        if (recorded.complete) {
          cleanup();
          resolve(recorded.accelerator);
        }
      };

      let cleanedUp = false;
      // Both exit paths (a captured combination and Escape) funnel through here, so the overlay
      // animates out through the shared close and is only detached once.
      const cleanup = () => {
        if (cleanedUp) return;
        cleanedUp = true;
        document.removeEventListener('keydown', onKeyDown, true);
        void closeDialog(modal, { remove: true });
      };

      document.addEventListener('keydown', onKeyDown, true);
    } catch (error) {
      console.error('Error capturing hotkey:', error);
      resolve(null);
    }
  });
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
      const hotkeyConfig = state.CONFIG.globalHotkeys?.hotkeys?.[entityId];
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
      } else {
        // Nothing to save yet: the action waits for the hotkey and is recorded with it. Say so,
        // or the choice looks like it did nothing.
        pendingActions.set(entityId, action);
        showToast(
          t('Action chosen: {{action}}. It applies once you record a hotkey.', {
            action: actionLabel,
          }),
          'info',
          3500
        );
      }
    };
    container.addEventListener('change', containerChangeHandler);

    listenersSetUp = true;
  } catch (error) {
    console.error('Error setting up hotkey event listeners:', error);
  }
}

// Cleanup function to remove event listeners, and to stop a pending search from rebuilding a list
// that is no longer on screen. Settings reopens on the first page, as the other lists do.
function cleanupHotkeyEventListeners() {
  clearTimeout(hotkeySearchTimer);
  hotkeyListPage = 0;
  try {
    if (activeContainer && containerChangeHandler) {
      activeContainer.removeEventListener('change', containerChangeHandler);
    }
    containerChangeHandler = null;
    activeContainer = null;
    listenersSetUp = false;
    // An action chosen but never recorded does not outlive the Settings window.
    pendingActions.clear();
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
  scheduleHotkeysTabRender,
  toggleHotkeys,
  captureHotkey,
  assignHotkeyToEntity,
  clearEntityHotkey,
  removeEntityHotkey,
  describeHotkeyFailure,
  describeRecording,
  flashHotkeyRow,
  formatHotkey,
  recordKeyEvent,
  setupHotkeyEventListeners,
  cleanupHotkeyEventListeners,
};

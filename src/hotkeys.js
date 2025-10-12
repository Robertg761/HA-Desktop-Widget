const { ipcRenderer } = require('electron');
const state = require('./state.js');
const { showToast } = require('./ui-utils.js');
const { getEntityDisplayName, getSearchScore } = require('./utils.js');

let globalHotkeys = {};

function initializeHotkeys() {
  try {
    if (state.CONFIG && state.CONFIG.globalHotkeys) {
      globalHotkeys = state.CONFIG.globalHotkeys;
    }
  } catch (error) {
    console.error('Error initializing hotkeys:', error);
  }
}

function getActionOptionsForDomain(domain, selectedAction) {
    const options = {
        light: [
            { value: 'toggle', label: 'Toggle' },
            { value: 'turn_on', label: 'Turn On' },
            { value: 'turn_off', label: 'Turn Off' },
            { value: 'brightness_up', label: 'Brightness Up' },
            { value: 'brightness_down', label: 'Brightness Down' }
        ],
        switch: [
            { value: 'toggle', label: 'Toggle' },
            { value: 'turn_on', label: 'Turn On' },
            { value: 'turn_off', label: 'Turn Off' }
        ],
        scene: [
            { value: 'turn_on', label: 'Activate' }
        ],
        automation: [
            { value: 'trigger', label: 'Trigger' },
            { value: 'toggle', label: 'Toggle' },
            { value: 'turn_on', label: 'Enable' },
            { value: 'turn_off', label: 'Disable' }
        ],
        input_boolean: [
            { value: 'toggle', label: 'Toggle' },
            { value: 'turn_on', label: 'Turn On' },
            { value: 'turn_off', label: 'Turn Off' }
        ],
        fan: [
            { value: 'toggle', label: 'Toggle' },
            { value: 'turn_on', label: 'Turn On' },
            { value: 'turn_off', label: 'Turn Off' },
            { value: 'increase_speed', label: 'Increase Speed' },
            { value: 'decrease_speed', label: 'Decrease Speed' }
        ]
    };

    const domainOptions = options[domain] || options.switch;
    return domainOptions.map(opt => 
        `<option value="${opt.value}" ${selectedAction === opt.value ? 'selected' : ''}>${opt.label}</option>`
    ).join('');
}

function renderHotkeysTab() {
    try {
        const container = document.getElementById('hotkeys-list');
        if (!container) return;

        const filter = document.getElementById('hotkey-entity-search').value.toLowerCase();
        const hotkeyEntities = Object.values(state.STATES)
            .filter(e => ['light', 'switch', 'scene', 'automation', 'input_boolean', 'fan'].includes(e.entity_id.split('.')[0]))
            .map(entity => {
                const score = filter ? getSearchScore(getEntityDisplayName(entity), filter) + getSearchScore(entity.entity_id, filter) : 1;
                return { entity, score };
            })
            .filter(item => item.score > 0)
            .sort((a, b) => b.score - a.score);

        container.innerHTML = '';
        hotkeyEntities.forEach(({ entity }) => {
            const hotkeyConfig = state.CONFIG.globalHotkeys?.hotkeys?.[entity.entity_id] || {};
            const hotkey = (typeof hotkeyConfig === 'string') ? hotkeyConfig : hotkeyConfig.hotkey;
            const action = (typeof hotkeyConfig === 'object' && hotkeyConfig.action) ? hotkeyConfig.action : 'toggle';
            const domain = entity.entity_id.split('.')[0];

            // Generate action options based on entity type
            const actionOptions = getActionOptionsForDomain(domain, action);

            const item = document.createElement('div');
            item.className = 'hotkey-item';
            item.innerHTML = `
                <span class="entity-name">${getEntityDisplayName(entity)}</span>
                <div class="hotkey-input-container">
                    <input type="text" readonly class="hotkey-input" value="${hotkey || ''}" placeholder="No hotkey set" data-entity-id="${entity.entity_id}">
                    <select class="hotkey-action-select" data-entity-id="${entity.entity_id}">
                        ${actionOptions}
                    </select>
                    <button class="btn-clear-hotkey" title="Clear hotkey">&times;</button>
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

async function toggleHotkeys(enabled) {
  try {
    const result = await ipcRenderer.invoke('toggle-hotkeys', enabled);
    if (result.success) {
      if (state.CONFIG.globalHotkeys) {
        state.CONFIG.globalHotkeys.enabled = enabled;
      }
      globalHotkeys.enabled = enabled;
      showToast(`Global hotkeys ${enabled ? 'enabled' : 'disabled'}`, 'success', 2000);
      return true;
    }
  } catch (error) {
    console.error('Error toggling hotkeys:', error);
    showToast('Error toggling hotkeys', 'error', 2000);
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
        'ArrowUp': 'Up', 'ArrowDown': 'Down', 'ArrowLeft': 'Left', 'ArrowRight': 'Right',
        'Space': 'Space', 'Enter': 'Enter', 'Escape': 'Esc', 'Tab': 'Tab',
        'Home': 'Home', 'End': 'End', 'PageUp': 'PageUp', 'PageDown': 'PageDown',
        'Delete': 'Delete', 'Insert': 'Insert',
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
        if (keyIdentifier.length === 1 && !['CONTROL', 'ALT', 'SHIFT', 'META'].includes(keyIdentifier)) {
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
    return new Promise(resolve => {
        try {
            const modal = document.createElement('div');
            modal.className = 'hotkey-capture-modal';
            modal.innerHTML = `
                <div class="modal-content">
                    <p>Press the desired key combination...</p>
                    <div id="hotkey-preview" class="hotkey-preview-box"></div>
                    <p><small>Press Esc to cancel.</small></p>
                </div>
            `;
            document.body.appendChild(modal);
            const previewBox = document.getElementById('hotkey-preview');

            const onKeyDown = (e) => {
                e.preventDefault();
                e.stopPropagation();

                if (e.key === 'Escape') {
                    cleanup();
                    resolve(null);
                    return;
                }

                const accelerator = getAcceleratorString(e);
                previewBox.textContent = accelerator;

                const isModifier = ['Control', 'Shift', 'Alt', 'Meta'].includes(e.key);
                if (!isModifier && accelerator.includes('+')) {
                    cleanup();
                    resolve(accelerator);
                }
            };

            const cleanup = () => {
                document.removeEventListener('keydown', onKeyDown, true);
                document.body.removeChild(modal);
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
            item.innerHTML = `
                <span class="entity-name">${getEntityDisplayName(entity)}</span>
                <span class="hotkey-display">${hotkey}</span>
                <button class="btn-remove-hotkey" data-entity-id="${entityId}">Remove</button>
            `;
            container.appendChild(item);
        });
    } catch (error) {
        console.error('Error rendering existing hotkeys:', error);
    }
}

// Flag to track if listeners have been set up
let listenersSetUp = false;

function setupHotkeyEventListenersInternal() {
    try {
        // Prevent duplicate event listeners
        if (listenersSetUp) return;
        
        const container = document.getElementById('hotkeys-list');
        if (!container) return;

        // Use event delegation on the container
        container.addEventListener('change', async (e) => {
            if (e.target.classList.contains('hotkey-action-select')) {
                const entityId = e.target.dataset.entityId;
                const action = e.target.value;
                const hotkeyConfig = state.CONFIG.globalHotkeys.hotkeys[entityId];
                
                if (hotkeyConfig) {
                    // Update the action in the config
                    if (typeof hotkeyConfig === 'string') {
                        // Convert old format to new format
                        state.CONFIG.globalHotkeys.hotkeys[entityId] = {
                            hotkey: hotkeyConfig,
                            action: action
                        };
                    } else {
                        hotkeyConfig.action = action;
                    }
                    
                    // Save the updated config
                    await ipcRenderer.invoke('save-config', state.CONFIG);
                    
                    // Re-register hotkeys to apply the new action
                    await ipcRenderer.invoke('register-hotkeys');
                    
                    showToast(`Action updated to: ${action}`, 'success', 2000);
                }
            }
        });

        listenersSetUp = true;
    } catch (error) {
        console.error('Error setting up hotkey event listeners:', error);
    }
}

// Public function that can be called from outside
function setupHotkeyEventListeners() {
    // This is now a no-op since listeners are set up during rendering
    // Keeping it for backward compatibility
}

module.exports = {
    initializeHotkeys,
    renderHotkeysTab,
    toggleHotkeys,
    captureHotkey,
    renderExistingHotkeys,
    setupHotkeyEventListeners,
};

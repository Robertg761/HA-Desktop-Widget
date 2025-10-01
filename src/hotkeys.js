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
            const hotkey = state.CONFIG.globalHotkeys?.hotkeys?.[entity.entity_id] || '';
            const item = document.createElement('div');
            item.className = 'hotkey-item';
            item.innerHTML = `
                <span class="entity-name">${getEntityDisplayName(entity)}</span>
                <div class="hotkey-input-container">
                    <input type="text" readonly class="hotkey-input" value="${hotkey}" placeholder="No hotkey set" data-entity-id="${entity.entity_id}">
                    <button class="btn-clear-hotkey" title="Clear hotkey">&times;</button>
                </div>
            `;
            container.appendChild(item);
        });
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

function setupHotkeyEventListeners() {
    try {
        // Setup event listeners for hotkey management
        const container = document.getElementById('hotkeys-list');
        if (!container) return;
        
        container.addEventListener('click', async (e) => {
            if (e.target.classList.contains('btn-clear-hotkey')) {
                const input = e.target.previousElementSibling;
                const entityId = input.dataset.entityId;
            await ipcRenderer.invoke('unregister-hotkey', entityId);
            input.value = '';
            delete state.CONFIG.globalHotkeys.hotkeys[entityId];
                renderExistingHotkeys();
            }
        });
        
        const existingContainer = document.getElementById('existing-hotkeys-list');
        if (existingContainer) {
            existingContainer.addEventListener('click', async (e) => {
                if (e.target.classList.contains('btn-remove-hotkey')) {
                const entityId = e.target.dataset.entityId;
                await ipcRenderer.invoke('unregister-hotkey', entityId);
                delete state.CONFIG.globalHotkeys.hotkeys[entityId];
                    renderExistingHotkeys();
                }
            });
        }
    } catch (error) {
        console.error('Error setting up hotkey event listeners:', error);
    }
}

module.exports = {
    initializeHotkeys,
    renderHotkeysTab,
    toggleHotkeys,
    captureHotkey,
    renderExistingHotkeys,
    setupHotkeyEventListeners,
};

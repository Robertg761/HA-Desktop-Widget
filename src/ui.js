const { ipcRenderer } = require('electron');
const state = require('./state.js');
const utils = require('./utils.js');
const websocket = require('./websocket.js');
const camera = require('./camera.js');
const uiUtils = require('./ui-utils.js');
const { setIconContent } = require('./icons.js');
const Sortable = require('sortablejs');

let isReorganizeMode = false;
let sortableInstance = null; // SortableJS instance for reorganize mode

const mediaFitElements = new Set();
let mediaFitScheduled = false;
let mediaFitResizeBound = false;

function toggleReorganizeMode() {
  try {
    isReorganizeMode = !isReorganizeMode;
    const container = document.getElementById('quick-controls');
    const btn = document.getElementById('reorganize-quick-controls-btn');

    if (isReorganizeMode) {
      container.classList.add('reorganize-mode');
      if (btn) {
        setIconContent(btn, 'check', { size: 18 });
        btn.classList.add('reorganize-active');
        btn.title = 'Save & Exit Reorganize Mode (ESC)';
      }

      // Initialize SortableJS for drag-and-drop
      sortableInstance = Sortable.create(container, {
        animation: 150,
        ghostClass: 'sortable-ghost',
        chosenClass: 'sortable-chosen',
        dragClass: 'sortable-drag',
        handle: '.control-item', // Allow dragging by any part of the item
        filter: '.remove-btn, .rename-btn', // Ignore these elements
        preventOnFilter: false, // Allow clicks on filtered elements
        onEnd: () => {
          // SortableJS has already reordered the DOM
          // Just save the new order
          saveQuickAccessOrder();
        }
      });

      addRemoveButtons();
      addEscapeKeyListener();
      uiUtils.showToast('Reorganize mode enabled - Drag to reorder, click X to remove, ESC to exit', 'info', 3000);
    } else {
      // Destroy Sortable instance
      if (sortableInstance) {
        sortableInstance.destroy();
        sortableInstance = null;
      }

      container.classList.remove('reorganize-mode');
      if (btn) {
        setIconContent(btn, 'dragHandle', { size: 18 });
        btn.classList.remove('reorganize-active');
        btn.title = 'Reorganize Quick Access';
      }
      saveQuickAccessOrder();
      removeRemoveButtons();
      removeEscapeKeyListener();
      uiUtils.showToast('Quick Access order saved', 'success', 2000);
    }
  } catch (error) {
    console.error('Error toggling reorganize mode:', error);
  }
}

function addRemoveButtons() {
  try {
    const controls = document.querySelectorAll('#quick-controls .control-item');
    controls.forEach(item => {
      addButtonsToElement(item);
    });
  } catch (error) {
    console.error('Error adding remove buttons:', error);
  }
}

function removeRemoveButtons() {
  try {
    document.querySelectorAll('#quick-controls .remove-btn').forEach(btn => btn.remove());
    document.querySelectorAll('#quick-controls .rename-btn').forEach(btn => btn.remove());
  } catch (error) {
    console.error('Error removing remove buttons:', error);
  }
}

function addButtonsToElement(item) {
  try {
    // Add rename button
    if (!item.querySelector('.rename-btn')) {
      const renameBtn = document.createElement('button');
      renameBtn.className = 'rename-btn';
      setIconContent(renameBtn, 'edit', { size: 14 });
      renameBtn.title = 'Rename Entity';
      renameBtn.setAttribute('draggable', 'false');
      renameBtn.addEventListener('mousedown', (e) => {
        e.stopPropagation();
      }, true);
      renameBtn.addEventListener('dragstart', (e) => {
        e.preventDefault();
        e.stopPropagation();
        return false;
      }, true);
      renameBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        e.preventDefault();
        showRenameModal(item.dataset.entityId);
      }, true);
      item.appendChild(renameBtn);
    }

    // Add remove button
    if (!item.querySelector('.remove-btn')) {
      const removeBtn = document.createElement('button');
      removeBtn.className = 'remove-btn';
      setIconContent(removeBtn, 'close', { size: 16 });
      removeBtn.title = 'Remove from Quick Access';
      removeBtn.setAttribute('draggable', 'false');
      removeBtn.addEventListener('mousedown', (e) => {
        e.stopPropagation();
      }, true);
      removeBtn.addEventListener('dragstart', (e) => {
        e.preventDefault();
        e.stopPropagation();
        return false;
      }, true);
      removeBtn.addEventListener('click', async (e) => {
        e.stopPropagation();
        e.preventDefault();

        const entityId = item.dataset.entityId;
        const entity = state.STATES[entityId];
        const entityName = entity ? utils.getEntityDisplayName(entity) : entityId;

        const confirmed = await uiUtils.showConfirm(
          'Remove from Quick Access',
          `Remove "${entityName}" from Quick Access?`,
          { confirmText: 'Remove', confirmClass: 'btn-danger' }
        );

        if (confirmed) {
          removeFromQuickAccess(entityId);
        }
      }, true);
      item.appendChild(removeBtn);
    }
  } catch (error) {
    console.error('Error adding buttons to element:', error);
  }
}

function showRenameModal(entityId) {
  try {
    const entity = state.STATES[entityId];
    if (!entity) return;
    
    const currentName = state.CONFIG.customEntityNames?.[entityId] || entity.attributes?.friendly_name || entityId;

    const modal = document.createElement('div');
    modal.className = 'modal rename-modal';
    modal.innerHTML = `
      <div class="modal-content">
        <div class="modal-header">
          <h2>Rename Entity</h2>
          <button class="close-btn">×</button>
        </div>
        <div class="modal-body">
          <div class="form-group">
            <label for="rename-input">Display Name:</label>
            <input type="text" id="rename-input" class="form-control" value="${utils.escapeHtml(currentName)}" placeholder="Enter custom name">
          </div>
        </div>
        <div class="modal-footer">
          <button id="save-rename-btn" class="btn btn-primary">Save</button>
          <button id="reset-rename-btn" class="btn btn-secondary">Reset to Default</button>
          <button id="cancel-rename-btn" class="btn btn-secondary">Cancel</button>
        </div>
      </div>
    `;
    document.body.appendChild(modal);

    const input = modal.querySelector('#rename-input');
    const saveBtn = modal.querySelector('#save-rename-btn');
    const resetBtn = modal.querySelector('#reset-rename-btn');
    const cancelBtn = modal.querySelector('#cancel-rename-btn');
    const closeBtn = modal.querySelector('.close-btn');
    
    if (input) input.focus();
    
    if (saveBtn) {
      saveBtn.onclick = async () => {
        const newName = input.value.trim();
        if (newName && newName !== currentName) {
          // Initialize customEntityNames if it doesn't exist
          if (!state.CONFIG.customEntityNames) {
            state.CONFIG.customEntityNames = {};
          }
          state.CONFIG.customEntityNames[entityId] = newName;
          
          await ipcRenderer.invoke('update-config', state.CONFIG);
          
          renderActiveTab();
          if (isReorganizeMode) {
            const container = document.getElementById('quick-controls');
            if (container) container.classList.add('reorganize-mode');
            addRemoveButtons();
          }

          uiUtils.showToast(`Renamed to "${newName}"`, 'success', 2000);
        }
        modal.remove();
      };
    }
    
    if (resetBtn) {
      resetBtn.onclick = async () => {
        if (state.CONFIG.customEntityNames && state.CONFIG.customEntityNames[entityId]) {
          delete state.CONFIG.customEntityNames[entityId];
          
          await ipcRenderer.invoke('update-config', state.CONFIG);
          
          renderActiveTab();
          if (isReorganizeMode) {
            const container = document.getElementById('quick-controls');
            if (container) container.classList.add('reorganize-mode');
            addRemoveButtons();
          }

          uiUtils.showToast('Reset to default name', 'info', 2000);
        }
        modal.remove();
      };
    }
    
    if (cancelBtn) {
      cancelBtn.onclick = () => modal.remove();
    }

    if (closeBtn) {
      closeBtn.onclick = () => modal.remove();
    }

    modal.onclick = (e) => { if (e.target === modal) modal.remove(); };
  } catch (error) {
    console.error('Error showing rename modal:', error);
  }
}

function removeFromQuickAccess(entityId) {
  try {
    // Note: Confirmation is handled by two-click pattern in the remove button itself
    const favorites = state.CONFIG.favoriteEntities || [];
    const newFavorites = favorites.filter(id => id !== entityId);
    state.CONFIG.favoriteEntities = newFavorites;
    
    // Save to config
    ipcRenderer.invoke('update-config', state.CONFIG);

    // Re-render
    renderQuickControls();
    if (isReorganizeMode) {
      const container = document.getElementById('quick-controls');
      container.classList.add('reorganize-mode');
      addRemoveButtons();
    }
    
    uiUtils.showToast('Entity removed from Quick Access', 'success', 2000);
  } catch (error) {
    console.error('Error removing from quick access:', error);
  }
}

function saveQuickAccessOrder() {
  try {
    const container = document.getElementById('quick-controls');
    if (!container) return;
    
    const items = container.querySelectorAll('.control-item');
    const newOrder = Array.from(items).map(item => item.dataset.entityId);
    
    state.CONFIG.favoriteEntities = newOrder;
    
    // Save to config
    ipcRenderer.invoke('update-config', state.CONFIG);
  } catch (error) {
    console.error('Error saving quick access order:', error);
  }
}

// --- Core UI Rendering ---
function renderActiveTab() {
  try {
    renderQuickControls();
    renderCameras();
    updateWeatherFromHA();
    updateMediaTile();
    if (Object.keys(state.STATES).length === 0) {
      showNoConnectionMessage();
    }
  } catch (error) {
    console.error('[UI] Error rendering active tab:', error);
  }
}

function updateEntityInUI(entity) {
  try {
    if (!entity) return;

    // Update weather card if this is a weather entity
    if (entity.entity_id.startsWith('weather.')) {
      updateWeatherFromHA();
    }

    // Update media tile if this is the primary media player
    if (entity.entity_id === state.CONFIG.primaryMediaPlayer) {
      updateMediaTile();
    }

    const items = document.querySelectorAll(`.control-item[data-entity-id="${entity.entity_id}"]`);
    items.forEach(item => {
      const newControl = createControlElement(entity);
      // Preserve reorganize-mode classes if active
      if (item.classList.contains('reorganize-mode')) {
        newControl.classList.add('reorganize-mode');
      }
      item.replaceWith(newControl);

      // If in reorganize mode, add buttons to the newly created element
      // Note: SortableJS automatically handles drag behavior for all children
      if (isReorganizeMode) {
        addButtonsToElement(newControl);
      }
    });
  } catch (error) {
    console.error('Error updating entity in UI:', error);
  }
}

// --- Quick Controls ---
function renderQuickControls() {
  try {
    const container = document.getElementById('quick-controls');
    if (!container) {
      console.error('[UI] Quick controls container not found');
      return;
    }

    container.innerHTML = '';

    // Get favorite entities for quick access
    const favorites = state.CONFIG.favoriteEntities || [];

    // Iterate through ALL favorited entity IDs (not just those in STATES)
    // This ensures unavailable entities are still shown with an error state
    favorites
      .slice(0, 12)
      .forEach(entityId => {
        const entity = state.STATES[entityId];

        if (entity) {
          // Entity exists in STATES - render normally
          const control = createControlElement(entity);
          container.appendChild(control);
        } else {
          // Entity does not exist in STATES - render unavailable state
          const control = createUnavailableElement(entityId);
          container.appendChild(control);
        }
      });

    if (isReorganizeMode) {
      container.classList.add('reorganize-mode');
      addRemoveButtons();
    }
  } catch (error) {
    console.error('[UI] Error rendering quick controls:', error, error.stack);
  }
}

function createControlElement(entity) {
  try {
    const div = document.createElement('div');
    div.className = 'control-item';
    div.dataset.entityId = entity.entity_id;

    // Per-entity column span (default 2 for media, 1 otherwise)
    const span = getTileSpan(entity);
    div.dataset.span = String(span);
    try { div.style.gridColumn = `span ${span}`; } catch { /* no-op */ }

    // Check if sensor is a timer (has finishes_at, end_time, finish_time, or duration attribute)
    // Google Kitchen Timer and other timer sensors might use different attribute names or have timestamp as state
    const hasTimerAttributes = entity.attributes && (
      entity.attributes.finishes_at || 
      entity.attributes.end_time || 
      entity.attributes.finish_time ||
      entity.attributes.duration
    );
    
    // Check if entity ID contains "timer" or if state is a valid future timestamp
    const hasTimerInName = entity.entity_id.toLowerCase().includes('timer');
    let stateIsTimestamp = false;
    if (entity.state && entity.state !== 'unavailable' && entity.state !== 'unknown') {
      // Only treat as timestamp if it looks like a full ISO 8601 date-time string with time component
      // Require time component (YYYY-MM-DDTHH:mm or YYYY-MM-DD HH:mm) to avoid matching date-only sensors
      // This prevents matching calendar/date sensors showing "2025-12-25" and other date-only values
      const iso8601Pattern = /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(:\d{2})?/;
      const looksLikeTimestamp = iso8601Pattern.test(entity.state);
      if (looksLikeTimestamp) {
        const stateTime = new Date(entity.state).getTime();
        if (!isNaN(stateTime) && stateTime > Date.now()) {
          stateIsTimestamp = true;
        }
      }
    }
    
    const isTimerSensor = entity.entity_id.startsWith('sensor.') && (hasTimerAttributes || hasTimerInName || stateIsTimestamp);
    const isTimer = entity.entity_id.startsWith('timer.') || isTimerSensor;

    // Handle different entity types (matching main branch)
    if (entity.entity_id.startsWith('camera.')) {
      div.onclick = () => {
        if (!isReorganizeMode) camera.openCamera(entity.entity_id);
      };
      div.title = `Click to view ${utils.getEntityDisplayName(entity)}`;
    } else if (entity.entity_id.startsWith('sensor.') && !isTimerSensor) {
      div.onclick = () => {
        if (!isReorganizeMode) showSensorDetails(entity);
      };
      div.title = `${utils.getEntityDisplayName(entity)}: ${utils.getEntityDisplayState(entity)}`;
    } else if (isTimer) {
      div.onclick = () => {
        if (!isReorganizeMode) toggleEntity(entity);
      };
      div.title = `Click to toggle ${utils.getEntityDisplayName(entity)}`;
    } else if (entity.entity_id.startsWith('light.')) {
      setupLightControls(div, entity);
      div.title = `Click to toggle, hold for brightness control`;
    } else if (entity.entity_id.startsWith('climate.')) {
      setupClimateControls(div, entity);
      div.title = `Click to toggle, hold for temperature control`;
    } else if (entity.entity_id.startsWith('fan.')) {
      setupFanControls(div, entity);
      div.title = `Click to toggle, hold for speed control`;
    } else if (entity.entity_id.startsWith('cover.')) {
      setupCoverControls(div, entity);
      div.title = `Click to toggle, hold for position control`;
    } else if (entity.entity_id.startsWith('media_player.')) {
      div.title = `Click to play/pause, hold for controls`;
    } else {
      div.onclick = () => {
        if (!isReorganizeMode) toggleEntity(entity);
      };
      div.title = `Click to toggle ${utils.getEntityDisplayName(entity)}`;
    }
    
    const icon = utils.escapeHtml(utils.getEntityIcon(entity));
    const name = utils.escapeHtml(utils.getEntityDisplayName(entity));
    const state = utils.escapeHtml(utils.getEntityDisplayState(entity));

    let stateDisplay = '';
    if (entity.entity_id.startsWith('sensor.') && !isTimerSensor) {
      stateDisplay = `<div class="control-state">${state}</div>`;
    } else if (isTimer) {
      const timerDisplay = utils.escapeHtml(utils.getTimerDisplay ? utils.getTimerDisplay(entity) : state);
      stateDisplay = `<div class="control-state timer-countdown">${timerDisplay}</div>`;
    } else if (entity.entity_id.startsWith('light.') && entity.state === 'on' && entity.attributes.brightness) {
      const brightness = Math.round((entity.attributes.brightness / 255) * 100);
      stateDisplay = `<div class="control-state">${brightness}%</div>`;
    } else if (entity.entity_id.startsWith('light.') && entity.state !== 'on') {
      stateDisplay = `<div class="control-state">Off</div>`;
    } else if (entity.entity_id.startsWith('climate.')) {
      const temp = entity.attributes.current_temperature || entity.attributes.temperature;
      if (temp) stateDisplay = `<div class="control-state">${utils.escapeHtml(String(temp))}°</div>`;
    } else if (entity.entity_id.startsWith('media_player.')) {
      // Media player state will be handled in setupMediaPlayerControls
      stateDisplay = '';
    }

    // Special layout for timer entities (no icon, larger timer display)
    if (isTimer) {
      div.innerHTML = `
        <div class="control-info timer-layout">
          <div class="control-name">${name}</div>
          ${stateDisplay}
        </div>
      `;
      div.classList.add('timer-entity');
      div.setAttribute('data-state', entity.state);
    } else if (entity.entity_id.startsWith('media_player.')) {
      // Media player layout will be handled in setupMediaPlayerControls
      div.innerHTML = `
        <div class="control-icon">${icon}</div>
        <div class="control-info">
          <div class="control-name">${name}</div>
          ${stateDisplay}
        </div>
      `;
      div.classList.add('media-player-entity');
    } else {
      div.innerHTML = `
        <div class="control-icon">${icon}</div>
        <div class="control-info">
          <div class="control-name">${name}</div>
          ${stateDisplay}
        </div>
      `;
    }
    
    // Setup special controls after HTML is set
    if (entity.entity_id.startsWith('media_player.')) {
      setupMediaPlayerControls(div, entity);
      // Auto-fit removed - using CSS ellipsis and marquee instead
    }
    
    return div;
  } catch (error) {
    console.error('Error creating control element:', error);
    return document.createElement('div');
  }
}

/**
 * Create an unavailable entity element for favorited entities that no longer exist
 * @param {string} entityId - The entity ID that is unavailable
 * @returns {HTMLElement} - The unavailable entity element
 */
function createUnavailableElement(entityId) {
  try {
    const div = document.createElement('div');
    div.className = 'control-item unavailable-entity';
    div.dataset.entityId = entityId;
    div.dataset.span = '1';
    div.style.gridColumn = 'span 1';

    // Get custom name if available, otherwise use entity ID
    const customName = state.CONFIG.customEntityNames?.[entityId];
    const displayName = customName || entityId.split('.')[1].replace(/_/g, ' ');

    div.innerHTML = `
      <div class="control-icon unavailable-icon">⚠️</div>
      <div class="control-info">
        <div class="control-name">${utils.escapeHtml(displayName)}</div>
        <div class="control-state unavailable-state">Unavailable</div>
      </div>
    `;

    div.title = `Entity ${entityId} is unavailable. It may have been deleted or renamed in Home Assistant.`;

    return div;
  } catch (error) {
    console.error('Error creating unavailable element:', error);
    return document.createElement('div');
  }
}

function showSensorDetails(entity) {
  try {
    uiUtils.showToast(`${utils.getEntityDisplayName(entity)}: ${utils.getEntityDisplayState(entity)}`, 'info', 3000);
  } catch (error) {
    console.error('Error showing sensor details:', error);
  }
}

function setupLightControls(div, entity) {
  try {
    let pressTimer = null;
    let longPressTriggered = false;

    const startPress = (_e) => {
      if (isReorganizeMode) {
        // In reorganize mode, don't handle mousedown - let drag work
        return;
      }
      longPressTriggered = false;
      pressTimer = setTimeout(() => {
        longPressTriggered = true;
        showBrightnessSlider(entity);
      }, 500);
    };

    const cancelPress = () => clearTimeout(pressTimer);

    div.addEventListener('mousedown', startPress);
    div.addEventListener('mouseup', cancelPress);
    div.addEventListener('mouseleave', cancelPress);
    div.addEventListener('click', (e) => {
      if (isReorganizeMode || longPressTriggered) {
        e.preventDefault();
        e.stopPropagation();
        return;
      }
      toggleEntity(entity);
    });
  } catch (error) {
    console.error('Error setting up light controls:', error);
  }
}

function setupClimateControls(div, entity) {
  try {
    let pressTimer = null;
    let longPressTriggered = false;

    const startPress = (_e) => {
      if (isReorganizeMode) {
        return;
      }
      longPressTriggered = false;
      pressTimer = setTimeout(() => {
        longPressTriggered = true;
        showClimateControls(entity);
      }, 500);
    };

    const cancelPress = () => clearTimeout(pressTimer);

    div.addEventListener('mousedown', startPress);
    div.addEventListener('mouseup', cancelPress);
    div.addEventListener('mouseleave', cancelPress);
    div.addEventListener('click', (e) => {
      if (isReorganizeMode || longPressTriggered) {
        e.preventDefault();
        e.stopPropagation();
        return;
      }
      toggleEntity(entity);
    });
  } catch (error) {
    console.error('Error setting up climate controls:', error);
  }
}

function setupFanControls(div, entity) {
  try {
    let pressTimer = null;
    let longPressTriggered = false;

    const startPress = (_e) => {
      if (isReorganizeMode) {
        return;
      }
      longPressTriggered = false;
      pressTimer = setTimeout(() => {
        longPressTriggered = true;
        showFanControls(entity);
      }, 500);
    };

    const cancelPress = () => clearTimeout(pressTimer);

    div.addEventListener('mousedown', startPress);
    div.addEventListener('mouseup', cancelPress);
    div.addEventListener('mouseleave', cancelPress);
    div.addEventListener('click', (e) => {
      if (isReorganizeMode || longPressTriggered) {
        e.preventDefault();
        e.stopPropagation();
        return;
      }
      toggleEntity(entity);
    });
  } catch (error) {
    console.error('Error setting up fan controls:', error);
  }
}

function setupCoverControls(div, entity) {
  try {
    let pressTimer = null;
    let longPressTriggered = false;

    const startPress = (_e) => {
      if (isReorganizeMode) {
        return;
      }
      longPressTriggered = false;
      pressTimer = setTimeout(() => {
        longPressTriggered = true;
        showCoverControls(entity);
      }, 500);
    };

    const cancelPress = () => clearTimeout(pressTimer);

    div.addEventListener('mousedown', startPress);
    div.addEventListener('mouseup', cancelPress);
    div.addEventListener('mouseleave', cancelPress);
    div.addEventListener('click', (e) => {
      if (isReorganizeMode || longPressTriggered) {
        e.preventDefault();
        e.stopPropagation();
        return;
      }
      toggleEntity(entity);
    });
  } catch (error) {
    console.error('Error setting up cover controls:', error);
  }
}

function setupMediaPlayerControls(div, entity) {
  try {
    if (!div || !entity) return;

    // Get media info
    const mediaTitle = utils.escapeHtml(entity.attributes?.media_title || '');
    const mediaArtist = utils.escapeHtml(entity.attributes?.media_artist || '');
    const mediaAlbum = utils.escapeHtml(entity.attributes?.media_album_name || '');
    const isPlaying = entity.state === 'playing';
    const isOff = entity.state === 'off' || entity.state === 'idle';

    // Create media info display
    let mediaInfo = '';
    if (mediaTitle) {
      // Show title and artist on separate lines, album only if there's space
      mediaInfo = `<div class="media-info">
        <div class="media-title">${mediaTitle}</div>
        ${mediaArtist ? `<div class="media-artist">${mediaArtist}</div>` : ''}
        ${mediaAlbum && !mediaArtist ? `<div class="media-album">${mediaAlbum}</div>` : ''}
      </div>`;
    } else if (isOff) {
      mediaInfo = '<div class="media-info"><div class="media-title">No media</div></div>';
    } else {
      mediaInfo = '<div class="media-info"><div class="media-title">Ready</div></div>';
    }

    // Update the control info section (no inline controls; whole tile toggles)
    const controlInfo = div.querySelector('.control-info');
    if (controlInfo) {
      controlInfo.innerHTML = `
        <div class="control-name">${utils.escapeHtml(utils.getEntityDisplayName(entity))}</div>
        ${mediaInfo}
      `;
    }

    // Update album art in the icon - show when media info is present
    const controlIcon = div.querySelector('.control-icon');
    if (controlIcon) {
      // Save the original icon on first setup
      if (!controlIcon.dataset.defaultIcon) {
        controlIcon.dataset.defaultIcon = controlIcon.innerHTML;
      }

      const artworkUrl = entity.attributes?.entity_picture ||
                        entity.attributes?.media_image_url ||
                        entity.attributes?.media_content_id;

      // Show artwork when media info is present (playing or paused with media loaded)
      // Only hide when idle/off or no media info available
      const hasMediaInfo = mediaTitle && !isOff;
      if (hasMediaInfo && artworkUrl) {
        // Use ha:// protocol to proxy artwork (handles external CDNs and HA paths with auth)
        const baseUrl = state.CONFIG.homeAssistant.url.replace(/\/$/, '');

        // Determine the full URL to encode
        let urlToEncode;
        if (artworkUrl.startsWith('http://') || artworkUrl.startsWith('https://')) {
          // Already a full URL (external CDN like Spotify, YouTube)
          urlToEncode = artworkUrl;
        } else {
          // Relative path - construct full HA URL
          const imgUrl = artworkUrl.startsWith('/') ? artworkUrl : '/' + artworkUrl;
          urlToEncode = baseUrl + imgUrl;
        }

        // Encode URL in base64 for the ha:// protocol
        const encodedUrl = Buffer.from(urlToEncode).toString('base64');

        // Add cache buster for better updates (rounded to 30 seconds to allow caching)
        const cacheBuster = Math.floor(Date.now() / 30000);
        const proxyUrl = `ha://media_artwork/${encodedUrl}?t=${cacheBuster}`;

        // Replace icon with album art image
        const img = document.createElement('img');
        img.src = proxyUrl;
        img.alt = 'Album art';
        img.className = 'media-player-artwork';
        img.onerror = function() {
          // Restore original icon on error
          const icon = this.parentElement;
          if (icon && icon.dataset.defaultIcon) {
            icon.innerHTML = icon.dataset.defaultIcon;
            icon.classList.remove('has-artwork');
          }
        };
        controlIcon.innerHTML = '';
        controlIcon.appendChild(img);
        controlIcon.classList.add('has-artwork');
      } else {
        // No media info or no artwork - show original icon
        if (controlIcon.dataset.defaultIcon) {
          controlIcon.innerHTML = controlIcon.dataset.defaultIcon;
        }
        controlIcon.classList.remove('has-artwork');
      }
    }

    // Only set up event listeners once
    if (!div.dataset.mediaControlsSetup) {
      div.dataset.mediaControlsSetup = 'true';

      // Make entire tile a play/pause toggle with long-press for details
      let pressTimer = null;
      let longPressTriggered = false;

      const startPress = (_e) => {
        if (isReorganizeMode) return;
        longPressTriggered = false;
        clearTimeout(pressTimer);
        pressTimer = setTimeout(() => {
          longPressTriggered = true;
          const currentEntity = state.STATES[entity.entity_id];
          if (currentEntity) showMediaDetail(currentEntity);
        }, 500);
      };

      const cancelPress = () => { clearTimeout(pressTimer); };

      div.addEventListener('mousedown', startPress);
      div.addEventListener('mouseup', cancelPress);
      div.addEventListener('mouseleave', cancelPress);

      div.addEventListener('click', (e) => {
        if (isReorganizeMode || longPressTriggered) { e.preventDefault(); e.stopPropagation(); return; }
        const currentEntity = state.STATES[entity.entity_id];
        if (!currentEntity) return;
        const nowPlaying = currentEntity.state === 'playing' || div.getAttribute('data-media-playing') === 'true';
        callMediaPlayerService(currentEntity.entity_id, nowPlaying ? 'pause' : 'play');
      });
    }

    // Update data attributes for styling (always update these)
    div.setAttribute('data-state', entity.state);
    div.setAttribute('data-media-playing', isPlaying ? 'true' : 'false');

  } catch (error) {
    console.error('Error setting up media player controls:', error);
  }
}

// Return desired grid span for an entity (configurable per entity)
function getTileSpan(entity) {
  try {
    const id = entity.entity_id;
    const spanCfg = state.CONFIG.tileSpans && state.CONFIG.tileSpans[id];
    if (Number.isInteger(spanCfg) && spanCfg > 0) return spanCfg;
    // Media players use 2-column span for better information display with centered layout
    return id.startsWith('media_player.') ? 2 : 1;
  } catch {
    return entity.entity_id.startsWith('media_player.') ? 2 : 1;
  }
}

// Simple single-line fit: shrink font-size until text fits width
function fitSingleLine(el, opts = {}) {
  if (!el || !el.isConnected) return;
  if (!el.dataset.baseFontSize) {
    const computed = parseFloat(getComputedStyle(el).fontSize) || 12;
    el.dataset.baseFontSize = String(computed);
  }
  const base = parseFloat(el.dataset.baseFontSize) || 12;
  const max = opts.max || base;
  const min = opts.min || Math.max(base * 0.6, 8);
  if (!el.clientWidth) {
    el.style.fontSize = `${max}px`;
    return;
  }
  el.style.fontSize = `${max}px`;
  if (el.scrollWidth <= el.clientWidth + 1) {
    return;
  }
  let low = min;
  let high = max;
  let best = min;
  for (let i = 0; i < 6; i++) {
    const mid = (low + high) / 2;
    el.style.fontSize = `${mid}px`;
    if (el.scrollWidth <= el.clientWidth + 1) {
      best = mid;
      high = mid - 0.1;
    } else {
      low = mid + 0.1;
    }
  }
  el.style.fontSize = `${Math.max(min, best)}px`;
}

function fitMediaText(root) {
  try {
    if (!root || !root.isConnected) return;
    const title = root.querySelector('.media-title');
    const artist = root.querySelector('.media-artist');
    const album = root.querySelector('.media-album');
    fitSingleLine(title);
    fitSingleLine(artist);
    fitSingleLine(album);
  } catch { /* noop */ }
}

function setupMediaTextAutoFit(div) {
  try {
    if (!div) return;
    mediaFitElements.add(div);
    fitMediaText(div);
    scheduleMediaFit();
    if (!mediaFitResizeBound && typeof window !== 'undefined') {
      window.addEventListener('resize', scheduleMediaFit);
      mediaFitResizeBound = true;
    }
  } catch { /* noop */ }
}

function showMediaDetail(entity) {
  try {
    const name = utils.escapeHtml(utils.getEntityDisplayName(entity));
    const mediaTitle = utils.escapeHtml(entity.attributes?.media_title || '');
    const mediaArtist = utils.escapeHtml(entity.attributes?.media_artist || '');
    const duration = Number(entity.attributes?.media_duration) || 0; // seconds
    const basePos = Number(entity.attributes?.media_position) || 0; // seconds
    const updatedAt = entity.attributes?.media_position_updated_at ? new Date(entity.attributes.media_position_updated_at).getTime() : 0;

    const fmt = (s) => utils.formatDuration(Math.max(0, Math.floor(s)) * 1000);

    const modal = document.createElement('div');
    modal.className = 'modal media-modal';
    modal.innerHTML = `
      <div class="modal-content">
        <div class="modal-header">
          <h2>${name}</h2>
          <button class="close-btn" id="media-close">×</button>
        </div>
        <div class="modal-body">
          <div class="media-detail-info">
            <div class="media-detail-title">${mediaTitle || '—'}</div>
            ${mediaArtist ? `<div class="media-detail-artist">${mediaArtist}</div>` : ''}
          </div>
          <div class="media-progress">
            <div class="media-time-row">
              <span id="media-current">${fmt(basePos)}</span>
              <span id="media-total">${duration ? fmt(duration) : '--:--'}</span>
            </div>
            <div class="media-progress-track">
              <div class="media-progress-fill" id="media-progress-fill" style="width: 0%"></div>
            </div>
          </div>
          <div class="media-detail-controls">
            <button class="btn media-detail-prev-btn" data-action="previous_track" title="Previous"></button>
            <button class="btn play-pause-btn media-detail-play-btn" data-action="play_pause" title="Play/Pause"></button>
            <button class="btn media-detail-next-btn" data-action="next_track" title="Next"></button>
          </div>
        </div>
        <div class="modal-footer">
          <button class="btn btn-secondary" id="media-close-footer">Close</button>
        </div>
      </div>
    `;

    document.body.appendChild(modal);

    // Set SVG icons for media controls
    const { setIconContent } = require('./icons.js');
    const prevBtn = modal.querySelector('.media-detail-prev-btn');
    const playBtn = modal.querySelector('.media-detail-play-btn');
    const nextBtn = modal.querySelector('.media-detail-next-btn');

    if (prevBtn) setIconContent(prevBtn, 'skipPrevious', { size: 20 });
    if (nextBtn) setIconContent(nextBtn, 'skipNext', { size: 20 });
    if (playBtn) {
      const isPlaying = entity.state === 'playing';
      setIconContent(playBtn, isPlaying ? 'pause' : 'play', { size: 24 });
      if (isPlaying) playBtn.classList.add('playing');
    }

    const closeBtns = modal.querySelectorAll('#media-close, #media-close-footer');
    const progressFill = modal.querySelector('#media-progress-fill');
    const curEl = modal.querySelector('#media-current');
    const totalEl = modal.querySelector('#media-total');

    const getLivePos = () => {
      if (entity.state !== 'playing') return basePos;
      if (!updatedAt) return basePos;
      const delta = (Date.now() - updatedAt) / 1000;
      let p = basePos + delta;
      if (duration) p = Math.min(p, duration);
      return p;
    };

    let tick;
    const startTick = () => {
      if (tick) clearInterval(tick);
      tick = setInterval(() => {
        let p = getLivePos();
        if (duration) p = Math.min(p, duration);
        curEl.textContent = fmt(p);
        if (progressFill && duration > 0) {
          const pct = Math.max(0, Math.min(100, (p / duration) * 100));
          progressFill.style.width = pct + '%';
        }
      }, 1000);
    };

    // Wire up controls
    const updatePlayPauseBtn = () => {
      const currentEntity = state.STATES[entity.entity_id];
      const isCurrentlyPlaying = currentEntity?.state === 'playing';
      const pp = modal.querySelector('.play-pause-btn');
      if (pp) {
        const { setIconContent } = require('./icons.js');
        setIconContent(pp, isCurrentlyPlaying ? 'pause' : 'play', { size: 24 });
        pp.classList.toggle('playing', isCurrentlyPlaying);
      }
      return isCurrentlyPlaying;
    };

    modal.addEventListener('click', (e) => {
      const btn = e.target.closest('.btn');
      if (!btn) return;
      const action = btn.dataset.action;
      if (action === 'previous_track' || action === 'next_track') {
        callMediaPlayerService(entity.entity_id, action);
      } else if (action === 'play_pause') {
        const nowPlaying = updatePlayPauseBtn();
        callMediaPlayerService(entity.entity_id, nowPlaying ? 'pause' : 'play');
        // Optimistically update UI
        setTimeout(() => updatePlayPauseBtn(), 100);
      }
    });

    // Update button when entity state changes
    const updateInterval = setInterval(() => {
      if (!modal.isConnected) {
        clearInterval(updateInterval);
        return;
      }
      updatePlayPauseBtn();
    }, 500);


    // Close handlers
    const closeModal = () => {
      modal.classList.add('modal-closing');
      if (tick) clearInterval(tick);
      if (updateInterval) clearInterval(updateInterval);
      setTimeout(() => modal.remove(), 150);
    };
    closeBtns.forEach((b) => b && (b.onclick = closeModal));
    modal.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeModal(); });
    modal.onclick = (e) => { if (e.target === modal) closeModal(); };

    // Init
    if (totalEl && duration) totalEl.textContent = fmt(duration);
    startTick();

    // Animate in
    setTimeout(() => modal.classList.add('modal-open'), 10);
  } catch (error) {
    console.error('Error showing media details:', error);
  }
}

function scheduleMediaFit() {
  if (mediaFitScheduled || typeof window === 'undefined') return;
  mediaFitScheduled = true;
  window.requestAnimationFrame(() => {
    mediaFitScheduled = false;
    mediaFitElements.forEach((el) => {
      if (!el || !el.isConnected) {
        mediaFitElements.delete(el);
        return;
      }
      fitMediaText(el);
    });
  });
}

function callMediaPlayerService(entityId, action) {
  try {
    const websocket = require('./websocket.js');
    
    switch (action) {
      case 'play':
        websocket.callService('media_player', 'media_play', { entity_id: entityId });
        break;
      case 'pause':
        websocket.callService('media_player', 'media_pause', { entity_id: entityId });
        break;
      case 'next_track':
        websocket.callService('media_player', 'media_next_track', { entity_id: entityId });
        break;
      case 'previous_track':
        websocket.callService('media_player', 'media_previous_track', { entity_id: entityId });
        break;
      default:
        console.warn('Unknown media player action:', action);
    }
  } catch (error) {
    console.error('Error calling media player service:', error);
  }
}


function toggleEntity(entity) {
    try {
        const domain = entity.entity_id.split('.')[0];
        let service;
        let service_data = { entity_id: entity.entity_id };

        switch(domain) {
            case 'light':
            case 'switch':
            case 'fan':
            case 'input_boolean':
                service = 'toggle';
                break;
            case 'lock':
                service = entity.state === 'locked' ? 'unlock' : 'lock';
                break;
            case 'cover':
                service = entity.state === 'open' ? 'close_cover' : 'open_cover';
                break;
            case 'scene':
            case 'script':
                service = 'turn_on';
                // Add activation animation for scenes and scripts
                triggerActivationFeedback(entity.entity_id);
                break;
            default:
                // No toggle action for this domain
                return;
        }
        websocket.callService(domain === 'light' ? 'homeassistant' : domain, service, service_data);
    } catch (error) {
        console.error('Error toggling entity:', error);
    }
}

function triggerActivationFeedback(entityId) {
    try {
        const tile = document.querySelector(`[data-entity-id="${entityId}"]`);
        if (tile) {
            tile.classList.add('activating');
            setTimeout(() => {
                tile.classList.remove('activating');
            }, 600);
        }
    } catch (error) {
        console.error('Error triggering activation feedback:', error);
    }
}

function executeHotkeyAction(entity, action) {
  try {
    const domain = entity.entity_id.split('.')[0];
    const currentBrightness = entity.attributes?.brightness || 0;
    
    switch (action) {
      case 'toggle':
        toggleEntity(entity);
        break;
      case 'turn_on':
        websocket.callService(domain, 'turn_on', { entity_id: entity.entity_id });
        break;
      case 'turn_off':
        websocket.callService(domain, 'turn_off', { entity_id: entity.entity_id });
        break;
      case 'brightness_up':
        // Increase brightness by 20% (51 units out of 255)
        if (domain === 'light') {
          const newBrightness = Math.min(255, currentBrightness + 51);
          websocket.callService('light', 'turn_on', { 
            entity_id: entity.entity_id,
            brightness: newBrightness
          });
        }
        break;
      case 'brightness_down':
        // Decrease brightness by 20% (51 units out of 255)
        if (domain === 'light') {
          const newBrightness = Math.max(0, currentBrightness - 51);
          websocket.callService('light', 'turn_on', { 
            entity_id: entity.entity_id,
            brightness: newBrightness
          });
        }
        break;
      case 'trigger':
        // For automations
        if (domain === 'automation') {
          websocket.callService('automation', 'trigger', { entity_id: entity.entity_id });
        }
        break;
      case 'increase_speed':
        // For fans - increase percentage by 33%
        if (domain === 'fan') {
          const currentPercentage = entity.attributes?.percentage || 0;
          const newPercentage = Math.min(100, currentPercentage + 33);
          websocket.callService('fan', 'set_percentage', { 
            entity_id: entity.entity_id,
            percentage: newPercentage
          });
        }
        break;
      case 'decrease_speed':
        // For fans - decrease percentage by 33%
        if (domain === 'fan') {
          const currentPercentage = entity.attributes?.percentage || 0;
          const newPercentage = Math.max(0, currentPercentage - 33);
          websocket.callService('fan', 'set_percentage', { 
            entity_id: entity.entity_id,
            percentage: newPercentage
          });
        }
        break;
      default:
        // Default to toggle for backward compatibility
        toggleEntity(entity);
    }
  } catch (error) {
    console.error(`Error executing hotkey action '${action}' for entity ${entity.entity_id}:`, error);
  }
}
function renderCameras() {
  try {
    const container = document.getElementById('cameras-container');
    const section = document.getElementById('cameras-section');
    if (!container || !section) return;
    
    const cameras = Object.values(state.STATES).filter(e => e.entity_id.startsWith('camera.'));
    
    if (cameras.length === 0) {
      section.style.display = 'none';
      return;
    }
    
    section.style.display = 'block';
    container.innerHTML = '';
    
    cameras.slice(0, 4).forEach(cameraEntity => {
      const card = createCameraCard(cameraEntity);
      container.appendChild(card);
    });
  } catch (error) {
    console.error('Error rendering cameras:', error);
  }
}

function createCameraCard(cameraEntity) {
  try {
    const div = document.createElement('div');
    div.className = 'camera-card';
    const name = utils.escapeHtml(utils.getEntityDisplayName(cameraEntity));

    div.innerHTML = `
      <div class="camera-header">
        <div class="camera-name">${name}</div>
      </div>
      <div class="camera-embed">
        <img class="camera-img" alt="${name}" src="ha://camera/${cameraEntity.entity_id}?t=${Date.now()}">
      </div>
    `;
    return div;
  } catch (error) {
    console.error('Error creating camera card:', error);
    return document.createElement('div');
  }
}

// --- Weather ---
function updateWeatherFromHA() {
  try {
    const weatherEntity = state.STATES[state.CONFIG.selectedWeatherEntity] || Object.values(state.STATES).find(e => e.entity_id.startsWith('weather.'));
    if (!weatherEntity) return;

    const tempEl = document.getElementById('weather-temp');
    const conditionEl = document.getElementById('weather-condition');
    const humidityEl = document.getElementById('weather-humidity');
    const windEl = document.getElementById('weather-wind');
    const iconEl = document.getElementById('weather-icon');

    if (tempEl) tempEl.textContent = `${Math.round(weatherEntity.attributes.temperature || 0)}°`;
    if (conditionEl) conditionEl.textContent = weatherEntity.state || '--';
    if (humidityEl) humidityEl.textContent = `${weatherEntity.attributes.humidity || 0}%`;
    if (windEl) windEl.textContent = `${weatherEntity.attributes.wind_speed || 0} km/h`;
    
    // Update weather icon based on current condition
    if (iconEl) {
      const condition = weatherEntity.state?.toLowerCase() || '';
      let icon = '🌤️'; // default
      let classes = 'weather-icon';
      
      if (condition.includes('sunny') || condition === 'clear') {
        icon = '☀️';
        classes += ' sunny';
      } else if (condition.includes('partly') || condition.includes('cloudy')) {
        icon = '⛅';
        classes += ' cloudy';
      } else if (condition.includes('rain') || condition.includes('rainy')) {
        icon = '🌧️';
        classes += ' rain';
      } else if (condition.includes('snow') || condition.includes('snowy')) {
        icon = '❄️';
        classes += ' snow';
      } else if (condition.includes('storm') || condition.includes('thunder') || condition.includes('lightning')) {
        icon = '⛈️';
        classes += ' storm';
      } else if (condition.includes('fog') || condition.includes('mist') || condition.includes('haze')) {
        icon = '🌫️';
      } else if (condition.includes('wind')) {
        icon = '💨';
        classes += ' wind';
      } else if (condition.includes('cloud')) {
        icon = '☁️';
        classes += ' cloudy';
      } else if (condition.includes('night') || condition.includes('clear-night')) {
        icon = '🌙';
      }
      
      iconEl.textContent = icon;
      iconEl.className = classes;
    }
  } catch (error) {
    console.error('Error updating weather:', error);
  }
}

// --- Media Player Tile ---
function updateMediaTile() {
  try {
    const tile = document.getElementById('media-tile');
    if (!tile) return;
    
    // Check if a primary media player is configured
    const primaryPlayer = state.CONFIG.primaryMediaPlayer;
    if (!primaryPlayer) {
      tile.style.display = 'none';
      return;
    }
    
    // Get the media player entity
    const entity = state.STATES[primaryPlayer];
    if (!entity) {
      tile.style.display = 'none';
      return;
    }
    
    // Show the tile
    tile.style.display = 'grid';
    
    // Update artwork
    const artworkContainer = document.getElementById('media-tile-artwork');
    // Try multiple artwork sources (smart speakers might use different attributes)
    let artworkUrl = entity.attributes?.entity_picture || 
                     entity.attributes?.media_image_url ||
                     entity.attributes?.media_content_id;
    
    // Some media players provide thumbnail or image_url
    if (!artworkUrl && entity.attributes?.media_album_name) {
      // If we have album info but no artwork, entity_picture might update later
      artworkUrl = entity.attributes?.entity_picture;
    }
    
    if (artworkUrl && artworkContainer) {
      // Use the ha:// protocol to proxy artwork (handles both external CDN URLs and HA-relative paths)
      // This bypasses CSP restrictions and adds authentication when needed
      const baseUrl = state.CONFIG.homeAssistant.url.replace(/\/$/, '');

      // Determine the full URL to encode
      let urlToEncode;
      if (artworkUrl.startsWith('http://') || artworkUrl.startsWith('https://')) {
        // Already a full URL (external CDN like Spotify, YouTube)
        urlToEncode = artworkUrl;
      } else {
        // Relative path - construct full HA URL
        const imgUrl = artworkUrl.startsWith('/') ? artworkUrl : '/' + artworkUrl;
        urlToEncode = baseUrl + imgUrl;
      }

      // Encode URL in base64 for the ha:// protocol
      const encodedUrl = Buffer.from(urlToEncode).toString('base64');

      // Add cache buster for better updates (rounded to 30 seconds to allow caching)
      const cacheBuster = Math.floor(Date.now() / 30000);
      const proxyUrl = `ha://media_artwork/${encodedUrl}?t=${cacheBuster}`;

      // Create img element safely without inline event handler
      const img = document.createElement('img');
      img.src = proxyUrl;
      img.alt = 'Album art';
      img.onerror = function() {
        this.parentElement.innerHTML = '<div class="media-tile-artwork-placeholder">🎵</div>';
      };
      artworkContainer.innerHTML = '';
      artworkContainer.appendChild(img);
    } else if (artworkContainer) {
      artworkContainer.innerHTML = '<div class="media-tile-artwork-placeholder">🎵</div>';
    }
    
    // Update media info
    const titleEl = document.getElementById('media-tile-title');
    const artistEl = document.getElementById('media-tile-artist');
    const mediaTitle = entity.attributes?.media_title || 'No media playing';
    const mediaArtist = entity.attributes?.media_artist || '';
    
    if (titleEl) titleEl.textContent = mediaTitle;
    if (artistEl) artistEl.textContent = mediaArtist;
    
    // Update seek bar
    updateMediaSeekBar(entity);
    
    // Update play/pause button
    const playBtn = document.getElementById('media-tile-play');
    if (playBtn) {
      const isPlaying = entity.state === 'playing';
      // Update icon using the icon system
      const { setIconContent } = require('./icons.js');
      setIconContent(playBtn, isPlaying ? 'pause' : 'play', { size: 30 });
      playBtn.classList.toggle('playing', isPlaying);
    }
  } catch (error) {
    console.error('Error updating media tile:', error);
  }
}

function updateMediaSeekBar(entity) {
  try {
    if (!entity) return;
    
    const seekFill = document.getElementById('media-tile-seek-fill');
    const timeCurrent = document.getElementById('media-tile-time-current');
    const timeTotal = document.getElementById('media-tile-time-total');
    
    const duration = Number(entity.attributes?.media_duration) || 0;
    const basePosition = Number(entity.attributes?.media_position) || 0;
    const updatedAt = entity.attributes?.media_position_updated_at ? new Date(entity.attributes.media_position_updated_at).getTime() : 0;
    
    // Calculate current position (accounting for playback if playing)
    let currentPosition = basePosition;
    if (entity.state === 'playing' && updatedAt) {
      const elapsedSinceUpdate = (Date.now() - updatedAt) / 1000;
      currentPosition = Math.min(basePosition + elapsedSinceUpdate, duration);
    }
    
    // Format time as mm:ss or h:mm:ss when hours are present
    const formatTime = (seconds) => {
      const totalSeconds = Math.max(0, Math.floor(seconds));
      const hours = Math.floor(totalSeconds / 3600);
      const mins = Math.floor((totalSeconds % 3600) / 60);
      const secs = totalSeconds % 60;
      const minPart = hours > 0 ? mins.toString().padStart(2, '0') : mins.toString();
      const secPart = secs.toString().padStart(2, '0');
      return hours > 0 ? `${hours}:${minPart}:${secPart}` : `${minPart}:${secPart}`;
    };
    
    // Update UI
    if (timeCurrent) timeCurrent.textContent = formatTime(currentPosition);
    if (timeTotal) timeTotal.textContent = duration > 0 ? formatTime(duration) : '0:00';
    
    if (seekFill && duration > 0) {
      const percentage = Math.max(0, Math.min(100, (currentPosition / duration) * 100));
      seekFill.style.width = `${percentage}%`;
    } else if (seekFill) {
      seekFill.style.width = '0%';
    }
  } catch (error) {
    console.error('Error updating seek bar:', error);
  }
}

function callMediaTileService(action) {
  try {
    const primaryPlayer = state.CONFIG.primaryMediaPlayer;
    if (!primaryPlayer) return;
    
    const serviceCalls = {
      'play': () => websocket.callService('media_player', 'media_play', { entity_id: primaryPlayer }),
      'pause': () => websocket.callService('media_player', 'media_pause', { entity_id: primaryPlayer }),
      'previous': () => websocket.callService('media_player', 'media_previous_track', { entity_id: primaryPlayer }),
      'next': () => websocket.callService('media_player', 'media_next_track', { entity_id: primaryPlayer })
    };
    
    if (serviceCalls[action]) {
      serviceCalls[action]();
    }
  } catch (error) {
    console.error('Error calling media tile service:', error);
  }
}

// --- Misc UI ---
function showNoConnectionMessage() {
  try {
    const container = document.getElementById('quick-controls');
    if (container) {
      // Check if configuration needs setup
      if (!state.CONFIG ||
          !state.CONFIG.homeAssistant ||
          state.CONFIG.homeAssistant.token === 'YOUR_LONG_LIVED_ACCESS_TOKEN') {
        container.innerHTML = `
          <div class="status-message">
            <h3>⚙️ Setup Required</h3>
            <p>Your Home Assistant connection needs to be configured.</p>
            <p>Click the settings button (⚙️) in the top right to:</p>
            <ul style="margin: 10px 0; padding-left: 20px;">
              <li>Set your Home Assistant URL</li>
              <li>Add your Long-Lived Access Token</li>
            </ul>
            <p><strong>Status:</strong> Configuration incomplete</p>
          </div>`;
      } else {
        container.innerHTML = `
          <div class="status-message">
            <h3>🔄 Connecting to Home Assistant</h3>
            <p>Attempting to connect to: ${utils.escapeHtml(state.CONFIG.homeAssistant.url)}</p>
            <p><strong>Status:</strong> Connecting...</p>
            <p style="margin-top: 10px; font-size: 12px; opacity: 0.8;">
              If this persists, check your Home Assistant URL and token in settings.
            </p>
          </div>`;
      }
    }
  } catch (error) {
    console.error('Error showing no connection message:', error);
  }
}

function updateTimeDisplay() {
  try {
    const now = new Date();
    const timeEl = document.getElementById('current-time');
    const dateEl = document.getElementById('current-date');
    
    if (timeEl) timeEl.textContent = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    if (dateEl) dateEl.textContent = now.toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' });
  } catch (error) {
    console.error('Error updating time display:', error);
  }
}

function updateTimerDisplays() {
  try {
    // Find all timer entities AND sensor entities with timer attributes in Quick Access
    const timerElements = document.querySelectorAll('.control-item.timer-entity');
    
    timerElements.forEach(timerEl => {
      const entityId = timerEl.dataset.entityId;
      const entity = state.STATES[entityId];
      
      if (!entity) return;
      
      // Handle timer.* entities
      if (entityId.startsWith('timer.')) {
        if (entity.state !== 'active') return;
        
        // Calculate remaining time
        const finishesAt = entity.attributes?.finishes_at;
        if (!finishesAt) return;
        
        const endTime = new Date(finishesAt).getTime();
        const now = Date.now();
        const remaining = Math.max(0, Math.floor((endTime - now) / 1000));
        
        // Format as mm:ss or hh:mm:ss
        const hours = Math.floor(remaining / 3600);
        const minutes = Math.floor((remaining % 3600) / 60);
        const seconds = remaining % 60;
        
        let display;
        if (hours > 0) {
          display = `${hours}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
        } else {
          display = `${minutes}:${String(seconds).padStart(2, '0')}`;
        }
        
        // Update the countdown display
        const countdownEl = timerEl.querySelector('.timer-countdown');
        if (countdownEl && countdownEl.textContent !== display) {
          countdownEl.textContent = display;
        }
      }
      // Handle sensor.* entities that are timers (like Google Kitchen Timer)
      else if (entityId.startsWith('sensor.')) {
        // Check for various timer end time attributes
        let finishesAt = entity.attributes?.finishes_at || 
                         entity.attributes?.end_time || 
                         entity.attributes?.finish_time;
        
        // If no attribute, check if state is a timestamp (Google Kitchen Timer uses state as timestamp)
        if (!finishesAt && entity.state && entity.state !== 'unavailable' && entity.state !== 'unknown') {
          // Only treat as timestamp if it looks like a full ISO 8601 date-time string with time component
          // Require time component (YYYY-MM-DDTHH:mm or YYYY-MM-DD HH:mm) to avoid matching date-only sensors
          // This prevents matching calendar/date sensors showing "2025-12-25" and other date-only values
          const iso8601Pattern = /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(:\d{2})?/;
          const looksLikeTimestamp = iso8601Pattern.test(entity.state);
          if (looksLikeTimestamp) {
            const stateTime = new Date(entity.state).getTime();
            if (!isNaN(stateTime)) {
              finishesAt = entity.state;
            }
          }
        }
        
        if (!finishesAt) return;
        
        // Check if timer is active (finishes_at is in the future)
        const endTime = new Date(finishesAt).getTime();
        const now = Date.now();
        
        if (endTime <= now) {
          // Timer finished
          const countdownEl = timerEl.querySelector('.timer-countdown');
          if (countdownEl) {
            countdownEl.textContent = 'Finished';
          }
          return;
        }
        
        const remaining = Math.max(0, Math.floor((endTime - now) / 1000));
        
        // Format as mm:ss or hh:mm:ss
        const hours = Math.floor(remaining / 3600);
        const minutes = Math.floor((remaining % 3600) / 60);
        const seconds = remaining % 60;
        
        let display;
        if (hours > 0) {
          display = `${hours}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
        } else {
          display = `${minutes}:${String(seconds).padStart(2, '0')}`;
        }
        
        // Update the countdown display
        const countdownEl = timerEl.querySelector('.timer-countdown');
        if (countdownEl && countdownEl.textContent !== display) {
          countdownEl.textContent = display;
        }
      }
    });
  } catch {
    // Silent fail - timers will just show static state from entity updates
  }
}

function showBrightnessSlider(light) {
  try {
    const name = utils.escapeHtml(utils.getEntityDisplayName(light));
    const currentBrightness = light.state === 'on' && light.attributes.brightness ? Math.round((light.attributes.brightness / 255) * 100) : 0;

    const modal = document.createElement('div');
    modal.className = 'modal brightness-modal';
    modal.innerHTML = `
      <div class="modal-content brightness-modal-content">
        <div class="modal-header">
          <h2>${name}</h2>
          <button class="close-btn" id="brightness-close" title="Close">×</button>
        </div>
        <div class="modal-body">
          <div class="brightness-content">
            <div class="brightness-icon-wrapper">
              <div class="brightness-icon" id="brightness-icon">💡</div>
            </div>
            <div class="brightness-value-large" id="brightness-value-large">${currentBrightness}%</div>
            <div class="brightness-label">Brightness</div>
            <div class="brightness-slider-wrapper">
              <input 
                type="range" 
                min="0" 
                max="100" 
                value="${currentBrightness}" 
                id="brightness-slider" 
                class="brightness-slider" 
                aria-label="Brightness" 
                orient="vertical" 
              />
            </div>
            <div class="brightness-presets">
              <button class="brightness-preset-btn" data-preset="25">25%</button>
              <button class="brightness-preset-btn" data-preset="50">50%</button>
              <button class="brightness-preset-btn" data-preset="75">75%</button>
              <button class="brightness-preset-btn" data-preset="100">100%</button>
            </div>
          </div>
        </div>
        <div class="modal-footer">
          <button class="btn btn-secondary" id="brightness-cancel">Close</button>
          <button class="btn btn-primary" id="turn-off-btn">Turn Off</button>
        </div>
      </div>
    `;
    document.body.appendChild(modal);

    const slider = modal.querySelector('#brightness-slider');
    const valueLarge = modal.querySelector('#brightness-value-large');
    const icon = modal.querySelector('#brightness-icon');
    const closeBtn = modal.querySelector('#brightness-close');
    const cancelBtn = modal.querySelector('#brightness-cancel');
    const turnOffBtn = modal.querySelector('#turn-off-btn');
    const presetButtons = modal.querySelectorAll('.brightness-preset-btn');

    // Track current light state
    let lightIsOn = light.state === 'on';

    // Update turn off/on button text
    const updateTurnButton = () => {
      if (turnOffBtn) {
        turnOffBtn.textContent = lightIsOn ? 'Turn Off' : 'Turn On';
      }
    };
    updateTurnButton();

    // Close handlers
    const closeModal = () => {
      modal.classList.add('modal-closing');
      setTimeout(() => modal.remove(), 200);
    };
    if (closeBtn) closeBtn.onclick = closeModal;
    if (cancelBtn) cancelBtn.onclick = closeModal;
    modal.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeModal(); });

    // Animate in
    setTimeout(() => modal.classList.add('modal-open'), 10);

    // Keep focus within modal (basic)
    setTimeout(() => {
      const focusable = modal.querySelector('.brightness-slider') || closeBtn || cancelBtn;
      if (focusable && focusable.focus) focusable.focus();
    }, 0);

    // Update icon and accent based on brightness
    const updateIconAndAccent = (value) => {
      if (!icon) return;
      if (value === 0) {
        icon.textContent = '💤';
        icon.className = 'brightness-icon brightness-off';
      } else if (value <= 25) {
        icon.textContent = '🌑';
        icon.className = 'brightness-icon brightness-low';
      } else if (value <= 50) {
        icon.textContent = '🌓';
        icon.className = 'brightness-icon brightness-mid';
      } else if (value <= 75) {
        icon.textContent = '🌕';
        icon.className = 'brightness-icon brightness-high';
      } else {
        icon.textContent = '☀️';
        icon.className = 'brightness-icon brightness-max';
      }
    };

    // Slider behavior with debounce
    if (slider) {
      let debounceTimer;
      const applyValue = (value) => {
        if (valueLarge) valueLarge.textContent = `${value}%`;
        updateIconAndAccent(value);
        clearTimeout(debounceTimer);
        debounceTimer = setTimeout(() => {
          const brightness = Math.round((value / 100) * 255);
          if (brightness > 0) {
            websocket.callService('light', 'turn_on', { entity_id: light.entity_id, brightness });
          } else {
            websocket.callService('light', 'turn_off', { entity_id: light.entity_id });
          }
        }, 120);
      };
      slider.addEventListener('input', (e) => {
        const value = parseInt(e.target.value, 10) || 0;
        applyValue(value);
      });
      // Initialize icon/accent
      updateIconAndAccent(currentBrightness);
    }

    // Presets
    presetButtons.forEach(btn => {
      btn.addEventListener('click', () => {
        const preset = parseInt(btn.getAttribute('data-preset'), 10) || 0;
        const sliderEl = modal.querySelector('#brightness-slider');
        if (sliderEl) {
          sliderEl.value = String(preset);
          sliderEl.dispatchEvent(new Event('input', { bubbles: true }));
        }
      });
    });

    // Turn off/on button
    if (turnOffBtn) {
      turnOffBtn.onclick = () => {
        if (lightIsOn) {
          websocket.callService('light', 'turn_off', { entity_id: light.entity_id });
          lightIsOn = false;
          if (slider) slider.value = '0';
          if (valueLarge) valueLarge.textContent = '0%';
          updateIconAndAccent(0);
        } else {
          // Turn on to last brightness or 100%
          const brightness = currentBrightness > 0 ? Math.round((currentBrightness / 100) * 255) : 255;
          websocket.callService('light', 'turn_on', { entity_id: light.entity_id, brightness });
          lightIsOn = true;
          const targetValue = currentBrightness > 0 ? currentBrightness : 100;
          if (slider) slider.value = String(targetValue);
          if (valueLarge) valueLarge.textContent = `${targetValue}%`;
          updateIconAndAccent(targetValue);
        }
        updateTurnButton();
      };
    }

    // Close on backdrop click only when clicking the overlay
    modal.onclick = (e) => { if (e.target === modal) closeModal(); };
  } catch (error) {
    console.error('Error showing brightness slider:', error);
  }
}

function showClimateControls(climateEntity) {
  try {
    const name = utils.escapeHtml(utils.getEntityDisplayName(climateEntity));
    const currentTemp = climateEntity.attributes.current_temperature || 0;
    const targetTemp = climateEntity.attributes.temperature || 20;
    const currentMode = climateEntity.state || 'off';
    const minTemp = climateEntity.attributes.min_temp || 10;
    const maxTemp = climateEntity.attributes.max_temp || 30;
    const tempUnit = utils.escapeHtml(climateEntity.attributes.unit_of_measurement || '°C');
    const availableModes = climateEntity.attributes.hvac_modes || ['off', 'heat', 'cool', 'auto'];

    const modal = document.createElement('div');
    modal.className = 'modal climate-modal';
    modal.innerHTML = `
      <div class="modal-content climate-modal-content">
        <div class="modal-header">
          <h2>${name}</h2>
          <button class="close-btn" id="climate-close" title="Close">×</button>
        </div>
        <div class="modal-body">
          <div class="climate-content">
            <div class="climate-temp-display">
              <div class="climate-current-temp">
                <div class="climate-temp-label">Current</div>
                <div class="climate-temp-value">${currentTemp}${tempUnit}</div>
              </div>
              <div class="climate-target-temp">
                <div class="climate-temp-label">Target</div>
                <div class="climate-temp-value-large" id="climate-target-value">${targetTemp}${tempUnit}</div>
              </div>
            </div>

            <div class="climate-slider-wrapper">
              <input
                type="range"
                min="${minTemp}"
                max="${maxTemp}"
                step="0.5"
                value="${targetTemp}"
                id="climate-slider"
                class="climate-slider"
                aria-label="Target Temperature"
              />
              <div class="climate-slider-labels">
                <span>${minTemp}${tempUnit}</span>
                <span>${maxTemp}${tempUnit}</span>
              </div>
            </div>

            <div class="climate-modes">
              <div class="climate-modes-label">Mode</div>
              <div class="climate-mode-buttons" id="climate-mode-buttons">
                ${availableModes.map(mode => `
                  <button
                    class="climate-mode-btn ${mode === currentMode ? 'active' : ''}"
                    data-mode="${mode}"
                    title="${mode.charAt(0).toUpperCase() + mode.slice(1)}"
                  >
                    <span class="climate-mode-icon">${getModeIcon(mode)}</span>
                    <span class="climate-mode-label">${mode.charAt(0).toUpperCase() + mode.slice(1)}</span>
                  </button>
                `).join('')}
              </div>
            </div>
          </div>
        </div>
        <div class="modal-footer">
          <button class="btn btn-secondary" id="climate-cancel">Close</button>
        </div>
      </div>
    `;
    document.body.appendChild(modal);

    const slider = modal.querySelector('#climate-slider');
    const targetValue = modal.querySelector('#climate-target-value');
    const closeBtn = modal.querySelector('#climate-close');
    const cancelBtn = modal.querySelector('#climate-cancel');
    const modeButtons = modal.querySelectorAll('.climate-mode-btn');

    // Helper function to get mode icons
    function getModeIcon(mode) {
      const icons = {
        'off': '⏻',
        'heat': '🔥',
        'cool': '❄️',
        'auto': '🔄',
        'heat_cool': '🔄',
        'fan_only': '💨',
        'dry': '💧'
      };
      return icons[mode] || '⚙️';
    }

    // Close handlers
    const closeModal = () => {
      modal.classList.add('modal-closing');
      setTimeout(() => modal.remove(), 200);
    };
    if (closeBtn) closeBtn.onclick = closeModal;
    if (cancelBtn) cancelBtn.onclick = closeModal;
    modal.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeModal(); });

    // Animate in
    setTimeout(() => modal.classList.add('modal-open'), 10);

    // Temperature slider behavior with debounce
    if (slider) {
      let debounceTimer;
      slider.addEventListener('input', (e) => {
        const value = parseFloat(e.target.value);
        if (targetValue) targetValue.textContent = `${value}${tempUnit}`;

        clearTimeout(debounceTimer);
        debounceTimer = setTimeout(() => {
          websocket.callService('climate', 'set_temperature', {
            entity_id: climateEntity.entity_id,
            temperature: value
          });
        }, 300);
      });
    }

    // Mode button handlers
    modeButtons.forEach(btn => {
      btn.addEventListener('click', () => {
        const mode = btn.getAttribute('data-mode');

        // Update UI immediately
        modeButtons.forEach(b => b.classList.remove('active'));
        btn.classList.add('active');

        // Call service
        websocket.callService('climate', 'set_hvac_mode', {
          entity_id: climateEntity.entity_id,
          hvac_mode: mode
        });
      });
    });

    // Close on backdrop click
    modal.onclick = (e) => { if (e.target === modal) closeModal(); };
  } catch (error) {
    console.error('Error showing climate controls:', error);
  }
}

function showFanControls(fanEntity) {
  try {
    const name = utils.escapeHtml(utils.getEntityDisplayName(fanEntity));
    const currentSpeed = fanEntity.attributes.percentage || 0;
    const isOn = fanEntity.state === 'on';

    const modal = document.createElement('div');
    modal.className = 'modal fan-modal';
    modal.innerHTML = `
      <div class="modal-content fan-modal-content">
        <div class="modal-header">
          <h2>${name}</h2>
          <button class="close-btn" id="fan-close" title="Close">×</button>
        </div>
        <div class="modal-body">
          <div class="fan-content">
            <div class="fan-icon-wrapper">
              <div class="fan-icon ${isOn ? 'spinning' : ''}" id="fan-icon">💨</div>
            </div>
            <div class="fan-speed-value" id="fan-speed-value">${currentSpeed}%</div>
            <div class="fan-speed-label">Fan Speed</div>

            <div class="fan-slider-wrapper">
              <input
                type="range"
                min="0"
                max="100"
                step="1"
                value="${currentSpeed}"
                id="fan-slider"
                class="fan-slider"
                aria-label="Fan Speed"
              />
            </div>

            <div class="fan-presets">
              <button class="fan-preset-btn" data-speed="0">Off</button>
              <button class="fan-preset-btn" data-speed="33">Low</button>
              <button class="fan-preset-btn" data-speed="66">Medium</button>
              <button class="fan-preset-btn" data-speed="100">High</button>
            </div>
          </div>
        </div>
        <div class="modal-footer">
          <button class="btn btn-secondary" id="fan-cancel">Close</button>
        </div>
      </div>
    `;
    document.body.appendChild(modal);

    const slider = modal.querySelector('#fan-slider');
    const speedValue = modal.querySelector('#fan-speed-value');
    const fanIcon = modal.querySelector('#fan-icon');
    const closeBtn = modal.querySelector('#fan-close');
    const cancelBtn = modal.querySelector('#fan-cancel');
    const presetButtons = modal.querySelectorAll('.fan-preset-btn');

    // Close handlers
    const closeModal = () => {
      modal.classList.add('modal-closing');
      setTimeout(() => modal.remove(), 200);
    };
    if (closeBtn) closeBtn.onclick = closeModal;
    if (cancelBtn) cancelBtn.onclick = closeModal;
    modal.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeModal(); });

    // Animate in
    setTimeout(() => modal.classList.add('modal-open'), 10);

    // Update icon based on speed
    const updateIcon = (speed) => {
      if (!fanIcon) return;
      if (speed > 0) {
        fanIcon.classList.add('spinning');
      } else {
        fanIcon.classList.remove('spinning');
      }
    };

    // Slider behavior with debounce
    if (slider) {
      let debounceTimer;
      slider.addEventListener('input', (e) => {
        const speed = parseInt(e.target.value, 10);
        if (speedValue) speedValue.textContent = `${speed}%`;
        updateIcon(speed);

        clearTimeout(debounceTimer);
        debounceTimer = setTimeout(() => {
          if (speed > 0) {
            websocket.callService('fan', 'set_percentage', {
              entity_id: fanEntity.entity_id,
              percentage: speed
            });
          } else {
            websocket.callService('fan', 'turn_off', {
              entity_id: fanEntity.entity_id
            });
          }
        }, 200);
      });
    }

    // Preset buttons
    presetButtons.forEach(btn => {
      btn.addEventListener('click', () => {
        const speed = parseInt(btn.getAttribute('data-speed'), 10);
        if (slider) {
          slider.value = String(speed);
          slider.dispatchEvent(new Event('input', { bubbles: true }));
        }
      });
    });

    // Close on backdrop click
    modal.onclick = (e) => { if (e.target === modal) closeModal(); };
  } catch (error) {
    console.error('Error showing fan controls:', error);
  }
}

function showCoverControls(coverEntity) {
  try {
    const name = utils.escapeHtml(utils.getEntityDisplayName(coverEntity));
    const currentPosition = coverEntity.attributes.current_position || 0;
    const state = coverEntity.state;

    const modal = document.createElement('div');
    modal.className = 'modal cover-modal';
    modal.innerHTML = `
      <div class="modal-content cover-modal-content">
        <div class="modal-header">
          <h2>${name}</h2>
          <button class="close-btn" id="cover-close" title="Close">×</button>
        </div>
        <div class="modal-body">
          <div class="cover-content">
            <div class="cover-visual">
              <div class="cover-icon-container">
                <div class="cover-icon" id="cover-icon">🪟</div>
                <div class="cover-overlay" id="cover-overlay" style="height: ${100 - currentPosition}%"></div>
              </div>
            </div>
            <div class="cover-position-value" id="cover-position-value">${currentPosition}%</div>
            <div class="cover-position-label">Position</div>

            <div class="cover-slider-wrapper">
              <input
                type="range"
                min="0"
                max="100"
                step="1"
                value="${currentPosition}"
                id="cover-slider"
                class="cover-slider"
                aria-label="Cover Position"
              />
              <div class="cover-slider-labels">
                <span>Closed</span>
                <span>Open</span>
              </div>
            </div>

            <div class="cover-actions">
              <button class="cover-action-btn" data-action="close_cover">
                <span class="cover-action-icon">⬇</span>
                <span class="cover-action-label">Close</span>
              </button>
              <button class="cover-action-btn" data-action="stop_cover">
                <span class="cover-action-icon">⏸</span>
                <span class="cover-action-label">Stop</span>
              </button>
              <button class="cover-action-btn" data-action="open_cover">
                <span class="cover-action-icon">⬆</span>
                <span class="cover-action-label">Open</span>
              </button>
            </div>
          </div>
        </div>
        <div class="modal-footer">
          <button class="btn btn-secondary" id="cover-cancel">Close</button>
        </div>
      </div>
    `;
    document.body.appendChild(modal);

    const slider = modal.querySelector('#cover-slider');
    const positionValue = modal.querySelector('#cover-position-value');
    const coverOverlay = modal.querySelector('#cover-overlay');
    const closeBtn = modal.querySelector('#cover-close');
    const cancelBtn = modal.querySelector('#cover-cancel');
    const actionButtons = modal.querySelectorAll('.cover-action-btn');

    // Close handlers
    const closeModal = () => {
      modal.classList.add('modal-closing');
      setTimeout(() => modal.remove(), 200);
    };
    if (closeBtn) closeBtn.onclick = closeModal;
    if (cancelBtn) cancelBtn.onclick = closeModal;
    modal.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeModal(); });

    // Animate in
    setTimeout(() => modal.classList.add('modal-open'), 10);

    // Update visual overlay based on position
    const updateVisual = (position) => {
      if (coverOverlay) {
        coverOverlay.style.height = `${100 - position}%`;
      }
    };

    // Slider behavior with debounce
    if (slider) {
      let debounceTimer;
      slider.addEventListener('input', (e) => {
        const position = parseInt(e.target.value, 10);
        if (positionValue) positionValue.textContent = `${position}%`;
        updateVisual(position);

        clearTimeout(debounceTimer);
        debounceTimer = setTimeout(() => {
          websocket.callService('cover', 'set_cover_position', {
            entity_id: coverEntity.entity_id,
            position: position
          });
        }, 300);
      });
    }

    // Action buttons
    actionButtons.forEach(btn => {
      btn.addEventListener('click', () => {
        const action = btn.getAttribute('data-action');
        websocket.callService('cover', action, {
          entity_id: coverEntity.entity_id
        });

        // Visual feedback
        if (action === 'open_cover' && slider) {
          slider.value = '100';
          if (positionValue) positionValue.textContent = '100%';
          updateVisual(100);
        } else if (action === 'close_cover' && slider) {
          slider.value = '0';
          if (positionValue) positionValue.textContent = '0%';
          updateVisual(0);
        }
      });
    });

    // Close on backdrop click
    modal.onclick = (e) => { if (e.target === modal) closeModal(); };
  } catch (error) {
    console.error('Error showing cover controls:', error);
  }
}

function populateDomainFilters() {
    try {
        const container = document.getElementById('filter-domains');
        if (!container) return;
        const allDomains = [...new Set(Object.values(state.STATES).map(e => e.entity_id.split('.')[0]))].sort();
        container.innerHTML = allDomains.map(domain => `
            <label>
                <input type="checkbox" value="${utils.escapeHtml(domain)}" ${state.FILTERS.domains.includes(domain) ? 'checked' : ''}>
                ${utils.escapeHtml(domain)}
            </label>
        `).join('');
    } catch (error) {
        console.error('Error populating domain filters:', error);
    }
}

function populateAreaFilter() {
    try {
        const select = document.getElementById('filter-areas');
        if (!select) return;
        select.innerHTML = Object.values(state.AREAS).map(area => `
            <option value="${utils.escapeHtml(area.area_id)}" ${state.FILTERS.areas.includes(area.area_id) ? 'selected' : ''}>
                ${utils.escapeHtml(area.name)}
            </option>
        `).join('');
    } catch (error) {
        console.error('Error populating area filter:', error);
    }
}

function setupEntitySearchInput(inputId, _allowedDomains = null) {
    try {
        const input = document.getElementById(inputId);
        if (!input) return;
        
        input.addEventListener('input', (e) => {
            const query = e.target.value.toLowerCase();
            const container = document.getElementById(inputId.replace('-search', '-list')) || 
                            document.getElementById(inputId.replace('-search', '-entities-list'));
            if (!container) return;
            
            const items = container.querySelectorAll('.entity-item, .hotkey-item, .alert-item');
            items.forEach(item => {
                const text = item.textContent.toLowerCase();
                const matches = text.includes(query);
                item.style.display = matches ? 'block' : 'none';
            });
        });
    } catch (error) {
        console.error('Error setting up entity search input:', error);
    }
}

function populateQuickControlsList() {
    try {
        const list = document.getElementById('quick-controls-list');
        const searchInput = document.getElementById('quick-controls-search');
        if (!list) return;
        
        const renderList = () => {
            const filter = searchInput ? searchInput.value.toLowerCase() : '';
            const favorites = state.CONFIG.favoriteEntities || [];
            
            // Score and filter entities
            const scoredEntities = Object.values(state.STATES)
                .filter(e => !e.entity_id.startsWith('sun.') && !e.entity_id.startsWith('zone.'))
                .map(entity => {
                    if (!filter) {
                        return { entity, score: 1 };
                    }
                    // Search both display name and entity ID
                    const nameScore = utils.getSearchScore(utils.getEntityDisplayName(entity), filter);
                    const idScore = utils.getSearchScore(entity.entity_id, filter);
                    return { entity, score: nameScore + idScore };
                })
                .filter(item => item.score > 0)
                .sort((a, b) => {
                    // Sort by score first, then alphabetically
                    if (b.score !== a.score) {
                        return b.score - a.score;
                    }
                    return utils.getEntityDisplayName(a.entity).localeCompare(utils.getEntityDisplayName(b.entity));
                });
            
            list.innerHTML = '';
            
            scoredEntities.forEach(({ entity }) => {
                const item = document.createElement('div');
                item.className = 'entity-item';
                
                const isFavorite = favorites.includes(entity.entity_id);

                item.innerHTML = `
                    <div class="entity-item-main">
                        <span class="entity-icon">${utils.escapeHtml(utils.getEntityIcon(entity))}</span>
                        <div class="entity-item-info">
                            <span class="entity-name">${utils.escapeHtml(utils.getEntityDisplayName(entity))}</span>
                            <span class="entity-id" title="${utils.escapeHtml(entity.entity_id)}">${utils.escapeHtml(entity.entity_id)}</span>
                        </div>
                    </div>
                    <button class="entity-selector-btn ${isFavorite ? 'remove' : 'add'}" data-entity-id="${utils.escapeHtml(entity.entity_id)}">
                        ${isFavorite ? 'Remove' : 'Add'}
                    </button>
                `;
                
                const button = item.querySelector('button');
                button.onclick = () => toggleQuickAccess(entity.entity_id);
                
                list.appendChild(item);
            });
        };
        
        // Initial render
        renderList();
        
        // Set up search with proper scoring
        if (searchInput) {
            searchInput.value = '';
            searchInput.oninput = () => renderList();
            // Note: Focus is managed by trapFocus() in renderer.js when modal opens
        }
    } catch (error) {
        console.error('Error populating quick controls list:', error);
    }
}

function toggleQuickAccess(entityId) {
    try {
        const favorites = state.CONFIG.favoriteEntities || [];

        if (favorites.includes(entityId)) {
            // Remove from favorites
            state.CONFIG.favoriteEntities = favorites.filter(id => id !== entityId);
        } else {
            // Add to favorites
            state.CONFIG.favoriteEntities = [...favorites, entityId];
        }

        // Save and update UI
        ipcRenderer.invoke('update-config', state.CONFIG);
        renderQuickControls();
        populateQuickControlsList();
    } catch (error) {
        console.error('Error toggling quick access:', error);
    }
}

function initUpdateUI() {
    try {
        const { version } = require('../package.json');
        
        // Set current version
        const currentVersionEl = document.getElementById('current-version');
        if (currentVersionEl) {
            currentVersionEl.textContent = `v${version}`;
        }
        
        // Wire up check for updates button
        const checkUpdatesBtn = document.getElementById('check-updates-btn');
        const updateStatusText = document.getElementById('update-status-text');
        const installUpdateBtn = document.getElementById('install-update-btn');
        const updateProgress = document.getElementById('update-progress');
        const progressFill = document.getElementById('progress-fill');
        const progressText = document.getElementById('progress-text');
        
        // Enable the check button
        if (checkUpdatesBtn) {
            checkUpdatesBtn.disabled = false;
            checkUpdatesBtn.onclick = async () => {
                // Disable button and show checking status
                if (checkUpdatesBtn) checkUpdatesBtn.disabled = true;
                if (updateStatusText) updateStatusText.textContent = 'Checking for updates...';
                
                try {
                    const result = await ipcRenderer.invoke('check-for-updates');
                    if (result.status === 'dev') {
                        // In development mode, auto-updater doesn't work
                        if (updateStatusText) updateStatusText.textContent = 'Auto-updates only work in packaged builds';
                        if (checkUpdatesBtn) checkUpdatesBtn.disabled = false;
                    }
                    // In packaged mode, the auto-update events will update the UI
                    // The button will be re-enabled by the event handlers
                } catch (error) {
                    console.error('Error checking for updates:', error);
                    if (updateStatusText) updateStatusText.textContent = 'Error checking for updates';
                    if (checkUpdatesBtn) checkUpdatesBtn.disabled = false;
                }
            };
        }
        
        // Wire up install button
        if (installUpdateBtn) {
            installUpdateBtn.onclick = () => {
                ipcRenderer.invoke('quit-and-install');
            };
        }
        
        // Listen for auto-update events from main process
        ipcRenderer.on('auto-update', (event, data) => {
            try {
                if (!data) return;
                
                switch (data.status) {
                    case 'checking':
                        if (updateStatusText) updateStatusText.textContent = 'Checking for updates...';
                        if (checkUpdatesBtn) checkUpdatesBtn.disabled = true;
                        if (installUpdateBtn) installUpdateBtn.classList.add('hidden');
                        if (updateProgress) updateProgress.classList.add('hidden');
                        break;
                        
                    case 'available':
                        if (updateStatusText) {
                            const version = data.info?.version || 'unknown';
                            updateStatusText.textContent = `Update available: v${version}`;
                        }
                        if (checkUpdatesBtn) checkUpdatesBtn.disabled = false;
                        if (updateProgress) updateProgress.classList.remove('hidden');
                        break;
                        
                    case 'none':
                        if (updateStatusText) updateStatusText.textContent = 'You are up to date!';
                        if (checkUpdatesBtn) checkUpdatesBtn.disabled = false;
                        if (installUpdateBtn) installUpdateBtn.classList.add('hidden');
                        if (updateProgress) updateProgress.classList.add('hidden');
                        break;
                        
                    case 'downloading':
                        if (updateStatusText) updateStatusText.textContent = 'Downloading update...';
                        if (checkUpdatesBtn) checkUpdatesBtn.disabled = true;
                        if (updateProgress) updateProgress.classList.remove('hidden');
                        if (data.progress) {
                            const percent = Math.round(data.progress.percent);
                            if (progressFill) progressFill.style.width = `${percent}%`;
                            if (progressText) progressText.textContent = `${percent}%`;
                        }
                        break;
                        
                    case 'downloaded':
                        if (updateStatusText) {
                            const version = data.info?.version || 'unknown';
                            updateStatusText.textContent = `Update v${version} ready to install`;
                        }
                        if (checkUpdatesBtn) checkUpdatesBtn.disabled = false;
                        if (installUpdateBtn) installUpdateBtn.classList.remove('hidden');
                        if (updateProgress) updateProgress.classList.add('hidden');
                        break;
                        
                    case 'error':
                        if (updateStatusText) {
                            updateStatusText.textContent = `Error: ${data.error || 'Unknown error'}`;
                        }
                        if (checkUpdatesBtn) checkUpdatesBtn.disabled = false;
                        if (installUpdateBtn) installUpdateBtn.classList.add('hidden');
                        if (updateProgress) updateProgress.classList.add('hidden');
                        break;
                }
            } catch (error) {
                console.error('Error handling auto-update event:', error);
            }
        });
        
        // Initialize with ready status
        if (updateStatusText) updateStatusText.textContent = 'Ready to check for updates';
        
    } catch (error) {
        console.error('Error initializing update UI:', error);
    }
}


// ESC key handler for reorganize mode
function handleEscapeKey(e) {
  if (e.key === 'Escape' && isReorganizeMode) {
    e.preventDefault();
    e.stopPropagation();
    toggleReorganizeMode();
  }
}

function addEscapeKeyListener() {
  document.addEventListener('keydown', handleEscapeKey);
}

function removeEscapeKeyListener() {
  document.removeEventListener('keydown', handleEscapeKey);
}


module.exports = {
  renderActiveTab,
  updateEntityInUI,
  updateWeatherFromHA,
  populateAreaFilter,
  populateDomainFilters,
  setupEntitySearchInput,
  initUpdateUI,
  updateTimeDisplay,
  updateTimerDisplays,
  toggleReorganizeMode,
  populateQuickControlsList,
  executeHotkeyAction,
  updateMediaTile,
  updateMediaSeekBar,
  callMediaTileService,
};

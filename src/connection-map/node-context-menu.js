/**
 * Node Context Menu Module
 * Windows-style right-click context menu for graph nodes with quick actions.
 */

import * as d3 from 'd3';
import log from '../logger.js';
import state from '../state.js';
import websocket from '../websocket.js';
import relationshipStore from './relationship-store.js';

/** @type {HTMLElement|null} Context menu element */
let menuElement = null;

/** @type {Object|null} Currently targeted node */
let targetNode = null;

/** @type {Function|null} Callback when "View Details" is clicked */
let onViewDetails = null;

/** @type {Function|null} Callback when "Focus Node" is clicked */
let onFocusNode = null;

/**
 * Quick action definitions by entity domain.
 */
const QUICK_ACTIONS = {
    light: [
        { id: 'toggle', label: 'Toggle', icon: '💡', service: 'light.toggle' },
        { id: 'turn_on', label: 'Turn On', icon: '🔆', service: 'light.turn_on' },
        { id: 'turn_off', label: 'Turn Off', icon: '🌑', service: 'light.turn_off' },
    ],
    switch: [
        { id: 'toggle', label: 'Toggle', icon: '🔘', service: 'switch.toggle' },
        { id: 'turn_on', label: 'Turn On', icon: '✅', service: 'switch.turn_on' },
        { id: 'turn_off', label: 'Turn Off', icon: '⬜', service: 'switch.turn_off' },
    ],
    fan: [
        { id: 'toggle', label: 'Toggle', icon: '🌀', service: 'fan.toggle' },
    ],
    cover: [
        { id: 'open', label: 'Open', icon: '⬆️', service: 'cover.open_cover' },
        { id: 'close', label: 'Close', icon: '⬇️', service: 'cover.close_cover' },
        { id: 'stop', label: 'Stop', icon: '⏹️', service: 'cover.stop_cover' },
    ],
    lock: [
        { id: 'lock', label: 'Lock', icon: '🔒', service: 'lock.lock' },
        { id: 'unlock', label: 'Unlock', icon: '🔓', service: 'lock.unlock' },
    ],
    automation: [
        { id: 'trigger', label: 'Trigger', icon: '▶️', service: 'automation.trigger' },
        { id: 'toggle', label: 'Toggle Enable', icon: '🔄', service: 'automation.toggle' },
    ],
    script: [
        { id: 'run', label: 'Run Script', icon: '▶️', service: 'script.turn_on' },
    ],
    scene: [
        { id: 'activate', label: 'Activate', icon: '🎭', service: 'scene.turn_on' },
    ],
    input_boolean: [
        { id: 'toggle', label: 'Toggle', icon: '🔄', service: 'input_boolean.toggle' },
    ],
    climate: [
        { id: 'toggle', label: 'Toggle', icon: '🌡️', service: 'climate.toggle' },
    ],
    media_player: [
        { id: 'play_pause', label: 'Play/Pause', icon: '⏯️', service: 'media_player.media_play_pause' },
    ],
};

/**
 * Initializes the context menu module.
 * @param {Object} callbacks
 * @param {Function} callbacks.onViewDetails - Called when View Details is clicked
 * @param {Function} callbacks.onFocusNode - Called when Focus Node is clicked
 */
export function initContextMenu(callbacks = {}) {
    onViewDetails = callbacks.onViewDetails || null;
    onFocusNode = callbacks.onFocusNode || null;

    // Create menu element if it doesn't exist
    if (!menuElement) {
        menuElement = document.createElement('div');
        menuElement.className = 'node-context-menu';
        menuElement.style.display = 'none';
        document.body.appendChild(menuElement);

        // Close menu when clicking outside
        document.addEventListener('click', (e) => {
            if (menuElement && !menuElement.contains(e.target)) {
                hideContextMenu();
            }
        });

        // Close menu on Escape
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') {
                hideContextMenu();
            }
        });
    }

    log.debug('[ConnectionMap] Context menu initialized');
}

/**
 * Shows the context menu for a node.
 * @param {Object} node - The graph node
 * @param {number} x - Screen X position
 * @param {number} y - Screen Y position
 */
export function showContextMenu(node, x, y) {
    if (!menuElement) return;

    targetNode = node;

    // Build menu content
    const menuContent = buildMenuContent(node);
    menuElement.innerHTML = menuContent;

    // Wire up action buttons
    wireMenuActions();

    // Position and show menu
    menuElement.style.left = `${x}px`;
    menuElement.style.top = `${y}px`;
    menuElement.style.display = 'block';

    // Adjust position if menu goes off screen
    requestAnimationFrame(() => {
        const rect = menuElement.getBoundingClientRect();
        const viewportWidth = window.innerWidth;
        const viewportHeight = window.innerHeight;

        if (rect.right > viewportWidth) {
            menuElement.style.left = `${x - rect.width}px`;
        }
        if (rect.bottom > viewportHeight) {
            menuElement.style.top = `${y - rect.height}px`;
        }
    });

    log.debug(`[ConnectionMap] Context menu shown for: ${node.id}`);
}

/**
 * Hides the context menu.
 */
export function hideContextMenu() {
    if (menuElement) {
        menuElement.style.display = 'none';
    }
    targetNode = null;
}

/**
 * Builds the menu HTML content.
 * @param {Object} node
 * @returns {string}
 */
function buildMenuContent(node) {
    const entityState = state.STATES?.[node.id];
    const currentState = entityState?.state || 'unknown';
    const friendlyName = entityState?.attributes?.friendly_name || node.label;

    let html = `
    <div class="context-menu-header">
      <span class="context-menu-icon">${getNodeIcon(node)}</span>
      <div class="context-menu-title">
        <span class="context-menu-name">${escapeHtml(friendlyName)}</span>
        <span class="context-menu-state state-${currentState}">${currentState}</span>
      </div>
    </div>
    <div class="context-menu-divider"></div>
  `;

    // Add quick actions based on domain
    const domain = node.domain || node.type;
    const actions = QUICK_ACTIONS[domain];

    if (actions && actions.length > 0) {
        html += `<div class="context-menu-section">`;
        for (const action of actions) {
            html += `
        <button class="context-menu-item" data-action="service" data-service="${action.service}" data-entity="${node.id}">
          <span class="item-icon">${action.icon}</span>
          <span class="item-label">${action.label}</span>
        </button>
      `;
        }
        html += `</div><div class="context-menu-divider"></div>`;
    }

    // Always show these options
    html += `
    <div class="context-menu-section">
      <button class="context-menu-item" data-action="focus">
        <span class="item-icon">🔍</span>
        <span class="item-label">Focus Node</span>
      </button>
      <button class="context-menu-item" data-action="details">
        <span class="item-icon">📋</span>
        <span class="item-label">View Details</span>
      </button>
      <button class="context-menu-item" data-action="copy-id">
        <span class="item-icon">📎</span>
        <span class="item-label">Copy Entity ID</span>
      </button>
    </div>
  `;

    return html;
}

/**
 * Wires up click handlers for menu items.
 */
function wireMenuActions() {
    if (!menuElement) return;

    const items = menuElement.querySelectorAll('.context-menu-item');
    items.forEach((item) => {
        item.addEventListener('click', handleMenuItemClick);
    });
}

/**
 * Handles menu item click.
 * @param {Event} e
 */
async function handleMenuItemClick(e) {
    const button = e.currentTarget;
    const action = button.dataset.action;

    switch (action) {
        case 'service':
            await callService(button.dataset.service, button.dataset.entity);
            break;

        case 'focus':
            if (onFocusNode && targetNode) {
                onFocusNode(targetNode);
            }
            break;

        case 'details':
            if (onViewDetails && targetNode) {
                onViewDetails(targetNode);
            }
            break;

        case 'copy-id':
            if (targetNode) {
                await navigator.clipboard.writeText(targetNode.id);
                showToast('Entity ID copied!');
            }
            break;
    }

    hideContextMenu();
}

/**
 * Calls a Home Assistant service.
 * @param {string} service - Service to call (e.g., 'light.toggle')
 * @param {string} entityId - Entity ID
 */
async function callService(service, entityId) {
    const [domain, serviceName] = service.split('.');

    log.debug(`[ConnectionMap] Calling service: ${service} on ${entityId}`);

    try {
        await websocket.request({
            type: 'call_service',
            domain,
            service: serviceName,
            service_data: {},
            target: {
                entity_id: entityId,
            },
        });

        showToast(`${serviceName} executed`);
    } catch (error) {
        log.error(`[ConnectionMap] Service call failed:`, error);
        showToast(`Failed: ${error.message}`, 'error');
    }
}

/**
 * Gets the appropriate icon for a node.
 * @param {Object} node
 * @returns {string}
 */
function getNodeIcon(node) {
    const ICONS = {
        light: '💡',
        switch: '🔘',
        sensor: '📊',
        binary_sensor: '⚡',
        climate: '🌡️',
        cover: '🪟',
        fan: '🌀',
        media_player: '🎵',
        camera: '📷',
        lock: '🔒',
        automation: '⚙️',
        script: '📜',
        scene: '🎭',
        device: '📱',
        area: '🏠',
        integration: '🔌',
    };

    return ICONS[node.domain] || ICONS[node.type] || '●';
}

/**
 * Shows a toast notification.
 * @param {string} message
 * @param {string} [type='success']
 */
function showToast(message, type = 'success') {
    // Use existing toast system if available, otherwise console
    if (window.uiUtils?.showToast) {
        window.uiUtils.showToast(message, type, 2000);
    } else {
        log.info(`[Toast] ${message}`);
    }
}

/**
 * Escapes HTML entities.
 * @param {string} str
 * @returns {string}
 */
function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
}

export { targetNode };

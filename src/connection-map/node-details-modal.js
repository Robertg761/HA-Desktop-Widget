/**
 * Node Details Modal Module
 * Comprehensive details popup with tabs for entity info, history, and connections.
 */

import log from '../logger.js';
import state from '../state.js';
import websocket from '../websocket.js';
import relationshipStore from './relationship-store.js';

/** @type {HTMLElement|null} Modal element */
let modalElement = null;

/** @type {Object|null} Currently displayed node */
let currentNode = null;

/** @type {string} Current active tab */
let activeTab = 'overview';

/**
 * Initializes the details modal.
 */
export function initDetailsModal() {
    // Create modal if it doesn't exist
    if (!modalElement) {
        createModalElement();
    }
    log.debug('[ConnectionMap] Details modal initialized');
}

/**
 * Creates the modal DOM element.
 */
function createModalElement() {
    modalElement = document.createElement('div');
    modalElement.className = 'node-details-modal';
    modalElement.innerHTML = `
    <div class="details-modal-backdrop"></div>
    <div class="details-modal-container">
      <div class="details-modal-header">
        <div class="details-header-info">
          <span class="details-icon"></span>
          <div class="details-title-wrap">
            <h2 class="details-title"></h2>
            <span class="details-entity-id"></span>
          </div>
          <span class="details-state-badge"></span>
        </div>
        <button class="details-close-btn" title="Close">×</button>
      </div>
      <div class="details-modal-tabs">
        <button class="details-tab active" data-tab="overview">Overview</button>
        <button class="details-tab" data-tab="history">History</button>
        <button class="details-tab" data-tab="connections">Connections</button>
      </div>
      <div class="details-modal-content">
        <div class="details-tab-panel active" data-panel="overview"></div>
        <div class="details-tab-panel" data-panel="history"></div>
        <div class="details-tab-panel" data-panel="connections"></div>
      </div>
    </div>
  `;

    // Wire up events
    modalElement.querySelector('.details-close-btn').addEventListener('click', hideDetailsModal);
    modalElement.querySelector('.details-modal-backdrop').addEventListener('click', hideDetailsModal);

    // Tab switching
    modalElement.querySelectorAll('.details-tab').forEach((tab) => {
        tab.addEventListener('click', () => switchTab(tab.dataset.tab));
    });

    // Escape to close
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && modalElement?.classList.contains('visible')) {
            hideDetailsModal();
        }
    });

    document.body.appendChild(modalElement);
}

/**
 * Shows the details modal for a node.
 * @param {Object} node - The graph node to display
 */
export async function showDetailsModal(node) {
    if (!modalElement) {
        createModalElement();
    }

    currentNode = node;
    activeTab = 'overview';

    // Update header
    updateHeader(node);

    // Reset tabs
    modalElement.querySelectorAll('.details-tab').forEach((t) => t.classList.remove('active'));
    modalElement.querySelector('[data-tab="overview"]').classList.add('active');
    modalElement.querySelectorAll('.details-tab-panel').forEach((p) => p.classList.remove('active'));
    modalElement.querySelector('[data-panel="overview"]').classList.add('active');

    // Load overview tab (default)
    await loadOverviewTab(node);

    // Show modal
    modalElement.classList.add('visible');

    log.debug(`[ConnectionMap] Details modal shown for: ${node.id}`);
}

/**
 * Hides the details modal.
 */
export function hideDetailsModal() {
    if (modalElement) {
        modalElement.classList.remove('visible');
    }
    currentNode = null;
}

/**
 * Updates the modal header.
 * @param {Object} node
 */
function updateHeader(node) {
    const entityState = state.STATES?.[node.id];
    const friendlyName = entityState?.attributes?.friendly_name || node.label;
    const currentState = entityState?.state || 'unknown';

    modalElement.querySelector('.details-icon').textContent = getNodeIcon(node);
    modalElement.querySelector('.details-title').textContent = friendlyName;
    modalElement.querySelector('.details-entity-id').textContent = node.id;

    const stateBadge = modalElement.querySelector('.details-state-badge');
    stateBadge.textContent = currentState;
    stateBadge.className = `details-state-badge state-${currentState.replace(/\s/g, '-')}`;
}

/**
 * Switches to a different tab.
 * @param {string} tabName
 */
async function switchTab(tabName) {
    if (!currentNode) return;

    activeTab = tabName;

    // Update tab buttons
    modalElement.querySelectorAll('.details-tab').forEach((t) => {
        t.classList.toggle('active', t.dataset.tab === tabName);
    });

    // Update panels
    modalElement.querySelectorAll('.details-tab-panel').forEach((p) => {
        p.classList.toggle('active', p.dataset.panel === tabName);
    });

    // Load tab content
    switch (tabName) {
        case 'overview':
            await loadOverviewTab(currentNode);
            break;
        case 'history':
            await loadHistoryTab(currentNode);
            break;
        case 'connections':
            loadConnectionsTab(currentNode);
            break;
    }
}

/**
 * Loads the overview tab content.
 * @param {Object} node
 */
async function loadOverviewTab(node) {
    const panel = modalElement.querySelector('[data-panel="overview"]');
    const entityState = state.STATES?.[node.id];

    if (!entityState) {
        panel.innerHTML = `<div class="details-empty">No state data available for this ${node.type}</div>`;
        return;
    }

    const lastChanged = entityState.last_changed
        ? new Date(entityState.last_changed).toLocaleString()
        : 'Unknown';
    const lastUpdated = entityState.last_updated
        ? new Date(entityState.last_updated).toLocaleString()
        : 'Unknown';

    let html = `
    <div class="details-section">
      <h3 class="details-section-title">State</h3>
      <div class="details-row">
        <span class="details-label">Current State</span>
        <span class="details-value state-value">${escapeHtml(entityState.state)}</span>
      </div>
      <div class="details-row">
        <span class="details-label">Last Changed</span>
        <span class="details-value">${lastChanged}</span>
      </div>
      <div class="details-row">
        <span class="details-label">Last Updated</span>
        <span class="details-value">${lastUpdated}</span>
      </div>
    </div>
  `;

    // Attributes section
    const attrs = entityState.attributes || {};
    const attrKeys = Object.keys(attrs).filter(k => !['friendly_name', 'icon'].includes(k));

    if (attrKeys.length > 0) {
        html += `
      <div class="details-section">
        <h3 class="details-section-title">Attributes</h3>
        ${attrKeys.map(key => `
          <div class="details-row">
            <span class="details-label">${formatAttrKey(key)}</span>
            <span class="details-value">${formatAttrValue(attrs[key])}</span>
          </div>
        `).join('')}
      </div>
    `;
    }

    // Device/Area info if available
    if (node.deviceId || node.areaId) {
        html += `<div class="details-section"><h3 class="details-section-title">Location</h3>`;
        if (node.areaId) {
            const area = relationshipStore.getNode(`area.${node.areaId}`);
            html += `
        <div class="details-row">
          <span class="details-label">Area</span>
          <span class="details-value">${area?.label || node.areaId}</span>
        </div>
      `;
        }
        if (node.deviceId) {
            const device = relationshipStore.getNode(`device.${node.deviceId}`);
            html += `
        <div class="details-row">
          <span class="details-label">Device</span>
          <span class="details-value">${device?.label || node.deviceId}</span>
        </div>
      `;
        }
        html += `</div>`;
    }

    panel.innerHTML = html;
}

/**
 * Loads the history tab content.
 * @param {Object} node
 */
async function loadHistoryTab(node) {
    const panel = modalElement.querySelector('[data-panel="history"]');
    panel.innerHTML = `<div class="details-loading">Loading history...</div>`;

    try {
        // Get history for the past 24 hours
        const endTime = new Date().toISOString();
        const startTime = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

        const response = await websocket.request({
            type: 'history/period',
            start_time: startTime,
            end_time: endTime,
            entity_ids: [node.id],
            minimal_response: true,
            significant_changes_only: true,
        });

        const history = response?.[0] || [];

        if (history.length === 0) {
            panel.innerHTML = `<div class="details-empty">No history available for the past 24 hours</div>`;
            return;
        }

        // Reverse to show most recent first
        const recentHistory = history.slice(-20).reverse();

        let html = `
      <div class="details-section">
        <h3 class="details-section-title">Recent Activity (Last 24h)</h3>
        <div class="history-list">
          ${recentHistory.map(entry => `
            <div class="history-item">
              <span class="history-state state-${entry.state?.replace(/\s/g, '-')}">${escapeHtml(entry.state || 'unknown')}</span>
              <span class="history-time">${formatTime(entry.last_changed)}</span>
            </div>
          `).join('')}
        </div>
      </div>
    `;

        panel.innerHTML = html;

    } catch (error) {
        log.error('[ConnectionMap] Failed to load history:', error);
        panel.innerHTML = `<div class="details-error">Failed to load history: ${error.message}</div>`;
    }
}

/**
 * Loads the connections tab content.
 * @param {Object} node
 */
function loadConnectionsTab(node) {
    const panel = modalElement.querySelector('[data-panel="connections"]');
    const connectedNodes = relationshipStore.getConnectedNodes(node.id, 1);
    const connectedEdges = relationshipStore.getConnectedEdges(node.id);

    if (connectedNodes.length === 0) {
        panel.innerHTML = `<div class="details-empty">No connections found</div>`;
        return;
    }

    // Group connections by relationship type
    const connections = {};
    for (const edge of connectedEdges) {
        const type = edge.type;
        if (!connections[type]) {
            connections[type] = [];
        }
        const otherId = (edge.source === node.id || edge.source.id === node.id)
            ? (edge.target.id || edge.target)
            : (edge.source.id || edge.source);
        const otherNode = connectedNodes.find(n => n.id === otherId) || relationshipStore.getNode(otherId);
        if (otherNode) {
            connections[type].push(otherNode);
        }
    }

    let html = '';

    for (const [type, nodes] of Object.entries(connections)) {
        html += `
      <div class="details-section">
        <h3 class="details-section-title">${formatRelationType(type)} (${nodes.length})</h3>
        <div class="connections-list">
          ${nodes.map(n => `
            <div class="connection-item">
              <span class="connection-icon">${getNodeIcon(n)}</span>
              <span class="connection-name">${escapeHtml(n.label)}</span>
              <span class="connection-type">${n.type}</span>
            </div>
          `).join('')}
        </div>
      </div>
    `;
    }

    panel.innerHTML = html;
}

/**
 * Formats an attribute key to human-readable form.
 * @param {string} key
 * @returns {string}
 */
function formatAttrKey(key) {
    return key.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}

/**
 * Formats an attribute value.
 * @param {*} value
 * @returns {string}
 */
function formatAttrValue(value) {
    if (value === null || value === undefined) return '—';
    if (typeof value === 'boolean') return value ? 'Yes' : 'No';
    if (Array.isArray(value)) return value.join(', ') || '(empty)';
    if (typeof value === 'object') return JSON.stringify(value);
    return String(value);
}

/**
 * Formats a relationship type.
 * @param {string} type
 * @returns {string}
 */
function formatRelationType(type) {
    const map = {
        triggers: 'Triggered By',
        controls: 'Controls',
        includes: 'Includes',
        belongs_to: 'Belongs To',
        located_in: 'Located In',
        domain_of: 'Domain',
    };
    return map[type] || type.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}

/**
 * Formats a timestamp.
 * @param {string} timestamp
 * @returns {string}
 */
function formatTime(timestamp) {
    if (!timestamp) return '';
    const date = new Date(timestamp);
    return date.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
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
 * Escapes HTML entities.
 * @param {string} str
 * @returns {string}
 */
function escapeHtml(str) {
    if (typeof str !== 'string') return String(str);
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
}

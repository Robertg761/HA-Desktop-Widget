/**
 * Connection Map Module
 * Main entry point that integrates all connection map functionality.
 */

import log from '../logger.js';
import relationshipStore from './relationship-store.js';
import { initGraph, renderGraph, goBack, applyFilter, clearFilter, searchNodes, clearSearch } from './graph-renderer.js';
import { getState as getInteractionState, canGoBack, getBreadcrumbs } from './graph-interaction.js';

/** @type {boolean} Whether the map is currently open */
let isOpen = false;

/** @type {HTMLElement|null} The map panel element */
let mapPanel = null;

/** @type {Object|null} Graph instance (for cleanup) */
let graphInstance = null;

/** @type {string|null} Current filter type */
let currentFilterType = null;

/** @type {string|null} Current filter ID */
let currentFilterId = null;

/** @type {Function|null} Callback for close event */
let onCloseCallback = null;

/**
 * Opens the connection map panel.
 * @param {Object} options
 * @param {HTMLElement} options.container - Container element for the map panel
 * @param {Function} [options.onClose] - Callback when map is closed
 */
export async function openConnectionMap({ container, onClose }) {
    if (isOpen) {
        log.warn('[ConnectionMap] Map is already open');
        return;
    }

    log.debug('[ConnectionMap] Opening connection map...');
    isOpen = true;
    onCloseCallback = onClose;

    try {
        // Show loading state
        container.innerHTML = `
      <div class="connection-map-loading">
        <div class="spinner"></div>
        <span>Loading relationship data...</span>
      </div>
    `;
        container.classList.add('visible');
        mapPanel = container;

        // Load graph data
        await relationshipStore.loadGraph();
        const stats = relationshipStore.getStats();
        log.debug(`[ConnectionMap] Graph loaded: ${stats.totalNodes} nodes, ${stats.totalEdges} edges`);

        // Create the map UI structure
        container.innerHTML = createMapHTML();

        // Get the graph container
        const graphContainer = container.querySelector('.connection-map-graph');
        if (!graphContainer) {
            throw new Error('Graph container not found');
        }

        // Initialize the graph renderer
        graphInstance = initGraph(graphContainer, handleUIUpdate);

        // Render the full graph
        renderGraph();

        // Wire up UI event handlers
        wireEventHandlers(container);

        // Populate filter dropdowns
        populateFilterDropdowns(container);

    } catch (error) {
        log.error('[ConnectionMap] Failed to open connection map:', error);
        container.innerHTML = `
      <div class="connection-map-error">
        <span class="error-icon">⚠️</span>
        <span>Failed to load connection map</span>
        <p>${error.message}</p>
        <button class="btn-close-map">Close</button>
      </div>
    `;
        container.querySelector('.btn-close-map')?.addEventListener('click', closeConnectionMap);
    }
}

/**
 * Closes the connection map panel.
 */
export function closeConnectionMap() {
    if (!isOpen) return;

    log.debug('[ConnectionMap] Closing connection map...');

    // Clean up graph instance
    if (graphInstance) {
        graphInstance.destroy();
        graphInstance = null;
    }

    // Clear panel
    if (mapPanel) {
        mapPanel.classList.remove('visible');
        mapPanel.innerHTML = '';
        mapPanel = null;
    }

    // Reset state
    isOpen = false;
    currentFilterType = null;
    currentFilterId = null;

    // Notify callback
    if (onCloseCallback) {
        onCloseCallback();
        onCloseCallback = null;
    }
}

/**
 * Refreshes the connection map data.
 */
export async function refreshData() {
    if (!isOpen) return;

    log.debug('[ConnectionMap] Refreshing data...');

    // Show loading overlay
    const loadingOverlay = document.createElement('div');
    loadingOverlay.className = 'connection-map-refresh-overlay';
    loadingOverlay.innerHTML = '<div class="spinner"></div>';
    mapPanel?.appendChild(loadingOverlay);

    try {
        // Clear and reload
        relationshipStore.clear();
        await relationshipStore.loadGraph();

        // Re-render
        if (currentFilterType) {
            applyFilter(currentFilterType, currentFilterId);
        } else {
            renderGraph();
        }

    } catch (error) {
        log.error('[ConnectionMap] Failed to refresh data:', error);
    } finally {
        loadingOverlay.remove();
    }
}

/**
 * Creates the map panel HTML structure.
 * @returns {string}
 */
function createMapHTML() {
    return `
    <div class="connection-map-header">
      <div class="header-left">
        <button class="btn-back" title="Go Back" disabled>
          <span class="icon">←</span>
        </button>
        <h2>Connection Map</h2>
      </div>
      <div class="header-center">
        <div class="search-container">
          <input type="text" class="search-input" placeholder="Search entities, automations..." />
          <button class="btn-clear-search" title="Clear Search" style="display: none;">✕</button>
        </div>
      </div>
      <div class="header-right">
        <button class="btn-refresh" title="Refresh Data">🔄</button>
        <button class="btn-close" title="Close">✕</button>
      </div>
    </div>
    <div class="connection-map-filters">
      <div class="filter-group">
        <label>View:</label>
        <select class="filter-view">
          <option value="">All</option>
          <option value="entity">Entities</option>
          <option value="automation">Automations</option>
          <option value="script">Scripts</option>
          <option value="scene">Scenes</option>
        </select>
      </div>
      <div class="filter-group">
        <label>Area:</label>
        <select class="filter-area">
          <option value="">All Areas</option>
        </select>
      </div>
      <div class="filter-group">
        <label>Device:</label>
        <select class="filter-device">
          <option value="">All Devices</option>
        </select>
      </div>
      <div class="filter-group">
        <label>Integration:</label>
        <select class="filter-integration">
          <option value="">All Integrations</option>
        </select>
      </div>
      <button class="btn-clear-filters" title="Clear All Filters">Clear Filters</button>
    </div>
    <div class="connection-map-breadcrumbs">
      <span class="breadcrumb-label">Path:</span>
      <span class="breadcrumb-trail">Overview</span>
    </div>
    <div class="connection-map-graph"></div>
    <div class="connection-map-legend">
      <div class="legend-item"><span class="legend-color" style="background: #4a9eff;"></span> Entity</div>
      <div class="legend-item"><span class="legend-color" style="background: #3b82f6;"></span> Automation</div>
      <div class="legend-item"><span class="legend-color" style="background: #22c55e;"></span> Script</div>
      <div class="legend-item"><span class="legend-color" style="background: #a855f7;"></span> Scene</div>
      <div class="legend-item"><span class="legend-color" style="background: #f59e0b;"></span> Device</div>
      <div class="legend-item"><span class="legend-color" style="background: #6b7280;"></span> Area</div>
    </div>
  `;
}

/**
 * Wires up event handlers for the map UI.
 * @param {HTMLElement} container
 */
function wireEventHandlers(container) {
    // Close button
    container.querySelector('.btn-close')?.addEventListener('click', closeConnectionMap);

    // Back button
    const backBtn = container.querySelector('.btn-back');
    backBtn?.addEventListener('click', () => {
        goBack();
        updateBackButton();
    });

    // Refresh button
    container.querySelector('.btn-refresh')?.addEventListener('click', refreshData);

    // Search input
    const searchInput = container.querySelector('.search-input');
    const clearSearchBtn = container.querySelector('.btn-clear-search');
    let searchTimeout = null;

    searchInput?.addEventListener('input', (e) => {
        const query = e.target.value.trim();
        clearTimeout(searchTimeout);

        if (query) {
            clearSearchBtn.style.display = 'block';
            searchTimeout = setTimeout(() => {
                searchNodes(query);
            }, 300);
        } else {
            clearSearchBtn.style.display = 'none';
            clearSearch();
        }
    });

    clearSearchBtn?.addEventListener('click', () => {
        searchInput.value = '';
        clearSearchBtn.style.display = 'none';
        clearSearch();
    });

    // Filter dropdowns
    const filterView = container.querySelector('.filter-view');
    const filterArea = container.querySelector('.filter-area');
    const filterDevice = container.querySelector('.filter-device');
    const filterIntegration = container.querySelector('.filter-integration');
    const clearFiltersBtn = container.querySelector('.btn-clear-filters');

    filterView?.addEventListener('change', (e) => {
        currentFilterType = e.target.value || null;
        currentFilterId = null;
        resetOtherFilters(container, 'filter-view');
        if (currentFilterType) {
            applyFilter(currentFilterType);
        } else {
            clearFilter();
        }
    });

    filterArea?.addEventListener('change', (e) => {
        currentFilterType = 'area';
        currentFilterId = e.target.value || null;
        resetOtherFilters(container, 'filter-area');
        if (currentFilterId) {
            applyFilter('area', currentFilterId);
        } else {
            clearFilter();
        }
    });

    filterDevice?.addEventListener('change', (e) => {
        currentFilterType = 'device';
        currentFilterId = e.target.value || null;
        resetOtherFilters(container, 'filter-device');
        if (currentFilterId) {
            applyFilter('device', currentFilterId);
        } else {
            clearFilter();
        }
    });

    filterIntegration?.addEventListener('change', (e) => {
        currentFilterType = 'integration';
        currentFilterId = e.target.value || null;
        resetOtherFilters(container, 'filter-integration');
        if (currentFilterId) {
            applyFilter('integration', currentFilterId);
        } else {
            clearFilter();
        }
    });

    clearFiltersBtn?.addEventListener('click', () => {
        currentFilterType = null;
        currentFilterId = null;
        filterView.value = '';
        filterArea.value = '';
        filterDevice.value = '';
        filterIntegration.value = '';
        clearFilter();
    });

    // Keyboard shortcuts
    const handleKeyDown = (e) => {
        if (e.key === 'Escape') {
            if (canGoBack()) {
                goBack();
                updateBackButton();
            } else {
                closeConnectionMap();
            }
        } else if (e.key === 'Backspace' && document.activeElement !== searchInput) {
            if (canGoBack()) {
                goBack();
                updateBackButton();
            }
        }
    };

    container.addEventListener('keydown', handleKeyDown);
    container.setAttribute('tabindex', '-1');
    container.focus();
}

/**
 * Resets other filter dropdowns when one is selected.
 * @param {HTMLElement} container
 * @param {string} activeClass
 */
function resetOtherFilters(container, activeClass) {
    const filters = ['filter-view', 'filter-area', 'filter-device', 'filter-integration'];
    for (const filterClass of filters) {
        if (filterClass !== activeClass) {
            const el = container.querySelector(`.${filterClass}`);
            if (el) el.value = '';
        }
    }
}

/**
 * Populates filter dropdown options.
 * @param {HTMLElement} container
 */
function populateFilterDropdowns(container) {
    // Areas
    const areaSelect = container.querySelector('.filter-area');
    const areas = relationshipStore.getAreas();
    for (const area of areas.sort((a, b) => a.label.localeCompare(b.label))) {
        const option = document.createElement('option');
        option.value = area.id.replace('area.', '');
        option.textContent = area.label;
        areaSelect?.appendChild(option);
    }

    // Devices
    const deviceSelect = container.querySelector('.filter-device');
    const devices = relationshipStore.getDevices();
    for (const device of devices.sort((a, b) => a.label.localeCompare(b.label))) {
        const option = document.createElement('option');
        option.value = device.id.replace('device.', '');
        option.textContent = device.label;
        deviceSelect?.appendChild(option);
    }

    // Integrations
    const integrationSelect = container.querySelector('.filter-integration');
    const integrations = relationshipStore.getIntegrations();
    for (const integration of integrations.sort((a, b) => a.label.localeCompare(b.label))) {
        const option = document.createElement('option');
        option.value = integration.domain;
        option.textContent = integration.label;
        integrationSelect?.appendChild(option);
    }
}

/**
 * Updates the back button enabled state.
 */
function updateBackButton() {
    const backBtn = mapPanel?.querySelector('.btn-back');
    if (backBtn) {
        backBtn.disabled = !canGoBack();
    }
}

/**
 * Updates breadcrumbs display.
 * @param {Array} breadcrumbs
 */
function updateBreadcrumbs(breadcrumbs) {
    const trailEl = mapPanel?.querySelector('.breadcrumb-trail');
    if (!trailEl) return;

    if (breadcrumbs.length === 0) {
        trailEl.innerHTML = 'Overview';
    } else {
        const crumbs = breadcrumbs.map((b, i) => {
            const isLast = i === breadcrumbs.length - 1;
            return `<span class="breadcrumb${isLast ? ' current' : ''}">${b.label}</span>`;
        });
        trailEl.innerHTML = `<span class="breadcrumb">Overview</span> → ${crumbs.join(' → ')}`;
    }
}

/**
 * Handles UI update callbacks from graph renderer.
 * @param {Object} data
 */
function handleUIUpdate(data) {
    if (data.breadcrumbs) {
        updateBreadcrumbs(data.breadcrumbs);
    }
    updateBackButton();
}

/**
 * Checks if the connection map is currently open.
 * @returns {boolean}
 */
export function isConnectionMapOpen() {
    return isOpen;
}

// Export for external use
export { relationshipStore };

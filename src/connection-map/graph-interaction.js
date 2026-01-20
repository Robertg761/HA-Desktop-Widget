/**
 * Graph Interaction Module
 * Event handlers for node interactions, zoom, pan, and search.
 */

import * as d3 from 'd3';
import log from '../logger.js';
import relationshipStore from './relationship-store.js';

/**
 * @typedef {Object} FocusHistoryEntry
 * @property {string} nodeId - Focused node ID
 * @property {number} zoomLevel - Zoom level at focus time
 * @property {{x: number, y: number}} panOffset - Pan offset at focus time
 */

/**
 * @typedef {Object} InteractionState
 * @property {string|null} focusedNodeId - Currently focused node
 * @property {FocusHistoryEntry[]} focusHistory - Stack of previous focus states
 * @property {string|null} hoveredNodeId - Currently hovered node
 * @property {Set<string>} selectedNodes - Multi-selected nodes
 * @property {number} zoomLevel - Current zoom scale
 * @property {{x: number, y: number}} panOffset - Current pan offset
 */

/** @type {InteractionState} */
const interactionState = {
    focusedNodeId: null,
    focusHistory: [],
    hoveredNodeId: null,
    selectedNodes: new Set(),
    zoomLevel: 1,
    panOffset: { x: 0, y: 0 },
};

/** @type {Function|null} Event callback for state changes */
let onStateChange = null;

/** @type {d3.ZoomBehavior|null} D3 zoom behavior instance */
let zoomBehavior = null;

/**
 * Initializes the interaction module.
 * @param {Function} callback - Callback when interaction state changes
 */
export function initInteraction(callback) {
    onStateChange = callback;
    resetState();
}

/**
 * Resets all interaction state.
 */
export function resetState() {
    interactionState.focusedNodeId = null;
    interactionState.focusHistory = [];
    interactionState.hoveredNodeId = null;
    interactionState.selectedNodes.clear();
    interactionState.zoomLevel = 1;
    interactionState.panOffset = { x: 0, y: 0 };
}

/**
 * Gets the current interaction state.
 * @returns {InteractionState}
 */
export function getState() {
    return { ...interactionState };
}

/**
 * Handles node click - focus on the clicked node.
 * @param {Object} node - The clicked node
 * @returns {{focusedNode: Object, connectedNodes: Array, connectedEdges: Array}}
 */
export function handleNodeClick(node) {
    log.debug(`[ConnectionMap] Node clicked: ${node.id}`);

    // Save current state to history if we have a focus
    if (interactionState.focusedNodeId) {
        interactionState.focusHistory.push({
            nodeId: interactionState.focusedNodeId,
            zoomLevel: interactionState.zoomLevel,
            panOffset: { ...interactionState.panOffset },
        });
    }

    // Update focused node
    interactionState.focusedNodeId = node.id;

    // Get connected nodes and edges
    const connectedNodes = relationshipStore.getConnectedNodes(node.id, 1);
    const connectedEdges = relationshipStore.getConnectedEdges(node.id);

    notifyStateChange();

    return {
        focusedNode: node,
        connectedNodes,
        connectedEdges,
    };
}

/**
 * Handles node hover - highlight connected nodes.
 * @param {Object|null} node - The hovered node (null on mouse leave)
 * @returns {{hoveredNode: Object|null, connectedNodeIds: Set<string>}}
 */
export function handleNodeHover(node) {
    interactionState.hoveredNodeId = node?.id || null;

    const connectedNodeIds = new Set();
    if (node) {
        const connectedNodes = relationshipStore.getConnectedNodes(node.id, 1);
        for (const connected of connectedNodes) {
            connectedNodeIds.add(connected.id);
        }
    }

    return {
        hoveredNode: node,
        connectedNodeIds,
    };
}

/**
 * Handles back navigation - return to previous focus.
 * @returns {{focusedNode: Object|null, connectedNodes: Array, connectedEdges: Array}|null}
 */
export function handleBackClick() {
    if (interactionState.focusHistory.length === 0) {
        // No history, unfocus completely
        interactionState.focusedNodeId = null;
        notifyStateChange();
        return null;
    }

    // Pop previous state
    const previousState = interactionState.focusHistory.pop();
    interactionState.focusedNodeId = previousState.nodeId;
    interactionState.zoomLevel = previousState.zoomLevel;
    interactionState.panOffset = previousState.panOffset;

    const focusedNode = relationshipStore.getNode(previousState.nodeId);
    if (!focusedNode) {
        interactionState.focusedNodeId = null;
        notifyStateChange();
        return null;
    }

    const connectedNodes = relationshipStore.getConnectedNodes(previousState.nodeId, 1);
    const connectedEdges = relationshipStore.getConnectedEdges(previousState.nodeId);

    notifyStateChange();

    return {
        focusedNode,
        connectedNodes,
        connectedEdges,
    };
}

/**
 * Handles double-click on background - unfocus all.
 */
export function handleBackgroundDoubleClick() {
    interactionState.focusedNodeId = null;
    interactionState.focusHistory = [];
    notifyStateChange();
}

/**
 * Checks if we can go back in focus history.
 * @returns {boolean}
 */
export function canGoBack() {
    return interactionState.focusedNodeId !== null || interactionState.focusHistory.length > 0;
}

/**
 * Gets the breadcrumb trail for navigation.
 * @returns {Array<{nodeId: string, label: string}>}
 */
export function getBreadcrumbs() {
    const breadcrumbs = [];

    // Add history items
    for (const entry of interactionState.focusHistory) {
        const node = relationshipStore.getNode(entry.nodeId);
        if (node) {
            breadcrumbs.push({
                nodeId: node.id,
                label: node.label,
            });
        }
    }

    // Add current focus
    if (interactionState.focusedNodeId) {
        const node = relationshipStore.getNode(interactionState.focusedNodeId);
        if (node) {
            breadcrumbs.push({
                nodeId: node.id,
                label: node.label,
            });
        }
    }

    return breadcrumbs;
}

/**
 * Handles search - find and optionally focus on matching nodes.
 * @param {string} query - Search query
 * @param {boolean} [focus=false] - Whether to focus on the first result
 * @returns {Array<Object>} Matching nodes
 */
export function handleSearch(query, focus = false) {
    if (!query || query.trim() === '') {
        return [];
    }

    const results = relationshipStore.searchNodes(query.trim());

    if (focus && results.length > 0) {
        handleNodeClick(results[0]);
    }

    return results;
}

/**
 * Sets up D3 zoom behavior on an SVG element.
 * @param {d3.Selection} svg - D3 selection of the SVG element
 * @param {d3.Selection} container - D3 selection of the zoom container group
 * @param {Function} onZoom - Callback when zoom changes
 * @returns {d3.ZoomBehavior}
 */
export function setupZoom(svg, container, onZoom) {
    zoomBehavior = d3.zoom()
        .scaleExtent([0.2, 4])
        .on('zoom', (event) => {
            interactionState.zoomLevel = event.transform.k;
            interactionState.panOffset = { x: event.transform.x, y: event.transform.y };
            container.attr('transform', event.transform);
            if (onZoom) {
                onZoom(event.transform);
            }
        });

    svg.call(zoomBehavior);

    return zoomBehavior;
}

/**
 * Programmatically zooms to a specific level.
 * @param {d3.Selection} svg - D3 selection of the SVG element
 * @param {number} scale - Target zoom scale
 * @param {boolean} [animate=true] - Whether to animate the transition
 */
export function zoomTo(svg, scale, animate = true) {
    if (!zoomBehavior) return;

    const transition = animate ? svg.transition().duration(500) : svg;
    transition.call(
        zoomBehavior.scaleTo,
        scale
    );
}

/**
 * Programmatically pans to center on a specific point.
 * @param {d3.Selection} svg - D3 selection of the SVG element
 * @param {number} x - Target X coordinate
 * @param {number} y - Target Y coordinate
 * @param {number} width - SVG width
 * @param {number} height - SVG height
 * @param {boolean} [animate=true] - Whether to animate the transition
 */
export function panTo(svg, x, y, width, height, animate = true) {
    if (!zoomBehavior) return;

    const transition = animate ? svg.transition().duration(500) : svg;
    transition.call(
        zoomBehavior.translateTo,
        x,
        y
    );
}

/**
 * Resets zoom to default (scale 1, centered).
 * @param {d3.Selection} svg - D3 selection of the SVG element
 * @param {boolean} [animate=true] - Whether to animate the transition
 */
export function resetZoom(svg, animate = true) {
    if (!zoomBehavior) return;

    const transition = animate ? svg.transition().duration(500) : svg;
    transition.call(
        zoomBehavior.transform,
        d3.zoomIdentity
    );

    interactionState.zoomLevel = 1;
    interactionState.panOffset = { x: 0, y: 0 };
}

/**
 * Creates a drag behavior for nodes.
 * @param {d3.Simulation} simulation - D3 force simulation
 * @returns {d3.DragBehavior}
 */
export function createDragBehavior(simulation) {
    return d3.drag()
        .on('start', (event, d) => {
            if (!event.active) simulation.alphaTarget(0.3).restart();
            d.fx = d.x;
            d.fy = d.y;
        })
        .on('drag', (event, d) => {
            d.fx = event.x;
            d.fy = event.y;
        })
        .on('end', (event, d) => {
            if (!event.active) simulation.alphaTarget(0);
            // Keep focused node pinned
            if (interactionState.focusedNodeId !== d.id) {
                d.fx = null;
                d.fy = null;
            }
        });
}

/**
 * Notifies listeners of state change.
 * @private
 */
function notifyStateChange() {
    if (onStateChange) {
        onStateChange({ ...interactionState });
    }
}

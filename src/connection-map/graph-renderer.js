/**
 * Graph Renderer Module
 * D3.js-based SVG renderer for the force-directed relationship graph.
 * Implements an infinite canvas with zoom/pan controls.
 */

import * as d3 from 'd3';
import log from '../logger.js';
import relationshipStore from './relationship-store.js';
import {
    createForceSimulation,
    getNodeRadius,
    focusOnNode,
    unfocusNode,
} from './graph-layout.js';
import {
    initInteraction,
    handleNodeClick,
    handleNodeHover,
    handleBackClick,
    handleBackgroundDoubleClick,
    createDragBehavior,
    getState as getInteractionState,
    getBreadcrumbs,
} from './graph-interaction.js';

/**
 * Node type to color mapping.
 */
const NODE_COLORS = {
    entity: '#4a9eff',
    automation: '#3b82f6',
    script: '#22c55e',
    scene: '#a855f7',
    device: '#f59e0b',
    area: '#6b7280',
    integration: '#ec4899',
};

/**
 * Edge type to style mapping.
 */
const EDGE_STYLES = {
    triggers: { color: '#f97316', dasharray: '5,5', width: 2 },
    controls: { color: '#3b82f6', dasharray: null, width: 2 },
    includes: { color: '#a855f7', dasharray: null, width: 2 },
    belongs_to: { color: '#9ca3af', dasharray: null, width: 1 },
    located_in: { color: '#9ca3af', dasharray: '3,3', width: 1 },
    domain_of: { color: '#d1d5db', dasharray: null, width: 1 },
};

/**
 * Domain icon map (emoji icons)
 */
const DOMAIN_ICONS = {
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
    vacuum: '🤖',
    automation: '⚙️',
    script: '📜',
    scene: '🎭',
    person: '👤',
    device_tracker: '📍',
    weather: '🌤️',
    input_boolean: '✅',
    input_number: '🔢',
    input_select: '📋',
    input_text: '📝',
    timer: '⏱️',
    default: '●',
};

/** @type {d3.Selection|null} SVG container */
let svg = null;

/** @type {d3.Selection|null} Main graph group (for zoom/pan) */
let graphGroup = null;

/** @type {d3.Simulation|null} Force simulation */
let simulation = null;

/** @type {d3.Selection|null} Edges group */
let edgesGroup = null;

/** @type {d3.Selection|null} Nodes group */
let nodesGroup = null;

/** @type {d3.Selection|null} Labels group */
let labelsGroup = null;

/** @type {d3.ZoomBehavior|null} Zoom behavior */
let zoomBehavior = null;

/** @type {number} Container width */
let width = 800;

/** @type {number} Container height */
let height = 600;

/** @type {Object|null} Currently focused node */
let focusedNode = null;

/** @type {Set<string>} Currently visible node IDs */
let visibleNodeIds = new Set();

/** @type {Function|null} Callback for UI updates */
let onUIUpdate = null;

/** @type {Array} Working copy of nodes for reference */
let workingNodesRef = [];

/** @type {number} Current zoom level */
let currentZoomLevel = 1;

/** @type {HTMLElement|null} The container element */
let containerRef = null;

/**
 * Initializes the graph renderer.
 * @param {HTMLElement} container - Container element for the graph
 * @param {Function} uiCallback - Callback for UI state changes (filters, breadcrumbs, etc.)
 */
export function initGraph(container, uiCallback) {
    log.debug('[ConnectionMap] Initializing graph renderer');
    onUIUpdate = uiCallback;
    containerRef = container;

    // Get container dimensions
    const rect = container.getBoundingClientRect();
    width = rect.width || 800;
    height = rect.height || 600;

    // Clear any existing content
    d3.select(container).selectAll('*').remove();

    // Create SVG - use actual pixel dimensions, no viewBox constraint
    svg = d3.select(container)
        .append('svg')
        .attr('width', '100%')
        .attr('height', '100%')
        .attr('class', 'connection-map-svg')
        .style('cursor', 'grab');

    // Add background rect for pan/click handling
    svg.append('rect')
        .attr('class', 'graph-background')
        .attr('width', '100%')
        .attr('height', '100%')
        .attr('fill', 'transparent')
        .on('click', (event) => {
            // Single click on background deselects when focused
            if (focusedNode) {
                event.stopPropagation();
                unfocusAll();
            }
        })
        .on('dblclick', () => {
            handleBackgroundDoubleClick();
            unfocusAll();
        });

    // Create main group for zoom/pan transform
    graphGroup = svg.append('g').attr('class', 'graph-container');

    // Create layer groups
    edgesGroup = graphGroup.append('g').attr('class', 'edges-layer');
    nodesGroup = graphGroup.append('g').attr('class', 'nodes-layer');
    labelsGroup = graphGroup.append('g').attr('class', 'labels-layer');

    // Set up zoom behavior with infinite canvas
    zoomBehavior = d3.zoom()
        .scaleExtent([0.1, 5]) // Allow zooming out to 10% and up to 500%
        .on('zoom', (event) => {
            graphGroup.attr('transform', event.transform);
            currentZoomLevel = event.transform.k;
            updateZoomLevelDisplay();
        })
        .on('start', () => {
            svg.style('cursor', 'grabbing');
        })
        .on('end', () => {
            svg.style('cursor', 'grab');
        });

    svg.call(zoomBehavior);

    // Filter to disable pan during focus (still allow wheel zoom)
    zoomBehavior.filter((event) => {
        // Always allow wheel events (zoom)
        if (event.type === 'wheel') return true;
        // When focused, disable drag-to-pan (so clicking background deselects)
        if (focusedNode && (event.type === 'mousedown' || event.type === 'touchstart')) {
            return false;
        }
        // Allow all other zoom behavior
        return true;
    });

    // Initialize interaction module
    initInteraction(handleInteractionStateChange);

    // Add defs for markers (arrowheads)
    const defs = svg.append('defs');
    addArrowMarkers(defs);

    // Add zoom controls overlay
    addZoomControls(container);

    // Handle window resize
    const resizeObserver = new ResizeObserver((entries) => {
        for (const entry of entries) {
            width = entry.contentRect.width;
            height = entry.contentRect.height;
        }
    });
    resizeObserver.observe(container);

    return {
        resize: () => {
            const rect = container.getBoundingClientRect();
            width = rect.width;
            height = rect.height;
        },
        destroy: () => {
            resizeObserver.disconnect();
            if (simulation) simulation.stop();
            d3.select(container).selectAll('*').remove();
        },
    };
}

/**
 * Adds zoom control buttons to the container.
 * @param {HTMLElement} container
 */
function addZoomControls(container) {
    const controlsDiv = document.createElement('div');
    controlsDiv.className = 'connection-map-zoom-controls';
    controlsDiv.innerHTML = `
    <button class="zoom-btn zoom-in" title="Zoom In">+</button>
    <span class="zoom-level">100%</span>
    <button class="zoom-btn zoom-out" title="Zoom Out">−</button>
    <button class="zoom-btn zoom-fit" title="Fit to View">⊡</button>
    <button class="zoom-btn zoom-reset" title="Reset View">↺</button>
  `;

    container.appendChild(controlsDiv);

    // Wire up zoom controls
    controlsDiv.querySelector('.zoom-in').addEventListener('click', () => zoomIn());
    controlsDiv.querySelector('.zoom-out').addEventListener('click', () => zoomOut());
    controlsDiv.querySelector('.zoom-fit').addEventListener('click', () => fitToView());
    controlsDiv.querySelector('.zoom-reset').addEventListener('click', () => resetView());
}

/**
 * Updates the zoom level display.
 */
function updateZoomLevelDisplay() {
    const zoomDisplay = containerRef?.querySelector('.zoom-level');
    if (zoomDisplay) {
        zoomDisplay.textContent = `${Math.round(currentZoomLevel * 100)}%`;
    }
}

/**
 * Zooms in by a step.
 */
export function zoomIn() {
    if (!svg || !zoomBehavior) return;
    svg.transition().duration(300).call(zoomBehavior.scaleBy, 1.3);
}

/**
 * Zooms out by a step.
 */
export function zoomOut() {
    if (!svg || !zoomBehavior) return;
    svg.transition().duration(300).call(zoomBehavior.scaleBy, 0.7);
}

/**
 * Fits the view to show all nodes.
 */
export function fitToView() {
    if (!svg || !zoomBehavior || workingNodesRef.length === 0) return;

    // Calculate bounding box of all nodes
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;

    for (const node of workingNodesRef) {
        const radius = getNodeRadius(node);
        minX = Math.min(minX, node.x - radius);
        minY = Math.min(minY, node.y - radius);
        maxX = Math.max(maxX, node.x + radius);
        maxY = Math.max(maxY, node.y + radius);
    }

    const graphWidth = maxX - minX;
    const graphHeight = maxY - minY;
    const graphCenterX = (minX + maxX) / 2;
    const graphCenterY = (minY + maxY) / 2;

    // Calculate scale to fit with padding
    const padding = 80;
    const scaleX = (width - padding * 2) / graphWidth;
    const scaleY = (height - padding * 2) / graphHeight;
    const scale = Math.min(scaleX, scaleY, 2); // Cap at 200% zoom

    // Calculate translation to center
    const translateX = width / 2 - graphCenterX * scale;
    const translateY = height / 2 - graphCenterY * scale;

    // Apply transform
    svg.transition()
        .duration(500)
        .call(
            zoomBehavior.transform,
            d3.zoomIdentity.translate(translateX, translateY).scale(scale)
        );
}

/**
 * Resets the view to center with 100% zoom.
 */
export function resetView() {
    if (!svg || !zoomBehavior) return;

    svg.transition()
        .duration(300)
        .call(zoomBehavior.transform, d3.zoomIdentity.translate(width / 2, height / 2));
}

/**
 * Pans to center on a specific point.
 * @param {number} x - Target X coordinate (in graph space)
 * @param {number} y - Target Y coordinate (in graph space)
 * @param {boolean} [animate=true]
 */
export function panToPoint(x, y, animate = true) {
    if (!svg || !zoomBehavior) return;

    const transform = d3.zoomTransform(svg.node());
    const newTransform = d3.zoomIdentity
        .translate(width / 2 - x * transform.k, height / 2 - y * transform.k)
        .scale(transform.k);

    const transition = animate ? svg.transition().duration(500) : svg;
    transition.call(zoomBehavior.transform, newTransform);
}

/**
 * Adds arrow markers for edge endpoints.
 * @param {d3.Selection} defs
 */
function addArrowMarkers(defs) {
    for (const [type, style] of Object.entries(EDGE_STYLES)) {
        defs.append('marker')
            .attr('id', `arrow-${type}`)
            .attr('viewBox', '0 -5 10 10')
            .attr('refX', 20)
            .attr('refY', 0)
            .attr('markerWidth', 6)
            .attr('markerHeight', 6)
            .attr('orient', 'auto')
            .append('path')
            .attr('d', 'M0,-5L10,0L0,5')
            .attr('fill', style.color);
    }
}

/**
 * Renders the full graph.
 * @param {Array} [nodes] - Nodes to render (defaults to all from store)
 * @param {Array} [edges] - Edges to render (defaults to all from store)
 */
export function renderGraph(nodes, edges) {
    const graphData = nodes && edges
        ? { nodes, edges }
        : { nodes: relationshipStore.nodes, edges: relationshipStore.edges };

    if (graphData.nodes.length === 0) {
        log.warn('[ConnectionMap] No nodes to render');
        return;
    }

    log.debug(`[ConnectionMap] Rendering graph: ${graphData.nodes.length} nodes, ${graphData.edges.length} edges`);

    // Make a working copy of nodes (D3 modifies them in place)
    const workingNodes = graphData.nodes.map((n) => ({ ...n }));
    const workingEdges = graphData.edges.map((e) => ({ ...e }));

    // Store reference for fit-to-view calculations
    workingNodesRef = workingNodes;

    // Track visible nodes
    visibleNodeIds = new Set(workingNodes.map((n) => n.id));

    // Initialize nodes at random positions around center (0,0)
    // The infinite canvas uses (0,0) as the graph center
    const spreadRadius = Math.min(width, height) * 0.5;
    for (const node of workingNodes) {
        if (node.x === undefined) {
            const angle = Math.random() * 2 * Math.PI;
            const distance = Math.random() * spreadRadius;
            node.x = Math.cos(angle) * distance;
            node.y = Math.sin(angle) * distance;
        }
    }

    // Create/update force simulation centered at origin (0,0)
    if (simulation) {
        simulation.stop();
    }
    simulation = createForceSimulation(workingNodes, workingEdges, 0, 0);
    simulation.on('tick', () => tick(workingNodes, workingEdges));

    // Render edges
    renderEdges(workingEdges);

    // Render nodes
    renderNodes(workingNodes);

    // Render labels
    renderLabels(workingNodes);

    // Set up drag behavior
    const drag = createDragBehavior(simulation);
    nodesGroup.selectAll('.node-group').call(drag);

    // Auto-fit to view after simulation settles a bit
    setTimeout(() => {
        fitToView();
    }, 500);

    // Update UI callback
    if (onUIUpdate) {
        onUIUpdate({
            breadcrumbs: getBreadcrumbs(),
            stats: relationshipStore.getStats(),
        });
    }
}

/**
 * Renders edges.
 * @param {Array} edges
 */
function renderEdges(edges) {
    const edgeSelection = edgesGroup.selectAll('.edge')
        .data(edges, (d) => `${d.source.id || d.source}-${d.target.id || d.target}`);

    edgeSelection.exit().remove();

    const edgeEnter = edgeSelection.enter()
        .append('line')
        .attr('class', 'edge')
        .attr('stroke', (d) => EDGE_STYLES[d.type]?.color || '#9ca3af')
        .attr('stroke-width', (d) => EDGE_STYLES[d.type]?.width || 1)
        .attr('stroke-dasharray', (d) => EDGE_STYLES[d.type]?.dasharray || null)
        .attr('opacity', 0.6)
        .attr('marker-end', (d) => `url(#arrow-${d.type})`);

    edgeSelection.merge(edgeEnter);
}

/**
 * Renders nodes.
 * @param {Array} nodes
 */
function renderNodes(nodes) {
    const nodeSelection = nodesGroup.selectAll('.node-group')
        .data(nodes, (d) => d.id);

    nodeSelection.exit().remove();

    const nodeEnter = nodeSelection.enter()
        .append('g')
        .attr('class', 'node-group')
        .attr('cursor', 'pointer')
        .on('click', (event, d) => {
            event.stopPropagation();
            onNodeClick(d);
        })
        .on('mouseenter', (event, d) => {
            onNodeHover(d);
        })
        .on('mouseleave', () => {
            onNodeHover(null);
        });

    // Add node shape
    nodeEnter.each(function (d) {
        const group = d3.select(this);
        const radius = getNodeRadius(d);

        if (d.type === 'automation' || d.type === 'script' || d.type === 'scene') {
            // Rounded rectangle for automation/script/scene
            group.append('rect')
                .attr('class', 'node-shape')
                .attr('x', -radius)
                .attr('y', -radius * 0.6)
                .attr('width', radius * 2)
                .attr('height', radius * 1.2)
                .attr('rx', 8)
                .attr('ry', 8)
                .attr('fill', NODE_COLORS[d.type])
                .attr('stroke', '#fff')
                .attr('stroke-width', 2);
        } else if (d.type === 'device') {
            // Hexagon for devices
            const hexPoints = getHexagonPoints(radius);
            group.append('polygon')
                .attr('class', 'node-shape')
                .attr('points', hexPoints)
                .attr('fill', NODE_COLORS[d.type])
                .attr('stroke', '#fff')
                .attr('stroke-width', 2);
        } else {
            // Circle for entities, areas, integrations
            group.append('circle')
                .attr('class', 'node-shape')
                .attr('r', radius)
                .attr('fill', NODE_COLORS[d.type] || NODE_COLORS.entity)
                .attr('stroke', '#fff')
                .attr('stroke-width', 2);
        }

        // Add icon
        const icon = d.type === 'entity'
            ? DOMAIN_ICONS[d.domain] || DOMAIN_ICONS.default
            : DOMAIN_ICONS[d.type] || DOMAIN_ICONS.default;

        group.append('text')
            .attr('class', 'node-icon')
            .attr('text-anchor', 'middle')
            .attr('dominant-baseline', 'central')
            .attr('font-size', radius * 0.8)
            .attr('pointer-events', 'none')
            .text(icon);
    });

    nodeSelection.merge(nodeEnter);
}

/**
 * Renders node labels.
 * @param {Array} nodes
 */
function renderLabels(nodes) {
    const labelSelection = labelsGroup.selectAll('.node-label')
        .data(nodes, (d) => d.id);

    labelSelection.exit().remove();

    const labelEnter = labelSelection.enter()
        .append('text')
        .attr('class', 'node-label')
        .attr('text-anchor', 'middle')
        .attr('font-size', 11)
        .attr('font-weight', 500)
        .attr('fill', '#e5e7eb')
        .attr('pointer-events', 'none')
        .attr('dy', (d) => getNodeRadius(d) + 16)
        .text((d) => truncateLabel(d.label, 20));

    labelSelection.merge(labelEnter);
}

/**
 * Simulation tick - update positions (no bounds constraint - infinite canvas).
 * @param {Array} nodes
 * @param {Array} edges
 */
function tick(nodes, edges) {
    // No bounds constraint - nodes exist in infinite space

    // Update edges
    edgesGroup.selectAll('.edge')
        .attr('x1', (d) => d.source.x)
        .attr('y1', (d) => d.source.y)
        .attr('x2', (d) => d.target.x)
        .attr('y2', (d) => d.target.y);

    // Update nodes
    nodesGroup.selectAll('.node-group')
        .attr('transform', (d) => `translate(${d.x}, ${d.y})`);

    // Update labels
    labelsGroup.selectAll('.node-label')
        .attr('x', (d) => d.x)
        .attr('y', (d) => d.y);
}

/**
 * Handles node click - expands to show all connections from full graph.
 * @param {Object} node
 */
function onNodeClick(node) {
    // Get ALL connected nodes from the full graph (ignores current filter)
    const connectedNodes = relationshipStore.getConnectedNodes(node.id, 1);
    const connectedEdges = relationshipStore.getConnectedEdges(node.id);

    // Track that we clicked this node
    const result = handleNodeClick(node);
    focusedNode = result.focusedNode;

    // Add any connected nodes that aren't currently rendered
    const newNodesToAdd = [];
    const newEdgesToAdd = [];

    for (const connectedNode of connectedNodes) {
        if (!visibleNodeIds.has(connectedNode.id)) {
            // This connected node is not in the current view - add it!
            newNodesToAdd.push({ ...connectedNode });
            visibleNodeIds.add(connectedNode.id);
        }
    }

    // Add edges for new nodes
    for (const edge of connectedEdges) {
        const sourceId = edge.source.id || edge.source;
        const targetId = edge.target.id || edge.target;
        // Only add edge if both nodes are now visible
        if (visibleNodeIds.has(sourceId) && visibleNodeIds.has(targetId)) {
            newEdgesToAdd.push({ ...edge });
        }
    }

    // If we have new nodes, add them to the simulation dynamically
    if (newNodesToAdd.length > 0) {
        addNodesToGraph(node, newNodesToAdd, newEdgesToAdd);
    }

    // Apply focus visual state (now includes newly added nodes)
    applyFocusState(node, connectedNodes);

    // Pan to the focused node
    panToPoint(node.x, node.y, true);

    // Update UI
    if (onUIUpdate) {
        onUIUpdate({
            breadcrumbs: getBreadcrumbs(),
            focusedNode: node,
        });
    }
}

/**
 * Dynamically adds new nodes and edges to the graph.
 * @param {Object} focusNode - The node that was clicked
 * @param {Array} newNodes - New nodes to add
 * @param {Array} newEdges - New edges to add
 */
function addNodesToGraph(focusNode, newNodes, newEdges) {
    // Position new nodes around the focus node
    const angleStep = (2 * Math.PI) / newNodes.length;
    const orbitDistance = 150;

    for (let i = 0; i < newNodes.length; i++) {
        const angle = i * angleStep;
        newNodes[i].x = focusNode.x + Math.cos(angle) * orbitDistance;
        newNodes[i].y = focusNode.y + Math.sin(angle) * orbitDistance;
    }

    // Add to working nodes reference
    workingNodesRef.push(...newNodes);

    // Get current simulation nodes and edges
    const currentNodes = simulation.nodes();
    const allNodes = [...currentNodes, ...newNodes];

    // Build new edges array (need to reference node objects, not just IDs)
    const nodeMap = new Map(allNodes.map(n => [n.id, n]));
    const resolvedNewEdges = newEdges.map(e => ({
        ...e,
        source: nodeMap.get(e.source.id || e.source) || e.source,
        target: nodeMap.get(e.target.id || e.target) || e.target,
    })).filter(e => e.source && e.target && typeof e.source === 'object');

    // Get current link force edges
    const currentEdges = simulation.force('link').links();
    const allEdges = [...currentEdges, ...resolvedNewEdges];

    // Update simulation
    simulation.nodes(allNodes);
    simulation.force('link').links(allEdges);
    simulation.alpha(0.5).restart();

    // Render the new nodes
    renderEdges(allEdges);
    renderNodes(allNodes);
    renderLabels(allNodes);

    // Set up drag for new nodes
    const drag = createDragBehavior(simulation);
    nodesGroup.selectAll('.node-group').call(drag);
}

/**
 * Handles node hover.
 * @param {Object|null} node
 */
function onNodeHover(node) {
    const result = handleNodeHover(node);

    // Apply hover visual state
    if (node) {
        nodesGroup.selectAll('.node-group')
            .classed('hovered', (d) => d.id === node.id)
            .classed('connected-hover', (d) => result.connectedNodeIds.has(d.id));

        edgesGroup.selectAll('.edge')
            .classed('highlighted', (d) =>
                (d.source.id || d.source) === node.id ||
                (d.target.id || d.target) === node.id
            );
    } else {
        nodesGroup.selectAll('.node-group')
            .classed('hovered', false)
            .classed('connected-hover', false);
        edgesGroup.selectAll('.edge')
            .classed('highlighted', false);
    }
}

/**
 * Applies focus visual state.
 * @param {Object} focusNode
 * @param {Array} connectedNodes
 */
function applyFocusState(focusNode, connectedNodes) {
    const connectedIds = new Set(connectedNodes.map((n) => n.id));
    connectedIds.add(focusNode.id);

    // Update node visuals
    nodesGroup.selectAll('.node-group')
        .classed('focused', (d) => d.id === focusNode.id)
        .classed('connected', (d) => connectedIds.has(d.id) && d.id !== focusNode.id)
        .classed('unfocused', (d) => !connectedIds.has(d.id))
        .transition()
        .duration(300)
        .attr('opacity', (d) => connectedIds.has(d.id) ? 1 : 0.2);

    // Update labels
    labelsGroup.selectAll('.node-label')
        .transition()
        .duration(300)
        .attr('opacity', (d) => connectedIds.has(d.id) ? 1 : 0.1);

    // Update edges
    edgesGroup.selectAll('.edge')
        .classed('focus-edge', (d) =>
            (d.source.id || d.source) === focusNode.id ||
            (d.target.id || d.target) === focusNode.id
        )
        .transition()
        .duration(300)
        .attr('opacity', (d) => {
            const sourceId = d.source.id || d.source;
            const targetId = d.target.id || d.target;
            return sourceId === focusNode.id || targetId === focusNode.id ? 1 : 0.1;
        });
}

/**
 * Unfocuses all nodes and returns to overview.
 */
function unfocusAll() {
    if (focusedNode && simulation) {
        unfocusNode(simulation, focusedNode);
    }
    focusedNode = null;

    // Reset visuals
    nodesGroup.selectAll('.node-group')
        .classed('focused', false)
        .classed('connected', false)
        .classed('unfocused', false)
        .transition()
        .duration(300)
        .attr('opacity', 1);

    labelsGroup.selectAll('.node-label')
        .transition()
        .duration(300)
        .attr('opacity', 1);

    edgesGroup.selectAll('.edge')
        .classed('focus-edge', false)
        .transition()
        .duration(300)
        .attr('opacity', 0.6);

    // Fit to view after unfocus
    setTimeout(() => fitToView(), 100);

    // Update UI
    if (onUIUpdate) {
        onUIUpdate({
            breadcrumbs: [],
            focusedNode: null,
        });
    }
}

/**
 * Handles back button click.
 */
export function goBack() {
    const result = handleBackClick();

    if (result) {
        focusedNode = result.focusedNode;
        applyFocusState(result.focusedNode, result.connectedNodes);
        panToPoint(result.focusedNode.x, result.focusedNode.y, true);
    } else {
        unfocusAll();
    }

    if (onUIUpdate) {
        onUIUpdate({
            breadcrumbs: getBreadcrumbs(),
            focusedNode: focusedNode,
        });
    }
}

/**
 * Applies a filter to show only specific nodes.
 * @param {'area'|'device'|'integration'|'entity'|'automation'|'script'|'scene'} filterType
 * @param {string} [filterId] - Specific ID to filter by
 */
export function applyFilter(filterType, filterId) {
    log.debug(`[ConnectionMap] Applying filter: ${filterType}${filterId ? ` = ${filterId}` : ''}`);

    let filteredNodes;

    if (filterId) {
        filteredNodes = relationshipStore.getNodesForFilter(filterType, filterId);
    } else {
        filteredNodes = relationshipStore.getNodesForFilter(filterType);
    }

    // Also get edges between filtered nodes
    const filteredNodeIds = new Set(filteredNodes.map((n) => n.id));
    const filteredEdges = relationshipStore.edges.filter(
        (e) => filteredNodeIds.has(e.source) && filteredNodeIds.has(e.target)
    );

    // Re-render with filtered data
    renderGraph(filteredNodes, filteredEdges);
}

/**
 * Clears all filters and shows full graph.
 */
export function clearFilter() {
    renderGraph();
}

/**
 * Searches and highlights matching nodes.
 * @param {string} query
 * @returns {Array} Matching nodes
 */
export function searchNodes(query) {
    const results = relationshipStore.searchNodes(query);

    // Highlight matching nodes
    const matchIds = new Set(results.map((n) => n.id));
    nodesGroup.selectAll('.node-group')
        .classed('search-match', (d) => matchIds.has(d.id))
        .transition()
        .duration(200)
        .attr('opacity', (d) => query ? (matchIds.has(d.id) ? 1 : 0.3) : 1);

    return results;
}

/**
 * Clears search highlighting.
 */
export function clearSearch() {
    nodesGroup.selectAll('.node-group')
        .classed('search-match', false)
        .transition()
        .duration(200)
        .attr('opacity', 1);
}

/**
 * Handles interaction state change callback.
 * @param {Object} state
 */
function handleInteractionStateChange(state) {
    // Could update UI based on interaction state if needed
}

/**
 * Generates hexagon points for device nodes.
 * @param {number} radius
 * @returns {string}
 */
function getHexagonPoints(radius) {
    const points = [];
    for (let i = 0; i < 6; i++) {
        const angle = (Math.PI / 3) * i - Math.PI / 6;
        points.push(`${Math.cos(angle) * radius},${Math.sin(angle) * radius}`);
    }
    return points.join(' ');
}

/**
 * Truncates a label to max length.
 * @param {string} label
 * @param {number} maxLength
 * @returns {string}
 */
function truncateLabel(label, maxLength) {
    if (label.length <= maxLength) return label;
    return label.substring(0, maxLength - 1) + '…';
}

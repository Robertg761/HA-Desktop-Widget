/**
 * Graph Layout Module
 * Force simulation configuration and layout calculations using D3.js.
 */

import * as d3 from 'd3';
import log from '../logger.js';

/** @type {number} Simulation alpha target for stable state */
const ALPHA_TARGET = 0;

/** @type {number} Alpha decay rate - lower = slower cooling */
const ALPHA_DECAY = 0.02;

/** @type {number} Velocity decay - friction */
const VELOCITY_DECAY = 0.4;

/**
 * Force simulation configuration presets for different view modes.
 */
const FORCE_PRESETS = {
    default: {
        linkDistance: 120,
        chargeStrength: -400,
        collisionRadius: 50,
        centerStrength: 0.05,
    },
    focused: {
        linkDistance: 100,
        chargeStrength: -300,
        collisionRadius: 45,
        centerStrength: 0.1,
    },
    clustered: {
        linkDistance: 80,
        chargeStrength: -200,
        collisionRadius: 40,
        centerStrength: 0.02,
    },
};

/**
 * Creates a D3 force simulation for the graph.
 * @param {Array} nodes - Graph nodes
 * @param {Array} edges - Graph edges
 * @param {number} width - Container width
 * @param {number} height - Container height
 * @param {string} [preset='default'] - Force preset to use
 * @returns {d3.Simulation}
 */
export function createForceSimulation(nodes, edges, width, height, preset = 'default') {
    const config = FORCE_PRESETS[preset] || FORCE_PRESETS.default;

    log.debug(`[ConnectionMap] Creating force simulation: ${nodes.length} nodes, ${edges.length} edges`);

    const simulation = d3.forceSimulation(nodes)
        .force('link', d3.forceLink(edges)
            .id((d) => d.id)
            .distance(config.linkDistance)
            .strength(0.5)
        )
        .force('charge', d3.forceManyBody()
            .strength(config.chargeStrength)
            .distanceMax(500)
        )
        .force('center', d3.forceCenter(width / 2, height / 2)
            .strength(config.centerStrength)
        )
        .force('collision', d3.forceCollide()
            .radius((d) => getNodeRadius(d) + 10)
            .strength(0.7)
        )
        .force('x', d3.forceX(width / 2).strength(0.03))
        .force('y', d3.forceY(height / 2).strength(0.03))
        .alphaTarget(ALPHA_TARGET)
        .alphaDecay(ALPHA_DECAY)
        .velocityDecay(VELOCITY_DECAY);

    return simulation;
}

/**
 * Gets the visual radius for a node based on its type.
 * @param {Object} node - Graph node
 * @returns {number}
 */
export function getNodeRadius(node) {
    switch (node.type) {
        case 'area':
            return 45;
        case 'device':
            return 35;
        case 'automation':
        case 'script':
        case 'scene':
            return 32;
        case 'integration':
            return 30;
        case 'entity':
        default:
            return 28;
    }
}

/**
 * Updates the simulation center when container resizes.
 * @param {d3.Simulation} simulation
 * @param {number} width
 * @param {number} height
 */
export function updateSimulationCenter(simulation, width, height) {
    simulation.force('center', d3.forceCenter(width / 2, height / 2));
    simulation.force('x', d3.forceX(width / 2).strength(0.03));
    simulation.force('y', d3.forceY(height / 2).strength(0.03));
    simulation.alpha(0.3).restart();
}

/**
 * Applies clustering by a specific attribute (e.g., area, domain).
 * @param {d3.Simulation} simulation
 * @param {Array} nodes
 * @param {string} clusterBy - Attribute to cluster by ('areaId', 'domain', 'type')
 * @param {number} width
 * @param {number} height
 */
export function applyClusterForce(simulation, nodes, clusterBy, width, height) {
    // Group nodes by the clustering attribute
    const groups = {};
    for (const node of nodes) {
        const key = node[clusterBy] || 'unknown';
        if (!groups[key]) {
            groups[key] = [];
        }
        groups[key].push(node);
    }

    // Calculate cluster centers in a grid/circle layout
    const groupKeys = Object.keys(groups);
    const clusterCenters = {};
    const numGroups = groupKeys.length;
    const angleStep = (2 * Math.PI) / numGroups;
    const clusterRadius = Math.min(width, height) * 0.35;

    groupKeys.forEach((key, index) => {
        const angle = index * angleStep - Math.PI / 2;
        clusterCenters[key] = {
            x: width / 2 + Math.cos(angle) * clusterRadius,
            y: height / 2 + Math.sin(angle) * clusterRadius,
        };
    });

    // Add clustering force
    simulation.force('cluster', (alpha) => {
        for (const node of nodes) {
            const key = node[clusterBy] || 'unknown';
            const center = clusterCenters[key];
            if (center) {
                const k = alpha * 0.1;
                node.vx -= (node.x - center.x) * k;
                node.vy -= (node.y - center.y) * k;
            }
        }
    });

    simulation.alpha(0.5).restart();
}

/**
 * Removes clustering force.
 * @param {d3.Simulation} simulation
 */
export function removeClusterForce(simulation) {
    simulation.force('cluster', null);
    simulation.alpha(0.3).restart();
}

/**
 * Focuses the simulation on a specific node.
 * @param {d3.Simulation} simulation
 * @param {Object} focusNode - Node to focus on
 * @param {Array} visibleNodes - Nodes that should be visible (focus + connected)
 * @param {number} width
 * @param {number} height
 */
export function focusOnNode(simulation, focusNode, visibleNodes, width, height) {
    const centerX = width / 2;
    const centerY = height / 2;

    // Strengthen the link force for focused view
    const linkForce = simulation.force('link');
    if (linkForce) {
        linkForce.distance(100).strength(0.8);
    }

    // Add a radial force to arrange connected nodes around the focus
    simulation.force('radial', d3.forceRadial(
        (d) => d.id === focusNode.id ? 0 : 150,
        centerX,
        centerY
    ).strength(0.3));

    // Pin the focus node to center
    focusNode.fx = centerX;
    focusNode.fy = centerY;

    simulation.alpha(0.8).restart();
}

/**
 * Unfocuses and returns to default layout.
 * @param {d3.Simulation} simulation
 * @param {Object} previousFocusNode - Node that was focused
 */
export function unfocusNode(simulation, previousFocusNode) {
    // Unpin the node
    if (previousFocusNode) {
        previousFocusNode.fx = null;
        previousFocusNode.fy = null;
    }

    // Remove radial force
    simulation.force('radial', null);

    // Reset link force
    const linkForce = simulation.force('link');
    if (linkForce) {
        linkForce.distance(120).strength(0.5);
    }

    simulation.alpha(0.5).restart();
}

/**
 * Calculates initial positions for nodes based on their type/grouping.
 * @param {Array} nodes
 * @param {number} width
 * @param {number} height
 * @param {string} [groupBy='type'] - How to group nodes for initial positioning
 */
export function calculateInitialPositions(nodes, width, height, groupBy = 'type') {
    const groups = {};

    // Group nodes
    for (const node of nodes) {
        const key = node[groupBy] || node.type || 'unknown';
        if (!groups[key]) {
            groups[key] = [];
        }
        groups[key].push(node);
    }

    // Position groups in a circle
    const groupKeys = Object.keys(groups);
    const numGroups = groupKeys.length;
    const angleStep = (2 * Math.PI) / numGroups;
    const outerRadius = Math.min(width, height) * 0.4;

    groupKeys.forEach((key, groupIndex) => {
        const groupNodes = groups[key];
        const groupAngle = groupIndex * angleStep - Math.PI / 2;
        const groupCenterX = width / 2 + Math.cos(groupAngle) * outerRadius * 0.5;
        const groupCenterY = height / 2 + Math.sin(groupAngle) * outerRadius * 0.5;

        // Spread nodes within group
        const nodesPerRow = Math.ceil(Math.sqrt(groupNodes.length));
        groupNodes.forEach((node, nodeIndex) => {
            const row = Math.floor(nodeIndex / nodesPerRow);
            const col = nodeIndex % nodesPerRow;
            const spacing = 80;
            const offsetX = (col - nodesPerRow / 2) * spacing;
            const offsetY = (row - Math.ceil(groupNodes.length / nodesPerRow) / 2) * spacing;

            node.x = groupCenterX + offsetX + (Math.random() - 0.5) * 20;
            node.y = groupCenterY + offsetY + (Math.random() - 0.5) * 20;
        });
    });
}

/**
 * Constrains nodes to stay within bounds.
 * @param {Array} nodes
 * @param {number} width
 * @param {number} height
 * @param {number} [padding=50]
 */
export function constrainToBounds(nodes, width, height, padding = 50) {
    for (const node of nodes) {
        const radius = getNodeRadius(node);
        node.x = Math.max(padding + radius, Math.min(width - padding - radius, node.x));
        node.y = Math.max(padding + radius, Math.min(height - padding - radius, node.y));
    }
}

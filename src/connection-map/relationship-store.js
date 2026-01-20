/**
 * Relationship Store Module
 * Centralized store for graph data with computed relationships.
 */

import { EventEmitter } from 'events';
import state from '../state.js';
import log from '../logger.js';
import { fetchAllRelationshipData, fetchEntityRegistry, extractIntegrations } from './relationship-fetcher.js';
import { parseAllRelationships } from './relationship-parser.js';

/**
 * @typedef {Object} GraphNode
 * @property {string} id - Unique node identifier
 * @property {'entity'|'automation'|'script'|'scene'|'device'|'area'|'integration'} type - Node type
 * @property {string} label - Display label
 * @property {string} [domain] - Entity domain (for entity nodes)
 * @property {string} [areaId] - Associated area ID
 * @property {string} [deviceId] - Associated device ID
 * @property {string} [state] - Current state (for entities)
 * @property {Object} [attributes] - Additional attributes
 */

/**
 * @typedef {Object} GraphEdge
 * @property {string} source - Source node ID
 * @property {string} target - Target node ID
 * @property {'triggers'|'controls'|'includes'|'belongs_to'|'located_in'|'domain_of'} type - Relationship type
 */

/**
 * @typedef {Object} GraphData
 * @property {GraphNode[]} nodes - All nodes in the graph
 * @property {GraphEdge[]} edges - All edges in the graph
 */

class RelationshipStore extends EventEmitter {
    constructor() {
        super();
        /** @type {GraphNode[]} */
        this.nodes = [];
        /** @type {GraphEdge[]} */
        this.edges = [];
        /** @type {Map<string, GraphNode>} */
        this.nodeMap = new Map();
        /** @type {Map<string, Set<string>>} */
        this.adjacencyList = new Map();
        /** @type {boolean} */
        this.isLoaded = false;
        /** @type {boolean} */
        this.isLoading = false;
    }

    /**
     * Loads and builds the relationship graph from HA data.
     * @returns {Promise<GraphData>}
     */
    async loadGraph() {
        if (this.isLoading) {
            log.warn('[ConnectionMap] Graph is already loading');
            return { nodes: this.nodes, edges: this.edges };
        }

        this.isLoading = true;
        log.debug('[ConnectionMap] Building relationship graph...');

        try {
            // Fetch all raw data
            const rawData = await fetchAllRelationshipData();
            const entityRegistry = await fetchEntityRegistry();
            const integrations = extractIntegrations();

            // Parse relationships from automations/scripts/scenes
            const parsedData = parseAllRelationships(rawData);

            // Build the graph
            this.buildGraph(rawData, parsedData, entityRegistry, integrations);

            this.isLoaded = true;
            this.isLoading = false;
            this.emit('loaded', { nodes: this.nodes, edges: this.edges });

            log.debug(`[ConnectionMap] Graph built: ${this.nodes.length} nodes, ${this.edges.length} edges`);

            return { nodes: this.nodes, edges: this.edges };
        } catch (error) {
            this.isLoading = false;
            log.error('[ConnectionMap] Failed to build graph:', error);
            throw error;
        }
    }

    /**
     * Builds the complete graph from all data sources.
     * @private
     */
    buildGraph(rawData, parsedData, entityRegistry, integrations) {
        this.nodes = [];
        this.edges = [];
        this.nodeMap.clear();
        this.adjacencyList.clear();

        const { devices, areas } = rawData;
        const { automations, scripts, scenes } = parsedData;

        // Create entity registry lookup
        const entityRegMap = new Map();
        for (const entry of entityRegistry) {
            entityRegMap.set(entry.entityId, entry);
        }

        // 1. Add area nodes
        for (const [areaId, areaData] of Object.entries(areas)) {
            this.addNode({
                id: `area.${areaId}`,
                type: 'area',
                label: areaData.name || areaId,
                attributes: areaData,
            });
        }

        // 2. Add integration/domain nodes
        for (const integration of integrations) {
            this.addNode({
                id: `integration.${integration.id}`,
                type: 'integration',
                label: integration.name,
                domain: integration.id,
            });
        }

        // 3. Add device nodes
        for (const device of devices) {
            this.addNode({
                id: `device.${device.id}`,
                type: 'device',
                label: device.name,
                areaId: device.areaId,
                attributes: {
                    manufacturer: device.manufacturer,
                    model: device.model,
                },
            });

            // Link device to area
            if (device.areaId) {
                this.addEdge({
                    source: `device.${device.id}`,
                    target: `area.${device.areaId}`,
                    type: 'located_in',
                });
            }
        }

        // 4. Add entity nodes
        for (const [entityId, entityState] of Object.entries(state.STATES || {})) {
            const domain = entityId.split('.')[0];
            const regEntry = entityRegMap.get(entityId);

            // Skip automations, scripts, scenes - they get their own node type
            if (['automation', 'script', 'scene'].includes(domain)) {
                continue;
            }

            const friendlyName = entityState.attributes?.friendly_name || entityId;

            this.addNode({
                id: entityId,
                type: 'entity',
                label: friendlyName,
                domain,
                areaId: regEntry?.areaId || null,
                deviceId: regEntry?.deviceId || null,
                state: entityState.state,
                attributes: entityState.attributes,
            });

            // Link entity to device
            if (regEntry?.deviceId) {
                this.addEdge({
                    source: entityId,
                    target: `device.${regEntry.deviceId}`,
                    type: 'belongs_to',
                });
            }

            // Link entity to area (if no device, or device has no area)
            if (regEntry?.areaId) {
                this.addEdge({
                    source: entityId,
                    target: `area.${regEntry.areaId}`,
                    type: 'located_in',
                });
            }

            // Link entity to integration/domain
            this.addEdge({
                source: entityId,
                target: `integration.${domain}`,
                type: 'domain_of',
            });
        }

        // 5. Add automation nodes and their relationships
        for (const automation of automations) {
            const entityState = state.STATES?.[automation.entityId];
            const friendlyName = entityState?.attributes?.friendly_name || automation.alias;

            this.addNode({
                id: automation.entityId,
                type: 'automation',
                label: friendlyName,
                state: entityState?.state,
                attributes: {
                    triggerCount: automation.triggerEntities.length,
                    actionCount: automation.actionEntities.length,
                },
            });

            // Trigger relationships
            for (const triggerId of automation.triggerEntities) {
                if (this.nodeMap.has(triggerId)) {
                    this.addEdge({
                        source: automation.entityId,
                        target: triggerId,
                        type: 'triggers',
                    });
                }
            }

            // Action/control relationships
            for (const actionId of automation.actionEntities) {
                if (this.nodeMap.has(actionId)) {
                    this.addEdge({
                        source: automation.entityId,
                        target: actionId,
                        type: 'controls',
                    });
                }
            }

            // Condition relationships (using same edge type as triggers for simplicity)
            for (const conditionId of automation.conditionEntities) {
                if (this.nodeMap.has(conditionId) && !automation.triggerEntities.includes(conditionId)) {
                    this.addEdge({
                        source: automation.entityId,
                        target: conditionId,
                        type: 'triggers', // Conditions are read like triggers
                    });
                }
            }
        }

        // 6. Add script nodes and their relationships
        for (const script of scripts) {
            const entityState = state.STATES?.[script.entityId];
            const friendlyName = entityState?.attributes?.friendly_name || script.alias;

            this.addNode({
                id: script.entityId,
                type: 'script',
                label: friendlyName,
                state: entityState?.state,
                attributes: {
                    actionCount: script.actionEntities.length,
                },
            });

            // Action/control relationships
            for (const actionId of script.actionEntities) {
                if (this.nodeMap.has(actionId)) {
                    this.addEdge({
                        source: script.entityId,
                        target: actionId,
                        type: 'controls',
                    });
                }
            }
        }

        // 7. Add scene nodes and their relationships
        for (const scene of scenes) {
            const entityState = state.STATES?.[scene.entityId];
            const friendlyName = entityState?.attributes?.friendly_name || scene.entityId;

            this.addNode({
                id: scene.entityId,
                type: 'scene',
                label: friendlyName,
                state: entityState?.state,
                attributes: {
                    entityCount: scene.entities.length,
                },
            });

            // Include relationships
            for (const includedId of scene.entities) {
                if (this.nodeMap.has(includedId)) {
                    this.addEdge({
                        source: scene.entityId,
                        target: includedId,
                        type: 'includes',
                    });
                }
            }
        }

        // Build adjacency list for quick lookups
        this.buildAdjacencyList();
    }

    /**
     * Adds a node to the graph.
     * @private
     * @param {GraphNode} node
     */
    addNode(node) {
        if (!this.nodeMap.has(node.id)) {
            this.nodes.push(node);
            this.nodeMap.set(node.id, node);
        }
    }

    /**
     * Adds an edge to the graph.
     * @private
     * @param {GraphEdge} edge
     */
    addEdge(edge) {
        // Avoid duplicate edges
        const edgeKey = `${edge.source}|${edge.target}|${edge.type}`;
        if (!this.edges.some(e => `${e.source}|${e.target}|${e.type}` === edgeKey)) {
            this.edges.push(edge);
        }
    }

    /**
     * Builds an adjacency list for quick neighbor lookups.
     * @private
     */
    buildAdjacencyList() {
        this.adjacencyList.clear();

        for (const node of this.nodes) {
            this.adjacencyList.set(node.id, new Set());
        }

        for (const edge of this.edges) {
            // Bidirectional for navigation purposes
            this.adjacencyList.get(edge.source)?.add(edge.target);
            this.adjacencyList.get(edge.target)?.add(edge.source);
        }
    }

    /**
     * Gets a node by ID.
     * @param {string} nodeId
     * @returns {GraphNode|undefined}
     */
    getNode(nodeId) {
        return this.nodeMap.get(nodeId);
    }

    /**
     * Gets nodes connected to a given node up to N levels deep.
     * @param {string} nodeId - Starting node ID
     * @param {number} depth - How many levels deep to traverse (default 1)
     * @returns {GraphNode[]}
     */
    getConnectedNodes(nodeId, depth = 1) {
        const visited = new Set([nodeId]);
        const result = [];
        let currentLevel = [nodeId];

        for (let level = 0; level < depth && currentLevel.length > 0; level++) {
            const nextLevel = [];

            for (const currentId of currentLevel) {
                const neighbors = this.adjacencyList.get(currentId) || new Set();

                for (const neighborId of neighbors) {
                    if (!visited.has(neighborId)) {
                        visited.add(neighborId);
                        nextLevel.push(neighborId);
                        const node = this.nodeMap.get(neighborId);
                        if (node) {
                            result.push(node);
                        }
                    }
                }
            }

            currentLevel = nextLevel;
        }

        return result;
    }

    /**
     * Gets edges connected to a given node.
     * @param {string} nodeId
     * @returns {GraphEdge[]}
     */
    getConnectedEdges(nodeId) {
        return this.edges.filter(
            (edge) => edge.source === nodeId || edge.target === nodeId
        );
    }

    /**
     * Gets a filtered subset of nodes.
     * @param {'area'|'device'|'entity'|'integration'|'automation'|'script'|'scene'} filterType
     * @param {string} [filterId] - Optional specific ID to filter by
     * @returns {GraphNode[]}
     */
    getNodesForFilter(filterType, filterId) {
        if (!filterId) {
            // Return all nodes of the given type
            return this.nodes.filter((node) => node.type === filterType);
        }

        switch (filterType) {
            case 'area':
                // Get all nodes in a specific area
                return this.nodes.filter(
                    (node) =>
                        node.areaId === filterId ||
                        node.id === `area.${filterId}`
                );

            case 'device':
                // Get a specific device and its entities
                return this.nodes.filter(
                    (node) =>
                        node.deviceId === filterId ||
                        node.id === `device.${filterId}`
                );

            case 'integration':
                // Get all entities of a specific domain
                return this.nodes.filter(
                    (node) =>
                        node.domain === filterId ||
                        node.id === `integration.${filterId}`
                );

            default:
                // Return nodes of the specified type
                return this.nodes.filter((node) => node.type === filterType);
        }
    }

    /**
     * Searches nodes by label or ID.
     * @param {string} query - Search query
     * @returns {GraphNode[]}
     */
    searchNodes(query) {
        const lowerQuery = query.toLowerCase();
        return this.nodes.filter(
            (node) =>
                node.id.toLowerCase().includes(lowerQuery) ||
                node.label.toLowerCase().includes(lowerQuery)
        );
    }

    /**
     * Gets all unique areas.
     * @returns {GraphNode[]}
     */
    getAreas() {
        return this.nodes.filter((node) => node.type === 'area');
    }

    /**
     * Gets all unique integrations/domains.
     * @returns {GraphNode[]}
     */
    getIntegrations() {
        return this.nodes.filter((node) => node.type === 'integration');
    }

    /**
     * Gets all devices.
     * @returns {GraphNode[]}
     */
    getDevices() {
        return this.nodes.filter((node) => node.type === 'device');
    }

    /**
     * Gets statistics about the graph.
     * @returns {Object}
     */
    getStats() {
        const typeCount = {};
        for (const node of this.nodes) {
            typeCount[node.type] = (typeCount[node.type] || 0) + 1;
        }

        const edgeTypeCount = {};
        for (const edge of this.edges) {
            edgeTypeCount[edge.type] = (edgeTypeCount[edge.type] || 0) + 1;
        }

        return {
            totalNodes: this.nodes.length,
            totalEdges: this.edges.length,
            nodesByType: typeCount,
            edgesByType: edgeTypeCount,
        };
    }

    /**
     * Clears the graph data.
     */
    clear() {
        this.nodes = [];
        this.edges = [];
        this.nodeMap.clear();
        this.adjacencyList.clear();
        this.isLoaded = false;
    }
}

// Singleton instance
const relationshipStore = new RelationshipStore();
export default relationshipStore;

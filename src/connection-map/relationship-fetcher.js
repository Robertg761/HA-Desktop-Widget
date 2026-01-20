/**
 * Relationship Fetcher Module
 * Fetches automation, script, scene, device, and area configs from Home Assistant via WebSocket.
 */

import websocket from '../websocket.js';
import state from '../state.js';
import log from '../logger.js';

/** @type {number} Maximum concurrent requests to avoid overwhelming HA */
const MAX_CONCURRENT_REQUESTS = 10;

/**
 * Fetches all relationship data from Home Assistant.
 * @returns {Promise<{automations: Array, scripts: Array, scenes: Array, devices: Array, areas: Object}>}
 */
export async function fetchAllRelationshipData() {
    log.debug('[ConnectionMap] Fetching all relationship data...');

    try {
        const [automations, scripts, scenes, devices] = await Promise.all([
            fetchAutomationConfigs(),
            fetchScriptConfigs(),
            fetchScenes(),
            fetchDeviceRegistry(),
        ]);

        // Areas are already in state from initial connection
        const areas = state.AREAS || {};

        log.debug(`[ConnectionMap] Fetched: ${automations.length} automations, ${scripts.length} scripts, ${scenes.length} scenes, ${devices.length} devices, ${Object.keys(areas).length} areas`);

        return {
            automations,
            scripts,
            scenes,
            devices,
            areas,
        };
    } catch (error) {
        log.error('[ConnectionMap] Failed to fetch relationship data:', error);
        throw error;
    }
}

/**
 * Fetches all automation configurations.
 * @returns {Promise<Array<{entityId: string, config: Object}>>}
 */
export async function fetchAutomationConfigs() {
    const automationEntities = Object.keys(state.STATES || {}).filter(
        (id) => id.startsWith('automation.')
    );

    if (automationEntities.length === 0) {
        return [];
    }

    log.debug(`[ConnectionMap] Fetching configs for ${automationEntities.length} automations...`);

    const results = await fetchInBatches(automationEntities, async (entityId) => {
        try {
            const response = await websocket.request({
                type: 'automation/config',
                entity_id: entityId,
            });

            if (response.success && response.result) {
                return { entityId, config: response.result };
            }
            return null;
        } catch (error) {
            log.warn(`[ConnectionMap] Failed to fetch automation config for ${entityId}:`, error.message);
            return null;
        }
    });

    return results.filter(Boolean);
}

/**
 * Fetches all script configurations.
 * @returns {Promise<Array<{entityId: string, config: Object}>>}
 */
export async function fetchScriptConfigs() {
    const scriptEntities = Object.keys(state.STATES || {}).filter(
        (id) => id.startsWith('script.')
    );

    if (scriptEntities.length === 0) {
        return [];
    }

    log.debug(`[ConnectionMap] Fetching configs for ${scriptEntities.length} scripts...`);

    const results = await fetchInBatches(scriptEntities, async (entityId) => {
        try {
            const response = await websocket.request({
                type: 'script/config',
                entity_id: entityId,
            });

            if (response.success && response.result) {
                return { entityId, config: response.result };
            }
            return null;
        } catch (error) {
            log.warn(`[ConnectionMap] Failed to fetch script config for ${entityId}:`, error.message);
            return null;
        }
    });

    return results.filter(Boolean);
}

/**
 * Fetches all scenes.
 * @returns {Promise<Array<{entityId: string, entities: Object}>>}
 */
export async function fetchScenes() {
    const sceneEntities = Object.keys(state.STATES || {}).filter(
        (id) => id.startsWith('scene.')
    );

    // Scenes don't have a config endpoint like automations/scripts
    // Their entity state contains the entities they control
    return sceneEntities.map((entityId) => {
        const entityState = state.STATES[entityId];
        return {
            entityId,
            entities: entityState?.attributes?.entity_id || [],
        };
    });
}

/**
 * Fetches the device registry.
 * @returns {Promise<Array<{id: string, name: string, manufacturer: string, model: string, areaId: string, entities: Array}>>}
 */
export async function fetchDeviceRegistry() {
    try {
        const response = await websocket.request({
            type: 'config/device_registry/list',
        });

        if (response.success && Array.isArray(response.result)) {
            return response.result.map((device) => ({
                id: device.id,
                name: device.name_by_user || device.name || 'Unknown Device',
                manufacturer: device.manufacturer || 'Unknown',
                model: device.model || '',
                areaId: device.area_id || null,
                // Entity list will be populated later by cross-referencing
                entities: [],
            }));
        }

        return [];
    } catch (error) {
        log.warn('[ConnectionMap] Failed to fetch device registry:', error.message);
        return [];
    }
}

/**
 * Fetches the entity registry to get device/area associations.
 * @returns {Promise<Array<{entityId: string, deviceId: string, areaId: string}>>}
 */
export async function fetchEntityRegistry() {
    try {
        const response = await websocket.request({
            type: 'config/entity_registry/list',
        });

        if (response.success && Array.isArray(response.result)) {
            return response.result.map((entry) => ({
                entityId: entry.entity_id,
                deviceId: entry.device_id || null,
                areaId: entry.area_id || null,
                platform: entry.platform || null,
            }));
        }

        return [];
    } catch (error) {
        log.warn('[ConnectionMap] Failed to fetch entity registry:', error.message);
        return [];
    }
}

/**
 * Extracts unique integrations (domains) from entity IDs.
 * @returns {Array<{id: string, name: string}>}
 */
export function extractIntegrations() {
    const domains = new Set();

    Object.keys(state.STATES || {}).forEach((entityId) => {
        const domain = entityId.split('.')[0];
        if (domain) {
            domains.add(domain);
        }
    });

    return Array.from(domains).map((domain) => ({
        id: domain,
        name: formatDomainName(domain),
    }));
}

/**
 * Formats a domain name for display.
 * @param {string} domain - The domain (e.g., 'light', 'binary_sensor')
 * @returns {string} Formatted name (e.g., 'Light', 'Binary Sensor')
 */
function formatDomainName(domain) {
    return domain
        .split('_')
        .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
        .join(' ');
}

/**
 * Executes async operations in batches to avoid overwhelming the WebSocket.
 * @template T
 * @param {Array<T>} items - Items to process
 * @param {function(T): Promise<*>} asyncFn - Async function to apply to each item
 * @returns {Promise<Array<*>>} Results
 */
async function fetchInBatches(items, asyncFn) {
    const results = [];

    for (let i = 0; i < items.length; i += MAX_CONCURRENT_REQUESTS) {
        const batch = items.slice(i, i + MAX_CONCURRENT_REQUESTS);
        const batchResults = await Promise.all(batch.map(asyncFn));
        results.push(...batchResults);
    }

    return results;
}

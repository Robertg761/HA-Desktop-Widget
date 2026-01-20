/**
 * Relationship Parser Module
 * Parses automation/script YAML configs to extract entity relationships.
 */

import log from '../logger.js';

/**
 * @typedef {Object} ParsedAutomation
 * @property {string} entityId - The automation entity ID
 * @property {string} alias - The automation name/alias
 * @property {Array<string>} triggerEntities - Entities that trigger this automation
 * @property {Array<string>} conditionEntities - Entities used in conditions
 * @property {Array<string>} actionEntities - Entities controlled by actions
 */

/**
 * @typedef {Object} ParsedScript
 * @property {string} entityId - The script entity ID
 * @property {string} alias - The script name/alias
 * @property {Array<string>} actionEntities - Entities controlled by the script
 */

/**
 * @typedef {Object} ParsedScene
 * @property {string} entityId - The scene entity ID
 * @property {Array<string>} entities - Entities included in the scene
 */

/**
 * Parses an automation config to extract entity relationships.
 * @param {string} entityId - The automation entity ID
 * @param {Object} config - The automation configuration object
 * @returns {ParsedAutomation}
 */
export function parseAutomation(entityId, config) {
    const triggerEntities = new Set();
    const conditionEntities = new Set();
    const actionEntities = new Set();

    // Parse triggers
    const triggers = Array.isArray(config.trigger) ? config.trigger : (config.trigger ? [config.trigger] : []);
    for (const trigger of triggers) {
        extractEntitiesFromTrigger(trigger, triggerEntities);
    }

    // Parse conditions
    const conditions = Array.isArray(config.condition) ? config.condition : (config.condition ? [config.condition] : []);
    for (const condition of conditions) {
        extractEntitiesFromCondition(condition, conditionEntities);
    }

    // Parse actions
    const actions = Array.isArray(config.action) ? config.action : (config.action ? [config.action] : []);
    for (const action of actions) {
        extractEntitiesFromAction(action, actionEntities);
    }

    return {
        entityId,
        alias: config.alias || entityId.replace('automation.', ''),
        triggerEntities: Array.from(triggerEntities),
        conditionEntities: Array.from(conditionEntities),
        actionEntities: Array.from(actionEntities),
    };
}

/**
 * Parses a script config to extract entity relationships.
 * @param {string} entityId - The script entity ID
 * @param {Object} config - The script configuration object
 * @returns {ParsedScript}
 */
export function parseScript(entityId, config) {
    const actionEntities = new Set();

    // Scripts have a sequence of actions
    const sequence = Array.isArray(config.sequence) ? config.sequence : (config.sequence ? [config.sequence] : []);
    for (const action of sequence) {
        extractEntitiesFromAction(action, actionEntities);
    }

    return {
        entityId,
        alias: config.alias || entityId.replace('script.', ''),
        actionEntities: Array.from(actionEntities),
    };
}

/**
 * Parses a scene to extract entity relationships.
 * @param {string} entityId - The scene entity ID
 * @param {Array<string>} entities - Entities included in the scene
 * @returns {ParsedScene}
 */
export function parseScene(entityId, entities) {
    return {
        entityId,
        entities: Array.isArray(entities) ? entities : [],
    };
}

/**
 * Extracts entity IDs from a trigger configuration.
 * @param {Object} trigger - Trigger configuration
 * @param {Set<string>} entities - Set to add found entities to
 */
function extractEntitiesFromTrigger(trigger, entities) {
    if (!trigger) return;

    // State trigger
    if (trigger.entity_id) {
        addEntityIds(trigger.entity_id, entities);
    }

    // Device trigger (may reference entity indirectly)
    if (trigger.platform === 'device' && trigger.entity_id) {
        addEntityIds(trigger.entity_id, entities);
    }

    // Zone trigger
    if (trigger.platform === 'zone' && trigger.entity_id) {
        addEntityIds(trigger.entity_id, entities);
    }
    if (trigger.zone) {
        addEntityIds(trigger.zone, entities);
    }

    // Numeric state trigger
    if (trigger.platform === 'numeric_state' && trigger.entity_id) {
        addEntityIds(trigger.entity_id, entities);
    }

    // Template trigger - try to extract entity IDs from template
    if (trigger.platform === 'template' && trigger.value_template) {
        extractEntitiesFromTemplate(trigger.value_template, entities);
    }

    // Calendar trigger
    if (trigger.platform === 'calendar' && trigger.entity_id) {
        addEntityIds(trigger.entity_id, entities);
    }

    // Event trigger with entity filter
    if (trigger.event_data?.entity_id) {
        addEntityIds(trigger.event_data.entity_id, entities);
    }
}

/**
 * Extracts entity IDs from a condition configuration.
 * @param {Object} condition - Condition configuration
 * @param {Set<string>} entities - Set to add found entities to
 */
function extractEntitiesFromCondition(condition, entities) {
    if (!condition) return;

    // State condition
    if (condition.entity_id) {
        addEntityIds(condition.entity_id, entities);
    }

    // Numeric state condition
    if (condition.condition === 'numeric_state' && condition.entity_id) {
        addEntityIds(condition.entity_id, entities);
    }

    // Zone condition
    if (condition.condition === 'zone' && condition.entity_id) {
        addEntityIds(condition.entity_id, entities);
    }
    if (condition.zone) {
        addEntityIds(condition.zone, entities);
    }

    // Template condition
    if (condition.condition === 'template' && condition.value_template) {
        extractEntitiesFromTemplate(condition.value_template, entities);
    }

    // Device condition
    if (condition.condition === 'device' && condition.entity_id) {
        addEntityIds(condition.entity_id, entities);
    }

    // Logical conditions (and, or, not)
    if (condition.conditions && Array.isArray(condition.conditions)) {
        for (const subCondition of condition.conditions) {
            extractEntitiesFromCondition(subCondition, entities);
        }
    }
}

/**
 * Extracts entity IDs from an action configuration.
 * @param {Object} action - Action configuration
 * @param {Set<string>} entities - Set to add found entities to
 */
function extractEntitiesFromAction(action, entities) {
    if (!action) return;

    // Service call with target
    if (action.target?.entity_id) {
        addEntityIds(action.target.entity_id, entities);
    }

    // Legacy service call format
    if (action.entity_id) {
        addEntityIds(action.entity_id, entities);
    }

    // Service call data
    if (action.data?.entity_id) {
        addEntityIds(action.data.entity_id, entities);
    }

    // Service data (alternative key)
    if (action.service_data?.entity_id) {
        addEntityIds(action.service_data.entity_id, entities);
    }

    // Device action
    if (action.device_id && action.entity_id) {
        addEntityIds(action.entity_id, entities);
    }

    // Scene activation
    if (action.scene) {
        addEntityIds(action.scene, entities);
    }

    // Script call
    if (action.service === 'script.turn_on' || action.service?.startsWith('script.')) {
        const scriptId = action.service?.replace('script.', 'script.') || action.target?.entity_id;
        if (scriptId) {
            addEntityIds(scriptId, entities);
        }
    }

    // Wait for trigger (contains trigger definition)
    if (action.wait_template) {
        extractEntitiesFromTemplate(action.wait_template, entities);
    }

    // Choose action (branching)
    if (action.choose && Array.isArray(action.choose)) {
        for (const choice of action.choose) {
            // Each choice can have conditions and a sequence
            if (choice.conditions) {
                for (const condition of Array.isArray(choice.conditions) ? choice.conditions : [choice.conditions]) {
                    extractEntitiesFromCondition(condition, entities);
                }
            }
            if (choice.sequence) {
                for (const subAction of Array.isArray(choice.sequence) ? choice.sequence : [choice.sequence]) {
                    extractEntitiesFromAction(subAction, entities);
                }
            }
        }
        // Default sequence
        if (action.default) {
            for (const subAction of Array.isArray(action.default) ? action.default : [action.default]) {
                extractEntitiesFromAction(subAction, entities);
            }
        }
    }

    // If-then-else action
    if (action.if) {
        for (const condition of Array.isArray(action.if) ? action.if : [action.if]) {
            extractEntitiesFromCondition(condition, entities);
        }
    }
    if (action.then) {
        for (const subAction of Array.isArray(action.then) ? action.then : [action.then]) {
            extractEntitiesFromAction(subAction, entities);
        }
    }
    if (action.else) {
        for (const subAction of Array.isArray(action.else) ? action.else : [action.else]) {
            extractEntitiesFromAction(subAction, entities);
        }
    }

    // Repeat action
    if (action.repeat?.sequence) {
        for (const subAction of Array.isArray(action.repeat.sequence) ? action.repeat.sequence : [action.repeat.sequence]) {
            extractEntitiesFromAction(subAction, entities);
        }
    }

    // Parallel action
    if (action.parallel && Array.isArray(action.parallel)) {
        for (const subAction of action.parallel) {
            extractEntitiesFromAction(subAction, entities);
        }
    }

    // Sequence action
    if (action.sequence && Array.isArray(action.sequence)) {
        for (const subAction of action.sequence) {
            extractEntitiesFromAction(subAction, entities);
        }
    }
}

/**
 * Extracts entity IDs from a Jinja2 template string.
 * Uses regex to find states('entity_id') and is_state('entity_id', ...) patterns.
 * @param {string} template - The template string
 * @param {Set<string>} entities - Set to add found entities to
 */
function extractEntitiesFromTemplate(template, entities) {
    if (typeof template !== 'string') return;

    // Match patterns like:
    // states('sensor.temperature')
    // states.sensor.temperature
    // is_state('light.living_room', 'on')
    // state_attr('sensor.temp', 'unit')
    const patterns = [
        /states\(\s*['"]([a-z_]+\.[a-z0-9_]+)['"]\s*\)/gi,
        /states\.([a-z_]+\.[a-z0-9_]+)/gi,
        /is_state\(\s*['"]([a-z_]+\.[a-z0-9_]+)['"]/gi,
        /state_attr\(\s*['"]([a-z_]+\.[a-z0-9_]+)['"]/gi,
        /expand\(\s*['"]([a-z_]+\.[a-z0-9_]+)['"]/gi,
    ];

    for (const pattern of patterns) {
        let match;
        while ((match = pattern.exec(template)) !== null) {
            entities.add(match[1]);
        }
    }
}

/**
 * Adds entity ID(s) to a set, handling both single IDs and arrays.
 * @param {string|Array<string>} entityIds - Entity ID or array of IDs
 * @param {Set<string>} entities - Set to add to
 */
function addEntityIds(entityIds, entities) {
    if (Array.isArray(entityIds)) {
        for (const id of entityIds) {
            if (typeof id === 'string' && id.includes('.')) {
                entities.add(id);
            }
        }
    } else if (typeof entityIds === 'string' && entityIds.includes('.')) {
        entities.add(entityIds);
    }
}

/**
 * Parses all automations, scripts, and scenes to extract relationships.
 * @param {Object} data - Raw data from relationship-fetcher
 * @returns {{automations: ParsedAutomation[], scripts: ParsedScript[], scenes: ParsedScene[]}}
 */
export function parseAllRelationships(data) {
    const { automations, scripts, scenes } = data;

    const parsedAutomations = automations.map(({ entityId, config }) =>
        parseAutomation(entityId, config)
    );

    const parsedScripts = scripts.map(({ entityId, config }) =>
        parseScript(entityId, config)
    );

    const parsedScenes = scenes.map(({ entityId, entities }) =>
        parseScene(entityId, entities)
    );

    log.debug(`[ConnectionMap] Parsed relationships: ${parsedAutomations.length} automations, ${parsedScripts.length} scripts, ${parsedScenes.length} scenes`);

    return {
        automations: parsedAutomations,
        scripts: parsedScripts,
        scenes: parsedScenes,
    };
}

/**
 * Global application state
 * Uses a singleton pattern with getters for reactive access
 */

let CONFIG = null;
let WS = null;
let STATES = {};
let SERVICES = {};
let AREAS = {};
const entityListeners = new Map();

export function subscribeEntity(entityId, listener) {
  if (!entityListeners.has(entityId)) entityListeners.set(entityId, new Set());
  const listeners = entityListeners.get(entityId);
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
    if (!listeners.size) entityListeners.delete(entityId);
  };
}

function notifyEntity(entityId) {
  entityListeners.get(entityId)?.forEach((listener) => {
    try {
      listener(STATES?.[entityId]);
    } catch (error) {
      console.error('Error updating entity subscriber:', error);
    }
  });
}
export const ACTIVE_HLS = new Map();
let UNIT_SYSTEM = {
  temperature: '°C',
  length: 'km',
  wind_speed: 'm/s',
  pressure: 'hPa',
  precipitation: 'mm',
  volume: 'L',
  mass: 'kg',
};

// Setter functions
export function setConfig(newConfig) {
  try {
    if (
      newConfig &&
      typeof newConfig === 'object' &&
      (Object.prototype.hasOwnProperty.call(newConfig, 'configRecovery') ||
        Object.prototype.hasOwnProperty.call(newConfig, 'configRevision') ||
        Object.prototype.hasOwnProperty.call(newConfig, 'persistenceWarnings') ||
        Object.prototype.hasOwnProperty.call(newConfig, 'runtimeWarnings'))
    ) {
      const persistentConfig = { ...newConfig };
      delete persistentConfig.configRecovery;
      delete persistentConfig.configRevision;
      delete persistentConfig.persistenceWarnings;
      delete persistentConfig.runtimeWarnings;
      CONFIG = persistentConfig;
    } else {
      CONFIG = newConfig;
    }
  } catch (error) {
    console.error('Error setting config:', error);
  }
}
export function setWs(newWs) {
  try {
    WS = newWs;
  } catch (error) {
    console.error('Error setting WebSocket:', error);
  }
}
export function setStates(newStates) {
  try {
    STATES = newStates;
    entityListeners.forEach((_, entityId) => notifyEntity(entityId));
  } catch (error) {
    console.error('Error setting states:', error);
  }
}
export function setEntityState(entity) {
  try {
    if (!entity || typeof entity !== 'object' || !entity.entity_id) return;
    STATES[entity.entity_id] = entity;
    notifyEntity(entity.entity_id);
  } catch (error) {
    console.error('Error setting entity state:', error);
  }
}
export function deleteEntityState(entityId) {
  try {
    if (typeof entityId !== 'string' || !entityId.trim()) return false;
    if (!STATES || typeof STATES !== 'object') return false;
    const normalizedEntityId = entityId.trim();
    if (!Object.prototype.hasOwnProperty.call(STATES, normalizedEntityId)) return false;
    delete STATES[normalizedEntityId];
    notifyEntity(normalizedEntityId);
    return true;
  } catch (error) {
    console.error('Error deleting entity state:', error);
    return false;
  }
}
export function setServices(newServices) {
  try {
    SERVICES = newServices;
  } catch (error) {
    console.error('Error setting services:', error);
  }
}
export function setAreas(newAreas) {
  try {
    AREAS = newAreas;
  } catch (error) {
    console.error('Error setting areas:', error);
  }
}
export function setUnitSystem(newUnitSystem) {
  try {
    UNIT_SYSTEM = newUnitSystem;
  } catch (error) {
    console.error('Error setting unit system:', error);
  }
}

// State object with getters for reactive access
// This pattern allows other modules to always get the current value
const state = {
  get CONFIG() {
    return CONFIG;
  },
  get WS() {
    return WS;
  },
  get STATES() {
    return STATES;
  },
  get SERVICES() {
    return SERVICES;
  },
  get AREAS() {
    return AREAS;
  },
  ACTIVE_HLS,
  get UNIT_SYSTEM() {
    return UNIT_SYSTEM;
  },
  setConfig,
  setWs,
  setStates,
  setEntityState,
  subscribeEntity,
  deleteEntityState,
  setServices,
  setAreas,
  setUnitSystem,
};

export default state;

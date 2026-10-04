import { t } from './i18n.js';

// HA 2026.9 returns child devices alongside regular ones. A child device with no area
// of its own belongs to its parent's area, and children cannot nest, so one hop is enough.
function effectiveDeviceAreas(devices) {
  const ownAreas = new Map(devices.map((device) => [device.id, device.area_id]));
  return new Map(
    devices.map((device) => [
      device.id,
      device.area_id || (device.parent_device_id ? ownAreas.get(device.parent_device_id) : null),
    ])
  );
}

function entitiesForArea(areaId, entities, devices, states) {
  const deviceAreas = effectiveDeviceAreas(devices);
  return entities
    .filter(
      (entity) =>
        !entity.disabled_by &&
        !entity.hidden_by &&
        states[entity.entity_id] &&
        (entity.area_id || deviceAreas.get(entity.device_id)) === areaId
    )
    .map((entity) => entity.entity_id);
}

// A first page is made of what a person switches or sets. A lock, a scene or a script does
// something with one click, so those stay in the list unticked, like sensors and buttons.
const PAGE_DEVICE_DOMAINS = ['light', 'switch', 'climate', 'fan', 'cover', 'media_player'];
// Appliances come after a room's lights and switches when the page has no room for all of them.
const PAGE_APPLIANCE_DOMAINS = ['vacuum', 'humidifier', 'water_heater'];
const UNREADY_STATES = new Set(['unknown', 'unavailable']);

// The entities among these ids that a new page can start with: available, in one of the domains
// above, and not a device's own configuration or diagnostic entity (the "LED indicator" and "Child
// lock" switches a Zigbee or Z-Wave device adds to every room). Those stay in the list for anyone
// who wants them. An id with no registry entry is a state-only entity and counts like any other.
function defaultPageEntityIds(entityIds, registryEntities, states, limit = Infinity) {
  const deviceSettings = new Set(
    registryEntities.filter((entity) => entity.entity_category).map((entity) => entity.entity_id)
  );
  const ready = entityIds.filter(
    (id) => !deviceSettings.has(id) && !UNREADY_STATES.has(states[id]?.state)
  );
  const inDomains = (domains) => ready.filter((id) => domains.includes(id.split('.')[0]));
  return [...inDomains(PAGE_DEVICE_DOMAINS), ...inDomains(PAGE_APPLIANCE_DOMAINS)].slice(0, limit);
}

// The room a first-run page starts from: the one with the most controllable entities, and by name
// when rooms tie. A room that holds only sensors or a device's settings is not a start, and with
// no room that has anything to control the starter shows every device instead (an empty id).
function pickStarterArea(areas, entities, devices, states) {
  let best = { areaId: '', count: 0 };
  [...areas]
    .sort((a, b) => a.name.localeCompare(b.name))
    .forEach((area) => {
      const count = defaultPageEntityIds(
        entitiesForArea(area.area_id, entities, devices, states),
        entities,
        states
      ).length;
      if (count > best.count) best = { areaId: area.area_id, count };
    });
  return best.areaId;
}

async function loadRoomRegistry(websocket) {
  const responses = await Promise.all(
    ['area', 'entity', 'device'].map((kind) =>
      websocket.request({ type: `config/${kind}_registry/list` })
    )
  );
  if (
    responses.some((response) => response?.success === false || !Array.isArray(response?.result))
  ) {
    // Home Assistant answered but refused, so retrying will not help (unlike a dropped connection).
    const error = new Error(
      t('Room information is unavailable. Check your Home Assistant permissions.')
    );
    error.code = 'registry_unavailable';
    throw error;
  }
  return {
    areas: responses[0].result,
    entities: responses[1].result,
    devices: responses[2].result,
  };
}

// Registry entries can omit state-only entities. Exclude known hidden/disabled entries
// without dropping those state-only entities or requiring administrator access.
function selectableEntityIds(states, entities = []) {
  const excluded = new Set(
    entities
      .filter((entity) => entity.hidden_by || entity.disabled_by)
      .map((entity) => entity.entity_id)
  );
  return Object.keys(states).filter((id) => !excluded.has(id));
}

async function waitForRoomConnection(websocket, isActive, timeoutMs = 15000) {
  const deadline = Date.now() + timeoutMs;
  while (isActive()) {
    if (websocket.isConnected()) return true;
    if (Date.now() >= deadline) throw new Error(t('Connection is not ready'));
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  return false;
}

export {
  defaultPageEntityIds,
  entitiesForArea,
  loadRoomRegistry,
  pickStarterArea,
  selectableEntityIds,
  waitForRoomConnection,
};

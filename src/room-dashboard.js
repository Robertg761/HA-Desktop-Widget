function entitiesForArea(areaId, entities, devices, states) {
  const deviceAreas = new Map(devices.map((device) => [device.id, device.area_id]));
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

async function loadRoomRegistry(websocket) {
  const responses = await Promise.all(
    ['area', 'entity', 'device'].map((kind) =>
      websocket.request({ type: `config/${kind}_registry/list` })
    )
  );
  if (
    responses.some((response) => response?.success === false || !Array.isArray(response?.result))
  ) {
    throw new Error('Room information is unavailable. Check your Home Assistant permissions.');
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
    if (Date.now() >= deadline) throw new Error('Connection is not ready');
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  return false;
}

export { entitiesForArea, loadRoomRegistry, selectableEntityIds, waitForRoomConnection };

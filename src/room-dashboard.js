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

export { entitiesForArea, loadRoomRegistry };

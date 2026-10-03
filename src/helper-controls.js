// HA's feature flags apply per entity, even when its domain exposes the service globally. A vacuum
// written before START and STOP existed advertises TURN_ON and TURN_OFF instead, and those stand in
// for Start and Stop when the newer ones are missing, as they do on its desktop pin.
const VACUUM_ACTIONS = [
  {
    label: 'Start',
    services: [
      { service: 'start', feature: 8192 },
      { service: 'turn_on', feature: 1 },
    ],
  },
  { label: 'Pause', services: [{ service: 'pause', feature: 4 }] },
  {
    label: 'Stop',
    services: [
      { service: 'stop', feature: 8 },
      { service: 'turn_off', feature: 2 },
    ],
  },
  { label: 'Return to base', services: [{ service: 'return_to_base', feature: 16 }] },
];

function getHelperActions(entity, services) {
  const domain = entity?.entity_id?.split('.')[0];
  if (domain === 'vacuum') {
    const features = Number(entity.attributes?.supported_features) || 0;
    return VACUUM_ACTIONS.flatMap(({ label, services: alternatives }) => {
      const usable = alternatives.find(
        ({ service, feature }) => services?.vacuum?.[service] && (features & feature) === feature
      );
      return usable ? [{ service: usable.service, label }] : [];
    });
  }
  const service = ['number', 'input_number'].includes(domain) ? 'set_value' : 'select_option';
  return services?.[domain]?.[service] ? [{ service, label: 'Apply' }] : [];
}

function getHelperServiceData(entity, value) {
  const domain = entity.entity_id.split('.')[0];
  if (['number', 'input_number'].includes(domain)) {
    if (String(value).trim() === '') return null;
    const number = Number(value);
    const { min, max, step } = entity.attributes || {};
    if (
      !Number.isFinite(number) ||
      (min != null && number < Number(min)) ||
      (max != null && number > Number(max))
    )
      return null;
    const increment = Number(step);
    if (increment > 0) {
      const steps = (number - (Number(min) || 0)) / increment;
      if (Math.abs(steps - Math.round(steps)) > 1e-7) return null;
    }
    return { entity_id: entity.entity_id, value: number };
  }
  if (['select', 'input_select'].includes(domain)) {
    return entity.attributes?.options?.includes(value)
      ? { entity_id: entity.entity_id, option: value }
      : null;
  }
  return { entity_id: entity.entity_id };
}

export { getHelperActions, getHelperServiceData };

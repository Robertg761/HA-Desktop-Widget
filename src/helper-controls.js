// HA's feature flags apply per entity, even when its domain exposes the service globally.
const VACUUM_ACTIONS = [
  { service: 'start', feature: 8192, label: 'Start' },
  { service: 'pause', feature: 4, label: 'Pause' },
  { service: 'stop', feature: 8, label: 'Stop' },
  { service: 'return_to_base', feature: 16, label: 'Return to base' },
];

function getHelperActions(entity, services) {
  const domain = entity?.entity_id?.split('.')[0];
  if (domain === 'vacuum') {
    const features = Number(entity.attributes?.supported_features) || 0;
    return VACUUM_ACTIONS.filter(
      (action) =>
        services?.vacuum?.[action.service] && (features & action.feature) === action.feature
    );
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

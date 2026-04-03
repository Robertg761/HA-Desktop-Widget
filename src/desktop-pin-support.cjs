/* eslint-env node */

const DESKTOP_PIN_SUPPORTED_FAMILIES = new Set([
  'light',
  'climate',
  'fan',
  'cover',
  'media',
  'camera',
  'timer',
  'sensor',
  'scene',
  'toggle',
  'action',
  'numeric',
  'enum',
  'presence',
  'weather',
  'vacuum',
  'unsupported',
]);

function normalizeEntityId(entityId) {
  if (typeof entityId !== 'string') return '';
  return entityId.trim();
}

function getDesktopPinDomain(entityOrEntityId = '') {
  const entityId = typeof entityOrEntityId === 'object' && entityOrEntityId?.entity_id
    ? entityOrEntityId.entity_id
    : entityOrEntityId;
  const normalizedEntityId = normalizeEntityId(entityId);
  if (!normalizedEntityId) return '';
  const [domain = ''] = normalizedEntityId.split('.');
  return domain;
}

function isIsoFutureTimestamp(value) {
  const stateValue = typeof value === 'string' ? value.trim() : '';
  if (!stateValue || stateValue === 'unavailable' || stateValue === 'unknown') {
    return false;
  }

  const iso8601Pattern = /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(:\d{2})?/;
  if (!iso8601Pattern.test(stateValue)) {
    return false;
  }

  const stateTime = new Date(stateValue).getTime();
  return !Number.isNaN(stateTime) && stateTime > Date.now();
}

function isTimerSensorEntity(entity) {
  if (!entity?.entity_id?.startsWith('sensor.')) return false;

  const attrs = entity.attributes || {};
  return !!(
    attrs.finishes_at
    || attrs.end_time
    || attrs.finish_time
    || attrs.duration
    || entity.entity_id.toLowerCase().includes('timer')
    || isIsoFutureTimestamp(entity.state)
  );
}

function isTimerLikeEntity(entity) {
  if (!entity?.entity_id) return false;
  return entity.entity_id.startsWith('timer.') || isTimerSensorEntity(entity);
}

function sanitizeDesktopPinSupportInfo(input = {}, fallbackEntityId = '') {
  const entityId = normalizeEntityId(input?.entityId || fallbackEntityId);
  const family = typeof input?.family === 'string' ? input.family.trim() : '';
  const label = typeof input?.label === 'string' ? input.label.trim() : '';
  const reason = typeof input?.reason === 'string' ? input.reason.trim() : '';
  const primaryAction = typeof input?.primaryAction === 'string' ? input.primaryAction.trim() : '';
  const secondaryAction = typeof input?.secondaryAction === 'string' ? input.secondaryAction.trim() : '';

  return {
    entityId,
    supported: !!input?.supported,
    interactive: !!input?.interactive,
    family: DESKTOP_PIN_SUPPORTED_FAMILIES.has(family) ? family : 'unsupported',
    label,
    reason,
    primaryAction,
    secondaryAction,
  };
}

function resolveDesktopPinProfile(entityOrEntityId = null) {
  const entity = (typeof entityOrEntityId === 'object' && entityOrEntityId?.entity_id)
    ? entityOrEntityId
    : null;
  const entityId = normalizeEntityId(entity?.entity_id || entityOrEntityId);
  const domain = getDesktopPinDomain(entityId);

  const baseProfile = {
    entityId,
    domain,
    supported: true,
    interactive: true,
    family: 'unsupported',
    label: 'Desktop pin',
    reason: '',
    primaryAction: '',
    secondaryAction: '',
  };

  if (!entityId) {
    return {
      ...baseProfile,
      supported: false,
      interactive: false,
      family: 'unsupported',
      label: 'Desktop pin not available',
      reason: 'Missing entity ID.',
    };
  }

  if (isTimerLikeEntity(entity)) {
    return {
      ...baseProfile,
      family: 'timer',
      label: 'Timer tile',
    };
  }

  switch (domain) {
    case 'light':
      return { ...baseProfile, family: 'light', label: 'Light tile', primaryAction: 'toggle' };
    case 'climate':
      return { ...baseProfile, family: 'climate', label: 'Climate tile', primaryAction: 'set-temperature' };
    case 'fan':
      return { ...baseProfile, family: 'fan', label: 'Fan tile', primaryAction: 'set-speed' };
    case 'cover':
      return { ...baseProfile, family: 'cover', label: 'Cover tile', primaryAction: 'set-position' };
    case 'media_player':
      return { ...baseProfile, family: 'media', label: 'Media tile', primaryAction: 'play-pause' };
    case 'camera':
      return { ...baseProfile, family: 'camera', label: 'Camera tile', primaryAction: 'open-camera' };
    case 'sensor':
    case 'binary_sensor':
      return { ...baseProfile, family: 'sensor', label: 'Status tile', interactive: false };
    case 'scene':
    case 'script':
      return { ...baseProfile, family: 'scene', label: 'Scene tile', primaryAction: 'turn_on' };
    case 'switch':
    case 'input_boolean':
    case 'lock':
      return { ...baseProfile, family: 'toggle', label: 'Toggle tile', primaryAction: 'toggle' };
    case 'automation':
      return { ...baseProfile, family: 'action', label: 'Automation tile', primaryAction: 'trigger' };
    case 'button':
      return { ...baseProfile, family: 'action', label: 'Button tile', primaryAction: 'press' };
    case 'number':
    case 'input_number':
      return { ...baseProfile, family: 'numeric', label: 'Number tile', primaryAction: 'set-value' };
    case 'select':
    case 'input_select':
      return {
        ...baseProfile,
        family: 'enum',
        label: 'Select tile',
        primaryAction: 'previous-option',
        secondaryAction: 'next-option',
      };
    case 'person':
    case 'device_tracker':
      return {
        ...baseProfile,
        family: 'presence',
        label: 'Presence tile',
        primaryAction: 'focus-main',
      };
    case 'weather':
      return {
        ...baseProfile,
        family: 'weather',
        label: 'Weather tile',
        primaryAction: 'focus-main',
      };
    case 'vacuum':
      return {
        ...baseProfile,
        family: 'vacuum',
        label: 'Vacuum tile',
        primaryAction: 'vacuum-primary',
        secondaryAction: 'vacuum-secondary',
      };
    default:
      return {
        ...baseProfile,
        supported: false,
        interactive: false,
        family: 'unsupported',
        label: 'Desktop pin not supported yet',
        reason: `The "${domain || 'unknown'}" domain does not have a desktop-pin profile yet.`,
      };
  }
}

function isDesktopPinSupported(entityOrEntityId = null) {
  return resolveDesktopPinProfile(entityOrEntityId).supported;
}

module.exports = {
  DESKTOP_PIN_SUPPORTED_FAMILIES,
  normalizeEntityId,
  getDesktopPinDomain,
  isTimerSensorEntity,
  isTimerLikeEntity,
  sanitizeDesktopPinSupportInfo,
  resolveDesktopPinProfile,
  isDesktopPinSupported,
};

const HOME_ASSISTANT_TOKEN_PLACEHOLDER = 'YOUR_LONG_LIVED_ACCESS_TOKEN';
const HOME_ASSISTANT_URL_PLACEHOLDERS = new Set(['YOUR_HOME_ASSISTANT_URL', 'HOME_ASSISTANT_URL']);
const DESKTOP_PIN_ALLOWED_ACTIONS = new Set(['focus-main', 'service-call']);

function isPlainObject(value) {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function cloneJsonObject(value) {
  if (!isPlainObject(value)) return {};
  try {
    return JSON.parse(JSON.stringify(value));
  } catch {
    return {};
  }
}

function createDesktopPinRendererConfig(inputConfig) {
  const source = isPlainObject(inputConfig) ? inputConfig : {};
  const homeAssistant = isPlainObject(source.homeAssistant) ? source.homeAssistant : {};
  const url = typeof homeAssistant.url === 'string' ? homeAssistant.url.trim() : '';

  return {
    homeAssistant: url ? { url } : {},
    ui: cloneJsonObject(source.ui),
    opacity: Number.isFinite(Number(source.opacity)) ? Number(source.opacity) : 1,
    frostedGlass: source.frostedGlass === true,
    customEntityNames: cloneJsonObject(source.customEntityNames),
    customEntityIcons: cloneJsonObject(source.customEntityIcons),
  };
}

function createDesktopPinConnectionState(inputConfig, { secureStoragePending = false } = {}) {
  const source = isPlainObject(inputConfig) ? inputConfig : {};
  const homeAssistant = isPlainObject(source.homeAssistant) ? source.homeAssistant : {};
  const url = typeof homeAssistant.url === 'string' ? homeAssistant.url.trim() : '';
  const token = typeof homeAssistant.token === 'string' ? homeAssistant.token.trim() : '';

  return {
    hasUrl: !!url && !HOME_ASSISTANT_URL_PLACEHOLDERS.has(url),
    hasToken: !!token && token !== HOME_ASSISTANT_TOKEN_PLACEHOLDER,
    secureStoragePending: secureStoragePending === true,
  };
}

function normalizeDesktopPinActionRequest(entityId, action, payload = {}) {
  const normalizedEntityId = typeof entityId === 'string' ? entityId.trim() : '';
  const normalizedAction = typeof action === 'string' ? action.trim() : '';
  if (!normalizedEntityId || !DESKTOP_PIN_ALLOWED_ACTIONS.has(normalizedAction)) {
    return { success: false, error: 'Unauthorized desktop pin action' };
  }

  if (normalizedAction === 'focus-main') {
    return {
      success: true,
      entityId: normalizedEntityId,
      action: normalizedAction,
      payload: {},
    };
  }

  if (!isPlainObject(payload)) {
    return { success: false, error: 'Invalid desktop pin service request' };
  }

  const expectedDomain = normalizedEntityId.split('.')[0];
  const requestedDomain = typeof payload.domain === 'string' ? payload.domain.trim() : '';
  const service = typeof payload.service === 'string' ? payload.service.trim() : '';
  if (!expectedDomain || requestedDomain !== expectedDomain || !/^[a-z0-9_]+$/.test(service)) {
    return { success: false, error: 'Invalid desktop pin service request' };
  }

  const serviceData = cloneJsonObject(payload.serviceData);
  delete serviceData.target;
  delete serviceData.device_id;
  delete serviceData.area_id;
  serviceData.entity_id = normalizedEntityId;

  return {
    success: true,
    entityId: normalizedEntityId,
    action: normalizedAction,
    payload: {
      domain: expectedDomain,
      service,
      serviceData,
    },
  };
}

module.exports = {
  DESKTOP_PIN_ALLOWED_ACTIONS,
  createDesktopPinConnectionState,
  createDesktopPinRendererConfig,
  normalizeDesktopPinActionRequest,
};

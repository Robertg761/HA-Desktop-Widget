// Development-only climate-control fixture. It is enabled exclusively by the
// main-process --demo-climate flag and never contacts Home Assistant.
export const DEV_CLIMATE_DEMO_ENTITY_ID = 'climate.demo_air_conditioner';

const DEMO_HVAC_MODES = ['off', 'cool', 'dry', 'fan_only', 'auto'];
const DEMO_FAN_MODES = ['auto', 'low', 'medium', 'high'];
const DEMO_PRESET_MODES = ['none', 'eco', 'boost', 'sleep'];
const DEMO_MIN_TEMP = 60;
const DEMO_MAX_TEMP = 86;
const DEMO_TARGET_TEMP_STEP = 1;

export function isClimateDemoConfig(config) {
  return config?.developmentDemo?.climate === true;
}

export function isClimateDemoOverlayConfig(config) {
  return isClimateDemoConfig(config) && config?.developmentDemo?.mode === 'overlay';
}

export function createDemoClimateEntity(now = new Date().toISOString()) {
  return {
    entity_id: DEV_CLIMATE_DEMO_ENTITY_ID,
    state: 'cool',
    last_changed: now,
    last_updated: now,
    attributes: {
      friendly_name: 'Demo Air Conditioner',
      current_temperature: 74,
      current_humidity: 48,
      temperature: 72,
      min_temp: DEMO_MIN_TEMP,
      max_temp: DEMO_MAX_TEMP,
      target_temp_step: DEMO_TARGET_TEMP_STEP,
      temperature_unit: '°F',
      unit_of_measurement: '°F',
      hvac_action: 'cooling',
      hvac_modes: DEMO_HVAC_MODES,
      fan_mode: 'auto',
      fan_modes: DEMO_FAN_MODES,
      preset_mode: 'eco',
      preset_modes: DEMO_PRESET_MODES,
    },
  };
}

function clampDemoTemperature(value) {
  const numericValue = Number(value);
  if (!Number.isFinite(numericValue)) return null;
  const clamped = Math.min(DEMO_MAX_TEMP, Math.max(DEMO_MIN_TEMP, numericValue));
  return (
    DEMO_MIN_TEMP +
    Math.round((clamped - DEMO_MIN_TEMP) / DEMO_TARGET_TEMP_STEP) * DEMO_TARGET_TEMP_STEP
  );
}

function actionForHvacMode(mode) {
  if (mode === 'cool') return 'cooling';
  if (mode === 'dry') return 'drying';
  if (mode === 'fan_only') return 'fan';
  if (mode === 'auto') return 'idle';
  return 'off';
}

/**
 * Installs an in-memory climate service implementation for the development demo.
 * No WebSocket is opened and unsupported service calls fail closed.
 */
export function installClimateDemo({
  state,
  websocket,
  onEntityUpdated = () => {},
  overlay = false,
}) {
  let entity = createDemoClimateEntity();
  const originalCallService = websocket.callService;

  const publish = () => {
    entity = {
      ...entity,
      last_changed: new Date().toISOString(),
      last_updated: new Date().toISOString(),
    };
    state.setEntityState(entity);
    onEntityUpdated(entity);
    return entity;
  };

  const ensureEntity = () => {
    state.setEntityState(entity);
    return entity;
  };

  state.setStates(
    overlay
      ? { ...(state.STATES || {}), [entity.entity_id]: entity }
      : { [entity.entity_id]: entity }
  );
  state.setServices({
    ...(overlay ? state.SERVICES || {} : {}),
    climate: {
      ...(overlay ? state.SERVICES?.climate || {} : {}),
      set_temperature: {},
      set_hvac_mode: {},
      set_fan_mode: {},
      set_preset_mode: {},
      turn_on: {},
      turn_off: {},
    },
  });
  if (!overlay) {
    state.setUnitSystem({ ...state.UNIT_SYSTEM, temperature: '°F' });
  }

  websocket.callService = (domain, service, serviceData = {}, ...rest) => {
    if (domain !== 'climate' || serviceData.entity_id !== DEV_CLIMATE_DEMO_ENTITY_ID) {
      if (overlay) {
        return originalCallService.call(websocket, domain, service, serviceData, ...rest);
      }
      return Promise.reject(
        new Error('The climate demo only supports its simulated air conditioner.')
      );
    }

    const attributes = { ...entity.attributes };
    switch (service) {
      case 'set_temperature': {
        const temperature = clampDemoTemperature(serviceData.temperature);
        if (temperature === null)
          return Promise.reject(new Error('Demo temperature must be numeric.'));
        entity = { ...entity, attributes: { ...attributes, temperature } };
        break;
      }
      case 'set_hvac_mode': {
        const mode = String(serviceData.hvac_mode || '');
        if (!DEMO_HVAC_MODES.includes(mode))
          return Promise.reject(new Error('Unsupported demo HVAC mode.'));
        entity = {
          ...entity,
          state: mode,
          attributes: { ...attributes, hvac_action: actionForHvacMode(mode) },
        };
        break;
      }
      case 'set_fan_mode': {
        const mode = String(serviceData.fan_mode || '');
        if (!DEMO_FAN_MODES.includes(mode))
          return Promise.reject(new Error('Unsupported demo fan mode.'));
        entity = { ...entity, attributes: { ...attributes, fan_mode: mode } };
        break;
      }
      case 'set_preset_mode': {
        const mode = String(serviceData.preset_mode || '');
        if (!DEMO_PRESET_MODES.includes(mode))
          return Promise.reject(new Error('Unsupported demo preset mode.'));
        entity = { ...entity, attributes: { ...attributes, preset_mode: mode } };
        break;
      }
      case 'turn_off':
        entity = { ...entity, state: 'off', attributes: { ...attributes, hvac_action: 'off' } };
        break;
      case 'turn_on':
        entity = {
          ...entity,
          state: entity.state === 'off' ? 'cool' : entity.state,
          attributes: {
            ...attributes,
            hvac_action: entity.state === 'off' ? 'cooling' : attributes.hvac_action,
          },
        };
        break;
      default:
        return Promise.reject(new Error(`Unsupported demo climate service: ${service}`));
    }

    return Promise.resolve({ success: true, result: publish() });
  };

  return {
    ensureEntity,
    dispose() {
      websocket.callService = originalCallService;
    },
  };
}

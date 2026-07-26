const {
  createDemoClimateEntity,
  DEV_CLIMATE_DEMO_ENTITY_ID,
  installClimateDemo,
  isClimateDemoConfig,
  isClimateDemoOverlayConfig,
} = require('../../src/dev-climate-demo.js');

describe('development climate demo', () => {
  test('is explicitly opt-in through the development demo config marker', () => {
    expect(isClimateDemoConfig({})).toBe(false);
    expect(isClimateDemoConfig({ developmentDemo: { climate: false } })).toBe(false);
    expect(isClimateDemoConfig({ developmentDemo: { climate: true } })).toBe(true);
    expect(isClimateDemoOverlayConfig({ developmentDemo: { climate: true } })).toBe(false);
    expect(
      isClimateDemoOverlayConfig({ developmentDemo: { climate: true, mode: 'overlay' } })
    ).toBe(true);
  });

  test('advertises Fahrenheit climate capabilities and safely simulates its controls', async () => {
    const initial = createDemoClimateEntity('2026-07-26T12:00:00.000Z');
    expect(initial.entity_id).toBe(DEV_CLIMATE_DEMO_ENTITY_ID);
    expect(initial.attributes).toMatchObject({
      current_temperature: 74,
      temperature: 72,
      min_temp: 60,
      max_temp: 86,
      target_temp_step: 1,
      temperature_unit: '°F',
      hvac_modes: ['off', 'cool', 'dry', 'fan_only', 'auto'],
      fan_modes: ['auto', 'low', 'medium', 'high'],
      preset_modes: ['none', 'eco', 'boost', 'sleep'],
    });

    const state = {
      UNIT_SYSTEM: { temperature: '°C' },
      setStates: jest.fn(function setStates(states) {
        this.states = states;
      }),
      setEntityState: jest.fn(function setEntityState(entity) {
        this.states = { ...(this.states || {}), [entity.entity_id]: entity };
      }),
      setServices: jest.fn(),
      setUnitSystem: jest.fn(),
    };
    const originalCallService = jest.fn();
    const websocket = { callService: originalCallService };
    const onEntityUpdated = jest.fn();

    const controller = installClimateDemo({ state, websocket, onEntityUpdated });
    expect(state.setUnitSystem).toHaveBeenCalledWith({ temperature: '°F' });

    await websocket.callService('climate', 'set_temperature', {
      entity_id: DEV_CLIMATE_DEMO_ENTITY_ID,
      temperature: 72.4,
    });
    await websocket.callService('climate', 'set_hvac_mode', {
      entity_id: DEV_CLIMATE_DEMO_ENTITY_ID,
      hvac_mode: 'dry',
    });
    await websocket.callService('climate', 'set_fan_mode', {
      entity_id: DEV_CLIMATE_DEMO_ENTITY_ID,
      fan_mode: 'high',
    });
    await websocket.callService('climate', 'set_preset_mode', {
      entity_id: DEV_CLIMATE_DEMO_ENTITY_ID,
      preset_mode: 'boost',
    });

    expect(state.states[DEV_CLIMATE_DEMO_ENTITY_ID]).toMatchObject({
      state: 'dry',
      attributes: {
        temperature: 72,
        hvac_action: 'drying',
        fan_mode: 'high',
        preset_mode: 'boost',
      },
    });
    expect(onEntityUpdated).toHaveBeenCalledTimes(4);
    await expect(
      websocket.callService('light', 'turn_on', { entity_id: 'light.real_home' })
    ).rejects.toThrow('only supports its simulated air conditioner');
    expect(originalCallService).not.toHaveBeenCalled();

    controller.dispose();
    expect(websocket.callService).toBe(originalCallService);
  });

  test('keeps real state and service calls intact in connected overlay mode', async () => {
    const originalCallService = jest.fn().mockResolvedValue({ success: true });
    const realLight = { entity_id: 'light.living_room', state: 'on', attributes: {} };
    const state = {
      STATES: { [realLight.entity_id]: realLight },
      SERVICES: { light: { turn_off: {} } },
      UNIT_SYSTEM: { temperature: '°C' },
      setStates: jest.fn(function setStates(states) {
        this.STATES = states;
      }),
      setEntityState: jest.fn(function setEntityState(entity) {
        this.STATES = { ...this.STATES, [entity.entity_id]: entity };
      }),
      setServices: jest.fn(function setServices(services) {
        this.SERVICES = services;
      }),
      setUnitSystem: jest.fn(),
    };
    const websocket = { callService: originalCallService };
    const controller = installClimateDemo({ state, websocket, overlay: true });

    expect(state.STATES[realLight.entity_id]).toBe(realLight);
    expect(state.STATES[DEV_CLIMATE_DEMO_ENTITY_ID]).toBeTruthy();
    expect(state.setUnitSystem).not.toHaveBeenCalled();

    await websocket.callService('light', 'turn_off', { entity_id: realLight.entity_id });
    expect(originalCallService).toHaveBeenCalledWith('light', 'turn_off', {
      entity_id: realLight.entity_id,
    });

    await websocket.callService('climate', 'set_temperature', {
      entity_id: DEV_CLIMATE_DEMO_ENTITY_ID,
      temperature: 75,
    });
    expect(originalCallService).toHaveBeenCalledTimes(1);
    expect(state.STATES[DEV_CLIMATE_DEMO_ENTITY_ID].attributes.temperature).toBe(75);

    state.setStates({ [realLight.entity_id]: realLight });
    controller.ensureEntity();
    expect(state.STATES[DEV_CLIMATE_DEMO_ENTITY_ID]).toBeTruthy();
    controller.dispose();
  });
});

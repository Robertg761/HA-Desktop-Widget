const { getClimateControlCapabilities } = require('../../src/climate-controls.cjs');

const thermostat = (attributes = {}, state = 'heat_cool') => ({
  state,
  attributes: {
    min_temp: 7,
    max_temp: 35,
    target_temp_low: 19,
    target_temp_high: 24,
    temperature: null,
    supported_features: 3,
    ...attributes,
  },
});

describe('Climate capability detection', () => {
  it('supports a heat/cool range without inventing a single target', () => {
    const capabilities = getClimateControlCapabilities(thermostat());
    expect(capabilities.canSetRange).toBe(true);
    expect(capabilities.canSetTemperature).toBe(false);
  });
  it.each([
    { supported_features: 1 },
    { target_temp_low: null },
    { target_temp_high: '' },
    { target_temp_low: 26, target_temp_high: 24 },
    { target_temp_low: 6 },
    { target_temp_high: 36 },
    { min_temp: 35, max_temp: 7 },
  ])('does not expose an unsupported or invalid range: %j', (attributes) => {
    expect(getClimateControlCapabilities(thermostat(attributes)).canSetRange).toBe(false);
  });
  it('supports a single setpoint only when advertised by the entity', () => {
    expect(
      getClimateControlCapabilities(thermostat({ temperature: 21 }, 'heat')).canSetTemperature
    ).toBe(true);
    expect(
      getClimateControlCapabilities(thermostat({ temperature: 21, supported_features: 0 }, 'heat'))
        .canSetTemperature
    ).toBe(false);
  });
  it('preserves advertised target step and mode choices', () => {
    expect(
      getClimateControlCapabilities(
        thermostat({
          target_temp_step: 1,
          hvac_modes: ['off', 'heat_cool'],
          fan_modes: ['auto'],
          preset_modes: ['eco'],
        })
      )
    ).toMatchObject({
      temperatureStep: 1,
      hvacModes: ['off', 'heat_cool'],
      fanModes: ['auto'],
      presetModes: ['eco'],
    });
  });
});

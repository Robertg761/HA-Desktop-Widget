const { getHelperActions, getHelperServiceData } = require('../../src/helper-controls.js');

describe('helper control policy', () => {
  it('validates numeric bounds, fractional steps, zero, and blank input', () => {
    const entity = { entity_id: 'input_number.target', attributes: { min: -1, max: 2, step: 0.1 } };
    expect(getHelperServiceData(entity, '0')).toEqual({ entity_id: entity.entity_id, value: 0 });
    expect(getHelperServiceData(entity, '1.2')).toEqual({
      entity_id: entity.entity_id,
      value: 1.2,
    });
    for (const value of ['', ' ', 'NaN', '-2', '3', '0.05'])
      expect(getHelperServiceData(entity, value)).toBeNull();
  });
  it('only permits options currently exposed by the entity', () => {
    const entity = { entity_id: 'select.mode', attributes: { options: ['Quiet', 'Auto'] } };
    expect(getHelperServiceData(entity, 'Auto')).toEqual({
      entity_id: entity.entity_id,
      option: 'Auto',
    });
    expect(getHelperServiceData(entity, 'Old option')).toBeNull();
  });
  it('requires both the global service and each vacuum capability', () => {
    const services = { vacuum: { start: {}, pause: {}, stop: {}, return_to_base: {} } };
    expect(
      getHelperActions(
        { entity_id: 'vacuum.robot', attributes: { supported_features: 8196 } },
        services
      ).map((action) => action.service)
    ).toEqual(['start', 'pause']);
    expect(
      getHelperActions(
        { entity_id: 'vacuum.robot', attributes: { supported_features: 0 } },
        services
      )
    ).toEqual([]);
    expect(
      getHelperActions({ entity_id: 'vacuum.robot', attributes: { supported_features: 8192 } }, {})
    ).toEqual([]);
  });
  describe('for a vacuum written before START and STOP existed', () => {
    const services = {
      vacuum: { start: {}, turn_on: {}, pause: {}, stop: {}, turn_off: {}, return_to_base: {} },
    };
    const actionsFor = (features, available = services) =>
      getHelperActions(
        { entity_id: 'vacuum.robot', attributes: { supported_features: features } },
        available
      );

    it('starts and stops it with turn_on and turn_off', () => {
      expect(actionsFor(1 | 2)).toEqual([
        { service: 'turn_on', label: 'Start' },
        { service: 'turn_off', label: 'Stop' },
      ]);
      // Alongside the commands it does have.
      expect(actionsFor(1 | 2 | 4 | 16).map((action) => action.service)).toEqual([
        'turn_on',
        'pause',
        'turn_off',
        'return_to_base',
      ]);
    });

    it('prefers start and stop, and offers each action once', () => {
      expect(actionsFor(1 | 2 | 8 | 8192)).toEqual([
        { service: 'start', label: 'Start' },
        { service: 'stop', label: 'Stop' },
      ]);
    });

    it('still needs the service to exist and the feature to be advertised', () => {
      expect(actionsFor(1 | 2, { vacuum: { start: {}, stop: {} } })).toEqual([]);
      expect(actionsFor(2, services)).toEqual([{ service: 'turn_off', label: 'Stop' }]);
      expect(actionsFor(8192, { vacuum: { turn_on: {} } })).toEqual([]);
    });
  });
});

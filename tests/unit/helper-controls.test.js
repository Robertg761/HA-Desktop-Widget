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
});

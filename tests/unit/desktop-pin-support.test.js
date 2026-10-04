/**
 * @jest-environment node
 */

const {
  getDesktopPinVacuumServices,
  resolveDesktopPinProfile,
} = require('../../src/desktop-pin-support.cjs');

describe('desktop pin profiles', () => {
  it('recognises a timer by its ID before the entity has loaded', () => {
    // A pin shows "not supported yet" on every start until the first snapshot otherwise, and for
    // a deleted timer for good.
    expect(resolveDesktopPinProfile('timer.kitchen')).toMatchObject({
      family: 'timer',
      supported: true,
    });
    expect(
      resolveDesktopPinProfile({ entity_id: 'timer.kitchen', state: 'idle', attributes: {} })
    ).toMatchObject({ family: 'timer' });
  });

  it('still needs the entity to tell a timer-like sensor from any other sensor', () => {
    expect(resolveDesktopPinProfile('sensor.kitchen_timer').family).toBe('sensor');
    expect(
      resolveDesktopPinProfile({
        entity_id: 'sensor.kitchen_timer',
        state: 'unknown',
        attributes: { finishes_at: '2099-01-01T00:00:00Z' },
      }).family
    ).toBe('timer');
  });
});

describe('which sensors pin as timers', () => {
  const family = (entity) => resolveDesktopPinProfile(entity).family;
  const sensor = (entityId, state, attributes = {}) => ({
    entity_id: entityId,
    state,
    attributes,
  });

  it('pins a reading as a sensor, whatever it is called or carries', () => {
    // A travel time has a `duration` attribute and a unit; "timer" in the id does not make hours a countdown.
    expect(
      family(sensor('sensor.commute', '23.4', { unit_of_measurement: 'min', duration: 1404 }))
    ).toBe('sensor');
    expect(family(sensor('sensor.washer_timer_hours', '2.5', { unit_of_measurement: 'h' }))).toBe(
      'sensor'
    );
    expect(family(sensor('sensor.washer_timer_minutes', '12'))).toBe('sensor');
  });

  it('pins a timestamp with no timer hint as a sensor, and a kitchen timer as a timer', () => {
    const future = new Date(Date.now() + 3600 * 1000).toISOString();
    expect(family(sensor('sensor.next_dawn', future, { device_class: 'timestamp' }))).toBe(
      'sensor'
    );
    expect(family(sensor('sensor.kitchen_timer', future))).toBe('timer');
    expect(family(sensor('sensor.oven', 'on', { end_time: future }))).toBe('timer');
  });
});

describe('vacuum services from supported features', () => {
  const vacuum = (supported_features) => ({
    entity_id: 'vacuum.robot',
    state: 'docked',
    attributes: { supported_features },
  });

  it('reads Start, Pause, Stop and Return from the feature flags', () => {
    // START (8192) + PAUSE (4) + RETURN_HOME (16)
    expect(getDesktopPinVacuumServices(vacuum(8192 + 4 + 16))).toEqual({
      start: true,
      turn_on: false,
      pause: true,
      return_to_base: true,
      stop: false,
      turn_off: false,
    });
    // STOP (8) + TURN_OFF (2)
    expect(getDesktopPinVacuumServices(vacuum(8 + 2))).toMatchObject({
      start: false,
      stop: true,
      turn_off: true,
    });
  });

  it('offers turn_on to a vacuum written before START existed', () => {
    // TURN_ON (1) + TURN_OFF (2) + RETURN_HOME (16)
    expect(getDesktopPinVacuumServices(vacuum(1 + 2 + 16))).toEqual({
      start: false,
      turn_on: true,
      pause: false,
      return_to_base: true,
      stop: false,
      turn_off: true,
    });
    // A vacuum with START does not need it.
    expect(getDesktopPinVacuumServices(vacuum(8192))).toMatchObject({
      start: true,
      turn_on: false,
    });
  });

  it('assumes the usual commands when the vacuum advertises no features', () => {
    for (const entity of [vacuum(undefined), vacuum(0), vacuum('')]) {
      expect(getDesktopPinVacuumServices(entity)).toMatchObject({
        start: true,
        pause: true,
        return_to_base: true,
        turn_on: false,
      });
    }
  });
});

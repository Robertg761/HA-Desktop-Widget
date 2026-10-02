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

  it('assumes the usual commands when the vacuum advertises no features', () => {
    for (const entity of [vacuum(undefined), vacuum(0), vacuum('')]) {
      expect(getDesktopPinVacuumServices(entity)).toMatchObject({
        start: true,
        pause: true,
        return_to_base: true,
      });
    }
  });
});

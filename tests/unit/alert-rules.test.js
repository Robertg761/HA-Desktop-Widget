/**
 * @jest-environment node
 */

const {
  createAlertEvaluator,
  getAlertStateSuggestions,
  matchesAlert,
  normalizeAlertState,
} = require('../../src/alert-rules.js');

describe('alert state matching', () => {
  it('spells a state the way Home Assistant does', () => {
    expect(normalizeAlertState('Not home')).toBe('not_home');
    expect(normalizeAlertState('  Armed   Away ')).toBe('armed_away');
    expect(normalizeAlertState('armed_away')).toBe('armed_away');
    expect(normalizeAlertState('Locked')).toBe('locked');
    expect(normalizeAlertState(null)).toBe('');
    expect(normalizeAlertState(undefined)).toBe('');
  });

  it.each([
    ['Locked', 'locked'],
    ['LOCKED', 'locked'],
    ['Not home', 'not_home'],
    ['not home', 'not_home'],
    ['not_home', 'not_home'],
    ['Armed Away', 'armed_away'],
    [' on ', 'on'],
  ])('matches the label %p against the raw state %p', (typed, raw) => {
    expect(matchesAlert({ onSpecificState: true, targetState: typed }, raw)).toBe(true);
  });

  it('still tells different states apart', () => {
    const rule = { onSpecificState: true, targetState: 'Not home' };
    expect(matchesAlert(rule, 'home')).toBe(false);
    expect(matchesAlert(rule, 'nothome')).toBe(false);
    expect(matchesAlert({ onSpecificState: true, targetState: '' }, '')).toBe(false);
    expect(matchesAlert({ onSpecificState: false, targetState: 'on' }, 'on')).toBe(false);
  });
});

describe('alert state suggestions', () => {
  it('offers a lock its own states, the current one first, and the offline pair last', () => {
    const suggestions = getAlertStateSuggestions({
      entity_id: 'lock.front',
      state: 'jammed',
      attributes: {},
    });
    expect(suggestions.slice(0, 3)).toEqual(['jammed', 'locked', 'unlocked']);
    expect(suggestions).toEqual(expect.arrayContaining(['locking', 'unlocking']));
    expect(suggestions.slice(-2)).toEqual(['unavailable', 'unknown']);
    expect(new Set(suggestions).size).toBe(suggestions.length);
  });

  it("offers a thermostat's own modes, and a select's options", () => {
    const climate = getAlertStateSuggestions({
      entity_id: 'climate.hall',
      state: 'heat',
      attributes: { hvac_modes: ['off', 'heat', 'eco'] },
    });
    expect(climate).toEqual(expect.arrayContaining(['heat', 'off', 'eco', 'cool']));

    const select = getAlertStateSuggestions({
      entity_id: 'input_select.mode',
      state: 'Home',
      attributes: { options: ['Home', 'Away', 'Guest'] },
    });
    expect(select.slice(0, 3)).toEqual(['Home', 'Away', 'Guest']);
  });

  it('offers a person home and not_home, and always the offline pair', () => {
    const person = getAlertStateSuggestions({ entity_id: 'person.sam', state: 'work' });
    expect(person).toEqual(['work', 'home', 'not_home', 'unavailable', 'unknown']);
    expect(getAlertStateSuggestions(undefined)).toEqual(['unavailable', 'unknown']);
  });
});

describe('alert evaluator and the states no reading comes with', () => {
  let notify;
  let config;
  let evaluator;
  const states = (id, state) => ({ [id]: { entity_id: id, state } });

  const build = (rule) => {
    notify = jest.fn();
    config = { enabled: true, alerts: { 'sensor.door': rule } };
    evaluator = createAlertEvaluator({ getConfig: () => config, notify });
  };

  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  describe('a Specific State rule for unavailable', () => {
    beforeEach(() => {
      build({ onSpecificState: true, targetState: 'unavailable' });
      evaluator.reset(states('sensor.door', 'on'));
    });

    it('notifies once when the entity goes offline, which it never did', () => {
      evaluator.check('sensor.door', 'unavailable');
      expect(notify).toHaveBeenCalledTimes(1);
      expect(notify).toHaveBeenCalledWith('sensor.door', 'on', 'unavailable', expect.any(Object));

      evaluator.check('sensor.door', 'unavailable');
      expect(notify).toHaveBeenCalledTimes(1);
    });

    it('notifies again for the next outage, once it has recovered', () => {
      evaluator.check('sensor.door', 'unavailable');
      evaluator.check('sensor.door', 'on');
      evaluator.check('sensor.door', 'unavailable');
      expect(notify).toHaveBeenCalledTimes(2);
    });

    it('does not repeat itself when the reconnect snapshot still says offline', () => {
      evaluator.check('sensor.door', 'unavailable');
      evaluator.suspend();
      evaluator.reconcile(states('sensor.door', 'unavailable'));
      expect(notify).toHaveBeenCalledTimes(1);
    });

    it('lets a notified outage end while disconnected, so the next one notifies', () => {
      evaluator.check('sensor.door', 'unavailable');
      evaluator.reconcile(states('sensor.door', 'on'));
      evaluator.check('sensor.door', 'unavailable');
      expect(notify).toHaveBeenCalledTimes(2);
    });

    it('waits out a duration, and a recovery before it ends cancels it', () => {
      build({ onSpecificState: true, targetState: 'Unavailable', durationSeconds: 60 });
      evaluator.reset(states('sensor.door', 'on'));
      evaluator.check('sensor.door', 'unavailable');
      jest.advanceTimersByTime(30000);
      evaluator.check('sensor.door', 'on');
      jest.advanceTimersByTime(60000);
      expect(notify).not.toHaveBeenCalled();

      evaluator.check('sensor.door', 'unavailable');
      jest.advanceTimersByTime(60000);
      expect(notify).toHaveBeenCalledTimes(1);
    });

    it('is a rule for unknown as well, in any spelling', () => {
      build({ onSpecificState: true, targetState: 'Unknown' });
      evaluator.reset(states('sensor.door', '5'));
      evaluator.check('sensor.door', 'unknown');
      expect(notify).toHaveBeenCalledTimes(1);
    });
  });

  it('still ignores unavailable for a rule about another state or a threshold', () => {
    build({ onSpecificState: true, targetState: 'on' });
    evaluator.reset(states('sensor.door', 'off'));
    evaluator.check('sensor.door', 'unavailable');
    expect(notify).not.toHaveBeenCalled();

    build({ onNumericThreshold: true, threshold: 25, comparison: 'above' });
    evaluator.reset(states('sensor.door', '20'));
    evaluator.check('sensor.door', 'unavailable');
    evaluator.check('sensor.door', 'unknown');
    expect(notify).not.toHaveBeenCalled();
  });

  it('matches a typed label against the raw state', () => {
    build({ onSpecificState: true, targetState: 'Not home' });
    evaluator.reset(states('sensor.door', 'home'));
    evaluator.check('sensor.door', 'not_home');
    expect(notify).toHaveBeenCalledTimes(1);
  });

  describe('a State Change rule', () => {
    beforeEach(() => {
      build({ onStateChange: true });
      evaluator.reset(states('sensor.door', 'on'));
    });

    it('tells about going offline and about coming back, not only the second', () => {
      evaluator.check('sensor.door', 'unavailable');
      evaluator.check('sensor.door', 'on');
      expect(notify.mock.calls.map(([, from, to]) => [from, to])).toEqual([
        ['on', 'unavailable'],
        ['unavailable', 'on'],
      ]);
    });

    it('does not tell about a state that did not change, or a reconnect snapshot', () => {
      evaluator.check('sensor.door', 'on');
      evaluator.suspend();
      evaluator.reconcile(states('sensor.door', 'unavailable'));
      expect(notify).not.toHaveBeenCalled();
      // The snapshot is the new baseline: only a later change counts.
      evaluator.check('sensor.door', 'unavailable');
      expect(notify).not.toHaveBeenCalled();
      evaluator.check('sensor.door', 'on');
      expect(notify).toHaveBeenCalledTimes(1);
    });
  });
});

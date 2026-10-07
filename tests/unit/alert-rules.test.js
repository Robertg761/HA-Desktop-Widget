/**
 * @jest-environment node
 */

const {
  UNAVAILABLE_GRACE_MS,
  UNAVAILABLE_NOTIFY_INTERVAL_MS,
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

  describe('a match that holds through an outage', () => {
    const newStates = () => notify.mock.calls.map(([, , to]) => to);

    it('does not tell again about a Specific State that was still true when the entity came back', () => {
      build({ onSpecificState: true, targetState: 'on' });
      evaluator.reset(states('sensor.door', 'off'));
      for (const value of ['on', 'unavailable', 'on', 'unknown', 'unavailable', 'on']) {
        evaluator.check('sensor.door', value);
      }
      expect(newStates()).toEqual(['on']);

      // Once the condition really ends, the next match is news again.
      evaluator.check('sensor.door', 'off');
      evaluator.check('sensor.door', 'on');
      expect(newStates()).toEqual(['on', 'on']);
    });

    it('tells about a match the entity came back from the outage in, when it was off before', () => {
      build({ onSpecificState: true, targetState: 'on' });
      evaluator.reset(states('sensor.door', 'on'));
      evaluator.check('sensor.door', 'off');
      evaluator.check('sensor.door', 'unavailable');
      evaluator.check('sensor.door', 'on');
      expect(newStates()).toEqual(['on']);
    });

    it('does not tell again about a threshold still crossed after an outage or a reconnect', () => {
      build({ onNumericThreshold: true, threshold: 25, comparison: 'above' });
      evaluator.reset(states('sensor.door', '20'));
      evaluator.check('sensor.door', '26');
      evaluator.check('sensor.door', 'unavailable');
      evaluator.check('sensor.door', '26.1');
      // Home Assistant restarts: the socket drops and the snapshot it comes back with still has
      // the entity restoring.
      evaluator.suspend();
      evaluator.reconcile(states('sensor.door', 'unavailable'));
      evaluator.check('sensor.door', '26.2');
      expect(newStates()).toEqual(['26']);

      evaluator.check('sensor.door', '20');
      evaluator.check('sensor.door', '27');
      expect(newStates()).toEqual(['26', '27']);
    });

    it('starts a wait over that an outage interrupted, since nobody can say the condition held', () => {
      build({ onSpecificState: true, targetState: 'on', durationSeconds: 60 });
      evaluator.reset(states('sensor.door', 'off'));
      evaluator.check('sensor.door', 'on');
      jest.advanceTimersByTime(30 * 1000);
      evaluator.check('sensor.door', 'unavailable');
      jest.advanceTimersByTime(60 * 1000);
      expect(notify).not.toHaveBeenCalled();

      evaluator.check('sensor.door', 'on');
      jest.advanceTimersByTime(60 * 1000 - 1);
      expect(notify).not.toHaveBeenCalled();
      jest.advanceTimersByTime(1);
      expect(newStates()).toEqual(['on']);

      // Told about, the match then holds through the next outage like any other.
      evaluator.check('sensor.door', 'unavailable');
      evaluator.check('sensor.door', 'on');
      jest.advanceTimersByTime(60 * 1000);
      expect(notify).toHaveBeenCalledTimes(1);
    });

    it('takes unavailable and unknown as one outage for a rule about going unavailable', () => {
      build({ onSpecificState: true, targetState: 'unavailable' });
      evaluator.reset(states('sensor.door', 'on'));
      evaluator.check('sensor.door', 'unavailable');
      evaluator.check('sensor.door', 'unknown');
      evaluator.check('sensor.door', 'unavailable');
      expect(newStates()).toEqual(['unavailable']);

      evaluator.check('sensor.door', 'on');
      evaluator.check('sensor.door', 'unavailable');
      expect(newStates()).toEqual(['unavailable', 'unavailable']);
    });

    it('keeps waiting through unavailable to unknown for a rule about going unavailable', () => {
      build({ onSpecificState: true, targetState: 'unavailable', durationSeconds: 60 });
      evaluator.reset(states('sensor.door', 'on'));
      evaluator.check('sensor.door', 'unavailable');
      jest.advanceTimersByTime(30 * 1000);
      // Home Assistant restarting flips an entity from unavailable to unknown.
      evaluator.check('sensor.door', 'unknown');
      jest.advanceTimersByTime(30 * 1000);
      expect(notify).toHaveBeenCalledTimes(1);

      // A settings save in the middle of the wait does not start it over either.
      evaluator.check('sensor.door', 'on');
      evaluator.check('sensor.door', 'unavailable');
      jest.advanceTimersByTime(30 * 1000);
      evaluator.reconcile(states('sensor.door', 'unknown'));
      jest.advanceTimersByTime(30 * 1000);
      expect(notify).toHaveBeenCalledTimes(2);
    });

    describe('for a condition that already held when the widget started', () => {
      // Home Assistant sends a state_changed event for an attribute too (a lamp's brightness, a
      // sensor's next tick), with the same state. That is not the entity coming into the condition.
      it('does not tell about a Specific State on its next update, outage or not', () => {
        build({ onSpecificState: true, targetState: 'on' });
        evaluator.reset(states('sensor.door', 'on'));
        evaluator.check('sensor.door', 'on');
        expect(notify).not.toHaveBeenCalled();

        evaluator.check('sensor.door', 'off');
        evaluator.check('sensor.door', 'on');
        expect(newStates()).toEqual(['on']);
      });

      it('does not tell about a threshold still crossed at its next reading', () => {
        build({ onNumericThreshold: true, threshold: 25, comparison: 'above' });
        evaluator.reset(states('sensor.door', '26'));
        evaluator.check('sensor.door', '26.5');
        expect(notify).not.toHaveBeenCalled();

        evaluator.check('sensor.door', '20');
        evaluator.check('sensor.door', '27');
        expect(newStates()).toEqual(['27']);
      });

      it('does not tell about an entity that was already offline, for a rule about that', () => {
        build({ onSpecificState: true, targetState: 'unavailable' });
        evaluator.reset(states('sensor.door', 'unavailable'));
        evaluator.check('sensor.door', 'unavailable');
        expect(notify).not.toHaveBeenCalled();

        evaluator.check('sensor.door', 'on');
        evaluator.check('sensor.door', 'unavailable');
        expect(newStates()).toEqual(['unavailable']);
      });

      it('does not wait out a duration for it either', () => {
        build({ onSpecificState: true, targetState: 'on', durationSeconds: 60 });
        evaluator.reset(states('sensor.door', 'on'));
        evaluator.check('sensor.door', 'on');
        jest.advanceTimersByTime(60 * 1000);
        expect(notify).not.toHaveBeenCalled();
      });

      it('does not tell about a Specific State the entity comes back from an outage in', () => {
        build({ onSpecificState: true, targetState: 'on' });
        evaluator.reset(states('sensor.door', 'on'));
        evaluator.check('sensor.door', 'unavailable');
        evaluator.check('sensor.door', 'on');
        evaluator.check('sensor.door', 'unknown');
        evaluator.check('sensor.door', 'on');
        expect(notify).not.toHaveBeenCalled();

        evaluator.check('sensor.door', 'off');
        evaluator.check('sensor.door', 'on');
        expect(newStates()).toEqual(['on']);
      });

      it('does not tell about it after Home Assistant restarts and the snapshot is restoring', () => {
        build({ onSpecificState: true, targetState: 'on' });
        evaluator.reset(states('sensor.door', 'on'));
        evaluator.suspend();
        evaluator.reconcile(states('sensor.door', 'unavailable'));
        evaluator.check('sensor.door', 'on');
        expect(notify).not.toHaveBeenCalled();
      });

      it('does not tell about a threshold still crossed, by live update or by snapshot', () => {
        build({ onNumericThreshold: true, threshold: 25, comparison: 'above' });
        evaluator.reset(states('sensor.door', '26'));
        evaluator.check('sensor.door', 'unavailable');
        evaluator.check('sensor.door', '26.1');
        expect(notify).not.toHaveBeenCalled();

        build({ onNumericThreshold: true, threshold: 25, comparison: 'above' });
        evaluator.reset(states('sensor.door', '26'));
        evaluator.suspend();
        evaluator.reconcile(states('sensor.door', 'unavailable'));
        // The next reconnect finds it back, and no state_changed event says so.
        evaluator.suspend();
        evaluator.reconcile(states('sensor.door', '26.3'));
        evaluator.check('sensor.door', '26.4');
        expect(notify).not.toHaveBeenCalled();

        evaluator.check('sensor.door', '20');
        evaluator.check('sensor.door', '27');
        expect(newStates()).toEqual(['27']);
      });
    });

    it('starts a wait an outage cut short over from the snapshot that has the entity back', () => {
      build({ onSpecificState: true, targetState: 'on', durationSeconds: 60 });
      evaluator.reset(states('sensor.door', 'off'));
      evaluator.check('sensor.door', 'on');
      jest.advanceTimersByTime(30 * 1000);
      evaluator.check('sensor.door', 'unavailable');
      // A door left open sends no state_changed event, so only the snapshot says it is back.
      evaluator.suspend();
      evaluator.reconcile(states('sensor.door', 'on'));
      jest.advanceTimersByTime(60 * 1000 - 1);
      expect(notify).not.toHaveBeenCalled();
      jest.advanceTimersByTime(1);
      expect(newStates()).toEqual(['on']);
    });

    it('starts a wait a dropped connection cut short over when the entity is back', () => {
      build({ onSpecificState: true, targetState: 'on', durationSeconds: 60 });
      evaluator.reset(states('sensor.door', 'off'));
      evaluator.check('sensor.door', 'on');
      jest.advanceTimersByTime(30 * 1000);
      evaluator.suspend();
      evaluator.reconcile(states('sensor.door', 'unavailable'));
      evaluator.check('sensor.door', 'on');
      jest.advanceTimersByTime(60 * 1000);
      expect(newStates()).toEqual(['on']);
    });
  });

  describe('a Specific State or threshold rule saved again', () => {
    const newStates = () => notify.mock.calls.map(([, , to]) => to);
    // The same rule with something else changed, as saving it from the Alerts dialog does.
    const edit = (changes, value) => {
      config.alerts['sensor.door'] = { ...config.alerts['sensor.door'], ...changes };
      evaluator.reconcile(states('sensor.door', value));
    };

    it('does not tell again about a condition it already told about', () => {
      build({ onSpecificState: true, targetState: 'on' });
      evaluator.reset(states('sensor.door', 'off'));
      evaluator.check('sensor.door', 'on');
      edit({ cooldownSeconds: 30 }, 'on');
      evaluator.check('sensor.door', 'on');

      expect(newStates()).toEqual(['on']);
    });

    it('waits again for a condition it was still waiting out, with no update to start it', () => {
      build({ onNumericThreshold: true, threshold: 25, comparison: 'above', durationSeconds: 60 });
      evaluator.reset(states('sensor.door', '20'));
      evaluator.check('sensor.door', '26');
      jest.advanceTimersByTime(30 * 1000);
      edit({ durationSeconds: 120 }, '26');

      jest.advanceTimersByTime(120 * 1000 - 1);
      expect(notify).not.toHaveBeenCalled();
      jest.advanceTimersByTime(1);
      expect(newStates()).toEqual(['26']);
    });

    it('waits again for one a dropped connection cut short, once the entity is back', () => {
      build({ onSpecificState: true, targetState: 'on', durationSeconds: 60 });
      evaluator.reset(states('sensor.door', 'off'));
      evaluator.check('sensor.door', 'on');
      evaluator.suspend();
      edit({ cooldownSeconds: 30 }, 'unavailable');
      evaluator.check('sensor.door', 'on');

      jest.advanceTimersByTime(60 * 1000);
      expect(newStates()).toEqual(['on']);
    });

    it('stops waiting when the saved rule no longer matches', () => {
      build({ onNumericThreshold: true, threshold: 25, comparison: 'above', durationSeconds: 60 });
      evaluator.reset(states('sensor.door', '20'));
      evaluator.check('sensor.door', '26');
      edit({ threshold: 30 }, '26');

      jest.advanceTimersByTime(120 * 1000);
      expect(notify).not.toHaveBeenCalled();
    });
  });

  it('matches a typed label against the raw state', () => {
    build({ onSpecificState: true, targetState: 'Not home' });
    evaluator.reset(states('sensor.door', 'home'));
    evaluator.check('sensor.door', 'not_home');
    expect(notify).toHaveBeenCalledTimes(1);
  });

  describe('a State Change rule', () => {
    const toAndFrom = () => notify.mock.calls.map(([, from, to]) => [from, to]);
    const minutes = (count) => count * 60 * 1000;

    beforeEach(() => {
      build({ onStateChange: true });
      evaluator.reset(states('sensor.door', 'on'));
    });

    it('tells about a change between two readings at once', () => {
      evaluator.check('sensor.door', 'off');
      expect(toAndFrom()).toEqual([['on', 'off']]);
    });

    it('does not tell about a state that did not change, or a reconnect snapshot', () => {
      evaluator.check('sensor.door', 'on');
      evaluator.suspend();
      evaluator.reconcile(states('sensor.door', 'unavailable'));
      jest.advanceTimersByTime(minutes(5));
      expect(notify).not.toHaveBeenCalled();
      // The snapshot is the new baseline: only a later change counts.
      evaluator.check('sensor.door', 'unavailable');
      jest.advanceTimersByTime(minutes(5));
      expect(notify).not.toHaveBeenCalled();
      // It came back as what it was before the outage, which is no change at all.
      evaluator.check('sensor.door', 'on');
      expect(notify).not.toHaveBeenCalled();
      evaluator.check('sensor.door', 'off');
      expect(toAndFrom()).toEqual([['on', 'off']]);
    });

    describe('going unavailable or unknown', () => {
      it('is told only once the entity has stayed offline for the grace period', () => {
        evaluator.check('sensor.door', 'unavailable');
        jest.advanceTimersByTime(UNAVAILABLE_GRACE_MS - 1);
        expect(notify).not.toHaveBeenCalled();
        jest.advanceTimersByTime(1);
        expect(toAndFrom()).toEqual([['on', 'unavailable']]);
        // A long outage is one piece of news, however long it lasts.
        jest.advanceTimersByTime(minutes(60));
        expect(notify).toHaveBeenCalledTimes(1);
      });

      it('never tells about a blip that recovers within the grace period', () => {
        for (let blip = 0; blip < 5; blip += 1) {
          evaluator.check('sensor.door', blip % 2 ? 'unknown' : 'unavailable');
          jest.advanceTimersByTime(UNAVAILABLE_GRACE_MS - 1);
          evaluator.check('sensor.door', 'on');
        }
        jest.advanceTimersByTime(minutes(60));
        expect(notify).not.toHaveBeenCalled();
      });

      it('counts unavailable and unknown as one outage, timed from its start', () => {
        evaluator.check('sensor.door', 'unavailable');
        jest.advanceTimersByTime(10 * 1000);
        evaluator.check('sensor.door', 'unknown');
        jest.advanceTimersByTime(UNAVAILABLE_GRACE_MS - 10 * 1000);
        expect(toAndFrom()).toEqual([['on', 'unknown']]);
        evaluator.check('sensor.door', 'unavailable');
        jest.advanceTimersByTime(minutes(60));
        expect(notify).toHaveBeenCalledTimes(1);
      });

      it('waits for the rule’s own duration when that is longer than the grace period', () => {
        build({ onStateChange: true, durationSeconds: 120 });
        evaluator.reset(states('sensor.door', 'on'));
        evaluator.check('sensor.door', 'unavailable');
        jest.advanceTimersByTime(minutes(2) - 1);
        expect(notify).not.toHaveBeenCalled();
        jest.advanceTimersByTime(1);
        expect(notify).toHaveBeenCalledTimes(1);
      });

      describe('at most one outage per entity in fifteen minutes', () => {
        const outage = (lastsMs) => {
          evaluator.check('sensor.door', 'unavailable');
          jest.advanceTimersByTime(lastsMs);
          evaluator.check('sensor.door', 'on');
        };

        it('tells about the first of several outages that each outlast the grace period', () => {
          // Told 30 seconds in; the device then drops out again and again.
          outage(UNAVAILABLE_GRACE_MS);
          expect(notify).toHaveBeenCalledTimes(1);
          jest.advanceTimersByTime(minutes(2));
          outage(minutes(2));
          jest.advanceTimersByTime(minutes(3));
          outage(minutes(5));
          jest.advanceTimersByTime(minutes(1));
          outage(minutes(1));
          expect(notify).toHaveBeenCalledTimes(1);
        });

        it('counts the fifteen minutes from the notification, and no longer holds after them', () => {
          outage(UNAVAILABLE_GRACE_MS);
          // An outage that would be told about 1 ms short of fifteen minutes after that
          // notification is held back...
          jest.advanceTimersByTime(UNAVAILABLE_NOTIFY_INTERVAL_MS - UNAVAILABLE_GRACE_MS - 1);
          outage(UNAVAILABLE_GRACE_MS);
          expect(notify).toHaveBeenCalledTimes(1);
          // ...and the next one is not, being past the fifteen minutes when it is told.
          outage(UNAVAILABLE_GRACE_MS);
          expect(toAndFrom()).toEqual([
            ['on', 'unavailable'],
            ['on', 'unavailable'],
          ]);
        });
      });

      it('does not count an outage nobody was told about against the fifteen minutes', () => {
        evaluator.check('sensor.door', 'unavailable');
        jest.advanceTimersByTime(UNAVAILABLE_GRACE_MS - 1);
        evaluator.check('sensor.door', 'on');
        evaluator.check('sensor.door', 'unavailable');
        jest.advanceTimersByTime(UNAVAILABLE_GRACE_MS);
        expect(notify).toHaveBeenCalledTimes(1);
      });

      it('keeps the rule’s own cooldown, which an outage notification also starts', () => {
        build({ onStateChange: true, cooldownSeconds: 3600 });
        evaluator.reset(states('sensor.door', 'on'));
        evaluator.check('sensor.door', 'unavailable');
        jest.advanceTimersByTime(UNAVAILABLE_GRACE_MS);
        expect(notify).toHaveBeenCalledTimes(1);

        // The device comes back as something else, well inside the rule's hour.
        evaluator.check('sensor.door', 'off');
        expect(notify).toHaveBeenCalledTimes(1);

        // Fifteen minutes on, the outage limit is over, but the rule's cooldown is not.
        jest.advanceTimersByTime(UNAVAILABLE_NOTIFY_INTERVAL_MS);
        evaluator.check('sensor.door', 'unavailable');
        jest.advanceTimersByTime(UNAVAILABLE_GRACE_MS);
        expect(notify).toHaveBeenCalledTimes(1);

        jest.advanceTimersByTime(minutes(60));
        evaluator.check('sensor.door', 'off');
        evaluator.check('sensor.door', 'unknown');
        jest.advanceTimersByTime(UNAVAILABLE_GRACE_MS);
        expect(notify).toHaveBeenCalledTimes(2);
      });

      it('keeps quiet hours', () => {
        jest.setSystemTime(new Date(2026, 9, 4, 23, 0, 0));
        build({
          onStateChange: true,
          quietHours: { enabled: true, start: '22:00', end: '07:00' },
        });
        evaluator.reset(states('sensor.door', 'on'));
        evaluator.check('sensor.door', 'unavailable');
        jest.advanceTimersByTime(UNAVAILABLE_GRACE_MS);
        expect(notify).not.toHaveBeenCalled();
      });

      it('starts the wait over after a reconnect when the entity is still offline', () => {
        evaluator.check('sensor.door', 'unavailable');
        jest.advanceTimersByTime(10 * 1000);
        evaluator.suspend();
        jest.advanceTimersByTime(minutes(5));
        expect(notify).not.toHaveBeenCalled();
        evaluator.reconcile(states('sensor.door', 'unknown'));
        jest.advanceTimersByTime(UNAVAILABLE_GRACE_MS - 1);
        expect(notify).not.toHaveBeenCalled();
        jest.advanceTimersByTime(1);
        expect(toAndFrom()).toEqual([['on', 'unknown']]);
      });

      it('drops the wait when the reconnect snapshot says it came back', () => {
        evaluator.check('sensor.door', 'unavailable');
        evaluator.suspend();
        evaluator.reconcile(states('sensor.door', 'on'));
        jest.advanceTimersByTime(minutes(5));
        expect(notify).not.toHaveBeenCalled();
      });

      it('does not repeat itself when the reconnect snapshot still says offline', () => {
        evaluator.check('sensor.door', 'unavailable');
        jest.advanceTimersByTime(UNAVAILABLE_GRACE_MS);
        evaluator.suspend();
        evaluator.reconcile(states('sensor.door', 'unavailable'));
        jest.advanceTimersByTime(minutes(60));
        expect(notify).toHaveBeenCalledTimes(1);
      });

      it('has nothing to say about an entity first seen offline', () => {
        evaluator.reset(states('sensor.door', 'unavailable'));
        jest.advanceTimersByTime(minutes(5));
        expect(notify).not.toHaveBeenCalled();
        // Nothing is known about what it was, so coming back is not a change either.
        evaluator.check('sensor.door', 'on');
        expect(notify).not.toHaveBeenCalled();
        evaluator.check('sensor.door', 'off');
        expect(toAndFrom()).toEqual([['on', 'off']]);
      });

      describe('when the rule is saved again', () => {
        // A save that changes the rule, as opposed to one that leaves it alone.
        const edit = (changes, current) => {
          config = {
            ...config,
            alerts: { 'sensor.door': { ...config.alerts['sensor.door'], ...changes } },
          };
          evaluator.reconcile(states('sensor.door', current));
        };

        it('keeps the fifteen-minute limit, so a flapping device is not told about again', () => {
          evaluator.check('sensor.door', 'unavailable');
          jest.advanceTimersByTime(UNAVAILABLE_GRACE_MS);
          evaluator.check('sensor.door', 'on');
          expect(notify).toHaveBeenCalledTimes(1);

          jest.advanceTimersByTime(10 * 1000);
          edit({ durationSeconds: 5 }, 'on');
          jest.advanceTimersByTime(30 * 1000);
          evaluator.check('sensor.door', 'unavailable');
          jest.advanceTimersByTime(UNAVAILABLE_GRACE_MS);
          expect(notify).toHaveBeenCalledTimes(1);

          // Fifteen minutes after the notification the limit is over, edit or not.
          evaluator.check('sensor.door', 'on');
          jest.advanceTimersByTime(UNAVAILABLE_NOTIFY_INTERVAL_MS);
          evaluator.check('sensor.door', 'unavailable');
          jest.advanceTimersByTime(UNAVAILABLE_GRACE_MS);
          expect(notify).toHaveBeenCalledTimes(2);
        });

        it('keeps the rule’s cooldown, which a longer one then applies to', () => {
          build({ onStateChange: true, cooldownSeconds: 60 });
          evaluator.reset(states('sensor.door', 'on'));
          evaluator.check('sensor.door', 'off');
          expect(notify).toHaveBeenCalledTimes(1);

          jest.advanceTimersByTime(minutes(5));
          edit({ cooldownSeconds: 3600 }, 'off');
          evaluator.check('sensor.door', 'on');
          expect(notify).toHaveBeenCalledTimes(1);
          jest.advanceTimersByTime(minutes(60));
          evaluator.check('sensor.door', 'off');
          expect(notify).toHaveBeenCalledTimes(2);
        });

        it('starts the wait over for an outage that was waiting, and still says what it was', () => {
          evaluator.check('sensor.door', 'unavailable');
          jest.advanceTimersByTime(10 * 1000);
          edit({ quietHours: { enabled: false, start: '22:00', end: '07:00' } }, 'unavailable');
          jest.advanceTimersByTime(UNAVAILABLE_GRACE_MS - 1);
          expect(notify).not.toHaveBeenCalled();
          jest.advanceTimersByTime(1);
          expect(toAndFrom()).toEqual([['on', 'unavailable']]);
        });

        it('starts the wait over for an outage that a disconnect was holding up', () => {
          evaluator.check('sensor.door', 'unknown');
          evaluator.suspend();
          edit({ cooldownSeconds: 10 }, 'unknown');
          jest.advanceTimersByTime(UNAVAILABLE_GRACE_MS);
          expect(toAndFrom()).toEqual([['on', 'unknown']]);
        });

        it('does not start one for an entity that came back, or that was already told about', () => {
          evaluator.check('sensor.door', 'unavailable');
          jest.advanceTimersByTime(10 * 1000);
          edit({ cooldownSeconds: 10 }, 'on');
          jest.advanceTimersByTime(minutes(5));
          expect(notify).not.toHaveBeenCalled();

          evaluator.check('sensor.door', 'unavailable');
          jest.advanceTimersByTime(UNAVAILABLE_GRACE_MS);
          expect(notify).toHaveBeenCalledTimes(1);
          edit({ cooldownSeconds: 20 }, 'unavailable');
          jest.advanceTimersByTime(minutes(60));
          expect(notify).toHaveBeenCalledTimes(1);
        });

        it('does not start one when the saved rule no longer tells about an outage', () => {
          for (const changes of [{ notifyOnUnavailable: false }, { onStateChange: false }]) {
            build({ onStateChange: true });
            evaluator.reset(states('sensor.door', 'on'));
            evaluator.check('sensor.door', 'unavailable');
            jest.advanceTimersByTime(10 * 1000);
            edit(changes, 'unavailable');
            jest.advanceTimersByTime(minutes(5));
            expect(notify).not.toHaveBeenCalled();
          }
        });
      });
    });

    describe('coming back from unavailable or unknown', () => {
      it('is not news when the entity is what it was before', () => {
        evaluator.check('sensor.door', 'unavailable');
        jest.advanceTimersByTime(UNAVAILABLE_GRACE_MS);
        evaluator.check('sensor.door', 'on');
        expect(toAndFrom()).toEqual([['on', 'unavailable']]);
      });

      it('is news when the entity came back as something else, said as that change', () => {
        evaluator.check('sensor.door', 'unavailable');
        jest.advanceTimersByTime(UNAVAILABLE_GRACE_MS);
        evaluator.check('sensor.door', 'off');
        expect(toAndFrom()).toEqual([
          ['on', 'unavailable'],
          ['on', 'off'],
        ]);
      });

      it('is news even inside the grace period, when the entity came back as something else', () => {
        evaluator.check('sensor.door', 'unavailable');
        jest.advanceTimersByTime(UNAVAILABLE_GRACE_MS / 2);
        evaluator.check('sensor.door', 'off');
        jest.advanceTimersByTime(minutes(5));
        expect(toAndFrom()).toEqual([['on', 'off']]);
      });
    });

    describe('with notifications for it switched off', () => {
      beforeEach(() => {
        build({ onStateChange: true, notifyOnUnavailable: false });
        evaluator.reset(states('sensor.door', 'on'));
      });

      it('says nothing about going unavailable or unknown, however long it lasts', () => {
        evaluator.check('sensor.door', 'unavailable');
        jest.advanceTimersByTime(minutes(60));
        evaluator.check('sensor.door', 'unknown');
        jest.advanceTimersByTime(minutes(60));
        evaluator.check('sensor.door', 'on');
        jest.advanceTimersByTime(minutes(60));
        expect(notify).not.toHaveBeenCalled();
      });

      it('still tells about every other change', () => {
        evaluator.check('sensor.door', 'off');
        evaluator.check('sensor.door', 'on');
        expect(toAndFrom()).toEqual([
          ['on', 'off'],
          ['off', 'on'],
        ]);
      });

      it('still tells when the entity comes back as something else', () => {
        evaluator.check('sensor.door', 'unavailable');
        jest.advanceTimersByTime(minutes(5));
        evaluator.check('sensor.door', 'off');
        expect(toAndFrom()).toEqual([['on', 'off']]);
      });
    });

    it('tells about going offline when the rule saved before the switch existed has no setting', () => {
      // Rules saved by earlier versions have no notifyOnUnavailable, and an explicit true is the same.
      for (const rule of [
        { onStateChange: true },
        { onStateChange: true, notifyOnUnavailable: true },
      ]) {
        build(rule);
        evaluator.reset(states('sensor.door', 'on'));
        evaluator.check('sensor.door', 'unavailable');
        jest.advanceTimersByTime(UNAVAILABLE_GRACE_MS);
        expect(toAndFrom()).toEqual([['on', 'unavailable']]);
      }
    });
  });

  describe('the switch for unavailable and unknown, on a rule that names the state', () => {
    it('is for State Change rules: a Specific State rule for unavailable is not held back', () => {
      build({ onSpecificState: true, targetState: 'unavailable', notifyOnUnavailable: false });
      evaluator.reset(states('sensor.door', 'on'));
      evaluator.check('sensor.door', 'unavailable');
      expect(notify).toHaveBeenCalledTimes(1);
      evaluator.check('sensor.door', 'on');
      evaluator.check('sensor.door', 'unavailable');
      expect(notify).toHaveBeenCalledTimes(2);
    });
  });
});

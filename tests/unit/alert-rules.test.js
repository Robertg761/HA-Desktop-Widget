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

/**
 * @jest-environment node
 */

const {
  createEntityActions,
  describeEntity,
  getEntityDomain,
  hasFeature,
} = require('../../src/entity-actions.cjs');

const entity = (entityId, state, attributes = {}) => ({ entity_id: entityId, state, attributes });

describe('what a click on an entity does', () => {
  it.each([
    // Switched devices flip, by the state they are in.
    ['light.desk', 'on', {}, 'toggle', 'turn_off'],
    ['light.desk', 'off', {}, 'toggle', 'turn_on'],
    ['switch.plug', 'off', {}, 'toggle', 'turn_on'],
    ['fan.attic', 'on', {}, 'toggle', 'turn_off'],
    ['input_boolean.guest', 'off', {}, 'toggle', 'turn_on'],
    ['humidifier.bedroom', 'on', {}, 'toggle', 'turn_off'],
    ['siren.hall', 'off', {}, 'toggle', 'turn_on'],
    ['automation.sunset', 'on', {}, 'toggle', 'toggle'],
    // Covers and valves go the other way from where they are, where they can.
    ['cover.garage', 'open', { supported_features: 3 }, 'toggle', 'close_cover'],
    ['cover.garage', 'opening', { supported_features: 3 }, 'toggle', 'close_cover'],
    ['cover.garage', 'closed', { supported_features: 3 }, 'toggle', 'open_cover'],
    ['cover.awning', 'open', { supported_features: 1 }, 'toggle', null],
    ['cover.legacy', 'closed', {}, 'toggle', null],
    ['valve.garden', 'open', {}, 'toggle', 'close_valve'],
    ['valve.garden', 'closed', { supported_features: 2 }, 'toggle', null],
    ['lock.front', 'locked', {}, 'toggle', 'unlock'],
    ['lock.front', 'unlocked', {}, 'toggle', 'lock'],
    ['lock.front', 'jammed', {}, 'toggle', 'lock'],
    ['timer.tea', 'active', {}, 'toggle', 'pause'],
    ['timer.tea', 'paused', {}, 'toggle', 'start'],
    ['timer.tea', 'idle', {}, 'toggle', 'start'],
    ['media_player.tv', 'playing', { supported_features: 1 }, 'toggle', 'media_pause'],
    ['media_player.tv', 'paused', { supported_features: 16384 }, 'toggle', 'media_play'],
    ['media_player.tv', 'playing', { supported_features: 0 }, 'toggle', null],
    // Things that run once.
    ['scene.movie', 'unknown', {}, 'activate', 'turn_on'],
    ['script.night', 'off', {}, 'activate', 'turn_on'],
    ['button.restart', 'unknown', {}, 'activate', 'press'],
    ['input_button.ring', '2026-01-01T00:00:00Z', {}, 'activate', 'press'],
    // Things with a dialog.
    ['climate.hall', 'heat', {}, 'dialog', null],
    ['camera.porch', 'idle', {}, 'dialog', null],
    ['sensor.temperature', '21', {}, 'dialog', null],
    ['todo.shopping', '2', {}, 'dialog', null],
    ['calendar.family', 'off', {}, 'dialog', null],
    ['number.volume', '3', {}, 'dialog', null],
    ['input_number.level', '3', {}, 'dialog', null],
    ['select.mode', 'a', {}, 'dialog', null],
    ['input_select.mode', 'a', {}, 'dialog', null],
    ['vacuum.robot', 'docked', {}, 'dialog', null],
    // Armed and disarmed by name, where a code can be asked for.
    ['alarm_control_panel.home', 'disarmed', {}, 'hint', null],
    // Nothing to do.
    ['sun.sun', 'above_horizon', {}, 'none', null],
    ['person.sam', 'home', {}, 'none', null],
    ['weather.home', 'sunny', {}, 'none', null],
    ['device_tracker.phone', 'home', {}, 'none', null],
    ['update.core', 'off', {}, 'none', null],
    ['zone.home', '1', {}, 'none', null],
    ['binary_sensor.door', 'off', {}, 'none', null],
  ])('%s while %s %j: %s, calling %s', (entityId, state, attributes, click, service) => {
    const description = describeEntity(entity(entityId, state, attributes));
    expect(description.domain).toBe(entityId.split('.')[0]);
    expect(description.click).toBe(click);
    expect(description.service).toBe(service);
  });

  it('asks first only before it unlocks', () => {
    expect(describeEntity(entity('lock.front', 'locked')).confirm).toBe(true);
    for (const subject of [
      entity('lock.front', 'unlocked'),
      entity('light.desk', 'on'),
      'lock.front',
    ]) {
      expect(describeEntity(subject).confirm).toBe(false);
    }
  });

  it('has an adjust dialog for lights, fans, covers, thermostats and players only', () => {
    const withControls = ['light', 'fan', 'cover', 'climate', 'media_player'];
    for (const domain of [...withControls, 'switch', 'lock', 'sensor', 'scene', 'vacuum']) {
      expect(describeEntity(`${domain}.one`).controls).toBe(withControls.includes(domain));
    }
  });

  it('takes commands unless Home Assistant says it is unavailable', () => {
    expect(describeEntity(entity('light.desk', 'on')).available).toBe(true);
    // A scene or button never pressed is unknown and works.
    expect(describeEntity(entity('button.restart', 'unknown')).available).toBe(true);
    expect(describeEntity(entity('light.desk', 'unavailable')).available).toBe(false);
    for (const nothing of ['light.desk', undefined, null, {}, { entity_id: 'light' }]) {
      expect(describeEntity(nothing).available).toBe(false);
    }
  });
});

describe('the commands an entity offers by name', () => {
  const allServices = {
    light: { turn_on: {}, turn_off: {} },
    humidifier: { turn_on: {}, turn_off: {} },
    scene: { turn_on: {} },
    lock: { lock: {}, unlock: {} },
    alarm_control_panel: {
      alarm_arm_home: {},
      alarm_arm_away: {},
      alarm_arm_night: {},
      alarm_disarm: {},
    },
  };

  it.each([
    // Only what changes it: a device that is on is turned off.
    [entity('light.desk', 'on'), ['turn_off']],
    [entity('light.desk', 'off'), ['turn_on']],
    [entity('light.desk', 'dimming'), ['turn_on', 'turn_off']],
    [entity('light.desk', 'unknown'), []],
    [entity('light.desk', 'unavailable'), []],
    [entity('humidifier.bedroom', 'on'), ['turn_off']],
    [entity('siren.hall', 'off'), ['turn_on']],
    [entity('scene.movie', 'unknown'), ['turn_on']],
    [entity('lock.front', 'locked'), ['unlock']],
    [entity('lock.front', 'unlocked'), ['lock']],
    [entity('lock.front', 'jammed'), []],
    [
      entity('alarm_control_panel.home', 'armed_home', { supported_features: 3 }),
      ['alarm_arm_away', 'alarm_disarm'],
    ],
    [
      entity('alarm_control_panel.home', 'disarmed', { supported_features: 1 + 2 + 4 + 16 + 32 }),
      [
        'alarm_arm_home',
        'alarm_arm_away',
        'alarm_arm_night',
        'alarm_arm_custom_bypass',
        'alarm_arm_vacation',
      ],
    ],
    [entity('cover.garage', 'open', { supported_features: 3 }), []],
    [entity('button.restart', 'unknown'), []],
  ])('%j: %j', (subject, commands) => {
    expect(describeEntity(subject).commands).toEqual(commands);
  });

  it('leaves out what the server does not offer', () => {
    const panel = entity('alarm_control_panel.home', 'disarmed', { supported_features: 63 });
    expect(describeEntity(panel, { services: allServices }).commands).toEqual([
      'alarm_arm_home',
      'alarm_arm_away',
      'alarm_arm_night',
    ]);
    expect(describeEntity(entity('switch.plug', 'on'), { services: allServices }).commands).toEqual(
      []
    );
    expect(describeEntity(entity('light.desk', 'on'), { services: {} }).commands).toEqual([]);
  });

  it('lists every command of its kind for a bare entity id', () => {
    expect(describeEntity('switch.plug').commands).toEqual(['turn_on', 'turn_off']);
    expect(describeEntity('lock.front').commands).toEqual(['lock', 'unlock']);
    expect(describeEntity('sensor.temperature').commands).toEqual([]);
  });
});

describe('the actions a hotkey can run', () => {
  it.each([
    ['light', ['toggle', 'turn_on', 'turn_off', 'brightness_up', 'brightness_down']],
    ['switch', ['toggle', 'turn_on', 'turn_off']],
    ['scene', ['turn_on']],
    ['script', ['turn_on']],
    ['automation', ['trigger', 'toggle', 'turn_on', 'turn_off']],
    ['button', ['press']],
    ['input_button', ['press']],
    ['input_boolean', ['toggle', 'turn_on', 'turn_off']],
    ['fan', ['toggle', 'turn_on', 'turn_off', 'increase_speed', 'decrease_speed']],
    ['cover', ['toggle', 'open', 'close']],
    ['valve', ['toggle', 'open', 'close']],
    // A lock has no toggle: a chord pressed by mistake must not open a door.
    ['lock', ['lock', 'unlock']],
    ['humidifier', ['toggle', 'turn_on', 'turn_off']],
    ['siren', ['toggle', 'turn_on', 'turn_off']],
    // A hotkey on these would be a shortcut that does nothing.
    ['sensor', []],
    ['camera', []],
    ['media_player', []],
    ['climate', []],
    ['timer', []],
  ])('on %s: %j', (domain, actions) => {
    const { hotkeyActions } = describeEntity(`${domain}.one`);
    expect(hotkeyActions).toEqual(actions);
    expect(Object.isFrozen(hotkeyActions)).toBe(true);
  });

  // The entity each hotkey action can act on, in a state it can act from.
  const subjects = {
    light: entity('light.one', 'on', { brightness: 100 }),
    switch: entity('switch.one', 'off'),
    scene: entity('scene.one', 'unknown'),
    script: entity('script.one', 'off'),
    automation: entity('automation.one', 'on'),
    button: entity('button.one', 'unknown'),
    input_button: entity('input_button.one', 'unknown'),
    input_boolean: entity('input_boolean.one', 'off'),
    fan: entity('fan.one', 'on', { percentage: 50 }),
    cover: entity('cover.one', 'closed', { supported_features: 3 }),
    valve: entity('valve.one', 'closed'),
    lock: entity('lock.one', 'locked'),
    humidifier: entity('humidifier.one', 'off'),
    siren: entity('siren.one', 'off'),
  };

  it.each(
    Object.entries(subjects).flatMap(([domain, subject]) =>
      describeEntity(subject).hotkeyActions.map((action) => [domain, action, subject])
    )
  )('on %s, %s calls a service', async (domain, action, subject) => {
    const callService = jest.fn(async () => ({}));
    const actions = createEntityActions({ callService, getEntity: () => subject });
    const outcome = await actions.run(subject, action);
    expect(outcome).toMatchObject({ ok: true, sent: true });
    expect(callService).toHaveBeenCalledWith(domain, expect.any(String), {
      entity_id: subject.entity_id,
      ...callService.mock.calls[0][2],
    });
  });
});

describe('what an entity can do, from its feature flags', () => {
  const capabilities = (entityId, attributes, state = 'on') =>
    describeEntity(entity(entityId, state, attributes)).capabilities;

  it.each([
    ['light.flag', { supported_features: 1 }, { canToggle: true, canSetBrightness: true }],
    ['light.reading', { brightness: 120 }, { canSetBrightness: true }],
    ['light.modes', { supported_color_modes: ['hs'] }, { canSetBrightness: true }],
    [
      'light.onoff',
      { brightness: null, supported_color_modes: ['onoff'] },
      { canSetBrightness: false },
    ],
    ['fan.flag', { supported_features: 1 }, { canSetPercentage: true, canSetPreset: false }],
    ['fan.blank', { percentage: '' }, { canSetPercentage: false }],
    // An entity older than the flags is offered what its attributes show.
    ['fan.legacy', { percentage: 40 }, { canSetPercentage: true }],
    ['fan.declared', { percentage: 40, supported_features: 0 }, { canSetPercentage: false }],
    [
      'fan.presets',
      { supported_features: 8, preset_modes: ['eco'] },
      { canSetPreset: true, canSetPercentage: false },
    ],
    [
      'cover.full',
      { supported_features: 15 },
      { canOpen: true, canClose: true, canSetPosition: true, canStop: true },
    ],
    [
      'cover.none',
      { current_position: null, supported_features: '   ' },
      { canOpen: false, canSetPosition: false },
    ],
    ['cover.legacy', { current_position: 45, supported_features: '   ' }, { canSetPosition: true }],
    ['valve.unflagged', {}, { canOpen: true, canClose: true, canStop: false }],
    ['valve.open_only', { supported_features: 1 }, { canOpen: true, canClose: false }],
    [
      'media_player.full',
      { supported_features: 1 | 2 | 4 | 8 | 16 | 32 | 16384 },
      {
        canPlay: true,
        canPause: true,
        canPreviousTrack: true,
        canNextTrack: true,
        canSeek: true,
        canSetVolume: true,
        canMute: true,
      },
    ],
    ['media_player.none', {}, { canPlay: false, canPause: false, canSetVolume: false }],
    ['todo.list', { supported_features: 5 }, { canAdd: true, canUpdate: true }],
    ['todo.read_only', { supported_features: 0 }, { canAdd: false, canUpdate: false }],
    [
      'climate.null_target',
      { temperature: null, min_temp: 7, max_temp: 35 },
      { canSetTemperature: false },
    ],
    [
      'climate.target',
      { temperature: 21, min_temp: 7, max_temp: 35, hvac_modes: ['off', 'heat', ''] },
      { canSetTemperature: true, hvacModes: ['off', 'heat'] },
    ],
    // A vacuum's Start, Pause and Return, which a pin window cannot ask Home Assistant for.
    [
      'vacuum.modern',
      { supported_features: 8192 + 4 + 16 },
      {
        canStart: true,
        canTurnOn: false,
        canPause: true,
        canReturnHome: true,
        canStop: false,
        canTurnOff: false,
      },
    ],
    [
      'vacuum.stops',
      { supported_features: 8 + 2 },
      { canStart: false, canStop: true, canTurnOff: true },
    ],
    // Written before START existed, it is switched on instead.
    [
      'vacuum.old',
      { supported_features: 1 + 2 + 16 },
      { canStart: false, canTurnOn: true, canReturnHome: true, canTurnOff: true },
    ],
    [
      'vacuum.silent',
      {},
      { canStart: true, canPause: true, canReturnHome: true, canTurnOn: false },
    ],
    ['vacuum.zero', { supported_features: 0 }, { canStart: true, canPause: true }],
    ['sensor.temperature', { supported_features: 255 }, {}],
  ])('%s %j', (entityId, attributes, expected) => {
    expect(capabilities(entityId, attributes)).toMatchObject(expected);
  });

  it.each([
    [12, 4, true],
    [12, 8, true],
    [4, 8, false],
    [undefined, 4, false],
    ['12', 4, true],
    [12, 0, false],
    [12, 12, true],
    [12, 13, false],
  ])('hasFeature(%j, %j) is %s', (features, flag, expected) => {
    expect(hasFeature(features, flag)).toBe(expected);
  });

  it.each([
    ['light.kitchen', 'light'],
    [{ entity_id: 'input_button.ring' }, 'input_button'],
    ['light', ''],
    ['.light', ''],
    [undefined, ''],
    [42, ''],
  ])('the domain of %j is %j', (subject, domain) => {
    expect(getEntityDomain(subject)).toBe(domain);
  });
});

describe('running an action', () => {
  let states;
  let callService;
  let onChange;
  let onError;
  let services;
  let actions;

  const put = (subject) => {
    states[subject.entity_id] = subject;
    return subject;
  };

  beforeEach(() => {
    jest.useFakeTimers();
    states = {};
    services = null;
    callService = jest.fn(async () => ({ success: true }));
    onChange = jest.fn();
    onError = jest.fn();
    actions = createEntityActions({
      callService,
      getEntity: (entityId) => states[entityId],
      getServices: () => services,
      onChange,
      onError,
    });
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  const flush = async () => {
    for (let i = 0; i < 5; i += 1) await Promise.resolve();
  };

  describe('sends the call the action makes on the entity', () => {
    it.each([
      [entity('switch.plug', 'off'), 'turn_on', undefined, 'switch', 'turn_on', {}],
      [entity('switch.plug', 'on'), 'turn_off', undefined, 'switch', 'turn_off', {}],
      [entity('automation.sunset', 'on'), 'toggle', undefined, 'automation', 'toggle', {}],
      [entity('automation.sunset', 'on'), 'trigger', undefined, 'automation', 'trigger', {}],
      [entity('automation.sunset', 'off'), 'turn_on', undefined, 'automation', 'turn_on', {}],
      [entity('button.restart', 'unknown'), 'press', undefined, 'button', 'press', {}],
      // A pin's Run button triggers whatever kind of action it is.
      [entity('input_button.ring', 'unknown'), 'trigger', undefined, 'input_button', 'press', {}],
      [entity('scene.movie', 'unknown'), 'toggle', undefined, 'scene', 'turn_on', {}],
      [entity('script.night', 'off'), 'turn_on', undefined, 'script', 'turn_on', {}],
      [
        entity('cover.garage', 'open', { supported_features: 3 }),
        'toggle',
        undefined,
        'cover',
        'close_cover',
        {},
      ],
      [
        entity('cover.garage', 'open', { supported_features: 3 }),
        'open',
        undefined,
        'cover',
        'open_cover',
        {},
      ],
      [
        entity('cover.garage', 'closed', { supported_features: 3 }),
        'close',
        undefined,
        'cover',
        'close_cover',
        {},
      ],
      [
        entity('cover.garage', 'opening', { supported_features: 8 }),
        'stop',
        undefined,
        'cover',
        'stop_cover',
        {},
      ],
      [entity('valve.garden', 'closed'), 'toggle', undefined, 'valve', 'open_valve', {}],
      [entity('valve.garden', 'open'), 'close', undefined, 'valve', 'close_valve', {}],
      [entity('lock.front', 'locked'), 'toggle', undefined, 'lock', 'unlock', {}],
      [entity('lock.front', 'unlocked'), 'lock', undefined, 'lock', 'lock', {}],
      [entity('lock.front', 'locked'), 'unlock', undefined, 'lock', 'unlock', {}],
      [
        entity('light.desk', 'on', { brightness: 100 }),
        'brightness_up',
        undefined,
        'light',
        'turn_on',
        { brightness: 151 },
      ],
      [
        entity('light.desk', 'on', { brightness: 220 }),
        'brightness_up',
        undefined,
        'light',
        'turn_on',
        { brightness: 255 },
      ],
      [
        entity('light.desk', 'on', { brightness: 200 }),
        'brightness_down',
        undefined,
        'light',
        'turn_on',
        { brightness: 149 },
      ],
      [
        entity('light.desk', 'on', { brightness: 30 }),
        'brightness_down',
        undefined,
        'light',
        'turn_on',
        { brightness: 0 },
      ],
      [
        entity('light.desk', 'on', {}),
        'brightness_up',
        undefined,
        'light',
        'turn_on',
        { brightness: 51 },
      ],
      [
        entity('light.desk', 'on', {}),
        'color',
        [255, 0, 10.4],
        'light',
        'turn_on',
        { rgb_color: [255, 0, 10] },
      ],
      [
        entity('fan.attic', 'on', { percentage: 50 }),
        'increase_speed',
        undefined,
        'fan',
        'set_percentage',
        { percentage: 83 },
      ],
      [
        entity('fan.attic', 'on', { percentage: 80 }),
        'increase_speed',
        undefined,
        'fan',
        'set_percentage',
        { percentage: 100 },
      ],
      [
        entity('fan.attic', 'on', { percentage: 66 }),
        'decrease_speed',
        undefined,
        'fan',
        'set_percentage',
        { percentage: 33 },
      ],
      [entity('timer.tea', 'active'), 'toggle', undefined, 'timer', 'pause', {}],
      [entity('timer.tea', 'idle'), 'toggle', undefined, 'timer', 'start', {}],
      [
        entity('media_player.tv', 'playing', { supported_features: 1 }),
        'toggle',
        undefined,
        'media_player',
        'media_pause',
        {},
      ],
      [
        entity('media_player.tv', 'paused', { supported_features: 16384 }),
        'play',
        undefined,
        'media_player',
        'media_play',
        {},
      ],
      [
        entity('media_player.tv', 'playing', { supported_features: 32 }),
        'next_track',
        undefined,
        'media_player',
        'media_next_track',
        {},
      ],
      [
        entity('media_player.tv', 'playing', { supported_features: 16 }),
        'previous_track',
        undefined,
        'media_player',
        'media_previous_track',
        {},
      ],
      [
        entity('media_player.tv', 'playing', { supported_features: 2 }),
        'seek',
        42,
        'media_player',
        'media_seek',
        { seek_position: 42 },
      ],
      [
        entity('media_player.tv', 'playing', { supported_features: 8 }),
        'mute',
        true,
        'media_player',
        'volume_mute',
        { is_volume_muted: true },
      ],
      [
        entity('climate.hall', 'heat'),
        'hvac_mode',
        'cool',
        'climate',
        'set_hvac_mode',
        { hvac_mode: 'cool' },
      ],
      [entity('vacuum.robot', 'docked'), 'start', undefined, 'vacuum', 'start', {}],
      [entity('vacuum.robot', 'cleaning'), 'pause', undefined, 'vacuum', 'pause', {}],
      [
        entity('vacuum.robot', 'cleaning'),
        'return_to_base',
        undefined,
        'vacuum',
        'return_to_base',
        {},
      ],
      [entity('vacuum.robot', 'cleaning'), 'stop', undefined, 'vacuum', 'stop', {}],
      [entity('vacuum.robot', 'docked'), 'turn_on', undefined, 'vacuum', 'turn_on', {}],
      [
        entity('alarm_control_panel.home', 'armed_away'),
        'alarm_disarm',
        '1234',
        'alarm_control_panel',
        'alarm_disarm',
        { code: '1234' },
      ],
      [
        entity('alarm_control_panel.home', 'disarmed'),
        'alarm_arm_away',
        null,
        'alarm_control_panel',
        'alarm_arm_away',
        {},
      ],
    ])('%j %s %j: %s.%s %j', async (subject, action, value, domain, service, data) => {
      put(subject);
      const outcome = await actions.run(subject, action, value);
      expect(callService).toHaveBeenCalledTimes(1);
      expect(callService).toHaveBeenCalledWith(domain, service, {
        entity_id: subject.entity_id,
        ...data,
      });
      expect(outcome).toEqual({ ok: true, sent: true, result: { success: true } });
    });
  });

  it.each([
    [entity('sensor.temperature', '21'), 'toggle', undefined],
    [entity('light.desk', 'on'), 'lock', undefined],
    [entity('light.desk', 'unavailable'), 'toggle', undefined],
    [entity('lock.front', 'unavailable'), 'lock', undefined],
    [entity('cover.awning', 'closed', { supported_features: 2 }), 'open', undefined],
    [entity('cover.awning', 'closed', {}), 'stop', undefined],
    [entity('media_player.tv', 'paused', { supported_features: 0 }), 'play', undefined],
    [entity('media_player.tv', 'paused', { supported_features: 0 }), 'toggle', undefined],
    [entity('fan.attic', 'on', { supported_features: 0 }), 'percentage', 40],
    [entity('number.level', '3'), 'set_value', 'many'],
    [entity('select.mode', 'a'), 'next_option', ''],
    [entity('switch.plug', 'on'), 'dance', undefined],
    [{ state: 'on' }, 'toggle', undefined],
  ])('sends nothing for %j %s %j', async (subject, action, value) => {
    if (subject.entity_id) put(subject);
    const outcome = await actions.run(subject, action, value);
    jest.runOnlyPendingTimers();
    await flush();
    expect(outcome).toEqual({ ok: false, sent: false });
    expect(callService).not.toHaveBeenCalled();
    expect(onChange).not.toHaveBeenCalled();
  });

  it('acts on the state Home Assistant sent last, not the one it was handed', async () => {
    put(entity('lock.front', 'unlocked'));
    await actions.run(entity('lock.front', 'locked'), 'toggle');
    expect(callService).toHaveBeenCalledWith('lock', 'lock', { entity_id: 'lock.front' });
  });

  it('reports a failed call and resolves with its error, unless the caller reports it', async () => {
    const subject = put(entity('lock.front', 'unlocked', { friendly_name: 'Front' }));
    const error = new Error('Entity is read-only');
    callService.mockRejectedValueOnce(error).mockRejectedValueOnce(error);

    await expect(actions.run(subject, 'lock')).resolves.toEqual({ ok: false, sent: true, error });
    expect(onError).toHaveBeenCalledWith(error, subject);

    onError.mockClear();
    await expect(actions.run(subject, 'lock', undefined, { silent: true })).resolves.toEqual({
      ok: false,
      sent: true,
      error,
    });
    expect(onError).not.toHaveBeenCalled();
  });

  describe('a value that is still being dragged', () => {
    it.each([
      [
        entity('light.desk', 'on'),
        'brightness',
        40,
        110,
        'light',
        'turn_on',
        { brightness_pct: 40 },
      ],
      [entity('light.desk', 'on'), 'brightness', 0, 110, 'light', 'turn_off', {}],
      [
        entity('light.desk', 'on'),
        'color_temp',
        3000.4,
        150,
        'light',
        'turn_on',
        { color_temp_kelvin: 3000 },
      ],
      [
        entity('fan.attic', 'on', { supported_features: 1 }),
        'percentage',
        50,
        140,
        'fan',
        'set_percentage',
        { percentage: 50 },
      ],
      [
        entity('fan.attic', 'on', { supported_features: 1 }),
        'percentage',
        0,
        140,
        'fan',
        'turn_off',
        {},
      ],
      [
        entity('cover.blind', 'open', { supported_features: 4 }),
        'position',
        130,
        180,
        'cover',
        'set_cover_position',
        { position: 100 },
      ],
      [
        entity('climate.hall', 'heat'),
        'temperature',
        21.5,
        180,
        'climate',
        'set_temperature',
        { temperature: 21.5 },
      ],
      [
        entity('media_player.tv', 'on', { supported_features: 4 }),
        'volume',
        0.4,
        150,
        'media_player',
        'volume_set',
        { volume_level: 0.4 },
      ],
      [
        entity('number.level', '3', { min: 0, max: 10 }),
        'set_value',
        12,
        120,
        'number',
        'set_value',
        { value: 10 },
      ],
      [
        entity('input_number.level', '3', {}),
        'set_value',
        '12',
        120,
        'input_number',
        'set_value',
        { value: 12 },
      ],
      [
        entity('select.mode', 'a'),
        'next_option',
        'b',
        100,
        'select',
        'select_option',
        { option: 'b' },
      ],
      [
        entity('input_select.mode', 'b'),
        'previous_option',
        'a',
        100,
        'input_select',
        'select_option',
        { option: 'a' },
      ],
    ])(
      '%j %s %j waits %i ms, then %s.%s %j',
      async (subject, action, value, delay, domain, service, data) => {
        put(subject);
        const outcome = actions.run(subject, action, value);
        jest.advanceTimersByTime(delay - 1);
        expect(callService).not.toHaveBeenCalled();
        jest.advanceTimersByTime(1);
        await expect(outcome).resolves.toMatchObject({ ok: true, sent: true });
        expect(callService).toHaveBeenCalledWith(domain, service, {
          entity_id: subject.entity_id,
          ...data,
        });
      }
    );

    it('sends only the last value; the ones it replaced resolve as superseded', async () => {
      const subject = put(entity('light.desk', 'on'));
      const first = actions.run(subject, 'brightness', 20);
      const second = actions.run(subject, 'brightness', 30);
      const last = actions.run(subject, 'brightness', 40);
      jest.advanceTimersByTime(110);
      await expect(first).resolves.toEqual({ ok: true, sent: false, superseded: true });
      await expect(second).resolves.toEqual({ ok: true, sent: false, superseded: true });
      await expect(last).resolves.toMatchObject({ ok: true, sent: true });
      expect(callService).toHaveBeenCalledTimes(1);
      expect(callService).toHaveBeenCalledWith('light', 'turn_on', {
        entity_id: 'light.desk',
        brightness_pct: 40,
      });
    });

    it('keeps one run per entity and slider', async () => {
      put(entity('light.desk', 'on'));
      put(entity('light.hall', 'on'));
      actions.run(states['light.desk'], 'brightness', 20);
      actions.run(states['light.hall'], 'brightness', 30);
      actions.run(states['light.desk'], 'color_temp', 2700);
      jest.advanceTimersByTime(150);
      await flush();
      expect(callService).toHaveBeenCalledTimes(3);
    });

    it("steps a select with the server's own step, and treats back and forth as one run", async () => {
      services = { select: { select_next: {}, select_previous: {} } };
      const subject = put(entity('select.mode', 'b'));
      actions.run(subject, 'previous_option', 'a');
      actions.run(subject, 'next_option', 'c');
      jest.advanceTimersByTime(100);
      await flush();
      expect(callService).toHaveBeenCalledTimes(1);
      expect(callService).toHaveBeenCalledWith('select', 'select_next', {
        entity_id: 'select.mode',
      });
    });

    it('drops a cover position the slider has not sent when the cover is told to move', async () => {
      const subject = put(entity('cover.garage', 'open', { supported_features: 15 }));
      const position = actions.run(subject, 'position', 40);
      await actions.run(subject, 'close');
      jest.advanceTimersByTime(500);
      await expect(position).resolves.toMatchObject({ superseded: true });
      expect(callService).toHaveBeenCalledTimes(1);
      expect(callService).toHaveBeenCalledWith('cover', 'close_cover', {
        entity_id: 'cover.garage',
      });
    });

    it('drops a brightness the slider has not sent when the light is switched', async () => {
      const subject = put(entity('light.desk', 'on'));
      const brightness = actions.run(subject, 'brightness', 40);
      actions.run(subject, 'toggle');
      jest.advanceTimersByTime(500);
      await expect(brightness).resolves.toMatchObject({ superseded: true });
      expect(callService).toHaveBeenCalledTimes(1);
      expect(callService).toHaveBeenCalledWith('light', 'turn_off', { entity_id: 'light.desk' });
    });

    it('sends nothing when the entity went unavailable meanwhile', async () => {
      const subject = put(entity('light.desk', 'on'));
      const outcome = actions.run(subject, 'brightness', 40);
      put(entity('light.desk', 'unavailable'));
      jest.advanceTimersByTime(110);
      await expect(outcome).resolves.toEqual({ ok: false, sent: false });
      expect(callService).not.toHaveBeenCalled();
    });
  });

  describe('switching on and off', () => {
    const light = (state, attributes = {}) =>
      entity('light.desk', state, { friendly_name: 'Desk', brightness: 200, ...attributes });

    it('shows the state asked for at once, before Home Assistant answers', () => {
      put(light('on'));
      callService.mockImplementationOnce(() => new Promise(() => {}));
      actions.run(states['light.desk'], 'toggle');
      expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ state: 'off' }));
      expect(actions.view(states['light.desk']).state).toBe('off');
      // Other entities are drawn as they are.
      const other = entity('switch.plug', 'on');
      expect(actions.view(other)).toBe(other);
    });

    it.each([
      ['palette and hotkey turn on', 'turn_on', 'off', 'on', 'turn_on'],
      ['palette and hotkey turn off', 'turn_off', 'on', 'off', 'turn_off'],
      ['a click', 'toggle', 'on', 'off', 'turn_off'],
    ])('does so for %s', async (_label, action, from, shown, service) => {
      const subject = put(entity('humidifier.bedroom', from));
      const outcome = actions.run(subject, action);
      expect(actions.view(subject).state).toBe(shown);
      await expect(outcome).resolves.toMatchObject({ ok: true, sent: true });
      expect(callService).toHaveBeenCalledWith('humidifier', service, {
        entity_id: 'humidifier.bedroom',
      });
    });

    it('sends the final state of taps made while a call is out, once', async () => {
      let answer;
      callService.mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            answer = resolve;
          })
      );
      put(light('on'));
      const first = actions.run(states['light.desk'], 'toggle'); // off, sent
      const second = actions.run(states['light.desk'], 'toggle'); // on, waits
      expect(callService).toHaveBeenCalledTimes(1);
      expect(second).toBe(first);
      answer({});
      await expect(first).resolves.toMatchObject({ ok: true, sent: true });
      expect(callService).toHaveBeenCalledTimes(2);
      expect(callService).toHaveBeenNthCalledWith(1, 'light', 'turn_off', {
        entity_id: 'light.desk',
      });
      expect(callService).toHaveBeenNthCalledWith(2, 'light', 'turn_on', {
        entity_id: 'light.desk',
      });
    });

    it('sends no follow-up when the taps end where the first call left it', async () => {
      let answer;
      callService.mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            answer = resolve;
          })
      );
      put(light('on'));
      actions.run(states['light.desk'], 'toggle'); // off
      actions.run(states['light.desk'], 'toggle'); // on
      const last = actions.run(states['light.desk'], 'toggle'); // off again
      answer({});
      await last;
      expect(callService).toHaveBeenCalledTimes(1);
    });

    it('keeps a tap queued when the state arrives before its call is answered', async () => {
      let answer;
      callService.mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            answer = resolve;
          })
      );
      put(light('on'));
      const first = actions.run(states['light.desk'], 'toggle'); // off, sent
      put(light('off'));
      actions.observe(states['light.desk']);
      actions.run(states['light.desk'], 'toggle'); // on, waits for the first call
      expect(callService).toHaveBeenCalledTimes(1);
      answer({});
      await first;
      expect(callService).toHaveBeenNthCalledWith(2, 'light', 'turn_on', {
        entity_id: 'light.desk',
      });
    });

    it('keeps the asked-for state through older updates until Home Assistant reports it', async () => {
      put(light('on'));
      await actions.run(states['light.desk'], 'toggle');
      // Accepted, but an older update still says on.
      expect(actions.observe(light('on')).state).toBe('off');
      expect(actions.view(light('on')).state).toBe('off');
      // Home Assistant reports it off: nothing is pending any more.
      const confirmed = light('off');
      expect(actions.observe(confirmed)).toBe(confirmed);
      expect(actions.view(light('on')).state).toBe('on');
    });

    it('goes back to what Home Assistant said when it never confirms', async () => {
      put(light('on'));
      await actions.run(states['light.desk'], 'toggle');
      onChange.mockClear();
      jest.advanceTimersByTime(7999);
      expect(onChange).not.toHaveBeenCalled();
      jest.advanceTimersByTime(1);
      expect(onChange).toHaveBeenCalledWith(states['light.desk']);
      expect(actions.view(states['light.desk']).state).toBe('on');
    });

    it('puts the state back and reports it when the call fails', async () => {
      const error = new Error('network timeout');
      callService.mockRejectedValueOnce(error);
      put(light('on'));
      const outcome = await actions.run(states['light.desk'], 'toggle');
      expect(outcome).toEqual({ ok: false, sent: true, error });
      expect(onChange).toHaveBeenLastCalledWith(states['light.desk']);
      expect(onError).toHaveBeenCalledWith(error, states['light.desk']);
      expect(actions.view(states['light.desk']).state).toBe('on');
    });

    it('leaves the report to a caller that asks to, but still puts the state back', async () => {
      callService.mockRejectedValueOnce(new Error('nope'));
      put(light('on'));
      await actions.run(states['light.desk'], 'turn_off', undefined, { silent: true });
      expect(onError).not.toHaveBeenCalled();
      expect(actions.view(states['light.desk']).state).toBe('on');
    });

    it('ignores the failure of a call a later tap has already overruled', async () => {
      let fail;
      callService.mockImplementationOnce(
        () =>
          new Promise((resolve, reject) => {
            fail = reject;
          })
      );
      put(light('on'));
      const outcome = actions.run(states['light.desk'], 'toggle'); // off, fails
      actions.run(states['light.desk'], 'toggle'); // on
      fail(new Error('late'));
      await expect(outcome).resolves.toMatchObject({ ok: true, sent: true });
      expect(onError).not.toHaveBeenCalled();
      expect(callService).toHaveBeenLastCalledWith('light', 'turn_on', {
        entity_id: 'light.desk',
      });
    });

    it('shows a light turning back on at the brightness it had', () => {
      put(light('on', { brightness: 128 }));
      actions.view(states['light.desk']);
      put(entity('light.desk', 'off', {}));
      callService.mockImplementationOnce(() => new Promise(() => {}));
      actions.run(states['light.desk'], 'toggle');
      expect(actions.view(states['light.desk']).attributes.brightness).toBe(128);
    });

    it('drops what is pending when the entity goes unavailable', async () => {
      put(light('on'));
      await actions.run(states['light.desk'], 'toggle');
      actions.observe(light('unavailable'));
      expect(actions.view(light('on')).state).toBe('on');
    });

    it('forgets everything pending on reset, and what a call from before says', async () => {
      let answer;
      callService.mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            answer = resolve;
          })
      );
      put(light('on'));
      const outcome = actions.run(states['light.desk'], 'toggle');
      const brightness = actions.run(put(entity('light.hall', 'on')), 'brightness', 40);
      actions.reset();
      expect(actions.view(states['light.desk']).state).toBe('on');
      await expect(brightness).resolves.toMatchObject({ superseded: true });
      answer({});
      await outcome;
      jest.advanceTimersByTime(10000);
      expect(onChange).toHaveBeenCalledTimes(1);
      // A new tap after the reset starts afresh.
      await actions.run(states['light.desk'], 'toggle');
      expect(callService).toHaveBeenLastCalledWith('light', 'turn_off', {
        entity_id: 'light.desk',
      });
    });
  });
});

const {
  ALERT_POPUP_DURATIONS,
  ALERT_POPUP_SERVICES,
  DEFAULT_ALERT_POPUP_SECONDS,
  MAX_ALERT_POPUP_ACTIONS,
  fitsAlertPopups,
  getAlertPopupAction,
  getAlertPopupSize,
  isAlertPopupActionDomain,
  layoutAlertPopups,
  normalizeAlertPopupConfig,
  sanitizeAlertPopupRequest,
  suggestAlertPopupActions,
  suggestAlertPopupCamera,
} = require('../../src/alert-popup.cjs');

const entity = (entity_id, state, attributes = {}) => ({ entity_id, state, attributes });

describe('the button an entity gets on a pop-up card', () => {
  it('unlocks a locked door and locks an unlocked one', () => {
    expect(getAlertPopupAction(entity('lock.front_door', 'locked'))).toEqual({
      entityId: 'lock.front_door',
      domain: 'lock',
      service: 'unlock',
      label: 'Unlock',
    });
    expect(getAlertPopupAction(entity('lock.front_door', 'unlocked'))).toMatchObject({
      service: 'lock',
      label: 'Lock',
    });
  });

  it('offers nothing for a lock that wants a code, which a card has nowhere to type', () => {
    expect(getAlertPopupAction(entity('lock.safe', 'locked', { code_format: '^\\d{4}$' }))).toBe(
      null
    );
  });

  it('turns off what is on and on what is off', () => {
    expect(getAlertPopupAction(entity('light.porch', 'on'))).toMatchObject({
      service: 'turn_off',
      label: 'Turn off',
    });
    expect(getAlertPopupAction(entity('switch.kettle', 'off'))).toMatchObject({
      service: 'turn_on',
      label: 'Turn on',
    });
  });

  it('opens and closes a cover, with the action word for Open', () => {
    expect(getAlertPopupAction(entity('cover.garage', 'open'))).toMatchObject({
      service: 'close_cover',
      label: 'Close',
    });
    expect(getAlertPopupAction(entity('cover.garage', 'closed'))).toMatchObject({
      service: 'open_cover',
      label: 'Open',
      context: 'Action: Open',
    });
  });

  it('presses buttons, activates scenes and runs scripts', () => {
    expect(getAlertPopupAction(entity('button.chime', 'unknown'))).toBe(null);
    expect(getAlertPopupAction(entity('button.chime', '2026-11-23T10:00:00Z'))).toMatchObject({
      service: 'press',
    });
    expect(getAlertPopupAction(entity('scene.movie', 'scening'))).toMatchObject({
      service: 'turn_on',
      label: 'Activate',
    });
    expect(getAlertPopupAction(entity('script.chime', 'off'))).toMatchObject({
      service: 'turn_on',
      label: 'Run',
    });
  });

  it('pauses a player that plays, and offers nothing for one that is off', () => {
    expect(getAlertPopupAction(entity('media_player.tv', 'playing'))).toMatchObject({
      service: 'media_pause',
    });
    expect(getAlertPopupAction(entity('media_player.tv', 'paused'))).toMatchObject({
      service: 'media_play',
    });
    expect(getAlertPopupAction(entity('media_player.tv', 'off'))).toBe(null);
  });

  it('shuts a water valve that is open, and opens one that is shut', () => {
    expect(getAlertPopupAction(entity('valve.main_water', 'open'))).toMatchObject({
      service: 'close_valve',
      label: 'Close',
    });
    expect(getAlertPopupAction(entity('valve.main_water', 'closed'))).toMatchObject({
      service: 'open_valve',
      context: 'Action: Open',
    });
  });

  it('leaves out what a cover or valve says it cannot do', () => {
    // A garage door that only opens (feature 1, OPEN).
    expect(getAlertPopupAction(entity('cover.garage', 'open', { supported_features: 1 }))).toBe(
      null
    );
    expect(
      getAlertPopupAction(entity('cover.garage', 'closed', { supported_features: 1 }))
    ).toMatchObject({ service: 'open_cover' });
  });

  it('disarms a triggered or armed alarm, and arms one that is disarmed', () => {
    expect(getAlertPopupAction(entity('alarm_control_panel.home', 'triggered'))).toMatchObject({
      service: 'alarm_disarm',
      label: 'Disarm',
    });
    expect(getAlertPopupAction(entity('alarm_control_panel.home', 'armed_night'))).toMatchObject({
      service: 'alarm_disarm',
    });
    expect(getAlertPopupAction(entity('alarm_control_panel.home', 'disarmed'))).toMatchObject({
      service: 'alarm_arm_away',
      label: 'Arm',
    });
    expect(
      getAlertPopupAction(entity('alarm_control_panel.home', 'disarmed', { supported_features: 1 }))
    ).toBe(null);
  });

  it('offers nothing an alarm wants a code for', () => {
    const coded = { code_format: 'number' };
    expect(getAlertPopupAction(entity('alarm_control_panel.home', 'triggered', coded))).toBe(null);
    expect(getAlertPopupAction(entity('alarm_control_panel.home', 'disarmed', coded))).toBe(null);
    expect(
      getAlertPopupAction(
        entity('alarm_control_panel.home', 'disarmed', { ...coded, code_arm_required: false })
      )
    ).toMatchObject({ service: 'alarm_arm_away' });
  });

  it('turns heating, humidifiers, water heaters, remotes and automations on and off', () => {
    expect(getAlertPopupAction(entity('climate.living_room', 'heat'))).toMatchObject({
      service: 'turn_off',
    });
    expect(getAlertPopupAction(entity('climate.living_room', 'off'))).toMatchObject({
      service: 'turn_on',
    });
    // An older thermostat that cannot be turned off this way (no TURN_OFF, 128).
    expect(
      getAlertPopupAction(entity('climate.living_room', 'heat', { supported_features: 1 }))
    ).toBe(null);
    expect(getAlertPopupAction(entity('water_heater.tank', 'eco'))).toMatchObject({
      service: 'turn_off',
    });
    expect(getAlertPopupAction(entity('humidifier.bedroom', 'off'))).toMatchObject({
      service: 'turn_on',
    });
    expect(getAlertPopupAction(entity('remote.tv', 'on'))).toMatchObject({ service: 'turn_off' });
    expect(getAlertPopupAction(entity('automation.night', 'on'))).toMatchObject({
      service: 'turn_off',
    });
  });

  it('sends a vacuum or a mower home, or starts it', () => {
    expect(getAlertPopupAction(entity('vacuum.downstairs', 'cleaning'))).toMatchObject({
      service: 'return_to_base',
      label: 'Return',
    });
    expect(getAlertPopupAction(entity('vacuum.downstairs', 'docked'))).toMatchObject({
      service: 'start',
      label: 'Start',
    });
    expect(getAlertPopupAction(entity('lawn_mower.garden', 'mowing'))).toMatchObject({
      service: 'dock',
    });
    expect(getAlertPopupAction(entity('lawn_mower.garden', 'docked'))).toMatchObject({
      service: 'start_mowing',
    });
  });

  it('cancels a running timer, and starts or resumes one that is not', () => {
    expect(getAlertPopupAction(entity('timer.oven', 'active'))).toMatchObject({
      service: 'cancel',
      label: 'Cancel',
    });
    expect(getAlertPopupAction(entity('timer.oven', 'paused'))).toMatchObject({
      service: 'start',
      label: 'Resume',
    });
    expect(getAlertPopupAction(entity('timer.oven', 'idle'))).toMatchObject({ label: 'Start' });
  });

  it('turns off a player that is on but not playing', () => {
    expect(getAlertPopupAction(entity('media_player.tv', 'idle'))).toMatchObject({
      service: 'turn_off',
    });
  });

  it('offers only services the main process lets a card call', () => {
    const samples = [
      ['lock.a', 'locked'],
      ['cover.a', 'open'],
      ['valve.a', 'closed'],
      ['alarm_control_panel.a', 'triggered'],
      ['vacuum.a', 'cleaning'],
      ['lawn_mower.a', 'docked'],
      ['timer.a', 'active'],
      ['climate.a', 'cool'],
      ['water_heater.a', 'off'],
      ['media_player.a', 'on'],
      ['siren.a', 'on'],
    ];
    samples.forEach(([entityId, state]) => {
      const action = getAlertPopupAction(entity(entityId, state));
      expect(ALERT_POPUP_SERVICES[action.domain]).toContain(action.service);
    });
  });

  it('offers nothing for an entity that is offline, missing or of another kind', () => {
    expect(getAlertPopupAction(entity('light.porch', 'unavailable'))).toBe(null);
    expect(getAlertPopupAction(null)).toBe(null);
    expect(getAlertPopupAction(entity('sensor.temperature', '21'))).toBe(null);
    expect(isAlertPopupActionDomain('sensor')).toBe(false);
    expect(isAlertPopupActionDomain('lock')).toBe(true);
  });
});

describe("a rule's pop-up settings", () => {
  it('keeps what makes sense and drops the rest', () => {
    expect(
      normalizeAlertPopupConfig({
        enabled: true,
        camera: 'camera.front_door',
        actions: ['lock.front_door', 'lock.front_door', 'sensor.temperature', 'light.porch', 'x'],
        seconds: 60,
      })
    ).toEqual({
      enabled: true,
      camera: 'camera.front_door',
      actions: ['lock.front_door', 'light.porch'],
      seconds: 60,
    });
  });

  it('holds at most two buttons, a camera that is a camera and a time from the list', () => {
    const popup = normalizeAlertPopupConfig({
      enabled: 'yes',
      camera: 'light.porch',
      actions: ['light.a', 'light.b', 'light.c'],
      seconds: 45,
    });
    expect(popup.enabled).toBe(false);
    expect(popup.camera).toBe('');
    expect(popup.actions).toHaveLength(MAX_ALERT_POPUP_ACTIONS);
    expect(popup.seconds).toBe(DEFAULT_ALERT_POPUP_SECONDS);
    expect(ALERT_POPUP_DURATIONS).toContain(0);
  });

  it('is nothing for a rule saved before pop-ups existed', () => {
    expect(normalizeAlertPopupConfig(undefined)).toBe(null);
  });

  it('keeps a card that stays until it is closed', () => {
    expect(normalizeAlertPopupConfig({ enabled: true, seconds: 0 }).seconds).toBe(0);
  });
});

describe('the camera a new pop-up starts with', () => {
  const states = {
    'camera.front_door': {},
    'camera.back_garden': {},
    'camera.driveway_camera': {},
    'light.front_door': {},
  };

  it('is the entity itself when it is a camera', () => {
    expect(suggestAlertPopupCamera('camera.back_garden', states)).toBe('camera.back_garden');
  });

  it('is the camera at the same place as a doorbell or motion sensor', () => {
    expect(suggestAlertPopupCamera('binary_sensor.front_door_ding', states)).toBe(
      'camera.front_door'
    );
    expect(suggestAlertPopupCamera('binary_sensor.driveway_motion', states)).toBe(
      'camera.driveway_camera'
    );
  });

  it('is none when no camera is clearly there', () => {
    expect(suggestAlertPopupCamera('binary_sensor.front_yard_motion', states)).toBe('');
    expect(suggestAlertPopupCamera('binary_sensor.motion', states)).toBe('');
    expect(
      suggestAlertPopupCamera('binary_sensor.porch_motion', {
        'camera.porch_left': {},
        'camera.porch': {},
      })
    ).toBe('camera.porch');
  });

  it('is none when two cameras fit equally well', () => {
    expect(
      suggestAlertPopupCamera('binary_sensor.porch_motion', {
        'camera.porch': {},
        'camera.porch_cam': {},
      })
    ).toBe('');
  });
});

describe('the camera a new pop-up starts with, when names do not say', () => {
  it('is the only camera for a doorbell or motion sensor', () => {
    const states = {
      'camera.driveway': {},
      'binary_sensor.hallway_motion': { attributes: { device_class: 'motion' } },
      'event.doorbell': { attributes: { device_class: 'doorbell' } },
    };
    expect(suggestAlertPopupCamera('binary_sensor.hallway_motion', states)).toBe('camera.driveway');
    expect(suggestAlertPopupCamera('event.doorbell', states)).toBe('camera.driveway');
  });

  it('is none for a sensor that is not about someone being there, or with several cameras', () => {
    expect(
      suggestAlertPopupCamera('sensor.temperature', {
        'camera.driveway': {},
        'sensor.temperature': {},
      })
    ).toBe('');
    expect(
      suggestAlertPopupCamera('binary_sensor.hallway_motion', {
        'camera.driveway': {},
        'camera.garden': {},
      })
    ).toBe('');
  });
});

describe('the buttons a new pop-up starts with', () => {
  it("is the entity's own, then what is at the same place", () => {
    const states = {
      'cover.garage_door': {},
      'light.garage': {},
      'lock.front_door': {},
      'light.front_door': {},
      'light.porch': {},
    };
    expect(suggestAlertPopupActions('cover.garage_door', states)).toEqual([
      'cover.garage_door',
      'light.garage',
    ]);
    expect(suggestAlertPopupActions('binary_sensor.front_door_ding', states)).toEqual([
      'lock.front_door',
      'light.front_door',
    ]);
    expect(suggestAlertPopupActions('binary_sensor.garage_door_contact', states)).toEqual([
      'cover.garage_door',
      'light.garage',
    ]);
  });

  it("is the home's water valve for a leak sensor", () => {
    expect(
      suggestAlertPopupActions('binary_sensor.kitchen_sink_leak', {
        'binary_sensor.kitchen_sink_leak': { attributes: { device_class: 'moisture' } },
        'valve.main_water': {},
      })
    ).toEqual(['valve.main_water']);
    // Two valves and neither under the sink: no guess.
    expect(
      suggestAlertPopupActions('binary_sensor.kitchen_sink_leak', {
        'valve.main_water': {},
        'valve.garden': {},
      })
    ).toEqual([]);
  });

  it('is nothing for a sensor with nothing to act on', () => {
    expect(suggestAlertPopupActions('sensor.outdoor_temperature', { 'light.porch': {} })).toEqual(
      []
    );
    expect(suggestAlertPopupActions('not an entity', {})).toEqual([]);
  });

  it('never holds more than two', () => {
    expect(
      suggestAlertPopupActions('lock.front_door', {
        'cover.front_door': {},
        'light.front_door': {},
      })
    ).toEqual(['lock.front_door', 'cover.front_door']);
  });
});

describe('a request to open a pop-up', () => {
  const request = {
    entityId: 'binary_sensor.front_door_ding',
    title: 'Front Doorbell',
    message: 'Changed from Off to On',
    icon: { state: 'on', attributes: { icon: 'mdi:doorbell', friendly_name: 'secret', other: 1 } },
    camera: 'camera.front_door',
    actions: [
      {
        entityId: 'lock.front_door',
        domain: 'lock',
        service: 'unlock',
        label: 'Unlock',
        name: 'Front Door',
      },
    ],
    seconds: 30,
    at: 1700000000000,
  };

  it('passes on what the card shows', () => {
    expect(sanitizeAlertPopupRequest(request)).toEqual({
      entityId: 'binary_sensor.front_door_ding',
      title: 'Front Doorbell',
      message: 'Changed from Off to On',
      icon: {
        entity_id: 'binary_sensor.front_door_ding',
        state: 'on',
        attributes: { icon: 'mdi:doorbell' },
      },
      camera: 'camera.front_door',
      actions: [
        {
          entityId: 'lock.front_door',
          domain: 'lock',
          service: 'unlock',
          label: 'Unlock',
          name: 'Front Door',
        },
      ],
      seconds: 30,
      at: 1700000000000,
    });
  });

  it('drops buttons that would call anything but their own entity a card may call', () => {
    const { actions } = sanitizeAlertPopupRequest({
      ...request,
      actions: [
        { entityId: 'lock.front_door', domain: 'lock', service: 'open' },
        { entityId: 'lock.front_door', domain: 'light', service: 'turn_on' },
        { entityId: 'sensor.x', domain: 'sensor', service: 'turn_on' },
        { entityId: 'light.porch', domain: 'light', service: 'turn_off', label: 'Turn off' },
        { entityId: 'light.hall', domain: 'light', service: 'turn_off' },
        { entityId: 'light.attic', domain: 'light', service: 'turn_off' },
      ],
    });
    expect(actions.map((action) => action.entityId)).toEqual(['light.porch', 'light.hall']);
    expect(actions[1].label).toBe('turn_off');
  });

  it('passes on tile colours that are colours, and drops the rest', () => {
    const sanitized = sanitizeAlertPopupRequest({
      ...request,
      color: '#e57373',
      actions: [
        { ...request.actions[0], color: 'red; background: url(x)' },
        { entityId: 'light.porch', domain: 'light', service: 'turn_off', color: '#81C784' },
      ],
    });
    expect(sanitized.color).toBe('#E57373');
    expect(sanitized.actions[0]).not.toHaveProperty('color');
    expect(sanitized.actions[1].color).toBe('#81C784');
    expect(sanitizeAlertPopupRequest(request)).not.toHaveProperty('color');
  });

  it('is refused without an entity, and keeps text to one short line', () => {
    expect(sanitizeAlertPopupRequest({ title: 'x' })).toBe(null);
    expect(sanitizeAlertPopupRequest(null)).toBe(null);
    const long = sanitizeAlertPopupRequest({
      ...request,
      title: `A\n${'b'.repeat(500)}`,
      camera: 'not a camera',
      seconds: 'forever',
    });
    expect(long.title.startsWith('A b')).toBe(true);
    expect(Array.from(long.title)).toHaveLength(120);
    expect(long.camera).toBe('');
    expect(long.seconds).toBe(DEFAULT_ALERT_POPUP_SECONDS);
  });
});

describe('where pop-up cards go', () => {
  it('is taller with a camera and a row of buttons', () => {
    const plain = getAlertPopupSize({ camera: '', actions: [] });
    const full = getAlertPopupSize({ camera: 'camera.x', actions: [{}] });
    expect(full.width).toBe(plain.width);
    expect(full.height).toBeGreaterThan(plain.height + 150);
  });

  it('stacks them up from the bottom-right corner, newest at the bottom', () => {
    const workArea = { x: 1920, y: 0, width: 1920, height: 1040 };
    const placed = layoutAlertPopups(
      [
        { width: 340, height: 100 },
        { width: 340, height: 300 },
      ],
      workArea
    );
    expect(placed[1]).toEqual({
      x: 1920 + 1920 - 16 - 340,
      y: 1040 - 16 - 300,
      width: 340,
      height: 300,
    });
    expect(placed[0].y + placed[0].height).toBe(placed[1].y - 12);
    expect(placed[0].x).toBe(placed[1].x);
  });

  it('knows when a stack is taller than the screen', () => {
    const tall = { width: 340, height: 330 };
    expect(fitsAlertPopups([tall, tall], { x: 0, y: 0, width: 1366, height: 728 })).toBe(true);
    expect(fitsAlertPopups([tall, tall, tall], { x: 0, y: 0, width: 1366, height: 728 })).toBe(
      false
    );
    expect(fitsAlertPopups([tall], null)).toBe(true);
  });

  it('keeps a card that does not fit on the screen', () => {
    const placed = layoutAlertPopups([{ width: 340, height: 600 }], {
      x: 0,
      y: 40,
      width: 800,
      height: 400,
    });
    expect(placed[0].y).toBe(40);
  });
});

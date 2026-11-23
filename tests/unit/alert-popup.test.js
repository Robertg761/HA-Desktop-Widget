const {
  ALERT_POPUP_DURATIONS,
  DEFAULT_ALERT_POPUP_SECONDS,
  MAX_ALERT_POPUP_ACTIONS,
  getAlertPopupAction,
  getAlertPopupSize,
  isAlertPopupActionDomain,
  layoutAlertPopups,
  normalizeAlertPopupConfig,
  sanitizeAlertPopupRequest,
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

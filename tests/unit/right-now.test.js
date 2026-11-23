const {
  RIGHT_NOW_PAGE_ID,
  buildRightNowPage,
  classifyRightNowEntity,
  isRightNowPageEnabled,
  mergeLingeringIds,
} = require('../../src/right-now.js');

const NOW = Date.parse('2026-11-23T12:00:00Z');

function entity(entityId, stateValue, attributes = {}) {
  return { entity_id: entityId, state: stateValue, attributes };
}

function statesOf(...entities) {
  return Object.fromEntries(entities.map((item) => [item.entity_id, item]));
}

describe('Right now page', () => {
  it('is on until it is turned off', () => {
    expect(isRightNowPageEnabled({})).toBe(true);
    expect(isRightNowPageEnabled(null)).toBe(true);
    expect(isRightNowPageEnabled({ ui: { rightNowPage: true } })).toBe(true);
    expect(isRightNowPageEnabled({ ui: { rightNowPage: false } })).toBe(false);
  });

  it('has an id that is not a generated page id', () => {
    expect(RIGHT_NOW_PAGE_ID).toBe('right-now');
  });

  describe('classifyRightNowEntity', () => {
    it.each([
      [entity('light.desk', 'on'), 'on'],
      [entity('fan.ceiling', 'on'), 'on'],
      [entity('media_player.kitchen', 'playing'), 'media'],
      [entity('timer.pasta', 'active'), 'timers'],
      [entity('timer.pasta', 'paused'), 'timers'],
      [entity('binary_sensor.front_door', 'on', { device_class: 'door' }), 'open'],
      [entity('binary_sensor.bathroom_window', 'on', { device_class: 'window' }), 'open'],
      [entity('binary_sensor.garage', 'on', { device_class: 'garage_door' }), 'open'],
      [entity('cover.garage', 'open', { device_class: 'garage' }), 'open'],
      [entity('cover.gate', 'opening', { device_class: 'gate' }), 'open'],
      [entity('lock.front', 'unlocked'), 'unlocked'],
      [entity('lock.back', 'jammed'), 'unlocked'],
      [entity('sensor.remote_battery', '12', { device_class: 'battery' }), 'battery'],
      [
        entity('sensor.lock_battery', '20', { device_class: 'battery', unit_of_measurement: '%' }),
        'battery',
      ],
      [entity('binary_sensor.smoke_battery', 'on', { device_class: 'battery' }), 'battery'],
    ])('puts %o in %s', (item, group) => {
      expect(classifyRightNowEntity(item, { now: NOW })).toBe(group);
    });

    it.each([
      entity('light.desk', 'off'),
      entity('light.group', 'on', { entity_id: ['light.a', 'light.b'] }),
      entity('media_player.everywhere', 'playing', { entity_id: ['media_player.a'] }),
      entity('media_player.kitchen', 'paused'),
      entity('switch.fridge', 'on'),
      entity('timer.pasta', 'idle'),
      entity('binary_sensor.motion', 'on', { device_class: 'motion' }),
      entity('binary_sensor.front_door', 'off', { device_class: 'door' }),
      entity('cover.blinds', 'open', { device_class: 'blind' }),
      entity('cover.garage', 'closed', { device_class: 'garage' }),
      entity('lock.front', 'locked'),
      entity('sensor.remote_battery', '21', { device_class: 'battery' }),
      entity('sensor.remote_battery', 'unknown', { device_class: 'battery' }),
      entity('sensor.ups_battery', '5', { device_class: 'battery', unit_of_measurement: 'V' }),
      entity('binary_sensor.smoke_battery', 'off', { device_class: 'battery' }),
      entity('climate.hall', 'heat'),
    ])('leaves out %o', (item) => {
      expect(classifyRightNowEntity(item, { now: NOW })).toBeNull();
    });

    it('takes a timer sensor that still has time to run', () => {
      const running = entity('sensor.kitchen_timer', '2026-11-23T12:05:00Z');
      const finished = entity('sensor.kitchen_timer', '2026-11-23T11:55:00Z');
      const idle = entity('sensor.kitchen_timer', 'unknown');
      const viaAttribute = entity('sensor.oven', 'on', { finishes_at: '2026-11-23T12:30:00Z' });
      expect(classifyRightNowEntity(running, { now: NOW })).toBe('timers');
      expect(classifyRightNowEntity(finished, { now: NOW })).toBeNull();
      expect(classifyRightNowEntity(idle, { now: NOW })).toBeNull();
      expect(classifyRightNowEntity(viaAttribute, { now: NOW })).toBe('timers');
    });

    it('takes another battery threshold', () => {
      const battery = entity('sensor.remote_battery', '30', { device_class: 'battery' });
      expect(classifyRightNowEntity(battery, { now: NOW })).toBeNull();
      expect(classifyRightNowEntity(battery, { now: NOW, batteryThreshold: 30 })).toBe('battery');
    });
  });

  describe('buildRightNowPage', () => {
    it('lists the groups in order, each by name', () => {
      const states = statesOf(
        entity('sensor.remote_battery', '9', { device_class: 'battery', friendly_name: 'Remote' }),
        entity('binary_sensor.back_door', 'on', { device_class: 'door', friendly_name: 'Back' }),
        entity('light.zebra', 'on', { friendly_name: 'Zebra lamp' }),
        entity('light.alpha', 'on', { friendly_name: 'Alpha lamp' }),
        entity('media_player.tv', 'playing', { friendly_name: 'TV' }),
        entity('timer.tea', 'active', { friendly_name: 'Tea' }),
        entity('lock.front', 'unlocked', { friendly_name: 'Front' }),
        entity('switch.plug', 'unavailable', { friendly_name: 'Plug' }),
        entity('light.off', 'off')
      );
      const page = buildRightNowPage(states, null, { now: NOW });
      expect(page.entityIds).toEqual([
        'light.alpha',
        'light.zebra',
        'media_player.tv',
        'timer.tea',
        'binary_sensor.back_door',
        'lock.front',
        'sensor.remote_battery',
        'switch.plug',
      ]);
      expect(page.groups.on).toEqual(['light.alpha', 'light.zebra']);
      expect(page.groups.offline).toEqual(['switch.plug']);
    });

    it('names entities with the name it is given', () => {
      const states = statesOf(
        entity('light.a', 'on', { friendly_name: 'Zed' }),
        entity('light.b', 'on', { friendly_name: 'Bee' })
      );
      const names = { 'light.a': 'Aardvark', 'light.b': 'Bee' };
      const page = buildRightNowPage(states, null, {
        now: NOW,
        getName: (item) => names[item.entity_id],
      });
      expect(page.entityIds).toEqual(['light.a', 'light.b']);
    });

    it('is empty when nothing is on', () => {
      const page = buildRightNowPage(statesOf(entity('light.desk', 'off')), null, { now: NOW });
      expect(page.entityIds).toEqual([]);
      expect(Object.values(page.groups).every((ids) => ids.length === 0)).toBe(true);
    });

    it('leaves out hidden, disabled and device settings entities, but not batteries', () => {
      const states = statesOf(
        entity('light.hidden', 'on'),
        entity('light.disabled', 'on'),
        entity('light.indicator', 'on'),
        entity('sensor.lock_battery', '10', { device_class: 'battery' }),
        entity('light.kitchen', 'on')
      );
      const registry = {
        entities: [
          { entity_id: 'light.hidden', hidden_by: 'user' },
          { entity_id: 'light.disabled', disabled_by: 'integration' },
          { entity_id: 'light.indicator', entity_category: 'config', device_id: 'd1' },
          { entity_id: 'sensor.lock_battery', entity_category: 'diagnostic', device_id: 'd2' },
          { entity_id: 'light.kitchen', device_id: 'd3' },
        ],
      };
      const page = buildRightNowPage(states, registry, { now: NOW });
      expect(page.entityIds).toEqual(['light.kitchen', 'sensor.lock_battery']);
    });

    it('shows an offline device once, by the entity a person knows it by', () => {
      const states = statesOf(
        entity('sensor.plug_power', 'unavailable'),
        entity('switch.plug', 'unavailable'),
        entity('sensor.plug_rssi', 'unavailable'),
        entity('sensor.template_total', 'unavailable'),
        entity('update.plug_firmware', 'unavailable'),
        entity('light.porch', 'unavailable')
      );
      const registry = {
        entities: [
          { entity_id: 'sensor.plug_power', device_id: 'plug' },
          { entity_id: 'switch.plug', device_id: 'plug' },
          { entity_id: 'sensor.plug_rssi', device_id: 'plug', entity_category: 'diagnostic' },
          { entity_id: 'sensor.template_total' },
          { entity_id: 'update.plug_firmware', device_id: 'plug', entity_category: 'config' },
          { entity_id: 'light.porch', device_id: 'porch' },
        ],
      };
      const page = buildRightNowPage(states, registry, { now: NOW });
      expect(page.groups.offline.sort()).toEqual(['light.porch', 'switch.plug']);
    });

    it('works from states alone when the registry could not be read', () => {
      const states = statesOf(
        entity('switch.plug', 'unavailable'),
        entity('automation.night', 'unavailable'),
        entity('button.restart', 'unavailable')
      );
      expect(buildRightNowPage(states, null, { now: NOW }).groups.offline).toEqual(['switch.plug']);
      expect(buildRightNowPage(states, { entities: [] }, { now: NOW }).groups.offline).toEqual([
        'switch.plug',
      ]);
    });

    it('copes with no states', () => {
      expect(buildRightNowPage(undefined).entityIds).toEqual([]);
      expect(buildRightNowPage({ broken: null }).entityIds).toEqual([]);
    });
  });

  describe('mergeLingeringIds', () => {
    it('keeps a tile that just left in its place until its time is up', () => {
      const linger = new Map([['light.b', NOW + 5000]]);
      const merged = mergeLingeringIds(
        ['light.a', 'light.b', 'light.c'],
        ['light.a', 'light.c'],
        linger,
        NOW
      );
      expect(merged.entityIds).toEqual(['light.a', 'light.b', 'light.c']);
      expect(merged.nextExpiry).toBe(NOW + 5000);
    });

    it('lets it go once its time is up', () => {
      const linger = new Map([['light.b', NOW - 1]]);
      const merged = mergeLingeringIds(['light.a', 'light.b'], ['light.a'], linger, NOW);
      expect(merged.entityIds).toEqual(['light.a']);
      expect(merged.nextExpiry).toBeNull();
    });

    it('adds what is new and keeps what stays', () => {
      const merged = mergeLingeringIds(['light.a'], ['light.a', 'lock.front'], new Map(), NOW);
      expect(merged.entityIds).toEqual(['light.a', 'lock.front']);
    });
  });
});

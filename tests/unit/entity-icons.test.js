/**
 * @jest-environment jsdom
 */

const state = require('../../packages/widget-renderer/src/state');
const {
  LINE_ICONS,
  entityIconMarkup,
  getEntityIconDescriptor,
  getEntityLineIconName,
  lineIconMarkup,
  renderEntityIcon,
  setLineIconContent,
} = require('../../src/entity-icons');

jest.mock('../../packages/widget-renderer/src/state', () => ({
  CONFIG: null,
  setConfig: jest.fn(),
}));

const entity = (entityId, entityState = 'on', attributes = {}) => ({
  entity_id: entityId,
  state: entityState,
  attributes,
});

describe('entity line icons', () => {
  beforeAll(() => {
    const mdiStyles = document.createElement('style');
    mdiStyles.textContent = '.mdi-sofa::before { content: "\\F04B9"; }';
    document.head.appendChild(mdiStyles);
  });

  beforeEach(() => {
    state.CONFIG = null;
  });

  test('every icon has drawable elements', () => {
    for (const [name, elements] of Object.entries(LINE_ICONS)) {
      expect(Array.isArray(elements)).toBe(true);
      expect(elements.length).toBeGreaterThan(0);
      elements.forEach(([tagName, attributes]) => {
        expect(['path', 'circle', 'rect', 'line', 'polyline', 'polygon', 'ellipse']).toContain(
          tagName
        );
        expect(Object.keys(attributes).length).toBeGreaterThan(0);
      });
      expect(name).toMatch(/^[a-z0-9-]+$/);
    }
  });

  test('maps domains and states to line icons', () => {
    expect(getEntityLineIconName(entity('light.desk'))).toBe('lightbulb');
    expect(getEntityLineIconName(entity('switch.kettle', 'off'))).toBe('plug');
    expect(getEntityLineIconName(entity('lock.back', 'locked'))).toBe('lock');
    expect(getEntityLineIconName(entity('lock.back', 'unlocked'))).toBe('lock-open');
    expect(getEntityLineIconName(entity('climate.lounge', 'heat'))).toBe('flame');
    expect(getEntityLineIconName(entity('climate.lounge', 'cool'))).toBe('snowflake');
    expect(getEntityLineIconName(entity('cover.garage', 'open', { device_class: 'garage' }))).toBe(
      'warehouse'
    );
    expect(
      getEntityLineIconName(entity('binary_sensor.front', 'on', { device_class: 'door' }))
    ).toBe('door-open');
    expect(
      getEntityLineIconName(entity('binary_sensor.front', 'off', { device_class: 'door' }))
    ).toBe('door-closed');
    expect(
      getEntityLineIconName(entity('sensor.office', '21', { device_class: 'temperature' }))
    ).toBe('thermometer');
    expect(getEntityLineIconName(entity('sensor.oven_timer', '0:10:00'))).toBe('timer');
    expect(getEntityLineIconName(entity('made_up.thing'))).toBe('box');
    expect(getEntityLineIconName(null)).toBe('box');
  });

  test('every mapped name exists in the icon set', () => {
    const samples = [
      'light',
      'switch',
      'input_boolean',
      'fan',
      'sensor',
      'binary_sensor',
      'climate',
      'water_heater',
      'humidifier',
      'media_player',
      'scene',
      'script',
      'automation',
      'button',
      'input_button',
      'camera',
      'lock',
      'cover',
      'person',
      'device_tracker',
      'zone',
      'alarm_control_panel',
      'siren',
      'vacuum',
      'timer',
      'todo',
      'calendar',
      'weather',
      'sun',
      'input_number',
      'select',
      'text',
      'update',
      'remote',
      'valve',
    ];
    samples.forEach((domain) => {
      ['on', 'off', 'home', 'locked', 'heat'].forEach((entityState) => {
        const name = getEntityLineIconName(entity(`${domain}.sample`, entityState));
        expect(LINE_ICONS[name]).toBeDefined();
      });
    });
  });

  test("keeps a user's custom icon, then Home Assistant's icon, ahead of the line icon", () => {
    const sofa = entity('light.sofa', 'on', { icon: 'mdi:sofa' });
    expect(getEntityIconDescriptor(sofa)).toEqual({
      kind: 'mdi',
      glyph: String.fromCodePoint(0xf04b9),
    });

    state.CONFIG = { customEntityIcons: { 'light.sofa': '🛋️' } };
    expect(getEntityIconDescriptor(sofa)).toEqual({ kind: 'custom', glyph: '🛋️' });
    expect(getEntityIconDescriptor(sofa, { ignoreCustomIcon: true }).kind).toBe('mdi');

    expect(getEntityIconDescriptor(entity('light.desk'))).toEqual({
      kind: 'line',
      name: 'lightbulb',
    });
  });

  test('ignores a custom icon that is not a single glyph', () => {
    state.CONFIG = { customEntityIcons: { 'light.desk': 'lamp' } };
    expect(getEntityIconDescriptor(entity('light.desk')).kind).toBe('line');
  });

  test('renders a line icon and leaves it alone while nothing changes', () => {
    const container = document.createElement('div');
    renderEntityIcon(container, entity('light.desk'));
    const svg = container.querySelector('svg.entity-line-icon');
    expect(svg).not.toBeNull();
    expect(svg.dataset.icon).toBe('lightbulb');
    expect(svg.getAttribute('stroke')).toBe('currentColor');
    expect(svg.getAttribute('aria-hidden')).toBe('true');
    expect(container.dataset.iconKind).toBe('line');

    renderEntityIcon(container, entity('light.desk', 'off'));
    expect(container.querySelector('svg')).toBe(svg);

    state.CONFIG = { customEntityIcons: { 'light.desk': '🔥' } };
    renderEntityIcon(container, entity('light.desk'));
    expect(container.querySelector('svg')).toBeNull();
    expect(container.textContent).toBe('🔥');
    expect(container.dataset.iconKind).toBe('custom');
  });

  test('re-renders when the state changes the icon', () => {
    const container = document.createElement('div');
    renderEntityIcon(container, entity('lock.back', 'locked'));
    expect(container.querySelector('svg').dataset.icon).toBe('lock');
    renderEntityIcon(container, entity('lock.back', 'unlocked'));
    expect(container.querySelector('svg').dataset.icon).toBe('lock-open');
  });

  test('builds markup with escaped glyphs and a safe fallback name', () => {
    expect(lineIconMarkup('not-an-icon')).toContain('data-icon="box"');
    expect(entityIconMarkup(entity('light.desk'))).toContain('data-icon="lightbulb"');

    state.CONFIG = { customEntityIcons: { 'light.desk': '<' } };
    expect(entityIconMarkup(entity('light.desk'))).toBe('&lt;');

    const host = document.createElement('div');
    host.innerHTML = lineIconMarkup('sparkles');
    const parsed = host.querySelector('svg');
    expect(parsed.getAttribute('viewBox')).toBe('0 0 24 24');
    expect(parsed.children.length).toBe(LINE_ICONS.sparkles.length);
  });

  test('sets a chrome button icon', () => {
    const button = document.createElement('button');
    button.textContent = '⋮⋮';
    setLineIconContent(button, 'grip-vertical');
    expect(button.textContent).toBe('');
    expect(button.querySelector('svg').dataset.icon).toBe('grip-vertical');
    expect(setLineIconContent(null, 'plus')).toBeNull();
  });

  describe('locks and alarm panels', () => {
    test('draws the window as a framed four-pane window on a sill, and the open one with a sash swung out', () => {
      const parts = (name) =>
        LINE_ICONS[name].map(([tag, attributes]) => [tag, attributes.d || '']);
      const closed = parts('window-closed');
      const open = parts('window-open');
      // The frame and the sill are shared, so the two read as one window in two states.
      const sill = ['path', 'M2 21h20'];
      expect(closed).toContainEqual(sill);
      expect(open).toContainEqual(sill);
      expect(closed.filter(([tag]) => tag === 'rect')).toHaveLength(1);
      // Shut: a mullion and a transom cut the frame into four. Open: the sash is a slanted shape
      // (it has diagonal edges, which a pane in the frame has not), and only the right pane keeps
      // its transom.
      expect(closed).toContainEqual(['path', 'M12 3v15']);
      expect(closed).toContainEqual(['path', 'M4 10.5h16']);
      expect(open.some(([, d]) => /^m12 3-6 2v11l6 2$/.test(d))).toBe(true);
      expect(open).toContainEqual(['path', 'M12 10.5h8']);
      expect(open).not.toContainEqual(['path', 'M4 10.5h16']);
    });

    test.each([
      ['locked', 'lock'],
      ['locking', 'lock'],
      ['unlocked', 'lock-open'],
      ['unlocking', 'lock-open'],
      ['open', 'lock-open'],
      ['jammed', 'lock-alert'],
      ['unavailable', 'lock'],
    ])('draws a lock that is %s as %s', (value, icon) => {
      expect(getEntityLineIconName(entity('lock.back', value))).toBe(icon);
    });

    test.each([
      ['disarmed', 'shield-off'],
      ['armed_home', 'shield-check'],
      ['armed_away', 'shield-check'],
      ['armed_night', 'shield-check'],
      ['armed_vacation', 'shield-check'],
      ['arming', 'shield'],
      ['pending', 'shield'],
      ['triggered', 'shield-alert'],
    ])('draws an alarm panel that is %s as %s', (value, icon) => {
      expect(getEntityLineIconName(entity('alarm_control_panel.home', value))).toBe(icon);
    });
  });

  describe('sensors', () => {
    const sensorIcon = (id, attributes = {}, value = '1') =>
      getEntityLineIconName(entity(id, value, attributes));

    test.each([
      'sensor.template_x',
      'sensor.edf_tempo_rouge',
      'sensor.login_attempts',
      'sensor.contemplate',
    ])('does not take %s for a thermometer because its id contains "temp"', (id) => {
      expect(sensorIcon(id)).toBe('activity');
    });

    test.each([
      'sensor.temp',
      'sensor.office_temp',
      'sensor.temp_outside',
      'sensor.temperature',
      'sensor.office_temperature_2',
      'sensor.bathroom.temp',
    ])('still takes %s for a thermometer', (id) => {
      expect(sensorIcon(id)).toBe('thermometer');
    });

    test('does not take a number with a duration attribute for a timer', () => {
      expect(sensorIcon('sensor.commute', { duration: '0:23:00' }, '23')).toBe('activity');
      // A countdown still is one: it says when it ends, or is named for it.
      expect(sensorIcon('sensor.oven', { finishes_at: '2026-10-04T10:00:00Z' })).toBe('timer');
      expect(sensorIcon('sensor.kitchen_timer_1')).toBe('timer');
    });

    test.each([
      ['timestamp', 'clock'],
      ['date', 'clock'],
      ['duration', 'clock'],
      ['aqi', 'wind'],
      ['pm25', 'wind'],
      ['co2', 'wind'],
      ['distance', 'ruler'],
      ['speed', 'gauge'],
      ['signal_strength', 'signal'],
      ['water', 'droplet'],
      ['gas', 'droplet'],
      ['apparent_power', 'zap'],
    ])('draws a %s sensor as %s', (deviceClass, icon) => {
      expect(sensorIcon('sensor.x', { device_class: deviceClass })).toBe(icon);
    });

    test.each([
      ['5', 'battery-low'],
      ['20', 'battery-low'],
      ['21', 'battery-medium'],
      ['60', 'battery-medium'],
      ['61', 'battery-full'],
      ['100', 'battery-full'],
      ['unknown', 'battery'],
      ['unavailable', 'battery'],
    ])('draws a battery at %s as %s', (value, icon) => {
      expect(sensorIcon('sensor.phone', { device_class: 'battery' }, value)).toBe(icon);
    });
  });

  describe('binary sensors, covers and other domains', () => {
    test('draws a window as a window, open or closed, not a software window', () => {
      expect(
        getEntityLineIconName(entity('binary_sensor.w', 'on', { device_class: 'window' }))
      ).toBe('window-open');
      expect(
        getEntityLineIconName(entity('binary_sensor.w', 'off', { device_class: 'window' }))
      ).toBe('window-closed');
      expect(getEntityLineIconName(entity('cover.w', 'open', { device_class: 'window' }))).toBe(
        'window-open'
      );
      expect(getEntityLineIconName(entity('cover.w', 'closed', { device_class: 'window' }))).toBe(
        'window-closed'
      );
    });

    test.each([
      ['connectivity', 'on', 'wifi'],
      ['connectivity', 'off', 'wifi-off'],
      ['problem', 'on', 'shield-alert'],
      ['problem', 'off', 'shield-check'],
      ['safety', 'on', 'shield-alert'],
      ['running', 'on', 'play'],
      ['gas', 'on', 'flame'],
    ])('draws a %s binary sensor that is %s as %s', (deviceClass, value, icon) => {
      expect(
        getEntityLineIconName(entity('binary_sensor.x', value, { device_class: deviceClass }))
      ).toBe(icon);
    });

    test.each([
      ['input_datetime.alarm', 'calendar-clock'],
      ['schedule.heating', 'calendar-clock'],
      ['counter.visits', 'hash'],
      ['lawn_mower.robot', 'bot'],
      ['event.doorbell', 'bell'],
    ])('draws %s as %s, not the generic box', (id, icon) => {
      expect(getEntityLineIconName(entity(id))).toBe(icon);
    });

    test('has the glyphs the dialogs use: a square to stop and a distinct heat/cool', () => {
      expect(LINE_ICONS.square).toBeDefined();
      expect(LINE_ICONS['thermometer-sun']).toBeDefined();
    });
  });
});

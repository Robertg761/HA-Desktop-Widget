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
});

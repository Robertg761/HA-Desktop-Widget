jest.mock('../../src/ui.js', () => ({
  openEntityDetailModal: jest.fn(),
  switchQuickAccessPage: jest.fn(async () => ({ success: true })),
  requestAlarmCode: jest.fn(async () => null),
  getEntityDomain: (entityId) => String(entityId || '').split('.')[0],
}));
jest.mock('../../src/websocket.js', () => ({
  __esModule: true,
  default: { isConnected: jest.fn(() => true), callService: jest.fn(async () => ({})) },
}));

const { openCommandPalette } = require('../../src/command-palette.js');
const state = require('../../src/state.js').default;
const { loadAppStylesheets, resolvedValue } = require('../helpers/css-cascade.js');

describe('command palette rows for entities Home Assistant cannot reach', () => {
  const originalRequestAnimationFrame = global.requestAnimationFrame;
  const originalScrollIntoView = HTMLElement.prototype.scrollIntoView;

  beforeAll(() => {
    loadAppStylesheets(document);
    global.requestAnimationFrame = (callback) => callback();
    HTMLElement.prototype.scrollIntoView = jest.fn();
  });

  afterAll(() => {
    global.requestAnimationFrame = originalRequestAnimationFrame;
    HTMLElement.prototype.scrollIntoView = originalScrollIntoView;
  });

  const rowFor = (name) =>
    [...document.querySelectorAll('.command-palette-result')].find(
      (row) => row.querySelector('.command-palette-result-name').textContent === name
    );

  it('marks an unavailable entity and dims it as its tile is dimmed', () => {
    state.setStates({
      'fan.bedroom': {
        entity_id: 'fan.bedroom',
        state: 'unavailable',
        attributes: { friendly_name: 'Bedroom fan' },
      },
      'light.kitchen': {
        entity_id: 'light.kitchen',
        state: 'on',
        attributes: { friendly_name: 'Kitchen Light' },
      },
    });
    openCommandPalette();

    const dead = rowFor('Bedroom fan');
    const alive = rowFor('Kitchen Light');
    expect(dead.classList.contains('is-unavailable')).toBe(true);
    expect(alive.classList.contains('is-unavailable')).toBe(false);
    // The name is dimmed by colour, so it stays readable, and the icon by opacity.
    expect(resolvedValue(dead.querySelector('.command-palette-result-name'), 'color')).not.toBe(
      resolvedValue(alive.querySelector('.command-palette-result-name'), 'color')
    );
    expect(resolvedValue(dead.querySelector('.command-palette-result-icon'), 'opacity')).toBe(
      '0.55'
    );
    expect(
      resolvedValue(alive.querySelector('.command-palette-result-icon'), 'opacity')
    ).toBeNull();
  });
});

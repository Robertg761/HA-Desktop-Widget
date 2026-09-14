jest.mock('../../src/ui.js', () => ({
  openEntityDetailModal: jest.fn(),
  getEntityDomain: (entityId) => String(entityId || '').split('.')[0],
}));

const {
  buildPaletteCommands,
  openCommandPalette,
  rankCommandPaletteEntities,
  scoreCommandPaletteMatch,
} = require('../../src/command-palette.js');
const state = require('../../src/state.js').default;
const { openEntityDetailModal } = require('../../src/ui.js');

describe('command palette fuzzy scoring', () => {
  it('offers explicit supported actions and page commands, omitting unavailable devices', () => {
    const commands = buildPaletteCommands(
      [
        { entity_id: 'light.office', state: 'on', attributes: { friendly_name: 'Office lights' } },
        { entity_id: 'light.hall', state: 'off', attributes: { friendly_name: 'Hall lights' } },
        { entity_id: 'fan.attic', state: 'auto', attributes: { friendly_name: 'Attic fan' } },
        { entity_id: 'scene.bedtime', state: 'ready', attributes: { friendly_name: 'Bedtime' } },
        { entity_id: 'light.offline', state: 'unavailable', attributes: {} },
        { entity_id: 'switch.unsupported', state: 'off', attributes: {} },
      ],
      { customTabs: [{ id: 'office', name: 'Office' }] },
      {
        light: { turn_on: {}, turn_off: {} },
        fan: { turn_on: {}, turn_off: {} },
        scene: { turn_on: {} },
      }
    );
    // Devices only get the action that changes their state; unknown states get both.
    expect(commands.map((command) => command.key)).toEqual([
      'light.office:turn_off',
      'light.hall:turn_on',
      'fan.attic:turn_on',
      'fan.attic:turn_off',
      'scene.bedtime:turn_on',
      'page:office',
    ]);
    expect(commands[0].displayName).toBe('Turn off Office lights');
    expect(commands[1].displayName).toBe('Turn on Hall lights');
    expect(commands[4].displayName).toBe('Run Bedtime');
  });
  it('scores exact, prefix, substring, and subsequence matches in descending tiers', () => {
    const exact = scoreCommandPaletteMatch('Kitchen Light', 'Kitchen Light');
    const prefix = scoreCommandPaletteMatch('Kitchen Light', 'Kitchen');
    const substring = scoreCommandPaletteMatch('Kitchen Light', 'Light');
    const subsequence = scoreCommandPaletteMatch('Kitchen Light', 'ktn');

    expect(exact).toBeGreaterThan(prefix);
    expect(prefix).toBeGreaterThan(substring);
    expect(substring).toBeGreaterThan(subsequence);
    expect(subsequence).toBeGreaterThan(0);
  });

  it('returns zero for no-match queries', () => {
    expect(scoreCommandPaletteMatch('Kitchen Light', 'garage')).toBe(0);
  });

  it('matches Unicode names and accent-insensitive queries without collapsing them to empty', () => {
    expect(scoreCommandPaletteMatch('Lámpara Cocina', 'lampara')).toBeGreaterThan(0);
    expect(scoreCommandPaletteMatch('客厅灯', '客厅')).toBeGreaterThan(0);
    expect(scoreCommandPaletteMatch('مصباح المطبخ', 'المطبخ')).toBeGreaterThan(0);
    expect(scoreCommandPaletteMatch('Kitchen Light', '!!!')).toBe(0);
  });

  it('ranks entities by display name and entity id matches', () => {
    const entities = [
      {
        entity_id: 'sensor.outdoor_temperature',
        state: '22',
        attributes: { friendly_name: 'Outside Temp' },
      },
      { entity_id: 'light.kitchen', state: 'on', attributes: { friendly_name: 'Kitchen Light' } },
      { entity_id: 'switch.kettle', state: 'off', attributes: { friendly_name: 'Kettle' } },
    ];

    const ranked = rankCommandPaletteEntities(entities, 'kitchen', {
      getDisplayName: (entity) => entity.attributes.friendly_name,
    });

    expect(ranked.map((item) => item.entity.entity_id)).toEqual(['light.kitchen']);
  });

  it('keeps Tab focus inside the palette and restores its launcher before opening details', () => {
    const originalRequestAnimationFrame = global.requestAnimationFrame;
    const originalScrollIntoView = HTMLElement.prototype.scrollIntoView;
    global.requestAnimationFrame = (callback) => callback();
    HTMLElement.prototype.scrollIntoView = jest.fn();

    try {
      document.body.innerHTML = '<button id="palette-launcher">Open entities</button>';
      state.setStates({
        'light.kitchen': {
          entity_id: 'light.kitchen',
          state: 'on',
          attributes: { friendly_name: 'Kitchen Light' },
        },
        'switch.kettle': {
          entity_id: 'switch.kettle',
          state: 'off',
          attributes: { friendly_name: 'Kettle' },
        },
      });
      openEntityDetailModal.mockClear();

      const launcher = document.getElementById('palette-launcher');
      launcher.focus();
      openCommandPalette();

      const input = document.querySelector('.command-palette-input');
      const resultRows = document.querySelectorAll('.command-palette-result');
      const lastResult = resultRows[resultRows.length - 1];
      expect(document.activeElement).toBe(input);

      input.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Tab', shiftKey: true, bubbles: true })
      );
      expect(document.activeElement).toBe(lastResult);

      lastResult.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true }));
      expect(document.activeElement).toBe(input);

      input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
      expect(document.activeElement).toBe(launcher);
      expect(openEntityDetailModal).toHaveBeenCalledWith(
        expect.objectContaining({ entity_id: expect.any(String) }),
        { source: 'command-palette' }
      );
    } finally {
      global.requestAnimationFrame = originalRequestAnimationFrame;
      HTMLElement.prototype.scrollIntoView = originalScrollIntoView;
    }
  });
});

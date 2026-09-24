jest.mock('../../src/ui.js', () => ({
  openEntityDetailModal: jest.fn(),
  switchQuickAccessPage: jest.fn(async () => ({ success: true })),
  getEntityDomain: (entityId) => String(entityId || '').split('.')[0],
}));
jest.mock('../../src/websocket.js', () => ({
  __esModule: true,
  default: { isConnected: jest.fn(() => true), callService: jest.fn(async () => ({})) },
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
      {
        customTabs: [
          { id: 'default', name: 'All' },
          { id: 'office', name: 'Office' },
        ],
        activeTabId: 'default',
      },
      {
        light: { turn_on: {}, turn_off: {} },
        fan: { turn_on: {}, turn_off: {} },
        scene: { turn_on: {} },
      }
    );
    // Devices only get the action that changes their state; unknown states get both. The page
    // already on screen is not offered as a switch target.
    expect(commands.map((command) => [command.key, command.service || null])).toEqual([
      ['light.office', 'turn_off'],
      ['light.hall', 'turn_on'],
      ['fan.attic', 'turn_on'],
      ['fan.attic', 'turn_off'],
      ['scene.bedtime', 'turn_on'],
      ['page:office', null],
    ]);
    expect(commands[0].displayName).toBe('Turn off Office lights');
    expect(commands[1].displayName).toBe('Turn on Hall lights');
    expect(commands[4].displayName).toBe('Run Bedtime');
  });
  it('offers only the lock command that changes a lock, and nothing for jammed locks', () => {
    const commands = buildPaletteCommands(
      [
        { entity_id: 'lock.front', state: 'locked', attributes: { friendly_name: 'Front door' } },
        { entity_id: 'lock.back', state: 'unlocked', attributes: { friendly_name: 'Back door' } },
        { entity_id: 'lock.shed', state: 'jammed', attributes: { friendly_name: 'Shed' } },
      ],
      { customTabs: [] },
      { lock: { lock: {}, unlock: {} } }
    );
    expect(commands.map((command) => [command.key, command.service, command.displayName])).toEqual([
      ['lock.front', 'unlock', 'Unlock Front door'],
      ['lock.back', 'lock', 'Lock Back door'],
    ]);
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

describe('command palette over another dialog', () => {
  it('closes itself, not the dialog under it, on Escape with focus on the page', () => {
    const originalRequestAnimationFrame = global.requestAnimationFrame;
    global.requestAnimationFrame = (callback) => callback();
    let palette;
    let uiUtils;
    jest.isolateModules(() => {
      palette = require('../../src/command-palette.js');
      uiUtils = require('../../src/ui-utils.js');
    });
    const settings = document.createElement('div');
    settings.className = 'modal';
    settings.innerHTML = '<div class="modal-content"><button>Save</button></div>';
    document.body.appendChild(settings);
    const settingsEscape = jest.fn();
    settings.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') settingsEscape();
    });

    try {
      document.activeElement?.blur();
      uiUtils.trapFocus(settings, { initialFocus: false });
      palette.openCommandPalette();
      const overlay = document.querySelector('.command-palette-overlay:not(.hidden)');
      expect(overlay).toBeTruthy();
      // A click on the palette's empty space leaves focus on <body>.
      document.activeElement.blur();
      document.body.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })
      );

      expect(overlay.classList).toContain('hidden');
      expect(settingsEscape).not.toHaveBeenCalled();

      document.body.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })
      );
      expect(settingsEscape).toHaveBeenCalledTimes(1);
    } finally {
      global.requestAnimationFrame = originalRequestAnimationFrame;
      uiUtils.releaseFocusTrap(settings);
      document.querySelectorAll('.command-palette-overlay').forEach((node) => node.remove());
      settings.remove();
    }
  });
});

describe('command palette recents', () => {
  const originalRequestAnimationFrame = global.requestAnimationFrame;
  const originalScrollIntoView = HTMLElement.prototype.scrollIntoView;
  const bedLight = (lightState) => ({
    entity_id: 'light.bed_light',
    state: lightState,
    attributes: { friendly_name: 'Bed Light' },
  });
  const resultNames = () =>
    [...document.querySelectorAll('.command-palette-result-name')].map((row) => row.textContent);
  const run = async (name) => {
    const row = [...document.querySelectorAll('.command-palette-result')].find(
      (candidate) => candidate.querySelector('.command-palette-result-name').textContent === name
    );
    row.click();
    await new Promise((resolve) => setTimeout(resolve, 0));
  };

  beforeEach(() => {
    global.requestAnimationFrame = (callback) => callback();
    HTMLElement.prototype.scrollIntoView = jest.fn();
    localStorage.clear();
    document.body.innerHTML = '';
    jest.resetModules();
  });
  afterEach(() => {
    global.requestAnimationFrame = originalRequestAnimationFrame;
    HTMLElement.prototype.scrollIntoView = originalScrollIntoView;
    document.body.innerHTML = '';
  });

  const load = () => {
    const palette = require('../../src/command-palette.js');
    const paletteState = require('../../src/state.js').default;
    paletteState.setConfig({
      homeAssistant: { url: 'http://ha.local:8123', token: 'secret-token' },
      customTabs: [
        { id: 'default', name: 'All', entityIds: [] },
        { id: 'kitchen', name: 'Kitchen', entityIds: [] },
      ],
      activeTabId: 'default',
    });
    paletteState.setServices({ light: { turn_on: {}, turn_off: {} } });
    return { palette, paletteState };
  };

  it('ranks the device used last first, whichever action it now offers, and persists it', async () => {
    let { palette, paletteState } = load();
    paletteState.setStates({ 'light.bed_light': bedLight('off') });
    palette.openCommandPalette();
    expect(document.querySelector('.command-palette-input').placeholder).toBe(
      'Search entities, commands, and pages'
    );
    await run('Switch to Kitchen');
    palette.closeCommandPalette();

    paletteState.setStates({ 'light.bed_light': bedLight('off') });
    palette.openCommandPalette();
    await run('Turn on Bed Light');

    paletteState.setStates({ 'light.bed_light': bedLight('on') });
    palette.openCommandPalette();
    expect(resultNames()[0]).toBe('Turn off Bed Light');
    expect(resultNames()[1]).toBe('Switch to Kitchen');

    // Recents survive a restart without storing anything but ids.
    document.body.innerHTML = '';
    jest.resetModules();
    ({ palette, paletteState } = load());
    paletteState.setStates({ 'light.bed_light': bedLight('on') });
    palette.openCommandPalette();
    expect(resultNames().slice(0, 2)).toEqual(['Turn off Bed Light', 'Switch to Kitchen']);
    const stored = Object.keys(localStorage).map((key) => localStorage.getItem(key));
    expect(stored).toEqual([JSON.stringify(['light.bed_light', 'page:kitchen'])]);
    expect(stored.join()).not.toContain('secret');
  });

  it('shows commands, labels, and entity states in the active language', () => {
    const { palette, paletteState } = load();
    const i18n = require('../../src/i18n.js');
    try {
      i18n.setLocaleBootstrap({
        activeLocale: 'de',
        messages: {
          'Turn off {{name}}': '{{name}} ausschalten',
          'Switch to {{name}}': 'Zu {{name}} wechseln',
          'Search entities, commands, and pages': 'Entitäten, Befehle und Seiten suchen',
          'Close command palette': 'Befehlspalette schließen',
          On: 'An',
          'Domain: Light': 'Licht',
        },
      });
      paletteState.setStates({ 'light.bed_light': bedLight('on') });
      palette.openCommandPalette();

      expect(resultNames()).toEqual(
        expect.arrayContaining(['Bed Light ausschalten', 'Zu Kitchen wechseln'])
      );
      const input = document.querySelector('.command-palette-input');
      expect(input.placeholder).toBe('Entitäten, Befehle und Seiten suchen');
      expect(document.querySelector('.command-palette-close').getAttribute('aria-label')).toBe(
        'Befehlspalette schließen'
      );
      const states = [...document.querySelectorAll('.command-palette-result-state')].map(
        (element) => element.textContent
      );
      expect(states).toContain('An');
      const types = [...document.querySelectorAll('.command-palette-result-domain')].map(
        (element) => element.textContent
      );
      expect(types).toContain('Licht');

      // The shell is reused, so a language change must reach it on the next open.
      palette.closeCommandPalette();
      i18n.setLocaleBootstrap({ activeLocale: 'en', messages: {} });
      palette.openCommandPalette();
      expect(input.placeholder).toBe('Search entities, commands, and pages');
    } finally {
      i18n.setLocaleBootstrap({ activeLocale: 'en', messages: {} });
    }
  });

  it('does not offer switching to the page already on screen', () => {
    const { palette, paletteState } = load();
    paletteState.setStates({});
    palette.openCommandPalette();
    expect(resultNames()).toEqual(['Switch to Kitchen']);
  });

  it('points out the shortcut under the Manage Quick Access search field', () => {
    const html = require('fs').readFileSync(require('path').join(__dirname, '../../index.html'));
    document.documentElement.innerHTML = String(html);
    const search = document.getElementById('quick-controls-search');
    const hint = document.getElementById(search.getAttribute('aria-describedby'));
    expect(search.nextElementSibling).toBe(hint);
    expect(hint.textContent.trim()).toBe(hint.dataset.i18n);
    expect(hint.textContent).toContain('Ctrl+K');
  });
});

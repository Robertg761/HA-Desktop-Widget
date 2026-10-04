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
  it('offers only supported alarm modes and skips the mode already armed', () => {
    const commands = buildPaletteCommands(
      [
        {
          entity_id: 'alarm_control_panel.home',
          state: 'armed_home',
          attributes: { friendly_name: 'Home', supported_features: 3 },
        },
      ],
      { customTabs: [] },
      {
        alarm_control_panel: {
          alarm_arm_home: {},
          alarm_arm_away: {},
          alarm_arm_night: {},
          alarm_disarm: {},
        },
      }
    );
    expect(commands.map((item) => item.service)).toEqual(['alarm_arm_away', 'alarm_disarm']);
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
      const close = document.querySelector('.command-palette-close');
      const resultRows = document.querySelectorAll('.command-palette-result');
      expect(document.activeElement).toBe(input);
      // The rows are reached with the arrows, not Tab: twenty Tab stops would stand between the
      // search field and the Close button.
      resultRows.forEach((row) => expect(row.tabIndex).toBe(-1));

      input.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Tab', shiftKey: true, bubbles: true })
      );
      expect(document.activeElement).toBe(close);

      close.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true }));
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

    try {
      document.activeElement?.blur();
      uiUtils.openDialog(settings, { initialFocus: false, dismiss: settingsEscape });
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
      uiUtils.closeDialog(settings, { remove: true });
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

  describe('keeping the highlight where the keyboard put it', () => {
    const highlightedName = () =>
      document.querySelector('.command-palette-result.highlighted .command-palette-result-name')
        ?.textContent;
    const pointerAt = (row, x, y) =>
      row.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, screenX: x, screenY: y }));

    it('ignores rows that render under a pointer that has not moved', () => {
      const { palette, paletteState } = load();
      paletteState.setStates({
        'light.bed_light': bedLight('off'),
        'light.desk': { entity_id: 'light.desk', state: 'off', attributes: {} },
      });
      palette.openCommandPalette();
      const input = document.querySelector('.command-palette-input');
      input.value = 'turn on';
      input.dispatchEvent(new Event('input'));
      const first = highlightedName();
      const rows = () => document.querySelectorAll('.command-palette-result');

      // A still pointer over the second row, reported again after every re-render.
      pointerAt(rows()[1], 40, 40);
      expect(highlightedName()).toBe(first);
      input.value = 'turn on ';
      input.dispatchEvent(new Event('input'));
      pointerAt(rows()[1], 40, 40);
      expect(highlightedName()).toBe(first);

      // A real move does take the highlight.
      pointerAt(rows()[1], 44, 41);
      expect(highlightedName()).not.toBe(first);
      expect(rows()[1].classList).toContain('highlighted');
    });
  });

  describe('keyboard and focus', () => {
    const press = (target, key, init = {}) => {
      const event = new KeyboardEvent('keydown', {
        key,
        bubbles: true,
        cancelable: true,
        ...init,
      });
      target.dispatchEvent(event);
      return event;
    };
    const lampStates = (paletteState) =>
      paletteState.setStates({
        'light.bed_light': bedLight('off'),
        'light.desk': { entity_id: 'light.desk', state: 'off', attributes: {} },
      });
    const overlay = () => document.querySelector('.command-palette-overlay');

    it('is a named dialog, whose rows are not Tab stops', () => {
      const { palette, paletteState } = load();
      lampStates(paletteState);
      palette.openCommandPalette();

      expect(overlay().getAttribute('role')).toBe('dialog');
      expect(overlay().getAttribute('aria-modal')).toBe('true');
      expect(overlay().getAttribute('aria-label')).toBe('Command palette');
      // The panel inside it is not a second dialog.
      expect(overlay().querySelector('.command-palette-panel').hasAttribute('role')).toBe(false);
      const rows = [...document.querySelectorAll('.command-palette-result')];
      expect(rows.length).toBeGreaterThan(1);
      rows.forEach((row) => expect(row.tabIndex).toBe(-1));
    });

    it('runs the highlighted row on Enter in the field, and not a command on the Close button', async () => {
      const { palette, paletteState } = load();
      lampStates(paletteState);
      const websocket = require('../../src/websocket.js').default;
      palette.openCommandPalette();
      const input = document.querySelector('.command-palette-input');
      input.value = 'turn on bed';
      input.dispatchEvent(new Event('input'));
      const close = document.querySelector('.command-palette-close');

      // Enter on Close is Close's own click: it must not also run the command under the highlight.
      const onClose = press(close, 'Enter');
      expect(onClose.defaultPrevented).toBe(false);
      expect(websocket.callService).not.toHaveBeenCalled();

      press(input, 'Enter');
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(websocket.callService).toHaveBeenCalledWith(
        'light',
        'turn_on',
        expect.objectContaining({ entity_id: 'light.bed_light' })
      );
    });

    it('moves the highlight with focus, so Enter runs the row that was focused', () => {
      const { palette, paletteState } = load();
      lampStates(paletteState);
      palette.openCommandPalette();
      const rows = [...document.querySelectorAll('.command-palette-result')];

      rows[2].focus();

      expect(rows[2].classList).toContain('highlighted');
      expect(rows[0].classList).not.toContain('highlighted');
    });

    it('closes on Escape and on a click on its backdrop', () => {
      const { palette, paletteState } = load();
      lampStates(paletteState);
      palette.openCommandPalette();
      const input = document.querySelector('.command-palette-input');
      expect(press(input, 'Escape').defaultPrevented).toBe(true);
      expect(overlay().classList).toContain('hidden');

      palette.openCommandPalette();
      overlay().querySelector('.command-palette-panel').click();
      expect(overlay().classList).not.toContain('hidden');
      overlay().click();
      expect(overlay().classList).toContain('hidden');
    });

    it('returns focus to the tile it was opened from, even if that tile was rebuilt meanwhile', () => {
      const { palette, paletteState } = load();
      lampStates(paletteState);
      document.body.insertAdjacentHTML(
        'beforeend',
        `<div id="quick-controls"><div class="control-item" data-entity-id="light.bed_light">
          <button class="tile-primary-button">Bed</button></div></div>`
      );
      const grid = document.getElementById('quick-controls');
      grid.querySelector('.tile-primary-button').focus();
      palette.openCommandPalette();

      // The entity changed while the palette was open, so its tile was replaced.
      grid.replaceChildren(grid.firstElementChild.cloneNode(true));
      palette.closeCommandPalette();

      expect(document.activeElement).toBe(grid.querySelector('.tile-primary-button'));
    });

    it('stays shut behind the first-run wizard and the connecting screen', () => {
      const { palette } = load();
      palette.initializeCommandPalette();
      const ctrlK = () => {
        const event = new KeyboardEvent('keydown', {
          key: 'k',
          ctrlKey: true,
          bubbles: true,
          cancelable: true,
        });
        document.dispatchEvent(event);
        return event;
      };

      document.body.classList.add('first-run-active');
      expect(ctrlK().defaultPrevented).toBe(false);
      expect(document.querySelector('.command-palette-overlay')).toBeNull();
      document.body.classList.remove('first-run-active');

      document.body.insertAdjacentHTML('beforeend', '<div id="loading-overlay"></div>');
      expect(ctrlK().defaultPrevented).toBe(false);
      document.getElementById('loading-overlay').classList.add('hidden');
      expect(ctrlK().defaultPrevented).toBe(true);
      expect(document.querySelector('.command-palette-overlay')).not.toBeNull();
    });
  });

  describe('locks and alarm panels', () => {
    const frontDoor = (lockState) => ({
      entity_id: 'lock.front_door',
      state: lockState,
      attributes: { friendly_name: 'Front Door' },
    });
    const loadLocks = () => {
      const loaded = load();
      loaded.paletteState.setServices({ lock: { lock: {}, unlock: {} } });
      return loaded;
    };
    const search = (query) => {
      const input = document.querySelector('.command-palette-input');
      input.value = query;
      input.dispatchEvent(new Event('input'));
      return input;
    };
    const press = (input, key) =>
      input.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }));
    const highlightedName = () =>
      document.querySelector('.command-palette-result.highlighted .command-palette-result-name')
        ?.textContent;
    const paletteOpen = () =>
      !document.querySelector('.command-palette-overlay').classList.contains('hidden');

    it('never offers Unlock from recents, only for a matching query', async () => {
      const { palette, paletteState } = loadLocks();
      paletteState.setStates({ 'lock.front_door': frontDoor('unlocked') });
      palette.openCommandPalette();
      await run('Lock Front Door');

      paletteState.setStates({ 'lock.front_door': frontDoor('locked') });
      palette.openCommandPalette();
      expect(resultNames()).not.toContain('Unlock Front Door');
      expect(highlightedName()).not.toBe('Unlock Front Door');

      search('unlock');
      expect(resultNames()).toContain('Unlock Front Door');
    });

    it('keeps Lock commands rankable from recents', async () => {
      const { palette, paletteState } = loadLocks();
      paletteState.setStates({ 'lock.front_door': frontDoor('locked') });
      palette.openCommandPalette();
      search('unlock');
      await run('Unlock Front Door');

      paletteState.setStates({ 'lock.front_door': frontDoor('unlocked') });
      palette.openCommandPalette();
      expect(resultNames()[0]).toBe('Lock Front Door');
    });

    it('moves Enter on a lock row to its command instead of closing silently', async () => {
      const { palette, paletteState } = loadLocks();
      const websocket = require('../../src/websocket.js').default;
      paletteState.setStates({ 'lock.front_door': frontDoor('locked') });
      palette.openCommandPalette();
      const input = search('front door');
      expect(highlightedName()).toBe('Front Door');

      press(input, 'Enter');
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(paletteOpen()).toBe(true);
      expect(highlightedName()).toBe('Unlock Front Door');
      expect(websocket.callService).not.toHaveBeenCalled();
    });

    it('explains how to find the command when it is not listed', () => {
      const { palette, paletteState } = loadLocks();
      paletteState.setStates({ 'lock.front_door': frontDoor('locked') });
      palette.openCommandPalette();
      const input = document.querySelector('.command-palette-input');
      expect(highlightedName()).toBe('Front Door');

      press(input, 'Enter');
      expect(paletteOpen()).toBe(true);
      const hint = document.querySelector('.command-palette-hint');
      expect(hint.hidden).toBe(false);
      expect(hint.textContent).toBe('To control Front Door, type "lock" or "unlock".');

      search('unl');
      expect(hint.hidden).toBe(true);
    });

    it('says so when an alarm panel has no command here', () => {
      const { palette, paletteState } = loadLocks();
      paletteState.setStates({
        'alarm_control_panel.home': {
          entity_id: 'alarm_control_panel.home',
          state: 'armed_away',
          attributes: { friendly_name: 'Home alarm' },
        },
      });
      palette.openCommandPalette();
      press(document.querySelector('.command-palette-input'), 'Enter');
      expect(paletteOpen()).toBe(true);
      expect(document.querySelector('.command-palette-hint').textContent).toBe(
        'No command is available for Home alarm.'
      );
    });
    const loadAlarm = () => {
      const loaded = load();
      const alarm = {
        entity_id: 'alarm_control_panel.home',
        state: 'armed_home',
        attributes: {
          friendly_name: 'Home alarm',
          supported_features: 3,
          code_format: 'number',
          code_arm_required: true,
        },
      };
      loaded.paletteState.setStates({ [alarm.entity_id]: alarm });
      loaded.paletteState.setServices({
        alarm_control_panel: { alarm_arm_home: {}, alarm_arm_away: {}, alarm_disarm: {} },
      });
      return {
        ...loaded,
        alarm,
        requestCode: require('../../src/ui.js').requestAlarmCode,
        websocket: require('../../src/websocket.js').default,
      };
    };
    it('keeps disarm out of an empty query and cancels without sending a command', async () => {
      const { palette, requestCode, websocket } = loadAlarm();
      palette.openCommandPalette();
      expect(resultNames()).not.toContain('Disarm Home alarm');
      search('disarm');
      requestCode.mockResolvedValueOnce(null);
      await run('Disarm Home alarm');
      expect(requestCode).toHaveBeenCalledTimes(1);
      expect(websocket.callService).not.toHaveBeenCalled();
    });
    it('sends a requested code only in the service payload and never persists it', async () => {
      const { palette, requestCode, websocket } = loadAlarm();
      requestCode.mockResolvedValueOnce('0123');
      palette.openCommandPalette();
      search('disarm');
      await run('Disarm Home alarm');
      expect(websocket.callService).toHaveBeenCalledWith('alarm_control_panel', 'alarm_disarm', {
        entity_id: 'alarm_control_panel.home',
        code: '0123',
      });
      expect(JSON.stringify(Object.values(localStorage))).not.toContain('0123');
    });
    it('rejects a command if capabilities or the connection changed during code capture', async () => {
      const { palette, paletteState, alarm, requestCode, websocket } = loadAlarm();
      requestCode.mockImplementationOnce(async () => {
        paletteState.setEntityState({
          ...alarm,
          attributes: { ...alarm.attributes, supported_features: 0 },
        });
        return '0123';
      });
      palette.openCommandPalette();
      search('arm away');
      await run('Arm Home alarm away');
      expect(websocket.callService).not.toHaveBeenCalled();
    });
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
    // The shortcut is a placeholder, so the platform can name its own modifier (Cmd+K on macOS).
    const { shortcut } = JSON.parse(hint.dataset.i18nVars);
    expect(shortcut).toBe('Ctrl+K');
    expect(hint.textContent.trim()).toBe(hint.dataset.i18n.replace('{{shortcut}}', shortcut));
    expect(hint.textContent).toContain('Ctrl+K');
  });
});

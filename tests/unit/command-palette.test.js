jest.mock('../../src/ui.js', () => ({
  openEntityDetailModal: jest.fn(),
  switchQuickAccessPage: jest.fn(async () => ({ success: true })),
  requestAlarmCode: jest.fn(async () => null),
  getEntityDomain: (entityId) => String(entityId || '').split('.')[0],
  // Whether an entity has anything to open or run is ui.js's rule, tested there.
  hasEntityAction: jest.fn(() => true),
  describeServiceErrorMessage: jest.fn((error) => error?.message || 'Unknown error'),
  isConnectionServiceError: jest.fn((error) => /^WebSocket/.test(error?.message || '')),
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
        // This session has not loaded any services, so the palette lists no command for either.
        { source: 'command-palette', hasCommand: false }
      );
    } finally {
      global.requestAnimationFrame = originalRequestAnimationFrame;
      HTMLElement.prototype.scrollIntoView = originalScrollIntoView;
    }
  });
});

describe('command palette results that open an entity', () => {
  const rowFor = (name) =>
    [...document.querySelectorAll('.command-palette-result')].find(
      (row) => row.querySelector('.command-palette-result-name').textContent === name
    );

  it('tell the dialog whether the palette also lists a command for that entity', () => {
    const originalRequestAnimationFrame = global.requestAnimationFrame;
    const originalScrollIntoView = HTMLElement.prototype.scrollIntoView;
    global.requestAnimationFrame = (callback) => callback();
    HTMLElement.prototype.scrollIntoView = jest.fn();
    try {
      // A switch has Turn on and Turn off; a button has no row of its own, so its result is the
      // only way to press it from here.
      state.setServices({ switch: { turn_on: {}, turn_off: {} } });
      state.setStates({
        'switch.kettle': {
          entity_id: 'switch.kettle',
          state: 'off',
          attributes: { friendly_name: 'Kettle' },
        },
        'button.doorbell': {
          entity_id: 'button.doorbell',
          state: 'unknown',
          attributes: { friendly_name: 'Doorbell' },
        },
      });
      openEntityDetailModal.mockClear();

      openCommandPalette();
      rowFor('Kettle').click();
      expect(openEntityDetailModal).toHaveBeenLastCalledWith(
        expect.objectContaining({ entity_id: 'switch.kettle' }),
        { source: 'command-palette', hasCommand: true }
      );

      openCommandPalette();
      rowFor('Doorbell').click();
      expect(openEntityDetailModal).toHaveBeenLastCalledWith(
        expect.objectContaining({ entity_id: 'button.doorbell' }),
        { source: 'command-palette', hasCommand: false }
      );
    } finally {
      state.setServices({});
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

  // Every fresh copy of the module that is initialised puts its shortcut handler on the shared
  // document, and a handler from an earlier test would answer this test's keys too.
  const documentListeners = [];
  beforeEach(() => {
    global.requestAnimationFrame = (callback) => callback();
    HTMLElement.prototype.scrollIntoView = jest.fn();
    localStorage.clear();
    document.body.innerHTML = '';
    jest.resetModules();
    const add = EventTarget.prototype.addEventListener;
    jest.spyOn(document, 'addEventListener').mockImplementation(function (type, listener, options) {
      documentListeners.push([type, listener, options]);
      return add.call(this, type, listener, options);
    });
  });
  afterEach(() => {
    global.requestAnimationFrame = originalRequestAnimationFrame;
    HTMLElement.prototype.scrollIntoView = originalScrollIntoView;
    document.body.innerHTML = '';
    document.addEventListener.mockRestore();
    documentListeners
      .splice(0)
      .forEach(([type, listener, options]) =>
        document.removeEventListener(type, listener, options)
      );
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
      // Searched by id, so the row is found without the Unlock command that would answer Enter.
      const input = search('lock.front');
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
      press(search('home alarm'), 'Enter');
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

  describe('typing with an input method (IME)', () => {
    const press = (target, key, init = {}) => {
      const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...init });
      target.dispatchEvent(event);
      return event;
    };
    const setup = () => {
      const loaded = load();
      loaded.paletteState.setStates({
        'light.bed_light': bedLight('off'),
        'light.desk': { entity_id: 'light.desk', state: 'off', attributes: {} },
      });
      loaded.palette.openCommandPalette();
      const input = document.querySelector('.command-palette-input');
      input.value = 'turn on';
      input.dispatchEvent(new Event('input'));
      return { ...loaded, input };
    };
    const highlighted = () =>
      document.querySelector('.command-palette-result.highlighted').textContent;
    const paletteOpen = () =>
      !document.querySelector('.command-palette-overlay').classList.contains('hidden');

    it.each([
      ['isComposing', { isComposing: true }],
      ['keyCode 229, which some engines report after the composition has ended', { keyCode: 229 }],
    ])(
      'does not run the highlighted result on the Enter that commits a composition (%s)',
      async (_label, init) => {
        const { input } = setup();
        const websocket = require('../../src/websocket.js').default;

        const event = press(input, 'Enter', init);
        await new Promise((resolve) => setTimeout(resolve, 0));

        // The key is the input method's: the palette neither acts on it nor takes it away.
        expect(event.defaultPrevented).toBe(false);
        expect(websocket.callService).not.toHaveBeenCalled();
        expect(paletteOpen()).toBe(true);
      }
    );

    it('leaves the arrows to the candidate list of a composition', () => {
      const { input } = setup();
      const before = highlighted();

      const down = press(input, 'ArrowDown', { isComposing: true });
      const up = press(input, 'ArrowUp', { keyCode: 229 });

      expect(down.defaultPrevented).toBe(false);
      expect(up.defaultPrevented).toBe(false);
      expect(highlighted()).toBe(before);
    });

    it('does not close on the Escape that cancels a composition', () => {
      const { input } = setup();

      const event = press(input, 'Escape', { isComposing: true });

      expect(event.defaultPrevented).toBe(false);
      expect(paletteOpen()).toBe(true);
    });

    it('still works with the keyboard once the composition is over', async () => {
      const { input } = setup();
      const websocket = require('../../src/websocket.js').default;
      const before = highlighted();

      press(input, 'ArrowDown', { isComposing: false });
      expect(highlighted()).not.toBe(before);
      press(input, 'Enter', { isComposing: false });
      await new Promise((resolve) => setTimeout(resolve, 0));

      expect(websocket.callService).toHaveBeenCalledTimes(1);
    });
  });

  describe('an entity with nothing to open or run', () => {
    const sun = {
      entity_id: 'sun.sun',
      state: 'above_horizon',
      attributes: { friendly_name: 'Sun' },
    };
    const searchFor = (query) => {
      const input = document.querySelector('.command-palette-input');
      input.value = query;
      input.dispatchEvent(new Event('input'));
      return input;
    };

    it('keeps the palette open and says so, instead of closing as if the click failed', () => {
      const { palette, paletteState } = load();
      const { openEntityDetailModal } = require('../../src/ui.js');
      const { hasEntityAction } = require('../../src/ui.js');
      hasEntityAction.mockReturnValue(false);
      paletteState.setStates({ 'sun.sun': sun });
      palette.openCommandPalette();
      const input = searchFor('sun');

      input.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true })
      );

      expect(openEntityDetailModal).not.toHaveBeenCalled();
      expect(document.querySelector('.command-palette-overlay').classList).not.toContain('hidden');
      expect(document.activeElement).toBe(input);
      const hint = document.querySelector('.command-palette-hint');
      expect(hint.hidden).toBe(false);
      expect(hint.textContent).toBe('No command is available for Sun.');
      // Spoken too, which the visible hint alone was not.
      expect(document.querySelector('[role="status"]').textContent).toBe(
        'No command is available for Sun.'
      );
      // And not remembered as something that was run.
      expect(Object.values(localStorage)).toEqual([]);
      hasEntityAction.mockReturnValue(true);
    });

    it('opens an entity that has controls, and remembers it', () => {
      const { palette, paletteState } = load();
      const { openEntityDetailModal } = require('../../src/ui.js');
      paletteState.setStates({ 'sun.sun': sun });
      palette.openCommandPalette();
      const input = searchFor('sun');

      input.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true })
      );

      expect(openEntityDetailModal).toHaveBeenCalledWith(
        expect.objectContaining({ entity_id: 'sun.sun' }),
        // The palette lists no command for it, so the dialog may run its own action.
        { source: 'command-palette', hasCommand: false }
      );
      expect(JSON.parse(Object.values(localStorage)[0])).toEqual(['entity:sun.sun']);
    });
  });

  describe('a command that fails', () => {
    const lamp = () => ({
      entity_id: 'light.desk',
      state: 'off',
      attributes: { friendly_name: 'Desk lamp' },
    });
    const toastsFor = async (error) => {
      const { palette, paletteState } = load();
      const uiUtils = require('../../src/ui-utils.js');
      const websocket = require('../../src/websocket.js').default;
      const toast = jest.spyOn(uiUtils, 'showToast').mockImplementation(() => {});
      paletteState.setStates({ 'light.desk': lamp() });
      palette.openCommandPalette();
      const input = document.querySelector('.command-palette-input');
      input.value = 'turn on desk';
      input.dispatchEvent(new Event('input'));
      if (error) websocket.callService.mockRejectedValueOnce(error);
      await run('Turn on Desk lamp');
      const messages = toast.mock.calls.map(([message, type]) => [message, type]);
      toast.mockRestore();
      return messages;
    };

    it("says Home Assistant's own reason, such as a wrong alarm code, not a connection problem", async () => {
      const messages = await toastsFor(new Error('Invalid alarm code provided'));

      expect(messages).toEqual([['Could not run command: Invalid alarm code provided', 'error']]);
    });

    it('keeps the advice to check the connection for an outage', async () => {
      const messages = await toastsFor(new Error('WebSocket not connected'));

      expect(messages).toEqual([
        ['Could not run command. Check your connection and retry.', 'error'],
      ]);
    });

    it('says the connection is the problem when the socket is down before the call', async () => {
      const websocket = require('../../src/websocket.js').default;
      websocket.isConnected.mockReturnValueOnce(false);

      const messages = await toastsFor(null);

      expect(messages).toEqual([
        ['Could not run command. Check your connection and retry.', 'error'],
      ]);
      expect(websocket.callService).not.toHaveBeenCalled();
    });

    it('says an entity that went unavailable is unavailable', async () => {
      const { palette, paletteState } = load();
      const uiUtils = require('../../src/ui-utils.js');
      const toast = jest.spyOn(uiUtils, 'showToast').mockImplementation(() => {});
      paletteState.setStates({ 'light.desk': lamp() });
      palette.openCommandPalette();
      const input = document.querySelector('.command-palette-input');
      input.value = 'turn on desk';
      input.dispatchEvent(new Event('input'));
      paletteState.setStates({ 'light.desk': { ...lamp(), state: 'unavailable' } });
      await run('Turn on Desk lamp');

      expect(toast).toHaveBeenCalledWith('Could not run command: Entity is unavailable', 'error');
      toast.mockRestore();
    });
  });

  describe('search quality', () => {
    const entities = [
      ['media_player.bedroom_tv', 'Bedroom TV'],
      ['media_player.living_room', 'Living room'],
      ['calendar.family', 'Family calendar'],
      ['climate.hallway_thermostat', 'Hallway thermostat'],
      [
        'light.upstairs_hallway_ceiling_pendant_light_above_the_stairs',
        'Upstairs hallway ceiling pendant light above the stairs',
      ],
      [
        'sensor.living_room_north_wall_temperature_sensor',
        'Living room north wall temperature sensor',
      ],
      ['alarm_control_panel.home_alarm', 'Home alarm'],
      ['sensor.next_alarm', 'Next alarm'],
      ['light.kitchen', 'Kitchen Light'],
      ['light.desk_lamp', 'Desk lamp'],
    ].map(([entity_id, friendly_name]) => ({
      entity_id,
      state: 'on',
      attributes: { friendly_name },
    }));
    const names = (query) =>
      rankCommandPaletteEntities(entities, query, {
        getDisplayName: (entity) => entity.attributes.friendly_name,
      }).map((item) => item.displayName);

    it('lists only the alarms for "alarm", not every name its letters are scattered through', () => {
      expect(names('alarm').sort()).toEqual(['Home alarm', 'Next alarm']);
    });

    it('finds nothing for "disarm" among names that do not say it', () => {
      expect(names('disarm')).toEqual([]);
    });

    it('lists only the lamp for "lamp", not the alarm', () => {
      expect(names('lamp')).toEqual(['Desk lamp']);
    });

    it('still finds an abbreviation of one word, as "ktn" finds Kitchen Light', () => {
      expect(names('ktn')).toEqual(['Kitchen Light']);
    });

    it('does not scatter one or two letters through every name', () => {
      expect(scoreCommandPaletteMatch('Hallway thermostat', 'ht')).toBe(0);
      expect(scoreCommandPaletteMatch('Kitchen Light', 'kl')).toBe(0);
      // Substrings and prefixes still count at any length.
      expect(scoreCommandPaletteMatch('Kitchen Light', 'k')).toBeGreaterThan(0);
      expect(scoreCommandPaletteMatch('Kitchen Light', 'ch')).toBeGreaterThan(0);
    });

    it('does not let the domain act as a name prefix for a one-letter search', () => {
      // "a" used to rank alarm_control_panel.home_alarm (an id prefix) above the names it is in.
      const ranked = names('a');
      expect(ranked.indexOf('Family calendar')).toBeLessThan(ranked.indexOf('Home alarm'));
      const ids = rankCommandPaletteEntities(entities, 'alarm_control', {
        getDisplayName: (entity) => entity.attributes.friendly_name,
      });
      expect(ids).toEqual([]);
    });

    it('finds an entity by its object id, and by a full id once the query has a dot', () => {
      expect(names('desk_lamp')).toEqual(['Desk lamp']);
      expect(names('light.kit')).toEqual(['Kitchen Light']);
      expect(names('light.')).toEqual(expect.arrayContaining(['Kitchen Light', 'Desk lamp']));
    });

    it('finds a name by all of its words, in any order', () => {
      expect(names('lamp desk')).toEqual(['Desk lamp']);
      expect(names('light kitchen')).toEqual(['Kitchen Light']);
    });

    it('ranks the better tiers first', () => {
      const scores = ['Desk', 'Desk lamp', 'My desk lamp', 'Dark eskimo mess kit'].map((name) =>
        scoreCommandPaletteMatch(name, 'desk')
      );
      expect(scores[0]).toBeGreaterThan(scores[1]);
      expect(scores[1]).toBeGreaterThan(scores[2]);
      expect(scores[2]).toBeGreaterThan(scores[3]);
    });
  });

  describe('what an empty search lists', () => {
    const entity = (id, name, state = 'off') => ({
      entity_id: id,
      state,
      attributes: { friendly_name: name },
    });
    const rows = () =>
      [...document.querySelectorAll('.command-palette-result')].map((row) => ({
        name: row.querySelector('.command-palette-result-name').textContent,
        type: row.querySelector('.command-palette-result-domain').textContent,
        state: row.querySelector('.command-palette-result-state').textContent,
      }));
    const loadPages = (activeEntityIds) => {
      const loaded = load();
      loaded.paletteState.setConfig({
        homeAssistant: { url: 'http://ha.local:8123', token: 'secret-token' },
        customTabs: [
          { id: 'main', name: 'Main', entityIds: activeEntityIds },
          { id: 'kitchen', name: 'Kitchen', entityIds: [] },
          { id: 'garage', name: 'Garage', entityIds: [] },
        ],
        activeTabId: 'main',
      });
      loaded.paletteState.setServices({ light: { turn_on: {}, turn_off: {} } });
      return loaded;
    };

    it('starts with the pages, then the entities of the page on screen, then the rest by name', () => {
      const { palette, paletteState } = loadPages(['light.zulu', 'light.mike']);
      paletteState.setStates({
        'light.alpha': entity('light.alpha', 'Alpha'),
        'light.mike': entity('light.mike', 'Mike'),
        'light.zulu': entity('light.zulu', 'Zulu'),
        'light.bravo': entity('light.bravo', 'Bravo'),
      });

      palette.openCommandPalette();

      expect(
        rows()
          .map((row) => row.name)
          .slice(0, 8)
      ).toEqual([
        'Switch to Kitchen',
        'Switch to Garage',
        'Zulu',
        'Mike',
        'Alpha',
        'Bravo',
        'Turn on Alpha',
        'Turn on Bravo',
      ]);
    });

    it('puts what was used last ahead of everything, entities opened and commands run alike', async () => {
      const { palette, paletteState } = loadPages([]);
      paletteState.setStates({
        'light.alpha': entity('light.alpha', 'Alpha'),
        'light.bravo': entity('light.bravo', 'Bravo'),
        'light.charlie': entity('light.charlie', 'Charlie'),
      });
      palette.openCommandPalette();
      const input = document.querySelector('.command-palette-input');
      input.value = 'charlie';
      input.dispatchEvent(new Event('input'));
      await run('Charlie');
      input.value = 'turn on bravo';
      input.dispatchEvent(new Event('input'));
      await run('Turn on Bravo');

      palette.openCommandPalette();

      expect(
        rows()
          .map((row) => row.name)
          .slice(0, 4)
      ).toEqual(['Turn on Bravo', 'Charlie', 'Switch to Kitchen', 'Switch to Garage']);
    });

    it('tells a command row from an entity row, with a chip and without the state it is about to change', () => {
      const { palette, paletteState } = loadPages([]);
      paletteState.setStates({ 'light.alpha': entity('light.alpha', 'Alpha', 'off') });

      palette.openCommandPalette();

      const byName = Object.fromEntries(rows().map((row) => [row.name, row]));
      expect(byName['Turn on Alpha']).toEqual({
        name: 'Turn on Alpha',
        type: 'Command',
        state: '',
      });
      expect(byName['Switch to Kitchen']).toEqual({
        name: 'Switch to Kitchen',
        type: 'Page',
        state: '',
      });
      expect(byName.Alpha.state).toBe('Off');
      expect(byName.Alpha.type).not.toBe('Command');
    });

    it('says when the list is cut, and how much of it is shown', () => {
      const { palette, paletteState } = loadPages([]);
      paletteState.setStates(
        Object.fromEntries(
          Array.from({ length: 30 }, (_, index) => {
            const id = `sensor.s${String(index).padStart(2, '0')}`;
            return [id, entity(id, `Sensor ${String(index).padStart(2, '0')}`, '1')];
          })
        )
      );

      palette.openCommandPalette();

      const footer = document.querySelector('.command-palette-footer');
      expect(rows()).toHaveLength(20);
      expect(footer.hidden).toBe(false);
      expect(footer.textContent).toBe('Showing 20 of 32 results');
      expect(document.querySelector('[role="status"]').textContent).toBe(
        'Showing 20 of 32 results'
      );
    });

    it('has no footer when everything fits', () => {
      const { palette, paletteState } = loadPages([]);
      paletteState.setStates({ 'light.alpha': entity('light.alpha', 'Alpha') });

      palette.openCommandPalette();

      expect(document.querySelector('.command-palette-footer').hidden).toBe(true);
      expect(document.querySelector('.command-palette-footer').textContent).toBe('');
    });
  });

  describe('for assistive technology', () => {
    const search = (query) => {
      const input = document.querySelector('.command-palette-input');
      input.value = query;
      input.dispatchEvent(new Event('input'));
      return input;
    };
    const status = () =>
      document.querySelector('.command-palette > [role="status"], [role="status"]');

    it('names its list of results', () => {
      const { palette, paletteState } = load();
      paletteState.setStates({ 'light.bed_light': bedLight('off') });

      palette.openCommandPalette();

      const list = document.querySelector('[role="listbox"]');
      expect(list.getAttribute('aria-label')).toBe('Search results');
      expect(document.querySelector('.command-palette-input').getAttribute('aria-controls')).toBe(
        list.id
      );
    });

    it('says how many results there are, and when there are none, in a region that is always there', () => {
      const { palette, paletteState } = load();
      paletteState.setStates({ 'light.bed_light': bedLight('off') });
      palette.openCommandPalette();
      const region = status();
      expect(region.hidden).toBe(false);
      expect(region.getAttribute('aria-live')).toBe('polite');

      search('bed light');
      expect(region.textContent).toMatch(/^Results: \d+$/);

      search('zzzzz');
      expect(status()).toBe(region);
      expect(region.textContent).toBe('No matching results');
    });

    it('keeps aria-expanded true only while there are results to move through', () => {
      const { palette, paletteState } = load();
      paletteState.setStates({ 'light.bed_light': bedLight('off') });
      palette.openCommandPalette();
      const input = document.querySelector('.command-palette-input');
      expect(input.getAttribute('aria-expanded')).toBe('true');

      search('zzzzz');
      expect(input.getAttribute('aria-expanded')).toBe('false');
      search('bed');
      expect(input.getAttribute('aria-expanded')).toBe('true');

      palette.closeCommandPalette();
      expect(input.getAttribute('aria-expanded')).toBe('false');
      expect(status().textContent).toBe('');
    });

    it('speaks the hint that sends a lock to its command, and the visible copy stays out of the way', () => {
      const { palette, paletteState } = load();
      paletteState.setServices({ lock: { lock: {}, unlock: {} } });
      paletteState.setStates({
        'lock.front_door': {
          entity_id: 'lock.front_door',
          state: 'locked',
          attributes: { friendly_name: 'Front Door' },
        },
      });
      palette.openCommandPalette();
      const input = search('lock.front');

      input.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true })
      );

      expect(status().textContent).toBe('To control Front Door, type "lock" or "unlock".');
      expect(document.querySelector('.command-palette-hint').getAttribute('aria-hidden')).toBe(
        'true'
      );
    });
  });

  describe('when there is nothing to list', () => {
    const search = (query) => {
      const input = document.querySelector('.command-palette-input');
      input.value = query;
      input.dispatchEvent(new Event('input'));
    };
    const emptyText = () => document.querySelector('.command-palette-empty:not([hidden])');
    const emptyLoad = () => {
      const loaded = load();
      loaded.paletteState.setConfig({
        homeAssistant: { url: 'http://ha.local:8123', token: 'secret-token' },
        customTabs: [],
      });
      loaded.paletteState.setStates({});
      return loaded;
    };

    it('says it is waiting for Home Assistant while no entities have arrived, not that nothing matched', () => {
      const { palette } = emptyLoad();

      palette.openCommandPalette();

      expect(emptyText().textContent).toBe('Waiting for live Home Assistant data...');
      expect(emptyText().textContent).not.toContain('No matching');
    });

    it('says the connection is down when it is', () => {
      const { palette } = emptyLoad();
      require('../../src/websocket.js').default.isConnected.mockReturnValueOnce(false);

      palette.openCommandPalette();

      expect(emptyText().textContent).toBe('Not connected to Home Assistant');
    });

    it('fills in when the entities arrive while it is open', () => {
      const { palette, paletteState } = emptyLoad();
      palette.openCommandPalette();
      expect(document.querySelectorAll('.command-palette-result')).toHaveLength(0);

      paletteState.setStates({ 'light.bed_light': bedLight('off') });

      expect(emptyText()).toBeNull();
      expect(resultNames()).toContain('Bed Light');
    });

    it('stops listening for entities once it is closed', () => {
      const { palette, paletteState } = emptyLoad();
      palette.openCommandPalette();
      palette.closeCommandPalette();

      paletteState.setStates({ 'light.bed_light': bedLight('off') });

      expect(document.querySelectorAll('.command-palette-result')).toHaveLength(0);
    });

    it('suggests what to try when a search finds nothing', () => {
      const { palette, paletteState } = emptyLoad();
      paletteState.setStates({ 'light.bed_light': bedLight('off') });
      palette.openCommandPalette();

      search('zzzzz');

      expect(emptyText().querySelector('.command-palette-empty-title').textContent).toBe(
        'No matching results'
      );
      expect(emptyText().querySelector('.command-palette-empty-hint').textContent).toBe(
        'Try a device name, a command like "turn on", or a page name'
      );
    });
  });

  describe('the Ctrl+K shortcut from a focused control', () => {
    const shortcut = (target, init = {}) => {
      const event = new KeyboardEvent('keydown', {
        key: 'k',
        ctrlKey: true,
        bubbles: true,
        cancelable: true,
        ...init,
      });
      target.dispatchEvent(event);
      return event;
    };
    const paletteOpen = () => {
      const overlay = document.querySelector('.command-palette-overlay');
      return !!overlay && !overlay.classList.contains('hidden');
    };
    const setup = (markup) => {
      const { palette } = load();
      palette.initializeCommandPalette();
      document.body.insertAdjacentHTML('beforeend', markup);
      return document.body.lastElementChild;
    };

    it.each([
      ['a checkbox', '<input type="checkbox" id="c" />'],
      ['a radio button', '<input type="radio" id="c" />'],
      ['a slider', '<input type="range" id="c" />'],
      ['a button', '<button id="c">Go</button>'],
      ['a select', '<select id="c"><option>One</option></select>'],
    ])('opens from %s, where it used to be ignored', (_label, markup) => {
      const control = setup(markup);
      control.focus();

      const event = shortcut(control);

      expect(event.defaultPrevented).toBe(true);
      expect(paletteOpen()).toBe(true);
    });

    it('opens from the Quick Access search field that advertises it, and from any text field', () => {
      for (const markup of [
        '<input type="search" id="quick-controls-search" />',
        '<input type="text" id="c" />',
        '<textarea id="c"></textarea>',
      ]) {
        document.body.innerHTML = '';
        jest.resetModules();
        const control = setup(markup);
        control.focus();

        shortcut(control);

        expect(paletteOpen()).toBe(true);
      }
    });

    it('leaves Ctrl+K in a Mac text field alone, since it deletes to the end of the line there', () => {
      window.electronAPI = { platform: 'darwin' };
      try {
        const control = setup('<input type="text" id="c" />');
        control.focus();

        expect(shortcut(control).defaultPrevented).toBe(false);
        expect(paletteOpen()).toBe(false);
        // Cmd+K is the Mac's own shortcut, and opens it from there.
        expect(shortcut(control, { ctrlKey: false, metaKey: true }).defaultPrevented).toBe(true);
        expect(paletteOpen()).toBe(true);
      } finally {
        delete window.electronAPI;
      }
    });

    it('still opens from a Mac checkbox with Ctrl, which edits nothing there', () => {
      window.electronAPI = { platform: 'darwin' };
      try {
        const control = setup('<input type="checkbox" id="c" />');
        control.focus();

        shortcut(control);

        expect(paletteOpen()).toBe(true);
      } finally {
        delete window.electronAPI;
      }
    });

    it('ignores other combinations from a control', () => {
      const control = setup('<input type="checkbox" id="c" />');
      control.focus();

      for (const init of [{ altKey: true }, { shiftKey: true }, { key: 'j' }]) {
        expect(shortcut(control, init).defaultPrevented).toBe(false);
      }
      expect(paletteOpen()).toBe(false);
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

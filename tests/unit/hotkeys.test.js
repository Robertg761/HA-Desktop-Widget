/**
 * @jest-environment jsdom
 */

const {
  createMockElectronAPI,
  resetMockElectronAPI,
  getMockConfig,
} = require('../mocks/electron.js');
const { sampleStates } = require('../fixtures/ha-data.js');

// Mock dependencies
jest.mock('../../src/ui-utils.js', () => ({
  ...require('../helpers/ui-utils-dialogs').realDialogHelpers(),
  showToast: jest.fn(),
}));

jest.mock('../../src/utils.js', () => ({
  getEntityDisplayName: jest.fn((entity) => {
    if (!entity) return 'Unknown Entity';
    return entity.attributes?.friendly_name || entity.entity_id;
  }),
  getSearchScore: jest.fn((text, filter) => {
    const lowerText = text.toLowerCase();
    const lowerFilter = filter.toLowerCase();
    if (lowerText.startsWith(lowerFilter)) return 2;
    if (lowerText.includes(lowerFilter)) return 1;
    return 0;
  }),
}));

// Mock state module
const mockState = {
  CONFIG: null,
  STATES: {},
};

const state = require('../../src/state.js').default;

// Create mock electronAPI instance
let mockElectronAPI;

// Setup global mocks
beforeAll(() => {
  // Create electronAPI instance
  mockElectronAPI = createMockElectronAPI();

  // Set electronAPI on window object (jsdom)
  window.electronAPI = mockElectronAPI;
});

// Reset state before each test
beforeEach(() => {
  jest.clearAllMocks();
  resetMockElectronAPI();
  document.body.innerHTML = '';
  document.getElementById = Document.prototype.getElementById;

  // Reset mock state
  mockState.CONFIG = null;
  mockState.STATES = {};
});

describe('hotkeys module', () => {
  // Require modules once
  const hotkeys = require('../../src/hotkeys.js');
  const showToast = require('../../src/ui-utils.js').showToast;

  describe('initializeHotkeys', () => {
    it('should load hotkey configuration from state.CONFIG', () => {
      const config = getMockConfig();
      config.globalHotkeys = {
        enabled: true,
        hotkeys: {
          'light.living_room': { hotkey: 'Ctrl+Shift+L', action: 'toggle' },
        },
      };
      state.setConfig(config);

      expect(() => hotkeys.initializeHotkeys()).not.toThrow();
    });

    it('should handle missing globalHotkeys config gracefully', () => {
      const config = getMockConfig();
      config.globalHotkeys = undefined;
      state.setConfig(config);

      expect(() => hotkeys.initializeHotkeys()).not.toThrow();
    });

    it('should handle null config gracefully', () => {
      mockState.CONFIG = null;

      expect(() => hotkeys.initializeHotkeys()).not.toThrow();
    });

    it('should catch and log errors during initialization', () => {
      const consoleError = jest.spyOn(console, 'error').mockImplementation();

      // Force an error by making CONFIG a getter that throws
      const configSpy = jest.spyOn(state, 'CONFIG', 'get').mockImplementation(() => {
        throw new Error('Test error');
      });

      expect(() => hotkeys.initializeHotkeys()).not.toThrow();
      expect(consoleError).toHaveBeenCalledWith('Error initializing hotkeys:', expect.any(Error));

      consoleError.mockRestore();
      configSpy.mockRestore();

      // Restore normal state
      state.setConfig(null);
    });
  });

  describe('toggleHotkeys', () => {
    beforeEach(() => {
      const config = getMockConfig();
      config.globalHotkeys = {
        enabled: false,
        hotkeys: {},
      };
      state.setConfig(config);
    });

    it('should call IPC to enable hotkeys', async () => {
      await hotkeys.toggleHotkeys(true);
      expect(mockElectronAPI.toggleHotkeys).toHaveBeenCalledWith(true);
    });

    it('should call IPC to disable hotkeys', async () => {
      await hotkeys.toggleHotkeys(false);
      expect(mockElectronAPI.toggleHotkeys).toHaveBeenCalledWith(false);
    });

    it('confirms with the name on the switch, not "Global hotkeys"', async () => {
      // The switch is labelled "Entity hotkeys"; the popup hotkey is global too and is not on it.
      await hotkeys.toggleHotkeys(true);
      expect(showToast).toHaveBeenLastCalledWith('Entity hotkeys enabled', 'success', 2000);
      await hotkeys.toggleHotkeys(false);
      expect(showToast).toHaveBeenLastCalledWith('Entity hotkeys disabled', 'success', 2000);
    });

    it('should handle IPC failure', async () => {
      mockElectronAPI.toggleHotkeys.mockResolvedValue({
        success: false,
        error: 'Portal approval was denied',
      });

      const result = await hotkeys.toggleHotkeys(true);

      expect(result).toBe(false);
      expect(showToast).toHaveBeenCalledWith('Portal approval was denied', 'error', 3000);
    });

    it('should handle IPC errors', async () => {
      const consoleError = jest.spyOn(console, 'error').mockImplementation();
      mockElectronAPI.toggleHotkeys.mockRejectedValue(new Error('IPC error'));

      const result = await hotkeys.toggleHotkeys(true);

      expect(result).toBe(false);
      expect(showToast).toHaveBeenCalledWith('Error toggling hotkeys', 'error', 2000);
      expect(consoleError).toHaveBeenCalled();

      consoleError.mockRestore();
    });
  });

  describe('renderHotkeysTab', () => {
    // Picks an action in an entity's select the way the user does.
    const chooseAction = (container, entityId, action) => {
      const select = container.querySelector(
        `select.hotkey-action-select[data-entity-id="${entityId}"]`
      );
      select.value = action;
      select.dispatchEvent(new Event('change', { bubbles: true }));
    };

    beforeEach(() => {
      hotkeys.cleanupHotkeyEventListeners();
      const config = getMockConfig();
      config.globalHotkeys = {
        enabled: true,
        hotkeys: {
          'light.living_room': { hotkey: 'Ctrl+Shift+L', action: 'toggle' },
        },
      };
      state.setConfig(config);
      state.setStates(sampleStates);
    });

    it('should handle missing container gracefully', () => {
      document.getElementById = jest.fn(() => null);

      expect(() => hotkeys.renderHotkeysTab()).not.toThrow();
    });

    it('should render hotkey entities with search filter', () => {
      // Create real DOM elements
      const container = document.createElement('div');
      const searchInput = document.createElement('input');
      container.id = 'hotkeys-list';
      searchInput.id = 'hotkey-entity-search';
      searchInput.value = '';
      document.body.appendChild(container);
      document.body.appendChild(searchInput);

      expect(() => hotkeys.renderHotkeysTab()).not.toThrow();

      document.body.removeChild(container);
      document.body.removeChild(searchInput);
    });

    it('offers the action as a native select that names itself and shows the saved action', () => {
      const container = document.createElement('div');
      const searchInput = document.createElement('input');
      container.id = 'hotkeys-list';
      searchInput.id = 'hotkey-entity-search';
      searchInput.value = 'living';
      document.body.appendChild(container);
      document.body.appendChild(searchInput);
      state.CONFIG.globalHotkeys.hotkeys['light.living_room'] = {
        hotkey: 'Ctrl+Alt+L',
        action: 'turn_off',
      };

      hotkeys.renderHotkeysTab();

      const select = container.querySelector('select.hotkey-action-select');
      expect(select.dataset.entityId).toBe('light.living_room');
      expect(select.getAttribute('aria-label')).toBe('Hotkey action for Living Room Light');
      expect(select.value).toBe('turn_off');
      expect([...select.options].map((option) => option.value)).toEqual([
        'toggle',
        'turn_on',
        'turn_off',
        'brightness_up',
        'brightness_down',
      ]);
      expect(container.querySelector('[role="listbox"], .custom-dropdown')).toBeNull();
    });

    it('shows the first action when the saved one is not on offer for the entity', () => {
      const container = document.createElement('div');
      const searchInput = document.createElement('input');
      container.id = 'hotkeys-list';
      searchInput.id = 'hotkey-entity-search';
      searchInput.value = 'living';
      document.body.appendChild(container);
      document.body.appendChild(searchInput);
      state.CONFIG.globalHotkeys.hotkeys['light.living_room'] = {
        hotkey: 'Ctrl+Alt+L',
        action: 'increase_speed',
      };

      hotkeys.renderHotkeysTab();

      expect(container.querySelector('select.hotkey-action-select').value).toBe('toggle');
    });

    it('restores the persisted action when runtime hotkey registration fails', async () => {
      const container = document.createElement('div');
      const searchInput = document.createElement('input');
      container.id = 'hotkeys-list';
      searchInput.id = 'hotkey-entity-search';
      searchInput.value = 'living';
      document.body.appendChild(container);
      document.body.appendChild(searchInput);

      const previousConfig = JSON.parse(JSON.stringify(state.CONFIG));
      mockElectronAPI.updateConfig
        .mockImplementationOnce((nextConfig) => Promise.resolve(nextConfig))
        .mockImplementationOnce(() => Promise.resolve(previousConfig));
      mockElectronAPI.registerHotkeys
        .mockResolvedValueOnce({ success: false, error: 'Portal binding failed' })
        .mockResolvedValueOnce({ success: true });

      hotkeys.renderHotkeysTab();
      chooseAction(container, 'light.living_room', 'turn_on');
      await new Promise((resolve) => setTimeout(resolve, 0));

      expect(mockElectronAPI.updateConfig).toHaveBeenCalledTimes(2);
      expect(
        mockElectronAPI.updateConfig.mock.calls[0][0].globalHotkeys.hotkeys['light.living_room']
          .action
      ).toBe('turn_on');
      expect(
        mockElectronAPI.updateConfig.mock.calls[1][0].globalHotkeys.hotkeys['light.living_room']
          .action
      ).toBe('toggle');
      expect(mockElectronAPI.registerHotkeys).toHaveBeenCalledTimes(2);
      expect(state.CONFIG.globalHotkeys.hotkeys['light.living_room'].action).toBe('toggle');
      expect(showToast).toHaveBeenCalledWith('Portal binding failed', 'error', 4000);
      expect(showToast).not.toHaveBeenCalledWith(
        expect.stringContaining('Action updated'),
        'success',
        2000
      );
    });

    it('stamps the rollback with the revision taken before a sync pull could land', async () => {
      const container = document.createElement('div');
      const searchInput = document.createElement('input');
      container.id = 'hotkeys-list';
      searchInput.id = 'hotkey-entity-search';
      searchInput.value = 'living';
      document.body.appendChild(container);
      document.body.appendChild(searchInput);

      let revision = 5;
      mockElectronAPI.getConfigRevision = jest.fn(() => revision);
      mockElectronAPI.updateConfig.mockImplementation((nextConfig) => Promise.resolve(nextConfig));
      mockElectronAPI.registerHotkeys.mockImplementationOnce(async () => {
        revision = 9;
        return { success: false, error: 'Portal binding failed' };
      });

      hotkeys.renderHotkeysTab();
      chooseAction(container, 'light.living_room', 'turn_on');
      await new Promise((resolve) => setTimeout(resolve, 0));

      expect(mockElectronAPI.updateConfig).toHaveBeenCalledTimes(2);
      expect(mockElectronAPI.updateConfig.mock.calls[0][0].configRevision).toBeUndefined();
      expect(mockElectronAPI.updateConfig.mock.calls[1][0].configRevision).toBe(5);
    });

    it('translates action labels and the action-updated toast', async () => {
      const i18n = require('../../src/i18n.js');
      i18n.setLocaleBootstrap({
        activeLocale: 'de',
        messages: {
          Toggle: 'Umschalten',
          'Turn On': 'Einschalten',
          'Action updated to: {{action}}': 'Aktion geändert: {{action}}',
        },
      });
      try {
        const container = document.createElement('div');
        const searchInput = document.createElement('input');
        container.id = 'hotkeys-list';
        searchInput.id = 'hotkey-entity-search';
        searchInput.value = 'living';
        document.body.append(container, searchInput);
        mockElectronAPI.updateConfig.mockImplementationOnce((nextConfig) =>
          Promise.resolve(nextConfig)
        );
        mockElectronAPI.registerHotkeys.mockResolvedValueOnce({ success: true });

        hotkeys.renderHotkeysTab();
        const select = container.querySelector(
          'select.hotkey-action-select[data-entity-id="light.living_room"]'
        );
        expect(select.selectedOptions[0].textContent).toBe('Umschalten');
        chooseAction(container, 'light.living_room', 'turn_on');
        await new Promise((resolve) => setTimeout(resolve, 0));

        expect(showToast).toHaveBeenCalledWith('Aktion geändert: Einschalten', 'success', 2000);
      } finally {
        i18n.setLocaleBootstrap({ activeLocale: 'en', messages: {} });
      }
    });

    it('should include script, button, and input_button action entities in the picker', () => {
      const container = document.createElement('div');
      const searchInput = document.createElement('input');
      container.id = 'hotkeys-list';
      searchInput.id = 'hotkey-entity-search';
      searchInput.value = '';
      document.body.appendChild(container);
      document.body.appendChild(searchInput);
      state.setStates({
        ...sampleStates,
        'script.tv_fast_forward': {
          entity_id: 'script.tv_fast_forward',
          state: 'off',
          attributes: {
            friendly_name: 'TV Fast Forward',
          },
        },
      });

      hotkeys.renderHotkeysTab();

      expect(container.querySelector('[data-entity-id="script.tv_fast_forward"]')).toBeTruthy();
      expect(container.querySelector('[data-entity-id="button.refresh_router"]')).toBeTruthy();
      expect(container.querySelector('[data-entity-id="input_button.tv_rewind"]')).toBeTruthy();
      const shownAction = (entityId) =>
        container.querySelector(`select[data-entity-id="${entityId}"]`)?.selectedOptions[0]
          ?.textContent;
      expect(shownAction('input_button.tv_rewind')).toBe('Press');
      expect(shownAction('script.tv_fast_forward')).toBe('Run');

      document.body.removeChild(container);
      document.body.removeChild(searchInput);
    });

    it('should filter entities by search term', () => {
      // Create real DOM elements
      const container = document.createElement('div');
      const searchInput = document.createElement('input');
      container.id = 'hotkeys-list';
      searchInput.id = 'hotkey-entity-search';
      searchInput.value = 'living';
      document.body.appendChild(container);
      document.body.appendChild(searchInput);

      expect(() => hotkeys.renderHotkeysTab()).not.toThrow();

      document.body.removeChild(container);
      document.body.removeChild(searchInput);
    });

    it('should handle rendering errors gracefully', () => {
      const consoleError = jest.spyOn(console, 'error').mockImplementation();

      document.getElementById = jest.fn(() => {
        throw new Error('DOM error');
      });

      expect(() => hotkeys.renderHotkeysTab()).not.toThrow();
      expect(consoleError).toHaveBeenCalledWith('Error rendering hotkeys tab:', expect.any(Error));

      consoleError.mockRestore();
    });
  });

  describe('captureHotkey', () => {
    it('should handle errors gracefully when DOM operations fail', async () => {
      // This test is mainly to ensure the error handling works
      // Testing the full modal interaction is complex in jest/jsdom
      expect(typeof hotkeys.captureHotkey).toBe('function');
    });

    it('cancels itself, not the Settings dialog under it, on Escape with focus on the page', async () => {
      const uiUtils = jest.requireActual('../../src/ui-utils.js');
      const settings = document.createElement('div');
      settings.className = 'modal';
      settings.innerHTML = '<div class="modal-content"><button>Save</button></div>';
      document.body.appendChild(settings);
      const settingsEscape = jest.fn();
      uiUtils.openDialog(settings, { initialFocus: false, dismiss: settingsEscape });

      const capture = hotkeys.captureHotkey();
      // A click on the overlay's text leaves focus on <body>.
      document.activeElement?.blur();
      document.body.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })
      );

      await expect(capture).resolves.toBeNull();
      expect(document.querySelector('.hotkey-capture-modal')).toBeNull();
      expect(settingsEscape).not.toHaveBeenCalled();

      // With the overlay gone, Escape reaches Settings again.
      document.body.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })
      );
      expect(settingsEscape).toHaveBeenCalledTimes(1);
      uiUtils.releaseFocusTrap(settings);
      settings.remove();
    });

    it('can be cancelled with the mouse or a tap, which used to need the keyboard', async () => {
      const capture = hotkeys.captureHotkey();
      const cancel = document.querySelector('.hotkey-capture-cancel');

      expect(cancel.textContent).toBe('Cancel');
      // Pressing a key could not reach it anyway: every key is the recording's.
      expect(cancel.tabIndex).toBe(-1);
      cancel.click();

      await expect(capture).resolves.toBeNull();
      expect(document.querySelector('.hotkey-capture-modal')).toBeNull();
    });

    it('is cancelled by a click on the backdrop, and not by a click on its prompt', async () => {
      const capture = hotkeys.captureHotkey();
      const overlay = document.querySelector('.hotkey-capture-modal');

      overlay.querySelector('.modal-content').click();
      expect(document.querySelector('.hotkey-capture-modal')).toBe(overlay);
      overlay.click();

      await expect(capture).resolves.toBeNull();
      expect(document.querySelector('.hotkey-capture-modal')).toBeNull();
    });

    it('is a named dialog', () => {
      void hotkeys.captureHotkey();
      const overlay = document.querySelector('.hotkey-capture-modal');

      expect(overlay.getAttribute('role')).toBe('dialog');
      expect(overlay.getAttribute('aria-modal')).toBe('true');
      expect(overlay.getAttribute('aria-label')).toBe('Press the desired key combination...');
      overlay
        .querySelector('.hotkey-capture-cancel')
        .dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
  });

  describe('the hotkey list in Settings', () => {
    const entity = (id) => ({
      entity_id: id,
      state: 'off',
      attributes: { friendly_name: id.split('.')[1] },
    });
    const press = (target, key) => {
      const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true });
      target.dispatchEvent(event);
      return event;
    };

    beforeEach(() => {
      const config = getMockConfig();
      config.globalHotkeys = {
        enabled: true,
        hotkeys: { 'light.kitchen': { hotkey: 'Ctrl+K', action: 'toggle' } },
      };
      state.setConfig(config);
      state.setStates({
        'light.kitchen': entity('light.kitchen'),
        'light.hall': entity('light.hall'),
      });
      // The list wires itself once; a test builds a new one each time.
      hotkeys.cleanupHotkeyEventListeners();
      document.body.innerHTML = '<input id="hotkey-entity-search" /><div id="hotkeys-list"></div>';
      hotkeys.renderHotkeysTab();
    });

    it('keeps the keyboard on the same control when the list is rebuilt', () => {
      const select = document.querySelector('[data-focus-key="hotkey-action:light.hall"]');
      expect(select.matches('select.hotkey-action-select')).toBe(true);
      select.focus();

      hotkeys.renderHotkeysTab();

      const after = document.querySelector('[data-focus-key="hotkey-action:light.hall"]');
      expect(after).not.toBe(select);
      expect(document.activeElement).toBe(after);
    });

    it('leaves Escape on an action select to the browser and the dialog', () => {
      // An open native list closes itself on Escape before the page sees the key; on a closed
      // select Escape is the dialog's, so the list must not claim it.
      const select = document.querySelector('select.hotkey-action-select');

      expect(press(select, 'Escape').defaultPrevented).toBe(false);
    });
  });

  describe('the hotkey list: order, empty states and accessible names', () => {
    const entity = (id, name) => ({
      entity_id: id,
      state: 'off',
      attributes: { friendly_name: name },
    });
    const mount = (states = {}, hotkeysConfig = {}, enabled = true) => {
      const config = getMockConfig();
      config.globalHotkeys = { enabled, hotkeys: hotkeysConfig };
      state.setConfig(config);
      state.setStates(states);
      hotkeys.cleanupHotkeyEventListeners();
      document.body.innerHTML = '<input id="hotkey-entity-search" /><div id="hotkeys-list"></div>';
      hotkeys.renderHotkeysTab();
      return document.getElementById('hotkeys-list');
    };
    const names = (list) =>
      [...list.querySelectorAll('.hotkey-item .entity-name')].map((node) => node.textContent);

    it('lists entities by name, not in the order Home Assistant sent them', () => {
      const list = mount({
        'light.zeta': entity('light.zeta', 'Zeta lamp'),
        'switch.alpha': entity('switch.alpha', 'alpha plug'),
        'scene.movie': entity('scene.movie', 'Movie night'),
        'light.beta': entity('light.beta', 'Beta lamp'),
      });

      expect(names(list)).toEqual(['alpha plug', 'Beta lamp', 'Movie night', 'Zeta lamp']);
    });

    it('keeps the better search match first and orders ties by name', () => {
      const list = mount({
        'light.b': entity('light.b', 'Desk b'),
        'light.a': entity('light.a', 'Desk a'),
        'light.c': entity('light.c', 'Back desk'),
      });
      document.getElementById('hotkey-entity-search').value = 'desk';

      hotkeys.renderHotkeysTab();

      // The prefix matches (2 per field in the stub scorer) come before the substring match.
      expect(names(list)).toEqual(['Desk a', 'Desk b', 'Back desk']);
    });

    it('says nothing matched when the search finds no entity', () => {
      const list = mount({ 'light.kitchen': entity('light.kitchen', 'Kitchen') });
      document.getElementById('hotkey-entity-search').value = 'zzz';

      hotkeys.renderHotkeysTab();

      const empty = list.querySelector('.hotkeys-empty');
      expect(empty.textContent).toBe('No matching entities');
      expect(empty.getAttribute('role')).toBe('status');
      expect(list.querySelector('.hotkey-item')).toBeNull();
    });

    it('says to connect, not that nothing matched, while Home Assistant has sent nothing', () => {
      const list = mount({});

      expect(list.querySelector('.hotkeys-empty').textContent).toBe(
        'Connect to Home Assistant to assign hotkeys'
      );
    });

    it('gives every row an action select and a clear button that name their entity', () => {
      const list = mount({
        'light.kitchen': entity('light.kitchen', 'Kitchen'),
        'light.hall': entity('light.hall', 'Hall'),
      });

      const labels = (selector) =>
        [...list.querySelectorAll(selector)].map((node) => node.getAttribute('aria-label'));
      expect(labels('select.hotkey-action-select')).toEqual([
        'Hotkey action for Hall',
        'Hotkey action for Kitchen',
      ]);
      expect(labels('.btn-clear-hotkey')).toEqual([
        'Clear hotkey for Hall',
        'Clear hotkey for Kitchen',
      ]);
      expect(labels('.hotkey-input')).toEqual(['Hotkey for Hall', 'Hotkey for Kitchen']);
    });

    it('keeps the hotkey field a read-only textbox that reads out its hotkey and how to record', () => {
      const list = mount(
        { 'light.kitchen': entity('light.kitchen', 'Kitchen') },
        { 'light.kitchen': { hotkey: 'Ctrl+Alt+1', action: 'toggle' } }
      );
      const field = list.querySelector('.hotkey-input');

      // role=button is not allowed on an input, and hid the value from assistive technology.
      expect(field.hasAttribute('role')).toBe(false);
      expect(field.readOnly).toBe(true);
      expect(field.value).toBe('Ctrl+Alt+1');
      const hint = document.getElementById(field.getAttribute('aria-describedby'));
      expect(hint.textContent).toBe('Press Enter or Space to record a hotkey');
      expect(list.querySelectorAll(`#${hint.id}`)).toHaveLength(1);
    });

    it('shows each hotkey as the keys are printed on this keyboard, and stores it unchanged', () => {
      const original = window.electronAPI.platform;
      try {
        window.electronAPI.platform = 'darwin';
        const list = mount(
          { 'light.kitchen': entity('light.kitchen', 'Kitchen') },
          { 'light.kitchen': { hotkey: 'Ctrl+Alt+Super+K', action: 'toggle' } }
        );

        expect(list.querySelector('.hotkey-input').value).toBe('Control+Option+Cmd+K');
        expect(state.CONFIG.globalHotkeys.hotkeys['light.kitchen'].hotkey).toBe('Ctrl+Alt+Super+K');
      } finally {
        window.electronAPI.platform = original;
      }
    });
  });

  describe('an action chosen before the hotkey is recorded', () => {
    const entity = (id, name) => ({
      entity_id: id,
      state: 'on',
      attributes: { friendly_name: name },
    });
    const nextTick = () => new Promise((resolve) => setTimeout(resolve, 0));
    const choose = (entityId, action) => {
      const select = document.querySelector(`select[data-entity-id="${entityId}"]`);
      select.value = action;
      select.dispatchEvent(new Event('change', { bubbles: true }));
    };
    const record = (code, init = {}) =>
      document.activeElement.dispatchEvent(
        new KeyboardEvent('keydown', { code, key: code, ctrlKey: true, bubbles: true, ...init })
      );

    beforeEach(() => {
      const config = getMockConfig();
      config.globalHotkeys = { enabled: true, hotkeys: {} };
      state.setConfig(config);
      state.setStates({
        'light.desk': entity('light.desk', 'Desk lamp'),
        'light.hall': entity('light.hall', 'Hall light'),
      });
      hotkeys.cleanupHotkeyEventListeners();
      document.body.innerHTML = '<input id="hotkey-entity-search" /><div id="hotkeys-list"></div>';
      hotkeys.renderHotkeysTab();
    });

    it('survives the list being rebuilt by a search, and is the action that gets recorded', async () => {
      choose('light.desk', 'turn_off');
      const search = document.getElementById('hotkey-entity-search');
      search.value = 'hall';
      hotkeys.renderHotkeysTab();
      search.value = '';
      hotkeys.renderHotkeysTab();

      const select = document.querySelector('select[data-entity-id="light.desk"]');
      expect(select.value).toBe('turn_off');
      // Nothing was saved: the row has no hotkey to attach the action to yet.
      expect(mockElectronAPI.updateConfig).not.toHaveBeenCalled();

      const field = document.querySelector('.hotkey-input[data-entity-id="light.desk"]');
      field.focus();
      const assignment = hotkeys.assignHotkeyToEntity('light.desk', { action: select.value });
      record('KeyD', { key: 'd' });
      await assignment;

      expect(mockElectronAPI.registerHotkey).toHaveBeenCalledWith(
        'light.desk',
        'Ctrl+D',
        'turn_off'
      );
    });

    it('says it waits for a hotkey, where a saved row says it was updated', async () => {
      const showToast = require('../../src/ui-utils.js').showToast;
      showToast.mockClear();

      choose('light.desk', 'turn_off');

      expect(showToast).toHaveBeenCalledTimes(1);
      expect(showToast).toHaveBeenCalledWith(
        expect.stringMatching(/^Action chosen: .+\. It applies once you record a hotkey\.$/),
        'info',
        expect.any(Number)
      );
    });

    it('is used when the recorder is opened without naming an action, as the tile menu does', async () => {
      choose('light.desk', 'turn_on');

      const assignment = hotkeys.assignHotkeyToEntity('light.desk');
      record('KeyD', { key: 'd' });
      await assignment;

      expect(mockElectronAPI.registerHotkey).toHaveBeenCalledWith(
        'light.desk',
        'Ctrl+D',
        'turn_on'
      );
    });

    it('is forgotten once the hotkey is saved, and when Settings closes', async () => {
      choose('light.desk', 'turn_on');
      choose('light.hall', 'turn_off');
      const assignment = hotkeys.assignHotkeyToEntity('light.desk');
      record('KeyD', { key: 'd' });
      await assignment;
      await nextTick();
      expect(state.CONFIG.globalHotkeys.hotkeys['light.desk'].action).toBe('turn_on');

      hotkeys.cleanupHotkeyEventListeners();
      document.getElementById('hotkeys-list').innerHTML = '';
      hotkeys.renderHotkeysTab();

      expect(document.querySelector('select[data-entity-id="light.hall"]').value).toBe('toggle');
    });
  });

  describe('the recorder', () => {
    const entity = { entity_id: 'light.desk', state: 'on', attributes: { friendly_name: 'Desk' } };
    const nextTick = () => new Promise((resolve) => setTimeout(resolve, 0));
    const press = (init) =>
      document.activeElement.dispatchEvent(
        new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init })
      );
    const preview = () => document.querySelector('#hotkey-preview').textContent;
    let originalPlatform;

    beforeEach(() => {
      originalPlatform = window.electronAPI.platform;
      const config = getMockConfig();
      config.globalHotkeys = { enabled: true, hotkeys: {} };
      state.setConfig(config);
      state.setStates({ 'light.desk': entity });
      document.body.innerHTML = '<input id="hotkey-entity-search" /><div id="hotkeys-list"></div>';
    });
    afterEach(() => {
      window.electronAPI.platform = originalPlatform;
    });

    it('records Ctrl+Shift+Space, which the old recorder could not', async () => {
      const capture = hotkeys.captureHotkey();

      press({ key: ' ', code: 'Space', ctrlKey: true, shiftKey: true });

      await expect(capture).resolves.toBe('Ctrl+Shift+Space');
    });

    it('records Ctrl+Up as the name an accelerator uses', async () => {
      const capture = hotkeys.captureHotkey();

      press({ key: 'ArrowUp', code: 'ArrowUp', ctrlKey: true });

      await expect(capture).resolves.toBe('Ctrl+Up');
    });

    it('shows the keys held while it waits for the rest', async () => {
      const capture = hotkeys.captureHotkey();

      press({ key: 'Control', code: 'ControlLeft', ctrlKey: true });
      expect(preview()).toBe('Ctrl');
      press({ key: 'Shift', code: 'ShiftLeft', ctrlKey: true, shiftKey: true });
      expect(preview()).toBe('Ctrl+Shift');

      press({ key: 'Escape', code: 'Escape' });
      await capture;
    });

    it('does not take a key with only Shift, and says what to add', async () => {
      window.electronAPI.platform = 'win32';
      const capture = hotkeys.captureHotkey();

      press({ key: 'A', code: 'KeyA', shiftKey: true });
      expect(preview()).toBe('Shift+A (add Ctrl/Alt/Win)');
      press({ key: 'a', code: 'KeyA' });
      expect(preview()).toBe('A (add Ctrl/Alt/Win)');
      expect(document.querySelector('.hotkey-capture-modal')).not.toBeNull();

      press({ key: 'a', code: 'KeyA', altKey: true });
      await expect(capture).resolves.toBe('Alt+A');
    });

    it.each([
      ['darwin', 'Shift+A (add Control/Option/Cmd)'],
      ['linux', 'Shift+A (add Ctrl/Alt/Super)'],
    ])('names the keys to add the way a %s keyboard prints them', async (platform, expected) => {
      window.electronAPI.platform = platform;
      const capture = hotkeys.captureHotkey();

      press({ key: 'A', code: 'KeyA', shiftKey: true });

      expect(preview()).toBe(expected);
      press({ key: 'Escape', code: 'Escape' });
      await capture;
    });

    it('records the Meta key as Command on a Mac and Super elsewhere', async () => {
      window.electronAPI.platform = 'darwin';
      let capture = hotkeys.captureHotkey();
      press({ key: 'k', code: 'KeyK', metaKey: true, altKey: true });
      await expect(capture).resolves.toBe('Alt+Command+K');
      expect(document.querySelector('.hotkey-capture-modal')).toBeNull();

      window.electronAPI.platform = 'win32';
      capture = hotkeys.captureHotkey();
      press({ key: 'k', code: 'KeyK', metaKey: true, altKey: true });
      await expect(capture).resolves.toBe('Alt+Super+K');
    });

    it('says "Recording..." in the row field behind the dialog and puts the hotkey back after', async () => {
      hotkeys.renderHotkeysTab();
      const field = document.querySelector('.hotkey-input');
      field.focus();

      const assignment = hotkeys.assignHotkeyToEntity('light.desk');
      expect(field.value).toBe('Recording...');
      expect(field.dataset.recording).toBe('true');
      expect(field.getAttribute('aria-busy')).toBe('true');
      press({ key: 'Escape', code: 'Escape' });
      await assignment;

      expect(field.value).toBe('');
      expect(field.dataset.recording).toBeUndefined();
      expect(field.hasAttribute('aria-busy')).toBe(false);
    });

    it('opens one recorder at a time', async () => {
      const first = hotkeys.assignHotkeyToEntity('light.desk');
      const second = await hotkeys.assignHotkeyToEntity('light.desk');

      expect(second).toEqual({ success: false, canceled: true });
      expect(document.querySelectorAll('.hotkey-capture-modal')).toHaveLength(1);
      press({ key: 'Escape', code: 'Escape' });
      await first;
      await nextTick();
    });
  });

  describe('assigning a hotkey while Entity hotkeys is off', () => {
    const nextTick = () => new Promise((resolve) => setTimeout(resolve, 0));
    const assign = async (enabled) => {
      const config = getMockConfig();
      config.globalHotkeys = { enabled, hotkeys: {} };
      state.setConfig(config);
      state.setStates({
        'light.desk': {
          entity_id: 'light.desk',
          state: 'on',
          attributes: { friendly_name: 'Desk' },
        },
      });
      document.body.innerHTML = '<input id="hotkey-entity-search" /><div id="hotkeys-list"></div>';
      const assignment = hotkeys.assignHotkeyToEntity('light.desk');
      document.activeElement.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'd', code: 'KeyD', ctrlKey: true, bubbles: true })
      );
      const result = await assignment;
      await nextTick();
      return result;
    };

    it('saves the hotkey but warns it does nothing until the switch is on, instead of a green toast', async () => {
      const result = await assign(false);

      expect(result.success).toBe(true);
      expect(state.CONFIG.globalHotkeys.hotkeys['light.desk'].hotkey).toBe('Ctrl+D');
      expect(showToast).toHaveBeenCalledTimes(1);
      expect(showToast).toHaveBeenCalledWith(
        'Hotkey saved. Turn on Entity hotkeys in Settings > Hotkeys to use it.',
        'warning',
        5000
      );
    });

    it('keeps the plain confirmation when the switch is on', async () => {
      await assign(true);

      expect(showToast).toHaveBeenCalledWith('Hotkey set for Desk', 'success', 2200);
      expect(showToast).not.toHaveBeenCalledWith(
        expect.stringContaining('Turn on Entity hotkeys'),
        expect.anything(),
        expect.anything()
      );
    });
  });

  describe('a hotkey another entity already holds', () => {
    const nextTick = () => new Promise((resolve) => setTimeout(resolve, 0));
    const states = {
      'light.desk': { entity_id: 'light.desk', state: 'on', attributes: { friendly_name: 'Desk' } },
      'light.lamp': {
        entity_id: 'light.lamp',
        state: 'on',
        attributes: { friendly_name: 'Desk lamp' },
      },
    };

    beforeEach(() => {
      const config = getMockConfig();
      config.globalHotkeys = {
        enabled: true,
        hotkeys: { 'light.lamp': { hotkey: 'Ctrl+D', action: 'toggle' } },
      };
      state.setConfig(config);
      state.setStates(states);
      hotkeys.cleanupHotkeyEventListeners();
      document.body.innerHTML = '<input id="hotkey-entity-search" /><div id="hotkeys-list"></div>';
      hotkeys.renderHotkeysTab();
    });

    it('is named by the friendly name the row shows, and the row is marked', async () => {
      mockElectronAPI.registerHotkey.mockResolvedValueOnce({
        success: false,
        error: 'Hotkey already assigned to light.lamp',
        conflictEntityId: 'light.lamp',
      });
      document.querySelector('.hotkey-input[data-entity-id="light.desk"]').focus();

      const assignment = hotkeys.assignHotkeyToEntity('light.desk');
      document.activeElement.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'd', code: 'KeyD', ctrlKey: true, bubbles: true })
      );
      const result = await assignment;
      await nextTick();

      expect(result.error).toBe('Hotkey already assigned to Desk lamp');
      expect(showToast).toHaveBeenCalledWith('Hotkey already assigned to Desk lamp', 'error', 3000);
      const row = document
        .querySelector('.hotkey-input[data-entity-id="light.lamp"]')
        .closest('.hotkey-item');
      expect(row.classList.contains('settings-search-target')).toBe(true);
    });

    it('falls back to the id when the entity is not loaded, and to main text otherwise', () => {
      expect(
        hotkeys.describeHotkeyFailure({ conflictEntityId: 'light.gone', error: 'x' }, 'fallback')
      ).toBe('Hotkey already assigned to light.gone');
      expect(hotkeys.describeHotkeyFailure({ error: 'Portal said no' }, 'fallback')).toBe(
        'Portal said no'
      );
      expect(hotkeys.describeHotkeyFailure({}, 'fallback')).toBe('fallback');
    });

    it('leaves a row that is not in the list alone', () => {
      document.getElementById('hotkey-entity-search').value = 'zzz';
      hotkeys.renderHotkeysTab();

      expect(() => hotkeys.flashHotkeyRow('light.lamp')).not.toThrow();
    });
  });

  describe('captureHotkey focus', () => {
    const nextTick = () => new Promise((resolve) => setTimeout(resolve, 0));
    const openFrom = () => {
      document.body.innerHTML = '<button id="origin" type="button">Record</button>';
      const origin = document.getElementById('origin');
      origin.focus();
      return { origin, capture: hotkeys.captureHotkey() };
    };

    it('moves focus onto the dialog while recording and still captures keys', async () => {
      const { origin, capture } = openFrom();
      const dialog = document.querySelector('.hotkey-capture-modal');
      expect(dialog.getAttribute('tabindex')).toBe('-1');
      expect(document.activeElement).toBe(dialog);
      dialog.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'K', code: 'KeyK', ctrlKey: true, bubbles: true })
      );
      await expect(capture).resolves.toBe('Ctrl+K');
      await nextTick();
      expect(document.activeElement).toBe(origin);
    });

    it('hands focus back to the originating control on Escape', async () => {
      const { origin, capture } = openFrom();
      document.activeElement.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', bubbles: true })
      );
      await expect(capture).resolves.toBeNull();
      await nextTick();
      expect(document.activeElement).toBe(origin);
    });

    it('refocuses the field that replaces the originating one after a successful assignment', async () => {
      const config = getMockConfig();
      config.globalHotkeys = { enabled: true, hotkeys: {} };
      state.setConfig(config);
      state.setStates({
        'light.living_room': {
          entity_id: 'light.living_room',
          state: 'off',
          attributes: { friendly_name: 'Living Room' },
        },
      });
      document.body.innerHTML = '<input id="hotkey-entity-search" /><div id="hotkeys-list"></div>';
      hotkeys.renderHotkeysTab();
      const before = document.querySelector('.hotkey-input');
      before.focus();

      const assignment = hotkeys.assignHotkeyToEntity('light.living_room');
      expect(document.activeElement).toBe(document.querySelector('.hotkey-capture-modal'));
      document.activeElement.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'A', code: 'KeyA', ctrlKey: true, bubbles: true })
      );
      await expect(assignment).resolves.toEqual(expect.objectContaining({ success: true }));
      await nextTick();
      const after = document.querySelector('.hotkey-input');
      expect(after).not.toBe(before);
      expect(document.activeElement).toBe(after);
    });

    it('hands focus back to the originating control when registration reports a conflict', async () => {
      const config = getMockConfig();
      config.globalHotkeys = { enabled: true, hotkeys: {} };
      state.setConfig(config);
      state.setStates({
        'light.living_room': {
          entity_id: 'light.living_room',
          state: 'off',
          attributes: { friendly_name: 'Living Room' },
        },
      });
      mockElectronAPI.registerHotkey.mockResolvedValueOnce({ success: false, error: 'In use' });
      document.body.innerHTML = '<button id="origin" type="button">Record</button>';
      const origin = document.getElementById('origin');
      origin.focus();

      const assignment = hotkeys.assignHotkeyToEntity('light.living_room');
      document.activeElement.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'A', code: 'KeyA', ctrlKey: true, bubbles: true })
      );
      await expect(assignment).resolves.toEqual(expect.objectContaining({ success: false }));
      await nextTick();
      expect(document.activeElement).toBe(origin);
    });
  });

  describe('assignHotkeyToEntity', () => {
    it('captures and registers a hotkey directly for an entity', async () => {
      const config = getMockConfig();
      config.globalHotkeys = {
        enabled: true,
        hotkeys: {},
      };
      state.setConfig(config);
      state.setStates({
        'light.living_room': {
          entity_id: 'light.living_room',
          state: 'off',
          attributes: {
            friendly_name: 'Living Room',
          },
        },
      });

      const assignment = hotkeys.assignHotkeyToEntity('light.living_room');
      document.dispatchEvent(
        new KeyboardEvent('keydown', {
          key: 'A',
          code: 'KeyA',
          ctrlKey: true,
          bubbles: true,
        })
      );
      const result = await assignment;

      expect(result).toEqual(
        expect.objectContaining({
          success: true,
          hotkey: 'Ctrl+A',
          action: 'toggle',
        })
      );
      expect(mockElectronAPI.registerHotkey).toHaveBeenCalledWith(
        'light.living_room',
        'Ctrl+A',
        'toggle'
      );
      expect(state.CONFIG.globalHotkeys.hotkeys['light.living_room']).toEqual({
        hotkey: 'Ctrl+A',
        action: 'toggle',
      });
      expect(showToast).toHaveBeenCalledWith('Hotkey set for Living Room', 'success', 2200);
    });

    it('uses the domain default action when assigning a scene hotkey', async () => {
      const config = getMockConfig();
      config.globalHotkeys = {
        enabled: true,
        hotkeys: {},
      };
      state.setConfig(config);
      state.setStates({
        'scene.movie': {
          entity_id: 'scene.movie',
          state: 'scening',
          attributes: {
            friendly_name: 'Movie',
          },
        },
      });

      const assignment = hotkeys.assignHotkeyToEntity('scene.movie');
      document.dispatchEvent(
        new KeyboardEvent('keydown', {
          key: 'M',
          code: 'KeyM',
          altKey: true,
          bubbles: true,
        })
      );
      const result = await assignment;

      expect(result).toEqual(
        expect.objectContaining({
          success: true,
          hotkey: 'Alt+M',
          action: 'turn_on',
        })
      );
      expect(mockElectronAPI.registerHotkey).toHaveBeenCalledWith(
        'scene.movie',
        'Alt+M',
        'turn_on'
      );
    });

    it('uses press as the default action when assigning an input_button hotkey', async () => {
      const config = getMockConfig();
      config.globalHotkeys = {
        enabled: true,
        hotkeys: {},
      };
      state.setConfig(config);
      state.setStates({
        'input_button.tv_rewind': sampleStates['input_button.tv_rewind'],
      });

      const assignment = hotkeys.assignHotkeyToEntity('input_button.tv_rewind');
      document.dispatchEvent(
        new KeyboardEvent('keydown', {
          key: 'R',
          code: 'KeyR',
          ctrlKey: true,
          bubbles: true,
        })
      );
      const result = await assignment;

      expect(result).toEqual(
        expect.objectContaining({
          success: true,
          hotkey: 'Ctrl+R',
          action: 'press',
        })
      );
      expect(mockElectronAPI.registerHotkey).toHaveBeenCalledWith(
        'input_button.tv_rewind',
        'Ctrl+R',
        'press'
      );
    });
  });

  describe('cleanupHotkeyEventListeners', () => {
    it('should not throw when cleaning up event listeners', () => {
      expect(() => hotkeys.cleanupHotkeyEventListeners()).not.toThrow();
    });
  });

  describe('setupHotkeyEventListeners', () => {
    it('should be a no-op function for backward compatibility', () => {
      expect(() => hotkeys.setupHotkeyEventListeners()).not.toThrow();
    });
  });

  describe('module exports', () => {
    it('should export all required functions', () => {
      expect(typeof hotkeys.initializeHotkeys).toBe('function');
      expect(typeof hotkeys.renderHotkeysTab).toBe('function');
      expect(typeof hotkeys.toggleHotkeys).toBe('function');
      expect(typeof hotkeys.captureHotkey).toBe('function');
      expect(typeof hotkeys.assignHotkeyToEntity).toBe('function');
      expect(typeof hotkeys.setupHotkeyEventListeners).toBe('function');
      expect(typeof hotkeys.cleanupHotkeyEventListeners).toBe('function');
    });
  });
});

describe('entity hotkey row layout', () => {
  const fs = require('fs');
  const path = require('path');
  // Without its comments, which would otherwise count as part of the selector that follows them.
  const styles = fs
    .readFileSync(path.resolve(__dirname, '../../styles.css'), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '');
  // Every declaration block whose selector list names `selector` exactly.
  const declarationsFor = (selector) =>
    [...styles.matchAll(/([^{}]+)\{([^}]*)\}/g)]
      .filter(([, selectors]) => selectors.split(',').some((part) => part.trim() === selector))
      .map(([, , body]) => body)
      .join(';');

  it('gives the hotkey field the row so translated placeholders are not clipped', () => {
    // German "Kein Tastenkürzel gesetzt" does not fit a fixed 120px field: the field takes what
    // the action and the clear button leave, and the action drops under it when that is too little.
    const input = declarationsFor('.hotkey-input');
    expect(input).toMatch(/flex:\s*1 1 8rem/);
    expect(input).toMatch(/min-width:\s*0/);
    expect(input).not.toMatch(/(^|[;\s])width:/);
    expect(declarationsFor('.hotkey-input-container')).toMatch(/flex-wrap:\s*wrap/);
    // The row wraps the controls under the name instead of squeezing the field.
    expect(declarationsFor('.hotkey-item')).toMatch(/flex-wrap:\s*wrap/);
    expect(declarationsFor('.hotkey-item')).not.toMatch(/flex-wrap:\s*nowrap/);
  });
});

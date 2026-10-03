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
  showToast: jest.fn(),
  // Mirrors the real shared modal helper, which settles synchronously under NODE_ENV=test.
  closeModal: jest.fn((modal, { remove = false, releaseFocus = false, onClosed } = {}) => {
    if (modal) {
      modal.classList.remove('modal-closing');
      if (remove) modal.remove();
      else modal.classList.add('hidden');
      if (releaseFocus) jest.requireActual('../../src/ui-utils.js').releaseFocusTrap(modal);
      onClosed?.();
    }
    return Promise.resolve();
  }),
  trapFocus: jest.fn((...args) => jest.requireActual('../../src/ui-utils.js').trapFocus(...args)),
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
      expect(select.getAttribute('aria-label')).toBe('Hotkey action');
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
          Remove: 'Entfernen',
          'Action updated to: {{action}}': 'Aktion geändert: {{action}}',
        },
      });
      try {
        const container = document.createElement('div');
        const searchInput = document.createElement('input');
        const existing = document.createElement('div');
        container.id = 'hotkeys-list';
        searchInput.id = 'hotkey-entity-search';
        searchInput.value = 'living';
        existing.id = 'existing-hotkeys-list';
        document.body.append(container, searchInput, existing);
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

        hotkeys.renderExistingHotkeys();
        expect(existing.querySelector('.btn-remove-hotkey').textContent).toBe('Entfernen');
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

  describe('renderExistingHotkeys', () => {
    beforeEach(() => {
      const config = getMockConfig();
      config.globalHotkeys = {
        enabled: true,
        hotkeys: {
          'light.living_room': { hotkey: 'Ctrl+Shift+L', action: 'toggle' },
          'switch.bedroom': 'Ctrl+Shift+B',
        },
      };
      state.setConfig(config);
      state.setStates(sampleStates);
    });

    it('should handle missing container gracefully', () => {
      document.getElementById = jest.fn(() => null);

      expect(() => hotkeys.renderExistingHotkeys()).not.toThrow();
    });

    it('should render existing hotkeys', () => {
      // Create real DOM element
      const container = document.createElement('div');
      container.id = 'existing-hotkeys-list';
      document.body.appendChild(container);

      expect(() => hotkeys.renderExistingHotkeys()).not.toThrow();

      document.body.removeChild(container);
    });

    it('should skip entities that do not exist in STATES', () => {
      const config = getMockConfig();
      config.globalHotkeys = {
        enabled: true,
        hotkeys: {
          'light.living_room': { hotkey: 'Ctrl+Shift+L', action: 'toggle' },
          'light.nonexistent': 'Ctrl+Shift+N',
        },
      };
      state.setConfig(config);

      // Create real DOM element
      const container = document.createElement('div');
      container.id = 'existing-hotkeys-list';
      document.body.appendChild(container);

      expect(() => hotkeys.renderExistingHotkeys()).not.toThrow();

      document.body.removeChild(container);
    });

    it('should handle rendering errors gracefully', () => {
      const consoleError = jest.spyOn(console, 'error').mockImplementation();

      document.getElementById = jest.fn(() => {
        throw new Error('DOM error');
      });

      expect(() => hotkeys.renderExistingHotkeys()).not.toThrow();
      expect(consoleError).toHaveBeenCalledWith(
        'Error rendering existing hotkeys:',
        expect.any(Error)
      );

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
      settings.addEventListener('keydown', (event) => {
        if (event.key === 'Escape') settingsEscape();
      });
      uiUtils.trapFocus(settings, { initialFocus: false });

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
      expect(typeof hotkeys.renderExistingHotkeys).toBe('function');
      expect(typeof hotkeys.assignHotkeyToEntity).toBe('function');
      expect(typeof hotkeys.setupHotkeyEventListeners).toBe('function');
      expect(typeof hotkeys.cleanupHotkeyEventListeners).toBe('function');
    });
  });
});

describe('entity hotkey row layout', () => {
  const fs = require('fs');
  const path = require('path');
  const styles = fs.readFileSync(path.resolve(__dirname, '../../styles.css'), 'utf8');
  // Every declaration block whose selector list names `selector` exactly.
  const declarationsFor = (selector) =>
    [...styles.matchAll(/([^{}]+)\{([^}]*)\}/g)]
      .filter(([, selectors]) => selectors.split(',').some((part) => part.trim() === selector))
      .map(([, , body]) => body)
      .join(';');

  it('sizes the hotkey field to its text so translated placeholders are not clipped', () => {
    // German "Kein Tastenkürzel gesetzt" does not fit a fixed 120px field.
    const input = declarationsFor('.hotkey-input');
    expect(input).toMatch(/field-sizing:\s*content/);
    expect(input).not.toMatch(/(^|[;\s])width:/);
    // The row wraps the controls under the name instead of squeezing the field.
    expect(declarationsFor('.hotkey-item')).toMatch(/flex-wrap:\s*wrap/);
    expect(declarationsFor('.hotkey-item')).not.toMatch(/flex-wrap:\s*nowrap/);
  });
});

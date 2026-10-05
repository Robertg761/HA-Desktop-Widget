/**
 * @jest-environment jsdom
 */

const { createMockElectronAPI } = require('../mocks/electron.js');

window.electronAPI = createMockElectronAPI();

jest.mock('../../src/camera.js', () => ({
  CAMERA_PREVIEW_REFRESH_OPTIONS: [],
  disposeCameraPreview: jest.fn(),
  mountCameraPreview: jest.fn(),
  normalizeCameraPreviewRefresh: jest.fn(() => 'off'),
  openCamera: jest.fn(),
  pruneCameraPreviews: jest.fn(),
  refreshCameraPreview: jest.fn(),
}));
jest.mock('../../src/icons.js', () => ({
  setIconContent: jest.fn(),
  applyCloseButtonIcons: jest.fn(),
}));
jest.mock('sortablejs', () => ({ create: jest.fn(() => ({ destroy: jest.fn() })) }));

jest.mock('../../src/ui-utils.js', () => ({
  showToast: jest.fn(),
  showConfirm: jest.fn().mockResolvedValue(false),
  showLoading: jest.fn(),
  setStatus: jest.fn(),
  applyTheme: jest.fn(),
  applyUiPreferences: jest.fn(),
  hexToRgb: jest.fn(() => null),
  miredsToKelvin: jest.fn(() => null),
  hasSupportedFeature: jest.fn(() => false),
  ...require('../helpers/ui-utils-dialogs').realDialogHelpers(),
}));

jest.mock('../../src/websocket.js', () => ({
  callService: jest.fn().mockResolvedValue({}),
  callServiceWithResponse: jest.fn().mockResolvedValue({}),
  request: jest.fn().mockResolvedValue({ result: {} }),
  on: jest.fn(),
  emit: jest.fn(),
}));

const ui = require('../../src/ui.js');
const state = require('../../src/state.js').default;

const kitchen = {
  entity_id: 'light.kitchen',
  state: 'on',
  attributes: { friendly_name: 'Kitchen' },
};
const hallway = {
  entity_id: 'light.hallway',
  state: 'off',
  attributes: { friendly_name: 'Hallway' },
};

describe('entity-specific accessible names on row buttons', () => {
  beforeEach(() => {
    document.body.innerHTML =
      '<div id="quick-controls"></div><input id="quick-controls-search" /><div id="quick-controls-list"></div>';
    state.setServices({});
    state.setAreas({});
    state.setUnitSystem({});
    state.setConfig({
      homeAssistant: { url: 'http://ha.local', token: 'x' },
      customTabs: [{ id: 'default', name: 'All', entityIds: [kitchen.entity_id] }],
      activeTabId: 'default',
      favoriteEntities: [kitchen.entity_id],
      primaryCards: ['none', 'none'],
      ui: {},
    });
    state.setStates({ [kitchen.entity_id]: kitchen, [hallway.entity_id]: hallway });
  });

  it('names each Add and Remove button in the Quick Access picker for its entity', () => {
    ui.populateQuickControlsList();

    const button = (entity) =>
      document.querySelector(`.entity-selector-btn[data-entity-id="${entity.entity_id}"]`);
    expect(button(kitchen).textContent).toBe('Remove');
    expect(button(kitchen).getAttribute('aria-label')).toBe('Remove Kitchen');
    expect(button(hallway).textContent).toBe('Add');
    expect(button(hallway).getAttribute('aria-label')).toBe('Add Hallway');
  });

  it('keeps the visible word at the start of the name, so voice control can say it', () => {
    ui.populateQuickControlsList();

    for (const button of document.querySelectorAll('.entity-selector-btn')) {
      expect(button.getAttribute('aria-label').startsWith(button.textContent)).toBe(true);
    }
  });

  it('gives every row of the list a different name', () => {
    ui.populateQuickControlsList();

    const names = [...document.querySelectorAll('.entity-selector-btn')].map((button) =>
      button.getAttribute('aria-label')
    );
    expect(new Set(names).size).toBe(names.length);
    expect(names.length).toBeGreaterThanOrEqual(2);
  });

  it('names the Use buttons of the repair picker for the entity they would use', () => {
    state.setConfig({
      ...state.CONFIG,
      customTabs: [{ id: 'default', name: 'All', entityIds: ['light.renamed_away'] }],
      favoriteEntities: ['light.renamed_away'],
    });
    ui.renderActiveTab();
    document.querySelector('.control-item[data-entity-id="light.renamed_away"]').click();

    const modal = document.getElementById('entity-repair-modal');
    const use = (entity) => modal.querySelector(`[data-entity-id="${entity.entity_id}"]`);
    expect(use(kitchen).textContent).toBe('Use');
    expect(use(kitchen).getAttribute('aria-label')).toBe('Use Kitchen');
    expect(use(hallway).getAttribute('aria-label')).toBe('Use Hallway');
  });

  it('tells the blinds Close action from the dialog Close by the cover it closes', () => {
    jest.useFakeTimers();
    try {
      const blinds = {
        entity_id: 'cover.blinds',
        state: 'open',
        attributes: {
          friendly_name: 'Living Room Blinds',
          current_position: 60,
          supported_features: 15,
        },
      };
      state.setStates({ [blinds.entity_id]: blinds });

      ui.openEntityDetailModal(blinds);
      jest.advanceTimersByTime(0);

      const modal = document.querySelector('.cover-modal');
      const names = [...modal.querySelectorAll('button')].map(
        (button) => button.getAttribute('aria-label') || button.textContent.trim()
      );
      // Three buttons said "Close": the header X, the close-cover action and the footer button.
      // The action names its cover, and the footer leaves the dialog as Done.
      expect(names.filter((name) => name === 'Close')).toHaveLength(1);
      expect(modal.querySelector('#cover-cancel').textContent.trim()).toBe('Done');
      expect(
        modal
          .querySelector('.cover-action-btn[data-action="close_cover"]')
          .getAttribute('aria-label')
      ).toBe('Close Living Room Blinds');
      expect(
        modal
          .querySelector('.cover-action-btn[data-action="open_cover"]')
          .getAttribute('aria-label')
      ).toBe('Open Living Room Blinds');
      expect(
        modal
          .querySelector('.cover-action-btn[data-action="stop_cover"]')
          .getAttribute('aria-label')
      ).toBe('Stop Living Room Blinds');
    } finally {
      document.querySelector('.cover-modal')?.remove();
      jest.useRealTimers();
    }
  });

  describe('the light dialog colour swatches', () => {
    const colorLight = (rgb) => ({
      entity_id: 'light.desk',
      state: 'on',
      attributes: {
        friendly_name: 'Desk lamp',
        brightness: 200,
        supported_color_modes: ['rgb'],
        color_mode: 'rgb',
        rgb_color: rgb,
      },
    });
    const open = (light) => {
      jest.useFakeTimers();
      state.setStates({ [light.entity_id]: light });
      ui.openEntityDetailModal(light);
      jest.advanceTimersByTime(0);
      return document.querySelector('.brightness-modal');
    };
    afterEach(() => {
      document.querySelector('.brightness-modal')?.remove();
      jest.useRealTimers();
    });

    it('are named for their colour, not their hex code', () => {
      const modal = open(colorLight([255, 179, 71]));

      const names = [...modal.querySelectorAll('.light-color-swatch')].map((swatch) =>
        swatch.getAttribute('aria-label')
      );
      expect(names).toEqual([
        'Set light color Amber',
        'Set light color Yellow',
        'Set light color White',
        'Set light color Sky blue',
        'Set light color Indigo',
        'Set light color Pink',
      ]);
      expect(names.join(' ')).not.toMatch(/#/);
      const titles = [...modal.querySelectorAll('.light-color-swatch')].map(
        (swatch) => swatch.title
      );
      expect(titles).toEqual(['Amber', 'Yellow', 'White', 'Sky blue', 'Indigo', 'Pink']);
    });

    it('mark the colour the light has now, and follow a pick', () => {
      const modal = open(colorLight([255, 179, 71]));
      const swatch = (hex) => modal.querySelector(`.light-color-swatch[data-color="${hex}"]`);

      expect(swatch('#FFB347').getAttribute('aria-pressed')).toBe('true');
      expect(swatch('#FFB347').classList).toContain('active');
      expect(swatch('#FFD966').getAttribute('aria-pressed')).toBe('false');

      swatch('#9FD8FF').click();

      expect(swatch('#9FD8FF').getAttribute('aria-pressed')).toBe('true');
      expect(swatch('#9FD8FF').classList).toContain('active');
      expect(swatch('#FFB347').getAttribute('aria-pressed')).toBe('false');
      expect(modal.querySelectorAll('.light-color-swatch.active')).toHaveLength(1);
    });

    it('mark nothing for a colour that is none of them', () => {
      const modal = open(colorLight([10, 20, 30]));

      expect(modal.querySelectorAll('.light-color-swatch.active')).toHaveLength(0);
      expect(modal.querySelectorAll('.light-color-swatch[aria-pressed="true"]')).toHaveLength(0);
    });
  });

  describe('the preset chips of the light and fan dialogs', () => {
    const pressed = (modal, selector) =>
      [...modal.querySelectorAll(selector)]
        .filter((chip) => chip.getAttribute('aria-pressed') === 'true')
        .map((chip) => chip.textContent.trim());
    const open = (entity, selector) => {
      jest.useFakeTimers();
      state.setStates({ [entity.entity_id]: entity });
      ui.openEntityDetailModal(entity);
      jest.advanceTimersByTime(0);
      return document.querySelector(selector);
    };
    afterEach(() => {
      document.querySelector('.brightness-modal')?.remove();
      document.querySelector('.fan-modal')?.remove();
      jest.useRealTimers();
    });

    it('mark the brightness the light has, and follow a pick', () => {
      const modal = open(
        {
          entity_id: 'light.desk',
          state: 'on',
          attributes: { friendly_name: 'Desk lamp', brightness: 128 },
        },
        '.brightness-modal'
      );
      const chips = '.brightness-preset-btn';

      expect(pressed(modal, chips)).toEqual(['50%']);
      expect(modal.querySelectorAll(`${chips}.active`)).toHaveLength(1);

      modal.querySelector('.brightness-preset-btn[data-preset="75"]').click();

      expect(pressed(modal, chips)).toEqual(['75%']);
      expect(modal.querySelectorAll(`${chips}.active`)).toHaveLength(1);
      // A level between two presets is none of them.
      const slider = modal.querySelector('#brightness-slider');
      slider.value = '60';
      slider.dispatchEvent(new Event('input', { bubbles: true }));
      expect(pressed(modal, chips)).toEqual([]);
      expect(modal.querySelectorAll(`${chips}[aria-pressed="false"]`)).toHaveLength(4);
    });

    it('write the brightness presets as the readout above them is written', () => {
      // German spaces the sign ("80 %"); the chips were a fixed "25%" under that readout.
      const i18n = require('../../src/i18n.js');
      i18n.setLocaleBootstrap({ activeLocale: 'de', messages: {} });
      try {
        const modal = open(
          {
            entity_id: 'light.desk',
            state: 'on',
            attributes: { friendly_name: 'Desk lamp', brightness: 128 },
          },
          '.brightness-modal'
        );
        const labels = [...modal.querySelectorAll('.brightness-preset-btn')].map(
          (chip) => chip.textContent
        );
        expect(labels).toEqual(['25\u00a0%', '50\u00a0%', '75\u00a0%', '100\u00a0%']);
      } finally {
        i18n.setLocaleBootstrap({ activeLocale: 'en', messages: {} });
      }
    });

    it('mark the fan speed the fan has, and follow a pick', () => {
      const modal = open(
        {
          entity_id: 'fan.office',
          state: 'on',
          attributes: { friendly_name: 'Office Fan', percentage: 66, supported_features: 1 },
        },
        '.fan-modal'
      );
      const chips = '.fan-preset-btn';

      expect(pressed(modal, chips)).toEqual(['Medium']);

      modal.querySelector('.fan-preset-btn[data-speed="100"]').click();

      expect(pressed(modal, chips)).toEqual(['High']);
      expect(modal.querySelectorAll(`${chips}.active`)).toHaveLength(1);
    });
  });
});

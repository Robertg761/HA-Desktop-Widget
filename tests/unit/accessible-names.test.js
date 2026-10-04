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
});

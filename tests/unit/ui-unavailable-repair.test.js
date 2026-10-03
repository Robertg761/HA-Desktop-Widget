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

const STALE_ID = 'light.renamed_away';

const replacement = {
  entity_id: 'light.kitchen',
  state: 'on',
  attributes: { friendly_name: 'Kitchen' },
};

function setupConfig() {
  state.setConfig({
    homeAssistant: { url: 'http://ha.local', token: 'x' },
    customTabs: [
      { id: 'default', name: 'All', entityIds: [STALE_ID] },
      { id: 'other', name: 'Other', entityIds: [] },
    ],
    activeTabId: 'default',
    favoriteEntities: [STALE_ID],
    primaryCards: ['none', 'none'],
    ui: {},
  });
}

const staleTile = () => document.querySelector(`.control-item[data-entity-id="${STALE_ID}"]`);

// Redraws the grid from a config change, a page switch, rather than from renderActiveTab().
async function switchAwayAndBack() {
  await ui.switchQuickAccessPage('other');
  await ui.switchQuickAccessPage('default');
}

describe('unavailable Quick Access tile repair affordance', () => {
  beforeEach(() => {
    document.body.innerHTML = '<div id="quick-controls"></div>';
    state.setServices({});
    state.setAreas({});
    state.setUnitSystem({});
    setupConfig();
  });

  it('does not offer repair while no entities have been received from Home Assistant', async () => {
    state.setStates({});

    // renderActiveTab() covers the empty-state grid with a "connecting" notice, but the grid also
    // re-renders on its own from config changes such as a page switch — that is where every
    // favorite would otherwise advertise a repair picker with nothing to pick from.
    await switchAwayAndBack();

    const tile = staleTile();
    expect(tile).not.toBeNull();
    expect(tile.classList.contains('unavailable-entity')).toBe(true);
    expect(tile.classList.contains('repairable')).toBe(false);
    expect(tile.querySelector('.unavailable-state').textContent).toBe('Unavailable');
    expect(tile.getAttribute('aria-label')).not.toContain('Click');

    tile.click();

    expect(document.getElementById('entity-repair-modal')).toBeNull();
  });

  it('offers repair once entities are available', () => {
    state.setStates({ [replacement.entity_id]: replacement });

    ui.renderActiveTab();

    const tile = staleTile();
    expect(tile.classList.contains('repairable')).toBe(true);
    expect(tile.querySelector('.unavailable-state').textContent).toBe('Click to repair');

    tile.click();

    const modal = document.getElementById('entity-repair-modal');
    expect(modal).not.toBeNull();
    expect(modal.querySelector(`[data-entity-id="${replacement.entity_id}"]`)).not.toBeNull();
  });

  it('makes a repairable unavailable primary card keyboard-focusable and activatable', () => {
    document.body.innerHTML = `
      <div id="quick-controls"></div>
      <div class="status-grid">
        <div id="weather-card"></div>
        <div id="time-card"></div>
      </div>
    `;
    state.setConfig({
      ...state.CONFIG,
      primaryCards: [STALE_ID, 'none'],
    });
    state.setStates({ [replacement.entity_id]: replacement });

    ui.renderPrimaryCards();

    const control = document.querySelector(
      `#weather-card .control-item[data-entity-id="${STALE_ID}"]`
    );
    expect(control).not.toBeNull();
    expect(control.dataset.primaryCard).toBe('true');
    expect(control.getAttribute('tabindex')).toBe('0');

    control.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', bubbles: true }));

    expect(document.getElementById('entity-repair-modal')).not.toBeNull();
  });

  it('picks up the repair affordance when a reused tile sees entities arrive', async () => {
    state.setStates({});
    await switchAwayAndBack();
    const firstTile = staleTile();
    expect(firstTile.classList.contains('repairable')).toBe(false);

    state.setStates({ [replacement.entity_id]: replacement });
    ui.renderActiveTab();

    const tile = staleTile();
    expect(tile).toBe(firstTile);
    expect(tile.classList.contains('repairable')).toBe(true);
    expect(tile.querySelector('.unavailable-state').textContent).toBe('Click to repair');

    tile.click();
    expect(document.getElementById('entity-repair-modal')).not.toBeNull();
  });

  it('builds the picker from the shared field and list classes, with the search first', async () => {
    state.setStates({ [replacement.entity_id]: replacement });
    ui.renderActiveTab();
    staleTile().click();

    const modal = document.getElementById('entity-repair-modal');
    const search = modal.querySelector('input[type="search"]');
    expect(search.closest('.form-group')).not.toBeNull();
    expect(search.spellcheck).toBe(false);
    expect(modal.querySelector('.modal-lead').textContent).toContain(STALE_ID);
    // The search is the first thing to do here, so focus starts on it, not on the close button.
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(document.activeElement).toBe(search);
    expect(modal.getAttribute('role')).toBe('dialog');
    expect(modal.getAttribute('aria-describedby')).toBe(modal.querySelector('.modal-lead').id);

    search.value = 'no such entity';
    search.dispatchEvent(new Event('input'));
    expect(modal.querySelector('.entity-selector-empty').textContent).toMatch(/No matching/);
  });

  it('closes with Escape or the backdrop and returns focus to the tile it was opened from', async () => {
    state.setStates({ [replacement.entity_id]: replacement });
    ui.renderActiveTab();
    const tile = staleTile();
    tile.focus();
    tile.click();
    await new Promise((resolve) => setTimeout(resolve, 0));
    const modal = document.getElementById('entity-repair-modal');

    modal
      .querySelector('input[type="search"]')
      .dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })
      );
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(document.getElementById('entity-repair-modal')).toBeNull();
    expect(document.activeElement).toBe(tile);

    tile.click();
    document.getElementById('entity-repair-modal').click();
    expect(document.getElementById('entity-repair-modal')).toBeNull();
  });
});

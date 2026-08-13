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

const mockReleaseCalls = [];
const mockReleaseFocusTrap = jest.fn((modal) => {
  // Record connectedness at call time: `isConnected` is live, so reading it after the assertion
  // would always report false once the modal is detached.
  mockReleaseCalls.push({ modal, wasConnected: !!modal?.isConnected });
});
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
  trapFocus: jest.fn(),
  releaseFocusTrap: (...args) => mockReleaseFocusTrap(...args),
  // Mirrors the real shared modal helper, which settles synchronously under NODE_ENV=test.
  closeModal: jest.fn((modal, { remove = false, onClosed } = {}) => {
    if (modal) {
      modal.classList.remove('modal-closing');
      if (remove) modal.remove();
      else modal.classList.add('hidden');
      onClosed?.();
    }
    return Promise.resolve();
  }),
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
    customTabs: [{ id: 'default', name: 'All', entityIds: [STALE_ID] }],
    activeTabId: 'default',
    favoriteEntities: [STALE_ID],
    primaryCards: ['none', 'none'],
    ui: {},
  });
}

const staleTile = () => document.querySelector(`.control-item[data-entity-id="${STALE_ID}"]`);

describe('unavailable Quick Access tile repair affordance', () => {
  beforeEach(() => {
    mockReleaseFocusTrap.mockClear();
    mockReleaseCalls.length = 0;
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
    await ui.switchQuickAccessPage('default');

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
    await ui.switchQuickAccessPage('default');
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

  it('releases the repair modal focus trap by reference before detaching it', () => {
    state.setStates({ [replacement.entity_id]: replacement });
    ui.renderActiveTab();
    staleTile().click();

    const modal = document.getElementById('entity-repair-modal');
    modal.querySelector('.close-btn').click();

    // Passing the modal matters: the no-argument fallback skips already-detached modals, so a
    // release after remove() would restore no focus and could clear another modal's trap.
    expect(mockReleaseCalls).toEqual([{ modal, wasConnected: true }]);
    expect(document.getElementById('entity-repair-modal')).toBeNull();
  });
});

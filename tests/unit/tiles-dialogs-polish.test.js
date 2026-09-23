/**
 * @jest-environment jsdom
 */

const nodeUtil = require('util');
const { createMockElectronAPI, resetMockElectronAPI } = require('../mocks/electron.js');
global.TextEncoder = global.TextEncoder || nodeUtil.TextEncoder;
global.TextDecoder = global.TextDecoder || nodeUtil.TextDecoder;

// Setup mocks BEFORE loading modules
const mockElectronAPI = createMockElectronAPI();
window.electronAPI = mockElectronAPI;

// Mock dependencies
jest.mock('../../src/camera.js', () => ({
  CAMERA_PREVIEW_REFRESH_OPTIONS: [
    { value: 'off', label: 'Static icon (Default)', intervalMs: 0 },
    { value: 'live', label: 'Live stream while visible (Higher usage)', intervalMs: 0 },
    { value: '30s', label: 'Snapshot every 30 seconds (Efficient)', intervalMs: 30000 },
    { value: '10s', label: 'Snapshot every 10 seconds', intervalMs: 10000 },
    { value: '5s', label: 'Snapshot every 5 seconds (Frequent)', intervalMs: 5000 },
  ],
  disposeCameraPreview: jest.fn(),
  mountCameraPreview: jest.fn(),
  normalizeCameraPreviewRefresh: jest.fn((value) =>
    ['off', 'live', '30s', '10s', '5s'].includes(
      String(value || '')
        .trim()
        .toLowerCase()
    )
      ? String(value).trim().toLowerCase()
      : 'off'
  ),
  openCamera: jest.fn(),
  pruneCameraPreviews: jest.fn(),
  refreshCameraPreview: jest.fn(),
}));

jest.mock('../../src/ui-utils.js', () => {
  const releaseFocusTrap = jest.fn();
  return {
    showToast: jest.fn(),
    showConfirm: jest.fn().mockResolvedValue(false),
    showLoading: jest.fn(),
    setStatus: jest.fn(),
    trapFocus: jest.fn(),
    releaseFocusTrap,
    // Mirrors the real shared modal helper, which settles synchronously under NODE_ENV=test.
    closeModal: jest.fn((modal, { remove = false, releaseFocus = false, onClosed } = {}) => {
      if (modal) {
        modal.classList.remove('modal-closing');
        if (remove) {
          modal.remove();
        } else {
          modal.classList.add('hidden');
          if (modal.style.display) modal.style.display = 'none';
        }
        if (releaseFocus) releaseFocusTrap(modal);
        onClosed?.();
      }
      return Promise.resolve();
    }),
    openModal: jest.fn((modal, { display = 'flex' } = {}) => {
      if (!modal) return;
      modal.classList.remove('modal-closing');
      modal.classList.remove('hidden');
      if (display) modal.style.display = display;
      else modal.style.removeProperty('display');
    }),
    applyTheme: jest.fn(),
    applyUiPreferences: jest.fn(),
    hexToRgb: jest.fn((hex) => {
      if (!hex || typeof hex !== 'string') return null;
      const normalized = hex.replace('#', '').trim();
      if (![3, 6].includes(normalized.length) || !/^[0-9a-fA-F]+$/.test(normalized)) return null;
      const value =
        normalized.length === 3
          ? normalized
              .split('')
              .map((ch) => ch + ch)
              .join('')
          : normalized;
      return {
        r: Number.parseInt(value.slice(0, 2), 16),
        g: Number.parseInt(value.slice(2, 4), 16),
        b: Number.parseInt(value.slice(4, 6), 16),
      };
    }),
    miredsToKelvin: jest.fn((mireds) => {
      const value = Number(mireds);
      return Number.isFinite(value) && value > 0 ? Math.round(1000000 / value) : null;
    }),
    hasSupportedFeature: jest.fn((supportedFeatures, featureFlag) => {
      const features = Number(supportedFeatures);
      const flag = Number(featureFlag);
      return (
        Number.isFinite(features) && Number.isFinite(flag) && flag > 0 && (features & flag) === flag
      );
    }),
  };
});

jest.mock('../../src/icons.js', () => ({
  setIconContent: jest.fn(),
  applyCloseButtonIcons: jest.fn(),
}));

jest.mock('../../src/weather-icons.js', () => ({
  normalizeWeatherCondition: jest.requireActual('../../src/weather-icons.js')
    .normalizeWeatherCondition,
  renderWeatherIcon: jest.fn((element, condition) => {
    element.replaceChildren();
    element.dataset.weatherCondition = condition;
  }),
}));

jest.mock('sortablejs', () => ({
  create: jest.fn(() => ({
    destroy: jest.fn(),
  })),
}));

// Mock WebSocket callService method
const mockCallService = jest.fn().mockResolvedValue({});
const mockCallServiceWithResponse = jest.fn().mockResolvedValue({});
const mockRequest = jest.fn().mockResolvedValue({});

jest.mock('../../src/websocket.js', () => ({
  callService: mockCallService,
  callServiceWithResponse: mockCallServiceWithResponse,
  isConnected: jest.fn(() => true),
  on: jest.fn(),
  emit: jest.fn(),
  request: mockRequest,
}));

// Import modules after mocks
const ui = require('../../src/ui.js');
const state = require('../../src/state.js').default;
const uiUtils = require('../../src/ui-utils.js');
const { sampleConfig } = require('../fixtures/ha-data.js');
const i18n = require('../../src/i18n.js');
const Sortable = require('sortablejs');
const { mountSensorHistoryDetail } = require('../../src/sensor-history-detail.js');

const styles = require('fs').readFileSync(
  require('path').resolve(__dirname, '../../styles.css'),
  'utf8'
);
const entity = (entity_id, value, attributes = {}) => ({ entity_id, state: value, attributes });
const inputValue = (selector, value, root = document) => {
  const input = root.querySelector(selector);
  input.value = String(value);
  input.dispatchEvent(new Event('input', { bubbles: true }));
  return input;
};
const pendingCall = () => {
  const call = {};
  mockCallService.mockImplementationOnce(
    () =>
      new Promise((resolve, reject) => {
        call.resolve = resolve;
        call.reject = reject;
      })
  );
  return call;
};
const renderTiles = (states) => {
  const ids = states.map((item) => item.entity_id);
  state.setConfig({
    ...state.CONFIG,
    customTabs: [{ id: 'polish', name: 'Polish', entityIds: ids }],
    activeTabId: 'polish',
    favoriteEntities: ids,
  });
  state.setStates(Object.fromEntries(states.map((item) => [item.entity_id, item])));
  ui.renderActiveTab();
};
const tile = (entityId) => document.querySelector(`#quick-controls [data-entity-id="${entityId}"]`);
const liveUpdate = (next) => {
  state.setEntityState(next);
  ui.updateEntityInUI(next);
};

describe('tile and device dialog polish', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.spyOn(console, 'warn').mockImplementation(() => {});
    jest.spyOn(console, 'error').mockImplementation(() => {});
    jest.clearAllMocks();
    resetMockElectronAPI();
    i18n.setLocaleBootstrap({ activeLocale: 'en-US', messages: {} });
    document.body.innerHTML = `<div class="status-grid"><div id="weather-card"></div><div id="time-card"></div></div>
      <div id="quick-controls"></div>`;
    state.setConfig({
      ...sampleConfig,
      ui: { theme: 'dark' },
      favoriteEntities: [],
      customTabs: [],
      primaryCards: ['none', 'none'],
    });
    state.setStates({});
    state.setServices({});
    state.setUnitSystem({ temperature: '°C' });
    mockCallService.mockReset().mockResolvedValue({ success: true });
  });
  afterEach(() => {
    document.querySelectorAll('.modal .close-btn').forEach((button) => button.click());
    jest.clearAllTimers();
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  describe('calendar tile', () => {
    it('shows All day for an all-day event reported with a midnight start time', () => {
      renderTiles([
        entity('calendar.trips', 'off', {
          message: 'Vacation',
          start_time: '2026-09-24 00:00:00',
          all_day: true,
        }),
      ]);
      expect(tile('calendar.trips').querySelector('.calendar-next-event').textContent).toBe(
        'Vacation · All day'
      );
    });

    it('shows timed events without seconds in the active locale', () => {
      const start = '2026-09-23 20:23:50';
      renderTiles([entity('calendar.work', 'on', { message: 'Standup', start_time: start })]);
      const expected = new Date(start).toLocaleTimeString('en-US', {
        hour: 'numeric',
        minute: '2-digit',
      });
      const text = tile('calendar.work').querySelector('.calendar-next-event').textContent;
      expect(text).toBe(`Standup · ${expected}`);
      expect(text).not.toMatch(/\d:\d{2}:\d{2}/);
    });
  });
});

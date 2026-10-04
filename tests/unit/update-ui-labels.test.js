/**
 * @jest-environment jsdom
 */

const { createMockElectronAPI } = require('../mocks/electron.js');

const mockElectronAPI = createMockElectronAPI();
window.electronAPI = mockElectronAPI;

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
  disableControlsKeepingFocus: jest.fn(() => jest.fn()),
  ...require('../helpers/ui-utils-dialogs').realDialogHelpers(),
}));
jest.mock('../../src/websocket.js', () => ({
  callService: jest.fn().mockResolvedValue({}),
  request: jest.fn().mockResolvedValue({ result: {} }),
  on: jest.fn(),
  emit: jest.fn(),
}));

const i18n = require('../../src/i18n.js');
const ui = require('../../src/ui.js');

const GERMAN = {
  'Check for updates': 'Nach Updates suchen',
  'Install update': 'Update installieren',
  'Download Update': 'Update herunterladen',
  'Download Portable Update': 'Portables Update herunterladen',
  'Update available': 'Update verfügbar',
  'Update available: v{{version}}': 'Update verfügbar: v{{version}}',
  'Update ready to install': 'Update bereit zur Installation',
  'Update v{{version}} ready to install': 'Update v{{version}} bereit zur Installation',
};

describe('update panel labels', () => {
  let onUpdate;

  beforeEach(() => {
    document.body.innerHTML = `
      <span id="current-version"></span>
      <span id="update-status-text"></span>
      <button id="check-updates-btn"><span id="check-updates-text">Check for updates</span></button>
      <button id="install-update-btn" class="hidden"><span id="install-update-text">Install update</span></button>
      <div id="update-progress" class="hidden"></div>`;
    onUpdate = null;
    mockElectronAPI.onAutoUpdate = jest.fn((callback) => {
      onUpdate = callback;
      return jest.fn();
    });
    ui.initUpdateUI();
  });

  afterEach(() => i18n.setLocaleBootstrap({ activeLocale: 'en', messages: {} }));

  const installText = () => document.getElementById('install-update-text');
  const german = () => {
    i18n.setLocaleBootstrap({ activeLocale: 'de', messages: GERMAN });
    ui.relocalizeUpdateStatus();
  };

  it('keeps the label in its span when the update is downloaded, so a language change still reaches it', () => {
    onUpdate({ status: 'downloaded', info: { version: '4.0.1' } });

    expect(installText()).not.toBeNull();
    expect(document.getElementById('install-update-btn').children).toHaveLength(1);
    expect(installText().textContent).toBe('Install update');

    german();
    expect(installText().textContent).toBe('Update installieren');
  });

  it('keeps the Download label in the new language too, in both portable and manual states', () => {
    onUpdate({ status: 'portable', downloadUrl: 'https://example.test/p', message: 'Portable' });
    expect(installText().textContent).toBe('Download Portable Update');
    german();
    expect(installText().textContent).toBe('Portables Update herunterladen');

    i18n.setLocaleBootstrap({ activeLocale: 'en', messages: {} });
    onUpdate({ status: 'manual', downloadUrl: 'https://example.test/m', message: 'Manual' });
    expect(installText().textContent).toBe('Download Update');
    german();
    expect(installText().textContent).toBe('Update herunterladen');
  });

  it('translates the check button, with the same spelling the panel starts with', () => {
    expect(document.getElementById('check-updates-text').textContent).toBe('Check for updates');

    german();

    expect(document.getElementById('check-updates-text').textContent).toBe('Nach Updates suchen');
  });

  it('says an update is available, without a made-up version, when the updater gave none', () => {
    onUpdate({ status: 'available' });
    expect(document.getElementById('update-status-text').textContent).toBe('Update available');

    onUpdate({ status: 'available', info: { version: '4.0.1' } });
    expect(document.getElementById('update-status-text').textContent).toBe(
      'Update available: v4.0.1'
    );

    onUpdate({ status: 'downloaded' });
    expect(document.getElementById('update-status-text').textContent).toBe(
      'Update ready to install'
    );
    german();
    expect(document.getElementById('update-status-text').textContent).toBe(
      'Update bereit zur Installation'
    );
    expect(document.getElementById('update-status-text').textContent).not.toMatch(/unknown/i);
  });
});

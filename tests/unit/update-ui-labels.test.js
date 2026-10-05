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
const updateStatus = require('../../src/update-status.js');

const GERMAN = {
  'Install update': 'Update installieren',
  'Download update': 'Update herunterladen',
  'Download portable update': 'Portables Update herunterladen',
  'Update available: v{{version}}. This package cannot update itself; use “Download update” to get it from GitHub.':
    'Update verfügbar: v{{version}}. Dieses Paket kann sich nicht selbst aktualisieren; lade es mit „Update herunterladen“ von GitHub herunter.',
  'Portable update available: v{{version}}. Use “Download portable update” to get the Portable build.':
    'Portables Update verfügbar: v{{version}}. Nutze „Portables Update herunterladen“, um den Portable-Build zu erhalten.',
  'Update available': 'Update verfügbar',
  'Update available: v{{version}}': 'Update verfügbar: v{{version}}',
  'Update ready to install': 'Update bereit zur Installation',
  'Update v{{version}} ready to install': 'Update v{{version}} bereit zur Installation',
};

describe('update panel labels', () => {
  beforeEach(() => {
    updateStatus.resetUpdateStatus();
    document.body.innerHTML = `
      <span id="current-version"></span>
      <p id="update-status" data-state="idle"><span id="update-status-text"></span></p>
      <button id="check-updates-btn"><span id="check-updates-text">Check for updates</span></button>
      <button id="install-update-btn" class="hidden"><span id="install-update-text">Install update</span></button>
      <div id="update-progress" class="hidden"><div id="progress-fill"></div><span id="progress-text"></span></div>`;
    ui.initUpdateUI();
  });

  afterEach(() => {
    updateStatus.resetUpdateStatus();
    i18n.setLocaleBootstrap({ activeLocale: 'en', messages: {} });
  });

  const installText = () => document.getElementById('install-update-text');
  const statusText = () => document.getElementById('update-status-text').textContent;
  const german = () => {
    i18n.setLocaleBootstrap({ activeLocale: 'de', messages: GERMAN });
    ui.relocalizeUpdateStatus();
  };

  it('keeps the label in its span when the update is downloaded, so a language change still reaches it', () => {
    updateStatus.applyUpdateEvent({ status: 'downloaded', info: { version: '4.0.1' } });

    expect(installText()).not.toBeNull();
    expect(document.getElementById('install-update-btn').children).toHaveLength(1);
    expect(installText().textContent).toBe('Install update');

    german();
    expect(installText().textContent).toBe('Update installieren');
  });

  it('keeps the Download label in the new language too, in both portable and manual states', () => {
    updateStatus.applyUpdateEvent({
      status: 'portable',
      downloadUrl: 'https://example.test/p',
      version: '4.0.1',
    });
    expect(installText().textContent).toBe('Download portable update');
    german();
    expect(installText().textContent).toBe('Portables Update herunterladen');

    i18n.setLocaleBootstrap({ activeLocale: 'en', messages: {} });
    updateStatus.applyUpdateEvent({
      status: 'manual',
      downloadUrl: 'https://example.test/m',
      version: '4.0.1',
    });
    expect(installText().textContent).toBe('Download update');
    german();
    expect(installText().textContent).toBe('Update herunterladen');
  });

  // The sentence names the button beside it, so it has to change language with it.
  it('words the line of a build that cannot update itself in the language shown now', () => {
    updateStatus.applyUpdateEvent({
      status: 'manual',
      downloadUrl: 'https://example.test/m',
      version: '4.0.1',
    });
    expect(statusText()).toBe(
      'Update available: v4.0.1. This package cannot update itself; use “Download update” to get it from GitHub.'
    );

    german();
    expect(statusText()).toBe(
      'Update verfügbar: v4.0.1. Dieses Paket kann sich nicht selbst aktualisieren; lade es mit „Update herunterladen“ von GitHub herunter.'
    );
    expect(installText().textContent).toBe('Update herunterladen');

    i18n.setLocaleBootstrap({ activeLocale: 'en', messages: {} });
    updateStatus.applyUpdateEvent({
      status: 'portable',
      downloadUrl: 'https://example.test/p',
      version: '4.0.1',
    });
    german();
    expect(statusText()).toBe(
      'Portables Update verfügbar: v4.0.1. Nutze „Portables Update herunterladen“, um den Portable-Build zu erhalten.'
    );
  });

  it('names a portable beta as a beta', () => {
    updateStatus.applyUpdateEvent({
      status: 'portable',
      downloadUrl: 'https://example.test/p',
      version: '4.1.0-beta.1',
      prerelease: true,
    });
    expect(statusText()).toBe(
      'Portable beta update available: v4.1.0-beta.1. Use “Download portable update” to get the Portable build.'
    );
  });

  it('says an update is available, without a made-up version, when the updater gave none', () => {
    updateStatus.applyUpdateEvent({ status: 'available' });
    expect(statusText()).toBe('Update available');

    updateStatus.applyUpdateEvent({ status: 'available', info: { version: '4.0.1' } });
    expect(statusText()).toBe('Update available: v4.0.1');

    updateStatus.applyUpdateEvent({ status: 'downloaded' });
    expect(statusText()).toBe('Update ready to install');
    german();
    expect(statusText()).toBe('Update bereit zur Installation');
    expect(statusText()).not.toMatch(/unknown/i);

    updateStatus.applyUpdateEvent({ status: 'downloaded', info: { version: '4.0.1' } });
    expect(statusText()).toBe('Update v4.0.1 bereit zur Installation');
  });
});

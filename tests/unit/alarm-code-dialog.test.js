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
  request: jest.fn().mockResolvedValue({ result: {} }),
  on: jest.fn(),
  emit: jest.fn(),
}));

const ui = require('../../src/ui.js');

const alarm = {
  entity_id: 'alarm_control_panel.home',
  state: 'armed_home',
  attributes: { friendly_name: 'Home alarm', code_format: 'number' },
};

describe('the alarm code dialog', () => {
  afterEach(() => {
    document.body.innerHTML = '';
  });

  const dialog = () => document.querySelector('.alarm-code-modal');
  const buttons = () => [...dialog().querySelectorAll('.entity-detail-actions button')];

  it('is titled with the panel name and offers Apply and Cancel when it is not told more', async () => {
    const pending = ui.requestAlarmCode(alarm);

    expect(dialog().querySelector('h2').textContent).toBe('Home alarm');
    expect(buttons().map((button) => button.textContent)).toEqual(['Cancel', 'Apply']);
    // Neutral, as Cancel is in every other dialog, not an accent button beside the one that acts.
    expect(buttons()[0].classList.contains('btn-neutral')).toBe(true);

    buttons()[0].click();
    expect(await pending).toBeNull();
  });

  it('says which command it is for, and the submit button says what it will do', async () => {
    const pending = ui.requestAlarmCode(alarm, {
      title: 'Disarm Home alarm',
      submitLabel: 'Disarm',
    });

    expect(dialog().querySelector('h2').textContent).toBe('Disarm Home alarm');
    const submit = buttons().find((button) => button.type === 'submit');
    expect(submit.textContent).toBe('Disarm');
    expect(dialog().querySelector('input').type).toBe('password');

    dialog().querySelector('input').value = '1234';
    dialog()
      .querySelector('form')
      .dispatchEvent(new Event('submit', { cancelable: true }));
    expect(await pending).toBe('1234');
  });

  it('closes without a code, and without keeping the typed one, from Cancel', async () => {
    const pending = ui.requestAlarmCode(alarm, { submitLabel: 'Arm' });
    const input = dialog().querySelector('input');
    input.value = '9999';

    buttons()
      .find((button) => button.textContent === 'Cancel')
      .click();

    expect(await pending).toBeNull();
    expect(input.value).toBe('');
    expect(document.querySelector('.alarm-code-modal')).toBeNull();
  });
});

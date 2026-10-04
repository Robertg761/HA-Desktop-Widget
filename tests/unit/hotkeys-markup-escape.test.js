/**
 * @jest-environment jsdom
 */

// A friendly_name from a template or MQTT entity can arrive as a list. The hotkey rows build their
// markup from names, so a list must be written out as text and never become elements.

const { createMockElectronAPI, getMockConfig } = require('../mocks/electron.js');

jest.mock('../../src/ui-utils.js', () => ({
  ...require('../helpers/ui-utils-dialogs').realDialogHelpers(),
  showToast: jest.fn(),
}));

jest.mock('../../src/utils.js', () => ({
  // The real helper hands the attribute back as it is.
  getEntityDisplayName: jest.fn((entity) => entity.attributes?.friendly_name || entity.entity_id),
  getSearchScore: jest.fn(() => 1),
}));

const state = require('../../src/state.js').default;
const hotkeys = require('../../src/hotkeys.js');

describe('hotkey rows', () => {
  beforeEach(() => {
    window.electronAPI = createMockElectronAPI();
    document.body.innerHTML = '<div id="hotkeys-list"></div><input id="hotkey-entity-search">';
    const config = getMockConfig();
    config.globalHotkeys = { enabled: true, hotkeys: {} };
    state.setConfig(config);
  });

  it('writes a list-valued friendly_name out as text, not as markup', () => {
    state.setStates({
      'light.living_room': {
        entity_id: 'light.living_room',
        state: 'on',
        attributes: { friendly_name: ['<img src=x onerror=alert(1)>', '<b>bold</b>'] },
      },
    });

    hotkeys.renderHotkeysTab();

    const list = document.getElementById('hotkeys-list');
    expect(list.querySelector('img, b')).toBeNull();
    expect(list.textContent).toContain('<img src=x onerror=alert(1)>');
  });
});

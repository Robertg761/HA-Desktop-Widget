/**
 * @jest-environment jsdom
 */
const fs = require('fs');
const path = require('path');

// Most of Settings previews and saves on Save. The few settings the OS or the locale bootstrap
// must apply at once say so next to the control.
describe('Settings that take effect immediately', () => {
  beforeAll(() => {
    document.documentElement.innerHTML = fs.readFileSync(
      path.resolve(__dirname, '../../index.html'),
      'utf8'
    );
  });

  const noteNear = (controlId) =>
    [...document.getElementById(controlId).closest('.form-group').querySelectorAll('.help-text')]
      .map((note) => note.textContent.trim())
      .find((text) => text.endsWith('take effect immediately.'));

  it.each([
    ['language-select', 'Language changes take effect immediately.'],
    ['popup-hotkey-input', 'Popup hotkey changes take effect immediately.'],
    // Enabling registers every entity hotkey with the OS (or the portal), so a conflict or a
    // refused portal request has to be reported, and rolled back, at the toggle.
    ['global-hotkeys-enabled', 'Entity hotkey changes take effect immediately.'],
    // The alerts toggle and the alert editor save as they go, so there is nothing for Save or
    // Cancel to apply or undo.
    ['entity-alerts-enabled', 'Entity alert changes take effect immediately.'],
  ])('%s says "%s"', (controlId, note) => {
    expect(noteNear(controlId)).toBe(note);
  });
});

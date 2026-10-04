/**
 * The real dialog layer from src/ui-utils.js, for tests that replace the rest of that module.
 *
 * Every dialog opens through openDialog() and closes through closeDialog(), which own the focus
 * trap, Escape, the backdrop and stacking. Stubbing them would leave a test checking that a mock was
 * called instead of what the user gets, so a test that mocks ui-utils spreads this in:
 *
 *   jest.mock('../../src/ui-utils.js', () => ({
 *     ...require('../helpers/ui-utils-dialogs').realDialogHelpers(),
 *     showToast: jest.fn(),
 *   }));
 */
function realDialogHelpers() {
  const actual = jest.requireActual('../../src/ui-utils.js');
  const forward =
    (name) =>
    (...args) =>
      actual[name](...args);
  return Object.fromEntries(
    [
      'openDialog',
      'closeDialog',
      'openModal',
      'closeModal',
      'trapFocus',
      'releaseFocusTrap',
      'hasOpenDialog',
      'renderKeepingFocus',
      'disableControlsKeepingFocus',
      'findFocusKey',
      'layoutToasts',
    ].map((name) => [name, forward(name)])
  );
}

module.exports = { realDialogHelpers };

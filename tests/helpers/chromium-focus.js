/**
 * Chromium's focus rules that jsdom leaves out, for tests about where keyboard focus ends up.
 *
 * Chromium moves focus to <body> the moment the focused control is disabled, and does not give it
 * back when the control is enabled again. jsdom keeps focus on a disabled control, so a test can
 * pass while the app loses the keyboard's place on every press. Call this in a test (or a
 * beforeEach) and the returned function in its cleanup:
 *
 *   const restore = blurFocusedControlsOnDisable();
 *   try { ... } finally { restore(); }
 */
const DISABLEABLE = ['HTMLButtonElement', 'HTMLInputElement', 'HTMLSelectElement'];

function blurFocusedControlsOnDisable(window = global.window) {
  const originals = DISABLEABLE.map((name) => {
    const prototype = window[name].prototype;
    const descriptor = Object.getOwnPropertyDescriptor(prototype, 'disabled');
    Object.defineProperty(prototype, 'disabled', {
      ...descriptor,
      set(value) {
        // Blur first: jsdom's blur() ignores an element that is no longer focusable, and a
        // disabled control is not, so blurring after the change would leave focus where it was.
        if (value && this.ownerDocument.activeElement === this) this.blur();
        descriptor.set.call(this, value);
      },
    });
    return [prototype, descriptor];
  });
  return () => {
    originals.forEach(([prototype, descriptor]) => {
      Object.defineProperty(prototype, 'disabled', descriptor);
    });
  };
}

module.exports = { blurFocusedControlsOnDisable };

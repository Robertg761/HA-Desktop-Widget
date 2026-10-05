/**
 * @jest-environment jsdom
 */

const { blurFocusedControlsOnDisable } = require('../helpers/chromium-focus.js');

// The focus tests for Dismiss and Load rooms lean on this helper. If it stopped moving focus they
// would pass on code that drops the keyboard's place, so check the helper itself.
describe('blurFocusedControlsOnDisable', () => {
  let restore;
  afterEach(() => restore?.());

  it.each(['button', 'input', 'select'])(
    'moves focus to <body> when a focused %s is disabled',
    (tag) => {
      document.body.innerHTML = `<${tag}></${tag}>`;
      const control = document.querySelector(tag);
      control.focus();
      restore = blurFocusedControlsOnDisable();
      control.disabled = true;
      expect(control.disabled).toBe(true);
      expect(document.activeElement).toBe(document.body);
    }
  );

  it('leaves focus alone when another control is disabled', () => {
    document.body.innerHTML = '<button id="a"></button><button id="b"></button>';
    const a = document.getElementById('a');
    a.focus();
    restore = blurFocusedControlsOnDisable();
    document.getElementById('b').disabled = true;
    expect(document.activeElement).toBe(a);
  });

  it('puts jsdom back the way it was', () => {
    document.body.innerHTML = '<button></button>';
    const button = document.querySelector('button');
    button.focus();
    blurFocusedControlsOnDisable()();
    button.disabled = true;
    expect(document.activeElement).toBe(button);
  });
});

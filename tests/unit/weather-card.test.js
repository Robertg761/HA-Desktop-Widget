/**
 * @jest-environment jsdom
 */

const { LONG_PRESS_MS, bindWeatherCardPicker } = require('../../src/weather-card.js');

describe('the weather card opens the picker', () => {
  let card;
  let openPicker;
  let isWeather;

  beforeEach(() => {
    jest.useFakeTimers();
    document.body.innerHTML = '<div id="card" tabindex="0"></div>';
    card = document.getElementById('card');
    openPicker = jest.fn();
    isWeather = true;
    bindWeatherCardPicker(card, { isWeatherCard: () => isWeather, openPicker });
  });
  afterEach(() => {
    jest.useRealTimers();
  });

  const press = (type, init = {}) =>
    card.dispatchEvent(new MouseEvent(type, { bubbles: true, button: 0, ...init }));

  it('on a plain click, which is what an assistive technology sends to activate it', () => {
    press('click');
    expect(openPicker).toHaveBeenCalledTimes(1);
  });

  it('on a long press, once, though the click that ends the press follows', () => {
    press('mousedown');
    jest.advanceTimersByTime(LONG_PRESS_MS);
    expect(openPicker).toHaveBeenCalledTimes(1);
    press('mouseup');
    press('click');
    expect(openPicker).toHaveBeenCalledTimes(1);
    // The next plain click is a click again.
    press('click');
    expect(openPicker).toHaveBeenCalledTimes(2);
  });

  it('not on a short press that ends before the long one, other than by its click', () => {
    press('mousedown');
    jest.advanceTimersByTime(LONG_PRESS_MS - 100);
    press('mouseup');
    jest.advanceTimersByTime(500);
    expect(openPicker).not.toHaveBeenCalled();
    press('click');
    expect(openPicker).toHaveBeenCalledTimes(1);
  });

  it('not for the other buttons: a right-click opens the context menu, and ends a press', () => {
    press('mousedown', { button: 2 });
    jest.advanceTimersByTime(LONG_PRESS_MS);
    press('click', { button: 2 });
    expect(openPicker).not.toHaveBeenCalled();
    press('mousedown');
    press('contextmenu');
    jest.advanceTimersByTime(LONG_PRESS_MS);
    expect(openPicker).not.toHaveBeenCalled();
  });

  it('not when the pointer leaves before a long press is done', () => {
    press('mousedown');
    press('mouseleave');
    jest.advanceTimersByTime(LONG_PRESS_MS);
    expect(openPicker).not.toHaveBeenCalled();
  });

  it.each([
    ['Enter', {}],
    [' ', {}],
    ['ContextMenu', {}],
    ['F10', { shiftKey: true }],
  ])('from the keyboard: %s', (key, init) => {
    card.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, ...init }));
    expect(openPicker).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['Enter with Ctrl', { key: 'Enter', ctrlKey: true }],
    ['F10 alone', { key: 'F10' }],
    ['a letter', { key: 'a' }],
  ])('not from %s', (_label, init) => {
    card.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, ...init }));
    expect(openPicker).not.toHaveBeenCalled();
  });

  it('does nothing while the card shows something other than the weather', () => {
    isWeather = false;
    press('click');
    press('mousedown');
    jest.advanceTimersByTime(LONG_PRESS_MS);
    card.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    expect(openPicker).not.toHaveBeenCalled();
  });
});

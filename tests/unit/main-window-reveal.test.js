/**
 * @jest-environment node
 */

const {
  MAIN_WINDOW_REVEAL_FALLBACK_MS,
  createMainWindowReveal,
} = require('../../src/main-window-reveal.cjs');

describe('main window reveal', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it('shows the window once the page says it is ready, and only once', () => {
    const reveal = jest.fn();
    const hold = createMainWindowReveal({ reveal });

    hold.hold();
    expect(hold.isPending()).toBe(true);
    expect(reveal).not.toHaveBeenCalled();

    expect(hold.release()).toBe(true);
    expect(reveal).toHaveBeenCalledWith('ready');
    expect(hold.isPending()).toBe(false);

    // A reload sends renderer-ready again; the window is already shown.
    expect(hold.release()).toBe(false);
    jest.advanceTimersByTime(MAIN_WINDOW_REVEAL_FALLBACK_MS * 2);
    expect(reveal).toHaveBeenCalledTimes(1);
  });

  it('shows the window anyway when the page never reports in', () => {
    const reveal = jest.fn();
    const hold = createMainWindowReveal({ reveal });
    hold.hold();

    jest.advanceTimersByTime(MAIN_WINDOW_REVEAL_FALLBACK_MS - 1);
    expect(reveal).not.toHaveBeenCalled();
    jest.advanceTimersByTime(1);
    expect(reveal).toHaveBeenCalledWith('fallback');
    expect(hold.isPending()).toBe(false);
  });

  it('does not show a window that something else decided about', () => {
    const reveal = jest.fn();
    const hold = createMainWindowReveal({ reveal });
    hold.hold();
    hold.cancel();

    expect(hold.isPending()).toBe(false);
    expect(hold.release()).toBe(false);
    jest.advanceTimersByTime(MAIN_WINDOW_REVEAL_FALLBACK_MS * 2);
    expect(reveal).not.toHaveBeenCalled();
  });

  it('starts a fresh wait when the window is created again', () => {
    const reveal = jest.fn();
    const hold = createMainWindowReveal({ reveal, fallbackMs: 1000 });
    hold.hold();
    jest.advanceTimersByTime(900);
    hold.hold();
    jest.advanceTimersByTime(900);
    expect(reveal).not.toHaveBeenCalled();
    jest.advanceTimersByTime(100);
    expect(reveal).toHaveBeenCalledTimes(1);
  });

  it('keeps going when showing the window throws', () => {
    const log = { warn: jest.fn() };
    const hold = createMainWindowReveal({
      reveal: () => {
        throw new Error('Object has been destroyed');
      },
      log,
    });
    hold.hold();

    expect(() => hold.release()).not.toThrow();
    expect(log.warn).toHaveBeenCalledWith(
      'Failed to reveal the main window:',
      'Object has been destroyed'
    );
    expect(hold.isPending()).toBe(false);
  });
});

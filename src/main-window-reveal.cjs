/* global clearTimeout, console, setTimeout */

// The main window is created hidden and shown once the page has applied the saved config. A window
// shown at creation paints the default dark palette, then the saved theme, accent and glass a moment
// later, which reads as a flash (a light theme flips from dark to light) and, for a launch that was
// asked to stay hidden, as a window that appears and vanishes.
//
// A renderer that never gets that far (a failed load, a crash in init) must not leave the user with
// no window at all, so the reveal also happens after a fallback delay.
const MAIN_WINDOW_REVEAL_FALLBACK_MS = 3000;

/**
 * Hold a hidden window until `release()` says the first real frame is ready.
 *
 * `reveal(reason)` runs at most once per `hold()`, with 'ready' when the page released it and
 * 'fallback' when the timer did. Anything else that shows or hides the window in the meantime
 * (a tray click, a second launch asking for --hide) calls `cancel()` or `release()` itself.
 */
function createMainWindowReveal({
  reveal,
  fallbackMs = MAIN_WINDOW_REVEAL_FALLBACK_MS,
  setTimeoutFn = setTimeout,
  clearTimeoutFn = clearTimeout,
  log = console,
} = {}) {
  let pending = false;
  let timer = null;

  function clearTimer() {
    if (timer !== null) clearTimeoutFn(timer);
    timer = null;
  }

  function finish(reason) {
    if (!pending) return false;
    pending = false;
    clearTimer();
    try {
      reveal?.(reason);
    } catch (error) {
      log.warn?.('Failed to reveal the main window:', error?.message || error);
    }
    return true;
  }

  return {
    hold() {
      clearTimer();
      pending = true;
      timer = setTimeoutFn(() => finish('fallback'), fallbackMs);
    },
    release: () => finish('ready'),
    // Something else decided what the window does; the reveal must not undo it later.
    cancel() {
      pending = false;
      clearTimer();
    },
    isPending: () => pending,
  };
}

module.exports = { MAIN_WINDOW_REVEAL_FALLBACK_MS, createMainWindowReveal };

/* global clearTimeout, console, process, setTimeout */

const { boundsVisibleOnAnyWorkArea } = require('./window-placement.cjs');

// Raising the widget with a plain setAlwaysOnTop(true) is not enough to clear a
// full-screen video: players run at Electron's default 'floating' level and re-raise
// themselves, so the widget flashes and then sits behind the video. 'screen-saver' is
// the highest level Electron exposes and the only one that reliably lands above
// full-screen content on Windows, macOS, and Linux compositors.
const POPUP_WINDOW_TOP_LEVEL = 'screen-saver';

// Full-screen players and compositors keep re-raising themselves for a frame or two
// after our show(), so the raise is re-asserted instead of being applied once.
const POPUP_RAISE_REASSERT_DELAYS_MS = [16, 120];

// Sub-pixel differences are rounding, not the compositor relocating the window.
const POPUP_POSITION_DRIFT_TOLERANCE_PX = 1;

function isUsableWindow(targetWindow) {
  if (!targetWindow) return false;
  if (typeof targetWindow.isDestroyed !== 'function') return true;
  try {
    return !targetWindow.isDestroyed();
  } catch {
    return false;
  }
}

function toFiniteInteger(value) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.round(number) : null;
}

/**
 * Shared show/hide behavior for the widget when it is used as a popup.
 *
 * Every path that pops the widget up (global shortcut, portal shortcut, focus request)
 * goes through here so the window lands above full-screen content, keeps the position
 * the user last gave it, and drops back to the user's always-on-top preference when it
 * hides instead of staying pinned above everything.
 */
function createPopupWindowPresenter(options = {}) {
  const {
    platform = process.platform,
    getConfig = () => ({}),
    getWorkAreas = () => [],
    // Wayland gives clients no way to position their own toplevels: setBounds() updates
    // what getBounds() reports but never moves the window, so attempting a restore there
    // only feeds compositor-invented coordinates back into the saved position.
    supportsWindowPositioning = true,
    shouldReleaseElevationOnBlur = () => false,
    log = console,
    setTimeoutFn = setTimeout,
    clearTimeoutFn = clearTimeout,
  } = options;

  const pendingTimers = new Set();
  let elevated = false;
  // Set by a raise that must hold until the window hides, so a later one-off raise cannot
  // schedule a release underneath it (a desktop pin focusing the widget mid-popup, say).
  let stickyElevation = false;
  // A full-screen application can briefly take focus back while the popup is still
  // activating. Ignore that activation-time blur; a later blur is a real signal that
  // the user moved on and the screen-saver level should no longer be sticky.
  let blurReleaseArmed = false;

  function safeCall(targetWindow, method, ...args) {
    if (!targetWindow || typeof targetWindow[method] !== 'function') return undefined;
    try {
      return targetWindow[method](...args);
    } catch (error) {
      log.warn?.(`Failed to ${method} popup window:`, error?.message || error);
      return undefined;
    }
  }

  function cancelPendingRaises() {
    pendingTimers.forEach((timer) => clearTimeoutFn(timer));
    pendingTimers.clear();
  }

  function schedule(callback, delay) {
    const timer = setTimeoutFn(() => {
      pendingTimers.delete(timer);
      callback();
    }, delay);
    pendingTimers.add(timer);
  }

  function applyPopupLevel(targetWindow) {
    // Older Electron builds and some platforms reject the level argument; a plain
    // always-on-top is still better than dropping the raise entirely.
    try {
      targetWindow.setAlwaysOnTop(true, POPUP_WINDOW_TOP_LEVEL);
    } catch (error) {
      log.warn?.(
        'Failed to raise popup window above full-screen windows:',
        error?.message || error
      );
      safeCall(targetWindow, 'setAlwaysOnTop', true);
    }
  }

  function applyConfiguredLevel(targetWindow) {
    const alwaysOnTop = !!(getConfig() || {}).alwaysOnTop;
    safeCall(targetWindow, 'setAlwaysOnTop', alwaysOnTop);
  }

  // macOS puts another app's full-screen window in its own Space, so the widget can only
  // draw over it when it is allowed onto full-screen Spaces. Skipping the process-type
  // transform keeps the flag change from turning the widget back into a regular app,
  // which would bring back the Dock icon that app.dock.hide() removed.
  function setFullScreenVisibility(targetWindow, visible) {
    if (platform !== 'darwin') return;
    safeCall(targetWindow, 'setVisibleOnAllWorkspaces', visible, {
      visibleOnFullScreen: visible,
      skipTransformProcessType: true,
    });
  }

  function getWindowBounds(targetWindow) {
    const bounds = safeCall(targetWindow, 'getBounds');
    if (!bounds) return null;
    const x = toFiniteInteger(bounds.x);
    const y = toFiniteInteger(bounds.y);
    const width = toFiniteInteger(bounds.width);
    const height = toFiniteInteger(bounds.height);
    if (x === null || y === null || width === null || height === null) return null;
    return { x, y, width, height };
  }

  // The position the user last placed the widget at. config wins over the live bounds
  // because a compositor that relocated a hidden window has already changed those.
  function resolveIntendedPosition(targetWindow) {
    if (!supportsWindowPositioning) return null;
    const liveBounds = getWindowBounds(targetWindow);
    if (!liveBounds) return null;

    const storedPosition = (getConfig() || {}).windowPosition || {};
    const x = toFiniteInteger(storedPosition.x);
    const y = toFiniteInteger(storedPosition.y);
    if (x === null || y === null) return null;

    const workAreas = getWorkAreas() || [];
    if (!workAreas.length) return null;

    const intendedBounds = { x, y, width: liveBounds.width, height: liveBounds.height };
    if (!boundsVisibleOnAnyWorkArea(intendedBounds, workAreas)) {
      log.warn?.(
        `Remembered popup position ${x},${y} is off-screen; leaving the window where the compositor placed it`
      );
      return null;
    }

    return { x, y };
  }

  function restorePosition(targetWindow, intendedPosition) {
    if (!intendedPosition) return false;
    const currentBounds = getWindowBounds(targetWindow);
    if (!currentBounds) return false;

    const driftedX =
      Math.abs(currentBounds.x - intendedPosition.x) > POPUP_POSITION_DRIFT_TOLERANCE_PX;
    const driftedY =
      Math.abs(currentBounds.y - intendedPosition.y) > POPUP_POSITION_DRIFT_TOLERANCE_PX;
    if (!driftedX && !driftedY) return false;

    safeCall(targetWindow, 'setBounds', {
      x: intendedPosition.x,
      y: intendedPosition.y,
      width: currentBounds.width,
      height: currentBounds.height,
    });
    log.debug?.(
      `Restored popup window position to ${intendedPosition.x},${intendedPosition.y} after show`
    );
    return true;
  }

  /**
   * Show the window above full-screen content, keeping the user's saved position.
   *
   * The raise is held until the window hides so the widget stays usable over a video.
   * Pass keepElevated: false for one-off "bring to front" requests that should end at
   * the user's own always-on-top preference.
   */
  function showAboveFullScreen(targetWindow, { keepElevated = true } = {}) {
    if (!isUsableWindow(targetWindow)) return false;

    cancelPendingRaises();
    blurReleaseArmed = false;
    const intendedPosition = resolveIntendedPosition(targetWindow);

    if (safeCall(targetWindow, 'isMinimized')) {
      safeCall(targetWindow, 'restore');
    }

    setFullScreenVisibility(targetWindow, true);
    // Raise before show() so the first composited frame is already above the video
    // rather than appearing underneath it and being lifted a frame later.
    applyPopupLevel(targetWindow);
    elevated = true;

    safeCall(targetWindow, 'show');
    safeCall(targetWindow, 'focus');
    safeCall(targetWindow, 'moveTop');
    restorePosition(targetWindow, intendedPosition);

    POPUP_RAISE_REASSERT_DELAYS_MS.forEach((delay) => {
      schedule(() => {
        if (!elevated || !isUsableWindow(targetWindow)) return;
        if (safeCall(targetWindow, 'isVisible') === false) return;
        applyPopupLevel(targetWindow);
        safeCall(targetWindow, 'moveTop');
        restorePosition(targetWindow, intendedPosition);
      }, delay);
    });

    stickyElevation = stickyElevation || keepElevated;

    const releaseDelay = Math.max(...POPUP_RAISE_REASSERT_DELAYS_MS) + 1;
    if (stickyElevation) {
      if (shouldReleaseElevationOnBlur()) {
        schedule(() => {
          if (elevated && stickyElevation) blurReleaseArmed = true;
        }, releaseDelay);
      }
    } else {
      schedule(() => {
        if (!elevated || !isUsableWindow(targetWindow)) return;
        releaseElevation(targetWindow);
      }, releaseDelay);
    }

    return true;
  }

  /** Drop the temporary raise and return the window to the user's own preference. */
  function releaseElevation(targetWindow) {
    cancelPendingRaises();
    const wasElevated = elevated;
    elevated = false;
    stickyElevation = false;
    blurReleaseArmed = false;
    if (!isUsableWindow(targetWindow)) return false;
    if (wasElevated) {
      setFullScreenVisibility(targetWindow, false);
    }
    applyConfiguredLevel(targetWindow);
    return wasElevated;
  }

  /** Hide the popup, cancelling any raise still in flight so it cannot flash back. */
  function hidePopup(targetWindow) {
    cancelPendingRaises();
    if (!isUsableWindow(targetWindow)) {
      elevated = false;
      stickyElevation = false;
      blurReleaseArmed = false;
      return false;
    }
    // Release before hiding so a later show from the tray or menu does not inherit the
    // popup's above-everything z-order.
    releaseElevation(targetWindow);
    safeCall(targetWindow, 'hide');
    return true;
  }

  /**
   * React to the window hiding through some other path (tray toggle, close to tray,
   * minimize) so the temporary raise never outlives the popup.
   */
  function handleWindowHidden(targetWindow) {
    cancelPendingRaises();
    if (!elevated) {
      stickyElevation = false;
      return false;
    }
    return releaseElevation(targetWindow);
  }

  /**
   * Drop a sticky screen-saver raise after the user leaves the popup.
   *
   * The release is armed only after the full-screen activation/re-assert window, so a
   * compositor's immediate focus bounce cannot undo the very raise needed to show the
   * widget above a full-screen app.
   */
  function handleWindowBlur(targetWindow) {
    if (!elevated || !stickyElevation || !blurReleaseArmed) return false;
    if (!shouldReleaseElevationOnBlur()) return false;
    return releaseElevation(targetWindow);
  }

  return {
    showAboveFullScreen,
    hidePopup,
    releaseElevation,
    handleWindowHidden,
    handleWindowBlur,
    cancelPendingRaises,
    isElevated: () => elevated,
  };
}

module.exports = {
  POPUP_POSITION_DRIFT_TOLERANCE_PX,
  POPUP_RAISE_REASSERT_DELAYS_MS,
  POPUP_WINDOW_TOP_LEVEL,
  createPopupWindowPresenter,
};

/* global clearTimeout, setTimeout */

const AUTO_HIDE_DELAY_MS = 200;
const TRAY_DISMISS_GRACE_MS = 500;

function pointInsideBounds(point, bounds) {
  if (!point || !bounds) return false;
  if (![point.x, point.y, bounds.x, bounds.y, bounds.width, bounds.height].every(Number.isFinite)) {
    return false;
  }
  return (
    bounds.width > 0 &&
    bounds.height > 0 &&
    point.x >= bounds.x &&
    point.x < bounds.x + bounds.width &&
    point.y >= bounds.y &&
    point.y < bounds.y + bounds.height
  );
}

// Only the main window owns this controller. Pins and desktop-layer surfaces
// retain their existing visibility behavior.
function createWindowAutoHideController({
  getWindow,
  isEnabled,
  isSuppressed = () => false,
  hideWindow,
  getCursorPosition = () => null,
  now = () => Date.now(),
}) {
  let hideTimer = null;
  let activationTimer = null;
  let armed = false;
  const suspensions = new Set();
  let lastAutoHideAt = null;
  let lastAutoHidePoint = null;

  function usableWindow() {
    const window = getWindow();
    return window && !window.isDestroyed() ? window : null;
  }

  function cancelHide() {
    clearTimeout(hideTimer);
    hideTimer = null;
  }

  function handleHidden() {
    cancelHide();
    clearTimeout(activationTimer);
    activationTimer = null;
    armed = false;
  }

  function handleClosed() {
    handleHidden();
    suspensions.clear();
    lastAutoHideAt = null;
    lastAutoHidePoint = null;
  }

  function prepareToShow() {
    handleHidden();
    lastAutoHideAt = null;
    lastAutoHidePoint = null;
    const window = usableWindow();
    if (!window) return;
    armed = window.isVisible() && window.isFocused();
    // The presenter reasserts its raise for 120 ms. Do not interpret focus
    // bouncing during activation as the user dismissing the popup.
    activationTimer = setTimeout(() => {
      activationTimer = null;
      if (usableWindow() !== window) {
        armed = false;
        return;
      }
      armed = window.isVisible() && (armed || window.isFocused());
      // Remember a real focus followed by click-away during activation. Wait
      // for the raise to settle, then recheck instead of losing that blur.
      handleBlur();
    }, AUTO_HIDE_DELAY_MS);
  }

  function handleFocus() {
    cancelHide();
    armed = true;
  }

  function handleBlur() {
    cancelHide();
    const window = usableWindow();
    if (!window || !armed || !isEnabled() || suspensions.size || isSuppressed()) return;
    if (activationTimer !== null) return;
    if (!window.isVisible() || window.isFocused()) return;
    let blurPoint = null;
    try {
      const point = getCursorPosition();
      if (point) blurPoint = { x: point.x, y: point.y };
    } catch {
      // Native Wayland can refuse global cursor coordinates. Without them,
      // honor the tray activation rather than guess which click caused blur.
    }
    hideTimer = setTimeout(() => {
      hideTimer = null;
      // Re-read preferences and focus: a save, a dialog, or a tray action may
      // have happened since blur. Never act on the previous window instance.
      if (usableWindow() !== window || !armed || !isEnabled()) return;
      if (suspensions.size || isSuppressed() || !window.isVisible() || window.isFocused()) return;
      if (window.webContents?.isDevToolsFocused?.()) return;
      if (hideWindow()) {
        lastAutoHideAt = now();
        lastAutoHidePoint = blurPoint;
      }
    }, AUTO_HIDE_DELAY_MS);
  }

  function suspend() {
    const token = {};
    suspensions.add(token);
    cancelHide();
    return () => {
      // A close invalidates every old token. A late dialog/menu callback must
      // not release a suspension belonging to the replacement window.
      if (!suspensions.delete(token)) return;
      handleBlur();
    };
  }

  function consumeTrayDismissal(trayBounds) {
    cancelHide();
    const elapsed = lastAutoHideAt === null ? Infinity : now() - lastAutoHideAt;
    const recentlyHidden =
      elapsed >= 0 &&
      elapsed < TRAY_DISMISS_GRACE_MS &&
      pointInsideBounds(lastAutoHidePoint, trayBounds);
    lastAutoHideAt = null;
    lastAutoHidePoint = null;
    return recentlyHidden;
  }

  function watchDevTools() {
    const window = usableWindow();
    if (!window) return;
    const contents = window.webContents;
    let devTools = null;
    const recheck = () => {
      if (usableWindow() === window) handleBlur();
    };
    const detach = () => {
      devTools?.removeListener('blur', recheck);
      devTools = null;
    };
    const opened = () => {
      detach();
      devTools = contents.devToolsWebContents;
      // Leaving detached DevTools does not emit another main-window blur.
      devTools?.on('blur', recheck);
    };
    const closed = () => {
      detach();
      recheck();
    };
    contents.on('devtools-opened', opened);
    contents.on('devtools-closed', closed);
    if (contents.devToolsWebContents) opened();
    window.once('closed', () => {
      detach();
      contents.removeListener('devtools-opened', opened);
      contents.removeListener('devtools-closed', closed);
    });
  }

  return {
    prepareToShow,
    handleFocus,
    handleBlur,
    handleHidden,
    handleClosed,
    suspend,
    consumeTrayDismissal,
    watchDevTools,
  };
}

module.exports = { AUTO_HIDE_DELAY_MS, TRAY_DISMISS_GRACE_MS, createWindowAutoHideController };

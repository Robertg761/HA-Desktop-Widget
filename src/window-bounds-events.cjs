/**
 * Electron emits 'moved' and 'resized' once a user move or resize ends only on Windows. On macOS
 * 'moved' is an alias of 'move', so it fires continuously while the window is dragged, and
 * 'resized' also fires when the app animates its own bounds. Linux (X11 and XWayland) has neither
 * and only gets 'move' and 'resize', which fire for every bounds change, programmatic ones
 * included. Listeners must debounce on every platform and skip bounds the app applied itself.
 */
function emitsSettledBoundsEvents(platform) {
  return platform === 'darwin' || platform === 'win32';
}

/**
 * Call `onMove`/`onResize` when the window's position or size changes, using 'moved'/'resized'
 * where Electron emits them and 'move'/'resize' elsewhere.
 * @returns {string[]} The event names listened to.
 */
function onWindowBoundsChanged(targetWindow, { platform, onMove, onResize }) {
  const settled = emitsSettledBoundsEvents(platform);
  const moveEvent = settled ? 'moved' : 'move';
  const resizeEvent = settled ? 'resized' : 'resize';
  if (onMove) targetWindow.on(moveEvent, onMove);
  if (onResize) targetWindow.on(resizeEvent, onResize);
  return [onMove && moveEvent, onResize && resizeEvent].filter(Boolean);
}

module.exports = { emitsSettledBoundsEvents, onWindowBoundsChanged };

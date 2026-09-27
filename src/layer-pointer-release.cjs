/* global process, setTimeout, clearTimeout */

// A raised desktop-layer widget lowers itself once the user has moved on, which it normally
// learns from losing keyboard focus. With focus-follows-mouse (Hyprland's default, and Omarchy's),
// that happens far too early: the pointer crosses a tiled window on its way to the widget, the
// window takes focus, and the widget drops under it just before the pointer arrives.
//
// So on Hyprland, losing focus starts a watch on the pointer instead. The widget stays raised
// while the pointer is still, over the widget, or heading towards it, and lowers once the pointer
// has moved off somewhere else for a moment. Clicking the widget gives it focus back, which ends
// the watch.

const fs = require('fs');
const net = require('net');
const path = require('path');

const DEFAULT_INTERVAL_MS = 250;
const DEFAULT_SETTLE_MS = 1000;
// Getting at least this much closer between two checks counts as heading towards the widget.
const APPROACH_PX = 8;
// Smaller jumps than this are jitter, not the pointer moving.
const MOVE_PX = 3;

function distanceToRect(point, rect) {
  const dx = Math.max(rect.x - point.x, 0, point.x - (rect.x + rect.width));
  const dy = Math.max(rect.y - point.y, 0, point.y - (rect.y + rect.height));
  return Math.hypot(dx, dy);
}

/** Hyprland's request socket for this session, or '' outside Hyprland. */
function getHyprlandRequestSocket(env = process.env, exists = fs.existsSync) {
  const signature = String(env.HYPRLAND_INSTANCE_SIGNATURE || '').trim();
  if (!signature) return '';
  const candidates = [path.join('/tmp', 'hypr', signature, '.socket.sock')];
  const runtimeDir = String(env.XDG_RUNTIME_DIR || '').trim();
  if (runtimeDir) candidates.unshift(path.join(runtimeDir, 'hypr', signature, '.socket.sock'));
  return candidates.find((candidate) => exists(candidate)) || '';
}

/**
 * The pointer position from Hyprland's request socket (`j/cursorpos`), without starting a hyprctl
 * process for each check. Resolves null on any failure.
 */
function readHyprlandCursorFromSocket({ socketPath, netImpl = net, timeoutMs = 500 } = {}) {
  return new Promise((resolve) => {
    if (!socketPath) {
      resolve(null);
      return;
    }
    let settled = false;
    let data = '';
    const finish = (value) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolve(value);
    };
    const socket = netImpl.createConnection(socketPath, () => socket.write('j/cursorpos'));
    socket.setTimeout?.(timeoutMs, () => finish(null));
    socket.on('data', (chunk) => {
      data += chunk;
    });
    socket.on('end', () => {
      try {
        const cursor = JSON.parse(data);
        finish(Number.isFinite(cursor?.x) && Number.isFinite(cursor?.y) ? cursor : null);
      } catch {
        finish(null);
      }
    });
    socket.on('error', () => finish(null));
  });
}

/**
 * @param {Object} options
 * @param {() => Promise<{x: number, y: number}|null>} options.readCursor - Global pointer position.
 * @param {() => ({x: number, y: number, width: number, height: number}|null)} options.getRect -
 *   The widget's rectangle in the same coordinates, or null when it is not known.
 * @param {() => boolean} options.shouldKeepWatching - False once the widget is focused again or
 *   no longer raised.
 * @param {() => void} options.onRelease - Lower the widget.
 */
function createLayerPointerRelease({
  readCursor,
  getRect,
  shouldKeepWatching,
  onRelease,
  intervalMs = DEFAULT_INTERVAL_MS,
  settleMs = DEFAULT_SETTLE_MS,
  now = () => Date.now(),
  schedule = setTimeout,
  cancel = clearTimeout,
} = {}) {
  let timer = null;
  let generation = 0;
  let awaySince = null;
  let lastCursor = null;
  let lastDistance = Infinity;

  function stop() {
    generation += 1;
    if (timer !== null) cancel(timer);
    timer = null;
  }

  function release() {
    stop();
    onRelease();
  }

  async function check(watch) {
    timer = null;
    if (watch !== generation) return;
    if (!shouldKeepWatching()) {
      stop();
      return;
    }
    const cursor = await readCursor();
    if (watch !== generation) return;
    const rect = getRect();
    if (!cursor || !rect) {
      // Nothing to go on: behave as without the watch.
      release();
      return;
    }
    const distance = distanceToRect(cursor, rect);
    const moved =
      lastCursor !== null && Math.hypot(cursor.x - lastCursor.x, cursor.y - lastCursor.y) > MOVE_PX;
    if (distance === 0 || distance < lastDistance - APPROACH_PX) {
      // Over the widget, or on the way to it.
      awaySince = null;
    } else if (moved && awaySince === null) {
      // Moved off somewhere else. A pointer that never moves leaves the widget up.
      awaySince = now();
    }
    if (awaySince !== null && now() - awaySince >= settleMs) {
      release();
      return;
    }
    lastCursor = cursor;
    lastDistance = distance;
    timer = schedule(() => check(watch), intervalMs);
  }

  return {
    /**
     * Start watching after the widget lost focus. Returns false when the widget's position is
     * unknown, so the caller should lower it right away as before.
     */
    start() {
      stop();
      if (!getRect()) return false;
      awaySince = null;
      lastCursor = null;
      lastDistance = Infinity;
      void check(generation);
      return true;
    },
    stop,
  };
}

module.exports = {
  createLayerPointerRelease,
  distanceToRect,
  getHyprlandRequestSocket,
  readHyprlandCursorFromSocket,
};

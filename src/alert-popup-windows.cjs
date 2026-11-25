/**
 * The pop-up alert cards on screen, for the main process. Each card is its own small window,
 * stacked in a corner of the screen (see layoutAlertPopups); this keeps track of them, places them,
 * and carries out what a card asks for.
 *
 * A card is a temporary sibling of the desktop pins: the same page in its own mode, with no saved
 * bounds and no websocket. What a card may do was decided when it opened, from the main window's
 * request, so a card asks for "button 1" and this calls the service that button was given.
 */

const {
  MAX_ALERT_POPUPS,
  fitsAlertPopups,
  getAlertPopupSize,
  layoutAlertPopups,
  sanitizeAlertPopupRequest,
} = require('./alert-popup.cjs');

function createAlertPopupManager({
  createWindow,
  getWorkArea,
  forwardAction,
  focusMain,
  log = globalThis.console,
}) {
  if (typeof createWindow !== 'function') throw new TypeError('createWindow must be a function');
  if (typeof getWorkArea !== 'function') throw new TypeError('getWorkArea must be a function');
  if (typeof forwardAction !== 'function') throw new TypeError('forwardAction must be a function');

  // Oldest first, which is also top to bottom on screen.
  const popups = [];
  let nextId = 1;
  // The stack stays on the screen it started on until it is empty, so a card does not jump to
  // another monitor because the mouse moved there.
  let stackWorkArea = null;

  const isLive = (popup) => !!popup?.window && !popup.window.isDestroyed();

  const layout = () => {
    if (!popups.length) {
      stackWorkArea = null;
      return;
    }
    stackWorkArea = stackWorkArea || getWorkArea();
    const placed = layoutAlertPopups(
      popups.map((popup) => getAlertPopupSize(popup.request)),
      stackWorkArea
    );
    popups.forEach((popup, index) => {
      if (!isLive(popup)) return;
      try {
        popup.window.setBounds(placed[index]);
      } catch (error) {
        log.warn?.('Failed to place an alert pop-up:', error?.message || error);
      }
    });
  };

  const remove = (popup) => {
    const index = popups.indexOf(popup);
    if (index === -1) return;
    popups.splice(index, 1);
    layout();
  };

  const close = (id) => {
    const popup = popups.find((candidate) => candidate.id === id);
    if (!popup) return false;
    remove(popup);
    if (isLive(popup)) popup.window.close();
    return true;
  };

  const closeAll = () => {
    popups.splice(0).forEach((popup) => {
      if (isLive(popup)) popup.window.close();
    });
    stackWorkArea = null;
  };

  /**
   * Opens a card for a request from the main window, or brings the entity's open card up to date:
   * a doorbell pressed twice is one card, with its time and countdown started over.
   */
  const show = (request) => {
    const sanitized = sanitizeAlertPopupRequest(request);
    if (!sanitized) return { success: false, error: 'Invalid alert pop-up' };

    const existing = popups.find(
      (popup) => popup.request.entityId === sanitized.entityId && isLive(popup)
    );
    if (existing) {
      existing.request = sanitized;
      existing.window.webContents.send('alert-popup-update', {
        id: existing.id,
        popup: sanitized,
      });
      layout();
      return { success: true, id: existing.id, replaced: true };
    }

    while (popups.length >= MAX_ALERT_POPUPS) close(popups[0].id);

    const id = `alert-popup-${nextId}`;
    nextId += 1;
    const popup = { id, request: sanitized, window: null };
    stackWorkArea = stackWorkArea || getWorkArea();
    // On a short screen three cards with cameras do not fit: the oldest make room for the new one.
    while (
      popups.length &&
      !fitsAlertPopups(
        [...popups, popup].map((candidate) => getAlertPopupSize(candidate.request)),
        stackWorkArea
      )
    ) {
      close(popups[0].id);
      stackWorkArea = stackWorkArea || getWorkArea();
    }
    popups.push(popup);
    const placed = layoutAlertPopups(
      popups.map((candidate) => getAlertPopupSize(candidate.request)),
      stackWorkArea
    );
    try {
      popup.window = createWindow({ id, bounds: placed[placed.length - 1] });
    } catch (error) {
      remove(popup);
      log.error?.('Failed to open an alert pop-up:', error?.message || error);
      return { success: false, error: 'Failed to open the alert pop-up' };
    }
    if (!popup.window) {
      remove(popup);
      return { success: false, error: 'Failed to open the alert pop-up' };
    }
    popup.window.on('closed', () => remove(popup));
    layout();
    return { success: true, id };
  };

  /**
   * A screen was added, removed or changed (a laptop undocked, the taskbar moved): the stack moves
   * to the screen the user is on now, so no card is left off screen or under the taskbar.
   */
  const refreshWorkArea = () => {
    stackWorkArea = null;
    layout();
  };

  const getBySender = (webContents) =>
    popups.find((popup) => isLive(popup) && popup.window.webContents === webContents) || null;

  /**
   * What a card asked for. `action` is 'dismiss', 'open' (the widget, or the camera's full viewer
   * when the card shows one and `target` is 'camera') or a button's number.
   */
  const handleAction = async (popup, action, target = '') => {
    if (!popup || !popups.includes(popup)) return { success: false, error: 'Unknown alert pop-up' };
    if (action === 'dismiss') {
      close(popup.id);
      return { success: true };
    }
    if (action === 'open') {
      if (target === 'camera' && popup.request.camera) {
        const result = await forwardAction(popup.request.camera, 'open-details', {});
        focusMain?.();
        return result;
      }
      focusMain?.();
      return { success: true };
    }
    const index = Number(action);
    const button = Number.isInteger(index) ? popup.request.actions[index] : null;
    if (!button) return { success: false, error: 'Unknown alert pop-up button' };
    // Run by the main window's Entity Actions, as a click on the entity's tile is.
    return forwardAction(
      button.entityId,
      'entity-action',
      { action: button.action },
      { awaitResponse: true }
    );
  };

  return {
    show,
    close,
    closeAll,
    getBySender,
    handleAction,
    list: () => popups.slice(),
    refreshWorkArea,
  };
}

module.exports = { createAlertPopupManager };

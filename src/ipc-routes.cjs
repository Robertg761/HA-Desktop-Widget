/**
 * The IPC route table: every channel the app's windows can invoke, which windows may invoke it,
 * and how the main process runs it.
 *
 * Each channel is declared here once. main.js gives a channel its handler with
 * `ipcRoutes.handle(channel, handler)`; registering it with Electron, working out which window sent
 * a call, and turning away a window the channel does not allow all happen here, before the handler
 * runs. A handler is called as `handler(sender, ...args)`, where `sender` is the window that was let
 * through: `{ role, window, webContents }` plus whatever its role adds (a desktop pin's `entityId`).
 * Every channel is answered (ipcMain.handle); the app has no one-way (ipcMain.on) channels.
 *
 * A sender role is a kind of window the app opens: the main window, desktop pins and pop-up alert
 * cards. main.js says which windows have each role, one adapter per role. A call from a window that
 * has no role, from a destroyed window or from a subframe is turned away by every channel.
 *
 * A route says:
 * - roles: the roles that may call it.
 * - queue: a queue the call runs in. The sender is checked when the call's turn comes, so a window
 *   closed while its call waited is turned away. 'config' is the config mutation queue.
 * - rejection: what a turned-away call answers (default { success: false, error: 'Unauthorized' }).
 * - quiet: turned away without a log line.
 */

const MAIN = Object.freeze(['main']);
// Desktop pins share only what a pin's own page needs; a pin handler that acts on an entity checks
// that it is the pin's own entity.
const MAIN_AND_PINS = Object.freeze(['main', 'desktop-pin']);
// A pop-up alert card asks only for what it shows and tells what was pressed, by button number.
const ALERT_POPUP = Object.freeze(['alert-popup']);
const ALL_WINDOWS = Object.freeze(['main', 'desktop-pin', 'alert-popup']);
const CONFIG_QUEUE = 'config';

const IPC_ROUTES = deepFreeze({
  'renderer-ready': { roles: MAIN },
  'get-config': { roles: MAIN },
  'get-window-displays': { roles: MAIN },
  'get-locale-bootstrap': { roles: ALL_WINDOWS },
  'replace-config-entity-id': { roles: MAIN, queue: CONFIG_QUEUE },
  'update-config': { roles: MAIN, queue: CONFIG_QUEUE },
  'clear-token-reset-reason': { roles: MAIN, queue: CONFIG_QUEUE },
  'save-config': { roles: MAIN },

  // Home Assistant sign-in and the desktop companion
  'start-home-assistant-oauth': { roles: MAIN },
  'refresh-home-assistant-oauth': { roles: MAIN },
  'cancel-home-assistant-oauth': { roles: MAIN },
  'disconnect-home-assistant-oauth': { roles: MAIN },
  'test-ha-connection': { roles: MAIN },
  'get-desktop-companion-registration': { roles: MAIN },
  'get-desktop-companion-state': { roles: MAIN },
  'apply-desktop-companion-command': { roles: MAIN },

  // Desktop pins
  'pin-entity-to-desktop': { roles: MAIN, queue: CONFIG_QUEUE },
  'unpin-entity-from-desktop': { roles: MAIN, queue: CONFIG_QUEUE },
  'set-desktop-pin-edit-mode': { roles: MAIN },
  'update-desktop-pin-bounds': { roles: MAIN_AND_PINS, queue: CONFIG_QUEUE },
  'nudge-desktop-pin': { roles: MAIN_AND_PINS, queue: CONFIG_QUEUE },
  'sync-desktop-pin-content-min-bounds': { roles: MAIN_AND_PINS, queue: CONFIG_QUEUE },
  'get-desktop-pin-bootstrap': { roles: MAIN_AND_PINS },
  'request-desktop-pin-action': { roles: MAIN_AND_PINS },
  'desktop-pin-action-response': { roles: MAIN },
  'focus-desktop-pin': { roles: MAIN },

  // What the main window's Home Assistant connection tells the pins, the tray and the Omarchy bar
  'publish-ha-connection-state': { roles: MAIN },
  'publish-ha-unit-system': { roles: MAIN },
  'publish-ha-snapshot': { roles: MAIN },
  'publish-ha-entity-update': { roles: MAIN },
  'publish-omarchy-bar-tiles': { roles: MAIN },
  'update-tray-entity-icon': { roles: MAIN },
  'show-entity-tile-menu': { roles: MAIN },

  // The window itself
  'set-opacity': { roles: MAIN, queue: CONFIG_QUEUE },
  'preview-window-effects': { roles: MAIN },
  'set-always-on-top': { roles: MAIN, queue: CONFIG_QUEUE },
  'get-window-state': { roles: MAIN },
  'minimize-window': { roles: MAIN },
  'close-window': { roles: MAIN },
  'show-window': { roles: MAIN },
  'focus-window': { roles: MAIN },
  // A pin can be dragged only in edit mode, which the handler checks. A drag that cannot start or
  // end answers a quiet { success: false }, whoever asked.
  'begin-layer-drag': { roles: MAIN_AND_PINS, rejection: { success: false }, quiet: true },
  'end-layer-drag': {
    roles: MAIN_AND_PINS,
    queue: CONFIG_QUEUE,
    rejection: { success: false },
    quiet: true,
  },
  'get-desktop-blur-status': { roles: MAIN },
  'set-desktop-blur': { roles: MAIN },
  'get-desktop-integration': { roles: MAIN },

  // Profile sync and settings files
  'choose-profile-sync-folder': { roles: MAIN },
  'copy-profile-sync-file': {
    roles: MAIN,
    rejection: { ok: false, status: 'error', error: 'Unauthorized' },
  },
  'get-profile-sync-status': { roles: MAIN },
  'run-profile-sync': { roles: MAIN },
  'list-profile-sync-backups': { roles: MAIN },
  'restore-profile-sync-backup': { roles: MAIN, queue: CONFIG_QUEUE },
  'set-profile-sync-passphrase': { roles: MAIN, queue: CONFIG_QUEUE },
  'clear-profile-sync-passphrase': { roles: MAIN, queue: CONFIG_QUEUE },
  'resolve-profile-sync-first-enable': { roles: MAIN, queue: CONFIG_QUEUE },
  'get-cloud-sync-account': { roles: MAIN },
  'cloud-sync-sign-in': { roles: MAIN },
  'cloud-sync-cancel-sign-in': { roles: MAIN },
  'cloud-sync-sign-out': { roles: MAIN },
  'cloud-sync-open-billing': { roles: MAIN },
  'cloud-sync-delete-account': { roles: MAIN },
  'export-settings-file': { roles: MAIN },
  'preview-settings-import': { roles: MAIN },
  'apply-settings-import': { roles: MAIN, queue: CONFIG_QUEUE },

  // The app
  'get-login-item-settings': { roles: MAIN },
  'set-login-item-settings': { roles: MAIN },
  'restart-app': { roles: MAIN },
  'quit-app': { roles: MAIN },
  'check-for-updates': { roles: MAIN },
  'quit-and-install': { roles: MAIN },
  'get-app-version': { roles: MAIN },
  'get-os-info': { roles: MAIN },
  'open-logs': { roles: MAIN },
  'open-external': { roles: MAIN },
  // The donation dialog reads a status, not success.
  'start-card-donation': { roles: MAIN, rejection: { status: 'failed' } },
  'write-clipboard-text': { roles: MAIN },
  'debug-log': { roles: ALL_WINDOWS },

  // Language packs (get-locale-bootstrap, above, is the pins' and cards' too)
  'get-locale-packs': { roles: MAIN },
  'download-locale-pack': { roles: MAIN },
  'remove-locale-pack': { roles: MAIN },

  // Hotkeys and alerts
  'register-hotkey': { roles: MAIN, queue: CONFIG_QUEUE },
  'unregister-hotkey': { roles: MAIN, queue: CONFIG_QUEUE },
  'register-hotkeys': { roles: MAIN },
  'toggle-hotkeys': { roles: MAIN, queue: CONFIG_QUEUE },
  'validate-hotkey': { roles: MAIN },
  'register-popup-hotkey': { roles: MAIN, queue: CONFIG_QUEUE },
  'unregister-popup-hotkey': { roles: MAIN, queue: CONFIG_QUEUE },
  'get-popup-hotkey': { roles: MAIN },
  'is-popup-hotkey-available': { roles: MAIN },
  'set-entity-alert': { roles: MAIN, queue: CONFIG_QUEUE },
  'remove-entity-alert': { roles: MAIN, queue: CONFIG_QUEUE },
  'toggle-alerts': { roles: MAIN, queue: CONFIG_QUEUE },
  'set-persistent-notification-toasts': { roles: MAIN, queue: CONFIG_QUEUE },

  // Pop-up alert cards: the main window opens one when an alert rule asks for it.
  'show-alert-popup': { roles: MAIN },
  'get-alert-popup-bootstrap': { roles: ALERT_POPUP },
  'alert-popup-action': { roles: ALERT_POPUP },
});

const UNAUTHORIZED = Object.freeze({ success: false, error: 'Unauthorized' });

function deepFreeze(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.values(value).forEach(deepFreeze);
    Object.freeze(value);
  }
  return value;
}

/**
 * Registers the routes' handlers with Electron. `handle` throws for a channel the table does not
 * declare, or one that already has a handler.
 *
 * @param {object} deps
 * @param {{handle: Function}} deps.ipcMain
 * @param {{fromWebContents: Function}} deps.BrowserWindow
 * @param {Record<string, () => Iterable<{window: object}>>} deps.roles - For each role, the windows
 *   that have it now, each with what a handler should know about it. A sender gets the first role,
 *   in the order given, that lists its window.
 * @param {Record<string, (run: Function) => Function>} [deps.queues] - Wraps a call so it runs in
 *   that queue.
 * @param {{warn: Function}} deps.log
 */
function createIpcRoutes({ ipcMain, BrowserWindow, roles, queues = {}, log }) {
  Object.entries(IPC_ROUTES).forEach(([channel, route]) => {
    const missingRole = route.roles.find((role) => typeof roles[role] !== 'function');
    if (missingRole) throw new Error(`No windows are given for role ${missingRole} (${channel})`);
    if (route.queue && typeof queues[route.queue] !== 'function') {
      throw new Error(`No queue is given for ${route.queue} (${channel})`);
    }
  });
  const handled = new Set();

  // The same checks for every channel: a live top-level frame whose window is one of a role's
  // windows, and that window's own page.
  function resolveSender(event) {
    const webContents = event?.sender || null;
    if (!webContents) return null;
    const senderWindow = BrowserWindow.fromWebContents(webContents);
    if (!senderWindow || senderWindow.isDestroyed()) return null;
    const frame = event?.senderFrame || null;
    if (frame?.top && frame.top !== frame) return null;
    for (const [role, windowsWithRole] of Object.entries(roles)) {
      for (const candidate of windowsWithRole()) {
        const window = candidate?.window;
        if (
          window &&
          !window.isDestroyed() &&
          window.webContents === webContents &&
          window === senderWindow
        ) {
          return { ...candidate, role, webContents };
        }
      }
    }
    return null;
  }

  function handle(channel, handler) {
    if (!Object.prototype.hasOwnProperty.call(IPC_ROUTES, channel)) {
      throw new Error(`${channel} is not in the IPC route table`);
    }
    if (handled.has(channel)) throw new Error(`${channel} already has a handler`);
    handled.add(channel);
    const route = IPC_ROUTES[channel];
    const run = (event, ...args) => {
      const sender = resolveSender(event);
      if (!sender || !route.roles.includes(sender.role)) {
        if (!route.quiet) log.warn(`Unauthorized IPC sender rejected for ${channel}`);
        return { ...(route.rejection || UNAUTHORIZED) };
      }
      return handler(sender, ...args);
    };
    ipcMain.handle(channel, route.queue ? queues[route.queue](run) : run);
  }

  return { handle };
}

module.exports = { IPC_ROUTES, createIpcRoutes };

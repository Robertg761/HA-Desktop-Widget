/* global clearInterval, clearTimeout, console, setInterval, setTimeout */

/**
 * The parts of the update flow that do not need Electron: what a manual check hands back to the
 * window, when the app checks for updates by itself, and telling the person about a release the app
 * cannot install on its own. main.js supplies the updater, the clock, the timers and the
 * notification class.
 */

const STARTUP_CHECK_DELAY_MS = 30 * 1000;
const CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000;

/**
 * What a manual check on a self-updating build answers with.
 *
 * electron-updater's own result carries the download itself (a Promise) and a cancellation token,
 * and neither can cross the context bridge: the invoke failed to clone it, logged an error every
 * time a check found an update, and the window's await never settled. The window learns the outcome
 * from the updater's events; this is only the acknowledgement that a check began.
 *
 * @param {?{updateInfo?: {version?: string}}} result - What autoUpdater.checkForUpdates() resolved.
 * @returns {{status: 'checking', version: ?string}}
 */
function summarizeUpdateCheck(result) {
  const version = result?.updateInfo?.version;
  return { status: 'checking', version: typeof version === 'string' ? version : null };
}

/**
 * Runs a check at startup, every few hours after, and when the machine wakes up if one is due.
 *
 * The widget is built to run for weeks, and a single check 30 s after launch left it on the version
 * it started with. A suspended machine does not run its timers, so waking up is its own reason to
 * look: it checks then if a whole interval has passed since the last one.
 */
class UpdateCheckScheduler {
  /**
   * @param {Object} options
   * @param {() => Promise<unknown>} options.check - Runs one check. Rejections are caught here.
   * @param {() => number} [options.now] - The wall clock, in milliseconds.
   * @param {Function} [options.setTimer]
   * @param {Function} [options.clearTimer]
   * @param {Function} [options.setRepeating]
   * @param {Function} [options.clearRepeating]
   * @param {number} [options.startupDelayMs]
   * @param {number} [options.intervalMs]
   * @param {{warn: Function}} [options.logger]
   */
  constructor({
    check,
    now = Date.now,
    setTimer = setTimeout,
    clearTimer = clearTimeout,
    setRepeating = setInterval,
    clearRepeating = clearInterval,
    startupDelayMs = STARTUP_CHECK_DELAY_MS,
    intervalMs = CHECK_INTERVAL_MS,
    logger = console,
  }) {
    this.check = check;
    this.now = now;
    this.setTimer = setTimer;
    this.clearTimer = clearTimer;
    this.setRepeating = setRepeating;
    this.clearRepeating = clearRepeating;
    this.startupDelayMs = startupDelayMs;
    this.intervalMs = intervalMs;
    this.logger = logger;
    this.startupTimer = null;
    this.repeatingTimer = null;
    this.lastCheckAt = null;
    this.running = false;
  }

  start() {
    if (this.startupTimer || this.repeatingTimer) return;
    // The first look waits, so the first window is not competing with network work.
    this.startupTimer = this.setTimer(() => {
      this.startupTimer = null;
      void this.runCheck();
    }, this.startupDelayMs);
    this.repeatingTimer = this.setRepeating(() => void this.runCheck(), this.intervalMs);
    // Neither timer is a reason for the process to stay alive.
    this.startupTimer?.unref?.();
    this.repeatingTimer?.unref?.();
  }

  stop() {
    if (this.startupTimer) this.clearTimer(this.startupTimer);
    if (this.repeatingTimer) this.clearRepeating(this.repeatingTimer);
    this.startupTimer = null;
    this.repeatingTimer = null;
  }

  /** The machine woke up: check now if the last check is a whole interval old. */
  handleResume() {
    if (this.lastCheckAt !== null && this.now() - this.lastCheckAt < this.intervalMs) {
      return Promise.resolve(false);
    }
    return this.runCheck();
  }

  async runCheck() {
    // A check that is still running is the check; asking again only queues a second request.
    if (this.running) return false;
    this.running = true;
    this.lastCheckAt = this.now();
    try {
      await this.check();
      return true;
    } catch (error) {
      this.logger.warn('Scheduled update check failed:', error?.message || error);
      return false;
    } finally {
      this.running = false;
    }
  }
}

/**
 * Tells the person, once per version, that a release exists that the app cannot install itself.
 *
 * macOS, the Linux packages other than AppImage and the Windows Portable build are never updated
 * from inside the app, so without this they only learn of a release by pressing Check in Settings.
 */
function createUpdateAnnouncer({ Notification, translate, onClick, log = console, store = null }) {
  const announced = new Set();
  // The check runs after every launch, so the version told about last is kept on disk: without
  // it every restart would show the same notification again. It is read at the first check,
  // not when the app starts.
  let storeRead = false;
  const readStore = () => {
    if (storeRead) return;
    storeRead = true;
    try {
      const stored = store?.read?.();
      if (typeof stored === 'string' && stored) announced.add(stored);
    } catch (error) {
      log.warn('Could not read the last announced update:', error?.message || error);
    }
  };
  return {
    /**
     * @param {{version?: string, status?: string}} result - A 'manual' or 'portable' check result.
     * @returns {boolean} Whether a notification was shown.
     */
    announce(result) {
      const version = typeof result?.version === 'string' ? result.version : '';
      if (!version) return false;
      readStore();
      if (announced.has(version)) return false;
      if (typeof Notification !== 'function' || !Notification.isSupported?.()) return false;
      announced.add(version);
      try {
        const notification = new Notification({
          title: translate('A new version is available'),
          body: translate(
            'Version {{version}} is available. Open Settings > Advanced to download it.',
            {
              version,
            }
          ),
        });
        notification.on?.('click', () => onClick?.(result));
        notification.show();
        try {
          store?.write?.(version);
        } catch (error) {
          log.warn('Could not remember the announced update:', error?.message || error);
        }
        return true;
      } catch (error) {
        log.warn('Could not show the update notification:', error?.message || error);
        return false;
      }
    },
  };
}

module.exports = {
  CHECK_INTERVAL_MS,
  STARTUP_CHECK_DELAY_MS,
  UpdateCheckScheduler,
  createUpdateAnnouncer,
  summarizeUpdateCheck,
};

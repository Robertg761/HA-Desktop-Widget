/* global setTimeout, clearTimeout */
'use strict';

const HOUR_MS = 60 * 60 * 1000;

// Long enough that the check never competes with the window coming up.
const DEFAULT_FIRST_CHECK_DELAY_MS = 30 * 1000;
const DEFAULT_CHECK_INTERVAL_MS = 24 * HOUR_MS;
// A laptop that started offline asks again soon after it is likely to be back.
const DEFAULT_RETRY_DELAY_MS = HOUR_MS;

/**
 * Keeps the installed language packs current while the app runs. An upgrade ships new strings that
 * only the packs on main carry, and nothing but the Settings button used to fetch them.
 *
 * It does not decide which packs to replace: `refresh` (the localization service) does, and makes
 * no request at all when no pack is installed. This only decides when to ask, and what to do
 * afterwards. A failed check is not an error to the user (they may simply be offline); it is
 * logged once at info level and retried later. Installed packs keep working from disk throughout.
 *
 * @param {Object} options
 * @param {() => Promise<{updated: string[], failed: string[]}>} options.refresh - Replaces the stale packs.
 * @param {(updatedLocales: string[]) => void} options.onUpdated - Tell the windows and the tray.
 * @param {{info: Function, warn: Function}} [options.log]
 * @param {number} [options.firstCheckDelayMs]
 * @param {number} [options.checkIntervalMs] - After a check that reached the manifest.
 * @param {number} [options.retryDelayMs] - After one that did not, or that left a pack behind.
 * @param {{setTimeout: Function, clearTimeout: Function}} [options.timers] - Injectable for tests.
 * @returns {{start: () => void, stop: () => void}}
 */
function createLocalePackRefresher({
  refresh,
  onUpdated,
  log = {},
  firstCheckDelayMs = DEFAULT_FIRST_CHECK_DELAY_MS,
  checkIntervalMs = DEFAULT_CHECK_INTERVAL_MS,
  retryDelayMs = DEFAULT_RETRY_DELAY_MS,
  timers = { setTimeout, clearTimeout },
}) {
  let timer = null;
  let running = false;
  let stopped = true;

  function schedule(delayMs) {
    if (stopped) return;
    timer = timers.setTimeout(check, delayMs);
    // Waiting for the next check must never keep the process alive.
    timer?.unref?.();
  }

  async function check() {
    timer = null;
    if (running || stopped) return;
    running = true;
    let nextDelayMs = checkIntervalMs;
    try {
      const { updated = [], failed = [] } = (await refresh()) || {};
      if (updated.length) {
        log.info?.(`Updated the installed language packs: ${updated.join(', ')}`);
        try {
          onUpdated(updated);
        } catch (error) {
          log.warn?.(
            'Could not tell the windows about the updated language packs:',
            error?.message
          );
        }
      }
      if (failed.length) {
        log.warn?.(`Could not update the language packs: ${failed.join(', ')}`);
        nextDelayMs = retryDelayMs;
      }
    } catch (error) {
      log.info?.(`Language packs not checked for updates: ${error?.message || error}`);
      nextDelayMs = retryDelayMs;
    } finally {
      running = false;
    }
    schedule(nextDelayMs);
  }

  return {
    start() {
      if (!stopped) return;
      stopped = false;
      schedule(firstCheckDelayMs);
    },
    stop() {
      stopped = true;
      if (timer) timers.clearTimeout(timer);
      timer = null;
    },
  };
}

module.exports = {
  createLocalePackRefresher,
  DEFAULT_FIRST_CHECK_DELAY_MS,
  DEFAULT_CHECK_INTERVAL_MS,
  DEFAULT_RETRY_DELAY_MS,
};

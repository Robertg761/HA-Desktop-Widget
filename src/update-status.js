/**
 * What the app knows about updates, kept for as long as the window lives.
 *
 * Settings is built again every time it opens, and the update events come from the main process
 * whenever it likes: the check 30 s after launch, a check from the tray with Settings closed, the
 * download finishing. The state therefore lives here, outside the Settings markup, is fed by one
 * subscription made when the renderer starts, and Settings draws whatever it holds when it opens.
 * Without that, the status went back to "Ready to check for updates" on every open while a
 * "Download update" button for a link it no longer knew stayed on screen, and updates found before
 * Settings was ever opened were never seen.
 */

import { isolateAuto, t } from './i18n.js';

const IDLE = Object.freeze({ status: 'idle' });

let current = IDLE;
let unsubscribeFromMain = null;
const listeners = new Set();

function notify() {
  listeners.forEach((listener) => {
    try {
      listener(current);
    } catch (error) {
      console.error('Update status listener failed:', error);
    }
  });
}

function percentOf(progress) {
  const percent = Number(progress?.percent);
  return Number.isFinite(percent) ? Math.max(0, Math.min(100, Math.round(percent))) : 0;
}

/**
 * The state after one update event. Pure: nothing outside the arguments is read.
 *
 * @param {Object} previous - The state so far.
 * @param {Object} event - What main sent (`status` and its details), or one of this renderer's own
 *   (`install-failed`).
 * @returns {Object} The next state, or `previous` when the event means nothing.
 */
function reduceUpdateEvent(previous, event) {
  if (!event || typeof event.status !== 'string') return previous;
  // A check the app started on its own schedule: nobody asked, so that it began, that it found
  // nothing new, or that the network was away, is not something to put in front of the person.
  // An update it finds still is.
  if (event.background && ['checking', 'none', 'error'].includes(event.status)) {
    return previous;
  }
  switch (event.status) {
    case 'checking':
      return { status: 'checking' };
    case 'available':
      return { status: 'available', version: event.info?.version || event.version || '' };
    case 'none':
      return { status: 'none' };
    case 'downloading':
      return {
        status: 'downloading',
        // The version comes from the 'available' event before it.
        version: previous.version || '',
        percent: percentOf(event.progress),
      };
    case 'downloaded':
      return { status: 'downloaded', version: event.info?.version || event.version || '' };
    case 'error':
      return { status: 'error', error: event.error || '' };
    case 'portable':
    case 'manual':
      // The version and the kind of build, not a sentence: the line is worded when it is drawn.
      return {
        status: event.status,
        version: event.version || '',
        prerelease: event.prerelease === true,
        downloadUrl: event.downloadUrl || '',
      };
    case 'dev':
      return { status: 'dev' };
    case 'check-failed':
      return { status: 'check-failed' };
    case 'install-failed':
      // The update is still downloaded and can be tried again; the failure is said beside it.
      return { ...previous, status: 'downloaded', installError: event.error || '' };
    default:
      return previous;
  }
}

// One sentence with the version inside it, so a language can order it as it needs to, naming the
// button beside it.
function describeManualUpdate(update) {
  const { version } = update;
  if (!version) {
    return update.status === 'manual'
      ? t('Update available')
      : t('Portable builds do not support in-app updates.');
  }
  if (update.status === 'manual') {
    return t(
      'Update available: v{{version}}. This package cannot update itself; use “Download update” to get it from GitHub.',
      { version }
    );
  }
  return update.prerelease
    ? t(
        'Portable beta update available: v{{version}}. Use “Download portable update” to get the Portable build.',
        { version }
      )
    : t(
        'Portable update available: v{{version}}. Use “Download portable update” to get the Portable build.',
        { version }
      );
}

/**
 * What to draw for a state: the status line, how it is coloured, and which buttons and bar show.
 * Called again after a language change, so the text is built here from the state, never stored.
 *
 * @param {Object} update - A state from reduceUpdateEvent.
 * @returns {{text: string, tone: string, busy: boolean, installLabel: ?string, progress: ?number}}
 */
function describeUpdateState(update) {
  switch (update.status) {
    case 'checking':
      return {
        text: t('Checking for updates...'),
        tone: 'checking',
        busy: true,
        installLabel: null,
        progress: null,
      };
    case 'available':
      return {
        // An updater that names no version is not given the made-up "vunknown".
        text: update.version
          ? t('Update available: v{{version}}', { version: update.version })
          : t('Update available'),
        tone: 'available',
        busy: false,
        installLabel: null,
        progress: 0,
      };
    case 'none':
      return {
        text: t('You are up to date!'),
        tone: 'up-to-date',
        busy: false,
        installLabel: null,
        progress: null,
      };
    case 'downloading':
      return {
        text: t('Downloading update...'),
        tone: 'downloading',
        busy: true,
        installLabel: null,
        progress: update.percent ?? 0,
      };
    case 'downloaded':
      return {
        text: update.installError
          ? t('Error: {{error}}', { error: isolateAuto(update.installError) })
          : update.version
            ? t('Update v{{version}} ready to install', { version: update.version })
            : t('Update ready to install'),
        tone: update.installError ? 'error' : 'downloaded',
        busy: false,
        installLabel: t('Install update'),
        progress: null,
      };
    case 'error':
      return {
        text: t('Error: {{error}}', { error: isolateAuto(update.error || t('Unknown error')) }),
        tone: 'error',
        busy: false,
        installLabel: null,
        progress: null,
      };
    case 'portable':
    case 'manual':
      return {
        text: describeManualUpdate(update),
        tone: 'manual',
        busy: false,
        installLabel: update.downloadUrl
          ? update.status === 'manual'
            ? t('Download update')
            : t('Download portable update')
          : null,
        progress: null,
      };
    case 'check-failed':
      return {
        text: t('Error checking for updates'),
        tone: 'error',
        busy: false,
        installLabel: null,
        progress: null,
      };
    case 'dev':
      return {
        text: t('Auto-updates only work in packaged builds'),
        tone: 'idle',
        busy: false,
        installLabel: null,
        progress: null,
      };
    default:
      return {
        text: t('Ready to check for updates'),
        tone: 'idle',
        busy: false,
        installLabel: null,
        progress: null,
      };
  }
}

function getUpdateState() {
  return current;
}

/** Feeds one event into the state and tells whoever is drawing it. */
function applyUpdateEvent(event) {
  const next = reduceUpdateEvent(current, event);
  if (next === current) return current;
  current = next;
  notify();
  return current;
}

/**
 * Calls `listener` with the state after every change.
 * @returns {() => void} Stops listening.
 */
function subscribeToUpdateState(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/**
 * Starts hearing the main process, once. `onEvent` sees every event after the state has taken it,
 * for things only the window can do about one (opening Settings on a tray check).
 *
 * @param {{onAutoUpdate?: Function}} api - window.electronAPI.
 * @param {(event: Object) => void} [onEvent]
 */
function startUpdateStatus(api, onEvent) {
  if (unsubscribeFromMain || typeof api?.onAutoUpdate !== 'function') return;
  const dispose = api.onAutoUpdate((event) => {
    if (!event) return;
    applyUpdateEvent(event);
    onEvent?.(event);
  });
  unsubscribeFromMain = typeof dispose === 'function' ? dispose : () => {};
}

/** Back to the start. For tests, and for a window that is being reloaded. */
function resetUpdateStatus() {
  if (unsubscribeFromMain) unsubscribeFromMain();
  unsubscribeFromMain = null;
  current = IDLE;
  listeners.clear();
}

export {
  applyUpdateEvent,
  describeUpdateState,
  getUpdateState,
  reduceUpdateEvent,
  resetUpdateStatus,
  startUpdateStatus,
  subscribeToUpdateState,
};

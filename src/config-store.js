import state from './state.js';
import { t } from './i18n.js';
import { rememberDashboard } from './dashboard-history.js';
import { getRendererHost } from '@hadw/renderer/host.js';

// Main sends these with a config to describe the save, not as settings to keep.
const TRANSIENT_KEYS = [
  'configRecovery',
  'configRevision',
  'persistenceWarnings',
  'runtimeWarnings',
];

function isTestEnvironment() {
  return globalThis.process?.env?.NODE_ENV === 'test';
}

function cloneConfig(config) {
  return JSON.parse(JSON.stringify(config || {}));
}

function withoutTransientKeys(config) {
  const persistent = cloneConfig(config);
  TRANSIENT_KEYS.forEach((key) => delete persistent[key]);
  return persistent;
}

// A config main stands behind: it says which Home Assistant to use, and it is not a refusal.
function isAuthoritative(config) {
  return (
    !!config && typeof config === 'object' && config.success !== false && !!config.homeAssistant
  );
}

function rejection(response) {
  const error = new Error(response?.error || t('The main process rejected the settings update'));
  if (response && typeof response === 'object') error.result = response;
  return error;
}

function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  Object.values(value).forEach(deepFreeze);
  return Object.freeze(value);
}

function applyChange(config, change) {
  if (typeof change !== 'function') return { ...config, ...change };
  const draft = cloneConfig(config);
  const result = change(draft);
  return result === undefined ? draft : result;
}

// What puts the keys a patch changed back as they were. A key the config did not have goes back
// to null, the way the renderer clears a setting; undefined would not survive the IPC.
function restoringPatch(previous, patch) {
  return Object.fromEntries(Object.keys(patch).map((key) => [key, previous[key] ?? null]));
}

/**
 * The renderer's config store: the one way renderer code changes the config, and the one place
 * that knows how a change reaches the main process and what to make of its answer.
 *
 * Main owns the config. A write sends the change through the renderer host's `updateConfig`
 * (src/preload-api.cjs in the app, the virtual desktop in the panel preview), checks main's
 * answer, and makes that answer the config the renderer holds (src/state.js). A refusal that
 * carries the config main recovered to adopts that instead. Writes that overlap are ordered: only
 * the newest one adopts main's answer or rolls back, and not even that one once a config main sent
 * since has been adopted, so an older answer that arrives late cannot undo a newer edit.
 *
 * The config it holds is a copy nobody else shares, and is never changed in place: a change is a
 * new config. Under test it is frozen, so code that still edits it in place fails there instead
 * of going unnoticed by whatever compares configs.
 *
 * @param {Object} [options]
 * @param {Function} [options.getHost] - Returns the RendererHost to write through; read per write.
 * @param {Object} [options.holder] - Holds the config (src/state.js): `CONFIG` and `setConfig`.
 * @param {Function} [options.remember] - Keeps a replaced layout for Undo (dashboard-history.js).
 * @param {boolean} [options.freeze] - Freeze each config it holds. On under test.
 */
export function createConfigStore({
  getHost = getRendererHost,
  holder = state,
  remember = rememberDashboard,
  freeze = isTestEnvironment(),
} = {}) {
  // Counts every write sent and every config adopted. A write's answer is adopted only while the
  // write is still the newest word: a later write, or a config main sent since, has the last say.
  let latest = 0;
  let pendingWrites = 0;
  // Main's newest answer while writes are pending (at first, the config before them): what a
  // failed optimistic write rolls back to.
  let fallback = null;
  let fallbackRevision = 0;
  // Local changes made while writes are pending. Main's answer to a write sent before them does
  // not have them, so they are made again over it.
  let localChanges = [];

  function read() {
    return holder.CONFIG;
  }

  function hold(config) {
    const next = withoutTransientKeys(config);
    holder.setConfig(freeze ? deepFreeze(next) : next);
    return holder.CONFIG;
  }

  function adoptAnswer(config) {
    return hold(localChanges.reduce(applyChange, withoutTransientKeys(config)));
  }

  function noteAnswer(config, revision) {
    if (revision < fallbackRevision) return;
    fallback = withoutTransientKeys(config);
    fallbackRevision = revision;
  }

  async function rollBack({ host, previous, baseRevision, change, revision, undo }) {
    const payload =
      typeof change === 'function' ? { ...previous } : restoringPatch(previous, change);
    // Main keeps what a profile sync pull brought in after the write, rather than taking this
    // older snapshot as an edit of it.
    if (Number.isFinite(baseRevision)) payload.configRevision = baseRevision;
    const restored = await host.updateConfig(payload);
    if (!isAuthoritative(restored)) throw rejection(restored);
    noteAnswer(restored, revision);
    if (revision === latest) adoptAnswer(restored);
    if (undo) await undo(read());
  }

  async function write({
    host,
    change,
    next,
    optimistic,
    rollbackOnFailure,
    history,
    apply,
    undo,
  }) {
    const revision = ++latest;
    const previous = cloneConfig(read());
    // Taken before the write, for a rollback to name (see rollBack).
    const baseRevision = host.getConfigRevision?.();
    if (!pendingWrites) {
      fallback = previous;
      fallbackRevision = revision - 1;
      localChanges = [];
    }
    pendingWrites += 1;
    try {
      if (optimistic) hold(next);
      let answer;
      try {
        answer = await host.updateConfig(typeof change === 'function' ? next : change);
        if (!isAuthoritative(answer)) throw rejection(answer);
      } catch (error) {
        const current = revision === latest;
        if (error && typeof error === 'object') error.superseded = !current;
        if (current && !(optimistic && rollbackOnFailure === false)) {
          const recovered = error?.result?.config;
          if (isAuthoritative(recovered)) adoptAnswer(recovered);
          else if (optimistic) adoptAnswer(fallback || previous);
        }
        throw error;
      }
      if (history) remember(previous, answer, history === true ? undefined : history);
      noteAnswer(answer, revision);
      const config = revision === latest ? adoptAnswer(answer) : withoutTransientKeys(answer);
      if (apply) {
        try {
          await apply(config);
        } catch (error) {
          try {
            await rollBack({ host, previous, baseRevision, change, revision, undo });
          } catch (rollbackError) {
            if (error && typeof error === 'object') error.rollbackError = rollbackError;
          }
          throw error;
        }
      }
      return config;
    } finally {
      pendingWrites -= 1;
      if (!pendingWrites) {
        fallback = null;
        fallbackRevision = 0;
        localChanges = [];
      }
    }
  }

  /**
   * Change the config.
   *
   * @param {Object|Function} change - A patch of top-level keys, which is what main is sent; or a
   *   function given a copy of the config to edit (or to return a new one from), in which case
   *   main is sent the whole result.
   * @param {Object} [options]
   * @param {boolean} [options.persist=true] - false makes the change here only: for one main has
   *   already stored through its own request (a hotkey registered, alerts switched on), or one
   *   sent later. It must give the same result when made again (see localChanges).
   * @param {boolean} [options.optimistic=false] - Hold the change before main answers. If the
   *   write fails, the config goes back to main's newest answer, unless `rollbackOnFailure` is
   *   false (a migration that is better kept than undone). Without a host that can persist,
   *   an optimistic change is kept here and the write resolves.
   * @param {boolean|Object} [options.history] - Keep the layout this replaces for Undo and
   *   Restore dashboard; an object is rememberDashboard's options ({ wholeLayout, undone }).
   * @param {Function} [options.apply] - A side effect to run once main has stored the change
   *   (registering hotkeys, say). If it throws, the write is rolled back, `undo` runs, and the
   *   side effect's error is thrown with `rollbackError` set if the rollback failed too.
   * @param {Function} [options.undo] - Puts the side effect back after a rollback.
   * @returns {Promise<Object>} Main's answer, the config read() returns, unless a newer write
   *   has started since (then the newer write's answer will be). A refusal rejects with main's
   *   error; `error.result` is main's answer and `error.superseded` says a newer write had
   *   started, so nothing was rolled back for this one.
   */
  function update(change, options = {}) {
    const {
      persist = true,
      optimistic = false,
      rollbackOnFailure = true,
      history,
      apply,
      undo,
    } = options;
    try {
      const next = applyChange(read() || {}, change);
      if (!persist) {
        if (pendingWrites) localChanges.push(change);
        return Promise.resolve(hold(next));
      }
      const host = getHost();
      if (!host.canPersistConfig) {
        if (optimistic) return Promise.resolve(hold(next));
        throw new Error(t('Configuration updates are unavailable on this build.'));
      }
      return write({ host, change, next, optimistic, rollbackOnFailure, history, apply, undo });
    } catch (error) {
      return Promise.reject(error);
    }
  }

  /**
   * Hold a config main sent in answer to a request of its own (signing in, a sync passphrase, an
   * entity id replaced). Throws, with `error.result` set, when it is not one main stands behind.
   */
  function adopt(config) {
    if (!isAuthoritative(config)) throw rejection(config);
    latest += 1;
    if (pendingWrites) noteAnswer(config, latest);
    return adoptAnswer(config);
  }

  return { read, update, adopt };
}

const configStore = createConfigStore();

export default configStore;

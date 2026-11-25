/**
 * The config store: the one place the main process's config lives, changes and reaches disk.
 *
 * A change goes through `apply`. It runs in the store's mutation queue (or inline when the caller
 * is already running in that queue), is written to config.json before the promise settles, and is
 * stamped with a new revision. A change whose write fails is taken back out of memory. Once a change
 * is on disk, every subscriber hears about it, one at a time, in the order they subscribed; the
 * change's `origin` tells a subscriber what kind of change it was, so each can skip the kinds it
 * does not react to.
 *
 * The config object keeps its identity for the whole run (from one `load` to the next): a change
 * that builds a new config has its contents copied into the existing object. Code that holds the
 * object always reads the current config.
 */

const nodeFs = require('fs');
const path = require('path');
const { AsyncLocalStorage } = require('async_hooks');
const { createSerializedTaskRunner } = require('./serialized-task-runner.cjs');

/* The config file's name inside the profile directory, defined once: main.js and layer-shell.cjs
 * both build paths from it. */
const CONFIG_FILE_NAME = 'config.json';
const CONFIG_STORE_CLOSED = 'CONFIG_STORE_CLOSED';
const DEFAULT_DEBOUNCE_MS = 120;

const silentLog = { debug() {}, warn() {}, error() {} };

function messageOf(error) {
  return error?.message || String(error);
}

function hasOwn(target, key) {
  return Object.prototype.hasOwnProperty.call(target, key);
}

// Copies `source` into `target` so that `target` keeps its identity: how a change that has built a
// whole new config makes it current part-way through, before code it calls reads the config.
// Entries are read first: the source may share nested objects with the target.
function replaceConfigContents(target, source) {
  if (target === source) return;
  const entries = Object.entries(source);
  Object.keys(target).forEach((key) => delete target[key]);
  entries.forEach(([key, value]) => {
    target[key] = value;
  });
}

function changedKeys(before, after) {
  const keys = new Set([...Object.keys(before), ...Object.keys(after)]);
  return [...keys].filter(
    (key) =>
      hasOwn(before, key) !== hasOwn(after, key) ||
      JSON.stringify(before[key]) !== JSON.stringify(after[key])
  );
}

// Puts back only the keys a change touched, so an edit made to another key while the write was
// running (window bounds land outside the queue) survives the rollback.
function restoreKeys(target, before, keys) {
  keys.forEach((key) => {
    if (hasOwn(before, key)) {
      target[key] = before[key];
    } else {
      delete target[key];
    }
  });
}

/**
 * @param {object} options
 * @param {string} options.filePath where the config is written (atomically, through a temp file)
 * @param {(config: object) => {text: string, persistenceWarnings?: object[]}} [options.encode]
 *   turns the config into the file's text; may throw to refuse the write
 * @param {object} [options.fs] node's fs, or a stand-in with the same calls
 * @param {Function} [options.setTimeout]
 * @param {Function} [options.clearTimeout]
 * @param {number} [options.debounceMs] how long `save` waits for further edits before writing
 * @param {object} [options.log]
 */
function createConfigStore({
  filePath,
  encode = (config) => ({ text: JSON.stringify(config, null, 2) }),
  fs = nodeFs,
  setTimeout: setTimer = setTimeout,
  clearTimeout: clearTimer = clearTimeout,
  debounceMs = DEFAULT_DEBOUNCE_MS,
  log = silentLog,
} = {}) {
  if (typeof filePath !== 'string' || !filePath) {
    throw new TypeError('The config store needs a file path');
  }

  let current = null;
  let revision = 0;
  let writeBlockedReason = '';
  const subscribers = [];
  const beforeWriteHooks = [];

  // Writes. A snapshot is the config as text at one revision. Newer snapshots replace a pending
  // one; a write that fails is satisfied by a newer snapshot that succeeds, since it holds the
  // same change.
  let pendingSnapshot = null;
  let writeTimer = null;
  let writeInFlight = false;
  // Bumped by a synchronous flush: an async write that started earlier must not replace it.
  let writeEpoch = 0;
  let shutdownPending = false;
  let waiters = [];

  // The mutation queue.
  const runQueued = createSerializedTaskRunner();
  const taskContext = new AsyncLocalStorage();
  let activeTask = null;
  let closed = false;

  function waitForWrite(version) {
    return new Promise((resolve) => {
      waiters.push({ version, resolve });
    });
  }

  function settleWrites(version, result, { hasSupersedingSnapshot = false } = {}) {
    if (result.success === false && hasSupersedingSnapshot) return;
    const remaining = [];
    waiters.forEach((waiter) => {
      if (waiter.version <= version) {
        waiter.resolve({ ...result });
      } else {
        remaining.push(waiter);
      }
    });
    waiters = remaining;
  }

  function failAllWrites(error) {
    settleWrites(Number.POSITIVE_INFINITY, { success: false, error });
  }

  function clearWriteTimer() {
    if (writeTimer) {
      clearTimer(writeTimer);
      writeTimer = null;
    }
  }

  // Runs the before-write hooks and encodes the config. Hook edits to the config are part of the
  // snapshot; their undo functions run if the snapshot is never written.
  function buildSnapshot(change) {
    if (writeBlockedReason) throw new Error(writeBlockedReason);
    if (!current) throw new Error('No configuration has been loaded');
    const undos = [];
    const undo = () => {
      undos
        .splice(0)
        .reverse()
        .forEach((fn) => fn());
    };
    try {
      beforeWriteHooks.forEach((hook) => {
        const hookUndo = hook(current, change);
        if (typeof hookUndo === 'function') undos.push(hookUndo);
      });
      const encoded = encode(current);
      revision += 1;
      return {
        version: revision,
        epoch: writeEpoch,
        tempPath: `${filePath}.${revision}.tmp`,
        text: encoded.text,
        persistenceWarnings: [...(encoded.persistenceWarnings || [])],
        undo,
      };
    } catch (error) {
      undo();
      throw error;
    }
  }

  async function writeSnapshot(snapshot) {
    try {
      if (writeBlockedReason) throw new Error(writeBlockedReason);
      await fs.promises.mkdir(path.dirname(filePath), { recursive: true });
      await fs.promises.writeFile(snapshot.tempPath, snapshot.text, 'utf8');
      if (shutdownPending || snapshot.epoch !== writeEpoch) {
        await fs.promises.unlink(snapshot.tempPath).catch(() => {});
        return false;
      }
      // The epoch check and the replacement stay in one turn: an awaited rename could land after
      // a shutdown flush had already written a newer snapshot.
      fs.renameSync(snapshot.tempPath, filePath);
      return true;
    } catch (error) {
      await fs.promises.unlink(snapshot.tempPath).catch(() => {});
      throw error;
    }
  }

  function flushWrites() {
    if (writeInFlight || !pendingSnapshot) return;
    const snapshot = pendingSnapshot;
    pendingSnapshot = null;
    writeInFlight = true;
    writeSnapshot(snapshot)
      .then((written) => {
        if (written) settleWrites(snapshot.version, { success: true });
      })
      .catch((error) => {
        log.error('Failed to save config asynchronously:', error);
        settleWrites(
          snapshot.version,
          { success: false, error: messageOf(error) },
          { hasSupersedingSnapshot: !!pendingSnapshot }
        );
      })
      .finally(() => {
        writeInFlight = false;
        flushWrites();
      });
  }

  async function notify(change) {
    for (const { listener, name } of subscribers) {
      try {
        await listener(change);
      } catch (error) {
        const message = messageOf(error);
        log.warn(`Failed to apply ${name} after configuration was saved:`, message);
        change.runtimeWarnings.push({
          code: 'runtime_side_effect_failed',
          context: name,
          error: message,
        });
      }
    }
  }

  async function commit(change, { origin = 'unknown', persist = true, ...details } = {}) {
    if (!current) throw new Error('No configuration has been loaded');
    // The config is plain JSON (it round-trips through config.json), so a JSON copy is exact; it
    // also works in the vm contexts tests run main.js slices in, which lack structuredClone.
    const previous = JSON.parse(JSON.stringify(current));
    const rollback = (keys = changedKeys(previous, current)) =>
      restoreKeys(current, previous, keys);
    try {
      const replacement = typeof change === 'function' ? await change(current) : undefined;
      if (replacement && typeof replacement === 'object')
        replaceConfigContents(current, replacement);
    } catch (error) {
      rollback();
      throw error;
    }

    const record = {
      ...details,
      origin,
      previous,
      config: current,
      revision,
      persistenceWarnings: [],
      runtimeWarnings: [],
    };
    if (persist) {
      let snapshot;
      try {
        snapshot = buildSnapshot(record);
      } catch (error) {
        log.error('Failed to build config snapshot:', error);
        rollback();
        return { success: false, error: messageOf(error) };
      }
      const touched = changedKeys(previous, current);
      clearWriteTimer();
      pendingSnapshot = snapshot;
      const written = waitForWrite(snapshot.version);
      flushWrites();
      const result = await written;
      if (!result.success) {
        rollback(touched);
        snapshot.undo();
        return { success: false, error: result.error };
      }
      record.revision = snapshot.version;
      record.persistenceWarnings = snapshot.persistenceWarnings;
    }
    await notify(record);
    return {
      success: true,
      revision: record.revision,
      persistenceWarnings: record.persistenceWarnings,
      runtimeWarnings: record.runtimeWarnings,
    };
  }

  function runTask(task) {
    return runQueued(async () => {
      const token = {};
      activeTask = token;
      try {
        return await taskContext.run(token, task);
      } finally {
        if (activeTask === token) activeTask = null;
      }
    });
  }

  function isInsideActiveTask() {
    return activeTask !== null && taskContext.getStore() === activeTask;
  }

  function serialize(task) {
    if (closed) {
      const error = new Error('The application is shutting down; the change was not applied');
      error.code = CONFIG_STORE_CLOSED;
      return Promise.reject(error);
    }
    return runTask(task);
  }

  return {
    /** The current config: one object for the whole run, edited in place by every change. */
    get() {
      return current;
    },

    /** The revision of the newest snapshot built; renderer copies carry it to order themselves. */
    revision() {
      return revision;
    },

    /**
     * Takes `config` as the current config, without writing it or telling subscribers. A
     * non-empty `writeBlockedReason` refuses every write (the file on disk could not be read
     * safely, so writing would replace the user's config with defaults) until the next load.
     */
    load(config, { writeBlockedReason: reason = '' } = {}) {
      current = config;
      writeBlockedReason = typeof reason === 'string' ? reason.trim() : '';
      return current;
    },

    /**
     * Runs `task` after every task queued before it. Rejects with code CONFIG_STORE_CLOSED once
     * the store is closed.
     */
    serialize,

    /**
     * Applies a change and writes it to disk before resolving.
     *
     * `change(config)` edits the config in place or returns a replacement (or is null when the
     * edits were made beforehand; those are written but are not part of `previous`, so they are
     * neither rolled back nor seen as changed). Runs inline when called from a task already in the
     * queue, and queues otherwise.
     *
     * Resolves to `{ success: true, revision, persistenceWarnings, runtimeWarnings }`,
     * after every subscriber has run, or to `{ success: false, error }` when the write failed: the
     * keys the change touched are then back as they were. A change that throws is rolled back the
     * same way and the error rejects the promise.
     *
     * Options: `origin` names the kind of change for subscribers; `persist: false` changes memory
     * only (no write, no new revision) and still notifies; any other option is passed to
     * subscribers on the change record.
     */
    apply(change, options) {
      if (isInsideActiveTask()) return commit(change, options);
      return serialize(() => commit(change, options));
    },

    /**
     * Writes in-place edits after a short pause, outside the queue, with no rollback and no
     * notification: window geometry, status fields. Returns `{ success, persistenceWarnings }`
     * or `{ success: false, error }` when the snapshot could not be built.
     */
    save({ origin = 'unknown' } = {}) {
      try {
        pendingSnapshot = buildSnapshot({ origin, background: true });
        const { persistenceWarnings } = pendingSnapshot;
        clearWriteTimer();
        writeTimer = setTimer(() => {
          writeTimer = null;
          flushWrites();
        }, debounceMs);
        return { success: true, persistenceWarnings };
      } catch (error) {
        log.error('Failed to schedule config save:', error);
        return { success: false, error: messageOf(error) };
      }
    },

    /**
     * Writes the current config synchronously, for quitting and other exits that cannot wait.
     * With `shutdown` (the default), async writes still in flight are discarded rather than
     * landing after this one.
     */
    flushSync({ shutdown = true, origin = 'shutdown' } = {}) {
      shutdownPending = shutdown;
      writeEpoch += 1;
      clearWriteTimer();
      pendingSnapshot = null;
      let snapshot;
      try {
        snapshot = buildSnapshot({ origin, background: true });
      } catch (error) {
        log.error('Failed to build config snapshot for sync flush:', error);
        failAllWrites(messageOf(error));
        return { success: false, error: messageOf(error) };
      }
      try {
        fs.mkdirSync(path.dirname(filePath), { recursive: true });
        fs.writeFileSync(snapshot.tempPath, snapshot.text, 'utf8');
        fs.renameSync(snapshot.tempPath, filePath);
        settleWrites(snapshot.version, { success: true });
        return { success: true };
      } catch (error) {
        log.error('Failed to flush config synchronously:', error);
        try {
          if (fs.existsSync(snapshot.tempPath)) fs.unlinkSync(snapshot.tempPath);
        } catch {
          // best effort cleanup
        }
        failAllWrites(messageOf(error));
        return { success: false, error: messageOf(error) };
      }
    },

    /**
     * Stops taking new work for a shutdown. `finalTask` runs after the tasks already queued, as the
     * last one; the returned promise settles with it.
     */
    close(finalTask) {
      closed = true;
      return typeof finalTask === 'function' ? runTask(finalTask) : Promise.resolve();
    },

    /** Takes work again after a shutdown that did not happen. */
    reopen() {
      closed = false;
      shutdownPending = false;
    },

    /**
     * Calls `listener(change)` after every applied change, in subscription order, awaiting each.
     * The change record holds `origin`, `previous`, `config`, `revision`, `persistenceWarnings`,
     * `runtimeWarnings` and the options the change was applied with. A listener that throws adds
     * a runtime warning named `name` and the rest still run. Returns an unsubscribe function.
     */
    subscribe(listener, name = 'config change listener') {
      const entry = { listener, name };
      subscribers.push(entry);
      return () => {
        const index = subscribers.indexOf(entry);
        if (index >= 0) subscribers.splice(index, 1);
      };
    },

    /**
     * Calls `hook(config, change)` before each snapshot is encoded, to stamp the config (an edit
     * time, say). The hook may return an undo function, called if the snapshot's write fails.
     * Returns an unregister function.
     */
    beforeWrite(hook) {
      beforeWriteHooks.push(hook);
      return () => {
        const index = beforeWriteHooks.indexOf(hook);
        if (index >= 0) beforeWriteHooks.splice(index, 1);
      };
    },
  };
}

module.exports = {
  CONFIG_FILE_NAME,
  CONFIG_STORE_CLOSED,
  createConfigStore,
  replaceConfigContents,
};

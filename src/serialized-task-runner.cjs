function createSerializedTaskRunner() {
  let tail = Promise.resolve();

  return function runSerialized(task) {
    if (typeof task !== 'function') {
      return Promise.reject(new TypeError('Serialized task must be a function'));
    }

    const result = tail.then(task, task);
    // A rejected task must not poison the queue for later mutations.
    tail = result.then(
      () => undefined,
      () => undefined
    );
    return result;
  };
}

function createLatestTaskCoalescer(execute, options = {}) {
  if (typeof execute !== 'function') {
    throw new TypeError('Coalesced task executor must be a function');
  }

  let activePromise = null;
  let pendingArgs = null;
  const getPriority = typeof options.getPriority === 'function' ? options.getPriority : () => 0;

  const run = (...args) => {
    if (getPriority(args) > 0) {
      // Priority calls are explicit requests whose caller needs the result of
      // that exact invocation. The supplied executor is responsible for
      // serializing them with any active background work.
      return execute(...args);
    }

    if (activePromise) {
      // Keep only the latest background state. Intermediate interval/focus
      // triggers do not need their own full sync run.
      pendingArgs = args;
      return activePromise;
    }

    const drain = async () => {
      let nextArgs = args;
      let result;
      let finalError = null;
      while (nextArgs) {
        pendingArgs = null;
        try {
          result = await execute(...nextArgs);
          finalError = null;
        } catch (error) {
          finalError = error;
        }
        nextArgs = pendingArgs;
      }
      if (finalError) throw finalError;
      return result;
    };

    const pending = drain();
    const tracked = pending.finally(() => {
      if (activePromise === tracked) {
        activePromise = null;
      }
    });
    activePromise = tracked;
    return tracked;
  };

  run.isActive = () => !!activePromise;
  return run;
}

module.exports = { createSerializedTaskRunner, createLatestTaskCoalescer };

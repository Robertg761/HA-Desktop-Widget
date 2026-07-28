function createVersionedWriteAcknowledgements() {
  let waiters = [];

  function waitFor(snapshotVersion) {
    if (!Number.isFinite(snapshotVersion) || snapshotVersion < 0) {
      return Promise.reject(new TypeError('Snapshot version must be a non-negative number'));
    }
    return new Promise((resolve) => {
      waiters.push({ snapshotVersion, resolve });
    });
  }

  function complete(snapshotVersion, result, options = {}) {
    if (result?.success === false && options.hasSupersedingSnapshot === true) {
      return;
    }

    const remaining = [];
    waiters.forEach((waiter) => {
      if (waiter.snapshotVersion <= snapshotVersion) {
        waiter.resolve({ ...result, snapshotVersion });
      } else {
        remaining.push(waiter);
      }
    });
    waiters = remaining;
  }

  function failAll(error) {
    complete(Number.POSITIVE_INFINITY, {
      success: false,
      error: error?.message || String(error || 'Configuration write failed'),
    });
  }

  function pendingCount() {
    return waiters.length;
  }

  return { waitFor, complete, failAll, pendingCount };
}

function canCommitSnapshot(snapshot, { shutdownPending = false, currentEpoch = 0 } = {}) {
  return !!snapshot && shutdownPending !== true && Number(snapshot.epoch) === Number(currentEpoch);
}

module.exports = {
  canCommitSnapshot,
  createVersionedWriteAcknowledgements,
};

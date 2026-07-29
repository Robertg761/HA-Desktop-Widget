/**
 * @jest-environment node
 */

const {
  canCommitSnapshot,
  createVersionedWriteAcknowledgements,
} = require('../../src/versioned-write-acknowledgements.cjs');

describe('versioned config write acknowledgements', () => {
  it('keeps A successful when a later B write fails', async () => {
    const acknowledgements = createVersionedWriteAcknowledgements();
    const a = acknowledgements.waitFor(1);
    const b = acknowledgements.waitFor(2);

    acknowledgements.complete(1, { success: true });
    acknowledgements.complete(2, { success: false, error: 'B failed' });

    await expect(a).resolves.toMatchObject({ success: true, snapshotVersion: 1 });
    await expect(b).resolves.toMatchObject({
      success: false,
      error: 'B failed',
      snapshotVersion: 2,
    });
  });

  it('lets a superseding successful B satisfy an earlier failed A', async () => {
    const acknowledgements = createVersionedWriteAcknowledgements();
    const a = acknowledgements.waitFor(1);
    const b = acknowledgements.waitFor(2);
    let aSettled = false;
    void a.then(() => {
      aSettled = true;
    });

    acknowledgements.complete(
      1,
      { success: false, error: 'A failed' },
      { hasSupersedingSnapshot: true }
    );
    await Promise.resolve();
    expect(aSettled).toBe(false);

    acknowledgements.complete(2, { success: true });
    await expect(a).resolves.toMatchObject({ success: true, snapshotVersion: 2 });
    await expect(b).resolves.toMatchObject({ success: true, snapshotVersion: 2 });
  });

  it('rejects a stale or shutdown-invalidated snapshot before final replacement', () => {
    const snapshot = { epoch: 4 };

    expect(canCommitSnapshot(snapshot, { currentEpoch: 4 })).toBe(true);
    expect(canCommitSnapshot(snapshot, { currentEpoch: 5 })).toBe(false);
    expect(
      canCommitSnapshot(snapshot, {
        currentEpoch: 4,
        shutdownPending: true,
      })
    ).toBe(false);
  });
});

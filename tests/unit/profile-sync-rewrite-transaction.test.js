/**
 * @jest-environment node
 */

const {
  createProfileSyncRewriteTransaction,
  normalizeProfileSyncRewriteTransaction,
  getProfileSyncRewriteRecoveryAction,
  profileSyncRewriteEndpointMatches,
  isSecureProfileSyncStorageAvailable,
  classifyProfileSyncPassphraseSubmission,
  resolveProfileSyncEncryptionRequest,
  stageProfileSyncRewriteTransaction,
  runProfileSyncRewriteRecovery,
} = require('../../src/profile-sync-rewrite-transaction.cjs');

function makeTransaction(overrides = {}) {
  return createProfileSyncRewriteTransaction({
    provider: 'dropbox',
    cloudFilePath: '/cloud/profile.json',
    expectedRemoteIdentity: 'old-identity',
    targetRemoteIdentity: 'target-identity',
    targetEnvelopeSerialized: '{"schemaVersion":2}',
    oldPassphraseEncrypted: 'sealed-old',
    newPassphraseEncrypted: 'sealed-new',
    targetEncryptionEnabled: true,
    changeCredential: true,
    rememberNewPassphrase: false,
    ...overrides,
  });
}

describe('profile sync rewrite transaction', () => {
  it('recovers a crash before the remote write by writing the exact staged target', () => {
    const transaction = makeTransaction();

    expect(getProfileSyncRewriteRecoveryAction(transaction, 'old-identity')).toBe('write_target');
  });

  it('recovers a crash after the remote write by promoting the staged credential', () => {
    const transaction = makeTransaction();

    expect(getProfileSyncRewriteRecoveryAction(transaction, 'target-identity')).toBe('promote');
  });

  it('freezes when another writer produced neither known identity', () => {
    const transaction = makeTransaction();

    expect(getProfileSyncRewriteRecoveryAction(transaction, 'third-party-identity')).toBe('freeze');
  });

  it('binds recovery to the exact provider and path that were staged', () => {
    const transaction = makeTransaction();

    expect(profileSyncRewriteEndpointMatches(transaction, 'dropbox', '/cloud/profile.json')).toBe(
      true
    );
    expect(
      profileSyncRewriteEndpointMatches(transaction, 'googleDrive', '/cloud/profile.json')
    ).toBe(false);
    expect(profileSyncRewriteEndpointMatches(transaction, 'dropbox', '/other/profile.json')).toBe(
      false
    );
  });

  it('rejects incomplete or unknown-version persisted transactions', () => {
    expect(normalizeProfileSyncRewriteTransaction({ version: 1 })).toBeNull();
    expect(normalizeProfileSyncRewriteTransaction({ ...makeTransaction(), version: 2 })).toBeNull();
  });

  it('does not expose a transaction when its durable stage save fails', async () => {
    const transaction = makeTransaction();
    const persisted = [];

    await expect(
      stageProfileSyncRewriteTransaction(transaction, async (value) => {
        persisted.push(value);
        throw new Error('disk full');
      })
    ).rejects.toThrow('disk full');
    expect(persisted).toEqual([transaction]);
  });

  it('recovers old identity by verifying, exact-writing, then promoting', async () => {
    const transaction = makeTransaction();
    const identities = ['old-identity', 'old-identity', 'target-identity'];
    const events = [];

    await expect(
      runProfileSyncRewriteRecovery({
        transaction,
        readRemoteIdentity: async () => identities.shift(),
        verifyOldRemote: async () => events.push('verified-old'),
        writeExactTarget: async (serialized) => events.push(['wrote', serialized]),
        promoteLocal: async () => events.push('promoted'),
      })
    ).resolves.toEqual({ action: 'promote' });
    expect(events).toEqual([
      'verified-old',
      ['wrote', transaction.targetEnvelopeSerialized],
      'promoted',
    ]);
  });

  it('recovers target identity by promoting without another remote write', async () => {
    const transaction = makeTransaction();
    const writeExactTarget = jest.fn();
    const promoteLocal = jest.fn();

    await runProfileSyncRewriteRecovery({
      transaction,
      readRemoteIdentity: async () => 'target-identity',
      verifyOldRemote: jest.fn(),
      writeExactTarget,
      promoteLocal,
    });

    expect(writeExactTarget).not.toHaveBeenCalled();
    expect(promoteLocal).toHaveBeenCalledTimes(1);
  });

  it('freezes on a third identity without writing or promoting', async () => {
    const writeExactTarget = jest.fn();
    const promoteLocal = jest.fn();

    await expect(
      runProfileSyncRewriteRecovery({
        transaction: makeTransaction(),
        readRemoteIdentity: async () => 'third-party-identity',
        verifyOldRemote: jest.fn(),
        writeExactTarget,
        promoteLocal,
      })
    ).rejects.toMatchObject({ code: 'PROFILE_SYNC_REWRITE_REMOTE_DIVERGED' });
    expect(writeExactTarget).not.toHaveBeenCalled();
    expect(promoteLocal).not.toHaveBeenCalled();
  });

  it('surfaces promotion save failure after the target is already committed', async () => {
    const writeExactTarget = jest.fn();

    await expect(
      runProfileSyncRewriteRecovery({
        transaction: makeTransaction(),
        readRemoteIdentity: async () => 'target-identity',
        verifyOldRemote: jest.fn(),
        writeExactTarget,
        promoteLocal: async () => {
          throw new Error('local promotion save failed');
        },
      })
    ).rejects.toThrow('local promotion save failed');
    expect(writeExactTarget).not.toHaveBeenCalled();
  });

  it('surfaces an exact-target write failure without promoting local state', async () => {
    const promoteLocal = jest.fn();

    await expect(
      runProfileSyncRewriteRecovery({
        transaction: makeTransaction(),
        readRemoteIdentity: jest
          .fn()
          .mockResolvedValueOnce('old-identity')
          .mockResolvedValueOnce('old-identity'),
        verifyOldRemote: jest.fn(),
        writeExactTarget: async () => {
          throw new Error('remote write failed');
        },
        promoteLocal,
      })
    ).rejects.toThrow('remote write failed');
    expect(promoteLocal).not.toHaveBeenCalled();
  });

  it('freezes when post-write identity verification does not match the staged target', async () => {
    const promoteLocal = jest.fn();

    await expect(
      runProfileSyncRewriteRecovery({
        transaction: makeTransaction(),
        readRemoteIdentity: jest
          .fn()
          .mockResolvedValueOnce('old-identity')
          .mockResolvedValueOnce('old-identity')
          .mockResolvedValueOnce('third-party-identity'),
        verifyOldRemote: jest.fn(),
        writeExactTarget: jest.fn(),
        promoteLocal,
      })
    ).rejects.toMatchObject({ code: 'PROFILE_SYNC_REWRITE_VERIFY_FAILED' });
    expect(promoteLocal).not.toHaveBeenCalled();
  });

  it('rejects unavailable and Linux basic-text storage for persisted recovery keys', () => {
    expect(
      isSecureProfileSyncStorageAvailable(
        {
          isEncryptionAvailable: () => false,
          getSelectedStorageBackend: () => 'kwallet6',
        },
        'linux'
      )
    ).toBe(false);
    expect(
      isSecureProfileSyncStorageAvailable(
        {
          isEncryptionAvailable: () => true,
          getSelectedStorageBackend: () => 'basic_text',
        },
        'linux'
      )
    ).toBe(false);
    expect(
      isSecureProfileSyncStorageAvailable(
        {
          isEncryptionAvailable: () => true,
          getSelectedStorageBackend: () => 'kwallet6',
        },
        'linux'
      )
    ).toBe(true);
    expect(
      isSecureProfileSyncStorageAvailable(
        {
          isEncryptionAvailable: () => true,
          getSelectedStorageBackend: () => 'unknown',
        },
        'win32'
      )
    ).toBe(true);
  });

  it('treats a submitted key that unlocks remote after a remember=false restart as unlock-only', () => {
    expect(
      classifyProfileSyncPassphraseSubmission({
        remoteExists: true,
        remoteEncrypted: true,
        candidateUnlocksRemote: true,
        activePassphrase: '',
        candidatePassphrase: 'correct remote key',
      })
    ).toBe('unlock_or_remember');
  });

  it('distinguishes an actual rekey from an invalid key without a known old key', () => {
    expect(
      classifyProfileSyncPassphraseSubmission({
        remoteExists: true,
        remoteEncrypted: true,
        candidateUnlocksRemote: false,
        activePassphrase: 'known old key',
        candidatePassphrase: 'new key',
      })
    ).toBe('rekey');
    expect(
      classifyProfileSyncPassphraseSubmission({
        remoteExists: true,
        remoteEncrypted: true,
        candidateUnlocksRemote: false,
        activePassphrase: '',
        candidatePassphrase: 'wrong key',
      })
    ).toBe('reject');
  });

  it('keeps active encryption unchanged across the update-config/passphrase IPC crash window', () => {
    expect(
      resolveProfileSyncEncryptionRequest({
        syncEnabled: true,
        wasSyncEnabled: true,
        currentEncryptionEnabled: false,
        requestedEncryptionEnabled: true,
      })
    ).toEqual({ encryptionEnabled: false, pendingTarget: true });
  });

  it('commits the requested mode immediately only behind a new first-enable gate', () => {
    expect(
      resolveProfileSyncEncryptionRequest({
        syncEnabled: true,
        wasSyncEnabled: false,
        currentEncryptionEnabled: false,
        requestedEncryptionEnabled: true,
      })
    ).toEqual({ encryptionEnabled: true, pendingTarget: null });
  });
});

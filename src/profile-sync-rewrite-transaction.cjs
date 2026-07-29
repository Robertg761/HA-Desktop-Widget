const REWRITE_TRANSACTION_VERSION = 1;

function createProfileSyncRewriteTransaction(input = {}) {
  const transaction = {
    version: REWRITE_TRANSACTION_VERSION,
    reason: typeof input.reason === 'string' ? input.reason : 'profile_sync_rewrite',
    provider: typeof input.provider === 'string' ? input.provider : '',
    cloudFilePath: typeof input.cloudFilePath === 'string' ? input.cloudFilePath : '',
    expectedRemoteIdentity:
      typeof input.expectedRemoteIdentity === 'string' ? input.expectedRemoteIdentity : '',
    targetRemoteIdentity:
      typeof input.targetRemoteIdentity === 'string' ? input.targetRemoteIdentity : '',
    targetEnvelopeSerialized:
      typeof input.targetEnvelopeSerialized === 'string' ? input.targetEnvelopeSerialized : '',
    oldPassphraseEncrypted:
      typeof input.oldPassphraseEncrypted === 'string' ? input.oldPassphraseEncrypted : '',
    newPassphraseEncrypted:
      typeof input.newPassphraseEncrypted === 'string' ? input.newPassphraseEncrypted : '',
    targetEncryptionEnabled: input.targetEncryptionEnabled === true,
    changeCredential: input.changeCredential === true,
    rememberNewPassphrase: input.rememberNewPassphrase === true,
  };

  if (
    !transaction.provider ||
    !transaction.cloudFilePath ||
    !transaction.expectedRemoteIdentity ||
    !transaction.targetRemoteIdentity ||
    !transaction.targetEnvelopeSerialized ||
    !transaction.oldPassphraseEncrypted ||
    !transaction.newPassphraseEncrypted
  ) {
    throw new Error('Profile sync rewrite transaction is incomplete');
  }

  return transaction;
}

function normalizeProfileSyncRewriteTransaction(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  if (value.version !== REWRITE_TRANSACTION_VERSION) return null;
  try {
    return createProfileSyncRewriteTransaction(value);
  } catch {
    return null;
  }
}

function getProfileSyncRewriteRecoveryAction(transaction, currentRemoteIdentity) {
  const normalized = normalizeProfileSyncRewriteTransaction(transaction);
  if (!normalized || typeof currentRemoteIdentity !== 'string') return 'freeze';
  if (currentRemoteIdentity === normalized.targetRemoteIdentity) return 'promote';
  if (currentRemoteIdentity === normalized.expectedRemoteIdentity) return 'write_target';
  return 'freeze';
}

function profileSyncRewriteEndpointMatches(transaction, provider, cloudFilePath) {
  const normalized = normalizeProfileSyncRewriteTransaction(transaction);
  return (
    !!normalized && normalized.provider === provider && normalized.cloudFilePath === cloudFilePath
  );
}

function isSecureProfileSyncStorageAvailable(safeStorage, platform) {
  if (!safeStorage || typeof safeStorage.isEncryptionAvailable !== 'function') return false;
  if (!safeStorage.isEncryptionAvailable()) return false;
  if (platform !== 'linux') return true;
  try {
    const backend =
      typeof safeStorage.getSelectedStorageBackend === 'function'
        ? safeStorage.getSelectedStorageBackend()
        : 'unknown';
    return backend !== 'basic_text' && backend !== 'unknown';
  } catch {
    return false;
  }
}

function classifyProfileSyncPassphraseSubmission({
  remoteExists,
  remoteEncrypted,
  candidateUnlocksRemote,
  activePassphrase,
  candidatePassphrase,
}) {
  if (!remoteExists || !remoteEncrypted || candidateUnlocksRemote) return 'unlock_or_remember';
  if (activePassphrase && candidatePassphrase && activePassphrase !== candidatePassphrase) {
    return 'rekey';
  }
  return 'reject';
}

function resolveProfileSyncEncryptionRequest({
  syncEnabled,
  wasSyncEnabled,
  currentEncryptionEnabled,
  requestedEncryptionEnabled,
  existingPendingTarget = null,
}) {
  const requested = requestedEncryptionEnabled === true;
  const current = currentEncryptionEnabled === true;
  if (!syncEnabled || !wasSyncEnabled) {
    return { encryptionEnabled: requested, pendingTarget: null };
  }
  if (requested !== current) {
    return { encryptionEnabled: current, pendingTarget: requested };
  }
  return {
    encryptionEnabled: current,
    pendingTarget: typeof existingPendingTarget === 'boolean' ? existingPendingTarget : null,
  };
}

async function stageProfileSyncRewriteTransaction(transaction, persistStage) {
  const normalized = normalizeProfileSyncRewriteTransaction(transaction);
  if (!normalized) {
    throw new Error('Profile sync rewrite transaction is incomplete');
  }
  if (typeof persistStage !== 'function') {
    throw new TypeError('A durable stage writer is required');
  }
  await persistStage(normalized);
  return normalized;
}

async function runProfileSyncRewriteRecovery({
  transaction,
  readRemoteIdentity,
  verifyOldRemote,
  writeExactTarget,
  promoteLocal,
}) {
  const normalized = normalizeProfileSyncRewriteTransaction(transaction);
  if (!normalized) {
    throw new Error('No valid sync-key rewrite transaction is available');
  }
  if (
    typeof readRemoteIdentity !== 'function' ||
    typeof verifyOldRemote !== 'function' ||
    typeof writeExactTarget !== 'function' ||
    typeof promoteLocal !== 'function'
  ) {
    throw new TypeError('Profile sync rewrite recovery callbacks are incomplete');
  }

  let currentIdentity = await readRemoteIdentity();
  let action = getProfileSyncRewriteRecoveryAction(normalized, currentIdentity);
  if (action === 'freeze') {
    const error = new Error(
      'The remote profile changed during sync-key recovery. Automatic sync is frozen.'
    );
    error.code = 'PROFILE_SYNC_REWRITE_REMOTE_DIVERGED';
    throw error;
  }

  if (action === 'write_target') {
    await verifyOldRemote();
    currentIdentity = await readRemoteIdentity();
    if (currentIdentity !== normalized.expectedRemoteIdentity) {
      const error = new Error(
        'The remote profile changed during sync-key recovery. Automatic sync is frozen.'
      );
      error.code = 'PROFILE_SYNC_REWRITE_REMOTE_DIVERGED';
      throw error;
    }
    await writeExactTarget(normalized.targetEnvelopeSerialized);
    currentIdentity = await readRemoteIdentity();
    if (currentIdentity !== normalized.targetRemoteIdentity) {
      const error = new Error('The rewritten remote profile could not be verified');
      error.code = 'PROFILE_SYNC_REWRITE_VERIFY_FAILED';
      throw error;
    }
    action = 'promote';
  }

  await promoteLocal();
  return { action };
}

module.exports = {
  REWRITE_TRANSACTION_VERSION,
  createProfileSyncRewriteTransaction,
  normalizeProfileSyncRewriteTransaction,
  getProfileSyncRewriteRecoveryAction,
  profileSyncRewriteEndpointMatches,
  isSecureProfileSyncStorageAvailable,
  classifyProfileSyncPassphraseSubmission,
  resolveProfileSyncEncryptionRequest,
  stageProfileSyncRewriteTransaction,
  runProfileSyncRewriteRecovery,
};

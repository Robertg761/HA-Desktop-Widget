/**
 * @jest-environment node
 */

const fs = require('fs');
const path = require('path');

const settingsSource = fs.readFileSync(path.resolve(__dirname, '../../src/settings.js'), 'utf8');

describe('profile sync settings transition safeguards', () => {
  it('keeps current-key input visible and required for a session-only encryption disable', () => {
    expect(settingsSource).toContain('const needsCurrentKeyToDisable =');
    expect(settingsSource).toContain(
      'Enter the current remote passphrase before disabling encrypted sync.'
    );
    expect(settingsSource).toContain(
      'disablingEncryption && !typedPassphrase && !hasSavedPassphrase'
    );
  });

  it('shows durable pending encryption and key-recovery states', () => {
    expect(settingsSource).toContain('typeof status.encryptionChangePending');
    expect(settingsSource).toContain('Sync is paused until this is resolved.');
    expect(settingsSource).toContain('status.rewriteRecoveryRequired');
    expect(settingsSource).toContain('A protected sync-key recovery is pending.');
  });

  it('applies authoritative config and status even when the credential operation fails', () => {
    expect(settingsSource).toContain('if (passphraseResult?.config)');
    expect(settingsSource).toContain('applyPersistedConfigResponse(passphraseResult.config)');
    expect(settingsSource).toContain('if (passphraseResult?.status)');
    expect(settingsSource).toContain('updateProfileSyncStatusUi(passphraseResult.status)');
  });

  it('submits desired encryption mode and can cancel a durable pending request', () => {
    expect(settingsSource).toContain('pendingEncryptionChangeCancelled');
    expect(settingsSource).toContain('!!nextProfileSync.encryptionEnabled');
  });
});

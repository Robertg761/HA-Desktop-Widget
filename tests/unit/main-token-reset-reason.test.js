/** @jest-environment node */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const mainSource = fs.readFileSync(path.resolve(__dirname, '../../main.js'), 'utf8');

function sliceMain(startMarker, endMarker) {
  const start = mainSource.indexOf(startMarker);
  const end = mainSource.indexOf(endMarker, start);
  if (start < 0 || end <= start) throw new Error(`Could not slice main.js from ${startMarker}`);
  return mainSource.slice(start, end);
}

// The real snapshot code that decides what config.json says about the token, with the keyring
// and the file system stubbed. `keyring` is 'working', 'none' (no Secret Service) or 'failing'
// (encryptString throws). `handlers` holds the IPC handler the renderer calls once it has shown a
// reason, and `written` every config.json a save made.
function loadSnapshotCode({ keyring = 'working', config, recoveryToken = null } = {}) {
  const handlers = {};
  const written = [];
  const context = {
    JSON,
    Buffer,
    handlers,
    written,
    ipcMain: { handle: (channel, handler) => (handlers[channel] = handler) },
    serializeConfigMutationHandler: (handler) => handler,
    authorizeIpcSender: () => ({}),
    rejectUnauthorizedIpc: () => ({ success: false }),
    mainT: (text) => text,
    runPostSaveSideEffect: async () => {},
    pushConfigToRenderer: () => {},
    sanitizeConfigForRenderer: (value) => JSON.parse(JSON.stringify(value)),
    saveConfigDurably: async () => {
      written.push(context.buildConfigSnapshotForSave().configToSave);
      return { success: true };
    },
    log: { warn: () => {}, info: () => {}, debug: () => {}, error: () => {} },
    app: { getPath: () => path.join('profile', 'userData') },
    path,
    CONFIG_FILE_NAME: 'config.json',
    configWriteBlockedReason: '',
    configSnapshotVersion: 0,
    configWriteEpoch: 0,
    preservedEncryptedTokenForRecovery: recoveryToken,
    ensureConfigBackupBeforeFirstWrite: () => {},
    safeStorage: {
      isEncryptionAvailable: () => keyring !== 'none',
      encryptString: (value) => {
        if (keyring === 'failing') throw new Error('The keyring refused to seal it');
        return Buffer.from(`sealed:${value}`);
      },
    },
    config,
  };
  vm.createContext(context);
  vm.runInContext(
    [
      sliceMain(
        "const HOME_ASSISTANT_TOKEN_PLACEHOLDER = 'YOUR_LONG_LIVED_ACCESS_TOKEN';",
        'const HOME_ASSISTANT_OAUTH_REFRESH_SKEW_MS'
      ),
      sliceMain('function pruneConfig(', 'function quarantineCorruptConfig('),
      sliceMain('function buildConfigSnapshotForSave(', 'async function writeConfigSnapshotAsync('),
      sliceMain(
        "ipcMain.handle(\n  'clear-token-reset-reason'",
        'function normalizeHomeAssistantBaseUrlForIpc('
      ),
    ]
      .join('\n')
      .replace(/^const /gm, 'var '),
    context
  );
  return context;
}

const tokenConfig = (overrides = {}) => ({
  homeAssistant: { url: 'http://ha.local:8123', token: 'my-token', authMethod: 'token' },
  ...overrides,
});

describe('a token that cannot be encrypted when it is saved', () => {
  it.each(['none', 'failing'])(
    'is left out of the file, which says it was not saved (keyring %s)',
    (keyring) => {
      const config = tokenConfig();
      const { buildConfigSnapshotForSave } = loadSnapshotCode({ keyring, config });

      const snapshot = buildConfigSnapshotForSave();

      expect(snapshot.configToSave.homeAssistant.token).toBeUndefined();
      expect(snapshot.configToSave.tokenResetReason).toBe('not_persisted');
      expect(snapshot.persistenceWarnings.map((warning) => warning.code)).toEqual([
        'home_assistant_token_not_persisted',
      ]);
      // The token works for the rest of this session; nothing in memory says it is missing, so
      // nothing tells this session's user to unlock a keyring to get it back.
      expect(config.homeAssistant.token).toBe('my-token');
      expect(config.tokenResetReason).toBeUndefined();
    }
  );

  it('is encrypted into the file, with no reason, when the keyring works', () => {
    const config = tokenConfig();
    const { buildConfigSnapshotForSave } = loadSnapshotCode({ config });

    const snapshot = buildConfigSnapshotForSave();

    expect(snapshot.configToSave.homeAssistant.tokenEncrypted).toBe(true);
    expect(snapshot.configToSave.homeAssistant.token).toBe(
      Buffer.from('sealed:my-token').toString('base64')
    );
    expect(snapshot.configToSave.tokenResetReason).toBeUndefined();
  });

  it('keeps an unreadable encrypted token on disk, and the reason it could not be read', () => {
    const config = tokenConfig({ tokenResetReason: 'decryption_failed' });
    config.homeAssistant.token = 'YOUR_LONG_LIVED_ACCESS_TOKEN';
    const { buildConfigSnapshotForSave } = loadSnapshotCode({
      keyring: 'none',
      config,
      recoveryToken: 'ZW5jcnlwdGVk',
    });

    const snapshot = buildConfigSnapshotForSave();

    expect(snapshot.configToSave.homeAssistant.token).toBe('ZW5jcnlwdGVk');
    expect(snapshot.configToSave.homeAssistant.tokenEncrypted).toBe(true);
    expect(snapshot.configToSave.tokenResetReason).toBe('decryption_failed');
  });
});

describe('the reason a saved token is missing, as loaded', () => {
  const { reconcileTokenResetReason } = loadSnapshotCode({ config: {} });

  it('says not saved, rather than keyring locked, when the file holds no token at all', () => {
    // What a 4.0 build before 'not_persisted' wrote after a token was entered without a keyring.
    const loaded = reconcileTokenResetReason({
      homeAssistant: { url: 'http://ha.local:8123', authMethod: 'token', tokenEncrypted: false },
      tokenResetReason: 'encryption_unavailable',
    });
    expect(loaded.tokenResetReason).toBe('not_persisted');
  });

  it('keeps the keyring reason while an encrypted token is on disk to come back', () => {
    const loaded = reconcileTokenResetReason({
      homeAssistant: {
        url: 'http://ha.local:8123',
        token: 'YOUR_LONG_LIVED_ACCESS_TOKEN',
        tokenEncrypted: true,
      },
      tokenResetReason: 'encryption_unavailable',
    });
    expect(loaded.tokenResetReason).toBe('encryption_unavailable');
  });

  it('leaves a setup without a reason alone', () => {
    const loaded = reconcileTokenResetReason({ homeAssistant: { url: '', token: '' } });
    expect(loaded.tokenResetReason).toBeUndefined();
  });
});

describe('the reason a saved token is missing, once the renderer has shown it', () => {
  const placeholderConfig = (tokenResetReason, homeAssistant = {}) =>
    tokenConfig({
      homeAssistant: {
        url: 'http://ha.local:8123',
        token: 'YOUR_LONG_LIVED_ACCESS_TOKEN',
        authMethod: 'token',
        ...homeAssistant,
      },
      tokenResetReason,
    });

  it('still says not saved at the next start, so it does not open Welcome over the dashboard', async () => {
    // A start that read 'not_persisted': the person sees the panel and quits without a token.
    const config = placeholderConfig('not_persisted', { tokenEncrypted: false });
    const main = loadSnapshotCode({ keyring: 'none', config });

    await main.handlers['clear-token-reset-reason']({});
    // Any later save (a theme, a tab) writes the file the next start reads.
    main.written.push(main.buildConfigSnapshotForSave().configToSave);

    for (const file of main.written) {
      expect(main.reconcileTokenResetReason(file).tokenResetReason).toBe('not_persisted');
    }
  });

  it('forgets a keyring reason, which the encrypted token on disk brings back if still unreadable', async () => {
    const config = placeholderConfig('decryption_failed', { tokenEncrypted: true });
    const main = loadSnapshotCode({ keyring: 'none', config, recoveryToken: 'ZW5jcnlwdGVk' });

    await main.handlers['clear-token-reset-reason']({});

    expect(config.tokenResetReason).toBeUndefined();
    expect(main.written).toHaveLength(1);
    expect(main.written[0].tokenResetReason).toBeUndefined();
    expect(main.written[0].homeAssistant.token).toBe('ZW5jcnlwdGVk');
  });
});

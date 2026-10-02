/**
 * @jest-environment node
 *
 * Two computers sharing one sync folder, each running the real update-config and
 * profile sync handlers from main.js against its own config and its own OS
 * keyring. Every scenario here is a Settings save, as the renderer performs it,
 * followed by what the other computer sees.
 */

const fs = require('fs');
const path = require('path');
const {
  createProfileSyncHarness,
  createSafeStorage,
  profileSyncCore,
} = require('../helpers/profile-sync-devices.js');

const harness = createProfileSyncHarness();
const { syncFilePath, readSyncFile, createDevice, createSyncedPair } = harness;

const PASSPHRASE = 'correct horse battery';

beforeEach(() => harness.setup());
afterEach(() => harness.teardown());

const readRaw = () => fs.readFileSync(syncFilePath(), 'utf8');
const isEncrypted = () => readSyncFile().payload.encrypted === true;
const decodeFile = (passphrase = '') =>
  profileSyncCore.decodeEnvelopeSections(readSyncFile(), passphrase);

/** What is left in a device's sync state when nothing is in flight. */
const settled = (encryptionEnabled) => ({
  enabled: true,
  encryptionEnabled,
  encryptionChangePending: null,
  passphraseTransition: null,
  remoteRewritePending: false,
  firstEnableResolutionPending: false,
});

describe('first enable on two computers', () => {
  test('the second computer joins the file the first one created', async () => {
    const desktop = createDevice('desktop', { syncing: false });
    const laptop = createDevice('laptop', { syncing: false });

    const first = await desktop.saveSettings({ profileSync: { enabled: true } });
    expect(first.update.success).not.toBe(false);
    expect(readSyncFile().updatedByDeviceId).toBe(desktop.config.profileSync.deviceId);

    await laptop.saveSettings({ profileSync: { enabled: true } });
    expect(laptop.config.profileSync).toMatchObject(settled(false));
    expect(laptop.status().needsResolution).toBe(false);

    desktop.edit((config) => {
      config.opacity = 0.7;
    });
    await desktop.sync();
    await laptop.sync();
    expect(laptop.config.opacity).toBe(0.7);
  });

  test('encryption turned on while enabling sync encrypts the new file for the second computer too', async () => {
    const desktop = createDevice('desktop', { syncing: false });
    const laptop = createDevice('laptop', { syncing: false });

    const first = await desktop.saveSettings({
      profileSync: { enabled: true, encryptionEnabled: true },
      passphrase: PASSPHRASE,
      remember: true,
    });
    expect(first.passphrase.success).toBe(true);
    expect(isEncrypted()).toBe(true);

    const second = await laptop.saveSettings({
      profileSync: { enabled: true, encryptionEnabled: true },
      passphrase: PASSPHRASE,
    });
    expect(second.passphrase.success).toBe(true);
    expect(laptop.config.profileSync).toMatchObject(settled(true));
    expect(laptop.status().lastSyncStatus).toBe('success');
  });

  test('a wrong passphrase on the second computer syncs nothing and says why', async () => {
    const desktop = createDevice('desktop', { syncing: false });
    await desktop.saveSettings({
      profileSync: { enabled: true, encryptionEnabled: true },
      passphrase: PASSPHRASE,
    });
    const before = readRaw();

    const laptop = createDevice('laptop', { syncing: false });
    const result = await laptop.saveSettings({
      profileSync: { enabled: true, encryptionEnabled: true },
      passphrase: 'not the passphrase',
    });

    expect(result.passphrase.success).toBe(false);
    expect(result.passphrase.error).toContain('does not unlock');
    expect(readRaw()).toBe(before);
    // The stored status carries the reason, so it is not only a toast that vanishes.
    expect(laptop.status().lastSyncError).toContain('does not unlock');
  });
});

describe('joining an encrypted file with different settings', () => {
  test('choosing the file’s settings leaves the file as it is', async () => {
    const desktop = createDevice('desktop', { syncing: false });
    desktop.config.opacity = 0.6;
    await desktop.saveSettings({
      profileSync: { enabled: true, encryptionEnabled: true },
      passphrase: PASSPHRASE,
      remember: true,
    });
    const before = readRaw();

    const laptop = createDevice('laptop', { syncing: false });
    const result = await laptop.saveSettings({
      profileSync: { enabled: true, encryptionEnabled: true },
      passphrase: PASSPHRASE,
    });
    expect(result.passphrase.success).toBe(true);
    expect(laptop.status().needsResolution).toBe(true);

    const resolved = await laptop.invoke('resolve-profile-sync-first-enable', 'use_remote');

    expect(resolved.success).toBe(true);
    expect(laptop.config.opacity).toBe(0.6);
    // The file was already in this mode: nothing needed rewriting, so it is untouched.
    expect(readRaw()).toBe(before);
    expect(laptop.status().remoteRewritePending).toBe(false);
    expect(laptop.config.profileSync).toMatchObject(settled(true));
  });
});

describe('turning encryption on for a profile that already syncs', () => {
  test('encrypts the file when the keyring seals an empty string to nothing', async () => {
    const { desktop } = await createSyncedPair();

    const result = await desktop.saveSettings({
      profileSync: { encryptionEnabled: true },
      passphrase: PASSPHRASE,
      remember: true,
    });

    expect(result.passphrase.success).toBe(true);
    expect(isEncrypted()).toBe(true);
    expect(desktop.config.profileSync).toMatchObject(settled(true));
    expect(desktop.status().lastSyncStatus).toBe('success');
    expect((await decodeFile(PASSPHRASE)).sections.visualPersonalization.data.opacity).toBe(0.9);
  });

  test('works the same without remembering the passphrase', async () => {
    const { desktop } = await createSyncedPair();

    const result = await desktop.saveSettings({
      profileSync: { encryptionEnabled: true },
      passphrase: PASSPHRASE,
    });

    expect(result.passphrase.success).toBe(true);
    expect(isEncrypted()).toBe(true);
    expect(desktop.config.profileSync.storedPassphrase).toBe('');
    // The session keeps the passphrase, so the next sync does not stop.
    await expect(desktop.sync()).resolves.toMatchObject({ ok: true });
  });

  test('an edit saved together with the switch is published in the encrypted file', async () => {
    const { desktop, laptop } = await createSyncedPair();

    const result = await desktop.saveSettings({
      edit: (config) => {
        config.opacity = 0.55;
      },
      profileSync: { encryptionEnabled: true },
      passphrase: PASSPHRASE,
      remember: true,
    });

    expect(result.passphrase.success).toBe(true);
    expect(isEncrypted()).toBe(true);
    expect((await decodeFile(PASSPHRASE)).sections.visualPersonalization.data.opacity).toBe(0.55);
    expect(desktop.config.profileSync).toMatchObject(settled(true));

    await laptop.saveSettings({
      profileSync: { encryptionEnabled: true },
      passphrase: PASSPHRASE,
    });
    expect(laptop.config.opacity).toBe(0.55);
  });

  test('a change another computer pushed and this one has not pulled is merged in, not lost', async () => {
    const { desktop, laptop } = await createSyncedPair();
    laptop.edit((config) => {
      config.favoriteEntities = ['light.kitchen', 'light.porch'];
    });
    await laptop.sync();

    const result = await desktop.saveSettings({
      edit: (config) => {
        config.opacity = 0.6;
      },
      profileSync: { encryptionEnabled: true },
      passphrase: PASSPHRASE,
      remember: true,
    });

    expect(result.passphrase.success).toBe(true);
    const sections = (await decodeFile(PASSPHRASE)).sections;
    expect(sections.quickAccessLayout.data.favoriteEntities).toEqual([
      'light.kitchen',
      'light.porch',
    ]);
    expect(sections.visualPersonalization.data.opacity).toBe(0.6);
    expect(desktop.config.favoriteEntities).toEqual(['light.kitchen', 'light.porch']);
  });

  test('a passphrase that is too short changes nothing and leaves sync running', async () => {
    const { desktop } = await createSyncedPair();
    const before = readRaw();

    const result = await desktop.saveSettings({
      profileSync: { encryptionEnabled: true },
      passphrase: 'short',
    });

    expect(result.passphrase.success).toBe(false);
    expect(result.passphrase.error).toContain('at least 8 characters');
    expect(readRaw()).toBe(before);
    expect(desktop.config.profileSync).toMatchObject(settled(false));
    await expect(desktop.sync()).resolves.toMatchObject({ ok: true });
  });

  test('a keyring that is not running is named before anything is written, and sync keeps working', async () => {
    const { desktop } = await createSyncedPair({
      desktop: { safeStorage: createSafeStorage({ keyring: 'none' }) },
    });
    const before = readRaw();

    const result = await desktop.saveSettings({
      profileSync: { encryptionEnabled: true },
      passphrase: PASSPHRASE,
      remember: true,
    });

    expect(result.passphrase.success).toBe(false);
    expect(result.passphrase.error).toContain('GNOME Keyring or KWallet');
    expect(readRaw()).toBe(before);
    expect(desktop.config.profileSync).toMatchObject(settled(false));
    expect(desktop.status().encryptionChangePending).toBeNull();
    desktop.edit((config) => {
      config.opacity = 0.5;
    });
    await expect(desktop.sync()).resolves.toMatchObject({ ok: true, action: 'push' });
  });

  test('the first save of a profile that does not sync yet needs no keyring', async () => {
    const desktop = createDevice('desktop', {
      syncing: false,
      safeStorage: createSafeStorage({ keyring: 'none' }),
    });

    const result = await desktop.saveSettings({
      profileSync: { enabled: true, encryptionEnabled: true },
      passphrase: PASSPHRASE,
    });

    expect(result.passphrase.success).toBe(true);
    expect(isEncrypted()).toBe(true);
    // Nothing is saved, but the passphrase is held for the session, so Settings knows that
    // typing another one would rekey the file.
    expect(desktop.status().passphraseStored).toBe(false);
    expect(desktop.status().passphraseActive).toBe(true);
  });
});

describe('a computer that did not change the encryption', () => {
  async function encryptedByDesktop() {
    const pair = await createSyncedPair();
    await pair.desktop.saveSettings({
      profileSync: { encryptionEnabled: true },
      passphrase: PASSPHRASE,
      remember: true,
    });
    return pair;
  }

  test('stops with a message that says what to do when the file turned encrypted', async () => {
    const { laptop } = await encryptedByDesktop();

    await expect(laptop.sync()).rejects.toThrow('The sync file is encrypted. Turn on encryption');
    expect(laptop.status().remoteEncrypted).toBe(true);
  });

  test('joins the encrypted file with the passphrase, leaving the file alone', async () => {
    const { desktop, laptop } = await encryptedByDesktop();
    desktop.edit((config) => {
      config.opacity = 0.65;
    });
    await desktop.sync();
    const before = readRaw();

    const result = await laptop.saveSettings({
      profileSync: { encryptionEnabled: true },
      passphrase: PASSPHRASE,
      remember: true,
    });

    expect(result.passphrase.success).toBe(true);
    expect(result.passphrase.warning).toBe('');
    expect(readRaw()).toBe(before);
    expect(laptop.config.profileSync).toMatchObject(settled(true));
    expect(laptop.config.opacity).toBe(0.65);
    expect(laptop.status().lastSyncStatus).toBe('success');
  });

  test('joins without a keyring, keeping the passphrase for the session', async () => {
    const { laptop } = await createSyncedPair({
      laptop: { safeStorage: createSafeStorage({ keyring: 'none' }) },
    });
    // The desktop encrypts the file after the laptop has synced it.
    const desktop = createDevice('desktop2', {
      profileSync: { deviceId: 'desktop-2' },
      safeStorage: createSafeStorage(),
    });
    await desktop.sync();
    await desktop.saveSettings({
      profileSync: { encryptionEnabled: true },
      passphrase: PASSPHRASE,
      remember: true,
    });

    const result = await laptop.saveSettings({
      profileSync: { encryptionEnabled: true },
      passphrase: PASSPHRASE,
      remember: true,
    });

    expect(result.passphrase.success).toBe(true);
    expect(laptop.config.profileSync).toMatchObject(settled(true));
    expect(laptop.status().passphraseStored).toBe(false);
    await expect(laptop.sync()).resolves.toMatchObject({ ok: true });
  });

  test('a wrong passphrase changes nothing and sync is not left paused', async () => {
    const { laptop } = await encryptedByDesktop();
    const before = readRaw();

    const result = await laptop.saveSettings({
      profileSync: { encryptionEnabled: true },
      passphrase: 'not the passphrase',
    });

    expect(result.passphrase.success).toBe(false);
    expect(result.passphrase.error).toContain('passphrase does not match');
    expect(readRaw()).toBe(before);
    expect(laptop.config.profileSync).toMatchObject(settled(false));
    expect(laptop.status().encryptionChangePending).toBeNull();
  });

  test('a missing passphrase asks for the one the other computers use', async () => {
    const { laptop } = await encryptedByDesktop();

    const result = await laptop.invoke('set-profile-sync-passphrase', '', false, true);

    expect(result.success).toBe(false);
    expect(laptop.config.profileSync).toMatchObject(settled(false));
  });

  test('follows the file when another computer turned encryption off, without asking for the old passphrase', async () => {
    const { desktop, laptop } = await encryptedByDesktop();
    await laptop.saveSettings({
      profileSync: { encryptionEnabled: true },
      passphrase: PASSPHRASE,
    });
    // Another computer turns encryption off; this one forgot the passphrase meanwhile.
    const result = await desktop.saveSettings({ profileSync: { encryptionEnabled: false } });
    expect(result.passphrase.success).toBe(true);
    expect(isEncrypted()).toBe(false);
    laptop.context.profileSyncRuntime.passphraseSession = '';
    laptop.config.profileSync.storedPassphrase = '';
    laptop.config.profileSync.rememberPassphrase = false;

    await expect(laptop.sync()).rejects.toThrow('The sync file is not encrypted');
    const followed = await laptop.saveSettings({ profileSync: { encryptionEnabled: false } });

    expect(followed.passphrase.success).toBe(true);
    expect(laptop.config.profileSync).toMatchObject(settled(false));
    await expect(laptop.sync()).resolves.toMatchObject({ ok: true });
  });

  test('what the status says about the file is forgotten when the file cannot be read or the folder changes', async () => {
    const { desktop } = await encryptedByDesktop();
    expect(desktop.status().remoteEncrypted).toBe(true);

    // The last answer stands while the file is being read, so the form does not flicker.
    const realReadFile = fs.promises.readFile;
    let duringRead;
    desktop.context.fs = {
      ...fs,
      promises: {
        ...fs.promises,
        readFile: async (...args) => {
          duringRead = desktop.status().remoteEncrypted;
          return realReadFile(...args);
        },
      },
    };
    await desktop.sync();
    expect(duringRead).toBe(true);

    fs.writeFileSync(syncFilePath(), '');
    await desktop.sync().catch(() => {});
    expect(desktop.status().remoteEncrypted).toBeNull();

    desktop.context.profileSyncRuntime.remoteEncrypted = true;
    desktop.context.fs = {
      ...fs,
      promises: {
        ...fs.promises,
        stat: async () => {
          throw Object.assign(new Error('EACCES: permission denied'), { code: 'EACCES' });
        },
      },
    };
    await desktop.sync().catch(() => {});
    expect(desktop.status().remoteEncrypted).toBeNull();
    desktop.context.fs = fs;

    const next = desktop.rendererConfig();
    next.profileSync.cloudFilePath = path.join(
      path.dirname(desktop.userData),
      'Elsewhere',
      'ha-widget-profile-sync.json'
    );
    fs.mkdirSync(path.dirname(next.profileSync.cloudFilePath));
    desktop.context.profileSyncRuntime.remoteEncrypted = true;
    await desktop.invoke('update-config', next);
    expect(desktop.status().remoteEncrypted).toBeNull();
  });

  test('a restart without a remembered passphrase asks for the passphrase, not for encryption', async () => {
    const { desktop } = await encryptedByDesktop();
    desktop.context.profileSyncRuntime.passphraseSession = '';
    desktop.config.profileSync.storedPassphrase = '';
    desktop.config.profileSync.rememberPassphrase = false;

    await expect(desktop.sync()).rejects.toThrow('Enter the sync passphrase');
  });
});

describe('recovery records', () => {
  test('a staged rewrite sealed before secrets were wrapped still recovers', async () => {
    const { desktop } = await createSyncedPair();
    const { context } = desktop;
    await context.stageProfileSyncRewrite({
      oldPassphrase: '',
      newPassphrase: PASSPHRASE,
      rememberNewPassphrase: false,
      targetEncryptionEnabled: true,
      changeCredential: true,
      reason: 'encryption_transition',
    });
    const legacySeal = (secret) => Buffer.from(`sealed:${secret}`).toString('base64');
    context.config.profileSync.passphraseTransition.newPassphraseEncrypted = legacySeal(PASSPHRASE);

    await context.executePendingProfileSyncRewrite();

    expect(isEncrypted()).toBe(true);
    expect(desktop.config.profileSync).toMatchObject(settled(true));
  });

  test('never seals an empty secret, whatever the keyring does with one', async () => {
    const sealed = [];
    const storage = createSafeStorage();
    const encryptString = storage.encryptString;
    storage.encryptString = (value) => {
      sealed.push(value);
      return encryptString(value);
    };
    const { desktop } = await createSyncedPair({ desktop: { safeStorage: storage } });

    await desktop.saveSettings({
      profileSync: { encryptionEnabled: true },
      passphrase: PASSPHRASE,
      remember: true,
    });

    expect(sealed.length).toBeGreaterThan(0);
    expect(sealed.filter((value) => value === '')).toEqual([]);
  });
});

describe('a change that was asked for but never carried out', () => {
  test('can be given up without a passphrase or the file', async () => {
    const { desktop } = await createSyncedPair();
    await desktop.saveSettings({
      profileSync: { encryptionEnabled: true },
      passphrase: PASSPHRASE,
    });
    // The window closed (or the app crashed) between the two calls of a save that turned
    // encryption off, and the passphrase was only kept for the session.
    const next = desktop.rendererConfig();
    next.profileSync.encryptionEnabled = false;
    await desktop.invoke('update-config', next);
    expect(desktop.status().encryptionChangePending).toBe(false);
    desktop.context.profileSyncRuntime.passphraseSession = '';
    fs.rmSync(syncFilePath());

    const result = await desktop.invoke('set-profile-sync-passphrase', '', false, true);

    expect(result.success).toBe(true);
    expect(desktop.config.profileSync).toMatchObject(settled(true));
  });
});

describe('turning encryption off', () => {
  test('rewrites the file as plain text and the other computer follows', async () => {
    const { desktop, laptop } = await createSyncedPair();
    await desktop.saveSettings({
      profileSync: { encryptionEnabled: true },
      passphrase: PASSPHRASE,
      remember: true,
    });
    await laptop.saveSettings({
      profileSync: { encryptionEnabled: true },
      passphrase: PASSPHRASE,
      remember: true,
    });

    const result = await desktop.saveSettings({ profileSync: { encryptionEnabled: false } });

    expect(result.passphrase.success).toBe(true);
    expect(isEncrypted()).toBe(false);
    expect(desktop.config.profileSync).toMatchObject(settled(false));
    expect(desktop.status().passphraseStored).toBe(false);

    await laptop.saveSettings({ profileSync: { encryptionEnabled: false } });
    expect(laptop.config.profileSync).toMatchObject(settled(false));
    await expect(laptop.sync()).resolves.toMatchObject({ ok: true });
  });

  test('without the passphrase it refuses and leaves the encrypted file and sync as they were', async () => {
    const { desktop } = await createSyncedPair();
    await desktop.saveSettings({
      profileSync: { encryptionEnabled: true },
      passphrase: PASSPHRASE,
    });
    desktop.context.profileSyncRuntime.passphraseSession = '';
    const before = readRaw();

    const result = await desktop.saveSettings({ profileSync: { encryptionEnabled: false } });

    expect(result.passphrase.success).toBe(false);
    expect(result.passphrase.error).toContain('current remote passphrase');
    expect(readRaw()).toBe(before);
    expect(desktop.config.profileSync).toMatchObject(settled(true));
  });

  test('with a wrong passphrase it refuses and the file stays encrypted', async () => {
    const { desktop } = await createSyncedPair();
    await desktop.saveSettings({
      profileSync: { encryptionEnabled: true },
      passphrase: PASSPHRASE,
    });
    const before = readRaw();

    const result = await desktop.saveSettings({
      profileSync: { encryptionEnabled: false },
      passphrase: 'not the passphrase',
    });

    expect(result.passphrase.success).toBe(false);
    expect(readRaw()).toBe(before);
    expect(desktop.config.profileSync).toMatchObject(settled(true));
  });
});

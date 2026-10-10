/**
 * @jest-environment node
 *
 * What a person sees, and what can be done, when the shared sync file cannot be
 * read or written: a zero-byte or cut-off file, a damaged encrypted payload, a
 * folder the app may not write to. Two computers share one folder, as in
 * profile-sync-two-devices.test.js.
 */

const fs = require('fs');
const path = require('path');
const { createProfileSyncHarness } = require('../helpers/profile-sync-devices.js');

const harness = createProfileSyncHarness();
const { syncFilePath, readSyncFile, createDevice, createSyncedPair } = harness;

const PASSPHRASE = 'correct horse battery';
const DAMAGED_SENTENCE = 'The sync file is damaged. Use Sync up to replace it';
// Words that mean nothing to a person looking at a sync error.
const JARGON = /envelope|payload|initialization vector|JSON|ENOENT|EACCES|\.tmp-/i;

beforeEach(() => harness.setup());
afterEach(() => harness.teardown());

/** What a person is told when a run fails: the error as the app words it for display. */
const failureMessage = (device, run) =>
  run.then(
    () => '',
    (error) => device.context.mainTError(error)
  );

const damagedBackups = (device) => {
  const dir = path.join(device.userData, 'profile-sync-backups');
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((name) => name.startsWith('damaged-sync-file-'))
    .map((name) => fs.readFileSync(path.join(dir, name), 'utf8'));
};

describe('a sync file that cannot be read', () => {
  test.each([
    ['empty', ''],
    ['cut off', '{\n  "schemaVersion": 3,\n  "minReaderVersion": 3,\n  "upd'],
    ['not a sync file', '{"hello": "world"}'],
  ])('a %s file stops automatic syncs with a plain sentence', async (_label, contents) => {
    const { laptop } = await createSyncedPair();
    fs.writeFileSync(syncFilePath(), contents);

    expect(await failureMessage(laptop, laptop.sync())).toContain(DAMAGED_SENTENCE);
    expect(laptop.status().lastSyncError).toContain(DAMAGED_SENTENCE);
    expect(laptop.status().lastSyncError).not.toMatch(JARGON);
    // Nothing was overwritten by the failed run.
    expect(fs.readFileSync(syncFilePath(), 'utf8')).toBe(contents);
  });

  test('Sync down never replaces it either', async () => {
    const { laptop } = await createSyncedPair();
    fs.writeFileSync(syncFilePath(), '');

    expect(await failureMessage(laptop, laptop.sync('pull', 'manual'))).toContain(DAMAGED_SENTENCE);
    expect(fs.readFileSync(syncFilePath(), 'utf8')).toBe('');
    expect(damagedBackups(laptop)).toEqual([]);
  });

  test('Sync up keeps a copy of the text and replaces the file, and the other computer follows', async () => {
    const { desktop, laptop } = await createSyncedPair();
    const truncated = '{\n  "schemaVersion": 3,\n  "minReaderVersion": 3,\n  "upd';
    fs.writeFileSync(syncFilePath(), truncated);
    laptop.edit((config) => {
      config.opacity = 0.6;
    });

    const result = await laptop.sync('push', 'manual');

    expect(result.ok).toBe(true);
    expect(damagedBackups(laptop)).toEqual([truncated]);
    expect(readSyncFile().updatedByDeviceId).toBe(laptop.config.profileSync.deviceId);
    await desktop.sync();
    expect(desktop.config.opacity).toBe(0.6);
    expect(desktop.status().lastSyncStatus).toBe('success');
  });

  test('keeps only the newest copies of damaged files', async () => {
    const { laptop } = await createSyncedPair();
    for (let attempt = 1; attempt <= 7; attempt += 1) {
      fs.writeFileSync(syncFilePath(), `broken ${attempt}`);
      await laptop.sync('push', 'manual');
      // Copies are named by the millisecond, and a Windows clock can tick as slowly as every 16 ms.
      await new Promise((resolve) => setTimeout(resolve, 20));
    }

    expect(damagedBackups(laptop)).toHaveLength(5);
    expect(damagedBackups(laptop)).toContain('broken 7');
    expect(damagedBackups(laptop)).not.toContain('broken 1');
  });

  test('a file written by a newer version is not damaged and is never replaced', async () => {
    const { laptop } = await createSyncedPair();
    const newer = { ...readSyncFile(), schemaVersion: 4, minReaderVersion: 4 };
    fs.writeFileSync(syncFilePath(), JSON.stringify(newer));
    const before = fs.readFileSync(syncFilePath(), 'utf8');

    expect(await failureMessage(laptop, laptop.sync('push', 'manual'))).toContain('newer version');
    expect(fs.readFileSync(syncFilePath(), 'utf8')).toBe(before);
    expect(damagedBackups(laptop)).toEqual([]);
  });

  test('first enable offers to replace it, and Keep Local repairs it after keeping a copy', async () => {
    const desktop = createDevice('desktop');
    await desktop.sync();
    fs.writeFileSync(syncFilePath(), '');
    const laptop = createDevice('laptop', { syncing: false });

    await laptop.saveSettings({ profileSync: { enabled: true } });

    const status = laptop.status();
    expect(status.needsResolution).toBe(true);
    expect(status.damagedConflictSections).toEqual([
      'quickAccessLayout',
      'visualPersonalization',
      'automationAlerts',
      'connectionMediaPreferences',
    ]);

    const resolved = await laptop.invoke('resolve-profile-sync-first-enable', 'upload_local');

    expect(resolved.success).toBe(true);
    expect(damagedBackups(laptop)).toEqual(['']);
    expect(readSyncFile().updatedByDeviceId).toBe(laptop.config.profileSync.deviceId);
    expect(laptop.status().needsResolution).toBe(false);
    await expect(desktop.sync()).resolves.toMatchObject({ ok: true });
  });

  test('first enable reads a file that is still arriving once more before offering to replace it', async () => {
    const desktop = createDevice('desktop');
    await desktop.sync();
    const complete = fs.readFileSync(syncFilePath(), 'utf8');
    // The provider has delivered only part of the file when sync is turned on.
    fs.writeFileSync(syncFilePath(), complete.slice(0, 40));
    const laptop = createDevice('laptop', { syncing: false });
    let waits = 0;
    laptop.context.waitForSyncFileToSettle = async () => {
      waits += 1;
      fs.writeFileSync(syncFilePath(), complete);
    };

    await laptop.saveSettings({ profileSync: { enabled: true } });

    expect(waits).toBe(1);
    expect(laptop.status().needsResolution).toBe(false);
    expect(laptop.status().lastSyncStatus).toBe('success');
    expect(damagedBackups(laptop)).toEqual([]);
  });

  test('a file that changes while the choice is pending asks again instead of overwriting', async () => {
    const desktop = createDevice('desktop');
    await desktop.sync();
    fs.writeFileSync(syncFilePath(), '');
    const laptop = createDevice('laptop', { syncing: false });
    await laptop.saveSettings({ profileSync: { enabled: true } });

    fs.writeFileSync(syncFilePath(), 'still broken, differently');
    const resolved = await laptop.invoke('resolve-profile-sync-first-enable', 'upload_local');

    expect(resolved.success).toBe(false);
    expect(fs.readFileSync(syncFilePath(), 'utf8')).toBe('still broken, differently');
    expect(laptop.status().needsResolution).toBe(true);
  });
});

describe('an encrypted file with a damaged payload', () => {
  async function encryptedPair() {
    const pair = await createSyncedPair();
    await pair.desktop.saveSettings({
      profileSync: { encryptionEnabled: true },
      passphrase: PASSPHRASE,
      remember: true,
    });
    await pair.laptop.saveSettings({
      profileSync: { encryptionEnabled: true },
      passphrase: PASSPHRASE,
      remember: true,
    });
    return pair;
  }

  test('says the file is damaged rather than blaming the passphrase', async () => {
    const { laptop } = await encryptedPair();
    const file = readSyncFile();
    file.payload.iv = 'AAAA';
    fs.writeFileSync(syncFilePath(), JSON.stringify(file));

    expect(await failureMessage(laptop, laptop.sync())).toContain(DAMAGED_SENTENCE);
    expect(laptop.status().lastSyncError).not.toMatch(/passphrase|initialization vector/i);
  });

  test('Sync up replaces it, encrypted with the passphrase this computer holds', async () => {
    const { desktop, laptop } = await encryptedPair();
    const file = readSyncFile();
    file.payload.authTag = '';
    const damaged = JSON.stringify(file);
    fs.writeFileSync(syncFilePath(), damaged);

    await laptop.sync('push', 'manual');

    expect(damagedBackups(laptop)).toHaveLength(1);
    expect(readSyncFile().payload.encrypted).toBe(true);
    await expect(desktop.sync()).resolves.toMatchObject({ ok: true });
  });

  test('a wrong passphrase is still a passphrase problem, and Sync up does not override it', async () => {
    const { laptop } = await encryptedPair();
    laptop.context.profileSyncRuntime.passphraseSession = 'a different passphrase';
    const before = fs.readFileSync(syncFilePath(), 'utf8');

    expect(await failureMessage(laptop, laptop.sync('push', 'manual'))).toContain(
      'passphrase does not match'
    );
    expect(fs.readFileSync(syncFilePath(), 'utf8')).toBe(before);
    expect(damagedBackups(laptop)).toEqual([]);
  });
});

describe('a sync folder that cannot be written', () => {
  function failWritesWith(device, code, message) {
    const failure = Object.assign(new Error(message), { code });
    device.context.fs = {
      ...fs,
      promises: {
        ...fs.promises,
        writeFile: async (target, ...rest) => {
          if (String(target).includes('.tmp-')) throw failure;
          return fs.promises.writeFile(target, ...rest);
        },
      },
    };
  }

  test.each([
    [
      'EACCES',
      'permission',
      "EACCES: permission denied, open '/shared/ha-widget-profile-sync.json.tmp-1'",
    ],
    [
      'EROFS',
      'permission',
      "EROFS: read-only file system, open '/shared/ha-widget-profile-sync.json.tmp-1'",
    ],
    ['ENOSPC', 'is full', "ENOSPC: no space left on device, write '/shared/x.tmp-1'"],
    [
      'EBUSY',
      'in use by another program',
      "EBUSY: resource busy or locked, open '/shared/x.tmp-1'",
    ],
    ['EIO', 'Could not access the sync file (EIO)', "EIO: i/o error, write '/shared/x.tmp-1'"],
    [
      'ENOENT',
      'sync folder is unavailable',
      "ENOENT: no such file or directory, open '/shared/x.tmp-1'",
    ],
  ])(
    '%s is explained without the system text or the temporary file name',
    async (code, wording, message) => {
      const { desktop } = await createSyncedPair();
      desktop.edit((config) => {
        config.opacity = 0.5;
      });
      failWritesWith(desktop, code, message);

      expect(await failureMessage(desktop, desktop.sync())).toContain(wording);
      expect(desktop.status().lastSyncError).not.toMatch(JARGON);
      expect(desktop.status().lastSyncError).not.toContain('/shared');
      // The failed attempt leaves no half-written file behind.
      expect(
        fs.readdirSync(path.dirname(syncFilePath())).filter((n) => n.includes('.tmp-'))
      ).toEqual([]);
    }
  );
});

describe('a sync file another program has open', () => {
  test.each([
    ['win32', 'in use by another program or is read-only'],
    ['linux', 'does not have permission'],
  ])('EPERM on %s', async (platform, wording) => {
    const { desktop } = await createSyncedPair();
    desktop.edit((config) => {
      config.opacity = 0.5;
    });
    desktop.context.process = Object.create(process, { platform: { value: platform } });
    const failure = Object.assign(new Error('EPERM: operation not permitted, rename'), {
      code: 'EPERM',
    });
    desktop.context.fs = {
      ...fs,
      promises: {
        ...fs.promises,
        rename: async () => {
          throw failure;
        },
      },
    };

    expect(await failureMessage(desktop, desktop.sync())).toContain(wording);
  });
});

describe('writing the sync file', () => {
  test('goes through a hidden temporary file that reaches the disk before it replaces the file', async () => {
    const { desktop } = await createSyncedPair();
    desktop.edit((config) => {
      config.opacity = 0.5;
    });
    const steps = [];
    desktop.context.fs = {
      ...fs,
      promises: {
        ...fs.promises,
        open: async (target, ...rest) => {
          const handle = await fs.promises.open(target, ...rest);
          const sync = handle.sync.bind(handle);
          handle.sync = async () => {
            steps.push(`sync ${path.basename(target)}`);
            return sync();
          };
          return handle;
        },
        rename: async (from, to) => {
          steps.push(`rename ${path.basename(from)}`);
          return fs.promises.rename(from, to);
        },
      },
    };

    await desktop.sync();

    expect(steps).toHaveLength(2);
    expect(steps[0]).toMatch(/^sync \.ha-widget-profile-sync\.json\.tmp-\d+-[0-9a-f]+$/);
    expect(steps[1]).toBe(steps[0].replace('sync', 'rename'));
    expect(readSyncFile().payload.sections.visualPersonalization.data.opacity).toBe(0.5);
    expect(fs.readdirSync(path.dirname(syncFilePath()))).toEqual(['ha-widget-profile-sync.json']);
  });

  test('clears temporary files a crashed write left behind once they are an hour old', async () => {
    const { desktop } = await createSyncedPair();
    const folder = path.dirname(syncFilePath());
    const leave = (name, ageMs) => {
      const target = path.join(folder, name);
      fs.writeFileSync(target, '{');
      const at = new Date(Date.now() - ageMs);
      fs.utimesSync(target, at, at);
    };
    const twoHours = 2 * 60 * 60 * 1000;
    leave('.ha-widget-profile-sync.json.tmp-1700000000000-0a1b2c3d', twoHours);
    // The visible name earlier versions used.
    leave('ha-widget-profile-sync.json.tmp-1700000000000', twoHours);
    // Possibly another computer's write still under way.
    leave('.ha-widget-profile-sync.json.tmp-1700000000001-0a1b2c3e', 60 * 1000);
    leave('notes.json.tmp-1700000000000', twoHours);

    await desktop.sync();

    expect(fs.readdirSync(folder).sort()).toEqual([
      '.ha-widget-profile-sync.json.tmp-1700000000001-0a1b2c3e',
      'ha-widget-profile-sync.json',
      'notes.json.tmp-1700000000000',
    ]);
  });
});

describe('internal recovery failures', () => {
  test('an invalid recovery record is reported as a sentence, not as developer text', async () => {
    const { desktop } = await createSyncedPair();
    desktop.config.profileSync.passphraseTransition = { version: 1, reason: 'broken' };
    desktop.context.ensureProfileSyncConfigDefaults(desktop.config);

    const result = await desktop.invoke('run-profile-sync', 'auto').catch((error) => error);

    expect(result.error).toBe(
      "Could not update the sync file's encryption. Nothing was changed. Try again."
    );
  });

  test('describes the codes the rewrite machinery throws', () => {
    const { desktop } = { desktop: createDevice('desktop') };
    const { createRewriteTransactionError } = desktop.context;

    expect(desktop.context.mainTError(createRewriteTransactionError('anything technical'))).toBe(
      "Could not update the sync file's encryption. Nothing was changed. Try again."
    );
  });
});

/**
 * @jest-environment node
 *
 * What a computer keeps before something replaces its settings or a sync file it
 * could not read, and the folder-level details around a shared sync folder:
 * where the folder chooser opens, which files count as conflict copies, and how a
 * pending first-sync choice is reported.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { createProfileSyncHarness } = require('../helpers/profile-sync-devices.js');

const harness = createProfileSyncHarness();
const { syncFilePath, readSyncFile, createDevice, createSyncedPair } = harness;

beforeEach(() => harness.setup());
afterEach(() => harness.teardown());

const backupDir = (device) => path.join(device.userData, 'profile-sync-backups');
const backupFiles = (device, prefix) =>
  fs.existsSync(backupDir(device))
    ? fs.readdirSync(backupDir(device)).filter((name) => name.startsWith(prefix))
    : [];

/** Imports a settings file the way the Import button does, through the real controller. */
async function importSettings(device, settings) {
  const file = path.join(path.dirname(device.userData), `import-${Date.now()}.json`);
  fs.writeFileSync(
    file,
    JSON.stringify({ format: 'ha-desktop-widget-settings', version: 1, settings })
  );
  device.queueDialogResult({ canceled: false, filePaths: [file] });
  const preview = await device.invoke('preview-settings-import');
  expect(preview.success).toBe(true);
  const applied = await device.invoke('apply-settings-import', preview.id);
  expect(applied.success).toBe(true);
}

// Backups are named by the millisecond, and a Windows clock can tick as slowly as every 16 ms.
const wait = (ms = 20) => new Promise((resolve) => setTimeout(resolve, ms));

describe('backups taken before settings are replaced', () => {
  test('an import backup survives any number of routine sync pulls', async () => {
    const { desktop, laptop } = await createSyncedPair();
    await importSettings(laptop, { opacity: 0.55 });
    await wait();
    const [importBackup] = (await laptop.context.listProfileSyncBackups()).filter(
      (backup) => backup.reason === 'import'
    );
    expect(importBackup).toBeDefined();

    for (let round = 1; round <= 7; round += 1) {
      desktop.edit((config) => {
        config.opacity = 0.6 + round / 100;
      });
      await desktop.sync();
      await wait();
      // The laptop's import is a local change, so make it the older side each round.
      laptop.context.config.profileSync.syncBaseline.visualPersonalization =
        desktop.context.profileSyncCore.computeSectionHash(
          'visualPersonalization',
          desktop.context.profileSyncCore.buildLocalSections(desktop.config, {
            preset: 'visual',
          }).visualPersonalization
        );
      laptop.context.config.opacity = 0.9;
      await laptop.sync('pull', 'manual');
      await wait();
    }

    const backups = await laptop.context.listProfileSyncBackups();
    const pulls = backups.filter((backup) => backup.kind === 'local' && backup.reason === 'pull');
    expect(pulls.length).toBeLessThanOrEqual(5);
    expect(backups.map((backup) => backup.id)).toContain(importBackup.id);
  });

  test('imports and restores share one set of five, kept apart from pulls', async () => {
    const { laptop } = await createSyncedPair();
    for (let round = 1; round <= 7; round += 1) {
      await importSettings(laptop, { opacity: 0.5 + round / 100 });
      await wait();
    }

    const manual = (await laptop.context.listProfileSyncBackups()).filter(
      (backup) => backup.reason === 'import'
    );
    expect(manual).toHaveLength(5);
    expect(backupFiles(laptop, 'local-profile')).toHaveLength(5);
  });

  test('says why each backup was taken, and treats an older backup as a pull', async () => {
    const { desktop, laptop } = await createSyncedPair();
    desktop.edit((config) => {
      config.opacity = 0.6;
    });
    await desktop.sync();
    await laptop.sync();
    await wait();
    await importSettings(laptop, { opacity: 0.7 });
    await wait();
    const [toRestore] = (await laptop.context.listProfileSyncBackups()).filter(
      (backup) => backup.reason === 'pull'
    );
    await laptop.context.restoreProfileSyncBackup(toRestore.id);
    laptop.edit((config) => {
      config.opacity = 0.45;
    });
    await laptop.sync('push', 'manual');
    // A backup written before reasons were recorded.
    fs.writeFileSync(
      path.join(backupDir(laptop), 'local-profile-1.json'),
      JSON.stringify({
        backedUpAt: '2026-01-01T00:00:00.000Z',
        sections: { visualPersonalization: { opacity: 0.8 } },
      })
    );

    const reasons = (await laptop.context.listProfileSyncBackups()).map(
      (backup) => `${backup.kind}:${backup.reason}`
    );
    expect(reasons).toEqual(
      expect.arrayContaining(['local:pull', 'local:import', 'local:restore', 'remote:push'])
    );
    expect(reasons.filter((reason) => reason === 'local:pull')).toHaveLength(2);
  });
});

describe('moving the sync to a folder that already holds a sync file', () => {
  async function laptopWithOtherFolder() {
    const { desktop, laptop } = await createSyncedPair();
    const otherFolder = path.join(path.dirname(laptop.userData), 'Other');
    fs.mkdirSync(otherFolder);
    laptop.queueDialogResult({ canceled: false, filePaths: [otherFolder] });
    await laptop.invoke('choose-profile-sync-folder', 'dropbox');
    const otherFile = path.join(otherFolder, 'ha-widget-profile-sync.json');
    return { desktop, laptop, otherFile };
  }

  test('copying the sync file never replaces a file that is already there', async () => {
    const { laptop, otherFile } = await laptopWithOtherFolder();
    const anotherComputersFile = '{"another": "computer"}\n';
    fs.writeFileSync(otherFile, anotherComputersFile);

    const refused = await laptop.invoke('copy-profile-sync-file', syncFilePath(), otherFile);
    expect(refused.status).toBe('destination_exists');
    expect(fs.readFileSync(otherFile, 'utf8')).toBe(anotherComputersFile);

    // The renderer has no way to ask for a replacement.
    const stillRefused = await laptop.invoke(
      'copy-profile-sync-file',
      syncFilePath(),
      otherFile,
      true
    );
    expect(stillRefused.status).toBe('destination_exists');
    expect(fs.readFileSync(otherFile, 'utf8')).toBe(anotherComputersFile);
  });

  test('copying into an empty folder creates the file', async () => {
    const { laptop, otherFile } = await laptopWithOtherFolder();

    const copied = await laptop.invoke('copy-profile-sync-file', syncFilePath(), otherFile);

    expect(copied.ok).toBe(true);
    expect(JSON.parse(fs.readFileSync(otherFile, 'utf8')).schemaVersion).toBe(3);
  });
});

describe('where the folder chooser opens', () => {
  const openedAt = (device) => device.dialogCalls.at(-1).defaultPath;

  test('offers the sync app’s usual folder when no folder was chosen yet', async () => {
    const desktop = createDevice('desktop', { syncing: false });
    // A device that never chose a folder holds the default file in its app data folder.
    desktop.config.profileSync.cloudFilePath = path.join(
      desktop.userData,
      'ha-widget-profile-sync.json'
    );

    await desktop.invoke('choose-profile-sync-folder', 'dropbox');

    expect(openedAt(desktop)).toBe(path.join(path.dirname(desktop.userData), 'Dropbox'));
  });

  test('starts in the folder in use, or in the one currently in the form', async () => {
    const { laptop } = await createSyncedPair();

    await laptop.invoke('choose-profile-sync-folder', 'dropbox');
    expect(openedAt(laptop)).toBe(path.dirname(syncFilePath()));

    const formFolder = path.join(os.tmpdir(), 'somewhere', 'else');
    await laptop.invoke('choose-profile-sync-folder', 'dropbox', formFolder);
    expect(openedAt(laptop)).toBe(formFolder);
  });

  test('ignores an unsaved form folder inside the app data folder', async () => {
    const desktop = createDevice('desktop', { syncing: false });

    await desktop.invoke('choose-profile-sync-folder', 'dropbox', path.join(desktop.userData, 'x'));

    expect(openedAt(desktop)).toBe(path.join(path.dirname(desktop.userData), 'Dropbox'));
  });
});

describe('what Settings is told about the sync folder', () => {
  test('no folder is chosen until one is, so a first enable is not a folder change', async () => {
    const desktop = createDevice('desktop', { syncing: false });
    desktop.config.profileSync.cloudFilePath = path.join(
      desktop.userData,
      'ha-widget-profile-sync.json'
    );

    expect(desktop.rendererConfig().profileSync.cloudFilePath).toBe('');
    expect(desktop.status().cloudFilePath).toBe('');

    // Saving without a folder keeps the private default and does not look like a move.
    const result = await desktop.saveSettings({ profileSync: { enabled: false } });
    expect(result.update.success).not.toBe(false);
    expect(desktop.config.profileSync.cloudFilePath).toBe(
      path.join(desktop.userData, 'ha-widget-profile-sync.json')
    );

    const chosen = await desktop.saveSettings({
      profileSync: { enabled: true, cloudFilePath: syncFilePath() },
    });
    expect(chosen.update.success).not.toBe(false);
    expect(desktop.rendererConfig().profileSync.cloudFilePath).toBe(syncFilePath());
    expect(readSyncFile().updatedByDeviceId).toBe(desktop.config.profileSync.deviceId);
  });

  test('enabling with an unchosen folder re-saves the same default without a resolution gate', async () => {
    const desktop = createDevice('desktop', { syncing: false });

    await desktop.saveSettings({ profileSync: { enabled: true, cloudFilePath: '' } });

    // Main keeps working against its private default; the renderer asks for a folder first.
    expect(desktop.config.profileSync.cloudFilePath).toBe(
      path.join(desktop.userData, 'ha-widget-profile-sync.json')
    );
  });
});

describe('conflict copies beside the sync file', () => {
  const base = 'ha-widget-profile-sync';

  async function copiesAmong(names) {
    const desktop = createDevice('desktop');
    await desktop.sync();
    names.forEach((name) => fs.writeFileSync(path.join(path.dirname(syncFilePath()), name), '{}'));
    return desktop.context.findProfileSyncConflictCopies();
  }

  test('recognizes what each sync app names a copy', async () => {
    const copies = [
      `${base}.sync-conflict-20261001-083300-ABCDEFG.json`,
      `${base} (Bob's conflicted copy 2026-10-01).json`,
      `${base}-DESKTOP-4F2K9.json`,
      `${base} 2.json`,
      `${base} (1).json`,
    ];

    expect((await copiesAmong(copies)).sort()).toEqual([...copies].sort());
  });

  test('leaves other files alone', async () => {
    const others = [
      'notes.json',
      `${base}.json.tmp-1700000000000`,
      `${base}-backup.txt`,
      `${base}x.json`,
      `other-${base}.json`,
      `${base} 2.txt`,
    ];

    expect(await copiesAmong(others)).toEqual([]);
  });
});

describe('a first-sync choice that is waiting', () => {
  test('is a status of its own, not a sync error', async () => {
    const desktop = createDevice('desktop');
    desktop.config.opacity = 0.6;
    await desktop.sync();
    const laptop = createDevice('laptop', { syncing: false });

    await laptop.saveSettings({ profileSync: { enabled: true } });

    const status = laptop.status();
    expect(status.needsResolution).toBe(true);
    expect(status.lastSyncStatus).toBe('needs_resolution');
    expect(status.lastSyncError).toBe('');
  });
});

/**
 * @jest-environment node
 *
 * Runs the real profile sync engine from main.js for several simulated devices
 * sharing one sync folder. See tests/helpers/profile-sync-devices.js.
 */

const fs = require('fs');
const { createProfileSyncHarness, profileSyncCore } = require('../helpers/profile-sync-devices.js');

const harness = createProfileSyncHarness();
const { syncFilePath, readSyncFile, baseContent, createDevice, createSyncedPair } = harness;

beforeEach(() => harness.setup());
afterEach(() => harness.teardown());

describe('profile sync engine', () => {
  test('keeps edits two devices made to different sections', async () => {
    const { desktop, laptop } = await createSyncedPair();

    laptop.edit((config) => {
      config.favoriteEntities = ['light.kitchen', 'light.porch'];
    });
    await laptop.sync();
    // The desktop changes its opacity before it has seen the laptop's favorite.
    desktop.edit((config) => {
      config.opacity = 0.7;
    });
    const result = await desktop.sync();

    expect(result.action).toBe('merge');
    expect(desktop.config.favoriteEntities).toEqual(['light.kitchen', 'light.porch']);
    expect(desktop.config.opacity).toBe(0.7);

    await laptop.sync();
    expect(laptop.config.opacity).toBe(0.7);
    expect(laptop.config.favoriteEntities).toEqual(['light.kitchen', 'light.porch']);
  });

  test('a device with a fast clock does not undo another device’s change', async () => {
    const { desktop, laptop } = await createSyncedPair({
      laptop: { clockOffsetMs: 6 * 60 * 60 * 1000 },
    });

    desktop.edit((config) => {
      config.ui = { ...config.ui, theme: 'light' };
    });
    await desktop.sync();

    const result = await laptop.sync();
    expect(result.action).toBe('pull');
    expect(laptop.config.ui.theme).toBe('light');
    expect(readSyncFile().updatedByDeviceId).toBe(desktop.config.profileSync.deviceId);
  });

  test('when both devices change the same section the newer edit wins and the other is backed up', async () => {
    const { desktop, laptop } = await createSyncedPair();

    desktop.edit((config) => {
      config.opacity = 0.6;
    });
    await desktop.sync();
    await new Promise((resolve) => setTimeout(resolve, 5));
    laptop.edit((config) => {
      config.opacity = 0.8;
    });
    const laptopResult = await laptop.sync();

    // The laptop's edit is newer, so it replaces the desktop's in the file, and the
    // desktop's version is kept in the laptop's backups.
    expect(laptopResult.action).toBe('push');
    expect(laptop.backups('remote-profile')).toHaveLength(1);
    expect(laptop.backups('remote-profile')[0].sections.visualPersonalization.data.opacity).toBe(
      0.6
    );

    await desktop.sync();
    expect(desktop.config.opacity).toBe(0.8);
    expect(desktop.backups('local-profile')[0].sections.visualPersonalization.opacity).toBe(0.6);
  });

  test('Sync Up stops rather than merging when the file changes while it runs', async () => {
    const { laptop } = await createSyncedPair();
    laptop.edit((config) => {
      config.opacity = 0.4;
    });
    const before = fs.readFileSync(syncFilePath(), 'utf8');
    const realCheck = laptop.context.hasRemoteSyncEnvelopeChanged;
    laptop.context.hasRemoteSyncEnvelopeChanged = async () => true;
    await expect(laptop.sync('push', 'manual')).rejects.toThrow(
      'Sync file kept changing on the other device; try again'
    );
    laptop.context.hasRemoteSyncEnvelopeChanged = realCheck;
    expect(fs.readFileSync(syncFilePath(), 'utf8')).toBe(before);
    expect(laptop.config.opacity).toBe(0.4);
  });

  test('Sync Up backs up the file’s version of every section it replaces', async () => {
    const { laptop } = await createSyncedPair();
    // Only this computer changed the section, so a merge would not count it as a conflict.
    laptop.edit((config) => {
      config.opacity = 0.4;
    });

    await laptop.sync('push', 'manual');

    const backups = laptop.backups('remote-profile');
    expect(backups).toHaveLength(1);
    expect(backups[0].sections.visualPersonalization.data.opacity).toBe(0.9);
  });

  test('restoring a backup applies it here and syncs it to the other devices', async () => {
    const { desktop, laptop } = await createSyncedPair();
    desktop.edit((config) => {
      config.opacity = 0.6;
    });
    await desktop.sync();
    await new Promise((resolve) => setTimeout(resolve, 5));
    laptop.edit((config) => {
      config.opacity = 0.8;
    });
    await laptop.sync();

    const backups = await laptop.context.listProfileSyncBackups();
    const replacedRemote = backups.find((backup) => backup.kind === 'remote');
    expect(replacedRemote.sections).toContain('visualPersonalization');

    await laptop.context.restoreProfileSyncBackup(replacedRemote.id);
    expect(laptop.config.opacity).toBe(0.6);
    expect(laptop.context.pushes).toContain('config_change');
    // The settings the restore replaced are backed up too, so it can be undone.
    expect(laptop.backups('local-profile').length).toBeGreaterThan(0);

    await laptop.sync();
    await desktop.sync();
    expect(desktop.config.opacity).toBe(0.6);

    await expect(laptop.context.restoreProfileSyncBackup('../config.json')).rejects.toThrow(
      'That backup is no longer available'
    );
  });

  test('restoring the backup a pull just made syncs it instead of reading as a stale echo', async () => {
    const { desktop, laptop } = await createSyncedPair();
    desktop.edit((config) => {
      config.opacity = 0.6;
    });
    await desktop.sync();
    await laptop.sync();
    expect(laptop.config.opacity).toBe(0.6);

    // Restoring what that pull replaced reproduces the pre-pull profile exactly.
    const [pullBackup] = await laptop.context.listProfileSyncBackups();
    expect(pullBackup.kind).toBe('local');
    await laptop.context.restoreProfileSyncBackup(pullBackup.id);
    expect(laptop.config.opacity).toBe(0.9);

    await laptop.sync();
    expect(laptop.config.opacity).toBe(0.9);
    await desktop.sync();
    expect(desktop.config.opacity).toBe(0.9);
  });

  test('scope belongs to each device and pushes keep sections other devices sync', async () => {
    const desktop = createDevice('desktop');
    await desktop.sync();
    const laptop = createDevice('laptop', {
      content: { ...baseContent(), favoriteEntities: [], opacity: 0.9 },
      profileSync: { syncScope: { preset: 'visual' } },
    });
    await laptop.sync();

    laptop.edit((config) => {
      config.opacity = 0.75;
    });
    await laptop.sync();

    expect(laptop.config.favoriteEntities).toEqual([]);
    expect(laptop.config.profileSync.syncScope.preset).toBe('visual');
    const file = readSyncFile();
    expect(file.syncScope).toBeUndefined();
    expect(file.payload.sections.quickAccessLayout.data.favoriteEntities).toEqual([
      'light.kitchen',
    ]);

    await desktop.sync();
    expect(desktop.config.opacity).toBe(0.75);
    expect(desktop.config.favoriteEntities).toEqual(['light.kitchen']);
    expect(desktop.config.profileSync.syncScope.preset).toBe('all');
  });

  test('never writes desktop pins, hotkeys, the open page or display-specific ui to the file', async () => {
    const desktop = createDevice('desktop', {
      content: {
        ...baseContent(),
        activeTabId: 'tab-2',
        desktopPins: { 'light.kitchen': { x: 1800, y: 40, width: 176, height: 176 } },
        globalHotkeys: { enabled: true, hotkeys: { 'light.kitchen': 'Command+K' } },
        popupHotkey: 'Command+Space',
        ui: { theme: 'dark', scale: 1.5, followOmarchy: true, enableInteractionDebugLogs: true },
      },
    });
    await desktop.sync();

    const text = fs.readFileSync(syncFilePath(), 'utf8');
    expect(text).not.toContain('desktopPins');
    expect(text).not.toContain('Command+');
    expect(text).not.toContain('tab-2');
    expect(text).not.toContain('scale');
    expect(text).not.toContain('followOmarchy');

    const laptop = createDevice('laptop', {
      content: { ...baseContent(), ui: { theme: 'light', scale: 1 } },
    });
    // Joining with different content, the user chose Use Remote.
    await laptop.sync('pull', 'first_enable_resolution');
    expect(laptop.config.ui).toEqual({ theme: 'dark', scale: 1 });
    expect(laptop.config.desktopPins).toEqual({});
  });

  test('a first sync against a different profile asks which side to keep', async () => {
    const desktop = createDevice('desktop');
    await desktop.sync();
    const laptop = createDevice('laptop', {
      content: { ...baseContent(), favoriteEntities: ['switch.fan'], opacity: 0.9 },
    });

    const resolution = await laptop.firstEnable();
    expect(resolution.needsResolution).toBe(true);
    expect(laptop.status().conflictSections).toEqual(['quickAccessLayout']);
  });

  test('choosing a side for a newly added section leaves other pending edits alone', async () => {
    const desktop = createDevice('desktop');
    await desktop.sync();
    const laptop = createDevice('laptop', {
      content: { ...baseContent(), favoriteEntities: ['switch.fan'] },
      profileSync: { syncScope: { preset: 'visual' } },
    });
    await laptop.sync();

    // The laptop changes its opacity offline, then starts syncing layout too.
    laptop.edit((config) => {
      config.opacity = 0.5;
    });
    laptop.config.profileSync.syncScope = profileSyncCore.normalizeSyncScope({ preset: 'all' });
    const resolution = await laptop.firstEnable();
    expect(resolution.needsResolution).toBe(true);
    expect(laptop.status().conflictSections).toEqual(['quickAccessLayout']);

    // Use Remote for the section the prompt named.
    await laptop.context.runProfileSyncInternal('pull', 'first_enable_resolution', {
      expectedRemoteIdentity: laptop.context.profileSyncRuntime.pendingRemoteIdentity,
      forceSections: [...laptop.context.profileSyncRuntime.conflictSections],
    });

    expect(laptop.config.favoriteEntities).toEqual(['light.kitchen']);
    expect(laptop.config.opacity).toBe(0.5);
    await desktop.sync();
    expect(desktop.config.opacity).toBe(0.5);
  });

  test('a choice made after the file stopped conflicting forces nothing', async () => {
    const desktop = createDevice('desktop');
    await desktop.sync();
    const laptop = createDevice('laptop', {
      content: { ...baseContent(), favoriteEntities: ['switch.fan'] },
      profileSync: { syncScope: { preset: 'visual' } },
    });
    await laptop.sync();
    laptop.edit((config) => {
      config.opacity = 0.5;
    });
    laptop.config.profileSync.syncScope = profileSyncCore.normalizeSyncScope({ preset: 'all' });
    await laptop.firstEnable();
    expect(laptop.status().conflictSections).toEqual(['quickAccessLayout']);

    // While the prompt is open, the desktop adopts the laptop's favorites.
    desktop.edit((config) => {
      config.favoriteEntities = ['switch.fan'];
    });
    await desktop.sync();
    await expect(laptop.context.verifyPendingRemoteEnvelopeUnchanged()).rejects.toThrow(
      'The remote profile changed while waiting for conflict resolution'
    );
    expect(laptop.context.profileSyncRuntime.conflictSections).toEqual([]);

    // Retrying Use Remote, as the resolve handler does, keeps the unrelated local edit.
    await laptop.context.runProfileSyncInternal('pull', 'first_enable_resolution', {
      expectedRemoteIdentity: laptop.context.profileSyncRuntime.pendingRemoteIdentity,
      forceSections: [...laptop.context.profileSyncRuntime.conflictSections],
    });
    expect(laptop.config.opacity).toBe(0.5);
  });

  test('keeps one profileSync object, so writes made across helper calls are saved', async () => {
    const { context } = createDevice('desktop');
    const held = context.getProfileSyncConfig();
    await context.readConfiguredSyncEnvelope();
    held.remoteRewritePending = true;
    expect(context.getProfileSyncConfig()).toBe(held);
    expect(context.config.profileSync.remoteRewritePending).toBe(true);
  });

  test('an edit made while an encryption change awaited recovery is not lost', async () => {
    const desktop = createDevice('desktop');
    await desktop.sync();
    const { context } = desktop;

    // Encryption is staged, but the rewrite does not run yet (crash, folder offline).
    await context.stageProfileSyncRewrite({
      oldPassphrase: '',
      newPassphrase: 'new passphrase',
      rememberNewPassphrase: false,
      targetEncryptionEnabled: true,
      changeCredential: true,
      baselineConfig: context.config,
      targetConfig: {
        ...context.config,
        profileSync: { ...context.config.profileSync, encryptionEnabled: true },
      },
      reason: 'encryption_transition',
    });
    desktop.edit((config) => {
      config.opacity = 0.42;
    });

    await context.executePendingProfileSyncRewrite();
    const result = await desktop.sync();

    expect(result.pushed).toEqual(['visualPersonalization']);
    expect(desktop.config.opacity).toBe(0.42);
    const decoded = await profileSyncCore.decodeEnvelopeSections(readSyncFile(), 'new passphrase');
    expect(decoded.sections.visualPersonalization.data.opacity).toBe(0.42);
  });

  test('clearing a setting to undefined does not make the next sync pull it back', async () => {
    const desktop = createDevice('desktop', {
      content: { ...baseContent(), selectedWeatherEntity: 'weather.home' },
    });
    await desktop.sync();
    // Clear Weather leaves the key in place with an undefined value.
    desktop.edit((config) => {
      config.selectedWeatherEntity = undefined;
    });
    expect((await desktop.sync()).pushed).toEqual(['connectionMediaPreferences']);

    const next = await desktop.sync();
    expect(next.action).toBe('none');
    expect(desktop.backups('local-profile')).toHaveLength(0);
  });

  test('clearing a setting on one computer clears it on the others', async () => {
    const { desktop, laptop } = await createSyncedPair({
      desktop: { content: { ...baseContent(), selectedWeatherEntity: 'weather.home' } },
      laptop: { content: { ...baseContent(), selectedWeatherEntity: 'weather.home' } },
    });
    desktop.edit((config) => {
      config.selectedWeatherEntity = undefined;
    });
    await desktop.sync();

    await laptop.sync();
    expect(laptop.config.selectedWeatherEntity).toBeUndefined();
    // Both sides now agree, so nothing flows back.
    expect((await laptop.sync()).action).toBe('none');
    expect((await desktop.sync()).action).toBe('none');
    expect(desktop.config.selectedWeatherEntity).toBeUndefined();
  });

  test('a damaged section stops sync until Sync Up replaces it, keeping a copy', async () => {
    const desktop = createDevice('desktop');
    await desktop.sync();
    const file = readSyncFile();
    file.payload.sections.visualPersonalization.data = 'garbage';
    fs.writeFileSync(syncFilePath(), JSON.stringify(file));
    const damaged = fs.readFileSync(syncFilePath(), 'utf8');

    desktop.edit((config) => {
      config.opacity = 0.3;
    });
    await expect(desktop.sync()).rejects.toThrow(
      "The sync file's Appearance settings are damaged. Use Sync Up"
    );
    expect(fs.readFileSync(syncFilePath(), 'utf8')).toBe(damaged);

    await desktop.sync('push', 'manual');
    expect(desktop.backups('remote-profile')[0].sections.visualPersonalization.data).toBe(
      'garbage'
    );
    const repaired = await profileSyncCore.decodeEnvelopeSections(readSyncFile());
    expect(repaired.malformed).toEqual({});
    expect(repaired.sections.visualPersonalization.data.opacity).toBe(0.3);
  });

  test('a partial or cleared alert section arrives with its full shape', async () => {
    const { desktop, laptop } = await createSyncedPair();
    laptop.edit((config) => {
      config.entityAlerts = { enabled: true };
    });
    await laptop.sync();
    await desktop.sync();
    expect(desktop.config.entityAlerts).toEqual({ enabled: true, alerts: {} });

    laptop.edit((config) => {
      delete config.entityAlerts;
    });
    await laptop.sync();
    await desktop.sync();
    expect(desktop.config.entityAlerts).toEqual({ enabled: false, alerts: {} });
  });

  test('an alert’s setting for unavailable and unknown reaches the other computer, and so does its absence', async () => {
    const { desktop, laptop } = await createSyncedPair();
    const alerts = {
      'binary_sensor.door': { onStateChange: true, notifyOnUnavailable: false },
      'light.desk': { onStateChange: true, notifyOnUnavailable: true },
      // Saved before the setting existed.
      'switch.fan': { onStateChange: true },
    };
    laptop.edit((config) => {
      config.entityAlerts = { enabled: true, alerts };
    });
    await laptop.sync();
    const pulled = await desktop.sync();
    expect(pulled.action).toBe('pull');
    expect(desktop.config.entityAlerts).toEqual({ enabled: true, alerts });
    expect(desktop.config.entityAlerts.alerts['switch.fan']).not.toHaveProperty(
      'notifyOnUnavailable'
    );
    expect((await profileSyncCore.decodeEnvelopeSections(readSyncFile())).malformed).toEqual({});

    // Turning it back on is a change like any other.
    laptop.edit((config) => {
      config.entityAlerts.alerts['binary_sensor.door'].notifyOnUnavailable = true;
    });
    await laptop.sync();
    await desktop.sync();
    expect(desktop.config.entityAlerts.alerts['binary_sensor.door'].notifyOnUnavailable).toBe(true);
  });

  test('a section with malformed pages is damage, not a layout to apply', async () => {
    const { desktop, laptop } = await createSyncedPair({
      desktop: {
        content: {
          ...baseContent(),
          customTabs: [{ id: 'home', name: 'Home', entityIds: ['light.kitchen'] }],
        },
      },
      laptop: {
        content: {
          ...baseContent(),
          customTabs: [{ id: 'home', name: 'Home', entityIds: ['light.kitchen'] }],
        },
      },
    });
    // A hand-edited or buggy file: pages whose names and entities are not text.
    const file = readSyncFile();
    file.payload.sections.quickAccessLayout.data.customTabs = [{ id: 1, name: {}, entityIds: 'x' }];
    file.payload.sections.quickAccessLayout.updatedAt = '2099-01-01T00:00:00.000Z';
    fs.writeFileSync(syncFilePath(), JSON.stringify(file));

    await expect(laptop.sync()).rejects.toThrow('settings are damaged');
    expect(laptop.config.customTabs).toEqual([
      { id: 'home', name: 'Home', entityIds: ['light.kitchen'] },
    ]);

    // Sync Up keeps the damaged copy and puts this computer's pages back.
    await laptop.sync('push', 'manual');
    expect(laptop.backups('remote-profile')).toHaveLength(1);
    await desktop.sync();
    expect(desktop.config.customTabs).toEqual([
      { id: 'home', name: 'Home', entityIds: ['light.kitchen'] },
    ]);
  });

  describe('ui settings that were reset', () => {
    const lookWith = (ui) => ({ ...baseContent(), ui: { theme: 'dark', scale: 1, ...ui } });

    test('an import that resets one reaches the other computer, which does not push it back', async () => {
      const { desktop, laptop } = await createSyncedPair({
        desktop: { content: lookWith({ accent: 'violet' }) },
        laptop: { content: lookWith({ accent: 'violet' }) },
      });

      // The Import button: the file's null means "back to the default".
      await desktop.context.applyLocalProfileSections(
        { visualPersonalization: { ui: { accent: null } } },
        { clearNullUiKeys: true }
      );
      await desktop.sync();
      await laptop.sync();
      await desktop.sync();
      await laptop.sync();

      expect(desktop.config.ui).not.toHaveProperty('accent');
      expect(laptop.config.ui).not.toHaveProperty('accent');
      const ui = readSyncFile().payload.sections.visualPersonalization.data.ui;
      expect(ui.accent).toBeNull();
      expect(ui.theme).toBe('dark');
    });

    test('restoring the backup of a pull removes the settings that pull added', async () => {
      const { desktop, laptop } = await createSyncedPair();
      laptop.edit((config) => {
        config.ui = { ...config.ui, highContrast: true };
      });
      await laptop.sync();
      await new Promise((resolve) => setTimeout(resolve, 20));
      await desktop.sync();
      expect(desktop.config.ui.highContrast).toBe(true);

      const [pullBackup] = await desktop.context.listProfileSyncBackups();
      await desktop.context.restoreProfileSyncBackup(pullBackup.id);

      expect(desktop.config.ui).not.toHaveProperty('highContrast');
      await desktop.sync();
      await laptop.sync();
      expect(laptop.config.ui).not.toHaveProperty('highContrast');
      await desktop.sync();
      expect(desktop.config.ui).not.toHaveProperty('highContrast');
    });

    test('a file from a version that writes no null keys is not a different section', async () => {
      const { desktop, laptop } = await createSyncedPair({
        desktop: { content: lookWith({ accent: 'violet' }) },
        laptop: { content: lookWith({ accent: 'violet' }) },
      });
      // Strip the null markers, as an older writer's file would not have them.
      const file = readSyncFile();
      const data = file.payload.sections.visualPersonalization.data;
      data.ui = Object.fromEntries(Object.entries(data.ui).filter(([, value]) => value !== null));
      fs.writeFileSync(syncFilePath(), JSON.stringify(file));

      expect((await desktop.sync()).action).toBe('none');
      expect((await laptop.sync()).action).toBe('none');
    });

    test('a setting a later version added is neither cleared nor written as null', async () => {
      const { desktop } = await createSyncedPair();
      const file = readSyncFile();
      file.payload.sections.visualPersonalization.data.ui.aKeyFromALaterVersion = 'kept';
      fs.writeFileSync(syncFilePath(), JSON.stringify(file));
      desktop.edit((config) => {
        config.opacity = 0.7;
      });

      await desktop.sync();

      expect(
        readSyncFile().payload.sections.visualPersonalization.data.ui.aKeyFromALaterVersion
      ).toBe('kept');
    });
  });

  test('a backup of a damaged section is kept but never offered for restore', async () => {
    const desktop = createDevice('desktop');
    await desktop.sync();
    const file = readSyncFile();
    file.payload.sections.quickAccessLayout.data.favoriteEntities = { 'light.kitchen': true };
    fs.writeFileSync(syncFilePath(), JSON.stringify(file));

    await desktop.sync('push', 'manual');
    const [backup] = desktop.backups('remote-profile');
    expect(backup.sections.quickAccessLayout.data.favoriteEntities).toEqual({
      'light.kitchen': true,
    });
    const listed = await desktop.context.listProfileSyncBackups();
    expect(listed.flatMap((entry) => entry.sections)).not.toContain('quickAccessLayout');
  });

  test('a damaged section on first enable is offered as a choice, and Keep Local repairs it', async () => {
    const desktop = createDevice('desktop');
    await desktop.sync();
    const file = readSyncFile();
    file.payload.sections.visualPersonalization.data = 'garbage';
    fs.writeFileSync(syncFilePath(), JSON.stringify(file));

    const laptop = createDevice('laptop');
    const resolution = await laptop.firstEnable();
    expect(resolution.needsResolution).toBe(true);
    expect(laptop.status().conflictSections).toEqual(['visualPersonalization']);
    expect(laptop.status().damagedConflictSections).toEqual(['visualPersonalization']);

    // Keep Local, as the resolve handler runs it.
    await laptop.context.runProfileSyncInternal('push', 'first_enable_resolution', {
      expectedRemoteIdentity: laptop.context.profileSyncRuntime.pendingRemoteIdentity,
      forceSections: [...laptop.context.profileSyncRuntime.conflictSections],
    });
    expect(laptop.backups('remote-profile')[0].sections.visualPersonalization.data).toBe('garbage');
    expect((await profileSyncCore.decodeEnvelopeSections(readSyncFile())).malformed).toEqual({});
  });

  test('a deliberate revert to the pre-pull value survives the stale-echo guard', async () => {
    const { desktop, laptop } = await createSyncedPair();
    laptop.edit((config) => {
      config.opacity = 0.65;
    });
    await laptop.sync();
    await desktop.sync();
    const { context } = desktop;

    // Settings saves opacity 0.9 again, and says the user set it.
    const pulled = context.config;
    context.config = { ...pulled, opacity: 0.9 };
    expect(context.restoreProfileFromStalePullEcho(pulled, ['opacity'])).toBe(true);
    expect(context.config.opacity).toBe(0.9);
    context.saveConfig();
    await desktop.sync();
    await laptop.sync();
    expect(laptop.config.opacity).toBe(0.9);

    // Without that, the same payload is a stale snapshot and the pull is kept.
    laptop.edit((config) => {
      config.opacity = 0.5;
    });
    await laptop.sync();
    await desktop.sync();
    const again = context.config;
    context.config = { ...again, opacity: 0.9 };
    context.restoreProfileFromStalePullEcho(again);
    expect(context.config.opacity).toBe(0.5);
  });

  test('repairing a damaged section leaves a valid conflict for its own choice', async () => {
    const desktop = createDevice('desktop');
    await desktop.sync();
    const file = readSyncFile();
    file.payload.sections.visualPersonalization.data = 'garbage';
    fs.writeFileSync(syncFilePath(), JSON.stringify(file));

    const laptop = createDevice('laptop', {
      content: { ...baseContent(), favoriteEntities: ['switch.fan'] },
    });
    await laptop.firstEnable();
    expect(laptop.status().conflictSections).toEqual([
      'quickAccessLayout',
      'visualPersonalization',
    ]);
    expect(laptop.status().damagedConflictSections).toEqual(['visualPersonalization']);

    // Keep Local repairs only the damaged section, as the resolve handler runs it.
    const damaged = [...laptop.context.profileSyncRuntime.damagedConflictSections];
    await laptop.context.runProfileSyncInternal('push', 'first_enable_resolution', {
      expectedRemoteIdentity: laptop.context.profileSyncRuntime.pendingRemoteIdentity,
      forceSections: damaged,
      onlySections: damaged,
    });
    const written = await profileSyncCore.decodeEnvelopeSections(readSyncFile());
    expect(written.malformed).toEqual({});
    expect(written.sections.quickAccessLayout.data.favoriteEntities).toEqual(['light.kitchen']);

    // The valid conflict comes back as its own choice.
    expect((await laptop.firstEnable()).needsResolution).toBe(true);
    expect(laptop.status().conflictSections).toEqual(['quickAccessLayout']);
    expect(laptop.status().damagedConflictSections).toEqual([]);
  });

  test('damage in a section this device does not sync is left alone', async () => {
    const desktop = createDevice('desktop');
    await desktop.sync();
    const file = readSyncFile();
    file.payload.sections.quickAccessLayout.data = 'garbage';
    fs.writeFileSync(syncFilePath(), JSON.stringify(file));

    const laptop = createDevice('laptop', { profileSync: { syncScope: { preset: 'visual' } } });
    // Not a first-sync conflict for this device...
    expect((await laptop.context.findProfileSyncConflictSections(readSyncFile())).sections).toEqual(
      []
    );
    // ...and not a reason to stop syncing.
    laptop.edit((config) => {
      config.opacity = 0.4;
    });
    expect((await laptop.sync()).pushed).toEqual(['visualPersonalization']);

    const written = readSyncFile();
    expect(written.payload.sections.quickAccessLayout.data).toBe('garbage');
    expect(written.payload.sections.visualPersonalization.data.opacity).toBe(0.4);
  });

  test('a stale Settings save that also carries a deliberate edit keeps both the pull and the edit', async () => {
    const { desktop, laptop } = await createSyncedPair();
    laptop.edit((config) => {
      config.ui = { ...config.ui, accent: 'teal' };
    });
    await laptop.sync();
    await desktop.sync();
    const { context } = desktop;
    expect(context.config.ui.accent).toBe('teal');

    const pulled = context.config;
    // A save made after the pull (accent already teal), changing only opacity, is not stale.
    context.config = { ...pulled, opacity: 0.6 };
    expect(context.restoreProfileFromStalePullEcho(pulled, ['opacity'])).toBe(false);

    // A Settings save built before the pull arrived: old accent, new opacity.
    context.config = { ...pulled, opacity: 0.5, ui: { ...pulled.ui, accent: 'original' } };
    expect(context.restoreProfileFromStalePullEcho(pulled, ['opacity'])).toBe(true);
    expect(context.config.ui.accent).toBe('teal');
    expect(context.config.opacity).toBe(0.5);
  });

  test('any update built before a pull keeps only what it changed', async () => {
    const { desktop, laptop } = await createSyncedPair();
    const { context } = desktop;
    const beforePull = context.configSnapshotVersion;
    laptop.edit((config) => {
      config.ui = { ...config.ui, accent: 'teal' };
    });
    await laptop.sync();
    await desktop.sync();
    const pulled = context.config;

    // An alert save built from the pre-pull snapshot: old accent, new alert, and
    // favorites set back to what they were, which is no change at all for it.
    context.config = {
      ...pulled,
      ui: { ...pulled.ui, accent: 'original' },
      entityAlerts: { enabled: true, alerts: { 'light.kitchen': { onStateChange: true } } },
    };
    expect(context.restoreProfileFromStalePullEcho(pulled, [], beforePull)).toBe(true);
    expect(context.config.ui.accent).toBe('teal');
    expect(context.config.entityAlerts.enabled).toBe(true);
  });

  test('a setting cleared by a pull stays cleared when an older update arrives', async () => {
    const { desktop, laptop } = await createSyncedPair({
      desktop: { content: { ...baseContent(), selectedWeatherEntity: 'weather.home' } },
      laptop: { content: { ...baseContent(), selectedWeatherEntity: 'weather.home' } },
    });
    const { context } = desktop;
    const beforePull = context.configSnapshotVersion;
    laptop.edit((config) => {
      delete config.selectedWeatherEntity;
    });
    await laptop.sync();
    await desktop.sync();
    const pulled = context.config;
    expect(pulled.selectedWeatherEntity).toBeUndefined();

    context.config = { ...pulled, selectedWeatherEntity: 'weather.home', alwaysOnTop: false };
    expect(context.restoreProfileFromStalePullEcho(pulled, [], beforePull)).toBe(true);
    expect(context.config).not.toHaveProperty('selectedWeatherEntity');
    expect(context.config.alwaysOnTop).toBe(false);
  });

  test('an update that predates two pulls keeps both of them', async () => {
    const { desktop, laptop } = await createSyncedPair();
    const { context } = desktop;
    const beforePulls = context.configSnapshotVersion;
    laptop.edit((config) => {
      config.ui = { ...config.ui, accent: 'teal' };
    });
    await laptop.sync();
    await desktop.sync();
    laptop.edit((config) => {
      config.opacity = 0.7;
    });
    await laptop.sync();
    await desktop.sync();
    const pulled = context.config;
    expect(pulled.ui.accent).toBe('teal');
    expect(pulled.opacity).toBe(0.7);

    // An alert save built before either pull.
    context.config = {
      ...pulled,
      opacity: 0.9,
      ui: { ...pulled.ui, accent: 'original' },
      entityAlerts: { enabled: true, alerts: {} },
    };
    expect(context.restoreProfileFromStalePullEcho(pulled, [], beforePulls)).toBe(true);
    expect(context.config.ui.accent).toBe('teal');
    expect(context.config.opacity).toBe(0.7);
    expect(context.config.entityAlerts.enabled).toBe(true);
  });

  test('every queued update built before a pull is repaired, not just the first', async () => {
    const { desktop, laptop } = await createSyncedPair();
    const { context } = desktop;
    const beforePull = context.configSnapshotVersion;
    laptop.edit((config) => {
      config.ui = { ...config.ui, accent: 'teal' };
    });
    await laptop.sync();
    await desktop.sync();
    const pulled = context.config;

    context.config = { ...pulled, ui: { ...pulled.ui, accent: 'original' }, opacity: 0.8 };
    expect(context.restoreProfileFromStalePullEcho(pulled, [], beforePull)).toBe(true);
    context.saveConfig();
    const afterFirst = context.config;
    expect(afterFirst.ui.accent).toBe('teal');

    // An update made after the pull does not end it for older ones still to come,
    // such as a rollback snapshot.
    context.config = { ...afterFirst, alwaysOnTop: false };
    expect(
      context.restoreProfileFromStalePullEcho(afterFirst, [], context.configSnapshotVersion)
    ).toBe(false);
    context.saveConfig();
    const afterSecond = context.config;

    context.config = {
      ...afterSecond,
      ui: { ...afterSecond.ui, accent: 'original' },
      entityAlerts: { enabled: true, alerts: {} },
    };
    expect(context.restoreProfileFromStalePullEcho(afterSecond, [], beforePull)).toBe(true);
    expect(context.config.ui.accent).toBe('teal');
    expect(context.config.opacity).toBe(0.8);
    expect(context.config.alwaysOnTop).toBe(false);
    expect(context.config.entityAlerts.enabled).toBe(true);
  });

  test('remembers a bounded number of pulls', () => {
    const desktop = createDevice('desktop');
    const { context } = desktop;
    let pulls = [];
    for (let revision = 1; revision <= 20; revision += 1) {
      pulls = context.appendPendingPull(pulls, { profile: { opacity: revision / 100 }, revision });
    }
    expect(pulls).toHaveLength(16);
    // The oldest state survives; merged entries answer to the later revision and
    // remember where their range began.
    expect(pulls[0]).toEqual({ profile: { opacity: 0.01 }, revision: 5, compactedFrom: 1 });
    expect(pulls[pulls.length - 1].revision).toBe(20);
  });

  test('an update built inside a compacted stretch of pulls keeps only what was touched', async () => {
    const { desktop, laptop } = await createSyncedPair();
    const { context } = desktop;
    const beforePulls = context.configSnapshotVersion;
    laptop.edit((config) => {
      config.opacity = 0.8;
    });
    await laptop.sync();
    await desktop.sync();
    const afterFirstPull = context.configSnapshotVersion;
    laptop.edit((config) => {
      config.opacity = 0.7;
    });
    await laptop.sync();
    await desktop.sync();
    const pulled = context.config;
    // Squeeze the history so both pulls share one entry, as a full history would.
    const [first, second] = context.profileSyncRuntime.pendingPulls;
    context.profileSyncRuntime.pendingPulls = [
      { profile: first.profile, revision: second.revision, compactedFrom: first.revision },
    ];

    // Built after the first pull, it carries that pull's opacity. The state it
    // started from is gone, so only the setting the user touched is kept.
    context.config = { ...pulled, opacity: 0.8, alwaysOnTop: false };
    expect(context.restoreProfileFromStalePullEcho(pulled, ['alwaysOnTop'], afterFirstPull)).toBe(
      true
    );
    expect(context.config.opacity).toBe(0.7);
    expect(context.config.alwaysOnTop).toBe(false);

    // One built before the whole stretch is still compared exactly.
    context.config = { ...pulled, opacity: 0.9, entityAlerts: { enabled: true, alerts: {} } };
    expect(context.restoreProfileFromStalePullEcho(pulled, [], beforePulls)).toBe(true);
    expect(context.config.entityAlerts.enabled).toBe(true);
    expect(context.config.opacity).toBe(0.7);
  });

  test('an update built between two pulls is compared with the state it saw', async () => {
    const { desktop, laptop } = await createSyncedPair();
    const { context } = desktop;
    laptop.edit((config) => {
      config.ui = { ...config.ui, accent: 'teal' };
    });
    await laptop.sync();
    await desktop.sync();
    const betweenPulls = context.configSnapshotVersion;
    laptop.edit((config) => {
      config.opacity = 0.7;
    });
    await laptop.sync();
    await desktop.sync();
    const pulled = context.config;

    // Built after the first pull: setting the accent back is deliberate, the
    // opacity is simply stale.
    context.config = { ...pulled, opacity: 0.9, ui: { ...pulled.ui, accent: 'original' } };
    expect(context.restoreProfileFromStalePullEcho(pulled, [], betweenPulls)).toBe(true);
    expect(context.config.ui.accent).toBe('original');
    expect(context.config.opacity).toBe(0.7);
  });

  test('an update built after the pull is taken as it is, even a revert to the old value', async () => {
    const { desktop, laptop } = await createSyncedPair();
    const { context } = desktop;
    laptop.edit((config) => {
      config.favoriteEntities = ['light.kitchen', 'light.porch'];
    });
    await laptop.sync();
    await desktop.sync();
    const pulled = context.config;

    // The user removes the favorite that just arrived.
    context.config = { ...pulled, favoriteEntities: ['light.kitchen'] };
    expect(context.restoreProfileFromStalePullEcho(pulled, [], context.configSnapshotVersion)).toBe(
      false
    );
    expect(context.config.favoriteEntities).toEqual(['light.kitchen']);
    context.saveConfig();
    expect((await desktop.sync()).pushed).toEqual(['quickAccessLayout']);
  });

  test('refuses to push plaintext over an encrypted file', async () => {
    const desktop = createDevice('desktop', {
      profileSync: { encryptionEnabled: true, __passphrase: 'correct horse' },
    });
    await desktop.sync();
    const before = fs.readFileSync(syncFilePath(), 'utf8');

    const laptop = createDevice('laptop');
    await expect(laptop.sync()).rejects.toThrow('The sync file is encrypted.');
    expect(fs.readFileSync(syncFilePath(), 'utf8')).toBe(before);
  });

  test('refuses to re-encrypt with a passphrase the file no longer uses', async () => {
    const desktop = createDevice('desktop', {
      profileSync: { encryptionEnabled: true, __passphrase: 'new passphrase' },
    });
    await desktop.sync();
    const laptop = createDevice('laptop', {
      profileSync: { encryptionEnabled: true, __passphrase: 'old passphrase' },
    });
    laptop.edit((config) => {
      config.opacity = 0.5;
    });

    await expect(laptop.sync()).rejects.toThrow('The sync passphrase does not match');
    const decoded = await profileSyncCore.decodeEnvelopeSections(readSyncFile(), 'new passphrase');
    expect(decoded.sections.visualPersonalization.data.opacity).toBe(0.9);
  });

  test('upgrades a version 2 file, taking the newer remote content once', async () => {
    fs.writeFileSync(
      syncFilePath(),
      JSON.stringify({
        schemaVersion: 2,
        updatedAt: new Date(Date.now() + 60_000).toISOString(),
        updatedByDeviceId: 'old-device',
        syncScope: { preset: 'all' },
        payload: {
          ...baseContent(),
          favoriteEntities: ['light.from_v2'],
          desktopPins: { 'light.from_v2': { x: 5, y: 5 } },
        },
      })
    );
    const desktop = createDevice('desktop', {
      profileSync: { profileUpdatedAt: new Date(Date.now() - 60_000).toISOString() },
    });

    const result = await desktop.sync();
    expect(result.pulled).toEqual(['quickAccessLayout']);
    expect(desktop.config.favoriteEntities).toEqual(['light.from_v2']);
    expect(desktop.config.desktopPins).toEqual({});

    desktop.edit((config) => {
      config.opacity = 0.5;
    });
    await desktop.sync();
    const file = readSyncFile();
    expect(file.schemaVersion).toBe(3);
    expect(file.payload.sections.quickAccessLayout.data.favoriteEntities).toEqual([
      'light.from_v2',
    ]);
  });

  test('keeps sections and fields written by a newer version', async () => {
    const desktop = createDevice('desktop');
    await desktop.sync();
    const file = readSyncFile();
    file.schemaVersion = 4;
    file.minReaderVersion = 3;
    file.futureEnvelopeField = { mode: 'x' };
    file.payload.futurePayloadField = [1, 2];
    file.payload.sections.futureSection = {
      updatedAt: file.updatedAt,
      updatedByDeviceId: 'future-device',
      data: { novel: true },
    };
    file.payload.sections.visualPersonalization.data.futureField = 'kept';
    fs.writeFileSync(syncFilePath(), JSON.stringify(file));

    desktop.edit((config) => {
      config.opacity = 0.55;
    });
    await desktop.sync();

    const written = readSyncFile();
    // Still labelled as the newer version, with everything that version added.
    expect(written.schemaVersion).toBe(4);
    expect(written.minReaderVersion).toBe(3);
    expect(written.futureEnvelopeField).toEqual({ mode: 'x' });
    expect(written.payload.futurePayloadField).toEqual([1, 2]);
    expect(written.payload.sections.futureSection.data).toEqual({ novel: true });
    expect(written.payload.sections.visualPersonalization.data).toMatchObject({
      opacity: 0.55,
      futureField: 'kept',
    });
  });

  test('a stale renderer echo after a pull is not pushed back out', async () => {
    const { desktop, laptop } = await createSyncedPair();
    laptop.edit((config) => {
      config.opacity = 0.65;
    });
    await laptop.sync();
    await desktop.sync();
    expect(desktop.config.opacity).toBe(0.65);

    // A config snapshot from before the pull arrives afterwards.
    desktop.edit((config) => {
      config.opacity = 0.9;
    });
    await desktop.sync();

    expect(desktop.config.opacity).toBe(0.65);
    const decoded = await profileSyncCore.decodeEnvelopeSections(readSyncFile());
    expect(decoded.sections.visualPersonalization.data.opacity).toBe(0.65);
  });

  test('refuses to write a file other devices would reject as too large', async () => {
    const desktop = createDevice('desktop', {
      content: { ...baseContent(), customEntityNames: { big: 'x'.repeat(600 * 1024) } },
    });
    await expect(desktop.sync()).rejects.toThrow('Sync file exceeds size limit (512 KB)');
    expect(fs.existsSync(syncFilePath())).toBe(false);
  });

  test('a settings snapshot from before a sync cannot roll back its result', async () => {
    const { desktop, laptop } = await createSyncedPair();
    const staleSnapshot = JSON.parse(JSON.stringify(desktop.config.profileSync));
    staleSnapshot.lastSyncStatus = 'error';
    staleSnapshot.lastSyncError = 'Old failure';
    staleSnapshot.lastSuccessfulSyncAt = null;
    laptop.edit((config) => {
      config.opacity = 0.7;
    });
    await laptop.sync();
    await desktop.sync();
    const current = desktop.config.profileSync;

    const next = desktop.context.keepMainOwnedProfileSyncResults(
      { ...current, ...staleSnapshot },
      current
    );
    expect(next.lastSyncStatus).toBe('success');
    expect(next.lastSyncError).toBe('');
    expect(next.lastSuccessfulSyncAt).toBe(current.lastSuccessfulSyncAt);
    expect(next.lastSuccessfulSyncAt).toEqual(expect.any(String));
    expect(next.deviceId).toBe(current.deviceId);
  });

  test('a finished run reports itself as finished, whatever way it ended', async () => {
    const { desktop, laptop } = await createSyncedPair();

    // Settings disables its sync buttons while a run is in flight, so a status sent
    // out before the run is cleared would leave them disabled until it was reopened.
    desktop.edit((config) => {
      config.opacity = 0.7;
    });
    const pushed = await desktop.sync('auto', 'manual');
    expect(pushed.status.inFlight).toBe(false);
    expect(desktop.emittedStatuses.at(-1).inFlight).toBe(false);

    const unchanged = await desktop.sync('auto', 'manual');
    expect(unchanged.action).toBe('none');
    expect(unchanged.status.inFlight).toBe(false);

    laptop.edit((config) => {
      config.opacity = 0.4;
    });
    const realCheck = laptop.context.hasRemoteSyncEnvelopeChanged;
    laptop.context.hasRemoteSyncEnvelopeChanged = async () => true;
    const recheck = await laptop.sync('auto', 'manual');
    laptop.context.hasRemoteSyncEnvelopeChanged = realCheck;
    expect(recheck.reason).toBe('remote_changed');
    expect(recheck.status.inFlight).toBe(false);
    expect(laptop.emittedStatuses.at(-1).inFlight).toBe(false);

    fs.writeFileSync(syncFilePath(), '');
    await desktop.sync('auto', 'manual').catch(() => {});
    expect(desktop.emittedStatuses.at(-1)).toMatchObject({
      inFlight: false,
      lastSyncStatus: 'error',
    });
  });

  test('reports when the file was last written and by whom', async () => {
    const { desktop, laptop } = await createSyncedPair();
    laptop.edit((config) => {
      config.opacity = 0.7;
    });
    await laptop.sync();
    await desktop.sync();

    const status = desktop.status();
    expect(status.lastRemoteUpdatedByThisDevice).toBe(false);
    expect(status.lastSuccessfulSyncAt).toEqual(expect.any(String));
    expect(status.lastRunSummary.pulled).toEqual(['visualPersonalization']);
  });
});

/** @jest-environment node */
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { createMainConfigStore } = require('../helpers/main-config-store.js');
const { createProfileSyncHarness } = require('../helpers/profile-sync-devices.js');
const source = fs.readFileSync(path.resolve(__dirname, '../../main.js'), 'utf8');
const copy = (value) => JSON.parse(JSON.stringify(value));
const slice = (start, end) =>
  source.slice(source.indexOf(start), source.indexOf(end, source.indexOf(start)));

describe('settings file main-process application', () => {
  const harness = createProfileSyncHarness();
  beforeEach(() => harness.setup());
  afterEach(() => harness.teardown());

  const localSetup = {
    homeAssistant: { token: 'secret' },
    desktopPins: { 'light.desk': {} },
    globalHotkeys: { enabled: true },
    activeTabId: 'home',
    entityAlerts: { enabled: false, alerts: {} },
    ui: { theme: 'dark', scale: 1.3, followOmarchy: true },
  };
  const importBackups = (device) => {
    const dir = path.join(device.userData, 'profile-sync-backups');
    return fs.existsSync(dir) ? fs.readdirSync(dir) : [];
  };
  const visualTheme = { visualPersonalization: { ui: { theme: 'light' } } };

  test('backs up before writing and preserves local setup', async () => {
    const device = harness.createDevice('desktop', { syncing: false, content: localSetup });
    let backedUpFirst = null;
    device.interceptNextConfigWrite(async () => {
      backedUpFirst = importBackups(device).length === 1;
    });

    await device.engine.importSections(visualTheme);

    expect(backedUpFirst).toBe(true);
    // The incoming sections let the backup record ui keys the apply adds, so restore undoes them.
    const [backup] = (await device.invoke('list-profile-sync-backups')).backups;
    expect(backup).toMatchObject({ reason: 'import', sections: ['visualPersonalization'] });
    // Only the sync bookkeeping (when each section last changed) moves besides the section.
    const { profileSync, ...settings } = device.config;
    expect(settings).toEqual({ ...localSetup, ui: { ...localSetup.ui, theme: 'light' } });
    expect(profileSync.sectionUpdatedAt).toHaveProperty('visualPersonalization');
    expect(device.writtenConfig()).toEqual(device.config);
    expect(device.main.pushConfigToRenderer).toHaveBeenCalledTimes(1);
  });

  test('clears the shared ui keys a section sets to null, and keys a later version added', async () => {
    const device = harness.createDevice('desktop', {
      syncing: false,
      content: {
        ...localSetup,
        ui: { ...localSetup.ui, accent: 'violet', aKeyFromALaterVersion: 1 },
      },
    });
    await device.engine.importSections({
      visualPersonalization: { ui: { theme: 'light', accent: null, aKeyFromALaterVersion: null } },
    });
    // A file says "back to the default" with null; a pull keeps a later version's null as sent.
    expect(device.config.ui).not.toHaveProperty('accent');
    expect(device.config.ui).not.toHaveProperty('aKeyFromALaterVersion');
  });

  test('a failed backup never writes or changes config', async () => {
    const device = harness.createDevice('desktop', { syncing: false, content: localSetup });
    const before = copy(device.config);
    const writtenBefore = device.writtenConfig();
    device.fs = {
      ...fs,
      promises: {
        ...fs.promises,
        writeFile: async () => {
          throw new Error('Disk full');
        },
      },
    };
    await expect(device.engine.importSections(visualTheme)).rejects.toThrow('Disk full');
    expect(device.config).toEqual(before);
    expect(device.writtenConfig()).toEqual(writtenBefore);
  });

  test('a failed durable save restores config and sync tracking', async () => {
    const { desktop, laptop } = await harness.createSyncedPair();
    // A pull, after which a stale echo of the pre-pull settings is recognised.
    const prePull = desktop.rendererConfig();
    laptop.edit((config) => {
      config.opacity = 0.7;
    });
    await laptop.sync();
    await desktop.sync();
    const before = copy(desktop.config);
    desktop.main.pushConfigToRenderer.mockClear();

    desktop.interceptNextConfigWrite(async () => {
      throw new Error('Disk full');
    });
    await expect(desktop.engine.importSections(visualTheme)).rejects.toThrow('Disk full');
    expect(desktop.config).toEqual(before);
    expect(desktop.main.pushConfigToRenderer).not.toHaveBeenCalled();

    // The import gave up on recognising that echo only for the change it did not make.
    await desktop.updateFromRenderer({ ...prePull, configRevision: undefined });
    expect(desktop.config.opacity).toBe(0.7);
  });
});

describe('config changes that arrive outside the settings form', () => {
  let store;
  const changeLanguage = (language, origin = 'profile-sync-pull') =>
    store.configStore.apply(
      (current) => {
        current.ui.language = language;
      },
      { origin }
    );
  beforeEach(() => {
    store = createMainConfigStore(
      { ui: { language: 'de' } },
      { tray: {}, omarchyBarPublisher: { update: jest.fn() } }
    );
  });
  test.each(['profile-sync-pull', 'profile-restore', 'settings'])(
    'rebuilds the tray when a change from %s switches the language',
    async (origin) => {
      await changeLanguage('auto', origin);
      expect(store.context.createTray).toHaveBeenCalledTimes(1);
    }
  );
  test('has the Omarchy bar say its words in the new language too', async () => {
    await changeLanguage('auto');
    expect(store.context.omarchyBarPublisher.update).toHaveBeenCalledTimes(1);
    await changeLanguage('auto');
    expect(store.context.omarchyBarPublisher.update).toHaveBeenCalledTimes(1);
    // No bar installed: nothing to tell.
    store.context.omarchyBarPublisher = null;
    await expect(changeLanguage('de')).resolves.toMatchObject({
      success: true,
      runtimeWarnings: [],
    });
  });
  test('leaves the tray alone when the language is unchanged or there is no tray', async () => {
    await changeLanguage('de');
    store.context.tray = null;
    await changeLanguage('auto');
    expect(store.context.createTray).not.toHaveBeenCalled();
  });
});

describe('settings file IPC authorization', () => {
  test.each(['export-settings-file', 'preview-settings-import', 'apply-settings-import'])(
    'rejects unauthorized %s calls',
    async (channel) => {
      const handlers = {};
      const controller = {
        exportSettings: jest.fn(),
        previewImport: jest.fn(),
        applyImport: jest.fn(),
      };
      vm.runInNewContext(
        slice('const settingsFileController =', "ipcMain.handle('get-profile-sync-status'"),
        {
          createSettingsFileController: () => controller,
          fs,
          dialog: {},
          ipcMain: {
            handle: (key, handler) => {
              handlers[key] = handler;
            },
          },
          authorizeIpcSender: () => null,
          rejectUnauthorizedIpc: () => ({ success: false, error: 'Unauthorized' }),
          serializeConfigMutationHandler: (handler) => handler,
        }
      );
      await expect(handlers[channel]({}, '/arbitrary/file')).resolves.toEqual({
        success: false,
        error: 'Unauthorized',
      });
      Object.values(controller).forEach((method) => expect(method).not.toHaveBeenCalled());
    }
  );
});

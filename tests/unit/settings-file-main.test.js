/** @jest-environment node */
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const profileSyncCore = require('../../profile-sync-core.js');
const { createMainConfigStore } = require('../helpers/main-config-store.js');
const source = fs.readFileSync(path.resolve(__dirname, '../../main.js'), 'utf8');
const slice = (start, end) =>
  source.slice(source.indexOf(start), source.indexOf(end, source.indexOf(start)));

describe('settings file main-process application', () => {
  let context, original, store;
  const copy = (value) => JSON.parse(JSON.stringify(value));
  beforeEach(() => {
    original = {
      homeAssistant: { token: 'secret' },
      profileSync: { enabled: false },
      desktopPins: { 'light.desk': {} },
      globalHotkeys: { enabled: true },
      activeTabId: 'home',
      ui: { theme: 'dark', scale: 1.3, followOmarchy: true },
    };
    context = {
      config: original,
      profileSyncCore,
      profileSyncRuntime: { pendingPullEchoHash: 'old', pendingPullEchoProfile: {} },
      backupLocalProfileBeforePullApply: jest.fn().mockResolvedValue(),
      mainT: (key, data) => key.replace('{{error}}', data?.error || ''),
    };
    store = createMainConfigStore(original, {
      profileSyncRuntime: context.profileSyncRuntime,
    });
    context.configStore = store.configStore;
    context.replaceConfigContents = store.replaceConfigContents;
    for (const name of [
      'pruneConfig',
      'ensureDateTimeFormatConfigDefaults',
      'ensureProfileSyncConfigDefaults',
      'ensureEntityAlertsConfigDefaults',
      'normalizeDesktopPinsConfig',
      'normalizeTrayEntitiesConfigInPlace',
    ])
      context[name] = jest.fn();
    vm.createContext(context);
    vm.runInContext(
      slice('async function applyLocalProfileSections(', 'function clearProfileSyncTimers('),
      context
    );
  });
  test('backs up before writing and preserves local setup', async () => {
    const before = copy(original);
    const written = jest.fn();
    store.interceptNextWrite(written);
    await context.applyLocalProfileSections({ visualPersonalization: { ui: { theme: 'light' } } });
    // The incoming sections let the backup record ui keys the apply adds, so restore undoes them.
    expect(context.backupLocalProfileBeforePullApply).toHaveBeenCalledWith(
      ['visualPersonalization'],
      { visualPersonalization: { ui: { theme: 'light' } } },
      'import'
    );
    expect(context.backupLocalProfileBeforePullApply.mock.invocationCallOrder[0]).toBeLessThan(
      written.mock.invocationCallOrder[0]
    );
    expect(context.config).toEqual({ ...before, ui: { ...before.ui, theme: 'light' } });
    expect(store.written()).toEqual(context.config);
    expect(store.context.pushConfigToRenderer).toHaveBeenCalledTimes(1);
  });
  test('clears the shared ui keys a section sets to null, and other nulls only when asked to', async () => {
    const sections = {
      visualPersonalization: { ui: { theme: 'light', accent: null, aKeyFromALaterVersion: null } },
    };
    await context.applyLocalProfileSections(sections);
    // A shared key reset on the other side is reset here too; a later version's key stays as sent.
    expect(context.config.ui).not.toHaveProperty('accent');
    expect(context.config.ui.aKeyFromALaterVersion).toBeNull();
    await context.applyLocalProfileSections(sections, { clearNullUiKeys: true });
    expect(context.config.ui).not.toHaveProperty('aKeyFromALaterVersion');
  });
  test('a failed backup never writes or changes config', async () => {
    const before = copy(original);
    context.backupLocalProfileBeforePullApply.mockRejectedValue(new Error('Disk full'));
    await expect(
      context.applyLocalProfileSections({ visualPersonalization: { ui: { theme: 'light' } } })
    ).rejects.toThrow('Disk full');
    expect(context.config).toEqual(before);
    expect(store.writeCount()).toBe(0);
  });
  test('a failed durable save restores config and sync tracking', async () => {
    const before = copy(original);
    store.failNextWrite('Disk full');
    await expect(
      context.applyLocalProfileSections({ visualPersonalization: { ui: { theme: 'light' } } })
    ).rejects.toThrow('Disk full');
    expect(context.config).toEqual(before);
    expect(context.profileSyncRuntime.pendingPullEchoHash).toBe('old');
    expect(store.context.pushConfigToRenderer).not.toHaveBeenCalled();
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

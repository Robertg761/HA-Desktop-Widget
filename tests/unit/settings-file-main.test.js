/** @jest-environment node */
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const profileSyncCore = require('../../profile-sync-core.js');
const source = fs.readFileSync(path.resolve(__dirname, '../../main.js'), 'utf8');
const slice = (start, end) =>
  source.slice(source.indexOf(start), source.indexOf(end, source.indexOf(start)));

describe('settings file main-process application', () => {
  let context, original;
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
      saveConfigDurably: jest.fn().mockResolvedValue({ success: true }),
      applySyncedConfigSideEffects: jest.fn().mockResolvedValue(),
      mainT: (key, data) => key.replace('{{error}}', data?.error || ''),
    };
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
    await context.applyLocalProfileSections({ visualPersonalization: { ui: { theme: 'light' } } });
    expect(context.backupLocalProfileBeforePullApply).toHaveBeenCalledWith([
      'visualPersonalization',
    ]);
    expect(context.backupLocalProfileBeforePullApply.mock.invocationCallOrder[0]).toBeLessThan(
      context.saveConfigDurably.mock.invocationCallOrder[0]
    );
    expect(context.config).toEqual({ ...original, ui: { ...original.ui, theme: 'light' } });
    expect(context.applySyncedConfigSideEffects).toHaveBeenCalledTimes(1);
  });
  test('a failed backup never writes or changes config', async () => {
    context.backupLocalProfileBeforePullApply.mockRejectedValue(new Error('Disk full'));
    await expect(
      context.applyLocalProfileSections({ visualPersonalization: { ui: { theme: 'light' } } })
    ).rejects.toThrow('Disk full');
    expect(context.config).toBe(original);
    expect(context.saveConfigDurably).not.toHaveBeenCalled();
  });
  test('a failed durable save restores config and sync tracking', async () => {
    context.saveConfigDurably.mockResolvedValue({ success: false, error: 'Disk full' });
    await expect(
      context.applyLocalProfileSections({ visualPersonalization: { ui: { theme: 'light' } } })
    ).rejects.toThrow('Disk full');
    expect(context.config).toBe(original);
    expect(context.profileSyncRuntime.pendingPullEchoHash).toBe('old');
    expect(context.applySyncedConfigSideEffects).not.toHaveBeenCalled();
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

/** @jest-environment node */
const fs = require('fs');
const os = require('os');
const path = require('path');
const {
  createSettingsFileController,
  settingsFileErrorCode,
} = require('../../src/settings-file-controller.cjs');
const {
  serializeSettingsFile,
  parseSettingsFile,
  MAX_SETTINGS_FILE_BYTES,
} = require('../../src/settings-file.cjs');

describe('native settings file workflow', () => {
  let folder, file, controller, dialog, applySections, config, clock;
  beforeEach(() => {
    folder = fs.mkdtempSync(path.join(os.tmpdir(), 'ha-settings-files-'));
    file = path.join(folder, 'settings.json');
    config = {
      ui: { theme: 'dark' },
      customTabs: [{ id: 'home', name: 'Home', entityIds: [] }],
      homeAssistant: { token: 'secret' },
    };
    fs.writeFileSync(file, serializeSettingsFile(config));
    dialog = {
      showSaveDialog: jest.fn().mockResolvedValue({ filePath: file }),
      showOpenDialog: jest.fn().mockResolvedValue({ filePaths: [file] }),
    };
    applySections = jest.fn().mockResolvedValue({ config });
    clock = 0;
    controller = createSettingsFileController({
      fs,
      dialog,
      getConfig: () => config,
      applySections,
      translate: (key) => key,
      now: () => clock,
    });
  });
  afterEach(() => fs.rmSync(folder, { recursive: true, force: true }));
  test('exports to the native dialog destination with no credentials', async () => {
    config.ui.theme = 'light';
    await expect(controller.exportSettings({})).resolves.toEqual({ canceled: false });
    expect(parseSettingsFile(fs.readFileSync(file, 'utf8')).ui.theme).toBe('light');
    expect(fs.readFileSync(file, 'utf8')).not.toContain('secret');
  });
  test('previews without applying and only applies the exact selected document once', async () => {
    const preview = await controller.previewImport({}, 1);
    expect(preview).toMatchObject({
      fileName: 'settings.json',
      pageNames: ['Home'],
      changedSections: [],
    });
    expect(applySections).not.toHaveBeenCalled();
    // Changing the file after the preview must not change what confirmation applies.
    fs.writeFileSync(file, serializeSettingsFile({ ui: { theme: 'light' } }));
    await expect(controller.applyImport(2, preview.id)).rejects.toMatchObject({
      code: 'import_expired',
    });
    await controller.applyImport(1, preview.id);
    expect(applySections).toHaveBeenCalledWith(
      expect.objectContaining({
        visualPersonalization: expect.objectContaining({
          ui: expect.objectContaining({ theme: 'dark' }),
        }),
      })
    );
    await expect(controller.applyImport(1, preview.id)).rejects.toMatchObject({
      code: 'import_expired',
    });
  });
  test('a configuration change after the preview expires it without applying', async () => {
    const preview = await controller.previewImport({}, 1);
    // A sync pull lands while the confirmation is open.
    config.ui.theme = 'light';
    await expect(controller.applyImport(1, preview.id)).rejects.toMatchObject({
      code: 'import_expired',
    });
    expect(applySections).not.toHaveBeenCalled();
    // Settings the file never carries do not invalidate it.
    const fresh = await controller.previewImport({}, 1);
    config.homeAssistant.token = 'rotated';
    await controller.applyImport(1, fresh.id);
    expect(applySections).toHaveBeenCalledTimes(1);
  });
  test('canceled dialogs leave the file and config untouched', async () => {
    const before = fs.readFileSync(file, 'utf8');
    dialog.showSaveDialog.mockResolvedValue({ canceled: true });
    dialog.showOpenDialog.mockResolvedValue({ canceled: true });
    await expect(controller.exportSettings({})).resolves.toEqual({ canceled: true });
    await expect(controller.previewImport({}, 1)).resolves.toEqual({ canceled: true });
    expect(fs.readFileSync(file, 'utf8')).toBe(before);
    expect(applySections).not.toHaveBeenCalled();
  });
  test('expired previews and oversized files never reach configuration application', async () => {
    const preview = await controller.previewImport({}, 1);
    clock = 600000;
    await expect(controller.applyImport(1, preview.id)).rejects.toMatchObject({
      code: 'import_expired',
    });
    fs.writeFileSync(file, ' '.repeat(MAX_SETTINGS_FILE_BYTES + 1));
    await expect(controller.previewImport({}, 1)).rejects.toMatchObject({ code: 'file_too_large' });
    expect(applySections).not.toHaveBeenCalled();
  });
  test('propagates a failed backup or save without reporting success', async () => {
    const preview = await controller.previewImport({}, 1);
    applySections.mockRejectedValue(new Error('Backup failed'));
    await expect(controller.applyImport(1, preview.id)).rejects.toThrow('Backup failed');
  });
  test('failed export replacement keeps the old file and removes the temporary file', async () => {
    const before = fs.readFileSync(file, 'utf8');
    const failingFs = {
      promises: { ...fs.promises, rename: jest.fn().mockRejectedValue(new Error('Disk failure')) },
    };
    controller = createSettingsFileController({
      fs: failingFs,
      dialog,
      getConfig: () => config,
      applySections,
      translate: (key) => key,
    });
    await expect(controller.exportSettings({})).rejects.toThrow('Disk failure');
    expect(fs.readFileSync(file, 'utf8')).toBe(before);
    expect(fs.readdirSync(folder)).toEqual(['settings.json']);
  });

  describe('window auto-hide suspension around native dialogs', () => {
    let events, resume;
    beforeEach(() => {
      events = [];
      resume = jest.fn(() => events.push('resume'));
      controller = createSettingsFileController({
        fs,
        dialog,
        suspendAutoHide: jest.fn(() => {
          events.push('suspend');
          return resume;
        }),
        getConfig: () => config,
        applySections,
        translate: (key) => key,
      });
    });
    const track = (mock, result) =>
      mock.mockImplementation(async () => {
        events.push('dialog');
        if (result instanceof Error) throw result;
        return result;
      });
    const cases = [
      ['exportSettings', 'showSaveDialog', [{}], { filePath: () => file }],
      ['previewImport', 'showOpenDialog', [{}, 1], { filePaths: () => [file] }],
    ];
    test.each(cases)(
      '%s suspends before and resumes after the dialog on success',
      async (method, dialogName, args, pick) => {
        track(dialog[dialogName], { [Object.keys(pick)[0]]: Object.values(pick)[0]() });
        await controller[method](...args);
        expect(events).toEqual(['suspend', 'dialog', 'resume']);
      }
    );
    test.each(cases)('%s resumes when the dialog is canceled', async (method, dialogName, args) => {
      track(dialog[dialogName], { canceled: true });
      await expect(controller[method](...args)).resolves.toEqual({ canceled: true });
      expect(events).toEqual(['suspend', 'dialog', 'resume']);
    });
    test.each(cases)('%s resumes when the dialog throws', async (method, dialogName, args) => {
      track(dialog[dialogName], new Error('Dialog failure'));
      await expect(controller[method](...args)).rejects.toThrow('Dialog failure');
      expect(events).toEqual(['suspend', 'dialog', 'resume']);
    });
  });

  describe('renderer-facing error codes', () => {
    test('passes through only the settings file error codes', () => {
      for (const code of [
        'invalid_file',
        'unsupported_version',
        'file_too_large',
        'import_expired',
      ])
        expect(settingsFileErrorCode({ code }, 'import_failed')).toBe(code);
    });
    test('maps raw errno and unknown codes to the operation fallback', () => {
      for (const code of ['EACCES', 'ENOSPC', 'EPERM', 'ENOENT', 'export_failed', undefined])
        expect(settingsFileErrorCode({ code }, 'export_failed')).toBe('export_failed');
      expect(settingsFileErrorCode(new Error('x'), 'import_failed')).toBe('import_failed');
      expect(settingsFileErrorCode(null, 'import_failed')).toBe('import_failed');
    });
  });
});

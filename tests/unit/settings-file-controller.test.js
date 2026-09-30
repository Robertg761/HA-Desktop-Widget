/** @jest-environment node */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { createSettingsFileController } = require('../../src/settings-file-controller.cjs');
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
      expect.objectContaining({ visualPersonalization: { ui: { theme: 'dark' } } })
    );
    await expect(controller.applyImport(1, preview.id)).rejects.toMatchObject({
      code: 'import_expired',
    });
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
});

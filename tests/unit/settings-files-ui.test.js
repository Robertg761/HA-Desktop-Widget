jest.mock('../../src/ui-utils.js', () => ({ showConfirm: jest.fn(), showToast: jest.fn() }));
const { initializeSettingsFiles } = require('../../src/settings-files-ui.js');
const { showConfirm, showToast } = require('../../src/ui-utils.js');
const state = require('../../src/state.js').default;

describe('settings file controls', () => {
  let api, imported;
  const flush = async () => {
    for (let i = 0; i < 20; i += 1) await Promise.resolve();
  };
  beforeEach(() => {
    jest.clearAllMocks();
    document.body.innerHTML =
      '<button id="export-settings-file"></button><button id="import-settings-file"></button>';
    state.setStates({ 'light.desk': { state: 'on' } });
    api = {
      exportSettingsFile: jest.fn().mockResolvedValue({ success: true }),
      previewSettingsImport: jest.fn().mockResolvedValue({
        success: true,
        id: 'selected',
        fileName: 'settings.json',
        changedSections: ['quickAccessLayout'],
        pageNames: ['Home'],
        entityIds: ['light.desk', 'sensor.missing'],
      }),
      applySettingsImport: jest
        .fn()
        .mockResolvedValue({ success: true, config: { ui: { theme: 'light' } } }),
    };
    window.electronAPI = api;
    imported = jest.fn();
    showConfirm.mockResolvedValue(true);
    initializeSettingsFiles({ onImported: imported });
  });
  test('previews changes and missing entities before applying and refreshing settings', async () => {
    document.getElementById('import-settings-file').click();
    await flush();
    expect(showConfirm).toHaveBeenCalledWith(
      'Import settings',
      expect.stringContaining('Unavailable entities on this connection: 1'),
      expect.any(Object)
    );
    expect(api.applySettingsImport).toHaveBeenCalledWith('selected');
    expect(imported).toHaveBeenCalledWith({ ui: { theme: 'light' } });
    expect(showToast).toHaveBeenCalledWith('Settings imported.', 'success', 2200);
    expect(document.getElementById('export-settings-file').disabled).toBe(false);
  });
  test('canceling confirmation never applies the file', async () => {
    showConfirm.mockResolvedValue(false);
    document.getElementById('import-settings-file').click();
    await flush();
    expect(api.applySettingsImport).not.toHaveBeenCalled();
    expect(imported).not.toHaveBeenCalled();
  });
  test('failed import reports failure and leaves the current UI alone', async () => {
    api.applySettingsImport.mockRejectedValue(
      Object.assign(new Error('Failed'), { result: { code: 'import_failed' } })
    );
    document.getElementById('import-settings-file').click();
    await flush();
    expect(imported).not.toHaveBeenCalled();
    expect(showToast).toHaveBeenCalledWith(
      'Could not import settings. Your current settings are unchanged.',
      'error',
      4000
    );
    expect(document.getElementById('import-settings-file').disabled).toBe(false);
  });
  test('canceled export is quiet and duplicate clicks do not open duplicate dialogs', async () => {
    let resolve;
    api.exportSettingsFile.mockReturnValue(
      new Promise((done) => {
        resolve = done;
      })
    );
    const button = document.getElementById('export-settings-file');
    button.click();
    button.click();
    expect(api.exportSettingsFile).toHaveBeenCalledTimes(1);
    resolve({ success: true, canceled: true });
    await flush();
    expect(showToast).not.toHaveBeenCalled();
  });
  test('failed export reports an export-specific message, not the import failure', async () => {
    api.exportSettingsFile.mockResolvedValue({ success: false, code: 'export_failed' });
    document.getElementById('export-settings-file').click();
    await flush();
    expect(showToast).toHaveBeenCalledWith('Could not export settings.', 'error', 4000);
  });
  test('an export that fails validation is not reported as a bad file the user chose', async () => {
    api.exportSettingsFile.mockResolvedValue({ success: false, code: 'invalid_file' });
    document.getElementById('export-settings-file').click();
    await flush();
    expect(showToast).toHaveBeenCalledWith('Could not export settings.', 'error', 4000);
  });
  test('says when unsaved Settings edits are not in the export', async () => {
    document.body.innerHTML =
      '<button id="export-settings-file"></button><button id="import-settings-file"></button>';
    initializeSettingsFiles({ onImported: imported, hasUnsavedChanges: () => true });

    document.getElementById('export-settings-file').click();
    await flush();

    expect(showToast).toHaveBeenCalledWith(
      'Settings exported. Changes you have not saved yet are not included.',
      'warning',
      4000
    );
  });
  test('does not call every entity unavailable before Home Assistant has delivered any', async () => {
    state.setStates({});
    document.getElementById('import-settings-file').click();
    await flush();
    const message = showConfirm.mock.calls[0][1];
    expect(message).toContain('Referenced entities: 2');
    expect(message).not.toContain('Unavailable entities');
  });
  test('lists a few page names, shortened, and counts the rest', async () => {
    api.previewSettingsImport.mockResolvedValue({
      success: true,
      id: 'selected',
      fileName: 'settings.json',
      changedSections: [],
      pageNames: [
        'x'.repeat(200),
        ...Array.from({ length: 12 }, (_, index) => `Page ${index + 2}`),
      ],
      entityIds: [],
    });
    document.getElementById('import-settings-file').click();
    await flush();
    const message = showConfirm.mock.calls[0][1];
    expect(message).toContain(`${'x'.repeat(39)}…, Page 2`);
    expect(message).toContain('Page 8, … (+5)');
    expect(message).not.toContain('x'.repeat(41));
    expect(message).not.toContain('Page 9');
  });
  test('names the size a settings file may have', async () => {
    api.previewSettingsImport.mockResolvedValue({ success: false, code: 'file_too_large' });
    document.getElementById('import-settings-file').click();
    await flush();
    expect(showToast).toHaveBeenCalledWith(
      'Settings files must be smaller than 256 KB.',
      'error',
      4000
    );
  });
});

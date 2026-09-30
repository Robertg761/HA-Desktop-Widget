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
});

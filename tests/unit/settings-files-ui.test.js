jest.mock('../../src/ui-utils.js', () => ({ showConfirm: jest.fn(), showToast: jest.fn() }));
const { initializeSettingsFiles } = require('../../src/settings-files-ui.js');
const { showConfirm, showToast } = require('../../src/ui-utils.js');
const state = require('../../src/state.js').default;

describe('settings file controls', () => {
  let api, imported;
  const flush = async () => {
    for (let i = 0; i < 20; i += 1) await Promise.resolve();
  };
  // The rows of the confirmation, as label to value.
  const facts = () => {
    const rows = [...showConfirm.mock.calls[0][1].querySelectorAll('dt, dd')];
    const result = {};
    for (let i = 0; i < rows.length; i += 2) result[rows[i].textContent] = rows[i + 1].textContent;
    return result;
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
      expect.any(Node),
      expect.objectContaining({ confirmText: 'Replace settings' })
    );
    expect(facts()).toEqual({
      File: 'settings.json',
      Changes: 'Quick Access and layout',
      'Page names': 'Home',
      'Entities used': '2',
      'Missing from this connection': '1',
    });
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
    expect(facts()['Entities used']).toBe('2');
    expect(facts()).not.toHaveProperty('Missing from this connection');
  });
  test('puts the replace-and-backup warning first, and the facts after it as rows', async () => {
    document.getElementById('import-settings-file').click();
    await flush();
    const summary = showConfirm.mock.calls[0][1];
    expect(summary.firstElementChild.className).toBe('confirm-callout');
    expect(summary.firstElementChild.textContent).toMatch(
      /^Import applies immediately and replaces unsaved Settings edits\. Your current saved settings are backed up first\./
    );
    expect(summary.lastElementChild.tagName).toBe('DL');
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
    const { 'Page names': pages } = facts();
    expect(pages).toContain(`${'x'.repeat(39)}…, Page 2`);
    expect(pages).toContain('Page 8 … (+5)');
    expect(pages).not.toContain('x'.repeat(41));
    expect(pages).not.toContain('Page 9');
  });
  test('names the size a settings file may have', async () => {
    api.previewSettingsImport.mockResolvedValue({ success: false, code: 'file_too_large' });
    document.getElementById('import-settings-file').click();
    await flush();
    expect(showToast).toHaveBeenCalledWith(
      'Settings files must be smaller than 1 MB.',
      'error',
      4000
    );
  });
  test('says what to remove when the settings are too large to export', async () => {
    api.exportSettingsFile.mockResolvedValue({ success: false, code: 'export_too_large' });
    document.getElementById('export-settings-file').click();
    await flush();
    expect(showToast).toHaveBeenCalledWith(
      'Your settings are too large to export. Remove some pages, favorites or alerts and try again.',
      'error',
      4000
    );
  });
});

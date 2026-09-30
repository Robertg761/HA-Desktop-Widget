import { t } from './i18n.js';
import { showConfirm, showToast } from './ui-utils.js';
import state from './state.js';

function settingsFileError(code) {
  if (code === 'invalid_file') return t('Choose a valid HA Desktop Widget settings file.');
  if (code === 'unsupported_version') return t('This settings file needs a different app version.');
  if (code === 'file_too_large') return t('Settings files must be smaller than 1 MB.');
  if (code === 'import_expired') return t('Choose the settings file again before importing.');
  if (code === 'export_failed') return t('Could not export settings.');
  return t('Could not import settings. Your current settings are unchanged.');
}

function initializeSettingsFiles({ onImported }) {
  const exportButton = document.getElementById('export-settings-file');
  const importButton = document.getElementById('import-settings-file');
  if (!exportButton || !importButton) return;
  const api = window.electronAPI;
  exportButton.disabled = typeof api?.exportSettingsFile !== 'function';
  importButton.disabled = typeof api?.previewSettingsImport !== 'function';
  let busy = false;
  const run = async (action) => {
    if (busy) return;
    busy = true;
    exportButton.disabled = true;
    importButton.disabled = true;
    try {
      await action();
    } catch (error) {
      showToast(settingsFileError(error?.result?.code || error?.code), 'error', 4000);
    } finally {
      busy = false;
      exportButton.disabled = typeof api?.exportSettingsFile !== 'function';
      importButton.disabled = typeof api?.previewSettingsImport !== 'function';
    }
  };
  exportButton.onclick = () =>
    run(async () => {
      const result = await api.exportSettingsFile();
      if (!result?.success)
        return showToast(settingsFileError(result?.code || 'export_failed'), 'error', 4000);
      if (!result.canceled) showToast(t('Settings exported.'), 'success', 2200);
    });
  importButton.onclick = () =>
    run(async () => {
      const preview = await api.previewSettingsImport();
      if (!preview?.success) return showToast(settingsFileError(preview?.code), 'error', 4000);
      if (preview.canceled) return;
      const labels = {
        quickAccessLayout: t('Quick Access and layout'),
        visualPersonalization: t('Appearance'),
        automationAlerts: t('Alerts'),
        connectionMediaPreferences: t('Weather and media'),
      };
      const sections =
        preview.changedSections
          .map((key) => labels[key])
          .filter(Boolean)
          .join(', ') || t('No changes');
      const unavailable = preview.entityIds.filter((id) => !state.STATES?.[id]).length;
      const summary = [
        t('File: {{name}}', { name: preview.fileName }),
        t('Changes: {{sections}}', { sections }),
        t('Pages: {{pages}}. Referenced entities: {{count}}.', {
          pages: preview.pageNames.join(', ') || t('None'),
          count: preview.entityIds.length,
        }),
        ...(unavailable
          ? [
              t('Unavailable entities on this connection: {{count}}.', {
                count: unavailable,
              }),
            ]
          : []),
        t(
          'Import applies immediately and replaces unsaved Settings edits. Your current saved settings are backed up first. Connection details, desktop pins, shortcuts and profile sync stay on this computer. Imported settings follow your existing sync scope.'
        ),
      ].join('\n\n');
      if (
        !(await showConfirm(t('Import settings'), summary, {
          confirmText: t('Import settings'),
          confirmClass: 'btn-primary',
        }))
      )
        return;
      const result = await api.applySettingsImport(preview.id);
      if (!result?.success) return showToast(settingsFileError(result?.code), 'error', 4000);
      showToast(t('Settings imported.'), 'success', 2200);
      try {
        await onImported(result.config);
      } catch {
        showToast(t('Settings imported. Reopen Settings to refresh the controls.'), 'info', 4000);
      }
    });
}

export { initializeSettingsFiles, settingsFileError };

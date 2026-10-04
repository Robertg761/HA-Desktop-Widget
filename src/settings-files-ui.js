import { formatNumber, t } from './i18n.js';
import { showConfirm, showToast } from './ui-utils.js';
import state from './state.js';

function settingsFileError(code) {
  if (code === 'invalid_file') return t('Choose a valid HA Desktop Widget settings file.');
  if (code === 'unsupported_version') return t('This settings file needs a different app version.');
  if (code === 'file_too_large') return t('Settings files must be smaller than 1 MB.');
  if (code === 'export_too_large')
    return t(
      'Your settings are too large to export. Remove some pages, favorites or alerts and try again.'
    );
  if (code === 'import_expired') return t('Choose the settings file again before importing.');
  if (code === 'export_failed') return t('Could not export settings.');
  return t('Could not import settings. Your current settings are unchanged.');
}

// A page name is one line the person typed, but a file can hold anything; the confirmation lists
// a few, shortened, and says how many more there are.
const PREVIEW_PAGE_NAMES = 8;
const PREVIEW_NAME_LENGTH = 40;

function describePageNames(pageNames) {
  const shown = pageNames
    .slice(0, PREVIEW_PAGE_NAMES)
    .map((name) =>
      name.length > PREVIEW_NAME_LENGTH ? `${name.slice(0, PREVIEW_NAME_LENGTH - 1)}…` : name
    );
  const more = pageNames.length - shown.length;
  return `${shown.join(', ')}${more > 0 ? `, … (+${more})` : ''}`;
}

// What the file holds, as rows to scan, under the sentence that matters: that this replaces the
// current settings (and what is kept). It used to be five paragraphs of equal weight, with the
// warning last, and "Referenced entities: 15." wrapping onto a line of its own.
function buildImportSummary({ fileName, sections, pages, entityCount, unavailable }) {
  const fragment = document.createDocumentFragment();
  const warning = document.createElement('p');
  warning.className = 'confirm-callout';
  warning.textContent = t(
    'Import applies immediately and replaces unsaved Settings edits. Your current saved settings are backed up first. Connection details, desktop pins, shortcuts and profile sync stay on this computer. Imported settings follow your existing sync scope.'
  );
  const facts = document.createElement('dl');
  facts.className = 'confirm-facts';
  const rows = [
    [t('File'), fileName],
    [t('Changes'), sections],
    [t('Page names'), pages],
    [t('Entities used'), formatNumber(entityCount)],
    ...(unavailable ? [[t('Missing from this connection'), formatNumber(unavailable)]] : []),
  ];
  for (const [label, value] of rows) {
    const term = document.createElement('dt');
    term.textContent = label;
    const detail = document.createElement('dd');
    detail.textContent = value;
    // A file name or a page name is the person's own text, in whatever direction it was typed.
    detail.dir = 'auto';
    facts.append(term, detail);
  }
  fragment.append(warning, facts);
  return fragment;
}

function initializeSettingsFiles({ onImported, hasUnsavedChanges = () => false }) {
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
      // Export writes what is saved; an unsaved edit is not in it.
      const unsaved = hasUnsavedChanges();
      const result = await api.exportSettingsFile();
      if (!result?.success) {
        // Nothing was chosen on export, so "choose a valid file" would answer a different question.
        const code = result?.code === 'invalid_file' ? 'export_failed' : result?.code;
        return showToast(settingsFileError(code || 'export_failed'), 'error', 4000);
      }
      if (result.canceled) return;
      showToast(
        unsaved
          ? t('Settings exported. Changes you have not saved yet are not included.')
          : t('Settings exported.'),
        unsaved ? 'warning' : 'success',
        unsaved ? 4000 : 2200
      );
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
      // Before Home Assistant has delivered its entities (first run, or disconnected) every
      // entity looks missing, which says nothing about the file.
      const entitiesLoaded = Object.keys(state.STATES || {}).length > 0;
      const unavailable = entitiesLoaded
        ? preview.entityIds.filter((id) => !state.STATES[id]).length
        : 0;
      const summary = buildImportSummary({
        fileName: preview.fileName,
        sections,
        pages: describePageNames(preview.pageNames) || t('None'),
        entityCount: preview.entityIds.length,
        unavailable,
      });
      if (
        !(await showConfirm(t('Import settings'), summary, {
          // The verb for what happens to the settings, not the title said twice.
          confirmText: t('Replace settings'),
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

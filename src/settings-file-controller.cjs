const path = require('path');
const { Buffer } = require('buffer');
const crypto = require('crypto');
const { computeProfileHash } = require('../profile-sync-core.js');
const {
  MAX_SETTINGS_FILE_BYTES,
  buildSettingsFile,
  serializeSettingsFile,
  parseSettingsFile,
  settingsFileSections,
  summarizeSettingsImport,
} = require('./settings-file.cjs');

const SETTINGS_FILE_ERROR_CODES = new Set([
  'invalid_file',
  'unsupported_version',
  'file_too_large',
  'import_expired',
]);

// Only the module's own error codes may reach the renderer; raw errno codes (EACCES, ENOSPC...)
// collapse to the operation's generic failure code.
function settingsFileErrorCode(error, fallback) {
  return SETTINGS_FILE_ERROR_CODES.has(error?.code) ? error.code : fallback;
}

function createSettingsFileController({
  fs,
  dialog,
  suspendAutoHide = () => () => {},
  getConfig,
  applySections,
  translate,
  now = Date.now,
}) {
  const pending = new Map();
  // The portable settings as they stand, so a preview can tell the configuration changed under it.
  const configRevision = () => computeProfileHash(buildSettingsFile(getConfig()).settings);
  const filters = [{ name: 'JSON', extensions: ['json'] }];
  return {
    async exportSettings(window) {
      const resumeAutoHide = suspendAutoHide();
      let choice;
      try {
        choice = await dialog.showSaveDialog(window, {
          title: translate('Export settings'),
          defaultPath: 'ha-desktop-widget-settings.json',
          filters,
        });
      } finally {
        resumeAutoHide();
      }
      if (choice.canceled || !choice.filePath) return { canceled: true };
      // Serialize after choosing the destination so edits while the dialog was open are included.
      const content = serializeSettingsFile(getConfig());
      const temporary = path.join(
        path.dirname(choice.filePath),
        `.ha-widget-settings-${crypto.randomUUID()}.tmp`
      );
      try {
        await fs.promises.writeFile(temporary, content, {
          encoding: 'utf8',
          mode: 0o600,
          flag: 'wx',
        });
        await fs.promises.rename(temporary, choice.filePath);
      } finally {
        await fs.promises.unlink(temporary).catch(() => {});
      }
      return { canceled: false };
    },
    async previewImport(window, senderId) {
      pending.delete(senderId);
      const resumeAutoHide = suspendAutoHide();
      let choice;
      try {
        choice = await dialog.showOpenDialog(window, {
          title: translate('Import settings'),
          properties: ['openFile'],
          filters,
        });
      } finally {
        resumeAutoHide();
      }
      if (choice.canceled || !choice.filePaths?.length) return { canceled: true };
      const handle = await fs.promises.open(choice.filePaths[0], 'r');
      let content;
      try {
        const buffer = Buffer.alloc(MAX_SETTINGS_FILE_BYTES + 1);
        let size = 0;
        while (size < buffer.length) {
          const { bytesRead } = await handle.read(buffer, size, buffer.length - size, null);
          if (!bytesRead) break;
          size += bytesRead;
        }
        if (size > MAX_SETTINGS_FILE_BYTES)
          throw Object.assign(new Error('file_too_large'), { code: 'file_too_large' });
        content = buffer.subarray(0, size).toString('utf8');
      } finally {
        await handle.close();
      }
      const settings = parseSettingsFile(content);
      const id = crypto.randomUUID();
      pending.set(senderId, {
        id,
        settings,
        revision: configRevision(),
        expiresAt: now() + 10 * 60 * 1000,
      });
      return {
        canceled: false,
        id,
        fileName: path.basename(choice.filePaths[0]),
        ...summarizeSettingsImport(settings, getConfig()),
      };
    },
    async applyImport(senderId, id) {
      const candidate = pending.get(senderId);
      if (!candidate || candidate.id !== id || candidate.expiresAt <= now())
        throw Object.assign(new Error('import_expired'), { code: 'import_expired' });
      // Consume before awaiting so a double click can never apply the same import twice.
      pending.delete(senderId);
      // A sync pull or other change since the preview means its summary no longer matches.
      if (candidate.revision !== configRevision())
        throw Object.assign(new Error('import_expired'), { code: 'import_expired' });
      return applySections(settingsFileSections(candidate.settings));
    },
  };
}

module.exports = { createSettingsFileController, settingsFileErrorCode };

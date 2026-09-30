const path = require('path');
const { Buffer } = require('buffer');
const crypto = require('crypto');
const {
  MAX_SETTINGS_FILE_BYTES,
  serializeSettingsFile,
  parseSettingsFile,
  settingsFileSections,
  summarizeSettingsImport,
} = require('./settings-file.cjs');

function createSettingsFileController({
  fs,
  dialog,
  getConfig,
  applySections,
  translate,
  now = Date.now,
}) {
  const pending = new Map();
  const filters = [{ name: 'JSON', extensions: ['json'] }];
  return {
    async exportSettings(window) {
      const choice = await dialog.showSaveDialog(window, {
        title: translate('Export settings'),
        defaultPath: 'ha-desktop-widget-settings.json',
        filters,
      });
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
      const choice = await dialog.showOpenDialog(window, {
        title: translate('Import settings'),
        properties: ['openFile'],
        filters,
      });
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
      pending.set(senderId, { id, settings, expiresAt: now() + 10 * 60 * 1000 });
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
      return applySections(settingsFileSections(candidate.settings));
    },
  };
}

module.exports = { createSettingsFileController };

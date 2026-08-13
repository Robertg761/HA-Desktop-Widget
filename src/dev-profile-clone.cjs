const fs = require('fs');
const path = require('path');
const nodeCrypto = require('crypto');

const DEV_PROFILE_CLONE_FILES = Object.freeze([
  { name: 'config.json' },
  { name: 'home-assistant-oauth.json', mode: 0o600 },
  { name: 'xwayland-unavailable' },
]);

function replaceFileFromSource(sourcePath, destinationPath, mode) {
  const temporaryPath = `${destinationPath}.${nodeCrypto.randomBytes(8).toString('hex')}.tmp`;
  try {
    fs.copyFileSync(sourcePath, temporaryPath);
    if (Number.isInteger(mode)) {
      try {
        fs.chmodSync(temporaryPath, mode);
      } catch {
        // Windows does not apply POSIX file modes.
      }
    }
    try {
      fs.renameSync(temporaryPath, destinationPath);
    } catch (error) {
      if (!['EEXIST', 'EPERM'].includes(error?.code) || !fs.existsSync(destinationPath)) {
        throw error;
      }
      fs.unlinkSync(destinationPath);
      fs.renameSync(temporaryPath, destinationPath);
    }
  } catch (error) {
    try {
      fs.unlinkSync(temporaryPath);
    } catch {
      // Best-effort cleanup only.
    }
    throw error;
  }
}

function cloneProductionProfile({ productionUserDataPath, developmentUserDataPath, log = {} }) {
  if (!productionUserDataPath || !developmentUserDataPath) {
    throw new TypeError('Production and development profile paths are required');
  }
  if (path.resolve(productionUserDataPath) === path.resolve(developmentUserDataPath)) {
    throw new Error('Development profile must not overwrite the production profile');
  }

  fs.mkdirSync(developmentUserDataPath, { recursive: true });
  const copied = [];
  const missing = [];
  const failed = [];

  for (const file of DEV_PROFILE_CLONE_FILES) {
    const sourcePath = path.join(productionUserDataPath, file.name);
    const destinationPath = path.join(developmentUserDataPath, file.name);
    if (!fs.existsSync(sourcePath)) {
      missing.push(file.name);
      continue;
    }
    try {
      replaceFileFromSource(sourcePath, destinationPath, file.mode);
      copied.push(file.name);
    } catch (error) {
      failed.push(file.name);
      log.warn?.(
        `Could not clone ${file.name} into the development profile:`,
        error?.message || error
      );
    }
  }

  return { copied, missing, failed };
}

module.exports = {
  DEV_PROFILE_CLONE_FILES,
  cloneProductionProfile,
};

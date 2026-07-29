const fs = require('fs');
const path = require('path');

const SMOKE_TEST_PROFILE_PREFIX = 'ha-desktop-widget-smoke-';

function isSafeSmokeTestProfilePath(profilePath, tempRoot) {
  if (typeof profilePath !== 'string' || typeof tempRoot !== 'string') return false;
  if (!profilePath.trim() || !tempRoot.trim()) return false;

  const resolvedProfilePath = path.resolve(profilePath);
  const resolvedTempRoot = path.resolve(tempRoot);
  const profileName = path.basename(resolvedProfilePath);
  return (
    path.dirname(resolvedProfilePath) === resolvedTempRoot &&
    profileName.startsWith(SMOKE_TEST_PROFILE_PREFIX) &&
    profileName.length > SMOKE_TEST_PROFILE_PREFIX.length
  );
}

function removeSmokeTestProfile(profilePath, tempRoot, fsModule = fs) {
  if (!isSafeSmokeTestProfilePath(profilePath, tempRoot)) {
    return {
      success: false,
      error: 'Refused to remove a path that is not an exact smoke-test profile directory',
    };
  }

  try {
    fsModule.rmSync(path.resolve(profilePath), {
      recursive: true,
      force: true,
      // Windows refuses to delete files the still-running Chromium process has
      // open, so give EBUSY/EPERM retries a few seconds to let handles close.
      maxRetries: 20,
      retryDelay: 250,
    });
    return { success: true };
  } catch (error) {
    return { success: false, error: error?.message || String(error) };
  }
}

module.exports = {
  SMOKE_TEST_PROFILE_PREFIX,
  isSafeSmokeTestProfilePath,
  removeSmokeTestProfile,
};

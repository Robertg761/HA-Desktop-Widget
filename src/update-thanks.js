/**
 * The one notice after an update: which version is now running, a link to what changed and a quiet
 * way to support development. It shows once per release, on the first start of that release, and
 * stays until it is dismissed (a button, its close button, a click on it or Escape); nothing asks
 * again until the next update.
 *
 * The version last started is kept in this computer's localStorage rather than in the settings:
 * profile sync would otherwise carry one computer's update over to another that has not updated.
 */

import { showToast } from './dialogs.js';
import { t } from './i18n.js';

const LAST_RUN_VERSION_KEY = 'ha-widget:last-run-version';
// It waits for the user: a notice that left by itself was gone before anyone looked at the widget.
const UPDATE_NOTICE_MS = Infinity;

// The release notes of a version are on its GitHub release, tagged with a "v" before the version.
const RELEASE_PAGE_URL = 'https://github.com/Robertg761/HA-Desktop-Widget/releases/tag';

const RELEASE_VERSION_PATTERN = /^(\d+)\.(\d+)\.(\d+)(?:-[0-9A-Za-z.-]+)?$/;

/** Only a real release has a release page; a development build ('dev', 'x.y.z-dev') has none. */
function isReleaseVersion(version) {
  return RELEASE_VERSION_PATTERN.test(String(version || '')) && !/-dev\b/.test(version);
}

function releasePageUrl(version) {
  return `${RELEASE_PAGE_URL}/v${version}`;
}

// -1, 0 or 1 by major.minor.patch alone: a beta and its release count as the same version here.
function compareReleaseCores(a, b) {
  const partsA = RELEASE_VERSION_PATTERN.exec(a).slice(1, 4).map(Number);
  const partsB = RELEASE_VERSION_PATTERN.exec(b).slice(1, 4).map(Number);
  for (let index = 0; index < 3; index += 1) {
    if (partsA[index] !== partsB[index]) return partsA[index] > partsB[index] ? 1 : -1;
  }
  return 0;
}

function readLastRunVersion(storage) {
  try {
    return storage?.getItem(LAST_RUN_VERSION_KEY) ?? null;
  } catch {
    return null;
  }
}

function writeLastRunVersion(storage, version) {
  try {
    storage?.setItem(LAST_RUN_VERSION_KEY, version);
    return true;
  } catch {
    return false;
  }
}

/**
 * Note that this version has started, and say whether this start is the first since an update.
 *
 * A computer with no version noted yet either is a new install or ran a release from before this
 * notice existed; `wasSetUp` (a Home Assistant address was saved before this start) tells the two
 * apart, so a new user is not welcomed to an update they never had. Going back to an older
 * version says nothing, and neither does a version that could not be noted, since it would then
 * be announced on every start.
 *
 * @param {string} version - The running app version.
 * @param {{ wasSetUp?: boolean, storage?: Storage }} [options]
 * @returns {boolean}
 */
function noteStartedVersion(version, { wasSetUp = false, storage = globalThis.localStorage } = {}) {
  if (!isReleaseVersion(version)) return false;
  const previous = readLastRunVersion(storage);
  if (previous === version) return false;
  if (!writeLastRunVersion(storage, version)) return false;
  if (previous === null) return !!wasSetUp;
  if (!isReleaseVersion(previous)) return true;
  return compareReleaseCores(version, previous) >= 0;
}

/**
 * Show the after-update notice.
 *
 * @param {string} version - The version now running.
 * @param {{ openExternal: (url: string) => unknown, onSupport: () => unknown }} actions
 */
function showUpdateThanks(version, { openExternal, onSupport }) {
  return showToast(t('Updated to version {{version}}', { version }), 'success', UPDATE_NOTICE_MS, {
    source: 'update-thanks',
    detail: t('Enjoying the widget? You can support its development.'),
    actions: [
      {
        id: 'whats-new',
        label: t("What's new"),
        onClick: () => openExternal(releasePageUrl(version)),
      },
      {
        id: 'support',
        label: t('Support'),
        icon: 'heart',
        onClick: () => onSupport(),
      },
    ],
  });
}

export {
  LAST_RUN_VERSION_KEY,
  UPDATE_NOTICE_MS,
  isReleaseVersion,
  noteStartedVersion,
  releasePageUrl,
  showUpdateThanks,
};

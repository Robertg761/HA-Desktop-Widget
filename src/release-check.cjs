'use strict';

/**
 * Finding a newer release on GitHub for the builds that cannot update themselves (the Windows
 * portable build, macOS, .deb and Arch), and the version arithmetic it needs. None of it needs
 * Electron: main.js supplies the fetch, the running version, the release channel and the
 * translator.
 */

const RELEASES_REPO = 'Robertg761/HA-Desktop-Widget';

function normalizeVersion(value) {
  if (!value) return '';
  return String(value).trim().replace(/^v/i, '');
}

function parseVersionParts(value) {
  const normalized = normalizeVersion(value);
  const match = normalized.match(/^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?/);
  if (!match) return null;
  return {
    version: normalized,
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
    prerelease: match[4] || '',
  };
}

function comparePrereleaseIdentifiers(left, right) {
  const leftNumeric = /^\d+$/.test(left);
  const rightNumeric = /^\d+$/.test(right);
  if (leftNumeric && rightNumeric) return Number(left) - Number(right);
  if (leftNumeric) return -1;
  if (rightNumeric) return 1;
  return left.localeCompare(right);
}

/** Semver order: negative when `leftValue` is older, positive when newer, 0 when equal. */
function compareVersions(leftValue, rightValue) {
  const left = parseVersionParts(leftValue);
  const right = parseVersionParts(rightValue);
  if (!left && !right) return 0;
  if (!left) return -1;
  if (!right) return 1;

  for (const key of ['major', 'minor', 'patch']) {
    if (left[key] !== right[key]) return left[key] - right[key];
  }

  if (!left.prerelease && !right.prerelease) return 0;
  if (!left.prerelease) return 1;
  if (!right.prerelease) return -1;

  const leftParts = left.prerelease.split('.');
  const rightParts = right.prerelease.split('.');
  const max = Math.max(leftParts.length, rightParts.length);
  for (let index = 0; index < max; index += 1) {
    if (leftParts[index] === undefined) return -1;
    if (rightParts[index] === undefined) return 1;
    const compared = comparePrereleaseIdentifiers(leftParts[index], rightParts[index]);
    if (compared !== 0) return compared;
  }
  return 0;
}

function isPrereleaseVersion(value) {
  return !!parseVersionParts(value)?.prerelease;
}

const releaseVersion = (release) => normalizeVersion(release?.tag_name || release?.name || '');

/**
 * The newest published release that is newer than `currentVersion`, or null. Drafts never count,
 * and betas only when `allowPrerelease` is on, so a stable user is never moved to a beta.
 */
function selectNewestRelease(releases, { allowPrerelease, currentVersion }) {
  const current = normalizeVersion(currentVersion);
  return (
    (Array.isArray(releases) ? releases : [])
      .filter((release) => release && !release.draft)
      .filter((release) => allowPrerelease || !release.prerelease)
      .filter((release) => {
        const version = releaseVersion(release);
        if (!version) return false;
        return !current || compareVersions(version, current) > 0;
      })
      .sort((left, right) => compareVersions(releaseVersion(right), releaseVersion(left)))[0] ||
    null
  );
}

/** The GitHub API address to ask: every recent release for betas, otherwise only the latest. */
function releasesApiUrl(allowPrerelease) {
  return allowPrerelease
    ? `https://api.github.com/repos/${RELEASES_REPO}/releases?per_page=20`
    : `https://api.github.com/repos/${RELEASES_REPO}/releases/latest`;
}

/**
 * @param {Object} options
 * @param {(url: string) => Promise<unknown>} options.fetchJson - GETs a GitHub API address and
 *   resolves to its parsed body, rejecting on a network error or a non-2xx status.
 * @param {() => string} options.getCurrentVersion - The running app's version.
 * @param {(requested?: boolean) => boolean} options.resolveAllowPrerelease - The channel to look
 *   in: the one asked for, or the saved setting.
 * @param {(key: string, vars?: Object) => string} options.t - Translates a message for the person.
 * @param {{warn: Function}} options.log
 * @param {string} [options.homepage] - The repository page, for a release with no page of its own.
 * @param {() => string} [options.getArch] - The CPU architecture, to pick the portable download.
 */
function createReleaseChecker({
  fetchJson,
  getCurrentVersion,
  resolveAllowPrerelease,
  t,
  log,
  homepage = '',
  getArch = () => 'x64',
}) {
  async function fetchUpdateRelease({ allowPrerelease: requested } = {}) {
    const allowPrerelease = resolveAllowPrerelease(requested);
    try {
      const data = await fetchJson(releasesApiUrl(allowPrerelease));
      const releases = Array.isArray(data) ? data : [data];
      return selectNewestRelease(releases, {
        allowPrerelease,
        currentVersion: getCurrentVersion(),
      });
    } catch (error) {
      throw new Error(error?.message || String(error));
    }
  }

  // electron-updater errors carry full HTTP headers and stack traces; the settings pane should
  // only ever show a short human-readable summary while the log keeps the raw detail.
  function describeUpdateError(error) {
    const raw = (error?.message || String(error ?? '')).trim();
    log.warn('Update check failed:', raw);
    if (/404|cannot find .* in the latest release/i.test(raw)) {
      return t('Update information is not available for this version yet. Try again later.');
    }
    if (
      /enotfound|econnrefused|econnreset|etimedout|eai_again|net::err|socket hang up|internetdisconnected/i.test(
        raw
      )
    ) {
      return t('Could not reach GitHub to check for updates. Check your internet connection.');
    }
    if (/sha512|checksum|corrupt/i.test(raw)) {
      return t('The downloaded update appears to be corrupted. Please try checking again.');
    }
    const firstLine = raw.split('\n', 1)[0].trim();
    if (!firstLine) return t('Unknown error');
    return firstLine.length > 160 ? `${firstLine.slice(0, 157)}…` : firstLine;
  }

  // The window words 'manual' and 'portable' answers (src/update-status.js), so the line follows
  // a later language change.
  async function checkManualReleaseUpdate({ allowPrerelease } = {}) {
    try {
      const release = await fetchUpdateRelease({ allowPrerelease });
      if (!release) {
        return { status: 'none', message: t('You are up to date!') };
      }
      const latestVersion = releaseVersion(release);
      const downloadUrl =
        release.html_url ||
        (homepage && release.tag_name
          ? `${homepage}/releases/tag/${encodeURIComponent(release.tag_name)}`
          : homepage
            ? `${homepage}/releases`
            : '');
      if (!latestVersion) {
        return {
          status: 'error',
          error: t('Unable to determine the latest release version.'),
          downloadUrl,
        };
      }
      return { status: 'manual', version: latestVersion, downloadUrl };
    } catch (error) {
      return { status: 'error', error: describeUpdateError(error) };
    }
  }

  async function checkPortableUpdate({ allowPrerelease } = {}) {
    try {
      const release = await fetchUpdateRelease({ allowPrerelease });
      if (!release) {
        return { status: 'none', message: t('You are up to date!') };
      }
      const assets = Array.isArray(release.assets) ? release.assets : [];
      const archToken = `win-${getArch() || 'x64'}`;
      const assetName = (asset) => String(asset?.name || '').toLowerCase();
      const portableAsset =
        assets.find(
          (asset) => assetName(asset).includes('portable') && assetName(asset).includes(archToken)
        ) || assets.find((asset) => assetName(asset).includes('portable'));

      const latestVersion = releaseVersion(release);
      const currentVersion = normalizeVersion(getCurrentVersion());
      const downloadUrl = portableAsset?.browser_download_url || release.html_url || '';
      if (!latestVersion) {
        return {
          status: 'error',
          error: t('Unable to determine the latest Portable release version.'),
          downloadUrl,
        };
      }

      if (currentVersion && compareVersions(latestVersion, currentVersion) <= 0) {
        return { status: 'none', message: t('You are up to date!') };
      }

      return {
        status: 'portable',
        version: latestVersion,
        prerelease: isPrereleaseVersion(latestVersion),
        downloadUrl,
      };
    } catch (error) {
      return { status: 'error', error: describeUpdateError(error) };
    }
  }

  return { fetchUpdateRelease, describeUpdateError, checkManualReleaseUpdate, checkPortableUpdate };
}

module.exports = {
  compareVersions,
  createReleaseChecker,
  isPrereleaseVersion,
  normalizeVersion,
  releasesApiUrl,
  selectNewestRelease,
};

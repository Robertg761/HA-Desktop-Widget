/* global AbortSignal, Buffer */
'use strict';

/**
 * Checks that a downloaded update is one this project released.
 *
 * The installers are not code-signed, and electron-updater only compares the download with a hash
 * that sits in the same GitHub release, so replacing both files would go unnoticed. Each release
 * therefore also carries SHA256SUMS, the hash of every file in it, and SHA256SUMS.sig, an Ed25519
 * signature of that list made by the release workflow. The app holds the public key and installs
 * a download only when its hash is in a list that the key signed.
 *
 * scripts/sign-release-checksums.cjs writes the two files and uses this module to check them.
 */

const nodeCrypto = require('crypto');
const fs = require('fs');

const CHECKSUMS_FILE_NAME = 'SHA256SUMS';
const SIGNATURE_FILE_NAME = 'SHA256SUMS.sig';
const MAX_CHECKSUMS_BYTES = 256 * 1024;
// The release workflow gives every file this prefix (see "Publish GitHub release").
const RELEASE_FILE_PREFIX = 'HA-Desktop-Widget-';
const RELEASE_DOWNLOAD_BASE_URL =
  'https://github.com/Robertg761/HA-Desktop-Widget/releases/download';

/**
 * Ed25519 public keys (SPKI, DER, base64) that may sign a release. To change the key, add the new
 * one here and release with the old key still signing; switch the signing key only once that
 * release has reached people, and remove the old key a release later.
 */
const UPDATE_PUBLIC_KEYS = ['MCowBQYDK2VwAyEA7xOljy2UuiCsR8FBOMfKtGTkcPbrINsdiAG9LKhw+JY='];

class UpdateVerificationError extends Error {
  /**
   * @param {string} message
   * @param {'unavailable'|'rejected'} kind - 'unavailable' when the signed list could not be
   *   fetched, so the download may be fine and is kept for a later try; 'rejected' when the list
   *   or the download failed a check.
   */
  constructor(message, kind) {
    super(message);
    this.name = 'UpdateVerificationError';
    this.kind = kind;
  }
}

function isSignedBy(publicKeyBase64, content, signature) {
  try {
    const publicKey = nodeCrypto.createPublicKey({
      key: Buffer.from(publicKeyBase64, 'base64'),
      format: 'der',
      type: 'spki',
    });
    return nodeCrypto.verify(null, content, publicKey, signature);
  } catch {
    return false;
  }
}

/** Whether `signatureBase64` is a signature of exactly `checksumsText` by one of the keys. */
function verifyChecksumsSignature(checksumsText, signatureBase64, publicKeys = UPDATE_PUBLIC_KEYS) {
  if (typeof checksumsText !== 'string' || typeof signatureBase64 !== 'string') return false;
  const signature = Buffer.from(signatureBase64.trim(), 'base64');
  if (signature.length !== 64) return false;
  const content = Buffer.from(checksumsText, 'utf8');
  return publicKeys.some((key) => isSignedBy(key, content, signature));
}

/** Parses `sha256sum` output into [{hash, name}], ignoring anything that is not such a line. */
function parseChecksums(checksumsText) {
  const entries = [];
  for (const line of String(checksumsText).split('\n')) {
    const match = /^([0-9a-f]{64}) [ *](.+)$/.exec(line.trimEnd());
    if (match) entries.push({ hash: match[1], name: match[2] });
  }
  return entries;
}

/**
 * Whether a release file name is for exactly this version. The self-updating packages are named
 * "HA-Desktop-Widget-<version>-<win|linux>-...", so 4.3.0 matches
 * "HA-Desktop-Widget-4.3.0-linux-x86_64.AppImage" and not a file of 4.3.0-beta.2 or 14.3.0.
 */
function fileNameIsForVersion(name, version) {
  return ['win', 'linux', 'mac'].some((platform) =>
    name.startsWith(`${RELEASE_FILE_PREFIX}${version}-${platform}-`)
  );
}

function hashFile(filePath) {
  return new Promise((resolve, reject) => {
    const hash = nodeCrypto.createHash('sha256');
    fs.createReadStream(filePath)
      .on('error', reject)
      .on('data', (chunk) => hash.update(chunk))
      .on('end', () => resolve(hash.digest('hex')));
  });
}

function isVersionString(version) {
  return typeof version === 'string' && /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.]+)?$/.test(version);
}

/**
 * Checks a signed list against a file hash. Throws UpdateVerificationError('rejected') unless
 * the list is signed and names a file of this version with this hash.
 */
function assertChecksumsCoverFile({
  checksumsText,
  signatureBase64,
  fileHash,
  version,
  publicKeys = UPDATE_PUBLIC_KEYS,
}) {
  if (!verifyChecksumsSignature(checksumsText, signatureBase64, publicKeys)) {
    throw new UpdateVerificationError('The release checksum list is not signed', 'rejected');
  }
  // The version is part of what is checked: a signed installer of an older release, offered
  // again under a newer version number, must not pass.
  const covered = parseChecksums(checksumsText).some(
    (entry) => entry.hash === fileHash && fileNameIsForVersion(entry.name, version)
  );
  if (!covered) {
    throw new UpdateVerificationError(
      `The download is not a file of release ${version} in the signed checksum list`,
      'rejected'
    );
  }
}

async function fetchReleaseText(fetchImpl, url, timeoutMs) {
  let response;
  try {
    response = await fetchImpl(url, { signal: AbortSignal.timeout(timeoutMs) });
  } catch (error) {
    throw new UpdateVerificationError(
      `Could not fetch ${url}: ${error?.message || error}`,
      'unavailable'
    );
  }
  if (!response.ok) {
    throw new UpdateVerificationError(
      `Could not fetch ${url}: status ${response.status}`,
      'unavailable'
    );
  }
  const text = await response.text();
  if (text.length > MAX_CHECKSUMS_BYTES) {
    throw new UpdateVerificationError(`${url} is too large`, 'rejected');
  }
  return text;
}

/**
 * Verifies a downloaded update file against its release's signed checksum list.
 * Resolves when the file may be installed and rejects with UpdateVerificationError otherwise.
 *
 * @param {Object} options
 * @param {string} options.filePath - The downloaded installer or AppImage.
 * @param {string} options.version - The version the updater says it is.
 * @param {Function} options.fetchImpl - fetch, e.g. Electron's net.fetch.
 */
async function verifyDownloadedUpdate({
  filePath,
  version,
  fetchImpl,
  publicKeys = UPDATE_PUBLIC_KEYS,
  baseUrl = RELEASE_DOWNLOAD_BASE_URL,
  timeoutMs = 20000,
}) {
  if (!isVersionString(version) || typeof filePath !== 'string' || !filePath) {
    throw new UpdateVerificationError('The update has no usable version or file', 'rejected');
  }
  const releaseUrl = `${baseUrl}/v${version}`;
  const [checksumsText, signatureBase64] = await Promise.all([
    fetchReleaseText(fetchImpl, `${releaseUrl}/${CHECKSUMS_FILE_NAME}`, timeoutMs),
    fetchReleaseText(fetchImpl, `${releaseUrl}/${SIGNATURE_FILE_NAME}`, timeoutMs),
  ]);
  let fileHash;
  try {
    fileHash = await hashFile(filePath);
  } catch (error) {
    throw new UpdateVerificationError(
      `Could not read the downloaded update: ${error?.message || error}`,
      'rejected'
    );
  }
  assertChecksumsCoverFile({ checksumsText, signatureBase64, fileHash, version, publicKeys });
}

module.exports = {
  CHECKSUMS_FILE_NAME,
  SIGNATURE_FILE_NAME,
  UPDATE_PUBLIC_KEYS,
  UpdateVerificationError,
  assertChecksumsCoverFile,
  fileNameIsForVersion,
  hashFile,
  parseChecksums,
  verifyChecksumsSignature,
  verifyDownloadedUpdate,
};

#!/usr/bin/env node
'use strict';

/**
 * Writes SHA256SUMS and SHA256SUMS.sig for the files of a release.
 *
 *   UPDATE_SIGNING_KEY=<Ed25519 private key, PEM> node scripts/sign-release-checksums.cjs <dir>
 *
 * SHA256SUMS lists every file directly inside <dir> in `sha256sum` format, so anyone can check a
 * download with `sha256sum -c`. SHA256SUMS.sig is the signature the app checks before it installs
 * an update (src/update-signature.cjs). The result is verified against the public keys built into
 * the app before anything is left on disk: a release signed with a key the app does not know
 * would stop every installed copy from updating.
 */

const nodeCrypto = require('crypto');
const fs = require('fs');
const path = require('path');
const {
  CHECKSUMS_FILE_NAME,
  SIGNATURE_FILE_NAME,
  verifyChecksumsSignature,
} = require('../src/update-signature.cjs');

function buildChecksums(directory) {
  const names = fs
    .readdirSync(directory, { withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => entry.name)
    .filter((name) => name !== CHECKSUMS_FILE_NAME && name !== SIGNATURE_FILE_NAME)
    .sort();
  if (names.length === 0) throw new Error(`No files to sign in ${directory}`);
  return names
    .map((name) => {
      if (/[\r\n]/.test(name)) throw new Error('A release file name contains a line break');
      const hash = nodeCrypto
        .createHash('sha256')
        .update(fs.readFileSync(path.join(directory, name)))
        .digest('hex');
      return `${hash}  ${name}\n`;
    })
    .join('');
}

function signReleaseChecksums(directory, privateKeyPem) {
  if (typeof privateKeyPem !== 'string' || !privateKeyPem.trim()) {
    throw new Error('UPDATE_SIGNING_KEY is not set, so the release cannot be signed');
  }
  const privateKey = nodeCrypto.createPrivateKey(privateKeyPem);
  if (privateKey.asymmetricKeyType !== 'ed25519') {
    throw new Error('UPDATE_SIGNING_KEY must be an Ed25519 private key');
  }
  const checksums = buildChecksums(directory);
  const signature = nodeCrypto.sign(null, Buffer.from(checksums, 'utf8'), privateKey);
  const signatureText = `${signature.toString('base64')}\n`;
  if (!verifyChecksumsSignature(checksums, signatureText)) {
    throw new Error(
      'The signing key does not match a public key in src/update-signature.cjs; ' +
        'installed copies would refuse this release'
    );
  }
  fs.writeFileSync(path.join(directory, CHECKSUMS_FILE_NAME), checksums);
  fs.writeFileSync(path.join(directory, SIGNATURE_FILE_NAME), signatureText);
  return { checksums, signature: signatureText };
}

if (require.main === module) {
  const directory = process.argv[2];
  if (!directory) {
    console.error('Usage: node scripts/sign-release-checksums.cjs <directory>');
    process.exit(2);
  }
  try {
    const { checksums } = signReleaseChecksums(directory, process.env.UPDATE_SIGNING_KEY);
    process.stdout.write(checksums);
  } catch (error) {
    console.error(error.message);
    process.exit(1);
  }
}

module.exports = { buildChecksums, signReleaseChecksums };

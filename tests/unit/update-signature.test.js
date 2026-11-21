/** @jest-environment node */
const nodeCrypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const {
  UPDATE_PUBLIC_KEYS,
  fileNameIsForVersion,
  parseChecksums,
  verifyChecksumsSignature,
  verifyDownloadedUpdate,
} = require('../../src/update-signature.cjs');
const { signReleaseChecksums } = require('../../scripts/sign-release-checksums.cjs');

const APPIMAGE = 'HA-Desktop-Widget-4.3.0-linux-x86_64.AppImage';
const SETUP = 'HA-Desktop-Widget-4.3.0-win-x64-Setup.exe';

function createKey() {
  const { publicKey, privateKey } = nodeCrypto.generateKeyPairSync('ed25519');
  return {
    publicKeys: [publicKey.export({ type: 'spki', format: 'der' }).toString('base64')],
    privateKey,
  };
}

function sign(text, privateKey) {
  return nodeCrypto.sign(null, Buffer.from(text, 'utf8'), privateKey).toString('base64');
}

const sha256 = (content) => nodeCrypto.createHash('sha256').update(content).digest('hex');

describe('release checksum signatures', () => {
  let directory;
  beforeEach(() => {
    directory = fs.mkdtempSync(path.join(os.tmpdir(), 'ha-widget-update-'));
  });
  afterEach(() => {
    fs.rmSync(directory, { recursive: true, force: true });
  });

  /** A release with one AppImage, served by a fake fetch, and that AppImage downloaded. */
  function createRelease({ content = 'the real AppImage', listedName = APPIMAGE } = {}) {
    const key = createKey();
    const checksums = `${sha256(content)}  ${listedName}\n${sha256('setup')}  ${SETUP}\n`;
    const files = {
      SHA256SUMS: checksums,
      'SHA256SUMS.sig': `${sign(checksums, key.privateKey)}\n`,
    };
    const filePath = path.join(directory, 'downloaded');
    fs.writeFileSync(filePath, content);
    const requested = [];
    const fetchImpl = async (url) => {
      requested.push(url);
      const name = url.split('/').pop();
      return name in files
        ? { ok: true, status: 200, text: async () => files[name] }
        : { ok: false, status: 404, text: async () => '' };
    };
    return { key, files, filePath, fetchImpl, requested };
  }

  const verify = (release, overrides = {}) =>
    verifyDownloadedUpdate({
      filePath: release.filePath,
      version: '4.3.0',
      fetchImpl: release.fetchImpl,
      publicKeys: release.key.publicKeys,
      ...overrides,
    });

  test('accepts a download whose hash is in the signed list of its own release', async () => {
    const release = createRelease();
    await expect(verify(release)).resolves.toBe(sha256('the real AppImage'));
    expect(release.requested.sort()).toEqual([
      'https://github.com/Robertg761/HA-Desktop-Widget/releases/download/v4.3.0/SHA256SUMS',
      'https://github.com/Robertg761/HA-Desktop-Widget/releases/download/v4.3.0/SHA256SUMS.sig',
    ]);
  });

  test('rejects a download that was replaced, with or without a matching unsigned list', async () => {
    const release = createRelease();
    fs.writeFileSync(release.filePath, 'something else');
    await expect(verify(release)).rejects.toMatchObject({ kind: 'rejected' });

    // The attacker rewrites the list as well, but cannot sign it.
    release.files.SHA256SUMS = `${sha256('something else')}  ${APPIMAGE}\n`;
    await expect(verify(release)).rejects.toMatchObject({ kind: 'rejected' });
  });

  test('rejects a list signed with another key', async () => {
    const release = createRelease();
    await expect(verify(release, { publicKeys: createKey().publicKeys })).rejects.toMatchObject({
      kind: 'rejected',
    });
    await expect(verify(release, { publicKeys: [] })).rejects.toMatchObject({ kind: 'rejected' });
  });

  test('rejects a genuine older installer offered under a newer version number', async () => {
    // Signed list and file of 4.2.0, republished as the files of "4.3.0".
    const release = createRelease({ listedName: 'HA-Desktop-Widget-4.2.0-linux-x86_64.AppImage' });
    await expect(verify(release)).rejects.toMatchObject({ kind: 'rejected' });
  });

  test('reports a missing list as unavailable, not as a bad download', async () => {
    const release = createRelease();
    delete release.files['SHA256SUMS.sig'];
    await expect(verify(release)).rejects.toMatchObject({ kind: 'unavailable' });

    const offline = async () => {
      throw new Error('ENOTFOUND');
    };
    await expect(verify(release, { fetchImpl: offline })).rejects.toMatchObject({
      kind: 'unavailable',
    });
  });

  test('rejects a version that is not a version before asking the network', async () => {
    const release = createRelease();
    for (const version of ['', '../../x', '4.3', undefined, '4.3.0/../../v4.2.0']) {
      await expect(verify(release, { version })).rejects.toMatchObject({ kind: 'rejected' });
    }
    expect(release.requested).toEqual([]);
  });

  test('accepts every version form the release workflow tags', async () => {
    // release.yml publishes v<major>.<minor>.<patch> with an optional -/+ suffix that may itself
    // hold hyphens; the app must not refuse a release the workflow let out.
    for (const version of ['4.3.0-rc-1', '4.3.0-beta.2', '4.3.0+build.7']) {
      const release = createRelease({
        listedName: `HA-Desktop-Widget-${version}-linux-x86_64.AppImage`,
      });
      await expect(verify(release, { version })).resolves.toBe(sha256('the real AppImage'));
    }
  });

  test('matches a file name to exactly one version', () => {
    expect(fileNameIsForVersion(APPIMAGE, '4.3.0')).toBe(true);
    expect(fileNameIsForVersion(SETUP, '4.3.0')).toBe(true);
    expect(
      fileNameIsForVersion('HA-Desktop-Widget-4.3.0-beta.2-win-x64-Setup.exe', '4.3.0-beta.2')
    ).toBe(true);
    expect(fileNameIsForVersion('HA-Desktop-Widget-4.3.0-beta.2-win-x64-Setup.exe', '4.3.0')).toBe(
      false
    );
    expect(
      fileNameIsForVersion('HA-Desktop-Widget-4.3.0-beta.12-win-x64-Setup.exe', '4.3.0-beta.1')
    ).toBe(false);
    expect(fileNameIsForVersion('HA-Desktop-Widget-14.3.0-win-x64-Setup.exe', '4.3.0')).toBe(false);
    expect(fileNameIsForVersion('latest.yml', '4.3.0')).toBe(false);
  });

  test('reads sha256sum lines and nothing else', () => {
    const hash = 'a'.repeat(64);
    expect(parseChecksums(`${hash}  one.exe\n${hash} *two.zip\nnot a line\n${hash}\n`)).toEqual([
      { hash, name: 'one.exe' },
      { hash, name: 'two.zip' },
    ]);
  });

  test('a signature is over the exact bytes of the list', () => {
    const { publicKeys, privateKey } = createKey();
    const signature = sign('abc\n', privateKey);
    expect(verifyChecksumsSignature('abc\n', signature, publicKeys)).toBe(true);
    expect(verifyChecksumsSignature('abc', signature, publicKeys)).toBe(false);
    expect(verifyChecksumsSignature('abc\n', 'not base64 of 64 bytes', publicKeys)).toBe(false);
    expect(verifyChecksumsSignature('abc\n', signature, ['not a key'])).toBe(false);
  });

  test('the app is built with at least one well-formed public key', () => {
    expect(UPDATE_PUBLIC_KEYS.length).toBeGreaterThan(0);
    for (const key of UPDATE_PUBLIC_KEYS) {
      const parsed = nodeCrypto.createPublicKey({
        key: Buffer.from(key, 'base64'),
        format: 'der',
        type: 'spki',
      });
      expect(parsed.asymmetricKeyType).toBe('ed25519');
    }
  });

  describe('the release signing script', () => {
    test('refuses to sign with a key the app does not know, and leaves nothing behind', () => {
      fs.writeFileSync(path.join(directory, APPIMAGE), 'app');
      const stranger = createKey().privateKey.export({ type: 'pkcs8', format: 'pem' });
      expect(() => signReleaseChecksums(directory, stranger)).toThrow(/does not match/);
      expect(() => signReleaseChecksums(directory, '')).toThrow(/UPDATE_SIGNING_KEY/);
      expect(fs.readdirSync(directory)).toEqual([APPIMAGE]);
    });

    test('lists every release file in sha256sum format', () => {
      const { buildChecksums } = require('../../scripts/sign-release-checksums.cjs');
      fs.writeFileSync(path.join(directory, SETUP), 'setup');
      fs.writeFileSync(path.join(directory, APPIMAGE), 'app');
      fs.writeFileSync(path.join(directory, 'SHA256SUMS'), 'stale');
      fs.mkdirSync(path.join(directory, 'folder'));
      expect(buildChecksums(directory)).toBe(
        `${sha256('app')}  ${APPIMAGE}\n${sha256('setup')}  ${SETUP}\n`
      );
    });
  });
});

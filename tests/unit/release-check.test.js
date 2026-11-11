/**
 * @jest-environment node
 */

// Finding a newer release for the builds that cannot update themselves (src/release-check.cjs).

const {
  compareVersions,
  createReleaseChecker,
  isPrereleaseVersion,
  normalizeVersion,
  releasesApiUrl,
  selectNewestRelease,
} = require('../../src/release-check.cjs');

const RELEASE = (tag, extra = {}) => ({
  tag_name: tag,
  draft: false,
  prerelease: /-/.test(tag),
  html_url: `https://example.test/releases/${tag}`,
  ...extra,
});

function checker({
  data = null,
  fetchError = null,
  appVersion = '4.0.0',
  savedPrerelease = false,
  t = jest.fn((key) => key),
  arch = 'x64',
  homepage = 'https://example.test/app',
} = {}) {
  const fetchJson = jest.fn(async () => {
    if (fetchError) throw fetchError;
    return data;
  });
  const log = { warn: jest.fn() };
  const instance = createReleaseChecker({
    fetchJson,
    getCurrentVersion: () => appVersion,
    resolveAllowPrerelease: (requested) =>
      typeof requested === 'boolean' ? requested : savedPrerelease,
    t,
    log,
    homepage,
    getArch: () => arch,
  });
  return { ...instance, fetchJson, log, t };
}

describe('version arithmetic', () => {
  it.each([
    ['4.1.0', '4.0.9', 1],
    ['v4.1.0', '4.1.0', 0],
    ['4.1.0', '4.1.0-beta.2', 1],
    ['4.1.0-beta.10', '4.1.0-beta.2', 1],
    ['4.1.0-beta.1', '4.1.0-rc.1', -1],
    ['4.1.0-beta', '4.1.0-beta.1', -1],
    ['4.1.0-1', '4.1.0-beta', -1],
    ['nonsense', '4.0.0', -1],
    ['4.0.0', 'nonsense', 1],
    ['nonsense', 'other', 0],
  ])('%s against %s', (left, right, sign) => {
    expect(Math.sign(compareVersions(left, right))).toBe(sign);
  });

  it('normalizes tags and spots betas', () => {
    expect(normalizeVersion(' V4.1.0 ')).toBe('4.1.0');
    expect(normalizeVersion(null)).toBe('');
    expect(isPrereleaseVersion('4.1.0-beta.1')).toBe(true);
    expect(isPrereleaseVersion('4.1.0')).toBe(false);
    expect(isPrereleaseVersion('latest')).toBe(false);
  });
});

describe('choosing the release to offer', () => {
  const releases = [
    RELEASE('v4.0.0'),
    RELEASE('v4.2.0-beta.1'),
    RELEASE('v4.1.0'),
    RELEASE('v4.3.0', { draft: true }),
    RELEASE('not-a-version'),
    null,
  ];

  it('offers the newest stable release to a stable user, never a draft or a beta', () => {
    expect(
      selectNewestRelease(releases, { allowPrerelease: false, currentVersion: '4.0.0' }).tag_name
    ).toBe('v4.1.0');
  });

  it('offers a newer beta to someone who asked for betas', () => {
    expect(
      selectNewestRelease(releases, { allowPrerelease: true, currentVersion: '4.0.0' }).tag_name
    ).toBe('v4.2.0-beta.1');
  });

  it('offers nothing when the running version is the newest', () => {
    expect(selectNewestRelease(releases, { allowPrerelease: true, currentVersion: '4.2.0' })).toBe(
      null
    );
    expect(selectNewestRelease('garbage', { allowPrerelease: true, currentVersion: '' })).toBe(
      null
    );
  });

  it('asks GitHub for the whole list only on the beta channel', () => {
    expect(releasesApiUrl(true)).toMatch(/\/releases\?per_page=20$/);
    expect(releasesApiUrl(false)).toMatch(/\/releases\/latest$/);
  });

  it('looks in the channel asked for, else the saved one', async () => {
    const saved = checker({ data: [RELEASE('v4.1.0-beta.1')], savedPrerelease: true });
    expect((await saved.fetchUpdateRelease()).tag_name).toBe('v4.1.0-beta.1');
    expect(saved.fetchJson).toHaveBeenCalledWith(releasesApiUrl(true));

    const asked = checker({ data: RELEASE('v4.1.0'), savedPrerelease: true });
    expect((await asked.fetchUpdateRelease({ allowPrerelease: false })).tag_name).toBe('v4.1.0');
    expect(asked.fetchJson).toHaveBeenCalledWith(releasesApiUrl(false));
  });
});

// The window words the line (src/update-status.js) when it draws it, so it follows a language
// change made after the check. A sentence translated here stayed in the old language beside a
// button that had already changed.
describe('the update status of a package that cannot update itself (macOS, deb, Arch)', () => {
  it('says an update exists with its version and link, and leaves the wording to the window', async () => {
    const { checkManualReleaseUpdate, t } = checker({ data: RELEASE('v4.0.1') });

    expect(await checkManualReleaseUpdate()).toEqual({
      status: 'manual',
      version: '4.0.1',
      downloadUrl: 'https://example.test/releases/v4.0.1',
    });
    expect(t).not.toHaveBeenCalled();
  });

  it('links the release page on the repository when GitHub gives none', async () => {
    const { checkManualReleaseUpdate } = checker({ data: RELEASE('v4.0.1', { html_url: '' }) });
    expect((await checkManualReleaseUpdate()).downloadUrl).toBe(
      'https://example.test/app/releases/tag/v4.0.1'
    );
  });

  it('is up to date when there is no newer release', async () => {
    const { checkManualReleaseUpdate } = checker({ data: RELEASE('v4.0.0') });
    expect(await checkManualReleaseUpdate()).toEqual({
      status: 'none',
      message: 'You are up to date!',
    });
  });

  it('turns a failed request into a short error', async () => {
    const { checkManualReleaseUpdate, log } = checker({
      fetchError: new Error('getaddrinfo ENOTFOUND api.github.com'),
    });
    expect(await checkManualReleaseUpdate()).toEqual({
      status: 'error',
      error: 'Could not reach GitHub to check for updates. Check your internet connection.',
    });
    expect(log.warn).toHaveBeenCalled();
  });
});

describe('the update status of the Windows portable build', () => {
  const asset = {
    name: 'HA Desktop Widget-4.0.1-win-x64-Portable.exe',
    browser_download_url: 'https://example.test/Portable.exe',
  };

  it('says which version is out and whether it is a beta, with no sentence of its own', async () => {
    const stable = checker({ data: RELEASE('v4.0.1', { assets: [asset] }) });
    expect(await stable.checkPortableUpdate()).toEqual({
      status: 'portable',
      version: '4.0.1',
      prerelease: false,
      downloadUrl: 'https://example.test/Portable.exe',
    });
    expect(stable.t).not.toHaveBeenCalled();

    const beta = checker({
      data: [RELEASE('v4.1.0-beta.1', { assets: [asset] })],
      savedPrerelease: true,
    });
    expect((await beta.checkPortableUpdate()).prerelease).toBe(true);
  });

  it('prefers the download for this CPU and falls back to any portable one', async () => {
    const arm = {
      name: 'HA Desktop Widget-4.0.1-win-arm64-Portable.exe',
      browser_download_url: 'https://example.test/arm64.exe',
    };
    const onArm = checker({ data: RELEASE('v4.0.1', { assets: [asset, arm] }), arch: 'arm64' });
    expect((await onArm.checkPortableUpdate()).downloadUrl).toBe('https://example.test/arm64.exe');

    const onIa32 = checker({ data: RELEASE('v4.0.1', { assets: [arm] }), arch: 'ia32' });
    expect((await onIa32.checkPortableUpdate()).downloadUrl).toBe('https://example.test/arm64.exe');

    const noAssets = checker({ data: RELEASE('v4.0.1') });
    expect((await noAssets.checkPortableUpdate()).downloadUrl).toBe(
      'https://example.test/releases/v4.0.1'
    );
  });

  it('is up to date when there is no newer release, and an error when the request fails', async () => {
    expect((await checker({ data: [] }).checkPortableUpdate()).status).toBe('none');
    expect(await checker({ fetchError: new Error('status 404') }).checkPortableUpdate()).toEqual({
      status: 'error',
      error: 'Update information is not available for this version yet. Try again later.',
    });
  });
});

describe('describing an update error', () => {
  const describe_ = (error) => checker().describeUpdateError(error);

  it('names the common failures in words a person can act on', () => {
    expect(describe_(new Error('sha512 checksum mismatch'))).toBe(
      'The downloaded update appears to be corrupted. Please try checking again.'
    );
    expect(describe_(new Error('net::ERR_INTERNET_DISCONNECTED'))).toBe(
      'Could not reach GitHub to check for updates. Check your internet connection.'
    );
  });

  it('keeps only the first line of anything else, cut to fit', () => {
    expect(describe_(new Error('Something odd\n    at stack frame'))).toBe('Something odd');
    const long = describe_(new Error('x'.repeat(300)));
    expect(long).toHaveLength(158);
    expect(long.endsWith('…')).toBe(true);
    expect(describe_(undefined)).toBe('Unknown error');
    expect(describe_('   ')).toBe('Unknown error');
  });
});

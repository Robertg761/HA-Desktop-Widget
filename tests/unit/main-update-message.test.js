const fs = require('fs');
const path = require('path');
const vm = require('vm');

const mainSource = fs.readFileSync(path.resolve(__dirname, '../../main.js'), 'utf8');

function functionSource(name) {
  const start = mainSource.indexOf(`async function ${name}`);
  return mainSource.slice(start, mainSource.indexOf('\n}\n', start) + 3);
}

function run(name, { release, mainT = jest.fn((key) => key), appVersion = '4.0.0' }) {
  const context = {
    fetchGitHubUpdateRelease: jest.fn(async () => release),
    normalizeVersion: (value) => String(value || '').replace(/^v/, ''),
    compareVersions: (a, b) => a.localeCompare(b, 'en', { numeric: true }),
    isPrereleaseVersion: (value) => String(value).includes('-'),
    describeUpdateError: (error) => error.message,
    pkg: { homepage: 'https://example.test/app' },
    app: { getVersion: () => appVersion },
    process: { arch: 'x64' },
    encodeURIComponent,
    mainT,
  };
  vm.runInNewContext(functionSource(name), context);
  return vm.runInNewContext(`${name}()`, context);
}

// The window words the line (src/update-status.js) when it draws it, so it follows a language
// change made after the check. A sentence translated here stayed in the old language beside a
// button that had already changed.
describe('the update status of a package that cannot update itself (macOS, deb, Arch)', () => {
  it('says an update exists with its version and link, and leaves the wording to the window', async () => {
    const mainT = jest.fn((key) => key);

    const result = await run('checkManualReleaseUpdate', {
      release: { tag_name: 'v4.0.1', html_url: 'https://example.test/releases/v4.0.1' },
      mainT,
    });

    expect(result).toEqual({
      status: 'manual',
      version: '4.0.1',
      downloadUrl: 'https://example.test/releases/v4.0.1',
    });
    expect(mainT).not.toHaveBeenCalled();
  });

  it('is up to date when there is no newer release', async () => {
    const result = await run('checkManualReleaseUpdate', { release: null });

    expect(result).toEqual({ status: 'none', message: 'You are up to date!' });
  });
});

describe('the update status of the Windows portable build', () => {
  const asset = {
    name: 'HA Desktop Widget-4.0.1-win-x64-Portable.exe',
    browser_download_url: 'https://example.test/Portable.exe',
  };

  it('says which version is out and whether it is a beta, with no sentence of its own', async () => {
    const mainT = jest.fn((key) => key);

    expect(
      await run('checkPortableUpdate', { release: { tag_name: 'v4.0.1', assets: [asset] }, mainT })
    ).toEqual({
      status: 'portable',
      version: '4.0.1',
      prerelease: false,
      downloadUrl: 'https://example.test/Portable.exe',
    });
    expect(
      (
        await run('checkPortableUpdate', {
          release: { tag_name: 'v4.1.0-beta.1', assets: [asset] },
        })
      ).prerelease
    ).toBe(true);
    expect(mainT).not.toHaveBeenCalled();
  });
});

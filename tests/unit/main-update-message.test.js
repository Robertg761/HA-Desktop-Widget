const fs = require('fs');
const path = require('path');
const vm = require('vm');

const mainSource = fs.readFileSync(path.resolve(__dirname, '../../main.js'), 'utf8');
const start = mainSource.indexOf('async function checkManualReleaseUpdate');
const functionSource = mainSource.slice(start, mainSource.indexOf('\n}\n', start) + 3);

function check({ release, mainT }) {
  const context = {
    fetchGitHubUpdateRelease: jest.fn(async () => release),
    normalizeVersion: (value) => String(value || '').replace(/^v/, ''),
    describeUpdateError: (error) => error.message,
    pkg: { homepage: 'https://example.test/app' },
    encodeURIComponent,
    mainT,
  };
  vm.runInNewContext(functionSource, context);
  return vm.runInNewContext('checkManualReleaseUpdate()', context);
}

describe('the update status of a package that cannot update itself (macOS, deb, Arch)', () => {
  const translate = (templates) =>
    jest.fn((key, vars = {}) =>
      (templates[key] || key).replace(/\{\{(\w+)\}\}/g, (_match, name) => String(vars[name]))
    );

  it('says an update exists, with its version inside one translated sentence', async () => {
    const mainT = translate({});

    const result = await check({ release: { tag_name: 'v4.0.1' }, mainT });

    expect(result.status).toBe('manual');
    expect(result.message).toBe(
      'Update available: v4.0.1. This package cannot update itself; use Download Update to get it from GitHub.'
    );
    expect(result.version).toBe('4.0.1');
    expect(mainT).toHaveBeenCalledWith(
      expect.stringContaining('{{version}}'),
      expect.objectContaining({ version: '4.0.1' })
    );
  });

  it('lets a language put the version where its sentence wants it', async () => {
    const mainT = translate({
      'Update available: v{{version}}. This package cannot update itself; use Download Update to get it from GitHub.':
        'استخدم «تنزيل التحديث» للحصول على v{{version}}.',
    });

    const result = await check({ release: { tag_name: 'v4.0.1' }, mainT });

    // The version is not tacked on after the translation, where a right-to-left line would flip it.
    expect(result.message).toBe('استخدم «تنزيل التحديث» للحصول على v4.0.1.');
  });

  it('is up to date when there is no newer release', async () => {
    const result = await check({ release: null, mainT: translate({}) });

    expect(result).toEqual({ status: 'none', message: 'You are up to date!' });
  });
});

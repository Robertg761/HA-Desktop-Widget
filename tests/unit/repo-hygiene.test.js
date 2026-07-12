/**
 * @jest-environment node
 */

const {
  DEFAULT_MAX_TRACKED_FILE_BYTES,
  findRepoHygieneViolations,
} = require('../../scripts/check-repo-hygiene.cjs');

describe('repository hygiene guard', () => {
  it('rejects generated directories and packaged artifacts', () => {
    const files = [
      'dist/latest.yml',
      'dist-renderer/renderer.bundle.js',
      'release/App.exe',
      'release/AppImage.zip',
      'release/builder-debug.yml',
    ];

    const violations = findRepoHygieneViolations(files, { getSize: () => 10 });

    expect(violations).toHaveLength(files.length);
    expect(violations.every((message) => message.includes('generated build artifact'))).toBe(true);
  });

  it('rejects unexpectedly large tracked files', () => {
    const violations = findRepoHygieneViolations(['images/huge.png'], {
      getSize: () => DEFAULT_MAX_TRACKED_FILE_BYTES + 1,
    });

    expect(violations).toEqual(['images/huge.png: tracked file is 10.0 MiB (limit 10.0 MiB)']);
  });

  it('allows ordinary source and image assets below the limit', () => {
    const violations = findRepoHygieneViolations(
      ['main.js', 'images/Main_View.png', 'build/icon.ico'],
      { getSize: () => 500_000 }
    );

    expect(violations).toEqual([]);
  });

  it('reports tracked files that cannot be inspected', () => {
    const violations = findRepoHygieneViolations(['missing.txt'], {
      getSize: () => {
        throw new Error('not found');
      },
    });

    expect(violations).toEqual(['missing.txt: unable to inspect tracked file (not found)']);
  });
});

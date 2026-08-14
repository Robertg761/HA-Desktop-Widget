/**
 * @jest-environment node
 */

const {
  extractReleaseNotes,
  normalizeVersion,
} = require('../../scripts/extract-release-notes.cjs');

describe('release-note extraction', () => {
  const changelog = `# Changelog

## [3.9.1] - 2026-08-14

Stable release summary.

### Fixed

- A stable fix.

## [3.9.1-beta.1] - 2026-08-12

- A beta fix.

## [3.9.0] - 2026-08-10

- An older fix.
`;

  test('extracts only the exact version section', () => {
    expect(extractReleaseNotes(changelog, '3.9.1')).toBe(
      'Stable release summary.\n\n### Fixed\n\n- A stable fix.\n'
    );
  });

  test('accepts a tag-shaped version without confusing it with the stable section', () => {
    expect(extractReleaseNotes(changelog, 'v3.9.1-beta.1')).toBe('- A beta fix.\n');
  });

  test('supports a final changelog section without a following release', () => {
    expect(extractReleaseNotes('## [1.0.0]\r\n\r\nInitial release.\r\n', '1.0.0')).toBe(
      'Initial release.\n'
    );
  });

  test('fails when the requested release is undocumented', () => {
    expect(() => extractReleaseNotes(changelog, '4.0.0')).toThrow(
      'CHANGELOG.md has no section for 4.0.0.'
    );
  });

  test('fails when the requested release section is empty', () => {
    expect(() =>
      extractReleaseNotes('## [4.0.0] - 2026-08-14\n\n## [3.9.1] - 2026-08-13\n', '4.0.0')
    ).toThrow('CHANGELOG.md section for 4.0.0 is empty.');
  });

  test('rejects malformed release versions', () => {
    expect(() => normalizeVersion('../3.9.1')).toThrow('Release version must use');
  });
});

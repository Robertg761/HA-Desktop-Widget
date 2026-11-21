/**
 * @jest-environment node
 */

const { resolveBetaPromotion } = require('../../scripts/resolve-beta-promotion.cjs');
const {
  isVersionBehind,
  recordReleaseInChangelog,
  recordReleasedKeys,
} = require('../../scripts/record-promoted-release.cjs');
const { extractUnreleasedNotes } = require('../../scripts/extract-release-notes.cjs');

const HOUR = 60 * 60 * 1000;
const BETA_PUBLISHED = '2026-11-19T16:49:26Z';
const at = (hoursAfterBeta) => Date.parse(BETA_PUBLISHED) + hoursAfterBeta * HOUR;

const releases = [
  { tagName: 'v1.1.0', isPrerelease: false, isDraft: true, publishedAt: null },
  {
    tagName: 'v4.2.1-beta.1',
    isPrerelease: true,
    isDraft: false,
    publishedAt: BETA_PUBLISHED,
  },
  { tagName: 'v4.2.0', isPrerelease: false, isDraft: false, publishedAt: '2026-11-16T19:34:32Z' },
  {
    tagName: 'v4.2.0-beta.2',
    isPrerelease: true,
    isDraft: false,
    publishedAt: '2026-11-16T17:15:37Z',
  },
];
const tags = ['v1.1.0', 'v4.2.0', 'v4.2.0-beta.1', 'v4.2.0-beta.2', 'v4.2.1-beta.1'];

describe('beta promotion decision', () => {
  test('promotes the newest beta once it has been out three days', () => {
    expect(resolveBetaPromotion({ releases, tags, now: at(72) })).toMatchObject({
      promote: true,
      betaTag: 'v4.2.1-beta.1',
      stableTag: 'v4.2.1',
      version: '4.2.1',
      ageHours: 72,
    });
  });

  test('waits until the beta is three days old and says when it will be due', () => {
    const decision = resolveBetaPromotion({ releases, tags, now: at(71.9) });
    expect(decision.promote).toBe(false);
    expect(decision.reason).toContain('has been out 71h of 72h');
    expect(decision.reason).toContain('2026-11-22T16:49:26.000Z');
  });

  test('restarts the clock when a newer beta of the same version is published', () => {
    const newer = [
      {
        tagName: 'v4.2.1-beta.2',
        isPrerelease: true,
        isDraft: false,
        publishedAt: '2026-11-21T10:00:00Z',
      },
      ...releases,
    ];
    const decision = resolveBetaPromotion({
      releases: newer,
      tags: [...tags, 'v4.2.1-beta.2'],
      now: at(80),
    });
    expect(decision).toMatchObject({ promote: false, betaTag: 'v4.2.1-beta.2' });
  });

  test('does not promote while a newer beta tag is still building or has failed', () => {
    const decision = resolveBetaPromotion({
      releases,
      tags: [...tags, 'v4.2.1-beta.2'],
      now: at(100),
    });
    expect(decision.promote).toBe(false);
    expect(decision.stuck).toBeUndefined();
    expect(decision.reason).toContain('v4.2.1-beta.2 is newer than v4.2.1-beta.1');
  });

  test('follows a newer version series instead of an older one that never went stable', () => {
    const series = [
      {
        tagName: 'v4.3.0-beta.1',
        isPrerelease: true,
        isDraft: false,
        publishedAt: '2026-11-20T08:00:00Z',
      },
      ...releases,
    ];
    expect(
      resolveBetaPromotion({ releases: series, tags: [...tags, 'v4.3.0-beta.1'], now: at(200) })
    ).toMatchObject({ promote: true, betaTag: 'v4.3.0-beta.1', stableTag: 'v4.3.0' });
  });

  test('does nothing once the version is stable', () => {
    const stable = [
      {
        tagName: 'v4.2.1',
        isPrerelease: false,
        isDraft: false,
        publishedAt: '2026-11-22T17:00:00Z',
      },
      ...releases,
    ];
    const decision = resolveBetaPromotion({
      releases: stable,
      tags: [...tags, 'v4.2.1'],
      now: at(100),
    });
    expect(decision.promote).toBe(false);
    expect(decision.reason).toContain('not newer than the latest stable release, v4.2.1');
  });

  test('flags a stable tag that has no published release', () => {
    expect(
      resolveBetaPromotion({ releases, tags: [...tags, 'v4.2.1'], now: at(100) })
    ).toMatchObject({ promote: false, stuck: true });
  });

  test('ignores drafts and releases that are not betas', () => {
    const odd = [
      {
        tagName: 'v4.2.1-rc.1',
        isPrerelease: true,
        isDraft: false,
        publishedAt: '2026-11-20T00:00:00Z',
      },
      { tagName: 'v4.2.1-beta.9', isPrerelease: true, isDraft: true, publishedAt: null },
      ...releases,
    ];
    expect(resolveBetaPromotion({ releases: odd, tags, now: at(72) })).toMatchObject({
      promote: true,
      betaTag: 'v4.2.1-beta.1',
    });
    expect(resolveBetaPromotion({ releases: [releases[2]], tags, now: at(72) }).promote).toBe(
      false
    );
  });
});

describe('recording a promoted release on main', () => {
  const changelog = `# Changelog

Intro.

## [Unreleased]

### Added

- Shipped feature.
- Later feature.

### Changed

- Shipped change.

## [4.2.0] - 2026-11-16

### Added

- Old feature.
`;
  const shipped = `### Added

- Shipped feature.

### Changed

- Shipped change.
`;

  test('moves the shipped entries under the version and keeps later ones unreleased', () => {
    expect(recordReleaseInChangelog(changelog, shipped, '4.2.1', '2026-11-22')).toBe(`# Changelog

Intro.

## [Unreleased]

### Added

- Later feature.

## [4.2.1] - 2026-11-22

### Added

- Shipped feature.

### Changed

- Shipped change.

## [4.2.0] - 2026-11-16

### Added

- Old feature.
`);
  });

  test('leaves an empty [Unreleased] section when everything shipped', () => {
    const all = extractUnreleasedNotes(changelog);
    const result = recordReleaseInChangelog(changelog, all, '4.2.1', '2026-11-22');
    expect(result).toContain('## [Unreleased]\n\n## [4.2.1] - 2026-11-22\n\n### Added\n');
    expect(
      extractUnreleasedNotes(result.replace('## [Unreleased]', '## [Unreleased]\n\n- x'))
    ).toBe('- x\n');
  });

  test('keeps a section someone already wrote for the version', () => {
    const written = changelog.replace(
      '## [Unreleased]',
      '## [Unreleased]\n\n## [4.2.1] - 2026-11-21'
    );
    expect(recordReleaseInChangelog(written, shipped, '4.2.1', '2026-11-22')).toBe(written);
  });

  test("adds the release's English keys to the released-keys fixture once", () => {
    const fixture = `${JSON.stringify({ comment: ['c'], '4.2.0': ['a'] }, null, 2)}\n`;
    const updated = recordReleasedKeys(fixture, '4.2.1', { a: 'a', b: 'b' });
    expect(JSON.parse(updated)).toEqual({ comment: ['c'], '4.2.0': ['a'], '4.2.1': ['a', 'b'] });
    expect(recordReleasedKeys(updated, '4.2.1', { c: 'c' })).toBe(updated);
  });

  test("bumps main's version only forward", () => {
    expect(isVersionBehind('4.2.0', '4.2.1')).toBe(true);
    expect(isVersionBehind('4.2.1-beta.1', '4.2.1')).toBe(true);
    expect(isVersionBehind('4.2.1', '4.2.1')).toBe(false);
    expect(isVersionBehind('4.3.0', '4.2.1')).toBe(false);
  });
});

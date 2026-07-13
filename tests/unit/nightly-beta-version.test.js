const {
  hasMeaningfulChanges,
  isReleaseVersionSyncCommit,
  parseCoreVersion,
  resolveNightlyBeta,
} = require('../../scripts/resolve-nightly-beta.cjs');

describe('nightly beta version resolution', () => {
  test('uses the configured minor target while it is newer than the next patch', () => {
    expect(
      resolveNightlyBeta({
        configuredTarget: '3.7.0',
        latestStableTag: 'v3.6.0',
        tags: ['v3.7.0-beta.1', 'v3.7.0-beta.3', 'v3.6.1-beta.8'],
      })
    ).toEqual({
      latestStableTag: 'v3.6.0',
      targetVersion: '3.7.0',
      nextBetaNumber: 4,
      nextTag: 'v3.7.0-beta.4',
    });
  });

  test('automatically advances to the next patch after the target becomes stable', () => {
    expect(
      resolveNightlyBeta({
        configuredTarget: '3.7.0',
        latestStableTag: 'v3.7.0',
        tags: [],
      })
    ).toMatchObject({
      targetVersion: '3.7.1',
      nextBetaNumber: 1,
      nextTag: 'v3.7.1-beta.1',
    });
  });

  test('switches to a manually selected future minor series', () => {
    expect(
      resolveNightlyBeta({
        configuredTarget: '3.8.0',
        latestStableTag: 'v3.7.0',
        tags: ['v3.7.1-beta.7'],
      })
    ).toMatchObject({
      targetVersion: '3.8.0',
      nextBetaNumber: 1,
      nextTag: 'v3.8.0-beta.1',
    });
  });

  test('rejects prerelease values in the configured target', () => {
    expect(() => parseCoreVersion('3.8.0-beta.1', 'Configured beta target')).toThrow(
      'Configured beta target must use X.Y.Z format'
    );
  });
});

describe('nightly beta change detection', () => {
  test('recognizes the release workflow package-only version sync', () => {
    expect(
      isReleaseVersionSyncCommit('chore: bump version to 3.7.0', [
        'package-lock.json',
        'package.json',
      ])
    ).toBe(true);
    expect(
      isReleaseVersionSyncCommit('chore: bump version to 3.7.0', ['package.json', 'src/ui.js'])
    ).toBe(false);
  });

  test('ignores only package-only release sync commits since the baseline', () => {
    const calls = new Map([
      ['rev-list --reverse v3.7.0..HEAD', 'sync-sha\n'],
      ['show -s --format=%s sync-sha', 'chore: bump version to 3.7.0\n'],
      ['diff-tree --no-commit-id --name-only -r sync-sha', 'package.json\npackage-lock.json\n'],
    ]);
    const git = (_command, args) => calls.get(args.join(' '));

    expect(hasMeaningfulChanges('v3.7.0', 'HEAD', git)).toBe(false);
  });

  test('detects any normal commit after the baseline', () => {
    const calls = new Map([
      ['rev-list --reverse v3.7.0..HEAD', 'feature-sha\n'],
      ['show -s --format=%s feature-sha', 'Fix: improve widget refresh\n'],
      ['diff-tree --no-commit-id --name-only -r feature-sha', 'src/ui.js\n'],
    ]);
    const git = (_command, args) => calls.get(args.join(' '));

    expect(hasMeaningfulChanges('v3.7.0', 'HEAD', git)).toBe(true);
  });
});

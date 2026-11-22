// Brings main up to date after a stable release, from the release workflow's sync-version job.
//
//   node scripts/record-promoted-release.cjs version-behind <main version> <release version>
//     Exits 0 when main's package version is older than the release and should be bumped.
//   node scripts/record-promoted-release.cjs record <vX.Y.Z> [YYYY-MM-DD]
//     For a beta promoted to stable: moves the changelog entries the release shipped (the tag's
//     [Unreleased] section) into a dated section for it, and adds the release's English keys to
//     tests/fixtures/locale-pack-released-keys.json, as a hand-made stable bump would.

const fs = require('fs');
const { execFileSync } = require('child_process');
const { extractUnreleasedNotes, normalizeVersion } = require('./extract-release-notes.cjs');

const CHANGELOG_FILE = 'CHANGELOG.md';
const RELEASED_KEYS_FILE = 'tests/fixtures/locale-pack-released-keys.json';
const SECTION_HEADING = /^## \[.+\](?:\s+-\s+.+)?\s*$/;

function parseVersion(value) {
  const match = /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?$/.exec(normalizeVersion(value));
  if (!match) {
    throw new Error(`Expected a X.Y.Z or X.Y.Z-suffix version; received ${value}.`);
  }
  return {
    core: [Number(match[1]), Number(match[2]), Number(match[3])],
    prerelease: match[4] || '',
  };
}

/** True when main's version is older than the stable release, so main must be bumped. */
function isVersionBehind(currentVersion, releaseVersion) {
  const current = parseVersion(currentVersion);
  const release = parseVersion(releaseVersion);
  for (let index = 0; index < 3; index += 1) {
    if (current.core[index] !== release.core[index]) {
      return current.core[index] < release.core[index];
    }
  }
  // X.Y.Z-beta.N comes before X.Y.Z.
  return Boolean(current.prerelease) && !release.prerelease;
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Drops subsection headings left with nothing under them, and doubled or edge blank lines. */
function tidySection(lines) {
  const kept = [];
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (/^#{3,}\s/.test(line)) {
      let next = index + 1;
      while (next < lines.length && !/^#{3,}\s/.test(lines[next]) && !lines[next].trim()) {
        next += 1;
      }
      if (next >= lines.length || /^#{3,}\s/.test(lines[next])) continue;
    }
    if (!line.trim() && (kept.length === 0 || !kept[kept.length - 1].trim())) continue;
    kept.push(line);
  }
  while (kept.length > 0 && !kept[kept.length - 1].trim()) kept.pop();
  return kept;
}

/**
 * Moves the entries a release shipped out of main's [Unreleased] section into a dated section for
 * the release. Entries main gained after the release commit stay under [Unreleased]. Returns the
 * changelog unchanged when it already has a section for the version.
 */
function recordReleaseInChangelog(changelog, shippedNotes, version, date) {
  const lines = String(changelog).split(/\r?\n/);
  const ownHeading = new RegExp(`^## \\[${escapeRegExp(version)}\\](?:\\s+-\\s+.+)?\\s*$`);
  if (lines.some((line) => ownHeading.test(line))) return changelog;

  const shippedLines = String(shippedNotes).trim().split(/\r?\n/);
  const shipped = new Map();
  for (const line of shippedLines) {
    const key = line.trim();
    if (key && !key.startsWith('#')) shipped.set(key, (shipped.get(key) || 0) + 1);
  }

  let unreleasedStart = lines.findIndex((line) => /^## \[Unreleased\]\s*$/i.test(line));
  let remaining = [];
  let restStart;
  if (unreleasedStart === -1) {
    const firstSection = lines.findIndex((line) => SECTION_HEADING.test(line));
    unreleasedStart = firstSection === -1 ? lines.length : firstSection;
    restStart = unreleasedStart;
  } else {
    const nextOffset = lines
      .slice(unreleasedStart + 1)
      .findIndex((line) => SECTION_HEADING.test(line));
    restStart = nextOffset === -1 ? lines.length : unreleasedStart + 1 + nextOffset;
    for (const line of lines.slice(unreleasedStart + 1, restStart)) {
      const key = line.trim();
      if (key && shipped.get(key) > 0) {
        shipped.set(key, shipped.get(key) - 1);
        continue;
      }
      remaining.push(line);
    }
    remaining = tidySection(remaining);
  }

  const rest = lines.slice(restStart);
  const head = lines.slice(0, unreleasedStart);
  while (head.length > 0 && !head[head.length - 1].trim()) head.pop();

  return [
    ...head,
    '',
    '## [Unreleased]',
    '',
    ...(remaining.length > 0 ? [...remaining, ''] : []),
    `## [${version}] - ${date}`,
    '',
    ...shippedLines,
    ...(rest.length > 0 ? ['', ...rest] : ['']),
  ].join('\n');
}

/** Adds a stable release's English keys to the released-keys fixture, unless it has them. */
function recordReleasedKeys(fixtureText, version, englishCatalog) {
  const fixture = JSON.parse(fixtureText);
  if (Object.prototype.hasOwnProperty.call(fixture, version)) return fixtureText;
  fixture[version] = Object.keys(englishCatalog);
  return `${JSON.stringify(fixture, null, 2)}\n`;
}

function gitShow(tag, file) {
  return execFileSync('git', ['show', `refs/tags/${tag}:${file}`], { encoding: 'utf8' });
}

function main() {
  const [command, ...args] = process.argv.slice(2);

  if (command === 'version-behind') {
    const [currentVersion, releaseVersion] = args;
    process.exit(isVersionBehind(currentVersion, releaseVersion) ? 0 : 1);
  }

  if (command === 'record') {
    const [tag, date = new Date().toISOString().slice(0, 10)] = args;
    const version = normalizeVersion(tag);
    if (!/^\d+\.\d+\.\d+$/.test(version) || tag !== `v${version}`) {
      throw new Error(`record needs a stable vX.Y.Z tag; received ${tag}.`);
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      throw new Error(`The release date must be YYYY-MM-DD; received ${date}.`);
    }

    const shippedNotes = extractUnreleasedNotes(gitShow(tag, CHANGELOG_FILE));
    const changelog = fs.readFileSync(CHANGELOG_FILE, 'utf8');
    fs.writeFileSync(
      CHANGELOG_FILE,
      recordReleaseInChangelog(changelog, shippedNotes, version, date)
    );

    const fixture = fs.readFileSync(RELEASED_KEYS_FILE, 'utf8');
    const english = JSON.parse(gitShow(tag, 'locales/en.json'));
    fs.writeFileSync(RELEASED_KEYS_FILE, recordReleasedKeys(fixture, version, english));
    console.log(`Recorded ${tag} in ${CHANGELOG_FILE} and ${RELEASED_KEYS_FILE}.`);
    return;
  }

  throw new Error(
    'Usage: record-promoted-release.cjs version-behind <current> <release> | record <vX.Y.Z> [date]'
  );
}

if (require.main === module) {
  try {
    main();
  } catch (error) {
    console.error(error.message);
    process.exit(2);
  }
}

module.exports = {
  isVersionBehind,
  recordReleaseInChangelog,
  recordReleasedKeys,
};

const fs = require('fs');
const { execFileSync } = require('child_process');

const CORE_VERSION_PATTERN = /^(\d+)\.(\d+)\.(\d+)$/;
const RELEASE_VERSION_SYNC_PATTERN =
  /^chore: bump version to \d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/;
const RELEASE_VERSION_FILES = new Set(['package.json', 'package-lock.json']);

function parseCoreVersion(value, label = 'version') {
  const normalized = String(value || '')
    .trim()
    .replace(/^v/, '');
  const match = CORE_VERSION_PATTERN.exec(normalized);
  if (!match) {
    throw new Error(`${label} must use X.Y.Z format; received ${value || '<empty>'}.`);
  }

  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
    version: normalized,
  };
}

function compareCoreVersions(left, right) {
  for (const key of ['major', 'minor', 'patch']) {
    if (left[key] !== right[key]) {
      return left[key] - right[key];
    }
  }
  return 0;
}

function incrementPatch(version) {
  return {
    major: version.major,
    minor: version.minor,
    patch: version.patch + 1,
    version: `${version.major}.${version.minor}.${version.patch + 1}`,
  };
}

function resolveNightlyBeta({ configuredTarget, latestStableTag, tags = [] }) {
  const configured = parseCoreVersion(configuredTarget, 'Configured beta target');
  const latestStable = parseCoreVersion(latestStableTag, 'Latest stable tag');
  const nextPatch = incrementPatch(latestStable);
  const target = compareCoreVersions(configured, nextPatch) > 0 ? configured : nextPatch;
  const escapedTarget = target.version.replace(/\./g, '\\.');
  const betaPattern = new RegExp(`^v${escapedTarget}-beta\\.(\\d+)$`);

  let highestBetaNumber = 0;
  for (const tag of tags) {
    const match = betaPattern.exec(tag);
    if (match) {
      highestBetaNumber = Math.max(highestBetaNumber, Number(match[1]));
    }
  }

  const nextBetaNumber = highestBetaNumber + 1;
  return {
    latestStableTag: `v${latestStable.version}`,
    targetVersion: target.version,
    nextBetaNumber,
    nextTag: `v${target.version}-beta.${nextBetaNumber}`,
  };
}

function isReleaseVersionSyncCommit(subject, files) {
  return (
    RELEASE_VERSION_SYNC_PATTERN.test(subject) &&
    files.length > 0 &&
    files.every((file) => RELEASE_VERSION_FILES.has(file))
  );
}

function hasMeaningfulChanges(baseline, head = 'HEAD', git = execFileSync) {
  const commits = git('git', ['rev-list', '--reverse', `${baseline}..${head}`], {
    encoding: 'utf8',
  })
    .split(/\r?\n/)
    .filter(Boolean);

  return commits.some((commit) => {
    const subject = git('git', ['show', '-s', '--format=%s', commit], {
      encoding: 'utf8',
    }).trim();
    const files = git('git', ['diff-tree', '--no-commit-id', '--name-only', '-r', commit], {
      encoding: 'utf8',
    })
      .split(/\r?\n/)
      .filter(Boolean);

    return !isReleaseVersionSyncCommit(subject, files);
  });
}

function readArgument(name) {
  const index = process.argv.indexOf(name);
  if (index === -1) return null;
  const value = process.argv[index + 1];
  if (!value || value.startsWith('--')) {
    throw new Error(`${name} requires a value.`);
  }
  return value;
}

function writeOutputs(values) {
  const lines = Object.entries(values).map(([key, value]) => `${key}=${value}`);
  if (process.env.GITHUB_OUTPUT) {
    fs.appendFileSync(process.env.GITHUB_OUTPUT, `${lines.join('\n')}\n`);
  }
  console.log(lines.join('\n'));
}

function main() {
  const targetFile = process.env.BETA_TARGET_FILE || '.github/beta-target';
  const configuredTarget = fs.readFileSync(targetFile, 'utf8').trim();
  const latestStableTag = process.env.LATEST_STABLE_TAG;
  if (!latestStableTag) {
    throw new Error('LATEST_STABLE_TAG is required.');
  }

  const tags = execFileSync('git', ['tag', '--list', 'v*'], { encoding: 'utf8' })
    .split(/\r?\n/)
    .filter(Boolean);
  const resolved = resolveNightlyBeta({ configuredTarget, latestStableTag, tags });
  const baseline = readArgument('--baseline');

  const outputs = {
    latest_stable_tag: resolved.latestStableTag,
    target_version: resolved.targetVersion,
    next_beta_number: resolved.nextBetaNumber,
    next_tag: resolved.nextTag,
  };

  if (baseline) {
    outputs.has_changes = hasMeaningfulChanges(baseline) ? 'true' : 'false';
  }

  writeOutputs(outputs);
}

if (require.main === module) {
  try {
    main();
  } catch (error) {
    console.error(error.message);
    process.exit(1);
  }
}

module.exports = {
  compareCoreVersions,
  hasMeaningfulChanges,
  incrementPatch,
  isReleaseVersionSyncCommit,
  parseCoreVersion,
  resolveNightlyBeta,
};

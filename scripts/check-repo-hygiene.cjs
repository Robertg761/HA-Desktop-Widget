const fs = require('fs');
const { spawnSync } = require('child_process');

const DEFAULT_MAX_TRACKED_FILE_BYTES = 10 * 1024 * 1024;
const FORBIDDEN_BUILD_PATH = /^(?:dist|dist-renderer|out)\//i;
const FORBIDDEN_ARTIFACT_PATH =
  /(?:^|\/)(?:builder-debug\.yml|[^/]+\.(?:exe|dmg|appimage|deb|zip|7z|blockmap|tar\.gz))$/i;

function findRepoHygieneViolations(
  files,
  {
    getSize = (file) => fs.lstatSync(file).size,
    maxTrackedFileBytes = DEFAULT_MAX_TRACKED_FILE_BYTES,
  } = {}
) {
  const violations = [];

  for (const file of files) {
    if (!file) continue;
    if (FORBIDDEN_BUILD_PATH.test(file) || FORBIDDEN_ARTIFACT_PATH.test(file)) {
      violations.push(`${file}: generated build artifact is tracked`);
      continue;
    }

    let size;
    try {
      size = getSize(file);
    } catch (error) {
      violations.push(`${file}: unable to inspect tracked file (${error.message})`);
      continue;
    }
    if (size > maxTrackedFileBytes) {
      const sizeMiB = (size / (1024 * 1024)).toFixed(1);
      violations.push(
        `${file}: tracked file is ${sizeMiB} MiB (limit ${(
          maxTrackedFileBytes /
          (1024 * 1024)
        ).toFixed(1)} MiB)`
      );
    }
  }

  return violations;
}

function getTrackedFiles() {
  const result = spawnSync('git', ['ls-files', '-z'], {
    encoding: 'utf8',
    maxBuffer: 10 * 1024 * 1024,
  });
  if (result.status !== 0) {
    throw new Error(result.stderr.trim() || 'git ls-files failed');
  }
  return result.stdout.split('\0').filter(Boolean);
}

function run() {
  const violations = findRepoHygieneViolations(getTrackedFiles());
  if (violations.length > 0) {
    console.error('Repository hygiene check failed:');
    violations.forEach((violation) => console.error(`- ${violation}`));
    process.exitCode = 1;
    return;
  }
  console.log('Repository hygiene check passed.');
}

if (require.main === module) {
  run();
}

module.exports = {
  DEFAULT_MAX_TRACKED_FILE_BYTES,
  findRepoHygieneViolations,
};

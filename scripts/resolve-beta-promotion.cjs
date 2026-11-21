// Decides whether the newest beta has been out long enough to become the stable release.
// Used by .github/workflows/promote-beta.yml. The decision is a pure function of the published
// releases, the repository's tags and the time, so it can be tested without GitHub.

const fs = require('fs');
const { execFileSync } = require('child_process');

const STABLE_TAG_PATTERN = /^v(\d+)\.(\d+)\.(\d+)$/;
const BETA_TAG_PATTERN = /^v(\d+)\.(\d+)\.(\d+)-beta\.(\d+)$/;
const DEFAULT_MIN_AGE_HOURS = 72;
const HOUR_MS = 60 * 60 * 1000;

function parseStableTag(tag) {
  const match = STABLE_TAG_PATTERN.exec(tag);
  return match ? [Number(match[1]), Number(match[2]), Number(match[3])] : null;
}

function parseBetaTag(tag) {
  const match = BETA_TAG_PATTERN.exec(tag);
  if (!match) return null;
  return {
    core: [Number(match[1]), Number(match[2]), Number(match[3])],
    version: `${match[1]}.${match[2]}.${match[3]}`,
    number: Number(match[4]),
  };
}

function compareCore(left, right) {
  for (let index = 0; index < 3; index += 1) {
    if (left[index] !== right[index]) return left[index] - right[index];
  }
  return 0;
}

function formatHours(hours) {
  return `${Math.floor(hours)}h`;
}

/**
 * @param {object} input
 * @param {Array<{tagName: string, isPrerelease: boolean, isDraft: boolean, publishedAt: string|null}>} input.releases
 * @param {string[]} input.tags every v* tag in the repository
 * @param {Date|number} input.now
 * @param {number} [input.minAgeHours]
 */
function resolveBetaPromotion({ releases, tags, now, minAgeHours = DEFAULT_MIN_AGE_HOURS }) {
  const nowMs = typeof now === 'number' ? now : now.getTime();
  const published = releases.filter((release) => !release.isDraft && release.publishedAt);

  let latestStable = null;
  for (const release of published) {
    const core = !release.isPrerelease && parseStableTag(release.tagName);
    if (core && (!latestStable || compareCore(core, latestStable.core) > 0)) {
      latestStable = { tag: release.tagName, core };
    }
  }

  // The newest beta by publication time is the one people are testing now. A newer series
  // (a later version's beta.1) supersedes an older series that never went stable.
  let candidate = null;
  for (const release of published) {
    const beta = release.isPrerelease && parseBetaTag(release.tagName);
    if (!beta) continue;
    const publishedMs = Date.parse(release.publishedAt);
    if (!candidate || publishedMs > candidate.publishedMs) {
      candidate = { tag: release.tagName, ...beta, publishedMs };
    }
  }

  if (!candidate) {
    return { promote: false, reason: 'No published beta release was found.' };
  }

  const stableTag = `v${candidate.version}`;
  const ageHours = (nowMs - candidate.publishedMs) / HOUR_MS;
  const result = {
    betaTag: candidate.tag,
    stableTag,
    version: candidate.version,
    ageHours: Math.floor(ageHours),
  };

  if (latestStable && compareCore(candidate.core, latestStable.core) <= 0) {
    return {
      ...result,
      promote: false,
      reason: `${candidate.tag} is not newer than the latest stable release, ${latestStable.tag}.`,
    };
  }

  if (tags.includes(stableTag)) {
    return {
      ...result,
      promote: false,
      stuck: true,
      reason:
        `The tag ${stableTag} already exists but has no published release. ` +
        'A release run for it is still going or has failed; check the Release workflow.',
    };
  }

  const newerBetaTags = tags.filter((tag) => {
    const beta = parseBetaTag(tag);
    return beta && beta.version === candidate.version && beta.number > candidate.number;
  });
  if (newerBetaTags.length > 0) {
    return {
      ...result,
      promote: false,
      reason:
        `${newerBetaTags.join(', ')} is newer than ${candidate.tag} but not published. ` +
        'It is still building or its release failed, so the beta that would be promoted is not the latest.',
    };
  }

  if (ageHours < minAgeHours) {
    const dueAt = new Date(candidate.publishedMs + minAgeHours * HOUR_MS).toISOString();
    return {
      ...result,
      promote: false,
      reason:
        `${candidate.tag} has been out ${formatHours(ageHours)} of ${minAgeHours}h. ` +
        `It can be promoted from ${dueAt} if no newer beta comes out first.`,
    };
  }

  return {
    ...result,
    promote: true,
    reason:
      `${candidate.tag} has been out ${formatHours(ageHours)} (at least ${minAgeHours}h) ` +
      `with no newer beta, so it becomes ${stableTag}.`,
  };
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

function main() {
  const releasesFile = readArgument('--releases');
  if (!releasesFile) {
    throw new Error('--releases <file> is required (gh release list --json output).');
  }
  const minAgeHours = Number(process.env.MIN_AGE_HOURS || DEFAULT_MIN_AGE_HOURS);
  if (!Number.isFinite(minAgeHours) || minAgeHours < 0) {
    throw new Error(
      `MIN_AGE_HOURS must be a number of hours; received ${process.env.MIN_AGE_HOURS}.`
    );
  }

  const releases = JSON.parse(fs.readFileSync(releasesFile, 'utf8'));
  const tags = execFileSync('git', ['tag', '--list', 'v*'], { encoding: 'utf8' })
    .split(/\r?\n/)
    .filter(Boolean);
  const decision = resolveBetaPromotion({ releases, tags, now: Date.now(), minAgeHours });

  const outputs = {
    promote: decision.promote ? 'true' : 'false',
    stuck: decision.stuck ? 'true' : 'false',
    beta_tag: decision.betaTag || '',
    stable_tag: decision.stableTag || '',
    version: decision.version || '',
    reason: decision.reason,
  };
  const lines = Object.entries(outputs).map(([key, value]) => `${key}=${value}`);
  if (process.env.GITHUB_OUTPUT) {
    fs.appendFileSync(process.env.GITHUB_OUTPUT, `${lines.join('\n')}\n`);
  }
  console.log(lines.join('\n'));
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
  DEFAULT_MIN_AGE_HOURS,
  resolveBetaPromotion,
};

#!/usr/bin/env node
// Dependency audit gate for CI.
//
// This replaces a bare `npm audit --audit-level=high`. That command cannot
// express "this advisory has no patched release yet and only reaches a tool
// that never ships in the app", so one unfixable advisory in a lint or build
// tool turned every branch red. Here an advisory can be excused, but only by a
// narrow, dated entry in .github/audit-exceptions.json that stops working the
// moment the situation it describes changes.
//
// The audit job runs this without `npm ci`, so it may only use Node built-ins.

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const REPO_ROOT = path.join(__dirname, '..');
const EXCEPTIONS_FILE = '.github/audit-exceptions.json';
const BLOCKING_SEVERITIES = new Set(['high', 'critical']);
const NPM_TIMEOUT_MS = 60_000;

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const GHSA_PATTERN = /GHSA-[0-9a-z]{4}-[0-9a-z]{4}-[0-9a-z]{4}/i;
const PACKAGE_NAME_PATTERN = /^(?:@[a-z0-9~-][a-z0-9._~-]*\/)?[a-z0-9~-][a-z0-9._~-]*$/;
const VERSION_PATTERN = /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/;
const EXCEPTION_FIELDS = [
  'ghsa',
  'package',
  'affectedUpTo',
  'allowedVia',
  'reason',
  'added',
  'expires',
];

function normalizeGhsa(value) {
  const match = GHSA_PATTERN.exec(String(value || ''));
  return match ? `GHSA-${match[0].slice(5).toLowerCase()}` : null;
}

function isCalendarDate(value) {
  if (typeof value !== 'string' || !DATE_PATTERN.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

function parseVersion(value) {
  const match = VERSION_PATTERN.exec(String(value || '').trim());
  if (!match) return null;
  return { core: [match[1], match[2], match[3]].map(Number), prerelease: match[4] || null };
}

function comparePrerelease(a, b) {
  // A release sorts after any prerelease of the same version.
  if (!a && !b) return 0;
  if (!a) return 1;
  if (!b) return -1;

  const left = a.split('.');
  const right = b.split('.');
  for (let i = 0; i < Math.max(left.length, right.length); i += 1) {
    if (left[i] === undefined) return -1;
    if (right[i] === undefined) return 1;
    const leftNumeric = /^\d+$/.test(left[i]);
    const rightNumeric = /^\d+$/.test(right[i]);
    if (leftNumeric && rightNumeric) {
      const difference = Number(left[i]) - Number(right[i]);
      if (difference !== 0) return Math.sign(difference);
    } else if (leftNumeric) {
      return -1;
    } else if (rightNumeric) {
      return 1;
    } else if (left[i] !== right[i]) {
      return left[i] < right[i] ? -1 : 1;
    }
  }
  return 0;
}

// Returns -1, 0 or 1. Throws for anything that is not a semver version so a
// malformed registry answer cannot be mistaken for "no newer release".
function compareVersions(a, b) {
  const left = parseVersion(a);
  const right = parseVersion(b);
  if (!left || !right) {
    throw new Error(`Cannot compare versions "${a}" and "${b}".`);
  }
  for (let i = 0; i < 3; i += 1) {
    if (left.core[i] !== right.core[i]) return left.core[i] < right.core[i] ? -1 : 1;
  }
  return comparePrerelease(left.prerelease, right.prerelease);
}

// Walks `effects` from the package that carries an advisory up to the packages
// the project depends on directly. Those are what decide whether the advisory
// is dev-only, so the exception lists them rather than the vulnerable package.
//
// A package counts as top-level when nothing above it is vulnerable (empty
// effects) or when package.json lists it directly. The second rule matters when
// a directly installed package is also a dependency of another one: following
// only the empty-effects entries would hide that it reaches the advisory itself.
function findTopLevelPackages(vulnerabilities, start) {
  const seen = new Set([start]);
  const queue = [start];
  const topLevel = new Set();

  while (queue.length > 0) {
    const name = queue.shift();
    const entry = vulnerabilities[name];
    const effects = entry && Array.isArray(entry.effects) ? entry.effects : [];
    if (effects.length === 0 || (entry && entry.isDirect === true)) {
      topLevel.add(name);
    }
    for (const next of effects) {
      if (!seen.has(next)) {
        seen.add(next);
        queue.push(next);
      }
    }
  }

  return [...topLevel].sort();
}

// Collects the root advisories (the `via` entries that are objects; strings are
// just pointers to other vulnerable packages) at a blocking severity.
function collectAdvisories(report) {
  const vulnerabilities = (report && report.vulnerabilities) || {};
  const advisories = new Map();

  for (const [entryName, entry] of Object.entries(vulnerabilities)) {
    for (const via of (entry && entry.via) || []) {
      if (!via || typeof via !== 'object' || !BLOCKING_SEVERITIES.has(via.severity)) continue;

      const packageName = via.name || entryName;
      const ghsa = normalizeGhsa(via.url);
      const key = `${ghsa || `npm-${via.source}`}|${packageName}`;
      const reaches = findTopLevelPackages(vulnerabilities, entryName);
      const existing = advisories.get(key);

      if (existing) {
        existing.reaches = [...new Set([...existing.reaches, ...reaches])].sort();
        continue;
      }
      advisories.set(key, {
        ghsa,
        source: via.source,
        package: packageName,
        severity: via.severity,
        title: via.title || '',
        range: via.range || '',
        reaches,
      });
    }
  }

  return [...advisories.values()].sort(
    (a, b) => a.package.localeCompare(b.package) || String(a.ghsa).localeCompare(String(b.ghsa))
  );
}

function describeAdvisory(advisory) {
  const id = advisory.ghsa || `npm advisory ${advisory.source}`;
  const range = advisory.range ? ` ${advisory.range}` : '';
  const title = advisory.title ? `: ${advisory.title}` : '';
  return `${id} (${advisory.package}${range}, ${advisory.severity})${title}`;
}

// Validates the exceptions file. Problems are returned, not thrown, so one run
// can report every mistake in the file at once.
function parseExceptions(data) {
  const errors = [];
  const entries = [];

  if (!data || typeof data !== 'object' || !Array.isArray(data.exceptions)) {
    return {
      entries,
      errors: [`${EXCEPTIONS_FILE} must be an object with an "exceptions" array.`],
    };
  }

  const seen = new Set();
  data.exceptions.forEach((raw, index) => {
    const where = `${EXCEPTIONS_FILE} entry ${index + 1}`;
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
      errors.push(`${where} must be an object.`);
      return;
    }

    const before = errors.length;
    for (const field of Object.keys(raw)) {
      if (!EXCEPTION_FIELDS.includes(field)) errors.push(`${where} has unknown field "${field}".`);
    }

    const ghsa = typeof raw.ghsa === 'string' && /^GHSA(?:-[0-9a-z]{4}){3}$/.test(raw.ghsa);
    if (!ghsa) errors.push(`${where} needs a lowercase GHSA id such as GHSA-xxxx-xxxx-xxxx.`);
    if (typeof raw.package !== 'string' || !PACKAGE_NAME_PATTERN.test(raw.package)) {
      errors.push(`${where} needs the vulnerable npm package name in "package".`);
    }
    if (!parseVersion(raw.affectedUpTo)) {
      errors.push(`${where} needs "affectedUpTo" to be the newest affected version, e.g. 1.2.3.`);
    }
    if (
      !Array.isArray(raw.allowedVia) ||
      raw.allowedVia.length === 0 ||
      !raw.allowedVia.every((name) => typeof name === 'string' && PACKAGE_NAME_PATTERN.test(name))
    ) {
      errors.push(`${where} needs "allowedVia" to list the top-level packages it may reach.`);
    }
    if (typeof raw.reason !== 'string' || raw.reason.trim() === '') {
      errors.push(`${where} needs a "reason" explaining why the advisory is acceptable.`);
    }
    if (!isCalendarDate(raw.added)) errors.push(`${where} needs "added" as a YYYY-MM-DD date.`);
    if (!isCalendarDate(raw.expires)) {
      errors.push(`${where} needs "expires" as a YYYY-MM-DD date.`);
    } else if (isCalendarDate(raw.added) && raw.expires < raw.added) {
      errors.push(`${where} expires before it was added.`);
    }

    const key = `${raw.ghsa}|${raw.package}`;
    if (seen.has(key)) errors.push(`${where} duplicates ${raw.ghsa} for ${raw.package}.`);
    seen.add(key);

    if (errors.length === before) entries.push(raw);
  });

  return { entries, errors };
}

// The decision logic. `getLatestVersion(packageName)` returns the newest
// published version and may throw when the registry cannot be reached; that
// only skips the fix-available check for that one entry.
function evaluate({ advisories, exceptions, today, getLatestVersion }) {
  const problems = [];
  const warnings = [];
  const excused = [];
  const matched = new Set();

  for (const advisory of advisories) {
    const label = describeAdvisory(advisory);
    const entry = exceptions.find(
      (candidate) => candidate.ghsa === advisory.ghsa && candidate.package === advisory.package
    );

    if (!entry) {
      problems.push(
        `${label} is not excused. Update the dependency that pulls it in. If no patched ` +
          `release exists yet, add a narrow, dated entry to ${EXCEPTIONS_FILE}.`
      );
      continue;
    }
    matched.add(entry);

    let acceptable = true;
    if (advisory.reaches.length === 0) {
      acceptable = false;
      problems.push(
        `${label} could not be traced to a top-level package, so it cannot be excused.`
      );
    }
    const outside = advisory.reaches.filter((name) => !entry.allowedVia.includes(name));
    if (outside.length > 0) {
      acceptable = false;
      problems.push(
        `${label} now reaches ${outside.join(', ')}, which the exception does not allow ` +
          `(allowed: ${entry.allowedVia.join(', ')}). Check whether that path ships in the app ` +
          'and update the dependency instead of widening the exception.'
      );
    }
    if (today > entry.expires) {
      acceptable = false;
      problems.push(
        `The exception for ${entry.ghsa} (${entry.package}) expired on ${entry.expires}. ` +
          'Check whether a patched release exists and update to it. If none does, renew the ' +
          'entry with a short new expiry.'
      );
    }
    if (acceptable) excused.push({ advisory, entry });
  }

  for (const entry of exceptions) {
    if (!matched.has(entry)) {
      problems.push(
        `The exception for ${entry.ghsa} (${entry.package}) matches no current high or critical ` +
          `advisory. Delete it from ${EXCEPTIONS_FILE}.`
      );
      continue;
    }

    let latest;
    try {
      latest = getLatestVersion(entry.package);
      if (compareVersions(latest, entry.affectedUpTo) > 0) {
        problems.push(
          `${entry.package} ${latest} is published and newer than ${entry.affectedUpTo}, the ` +
            `last version the ${entry.ghsa} exception covers, so a fix may exist. Update to it ` +
            `and delete the exception. If ${latest} is still affected, review the advisory ` +
            'before raising "affectedUpTo".'
        );
      }
    } catch (error) {
      warnings.push(
        `Could not check for a newer ${entry.package} release (${error.message}); skipped the ` +
          `fix-available check for ${entry.ghsa}.`
      );
    }
  }

  return { ok: problems.length === 0, problems, warnings, excused };
}

function formatResult(result, advisoryCount) {
  const stdout = [`npm audit reported ${advisoryCount} high or critical advisories.`];
  const stderr = [];

  if (result.excused.length > 0) {
    stdout.push(`Excused by ${EXCEPTIONS_FILE}:`);
    for (const { advisory, entry } of result.excused) {
      stdout.push(
        `- ${entry.ghsa} ${entry.package} ${advisory.range || `<=${entry.affectedUpTo}`} via ` +
          `${advisory.reaches.join(', ')}, excused until ${entry.expires}`,
        `  ${entry.reason}`
      );
    }
  }
  for (const warning of result.warnings) stderr.push(`Warning: ${warning}`);

  if (result.ok) {
    stdout.push('Dependency audit passed.');
  } else {
    for (const problem of result.problems) stderr.push(`Error: ${problem}`);
    stderr.push(`Dependency audit failed with ${result.problems.length} problem(s).`);
  }

  return { stdout, stderr };
}

// Everything except process and network access, so tests can run it directly.
function check({ report, exceptionsData, today, getLatestVersion }) {
  const { entries, errors } = parseExceptions(exceptionsData);
  if (errors.length > 0) {
    return {
      ok: false,
      stdout: [],
      stderr: [...errors.map((message) => `Error: ${message}`), 'Dependency audit failed.'],
    };
  }

  const advisories = collectAdvisories(report);
  const result = evaluate({ advisories, exceptions: entries, today, getLatestVersion });
  return { ok: result.ok, ...formatResult(result, advisories.length) };
}

function parseAuditReport(stdout) {
  let report;
  try {
    report = JSON.parse(stdout);
  } catch {
    throw new Error('npm audit did not return JSON, so the tree could not be checked.');
  }
  if (report && report.error) {
    // A failed request puts the useful text in the top-level message and leaves
    // error.summary empty, so look in all of them.
    const { code, summary, detail } = report.error;
    const reason = report.message || summary || detail || code || 'no details';
    throw new Error(`npm audit failed: ${reason}`);
  }
  if (!report || typeof report.vulnerabilities !== 'object' || report.vulnerabilities === null) {
    throw new Error('npm audit returned an unexpected report, so the tree could not be checked.');
  }
  return report;
}

function runNpm(args) {
  return spawnSync('npm', args, {
    cwd: REPO_ROOT,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
    timeout: NPM_TIMEOUT_MS,
    // npm is npm.cmd on Windows. The arguments are fixed strings and package
    // names that parseExceptions has already restricted to npm's name syntax.
    shell: process.platform === 'win32',
  });
}

function readAuditReport() {
  // npm audit covers devDependencies unless told otherwise, and no flag here
  // changes that: Electron is a devDependency, but its runtime ships in every
  // package.
  const result = runNpm(['audit', '--json']);
  if (result.error) throw new Error(`Could not run npm audit: ${result.error.message}`);
  // npm audit exits 1 when it finds anything, so the JSON is what matters.
  return parseAuditReport(result.stdout);
}

function fetchLatestVersion(packageName) {
  const result = runNpm(['view', packageName, 'version']);
  if (result.error) throw new Error(result.error.message);
  const version = String(result.stdout || '').trim();
  if (result.status !== 0 || !version) {
    const detail = String(result.stderr || '')
      .trim()
      .split('\n')[0];
    throw new Error(detail || `npm view exited with ${result.status}`);
  }
  return version;
}

function main() {
  try {
    const exceptionsData = JSON.parse(
      fs.readFileSync(path.join(REPO_ROOT, EXCEPTIONS_FILE), 'utf8')
    );
    const { stdout, stderr, ok } = check({
      report: readAuditReport(),
      exceptionsData,
      today: new Date().toISOString().slice(0, 10),
      getLatestVersion: fetchLatestVersion,
    });
    stdout.forEach((line) => console.log(line));
    stderr.forEach((line) => console.error(line));
    process.exitCode = ok ? 0 : 1;
  } catch (error) {
    console.error(`Error: ${error.message}`);
    console.error('Dependency audit failed.');
    process.exitCode = 1;
  }
}

if (require.main === module) {
  main();
}

module.exports = {
  EXCEPTIONS_FILE,
  check,
  collectAdvisories,
  compareVersions,
  evaluate,
  findTopLevelPackages,
  parseAuditReport,
  parseExceptions,
};

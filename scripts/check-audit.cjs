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
// The release workflow runs it too, after `npm ci`, so a tag cannot ship past an
// advisory that CI would have failed on.

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

// Returns -1, 0 or 1. Throws for anything that is not a semver version rather
// than guessing an order. evaluate() checks the registry's answer first and
// reports a malformed one as a problem, so it never reaches this throw.
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

// npm audit writes `via` and `effects` as arrays, but a hand-edited or damaged
// report should be skipped over rather than crash the walk.
function viaOf(entry) {
  return entry && Array.isArray(entry.via) ? entry.via : [];
}

function effectsOf(entry) {
  return entry && Array.isArray(entry.effects) ? entry.effects : [];
}

// A `via` entry that is an object is a root advisory; a string is only a
// pointer to another vulnerable package.
function isBlockingAdvisory(via) {
  return Boolean(via) && typeof via === 'object' && BLOCKING_SEVERITIES.has(via.severity);
}

// Maps each package name to the vulnerable packages that depend on it, which is
// the direction an advisory spreads. `effects` lists them, and a string in `via`
// says the same from the other side: "X has Y in via" means Y has X in effects.
//
// Both sides are read because npm does not always write both. When packages
// depend on each other (app-builder-lib and electron-builder-squirrel-windows do,
// through a peer dependency) npm drops one side of that edge, and which side
// differs by version: npm 10 and 11 leave electron-builder-squirrel-windows with
// no effects at all, npm 12 keeps them. Following `effects` alone would then
// take that package for a top-level one the exception does not allow.
function buildDependents(vulnerabilities) {
  const dependents = new Map();
  const add = (name, dependent) => {
    if (!dependents.has(name)) dependents.set(name, new Set());
    dependents.get(name).add(dependent);
  };

  for (const [name, entry] of Object.entries(vulnerabilities)) {
    for (const dependent of effectsOf(entry)) add(name, dependent);
    for (const via of viaOf(entry)) {
      if (typeof via === 'string') add(via, name);
    }
  }
  return dependents;
}

// Walks `dependents` from the package that carries an advisory up to the
// packages the project depends on directly. Those are what decide whether the
// advisory is dev-only, so the exception lists them rather than the vulnerable
// package.
//
// A package counts as top-level when nothing above it is vulnerable (no
// dependents) or when package.json lists it directly. The second rule matters
// when a directly installed package is also a dependency of another one:
// following only the packages without dependents would hide that it reaches the
// advisory itself.
function findTopLevelPackages(vulnerabilities, dependents, start) {
  const seen = new Set([start]);
  const queue = [start];
  const topLevel = new Set();

  while (queue.length > 0) {
    const name = queue.shift();
    const entry = vulnerabilities[name];
    const above = [...(dependents.get(name) || [])];
    if (above.length === 0 || (entry && entry.isDirect === true)) {
      topLevel.add(name);
    }
    for (const next of above) {
      if (!seen.has(next)) {
        seen.add(next);
        queue.push(next);
      }
    }
  }

  return [...topLevel].sort();
}

// Collects the root advisories at a blocking severity.
function collectAdvisories(report) {
  const vulnerabilities = (report && report.vulnerabilities) || {};
  const dependents = buildDependents(vulnerabilities);
  const advisories = new Map();

  for (const [entryName, entry] of Object.entries(vulnerabilities)) {
    for (const via of viaOf(entry)) {
      if (!isBlockingAdvisory(via)) continue;

      const packageName = via.name || entryName;
      const ghsa = normalizeGhsa(via.url);
      const key = `${ghsa || `npm-${via.source}`}|${packageName}`;
      const reaches = findTopLevelPackages(vulnerabilities, dependents, entryName);
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

// Names of the high or critical entries that no root advisory leads to. The gate
// only judges an entry through the dependents path that starts at a root
// advisory, because that path decides whether the advisory is dev-only. A high
// entry off every such path was never judged, so it has to fail the check;
// counting on npm to always write a complete report would let one slip through
// as a pass.
function findUntracedVulnerabilities(report) {
  const vulnerabilities = (report && report.vulnerabilities) || {};
  const dependents = buildDependents(vulnerabilities);
  const traced = new Set();
  const queue = [];

  for (const [name, entry] of Object.entries(vulnerabilities)) {
    if (viaOf(entry).some(isBlockingAdvisory)) {
      traced.add(name);
      queue.push(name);
    }
  }
  while (queue.length > 0) {
    for (const next of dependents.get(queue.shift()) || []) {
      if (!traced.has(next)) {
        traced.add(next);
        queue.push(next);
      }
    }
  }

  return Object.entries(vulnerabilities)
    .filter(
      ([name, entry]) => entry && BLOCKING_SEVERITIES.has(entry.severity) && !traced.has(name)
    )
    .map(([name]) => name)
    .sort();
}

// The newest affected version an advisory states, from a range such as
// "<=3.0.3". Any other shape (an exclusive bound, a wildcard) gives null, so only
// the plain case is compared against an exception.
function newestAffectedVersion(range) {
  const match = /<=\s*(\S+)\s*$/.exec(String(range || ''));
  return match && parseVersion(match[1]) ? match[1] : null;
}

// Exceptions are for build tools. A name counts as dev-only when package.json
// lists it under devDependencies and nowhere the packaged app loads from.
function isDevOnly(packageJson, name) {
  const lists = (field) =>
    Boolean(packageJson) &&
    typeof packageJson[field] === 'object' &&
    packageJson[field] !== null &&
    Object.hasOwn(packageJson[field], name);
  return lists('devDependencies') && !lists('dependencies') && !lists('optionalDependencies');
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
// only skips the fix-available check for that one entry. An answer that is not a
// version is a problem, not a skip: the registry was reached, and a check that
// quietly did nothing is how an available fix would go unnoticed.
function evaluate({ advisories, untraced = [], packageJson, exceptions, today, getLatestVersion }) {
  const problems = [];
  const warnings = [];
  const excused = [];
  const matched = new Set();
  const shipping = new Set();

  if (untraced.length > 0) {
    problems.push(
      `The high or critical entries for ${untraced.join(', ')} do not lead back to any advisory ` +
        'in the npm audit report, so the report could not be fully traced and cannot be ' +
        'excused. Run npm audit and look at them by hand.'
    );
  }

  for (const entry of exceptions) {
    const notDevOnly = entry.allowedVia.filter((name) => !isDevOnly(packageJson, name));
    if (notDevOnly.length === 0) continue;
    shipping.add(entry);
    problems.push(
      `The exception for ${entry.ghsa} (${entry.package}) allows ${notDevOnly.join(', ')}, which ` +
        'package.json does not list only under devDependencies. An exception only covers tools ' +
        'that never ship in the app, so update the dependency instead.'
    );
  }

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

    let acceptable = !shipping.has(entry);
    const stated = newestAffectedVersion(advisory.range);
    if (stated && compareVersions(stated, entry.affectedUpTo) !== 0) {
      warnings.push(
        `npm audit now lists ${advisory.package} as affected up to ${stated}, but the ` +
          `${entry.ghsa} exception says "affectedUpTo" is ${entry.affectedUpTo}. Check the ` +
          'advisory and correct the entry.'
      );
    }
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
    } catch (error) {
      warnings.push(
        `Could not check for a newer ${entry.package} release (${error.message}); skipped the ` +
          `fix-available check for ${entry.ghsa}.`
      );
      continue;
    }

    if (!parseVersion(latest)) {
      problems.push(
        `The registry answered "${latest}" for the newest ${entry.package} release, which is not ` +
          `a version, so the fix-available check for ${entry.ghsa} could not run. Run it again, ` +
          'and check by hand whether a patched release exists if it keeps happening.'
      );
    } else if (compareVersions(latest, entry.affectedUpTo) > 0) {
      problems.push(
        `${entry.package} ${latest} is published and newer than ${entry.affectedUpTo}, the ` +
          `last version the ${entry.ghsa} exception covers, so a fix may exist. Update to it ` +
          `and delete the exception. If ${latest} is still affected, review the advisory ` +
          'before raising "affectedUpTo".'
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
function check({ report, exceptionsData, packageJson, today, getLatestVersion }) {
  const { entries, errors } = parseExceptions(exceptionsData);
  if (errors.length > 0) {
    return {
      ok: false,
      stdout: [],
      stderr: [...errors.map((message) => `Error: ${message}`), 'Dependency audit failed.'],
    };
  }

  const advisories = collectAdvisories(report);
  const result = evaluate({
    advisories,
    untraced: findUntracedVulnerabilities(report),
    packageJson,
    exceptions: entries,
    today,
    getLatestVersion,
  });
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
    const packageJson = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'package.json'), 'utf8'));
    const { stdout, stderr, ok } = check({
      report: readAuditReport(),
      exceptionsData,
      packageJson,
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
  findUntracedVulnerabilities,
  parseAuditReport,
  parseExceptions,
};

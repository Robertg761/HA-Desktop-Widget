/**
 * @jest-environment node
 */

const fs = require('fs');
const path = require('path');
const {
  EXCEPTIONS_FILE,
  check,
  collectAdvisories,
  compareVersions,
  parseAuditReport,
  parseExceptions,
} = require('../../scripts/check-audit.cjs');

const ROOT = path.resolve(__dirname, '../..');
const BRACES = 'GHSA-vfj7-8cjw-p6xm';
const HTTP_CACHE = 'GHSA-ch52-4w7c-c8xp';

// A real `npm audit --json` report taken when both advisories were published,
// without the fixAvailable and nodes fields the checker never reads.
function auditReport() {
  return JSON.parse(
    fs.readFileSync(path.join(ROOT, 'tests/fixtures/npm-audit-report.json'), 'utf8')
  );
}

// Written out here, not read from the real exceptions file, so deleting an entry
// once a fix ships does not break these tests.
function exceptionsData() {
  return {
    exceptions: [
      {
        ghsa: BRACES,
        package: 'braces',
        affectedUpTo: '3.0.3',
        allowedVia: ['stylelint'],
        reason: 'Dev-only lint tool, not shipped, no patched release yet.',
        added: '2026-10-02',
        expires: '2026-10-31',
      },
      {
        ghsa: HTTP_CACHE,
        package: 'http-cache-semantics',
        affectedUpTo: '4.2.0',
        allowedVia: ['electron-builder'],
        reason: 'Build-time download tool, not shipped, no patched release yet.',
        added: '2026-10-02',
        expires: '2026-10-31',
      },
    ],
  };
}

function latestVersions(overrides = {}) {
  const versions = { braces: '3.0.3', 'http-cache-semantics': '4.2.0', ...overrides };
  return jest.fn((name) => {
    if (versions[name] instanceof Error) throw versions[name];
    return versions[name];
  });
}

function runCheck({ report = auditReport(), exceptions = exceptionsData(), ...options } = {}) {
  return check({
    report,
    exceptionsData: exceptions,
    today: '2026-10-02',
    getLatestVersion: latestVersions(),
    ...options,
  });
}

function addAdvisory(report, name, { ghsa, severity = 'high', effects = [], isDirect = true }) {
  report.vulnerabilities[name] = {
    name,
    severity,
    isDirect,
    via: [
      {
        source: 9999999,
        name,
        dependency: name,
        title: `${name} test advisory`,
        url: `https://github.com/advisories/${ghsa}`,
        severity,
        range: '<=1.0.0',
      },
    ],
    effects,
    range: '*',
  };
}

describe('collectAdvisories', () => {
  it('finds the two root advisories and the top-level packages they reach', () => {
    const advisories = collectAdvisories(auditReport());

    expect(advisories).toHaveLength(2);
    expect(advisories[0]).toMatchObject({
      ghsa: BRACES,
      package: 'braces',
      severity: 'high',
      range: '<=3.0.3',
      reaches: ['stylelint'],
    });
    expect(advisories[1]).toMatchObject({
      ghsa: HTTP_CACHE,
      package: 'http-cache-semantics',
      range: '<=4.2.0',
      reaches: ['electron-builder'],
    });
  });

  it('ignores advisories below high and string-only via pointers', () => {
    const report = { vulnerabilities: {} };
    addAdvisory(report, 'low-risk', { ghsa: 'GHSA-aaaa-bbbb-cccc', severity: 'moderate' });
    report.vulnerabilities.parent = { name: 'parent', via: ['low-risk'], effects: [] };

    expect(collectAdvisories(report)).toEqual([]);
  });

  it('treats critical advisories as blocking', () => {
    const report = { vulnerabilities: {} };
    addAdvisory(report, 'very-bad', { ghsa: 'GHSA-aaaa-bbbb-cccc', severity: 'critical' });

    expect(collectAdvisories(report)).toMatchObject([
      { package: 'very-bad', severity: 'critical' },
    ]);
  });

  it('also counts a directly installed package that sits in the middle of the chain', () => {
    const report = auditReport();
    report.vulnerabilities.micromatch.isDirect = true;

    expect(collectAdvisories(report)[0].reaches).toEqual(['micromatch', 'stylelint']);
  });

  it('survives cycles and effects that name a missing package', () => {
    const report = { vulnerabilities: {} };
    addAdvisory(report, 'a', { ghsa: 'GHSA-aaaa-bbbb-cccc', effects: ['b'], isDirect: false });
    addAdvisory(report, 'b', {
      ghsa: 'GHSA-dddd-eeee-ffff',
      effects: ['a', 'ghost'],
      isDirect: false,
    });

    const advisories = collectAdvisories(report);

    expect(advisories.find((item) => item.package === 'a').reaches).toEqual(['ghost']);
  });
});

describe('check', () => {
  it('excuses both current advisories and passes', () => {
    const getLatestVersion = latestVersions();
    const result = runCheck({ getLatestVersion });

    expect(result.ok).toBe(true);
    expect(result.stderr).toEqual([]);
    expect(result.stdout.join('\n')).toContain('npm audit reported 2 high or critical advisories.');
    expect(result.stdout.join('\n')).toContain(
      `${BRACES} braces <=3.0.3 via stylelint, excused until 2026-10-31`
    );
    expect(result.stdout.join('\n')).toContain(
      `${HTTP_CACHE} http-cache-semantics <=4.2.0 via electron-builder, excused until 2026-10-31`
    );
    expect(result.stdout).toContain('Dependency audit passed.');
    expect(getLatestVersion.mock.calls.map(([name]) => name).sort()).toEqual([
      'braces',
      'http-cache-semantics',
    ]);
  });

  it('passes a clean report with no exceptions', () => {
    const result = runCheck({ report: { vulnerabilities: {} }, exceptions: { exceptions: [] } });

    expect(result.ok).toBe(true);
    expect(result.stdout).toContain('npm audit reported 0 high or critical advisories.');
  });

  it('fails on an extra high advisory that has no exception', () => {
    const report = auditReport();
    addAdvisory(report, 'lodash', { ghsa: 'GHSA-xxxx-yyyy-zzzz' });

    const result = runCheck({ report });

    expect(result.ok).toBe(false);
    expect(result.stderr).toHaveLength(2);
    expect(result.stderr[0]).toContain('GHSA-xxxx-yyyy-zzzz (lodash <=1.0.0, high)');
    expect(result.stderr[0]).toContain('is not excused');
    expect(result.stderr[1]).toContain('failed with 1 problem');
    expect(result.stdout.join('\n')).toContain(BRACES);
  });

  it('does not let a GHSA id excuse a different package, or a package a different GHSA id', () => {
    const wrongPackage = exceptionsData();
    wrongPackage.exceptions[0].package = 'micromatch';
    const wrongId = exceptionsData();
    wrongId.exceptions[0].ghsa = 'GHSA-aaaa-bbbb-cccc';

    for (const exceptions of [wrongPackage, wrongId]) {
      const result = runCheck({ exceptions });
      const errors = result.stderr.join('\n');

      expect(result.ok).toBe(false);
      expect(errors).toContain(`${BRACES} (braces <=3.0.3, high)`);
      expect(errors).toContain('is not excused');
      expect(errors).toContain('matches no current high or critical advisory');
    }
  });

  it('fails when braces is reached through a top-level package that is not allowed', () => {
    const report = auditReport();
    report.vulnerabilities.express = {
      name: 'express',
      severity: 'high',
      isDirect: true,
      via: ['braces'],
      effects: [],
      range: '*',
    };
    report.vulnerabilities.braces.effects.push('express');

    const result = runCheck({ report });

    expect(result.ok).toBe(false);
    expect(result.stderr[0]).toContain(`${BRACES} (braces <=3.0.3, high)`);
    expect(result.stderr[0]).toContain('now reaches express');
    expect(result.stderr[0]).toContain('allowed: stylelint');
    expect(result.stdout.join('\n')).not.toContain(`${BRACES} braces`);
    expect(result.stdout.join('\n')).toContain(HTTP_CACHE);
  });

  it('fails when an allowed package is also reached through a directly installed middle package', () => {
    const report = auditReport();
    report.vulnerabilities.micromatch.isDirect = true;

    const result = runCheck({ report });

    expect(result.ok).toBe(false);
    expect(result.stderr[0]).toContain('now reaches micromatch');
  });

  it('fails once an exception has expired but still works on its last day', () => {
    expect(runCheck({ today: '2026-10-31' }).ok).toBe(true);

    const result = runCheck({ today: '2026-11-01' });

    expect(result.ok).toBe(false);
    expect(result.stderr).toHaveLength(3);
    expect(result.stderr[0]).toContain(`exception for ${BRACES} (braces) expired on 2026-10-31`);
    expect(result.stderr[1]).toContain(`exception for ${HTTP_CACHE}`);
    expect(result.stdout.join('\n')).not.toContain('excused until');
  });

  it('fails on a stale exception and asks for it to be deleted', () => {
    const report = auditReport();
    delete report.vulnerabilities.braces;
    delete report.vulnerabilities.micromatch;

    const getLatestVersion = latestVersions();
    const result = runCheck({ report, getLatestVersion });

    expect(result.ok).toBe(false);
    expect(result.stderr[0]).toContain(`exception for ${BRACES} (braces) matches no current`);
    expect(result.stderr[0]).toContain(`Delete it from ${EXCEPTIONS_FILE}`);
    expect(result.stdout.join('\n')).toContain(HTTP_CACHE);
    expect(getLatestVersion).not.toHaveBeenCalledWith('braces');
  });

  it('fails when a newer version than the exception covers has been published', () => {
    const result = runCheck({
      getLatestVersion: latestVersions({ braces: '3.0.4', 'http-cache-semantics': '4.1.9' }),
    });

    expect(result.ok).toBe(false);
    expect(result.stderr).toHaveLength(2);
    expect(result.stderr[0]).toContain('braces 3.0.4 is published and newer than 3.0.3');
    expect(result.stderr[0]).toContain('Update to it and delete the exception');
  });

  it('only warns when the registry cannot be reached', () => {
    const offline = new Error('getaddrinfo ENOTFOUND registry.npmjs.org');
    const result = runCheck({
      getLatestVersion: latestVersions({ braces: offline, 'http-cache-semantics': offline }),
    });

    expect(result.ok).toBe(true);
    expect(result.stdout).toContain('Dependency audit passed.');
    expect(result.stderr).toHaveLength(2);
    expect(result.stderr[0]).toContain('Warning: Could not check for a newer braces release');
    expect(result.stderr[0]).toContain('ENOTFOUND');
  });

  it('keeps every other check running when the registry cannot be reached', () => {
    const offline = new Error('network down');
    const result = runCheck({
      today: '2026-11-01',
      getLatestVersion: latestVersions({ braces: offline }),
    });

    expect(result.ok).toBe(false);
    expect(result.stderr.join('\n')).toContain('expired on 2026-10-31');
    expect(result.stderr.join('\n')).toContain('Warning: Could not check for a newer braces');
  });

  it('warns instead of guessing when the registry answers with something unusable', () => {
    const result = runCheck({ getLatestVersion: latestVersions({ braces: 'not-a-version' }) });

    expect(result.ok).toBe(true);
    expect(result.stderr[0]).toContain('Warning: Could not check for a newer braces release');
  });

  it('fails with the file problems when the exceptions file is malformed', () => {
    const result = runCheck({ exceptions: { exceptions: [{ ghsa: BRACES }] } });

    expect(result.ok).toBe(false);
    expect(result.stdout).toEqual([]);
    expect(result.stderr.at(-1)).toBe('Dependency audit failed.');
    expect(result.stderr.join('\n')).toContain('needs the vulnerable npm package name');
  });
});

describe('parseExceptions', () => {
  it('accepts the checked-in exceptions file', () => {
    const data = JSON.parse(fs.readFileSync(path.join(ROOT, EXCEPTIONS_FILE), 'utf8'));
    const { entries, errors } = parseExceptions(data);

    expect(errors).toEqual([]);
    expect(entries.length).toBe(data.exceptions.length);
  });

  it('reports every problem in an entry', () => {
    const entry = {
      ghsa: 'ghsa-nope',
      package: 'braces; rm -rf /',
      affectedUpTo: 'latest',
      allowedVia: [],
      reason: ' ',
      added: '2026-02-30',
      expires: 'soon',
      note: 'typo',
    };
    const { entries, errors } = parseExceptions({ exceptions: [entry] });

    expect(entries).toEqual([]);
    expect(errors).toHaveLength(8);
    expect(errors.join('\n')).toContain('unknown field "note"');
  });

  it('rejects duplicate entries and an expiry before the added date', () => {
    const data = exceptionsData();
    data.exceptions.push({ ...data.exceptions[0] });
    data.exceptions[1].expires = '2026-09-01';

    const { errors } = parseExceptions(data);

    expect(errors.some((message) => message.includes('expires before it was added'))).toBe(true);
    expect(errors.some((message) => message.includes(`duplicates ${BRACES}`))).toBe(true);
  });

  it('rejects a file that is not an exceptions list', () => {
    expect(parseExceptions([]).errors).toHaveLength(1);
    expect(parseExceptions({ exceptions: ['braces'] }).errors).toEqual([
      `${EXCEPTIONS_FILE} entry 1 must be an object.`,
    ]);
  });
});

describe('parseAuditReport', () => {
  it('returns the parsed report, including the clean case', () => {
    expect(parseAuditReport('{"vulnerabilities":{}}')).toEqual({ vulnerabilities: {} });
    expect(parseAuditReport(JSON.stringify(auditReport())).vulnerabilities.braces.name).toBe(
      'braces'
    );
  });

  it('refuses to pass when npm audit could not produce a report', () => {
    expect(() =>
      parseAuditReport('{"message":"connect ECONNREFUSED","error":{"summary":"","detail":""}}')
    ).toThrow('npm audit failed: connect ECONNREFUSED');
    expect(() => parseAuditReport('{"error":{"code":"ENOTFOUND","summary":"offline"}}')).toThrow(
      'npm audit failed: offline'
    );
    expect(() => parseAuditReport('{"error":{"code":"EAUDIT"}}')).toThrow(
      'npm audit failed: EAUDIT'
    );
    expect(() => parseAuditReport('')).toThrow('did not return JSON');
    expect(() => parseAuditReport('{"auditReportVersion":2}')).toThrow('unexpected report');
    expect(() => parseAuditReport('null')).toThrow('unexpected report');
  });
});

describe('compareVersions', () => {
  it.each([
    ['3.0.4', '3.0.3', 1],
    ['3.0.3', '3.0.3', 0],
    ['3.0.2', '3.0.3', -1],
    ['4.0.0', '3.9.9', 1],
    ['3.10.0', '3.9.0', 1],
    ['27.0.0-alpha.2', '26.6.0', 1],
    ['27.0.0-alpha.2', '27.0.0', -1],
    ['27.0.0-alpha.2', '27.0.0-alpha.10', -1],
    ['27.0.0-alpha', '27.0.0-alpha.1', -1],
    ['27.0.0-alpha.1', '27.0.0-beta', -1],
    ['27.0.0-1', '27.0.0-alpha', -1],
    ['3.0.3+build.5', '3.0.3', 0],
  ])('compares %s with %s as %i', (a, b, expected) => {
    expect(compareVersions(a, b)).toBe(expected);
  });

  it('throws for values that are not versions', () => {
    expect(() => compareVersions('latest', '1.0.0')).toThrow('Cannot compare versions');
  });
});

describe('CI wiring', () => {
  const ci = fs.readFileSync(path.join(ROOT, '.github/workflows/ci.yml'), 'utf8');
  const auditJob = ci.slice(ci.indexOf('\n  audit:'), ci.indexOf('\n  lint-and-test:'));
  const otherJobs = ci.slice(ci.indexOf('\n  lint-and-test:'));

  it('runs the checker in the audit job without installing dependencies', () => {
    expect(auditJob).toContain('run: node scripts/check-audit.cjs');
    expect(auditJob).not.toContain('npm ci');
    expect(auditJob).not.toContain('npm audit');
    expect(auditJob).toContain("node-version: '20'");
  });

  it('lets an audit failure stand alone instead of cancelling lint, tests, and packaging', () => {
    expect(auditJob).not.toContain('gh run cancel');
    expect(otherJobs.match(/gh run cancel/g)).toHaveLength(3);
  });

  it('keeps auditing devDependencies, where the Electron runtime lives', () => {
    const source = fs.readFileSync(path.join(ROOT, 'scripts/check-audit.cjs'), 'utf8');

    expect(source).toContain("runNpm(['audit', '--json'])");
    expect(source).not.toMatch(/--omit|--production|--only/);
  });
});

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
  findUntracedVulnerabilities,
  parseAuditReport,
  parseExceptions,
} = require('../../scripts/check-audit.cjs');

const ROOT = path.resolve(__dirname, '../..');
const BRACES = 'GHSA-vfj7-8cjw-p6xm';
const HTTP_CACHE = 'GHSA-ch52-4w7c-c8xp';

// A real `npm audit --json` report taken when both advisories were published,
// without the fixAvailable and nodes fields the checker never reads. Pass the
// npm 10 fixture for the report CI gets on Node 20: the same tree, but npm 10
// leaves out the effects that point back along app-builder-lib's peer-dependency
// cycle.
function auditReport(fixture = 'npm-audit-report.json') {
  return JSON.parse(fs.readFileSync(path.join(ROOT, 'tests/fixtures', fixture), 'utf8'));
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

// The two tools the checked-in exceptions allow, listed the way the real
// package.json lists them, next to a runtime dependency.
function packageJson() {
  return {
    dependencies: { 'electron-updater': '^6.0.0' },
    devDependencies: { stylelint: '^16.0.0', 'electron-builder': '^26.0.0' },
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
    packageJson: packageJson(),
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

// What the report looks like once a fix ships and braces drops out of the tree:
// every entry that was only vulnerable because of it goes too.
function withoutBraces(report) {
  for (const name of ['braces', 'micromatch', 'fast-glob', 'globby', 'stylelint']) {
    delete report.vulnerabilities[name];
  }
  return report;
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

  it('reaches the same top-level packages in the report npm 10 writes', () => {
    const advisories = collectAdvisories(auditReport('npm-audit-report-npm10.json'));

    expect(advisories.map(({ package: name, reaches }) => [name, reaches])).toEqual([
      ['braces', ['stylelint']],
      ['http-cache-semantics', ['electron-builder']],
    ]);
    expect(findUntracedVulnerabilities(auditReport('npm-audit-report-npm10.json'))).toEqual([]);
  });

  it('reads the missing side of a dependency cycle from via', () => {
    const report = { vulnerabilities: {} };
    addAdvisory(report, 'root', { ghsa: 'GHSA-aaaa-bbbb-cccc', effects: ['a'], isDirect: false });
    report.vulnerabilities.a = {
      name: 'a',
      severity: 'high',
      isDirect: false,
      via: ['root', 'b'],
      effects: ['app', 'b'],
    };
    // b depends on a and a on b, but this report only wrote one direction.
    report.vulnerabilities.b = {
      name: 'b',
      severity: 'high',
      isDirect: false,
      via: ['a'],
      effects: [],
    };
    report.vulnerabilities.app = {
      name: 'app',
      severity: 'high',
      isDirect: true,
      via: ['a'],
      effects: [],
    };

    expect(collectAdvisories(report)[0].reaches).toEqual(['app']);
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

describe('findUntracedVulnerabilities', () => {
  it('finds nothing in a complete report', () => {
    expect(findUntracedVulnerabilities(auditReport())).toEqual([]);
    expect(findUntracedVulnerabilities({ vulnerabilities: {} })).toEqual([]);
  });

  it('flags a high entry that points at a package the report does not contain', () => {
    const report = auditReport();
    report.vulnerabilities.evil = {
      name: 'evil',
      severity: 'high',
      isDirect: true,
      via: ['nonexistent'],
      effects: [],
    };

    expect(findUntracedVulnerabilities(report)).toEqual(['evil']);
  });

  it('flags a high entry whose only link is a root that is below high', () => {
    const report = auditReport();
    addAdvisory(report, 'minor', { ghsa: 'GHSA-aaaa-bbbb-cccc', severity: 'moderate' });
    report.vulnerabilities.stray = {
      name: 'stray',
      severity: 'high',
      isDirect: true,
      via: ['minor'],
      effects: [],
    };

    expect(findUntracedVulnerabilities(report)).toEqual(['stray']);
  });

  it('counts a link that only one side of the report mentions', () => {
    const viaOnly = auditReport();
    viaOnly.vulnerabilities.stray = {
      name: 'stray',
      severity: 'high',
      isDirect: false,
      via: ['braces'],
      effects: [],
    };
    const effectsOnly = auditReport();
    effectsOnly.vulnerabilities.stray = {
      name: 'stray',
      severity: 'high',
      isDirect: false,
      via: [],
      effects: [],
    };
    effectsOnly.vulnerabilities.braces.effects.push('stray');

    expect(findUntracedVulnerabilities(viaOnly)).toEqual([]);
    expect(findUntracedVulnerabilities(effectsOnly)).toEqual([]);
  });

  it('ignores entries below high, however they are linked', () => {
    const report = auditReport();
    report.vulnerabilities.minor = { name: 'minor', severity: 'low', via: ['ghost'], effects: [] };

    expect(findUntracedVulnerabilities(report)).toEqual([]);
  });

  it('follows effects through cycles and tolerates malformed entries', () => {
    const report = { vulnerabilities: {} };
    addAdvisory(report, 'root', { ghsa: 'GHSA-aaaa-bbbb-cccc', effects: ['a'], isDirect: false });
    report.vulnerabilities.a = { severity: 'high', via: ['root', 'b'], effects: ['b'] };
    report.vulnerabilities.b = { severity: 'high', via: ['a'], effects: ['a', 'root'] };
    report.vulnerabilities.broken = { severity: 'high', via: 'root', effects: 'a' };
    report.vulnerabilities.empty = null;

    expect(findUntracedVulnerabilities(report)).toEqual(['broken']);
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

  it('passes on the report npm 10 writes, which is what the Node 20 CI job gets', () => {
    const result = runCheck({ report: auditReport('npm-audit-report-npm10.json') });

    expect(result.ok).toBe(true);
    expect(result.stderr).toEqual([]);
    expect(result.stdout.join('\n')).toContain(
      `${HTTP_CACHE} http-cache-semantics <=4.2.0 via electron-builder`
    );
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
    const getLatestVersion = latestVersions();
    const result = runCheck({ report: withoutBraces(auditReport()), getLatestVersion });

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

  it('fails instead of skipping the check when the registry answers with something unusable', () => {
    const result = runCheck({ getLatestVersion: latestVersions({ braces: 'not-a-version' }) });

    expect(result.ok).toBe(false);
    expect(result.stderr).toHaveLength(2);
    expect(result.stderr[0]).toContain(
      'The registry answered "not-a-version" for the newest braces'
    );
    expect(result.stderr[0]).toContain('not a version');
    expect(result.stderr.join('\n')).not.toContain('Warning');
  });

  it('fails on an empty registry answer too', () => {
    const result = runCheck({ getLatestVersion: latestVersions({ 'http-cache-semantics': '' }) });

    expect(result.ok).toBe(false);
    expect(result.stderr[0]).toContain(
      'The registry answered "" for the newest http-cache-semantics'
    );
  });

  it('fails when a high entry cannot be traced to any advisory', () => {
    const report = auditReport();
    report.vulnerabilities.evil = {
      name: 'evil',
      severity: 'high',
      isDirect: true,
      via: ['nonexistent'],
      effects: [],
    };

    const result = runCheck({ report });

    expect(result.ok).toBe(false);
    expect(result.stderr).toHaveLength(2);
    expect(result.stderr[0]).toContain('entries for evil do not lead back to any advisory');
    expect(result.stderr[0]).toContain('could not be fully traced');
    expect(result.stderr[1]).toContain('failed with 1 problem');
    expect(result.stdout.join('\n')).toContain('excused until');
  });

  it('fails when an exception allows a package that ships in the app', () => {
    const buildTool = { 'electron-builder': '^26.0.0' };
    const stylelint = { stylelint: '^16.0.0' };

    for (const shipped of [
      { dependencies: stylelint, devDependencies: { ...buildTool, ...stylelint } },
      { optionalDependencies: stylelint, devDependencies: { ...buildTool, ...stylelint } },
      { dependencies: stylelint, devDependencies: buildTool },
      { devDependencies: buildTool },
    ]) {
      const result = runCheck({ packageJson: shipped });
      const errors = result.stderr.join('\n');

      expect(result.ok).toBe(false);
      expect(errors).toContain(`exception for ${BRACES} (braces) allows stylelint`);
      expect(errors).toContain('does not list only under devDependencies');
      expect(errors).not.toContain(HTTP_CACHE);
      expect(result.stdout.join('\n')).not.toContain(`${BRACES} braces`);
      expect(result.stdout.join('\n')).toContain(`${HTTP_CACHE} http-cache-semantics`);
    }
  });

  it('checks the allowed packages of a stale exception too, and reports one problem each', () => {
    const result = runCheck({
      report: withoutBraces(auditReport()),
      packageJson: { devDependencies: {} },
    });

    expect(result.stderr.filter((line) => line.includes('allows'))).toHaveLength(2);
    expect(result.stderr.filter((line) => line.includes('matches no current'))).toHaveLength(1);
  });

  it('warns when npm audit states a different newest affected version than the exception', () => {
    for (const [range, stated] of [
      ['<=3.0.4', '3.0.4'],
      ['>=3.0.0 <=3.0.2', '3.0.2'],
    ]) {
      const report = auditReport();
      report.vulnerabilities.braces.via[0].range = range;

      const result = runCheck({ report });

      expect(result.ok).toBe(true);
      expect(result.stderr).toHaveLength(1);
      expect(result.stderr[0]).toContain(`braces as affected up to ${stated}`);
      expect(result.stderr[0]).toContain('"affectedUpTo" is 3.0.3');
    }
  });

  it('stays quiet about ranges it cannot read or that match the exception', () => {
    for (const range of ['<=3.0.3', '<3.0.4', '*', '']) {
      const report = auditReport();
      report.vulnerabilities.braces.via[0].range = range;

      const result = runCheck({ report });

      expect(result.ok).toBe(true);
      expect(result.stderr).toEqual([]);
    }
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

  it('only lets the checked-in exceptions name dev-only packages', () => {
    const data = JSON.parse(fs.readFileSync(path.join(ROOT, EXCEPTIONS_FILE), 'utf8'));
    const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
    const names = data.exceptions.flatMap((entry) => entry.allowedVia);

    for (const name of names) {
      expect(Object.keys(pkg.devDependencies)).toContain(name);
      expect(Object.keys(pkg.dependencies)).not.toContain(name);
      expect(Object.keys(pkg.optionalDependencies || {})).not.toContain(name);
    }
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
  const release = fs.readFileSync(path.join(ROOT, '.github/workflows/release.yml'), 'utf8');
  const auditJob = ci.slice(ci.indexOf('\n  audit:'), ci.indexOf('\n  lint-and-test:'));
  const otherJobs = ci.slice(ci.indexOf('\n  lint-and-test:'));

  it('runs the checker in the audit job without installing dependencies', () => {
    expect(auditJob).toContain('run: node scripts/check-audit.cjs');
    expect(auditJob).not.toContain('npm ci');
    expect(auditJob).not.toContain('npm audit');
    expect(auditJob).toContain("node-version: '20'");
  });

  it('gates a release on the same checker, after dependencies are installed', () => {
    const validateJob = release.slice(
      release.indexOf('\n  validate:'),
      release.indexOf('\n  build:')
    );
    const installed = validateJob.indexOf('run: npm ci');
    const audited = validateJob.indexOf('run: node scripts/check-audit.cjs');

    expect(installed).toBeGreaterThan(-1);
    expect(audited).toBeGreaterThan(installed);
    expect(release).not.toMatch(/run:\s*npm audit/);
    expect(release.match(/check-audit\.cjs/g)).toHaveLength(1);
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

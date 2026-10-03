/**
 * @jest-environment node
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const {
  EXCEPTIONS_FILE,
  check,
  collectAdvisories,
  compareVersions,
  findShippedPackages,
  findUntracedVulnerabilities,
  parseAuditReport,
  parseExceptions,
  readBuilderFiles,
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

// What findShippedPackages() says for the fixture package.json above: Electron's
// runtime and the one runtime dependency, and nothing that stylelint or
// electron-builder would be in.
function shippedPackages() {
  return new Map([
    ['electron', 'its runtime is in every package'],
    ['electron-updater', 'listed under dependencies'],
  ]);
}

function realPackageJson() {
  return JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
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
    shippedPackages: shippedPackages(),
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

const projects = [];

// Builds a small project in a temporary directory from { 'relative/path': text }.
function project(files) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'check-audit-'));
  projects.push(root);
  for (const [file, text] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
    fs.writeFileSync(path.join(root, file), text);
  }
  return root;
}

afterEach(() => {
  for (const root of projects.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

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

  it('lists every package between each advisory and the top-level ones, in both reports', () => {
    for (const fixture of ['npm-audit-report.json', 'npm-audit-report-npm10.json']) {
      const advisories = collectAdvisories(auditReport(fixture));

      expect(advisories.map(({ package: name, pathPackages }) => [name, pathPackages])).toEqual([
        ['braces', ['braces', 'fast-glob', 'globby', 'micromatch', 'stylelint']],
        [
          'http-cache-semantics',
          [
            '@electron/get',
            'app-builder-lib',
            'cacheable-request',
            'dmg-builder',
            'electron-builder',
            'electron-builder-squirrel-windows',
            'got',
            'http-cache-semantics',
          ],
        ],
      ]);
    }
  });

  it('keeps the path of a package that no advisory reaches through, and merges repeats', () => {
    const report = { vulnerabilities: {} };
    for (const [name, parent] of [
      ['one', 'top-one'],
      ['two', 'top-two'],
    ]) {
      addAdvisory(report, name, {
        ghsa: 'GHSA-aaaa-bbbb-cccc',
        effects: [parent],
        isDirect: false,
      });
      // Both entries carry the same advisory for the same package.
      report.vulnerabilities[name].via[0].name = 'shared';
      report.vulnerabilities[parent] = {
        name: parent,
        severity: 'high',
        isDirect: true,
        via: [name],
        effects: [],
      };
    }

    expect(collectAdvisories(report)).toMatchObject([
      {
        package: 'shared',
        reaches: ['top-one', 'top-two'],
        pathPackages: ['one', 'shared', 'top-one', 'top-two', 'two'],
      },
    ]);
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

  it('fails when the app imports braces, which an allowed dev-only tool also pulls in', () => {
    const pkg = packageJson();
    const root = project({ 'main.js': "const braces = require('braces');\n" });

    const result = runCheck({ packageJson: pkg, shippedPackages: findShippedPackages(root, pkg) });

    expect(result.ok).toBe(false);
    expect(result.stderr).toHaveLength(2);
    expect(result.stderr[0]).toContain(`${BRACES} (braces <=3.0.3, high)`);
    expect(result.stderr[0]).toContain('braces (imported by main.js) ships in the app');
    expect(result.stderr[0]).toContain('on the path from the advisory to stylelint');
    expect(result.stderr[1]).toContain('failed with 1 problem');
    expect(result.stdout.join('\n')).not.toContain(`${BRACES} braces`);
    expect(result.stdout.join('\n')).toContain(`${HTTP_CACHE} http-cache-semantics`);
  });

  it('fails when the app imports got, a package between http-cache-semantics and the build tool', () => {
    const pkg = packageJson();
    const root = project({ 'src/download.js': "import got from 'got';\n" });

    const result = runCheck({ packageJson: pkg, shippedPackages: findShippedPackages(root, pkg) });

    expect(result.ok).toBe(false);
    expect(result.stderr).toHaveLength(2);
    expect(result.stderr[0]).toContain(`${HTTP_CACHE} (http-cache-semantics <=4.2.0, high)`);
    expect(result.stderr[0]).toContain('got (imported by src/download.js) ships in the app');
    expect(result.stderr[0]).toContain('on the path from the advisory to electron-builder');
    expect(result.stdout.join('\n')).not.toContain(`${HTTP_CACHE} http-cache-semantics`);
    expect(result.stdout.join('\n')).toContain(`${BRACES} braces`);
  });

  // Every package from the advisory up to the top-level ones, in both reports.
  it.each([
    ...['braces', 'micromatch', 'fast-glob', 'globby'].map((name) => [BRACES, name, 'stylelint']),
    ...[
      'http-cache-semantics',
      'cacheable-request',
      'got',
      '@electron/get',
      'app-builder-lib',
      'dmg-builder',
      'electron-builder-squirrel-windows',
    ].map((name) => [HTTP_CACHE, name, 'electron-builder']),
  ])('fails the %s exception when the app ships %s, which is on its path', (ghsa, name, top) => {
    for (const fixture of ['npm-audit-report.json', 'npm-audit-report-npm10.json']) {
      const shipped = shippedPackages().set(name, 'imported by main.js');

      const result = runCheck({ report: auditReport(fixture), shippedPackages: shipped });
      const errors = result.stderr.join('\n');
      const other = ghsa === BRACES ? HTTP_CACHE : BRACES;

      expect(result.ok).toBe(false);
      expect(errors).toContain(`${ghsa} (`);
      expect(errors).toContain(
        `cannot be excused because ${name} (imported by main.js) ships in the app`
      );
      expect(errors).toContain(`on the path from the advisory to ${top}`);
      expect(errors).not.toContain(other);
      expect(result.stdout.join('\n')).not.toContain(`${ghsa} `);
      expect(result.stdout.join('\n')).toContain(`${other} `);
    }
  });

  it('lists every shipped package on the path in one problem', () => {
    const shipped = shippedPackages()
      .set('micromatch', 'imported by main.js')
      .set('fast-glob', 'listed under dependencies');

    const result = runCheck({ shippedPackages: shipped });
    const errors = result.stderr.filter((line) => line.includes('cannot be excused'));

    expect(result.ok).toBe(false);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain(
      'fast-glob (listed under dependencies), micromatch (imported by main.js) ship in the app ' +
        'and are on the path from the advisory to stylelint'
    );
  });

  it('reports an allowed package that ships once, without repeating it for the path', () => {
    const shipped = shippedPackages().set('stylelint', 'imported by main.js');

    const result = runCheck({ shippedPackages: shipped });
    const errors = result.stderr.filter((line) => line.includes('stylelint'));

    expect(result.ok).toBe(false);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain(`exception for ${BRACES} (braces) allows stylelint`);
    expect(result.stderr.join('\n')).not.toContain('cannot be excused');
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

  it.each(['electron', 'hls.js', 'sortablejs'])(
    'rejects an exception that allows %s, a devDependency that ships in the app',
    (name) => {
      const pkg = realPackageJson();
      const exceptions = exceptionsData();
      exceptions.exceptions[0].allowedVia = [name];

      // The real package.json and a scan of the real sources, not fixtures: this
      // is what the audit job decides with.
      expect(Object.keys(pkg.devDependencies)).toContain(name);
      const result = runCheck({
        exceptions,
        packageJson: pkg,
        shippedPackages: findShippedPackages(ROOT, pkg),
      });
      const errors = result.stderr.join('\n');

      expect(result.ok).toBe(false);
      expect(errors).toContain(`exception for ${BRACES} (braces) allows ${name} (`);
      expect(errors).toContain('ships in the app');
      expect(errors).not.toContain('does not list only under devDependencies');
      expect(result.stdout.join('\n')).not.toContain(`${BRACES} braces`);
    }
  );

  it('still passes the build tools the checked-in exceptions allow, against the real sources', () => {
    const pkg = realPackageJson();
    const result = runCheck({ packageJson: pkg, shippedPackages: findShippedPackages(ROOT, pkg) });

    expect(result.stderr).toEqual([]);
    expect(result.ok).toBe(true);
    expect(result.stdout.join('\n')).toContain(`${BRACES} braces`);
    expect(result.stdout.join('\n')).toContain(`${HTTP_CACHE} http-cache-semantics`);
  });

  it('lists every shipped package an exception allows, in one problem', () => {
    const exceptions = exceptionsData();
    exceptions.exceptions[0].allowedVia = ['stylelint', 'hls.js', 'sortablejs'];
    const result = runCheck({
      exceptions,
      packageJson: {
        devDependencies: { stylelint: '^16.0.0', 'hls.js': '^1.0.0', sortablejs: '^1.0.0' },
      },
      shippedPackages: new Map([
        ['hls.js', 'imported by src/camera.js'],
        ['sortablejs', 'imported by src/ui.js'],
      ]),
    });
    const errors = result.stderr.filter((line) => line.includes(`exception for ${BRACES}`));

    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain(
      'allows hls.js (imported by src/camera.js), sortablejs (imported by src/ui.js), which ship in the app'
    );
    expect(errors[0]).not.toContain('stylelint');
  });

  it('reports a package that is both in dependencies and shipped once, as not dev-only', () => {
    const result = runCheck({
      packageJson: {
        dependencies: { stylelint: '^16.0.0' },
        devDependencies: { 'electron-builder': '^26.0.0', stylelint: '^16.0.0' },
      },
      shippedPackages: new Map([['stylelint', 'listed under dependencies']]),
    });

    expect(result.stderr.filter((line) => line.includes('allows stylelint'))).toHaveLength(1);
    expect(result.stderr.join('\n')).toContain('does not list only under devDependencies');
  });

  it('refuses to run without the packages that ship in the app', () => {
    expect(() => runCheck({ shippedPackages: undefined })).toThrow('needs the packages that ship');
    expect(() => runCheck({ shippedPackages: ['electron'] })).toThrow('as a Map');
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

    const shipped = findShippedPackages(ROOT, pkg);

    for (const name of names) {
      expect(Object.keys(pkg.devDependencies)).toContain(name);
      expect(Object.keys(pkg.dependencies)).not.toContain(name);
      expect(Object.keys(pkg.optionalDependencies || {})).not.toContain(name);
      expect(shipped.has(name)).toBe(false);
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

describe('findShippedPackages', () => {
  const viteConfig = `
    export default defineConfig({
      resolve: {
        alias: {
          // Dev-only fixture, resolved to a path.
          '@dev-fixture': resolve(
            __dirname,
            isProduction ? 'src/fixture.production.js' : 'development/fixture.js'
          ),
          '@': resolve(__dirname, 'src'),
          '@acme/shared': resolve(__dirname, 'packages/shared/src'),
          events: 'events',
          'hls.js': 'hls.js/dist/hls.light.mjs',
        },
      },
    });
  `;

  it('always counts Electron, dependencies and optionalDependencies', () => {
    const shipped = findShippedPackages(project({}), {
      dependencies: { 'electron-updater': '^6.0.0' },
      optionalDependencies: { 'uiohook-napi': '^1.0.0' },
      devDependencies: { stylelint: '^16.0.0' },
    });

    expect([...shipped.keys()].sort()).toEqual(['electron', 'electron-updater', 'uiohook-napi']);
    expect(shipped.get('electron')).toContain('every package');
    expect(shipped.get('electron-updater')).toBe('listed under dependencies');
    expect(shipped.get('uiohook-napi')).toBe('listed under optionalDependencies');
  });

  it('finds every kind of import, including scoped names and subpaths', () => {
    const root = project({
      'main.js': `
        const a = require('plain-require');
        const b = require.resolve('resolved-only');
        const c = require(\`template-literal\`);
        const d = require(variable);
        const e = require(\`\${variable}\`);
      `,
      'src/esm.js': `
        import defaultThing from 'default-import';
        import { first, second } from 'named-import';
        import {
          wrapped,
          // a comment with an apostrophe: don't stop here
          lines,
        } from 'multi-line';
        import * as everything from 'star-import';
        import 'side-effect';
        export { re } from 'reexport';
        export * from 'reexport-all';
        const lazy = () => import('dynamic-import');
        const scoped = require('@scope/pkg');
        import sub from 'pkg-with/sub/path.js';
        import scopedSub from '@scope/other/deep/file.js';
        import './sibling.js';
        import up from '../up.js';
        import abs from '/absolute.js';
        import fs from 'fs';
        import { readFile } from 'fs/promises';
        import path from 'node:path';
        import data from 'data:text/javascript,export default 1';
        const sentence = "Copied from 'a sentence with spaces'";
      `,
    });
    const names = [...findShippedPackages(root, {}).keys()].sort();

    expect(names).toEqual([
      '@scope/other',
      '@scope/pkg',
      'default-import',
      'dynamic-import',
      'electron',
      'multi-line',
      'named-import',
      'pkg-with',
      'plain-require',
      'reexport',
      'reexport-all',
      'resolved-only',
      'side-effect',
      'star-import',
      'template-literal',
    ]);
  });

  it('finds imports that a bundler still resolves: templates, comments and queries', () => {
    const root = project({
      'src/forms.js': `
        const a = import(\`template-import\`);
        const b = require(\`template-require\`);
        const c = require.resolve(\`template-resolve\`);
        const d = import(/* webpackChunkName: "x" */ 'block-comment');
        const e = import(/* @vite-ignore */ \`ignore-hint\`);
        const f = require(/* first */ /* second */
          'two-comments');
        const g = import(
          // explained here
          'line-comment'
        );
        import h from /* source */ 'from-comment';
        import i from 'bare-query?raw';
        import j from 'subpath-query/style.css?inline';
        import k from '@scope/scoped-query?url';
        import l from 'bare-hash#fragment';
        import m from '@scope/scoped-subpath/file.js?worker&inline';
        const n = import(\`interpolated-subpath/\${file}\`);
      `,
    });
    const names = [...findShippedPackages(root, {}).keys()].sort();

    expect(names).toEqual([
      '@scope/scoped-query',
      '@scope/scoped-subpath',
      'bare-hash',
      'bare-query',
      'block-comment',
      'electron',
      'from-comment',
      'ignore-hint',
      'interpolated-subpath',
      'line-comment',
      'subpath-query',
      'template-import',
      'template-require',
      'template-resolve',
      'two-comments',
    ]);
  });

  it('skips specifiers that name no package, however they are written', () => {
    const root = project({
      'src/not-packages.js': `
        const a = import(\`\${name}\`);
        const b = require(\`pkg-\${suffix}\`);
        const c = import(\`@\${scope}/pkg\`);
        const d = import(\`./local-\${locale}.js\`);
        const e = import(/* @vite-ignore */ name);
        const f = import(/* 'looks-like-a-string' */ name);
        const g = require(// 'also-not-a-string'
          name
        );
        import local from './local.js?raw';
        import absolute from '/absolute.js?url';
        import node from 'node:fs?x';
        import virtual from 'virtual:module?x=a:b';
        import internal from '#internal';
        import queryOnly from '?raw';
        const prose = "runs from \`before\` days ahead";
      `,
    });

    expect([...findShippedPackages(root, {}).keys()]).toEqual(['electron']);
  });

  it('finds packages that a stylesheet imports', () => {
    const root = project({
      'electron-builder.yml': ['files:', '  - styles.css', '  - main.js', ''].join('\n'),
      'styles.css': `
        /* a comment, then the imports */
        @import 'plain-css/theme.css';
        @import url("quoted-url/reset.css");
        @import url('@scope/styles/base.css') layer(base);
        @import /* hint */ 'with-comment';
        @import 'bare-query?inline';
        @import './local.css';
        @import '../up.css';
        @import '/absolute.css';
        @import url('https://fonts.example/css?family=Inter');
        @import url(unquoted/reset.css);
        @import url( spaced-unquoted/reset.css );
        @import url(https://fonts.example/unquoted.css);
        @import url(//cdn.example/protocol-relative.css);
        .a { background: url('image.png'); }
      `,
      'src/panel.css': "@import 'in-src/panel.css';",
      'website/site.css': "@import 'not-packed/site.css';",
    });
    const names = [...findShippedPackages(root, {}).keys()].sort();

    expect(names).toEqual([
      '@scope/styles',
      'bare-query',
      'electron',
      'in-src',
      'plain-css',
      'quoted-url',
      'spaced-unquoted',
      'unquoted',
      'with-comment',
    ]);
  });

  it('does not take a template literal after from or a bare import for a specifier', () => {
    const root = project({
      'src/prose.js': "// Each holiday runs from `before` days ahead.\nconst s = 'import `after`';",
    });

    expect([...findShippedPackages(root, {}).keys()]).toEqual(['electron']);
  });

  it('keeps reading when a call has many comments before something it cannot use', () => {
    // A block comment read lazily can end at any later one, which takes 2^n tries.
    const comments = '/* a */ '.repeat(30);
    const root = project({
      'src/comments.js': `import(${comments}name);\nimport(${comments}'after-comments');`,
      'src/unfinished.js': `import(${'/* a\n'.repeat(500)}`,
    });

    const started = Date.now();
    const names = [...findShippedPackages(root, {}).keys()].sort();

    expect(names).toEqual(['after-comments', 'electron']);
    expect(Date.now() - started).toBeLessThan(2000);
  });

  it('counts a devDependency that app source imports, and says which file', () => {
    const files = { 'main.js': "require('electron');", 'src/feature.js': "import 'stylelint';" };
    const pkg = {
      devDependencies: { stylelint: '^16.0.0', 'electron-builder': '^26.0.0' },
    };
    const shipped = findShippedPackages(project(files), pkg);

    expect(shipped.get('stylelint')).toBe('imported by src/feature.js');
    expect(shipped.has('electron-builder')).toBe(false);

    // The same exception that passes without the import is rejected with it.
    const before = findShippedPackages(project({ 'main.js': "require('electron');" }), pkg);
    const withoutImport = runCheck({ packageJson: pkg, shippedPackages: before });
    const withImport = runCheck({ packageJson: pkg, shippedPackages: shipped });

    expect(withoutImport.ok).toBe(true);
    expect(withImport.ok).toBe(false);
    expect(withImport.stderr.join('\n')).toContain(
      `exception for ${BRACES} (braces) allows stylelint (imported by src/feature.js), which ships in the app`
    );
    expect(withImport.stderr.join('\n')).not.toContain(HTTP_CACHE);
  });

  it('does not take the vite aliases or workspace packages for npm packages', () => {
    const root = project({
      'vite.config.js': viteConfig,
      'package.json': '{}',
      'packages/shared/package.json': '{ "name": "@acme/shared" }',
      'packages/widgets/package.json': '{ "name": "@acme/widgets" }',
      'src/app.js': `
        import { thing } from '@acme/shared/thing.js';
        import widget from '@acme/widgets/widget.js';
        import { ui } from '@/ui.js';
        import fixture from '@dev-fixture';
        import { EventEmitter } from 'events';
        import Hls from 'hls.js';
        import { x } from 'real-package';
      `,
    });
    const names = [...findShippedPackages(root, { workspaces: ['packages/*'] }).keys()].sort();

    expect(names).toEqual(['electron', 'events', 'hls.js', 'real-package']);
  });

  it('counts a bare Node built-in as a built-in unless a vite alias makes it a package', () => {
    const source = "import { EventEmitter } from 'events'; import { join } from 'path';";
    const withAlias = project({ 'vite.config.js': viteConfig, 'src/a.js': source });
    const withoutAlias = project({ 'src/a.js': source });

    expect(findShippedPackages(withAlias, {}).has('events')).toBe(true);
    expect(findShippedPackages(withAlias, {}).has('path')).toBe(false);
    expect(findShippedPackages(withoutAlias, {}).has('events')).toBe(false);
  });

  it('follows an alias to the package it points at', () => {
    const root = project({
      'vite.config.js':
        'export default { resolve: { alias: { shim: "real-shim/dist/index.js" } } };',
      'src/a.js': "import shim from 'shim'; import sub from 'shim/extra';",
    });
    const names = [...findShippedPackages(root, {}).keys()].sort();

    expect(names).toEqual(['electron', 'real-shim']);
  });

  it('reads a query on an aliased name the way vite does', () => {
    const root = project({
      'vite.config.js': viteConfig,
      'package.json': '{}',
      'packages/shared/package.json': '{ "name": "@acme/shared" }',
      'src/a.js': `
        import raw from 'hls.js/dist/hls.js?raw';
        import own from '@/ui.js?raw';
        import shared from '@acme/shared?inline';
        import events from 'events?raw';
        import fixture from '@dev-fixture?url';
      `,
    });
    const names = [...findShippedPackages(root, { workspaces: ['packages/*'] }).keys()].sort();

    // vite's alias plugin compares the whole specifier, query included, so
    // 'events?raw' is not the aliased 'events' and does not name a package.
    expect(names).toEqual(['electron', 'hls.js']);
  });

  it('scans the paths electron-builder packs and the entries vite bundles, and nothing else', () => {
    const root = project({
      'electron-builder.yml': [
        'files:',
        '  - index.html',
        '  # a comment in the list',
        '  - main.js',
        "  - 'extra/**/*'",
        '  - dist-renderer/**/*',
        "  - '!node_modules/skipped/**/*'",
        'mac:',
        '  files:',
        "    - '!node_modules/nested/**/*'",
        '  target: dmg',
      ].join('\n'),
      'main.js': "require('from-main');",
      'renderer.js': "import 'from-renderer';",
      'preload.js': "require('from-preload');",
      'preview/entry.js': "import 'from-preview';",
      'extra/lib/deep.cjs': "require('from-extra');",
      'dist-renderer/bundle.js': "import 'from-build-output';",
      'tests/unit/spec.js': "require('from-tests');",
      'development/demo.js': "import 'from-development';",
      'scripts/tool.cjs': "require('from-scripts');",
      'node_modules/dep/index.js': "require('from-node-modules');",
      'src/node_modules/dep/index.js': "require('from-nested-node-modules');",
    });
    const names = [...findShippedPackages(root, {}).keys()].sort();

    expect(names).toEqual([
      'electron',
      'from-extra',
      'from-main',
      'from-preload',
      'from-preview',
      'from-renderer',
    ]);
  });

  it('scans a tests or coverage directory inside a root, because it is packed with the rest', () => {
    const root = project({
      'electron-builder.yml': ['files:', '  - extra/**/*', ''].join('\n'),
      'src/tests/helper.js': "require('braces');",
      'src/deep/coverage/report.js': "import 'micromatch';",
      'extra/tests/spec.js': "require('from-extra-tests');",
      // Not under a root, so nothing packs it.
      'tests/unit/spec.js': "require('fast-glob');",
      'coverage/lcov.js': "require('globby');",
    });
    const shipped = findShippedPackages(root, {});

    expect(shipped.get('braces')).toBe('imported by src/tests/helper.js');
    expect(shipped.get('micromatch')).toBe('imported by src/deep/coverage/report.js');
    expect(shipped.has('from-extra-tests')).toBe(true);
    expect(shipped.has('fast-glob')).toBe(false);
    expect(shipped.has('globby')).toBe(false);

    // The exception that passes without the helper is rejected with it.
    const without = findShippedPackages(project({ 'src/app.js': '' }), {});
    expect(runCheck({ shippedPackages: without }).ok).toBe(true);
    expect(runCheck({ shippedPackages: shipped }).stderr.join('\n')).toContain(
      'braces (imported by src/tests/helper.js)'
    );
  });

  it('reads only the top-level files list of electron-builder.yml', () => {
    const root = project({
      'electron-builder.yml': [
        'productName: Example',
        'files:',
        '  - main.js',
        '  - "src/**/*"',
        'win:',
        '  files: &excludes',
        "    - '!node_modules/x/**/*'",
        '',
      ].join('\n'),
    });

    expect(readBuilderFiles(root)).toEqual(['main.js', 'src/**/*']);
    expect(readBuilderFiles(project({}))).toEqual([]);
  });

  describe('with a lock file', () => {
    // A package-lock.json with the root entry and the given packages.
    function lockFile(packages) {
      return JSON.stringify({ lockfileVersion: 3, packages: { '': { name: 'app' }, ...packages } });
    }

    it('adds what the lock installs for every package that ships, and nothing else', () => {
      const root = project({
        'src/ui.js': "import 'bundled';",
        'package-lock.json': lockFile({
          'node_modules/app-dep': {
            dependencies: { middle: '^1.0.0', aliased: 'npm:real-name@^1.0.0' },
            optionalDependencies: { 'optional-dep': '^1.0.0', 'not-installed': '^1.0.0' },
            peerDependencies: { 'peer-dep': '^1.0.0' },
          },
          // app-dep and middle need each other, and middle has its own copy of leaf.
          'node_modules/middle': { dependencies: { leaf: '^1.0.0', 'app-dep': '^1.0.0' } },
          'node_modules/middle/node_modules/leaf': { dependencies: { 'nested-leaf': '^1.0.0' } },
          'node_modules/nested-leaf': {},
          'node_modules/aliased': { name: 'real-name', dependencies: { 'alias-dep': '^1.0.0' } },
          'node_modules/alias-dep': {},
          'node_modules/optional-dep': {},
          'node_modules/peer-dep': {},
          'node_modules/@acme/shared': { link: true, resolved: 'packages/shared' },
          'packages/shared': { name: '@acme/shared', dependencies: { 'shared-dep': '^1.0.0' } },
          'node_modules/shared-dep': {},
          'node_modules/bundled': { dependencies: { 'bundled-dep': '^1.0.0' } },
          'node_modules/bundled-dep': {},
          'node_modules/tool': { dependencies: { 'tool-dep': '^1.0.0' } },
          'node_modules/tool-dep': {},
          // Electron's package fetches the runtime; it is not packed with the app.
          'node_modules/electron': { dependencies: { '@electron/get': '^5.0.0' } },
          'node_modules/@electron/get': { dependencies: { got: '^11.0.0' } },
          'node_modules/got': {},
        }),
      });

      const shipped = findShippedPackages(root, {
        dependencies: { 'app-dep': '^1.0.0', '@acme/shared': '*' },
        devDependencies: { bundled: '^1.0.0', tool: '^1.0.0', electron: '^43.0.0' },
      });

      expect([...shipped.keys()].sort()).toEqual([
        '@acme/shared',
        'alias-dep',
        'aliased',
        'app-dep',
        'bundled',
        'bundled-dep',
        'electron',
        'leaf',
        'middle',
        'nested-leaf',
        'not-installed',
        'optional-dep',
        'peer-dep',
        'real-name',
        'shared-dep',
      ]);
      expect(shipped.get('middle')).toBe('needed by app-dep, which is listed under dependencies');
      expect(shipped.get('nested-leaf')).toBe(
        'needed by app-dep, which is listed under dependencies'
      );
      expect(shipped.get('real-name')).toBe(
        'needed by app-dep, which is listed under dependencies'
      );
      expect(shipped.get('shared-dep')).toBe(
        'needed by @acme/shared, which is listed under dependencies'
      );
      expect(shipped.get('bundled-dep')).toBe('needed by bundled, which is imported by src/ui.js');
      expect(shipped.get('app-dep')).toBe('listed under dependencies');
      expect(shipped.get('electron')).toContain('every package');
    });

    it('stops the exception for a package that only a shipped package requires', () => {
      // consumer ships and needs micromatch, which needs braces. npm audit leaves
      // consumer out of its report when its range allows a micromatch without
      // braces, so only the lock file shows braces ships.
      const pkg = {
        dependencies: { consumer: '^1.0.0' },
        devDependencies: { stylelint: '^16.0.0', 'electron-builder': '^26.0.0' },
      };
      const root = project({
        'package-lock.json': lockFile({
          'node_modules/consumer': { dependencies: { micromatch: '^4.0.0' } },
          'node_modules/micromatch': { dependencies: { braces: '^3.0.3' } },
          'node_modules/braces': {},
        }),
      });

      const result = runCheck({
        packageJson: pkg,
        shippedPackages: findShippedPackages(root, pkg),
      });

      expect(result.ok).toBe(false);
      expect(result.stderr).toHaveLength(2);
      expect(result.stderr[0]).toContain(`${BRACES} (braces <=3.0.3, high)`);
      expect(result.stderr[0]).toContain(
        'braces (needed by consumer, which is listed under dependencies), micromatch (needed by ' +
          'consumer, which is listed under dependencies) ship in the app'
      );
      expect(result.stdout.join('\n')).not.toContain(`${BRACES} braces`);
      expect(result.stdout.join('\n')).toContain(`${HTTP_CACHE} http-cache-semantics`);
    });

    it('refuses a lock file it cannot read', () => {
      const unreadable = project({ 'package-lock.json': '{ not json' });
      const old = project({
        'package-lock.json': JSON.stringify({ lockfileVersion: 1, dependencies: {} }),
      });

      expect(() => findShippedPackages(unreadable, {})).toThrow('Could not read package-lock.json');
      expect(() => findShippedPackages(old, {})).toThrow('has no "packages" list');
    });
  });

  describe('in this repository', () => {
    const pkg = realPackageJson();
    const shipped = findShippedPackages(ROOT, pkg);

    it('finds the devDependencies vite bundles into the app', () => {
      for (const name of ['hls.js', 'sortablejs', 'events', 'regenerate-unicode-properties']) {
        expect(Object.keys(pkg.devDependencies)).toContain(name);
        expect(shipped.get(name)).toMatch(/^imported by (src|preview)\//);
      }
      expect(shipped.get('hls.js')).toBe('imported by src/camera.js');
      expect(shipped.get('sortablejs')).toBe('imported by src/ui.js');
    });

    it('finds Electron and the runtime dependencies', () => {
      for (const name of Object.keys(pkg.dependencies)) {
        expect(shipped.has(name)).toBe(true);
      }
      expect(shipped.has('electron')).toBe(true);
      expect(shipped.has('uiohook-napi')).toBe(true);
    });

    it('finds what the lock file installs for the runtime dependencies', () => {
      const lock = JSON.parse(fs.readFileSync(path.join(ROOT, 'package-lock.json'), 'utf8'));
      const needed = Object.keys(lock.packages['node_modules/electron-updater'].dependencies);

      expect(needed.length).toBeGreaterThan(0);
      for (const name of needed) {
        expect(shipped.get(name)).toMatch(/^needed by .+, which is (listed under|imported by) /);
      }
    });

    it('leaves out the build tools, what only they and Electron need, and its own aliases', () => {
      for (const name of ['stylelint', 'electron-builder', 'eslint', 'vite', 'jest', 'prettier']) {
        expect(shipped.has(name)).toBe(false);
      }
      // The packages both audit exceptions rely on staying out of the app.
      for (const name of [
        'braces',
        'micromatch',
        'fast-glob',
        'globby',
        'http-cache-semantics',
        'cacheable-request',
        'got',
        '@electron/get',
        'app-builder-lib',
        'dmg-builder',
        'electron-builder-squirrel-windows',
      ]) {
        expect(shipped.has(name)).toBe(false);
      }
      for (const name of ['@hadw/renderer', '@dev-climate-demo', '@', 'fs', 'path', 'node:fs']) {
        expect(shipped.has(name)).toBe(false);
      }
    });

    it('scans the paths the build configuration packs and bundles', () => {
      const builderFiles = readBuilderFiles(ROOT);
      expect(builderFiles).toEqual(
        expect.arrayContaining(['main.js', 'profile-sync-core.js', 'src/**/*'])
      );
      expect(builderFiles).toContain('packages/widget-renderer/**/*');

      // The entries the scanner adds on its own are the ones vite builds from.
      const vite = fs.readFileSync(path.join(ROOT, 'vite.config.js'), 'utf8');
      const preload = fs.readFileSync(path.join(ROOT, 'vite.preload.config.js'), 'utf8');
      const panel = fs.readFileSync(path.join(ROOT, 'vite.panel.config.js'), 'utf8');
      expect(vite).toContain("'renderer.js'");
      expect(preload).toContain("'preload.js'");
      expect(panel).toContain("'preview'");
    });
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

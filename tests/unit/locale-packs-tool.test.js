/**
 * @jest-environment node
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const tool = require('../../scripts/locale-packs.cjs');

const REPO_ROOT = path.resolve(__dirname, '../..');
const tempRoots = [];

function writeJson(root, relativePath, value) {
  const file = path.join(root, relativePath);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
}

function readJson(root, relativePath) {
  return JSON.parse(fs.readFileSync(path.join(root, relativePath), 'utf8'));
}

function git(root, ...args) {
  const result = spawnSync(
    'git',
    [
      '-c',
      'user.name=Test',
      '-c',
      'user.email=test@example.com',
      '-c',
      'commit.gpgsign=false',
      ...args,
    ],
    { cwd: root, encoding: 'utf8' }
  );
  return result;
}

function run(root, ...argv) {
  const out = [];
  const err = [];
  const code = tool.main(argv, {
    root,
    stdout: (line) => out.push(line),
    stderr: (line) => err.push(line),
  });
  return { code, out: out.join('\n'), err: err.join('\n') };
}

/** A tiny but complete set of catalogs: English, a bundled German catalog and two packs. */
function createRepo() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'locale-packs-test-'));
  tempRoots.push(root);
  const english = { Hello: 'Hello', 'Count: {{count}}': 'Count: {{count}}' };
  const german = { Hello: 'Hallo', 'Count: {{count}}': 'Anzahl: {{count}}' };
  const french = { Hello: 'Bonjour', 'Count: {{count}}': 'Nombre : {{count}}' };
  writeJson(root, 'locales/en.json', english);
  writeJson(root, 'locales/de.json', german);
  const pack = (locale, displayName, messages) => ({
    locale,
    displayName,
    englishName: displayName,
    version: '1.0.0',
    minAppVersion: '3.4.1',
    notes: `${displayName} pack`,
    messages,
  });
  writeJson(root, 'locale-packs/de.json', pack('de', 'German', german));
  writeJson(root, 'locale-packs/fr.json', pack('fr', 'French', french));
  writeJson(root, 'locale-packs/manifest.json', {
    generatedAt: '2026-01-01T00:00:00.000Z',
    packs: ['de', 'fr'].map((locale) => ({
      locale,
      displayName: locale,
      englishName: locale,
      version: '1.0.0',
      minAppVersion: '3.4.1',
      downloadUrl: `https://example.invalid/${locale}.json`,
      sha256: '',
      notes: '',
    })),
  });
  tool.syncManifest(tool.pathsFor(root));
  git(root, 'init', '-q');
  git(root, 'checkout', '-q', '-b', 'main');
  git(root, 'add', '-A');
  git(root, 'commit', '-q', '-m', 'base');
  return root;
}

const newString = {
  Goodbye: { en: 'Goodbye', de: 'Tschüss', fr: 'Au revoir' },
};

afterAll(() => {
  tempRoots.forEach((root) => fs.rmSync(root, { recursive: true, force: true }));
});

describe('locale-packs check', () => {
  it('passes on the repository catalogs', () => {
    expect(tool.checkPacks(tool.pathsFor(REPO_ROOT))).toEqual([]);
  });

  it('passes on a consistent set and rejects an unknown --against ref', () => {
    const root = createRepo();
    expect(tool.checkPacks(tool.pathsFor(root))).toEqual([]);
    expect(run(root, 'check', '--against', 'main').code).toBe(0);
    const unknown = run(root, 'check', '--against', 'no-such-ref');
    expect(unknown.code).toBe(1);
    expect(unknown.err).toMatch(/Unknown git ref/);
  });

  it('reports missing keys, extra keys and changed placeholders', () => {
    const root = createRepo();
    const pack = readJson(root, 'locale-packs/fr.json');
    delete pack.messages.Hello;
    pack.messages.Surplus = 'Surplus';
    pack.messages['Count: {{count}}'] = 'Nombre : {{total}}';
    writeJson(root, 'locale-packs/fr.json', pack);
    tool.syncManifest(tool.pathsFor(root));

    const problems = tool.checkPacks(tool.pathsFor(root));
    expect(problems).toEqual([
      expect.stringContaining('locale-packs/fr.json is missing 1 keys: "Hello"'),
      expect.stringContaining('locale-packs/fr.json has 1 keys en.json lacks: "Surplus"'),
      expect.stringContaining('changes the {{placeholders}} of: "Count: {{count}}"'),
    ]);
  });

  it('reports a stale hash, a version the manifest does not know and an unlisted pack', () => {
    const root = createRepo();
    const fr = readJson(root, 'locale-packs/fr.json');
    fr.version = '1.0.1';
    writeJson(root, 'locale-packs/fr.json', fr);
    const de = readJson(root, 'locale-packs/de.json');
    de.notes = 'edited without refreshing the manifest';
    writeJson(root, 'locale-packs/de.json', de);
    writeJson(root, 'locale-packs/es.json', { ...fr, locale: 'es' });

    const problems = tool.checkPacks(tool.pathsFor(root));
    expect(problems).toEqual(
      expect.arrayContaining([
        expect.stringContaining('manifest.json lists fr at 1.0.0, but the pack says 1.0.1'),
        expect.stringContaining('stale sha256 for fr'),
        expect.stringContaining('stale sha256 for de'),
        expect.stringContaining('locale-packs/es.json is not listed in manifest.json'),
      ])
    );
  });

  it('reports a bundled catalog that drifted from its pack', () => {
    const root = createRepo();
    const german = readJson(root, 'locales/de.json');
    german.Hello = 'Servus';
    writeJson(root, 'locales/de.json', german);
    expect(tool.checkPacks(tool.pathsFor(root))).toEqual([
      'locales/de.json differs from locale-packs/de.json',
    ]);
  });

  it('with --against asks for a version bump on changed content', () => {
    const root = createRepo();
    const french = readJson(root, 'locale-packs/fr.json');
    french.messages.Hello = 'Salut';
    writeJson(root, 'locale-packs/fr.json', french);
    tool.syncManifest(tool.pathsFor(root));

    expect(tool.checkPacks(tool.pathsFor(root))).toEqual([]);
    expect(tool.checkPacks(tool.pathsFor(root), { against: 'main' })).toEqual([
      expect.stringContaining(
        'locale-packs/fr.json changed since main but its version is still 1.0.0'
      ),
    ]);
    tool.bumpPacks(tool.pathsFor(root), { against: 'main' });
    expect(tool.checkPacks(tool.pathsFor(root), { against: 'main' })).toEqual([]);
  });
});

describe('locale-packs add', () => {
  it('adds a new key to English, every pack and the bundled catalog, at the end', () => {
    const root = createRepo();
    const { added, updated } = tool.addStrings(tool.pathsFor(root), newString);

    expect(added).toEqual(['Goodbye']);
    expect(updated).toEqual([]);
    expect(Object.keys(readJson(root, 'locales/en.json')).pop()).toBe('Goodbye');
    expect(readJson(root, 'locales/de.json').Goodbye).toBe('Tschüss');
    expect(readJson(root, 'locale-packs/de.json').messages.Goodbye).toBe('Tschüss');
    expect(readJson(root, 'locale-packs/fr.json').messages.Goodbye).toBe('Au revoir');
    // The files stay in the format the manifest hashes, with non-ASCII text unescaped.
    expect(fs.readFileSync(path.join(root, 'locales/de.json'), 'utf8')).toContain('Tschüss');
    expect(fs.readFileSync(path.join(root, 'locales/de.json'), 'utf8').endsWith('}\n')).toBe(true);
  });

  it('updates only the locales named for an existing key', () => {
    const root = createRepo();
    const { added, updated } = tool.addStrings(tool.pathsFor(root), { Hello: { fr: 'Salut' } });

    expect(added).toEqual([]);
    expect(updated).toEqual(['Hello']);
    expect(readJson(root, 'locale-packs/fr.json').messages.Hello).toBe('Salut');
    expect(readJson(root, 'locale-packs/de.json').messages.Hello).toBe('Hallo');
    expect(Object.keys(readJson(root, 'locale-packs/fr.json').messages)[0]).toBe('Hello');
  });

  it('refuses a new key without every language and writes nothing', () => {
    const root = createRepo();
    const before = fs.readFileSync(path.join(root, 'locales/en.json'), 'utf8');
    expect(() =>
      tool.addStrings(tool.pathsFor(root), {
        Goodbye: { en: 'Goodbye', de: 'Tschüss' },
        Later: { en: 'Later', de: 'Später', fr: 'Plus tard' },
      })
    ).toThrow(/"Goodbye": missing fr/);
    expect(fs.readFileSync(path.join(root, 'locales/en.json'), 'utf8')).toBe(before);
    expect(readJson(root, 'locale-packs/de.json').messages).not.toHaveProperty('Later');
  });

  it('refuses translations that change the {{placeholders}} and unknown locales', () => {
    const root = createRepo();
    expect(() =>
      tool.addStrings(tool.pathsFor(root), {
        'Left: {{count}}': { en: 'Left: {{count}}', de: 'Übrig', fr: 'Reste : {{count}}' },
      })
    ).toThrow(/de changes the \{\{placeholders\}\}/);
    expect(() => tool.addStrings(tool.pathsFor(root), { Hello: { xx: 'Hallo' } })).toThrow(
      /unknown locale xx/
    );
  });

  it('is available as a command that reads a file', () => {
    const root = createRepo();
    writeJson(root, 'strings.json', newString);
    const result = run(root, 'add', path.join(root, 'strings.json'));
    expect(result.code).toBe(0);
    expect(result.out).toContain('Added 1 keys, updated 0');
    expect(run(root, 'check').code).toBe(1);
    expect(run(root, 'manifest').code).toBe(0);
    expect(run(root, 'check').code).toBe(0);
  });
});

describe('locale-packs remove', () => {
  it('deletes keys everywhere and rejects unknown ones', () => {
    const root = createRepo();
    tool.removeStrings(tool.pathsFor(root), ['Hello']);
    expect(readJson(root, 'locales/en.json')).not.toHaveProperty('Hello');
    expect(readJson(root, 'locales/de.json')).not.toHaveProperty('Hello');
    expect(readJson(root, 'locale-packs/fr.json').messages).not.toHaveProperty('Hello');
    expect(() => tool.removeStrings(tool.pathsFor(root), ['Nope'])).toThrow(
      /Not in en.json: "Nope"/
    );
  });
});

describe('locale-packs bump and manifest', () => {
  it('bumps only the packs whose content changed, once, and refreshes the manifest', () => {
    const root = createRepo();
    const french = readJson(root, 'locale-packs/fr.json');
    french.messages.Hello = 'Salut';
    writeJson(root, 'locale-packs/fr.json', french);

    expect(tool.bumpPacks(tool.pathsFor(root))).toEqual([
      { locale: 'fr', from: '1.0.0', to: '1.0.1' },
    ]);
    expect(tool.bumpPacks(tool.pathsFor(root))).toEqual([]);

    const manifest = readJson(root, 'locale-packs/manifest.json');
    expect(manifest.packs.find((entry) => entry.locale === 'fr').version).toBe('1.0.1');
    expect(manifest.packs.find((entry) => entry.locale === 'de').version).toBe('1.0.0');
    expect(tool.checkPacks(tool.pathsFor(root))).toEqual([]);
  });

  it('bumps named packs unconditionally', () => {
    const root = createRepo();
    expect(tool.bumpPacks(tool.pathsFor(root), { locales: ['de'] })).toEqual([
      { locale: 'de', from: '1.0.0', to: '1.0.1' },
    ]);
    expect(() => tool.bumpPacks(tool.pathsFor(root), { locales: ['xx'] })).toThrow(
      /No pack for: xx/
    );
    expect(tool.checkPacks(tool.pathsFor(root))).toEqual([]);
  });

  it('recomputes the manifest hash from the exact file bytes', () => {
    const root = createRepo();
    const de = readJson(root, 'locale-packs/de.json');
    de.notes = 'changed';
    writeJson(root, 'locale-packs/de.json', de);

    expect(tool.syncManifest(tool.pathsFor(root))).toEqual(['de']);
    expect(tool.syncManifest(tool.pathsFor(root))).toEqual([]);
    expect(run(root, 'manifest').out).toBe('Manifest is current.');
  });
});

describe('locale-packs merge recipe', () => {
  it('keeps both sides keys after a conflicting merge', () => {
    const root = createRepo();
    const paths = tool.pathsFor(root);

    git(root, 'checkout', '-q', '-b', 'feature');
    tool.addStrings(paths, { Alpha: { en: 'Alpha', de: 'Alpha-de', fr: 'Alpha-fr' } });
    tool.bumpPacks(paths);
    git(root, 'commit', '-q', '-am', 'feature adds Alpha');

    git(root, 'checkout', '-q', 'main');
    tool.addStrings(paths, { Beta: { en: 'Beta', de: 'Beta-de', fr: 'Beta-fr' } });
    tool.bumpPacks(paths);
    git(root, 'commit', '-q', '-am', 'main adds Beta');

    git(root, 'checkout', '-q', 'feature');
    expect(git(root, 'merge', 'main').status).not.toBe(0);

    const mine = path.join(root, 'mine.json');
    const base = git(root, 'merge-base', 'HEAD', 'MERGE_HEAD').stdout.trim();
    const exported = run(root, 'export', base);
    expect(exported.code).toBe(0);
    expect(Object.keys(JSON.parse(exported.out))).toEqual(['Alpha']);
    fs.writeFileSync(mine, exported.out);

    expect(git(root, 'checkout', 'MERGE_HEAD', '--', 'locales', 'locale-packs').status).toBe(0);
    expect(run(root, 'add', mine).code).toBe(0);
    expect(run(root, 'bump', '--against', 'MERGE_HEAD').out).toMatch(/de: 1\.0\.1 -> 1\.0\.2/);
    expect(run(root, 'check', '--against', 'MERGE_HEAD').code).toBe(0);

    const english = readJson(root, 'locales/en.json');
    expect(Object.keys(english)).toEqual(expect.arrayContaining(['Alpha', 'Beta']));
    expect(readJson(root, 'locale-packs/fr.json').messages.Alpha).toBe('Alpha-fr');
    expect(readJson(root, 'locale-packs/fr.json').messages.Beta).toBe('Beta-fr');
  });
});

describe('locale-packs command line', () => {
  it('prints usage for an unknown command and nothing for none', () => {
    const root = createRepo();
    expect(run(root, 'frobnicate').code).toBe(1);
    expect(run(root, 'frobnicate').err).toContain('Usage: node scripts/locale-packs.cjs');
    expect(run(root).code).toBe(0);
  });

  it('explains missing arguments', () => {
    const root = createRepo();
    expect(run(root, 'add').err).toMatch(/strings JSON file/);
    expect(run(root, 'remove').err).toMatch(/at least one key/);
    expect(run(root, 'export').err).toMatch(/base ref/);
    expect(run(root, 'check', '--against').err).toMatch(/--against needs a value/);
  });
});

describe('version helpers', () => {
  it('compares and bumps patch versions', () => {
    expect(tool.bumpPatch('1.2.46')).toBe('1.2.47');
    expect(tool.compareVersions('1.2.10', '1.2.9')).toBeGreaterThan(0);
    expect(tool.compareVersions('1.2.9', '1.3.0')).toBeLessThan(0);
    expect(tool.compareVersions('2.0.0', '2.0.0')).toBe(0);
    expect(tool.placeholderNames('{{ b }} and {{a}} and {{b}}')).toEqual(['a', 'b', 'b']);
  });
});

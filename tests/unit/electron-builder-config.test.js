/** @jest-environment node */
const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml');

const root = path.resolve(__dirname, '../..');
const config = yaml.load(fs.readFileSync(path.join(root, 'electron-builder.yml'), 'utf8'));
const buildFile = (...parts) => path.join(root, 'build', ...parts);

/** Width and height from a PNG's header. */
function pngSize(file) {
  const header = fs.readFileSync(file).subarray(0, 24);
  expect(header.subarray(1, 4).toString('ascii')).toBe('PNG');
  return { width: header.readUInt32BE(16), height: header.readUInt32BE(20) };
}

/** The size of every image in an .ico file, from its directory. */
function icoSizes(file) {
  const data = fs.readFileSync(file);
  const count = data.readUInt16LE(4);
  return Array.from({ length: count }, (_, index) => data[6 + index * 16] || 256);
}

/** An 8-bit RGBA PNG decoded far enough to read single pixels. */
function readPng(file) {
  const zlib = require('zlib');
  const data = fs.readFileSync(file);
  let offset = 8;
  const idat = [];
  let header = null;
  while (offset < data.length) {
    const length = data.readUInt32BE(offset);
    const type = data.subarray(offset + 4, offset + 8).toString('ascii');
    const body = data.subarray(offset + 8, offset + 8 + length);
    if (type === 'IHDR') header = body;
    if (type === 'IDAT') idat.push(body);
    offset += 12 + length;
  }
  const width = header.readUInt32BE(0);
  const height = header.readUInt32BE(4);
  expect(header[8]).toBe(8);
  expect(header[9]).toBe(6); // RGBA
  const raw = zlib.inflateSync(Buffer.concat(idat));
  const stride = width * 4 + 1;
  const rows = [];
  for (let y = 0; y < height; y += 1) {
    const filter = raw[y * stride];
    const row = Buffer.from(raw.subarray(y * stride + 1, (y + 1) * stride));
    const previous = rows[y - 1] || Buffer.alloc(row.length);
    for (let x = 0; x < row.length; x += 1) {
      const a = x >= 4 ? row[x - 4] : 0;
      const b = previous[x];
      const c = x >= 4 ? previous[x - 4] : 0;
      let add = 0;
      if (filter === 1) add = a;
      else if (filter === 2) add = b;
      else if (filter === 3) add = (a + b) >> 1;
      else if (filter === 4) {
        const p = a + b - c;
        const pa = Math.abs(p - a);
        const pb = Math.abs(p - b);
        const pc = Math.abs(p - c);
        add = pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
      }
      row[x] = (row[x] + add) & 255;
    }
    rows.push(row);
  }
  return {
    width,
    height,
    alphaAt: (x, y) => rows[y][x * 4 + 3],
    rgbAt: (x, y) => [...rows[y].subarray(x * 4, x * 4 + 3)],
  };
}

const positives = (list) => list.filter((entry) => !entry.startsWith('!'));
const negatives = (list) => list.filter((entry) => entry.startsWith('!'));

/**
 * The configuration as electron-builder holds it once loaded. Its getConfig ends in doMergeConfigs,
 * which turns the top-level `files` into a file set of its own and leaves each platform's list as
 * written, and how the two combine follows from that. The YAML alone does not show it.
 */
function loadedConfig() {
  const { doMergeConfigs } = require('app-builder-lib/out/util/config/config');
  const text = fs.readFileSync(path.join(root, 'electron-builder.yml'), 'utf8');
  return doMergeConfigs([yaml.load(text)]);
}

/**
 * The matchers electron-builder packs the app's own files with on a platform, as its
 * getMainFileMatchers builds them from the loaded configuration. Each one is a file set, and the
 * app gets the files of all of them. The first also carries electron-builder's own exclusions.
 */
function mainFileMatchers(platform) {
  const { getMainFileMatchers } = require('app-builder-lib/out/fileMatcher');
  const loaded = loadedConfig();
  const packager = {
    info: {
      debugLogger: { isEnabled: false, add() {} },
      projectDir: root,
      buildResourcesDir: 'build',
      config: loaded,
      isPrepackedAppAsar: false,
    },
  };
  return getMainFileMatchers(
    root,
    path.join(root, 'dist', 'app'),
    (value) => value,
    loaded[platform],
    packager,
    path.join(root, 'dist'),
    false
  );
}

/** The patterns of the first matcher, which holds the platform's own list. */
const effectivePatterns = (platform) => mainFileMatchers(platform)[0].patterns;

/**
 * The app files electron-builder packs on a platform, relative to the repository: the folder walked
 * once per matcher by its own computeFileSets, which is what the asar is made from. node_modules
 * is collected separately (see packedFiles).
 */
async function packedAppFiles(platform) {
  const { computeFileSets } = require('app-builder-lib/out/util/appFileCopier');
  const platformPackager = { info: { areNodeModulesHandledExternally: false } };
  const fileSets = await computeFileSets(mainFileMatchers(platform), null, platformPackager, false);
  const files = fileSets.flatMap((set) => set.files.filter((file) => set.metadata.has(file)));
  return [...new Set(files.map((file) => path.relative(root, file).split(path.sep).join('/')))];
}

/**
 * The files of an installed package that electron-builder packs on a platform, relative to the
 * package: its folder walked the way app-builder-lib's NodeModuleCopyHelper walks it, through the
 * matcher getNodeModuleFileMatcher builds from the top-level and the platform `files`. A folder the
 * matcher refuses is not entered. electron-builder also leaves out a few names on its own
 * (binding.gyp, a README, test folders), which this does not repeat.
 */
function packedFiles(packageName, platform) {
  const { getNodeModuleFileMatcher } = require('app-builder-lib/out/fileMatcher');
  const loaded = loadedConfig();
  const filter = getNodeModuleFileMatcher(
    root,
    path.join(root, 'dist', 'app'),
    (value) => value,
    loaded[platform],
    { config: loaded, debugLogger: { isEnabled: false, add() {} } }
  ).createFilter();
  const packageDir = path.join(root, 'node_modules', ...packageName.split('/'));
  const packed = [];
  const walk = (relative) => {
    for (const name of fs.readdirSync(path.join(packageDir, relative)).sort()) {
      const entry = relative ? `${relative}/${name}` : name;
      const file = path.join(packageDir, ...entry.split('/'));
      const stat = fs.lstatSync(file);
      // The path the package has inside the app, which is what the patterns are written against.
      stat.moduleFullFilePath = `node_modules/${packageName}/${entry}`;
      if (!filter(file, stat)) continue;
      if (stat.isDirectory()) walk(entry);
      else packed.push(entry);
    }
  };
  walk('');
  return packed;
}

describe('what the packages contain', () => {
  // Once electron-builder has loaded the configuration, the top-level `files` is one file set and a
  // platform's list another, and the app is packed from both. A set that holds only exclusions
  // packs everything but them: the tests, internal docs, the website and the vendored sources. So
  // each platform list names package.json too, and the top-level allowlist bounds the rest.
  it.each(['linux', 'mac', 'win'])(
    'packs only the allowlisted app files on %s',
    async (platform) => {
      const { Minimatch } = require('minimatch');
      const allowlist = positives(config.files).map((entry) => new Minimatch(entry, { dot: true }));
      const packed = await packedAppFiles(platform);
      expect(packed).toEqual(
        expect.arrayContaining(['index.html', 'main.js', 'package.json', 'src/i18n-main.cjs'])
      );
      expect(packed.filter((file) => !allowlist.some((pattern) => pattern.match(file)))).toEqual(
        []
      );
      // No matcher is the "everything but" that a list of exclusions alone turns into.
      for (const matcher of mainFileMatchers(platform)) {
        expect(matcher.patterns).not.toContain('**/*');
        expect(positives(matcher.patterns).length).toBeGreaterThan(0);
      }
    },
    // The first walk also loads app-builder-lib, which takes seconds on a busy machine.
    30000
  );

  it('gives each platform list package.json and exclusions, so the allowlist bounds the rest', () => {
    expect(positives(config.files).length).toBeGreaterThan(0);
    for (const platform of ['linux', 'mac', 'win']) {
      expect(positives(config[platform].files)).toEqual(['package.json']);
    }
  });

  it('strips the same D-Bus packages from macOS and Windows, whose two lists differ only in uiohook', () => {
    // YAML cannot join two lists, so each platform holds its own copy of the dbus-next list.
    const dbusPart = (list) => list.filter((entry) => !entry.includes('/uiohook-napi/'));
    expect(dbusPart(config.mac.files).length).toBeGreaterThan(10);
    expect(dbusPart(config.win.files)).toEqual(dbusPart(config.mac.files));
    for (const platform of ['mac', 'win', 'linux']) {
      for (const entry of config[platform].files.filter((item) =>
        item.includes('/uiohook-napi/')
      )) {
        expect(entry).toMatch(
          /^!node_modules\/uiohook-napi\/prebuilds\/[a-z0-9]+-[a-z0-9*]+\/\*\*\/\*$/
        );
      }
    }
  });

  it('strips the Linux-only D-Bus library from both, and only from them', () => {
    for (const platform of ['mac', 'win']) {
      expect(negatives(config[platform].files)).toContain('!node_modules/dbus-next/**/*');
      expect(effectivePatterns(platform)).toContain('!node_modules/dbus-next/**/*');
    }
    expect(negatives(config.files).some((entry) => entry.includes('dbus-next'))).toBe(false);
    expect(effectivePatterns('linux')).not.toContain('!node_modules/dbus-next/**/*');
  });

  it('lists nothing from the repository that is not an app file', () => {
    const wanted = positives(config.files).map((entry) => entry.split('/')[0]);
    for (const folder of ['tests', 'docs', 'website', 'vendor', 'scripts', 'development']) {
      expect(wanted).not.toContain(folder);
    }
  });

  it('includes the icon the Linux window and launcher use at run time', () => {
    const { getAppIconPath } = require('../../src/platform.cjs');
    for (const platform of ['linux', 'win32', 'darwin']) {
      const relative = path
        .relative(root, getAppIconPath(root, platform))
        .split(path.sep)
        .join('/');
      expect(config.files).toContain(relative);
    }
  });

  it('only lists files and folders that exist', () => {
    // The two bundles are written by the vite builds, which CI runs after the tests, so they are
    // checked against the build configs instead of the disk.
    const buildOutputs = {
      'dist-renderer': 'vite.config.js',
      'dist-preload': 'vite.preload.config.js',
    };
    for (const entry of positives(config.files)) {
      const base = entry.replace(/\/\*\*\/\*$/, '');
      if (buildOutputs[base]) {
        const viteConfig = fs.readFileSync(path.join(root, buildOutputs[base]), 'utf8');
        expect(viteConfig).toContain(`outDir: '${base}'`);
        continue;
      }
      expect(fs.existsSync(path.join(root, base))).toBe(true);
    }
  });
});

describe('the icons that ship', () => {
  it('rounds the Linux icons, which sit beside other apps in an icon theme', () => {
    for (const file of fs.readdirSync(buildFile('icons'))) {
      const pixels = readPng(buildFile('icons', file));
      expect(pixels.alphaAt(0, 0)).toBeLessThan(16);
      expect(pixels.alphaAt(pixels.width - 1, pixels.height - 1)).toBeLessThan(16);
      expect(pixels.alphaAt(pixels.width >> 1, pixels.height >> 1)).toBe(255);
    }
  });

  it('gives Linux a standard hicolor size set, not one odd-sized file', () => {
    expect(config.linux.icon).toBe('build/icons');
    const files = fs.readdirSync(buildFile('icons')).sort();
    expect(files).toEqual(
      ['128x128', '16x16', '256x256', '32x32', '48x48', '512x512', '64x64']
        .map((s) => `${s}.png`)
        .sort()
    );
    for (const file of files) {
      const size = Number(file.split('x')[0]);
      expect(pngSize(buildFile('icons', file))).toEqual({ width: size, height: size });
    }
  });

  it('keeps the Windows icon frames it had and adds the ones 125% and 150% scaling ask for', () => {
    const sizes = icoSizes(buildFile('icon.ico')).sort((a, b) => a - b);
    expect(sizes).toEqual([16, 20, 24, 32, 40, 48, 64, 128, 256]);
  });

  it('gives macOS a large enough source for its icon set', () => {
    expect(config.mac.icon).toBe('build/icon-mac.png');
    const { width, height } = pngSize(buildFile('icon-mac.png'));
    expect(width).toBe(1024);
    expect(height).toBe(1024);
  });

  it("draws the macOS icon on Apple's grid, with clear corners and margin", () => {
    // The corner and the outer margin must be transparent, the middle opaque.
    const { alphaAt } = readPng(buildFile('icon-mac.png'));
    expect(alphaAt(0, 0)).toBe(0);
    expect(alphaAt(1023, 1023)).toBe(0);
    expect(alphaAt(40, 512)).toBe(0); // inside the 100 px margin
    expect(alphaAt(512, 512)).toBe(255);
    expect(alphaAt(110, 110)).toBe(0); // the body's corner is rounded away
    expect(alphaAt(512, 110)).toBe(255); // the middle of its top edge is not
  });

  it('ships a monochrome template image for the macOS menu bar at both densities', () => {
    expect(pngSize(buildFile('trayTemplate.png'))).toEqual({ width: 22, height: 22 });
    expect(pngSize(buildFile('trayTemplate@2x.png'))).toEqual({ width: 44, height: 44 });
    // A template image is black with alpha: the menu bar supplies the colour.
    for (const file of ['trayTemplate.png', 'trayTemplate@2x.png']) {
      const pixels = readPng(buildFile(file));
      let drawn = 0;
      for (let y = 0; y < pixels.height; y += 1) {
        for (let x = 0; x < pixels.width; x += 1) {
          if (pixels.alphaAt(x, y) > 0) {
            drawn += 1;
            expect(pixels.rgbAt(x, y)).toEqual([0, 0, 0]);
          }
        }
      }
      expect(drawn).toBeGreaterThan(30);
    }
    for (const entry of ['build/trayTemplate.png', 'build/trayTemplate@2x.png']) {
      expect(config.files).toContain(entry);
    }
  });
});

describe('package metadata', () => {
  it('gives the .deb a summary and a maintainer with an address', () => {
    expect(config.linux.synopsis).toMatch(/\S/);
    expect(config.linux.maintainer).toMatch(/^[^<>]+ <[^<>@\s]+@[^<>@\s]+>$/);
  });

  it('files the macOS app as a utility that lives in the menu bar', () => {
    expect(config.mac.category).toBe('public.app-category.utilities');
    expect(config.mac.extendInfo.LSUIElement).toBe(true);
  });
});

describe('the Chromium locales that ship', () => {
  const { APP_LANGUAGES } = require('../../src/i18n-main.cjs');
  const electronLocales = path.join(
    path.dirname(require.resolve('electron/package.json')),
    'dist',
    'locales'
  );
  const hasElectronLocales = fs.existsSync(electronLocales);
  const itWithElectron = hasElectronLocales ? it : it.skip;

  /**
   * Which of a folder's locale files electron-builder keeps for a list of wanted languages, by the
   * rule in app-builder-lib's ElectronFramework.js: a file stays when its name is a wanted entry,
   * or the part of one before a dash or an underscore ("es" stays for "es-419").
   */
  function keptBy(wanted, names, extension = '.pak') {
    const wantedLower = wanted.map((entry) => entry.trim().toLowerCase());
    return names
      .filter((file) => path.extname(file) === extension)
      .filter((file) => {
        const language = path.basename(file, extension).toLowerCase();
        return wantedLower.some(
          (entry) =>
            entry === language ||
            entry.startsWith(`${language}-`) ||
            entry.startsWith(`${language}_`)
        );
      })
      .map((file) => path.basename(file, extension))
      .sort();
  }

  it('is a list, so Windows and Linux both use it, and macOS has a list of its own', () => {
    expect(Array.isArray(config.electronLanguages)).toBe(true);
    expect(config.win.electronLanguages).toBeUndefined();
    expect(config.linux.electronLanguages).toBeUndefined();
    expect(Array.isArray(config.mac.electronLanguages)).toBe(true);
  });

  it('keeps exactly the paks for the languages the app has, and the regional ones Chromium maps them to', () => {
    expect([...config.electronLanguages].sort()).toEqual(
      ['ar', 'de', 'en-GB', 'en-US', 'es', 'es-419', 'fr', 'hi', 'zh-CN', 'zh-TW'].sort()
    );
  });

  it('has a pak for every language the app has, and for no other', () => {
    const languages = config.electronLanguages.map((entry) => entry.split('-')[0]);
    for (const language of APP_LANGUAGES) expect(languages).toContain(language);
    for (const language of languages) expect(APP_LANGUAGES).toContain(language);
    // Chromium cannot start without its English pak, and falls back to it for any other language.
    expect(config.electronLanguages).toContain('en-US');
  });

  // The paks Chromium picks for a system language, as read from app.getLocale() under Electron 43
  // with LANG set to each (see the comment in electron-builder.yml).
  it.each([
    ['es-MX', 'es-419'],
    ['es-AR', 'es-419'],
    ['es-US', 'es-419'],
    ['es-ES', 'es'],
    ['zh-TW', 'zh-TW'],
    ['zh-HK', 'zh-TW'],
    ['zh-CN', 'zh-CN'],
    ['zh-SG', 'zh-CN'],
    ['en-GB', 'en-GB'],
    ['en-AU', 'en-GB'],
    ['en-CA', 'en-GB'],
    ['en-US', 'en-US'],
    ['de-AT', 'de'],
    ['fr-CA', 'fr'],
    ['ar-EG', 'ar'],
    ['hi-IN', 'hi'],
  ])('keeps the pak Chromium uses for %s (%s)', (_systemLocale, pak) => {
    expect(keptBy(config.electronLanguages, [`${pak}.pak`])).toEqual([pak]);
  });

  itWithElectron('removes every other locale from Electron, and keeps one pak for each', () => {
    const names = fs.readdirSync(electronLocales);
    expect(names.length).toBeGreaterThan(50);
    const kept = keptBy(config.electronLanguages, names);
    expect(kept).toEqual(
      ['ar', 'de', 'en-GB', 'en-US', 'es', 'es-419', 'fr', 'hi', 'zh-CN', 'zh-TW'].sort()
    );
    // Each name in the list is a file Electron has, so a typo cannot quietly keep nothing.
    for (const entry of config.electronLanguages) expect(names).toContain(`${entry}.pak`);
  });

  it('keeps the same languages on macOS, named for its folders, with their gender variants', () => {
    // macOS keeps a locale.pak in <language>.lproj; en-US is plain "en" there.
    const folder = (entry) => (entry === 'en-US' ? 'en' : entry.replace('-', '_'));
    const expected = config.electronLanguages.flatMap((entry) =>
      ['', '_FEMININE', '_MASCULINE', '_NEUTER'].map((variant) => `${folder(entry)}${variant}`)
    );
    expect([...config.mac.electronLanguages].sort()).toEqual(expected.sort());
    // The same rule keeps the folders and drops the rest.
    const folders = [
      'en.lproj',
      'en_GB.lproj',
      'es_419.lproj',
      'es_419_FEMININE.lproj',
      'zh_TW.lproj',
      'pt_BR.lproj',
      'ja.lproj',
      'ja_NEUTER.lproj',
    ];
    expect(keptBy(config.mac.electronLanguages, folders, '.lproj')).toEqual(
      ['en', 'en_GB', 'es_419', 'es_419_FEMININE', 'zh_TW'].sort()
    );
  });

  it('names the app languages in the comment that explains the choice', () => {
    const text = fs.readFileSync(path.join(root, 'electron-builder.yml'), 'utf8');
    const comment = text.slice(0, text.indexOf('\nelectronLanguages:'));
    for (const pak of ['es-419', 'zh-TW', 'en-GB', 'en-US']) expect(comment).toContain(pak);
    expect(comment).toContain('detectSystemLocale');
  });
});

describe('the usocket dependency subtree that no longer ships', () => {
  const lock = JSON.parse(fs.readFileSync(path.join(root, 'package-lock.json'), 'utf8'));
  const locked = lock.packages;
  const hasNodeModules = fs.existsSync(path.join(root, 'node_modules', 'electron-updater'));
  const itWithNodeModules = hasNodeModules ? it : it.skip;

  // The lock-file path of the package a `require(name)` from `from` finds, the way npm lays them
  // out: the nearest node_modules folder going up. null when nothing is installed under that name.
  function resolveDependency(from, name) {
    let base = from;
    for (;;) {
      const candidate = `${base ? `${base}/` : ''}node_modules/${name}`;
      if (locked[candidate]) return candidate;
      if (!base) return null;
      const cut = base.lastIndexOf('/node_modules/');
      base = cut === -1 ? '' : base.slice(0, cut);
    }
  }

  // What npm installs for a package: dependencies, optional ones, and peers that are not optional.
  function dependencyNames(entry) {
    return [
      ...Object.keys(entry.dependencies || {}),
      ...Object.keys(entry.optionalDependencies || {}),
      ...Object.keys(entry.peerDependencies || {}).filter(
        (name) => !entry.peerDependenciesMeta?.[name]?.optional
      ),
    ];
  }

  // Every package the app's own dependencies and optionalDependencies reach, without going through
  // the ones in `skipped`. That is what electron-builder packs, before the exclusions in `files`.
  function reachable(skipped = new Set()) {
    const seen = new Set();
    const queue = [''];
    while (queue.length) {
      const from = queue.pop();
      for (const name of dependencyNames(locked[from])) {
        const found = resolveDependency(from, name);
        if (found && !skipped.has(found) && !seen.has(found)) {
          seen.add(found);
          queue.push(found);
        }
      }
    }
    return seen;
  }

  const everything = reachable();
  const withoutUsocket = reachable(new Set(['node_modules/usocket']));
  // The folders usocket alone brings in, nested copies included.
  const orphaned = [...everything].filter((entry) => !withoutUsocket.has(entry)).sort();
  const packageName = (entry) => entry.replace(/^.*node_modules\//, '');
  const topLevel = (entry) => /^node_modules\/(?:@[^/]+\/)?[^/]+$/.test(entry);
  const shippedNames = new Set([...withoutUsocket].map(packageName));
  const excludedFolders = negatives(config.files)
    .map((entry) => /^!node_modules\/((?:@[^/]+\/)?[^/]+)\/\*\*\/\*$/.exec(entry)?.[1])
    .filter(Boolean)
    .sort();

  // electron-builder hoists the production tree before it filters (app-builder-lib's
  // node-module-collector/hoist.js), so a package nested under node-gyp in the lock file is matched
  // at node_modules/<name>. A name is therefore safe to exclude only if nothing that ships has a
  // package of that name, in whichever place the hoisting puts it.
  it('excludes usocket and every package that only it needs, which package-lock.json says is these', () => {
    expect(orphaned).toContain('node_modules/usocket');
    expect(orphaned).toEqual(expect.arrayContaining(['node_modules/node-gyp', 'node_modules/tar']));
    const orphanNames = [...new Set(orphaned.map(packageName))];
    expect(excludedFolders).toEqual(orphanNames.filter((name) => !shippedNames.has(name)).sort());
    // semver is the one name both sides use (node-gyp's 7.8.5, electron-updater's 7.7.4). Which of
    // the two hoisting puts at the top is not ours to rely on, so it is left in, 58 files. A new
    // name here means a new case to look at, not a pattern to add.
    expect(orphanNames.filter((name) => shippedNames.has(name))).toEqual(['semver']);
    // A nested orphan sits under another orphan, so excluding that parent cannot reach into a
    // package that ships, and its own top-level name is the only place the pattern has to cover.
    for (const entry of orphaned.filter((candidate) => !topLevel(candidate))) {
      const parent = entry.slice(0, entry.lastIndexOf('/node_modules/'));
      expect(orphaned).toContain(parent);
    }
    // Every top-level negation of a whole package is one of these: the dbus-next ones live in the
    // platform lists. The others drop some files of a package that ships, and never all of it.
    const partial = negatives(config.files).filter(
      (entry) => !excludedFolders.some((name) => entry === `!node_modules/${name}/**/*`)
    );
    for (const entry of partial) {
      const name = /^!node_modules\/((?:@[^/]+\/)?[^/]+)\/[^*]/.exec(entry)?.[1];
      expect(shippedNames.has(name)).toBe(true);
    }
  });

  it('leaves nothing that ships depending on an excluded package', () => {
    const excluded = new Set(orphaned);
    // Once usocket is gone, none of what it pulled in is reachable from anything that remains.
    for (const entry of withoutUsocket) expect(excluded.has(entry)).toBe(false);
    // The runtime dependencies keep everything they declare.
    for (const runtime of ['electron-updater', 'electron-log', '@mdi/font', 'dbus-next']) {
      const reached = [`node_modules/${runtime}`];
      for (let index = 0; index < reached.length; index += 1) {
        for (const name of dependencyNames(locked[reached[index]])) {
          const found = resolveDependency(reached[index], name);
          if (name === 'usocket' || !found) continue;
          expect(excluded.has(found)).toBe(false);
          if (!reached.includes(found)) reached.push(found);
        }
      }
    }
  });

  it('is not required by the app itself', () => {
    const names = orphaned.map((entry) => entry.replace(/^.*node_modules\//, ''));
    const pattern = new RegExp(
      String.raw`(?:require\(\s*|from\s+|import\(\s*|import\s+)['"](?:${names
        .map((name) => name.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&'))
        .join('|')})(?:/[^'"]*)?['"]`
    );
    const files = [];
    const walkInto = (entry) => {
      const full = path.join(root, entry);
      if (!fs.existsSync(full)) return;
      if (fs.statSync(full).isDirectory()) {
        for (const child of fs.readdirSync(full)) {
          if (child !== 'node_modules') walkInto(path.join(entry, child));
        }
      } else if (/\.(?:c?js|mjs)$/.test(entry)) {
        files.push(entry);
      }
    };
    for (const entry of ['main.js', 'preload.js', 'renderer.js', 'profile-sync-core.js']) {
      walkInto(entry);
    }
    for (const entry of positives(config.files)) {
      const base = entry.replace(/\/\*\*\/\*$/, '');
      if (!/^(?:src|packages\/widget-renderer)$/.test(base)) continue;
      walkInto(base);
    }
    expect(files.length).toBeGreaterThan(50);
    const offenders = files.filter((file) =>
      pattern.test(fs.readFileSync(path.join(root, file), 'utf8'))
    );
    expect(offenders).toEqual([]);
  });

  itWithNodeModules('is not required by any dependency that ships', () => {
    const excluded = new Set(orphaned);
    const requirePattern = /(?:require\(\s*|from\s+|import\(\s*|import\s+)['"]([^'"]+)['"]/g;
    // Two known requires of an excluded package, neither run by the app: dbus-next loads usocket
    // for file descriptor passing, which the app turns off by connecting through a net socket;
    // node-gyp-build/bin.js is the command-line tool its install script uses.
    const allowed = new Set([
      'node_modules/dbus-next/lib/connection.js -> usocket',
      'node_modules/node-gyp-build/bin.js -> node-gyp',
    ]);
    const found = [];
    const walk = (folder, owner) => {
      for (const child of fs.readdirSync(path.join(root, folder), { withFileTypes: true })) {
        const entry = `${folder}/${child.name}`;
        if (child.isDirectory()) {
          if (child.name !== 'node_modules') walk(entry, owner);
        } else if (/\.(?:c?js|mjs)$/.test(child.name)) {
          const source = fs.readFileSync(path.join(root, entry), 'utf8');
          for (const match of source.matchAll(requirePattern)) {
            if (match[1].startsWith('.') || match[1].startsWith('node:')) continue;
            const name = match[1].startsWith('@')
              ? match[1].split('/').slice(0, 2).join('/')
              : match[1].split('/')[0];
            const resolved = resolveDependency(owner, name);
            if (resolved && excluded.has(resolved) && !allowed.has(`${entry} -> ${name}`)) {
              found.push(`${entry} -> ${match[1]}`);
            }
          }
        }
      }
    };
    for (const owner of withoutUsocket) {
      if (fs.existsSync(path.join(root, owner))) walk(owner, owner);
    }
    expect(found).toEqual([]);
  });
});

describe('the icon font that ships', () => {
  const mdiRoot = path.join(root, 'node_modules', '@mdi', 'font');
  const fontFile = 'fonts/materialdesignicons-webfont.woff2';
  // Font formats Chromium can load. The .eot (embedded-opentype) is not one, so it is skipped.
  const chromiumFormats = new Set(['woff2', 'woff', 'truetype', 'opentype']);
  // Anything that names a file the top-level `files` drops from @mdi/font.
  const droppedReference =
    /materialdesignicons-webfont\.(?:eot|ttf|woff)(?![\w])|@mdi\/font\/scss|materialdesignicons(?:\.min)?\.css\.map/;

  /** The node_modules stylesheets index.html links, as paths inside @mdi/font. */
  function linkedStylesheets() {
    const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
    return [...html.matchAll(/<link\b[^>]*\bhref="node_modules\/@mdi\/font\/([^"]+)"/g)].map(
      (match) => match[1]
    );
  }

  /**
   * The sources of each @font-face in a stylesheet, as Chromium reads them: the last `src` of the
   * rule wins, and its entries are tried in order.
   */
  function fontFaceSources(css) {
    const postcss = require('postcss');
    const faces = [];
    postcss.parse(css).walkAtRules('font-face', (rule) => {
      const sources = [];
      rule.walkDecls('src', (declaration) => sources.push(declaration.value));
      const entries = [
        ...String(sources.at(-1)).matchAll(
          /url\(\s*(['"]?)([^'")]+)\1\s*\)(?:\s*format\(\s*(['"]?)([^'")]+)\3\s*\))?/g
        ),
      ].map((match) => ({ url: match[2], format: match[4] || '' }));
      faces.push(entries);
    });
    return faces;
  }

  it.each(['linux', 'mac', 'win'])(
    'keeps only the woff2, with no scss and no source maps, on %s',
    (platform) => {
      const packed = packedFiles('@mdi/font', platform);
      expect(packed.filter((file) => file.startsWith('fonts/'))).toEqual([fontFile]);
      expect(packed.filter((file) => file.startsWith('scss/'))).toEqual([]);
      expect(packed.filter((file) => file.endsWith('.map'))).toEqual([]);
      for (const stylesheet of linkedStylesheets()) expect(packed).toContain(stylesheet);
      // The formats dropped are installed, so the first check is not passing on a near-empty folder.
      const installed = fs.readdirSync(path.join(mdiRoot, 'fonts'));
      for (const extension of ['eot', 'ttf', 'woff', 'woff2']) {
        expect(installed).toContain(`materialdesignicons-webfont.${extension}`);
      }
    }
  );

  it('loads the woff2 first from the stylesheet index.html links', () => {
    const stylesheets = linkedStylesheets();
    expect(stylesheets).toEqual(['css/materialdesignicons.min.css']);
    const packed = new Set(packedFiles('@mdi/font', 'linux'));
    for (const stylesheet of stylesheets) {
      const faces = fontFaceSources(fs.readFileSync(path.join(mdiRoot, stylesheet), 'utf8'));
      expect(faces).toHaveLength(1);
      // Chromium skips the formats it cannot read and stops at the first it can, so nothing after
      // the woff2 is ever asked for, and nothing before it can be loaded.
      const loaded = faces[0].find((entry) => chromiumFormats.has(entry.format));
      expect(loaded.format).toBe('woff2');
      const target = path.posix
        .normalize(path.posix.join(path.posix.dirname(stylesheet), loaded.url))
        .replace(/[?#].*$/, '');
      expect(target).toBe(fontFile);
      expect(packed.has(target)).toBe(true);
    }
  });

  it('leaves nothing in the app pointing at a dropped file', () => {
    const files = [];
    const walkInto = (entry) => {
      const full = path.join(root, entry);
      if (!fs.existsSync(full)) return;
      if (fs.statSync(full).isDirectory()) {
        for (const child of fs.readdirSync(full)) {
          if (child !== 'node_modules') walkInto(path.join(entry, child));
        }
      } else if (/\.(?:c?js|mjs|html|css|json)$/.test(entry)) {
        files.push(entry);
      }
    };
    // The packed app files, and the sources the renderer and preload bundles are built from.
    for (const entry of positives(config.files)) walkInto(entry.replace(/\/\*\*\/\*$/, ''));
    for (const entry of ['renderer.js', 'preload.js']) walkInto(entry);
    expect(files).toEqual(expect.arrayContaining(['index.html', 'styles.css', 'main.js']));
    const offenders = files.filter((file) =>
      droppedReference.test(fs.readFileSync(path.join(root, file), 'utf8'))
    );
    expect(offenders).toEqual([]);
    // Inside @mdi/font, files name each other by relative path. The stylesheet still names the other
    // formats in its @font-face (read by the test above) and its source map in a comment only
    // DevTools follows, which a packaged build does not offer (src/application-menu.cjs).
    // scripts/verify.js is the package's own check before it is published, and reads the scss;
    // nothing runs it. No other packed file names a dropped one.
    const relativeReference =
      /materialdesignicons-webfont\.(?:eot|ttf|woff)(?![\w])|\bscss\/|\.css\.map\b/;
    const checked = [];
    for (const file of packedFiles('@mdi/font', 'linux')) {
      if (!/\.(?:css|js|json|html)$/.test(file) || file === 'scripts/verify.js') continue;
      let text = fs.readFileSync(path.join(mdiRoot, file), 'utf8');
      if (file.endsWith('.css')) {
        text = text
          .replace(/@font-face\s*\{[^}]*\}/g, '')
          .replace(/\/\*# sourceMappingURL=[^*]*\*\//g, '');
      }
      checked.push(file);
      expect([file, relativeReference.test(text)]).toEqual([file, false]);
    }
    expect(checked).toEqual(
      expect.arrayContaining(['css/materialdesignicons.min.css', 'preview.html'])
    );
    // verify.js is what @mdi/font runs before it publishes, not something a stylesheet loads.
    const mdiPackage = JSON.parse(fs.readFileSync(path.join(mdiRoot, 'package.json'), 'utf8'));
    expect(mdiPackage.scripts.prepublish).toBe('node scripts/verify.js');
  });
});

describe('the uiohook-napi files that ship', () => {
  const pkg = require('../../package.json');
  const uiohookRoot = path.join(root, 'node_modules', 'uiohook-napi');
  // An optional dependency, so an install can be without it.
  const hasUiohook = fs.existsSync(path.join(uiohookRoot, 'prebuilds'));
  const itWithUiohook = hasUiohook ? it : it.skip;
  // electron-builder's name for each system, and the one node-gyp-build gives its prebuilds.
  const systems = { linux: 'linux', mac: 'darwin', win: 'win32' };
  const prebuildsOf = (files) =>
    [
      ...new Set(
        files.filter((file) => file.startsWith('prebuilds/')).map((file) => file.split('/')[1])
      ),
    ].sort();

  /** The architectures a platform's release packages are built for. */
  function releasedArchitectures(platform) {
    if (platform === 'mac') {
      // npm run dist:mac builds one universal app, which holds the x64 and the arm64 app.
      return pkg.scripts['dist:mac'].includes('--universal') ? ['arm64', 'x64'] : [];
    }
    return [...new Set(config[platform].target.flatMap((target) => target.arch))].sort();
  }

  itWithUiohook.each(['linux', 'mac', 'win'])(
    "keeps the x64 and arm64 builds of the %s package's own system and no other",
    (platform) => {
      const kept = prebuildsOf(packedFiles('uiohook-napi', platform));
      expect(kept).toEqual([`${systems[platform]}-arm64`, `${systems[platform]}-x64`]);
      // Every architecture a release of the platform is built for has its build.
      const released = releasedArchitectures(platform);
      expect(released.length).toBeGreaterThan(0);
      for (const arch of released) expect(kept).toContain(`${systems[platform]}-${arch}`);
    }
  );

  itWithUiohook('drops on every platform only the prebuild that no package is built for', () => {
    const installed = fs.readdirSync(path.join(uiohookRoot, 'prebuilds')).sort();
    const kept = new Set(
      ['linux', 'mac', 'win'].flatMap((platform) =>
        prebuildsOf(packedFiles('uiohook-napi', platform))
      )
    );
    // A prebuild a later uiohook-napi adds turns up in the test above, on the platform it is for.
    expect(installed.filter((folder) => !kept.has(folder))).toEqual(['linux-loong64']);
  });

  itWithUiohook.each(['linux', 'mac', 'win'])(
    'packs no C sources on %s, and keeps what loads',
    (platform) => {
      // build/ is what electron-builder's rebuild step compiled on this machine, if it ran, and
      // what electron-builder's own filters leave of it (on Linux, the .node alone).
      const packed = packedFiles('uiohook-napi', platform).filter(
        (file) => !file.startsWith('build/')
      );
      expect(packed.filter((file) => /\.(?:c|h|cc|cpp|gyp)$/.test(file))).toEqual([]);
      expect(packed.filter((file) => /^(?:src|libuiohook)\//.test(file))).toEqual([]);
      expect(packed).toEqual(expect.arrayContaining(['package.json', 'dist/index.js']));
      // The sources are installed, so the checks above are not passing on an empty folder.
      expect(fs.existsSync(path.join(uiohookRoot, 'binding.gyp'))).toBe(true);
      expect(fs.readdirSync(path.join(uiohookRoot, 'libuiohook', 'src')).length).toBeGreaterThan(0);
      // The loader the package uses ships with it.
      expect(fs.readFileSync(path.join(uiohookRoot, 'dist', 'index.js'), 'utf8')).toMatch(
        /require\(['"]node-gyp-build['"]\)\(/
      );
      expect(packedFiles('node-gyp-build', platform)).toEqual(
        expect.arrayContaining(['index.js', 'node-gyp-build.js', 'package.json'])
      );
    }
  );

  // node-gyp-build reads the system and architecture when it is first required, from these two
  // variables if they are set. The package is laid out without build/Release, as one whose rebuild
  // step compiled nothing, so the prebuild is the only build there is to find.
  itWithUiohook.each([
    ['linux', 'x64'],
    ['linux', 'arm64'],
    ['mac', 'x64'],
    ['mac', 'arm64'],
    ['win', 'x64'],
    ['win', 'arm64'],
  ])('lets node-gyp-build find a build in the %s package on %s', (platform, arch) => {
    const os = require('os');
    const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'uiohook-packed-'));
    const saved = { platform: process.env.npm_config_platform, arch: process.env.npm_config_arch };
    try {
      for (const file of packedFiles('uiohook-napi', platform)) {
        if (file !== 'package.json' && !file.startsWith('prebuilds/')) continue;
        fs.mkdirSync(path.join(folder, path.dirname(file)), { recursive: true });
        fs.copyFileSync(path.join(uiohookRoot, file), path.join(folder, file));
      }
      process.env.npm_config_platform = systems[platform];
      process.env.npm_config_arch = arch;
      let found = null;
      jest.isolateModules(() => {
        found = require('node-gyp-build').resolve(folder);
      });
      expect(path.relative(folder, found).split(path.sep).join('/')).toBe(
        `prebuilds/${systems[platform]}-${arch}/uiohook-napi.node`
      );
    } finally {
      for (const [key, value] of Object.entries(saved)) {
        if (value === undefined) delete process.env[`npm_config_${key}`];
        else process.env[`npm_config_${key}`] = value;
      }
      fs.rmSync(folder, { recursive: true, force: true });
    }
  });

  itWithUiohook('has the macOS universal merge take both darwin builds as they are', () => {
    // @electron/universal matches x64ArchFiles against each Mach-O file's path in the app. Each
    // darwin build is the same file in the x64 and the arm64 app, which it can only take as is.
    const universal = path.dirname(require.resolve('@electron/universal'));
    const { minimatch } = require(require.resolve('minimatch', { paths: [universal] }));
    const darwin = packedFiles('uiohook-napi', 'mac').filter((file) =>
      file.startsWith('prebuilds/darwin-')
    );
    expect(darwin).toHaveLength(2);
    for (const file of darwin) {
      const inApp = `Contents/Resources/app.asar.unpacked/node_modules/uiohook-napi/${file}`;
      expect(minimatch(inApp, config.mac.x64ArchFiles, { matchBase: true })).toBe(true);
    }
  });
});

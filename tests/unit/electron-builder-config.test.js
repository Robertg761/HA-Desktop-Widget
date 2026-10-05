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
 * The patterns electron-builder ends up matching the app's own files against on a platform, as its
 * own code builds them from the top-level and the platform `files`.
 */
function effectivePatterns(platform) {
  const { getMainFileMatchers } = require('app-builder-lib/out/fileMatcher');
  const logger = { isEnabled: false, add() {} };
  const packager = {
    info: {
      debugLogger: logger,
      projectDir: root,
      buildResourcesDir: 'build',
      config,
      isPrepackedAppAsar: false,
    },
  };
  return getMainFileMatchers(
    root,
    path.join(root, 'dist', 'app'),
    (value) => value,
    config[platform],
    packager,
    path.join(root, 'dist'),
    false
  )[0].patterns;
}

describe('what the Windows and macOS packages contain', () => {
  // The top-level and the platform `files` are added to one list, so the platform lists hold only
  // exclusions and the top-level allowlist decides what the app's own files are. A list made of
  // exclusions alone would pack everything (tests, internal docs, the website, vendored sources);
  // it is the allowlist beside it that stops that, so it must stay.
  it.each(['linux', 'mac', 'win'])('packs only an allowlist of files on %s', (platform) => {
    const patterns = effectivePatterns(platform);
    expect(patterns).not.toContain('**/*');
    for (const entry of positives(config.files)) expect(patterns).toContain(entry);
  });

  it('keeps the platform lists to exclusions, which the top-level allowlist already bounds', () => {
    expect(positives(config.files).length).toBeGreaterThan(0);
    expect(positives(config.mac.files)).toEqual([]);
    expect(positives(config.win.files)).toEqual([]);
  });

  it('shares one list between macOS and Windows', () => {
    expect(config.win.files).toBe(config.mac.files);
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

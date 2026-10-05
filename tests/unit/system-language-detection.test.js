/** @jest-environment node */
const fs = require('fs');
const os = require('os');
const path = require('path');

const {
  APP_LANGUAGES,
  createLocalizationService,
  detectSystemLocale,
  pickSpellCheckerLanguage,
} = require('../../src/i18n-main.cjs');

const root = path.resolve(__dirname, '../..');

/**
 * Electron's `app`, with the three calls the detection reads. `chromium` is what app.getLocale()
 * answers: Chromium's own pick among the .pak files that ship, so 'en-US' stands for a package
 * that has no pak for the system's language.
 */
function fakeApp({ preferred = [], systemLocale = '', chromium = 'en-US' } = {}) {
  return {
    getPreferredSystemLanguages: () => preferred,
    getSystemLocale: () => systemLocale,
    getLocale: () => chromium,
  };
}

describe('the language the app finds on the operating system', () => {
  // Each row is a system as the platforms report it, with Chromium answering en-US as it would
  // from a locales folder that does not hold the language's pak.
  it.each([
    ['es-MX', ['es-MX', 'es-MX', 'es', 'es'], 'es-MX'],
    ['zh-TW', ['zh-TW', 'zh-TW', 'zh', 'zh'], 'zh-TW'],
    ['zh-Hant-TW as Windows writes it', ['zh-Hant-TW'], 'zh-hant-TW'],
    ['zh-Hans-CN as macOS writes it', ['zh-Hans-CN', 'en-US'], 'zh-hans-CN'],
    ['de-AT', ['de-AT', 'de-AT', 'de', 'de'], 'de-AT'],
    ['ar-EG', ['ar-EG'], 'ar-EG'],
    ['hi-IN', ['hi-IN'], 'hi-IN'],
    ['fr-CA', ['fr-CA', 'fr-CA', 'fr', 'fr'], 'fr-CA'],
    ['en-GB', ['en-GB', 'en-GB', 'en', 'en'], 'en-GB'],
    ['pt-BR, a language the app does not have', ['pt-BR', 'pt'], 'pt-BR'],
    ['ja-JP, a language the app does not have', ['ja-JP', 'ja-JP', 'ja', 'ja'], 'ja-JP'],
  ])(
    'reads %s from the preferred languages without asking Chromium',
    (_name, preferred, wanted) => {
      expect(detectSystemLocale(fakeApp({ preferred, chromium: 'en-US' }))).toBe(wanted);
    }
  );

  it('takes the first language in the list that the app has', () => {
    // A Japanese interface with German second: the app has German, so German, not English.
    expect(detectSystemLocale(fakeApp({ preferred: ['ja', 'de', 'en'] }))).toBe('de');
    // The user's own order wins over a language the app also has further down.
    expect(detectSystemLocale(fakeApp({ preferred: ['fr-CA', 'de-DE'] }))).toBe('fr-CA');
    // English at the top is a language like any other.
    expect(detectSystemLocale(fakeApp({ preferred: ['en-GB', 'de-DE'] }))).toBe('en-GB');
  });

  it('does not let English further down stand in for the first language', () => {
    // English is the fallback either way. Taking it would only swap the user's date and number
    // formats for US ones and name English as the language found. Common on macOS, which keeps
    // English in the list under the language the user added.
    expect(detectSystemLocale(fakeApp({ preferred: ['ja-JP', 'en-US'] }))).toBe('ja-JP');
    expect(
      detectSystemLocale(fakeApp({ preferred: ['pt-BR', 'en-US'], systemLocale: 'pt-BR' }))
    ).toBe('pt-BR');
    expect(detectSystemLocale(fakeApp({ preferred: ['ja-JP', 'en-US', 'de-DE'] }))).toBe('de-DE');
  });

  it('does not let the region setting pick the language when the list names one', () => {
    // Japanese interface, German region format: the interface language is what the app follows.
    const app = fakeApp({ preferred: ['ja-JP'], systemLocale: 'de-DE', chromium: 'de' });
    expect(detectSystemLocale(app)).toBe('ja-JP');
  });

  it('falls back to the region setting, then to Chromium, when the list is empty', () => {
    expect(detectSystemLocale(fakeApp({ preferred: [], systemLocale: 'es_MX' }))).toBe('es-MX');
    expect(
      detectSystemLocale(fakeApp({ preferred: [], systemLocale: '', chromium: 'es-419' }))
    ).toBe('es-419');
  });

  it('ignores the placeholders a system with no language set reports', () => {
    // What Electron 43 on Linux returns under LANG=C and LC_ALL=C.UTF-8.
    expect(
      detectSystemLocale(fakeApp({ preferred: [], systemLocale: 'en-US@posix', chromium: 'en-US' }))
    ).toBe('en-US');
    expect(
      detectSystemLocale(fakeApp({ preferred: ['c', 'posix', 'und'], systemLocale: 'de-DE' }))
    ).toBe('de-DE');
    expect(detectSystemLocale(fakeApp({ preferred: [''], systemLocale: 'not a locale' }))).toBe(
      'en-US'
    );
  });

  it('survives a platform that does not offer one of the calls, and answers en with none', () => {
    const throwing = () => {
      throw new Error('called before the app is ready');
    };
    expect(
      detectSystemLocale({
        getPreferredSystemLanguages: throwing,
        getSystemLocale: () => 'fr-FR',
        getLocale: throwing,
      })
    ).toBe('fr-FR');
    expect(detectSystemLocale({ getLocale: () => 'de' })).toBe('de');
    expect(detectSystemLocale({})).toBe('en');
    expect(detectSystemLocale({ getPreferredSystemLanguages: () => undefined })).toBe('en');
  });

  it('uses the first language when the check for support fails', () => {
    const isSupported = () => {
      throw new Error('service not ready');
    };
    expect(detectSystemLocale(fakeApp({ preferred: ['ja', 'de'] }), { isSupported })).toBe('ja');
  });
});

describe('the language the app shows for each of those systems', () => {
  let rootDir;

  function createService(app) {
    const bundledDir = path.join(rootDir, 'locales');
    const userDataDir = path.join(rootDir, 'user');
    const service = createLocalizationService({
      bundledDir,
      getUserDataDir: () => userDataDir,
      appVersion: '4.0.0',
      // The same wiring as main.js.
      getDetectedLocale: () =>
        detectSystemLocale(app, { isSupported: (locale) => service.isSupportedLanguage(locale) }),
      getSystemLocale: () => app.getSystemLocale(),
      manifestUrl: 'https://example.test/manifest.json',
    });
    return service;
  }

  function installPack(locale) {
    const installedDir = path.join(rootDir, 'user', 'locales');
    fs.mkdirSync(installedDir, { recursive: true });
    fs.writeFileSync(
      path.join(installedDir, `${locale}.json`),
      JSON.stringify({ locale, version: '1.0.0', messages: { Hello: `Hello in ${locale}` } })
    );
  }

  beforeEach(() => {
    rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ha-widget-detect-'));
    fs.mkdirSync(path.join(rootDir, 'locales'), { recursive: true });
    fs.writeFileSync(path.join(rootDir, 'locales', 'en.json'), JSON.stringify({ Hello: 'Hello' }));
    fs.writeFileSync(path.join(rootDir, 'locales', 'de.json'), JSON.stringify({ Hello: 'Hallo' }));
    for (const locale of ['es', 'fr', 'ar', 'hi', 'zh']) installPack(locale);
  });

  afterEach(() => {
    fs.rmSync(rootDir, { recursive: true, force: true });
  });

  // Chromium answers en-US throughout: the worst case of a trimmed locales folder. The app must
  // still end up in the system's language.
  it.each([
    ['es-MX', ['es-MX', 'es'], 'es', 'Hello in es'],
    ['zh-TW', ['zh-TW', 'zh'], 'zh', 'Hello in zh'],
    ['de-AT', ['de-AT', 'de'], 'de', 'Hallo'],
    ['ar-EG', ['ar-EG'], 'ar', 'Hello in ar'],
    ['hi-IN', ['hi-IN'], 'hi', 'Hello in hi'],
    ['fr-CA', ['fr-CA', 'fr'], 'fr', 'Hello in fr'],
    ['en-GB', ['en-GB', 'en'], 'en', 'Hello'],
  ])('shows %s in its own language', (_name, preferred, activeLocale, hello) => {
    const bootstrap = createService(fakeApp({ preferred })).getLocaleBootstrap('auto');
    expect(bootstrap.activeLocale).toBe(activeLocale);
    expect(bootstrap.messages.Hello).toBe(hello);
  });

  it('shows English, and names the language it found, for one the app does not have', () => {
    const bootstrap = createService(fakeApp({ preferred: ['ja-JP', 'ja'] })).getLocaleBootstrap(
      'auto'
    );
    expect(bootstrap.detectedLocale).toBe('ja-JP');
    expect(bootstrap.activeLocale).toBe('en');
    expect(bootstrap.usingEnglishFallback).toBe(true);
    expect(bootstrap.messages.Hello).toBe('Hello');
  });

  // The renderer formats dates and numbers in a same-language candidate when it finds one, so an
  // en-US here would turn a Brazilian user's "1.234,5" into "1,234.5" (see format.test.js).
  it.each([
    ['pt-BR then en-US', ['pt-BR', 'en-US'], 'pt-BR'],
    ['ja-JP then en-US, as macOS lists it', ['ja-JP', 'en-US'], 'ja-JP'],
  ])(
    'keeps the system language, not the English under it, for %s',
    (_name, preferred, systemLocale) => {
      const bootstrap = createService(fakeApp({ preferred, systemLocale })).getLocaleBootstrap(
        'auto'
      );
      expect(bootstrap.detectedLocale).toBe(systemLocale);
      expect(bootstrap.systemLocale).toBe(systemLocale);
      expect(bootstrap.activeLocale).toBe('en');
      expect(bootstrap.usingEnglishFallback).toBe(true);
      expect(bootstrap.messages.Hello).toBe('Hello');
    }
  );

  it('still uses a pack for a language that is not in the list but is installed', () => {
    // A pack the remote manifest added after this release: the list has never heard of Japanese,
    // but a Japanese-then-English system should get the pack, not the English that follows it.
    installPack('ja');
    const service = createService(fakeApp({ preferred: ['ja-JP', 'en-US'] }));
    expect(service.isSupportedLanguage('ja-JP')).toBe(true);
    expect(service.getLocaleBootstrap('auto').activeLocale).toBe('ja');
    expect(service.isSupportedLanguage('ko-KR')).toBe(false);
    expect(service.isSupportedLanguage('not a locale')).toBe(false);
  });
});

describe('the app languages the detection knows', () => {
  it('are the bundled catalogs and the packs in the manifest, and nothing else', () => {
    const bundled = fs
      .readdirSync(path.join(root, 'locales'))
      .filter((name) => name.endsWith('.json'))
      .map((name) => name.replace(/\.json$/, ''));
    const manifest = JSON.parse(
      fs.readFileSync(path.join(root, 'locale-packs', 'manifest.json'), 'utf8')
    );
    const packs = manifest.packs.map((pack) => pack.locale.split('-')[0]);
    expect([...APP_LANGUAGES].sort()).toEqual([...new Set([...bundled, ...packs])].sort());
    expect(APP_LANGUAGES).toEqual(
      expect.arrayContaining(['en', 'de', 'es', 'fr', 'ar', 'hi', 'zh'])
    );
  });
});

describe('the spell checker language', () => {
  // session.availableSpellCheckerLanguages under Electron 43 on Linux.
  const available = [
    'af bg ca cs cy da de de-DE el en en-AU en-CA en-GB en-GB-oxendict en-US es es-419 es-AR',
    'es-ES es-MX es-US et fa fo fr fr-FR gl he hi hr hu hy id it it-IT ko lt lv nb nl pl pt pt-BR',
    'pt-PT ro ru sh sk sl sq sr sv ta tg tr uk vi',
  ]
    .join(' ')
    .split(' ');

  // What Chromium picks once the trimmed package has no pak for the language: en-US, measured
  // with LANG=pt_BR.UTF-8 and LANG=ja_JP.UTF-8 against the trimmed locales folder.
  it.each([
    ['pt-BR', ['pt-BR', 'pt-BR', 'pt', 'pt'], 'pt-BR'],
    ['pt-BR then en-US on Windows', ['pt-BR', 'en-US'], 'pt-BR'],
    ['it-IT', ['it-IT', 'it'], 'it-IT'],
    ['nl-NL, by its language', ['nl-NL', 'nl'], 'nl'],
    ['ja-JP then pt-BR, the first with a dictionary', ['ja-JP', 'pt-BR'], 'pt-BR'],
  ])('moves %s off the English it would start in', (_name, preferred, wanted) => {
    expect(pickSpellCheckerLanguage(preferred, available, ['en-US'])).toBe(wanted);
  });

  it.each([
    // The app's languages keep their pak, so Chromium already picked a dictionary in them.
    ['es-MX on es-419', ['es-MX', 'es'], ['es-419']],
    ['de-AT on de', ['de-AT', 'de'], ['de']],
    ['en-GB on en-GB', ['en-GB', 'en'], ['en-GB']],
    // No dictionary for Japanese, and English after it is what the spell checker is in.
    ['ja-JP then en-US', ['ja-JP', 'en-US'], ['en-US']],
    // A language with no dictionary at all, and a list with nothing usable in it.
    ['zh-TW alone', ['zh-TW', 'zh'], ['en-US']],
    ['an empty list', [], ['en-US']],
    ['placeholders', ['c', 'posix'], ['en-US']],
  ])('leaves %s as it is', (_name, preferred, current) => {
    expect(pickSpellCheckerLanguage(preferred, available, current)).toBe('');
  });

  it('follows a system that changed language since the last pick', () => {
    // The pick is saved in the profile, so the next start sees it as the current language.
    expect(pickSpellCheckerLanguage(['de-DE', 'de'], available, ['pt-BR'])).toBe('de-DE');
    // Japanese has no dictionary, so back to the English Chromium starts Japanese in.
    expect(pickSpellCheckerLanguage(['ja-JP', 'ja'], available, ['pt-BR'])).toBe('en-US');
    expect(pickSpellCheckerLanguage(['ja-JP', 'ja'], available, ['en-GB'])).toBe('');
    expect(pickSpellCheckerLanguage(['ja-JP', 'ja'], available, [])).toBe('');
  });

  it('answers with the code as the session lists it, and copes with missing input', () => {
    expect(pickSpellCheckerLanguage(['en-gb-oxendict'], available, ['de'])).toBe('en-GB-oxendict');
    expect(pickSpellCheckerLanguage(['pt_BR'], ['pt-BR'], [])).toBe('pt-BR');
    expect(pickSpellCheckerLanguage(['pt-BR'], undefined, undefined)).toBe('');
    expect(pickSpellCheckerLanguage(undefined, available)).toBe('');
  });
});

describe('how main.js asks for the language', () => {
  const mainSource = fs.readFileSync(path.join(root, 'main.js'), 'utf8');

  it('reads the operating system through the detection, not Chromium first', () => {
    const start = mainSource.indexOf('getDetectedLocale:');
    const block = mainSource.slice(start, mainSource.indexOf('manifestUrl:', start));
    expect(start).toBeGreaterThan(-1);
    expect(block).toContain('detectSystemLocale(app,');
    expect(block).toContain('localizationService.isSupportedLanguage(locale)');
    // app.getLocale() depends on the .pak files that ship. It is the last resort, and that lives
    // inside detectSystemLocale.
    expect(block).not.toContain('getLocale');
  });
});

describe('how main.js sets the spell checker language', () => {
  const mainSource = fs.readFileSync(path.join(root, 'main.js'), 'utf8');

  it('sets it from the system on Windows and Linux when the app starts', () => {
    const start = mainSource.indexOf('function applySystemSpellCheckerLanguage(');
    const body = mainSource.slice(start, mainSource.indexOf('\n}\n', start));
    expect(start).toBeGreaterThan(-1);
    expect(body).toContain("process.platform === 'darwin'");
    expect(body).toContain('app.getPreferredSystemLanguages()');
    expect(body).toContain('setSpellCheckerLanguages([language])');
    // Once, on the session the windows use, after the app is ready.
    const call = 'applySystemSpellCheckerLanguage(session.defaultSession)';
    const ready = mainSource.indexOf('installSessionPermissionPolicy(session.defaultSession');
    expect(mainSource.split(call)).toHaveLength(2);
    expect(mainSource.indexOf(call)).toBeGreaterThan(ready);
    const readyHandler = mainSource.indexOf('\n  .whenReady()');
    expect(readyHandler).toBeGreaterThan(-1);
    expect(ready).toBeGreaterThan(readyHandler);
  });
});

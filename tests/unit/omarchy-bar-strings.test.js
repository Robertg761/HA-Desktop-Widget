const fs = require('fs');
const os = require('os');
const path = require('path');

const { createLocalizationService } = require('../../src/i18n-main.cjs');
const {
  OMARCHY_BAR_STRING_SOURCES,
  buildOmarchyBarStatus,
  buildOmarchyBarStrings,
} = require('../../src/omarchy-bar.cjs');
const { HVAC_MODE_NAMES } = require('../../packages/widget-renderer/src/ha-state-names.cjs');

const root = path.resolve(__dirname, '../..');
const english = JSON.parse(fs.readFileSync(path.join(root, 'locales', 'en.json'), 'utf8'));
const qml = fs.readFileSync(path.join(root, 'omarchy-plugin', 'Widget.qml'), 'utf8');

const packLocales = ['ar', 'de', 'es', 'fr', 'hi', 'zh'];
const readPack = (locale) =>
  JSON.parse(fs.readFileSync(path.join(root, 'locale-packs', `${locale}.json`), 'utf8')).messages;
const placeholdersOf = (text) => [...text.matchAll(/\{\{\s*([\w.]+)\s*\}\}/g)].map((m) => m[1]);

// The id each thermostat mode's name goes out under, as the plugin's modeLabel asks for it.
const [, modeLabelSource] = /function modeLabel\(mode\) \{\s*var labels = \{([^}]*)\}/.exec(qml);
const modeLabels = Object.fromEntries(
  [...modeLabelSource.matchAll(/(\w+): word\("(\w+)", "([^"]*)"\)/g)].map(
    ([, mode, id, fallback]) => [mode, { id, fallback }]
  )
);
const modeIds = Object.fromEntries(Object.entries(modeLabels).map(([mode, { id }]) => [mode, id]));

describe('the words the widget sends to the Omarchy bar panel', () => {
  it('are all strings the catalogs have, so a language can translate each', () => {
    for (const source of Object.values(OMARCHY_BAR_STRING_SOURCES)) {
      expect(english).toHaveProperty([source]);
    }
  });

  it.each(packLocales)('are all translated in the %s pack', (locale) => {
    const pack = readPack(locale);
    for (const source of Object.values(OMARCHY_BAR_STRING_SOURCES)) {
      expect(pack[source]).toBeTruthy();
    }
  });

  it('come back in the language of the translate function', () => {
    const german = { Connected: 'Verbunden', 'Action: Open': 'Öffnen' };

    const strings = buildOmarchyBarStrings((key) => german[key] ?? key);

    expect(strings.connected).toBe('Verbunden');
    expect(strings.open).toBe('Öffnen');
    // Not translated: the English, and a context key shows the word after its colon.
    expect(strings.stop).toBe('Stop');
    expect(buildOmarchyBarStrings((key) => key).open).toBe('Open');
    expect(strings.now).toBe('Now {{temperature}}');
  });

  describe('through the localization service main.js translates with', () => {
    let userDataDir;

    beforeAll(() => {
      // An installed pack is the real pack file in the user data folder, as the Settings
      // download leaves it.
      userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ha-widget-bar-strings-'));
      fs.mkdirSync(path.join(userDataDir, 'locales'));
      for (const locale of packLocales) {
        fs.copyFileSync(
          path.join(root, 'locale-packs', `${locale}.json`),
          path.join(userDataDir, 'locales', `${locale}.json`)
        );
      }
    });

    afterAll(() => {
      fs.rmSync(userDataDir, { recursive: true, force: true });
    });

    const stringsFor = (language) => {
      const service = createLocalizationService({
        bundledDir: path.join(root, 'locales'),
        getUserDataDir: () => userDataDir,
        appVersion: '4.0.0',
      });
      return buildOmarchyBarStrings((key, vars) => service.translate(language, key, vars));
    };
    const templated = Object.entries(OMARCHY_BAR_STRING_SOURCES).filter(
      ([, source]) => placeholdersOf(source).length > 0
    );

    it('has strings with placeholders for these tests to cover', () => {
      expect(templated.map(([id]) => id)).toEqual(expect.arrayContaining(['now', 'omittedMany']));
    });

    it.each(['en', ...packLocales])(
      'leaves the placeholders in %s for the plugin to fill in',
      (language) => {
        const strings = stringsFor(language);

        for (const [id, source] of templated) {
          expect(placeholdersOf(strings[id]).sort()).toEqual(placeholdersOf(source).sort());
        }
        expect(strings.now).toContain('{{temperature}}');
        expect(strings.omittedMany).toContain('{{count}}');
      }
    );

    it.each(['en', ...packLocales])(
      'names each thermostat mode in %s as the widget does',
      (language) => {
        const strings = stringsFor(language);
        const catalog = language === 'en' ? english : readPack(language);

        for (const [mode, name] of Object.entries(HVAC_MODE_NAMES)) {
          expect({ mode, text: strings[modeIds[mode]] }).toEqual({ mode, text: catalog[name] });
        }
      }
    );

    it('still translates the words around a placeholder', () => {
      expect(stringsFor('de').now).toBe('Jetzt {{temperature}}');
      expect(stringsFor('en').now).toBe('Now {{temperature}}');
    });
  });

  it('go out with the status the plugin reads', () => {
    const strings = buildOmarchyBarStrings((key) => (key === 'Connected' ? 'Verbunden' : key));

    const status = buildOmarchyBarStatus({ connection: 'connected', strings });

    expect(status.strings.connected).toBe('Verbunden');
    expect(buildOmarchyBarStatus({}).strings).toEqual({});
  });
});

describe("the plugin's thermostat modes", () => {
  it("are the widget's own names for them, from HVAC_MODE_NAMES", () => {
    expect(Object.keys(modeLabels).sort()).toEqual(Object.keys(HVAC_MODE_NAMES).sort());
    for (const [mode, name] of Object.entries(HVAC_MODE_NAMES)) {
      const { id, fallback } = modeLabels[mode];
      expect({ mode, source: OMARCHY_BAR_STRING_SOURCES[id], fallback }).toEqual({
        mode,
        source: name,
        fallback: name,
      });
    }
    // The id plugins up to 1.3.0 already read for fan_only.
    expect(modeIds.fan_only).toBe('modeFan');
  });
});

describe('the plugin panel', () => {
  // Both `root.word(` and the bare `word(` of the functions inside the root item.
  const uses = [
    ...qml.matchAll(/(?:root\.)?word\("(\w+)", "((?:[^"\\]|\\.)*)"\)(\.toUpperCase\(\))?/g),
  ];

  it('asks for words the widget sends', () => {
    expect(uses.length).toBeGreaterThan(20);
    for (const [, id] of uses) {
      expect(Object.keys(OMARCHY_BAR_STRING_SOURCES)).toContain(id);
    }
  });

  it('falls back to the English the widget sends, so an older widget looks the same', () => {
    for (const [, id, fallback] of uses) {
      const source = OMARCHY_BAR_STRING_SOURCES[id].replace(/^Action: /, '');
      expect(fallback).toBe(source);
    }
  });

  it('has no English left in the markup that the widget could have sent in its language', () => {
    const literal = [...qml.matchAll(/(?:text|label|tooltipText): "([A-Za-z][^"]*)"/g)].map(
      (match) => match[1]
    );
    // The product name is not translated.
    expect(literal.filter((text) => text !== 'Home Assistant')).toEqual([]);
  });

  it('has no English sentence anywhere else in it either, such as in a condition', () => {
    // Every word() call's own fallback is English on purpose, and comments are not shown; anything
    // left is shown as it is.
    const withoutWords = qml
      .replace(/^\s*\/\/.*$/gm, '')
      .replace(/(?:root\.)?word\("\w+", "(?:[^"\\]|\\.)*"\)/g, '');
    const sentences = [...withoutWords.matchAll(/"([A-Z][^"\n]*\s[^"\n]*)"/g)].map(
      (match) => match[1]
    );
    // The product name is not translated ("Home Assistant: " starts the tooltip).
    expect(sentences.filter((text) => !/^Home Assistant:? ?$/.test(text))).toEqual([]);
  });
});

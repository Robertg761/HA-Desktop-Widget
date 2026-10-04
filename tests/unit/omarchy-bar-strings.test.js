const fs = require('fs');
const path = require('path');

const {
  OMARCHY_BAR_STRING_SOURCES,
  buildOmarchyBarStatus,
  buildOmarchyBarStrings,
} = require('../../src/omarchy-bar.cjs');

const root = path.resolve(__dirname, '../..');
const english = JSON.parse(fs.readFileSync(path.join(root, 'locales', 'en.json'), 'utf8'));
const qml = fs.readFileSync(path.join(root, 'omarchy-plugin', 'Widget.qml'), 'utf8');

const packLocales = ['ar', 'de', 'es', 'fr', 'hi', 'zh'];
const readPack = (locale) =>
  JSON.parse(fs.readFileSync(path.join(root, 'locale-packs', `${locale}.json`), 'utf8')).messages;

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

  it('go out with the status the plugin reads', () => {
    const strings = buildOmarchyBarStrings((key) => (key === 'Connected' ? 'Verbunden' : key));

    const status = buildOmarchyBarStatus({ connection: 'connected', strings });

    expect(status.strings.connected).toBe('Verbunden');
    expect(buildOmarchyBarStatus({}).strings).toEqual({});
  });
});

describe('the plugin panel', () => {
  const uses = [...qml.matchAll(/root\.word\("(\w+)", "((?:[^"\\]|\\.)*)"\)(\.toUpperCase\(\))?/g)];

  it('asks for words the widget sends', () => {
    expect(uses.length).toBeGreaterThan(20);
    for (const [, id] of uses) {
      expect(Object.keys(OMARCHY_BAR_STRING_SOURCES)).toContain(id);
    }
  });

  it('falls back to the English the widget sends, so an older widget looks the same', () => {
    for (const [, id, fallback] of uses) {
      const source = OMARCHY_BAR_STRING_SOURCES[id].replace(/^Action: /, '');
      // The panel writes "Connecting…" with one ellipsis character where the catalog has three dots.
      expect(fallback.replace('…', '...')).toBe(source);
    }
  });

  it('has no English left in the markup that the widget could have sent in its language', () => {
    const literal = [...qml.matchAll(/(?:text|label|tooltipText): "([A-Za-z][^"]*)"/g)].map(
      (match) => match[1]
    );
    // The product name is not translated.
    expect(literal.filter((text) => text !== 'Home Assistant')).toEqual([]);
  });
});

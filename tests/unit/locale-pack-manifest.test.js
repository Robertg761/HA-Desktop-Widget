const nodeCrypto = require('crypto');
const fs = require('fs');
const path = require('path');

const { expectNoNewEntries, expectNoStaleEntries } = require('../helpers/ratchet.js');
const allowlist = require('../fixtures/locale-pack-untranslated-allowlist.json');
const baseline = require('../fixtures/locale-pack-untranslated-baseline.json');

const ALLOWLIST_FILE = 'tests/fixtures/locale-pack-untranslated-allowlist.json';
const BASELINE_FILE = 'tests/fixtures/locale-pack-untranslated-baseline.json';

/** Every `locale|key` whose pack text is the English text, ignoring text that is only placeholders. */
function collectIdenticalToEnglish() {
  const packDir = path.resolve(__dirname, '../../locale-packs');
  const english = require('../../locales/en.json');
  const manifest = JSON.parse(fs.readFileSync(path.join(packDir, 'manifest.json'), 'utf8'));
  const identical = [];
  for (const { locale } of manifest.packs) {
    const { messages } = JSON.parse(fs.readFileSync(path.join(packDir, `${locale}.json`), 'utf8'));
    for (const key of Object.keys(english)) {
      const hasWords = /\p{L}/u.test(english[key].replace(/\{\{\s*[\w.]+\s*\}\}/g, ''));
      if (hasWords && messages[key] === english[key]) identical.push(`${locale}|${key}`);
    }
  }
  return identical;
}

describe('downloadable locale-pack manifest', () => {
  test('contains the current SHA-256 hash for every published pack', () => {
    const packDir = path.resolve(__dirname, '../../locale-packs');
    const manifest = JSON.parse(fs.readFileSync(path.join(packDir, 'manifest.json'), 'utf8'));

    for (const pack of manifest.packs) {
      const content = fs.readFileSync(path.join(packDir, `${pack.locale}.json`));
      const actualHash = nodeCrypto.createHash('sha256').update(content).digest('hex');
      expect(pack.sha256).toBe(actualHash);
    }
  });

  test('publishes every bundled English message in every downloadable pack', () => {
    const packDir = path.resolve(__dirname, '../../locale-packs');
    const englishMessages = JSON.parse(
      fs.readFileSync(path.resolve(__dirname, '../../locales/en.json'), 'utf8')
    );
    const manifest = JSON.parse(fs.readFileSync(path.join(packDir, 'manifest.json'), 'utf8'));
    const englishKeys = Object.keys(englishMessages).sort();

    for (const manifestEntry of manifest.packs) {
      const pack = JSON.parse(
        fs.readFileSync(path.join(packDir, `${manifestEntry.locale}.json`), 'utf8')
      );
      expect(pack.version).toBe(manifestEntry.version);
      expect(Object.keys(pack.messages).sort()).toEqual(englishKeys);
    }
  });

  test('has no empty or whitespace-only text in any catalog or pack', () => {
    const root = path.resolve(__dirname, '../..');
    const manifest = JSON.parse(
      fs.readFileSync(path.join(root, 'locale-packs', 'manifest.json'), 'utf8')
    );
    const catalogs = {
      'locales/en.json': require('../../locales/en.json'),
      'locales/de.json': require('../../locales/de.json'),
    };
    for (const { locale } of manifest.packs) {
      const file = `locale-packs/${locale}.json`;
      catalogs[file] = JSON.parse(fs.readFileSync(path.join(root, file), 'utf8')).messages;
    }
    for (const [file, messages] of Object.entries(catalogs)) {
      // A hand edit can leave a number, null or an object where text belongs; String() would hide it.
      const blank = Object.keys(messages).filter(
        (key) => typeof messages[key] !== 'string' || !messages[key].trim()
      );
      expect({ file, blank }).toEqual({ file, blank: [] });
    }
  });

  test('bundles a complete German catalog alongside English', () => {
    const englishMessages = JSON.parse(
      fs.readFileSync(path.resolve(__dirname, '../../locales/en.json'), 'utf8')
    );
    const germanMessages = JSON.parse(
      fs.readFileSync(path.resolve(__dirname, '../../locales/de.json'), 'utf8')
    );
    const pack = JSON.parse(
      fs.readFileSync(path.resolve(__dirname, '../../locale-packs/de.json'), 'utf8')
    );

    expect(Object.keys(germanMessages).sort()).toEqual(Object.keys(englishMessages).sort());
    expect(pack.locale).toBe('de');
    expect(pack.displayName).toBe('Deutsch');
    expect(pack.messages).toEqual(germanMessages);
  });
  test('translates onboarding and readability messages without losing placeholders', () => {
    const keys = [
      'Text and control size',
      'Enlarges the whole interface, including dialogs and desktop pins.',
      'High contrast with opaque panels',
      'Failed to save readability settings',
      'Controls',
      'Controls for {{name}}',
      'All devices',
      'And {{count}} more devices',
      'Choose rooms and devices',
      'Connecting to Home Assistant…',
      'My devices',
      'Page preview: {{count}} devices',
      'Rooms are unavailable. Choose from your devices instead.',
      'Search devices',
      'Skip for now',
      'Your connection is saved. Preview a room or choose devices to create your first page. You can also do this later from the empty dashboard.',
    ];
    const packDir = path.resolve(__dirname, '../../locale-packs');
    const manifest = JSON.parse(fs.readFileSync(path.join(packDir, 'manifest.json'), 'utf8'));
    const placeholders = (text) => (text.match(/{{\w+}}/g) || []).sort();
    for (const { locale } of manifest.packs) {
      const pack = JSON.parse(fs.readFileSync(path.join(packDir, `${locale}.json`), 'utf8'));
      for (const key of keys) {
        expect(pack.messages[key]).toEqual(expect.any(String));
        expect(pack.messages[key]).not.toBe(key);
        expect(placeholders(pack.messages[key])).toEqual(placeholders(key));
      }
    }
  });

  test('includes every dynamically selected tray state message', () => {
    const {
      STATE_NAMES,
      BINARY_STATE_NAMES,
      COMPACT_STATE_NAMES,
    } = require('../../src/tray-entities.cjs');
    const englishMessages = require('../../locales/en.json');
    for (const key of [
      ...Object.values(STATE_NAMES),
      ...Object.values(BINARY_STATE_NAMES).flat(),
      ...[...COMPACT_STATE_NAMES].map((name) => `Tray: ${name}`),
    ]) {
      expect(englishMessages).toHaveProperty(key);
    }
  });

  test('translates the Sync Up and Sync Down buttons and quotes them as translated', () => {
    const packDir = path.resolve(__dirname, '../../locale-packs');
    const manifest = JSON.parse(fs.readFileSync(path.join(packDir, 'manifest.json'), 'utf8'));
    const englishMessages = require('../../locales/en.json');
    const referencing = Object.keys(englishMessages).filter(
      (key) => /Sync (Up|Down)\b/.test(key) && !/^Sync (Up|Down)$/.test(key)
    );
    expect(referencing.length).toBeGreaterThan(0);
    for (const { locale } of manifest.packs) {
      const { messages } = JSON.parse(
        fs.readFileSync(path.join(packDir, `${locale}.json`), 'utf8')
      );
      for (const button of ['Sync Up', 'Sync Down']) {
        expect(messages[button]).not.toBe(button);
        for (const key of referencing.filter((k) => k.includes(button))) {
          expect(messages[key]).toContain(messages[button]);
        }
      }
    }
  });

  test('keeps the hex example in the colour hint left-to-right in the Arabic pack', () => {
    const { messages } = JSON.parse(
      fs.readFileSync(path.resolve(__dirname, '../../locale-packs/ar.json'), 'utf8')
    );
    // Without an isolate the neutral "#" drifts to the wrong side of the digits in right-to-left text.
    expect(messages['Use 3 or 6 hex digits, for example #2E9BD6']).toMatch(/\u2066#2E9BD6\u2069$/);
  });
});

describe('untranslated pack strings', () => {
  const identical = collectIdenticalToEnglish();
  const isAllowed = (entry) => {
    const [locale, key] = [entry.slice(0, entry.indexOf('|')), entry.slice(entry.indexOf('|') + 1)];
    return allowlist.any.includes(key) || (allowlist[locale] || []).includes(key);
  };

  it('has no pack text that is still English, apart from the baseline', () => {
    expectNoNewEntries(
      identical.filter((entry) => !isAllowed(entry)),
      baseline.entries,
      'These pack values are the English text. Translate them in locale-packs/<locale>.json (reuse ' +
        'the wording the pack already uses for the same words), or, only if the language really ' +
        `writes the word this way, add it to ${ALLOWLIST_FILE}. Do not add to ${BASELINE_FILE}:`
    );
  });

  it('keeps the baseline free of strings that are now translated', () => {
    expectNoStaleEntries(identical, baseline.entries, BASELINE_FILE);
  });

  it('keeps the allowlist free of strings that are now translated', () => {
    const listed = Object.entries(allowlist)
      .filter(([name]) => name !== 'comment')
      .flatMap(([name, keys]) => keys.map((key) => `${name}|${key}`));
    // An "any" entry stays while at least one pack still carries the English text.
    const present = identical.flatMap((entry) => [entry, `any${entry.slice(entry.indexOf('|'))}`]);
    expectNoStaleEntries(present, listed, ALLOWLIST_FILE, 'allowlist');
  });

  it('does not list a string in both the baseline and the allowlist', () => {
    expect(baseline.entries.filter(isAllowed)).toEqual([]);
  });
});

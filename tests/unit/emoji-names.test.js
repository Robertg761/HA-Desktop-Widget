const fs = require('fs');
const path = require('path');
const rgiEmoji = require('regenerate-unicode-properties/Property_of_Strings/RGI_Emoji.js');
const { APP_LANGUAGES } = require('../../src/i18n-main.cjs');
const { getEmojiNameLanguage, loadEmojiNames } = require('../../src/emoji-names.js');

const DIR = path.join(__dirname, '../../emoji-names');
const SKIN_TONE = /[\u{1F3FB}-\u{1F3FF}]/u;
// What CLDR has not named yet in a language. A new CLDR release that names one fails this list, and
// the entry comes off it.
const UNNAMED = { hi: ['\u{1FA8A}'] };

const listedEmoji = [
  ...rgiEmoji.strings,
  ...rgiEmoji.characters.toArray().map((codepoint) => String.fromCodePoint(codepoint)),
];
const readFile = (language) => JSON.parse(fs.readFileSync(path.join(DIR, `${language}.json`)));

describe('emoji names', () => {
  it('has a file for every language the app speaks, all from one CLDR release', () => {
    const files = fs.readdirSync(DIR).filter((file) => file.endsWith('.json'));
    expect(files.map((file) => path.basename(file, '.json')).sort()).toEqual(
      [...APP_LANGUAGES].sort()
    );
    expect(new Set(APP_LANGUAGES.map((language) => readFile(language).cldr)).size).toBe(1);
  });

  it.each(APP_LANGUAGES)('names every emoji the icon picker lists, in %s', async (language) => {
    const describe = await loadEmojiNames(language);
    const unnamed = listedEmoji.filter((icon) => !describe(icon)?.name);
    expect(unnamed).toEqual(UNNAMED[language] || []);
  });

  // The files are in the package, which was trimmed for 4.0: a skin-tone variant is made from its
  // emoji and its tone rather than stored, and a keyword the name already holds is left out.
  it('stays compact', () => {
    let total = 0;
    for (const language of APP_LANGUAGES) {
      const { emoji } = readFile(language);
      const toned = Object.keys(emoji).filter((key) => SKIN_TONE.test(key) && key.length > 2);
      expect(toned).toEqual([]);
      expect(Object.keys(emoji).some((key) => key.includes('\uFE0F'))).toBe(false);
      total += JSON.stringify(emoji).length;
    }
    expect(total).toBeLessThan(1000 * 1024);
  });

  it.each([
    ['en', '\u{1F44B}\u{1F3FB}', 'waving hand: light skin tone'],
    ['de', '\u{1F44B}\u{1F3FB}', 'winkende Hand: helle Hautfarbe'],
    // French sets a narrow no-break space before the colon.
    ['fr', '\u{1F44B}\u{1F3FB}', 'signe de la main\u202F: peau claire'],
    // The same tone twice is said once, two tones are joined the way the language joins them.
    [
      'en',
      '\u{1F9D1}\u{1F3FB}\u200D\u{1F91D}\u200D\u{1F9D1}\u{1F3FB}',
      'people holding hands: light skin tone',
    ],
    [
      'es',
      '\u{1F9D1}\u{1F3FB}\u200D\u{1F91D}\u200D\u{1F9D1}\u{1F3FC}',
      'dos personas de la mano: tono de piel claro y tono de piel claro medio',
    ],
    // A pair with no toneless emoji of its own in the list is named from its toned one.
    [
      'en',
      '\u{1F468}\u{1F3FB}\u200D\u{1F91D}\u200D\u{1F468}\u{1F3FC}',
      'men holding hands: light skin tone, medium-light skin tone',
    ],
  ])('names a skin-tone variant the way CLDR does in %s: %s', async (language, icon, name) => {
    const describe = await loadEmojiNames(language);
    expect(describe(icon).name).toBe(name);
  });

  it('keeps the tone words apart from the words for what the emoji shows', async () => {
    const describe = await loadEmojiNames('en');
    const thumb = describe('\u{1F44D}\u{1F3FD}');
    expect(thumb.words).toContain('thumbs up');
    expect(thumb.words.join(' ')).not.toMatch(/skin/);
    expect(thumb.toneWords).toContain('medium skin tone');
    expect(describe('\u{1F44D}').toneWords).toEqual([]);
  });

  it('reads the name with or without the emoji presentation selector', async () => {
    const describe = await loadEmojiNames('en');
    expect(describe('\u2600\uFE0F')).toEqual(describe('\u2600'));
    expect(describe('\u2600').name).toBe('sun');
  });

  it('loads a language by its base code and has nothing for another language', async () => {
    expect(getEmojiNameLanguage('zh-CN')).toBe('zh');
    expect(getEmojiNameLanguage('de_AT')).toBe('de');
    expect(getEmojiNameLanguage('pt-BR')).toBe('');
    await expect(loadEmojiNames('pt-BR')).resolves.toBeNull();
    expect((await loadEmojiNames('zh-CN'))('\u{1F4A1}').name).toBe('灯泡');
  });
});

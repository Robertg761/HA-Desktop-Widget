const rgiEmojiData = require('regenerate-unicode-properties/Property_of_Strings/RGI_Emoji.js');

describe('declared RGI emoji catalog', () => {
  test('preserves the complete Unicode 18 catalog without duplicates', () => {
    const catalog = [
      ...rgiEmojiData.strings,
      ...rgiEmojiData.characters.toArray().map((codepoint) => String.fromCodePoint(codepoint)),
    ];

    expect(rgiEmojiData.strings).toHaveLength(2770);
    expect(rgiEmojiData.characters.toArray()).toHaveLength(1202);
    expect(catalog).toHaveLength(3972);
    expect(new Set(catalog).size).toBe(3972);
  });

  test.each(['1️⃣', '🇨🇦', '🏳️‍🌈', '👨‍👩‍👧‍👦', '👩🏽‍💻', '🫷🏽'])(
    'includes representative RGI sequence %s',
    (emoji) => {
      expect(rgiEmojiData.strings).toContain(emoji);
    }
  );
});

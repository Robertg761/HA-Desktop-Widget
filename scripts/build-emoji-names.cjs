#!/usr/bin/env node
/**
 * Writes emoji-names/<language>.json, the names and keywords the custom icon picker searches, from
 * Unicode CLDR's emoji annotations.
 *
 * Usage:
 *   npm pack cldr-annotations-full@<version> cldr-annotations-derived-full@<version>
 *   (unpack both, then)
 *   node scripts/build-emoji-names.cjs <cldr-annotations-full dir> <cldr-annotations-derived-full dir>
 *
 * The two packages hold every CLDR language (about 160 MB unpacked), so they are not dependencies:
 * this script is run by hand when CLDR or the emoji list (regenerate-unicode-properties) moves on,
 * and the files it writes are committed. emoji-names/README.md says where they come from.
 *
 * A file has an entry for every emoji the picker lists (the RGI emoji), keyed without the
 * variation selector U+FE0F, whose value is the emoji's name followed by its keywords, joined with
 * "|". A keyword whose words are all in the name already is left out. Skin-tone variants have no
 * entry of their own: the picker reads the entry of the emoji without its tone and the names of
 * the tones, which are entries too, and puts them together with `toneName` and `toneJoin`, taken
 * from how CLDR names those variants in that language. That leaves out half the emoji, and with
 * them two thirds of the size.
 */

const fs = require('fs');
const path = require('path');
const rgiEmoji = require('regenerate-unicode-properties/Property_of_Strings/RGI_Emoji.js');
const { APP_LANGUAGES } = require('../src/i18n-main.cjs');

const OUT_DIR = path.join(__dirname, '..', 'emoji-names');
const VARIATION_SELECTOR = /\uFE0F/g;
const SKIN_TONES = ['\u{1F3FB}', '\u{1F3FC}', '\u{1F3FD}', '\u{1F3FE}', '\u{1F3FF}'];
const SKIN_TONE = /[\u{1F3FB}-\u{1F3FF}]/gu;
// Emoji whose name tells the separators apart: waving hand with one tone, and people holding hands
// with two.
const ONE_TONE_SAMPLE = { base: '\u{1F44B}', toned: '\u{1F44B}\u{1F3FB}' };
const TWO_TONE_SAMPLE = {
  base: '\u{1F9D1}\u200D\u{1F91D}\u200D\u{1F9D1}',
  toned: '\u{1F9D1}\u{1F3FB}\u200D\u{1F91D}\u200D\u{1F9D1}\u{1F3FC}',
};
const FIELD_SEPARATOR = '|';

function readAnnotations(dir, kind, language) {
  const file = path.join(dir, kind, language, 'annotations.json');
  const data = JSON.parse(fs.readFileSync(file, 'utf8'));
  return data[kind].annotations;
}

function readCldrVersion(dir) {
  return JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8')).version;
}

const stripVariationSelectors = (emoji) => emoji.replace(VARIATION_SELECTOR, '');
const stripSkinTones = (emoji) => emoji.replace(SKIN_TONE, '');

/** The emoji the picker lists, as the keys the files use. */
function listEmojiKeys() {
  const emoji = [
    ...rgiEmoji.strings,
    ...rgiEmoji.characters.toArray().map((codepoint) => String.fromCodePoint(codepoint)),
  ];
  return [...new Set(emoji.map(stripVariationSelectors))];
}

function nameOf(annotation) {
  return annotation?.tts?.[0] || '';
}

/** The name, then each keyword that adds a word the name does not have. */
function describe(name, keywords) {
  const nameWords = new Set(name.toLowerCase().split(/[\s:,]+/));
  const extra = keywords.filter((keyword) => {
    const words = keyword.toLowerCase().split(/\s+/);
    return keyword.toLowerCase() !== name.toLowerCase() && !words.every((w) => nameWords.has(w));
  });
  const fields = [name, ...new Set(extra)];
  const bad = fields.find((field) => field.includes(FIELD_SEPARATOR));
  if (bad) throw new Error(`"${bad}" contains the field separator "${FIELD_SEPARATOR}"`);
  return fields.join(FIELD_SEPARATOR);
}

/** How this language names a skin-tone variant: "{name}: {tones}", and what joins two tones. */
function readToneFormat(lookup) {
  const oneTone = nameOf(lookup(ONE_TONE_SAMPLE.toned));
  const base = nameOf(lookup(ONE_TONE_SAMPLE.base));
  const tone = nameOf(lookup(SKIN_TONES[0]));
  if (!oneTone.startsWith(base) || !oneTone.endsWith(tone)) {
    throw new Error(`Cannot read the skin-tone name format from "${oneTone}"`);
  }
  const separator = oneTone.slice(base.length, oneTone.length - tone.length);
  const twoTones = nameOf(lookup(TWO_TONE_SAMPLE.toned));
  const pairBase = nameOf(lookup(TWO_TONE_SAMPLE.base));
  const [first, second] = [SKIN_TONES[0], SKIN_TONES[1]].map((key) => nameOf(lookup(key)));
  const tones = twoTones.slice(`${pairBase}${separator}`.length);
  if (!twoTones.startsWith(`${pairBase}${separator}`) || !tones.startsWith(first)) {
    throw new Error(`Cannot read how two skin tones are joined from "${twoTones}"`);
  }
  if (!tones.endsWith(second)) throw new Error(`Cannot find "${second}" in "${twoTones}"`);
  return {
    separator,
    toneName: `{name}${separator}{tones}`,
    toneJoin: tones.slice(first.length, tones.length - second.length),
  };
}

function buildLanguage(fullDir, derivedDir, language, keys) {
  const annotations = readAnnotations(fullDir, 'annotations', language);
  const derived = readAnnotations(derivedDir, 'annotationsDerived', language);
  const lookup = (key) => annotations[key] || derived[key] || null;
  const { separator, toneName, toneJoin } = readToneFormat(lookup);
  const toneNames = new Set(SKIN_TONES.map((key) => nameOf(lookup(key)).toLowerCase()));

  const emoji = {};
  const missing = [];
  for (const key of keys) {
    const base = stripSkinTones(key);
    // A tone on its own is an entry; any other toned emoji is read from its toneless one.
    const target = base && base !== key ? base : key;
    if (emoji[target]) continue;
    const annotation = lookup(target);
    if (annotation && nameOf(annotation)) {
      emoji[target] = describe(nameOf(annotation), annotation.default || []);
      continue;
    }
    // A few toned pairs (two men holding hands, with two tones) have no toneless emoji of their
    // own in the list, so CLDR names them only with their tones. Their entry is that name with the
    // tones cut off.
    const toned = lookup(key);
    const tonedName = nameOf(toned);
    if (target !== key && tonedName.includes(separator)) {
      const name = tonedName.slice(0, tonedName.indexOf(separator));
      const keywords = (toned.default || []).filter((word) => !toneNames.has(word.toLowerCase()));
      emoji[target] = describe(name, keywords);
      continue;
    }
    missing.push(key);
  }
  const sorted = Object.fromEntries(Object.entries(emoji).sort(([a], [b]) => (a < b ? -1 : 1)));
  return { file: { toneName, toneJoin, emoji: sorted }, missing };
}

function main() {
  const [fullDir, derivedDir] = process.argv.slice(2).map((dir) => path.resolve(dir || ''));
  if (process.argv.length < 4) {
    console.error(
      'Usage: node scripts/build-emoji-names.cjs <cldr-annotations-full dir> <cldr-annotations-derived-full dir>'
    );
    process.exitCode = 1;
    return;
  }
  const version = readCldrVersion(fullDir);
  if (readCldrVersion(derivedDir) !== version) {
    throw new Error('The two CLDR packages are different versions');
  }
  const keys = listEmojiKeys();
  fs.mkdirSync(OUT_DIR, { recursive: true });
  for (const language of APP_LANGUAGES) {
    const { file, missing } = buildLanguage(fullDir, derivedDir, language, keys);
    const target = path.join(OUT_DIR, `${language}.json`);
    fs.writeFileSync(target, `${JSON.stringify({ cldr: version, ...file }, null, 2)}\n`);
    const size = fs.statSync(target).size;
    console.log(
      `${language}: ${Object.keys(file.emoji).length} entries, ${(size / 1024).toFixed(0)} KiB` +
        (missing.length ? `, no name for ${missing.join(' ')}` : '')
    );
  }
}

main();

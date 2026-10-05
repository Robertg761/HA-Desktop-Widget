// The names and keywords Unicode CLDR gives every emoji, in each language the app speaks
// (emoji-names/, written by scripts/build-emoji-names.cjs). Without them the icon picker knew only
// the few hundred English words written into settings.js, so a German "Lampe" or any name outside
// those found nothing. A language is 100 to 230 KB, so each is a chunk of its own, loaded the first
// time the picker opens in it.

// Literal paths, so the bundler makes each file a chunk of its own.
const LOADERS = {
  ar: () => import('../emoji-names/ar.json'),
  de: () => import('../emoji-names/de.json'),
  en: () => import('../emoji-names/en.json'),
  es: () => import('../emoji-names/es.json'),
  fr: () => import('../emoji-names/fr.json'),
  hi: () => import('../emoji-names/hi.json'),
  zh: () => import('../emoji-names/zh.json'),
};

const VARIATION_SELECTOR = /\uFE0F/g;
const SKIN_TONE = /[\u{1F3FB}-\u{1F3FF}]/gu;
const FIELD_SEPARATOR = '|';

const pending = new Map();

function getEmojiNameLanguage(locale) {
  const language = String(locale || '')
    .split(/[-_]/)[0]
    .toLowerCase();
  return Object.prototype.hasOwnProperty.call(LOADERS, language) ? language : '';
}

/**
 * What one language calls an emoji. A skin-tone variant has no entry of its own: it is the emoji
 * without its tone, named the way CLDR names such variants in that language ("waving hand: light
 * skin tone"), and its tone's words are kept apart, so a search can tell "a hand" from "a light one".
 * @returns {{name: string, words: string[], toneWords: string[]} | null}
 */
function describeEmoji(data, icon) {
  const key = String(icon || '').replace(VARIATION_SELECTOR, '');
  const own = data.emoji[key]?.split(FIELD_SEPARATOR);
  if (own) return { name: own[0], words: own, toneWords: [] };

  const tones = [...new Set(key.match(SKIN_TONE) || [])];
  const base = tones.length ? data.emoji[key.replace(SKIN_TONE, '')] : null;
  if (!base) return null;
  const toneFields = tones.map((tone) => (data.emoji[tone] || '').split(FIELD_SEPARATOR));
  const words = base.split(FIELD_SEPARATOR);
  return {
    name: data.toneName
      .replace('{name}', words[0])
      .replace('{tones}', toneFields.map((fields) => fields[0]).join(data.toneJoin)),
    words,
    toneWords: toneFields.flat().filter(Boolean),
  };
}

/**
 * The emoji names of a language, or null when the app has none for it (it falls back to English
 * for such a language anyway).
 * @param {string} locale - A language or locale code ("de", "zh-CN").
 * @returns {Promise<((icon: string) => ({name: string, words: string[], toneWords: string[]} | null)) | null>}
 */
function loadEmojiNames(locale) {
  const language = getEmojiNameLanguage(locale);
  if (!language) return Promise.resolve(null);
  if (!pending.has(language)) {
    const load = LOADERS[language]().then((module) => {
      const data = module?.default || module;
      return (icon) => describeEmoji(data, icon);
    });
    // A chunk that failed to load is tried again next time instead of being remembered as failed.
    load.catch(() => pending.delete(language));
    pending.set(language, load);
  }
  return pending.get(language);
}

export { getEmojiNameLanguage, loadEmojiNames };

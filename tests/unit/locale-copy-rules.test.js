const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '../..');
const readJson = (...segments) => JSON.parse(fs.readFileSync(path.join(root, ...segments), 'utf8'));

const english = readJson('locales', 'en.json');
const bundledGerman = readJson('locales', 'de.json');
const packLocales = fs
  .readdirSync(path.join(root, 'locale-packs'))
  .filter(
    (file) => file.endsWith('.json') && !['manifest.json', 'retired-keys.json'].includes(file)
  )
  .map((file) => path.basename(file, '.json'));
const readPack = (locale) => readJson('locale-packs', `${locale}.json`).messages;

// Strings the app still shows. A pack also keeps the translations of retired strings for older
// apps, and those are not edited once they are retired.
const currentEntries = (messages) => Object.entries(messages).filter(([key]) => key in english);

describe('English wording', () => {
  // The interface is spelled the American way ("Window & behavior", "COLORS"). The English text is
  // the translation key, so a British spelling that slips in is a second spelling of the same word.
  const BRITISH =
    /\b(colou?r\w*|behaviou?r\w*|favourit\w*|centre\w*|grey|licence|catalogue|cancell(?:ed|ing))\b/i;
  const isBritish = (text) => {
    const word = BRITISH.exec(text)?.[0].toLowerCase() || '';
    return /^(colour|behaviour|favourite|centre|grey|licence|catalogue|cancelled|cancelling)/.test(
      word
    )
      ? word
      : '';
  };

  it('spells colour, behaviour and the like the American way', () => {
    const offenders = Object.keys(english).filter((key) => isBritish(key));
    expect(offenders).toEqual([]);
  });

  // One way to write each mark: three dots and a straight apostrophe. The text is the key, so a
  // second way of writing the same words is a second string to translate and to keep in step.
  it('writes an ellipsis as three dots and an apostrophe straight', () => {
    expect(Object.keys(english).filter((key) => /[…’‘]/.test(key))).toEqual([]);
  });

  // The two portable-update notices quote a button name that is being reworded on its own; they
  // take curly marks with it.
  const QUOTING_RENAMED_BUTTON = new Set(
    Object.keys(english).filter((key) => key.includes('"Download Portable Update"'))
  );

  it('writes quotation marks curly, never straight', () => {
    // "Remove "{{name}}" from "{{page}}"?" sat beside "No settings match “{{query}}”".
    const offenders = Object.keys(english).filter(
      (key) => key.includes('"') && !QUOTING_RENAMED_BUTTON.has(key)
    );
    expect(offenders).toEqual([]);
  });

  it.each(packLocales)(
    'quotes with the marks of the language in %s, never straight ones',
    (locale) => {
      // Each pack has its own: « » in French and Spanish, «» in Arabic, „“ in German, “” in Chinese
      // and Hindi. A straight pair was copied from the English it translated.
      const offenders = currentEntries(readPack(locale))
        .filter(([key, text]) => text.includes('"') && !QUOTING_RENAMED_BUTTON.has(key))
        .map(([key]) => key.slice(0, 60));
      expect(offenders).toEqual([]);
    }
  );

  it('calls the popup hotkey a hotkey everywhere, main process included', () => {
    // A portal desktop that refused the binding answered the Popup hotkey setting with "did not
    // assign an active popup shortcut".
    expect(Object.keys(english).filter((key) => /popup shortcut/i.test(key))).toEqual([]);
  });

  it('writes Settings with its capital where a string sends the reader to the panel', () => {
    // The panel is named as its title has it ("Open Settings", "Reconnect with Home Assistant in
    // Settings"), and the custom colors warning alone said "Try Save in settings".
    expect(
      Object.keys(english).filter((key) => /\b(?:in|[Oo]pen|[Rr]eopen) settings\b/.test(key))
    ).toEqual([]);
  });

  it('keeps the names of the sync buttons in sentence case, as the buttons are written', () => {
    expect(Object.keys(english).filter((key) => /\bSync (Up|Down|Folder)\b/.test(key))).toEqual([]);
  });
});

describe('German register and terms', () => {
  // "Sie" and "Ihr..." in the middle of a sentence address the reader formally; the interface says
  // "du" ("Prüfe dein Netzwerk"). A "Sie" that opens a sentence is far more often "she/it" (a
  // feminine noun already named), so only the formal verb forms are checked there.
  const FORMAL =
    /(?<![.!?:] )(?<!^)\bSie\b|\bIhr(?:e|em|en|er|es)?\b|^Sie\s+(?:können|müssen|sollten|haben|sind)\b/;

  it.each([
    ['locales/de.json', () => bundledGerman],
    ['locale-packs/de.json', () => readPack('de')],
  ])('addresses the reader as du in %s', (_label, load) => {
    const formal = currentEntries(load())
      .filter(([, text]) => FORMAL.test(text))
      .map(([key, text]) => `${key.slice(0, 60)} => ${text.slice(0, 80)}`);
    expect(formal).toEqual([]);
  });

  it.each([
    ['locales/de.json', () => bundledGerman],
    ['locale-packs/de.json', () => readPack('de')],
  ])('uses one word each for the popup hotkey, desktop pins and Ctrl in %s', (_label, load) => {
    const text = currentEntries(load())
      .map(([, value]) => value)
      .join('\n');
    expect(text).not.toMatch(/Popup-Hotkey/);
    expect(text).not.toMatch(/Desktop-Kachel/);
    expect(text).not.toMatch(/\bStrg\b/);
  });

  it('keeps the bundled German catalog and the downloadable pack the same', () => {
    const pack = readPack('de');
    for (const [key, text] of currentEntries(bundledGerman)) expect(pack[key]).toBe(text);
  });

  it('does not give Dismiss and Close, or Clear and Delete, the same German word', () => {
    const de = readPack('de');
    expect(de.Dismiss).not.toBe(de.Close);
    expect(de['Action: Clear']).not.toBe(de.Delete);
  });
});

describe('punctuation and register of the other packs', () => {
  // Each pack writes its marks one way. Chinese uses full-width punctuation beside its characters
  // and addresses the reader as 你, French uses the straight apostrophe the rest of the pack uses,
  // and Spanish names the Settings panel "Configuración" (its values are "ajustes").
  it('writes Chinese punctuation full-width and addresses the reader as 你', () => {
    const offenders = currentEntries(readPack('zh'))
      .filter(
        ([, text]) => /[\u4e00-\u9fff][,!:;?]|[,!:;?][\u4e00-\u9fff]/.test(text) || /您/.test(text)
      )
      .map(([key, text]) => `${key.slice(0, 60)} => ${text}`);
    expect(offenders).toEqual([]);
  });

  it('holds French guillemets to their words with no-break spaces', () => {
    // A plain space let a line end after « and start with ».
    const offenders = currentEntries(readPack('fr'))
      .filter(([, text]) => /« | »/.test(text))
      .map(([key]) => key.slice(0, 60));
    expect(offenders).toEqual([]);
  });

  it('writes the French apostrophe straight', () => {
    const offenders = currentEntries(readPack('fr'))
      .filter(([, text]) => /[’‘]/.test(text))
      .map(([key]) => key.slice(0, 60));
    expect(offenders).toEqual([]);
  });

  it('names the Spanish Settings panel Configuración', () => {
    // macOS's own "Ajustes del Sistema" is the name of that app, not of this panel.
    const offenders = currentEntries(readPack('es'))
      .filter(([, text]) => /\ben Ajustes\b(?! del Sistema)/.test(text))
      .map(([key]) => key.slice(0, 60));
    expect(offenders).toEqual([]);
  });
});

describe('the palette hint for locks and alarms', () => {
  const normalize = (text) =>
    String(text)
      .normalize('NFKD')
      .replace(/[̀-ͯ]/g, '')
      .replace(/[\s\u00a0\u202f]+/g, ' ')
      .toLowerCase()
      .trim();
  // The words between quotation marks of any of the languages' styles: "x", „x“, «x», “x”.
  const quoted = (hint) =>
    [...hint.matchAll(/[„“"«]\s*([^„“”"«»]+?)\s*[“”"»]/g)].map((match) => normalize(match[1]));
  // The palette finds a command by the words typed against the command's label, so each word the
  // hint asks for has to be in a label.
  const labelsFor = (messages, verbs) =>
    verbs.map((verb) => normalize(messages[verb].replace(/\{\{\s*name\s*\}\}/g, ' ')));

  const cases = [
    [
      'alarm',
      'To control {{name}}, type “arm” or “disarm”.',
      [['Arm {{name}} at home', 'Arm {{name}} away', 'Arm {{name}} at night'], ['Disarm {{name}}']],
    ],
    [
      'lock',
      'To control {{name}}, type “lock” or “unlock”.',
      [['Lock {{name}}'], ['Unlock {{name}}']],
    ],
  ];

  // A command that is still English in a pack has an English hint to match; that is the
  // untranslated-string guard's business, not this one.
  const translated = (messages, key) => messages[key] !== key;

  describe.each(packLocales)('%s', (locale) => {
    it.each(cases)('quotes words that are in the %s command labels', (_kind, hintKey, groups) => {
      const messages = readPack(locale);
      if (!translated(messages, groups[0][0])) return;
      const words = quoted(messages[hintKey]);
      expect(words).toHaveLength(groups.length);
      words.forEach((word, index) => {
        const labels = labelsFor(messages, groups[index]);
        expect(labels.some((label) => label.includes(word))).toBe(true);
      });
    });

    it('quotes the words of the alarm and lock hints in one style', () => {
      const messages = readPack(locale);
      const styles = cases
        .filter(([, hintKey]) => translated(messages, hintKey))
        .map(([, hintKey]) => messages[hintKey].match(/[„“"«]/)?.[0]);
      expect(new Set(styles).size).toBeLessThanOrEqual(1);
    });
  });
});

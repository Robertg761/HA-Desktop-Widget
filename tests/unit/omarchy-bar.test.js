/** @jest-environment node */
const fs = require('fs');
const os = require('os');
const path = require('path');
const vm = require('vm');
const {
  OMARCHY_BAR_PLUGIN_ID,
  PLUGIN_FILES,
  buildOmarchyBarStatus,
  createOmarchyBarPublisher,
  cleanLineIconSvg,
  cleanOmarchyBarTile,
  createOmarchyBarCommandServer,
  getOmarchyBarActionRequest,
  getQuickAccessPages,
  getOmarchyBarPaths,
  installOmarchyBarPluginFiles,
  updateInstalledOmarchyBarPlugin,
  isAllowedOmarchyBarAction,
  isOmarchyShellInstalled,
  parseOmarchyBarSocketLine,
  readOmarchyBarEntry,
  rememberOmarchyBarLaunch,
  resolveOmarchyBarEntities,
} = require('../../src/omarchy-bar.cjs');
const { appId } = require('../../package.json');

const pluginDir = path.resolve(__dirname, '../../omarchy-plugin');
let root;
beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'ha-omarchy-bar-'));
});
afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

const lightTile = {
  name: 'Desk lamp',
  state: 'on',
  value: '85%',
  icon: { kind: 'line', name: 'lightbulb' },
  available: true,
  missing: false,
  active: true,
  action: 'toggle',
  controls: true,
};

describe('Omarchy bar plugin package', () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(pluginDir, 'manifest.json'), 'utf8'));

  // The same checks as Omarchy's omarchy-plugin-validate.
  it('passes omarchy plugin validate', () => {
    expect(manifest.schemaVersion).toBe(1);
    ['id', 'name', 'version', 'kinds', 'entryPoints'].forEach((key) =>
      expect(manifest[key]).toBeTruthy()
    );
    expect(manifest.id).toMatch(/^[A-Za-z0-9][A-Za-z0-9._-]*$/);
    expect(manifest.id).not.toMatch(/^omarchy\./);
    expect(manifest.id).not.toContain('..');
    expect(manifest.kinds).toEqual(['bar-widget']);
    expect(['left', 'center', 'right']).toContain(manifest.barWidget.defaultSection);
    for (const entry of Object.values(manifest.entryPoints)) {
      expect(entry).not.toMatch(/^\/|\.\.|\n/);
      expect(fs.existsSync(path.join(pluginDir, entry))).toBe(true);
    }
    for (const file of fs.readdirSync(pluginDir)) {
      expect(fs.lstatSync(path.join(pluginDir, file)).isSymbolicLink()).toBe(false);
    }
    expect(PLUGIN_FILES).toEqual(expect.arrayContaining(['manifest.json', 'Widget.qml']));
  });

  // A file missing from the list is never copied to the user's plugin directory, and the widget
  // then fails to load there while working from the source tree.
  it('installs every file of the plugin, and the widget imports each script', () => {
    expect([...PLUGIN_FILES].sort()).toEqual(fs.readdirSync(pluginDir).sort());
    const qml = fs.readFileSync(path.join(pluginDir, 'Widget.qml'), 'utf8');
    for (const script of PLUGIN_FILES.filter((file) => file.endsWith('.js'))) {
      expect(qml).toContain(`import "${script}" as `);
    }
  });

  it('uses the app id for the plugin, its module name, and its status file', () => {
    expect(manifest.id).toBe(appId);
    expect(OMARCHY_BAR_PLUGIN_ID).toBe(appId);
    const qml = fs.readFileSync(path.join(pluginDir, 'Widget.qml'), 'utf8');
    expect(qml).toContain(`moduleName: "${appId}"`);
    expect(qml).toContain('"/ha-desktop-widget/omarchy-bar.json"');
    // Actions go through the widget's command line, which main handles.
    expect(qml).toContain('launch(["--toggle"])');
    expect(qml).toContain('"--entity-action=" + tile.id');
    expect(qml).toContain('"--entity-controls=" + tile.id');
    // It reads the fields buildOmarchyBarStatus writes.
    expect(qml).toContain('parsed.version === 1');
    // A locked keyring gets its own advice rather than the generic sign-in text.
    expect(qml).toContain('status.issue === "keyring"');
    // Tiles only act through a connected widget, and only as the widget's own tile would.
    expect(qml).toContain(
      'return connected && tile && tile.action !== undefined && tile.action !== "none"'
    );
    expect(qml).toContain('return connected && tile && tile.controls === true');
    // Clicks and control changes go over the widget's socket; the command line is the fallback.
    expect(qml).toContain('"/ha-desktop-widget/omarchy-bar.sock"');
    expect(qml).toContain('commandSocket.write(JSON.stringify(request) + "\\n")');
    expect(qml).toContain('if (!sendRequest({ id: tile.id, kind: "primary" }))');
    // Holding a tile opens its controls in the panel, as holding it in the widget does.
    expect(qml).toContain('pressAndHoldInterval: 500');
    expect(qml).toContain('var request = { id: controlsTile.id, kind: "set", command: command }');
    // Line icons are the widget's own SVGs, recoloured from currentColor.
    expect(qml).toContain('svg.split("currentColor").join(hex)');
    // The launch command it keeps for a widget that has quit.
    expect(qml).toContain('"/ha-desktop-widget/omarchy-bar-launch.json"');
    expect(qml).toContain('parsed.launch');
    // Offline, an explicit command setting wins over the remembered one.
    const launchBody = qml.slice(
      qml.indexOf('function launch('),
      qml.indexOf('function toggleWidget')
    );
    expect(launchBody.indexOf('configured !== ""')).toBeGreaterThan(-1);
    expect(launchBody.indexOf('configured !== ""')).toBeLessThan(launchBody.indexOf('savedLaunch'));
    ['updatedAt', 'connection', 'launch', 'panel', 'bar', 'sections', 'icons'].forEach((field) =>
      expect(qml).toContain(`status.${field}`)
    );
  });

  // The bar slot is as wide as its text, so a long media title must not push the other widgets
  // off the bar, and a vertical bar's slot is one glyph wide.
  describe('the bar readout', () => {
    const qml = fs.readFileSync(path.join(pluginDir, 'Widget.qml'), 'utf8');
    const { clip, graphemes } = vm.runInNewContext(
      fs.readFileSync(path.join(pluginDir, 'Clip.js'), 'utf8') + '\n({ clip, graphemes })'
    );

    it('cuts each value and the whole readout short, with the full text in the tooltip', () => {
      expect(qml).toContain('readonly property int barValueChars: 16');
      expect(qml).toContain('readonly property int barTextChars: 48');
      expect(qml).toContain(
        'barValues.map(function(value) { return clipText(value, barValueChars) }).join("  "),'
      );
      // The tooltip lists every value in full on its own line.
      expect(qml).toContain('"\\n" + root.barValues.join("  ")');
    });

    it('shows only the glyph on a vertical bar', () => {
      expect(qml).toContain(
        'readonly property bool verticalBar: bar ? bar.vertical === true : false'
      );
      expect(qml).toContain('readonly property string barText: verticalBar ? "" : clipText(');
      expect(qml).toContain('text: root.barText !== "" ? "󰟐  " + root.barText : "󰟐"');
    });

    it('clips with the grapheme-aware script rather than String.slice()', () => {
      expect(qml).toContain('import "Clip.js" as Clip');
      expect(qml).toContain('return Clip.clip(text, limit)');
      expect(qml.match(/function clipText\(text, limit\) \{[^}]*\}/)[0]).not.toContain('slice(');
    });

    it('ends a clipped text with an ellipsis inside its limit', () => {
      expect(clip('short', 16)).toBe('short');
      expect(clip('x'.repeat(16), 16)).toBe('x'.repeat(16));
      expect(clip('A very long media title indeed', 16)).toBe('A very long med…');
      expect(clip('A very long media title indeed', 16)).toHaveLength(16);
      expect(clip('', 16)).toBe('');
    });

    // A cut that falls inside a character left a replacement glyph (half a surrogate pair) or a
    // letter without its accent. Each case is one visible character at the 16th place.
    describe('never cuts inside a character', () => {
      const lead = 'x'.repeat(14);
      const characters = {
        'an emoji': '😀',
        'an emoji with a skin tone': '👍🏽',
        'a family of joined emoji': '👨‍👩‍👧‍👦',
        'a joined emoji with a variation selector': '🏳️‍🌈',
        'a flag': '🇩🇪',
        'a keycap': '1️⃣',
        'a letter with a combining accent': 'e\u0301',
        'a letter with two combining marks': 'a\u0308\u0301',
        'a Hangul syllable written as jamo': '\u1112\u1161\u11ab',
        'a Thai letter with its vowel and tone marks': 'ก\u0e49\u0e33',
        'a CRLF': '\r\n',
      };

      it.each(Object.entries(characters))('keeps %s whole at the cut', (_name, character) => {
        // 14 letters, the character in 15th place, and more text after it.
        const text = `${lead}${character}${character}yy`;
        const cut = clip(text, 16);
        expect(cut).toBe(`${lead}${character}…`);
        expect(graphemes(cut)).toHaveLength(16);
      });

      it.each(Object.entries(characters))('lets %s fill the last place', (_name, character) => {
        // 15 letters and the character make exactly 16, which fits as it is.
        const text = `${'x'.repeat(15)}${character}`;
        expect(clip(text, 16)).toBe(text);
      });

      it.each(Object.entries(characters))('counts %s as one place', (_name, character) => {
        // As UTF-16 these are over 16 long, but they are 16 characters to a reader.
        const text = character.repeat(16);
        expect(clip(text, 16)).toBe(text);
        expect(clip(`${text}${character}`, 16)).toBe(`${character.repeat(15)}…`);
      });

      it('never leaves half a surrogate pair or a lone combining mark', () => {
        const loneSurrogate =
          /[\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]/;
        const text = Object.values(characters).join('');
        for (let limit = 1; limit <= graphemes(text).length + 1; limit += 1) {
          const cut = clip(text, limit);
          expect(cut).not.toMatch(loneSurrogate);
          expect(graphemes(cut).length).toBeLessThanOrEqual(limit);
          if (cut !== text) expect(cut.endsWith('…')).toBe(true);
        }
      });

      it('keeps the flags of a row paired', () => {
        // Two flags are four regional indicators; a cut after the second one would split a flag.
        expect(clip(`${lead}🇩🇪🇫🇷🇪🇸`, 16)).toBe(`${lead}🇩🇪…`);
        expect(clip(`${lead}🇩🇪🇫🇷`, 16)).toBe(`${lead}🇩🇪🇫🇷`);
      });

      it('clips the joined readout the same way', () => {
        // The values are cut to 16 first and then joined and cut to 48, as Widget.qml does.
        const values = ['😀'.repeat(20), 'e\u0301'.repeat(20), 'plain text that is long'];
        const readout = clip(values.map((value) => clip(value, 16)).join('  '), 48);
        expect(readout).toBe(`${'😀'.repeat(15)}…  ${'e\u0301'.repeat(15)}…  plain text …`);
        expect(graphemes(readout)).toHaveLength(48);
      });

      it('keeps a conjunct consonant of Hindi whole', () => {
        // क्ष is three code points and one character.
        const ksha = '\u0915\u094d\u0937';
        expect(clip(`${lead}${ksha}${ksha}yy`, 16)).toBe(`${lead}${ksha}…`);
        expect(clip(`${'x'.repeat(15)}${ksha}`, 16)).toBe(`${'x'.repeat(15)}${ksha}`);
      });
    });

    // QML's engine has no Intl.Segmenter, so Clip.js carries the rules and the character tables
    // itself. They are checked against this Node's own segmenter, which node scripts/
    // grapheme-tables.cjs also uses to write them: after a Node upgrade a failure here means the
    // tables need printing again.
    describe('splits text where Intl.Segmenter does', () => {
      const segmenter = new Intl.Segmenter('en', { granularity: 'grapheme' });
      const expected = (text) => Array.from(segmenter.segment(text), (part) => part.segment);
      // Unicode 15.1 added the Indic conjunct rule. A Node with older Unicode data splits क्ष, so
      // the checks that need the rule are skipped there.
      const hasConjunctRule = expected('\u0915\u094d\u0937').length === 1;
      const eachWithConjuncts = hasConjunctRule ? it.each : it.skip.each;

      it.each([
        ['Latin text', 'Midnight City - M83'],
        ['accents', 'Cafe\u0301 ou\u0308 a\u0300 la cre\u0300me'],
        ['emoji', '😀🎵🏠 Wohnzimmer 💡'],
        ['skin tones and joined emoji', '👍🏽👩🏽‍🚀👨‍👩‍👧‍👦🏳️‍🌈🧑‍🤝‍🧑'],
        ['a pictograph that is not joined to a plain letter', 'a\u200d😀'],
        ['flags in a row', '🇩🇪🇫🇷🇪🇸🇬🇧🇺'],
        ['keycaps and variation selectors', '1️⃣#️⃣❤️✔︎'],
        ['Hangul as syllables and as jamo', '한국어 \u1112\u1161\u11ab\u1100\u1173\u11af'],
        ['Thai', 'สวัสดีครับ ก\u0e49\u0e33'],
        ['Arabic with marks', 'مَرْحَبًا \u0600\u0661\u0662'],
        ['Hebrew with points', 'שָׁלוֹם'],
        ['a virama with no consonant before it', '\u094dक a\u094dक'],
        ['Chinese and Japanese', '你好，世界 こんにちは'],
        ['control characters and line breaks', 'a\r\nb\nc\rd\u0001\u0301e\u2028f\u200bg\u00ad'],
        ['a combining mark at the start', '\u0301abc'],
        ['an empty string', ''],
      ])('for %s', (_name, text) => {
        expect(graphemes(text)).toEqual(expected(text));
        expect(graphemes(text).join('')).toBe(text);
      });

      eachWithConjuncts([
        ['Devanagari with vowel signs and conjuncts', 'नमस्ते हिंदी क्षत्रिय श्री'],
        ['conjuncts of Bengali, Gujarati, Oriya, Telugu and Malayalam', 'ক্ষ ક્ષ କ୍ଷ క్ష ക്ഷ'],
        [
          'a conjunct chain, and one broken by a joiner or a non-joiner',
          'क्त्य क्\u200dष क्\u200cष',
        ],
      ])('for %s', (_name, text) => {
        expect(graphemes(text)).toEqual(expected(text));
      });

      // Every assigned code point in the planes with text in them, next to a letter, a combining
      // mark, a pictograph and (in the Indic blocks) a consonant and its virama. A code point this
      // Node does not know yet is skipped; it would be an ordinary character to it.
      it('for every assigned code point, next to a letter, a mark, a pictograph and a consonant', () => {
        const mismatches = [];
        const check = (probe, label) => {
          if (JSON.stringify(graphemes(probe)) !== JSON.stringify(expected(probe))) {
            mismatches.push(label);
          }
        };
        const pictographRanges = (cp) =>
          (cp >= 0xa9 && cp <= 0x3299) || (cp >= 0x1f000 && cp <= 0x1ffff);
        for (let cp = 0; cp <= 0xe0fff; cp += 1) {
          if (cp >= 0xd800 && cp <= 0xdfff) continue;
          if (cp > 0x3ffff && cp < 0xe0000) continue;
          const char = String.fromCodePoint(cp);
          if (/\p{Cn}/u.test(char)) continue;
          const hex = cp.toString(16);
          check(`a${char}a`, `U+${hex} between letters`);
          check(`${char}\u0301`, `U+${hex} before a mark`);
          if (pictographRanges(cp)) check(`👨\u200d${char}`, `U+${hex} after a joiner`);
          if (hasConjunctRule && cp >= 0x900 && cp <= 0xdff) {
            check(`\u0915\u094d${char}`, `U+${hex} after a consonant and its virama`);
            check(`\u0915${char}\u0915`, `U+${hex} between consonants`);
          }
        }
        expect(mismatches).toEqual([]);
      }, 60000);

      it('for the ranges of Hangul jamo and syllables', () => {
        const jamo = [
          0x1100, 0x115f, 0x1160, 0x11a7, 0x11a8, 0x11ff, 0xa960, 0xd7b0, 0xd7cb, 0xac00,
        ];
        const syllables = [0xac00, 0xac01, 0xac1b, 0xac1c, 0xd788, 0xd7a3];
        const text = [...jamo, ...syllables]
          .flatMap((first) => [...jamo, ...syllables].map((second) => [first, second]))
          .map((pair) => String.fromCodePoint(...pair))
          .join('|');
        expect(graphemes(text)).toEqual(expected(text));
      });
    });
  });
});

describe('Omarchy bar settings in shell.json', () => {
  it('finds the widget entry and its inline settings in any section', () => {
    const shellJson = JSON.stringify({
      version: 1,
      bar: {
        layout: {
          left: ['omarchy.workspaces'],
          right: [
            { id: 'omarchy.tray' },
            {
              id: appId,
              entities: ['light.office', 'Sensor.Temp', 'not an id', 'light.office'],
              barEntities: ['sensor.temp'],
            },
          ],
        },
      },
    });
    expect(readOmarchyBarEntry(shellJson)).toEqual({
      present: true,
      entities: ['light.office', 'sensor.temp'],
      barEntities: ['sensor.temp'],
    });
    expect(readOmarchyBarEntry(JSON.stringify({ bar: { layout: { center: [appId] } } }))).toEqual({
      present: true,
      entities: null,
      barEntities: null,
    });
    expect(readOmarchyBarEntry('{ broken').present).toBe(false);
    expect(readOmarchyBarEntry('{}').present).toBe(false);
  });

  it('lists every Quick Access tile, by page, until entities are chosen', () => {
    const entry = { present: true, entities: null, barEntities: null };
    const favorites = Array.from({ length: 20 }, (_, index) => `light.l${index}`);
    // A config from before pages holds favoriteEntities alone: one untitled page, all of it.
    const legacy = resolveOmarchyBarEntities(entry, { favoriteEntities: favorites });
    expect(legacy.panel).toHaveLength(20);
    expect(legacy.sections).toEqual([{ name: '', ids: favorites }]);
    expect(legacy.bar).toEqual([]);
    // One page needs no heading; several keep their names and order, and each page keeps its own
    // tiles even when another page lists them too.
    const onePage = resolveOmarchyBarEntities(entry, {
      customTabs: [{ name: 'All', entityIds: ['light.a', 'switch.b'] }],
    });
    expect(onePage.sections).toEqual([{ name: '', ids: ['light.a', 'switch.b'] }]);
    const pages = resolveOmarchyBarEntities(entry, {
      customTabs: [
        { name: 'Living room', entityIds: ['light.a', 'switch.b'] },
        { name: 'Empty', entityIds: [] },
        { name: 'Office', entityIds: ['switch.b', 'sensor.temp', 'not an id'] },
      ],
    });
    expect(pages.sections).toEqual([
      { name: 'Living room', ids: ['light.a', 'switch.b'] },
      { name: 'Office', ids: ['switch.b', 'sensor.temp'] },
    ]);
    expect(pages.panel).toEqual(['light.a', 'switch.b', 'sensor.temp']);
    expect(pages.all).toEqual(['light.a', 'switch.b', 'sensor.temp']);
    expect(getQuickAccessPages({})).toEqual([]);
    // Entities chosen on the shell.json entry replace the pages with one list.
    const chosen = resolveOmarchyBarEntities(
      { present: true, entities: ['switch.fan'], barEntities: ['sensor.temp'] },
      { favoriteEntities: favorites }
    );
    expect(chosen).toEqual({
      panel: ['switch.fan'],
      bar: ['sensor.temp'],
      sections: [{ name: '', ids: ['switch.fan'] }],
      all: ['sensor.temp', 'switch.fan'],
    });
  });

  it('keeps a duplicated page in the panel and skips its comparison graphs', () => {
    const entry = { present: true, entities: null, barEntities: null };
    const resolved = resolveOmarchyBarEntities(entry, {
      customTabs: [
        { name: 'Home', entityIds: ['light.a', 'graph:temps', 'switch.b'] },
        { name: 'Home copy', entityIds: ['light.a', 'graph:temps-copy', 'switch.b'] },
      ],
    });
    // The copy still gets its section; the tiles are listed once for the status and subscriptions.
    expect(resolved.sections).toEqual([
      { name: 'Home', ids: ['light.a', 'switch.b'] },
      { name: 'Home copy', ids: ['light.a', 'switch.b'] },
    ]);
    expect(resolved.panel).toEqual(['light.a', 'switch.b']);
    expect(resolved.all).toEqual(['light.a', 'switch.b']);
    const tiles = new Map(resolved.panel.map((id) => [id, { ...lightTile, id }]));
    const status = buildOmarchyBarStatus({ tiles, entities: resolved });
    expect(status.panel.map((tile) => tile.id)).toEqual(['light.a', 'switch.b']);
    expect(status.sections.map((section) => section.ids)).toEqual([
      ['light.a', 'switch.b'],
      ['light.a', 'switch.b'],
    ]);
  });

  it('limits the panel by distinct entities, not by repeated ones', () => {
    const ids = Array.from({ length: 48 }, (_, index) => `sensor.s${index}`);
    const resolved = resolveOmarchyBarEntities(
      { present: true, entities: null, barEntities: null },
      {
        customTabs: [
          { name: 'A', entityIds: ids },
          { name: 'B', entityIds: ['sensor.extra', ...ids.slice(0, 2)] },
        ],
      }
    );
    expect(resolved.panel).toEqual(ids);
    expect(resolved.sections[1]).toEqual({ name: 'B', ids: ids.slice(0, 2) });
  });
});

describe('Omarchy bar status', () => {
  it('bounds countdown metadata and passes it to the bar and panel', () => {
    const endsAt = Date.parse('2026-09-30T12:00:00Z');
    const raw = {
      ...lightTile,
      countdown: { endsAt, finishedValue: '  Finished\n', extra: 'dropped' },
    };
    const tile = cleanOmarchyBarTile('sensor.kitchen_timer', raw);
    expect(tile.countdown).toEqual({ endsAt, finishedValue: 'Finished' });
    const status = buildOmarchyBarStatus({
      tiles: new Map([[tile.id, tile]]),
      entities: { panel: [tile.id], bar: [tile.id] },
    });
    expect(status.panel[0].countdown).toEqual(tile.countdown);
    expect(status.bar[0].countdown).toEqual(tile.countdown);
    for (const invalid of [NaN, Infinity, -1, 0, '123', null]) {
      expect(
        cleanOmarchyBarTile(tile.id, { ...raw, countdown: { endsAt: invalid } }).countdown
      ).toBeUndefined();
    }
    expect(cleanOmarchyBarTile(tile.id, { ...raw, available: false }).countdown).toBeUndefined();
    expect(
      cleanOmarchyBarTile(tile.id, { ...raw, countdown: { endsAt } }).countdown.finishedValue
    ).toBe('0:00');
  });

  it('keeps only the tile fields the plugin reads', () => {
    expect(cleanOmarchyBarTile('light.desk', { ...lightTile, extra: 'dropped' })).toEqual({
      id: 'light.desk',
      ...lightTile,
      controlState: null,
    });
    const withControls = cleanOmarchyBarTile('light.desk', {
      ...lightTile,
      controlState: {
        kind: 'light',
        on: true,
        brightness: 250,
        canSetBrightness: true,
        colorTemp: { kelvin: 4000, min: 2200, max: 6500 },
        colors: ['#FFB347', 'red', '#12345'],
        script: 'dropped',
      },
    });
    expect(withControls.controlState).toEqual({
      kind: 'light',
      on: true,
      brightness: 100,
      canSetBrightness: true,
      colorTemp: { kelvin: 4000, min: 2200, max: 6500 },
      colors: ['#FFB347'],
    });
    expect(
      cleanOmarchyBarTile('light.desk', { ...lightTile, controlState: { kind: 'oven' } })
        .controlState
    ).toBeNull();
    const odd = cleanOmarchyBarTile('scene.movie', {
      name: `  Movie\n${'x'.repeat(200)}`,
      icon: { kind: 'mdi', glyph: '\u{F0510}' },
      action: 'explode',
      active: 'yes',
    });
    expect(odd.name).toHaveLength(80);
    expect(odd.name.startsWith('Movie x')).toBe(true);
    expect(odd.icon).toEqual({ kind: 'glyph', glyph: '\u{F0510}' });
    expect(odd.action).toBe('none');
    expect(odd.active).toBe(false);
    expect(
      cleanOmarchyBarTile('sensor.x', { icon: { kind: 'line', name: '../../x' } }).icon
    ).toEqual({ kind: 'line', name: 'box' });
    expect(cleanOmarchyBarTile('sensor.x', null)).toBeNull();
  });

  it('accepts only plain line-icon SVGs', () => {
    const svg =
      '<svg viewBox="0 0 24 24" width="24" height="24" stroke="currentColor"><path d="M9 18h6"></path></svg>';
    expect(cleanLineIconSvg(svg)).toBe(svg);
    expect(cleanLineIconSvg(`<svg><script>alert(1)</script></svg>`)).toBe('');
    expect(cleanLineIconSvg('<svg onload="x()"></svg>')).toBe('');
    expect(cleanLineIconSvg('<svg><image href="file:///etc/passwd"/></svg>')).toBe('');
    expect(cleanLineIconSvg('<div></div>')).toBe('');
    expect(cleanLineIconSvg(`<svg>${'x'.repeat(5000)}</svg>`)).toBe('');
  });

  it('builds the file the plugin reads', () => {
    const tile = cleanOmarchyBarTile('light.desk', lightTile);
    const status = buildOmarchyBarStatus({
      connection: 'connected',
      tiles: new Map([['light.desk', tile]]),
      icons: new Map([
        ['lightbulb', '<svg>bulb</svg>'],
        ['plug', '<svg>unused</svg>'],
      ]),
      entities: {
        panel: ['light.desk', 'switch.later'],
        bar: [],
        sections: [{ name: '', ids: ['light.desk', 'switch.later'] }],
      },
      launch: ['/opt/ha-desktop-widget/home-assistant-widget'],
      now: 42,
    });
    expect(status).toMatchObject({
      version: 1,
      updatedAt: 42,
      connection: 'connected',
      launch: ['/opt/ha-desktop-widget/home-assistant-widget'],
      bar: [],
      sections: [{ name: '', ids: ['light.desk', 'switch.later'] }],
      // Only the icons the tiles use.
      icons: { lightbulb: '<svg>bulb</svg>' },
    });
    // Plugin 1.0.x reads value, active, available and toggleable from the same entries.
    expect(status.panel[0]).toMatchObject({
      id: 'light.desk',
      value: '85%',
      active: true,
      toggleable: true,
      action: 'toggle',
    });
    // A tile the renderer has not described yet reads as inert.
    expect(status.panel[1]).toMatchObject({
      id: 'switch.later',
      action: 'none',
      toggleable: false,
    });
    expect(buildOmarchyBarStatus({ launch: [] }).launch).toBeNull();
    expect(buildOmarchyBarStatus({}).issue).toBe('');
    expect(buildOmarchyBarStatus({ connection: 'auth-failed', issue: 'keyring' }).issue).toBe(
      'keyring'
    );
  });

  it('writes the status privately, refreshes it, and removes it on stop', () => {
    jest.useFakeTimers();
    try {
      const statusFile = path.join(root, 'run', 'ha-desktop-widget', 'omarchy-bar.json');
      let connection = 'connecting';
      const publisher = createOmarchyBarPublisher({
        statusFile,
        getStatus: () => ({ connection }),
        heartbeatMs: 60000,
      });
      expect(JSON.parse(fs.readFileSync(statusFile, 'utf8'))).toEqual({ connection: 'connecting' });
      if (process.platform !== 'win32') {
        expect(fs.statSync(statusFile).mode & 0o777).toBe(0o600);
      }
      connection = 'connected';
      publisher.update();
      publisher.update();
      jest.advanceTimersByTime(300);
      expect(JSON.parse(fs.readFileSync(statusFile, 'utf8'))).toEqual({ connection: 'connected' });
      publisher.stop();
      expect(fs.existsSync(statusFile)).toBe(false);
      expect(createOmarchyBarPublisher({ statusFile: '', getStatus: () => ({}) })).toBeNull();
    } finally {
      jest.useRealTimers();
    }
  });
});

describe('Omarchy shell countdowns', () => {
  const countdown = vm.runInNewContext(
    fs.readFileSync(path.join(pluginDir, 'Countdown.js'), 'utf8') + '\n({ value, isRunning })'
  );
  const now = Date.parse('2026-09-30T12:00:00Z');
  const tile = {
    available: true,
    value: 'stale snapshot',
    countdown: { endsAt: now + 90000, finishedValue: 'Finished' },
  };

  it('ticks between state updates and catches up after sleep', () => {
    expect(countdown.value(tile, now)).toBe('1:30');
    expect(countdown.value(tile, now + 1000)).toBe('1:29');
    expect(countdown.value(tile, now + 65000)).toBe('0:25');
    expect(countdown.isRunning(tile, now + 65000)).toBe(true);
    expect(countdown.value(tile, now + 90000)).toBe('Finished');
    expect(countdown.value(tile, now + 180000)).toBe('Finished');
    expect(countdown.isRunning(tile, now + 90000)).toBe(false);
  });

  it('formats hours and clamps completed native timers to zero', () => {
    const native = { ...tile, countdown: { endsAt: now + 3661000, finishedValue: '0:00' } };
    expect(countdown.value(native, now)).toBe('1:01:01');
    expect(countdown.value(native, now + 2000)).toBe('1:00:59');
    expect(countdown.value(native, now + 7200000)).toBe('0:00');
  });

  it('preserves static, paused, unavailable and older widget values', () => {
    for (const staticTile of [
      { value: '85%' },
      { ...tile, countdown: undefined, value: 'Paused' },
      { ...tile, available: false, value: 'Unavailable' },
      { ...tile, countdown: { endsAt: 'invalid' } },
    ]) {
      expect(countdown.value(staticTile, now + 180000)).toBe(staticTile.value);
      expect(countdown.isRunning(staticTile, now)).toBe(false);
    }
    expect(countdown.value(null, now)).toBe('');
  });
});

describe('bar requests and installation', () => {
  it('reads tile requests and allows only what the shown tile can do', () => {
    expect(getOmarchyBarActionRequest(['widget', '--entity-action=Light.Desk'])).toEqual({
      entityId: 'light.desk',
      kind: 'primary',
    });
    expect(getOmarchyBarActionRequest(['widget', '--entity-controls', 'fan.bedroom'])).toEqual({
      entityId: 'fan.bedroom',
      kind: 'controls',
    });
    // What plugin 1.0.x runs.
    expect(getOmarchyBarActionRequest(['widget', '--entity-toggle=switch.fan'])).toEqual({
      entityId: 'switch.fan',
      kind: 'primary',
    });
    expect(getOmarchyBarActionRequest(['widget', '--entity-action=rm -rf'])).toBeNull();
    expect(getOmarchyBarActionRequest(['widget', '--toggle'])).toBeNull();

    const entities = { all: ['light.desk', 'sensor.status'] };
    const light = { action: 'toggle', controls: true };
    const status = { action: 'none', controls: false };
    const primary = (entityId) => ({ entityId, kind: 'primary' });
    const controls = (entityId) => ({ entityId, kind: 'controls' });
    expect(isAllowedOmarchyBarAction(primary('light.desk'), entities, light)).toBe(true);
    expect(isAllowedOmarchyBarAction(controls('light.desk'), entities, light)).toBe(true);
    // A tile whose click does nothing, one without controls, one the bar does not show, or one
    // the renderer has not described.
    expect(isAllowedOmarchyBarAction(primary('sensor.status'), entities, status)).toBe(false);
    expect(isAllowedOmarchyBarAction(controls('sensor.status'), entities, status)).toBe(false);
    expect(isAllowedOmarchyBarAction(primary('light.kitchen'), entities, light)).toBe(false);
    expect(isAllowedOmarchyBarAction(primary('light.desk'), entities, undefined)).toBe(false);
    expect(isAllowedOmarchyBarAction({ entityId: 'light.desk', kind: 'x' }, entities, light)).toBe(
      false
    );
  });

  it('allows controls-popup commands only within what the tile offers', () => {
    const entities = { all: ['light.desk', 'climate.hall', 'media_player.den'] };
    const set = (entityId, command, value) => ({ entityId, kind: 'set', command, value });
    const light = cleanOmarchyBarTile('light.desk', {
      ...lightTile,
      controlState: {
        kind: 'light',
        on: true,
        brightness: 40,
        canSetBrightness: true,
        colorTemp: { kelvin: 4000, min: 2200, max: 6500 },
        colors: ['#FFB347'],
      },
    });
    expect(isAllowedOmarchyBarAction(set('light.desk', 'brightness', 55), entities, light)).toBe(
      true
    );
    expect(isAllowedOmarchyBarAction(set('light.desk', 'brightness', 101), entities, light)).toBe(
      false
    );
    expect(isAllowedOmarchyBarAction(set('light.desk', 'color_temp', 1000), entities, light)).toBe(
      false
    );
    expect(isAllowedOmarchyBarAction(set('light.desk', 'color', '#00ff00'), entities, light)).toBe(
      true
    );
    expect(isAllowedOmarchyBarAction(set('light.desk', 'power', 'yes'), entities, light)).toBe(
      false
    );
    expect(isAllowedOmarchyBarAction(set('light.desk', 'position', 5), entities, light)).toBe(
      false
    );
    const climate = cleanOmarchyBarTile('climate.hall', {
      ...lightTile,
      controlState: {
        kind: 'climate',
        mode: 'heat',
        target: 21,
        min: 7,
        max: 30,
        step: 0.5,
        canSetTemperature: true,
        modes: ['off', 'heat'],
      },
    });
    expect(
      isAllowedOmarchyBarAction(set('climate.hall', 'temperature', 22.5), entities, climate)
    ).toBe(true);
    expect(
      isAllowedOmarchyBarAction(set('climate.hall', 'temperature', 45), entities, climate)
    ).toBe(false);
    expect(isAllowedOmarchyBarAction(set('climate.hall', 'mode', 'cool'), entities, climate)).toBe(
      false
    );
    const media = cleanOmarchyBarTile('media_player.den', {
      ...lightTile,
      controlState: { kind: 'media', canNext: false, canSetVolume: true, canPlay: true },
    });
    expect(isAllowedOmarchyBarAction(set('media_player.den', 'volume', 30), entities, media)).toBe(
      true
    );
    expect(isAllowedOmarchyBarAction(set('media_player.den', 'next', null), entities, media)).toBe(
      false
    );
    // A tile without controls takes no commands at all.
    expect(
      isAllowedOmarchyBarAction(set('light.desk', 'brightness', 50), entities, {
        ...light,
        controls: false,
      })
    ).toBe(false);
  });

  it('reads socket request lines', () => {
    expect(parseOmarchyBarSocketLine('{"id":"Light.Desk","kind":"primary"}')).toEqual({
      entityId: 'light.desk',
      kind: 'primary',
    });
    expect(
      parseOmarchyBarSocketLine(
        '{"id":"light.desk","kind":"set","command":"brightness","value":40}'
      )
    ).toEqual({ entityId: 'light.desk', kind: 'set', command: 'brightness', value: 40 });
    expect(parseOmarchyBarSocketLine('{"id":"light.desk","kind":"set","command":"stop"}')).toEqual({
      entityId: 'light.desk',
      kind: 'set',
      command: 'stop',
      value: null,
    });
    [
      'not json',
      '{"id":"rm -rf","kind":"primary"}',
      '{"id":"light.desk","kind":"delete"}',
      '{"id":"light.desk","kind":"set","command":"Bad Command"}',
      '{"id":"light.desk","kind":"set","command":"brightness","value":{"x":1}}',
      `{"id":"light.desk","kind":"primary","pad":"${'x'.repeat(600)}"}`,
    ].forEach((line) => expect(parseOmarchyBarSocketLine(line)).toBeNull());
  });

  (process.platform === 'win32' ? it.skip : it)(
    'listens on a private socket and passes each request line on',
    async () => {
      const socketPath = path.join(root, 'run', 'ha-desktop-widget', 'omarchy-bar.sock');
      const received = [];
      const server = createOmarchyBarCommandServer({
        socketPath,
        onRequest: (request) => received.push(request),
        log: { warn: jest.fn() },
      });
      await new Promise((resolve) => {
        const wait = () => (fs.existsSync(socketPath) ? resolve() : setTimeout(wait, 10));
        wait();
      });
      await new Promise((resolve) => setTimeout(resolve, 20));
      expect(fs.statSync(socketPath).mode & 0o777).toBe(0o600);
      expect(fs.statSync(path.dirname(socketPath)).mode & 0o777).toBe(0o700);
      const client = require('net').createConnection(socketPath);
      await new Promise((resolve) => client.on('connect', resolve));
      // Split across writes, with a junk line between two real ones.
      client.write('{"id":"light.desk","ki');
      client.write('nd":"primary"}\nnot json\n{"id":"light.desk","kind":"controls"}\n');
      await new Promise((resolve) => setTimeout(resolve, 50));
      expect(received).toEqual([
        { entityId: 'light.desk', kind: 'primary' },
        { entityId: 'light.desk', kind: 'controls' },
      ]);
      client.destroy();
      server.stop();
      expect(fs.existsSync(socketPath)).toBe(false);
      expect(createOmarchyBarCommandServer({ socketPath: '', onRequest: () => {} })).toBeNull();
    }
  );

  it('finds Omarchy 4 and the paths it uses', () => {
    expect(
      isOmarchyShellInstalled({
        env: { OMARCHY_PATH: '/opt/omarchy' },
        exists: (file) => file === path.join('/opt/omarchy', 'shell', 'shell.qml'),
      })
    ).toBe(true);
    expect(isOmarchyShellInstalled({ env: {}, exists: () => false })).toBe(false);
    expect(
      getOmarchyBarPaths({ env: { XDG_RUNTIME_DIR: '/run/user/1000' }, home: '/home/me' })
    ).toEqual({
      shellConfig: path.join('/home/me', '.config', 'omarchy', 'shell.json'),
      pluginDir: path.join('/home/me', '.config', 'omarchy', 'plugins', appId),
      statusFile: path.join('/run/user/1000', 'ha-desktop-widget', 'omarchy-bar.json'),
      socket: path.join('/run/user/1000', 'ha-desktop-widget', 'omarchy-bar.sock'),
      launchFile: path.join(
        '/home/me',
        '.local',
        'state',
        'ha-desktop-widget',
        'omarchy-bar-launch.json'
      ),
    });
    expect(getOmarchyBarPaths({ env: {}, home: '/home/me' }).statusFile).toBe('');
    expect(getOmarchyBarPaths({ env: {}, home: '/home/me' }).socket).toBe('');
  });

  it('copies the bundled plugin into the Omarchy plugins directory', () => {
    const target = path.join(root, 'plugins', appId);
    installOmarchyBarPluginFiles({ sourceDir: pluginDir, pluginDir: target });
    expect(fs.readdirSync(target).sort()).toEqual([...PLUGIN_FILES].sort());
  });

  it('updates an installed copy only when the bundled version differs', () => {
    const target = path.join(root, 'plugins', appId);
    expect(updateInstalledOmarchyBarPlugin({ sourceDir: pluginDir, pluginDir: target })).toBe(
      false
    );
    installOmarchyBarPluginFiles({ sourceDir: pluginDir, pluginDir: target });
    expect(updateInstalledOmarchyBarPlugin({ sourceDir: pluginDir, pluginDir: target })).toBe(
      false
    );
    const manifestPath = path.join(target, 'manifest.json');
    const old = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    fs.writeFileSync(manifestPath, JSON.stringify({ ...old, version: '0.0.1' }));
    fs.writeFileSync(path.join(target, 'Widget.qml'), 'old');
    expect(updateInstalledOmarchyBarPlugin({ sourceDir: pluginDir, pluginDir: target })).toBe(true);
    expect(fs.readFileSync(path.join(target, 'Widget.qml'), 'utf8')).toBe(
      fs.readFileSync(path.join(pluginDir, 'Widget.qml'), 'utf8')
    );
    // Another plugin in that directory is never overwritten.
    fs.writeFileSync(manifestPath, JSON.stringify({ id: 'someone.else', version: '9' }));
    expect(updateInstalledOmarchyBarPlugin({ sourceDir: pluginDir, pluginDir: target })).toBe(
      false
    );
  });

  it('keeps the launch command after the widget quits, rewriting it only when it changes', () => {
    const launchFile = path.join(root, 'state', 'ha-desktop-widget', 'omarchy-bar-launch.json');
    const launch = ['/home/me/Apps/HA-Desktop-Widget.AppImage'];
    expect(rememberOmarchyBarLaunch({ launchFile, launch })).toBe(true);
    expect(JSON.parse(fs.readFileSync(launchFile, 'utf8'))).toEqual({ version: 1, launch });
    if (process.platform !== 'win32') {
      expect(fs.statSync(launchFile).mode & 0o777).toBe(0o600);
    }
    expect(rememberOmarchyBarLaunch({ launchFile, launch })).toBe(false);
    // A development run has no launch command and leaves the saved one alone.
    expect(rememberOmarchyBarLaunch({ launchFile, launch: null })).toBe(false);
    expect(JSON.parse(fs.readFileSync(launchFile, 'utf8')).launch).toEqual(launch);
  });

  it('writes the manifest only after the plugin files, so a failed upgrade is retried', () => {
    const target = path.join(root, 'plugins', appId);
    installOmarchyBarPluginFiles({ sourceDir: pluginDir, pluginDir: target });
    const manifestPath = path.join(target, 'manifest.json');
    const old = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    fs.writeFileSync(manifestPath, JSON.stringify({ ...old, version: '0.0.1' }));
    const failingFs = {
      ...fs,
      copyFileSync: (from, to) => {
        if (from.endsWith('Widget.qml')) throw new Error('disk full');
        return fs.copyFileSync(from, to);
      },
    };
    expect(() =>
      updateInstalledOmarchyBarPlugin({
        sourceDir: pluginDir,
        pluginDir: target,
        fsImpl: failingFs,
      })
    ).toThrow('disk full');
    // The old version still stands, and no temporary copy is left behind.
    expect(JSON.parse(fs.readFileSync(manifestPath, 'utf8')).version).toBe('0.0.1');
    expect(fs.readdirSync(target).filter((file) => file.startsWith('.'))).toEqual([]);
    expect(updateInstalledOmarchyBarPlugin({ sourceDir: pluginDir, pluginDir: target })).toBe(true);
  });
});

describe('Omarchy bar secondary text', () => {
  // The colour helpers are plain JavaScript inside the QML; run them against Qt's rgba().
  const qml = fs.readFileSync(path.join(pluginDir, 'Widget.qml'), 'utf8');
  const start = qml.indexOf('function colorChannel');
  const end = qml.indexOf('// Keyboard cursor');
  const rgba = (r, g, b, a = 1) => ({ r, g, b, a });
  const { quietTone, contrastRatio } = new vm.Script(
    `(function () { ${qml.slice(start, end)}; return { quietTone, contrastRatio }; })()`
  ).runInNewContext({ Qt: { rgba }, Math });
  const color = (hex) => {
    const [r, g, b] = [1, 3, 5].map((index) => parseInt(hex.slice(index, index + 2), 16) / 255);
    return rgba(r, g, b);
  };

  // Foreground and background of bundled Omarchy themes, the dark ones that fell under 4.5:1 and
  // the light ones whose dim text came out darker than their primary text.
  const themes = {
    'tokyo-night': ['#a9b1d6', '#1a1b26'],
    everforest: ['#d3c6aa', '#2d353b'],
    gruvbox: ['#d4be98', '#282828'],
    nord: ['#d8dee9', '#2e3440'],
    miasma: ['#c2c2b0', '#222222'],
    'catppuccin-latte': ['#4c4f69', '#eff1f5'],
    'rose-pine-dawn': ['#575279', '#faf4ed'],
    lupine: ['#212121', '#fafafa'],
    white: ['#000000', '#ffffff'],
    vantablack: ['#ffffff', '#000000'],
  };

  it('uses the shipped blend, not Qt.darker, for the dim tone', () => {
    expect(qml).toContain('readonly property color dimColor: quietTone(foreground');
    expect(qml).not.toContain('Qt.darker(foreground');
  });

  it.each(Object.entries(themes))(
    'reads at 4.5:1 and stays below the foreground (%s)',
    (_, [fg, bg]) => {
      const tone = quietTone(color(fg), color(bg));
      expect(contrastRatio(tone, color(bg))).toBeGreaterThanOrEqual(4.5);
      // Never stronger than the primary text, whichever way the theme runs.
      expect(contrastRatio(tone, color(bg))).toBeLessThanOrEqual(
        contrastRatio(color(fg), color(bg)) + 0.01
      );
    }
  );

  it('returns a foreground that cannot reach 4.5:1 unchanged', () => {
    const fg = color('#8a8a8a');
    const bg = color('#999999');
    expect(quietTone(fg, bg)).toEqual(fg);
  });

  it('dims an unavailable tile by its icon and name instead of fading its text', () => {
    expect(qml).not.toContain('opacity: tileRoot.available ? 1 : 0.55');
    expect(qml).toContain('iconOpacity: tileRoot.active ? 1 : (tileRoot.available ? 0.72 : 0.45)');
  });
});

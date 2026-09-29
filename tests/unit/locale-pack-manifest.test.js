const nodeCrypto = require('crypto');
const fs = require('fs');
const path = require('path');

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
});

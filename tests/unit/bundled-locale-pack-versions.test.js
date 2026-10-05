const fs = require('fs');
const path = require('path');
const { readBundledLocalePackVersions } = require('../../scripts/bundled-locale-pack-versions.cjs');

describe('the pack version of each built-in language', () => {
  const root = path.resolve(__dirname, '../..');

  it('names every language the app carries besides English, at its pack version', () => {
    const builtIn = fs
      .readdirSync(path.join(root, 'locales'))
      .filter((file) => file.endsWith('.json') && file !== 'en.json')
      .map((file) => path.basename(file, '.json'));
    const versions = readBundledLocalePackVersions(root);
    expect(Object.keys(versions).sort()).toEqual(builtIn.sort());
    for (const locale of builtIn) {
      const pack = JSON.parse(fs.readFileSync(path.join(root, 'locale-packs', `${locale}.json`)));
      expect(versions[locale]).toBe(pack.version);
    }
    expect(versions.de).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it('is written into both renderer builds', () => {
    for (const config of ['vite.config.js', 'vite.panel.config.js']) {
      expect(fs.readFileSync(path.join(root, config), 'utf8')).toMatch(
        /__BUNDLED_LOCALE_PACK_VERSIONS__: JSON\.stringify\(readBundledLocalePackVersions\(\)\)/
      );
    }
  });
});

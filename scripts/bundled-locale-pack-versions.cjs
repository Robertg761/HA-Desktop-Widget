const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');

/**
 * The language pack version of each language the app carries built in (every locales/<code>.json
 * but English), for the renderer as __BUNDLED_LOCALE_PACK_VERSIONS__. The bundled catalog and the
 * downloadable pack hold the same strings in the commit a build comes from
 * (tests/unit/locale-copy-rules.test.js), so the pack's version there is the bundled copy's. Settings
 * offers the pack as an update only once the downloadable one is newer than that.
 * @returns {Record<string, string>} e.g. { de: '1.2.64' }
 */
function readBundledLocalePackVersions(root = ROOT) {
  return Object.fromEntries(
    fs
      .readdirSync(path.join(root, 'locales'))
      .filter((file) => file.endsWith('.json') && file !== 'en.json')
      .map((file) => {
        const locale = path.basename(file, '.json');
        const pack = JSON.parse(
          fs.readFileSync(path.join(root, 'locale-packs', `${locale}.json`), 'utf8')
        );
        return [locale, pack.version];
      })
  );
}

module.exports = { readBundledLocalePackVersions };

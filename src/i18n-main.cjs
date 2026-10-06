const fs = require('fs');
const path = require('path');
const nodeCrypto = require('crypto');
const { fileURLToPath, pathToFileURL } = require('url');
const { fetchChecked } = require('./net-fetch.cjs');
const { isRtlLocale } = require('../packages/widget-renderer/src/rtl-locales.cjs');

function normalizeLocaleCode(locale) {
  if (!locale || typeof locale !== 'string') return '';
  const normalized = locale.trim().replace(/_/g, '-');
  if (!normalized) return '';
  if (!/^[A-Za-z]{2,8}(?:-[A-Za-z0-9]{1,8})*$/.test(normalized)) return '';
  const [language, ...rest] = normalized.split('-').filter(Boolean);
  if (!language) return '';
  const normalizedParts = [language.toLowerCase()];
  rest.forEach((part) => {
    if (part.length === 2) {
      normalizedParts.push(part.toUpperCase());
    } else {
      normalizedParts.push(part.toLowerCase());
    }
  });
  return normalizedParts.join('-');
}

function getBaseLocale(locale) {
  const normalized = normalizeLocaleCode(locale);
  if (!normalized) return '';
  return normalized.split('-')[0];
}

// The languages the app can show: English and German are bundled, and the rest are packs it
// downloads (locale-packs/manifest.json). A test keeps this list in step with both, and with the
// Chromium locales electron-builder.yml ships, so a new language has to be added in all three.
const APP_LANGUAGES = Object.freeze(['en', 'de', 'es', 'fr', 'ar', 'hi', 'zh']);

// What an operating system reports when it has no language set (LANG=C), which names no language.
const PLACEHOLDER_LANGUAGES = new Set(['c', 'posix', 'und']);

// Locale codes in the order given, without repeats, junk or placeholders. Linux lists each language
// twice and reports "posix" for the C locale; macOS and Windows add a script ("zh-Hans-CN").
function toLocaleList(value) {
  const seen = new Set();
  for (const item of Array.isArray(value) ? value : [value]) {
    const code = normalizeLocaleCode(item);
    if (code && !PLACEHOLDER_LANGUAGES.has(getBaseLocale(code))) seen.add(code);
  }
  return [...seen];
}

/**
 * The language to run in when the setting is Auto, taken from what the operating system asks for.
 *
 * Electron's app.getLocale() is not that: it is the locale Chromium settled on after matching the
 * system's languages against the .pak files that ship in the package's locales folder. Mexican
 * Spanish comes back as "es-419" only while that pak ships, and a language with no pak at all comes
 * back as "en-US". Trim the folder and the answer changes with it. Asking the operating system
 * directly gives the same answer however many paks ship.
 *
 * In order, the first of these that names any language decides:
 *   1. app.getPreferredSystemLanguages(), the user's ordered list. The first entry in a language
 *      the app has wins, so a Japanese-then-German list gets German, as it would anywhere else.
 *      English further down does not count: the app falls back to English anyway, and picking it
 *      would cost the user their own date and number formats (a Brazilian list of pt-BR then
 *      en-US would format like the US) and name English as the language found. So when no entry
 *      but English is one the app has, the first entry stands (Japanese), and the app shows
 *      English and says which language it found.
 *   2. app.getSystemLocale(), which is the region setting and is read only when the list is empty.
 *   3. app.getLocale(), Chromium's pick, for a platform where neither of the others answers.
 * The code is returned as the system wrote it ("es-MX"), because the localization service picks
 * the catalog from it the same way as before: the full code, then its language, then English.
 *
 * @param {object} app Electron's app, or anything with the same three methods.
 * @param {{ isSupported?: (locale: string) => boolean }} [options] Whether the app can show a
 *   language, which defaults to being one of APP_LANGUAGES.
 * @returns {string} A locale code, "en" when the system names none.
 */
function detectSystemLocale(app, options = {}) {
  const { isSupported = (locale) => APP_LANGUAGES.includes(getBaseLocale(locale)) } = options;
  const sources = [
    () => app.getPreferredSystemLanguages(),
    () => app.getSystemLocale(),
    () => app.getLocale(),
  ];
  for (const read of sources) {
    let candidates = [];
    try {
      candidates = toLocaleList(read());
    } catch {
      // Not offered on this platform, or called before the app is ready: try the next source.
    }
    if (!candidates.length) continue;
    try {
      return (
        candidates.find(
          (candidate, index) =>
            (index === 0 || getBaseLocale(candidate) !== 'en') && isSupported(candidate)
        ) || candidates[0]
      );
    } catch {
      return candidates[0];
    }
  }
  return 'en';
}

function formatTemplate(template, vars = {}) {
  if (typeof template !== 'string') return '';
  return template.replace(/\{\{\s*([\w.]+)\s*\}\}/g, (_match, key) => {
    const value = Object.prototype.hasOwnProperty.call(vars, key) ? vars[key] : '';
    return value == null ? '' : String(value);
  });
}

// The error and the warning a message quotes are text the app did not write: an OS error such as
// "EACCES: permission denied, open '…/config.json'", or the reason a helper gave. Under a
// right-to-left language each keeps its own direction, as isolateAuto does in the renderer;
// otherwise an English error takes the Arabic sentence's direction, and the quote or full stop it
// ends with moves to the far end of the line. First strong rather than left to right, since the
// quoted text can be translated already.
const QUOTED_TEXT_VARS = ['error', 'warning'];

function isolateQuotedText(vars) {
  const isolated = { ...vars };
  QUOTED_TEXT_VARS.forEach((name) => {
    const value = vars[name] == null ? '' : String(vars[name]);
    if (value) isolated[name] = `\u2068${value}\u2069`;
  });
  return isolated;
}

function compareVersions(a = '', b = '') {
  const toParts = (value) =>
    String(value || '')
      .split('.')
      .map((part) => Number.parseInt(part, 10))
      .map((part) => (Number.isNaN(part) ? 0 : part));
  const aParts = toParts(a);
  const bParts = toParts(b);
  const length = Math.max(aParts.length, bParts.length);
  for (let index = 0; index < length; index += 1) {
    const diff = (aParts[index] || 0) - (bParts[index] || 0);
    if (diff !== 0) return diff;
  }
  return 0;
}

function ensureObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function hashContent(content) {
  return nodeCrypto.createHash('sha256').update(content).digest('hex');
}

function isFileSource(source) {
  return typeof source === 'string' && source.startsWith('file://');
}

function getFileSourcePath(source) {
  if (!isFileSource(source)) return '';
  return fileURLToPath(source);
}

function createLocalizationService(options = {}) {
  const {
    bundledDir,
    getUserDataDir,
    appVersion = '0.0.0',
    getDetectedLocale = () => 'en',
    // The operating system's region setting. It only shapes how numbers and dates are written;
    // the display language above still picks the catalog.
    getSystemLocale = () => '',
    manifestUrl = '',
    // Injectable for tests; main.js supplies Electron's net.fetch.
    fetchImpl = (url, init) => fetch(url, init),
  } = options;

  const bundledCache = new Map();
  // Installed packs parsed once per file version. The tray menu asks for a dozen strings in a row,
  // and every one used to read and parse each installed pack (~170 KB) again.
  const installedPackCache = new Map();
  const manifestCache = {
    fetchedAt: 0,
    packs: null,
  };
  let refreshInFlight = null;

  function getInstalledLocaleDir() {
    return path.join(getUserDataDir(), 'locales');
  }

  function readJsonFile(filePath) {
    const raw = fs.readFileSync(filePath, 'utf8');
    return JSON.parse(raw);
  }

  async function readJsonSource(source) {
    if (isFileSource(source)) {
      return readJsonFile(getFileSourcePath(source));
    }
    const response = await fetchChecked(fetchImpl, source, { timeoutMs: 15000 });
    return response.json();
  }

  async function readTextSource(source) {
    if (isFileSource(source)) {
      return fs.readFileSync(getFileSourcePath(source), 'utf8');
    }
    const response = await fetchChecked(fetchImpl, source, { timeoutMs: 20000 });
    return response.text();
  }

  function getBundledMessages(locale) {
    const normalized = normalizeLocaleCode(locale) || 'en';
    if (bundledCache.has(normalized)) {
      return bundledCache.get(normalized);
    }
    const localePath = path.join(bundledDir, `${normalized}.json`);
    if (!fs.existsSync(localePath)) {
      bundledCache.set(normalized, null);
      return null;
    }
    const json = readJsonFile(localePath);
    const messages = ensureObject(json);
    bundledCache.set(normalized, messages);
    return messages;
  }

  function getEnglishMessages() {
    return getBundledMessages('en') || {};
  }

  function getInstalledPackPath(locale) {
    return path.join(getInstalledLocaleDir(), `${normalizeLocaleCode(locale)}.json`);
  }

  function quarantineInstalledPack(packPath) {
    const quarantinePath = `${packPath}.corrupt-${Date.now()}`;
    try {
      fs.renameSync(packPath, quarantinePath);
      return quarantinePath;
    } catch {
      return '';
    }
  }

  /**
   * The parsed pack file with its stats. Parsed again only when the file changed on disk, so a
   * hand edit or another instance's download is still picked up.
   */
  function readPackFileCached(packPath) {
    const stats = fs.statSync(packPath);
    const cached = installedPackCache.get(packPath);
    if (cached && cached.mtimeMs === stats.mtimeMs && cached.size === stats.size) {
      return { pack: cached.pack, stats };
    }
    const pack = readJsonFile(packPath);
    installedPackCache.set(packPath, { mtimeMs: stats.mtimeMs, size: stats.size, pack });
    return { pack, stats };
  }

  function readInstalledPack(locale) {
    const normalized = normalizeLocaleCode(locale);
    if (!normalized || normalized === 'en') return null;
    const packPath = getInstalledPackPath(normalized);
    if (!fs.existsSync(packPath)) return null;
    try {
      const { pack } = readPackFileCached(packPath);
      if (
        !pack ||
        typeof pack !== 'object' ||
        Array.isArray(pack) ||
        normalizeLocaleCode(pack.locale) !== normalized ||
        !pack.messages ||
        typeof pack.messages !== 'object' ||
        Array.isArray(pack.messages)
      ) {
        throw new Error(`Invalid locale pack: ${normalized}`);
      }
      return pack;
    } catch {
      // A partial or manually edited download must never prevent the main window or tray from
      // starting. Move it aside for diagnosis when possible, then continue with English.
      installedPackCache.delete(packPath);
      quarantineInstalledPack(packPath);
      return null;
    }
  }

  function writeJsonFileAtomic(filePath, value) {
    const tempPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
    try {
      fs.writeFileSync(tempPath, `${JSON.stringify(value, null, 2)}\n`, {
        encoding: 'utf8',
        mode: 0o600,
      });
      fs.renameSync(tempPath, filePath);
    } finally {
      try {
        if (fs.existsSync(tempPath)) fs.unlinkSync(tempPath);
      } catch {
        // The completed destination is authoritative; a stale temp file is harmless.
      }
    }
  }

  function buildInstalledPackMetadata(pack, stats = null) {
    if (!pack || typeof pack !== 'object') return null;
    return {
      locale: normalizeLocaleCode(pack.locale),
      displayName: pack.displayName || pack.locale,
      englishName: pack.englishName || pack.locale,
      version: pack.version || '0.0.0',
      minAppVersion: pack.minAppVersion || '0.0.0',
      sha256: pack.sha256 || '',
      notes: pack.notes || '',
      installed: true,
      downloadedAt: pack.downloadedAt || (stats?.mtime ? new Date(stats.mtime).toISOString() : ''),
      size: stats?.size || JSON.stringify(pack).length,
    };
  }

  function listInstalledLocalePacks() {
    const installedDir = getInstalledLocaleDir();
    if (!fs.existsSync(installedDir)) return [];
    return fs
      .readdirSync(installedDir)
      .filter((fileName) => fileName.endsWith('.json'))
      .map((fileName) => {
        const packPath = path.join(installedDir, fileName);
        try {
          const { pack, stats } = readPackFileCached(packPath);
          return buildInstalledPackMetadata(pack, stats);
        } catch {
          return null;
        }
      })
      .filter(Boolean)
      .sort((a, b) => a.displayName.localeCompare(b.displayName));
  }

  /**
   * Whether the app can show a language: one of its own, or one with a catalog on disk. The second
   * covers a pack added to the remote manifest after this release, which a person can install but
   * APP_LANGUAGES has never heard of, so a system list of that language and English picks the pack.
   */
  function isSupportedLanguage(locale) {
    const normalized = normalizeLocaleCode(locale);
    if (!normalized) return false;
    if (APP_LANGUAGES.includes(getBaseLocale(normalized))) return true;
    return [normalized, getBaseLocale(normalized)].some(
      (code) =>
        fs.existsSync(path.join(bundledDir, `${code}.json`)) ||
        fs.existsSync(getInstalledPackPath(code))
    );
  }

  function getRequestedLocale(languageSetting = 'auto') {
    if (languageSetting === 'auto') {
      return normalizeLocaleCode(getDetectedLocale()) || 'en';
    }
    return normalizeLocaleCode(languageSetting) || 'en';
  }

  function resolveActiveMessages(languageSetting = 'auto') {
    const englishMessages = getEnglishMessages();
    const requestedSetting =
      languageSetting === 'auto' ? 'auto' : normalizeLocaleCode(languageSetting) || 'auto';
    const detectedLocale = normalizeLocaleCode(getDetectedLocale()) || 'en';
    const systemLocale = normalizeLocaleCode(getSystemLocale()) || '';
    const requestedLocale = getRequestedLocale(languageSetting);
    const candidates = Array.from(
      new Set([requestedLocale, getBaseLocale(requestedLocale), 'en'].filter(Boolean))
    );

    let activeLocale = 'en';
    let localeSource = 'bundled';
    let activeMessages = englishMessages;
    let packInstalled = false;

    for (const candidate of candidates) {
      if (candidate === 'en') {
        activeLocale = 'en';
        activeMessages = englishMessages;
        localeSource = 'bundled';
        break;
      }

      const bundledMessages = getBundledMessages(candidate);
      // Downloaded translations can update a bundled locale without an app release.
      const installedPack = readInstalledPack(candidate);
      if (installedPack) {
        activeLocale = normalizeLocaleCode(installedPack.locale) || candidate;
        activeMessages = {
          ...englishMessages,
          ...bundledMessages,
          ...ensureObject(installedPack.messages),
        };
        localeSource = 'downloaded';
        packInstalled = true;
        break;
      }

      if (bundledMessages) {
        activeLocale = candidate;
        activeMessages = { ...englishMessages, ...bundledMessages };
        localeSource = 'bundled';
        packInstalled = true;
        break;
      }
    }

    return {
      languageSetting: requestedSetting,
      detectedLocale,
      systemLocale,
      requestedLocale,
      activeLocale,
      fallbackLocale: 'en',
      localeSource,
      packInstalled,
      usingEnglishFallback: activeLocale === 'en' && requestedLocale !== 'en',
      messages: activeMessages,
    };
  }

  function getLocaleBootstrap(languageSetting = 'auto') {
    const resolved = resolveActiveMessages(languageSetting);
    return {
      ...resolved,
      installedPacks: listInstalledLocalePacks(),
    };
  }

  async function fetchAvailableLocaleManifest(forceRefresh = false) {
    const now = Date.now();
    if (!forceRefresh && manifestCache.packs && now - manifestCache.fetchedAt < 5 * 60 * 1000) {
      return manifestCache.packs;
    }
    if (!manifestUrl) return [];
    const manifestData = await readJsonSource(manifestUrl);
    const packs = Array.isArray(manifestData?.packs) ? manifestData.packs : [];
    const localManifestDir = isFileSource(manifestUrl)
      ? path.dirname(getFileSourcePath(manifestUrl))
      : '';
    manifestCache.fetchedAt = now;
    manifestCache.packs = packs.map((pack) => ({
      locale: normalizeLocaleCode(pack.locale),
      displayName: pack.displayName || pack.locale,
      englishName: pack.englishName || pack.locale,
      version: pack.version || '0.0.0',
      minAppVersion: pack.minAppVersion || '0.0.0',
      downloadUrl: (() => {
        if (localManifestDir) {
          const localPackPath = path.join(
            localManifestDir,
            `${normalizeLocaleCode(pack.locale)}.json`
          );
          if (fs.existsSync(localPackPath)) {
            return pathToFileURL(localPackPath).toString();
          }
        }
        return pack.downloadUrl || '';
      })(),
      sha256: (pack.sha256 || '').toLowerCase(),
      notes: pack.notes || '',
      installed: false,
    }));
    return manifestCache.packs;
  }

  async function listLocalePacks(forceRefresh = false) {
    const installed = listInstalledLocalePacks();
    let available;
    try {
      available = await fetchAvailableLocaleManifest(forceRefresh);
    } catch (error) {
      if (error && typeof error === 'object') {
        error.installedPacks = installed;
      }
      throw error;
    }
    const installedMap = new Map(installed.map((pack) => [pack.locale, pack]));
    const merged = available.map((pack) => {
      const installedPack = installedMap.get(pack.locale);
      return {
        ...pack,
        ...(installedPack || {}),
        installed: installedMap.has(pack.locale),
        latestVersion: pack.version || installedPack?.version || '0.0.0',
        updateAvailable:
          !!installedPack && compareVersions(pack.version, installedPack.version) > 0,
      };
    });
    installed.forEach((pack) => {
      if (!merged.some((entry) => entry.locale === pack.locale)) {
        merged.push({
          ...pack,
          installed: true,
          latestVersion: pack.version || '0.0.0',
          updateAvailable: false,
        });
      }
    });
    return merged.sort((a, b) => getLanguageSortLabel(a).localeCompare(getLanguageSortLabel(b)));
  }

  function getLanguageSortLabel(pack = {}) {
    return String(pack.displayName || pack.englishName || pack.locale || '').toLowerCase();
  }

  function validatePack(pack, expectedLocale = '') {
    const normalizedLocale = normalizeLocaleCode(pack?.locale);
    if (!normalizedLocale) {
      throw new Error('Language pack is missing a locale code.');
    }
    if (expectedLocale && normalizedLocale !== normalizeLocaleCode(expectedLocale)) {
      throw new Error('Downloaded language pack does not match the selected locale.');
    }
    if (compareVersions(appVersion, pack.minAppVersion || '0.0.0') < 0) {
      throw new Error(`This language pack requires app version ${pack.minAppVersion} or newer.`);
    }
    if (!pack.messages || typeof pack.messages !== 'object' || Array.isArray(pack.messages)) {
      throw new Error('Language pack is missing translation messages.');
    }
    return {
      ...pack,
      locale: normalizedLocale,
    };
  }

  function findManifestEntry(availablePacks, normalizedLocale) {
    return (
      availablePacks.find((pack) => pack.locale === normalizedLocale) ||
      availablePacks.find((pack) => getBaseLocale(pack.locale) === getBaseLocale(normalizedLocale))
    );
  }

  /** Download one manifest entry, check it against the manifest's hash and install it. */
  async function installManifestEntry(manifestEntry, normalizedLocale) {
    if (!manifestEntry?.downloadUrl) {
      throw new Error('Language pack is not available for download.');
    }

    const content = await readTextSource(manifestEntry.downloadUrl);
    const actualHash = hashContent(content).toLowerCase();
    if (manifestEntry.sha256 && manifestEntry.sha256 !== actualHash) {
      throw new Error('Language pack failed integrity verification.');
    }

    const parsed = validatePack(JSON.parse(content), normalizedLocale);
    const installedDir = getInstalledLocaleDir();
    fs.mkdirSync(installedDir, { recursive: true });
    const filePath = getInstalledPackPath(parsed.locale);
    const storedPack = {
      ...parsed,
      sha256: actualHash,
      downloadedAt: new Date().toISOString(),
    };
    writeJsonFileAtomic(filePath, storedPack);
    installedPackCache.delete(filePath);
    return buildInstalledPackMetadata(storedPack, fs.statSync(filePath));
  }

  async function downloadLocalePack(locale) {
    const normalizedLocale = normalizeLocaleCode(locale);
    if (!normalizedLocale || normalizedLocale === 'en') {
      throw new Error('English is bundled with the app and does not need to be downloaded.');
    }

    const availablePacks = await fetchAvailableLocaleManifest(true);
    return installManifestEntry(
      findManifestEntry(availablePacks, normalizedLocale),
      normalizedLocale
    );
  }

  /**
   * Bring the installed packs up to the manifest's versions without being asked. A pack is only
   * downloaded from the Settings button otherwise, so an app that was upgraded kept the old pack's
   * missing strings in English until the user found that button.
   *
   * Conservative on purpose, because this runs unseen:
   * - No pack installed means no request at all.
   * - A pack is replaced only when the manifest has a higher version, lists the same locale code,
   *   asks for no newer app than this one and carries a sha256 to check the download against.
   *   A pack installed from a base-locale match, or one the manifest cannot vouch for, stays.
   * - One pack failing (a hash that does not match, a download that times out) leaves it as it was
   *   and does not stop the others.
   * - A manifest that cannot be fetched (offline, GitHub down) throws, so the caller can try again
   *   later; the installed packs keep working from disk either way.
   *
   * @returns {Promise<{updated: string[], failed: string[]}>} Locales replaced, and locales whose
   *   download failed.
   */
  function refreshInstalledLocalePacks() {
    if (refreshInFlight) return refreshInFlight;
    refreshInFlight = (async () => {
      const result = { updated: [], failed: [] };
      const installed = listInstalledLocalePacks();
      if (!installed.length) return result;

      const available = await fetchAvailableLocaleManifest(true);
      for (const pack of installed) {
        const entry = available.find((candidate) => candidate.locale === pack.locale);
        if (
          !entry?.downloadUrl ||
          !entry.sha256 ||
          compareVersions(entry.version, pack.version) <= 0 ||
          compareVersions(appVersion, entry.minAppVersion) < 0
        ) {
          continue;
        }
        try {
          await installManifestEntry(entry, pack.locale);
          result.updated.push(pack.locale);
        } catch {
          result.failed.push(pack.locale);
        }
      }
      return result;
    })().finally(() => {
      refreshInFlight = null;
    });
    return refreshInFlight;
  }

  function removeLocalePack(locale) {
    const normalizedLocale = normalizeLocaleCode(locale);
    if (!normalizedLocale || normalizedLocale === 'en') {
      throw new Error('English cannot be removed.');
    }
    const filePath = getInstalledPackPath(normalizedLocale);
    if (!fs.existsSync(filePath)) {
      return { removed: false, locale: normalizedLocale };
    }
    fs.unlinkSync(filePath);
    installedPackCache.delete(filePath);
    return { removed: true, locale: normalizedLocale };
  }

  function translate(languageSetting, key, vars = {}) {
    // Only the messages and their language: the bootstrap also lists every installed pack, which a
    // lookup has no use for.
    const { activeLocale, messages } = resolveActiveMessages(languageSetting);
    const template = messages?.[key] || key;
    return formatTemplate(template, isRtlLocale(activeLocale) ? isolateQuotedText(vars) : vars);
  }

  return {
    normalizeLocaleCode,
    getBaseLocale,
    formatTemplate,
    compareVersions,
    getLocaleBootstrap,
    isSupportedLanguage,
    listInstalledLocalePacks,
    fetchAvailableLocaleManifest,
    listLocalePacks,
    downloadLocalePack,
    refreshInstalledLocalePacks,
    removeLocalePack,
    translate,
  };
}

module.exports = {
  APP_LANGUAGES,
  createLocalizationService,
  detectSystemLocale,
  normalizeLocaleCode,
  getBaseLocale,
  formatTemplate,
  compareVersions,
};

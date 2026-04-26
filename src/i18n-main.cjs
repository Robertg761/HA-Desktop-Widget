const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { fileURLToPath, pathToFileURL } = require('url');
const axios = require('axios');

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

function formatTemplate(template, vars = {}) {
  if (typeof template !== 'string') return '';
  return template.replace(/\{\{\s*([\w.]+)\s*\}\}/g, (_match, key) => {
    const value = Object.prototype.hasOwnProperty.call(vars, key) ? vars[key] : '';
    return value == null ? '' : String(value);
  });
}

function compareVersions(a = '', b = '') {
  const toParts = (value) => String(value || '')
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
  return crypto.createHash('sha256').update(content).digest('hex');
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
    manifestUrl = '',
  } = options;

  const bundledCache = new Map();
  const manifestCache = {
    fetchedAt: 0,
    packs: null,
  };

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
    const response = await axios.get(source, {
      responseType: 'json',
      timeout: 15000,
      validateStatus: (status) => status >= 200 && status < 300,
    });
    return response.data;
  }

  async function readTextSource(source) {
    if (isFileSource(source)) {
      return fs.readFileSync(getFileSourcePath(source), 'utf8');
    }
    const response = await axios.get(source, {
      responseType: 'text',
      timeout: 20000,
      validateStatus: (status) => status >= 200 && status < 300,
    });
    return typeof response.data === 'string'
      ? response.data
      : JSON.stringify(response.data);
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

  function readInstalledPack(locale) {
    const normalized = normalizeLocaleCode(locale);
    if (!normalized || normalized === 'en') return null;
    const packPath = getInstalledPackPath(normalized);
    if (!fs.existsSync(packPath)) return null;
    // Intentionally surface corrupt installed packs for now; fallback/quarantine
    // recovery is deferred to a dedicated hardening pass to avoid changing launch behavior.
    const pack = readJsonFile(packPath);
    if (!pack || typeof pack !== 'object' || Array.isArray(pack)) {
      throw new Error(`Invalid locale pack: ${normalized}`);
    }
    return pack;
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
    return fs.readdirSync(installedDir)
      .filter((fileName) => fileName.endsWith('.json'))
      .map((fileName) => {
        const packPath = path.join(installedDir, fileName);
        try {
          const stats = fs.statSync(packPath);
          const pack = readJsonFile(packPath);
          return buildInstalledPackMetadata(pack, stats);
        } catch {
          return null;
        }
      })
      .filter(Boolean)
      .sort((a, b) => a.displayName.localeCompare(b.displayName));
  }

  function getRequestedLocale(languageSetting = 'auto') {
    if (languageSetting === 'auto') {
      return normalizeLocaleCode(getDetectedLocale()) || 'en';
    }
    return normalizeLocaleCode(languageSetting) || 'en';
  }

  function resolveActiveMessages(languageSetting = 'auto') {
    const englishMessages = getEnglishMessages();
    const requestedSetting = languageSetting === 'auto' ? 'auto' : normalizeLocaleCode(languageSetting) || 'auto';
    const detectedLocale = normalizeLocaleCode(getDetectedLocale()) || 'en';
    const requestedLocale = getRequestedLocale(languageSetting);
    const candidates = Array.from(new Set([
      requestedLocale,
      getBaseLocale(requestedLocale),
      'en',
    ].filter(Boolean)));

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
      if (bundledMessages) {
        activeLocale = candidate;
        activeMessages = { ...englishMessages, ...bundledMessages };
        localeSource = 'bundled';
        packInstalled = true;
        break;
      }

      const installedPack = readInstalledPack(candidate);
      if (installedPack) {
        activeLocale = normalizeLocaleCode(installedPack.locale) || candidate;
        activeMessages = {
          ...englishMessages,
          ...ensureObject(installedPack.messages),
        };
        localeSource = 'downloaded';
        packInstalled = true;
        break;
      }
    }

    return {
      languageSetting: requestedSetting,
      detectedLocale,
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
    if (!forceRefresh && manifestCache.packs && (now - manifestCache.fetchedAt) < 5 * 60 * 1000) {
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
          const localPackPath = path.join(localManifestDir, `${normalizeLocaleCode(pack.locale)}.json`);
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
        updateAvailable: !!installedPack && compareVersions(pack.version, installedPack.version) > 0,
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

  async function downloadLocalePack(locale) {
    const normalizedLocale = normalizeLocaleCode(locale);
    if (!normalizedLocale || normalizedLocale === 'en') {
      throw new Error('English is bundled with the app and does not need to be downloaded.');
    }

    const availablePacks = await fetchAvailableLocaleManifest(true);
    const manifestEntry = availablePacks.find((pack) => pack.locale === normalizedLocale)
      || availablePacks.find((pack) => getBaseLocale(pack.locale) === getBaseLocale(normalizedLocale));
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
    fs.writeFileSync(filePath, `${JSON.stringify(storedPack, null, 2)}\n`, 'utf8');
    return buildInstalledPackMetadata(storedPack, fs.statSync(filePath));
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
    return { removed: true, locale: normalizedLocale };
  }

  function translate(languageSetting, key, vars = {}) {
    const bootstrap = getLocaleBootstrap(languageSetting);
    const template = bootstrap.messages?.[key] || key;
    return formatTemplate(template, vars);
  }

  return {
    normalizeLocaleCode,
    getBaseLocale,
    formatTemplate,
    compareVersions,
    getLocaleBootstrap,
    listInstalledLocalePacks,
    fetchAvailableLocaleManifest,
    listLocalePacks,
    downloadLocalePack,
    removeLocalePack,
    translate,
  };
}

module.exports = {
  createLocalizationService,
  normalizeLocaleCode,
  getBaseLocale,
  formatTemplate,
  compareVersions,
};

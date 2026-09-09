const fs = require('fs');
const os = require('os');
const path = require('path');
const nodeCrypto = require('crypto');
const { pathToFileURL } = require('url');

const { createLocalizationService } = require('../../src/i18n-main.cjs');

function createTempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'ha-widget-i18n-'));
}

describe('main localization service', () => {
  let rootDir;
  let bundledDir;
  let userDataDir;
  let fetchMock;

  beforeEach(() => {
    fetchMock = jest.fn();
    rootDir = createTempDir();
    bundledDir = path.join(rootDir, 'locales');
    userDataDir = path.join(rootDir, 'user');
    fs.mkdirSync(bundledDir, { recursive: true });
    fs.mkdirSync(userDataDir, { recursive: true });
    fs.writeFileSync(
      path.join(bundledDir, 'en.json'),
      JSON.stringify({
        Hello: 'Hello',
        'Selected language: {{language}}': 'Selected language: {{language}}',
      })
    );
  });

  it('activates bundled German for a German system locale', () => {
    fs.writeFileSync(
      path.join(bundledDir, 'de.json'),
      JSON.stringify({
        Hello: 'Hallo',
        'Selected language: {{language}}': 'Gewählte Sprache: {{language}}',
      })
    );

    const service = createLocalizationService({
      bundledDir,
      getUserDataDir: () => userDataDir,
      appVersion: '1.0.0',
      getDetectedLocale: () => 'de-DE',
      manifestUrl: 'https://example.test/manifest.json',
    });

    const bootstrap = service.getLocaleBootstrap('auto');

    expect(bootstrap.requestedLocale).toBe('de-DE');
    expect(bootstrap.activeLocale).toBe('de');
    expect(bootstrap.usingEnglishFallback).toBe(false);
    expect(bootstrap.messages.Hello).toBe('Hallo');
  });

  it('uses downloaded German updates and restores bundled German after removal', () => {
    fs.writeFileSync(
      path.join(bundledDir, 'de.json'),
      JSON.stringify({ Hello: 'Hallo', 'Selected language: {{language}}': 'Sprache: {{language}}' })
    );
    const installedDir = path.join(userDataDir, 'locales');
    fs.mkdirSync(installedDir, { recursive: true });
    fs.writeFileSync(
      path.join(installedDir, 'de.json'),
      JSON.stringify({ locale: 'de', version: '1.0.0', messages: { Hello: 'Guten Tag' } })
    );
    const service = createLocalizationService({
      bundledDir,
      getUserDataDir: () => userDataDir,
      getDetectedLocale: () => 'de-DE',
    });

    const updated = service.getLocaleBootstrap('auto');
    expect(updated.localeSource).toBe('downloaded');
    expect(updated.messages.Hello).toBe('Guten Tag');
    expect(updated.messages['Selected language: {{language}}']).toBe('Sprache: {{language}}');

    service.removeLocalePack('de');
    const restored = service.getLocaleBootstrap('auto');
    expect(restored.activeLocale).toBe('de');
    expect(restored.localeSource).toBe('bundled');
    expect(restored.messages.Hello).toBe('Hallo');

    fs.writeFileSync(path.join(installedDir, 'de.json'), '{broken');
    expect(service.getLocaleBootstrap('de').messages.Hello).toBe('Hallo');
    expect(fs.existsSync(path.join(installedDir, 'de.json'))).toBe(false);
  });

  it('falls back to bundled English when the detected locale pack is unavailable', () => {
    const service = createLocalizationService({
      bundledDir,
      getUserDataDir: () => userDataDir,
      appVersion: '1.0.0',
      getDetectedLocale: () => 'fr-CA',
      manifestUrl: 'https://example.test/manifest.json',
    });

    const bootstrap = service.getLocaleBootstrap('auto');

    expect(bootstrap.requestedLocale).toBe('fr-CA');
    expect(bootstrap.activeLocale).toBe('en');
    expect(bootstrap.usingEnglishFallback).toBe(true);
    expect(bootstrap.messages.Hello).toBe('Hello');
  });

  it('quarantines a corrupt installed pack and falls back to English', () => {
    const installedDir = path.join(userDataDir, 'locales');
    fs.mkdirSync(installedDir, { recursive: true });
    const installedPath = path.join(installedDir, 'fr.json');
    fs.writeFileSync(installedPath, '{"locale":"fr","messages":', 'utf8');

    const service = createLocalizationService({
      bundledDir,
      getUserDataDir: () => userDataDir,
      appVersion: '1.0.0',
      getDetectedLocale: () => 'fr',
      manifestUrl: 'https://example.test/manifest.json',
    });

    const bootstrap = service.getLocaleBootstrap('fr');
    const quarantinedFiles = fs
      .readdirSync(installedDir)
      .filter((fileName) => fileName.startsWith('fr.json.corrupt-'));

    expect(bootstrap.activeLocale).toBe('en');
    expect(bootstrap.usingEnglishFallback).toBe(true);
    expect(fs.existsSync(installedPath)).toBe(false);
    expect(quarantinedFiles).toHaveLength(1);
  });

  it('rejects unsafe locale codes before building installed pack paths', () => {
    const userConfigPath = path.join(userDataDir, 'config.json');
    fs.writeFileSync(userConfigPath, '{"safe":true}', 'utf8');

    const service = createLocalizationService({
      bundledDir,
      getUserDataDir: () => userDataDir,
      appVersion: '1.0.0',
      getDetectedLocale: () => 'en',
      manifestUrl: 'https://example.test/manifest.json',
    });

    expect(service.normalizeLocaleCode('../config')).toBe('');
    expect(() => service.removeLocalePack('../config')).toThrow();
    expect(fs.existsSync(userConfigPath)).toBe(true);
  });

  it('downloads, validates, and activates a locale pack', async () => {
    const packPayload = {
      locale: 'fr',
      displayName: 'Français',
      englishName: 'French',
      version: '1.0.0',
      minAppVersion: '1.0.0',
      messages: {
        Hello: 'Bonjour',
      },
    };
    const serializedPack = JSON.stringify(packPayload);
    const sha256 = nodeCrypto.createHash('sha256').update(serializedPack).digest('hex');

    fetchMock
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          packs: [
            {
              locale: 'fr',
              displayName: 'Français',
              englishName: 'French',
              version: '1.0.0',
              minAppVersion: '1.0.0',
              downloadUrl: 'https://example.test/fr.json',
              sha256,
            },
          ],
        }),
      })
      .mockResolvedValueOnce({ ok: true, status: 200, text: async () => serializedPack });

    const service = createLocalizationService({
      bundledDir,
      getUserDataDir: () => userDataDir,
      appVersion: '1.0.0',
      getDetectedLocale: () => 'en',
      manifestUrl: 'https://example.test/manifest.json',
      fetchImpl: fetchMock,
    });

    const pack = await service.downloadLocalePack('fr');
    const bootstrap = service.getLocaleBootstrap('fr');

    expect(pack.locale).toBe('fr');
    expect(bootstrap.activeLocale).toBe('fr');
    expect(bootstrap.messages.Hello).toBe('Bonjour');
    expect(fs.existsSync(path.join(userDataDir, 'locales', 'fr.json'))).toBe(true);
    expect(
      fs
        .readdirSync(path.join(userDataDir, 'locales'))
        .filter((fileName) => fileName.endsWith('.tmp'))
    ).toEqual([]);
  });

  it('rejects a locale pack when the integrity hash does not match', async () => {
    fetchMock
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          packs: [
            {
              locale: 'fr',
              displayName: 'Français',
              englishName: 'French',
              version: '1.0.0',
              minAppVersion: '1.0.0',
              downloadUrl: 'https://example.test/fr.json',
              sha256: 'bad-hash',
            },
          ],
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: async () =>
          JSON.stringify({
            locale: 'fr',
            messages: { Hello: 'Bonjour' },
          }),
      });

    const service = createLocalizationService({
      bundledDir,
      getUserDataDir: () => userDataDir,
      appVersion: '1.0.0',
      getDetectedLocale: () => 'en',
      manifestUrl: 'https://example.test/manifest.json',
      fetchImpl: fetchMock,
    });

    await expect(service.downloadLocalePack('fr')).rejects.toThrow('integrity verification');
  });

  it('loads a local manifest and downloads sibling locale packs in dev mode', async () => {
    const packPayload = {
      locale: 'es',
      displayName: 'Español',
      englishName: 'Spanish',
      version: '1.0.0',
      minAppVersion: '1.0.0',
      messages: {
        Hello: 'Hola',
      },
    };
    const serializedPack = `${JSON.stringify(packPayload, null, 2)}\n`;
    const sha256 = nodeCrypto.createHash('sha256').update(serializedPack).digest('hex');
    const manifestPath = path.join(rootDir, 'manifest.json');
    const packPath = path.join(rootDir, 'es.json');

    fs.writeFileSync(packPath, serializedPack, 'utf8');
    fs.writeFileSync(
      manifestPath,
      JSON.stringify({
        packs: [
          {
            locale: 'es',
            displayName: 'Español',
            englishName: 'Spanish',
            version: '1.0.0',
            minAppVersion: '1.0.0',
            downloadUrl: 'https://example.test/es.json',
            sha256,
          },
        ],
      }),
      'utf8'
    );

    const service = createLocalizationService({
      bundledDir,
      getUserDataDir: () => userDataDir,
      appVersion: '1.0.0',
      getDetectedLocale: () => 'en',
      manifestUrl: pathToFileURL(manifestPath).toString(),
    });

    const packs = await service.listLocalePacks(true);
    const installed = await service.downloadLocalePack('es');
    const bootstrap = service.getLocaleBootstrap('es');

    expect(packs[0].locale).toBe('es');
    expect(packs[0].downloadUrl.startsWith('file://')).toBe(true);
    expect(installed.locale).toBe('es');
    expect(bootstrap.activeLocale).toBe('es');
    expect(bootstrap.messages.Hello).toBe('Hola');
  });

  it('propagates manifest fetch failures while preserving installed packs for the UI', async () => {
    const installedDir = path.join(userDataDir, 'locales');
    fs.mkdirSync(installedDir, { recursive: true });
    fs.writeFileSync(
      path.join(installedDir, 'fr.json'),
      JSON.stringify({
        locale: 'fr',
        displayName: 'Français',
        englishName: 'French',
        version: '1.0.0',
        minAppVersion: '1.0.0',
        messages: {
          Hello: 'Bonjour',
        },
      }),
      'utf8'
    );

    fetchMock.mockRejectedValue(new Error('manifest unavailable'));

    const service = createLocalizationService({
      bundledDir,
      getUserDataDir: () => userDataDir,
      appVersion: '1.0.0',
      getDetectedLocale: () => 'en',
      manifestUrl: 'https://example.test/manifest.json',
      fetchImpl: fetchMock,
    });

    await expect(service.listLocalePacks(true)).rejects.toMatchObject({
      message: 'manifest unavailable',
      installedPacks: expect.arrayContaining([
        expect.objectContaining({
          locale: 'fr',
          installed: true,
        }),
      ]),
    });
  });
});

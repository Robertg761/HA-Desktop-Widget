const fs = require('fs');
const os = require('os');
const path = require('path');
const nodeCrypto = require('crypto');
const { pathToFileURL } = require('url');

const { createLocalizationService } = require('../../src/i18n-main.cjs');
const {
  createLocalePackRefresher,
  DEFAULT_FIRST_CHECK_DELAY_MS,
  DEFAULT_CHECK_INTERVAL_MS,
  DEFAULT_RETRY_DELAY_MS,
} = require('../../src/locale-pack-refresh.cjs');

function packFile(locale, version, messages, extra = {}) {
  return {
    locale,
    displayName: locale,
    englishName: locale,
    version,
    minAppVersion: '3.4.1',
    messages,
    ...extra,
  };
}

function serialize(value) {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function sha256(text) {
  return nodeCrypto.createHash('sha256').update(text).digest('hex');
}

describe('refreshing the installed language packs after an upgrade', () => {
  let rootDir;
  let bundledDir;
  let userDataDir;
  let manifestDir;
  let installedDir;

  beforeEach(() => {
    rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ha-widget-pack-refresh-'));
    bundledDir = path.join(rootDir, 'locales');
    userDataDir = path.join(rootDir, 'user');
    manifestDir = path.join(rootDir, 'remote');
    installedDir = path.join(userDataDir, 'locales');
    fs.mkdirSync(bundledDir, { recursive: true });
    fs.mkdirSync(installedDir, { recursive: true });
    fs.mkdirSync(manifestDir, { recursive: true });
    fs.writeFileSync(
      path.join(bundledDir, 'en.json'),
      JSON.stringify({ Hello: 'Hello', 'New in 4.0': 'New in 4.0' })
    );
  });

  afterEach(() => {
    fs.rmSync(rootDir, { recursive: true, force: true });
  });

  function install(locale, version, messages, extra) {
    fs.writeFileSync(
      path.join(installedDir, `${locale}.json`),
      serialize(packFile(locale, version, messages, extra))
    );
  }

  /** Publish a pack the way main does: the pack file next to a manifest entry that hashes it. */
  function publish(locale, version, messages, { manifestOverrides = {}, packExtra = {} } = {}) {
    const text = serialize(packFile(locale, version, messages, packExtra));
    fs.writeFileSync(path.join(manifestDir, `${locale}.json`), text);
    return {
      locale,
      displayName: locale,
      englishName: locale,
      version,
      minAppVersion: '3.4.1',
      downloadUrl: `https://example.test/${locale}.json`,
      sha256: sha256(text),
      ...manifestOverrides,
    };
  }

  function writeManifest(entries) {
    const manifestPath = path.join(manifestDir, 'manifest.json');
    fs.writeFileSync(manifestPath, JSON.stringify({ packs: entries }));
    return pathToFileURL(manifestPath).toString();
  }

  function createService(options = {}) {
    return createLocalizationService({
      bundledDir,
      getUserDataDir: () => userDataDir,
      appVersion: '4.0.0',
      getDetectedLocale: () => 'es-ES',
      ...options,
    });
  }

  it('replaces a 3.11 pack with the version on main, so the new strings arrive without the button', async () => {
    install('es', '1.2.23', { Hello: 'Hola' });
    const service = createService({
      manifestUrl: writeManifest([
        publish('es', '1.2.46', { Hello: 'Hola', 'New in 4.0': 'Nuevo en 4.0' }),
      ]),
    });
    expect(service.getLocaleBootstrap('auto').messages['New in 4.0']).toBe('New in 4.0');

    const result = await service.refreshInstalledLocalePacks();

    expect(result).toEqual({ updated: ['es'], failed: [] });
    const bootstrap = service.getLocaleBootstrap('auto');
    expect(bootstrap.messages['New in 4.0']).toBe('Nuevo en 4.0');
    expect(bootstrap.installedPacks.find((pack) => pack.locale === 'es').version).toBe('1.2.46');
  });

  it('makes no request at all when no pack is installed', async () => {
    const fetchImpl = jest.fn();
    const service = createService({ manifestUrl: 'https://example.test/manifest.json', fetchImpl });

    await expect(service.refreshInstalledLocalePacks()).resolves.toEqual({
      updated: [],
      failed: [],
    });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('keeps the installed packs working when the manifest cannot be reached', async () => {
    install('es', '1.2.23', { Hello: 'Hola' });
    const fetchImpl = jest.fn().mockRejectedValue(new Error('getaddrinfo ENOTFOUND'));
    const service = createService({ manifestUrl: 'https://example.test/manifest.json', fetchImpl });

    await expect(service.refreshInstalledLocalePacks()).rejects.toThrow('ENOTFOUND');

    expect(service.getLocaleBootstrap('auto').messages.Hello).toBe('Hola');
    expect(fs.existsSync(path.join(installedDir, 'es.json'))).toBe(true);
  });

  it('leaves a pack alone when the manifest has the same or an older version', async () => {
    install('es', '1.2.46', { Hello: 'Hola' });
    install('fr', '1.2.50', { Hello: 'Bonjour' });
    const service = createService({
      manifestUrl: writeManifest([
        publish('es', '1.2.46', { Hello: 'Hola!' }),
        publish('fr', '1.2.46', { Hello: 'Salut' }),
      ]),
    });

    const result = await service.refreshInstalledLocalePacks();

    expect(result).toEqual({ updated: [], failed: [] });
    expect(service.getLocaleBootstrap('fr').messages.Hello).toBe('Bonjour');
  });

  it('only touches languages that are installed', async () => {
    install('es', '1.2.23', { Hello: 'Hola' });
    const service = createService({
      manifestUrl: writeManifest([
        publish('es', '1.2.46', { Hello: 'Hola de nuevo' }),
        publish('fr', '1.2.46', { Hello: 'Bonjour' }),
      ]),
    });

    await service.refreshInstalledLocalePacks();

    expect(fs.existsSync(path.join(installedDir, 'fr.json'))).toBe(false);
  });

  it('does not install a download whose hash does not match, and still updates the others', async () => {
    install('es', '1.2.23', { Hello: 'Hola' });
    install('fr', '1.2.23', { Hello: 'Bonjour' });
    const service = createService({
      manifestUrl: writeManifest([
        publish(
          'es',
          '1.2.46',
          { Hello: 'Hola de nuevo' },
          { manifestOverrides: { sha256: 'ab' } }
        ),
        publish('fr', '1.2.46', { Hello: 'Bonjour encore' }),
      ]),
    });

    const result = await service.refreshInstalledLocalePacks();

    expect(result).toEqual({ updated: ['fr'], failed: ['es'] });
    expect(service.getLocaleBootstrap('es').messages.Hello).toBe('Hola');
    expect(service.getLocaleBootstrap('fr').messages.Hello).toBe('Bonjour encore');
  });

  it('does not install a pack the manifest gives no hash for', async () => {
    install('es', '1.2.23', { Hello: 'Hola' });
    const service = createService({
      manifestUrl: writeManifest([
        publish('es', '1.2.46', { Hello: 'Hola de nuevo' }, { manifestOverrides: { sha256: '' } }),
      ]),
    });

    const result = await service.refreshInstalledLocalePacks();

    expect(result).toEqual({ updated: [], failed: [] });
    expect(service.getLocaleBootstrap('es').messages.Hello).toBe('Hola');
  });

  it('does not install a pack that needs a newer app than this one', async () => {
    install('es', '1.2.23', { Hello: 'Hola' });
    const service = createService({
      appVersion: '3.11.0',
      manifestUrl: writeManifest([
        publish(
          'es',
          '2.0.0',
          { Hello: 'Hola de nuevo' },
          { manifestOverrides: { minAppVersion: '5.0.0' }, packExtra: { minAppVersion: '5.0.0' } }
        ),
      ]),
    });

    const result = await service.refreshInstalledLocalePacks();

    expect(result).toEqual({ updated: [], failed: [] });
    expect(service.getLocaleBootstrap('es').messages.Hello).toBe('Hola');
  });

  it('shares one run between callers that ask while it is going', async () => {
    install('es', '1.2.23', { Hello: 'Hola' });
    const service = createService({
      manifestUrl: writeManifest([publish('es', '1.2.46', { Hello: 'Hola de nuevo' })]),
    });

    const first = service.refreshInstalledLocalePacks();
    const second = service.refreshInstalledLocalePacks();

    expect(second).toBe(first);
    await first;
    await expect(service.refreshInstalledLocalePacks()).resolves.toEqual({
      updated: [],
      failed: [],
    });
  });

  it('answers a run of main-process translations from one read of each pack', () => {
    install('es', '1.2.46', { Hello: 'Hola' });
    install('fr', '1.2.46', { Hello: 'Bonjour' });
    const service = createService();
    const packPaths = [path.join(installedDir, 'es.json'), path.join(installedDir, 'fr.json')];
    const readFileSync = fs.readFileSync;
    const reads = [];
    const spy = jest.spyOn(fs, 'readFileSync').mockImplementation((file, ...rest) => {
      if (packPaths.includes(String(file))) reads.push(String(file));
      return readFileSync.call(fs, file, ...rest);
    });
    try {
      for (let index = 0; index < 20; index += 1) {
        expect(service.translate('es', 'Hello')).toBe('Hola');
      }
      expect(reads.filter((file) => file === packPaths[0])).toHaveLength(1);
      // The French pack is never read for a lookup in Spanish.
      expect(reads.filter((file) => file === packPaths[1])).toHaveLength(0);
    } finally {
      spy.mockRestore();
    }
  });

  it('reads a pack again when its file changes, is removed or is downloaded again', async () => {
    install('es', '1.2.46', { Hello: 'Hola' });
    const service = createService({
      manifestUrl: writeManifest([publish('es', '1.2.60', { Hello: 'Buenas' })]),
    });
    expect(service.translate('es', 'Hello')).toBe('Hola');

    // Another instance (or a hand edit) rewrote it: a different size is a different file.
    install('es', '1.2.47', { Hello: 'Hola, mundo' });
    expect(service.translate('es', 'Hello')).toBe('Hola, mundo');

    await service.downloadLocalePack('es');
    expect(service.translate('es', 'Hello')).toBe('Buenas');

    service.removeLocalePack('es');
    expect(service.translate('es', 'Hello')).toBe('Hello');
  });
});

describe('the language pack refresher', () => {
  function createTimers() {
    const scheduled = [];
    return {
      scheduled,
      setTimeout: jest.fn((callback, delay) => {
        const handle = { callback, delay, cleared: false, unref: jest.fn() };
        scheduled.push(handle);
        return handle;
      }),
      clearTimeout: jest.fn((handle) => {
        handle.cleared = true;
      }),
      async fire() {
        const handle = scheduled.filter((entry) => !entry.cleared && !entry.fired).at(-1);
        handle.fired = true;
        await handle.callback();
        return handle;
      },
    };
  }

  it('waits before the first check, then checks daily', async () => {
    const timers = createTimers();
    const refresh = jest.fn().mockResolvedValue({ updated: [], failed: [] });
    const refresher = createLocalePackRefresher({ refresh, onUpdated: jest.fn(), timers });

    refresher.start();
    expect(timers.scheduled).toHaveLength(1);
    expect(timers.scheduled[0].delay).toBe(DEFAULT_FIRST_CHECK_DELAY_MS);
    expect(timers.scheduled[0].unref).toHaveBeenCalled();
    expect(refresh).not.toHaveBeenCalled();

    await timers.fire();

    expect(refresh).toHaveBeenCalledTimes(1);
    expect(timers.scheduled.at(-1).delay).toBe(DEFAULT_CHECK_INTERVAL_MS);
  });

  it('tells the windows which packs changed', async () => {
    const timers = createTimers();
    const onUpdated = jest.fn();
    const log = { info: jest.fn(), warn: jest.fn() };
    const refresher = createLocalePackRefresher({
      refresh: jest.fn().mockResolvedValue({ updated: ['es', 'fr'], failed: [] }),
      onUpdated,
      log,
      timers,
    });

    refresher.start();
    await timers.fire();

    expect(onUpdated).toHaveBeenCalledWith(['es', 'fr']);
  });

  it('does not tell the windows when nothing changed', async () => {
    const timers = createTimers();
    const onUpdated = jest.fn();
    const refresher = createLocalePackRefresher({
      refresh: jest.fn().mockResolvedValue({ updated: [], failed: [] }),
      onUpdated,
      timers,
    });

    refresher.start();
    await timers.fire();

    expect(onUpdated).not.toHaveBeenCalled();
  });

  it('is quiet and tries again within the hour when the network is down', async () => {
    const timers = createTimers();
    const log = { info: jest.fn(), warn: jest.fn() };
    const onUpdated = jest.fn();
    const refresher = createLocalePackRefresher({
      refresh: jest.fn().mockRejectedValue(new Error('getaddrinfo ENOTFOUND')),
      onUpdated,
      log,
      timers,
    });

    refresher.start();
    await timers.fire();

    expect(timers.scheduled.at(-1).delay).toBe(DEFAULT_RETRY_DELAY_MS);
    expect(log.warn).not.toHaveBeenCalled();
    expect(log.info).toHaveBeenCalledTimes(1);
    expect(onUpdated).not.toHaveBeenCalled();
  });

  it('tries again sooner after a pack that would not install', async () => {
    const timers = createTimers();
    const log = { info: jest.fn(), warn: jest.fn() };
    const refresher = createLocalePackRefresher({
      refresh: jest.fn().mockResolvedValue({ updated: ['fr'], failed: ['es'] }),
      onUpdated: jest.fn(),
      log,
      timers,
    });

    refresher.start();
    await timers.fire();

    expect(timers.scheduled.at(-1).delay).toBe(DEFAULT_RETRY_DELAY_MS);
    expect(log.warn).toHaveBeenCalledTimes(1);
  });

  it('keeps going when telling the windows throws', async () => {
    const timers = createTimers();
    const refresher = createLocalePackRefresher({
      refresh: jest.fn().mockResolvedValue({ updated: ['es'], failed: [] }),
      onUpdated: jest.fn(() => {
        throw new Error('window destroyed');
      }),
      log: { info: jest.fn(), warn: jest.fn() },
      timers,
    });

    refresher.start();
    await timers.fire();

    expect(timers.scheduled.at(-1).delay).toBe(DEFAULT_CHECK_INTERVAL_MS);
  });

  it('stops checking once stopped, and starts only once', async () => {
    const timers = createTimers();
    const refresh = jest.fn().mockResolvedValue({ updated: [], failed: [] });
    const refresher = createLocalePackRefresher({ refresh, onUpdated: jest.fn(), timers });

    refresher.start();
    refresher.start();
    expect(timers.scheduled).toHaveLength(1);

    refresher.stop();
    expect(timers.scheduled[0].cleared).toBe(true);
    await timers.scheduled[0].callback();
    expect(refresh).not.toHaveBeenCalled();
    expect(timers.scheduled).toHaveLength(1);
  });
});

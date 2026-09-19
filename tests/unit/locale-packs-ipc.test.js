/** @jest-environment node */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const mainSource = fs.readFileSync(path.resolve(__dirname, '../../main.js'), 'utf8');

function registerHandler(service, authorized = true) {
  let handler;
  const start = mainSource.indexOf("ipcMain.handle('get-locale-packs'");
  const end = mainSource.indexOf("ipcMain.handle('download-locale-pack'", start);
  vm.runInNewContext(mainSource.slice(start, end), {
    ipcMain: { handle: (_channel, callback) => (handler = callback) },
    authorizeIpcSender: () => authorized,
    rejectUnauthorizedIpc: () => {
      throw new Error('Unauthorized');
    },
    localizationService: service,
    log: { warn: jest.fn() },
  });
  return handler;
}

describe('locale pack IPC response', () => {
  test.each(['TimeoutError', 'TypeError'])(
    'serializes installed packs after a %s',
    async (name) => {
      const error = new Error('Network unavailable');
      error.name = name;
      error.installedPacks = [{ locale: 'fr', installed: true, version: '1.0.0' }];
      const service = { listLocalePacks: jest.fn().mockRejectedValue(error) };
      const handler = registerHandler(service);
      // Structured clone drops custom Error fields, but preserves this response.
      expect(structuredClone(error).installedPacks).toBeUndefined();
      expect(structuredClone(await handler({}, true))).toEqual({
        error: 'manifest_unavailable',
        installedPacks: error.installedPacks,
      });
      expect(service.listLocalePacks).toHaveBeenCalledWith(true);
    }
  );

  test('returns an empty fallback for a failure without installed metadata', async () => {
    const handler = registerHandler({ listLocalePacks: jest.fn().mockRejectedValue(null) });
    await expect(handler({})).resolves.toEqual({
      error: 'manifest_unavailable',
      installedPacks: [],
    });
  });

  test.each([[[]], [[{ locale: 'fr', installed: false }]]])(
    'preserves successful catalogs: %j',
    async (packs) => {
      const service = { listLocalePacks: jest.fn().mockResolvedValue(packs) };
      await expect(registerHandler(service)({})).resolves.toEqual(packs);
      expect(service.listLocalePacks).toHaveBeenCalledWith(false);
    }
  );

  test('rejects unauthorized requests before fetching the manifest', async () => {
    const service = { listLocalePacks: jest.fn() };
    await expect(registerHandler(service, false)({})).rejects.toThrow('Unauthorized');
    expect(service.listLocalePacks).not.toHaveBeenCalled();
  });
});

describe('locale pack mutation responses', () => {
  function registerMutationHandlers(service) {
    const handlers = {};
    const start = mainSource.indexOf("ipcMain.handle('download-locale-pack'");
    const end = mainSource.indexOf("ipcMain.handle(\n  'replace-config-entity-id'", start);
    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
    vm.runInNewContext(mainSource.slice(start, end), {
      ipcMain: {
        handle: (channel, callback) => {
          handlers[channel] = callback;
        },
      },
      authorizeIpcSender: () => true,
      localizationService: service,
      pushConfigToRenderer: jest.fn(),
      tray: null,
      config: { ui: { language: 'fr' } },
    });
    return handlers;
  }

  test.each(['download', 'remove'])(
    '%s succeeds without another network request after the mutation',
    async (action) => {
      const installed = action === 'download' ? [{ locale: 'fr', installed: true }] : [];
      const service = {
        downloadLocalePack: jest.fn().mockResolvedValue({ locale: 'fr' }),
        removeLocalePack: jest.fn().mockReturnValue({ removed: true }),
        getLocaleBootstrap: jest.fn().mockReturnValue({ installedPacks: installed }),
        listInstalledLocalePacks: jest.fn().mockReturnValue(installed),
        listLocalePacks: jest.fn().mockRejectedValue(new Error('offline')),
      };
      const result = await registerMutationHandlers(service)[`${action}-locale-pack`]({}, 'fr');
      expect(result).toMatchObject({ success: true, packs: installed });
      expect(service[`${action}LocalePack`]).toHaveBeenCalledWith('fr');
      expect(service.listLocalePacks).not.toHaveBeenCalled();
    }
  );

  test.each(['download', 'remove'])('%s still rejects a failed mutation', async (action) => {
    const fail = jest.fn(() => {
      throw new Error('mutation failed');
    });
    const service = { [`${action}LocalePack`]: fail };
    await expect(
      registerMutationHandlers(service)[`${action}-locale-pack`]({}, 'fr')
    ).rejects.toThrow('mutation failed');
  });
});

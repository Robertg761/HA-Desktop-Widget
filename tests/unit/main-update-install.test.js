/**
 * @jest-environment node
 */

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { EventEmitter } = require('events');
const { BaseUpdater } = require('electron-updater/out/BaseUpdater');
const { createConfigStore } = require('../../src/main-config-store.cjs');
const { createMemoryFs } = require('../helpers/main-config-store.js');

const source = fs.readFileSync(path.resolve(__dirname, '../../main.js'), 'utf8');
function section(start, end) {
  const from = source.indexOf(start);
  const to = source.indexOf(end, from);
  if (from < 0 || to < 0) throw new Error(`Missing main.js section: ${start}`);
  return source.slice(from, to);
}

function loadInstall({ verify = async () => {}, hashFile = async () => undefined } = {}) {
  const app = Object.assign(new EventEmitter(), { isPackaged: true });
  const nativeUpdater = new EventEmitter();
  const updater = new EventEmitter();
  const handlers = {};
  const sent = [];
  let syncRunning = true;
  let syncRestarts = 0;
  const removed = [];
  const configStore = createConfigStore({
    filePath: '/profile/config.json',
    fs: createMemoryFs().fs,
  });
  configStore.load({});
  const flushSync = jest.spyOn(configStore, 'flushSync');
  const context = vm.createContext({
    app,
    require: (name) => {
      if (name !== 'electron') throw new Error(`Unexpected require: ${name}`);
      return { autoUpdater: nativeUpdater };
    },
    ipcRoutes: { handle: (name, handler) => (handlers[name] = handler) },
    isPortableBuild: () => false,
    supportsAutoUpdater: () => true,
    process: { platform: 'linux', env: { APPIMAGE: '/app.AppImage' } },
    getAutoUpdater: () => updater,
    // The download passes the signed-checksum check (tests/unit/update-signature.test.js).
    verifyDownloadedUpdate: (options) => verify(options),
    hashUpdateFile: (filePath) => hashFile(filePath),
    fs: { promises: { rm: async (filePath) => removed.push(filePath) } },
    mainT: (key) => key,
    net: { fetch: async () => ({ ok: false }) },
    backgroundUpdateCheckRunning: false,
    configureAutoUpdaterChannel: () => {},
    log: { info() {}, warn() {}, error() {}, transports: { file: {} } },
    sendUpdaterCheckEvent: (event) => sent.push(event),
    sendAutoUpdateToWindow: (event) => sent.push(event),
    describeUpdateError: (error) => error.message,
    UpdateCheckScheduler: class {
      start() {}
    },
    runScheduledUpdateCheck() {},
    powerMonitor: new EventEmitter(),
    configStore,
    CONFIG_STORE_CLOSED: 'CONFIG_STORE_CLOSED',
    freezePendingWindowBoundsForShutdown() {},
    capturePendingWindowBoundsForShutdown() {},
    profileSyncEngine: {
      pause: () => (syncRunning = false),
      resume: () => {
        syncRunning = true;
        syncRestarts++;
      },
    },
    autoUpdateDownloaded: false,
    quitFinalized: false,
    quitFinalizationStarted: false,
    isQuitting: false,
    QUIT_FINALIZATION_TIMEOUT_MS: 15000,
    setTimeout,
    clearTimeout,
  });
  vm.runInContext(
    `${section('const runSerializedConfigMutation =', 'const runBackgroundConfigMutation =')}
     ${section('async function flushConfigForBoundedExit(', 'function shutDownRuntimeAfterConfigFlush(')}
     ${section("ipcRoutes.handle('quit-and-install'", '// Handle quit request from renderer')}
     ${section('let updateCheckScheduler = null;', '// Anonymous install count')}
     setupAutoUpdates();`,
    context
  );
  updater.emit('update-downloaded', { version: '4.0.1' });
  updater.quitAndInstall = () => {};
  return {
    app,
    nativeUpdater,
    updater,
    context,
    sent,
    removed,
    install: async () => {
      // The download is verified asynchronously before it counts as ready to install.
      await new Promise((resolve) => setImmediate(resolve));
      return handlers['quit-and-install']({});
    },
    mutate: () => vm.runInContext('runSerializedConfigMutation(() => "saved")', context),
    save: () => configStore.apply(null, { origin: 'local' }),
    state: () => ({
      quitFinalized: context.quitFinalized,
      quitFinalizationStarted: context.quitFinalizationStarted,
      isQuitting: context.isQuitting,
      syncRunning,
      syncRestarts,
      configWrites: flushSync.mock.calls.length,
    }),
  };
}

async function expectRecovered(main) {
  expect(main.state()).toMatchObject({
    quitFinalized: false,
    quitFinalizationStarted: false,
    isQuitting: false,
    syncRunning: true,
    syncRestarts: 1,
  });
  await expect(main.mutate()).resolves.toBe('saved');
  // The shutdown flush no longer holds back ordinary writes.
  await expect(main.save()).resolves.toMatchObject({ success: true });
  expect(main.app.listenerCount('before-quit')).toBe(0);
  expect(main.nativeUpdater.listenerCount('before-quit-for-update')).toBe(0);
  expect(main.updater.listenerCount('error')).toBe(1);
}

test('recovers when the real BaseUpdater catches an installer failure and emits it', async () => {
  const main = loadInstall();
  // Keep the dependency's error conversion and quitAndInstall behavior real; replace only
  // the platform installer, which must never launch from a unit test.
  Object.setPrototypeOf(main.updater, BaseUpdater.prototype);
  main.updater._logger = { info() {}, warn() {}, error() {} };
  // The real updater registers its install-on-quit handler with the app it wraps.
  main.updater.app = { onQuit() {} };
  main.updater.downloadedUpdateHelper = {
    file: '/download/update.AppImage',
    downloadedFileInfo: {},
  };
  main.updater.doInstall = () => {
    throw new Error('EACCES: update destination is not writable');
  };
  delete main.updater.quitAndInstall;

  await expect(main.install()).resolves.toEqual({
    success: false,
    error: 'EACCES: update destination is not writable',
  });
  await expectRecovered(main);
  expect(main.sent.at(-1)).toEqual({
    status: 'error',
    error: 'EACCES: update destination is not writable',
  });
});

test('recovers from an updater error after quitAndInstall returns and permits a fresh install', async () => {
  const main = loadInstall();
  await expect(main.install()).resolves.toEqual({ success: true });
  await expect(main.mutate()).rejects.toThrow('shutting down');

  main.updater.emit('error', new Error('Installer spawn failed'));
  await expectRecovered(main);
  main.updater.emit('error', new Error('Later check failed'));
  expect(main.state().syncRestarts).toBe(1);

  main.updater.emit('update-downloaded', { version: '4.0.1' });
  await expect(main.install()).resolves.toEqual({ success: true });
  expect(main.state()).toMatchObject({ configWrites: 2, syncRunning: false });
});

test('retains recovery for an installer that throws', async () => {
  const main = loadInstall();
  main.updater.quitAndInstall = () => {
    throw new Error('Install failed');
  };
  await expect(main.install()).resolves.toEqual({ success: false, error: 'Install failed' });
  await expectRecovered(main);
});

test.each(['before-quit', 'before-quit-for-update'])(
  'does not reopen settings on a late updater error after %s',
  async (event) => {
    const main = loadInstall();
    await main.install();
    (event === 'before-quit' ? main.app : main.nativeUpdater).emit(event);
    main.updater.emit('error', new Error('Late updater error'));
    await expect(main.mutate()).rejects.toThrow('shutting down');
    expect(main.state()).toMatchObject({
      quitFinalized: true,
      syncRunning: false,
      syncRestarts: 0,
    });
    expect(main.updater.listenerCount('error')).toBe(1);
    expect(main.app.listenerCount('before-quit')).toBe(0);
    expect(main.nativeUpdater.listenerCount('before-quit-for-update')).toBe(0);
  }
);

test('does not undo an existing install when a second install request is rejected', async () => {
  const main = loadInstall();
  await main.install();
  await expect(main.install()).resolves.toEqual({
    success: false,
    error: 'An application shutdown is already in progress',
  });
  await expect(main.mutate()).rejects.toThrow('shutting down');
  expect(main.state()).toMatchObject({ quitFinalized: true, syncRunning: false, syncRestarts: 0 });
});

test('does not recover an unrelated shutdown when an updater check fails', async () => {
  const main = loadInstall();
  await vm.runInContext('flushConfigForBoundedExit("quitting")', main.context);
  main.updater.emit('error', new Error('Network unavailable'));
  await expect(main.mutate()).rejects.toThrow('shutting down');
  expect(main.state()).toMatchObject({ isQuitting: true, syncRunning: false, syncRestarts: 0 });
});

describe('checking the downloaded update', () => {
  const FILE = '/cache/pending/update.AppImage';
  const unavailable = () =>
    Object.assign(new Error('Could not fetch SHA256SUMS: ENOTFOUND'), { kind: 'unavailable' });
  const rejected = () => Object.assign(new Error('Not in the signed list'), { kind: 'rejected' });
  const settle = () => new Promise((resolve) => setImmediate(resolve));

  async function loadVerified() {
    const calls = { verify: 0 };
    const behaviour = { verify: async () => 'hash-of-update', hash: 'hash-of-update' };
    const main = loadInstall({
      verify: async (options) => {
        calls.verify++;
        return behaviour.verify(options);
      },
      hashFile: async () => behaviour.hash,
    });
    // loadInstall's own download of 4.0.1 has been checked; count only this test's.
    await settle();
    calls.verify = 0;
    return { main, calls, behaviour };
  }

  test('a later check of the same verified file stays installable without the network', async () => {
    const { main, calls, behaviour } = await loadVerified();
    main.updater.emit('update-downloaded', { version: '4.3.0', downloadedFile: FILE });
    await settle();
    expect(calls.verify).toBe(1);
    expect(main.updater.autoInstallOnAppQuit).toBe(true);

    // "Check for updates" again: the updater hands the cached file over once more, and GitHub
    // cannot be reached this time.
    behaviour.verify = async () => {
      throw unavailable();
    };
    main.updater.emit('update-downloaded', { version: '4.3.0', downloadedFile: FILE });
    await settle();
    expect(calls.verify).toBe(1);
    expect(main.updater.autoInstallOnAppQuit).toBe(true);
    expect(main.sent.at(-1)).toEqual({ status: 'downloaded', info: { version: '4.3.0' } });
    await expect(main.install()).resolves.toEqual({ success: true });
  });

  test('a verified file whose bytes changed is checked again', async () => {
    const { main, calls, behaviour } = await loadVerified();
    main.updater.emit('update-downloaded', { version: '4.3.0', downloadedFile: FILE });
    await settle();

    behaviour.hash = 'something-else';
    behaviour.verify = async () => {
      throw rejected();
    };
    main.updater.emit('update-downloaded', { version: '4.3.0', downloadedFile: FILE });
    await settle();
    expect(calls.verify).toBe(2);
    expect(main.removed).toEqual([FILE]);
    expect(main.updater.autoInstallOnAppQuit).toBe(false);
    await expect(main.install()).resolves.toEqual({
      success: false,
      error: 'No downloaded update is ready to install',
    });
  });

  test('another version is always checked against its own list', async () => {
    const { main, calls } = await loadVerified();
    main.updater.emit('update-downloaded', { version: '4.3.0', downloadedFile: FILE });
    await settle();
    main.updater.emit('update-downloaded', { version: '4.3.1', downloadedFile: FILE });
    await settle();
    expect(calls.verify).toBe(2);
  });

  test('a scheduled check that cannot fetch the list keeps out of the Updates row', async () => {
    const { main, behaviour } = await loadVerified();
    behaviour.verify = async () => {
      throw unavailable();
    };
    // The scheduled check has already returned when its download finishes.
    vm.runInContext('notifyWhenUpdateConfirmed = true', main.context);
    main.updater.emit('update-downloaded', { version: '4.3.0', downloadedFile: FILE });
    await settle();
    expect(main.sent.at(-1)).toMatchObject({ status: 'error', background: true });
    // Kept for the next check to verify.
    expect(main.removed).toEqual([]);

    // A download that fails the check is shown even then.
    behaviour.verify = async () => {
      throw rejected();
    };
    main.updater.emit('update-downloaded', { version: '4.3.0', downloadedFile: FILE });
    await settle();
    expect(main.sent.at(-1)).toEqual({
      status: 'error',
      error: 'The update could not be verified and was not installed.',
    });
    expect(main.removed).toEqual([FILE]);
  });

  test('a check someone asked for shows a list it could not fetch', async () => {
    const { main, behaviour } = await loadVerified();
    behaviour.verify = async () => {
      throw unavailable();
    };
    main.updater.emit('update-downloaded', { version: '4.3.0', downloadedFile: FILE });
    await settle();
    expect(main.sent.at(-1)).toEqual({
      status: 'error',
      error: 'The update could not be verified and was not installed.',
    });
  });
});

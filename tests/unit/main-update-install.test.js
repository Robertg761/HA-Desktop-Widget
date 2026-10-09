/**
 * @jest-environment node
 */

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { EventEmitter } = require('events');
const { BaseUpdater } = require('electron-updater/out/BaseUpdater');
const { createSerializedTaskRunner } = require('../../src/serialized-task-runner.cjs');

const source = fs.readFileSync(path.resolve(__dirname, '../../main.js'), 'utf8');
function section(start, end) {
  const from = source.indexOf(start);
  const to = source.indexOf(end, from);
  if (from < 0 || to < 0) throw new Error(`Missing main.js section: ${start}`);
  return source.slice(from, to);
}

function loadInstall() {
  const app = Object.assign(new EventEmitter(), { isPackaged: true });
  const nativeUpdater = new EventEmitter();
  const updater = new EventEmitter();
  const handlers = {};
  const sent = [];
  let syncRunning = true;
  let syncRestarts = 0;
  let configWrites = 0;
  const context = vm.createContext({
    app,
    require: (name) => {
      if (name !== 'electron') throw new Error(`Unexpected require: ${name}`);
      return { autoUpdater: nativeUpdater };
    },
    ipcMain: { handle: (name, handler) => (handlers[name] = handler) },
    authorizeIpcSender: () => ({ type: 'main' }),
    rejectUnauthorizedIpc: () => ({ success: false }),
    isPortableBuild: () => false,
    supportsAutoUpdater: () => true,
    process: { platform: 'linux', env: { APPIMAGE: '/app.AppImage' } },
    getAutoUpdater: () => updater,
    configureAutoUpdaterChannel: () => {},
    log: { warn() {}, error() {}, transports: { file: {} } },
    sendUpdaterCheckEvent: (event) => sent.push(event),
    sendAutoUpdateToWindow: (event) => sent.push(event),
    describeUpdateError: (error) => error.message,
    UpdateCheckScheduler: class {
      start() {}
    },
    runScheduledUpdateCheck() {},
    powerMonitor: new EventEmitter(),
    createSerializedTaskRunner,
    freezePendingWindowBoundsForShutdown() {},
    capturePendingWindowBoundsForShutdown() {},
    saveConfig: () => true,
    flushPendingConfigWriteSync: () => {
      context.configShutdownPending = true;
      configWrites++;
      return { success: true };
    },
    clearProfileSyncTimers: () => (syncRunning = false),
    setupProfileSyncInterval: () => {
      syncRunning = true;
      syncRestarts++;
    },
    autoUpdateDownloaded: false,
    quitFinalized: false,
    quitFinalizationStarted: false,
    isQuitting: false,
    configShutdownPending: false,
    QUIT_FINALIZATION_TIMEOUT_MS: 15000,
    setTimeout,
    clearTimeout,
  });
  vm.runInContext(
    `${section('let configMutationQueueClosed = false;', 'const runBackgroundConfigMutation =')}
     ${section('async function flushConfigForBoundedExit(', 'function shutDownRuntimeAfterConfigFlush(')}
     ${section("ipcMain.handle('quit-and-install'", '// Handle quit request from renderer')}
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
    install: () => handlers['quit-and-install']({}),
    mutate: () => vm.runInContext('runSerializedConfigMutation(() => "saved")', context),
    state: () => ({
      quitFinalized: context.quitFinalized,
      quitFinalizationStarted: context.quitFinalizationStarted,
      isQuitting: context.isQuitting,
      configShutdownPending: context.configShutdownPending,
      syncRunning,
      syncRestarts,
      configWrites,
    }),
  };
}

async function expectRecovered(main) {
  expect(main.state()).toMatchObject({
    quitFinalized: false,
    quitFinalizationStarted: false,
    isQuitting: false,
    configShutdownPending: false,
    syncRunning: true,
    syncRestarts: 1,
  });
  await expect(main.mutate()).resolves.toBe('saved');
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

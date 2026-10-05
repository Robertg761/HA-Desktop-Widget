/**
 * @jest-environment node
 */

// The update flow in main.js, run against stand-ins for Electron and the updater: what a manual
// check answers with, how the release channel is chosen, what the tray item does, and what runs on
// the app's own schedule.

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const {
  createUpdateAnnouncer,
  UpdateCheckScheduler,
  summarizeUpdateCheck,
} = require('../../src/update-flow.cjs');

const mainSource = fs.readFileSync(path.resolve(__dirname, '../../main.js'), 'utf8');

function sliceBetween(startMarker, endMarker) {
  const start = mainSource.indexOf(startMarker);
  expect(start).toBeGreaterThan(-1);
  const end = mainSource.indexOf(endMarker, start);
  expect(end).toBeGreaterThan(start);
  return mainSource.slice(start, end);
}

const VERSION_HELPERS = sliceBetween(
  'function normalizeVersion(',
  'function generateProfileSyncDeviceId('
);
const CHANNEL_AND_RELEASES = sliceBetween(
  'function getUpdatesConfig()',
  '// Tells the person, once per version'
);
const UPDATE_IPC = sliceBetween('// Updates IPC', "ipcMain.handle('quit-and-install'");
const SCHEDULE = sliceBetween(
  '// Tells the person, once per version',
  'function freezePendingWindowBoundsForShutdown('
);

const GITHUB_RELEASE = (tag, extra = {}) => ({
  tag_name: tag,
  name: tag,
  draft: false,
  prerelease: /-/.test(tag),
  html_url: `https://github.com/Robertg761/HA-Desktop-Widget/releases/tag/${tag}`,
  assets: [],
  ...extra,
});

function loadMain({
  packaged = true,
  portable = false,
  selfUpdating = true,
  currentVersion = '4.0.0',
  savedPrerelease = false,
  releases = [],
  checkResult = {
    isUpdateAvailable: true,
    updateInfo: { version: '4.0.1' },
    downloadPromise: Promise.resolve([]),
    cancellationToken: {},
  },
} = {}) {
  const sent = [];
  const listeners = {};
  const autoUpdater = {
    allowPrerelease: undefined,
    logger: null,
    on: jest.fn((event, handler) => {
      listeners[event] = handler;
    }),
    checkForUpdates: jest.fn(async () => checkResult),
    checkForUpdatesAndNotify: jest.fn(async () => checkResult),
  };
  const fetchUrls = [];
  const notifications = [];
  class FakeNotification {
    constructor(options) {
      this.options = options;
      notifications.push(this);
    }
    static isSupported() {
      return true;
    }
    on(event, handler) {
      this[`on_${event}`] = handler;
    }
    show() {}
  }
  const handlers = {};
  const mainWindow = {
    isDestroyed: () => false,
    webContents: { send: jest.fn((channel, payload) => sent.push([channel, payload])) },
  };
  const powerListeners = {};
  const timers = [];
  const context = vm.createContext({
    // Electron and the process
    app: { isPackaged: packaged, getVersion: () => currentVersion },
    process: { platform: 'darwin', env: {}, arch: 'x64' },
    ipcMain: { handle: (channel, handler) => (handlers[channel] = handler) },
    powerMonitor: { on: (event, handler) => (powerListeners[event] = handler) },
    net: { fetch: jest.fn() },
    ElectronNotification: FakeNotification,
    setTimeout,
    clearTimeout,
    setInterval,
    clearInterval,
    console,
    // This module's collaborators
    log: {
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
      transports: { file: { level: 'warn' } },
    },
    pkg: { homepage: 'https://github.com/Robertg761/HA-Desktop-Widget' },
    config: { updates: { allowPrerelease: savedPrerelease } },
    ensureUpdateConfigDefaults: jest.fn(),
    mainT: (key, vars = {}) =>
      key.replace(/\{\{(\w+)\}\}/g, (_m, name) => vars[name] ?? `{{${name}}}`),
    isPortableBuild: () => portable,
    supportsAutoUpdater: () => selfUpdating,
    getAutoUpdater: () => autoUpdater,
    fetchChecked: jest.fn(async (_fetch, url) => {
      fetchUrls.push(url);
      return { json: async () => releases };
    }),
    mainWindow,
    showMainWindowFromTray: jest.fn(),
    isQuitting: false,
    APP_DISPLAY_NAME: 'HA Desktop Widget',
    summarizeUpdateCheck,
    createUpdateAnnouncer,
    UpdateCheckScheduler,
    setTimers: timers,
  });
  vm.runInContext(
    `let autoUpdateDownloaded = false;
     ${VERSION_HELPERS}
     ${CHANNEL_AND_RELEASES}
     ${UPDATE_IPC}
     ${SCHEDULE}`,
    context
  );
  return {
    context,
    autoUpdater,
    listeners,
    sent,
    fetchUrls,
    notifications,
    handlers,
    powerListeners,
    mainWindow,
    run: (code) => vm.runInContext(code, context),
    ipcCheck: (options) => handlers['check-for-updates']({ sender: {} }, options),
  };
}

// The IPC handler authorizes its sender with a function defined elsewhere in main.js.
function withAuthorizedSender(main) {
  main.context.authorizeIpcSender = jest.fn(() => ({ type: 'main' }));
  main.context.rejectUnauthorizedIpc = jest.fn(() => ({ success: false }));
  return main;
}

describe('the update check in main', () => {
  describe('the IPC answer', () => {
    it('is plain data when a self-updating build finds an update, the way the window needs it', async () => {
      const main = withAuthorizedSender(loadMain());

      const answer = await main.ipcCheck();

      expect(answer).toEqual({ status: 'checking', version: '4.0.1' });
      // The raw result carries a Promise and a token, which cannot cross to the window.
      expect(() => structuredClone(answer)).not.toThrow();
    });

    it('says an updater that is switched off is an error, not a check that began', async () => {
      const main = withAuthorizedSender(loadMain({ checkResult: null }));

      const answer = await main.ipcCheck();

      expect(answer).toEqual({
        status: 'error',
        error: 'Update information is not available for this version yet. Try again later.',
      });
    });

    it('turns a failing updater into an error answer', async () => {
      const main = withAuthorizedSender(loadMain());
      main.autoUpdater.checkForUpdates.mockRejectedValue(
        new Error('net::ERR_INTERNET_DISCONNECTED')
      );

      const answer = await main.ipcCheck();

      expect(answer.status).toBe('error');
      expect(answer.error).toBe(
        'Could not reach GitHub to check for updates. Check your internet connection.'
      );
    });

    it('is "dev" for an app that is not packaged', async () => {
      const main = withAuthorizedSender(loadMain({ packaged: false }));

      expect(await main.ipcCheck()).toEqual({ status: 'dev' });
      expect(main.autoUpdater.checkForUpdates).not.toHaveBeenCalled();
    });

    it('does not run for a window main does not trust', async () => {
      const main = loadMain();
      main.context.authorizeIpcSender = jest.fn(() => null);
      main.context.rejectUnauthorizedIpc = jest.fn(() => ({ success: false, error: 'no' }));

      expect(await main.ipcCheck()).toEqual({ success: false, error: 'no' });
      expect(main.autoUpdater.checkForUpdates).not.toHaveBeenCalled();
    });
  });

  describe('the release channel', () => {
    it('follows the switch as the window shows it, saved or not', async () => {
      const main = withAuthorizedSender(loadMain({ savedPrerelease: false }));

      await main.ipcCheck({ allowPrerelease: true });
      expect(main.autoUpdater.allowPrerelease).toBe(true);

      await main.ipcCheck({ allowPrerelease: false });
      expect(main.autoUpdater.allowPrerelease).toBe(false);
    });

    it('falls back to the saved setting when the window says nothing, or says something odd', async () => {
      const main = withAuthorizedSender(loadMain({ savedPrerelease: true }));

      await main.ipcCheck();
      expect(main.autoUpdater.allowPrerelease).toBe(true);
      await main.ipcCheck({ allowPrerelease: 'yes' });
      expect(main.autoUpdater.allowPrerelease).toBe(true);
      await main.ipcCheck({});
      expect(main.autoUpdater.allowPrerelease).toBe(true);
    });

    it('asks GitHub for prereleases too when the switch is on, in a build that cannot update itself', async () => {
      const beta = GITHUB_RELEASE('v4.1.0-beta.1');
      const main = withAuthorizedSender(
        loadMain({ selfUpdating: false, savedPrerelease: false, releases: [beta] })
      );

      const answer = await main.ipcCheck({ allowPrerelease: true });

      expect(main.fetchUrls).toEqual([
        'https://api.github.com/repos/Robertg761/HA-Desktop-Widget/releases?per_page=20',
      ]);
      expect(answer).toMatchObject({ status: 'manual', version: '4.1.0-beta.1' });
    });

    it('does not offer a beta to someone whose switch is off, even if it was saved on', async () => {
      const main = withAuthorizedSender(
        loadMain({
          selfUpdating: false,
          savedPrerelease: true,
          releases: [GITHUB_RELEASE('v4.0.0')],
        })
      );

      const answer = await main.ipcCheck({ allowPrerelease: false });

      expect(main.fetchUrls[0]).toContain('/releases/latest');
      expect(answer.status).toBe('none');
    });

    it('does the same for the Portable build', async () => {
      const main = withAuthorizedSender(
        loadMain({
          portable: true,
          selfUpdating: false,
          releases: [
            GITHUB_RELEASE('v4.0.1', {
              assets: [
                {
                  name: 'HA-Desktop-Widget-4.0.1-win-x64-Portable.exe',
                  browser_download_url: 'https://example.test/portable.exe',
                },
              ],
            }),
          ],
        })
      );

      const answer = await main.ipcCheck({ allowPrerelease: false });

      expect(answer).toMatchObject({
        status: 'portable',
        version: '4.0.1',
        downloadUrl: 'https://example.test/portable.exe',
      });
    });
  });

  describe('Check for Updates in the tray', () => {
    it('shows the window on the Updates row and says a check is running, before the answer', async () => {
      const main = loadMain({ selfUpdating: false, releases: [GITHUB_RELEASE('v4.0.1')] });

      const running = main.run('runTrayUpdateCheck()');

      expect(main.context.showMainWindowFromTray).toHaveBeenCalledTimes(1);
      expect(main.sent[0]).toEqual(['auto-update', { status: 'checking', reveal: true }]);
      await running;
    });

    it('sends the outcome of a build that cannot update itself', async () => {
      const main = loadMain({ selfUpdating: false, releases: [GITHUB_RELEASE('v4.0.1')] });

      await main.run('runTrayUpdateCheck()');

      expect(main.sent.at(-1)[1]).toMatchObject({
        status: 'manual',
        version: '4.0.1',
        downloadUrl: 'https://github.com/Robertg761/HA-Desktop-Widget/releases/tag/v4.0.1',
      });
    });

    it('tells the window it is up to date when it is', async () => {
      const main = loadMain({ selfUpdating: false, releases: [] });

      await main.run('runTrayUpdateCheck()');

      expect(main.sent.at(-1)[1]).toMatchObject({ status: 'none' });
    });

    it("leaves the answer to the updater's own events in a self-updating build", async () => {
      const main = loadMain({ selfUpdating: true });

      await main.run('runTrayUpdateCheck()');

      // Only the "checking" that opened the row: "available", "none" or "error" come as events.
      expect(main.sent.map(([, payload]) => payload.status)).toEqual(['checking']);
    });

    it('says why nothing was checked in an app that is not packaged', async () => {
      const main = loadMain({ packaged: false });

      await main.run('runTrayUpdateCheck()');

      expect(main.sent.at(-1)[1]).toEqual({ status: 'dev' });
    });

    it('survives a window that has gone', async () => {
      const main = loadMain({ selfUpdating: false });
      main.context.mainWindow = null;

      await expect(main.run('runTrayUpdateCheck()')).resolves.toBeUndefined();
    });
  });

  describe('setting up the checks', () => {
    it('does nothing for an app that is not packaged', () => {
      const main = loadMain({ packaged: false });

      main.run('setupAutoUpdates()');

      expect(main.autoUpdater.on).not.toHaveBeenCalled();
      expect(main.run('updateCheckScheduler')).toBeNull();
    });

    it.each([
      ['a self-updating build', { selfUpdating: true }],
      ['a build that cannot update itself (macOS, deb, Arch)', { selfUpdating: false }],
      ['the Windows Portable build', { portable: true, selfUpdating: false }],
    ])('schedules checks for %s', (_label, options) => {
      const main = loadMain(options);

      main.run('setupAutoUpdates()');

      expect(main.run('updateCheckScheduler')).not.toBeNull();
      expect(typeof main.powerListeners.resume).toBe('function');
      main.run('updateCheckScheduler.stop()');
    });

    it('only a self-updating build listens to the updater, and sends the window plain data', () => {
      const own = loadMain({ selfUpdating: true });
      own.run('setupAutoUpdates()');
      const manual = loadMain({ selfUpdating: false });
      manual.run('setupAutoUpdates()');
      own.run('updateCheckScheduler.stop()');
      manual.run('updateCheckScheduler.stop()');

      expect(manual.autoUpdater.on).not.toHaveBeenCalled();
      own.listeners['update-available']({
        version: '4.0.1',
        files: [{ url: 'a' }],
        releaseNotes: 'long text',
      });
      own.listeners['download-progress']({ percent: 40, bytesPerSecond: 99, transferred: 5 });
      own.listeners['update-downloaded']({ version: '4.0.1', files: [] });
      own.listeners['update-not-available']({ version: '4.0.0' });

      expect(own.sent).toEqual([
        ['auto-update', { status: 'available', info: { version: '4.0.1' } }],
        ['auto-update', { status: 'downloading', progress: { percent: 40 } }],
        ['auto-update', { status: 'downloaded', info: { version: '4.0.1' } }],
        ['auto-update', { status: 'none' }],
      ]);
    });

    it('turns an updater error into a short line for the window', () => {
      const main = loadMain({ selfUpdating: true });
      main.run('setupAutoUpdates()');
      main.run('updateCheckScheduler.stop()');

      main.listeners.error(new Error('Cannot find latest.yml in the latest release'));

      expect(main.sent.at(-1)[1]).toEqual({
        status: 'error',
        error: 'Update information is not available for this version yet. Try again later.',
      });
    });
  });

  describe("a check on the app's own schedule", () => {
    it("fetches and announces an update in a self-updating build, under the app's real name", async () => {
      const main = loadMain({ selfUpdating: true });

      await main.run('runScheduledUpdateCheck()');

      expect(main.autoUpdater.checkForUpdatesAndNotify).toHaveBeenCalledTimes(1);
      const notice = main.autoUpdater.checkForUpdatesAndNotify.mock.calls[0][0];
      expect(notice.title).toBe('A new update is ready to install');
      // electron-updater would fill {appName} from the package name, "home-assistant-widget".
      expect(notice.body).toBe(
        'HA Desktop Widget version {version} has been downloaded and will be automatically installed on exit'
      );
    });

    it('does not fetch again an update that is already waiting to be installed', async () => {
      const main = loadMain({ selfUpdating: true });
      main.run('autoUpdateDownloaded = true');

      await main.run('runScheduledUpdateCheck()');

      expect(main.autoUpdater.checkForUpdatesAndNotify).not.toHaveBeenCalled();
    });

    it('does not check while the app is quitting', async () => {
      const main = loadMain({ selfUpdating: true });
      main.context.isQuitting = true;

      await main.run('runScheduledUpdateCheck()');

      expect(main.autoUpdater.checkForUpdatesAndNotify).not.toHaveBeenCalled();
    });

    it('tells a macOS or deb user about a newer release, once, and puts it in the window', async () => {
      const main = loadMain({ selfUpdating: false, releases: [GITHUB_RELEASE('v4.0.1')] });

      await main.run('runScheduledUpdateCheck()');
      await main.run('runScheduledUpdateCheck()');

      expect(main.notifications).toHaveLength(1);
      expect(main.notifications[0].options.body).toBe(
        'Version 4.0.1 is available. Open Settings > Advanced to download it.'
      );
      expect(main.sent.filter(([, payload]) => payload.status === 'manual')).toHaveLength(2);
    });

    it('opens the Updates row when that notification is clicked', async () => {
      const main = loadMain({ selfUpdating: false, releases: [GITHUB_RELEASE('v4.0.1')] });
      await main.run('runScheduledUpdateCheck()');
      main.sent.length = 0;

      main.notifications[0].on_click();

      expect(main.context.showMainWindowFromTray).toHaveBeenCalled();
      expect(main.sent[0][1]).toMatchObject({ status: 'manual', version: '4.0.1', reveal: true });
    });

    it("marks the updater's start and failure as background while its own check runs", async () => {
      const main = loadMain({ selfUpdating: true });
      main.run('setupAutoUpdates()');
      let during;
      main.autoUpdater.checkForUpdatesAndNotify.mockImplementation(async () => {
        main.listeners['checking-for-update']();
        main.listeners.error(new Error('getaddrinfo ENOTFOUND github.com'));
        during = main.sent.map(([, payload]) => payload);
        throw new Error('offline');
      });

      await expect(main.run('runScheduledUpdateCheck()')).rejects.toThrow('offline');

      expect(during).toEqual([
        { status: 'checking', background: true },
        { status: 'error', error: expect.any(String), background: true },
      ]);
      // What follows is not marked: a download that fails later is news.
      main.sent.length = 0;
      main.listeners.error(new Error('Disk full'));
      expect(main.sent[0][1].background).toBeUndefined();
    });

    // The Updates row is a live region: a six-hourly "You are up to date!" there was read out to
    // whoever had Settings open.
    it('marks "nothing new" from its own check as background too, and not from a requested one', async () => {
      const main = withAuthorizedSender(loadMain({ selfUpdating: true }));
      main.run('setupAutoUpdates()');
      main.autoUpdater.checkForUpdatesAndNotify.mockImplementation(async () => {
        main.listeners['update-not-available']({ version: '4.0.0' });
      });

      await main.run('runScheduledUpdateCheck()');
      expect(main.sent.at(-1)[1]).toEqual({ status: 'none', background: true });

      main.autoUpdater.checkForUpdates.mockImplementation(async () => {
        main.listeners['update-not-available']({ version: '4.0.0' });
        return { updateInfo: { version: '4.0.0' } };
      });
      await main.ipcCheck();
      expect(
        main.sent.find(([, payload]) => payload.status === 'none' && !payload.background)
      ).toBeTruthy();
    });

    it("does not start its own check while someone's is running, and does not mark theirs", async () => {
      const main = withAuthorizedSender(loadMain({ selfUpdating: true }));
      main.run('setupAutoUpdates()');
      let release;
      main.autoUpdater.checkForUpdates.mockImplementation(
        () =>
          new Promise((resolve) => {
            release = () => resolve({ updateInfo: { version: '4.0.1' } });
          })
      );

      const manual = main.ipcCheck();
      await main.run('runScheduledUpdateCheck()');
      main.listeners.error(new Error('offline'));
      release();
      await manual;

      expect(main.autoUpdater.checkForUpdatesAndNotify).not.toHaveBeenCalled();
      expect(main.sent.at(-1)[1].background).toBeUndefined();
    });

    it('lets a manual check take over the events of a scheduled one that is still running', async () => {
      const main = withAuthorizedSender(loadMain({ selfUpdating: true }));
      main.run('setupAutoUpdates()');
      let finishScheduled;
      main.autoUpdater.checkForUpdatesAndNotify.mockImplementation(
        () =>
          new Promise((resolve) => {
            finishScheduled = resolve;
          })
      );

      const scheduled = main.run('runScheduledUpdateCheck()');
      await main.ipcCheck();
      main.listeners.error(new Error('offline'));
      finishScheduled();
      await scheduled;

      // The person pressed Check while the app's own was running: they see its failure.
      expect(main.sent.at(-1)[1]).toMatchObject({ status: 'error' });
      expect(main.sent.at(-1)[1].background).toBeUndefined();
    });

    it('is silent when there is nothing new, or when the lookup fails', async () => {
      const upToDate = loadMain({ selfUpdating: false, releases: [] });
      await upToDate.run('runScheduledUpdateCheck()');
      expect(upToDate.sent).toEqual([]);
      expect(upToDate.notifications).toHaveLength(0);

      const offline = loadMain({ selfUpdating: false });
      offline.context.fetchChecked = jest.fn().mockRejectedValue(new Error('ENOTFOUND'));
      await offline.run('runScheduledUpdateCheck()');
      expect(offline.sent).toEqual([]);
      expect(offline.notifications).toHaveLength(0);
    });

    it('checks the Portable build against its own assets', async () => {
      const main = loadMain({
        portable: true,
        selfUpdating: false,
        releases: [
          GITHUB_RELEASE('v4.0.1', {
            assets: [
              { name: 'App-4.0.1-win-x64-Portable.exe', browser_download_url: 'https://x.test/p' },
            ],
          }),
        ],
      });

      await main.run('runScheduledUpdateCheck()');

      expect(main.sent.at(-1)[1]).toMatchObject({
        status: 'portable',
        downloadUrl: 'https://x.test/p',
      });
      expect(main.notifications).toHaveLength(1);
    });
  });
});

describe('the app name', () => {
  it('is HA Desktop Widget wherever the app names itself, and never the package name', () => {
    expect(mainSource).toContain("const APP_DISPLAY_NAME = 'HA Desktop Widget';");
    expect(mainSource).not.toMatch(/appName:\s*app\.getName\(\)/);
    // The four Linux startup helpers, and the download notification.
    expect(mainSource.match(/appName:\s*APP_DISPLAY_NAME/g)).toHaveLength(5);
    expect(mainSource).toContain('tray.setToolTip(APP_DISPLAY_NAME)');
  });

  it('does not rename the autostart file, which would orphan every existing one', () => {
    const pkg = require('../../package.json');
    const {
      buildLinuxAutostartDesktopEntry,
      getLinuxAutostartFilePath,
    } = require('../../src/linux-startup.cjs');
    const env = { HOME: path.join(require('os').tmpdir(), 'update-flow-home') };

    expect(getLinuxAutostartFilePath(pkg, 'HA Desktop Widget', env)).toBe(
      getLinuxAutostartFilePath(pkg, 'home-assistant-widget', env)
    );
    expect(path.basename(getLinuxAutostartFilePath(pkg, 'HA Desktop Widget', env))).toBe(
      `${pkg.appId}.desktop`
    );
    const entry = buildLinuxAutostartDesktopEntry({
      appName: 'HA Desktop Widget',
      executablePath: '/opt/ha/ha-widget',
    });
    expect(entry).toContain('Name=HA Desktop Widget\n');
    expect(entry).toContain('Comment=Launch HA Desktop Widget at login\n');
    expect(entry).not.toContain('home-assistant-widget');
  });

  it('is the name the installer, the window and the shortcut all use', () => {
    const builder = fs.readFileSync(path.resolve(__dirname, '../../electron-builder.yml'), 'utf8');

    expect(builder).toMatch(/^productName: HA Desktop Widget$/m);
    // A shortcut name of its own made the Start-menu entry differ from the installed app. With none,
    // the Desktop and Start menu shortcuts are named for productName, and the installer renames the
    // ones an older install made.
    expect(builder).not.toMatch(/^\s*shortcutName:/m);
  });

  it('is the title the main window has, which the packaged-app scripts look for', () => {
    const html = fs.readFileSync(path.resolve(__dirname, '../../index.html'), 'utf8');
    const script = fs.readFileSync(
      path.resolve(__dirname, '../../scripts/verify-wayland.cjs'),
      'utf8'
    );

    expect(html).toContain('<title>HA Desktop Widget</title>');
    // The packaged-compositor check finds the main window by this title; the old product name
    // matched no window once index.html was renamed.
    expect(script).toContain("item.title === 'HA Desktop Widget'");
    expect(script).not.toContain('Home Assistant Widget');
  });
});

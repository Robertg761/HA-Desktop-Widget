#!/usr/bin/env node
/**
 * Visual snapshots of the real app on the current OS.
 *
 * Starts a mock Home Assistant, launches the unpacked app (`electron .`) against a throwaway
 * profile, drives it over the Chrome DevTools Protocol, and saves two PNGs per scene:
 *   <scene>-page.png    the web contents;
 *   <scene>-screen.png  that area of the real screen, including what the OS draws behind and
 *                       around the window (Windows acrylic, macOS vibrancy, shadows, fonts).
 * The screen capture is best effort: if the OS refuses (permissions, no display), the page
 * capture still lands and the run continues. The scenes live in scenes.cjs; a scene that fails
 * is reported and skipped, and the run exits non-zero once the others are done.
 *
 * Usage: npm run build:renderer && node scripts/visual-snapshots/run.cjs [outDir]
 * Needs Node 22+ (global WebSocket). On Linux run it under xvfb-run.
 *
 * Environment:
 *   SNAPSHOT_DEBUG_PORT   the app's remote debugging port (default 9333); give parallel runs on
 *                         one machine different ports
 *   SNAPSHOT_SCENES       only run scenes whose name matches this regular expression
 *   SNAPSHOT_REDUCED_MOTION  set to 1 to run with the OS's reduced-motion setting on, as the
 *                         Windows and macOS runners do
 */

const { spawn, execFileSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { startMockHomeAssistant } = require('./mock-home-assistant.cjs');
const {
  FAILING_ENTITIES,
  RESET_SETTINGS_VIEW,
  RESETTABLE_SETTINGS,
  TOKEN,
  WINDOW_POSITION,
  WINDOW_SIZE,
  buildConfig,
  buildHistories,
  buildServiceResponses,
  buildServices,
  buildStates,
  buildSubscriptionEvents,
} = require('./fixture.cjs');
const { scenes } = require('./scenes.cjs');

const ROOT = path.resolve(__dirname, '..', '..');
const OUT_DIR = path.resolve(process.argv[2] || path.join(ROOT, 'visual-snapshots'));
const DEBUG_PORT = Number(process.env.SNAPSHOT_DEBUG_PORT) || 9333;
const SCENE_FILTER = process.env.SNAPSHOT_SCENES ? new RegExp(process.env.SNAPSHOT_SCENES) : null;
const SCREEN_MARGIN = 32;
// CDP's modifier bit for Ctrl in Input.dispatchKeyEvent.
const CTRL = 2;
// Language packs are not bundled (except German); scenes in these languages need the repo's pack
// installed in the profile, which is also the version a PR is changing.
const INSTALLED_PACKS = ['ar', 'es', 'fr', 'hi', 'zh'];

// A light, warm Omarchy palette (colors.toml): nothing like the dark default, so a scene can tell
// the palette's mode, colours and borders from the app's own.
const OMARCHY_PALETTE = [
  'background = "#f4efe4"',
  'foreground = "#2b2418"',
  'accent = "#c2410c"',
  'selection_background = "#e3d2ad"',
  'light_foreground = "#2b2418"',
  '',
].join('\n');

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function waitFor(check, { timeoutMs = 30000, intervalMs = 250, label = 'condition' } = {}) {
  const deadline = Date.now() + timeoutMs;
  let lastError = null;
  while (Date.now() < deadline) {
    try {
      const value = await check();
      if (value) return value;
    } catch (error) {
      lastError = error;
    }
    await sleep(intervalMs);
  }
  throw new Error(`Timed out waiting for ${label}${lastError ? `: ${lastError.message}` : ''}`);
}

/** Minimal CDP client over Node's global WebSocket. */
async function connectCdp(webSocketUrl) {
  const socket = new WebSocket(webSocketUrl);
  await new Promise((resolve, reject) => {
    socket.addEventListener('open', resolve, { once: true });
    socket.addEventListener('error', reject, { once: true });
  });
  let nextId = 1;
  const pending = new Map();
  socket.addEventListener('message', (event) => {
    const message = JSON.parse(event.data);
    const waiter = pending.get(message.id);
    if (!waiter) return;
    pending.delete(message.id);
    if (message.error) waiter.reject(new Error(message.error.message));
    else waiter.resolve(message.result);
  });
  const send = (method, params = {}) =>
    new Promise((resolve, reject) => {
      const id = nextId++;
      pending.set(id, { resolve, reject });
      socket.send(JSON.stringify({ id, method, params }));
    });
  const evaluate = async (expression) => {
    const { result, exceptionDetails } = await send('Runtime.evaluate', {
      expression,
      awaitPromise: true,
      returnByValue: true,
    });
    if (exceptionDetails) {
      throw new Error(exceptionDetails.exception?.description || exceptionDetails.text);
    }
    return result.value;
  };
  return { send, evaluate, close: () => socket.close() };
}

/** Grab a rectangle of the real screen with the platform's own tool. */
function captureScreen(file, { left, top, width, height }) {
  const x = Math.max(0, Math.round(left - SCREEN_MARGIN));
  const y = Math.max(0, Math.round(top - SCREEN_MARGIN));
  const w = Math.round(width + SCREEN_MARGIN * 2);
  const h = Math.round(height + SCREEN_MARGIN * 2);
  try {
    if (process.platform === 'darwin') {
      execFileSync('screencapture', ['-x', '-R', `${x},${y},${w},${h}`, file]);
    } else if (process.platform === 'win32') {
      const script = [
        'Add-Type -AssemblyName System.Drawing',
        `$bmp = New-Object System.Drawing.Bitmap ${w}, ${h}`,
        '$g = [System.Drawing.Graphics]::FromImage($bmp)',
        `$g.CopyFromScreen(${x}, ${y}, 0, 0, $bmp.Size)`,
        `$bmp.Save('${file.replace(/'/g, "''")}', [System.Drawing.Imaging.ImageFormat]::Png)`,
      ].join('; ');
      execFileSync('powershell', ['-NoProfile', '-NonInteractive', '-Command', script]);
    } else {
      execFileSync('import', ['-window', 'root', '-crop', `${w}x${h}+${x}+${y}`, file]);
    }
    return true;
  } catch (error) {
    console.warn(`Screen capture failed (${path.basename(file)}): ${error.message}`);
    return false;
  }
}

// Toasts last up to 20 s, and Linux runners without a keyring raise two at start-up, so one
// would otherwise sit in every scene that follows the action that raised it.
const REMOVE_TOASTS = `document.querySelectorAll('#toast-container .toast').forEach((toast) => toast.remove())`;

const OPEN_DIALOGS = `[...document.querySelectorAll('.modal, .command-palette-overlay')].filter((element) =>
  !element.classList.contains('hidden') &&
  !element.classList.contains('modal-closing') &&
  element.getClientRects().length > 0
).length`;

const CLICK_DIALOG_CLOSE = `(() => {
  const dialogs = [...document.querySelectorAll('.modal, .command-palette-overlay')].filter((element) =>
    !element.classList.contains('hidden') &&
    !element.classList.contains('modal-closing') &&
    element.getClientRects().length > 0
  );
  const top = dialogs[dialogs.length - 1];
  if (!top) return false;
  const button = top.querySelector('.close-btn, [id^="close-"], [id$="-cancel"], .btn-secondary');
  if (button) button.click();
  else top.remove();
  return true;
})()`;

function installLocalePacks(profileDir) {
  const installed = path.join(profileDir, 'locales');
  fs.mkdirSync(installed, { recursive: true });
  for (const locale of INSTALLED_PACKS) {
    fs.copyFileSync(
      path.join(ROOT, 'locale-packs', `${locale}.json`),
      path.join(installed, `${locale}.json`)
    );
  }
}

async function listTargets() {
  const response = await fetch(`http://127.0.0.1:${DEBUG_PORT}/json/list`);
  return response.json();
}

async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const platformTag = { darwin: 'macos', win32: 'windows' }[process.platform] || 'linux';
  const selected = scenes.filter((scene) => !SCENE_FILTER || SCENE_FILTER.test(scene.name));
  if (!selected.length) throw new Error(`No scene matches ${SCENE_FILTER}`);

  const server = await startMockHomeAssistant({
    token: TOKEN,
    states: buildStates(),
    services: buildServices(),
    serviceResponses: buildServiceResponses(),
    histories: buildHistories(),
    failingEntities: FAILING_ENTITIES,
  });
  const haUrl = `http://127.0.0.1:${server.address().port}`;
  const baseConfig = buildConfig(haUrl);
  const profileDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ha-widget-snapshot-'));
  fs.writeFileSync(path.join(profileDir, 'config.json'), JSON.stringify(baseConfig, null, 2));
  installLocalePacks(profileDir);

  const electron = require('electron');
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  // Where a scene with an Omarchy palette stages one (see prepare). On Linux the app reads the
  // active theme from its state directory, so this one moves into the throwaway profile instead of
  // reaching for the real home.
  const stateHome = path.join(profileDir, 'state');
  const paletteFile = path.join(stateHome, 'omarchy', 'current', 'theme', 'colors.toml');
  env.XDG_STATE_HOME = stateHome;
  const app = spawn(
    electron,
    [
      '.',
      `--user-data-dir=${profileDir}`,
      `--remote-debugging-port=${DEBUG_PORT}`,
      ...(process.env.SNAPSHOT_REDUCED_MOTION === '1' ? ['--force-prefers-reduced-motion'] : []),
    ],
    { cwd: ROOT, env, stdio: 'inherit' }
  );

  let cdp = null;
  const failures = [];
  try {
    const target = await waitFor(
      async () =>
        (await listTargets()).find(
          (entry) => entry.type === 'page' && /index\.html(?!.*mode=desktop-pin)/.test(entry.url)
        ),
      { label: 'the main window' }
    );
    cdp = await connectCdp(target.webSocketDebuggerUrl);
    // Without a window manager nothing is focused; popups and the palette act on focus.
    await cdp.send('Emulation.setFocusEmulationEnabled', { enabled: true }).catch(() => {});
    await waitFor(
      () => cdp.evaluate(`document.querySelectorAll('#quick-controls .control-item').length > 3`),
      { label: 'Quick Access tiles', timeoutMs: 45000 }
    );
    // Let fonts, the weather icon and the media artwork settle.
    await sleep(1500);

    // What each scene is measured against: the fixture's own settings and window.
    const settingsToReset = RESETTABLE_SETTINGS;
    function sceneSettings(scene) {
      const settings = Object.fromEntries(settingsToReset.map((key) => [key, baseConfig[key]]));
      return { ...settings, ...scene.config, ui: { ...baseConfig.ui, ...scene.ui } };
    }

    let applied = {
      settings: JSON.stringify(sceneSettings({})),
      media: '[]',
      size: WINDOW_SIZE,
      palette: false,
    };

    const openPins = [];
    const extraTargets = [];
    let offline = false;
    let notificationsPushed = false;
    const NOTIFICATIONS = 'persistent_notification/subscribe';
    const ctx = {
      CTRL,
      sleep,
      ev: (expression) => cdp.evaluate(expression),
      /**
       * Give the app the persistent notifications the fixture lists, as Home Assistant would send
       * them to its open subscription. They are not there from the start, because their bell
       * would sit in the header of every scene; `restore` takes them away again.
       */
      showNotifications() {
        notificationsPushed = true;
        server.pushEvents(NOTIFICATIONS, buildSubscriptionEvents()({ type: NOTIFICATIONS }));
      },
      async click(selector) {
        const found = await cdp.evaluate(
          `(() => { const el = document.querySelector(${JSON.stringify(selector)}); if (el) el.click(); return !!el; })()`
        );
        if (!found) throw new Error(`Nothing matches ${selector}`);
      },
      waitForSelector: (selector) =>
        waitFor(() => cdp.evaluate(`!!document.querySelector(${JSON.stringify(selector)})`), {
          label: selector,
          timeoutMs: 10000,
        }),
      /** Fail the scene unless a page expression is truthy right now (a layout check). */
      async expect(expression, label) {
        if (!(await cdp.evaluate(`!!(${expression})`)))
          throw new Error(`Layout check failed: ${label}`);
      },
      /** Take Home Assistant away, as an outage does; the runner brings it back after the scene. */
      async goOffline() {
        offline = true;
        server.refuseConnections(true);
        await waitFor(() => cdp.evaluate(`document.body.classList.contains('ha-offline')`), {
          label: 'the app to notice the outage',
          timeoutMs: 15000,
        });
        await sleep(500);
      },
      /** Wait until a page expression is truthy. */
      waitForExpression: (expression, label = expression) =>
        waitFor(() => cdp.evaluate(`!!(${expression})`), { label, timeoutMs: 10000 }),
      async pressKey(key, { code = key, keyCode = 0, modifiers = 0, text } = {}) {
        const event = {
          key,
          code,
          windowsVirtualKeyCode: keyCode,
          nativeVirtualKeyCode: keyCode,
          modifiers,
        };
        await cdp.send('Input.dispatchKeyEvent', {
          type: text ? 'keyDown' : 'rawKeyDown',
          ...event,
          ...(text ? { text } : {}),
        });
        await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', ...event });
      },
      insertText: (text) => cdp.send('Input.insertText', { text }),
      /** Pin an entity to the desktop and return the CDP client of its window. */
      async openPin(entityId) {
        const result = await cdp.evaluate(
          `window.electronAPI.pinEntityToDesktop(${JSON.stringify(entityId)})`
        );
        if (!result?.success) throw new Error(`Pinning ${entityId} failed: ${result?.error}`);
        openPins.push(entityId);
        const pinTarget = await waitFor(
          async () =>
            (await listTargets()).find(
              (entry) =>
                entry.type === 'page' &&
                entry.url.includes('mode=desktop-pin') &&
                decodeURIComponent(entry.url).includes(`entityId=${entityId}`)
            ),
          { label: `the ${entityId} pin window` }
        );
        // A new pin opens over the main window; move it to the free space on the right so the
        // screen capture shows the pin on its own. Bounds can only change in edit mode.
        const [x, y] = [WINDOW_POSITION.x + WINDOW_SIZE.width + 24, WINDOW_POSITION.y];
        await cdp.evaluate(`(async () => {
          await window.electronAPI.setDesktopPinEditMode(true);
          await window.electronAPI.updateDesktopPinBounds(${JSON.stringify(entityId)}, { x: ${x}, y: ${y} });
          await window.electronAPI.setDesktopPinEditMode(false);
        })()`);
        const pin = await connectCdp(pinTarget.webSocketDebuggerUrl);
        extraTargets.push(pin);
        // Emulation belongs to one page, so a pin window needs the scene's media features too.
        const features = JSON.parse(applied.media);
        if (features.length) await pin.send('Emulation.setEmulatedMedia', { features });
        await waitFor(() => pin.evaluate(`!!document.querySelector('.desktop-pin-shell')`), {
          label: `the ${entityId} pin content`,
        });
        await sleep(900);
        return pin;
      },
    };

    async function closeDialogs() {
      for (let attempt = 0; attempt < 8 && (await cdp.evaluate(OPEN_DIALOGS)) > 0; attempt += 1) {
        // Escape closes most of them; the rest have a Cancel or Close button.
        await ctx.pressKey('Escape', { code: 'Escape', keyCode: 27 });
        await sleep(550);
        if ((await cdp.evaluate(OPEN_DIALOGS)) === 0) break;
        await cdp.evaluate(CLICK_DIALOG_CLOSE);
        await sleep(550);
      }
      if (await cdp.evaluate(`!!document.querySelector('#quick-controls.reorganize-mode')`)) {
        await ctx.click('#reorganize-quick-controls-btn');
        await sleep(400);
      }
    }

    async function restore() {
      if (notificationsPushed) {
        notificationsPushed = false;
        server.pushEvents(NOTIFICATIONS, [{ type: 'current', notifications: {} }]);
      }
      if (offline) {
        // Retry connects at once; waiting for the app's own backoff would run into the next scene.
        offline = false;
        server.refuseConnections(false);
        await cdp.evaluate(`document.querySelector('#widget-state-panel .btn-secondary')?.click()`);
        await waitFor(() => cdp.evaluate(`!document.body.classList.contains('ha-offline')`), {
          label: 'the app to reconnect',
          timeoutMs: 20000,
        });
        await sleep(600);
      }
      for (const pin of extraTargets.splice(0)) pin.close();
      for (const entityId of openPins.splice(0)) {
        await cdp.evaluate(
          `window.electronAPI.unpinEntityFromDesktop(${JSON.stringify(entityId)})`
        );
        await sleep(400);
      }
      // Before the dialogs close: Settings keeps the scroll position it is closed at.
      await cdp.evaluate(RESET_SETTINGS_VIEW);
      await closeDialogs();
    }

    async function prepare(scene) {
      // An Omarchy palette exists only for the scenes that ask for one: it adds the Follow Omarchy
      // row to Settings, which no other scene should show. The app notices a changed theme file
      // within a poll (1.5 s).
      const wantsPalette = scene.omarchyPalette === true && process.platform === 'linux';
      if (wantsPalette !== applied.palette) {
        if (wantsPalette) {
          fs.mkdirSync(path.dirname(paletteFile), { recursive: true });
          fs.writeFileSync(paletteFile, OMARCHY_PALETTE);
        } else {
          fs.rmSync(paletteFile, { force: true });
        }
        await sleep(2300);
        applied.palette = wantsPalette;
      }
      const settings = sceneSettings(scene);
      const key = JSON.stringify(settings);
      const settingsChanged = key !== applied.settings;
      if (settingsChanged) {
        await cdp.evaluate(`(async () => {
          const patch = ${key};
          const cfg = await window.electronAPI.getConfig();
          await window.electronAPI.updateConfig({ ...patch, ui: { ...cfg.ui, ...patch.ui } });
        })()`);
        // The tab bar stays hidden while there is a single page.
        const tabsShown =
          settings.customTabs.length > 1
            ? `document.querySelector('#quick-access-tabs .quick-access-tab-link.active')?.dataset.tab === ${JSON.stringify(settings.activeTabId)}`
            : `document.getElementById('quick-access-tabs')?.classList.contains('hidden')`;
        await waitFor(() => cdp.evaluate(tabsShown), { label: 'the page tabs', timeoutMs: 10000 });
        // A new language takes longer to repaint than a theme.
        await sleep(settings.ui.language === baseConfig.ui.language ? 700 : 1100);
        applied.settings = key;
      }

      const size = scene.size || WINDOW_SIZE;
      if (size.width !== applied.size.width || size.height !== applied.size.height) {
        const pageSize = () => cdp.evaluate('[innerWidth, innerHeight]');
        const before = await pageSize();
        await cdp.evaluate(`window.resizeTo(${size.width}, ${size.height})`);
        // The window is sized in screen pixels, but an enlarged interface zooms the page, so the
        // page sees fewer CSS pixels than the window has.
        const zoom = settings.ui.scale || 1;
        const cssWidth = Math.round(size.width / zoom);
        const cssHeight = Math.round(size.height / zoom);
        // A window cannot be bigger than the screen holds, and a hosted runner's display is small:
        // macOS keeps a 900x700 window to 900x674 there. A size that has moved, stayed inside what
        // was asked for and stopped changing is the screen's limit, not a slow resize, so the scene
        // goes on at that size instead of waiting out the clock.
        let seen = before;
        let steadySince = Date.now();
        let reached = null;
        await waitFor(
          async () => {
            const [width, height] = (reached = await pageSize());
            if (Math.abs(width - cssWidth) <= 1 && Math.abs(height - cssHeight) <= 1) return true;
            if (width !== seen[0] || height !== seen[1]) {
              seen = [width, height];
              steadySince = Date.now();
            }
            const moved = width !== before[0] || height !== before[1];
            const inside = width <= cssWidth + 1 && height <= cssHeight + 1;
            return moved && inside && Date.now() - steadySince >= 750;
          },
          { label: `a ${size.width}x${size.height} window`, timeoutMs: 5000 }
        )
          .then(() => {
            if (Math.abs(reached[0] - cssWidth) > 1 || Math.abs(reached[1] - cssHeight) > 1)
              console.log(
                `${scene.name}: the screen holds a ${reached[0]}x${reached[1]} window, not ${cssWidth}x${cssHeight}`
              );
          })
          .catch((error) => console.warn(`${scene.name}: ${error.message}`));
        applied.size = size;
        await sleep(500);
      }

      const features = scene.media || [];
      const media = JSON.stringify(features);
      if (media !== applied.media || (features.length && settingsChanged)) {
        // A theme change while forced colours are emulated makes Chromium drop the forced
        // palette even though matchMedia still reports it, so switch the emulation off and on.
        await cdp.send('Emulation.setEmulatedMedia', { features: [] });
        if (features.length) {
          await sleep(250);
          await cdp.send('Emulation.setEmulatedMedia', { features });
        }
        await sleep(600);
        applied.media = media;
      }
    }

    async function capture(name, source, { keepToasts = false } = {}) {
      if (!keepToasts) await source.evaluate(REMOVE_TOASTS);
      const { data } = await source.send('Page.captureScreenshot', { format: 'png' });
      const base = path.join(OUT_DIR, `${platformTag}-${name}`);
      fs.writeFileSync(`${base}-page.png`, Buffer.from(data, 'base64'));
      // The page target has no Browser domain; the window's own screen geometry is enough.
      const bounds = await source.evaluate(
        '({ left: window.screenX, top: window.screenY, width: window.outerWidth, height: window.outerHeight })'
      );
      captureScreen(`${base}-screen.png`, bounds);
    }

    for (const scene of selected) {
      // Entities only this scene needs arrive the way Home Assistant's own changes do and go again
      // once it is captured, so no other scene's lists carry them.
      const sceneStates = scene.extraStates ? scene.extraStates(new Date()) : [];
      try {
        if (sceneStates.length) server.changeStates({ add: sceneStates });
        await prepare(scene);
        const result = scene.setup ? await scene.setup(ctx) : null;
        await sleep(scene.settle ?? 900);
        await capture(scene.name, result?.capture || cdp, { keepToasts: scene.keepToasts });
        console.log(`Captured ${scene.name}`);
      } catch (error) {
        failures.push(scene.name);
        console.error(`Scene ${scene.name} failed: ${error.message}`);
        // What the window looked like when it went wrong is the best clue.
        await capture(`${scene.name}-failed`, cdp).catch(() => {});
      }
      try {
        // A scene that keeps its toast for the picture must not leave it for the next scene.
        await cdp.evaluate(REMOVE_TOASTS);
        // Whatever the scene did to the page itself, which nothing here knows how to put back.
        if (scene.teardown) await scene.teardown(ctx);
        if (sceneStates.length) {
          server.changeStates({ remove: sceneStates.map((entity) => entity.entity_id) });
        }
        await restore();
      } catch (error) {
        // A dialog or pin left behind would leak into every later scene, so the run must not pass.
        failures.push(`${scene.name} (reset)`);
        console.error(`Reset after ${scene.name} failed: ${error.message}`);
      }
    }
  } finally {
    cdp?.close();
    // The app hides to the tray instead of quitting on SIGTERM (macOS especially), and its open
    // socket to the mock server would keep this process alive, so escalate to SIGKILL.
    app.kill();
    await sleep(1500);
    if (app.exitCode === null && app.signalCode === null) app.kill('SIGKILL');
    server.closeAllConnections?.();
    server.close();
    await sleep(500);
    fs.rmSync(profileDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 250 });
  }
  console.log(`Snapshots written to ${OUT_DIR}`);
  if (failures.length)
    throw new Error(`${failures.length} scene(s) failed: ${failures.join(', ')}`);
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });

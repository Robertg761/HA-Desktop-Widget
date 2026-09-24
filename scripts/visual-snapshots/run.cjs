#!/usr/bin/env node
/**
 * Visual snapshots of the real app on the current OS.
 *
 * Starts a mock Home Assistant, launches the unpacked app (`electron .`) against a throwaway
 * profile, drives it over the Chrome DevTools Protocol, and saves two PNGs per scene:
 *   <scene>-page.png    the web contents, identical on every run of a given build;
 *   <scene>-screen.png  that area of the real screen, including what the OS draws behind and
 *                       around the window (Windows acrylic, macOS vibrancy, shadows, fonts).
 * The screen capture is best effort: if the OS refuses (permissions, no display), the page
 * capture still lands and the run continues.
 *
 * Usage: npm run build:renderer && node scripts/visual-snapshots/run.cjs [outDir]
 * Needs Node 22+ (global WebSocket). On Linux run it under xvfb-run.
 */

const { spawn, execFileSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { startMockHomeAssistant } = require('./mock-home-assistant.cjs');
const { TOKEN, buildConfig, buildStates } = require('./fixture.cjs');

const ROOT = path.resolve(__dirname, '..', '..');
const OUT_DIR = path.resolve(process.argv[2] || path.join(ROOT, 'visual-snapshots'));
const DEBUG_PORT = 9333;
const SCREEN_MARGIN = 32;

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

const SCENES = [
  { name: 'main-dark', setup: '' },
  {
    name: 'popup-brightness',
    setup: `document.querySelector('#quick-controls [data-entity-id="light.desk_lamp"] .tile-details-button')?.click();`,
    teardown: `document.querySelector('#brightness-cancel')?.click();`,
  },
  {
    name: 'popup-climate',
    setup: `document.querySelector('#quick-controls [data-entity-id="climate.living_room"] .tile-details-button')?.click();`,
    teardown: `document.querySelector('#climate-cancel')?.click();`,
  },
  {
    name: 'settings',
    setup: `document.querySelector('#settings-btn')?.click();`,
    teardown: `document.querySelector('#close-settings')?.click();`,
  },
  {
    name: 'main-light',
    setup: `(async () => {
      const cfg = await window.electronAPI.getConfig();
      await window.electronAPI.updateConfig({ ui: { ...cfg.ui, theme: 'light' } });
    })()`,
  },
  {
    name: 'main-light-solid',
    setup: `window.electronAPI.updateConfig({ frostedGlass: false })`,
  },
];

async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const platformTag = { darwin: 'macos', win32: 'windows' }[process.platform] || 'linux';

  const server = await startMockHomeAssistant({ token: TOKEN, states: buildStates() });
  const haUrl = `http://127.0.0.1:${server.address().port}`;
  const profileDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ha-widget-snapshot-'));
  fs.writeFileSync(
    path.join(profileDir, 'config.json'),
    JSON.stringify(buildConfig(haUrl), null, 2)
  );

  const electron = require('electron');
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  const app = spawn(
    electron,
    ['.', `--user-data-dir=${profileDir}`, `--remote-debugging-port=${DEBUG_PORT}`],
    { cwd: ROOT, env, stdio: 'inherit' }
  );

  let cdp = null;
  try {
    const target = await waitFor(
      async () => {
        const response = await fetch(`http://127.0.0.1:${DEBUG_PORT}/json/list`);
        const targets = await response.json();
        return targets.find(
          (entry) => entry.type === 'page' && /index\.html(?!.*mode=desktop-pin)/.test(entry.url)
        );
      },
      { label: 'the main window' }
    );
    cdp = await connectCdp(target.webSocketDebuggerUrl);
    await waitFor(
      () => cdp.evaluate(`document.querySelectorAll('#quick-controls .control-item').length > 3`),
      { label: 'Quick Access tiles', timeoutMs: 45000 }
    );
    // Let fonts, the weather icon and the media artwork settle.
    await sleep(1500);

    // The page target has no Browser domain; the window's own screen geometry is enough.
    const windowBounds = () =>
      cdp.evaluate(
        '({ left: window.screenX, top: window.screenY, width: window.outerWidth, height: window.outerHeight })'
      );
    for (const scene of SCENES) {
      if (scene.setup) await cdp.evaluate(scene.setup);
      await sleep(900);
      const { data } = await cdp.send('Page.captureScreenshot', { format: 'png' });
      const base = path.join(OUT_DIR, `${platformTag}-${scene.name}`);
      fs.writeFileSync(`${base}-page.png`, Buffer.from(data, 'base64'));
      captureScreen(`${base}-screen.png`, await windowBounds());
      console.log(`Captured ${scene.name}`);
      if (scene.teardown) {
        await cdp.evaluate(scene.teardown);
        await sleep(400);
      }
    }
  } finally {
    cdp?.close();
    app.kill();
    server.close();
    await sleep(500);
    fs.rmSync(profileDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 250 });
  }
  console.log(`Snapshots written to ${OUT_DIR}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

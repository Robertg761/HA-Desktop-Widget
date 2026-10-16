// A capture session: the real app (electron .) against the reactive mock Home Assistant, driven
// over CDP with virtual time so every frame is exact.
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

// The repository this folder lives in (promo/launch-4.0/rig → repository root).
const REPO = process.env.HADW_REPO || path.resolve(__dirname, '..', '..', '..');
const VT_SOURCE = fs.readFileSync(path.join(__dirname, 'vt.js'), 'utf8');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitFor(check, { timeoutMs = 30000, intervalMs = 200, label = 'condition' } = {}) {
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

async function connectCdp(url) {
  const socket = new WebSocket(url);
  await new Promise((resolve, reject) => {
    socket.addEventListener('open', resolve, { once: true });
    socket.addEventListener('error', reject, { once: true });
  });
  let nextId = 1;
  const pending = new Map();
  const listeners = new Map();
  socket.addEventListener('message', (event) => {
    const message = JSON.parse(event.data);
    if (message.method) {
      (listeners.get(message.method) || []).forEach((fn) => fn(message.params));
      return;
    }
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
  const on = (method, fn) => {
    if (!listeners.has(method)) listeners.set(method, []);
    listeners.get(method).push(fn);
  };
  return { send, evaluate, on, close: () => socket.close() };
}

/**
 * Start a session.
 *   config      the app's config.json (without homeAssistant; filled in here)
 *   mock        { states, services, serviceResponses, histories, subscriptionEvents, httpRoute, onServiceCall }
 *   dsf         device scale factor for rendering
 *   port        CDP port
 *   env         extra env for the app
 */
async function startSession({ config, mock, dsf = 3, port = Number(process.env.CDP_PORT) || 9444, env: extraEnv = {}, reducedMotion = false, haPort = 0, haHost = '127.0.0.1' }) {
  const { startMockHomeAssistant } = require('./mock-ha.cjs');
  const TOKEN = 'promo-token';
  const server = await startMockHomeAssistant({ token: TOKEN, port: haPort, ...mock });
  const haUrl = `http://${haHost}:${server.address().port}`;
  const profileDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hadw-promo-'));
  const fullConfig = { ...config, homeAssistant: { url: haUrl, token: TOKEN, authMethod: 'token' } };
  fs.writeFileSync(path.join(profileDir, 'config.json'), JSON.stringify(fullConfig, null, 2));
  for (const locale of ['ar', 'es', 'fr', 'hi', 'zh']) {
    fs.mkdirSync(path.join(profileDir, 'locales'), { recursive: true });
    fs.copyFileSync(
      path.join(REPO, 'locale-packs', `${locale}.json`),
      path.join(profileDir, 'locales', `${locale}.json`)
    );
  }
  const electron = require(path.join(REPO, 'node_modules', 'electron'));
  const env = { ...process.env, ELECTRON_DISABLE_SANDBOX: '1', ...extraEnv };
  delete env.ELECTRON_RUN_AS_NODE;
  env.XDG_STATE_HOME = path.join(profileDir, 'state');
  const app = spawn(
    electron,
    [
      '.',
      '--no-sandbox',
      `--user-data-dir=${profileDir}`,
      `--remote-debugging-port=${port}`,
      `--force-device-scale-factor=${dsf}`,
      ...(reducedMotion ? ['--force-prefers-reduced-motion'] : []),
    ],
    { cwd: REPO, env, stdio: ['ignore', 'pipe', 'pipe'] }
  );
  const logFile = fs.createWriteStream(path.join(profileDir, 'app.log'));
  app.stdout.pipe(logFile);
  app.stderr.pipe(logFile);

  const listTargets = async () => (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
  const target = await waitFor(
    async () =>
      (await listTargets()).find(
        (entry) => entry.type === 'page' && /index\.html(?!.*mode=desktop-pin)/.test(entry.url)
      ),
    { label: 'the main window', timeoutMs: 45000 }
  );
  const cdp = await connectCdp(target.webSocketDebuggerUrl);
  await cdp.send('Emulation.setFocusEmulationEnabled', { enabled: true }).catch(() => {});
  await cdp.send('Runtime.enable').catch(() => {});
  cdp.on('Runtime.exceptionThrown', (p) => {
    const d = p.exceptionDetails;
    console.warn('[page exception]', d?.exception?.description?.split('\n')[0] || d?.text);
  });
  await waitFor(() => cdp.evaluate(`document.readyState === 'complete'`), { label: 'load' });

  const s = createContext({ cdp, server, app, profileDir, listTargets, dsf, haUrl });
  return s;
}

function createContext({ cdp, server, app, profileDir, listTargets, dsf, haUrl }) {
  const ctx = {
    cdp,
    server,
    app,
    dsf,
    haUrl,
    profileDir,
    listTargets,
    sleep,
    waitFor,
    ev: (expr) => cdp.evaluate(expr),
    async waitForExpr(expr, label = expr, timeoutMs = 20000) {
      return waitFor(() => cdp.evaluate(`!!(${expr})`), { label, timeoutMs });
    },
    async installVt() {
      await cdp.evaluate(VT_SOURCE);
    },
    async enableVt(dateMs) {
      await cdp.evaluate(VT_SOURCE);
      await cdp.evaluate(`window.__vt.enable(${dateMs ?? 'undefined'})`);
    },
    /** Advance virtual time (no capture). */
    async advance(ms) {
      await cdp.evaluate(`window.__vt.advance(${ms})`);
      // Let real async work (IPC, sockets) that the timers kicked off land.
      await sleep(5);
    },
    async rect(selector) {
      return cdp.evaluate(`(() => { const el = document.querySelector(${JSON.stringify(selector)}); if (!el) return null; const r = el.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height, cx: r.x + r.width / 2, cy: r.y + r.height / 2 }; })()`);
    },
    async click(selector) {
      const found = await cdp.evaluate(
        `(() => { const el = document.querySelector(${JSON.stringify(selector)}); if (el) el.click(); return !!el; })()`
      );
      if (!found) throw new Error(`Nothing matches ${selector}`);
    },
    mouse: { x: 250, y: 330 },
    async mouseMove(x, y) {
      ctx.mouse = { x, y };
      await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y, button: 'none' });
    },
    async mouseDown(button = 'left') {
      await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: ctx.mouse.x, y: ctx.mouse.y, button, clickCount: 1 });
    },
    async mouseUp(button = 'left') {
      await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: ctx.mouse.x, y: ctx.mouse.y, button, clickCount: 1 });
    },
    async realClick(x, y) {
      await ctx.mouseMove(x, y);
      await ctx.mouseDown();
      await ctx.mouseUp();
    },
    async pressKey(key, { code = key, keyCode = 0, modifiers = 0, text } = {}) {
      const event = { key, code, windowsVirtualKeyCode: keyCode, nativeVirtualKeyCode: keyCode, modifiers };
      await cdp.send('Input.dispatchKeyEvent', { type: text ? 'keyDown' : 'rawKeyDown', ...event, ...(text ? { text } : {}) });
      await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', ...event });
    },
    async typeChar(ch) {
      const upper = ch.toUpperCase();
      const keyCode = /[a-z0-9]/i.test(ch) ? upper.charCodeAt(0) : ch === ' ' ? 32 : 0;
      const code = /[a-z]/i.test(ch) ? `Key${upper}` : /[0-9]/.test(ch) ? `Digit${ch}` : ch === ' ' ? 'Space' : '';
      await ctx.pressKey(ch, { code, keyCode, text: ch });
    },
    insertText: (text) => cdp.send('Input.insertText', { text }),
    async screenshot() {
      const { data } = await cdp.send('Page.captureScreenshot', { format: 'png', optimizeForSpeed: true });
      return Buffer.from(data, 'base64');
    },
    /**
     * Capture `frames` frames at `fps` into dir (frame numbering continues from ctx.frameNo).
     * onFrame(i) runs before each step, for scripted interactions.
     */
    frameNo: 0,
    track: [],
    async record(dir, frames, { fps = 60, onFrame = null } = {}) {
      fs.mkdirSync(dir, { recursive: true });
      const ms = 1000 / fps;
      for (let i = 0; i < frames; i += 1) {
        if (onFrame) await onFrame(i);
        await cdp.evaluate(`window.__vt.step(${ms})`);
        await sleep(2);
        const png = await ctx.screenshot();
        const name = String(ctx.frameNo).padStart(5, '0');
        fs.writeFileSync(path.join(dir, `${name}.png`), png);
        ctx.track.push({ f: ctx.frameNo, mouse: { ...ctx.mouse }, mark: ctx.pendingMark || null });
        ctx.pendingMark = null;
        ctx.frameNo += 1;
      }
    },
    mark(label) {
      ctx.pendingMark = label;
    },
    writeTrack(dir) {
      fs.writeFileSync(path.join(dir, 'track.json'), JSON.stringify({ dsf, frames: ctx.track }, null, 1));
    },
    async resize(width, height) {
      await cdp.evaluate(`window.resizeTo(${width}, ${height})`);
      await waitFor(async () => {
        const [w, h] = await cdp.evaluate('[innerWidth, innerHeight]');
        return Math.abs(w - width) <= 2 && Math.abs(h - height) <= 2;
      }, { label: `size ${width}x${height}`, timeoutMs: 8000 }).catch((e) => console.warn(e.message));
    },
    async updateConfig(patch) {
      await cdp.evaluate(`(async () => {
        const patch = ${JSON.stringify(patch)};
        const cfg = await window.electronAPI.getConfig();
        await window.electronAPI.updateConfig({ ...patch, ui: { ...cfg.ui, ...(patch.ui || {}) } });
      })()`);
    },
    async close() {
      try {
        cdp.close();
      } catch {
        /* ignore */
      }
      app.kill();
      await sleep(1200);
      if (app.exitCode === null && app.signalCode === null) app.kill('SIGKILL');
      server.closeAllConnections?.();
      server.close();
      await sleep(300);
      fs.rmSync(profileDir, { recursive: true, force: true });
    },
  };
  return ctx;
}

module.exports = { startSession, connectCdp, waitFor, sleep };

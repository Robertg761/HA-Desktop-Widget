// Render the spot. Usage:
//   node render.cjs stills <t1,t2,...> <outDir>
//   node render.cjs video <fromSec> <toSec> <out.mkv>   (60 fps, lossless-ish intermediate)
const { spawn } = require('child_process');
const fs = require('fs');
const http = require('http');
const path = require('path');
const { connectCdp, waitFor, sleep } = require('../rig/session.cjs');

const ROOT = path.join(__dirname, '..');
// Any recent Chromium headless shell; the default is the one Playwright installs.
const CHROME = process.env.CHROME || '/opt/pw-browsers/chromium_headless_shell-1194/chrome-linux/headless_shell';
const FPS = 60;

function serve() {
  const types = { '.html': 'text/html', '.js': 'text/javascript', '.png': 'image/png', '.jpg': 'image/jpeg', '.json': 'application/json', '.woff2': 'font/woff2', '.svg': 'image/svg+xml' };
  const server = http.createServer((req, res) => {
    const p = path.join(ROOT, decodeURIComponent(req.url.split('?')[0]));
    if (!p.startsWith(ROOT)) return res.writeHead(403).end();
    fs.readFile(p, (err, data) => {
      if (err) return res.writeHead(404).end();
      res.writeHead(200, { 'content-type': types[path.extname(p)] || 'application/octet-stream', 'cache-control': 'max-age=3600' });
      res.end(data);
    });
  });
  return new Promise((r) => server.listen(0, '127.0.0.1', () => r(server)));
}

function manifest() {
  const dir = path.join(ROOT, 'footage');
  const m = {};
  for (const d of fs.readdirSync(dir)) {
    const full = path.join(dir, d);
    if (!fs.statSync(full).isDirectory()) continue;
    m[d] = fs.readdirSync(full).filter((f) => /^\d{5}\.png$/.test(f)).length;
  }
  return m;
}

async function open() {
  const server = await serve();
  const port = 9600 + Math.floor(Math.random() * 300);
  const chrome = spawn(CHROME, [
    `--remote-debugging-port=${port}`,
    '--no-sandbox',
    '--hide-scrollbars',
    '--force-device-scale-factor=1',
    '--window-size=1920,1080',
    '--use-angle=swiftshader',
    '--enable-unsafe-swiftshader',
    '--ignore-gpu-blocklist',
    '--disable-background-timer-throttling',
    '--disable-renderer-backgrounding',
    '--run-all-compositor-stages-before-draw',
    'about:blank',
  ], { stdio: ['ignore', 'ignore', 'pipe'] });
  let errlog = '';
  chrome.stderr.on('data', (d) => (errlog += d));
  const target = await waitFor(async () => {
    const list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
    return list.find((e) => e.type === 'page');
  }, { label: 'chrome', timeoutMs: 20000 });
  const cdp = await connectCdp(target.webSocketDebuggerUrl);
  await cdp.send('Runtime.enable');
  cdp.on('Runtime.consoleAPICalled', (p) => {
    if (p.type === 'error' || p.type === 'warning') console.log('[page]', p.args.map((a) => a.value ?? a.description).join(' '));
  });
  cdp.on('Runtime.exceptionThrown', (p) => console.log('[page exception]', p.exceptionDetails?.exception?.description || p.exceptionDetails?.text));
  await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1920, height: 1080, deviceScaleFactor: 1, mobile: false });
  await cdp.send('Page.enable');
  const url = `http://127.0.0.1:${server.address().port}/comp/index.html`;
  await cdp.send('Page.navigate', { url });
  await waitFor(() => cdp.evaluate(`document.readyState === 'complete' && !!window.compInit`), { label: 'comp page', timeoutMs: 20000 });
  await cdp.evaluate(`window.compInit(${JSON.stringify(manifest())})`);
  await cdp.evaluate(`document.fonts.ready.then(() => true)`);
  const close = async () => {
    cdp.close();
    chrome.kill('SIGKILL');
    server.close();
  };
  return { cdp, close };
}

async function shot(cdp, t, format = 'png') {
  await cdp.evaluate(`window.render(${t})`);
  const { data } = await cdp.send('Page.captureScreenshot', { format, quality: format === 'jpeg' ? 95 : undefined, clip: { x: 0, y: 0, width: 1920, height: 1080, scale: 1 } });
  return Buffer.from(data, 'base64');
}

(async () => {
  const [mode, a, b, c] = process.argv.slice(2);
  const { cdp, close } = await open();
  try {
    if (mode === 'stills') {
      fs.mkdirSync(b, { recursive: true });
      for (const t of a.split(',').map(Number)) {
        const t0 = Date.now();
        fs.writeFileSync(path.join(b, `t${t.toFixed(2).padStart(6, '0')}.png`), await shot(cdp, t));
        console.log(`still ${t} in ${Date.now() - t0}ms`);
      }
    } else if (mode === 'video') {
      const from = Number(a);
      const to = Number(b);
      const out = c;
      const ff = spawn('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'image2pipe', '-framerate', String(FPS), '-c:v', 'mjpeg', '-i', '-', '-c:v', 'libx264', '-preset', 'medium', '-crf', '10', '-pix_fmt', 'yuv444p', '-r', String(FPS), out], { stdio: ['pipe', 'inherit', 'inherit'] });
      const f0 = Math.round(from * FPS);
      const f1 = Math.round(to * FPS);
      const tStart = Date.now();
      for (let f = f0; f < f1; f++) {
        const buf = await shot(cdp, f / FPS, 'jpeg');
        if (!ff.stdin.write(buf)) await new Promise((r) => ff.stdin.once('drain', r));
        if ((f - f0) % 60 === 0) {
          const el = (Date.now() - tStart) / 1000;
          console.log(`${out}: frame ${f - f0}/${f1 - f0} (${(el / Math.max(1, f - f0) * 1000).toFixed(0)} ms/frame)`);
        }
      }
      ff.stdin.end();
      await new Promise((r) => ff.on('close', r));
    }
  } finally {
    await close();
  }
  process.exit(0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});

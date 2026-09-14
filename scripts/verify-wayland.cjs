// Run against a disposable packaged profile in an existing Hyprland session.
// The test changes only that profile. --portal requires a private session bus.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const args = process.argv.slice(2);
const option = (name, fallback = '') =>
  args.includes(name) ? args[args.indexOf(name) + 1] : fallback;
const port = args.includes('--port') ? Number(option('--port')) : 19348;
const binary = path.resolve(option('--binary'));
const profile = path.resolve(option('--profile'));
const stateHome = path.resolve(option('--state-home'));
const report = { checks: [], startedAt: new Date().toISOString() };
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
let ws;
let nextId = 0;
const pending = new Map();
async function connect() {
  const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
  const target = targets.find(
    (item) =>
      item.type === 'page' &&
      item.url.startsWith('file:') &&
      item.url.includes('index.html') &&
      item.title === 'Home Assistant Widget' &&
      !item.url.includes('desktop-pin')
  );
  assert(target, 'packaged main renderer must be running');
  ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    ws.addEventListener('open', resolve, { once: true });
    ws.addEventListener('error', reject, { once: true });
  });
  ws.addEventListener('message', (event) => {
    const message = JSON.parse(event.data);
    const request = pending.get(message.id);
    if (!request) return;
    pending.delete(message.id);
    clearTimeout(request.timer);
    if (message.error) request.reject(new Error(JSON.stringify(message.error)));
    else request.resolve(message.result);
  });
}
function command(method, params = {}) {
  return new Promise((resolve, reject) => {
    const id = ++nextId;
    const timer = setTimeout(() => {
      pending.delete(id);
      reject(new Error(`Timed out: ${method}`));
    }, 15000);
    pending.set(id, { resolve, reject, timer });
    ws.send(JSON.stringify({ id, method, params }));
  });
}
async function evaluate(expression) {
  const result = await command('Runtime.evaluate', {
    expression,
    awaitPromise: true,
    returnByValue: true,
  });
  assert(!result.exceptionDetails, JSON.stringify(result.exceptionDetails));
  return result.result.value;
}
const api = (name, ...values) =>
  evaluate(`window.electronAPI.${name}(${values.map((v) => JSON.stringify(v)).join(',')})`);
const hypr = (...values) => execFileSync('hyprctl', values, { encoding: 'utf8', timeout: 5000 });
const layers = (pid) =>
  Object.entries(JSON.parse(hypr('-j', 'layers'))).flatMap(([output, data]) =>
    Object.entries(data.levels).flatMap(([level, items]) =>
      items
        .filter((item) => item.pid === pid)
        .map((item) => ({ ...item, output, level: Number(level) }))
    )
  );
const launch = (action) =>
  execFileSync(binary, [`--user-data-dir=${profile}`, action], { timeout: 15000, stdio: 'pipe' });
const pass = (name) => {
  report.checks.push(name);
  console.log(`PASS ${name}`);
};
async function run() {
  assert(
    args.includes('--profile') && args.includes('--binary') && args.includes('--state-home'),
    'Required: --binary PATH --profile PATH --state-home PATH [--port N] [--portal]'
  );
  assert(
    !fs.existsSync(path.join(stateHome, 'omarchy')),
    'state-home must be a disposable directory without an existing Omarchy theme'
  );
  const deadline = Date.now() + 20000;
  while (true) {
    try {
      await connect();
      break;
    } catch (error) {
      if (Date.now() >= deadline) throw error;
      await pause(250);
    }
  }
  while (!(await evaluate('typeof window.electronAPI?.getDesktopIntegration === "function"'))) {
    assert(Date.now() < deadline, 'renderer preload must initialize');
    await pause(100);
  }
  const info = await api('getDesktopIntegration');
  assert(
    info.isolatedProfile && info.layerMode && info.hyprland && info.helperPid,
    'test requires an isolated native Hyprland layer profile'
  );
  const helperArgs = fs.readFileSync(`/proc/${info.helperPid}/cmdline`, 'utf8').split('\0');
  assert(
    helperArgs.includes(`--user-data-dir=${profile}`),
    'CDP target must use the requested disposable profile'
  );
  const helperEnvironment = fs.readFileSync(`/proc/${info.helperPid}/environ`, 'utf8').split('\0');
  assert(
    helperEnvironment.includes(`XDG_STATE_HOME=${stateHome}`),
    'state-home must match the test application environment'
  );
  report.desktop = info;
  const animations = hypr('-j', 'animations');
  const pid = info.helperPid;
  await api('updateConfig', {
    customTabs: [
      {
        id: 'wayland-test',
        name: 'Wayland test',
        entityIds: ['sensor.wayland_test_one', 'sensor.wayland_test_two'],
      },
    ],
  });
  for (const id of ['sensor.wayland_test_one', 'sensor.wayland_test_two'])
    assert((await api('pinEntityToDesktop', id)).success);
  await pause(1200);
  let surfaces = layers(pid);
  assert.equal(surfaces.length, 3);
  assert(surfaces.every((s) => s.w > 0 && s.h > 0 && s.level === 1));
  assert.equal(new Set(surfaces.map((s) => `${s.x},${s.y}`)).size, 3);
  pass('native main window and two independently placed desktop pins');
  assert.deepEqual(await api('getWindowState'), {
    alwaysOnTop: false,
    supported: false,
    layerMode: true,
  });
  assert.equal((await api('setAlwaysOnTop', true)).supported, false);
  assert.equal((await api('getLoginItemSettings')).supported, false);
  pass('accurate layer capabilities and isolated startup settings');
  launch('--hide');
  await pause(400);
  assert.equal(layers(pid).length, 2);
  launch('--hide');
  await pause(100);
  assert.equal(layers(pid).length, 2);
  launch('--show');
  await pause(400);
  assert.equal(layers(pid).length, 3);
  launch('--toggle');
  await pause(400);
  assert.equal(layers(pid).length, 2);
  launch('--toggle');
  await pause(400);
  assert.equal(layers(pid).length, 3);
  pass('idempotent show/hide and single-instance toggle');
  const themeFile = path.join(stateHome, 'omarchy/current/theme/colors.toml');
  fs.mkdirSync(path.dirname(themeFile), { recursive: true });
  const palette = (background, foreground, accent) =>
    `background = "${background}"\nforeground = "${foreground}"\naccent = "${accent}"\n`;
  fs.writeFileSync(themeFile, palette('#112233', '#f0e0d0', '#ffaa22'));
  await api('updateConfig', { ui: { followOmarchy: true } });
  await pause(1900);
  const appearance = () =>
    evaluate(
      '({bg:document.documentElement.style.getPropertyValue("--window-bg-rgb"),fg:getComputedStyle(document.body).getPropertyValue("--text-primary")})'
    );
  assert.deepEqual(await appearance(), { bg: '17, 34, 51', fg: '#f0e0d0' });
  fs.writeFileSync(`${themeFile}.next`, palette('#334455', '#ffeedd', '#33aaff'));
  fs.renameSync(`${themeFile}.next`, themeFile);
  await pause(1900);
  assert.deepEqual(await appearance(), { bg: '51, 68, 85', fg: '#ffeedd' });
  await api('updateConfig', { ui: { followOmarchy: false } });
  await pause(300);
  assert.notEqual((await appearance()).bg, '51, 68, 85');
  pass('live Omarchy palette replacement and restoration of custom colors');
  if (args.includes('--portal')) {
    const result = await api('registerPopupHotkey', 'Control+Alt+H');
    assert(result.success && result.binding.requiresCompositorBinding);
    assert.equal(result.binding.trigger, '');
    hypr('eval', `hl.dispatch(hl.dsp.global(${JSON.stringify(`${info.appId}:popup-toggle`)}))`);
    await pause(500);
    assert.equal((await api('getDesktopIntegration')).lastActivation.id, 'popup-toggle');
    surfaces = layers(pid);
    assert.equal(surfaces.filter((s) => s.level === 3).length, 1);
    assert.equal(surfaces.filter((s) => s.level === 1).length, 2);
    pass('real portal registration, activation, and elevation of only the main widget');
    await api('unregisterPopupHotkey');
  }
  assert.equal(hypr('-j', 'animations'), animations);
  pass('compositor animation settings unchanged');
  await command('Page.captureScreenshot').then((result) =>
    fs.writeFileSync(
      path.join(profile, 'wayland-verification.png'),
      Buffer.from(result.data, 'base64')
    )
  );
  report.completedAt = new Date().toISOString();
  fs.writeFileSync(
    path.join(profile, 'wayland-verification.json'),
    JSON.stringify(report, null, 2)
  );
}
run()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => {
    ws?.close();
    for (const request of pending.values()) clearTimeout(request.timer);
  });

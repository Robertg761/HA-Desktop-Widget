// Stills of the real app for the website, at 2x, using the promo rig's demo home.
const fs = require('fs');
const path = require('path');
const R = path.resolve(__dirname, '..', 'launch-4.0');
const { begin, tileSel, world } = require(R + '/shots/common.cjs');
const OUT = process.argv[2];
fs.mkdirSync(OUT, { recursive: true });
const save = async (s, name) => { fs.writeFileSync(path.join(OUT, name + '.png'), await s.screenshot()); console.log('saved', name); };
const settle = async (s, n = 3) => { for (let i = 0; i < n; i++) { await s.sleep(250); await s.advance(400); } };
const SKY = { primaryCards: ['none', 'none'], primaryMediaPlayer: '', customTabs: [{ id: 'default', name: 'Home', entityIds: ['light.living_room', 'climate.thermostat'] }], activeTabId: 'default' };
const holiday = (show, theme = 'dark') => ({ ui: { theme, seasonal: { enabled: true, show, showUntil: Date.now() + 30 * 86400000 } } });
const camLoaded = `(() => { const img = document.querySelector('#quick-controls .control-item[data-entity-id="camera.porch"] img'); return !!img && img.complete && img.naturalWidth > 0; })()`;
const SHOTS = {
  async main() {
    const s = await begin({ dsf: 2 });
    await settle(s); await save(s, 'main-dark');
    await s.updateConfig({ ui: { theme: 'light' } }); await s.sleep(800); await settle(s); await save(s, 'main-light');
    await s.close();
  },
  async camera() {
    const s = await begin({ dsf: 2, config: { activeTabId: 'security', tileSpans: { 'camera.porch': 2 } } });
    for (let k = 0; k < 40 && !(await s.ev(camLoaded)); k++) { await s.sleep(150); await s.advance(150); }
    await settle(s); await save(s, 'camera-tile');
    await s.close();
  },
  async camlive() {
    const s = await begin({ dsf: 2, config: { activeTabId: 'security', quickAccessTileOptions: {} }, statesPatch: (st) => { st.find((x) => x.entity_id === 'camera.porch').state = 'streaming'; } });
    await s.click(tileSel('camera.porch')); await settle(s, 2);
    await s.click('.camera-modal #live-btn');
    for (let k = 0; k < 60; k++) { if (await s.ev(`(() => { const m = document.querySelector('.camera-modal'); return !!(m && [...m.querySelectorAll('img')].find((i) => i.naturalWidth > 0)); })()`)) break; await s.sleep(150); await s.advance(100); }
    await s.ev('document.activeElement?.blur?.()'); await settle(s); await save(s, 'camera-live');
    await s.close();
  },
  async graph() {
    const graphPage = { id: 'default', name: 'Climate', entityIds: ['graph:temps', 'climate.thermostat', 'sensor.office_temp', 'sensor.bedroom_temp'] };
    const s = await begin({ dsf: 2, vdate: Date.now(), config: { customTabs: [graphPage, world.PAGES.bedroom], comparisonGraphs: [{ id: 'graph:temps', name: 'Temperatures', span: 3, entityIds: ['sensor.outdoor_temp', 'sensor.office_temp', 'sensor.bedroom_temp'] }] } });
    const st = (id) => s.server.states.find((x) => x.entity_id === id);
    s.server.changeStates({ add: ['sensor.outdoor_temp', 'sensor.office_temp', 'sensor.bedroom_temp'].map((id) => ({ ...st(id), last_updated: new Date().toISOString() })) });
    for (let k = 0; k < 40; k++) { if (await s.ev(`document.querySelectorAll('.comparison-graph-frame polyline, .comparison-graph-frame path').length >= 3`)) break; await s.sleep(250); await s.advance(250); }
    await s.ev(`(() => { const f = document.querySelector('.comparison-graph-frame'); if (!f) return; const b = f.getBoundingClientRect(); f.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, clientX: b.left + b.width * 0.72, clientY: b.top + b.height / 2 })); })()`);
    await s.advance(300); await s.sleep(200); await save(s, 'graph');
    await s.close();
  },
  async palette() {
    const s = await begin({ dsf: 2 });
    await s.pressKey('k', { code: 'KeyK', keyCode: 75, modifiers: 2 }); await settle(s, 2);
    for (const ch of 'movie') { await s.typeChar(ch); await s.advance(120); }
    await settle(s, 2); await save(s, 'palette');
    await s.close();
  },
  async seasonal() {
    for (const [h, theme, seed] of [['halloween', 'dark', 11], ['christmas', 'dark', 5]]) {
      const s = await begin({ dsf: 2, seed, config: { ...SKY, ui: { theme } } });
      await s.updateConfig(holiday(h, theme)); await s.sleep(1000); await s.advance(400);
      for (let i = 0; i < 12; i++) { await s.advance(500); await s.sleep(30); }
      await save(s, 'seasonal-' + h);
      await s.close();
    }
  },
  async seasonalfull() {
    for (const [h, theme, seed] of [['halloween', 'dark', 11], ['christmas', 'light', 5]]) {
      const s = await begin({ dsf: 2, seed });
      await s.updateConfig(holiday(h, theme)); await s.sleep(1000); await s.advance(400);
      for (let i = 0; i < 12; i++) { await s.advance(500); await s.sleep(30); }
      await save(s, 'full-' + h);
      await s.close();
    }
  },
  async pins() {
    const { connectCdp, waitFor } = require(R + '/rig/session.cjs');
    const s = await begin({ dsf: 2 });
    for (const id of ['light.living_room', 'climate.thermostat', 'lock.front_door']) {
      const r = await s.ev(`window.electronAPI.pinEntityToDesktop(${JSON.stringify(id)})`);
      if (!r?.success) throw new Error('pin failed ' + id + ' ' + r?.error);
      await s.sleep(2500);
      const t = await waitFor(async () => (await s.listTargets()).find((e) => e.type === 'page' && e.url.includes('mode=desktop-pin') && decodeURIComponent(e.url).includes('entityId=' + id)), { label: 'pin ' + id, timeoutMs: 15000 });
      const pin = await connectCdp(t.webSocketDebuggerUrl); await s.sleep(800);
      const { data } = await pin.send('Page.captureScreenshot', { format: 'png' });
      fs.writeFileSync(path.join(OUT, 'pin-' + id.replace('.', '_') + '.png'), Buffer.from(data, 'base64')); console.log('saved pin', id); pin.close();
    }
    await s.close();
  },
};
(async () => {
  for (const n of process.argv.slice(3)) {
    try { await SHOTS[n](); } catch (e) { console.error('!!', n, e.message); try { require('child_process').execSync('pkill -9 -f "[r]emote-debugging-port=9444"'); } catch {} await new Promise((r) => setTimeout(r, 1500)); }
  }
  process.exit(0);
})();

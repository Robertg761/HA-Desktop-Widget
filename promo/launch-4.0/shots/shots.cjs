// Footage for the 4.0 spot. Usage: node shots.cjs <shot> [<shot> ...]
const fs = require('fs');
const path = require('path');
const { FOOTAGE, VDATE, begin, setStates, entity, tileSel, world } = require('./common.cjs');

const FPS = 60;
const at = (sec) => Math.round(sec * FPS);

const LIGHTS_PAGE = {
  id: 'default',
  name: 'Lights',
  entityIds: [
    'light.living_room',
    'light.kitchen',
    'fan.bedroom',
    'light.hallway',
    'light.office',
    'light.dining',
    'light.porch',
    'light.accent_strip',
    'light.garden',
  ],
};

const dim = { supported_color_modes: ['brightness'], color_mode: null };
function lightsOff(states) {
  const extra = [
    entity('light.hallway', 'off', { friendly_name: 'Hallway', ...dim }),
    entity('light.dining', 'off', { friendly_name: 'Dining', ...dim }),
    entity('light.garden', 'off', { friendly_name: 'Garden', ...dim }),
  ];
  states.push(...extra);
  for (const s of states) {
    if (LIGHTS_PAGE.entityIds.includes(s.entity_id)) {
      s.state = 'off';
      s.attributes = { ...s.attributes, brightness: null, color_mode: null, percentage: 0 };
    }
  }
}
function turnedOn(states, id) {
  const s = states.find((x) => x.entity_id === id);
  const on = { ...s, state: 'on', attributes: { ...s.attributes }, last_changed: new Date().toISOString() };
  if (id.startsWith('light.')) {
    on.attributes.brightness = id === 'light.accent_strip' ? 150 : 204;
    on.attributes.color_mode = id === 'light.accent_strip' ? 'rgb' : 'brightness';
  } else on.attributes.percentage = 66;
  return on;
}

const SHOTS = {
  // S1/S2/S8: a dark grid of lights igniting.
  async open() {
    const s = await begin({
      config: { customTabs: [LIGHTS_PAGE, world.PAGES.bedroom], activeTabId: 'default' },
      statesPatch: lightsOff,
    });
    const order = [
      [1.5, 'light.office'],
      // Each beat lights a tile the pulling-back camera can already see.
      [4.5, 'light.dining'],
      [5.0, 'light.kitchen'],
      [5.5, 'light.hallway'],
      [6.0, 'light.living_room'],
      [6.5, 'fan.bedroom'],
      [7.0, 'light.porch'],
      [7.25, 'light.garden'],
      [7.5, 'light.accent_strip'],
    ];
    const dir = path.join(FOOTAGE, 'open');
    await s.record(dir, at(8.4), {
      onFrame: async (i) => {
        for (const [t, id] of order) {
          if (i === at(t) - 1) {
            await setStates(s, [turnedOn(s.server.states, id)]);
          }
        }
      },
    });
    s.writeTrack(dir);
    await s.close();
  },

  // S4/S5/S18: the home page, idle (seek bar and clock move).
  async hero() {
    const s = await begin({});
    const dir = path.join(FOOTAGE, 'hero');
    await s.record(dir, at(7));
    s.writeTrack(dir);
    await s.close();
  },
};


// ---------------------------------------------------------------- timeline helper
/** Builds an onFrame that runs actions at times and moves the cursor along eased paths. */
function timeline(s) {
  const actions = [];
  const paths = [];
  const api = {
    at(t, fn) {
      actions.push({ f: at(t) - 1, fn });
      return api;
    },
    move(t0, t1, to, from = null) {
      paths.push({ f0: at(t0), f1: at(t1), to, from });
      return api;
    },
    clickAt(t, getPoint, t0 = t - 0.4) {
      // move to the point, then press
      paths.push({ f0: at(t0), f1: at(t - 0.05), to: getPoint, from: null });
      actions.push({ f: at(t) - 1, fn: async () => { await s.mouseDown(); await s.mouseUp(); s.mark('click'); } });
      return api;
    },
    type(t, text, gap = 0.11) {
      [...text].forEach((ch, k) => actions.push({ f: at(t + k * gap) - 1, fn: async () => { await s.insertText(ch); s.mark('key'); } }));
      return api;
    },
    async onFrame(i) {
      for (const p of paths) {
        if (i === p.f0) {
          p.fromPt = p.from || { ...s.mouse };
          p.toPt = typeof p.to === 'function' ? await p.to() : p.to;
        }
        if (i >= p.f0 && i <= p.f1 && p.toPt) {
          const u = p.f1 === p.f0 ? 1 : (i - p.f0) / (p.f1 - p.f0);
          const e = u < 0.5 ? 4 * u * u * u : 1 - Math.pow(-2 * u + 2, 3) / 2;
          await s.mouseMove(p.fromPt.x + (p.toPt.x - p.fromPt.x) * e, p.fromPt.y + (p.toPt.y - p.fromPt.y) * e);
        }
      }
      for (const a of actions) if (a.f === i) await a.fn();
    },
  };
  return api;
}

const center = (s, sel) => async () => {
  const r = await s.rect(sel);
  if (!r) throw new Error(`no ${sel}`);
  return { x: r.cx, y: r.cy };
};

async function rec(s, name, seconds, tl = null) {
  const dir = path.join(FOOTAGE, name);
  fs.rmSync(dir, { recursive: true, force: true });
  s.frameNo = 0;
  s.track = [];
  await s.record(dir, at(seconds), { onFrame: tl ? (i) => tl.onFrame(i) : null });
  s.writeTrack(dir);
}

const holidayCfg = (show, theme = 'dark') => ({
  ui: { theme, seasonal: { enabled: true, show, showUntil: VDATE + 7 * 86400000 } },
});
// Seasonal takes: no cards, no media, one row of two tiles, so the sky (moon, fliers) is open.
const SKY = {
  primaryCards: ['none', 'none'],
  primaryMediaPlayer: '',
  customTabs: [{ id: 'default', name: 'Home', entityIds: ['light.living_room', 'climate.thermostat'] }],
  activeTabId: 'default',
};

const MORE = {
  async status() {
    const s = await begin({});
    const st = (id) => s.server.states.find((x) => x.entity_id === id);
    const upd = (id, state, attrs = {}) => ({ ...st(id), state, attributes: { ...st(id).attributes, ...attrs }, last_changed: new Date().toISOString() });
    const tl = timeline(s)
      .at(0.5, () => setStates(s, [upd('cover.garage_door', 'open', { current_position: 100 })]))
      .at(1.0, () => setStates(s, [upd('light.kitchen', 'on', { brightness: 204, color_mode: 'brightness' })]))
      .at(1.5, () => setStates(s, [upd('lock.front_door', 'unlocked')]))
      .at(2.0, () => setStates(s, [upd('vacuum.robot', 'cleaning')]));
    await rec(s, 'status', 2.8, tl);
    await s.close();
  },

  async pages() {
    // Continues from the status take: Kitchen on, Garage open, Front door unlocked.
    const s = await begin({
      statesPatch: (states) => {
        const set = (id, state, attrs) => {
          const e = states.find((x) => x.entity_id === id);
          e.state = state;
          e.attributes = { ...e.attributes, ...attrs };
        };
        set('light.kitchen', 'on', { brightness: 204, color_mode: 'brightness' });
        set('cover.garage_door', 'open', { current_position: 100 });
        set('lock.front_door', 'unlocked', {});
      },
    });
    const tab = (id) => `#quick-access-tabs .quick-access-tab-link[data-tab="${id}"]`;
    const porchLoaded = `(() => { const img = document.querySelector('#quick-controls .control-item[data-entity-id="camera.porch"] img'); return !!img && img.complete && img.naturalWidth > 0; })()`;
    // Warm the camera tile, then come back home.
    await s.click(tab('security'));
    for (let k = 0; k < 30 && !(await s.ev(porchLoaded)); k++) {
      await s.sleep(150);
      await s.advance(100);
    }
    await s.click(tab('default'));
    await s.advance(900);
    await s.sleep(200);
    await s.advance(300);
    await s.mouseMove(330, 520);
    const holdForPorch = async () => {
      for (let k = 0; k < 40 && !(await s.ev(porchLoaded)); k++) await s.sleep(100);
    };
    const tl = timeline(s)
      .clickAt(0.45, center(s, tab('bedroom')), 0.05)
      .clickAt(1.25, center(s, tab('security')), 0.8)
      .at(1.27, holdForPorch)
      .at(1.32, holdForPorch);
    await rec(s, 'pages', 2.6, tl);
    await s.close();
  },

  async themes() {
    const s = await begin({});
    await rec(s, 'theme_dark', 1.6);
    await s.updateConfig({ ui: { theme: 'light' } });
    await s.sleep(800);
    await s.advance(1200);
    await s.sleep(300);
    await s.advance(300);
    await rec(s, 'theme_light', 1.6);
    await s.updateConfig({ ui: { theme: 'dark' } });
    await s.sleep(800);
    await s.advance(1200);
    for (const accent of ['emerald', 'amber', 'rose', 'violet', 'aqua']) {
      await s.updateConfig({ ui: { accent } });
      await s.sleep(700);
      await s.advance(900);
      await s.sleep(200);
      await s.advance(200);
      await rec(s, `accent_${accent}`, 0.8);
    }
    await s.close();
  },

  async halloween() {
    const s = await begin({ seed: Number(process.env.SEED || 11), config: SKY });
    await s.updateConfig(holidayCfg('halloween'));
    await s.sleep(1000);
    await s.advance(400);
    await rec(s, 'halloween', 15);
    await s.close();
  },

  async holidays() {
    const list = [
      ['christmas', 'dark', 13, 5],
      ['new-year', 'dark', 9, 3],
      ['lunar-new-year', 'dark', 4.5, 9],
      ['valentines', 'light', 3, 4],
      ['st-patricks', 'light', 3, 4],
      // Dark, so the white bunny and pastel petals read (on the light theme they vanish).
      ['easter', 'dark', 11, 6],
      ['thanksgiving', 'dark', 11, 8],
    ];
    const only = process.env.ONLY ? process.env.ONLY.split(',') : null;
    for (const [h, theme, secs, seed] of list) {
      if (only && !only.includes(h)) continue;
      const s = await begin({ seed, config: { ...SKY, ui: { theme } } });
      await s.updateConfig(holidayCfg(h, theme));
      await s.sleep(1000);
      await s.advance(400);
      await rec(s, `holiday_${h}`, secs);
      await s.close();
    }
  },

  async palette() {
    const s = await begin({
      statesPatch: (states) => {
        const k = states.find((x) => x.entity_id === 'light.kitchen');
        k.state = 'on';
        k.attributes = { ...k.attributes, brightness: 204, color_mode: 'brightness' };
      },
    });
    await s.ev(`window.__allowToasts = true; document.querySelectorAll('#toast-container .toast').forEach((t) => t.remove())`);
    const tl = timeline(s)
      .at(0.5, () => s.pressKey('k', { code: 'KeyK', keyCode: 75, modifiers: 2 }).then(() => s.mark('ctrlk')))
      .type(1.05, 'movie', 0.12)
      .at(1.95, () => s.pressKey('ArrowDown', { code: 'ArrowDown', keyCode: 40 }).then(() => s.mark('down')))
      .at(2.3, () => s.pressKey('Enter', { code: 'Enter', keyCode: 13, text: '\r' }).then(() => s.mark('enter')));
    await rec(s, 'palette', 4.4, tl);
    await s.close();
  },

  async settings() {
    const s = await begin({});
    await s.mouseMove(300, 420);
    const niceUrl = () => s.ev(`(() => { const f = document.getElementById('ha-url'); if (f) f.value = 'http://homeassistant.local:8123'; })()`);
    const tl = timeline(s)
      .clickAt(0.45, center(s, '#settings-btn'), 0.05)
      .at(0.47, niceUrl)
      .at(0.6, niceUrl)
      .clickAt(1.25, center(s, '#settings-search'), 0.8)
      .type(1.45, 'theme', 0.12)
      .clickAt(2.75, center(s, '#settings-modal .settings-search-result'), 2.25);
    await rec(s, 'settings', 4.6, tl);
    await s.close();
  },

  async rapid() {
    // Camera live view
    {
      const s = await begin({ config: { activeTabId: 'security', tileSpans: { 'camera.porch': 2 } } });
      await rec(s, 'security_page', 0.6);
      const tl = timeline(s)
        .at(0.05, () => s.click(tileSel('camera.porch')));
      await rec(s, 'camera', 2.0, tl);
      await s.close();
    }
    // Alarm code (palette → disarm)
    {
      const s = await begin({});
      const tl = timeline(s)
        .at(0.05, () => s.pressKey('k', { code: 'KeyK', keyCode: 75, modifiers: 2 }))
        .type(0.5, 'disarm', 0.06)
        .at(1.2, () => s.pressKey('Enter', { code: 'Enter', keyCode: 13, text: '\r' }))
        .type(1.9, '2580', 0.12);
      await rec(s, 'alarm', 3.0, tl);
      await s.close();
    }
    // Notifications
    {
      const s = await begin({});
      const ago = (m) => new Date(VDATE - m * 60000).toISOString();
      s.server.pushEvents('persistent_notification/subscribe', [{
        type: 'current',
        notifications: {
          update: { notification_id: 'update', title: 'Update available', message: '**Home Assistant 2026.11** is ready to install. See the [release notes](/config/updates) for what is new.', created_at: ago(8) },
          hue: { notification_id: 'hue', title: 'New devices found', message: 'Discovered a **Hue bridge** and **3 lights**. Set them up in [Integrations](/config/integrations).\n\n- Hallway spot\n- Garden path\n- Reading lamp', created_at: ago(42) },
        },
      }]);
      await s.sleep(500);
      await s.advance(500);
      const tl = timeline(s).at(0.05, () => s.click('#persistent-notifications-btn'));
      await rec(s, 'notifications', 1.6, tl);
      await s.close();
    }
    // Comparison graph
    {
      const graphPage = { id: 'default', name: 'Climate', entityIds: ['graph:temps', 'climate.thermostat', 'sensor.office_temp', 'sensor.bedroom_temp'] };
      const s = await begin({
        config: {
          customTabs: [graphPage, world.PAGES.bedroom],
          comparisonGraphs: [{ id: 'graph:temps', name: 'Temperatures', span: 3, entityIds: ['sensor.outdoor_temp', 'sensor.office_temp', 'sensor.bedroom_temp'] }],
        },
      });
      await s.sleep(800);
      await s.advance(600);
      const hover = (ratio) => s.ev(`(() => {
        const frame = document.querySelector('.comparison-graph-frame');
        if (!frame) return;
        const box = frame.getBoundingClientRect();
        frame.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, clientX: box.left + box.width * ${ratio}, clientY: box.top + box.height / 2 }));
      })()`);
      const tl = timeline(s);
      for (let k = 0; k <= 20; k++) tl.at(0.2 + k * 0.06, () => hover(0.35 + k * 0.02));
      await rec(s, 'graph', 1.8, tl);
      await s.close();
    }
    // Languages
    for (const lang of ['ar', 'zh', 'hi', 'de']) {
      const s = await begin({ config: { ui: { language: lang } } });
      await s.sleep(800);
      await s.advance(600);
      await rec(s, `lang_${lang}`, 0.8);
      await s.close();
    }
    // Hotkeys page
    {
      const s = await begin({
        config: { globalHotkeys: { enabled: true, hotkeys: { 'light.living_room': 'Ctrl+Alt+L', 'scene.movie_night': 'Ctrl+Alt+M', 'lock.front_door': 'Ctrl+Alt+D' } } },
      });
      await s.click('#settings-btn');
      await s.advance(300);
      await s.click('#settings-modal .tab-link[data-tab="hotkeys"]');
      await s.advance(900);
      await s.sleep(300);
      await s.advance(300);
      await rec(s, 'hotkeys', 0.8);
      // Advanced: updates + settings files
      await s.click('#settings-modal .tab-link[data-tab="advanced"]');
      await s.advance(900);
      await s.sleep(300);
      await s.advance(300);
      await rec(s, 'advanced', 0.8);
      await s.ev(`document.getElementById('export-settings-file')?.scrollIntoView({ block: 'center' })`);
      await s.advance(600);
      await rec(s, 'export', 0.8);
      await s.close();
    }
  },

  async graph() {
    const graphPage = { id: 'default', name: 'Climate', entityIds: ['graph:temps', 'climate.thermostat', 'sensor.office_temp', 'sensor.bedroom_temp'] };
    const s = await begin({
      faketime: true,
      config: {
        customTabs: [graphPage, world.PAGES.bedroom],
        comparisonGraphs: [{ id: 'graph:temps', name: 'Temperatures', span: 3, entityIds: ['sensor.outdoor_temp', 'sensor.office_temp', 'sensor.bedroom_temp'] }],
      },
    });
    // Nudge a refetch on the virtual clock: a fresh reading for each graphed sensor.
    const st = (id) => s.server.states.find((x) => x.entity_id === id);
    s.server.changeStates({ add: ['sensor.outdoor_temp', 'sensor.office_temp', 'sensor.bedroom_temp'].map((id) => ({ ...st(id), last_updated: new Date().toISOString() })) });
    for (let k = 0; k < 40; k++) {
      const ok = await s.ev(`document.querySelectorAll('.comparison-graph-frame polyline, .comparison-graph-frame path').length >= 3`);
      if (ok) break;
      await s.sleep(250);
      await s.advance(250);
    }
    console.log('graph lines', await s.ev(`document.querySelectorAll('.comparison-graph-frame polyline').length`));
    const hover = (ratio) => s.ev(`(() => {
      const frame = document.querySelector('.comparison-graph-frame');
      if (!frame) return;
      const box = frame.getBoundingClientRect();
      frame.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, clientX: box.left + box.width * ${ratio}, clientY: box.top + box.height / 2 }));
    })()`);
    const tl = timeline(s);
    for (let k = 0; k <= 24; k++) tl.at(0.15 + k * 0.06, () => hover(0.3 + k * 0.02));
    await rec(s, 'graph', 1.8, tl);
    await s.close();
  },

  async camlive() {
    // A camera without a tile preview opens the viewer with Snapshot and Live.
    // The camera reports 'streaming', so the viewer's status line reads Streaming rather than Idle.
    const s = await begin({
      config: { activeTabId: 'security', quickAccessTileOptions: {} },
      statesPatch: (states) => {
        states.find((x) => x.entity_id === 'camera.porch').state = 'streaming';
      },
    });
    const liveShown = `(() => { const m = document.querySelector('.camera-modal'); const img = m && [...m.querySelectorAll('img')].find((i) => i.naturalWidth > 0 && /stream/.test(i.src)); return !!img; })()`;
    const waitLive = async () => {
      for (let k = 0; k < 60 && !(await s.ev(liveShown)); k++) await s.sleep(150);
    };
    const tl = timeline(s)
      .at(0.05, () => s.click(tileSel('camera.porch')))
      .at(0.55, () => s.click('.camera-modal #live-btn'))
      .at(0.6, waitLive)
      // No keyboard focus ring left on a toolbar button.
      .at(0.65, () => s.ev('document.activeElement?.blur?.()'))
      .at(0.7, waitLive);
    await rec(s, 'camera', 2.2, tl);
    console.log('live badge', await s.ev(`document.querySelector('.camera-modal')?.innerText.slice(0, 120)`));
    await s.close();
  },

  async hotkeys() {
    const s = await begin({
      config: {
        popupHotkey: 'Ctrl+Shift+Space',
        popupHotkeyToggleMode: true,
        globalHotkeys: { enabled: true, hotkeys: { 'light.living_room': 'Ctrl+Alt+L', 'scene.movie_night': 'Ctrl+Alt+M', 'lock.front_door': 'Ctrl+Alt+D' } },
      },
    });
    await s.click('#settings-btn');
    await s.advance(300);
    await s.click('#settings-modal .tab-link[data-tab="hotkeys"]');
    await s.advance(900);
    await s.sleep(300);
    await s.advance(300);
    await rec(s, 'hotkeys', 0.8);
    console.log('popup field', await s.ev(`document.querySelector('#settings-modal')?.innerText.match(/Popup hotkey[\\s\\S]{0,200}/)?.[0]`));
    await s.close();
  },

  // 4.0's settings files (export, import, backups) for the rapid cuts; no focus ring left on the rail.
  async exportfiles() {
    const s = await begin({});
    await s.click('#settings-btn');
    await s.advance(300);
    await s.click('#settings-modal .tab-link[data-tab="advanced"]');
    await s.advance(900);
    await s.sleep(300);
    await s.ev(`document.getElementById('export-settings-file')?.scrollIntoView({ block: 'center' })`);
    await s.ev('document.activeElement?.blur?.()');
    await s.advance(600);
    await s.sleep(200);
    await rec(s, 'export', 0.8);
    await s.close();
  },

  async halloweentall() {
    // The moon sits 12% down the window. At 2200 tall that is below the tile row (which ends near
    // y=188), so the whole moon shows and the witch, who flies the moon's lane, crosses it in the open.
    const height = Number(process.env.HW_H || 2200);
    const s = await begin({ seed: Number(process.env.SEED || 11), config: { ...SKY, windowSize: { width: 500, height }, windowPosition: { x: 20, y: 20 } } });
    await s.updateConfig(holidayCfg('halloween'));
    await s.sleep(1000);
    await s.advance(400);
    s.clip = { x: 0, y: 0, width: 500, height: 800 }; // the camera never sees below this
    await rec(s, 'halloween', 12);
    await s.close();
  },

  async christmastall() {
    // The sleigh flies 10–25% down the window. At 2200 tall every such lane (220–550) is open sky
    // below the tiles, where its arc no longer dips behind them.
    const height = Number(process.env.XM_H || 2200);
    const s = await begin({ seed: Number(process.env.SEED || 5), config: { ...SKY, windowSize: { width: 500, height }, windowPosition: { x: 20, y: 20 } } });
    await s.updateConfig(holidayCfg('christmas'));
    await s.sleep(1000);
    await s.advance(400);
    s.clip = { x: 0, y: 0, width: 500, height: 800 };
    await rec(s, process.env.XM_NAME || 'holiday_christmas_tall', Number(process.env.XM_SECS || 13));
    await s.close();
  },

  async pins() {
    const s = await begin({ config: { activeTabId: 'default' } });
    const list = ['light.living_room', 'climate.thermostat', 'lock.front_door', 'cover.garage_door'];
    const out = path.join(FOOTAGE, 'pins');
    fs.rmSync(out, { recursive: true, force: true });
    fs.mkdirSync(out, { recursive: true });
    const { connectCdp } = require('../rig/session.cjs');
    for (const id of list) {
      const r = await s.ev(`window.electronAPI.pinEntityToDesktop(${JSON.stringify(id)})`);
      if (!r?.success) { console.warn('pin failed', id, r?.error); continue; }
      await s.sleep(2500);
      const targets = await s.listTargets();
      const t = targets.find((e) => e.type === 'page' && e.url.includes('mode=desktop-pin') && decodeURIComponent(e.url).includes(`entityId=${id}`));
      if (!t) { console.warn('no pin target', id); continue; }
      const pin = await connectCdp(t.webSocketDebuggerUrl);
      await s.sleep(800);
      const { data } = await pin.send('Page.captureScreenshot', { format: 'png' });
      fs.writeFileSync(path.join(out, `${id}.png`), Buffer.from(data, 'base64'));
      pin.close();
    }
    await s.close();
  },

  async icons() {
    const s = await begin({});
    const all = {};
    for (const page of ['default', 'bedroom', 'security', 'office']) {
      await s.click(`#quick-access-tabs .quick-access-tab-link[data-tab="${page}"]`);
      await s.advance(800);
      await s.sleep(200);
      Object.assign(all, await s.ev(`Object.fromEntries([...document.querySelectorAll('#quick-controls .control-item')].map((t) => [t.dataset.entityId, { name: t.querySelector('.control-name, .item-name, [class*="name"]')?.textContent?.trim(), status: t.querySelector('[class*="status"], [class*="state"]')?.textContent?.trim(), svg: t.querySelector('svg')?.outerHTML }]))`));
    }
    fs.mkdirSync(path.join(FOOTAGE, 'icons'), { recursive: true });
    fs.writeFileSync(path.join(FOOTAGE, 'icons', 'icons.json'), JSON.stringify(all, null, 1));
    await s.close();
  },
};
Object.assign(SHOTS, MORE);

(async () => {
  const names = process.argv.slice(2);
  const failed = [];
  for (const name of names) {
    if (!SHOTS[name]) throw new Error(`No shot ${name}`);
    const t0 = Date.now();
    console.log(`== ${name}`);
    try {
      await SHOTS[name]();
    } catch (error) {
      console.error(`!! ${name} failed:`, error);
      failed.push(name);
      // Never leave this batch's app running: the next shot would attach to it.
      try {
        require('child_process').execSync(`pkill -9 -f "[r]emote-debugging-port=${process.env.CDP_PORT || 9444}"`);
      } catch {}
      await new Promise((r) => setTimeout(r, 1500));
    }
    console.log(`== ${name} done in ${((Date.now() - t0) / 1000).toFixed(0)}s`);
  }
  // Keep going past a failed shot, but report it and exit nonzero, so run.sh fails too.
  if (failed.length) console.error(`!! failed: ${failed.join(' ')}`);
  process.exit(failed.length ? 1 : 0);
})();

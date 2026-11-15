// A short loop of the real widget for the website: toggle lights, switch pages, Ctrl+K a scene.
const path = require('path');
const R = path.resolve(__dirname, '..', 'launch-4.0');
const { begin, tileSel } = require(R + '/shots/common.cjs');
const OUT = process.argv[2];
const FPS = 30;
(async () => {
  const s = await begin({ dsf: 2, statesPatch: (st) => {
    const set = (id, state, attrs) => { const e = st.find((x) => x.entity_id === id); e.state = state; e.attributes = { ...e.attributes, ...attrs }; };
    set('light.living_room', 'on', { brightness: 46, color_temp_kelvin: 2400, color_mode: 'color_temp' });
    set('light.kitchen', 'off', { brightness: null, color_mode: null });
    set('light.accent_strip', 'on', { brightness: 120, rgb_color: [150, 90, 255], color_mode: 'rgb' });
    set('cover.blinds', 'closed', { current_position: 0 });
  } });
  await s.ev(`window.__allowToasts = false`);
  const tab = (id) => `#quick-access-tabs .quick-access-tab-link[data-tab="${id}"]`;
  const typeWord = (w, start, gap) => w.split('').map((ch, i) => [start + i * gap, () => s.typeChar(ch)]);
  const steps = [
    [0.7, () => s.click(tileSel('light.kitchen'))],
    [1.4, () => s.click(tileSel('light.living_room'))],
    [2.3, () => s.click(tab('bedroom'))],
    [3.1, () => s.click(tileSel('light.bedside'))],
    [4.0, () => s.click(tab('default'))],
    [4.8, () => s.pressKey('k', { code: 'KeyK', keyCode: 75, modifiers: 2 })],
    ...typeWord('movie', 5.3, 0.12),
    [6.3, () => s.pressKey('ArrowDown', { code: 'ArrowDown', keyCode: 40 })],
    [6.7, async () => { await s.pressKey('Enter', { code: 'Enter', keyCode: 13, text: '\r' }); await s.sleep(600); }],
    [6.8, () => s.sleep(400)],
  ].sort((a, b) => a[0] - b[0]);
  let k = 0;
  await s.record(OUT, Math.round(9.0 * FPS), {
    fps: FPS,
    onFrame: async (i) => {
      const t = i / FPS;
      while (k < steps.length && steps[k][0] <= t) { await steps[k][1]().catch((e) => console.warn(e.message)); k++; }
    },
  });
  await s.close();
  process.exit(0);
})();

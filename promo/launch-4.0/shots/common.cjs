const path = require('path');
const { startSession } = require('../rig/session.cjs');
const world = require('../rig/world.cjs');

const FOOTAGE = path.join(__dirname, '..', 'footage');
// Friday evening, the day before Halloween.
const VDATE = new Date('2026-10-30T19:41:58').getTime();

const TOAST_KILLER = `(() => {
  if (window.__toastKiller) return;
  const kill = () => {
    if (window.__allowToasts) return;
    document.querySelectorAll('#toast-container .toast').forEach((t) => t.remove());
  };
  window.__toastKiller = new MutationObserver(kill);
  const c = document.getElementById('toast-container');
  if (c) window.__toastKiller.observe(c, { childList: true, subtree: true });
  kill();
})()`;

/** Start the app on the demo home and get it to a settled, virtual-time state. */
async function begin({ config = {}, dsf = 3, seed = 7, port, vdate = VDATE, statesPatch = null, reducedMotion = false, haPort = 0, haHost, faketime = false } = {}) {
  const m = world.mock(new Date(vdate));
  if (statesPatch) statesPatch(m.states);
  const env = faketime
    ? {
        // The app's wall clock starts at the spot's evening, so data it fetches before virtual time
        // takes over (history) already belongs to the same day. Monotonic time stays real.
        LD_PRELOAD: '/usr/lib/x86_64-linux-gnu/faketime/libfaketimeMT.so.1',
        FAKETIME: `@${new Date(vdate - 8000).toISOString().replace('T', ' ').slice(0, 19)}`,
        FAKETIME_DONT_FAKE_MONOTONIC: '1',
        TZ: 'UTC',
      }
    : {};
  const s = await startSession({ config: world.buildConfig(config), mock: m, dsf, port, reducedMotion, haPort, haHost, env });
  await s.waitForExpr(`document.querySelectorAll('#quick-controls .control-item').length > 0`, 'tiles', 45000);
  await s.ev(TOAST_KILLER);
  // The capture machine renders on the CPU, where the app holds seasonal art still to save power.
  // Shoot it as it runs on a GPU: keep the software-rendering flag off.
  await s.ev(`(() => {
    const strip = () => document.body.classList.contains('software-rendering') && document.body.classList.remove('software-rendering');
    new MutationObserver(strip).observe(document.body, { attributes: true, attributeFilter: ['class'] });
    strip();
  })()`);
  await s.sleep(2500);
  await s.ev(TOAST_KILLER);
  await s.ev(`document.activeElement?.blur?.()`);
  await s.enableVt(vdate);
  await s.ev(`window.__vt.seed(${seed})`);
  // Re-run the UI tick so the clock and its next tick move onto the virtual clock.
  await s.ev(`window.dispatchEvent(new Event('focus'))`);
  // Let the UI tick pick up the virtual clock, and entrance animations finish.
  await s.advance(1500);
  await s.sleep(300);
  await s.advance(500);
  return s;
}

/** Change entity states on the mock and wait (real time) until the app has them. */
async function setStates(s, changes, check) {
  s.server.changeStates({ add: changes });
  await s.sleep(120);
  if (check) await s.waitForExpr(check, check, 5000).catch(() => {});
}

function entity(id, state, attributes) {
  const now = new Date().toISOString();
  return { entity_id: id, state, attributes, last_changed: now, last_updated: now, context: { id, parent_id: null, user_id: null } };
}

function tileSel(entityId) {
  return `#quick-controls .control-item[data-entity-id="${entityId}"]`;
}

module.exports = { FOOTAGE, VDATE, begin, setStates, entity, tileSel, world };

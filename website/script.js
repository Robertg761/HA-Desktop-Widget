// The hero widget is a working demo of the 4.0 main window: shared entity state
// renders into the grid and into any pinned copies, so a pinned lamp keeps
// toggling wherever you drop it.
import { WeatherEffectsManager } from '/weather-effects.js';
import '/site.js'; // nav, reveals and download links

const stage = document.getElementById('stage');

const store = {
  get(key, fallback) {
    try { return JSON.parse(localStorage.getItem('hdw-' + key)) ?? fallback; }
    catch { return fallback; }
  },
  set(key, value) {
    try { localStorage.setItem('hdw-' + key, JSON.stringify(value)); } catch { /* private mode */ }
  },
};
const narrowQuery = matchMedia('(max-width: 760px)');
const finePointer = matchMedia('(pointer: fine)');
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
const icon = (name) => `<svg class="ico" aria-hidden="true"><use href="/assets/icons.svg#i-${name}"/></svg>`;

/* ---------------- Demo entities ---------------- */

const ENTITIES = {
  'light.desk': { icon: 'bulb', name: 'Desk lamp', type: 'light', on: true, bri: 80 },
  'light.shelf': { icon: 'bulb', name: 'Shelf LEDs', type: 'light', on: false, bri: 60 },
  'switch.coffee': { icon: 'plug', name: 'Coffee maker', type: 'switch', on: false },
  'sensor.office': { icon: 'thermo', name: 'Office temp', type: 'sensor', val: 21.4, unit: '°C' },
  'binary.door': { icon: 'door-closed', iconOn: 'door-open', name: 'Front door', type: 'binary', on: false },
  'scene.movie': { icon: 'sparkles', name: 'Movie time', type: 'scene' },
  'light.bedside': { icon: 'bulb', name: 'Bedside lamp', type: 'light', on: false, bri: 35 },
  'fan.bedroom': { icon: 'fan', name: 'Ceiling fan', type: 'switch', on: true },
  'cover.blinds': { icon: 'blinds', name: 'Blinds', type: 'cover', on: false },
  'sensor.bedroom': { icon: 'thermo', name: 'Bedroom temp', type: 'sensor', val: 19.6, unit: '°C' },
};
const PAGES = {
  home: ['light.desk', 'light.shelf', 'switch.coffee', 'sensor.office', 'binary.door', 'scene.movie'],
  bedroom: ['light.bedside', 'fan.bedroom', 'cover.blinds', 'sensor.bedroom'],
};
Object.entries(store.get('ents', {})).forEach(([id, saved]) => {
  if (ENTITIES[id]) Object.assign(ENTITIES[id], saved);
});

function saveEntities() {
  const out = {};
  for (const [id, e] of Object.entries(ENTITIES)) {
    if (e.type === 'light') out[id] = { on: e.on, bri: e.bri };
    else if (e.type === 'switch' || e.type === 'cover') out[id] = { on: e.on };
  }
  store.set('ents', out);
}

function stateText(e) {
  if (e.type === 'binary' || e.type === 'cover') return e.on ? 'Open' : 'Closed';
  if (e.type === 'scene') return e.flash ? 'Activated' : '';
  if (e.type === 'light' && e.on) return `${e.bri}%`;
  return e.on ? 'On' : 'Off';
}

function accentRgb() {
  return getComputedStyle(document.documentElement).getPropertyValue('--accent-rgb').trim() || '100, 181, 246';
}

function paint(id, pulse = false) {
  const e = ENTITIES[id];
  document.querySelectorAll(`.qa[data-id="${CSS.escape(id)}"]`).forEach((el) => {
    if (e.type === 'sensor') {
      el.querySelector('.qa-num').textContent = e.val.toFixed(1);
    } else {
      const active = e.type === 'scene' ? !!e.flash : !!e.on;
      const was = el.getAttribute('aria-pressed') === 'true';
      el.setAttribute('aria-pressed', String(active));
      el.querySelector('.qa-state').textContent = stateText(e);
      if (e.iconOn) el.querySelector('use').setAttribute('href', `/assets/icons.svg#i-${e.on ? e.iconOn : e.icon}`);
      // A short swell when something turns on, like the app.
      if (active && !was && !reducedMotion.matches) {
        el.querySelector('.qa-icon').animate(
          [{ transform: 'scale(1)' }, { transform: 'scale(1.18)' }, { transform: 'scale(1)' }],
          { duration: 420, easing: 'cubic-bezier(0.16, 1, 0.3, 1)' }
        );
      }
    }
    if (pulse && !reducedMotion.matches) {
      el.animate(
        [{ boxShadow: `0 0 0 2px rgba(${accentRgb()}, 0.6)` }, { boxShadow: 'none' }],
        { duration: 600, easing: 'cubic-bezier(0.16, 1, 0.3, 1)' }
      );
    }
  });
}

/* A tile is a slot holding the entity control plus sibling buttons (controls,
   pin), so no interactive element is nested inside another. Sensors are
   readouts, not buttons. */
function renderTile(id, pinned = false) {
  const e = ENTITIES[id];
  const slot = document.createElement('div');
  slot.className = 'qa-slot' + (pinned ? ' pinned' : '');

  const el = document.createElement(e.type === 'sensor' ? 'div' : 'button');
  el.className = 'qa' + (e.type === 'sensor' ? ' qa-sensor' : '');
  el.dataset.id = id;
  if (e.type === 'sensor') el.setAttribute('role', 'status');
  else {
    el.type = 'button';
    el.setAttribute('aria-pressed', 'false');
  }
  if (e.type === 'light') el.title = 'Click to toggle · hold for brightness';
  el.innerHTML = e.type === 'sensor'
    ? `<span class="qa-icon">${icon(e.icon)}</span>
       <span class="qa-name">${e.name}</span>
       <span class="qa-value"><span class="qa-num"></span><span class="qa-unit">${e.unit}</span></span>`
    : `<span class="qa-icon">${icon(e.icon)}</span>
       <span class="qa-name">${e.name}</span>
       <span class="qa-state"></span>`;
  slot.append(el);

  if (e.type === 'light') {
    const controls = document.createElement('button');
    controls.type = 'button';
    controls.className = 'tile-ctl';
    controls.setAttribute('aria-label', `${e.name} controls`);
    controls.title = 'Controls';
    controls.innerHTML = icon('sliders');
    controls.addEventListener('click', () => { markInteracted(); openBrightness(id, controls); });
    slot.append(controls);
  }

  const pinBtn = document.createElement('button');
  pinBtn.type = 'button';
  pinBtn.className = 'pin-btn';
  pinBtn.setAttribute('aria-label', pinned ? 'Unpin tile' : 'Pin tile to the desktop');
  pinBtn.title = pinned ? 'Unpin' : 'Pin to desktop';
  pinBtn.innerHTML = icon(pinned ? 'x' : 'pin');
  slot.append(pinBtn);

  wireTile(slot, el, pinBtn, id, pinned);
  return slot;
}

const hint = document.getElementById('demo-hint');
let interacted = false;
function markInteracted() {
  if (!interacted && hint) { interacted = true; hint.classList.add('dim'); }
}

function toggleEntity(id) {
  const e = ENTITIES[id];
  markInteracted();
  if (e.type === 'sensor') return;
  if (e.type === 'scene') {
    e.flash = true;
    paint(id);
    setTimeout(() => { e.flash = false; paint(id); }, 1400);
    return;
  }
  e.on = !e.on;
  paint(id);
  if (e.type !== 'binary') saveEntities();
}

/* ---------------- Brightness dialog ---------------- */

/* Hold a light, right-click it, or use its controls button, like the app. */
const pop = document.getElementById('bright-pop');
const popName = document.getElementById('bright-name');
const popValue = document.getElementById('bright-value');
const popSlider = document.getElementById('bright-slider');
const popPower = document.getElementById('bright-power');
let popTarget = null;
let popOpener = null;

function syncBrightness() {
  const e = ENTITIES[popTarget];
  popValue.textContent = e.on ? `${e.bri}%` : 'Off';
  popSlider.value = e.bri;
  popSlider.style.setProperty('--fill', `${e.bri}%`);
  popPower.textContent = e.on ? 'Turn off' : 'Turn on';
  pop.classList.toggle('is-off', !e.on);
}
function openBrightness(id, opener) {
  popTarget = id;
  popOpener = opener || null;
  popName.textContent = ENTITIES[id].name;
  syncBrightness();
  pop.hidden = false;
  if (finePointer.matches) popSlider.focus();
}
function closeBrightness() {
  pop.hidden = true;
  popTarget = null;
  if (popOpener) { popOpener.focus(); popOpener = null; }
}
function applyBrightness(bri) {
  if (!popTarget) return;
  const e = ENTITIES[popTarget];
  e.bri = bri;
  e.on = bri > 0;
  syncBrightness();
  paint(popTarget);
  saveEntities();
}
popSlider.addEventListener('input', () => applyBrightness(Number(popSlider.value)));
document.querySelectorAll('.bright-presets button').forEach((b) =>
  b.addEventListener('click', () => applyBrightness(Number(b.dataset.preset)))
);
popPower.addEventListener('click', () => {
  const e = ENTITIES[popTarget];
  e.on = !e.on;
  paint(popTarget);
  saveEntities();
  closeBrightness();
});
document.querySelectorAll('[data-close-bright]').forEach((b) => b.addEventListener('click', closeBrightness));
/* Tap the dimmed backdrop to dismiss: phones have no Escape key. */
pop.addEventListener('pointerdown', (ev) => {
  if (ev.target === pop) closeBrightness();
});
document.addEventListener('keydown', (ev) => {
  if (ev.key === 'Escape' && !pop.hidden) closeBrightness();
});

function wireTile(slot, el, pinBtn, id, pinned) {
  const e = ENTITIES[id];
  let holdTimer = null;
  let held = false;
  let dragged = false;

  if (e.type === 'light' && !pinned) {
    let sx = 0, sy = 0;
    el.addEventListener('pointerdown', (ev) => {
      if (ev.button !== 0) return;
      sx = ev.clientX; sy = ev.clientY;
      held = false;
      holdTimer = setTimeout(() => { held = true; markInteracted(); openBrightness(id, el); }, 500);
    });
    const cancel = () => clearTimeout(holdTimer);
    /* A finger that starts scrolling is not a hold. */
    el.addEventListener('pointermove', (ev) => {
      if (Math.abs(ev.clientX - sx) + Math.abs(ev.clientY - sy) > 10) cancel();
    });
    el.addEventListener('pointerup', cancel);
    el.addEventListener('pointerleave', cancel);
    el.addEventListener('pointercancel', cancel);
    el.addEventListener('contextmenu', (ev) => {
      ev.preventDefault();
      clearTimeout(holdTimer);
      markInteracted();
      openBrightness(id, el);
    });
  }

  if (e.type !== 'sensor') {
    el.addEventListener('click', () => {
      if (held) { held = false; return; }
      if (dragged) { dragged = false; return; }
      toggleEntity(id);
    });
  }

  pinBtn.addEventListener('click', () => {
    markInteracted();
    if (pinned) unpin(id, slot);
    else pin(id);
  });

  if (pinned) {
    el.addEventListener('pointerdown', (ev) => {
      ev.preventDefault();
      const dx = ev.clientX - slot.offsetLeft;
      const dy = ev.clientY - slot.offsetTop;
      let moved = false;
      el.setPointerCapture(ev.pointerId);
      const move = (mv) => {
        if (Math.abs(mv.clientX - ev.clientX) + Math.abs(mv.clientY - ev.clientY) > 4) moved = true;
        placePinned(slot, mv.clientX - dx, mv.clientY - dy);
      };
      el.addEventListener('pointermove', move);
      el.addEventListener('pointerup', () => {
        el.removeEventListener('pointermove', move);
        dragged = moved;
        if (moved) savePins();
      }, { once: true });
    });
    // Arrow keys nudge a focused pinned tile, so pinning isn't pointer-only.
    el.addEventListener('keydown', (ev) => {
      const step = { ArrowLeft: [-10, 0], ArrowRight: [10, 0], ArrowUp: [0, -10], ArrowDown: [0, 10] }[ev.key];
      if (!step) return;
      ev.preventDefault();
      placePinned(slot, slot.offsetLeft + step[0], slot.offsetTop + step[1]);
      savePins();
    });
  }
}

/* ---------------- Desktop pins ---------------- */

/* Pins sit on the demo wallpaper, not the page, so they stay with the desktop. */
const STAGE_BAR = 38;
const pinnedEls = new Map();

function placePinned(slot, x, y) {
  const maxX = stage.clientWidth - slot.offsetWidth - 8;
  const maxY = stage.clientHeight - slot.offsetHeight - 8;
  slot.style.left = Math.max(8, Math.min(maxX, x)) + 'px';
  slot.style.top = Math.max(STAGE_BAR, Math.min(maxY, y)) + 'px';
}

function pin(id, x, y) {
  if (pinnedEls.has(id) || narrowQuery.matches) return;
  const slot = renderTile(id, true);
  stage.appendChild(slot);
  const n = pinnedEls.size;
  // Two columns fit left of the widget on a wide stage; one column otherwise.
  const cols = stage.clientWidth >= 1020 ? 2 : 1;
  placePinned(slot, x ?? 24 + (n % cols) * 128, y ?? 54 + Math.floor(n / cols) * 118);
  pinnedEls.set(id, slot);
  paint(id);
  savePins();
}
function unpin(id, slot) {
  slot.remove();
  pinnedEls.delete(id);
  savePins();
}
function savePins() {
  const out = {};
  for (const [id, slot] of pinnedEls) out[id] = { x: slot.offsetLeft, y: slot.offsetTop };
  store.set('pins', out);
}
/* Below the breakpoint the stage stacks vertically and has no room for pins. */
narrowQuery.addEventListener('change', (ev) => {
  if (ev.matches) for (const [id, slot] of [...pinnedEls]) unpin(id, slot);
});

/* ---------------- Pages ---------------- */

const grid = document.getElementById('qa-grid');
const tabs = document.querySelector('.page-tabs');
let currentPage = null;

function showPage(page) {
  if (page === currentPage) return;
  const from = Object.keys(PAGES).indexOf(currentPage);
  const to = Object.keys(PAGES).indexOf(page);
  currentPage = page;
  grid.replaceChildren(...PAGES[page].map((id) => renderTile(id)));
  PAGES[page].forEach((id) => paint(id));
  tabs.querySelectorAll('button').forEach((b) => {
    const on = b.dataset.page === page;
    b.classList.toggle('is-on', on);
    b.setAttribute('aria-selected', String(on));
  });
  tabs.style.setProperty('--pill-x', `${to * 100}%`);
  // Tiles slide in from the side of the page you picked.
  if (from !== -1 && !reducedMotion.matches) {
    const dir = to > from ? 1 : -1;
    grid.animate(
      [{ opacity: 0, transform: `translateX(${dir * 18}px)` }, { opacity: 1, transform: 'none' }],
      { duration: 320, easing: 'cubic-bezier(0.16, 1, 0.3, 1)' }
    );
  }
}
tabs.addEventListener('click', (ev) => {
  const b = ev.target.closest('button');
  if (!b) return;
  markInteracted();
  showPage(b.dataset.page);
});
showPage('home');

if (!narrowQuery.matches) {
  Object.entries(store.get('pins', {})).forEach(([id, p]) => {
    if (ENTITIES[id]) pin(id, p.x, p.y);
  });
}

/* The sensors drift, so the "real-time" claim is visible. The ring only
   pulses the first couple of times; after that it would just be blinking. */
let sensorPulses = 0;
setInterval(() => {
  for (const id of ['sensor.office', 'sensor.bedroom']) {
    const s = ENTITIES[id];
    s.val = Math.max(17, Math.min(26, Math.round((s.val + (Math.random() - 0.5) * 0.4) * 10) / 10));
  }
  paint('sensor.office', sensorPulses < 2);
  paint('sensor.bedroom');
  sensorPulses++;
}, 4000);

/* ---------------- Media card ---------------- */

const media = { playing: true, pos: 82, len: 243 };
const mediaPlay = document.getElementById('media-play');
const mediaPos = document.getElementById('media-pos');
const mediaBar = document.getElementById('media-bar');
const fmt = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
function paintMedia() {
  mediaPos.textContent = fmt(media.pos);
  mediaBar.style.width = `${(media.pos / media.len) * 100}%`;
  mediaPlay.innerHTML = icon(media.playing ? 'pause' : 'play');
  mediaPlay.setAttribute('aria-label', media.playing ? 'Pause' : 'Play');
}
mediaPlay.addEventListener('click', () => { markInteracted(); media.playing = !media.playing; paintMedia(); });
document.querySelectorAll('[data-skip]').forEach((b) =>
  b.addEventListener('click', () => {
    markInteracted();
    media.pos = b.dataset.skip === 'back' ? 0 : media.len - 1;
    paintMedia();
  })
);
setInterval(() => {
  if (!media.playing) return;
  media.pos = (media.pos + 1) % media.len;
  paintMedia();
}, 1000);
paintMedia();

/* ---------------- Clocks ---------------- */

const timeEl = document.getElementById('clock-time');
const dateEl = document.getElementById('clock-date');
const stageClock = document.getElementById('stage-clock');
function tick() {
  const now = new Date();
  const t = now.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  timeEl.textContent = t;
  timeEl.dateTime = now.toISOString();
  dateEl.textContent = now
    .toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' })
    .toUpperCase();
  if (stageClock) {
    stageClock.textContent = `${now.toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' })}  ${t}`;
  }
}
tick();
setTimeout(function align() {
  tick();
  setInterval(tick, 60_000);
}, (60 - new Date().getSeconds()) * 1000);

/* Connection dot: click for the readout self-hosters check for. */
const connDot = document.getElementById('conn-dot');
const connMeta = document.getElementById('conn-meta');
connDot.addEventListener('click', () => {
  markInteracted();
  connMeta.textContent = 'homeassistant.local · 10 entities · 18 ms';
  connMeta.parentElement.classList.add('show-meta');
  setTimeout(() => connMeta.parentElement.classList.remove('show-meta'), 3200);
});

/* ---------------- Personalization: accent + weather ---------------- */

function applyAccent(sw) {
  const root = document.documentElement.style;
  root.setProperty('--accent', sw.c);
  root.setProperty('--accent-rgb', sw.rgb);
  root.setProperty('--accent-hover', sw.hover);
  document.querySelectorAll('.swatch').forEach((b) => {
    const on = b.dataset.c === sw.c;
    b.classList.toggle('is-on', on);
    b.setAttribute('aria-pressed', String(on));
  });
}
document.querySelectorAll('.swatch').forEach((b) =>
  b.addEventListener('click', () => {
    markInteracted();
    const sw = { c: b.dataset.c, rgb: b.dataset.rgb, hover: b.dataset.hover };
    applyAccent(sw);
    store.set('accent', sw);
  })
);
const savedAccent = store.get('accent', null);
if (savedAccent) applyAccent(savedAccent);

/* Weather: the app's own engine (src/weather-effects.js, copied verbatim),
   running behind the frosted windows. Off by default; the visitor turns it on. */
class StageWeather extends WeatherEffectsManager {
  resizeCanvas() {
    if (!this.canvas) return;
    this.canvas.width = stage.clientWidth;
    this.canvas.height = stage.clientHeight;
    if (this.sun) {
      this.sun.x = this.canvas.width * 0.15;
      this.sun.y = this.canvas.height * 0.15;
    }
    if (this.activeEffect && this.prefersReducedMotion()) this.renderStaticFrame();
  }
}
const fx = new StageWeather('weather-canvas');
new ResizeObserver(() => fx.resizeCanvas()).observe(stage);
const fxBar = document.querySelector('.dock .seg');
const fxCanvas = document.getElementById('weather-canvas');
let currentFx = '';
function applyFx(effect, { fade = false } = {}) {
  currentFx = effect || '';
  const swap = () => {
    fx.setEffect(currentFx || null);
    fxCanvas.style.opacity = '1';
  };
  if (fade) {
    fxCanvas.style.opacity = '0';
    setTimeout(swap, 450);
  } else {
    swap();
  }
  fxBar.querySelectorAll('button').forEach((b) => {
    const on = b.dataset.fx === currentFx;
    b.classList.toggle('is-on', on);
    b.setAttribute('aria-pressed', String(on));
  });
}

/* The weather cycles on its own so visitors see every effect. Picking one by
   hand holds it for 45 seconds before the cycle picks up again from there. */
const FX_CYCLE = [...fxBar.querySelectorAll('button')].map((b) => b.dataset.fx);
const FX_STEP_MS = 7000;
const FX_HOLD_MS = 45000;
let fxNextAt = Date.now() + 3500;
fxBar.addEventListener('click', (ev) => {
  const b = ev.target.closest('button');
  if (!b) return;
  markInteracted();
  applyFx(b.dataset.fx);
  fxNextAt = Date.now() + FX_HOLD_MS;
});
setInterval(() => {
  if (fx.prefersReducedMotion() || document.hidden || !stageVisible) return;
  if (Date.now() < fxNextAt) return;
  const next = FX_CYCLE[(FX_CYCLE.indexOf(currentFx) + 1) % FX_CYCLE.length];
  applyFx(next, { fade: true });
  fxNextAt = Date.now() + FX_STEP_MS;
}, 500);

let stageVisible = true;
function syncFxLoop() {
  if (document.hidden || !stageVisible) fx.stopAnimation();
  else if (fx.activeEffect && !fx.prefersReducedMotion()) fx.startAnimation();
}
document.addEventListener('visibilitychange', syncFxLoop);
new IntersectionObserver(([entry]) => {
  stageVisible = entry.isIntersecting;
  syncFxLoop();
}).observe(stage);

/* ---------------- Ghost hand-off ---------------- */

/* Nothing says "this is live" like watching it get used: if the visitor hasn't
   touched anything a couple of seconds in, a ghost cursor drifts up, clicks the
   shelf lights on and off, and hands over. Any real input cancels it. The
   toggles bypass toggleEntity so the hint doesn't count them as the visitor. */
(async function ghostDemo() {
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  let cancelled = false;
  let ghost = null;
  const cancel = () => {
    cancelled = true;
    ghost?.remove();
    ghost = null;
  };
  ['pointerdown', 'keydown', 'wheel', 'touchstart', 'scroll'].forEach((t) =>
    addEventListener(t, cancel, { once: true, passive: true })
  );

  await sleep(1800);
  const target = document.querySelector('.qa[data-id="light.shelf"]');
  const widget = document.getElementById('widget-demo');
  if (cancelled || interacted || document.hidden || !target || !widget) return;
  const wr = widget.getBoundingClientRect();
  if (wr.bottom < 120 || wr.top > innerHeight - 120) return;

  const fine = finePointer.matches;
  const hx = fine ? 5 : 14;
  const hy = fine ? 3 : 14;
  ghost = document.createElement('div');
  ghost.className = 'ghost-cursor';
  ghost.setAttribute('aria-hidden', 'true');
  ghost.innerHTML = fine
    ? '<div class="ghost-inner"><svg width="22" height="22" viewBox="0 0 24 24"><path d="M5.5 3.2v17.6c0 .4.5.7.9.4l4.8-4.9h6.9c.4 0 .7-.5.4-.8L6.4 2.8c-.3-.3-.9-.1-.9.4z" fill="#f5f5f5" stroke="#10161c" stroke-width="1.3" stroke-linejoin="round"/></svg></div>'
    : '<div class="ghost-inner ghost-tap"></div>';
  const place = (x, y) => { ghost.style.transform = `translate(${x - hx}px, ${y - hy}px)`; };
  const tr = target.getBoundingClientRect();
  const tx = tr.left + tr.width / 2 + 4;
  const ty = tr.top + tr.height / 2 + 6;
  place(wr.left - 40, wr.bottom + 10);
  document.body.appendChild(ghost);
  requestAnimationFrame(() => {
    ghost?.classList.add('show');
    requestAnimationFrame(() => { if (ghost) place(tx, ty); });
  });
  await sleep(1150);

  const shelf = ENTITIES['light.shelf'];
  const press = (on) => {
    ghost.classList.add('press');
    setTimeout(() => ghost?.classList.remove('press'), 160);
    const rip = document.createElement('div');
    rip.className = 'ghost-ripple';
    rip.style.left = tx + 'px';
    rip.style.top = ty + 'px';
    document.body.appendChild(rip);
    setTimeout(() => rip.remove(), 600);
    shelf.on = on;
    paint('light.shelf', on);
  };
  if (cancelled) return;
  press(true);
  await sleep(1300);
  if (cancelled) return;
  press(false);
  await sleep(600);
  if (cancelled) return;
  ghost.classList.remove('show');
  setTimeout(() => ghost?.remove(), 400);
  if (!interacted && hint) hint.textContent = 'Your turn. Hold a light to dim it, or pin one to the desktop.';
})();


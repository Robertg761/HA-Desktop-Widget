// The hero widget is a working demo: shared entity state renders into the grid
// and into any pinned copies, so a pinned lamp keeps toggling wherever you drop it.
import { WeatherEffectsManager } from '/weather-effects.js';

const REPO = 'Robertg761/HA-Desktop-Widget';
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

/* ---------------- Demo entities ---------------- */

const ENTITIES = {
  'light.desk': { icon: '💡', name: 'Desk lamp', type: 'light', on: true, bri: 80 },
  'light.shelf': { icon: '✨', name: 'Shelf LEDs', type: 'light', on: false, bri: 60 },
  'switch.coffee': { icon: '☕', name: 'Coffee maker', type: 'switch', on: false },
  'sensor.office': { icon: '🌡️', name: 'Office temp', type: 'sensor', val: 21.4, unit: '°C' },
  'binary.door': { icon: '🚪', name: 'Front door', type: 'binary', on: false },
  'scene.movie': { icon: '🎬', name: 'Movie time', type: 'scene' },
};
Object.entries(store.get('ents', {})).forEach(([id, saved]) => {
  if (ENTITIES[id]) Object.assign(ENTITIES[id], saved);
});

function saveEntities() {
  const out = {};
  for (const [id, e] of Object.entries(ENTITIES)) {
    if (e.type === 'light') out[id] = { on: e.on, bri: e.bri };
    else if (e.type === 'switch') out[id] = { on: e.on };
  }
  store.set('ents', out);
}

function stateText(e) {
  if (e.type === 'sensor') return `${e.val.toFixed(1)}${e.unit}`;
  if (e.type === 'binary') return e.on ? 'Open' : 'Closed';
  if (e.type === 'scene') return e.flash ? 'Activated' : 'Scene';
  if (e.type === 'light' && e.on) return `${e.bri}%`;
  return e.on ? 'On' : 'Off';
}

function accentRgb() {
  return getComputedStyle(document.documentElement).getPropertyValue('--accent-rgb').trim() || '100, 181, 246';
}

function paint(id, pulse = false) {
  const e = ENTITIES[id];
  document.querySelectorAll(`.qa[data-id="${CSS.escape(id)}"]`).forEach((el) => {
    if (e.type !== 'sensor') {
      const active = e.type === 'scene' ? !!e.flash : !!e.on;
      el.setAttribute('aria-pressed', String(active));
    }
    el.querySelector('.qa-state').textContent = stateText(e);
    if (pulse && !matchMedia('(prefers-reduced-motion: reduce)').matches) {
      el.animate(
        [{ boxShadow: `0 0 0 2px rgba(${accentRgb()}, 0.6)` }, { boxShadow: 'none' }],
        { duration: 600, easing: 'cubic-bezier(0.16, 1, 0.3, 1)' }
      );
    }
  });
}

/* A tile is a slot holding the entity control plus a sibling pin button, so no
   interactive element is nested inside another. Sensors are readouts, not buttons. */
function renderTile(id, pinned = false) {
  const e = ENTITIES[id];
  const slot = document.createElement('div');
  slot.className = 'qa-slot' + (pinned ? ' pinned' : '');

  const el = document.createElement(e.type === 'sensor' ? 'div' : 'button');
  el.className = 'qa';
  el.dataset.id = id;
  if (e.type === 'sensor') el.setAttribute('role', 'status');
  else {
    el.type = 'button';
    el.setAttribute('aria-pressed', 'false');
  }
  if (e.type === 'light') el.title = 'Click to toggle · hold or right-click for brightness';
  el.innerHTML = `
    <span class="qa-icon" aria-hidden="true">${e.icon}</span>
    <span class="qa-name">${e.name}</span>
    <span class="qa-state"></span>`;

  const pinBtn = document.createElement('button');
  pinBtn.type = 'button';
  pinBtn.className = 'pin-btn';
  pinBtn.setAttribute('aria-label', pinned ? 'Unpin tile' : 'Pin tile to the page');
  pinBtn.title = pinned ? 'Unpin' : 'Pin to page';
  pinBtn.textContent = pinned ? '✕' : '📌';

  slot.append(el, pinBtn);
  wireTile(slot, el, pinBtn, id, pinned);
  return slot;
}

const hint = document.getElementById('demo-hint');
if (hint && narrowQuery.matches) hint.textContent = 'Go on, tap one. Hold a light to dim it.';
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
  if (e.type === 'binary') { e.on = !e.on; paint(id); return; }
  e.on = !e.on;
  paint(id);
  saveEntities();
}

/* Long-press (or right-click) a light for the brightness popover, like the app. */
const pop = document.getElementById('bright-pop');
const popName = document.getElementById('bright-name');
const popValue = document.getElementById('bright-value');
const popSlider = document.getElementById('bright-slider');
let popTarget = null;
let popOpener = null;

function openBrightness(id, opener) {
  const e = ENTITIES[id];
  popTarget = id;
  popOpener = opener || null;
  popName.textContent = e.name;
  popValue.textContent = `${e.bri}%`;
  popSlider.value = e.bri;
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
  popValue.textContent = `${bri}%`;
  paint(popTarget);
  saveEntities();
}
popSlider.addEventListener('input', () => applyBrightness(Number(popSlider.value)));
document.querySelectorAll('.bright-presets button').forEach((b) =>
  b.addEventListener('click', () => {
    popSlider.value = b.dataset.preset;
    applyBrightness(Number(b.dataset.preset));
  })
);
document.getElementById('bright-close').addEventListener('click', closeBrightness);
/* Tap the empty glass to dismiss: phones have no Escape key. */
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
    /* Right-click, or Shift+F10 / the menu key with the tile focused. */
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
      const rect = slot.getBoundingClientRect();
      const dx = ev.clientX - rect.left;
      const dy = ev.clientY - rect.top;
      let moved = false;
      el.setPointerCapture(ev.pointerId);
      const move = (mv) => {
        if (Math.abs(mv.clientX - ev.clientX) + Math.abs(mv.clientY - ev.clientY) > 4) moved = true;
        slot.style.left = Math.max(0, Math.min(innerWidth - rect.width, mv.clientX - dx)) + 'px';
        slot.style.top = Math.max(0, Math.min(innerHeight - rect.height, mv.clientY - dy)) + 'px';
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
      slot.style.left = Math.max(0, Math.min(innerWidth - slot.offsetWidth, slot.offsetLeft + step[0])) + 'px';
      slot.style.top = Math.max(0, Math.min(innerHeight - slot.offsetHeight, slot.offsetTop + step[1])) + 'px';
      savePins();
    });
  }
}

/* ---------------- Desktop pins ---------------- */

const pinnedEls = new Map();

function pin(id, x, y) {
  if (pinnedEls.has(id) || narrowQuery.matches) return;
  const slot = renderTile(id, true);
  const demo = document.getElementById('widget-demo').getBoundingClientRect();
  slot.style.left = (x ?? Math.min(demo.right + 24, innerWidth - 130)) + 'px';
  slot.style.top = (y ?? demo.top + 40 + pinnedEls.size * 30) + 'px';
  document.body.appendChild(slot);
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
/* A desktop window narrowed past the breakpoint would strand fixed tiles offscreen. */
narrowQuery.addEventListener('change', (ev) => {
  if (ev.matches) for (const [id, slot] of [...pinnedEls]) unpin(id, slot);
});

/* ---------------- Build the grid ---------------- */

const grid = document.getElementById('qa-grid');
Object.keys(ENTITIES).forEach((id) => {
  grid.appendChild(renderTile(id));
  paint(id);
});
if (!narrowQuery.matches) {
  Object.entries(store.get('pins', {})).forEach(([id, p]) => {
    if (ENTITIES[id]) pin(id, Math.min(p.x, innerWidth - 120), Math.min(p.y, innerHeight - 120));
  });
}

/* The office sensor drifts, so the "real-time" claim is visible. The ring only
   pulses the first couple of times; after that it would just be blinking. */
let sensorPulses = 0;
setInterval(() => {
  const s = ENTITIES['sensor.office'];
  s.val = Math.round((s.val + (Math.random() - 0.5) * 0.4) * 10) / 10;
  s.val = Math.max(18, Math.min(26, s.val));
  paint('sensor.office', sensorPulses++ < 2);
}, 4000);

/* ---------------- Clocks ---------------- */

const timeEl = document.getElementById('clock-time');
const dateEl = document.getElementById('clock-date');
const tbClock = document.getElementById('tb-clock');
function tick() {
  const now = new Date();
  const t = now.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  timeEl.textContent = t;
  timeEl.dateTime = now.toISOString();
  dateEl.textContent = now
    .toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' })
    .toUpperCase();
  if (tbClock) tbClock.textContent = t;
}
tick();
setTimeout(function align() {
  tick();
  setInterval(tick, 60_000);
}, (60 - new Date().getSeconds()) * 1000);

/* Connection dot: click for the readout self-hosters check for. */
const connDot = document.getElementById('conn-dot');
const connMeta = document.getElementById('conn-meta');
let connDefault = connMeta.textContent;
connDot.addEventListener('click', () => {
  markInteracted();
  connMeta.textContent = 'homeassistant.local:8123 · 6 entities · 18 ms';
  setTimeout(() => { connMeta.textContent = connDefault; }, 3200);
});

/* ---------------- Personalization: accent + weather ---------------- */

const accentReadout = document.getElementById('accent-readout');
function applyAccent(sw) {
  const root = document.documentElement.style;
  root.setProperty('--accent', sw.c);
  root.setProperty('--accent-rgb', sw.rgb);
  root.setProperty('--accent-hover', sw.hover);
  if (accentReadout) accentReadout.textContent = sw.c;
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
const fx = new WeatherEffectsManager('weather-canvas');
const fxBar = document.querySelector('.fx-switch');
function applyFx(effect) {
  fx.setEffect(effect || null);
  fxBar.querySelectorAll('button').forEach((b) => {
    const on = b.dataset.fx === (effect || '');
    b.classList.toggle('is-on', on);
    b.setAttribute('aria-pressed', String(on));
  });
}
fxBar.addEventListener('click', (ev) => {
  const b = ev.target.closest('button');
  if (!b) return;
  markInteracted();
  applyFx(b.dataset.fx);
  store.set('fx', b.dataset.fx);
});
const savedFx = store.get('fx', '');
if (savedFx) applyFx(savedFx);

document.addEventListener('visibilitychange', () => {
  if (document.hidden) fx.stopAnimation();
  else if (fx.activeEffect && !fx.prefersReducedMotion()) fx.startAnimation();
});

/* ---------------- OS detection + latest release ---------------- */

const ASSET_PATTERNS = {
  'win-setup': /win-x64-Setup\.exe$/,
  'win-portable': /win-x64-Portable\.exe$/,
  'mac-dmg': /universal\.dmg$/,
  'mac-zip': /universal-mac\.zip$/,
  'linux-appimage': /x86_64\.AppImage$/,
  'linux-deb': /amd64\.deb$/,
};

function detectOS() {
  const ua = navigator.userAgent;
  // Android UAs contain "Linux" and desktop-mode iPads say "Macintosh": a phone
  // gets no direct installer link, just the download section.
  if (/Android|iPhone|iPad|iPod/i.test(ua)) return null;
  if (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1) return null;
  if (/Windows/i.test(ua)) return { os: 'windows', label: 'Windows', arch: 'x64' };
  if (/Macintosh|Mac OS X/i.test(ua)) return { os: 'mac', label: 'macOS', arch: 'universal' };
  if (/Linux|X11/i.test(ua)) return { os: 'linux', label: 'Linux', arch: 'x64' };
  return null;
}

const detected = detectOS();
const osReadout = document.getElementById('os-readout');
if (detected) {
  osReadout.textContent = `${detected.os} · ${detected.arch}`;
  const card = document.querySelector(`.os-card[data-os="${detected.os}"]`);
  if (card) {
    card.classList.add('detected');
    const primary = card.querySelector('.btn-primary');
    const hero = document.getElementById('hero-download');
    if (primary && hero) {
      hero.textContent = `Download for ${detected.label}`;
      hero.dataset.follow = primary.dataset.asset;
    }
  }
} else {
  osReadout.textContent = 'unknown os';
}

// Fallback hrefs point at /releases/latest (never stale, never 404). The API
// call upgrades them to direct asset links and fills in the version string.
fetch(`https://api.github.com/repos/${REPO}/releases/latest`)
  .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
  .then((release) => {
    const tag = release.tag_name || '';
    if (tag) {
      document.getElementById('version-label').textContent = tag;
      document.getElementById('tb-version').textContent = tag;
      connDefault = tag;
      if (!connMeta.textContent.includes('·')) connMeta.textContent = tag;
    }
    const assets = release.assets || [];
    for (const [key, pattern] of Object.entries(ASSET_PATTERNS)) {
      const asset = assets.find((a) => pattern.test(a.name));
      if (!asset) continue;
      document.querySelectorAll(`[data-asset="${key}"]`).forEach((el) => {
        el.href = asset.browser_download_url;
      });
      const hero = document.getElementById('hero-download');
      if (hero && hero.dataset.follow === key) hero.href = asset.browser_download_url;
    }
  })
  .catch(() => {
    document.getElementById('tb-version').textContent = 'v3.9.1';
  });

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
  place(wr.right - 30, wr.bottom + 24);
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
  if (!interacted && hint) {
    hint.textContent = narrowQuery.matches
      ? 'Your turn. Hold a light to dim it.'
      : 'Your turn. Hold a light to dim it, pin one to the page.';
  }
})();

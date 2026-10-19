/* Compositor library: pure functions of time t. Nothing here animates on its own. */
'use strict';

const FPS = 60;
const W = 1920;
const H = 1080;
const FOOT = '../footage';

// ------------------------------------------------------------------ math & easing
const clamp = (x, a = 0, b = 1) => Math.min(b, Math.max(a, x));
const lerp = (a, b, u) => a + (b - a) * u;
const prog = (t, t0, t1) => clamp((t - t0) / (t1 - t0));
const E = {
  lin: (u) => u,
  inQuad: (u) => u * u,
  outQuad: (u) => 1 - (1 - u) * (1 - u),
  inOutQuad: (u) => (u < 0.5 ? 2 * u * u : 1 - Math.pow(-2 * u + 2, 2) / 2),
  outCubic: (u) => 1 - Math.pow(1 - u, 3),
  inCubic: (u) => u * u * u,
  inOutCubic: (u) => (u < 0.5 ? 4 * u * u * u : 1 - Math.pow(-2 * u + 2, 3) / 2),
  outQuart: (u) => 1 - Math.pow(1 - u, 4),
  inOutQuart: (u) => (u < 0.5 ? 8 * u * u * u * u : 1 - Math.pow(-2 * u + 2, 4) / 2),
  outExpo: (u) => (u >= 1 ? 1 : 1 - Math.pow(2, -10 * u)),
  inExpo: (u) => (u <= 0 ? 0 : Math.pow(2, 10 * u - 10)),
  inOutExpo: (u) =>
    u <= 0 ? 0 : u >= 1 ? 1 : u < 0.5 ? Math.pow(2, 20 * u - 10) / 2 : (2 - Math.pow(2, -20 * u + 10)) / 2,
  outBack: (u, s = 1.6) => 1 + (s + 1) * Math.pow(u - 1, 3) + s * Math.pow(u - 1, 2),
  // damped spring settling to 1
  spring: (u, k = 7, d = 5.5) => 1 - Math.exp(-d * u) * Math.cos(k * u),
};
/** Interpolate keyframes [[t, v], ...] with an easing per segment (eases applied to each segment). */
function kf(t, frames, ease = E.inOutCubic) {
  if (t <= frames[0][0]) return frames[0][1];
  for (let i = 0; i < frames.length - 1; i++) {
    const [t0, v0, e0] = frames[i];
    const [t1, v1] = frames[i + 1];
    if (t <= t1) {
      const u = (e0 || ease)((t - t0) / (t1 - t0));
      if (Array.isArray(v0)) return v0.map((x, k) => lerp(x, v1[k], u));
      return lerp(v0, v1, u);
    }
  }
  return frames[frames.length - 1][1];
}
// Deterministic noise for camera shake / drift.
function hash(n) {
  const s = Math.sin(n * 127.1) * 43758.5453;
  return s - Math.floor(s);
}
function vnoise(x) {
  const i = Math.floor(x);
  const f = x - i;
  const u = f * f * (3 - 2 * f);
  return lerp(hash(i), hash(i + 1), u) * 2 - 1;
}
const drift = (t, seed, amp, speed = 0.35) => vnoise(t * speed + seed * 17.3) * amp;

// ------------------------------------------------------------------ DOM helpers
const $ = (sel, root = document) => root.querySelector(sel);
function el(tag, cls, parent, html) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (html != null) e.innerHTML = html;
  if (parent) parent.appendChild(e);
  return e;
}
function css(e, styles) {
  for (const k in styles) {
    const v = styles[k];
    if (e.__s && e.__s[k] === v) continue;
    (e.__s || (e.__s = {}))[k] = v;
    e.style[k] = v;
  }
}
const px = (v) => `${v}px`;

// ------------------------------------------------------------------ footage
let MANIFEST = {};
const pendingDecodes = [];
const pad5 = (n) => String(n).padStart(5, '0');
function frameCount(dir) {
  return MANIFEST[dir] || 1;
}
/** Point an <img> at footage `dir` at footage time `ft` seconds (frame clamped to range). */
function setFrame(img, dir, ft, fps = FPS) {
  const n = frameCount(dir);
  const f = clamp(Math.round(ft * fps), 0, n - 1);
  const src = `${FOOT}/${dir}/${pad5(f)}.png`;
  setSrc(img, src);
  return f;
}
function setSrc(img, src) {
  if (img.__src === src) return;
  img.__src = src;
  img.src = src;
  // A decode is also cancelled when src changes again before it ends; only the current src counts.
  pendingDecodes.push(
    img.decode().catch(() => {
      if (img.__src === src) throw new Error(`Could not decode ${src}`);
    }),
  );
}
const TRACKS = {};
async function loadTrack(dir) {
  try {
    const r = await fetch(`${FOOT}/${dir}/track.json`);
    TRACKS[dir] = await r.json();
  } catch {
    TRACKS[dir] = { frames: [] };
  }
}
function trackAt(dir, ft) {
  const tr = TRACKS[dir];
  if (!tr || !tr.frames.length) return null;
  const f = clamp(Math.round(ft * FPS), 0, tr.frames.length - 1);
  return tr.frames[f];
}
/** Time (s) of the k-th frame in `dir` carrying `mark`, or null. */
function markTime(dir, mark, k = 0) {
  const tr = TRACKS[dir];
  if (!tr) return null;
  const hits = tr.frames.filter((fr) => fr.mark === mark);
  return hits[k] ? hits[k].f / FPS : null;
}

// ------------------------------------------------------------------ app window
const CURSOR_SVG = `<svg viewBox="0 0 22 32" width="22" height="32"><path d="M2 2 L2 25 L7.5 19.5 L11.5 29 L15 27.5 L11 18.2 L18.5 18.2 Z" fill="#fff" stroke="#111" stroke-width="1.6" stroke-linejoin="round"/></svg>`;
class AppWin {
  constructor(parent, { light = false, w = 500, h = 660, radius = 13 } = {}) {
    this.root = el('div', `win${light ? ' light' : ''}`, parent);
    css(this.root, { width: px(w), height: px(h) });
    this.w = w;
    this.h = h;
    this.shadow = el('div', 'shadow', this.root);
    this.glass = el('div', 'glass', this.root);
    this.img = el('img', 'shot', this.root);
    this.img2 = el('img', 'shot', this.root); // for cross-dissolves / wipes
    css(this.img2, { opacity: '0' });
    this.rim = el('div', 'rim', this.root);
    this.glareBox = el('div', 'glare', this.root);
    this.glare = el('i', '', this.glareBox);
    this.cursor = el('div', 'cursor', this.root, CURSOR_SVG);
    this.ripple = el('div', 'ripple', this.root);
    css(this.cursor, { display: 'none' });
    for (const e of [this.shadow, this.glass, this.rim, this.glareBox, this.img, this.img2])
      css(e, { borderRadius: px(radius) });
  }
  frame(dir, ft) {
    this.dir = dir;
    this.ft = ft;
    return setFrame(this.img, dir, ft);
  }
  frame2(dir, ft, opacity, clip) {
    if (opacity <= 0) {
      css(this.img2, { opacity: '0' });
      return;
    }
    setFrame(this.img2, dir, ft);
    css(this.img2, { opacity: String(opacity), clipPath: clip || 'none' });
  }
  /** transform string in parent coordinates */
  place(transform, opacity = 1) {
    css(this.root, { transform, opacity: String(opacity) });
  }
  glareAt(u) {
    // u: 0..1 sweep progress (outside → none)
    if (u <= 0 || u >= 1) css(this.glare, { display: 'none' });
    else css(this.glare, { display: 'block', left: `${lerp(-60, 130, u)}%` });
  }
  /** Draw the recorded cursor (footage `dir` at `ft`), with a press ripple after clicks. */
  /** `lead` (s) starts the press and ring that much before the recorded click, for footage where
   *  the app has already changed by the frame that carries the click mark. */
  showCursor(dir, ft, visible = 1, lead = 0) {
    const fr = trackAt(dir, ft);
    if (!fr || visible <= 0) {
      css(this.cursor, { display: 'none' });
      css(this.ripple, { opacity: '0' });
      return;
    }
    const { x, y } = fr.mouse;
    // press: scale down briefly around click marks
    const ct0 = lastMarkBefore(dir, 'click', ft + lead);
    const ct = ct0 == null ? null : ct0 - lead;
    const since = ct == null ? 99 : ft - ct;
    const press = since >= 0 && since < 0.18 ? 1 - 0.12 * Math.sin((since / 0.18) * Math.PI) : 1;
    css(this.cursor, {
      display: 'block',
      opacity: String(visible),
      transform: `translate(${x - 2}px, ${y - 2}px) scale(${press})`,
    });
    if (since >= 0 && since < 0.45) {
      const u = since / 0.45;
      css(this.ripple, {
        opacity: String((1 - u) * 0.9 * visible),
        left: px(x),
        top: px(y),
        transform: `scale(${0.3 + 1.2 * E.outCubic(u)})`,
      });
    } else css(this.ripple, { opacity: '0' });
  }
}
function lastMarkBefore(dir, mark, ft) {
  const tr = TRACKS[dir];
  if (!tr) return null;
  const f = Math.round(ft * FPS);
  let best = null;
  for (const fr of tr.frames) {
    if (fr.f > f) break;
    if (fr.mark === mark) best = fr.f / FPS;
  }
  return best;
}

// ------------------------------------------------------------------ kinetic type
class Words {
  /** A line of words that rise into place one by one. */
  constructor(parent, text, cls = 'h1', size = 96, extra = {}) {
    this.root = el('div', `type ${cls}`, parent);
    css(this.root, { fontSize: px(size), ...extra });
    this.words = [];
    text.split(' ').forEach((w, i, arr) => {
      const box = el('span', 'w', this.root);
      const inner = el('span', '', box, w.replace(/\*(.+?)\*/g, '<span class="grad">$1</span>'));
      this.words.push(inner);
      if (i < arr.length - 1) this.root.appendChild(document.createTextNode(' '));
    });
  }
  at(x, y, align = 'left') {
    const tx = align === 'center' ? '-50%' : align === 'right' ? '-100%' : '0';
    css(this.root, { left: px(x), top: px(y), transform: `translateX(${tx})` });
    return this;
  }
  /** in at t0 (staggered), out at t1. */
  show(t, t0, t1 = 1e9, { stagger = 0.06, dur = 0.55, outDur = 0.35, rise = 1.0, blur = true } = {}) {
    const vis = t >= t0 - 0.01 && t <= t1 + outDur + 0.01;
    css(this.root, { display: vis ? 'block' : 'none' });
    if (!vis) return;
    this.words.forEach((w, i) => {
      const u = E.outExpo(prog(t, t0 + i * stagger, t0 + i * stagger + dur));
      const o = E.inCubic(prog(t, t1 + i * stagger * 0.5, t1 + i * stagger * 0.5 + outDur));
      const y = (1 - u) * 105 * rise - o * 40;
      const b = blur ? (1 - u) * 8 + o * 10 : 0;
      css(w, {
        transform: `translateY(${y}%)`,
        opacity: String(clamp(u * 1.2) * (1 - o)),
        filter: b > 0.05 ? `blur(${b.toFixed(2)}px)` : 'none',
      });
    });
  }
}

// ------------------------------------------------------------------ background shader
const BG = {
  ctx: null,
  img: null,
  W: 640,
  H: 360,
  init() {
    const c = $('#bg');
    c.width = this.W;
    c.height = this.H;
    this.ctx = c.getContext('2d');
    this.img = this.ctx.createImageData(this.W, this.H);
    this.seed = 1;
  },
  rand() {
    // xorshift, deterministic per frame
    let x = this.seed;
    x ^= x << 13;
    x ^= x >>> 17;
    x ^= x << 5;
    this.seed = x >>> 0;
    return this.seed / 4294967296;
  },
  draw({ time, pal, inten = 1, zoom = 1.5, off = [0, 0], bright = 1 }) {
    const { W: w, H: h } = this;
    const c = pal.map(hex3);
    const mid = c[1].map((x, i) => x * 0.55 + c[2][i] * 0.45);
    const t = time * 0.11;
    const o = off[0] * 0.9 + off[1] * 0.4;
    const sc = (1.5 / zoom) * (w / 960);
    const blobs = [
      [w * (0.22 + 0.12 * Math.sin(t * 1.1 + o)), h * (0.3 + 0.16 * Math.cos(t * 0.9 + o)), 430 * sc, c[1], 0.95 * inten, 0],
      [w * (0.78 + 0.1 * Math.cos(t * 0.8 + 1 + o)), h * (0.62 + 0.18 * Math.sin(t * 1.2 + o)), 400 * sc, c[2], 0.85 * inten, 0],
      [w * (0.52 + 0.2 * Math.sin(t * 0.7 + 2 + o)), h * (0.95 + 0.1 * Math.cos(t + o)), 360 * sc, mid, 0.8 * inten, 0],
      [w * (0.5 + 0.25 * Math.cos(t * 0.6 + 4 + o)), h * (0.12 + 0.1 * Math.sin(t * 1.3 + o)), 260 * sc, c[3], 0.35 * inten, 1],
    ].map(([x, y, r, col, a, screen]) => ({ x, y, inv: 1 / (r * r * 0.5), col, a, screen }));
    // silk band: distance to a slowly drifting diagonal line
    const sx = w * (0.5 + 0.4 * Math.sin(t * 0.5 + o));
    const nx = 0.8;
    const ny = -0.6;
    const silkA = 0.07 * inten;
    const vr0 = h * 0.25;
    const vr1 = w * 0.72;
    const d = this.img.data;
    this.seed = (Math.floor(time * 60) * 2654435761) >>> 0 || 1;
    const c0 = c[0];
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        let r = c0[0];
        let g = c0[1];
        let b = c0[2];
        for (let k = 0; k < 4; k++) {
          const B = blobs[k];
          const dx = x - B.x;
          const dy = y - B.y;
          const wt = Math.exp(-(dx * dx + dy * dy) * B.inv) * B.a;
          if (B.screen) {
            r = 1 - (1 - r) * (1 - B.col[0] * wt);
            g = 1 - (1 - g) * (1 - B.col[1] * wt);
            b = 1 - (1 - b) * (1 - B.col[2] * wt);
          } else {
            const q = wt > 1 ? 1 : wt;
            r += (B.col[0] - r) * q;
            g += (B.col[1] - g) * q;
            b += (B.col[2] - b) * q;
          }
        }
        const ds = ((x - sx) * nx + (y - h / 2) * ny) / 120;
        const sk = Math.exp(-ds * ds) * silkA;
        r += c[3][0] * sk;
        g += c[3][1] * sk;
        b += c[3][2] * sk;
        const vx = x - w / 2;
        const vy = y - h / 2;
        const vd = Math.sqrt(vx * vx + vy * vy);
        const vu = vd <= vr0 ? 0 : vd >= vr1 ? 1 : (vd - vr0) / (vr1 - vr0);
        const vig = 1 - 0.55 * vu * vu * (3 - 2 * vu);
        const m = vig * bright * 255;
        const i = (y * w + x) * 4;
        const n1 = this.rand() + this.rand() - 1;
        d[i] = r * m + n1;
        d[i + 1] = g * m + n1;
        d[i + 2] = b * m + n1;
        d[i + 3] = 255;
      }
    }
    this.ctx.putImageData(this.img, 0, 0);
  },
};
function hex3(h) {
  if (Array.isArray(h)) return h;
  const v = parseInt(h.slice(1), 16);
  return [((v >> 16) & 255) / 255, ((v >> 8) & 255) / 255, (v & 255) / 255];
}
function mixPal(a, b, u) {
  return a.map((x, i) => {
    const p = hex3(x);
    const q = hex3(b[i]);
    return p.map((v, k) => lerp(v, q[k], u));
  });
}
const PAL = {
  night: ['#04060b', '#0b1a33', '#123a6b', '#3a7bd5'],
  aurora: ['#050912', '#0d2547', '#1b6c8f', '#6a5cff'],
  deep: ['#020305', '#060b16', '#0b1b33', '#1d4f8a'],
  dawn: ['#1a1622', '#5b4a7a', '#e59a7a', '#ffd7a8'],
  day: ['#9fb6d6', '#c9d8ee', '#f2c7b5', '#ffffff'],
  emerald: ['#04100c', '#0b3a2c', '#10b981', '#7dfcd0'],
  amber: ['#120a02', '#4a2a06', '#f59e0b', '#ffd38a'],
  rose: ['#14040a', '#4d0f24', '#f43f5e', '#ffb3c1'],
  violet: ['#0a0614', '#2a1657', '#8b5cf6', '#d4c2ff'],
  aqua: ['#03101a', '#0b3550', '#22d3ee', '#b9f4ff'],
  halloween: ['#07040d', '#2a0f3d', '#7a2e8f', '#ff7a1a'],
  christmas: ['#030a12', '#0b2a3a', '#1f6f5a', '#ff4d4d'],
  newyear: ['#05040f', '#1b1550', '#6a3cff', '#ffd166'],
  lunar: ['#0f0303', '#4a0b0b', '#c81d25', '#ffcf5a'],
  valentines: ['#1a0610', '#5a1530', '#ff4d8d', '#ffd1e3'],
  patricks: ['#03100a', '#0f3d22', '#2fbf71', '#ffe08a'],
  easter: ['#141022', '#4b3f7a', '#9ad1c8', '#ffe6f0'],
  thanks: ['#120904', '#4a2109', '#c2651a', '#ffc77a'],
  end: ['#020306', '#07101f', '#0f2a4d', '#3d7fd6'],
};

// ------------------------------------------------------------------ scenes
const SCENES = [];
function scene(name, t0, t1, build, render) {
  const root = el('div', 'scene', $('#scenes'));
  root.dataset.name = name;
  const s = { name, t0, t1, root, render };
  s.ctx = build(root, s) || {};
  SCENES.push(s);
  return s;
}

const FX = {
  flash: 0,
  black: 0,
  vig: 1,
  shake: [0, 0],
};

async function render(t) {
  pendingDecodes.length = 0;
  FX.flash = 0;
  FX.black = 0;
  FX.vig = 1;
  let bgSet = false;
  for (const s of SCENES) {
    const on = t >= s.t0 && t < s.t1;
    s.root.classList.toggle('on', on);
    if (on) {
      if (s.punch) {
        const u = E.outExpo(prog(t - s.t0, 0, 0.45));
        css(s.root, { transform: `scale(${1 + s.punch * (1 - u)})`, transformOrigin: '50% 50%' });
      }
      const r = s.render(t, t - s.t0, s.ctx, s) || {};
      if (r.bg && !bgSet) {
        BG.draw({ time: t, ...r.bg });
        bgSet = true;
      }
    }
  }
  if (!bgSet) BG.draw({ time: t, pal: PAL.deep, inten: 0.6, bright: 0.6 });
  css($('#flash'), { opacity: String(clamp(FX.flash)) });
  css($('#black'), { opacity: String(clamp(FX.black)) });
  css($('#vig'), { opacity: String(clamp(FX.vig)) });
  await Promise.all(pendingDecodes);
  // two rafs so style/layout/paint settle before capture
  await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
  return true;
}
window.render = render;

/* The spot, shot by shot. Each scene: build(root) once, render(t, local, ctx) every frame. */
'use strict';

// App-window geometry (app px, window 500x660).
const G = {
  tileX: [15, 175, 335],
  tileY: [290, 402, 514],
  tw: 150,
  th: 102,
  icon: (c, r) => ({ x: G.tileX[c] + 75, y: G.tileY[r] + 22 }),
  tile: (c, r) => ({ x: G.tileX[c] + 75, y: G.tileY[r] + 51 }),
  temp: { x: 158, y: 92 },
  clock: { x: 368, y: 100 },
  media: { x: 250, y: 204 },
  tabs: { x: 180, y: 265 },
};

function cam({ fx, fy, zoom = 1, rx = 0, ry = 0, rz = 0, ax = 960, ay = 540, z = 0 }) {
  return `translate3d(${ax}px, ${ay}px, ${z}px) rotateX(${rx}deg) rotateY(${ry}deg) rotateZ(${rz}deg) scale(${zoom}) translate(${-fx}px, ${-fy}px)`;
}
function camKF(t, frames, ease) {
  // frames: [t, {fx,fy,zoom,rx,ry,rz,ax,ay}, easeFn?]
  const keys = ['fx', 'fy', 'zoom', 'rx', 'ry', 'rz', 'ax', 'ay', 'z'];
  const out = {};
  for (const k of keys) {
    const fr = frames.map(([ti, v, e]) => [ti, v[k] ?? frames[0][1][k] ?? (k === 'zoom' ? 1 : k === 'ax' ? 960 : k === 'ay' ? 540 : 0), e]);
    out[k] = kf(t, fr, ease);
  }
  return out;
}
function shakeAt(t, t0, amp = 14, dur = 0.35) {
  const u = prog(t, t0, t0 + dur);
  if (u <= 0 || u >= 1) return [0, 0];
  const k = (1 - u) * (1 - u) * amp;
  return [vnoise(t * 60) * k, vnoise(t * 60 + 50) * k];
}

/** A window inside a 3D world, with optional bloom and depth-of-field layers. */
function worldWin(root, opts = {}) {
  const persp = el('div', 'persp', root);
  const world = el('div', 'world', persp);
  const win = new AppWin(world, opts);
  if (opts.bloom) {
    win.bloom = el('img', 'shot', win.root);
    win.root.insertBefore(win.bloom, win.rim);
    css(win.bloom, { mixBlendMode: 'screen', borderRadius: '13px' });
  }
  if (opts.dof) {
    win.dof = el('img', 'shot', win.root);
    win.root.insertBefore(win.dof, win.rim);
  }
  if (opts.noGlass) css(win.glass, { display: 'none' });
  return { persp, world, win };
}
function syncLayers(win, { bloom = 0, bloomBlur = 10, bloomBright = 1.4, grade = 'none', dof = null }) {
  css(win.img, { filter: grade });
  if (win.bloom) {
    if (bloom > 0.01) {
      setSrc(win.bloom, win.img.__src);
      css(win.bloom, { display: 'block', opacity: String(bloom), filter: `${grade === 'none' ? '' : grade} blur(${bloomBlur}px) brightness(${bloomBright})` });
    } else css(win.bloom, { display: 'none' });
  }
  if (win.dof) {
    if (dof) {
      setSrc(win.dof, win.img.__src);
      const m = `radial-gradient(ellipse ${dof.rx}px ${dof.ry}px at ${dof.x}px ${dof.y}px, transparent 0%, transparent 35%, #000 100%)`;
      css(win.dof, { display: 'block', filter: `${grade === 'none' ? '' : grade} blur(${dof.blur}px)`, webkitMaskImage: m, maskImage: m });
    } else css(win.dof, { display: 'none' });
  }
}

/** Bright soft discs drifting behind a window: what the frosted glass visibly diffuses. */
function bokeh(root, discs) {
  const layer = el('div', '', root);
  css(layer, { position: 'absolute', inset: '0', pointerEvents: 'none' });
  // A 'hard' disc has a crisp lens-bokeh edge, so the frosted glass visibly diffuses it.
  const els = discs.map(([x, y, r, color, hard]) => {
    const d = el('div', '', layer);
    const fill = hard ? `radial-gradient(circle, ${color} 0%, ${color} 66%, transparent 69%)` : `radial-gradient(circle, ${color} 0%, ${color} 38%, transparent 70%)`;
    css(d, { position: 'absolute', left: px(x - r), top: px(y - r), width: px(2 * r), height: px(2 * r), borderRadius: '50%', background: fill, opacity: hard ? '0.55' : '0.8' });
    return d;
  });
  const update = (t) =>
    els.forEach((d, i) => {
      const dx = Math.sin(t * 0.5 + i * 1.7) * 60;
      const dy = Math.cos(t * 0.43 + i * 2.3) * 40;
      css(d, { transform: `translate(${dx}px, ${dy}px)` });
    });
  update.layer = layer;
  return update;
}

function topbar(root, light = false) {
  const bar = el('div', 'topbar', root);
  bar.innerHTML = `<span style="display:flex;gap:18px;align-items:center"><img src="assets/icon.png" width="18" height="18" style="border-radius:4px"> <span>HA Desktop Widget</span></span><span>Fri Oct 30&nbsp;&nbsp;7:42 PM</span>`;
  if (light) css(bar, { color: 'rgba(20,24,32,.85)', background: 'rgba(255,255,255,.35)' });
  return bar;
}

let Z = 0;
const PUNCH = { hero: 0, cards: 0.05, status: 0.05, pages: 0.05, icons: 0.06, themes: 0.04, halloween: 0.05, holidays: 0.04, settings: 0.05, sync: 0.04, pins: 0.04, omarchy: 0.04, rapid: 0.05, finale: 0.03 };
function zscene(name, t0, t1, z, build, renderFn) {
  const s = scene(name, t0, t1, build, renderFn);
  s.root.style.zIndex = String(z);
  s.punch = PUNCH[name] || 0;
  return s;
}

// =================================================================== S1+S2: open (0–8)
zscene('open', 0, 8.0, 10, (root) => {
  const w = worldWin(root, { bloom: true, dof: true });
  const bar = topbar(root);
  const t1 = new Words(root, 'Your home.', 'h1', 132).at(1120, 455);
  // 100px: 'your desktop.' ends near x=750, clear of the window as it slides in.
  const t2a = new Words(root, 'Right on', 'h1', 100).at(110, 390);
  const t2b = new Words(root, 'your desktop.', 'h1', 100).at(110, 500);
  return { ...w, bar, t1, t2a, t2b };
}, (t, l, c) => {
  const { world, win } = c;
  win.frame('open', t);
  const ic = G.icon(1, 1); // Office
  const cm = camKF(t, [
    [0, { fx: ic.x, fy: ic.y + 6, zoom: 6.4, rx: 0, ry: 7, ax: 640, ay: 520 }, E.lin],
    [4.0, { fx: ic.x, fy: ic.y + 4, zoom: 7.2, rx: 0, ry: 4, ax: 640, ay: 520 }, E.inOutCubic],
    [7.4, { fx: 250, fy: 330, zoom: 1.24, rx: 4, ry: -9, ax: 1230, ay: 548 }, E.outQuad],
    [8.0, { fx: 250, fy: 330, zoom: 1.21, rx: 4, ry: -10, ax: 1236, ay: 548 }],
  ]);
  css(world, { transform: cam(cm) });
  // Exposure: crushed to black, the lit icon carrying the frame; opens up during the pull-back.
  const crush = t < 4 ? 1 : 1 - E.inOutQuad(prog(t, 4.2, 7.4));
  const pre = t < 1.5 ? 1 : 0.85;
  const c2 = crush * pre;
  const grade = c2 > 0.01 ? `contrast(${1 + 1.1 * c2}) brightness(${1 - 0.45 * c2}) saturate(${1 + 0.4 * c2})` : 'none';
  const bloom = (t < 1.48 ? 0 : 0.9 * (1 - 0.6 * prog(t, 4, 8)));
  const dof = cm.zoom > 2 ? { x: ic.x, y: ic.y + 10, rx: 120 + (7.2 - cm.zoom) * 40, ry: 95 + (7.2 - cm.zoom) * 40, blur: 2.4 } : null;
  syncLayers(win, { bloom, bloomBlur: 9, bloomBright: 1.5, grade, dof });
  css(win.glass, { display: t > 5.6 ? 'block' : 'none' });
  css(win.shadow, { opacity: String(prog(t, 5.5, 7.5)) });
  css(win.rim, { opacity: String(prog(t, 5.8, 7.5)) });
  win.glareAt(prog(t, 6.9, 7.7));
  css(c.bar, { opacity: String(E.inOutQuad(prog(t, 6.4, 7.6))) });
  c.t1.show(t, 2.0, 3.55, { stagger: 0.12, dur: 0.9 });
  c.t2a.show(t, 6.15, 7.45, { stagger: 0.08 });
  c.t2b.show(t, 6.35, 7.5, { stagger: 0.08 });
  FX.vig = 1;
  // The gap before the drop: dip to black.
  FX.black = kf(t, [[7.7, 0], [7.95, 0.85]]);
  const bgIn = E.inOutQuad(prog(t, 5.2, 7.6));
  return { bg: { pal: PAL.night, inten: 0.9 * bgIn, bright: 0.05 + 0.85 * bgIn, zoom: 1.5, off: [0.2, 0.1] } };
});

// =================================================================== S3: title (8–10)
zscene('title', 8.0, 10.0, 30, (root) => {
  const box = el('div', '', root);
  css(box, { position: 'absolute', inset: '0', transformOrigin: '960px 560px' });
  const streak = el('div', 'glow', box);
  css(streak, { left: '-200px', top: '520px', width: '2320px', height: '40px', borderRadius: '50%', background: 'radial-gradient(ellipse at 50% 50%, rgba(190,225,255,.95), rgba(100,181,246,.35) 30%, rgba(100,181,246,0) 70%)' });
  const halo = el('div', 'glow', box);
  css(halo, { left: '560px', top: '160px', width: '800px', height: '800px', background: 'radial-gradient(circle, rgba(100,181,246,.35), rgba(100,181,246,0) 60%)' });
  const icon = el('img', '', box);
  icon.src = 'assets/icon.png';
  css(icon, { position: 'absolute', left: '860px', top: '150px', width: '200px', height: '200px', filter: 'drop-shadow(0 18px 50px rgba(0,0,0,.6))' });
  const word = el('div', 'type h2', box, 'HA Desktop Widget');
  css(word, { left: '960px', top: '378px', fontSize: '58px', color: '#e8eef8', letterSpacing: '0.005em', fontWeight: '700' });
  const bigGlow = el('div', 'type h1', box, '4.0');
  css(bigGlow, { left: '960px', top: '440px', fontSize: '360px', letterSpacing: '-0.05em', lineHeight: '1', color: '#5aa9f0', filter: 'blur(38px)', opacity: '.55', transform: 'translate(-50%,0)' });
  const big = el('div', 'type h1', box);
  css(big, { left: '960px', top: '440px', fontSize: '360px', letterSpacing: '-0.05em', lineHeight: '1' });
  const chars = ['4', '.', '0'].map((ch) => {
    const s = el('span', '', big, ch);
    css(s, { display: 'inline-block', background: 'linear-gradient(100deg, #ffffff 0%, #d7ebff 35%, #7cc1fa 60%, #3f8fe0 100%)', webkitBackgroundClip: 'text', backgroundClip: 'text', color: 'transparent', backgroundSize: '100% 100%' });
    return s;
  });
  const sheen = el('div', 'type h1', box);
  css(sheen, { left: '960px', top: '440px', fontSize: '360px', letterSpacing: '-0.05em', lineHeight: '1', color: 'transparent', backgroundImage: 'linear-gradient(100deg, rgba(255,255,255,0) 40%, rgba(255,255,255,.95) 50%, rgba(255,255,255,0) 60%)', backgroundSize: '300% 100%', webkitBackgroundClip: 'text', backgroundClip: 'text', mixBlendMode: 'screen' });
  sheen.textContent = '4.0';
  return { box, streak, halo, icon, word, big, bigGlow, chars, sheen };
}, (t, l, c) => {
  const [sx, sy] = shakeAt(t, 8.0, 18, 0.4);
  const zoomOut = E.inExpo(prog(t, 9.58, 9.95));
  const s = 1 + 0.05 * E.outQuad(prog(t, 8, 9.6)) + zoomOut * 16;
  // Through the counter of the "0".
  css(c.box, { transform: `translate(${sx}px, ${sy}px) scale(${s})`, transformOrigin: '1150px 633px', opacity: String(1 - prog(t, 9.8, 9.95)) });
  const clear = 1 - prog(t, 9.45, 9.65);
  FX.flash = 0.85 * (1 - prog(t, 8.0, 8.3)) ** 2.2;
  const su = prog(t, 8.0, 8.7);
  css(c.streak, { opacity: String((1 - su) * 1.0), transform: `scaleX(${0.4 + 1.2 * E.outExpo(su)}) scaleY(${1 - 0.6 * su})` });
  css(c.halo, { opacity: String(0.5 + 0.5 * (1 - prog(t, 8, 9))) });
  const iu = E.outExpo(prog(t, 8.0, 8.7));
  css(c.icon, { transform: `scale(${1.7 - 0.7 * iu})`, opacity: String(clamp(iu * 1.5) * clear), filter: `blur(${(1 - iu) * 14}px) drop-shadow(0 18px 50px rgba(0,0,0,.6))` });
  const wu = E.outExpo(prog(t, 8.18, 8.9));
  css(c.word, { transform: `translate(-50%, 0) translateY(${(1 - wu) * 30}px)`, opacity: String(wu * clear), letterSpacing: `${0.12 - 0.115 * wu}em` });
  c.chars.forEach((ch, i) => {
    const u = E.outExpo(prog(t, 8.05 + i * 0.07, 8.65 + i * 0.07));
    css(ch, { transform: `translateY(${(1 - u) * 60}px) scale(${1.5 - 0.5 * u})`, opacity: String(clamp(u * 1.4)), filter: `blur(${(1 - u) * 18}px)` });
  });
  css(c.big, { transform: 'translate(-50%, 0)' });
  css(c.bigGlow, { opacity: String(0.6 * E.outCubic(prog(t, 8.1, 8.8)) * (0.85 + 0.15 * Math.sin(t * 5))) });
  const sh = prog(t, 8.55, 9.35);
  css(c.sheen, { transform: 'translate(-50%, 0)', backgroundPosition: `${lerp(100, -50, E.inOutQuad(sh))}% 0`, opacity: String(sh > 0 && sh < 1 ? 1 : 0) });
  return { bg: { pal: PAL.aurora, inten: 0.85, bright: 0.55 + 0.4 * (1 - prog(t, 8, 9)), zoom: 1.4, off: [0.6, -0.2] } };
});

// =================================================================== S4: hero (9.6–12)
zscene('hero', 9.6, 12.0, 20, (root) => {
  const glow = bokeh(root, [[990, 320, 150, 'rgba(77,208,225,.85)', true], [1580, 760, 270, 'rgba(139,92,246,.85)'], [1260, 1010, 210, 'rgba(240,98,146,.8)'], [1600, 190, 170, 'rgba(100,181,246,.9)'], [900, 860, 110, 'rgba(255,183,77,.75)', true]]);
  const w = worldWin(root, {});
  const a = new Words(root, 'Redesigned.', 'h1', 128).at(140, 360);
  const b = new Words(root, 'From the glass up.', 'h2', 62).at(146, 512);
  return { ...w, a, b, glow };
}, (t, l, c) => {
  c.glow(t);
  // The discs bloom in as the title zooms past, not in one frame behind the still title.
  css(c.glow.layer, { opacity: String(E.inOutQuad(prog(t, 9.62, 9.92))) });
  c.win.frame('hero', 0.4 + (t - 9.6));
  css(c.win.root, { opacity: String(E.outCubic(prog(t, 9.78, 9.92))) });
  // Starts inside the counter of the '0' (1150, 633), so the zoom-through lands in the window.
  const cm = camKF(t, [
    [9.6, { fx: 250, fy: 330, zoom: 0.35, rx: 26, ry: -58, rz: 6, ax: 1150, ay: 633, z: -400 }, E.outExpo],
    [10.95, { fx: 250, fy: 330, zoom: 1.26, rx: 5, ry: -15, rz: 0, ax: 1270, ay: 545, z: 0 }, E.lin],
    [12.0, { fx: 250, fy: 330, zoom: 1.33, rx: 4, ry: -11, rz: 0, ax: 1262, ay: 545, z: 0 }],
  ]);
  css(c.world, { transform: cam(cm) });
  c.win.glareAt(prog(t, 10.55, 11.45));
  c.a.show(t, 10.25, 11.72);
  c.b.show(t, 10.5, 11.75, { stagger: 0.05 });
  return { bg: { pal: PAL.aurora, inten: 1, bright: 1, zoom: 1.5, off: [0.6 + (t - 9.6) * 0.05, -0.2] } };
});

// =================================================================== S5: macro cards (12–14)
zscene('cards', 12.0, 14.0, 20, (root) => {
  const glow = bokeh(root, [[700, 200, 380, 'rgba(77,208,225,.9)'], [1500, 300, 420, 'rgba(139,92,246,.9)'], [1100, 900, 360, 'rgba(240,98,146,.85)']]);
  const w = worldWin(root, { dof: true });
  const scrim = el('div', '', root);
  css(scrim, { position: 'absolute', left: '0', top: '700px', width: '1920px', height: '380px', background: 'linear-gradient(90deg, rgba(4,6,12,.88) 0px, rgba(4,6,12,.85) 680px, rgba(4,6,12,0) 1060px)', webkitMaskImage: 'linear-gradient(180deg, transparent 0, #000 60px)', maskImage: 'linear-gradient(180deg, transparent 0, #000 60px)' });
  const a = new Words(root, 'Frosted glass.', 'h1', 84, { textShadow: '0 4px 30px rgba(0,0,0,.5)' }).at(120, 800);
  const b = new Words(root, 'Crisp new type.', 'h1', 84, { textShadow: '0 4px 30px rgba(0,0,0,.5)' }).at(120, 900);
  return { ...w, a, b, glow };
}, (t, l, c) => {
  c.glow(t);
  c.win.frame('hero', 2.8 + l);
  const cm = camKF(t, [
    [12.0, { fx: 130, fy: 104, zoom: 3.0, rx: -5, ry: 16, ax: 960, ay: 430 }, E.inOutCubic],
    [12.95, { fx: 372, fy: 100, zoom: 3.15, rx: -4, ry: 8, ax: 1060, ay: 430 }, E.inOutCubic],
    [14.0, { fx: 300, fy: 108, zoom: 2.55, rx: -2, ry: 2, ax: 1080, ay: 440 }],
  ]);
  css(c.world, { transform: cam(cm) });
  syncLayers(c.win, { dof: { x: cm.fx, y: cm.fy, rx: 320, ry: 110, blur: 1.6 } });
  c.a.show(t, 12.2, 13.75);
  c.b.show(t, 12.55, 13.8);
  return { bg: { pal: PAL.aurora, inten: 1, bright: 0.9, zoom: 1.2, off: [1.2, 0.3] } };
});

// =================================================================== S6: live status (14–16)
zscene('status', 14.0, 16.0, 20, (root) => {
  const w = worldWin(root, {});
  const a = new Words(root, 'Live status,', 'h1', 104).at(120, 400);
  const b = new Words(root, 'at a glance.', 'h1', 104).at(120, 520);
  return { ...w, a, b };
}, (t, l, c) => {
  c.win.frame('status', l);
  const cm = camKF(t, [
    [14.0, { fx: 250, fy: 420, zoom: 1.95, rx: 9, ry: -19, ax: 1290, ay: 520 }, E.lin],
    [16.0, { fx: 236, fy: 430, zoom: 2.1, rx: 7, ry: -12, ax: 1270, ay: 520 }],
  ]);
  css(c.world, { transform: cam(cm) });
  c.a.show(t, 14.12, 15.75);
  c.b.show(t, 14.32, 15.8);
  return { bg: { pal: PAL.aurora, inten: 1, bright: 0.95, zoom: 1.6, off: [-0.4, 0.5] } };
});

// =================================================================== S7: pages / motion (16–18)
zscene('pages', 16.0, 18.0, 20, (root) => {
  const w = worldWin(root, {});
  const a = new Words(root, 'Motion that', 'h1', 104).at(1810, 400, 'right');
  const b = new Words(root, 'feels right.', 'h1', 104).at(1810, 520, 'right');
  return { ...w, a, b };
}, (t, l, c) => {
  const ft = t - 16.05;
  c.win.frame('pages', ft);
  c.win.showCursor('pages', ft);
  const cm = camKF(t, [
    [16.0, { fx: 250, fy: 360, zoom: 1.62, rx: 7, ry: 17, ax: 650, ay: 540 }, E.lin],
    [18.0, { fx: 250, fy: 372, zoom: 1.74, rx: 6, ry: 11, ax: 660, ay: 540 }],
  ]);
  css(c.world, { transform: cam(cm) });
  c.a.show(t, 16.12, 17.75);
  c.b.show(t, 16.32, 17.8);
  return { bg: { pal: PAL.aurora, inten: 1, bright: 0.95, zoom: 1.4, off: [0.9, -0.6] } };
});

// =================================================================== S8: icons glow (18–20)
zscene('icons', 18.0, 20.0, 20, (root) => {
  const w = worldWin(root, { bloom: true, dof: true, noGlass: true });
  const a = new Words(root, 'Line icons that *glow.*', 'h1', 110, { textShadow: '0 6px 40px rgba(0,0,0,.6)' }).at(960, 830, 'center');
  return { ...w, a };
}, (t, l, c) => {
  const first = t < 19.0;
  // Footage 'open': Living room lights at 6.0, Ceiling fan at 6.5; both land on the beat (18.5, 19.5).
  const ft = first ? t - 12.5 : t - 13.0;
  c.win.frame('open', ft);
  const ic = first ? G.icon(0, 0) : G.icon(2, 0);
  const u = first ? prog(t, 18, 19) : prog(t, 19, 20);
  const cm = { fx: ic.x + (first ? -6 : 6) * (1 - u), fy: ic.y + 8, zoom: 5.2 + 0.6 * u, rx: 0, ry: first ? 9 - 4 * u : -9 + 4 * u, ax: 960, ay: 430 };
  css(c.world, { transform: cam(cm) });
  const lit = first ? prog(t, 18.5, 18.6) : prog(t, 19.5, 19.6);
  syncLayers(c.win, {
    bloom: 0.25 + 0.75 * lit,
    bloomBlur: 8,
    bloomBright: 1.6,
    grade: 'contrast(1.7) brightness(0.62) saturate(1.3)',
    dof: { x: ic.x, y: ic.y + 12, rx: 70, ry: 55, blur: 2.4 },
  });
  c.a.show(t, 18.1, 19.75, { stagger: 0.09 });
  return { bg: { pal: PAL.deep, inten: 0.6, bright: 0.25 } };
});

// =================================================================== S9: themes + accents (20–24)
zscene('themes', 20.0, 24.0, 20, (root) => {
  const w = worldWin(root, {});
  // A soft shadow keeps white type readable over the light-theme wipe.
  const sh = { textShadow: '0 6px 36px rgba(0,0,0,.45)' };
  const L = new Words(root, 'Light.', 'h1', 120, sh).at(150, 300);
  const D = new Words(root, 'Dark.', 'h1', 120, sh).at(150, 430);
  const A = new Words(root, 'Auto.', 'h1', 120, sh).at(150, 560);
  const col = new Words(root, 'Your *colors.*', 'h1', 120).at(150, 420);
  const dots = el('div', '', root);
  css(dots, { position: 'absolute', left: '156px', top: '590px', display: 'flex', gap: '22px' });
  const sw = ['#10b981', '#f59e0b', '#f43f5e', '#8b5cf6'].map((cl) => {
    const d = el('div', '', dots);
    css(d, { width: '46px', height: '46px', borderRadius: '50%', background: cl, boxShadow: `0 0 24px ${cl}88, inset 0 0 0 2px rgba(255,255,255,.35)` });
    return d;
  });
  const line = el('div', '', root);
  css(line, { position: 'absolute', top: '-200px', width: '6px', height: '1480px', background: 'linear-gradient(180deg, rgba(255,255,255,0), #fff 30%, #fff 70%, rgba(255,255,255,0))', boxShadow: '0 0 40px 10px rgba(255,255,255,.6)', transform: 'rotate(14deg)', display: 'none' });
  return { ...w, L, D, A, col, dots, sw, line };
}, (t, l, c) => {
  const { win } = c;
  const accents = [[22.0, 'accent_emerald', PAL.emerald], [22.5, 'accent_amber', PAL.amber], [23.0, 'accent_rose', PAL.rose], [23.5, 'accent_violet', PAL.violet]];
  let bg;
  if (t < 22.0) {
    const ft = 0.1 + (t - 20) * 0.5;
    win.frame('theme_dark', ft);
    // wipe progress to light (20.5) and back (21.0), split for Auto (21.5)
    const toLight = E.inOutCubic(prog(t, 20.42, 20.7));
    const toDark = E.inOutCubic(prog(t, 20.92, 21.2));
    const toAuto = E.inOutCubic(prog(t, 21.42, 21.7));
    let clip = null;
    let wipeX = null; // in app px
    if (t < 20.92) {
      const x = lerp(-120, 640, toLight);
      clip = `polygon(${-200}px -50px, ${x + 80}px -50px, ${x - 80}px 720px, ${-200}px 720px)`;
      wipeX = toLight > 0 && toLight < 1 ? x : null;
    } else if (t < 21.42) {
      const x = lerp(640, -120, toDark);
      clip = `polygon(${-200}px -50px, ${x + 80}px -50px, ${x - 80}px 720px, ${-200}px 720px)`;
      wipeX = toDark > 0 && toDark < 1 ? x : null;
    } else {
      const x = lerp(-120, 250, toAuto);
      clip = `polygon(${-200}px -50px, ${x + 80}px -50px, ${x - 80}px 720px, ${-200}px 720px)`;
      wipeX = toAuto > 0 && toAuto < 1 ? x : t >= 21.7 ? 250 : null;
    }
    const lightAmt = t < 20.92 ? toLight : t < 21.42 ? 1 - toDark : 0.5 * toAuto;
    win.frame2('theme_light', ft, 1, clip);
    win.root.classList.toggle('light', lightAmt > 0.5);
    bg = { pal: mixPal(PAL.aurora, PAL.day, lightAmt), inten: 1, bright: 1, zoom: 1.5, off: [0.3, 0.2] };
    const cm = { fx: 250, fy: 330, zoom: 1.4 + 0.04 * prog(t, 20, 22), rx: 0, ry: -6, ax: 1210, ay: 540 };
    css(c.world, { transform: cam(cm) });
    if (wipeX != null) {
      css(c.line, { display: 'block', left: px(1210 + (wipeX - 250) * cm.zoom - 3), opacity: t >= 21.7 ? String(0.35) : '1' });
    } else css(c.line, { display: 'none' });
    css(c.dots, { display: 'none' });
  } else {
    css(c.line, { display: 'none' });
    win.frame2(null, 0, 0);
    win.root.classList.remove('light');
    let k = 0;
    for (let i = 0; i < accents.length; i++) if (t >= accents[i][0]) k = i;
    const [ta, dir, pal] = accents[k];
    win.frame(dir, 0.2 + (t - ta) * 0.6);
    const punch = 1 - E.outCubic(prog(t, ta, ta + 0.35));
    const cm = { fx: 250, fy: 330, zoom: 1.42 + 0.05 * punch, rx: 0, ry: -6 + (k % 2 ? 2 : -2) * punch, ax: 1210, ay: 540 };
    css(c.world, { transform: cam(cm) });
    bg = { pal, inten: 1, bright: 0.9 + 0.3 * punch, zoom: 1.5, off: [0.3 + k * 0.4, 0.2] };
    css(c.dots, { display: 'flex' });
    c.sw.forEach((d, i) => {
      const u = E.outBack(prog(t, accents[i][0], accents[i][0] + 0.3));
      css(d, { transform: `scale(${t >= accents[i][0] ? u : 0})`, outline: i === k ? '3px solid rgba(255,255,255,.9)' : 'none', outlineOffset: '4px' });
    });
    FX.black = kf(t, [[23.78, 0], [24.0, 0.7]]);
  }
  c.L.show(t, 20.45, 21.95, { outDur: 0.05 });
  c.D.show(t, 20.95, 21.95, { outDur: 0.05 });
  c.A.show(t, 21.45, 21.95, { outDur: 0.05 });
  c.col.show(t, 22.05, 23.82);
  return { bg };
});

// =================================================================== S10: Halloween (24–28)
// Footage: a 500x2200 window (the moon sits 12% down, clear of the tiles), captured down to y=800.
// The witch crosses the moon at footage 9.8–10.1 s, so 26.5–26.8 s in the spot.
const HALLOWEEN_FROM = 7.3;
zscene('halloween', 24.0, 28.0, 20, (root) => {
  const w = worldWin(root, { h: 800 });
  const a = new Words(root, 'Seasonal', 'h1', 128).at(1800, 380, 'right');
  const b = new Words(root, 'themes.', 'h1', 128).at(1800, 520, 'right');
  const cap = new Words(root, 'Halloween', 'cap', 34).at(1800, 680, 'right');
  return { ...w, a, b, cap };
}, (t, l, c) => {
  c.win.frame('halloween', HALLOWEEN_FROM + l);
  const cm = camKF(t, [
    [24.0, { fx: 250, fy: 232, zoom: 1.95, rx: 3, ry: 12, ax: 640, ay: 520 }, E.lin],
    [28.0, { fx: 275, fy: 225, zoom: 2.25, rx: 2, ry: 7, ax: 650, ay: 520 }],
  ]);
  css(c.world, { transform: cam(cm) });
  FX.black = kf(t, [[24.0, 0.7], [24.25, 0]]);
  c.a.show(t, 24.35, 27.75);
  c.b.show(t, 24.55, 27.8);
  c.cap.show(t, 25.0, 27.7);
  return { bg: { pal: PAL.halloween, inten: 1, bright: 0.85, zoom: 1.6, off: [0.2, -0.5] } };
});

// =================================================================== S11: holidays (28–32)
// [cut time, footage, palette, label, footage start, focus {fx, fy, zoom}]
const HOLIDAYS = [
  [28.0, 'holiday_new-year', PAL.newyear, 'New Year', 1.75, { fx: 220, fy: 270, zoom: 1.45 }],
  [28.5, 'holiday_lunar-new-year', PAL.lunar, 'Lunar New Year', 2.9, { fx: 280, fy: 320, zoom: 1.38 }],
  [29.0, 'holiday_valentines', PAL.valentines, 'Valentine’s Day', 1.5, { fx: 250, fy: 320, zoom: 1.34 }],
  [29.5, 'holiday_st-patricks', PAL.patricks, 'St. Patrick’s Day', 1.5, { fx: 250, fy: 370, zoom: 1.34 }],
  [30.0, 'holiday_easter', PAL.easter, 'Easter', 7.3, { fx: 240, fy: 355, zoom: 1.42 }],
  [30.5, 'holiday_thanksgiving', PAL.thanks, 'Thanksgiving', 9.4, { fx: 240, fy: 355, zoom: 1.42 }],
  // A 500x2200 window captured down to y=800, so Santa's sleigh crosses open sky below the tiles.
  [31.0, 'holiday_christmas_tall', PAL.christmas, 'Christmas', 5.5, { fx: 188, fy: 255, zoom: 1.9, h: 800 }],
];
zscene('holidays', 28.0, 32.0, 20, (root) => {
  const w = worldWin(root, { bloom: true });
  const a = new Words(root, 'Eight holidays.', 'h1', 104).at(130, 360);
  const b = new Words(root, 'Built right in.', 'h2', 64).at(136, 490);
  const pill = el('div', 'pill', root, '<b></b><span></span>');
  css(pill, { left: '140px', top: '620px', fontSize: '34px', padding: '16px 28px 16px 22px' });
  return { ...w, a, b, pill };
}, (t, l, c) => {
  let k = 0;
  for (let i = 0; i < HOLIDAYS.length; i++) if (t >= HOLIDAYS[i][0]) k = i;
  const [t0, dir, pal, name, from, view] = HOLIDAYS[k];
  const lt = t - t0;
  c.win.frame(dir, from + lt);
  css(c.win.root, { height: px(view.h || 660) });
  // A little bloom so New Year's fireworks register in half a second.
  syncLayers(c.win, { bloom: dir === 'holiday_new-year' ? 0.4 : 0, bloomBlur: 5, bloomBright: 1.9 });
  const light = /valentines|patricks/.test(dir);
  c.win.root.classList.toggle('light', light);
  const dur = k === HOLIDAYS.length - 1 ? 1.0 : 0.5;
  const u = E.outCubic(prog(lt, 0, dur));
  const side = k % 2 ? 1 : -1;
  const cm = { fx: view.fx, fy: view.fy, zoom: view.zoom * (1 + 0.06 * u), rx: 3, ry: -10 + side * 4 * (1 - u), ax: 1250, ay: 545 };
  css(c.world, { transform: cam(cm) });
  c.a.show(t, 28.05, 31.78);
  c.b.show(t, 28.2, 31.8);
  const pu = E.outExpo(prog(lt, 0, 0.25));
  c.pill.querySelector('span').textContent = name;
  css(c.pill.querySelector('b'), { background: hexOf(pal[3]), boxShadow: `0 0 14px ${hexOf(pal[3])}` });
  css(c.pill, { opacity: String(t > 31.8 ? 1 - prog(t, 31.8, 32) : 1), transform: `translateY(${(1 - pu) * 16}px)` });
  return { bg: { pal, inten: 1, bright: 0.9, zoom: 1.5, off: [k * 0.7, 0.2] } };
});
function hexOf(c) {
  return Array.isArray(c) ? `rgb(${c.map((v) => Math.round(v * 255)).join(',')})` : c;
}

// =================================================================== S12: command palette (32–36)
zscene('palette', 32.0, 36.0, 20, (root) => {
  const w = worldWin(root, {});
  const keys = el('div', 'persp', root);
  const kb = el('div', '', keys);
  css(kb, { position: 'absolute', inset: '0', transformStyle: 'preserve-3d' });
  const k1 = el('div', 'key wide', kb, '<div class="cap-side"></div><div class="cap-top">Ctrl</div>');
  const plus = el('div', 'type h1', kb, '+');
  const k2 = el('div', 'key', kb, '<div class="cap-side"></div><div class="cap-top">K</div>');
  css(k1, { left: '500px', top: '395px', transform: 'scale(1.2)' });
  css(plus, { left: '930px', top: '450px', fontSize: '120px', color: 'rgba(255,255,255,.6)' });
  css(k2, { left: '1090px', top: '395px' });
  const a = new Words(root, 'Anything.', 'h1', 112).at(130, 380);
  const b = new Words(root, 'One shortcut away.', 'h2', 64).at(136, 520);
  return { ...w, kb, k1, k2, plus, a, b };
}, (t, l, c) => {
  const ft = t - 32.2;
  c.win.frame('palette', ft);
  // Keycaps (32.0-33.1)
  const keysOut = E.inCubic(prog(t, 32.85, 33.15));
  const press = (t0) => {
    const u = prog(t, t0, t0 + 0.28);
    return u > 0 && u < 1 ? Math.sin(u * Math.PI) : 0;
  };
  const kin = E.outExpo(prog(t, 32.0, 32.3));
  css(c.kb, { transform: `translateZ(${-200 * keysOut}px) rotateX(${28 - 6 * kin}deg) scale(${(0.85 + 0.15 * kin) * (1 - 0.4 * keysOut)})`, opacity: String((1 - keysOut) * clamp(kin * 2)), transformOrigin: '960px 540px' });
  css(c.k1, { transform: `translateZ(${-30 * press(32.0)}px) scale(1.2)` });
  css(c.k2, { transform: `translateZ(${-30 * press(32.5)}px) scale(1.2)` });
  css(c.k1.querySelector('.cap-top'), { boxShadow: press(32.0) > 0.1 || t > 32.1 ? 'inset 0 2px 0 rgba(255,255,255,.18), inset 0 -10px 18px rgba(0,0,0,.35), 0 0 40px rgba(100,181,246,.55), 0 0 0 2px rgba(100,181,246,.7)' : '' });
  css(c.k2.querySelector('.cap-top'), { boxShadow: press(32.5) > 0.1 || t > 32.6 ? 'inset 0 2px 0 rgba(255,255,255,.18), inset 0 -10px 18px rgba(0,0,0,.35), 0 0 40px rgba(100,181,246,.55), 0 0 0 2px rgba(100,181,246,.7)' : '' });
  // Window: blurred behind the keys, then the hero of the shot.
  const winIn = E.outCubic(prog(t, 32.85, 33.4));
  const cm = camKF(t, [
    [32.0, { fx: 250, fy: 300, zoom: 1.1, rx: 0, ry: 0, ax: 960, ay: 560 }, E.outCubic],
    [33.4, { fx: 250, fy: 250, zoom: 1.78, rx: 4, ry: -12, ax: 1230, ay: 560 }, E.lin],
    [34.55, { fx: 250, fy: 262, zoom: 1.84, rx: 4, ry: -10, ax: 1230, ay: 560 }, E.inOutCubic],
    [35.1, { fx: 250, fy: 420, zoom: 1.75, rx: 5, ry: -10, ax: 1230, ay: 540 }, E.lin],
    [36.0, { fx: 250, fy: 430, zoom: 1.8, rx: 5, ry: -8, ax: 1230, ay: 540 }],
  ]);
  css(c.world, { transform: cam(cm) });
  css(c.win.root, { filter: winIn < 1 ? `blur(${(1 - winIn) * 14}px) brightness(${0.5 + 0.5 * winIn})` : 'none' });
  c.a.show(t, 33.15, 35.75);
  c.b.show(t, 33.45, 35.8, { stagger: 0.05 });
  return { bg: { pal: PAL.aurora, inten: 1, bright: 0.85, zoom: 1.3, off: [-0.8, 0.4] } };
});

// =================================================================== S13: settings search (36–40)
zscene('settings', 36.0, 40.0, 20, (root) => {
  const w = worldWin(root, {});
  const a = new Words(root, 'Every setting.', 'h1', 88).at(120, 410);
  const b = new Words(root, 'Found instantly.', 'h2', 64).at(124, 515);
  return { ...w, a, b };
}, (t, l, c) => {
  const ft = t - 36.0;
  c.win.frame('settings', ft);
  // The app swaps to Settings on the click frame itself, so the press starts 0.08 s ahead of it.
  c.win.showCursor('settings', ft, 1, 0.08);
  // Opens tight on the title bar: the tiles (back at their pre-palette values) stay out of frame.
  const cm = camKF(t, [
    [36.0, { fx: 250, fy: 60, zoom: 2.2, rx: 3, ry: -10, ax: 1340, ay: 540 }, E.inOutCubic],
    [36.9, { fx: 280, fy: 200, zoom: 1.9, rx: 4, ry: -12, ax: 1340, ay: 520 }, E.lin],
    [38.5, { fx: 285, fy: 230, zoom: 1.95, rx: 4, ry: -11, ax: 1340, ay: 520 }, E.inOutCubic],
    [39.2, { fx: 290, fy: 300, zoom: 1.75, rx: 3, ry: -9, ax: 1340, ay: 530 }, E.lin],
    [40.0, { fx: 290, fy: 305, zoom: 1.85, rx: 3, ry: -8, ax: 1340, ay: 530 }],
  ]);
  css(c.world, { transform: cam(cm) });
  c.a.show(t, 36.15, 39.75);
  c.b.show(t, 36.5, 39.8);
  return { bg: { pal: PAL.aurora, inten: 1, bright: 0.9, zoom: 1.5, off: [1.5, 0.8] } };
});

// =================================================================== S14: Cloud Sync (40–44)
const CLOUD_SVG = `<svg viewBox="0 0 64 44" width="150" height="104" fill="none" stroke="#cfe6ff" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><path d="M18 40h30a12 12 0 0 0 1.5-23.9A17 17 0 0 0 17.3 13 13.5 13.5 0 0 0 18 40z"/><path d="M26 27l6-6 6 6M32 21v13" stroke="#64b5f6"/></svg>`;
zscene('sync', 40.0, 44.0, 20, (root) => {
  const stage = el('div', 'persp', root);
  const rig = el('div', '', stage);
  css(rig, { position: 'absolute', inset: '0', transformStyle: 'preserve-3d', transformOrigin: '960px 560px' });
  const dev = [];
  const mk = (x, y, w, h, ry, kind, wall) => {
    const d = el('div', 'device', rig);
    css(d, { left: px(x - w / 2), top: px(y - h / 2), width: px(w), height: px(h), transform: `rotateY(${ry}deg)` });
    const bez = el('div', 'bezel', d);
    css(bez, { left: '-14px', top: '-14px', right: '-14px', bottom: kind === 'laptop' ? '-14px' : '-18px' });
    const scr = el('div', 'screen', d);
    css(scr, { inset: '0', borderRadius: '8px', background: wall });
    if (kind === 'laptop') {
      const base = el('div', 'base', d);
      css(base, { left: '-80px', right: '-80px', top: px(h + 14), height: '22px', borderRadius: '0 0 18px 18px', background: 'linear-gradient(180deg, #d9dde3, #8f959e)' });
    } else {
      const neck = el('div', 'base', d);
      css(neck, { left: px(w / 2 - 40), width: '80px', top: px(h + 18), height: '90px', background: 'linear-gradient(90deg, #8f959e, #d0d4da, #8f959e)' });
      const foot = el('div', 'base', d);
      css(foot, { left: px(w / 2 - 120), width: '240px', top: px(h + 104), height: '14px', borderRadius: '8px', background: 'linear-gradient(180deg, #d0d4da, #7d838c)' });
    }
    const inner = el('div', '', scr);
    css(inner, { position: 'absolute', inset: '0' });
    const win = new AppWin(inner, {});
    const ring = el('div', 'glow', scr);
    css(ring, { left: '0', top: '0', width: px(w), height: px(h), borderRadius: '8px', mixBlendMode: 'screen', background: 'radial-gradient(circle at 70% 50%, rgba(16,185,129,.55), rgba(16,185,129,0) 60%)', opacity: '0' });
    dev.push({ d, scr, win, w, h, ring });
  };
  const wall1 = 'radial-gradient(120% 90% at 15% 15%, #2a6bb8 0%, #123056 45%, #070b14 100%)';
  const wall2 = 'radial-gradient(120% 90% at 85% 10%, #5a3fb0 0%, #1a2150 55%, #070b14 100%)';
  const wall3 = 'radial-gradient(120% 90% at 50% 0%, #1b7d8f 0%, #0f2c45 55%, #070b14 100%)';
  mk(960, 640, 880, 550, 0, 'laptop', wall1);
  mk(300, 500, 600, 375, 26, 'monitor', wall2);
  mk(1620, 500, 600, 375, -26, 'monitor', wall3);
  const cloud = el('div', '', root, CLOUD_SVG.replace('width="150" height="104"', 'width="200" height="138"'));
  css(cloud, { position: 'absolute', left: '860px', top: '150px', filter: 'drop-shadow(0 0 24px rgba(100,181,246,.8))' });
  const svg = el('div', '', root, `<svg width="1920" height="1080" style="position:absolute;left:0;top:0;overflow:visible">
    <path id="pU" d="M960 355 C 960 330, 960 310, 960 292" fill="none"/>
    <path id="pL" d="M900 230 C 650 170, 380 200, 300 300" fill="none"/>
    <path id="pR" d="M1020 230 C 1270 170, 1540 200, 1620 300" fill="none"/>
    <circle id="hU" r="9"/><circle id="hL" r="9"/><circle id="hR" r="9"/>
    </svg>`);
  const beams = ['U', 'L', 'R'].map((id) => {
    const p = svg.querySelector(`#p${id}`);
    const head = svg.querySelector(`#h${id}`);
    const len = p.getTotalLength();
    css(p, { stroke: '#8fd0ff', strokeWidth: '5', fill: 'none', strokeLinecap: 'round', strokeDasharray: `140 ${len + 200}`, filter: 'drop-shadow(0 0 10px #64b5f6) drop-shadow(0 0 22px #3f8fe0)' });
    css(head, { fill: '#e8f6ff', filter: 'drop-shadow(0 0 10px #ffffff) drop-shadow(0 0 24px #64b5f6)' });
    return { p, head, len };
  });
  const a = new Words(root, 'Cloud *Sync.*', 'h1', 100).at(960, 40, 'center');
  const b = new Words(root, 'Every computer. In sync.', 'h2', 46).at(960, 948, 'center');
  const note = el('div', 'pill', root, '<b></b><span>Optional subscription · Folder sync stays free</span>');
  css(note, { left: '960px', top: '1012px', fontSize: '24px', padding: '10px 22px 10px 18px' });
  return { rig, dev, cloud, beams, a, b, note };
}, (t, l, c) => {
  const sw = [41.0, 41.75, 42.5];
  const order = [0, 1, 2];
  c.dev.forEach((d, i) => {
    const ts = sw[order.indexOf(i)];
    const changed = t >= ts;
    const k = d.h / 660 * 0.93;
    d.win.place(`translate(${d.w * 0.6 - 250 * k}px, ${d.h * 0.035}px) scale(${k})`);
    if (changed) d.win.frame('accent_emerald', 0.2 + (t - ts) * 0.5);
    else d.win.frame('hero', 3.0 + (t - 40));
    const pu = prog(t, ts, ts + 0.6);
    css(d.ring, { opacity: String(pu > 0 && pu < 1 ? Math.sin(pu * Math.PI) : 0) });
  });
  const orbit = prog(t, 40, 44);
  // The push lifts as it grows, so the laptop base stays clear of the subhead.
  const push = E.inQuad(orbit);
  css(c.rig, { transform: `rotateY(${lerp(-6, 6, orbit)}deg) rotateX(${lerp(8, 3, orbit)}deg) scale(${lerp(0.94, 1.04, push)}) translateY(${-40 * push}px)` });
  const beam = (b, t0, t1) => {
    const u = prog(t, t0, t1);
    const e = E.inOutCubic(u);
    const on = u > 0 && u < 1;
    css(b.p, { strokeDashoffset: String(lerp(140, -b.len, e)), opacity: on ? '1' : '0' });
    const pt = b.p.getPointAtLength(clamp(e * b.len + 0, 0, b.len));
    b.head.setAttribute('cx', pt.x);
    b.head.setAttribute('cy', pt.y);
    css(b.head, { opacity: on ? '1' : '0' });
  };
  beam(c.beams[0], 41.0, 41.3);
  beam(c.beams[1], 41.45, 41.75);
  beam(c.beams[2], 42.2, 42.5);
  const cu = E.outBack(prog(t, 40.2, 40.7));
  const glowPulse = Math.max(0, 1 - Math.abs(t - 41.3) / 0.25);
  css(c.cloud, { transform: `scale(${cu}) translateY(${drift(t, 3, 6)}px)`, filter: `drop-shadow(0 0 ${24 + 30 * glowPulse}px rgba(100,181,246,${0.8 + 0.2 * glowPulse}))` });
  c.a.show(t, 40.15, 43.75);
  c.b.show(t, 40.5, 43.8, { stagger: 0.04 });
  const nu = E.outExpo(prog(t, 40.9, 41.3));
  css(c.note, { opacity: String(nu * (1 - prog(t, 43.8, 44.0))), transform: `translateX(-50%) translateY(${(1 - nu) * 12}px)` });
  return { bg: { pal: PAL.deep, inten: 1, bright: 0.8, zoom: 1.2, off: [0.5, 0.5] } };
});

// =================================================================== S15: pins (44–46)
const PINS = [
  ['light.living_room', 1110, 250],
  ['climate.thermostat', 1470, 250],
  ['lock.front_door', 1110, 610],
  ['cover.garage_door', 1470, 610],
];
zscene('pins', 44.0, 46.0, 20, (root) => {
  const w = worldWin(root, {});
  const bar = topbar(root);
  const pins = PINS.map(([id, x, y]) => {
    const box = el('div', '', root);
    css(box, { position: 'absolute', left: px(x), top: px(y), width: '336px', height: '296px', transformOrigin: '50% 50%' });
    const glass = el('div', '', box);
    css(glass, { position: 'absolute', inset: '0', borderRadius: '24px', backdropFilter: 'blur(24px) saturate(1.5)', boxShadow: '0 24px 60px rgba(0,0,0,.5)' });
    const img = el('img', '', box);
    img.src = `../footage/pins/${id}.png`;
    css(img, { position: 'absolute', inset: '0', width: '100%', height: '100%', borderRadius: '24px' });
    const rim = el('div', '', box);
    css(rim, { position: 'absolute', inset: '0', borderRadius: '24px', boxShadow: 'inset 0 0 0 1px rgba(255,255,255,.14)' });
    return box;
  });
  const a = new Words(root, 'Your favorites, *pinned.*', 'h1', 76, { textShadow: '0 6px 30px rgba(0,0,0,.5)' }).at(1300, 940, 'center');
  return { ...w, bar, pins, a };
}, (t, l, c) => {
  c.win.frame('hero', 4.0 + l);
  const s = 1 + 0.03 * prog(t, 44, 46);
  css(c.world, { transform: cam({ fx: 250, fy: 330, zoom: 1.2 * s, rx: 0, ry: 0, ax: 470, ay: 560 }) });
  c.pins.forEach((p, i) => {
    const t0 = 44.0 + i * 0.25;
    const u = prog(t, t0, t0 + 0.6);
    const sp = u <= 0 ? 0 : E.spring(u, 9, 6);
    css(p, { transform: `translateY(${drift(t, i + 1, 5)}px) scale(${sp * s})`, opacity: String(clamp(u * 4)) });
  });
  c.a.show(t, 44.2, 45.78, { stagger: 0.04 });
  return { bg: { pal: PAL.aurora, inten: 1, bright: 1, zoom: 1.4, off: [-1.0, 0.3] } };
});

const TERM_TEXT = `<span style="color:#7aa2f7">~/home-lab</span> <span style="color:#9ece6a">main</span> ❯ nvim automations.yaml

<span style="color:#565f89">  1</span> <span style="color:#bb9af7">automation</span>:
<span style="color:#565f89">  2</span>   - <span style="color:#7dcfff">alias</span>: <span style="color:#9ece6a">"Evening lights"</span>
<span style="color:#565f89">  3</span>     <span style="color:#7dcfff">trigger</span>:
<span style="color:#565f89">  4</span>       - <span style="color:#7dcfff">platform</span>: sun
<span style="color:#565f89">  5</span>         <span style="color:#7dcfff">event</span>: sunset
<span style="color:#565f89">  6</span>         <span style="color:#7dcfff">offset</span>: <span style="color:#9ece6a">"-00:30:00"</span>
<span style="color:#565f89">  7</span>     <span style="color:#7dcfff">action</span>:
<span style="color:#565f89">  8</span>       - <span style="color:#7dcfff">service</span>: light.turn_on
<span style="color:#565f89">  9</span>         <span style="color:#7dcfff">target</span>:
<span style="color:#565f89"> 10</span>           <span style="color:#7dcfff">entity_id</span>:
<span style="color:#565f89"> 11</span>             - light.living_room
<span style="color:#565f89"> 12</span>             - light.kitchen
<span style="color:#565f89"> 13</span>         <span style="color:#7dcfff">data</span>:
<span style="color:#565f89"> 14</span>           <span style="color:#7dcfff">brightness_pct</span>: <span style="color:#ff9e64">80</span>
<span style="color:#565f89"> 15</span>
<span style="color:#565f89"> 16</span>   - <span style="color:#7dcfff">alias</span>: <span style="color:#9ece6a">"Movie night"</span>
<span style="color:#565f89"> 17</span>     <span style="color:#7dcfff">trigger</span>:
<span style="color:#565f89"> 18</span>       - <span style="color:#7dcfff">platform</span>: state
<span style="color:#565f89"> 19</span>         <span style="color:#7dcfff">entity_id</span>: media_player.living_room
<span style="color:#565f89"> 20</span>         <span style="color:#7dcfff">to</span>: <span style="color:#9ece6a">"playing"</span>`;
const TERM2 = `❯ btop

  cpu  ▁▂▃▅▃▂▂▃▅▆▅▃▂▁▁▂▃▂  12%
  mem  ████████░░░░░░░░  5.2G
  net  ▂▁▁▂▃▂▁▁▁▂▂▁  ↓ 1.2M ↑ 80K

  kitty               0.8%
  hyprland            1.1%
  quickshell          0.6%`;
const TERM3 = `❯ omarchy plugin list
  com.github.robertg761.hadesktopwidget   <span style="color:#9ece6a">enabled</span>
  clock                                   <span style="color:#9ece6a">enabled</span>
  network                                 <span style="color:#9ece6a">enabled</span>
❯ <span style="background:#c0caf5;color:#1a1b26"> </span>`;
// =================================================================== S16: Omarchy bar (46–48)
zscene('omarchy', 46.0, 48.0, 20, (root) => {
  const box = el('div', '', root);
  css(box, { position: 'absolute', inset: '0', background: 'linear-gradient(160deg, #1a1b26 0%, #16161e 100%)', transformOrigin: '1500px 120px' });
  const bar = el('div', 'wbar', box, `<span style="display:flex;gap:16px"><b style="color:#7aa2f7">1</b><span>2</span><span>3</span><span>4</span></span><span>Friday 19:42</span><span style="display:flex;gap:18px;align-items:center"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#cdd6e4" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 5L6 9H3v6h3l5 4z"/><path d="M15.5 8.5a5 5 0 0 1 0 7M18.5 5.5a9 9 0 0 1 0 13"/></svg><span style="opacity:.8">▂▄▆</span><span id="ha-ic" style="display:inline-flex;width:26px;height:26px;align-items:center;justify-content:center;border-radius:6px">${houseSvg(20, '#cdd6e4')}</span><span>⏻</span></span>`);
  const term = el('div', 'tile-o', box);
  css(term, { left: '10px', top: '56px', width: '1040px', height: '1014px', borderColor: '#7aa2f7' });
  term.innerHTML = `<div class="term">${TERM_TEXT}</div>`;
  const t2 = el('div', 'tile-o', box);
  css(t2, { left: '1060px', top: '56px', width: '850px', height: '500px' });
  t2.innerHTML = `<div class="term" style="color:#7f8aa3">${TERM2}</div>`;
  const t3 = el('div', 'tile-o', box);
  css(t3, { left: '1060px', top: '566px', width: '850px', height: '504px' });
  t3.innerHTML = `<div class="term" style="color:#7f8aa3">${TERM3}</div>`;
  const panel = el('div', '', box);
  css(panel, { position: 'absolute', right: '24px', top: '50px', width: '720px', borderRadius: '10px', background: '#16181f', boxShadow: '0 30px 80px rgba(0,0,0,.6), inset 0 0 0 1px rgba(122,162,247,.35)', padding: '20px', boxSizing: 'border-box', transformOrigin: '90% 0' });
  panel.innerHTML = omarchyPanelHtml();
  const cursor = el('div', 'cursor', box, CURSOR_SVG);
  // 76px keeps 'Omarchy 4 bar.' (ends near x=635) clear of the terminal pane's border (~674).
  const a = new Words(root, 'Right in your', 'h1', 76, { textShadow: '0 6px 30px rgba(0,0,0,.6)' }).at(96, 790);
  const b = new Words(root, '*Omarchy* *4* bar.', 'h1', 76, { textShadow: '0 6px 30px rgba(0,0,0,.6)' }).at(96, 878);
  const shade = el('div', '', root);
  css(shade, { position: 'absolute', left: '0', top: '600px', width: '780px', height: '480px', background: 'linear-gradient(0deg, rgba(10,11,16,.85), rgba(10,11,16,0))', webkitMaskImage: 'linear-gradient(90deg, #000 60%, transparent 100%)', maskImage: 'linear-gradient(90deg, #000 60%, transparent 100%)' });
  root.appendChild(a.root);
  root.appendChild(b.root);
  return { box, panel, cursor, ha: box.querySelector('#ha-ic'), a, b };
}, (t, l, c) => {
  const z = E.inOutCubic(prog(t, 46.45, 47.3));
  const s = 1 + 0.42 * z + 0.04 * prog(t, 46, 48);
  css(c.box, { transform: `scale(${s})`, transformOrigin: '1880px 40px' });
  const p0 = { x: 1300, y: 400 };
  const p1 = { x: 1846, y: 20 }; // the Home Assistant icon, not the speaker beside it
  const mu = E.inOutCubic(prog(t, 46.05, 46.42));
  const press = prog(t, 46.48, 46.62);
  css(c.cursor, { display: 'block', transform: `translate(${lerp(p0.x, p1.x, mu)}px, ${lerp(p0.y, p1.y, mu)}px) scale(${press > 0 && press < 1 ? 0.88 : 1})` });
  css(c.ha, { background: t > 46.5 ? 'rgba(122,162,247,.35)' : 'transparent' });
  const pu = E.outExpo(prog(t, 46.52, 46.95));
  css(c.panel, { opacity: String(clamp(pu * 2)), transform: `translateY(${(1 - pu) * -24}px) scale(${0.96 + 0.04 * pu})`, display: t >= 46.5 ? 'block' : 'none' });
  c.a.show(t, 46.15, 47.78);
  c.b.show(t, 46.35, 47.8);
  return { bg: { pal: PAL.deep, inten: 0, bright: 0 } };
});
function houseSvg(size, color) {
  return `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="${color}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 11l9-7 9 7"/><path d="M5 10v10h14V10"/></svg>`;
}
function omarchyPanelHtml() {
  // The widget's Home page, as the panel draws it.
  const tiles = [
    ['Living room', '80%', true, 'bulb'], ['Kitchen', 'Off', false, 'bulb'], ['Thermostat', '20.5°C', true, 'flame'], ['Front door', 'Locked', false, 'lock'],
    ['Garage', 'Closed', false, 'garage'], ['Movie night', '', false, 'spark'], ['Energy now', '1.42 kW', false, 'bolt'], ['Robot vacuum', 'Docked', false, 'bot'],
    ['Sam', 'Home', false, 'home'],
  ];
  const ic = {
    bulb: '<path d="M9 18h6M10 21h4M12 3a6 6 0 0 0-4 10.5c.7.7 1 1.5 1 2.5h6c0-1 .3-1.8 1-2.5A6 6 0 0 0 12 3z"/>',
    flame: '<path d="M12 3c1 3 5 5 5 10a5 5 0 0 1-10 0c0-3 2-4 2-6 2 1 3 3 3-4z"/>',
    lock: '<rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/>',
    garage: '<path d="M3 10l9-6 9 6v11H3z"/><path d="M7 21v-8h10v8M7 16h10"/>',
    spark: '<path d="M12 4l1.8 4.8L18 10l-4.2 1.4L12 16l-1.8-4.6L6 10l4.2-1.2z"/>',
    bot: '<rect x="5" y="8" width="14" height="10" rx="3"/><path d="M12 4v4M9 13h.01M15 13h.01"/>',
    bolt: '<path d="M13 3L5 13h6l-1 8 8-10h-6z"/>',
    home: '<path d="M3 11l9-7 9 7"/><path d="M5 10v10h14V10"/>',
  };
  const cell = ([n, s, on, i]) => `<div style="height:118px;border-radius:8px;padding:14px;box-sizing:border-box;background:${on ? 'rgba(122,162,247,.18)' : 'rgba(255,255,255,.04)'};box-shadow:inset 0 0 0 1px ${on ? 'rgba(122,162,247,.55)' : 'rgba(255,255,255,.08)'};display:flex;flex-direction:column;align-items:center;justify-content:center;gap:6px;font-family:Inter">
    <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="${on ? '#7aa2f7' : '#a9b1d6'}" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" style="${on ? 'filter:drop-shadow(0 0 6px #7aa2f7)' : ''}">${ic[i]}</svg>
    <div style="font:600 15px Inter;color:#e0e6f5">${n}</div><div style="font:500 13px Inter;color:${on ? '#a9c1ff' : '#8a93ad'}">${s}</div></div>`;
  return `<div style="display:flex;align-items:baseline;justify-content:space-between;margin:0 4px 14px"><span style="font:700 18px Inter;color:#e0e6f5">Home Assistant</span><span style="font:500 13px Inter;color:#9ece6a">● Connected</span></div>
  <div style="font:700 13px Inter;letter-spacing:.12em;color:#8a93ad;margin:2px 4px 12px">HOME</div>
  <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:10px">${tiles.map(cell).join('')}</div>`;
}

// =================================================================== S17: rapid fire (48–52)
const RAPID = [
  [48.0, 'camera', 1.35, PAL.night, 'Live camera view', { fx: 234, fy: 330, zoom: 2.5 }],
  [48.5, 'alarm', 2.1, PAL.rose, 'Alarm control', { fx: 250, fy: 230, zoom: 1.8 }],
  [49.0, 'notifications', 0.75, PAL.aurora, 'Home Assistant notifications', { fx: 250, fy: 300, zoom: 1.55 }],
  [49.5, 'export', 0.3, PAL.aqua, 'Export & import settings', { fx: 265, fy: 330, zoom: 2.2 }],
  [50.0, 'lang', 0, PAL.violet, 'Speaks 7 languages', null],
  [50.5, 'hotkeys', 0.2, PAL.amber, 'Global hotkeys', { fx: 270, fy: 482, zoom: 3.0 }],
];
zscene('rapid', 48.0, 52.0, 20, (root) => {
  const w = worldWin(root, {});
  const langs = ['lang_ar', 'lang_zh', 'lang_hi'].map((d) => {
    const pp = el('div', 'persp', root);
    const ww = el('div', 'world', pp);
    const win = new AppWin(ww, {});
    return { pp, ww, win, d };
  });
  const pill = el('div', 'pill', root, '<b></b><span></span>');
  const more = new Words(root, 'And so much more.', 'h1', 120).at(960, 470, 'center');
  return { ...w, langs, pill, more };
}, (t, l, c) => {
  let k = 0;
  for (let i = 0; i < RAPID.length; i++) if (t >= RAPID[i][0]) k = i;
  const [t0, dir, from, pal, label, view] = RAPID[k];
  const lt = t - t0;
  const inMore = t >= 51.0;
  const isLang = dir === 'lang' && !inMore;
  css(c.persp, { display: isLang || inMore ? 'none' : 'block' });
  c.langs.forEach((L, i) => {
    css(L.pp, { display: isLang ? 'block' : 'none' });
    if (!isLang) return;
    L.win.frame(L.d, 0.2 + lt * 0.4);
    const u = E.outExpo(prog(lt, i * 0.04, 0.3 + i * 0.04));
    const x = 420 + i * 540;
    css(L.ww, { transform: cam({ fx: 250, fy: 330, zoom: 1.12, ax: x + (1 - u) * 200, ay: 540, ry: (i - 1) * -10, rx: 2 }) });
    css(L.win.root, { opacity: String(clamp(u * 1.5)) });
  });
  if (!isLang && !inMore) {
    c.win.frame(dir, from + lt);
    const u = prog(lt, 0, 0.5);
    const side = k % 2 ? 1 : -1;
    css(c.world, { transform: cam({ ...view, zoom: view.zoom * (1 + 0.06 * E.outCubic(u)), rx: 3, ry: side * (12 - 5 * u), ax: 960, ay: 560 }) });
  }
  // label pill, bottom left
  if (!inMore) {
    const pu = E.outExpo(prog(lt, 0, 0.22));
    c.pill.querySelector('span').textContent = label;
    css(c.pill.querySelector('b'), { background: hexOf(pal[2]), boxShadow: `0 0 14px ${hexOf(pal[2])}` });
    css(c.pill, { display: 'flex', left: '80px', top: '940px', opacity: String(pu), transform: `translateX(${(1 - pu) * -30}px)`, fontSize: '34px', padding: '16px 28px 16px 22px' });
  } else css(c.pill, { display: 'none' });
  c.more.show(t, 51.0, 99, { stagger: 0.05, dur: 0.35 });
  if (inMore) return { bg: { pal: PAL.deep, inten: 0.6, bright: 0.35 } };
  return { bg: { pal, inten: 1, bright: 0.85, zoom: 1.5, off: [k * 0.9, -0.3] } };
});

// =================================================================== S18: finale (52–56)
zscene('finale', 52.0, 56.0, 20, (root) => {
  const w = worldWin(root, {});
  const bar = topbar(root);
  const pins = [
    ['light.living_room', 250, 330, -1],
    ['climate.thermostat', 300, 690, -1],
    ['lock.front_door', 1330, 330, 1],
    ['cover.garage_door', 1290, 690, 1],
  ].map(([id, x, y, side]) => {
    const box = el('div', '', root);
    css(box, { position: 'absolute', left: px(x), top: px(y), width: '336px', height: '296px' });
    const glass = el('div', '', box);
    css(glass, { position: 'absolute', inset: '0', borderRadius: '24px', backdropFilter: 'blur(24px) saturate(1.5)', boxShadow: '0 24px 60px rgba(0,0,0,.5)' });
    const img = el('img', '', box);
    img.src = `../footage/pins/${id}.png`;
    css(img, { position: 'absolute', inset: '0', width: '100%', height: '100%', borderRadius: '24px' });
    return { box, side };
  });
  const a = new Words(root, 'Your whole home.', 'h1', 92, { textShadow: '0 6px 30px rgba(0,0,0,.45)' }).at(960, 70, 'center');
  const b = new Words(root, 'One glance away.', 'h1', 92, { textShadow: '0 6px 30px rgba(0,0,0,.45)' }).at(960, 70, 'center');
  return { ...w, bar, pins, a, b };
}, (t, l, c) => {
  c.win.frame('hero', 0.5 + l * 0.9);
  const u = E.inOutQuad(prog(t, 52, 56));
  const s = lerp(0.98, 1.1, u);
  css(c.world, { transform: cam({ fx: 250, fy: 330, zoom: 1.12 * s, rx: lerp(3, 1, u), ry: lerp(-6, 4, u), ax: 960, ay: 600 }) });
  c.pins.forEach((p, i) => {
    const pu = E.outExpo(prog(t, 52.0 + i * 0.08, 52.8 + i * 0.08));
    const dx = (1 - pu) * 260 * p.side + (s - 1) * 600 * p.side;
    css(p.box, { transform: `translate(${dx}px, ${drift(t, i + 7, 8)}px) scale(${0.9 * s})`, opacity: String(clamp(pu * 1.5)) });
  });
  FX.flash = 0.8 * (1 - prog(t, 52.0, 52.25)) ** 2.2;
  c.a.show(t, 52.25, 53.6);
  c.b.show(t, 54.05, 55.75);
  return { bg: { pal: PAL.aurora, inten: 1, bright: 1.05, zoom: 1.5, off: [0.4 + l * 0.04, -0.1] } };
});

// =================================================================== S19: end card (56–62)
zscene('end', 56.0, 62.01, 30, (root) => {
  const halo = el('div', 'glow', root);
  css(halo, { left: '660px', top: '40px', width: '600px', height: '600px', background: 'radial-gradient(circle, rgba(100,181,246,.32), rgba(100,181,246,0) 62%)' });
  const icon = el('img', '', root);
  icon.src = 'assets/icon.png';
  css(icon, { position: 'absolute', left: '870px', top: '170px', width: '180px', height: '180px', filter: 'drop-shadow(0 18px 50px rgba(0,0,0,.6))' });
  const word = el('div', 'type h1', root, 'HA Desktop Widget <span class="grad">4.0</span>');
  css(word, { left: '960px', top: '395px', fontSize: '92px', transform: 'translateX(-50%)' });
  const l2 = el('div', 'type h2', root, 'Free and open source.');
  css(l2, { left: '960px', top: '535px', fontSize: '46px', transform: 'translateX(-50%)', color: '#e6edf8' });
  const l3 = el('div', 'type cap', root, 'Windows &nbsp;·&nbsp; macOS &nbsp;·&nbsp; Linux');
  css(l3, { left: '960px', top: '610px', fontSize: '32px', transform: 'translateX(-50%)', letterSpacing: '0.04em' });
  const url = el('div', 'pill', root, '<b></b><span>hadesktopwidget.com</span>');
  css(url, { left: '960px', top: '720px', fontSize: '36px', padding: '18px 34px 18px 26px' });
  const fine = el('div', 'type cap', root, 'An independent project, not affiliated with or endorsed by Home Assistant or the Open Home Foundation.<br>Cloud Sync is an optional subscription. Folder sync is free.');
  css(fine, { left: '960px', top: '948px', fontSize: '26px', lineHeight: '1.45', textAlign: 'center', transform: 'translateX(-50%)', color: 'rgba(215,225,240,.8)', letterSpacing: '0', fontWeight: '400' });
  return { halo, icon, word, l2, l3, url, fine };
}, (t, l, c) => {
  const iu = E.outExpo(prog(t, 56.0, 56.8));
  css(c.icon, { opacity: String(iu), transform: `translateY(${(1 - iu) * 30}px) scale(${1.25 - 0.25 * iu})` });
  css(c.halo, { opacity: String(iu * (0.8 + 0.2 * Math.sin(t * 2))) });
  const fade = (e, t0, dy = 24) => {
    const u = E.outExpo(prog(t, t0, t0 + 0.8));
    css(e, { opacity: String(u), transform: `translateX(-50%) translateY(${(1 - u) * dy}px)`, filter: u < 1 ? `blur(${(1 - u) * 8}px)` : 'none' });
  };
  fade(c.word, 56.25, 30);
  fade(c.l2, 56.9);
  fade(c.l3, 57.25);
  fade(c.url, 57.7);
  css(c.fine, { opacity: String(E.inOutQuad(prog(t, 57.3, 57.9))) });
  FX.flash = 0.75 * (1 - prog(t, 56.0, 56.25)) ** 2.2;
  FX.black = E.inOutQuad(prog(t, 61.5, 62.0));
  return { bg: { pal: PAL.end, inten: 0.9, bright: 0.8, zoom: 1.3, off: [l * 0.03, 0] } };
});

// ------------------------------------------------------------------ init
window.compInit = async (manifest) => {
  MANIFEST = manifest;
  BG.init();
  await Promise.all(['pages', 'settings', 'palette', 'open'].map(loadTrack));
  return true;
};

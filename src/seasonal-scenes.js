/**
 * The background scenes for the seasonal themes. A scene is a list of layers drawn back to front;
 * each layer keeps its own state:
 *   init(width, height)                          -> state (with `particles` when it has any)
 *   update(state, width, height, frameScale, time, env)  optional; frameScale 1 is one 60fps
 *     frame, and env.findClearLane(preferredY, band) finds a height clear of the tiles
 *   draw(ctx, state, frame)                       frame = { time, light, width, height }
 * Sizes are CSS pixels. Layers that only exist while animating (fireworks, passers-by) start
 * empty, so a reduced-motion still frame leaves them out.
 */

// Particles per 100,000 px² of window, so a small widget is not crowded.
const AREA_UNIT = 100000;

const random = (min, max) => min + Math.random() * (max - min);
const pick = (items) => items[Math.floor(Math.random() * items.length)];
const TAU = Math.PI * 2;

function countFor(width, height, perUnit, min, max) {
  return Math.round(Math.min(max, Math.max(min, ((width * height) / AREA_UNIT) * perUnit)));
}

// Silhouettes read as pale shapes on a dark window and dark ones on a light window.
const silhouette = (light, dark = '#c4b5fd', onLight = '#2e1a47') => (light ? onLight : dark);

// ---------------------------------------------------------------------------------------------
// Sprites
// ---------------------------------------------------------------------------------------------

// A heart with its point at (0, size) and its lobes near (±0.6·size, -0.8·size).
function traceHeart(ctx, size) {
  ctx.moveTo(0, size);
  ctx.bezierCurveTo(-1.3 * size, 0.1 * size, -0.9 * size, -1.1 * size, 0, -0.45 * size);
  ctx.bezierCurveTo(0.9 * size, -1.1 * size, 1.3 * size, 0.1 * size, 0, size);
}

function drawBat(ctx, p, light) {
  const s = p.size;
  // Wings sweep from raised to lowered; 1 is fully raised.
  const lift = Math.cos(p.flap);
  ctx.save();
  ctx.translate(p.x, p.y);
  if (p.vx < 0) ctx.scale(-1, 1);
  // Dark bats on a light window need more weight to read at the same size.
  ctx.globalAlpha = light ? Math.min(0.75, p.opacity * 1.5) : p.opacity;
  ctx.fillStyle = silhouette(light);
  for (const side of [1, -1]) {
    ctx.save();
    ctx.scale(side, 1);
    const tipY = -0.55 * s * lift;
    ctx.beginPath();
    ctx.moveTo(0.1 * s, -0.1 * s);
    ctx.quadraticCurveTo(0.6 * s, -0.7 * s * lift - 0.1 * s, 1.25 * s, tipY);
    // Scalloped trailing edge back to the body.
    ctx.quadraticCurveTo(1.0 * s, tipY * 0.35 + 0.05 * s, 0.85 * s, tipY * 0.25 + 0.2 * s);
    ctx.quadraticCurveTo(0.65 * s, tipY * 0.15 + 0.05 * s, 0.45 * s, tipY * 0.1 + 0.25 * s);
    ctx.quadraticCurveTo(0.3 * s, 0.1 * s, 0.1 * s, 0.2 * s);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }
  ctx.beginPath();
  ctx.ellipse(0, 0.05 * s, 0.16 * s, 0.3 * s, 0, 0, TAU);
  ctx.fill();
  ctx.beginPath();
  ctx.moveTo(-0.12 * s, -0.2 * s);
  ctx.lineTo(-0.08 * s, -0.42 * s);
  ctx.lineTo(0, -0.24 * s);
  ctx.lineTo(0.08 * s, -0.42 * s);
  ctx.lineTo(0.12 * s, -0.2 * s);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

function drawGhost(ctx, x, y, s, alpha, time, light) {
  ctx.save();
  ctx.translate(x, y);
  ctx.globalAlpha = alpha;
  ctx.fillStyle = light ? 'rgba(255, 255, 255, 0.95)' : '#f5f3ff';
  ctx.strokeStyle = light ? 'rgba(90, 70, 130, 0.5)' : 'rgba(196, 181, 253, 0.6)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.arc(0, 0, s, Math.PI, 0);
  ctx.lineTo(s, s * 1.2);
  // A hem that ripples as it drifts.
  const wave = Math.sin(time * 0.006) * s * 0.12;
  for (let i = 0; i < 4; i++) {
    const x0 = s - (i * 2 * s) / 4;
    const x1 = s - ((i + 1) * 2 * s) / 4;
    ctx.quadraticCurveTo((x0 + x1) / 2, s * 0.95 + (i % 2 ? wave : -wave), x1, s * 1.2);
  }
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = '#1e1b4b';
  ctx.beginPath();
  ctx.ellipse(-s * 0.35, -s * 0.1, s * 0.13, s * 0.2, 0, 0, TAU);
  ctx.ellipse(s * 0.35, -s * 0.1, s * 0.13, s * 0.2, 0, 0, TAU);
  ctx.fill();
  ctx.beginPath();
  ctx.ellipse(0, s * 0.35, s * 0.14, s * 0.18 + Math.sin(time * 0.004) * s * 0.04, 0, 0, TAU);
  ctx.fill();
  ctx.restore();
}

function drawWitch(ctx, x, y, s, direction, time, light) {
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(direction, 1);
  ctx.fillStyle = silhouette(light);
  ctx.strokeStyle = silhouette(light);
  ctx.globalAlpha = light ? 0.75 : 0.7;
  ctx.lineCap = 'round';
  ctx.lineWidth = Math.max(1.5, s * 0.07);
  // Broomstick and bristles.
  ctx.beginPath();
  ctx.moveTo(-s * 1.1, s * 0.15);
  ctx.lineTo(s * 0.9, -s * 0.05);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(-s * 1.05, s * 0.12);
  ctx.lineTo(-s * 1.65, -s * 0.12);
  ctx.lineTo(-s * 1.75, s * 0.3);
  ctx.lineTo(-s * 1.55, s * 0.5);
  ctx.closePath();
  ctx.fill();
  // Cloak, streaming behind.
  const flutter = Math.sin(time * 0.012) * s * 0.12;
  ctx.beginPath();
  ctx.moveTo(s * 0.35, s * 0.02);
  ctx.lineTo(s * 0.2, -s * 0.72);
  ctx.quadraticCurveTo(-s * 0.3, -s * 0.5, -s * 0.85, -s * 0.2 + flutter);
  ctx.lineTo(-s * 0.2, s * 0.05);
  ctx.closePath();
  ctx.fill();
  ctx.beginPath();
  ctx.arc(s * 0.25, -s * 0.86, s * 0.17, 0, TAU);
  ctx.fill();
  // Hat.
  ctx.beginPath();
  ctx.ellipse(s * 0.24, -s * 0.98, s * 0.34, s * 0.06, -0.1, 0, TAU);
  ctx.fill();
  ctx.beginPath();
  ctx.moveTo(s * 0.08, -s * 1.0);
  ctx.lineTo(s * 0.4, -s * 1.02);
  ctx.quadraticCurveTo(s * 0.2, -s * 1.3, -s * 0.12, -s * 1.5);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

function drawPumpkin(
  ctx,
  x,
  y,
  s,
  { face = true, flicker = 1, color = '#f97316', alpha = 1 } = {}
) {
  ctx.save();
  ctx.translate(x, y);
  ctx.globalAlpha = alpha;
  if (face) {
    const glow = ctx.createRadialGradient(0, 0, 0, 0, 0, s * 2.4);
    glow.addColorStop(0, `rgba(255, 150, 50, ${0.3 * flicker})`);
    glow.addColorStop(1, 'rgba(255, 120, 40, 0)');
    ctx.fillStyle = glow;
    ctx.beginPath();
    ctx.arc(0, 0, s * 2.4, 0, TAU);
    ctx.fill();
  }
  ctx.fillStyle = '#4d7c0f';
  ctx.beginPath();
  ctx.moveTo(-s * 0.08, -s * 0.7);
  ctx.quadraticCurveTo(-s * 0.05, -s * 1.05, s * 0.25, -s * 1.1);
  ctx.lineTo(s * 0.25, -s * 0.98);
  ctx.quadraticCurveTo(s * 0.08, -s * 0.95, s * 0.1, -s * 0.7);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = color === '#f97316' ? '#ea580c' : color;
  ctx.globalAlpha = alpha * 0.85;
  ctx.beginPath();
  ctx.ellipse(-s * 0.42, 0, s * 0.55, s * 0.7, 0, 0, TAU);
  ctx.ellipse(s * 0.42, 0, s * 0.55, s * 0.7, 0, 0, TAU);
  ctx.fill();
  ctx.globalAlpha = alpha;
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.ellipse(0, 0, s * 0.58, s * 0.76, 0, 0, TAU);
  ctx.fill();
  if (face) {
    ctx.fillStyle = `rgba(253, 224, 71, ${0.65 + 0.35 * flicker})`;
    ctx.beginPath();
    for (const side of [-1, 1]) {
      ctx.moveTo(side * s * 0.42, -s * 0.12);
      ctx.lineTo(side * s * 0.25, -s * 0.42);
      ctx.lineTo(side * s * 0.08, -s * 0.12);
      ctx.closePath();
    }
    ctx.moveTo(-s * 0.5, s * 0.15);
    ctx.quadraticCurveTo(0, s * 0.62, s * 0.5, s * 0.15);
    ctx.lineTo(s * 0.32, s * 0.22);
    ctx.lineTo(s * 0.22, s * 0.1);
    ctx.lineTo(s * 0.08, s * 0.26);
    ctx.lineTo(-s * 0.08, s * 0.12);
    ctx.lineTo(-s * 0.22, s * 0.26);
    ctx.lineTo(-s * 0.32, s * 0.1);
    ctx.closePath();
    ctx.fill();
  }
  ctx.restore();
}

function drawSnowflake(ctx, p, light) {
  ctx.save();
  ctx.translate(p.x, p.y);
  ctx.globalAlpha = p.opacity;
  const color = light ? '#7c9cc4' : '#ffffff';
  if (p.size < 2.6) {
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(0, 0, p.size, 0, TAU);
    ctx.fill();
  } else {
    ctx.rotate(p.rotation);
    ctx.strokeStyle = color;
    ctx.lineWidth = 1.1;
    ctx.lineCap = 'round';
    ctx.beginPath();
    for (let arm = 0; arm < 6; arm++) {
      const angle = (arm * Math.PI) / 3;
      const r = p.size * 1.6;
      const cos = Math.cos(angle);
      const sin = Math.sin(angle);
      ctx.moveTo(0, 0);
      ctx.lineTo(cos * r, sin * r);
      // A small V near each tip.
      const bx = cos * r * 0.6;
      const by = sin * r * 0.6;
      const side = r * 0.3;
      ctx.moveTo(bx, by);
      ctx.lineTo(bx + Math.cos(angle + 0.7) * side, by + Math.sin(angle + 0.7) * side);
      ctx.moveTo(bx, by);
      ctx.lineTo(bx + Math.cos(angle - 0.7) * side, by + Math.sin(angle - 0.7) * side);
    }
    ctx.stroke();
  }
  ctx.restore();
}

function drawSleigh(ctx, x, y, s, direction, time, light) {
  const outline = light ? '#334155' : 'rgba(226, 232, 240, 0.85)';
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(direction, 1);
  ctx.lineCap = 'round';
  ctx.strokeStyle = outline;
  ctx.fillStyle = outline;
  // Three reindeer ahead of the sleigh, the lead one with a glowing red nose.
  for (let i = 0; i < 3; i++) {
    const rx = s * (2.6 + i * 2.4);
    const ry = Math.sin(time * 0.012 + i * 1.3) * 2;
    ctx.globalAlpha = 0.75;
    ctx.lineWidth = Math.max(1, s * 0.12);
    ctx.beginPath();
    ctx.moveTo(-s * 0.1, -s * 0.15);
    ctx.lineTo(rx - s * 0.5, ry);
    ctx.stroke();
    ctx.beginPath();
    ctx.ellipse(rx, ry, s * 0.7, s * 0.3, 0, 0, TAU);
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(rx + s * 0.5, ry - s * 0.1);
    ctx.lineTo(rx + s * 0.85, ry - s * 0.55);
    ctx.stroke();
    ctx.beginPath();
    ctx.ellipse(rx + s * 0.98, ry - s * 0.6, s * 0.24, s * 0.14, 0.2, 0, TAU);
    ctx.fill();
    ctx.lineWidth = Math.max(0.8, s * 0.07);
    ctx.beginPath();
    ctx.moveTo(rx + s * 0.85, ry - s * 0.7);
    ctx.lineTo(rx + s * 0.7, ry - s * 1.15);
    ctx.moveTo(rx + s * 0.76, ry - s * 0.95);
    ctx.lineTo(rx + s * 0.55, ry - s * 1.05);
    ctx.moveTo(rx + s * 0.92, ry - s * 0.72);
    ctx.lineTo(rx + s * 1.0, ry - s * 1.12);
    ctx.stroke();
    const gallop = Math.sin(time * 0.02 + i);
    ctx.lineWidth = Math.max(0.8, s * 0.09);
    ctx.beginPath();
    for (const [lx, phase] of [
      [s * 0.4, 0],
      [-s * 0.45, Math.PI],
    ]) {
      const swing = Math.sin(time * 0.02 + i + phase) * s * 0.35;
      ctx.moveTo(rx + lx, ry + s * 0.2);
      ctx.lineTo(rx + lx + swing + gallop, ry + s * 0.8);
    }
    ctx.stroke();
    if (i === 2) {
      const nose = ctx.createRadialGradient(
        rx + s * 1.2,
        ry - s * 0.6,
        0,
        rx + s * 1.2,
        ry - s * 0.6,
        s * 0.6
      );
      nose.addColorStop(0, 'rgba(248, 113, 113, 0.9)');
      nose.addColorStop(1, 'rgba(248, 113, 113, 0)');
      ctx.globalAlpha = 0.6 + 0.4 * Math.sin(time * 0.008);
      ctx.fillStyle = nose;
      ctx.beginPath();
      ctx.arc(rx + s * 1.2, ry - s * 0.6, s * 0.6, 0, TAU);
      ctx.fill();
      ctx.globalAlpha = 1;
      ctx.fillStyle = '#ef4444';
      ctx.beginPath();
      ctx.arc(rx + s * 1.2, ry - s * 0.6, s * 0.13, 0, TAU);
      ctx.fill();
      ctx.fillStyle = outline;
    }
  }
  // Sack, Santa and the sleigh itself.
  ctx.globalAlpha = 0.9;
  ctx.fillStyle = '#92400e';
  ctx.beginPath();
  ctx.arc(-s * 1.05, -s * 0.45, s * 0.38, 0, TAU);
  ctx.fill();
  ctx.fillStyle = '#dc2626';
  ctx.beginPath();
  ctx.arc(-s * 0.45, -s * 0.45, s * 0.34, 0, TAU);
  ctx.fill();
  ctx.fillStyle = '#fcd9b6';
  ctx.beginPath();
  ctx.arc(-s * 0.4, -s * 0.92, s * 0.17, 0, TAU);
  ctx.fill();
  ctx.fillStyle = '#f8fafc';
  ctx.beginPath();
  ctx.arc(-s * 0.35, -s * 0.78, s * 0.14, 0, TAU);
  ctx.fill();
  ctx.fillStyle = '#dc2626';
  ctx.beginPath();
  ctx.moveTo(-s * 0.58, -s * 1.02);
  ctx.lineTo(-s * 0.22, -s * 1.02);
  ctx.lineTo(-s * 0.7, -s * 1.35);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = '#b91c1c';
  ctx.beginPath();
  ctx.moveTo(-s * 1.5, -s * 0.3);
  ctx.lineTo(-s * 1.35, s * 0.3);
  ctx.lineTo(s * 0.2, s * 0.3);
  ctx.quadraticCurveTo(s * 0.55, s * 0.1, s * 0.35, -s * 0.2);
  ctx.lineTo(-s * 0.1, -s * 0.05);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = '#fbbf24';
  ctx.lineWidth = Math.max(1, s * 0.1);
  ctx.beginPath();
  ctx.moveTo(-s * 1.6, s * 0.55);
  ctx.lineTo(s * 0.35, s * 0.55);
  ctx.quadraticCurveTo(s * 0.8, s * 0.55, s * 0.7, s * 0.2);
  ctx.stroke();
  ctx.restore();
}

function drawHeart(ctx, p) {
  ctx.save();
  ctx.translate(p.x, p.y);
  ctx.rotate(p.rotation);
  ctx.globalAlpha = p.opacity;
  ctx.fillStyle = p.color;
  ctx.beginPath();
  traceHeart(ctx, p.size);
  ctx.fill();
  ctx.restore();
}

function drawHeartBalloon(ctx, p) {
  const s = p.size;
  ctx.save();
  ctx.translate(p.x, p.y);
  ctx.globalAlpha = p.opacity;
  ctx.strokeStyle = 'rgba(156, 163, 175, 0.7)';
  ctx.lineWidth = 0.8;
  ctx.beginPath();
  ctx.moveTo(0, s);
  ctx.quadraticCurveTo(Math.sin(p.sway) * s, s * 2.2, Math.sin(p.sway + 1) * s * 0.5, s * 3.4);
  ctx.stroke();
  ctx.rotate(Math.sin(p.sway) * 0.15);
  ctx.fillStyle = p.color;
  ctx.beginPath();
  traceHeart(ctx, s);
  ctx.fill();
  ctx.fillStyle = 'rgba(255, 255, 255, 0.45)';
  ctx.beginPath();
  ctx.ellipse(-s * 0.4, -s * 0.35, s * 0.18, s * 0.28, -0.6, 0, TAU);
  ctx.fill();
  ctx.restore();
}

function drawShamrock(ctx, p) {
  ctx.save();
  ctx.translate(p.x, p.y);
  ctx.rotate(p.rotation);
  ctx.scale(Math.cos(p.spin), 1);
  ctx.globalAlpha = p.opacity;
  ctx.fillStyle = p.color;
  const leaf = p.size * 0.5;
  for (let i = 0; i < 3; i++) {
    ctx.save();
    ctx.rotate((i * TAU) / 3);
    // Each leaf is a heart with its point at the centre.
    ctx.translate(0, -leaf);
    ctx.rotate(Math.PI);
    ctx.beginPath();
    traceHeart(ctx, leaf);
    ctx.fill();
    ctx.restore();
  }
  ctx.strokeStyle = p.color;
  ctx.lineWidth = Math.max(1, p.size * 0.12);
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.quadraticCurveTo(p.size * 0.2, p.size * 0.6, p.size * 0.1, p.size * 1.1);
  ctx.stroke();
  ctx.restore();
}

function drawSparkle(ctx, p, time) {
  const twinkle = 0.5 + 0.5 * Math.sin(time * p.twinkleSpeed + p.phase);
  ctx.save();
  ctx.translate(p.x, p.y);
  ctx.globalAlpha = p.opacity * twinkle;
  ctx.fillStyle = p.color;
  const s = p.size * (0.6 + 0.4 * twinkle);
  ctx.beginPath();
  ctx.moveTo(0, -s);
  ctx.quadraticCurveTo(0, 0, s, 0);
  ctx.quadraticCurveTo(0, 0, 0, s);
  ctx.quadraticCurveTo(0, 0, -s, 0);
  ctx.quadraticCurveTo(0, 0, 0, -s);
  ctx.fill();
  ctx.restore();
}

function drawCoin(ctx, p) {
  ctx.save();
  ctx.translate(p.x, p.y);
  ctx.scale(Math.cos(p.spin), 1);
  ctx.globalAlpha = p.opacity;
  ctx.fillStyle = '#facc15';
  ctx.strokeStyle = '#a16207';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.arc(0, 0, p.size, 0, TAU);
  ctx.fill();
  ctx.stroke();
  ctx.strokeStyle = 'rgba(161, 98, 7, 0.6)';
  ctx.beginPath();
  ctx.arc(0, 0, p.size * 0.65, 0, TAU);
  ctx.stroke();
  ctx.restore();
}

function drawPetal(ctx, p) {
  ctx.save();
  ctx.translate(p.x, p.y);
  ctx.rotate(p.rotation);
  ctx.scale(Math.cos(p.spin), 1);
  ctx.globalAlpha = p.opacity;
  ctx.fillStyle = p.color;
  const s = p.size;
  ctx.beginPath();
  ctx.moveTo(0, -s);
  ctx.quadraticCurveTo(s * 0.9, -s * 0.2, 0, s);
  ctx.quadraticCurveTo(-s * 0.9, -s * 0.2, 0, -s);
  ctx.fill();
  ctx.restore();
}

function drawBlossom(ctx, p) {
  ctx.save();
  ctx.translate(p.x, p.y);
  ctx.rotate(p.rotation);
  ctx.scale(Math.cos(p.spin) * 0.4 + 0.6, 1);
  ctx.globalAlpha = p.opacity;
  ctx.fillStyle = p.color;
  for (let i = 0; i < 5; i++) {
    const angle = (i * TAU) / 5;
    ctx.beginPath();
    ctx.arc(Math.cos(angle) * p.size * 0.55, Math.sin(angle) * p.size * 0.55, p.size * 0.5, 0, TAU);
    ctx.fill();
  }
  ctx.fillStyle = '#fde047';
  ctx.beginPath();
  ctx.arc(0, 0, p.size * 0.3, 0, TAU);
  ctx.fill();
  ctx.restore();
}

function drawButterfly(ctx, p) {
  const s = p.size;
  const open = 0.25 + 0.75 * Math.abs(Math.cos(p.flap));
  ctx.save();
  ctx.translate(p.x, p.y);
  ctx.rotate(p.heading + Math.PI / 2);
  ctx.globalAlpha = p.opacity;
  for (const side of [-1, 1]) {
    ctx.save();
    ctx.scale(side * open, 1);
    ctx.fillStyle = p.color;
    ctx.beginPath();
    ctx.ellipse(s * 0.55, -s * 0.3, s * 0.55, s * 0.42, -0.5, 0, TAU);
    ctx.fill();
    ctx.fillStyle = p.accent;
    ctx.beginPath();
    ctx.ellipse(s * 0.42, s * 0.35, s * 0.36, s * 0.3, 0.5, 0, TAU);
    ctx.fill();
    ctx.restore();
  }
  ctx.fillStyle = '#4b5563';
  ctx.beginPath();
  ctx.ellipse(0, 0, s * 0.09, s * 0.5, 0, 0, TAU);
  ctx.fill();
  ctx.restore();
}

function drawBunny(ctx, x, y, s, direction, hop, light) {
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(direction, 1);
  ctx.globalAlpha = 0.9;
  ctx.fillStyle = '#f8fafc';
  ctx.strokeStyle = light ? 'rgba(113, 113, 122, 0.7)' : 'rgba(212, 212, 216, 0.6)';
  ctx.lineWidth = 1;
  const stretch = 1 + hop * 0.15;
  ctx.beginPath();
  ctx.ellipse(0, -s * 0.6, s * 0.8 * stretch, s * 0.58, -hop * 0.3, 0, TAU);
  ctx.fill();
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(-s * 0.82, -s * 0.72, s * 0.22, 0, TAU);
  ctx.fill();
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(s * 0.72, -s * 1.08, s * 0.42, 0, TAU);
  ctx.fill();
  ctx.stroke();
  for (const [ex, tilt] of [
    [s * 0.55, -0.25],
    [s * 0.82, 0.1],
  ]) {
    ctx.fillStyle = '#f8fafc';
    ctx.beginPath();
    ctx.ellipse(ex, -s * 1.8, s * 0.15, s * 0.5, tilt - hop * 0.4, 0, TAU);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = '#f9a8d4';
    ctx.beginPath();
    ctx.ellipse(ex, -s * 1.8, s * 0.06, s * 0.36, tilt - hop * 0.4, 0, TAU);
    ctx.fill();
  }
  ctx.fillStyle = '#1f2937';
  ctx.beginPath();
  ctx.arc(s * 0.86, -s * 1.14, s * 0.06, 0, TAU);
  ctx.fill();
  ctx.fillStyle = '#f472b6';
  ctx.beginPath();
  ctx.arc(s * 1.12, -s * 1.02, s * 0.06, 0, TAU);
  ctx.fill();
  ctx.restore();
}

function drawTurkey(ctx, x, y, s, direction, step) {
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(direction, 1);
  ctx.globalAlpha = 0.92;
  const feathers = ['#b91c1c', '#ea580c', '#f59e0b', '#ea580c', '#b91c1c'];
  feathers.forEach((color, i) => {
    ctx.save();
    ctx.translate(-s * 0.3, -s * 1.0);
    ctx.rotate(-1.2 + i * 0.6 + Math.sin(step * 0.5) * 0.04);
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.ellipse(0, -s * 0.75, s * 0.28, s * 0.8, 0, 0, TAU);
    ctx.fill();
    ctx.restore();
  });
  ctx.strokeStyle = '#f59e0b';
  ctx.lineWidth = Math.max(1, s * 0.1);
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(-s * 0.15, -s * 0.4);
  ctx.lineTo(-s * 0.15 + Math.sin(step) * s * 0.25, 0);
  ctx.moveTo(s * 0.15, -s * 0.4);
  ctx.lineTo(s * 0.15 - Math.sin(step) * s * 0.25, 0);
  ctx.stroke();
  ctx.fillStyle = '#78350f';
  ctx.beginPath();
  ctx.ellipse(0, -s * 0.8, s * 0.6, s * 0.5, 0, 0, TAU);
  ctx.fill();
  const bob = Math.abs(Math.sin(step)) * s * 0.08;
  ctx.fillStyle = '#92400e';
  ctx.beginPath();
  ctx.arc(s * 0.55, -s * 1.35 - bob, s * 0.26, 0, TAU);
  ctx.fill();
  ctx.fillStyle = '#f59e0b';
  ctx.beginPath();
  ctx.moveTo(s * 0.78, -s * 1.38 - bob);
  ctx.lineTo(s * 0.98, -s * 1.3 - bob);
  ctx.lineTo(s * 0.78, -s * 1.25 - bob);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = '#dc2626';
  ctx.beginPath();
  ctx.ellipse(s * 0.74, -s * 1.12 - bob, s * 0.07, s * 0.15, 0, 0, TAU);
  ctx.fill();
  ctx.fillStyle = '#fff';
  ctx.beginPath();
  ctx.arc(s * 0.62, -s * 1.42 - bob, s * 0.06, 0, TAU);
  ctx.fill();
  ctx.restore();
}

function drawLeaf(ctx, p) {
  ctx.save();
  ctx.translate(p.x, p.y);
  ctx.rotate(p.rotation);
  ctx.scale(Math.cos(p.spin), 1);
  ctx.globalAlpha = p.opacity;
  const s = p.size;
  if (p.kind === 'acorn') {
    ctx.fillStyle = '#ca8a04';
    ctx.beginPath();
    ctx.ellipse(0, s * 0.2, s * 0.42, s * 0.55, 0, 0, TAU);
    ctx.fill();
    ctx.fillStyle = '#78350f';
    ctx.beginPath();
    ctx.ellipse(0, -s * 0.2, s * 0.55, s * 0.3, 0, Math.PI, 0);
    ctx.fill();
    ctx.fillRect(-s * 0.06, -s * 0.65, s * 0.12, s * 0.2);
    ctx.restore();
    return;
  }
  ctx.fillStyle = p.color;
  // A five-lobed maple outline.
  ctx.beginPath();
  ctx.moveTo(0, -s);
  ctx.lineTo(s * 0.25, -s * 0.45);
  ctx.lineTo(s * 0.75, -s * 0.6);
  ctx.lineTo(s * 0.55, -s * 0.1);
  ctx.lineTo(s * 0.95, s * 0.1);
  ctx.lineTo(s * 0.35, s * 0.3);
  ctx.lineTo(s * 0.4, s * 0.65);
  ctx.lineTo(0, s * 0.45);
  ctx.lineTo(-s * 0.4, s * 0.65);
  ctx.lineTo(-s * 0.35, s * 0.3);
  ctx.lineTo(-s * 0.95, s * 0.1);
  ctx.lineTo(-s * 0.55, -s * 0.1);
  ctx.lineTo(-s * 0.75, -s * 0.6);
  ctx.lineTo(-s * 0.25, -s * 0.45);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = 'rgba(0, 0, 0, 0.25)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(0, -s * 0.7);
  ctx.lineTo(0, s * 1.05);
  ctx.stroke();
  ctx.restore();
}

function drawConfetti(ctx, p) {
  ctx.save();
  ctx.translate(p.x, p.y);
  ctx.rotate(p.rotation);
  ctx.scale(1, Math.cos(p.spin));
  ctx.globalAlpha = p.opacity;
  ctx.fillStyle = p.color;
  ctx.fillRect(-p.size / 2, -p.size / 4, p.size, p.size / 2);
  ctx.restore();
}

function drawBubble(ctx, p) {
  ctx.save();
  ctx.globalAlpha = p.opacity;
  ctx.strokeStyle = '#fde68a';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.arc(p.x, p.y, p.size, 0, TAU);
  ctx.stroke();
  ctx.fillStyle = 'rgba(255, 255, 255, 0.6)';
  ctx.beginPath();
  ctx.arc(p.x - p.size * 0.35, p.y - p.size * 0.35, p.size * 0.25, 0, TAU);
  ctx.fill();
  ctx.restore();
}

function drawLantern(ctx, p, time) {
  const s = p.size;
  const flicker = 0.85 + 0.15 * Math.sin(time * 0.004 + p.phase);
  ctx.save();
  ctx.translate(p.x, p.y);
  ctx.rotate(Math.sin(time * 0.001 + p.phase) * 0.08);
  ctx.globalAlpha = p.opacity;
  const glow = ctx.createRadialGradient(0, 0, 0, 0, 0, s * 3);
  glow.addColorStop(0, `rgba(255, 170, 60, ${0.35 * flicker})`);
  glow.addColorStop(1, 'rgba(255, 120, 40, 0)');
  ctx.fillStyle = glow;
  ctx.beginPath();
  ctx.arc(0, 0, s * 3, 0, TAU);
  ctx.fill();
  ctx.fillStyle = '#dc2626';
  ctx.beginPath();
  ctx.ellipse(0, 0, s, s * 0.8, 0, 0, TAU);
  ctx.fill();
  ctx.strokeStyle = 'rgba(120, 20, 20, 0.6)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.ellipse(0, 0, s * 0.45, s * 0.8, 0, 0, TAU);
  ctx.stroke();
  ctx.fillStyle = '#fbbf24';
  ctx.fillRect(-s * 0.45, -s * 0.95, s * 0.9, s * 0.22);
  ctx.fillRect(-s * 0.45, s * 0.73, s * 0.9, s * 0.22);
  ctx.strokeStyle = '#fbbf24';
  ctx.beginPath();
  ctx.moveTo(0, s * 0.95);
  ctx.lineTo(0, s * 1.6);
  ctx.stroke();
  ctx.restore();
}

// ---------------------------------------------------------------------------------------------
// Layers
// ---------------------------------------------------------------------------------------------

function baseParticle(width) {
  return {
    x: random(0, width),
    y: 0,
    vx: 0,
    vy: 0,
    size: 4,
    opacity: 0.6,
    sway: random(0, TAU),
    swaySpeed: random(0.01, 0.025),
    swayRange: random(0.2, 0.6),
    rotation: random(0, TAU),
    rotationSpeed: random(-0.01, 0.01),
    spin: random(0, TAU),
    spinSpeed: random(0.01, 0.04),
  };
}

// Falling (or rising) things that sway, spin and wrap around the window.
function driftLayer({ perUnit, min, max, spawn, draw, rising = false }) {
  return {
    init(width, height) {
      const count = countFor(width, height, perUnit, min, max);
      const particles = Array.from({ length: count }, () => {
        const p = spawn(width, height);
        p.y = random(-20, height + 20);
        return p;
      });
      return { particles };
    },
    update(state, width, height, frameScale) {
      for (const p of state.particles) {
        p.sway += p.swaySpeed * frameScale;
        p.x += (p.vx + Math.sin(p.sway) * p.swayRange) * frameScale;
        p.y += p.vy * frameScale;
        p.rotation += p.rotationSpeed * frameScale;
        p.spin += p.spinSpeed * frameScale;
        const margin = p.size * 4;
        const gone = rising ? p.y < -margin : p.y > height + margin;
        if (gone) {
          Object.assign(p, spawn(width, height));
          p.y = rising ? height + margin : -margin;
        }
        if (p.x < -margin) p.x = width + margin;
        if (p.x > width + margin) p.x = -margin;
      }
    },
    draw(ctx, state, frame) {
      for (const p of state.particles) draw(ctx, p, frame);
    },
  };
}

const batLayer = {
  spawn(width, height, anywhere = false) {
    const direction = Math.random() < 0.5 ? 1 : -1;
    const size = random(7, 15);
    const bat = {
      x: anywhere ? random(0, width) : direction > 0 ? -size * 2 : width + size * 2,
      baseY: random(height * 0.05, height * 0.85),
      vx: direction * random(0.5, 1.3),
      wave: random(0, TAU),
      waveSpeed: random(0.015, 0.03),
      amplitude: random(6, 26),
      flap: random(0, TAU),
      flapSpeed: random(0.22, 0.34),
      size,
      opacity: random(0.25, 0.5),
    };
    bat.y = bat.baseY + Math.sin(bat.wave) * bat.amplitude;
    return bat;
  },
  init(width, height) {
    const count = countFor(width, height, 2.4, 5, 14);
    return { particles: Array.from({ length: count }, () => this.spawn(width, height, true)) };
  },
  update(state, width, height, frameScale) {
    state.particles.forEach((p, index) => {
      p.x += p.vx * frameScale;
      p.wave += p.waveSpeed * frameScale;
      p.flap += p.flapSpeed * frameScale;
      p.y = p.baseY + Math.sin(p.wave) * p.amplitude;
      if (p.x < -p.size * 3 || p.x > width + p.size * 3) {
        state.particles[index] = this.spawn(width, height);
      }
    });
  },
  draw(ctx, state, { light }) {
    for (const p of state.particles) drawBat(ctx, p, light);
  },
};

const moonX = (width) => width * 0.82;
const moonY = (height) => height * 0.12;

const moonLayer = {
  init: () => ({}),
  draw(ctx, state, { light, width, height }) {
    const x = moonX(width);
    const y = moonY(height);
    const glowRadius = Math.min(width, height) * 0.38;
    const glow = ctx.createRadialGradient(x, y, 0, x, y, glowRadius);
    const alpha = light ? 0.2 : 0.24;
    glow.addColorStop(0, `rgba(255, 190, 110, ${alpha})`);
    glow.addColorStop(0.35, `rgba(255, 150, 70, ${alpha * 0.4})`);
    glow.addColorStop(1, 'rgba(255, 150, 70, 0)');
    ctx.fillStyle = glow;
    ctx.fillRect(0, 0, width, height);
    const radius = Math.max(16, Math.min(40, Math.min(width, height) * 0.07));
    ctx.fillStyle = light ? 'rgba(251, 191, 36, 0.35)' : 'rgba(255, 228, 180, 0.3)';
    ctx.beginPath();
    ctx.arc(x, y, radius, 0, TAU);
    ctx.fill();
    ctx.fillStyle = 'rgba(120, 80, 40, 0.1)';
    for (const [dx, dy, r] of [
      [-0.3, -0.2, 0.22],
      [0.25, 0.1, 0.16],
      [-0.05, 0.4, 0.12],
    ]) {
      ctx.beginPath();
      ctx.arc(x + dx * radius, y + dy * radius, r * radius, 0, TAU);
      ctx.fill();
    }
  },
};

// Twinkling stars across the upper sky. Only a dark window has a night sky to put them in.
function starsLayer({ perUnit = 5, color = '#ffffff' } = {}) {
  return {
    init(width, height) {
      const count = countFor(width, height, perUnit, 8, 40);
      return {
        particles: Array.from({ length: count }, () => ({
          x: random(0, width),
          y: random(0, height * 0.45),
          size: random(0.5, 1.4),
          phase: random(0, TAU),
          speed: random(0.001, 0.003),
        })),
      };
    },
    draw(ctx, state, { time, light }) {
      if (light) return;
      ctx.fillStyle = color;
      for (const star of state.particles) {
        ctx.globalAlpha = 0.2 + 0.5 * (0.5 + 0.5 * Math.sin(time * star.speed + star.phase));
        ctx.beginPath();
        ctx.arc(star.x, star.y, star.size, 0, TAU);
        ctx.fill();
      }
      ctx.globalAlpha = 1;
    },
  };
}

// Low fog rolling along the bottom of the window.
const fogLayer = {
  init(width, height) {
    return {
      particles: Array.from({ length: 5 }, () => ({
        x: random(0, width),
        y: height - random(0, 30),
        size: random(60, 130),
        vx: random(0.08, 0.22) * (Math.random() < 0.5 ? -1 : 1),
      })),
    };
  },
  update(state, width, height, frameScale) {
    for (const puff of state.particles) {
      puff.x += puff.vx * frameScale;
      if (puff.x < -puff.size) puff.x = width + puff.size;
      if (puff.x > width + puff.size) puff.x = -puff.size;
      puff.y = height - 10;
    }
  },
  draw(ctx, state, { light }) {
    const tint = light ? '120, 100, 160' : '200, 190, 230';
    for (const puff of state.particles) {
      const fog = ctx.createRadialGradient(puff.x, puff.y, 0, puff.x, puff.y, puff.size);
      fog.addColorStop(0, `rgba(${tint}, ${light ? 0.1 : 0.12})`);
      fog.addColorStop(1, `rgba(${tint}, 0)`);
      ctx.fillStyle = fog;
      ctx.fillRect(puff.x - puff.size, puff.y - puff.size, puff.size * 2, puff.size * 2);
    }
  },
};

// Pumpkins sitting along the bottom edge: lit jack-o'-lanterns, or a plain harvest.
function pumpkinRowLayer({ faces }) {
  const spots = [
    [0.06, 17, '#f97316'],
    [0.16, 11, '#fb923c'],
    [0.84, 13, faces ? '#f97316' : '#ca8a04'],
    [0.94, 19, '#ea580c'],
  ];
  return {
    init: () => ({ phases: spots.map(() => random(0, TAU)) }),
    draw(ctx, state, { time, width, height }) {
      const scale = Math.min(1.2, Math.max(0.7, width / 420));
      spots.forEach(([fraction, size, color], index) => {
        const s = size * scale;
        const phase = state.phases[index];
        const flicker =
          0.75 + 0.25 * Math.sin(time * 0.011 + phase) * Math.sin(time * 0.0047 + phase);
        drawPumpkin(ctx, width * fraction, height - s * 0.8, s, {
          face: faces,
          flicker,
          color,
          alpha: 0.85,
        });
      });
    },
  };
}

const ghostLayer = {
  spawn(width, height) {
    return {
      x: random(width * 0.1, width * 0.9),
      y: random(height * 0.25, height * 0.85),
      vx: random(-0.25, 0.25),
      vy: -random(0.1, 0.25),
      size: random(10, 17),
      phase: 0,
      speed: random(0.003, 0.006),
    };
  },
  init(width, height) {
    const particles = Array.from({ length: 3 }, () => this.spawn(width, height));
    particles.forEach((ghost, index) => {
      ghost.phase = (index * Math.PI) / 3;
    });
    return { particles };
  },
  update(state, width, height, frameScale) {
    state.particles.forEach((ghost, index) => {
      ghost.phase += ghost.speed * frameScale;
      ghost.x += ghost.vx * frameScale;
      ghost.y += ghost.vy * frameScale;
      // Each ghost fades in, drifts, fades out and haunts somewhere else.
      if (ghost.phase > Math.PI) state.particles[index] = this.spawn(width, height);
    });
  },
  draw(ctx, state, { time, light }) {
    for (const ghost of state.particles) {
      const alpha = Math.max(0, Math.sin(ghost.phase)) * (light ? 0.7 : 0.4);
      if (alpha > 0.01) drawGhost(ctx, ghost.x, ghost.y, ghost.size, alpha, time, light);
    }
  },
};

/**
 * Something that crosses the window now and then: a witch, Santa's sleigh, a bunny, a turkey.
 * `lane(height)` gives the height it travels at; `draw` gets its progress so far.
 */
function visitorLayer({
  every,
  speed,
  lane,
  size,
  draw,
  flies = false,
  firstAfter = [2500, 6000],
}) {
  return {
    init: () => ({ visitor: null, next: null }),
    update(state, width, height, frameScale, time, env) {
      if (state.next === null) state.next = time + random(...firstAfter);
      if (!state.visitor) {
        if (time < state.next) return;
        const direction = Math.random() < 0.5 ? 1 : -1;
        const s = random(...size);
        const preferredY = lane(height);
        state.visitor = {
          direction,
          size: s,
          x: direction > 0 ? -s * 8 : width + s * 8,
          // Fliers look for a gap between the tiles, where the frost will not blur them.
          y: flies && env ? env.findClearLane(preferredY, s * 3) : preferredY,
          steps: 0,
        };
      }
      const visitor = state.visitor;
      visitor.x += visitor.direction * speed * frameScale;
      visitor.steps += frameScale;
      if (visitor.x < -visitor.size * 10 || visitor.x > width + visitor.size * 10) {
        state.visitor = null;
        state.next = time + random(...every);
      }
    },
    draw(ctx, state, frame) {
      if (state.visitor) draw(ctx, state.visitor, frame);
    },
  };
}

// Rockets that climb from the bottom and burst.
function fireworksLayer({ every, colors, sparks = 36 }) {
  return {
    init: () => ({ rockets: [], bursts: [], next: null }),
    update(state, width, height, frameScale, time) {
      if (state.next === null) state.next = time + random(400, 1400);
      if (time > state.next) {
        state.next = time + random(...every);
        state.rockets.push({
          x: random(width * 0.12, width * 0.88),
          y: height,
          vy: -random(4.5, 6.5),
          targetY: random(height * 0.08, height * 0.4),
          color: pick(colors),
        });
      }
      for (const rocket of state.rockets) {
        rocket.y += rocket.vy * frameScale;
        if (rocket.y <= rocket.targetY) {
          rocket.done = true;
          const burst = { color: rocket.color, life: 1, sparks: [] };
          for (let i = 0; i < sparks; i++) {
            const angle = (i / sparks) * TAU + random(-0.05, 0.05);
            const velocity = random(1.2, 2.6);
            burst.sparks.push({
              x: rocket.x,
              y: rocket.y,
              vx: Math.cos(angle) * velocity,
              vy: Math.sin(angle) * velocity,
            });
          }
          state.bursts.push(burst);
        }
      }
      state.rockets = state.rockets.filter((rocket) => !rocket.done);
      for (const burst of state.bursts) {
        burst.life -= 0.011 * frameScale;
        for (const spark of burst.sparks) {
          spark.vx *= 0.985;
          spark.vy = spark.vy * 0.985 + 0.02 * frameScale;
          spark.x += spark.vx * frameScale;
          spark.y += spark.vy * frameScale;
        }
      }
      state.bursts = state.bursts.filter((burst) => burst.life > 0);
    },
    draw(ctx, state) {
      for (const rocket of state.rockets) {
        ctx.globalAlpha = 0.8;
        ctx.strokeStyle = rocket.color;
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.moveTo(rocket.x, rocket.y);
        ctx.lineTo(rocket.x, rocket.y + 12);
        ctx.stroke();
      }
      for (const burst of state.bursts) {
        ctx.fillStyle = burst.color;
        for (const spark of burst.sparks) {
          ctx.globalAlpha = Math.max(0, burst.life) * 0.25;
          ctx.beginPath();
          ctx.arc(spark.x, spark.y, 3.2, 0, TAU);
          ctx.fill();
          ctx.globalAlpha = Math.max(0, burst.life) * 0.85;
          ctx.beginPath();
          ctx.arc(spark.x, spark.y, 1.5, 0, TAU);
          ctx.fill();
        }
      }
      ctx.globalAlpha = 1;
    },
  };
}

// Snow piled along the bottom of the window.
const snowdriftLayer = {
  init: () => ({}),
  draw(ctx, state, { light, width, height }) {
    ctx.fillStyle = light ? 'rgba(191, 210, 235, 0.55)' : 'rgba(241, 245, 249, 0.22)';
    ctx.beginPath();
    ctx.moveTo(0, height);
    ctx.lineTo(0, height - 14);
    const bumps = Math.max(3, Math.round(width / 120));
    for (let i = 0; i < bumps; i++) {
      const x0 = (i * width) / bumps;
      const x1 = ((i + 1) * width) / bumps;
      const peak = 16 + ((i * 7) % 3) * 6;
      ctx.quadraticCurveTo((x0 + x1) / 2, height - peak - 8, x1, height - 12);
    }
    ctx.lineTo(width, height);
    ctx.closePath();
    ctx.fill();
  },
};

// A faint rainbow arcing across the window, for the pot of gold at its end.
const rainbowLayer = {
  init: () => ({}),
  draw(ctx, state, { light, width, height }) {
    const colors = ['#ef4444', '#f97316', '#facc15', '#22c55e', '#3b82f6', '#8b5cf6'];
    const band = Math.max(4, width * 0.012);
    const radius = Math.max(width, height) * 0.62;
    ctx.globalAlpha = light ? 0.12 : 0.09;
    ctx.lineWidth = band;
    colors.forEach((color, i) => {
      ctx.strokeStyle = color;
      ctx.beginPath();
      ctx.arc(width * 0.5, height * 1.1, radius - i * band, Math.PI * 1.08, Math.PI * 1.92);
      ctx.stroke();
    });
    ctx.globalAlpha = 1;
  },
};

const butterflyLayer = {
  init(width, height) {
    return {
      particles: Array.from({ length: countFor(width, height, 1.2, 2, 5) }, () => ({
        x: random(0, width),
        y: random(height * 0.2, height * 0.9),
        heading: random(0, TAU),
        flap: random(0, TAU),
        size: random(6, 10),
        color: pick(['#f9a8d4', '#fde68a', '#c4b5fd', '#a7f3d0', '#fdba74']),
        accent: pick(['#f472b6', '#facc15', '#a78bfa', '#34d399']),
        opacity: random(0.65, 0.9),
      })),
    };
  },
  update(state, width, height, frameScale) {
    for (const p of state.particles) {
      p.heading += random(-0.12, 0.12) * frameScale;
      p.flap += 0.35 * frameScale;
      p.x += Math.cos(p.heading) * 0.9 * frameScale;
      p.y += Math.sin(p.heading) * 0.6 * frameScale;
      if (p.x < -20) p.x = width + 20;
      if (p.x > width + 20) p.x = -20;
      if (p.y < 10 || p.y > height - 10) p.heading = -p.heading;
    }
  },
  draw(ctx, state) {
    for (const p of state.particles) drawButterfly(ctx, p);
  },
};

// ---------------------------------------------------------------------------------------------
// Falling and rising things
// ---------------------------------------------------------------------------------------------

const snowLayer = driftLayer({
  perUnit: 14,
  min: 20,
  max: 70,
  spawn(width) {
    const p = baseParticle(width);
    p.size = random(1.2, 4.2);
    p.vy = 0.25 + p.size * 0.18;
    p.swayRange = random(0.15, 0.45);
    p.rotationSpeed = random(-0.006, 0.006);
    p.opacity = random(0.35, 0.8);
    return p;
  },
  draw: (ctx, p, { light }) => drawSnowflake(ctx, p, light),
});

const heartLayer = driftLayer({
  perUnit: 3.5,
  min: 6,
  max: 18,
  rising: true,
  spawn(width) {
    const p = baseParticle(width);
    p.kind = Math.random() < 0.25 ? 'sparkle' : 'heart';
    p.size = p.kind === 'sparkle' ? random(2.5, 4.5) : random(5, 11);
    p.vy = -random(0.3, 0.7);
    p.rotationSpeed = 0;
    p.color = pick(['#f472b6', '#ec4899', '#fb7185', '#f43f5e', '#fda4af']);
    p.opacity = random(0.3, 0.6);
    p.twinkleSpeed = random(0.002, 0.005);
    p.phase = random(0, TAU);
    return p;
  },
  draw: (ctx, p, { time }) => {
    if (p.kind === 'sparkle') {
      drawSparkle(ctx, p, time);
      return;
    }
    p.rotation = Math.sin(p.sway) * 0.3;
    drawHeart(ctx, p);
  },
});

const balloonLayer = driftLayer({
  perUnit: 1.2,
  min: 3,
  max: 7,
  rising: true,
  spawn(width) {
    const p = baseParticle(width);
    p.size = random(9, 14);
    p.vy = -random(0.25, 0.45);
    p.swayRange = random(0.1, 0.3);
    p.color = pick(['#f43f5e', '#ec4899', '#e11d48', '#fb7185']);
    p.opacity = random(0.5, 0.75);
    return p;
  },
  draw: (ctx, p) => drawHeartBalloon(ctx, p),
});

const shamrockLayer = driftLayer({
  perUnit: 3.5,
  min: 6,
  max: 18,
  spawn(width) {
    const p = baseParticle(width);
    p.kind = Math.random() < 0.3 ? 'sparkle' : 'shamrock';
    p.size = p.kind === 'sparkle' ? random(2.5, 5) : random(7, 13);
    p.vy = random(0.3, 0.7);
    p.spinSpeed = random(0.008, 0.02);
    p.color =
      p.kind === 'sparkle' ? pick(['#fde047', '#facc15']) : pick(['#22c55e', '#16a34a', '#4ade80']);
    p.opacity = random(0.35, 0.65);
    p.twinkleSpeed = random(0.002, 0.005);
    p.phase = random(0, TAU);
    return p;
  },
  draw: (ctx, p, { time }) =>
    p.kind === 'sparkle' ? drawSparkle(ctx, p, time) : drawShamrock(ctx, p),
});

const coinLayer = driftLayer({
  perUnit: 1.2,
  min: 3,
  max: 8,
  spawn(width) {
    const p = baseParticle(width);
    p.size = random(3.5, 5.5);
    p.vy = random(0.6, 1.1);
    p.swayRange = random(0.05, 0.2);
    p.spinSpeed = random(0.05, 0.1);
    p.opacity = random(0.6, 0.9);
    return p;
  },
  draw: (ctx, p) => drawCoin(ctx, p),
});

const petalLayer = driftLayer({
  perUnit: 6,
  min: 10,
  max: 30,
  spawn(width) {
    const p = baseParticle(width);
    p.size = random(4, 8);
    p.vy = random(0.35, 0.8);
    p.vx = random(0.1, 0.35);
    p.rotationSpeed = random(-0.02, 0.02);
    p.color = pick(['#f9a8d4', '#fbcfe8', '#fde68a', '#c4b5fd', '#a7f3d0']);
    p.opacity = random(0.45, 0.75);
    return p;
  },
  draw: (ctx, p) => drawPetal(ctx, p),
});

const blossomLayer = driftLayer({
  perUnit: 3,
  min: 5,
  max: 14,
  spawn(width) {
    const p = baseParticle(width);
    p.size = random(3, 5.5);
    p.vy = random(0.3, 0.6);
    p.vx = random(-0.15, 0.25);
    p.rotationSpeed = random(-0.02, 0.02);
    p.color = pick(['#fbcfe8', '#f9a8d4', '#fce7f3', '#fda4af']);
    p.opacity = random(0.5, 0.8);
    return p;
  },
  draw: (ctx, p) => drawBlossom(ctx, p),
});

const leafLayer = driftLayer({
  perUnit: 4.5,
  min: 8,
  max: 22,
  spawn(width) {
    const p = baseParticle(width);
    p.kind = Math.random() < 0.2 ? 'acorn' : 'leaf';
    p.size = p.kind === 'acorn' ? random(4, 6) : random(6, 11);
    p.vy = p.kind === 'acorn' ? random(0.8, 1.2) : random(0.45, 0.95);
    p.vx = random(-0.2, 0.3);
    p.swayRange = p.kind === 'acorn' ? 0.1 : random(0.4, 0.9);
    p.rotationSpeed = random(-0.025, 0.025);
    p.color = pick(['#ea580c', '#c2410c', '#dc2626', '#ca8a04', '#b45309']);
    p.opacity = random(0.45, 0.75);
    return p;
  },
  draw: (ctx, p) => drawLeaf(ctx, p),
});

const lanternLayer = driftLayer({
  perUnit: 2,
  min: 4,
  max: 10,
  rising: true,
  spawn(width) {
    const p = baseParticle(width);
    p.size = random(7, 12);
    p.vy = -random(0.2, 0.45);
    p.swayRange = random(0.1, 0.3);
    p.opacity = random(0.55, 0.85);
    p.phase = random(0, TAU);
    return p;
  },
  draw: (ctx, p, { time }) => drawLantern(ctx, p, time),
});

const confettiLayer = driftLayer({
  perUnit: 7,
  min: 12,
  max: 36,
  spawn(width) {
    const p = baseParticle(width);
    p.size = random(4, 7);
    p.vy = random(0.5, 1.1);
    p.spinSpeed = random(0.04, 0.1);
    p.rotationSpeed = random(-0.03, 0.03);
    p.color = pick(['#fbbf24', '#fde68a', '#e5e7eb', '#60a5fa', '#f472b6', '#a78bfa']);
    p.opacity = random(0.5, 0.85);
    return p;
  },
  draw: (ctx, p) => drawConfetti(ctx, p),
});

const bubbleLayer = driftLayer({
  perUnit: 4,
  min: 6,
  max: 20,
  rising: true,
  spawn(width) {
    const p = baseParticle(width);
    p.size = random(1.5, 4);
    p.vy = -random(0.5, 1.2);
    p.swayRange = random(0.1, 0.35);
    p.opacity = random(0.35, 0.65);
    return p;
  },
  draw: (ctx, p) => drawBubble(ctx, p),
});

// ---------------------------------------------------------------------------------------------
// Scenes
// ---------------------------------------------------------------------------------------------

const witchLayer = visitorLayer({
  flies: true,
  every: [14000, 26000],
  speed: 1.7,
  size: [18, 26],
  // Across the moon.
  lane: (height) => moonY(height) + random(-8, 14),
  draw: (ctx, v, { time, light }) =>
    drawWitch(ctx, v.x, v.y + Math.sin(time * 0.003) * 4, v.size, v.direction, time, light),
});

const sleighLayer = visitorLayer({
  flies: true,
  every: [18000, 32000],
  speed: 1.5,
  size: [11, 14],
  lane: (height) => random(height * 0.1, height * 0.25),
  draw: (ctx, v, { time, light, width }) => {
    // A gentle arc across the sky.
    const progress = Math.min(1, Math.max(0, v.x / Math.max(1, width)));
    const lift = Math.sin(progress * Math.PI) * 18;
    drawSleigh(ctx, v.x, v.y - lift, v.size, v.direction, time, light);
  },
});

const bunnyLayer = visitorLayer({
  every: [12000, 24000],
  speed: 1.3,
  size: [8, 11],
  lane: (height) => height - 3,
  draw: (ctx, v, { light }) => {
    const hop = Math.abs(Math.sin(v.steps * 0.09));
    drawBunny(ctx, v.x, v.y - hop * v.size * 1.8, v.size, v.direction, hop, light);
  },
});

const turkeyLayer = visitorLayer({
  every: [14000, 26000],
  speed: 0.8,
  size: [11, 14],
  lane: (height) => height - 2,
  draw: (ctx, v) => drawTurkey(ctx, v.x, v.y, v.size, v.direction, v.steps * 0.18),
});

const SCENES = {
  'new-year': [
    starsLayer({ color: '#fde68a' }),
    fireworksLayer({
      every: [900, 2400],
      colors: ['#fbbf24', '#f472b6', '#60a5fa', '#a78bfa', '#34d399', '#f87171'],
    }),
    bubbleLayer,
    confettiLayer,
  ],
  'lunar-new-year': [
    fireworksLayer({ every: [2500, 5000], colors: ['#ef4444', '#fbbf24', '#f59e0b'], sparks: 30 }),
    lanternLayer,
    blossomLayer,
  ],
  valentines: [balloonLayer, heartLayer],
  'st-patricks': [rainbowLayer, shamrockLayer, coinLayer],
  easter: [petalLayer, butterflyLayer, bunnyLayer],
  halloween: [
    moonLayer,
    starsLayer(),
    ghostLayer,
    witchLayer,
    batLayer,
    pumpkinRowLayer({ faces: true }),
    fogLayer,
  ],
  thanksgiving: [pumpkinRowLayer({ faces: false }), leafLayer, turkeyLayer],
  christmas: [starsLayer(), sleighLayer, snowdriftLayer, snowLayer],
};

export { SCENES };

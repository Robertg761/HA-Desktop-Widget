/**
 * Weather Background Effects Manager
 * Draws subtle, elegant ambient animations on a canvas (rain, snow, clouds, warm sunlight)
 * behind the widget elements, showing through glassmorphic/frosted surfaces.
 */
const TARGET_FRAME_INTERVAL_MS = 1000 / 60;
const BASELINE_FRAME_INTERVAL_MS = 1000 / 60;
// Tolerance so displays refreshing at ~60Hz are not dropped toward ~30fps by
// sub-millisecond requestAnimationFrame jitter, while higher-refresh displays
// (120/144Hz) are still capped near the target rate.
const FRAME_INTERVAL_TOLERANCE_MS = 2;

export class WeatherEffectsManager {
  constructor(canvasId) {
    this.canvas = document.getElementById(canvasId);
    if (!this.canvas) return;
    this.ctx = this.canvas.getContext('2d');
    this.animationFrameId = null;
    this.activeEffect = null; // 'sunny', 'cloudy', 'rainy', 'snowy', 'stormy', or null
    this.particles = [];
    this.clouds = [];
    this.lastTime = 0;
    this.lightningTime = 0;
    this.lightningDuration = 0;
    this.lightningStart = 0;
    this.lightningOpacity = 0;
    this.reducedMotionQuery = null;
    this.reducedMotionChangeHandler = null;

    // Resize handler
    this.resizeCanvas = this.resizeCanvas.bind(this);
    window.addEventListener('resize', this.resizeCanvas);
    this.resizeCanvas();

    this.loop = this.loop.bind(this);
    this.setupReducedMotionListener();
  }

  setupReducedMotionListener() {
    if (typeof window.matchMedia !== 'function') return;
    try {
      this.reducedMotionQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
      this.reducedMotionChangeHandler = () => {
        if (this.prefersReducedMotion()) {
          this.stopAnimation();
          this.renderStaticFrame();
        } else if (this.activeEffect) {
          this.startAnimation();
        }
      };
      if (typeof this.reducedMotionQuery.addEventListener === 'function') {
        this.reducedMotionQuery.addEventListener('change', this.reducedMotionChangeHandler);
      } else if (typeof this.reducedMotionQuery.addListener === 'function') {
        this.reducedMotionQuery.addListener(this.reducedMotionChangeHandler);
      }
    } catch {
      this.reducedMotionQuery = null;
      this.reducedMotionChangeHandler = null;
    }
  }

  prefersReducedMotion() {
    return !!this.reducedMotionQuery?.matches;
  }

  resizeCanvas() {
    if (!this.canvas) return;
    this.canvas.width = window.innerWidth;
    this.canvas.height = window.innerHeight;
    if (this.sun) {
      this.sun.x = this.canvas.width * 0.15;
      this.sun.y = this.canvas.height * 0.15;
    }
    if (this.activeEffect && this.prefersReducedMotion()) {
      this.renderStaticFrame();
    }
  }

  setEffect(effect) {
    if (this.activeEffect === effect) return;
    this.activeEffect = effect;
    this.particles = [];
    this.clouds = [];
    this.lightningTime = 0;
    this.lightningDuration = 0;
    this.lightningOpacity = 0;

    if (effect === 'rainy' || effect === 'stormy') {
      this.initRain();
    } else if (effect === 'snowy') {
      this.initSnow();
    } else if (effect === 'cloudy') {
      this.initClouds();
    } else if (effect === 'sunny') {
      this.initSun();
    }

    if (!effect) {
      this.stopAnimation();
      this.clearCanvas();
      return;
    }

    if (this.prefersReducedMotion()) {
      this.stopAnimation();
      this.renderStaticFrame();
    } else {
      this.startAnimation();
    }
  }

  startAnimation() {
    if (this.animationFrameId || !this.activeEffect) return;
    this.lastTime = performance.now();
    this.animationFrameId = requestAnimationFrame(this.loop);
  }

  stopAnimation() {
    if (!this.animationFrameId) return;
    cancelAnimationFrame(this.animationFrameId);
    this.animationFrameId = null;
  }

  clearCanvas() {
    if (!this.ctx || !this.canvas) return;
    this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
  }

  renderStaticFrame() {
    if (!this.activeEffect || !this.ctx || !this.canvas) return;
    this.clearCanvas();
    if (this.activeEffect === 'rainy' || this.activeEffect === 'stormy') {
      this.drawRainStatic();
    } else if (this.activeEffect === 'snowy') {
      this.drawSnowStatic();
    } else if (this.activeEffect === 'cloudy') {
      this.drawCloudsStatic();
    } else if (this.activeEffect === 'sunny') {
      this.drawSunStatic();
    }
  }

  initRain() {
    if (!this.canvas) return;
    const count = this.activeEffect === 'stormy' ? 180 : 100;
    for (let i = 0; i < count; i++) {
      this.particles.push({
        x: Math.random() * this.canvas.width,
        y: Math.random() * this.canvas.height - this.canvas.height,
        vy: 8 + Math.random() * 6,
        vx: -1.5 - Math.random() * 2.5,
        length: 20 + Math.random() * 20,
        opacity: 0.35 + Math.random() * 0.4,
      });
    }
  }

  initSnow() {
    if (!this.canvas) return;
    const count = 75;
    for (let i = 0; i < count; i++) {
      this.particles.push({
        x: Math.random() * this.canvas.width,
        y: Math.random() * this.canvas.height - this.canvas.height,
        vy: 1.0 + Math.random() * 1.2,
        vx: 0,
        radius: 2.0 + Math.random() * 3.5,
        swingSpeed: 0.015 + Math.random() * 0.02,
        swingRange: 1.5 + Math.random() * 2.0,
        swingAngle: Math.random() * Math.PI * 2,
        opacity: 0.45 + Math.random() * 0.45,
      });
    }
  }

  initClouds() {
    if (!this.canvas) return;
    const count = 7;
    for (let i = 0; i < count; i++) {
      this.clouds.push({
        x: Math.random() * this.canvas.width,
        y: Math.random() * this.canvas.height * 0.6,
        vx: 0.08 + Math.random() * 0.08,
        radius: 180 + Math.random() * 120,
        opacity: 0.12 + Math.random() * 0.12,
      });
    }
  }

  initSun() {
    if (!this.canvas) return;
    this.sun = {
      x: this.canvas.width * 0.15,
      y: this.canvas.height * 0.15,
      pulse: 0,
      pulseDirection: 1,
    };
  }

  loop(timestamp) {
    if (!this.activeEffect || this.prefersReducedMotion()) {
      this.animationFrameId = null;
      return;
    }

    const elapsedMs = timestamp - this.lastTime;
    if (elapsedMs < TARGET_FRAME_INTERVAL_MS - FRAME_INTERVAL_TOLERANCE_MS) {
      this.animationFrameId = requestAnimationFrame(this.loop);
      return;
    }

    const frameScale = Math.min(2, Math.max(0.5, elapsedMs / BASELINE_FRAME_INTERVAL_MS));
    this.lastTime = timestamp;

    if (this.ctx && this.canvas) {
      this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);

      if (this.activeEffect === 'rainy' || this.activeEffect === 'stormy') {
        this.updateAndDrawRain(frameScale);
        if (this.activeEffect === 'stormy') {
          this.updateAndDrawLightning(timestamp);
        }
      } else if (this.activeEffect === 'snowy') {
        this.updateAndDrawSnow(frameScale);
      } else if (this.activeEffect === 'cloudy') {
        this.updateAndDrawClouds(frameScale);
      } else if (this.activeEffect === 'sunny') {
        this.updateAndDrawSun(frameScale);
      }
    }

    this.animationFrameId = requestAnimationFrame(this.loop);
  }

  updateAndDrawRain(frameScale = 1) {
    if (!this.ctx || !this.canvas) return;
    this.ctx.strokeStyle = 'rgba(165, 218, 255, 0.85)';
    this.ctx.lineWidth = 1.5;

    for (const p of this.particles) {
      p.y += p.vy * frameScale;
      p.x += p.vx * frameScale;

      if (p.y > this.canvas.height) {
        p.y = -p.length;
        p.x = Math.random() * this.canvas.width;
      }
      if (p.x < 0) {
        p.x = this.canvas.width;
      }

      this.ctx.beginPath();
      this.ctx.globalAlpha = p.opacity;
      this.ctx.moveTo(p.x, p.y);
      this.ctx.lineTo(p.x + p.vx * 1.5, p.y + p.length);
      this.ctx.stroke();
    }
    this.ctx.globalAlpha = 1.0;
  }

  drawRainStatic() {
    if (!this.ctx || !this.canvas) return;
    this.ctx.strokeStyle = 'rgba(165, 218, 255, 0.45)';
    this.ctx.lineWidth = 1.2;
    const drops = this.particles.slice(0, this.activeEffect === 'stormy' ? 48 : 32);
    for (const p of drops) {
      this.ctx.beginPath();
      this.ctx.globalAlpha = Math.min(p.opacity || 0.4, 0.5);
      this.ctx.moveTo(p.x, p.y);
      this.ctx.lineTo(p.x + (p.vx || -1) * 1.5, p.y + (p.length || 20));
      this.ctx.stroke();
    }
    this.ctx.globalAlpha = 1.0;
  }

  updateAndDrawLightning(timestamp) {
    if (!this.ctx || !this.canvas) return;

    if (!this.lightningTime) {
      this.lightningTime = timestamp + 4000 + Math.random() * 6000;
      this.lightningDuration = 0;
      this.lightningOpacity = 0;
    }

    if (timestamp > this.lightningTime) {
      if (this.lightningDuration === 0) {
        this.lightningDuration = 250 + Math.random() * 300;
        this.lightningStart = timestamp;
      }

      const elapsed = timestamp - this.lightningStart;
      if (elapsed > this.lightningDuration) {
        this.lightningTime = timestamp + 4000 + Math.random() * 6000;
        this.lightningDuration = 0;
        this.lightningOpacity = 0;
      } else {
        const progress = elapsed / this.lightningDuration;
        // Double-flash storm effect
        if (progress < 0.08) {
          this.lightningOpacity = (progress / 0.08) * 0.45;
        } else if (progress < 0.16) {
          this.lightningOpacity = 0.45 - ((progress - 0.08) / 0.08) * 0.35;
        } else if (progress < 0.28) {
          this.lightningOpacity = 0.1 + ((progress - 0.16) / 0.12) * 0.45;
        } else if (progress < 0.45) {
          this.lightningOpacity = 0.55 - ((progress - 0.28) / 0.17) * 0.4;
        } else {
          this.lightningOpacity = 0.15 - ((progress - 0.45) / 0.55) * 0.15;
        }
      }
    }

    if (this.lightningOpacity > 0) {
      this.ctx.fillStyle = `rgba(235, 245, 255, ${this.lightningOpacity})`;
      this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
    }
  }

  updateAndDrawSnow(frameScale = 1) {
    if (!this.ctx || !this.canvas) return;
    this.ctx.fillStyle = '#ffffff';

    for (const p of this.particles) {
      p.y += p.vy * frameScale;
      p.swingAngle += p.swingSpeed * frameScale;
      p.x += (Math.sin(p.swingAngle) * p.swingRange * 0.2 + 0.3) * frameScale;

      if (p.y > this.canvas.height) {
        p.y = -p.radius * 2;
        p.x = Math.random() * this.canvas.width;
      }

      this.ctx.beginPath();
      this.ctx.globalAlpha = p.opacity;
      this.ctx.arc(p.x, p.y, p.radius, 0, Math.PI * 2);
      this.ctx.fill();
    }
    this.ctx.globalAlpha = 1.0;
  }

  drawSnowStatic() {
    if (!this.ctx || !this.canvas) return;
    this.ctx.fillStyle = '#ffffff';
    for (const p of this.particles.slice(0, 36)) {
      this.ctx.beginPath();
      this.ctx.globalAlpha = Math.min(p.opacity || 0.45, 0.65);
      this.ctx.arc(p.x, p.y, p.radius || 2, 0, Math.PI * 2);
      this.ctx.fill();
    }
    this.ctx.globalAlpha = 1.0;
  }

  updateAndDrawClouds(frameScale = 1) {
    if (!this.ctx || !this.canvas) return;
    for (const c of this.clouds) {
      c.x += c.vx * frameScale;
      if (c.x - c.radius > this.canvas.width) {
        c.x = -c.radius;
      }

      const gradient = this.ctx.createRadialGradient(c.x, c.y, 0, c.x, c.y, c.radius);
      gradient.addColorStop(0, `rgba(200, 210, 225, ${c.opacity})`);
      gradient.addColorStop(0.5, `rgba(200, 210, 225, ${c.opacity * 0.4})`);
      gradient.addColorStop(1, 'rgba(200, 210, 225, 0)');

      this.ctx.fillStyle = gradient;
      this.ctx.beginPath();
      this.ctx.arc(c.x, c.y, c.radius, 0, Math.PI * 2);
      this.ctx.fill();
    }
  }

  drawCloudsStatic() {
    this.updateAndDrawClouds();
  }

  updateAndDrawSun(frameScale = 1) {
    if (!this.ctx || !this.canvas || !this.sun) return;

    this.sun.pulse += 0.008 * this.sun.pulseDirection * frameScale;
    if (this.sun.pulse > 1) {
      this.sun.pulse = 1;
      this.sun.pulseDirection = -1;
    } else if (this.sun.pulse < 0) {
      this.sun.pulse = 0;
      this.sun.pulseDirection = 1;
    }

    const radius = 300 + this.sun.pulse * 60;
    const gradient = this.ctx.createRadialGradient(
      this.sun.x,
      this.sun.y,
      0,
      this.sun.x,
      this.sun.y,
      radius
    );
    gradient.addColorStop(0, 'rgba(255, 225, 150, 0.25)');
    gradient.addColorStop(0.5, 'rgba(255, 200, 110, 0.08)');
    gradient.addColorStop(1, 'rgba(255, 200, 110, 0)');

    this.ctx.fillStyle = gradient;
    this.ctx.beginPath();
    this.ctx.arc(this.sun.x, this.sun.y, radius, 0, Math.PI * 2);
    this.ctx.fill();
  }

  drawSunStatic() {
    if (!this.ctx || !this.canvas || !this.sun) return;
    const radius = 320;
    const gradient = this.ctx.createRadialGradient(
      this.sun.x,
      this.sun.y,
      0,
      this.sun.x,
      this.sun.y,
      radius
    );
    gradient.addColorStop(0, 'rgba(255, 225, 150, 0.2)');
    gradient.addColorStop(0.5, 'rgba(255, 200, 110, 0.07)');
    gradient.addColorStop(1, 'rgba(255, 200, 110, 0)');

    this.ctx.fillStyle = gradient;
    this.ctx.beginPath();
    this.ctx.arc(this.sun.x, this.sun.y, radius, 0, Math.PI * 2);
    this.ctx.fill();
  }

  destroy() {
    window.removeEventListener('resize', this.resizeCanvas);
    this.stopAnimation();
    if (this.reducedMotionQuery && this.reducedMotionChangeHandler) {
      if (typeof this.reducedMotionQuery.removeEventListener === 'function') {
        this.reducedMotionQuery.removeEventListener('change', this.reducedMotionChangeHandler);
      } else if (typeof this.reducedMotionQuery.removeListener === 'function') {
        this.reducedMotionQuery.removeListener(this.reducedMotionChangeHandler);
      }
    }
  }
}

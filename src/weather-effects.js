/**
 * Weather Background Effects Manager
 * Draws subtle, elegant ambient animations on a canvas (rain, snow, clouds, warm sunlight)
 * behind the widget elements, showing through glassmorphic/frosted surfaces.
 */
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

    // Resize handler
    this.resizeCanvas = this.resizeCanvas.bind(this);
    window.addEventListener('resize', this.resizeCanvas);
    this.resizeCanvas();

    this.loop = this.loop.bind(this);
  }

  resizeCanvas() {
    if (!this.canvas) return;
    this.canvas.width = window.innerWidth;
    this.canvas.height = window.innerHeight;
    if (this.sun) {
      this.sun.x = this.canvas.width * 0.15;
      this.sun.y = this.canvas.height * 0.15;
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

    if (effect && !this.animationFrameId) {
      this.lastTime = performance.now();
      this.animationFrameId = requestAnimationFrame(this.loop);
    } else if (!effect && this.animationFrameId) {
      cancelAnimationFrame(this.animationFrameId);
      this.animationFrameId = null;
      if (this.ctx && this.canvas) {
        this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
      }
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
        opacity: 0.35 + Math.random() * 0.4
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
        opacity: 0.45 + Math.random() * 0.45
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
        opacity: 0.12 + Math.random() * 0.12
      });
    }
  }

  initSun() {
    if (!this.canvas) return;
    this.sun = {
      x: this.canvas.width * 0.15,
      y: this.canvas.height * 0.15,
      pulse: 0,
      pulseDirection: 1
    };
  }

  loop(timestamp) {
    if (!this.activeEffect) return;

    this.lastTime = timestamp;

    if (this.ctx && this.canvas) {
      this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);

      if (this.activeEffect === 'rainy' || this.activeEffect === 'stormy') {
        this.updateAndDrawRain();
        if (this.activeEffect === 'stormy') {
          this.updateAndDrawLightning(timestamp);
        }
      } else if (this.activeEffect === 'snowy') {
        this.updateAndDrawSnow();
      } else if (this.activeEffect === 'cloudy') {
        this.updateAndDrawClouds();
      } else if (this.activeEffect === 'sunny') {
        this.updateAndDrawSun();
      }
    }

    this.animationFrameId = requestAnimationFrame(this.loop);
  }

  updateAndDrawRain() {
    if (!this.ctx || !this.canvas) return;
    this.ctx.strokeStyle = 'rgba(165, 218, 255, 0.85)';
    this.ctx.lineWidth = 1.5;

    for (const p of this.particles) {
      p.y += p.vy;
      p.x += p.vx;

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
          this.lightningOpacity = 0.10 + ((progress - 0.16) / 0.12) * 0.45;
        } else if (progress < 0.45) {
          this.lightningOpacity = 0.55 - ((progress - 0.28) / 0.17) * 0.40;
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

  updateAndDrawSnow() {
    if (!this.ctx || !this.canvas) return;
    this.ctx.fillStyle = '#ffffff';

    for (const p of this.particles) {
      p.y += p.vy;
      p.swingAngle += p.swingSpeed;
      p.x += Math.sin(p.swingAngle) * p.swingRange * 0.2 + 0.3;

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

  updateAndDrawClouds() {
    if (!this.ctx || !this.canvas) return;
    for (const c of this.clouds) {
      c.x += c.vx;
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

  updateAndDrawSun() {
    if (!this.ctx || !this.canvas || !this.sun) return;

    this.sun.pulse += 0.008 * this.sun.pulseDirection;
    if (this.sun.pulse > 1) {
      this.sun.pulse = 1;
      this.sun.pulseDirection = -1;
    } else if (this.sun.pulse < 0) {
      this.sun.pulse = 0;
      this.sun.pulseDirection = 1;
    }

    const radius = 300 + this.sun.pulse * 60;
    const gradient = this.ctx.createRadialGradient(this.sun.x, this.sun.y, 0, this.sun.x, this.sun.y, radius);
    gradient.addColorStop(0, 'rgba(255, 225, 150, 0.25)');
    gradient.addColorStop(0.5, 'rgba(255, 200, 110, 0.08)');
    gradient.addColorStop(1, 'rgba(255, 200, 110, 0)');

    this.ctx.fillStyle = gradient;
    this.ctx.beginPath();
    this.ctx.arc(this.sun.x, this.sun.y, radius, 0, Math.PI * 2);
    this.ctx.fill();
  }

  destroy() {
    window.removeEventListener('resize', this.resizeCanvas);
    if (this.animationFrameId) {
      cancelAnimationFrame(this.animationFrameId);
    }
  }
}

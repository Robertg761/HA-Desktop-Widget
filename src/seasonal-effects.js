/**
 * Seasonal themes: marks the running holiday on <body> (the stylesheet hangs cobwebs, pumpkins,
 * snow caps and the like off `data-season`), swaps in the holiday colours, and draws the
 * holiday's background scene from seasonal-scenes.js on its own canvas.
 */
import { setSeasonalColors } from './ui-utils.js';
import { reapplyDesktopAppearance } from './desktop-appearance.js';
import { normalizeSeasonalSettings, resolveSeasonalHoliday } from './seasonal-calendar.js';
import { SCENES } from './seasonal-scenes.js';

// Seasonal themes are on by default for weeks at a time, so they draw at 30fps: drifting snow
// and bats look the same, for half the work. Speeds are tuned per 60fps frame.
const TARGET_FRAME_INTERVAL_MS = 1000 / 30;
const BASELINE_FRAME_INTERVAL_MS = 1000 / 60;
const FRAME_INTERVAL_TOLERANCE_MS = 2;
// Holidays start and end at midnight; checking this often keeps a widget left open overnight
// current without a timer that suspend could throw off.
const RECHECK_INTERVAL_MS = 10 * 60 * 1000;

// Tiles, cards and the header frost the scene behind them, so it reads as depth rather than
// clutter. The frost is drawn into this canvas instead of using CSS backdrop-filter, which Linux
// performance mode turns off and which would cost a blur per tile: the whole scene is blurred
// once at quarter resolution and that copy stands in for the sharp one under each surface. The
// state panel (errors, an empty page) frosts as well: its copy is on the screen where reading
// matters most, and its own fill is only a faint tint.
const FROSTED_SELECTOR =
  '.widget-header, .status-card, .media-tile, .control-item, .widget-state-panel';
const FROST_SCALE = 0.25;
// At quarter resolution; upscaling softens it further, to roughly a 12px blur.
const FROST_BLUR_PX = 3;
// How much of the scene still shows through a tile.
const FROST_ALPHA = 0.5;
// Tiles move without telling anyone (a tab switch, a new tile), so their outlines are re-read
// this often, and after clicks, key presses and resizes. Scrolling only shifts them, which is
// tracked from the scroll events rather than by re-measuring every frame.
const FROST_REFRESH_MS = 500;
// The scroller the tiles and cards move in.
const SCROLLER_SELECTOR = '.widget-content';

export class SeasonalEffectsManager {
  constructor(canvasId) {
    this.canvas = document.getElementById(canvasId);
    this.ctx = this.canvas?.getContext?.('2d') || null;
    this.ui = {};
    this.holidayId = null;
    this.layers = [];
    this.states = [];
    this.animationFrameId = null;
    this.lastTime = 0;
    this.width = 0;
    this.height = 0;
    this.pixelRatio = 1;
    this.reducedMotionQuery = null;
    this.reducedMotionChangeHandler = null;
    this.forcedColorsQuery = null;
    this.forcedColorsChangeHandler = null;
    this.frostCanvas = null;
    this.frostCtx = null;
    this.frostRects = [];
    this.frostRectsReadAt = -Infinity;
    // Corner radii come from the stylesheet and do not change while an element lives.
    this.frostRadii = new WeakMap();
    // Each scroller's scrollTop, as of its last scroll event.
    this.scrollTops = new WeakMap();
    this.pixelRatioQuery = null;
    this.stillFrameTimer = null;
    this.env = { findClearLane: (preferredY, band) => this.findClearLane(preferredY, band) };

    this.loop = this.loop.bind(this);
    this.handleLayoutChange = this.handleLayoutChange.bind(this);
    this.handleScroll = this.handleScroll.bind(this);
    this.handlePixelRatioChange = this.handlePixelRatioChange.bind(this);
    this.resizeCanvas = this.resizeCanvas.bind(this);
    this.refresh = this.refresh.bind(this);
    this.handleVisibilityChange = this.handleVisibilityChange.bind(this);
    window.addEventListener('resize', this.resizeCanvas);
    document.addEventListener('visibilitychange', this.handleVisibilityChange);
    for (const type of ['click', 'keyup']) {
      document.addEventListener(type, this.handleLayoutChange, { capture: true, passive: true });
    }
    document.addEventListener('scroll', this.handleScroll, { capture: true, passive: true });
    this.resizeCanvas();
    this.setupMediaListeners();
    this.watchPixelRatio();
    this.watchThemeChanges();
    this.recheckTimer = setInterval(this.refresh, RECHECK_INTERVAL_MS);
  }

  setupMediaListeners() {
    if (typeof window.matchMedia !== 'function') return;
    try {
      this.reducedMotionQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
      // Reduced motion also decides whether seasonal themes are on by default.
      this.reducedMotionChangeHandler = () => this.refresh({ restartScene: true });
      this.reducedMotionQuery.addEventListener?.('change', this.reducedMotionChangeHandler);
    } catch {
      this.reducedMotionQuery = null;
      this.reducedMotionChangeHandler = null;
    }
    try {
      // Forced colours hide the canvas (see styles.css), so drawing it would only cost frames.
      this.forcedColorsQuery = window.matchMedia('(forced-colors: active)');
      this.forcedColorsChangeHandler = () => {
        if (this.isForcedColors()) {
          this.stopAnimation();
          this.clearCanvas();
        } else if (this.prefersReducedMotion()) {
          this.renderFrame(performance.now());
        } else {
          this.startAnimation();
        }
      };
      this.forcedColorsQuery.addEventListener?.('change', this.forcedColorsChangeHandler);
    } catch {
      this.forcedColorsQuery = null;
      this.forcedColorsChangeHandler = null;
    }
  }

  /**
   * Moving the window to a screen with another scale factor changes devicePixelRatio without a
   * resize event, so watch the ratio itself. The query matches one ratio, so it is renewed on
   * each change.
   */
  watchPixelRatio() {
    this.pixelRatioQuery?.removeEventListener?.('change', this.handlePixelRatioChange);
    this.pixelRatioQuery = null;
    if (typeof window.matchMedia !== 'function') return;
    try {
      this.pixelRatioQuery = window.matchMedia(`(resolution: ${window.devicePixelRatio || 1}dppx)`);
      this.pixelRatioQuery.addEventListener?.('change', this.handlePixelRatioChange);
    } catch {
      this.pixelRatioQuery = null;
    }
  }

  handlePixelRatioChange() {
    this.resizeCanvas();
    this.watchPixelRatio();
  }

  /**
   * An animating scene picks up light or dark mode on its next frame, but a still one (reduced
   * motion) would keep the other mode's colours. Theme changes come from Settings, a config echo
   * and the system theme, so the body's class is the one place they all meet.
   */
  watchThemeChanges() {
    const body = document.body;
    if (!body || typeof MutationObserver !== 'function') return;
    this.lightTheme = body.classList.contains('theme-light');
    this.themeObserver = new MutationObserver(() => {
      const light = body.classList.contains('theme-light');
      if (light === this.lightTheme) return;
      this.lightTheme = light;
      if (!this.animationFrameId && this.layers.length) this.renderFrame(performance.now());
    });
    this.themeObserver.observe(body, { attributes: true, attributeFilter: ['class'] });
  }

  isForcedColors() {
    return !!this.forcedColorsQuery?.matches;
  }

  prefersReducedMotion() {
    return !!this.reducedMotionQuery?.matches;
  }

  /**
   * Follow a `ui` config (saved or a Settings preview).
   * @param {object} ui
   */
  apply(ui = {}) {
    this.ui = ui || {};
    this.refresh();
  }

  refresh({ restartScene = false } = {}) {
    const holiday = resolveSeasonalHoliday(this.ui, {
      date: new Date(),
      reducedMotion: this.prefersReducedMotion(),
    });
    const settings = normalizeSeasonalSettings(this.ui.seasonal);
    const id = holiday?.id || null;
    const body = document.body;
    if (body) {
      if (id) body.dataset.season = id;
      else delete body.dataset.season;
    }
    // The Omarchy palette paints its own colours, so it has to hear about the swap.
    if (setSeasonalColors(holiday && settings.colors ? holiday.colors : null)) {
      reapplyDesktopAppearance();
    }
    if (restartScene || id !== this.holidayId) this.setScene(id);
  }

  getActiveHolidayId() {
    return this.holidayId;
  }

  getParticleCount() {
    return this.states.reduce((total, state) => total + (state?.particles?.length || 0), 0);
  }

  setScene(id) {
    this.holidayId = id;
    this.stopAnimation();
    this.layers = (id && SCENES[id]) || [];
    this.states = [];
    this.sizeBackingStore();
    if (!this.layers.length || !this.canvas || !this.ctx) {
      // No holiday: give the backing stores back rather than hold them for months.
      this.frostCanvas = null;
      this.frostCtx = null;
      return;
    }
    this.states = this.layers.map((layer) => layer.init(this.width, this.height));
    if (this.prefersReducedMotion()) {
      this.renderFrame(performance.now());
    } else {
      this.startAnimation();
    }
  }

  resizeCanvas() {
    if (!this.canvas) return;
    const width = window.innerWidth;
    const height = window.innerHeight;
    // Draw at device resolution so the art stays crisp on HiDPI screens; past 2x costs more
    // than it shows.
    const pixelRatio = Math.min(2, Math.max(1, window.devicePixelRatio || 1));
    if (width === this.width && height === this.height && pixelRatio === this.pixelRatio) return;
    const scaleX = this.width ? width / this.width : 1;
    const scaleY = this.height ? height / this.height : 1;
    this.width = width;
    this.height = height;
    this.pixelRatio = pixelRatio;
    this.sizeBackingStore();
    for (const state of this.states) {
      for (const p of state?.particles || []) {
        p.x *= scaleX;
        if (p.baseY !== undefined) p.baseY *= scaleY;
        else p.y *= scaleY;
      }
    }
    this.frostRectsReadAt = -Infinity;
    if (this.layers.length && this.prefersReducedMotion()) this.renderFrame(performance.now());
  }

  /**
   * Draw at device resolution while a scene runs, so the art stays crisp on HiDPI screens (past
   * 2x costs more than it shows), and hold no pixels at all when there is nothing to draw.
   */
  sizeBackingStore() {
    if (!this.canvas) return;
    const active = this.layers.length > 0;
    const width = active ? Math.round(this.width * this.pixelRatio) : 0;
    const height = active ? Math.round(this.height * this.pixelRatio) : 0;
    if (this.canvas.width !== width) this.canvas.width = width;
    if (this.canvas.height !== height) this.canvas.height = height;
    // Resizing a canvas resets its transform.
    if (active) this.ctx?.setTransform(this.pixelRatio, 0, 0, this.pixelRatio, 0, 0);
  }

  /**
   * Something may have moved the tiles. An animating scene picks that up on its next frame; a
   * still one is redrawn once the page has settled.
   */
  handleLayoutChange() {
    this.frostRectsReadAt = -Infinity;
    this.scheduleStillFrame();
  }

  // Scrolling moves the tiles by the scroll distance; note it without re-measuring anything.
  handleScroll(event) {
    const target = event?.target;
    if (target && typeof target.scrollTop === 'number') {
      this.scrollTops.set(target, target.scrollTop);
    }
    this.scheduleStillFrame();
  }

  scheduleStillFrame() {
    if (this.animationFrameId || !this.layers.length) return;
    clearTimeout(this.stillFrameTimer);
    this.stillFrameTimer = setTimeout(() => this.renderFrame(performance.now()), 150);
  }

  /**
   * The outlines of the frosted surfaces, in window coordinates. Measured at most every
   * FROST_REFRESH_MS; in between, surfaces inside the scroller follow its scroll position.
   */
  readFrostRects(time) {
    if (time - this.frostRectsReadAt >= FROST_REFRESH_MS) {
      this.frostRectsReadAt = time;
      this.frostRects = [];
      for (const element of document.querySelectorAll(FROSTED_SELECTOR)) {
        const rect = element.getBoundingClientRect();
        if (rect.width < 1 || rect.height < 1) continue;
        let radius = this.frostRadii.get(element);
        if (radius === undefined) {
          radius = parseFloat(window.getComputedStyle(element).borderTopLeftRadius) || 0;
          this.frostRadii.set(element, radius);
        }
        const scroller = element.closest(SCROLLER_SELECTOR);
        const scrollTop = scroller ? scroller.scrollTop : 0;
        if (scroller) this.scrollTops.set(scroller, scrollTop);
        this.frostRects.push({
          x: rect.left,
          y: rect.top,
          width: rect.width,
          height: rect.height,
          radius,
          scroller,
          scrollTop,
        });
      }
    }
    return this.frostRects
      .map((rect) => {
        if (!rect.scroller) return rect;
        const shift = rect.scrollTop - (this.scrollTops.get(rect.scroller) ?? rect.scrollTop);
        return shift ? { ...rect, y: rect.y + shift } : rect;
      })
      .filter((rect) => rect.y + rect.height > 0 && rect.y < this.height);
  }

  /**
   * The height nearest `preferredY` where a band `band` tall crosses the window without passing
   * behind a tile, so a witch or a sleigh stays sharp; `preferredY` when there is none.
   */
  findClearLane(preferredY, band) {
    const rects = this.readFrostRects(performance.now());
    const half = band / 2;
    let best = null;
    for (let y = half; y <= this.height - half; y += 4) {
      const blocked = rects.some(
        (rect) => rect.y - 2 < y + half && rect.y + rect.height + 2 > y - half
      );
      if (!blocked && (best === null || Math.abs(y - preferredY) < Math.abs(best - preferredY))) {
        best = y;
      }
    }
    return best ?? preferredY;
  }

  ensureFrostCanvas(width, height) {
    if (!this.frostCanvas) {
      this.frostCanvas = document.createElement('canvas');
      this.frostCtx = this.frostCanvas.getContext?.('2d') || null;
    }
    if (this.frostCanvas.width !== width) this.frostCanvas.width = width;
    if (this.frostCanvas.height !== height) this.frostCanvas.height = height;
    return this.frostCtx;
  }

  frostUnderSurfaces(time) {
    const rects = this.readFrostRects(time);
    if (!rects.length) return;
    const frostWidth = Math.max(1, Math.round(this.width * FROST_SCALE));
    const frostHeight = Math.max(1, Math.round(this.height * FROST_SCALE));
    const frost = this.ensureFrostCanvas(frostWidth, frostHeight);
    if (!frost) return;
    frost.clearRect(0, 0, frostWidth, frostHeight);
    frost.filter = `blur(${FROST_BLUR_PX}px)`;
    frost.drawImage(this.canvas, 0, 0, frostWidth, frostHeight);
    frost.filter = 'none';

    const ctx = this.ctx;
    ctx.save();
    ctx.beginPath();
    for (const rect of rects) {
      if (typeof ctx.roundRect === 'function') {
        ctx.roundRect(rect.x, rect.y, rect.width, rect.height, rect.radius);
      } else {
        ctx.rect(rect.x, rect.y, rect.width, rect.height);
      }
    }
    ctx.clip();
    ctx.clearRect(0, 0, this.width, this.height);
    ctx.globalAlpha = FROST_ALPHA;
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(this.frostCanvas, 0, 0, this.width, this.height);
    ctx.restore();
  }

  // Nothing to draw for a hidden window (tray, another workspace).
  handleVisibilityChange() {
    if (document.hidden) this.stopAnimation();
    else if (!this.prefersReducedMotion()) this.startAnimation();
  }

  startAnimation() {
    if (this.animationFrameId || !this.layers.length || document.hidden || this.isForcedColors()) {
      return;
    }
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
    this.ctx.clearRect(0, 0, this.width, this.height);
  }

  renderFrame(time) {
    if (!this.ctx || !this.canvas || !this.layers.length || this.isForcedColors()) return;
    const frame = {
      time,
      light: !!document.body?.classList.contains('theme-light'),
      width: this.width,
      height: this.height,
    };
    this.ctx.clearRect(0, 0, this.width, this.height);
    this.layers.forEach((layer, index) => {
      this.ctx.save();
      layer.draw(this.ctx, this.states[index], frame);
      this.ctx.restore();
    });
    this.frostUnderSurfaces(time);
  }

  loop(timestamp) {
    if (!this.layers.length || this.prefersReducedMotion()) {
      this.animationFrameId = null;
      return;
    }
    const elapsedMs = timestamp - this.lastTime;
    if (elapsedMs < TARGET_FRAME_INTERVAL_MS - FRAME_INTERVAL_TOLERANCE_MS) {
      this.animationFrameId = requestAnimationFrame(this.loop);
      return;
    }
    const frameScale = Math.min(3, Math.max(0.5, elapsedMs / BASELINE_FRAME_INTERVAL_MS));
    this.lastTime = timestamp;
    this.layers.forEach((layer, index) => {
      layer.update?.(this.states[index], this.width, this.height, frameScale, timestamp, this.env);
    });
    this.renderFrame(timestamp);
    this.animationFrameId = requestAnimationFrame(this.loop);
  }

  destroy() {
    window.removeEventListener('resize', this.resizeCanvas);
    document.removeEventListener('visibilitychange', this.handleVisibilityChange);
    for (const type of ['click', 'keyup']) {
      document.removeEventListener(type, this.handleLayoutChange, { capture: true });
    }
    document.removeEventListener('scroll', this.handleScroll, { capture: true });
    this.pixelRatioQuery?.removeEventListener?.('change', this.handlePixelRatioChange);
    clearInterval(this.recheckTimer);
    clearTimeout(this.stillFrameTimer);
    this.stopAnimation();
    this.reducedMotionQuery?.removeEventListener?.('change', this.reducedMotionChangeHandler);
    this.forcedColorsQuery?.removeEventListener?.('change', this.forcedColorsChangeHandler);
    this.themeObserver?.disconnect();
  }
}

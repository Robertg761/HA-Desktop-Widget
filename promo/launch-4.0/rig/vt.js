// Virtual time for frame-accurate capture. Installed into a running page; once enabled, the page's
// clocks (performance.now, Date), requestAnimationFrame, timers and every CSS/Web animation only
// advance when step(ms) is called. Real timers already pending keep running in real time.
(() => {
  if (window.__vt) return;
  const R = {
    raf: window.requestAnimationFrame.bind(window),
    caf: window.cancelAnimationFrame.bind(window),
    now: performance.now.bind(performance),
    st: window.setTimeout.bind(window),
    ct: window.clearTimeout.bind(window),
    si: window.setInterval.bind(window),
    ci: window.clearInterval.bind(window),
    Date: window.Date,
  };
  const RealDate = R.Date;
  let enabled = false;
  let vnow = 0;
  let basePerf = 0;
  let baseDate = 0;
  const rafQ = new Map();
  let rafSeq = 5e8;
  const timers = new Map();
  let timerSeq = 5e8;
  const tracked = new WeakMap();

  const vDateNow = () => baseDate + (vnow - basePerf);

  class VDate extends RealDate {
    constructor(...args) {
      if (args.length === 0) super(enabled ? vDateNow() : RealDate.now());
      else super(...args);
    }
    static now() {
      return enabled ? vDateNow() : RealDate.now();
    }
  }

  function syncAnimations() {
    for (const a of document.getAnimations()) {
      let rec = tracked.get(a);
      if (!rec) {
        if (a.playState === 'finished' || a.playState === 'idle') continue;
        if (a.playState === 'paused') {
          // Paused by the app itself before we saw it: leave it.
          tracked.set(a, { own: true });
          continue;
        }
        rec = { start: vnow - (a.currentTime || 0) / (a.playbackRate || 1) };
        tracked.set(a, rec);
      }
      if (rec.own || rec.done) continue;
      if (a.playState === 'idle') {
        rec.done = true;
        continue;
      }
      const t = (vnow - rec.start) * (a.playbackRate || 1);
      let end = Infinity;
      try {
        end = a.effect ? a.effect.getComputedTiming().endTime : Infinity;
      } catch {
        /* ignore */
      }
      if (Number.isFinite(end) && t >= end) {
        rec.done = true;
        try {
          a.finish();
        } catch {
          a.currentTime = end;
        }
      } else {
        if (a.playState === 'running') a.pause();
        a.currentTime = Math.max(0, t);
      }
    }
  }

  function runTimers(target) {
    for (let guard = 0; guard < 10000; guard += 1) {
      let next = null;
      for (const [id, t] of timers) {
        if (t.due <= target && (!next || t.due < next[1].due || (t.due === next[1].due && t.seq < next[1].seq)))
          next = [id, t];
      }
      if (!next) return;
      const [id, t] = next;
      vnow = Math.max(vnow, t.due);
      if (t.interval != null) {
        t.due += Math.max(1, t.interval);
        t.seq = ++timerSeq;
      } else {
        timers.delete(id);
      }
      try {
        if (typeof t.fn === 'function') t.fn(...t.args);
        else (0, eval)(String(t.fn));
      } catch (error) {
        console.error('[vt] timer error', error);
      }
    }
  }

  const api = {
    enable(dateMs) {
      if (enabled) return;
      basePerf = R.now();
      vnow = basePerf;
      baseDate = typeof dateMs === 'number' ? dateMs : RealDate.now();
      enabled = true;
      window.Date = VDate;
      performance.now = () => vnow;
      window.requestAnimationFrame = (cb) => {
        const id = ++rafSeq;
        rafQ.set(id, cb);
        return id;
      };
      window.cancelAnimationFrame = (id) => {
        if (!rafQ.delete(id)) R.caf(id);
      };
      window.setTimeout = (fn, ms = 0, ...args) => {
        const id = ++timerSeq;
        timers.set(id, { due: vnow + Math.max(0, Number(ms) || 0), fn, args, seq: id });
        return id;
      };
      window.setInterval = (fn, ms = 0, ...args) => {
        const id = ++timerSeq;
        const interval = Math.max(1, Number(ms) || 0);
        timers.set(id, { due: vnow + interval, fn, args, interval, seq: id });
        return id;
      };
      window.clearTimeout = (id) => {
        if (!timers.delete(id)) R.ct(id);
      };
      window.clearInterval = (id) => {
        if (!timers.delete(id)) R.ci(id);
      };
      syncAnimations();
    },
    get enabled() {
      return enabled;
    },
    now: () => vnow,
    // Advance virtual time; returns after timers, animations and one rAF tick have run.
    step(ms) {
      if (!enabled) return;
      const target = vnow + ms;
      runTimers(target);
      vnow = target;
      syncAnimations();
      const cbs = [...rafQ.values()];
      rafQ.clear();
      for (const cb of cbs) {
        try {
          cb(vnow);
        } catch (error) {
          console.error('[vt] raf error', error);
        }
      }
      // Animations started by rAF callbacks get pinned to this frame too.
      syncAnimations();
    },
    // Advance without capturing, in frame-sized steps so rAF loops see every tick.
    advance(ms, frameMs = 1000 / 60) {
      let left = ms;
      while (left > 1e-6) {
        const d = Math.min(frameMs, left);
        api.step(d);
        left -= d;
      }
    },
    pendingTimers: () => timers.size,
    // Deterministic Math.random (mulberry32), so a take can be reproduced.
    seed(n) {
      let a = n >>> 0;
      Math.random = () => {
        a = (a + 0x6d2b79f5) >>> 0;
        let t = a;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
      };
    },
  };
  window.__vt = api;
})();

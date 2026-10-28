"""A small synthesis toolkit for the 4.0 spot: oscillators, envelopes, drums, instruments, FX."""
import numpy as np
import pedalboard as pb

SR = 48000
RNG = np.random.default_rng(4)


def midi_hz(m):
    return 440.0 * 2 ** ((np.asarray(m, dtype=float) - 69) / 12)


def n(sec):
    return int(round(sec * SR))


def tvec(dur):
    return np.arange(n(dur)) / SR


# ---------------------------------------------------------------- oscillators
def _polyblep(phase, dt):
    y = np.zeros_like(phase)
    m1 = phase < dt
    x = phase[m1] / dt[m1] if np.ndim(dt) else phase[m1] / dt
    y[m1] = x + x - x * x - 1
    m2 = phase > 1 - (dt if not np.ndim(dt) else dt)
    x = (phase[m2] - 1) / (dt[m2] if np.ndim(dt) else dt)
    y[m2] = x * x + x + x + 1
    return y


def saw(freq, dur, phase0=None):
    """Band-limited saw; freq may be a scalar or a per-sample array."""
    N = n(dur)
    f = np.broadcast_to(np.asarray(freq, dtype=float), (N,)) if np.ndim(freq) else np.full(N, float(freq))
    dt = f / SR
    p0 = RNG.random() if phase0 is None else phase0
    phase = (p0 + np.cumsum(dt)) % 1.0
    return 2 * phase - 1 - _polyblep(phase, dt)


def square(freq, dur, pw=0.5):
    N = n(dur)
    f = np.broadcast_to(np.asarray(freq, dtype=float), (N,)) if np.ndim(freq) else np.full(N, float(freq))
    dt = f / SR
    phase = (RNG.random() + np.cumsum(dt)) % 1.0
    y = np.where(phase < pw, 1.0, -1.0)
    y += _polyblep(phase, dt)
    y -= _polyblep((phase - pw) % 1.0, dt)
    return y


def sine(freq, dur, phase0=0.0):
    N = n(dur)
    f = np.broadcast_to(np.asarray(freq, dtype=float), (N,)) if np.ndim(freq) else np.full(N, float(freq))
    ph = phase0 + 2 * np.pi * np.cumsum(f) / SR
    return np.sin(ph)


def supersaw(freq, dur, voices=7, detune=0.18, spread=1.0):
    """Stereo supersaw: returns (2, N)."""
    N = n(dur)
    out = np.zeros((2, N))
    offs = np.linspace(-1, 1, voices)
    for i, o in enumerate(offs):
        cents = o * detune * 100 * (0.6 + 0.4 * abs(o))
        f = freq * 2 ** (cents / 1200)
        s = saw(f, dur)
        pan = 0.5 + 0.5 * o * spread
        amp = 1.0 if i == voices // 2 else 0.75
        out[0] += s * amp * np.cos(pan * np.pi / 2)
        out[1] += s * amp * np.sin(pan * np.pi / 2)
    return out / (voices * 0.55)


def noise(dur):
    return RNG.standard_normal(n(dur))


# ---------------------------------------------------------------- envelopes
def adsr(dur, a=0.005, d=0.1, s=0.7, r=0.2, total=None):
    """Envelope for a note held `dur` seconds, with release after; length total or dur+r."""
    total = dur + r if total is None else total
    N = n(total)
    t = np.arange(N) / SR
    env = np.zeros(N)
    a = max(a, 1e-4)
    att = t < a
    env[att] = t[att] / a
    dec = (t >= a) & (t < a + d)
    env[dec] = 1 - (1 - s) * (t[dec] - a) / max(d, 1e-4)
    sus = (t >= a + d) & (t < dur)
    env[sus] = s
    # level at release start
    if dur < a:
        lvl = dur / a
    elif dur < a + d:
        lvl = 1 - (1 - s) * (dur - a) / max(d, 1e-4)
    else:
        lvl = s
    rel = t >= dur
    env[rel] = lvl * np.exp(-(t[rel] - dur) / max(r / 4.5, 1e-4))
    return env


def expdecay(dur, tau, a=0.002):
    t = tvec(dur)
    env = np.exp(-t / tau)
    att = t < a
    env[att] *= t[att] / a
    return env


def fade_tail(x, ms=8):
    k = min(n(ms / 1000), x.shape[-1])
    if k > 0:
        x[..., -k:] *= np.linspace(1, 0, k)
    return x


# ---------------------------------------------------------------- filters / fx
def stereo(x):
    x = np.asarray(x, dtype=np.float32)
    return np.vstack([x, x]) if x.ndim == 1 else x


def fx(x, *plugins):
    board = pb.Pedalboard(list(plugins))
    return board(stereo(x).astype(np.float32), SR)


def ladder_sweep(x, cutoffs, resonance=0.2, mode=pb.LadderFilter.Mode.LPF24, drive=1.0, block=256):
    """Ladder filter whose cutoff follows `cutoffs` (per-sample array or callable of time)."""
    x = stereo(x).astype(np.float32)
    N = x.shape[1]
    f = pb.LadderFilter(mode=mode, cutoff_hz=1000, resonance=resonance, drive=drive)
    out = np.zeros_like(x)
    for i in range(0, N, block):
        j = min(N, i + block)
        c = cutoffs(i / SR) if callable(cutoffs) else cutoffs[min(i, len(cutoffs) - 1)]
        f.cutoff_hz = float(np.clip(c, 20, 20000))
        out[:, i:j] = f(x[:, i:j], SR, reset=False)
    return out


def sosfilt(x, kind, freq, order=4):
    from scipy.signal import butter, sosfilt as _s

    sos = butter(order, freq, btype=kind, fs=SR, output='sos')
    return _s(sos, x, axis=-1)


def pan(x, p):
    """p in [-1, 1]."""
    x = np.asarray(x)
    if x.ndim == 2:
        x = x.mean(axis=0)
    a = (p + 1) / 2 * np.pi / 2
    return np.vstack([x * np.cos(a), x * np.sin(a)]) * 1.41


def softclip(x, drive=1.0):
    return np.tanh(x * drive) / np.tanh(drive)


# ---------------------------------------------------------------- timeline
class Track:
    def __init__(self, dur):
        self.buf = np.zeros((2, n(dur)), dtype=np.float64)

    def add(self, at, x, gain=1.0):
        x = stereo(x)
        i = n(at)
        if i >= self.buf.shape[1]:
            return
        if i < 0:
            x = x[:, -i:]
            i = 0
        j = min(self.buf.shape[1], i + x.shape[1])
        self.buf[:, i:j] += x[:, : j - i] * gain


# ---------------------------------------------------------------- drums
def kick(tone=1.0):
    dur = 0.55
    t = tvec(dur)
    f = 44 + 120 * np.exp(-t / 0.028) + 40 * np.exp(-t / 0.004)
    body = sine(f, dur) * np.exp(-t / 0.32)
    body = softclip(body * 1.6, 1.4)
    click = sosfilt(noise(0.006), 'highpass', 1800) * np.linspace(1, 0, n(0.006)) * 0.35
    out = body
    out[: len(click)] += click * tone
    return fade_tail(out * 0.95)


def clap():
    dur = 0.45
    N = n(dur)
    t = tvec(dur)
    nz = sosfilt(noise(dur), 'bandpass', [900, 6500], 2)
    env = np.zeros(N)
    for k, off in enumerate([0.0, 0.011, 0.022, 0.031]):
        i = n(off)
        seg = t[i:] - off
        env[i:] += np.exp(-seg / (0.009 if k < 3 else 0.13)) * (0.8 if k < 3 else 1.0)
    out = nz * env * 0.55
    return fade_tail(out)


def snare(vel=1.0):
    dur = 0.3
    t = tvec(dur)
    tone = sine(185 + 60 * np.exp(-t / 0.01), dur) * np.exp(-t / 0.05) * 0.5
    nz = sosfilt(noise(dur), 'bandpass', [1500, 9000], 2) * np.exp(-t / 0.09) * 0.7
    return fade_tail((tone + nz) * vel)


def hat(open_=False, vel=1.0):
    dur = 0.35 if open_ else 0.08
    t = tvec(dur)
    # metallic: a few square partials plus noise, high-passed
    metal = sum(square(f, dur) for f in [3150, 4410, 5630, 6870, 8120, 9290]) / 6
    nz = noise(dur)
    x = sosfilt(metal * 0.6 + nz * 0.6, 'highpass', 7000, 4)
    env = np.exp(-t / (0.12 if open_ else 0.022))
    return fade_tail(x * env * 0.52 * vel)


def crash(dur=3.2):
    t = tvec(dur)
    metal = sum(square(f, dur) for f in [3470, 4810, 5930, 7230, 8450, 10010, 11800]) / 7
    x = sosfilt(metal * 0.5 + noise(dur) * 0.8, 'highpass', 4500, 2)
    env = np.exp(-t / 0.9) * (1 - np.exp(-t / 0.003))
    st = np.vstack([x, sosfilt(np.roll(x, 97), 'highpass', 4500, 2)])
    return fade_tail(st * env * 0.33, 60)


def tom(freq=110, vel=1.0):
    dur = 0.4
    t = tvec(dur)
    f = freq * (1 + 0.6 * np.exp(-t / 0.03))
    return fade_tail(sine(f, dur) * np.exp(-t / 0.16) * vel * 0.8)


def jingle(vel=1.0):
    """A sleigh-bell shake: a cluster of tiny high bells."""
    dur = 0.25
    out = np.zeros(n(dur))
    t = tvec(dur)
    for _ in range(6):
        off = RNG.uniform(0, 0.03)
        f = RNG.uniform(5200, 9800)
        i = n(off)
        seg = t[: len(out) - i]
        out[i:] += np.sin(2 * np.pi * f * seg) * np.exp(-seg / 0.045) * np.sin(2 * np.pi * f * 1.51 * seg)
    out = sosfilt(out + noise(dur) * 0.05 * np.exp(-t / 0.03), 'highpass', 4000, 2)
    return fade_tail(out * 0.22 * vel)


# ---------------------------------------------------------------- instruments
def pad_chord(notes, dur, cutoff=2400, attack=0.35, release=0.9, detune=0.16, voices=7):
    total = dur + release
    acc = np.zeros((2, n(total)))
    for m in notes:
        acc += supersaw(midi_hz(m), total, voices=voices, detune=detune)
    acc /= max(1, len(notes)) ** 0.7
    env = adsr(dur, a=attack, d=0.4, s=0.85, r=release, total=total)
    filt = ladder_sweep(acc * env, (lambda s: cutoff(s)) if callable(cutoff) else np.full(1, cutoff), resonance=0.12)
    return fade_tail(filt, 40)


def pluck(m, dur=0.22, bright=1.0, cutoff_peak=5200, decay=0.16):
    total = dur + 0.25
    f = midi_hz(m)
    x = saw(f, total) * 0.6 + square(f * 1.002, total, 0.35) * 0.4
    env = adsr(dur, a=0.002, d=decay, s=0.0, r=0.12, total=total)
    peak = cutoff_peak * bright
    y = ladder_sweep(x, lambda s: 300 + peak * np.exp(-s / 0.07), resonance=0.25, block=64)
    return fade_tail(y * env, 10)


def bass_note(m, dur, cutoff=420, sub=0.9):
    total = dur + 0.06
    f = midi_hz(m)
    x = saw(f, total) * 0.7 + saw(f * 1.004, total) * 0.3
    t = tvec(total)
    y = ladder_sweep(x, lambda s: cutoff + 900 * np.exp(-s / 0.05), resonance=0.18, block=64)
    s = sine(f / 2 if m > 40 else f, total) * sub
    env = adsr(dur, a=0.004, d=0.08, s=0.8, r=0.05, total=total)
    out = (y.mean(axis=0) * 0.6 + s) * env
    return fade_tail(softclip(out * 1.2, 1.2), 6)


def lead_note(m, dur, cutoff=6800):
    total = dur + 0.4
    ss = supersaw(midi_hz(m), total, voices=5, detune=0.12, spread=0.7)
    oct_ = supersaw(midi_hz(m + 12), total, voices=3, detune=0.08, spread=0.5) * 0.35
    x = ss + oct_
    env = adsr(dur, a=0.01, d=0.25, s=0.75, r=0.35, total=total)
    y = ladder_sweep(x * env, np.full(1, cutoff), resonance=0.15)
    return fade_tail(y, 20)


def bell(m, dur=1.6, index=2.2, ratio=3.5, vel=1.0):
    """FM bell / glockenspiel."""
    t = tvec(dur)
    f = midi_hz(m)
    mod_env = index * np.exp(-t / 0.18)
    mod = np.sin(2 * np.pi * f * ratio * t) * mod_env
    car = np.sin(2 * np.pi * f * t + mod)
    car2 = np.sin(2 * np.pi * f * 2.0 * t) * 0.18 * np.exp(-t / 0.25)
    env = np.exp(-t / (dur / 3.2)) * (1 - np.exp(-t / 0.0015))
    return fade_tail((car + car2) * env * 0.5 * vel, 20)


def glow(m, dur=1.4):
    """Soft, warm 'light on' tone: sine + a touch of FM, slow-ish attack."""
    t = tvec(dur)
    f = midi_hz(m)
    car = np.sin(2 * np.pi * f * t + 0.8 * np.exp(-t / 0.3) * np.sin(2 * np.pi * f * 2 * t))
    env = (1 - np.exp(-t / 0.012)) * np.exp(-t / 0.45)
    return fade_tail(car * env * 0.5, 30)


# ---------------------------------------------------------------- FX
def riser(dur, f0=300, f1=9000, pitch=True):
    N = n(dur)
    t = tvec(dur)
    prog = t / dur
    nz = noise(dur)
    out = np.zeros(N)
    blk = 512
    from scipy.signal import butter, sosfilt as _s, sosfilt_zi

    zi = None
    for i in range(0, N, blk):
        j = min(N, i + blk)
        fc = f0 * (f1 / f0) ** (prog[i] ** 1.6)
        sos = butter(2, [fc * 0.7, min(fc * 1.4, SR / 2 - 100)], btype='bandpass', fs=SR, output='sos')
        if zi is None:
            zi = sosfilt_zi(sos) * 0
        y, zi = _s(sos, nz[i:j], zi=zi)
        out[i:j] = y
    out *= prog ** 1.8
    st = np.vstack([out, np.roll(out, 211)]) * 0.9
    if pitch:
        f = 110 * 2 ** (prog * 2.0)
        s = supersaw(f, dur, voices=5, detune=0.25) * (prog ** 2.2)[None] * 0.25
        s = ladder_sweep(s, lambda sec: 400 + 6000 * (sec / dur) ** 2, resonance=0.3)
        st = st + s
    return st


def impact(dur=3.5):
    t = tvec(dur)
    sub = sine(58 * np.exp(-t / 0.9) + 26, dur) * np.exp(-t / 0.75) * 1.1
    boom = sosfilt(noise(dur), 'lowpass', 900, 2) * np.exp(-t / 0.18) * 0.7
    crack = sosfilt(noise(0.05), 'highpass', 2000, 2) * np.exp(-tvec(0.05) / 0.012) * 0.5
    x = sub + boom
    x[: len(crack)] += crack
    return fade_tail(softclip(x, 1.3), 80)


def whoosh(dur=0.7, f0=400, f1=5000, direction=1):
    N = n(dur)
    t = tvec(dur)
    prog = t / dur
    nz = noise(dur)
    from scipy.signal import butter, sosfilt as _s, sosfilt_zi

    out = np.zeros(N)
    blk = 256
    zi = None
    for i in range(0, N, blk):
        j = min(N, i + blk)
        shape = np.sin(np.pi * prog[i])
        fc = f0 + (f1 - f0) * shape
        sos = butter(2, [fc * 0.6, min(fc * 1.6, SR / 2 - 100)], btype='bandpass', fs=SR, output='sos')
        if zi is None:
            zi = sosfilt_zi(sos) * 0
        y, zi = _s(sos, nz[i:j], zi=zi)
        out[i:j] = y
    env = np.sin(np.pi * prog) ** 2
    out *= env
    p = np.clip((prog * 2 - 1) * direction, -1, 1)
    a = (p + 1) / 2 * np.pi / 2
    return np.vstack([out * np.cos(a), out * np.sin(a)]) * 1.2


def reverse_crash(dur=1.6):
    c = crash(dur + 0.2)[:, : n(dur)]
    return c[:, ::-1] * np.linspace(0.2, 1, n(dur)) ** 2


def click(freq=3200, vel=1.0):
    dur = 0.03
    t = tvec(dur)
    x = np.sin(2 * np.pi * freq * t) * np.exp(-t / 0.004) * 0.6
    x += sosfilt(noise(dur), 'highpass', 3000, 2) * np.exp(-t / 0.002) * 0.3
    return fade_tail(x * vel, 3)


def keyclack(vel=1.0, big=False):
    dur = 0.09 if big else 0.06
    t = tvec(dur)
    hi = sosfilt(noise(dur), 'bandpass', [1800, 6000], 2) * np.exp(-t / (0.006 if not big else 0.009))
    thump = np.sin(2 * np.pi * (140 if big else 190) * t) * np.exp(-t / 0.018) * (0.7 if big else 0.4)
    bottom = np.zeros_like(t)
    k = n(0.022)
    bottom[k:] = sosfilt(noise(dur), 'bandpass', [900, 3500], 2)[k:] * np.exp(-(t[k:] - t[k]) / 0.004) * 0.35
    return fade_tail((hi * 0.5 + thump + bottom) * vel * (1.3 if big else 1.0), 4)


def pop(vel=1.0):
    dur = 0.12
    t = tvec(dur)
    f = 300 + 700 * np.exp(-t / 0.018)
    x = sine(f, dur) * np.exp(-t / 0.04)
    return fade_tail(x * 0.6 * vel, 4)


def sparkle(base=86, count=6, spread=0.35):
    out = np.zeros((2, n(spread + 1.2)))
    for k in range(count):
        m = base + [0, 3, 7, 10, 12, 15, 19, 22][k % 8]
        b = bell(m, 0.9, index=1.2, ratio=3.5, vel=0.5 * (1 - k / (count * 1.5)))
        i = n(k * spread / count)
        p = RNG.uniform(-0.7, 0.7)
        st = pan(b, p)
        out[:, i : i + st.shape[1]] += st[:, : out.shape[1] - i]
    return out

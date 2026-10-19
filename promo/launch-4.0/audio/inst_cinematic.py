"""Hybrid-orchestral instruments for the 'cinematic' option (on top of engine.py / instruments.py).

Ensemble strings (legato, tremolo), spiccato and pizzicato sections, horn / trombone sections whose
tone opens with the dynamic, an 'aah' choir through vowel formants, celesta, taiko ensembles, toms,
timpani, suspended cymbal (crash and mallet swell), sleigh bells, an orchestral boom, a hybrid synth
pulse and a synthetic concert-hall impulse response for convolution reverb.
All return (2, N) float arrays at engine.SR unless noted.
"""
import numpy as np
import pedalboard as pb
from scipy.signal import butter, oaconvolve, sosfilt

from engine import SR, fade_tail, ladder_sweep, midi_hz, n, saw, sine, softclip, tvec
from instruments import _karplus

R = np.random.default_rng(1977)


# ---------------------------------------------------------------- helpers
def _sos(kind, f, order=2):
    if kind == 'bandpass':
        f = [max(20.0, f[0]), min(f[1], SR * 0.45)]
    else:
        f = min(max(f, 20.0), SR * 0.45)
    return butter(order, f, btype=kind, fs=SR, output='sos')


def lp(x, f, o=2):
    return sosfilt(_sos('lowpass', f, o), x, axis=-1)


def hp(x, f, o=2):
    return sosfilt(_sos('highpass', f, o), x, axis=-1)


def bp(x, lo, hi, o=2):
    return sosfilt(_sos('bandpass', [lo, hi], o), x, axis=-1)


def rnoise(N):
    return R.standard_normal(N)


def place(x, p=0.0, width=1.0):
    """Pan a mono/stereo signal to p in [-1, 1] keeping (scaled) stereo width."""
    x = np.asarray(x, dtype=float)
    if x.ndim == 1:
        x = np.vstack([x, x])
    m = (x[0] + x[1]) * 0.5
    s = (x[0] - x[1]) * 0.5 * width
    a = (p + 1) * np.pi / 4
    return np.vstack([(m + s) * np.cos(a), (m - s) * np.sin(a)]) * np.sqrt(2)


def _pp(p, players, spread=0.8):
    return -spread + 2 * spread * p / max(1, players - 1)


def _addpan(out, x, p):
    a = (p + 1) * np.pi / 4
    out[0] += x * np.cos(a)
    out[1] += x * np.sin(a)


def _vib(t, rate, depth, delay):
    ramp = np.clip(t / max(delay, 1e-3), 0, 1) ** 2
    return 1 + depth * ramp * np.sin(2 * np.pi * rate * t + R.random() * 6.283)


def _wander(N, amt, every=0.3):
    k = max(3, int(N / (SR * every)) + 3)
    return 1 + np.interp(np.arange(N), np.linspace(0, N, k), R.standard_normal(k) * amt)


def _env(dur, total, attack, release, cresc=None):
    """Raised-cosine attack, optional crescendo (start level `cresc`), exponential release."""
    t = tvec(total)
    a = np.clip(t / max(attack, 1e-4), 0, 1)
    env = 0.5 - 0.5 * np.cos(np.pi * a)
    if cresc is not None:
        env = env * (cresc + (1 - cresc) * np.clip(t / max(dur, 1e-3), 0, 1) ** 1.7)
    k = min(n(dur), len(t))
    if k < len(t):
        lvl = env[k - 1] if k > 0 else 0.0
        env[k:] = lvl * np.exp(-(t[k:] - dur) / max(release / 4.0, 1e-3))
    return env


# ---------------------------------------------------------------- bowed strings
def bowed(m, dur, vel=0.7, attack=0.25, release=0.6, players=5, bright=0.5, trem=0.0, cresc=None,
          detune=6.0, spread=0.8, vib=1.0):
    """A string-section note: several players (detuned saws, independent vibrato and pitch drift),
    louder = brighter, faint bow noise. trem>0 = unmeasured tremolo."""
    total = dur + release
    t = tvec(total)
    N = len(t)
    f = midi_hz(m)
    out = np.zeros((2, N))
    for p in range(players):
        fr = (f * 2 ** (R.uniform(-detune, detune) / 1200) * _vib(t, R.uniform(4.7, 6.0), R.uniform(0.0018, 0.0032) * vib, 0.55)
              * _wander(N, 0.0006))
        x = saw(fr, total) * R.uniform(0.8, 1.0)
        if trem > 0:
            rate = R.uniform(11.0, 15.0)
            x = x * (1 - trem * 0.5 * (1 + np.sin(2 * np.pi * rate * t + R.random() * 6.283)))
        _addpan(out, x, _pp(p, players, spread))
    fc = 900 + 5200 * bright * (0.35 + 0.65 * vel)
    out = lp(out, fc, 2)
    out = lp(out, fc * 2.6, 1)
    bow = bp(rnoise(N), 3000, 12000) * 0.10 * (0.5 + trem)
    out += np.vstack([bow, np.roll(bow, 113)])
    env = _env(dur, total, attack, release, cresc)
    return fade_tail(out * env[None] * vel * 0.32 / players ** 0.5, 30)


_SPC = {}


def spic(m, vel=0.8, bright=0.6):
    """A short spiccato stroke from a 4-player section (cached by pitch / brightness)."""
    key = (int(m), round(bright * 4) / 4, int(R.integers(3)))
    if key not in _SPC:
        total = 0.42
        t = tvec(total)
        N = len(t)
        f = midi_hz(m)
        out = np.zeros((2, N))
        for p in range(4):
            off = n(abs(R.normal(0, 0.0035)))
            fr = f * 2 ** (R.uniform(-6, 6) / 1200) * (1 - 0.005 * np.exp(-t / 0.02))
            x = saw(fr, total)
            env = (1 - np.exp(-t / 0.005)) * (0.72 * np.exp(-t / 0.05) + 0.28 * np.exp(-t / 0.15))
            y = np.zeros(N)
            y[off:] = (x * env)[: N - off]
            _addpan(out, y, _pp(p, 4, 0.6))
        b = key[1]
        out = lp(out, 1100 + 5000 * b, 2)
        out = hp(out, 90, 2)
        sc = bp(rnoise(n(0.03)), 2000, 10000) * np.exp(-tvec(0.03) / 0.006) * 0.4  # bow / rosin scratch
        out[:, : len(sc)] += sc[None]
        _SPC[key] = fade_tail(out * 0.28, 20)
    return _SPC[key] * vel


def _ks_hz(f):
    """instruments._karplus now plays in tune; kept so the call sites read the same."""
    return f


def pizz(m, vel=0.8, players=3):
    """Pizzicato section: plucked KS strings with a little body."""
    f = midi_hz(m)
    total = min(1.4, 0.45 + 0.6 * (196 / f) ** 0.5)
    N = n(total)
    out = np.zeros((2, N))
    for p in range(players):
        off = n(abs(R.normal(0, 0.006)))
        y = _karplus(_ks_hz(f * 2 ** (R.uniform(-5, 5) / 1200)), total, bright=0.3 + 0.3 * vel, decay=0.994)
        y = y * np.exp(-tvec(total) / (0.25 + 0.3 * (196 / f) ** 0.5))
        z = np.zeros(N)
        z[off:] = y[: N - off]
        _addpan(out, z, _pp(p, players, 0.5))
    out = bp(out, 70, 4200, 2)
    out = pb.Pedalboard([pb.PeakFilter(cutoff_frequency_hz=240, gain_db=3, q=1.0)])(out.astype(np.float32), SR)
    return fade_tail(out * vel * 0.55 / players ** 0.5, 10)


# ---------------------------------------------------------------- brass
def brass_sec(notes, dur, vel=0.7, attack=0.07, release=0.35, players=3, cresc=None, kind='horn'):
    """Horns ('horn': mellow) or trombones ('tbn': brighter, a touch of blat). The filter opens
    with the envelope and the velocity, as real brass gets brighter when louder."""
    total = dur + release
    t = tvec(total)
    N = len(t)
    env = _env(dur, total, attack, release, cresc)
    acc = np.zeros((2, N))
    for m in notes:
        f = midi_hz(m)
        for p in range(players):
            fr = (f * 2 ** (R.uniform(-5, 5) / 1200) * (1 - 0.012 * np.exp(-t / 0.035))
                  * _vib(t, R.uniform(4.6, 5.4), 0.0022, 0.7) * _wander(N, 0.0005))
            x = saw(fr, total)
            _addpan(acc, x, _pp(p, players, 0.5))
    acc /= (len(notes) * players) ** 0.6
    lvl = np.clip(env, 0, 1) ** 1.3
    if kind == 'horn':
        cut = 220 + (500 + 1700 * vel) * lvl
    else:
        cut = 260 + (800 + 2800 * vel) * lvl
        acc = acc * (1 + 0.3 * vel * np.exp(-t / 0.06))[None]
    y = ladder_sweep(acc * env[None], cut, resonance=0.12, mode=pb.LadderFilter.Mode.LPF12, block=128)
    y = softclip(np.asarray(y, dtype=float) * 1.3, 1.1)
    return fade_tail(y * vel * 0.5, 20)


# ---------------------------------------------------------------- choir
FORMANTS = {
    'a': [(760, 1.0, 160), (1150, 0.55, 180), (2550, 0.25, 200), (2900, 0.35, 300), (3350, 0.1, 260)],
    'o': [(520, 1.0, 90), (860, 0.5, 110), (2600, 0.1, 200), (3300, 0.05, 260)],
}


def choir_aah(notes, dur, vel=0.6, attack=0.5, release=1.2, voices=5, vowel='a', cresc=None, air=0.04):
    total = dur + release
    t = tvec(total)
    N = len(t)
    src = np.zeros((2, N))
    for m in notes:
        f = midi_hz(m)
        for v in range(voices):
            fr = (f * 2 ** (R.uniform(-9, 9) / 1200) * _vib(t, R.uniform(4.8, 5.8), R.uniform(0.0035, 0.006), 0.8)
                  * _wander(N, 0.001))
            _addpan(src, saw(fr, total), R.uniform(-0.85, 0.85))
    src = lp(src, 3500, 1)
    br = rnoise(N) * 0.15
    src += np.vstack([br, np.roll(br, 271)])
    out = np.zeros_like(src)
    for fc, g, bw in FORMANTS[vowel]:
        out += bp(src, fc - bw, fc + bw, 2) * g
    a_ = bp(rnoise(N), 4500, 11000) * air  # breath / sibilant air above the formants
    out += np.vstack([a_, np.roll(a_, 97)])
    env = _env(dur, total, attack, release, cresc)
    return fade_tail(out * env[None] * vel * 1.6 / (len(notes) * voices) ** 0.5, 30)


# ---------------------------------------------------------------- tuned percussion
def celesta(m, vel=0.7, dur=2.0):
    t = tvec(dur)
    f = midi_hz(m)
    x = (np.sin(2 * np.pi * f * t) * np.exp(-t / 0.9)
         + 0.32 * np.sin(2 * np.pi * 2 * f * t) * np.exp(-t / 0.3)
         + 0.1 * np.sin(2 * np.pi * 3.01 * f * t) * np.exp(-t / 0.12)
         + 0.05 * np.sin(2 * np.pi * 4.18 * f * t) * np.exp(-t / 0.05))
    click = bp(rnoise(len(t)), 2500, 9000) * np.exp(-t / 0.003) * 0.06
    y = (x + click) * (1 - np.exp(-t / 0.0007)) * vel * 0.4
    return fade_tail(y, 20)


def tubular(m, vel=0.8, dur=4.0):
    """Tubular bell: inharmonic partials with a strike tone an octave below the 2nd partial."""
    t = tvec(dur)
    f = midi_hz(m) / 2
    parts = [(2.0, 1.0, 1.6), (3.0, 0.6, 1.2), (4.16, 0.5, 0.9), (5.43, 0.3, 0.6), (6.79, 0.18, 0.45), (8.21, 0.1, 0.3)]
    x = sum(g * np.sin(2 * np.pi * f * r * t + R.random() * 6.28) * np.exp(-t / d) for r, g, d in parts)
    x = x * (1 - np.exp(-t / 0.001)) * vel * 0.18
    return fade_tail(x, 30)


def sleigh(vel=1.0, dur=0.3):
    """A shake of a sleigh-bell strap: many tiny bells, smeared over ~30 ms."""
    N = n(dur)
    t = tvec(dur)
    out = np.zeros((2, N))
    for _ in range(16):
        off = n(abs(R.normal(0.012, 0.01)))
        f = R.uniform(4200, 9500)
        seg = t[: N - off]
        b = np.sin(2 * np.pi * f * seg) * np.sin(2 * np.pi * f * 1.47 * seg + 1.0) * np.exp(-seg / R.uniform(0.03, 0.07))
        z = np.zeros(N)
        z[off:] = b
        _addpan(out, z, R.uniform(-0.5, 0.5))
    rattle = hp(rnoise(N), 5000) * np.exp(-t / 0.025) * 0.15
    out += np.vstack([rattle, np.roll(rattle, 41)])
    out = hp(out, 3500, 2)
    return fade_tail(out * vel * 0.12, 8)


# ---------------------------------------------------------------- drums
def _drum(f, vel, decay=0.5, dur=1.6, slap=0.3, bend=0.45):
    t = tvec(dur)
    pe = 1 + bend * np.exp(-t / 0.03)
    x = (sine(f * pe, dur) * np.exp(-t / decay)
         + 0.35 * sine(f * 1.58 * pe, dur) * np.exp(-t / (decay * 0.35))
         + 0.15 * sine(f * 2.31 * pe, dur) * np.exp(-t / (decay * 0.2)))
    skin = lp(rnoise(len(t)), 1200) * np.exp(-t / 0.06) * 0.45
    stick = bp(rnoise(len(t)), 400, 3500) * np.exp(-t / 0.008) * slap * (0.5 + 0.5 * vel)
    return softclip((x + skin + stick) * vel * 1.1, 1.2)


def taiko_ens(f=55, vel=1.0, size=3, dur=1.8):
    out = np.zeros((2, n(dur)))
    for k in range(size):
        off = 0 if k == 0 else n(abs(R.normal(0, 0.007)))
        d = _drum(f * (1.0, 0.988, 1.012, 0.995)[k % 4], vel * R.uniform(0.85, 1.0), decay=0.32, slap=0.9, dur=dur)
        st = place(d, R.uniform(-0.45, 0.45))
        out[:, off:] += st[:, : out.shape[1] - off]
    return fade_tail(out / size ** 0.6, 40)


def tom(f=120, vel=0.8):
    return fade_tail(place(_drum(f, vel, decay=0.22, dur=0.8, slap=0.35, bend=0.35), R.uniform(-0.3, 0.3)), 20)


def timp(m, vel=0.8, dur=2.2):
    f = midi_hz(m)
    t = tvec(dur)
    pe = 1 + 0.015 * np.exp(-t / 0.06)
    modes = [(1.0, 1.0, 1.0), (1.504, 0.45, 0.6), (1.742, 0.3, 0.45), (2.0, 0.2, 0.4), (2.245, 0.12, 0.3), (2.494, 0.08, 0.25)]
    x = np.zeros(len(t))
    for r, g, d in modes:
        x += g * (1.0 if r < 1.2 else 0.5 + 0.5 * vel) * sine(f * r * pe, dur) * np.exp(-t / (1.1 * d))
    x += sine(f * 0.62, dur) * np.exp(-t / 0.05) * 0.5
    x += lp(rnoise(len(t)), 1500 + 3000 * vel) * np.exp(-t / 0.006) * 0.3
    return fade_tail(x * (1 - np.exp(-t / 0.001)) * vel * 0.5, 30)


_BANK = {}


def _cym_bank(dur=4.5, seed=5):
    if (dur, seed) not in _BANK:
        rr = np.random.default_rng(seed)
        t = tvec(dur)
        freqs = np.exp(rr.uniform(np.log(380), np.log(13000), 60))
        st = np.zeros((2, len(t)))
        for f in freqs:
            tau = 2.6 * (1000 / f) ** 0.45
            a = (1000 / f) ** 0.25
            for ch in range(2):
                st[ch] += a * np.sin(2 * np.pi * f * (1 + rr.uniform(-0.002, 0.002)) * t + rr.random() * 6.28) * np.exp(-t / tau)
        _BANK[(dur, seed)] = st / 60 ** 0.5
    return _BANK[(dur, seed)]


def crash_cym(vel=1.0, dur=4.5):
    bank = _cym_bank(4.5)[:, : n(dur)]
    t = tvec(dur)
    nz = hp(np.vstack([rnoise(len(t)), rnoise(len(t))]), 2500) * np.exp(-t / 1.0) * 0.3
    burst = hp(np.vstack([rnoise(len(t)), rnoise(len(t))]), 4000) * np.exp(-t / 0.05) * 0.35
    x = (bank * 0.6 + nz + burst) * (1 - np.exp(-t / 0.0015))
    x = lp(x, 6000 + 9000 * vel, 1)
    return fade_tail(x * vel * 0.35, 80)


def cym_swell(dur, vel=1.0):
    """Suspended cymbal rolled with soft mallets: a crescendo wash that peaks at the end."""
    t = tvec(dur)
    p = t / dur
    N = len(t)
    a = np.vstack([rnoise(N), rnoise(N)])
    x = hp(a, 2200, 2) * 0.55 + bp(a, 500, 2000, 2) * 0.12
    x = x * (1 + 0.12 * np.sin(2 * np.pi * 13 * t))[None]
    env = p ** 2.6
    return fade_tail(x * env[None] * vel * 0.3, 10)


def snare_roll(dur, v0=0.15, v1=0.8, rate=24.0):
    from instruments import crack_snare
    out = np.zeros((2, n(dur + 0.4)))
    k = 0
    tt = 0.0
    while tt < dur:
        p = tt / dur
        v = (v0 + (v1 - v0) * p ** 1.6) * (0.85 + 0.15 * (k % 2))
        s = crack_snare(v, tone=175)
        i = n(tt + R.normal(0, 0.002)) if k else 0
        i = max(0, i)
        st = place(s, -0.1)
        out[:, i:i + st.shape[1]] += st[:, : out.shape[1] - i]
        tt += 1 / rate
        k += 1
    out = lp(out, 7000, 1)
    return out * 0.5


def boom(dur=5.0, vel=1.0):
    """Orchestral / trailer boom: a sub drop, a low thump and a long rumble."""
    t = tvec(dur)
    sub = sine(30 + 55 * np.exp(-t / 0.22), dur) * np.exp(-t / 1.4) * (1 - np.exp(-t / 0.003))
    thump = lp(rnoise(len(t)), 500) * np.exp(-t / 0.07) * 0.9
    rumble = lp(rnoise(len(t)), 160) * np.exp(-t / 1.0) * 0.8
    x = softclip((sub + thump) * 1.1, 1.2) + rumble
    return fade_tail(np.vstack([x, x]) * vel * 0.8, 120)


# ---------------------------------------------------------------- hybrid synth
_PULSE = {}


def pulse(m, vel=0.7):
    """Hybrid low synth pulse for 8th-note drive (cached per pitch)."""
    if m not in _PULSE:
        total = 0.32
        t = tvec(total)
        f = midi_hz(m)
        x = saw(f * 1.004, total) + saw(f * 0.996, total) + 0.8 * sine(f, total)
        env = (1 - np.exp(-t / 0.003)) * np.exp(-t / 0.11)
        y = ladder_sweep(np.vstack([x, x]) * env[None], lambda s: 220 + 1300 * np.exp(-s / 0.05), resonance=0.2, block=64)
        _PULSE[m] = fade_tail(np.asarray(y, float) * 0.3, 10)
    return _PULSE[m] * vel


# ---------------------------------------------------------------- space
def hall_ir(rt=2.4, dur=3.4, pre=0.02, seed=3):
    """Synthetic concert-hall impulse response: frequency-dependent decay (lows ring longest,
    highs die first), a soft density build-up and a few early reflections. Unit energy."""
    rr = np.random.default_rng(seed)
    t = tvec(dur)
    N = len(t)
    bands = [(20, 250, 1.2), (250, 900, 1.05), (900, 3000, 0.95), (3000, 7000, 0.8), (7000, 18000, 0.55)]
    early = [(0.011, 0.5), (0.017, 0.4), (0.023, 0.35), (0.031, 0.3), (0.043, 0.25), (0.057, 0.2), (0.071, 0.15)]
    ir = np.zeros((2, N + n(pre)))
    for ch in range(2):
        acc = np.zeros(N)
        for lo, hi, k in bands:
            acc += bp(rr.standard_normal(N), lo, hi, 2) * np.exp(-6.91 * t / (rt * k))
        acc *= 1 - np.exp(-t / 0.035)
        for d, g in early:
            acc[n(d * (1 + 0.09 * ch))] += g * 3.0 * rr.choice([-1, 1])
        ir[ch, n(pre):] = acc
    ir = lp(ir, 13000, 1)
    # unity mean power gain over 200 Hz - 4 kHz, where the music lives
    H = np.abs(np.fft.rfft(ir, axis=1)) ** 2
    f = np.fft.rfftfreq(ir.shape[1], 1 / SR)
    band = (f > 200) & (f < 4000)
    return ir / np.sqrt(H[:, band].mean())


def convolve(x, ir):
    x = np.asarray(x, dtype=float)
    return np.vstack([oaconvolve(x[c], ir[c])[: x.shape[1]] for c in range(2)])

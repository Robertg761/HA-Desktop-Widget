"""Instruments and space for the 'minimal' option (modern minimal / keynote product film).

A cached clean piano, a celesta for the tile pings, a soft filtered synth pulse, an airy pad,
a soft tuned kick, sleigh bells, a synthetic stereo hall (convolution with a decorrelated,
frequency-dependent noise tail), a ping-pong delay, reversed swells and the piano/sub hits.
"""
import numpy as np
from scipy.signal import fftconvolve

from engine import SR, adsr, fade_tail, midi_hz, n, noise, saw, sine, softclip, sosfilt, square, tvec
import instruments as _ins

_R = np.random.default_rng(31)

# ---------------------------------------------------------------- piano
_PC = {}


def piano(m, dur, vel=0.7):
    """instruments.piano, memoised on (pitch, length, velocity) quantised to keep renders fast.
    Velocity is quantised to 0.04 steps (finer than the ear tracks on a repeated figure)."""
    key = (int(m), round(dur * 20) / 20, round(vel * 25) / 25)
    if key not in _PC:
        _PC[key] = _ins.piano(key[0], max(0.1, key[1]), key[2])
    return _PC[key]


def piano_chord(notes, dur, vel=0.7, roll=0.0, rng=None):
    """Several piano notes struck together (optionally rolled, low to high)."""
    rng = rng or _R
    parts = []
    for i, m in enumerate(sorted(notes)):
        v = vel * (0.92 + 0.12 * rng.random()) * (1.0 if i == len(notes) - 1 else 0.9)
        parts.append((n(i * roll), piano(m, dur, v)))
    L = max(o + p.shape[1] for o, p in parts)
    out = np.zeros((2, L))
    for o, p in parts:
        out[:, o:o + p.shape[1]] += p
    return out / max(1, len(notes)) ** 0.35


# ---------------------------------------------------------------- celesta / bells
def celesta(m, vel=0.7, dur=2.4):
    """Soft hammered metal bar: a nearly pure fundamental with a short bright 4th-partial
    shimmer and a felt hammer tick; long gentle decay."""
    t = tvec(dur)
    f = midi_hz(m)
    car = np.sin(2 * np.pi * f * t + 0.9 * vel * np.exp(-t / 0.06) * np.sin(2 * np.pi * f * t))
    p4 = 0.22 * np.sin(2 * np.pi * f * 4.0 * t) * np.exp(-t / 0.12)
    p2 = 0.12 * np.sin(2 * np.pi * f * 2.0 * t + 0.5) * np.exp(-t / 0.4)
    env = (1 - np.exp(-t / 0.0012)) * (0.7 * np.exp(-t / 0.35) + 0.3 * np.exp(-t / 1.4))
    tick = sosfilt(noise(0.01), 'bandpass', [2500, 8000], 2) * np.exp(-tvec(0.01) / 0.0015) * 0.08
    x = (car + p4 + p2) * env
    x[: len(tick)] += tick
    return fade_tail(x * 0.42 * vel, 40)


def sleigh(vel=1.0, rng=None):
    """Sleigh-bell shake: a dozen tiny inharmonic bells smeared over ~35 ms plus a jingle hiss."""
    rng = rng or _R
    dur = 0.32
    t = tvec(dur)
    out = np.zeros(len(t))
    for _ in range(12):
        off = rng.uniform(0, 0.035)
        f = rng.uniform(4200, 9500)
        i = n(off)
        s = t[: len(out) - i]
        out[i:] += np.sin(2 * np.pi * f * s) * np.sin(2 * np.pi * f * 1.47 * s + 1) * np.exp(-s / rng.uniform(0.03, 0.07))
    out += sosfilt(noise(dur), 'highpass', 6000, 2) * np.exp(-t / 0.025) * 0.25
    out = sosfilt(out, 'highpass', 3500, 2)
    return fade_tail(out * 0.16 * vel, 10)


# ---------------------------------------------------------------- pulse / pad / bass
def pulse(m, dur=0.2, vel=0.8, bright=0.5):
    """Soft synth pulse: narrow square + saw, filter envelope approximated by crossfading a
    bright and a dark low-passed copy."""
    total = dur + 0.12
    f = midi_hz(m)
    x = 0.55 * square(f, total, 0.32) + 0.45 * saw(f * 1.004, total)
    dark = sosfilt(x, 'lowpass', 380 + 500 * bright, 2)
    hi = sosfilt(x, 'lowpass', 1200 + 3800 * bright, 2)
    t = tvec(total)
    fe = np.exp(-t / (0.045 + 0.07 * bright))
    y = dark + (hi - dark) * fe
    env = adsr(dur, a=0.002, d=0.09, s=0.35, r=0.07, total=total)
    return fade_tail(y * env * 0.5 * vel, 6)


def air_pad(notes, dur, vel=0.6, attack=0.8, release=1.6, bright=0.4):
    """Airy pad: per note three detuned soft saws (low-passed) plus a sine core, a breathy
    noise layer, slow stereo drift. Returns (2, N)."""
    total = dur + release
    t = tvec(total)
    L = np.zeros(len(t))
    R = np.zeros(len(t))
    for m in notes:
        f = midi_hz(m)
        for k, d in enumerate((-0.0035, 0.0, 0.004)):
            drift = 1 + 0.0012 * np.sin(2 * np.pi * (0.13 + 0.05 * k) * t + _R.random() * 6.3)
            s = saw(f * (1 + d) * drift, total)
            (L if k != 1 else R)[:] += s * (0.7 if k != 1 else 0.5)
            if k == 1:
                L += s * 0.25
        core = np.sin(2 * np.pi * f * t + _R.random() * 6.3)
        L += core * 0.6
        R += core * 0.6
    cut = 700 + 2600 * bright
    L = sosfilt(L, 'lowpass', cut, 2)
    R = sosfilt(R, 'lowpass', cut * 1.05, 2)
    air = sosfilt(noise(total), 'bandpass', [4000, 11000], 2) * 0.05 * (0.6 + 0.4 * np.sin(2 * np.pi * 0.21 * t))
    st = np.vstack([L + air, R + np.roll(air, 331)])
    st = np.vstack([sosfilt(st[0], 'highpass', 140, 2), sosfilt(st[1], 'highpass', 140, 2)])
    env = adsr(dur, a=attack, d=0.5, s=0.9, r=release, total=total)
    return fade_tail(st * env[None] * vel * 0.32 / max(1, len(notes)) ** 0.6, 50)


def sub(m, dur, vel=0.8, attack=0.012):
    """Soft sub: sine with a little 2nd/3rd harmonic so it reads on small speakers."""
    f = midi_hz(m)
    total = dur + 0.09
    t = tvec(total)
    x = np.sin(2 * np.pi * f * t) + 0.22 * np.sin(4 * np.pi * f * t) + 0.06 * np.sin(6 * np.pi * f * t)
    env = adsr(dur, a=attack, d=0.25, s=0.82, r=0.08, total=total)
    return fade_tail(softclip(x * env * 0.62 * vel, 1.05), 8)


_BODY = None


def section(notes, dur, vel=0.7, attack=0.35, release=0.8, bright=0.5, spread=0.035, rng=None):
    """A string section from instruments.strings: each note enters 0-35 ms apart (players never
    bow together), a bow-noise layer follows the envelope (with a little extra on the attack),
    and a body EQ (wood resonance ~420 Hz, less boxy 1.3 kHz, presence ~2.9 kHz) makes the
    saw ensemble read more like bowed instruments in a room. Returns (2, N)."""
    import pedalboard as pb
    global _BODY
    if _BODY is None:
        _BODY = pb.Pedalboard([pb.PeakFilter(420, 2.5, 1.0), pb.PeakFilter(1300, -2.0, 1.2), pb.PeakFilter(2900, 2.0, 1.0)])
    rng = rng or _R
    notes = list(notes)
    total = dur + release
    pad_s = spread + 0.01
    out = np.zeros((2, n(total + pad_s) + 8))
    norm = max(1, len(notes)) ** -0.7  # same level as one call with all the notes
    for m in notes:
        o = n(rng.uniform(0, spread)) if len(notes) > 1 else 0
        x = _ins.strings([m], max(0.05, dur - o / SR), vel, attack=attack, release=release, bright=bright) * norm
        out[:, o:o + x.shape[1]] += x
    # bow noise: band-passed 2-7 kHz hiss, ~-30 dB under the section, shaped by the envelope
    L = out.shape[1]
    env = adsr(dur, a=attack, d=0.3, s=0.9, r=release, total=L / SR)[:L]
    acc = 1 + 1.5 * np.exp(-np.arange(L) / SR / 0.06) * (np.arange(L) / SR < attack + 0.15)
    nz = np.vstack([sosfilt(noise(L / SR)[:L], 'bandpass', [2000, 7000], 2) for _ in range(2)])
    lvl = np.sqrt((out ** 2).mean()) + 1e-9
    nz = nz / (np.sqrt((nz ** 2).mean()) + 1e-9) * lvl * 10 ** (-30 / 20)
    out = out + nz * (env * acc)[None]
    out = _BODY(out.astype(np.float32), SR).astype(np.float64)
    return fade_tail(out, 30)


# ---------------------------------------------------------------- drums
def soft_kick(vel=1.0, tune=52.0, tau=0.1, dur=0.3):
    """Round, tight kick tuned near E1/G#1: short pitch drop, quick body, tiny click.
    The groove uses the tight default (0.1 s body); the hits pass a longer tau for a boom."""
    t = tvec(dur)
    f = tune + 95 * np.exp(-t / 0.022) + 30 * np.exp(-t / 0.004)
    body = sine(f, dur) * np.exp(-t / tau)
    body = softclip(body * 1.4, 1.2)
    click = sosfilt(noise(0.005), 'bandpass', [1500, 6000], 2) * np.linspace(1, 0, n(0.005)) * 0.12
    body[: len(click)] += click
    return fade_tail(body * 0.85 * vel, 20)


def tick(vel=1.0):
    """Very small clock-like tick (high rim)."""
    dur = 0.05
    t = tvec(dur)
    x = np.sin(2 * np.pi * 2900 * t) * np.exp(-t / 0.005) + sosfilt(noise(dur), 'highpass', 5000, 2) * np.exp(-t / 0.003) * 0.4
    return fade_tail(x * 0.3 * vel, 3)


# ---------------------------------------------------------------- space
def hall_ir(rt60=2.4, predelay=0.018, lp=8000, hp=160, seed=3, width=1.0):
    """Synthetic stereo hall impulse response: decorrelated noise tails with faster decay of the
    highs, a soft diffuse build-up and a few early reflections. Unit energy per channel."""
    r = np.random.default_rng(seed)
    L = n(rt60 * 1.15 + predelay)
    t = np.arange(L) / SR
    out = np.zeros((2, L))
    for ch in range(2):
        nz = r.standard_normal(L)
        lo = sosfilt(nz, 'lowpass', 600, 2)
        mid = sosfilt(nz, 'bandpass', [600, 3500], 2)
        hi = sosfilt(nz, 'highpass', 3500, 2)
        y = lo * np.exp(-6.9 * t / (rt60 * 1.15)) + mid * np.exp(-6.9 * t / rt60) + hi * 0.8 * np.exp(-6.9 * t / (rt60 * 0.5))
        y *= 1 - np.exp(-t / 0.02)
        for _ in range(7):
            k = n(r.uniform(0.006, 0.045))
            y[k] += r.uniform(-1, 1) * 18
        y = sosfilt(sosfilt(y, 'lowpass', lp, 2), 'highpass', hp, 2)
        out[ch] = y
    mid = out.mean(axis=0)
    side = (out[0] - out[1]) / 2
    out = np.vstack([mid + side * width, mid - side * width])
    out /= np.sqrt((out ** 2).sum(axis=1, keepdims=True)) + 1e-12
    k = n(predelay)
    return np.pad(out, ((0, 0), (k, 0)))


def hall(x, ir, wet=0.25):
    """Wet-only convolution reverb send of a (2, N) buffer."""
    x = np.atleast_2d(x)
    N = x.shape[1]
    y = np.vstack([fftconvolve(x[0], ir[0])[:N], fftconvolve(x[1], ir[1])[:N]])
    return y * wet


def pingpong(x, delay=0.375, fb=0.42, taps=6, lp=4500, hp=350, wet=0.25):
    """Ping-pong delay send: mono-summed input, filtered, echoes alternate R/L."""
    x = np.atleast_2d(x)
    mono = sosfilt(sosfilt(x.mean(axis=0), 'highpass', hp, 2), 'lowpass', lp, 2)
    N = len(mono)
    out = np.zeros((2, N))
    d = n(delay)
    g = 1.0
    for k in range(1, taps + 1):
        s = k * d
        if s >= N:
            break
        ch = 1 if k % 2 else 0
        out[ch, s:] += mono[: N - s] * g
        g *= fb
        mono = sosfilt(mono, 'lowpass', lp * 0.85, 1)  # each repeat a little darker
    return out * wet


def reverse_swell(x, ir, dur):
    """Reverse the reverb of a sound so it swells up into a downbeat (length dur, ends at peak)."""
    x = np.atleast_2d(x)
    wet = np.vstack([fftconvolve(x[0], ir[0]), fftconvolve(x[1], ir[1])])
    wet = wet[:, : n(dur)]
    rev = wet[:, ::-1] * np.linspace(0, 1, wet.shape[1])[None] ** 1.5
    return fade_tail(rev / (np.abs(rev).max() + 1e-9), 4)


def air_riser(dur, f0=500, f1=9000):
    """A soft noise swell that opens upward (no synth pitch, so it stays acoustic-feeling)."""
    from engine import riser
    r = riser(dur, f0=f0, f1=f1, pitch=False)
    return r / (np.abs(r).max() + 1e-9)


# ---------------------------------------------------------------- hits
def min_hit(root=28, size=1.0, ir=None, piano_notes=(28, 40, 47, 52)):
    """Piano/sub hit: a deep sine boom falling to the root, a felt kick thump, low piano
    octaves struck hard, and a dark air burst through the hall."""
    dur = 4.5
    t = tvec(dur)
    f_end = midi_hz(root)
    boom = np.sin(2 * np.pi * np.cumsum(f_end + f_end * 1.4 * np.exp(-t / 0.07)) / SR) * np.exp(-t / (0.9 * size)) * 0.9
    boom = softclip(boom * 1.3, 1.1)
    kk = soft_kick(1.0, tune=50, tau=0.2, dur=0.42)
    thump = np.zeros(len(t))
    thump[: len(kk)] += kk * 0.8
    air = sosfilt(noise(dur), 'lowpass', 2200, 2) * np.exp(-t / 0.22) * (1 - np.exp(-t / 0.002)) * 0.35 * size
    crack = sosfilt(noise(0.06), 'bandpass', [1800, 9000], 2) * np.exp(-tvec(0.06) / 0.014) * 0.3
    mono = boom + thump + air
    mono[: len(crack)] += crack
    pc = piano_chord(piano_notes, 3.8, 1.0)
    out = np.zeros((2, len(t)))
    out += mono[None] * 0.8
    out[:, : min(len(t), pc.shape[1])] += pc[:, : len(t)] * 1.4
    if ir is not None:
        out += hall(out * 0.6, ir, wet=0.35 * size)
    return fade_tail(out, 200)

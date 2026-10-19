"""Instruments for the 'indie' (feel-good indie pop) soundtrack option.

Steel-string acoustic (Karplus-Strong strings with a pick transient, strummed down/up, palm mutes
and dead-string chops), a whistle with glides and delayed vibrato, a gang vocal 'oh', tambourine,
a stomp kick, a gang of handclaps and the genre's hit (big strum + stomp + floor + crash).
Everything returns float arrays at engine.SR; mono unless stated.
"""
import numpy as np

from engine import SR, RNG, clap, crash, fade_tail, midi_hz, n, noise, pan, saw, sine, softclip, sosfilt, tvec, adsr
from instruments import _karplus, boom_kick, crack_snare


# ---------------------------------------------------------------- acoustic guitar
def ac_note(m, dur, vel=0.8, bright=0.75, mute=0.0):
    """One steel string. dur = how long the string rings before the hand damps it.
    mute in [0, 1]: palm mute (short, dark, thumpy)."""
    f = midi_hz(m)
    if mute > 0:
        hold = min(dur, 0.06 + 0.22 * (1 - mute))
        decay = 0.985 - 0.035 * mute
        b = bright * (0.55 - 0.25 * mute)
        rel = 0.025
    else:
        hold = min(dur, 4.5)
        decay = 0.9989
        b = bright
        rel = 0.07
    total = hold + rel * 4
    y = _karplus(f, total, bright=float(np.clip(b * (0.65 + 0.35 * vel), 0.05, 1.0)), decay=decay)
    t = tvec(total)
    env = np.ones_like(t)
    k = n(hold)
    env[k:] = np.exp(-(t[k:] - t[k]) / rel)
    if mute > 0:
        env *= np.exp(-t / (0.035 + 0.1 * (1 - mute)))
    # pick: a tiny bright tick (open) or a dull thock (muted)
    pk = n(0.007)
    if mute > 0:
        tick = sosfilt(noise(0.007), 'bandpass', [400, 2500], 2) * np.exp(-tvec(0.007) / 0.002) * 0.35
    else:
        tick = sosfilt(noise(0.007), 'bandpass', [2500, 9500], 2) * np.exp(-tvec(0.007) / 0.0012) * 0.22
    y = y * env
    y[:pk] += tick * vel
    return fade_tail(y * vel, 6)


def ac_strum(notes, dur, vel=0.8, down=True, bright=0.75, mute=0.0, top=None, spread=None):
    """Strum `notes` (low to high). Down strokes go low->high; up strokes high->low and by
    default only catch the top 3-4 strings, softer. dur = until the next stroke damps it."""
    order = list(notes) if down else list(reversed(notes))
    if top is None and not down:
        top = min(4, len(order))
    if top:
        order = order[:top]
    sp = spread if spread is not None else (0.0105 if down else 0.0075) * (1.25 - 0.45 * vel)
    total = dur + 0.4 + sp * len(order)
    acc = np.zeros(n(total))
    for i, m in enumerate(order):
        v = vel * (0.82 + 0.18 * RNG.random())
        if not down:
            v *= 0.8 + 0.2 * (i / max(1, len(order) - 1))
        g = ac_note(m, max(0.035, dur - i * sp), v, bright, mute)
        k = n(max(0.0, i * sp + RNG.normal(0, 0.0006)))
        j = min(len(acc), k + len(g))
        acc[k:j] += g[: j - k]
    return acc / max(1, len(order)) ** 0.55


def chop(notes, vel=0.7):
    """Dead-string 'chk' on the backbeat: fretting hand released, all strings muted."""
    s = ac_strum(notes, 0.05, vel * 0.9, True, bright=0.9, mute=1.0, spread=0.004)
    t = tvec(0.05)
    scratch = sosfilt(noise(0.05), 'bandpass', [1200, 6000], 2) * np.exp(-t / 0.012) * 0.25 * vel
    s[: len(scratch)] += scratch
    return s


def reverse_strum(notes, dur=1.0):
    """A strum played backwards, swelling into the next downbeat."""
    s = ac_strum(notes, dur + 1.0, 1.0, True, bright=0.9)
    s = s[: n(dur)][::-1].copy()
    s *= np.linspace(0, 1, len(s)) ** 2
    return s


# ---------------------------------------------------------------- whistle
def whistle(events, vib_rate=5.4, vib_cents=28, glide=0.028, breath=0.08):
    """A whistled line. events: [(t, midi, dur, vel), ...] relative to the phrase start.
    Legato notes glide; vibrato fades in on held notes; a little breath noise. Mono."""
    end = max(e[0] + e[2] for e in events) + 0.5
    N = n(end)
    tt = np.arange(N) / SR
    pitch = np.full(N, float(events[0][1]))
    amp = np.zeros(N)
    vib_ramp = np.zeros(N)
    for i, (t0, m, d, v) in enumerate(events):
        i0 = n(t0)
        seg = tt[i0:] - t0
        if i > 0:
            prev = events[i - 1][1]
            gap = t0 - (events[i - 1][0] + events[i - 1][2])
            g = glide if gap < 0.03 else glide * 0.5
            pitch[i0:] = m + (prev - m) * np.exp(-seg / g)
        else:
            pitch[i0:] = m - 0.3 * np.exp(-seg / 0.03)  # slight scoop into the first note
        k1 = min(N, n(t0 + d))
        e = np.zeros(N)
        a = np.clip(seg[: k1 - i0] / 0.018, 0, 1)
        sus = 1 - 0.12 * np.clip(seg[: k1 - i0] / max(d, 0.2), 0, 1)
        e[i0:k1] = v * a * sus
        lvl = e[k1 - 1] if k1 > i0 else 0
        e[k1:] = lvl * np.exp(-(tt[k1:] - (t0 + d)) / 0.05)
        amp = np.maximum(amp, e)
        vr = np.zeros(N)
        vr[i0:k1] = np.clip((seg[: k1 - i0] - 0.16) / 0.25, 0, 1)
        vib_ramp[i0:] = 0  # each new note starts straight, vibrato blooms if it is held
        vib_ramp = np.maximum(vib_ramp, vr)
    vib = vib_cents / 100 * np.sin(2 * np.pi * vib_rate * tt + 0.3 * np.sin(2 * np.pi * 0.7 * tt)) * vib_ramp
    f = midi_hz(pitch + vib)
    ph = 2 * np.pi * np.cumsum(f) / SR
    tone = np.sin(ph) + 0.05 * np.sin(2 * ph) + 0.015 * np.sin(3 * ph)
    br = sosfilt(noise(end), 'bandpass', [1400, 5200], 2) * breath
    chiff = np.zeros(N)
    for (t0, m, d, v) in events:
        i0 = n(t0)
        L = min(N - i0, n(0.03))
        chiff[i0:i0 + L] += np.exp(-np.arange(L) / (0.006 * SR)) * 0.6
    x = (tone + br * (1 + 3 * chiff)) * amp
    return fade_tail(x * 0.5, 20)


# ---------------------------------------------------------------- vocals
FORMANTS = {
    'o': [(500, 1.0), (850, 0.45), (2700, 0.12)],
    'u': [(360, 1.0), (680, 0.3), (2700, 0.08)],
    'a': [(750, 1.0), (1200, 0.55), (2800, 0.2)],
}


def gang(m, dur, vel=0.7, vowel='o', voices=8, octave=True):
    """Gang vocal: a few loose singers in unison (some an octave down), each scooping into the
    note with their own vibrato and timing, through vowel formants. Stereo (2, N)."""
    total = dur + 0.4
    t = tvec(total)
    out = np.zeros((2, n(total)))
    for v in range(voices):
        mm = m - (12 if (octave and v % 3 == 2) else 0)
        f0 = midi_hz(mm) * 2 ** (RNG.normal(0, 9) / 1200)
        scoop = 2 ** (-(0.7 + 0.4 * RNG.random()) * np.exp(-t / 0.045) / 12)
        vib = 1 + 0.0045 * np.sin(2 * np.pi * (4.8 + RNG.random()) * t + RNG.random() * 6.3) * np.clip((t - 0.15) / 0.3, 0, 1)
        x = saw(f0 * scoop * vib, total)
        d = n(abs(RNG.normal(0, 0.011)))
        x = np.concatenate([np.zeros(d), x[: len(x) - d]])
        p = (v / max(1, voices - 1)) * 1.4 - 0.7
        out += pan(x, p) * (0.8 + 0.4 * RNG.random())
    y = np.zeros_like(out)
    for fc, g in FORMANTS[vowel]:
        for ch in range(2):
            y[ch] += sosfilt(out[ch], 'bandpass', [fc * 0.86, fc * 1.14], 2) * g
    env = adsr(dur, a=0.035, d=0.15, s=0.82, r=0.22, total=total)
    return fade_tail(y * env[None] * vel * 1.6 / voices ** 0.5, 30)


# ---------------------------------------------------------------- percussion
def tamb(vel=0.7, hit=False):
    """Tambourine: a cluster of ring-modulated jingle partials plus a noise splash."""
    dur = 0.32 if hit else 0.13
    t = tvec(dur)
    x = np.zeros(n(dur))
    for _ in range(9 if hit else 6):
        f = RNG.uniform(5800, 11500)
        off = n(RNG.uniform(0, 0.022 if hit else 0.01))
        s = t[: len(x) - off]
        x[off:] += np.sin(2 * np.pi * f * s) * np.sin(2 * np.pi * f * 1.37 * s) * np.exp(-s / (0.085 if hit else 0.03))
    x += sosfilt(noise(dur), 'highpass', 6500, 2) * np.exp(-t / (0.03 if hit else 0.012)) * 0.6
    x = sosfilt(x, 'highpass', 4500, 2)
    return fade_tail(x * 0.25 * vel, 6)


def stomp(vel=1.0):
    """Stomp/boom kick: a round boom plus a wooden-floor thud."""
    k = boom_kick(vel) * 0.85
    dur = len(k) / SR
    t = tvec(dur)
    k = k * np.exp(-t / 0.16)  # tighter than a hip-hop boom: a stomp, not an 808
    floor = sosfilt(noise(dur), 'bandpass', [80, 420], 2) * np.exp(-t / 0.035) * 0.9 * vel
    knock = sosfilt(noise(dur), 'bandpass', [900, 2600], 2) * np.exp(-t / 0.006) * 0.18 * vel
    return fade_tail(softclip(k + floor + knock, 1.1), 15)


def claps(vel=0.8, players=3, spread=0.011):
    """A few people clapping together: stereo (2, N)."""
    out = np.zeros((2, n(0.5)))
    for i in range(players):
        c = clap() * (0.8 + 0.3 * RNG.random())
        c = sosfilt(c, 'bandpass', [700 + 300 * i, 7000 + 600 * i], 2)
        off = n(abs(RNG.normal(0, spread * 0.6)) + i * 0.002)
        st = pan(c, -0.45 + 0.9 * i / max(1, players - 1))
        L = min(out.shape[1] - off, st.shape[1])
        out[:, off:off + L] += st[:, :L]
    return out * vel / players ** 0.5


def sleigh(vel=0.7, dur=0.22):
    """Sleigh bells: many tiny bells (stereo)."""
    t = tvec(dur)
    out = np.zeros((2, n(dur)))
    for ch in range(2):
        x = np.zeros(n(dur))
        for _ in range(7):
            f = RNG.uniform(4800, 9500)
            off = n(RNG.uniform(0, 0.03))
            s = t[: len(x) - off]
            x[off:] += np.sin(2 * np.pi * f * s) * np.exp(-s / 0.05) * np.sin(2 * np.pi * f * 1.51 * s)
        out[ch] = sosfilt(x + noise(dur) * 0.04 * np.exp(-t / 0.03), 'highpass', 3800, 2)
    return fade_tail(out * 0.2 * vel, 10)


# ---------------------------------------------------------------- the hit
def indie_hit(chord, ring=3.0, big=1.0):
    """Big down-strum on two guitars (L/R) + stomp + floor-tom boom + crash. Stereo."""
    a = ac_strum(chord, ring, 1.0, True, bright=0.95, spread=0.006)
    b = ac_strum(chord, ring, 1.0, True, bright=0.85, spread=0.008)
    N = n(ring + 1.2)
    out = np.zeros((2, N))

    def put(x, at=0.0, g=1.0):
        x = np.atleast_2d(x)
        if x.shape[0] == 1:
            x = np.vstack([x[0], x[0]])
        i = n(at)
        L = min(N - i, x.shape[1])
        out[:, i:i + L] += x[:, :L] * g

    put(pan(a, -0.6), 0.0, 0.9)
    put(pan(b, 0.6), 0.004, 0.9)
    put(stomp(1.0), 0.0, 1.1 * big)
    t = tvec(1.4)
    boom = sine(48 + 40 * np.exp(-t / 0.05), 1.4) * np.exp(-t / 0.5) * 0.8
    put(softclip(boom * 1.2, 1.1), 0.0, big)
    put(crash(min(ring + 0.5, 3.5)), 0.0, 0.8)
    put(claps(1.0), 0.0, 0.5)
    put(crack_snare(0.8, 180), 0.0, 0.25 * big)
    return out
